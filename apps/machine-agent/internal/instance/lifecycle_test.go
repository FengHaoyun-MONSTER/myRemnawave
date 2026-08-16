// SPDX-License-Identifier: AGPL-3.0-only

package instance

import (
	"context"
	"encoding/json"
	"testing"
)

func TestLifecycleRejectsUnknownPayloadFields(t *testing.T) {
	handler := LifecycleHandler{Start: true, Runner: &fakeRunner{}}
	_, err := handler.Execute(context.Background(), json.RawMessage(`{"instanceId":"123e4567-e89b-42d3-a456-426614174000","command":"rm"}`))
	if err == nil {
		t.Fatal("expected strict payload validation")
	}
}
