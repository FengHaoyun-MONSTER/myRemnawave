// SPDX-License-Identifier: AGPL-3.0-only

package warp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

const testPlanID = "123e4567-e89b-42d3-a456-426614174005"

func TestTakeoverRefusesDetected3XUIWithoutWritingOwnership(t *testing.T) {
	root := t.TempDir()
	handler := TakeoverHandler{
		ManagedRoot: root,
		MachineID:   testMachineID,
		LookupPath: func(string) (string, error) {
			return "/usr/bin/warp-cli", nil
		},
		Detect3XUI: func(context.Context) (bool, string, error) {
			return true, "x-ui.service is installed", nil
		},
	}

	_, err := handler.Execute(context.Background(), takeoverPayload(true))
	if err == nil || !strings.Contains(err.Error(), "WARP_TAKEOVER_FORBIDDEN_3XUI") {
		t.Fatalf("expected a 3X-UI refusal, got %v", err)
	}
	if _, ownershipErr := ReadOwnership(root); !errors.Is(ownershipErr, os.ErrNotExist) {
		t.Fatalf("ownership must remain absent after refusal, got %v", ownershipErr)
	}
}

func TestTakeoverRecordsAuditedAdoptionWithoutMutatingWARP(t *testing.T) {
	root := t.TempDir()
	handler := TakeoverHandler{
		ManagedRoot: root,
		MachineID:   testMachineID,
		LookupPath: func(string) (string, error) {
			return "/usr/bin/warp-cli", nil
		},
		Detect3XUI: func(context.Context) (bool, string, error) {
			return false, "no 3X-UI indicators detected", nil
		},
	}

	resultValue, err := handler.Execute(context.Background(), takeoverPayload(true))
	if err != nil {
		t.Fatalf("takeover failed: %v", err)
	}
	result := resultValue.(TakeoverResult)
	if result.PlanID != testPlanID || result.Ownership != "ADOPTED" {
		t.Fatalf("unexpected result: %#v", result)
	}
	ownership, err := ReadOwnership(root)
	if err != nil {
		t.Fatalf("read ownership: %v", err)
	}
	if ownership.MachineID != testMachineID || ownership.State != "ADOPTED" || ownership.AdoptedFromPlanID != testPlanID || ownership.AdoptedAt.IsZero() {
		t.Fatalf("unexpected ownership: %#v", ownership)
	}
}

func TestTakeoverRequiresExplicitAttestation(t *testing.T) {
	handler := TakeoverHandler{ManagedRoot: t.TempDir(), MachineID: testMachineID}
	_, err := handler.Execute(context.Background(), takeoverPayload(false))
	if err == nil || !strings.Contains(err.Error(), "WARP_TAKEOVER_CONFIRMATION_REQUIRED") {
		t.Fatalf("expected explicit confirmation failure, got %v", err)
	}
}

func takeoverPayload(attested bool) json.RawMessage {
	payload, _ := json.Marshal(TakeoverRequest{
		PlanID:            testPlanID,
		Decision:          TakeoverDecision,
		AttestNo3XUIUsage: attested,
	})
	return payload
}
