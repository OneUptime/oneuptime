#!/usr/bin/env bash

# Tests for Scripts/GHA/check_tested_digests.sh, the check push-release-tags
# (release.yml) runs before it moves any `release` tag: each merged tag's
# linux/amd64 image must be the -amd64 image the release's e2e jobs ran.
#
# A fake docker on PATH answers `docker buildx imagetools inspect <ref>
# --format '{{json .Manifest}}'` from a fake registry: one JSON file per
# reference, in the shapes the registry really answers (14.0.100's
# ghcr.io/oneuptime/app:14.0.100 and :14.0.100-amd64 - an OCI index with each
# image's attestation as an unknown/unknown entry), "manifest unknown" for a
# reference it has no file for, and a rate limit for the first N reads of a
# reference when told to. So every way the check can pass or fail is
# exercised without a registry.
#
# Needs bash and jq. Run with: npm run test-gha-scripts
# (or bash Scripts/GHA/Tests/check_tested_digests_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="${SCRIPT_DIR}/../check_tested_digests.sh"

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
		fail "$what — '${needle}' not found in output: ${haystack}"
	fi
}

assert_not_contains() {
	local haystack="$1" needle="$2" what="$3"
	if [[ "$haystack" != *"$needle"* ]]; then
		pass "$what"
	else
		fail "$what — '${needle}' unexpectedly found in output"
	fi
}

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

BIN_DIR="${WORK_DIR}/bin"
mkdir -p "$BIN_DIR"
cat > "${BIN_DIR}/docker" <<'FAKE_EOF'
#!/usr/bin/env bash
set -uo pipefail
if [[ "${1:-} ${2:-} ${3:-}" != "buildx imagetools inspect" ]]; then
	echo "unexpected docker call: $*" >&2
	exit 2
fi
reference="$4"
if [[ "${5:-} ${6:-}" != "--format {{json .Manifest}}" ]]; then
	echo "unexpected inspect flags: $*" >&2
	exit 2
fi
echo "$reference" >> "${FAKE_REGISTRY}/reads"
file="${FAKE_REGISTRY}/$(echo "$reference" | tr '/:' '__').json"
transient="${file%.json}.transient"
if [[ -f "$transient" ]]; then
	left="$(cat "$transient")"
	if (( left > 0 )); then
		echo $(( left - 1 )) > "$transient"
		echo "ERROR: GET https://ghcr.io/v2/${reference}: TOOMANYREQUESTS: retry-after: 390.000224ms" >&2
		exit 1
	fi
fi
if [[ ! -f "$file" ]]; then
	echo "ERROR: ${reference}: not found: manifest unknown" >&2
	exit 1
fi
cat "$file"
FAKE_EOF
chmod +x "${BIN_DIR}/docker"
export PATH="${BIN_DIR}:${PATH}"

reset_registry() {
	export FAKE_REGISTRY="${WORK_DIR}/registry-${RANDOM}-${RANDOM}"
	mkdir -p "$FAKE_REGISTRY"
	touch "${FAKE_REGISTRY}/reads"
}

registry_file() {
	echo "${FAKE_REGISTRY}/$(echo "$1" | tr '/:' '__').json"
}

# A digest made of one repeated hex character: sha256:aaaa...
digest() {
	printf 'sha256:%064d' 0 | tr 0 "$1"
}

# What the registry answers for a per-arch tag the build pushed: an index of
# the image and its attestation (build_docker_images.sh's --sbom/--provenance).
put_tested() {
	local reference="$1" image_digest="$2"
	cat > "$(registry_file "$reference")" <<EOF
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.image.index.v1+json",
  "digest": "$(digest f)",
  "size": 858,
  "manifests": [
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "${image_digest}",
      "size": 12061,
      "platform": { "architecture": "amd64", "os": "linux" }
    },
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "$(digest e)",
      "size": 1114,
      "annotations": {
        "vnd.docker.reference.digest": "${image_digest}",
        "vnd.docker.reference.type": "attestation-manifest"
      },
      "platform": { "architecture": "unknown", "os": "unknown" }
    }
  ]
}
EOF
}

