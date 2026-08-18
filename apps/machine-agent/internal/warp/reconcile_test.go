// SPDX-License-Identifier: AGPL-3.0-only

package warp

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

const testMachineID = "123e4567-e89b-42d3-a456-426614174999"

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

func TestDisconnectedStatusIsNotAccepted(t *testing.T) {
	if statusConnected("Status update: Disconnected") {
		t.Fatal("disconnected status must not be treated as connected")
	}
}

func TestSupportedPlatforms(t *testing.T) {
	tests := []struct {
		name      string
		osID      string
		codename  string
		supported bool
	}{
		{name: "Debian 12", osID: "debian", codename: "bookworm", supported: true},
		{name: "Debian 13", osID: "debian", codename: "trixie", supported: true},
		{name: "Ubuntu 22.04", osID: "ubuntu", codename: "jammy", supported: true},
		{name: "Ubuntu 24.04", osID: "ubuntu", codename: "noble", supported: true},
		{name: "reject mismatched distro and codename", osID: "ubuntu", codename: "trixie", supported: false},
		{name: "reject unsupported distro", osID: "alpine", codename: "", supported: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isSupportedPlatform(test.osID, test.codename); got != test.supported {
				t.Fatalf("isSupportedPlatform(%q, %q) = %v, want %v", test.osID, test.codename, got, test.supported)
			}
		})
	}
}

func TestHandlerRejectsUnmanagedProxyPort(t *testing.T) {
	handler := NewHandler(t.TempDir(), testMachineID)
	_, err := handler.Execute(context.Background(), json.RawMessage(`{"enabled":true,"proxyPort":1080,"mode":"REUSE_EXTERNAL"}`))
	if err == nil || !strings.Contains(err.Error(), "40000") {
		t.Fatalf("expected managed port validation, got %v", err)
	}
}

type compatibleExternalRunner struct {
	calls [][]string
}

func (r *compatibleExternalRunner) Run(_ context.Context, name string, arguments ...string) ([]byte, error) {
	r.calls = append(r.calls, append([]string{name}, arguments...))
	joined := strings.Join(append([]string{name}, arguments...), " ")
	switch {
	case strings.Contains(joined, "registration show"):
		return []byte("Account type: Free"), nil
	case strings.Contains(joined, "settings"):
		return []byte("Mode: Proxy\nProxy Port: 40000"), nil
	case strings.Contains(joined, "status"):
		return []byte("Status update: Connected"), nil
	case strings.Contains(joined, "--version"):
		return []byte("warp-cli 2026.1"), nil
	case strings.Contains(joined, "docker network inspect"):
		return []byte("172.30.0.1"), nil
	default:
		return []byte("ok"), nil
	}
}

func TestCompatibleExternalWarpIsReusedWithoutMutation(t *testing.T) {
	runner := &compatibleExternalRunner{}
	handler := &Handler{
		ManagedRoot: t.TempDir(),
		MachineID:   testMachineID,
		Runner:      runner,
		LookupPath:  func(string) (string, error) { return "/usr/bin/warp-cli", nil },
		Relay:       func(context.Context, uint16) error { return nil },
	}
	payload := json.RawMessage(`{"enabled":true,"proxyPort":40000,"mode":"REUSE_EXTERNAL"}`)
	resultRaw, err := handler.Execute(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	result := resultRaw.(Result)
	if result.Ownership != "EXTERNAL" || result.Status != "CONNECTED" {
		t.Fatalf("unexpected result: %#v", result)
	}
	for _, call := range runner.calls {
		joined := strings.Join(call, " ")
		if strings.Contains(joined, "--accept-tos") || strings.Contains(joined, "systemctl") || strings.Contains(joined, " mode ") || strings.Contains(joined, " connect") || strings.Contains(joined, "registration new") {
			t.Fatalf("external WARP was mutated: %s", joined)
		}
	}
}

func TestMissingWarpDoesNotOverwriteForeignOwnership(t *testing.T) {
	root := t.TempDir()
	if err := writeOwnership(root, Ownership{
		Version:   1,
		MachineID: "123e4567-e89b-42d3-a456-426614174998",
		State:     "MANAGED",
	}); err != nil {
		t.Fatalf("write foreign ownership: %v", err)
	}
	handler := &Handler{
		ManagedRoot: root,
		MachineID:   testMachineID,
		LookupPath:  func(string) (string, error) { return "", errors.New("not found") },
		Detect3XUI:  func(context.Context) (bool, string, error) { return false, "not detected", nil },
	}
	payload := json.RawMessage(`{"enabled":true,"proxyPort":40000,"mode":"INSTALL_OR_REPAIR_MANAGED"}`)
	_, err := handler.Execute(context.Background(), payload)
	if err == nil || !strings.Contains(err.Error(), "WARP_OWNED_BY_ANOTHER_MACHINE") {
		t.Fatalf("expected foreign ownership refusal, got %v", err)
	}
	ownership, readErr := ReadOwnership(root)
	if readErr != nil || ownership.MachineID == testMachineID {
		t.Fatalf("foreign ownership was changed: %#v, %v", ownership, readErr)
	}
}

func TestManagedRepairRefusesExistingUnownedWarp(t *testing.T) {
	runner := &compatibleExternalRunner{}
	handler := &Handler{
		ManagedRoot: t.TempDir(),
		MachineID:   testMachineID,
		Runner:      runner,
		LookupPath:  func(string) (string, error) { return "/usr/bin/warp-cli", nil },
		Detect3XUI:  func(context.Context) (bool, string, error) { return false, "not detected", nil },
	}
	payload := json.RawMessage(`{"enabled":true,"proxyPort":40000,"mode":"INSTALL_OR_REPAIR_MANAGED"}`)
	_, err := handler.Execute(context.Background(), payload)
	if err == nil || !strings.Contains(err.Error(), "WARP_TAKEOVER_REQUIRED") {
		t.Fatalf("expected ownership blocker, got %v", err)
	}
}

func TestManagedWarpMutationRefusesDetected3XUIBeforeAnyCommand(t *testing.T) {
	runner := &compatibleExternalRunner{}
	handler := &Handler{
		ManagedRoot: t.TempDir(),
		MachineID:   testMachineID,
		Runner:      runner,
		Detect3XUI: func(context.Context) (bool, string, error) {
			return true, "x-ui.service is installed", nil
		},
	}
	payload := json.RawMessage(`{"enabled":true,"proxyPort":40000,"mode":"INSTALL_OR_REPAIR_MANAGED"}`)

	_, err := handler.Execute(context.Background(), payload)
	if err == nil || !strings.Contains(err.Error(), "WARP_MUTATION_FORBIDDEN_3XUI") {
		t.Fatalf("expected 3X-UI mutation refusal, got %v", err)
	}
	if len(runner.calls) != 0 {
		t.Fatalf("WARP commands ran before refusal: %#v", runner.calls)
	}
}

func TestRelayRejectsInvalidDockerGateway(t *testing.T) {
	handler := &Handler{ManagedRoot: t.TempDir(), Runner: fakeRunner{output: []byte("0.0.0.0\n")}}
	err := handler.ensureRelay(context.Background(), 40000)
	if err == nil {
		t.Fatal("expected Docker network inspection failure")
	}
}
