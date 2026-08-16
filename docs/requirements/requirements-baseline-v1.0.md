# Requirements Baseline v1.0

Status: **Approved for development**  
Approval basis: the user accepted every recommended decision in the strict
alignment rounds and explicitly authorized the complete development workflow.  
Target: fresh development and test environments only.

## 1. Business objective

Replace the current multi-step Remnawave workflow with a machine-oriented,
one-stop flow:

1. enroll a physical server once;
2. select one or more standard protocols;
3. automatically provision isolated node instances, hosts, certificates, and
   WARP when required by configuration;
4. assign logical nodes directly to internal squads;
5. validate and explicitly publish healthy nodes;
6. maintain configuration and component versions with staged rollout,
   auditing, backup, and rollback.

Success means an administrator does not manually install Docker, edit Compose,
copy configuration JSON, run certificate/WARP scripts, or clone a profile only
to change a tag or certificate path.

## 2. Users and authorization

### 2.1 Administrator capabilities

- **Super Admin**: all machine, node, configuration, update, audit, archive, and
  purge operations.
- **Operator**: view and operate machines/nodes, manage hosts and squad
  assignments, and edit configuration drafts only when explicitly scoped.
- **Viewer**: read-only machine/node/certificate status; audit visibility may be
  granted separately.

Every permission is enforced by the backend. Hiding a UI control is not an
authorization boundary. Private keys are never exposed to any role.

### 2.2 End-user access

- An Internal Squad grants access directly to a logical Node Instance.
- Permissions from multiple squads are additive (set union).
- Config Profile UUIDs and inbound tags never grant access.
- A node's hosts inherit node access by default.
- A user is removed from the runtime and their active connections are dropped
  immediately only when no remaining squad grants that node.
- Subscription visibility and runtime user injection use the same effective
  node-access calculation.

## 3. Domain model

### 3.1 Machine

A Machine represents one physical server and owns:

- public/private addressing metadata and detected operating system;
- one outbound mTLS Machine Agent session;
- system capabilities and resource/port inventory;
- one shared WARP runtime when any selected configuration requires it;
- zero to three standard protocol Node Instances;
- update, backup, audit, and lifecycle state.

### 3.2 Node Instance

A Node Instance is a separately operable protocol runtime with an independent:

- UUID and stable Endpoint UUID;
- internal management port and external protocol port;
- container/process, health state, logs, and restart lifecycle;
- default host plus optional additional hosts;
- squad authorization and injected user set;
- traffic and operational status;
- node-specific keys/certificates.

Independent process/container isolation is required. One failed protocol must
not prevent healthy sibling instances from being published.

### 3.3 Protocol templates

Exactly three primary, versioned system templates are in scope:

1. VLESS + Reality + Vision over RAW/TCP, default `443/TCP`;
2. VLESS + TLS + Vision over RAW/TCP, default `8443/TCP`;
3. Hysteria2 with TLS and per-user UUID authentication, default `443/UDP`.

Hysteria2 has no additional obfuscation by default. Compatible obfuscation and
bandwidth parameters remain advanced options. If the current Remnawave Xray
core cannot pass a real Hysteria2 server/client test, a separately managed
Hysteria2 or sing-box runtime is permitted.

Templates contain reusable protocol, routing, outbound, sniffing, and logging
behavior. They do not contain a real machine domain, certificate path, private
key, user list, external address, or runtime port allocation.

Node-specific parameters are compiled into the final runtime configuration.
Inbound tags are runtime identifiers, not access-control identities.

## 4. Machine enrollment and control plane

- Enrollment uses one administrator-executed root bootstrap command.
- The command carries a short-lived, one-time, machine-bound token. Only a hash
  is retained server-side; replay and expired tokens are rejected.
- The panel does not store SSH credentials and does not mount a Docker socket.
- The Agent initiates an outbound mutually authenticated connection to the
  panel. Child management ports `2222`, `2223`, and `2224` bind locally and are
  not exposed publicly.
- Agent operations are allowlisted and declarative; arbitrary shell execution
  is not a panel API.
- Retries are bounded, idempotent, observable, and safe across reconnects.

## 5. Creation wizard and lifecycle

The wizard:

