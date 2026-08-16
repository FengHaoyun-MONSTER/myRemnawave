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