# What it answers for a merged tag: both architectures and their attestations.
put_merged() {
	local reference="$1" amd64_digest="$2"
	cat > "$(registry_file "$reference")" <<EOF
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.image.index.v1+json",
  "digest": "$(digest d)",
  "size": 1716,
  "manifests": [
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "${amd64_digest}",
      "size": 12061,
      "platform": { "architecture": "amd64", "os": "linux" }
    },
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "$(digest e)",
      "size": 1114,
      "annotations": {
        "vnd.docker.reference.digest": "${amd64_digest}",
        "vnd.docker.reference.type": "attestation-manifest"
      },
      "platform": { "architecture": "unknown", "os": "unknown" }
    },
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "$(digest c)",
      "size": 12061,
      "platform": { "architecture": "arm64", "os": "linux" }
    },
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "$(digest b)",
      "size": 1114,
      "annotations": {
        "vnd.docker.reference.digest": "$(digest c)",
        "vnd.docker.reference.type": "attestation-manifest"
      },
      "platform": { "architecture": "unknown", "os": "unknown" }
    }
  ]
}
EOF
}

# A single image's manifest, no index: what a build without attestations pushes.
put_single_manifest() {
	local reference="$1" image_digest="$2"
	cat > "$(registry_file "$reference")" <<EOF
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.image.manifest.v1+json",
  "digest": "${image_digest}",
  "size": 12061
}
EOF
}

# Every tag of <image> as a release run leaves it: both editions merged from
# the -amd64 images, with the same digests.
put_release() {
	local image="$1" version="$2" community="$3" enterprise="$4"
	put_tested "ghcr.io/oneuptime/${image}:${version}-amd64" "$community"
	put_merged "ghcr.io/oneuptime/${image}:${version}" "$community"
	put_tested "ghcr.io/oneuptime/${image}:enterprise-${version}-amd64" "$enterprise"
	put_merged "ghcr.io/oneuptime/${image}:enterprise-${version}" "$enterprise"
}

run_check() {
	bash "$CHECK_SCRIPT" "$@" 2>&1
}

echo "check_tested_digests.sh"

# --- Every merged tag is its -amd64 image: passes, naming each. ---
reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
put_release nginx 14.0.101 "$(digest 3)" "$(digest 4)"
status=0
output="$(run_check --images "app nginx" --version 14.0.101)" || status=$?
assert_eq 0 "$status" "passes when every merged tag's amd64 image is the tested one"
assert_contains "$output" "✅ app:14.0.101's linux/amd64 image is $(digest 1), the one the e2e jobs ran (app:14.0.101-amd64)" "names the community tag and its digest"
assert_contains "$output" "✅ app:enterprise-14.0.101's linux/amd64 image is $(digest 2)" "checks the enterprise edition too"
assert_contains "$output" "✅ nginx:enterprise-14.0.101's linux/amd64 image is $(digest 4)" "checks every image it is given"
assert_eq "ghcr.io/oneuptime/app:14.0.101
ghcr.io/oneuptime/app:14.0.101-amd64
ghcr.io/oneuptime/app:enterprise-14.0.101
ghcr.io/oneuptime/app:enterprise-14.0.101-amd64
ghcr.io/oneuptime/nginx:14.0.101
ghcr.io/oneuptime/nginx:14.0.101-amd64
ghcr.io/oneuptime/nginx:enterprise-14.0.101
ghcr.io/oneuptime/nginx:enterprise-14.0.101-amd64" "$(cat "${FAKE_REGISTRY}/reads")" "reads each merged tag and its -amd64 tag on GHCR, once each"
assert_not_contains "$output" "::error" "says nothing is wrong"

# --- The env push-release-tags passes: a list over lines, and commas. ---
reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
put_release probe 14.0.101 "$(digest 3)" "$(digest 4)"
status=0
output="$(run_check --images "
  app
  probe" --version 14.0.101)" || status=$?
assert_eq 0 "$status" "reads a list folded over lines, as RELEASE_TAG_IMAGES is"
status=0
output="$(run_check --images "app,probe" --version 14.0.101)" || status=$?
assert_eq 0 "$status" "reads a comma separated list"

