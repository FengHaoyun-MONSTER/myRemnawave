// SPDX-License-Identifier: AGPL-3.0-only

package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"time"
)

const Version = 1

const (
	TypeHello         = "hello"
	TypeHeartbeat     = "heartbeat"
	TypeCommand       = "command"
	TypeCommandResult = "command_result"
)

const (
	CommandInventory            = "inventory"
	CommandDiscoverHost         = "discover_host"
	CommandPreflight            = "preflight"
	CommandReconcileInstance    = "reconcile_instance"
	CommandReconcileCertificate = "reconcile_certificate"
	CommandReconcileWARP        = "reconcile_warp"
	CommandStartInstance        = "start_instance"
	CommandStopInstance         = "stop_instance"
	CommandDrainInstance        = "drain_instance"
	CommandInspectInstance      = "inspect_instance"
	CommandApplyConfig          = "apply_config"
	CommandStageUpdate          = "stage_update"
	CommandApplyUpdate          = "apply_update"
	CommandVerifyUpdate         = "verify_update"
	CommandRollbackUpdate       = "rollback_update"
)

const (
	ResultSucceeded   = "succeeded"
	ResultFailed      = "failed"
	ResultUnsupported = "unsupported"
)

var identifierPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`)

type Envelope struct {
	Version int             `json:"version"`
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	SentAt  time.Time       `json:"sentAt"`
	Payload json.RawMessage `json:"payload"`
}

type Hello struct {
	MachineID    string   `json:"machineId"`
	AgentVersion string   `json:"agentVersion"`
	Capabilities []string `json:"capabilities"`
}

type Heartbeat struct {
	MachineID string    `json:"machineId"`
	Time      time.Time `json:"time"`
}

type Command struct {
	ID             string          `json:"id"`
	Kind           string          `json:"kind"`
	IdempotencyKey string          `json:"idempotencyKey"`
	Deadline       time.Time       `json:"deadline"`
	Payload        json.RawMessage `json:"payload"`
}

type CommandResult struct {
	CommandID      string          `json:"commandId"`
	IdempotencyKey string          `json:"idempotencyKey"`
	Status         string          `json:"status"`
	ErrorCode      string          `json:"errorCode,omitempty"`
	Message        string          `json:"message,omitempty"`
	Payload        json.RawMessage `json:"payload,omitempty"`
	CompletedAt    time.Time       `json:"completedAt"`
}

func NewEnvelope(id, messageType string, payload any) (Envelope, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return Envelope{}, fmt.Errorf("encode envelope payload: %w", err)
	}
	envelope := Envelope{
		Version: Version,
		ID:      id,
		Type:    messageType,
		SentAt:  time.Now().UTC(),
		Payload: raw,
	}
	if err := envelope.Validate(); err != nil {
		return Envelope{}, err
	}
	return envelope, nil
}

func DecodeEnvelope(data []byte, maxBytes int64) (Envelope, error) {
	if int64(len(data)) > maxBytes {
		return Envelope{}, errors.New("message exceeds configured size limit")
	}
	decoder := json.NewDecoder(io.LimitReader(bytes.NewReader(data), maxBytes+1))
	decoder.DisallowUnknownFields()
	var envelope Envelope
	if err := decoder.Decode(&envelope); err != nil {
		return Envelope{}, fmt.Errorf("decode envelope: %w", err)
	}
	if err := ensureEOF(decoder); err != nil {
		return Envelope{}, err
	}
	if err := envelope.Validate(); err != nil {
		return Envelope{}, err
	}
	return envelope, nil
}

func DecodePayload[T any](payload json.RawMessage) (T, error) {
	var result T
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return result, fmt.Errorf("decode payload: %w", err)
	}
	if err := ensureEOF(decoder); err != nil {
		return result, err
	}
	return result, nil
}

func (e Envelope) Validate() error {
	if e.Version != Version {
		return fmt.Errorf("unsupported protocol version %d", e.Version)
	}
	if !identifierPattern.MatchString(e.ID) {
		return errors.New("invalid envelope id")
	}
	switch e.Type {
	case TypeHello, TypeHeartbeat, TypeCommand, TypeCommandResult:
	default:
		return errors.New("unsupported envelope type")
	}
	if e.SentAt.IsZero() {
		return errors.New("sentAt is required")
	}
	if len(e.Payload) == 0 {
		return errors.New("payload is required")
	}
	return nil
}

func (c Command) Validate(now time.Time) error {
	if !identifierPattern.MatchString(c.ID) {
		return errors.New("invalid command id")
	}
	if !identifierPattern.MatchString(c.IdempotencyKey) {
		return errors.New("invalid idempotency key")
	}
	if !IsKnownCommand(c.Kind) {
		return errors.New("unsupported command kind")
	}
	if c.Deadline.IsZero() || !c.Deadline.After(now) {
		return errors.New("command deadline has expired")
	}
	if len(c.Payload) == 0 {
		return errors.New("command payload is required")
	}
	return nil
}

func IsKnownCommand(kind string) bool {
	switch kind {
	case CommandInventory,
		CommandDiscoverHost,
		CommandPreflight,
		CommandReconcileInstance,
		CommandReconcileCertificate,
		CommandReconcileWARP,
		CommandStartInstance,
		CommandStopInstance,
		CommandDrainInstance,
		CommandInspectInstance,
		CommandApplyConfig,
		CommandStageUpdate,
		CommandApplyUpdate,
		CommandVerifyUpdate,
		CommandRollbackUpdate:
		return true
	default:
		return false
	}
}

func ensureEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON values are not allowed")
		}
		return fmt.Errorf("decode trailing data: %w", err)
	}
	return nil
}
