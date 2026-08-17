#!/usr/bin/env bash
set -Eeuo pipefail

readonly DOCKER_APT_KEY_FINGERPRINT='9DC858229FC7DD38854AE2D88D81803C0EBFCD88'
readonly DOCKER_REGISTRY_MIRROR='https://docker.m.daocloud.io'
readonly DEFAULT_DEPLOY_ROOT='/opt/myremnawave-panel'

log() {
    printf '[panel-deploy] %s\n' "$*"
}

die() {
    printf '[panel-deploy] ERROR: %s\n' "$*" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "Required command is unavailable: $1"
}

install_docker() {
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        log 'Docker Engine and Compose are already installed.'
        return
    fi

    # shellcheck source=/dev/null
    . /etc/os-release
    [ "${ID:-}" = 'ubuntu' ] || die 'Automatic Docker installation only supports Ubuntu.'
    case "${VERSION_ID:-}" in
        22.04 | 24.04) ;;
        *) die "Unsupported Ubuntu version: ${VERSION_ID:-unknown}" ;;
    esac
    [ "$(dpkg --print-architecture)" = 'amd64' ] || die 'This test deployment supports amd64 only.'

    log "Installing Docker Engine from Docker's signed Ubuntu repository."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install --yes --no-install-recommends ca-certificates curl gnupg
    install -d -m 0755 /etc/apt/keyrings

    local key_tmp source_tmp probe_tmp key_fingerprint repository_base candidate
    key_tmp="$(mktemp)"
    source_tmp="$(mktemp)"
    probe_tmp="$(mktemp)"
    repository_base=''
    trap 'rm -f "${key_tmp:-}" "${source_tmp:-}" "${probe_tmp:-}"' RETURN

    for candidate in \
        'https://download.docker.com/linux/ubuntu' \
        'https://mirrors.aliyun.com/docker-ce/linux/ubuntu'; do
        : >"${key_tmp}"
        : >"${probe_tmp}"
        if ! curl --fail --show-error --silent --location \
            --retry 5 --retry-delay 2 --retry-all-errors \
            --connect-timeout 15 --max-time 90 \
            "${candidate}/gpg" -o "${key_tmp}"; then
            log "Docker repository endpoint is unavailable, trying the next signed mirror."
            continue
        fi
        key_fingerprint="$(gpg --batch --show-keys --with-colons "${key_tmp}" | awk -F: '$1 == "fpr" { print $10; exit }')"
        [ "${key_fingerprint}" = "${DOCKER_APT_KEY_FINGERPRINT}" ] \
            || die 'Docker APT signing key fingerprint mismatch.'
        if curl --fail --show-error --silent --location \
            --retry 5 --retry-delay 2 --retry-all-errors \
            --connect-timeout 15 --max-time 90 \
            "${candidate}/dists/${VERSION_CODENAME}/InRelease" -o "${probe_tmp}"; then
            repository_base="${candidate}"
            break
        fi
        log "Docker repository metadata is unavailable, trying the next signed mirror."
    done
    [ -n "${repository_base}" ] || die 'No verified Docker APT repository is reachable.'
    install -m 0644 "${key_tmp}" /etc/apt/keyrings/docker.asc

    cat >"${source_tmp}" <<EOF
Types: deb
URIs: ${repository_base}
Suites: ${VERSION_CODENAME}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
Architectures: amd64
EOF
    install -m 0644 "${source_tmp}" /etc/apt/sources.list.d/docker.sources

    apt-get -o Acquire::Retries=5 -o Acquire::https::Timeout=30 update
    apt-get -o Acquire::Retries=5 -o Acquire::https::Timeout=30 \
        install --yes --no-install-recommends \
        docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
    docker version >/dev/null
    docker compose version >/dev/null
    trap - RETURN
    rm -f "${key_tmp}" "${source_tmp}" "${probe_tmp}"
}

