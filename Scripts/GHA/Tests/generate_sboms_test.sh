#!/usr/bin/env bash

# End-to-end tests for Scripts/GHA/generate_sboms.sh, driven by a fake syft on
# PATH so nothing here touches a registry.
#
# The case that matters is the first one: it replays release 12.0.27
# (run 33242567303), where syft hit a GHCR 429 partway through the home image,
# the step exited 1, and the release stayed a draft even though every image and
# tag had already shipped.
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/generate_sboms_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERATE_SBOMS="${SCRIPT_DIR}/../generate_sboms.sh"

# The scan loop is 24 registry reads; with real delays the failure cases below
# would sleep for minutes without testing anything extra.
export RETRY_REGISTRY_READ_DELAYS="0 0 0"

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

# Builds a fake syft on PATH.
#
# FAKE_SYFT_FAIL_REF   — image ref substring to fail on ("" = never fail)
# FAKE_SYFT_FAIL_TIMES — how many times each (ref, platform) fails first
# FAKE_SYFT_FAIL_STDERR— what it writes to stderr when it fails
# FAKE_SYFT_COMPONENTS — components to emit on success
#
# It writes the output file only on a successful run, which is what makes the
# "leaves no partial file behind" assertions meaningful.
setup_fake_syft() {
	local bin_dir="${WORK_DIR}/bin"
	mkdir -p "$bin_dir"

	cat > "${bin_dir}/syft" <<'FAKE_EOF'
#!/usr/bin/env bash
set -uo pipefail

ref=""
platform=""
out=""
source_scheme=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--platform) platform="$2"; shift 2 ;;
		--output) out="${2#cyclonedx-json=}"; shift 2 ;;
		registry:*) ref="${1#registry:}"; source_scheme="registry"; shift ;;
		docker:*) ref="${1#docker:}"; source_scheme="docker"; shift ;;
		*) shift ;;
	esac
done

# Fail deterministically per (ref, platform) so a retry can succeed where the
# first attempt did not.
key="$(echo "${ref}-${platform}" | tr -c 'a-zA-Z0-9' '_')"
counter="${FAKE_SYFT_STATE_DIR}/${key}"
attempts=0
[[ -f "$counter" ]] && attempts="$(cat "$counter")"
attempts=$(( attempts + 1 ))
echo "$attempts" > "$counter"

if [[ "$source_scheme" == "registry" ]] \
	&& [[ -n "${FAKE_SYFT_FAIL_REF}" && "$ref" == *"${FAKE_SYFT_FAIL_REF}"* ]] \
	&& (( attempts <= FAKE_SYFT_FAIL_TIMES )); then
	echo "$FAKE_SYFT_FAIL_STDERR" >&2
	exit 1
fi

# The docker path can be told to fail too, so the "both paths are exhausted"
# case is reachable.
if [[ "$source_scheme" == "docker" && "${FAKE_SYFT_DOCKER_FAILS:-false}" == "true" ]]; then
	echo "$FAKE_SYFT_FAIL_STDERR" >&2
	exit 1
fi

components=""
i=0
while (( i < FAKE_SYFT_COMPONENTS )); do
	[[ -n "$components" ]] && components="${components},"
	components="${components}{\"type\":\"library\",\"name\":\"pkg-${i}\",\"version\":\"1.0.0\"}"
	i=$(( i + 1 ))
done

echo "$source_scheme" >> "${FAKE_SYFT_STATE_DIR}/schemes"

cat > "$out" <<JSON
{"bomFormat":"CycloneDX","specVersion":"1.5","version":1,"components":[${components}]}
JSON
FAKE_EOF

	chmod +x "${bin_dir}/syft"

	# Stands in for the docker CLI the fallback shells out to. Records every
	# pull so the tests can assert the fallback ran (and that it cleaned up
	# after itself, which is what keeps 24 scans from filling the runner).
	cat > "${bin_dir}/docker" <<'FAKE_EOF'
#!/usr/bin/env bash
set -uo pipefail

