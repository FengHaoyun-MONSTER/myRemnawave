#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf -- "${test_root}"' EXIT

git init --bare --quiet "${test_root}/remote.git"
git init --quiet --initial-branch=main "${test_root}/work"
git -C "${test_root}/work" config user.name 'Branch Guard Test'
git -C "${test_root}/work" config user.email 'branch-guard@example.invalid'
printf 'baseline\n' >"${test_root}/work/README"
git -C "${test_root}/work" add README
git -C "${test_root}/work" commit --quiet -m baseline
git -C "${test_root}/work" remote add origin "${test_root}/remote.git"
git -C "${test_root}/work" push --quiet -u origin main

run_hook() {
    local hook="$1"
    shift
    git -C "${test_root}/work" -c core.hooksPath=/dev/null \
        -c advice.detachedHead=false \
        -c safe.directory="${test_root}/work" \
        -c alias.run-hook="!f() { \"${hook}\" \"\$@\"; }; f" \
        run-hook "$@"
}

if run_hook "${repo_root}/.githooks/pre-commit"; then
    echo 'pre-commit accepted main.' >&2
    exit 1
fi

git -C "${test_root}/work" switch --quiet -c agent/test-branch
run_hook "${repo_root}/.githooks/pre-commit"
head_sha="$(git -C "${test_root}/work" rev-parse HEAD)"
zero='0000000000000000000000000000000000000000'

if printf 'refs/heads/agent/test-branch %s refs/heads/main %s\n' "${head_sha}" "${head_sha}" \
    | (cd "${test_root}/work" && "${repo_root}/.githooks/pre-push" origin ignored); then
    echo 'pre-push accepted a direct main push.' >&2
    exit 1
fi

printf 'refs/heads/agent/test-branch %s refs/heads/agent/test-branch %s\n' "${head_sha}" "${zero}" \
    | (cd "${test_root}/work" && "${repo_root}/.githooks/pre-push" origin ignored)

if printf 'refs/heads/agent/test-branch %s refs/heads/fix/unapproved %s\n' "${head_sha}" "${zero}" \
    | (cd "${test_root}/work" && "${repo_root}/.githooks/pre-push" origin ignored); then
    echo 'pre-push accepted an unapproved branch name.' >&2
    exit 1
fi

printf 'refs/tags/panel-v9.9.9 %s refs/tags/panel-v9.9.9 %s\n' "${head_sha}" "${zero}" \
    | (cd "${test_root}/work" && "${repo_root}/.githooks/pre-push" origin ignored)

if printf 'refs/tags/not-a-release %s refs/tags/not-a-release %s\n' "${head_sha}" "${zero}" \
    | (cd "${test_root}/work" && "${repo_root}/.githooks/pre-push" origin ignored); then
    echo 'pre-push accepted an unapproved tag.' >&2
    exit 1
fi

if printf 'refs/tags/v1x.2.3 %s refs/tags/v1x.2.3 %s\n' "${head_sha}" "${zero}" \
    | (cd "${test_root}/work" && "${repo_root}/.githooks/pre-push" origin ignored); then
    echo 'pre-push accepted a malformed release tag.' >&2
    exit 1
fi

echo 'Git branch guards passed.'
