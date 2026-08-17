#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=deploy/panel/deploy.sh
source "${repo_root}/deploy/panel/deploy.sh"

test_root="$(mktemp -d)"
trap 'rm -rf -- "${test_root}"' EXIT

generated_env="${test_root}/generated.env"
generate_secret_env "${generated_env}" 'panel.example.com' '3010'
grep -Fqx \
    'MACHINE_CONTROL_PUBLIC_URL=wss://panel.example.com:3010/api/machine-control' \
    "${generated_env}"
grep -Fqx 'MACHINE_CONTROL_PORT=3010' "${generated_env}"
[ "$(stat -c '%a' "${generated_env}")" = '600' ]

env_file="${test_root}/panel.env"
cat >"${env_file}" <<'EOF'
PANEL_DOMAIN=panel.example.com
MACHINE_CONTROL_PUBLIC_URL=wss://panel.example.com:3010/api/machine-control
MACHINE_CONTROL_PORT=3010
EOF

ensure_machine_control_env "${env_file}" 'panel.example.com' '3389'
grep -Fqx \
    'MACHINE_CONTROL_PUBLIC_URL=wss://panel.example.com:3389/api/machine-control' \
    "${env_file}"
grep -Fqx 'MACHINE_CONTROL_PORT=3010' "${env_file}"
[ "$(grep -c '^MACHINE_CONTROL_PUBLIC_URL=' "${env_file}")" -eq 1 ]
[ "$(grep -c '^MACHINE_CONTROL_PORT=' "${env_file}")" -eq 1 ]

ensure_machine_control_env "${env_file}" 'panel.example.com' '3389'
[ "$(grep -c '^MACHINE_CONTROL_PUBLIC_URL=' "${env_file}")" -eq 1 ]

deployment_env="${test_root}/deployment.env"
write_deployment_env \
    "${deployment_env}" '/opt/myremnawave-panel' 'panel.example.com' \
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' '3389'
grep -Fqx 'MACHINE_CONTROL_PUBLIC_PORT=3389' "${deployment_env}"

unmanaged_env="${test_root}/unmanaged.env"
cat >"${unmanaged_env}" <<'EOF'
MACHINE_CONTROL_PUBLIC_URL=wss://other.example.com:3010/api/machine-control
MACHINE_CONTROL_PORT=3010
EOF
if (ensure_machine_control_env "${unmanaged_env}" 'panel.example.com' '3389'); then
    echo 'Unmanaged machine-control URL was overwritten.' >&2
    exit 1
fi
grep -Fqx \
    'MACHINE_CONTROL_PUBLIC_URL=wss://other.example.com:3010/api/machine-control' \
    "${unmanaged_env}"

duplicate_env="${test_root}/duplicate.env"
cat >"${duplicate_env}" <<'EOF'
MACHINE_CONTROL_PUBLIC_URL=wss://panel.example.com:3010/api/machine-control
MACHINE_CONTROL_PUBLIC_URL=wss://panel.example.com:3389/api/machine-control
MACHINE_CONTROL_PORT=3010
EOF
if (ensure_machine_control_env "${duplicate_env}" 'panel.example.com' '3389'); then
    echo 'Duplicate machine-control URLs were accepted.' >&2
    exit 1
fi
[ "$(grep -c '^MACHINE_CONTROL_PUBLIC_URL=' "${duplicate_env}")" -eq 2 ]

invalid_internal_env="${test_root}/invalid-internal.env"
cat >"${invalid_internal_env}" <<'EOF'
MACHINE_CONTROL_PUBLIC_URL=wss://panel.example.com:3389/api/machine-control
MACHINE_CONTROL_PORT=3389
EOF
if (ensure_machine_control_env "${invalid_internal_env}" 'panel.example.com' '3389'); then
    echo 'A changed container-local machine-control port was accepted.' >&2
    exit 1
fi
grep -Fqx 'MACHINE_CONTROL_PORT=3389' "${invalid_internal_env}"

for invalid_port in 0 65536 abc 80 443 3000 3001 5432 6379; do
    if (validate_machine_control_public_port "${invalid_port}"); then
        echo "Invalid public port was accepted: ${invalid_port}" >&2
        exit 1
    fi
done
validate_machine_control_public_port 3010
validate_machine_control_public_port 3389

printf 'machine-control public port tests passed\n'
