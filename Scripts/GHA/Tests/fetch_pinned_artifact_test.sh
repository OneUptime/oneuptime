#!/usr/bin/env bash

# Unit tests for Scripts/GHA/fetch_pinned_artifact.sh.
#
# That script is how CI gets gomplate, Terraform, OpenTofu, the Terraform
# random provider and helm-unittest without betting each job on GitHub's
# release CDN answering at that moment (on 2026-09-21 its 504 bursts failed
# four different workflows). What matters, and what is pinned here:
#
#   * a copy that matches the pinned sha256 is used without any download --
#     that is what makes the Actions cache the first source;
#   * nothing that does not match the pin is ever installed, whether it is a
#     truncated download, an HTML error page, or a stale cached copy;
#   * a failing source falls through to the next one, and a failing round
#     is retried after a delay instead of failing the job on the first burst.
#
# Nothing here touches the network: sources are file:// URLs, and failures
# come from a curl stub that answers the way curl does on a 504.
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/fetch_pinned_artifact_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FETCH="${SCRIPT_DIR}/../fetch_pinned_artifact.sh"

# Zero delays and no curl-level retries: these tests exercise which source is
# used and what is installed, not the wall clock. Two rounds, as in production
# a later round is what rides out a burst.
export FETCH_PINNED_ARTIFACT_ROUND_DELAYS="0"
export FETCH_PINNED_ARTIFACT_CURL_RETRIES="0"
unset GITHUB_ACTIONS

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
		fail "$what — '${needle}' not found in output"
	fi
}

sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d ' ' -f 1
	else
		shasum -a 256 "$1" | cut -d ' ' -f 1
	fi
}

mode_of() {
	if stat -c '%a' "$1" >/dev/null 2>&1; then
		stat -c '%a' "$1"
	else
		stat -f '%Lp' "$1"
	fi
}

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

REAL_CURL="$(command -v curl)"
STUB_BIN="${ROOT}/stub-bin"
CURL_LOG="${ROOT}/curl-calls"
mkdir -p "$STUB_BIN"

# A curl that answers the first FAKE_CURL_FAIL_TIMES calls the way curl does
# when GitHub's CDN returns 504, then hands over to the real curl. Every call
# is logged so a test can assert how many requests were made.
cat >"${STUB_BIN}/curl" <<EOF
#!/usr/bin/env bash
# The script's feature probe (curl --retry-all-errors --version) is not a request.
case " \$* " in *" --version "*) exec "${REAL_CURL}" "\$@" ;; esac
count=\$(( \$(wc -l <"${CURL_LOG}") + 1 ))
echo "\$*" >>"${CURL_LOG}"
if (( count <= \${FAKE_CURL_FAIL_TIMES:-0} )); then
	echo "curl: (22) The requested URL returned error: 504" >&2
	exit 22
fi
exec "${REAL_CURL}" "\$@"
EOF
chmod +x "${STUB_BIN}/curl"

# run_fetch <fail_times> <args...>: runs the script with the stub on PATH.
# Sets STATUS and OUTPUT, and resets the call log first.
run_fetch() {
	local fail_times="$1"
	shift
	: >"$CURL_LOG"
	STATUS=0
	OUTPUT="$(PATH="${STUB_BIN}:${PATH}" FAKE_CURL_FAIL_TIMES="$fail_times" bash "$FETCH" "$@" 2>&1)" || STATUS=$?
}

curl_calls() {
	wc -l <"$CURL_LOG" | tr -d ' '
}

# Fixtures: a "binary", and the archives a release or a mirror serves it in.
FIXTURES="${ROOT}/fixtures"
mkdir -p "${FIXTURES}/pkg/usr/bin"
printf '#!/bin/sh\necho "tool v1.2.3"\n' >"${FIXTURES}/tool"
TOOL_SHA="$(sha256_of "${FIXTURES}/tool")"
(cd "$FIXTURES" && zip -q tool.zip tool && tar -czf tool.tgz tool)
echo '<html><body>504 Gateway Time-out</body></html>' >"${FIXTURES}/error-page.html"

echo "fetch_pinned_artifact"

# --- A plain file, from the first source. ---
DEST="${ROOT}/dest-file"
run_fetch 0 --name tool --sha256 "$TOOL_SHA" --dest "$DEST" --mode 0755 \
	--source file "file://${FIXTURES}/tool"
assert_eq 0 "$STATUS" "installs a file source that matches the pin"
assert_eq "$TOOL_SHA" "$(sha256_of "${DEST}/tool" 2>/dev/null)" "the installed file is the pinned one"
assert_eq 755 "$(mode_of "${DEST}/tool")" "applies --mode"
assert_eq 1 "$(curl_calls)" "downloads exactly once"

# --- A cached copy that matches the pin: the network is never touched. ---
run_fetch 99 --name tool --sha256 "$TOOL_SHA" --dest "$DEST" --mode 0755 \
	--source file "file://${FIXTURES}/tool"
