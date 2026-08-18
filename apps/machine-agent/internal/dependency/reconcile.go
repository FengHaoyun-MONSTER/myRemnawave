// SPDX-License-Identifier: AGPL-3.0-only

package dependency

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type Request struct {
	Name   string `json:"name"`
	Action string `json:"action"`
}

type Result struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Version string `json:"version"`
}

type Ownership struct {
	Version   int    `json:"version"`
	MachineID string `json:"machineId"`
	State     string `json:"state"`
}

type Runner interface {
	Run(ctx context.Context, name string, arguments ...string) ([]byte, error)
}

type CommandRunner struct{}

func (CommandRunner) Run(ctx context.Context, name string, arguments ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, arguments...).CombinedOutput()
}

type Handler struct {
	ManagedRoot string
	MachineID   string
	Runner      Runner
	LookupPath  func(string) (string, error)
	ReadFile    func(string) ([]byte, error)
	Lstat       func(string) (os.FileInfo, error)
}

func (h Handler) Execute(ctx context.Context, payload json.RawMessage) (any, error) {
	request, err := decode(payload)
	if err != nil {
		return nil, err
	}
	if request.Name != "docker" || request.Action != "INSTALL_IF_MISSING" {
		return nil, errors.New("INVALID_DEPENDENCY_ACTION: only docker INSTALL_IF_MISSING is supported")
	}
	if !uuidPattern.MatchString(h.MachineID) {
		return nil, errors.New("INVALID_MACHINE_ID: Machine ownership identity is invalid")
	}
	lookup := h.LookupPath
	if lookup == nil {
		lookup = exec.LookPath
	}
	if _, lookupErr := lookup("docker"); lookupErr == nil {
		version, versionErr := h.dockerVersion(ctx)
		if versionErr == nil {
			status := "REUSED_EXTERNAL"
			if ownership, ownershipErr := ReadOwnership(h.ManagedRoot); ownershipErr == nil && ownership.MachineID == h.MachineID {
				status = "REUSED_MANAGED"
			}
			return Result{Name: "docker", Status: status, Version: version}, nil
		}
		ownership, ownershipErr := ReadOwnership(h.ManagedRoot)
		if ownershipErr != nil || ownership.MachineID != h.MachineID {
			return nil, fmt.Errorf("DOCKER_UNHEALTHY_EXTERNAL: %w", versionErr)
		}
		if _, err := h.run(ctx, "systemctl", "enable", "--now", "docker"); err != nil {
			return nil, fmt.Errorf("DOCKER_MANAGED_REPAIR_FAILED: %w", err)
		}
		version, err = h.dockerVersion(ctx)
		if err != nil {
			return nil, fmt.Errorf("DOCKER_MANAGED_REPAIR_FAILED: %w", err)
		}
		ownership.State = "MANAGED"
		if err := writeOwnership(h.ManagedRoot, ownership); err != nil {
			return nil, err
		}
		return Result{Name: "docker", Status: "REPAIRED_MANAGED", Version: version}, nil
	}

	readFile := h.ReadFile
	if readFile == nil {
		readFile = os.ReadFile
	}
	osRelease, err := readFile("/etc/os-release")
	if err != nil {
		return nil, errors.New("DOCKER_INSTALL_UNSUPPORTED: /etc/os-release is unavailable")
	}
	osID := osReleaseValue(string(osRelease), "ID")
	versionID := osReleaseValue(string(osRelease), "VERSION_ID")
	if !supportedOS(osID, versionID) {
		return nil, fmt.Errorf("DOCKER_INSTALL_UNSUPPORTED: unsupported operating system %s %s", osID, versionID)
	}
	ownership := Ownership{Version: 1, MachineID: h.MachineID, State: "INSTALLING"}
	existingOwnership, ownershipErr := ReadOwnership(h.ManagedRoot)
	if ownershipErr == nil {
		if existingOwnership.MachineID != h.MachineID {
			return nil, errors.New("DOCKER_OWNED_BY_ANOTHER_MACHINE: ownership cannot be replaced")
		}
		ownership = existingOwnership
	} else if !errors.Is(ownershipErr, os.ErrNotExist) {
		return nil, fmt.Errorf("DOCKER_OWNERSHIP_UNSAFE: %w", ownershipErr)
	} else {
		lstat := h.Lstat
		if lstat == nil {
			lstat = os.Lstat
		}
		if dockerRuntimePresent(lookup, lstat) {
			return nil, errors.New("DOCKER_UNHEALTHY_EXTERNAL: Docker runtime indicators exist without an owned CLI")
		}
		if err := createOwnership(h.ManagedRoot, ownership); err != nil {
			return nil, err
		}
	}
	if _, err := h.run(ctx, "apt-get", "update"); err != nil {
		return nil, fmt.Errorf("DOCKER_INSTALL_FAILED: %w", err)
	}
	packages := []string{"install", "--assume-yes", "--no-install-recommends", "docker.io"}
	if osID == "debian" && versionID == "13" {
		packages = append(packages, "docker-cli")
	}
	if _, err := h.run(ctx, "apt-get", packages...); err != nil {
		return nil, fmt.Errorf("DOCKER_INSTALL_FAILED: %w", err)
	}
	if _, err := h.run(ctx, "systemctl", "enable", "--now", "docker"); err != nil {
		return nil, fmt.Errorf("DOCKER_INSTALL_FAILED: %w", err)
	}
	if _, err := lookup("docker"); err != nil {
		return nil, errors.New("DOCKER_INSTALL_FAILED: docker command is unavailable after installation")
	}
	version, err := h.dockerVersion(ctx)
	if err != nil {
		return nil, fmt.Errorf("DOCKER_INSTALL_FAILED: %w", err)
	}
	ownership.State = "MANAGED"
	if err := writeOwnership(h.ManagedRoot, ownership); err != nil {
		return nil, err
	}
	return Result{Name: "docker", Status: "INSTALLED_MANAGED", Version: version}, nil
}

