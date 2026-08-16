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
Existing credential directories are never overwritten.

## Install

Create a Machine in the panel, then run the generated command as root on a
fresh Debian 12, Ubuntu 22.04, or Ubuntu 24.04 server. The installer requires
an exact Agent release, verifies the selected release assets against the
published SHA-256 manifest, enrolls once, and starts the hardened systemd
service.

```sh
curl --fail --silent --show-error --location \
  https://raw.githubusercontent.com/FengHaoyun-MONSTER/myRemnawave/v0.1.0/apps/machine-agent/install.sh \
  | sh -s -- \
      --panel-url https://panel.example.com/api/machine-enrollment \
      --token 'one-time-token-from-the-panel'
```

The enrollment token expires after 15 minutes and is invalidated after its
first successful use. Do not save it in scripts or configuration management.

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