configure_docker_registry_mirror() {
    local daemon_config='/etc/docker/daemon.json'
    local mirror_tmp active_mirrors

    active_mirrors="$(docker info --format '{{json .RegistryConfig.Mirrors}}')"
    if printf '%s' "${active_mirrors}" | grep -Fq "${DOCKER_REGISTRY_MIRROR}"; then
        log 'Docker Hub mirror is already configured.'
        return
    fi
    [ ! -e "${daemon_config}" ] \
        || die 'Existing Docker daemon configuration does not contain the required registry mirror.'

    mirror_tmp="$(mktemp)"
    trap 'rm -f "${mirror_tmp:-}"' RETURN
    cat >"${mirror_tmp}" <<EOF
{
  "registry-mirrors": ["${DOCKER_REGISTRY_MIRROR}"]
}
EOF
    dockerd --validate --config-file "${mirror_tmp}" >/dev/null
    install -m 0644 "${mirror_tmp}" "${daemon_config}"
    systemctl restart docker

    active_mirrors="$(docker info --format '{{json .RegistryConfig.Mirrors}}')"
    printf '%s' "${active_mirrors}" | grep -Fq "${DOCKER_REGISTRY_MIRROR}" \
        || die 'Docker Hub mirror configuration did not become active.'
    trap - RETURN
    rm -f "${mirror_tmp}"
}

generate_secret_env() {
    local target="$1" domain="$2"
    local app_secret database_password metrics_password

    umask 077
    app_secret="$(openssl rand -hex 48)"
    database_password="$(openssl rand -hex 32)"
    metrics_password="$(openssl rand -hex 32)"

    cat >"${target}" <<EOF
APP_PORT=3000
METRICS_PORT=3001
API_INSTANCES=1
WORKER_INSTANCES=1
DATABASE_URL=postgresql://remnawave:${database_password}@database:5432/remnawave
DIRECT_URL=postgresql://remnawave:${database_password}@database:5432/remnawave
REDIS_SOCKET=/var/run/valkey/valkey.sock
APP_SECRET=${app_secret}
JWT_AUTH_LIFETIME=12
IS_TELEGRAM_NOTIFICATIONS_ENABLED=false
PANEL_DOMAIN=${domain}
FRONT_END_DOMAIN=https://${domain}
SUB_PUBLIC_DOMAIN=${domain}/api/sub
METRICS_USER=metrics
METRICS_PASS=${metrics_password}
WEBHOOK_ENABLED=false
POSTGRES_USER=remnawave
POSTGRES_PASSWORD=${database_password}
POSTGRES_DB=remnawave
EOF
    chmod 0600 "${target}"
}

wait_for_service() {
    local container="$1" expected="$2" attempts="$3"
    local state=''

    for ((i = 1; i <= attempts; i++)); do
        state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container}" 2>/dev/null || true)"
        if [ "${state}" = "${expected}" ]; then
            return 0
        fi
        if [ "${state}" = 'unhealthy' ] || [ "${state}" = 'exited' ] || [ "${state}" = 'dead' ]; then
            return 1
        fi
        sleep 5
    done
    return 1
}

