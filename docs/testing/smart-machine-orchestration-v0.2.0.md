# Smart Machine Orchestration v0.2.0: Test Plan

Status: **Planned before implementation**

## 1. Test environments

1. Local Windows workspace for static checks, TypeScript tests/builds, Go unit
   tests, and mocked shell installer tests.
2. Ephemeral PostgreSQL matching CI for backend migrations and repository/API
   integration tests.
3. Authorized Linux test server for systemd, real Docker, real listeners,
   restart/reconnect, ACME/imported certificate, and WARP ownership tests.
4. Coexistence topology with pre-existing TCP `443` and `8443` owners. Before
   and after fingerprints include PID/start time, command line, service state,
   listening sockets, container IDs/config hashes, and relevant file hashes.

No production system is a test target. Real-server mutation starts only after a
separate explicit authorization for that environment.

## 2. Acceptance and risk matrix

| ID | Requirement or risk | Test level | Primary cases | Expected evidence |
|---|---|---|---|---|
| A01 | Debian 13 support | shell + Go + real host | clean install; daemon-only; missing CLI | supported preflight and usable Docker client/server |
| A02 | Failure diagnostics | contract + repository + API | failed/unsupported/oversize/redaction | stable code and bounded safe message persist and render |
| A03 | No retry storm | backend queue integration | failed preflight then 10 health cycles/reconnect | command count remains bounded; no start/apply escape |
| A04 | Container ownership | Go unit + real Docker | correct labels; missing/mismatched labels; same-name foreign container | foreign container unchanged; `OWNERSHIP_CONFLICT` |
| B01 | TCP/UDP planning | Go property/table tests | preferred free; fallback; TCP 443 busy/UDP 443 free; pool exhausted | deterministic non-conflicting selection per network |
| B02 | Plan durability | DB/API integration | expiry; request fingerprint; duplicate request; stale apply | idempotent plan; stale plan not blindly applied |
| B03 | Port race | Agent integration | bind selected port after plan | one bounded replan, then safe protocol failure |
| B04 | Failure isolation | DB/control integration | machine blocker; one protocol blocker; sibling success | correct cancellation boundary and independent publish |
| B05 | Published immutability | API/repository | retry/add sibling/reconnect after publish | published UUID/Endpoint/port remain unchanged |
| C01 | Docker coexistence | Agent unit + real host | absent; healthy external; stopped/broken external; managed | only absent/managed permitted mutations occur |
| C02 | WARP ownership | Agent unit + real host | absent; managed; compatible external; incompatible external | install/repair/reuse/takeover-required classification |
| C03 | 3X-UI priority | real coexistence | occupied ports; external WARP attested/in use | all before/after fingerprints equal |
| C04 | WARP fail closed | config + data-plane smoke | connected/disconnected; WARP/direct destinations | WARP routes do not leak to DIRECT; direct routes remain |
| C05 | HTTP-01 conflict | Agent/backend integration | port 80 free/busy; import valid/invalid cert | busy port blocks only node unless import validates |
| D01 | Incremental add | API/DB/Agent system | two published, add missing third | only third node/resources change |
| D02 | Retry identity | API/DB/system | failed protocol retried twice | same UUIDs; no duplicate; idempotent command |
| D03 | Independent publish | API/UI/system | 1 of 3 or 2 of 3 valid | only selected validated nodes exposed/granted |
| D04 | UI state | build + browser | loading/plan/blocker/provision/failed/validated/published | correct action and diagnostic; no false success |
| D05 | Layout regression | browser visual | desktop/mobile sidebar and Machine modal | upstream navigation/tabs/buttons retain placement |
| S01 | Authorization | controller/API | Viewer/Operator/Super Admin for plan/apply/takeover/publish | server-side denial/allow and safe audit |
| S02 | Secret handling | unit/integration + scan | tokens, keys, cert keys, Docker output | no secret in DB result, logs, snapshot, or UI |
| S03 | Bounded input/output | contract/fuzz | pools, messages, malformed payloads, duplicate fields | schema rejection without crash or unbounded storage |
| R01 | Restart/reconnect | real system | Agent/panel/Docker restart; duplicate command delivery | desired state recovers idempotently |
| R02 | Rollback ownership | unit + real Docker | failed create/apply; rollback with foreign resources | only owned resources revert; packages remain |

