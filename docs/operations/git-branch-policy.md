# Git branch and release policy

`main` is the only release and test-deployment source. It is a read-only local
mirror of `origin/main`; development commits belong on
`agent/<short-description>` branches and reach `main` only through a pull
request.

## Start work

```bash
git fetch --all --prune --tags
git switch main
git merge --ff-only origin/main
git switch -c agent/<short-description>
git config core.hooksPath .githooks
```

Before editing, `git status -sb` must show a clean feature branch and
`git merge-base --is-ancestor origin/main HEAD` must succeed.

## Publish work

1. Run the affected test, static-analysis, build, migration, and secret gates.
2. Verify the full `origin/main...HEAD` diff and confirm no unrelated files are
   staged.
3. Push only the feature branch and open a pull request targeting `main`.
4. Merge only after every required CI check passes and all review conversations
   are resolved.
5. Fetch with pruning after merge. GitHub deletes the merged feature branch;
   local merged branches may then be deleted.

Direct commits and pushes to `main`, detached-HEAD commits, unapproved branch
names, and release tags outside `origin/main` history are blocked. GitHub branch
protection is authoritative; local hooks are defense in depth.

## Recover an accidental local-main commit

Do not reset first. Preserve the commit, verify it, then restore only the local
tracking branch:

```bash
git switch -c agent/<short-description>
git branch --force main origin/main
```

Never force-push `main`. If the commit was already pushed, stop and use a
reviewed revert through a pull request.

## Deployment and release provenance

- `Deploy Test Panel` must be dispatched with `ref=main`; the workflow validates
  `GITHUB_REF=refs/heads/main` and deploys the exact `GITHUB_SHA`.
- Agent and panel release tags must match their version pattern and point to a
  commit already contained in `origin/main`.
- A feature branch can be tested by CI but cannot be deployed to the shared test
  server. Merge it first, fetch the resulting full `main` SHA, then dispatch the
  deployment for that exact commit.

## Versioned release sequence

1. Update `release-versions.env`, its referenced release-note files, and every
   version consumer enforced by `scripts/check-release-readiness.sh` on an
   `agent/*` branch.
2. Merge the release-readiness PR only after all required CI checks pass, then
   fetch and fast-forward local `main` to the exact `origin/main` commit.
3. Create and push only the Agent tag declared by `AGENT_VERSION`. Wait for the
   Agent release workflow and verify both binaries, the service unit, and
   `SHA256SUMS` before continuing.
4. Create and push only the panel tag declared by `PANEL_VERSION`. Its workflow
   refuses to run unless the required non-draft Agent release already contains
   all expected assets.
5. Verify the panel installer, image, source, metadata, and checksum manifest,
   then exercise the documented installer download URLs.

Do not push both tags together. Published tags and release assets are immutable;
fixes require a new patch version, not deletion or retargeting.
