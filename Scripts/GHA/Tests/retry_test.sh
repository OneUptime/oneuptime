#!/usr/bin/env bash

# Unit tests for Scripts/GHA/retry.sh.
#
# retry_registry_read exists because of a release that shipped every image and
# then stranded itself as a draft (12.0.27, run 33242567303): syft hit a GHCR
# 429 partway through the SBOM job, the step exited 1, and the publish job that
# needs it never ran. The tests below pin both halves of the fix — that a
# transient registry error is retried, and that a permanent one is not, since
# retrying all 24 scans through the full backoff would bury a real failure
# under most of an hour of waiting.
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/retry_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Zero delays: these tests exercise the retry decision, not the wall clock.
# Same attempt count as production (delays + 1), none of the waiting.
export RETRY_REGISTRY_READ_DELAYS="0 0 0"
export RETRY_WITH_BACKOFF_DELAYS="0 0 0"

# shellcheck source=Scripts/GHA/retry.sh
source "${SCRIPT_DIR}/../retry.sh"

PASS=0
FAIL=0

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

# The exact stderr GHCR returned in run 33242567303, which is what this whole
# helper is for. Reproduced verbatim so a future edit to the pattern that stops
# matching the real message fails here rather than in a release.
GHCR_429_STDERR="[0019] ERROR could not determine source: errors occurred attempting to resolve 'ghcr.io/oneuptime/home:12.0.27':
  - oci-registry: GET https://ghcr.io/v2/oneuptime/home/blobs/sha256:ea1eb2d3df099d3e428113f7ea249d621dd52cbcbafc287e44958216312b8859: TOOMANYREQUESTS: retry-after: 390.000224ms
  - oci-model: not an OCI model artifact (config media type: )"

MANIFEST_UNKNOWN_STDERR="[0002] ERROR could not determine source: errors occurred attempting to resolve 'ghcr.io/oneuptime/home:12.0.27':
  - oci-registry: GET https://ghcr.io/v2/oneuptime/home/manifests/12.0.27: MANIFEST_UNKNOWN: manifest unknown"

ATTEMPTS_FILE=""

# A stand-in for syft: fails the first N attempts with the given stderr, then
# succeeds. Attempt count is kept in a file so the caller can assert on it.
fake_command() {
	local fail_times="$1" stderr_text="$2" exit_code="$3"

	local attempts
	attempts="$(cat "$ATTEMPTS_FILE")"
	attempts=$(( attempts + 1 ))
	echo "$attempts" > "$ATTEMPTS_FILE"

	if (( attempts <= fail_times )); then
		echo "$stderr_text" >&2
		return "$exit_code"
	fi

	echo "scan complete"
	return 0
}

reset_attempts() {
	ATTEMPTS_FILE="$(mktemp)"
	echo 0 > "$ATTEMPTS_FILE"
}

attempts_made() {
	cat "$ATTEMPTS_FILE"
}

echo "retry_registry_read"

# --- Succeeds first time: no retry, no delay, no noise. ---
reset_attempts
status=0
output="$(retry_registry_read "test scan" fake_command 0 "" 1 2>&1)" || status=$?
assert_eq 0 "$status" "returns 0 when the command succeeds"
assert_eq 1 "$(attempts_made)" "runs the command exactly once when it succeeds"

# --- The 12.0.27 failure: transient, so retry and recover. ---
reset_attempts
status=0
output="$(retry_registry_read "test scan" fake_command 1 "$GHCR_429_STDERR" 1 2>&1)" || status=$?
assert_eq 0 "$status" "recovers from the GHCR 429 that stranded 12.0.27"
assert_eq 2 "$(attempts_made)" "retries the 429 exactly once before succeeding"
assert_contains "$output" "TOOMANYREQUESTS" "replays the failing attempt's stderr to the log"
assert_contains "$output" "Retrying in 0s" "announces the retry"

# --- Recovers even when it takes every retry it has. ---
reset_attempts
status=0
output="$(retry_registry_read "test scan" fake_command 3 "$GHCR_429_STDERR" 1 2>&1)" || status=$?
assert_eq 0 "$status" "recovers on the last permitted attempt"
assert_eq 4 "$(attempts_made)" "makes delays+1 attempts before giving up"

