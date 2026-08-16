// SPDX-License-Identifier: AGPL-3.0-only

package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/inventory"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/protocol"
)

type InventoryHandler struct {
	ManagedRoot string
}

func (h InventoryHandler) Execute(_ context.Context, payload json.RawMessage) (any, error) {
	if err := requireEmptyObject(payload); err != nil {
		return nil, err
	}
	return inventory.Collect(h.ManagedRoot)
}

type PortRequirement struct {
	Port    uint16 `json:"port"`
	Network string `json:"network"`
}

type PreflightRequest struct {
	Ports []PortRequirement `json:"ports"`
}

type Check struct {
	Name    string `json:"name"`
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

type PreflightResult struct {
	System inventory.System `json:"system"`
	Checks []Check          `json:"checks"`
	OK     bool             `json:"ok"`
}

type PreflightHandler struct {
	ManagedRoot string
}

func (h PreflightHandler) Execute(ctx context.Context, payload json.RawMessage) (any, error) {
	request, err := protocol.DecodePayload[PreflightRequest](payload)
	if err != nil {
		return nil, &Error{Code: "INVALID_PREFLIGHT_PAYLOAD", Message: err.Error()}
	}
	if len(request.Ports) > 32 {
		return nil, &Error{Code: "TOO_MANY_PORTS", Message: "at most 32 ports may be checked"}
	}
	system, err := inventory.Collect(h.ManagedRoot)
	if err != nil {
		return nil, &Error{Code: "INVENTORY_FAILED", Message: err.Error()}
	}
	checks := []Check{supportedOSCheck(system)}
	checks = append(checks, commandCheck(ctx, "docker", "docker", "version", "--format", "{{.Server.Version}}"))
	checks = append(checks, commandCheck(ctx, "systemd", "systemctl", "--version"))
	for _, requirement := range request.Ports {
		checks = append(checks, portCheck(requirement))
	}
	ok := true
	for _, check := range checks {
		if !check.OK {
			ok = false
		}
	}
	return PreflightResult{System: system, Checks: checks, OK: ok}, nil
}

func DefaultHandlers(managedRoot string) map[string]Handler {
	return map[string]Handler{
		protocol.CommandInventory: InventoryHandler{ManagedRoot: managedRoot},
		protocol.CommandPreflight: PreflightHandler{ManagedRoot: managedRoot},
	}
}

func supportedOSCheck(system inventory.System) Check {
	ok := (system.OSID == "debian" && system.OSVersion == "12") ||
		(system.OSID == "ubuntu" && (strings.HasPrefix(system.OSVersion, "22.04") || strings.HasPrefix(system.OSVersion, "24.04")))
	message := system.OSPrettyName
	if runtime.GOOS != "linux" {
		ok = false
		message = "machine agent requires Linux"
	} else if !ok {
		message = fmt.Sprintf("unsupported operating system %s %s", system.OSID, system.OSVersion)
	}
	return Check{Name: "operating_system", OK: ok, Message: message}
}

func commandCheck(ctx context.Context, name, binary string, arguments ...string) Check {
	path, err := exec.LookPath(binary)
	if err != nil {
		return Check{Name: name, OK: false, Message: binary + " was not found"}
	}
	commandContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(commandContext, path, arguments...).CombinedOutput()
	message := strings.TrimSpace(string(output))
	if len(message) > 512 {
		message = message[:512] + "…"
	}
	if err != nil {
		if message == "" {
			message = err.Error()
		}
		return Check{Name: name, OK: false, Message: message}
	}
	return Check{Name: name, OK: true, Message: message}
}

func portCheck(requirement PortRequirement) Check {
	name := fmt.Sprintf("port_%s_%d", requirement.Network, requirement.Port)
	if requirement.Port == 0 {
		return Check{Name: name, OK: false, Message: "port must be between 1 and 65535"}
	}
	address := fmt.Sprintf("0.0.0.0:%d", requirement.Port)
	switch requirement.Network {
	case "tcp":
		listener, err := net.Listen("tcp4", address)
		if err != nil {
			return Check{Name: name, OK: false, Message: "TCP port is unavailable"}
		}
		listener.Close()
		return Check{Name: name, OK: true, Message: "TCP port is available"}
	case "udp":
		connection, err := net.ListenPacket("udp4", address)
		if err != nil {
			return Check{Name: name, OK: false, Message: "UDP port is unavailable"}
		}
		connection.Close()
		return Check{Name: name, OK: true, Message: "UDP port is available"}
	default:
		return Check{Name: name, OK: false, Message: "network must be tcp or udp"}
	}
}

func requireEmptyObject(payload json.RawMessage) error {
	var value map[string]json.RawMessage
	if err := json.Unmarshal(payload, &value); err != nil {
		return &Error{Code: "INVALID_PAYLOAD", Message: "payload must be a JSON object"}
	}
	if len(value) != 0 {
		return &Error{Code: "INVALID_PAYLOAD", Message: "inventory payload must be empty"}
	}
	return nil
}
