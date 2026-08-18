// SPDX-License-Identifier: AGPL-3.0-only

package discovery

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os/exec"
	"sort"
	"strings"
	"time"
)

type IPResolver interface {
	LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error)
}

type ReadOnlyRunner interface {
	Run(ctx context.Context, name string, arguments ...string) ([]byte, error)
}

type OSReadOnlyRunner struct{}

func (OSReadOnlyRunner) Run(ctx context.Context, name string, arguments ...string) ([]byte, error) {
	path, err := exec.LookPath(name)
	if err != nil {
		return nil, err
	}
	commandContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return exec.CommandContext(commandContext, path, arguments...).CombinedOutput()
}

func planWithDNS(ctx context.Context, request Request, probe PortProbe, resolver IPResolver) (PortPlanResult, error) {
	if err := validateRequest(request); err != nil {
		return PortPlanResult{}, err
	}
	if resolver == nil {
		resolver = net.DefaultResolver
	}

	type dnsFact struct {
		check   Check
		code    string
		message string
	}
	dnsChecks := make(map[string]dnsFact, len(request.Protocols))
	eligible := request
	eligible.Protocols = make([]ProtocolRequest, 0, len(request.Protocols))
	for _, protocol := range request.Protocols {
		if protocol.Domain == "" {
			eligible.Protocols = append(eligible.Protocols, protocol)
			continue
		}
		check, code, message := protocolDNSCheck(ctx, resolver, protocol.Domain, protocol.ExpectedAddress)
		dnsChecks[protocol.Protocol] = dnsFact{check: check, code: code, message: message}
		if check.OK {
			eligible.Protocols = append(eligible.Protocols, protocol)
		}
	}

	plannedByProtocol := make(map[string]ProtocolPlan, len(request.Protocols))
	if len(eligible.Protocols) > 0 {
		result, err := Plan(ctx, eligible, probe)
		if err != nil {
			return PortPlanResult{}, err
		}
		for _, planned := range result.Protocols {
			plannedByProtocol[planned.Protocol] = planned
		}
	}

	for _, protocol := range request.Protocols {
		dns, hasDNS := dnsChecks[protocol.Protocol]
		if planned, ok := plannedByProtocol[protocol.Protocol]; ok {
			if hasDNS {
				planned.Checks = append(planned.Checks, dns.check)
			}
			plannedByProtocol[protocol.Protocol] = planned
			continue
		}

		single := request
		single.Protocols = []ProtocolRequest{protocol}
		result, err := Plan(ctx, single, probe)
		if err != nil {
			return PortPlanResult{}, err
		}
		planned := result.Protocols[0]
		planned.Checks = append(planned.Checks, dns.check)
		planned.Status = ProtocolBlocked
		planned.SelectedPort = nil
		planned.ErrorCode = dns.code
		planned.Message = dns.message
		plannedByProtocol[protocol.Protocol] = planned
	}

	result := PortPlanResult{Protocols: make([]ProtocolPlan, 0, len(request.Protocols))}
	for _, protocol := range request.Protocols {
		result.Protocols = append(result.Protocols, plannedByProtocol[protocol.Protocol])
	}
	return result, nil
}

func protocolDNSCheck(ctx context.Context, resolver IPResolver, domain, expectedAddress string) (Check, string, string) {
	lookupContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	domainAddresses, err := resolveAddresses(lookupContext, resolver, domain)
	if err != nil {
		message := fmt.Sprintf("cannot resolve certificate domain %s", domain)
		return Check{Code: "DNS_ADDRESS_MATCH", OK: false, Message: message}, "DNS_LOOKUP_FAILED", message
	}
	expectedAddresses, err := resolveAddresses(lookupContext, resolver, expectedAddress)
	if err != nil {
		message := "cannot resolve the Machine address for DNS comparison"
		return Check{Code: "DNS_ADDRESS_MATCH", OK: false, Message: message}, "DNS_LOOKUP_FAILED", message
	}
	for _, domainAddress := range domainAddresses {
		for _, expected := range expectedAddresses {
			if domainAddress.Equal(expected) {
				return Check{Code: "DNS_ADDRESS_MATCH", OK: true, Message: "certificate domain resolves to the Machine address"}, "", ""
			}
		}
	}
	message := "certificate domain does not resolve to the Machine address"
	return Check{Code: "DNS_ADDRESS_MATCH", OK: false, Message: message}, "DNS_ADDRESS_MISMATCH", message
}

func resolveAddresses(ctx context.Context, resolver IPResolver, value string) ([]net.IP, error) {
	if parsed := net.ParseIP(value); parsed != nil {
		return []net.IP{parsed}, nil
	}
	addresses, err := resolver.LookupIPAddr(ctx, value)
	if err != nil {
		return nil, err
	}
	result := make([]net.IP, 0, len(addresses))
	for _, address := range addresses {
		if address.IP != nil {
			result = append(result, address.IP)
		}
	}
	if len(result) == 0 {
		return nil, errors.New("DNS response contained no addresses")
	}
	return result, nil
}

func clockSynchronizationCheck(ctx context.Context, runner ReadOnlyRunner) Check {
	output, err := runner.Run(ctx, "timedatectl", "show", "--property=SystemClockSynchronized", "--value")
	message := boundedMessage(output, err)
	synchronized := err == nil && strings.EqualFold(strings.TrimSpace(string(output)), "yes")
	if synchronized {
		return Check{Code: "CLOCK_SYNCHRONIZED", OK: true, Message: "system clock reports synchronized"}
	}
	if message == "" {
		message = "system clock synchronization could not be confirmed"
	}
	return Check{Code: "CLOCK_SYNCHRONIZED", OK: false, Message: message}
}

func ClockSynchronizationCheck(ctx context.Context) Check {
	return clockSynchronizationCheck(ctx, OSReadOnlyRunner{})
}

func hostFirewallRiskCheck(ctx context.Context, runner ReadOnlyRunner) Check {
	active := make([]string, 0, 3)
	for _, service := range []string{"ufw", "firewalld", "nftables"} {
		output, err := runner.Run(ctx, "systemctl", "is-active", service)
		if err == nil && strings.EqualFold(strings.TrimSpace(string(output)), "active") {
			active = append(active, service)
		}
	}
	sort.Strings(active)
	message := "Inbound reachability cannot be proven locally; verify the host firewall for every selected TCP and UDP port"
	if len(active) > 0 {
		message = fmt.Sprintf("Active host firewall service(s) detected: %s; verify every selected TCP and UDP port", strings.Join(active, ", "))
	}
	return Check{Code: "HOST_FIREWALL_REVIEW_REQUIRED", OK: false, Advisory: true, Message: message}
}

func cloudSecurityGroupRiskCheck() Check {
	return Check{
		Code:     "CLOUD_SECURITY_GROUP_REVIEW_REQUIRED",
		OK:       false,
		Advisory: true,
		Message:  "The Agent cannot inspect cloud-provider security groups; verify inbound rules for every selected TCP and UDP port",
	}
}
