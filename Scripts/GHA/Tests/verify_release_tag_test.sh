#!/usr/bin/env bash

# Unit tests for Scripts/GHA/verify_release_tag.sh.
#
# This file doubles as the `gh` stub when invoked through the temporary `gh`
# symlink below. Every API response is local and deterministic; the suite never
# contacts GitHub.
#
# Run with:
#   bash Scripts/GHA/Tests/run.sh verify_release_tag
#   bash Scripts/GHA/Tests/verify_release_tag_test.sh

set -uo pipefail

gh_stub() {
	if (( $# != 4 )) || [[ "$1" != "api" || "$2" != "--method" || "$3" != "GET" ]]; then
		echo "gh stub received unexpected arguments: $*" >&2
		return 64
	fi

	local endpoint="$4"
	local call_count
	call_count="$(<"$GH_STUB_STATE_FILE")"
	call_count=$(( call_count + 1 ))
	printf '%s\n' "$call_count" > "$GH_STUB_STATE_FILE"
	printf '%s\n' "$endpoint" >> "$GH_STUB_ENDPOINT_LOG"

	emit_object() {
		printf '{"object":{"type":"%s","sha":"%s"}}\n' "$1" "$2"
	}

	case "$GH_STUB_SCENARIO" in
	lightweight_match)
		emit_object commit "$STUB_MATCH_SHA"
		;;
	lightweight_mismatch)
		emit_object commit "$STUB_OTHER_SHA"
		;;
	annotated_match)
		if [[ "$endpoint" == *"/git/ref/tags/"* ]]; then
			emit_object tag "$STUB_TAG_OBJECT_SHA"
		elif [[ "$endpoint" == "repos/${STUB_REPOSITORY}/git/tags/${STUB_TAG_OBJECT_SHA}" ]]; then
			emit_object commit "$STUB_MATCH_SHA"
		else
			echo "gh stub received unexpected endpoint: ${endpoint}" >&2
			return 64
		fi
		;;
	malformed_json)
		printf '{not-json\n'
		;;
	missing_object)
		printf '{"sha":"%s"}\n' "$STUB_MATCH_SHA"
		;;
	malformed_sha)
		emit_object commit "not-a-complete-sha"
		;;
	non_commit)
		emit_object tree "$STUB_OTHER_SHA"
		;;
	transient_then_match)
		if (( call_count <= 2 )); then
			echo "gh: Service Unavailable (HTTP 503)" >&2
			return 1
		fi
		emit_object commit "$STUB_MATCH_SHA"
		;;
	transient_while_peeling)
		if (( call_count == 1 )); then
			emit_object tag "$STUB_TAG_OBJECT_SHA"
		elif (( call_count == 2 )); then
			echo "gh: connection reset by peer" >&2
			return 1
		else
			emit_object commit "$STUB_MATCH_SHA"
		fi
		;;
	exhausted_transient)
		echo "gh: Bad Gateway (HTTP 502)" >&2
		return 1
		;;
	permanent_404)
		echo "gh: Not Found (HTTP 404)" >&2
		return 1
		;;
	endless_annotations)
		emit_object tag "$STUB_TAG_OBJECT_SHA"
		;;
	*)
		echo "Unknown gh stub scenario: ${GH_STUB_SCENARIO}" >&2
		return 64
		;;
	esac
}

# The suite creates a symlink named `gh` pointing back to itself. Branch before
# initializing any test-runner state when this process is that stub.
if [[ "${0##*/}" == "gh" ]]; then
	gh_stub "$@"
	exit $?
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="${SCRIPT_DIR}/../verify_release_tag.sh"
TEST_FILE="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"
TEST_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/verify-release-tag-test.XXXXXX")"
STUB_BIN_DIR="${TEST_TMP_DIR}/bin"
mkdir -p "$STUB_BIN_DIR"
ln -s "$TEST_FILE" "${STUB_BIN_DIR}/gh"

cleanup() {
	rm -rf "$TEST_TMP_DIR"
}
trap cleanup EXIT

