# Machine control development notes

The Machine Agent uses two separate HTTPS/TLS surfaces:

- enrollment is a public REST endpoint protected by a 256-bit, machine-bound,
  one-time token with a 15-minute lifetime;
- ongoing control uses a dedicated TLS 1.3 WebSocket listener that requires a
  valid client certificate issued by the panel CA.

The Machine generates its own ECDSA P-256 key and sends only a signed CSR. The
panel certificate binds the Machine UUID as the certificate common name and
stores only its serial, SHA-256 fingerprint, and expiry. The private key never
leaves the Machine.

## Backend configuration

Configure all of the following or none of them:

```dotenv
MACHINE_CONTROL_PUBLIC_URL=wss://panel.example.com:3010/api/machine-control
MACHINE_CONTROL_TLS_CERT_PATH=/run/secrets/machine-control-server.crt
MACHINE_CONTROL_TLS_KEY_PATH=/run/secrets/machine-control-server.key
MACHINE_CONTROL_PORT=3010
```

The server certificate is the panel control-plane certificate and must cover
the hostname in `MACHINE_CONTROL_PUBLIC_URL`. It is unrelated to the separate,
node-local TLS Vision and Hysteria2 certificates. Those protocol certificates
remain on each Machine.

The control listener validates the full client chain, certificate expiry,
certificate common name, stored fingerprint, Machine state, protocol version,
message schema, and message size before accepting work. Commands are durable
and idempotent; reconnecting Agents can safely receive an unfinished command
again.

## Managed node model

A Machine can own one isolated container for each supported template:

- VLESS Reality Vision on TCP 443;
- VLESS TLS Vision on TCP 8443;
- Hysteria2 with UUID authentication on UDP 443.

Every instance uses a digest-pinned Node image, its own data directory and a
Docker-local control port. Reality private material and imported or ACME-issued
certificate private keys stay on the Machine. Shared configuration profiles
are immutable protocol templates; access is granted directly from an Internal
Squad to logical Nodes and never inferred from a profile tag.

The WARP reconciler installs Cloudflare's signed Linux package and exposes one
Docker-local SOCKS proxy shared by managed instances. Whether traffic uses that
outbound remains entirely declarative in the rendered routing rules. A WARP
failure degrades only WARP-routed traffic and does not silently fall back to a
direct route.

## Lifecycle and certificate behavior

Provisioning performs inventory, preflight, optional WARP reconciliation,
certificate issuance/import, instance creation, and configuration validation.
Hosts remain disabled until an administrator explicitly publishes the selected
Nodes to Internal Squads. Failed Nodes can be retried independently.

HTTP-01 issuance validates that the requested domain resolves to the Machine
before invoking Certbot. Renewal is scheduled before expiry. A still-valid
certificate remains active if renewal fails; an expired certificate blocks the
affected Host and stops that managed instance until recovery. Imported
certificates are monitored but never renewed automatically.

## Release boundary

Agent releases are produced only from explicit `vX.Y.Z` tags. The release
workflow runs race-enabled tests, creates Linux amd64/arm64 binaries, publishes
a hardened systemd unit, and includes a SHA-256 manifest. Creating a tag or
release and deploying a Machine are separate, explicitly authorized operations.
