#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu

repository='FengHaoyun-MONSTER/myRemnawave'
release_version=''
panel_domain=''
asset_dir=''
deploy_root='/opt/myremnawave-panel'

log() {
    printf '[panel-install] %s\n' "$*"
}

die() {
    printf '[panel-install] ERROR: %s\n' "$*" >&2
    exit 1
}

usage() {
    cat >&2 <<'EOF'
Usage:
  install-panel.sh --domain panel.example.com --version panel-vX.Y.Z

Options:
  --domain DOMAIN       Public panel domain with an A record for this server.
  --version VERSION     Exact panel-vX.Y.Z GitHub release to install.
  --asset-dir PATH      Use pre-downloaded release assets from PATH.
  --help                Show this help text.
EOF
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "Required command is unavailable: $1"
}

download_asset() {
    asset_name="$1"
    target="$2"

    if [ -n "${asset_dir}" ]; then
        [ -f "${asset_dir}/${asset_name}" ] \
            || die "Release asset is missing from --asset-dir: ${asset_name}"
        cp "${asset_dir}/${asset_name}" "${target}"
        return
    fi

    release_base_url="${MYREMNAWAVE_RELEASE_BASE_URL:-https://github.com/${repository}/releases/download}"
    curl --fail --silent --show-error --location \
        --proto '=https' --tlsv1.2 \
        --retry 6 --retry-delay 3 --retry-all-errors \
        --connect-timeout 20 --max-time 1800 \
        --output "${target}" \
        "${release_base_url}/${release_version}/${asset_name}"
}

resolve_public_ipv4() {
    public_ip=''
    for endpoint in 'https://api.ipify.org' 'https://checkip.amazonaws.com'; do
        public_ip="$(curl --fail --silent --show-error --location \
            --proto '=https' --tlsv1.2 \
            --retry 2 --connect-timeout 10 --max-time 30 \
            "${endpoint}" 2>/dev/null | tr -d '[:space:]' || true)"
        if printf '%s' "${public_ip}" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
            printf '%s\n' "${public_ip}"
            return 0
        fi
    done
    return 1
}

check_fresh_install() {
    install_intent="${deploy_root}/.install-intent"

    if [ -L "${deploy_root}/current" ] || [ -f "${deploy_root}/.deployment.env" ]; then
        die 'A panel installation already exists. This installer only supports fresh installations.'
    fi

    if [ -f "${install_intent}" ]; then
        grep -Fqx "PANEL_DOMAIN=${panel_domain}" "${install_intent}" \
            || die 'A failed installation for another panel domain already exists.'
        grep -Fqx "PANEL_VERSION=${release_version}" "${install_intent}" \
            || die 'A failed installation for another panel version already exists.'
        log 'Resuming the matching incomplete installation.'
        return 0
    fi

    if [ -d "${deploy_root}" ] && find "${deploy_root}" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
        die "${deploy_root} is not empty and was not created by this installer."
    fi

    return 1
}

check_port_available() {
    protocol="$1"
    port="$2"

    case "${protocol}" in
        tcp)
            protocol_label='TCP'
            listeners="$(ss -H -ltn 2>/dev/null || true)"
            ;;
        udp)
            protocol_label='UDP'
            listeners="$(ss -H -lun 2>/dev/null || true)"
            ;;
        *) die 'Internal error: unsupported port-check protocol.' ;;
    esac

    if printf '%s\n' "${listeners}" | awk '{ print $4 }' \
        | grep -Eq "(^|:|\\])${port}$"; then
        die "Required ${protocol_label} port ${port} is already in use."
    fi
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --domain)
            [ "$#" -ge 2 ] || { usage; exit 2; }
            panel_domain="$2"
            shift 2
            ;;
        --version)
            [ "$#" -ge 2 ] || { usage; exit 2; }
            release_version="$2"
            shift 2
            ;;
        --asset-dir)
            [ "$#" -ge 2 ] || { usage; exit 2; }
            asset_dir="$2"
            shift 2
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            usage
            exit 2
            ;;
    esac
done

[ "$(id -u)" -eq 0 ] || die 'The installer must run as root.'
printf '%s' "${panel_domain}" \
    | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$' \
    || die 'A valid public panel domain is required.'
printf '%s' "${release_version}" | grep -Eq '^panel-v[0-9]+\.[0-9]+\.[0-9]+$' \
    || die 'The version must be an exact panel-vX.Y.Z release.'

# shellcheck source=/dev/null
. /etc/os-release
case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:22.04|ubuntu:24.04) ;;
    *) die 'Supported systems: Ubuntu 22.04 or Ubuntu 24.04.' ;;
esac
[ "$(uname -m)" = 'x86_64' ] || die 'The first panel installer release supports amd64 only.'

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --yes --no-install-recommends \
    bash ca-certificates curl gzip iproute2 openssl tar util-linux

