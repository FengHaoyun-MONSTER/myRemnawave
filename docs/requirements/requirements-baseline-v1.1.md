# Requirements Baseline v1.1

Status: **Approved for development**

Approval basis: the user reviewed and accepted the recommended decisions for
resource discovery, automatic port selection, Docker and WARP coexistence,
protocol-level failure isolation, incremental provisioning, and phased delivery,
then explicitly authorized development.

Target: fresh development and test environments only. This baseline supersedes
v1.0 where the two differ. Requirements not amended below remain governed by
[`requirements-baseline-v1.0.md`](requirements-baseline-v1.0.md).

## 1. Safety and coexistence invariant

- Existing third-party workloads have priority over myRemnawave-managed work.
- In the current acceptance environment, 3X-UI has absolute priority. The Agent
  must not stop, restart, reconfigure, upgrade, remove, rename, or overwrite its
  services, processes, containers, ports, certificates, files, or WARP usage.
- A resource is mutable only after the Agent proves that it is owned by the
  same myRemnawave Machine and logical instance. A matching name alone is not
  proof of ownership.
- Discovery is read-only. Provisioning may start only after machine-level and
  target-protocol prerequisites are classified.
- The panel detects and reports host firewall and cloud-security-group risks,
  but does not change either automatically.

## 2. Discovery before mutation

The one-line enrollment command installs and enrolls the native Agent. It does
not require Docker to be present and does not make unrelated runtime changes.
After enrollment, the Agent returns a structured discovery result containing:

- supported OS, architecture, memory, disk, systemd, clock, and DNS facts;
- Docker CLI/daemon state and ownership classification;
- TCP and UDP listener conflicts relevant to requested protocols;
- local-only child control-port availability;
- HTTP-01 port 80 availability;
- WARP installation, registration, mode, proxy port, health, compatibility, and
  ownership classification;
- protocol-specific blockers and safe automatic actions;
- a redacted, stable error code and human-readable diagnostic for each check.

Discovery results are durable, time-bounded plans. Apply revalidates mutable
facts before changing the machine. A stale or conflicting plan is replanned or
fails safely; it is never applied blindly.

## 3. Automatic port planning

- External ports are selected automatically before first publication.
- Default TCP/TLS candidates are `443`, `8443`, `2053`, `2083`, `2087`, `2096`,
  `2443`, and `9443`. UDP starts with the protocol-preferred number and may use
  the same numeric fallback candidates because TCP and UDP are independent.
- Candidate pools are configurable globally and may be overridden per Machine.
- Reserved myRemnawave control ports and discovered occupied ports are excluded.
- The first suitable candidate is selected deterministically and shown in the
  plan and final node status.
- If all suitable candidates for one protocol are exhausted, only that protocol
  is blocked. Healthy siblings may continue.
- Apply rechecks the selected bind. A race triggers one bounded replan from the
  remaining pool; repeated conflict fails that protocol with a stable code.
- A published external port is immutable unless an administrator explicitly
  performs a separately previewed port-change operation. It is never silently
  changed during repair or retry.

This section replaces v1.0's rule that any initial port conflict blocks the
entire deployment.

## 4. Docker policy

- A healthy existing Docker CLI and daemon are reused without restart, upgrade,
  configuration change, or package mutation.
- If Docker is absent, the Agent may install the supported distribution package
  through a typed dependency action after discovery.
- Debian 13 must install both the daemon package and the CLI required by the
  runtime even when recommended packages are disabled.
- A stopped, broken, externally managed, or incompatible Docker installation is
  reported and blocks affected new work. It is not automatically restarted or
  upgraded unless myRemnawave can prove ownership.
- Rollback removes only positively identified myRemnawave containers, networks,
  and files. It does not uninstall system packages.

## 5. WARP ownership and compatibility

WARP remains host-installed and shared by the Machine. It is not installed in a
protocol container.

- **Absent WARP:** after discovery, a typed action may install and register a
  Machine-managed WARP runtime when selected configuration requires it.
- **Machine-managed WARP:** the Agent may repair its desired registration, mode,
  local proxy port, and connection using bounded retries.
- **Compatible external WARP:** it may be reused read-only without changing its
  registration, mode, port, service state, or package version.
- **Unknown or incompatible external WARP:** provisioning is blocked with
  `WARP_TAKEOVER_REQUIRED`. An explicit, audited takeover is required before any
  mutation.
- **WARP used by 3X-UI:** it is never eligible for takeover or mutation.
- Ownership is recorded locally and validated on every mutating operation.
- WARP-targeted traffic continues to fail closed; it never silently falls back
  to DIRECT.

WARP route selection remains configuration-driven. This phase does not add
per-user or per-squad WARP policy.

## 6. Failure boundaries and resumability

- Machine-level failures, such as unsupported OS, insufficient disk, or an
  unusable required container runtime, block all new protocol work.
- Protocol-level failures, such as exhausted ports or a node-specific
  certificate failure, block only the affected protocol.
