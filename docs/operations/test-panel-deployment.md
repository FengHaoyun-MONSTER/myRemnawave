# Test panel deployment

The `Deploy Test Panel` GitHub Actions workflow installs and updates the panel at
`upcloudfreetier.thinderbox.com`. It is intentionally limited to a fresh
development/test server and must not be reused for production.

## Fresh-server installer

Stable test installations use the exact command documented in the repository
README. Each `panel-vX.Y.Z` GitHub Release contains:

- `install-panel.sh`, the non-interactive bootstrap;
- `myremnawave-panel-linux-amd64.tar.gz`, the prebuilt panel image;
- `myremnawave-panel-source.tar.gz`, the exact source and deployment assets;
- `panel-release-metadata`, binding the version to a full source commit;
- `SHA256SUMS`, covering the image, source, and metadata.

The installer supports fresh Debian 13 and Ubuntu 22.04/24.04 amd64 servers. It requires at
least 2 GiB RAM and 8 GiB free under `/opt`; a direct IPv4 `A` record must point
to the server, and TCP 80/443/3010 plus UDP 443 must be free and reachable. It stops
when an active installation exists. A matching `.install-intent` permits safe
retry of an interrupted first installation but cannot be reused for a different
domain or release.

For environments where GitHub downloads are performed in advance, download
`SHA256SUMS`, the image, source archive, and metadata into one server directory,
then run the downloaded installer with the additional option:

```bash
sudo sh install-panel.sh \
  --domain panel.example.com \
  --version panel-v0.1.1 \
  --asset-dir /path/to/release-assets
```

This avoids downloading the large panel assets during bootstrap. Docker APT
packages and digest-pinned infrastructure images still require network access;
it is not a fully air-gapped installation mode.

## Security and scope

- The workflow requires the explicit confirmation value `DEPLOY_TEST_PANEL`.
- DNS must resolve to the configured SSH host.
- The scanned Ed25519 SSH host key must match
  `DEV_SERVICE_SSH_HOST_KEY_SHA256` before authentication.
- GitHub Actions authenticates with the dedicated
  `DEV_SERVICE_SSH_PRIVATE_KEY` secret. Password authentication and `sshpass`
  are not used. `DEV_SERVICE_IP`, `DEV_SERVICE_SSH_PORT`, and
  `DEV_SERVICE_SSH_USER` identify the authorized test host.
- The source archive is created from the dispatched Git commit. The panel image
  is built on the GitHub-hosted runner from that same checkout, labeled with the
  full source commit, and exported as a compressed Docker archive. Both archives
  are independently verified by SHA-256 after upload; the server also verifies
  the loaded image's revision label before it can start.
- Docker packages come from the official Docker APT repository or its Aliyun
  mirror; both paths require the pinned Docker signing-key fingerprint and APT
  signature verification.
- Docker Hub pulls use DaoCloud's registry mirror for restricted networks. All
  production images and the Dockerfile frontend remain pinned by SHA-256 digest.
- Secrets are generated on the server with mode `0600`; they are not returned to
  GitHub Actions or stored in the repository.
- Before replacing an existing panel, the deployment saves its runtime files and
  database. If Compose startup, container health, Caddy, or the local HTTPS smoke
  test fails, it prints bounded container logs and restores the previous runtime
  files and image. The additive database migration is intentionally left in place.
- PostgreSQL, Valkey, and the panel API have no host-published ports. Caddy
  publishes HTTP/HTTPS, and the panel publishes only the dedicated TCP 3010
  Machine Agent listener.
- TCP 3010 requires a valid client certificate signed by the panel's private
  Machine CA. The listener certificate is generated in memory at backend start,
  contains the panel hostname SAN, and is never written to the host filesystem.

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

The server does not compile the application. It only installs Docker when
needed, loads the CI-built and verified image archive, pulls the digest-pinned
infrastructure images, and starts the Compose project. A non-blocking deployment
lock prevents two releases from mutating the panel stack concurrently.

## Verification

The deployment script waits for database and panel health, waits for Caddy to
serve a publicly trusted certificate for the configured hostname, and performs
an HTTPS request through Caddy. The workflow then repeats public HTTPS and
security-header smoke checks from the GitHub-hosted runner.
