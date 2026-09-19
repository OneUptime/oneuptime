#!/usr/bin/env bash

# Tests for Scripts/GHA/merge_docker_manifests.sh, driven by a fake docker on
# PATH, so nothing here touches a registry.
#
# The merge step is what turns the per-arch pushes of build_docker_images.sh
# (tags ending in -amd64 / -arm64) into the multi-arch tags that docker-compose
# (APP_TAG) and the Helm chart (image.tag, with the enterprise- prefix for
# image.type=enterprise-edition) pull. The release workflows pass every tag of
# both editions in one --tags list, so the tests pin that each one becomes a
# manifest on both registries, built from the GHCR per-arch images of the SAME
# tag, and that the SBOM check stays warn-only.
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/merge_docker_manifests_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MERGE_SCRIPT="${SCRIPT_DIR}/../merge_docker_manifests.sh"

export RETRY_WITH_BACKOFF_DELAYS="0 0 0"

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

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Records every `docker buildx imagetools create` as one line: the --tag values
# then the sources, space separated. `imagetools inspect` answers per
# FAKE_INSPECT_MODE: "sbom" (attestation present), "none" (no attestation, the
# "{}" buildx prints) or "error" (the inspect itself fails).
BIN_DIR="${WORK_DIR}/bin"
mkdir -p "$BIN_DIR"
cat > "${BIN_DIR}/docker" <<'FAKE_EOF'
#!/usr/bin/env bash
set -uo pipefail
if [[ "${1:-} ${2:-} ${3:-}" == "buildx imagetools create" ]]; then
	shift 3
	count_file="${FAKE_DOCKER_STATE_DIR}/create-count"
	count=0
	[[ -f "$count_file" ]] && count="$(cat "$count_file")"
	count=$(( count + 1 ))
	echo "$count" > "$count_file"
	if (( count <= ${FAKE_CREATE_FAIL_TIMES:-0} )); then
		echo "denied: You have exceeded a secondary rate limit" >&2
		exit 1
	fi
	tags=()
	sources=()
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--tag) tags+=("$2"); shift 2 ;;
			*) sources+=("$1"); shift ;;
		esac
	done
	echo "tags=${tags[*]} sources=${sources[*]}" >> "${FAKE_DOCKER_STATE_DIR}/creates"
	exit 0
fi
if [[ "${1:-} ${2:-} ${3:-}" == "buildx imagetools inspect" ]]; then
	echo "$4" >> "${FAKE_DOCKER_STATE_DIR}/inspects"
	case "${FAKE_INSPECT_MODE:-sbom}" in
		sbom) echo '{"linux/amd64":{"SPDX":{"spdxVersion":"SPDX-2.3"}}}' ;;
		none) echo '{}' ;;
		error) echo "ERROR: 503 Service Unavailable" >&2; exit 1 ;;
	esac
	exit 0
fi
echo "unexpected docker call: $*" >&2
exit 2
FAKE_EOF
chmod +x "${BIN_DIR}/docker"
export PATH="${BIN_DIR}:${PATH}"

reset_state() {
	export FAKE_DOCKER_STATE_DIR="${WORK_DIR}/state-${RANDOM}-${RANDOM}"
	mkdir -p "$FAKE_DOCKER_STATE_DIR"
	export FAKE_CREATE_FAIL_TIMES=0
	export FAKE_INSPECT_MODE=sbom
	touch "${FAKE_DOCKER_STATE_DIR}/creates" "${FAKE_DOCKER_STATE_DIR}/inspects"
}

run_merge() {
	bash "$MERGE_SCRIPT" "$@" 2>&1
}

echo "merge_docker_manifests.sh"

# --- The release.yml App tag list: both editions, one manifest each. ---
reset_state
status=0
output="$(run_merge --image app --tags "13.1.0,enterprise-13.1.0")" || status=$?
assert_eq 0 "$status" "merges the release tag list"
assert_eq 2 "$(wc -l < "${FAKE_DOCKER_STATE_DIR}/creates" | tr -d ' ')" "creates one manifest per tag"
assert_eq "tags=ghcr.io/oneuptime/app:13.1.0 oneuptime/app:13.1.0 sources=ghcr.io/oneuptime/app:13.1.0-amd64 ghcr.io/oneuptime/app:13.1.0-arm64" \
	"$(sed -n 1p "${FAKE_DOCKER_STATE_DIR}/creates")" "community manifest: both registries, from the GHCR per-arch images of the same tag"
