// SPDX-License-Identifier: AGPL-3.0-only

package protocol

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestDecodeEnvelopeRejectsUnknownFields(t *testing.T) {
	raw := `{"version":1,"id":"msg-1","type":"heartbeat","sentAt":"2026-08-16T00:00:00Z","payload":{},"unexpected":true}`

	_, err := DecodeEnvelope([]byte(raw), 4096)
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("expected unknown field rejection, got %v", err)
	}
}

func TestCommandValidationRejectsExpiredDeadline(t *testing.T) {
	now := time.Now().UTC()
	command := Command{
		ID:             "command-1",
		Kind:           CommandInventory,
		IdempotencyKey: "inventory-1",
		Deadline:       now.Add(-time.Second),
		Payload:        json.RawMessage(`{}`),
	}

	if err := command.Validate(now); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected deadline validation error, got %v", err)
	}
}

func TestNewEnvelopeRoundTrip(t *testing.T) {
	envelope, err := NewEnvelope("msg-1", TypeHeartbeat, Heartbeat{
		MachineID: "8d13a04f-a31d-4ac7-a3fb-bdbc3b256f43",
		Time:      time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("new envelope: %v", err)
	}
	raw, err := json.Marshal(envelope)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	decoded, err := DecodeEnvelope(raw, 4096)
	if err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if decoded.Type != TypeHeartbeat {
		t.Fatalf("unexpected type %q", decoded.Type)
	}
}
