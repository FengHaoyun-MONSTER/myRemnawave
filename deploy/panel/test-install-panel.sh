#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -Eeuo pipefail

readonly INSTALLER='/repo/deploy/panel/install-panel.sh'
readonly DEPLOY_ROOT='/opt/myremnawave-panel'
readonly TEST_DOMAIN='panel.example.com'
readonly TEST_VERSION='panel-v0.1.1'
readonly TEST_PUBLIC_PORT='3389'
readonly SOURCE_COMMIT='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

test_root="$(mktemp -d /tmp/myremnawave-installer-test.XXXXXX)"
cleanup() {
    rm -rf -- "${test_root}" "${DEPLOY_ROOT}"
}
trap cleanup EXIT

mock_bin="${test_root}/bin"
assets="${test_root}/assets"
source_root="${test_root}/source"
mkdir -p "${mock_bin}" "${assets}" "${source_root}/deploy/panel"

cat >"${mock_bin}/apt-get" <<'EOF'
#!/bin/sh
exit 0
EOF
cat >"${mock_bin}/curl" <<'EOF'
#!/bin/sh
printf '203.0.113.10\n'
EOF
cat >"${mock_bin}/getent" <<'EOF'
#!/bin/sh
printf '203.0.113.10 STREAM panel.example.com\n'
EOF
cat >"${mock_bin}/ss" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod 0755 "${mock_bin}/apt-get" "${mock_bin}/curl" "${mock_bin}/getent" "${mock_bin}/ss"

cat >"${source_root}/deploy/panel/Dockerfile" <<'EOF'
FROM scratch
EOF
cat >"${source_root}/deploy/panel/deploy.sh" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
[ "\$#" -eq 6 ]
[ "\$1" = '${DEPLOY_ROOT}/releases/${SOURCE_COMMIT}' ]
[ "\$2" = '${TEST_DOMAIN}' ]
[ "\$3" = '${SOURCE_COMMIT}' ]
[ -f "\$4" ]
[[ "\$5" =~ ^[0-9a-f]{64}\$ ]]
[ "\$6" = '${TEST_PUBLIC_PORT}' ]
if [ ! -f '${DEPLOY_ROOT}/.stub-failed-once' ]; then
    touch '${DEPLOY_ROOT}/.stub-failed-once'
    exit 42
fi
touch '${DEPLOY_ROOT}/.deployment.env'
ln -s "\$1" '${DEPLOY_ROOT}/current'
EOF
chmod 0755 "${source_root}/deploy/panel/deploy.sh"

printf 'test image archive\n' >"${assets}/myremnawave-panel-linux-amd64.tar.gz"
tar -czf "${assets}/myremnawave-panel-source.tar.gz" -C "${source_root}" .
cat >"${assets}/panel-release-metadata" <<EOF
PANEL_VERSION=${TEST_VERSION}
SOURCE_COMMIT=${SOURCE_COMMIT}
EOF
(
    cd "${assets}"
    sha256sum \
        myremnawave-panel-linux-amd64.tar.gz \
        myremnawave-panel-source.tar.gz \
        panel-release-metadata \
        >SHA256SUMS
)

installer=(
    sh "${INSTALLER}"
    --domain "${TEST_DOMAIN}"
    --version "${TEST_VERSION}"
    --machine-control-public-port "${TEST_PUBLIC_PORT}"
    --asset-dir "${assets}"
)

if PATH="${mock_bin}:${PATH}" "${installer[@]}"; then
    echo 'Installer did not propagate the simulated deployment failure.' >&2
    exit 1
else
    status="$?"
    [ "${status}" -eq 42 ]
fi
[ -f "${DEPLOY_ROOT}/.install-intent" ]
grep -Fqx "MACHINE_CONTROL_PUBLIC_PORT=${TEST_PUBLIC_PORT}" \
    "${DEPLOY_ROOT}/.install-intent"
[ ! -e "${DEPLOY_ROOT}/current" ]

PATH="${mock_bin}:${PATH}" "${installer[@]}"
[ ! -e "${DEPLOY_ROOT}/.install-intent" ]
[ -L "${DEPLOY_ROOT}/current" ]
[ -f "${DEPLOY_ROOT}/.deployment.env" ]

if PATH="${mock_bin}:${PATH}" "${installer[@]}"; then
    echo 'Installer overwrote an existing installation.' >&2
    exit 1
fi

if PATH="${mock_bin}:${PATH}" sh "${INSTALLER}" \
        --domain "${TEST_DOMAIN}" \
        --version "${TEST_VERSION}" \
        --machine-control-public-port 443 \
        --asset-dir "${assets}"; then
    echo 'Installer accepted a reserved machine-control public port.' >&2
    exit 1
fi

echo 'Fresh install, safe resume, and overwrite protection: PASS'