case "${1:-}" in
	pull)
		shift
		platform=""
		ref=""
		while [[ $# -gt 0 ]]; do
			case "$1" in
				--platform) platform="$2"; shift 2 ;;
				*) ref="$1"; shift ;;
			esac
		done
		echo "$ref $platform" >> "${FAKE_SYFT_STATE_DIR}/docker-pulls"
		if [[ "${FAKE_DOCKER_PULL_FAILS:-false}" == "true" ]]; then
			echo "toomanyrequests: retry-after: 210ms" >&2
			exit 1
		fi
		echo "${platform}" > "${FAKE_SYFT_STATE_DIR}/docker-image-platform"
		exit 0
		;;
	image)
		case "${2:-}" in
			inspect)
				# Report the platform the pull actually landed, so the script's
				# mislabelling guard is exercised for real.
				if [[ "${FAKE_DOCKER_WRONG_PLATFORM:-false}" == "true" ]]; then
					echo "linux/riscv64"
				else
					cat "${FAKE_SYFT_STATE_DIR}/docker-image-platform"
				fi
				exit 0
				;;
			rm)
				echo "${*:3}" >> "${FAKE_SYFT_STATE_DIR}/docker-removals"
				exit 0
				;;
		esac
		exit 0
		;;
esac
exit 0
FAKE_EOF

	chmod +x "${bin_dir}/docker"
	export PATH="${bin_dir}:${PATH}"
}

# Fresh per-scan attempt counters for each scenario.
reset_fake_syft_state() {
	export FAKE_SYFT_STATE_DIR="${WORK_DIR}/state-$$-${RANDOM}"
	mkdir -p "$FAKE_SYFT_STATE_DIR"
}

setup_fake_syft

export FAKE_SYFT_DOCKER_FAILS=false
export FAKE_DOCKER_PULL_FAILS=false
export FAKE_DOCKER_WRONG_PLATFORM=false

GHCR_429_STDERR="[0019] ERROR could not determine source: errors occurred attempting to resolve 'ghcr.io/oneuptime/home:12.0.27':
  - oci-registry: GET https://ghcr.io/v2/oneuptime/home/blobs/sha256:ea1eb2d3df099d3e428113f7ea249d621dd52cbcbafc287e44958216312b8859: TOOMANYREQUESTS: retry-after: 390.000224ms
  - oci-model: not an OCI model artifact (config media type: )"

MANIFEST_UNKNOWN_STDERR="[0002] ERROR could not determine source: errors occurred attempting to resolve 'ghcr.io/oneuptime/home:12.0.27':
  - oci-registry: GET https://ghcr.io/v2/oneuptime/home/manifests/12.0.27: MANIFEST_UNKNOWN: manifest unknown"

# generate_sboms.sh scans 12 images across the platforms it is given. Both are
# passed on every run below so the assertions state real numbers.
EXPECTED_IMAGES=12
REGISTRY_PREFIX="ghcr.io/oneuptime"

# Each run is 12 scans per platform, and every scan shells out to syft and then
# to python3, so scenarios that do not actually assert anything per-platform
# pass a single platform to keep the suite quick.
run_generate() {
	local out_dir="$1"
	local platforms="$2"
	bash "$GENERATE_SBOMS" \
		--version "12.0.27" \
		--output-dir "$out_dir" \
		--platforms "$platforms" 2>&1
}

echo "generate_sboms.sh"

# --- Happy path. ---
reset_fake_syft_state
export FAKE_SYFT_FAIL_REF="" FAKE_SYFT_FAIL_TIMES=0 FAKE_SYFT_FAIL_STDERR="" FAKE_SYFT_COMPONENTS=3
OUT_DIR="${WORK_DIR}/out-ok"
status=0
output="$(run_generate "$OUT_DIR" "linux/amd64,linux/arm64")" || status=$?
assert_eq 0 "$status" "succeeds when every scan succeeds"
assert_eq $(( EXPECTED_IMAGES * 2 )) "$(ls "$OUT_DIR"/*.cdx.json 2>/dev/null | wc -l | tr -d ' ')" "writes one SBOM per image per platform"
assert_contains "$output" "Image list matches release.yml" "still checks image list drift against release.yml"