1. creates a Machine draft;
2. produces a one-time enrollment command;
3. waits for Agent connection and inventory;
4. selects Reality, TLS Vision, and/or Hysteria2 (all selected by default);
5. configures ports and creates one default Host per instance;
6. collects TLS/Hysteria2 domain and notification email;
7. collects or defaults the Reality camouflage target/SNI;
8. assigns Internal Squads;
9. runs DNS, port, resource, WARP, certificate, and runtime preflight checks;
10. provisions and validates each instance independently;
11. presents a result preview;
12. publishes only after an administrator explicitly confirms.

States are `DRAFT`, `ENROLLING`, `PROVISIONING`, `CONNECTED`,
`CONFIG_VALIDATED`, `PUBLISHED`, `DEGRADED`, `FAILED`, `DRAINING`, `DISABLED`,
and `ARCHIVED`. Failed work is resumable from the failed step.

The default external/internal port pairs are configurable. Port conflicts block
deployment and a published port is never silently changed.

## 6. Hosts and DNS

- Every Node Instance gets one default Host; additional Hosts are allowed.
- Reality accepts an IP or domain connection address and a separate camouflage
  target/SNI.
- TLS Vision and Hysteria2 default their Host address to their certificate
  domain.
- In v1 the administrator creates DNS records. The panel validates A/AAAA
  resolution and reachability but does not modify DNS providers.
- DNS mismatch can be saved as a draft but blocks certificate issuance and
  publication.

## 7. Cryptographic material and certificates

### 7.1 Reality

- Every Reality instance receives a unique key pair and Short ID set.
- The private key remains on the Machine; only the public key and necessary
  non-secret metadata reach the panel.
- The shared template provides a default camouflage target/SNI and permits a
  node override.

### 7.2 TLS Vision and Hysteria2

- Each instance has its own domain, notification email, and certificate binding.
- ACME HTTP-01 with challenge port 80 is the default automated mode.
- A single machine-level coordinator serializes challenges to avoid port 80
  contention.
- Initial issuance failure prevents publication.
- Renewal failure keeps the current valid certificate, retries with bounded
  backoff, and emits escalating expiry alerts.
- Once a certificate expires, affected Hosts are hidden and the protocol
  instance stops.
- Existing local certificates may be imported: the Agent validates domain,
  key/certificate match, permissions, and validity, then copies them into a
  mode-0600 managed directory without uploading the private key. Imported
  certificates are externally managed and receive expiry alerts but no
  automatic renewal.

## 8. WARP

- WARP routing remains configuration-driven through `WARP_OUT` and Xray routing
  rules.
- The three templates reference one versioned common WARP routing fragment.
- The initial fragment preserves the existing block/direct behavior and current
  AI-domain list while removing duplicate entries only.
- Detecting `WARP_OUT` makes a healthy machine-level WARP runtime a publication
  dependency. The Agent installs, registers, verifies, monitors, upgrades, and
  uninstalls WARP declaratively.
- All protocol instances on a Machine share the one local WARP proxy.
- The proxy is local-only and is never publicly exposed.
- Initial WARP failure blocks publication. A runtime outage marks affected nodes
  degraded, retries recovery, and alerts. WARP-targeted traffic fails closed;
  it never falls back to DIRECT. Non-WARP direct traffic remains available.
- ACME, Agent control traffic, and required system traffic bypass WARP.

## 9. Configuration versions and rollout

- Editing creates a draft; it never mutates the published version in place.
- Validation covers schema, core syntax, unresolved secrets, port contracts,
  and target runtime compatibility.
- Rollout order is preview, designated test node, selected canary batch, then
  explicit full rollout.
- Failure stops expansion and the affected node returns to its last known-good
  runtime version.
- Protocol/port/inbound removal is a breaking change that requires an impact
  preview and explicit confirmation. Existing Hosts are not silently rewritten.
- Optimistic concurrency prevents one administrator from overwriting another's
  newer draft.

## 10. Updates, backup, and rollback

- Stable official releases are the default source.
- Images are pinned to exact versions and digests; `latest` is prohibited for
  managed releases.
- Available signatures/checksums and release metadata are verified.
- Updates show current/latest versions, release date, changelog, compatibility,
  ignored releases, and history.
- Panel/database updates use a maintenance window: pause writes, back up the
  database/config/environment/certificate metadata, migrate, replace, and run
  health checks.
- The panel updates first, followed by a test Node/Agent, canary batches, the
  remaining nodes, and the subscription page.
- Failure stops expansion. Incompatible database rollback restores the backup
  and clearly reports the write-loss boundary.
- Unattended scheduled upgrades are out of scope; detection is automatic but a
  Super Admin confirms execution.