assert_eq 0 "$STATUS" "succeeds from a cached copy while every download would fail"
assert_eq 0 "$(curl_calls)" "makes no request when the cached copy matches the pin"
assert_contains "$OUTPUT" "cached copy matches the pinned sha256" "says it used the cached copy"

# --- A cached copy that does not match (truncated, stale, poisoned): replaced. ---
echo "truncated" >"${DEST}/tool"
run_fetch 0 --name tool --sha256 "$TOOL_SHA" --dest "$DEST" --mode 0755 \
	--source file "file://${FIXTURES}/tool"
assert_eq 0 "$STATUS" "re-fetches when the cached copy does not match the pin"
assert_eq "$TOOL_SHA" "$(sha256_of "${DEST}/tool")" "replaces the bad cached copy with the pinned file"
assert_contains "$OUTPUT" "does not match the pinned sha256; replacing it" "says why it re-fetched"

# --- An error page served with 200: never installed. This is the failure
#     configure.sh once had, when a 503 page was saved as the gomplate binary. ---
DEST="${ROOT}/dest-error-page"
run_fetch 0 --name tool --sha256 "$TOOL_SHA" --dest "$DEST" \
	--source file "file://${FIXTURES}/error-page.html"
assert_eq 1 "$STATUS" "fails when the only source serves something else"
assert_eq "absent" "$([[ -e "${DEST}/tool" ]] && echo present || echo absent)" "installs nothing that does not match the pin"
assert_contains "$OUTPUT" "does not match the pinned sha256" "names the mismatch"
assert_contains "$OUTPUT" "after 2 round(s)" "tries every round before giving up"
assert_eq 2 "$(curl_calls)" "one request per source per round"

# --- A failing canonical source falls through to the mirror in the same round. ---
DEST="${ROOT}/dest-fallback"
run_fetch 1 --name tool --sha256 "$TOOL_SHA" --dest "$DEST" --mode 0755 \
	--source zip:tool "file://${FIXTURES}/tool.zip" \
	--source tgz:tool "file://${FIXTURES}/tool.tgz"
assert_eq 0 "$STATUS" "falls back to the next source when the first one fails"
assert_eq "$TOOL_SHA" "$(sha256_of "${DEST}/tool")" "the mirror's copy verifies against the same pin"
assert_contains "$OUTPUT" "installed ${DEST}/tool (sha256 ${TOOL_SHA}) from file://${FIXTURES}/tool.tgz" "reports which source it used"
assert_eq 2 "$(curl_calls)" "stops at the first source that verifies"

# --- A burst that outlasts one round: the next round recovers. ---
DEST="${ROOT}/dest-rounds"
run_fetch 1 --name tool --sha256 "$TOOL_SHA" --dest "$DEST" \
	--source file "file://${FIXTURES}/tool"
assert_eq 0 "$STATUS" "recovers in a later round when every source failed in the first"
assert_contains "$OUTPUT" "trying again in 0s" "announces the next round"
assert_eq 2 "$(curl_calls)" "retries the source once per round"

# --- A burst that outlasts every round: a loud failure naming the sources. ---
DEST="${ROOT}/dest-outage"
GITHUB_ACTIONS=true run_fetch 99 --name tool --sha256 "$TOOL_SHA" --dest "$DEST" \
	--source file "file://${FIXTURES}/tool" \
	--source file "file://${FIXTURES}/tool-mirror"
assert_eq 1 "$STATUS" "fails when no source works in any round"
assert_contains "$OUTPUT" "::error title=Pinned download failed::tool:" "raises a GitHub Actions error annotation"
assert_contains "$OUTPUT" "file://${FIXTURES}/tool-mirror" "names every source it tried"
assert_eq 4 "$(curl_calls)" "tries each source in each round"

# --- Archives: the pin is of the member, not of the archive. ---
DEST="${ROOT}/dest-zip"
run_fetch 0 --name tool --sha256 "$TOOL_SHA" --dest "$DEST" \
	--source zip:tool "file://${FIXTURES}/tool.zip"
assert_eq 0 "$STATUS" "takes a member out of a zip"
assert_eq "$TOOL_SHA" "$(sha256_of "${DEST}/tool")" "the zip member is the pinned file"

DEST="${ROOT}/dest-zip-missing-member"
run_fetch 0 --name tool --sha256 "$TOOL_SHA" --dest "$DEST" \
	--source zip:not-there "file://${FIXTURES}/tool.zip"
assert_eq 1 "$STATUS" "fails when the zip does not hold the member"
assert_contains "$OUTPUT" "could not take zip:not-there" "says the member was missing"

DEST="${ROOT}/dest-tgz"
run_fetch 0 --name tool --sha256 "$TOOL_SHA" --dest "$DEST" \
	--source tgz:tool "file://${FIXTURES}/tool.tgz"
assert_eq 0 "$STATUS" "takes a member out of a gzip tarball"
assert_eq "$TOOL_SHA" "$(sha256_of "${DEST}/tool")" "the tarball member is the pinned file"