- Healthy siblings can be validated and explicitly published independently.
- A failed protocol is retried in place with the same Node UUID and Endpoint
  UUID. Retry must not create a duplicate protocol node.
- A missing protocol can be added later to an existing Machine through the same
  discover, plan, apply, validate, and publish flow.
- Preflight or dependency failure cancels dependent commands. Health checking
  must not bypass that cancellation or create an unbounded command loop.
- Retries have a bounded attempt count and backoff. The UI exposes the last
  stable error code, safe diagnostic, failed step, and retry action.

## 7. Certificates

- TLS Vision and Hysteria2 keep node-local certificate ownership.
- HTTP-01 remains the only automatic ACME challenge in scope.
- If TCP port 80 is unavailable, the administrator may import an existing local
  certificate; otherwise only that TLS protocol remains blocked.
- DNS-01 and automatic DNS-provider mutation remain explicit non-goals.

## 8. Incremental management and UI

- A Machine may contain zero to three logical nodes, at most one for each of
  `VLESS_REALITY`, `VLESS_TLS_VISION`, and `HYSTERIA2`.
- The Machine view shows discovery facts, selected/fallback ports, dependency
  actions, protocol blockers, certificate state, WARP ownership, and safe error
  detail.
- Administrators can add a missing protocol, retry a failed protocol, and
  publish each validated protocol independently.
- The existing upstream Remnawave sidebar sections, tabs, and button placement
  remain stable. Machine management is integrated without converting the
  navigation to the earlier custom horizontal layout.
- Shared configuration templates remain configuration only. Tags and profile
  identity do not participate in node or squad authorization.

## 9. Delivery boundaries

This change is delivered in independently testable batches:

1. correctness and observability stabilization;
2. read-only discovery and automatic port planning;
3. Docker and WARP ownership-aware coordination;
4. incremental protocol management and UI completion.

Each batch requires relevant unit/integration tests, full affected-component
quality gates, a security/diff review, and a separate rollback point. No batch
may weaken 3X-UI protection to make a test pass.

## 10. Explicit non-goals for this change

- production deployment or migration of existing production data;
- the Phase 2 update center, unattended upgrades, or automatic GitHub release
  deployment;
- DNS-01 or DNS-provider API integration;
- automatic host-firewall or cloud-security-group changes;
- arbitrary remote shell execution, stored SSH credentials, or private-key
  upload;
- protocols beyond the three approved system templates;
- automatic repair, restart, upgrade, takeover, or deletion of unknown external
  Docker/WARP/container/service resources;
- automatic WARP takeover when 3X-UI usage cannot be disproved;
- changing published ports without a separate explicit operation.

## 11. Core acceptance scenarios

1. **Given** Debian 13 without Docker CLI, **when** dependency apply is approved,
   **then** the Agent installs a usable CLI and daemon and reports their versions.
2. **Given** TCP `443` and `8443` are owned by 3X-UI, **when** Reality and TLS
   Vision are planned, **then** free fallback TCP ports are selected and no 3X-UI
   process, file, port, certificate, container, or service is changed.
3. **Given** TCP `443` is occupied, **when** Hysteria2 checks UDP `443`, **then**
   TCP occupancy alone does not block the UDP candidate.
4. **Given** every candidate for Reality is occupied, **when** all three protocols
   are requested, **then** Reality is blocked while healthy TLS Vision and
   Hysteria2 work may continue.
5. **Given** a plan becomes stale because another process binds the selected
   port, **when** apply starts, **then** one bounded replan occurs and no existing
   process is stopped.
6. **Given** compatible external WARP, **when** a WARP-enabled config is planned,
   **then** it is reused without mutating registration, mode, port, service, or
   package state.
7. **Given** unknown or incompatible external WARP, **when** provisioning starts,
   **then** it stops at `WARP_TAKEOVER_REQUIRED` until an explicit audited
   decision; 3X-UI-used WARP remains ineligible.
8. **Given** a foreign container with the derived myRemnawave name, **when** an
   instance reconcile or lifecycle action runs, **then** ownership validation
   fails and the foreign container is not stopped or removed.
9. **Given** preflight fails, **when** repeated node health checks run, **then** no
   reconcile/apply/start command storm is created and the actionable diagnostic
   remains visible.
10. **Given** two protocols are published and the third is missing, **when** the
    administrator adds it, **then** only the missing protocol is planned and the
    published siblings keep their UUIDs, ports, configs, and running processes.
11. **Given** a failed protocol, **when** retry succeeds, **then** the existing
    Node UUID and Endpoint UUID are retained and no duplicate is created.
12. **Given** HTTP-01 port 80 is occupied, **when** no imported certificate is
    supplied, **then** only the affected TLS node is blocked with a clear remedy.

## 12. Change control

A discovered requirement to mutate third-party resources, modify production
data, add a new protocol, introduce DNS-01, change published ports implicitly,
or alter the authorization model requires a new baseline decision before code
is written for that behavior.