# --- One merged tag that is not the tested image: fails naming it, checks the rest. ---
reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
put_release nginx 14.0.101 "$(digest 3)" "$(digest 4)"
put_merged "ghcr.io/oneuptime/app:enterprise-14.0.101" "$(digest 9)"
status=0
output="$(run_check --images "app nginx" --version 14.0.101)" || status=$?
assert_eq 1 "$status" "fails when a merged tag's amd64 image is not the one the e2e jobs ran"
assert_contains "$output" "::error title=Untested image::app:enterprise-14.0.101's linux/amd64 image is $(digest 9), but the e2e jobs ran app:enterprise-14.0.101-amd64, $(digest 2)" "names the tag and both digests"
assert_contains "$output" "✅ nginx:enterprise-14.0.101" "still checks every other image"
assert_contains "$output" "::error title=Release tags not moved::not the images the e2e jobs ran: app:enterprise-14.0.101" "names every tag that failed, and only those"

# --- Several failures: all named. ---
reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
put_release nginx 14.0.101 "$(digest 3)" "$(digest 4)"
put_merged "ghcr.io/oneuptime/app:14.0.101" "$(digest 9)"
put_tested "ghcr.io/oneuptime/nginx:enterprise-14.0.101-amd64" "$(digest 8)"
status=0
output="$(run_check --images "app nginx" --version 14.0.101)" || status=$?
assert_eq 1 "$status" "fails when an -amd64 tag was pushed again after the merge read it"
assert_contains "$output" "::error title=Release tags not moved::not the images the e2e jobs ran: app:14.0.101 nginx:enterprise-14.0.101" "names all of them"

# --- A tag nobody pushed: named, and not retried. ---
reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
rm "$(registry_file "ghcr.io/oneuptime/app:enterprise-14.0.101")"
status=0
output="$(run_check --images "app" --version 14.0.101)" || status=$?
assert_eq 1 "$status" "fails when a merged tag cannot be read"
assert_contains "$output" "::error title=Untested image::app:enterprise-14.0.101 - could not read ghcr.io/oneuptime/app:enterprise-14.0.101" "says which tag it could not read"
assert_eq 1 "$(grep -c 'app:enterprise-14.0.101$' "${FAKE_REGISTRY}/reads")" "reads a tag that was never pushed once: retrying would not help"
assert_contains "$output" "manifest unknown" "keeps the registry's own words in the log"

reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
rm "$(registry_file "ghcr.io/oneuptime/app:14.0.101-amd64")"
status=0
output="$(run_check --images "app" --version 14.0.101)" || status=$?
assert_eq 1 "$status" "fails when an -amd64 tag cannot be read"
assert_contains "$output" "app:14.0.101 - could not read ghcr.io/oneuptime/app:14.0.101-amd64" "names it"

# --- A registry that turns a read away for a moment: retried, then passes. ---
reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
echo 2 > "${FAKE_REGISTRY}/$(echo "ghcr.io/oneuptime/app:14.0.101-amd64" | tr '/:' '__').transient"
status=0
output="$(run_check --images "app" --version 14.0.101)" || status=$?
assert_eq 0 "$status" "retries a rate-limited read and passes"
assert_eq 3 "$(grep -c 'app:14.0.101-amd64$' "${FAKE_REGISTRY}/reads")" "read it three times: two refusals, then the answer"
assert_contains "$output" "succeeded on attempt 3/4" "says it took three attempts"
assert_contains "$output" "✅ app:14.0.101's linux/amd64 image is $(digest 1)" "the retry's own lines never end up in the digest"

reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
echo 9 > "${FAKE_REGISTRY}/$(echo "ghcr.io/oneuptime/app:14.0.101" | tr '/:' '__').transient"
status=0
output="$(run_check --images "app" --version 14.0.101)" || status=$?
assert_eq 1 "$status" "gives up after retry.sh's attempts"
assert_eq 4 "$(grep -c 'app:14.0.101$' "${FAKE_REGISTRY}/reads")" "four attempts, as retry_registry_read makes"
assert_contains "$output" "::error title=Release tags not moved::not the images the e2e jobs ran: app:14.0.101" "and names it"

