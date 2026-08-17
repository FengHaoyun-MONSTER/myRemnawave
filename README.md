# myRemnawave

myRemnawave is an AGPL-compatible development fork and orchestration layer for
Remnawave. Its goal is to make a physical server a first-class managed machine
that can safely run independent Reality, VLESS TLS Vision, and Hysteria2 node
instances.

The project is under active development and is **not production-ready**.

## One-command test installation

The versioned installer deploys a fresh panel without compiling the frontend or
backend on the server. The first release supports Ubuntu 22.04/24.04 on amd64.
Before running it, point the panel domain's direct IPv4 `A` record to the new
server and make sure inbound TCP 80/443/3010 and UDP 443 are allowed. TCP 3010
is the dedicated mutual-TLS Machine Agent control channel; it does not accept
ordinary unauthenticated HTTP clients.

Replace `panel.example.com` and run as a user with `sudo` access:

```bash
bash -o pipefail -c "curl -fsSL --proto '=https' --tlsv1.2 \
  https://github.com/FengHaoyun-MONSTER/myRemnawave/releases/download/panel-v0.1.0/install-panel.sh \
  | sudo sh -s -- --domain panel.example.com --version panel-v0.1.0"
```

The installer accepts only an exact `panel-vX.Y.Z` release, verifies the source
and prebuilt image against the release SHA-256 manifest, validates DNS and free
ports, generates secrets locally, starts the digest-pinned stack, obtains the
panel HTTPS certificate, and waits for health checks. It refuses to overwrite
an existing installation and can resume the same interrupted first install.

After installation, open `https://panel.example.com` and create the first Super
Admin. This installer is for fresh test servers only; upgrades and rollback use
a separate managed workflow. See
[the test deployment runbook](docs/operations/test-panel-deployment.md) for
requirements, pre-downloaded assets, layout, and recovery details.

## Confirmed scope

- one-time machine enrollment without storing SSH credentials in the panel;
- three versioned, reusable protocol templates;
- independent node authorization, hosts, certificates, status, and traffic;
- node-local ACME certificates and Reality private keys;
- machine-level Cloudflare WARP with configuration-driven routing;
- staged configuration rollout and an auditable update center;
- Debian 12/13, Ubuntu 22.04 LTS, and Ubuntu 24.04 LTS test coverage.

The approved product baseline is
[docs/requirements/requirements-baseline-v1.0.md](docs/requirements/requirements-baseline-v1.0.md).

## Repository status

This repository is public. Never commit credentials, private keys, enrollment
tokens, server addresses intended to remain private, or test-environment secret
values. Test deployment credentials must be supplied through protected GitHub
Environments and GitHub Actions secrets.

## Upstream and licensing

Remnawave components are licensed under GNU AGPLv3. Imported components retain
their original license and copyright notices. Project-specific additions will
use SPDX identifiers and remain AGPL-compatible. See [LICENSES.md](LICENSES.md).
