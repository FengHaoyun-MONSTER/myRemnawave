# Smart Machine Orchestration v0.2.0: Test Plan

Status: **CI, PostgreSQL migration, rollback, and test-panel deployment verified;
protocol data plane, 3X-UI coexistence, WARP routing, and browser acceptance
pending**

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

## 7. Local verification evidence (2026-08-18)

Environment: Windows workspace, Node/npm dependencies already installed, Go
toolchain available, Docker Desktop client present but daemon stopped, and no
local PostgreSQL listener.

| Area | Command | Result | Evidence |
|---|---|---|---|
| Backend schema | `npx prisma validate` with local placeholder URLs | PASS | schema valid |
| Backend static | `npm run check` | PASS | formatter and linter completed |
| Backend tests | `npm test` | PASS | 13 files, 49 tests, 0 failed/skipped, 9.39 s |
| Backend build | `npx rspack build` with `NODE_ENV=production` | PASS | compiled in 21.72 s |
| Frontend static | `npm run check` | PASS | no error; existing unrelated React warnings remain |
| Frontend types | `npm run typecheck` | PASS | zero type errors |
| Frontend build | `npm run typecheck`; `npx vite build` with `NODE_ENV=production` | PASS | 11,727 modules, built in 10.96 s |
| Agent tests | `go test ./...` | PASS | 14 tested packages plus command package, 0 failures |
| Agent static/build | `go vet ./...`; `go build ./cmd/...`; `sh -n install.sh` | PASS | zero errors |
| Agent coverage | `go test -coverprofile agent_coverage ./...` | PASS | 47.6% statement coverage overall |
| Production dependencies | `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org` in backend and frontend | PASS | 0 vulnerabilities in each package |
| Deployment safety helpers | `bash deploy/panel/test-machine-control-public-port.sh`; `bash deploy/panel/test-deploy-rollback.sh` | PASS | public-port validation and rollback configuration tests passed |
| Diff hygiene | `git diff --check` and redacted added-line secret scan | PASS | no whitespace errors or credential patterns |

Red-to-Green evidence for Batch D:

- repository tests first demonstrated that a healthy published node could be
  retried and that retry planning offered fallback ports for a published node;
  after the guard and immutable-port fix, the repository suite passes 8/8;
- frontend static checking rejected an impure `Date.now()` render-time call;
  after reusing the page clock state, the full frontend check/type/build gate
  passes;
- WARP takeover now has a regression test proving an incomplete `INSTALLING`
  ownership record cannot be reported as an idempotent success.
- the Machine-specific pool contract first rejected a pool containing its own
  preferred port; the contract now accepts a reusable Machine pool while the
  service removes the current preferred port per protocol;
- Docker bind-race tests first failed at `CONTAINER_RUN_FAILED`; the Agent now
  removes only the positively owned failed container, selects one remaining
  candidate, retries exactly once, and ends with `PORT_BIND_RACE_EXHAUSTED` if
  the second bind races too;
- discovery tests initially failed to compile because clock, DNS, host-firewall,
  and cloud-security-group facts were absent. The implemented checks now block
  only unsafe clock/DNS cases while infrastructure reachability uncertainty is
  reported as a non-mutating advisory;
- command-boundary tests prove nested successful discovery diagnostics are
  bounded and redacted before persistence, and a failed retry beside a healthy
  terminal sibling settles at `DEGRADED` instead of remaining indefinitely in
  `PROVISIONING`;
- imported-certificate tests prove DNS is revalidated before any managed file
  is created or copied, including `IMPORT_EXISTING`, and mismatches leave the
  managed certificate directory untouched;
- provisioning-order tests prove the global read-only resource preflight is
  queued before Docker installation and every protocol mutation; protocol
  preflight still requires a usable Docker runtime after the approved
  dependency step.

NOT RUN or environment-blocked:

- Prisma migration deployment/rollback against real PostgreSQL: no local
  PostgreSQL and Docker daemon is stopped. The additive SQL and Prisma schema
  validate statically, but database execution remains a release blocker;
- `go test -race ./...`: Windows Go race support requires a working CGO toolchain
  not present in this workspace;
- backend line/branch coverage: the lock file advertises Vitest coverage as an
  optional peer, but `@vitest/coverage-v8` is not installed;
- ShellCheck and actionlint: executables are not installed;
- the package build scripts use Unix-style inline environment variables, and
  the frontend has no `build` alias. Direct `npm run build` therefore exits 1
  on this Windows workspace; the equivalent typecheck and production
  Rspack/Vite commands above pass. No package-script portability change was
  made because it is outside this orchestration scope;
- installer mock/container, Linux systemd/Docker/WARP coexistence, 3X-UI
  before/after fingerprints, real protocol data plane, ACME/imported
  certificate, restart/reconnect, and desktop/mobile browser acceptance: these
  require the separately authorized test-server deployment gate.

The default npm mirror returned HTTP 404 for the audit endpoint; repeating the
same read-only audit against the official npm registry succeeded. No dependency
changes were made.

## 8. CI and authorized test-panel evidence (2026-08-19)

| Area | Evidence | Result |
|---|---|---|
| Protected PR gates | CI run `32168684941` | PASS: backend, frontend, Agent race tests, branch policy, deployment assets, and secret scan |
| Real PostgreSQL | `Deploy Test Panel` against PostgreSQL 18 | PASS: all four v0.2.0 additive migrations applied |
| Failure rollback | deployment run `32167559424` | PASS: duplicate API scope made the new panel unhealthy; the previous release was restored and became healthy automatically |
| Scope regression | Machine endpoint metadata test | Red: 11 endpoints/9 unique scopes; Green: all 11 unique after the focused fix |
| Test deployment | deployment run `32168929698`, source `756157f8d2ef43850e16561cb16328f588427238` | PASS: exact image provenance, database migration, container health, HTTPS, security headers, private service ports, and control-plane mTLS rejection |
| Runtime health | read-only SSH inspection | PASS: panel/database/Valkey healthy, panel restart count 0 |
| API bootstrap | bounded panel log inspection | PASS: scope catalog built with 181 endpoints and 245 grantable scopes; no duplicate-scope or unhandled-rejection error |
| Authorization smoke | unauthenticated `GET /api/machines/` | PASS: HTTP 401 |
| Branch hygiene | GitHub protection and local/remote branch audit | PASS: protected `main`, required PR checks, no force push/deletion, no stale feature branches |

The failed deployment was not ignored or retried in place. Its logs established
the duplicate-scope root cause, the workflow restored the prior release, a
focused Red-to-Green fix was merged through a second protected PR, and only then
was the exact new `main` commit deployed.

## 9. Remaining acceptance gates

- create and apply a real three-protocol Machine plan using authenticated panel
  access;
- verify Reality, VLESS TLS Vision, and Hysteria2 data planes with dedicated
  protocol domains and an ACME notification email;
- capture and compare complete 3X-UI service, listener, container, and file
  fingerprints before and after provisioning;
- exercise compatible, unregistered, incompatible, and explicitly authorized
  WARP states and verify route-level fail-closed behavior;
- restart the real Agent and managed protocol containers, replay commands, and
  verify identity and port stability;
- perform desktop/mobile browser, keyboard/focus, console, and network
  acceptance of the Machine wizard.

These tests were not bypassed with direct database writes or forged panel
credentials. They remain explicit test-server acceptance work and do not block
publishing the test-only v0.2.0 artifacts.
