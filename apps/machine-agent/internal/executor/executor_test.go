// SPDX-License-Identifier: AGPL-3.0-only

package executor

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/protocol"
)

type memoryStore struct {
	results map[string]protocol.CommandResult
}

func (s *memoryStore) Get(key string) (protocol.CommandResult, bool, error) {
	result, ok := s.results[key]
	return result, ok, nil
}

func (s *memoryStore) Put(key string, result protocol.CommandResult) (protocol.CommandResult, bool, error) {
	if existing, ok := s.results[key]; ok {
		return existing, true, nil
	}
	s.results[key] = result
	return result, false, nil
}

type successfulHandler struct{}

func (successfulHandler) Execute(_ context.Context, _ json.RawMessage) (any, error) {
	return map[string]bool{"ok": true}, nil
}

func TestExecutorReplaysIdempotentResult(t *testing.T) {
	store := &memoryStore{results: make(map[string]protocol.CommandResult)}
	executor, err := New(store, time.Minute, map[string]Handler{
		protocol.CommandInventory: successfulHandler{},
	})
	if err != nil {
		t.Fatalf("create executor: %v", err)
	}
	command := protocol.Command{
		ID:             "command-1",
		Kind:           protocol.CommandInventory,
		IdempotencyKey: "key-1",
		Deadline:       time.Now().Add(time.Minute),
		Payload:        json.RawMessage(`{}`),
	}
	first := executor.Execute(context.Background(), command)
	command.ID = "command-2"
	second := executor.Execute(context.Background(), command)
	if first.CommandID != second.CommandID {
		t.Fatalf("expected replayed result, got first=%q second=%q", first.CommandID, second.CommandID)
	}
}

func TestExecutorReportsUnavailableCapability(t *testing.T) {
	store := &memoryStore{results: make(map[string]protocol.CommandResult)}
	executor, err := New(store, time.Minute, nil)
	if err != nil {
		t.Fatalf("create executor: %v", err)
	}
	result := executor.Execute(context.Background(), protocol.Command{
		ID:             "command-1",
		Kind:           protocol.CommandReconcileWARP,
		IdempotencyKey: "key-1",
		Deadline:       time.Now().Add(time.Minute),
		Payload:        json.RawMessage(`{}`),
	})
	if result.Status != protocol.ResultUnsupported || result.ErrorCode != "CAPABILITY_NOT_AVAILABLE" {
		t.Fatalf("unexpected result: %#v", result)
	}
}
