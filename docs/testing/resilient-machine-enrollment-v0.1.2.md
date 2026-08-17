# Resilient Machine Enrollment v0.1.2 test plan

Status: implementation validation

Scope is deliberately limited to Machine Agent enrollment and its dedicated
control listener. Protocol provisioning is exercised as an end-to-end consumer
but the Node, Host, Internal Squad, certificate, and WARP domain models are not
changed by this release.

## Quality gates

| Area | Gate | Required result |
| --- | --- | --- |
| Backend | format, lint, TypeScript, unit tests, build, migration deploy | PASS |
| Frontend | format, lint, typecheck, production build | PASS |
| Agent | race tests, vet, build, vulnerability scan | PASS |
| Installer | `sh -n`, ShellCheck, Debian 13 container, preflight failure | PASS |
| Deployment | Compose validation, ShellCheck, actionlint, image build | PASS |
| Security | secret scan, unauthenticated public Machine-control port rejection | PASS |

## Automated cases

| ID | Given / When | Then |
| --- | --- | --- |
| ENR-01 | A valid token and P-256 CSR are exchanged | Only the CSR leaves the Machine; certificate files commit atomically |
| ENR-02 | The server commits enrollment but the HTTP response is lost | Pending key/CSR/attempt remain and the next run reuses them |
| ENR-03 | The same token, attempt ID, and CSR retry within 30 minutes | Backend returns the exact stored certificate response |
| ENR-04 | A consumed token is retried with a changed attempt or CSR | Backend returns unauthorized and does not issue another certificate |
| ENR-05 | Two requests race to consume one token | One commit wins; the matching loser reads the committed replay response |
| ENR-06 | Control URL is absent or listener startup failed | Draft creation, token rotation, and enrollment fail closed with 503 |
| ENR-07 | A draft is created while control is ready | Token expiry is 30 minutes and UI displays its remaining lifetime |
| INS-01 | DNS/TCP/TLS/panel preflight fails | Installer exits before APT, Docker, binaries, or service files change |
| INS-02 | A prior run installed the binary but enrollment timed out | A same-version retry replaces verified artifacts and resumes enrollment |
| INS-03 | Credentials already committed | Retry validates credential files, skips token exchange, and starts service |
| INS-04 | A managed path is a symlink or credentials are incomplete | Installer refuses without overwriting files |
| TLS-01 | Listener starts without custom server-cert paths | In-memory CA-signed certificate contains the public hostname/IP SAN |
| TLS-02 | Client connects without a Machine certificate | TLS handshake is rejected before WebSocket upgrade |
| TLS-03 | Valid Agent connects with matching UUID/fingerprint | WebSocket session reaches hello/heartbeat and Machine becomes connected |
| DEP-01 | Existing test panel is upgraded | `.env` is backed up, control configuration is added once, migration applies, health stays green |
| DEP-02 | A validated alternate public control port is selected | Compose publishes that port to container TCP 3010 and enrollment returns the matching public URL |
| DEP-03 | An invalid, reserved, duplicate, or unmanaged control setting is supplied | Deployment fails closed without overwriting the unknown setting |

## Test-server acceptance

1. Deploy the reviewed main-branch commit through `Deploy Test Panel`.
2. Verify HTTPS, deployed revision, database migration, container health, host
   configured public Machine-control listener, and rejection of clients without
   an mTLS certificate.
3. Rotate the previously disclosed enrollment token in the UI.
4. Run the v0.1.2 root command on the Debian test Machine. A previous v0.1.1
   partial install must recover without manual deletion.
5. Verify the Agent reports `v0.1.2`, remains connected across a service restart,
   and no SSH credential or private key appears in panel data/logs.
6. Provision Reality first. When protocol DNS/email are supplied, add TLS Vision
   and Hysteria2, verify node-local ACME, WARP state, independent container
   health, configuration validation, explicit publication, and squad isolation.

Protocol-domain tests that require DNS records remain pending until the operator
provides those records. Their absence does not permit a false PASS.

## Rollback

- Application: restore the prior image and manifests through the deployment
  backup/current/previous release pointers.
- Environment: restore the backed-up `.env`; older backend versions require the
  newly added machine-control variables to be removed or paired with legacy
  certificate paths.
- Database: the migration only adds nullable columns and one unique index.
  Application rollback does not require dropping them. Database restore remains
  a separate explicit destructive action.
- Agent: stop/disable v0.1.2 and reinstall a prior verified release only if its
  credential format remains compatible; never delete Machine credentials as an
  automatic rollback step.