## 3. Required negative and boundary cases

- zero, one, maximum, duplicate, invalid, and exhausted port candidates;
- TCP and UDP sharing a number; wildcard IPv4/IPv6 binds; localhost-only binds;
- listener disappears between discovery and apply; listener appears between the
  two; two simultaneous plans for one Machine;
- unsupported OS, insufficient memory/disk, missing systemd, clock/DNS failure;
- Docker CLI without daemon, daemon without CLI, permission denied, timeout,
  incompatible version, and foreign stopped service;
- foreign same-name Docker network/container and mismatched ownership labels;
- WARP CLI without service, unregistered service, wrong mode/port, disconnected
  managed service, compatible external service, and takeover denied;
- invalid domain/email, DNS mismatch, port 80 conflict, expired/mismatched
  imported certificate, and ACME timeout;
- Agent disconnect during plan, dependency apply, instance create, config apply,
  and result delivery; duplicate result and expired command deadline;
- retry after partial success, repeated retry click, add existing protocol, and
  publish a failed/stale/unvalidated node;
- diagnostic message at 0, 1, maximum, and over-limit length with token/private
  key-like content.

## 4. Execution order and quality gates

### Per implementation batch

1. Run the new regression/feature test before implementation where meaningful
   and record the expected failure.
2. Run the smallest changed-package tests until Green.
3. Run the complete affected package test suite.
4. Run format/lint/type/build gates.
5. Run migration and real PostgreSQL integration tests when schema changes.
6. Review acceptance trace, diff, secrets, ownership, timeout, retry, and error
   paths.

### Repository gates

- Agent: `go test -race ./...`, `go vet ./...`, `go build ./cmd/...`, installer
  mock tests, `sh -n install.sh`, and ShellCheck.
- Backend: `npm run check`, `npm test`, `npm run build`, Prisma generate and
  migration deploy against ephemeral PostgreSQL.
- Frontend: `npm run check`, `npm run typecheck`, `npm run start:build`.
- Node: run its existing check/type/build and relevant configuration tests only
  if generated runtime/config behavior changes.
- Repository: actionlint, deploy-script tests, dependency audit at high
  severity, and secret scan using the CI-equivalent commands.

## 5. Real-server sequence

1. Capture the coexistence fingerprints and verify the test target.
2. Enroll/update the Agent with no protocol selected and verify discovery is
   read-only.
3. Exercise occupied TCP `443`/`8443`, TCP/UDP independence, candidate fallback,
   and pool exhaustion using controlled listeners.
4. Exercise Docker absent/healthy-external/unhealthy-external states on isolated
   test instances; do not alter the real 3X-UI-owned runtime.
5. Exercise WARP cases only where ownership is known and reversible. Unknown or
   3X-UI-used WARP must stop at the takeover-required/forbidden state.
6. Provision one protocol, add a second, fail/retry a third, and publish healthy
   siblings independently.
7. Restart Agent and managed containers, repeat command delivery, and verify
   recovery and idempotency.
8. Re-capture all coexistence fingerprints and compare them byte/state-wise.
9. Run UI browser checks at desktop and mobile viewports and inspect console and
   network errors.
10. Roll back the test deployment and verify that system packages and all
   external resources remain.

## 6. Reporting requirements

The final report records each command, exit code, pass/fail/skip counts,
duration, environment, Red-to-Green evidence, migration result, coverage when
available, real-server fingerprints, browser screenshots, failures, unrun
items, and residual risk. “All tests passed” without this evidence is not an
acceptable report.
