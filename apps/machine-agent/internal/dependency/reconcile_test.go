// SPDX-License-Identifier: AGPL-3.0-only

package dependency

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type fakeRunner struct {
	calls [][]string
}

func (f *fakeRunner) Run(_ context.Context, name string, arguments ...string) ([]byte, error) {
	f.calls = append(f.calls, append([]string{name}, arguments...))
	if name == "docker" {
		return []byte("26.1.5|26.1.5"), nil
	}
	return []byte("ok"), nil
}

func TestReusesHealthyExternalDockerWithoutMutation(t *testing.T) {
	runner := &fakeRunner{}
	payload, _ := json.Marshal(Request{Name: "docker", Action: "INSTALL_IF_MISSING"})
	resultRaw, err := (Handler{
		ManagedRoot: t.TempDir(),
		MachineID:   "123e4567-e89b-42d3-a456-426614174999",
		Runner:      runner,
		LookupPath: func(name string) (string, error) {
			return "/usr/bin/" + name, nil
		},
	}).Execute(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	result := resultRaw.(Result)
	if result.Status != "REUSED_EXTERNAL" {
		t.Fatalf("status = %q", result.Status)
	}
	if len(runner.calls) != 1 || runner.calls[0][0] != "docker" {
		t.Fatalf("external Docker was mutated: %v", runner.calls)
	}
}

func TestInstallsDebian13DockerCLIAndDaemonOnlyWhenAbsent(t *testing.T) {
	runner := &fakeRunner{}
	lookups := 0
	payload, _ := json.Marshal(Request{Name: "docker", Action: "INSTALL_IF_MISSING"})
	resultRaw, err := (Handler{
		ManagedRoot: t.TempDir(),
		MachineID:   "123e4567-e89b-42d3-a456-426614174999",
		Runner:      runner,
		LookupPath: func(name string) (string, error) {
			if name == "dockerd" {
				return "", errors.New("missing")
			}
			lookups++
			if lookups == 1 {
				return "", errors.New("missing")
			}
			return "/usr/bin/" + name, nil
		},
		ReadFile: func(path string) ([]byte, error) {
			if path != "/etc/os-release" {
				t.Fatalf("unexpected read %s", path)
			}
			return []byte("ID=debian\nVERSION_ID=\"13\"\n"), nil
		},
		Lstat: func(path string) (os.FileInfo, error) {
			if path != "/var/run/docker.sock" {
				t.Fatalf("unexpected lstat %s", path)
			}
			return nil, os.ErrNotExist
		},
	}).Execute(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	result := resultRaw.(Result)
	if result.Status != "INSTALLED_MANAGED" {
		t.Fatalf("status = %q", result.Status)
	}
	joined := make([]string, 0, len(runner.calls))
	for _, call := range runner.calls {
		joined = append(joined, strings.Join(call, " "))
	}
	if !contains(joined, "apt-get install --assume-yes --no-install-recommends docker.io docker-cli") {
		t.Fatalf("Debian 13 package command missing: %v", joined)
	}
	if !contains(joined, "systemctl enable --now docker") {
		t.Fatalf("newly installed Docker was not started: %v", joined)
	}
}

func TestMissingDockerCLIDoesNotOverwriteForeignOwnership(t *testing.T) {
	root := t.TempDir()
	if err := writeOwnership(root, Ownership{
		Version:   1,
		MachineID: "123e4567-e89b-42d3-a456-426614174998",
		State:     "MANAGED",
	}); err != nil {
		t.Fatalf("write foreign ownership: %v", err)
	}
	payload, _ := json.Marshal(Request{Name: "docker", Action: "INSTALL_IF_MISSING"})
	_, err := (Handler{
		ManagedRoot: root,
		MachineID:   "123e4567-e89b-42d3-a456-426614174999",
		LookupPath:  func(string) (string, error) { return "", errors.New("missing") },
		ReadFile: func(string) ([]byte, error) {
			return []byte("ID=debian\nVERSION_ID=13\n"), nil
		},
	}).Execute(context.Background(), payload)
	if err == nil || !strings.Contains(err.Error(), "DOCKER_OWNED_BY_ANOTHER_MACHINE") {
		t.Fatalf("expected foreign ownership refusal, got %v", err)
	}
	ownership, readErr := ReadOwnership(root)
	if readErr != nil || ownership.MachineID == "123e4567-e89b-42d3-a456-426614174999" {
		t.Fatalf("foreign ownership was changed: %#v, %v", ownership, readErr)
	}
}

func TestRefusesToRepairUnhealthyExternalDocker(t *testing.T) {
	runner := &errorRunner{}
	payload, _ := json.Marshal(Request{Name: "docker", Action: "INSTALL_IF_MISSING"})
	_, err := (Handler{
		ManagedRoot: t.TempDir(),
		MachineID:   "123e4567-e89b-42d3-a456-426614174999",
		Runner:      runner,
		LookupPath:  func(string) (string, error) { return "/usr/bin/docker", nil },
	}).Execute(context.Background(), payload)
	if err == nil || !strings.Contains(err.Error(), "DOCKER_UNHEALTHY_EXTERNAL") {
		t.Fatalf("expected external ownership blocker, got %v", err)
	}
	if len(runner.calls) != 1 {
		t.Fatalf("external Docker was mutated: %v", runner.calls)
	}
}

type errorRunner struct {
	calls [][]string
}

func (f *errorRunner) Run(_ context.Context, name string, arguments ...string) ([]byte, error) {
	f.calls = append(f.calls, append([]string{name}, arguments...))
	return []byte("daemon unavailable"), errors.New("exit 1")
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func TestOwnershipFileIsPrivate(t *testing.T) {
	root := t.TempDir()
	if err := writeOwnership(root, Ownership{Version: 1, MachineID: "123e4567-e89b-42d3-a456-426614174999", State: "MANAGED"}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(root, "dependencies", "docker.json"))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("ownership mode = %o", info.Mode().Perm())
	}
}
