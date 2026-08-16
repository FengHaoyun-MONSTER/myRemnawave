# myRemnawave engineering instructions

These instructions supplement the user's global engineering protocol.

## Scope and safety

- The approved product contract is
  `docs/requirements/requirements-baseline-v1.0.md`.
- This repository targets fresh development/test installations. Do not add
  production deployment or existing-data migration behavior without updating
  the baseline and obtaining approval.
- Never read or print secret values. Secret names may be inspected when needed
  to validate CI wiring.
- Never expose machine management ports, accept arbitrary shell text as an Agent
  command, store SSH credentials in the panel, or upload private keys.
- Do not push, publish images, run a GitHub deployment workflow, or mutate a
  remote test server without explicit authorization for that external action.

## Repository layout

- `apps/backend`: squashed subtree of `remnawave/backend`.
- `apps/frontend`: squashed subtree of `remnawave/frontend`.
- `apps/node`: squashed subtree of `remnawave/node`.
- `apps/machine-agent`: myRemnawave host control agent.
- `deploy`: local/test deployment manifests and bootstrap assets.
- `docs`: requirements, architecture decisions, operations, and testing.

Preserve every imported component's `LICENCE` file and copyright metadata.
Record upstream source commits in `UPSTREAM.md`. Do not copy Xboard source.

## Toolchains and checks

- Node.js: 24.x.
- Backend: `npm ci`, `npm run check`, `npm run build`.
- Frontend: `npm ci`, `npm run check`, `npm run typecheck`,
  `npm run start:build`.
- Node: `npm ci`, `npm run check`, `npm run typecheck`, `npm run build`.
- Machine Agent: `go test ./...`, `go vet ./...`, `go build ./cmd/...`.

Run the smallest relevant checks first, then the affected component's complete
quality gate. Do not change upstream tests or security behavior merely to make a
check pass.

## Data and contracts

- A Machine is a physical host. A Node Instance is a logical protocol runtime.
- Authorization is keyed by stable Node/Endpoint UUID, never by config tag.
- Runtime templates, node overrides, private material, and user injection are
  separate layers.
- Agent commands are typed, versioned, idempotent, allowlisted, and bounded by
  timeouts. Command output is size-limited and redacted before persistence.
- Database invariants require constraints and transactional multi-row updates.
- Public API or schema changes require contract, OpenAPI, migration, UI, and
test updates in the same change.
