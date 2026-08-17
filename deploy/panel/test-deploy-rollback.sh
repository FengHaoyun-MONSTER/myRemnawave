#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=deploy/panel/deploy.sh
source "${repo_root}/deploy/panel/deploy.sh"

test_root="$(mktemp -d)"
trap 'rm -rf -- "${test_root}"' EXIT

deploy_root="${test_root}/runtime"
previous_release="${test_root}/releases/1111111111111111111111111111111111111111"
mkdir -p "${deploy_root}" "${previous_release}/deploy/panel"
printf '%s\n' '1111111111111111111111111111111111111111' \
    >"${previous_release}/.source-commit"
printf '%s\n' '# legacy deployer without automatic machine control TLS' \
    >"${previous_release}/deploy/panel/deploy.sh"

cat >"${deploy_root}/.env" <<'EOF'
APP_PORT=3000
MACHINE_CONTROL_PUBLIC_URL=wss://panel.example.com:3010/api/machine-control
MACHINE_CONTROL_PORT=3010
EOF
cat >"${deploy_root}/.deployment.env" <<'EOF'
DEPLOY_ROOT=/opt/myremnawave-panel
PANEL_DOMAIN=panel.example.com
PANEL_IMAGE_TAG=2222222222222222222222222222222222222222
EOF

prepare_rollback_configuration \
    "${deploy_root}/.env" \
    "${deploy_root}/.deployment.env" \
    "${previous_release}" \
    '/opt/myremnawave-panel' \
    'panel.example.com'

grep -Fqx 'APP_PORT=3000' "${deploy_root}/.env"
if grep -q '^MACHINE_CONTROL_' "${deploy_root}/.env"; then
    printf 'legacy rollback retained incompatible machine control variables\n' >&2
    exit 1
fi
grep -Fqx 'DEPLOY_ROOT=/opt/myremnawave-panel' "${deploy_root}/.deployment.env"
grep -Fqx 'PANEL_DOMAIN=panel.example.com' "${deploy_root}/.deployment.env"
grep -Fqx 'PANEL_IMAGE_TAG=1111111111111111111111111111111111111111' \
    "${deploy_root}/.deployment.env"
if grep -q '2222222222222222222222222222222222222222' \
    "${deploy_root}/.deployment.env"; then
    printf 'rollback retained the failed deployment image tag\n' >&2
    exit 1
fi

printf 'panel rollback configuration tests passed\n'
