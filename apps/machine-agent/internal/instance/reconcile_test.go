// SPDX-License-Identifier: AGPL-3.0-only

package instance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type fakeRunner struct {
	calls [][]string
}

type fakePortProbe struct {
	available map[uint16]bool
}

func (f fakePortProbe) Available(_ context.Context, _ string, port uint16) (bool, string) {
	if f.available[port] {
		return true, "available"
	}
	return false, "occupied"
}

type ownershipRunner struct {
	calls  [][]string
	labels string
}

type bindRaceRunner struct {
	calls       [][]string
	runAttempts int
	failedTwice bool
	created     bool
}

func (f *bindRaceRunner) Run(_ context.Context, arguments ...string) ([]byte, error) {
	f.calls = append(f.calls, append([]string(nil), arguments...))
	if len(arguments) >= 2 && arguments[0] == "network" && arguments[1] == "inspect" {
		return nil, errors.New("not found")
	}
	if len(arguments) > 0 && arguments[0] == "inspect" {
		if !f.created {
			return nil, errors.New("not found")
		}
		return []byte(`{"io.myremnawave.managed":"true","io.myremnawave.instance":"123e4567-e89b-42d3-a456-426614174000","io.myremnawave.machine":"123e4567-e89b-42d3-a456-426614174999"}`), nil
	}
	if len(arguments) > 0 && arguments[0] == "run" {
		f.runAttempts++
		if f.runAttempts == 1 || f.failedTwice {
			f.created = true
			return []byte("Bind for 0.0.0.0 failed: port is already allocated"), errors.New("docker run failed")
		}
		return []byte("container-id"), nil
	}
	if len(arguments) > 0 && arguments[0] == "rm" {
		f.created = false
	}
	return []byte("ok"), nil
}

func (f *ownershipRunner) Run(_ context.Context, arguments ...string) ([]byte, error) {
	f.calls = append(f.calls, append([]string(nil), arguments...))
	if len(arguments) >= 2 && arguments[0] == "network" && arguments[1] == "inspect" {
		return nil, errors.New("not found")
	}
	if len(arguments) > 0 && arguments[0] == "inspect" {
		return []byte(f.labels), nil
	}
	return []byte("ok"), nil
}

func (f *fakeRunner) Run(_ context.Context, arguments ...string) ([]byte, error) {
	f.calls = append(f.calls, append([]string(nil), arguments...))
	if len(arguments) >= 2 && arguments[0] == "network" && arguments[1] == "inspect" {
		return nil, errors.New("not found")
	}
	if len(arguments) > 0 && arguments[0] == "inspect" {
		return nil, errors.New("not found")
	}
	return []byte("ok"), nil
}

