#!/usr/bin/env bash
#
# Installs the OneUptime infrastructure agent from the live apt and yum
# repositories at https://packages.oneuptime.com, with the commands of the
# Server / VM Monitor docs page as written, in a fresh container of each
# image; then checks the version installed and that the program runs.
#
# Usage: InstallFromPackageRepository.sh <version> <image>...
#   e.g. InstallFromPackageRepository.sh 14.0.74 mirror.gcr.io/library/ubuntu:24.04
#
# The docs' apt block runs where the image has apt-get, the dnf block
# elsewhere. Containers run on this machine's architecture: the "Infrastructure
# Agent Release Status" workflow runs this on x64 and on Arm, once
# ReleaseStatus.sh finds the version on the site. (For pull requests,
# Tests/Ops/package-repository-e2e.sh runs the same commands against a
# repository it builds.)
#
# Prints a Markdown table, to $GITHUB_STEP_SUMMARY as well when that is set,
# and exits 1 when any image did not install the version.
#
# Needs docker. (INSTALL_RETRY_SECONDS is for the tests.)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCS_PAGE="$REPO_ROOT/packages/App/FeatureSet/Docs/Content/en/monitor/server-monitor.md"

fail() {
	echo "InstallFromPackageRepository: $*" >&2
	exit 2
}

VERSION="${1:-}"
[[ -n "$VERSION" ]] || fail "usage: InstallFromPackageRepository.sh <version> <image>..."
shift
(($# > 0)) || fail "name at least one image"
command -v docker >/dev/null || fail "needs docker"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 755 "$WORK"

# The page's fenced bash block that contains $1.
docs_block() {
	awk -v needle="$1" '
		/^```bash/ { inside = 1; block = ""; next }
		/^```/ && inside { inside = 0; if (index(block, needle)) { printf "%s", block; exit } next }
		inside { block = block $0 "\n" }
	' "$DOCS_PAGE"
}

docs_block 'apt-get install oneuptime-infrastructure-agent' >"$WORK/apt.sh"
docs_block 'dnf install oneuptime-infrastructure-agent' >"$WORK/dnf.sh"
[[ -s "$WORK/apt.sh" ]] || fail "the docs page has no apt install block"
[[ -s "$WORK/dnf.sh" ]] || fail "the docs page has no dnf install block"

# In the container, as root: the docs' commands use sudo, which the images
# do not have, and answer no prompts, so both are taken care of first.
cat >"$WORK/install.sh" <<'EOF'
set -euo pipefail
expected="$1"
printf '#!/bin/sh\nexec "$@"\n' >/usr/local/bin/sudo
chmod 755 /usr/local/bin/sudo
if command -v apt-get >/dev/null; then
	export DEBIAN_FRONTEND=noninteractive
	apt-get update -qq >/dev/null
	apt-get install -y -qq --no-install-recommends curl ca-certificates >/dev/null
	echo 'APT::Get::Assume-Yes "true";' >/etc/apt/apt.conf.d/90assume-yes
	commands=/work/apt.sh
else
	echo 'assumeyes=1' >>/etc/dnf/dnf.conf
	command -v curl >/dev/null || dnf install -y -q curl >/dev/null
	commands=/work/dnf.sh
fi
# Hardened servers give root a umask of 077; what the docs write must still
# be readable by apt and dnf.
umask 077
if ! bash -euo pipefail "$commands" >/tmp/install.log 2>&1; then
	tail -n 30 /tmp/install.log
	exit 1
fi
if command -v dpkg-query >/dev/null; then
	installed="$(dpkg-query --show --showformat '${Version}' oneuptime-infrastructure-agent)"
else
	installed="$(rpm --query --queryformat '%{VERSION}' oneuptime-infrastructure-agent)"
fi
oneuptime-infrastructure-agent help >/dev/null
echo "$installed"
[ "$installed" = "$expected" ]
EOF

# pull <image>: three tries, since registries refuse bursts of anonymous
# pulls for a while. Why it failed, on stdout.
pull() {
	local attempt
	for attempt in 1 2 3; do
		if docker pull --quiet "$1" >/dev/null 2>"$WORK/pull-error"; then
			return 0
		fi
		if ((attempt < 3)); then
			sleep $((attempt * ${INSTALL_RETRY_SECONDS:-30}))
		fi
	done
	cat "$WORK/pull-error"
	return 1
}

ARCHITECTURE="$(uname -m)"
ROWS=()
FAILED=0
IN_ACTIONS=false
[[ "${GITHUB_ACTIONS:-}" == "true" ]] && IN_ACTIONS=true
for image in "$@"; do
	if [[ "$IN_ACTIONS" == "true" ]]; then
		echo "::group::$image"
	else
		echo "--- $image"
	fi
	status=0
	if ! pull "$image" >"$WORK/output"; then
		status=125
	else
		docker run --rm -v "$WORK:/work:ro" "$image" bash /work/install.sh "$VERSION" >"$WORK/output" 2>&1 || status=$?
	fi
	cat "$WORK/output"
	if [[ "$IN_ACTIONS" == "true" ]]; then
		echo "::endgroup::"
	fi
	installed="$(tail -n 1 "$WORK/output")"
	if ((status == 125)); then
		FAILED=$((FAILED + 1))
		ROWS+=("| \`$image\` | ❌ could not pull the image |")
	elif ((status == 0)); then
		ROWS+=("| \`$image\` | ✅ installed $VERSION |")
	else
		FAILED=$((FAILED + 1))
		if [[ "$installed" =~ ^[0-9][0-9.]*$ ]]; then
			ROWS+=("| \`$image\` | ❌ installed $installed, not $VERSION |")
		else
			ROWS+=("| \`$image\` | ❌ did not install: see the log |")
		fi
		if [[ "$IN_ACTIONS" == "true" ]]; then
			echo "::error title=$image::The docs' commands did not install $VERSION from packages.oneuptime.com ($ARCHITECTURE)."
		fi
	fi
done

{
	echo "### apt and dnf on $ARCHITECTURE, as the docs say"
	echo
	echo "| Image | Result |"
	echo "| --- | --- |"
	printf '%s\n' "${ROWS[@]}"
} >"$WORK/summary.md"

cat "$WORK/summary.md"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
	cat "$WORK/summary.md" >>"$GITHUB_STEP_SUMMARY"
fi

if ((FAILED > 0)); then
	exit 1
fi
