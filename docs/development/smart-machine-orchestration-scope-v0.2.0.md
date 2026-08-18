# Smart Machine Orchestration v0.2.0: Development Scope

## 1. Verified starting state

- The working tree is clean and the current implementation is on `main`.
- Enrollment supports Debian 13 in the shell gate, but Agent runtime preflight
  rejects Debian 13.
- Debian 13 installs `docker.io` with `--no-install-recommends`; this can omit
  `docker-cli`, leaving no `docker` executable.
- Failed preflight cancels queued Machine commands, but the generic node health
  worker still enqueues node starts for disconnected managed nodes.
- Agent command results contain a safe message, but the backend persists only
  payload and error code; actionable failure detail is lost.
- Container replacement and lifecycle derive a name but do not first prove
  ownership labels, so a same-name foreign container is at risk.
- Current WARP reconcile installs, starts, registers, and reconfigures host WARP
  without ownership classification.
- Provisioning creates Node/Host rows and queues mutation before a durable,
  structured read-only resource plan exists.
- Machine query polling already runs every five seconds; the incorrect
  `PROVISIONING` display is primarily a backend state/diagnostic problem, not a
  missing polling timer.

## 2. In-scope work breakdown

### Batch A: correctness and observability stabilization

1. Align runtime OS support with installer support for Debian 12/13 and Ubuntu
   22.04/24.04.
2. Make Debian 13 package handling install/verify the Docker CLI explicitly.
   Batch C then moves this behavior out of enrollment and into the approved
   typed dependency action.
3. Persist bounded, redacted Agent failure messages and expose them in Machine
   and node status.
4. Prevent generic node health checks from queuing lifecycle work for
   Agent-managed Machine nodes.
5. Require managed labels and matching Machine/instance identity before any
   existing container start, stop, replace, or remove.
6. Add regression tests for every verified defect before moving to Batch B.

Rollback point: one local commit containing only Batch A. It must not change the
public provisioning workflow or mutate a remote server.

### Batch B: discovery, durable plan, and automatic ports

1. Add versioned Agent command contracts for read-only host discovery and plan
   revalidation.
2. Represent machine-level and per-protocol checks with stable codes, severity,
   safe messages, and proposed actions.
3. Add a durable provisioning-plan model with expiry, request fingerprint,
   chosen TCP/UDP ports, blockers, and command linkage.
4. Split API flow into plan and apply. The UI may advance automatically when a
   clean plan is returned, but mutation cannot precede the plan.
5. Implement deterministic candidate selection, protocol/network independence,
   bounded race replan, and published-port immutability.
6. Change initial provisioning so blocked protocols do not poison healthy
   siblings and no dependent command escapes a failed prerequisite.

Rollback point: contract/database/API/Agent support is additive until the UI is
switched; old v0.1 provisioning remains disabled only after the new path passes
integration tests.

### Batch C: dependency and WARP ownership

1. Move Docker installation out of enrollment into an allowlisted, typed
   dependency action that consumes a valid discovery plan.
2. Classify Docker as absent, healthy external, unhealthy external, or managed;
   mutate only absent/managed states permitted by the baseline.
3. Add local WARP ownership metadata and discovery for install, registration,
   mode, proxy port, service health, and compatibility.
4. Implement absent install, managed repair, compatible external reuse, and
   explicit takeover-required states.
5. Add an explicit, audited WARP takeover endpoint guarded from 3X-UI use.
6. Preserve fail-closed routing and local-only relay behavior.

Rollback point: disabling new dependency actions leaves discovered external
resources untouched; rollback removes only positively owned myRemnawave runtime
resources and never uninstalls packages.

### Batch D: incremental management and UI

1. Add only missing protocols to an existing Machine.
2. Retry failed protocols in place with stable Node/Endpoint UUIDs.
3. Display the plan, final port, ownership, blocker, safe diagnostic, and
   per-protocol action state.
4. Preserve upstream sidebar/tab/button placement and all existing navigation.
5. Keep explicit independent publication and direct Node UUID squad grants.

Rollback point: the new Machine controls can be hidden without changing
existing published nodes, ports, profiles, Hosts, or grants.

## 3. Files and components expected to change

- `apps/machine-agent`: installer, protocol, executor, discovery, dependency,
  instance, WARP, and tests.
- `apps/backend/prisma`: additive migration for plans and command diagnostics.
- `apps/backend/libs/contract`: plan/apply/takeover contracts and response model.
- `apps/backend/src/modules/machines`: gateway validation, state machine,
  authorization, repositories, service/controller, and tests.
- `apps/backend/src/queue/_nodes`: managed-node health behavior and regression
  tests.
- `apps/frontend/src/pages/dashboard/machines` and Machine hooks: incremental
  workflow and diagnostics only; navigation structure remains unchanged.
- `docs`: architecture decision, runbook, test evidence, and requirement trace.

Changes to user subscription authorization, unrelated node creation, billing,
payment, notification providers, upstream navigation, or update center are out
of scope.

## 4. Engineering constraints

- No arbitrary command payloads; every Agent mutation is a bounded typed action.
- External input and Agent results are schema-validated and size-limited.
- Diagnostics are redacted before persistence and UI display.
- Database uniqueness and transactions enforce one protocol per Machine and
  retry idempotency.
- No new production dependency unless the existing standard library/project
  stack cannot satisfy a requirement.
- No remote mutation, push, tag, image publish, or deployment in local batches.
  A separate explicit authorization gate applies before real-server tests.

## 5. Completion gates

A batch is complete only when:

1. its acceptance cases have Red-to-Green or equivalent reproduction evidence;
2. affected unit/integration tests, lint, types, and builds pass;
3. no known Critical/High issue remains in the batch;
4. the diff contains no unrelated changes or secrets;
5. rollback behavior is tested or demonstrated;
6. documentation and stable error codes match implementation.

The whole change additionally requires real-server coexistence testing that
records process/container/file/port fingerprints before and after, proving that
3X-UI and other external resources were not modified.