# --- Merged tags that are not what a merge makes. ---
reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
put_single_manifest "ghcr.io/oneuptime/app:14.0.101" "$(digest 1)"
status=0
output="$(run_check --images "app" --version 14.0.101)" || status=$?
assert_eq 1 "$status" "fails on a merged tag that is a single image, not a multi-arch index"
assert_contains "$output" "app:14.0.101 - ghcr.io/oneuptime/app:14.0.101: not a multi-arch index" "says so"

reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
cat > "$(registry_file "ghcr.io/oneuptime/app:14.0.101")" <<EOF
{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","digest":"$(digest d)","manifests":[{"digest":"$(digest c)","platform":{"architecture":"arm64","os":"linux"}}]}
EOF
status=0
output="$(run_check --images "app" --version 14.0.101)" || status=$?
assert_eq 1 "$status" "fails on a merged index with no linux/amd64 image"
assert_contains "$output" "no linux/amd64 image in its index" "says so"

reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
cat > "$(registry_file "ghcr.io/oneuptime/app:14.0.101")" <<EOF
{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","digest":"$(digest d)","manifests":[{"digest":"$(digest 1)","platform":{"architecture":"amd64","os":"linux"}},{"digest":"$(digest 7)","platform":{"architecture":"amd64","os":"linux"}}]}
EOF
status=0
output="$(run_check --images "app" --version 14.0.101)" || status=$?
assert_eq 1 "$status" "fails on a merged index with two linux/amd64 images, rather than pick one"
assert_contains "$output" "2 linux/amd64 images in its index" "says so"

reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
echo "not json" > "$(registry_file "ghcr.io/oneuptime/app:14.0.101")"
status=0
output="$(run_check --images "app" --version 14.0.101)" || status=$?
assert_eq 1 "$status" "fails on an answer that is not a manifest"
assert_contains "$output" "could not read ghcr.io/oneuptime/app:14.0.101's manifest" "says so"

# --- A per-arch tag pushed without attestations: its own amd64 image. ---
reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
put_single_manifest "ghcr.io/oneuptime/app:14.0.101-amd64" "$(digest 1)"
status=0
output="$(run_check --images "app" --version 14.0.101)" || status=$?
assert_eq 0 "$status" "takes a single-manifest -amd64 tag as its own linux/amd64 image"

reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
put_single_manifest "ghcr.io/oneuptime/app:14.0.101-amd64" "$(digest 5)"
status=0
output="$(run_check --images "app" --version 14.0.101)" || status=$?
assert_eq 1 "$status" "and still compares its digest"

# --- The attestation entries are never taken for the image. ---
reset_registry
put_release app 14.0.101 "$(digest 1)" "$(digest 2)"
put_merged "ghcr.io/oneuptime/app:14.0.101" "$(digest e)"
status=0
output="$(run_check --images "app" --version 14.0.101)" || status=$?
assert_eq 1 "$status" "compares the linux/amd64 image, not an unknown/unknown attestation that shares a digest with nothing"

# --- A version with build metadata: the tags as the builds push them. ---
reset_registry
put_release app 14.0.101-rc.1 "$(digest 1)" "$(digest 2)"
status=0
output="$(run_check --images "app" --version "14.0.101+rc.1")" || status=$?
assert_eq 0 "$status" "reads the sanitized tags a version with a '+' is pushed under"

# --- Nothing to check, or no version: refuses. ---
reset_registry
status=0
output="$(run_check --images " " --version 14.0.101)" || status=$?
assert_eq 1 "$status" "refuses to pass with no image to check"
assert_contains "$output" "--images names no image" "says why"
assert_eq "" "$(cat "${FAKE_REGISTRY}/reads")" "and reads nothing"

status=0
output="$(run_check --images "app")" || status=$?
assert_eq 2 "$status" "refuses to run without a version"
assert_contains "$output" "Missing --version" "says why"

status=0
output="$(run_check --images)" || status=$?
assert_eq 2 "$status" "refuses a flag with no value"

status=0
output="$(run_check --image app --version 14.0.101)" || status=$?
assert_eq 2 "$status" "refuses an unknown flag"

echo
echo "check_tested_digests.sh: ${PASS} passed, ${FAIL} failed"
(( FAIL == 0 ))
