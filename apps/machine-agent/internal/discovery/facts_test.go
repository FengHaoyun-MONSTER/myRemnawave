// SPDX-License-Identifier: AGPL-3.0-only

package discovery

import (
	"context"
	"errors"
	"net"
	"testing"
)

type fakeResolver struct {
	addresses map[string][]net.IPAddr
	errors    map[string]error
}

func (f fakeResolver) LookupIPAddr(_ context.Context, host string) ([]net.IPAddr, error) {
	if err := f.errors[host]; err != nil {
		return nil, err
	}
	return f.addresses[host], nil
}

type fakeReadOnlyRunner struct {
	output []byte
	err    error
}

func (f fakeReadOnlyRunner) Run(_ context.Context, _ string, _ ...string) ([]byte, error) {
	return f.output, f.err
}

func TestProtocolDNSMismatchBlocksOnlyAffectedProtocol(t *testing.T) {
	request := Request{
		PlanID: "123e4567-e89b-42d3-a456-426614174000",
		Mode:   "PLAN",
		Protocols: []ProtocolRequest{
			{Protocol: "VLESS_TLS_VISION", Network: "tcp", ControlPort: 2223, Candidates: []uint16{8443}, Domain: "tls.example.com", ExpectedAddress: "203.0.113.10"},
			{Protocol: "VLESS_REALITY", Network: "tcp", ControlPort: 2222, Candidates: []uint16{8443}},
		},
	}
	resolver := fakeResolver{addresses: map[string][]net.IPAddr{
		"tls.example.com": {{IP: net.ParseIP("203.0.113.11")}},
	}}

	result, err := planWithDNS(context.Background(), request, fakeProbe{}, resolver)
	if err != nil {
		t.Fatal(err)
	}

	if result.Protocols[0].Status != ProtocolBlocked || result.Protocols[0].ErrorCode != "DNS_ADDRESS_MISMATCH" || result.Protocols[0].SelectedPort != nil {
		t.Fatalf("TLS plan was not isolated by DNS mismatch: %#v", result.Protocols[0])
	}
	if result.Protocols[1].Status != ProtocolReady || result.Protocols[1].SelectedPort == nil || *result.Protocols[1].SelectedPort != 8443 {
		t.Fatalf("blocked TLS must not reserve Reality's port: %#v", result.Protocols[1])
	}
}

func TestClockSynchronizationCheck(t *testing.T) {
	if check := clockSynchronizationCheck(context.Background(), fakeReadOnlyRunner{output: []byte("yes\n")}); !check.OK || check.Advisory {
		t.Fatalf("synchronized clock should pass: %#v", check)
	}
	if check := clockSynchronizationCheck(context.Background(), fakeReadOnlyRunner{output: []byte("no\n")}); check.OK || check.Advisory {
		t.Fatalf("unsynchronized clock must be a blocker: %#v", check)
	}
	if check := clockSynchronizationCheck(context.Background(), fakeReadOnlyRunner{err: errors.New("missing")}); check.OK {
		t.Fatalf("uninspectable clock must not pass: %#v", check)
	}
}

func TestInfrastructureRiskChecksAreAdvisory(t *testing.T) {
	firewall := hostFirewallRiskCheck(context.Background(), fakeReadOnlyRunner{output: []byte("active\n")})
	cloud := cloudSecurityGroupRiskCheck()
	if firewall.OK || !firewall.Advisory || cloud.OK || !cloud.Advisory {
		t.Fatalf("infrastructure risks must remain visible without blocking local apply: %#v %#v", firewall, cloud)
	}
}

func TestAdvisoryInfrastructureRiskDoesNotBlockMachine(t *testing.T) {
	if !machineChecksReady([]Check{
		{Code: "OPERATING_SYSTEM_SUPPORTED", OK: true},
		{Code: "HOST_FIREWALL_REVIEW_REQUIRED", OK: false, Advisory: true},
	}) {
		t.Fatal("an advisory infrastructure risk must not pretend local provisioning is impossible")
	}
	if machineChecksReady([]Check{{Code: "CLOCK_SYNCHRONIZED", OK: false}}) {
		t.Fatal("an unsynchronized clock must block provisioning")
	}
}
