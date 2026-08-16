# ADR-002: Outbound machine control plane

Status: accepted  
Date: 2026-08-16

## Context

The approved design requires one physical Machine to manage three isolated
protocol runtimes, certificates, WARP, and updates without exposing three public
management ports or storing SSH credentials in the panel.

## Decision

Install a small native Machine Agent as a systemd service. It establishes an
outbound mutually authenticated WebSocket session to the panel. The connection
uses a versioned JSON protocol with strict message-size limits, heartbeat,
bounded reconnect backoff, replay-safe command IDs, and explicit capability
negotiation.

The Agent accepts only typed declarative commands:

- inventory and preflight;
- reconcile protocol instance;
- reconcile certificate;
- reconcile WARP;
- start, stop, drain, and inspect a managed instance;
- stage, apply, verify, and roll back a pinned component version.

There is no arbitrary shell command. Subprocess execution uses fixed binaries,
fixed argument construction, sanitized inputs, timeouts, output limits, and
dedicated managed directories. Child RemnaNode management ports bind to loopback
only.

The Agent is implemented in Go to provide a small static binary with a minimal
host runtime dependency. The Go WebSocket client is pinned to
`github.com/coder/websocket`; the backend uses the maintained `ws` library.

## Consequences

- Machines need only outbound panel connectivity.
- Bootstrap is responsible for installing the Agent binary and trust material.
- Certificate rotation and session revocation must work without SSH.
- The Agent is privileged, so its command schema and filesystem/process
  boundaries receive independent security tests.

