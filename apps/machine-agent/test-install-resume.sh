#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu

[ "${MYREMNAWAVE_INSTALLER_TEST_CONTAINER:-}" = "1" ] || {
    echo "this destructive-path test must run only in its disposable container" >&2
    exit 1
}

installer="${1:-./install.sh}"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root" /etc/myremnawave-agent /etc/myremnawave-agent.enrollment /usr/local/lib/myremnawave-agent /etc/systemd/system/myremnawave-agent.service' EXIT HUP INT TERM
assets="$test_root/assets"
mock_bin="$test_root/bin"
mkdir -p "$assets" "$mock_bin" /usr/local/lib/myremnawave-agent

cat >"$assets/myremnawave-agent-linux-amd64" <<'MOCK'
#!/bin/sh
set -eu
if [ "${1:-}" = "enroll" ]; then
    echo enroll >>/tmp/myremnawave-test-enroll-count
    install -d -m 0700 /etc/myremnawave-agent
    for name in client.crt client.key ca.crt agent.env; do
        printf 'test\n' >"/etc/myremnawave-agent/$name"
    done
fi
MOCK
cat >"$assets/myremnawave-agent.service" <<'MOCK'
[Service]
ExecStart=/usr/local/lib/myremnawave-agent/myremnawave-agent
MOCK
chmod 0755 "$assets/myremnawave-agent-linux-amd64"
(
    cd "$assets"
    sha256sum myremnawave-agent-linux-amd64 myremnawave-agent.service >SHA256SUMS
)

cat >"$mock_bin/curl" <<'MOCK'
#!/bin/sh
set -eu
output=''
while [ "$#" -gt 0 ]; do
    if [ "$1" = "--output" ]; then
        output="$2"
        shift 2
    else
        shift
    fi
done
if [ -z "$output" ] || [ "$output" = "/dev/null" ]; then
    printf '404'
else
    cp "$TEST_ASSETS/$(basename "$output")" "$output"
fi
MOCK
cat >"$mock_bin/apt-get" <<'MOCK'
#!/bin/sh
exit 0
MOCK
cat >"$mock_bin/docker" <<'MOCK'
#!/bin/sh
exit 0
MOCK
cat >"$mock_bin/systemctl" <<'MOCK'
#!/bin/sh
exit 0
MOCK
chmod 0755 "$mock_bin/curl" "$mock_bin/apt-get" "$mock_bin/docker" "$mock_bin/systemctl"

printf 'partial old binary\n' >/usr/local/lib/myremnawave-agent/myremnawave-agent
rm -f /tmp/myremnawave-test-enroll-count
export TEST_ASSETS="$assets"

run_installer() {
    PATH="$mock_bin:$PATH" sh "$installer" \
        --version v0.2.0 \
        --panel-url https://panel.example.com/api/machine-enrollment \
        --token mrw_enroll_test
}

run_installer
grep -Fqx 'v0.2.0' /usr/local/lib/myremnawave-agent/.version
[ "$(wc -l </tmp/myremnawave-test-enroll-count)" -eq 1 ]
for credential in client.crt client.key ca.crt agent.env; do
    [ -f "/etc/myremnawave-agent/$credential" ]
done

run_installer
[ "$(wc -l </tmp/myremnawave-test-enroll-count)" -eq 1 ]

echo 'Partial-install recovery and committed-credential idempotency: PASS'
