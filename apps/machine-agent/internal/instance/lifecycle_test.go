// SPDX-License-Identifier: AGPL-3.0-only

package instance

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestLifecycleRejectsUnknownPayloadFields(t *testing.T) {
	handler := LifecycleHandler{Start: true, Runner: &fakeRunner{}}
	_, err := handler.Execute(context.Background(), json.RawMessage(`{"instanceId":"123e4567-e89b-42d3-a456-426614174000","command":"rm"}`))
	if err == nil {
		t.Fatal("expected strict payload validation")
	}
}

func TestLifecycleRefusesForeignContainer(t *testing.T) {
	runner := &ownershipRunner{labels: `{"io.myremnawave.managed":"true","io.myremnawave.instance":"123e4567-e89b-42d3-a456-426614174000","io.myremnawave.machine":"foreign-machine"}`}
	handler := LifecycleHandler{
		Start:     false,
		MachineID: "123e4567-e89b-42d3-a456-426614174999",
		Runner:    runner,
	}
	_, err := handler.Execute(context.Background(), json.RawMessage(`{"instanceId":"123e4567-e89b-42d3-a456-426614174000"}`))
	if err == nil || !strings.Contains(err.Error(), "OWNERSHIP_CONFLICT") {
		t.Fatalf("expected ownership conflict, got %v", err)
	}
	for _, call := range runner.calls {
		if len(call) > 0 && (call[0] == "start" || call[0] == "stop") {
			t.Fatalf("foreign container was mutated: %v", call)
		}
	}
}

func TestLifecycleStopsMatchingManagedContainer(t *testing.T) {
	instanceID := "123e4567-e89b-42d3-a456-426614174000"
	machineID := "123e4567-e89b-42d3-a456-426614174999"
	runner := &ownershipRunner{labels: `{"io.myremnawave.managed":"true","io.myremnawave.instance":"` + instanceID + `","io.myremnawave.machine":"` + machineID + `"}`}
	handler := LifecycleHandler{Start: false, MachineID: machineID, Runner: runner}
	_, err := handler.Execute(context.Background(), json.RawMessage(`{"instanceId":"`+instanceID+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, call := range runner.calls {
		if len(call) > 0 && call[0] == "stop" {
			return
		}
	}
	t.Fatal("matching managed container was not stopped")
}
