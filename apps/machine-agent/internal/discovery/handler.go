// SPDX-License-Identifier: AGPL-3.0-only

package discovery

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/inventory"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/protocol"
)

const (
	minimumMemoryBytes   = 1 << 30
	minimumDiskFreeBytes = 2 << 30
)

type Dependency struct {
	Name    string `json:"name"`
	State   string `json:"state"`
	Action  string `json:"action"`
	Message string `json:"message"`
}

type Result struct {
	PlanID        string           `json:"planId"`
	System        inventory.System `json:"system"`
	MachineChecks []Check          `json:"machineChecks"`
	Dependencies  []Dependency     `json:"dependencies"`
	Protocols     []ProtocolPlan   `json:"protocols"`
	MachineReady  bool             `json:"machineReady"`
	Ready         bool             `json:"ready"`
}

type Handler struct {
	ManagedRoot string
	Probe       PortProbe
}

func (h Handler) Execute(ctx context.Context, payload json.RawMessage) (any, error) {
	request, err := protocol.DecodePayload[Request](payload)
	if err != nil {
		return nil, fmt.Errorf("INVALID_DISCOVERY_PAYLOAD: %w", err)
	}
	portResult, err := Plan(ctx, request, h.portProbe())
	if err != nil {
		return nil, fmt.Errorf("INVALID_DISCOVERY_PAYLOAD: %w", err)
	}
	system, err := inventory.Collect(h.ManagedRoot)
	if err != nil {
		return nil, fmt.Errorf("INVENTORY_FAILED: %w", err)
	}
	machineChecks := []Check{
		operatingSystemCheck(system),
		{Code: "MEMORY_AVAILABLE", OK: system.MemoryBytes >= minimumMemoryBytes, Message: fmt.Sprintf("%d bytes total; at least %d required", system.MemoryBytes, minimumMemoryBytes)},
		{Code: "DISK_AVAILABLE", OK: system.DiskFreeBytes >= minimumDiskFreeBytes, Message: fmt.Sprintf("%d bytes free; at least %d required", system.DiskFreeBytes, minimumDiskFreeBytes)},
		commandAvailableCheck(ctx, "SYSTEMD_AVAILABLE", "systemctl", "--version"),
	}
	dockerCheck, dockerDependency := inspectDocker(ctx)
	machineChecks = append(machineChecks, dockerCheck)
	machineReady := true
	for _, check := range machineChecks {
		if !check.OK {
			machineReady = false
		}
	}
	readyProtocols := 0
	for _, planned := range portResult.Protocols {
		if planned.Status == ProtocolReady {
			readyProtocols++
		}
	}
	return Result{
		PlanID:        request.PlanID,
		System:        system,
		MachineChecks: machineChecks,
		Dependencies:  []Dependency{dockerDependency},
		Protocols:     portResult.Protocols,
		MachineReady:  machineReady,
		Ready:         machineReady && readyProtocols > 0,
	}, nil
}

func (h Handler) portProbe() PortProbe {
	if h.Probe != nil {
		return h.Probe
	}
	return NetProbe{}
}

func operatingSystemCheck(system inventory.System) Check {
	ok := runtime.GOOS == "linux" && ((system.OSID == "debian" && (system.OSVersion == "12" || system.OSVersion == "13")) ||
		(system.OSID == "ubuntu" && (strings.HasPrefix(system.OSVersion, "22.04") || strings.HasPrefix(system.OSVersion, "24.04"))))
	message := system.OSPrettyName
	if runtime.GOOS != "linux" {
		message = "Machine Agent requires Linux"
	} else if !ok {
		message = fmt.Sprintf("unsupported operating system %s %s", system.OSID, system.OSVersion)
	}
	return Check{Code: "OPERATING_SYSTEM_SUPPORTED", OK: ok, Message: message}
}

func inspectDocker(ctx context.Context) (Check, Dependency) {
	path, err := exec.LookPath("docker")
	if err != nil {
		return Check{Code: "DOCKER_READY", OK: false, Message: "Docker CLI is not installed"}, Dependency{Name: "docker", State: "MISSING", Action: "INSTALL", Message: "Docker must be installed before apply"}
	}
	commandContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(commandContext, path, "version", "--format", "{{.Client.Version}}|{{.Server.Version}}").CombinedOutput()
	message := boundedMessage(output, err)
	if err != nil {
		return Check{Code: "DOCKER_READY", OK: false, Message: message}, Dependency{Name: "docker", State: "UNHEALTHY_EXTERNAL", Action: "NONE", Message: message}
	}
	return Check{Code: "DOCKER_READY", OK: true, Message: message}, Dependency{Name: "docker", State: "READY_EXTERNAL", Action: "REUSE", Message: message}
}

func commandAvailableCheck(ctx context.Context, code, binary string, arguments ...string) Check {
	path, err := exec.LookPath(binary)
	if err != nil {
		return Check{Code: code, OK: false, Message: binary + " was not found"}
	}
	commandContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(commandContext, path, arguments...).CombinedOutput()
	return Check{Code: code, OK: err == nil, Message: boundedMessage(output, err)}
}

func boundedMessage(output []byte, err error) string {
	message := strings.TrimSpace(string(output))
	if message == "" && err != nil {
		message = err.Error()
	}
	if len(message) > 512 {
		return message[:512]
	}
	return message
}
