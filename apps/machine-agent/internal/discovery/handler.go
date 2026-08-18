// SPDX-License-Identifier: AGPL-3.0-only

package discovery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/dependency"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/inventory"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/protocol"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/warp"
)

const (
	minimumMemoryBytes   = 1 << 30
	minimumDiskFreeBytes = 2 << 30
)

type Dependency struct {
	Name      string `json:"name"`
	State     string `json:"state"`
	Action    string `json:"action"`
	Ownership string `json:"ownership"`
	Required  bool   `json:"required"`
	Message   string `json:"message"`
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
	MachineID   string
	Probe       PortProbe
	Resolver    IPResolver
	ReadOnly    ReadOnlyRunner
}

func (h Handler) Execute(ctx context.Context, payload json.RawMessage) (any, error) {
	request, err := protocol.DecodePayload[Request](payload)
	if err != nil {
		return nil, fmt.Errorf("INVALID_DISCOVERY_PAYLOAD: %w", err)
	}
	portResult, err := planWithDNS(ctx, request, h.portProbe(), h.Resolver)
	if err != nil {
		return nil, fmt.Errorf("INVALID_DISCOVERY_PAYLOAD: %w", err)
	}
	system, err := inventory.Collect(h.ManagedRoot)
	if err != nil {
		return nil, fmt.Errorf("INVENTORY_FAILED: %w", err)
	}
	readOnly := h.ReadOnly
	if readOnly == nil {
		readOnly = OSReadOnlyRunner{}
	}
	machineChecks := []Check{
		operatingSystemCheck(system),
		{Code: "MEMORY_AVAILABLE", OK: system.MemoryBytes >= minimumMemoryBytes, Message: fmt.Sprintf("%d bytes total; at least %d required", system.MemoryBytes, minimumMemoryBytes)},
		{Code: "DISK_AVAILABLE", OK: system.DiskFreeBytes >= minimumDiskFreeBytes, Message: fmt.Sprintf("%d bytes free; at least %d required", system.DiskFreeBytes, minimumDiskFreeBytes)},
		commandAvailableCheck(ctx, "SYSTEMD_AVAILABLE", "systemctl", "--version"),
		clockSynchronizationCheck(ctx, readOnly),
		hostFirewallRiskCheck(ctx, readOnly),
		cloudSecurityGroupRiskCheck(),
	}
	dockerCheck, dockerDependency := inspectDocker(ctx, h.ManagedRoot, h.MachineID)
	machineChecks = append(machineChecks, dockerCheck)
	warpCheck, warpDependency := inspectWARP(ctx, h.ManagedRoot, h.MachineID, request.WarpRequired)
	machineChecks = append(machineChecks, warpCheck)
	machineReady := machineChecksReady(machineChecks)
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
		Dependencies:  []Dependency{dockerDependency, warpDependency},
		Protocols:     portResult.Protocols,
		MachineReady:  machineReady,
		Ready:         machineReady && readyProtocols > 0,
	}, nil
}

func machineChecksReady(checks []Check) bool {
	for _, check := range checks {
		if !check.OK && !check.Advisory {
			return false
		}
	}
	return true
}

func inspectWARP(ctx context.Context, managedRoot, machineID string, required bool) (Check, Dependency) {
	if !required {
		return Check{Code: "WARP_NOT_REQUIRED", OK: true, Message: "WARP is not required by this plan"}, Dependency{Name: "warp", State: "NOT_REQUIRED", Action: "NONE", Ownership: "UNASSESSED", Required: false, Message: "WARP is not required"}
	}
	ownership, ownershipErr := warp.ReadOwnership(managedRoot)
	managed := ownershipErr == nil && ownership.MachineID == machineID
	path, err := exec.LookPath("warp-cli")
	if err != nil {
		if managed {
			return Check{Code: "WARP_MANAGED_REPAIRABLE", OK: true, Message: "Managed WARP CLI is missing and can be repaired after plan approval"}, Dependency{Name: "warp", State: "UNHEALTHY_MANAGED", Action: "REPAIR_MANAGED", Ownership: "MANAGED", Required: true, Message: "Repair the Machine-managed host WARP runtime"}
		}
		if ownershipErr == nil || !errors.Is(ownershipErr, os.ErrNotExist) {
			return Check{Code: "WARP_OWNERSHIP_CONFLICT", OK: false, Message: "WARP ownership metadata is foreign or unsafe"}, Dependency{Name: "warp", State: "OWNERSHIP_CONFLICT", Action: "NONE", Ownership: "EXTERNAL", Required: true, Message: "WARP ownership metadata cannot be replaced automatically"}
		}
		return Check{Code: "WARP_ACTIONABLE", OK: true, Message: "WARP is absent and can be installed after plan approval"}, Dependency{Name: "warp", State: "MISSING", Action: "INSTALL_MANAGED", Ownership: "ABSENT", Required: true, Message: "Install and register a Machine-managed host WARP proxy"}
	}
	registered, registrationMessage := readOnlyCommand(ctx, path, "registration", "show")
	settingsOK, settingsMessage := readOnlyCommand(ctx, path, "settings")
	statusOK, statusMessage := readOnlyCommand(ctx, path, "status")
	settingsCompatible := settingsOK && strings.Contains(strings.ToLower(settingsMessage), "proxy") && strings.Contains(settingsMessage, "40000")
	connected := statusOK && warpStatusConnected(statusMessage)
	if registered && settingsCompatible && connected {
		if managed {
			return Check{Code: "WARP_READY", OK: true, Message: statusMessage}, Dependency{Name: "warp", State: "READY_MANAGED", Action: "REPAIR_MANAGED", Ownership: "MANAGED", Required: true, Message: statusMessage}
		}
		return Check{Code: "WARP_READY", OK: true, Message: statusMessage}, Dependency{Name: "warp", State: "READY_EXTERNAL", Action: "REUSE_EXTERNAL", Ownership: "EXTERNAL", Required: true, Message: "Compatible external WARP will be reused without mutation"}
	}
	message := boundedMessage([]byte(strings.Join([]string{registrationMessage, settingsMessage, statusMessage}, "; ")), nil)
	if managed {
		return Check{Code: "WARP_MANAGED_REPAIRABLE", OK: true, Message: message}, Dependency{Name: "warp", State: "UNHEALTHY_MANAGED", Action: "REPAIR_MANAGED", Ownership: "MANAGED", Required: true, Message: message}
	}
	return Check{Code: "WARP_TAKEOVER_REQUIRED", OK: false, Message: message}, Dependency{Name: "warp", State: "TAKEOVER_REQUIRED", Action: "TAKEOVER_REQUIRED", Ownership: "EXTERNAL", Required: true, Message: "Existing external WARP is incompatible; automatic mutation is forbidden"}
}

