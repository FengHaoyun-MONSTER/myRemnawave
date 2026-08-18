// SPDX-License-Identifier: AGPL-3.0-only

package discovery

import (
	"context"
	"errors"
	"fmt"
	"net"
	"regexp"
)

const (
	ProtocolReady   = "READY"
	ProtocolBlocked = "BLOCKED"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type ProtocolRequest struct {
	Protocol       string   `json:"protocol"`
	Network        string   `json:"network"`
	ControlPort    uint16   `json:"controlPort"`
	Candidates     []uint16 `json:"candidates"`
	RequiresHTTP01 bool     `json:"requiresHttp01"`
}

type Request struct {
	PlanID       string            `json:"planId"`
	Mode         string            `json:"mode"`
	WarpRequired bool              `json:"warpRequired"`
	Protocols    []ProtocolRequest `json:"protocols"`
}

type Check struct {
	Code    string `json:"code"`
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

type PortAttempt struct {
	Port      uint16 `json:"port"`
	Available bool   `json:"available"`
	Message   string `json:"message"`
}

type ProtocolPlan struct {
	Protocol     string        `json:"protocol"`
	Network      string        `json:"network"`
	Status       string        `json:"status"`
	SelectedPort *uint16       `json:"selectedPort"`
	ErrorCode    string        `json:"errorCode,omitempty"`
	Message      string        `json:"message,omitempty"`
	Checks       []Check       `json:"checks"`
	PortAttempts []PortAttempt `json:"portAttempts"`
}

type PortProbe interface {
	Available(ctx context.Context, network string, port uint16) (bool, string)
}

type NetProbe struct{}

func (NetProbe) Available(_ context.Context, network string, port uint16) (bool, string) {
	address := fmt.Sprintf("0.0.0.0:%d", port)
	switch network {
	case "tcp":
		listener, err := net.Listen("tcp4", address)
		if err != nil {
			return false, "TCP port is occupied or unavailable"
		}
		_ = listener.Close()
		return true, "TCP port is available"
	case "udp":
		connection, err := net.ListenPacket("udp4", address)
		if err != nil {
			return false, "UDP port is occupied or unavailable"
		}
		_ = connection.Close()
		return true, "UDP port is available"
	default:
		return false, "network must be tcp or udp"
	}
}

type PortPlanResult struct {
	Protocols []ProtocolPlan
}

func Plan(ctx context.Context, request Request, probe PortProbe) (PortPlanResult, error) {
	if err := validateRequest(request); err != nil {
		return PortPlanResult{}, err
	}
	if probe == nil {
		return PortPlanResult{}, errors.New("port probe is required")
	}
	reserved := map[string]struct{}{}
	result := PortPlanResult{Protocols: make([]ProtocolPlan, 0, len(request.Protocols))}
	for _, requested := range request.Protocols {
		planned := ProtocolPlan{
			Protocol:     requested.Protocol,
			Network:      requested.Network,
			Status:       ProtocolBlocked,
			Checks:       make([]Check, 0, 2),
			PortAttempts: make([]PortAttempt, 0, len(requested.Candidates)),
		}
		controlAvailable, controlMessage := probe.Available(ctx, "tcp", requested.ControlPort)
		planned.Checks = append(planned.Checks, Check{Code: "CONTROL_PORT_AVAILABLE", OK: controlAvailable, Message: controlMessage})
		if !controlAvailable {
			planned.ErrorCode = "CONTROL_PORT_UNAVAILABLE"
			planned.Message = fmt.Sprintf("local control TCP port %d is unavailable", requested.ControlPort)
			result.Protocols = append(result.Protocols, planned)
			continue
		}
		if requested.RequiresHTTP01 {
			httpAvailable, httpMessage := probe.Available(ctx, "tcp", 80)
			planned.Checks = append(planned.Checks, Check{Code: "HTTP01_PORT_AVAILABLE", OK: httpAvailable, Message: httpMessage})
			if !httpAvailable {
				planned.ErrorCode = "HTTP01_PORT_UNAVAILABLE"
				planned.Message = "HTTP-01 requires TCP port 80 or an imported certificate"
				result.Protocols = append(result.Protocols, planned)
				continue
			}
		}
		for _, candidate := range requested.Candidates {
			key := fmt.Sprintf("%s:%d", requested.Network, candidate)
			if _, used := reserved[key]; used {
				planned.PortAttempts = append(planned.PortAttempts, PortAttempt{Port: candidate, Available: false, Message: "reserved by another protocol in this plan"})
				continue
			}
			available, message := probe.Available(ctx, requested.Network, candidate)
			planned.PortAttempts = append(planned.PortAttempts, PortAttempt{Port: candidate, Available: available, Message: message})
			if available {
				selected := candidate
				planned.SelectedPort = &selected
				planned.Status = ProtocolReady
				reserved[key] = struct{}{}
				break
			}
		}
		if planned.SelectedPort == nil {
			planned.ErrorCode = "PORT_POOL_EXHAUSTED"
			planned.Message = "no suitable external port is available"
		}
		result.Protocols = append(result.Protocols, planned)
	}
	return result, nil
}

func validateRequest(request Request) error {
	if !uuidPattern.MatchString(request.PlanID) {
		return errors.New("planId must be a lowercase UUID")
	}
	if len(request.Protocols) == 0 || len(request.Protocols) > 3 {
		return errors.New("one to three protocols are required")
	}
	if request.Mode != "PLAN" && request.Mode != "REVALIDATE" {
		return errors.New("mode must be PLAN or REVALIDATE")
	}
	expected := map[string]struct {
		network string
		control uint16
	}{
		"VLESS_REALITY":    {network: "tcp", control: 2222},
		"VLESS_TLS_VISION": {network: "tcp", control: 2223},
		"HYSTERIA2":        {network: "udp", control: 2224},
	}
	seenProtocols := map[string]struct{}{}
	for _, protocol := range request.Protocols {
		definition, ok := expected[protocol.Protocol]
		if !ok || definition.network != protocol.Network || definition.control != protocol.ControlPort {
			return fmt.Errorf("protocol %s has an invalid network or control port", protocol.Protocol)
		}
		if _, duplicate := seenProtocols[protocol.Protocol]; duplicate {
			return fmt.Errorf("protocol %s is duplicated", protocol.Protocol)
		}
		seenProtocols[protocol.Protocol] = struct{}{}
		if len(protocol.Candidates) == 0 || len(protocol.Candidates) > 16 {
			return fmt.Errorf("protocol %s requires one to sixteen candidates", protocol.Protocol)
		}
		seenCandidates := map[uint16]struct{}{}
		for _, candidate := range protocol.Candidates {
			if candidate == 0 {
				return errors.New("candidate ports must be between 1 and 65535")
			}
			if _, duplicate := seenCandidates[candidate]; duplicate {
				return fmt.Errorf("protocol %s contains a duplicate candidate", protocol.Protocol)
			}
			seenCandidates[candidate] = struct{}{}
		}
	}
	return nil
}
