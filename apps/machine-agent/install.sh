#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu

repository="FengHaoyun-MONSTER/myRemnawave"
agent_version="${MYREMNAWAVE_AGENT_VERSION:-v0.1.0}"
panel_url=""
enrollment_token=""

usage() {
    echo "usage: install.sh --panel-url https://panel.example/api/machine-enrollment --token TOKEN" >&2
    exit 2
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --panel-url) [ "$#" -ge 2 ] || usage; panel_url="$2"; shift 2 ;;
        --token) [ "$#" -ge 2 ] || usage; enrollment_token="$2"; shift 2 ;;
        --version) [ "$#" -ge 2 ] || usage; agent_version="$2"; shift 2 ;;
        *) usage ;;
    esac
done

[ "$(id -u)" -eq 0 ] || { echo "installer must run as root" >&2; exit 1; }
[ ! -e /etc/myremnawave-agent ] && [ ! -e /usr/local/lib/myremnawave-agent ] || {
    echo "Machine Agent is already installed; this bootstrap only supports fresh enrollment" >&2
    exit 1
}
case "$panel_url" in https://*) ;; *) echo "panel URL must use HTTPS" >&2; exit 1 ;; esac
case "$enrollment_token" in mrw_enroll_*) ;; *) echo "invalid enrollment token" >&2; exit 1 ;; esac
case "$agent_version" in v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "agent version must be an exact vX.Y.Z release" >&2; exit 1 ;; esac

. /etc/os-release
case "${ID:-}:${VERSION_ID:-}" in
    debian:12|ubuntu:22.04|ubuntu:24.04) ;;
    *) echo "supported systems: Debian 12, Ubuntu 22.04, Ubuntu 24.04" >&2; exit 1 ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --assume-yes --no-install-recommends ca-certificates curl gnupg
if ! command -v docker >/dev/null 2>&1; then
    apt-get install --assume-yes --no-install-recommends docker.io
fi
systemctl enable --now docker

case "$(uname -m)" in
    x86_64) asset_arch="amd64" ;;
    aarch64|arm64) asset_arch="arm64" ;;
    *) echo "unsupported CPU architecture" >&2; exit 1 ;;
esac

work_dir="$(mktemp -d /tmp/myremnawave-agent.XXXXXX)"
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
asset="myremnawave-agent-linux-${asset_arch}"
release_url="https://github.com/${repository}/releases/download/${agent_version}"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --output "$work_dir/$asset" "$release_url/$asset"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --output "$work_dir/SHA256SUMS" "$release_url/SHA256SUMS"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --output "$work_dir/myremnawave-agent.service" "$release_url/myremnawave-agent.service"
asset_checksum="$(awk -v name="$asset" '$2 == name { count++; line=$0 } END { if (count == 1) print line }' "$work_dir/SHA256SUMS")"
service_checksum="$(awk '$2 == "myremnawave-agent.service" { count++; line=$0 } END { if (count == 1) print line }' "$work_dir/SHA256SUMS")"
[ -n "$asset_checksum" ] && [ -n "$service_checksum" ] || {
    echo "release checksum manifest is incomplete or ambiguous" >&2
    exit 1
}
printf '%s\n%s\n' "$asset_checksum" "$service_checksum" > "$work_dir/SELECTED_SHA256SUMS"
(cd "$work_dir" && sha256sum --check --strict SELECTED_SHA256SUMS)

install -d -m 0755 /usr/local/lib/myremnawave-agent
install -m 0755 "$work_dir/$asset" /usr/local/lib/myremnawave-agent/myremnawave-agent
install -d -m 0755 /etc/systemd/system
install -m 0644 "$work_dir/myremnawave-agent.service" /etc/systemd/system/myremnawave-agent.service

/usr/local/lib/myremnawave-agent/myremnawave-agent enroll \
    --url "$panel_url" \
    --token "$enrollment_token"
systemctl daemon-reload
systemctl enable --now myremnawave-agent
systemctl --no-pager --full status myremnawave-agent