func dockerRuntimePresent(lookup func(string) (string, error), lstat func(string) (os.FileInfo, error)) bool {
	if _, err := lookup("dockerd"); err == nil {
		return true
	}
	_, err := lstat("/var/run/docker.sock")
	return err == nil || !errors.Is(err, os.ErrNotExist)
}

func (h Handler) dockerVersion(ctx context.Context) (string, error) {
	output, err := h.run(ctx, "docker", "version", "--format", "{{.Client.Version}}|{{.Server.Version}}")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

func (h Handler) run(ctx context.Context, name string, arguments ...string) ([]byte, error) {
	runner := h.Runner
	if runner == nil {
		runner = CommandRunner{}
	}
	output, err := runner.Run(ctx, name, arguments...)
	if err == nil {
		return output, nil
	}
	message := strings.TrimSpace(string(output))
	if len(message) > 1024 {
		message = message[:1024]
	}
	if message == "" {
		message = err.Error()
	}
	return output, errors.New(message)
}

func decode(payload json.RawMessage) (Request, error) {
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	var request Request
	if err := decoder.Decode(&request); err != nil {
		return Request{}, fmt.Errorf("INVALID_DEPENDENCY_ACTION: %w", err)
	}
	return request, nil
}

func ReadOwnership(root string) (Ownership, error) {
	var ownership Ownership
	if !filepath.IsAbs(root) {
		return ownership, errors.New("managed root must be absolute")
	}
	path := filepath.Join(filepath.Clean(root), "dependencies", "docker.json")
	info, err := os.Lstat(path)
	if err != nil {
		return ownership, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return ownership, errors.New("Docker ownership path is unsafe")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return ownership, err
	}
	decoder := json.NewDecoder(strings.NewReader(string(content)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&ownership); err != nil {
		return Ownership{}, err
	}
	if ownership.Version != 1 || !uuidPattern.MatchString(ownership.MachineID) || (ownership.State != "INSTALLING" && ownership.State != "MANAGED") {
		return Ownership{}, errors.New("Docker ownership record is invalid")
	}
	return ownership, nil
}

func writeOwnership(root string, ownership Ownership) error {
	if !filepath.IsAbs(root) {
		return errors.New("managed root must be absolute")
	}
	directory := filepath.Join(filepath.Clean(root), "dependencies")
	if err := secureDirectory(filepath.Clean(root)); err != nil {
		return err
	}
	if err := secureDirectory(directory); err != nil {
		return err
	}
	content, err := json.Marshal(ownership)
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".docker-ownership-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	target := filepath.Join(directory, "docker.json")
	if info, err := os.Lstat(target); err == nil && (info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular()) {
		return errors.New("Docker ownership path is unsafe")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.Rename(name, target)
}

func createOwnership(root string, ownership Ownership) error {
	if !filepath.IsAbs(root) {
		return errors.New("managed root must be absolute")
	}
	directory := filepath.Join(filepath.Clean(root), "dependencies")
	if err := secureDirectory(filepath.Clean(root)); err != nil {
		return err
	}
	if err := secureDirectory(directory); err != nil {
		return err
	}
	content, err := json.Marshal(ownership)
	if err != nil {
		return err
	}
	target := filepath.Join(directory, "docker.json")
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.Write(content); err != nil {
		file.Close()
		os.Remove(target)
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		os.Remove(target)
		return err
	}
	return file.Close()
}

func secureDirectory(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(path, 0o700); err != nil {
			return err
		}
		info, err = os.Lstat(path)
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return errors.New("managed dependency path must be a real directory")
	}
	return os.Chmod(path, 0o700)
}

func osReleaseValue(content, key string) string {
	pattern := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(key) + `=(?:"([^"]+)"|([^\n]+))$`)
	match := pattern.FindStringSubmatch(content)
	if len(match) == 0 {
		return ""
	}
	if match[1] != "" {
		return match[1]
	}
	return strings.TrimSpace(match[2])
}

func supportedOS(id, version string) bool {
	return (id == "debian" && (version == "12" || version == "13")) ||
		(id == "ubuntu" && (strings.HasPrefix(version, "22.04") || strings.HasPrefix(version, "24.04")))
}
