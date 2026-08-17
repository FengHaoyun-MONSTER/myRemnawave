# Test panel deployment

The `Deploy Test Panel` GitHub Actions workflow installs and updates the panel at
`alipaneltest.thinderbox.com`. It is intentionally limited to a fresh
development/test server and must not be reused for production.

## Security and scope

- The workflow requires the explicit confirmation value `DEPLOY_TEST_PANEL`.
- DNS must resolve to the configured SSH host.
- The scanned Ed25519 SSH host key must match
  `DEV_SERVICE_SSH_HOST_KEY_SHA256` before authentication.
- The source archive is created from the dispatched Git commit and is verified
  by SHA-256 after upload.
- Docker packages come from the official Docker APT repository or its Aliyun
  mirror; both paths require the pinned Docker signing-key fingerprint and APT
  signature verification.
- Docker Hub pulls use DaoCloud's registry mirror for restricted networks. All
  production images and the Dockerfile frontend remain pinned by SHA-256 digest.
- Secrets are generated on the server with mode `0600`; they are not returned to
  GitHub Actions or stored in the repository.
- PostgreSQL, Valkey, and the panel API have no host-published ports. Only Caddy
  publishes HTTP/HTTPS.
- The machine-control listener and node-protocol certificates are not enabled by
  this panel-only deployment.

## Layout and rollback points

The persistent deployment root is `/opt/myremnawave-panel`:

- `.env` contains persistent generated secrets.
- `releases/<commit>` contains immutable source releases.
- `current` points to the verified active release.
- `previous` points to the prior release after an update.
- `backups/<timestamp>-<commit>` contains previous manifests and, on updates, a
  PostgreSQL custom-format dump created before the new panel starts.
- Docker named volumes persist the database and Caddy certificate state.

Application rollback uses the previous source/image and manifests. Database
migrations are forward operations; restoring a database dump is a separate,
explicitly destructive recovery action and is never performed automatically.

## Verification

The deployment script waits for database and panel health, waits for Caddy to
serve a publicly trusted certificate for the configured hostname, and performs
an HTTPS request through Caddy. The workflow then repeats public HTTPS and
security-header smoke checks from the GitHub-hosted runner.
