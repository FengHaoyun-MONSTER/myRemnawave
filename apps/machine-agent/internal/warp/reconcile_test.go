// SPDX-License-Identifier: AGPL-3.0-only

package warp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type fakeRunner struct {
	output []byte
	err    error
}

func (r fakeRunner) Run(_ context.Context, _ string, _ ...string) ([]byte, error) {
	return r.output, r.err
}

func TestParseOSRelease(t *testing.T) {
	content := "ID=ubuntu\nVERSION_CODENAME=\"noble\"\n"
	if got := parseOSRelease(content, "VERSION_CODENAME"); got != "noble" {
		t.Fatalf("codename = %q", got)
	}
}

func TestHandlerRejectsUnmanagedProxyPort(t *testing.T) {
	handler := NewHandler(t.TempDir())
	_, err := handler.Execute(context.Background(), json.RawMessage(`{"enabled":true,"proxyPort":1080}`))
	if err == nil || !strings.Contains(err.Error(), "40000") {
		t.Fatalf("expected managed port validation, got %v", err)
	}
}

func TestRelayRejectsInvalidDockerGateway(t *testing.T) {
	handler := &Handler{ManagedRoot: t.TempDir(), Runner: fakeRunner{output: []byte("0.0.0.0\n")}}
	err := handler.ensureRelay(context.Background(), 40000)
	if err == nil {
		t.Fatal("expected Docker network inspection failure")
	}
}