# --- The regression: a transient 429 on one image must not sink the release. ---
reset_fake_syft_state
export FAKE_SYFT_FAIL_REF="home" FAKE_SYFT_FAIL_TIMES=1 FAKE_SYFT_FAIL_STDERR="$GHCR_429_STDERR" FAKE_SYFT_COMPONENTS=3
OUT_DIR="${WORK_DIR}/out-429"
status=0
output="$(run_generate "$OUT_DIR" "linux/amd64")" || status=$?
assert_eq 0 "$status" "survives the GHCR 429 that stranded 12.0.27"
assert_eq "$EXPECTED_IMAGES" "$(ls "$OUT_DIR"/*.cdx.json 2>/dev/null | wc -l | tr -d ' ')" "still writes every SBOM after recovering"
assert_contains "$output" "hit a transient registry error" "reports the retry"
assert_eq 2 "$(cat "${FAKE_SYFT_STATE_DIR}"/*home*amd64* 2>/dev/null)" "retried the failing scan exactly once"

# --- Recovers even when a scan needs every retry it is allowed. ---
reset_fake_syft_state
export FAKE_SYFT_FAIL_REF="home" FAKE_SYFT_FAIL_TIMES=3 FAKE_SYFT_FAIL_STDERR="$GHCR_429_STDERR" FAKE_SYFT_COMPONENTS=3
OUT_DIR="${WORK_DIR}/out-429-max"
status=0
output="$(run_generate "$OUT_DIR" "linux/amd64")" || status=$?
assert_eq 0 "$status" "recovers on the last permitted attempt"
assert_eq "$EXPECTED_IMAGES" "$(ls "$OUT_DIR"/*.cdx.json 2>/dev/null | wc -l | tr -d ' ')" "writes every SBOM after exhausting the retries"

# --- 12.0.27's actual failure: the registry read never gets through, and the
# --- docker-pull fallback is what keeps the release moving.
reset_fake_syft_state
export FAKE_SYFT_FAIL_REF="home" FAKE_SYFT_FAIL_TIMES=99 FAKE_SYFT_FAIL_STDERR="$GHCR_429_STDERR" FAKE_SYFT_COMPONENTS=3
OUT_DIR="${WORK_DIR}/out-429-forever"
status=0
output="$(run_generate "$OUT_DIR" "linux/amd64")" || status=$?
assert_eq 0 "$status" "falls back to docker pull when the registry read never recovers"
assert_eq "$EXPECTED_IMAGES" "$(ls "$OUT_DIR"/*.cdx.json 2>/dev/null | wc -l | tr -d ' ')" "writes every SBOM via the fallback"
assert_eq 4 "$(cat "${FAKE_SYFT_STATE_DIR}"/*home*amd64* 2>/dev/null)" "exhausts the registry retries before falling back"
assert_contains "$output" "retrying ${REGISTRY_PREFIX}/home:12.0.27 (linux/amd64) via docker pull" "says it is falling back"
assert_eq 1 "$(grep -c "home" "${FAKE_SYFT_STATE_DIR}/docker-pulls" 2>/dev/null || echo 0)" "pulls only the image that needed it"
assert_eq 1 "$(grep -c "home" "${FAKE_SYFT_STATE_DIR}/docker-removals" 2>/dev/null || echo 0)" "removes the pulled image so 24 scans cannot fill the runner"
assert_eq 1 "$(grep -c "^docker$" "${FAKE_SYFT_STATE_DIR}/schemes" 2>/dev/null || echo 0)" "scans exactly one image from the daemon"

# --- When both paths are exhausted the job still fails, honestly. ---
reset_fake_syft_state
export FAKE_SYFT_FAIL_REF="home" FAKE_SYFT_FAIL_TIMES=99 FAKE_SYFT_FAIL_STDERR="$GHCR_429_STDERR" FAKE_SYFT_COMPONENTS=3
export FAKE_SYFT_DOCKER_FAILS=true
OUT_DIR="${WORK_DIR}/out-both-fail"
status=0
output="$(run_generate "$OUT_DIR" "linux/amd64,linux/arm64")" || status=$?
export FAKE_SYFT_DOCKER_FAILS=false
assert_eq 1 "$status" "fails when neither path can read the image"
assert_contains "$output" "SBOM generation failed for: home/linux/amd64 home/linux/arm64" "names the images that failed"
# The release job attaches sbom/*.cdx.json by glob, so a half-written file from
# a failed attempt must not be sitting in the output directory.
assert_eq 0 "$(ls "$OUT_DIR"/home-*.cdx.json 2>/dev/null | wc -l | tr -d ' ')" "leaves no partial SBOM behind for the release glob"

