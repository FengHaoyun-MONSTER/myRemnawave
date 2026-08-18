// SPDX-License-Identifier: AGPL-3.0-only

package discovery

import (
	"context"
	"testing"
)

type fakeProbe struct {
	occupied map[string]bool
}

func (f fakeProbe) Available(_ context.Context, network string, port uint16) (bool, string) {
	key := network + ":" + itoa(port)
	if f.occupied[key] {
		return false, "occupied by an existing listener"
	}
	return true, "available"
}

func TestPlanUsesDeterministicFallbackAndKeepsTCPUDPIndependent(t *testing.T) {
	request := Request{
		PlanID: "123e4567-e89b-42d3-a456-426614174000",
		Mode:   "PLAN",
		Protocols: []ProtocolRequest{
			{Protocol: "VLESS_REALITY", Network: "tcp", ControlPort: 2222, Candidates: []uint16{443, 8443, 2053}},
			{Protocol: "VLESS_TLS_VISION", Network: "tcp", ControlPort: 2223, Candidates: []uint16{8443, 2053, 2083}},
			{Protocol: "HYSTERIA2", Network: "udp", ControlPort: 2224, Candidates: []uint16{443, 8443}},
		},
	}
	probe := fakeProbe{occupied: map[string]bool{"tcp:443": true, "tcp:8443": true}}

	result, err := Plan(context.Background(), request, probe)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]uint16{
		"VLESS_REALITY":    2053,
		"VLESS_TLS_VISION": 2083,
		"HYSTERIA2":        443,
	}
	for _, protocol := range result.Protocols {
		if protocol.Status != ProtocolReady || protocol.SelectedPort == nil || *protocol.SelectedPort != want[protocol.Protocol] {
			t.Errorf("unexpected plan for %s: %#v", protocol.Protocol, protocol)
		}
	}
}

func TestPlanBlocksOnlyProtocolWithExhaustedPool(t *testing.T) {
	request := Request{
		PlanID: "123e4567-e89b-42d3-a456-426614174000",
		Mode:   "PLAN",
		Protocols: []ProtocolRequest{
			{Protocol: "VLESS_REALITY", Network: "tcp", ControlPort: 2222, Candidates: []uint16{443, 8443}},
			{Protocol: "HYSTERIA2", Network: "udp", ControlPort: 2224, Candidates: []uint16{443}},
		},
	}
	probe := fakeProbe{occupied: map[string]bool{"tcp:443": true, "tcp:8443": true}}

	result, err := Plan(context.Background(), request, probe)
	if err != nil {
		t.Fatal(err)
	}
	if result.Protocols[0].Status != ProtocolBlocked || result.Protocols[0].ErrorCode != "PORT_POOL_EXHAUSTED" {
		t.Fatalf("Reality should be blocked: %#v", result.Protocols[0])
	}
	if result.Protocols[1].Status != ProtocolReady || result.Protocols[1].SelectedPort == nil || *result.Protocols[1].SelectedPort != 443 {
		t.Fatalf("Hysteria2 should remain ready: %#v", result.Protocols[1])
	}
}

func TestPlanRejectsDuplicateProtocol(t *testing.T) {
	request := Request{
		PlanID: "123e4567-e89b-42d3-a456-426614174000",
		Mode:   "PLAN",
		Protocols: []ProtocolRequest{
			{Protocol: "VLESS_REALITY", Network: "tcp", ControlPort: 2222, Candidates: []uint16{443}},
			{Protocol: "VLESS_REALITY", Network: "tcp", ControlPort: 2222, Candidates: []uint16{8443}},
		},
	}
	if _, err := Plan(context.Background(), request, fakeProbe{}); err == nil {
		t.Fatal("expected duplicate protocol validation failure")
	}
}

func itoa(value uint16) string {
	if value == 0 {
		return "0"
	}
	buffer := [5]byte{}
	index := len(buffer)
	for value > 0 {
		index--
		buffer[index] = byte('0' + value%10)
		value /= 10
	}
	return string(buffer[index:])
}