func TestReconcileRealityInstance(t *testing.T) {
	root := t.TempDir()
	runner := &fakeRunner{}
	request := Request{
		InstanceID:   "123e4567-e89b-42d3-a456-426614174000",
		Protocol:     "VLESS_REALITY",
		Image:        "remnawave/node@sha256:" + strings.Repeat("a", 64),
		ControlPort:  2222,
		ExternalPort: 443,
		Network:      "tcp",
		SecretKey:    strings.Repeat("A", 120),
	}
	payload, _ := json.Marshal(request)
	resultRaw, err := (Handler{
		ManagedRoot: root,
		MachineID:   "123e4567-e89b-42d3-a456-426614174999",
		Runner:      runner,
		Probe:       fakePortProbe{available: map[uint16]bool{443: true}},
	}).Execute(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	result := resultRaw.(Result)
	if result.RealityPublicKey == "" || len(result.RealityShortID) != 16 {
		t.Fatalf("Reality material was not returned: %#v", result)
	}
	envPath := filepath.Join(root, "instances", request.InstanceID, "node.env")
	info, err := os.Stat(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("node.env permissions = %o", info.Mode().Perm())
	}
	for _, call := range runner.calls {
		joined := strings.Join(call, " ")
		if strings.Contains(joined, request.SecretKey) {
			t.Fatal("secret key leaked into docker process arguments")
		}
	}
}

func TestReconcileSelectsFirstAvailableFallbackBeforeMutation(t *testing.T) {
	root := t.TempDir()
	runner := &fakeRunner{}
	request := Request{
		InstanceID:    "123e4567-e89b-42d3-a456-426614174000",
		Protocol:      "VLESS_REALITY",
		Image:         "remnawave/node@sha256:" + strings.Repeat("a", 64),
		ControlPort:   2222,
		ExternalPort:  443,
		FallbackPorts: []uint16{8443, 2053},
		Network:       "tcp",
		SecretKey:     strings.Repeat("A", 120),
	}
	payload, _ := json.Marshal(request)
	resultRaw, err := (Handler{
		ManagedRoot: root,
		MachineID:   "123e4567-e89b-42d3-a456-426614174999",
		Runner:      runner,
		Probe:       fakePortProbe{available: map[uint16]bool{2053: true}},
	}).Execute(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	result := resultRaw.(Result)
	if result.ExternalPort != 2053 {
		t.Fatalf("selected port = %d, want 2053", result.ExternalPort)
	}
	var published bool
	for _, call := range runner.calls {
		if strings.Contains(strings.Join(call, " "), "2053:2053/tcp") {
			published = true
		}
	}
	if !published {
		t.Fatal("fallback port was not used by docker run")
	}
}

func TestReconcileStopsBeforeMutationWhenPortPoolIsExhausted(t *testing.T) {
	root := t.TempDir()
	runner := &fakeRunner{}
	request := Request{
		InstanceID:    "123e4567-e89b-42d3-a456-426614174000",
		Protocol:      "VLESS_REALITY",
		Image:         "remnawave/node@sha256:" + strings.Repeat("a", 64),
		ControlPort:   2222,
		ExternalPort:  443,
		FallbackPorts: []uint16{8443},
		Network:       "tcp",
		SecretKey:     strings.Repeat("A", 120),
	}
	payload, _ := json.Marshal(request)
	_, err := (Handler{
		ManagedRoot: root,
		MachineID:   "123e4567-e89b-42d3-a456-426614174999",
		Runner:      runner,
		Probe:       fakePortProbe{available: map[uint16]bool{}},
	}).Execute(context.Background(), payload)
	if err == nil || !strings.Contains(err.Error(), "PORT_POOL_EXHAUSTED") {
		t.Fatalf("expected PORT_POOL_EXHAUSTED, got %v", err)
	}
	if len(runner.calls) != 1 || runner.calls[0][0] != "inspect" {
		t.Fatalf("unexpected docker mutation before resource validation: %v", runner.calls)
	}
	if _, statErr := os.Stat(filepath.Join(root, "instances", request.InstanceID)); !os.IsNotExist(statErr) {
		t.Fatalf("instance directory was created before resource validation: %v", statErr)
	}
}

func TestReconcileRetriesOnePortAfterDockerBindRace(t *testing.T) {
	runner := &bindRaceRunner{}
	request := Request{
		InstanceID:    "123e4567-e89b-42d3-a456-426614174000",
		Protocol:      "VLESS_REALITY",
		Image:         "remnawave/node@sha256:" + strings.Repeat("a", 64),
		ControlPort:   2222,
		ExternalPort:  443,
		FallbackPorts: []uint16{8443, 2053},
		Network:       "tcp",
		SecretKey:     strings.Repeat("A", 120),
	}
	payload, _ := json.Marshal(request)
	resultValue, err := (Handler{
		ManagedRoot: t.TempDir(),
		MachineID:   "123e4567-e89b-42d3-a456-426614174999",
		Runner:      runner,
		Probe:       fakePortProbe{available: map[uint16]bool{443: true, 8443: true}},
	}).Execute(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	result := resultValue.(Result)
	if result.ExternalPort != 8443 || runner.runAttempts != 2 {
		t.Fatalf("unexpected bounded replan result: %#v, attempts=%d", result, runner.runAttempts)
	}
}

func TestReconcileStopsAfterOneDockerBindRaceRetry(t *testing.T) {
	runner := &bindRaceRunner{failedTwice: true}
	request := Request{
		InstanceID:    "123e4567-e89b-42d3-a456-426614174000",
		Protocol:      "VLESS_REALITY",
		Image:         "remnawave/node@sha256:" + strings.Repeat("a", 64),
		ControlPort:   2222,
		ExternalPort:  443,
		FallbackPorts: []uint16{8443, 2053},
		Network:       "tcp",
		SecretKey:     strings.Repeat("A", 120),
	}
	payload, _ := json.Marshal(request)
	_, err := (Handler{
		ManagedRoot: t.TempDir(),
		MachineID:   "123e4567-e89b-42d3-a456-426614174999",
		Runner:      runner,
		Probe:       fakePortProbe{available: map[uint16]bool{443: true, 8443: true, 2053: true}},
	}).Execute(context.Background(), payload)
	if err == nil || !strings.Contains(err.Error(), "PORT_BIND_RACE_EXHAUSTED") {
		t.Fatalf("expected bounded bind-race failure, got %v", err)
	}
	if runner.runAttempts != 2 {
		t.Fatalf("docker run attempts = %d, want exactly 2", runner.runAttempts)
	}
}

func TestRejectsUnpinnedImage(t *testing.T) {
	request := Request{
		InstanceID:   "123e4567-e89b-42d3-a456-426614174000",
		Protocol:     "VLESS_REALITY",
		Image:        "remnawave/node:latest",
		ControlPort:  2222,
		ExternalPort: 443,
		Network:      "tcp",
		SecretKey:    strings.Repeat("A", 120),
	}
	if err := validate(request); err == nil {
		t.Fatal("expected unpinned image to be rejected")
	}
}

func TestRejectsReservedControlPortAsExternalCandidate(t *testing.T) {
	request := Request{
		InstanceID:   "123e4567-e89b-42d3-a456-426614174000",
		Protocol:     "VLESS_REALITY",
		Image:        "remnawave/node@sha256:" + strings.Repeat("a", 64),
		ControlPort:  2222,
		ExternalPort: 2223,
		Network:      "tcp",
		SecretKey:    strings.Repeat("A", 120),
	}
	if err := validate(request); err == nil {
		t.Fatal("expected reserved control port to be rejected")
	}
}

func TestReconcileRefusesSameNameForeignContainer(t *testing.T) {
	runner := &ownershipRunner{labels: `{"io.myremnawave.managed":"true","io.myremnawave.instance":"123e4567-e89b-42d3-a456-426614174000","io.myremnawave.machine":"foreign-machine"}`}
	request := Request{
		InstanceID:   "123e4567-e89b-42d3-a456-426614174000",
		Protocol:     "VLESS_REALITY",
		Image:        "remnawave/node@sha256:" + strings.Repeat("a", 64),
		ControlPort:  2222,
		ExternalPort: 443,
		Network:      "tcp",
		SecretKey:    strings.Repeat("A", 120),
	}
	payload, _ := json.Marshal(request)
	_, err := (Handler{
		ManagedRoot: t.TempDir(),
		MachineID:   "123e4567-e89b-42d3-a456-426614174999",
		Runner:      runner,
	}).Execute(context.Background(), payload)
	if err == nil || !strings.Contains(err.Error(), "OWNERSHIP_CONFLICT") {
		t.Fatalf("expected ownership conflict, got %v", err)
	}
	for _, call := range runner.calls {
		if len(call) > 0 && (call[0] == "stop" || call[0] == "rm") {
			t.Fatalf("foreign container was mutated: %v", call)
		}
	}
}

func TestReconcileStartsMatchingManagedContainerWithoutReplacingIt(t *testing.T) {
	request := Request{
		InstanceID:   "123e4567-e89b-42d3-a456-426614174000",
		Protocol:     "VLESS_REALITY",
		Image:        "remnawave/node@sha256:" + strings.Repeat("a", 64),
		ControlPort:  2222,
		ExternalPort: 443,
		Network:      "tcp",
		SecretKey:    strings.Repeat("A", 120),
	}
	machineID := "123e4567-e89b-42d3-a456-426614174999"
	runner := &ownershipRunner{labels: fmt.Sprintf(
		`{"io.myremnawave.managed":"true","io.myremnawave.instance":%q,"io.myremnawave.machine":%q,"io.myremnawave.config-sha256":%q}`,
		request.InstanceID,
		machineID,
		desiredHash(request),
	)}
	payload, _ := json.Marshal(request)
	_, err := (Handler{ManagedRoot: t.TempDir(), MachineID: machineID, Runner: runner}).Execute(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	var started bool
	for _, call := range runner.calls {
		if len(call) > 0 && call[0] == "start" {
			started = true
		}
		if len(call) > 0 && (call[0] == "stop" || call[0] == "rm" || call[0] == "run") {
			t.Fatalf("matching container was replaced: %v", call)
		}
	}
	if !started {
		t.Fatal("matching managed container was not started")
	}
}