assert_eq "tags=ghcr.io/oneuptime/app:enterprise-13.1.0 oneuptime/app:enterprise-13.1.0 sources=ghcr.io/oneuptime/app:enterprise-13.1.0-amd64 ghcr.io/oneuptime/app:enterprise-13.1.0-arm64" \
	"$(sed -n 2p "${FAKE_DOCKER_STATE_DIR}/creates")" "enterprise manifest: never assembled from the community per-arch images"
assert_contains "$output" "SBOM attestation present on app:enterprise-13.1.0" "checks the SBOM of every merged tag"
assert_eq "ghcr.io/oneuptime/app:13.1.0
ghcr.io/oneuptime/app:enterprise-13.1.0" "$(cat "${FAKE_DOCKER_STATE_DIR}/inspects")" "inspects each merged tag on GHCR"

# --- test-release.yaml's list: extra tags, whitespace and empty entries. ---
reset_state
status=0
output="$(run_merge --image app --tags " 13.1.0-test, test ,,enterprise-13.1.0-test,enterprise-test,")" || status=$?
assert_eq 0 "$status" "merges the test-release tag list"
assert_eq "13.1.0-test test enterprise-13.1.0-test enterprise-test" \
	"$(sed -E 's/^tags=ghcr.io\/oneuptime\/app:([^ ]+) .*/\1/' "${FAKE_DOCKER_STATE_DIR}/creates" | tr '\n' ' ' | sed 's/ $//')" \
	"trims whitespace and skips empty entries, in order"

# --- A rate-limited merge is retried. ---
reset_state
export FAKE_CREATE_FAIL_TIMES=1
status=0
output="$(run_merge --image nginx --tags "13.1.0")" || status=$?
assert_eq 0 "$status" "recovers from a rate-limited manifest push"
assert_eq 2 "$(cat "${FAKE_DOCKER_STATE_DIR}/create-count")" "retried the manifest push once"
assert_contains "$output" "succeeded on attempt 2/4" "reports the retry"

# --- A merge that never succeeds fails the job. ---
reset_state
export FAKE_CREATE_FAIL_TIMES=99
status=0
output="$(run_merge --image nginx --tags "13.1.0,enterprise-13.1.0")" || status=$?
assert_eq 1 "$status" "fails when the manifest push never succeeds"
assert_eq 4 "$(cat "${FAKE_DOCKER_STATE_DIR}/create-count")" "gives up after the last retry, before the next tag"

# --- The SBOM check is warn-only, with three distinct outcomes. ---
reset_state
export FAKE_INSPECT_MODE=none
status=0
output="$(run_merge --image app --tags "13.1.0")" || status=$?
assert_eq 0 "$status" "a missing SBOM does not fail the merge"
assert_contains "$output" "No SBOM attestation found on app:13.1.0" "says the SBOM is missing"

reset_state
export FAKE_INSPECT_MODE=error
status=0
output="$(run_merge --image app --tags "13.1.0")" || status=$?
assert_eq 0 "$status" "a failed inspect does not fail the merge"
assert_contains "$output" "Could not inspect app:13.1.0 for attestations" "reports a failed inspect as such, not as a missing SBOM"
assert_contains "$output" "503 Service Unavailable" "keeps the inspect's own error in the log"

# --- Argument errors. ---
reset_state
status=0
output="$(run_merge --image app)" || status=$?
assert_eq 1 "$status" "fails without --tags"
assert_contains "$output" "Missing required arguments" "says arguments are missing"
assert_eq 0 "$(wc -l < "${FAKE_DOCKER_STATE_DIR}/creates" | tr -d ' ')" "never calls docker on an argument error"

status=0
output="$(run_merge --image app --tags 1.0 --bogus)" || status=$?
assert_eq 1 "$status" "fails on an unknown option"
assert_contains "$output" "Unknown option: --bogus" "names the unknown option"

status=0
output="$(run_merge --help)" || status=$?
assert_eq 0 "$status" "--help exits 0"

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