# --- Never recovers: give up, and surface the command's own exit status. ---
reset_attempts
status=0
output="$(retry_registry_read "test scan" fake_command 99 "$GHCR_429_STDERR" 7 2>&1)" || status=$?
assert_eq 7 "$status" "returns the command's exit status when retries are exhausted"
assert_eq 4 "$(attempts_made)" "stops after delays+1 attempts"

# --- The half that keeps a red build fast: a missing tag is not retried. ---
reset_attempts
status=0
output="$(retry_registry_read "test scan" fake_command 99 "$MANIFEST_UNKNOWN_STDERR" 1 2>&1)" || status=$?
assert_eq 1 "$status" "fails on MANIFEST_UNKNOWN"
assert_eq 1 "$(attempts_made)" "does not retry MANIFEST_UNKNOWN"
assert_contains "$output" "retrying would not help" "explains why it did not retry"

# --- Same for an auth failure, the other permanent registry error. ---
reset_attempts
status=0
output="$(retry_registry_read "test scan" fake_command 99 "UNAUTHORIZED: authentication required" 1 2>&1)" || status=$?
assert_eq 1 "$status" "fails on UNAUTHORIZED"
assert_eq 1 "$(attempts_made)" "does not retry UNAUTHORIZED"

# --- A digest that happens to contain 429 is not a rate limit. ---
reset_attempts
DIGEST_STDERR="oci-registry: GET https://ghcr.io/v2/oneuptime/app/blobs/sha256:429429429abcdef0123456789abcdef0123456789abcdef0123456789abcdef01: MANIFEST_UNKNOWN: manifest unknown"
status=0
output="$(retry_registry_read "test scan" fake_command 99 "$DIGEST_STDERR" 1 2>&1)" || status=$?
assert_eq 1 "$(attempts_made)" "does not treat '429' inside a blob digest as a rate limit"

# --- Retries survive the other transient shapes registries produce. ---
for transient in \
	"503 Service Unavailable" \
	"502 Bad Gateway" \
	"500 Internal Server Error" \
	"read tcp 10.1.0.4:52134->140.82.121.33:443: read: connection reset by peer" \
	"net/http: TLS handshake timeout" \
	"dial tcp: lookup ghcr.io: no such host" \
	"context deadline exceeded"; do
	reset_attempts
	status=0
	retry_registry_read "test scan" fake_command 1 "$transient" 1 >/dev/null 2>&1 || status=$?
	assert_eq 2 "$(attempts_made)" "retries: ${transient:0:40}"
done

# --- An empty override turns retrying off rather than looping forever. ---
reset_attempts
status=0
# Subshell rather than a `VAR=x func` prefix: whether that prefix survives the
# call differs between bash versions, and the attempt counter lives in a file,
# so a subshell is both unambiguous and still observable.
(
	export RETRY_REGISTRY_READ_DELAYS=""
	retry_registry_read "test scan" fake_command 99 "$GHCR_429_STDERR" 1 >/dev/null 2>&1
) || status=$?
assert_eq 1 "$status" "an empty delay list still fails cleanly"
assert_eq 1 "$(attempts_made)" "an empty delay list disables retrying"

echo ""
echo "retry_with_backoff"

# The push-side helper is unchanged by this work; these pin the behaviour the
# release depends on so a future edit to the shared file cannot quietly alter it.
reset_attempts
status=0
retry_with_backoff "test push" fake_command 0 "" 1 >/dev/null 2>&1 || status=$?
assert_eq 0 "$status" "returns 0 when the command succeeds"
assert_eq 1 "$(attempts_made)" "runs the command exactly once when it succeeds"

# Unconditional retry is the point on the push side: the secondary-rate-limit
# error it exists for arrives dressed as a 403 permission denial.
reset_attempts
status=0
retry_with_backoff "test push" fake_command 99 "denied: permission_denied" 1 >/dev/null 2>&1 || status=$?
assert_eq 1 "$status" "retries any failure and returns its exit status"
assert_eq 4 "$(attempts_made)" "makes 4 attempts"

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
