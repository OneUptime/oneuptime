#!/usr/bin/env bash

# Unit tests for Scripts/GHA/apt_archive_cache.sh.
#
# The Probe's job installs Chromium's and Firefox's system packages and
# strace from the runner's Ubuntu mirror, which serves some runners at a few
# dozen kB/s, so it keeps what apt fetched in the Actions cache and the next
# run on the same runner image installs it from there. What is worth pinning
# is what makes that safe to lean on:
#
#   * the cache key names the runner image, and names this run alone where it
#     cannot tell images apart (no ImageOS/ImageVersion), so packages never
#     cross images;
#   * keep points apt's archives at a folder of its own and keeps downloads,
#     for apt and apt-get alike;
#   * save copies exactly what was downloaded, with a list, and an empty list
#     when the image lacked nothing;
#   * install installs from the files with no package source at all, and
#     fails - so the job falls back to the mirror - on a cache that is not
#     whole or that apt cannot install alone, without ever touching a source.
#
# No root, no apt, no network: sudo, apt-get and dpkg-deb are stubs.
# Scripts/GHA/apt_archive_cache.sh was also run for real in ubuntu:24.04
# containers (a miss, then a hit and a broken cache with --network none).
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/apt_archive_cache_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/../apt_archive_cache.sh"

PASS=0
FAIL=0

pass() {
	PASS=$((PASS + 1))
	echo "  ✅ $1"
}

fail() {
	FAIL=$((FAIL + 1))
	echo "  ❌ $1" >&2
}

assert_eq() {
	local expected="$1" actual="$2" what="$3"
	if [[ "$expected" == "$actual" ]]; then
		pass "$what"
	else
		fail "$what — expected '${expected}', got '${actual}'"
	fi
}

assert_contains() {
	local haystack="$1" needle="$2" what="$3"
	if [[ "$haystack" == *"$needle"* ]]; then
		pass "$what"
	else
		fail "$what — '${needle}' not found in:"$'\n'"${haystack}"
	fi
}

assert_not_contains() {
	local haystack="$1" needle="$2" what="$3"
	if [[ "$haystack" != *"$needle"* ]]; then
		pass "$what"
	else
		fail "$what — '${needle}' unexpectedly present in:"$'\n'"${haystack}"
	fi
}

WORK_DIR=""
CALLS=""

# A fresh sandbox: stubs on PATH, a log of their calls, an apt.conf.d of its own.
setup() {
	WORK_DIR="$(mktemp -d)"
	CALLS="${WORK_DIR}/calls.log"
	mkdir -p "${WORK_DIR}/bin" "${WORK_DIR}/apt.conf.d"
	: >"$CALLS"

	# sudo runs the command as this user, after logging it (env assignments first).
	cat >"${WORK_DIR}/bin/sudo" <<EOF
#!/usr/bin/env bash
echo "sudo \$*" >>"${CALLS}"
exec env "\$@"
EOF
	# apt-get logs its arguments and exits with APT_GET_EXIT (0 by default).
	cat >"${WORK_DIR}/bin/apt-get" <<EOF
#!/usr/bin/env bash
echo "apt-get \$*" >>"${CALLS}"
exit "\${APT_GET_EXIT:-0}"
EOF
	# dpkg-deb --field <file> <field> answers from the file's name: <name>_<version>_<arch>.deb.
	cat >"${WORK_DIR}/bin/dpkg-deb" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "--field" ]] || exit 2
file="$(basename "$2" .deb)"
case "$3" in
Package) echo "${file%%_*}" ;;
Version) rest="${file#*_}"; echo "${rest%_*}" ;;
esac
EOF
	chmod +x "${WORK_DIR}/bin/"*

	export PATH="${WORK_DIR}/bin:${PATH}"
	export APT_ARCHIVE_CACHE_APT_CONF_DIR="${WORK_DIR}/apt.conf.d"
	export APT_ARCHIVE_CACHE_PARTIAL_OWNER="$(id -un)"
	unset ImageOS ImageVersion GITHUB_RUN_ID GITHUB_RUN_ATTEMPT APT_GET_EXIT
}

teardown() {
	rm -rf "$WORK_DIR"
}

run_script() {
	OUTPUT="$(bash "$SCRIPT" "$@" 2>&1)"
	STATUS=$?
}

echo "image: the runner image the cache key names"
setup
ImageOS=ubuntu24 ImageVersion=20261102.1 run_script image
assert_eq 0 "$STATUS" "exits 0"
assert_eq "image=ubuntu24-20261102.1-$(uname -m)" "$OUTPUT" "ImageOS, ImageVersion and the machine"
GITHUB_RUN_ID=41 GITHUB_RUN_ATTEMPT=2 run_script image
assert_eq "image=unnamed-41-2-$(uname -m)" "$OUTPUT" "without them, this run alone: no other run's cache is used"
ImageOS=ubuntu24 run_script image
assert_contains "$OUTPUT" "image=unnamed-" "ImageOS without ImageVersion is not enough to share a cache"
teardown

echo "keep: apt keeps every package it downloads, in a folder of its own"
setup
run_script keep "${WORK_DIR}/archives"
assert_eq 0 "$STATUS" "exits 0"
DROP_IN="$(cat "${WORK_DIR}/apt.conf.d/90-oneuptime-keep-downloaded-packages" 2>/dev/null)"
assert_contains "$DROP_IN" "Dir::Cache::Archives \"${WORK_DIR}/archives/\";" "points apt's archives at the folder"
assert_contains "$DROP_IN" 'APT::Keep-Downloaded-Packages "true";' "keeps downloads"
assert_contains "$DROP_IN" 'Binary::apt::APT::Keep-Downloaded-Packages "true";' "for apt, which deletes them by default"
assert_contains "$DROP_IN" 'Binary::apt-get::APT::Keep-Downloaded-Packages "true";' "and for apt-get"
if [[ -d "${WORK_DIR}/archives/partial" ]]; then
	pass "makes the partial folder apt downloads into"