export GH_STUB_STATE_FILE="${TEST_TMP_DIR}/call-count"
export GH_STUB_ENDPOINT_LOG="${TEST_TMP_DIR}/endpoints"
export STUB_REPOSITORY="OneUptime/oneuptime"
export STUB_MATCH_SHA="1111111111111111111111111111111111111111"
export STUB_OTHER_SHA="2222222222222222222222222222222222222222"
export STUB_TAG_OBJECT_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

TEST_TAG="13.0.1"
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

reset_stub() {
	export GH_STUB_SCENARIO="$1"
	printf '0\n' > "$GH_STUB_STATE_FILE"
	: > "$GH_STUB_ENDPOINT_LOG"
}

stub_call_count() {
	local count
	count="$(<"$GH_STUB_STATE_FILE")"
	printf '%s' "$count"
}

# invoke_with_args <scenario> <retry delays> <tag> <expected sha> [max peels]
invoke_with_args() {
	local scenario="$1"
	local delays="$2"
	local tag="$3"
	local expected="$4"
	local max_peels="${5:-20}"
	reset_stub "$scenario"
	status=0
	output="$(
		PATH="${STUB_BIN_DIR}:$PATH" \
			VERIFY_RELEASE_TAG_RETRY_DELAYS="$delays" \
			VERIFY_RELEASE_TAG_MAX_PEELS="$max_peels" \
			bash "$HELPER" "$STUB_REPOSITORY" "$tag" "$expected" 2>&1
	)" || status=$?
}

echo "verify_release_tag"

# A lightweight tag exposes the commit directly from the ref endpoint.
invoke_with_args lightweight_match "0 0" "$TEST_TAG" "$STUB_MATCH_SHA"
assert_eq 0 "$status" "accepts a lightweight tag at the expected commit"
assert_eq 1 "$(stub_call_count)" "uses one API request for a lightweight tag"
assert_contains "$output" "is pinned to ${STUB_MATCH_SHA}" "reports the verified commit"

# Environment-only invocation is the convenient form for GitHub Actions.
reset_stub lightweight_match
status=0
output="$(
	PATH="${STUB_BIN_DIR}:$PATH" \
		GITHUB_REPOSITORY="$STUB_REPOSITORY" \
		RELEASE_TAG="$TEST_TAG" \
		EXPECTED_SHA="$STUB_MATCH_SHA" \
		VERIFY_RELEASE_TAG_RETRY_DELAYS="0 0" \
		bash "$HELPER" 2>&1
)" || status=$?
assert_eq 0 "$status" "accepts repository, tag, and SHA from the environment"
assert_eq 1 "$(stub_call_count)" "environment invocation still makes one API request"

# A valid tag at another commit must stop the release.
invoke_with_args lightweight_mismatch "0 0" "$TEST_TAG" "$STUB_MATCH_SHA"
assert_eq 1 "$status" "rejects a lightweight tag at the wrong commit"
assert_eq 1 "$(stub_call_count)" "does not retry a provenance mismatch"
assert_contains "$output" "points to ${STUB_OTHER_SHA}" "reports the tag's actual commit"
assert_contains "$output" "releasing ${STUB_MATCH_SHA}" "reports the expected release commit"

# Annotated tags are peeled through the git/tags endpoint before comparison.
invoke_with_args annotated_match "0 0" "$TEST_TAG" "$STUB_MATCH_SHA"
assert_eq 0 "$status" "accepts an annotated tag at the expected commit"
assert_eq 2 "$(stub_call_count)" "peels an annotated tag with a second API request"
expected_endpoints="repos/${STUB_REPOSITORY}/git/ref/tags/${TEST_TAG}
repos/${STUB_REPOSITORY}/git/tags/${STUB_TAG_OBJECT_SHA}"
assert_eq "$expected_endpoints" "$(<"$GH_STUB_ENDPOINT_LOG")" "requests the ref and its annotated tag object"

# Tag names are encoded before they become part of the API endpoint.
slash_tag="release/${TEST_TAG}"
invoke_with_args lightweight_match "0 0" "$slash_tag" "$STUB_MATCH_SHA"
assert_eq 0 "$status" "accepts a tag name containing a slash"
assert_eq "repos/${STUB_REPOSITORY}/git/ref/tags/release%2F${TEST_TAG}" "$(<"$GH_STUB_ENDPOINT_LOG")" "URL-encodes the tag path"