require_command curl
require_command getent
require_command sha256sum
require_command ss
require_command tar

is_resume='no'
if check_fresh_install; then
    is_resume='yes'
fi

if [ "${is_resume}" = 'no' ]; then
    available_kb="$(df -Pk /opt | awk 'NR == 2 { print $4 }')"
    [ "${available_kb}" -ge 8388608 ] \
        || die 'At least 8 GiB of free space is required under /opt.'
    total_memory_kb="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
    [ "${total_memory_kb}" -ge 1900000 ] \
        || die 'At least 2 GiB of RAM is required.'

    check_port_available tcp 80
    check_port_available tcp 443
    check_port_available udp 443

    dns_ipv4="$(getent ahostsv4 "${panel_domain}" | awk '{ print $1 }' | sort -u)"
    [ -n "${dns_ipv4}" ] || die 'The panel domain has no IPv4 DNS result.'
    public_ipv4="$(resolve_public_ipv4)" \
        || die 'Unable to determine this server public IPv4 address for DNS validation.'
    printf '%s\n' "${dns_ipv4}" | grep -Fqx "${public_ipv4}" \
        || die 'The panel domain does not resolve to this server public IPv4 address.'

    install -d -m 0700 "${deploy_root}"
    umask 077
    cat >"${deploy_root}/.install-intent" <<EOF
PANEL_DOMAIN=${panel_domain}
PANEL_VERSION=${release_version}
EOF
fi

work_dir="$(mktemp -d /tmp/myremnawave-panel.XXXXXX)"
release_tmp=''
cleanup() {
    rm -rf -- "${work_dir}"
    if [ -n "${release_tmp}" ] && [ -d "${release_tmp}" ]; then
        rm -rf -- "${release_tmp}"
    fi
}
trap cleanup EXIT HUP INT TERM

image_asset='myremnawave-panel-linux-amd64.tar.gz'
source_asset='myremnawave-panel-source.tar.gz'
metadata_asset='panel-release-metadata'

log "Downloading and verifying ${release_version}."
download_asset 'SHA256SUMS' "${work_dir}/SHA256SUMS"
download_asset "${image_asset}" "${work_dir}/${image_asset}"
download_asset "${source_asset}" "${work_dir}/${source_asset}"
download_asset "${metadata_asset}" "${work_dir}/${metadata_asset}"

(cd "${work_dir}" && sha256sum --check --strict SHA256SUMS)

source_commit="$(awk -F= '$1 == "SOURCE_COMMIT" { count++; value=$2 } END { if (count == 1) print value }' "${work_dir}/${metadata_asset}")"
metadata_version="$(awk -F= '$1 == "PANEL_VERSION" { count++; value=$2 } END { if (count == 1) print value }' "${work_dir}/${metadata_asset}")"
printf '%s' "${source_commit}" | grep -Eq '^[0-9a-f]{40}$' \
    || die 'Release metadata contains an invalid source commit.'
[ "${metadata_version}" = "${release_version}" ] \
    || die 'Release metadata version does not match the requested version.'

image_sha256="$(awk -v name="${image_asset}" '$2 == name { count++; value=$1 } END { if (count == 1) print value }' "${work_dir}/SHA256SUMS")"
printf '%s' "${image_sha256}" | grep -Eq '^[0-9a-f]{64}$' \
    || die 'Release checksum manifest does not identify exactly one panel image.'

releases_root="${deploy_root}/releases"
release_dir="${releases_root}/${source_commit}"
install -d -m 0700 "${releases_root}"
if [ -e "${release_dir}" ]; then
    [ -f "${release_dir}/.source-commit" ] \
        || die 'Existing incomplete release directory has no provenance marker.'
    grep -Fqx "${source_commit}" "${release_dir}/.source-commit" \
        || die 'Existing release directory provenance mismatch.'
else
    release_tmp="$(mktemp -d "${releases_root}/.${source_commit}.new.XXXXXX")"
    if tar -tzf "${work_dir}/${source_asset}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
        die 'Unsafe path found in the source archive.'
    fi
    tar -xzf "${work_dir}/${source_asset}" -C "${release_tmp}" \
        --no-same-owner --no-same-permissions
    printf '%s\n' "${source_commit}" >"${release_tmp}/.source-commit"
    chmod 0700 "${release_tmp}/deploy/panel/deploy.sh"
    mv "${release_tmp}" "${release_dir}"
    release_tmp=''
fi

bash "${release_dir}/deploy/panel/deploy.sh" \
    "${release_dir}" \
    "${panel_domain}" \
    "${source_commit}" \
    "${work_dir}/${image_asset}" \
    "${image_sha256}"

rm -f -- "${deploy_root}/.install-intent"
log "Installation completed: https://${panel_domain}"