## 11. Disable, archive, and purge

- Disable immediately unpublishes the node and rejects new connections.
- A short configurable drain can precede container stop.
- Regular UI deletion archives records; runtime/configuration/statistics/audit
  evidence is retained for 30 days.
- Permanent purge requires separate Super Admin confirmation and is audited.
- A Machine cannot be removed until its child instances are handled.

## 12. Observability and audit

- Runtime logs default to 30-day retention.
- Administrator and update audit records default to 180-day retention.
- Audit captures actor, time, target, prior/new versions, result, and stable
  error code.
- Tokens, credentials, private keys, certificate keys, and user credentials are
  redacted. Full visited domains and traffic content are not logged.
- Machine, Agent, node, certificate, WARP, configuration rollout, and update
  states are searchable and exportable in redacted form.

## 13. Compatibility, scale, and quality

The tested server matrix is Debian 12, Ubuntu 22.04 LTS, and Ubuntu 24.04 LTS.
Each receives real Docker, systemd, WARP, HTTP-01, restart-recovery, and protocol
validation rather than install-script-only testing.

The v1 scale baseline is:

- 100 Machines;
- 300 logical Node Instances;
- 10,000 users.

Tests cover Agent connections, authorization changes, staged configuration,
status/usage ingestion, restart/reconnect, duplicate commands, timeouts,
rollback, and permission abuse. Proxy data-plane traffic load is measured
separately from control-plane scale.

No known Critical or High security issue may remain at a phase gate.

## 14. Phased delivery

### Phase 1: node lifecycle foundation

Machine/Agent enrollment, three protocol instances, Hosts, versioned templates,
node authorization, ACME/local certificates, WARP, explicit publication,
retry/rollback, and relevant UI/API/tests.

### Phase 2: managed updates

Update center, backup, maintenance mode, version/digest trust, canary/rolling
updates, rollback, and audit.

### Phase 3: system qualification

Full OS matrix, stability/failure recovery, scale, security review, operations
documentation, and test-environment acceptance. Quality checks also run in
Phases 1 and 2; they are not deferred to Phase 3.

## 15. Explicit non-goals

- migration of existing production Remnawave data;
- production deployment;
- DNS-01 and automatic Cloudflare DNS changes;
- storing SSH credentials or uploading private keys to the panel;
- protocols beyond the three system templates;
- per-user or per-squad WARP routing;
- WARP-to-DIRECT automatic fallback;
- unattended scheduled upgrades;
- a dedicated mobile application.

## 16. Core acceptance scenarios

1. **Given** a supported clean server, **when** an administrator runs one valid
   enrollment command and selects all protocols, **then** three isolated node
   instances are provisioned with independent status and no public management
   ports.
2. **Given** two nodes share a template/tag, **when** only Node A is granted to a
   squad, **then** the squad sees and authenticates only on Node A.
3. **Given** valid DNS and email, **when** TLS Vision or Hysteria2 is provisioned,
   **then** the Machine obtains, stores, and reloads its node-local certificate
   without a separate certificate script.
4. **Given** a configuration containing `WARP_OUT`, **when** it is published,
   **then** the Machine first verifies WARP and matching traffic exits through
   WARP while unmatched traffic stays DIRECT.
5. **Given** WARP later disconnects, **when** recovery is in progress, **then**
   matching traffic fails closed, direct traffic continues, and the UI reports
   degradation without leaking through DIRECT.
6. **Given** a user has two granting squads, **when** one grant is removed,
   **then** access remains; after the final grant is removed, the runtime removes
   the user and drops active connections immediately.
7. **Given** a bad canary configuration/update, **when** health checks fail,
   **then** rollout stops and the affected runtime returns to its last known-good
   version.
8. **Given** an initial ACME failure, **when** provisioning completes, **then**
   the affected node remains unpublished while healthy siblings may be
   published.
9. **Given** an unauthorized Operator/Viewer, **when** they attempt configuration
   publication, update, secret access, or purge through the API, **then** the
   backend denies the action and records a safe audit event.
10. **Given** a supported OS restart, **when** the Machine returns, **then** Agent,
    WARP, certificates, and published protocol instances recover to the intended
    state without manual scripts.

## 17. Change control

This baseline is the source of truth for implementation. A discovered conflict
with upstream architecture, an order-of-magnitude scope change, destructive
migration, or a new security/permission decision requires a documented baseline
change before the affected behavior is implemented.