# A whole archive can be the artifact too (a Terraform provider zip for a
# filesystem mirror is pinned as the zip).
ZIP_SHA="$(sha256_of "${FIXTURES}/tool.zip")"
DEST="${ROOT}/dest-whole-zip"
run_fetch 0 --name tool.zip --sha256 "$ZIP_SHA" --dest "$DEST" \
	--source file "file://${FIXTURES}/tool.zip"
assert_eq 0 "$STATUS" "installs a whole archive when the archive is what is pinned"
assert_eq "$ZIP_SHA" "$(sha256_of "${DEST}/tool.zip")" "the archive is kept byte for byte"

if command -v dpkg-deb >/dev/null 2>&1; then
	mkdir -p "${FIXTURES}/deb/DEBIAN" "${FIXTURES}/deb/usr/bin"
	cp "${FIXTURES}/tool" "${FIXTURES}/deb/usr/bin/tool"
	printf 'Package: tool\nVersion: 1.2.3\nArchitecture: all\nMaintainer: test <test@example.com>\nDescription: test\n' >"${FIXTURES}/deb/DEBIAN/control"
	dpkg-deb --build "${FIXTURES}/deb" "${FIXTURES}/tool.deb" >/dev/null
	DEST="${ROOT}/dest-deb"
	run_fetch 0 --name tool --sha256 "$TOOL_SHA" --dest "$DEST" \
		--source deb:./usr/bin/tool "file://${FIXTURES}/tool.deb"
	assert_eq 0 "$STATUS" "takes a file out of a Debian package"
	assert_eq "$TOOL_SHA" "$(sha256_of "${DEST}/tool")" "the packaged file is the pinned one"
else
	echo "  ⏭️  dpkg-deb not installed: skipping the .deb source (CI runs it)"
fi

# --- A verified download that cannot be written to --dest (read-only, full
#     disk) is a failure, not an install: otherwise a truncated file would sit
#     under the artifact's name and be saved into the cache under its pin. ---
if [[ $(id -u) -ne 0 ]]; then
	DEST="${ROOT}/dest-readonly"
	mkdir -p "$DEST" && chmod 555 "$DEST"
	run_fetch 0 --name tool --sha256 "$TOOL_SHA" --dest "$DEST" \
		--source file "file://${FIXTURES}/tool"
	chmod 755 "$DEST"
	assert_eq 1 "$STATUS" "fails when the verified file cannot be written to --dest"
	assert_eq "absent" "$([[ -e "${DEST}/tool" ]] && echo present || echo absent)" "leaves nothing under the artifact's name"
	assert_contains "$OUTPUT" "could not install it at ${DEST}/tool" "says the install, not the download, failed"
	assert_eq 1 "$(curl_calls)" "does not go round again for a local failure"
else
	echo "  ⏭️  running as root: a read-only --dest does not stop root, so that case is skipped"
fi

# --- Upper-case digests are the same pin. ---
DEST="${ROOT}/dest-upper"
run_fetch 0 --name tool --sha256 "$(tr '[:lower:]' '[:upper:]' <<<"$TOOL_SHA")" --dest "$DEST" \
	--source file "file://${FIXTURES}/tool"
assert_eq 0 "$STATUS" "accepts an upper-case sha256"

# --- Argument errors are usage errors (exit 2), before any download. ---
run_fetch 0 --name tool --sha256 "abc" --dest "${ROOT}/x" --source file "file://${FIXTURES}/tool"
assert_eq 2 "$STATUS" "rejects a sha256 that is not 64 hex characters"
run_fetch 0 --name tool --sha256 "$TOOL_SHA" --dest "${ROOT}/x" --source gz "file://${FIXTURES}/tool"
assert_eq 2 "$STATUS" "rejects an unknown source kind"
run_fetch 0 --name bin/tool --sha256 "$TOOL_SHA" --dest "${ROOT}/x" --source file "file://${FIXTURES}/tool"
assert_eq 2 "$STATUS" "rejects a --name that is a path"
run_fetch 0 --name tool --sha256 "$TOOL_SHA" --dest "${ROOT}/x"
assert_eq 2 "$STATUS" "rejects a call with no source"
run_fetch 0 --name tool --sha256 "$TOOL_SHA" --dest "${ROOT}/x" --mode rwx --source file "file://${FIXTURES}/tool"
assert_eq 2 "$STATUS" "rejects a --mode that is not an octal file mode"
assert_eq 0 "$(curl_calls)" "makes no request for a usage error"

# --- The backoff is curl's exponential one. A fixed --retry-delay replaces it
#     with a constant, which is how the old gomplate download ended up with a
#     15-second window. ---
if grep -v '^[[:space:]]*#' "$FETCH" | grep -q -- "--retry-delay"; then
	fail "the download must not set --retry-delay (it disables curl's exponential backoff)"
else
	pass "the download keeps curl's exponential backoff (no --retry-delay)"
fi

echo ""
echo "  ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
