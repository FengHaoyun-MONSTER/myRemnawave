# myRemnawave Machine Agent

The Machine Agent is a native, root-owned host service that maintains an
outbound mTLS WebSocket session to the panel. It executes only typed,
allowlisted reconciliation commands and never exposes an arbitrary shell API.

The current development slice implements one-time CSR enrollment, secure
configuration loading, inventory, preflight, idempotent command replay,
protocol framing, mTLS, bounded message sizes, heartbeat, and reconnect
backoff. Protocol, certificate, WARP, and update reconcilers are added behind
the same command registry.

Enrollment generates an ECDSA P-256 key on the Machine. The private key is
never sent to the panel; the Agent submits only a PKCS#10 CSR and atomically
installs the returned client certificate, CA certificate, and environment file.
Existing credential directories are never overwritten.

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

The Agent requires Go 1.25 for development. Deployment uses a statically built
Linux binary and the hardened systemd unit in `packaging/systemd`.
