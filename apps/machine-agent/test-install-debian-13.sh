#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu

installer="${1:-./install.sh}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM

cat >"$work_dir/apt-get" <<'MOCK'
#!/bin/sh
echo "APT_GET_REACHED $*" >&2
exit 42
MOCK
chmod 0755 "$work_dir/apt-get"

output="$work_dir/output"
if PATH="$work_dir:$PATH" sh "$installer" \
    --version v0.1.1 \
    --panel-url https://panel.example.com/api/machine-enrollment \
    --token mrw_enroll_test >"$output" 2>&1; then
    echo "installer unexpectedly completed with the package manager mocked" >&2
    exit 1
fi

grep -F "APT_GET_REACHED update" "$output" >/dev/null || {
    echo "installer did not accept Debian 13 and reach package installation" >&2
    cat "$output" >&2
    exit 1
}
