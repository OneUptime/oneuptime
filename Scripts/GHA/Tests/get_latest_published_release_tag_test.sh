#!/usr/bin/env bash

# Unit tests for get_latest_published_release_tag.sh. This file becomes a local
# gh stub through a symlink, so the suite never contacts GitHub.

set -uo pipefail

gh_stub() {
	printf '%s\n' "$*" >> "$LATEST_RELEASE_STUB_LOG"
	call_count="$(<"$LATEST_RELEASE_STUB_COUNT")"
	call_count=$(( call_count + 1 ))
	printf '%s\n' "$call_count" > "$LATEST_RELEASE_STUB_COUNT"

	case "$LATEST_RELEASE_STUB_SCENARIO" in
	success)
		printf '%s\n' "$LATEST_RELEASE_STUB_TAG"
		;;
	no_release)
		echo "gh: Not Found (HTTP 404)" >&2
		return 1
		;;
	transient_then_success)
		if (( call_count < 3 )); then
			echo "gh: Service Unavailable (HTTP 503)" >&2
			return 1
		fi
		printf '%s\n' "$LATEST_RELEASE_STUB_TAG"
		;;
	exhausted_transient)
		echo "gh: Bad Gateway (HTTP 502)" >&2
		return 1
		;;
	permanent_error)
		echo "gh: Resource forbidden (HTTP 403)" >&2
		return 1
		;;
	empty_response)
		printf '\n'
		;;
	*)
		echo "unknown scenario: ${LATEST_RELEASE_STUB_SCENARIO}" >&2
		return 64
		;;
	esac
}

if [[ "${0##*/}" == "gh" ]]; then
	gh_stub "$@"
	exit $?
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="${SCRIPT_DIR}/../get_latest_published_release_tag.sh"
TEST_FILE="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"
TEST_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/latest-release-tag-test.XXXXXX")"
STUB_BIN_DIR="${TEST_TMP_DIR}/bin"
mkdir -p "$STUB_BIN_DIR"
ln -s "$TEST_FILE" "${STUB_BIN_DIR}/gh"

cleanup() {
	rm -rf "$TEST_TMP_DIR"
}
trap cleanup EXIT

export LATEST_RELEASE_STUB_LOG="${TEST_TMP_DIR}/gh.log"
export LATEST_RELEASE_STUB_COUNT="${TEST_TMP_DIR}/count"
export LATEST_RELEASE_STUB_TAG="13.0.1"
REPOSITORY="OneUptime/oneuptime"
STDERR_FILE="${TEST_TMP_DIR}/stderr"
PASS=0
FAIL=0
status=0
output=""
error_output=""

pass() {
	PASS=$(( PASS + 1 ))
	echo "  ✅ $1"
}

fail() {
	FAIL=$(( FAIL + 1 ))
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

invoke() {
	export LATEST_RELEASE_STUB_SCENARIO="$1"
	printf '0\n' > "$LATEST_RELEASE_STUB_COUNT"
	: > "$LATEST_RELEASE_STUB_LOG"
	: > "$STDERR_FILE"
	status=0
	output="$(
		PATH="${STUB_BIN_DIR}:$PATH" \
			GET_LATEST_RELEASE_RETRY_DELAYS="$2" \
			bash "$HELPER" "$REPOSITORY" 2>"$STDERR_FILE"
	)" || status=$?
	error_output="$(<"$STDERR_FILE")"
}

echo "get_latest_published_release_tag"

invoke success "0 0"
assert_eq 0 "$status" "resolves the latest published release"
assert_eq "$LATEST_RELEASE_STUB_TAG" "$output" "prints only the published release tag"
assert_eq 1 "$(<"$LATEST_RELEASE_STUB_COUNT")" "uses one request on success"
assert_eq "api --method GET repos/${REPOSITORY}/releases/latest --jq .tag_name" "$(<"$LATEST_RELEASE_STUB_LOG")" "queries the published-latest endpoint"

invoke no_release "0 0"
assert_eq 0 "$status" "treats a clean 404 as a repository with no releases"
assert_eq "" "$output" "prints an empty previous tag when no release exists"
assert_eq 1 "$(<"$LATEST_RELEASE_STUB_COUNT")" "does not retry a clean 404"

invoke transient_then_success "0 0"
assert_eq 0 "$status" "recovers from transient GitHub failures"
assert_eq "$LATEST_RELEASE_STUB_TAG" "$output" "prints the tag after recovery"
assert_eq 3 "$(<"$LATEST_RELEASE_STUB_COUNT")" "retries transient failures"
assert_contains "$error_output" "retrying in 0s" "reports transient retries"

invoke exhausted_transient "0 0"
assert_eq 1 "$status" "fails after transient retries are exhausted"
assert_eq 3 "$(<"$LATEST_RELEASE_STUB_COUNT")" "bounds transient retries"
assert_contains "$error_output" "after 3 attempts" "explains retry exhaustion"

invoke permanent_error "0 0"
assert_eq 1 "$status" "fails closed on a permanent API error"
assert_eq 1 "$(<"$LATEST_RELEASE_STUB_COUNT")" "does not retry a permanent API error"
assert_contains "$error_output" "permanent error" "explains the permanent failure"

invoke empty_response "0 0"
assert_eq 1 "$status" "rejects an empty successful API response"
assert_contains "$error_output" "invalid tag" "explains the malformed response"

export LATEST_RELEASE_STUB_SCENARIO=success
printf '0\n' > "$LATEST_RELEASE_STUB_COUNT"
status=0
output="$(
	PATH="${STUB_BIN_DIR}:$PATH" \
		GET_LATEST_RELEASE_RETRY_DELAYS="0" \
		bash "$HELPER" "not-a-repository" 2>&1
)" || status=$?
assert_eq 2 "$status" "rejects an invalid repository"
assert_eq 0 "$(<"$LATEST_RELEASE_STUB_COUNT")" "validates input before calling GitHub"

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
