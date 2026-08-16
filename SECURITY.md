# Security policy

myRemnawave is not production-ready. Security reports should be submitted
privately to the repository owner rather than opened as public issues.

## Secret handling

- Never commit SSH credentials, tokens, private keys, certificate private keys,
  WARP registration data, or production/test server secrets.
- GitHub Actions secrets must be used only from protected environments and
  manually dispatched workflows.
- Workflow output must mask secret values and must not print generated machine
  enrollment commands containing live tokens.
- The panel must not store machine SSH credentials.
- Reality and TLS private keys remain on their owning machine.

## Supported security boundary

The initial target is a fresh test installation. Existing production data
migration and production deployment are explicitly outside the approved v1.0
scope.

