# ADR-001: Monorepo with tracked Remnawave subtrees

Status: accepted

Date: 2026-08-16

## Context

Machine, node, authorization, configuration, certificate, and UI changes cross
the existing backend, frontend, and node repositories. Independent forks would
make atomic contract changes and reproducible testing difficult.

## Decision

Use one myRemnawave repository. Import the official backend, frontend, and node
repositories under `apps/` with squashed git subtrees. Preserve their licenses
and record exact source commits in `UPSTREAM.md`.

New host-control functionality lives in `apps/machine-agent`. Deployment and
test orchestration live at the repository root. The subscription page remains a
pinned external component until a source change is required.

## Consequences

- Cross-component changes can be committed and tested atomically.
- Upstream merges require explicit subtree maintenance and conflict review.
- The repository remains AGPL-compatible and must publish corresponding source
when network users interact with modified AGPL services.