func warpStatusConnected(message string) bool {
	lower := strings.ToLower(message)
	return strings.Contains(lower, "connected") && !strings.Contains(lower, "disconnected")
}

func readOnlyCommand(ctx context.Context, path string, arguments ...string) (bool, string) {
	commandContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(commandContext, path, arguments...).CombinedOutput()
	return err == nil, boundedMessage(output, err)
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

func inspectDocker(ctx context.Context, managedRoot, machineID string) (Check, Dependency) {
	ownership, ownershipErr := dependency.ReadOwnership(managedRoot)
	managed := ownershipErr == nil && ownership.MachineID == machineID
	path, err := exec.LookPath("docker")
	if err != nil {
		if managed {
			return Check{Code: "DOCKER_MANAGED_REPAIRABLE", OK: true, Message: "Managed Docker CLI is missing and can be repaired after plan approval"}, Dependency{Name: "docker", State: "UNHEALTHY_MANAGED", Action: "REPAIR", Ownership: "MANAGED", Required: true, Message: "Repair the Machine-managed Docker runtime"}
		}
		if ownershipErr == nil || !errors.Is(ownershipErr, os.ErrNotExist) {
			return Check{Code: "DOCKER_OWNERSHIP_CONFLICT", OK: false, Message: "Docker ownership metadata is foreign or unsafe"}, Dependency{Name: "docker", State: "OWNERSHIP_CONFLICT", Action: "NONE", Ownership: "EXTERNAL", Required: true, Message: "Docker ownership metadata cannot be replaced automatically"}
		}
		if dockerRuntimePresent() {
			return Check{Code: "DOCKER_READY", OK: false, Message: "Docker runtime indicators exist but the CLI is unavailable"}, Dependency{Name: "docker", State: "UNHEALTHY_EXTERNAL", Action: "NONE", Ownership: "EXTERNAL", Required: true, Message: "External Docker cannot be repaired automatically"}
		}
		return Check{Code: "DOCKER_ACTIONABLE", OK: true, Message: "Docker is absent and can be installed after plan approval"}, Dependency{Name: "docker", State: "MISSING", Action: "INSTALL", Ownership: "ABSENT", Required: true, Message: "Install the supported distribution Docker package before protocol mutation"}
	}
	commandContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(commandContext, path, "version", "--format", "{{.Client.Version}}|{{.Server.Version}}").CombinedOutput()
	message := boundedMessage(output, err)
	if err != nil {
		if managed {
			return Check{Code: "DOCKER_MANAGED_REPAIRABLE", OK: true, Message: message}, Dependency{Name: "docker", State: "UNHEALTHY_MANAGED", Action: "REPAIR", Ownership: "MANAGED", Required: true, Message: message}
		}
		return Check{Code: "DOCKER_READY", OK: false, Message: message}, Dependency{Name: "docker", State: "UNHEALTHY_EXTERNAL", Action: "NONE", Ownership: "EXTERNAL", Required: true, Message: message}
	}
	if managed {
		return Check{Code: "DOCKER_READY", OK: true, Message: message}, Dependency{Name: "docker", State: "READY_MANAGED", Action: "REUSE", Ownership: "MANAGED", Required: true, Message: message}
	}
	return Check{Code: "DOCKER_READY", OK: true, Message: message}, Dependency{Name: "docker", State: "READY_EXTERNAL", Action: "REUSE", Ownership: "EXTERNAL", Required: true, Message: message}
}

func dockerRuntimePresent() bool {
	if _, err := exec.LookPath("dockerd"); err == nil {
		return true
	}
	_, err := os.Lstat("/var/run/docker.sock")
	return err == nil || !errors.Is(err, os.ErrNotExist)
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
