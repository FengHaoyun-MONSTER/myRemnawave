# Panel Installer panel-v0.2.0

This fresh-install test release packages Smart Machine Orchestration and the
Machine Agent v0.2.0 enrollment flow. It is not a production release.

## Highlights

- one physical Machine can plan and operate isolated VLESS Reality, VLESS TLS
  Vision, and Hysteria2 node instances;
- resource discovery and durable plans run before Docker, WARP, certificate,
  or protocol mutations;
- occupied ports use deterministic fallbacks without changing external
  services;
- protocol failures are isolated and validated siblings can be published
  independently to selected internal squads;
- TLS and Hysteria2 certificates are requested on the node through HTTP-01 or
  imported from validated node-local paths;
- Docker and WARP ownership states are visible and unsafe takeover requires
  explicit administrator confirmation;
- additive database migrations retain retry diagnostics, provisioning plans,
  requester identity, and WARP ownership.

## Operational notes

- Install Machine Agent `v0.2.0`; earlier Agents do not implement the new
  discovery and dependency commands.
- HTTP-01 requires the protocol domain to resolve directly to the Machine and
  TCP port 80 to be reachable and free.
- The panel installer is for fresh Debian 13 or Ubuntu 22.04/24.04 amd64 test
  servers. Existing panel upgrades use the managed deployment workflow.
- The dedicated Machine control listener uses TLS 1.3 and requires a panel-
  issued client certificate.

The release includes a prebuilt panel image, exact source archive, metadata,
installer, and SHA-256 manifest. The installer verifies all assets before
starting the digest-pinned stack.
