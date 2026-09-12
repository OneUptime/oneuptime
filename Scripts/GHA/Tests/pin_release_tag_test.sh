#!/usr/bin/env bash

# Unit tests for Scripts/GHA/pin_release_tag.sh. The test file also acts as
# local git and verifier stubs through symlinks; no network or repository state
# is touched.

set -uo pipefail

git_stub() {
	printf '%s\n' "$*" >> "$PIN_STUB_GIT_LOG"

	case "$1" in
	check-ref-format)
		[[ "$2" != *"invalid tag"* ]]
		;;
	ls-remote)
		case "$PIN_STUB_SCENARIO" in
			existing|verify_failure)
				printf '%s\trefs/tags/%s\n' "$PIN_STUB_SHA" "$PIN_STUB_TAG"
				;;
			missing|push_failure)
				return 2
				;;
			lookup_failure)
				echo "fatal: unable to access origin" >&2
				return 128
				;;
			*)
				echo "unexpected scenario: ${PIN_STUB_SCENARIO}" >&2
				return 64
				;;
		esac
		;;
	push)
		if [[ "$PIN_STUB_SCENARIO" == "push_failure" ]]; then
			echo "remote rejected tag" >&2
			return 1
		fi
		;;
	*)
		echo "git stub received unexpected arguments: $*" >&2
		return 64
		;;
	esac
}

verify_stub() {
	printf '%s\n' "$*" >> "$PIN_STUB_VERIFY_LOG"
	if [[ "$PIN_STUB_SCENARIO" == "verify_failure" ]]; then
		echo "tag points to another commit" >&2
		return 1
	fi
}

case "${0##*/}" in
git)
	git_stub "$@"
	exit $?
	;;
verify_release_tag.sh)
	verify_stub "$@"
	exit $?
	;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="${SCRIPT_DIR}/../pin_release_tag.sh"
TEST_FILE="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"
TEST_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pin-release-tag-test.XXXXXX")"
STUB_BIN_DIR="${TEST_TMP_DIR}/bin"
mkdir -p "$STUB_BIN_DIR"
ln -s "$TEST_FILE" "${STUB_BIN_DIR}/git"
ln -s "$TEST_FILE" "${STUB_BIN_DIR}/verify_release_tag.sh"

cleanup() {
	rm -rf "$TEST_TMP_DIR"
}
trap cleanup EXIT

export PIN_STUB_GIT_LOG="${TEST_TMP_DIR}/git.log"
export PIN_STUB_VERIFY_LOG="${TEST_TMP_DIR}/verify.log"
export PIN_STUB_SHA="1111111111111111111111111111111111111111"
export PIN_STUB_TAG="13.0.3"
REPOSITORY="OneUptime/oneuptime"
PASS=0
FAIL=0
status=0
output=""

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
	export PIN_STUB_SCENARIO="$1"
	: > "$PIN_STUB_GIT_LOG"
	: > "$PIN_STUB_VERIFY_LOG"
	status=0
	output="$(
		PATH="${STUB_BIN_DIR}:$PATH" \
			VERIFY_RELEASE_TAG_HELPER="${STUB_BIN_DIR}/verify_release_tag.sh" \
			bash "$HELPER" "$REPOSITORY" "$PIN_STUB_TAG" "$PIN_STUB_SHA" 2>&1
	)" || status=$?
}

echo "pin_release_tag"

invoke existing
assert_eq 0 "$status" "accepts an existing tag after provenance verification"
assert_eq 2 "$(wc -l < "$PIN_STUB_GIT_LOG" | tr -d ' ')" "checks tag syntax and remote existence"
assert_eq "$REPOSITORY $PIN_STUB_TAG $PIN_STUB_SHA" "$(<"$PIN_STUB_VERIFY_LOG")" "verifies the existing tag against the immutable identity"
if grep -q '^push ' "$PIN_STUB_GIT_LOG"; then
	fail "does not move an existing tag — push was attempted"
else
	pass "does not move an existing tag"
fi

invoke missing
assert_eq 0 "$status" "creates a missing tag and verifies it"
assert_contains "$(<"$PIN_STUB_GIT_LOG")" "push origin ${PIN_STUB_SHA}:refs/tags/${PIN_STUB_TAG}" "pins a missing tag directly to the workflow SHA"
assert_eq "$REPOSITORY $PIN_STUB_TAG $PIN_STUB_SHA" "$(<"$PIN_STUB_VERIFY_LOG")" "verifies a newly created tag"
assert_contains "$output" "does not exist" "reports first-release tag creation"

invoke verify_failure
assert_eq 1 "$status" "rejects an existing tag with failed provenance"
if grep -q '^push ' "$PIN_STUB_GIT_LOG"; then
	fail "never overwrites a mismatched existing tag — push was attempted"
else
	pass "never overwrites a mismatched existing tag"
fi

invoke lookup_failure
assert_eq 1 "$status" "fails closed when remote tag state is unknown"
assert_contains "$output" "Unable to determine" "explains an uncertain remote lookup"
assert_eq "" "$(<"$PIN_STUB_VERIFY_LOG")" "does not verify after an uncertain lookup"

invoke push_failure
assert_eq 1 "$status" "propagates an atomic tag-push failure"
assert_eq "" "$(<"$PIN_STUB_VERIFY_LOG")" "does not claim verification after a failed push"

export PIN_STUB_SCENARIO=existing
: > "$PIN_STUB_GIT_LOG"
status=0
output="$(
	PATH="${STUB_BIN_DIR}:$PATH" \
		VERIFY_RELEASE_TAG_HELPER="${STUB_BIN_DIR}/verify_release_tag.sh" \
		bash "$HELPER" "$REPOSITORY" "invalid tag" "$PIN_STUB_SHA" 2>&1
)" || status=$?
assert_eq 2 "$status" "rejects an invalid Git tag name"
assert_contains "$output" "not a valid Git tag name" "explains invalid tag input"

: > "$PIN_STUB_GIT_LOG"
status=0
output="$(
	PATH="${STUB_BIN_DIR}:$PATH" \
		VERIFY_RELEASE_TAG_HELPER="${STUB_BIN_DIR}/verify_release_tag.sh" \
		bash "$HELPER" "$REPOSITORY" "$PIN_STUB_TAG" "short-sha" 2>&1
)" || status=$?
assert_eq 2 "$status" "rejects an incomplete commit SHA"
assert_eq "" "$(<"$PIN_STUB_GIT_LOG")" "rejects invalid identity before touching Git"

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
