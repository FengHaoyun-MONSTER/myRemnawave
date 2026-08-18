#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The manifest path is resolved from this script so the check also works outside the repository root.
# shellcheck disable=SC1091
source "${repository_root}/release-versions.env"

[[ "${AGENT_VERSION}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ "${PANEL_VERSION}" =~ ^panel-v[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ "${PANEL_VERSION#panel-}" = "${AGENT_VERSION}" ]]
[[ "${AGENT_RELEASE_NOTES}" =~ ^docs/releases/[a-zA-Z0-9._-]+\.md$ ]]
[[ "${PANEL_RELEASE_NOTES}" =~ ^docs/releases/[a-zA-Z0-9._-]+\.md$ ]]

test -s "${repository_root}/${AGENT_RELEASE_NOTES}"
test -s "${repository_root}/${PANEL_RELEASE_NOTES}"

grep -Fq -- \
    "agent_version=\"\${MYREMNAWAVE_AGENT_VERSION:-${AGENT_VERSION}}\"" \
    "${repository_root}/apps/machine-agent/install.sh"
grep -Fq -- \
    "const AGENT_VERSION = '${AGENT_VERSION}'" \
    "${repository_root}/apps/frontend/src/pages/dashboard/machines/machines.page.tsx"
grep -Fq -- \
    "/${AGENT_VERSION}/apps/machine-agent/install.sh" \
    "${repository_root}/apps/machine-agent/README.md"
grep -Fq -- \
    "--version ${AGENT_VERSION}" \
    "${repository_root}/apps/machine-agent/test-install-debian-13.sh"
grep -Fq -- \
    "--version ${AGENT_VERSION}" \
    "${repository_root}/apps/machine-agent/test-install-resume.sh"

grep -Fq -- \
    "releases/download/${PANEL_VERSION}/install-panel.sh" \
    "${repository_root}/README.md"
grep -Fq -- \
    "--version ${PANEL_VERSION}" \
    "${repository_root}/README.md"
grep -Fq -- \
    "--version ${PANEL_VERSION}" \
    "${repository_root}/docs/operations/test-panel-deployment.md"
grep -Fq -- \
    "readonly TEST_VERSION='${PANEL_VERSION}'" \
    "${repository_root}/deploy/panel/test-install-panel.sh"

printf 'Release versions are consistent: Agent %s, Panel %s\n' \
    "${AGENT_VERSION}" "${PANEL_VERSION}"