else
	fail "makes the partial folder apt downloads into"
fi
assert_eq "700" "$(stat -c '%a' "${WORK_DIR}/archives/partial")" "the partial folder is apt's downloader's alone, as apt makes its own"
assert_contains "$(cat "$CALLS")" "sudo install -d -o $(id -un) -m 700 ${WORK_DIR}/archives/partial" "through sudo"
teardown

echo "save: what apt downloaded, and a list of it"
setup
mkdir -p "${WORK_DIR}/archives" "${WORK_DIR}/cache"
touch "${WORK_DIR}/archives/strace_6.8-0ubuntu2_amd64.deb" "${WORK_DIR}/archives/libnss3_2%3a3.98-1ubuntu0.3_amd64.deb"
touch "${WORK_DIR}/cache/stale_1.0_amd64.deb"
run_script save "${WORK_DIR}/archives" "${WORK_DIR}/cache"
assert_eq 0 "$STATUS" "exits 0"
assert_eq "libnss3_2%3a3.98-1ubuntu0.3_amd64.deb strace_6.8-0ubuntu2_amd64.deb" "$(cd "${WORK_DIR}/cache" && echo *.deb)" "copies the downloads, and nothing a cache folder held before"
assert_eq "libnss3 2%3a3.98-1ubuntu0.3 libnss3_2%3a3.98-1ubuntu0.3_amd64.deb
strace 6.8-0ubuntu2 strace_6.8-0ubuntu2_amd64.deb" "$(cat "${WORK_DIR}/cache/packages.txt")" "lists each by name, version and file, sorted"
assert_contains "$OUTPUT" "kept 2 package(s)" "says how many"
rm -f "${WORK_DIR}/archives/"*.deb
run_script save "${WORK_DIR}/archives" "${WORK_DIR}/cache"
assert_eq 0 "$STATUS" "nothing downloaded: still exits 0"
assert_eq "" "$(cat "${WORK_DIR}/cache/packages.txt")" "an empty list: the image lacked nothing"
teardown

echo "install: from the files, with no package source"
setup
mkdir -p "${WORK_DIR}/cache"
touch "${WORK_DIR}/cache/strace_6.8-0ubuntu2_amd64.deb"
echo "strace 6.8-0ubuntu2 strace_6.8-0ubuntu2_amd64.deb" >"${WORK_DIR}/cache/packages.txt"
run_script install "${WORK_DIR}/cache"
assert_eq 0 "$STATUS" "exits 0 when apt installs them"
INSTALL_CALL="$(grep '^apt-get ' "$CALLS")"
assert_contains "$INSTALL_CALL" "install -y --no-install-recommends" "installs, without recommends"
assert_contains "$INSTALL_CALL" " ${WORK_DIR}/cache/strace_6.8-0ubuntu2_amd64.deb" "each package by its absolute path, which apt reads as a file"
assert_contains "$INSTALL_CALL" "-o Dir::Etc::SourceList=" "with no sources.list"
assert_contains "$INSTALL_CALL" "-o Dir::Etc::SourceParts=" "no sources.list.d"
assert_contains "$INSTALL_CALL" "-o Dir::State::Lists=" "and no package lists: nothing to download from"
assert_not_contains "$INSTALL_CALL" "--no-download" "not --no-download, which fails on package files"
assert_contains "$(cat "$CALLS")" "sudo DEBIAN_FRONTEND=noninteractive apt-get" "as root, asking nothing"
teardown

echo "install: fails, and touches no source, when the cache cannot be installed alone"
setup
mkdir -p "${WORK_DIR}/cache"
touch "${WORK_DIR}/cache/libnss3_2%3a3.98_amd64.deb"
echo "libnss3 2%3a3.98 libnss3_2%3a3.98_amd64.deb" >"${WORK_DIR}/cache/packages.txt"
APT_GET_EXIT=100 run_script install "${WORK_DIR}/cache"
assert_eq 1 "$STATUS" "apt refused: exits 1, so the job falls back to the mirror"
assert_contains "$OUTPUT" "install them from the mirror instead" "and says so"
teardown

setup
mkdir -p "${WORK_DIR}/cache"
touch "${WORK_DIR}/cache/strace_6.8_amd64.deb"
run_script install "${WORK_DIR}/cache"
assert_eq 1 "$STATUS" "no packages.txt (a folder this script never saved): exits 1"
echo "strace 6.8 strace_6.8_amd64.deb" >"${WORK_DIR}/cache/packages.txt"
echo "libnss3 2 libnss3_2_amd64.deb" >>"${WORK_DIR}/cache/packages.txt"
run_script install "${WORK_DIR}/cache"
assert_eq 1 "$STATUS" "a package listed but missing (a cache not whole): exits 1"
assert_eq "" "$(grep '^apt-get ' "$CALLS")" "and apt is never asked"
teardown

setup
mkdir -p "${WORK_DIR}/cache"
: >"${WORK_DIR}/cache/packages.txt"
run_script install "${WORK_DIR}/cache"
assert_eq 0 "$STATUS" "an empty list: nothing to install, exits 0"
assert_eq "" "$(grep '^apt-get ' "$CALLS")" "without asking apt"
teardown

echo "usage"
setup
run_script
assert_eq 2 "$STATUS" "no command: exits 2"
run_script save "${WORK_DIR}/archives"
assert_eq 2 "$STATUS" "save without the cache folder: exits 2"
run_script unknown
assert_eq 2 "$STATUS" "an unknown command: exits 2"
teardown

echo ""
echo "apt_archive_cache: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
