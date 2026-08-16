# myRemnawave

myRemnawave is an AGPL-compatible development fork and orchestration layer for
Remnawave. Its goal is to make a physical server a first-class managed machine
that can safely run independent Reality, VLESS TLS Vision, and Hysteria2 node
instances.

The project is under active development and is **not production-ready**.

## Confirmed scope

- one-time machine enrollment without storing SSH credentials in the panel;
- three versioned, reusable protocol templates;
- independent node authorization, hosts, certificates, status, and traffic;
- node-local ACME certificates and Reality private keys;
- machine-level Cloudflare WARP with configuration-driven routing;
- staged configuration rollout and an auditable update center;
- Debian 12, Ubuntu 22.04 LTS, and Ubuntu 24.04 LTS test coverage.

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
