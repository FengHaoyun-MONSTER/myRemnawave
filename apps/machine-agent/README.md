# myRemnawave Machine Agent

The Machine Agent is a native, root-owned host service that maintains an
outbound mTLS WebSocket session to the panel. It executes only typed,
allowlisted reconciliation commands and never exposes an arbitrary shell API.

The Agent implements one-time CSR enrollment, inventory and preflight checks,
idempotent command replay, bounded mTLS control framing, and reconcilers for
the three managed protocol instances, certificates, WARP, configuration, and
service lifecycle. It has no arbitrary command or shell execution endpoint.

Enrollment generates an ECDSA P-256 key on the Machine. The private key is
never sent to the panel; the Agent submits only a PKCS#10 CSR and atomically
installs the returned client certificate, CA certificate, and environment file.
Pending key/CSR state is root-only and retained across an ambiguous network
failure, allowing the same enrollment attempt to resume safely. Existing
credential directories are never overwritten.

## Install

Create a Machine in the panel, then run the generated command as root on a
fresh Debian 12/13, Ubuntu 22.04, or Ubuntu 24.04 server. The installer requires
an exact Agent release, verifies the selected release assets against the
published SHA-256 manifest, enrolls once, and starts the hardened systemd
service.

Enrollment installs only the pinned Agent and its prerequisites. It does not
install, start, stop, or repair Docker or WARP. After enrollment, the panel
first requests a read-only resource plan. Only a separately approved typed
action may install an absent dependency or repair a runtime proven to be owned
by the same Machine. Healthy external Docker and compatible external WARP are
reused without mutation; unhealthy or unknown external resources block work.

```sh
curl --fail --silent --show-error --location \
  https://raw.githubusercontent.com/FengHaoyun-MONSTER/myRemnawave/v0.2.0/apps/machine-agent/install.sh \
  | sh -s -- \
      --panel-url https://panel.example.com/api/machine-enrollment \
      --token 'one-time-token-from-the-panel'
```

The enrollment token expires after 30 minutes and is invalidated after its
first successful use. A short replay window returns the same response only for
the exact persisted attempt and CSR. Legacy v0.1.1 agents remain compatible
for their first exchange, but only v0.1.2 and newer receive the idempotent retry
guarantee. Do not save the token in scripts or configuration management.

An incompatible external WARP requires an explicit Super Admin takeover
decision. The decision and administrator UUID are recorded, and the Agent
refuses the takeover when it detects 3X-UI/x-ui process, service, file, or
container indicators. A successful ownership adoption expires the old plan;
resource discovery must run again before any WARP mutation.

```sh
myremnawave-agent enroll \
  --url https://panel.example.com/api/machine-enrollment \
  --token 'one-time-token-from-the-panel'
```

## Development

```sh
go test ./...
go vet ./...
go build ./cmd/agent
```

The Agent requires Go 1.25.13 for development. Deployment uses a statically built
Linux binary and the hardened systemd unit in `packaging/systemd`.