# --- A pull that is itself throttled is retried, then gives up. ---
reset_fake_syft_state
export FAKE_SYFT_FAIL_REF="home" FAKE_SYFT_FAIL_TIMES=99 FAKE_SYFT_FAIL_STDERR="$GHCR_429_STDERR" FAKE_SYFT_COMPONENTS=3
export FAKE_DOCKER_PULL_FAILS=true
OUT_DIR="${WORK_DIR}/out-pull-fails"
status=0
output="$(run_generate "$OUT_DIR" "linux/amd64")" || status=$?
export FAKE_DOCKER_PULL_FAILS=false
assert_eq 1 "$status" "fails when the docker pull is throttled too"
# docker spells it "toomanyrequests"; syft spells it "TOOMANYREQUESTS". The
# retry has to recognise both, so this pins the case-insensitive match.
assert_eq 4 "$(grep -c "home" "${FAKE_SYFT_STATE_DIR}/docker-pulls" 2>/dev/null || echo 0)" "retries a throttled docker pull too"

# --- The pull must not be trusted to have landed the right architecture. ---
reset_fake_syft_state
export FAKE_SYFT_FAIL_REF="home" FAKE_SYFT_FAIL_TIMES=99 FAKE_SYFT_FAIL_STDERR="$GHCR_429_STDERR" FAKE_SYFT_COMPONENTS=3
export FAKE_DOCKER_WRONG_PLATFORM=true
OUT_DIR="${WORK_DIR}/out-wrong-platform"
status=0
output="$(run_generate "$OUT_DIR" "linux/amd64")" || status=$?
export FAKE_DOCKER_WRONG_PLATFORM=false
assert_eq 1 "$status" "refuses an SBOM for the wrong architecture"
assert_contains "$output" "returned linux/riscv64, expected linux/amd64" "says which architecture it actually got"
assert_eq 0 "$(ls "$OUT_DIR"/home-*.cdx.json 2>/dev/null | wc -l | tr -d ' ')" "writes no mislabelled SBOM"

# --- A tag that was never pushed fails fast instead of grinding. ---
reset_fake_syft_state
export FAKE_SYFT_FAIL_REF="home" FAKE_SYFT_FAIL_TIMES=99 FAKE_SYFT_FAIL_STDERR="$MANIFEST_UNKNOWN_STDERR" FAKE_SYFT_COMPONENTS=3
# A tag that does not exist cannot be pulled either, so model both failing.
export FAKE_DOCKER_PULL_FAILS=true
OUT_DIR="${WORK_DIR}/out-missing-tag"
status=0
output="$(run_generate "$OUT_DIR" "linux/amd64")" || status=$?
export FAKE_DOCKER_PULL_FAILS=false
assert_eq 1 "$status" "fails when a tag is missing"
assert_eq 1 "$(cat "${FAKE_SYFT_STATE_DIR}"/*home*amd64* 2>/dev/null)" "does not retry a missing tag on the registry path"
assert_contains "$output" "retrying would not help" "says why it gave up immediately"

# --- An empty SBOM is still rejected, and still not left on disk. ---
reset_fake_syft_state
export FAKE_SYFT_FAIL_REF="" FAKE_SYFT_FAIL_TIMES=0 FAKE_SYFT_FAIL_STDERR="" FAKE_SYFT_COMPONENTS=0
OUT_DIR="${WORK_DIR}/out-empty"
status=0
output="$(run_generate "$OUT_DIR" "linux/amd64")" || status=$?
assert_eq 1 "$status" "rejects an SBOM with zero components"
assert_contains "$output" "contains zero components" "explains the rejection"
assert_eq 0 "$(ls "$OUT_DIR"/*.cdx.json 2>/dev/null | wc -l | tr -d ' ')" "leaves no zero-component SBOM behind"

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