main() {
    [ "$#" -eq 3 ] || die 'Usage: deploy.sh RELEASE_DIRECTORY PANEL_DOMAIN SOURCE_COMMIT'
    [ "$(id -u)" -eq 0 ] || die 'Deployment must run as root.'

    local release_dir="$1" panel_domain="$2" source_commit="$3"
    local deploy_root="${MYREMNAWAVE_DEPLOY_ROOT:-${DEFAULT_DEPLOY_ROOT}}"
    [[ "${panel_domain}" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]] \
        || die 'Panel domain is invalid.'
    [[ "${source_commit}" =~ ^[0-9a-f]{40}$ ]] || die 'Source commit must be a full Git SHA.'
    [ -f "${release_dir}/deploy/panel/Dockerfile" ] || die 'Release does not contain the panel Dockerfile.'
    [ -f "${release_dir}/.source-commit" ] || die 'Release provenance marker is missing.'
    grep -Fqx "${source_commit}" "${release_dir}/.source-commit" || die 'Release provenance marker mismatch.'

    install_docker
    configure_docker_registry_mirror
    require_command curl
    require_command openssl

    install -d -m 0700 "${deploy_root}" "${deploy_root}/releases" "${deploy_root}/backups"

    if [ ! -f "${deploy_root}/.env" ]; then
        log 'Generating persistent panel and database secrets.'
        generate_secret_env "${deploy_root}/.env" "${panel_domain}"
    else
        chmod 0600 "${deploy_root}/.env"
        grep -Fqx "PANEL_DOMAIN=${panel_domain}" "${deploy_root}/.env" \
            || die 'Existing deployment is configured for another panel domain.'
    fi

    local build_time image_tag
    build_time="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    image_tag="myremnawave-panel:${source_commit}"
    log "Building panel image from source commit ${source_commit}."
    docker build --pull \
        --file "${release_dir}/deploy/panel/Dockerfile" \
        --tag "${image_tag}" \
        --build-arg "PANEL_DOMAIN=${panel_domain}" \
        --build-arg "SOURCE_COMMIT=${source_commit}" \
        --build-arg "BUILD_TIME=${build_time}" \
        "${release_dir}"

    local backup_dir previous_release=''
    backup_dir="${deploy_root}/backups/$(date -u +'%Y%m%dT%H%M%SZ')-${source_commit:0:12}"
    install -d -m 0700 "${backup_dir}"
    if [ -L "${deploy_root}/current" ]; then
        previous_release="$(readlink -f "${deploy_root}/current")"
    fi
    for file in compose.yml Caddyfile .deployment.env; do
        if [ -f "${deploy_root}/${file}" ]; then
            cp -a "${deploy_root}/${file}" "${backup_dir}/${file}"
        fi
    done

    install -m 0644 "${release_dir}/deploy/panel/compose.yml" "${deploy_root}/compose.yml.next"
    install -m 0644 "${release_dir}/deploy/panel/Caddyfile" "${deploy_root}/Caddyfile.next"
    cat >"${deploy_root}/.deployment.env.next" <<EOF
DEPLOY_ROOT=${deploy_root}
PANEL_DOMAIN=${panel_domain}
PANEL_IMAGE_TAG=${source_commit}
EOF
    chmod 0600 "${deploy_root}/.deployment.env.next"
    mv -f "${deploy_root}/compose.yml.next" "${deploy_root}/compose.yml"
    mv -f "${deploy_root}/Caddyfile.next" "${deploy_root}/Caddyfile"
    mv -f "${deploy_root}/.deployment.env.next" "${deploy_root}/.deployment.env"

    local compose=(docker compose --project-name myremnawave --env-file "${deploy_root}/.env" --env-file "${deploy_root}/.deployment.env" --file "${deploy_root}/compose.yml")
    "${compose[@]}" config --quiet

    if [ -n "${previous_release}" ]; then
        log 'Creating a pre-deployment database backup.'
        if "${compose[@]}" ps --status running database --quiet | grep -q .; then
            umask 077
            # shellcheck disable=SC2016
            "${compose[@]}" exec -T database sh -c \
                'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' \
                >"${backup_dir}/database.dump"
        fi
    fi

    log 'Starting the database, cache, panel, and HTTPS proxy.'
    "${compose[@]}" up --detach --remove-orphans

    if ! wait_for_service myremnawave-panel healthy 48; then
        "${compose[@]}" ps
        "${compose[@]}" logs --tail 150 panel >&2 || true
        die "Panel failed its health check. Deployment files and any database backup are in ${backup_dir}."
    fi
    if ! wait_for_service myremnawave-caddy running 24; then
        "${compose[@]}" ps
        "${compose[@]}" logs --tail 150 caddy >&2 || true
        die "Caddy did not start. Deployment files are in ${backup_dir}."
    fi

    log 'Waiting for Caddy to obtain and serve the public TLS certificate.'
    local https_ready='no'
    for ((i = 1; i <= 36; i++)); do
        if curl --fail --silent --show-error --max-time 10 \
            --noproxy '*' \
            --resolve "${panel_domain}:443:127.0.0.1" \
            "https://${panel_domain}/" >/dev/null; then
            https_ready='yes'
            break
        fi
        sleep 5
    done
    if [ "${https_ready}" != 'yes' ]; then
        "${compose[@]}" logs --tail 150 caddy >&2 || true
        die "HTTPS smoke test failed. Deployment files are in ${backup_dir}."
    fi

    local next_link="${deploy_root}/.current-${source_commit}"
    ln -s "${release_dir}" "${next_link}"
    mv -Tf "${next_link}" "${deploy_root}/current"
    if [ -n "${previous_release}" ] && [ "${previous_release}" != "${release_dir}" ]; then
        local previous_link="${deploy_root}/.previous-${source_commit}"
        ln -s "${previous_release}" "${previous_link}"
        mv -Tf "${previous_link}" "${deploy_root}/previous"
    fi

    "${compose[@]}" ps
    log "Deployment completed for source commit ${source_commit}."
}

main "$@"