# Successful HTTP responses still have to contain a trustworthy Git object.
invoke_with_args malformed_json "0 0" "$TEST_TAG" "$STUB_MATCH_SHA"
assert_eq 1 "$status" "rejects malformed JSON"
assert_eq 1 "$(stub_call_count)" "does not retry malformed JSON"
assert_contains "$output" "malformed response" "explains the malformed JSON failure"

invoke_with_args missing_object "0 0" "$TEST_TAG" "$STUB_MATCH_SHA"
assert_eq 1 "$status" "rejects a response with no object"
assert_contains "$output" "object.type and object.sha are required" "explains missing object fields"

invoke_with_args malformed_sha "0 0" "$TEST_TAG" "$STUB_MATCH_SHA"
assert_eq 1 "$status" "rejects an incomplete object SHA"
assert_contains "$output" "malformed Git object" "explains the invalid object SHA"

invoke_with_args non_commit "0 0" "$TEST_TAG" "$STUB_MATCH_SHA"
assert_eq 1 "$status" "rejects a tag that resolves to a non-commit object"
assert_eq 1 "$(stub_call_count)" "does not retry a non-commit object"
assert_contains "$output" "resolves to tree, not a commit" "reports the non-commit object type"

# Transient failures are retried with test-overridden zero delays.
invoke_with_args transient_then_match "0 0" "$TEST_TAG" "$STUB_MATCH_SHA"
assert_eq 0 "$status" "recovers from transient ref API failures"
assert_eq 3 "$(stub_call_count)" "retries until the ref API recovers"
assert_contains "$output" "retrying in 0s" "announces a transient API retry"
assert_contains "$output" "succeeded on attempt 3/3" "reports recovery after retries"

# The same retry policy applies while peeling an annotated tag.
invoke_with_args transient_while_peeling "0 0" "$TEST_TAG" "$STUB_MATCH_SHA"
assert_eq 0 "$status" "recovers from a transient annotated-tag API failure"
assert_eq 3 "$(stub_call_count)" "retries only the failed peel request"
assert_contains "$output" "annotated tag object ${STUB_TAG_OBJECT_SHA}" "identifies the retried tag object"

# A persistent transient error gets exactly delays+1 attempts and then fails.
invoke_with_args exhausted_transient "0 0" "$TEST_TAG" "$STUB_MATCH_SHA"
assert_eq 1 "$status" "fails when transient API retries are exhausted"
assert_eq 3 "$(stub_call_count)" "stops after the configured transient attempts"
assert_contains "$output" "still failed after 3 attempts" "reports exhausted API retries"

# Empty delays disable retries without disabling the initial request.
invoke_with_args exhausted_transient "" "$TEST_TAG" "$STUB_MATCH_SHA"
assert_eq 1 "$status" "fails cleanly when retries are disabled"
assert_eq 1 "$(stub_call_count)" "an empty delay list makes one API attempt"

# A permanent API response, such as a missing tag, must fail immediately.
invoke_with_args permanent_404 "0 0" "$TEST_TAG" "$STUB_MATCH_SHA"
assert_eq 1 "$status" "fails on a permanent GitHub API error"
assert_eq 1 "$(stub_call_count)" "does not retry a permanent GitHub API error"
assert_contains "$output" "not transient" "explains why a permanent error was not retried"

# Bound tag-object traversal even if an API returns an endless annotation chain.
invoke_with_args endless_annotations "0 0" "$TEST_TAG" "$STUB_MATCH_SHA" 2
assert_eq 1 "$status" "fails an annotated-tag chain beyond the peel limit"
assert_eq 3 "$(stub_call_count)" "stops fetching at the configured peel limit"
assert_contains "$output" "2-object annotated-tag peel limit" "reports the traversal bound"

# Invalid local inputs fail before gh can be called.
invoke_with_args lightweight_match "0 0" "$TEST_TAG" "not-a-sha"
assert_eq 2 "$status" "rejects an invalid expected SHA"
assert_eq 0 "$(stub_call_count)" "does not call GitHub for invalid local input"

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
