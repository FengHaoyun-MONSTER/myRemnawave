// SPDX-License-Identifier: AGPL-3.0-only

package executor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/protocol"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/state"
)

const maxResultMessageBytes = 16 * 1024

var errorCodePrefix = regexp.MustCompile(`^[A-Z][A-Z0-9_]{2,63}$`)

type Handler interface {
	Execute(ctx context.Context, payload json.RawMessage) (any, error)
}

type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string {
	return e.Message
}

type Executor struct {
	handlers       map[string]Handler
	store          state.Store
	defaultTimeout time.Duration
}

func New(store state.Store, defaultTimeout time.Duration, handlers map[string]Handler) (*Executor, error) {
	if store == nil {
		return nil, errors.New("command state store is required")
	}
	if defaultTimeout <= 0 {
		return nil, errors.New("default command timeout must be positive")
	}
	registered := make(map[string]Handler, len(handlers))
	for kind, handler := range handlers {
		if !protocol.IsKnownCommand(kind) {
			return nil, fmt.Errorf("cannot register unknown command kind %q", kind)
		}
		if handler == nil {
			return nil, fmt.Errorf("handler for %q is nil", kind)
		}
		registered[kind] = handler
	}
	return &Executor{handlers: registered, store: store, defaultTimeout: defaultTimeout}, nil
}

func (e *Executor) Execute(ctx context.Context, command protocol.Command) protocol.CommandResult {
	now := time.Now().UTC()
	if err := command.Validate(now); err != nil {
		return failedResult(command, "INVALID_COMMAND", err.Error())
	}
	if existing, found, err := e.store.Get(command.IdempotencyKey); err != nil {
		return failedResult(command, "STATE_READ_FAILED", safeMessage(err.Error()))
	} else if found {
		return existing
	}

	handler, ok := e.handlers[command.Kind]
	if !ok {
		result := protocol.CommandResult{
			CommandID:      command.ID,
			IdempotencyKey: command.IdempotencyKey,
			Status:         protocol.ResultUnsupported,
			ErrorCode:      "CAPABILITY_NOT_AVAILABLE",
			Message:        "command capability is not available in this agent version",
			CompletedAt:    time.Now().UTC(),
		}
		return e.persist(command, result)
	}

	timeout := e.defaultTimeout
	if remaining := time.Until(command.Deadline); remaining < timeout {
		timeout = remaining
	}
	commandContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	payload, err := handler.Execute(commandContext, command.Payload)
	if err != nil {
		code := "COMMAND_FAILED"
		message := err.Error()
		var commandError *Error
		if errors.As(err, &commandError) {
			code = commandError.Code
			message = commandError.Message
		} else if errors.Is(err, context.DeadlineExceeded) || errors.Is(commandContext.Err(), context.DeadlineExceeded) {
			code = "COMMAND_TIMEOUT"
			message = "command exceeded its deadline"
		} else if prefix, _, found := strings.Cut(message, ":"); found && errorCodePrefix.MatchString(prefix) {
			code = prefix
		}
		return e.persist(command, failedResult(command, code, safeMessage(message)))
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return e.persist(command, failedResult(command, "RESULT_ENCODING_FAILED", "command result could not be encoded"))
	}
	result := protocol.CommandResult{
		CommandID:      command.ID,
		IdempotencyKey: command.IdempotencyKey,
		Status:         protocol.ResultSucceeded,
		Payload:        raw,
		CompletedAt:    time.Now().UTC(),
	}
	return e.persist(command, result)
}

func (e *Executor) persist(command protocol.Command, result protocol.CommandResult) protocol.CommandResult {
	stored, duplicate, err := e.store.Put(command.IdempotencyKey, result)
	if err != nil {
		return failedResult(command, "STATE_WRITE_FAILED", safeMessage(err.Error()))
	}
	if duplicate {
		return stored
	}
	return result
}

func failedResult(command protocol.Command, code, message string) protocol.CommandResult {
	return protocol.CommandResult{
		CommandID:      command.ID,
		IdempotencyKey: command.IdempotencyKey,
		Status:         protocol.ResultFailed,
		ErrorCode:      code,
		Message:        safeMessage(message),
		CompletedAt:    time.Now().UTC(),
	}
}

func safeMessage(message string) string {
	message = strings.ReplaceAll(message, "\x00", "")
	if len(message) > maxResultMessageBytes {
		return message[:maxResultMessageBytes] + "…"
	}
	return message
}
