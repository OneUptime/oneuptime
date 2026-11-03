#!/usr/bin/env bash

# End-to-end tests for Scripts/GHA/sign_docker_images.sh, driven by a fake
# docker and a fake cosign on PATH, so nothing here touches a registry or
# Sigstore.
#
# What matters: every image release.yml builds is signed, both of its tags, in
# both registries, by digest (a tag can move) and recursively (a platform's
# image saved on its own still verifies); one failure never stops the others,
# and the run fails at the end naming every tag left unsigned.
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/sign_docker_images_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIGN_IMAGES="${SCRIPT_DIR}/../sign_docker_images.sh"

export RETRY_WITH_BACKOFF_DELAYS="0 0"

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
		fail "$what — '${needle}' not found"
	fi
}

count_matches() {
	local file="$1" pattern="$2"
	if [[ ! -f "$file" ]]; then
		echo 0
		return
	fi
	grep -c -- "$pattern" "$file" || true
}

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# The fake docker's digest for a reference without its registry: shasum on
# macOS, sha256sum where that is all there is.
sha_of() {
	if command -v shasum >/dev/null 2>&1; then
		printf '%s' "$1" | shasum -a 256 | cut -c1-64
	else
		printf '%s' "$1" | sha256sum | cut -c1-64
	fi
}

# A fake docker that answers `buildx imagetools inspect <ref> --format ...`
# with a manifest whose digest is made from the reference, and a fake cosign
# that logs each signature. FAKE_INSPECT_FAIL and FAKE_COSIGN_FAIL name a
# substring of the references they refuse.
setup_fakes() {
	local bin_dir="${WORK_DIR}/bin"
	mkdir -p "$bin_dir"

	cat > "${bin_dir}/docker" <<'FAKE_EOF'
#!/usr/bin/env bash
if [[ "$1 $2 $3" != "buildx imagetools inspect" ]]; then
	echo "fake docker: unexpected call: $*" >&2
	exit 2
fi
ref="$4"
if [[ -n "${FAKE_INSPECT_FAIL:-}" && "$ref" == *"${FAKE_INSPECT_FAIL}"* ]]; then
	echo "fake docker: MANIFEST_UNKNOWN for ${ref}" >&2
	exit 1
fi
name="$(printf '%s' "$ref" | sed 's/^[^/]*\/[^/]*\///')"
if command -v shasum >/dev/null 2>&1; then
	digest="$(printf '%s' "$name" | shasum -a 256 | cut -c1-64)"
else
	digest="$(printf '%s' "$name" | sha256sum | cut -c1-64)"
fi
printf '{"mediaType":"application/vnd.oci.image.index.v1+json","digest":"sha256:%s","size":1}\n' "$digest"
FAKE_EOF

	cat > "${bin_dir}/cosign" <<'FAKE_EOF'
#!/usr/bin/env bash
echo "$*" >> "${FAKE_COSIGN_LOG}"
for arg in "$@"; do
	if [[ -n "${FAKE_COSIGN_FAIL:-}" && "$arg" == *"${FAKE_COSIGN_FAIL}"* ]]; then
		echo "fake cosign: refused ${arg}" >&2
		exit 1
	fi
done
FAKE_EOF

	chmod +x "${bin_dir}/docker" "${bin_dir}/cosign"
	export PATH="${bin_dir}:${PATH}"
}

setup_fakes

run_sign() {
	export FAKE_COSIGN_LOG="${WORK_DIR}/cosign-$1.log"
	: > "$FAKE_COSIGN_LOG"
	shift
	bash "$SIGN_IMAGES" "$@" > "${WORK_DIR}/out.log" 2>&1
	echo $? > "${WORK_DIR}/status"
}

echo "── every image, both tags, both registries ──"
FAKE_INSPECT_FAIL="" FAKE_COSIGN_FAIL="" run_sign all --version 14.0.102
assert_eq "0" "$(cat "${WORK_DIR}/status")" "signs a whole release and exits 0"
assert_contains "$(cat "${WORK_DIR}/out.log")" "Image list matches release.yml (14 images)" "checks its image list against release.yml"
# 14 images x 2 tags x 2 registries.
assert_eq "56" "$(count_matches "$FAKE_COSIGN_LOG" '^sign ')" "signs 56 tags"
assert_eq "56" "$(count_matches "$FAKE_COSIGN_LOG" '^sign --yes --recursive ')" "signs each without a prompt, recursively"
assert_eq "56" "$(count_matches "$FAKE_COSIGN_LOG" '@sha256:[0-9a-f]\{64\}$')" "signs each by digest, never by tag"
assert_eq "28" "$(count_matches "$FAKE_COSIGN_LOG" ' docker.io/oneuptime/')" "signs every tag on Docker Hub"
assert_eq "28" "$(count_matches "$FAKE_COSIGN_LOG" ' ghcr.io/oneuptime/')" "signs every tag on GHCR"
community_app="$(sha_of 'app:14.0.102')"
assert_eq "1" "$(count_matches "$FAKE_COSIGN_LOG" "^sign --yes --recursive docker.io/oneuptime/app@sha256:${community_app}$")" "signs the digest the community tag names"
enterprise_app="$(sha_of 'app:enterprise-14.0.102')"
assert_eq "1" "$(count_matches "$FAKE_COSIGN_LOG" "^sign --yes --recursive ghcr.io/oneuptime/app@sha256:${enterprise_app}$")" "signs the digest the enterprise tag names"
assert_eq "4" "$(count_matches "$FAKE_COSIGN_LOG" '/home@sha256:')" "signs home, which the SBOMs skip"

echo "── one registry ──"
FAKE_INSPECT_FAIL="" FAKE_COSIGN_FAIL="" run_sign one --version 14.0.102 --registries "ghcr.io/oneuptime"
assert_eq "0" "$(cat "${WORK_DIR}/status")" "signs in the registries it is given"
assert_eq "28" "$(count_matches "$FAKE_COSIGN_LOG" '^sign ')" "and only there"

echo "── a signature that keeps failing ──"
FAKE_INSPECT_FAIL="" FAKE_COSIGN_FAIL="oneuptime/probe@" run_sign cosign-fails --version 14.0.102
assert_eq "1" "$(cat "${WORK_DIR}/status")" "fails the run"
# Three attempts each (two retries) for the probe's four tags; the other 52 once.
assert_eq "64" "$(count_matches "$FAKE_COSIGN_LOG" '^sign ')" "retries it, and still signs every other image"
assert_contains "$(cat "${WORK_DIR}/out.log")" "Not signed (4): docker.io/oneuptime/probe:14.0.102 ghcr.io/oneuptime/probe:14.0.102 docker.io/oneuptime/probe:enterprise-14.0.102 ghcr.io/oneuptime/probe:enterprise-14.0.102" "names every tag left unsigned"

echo "── a tag that cannot be read ──"
FAKE_INSPECT_FAIL="docker.io/oneuptime/runner:enterprise-" FAKE_COSIGN_FAIL="" run_sign inspect-fails --version 14.0.102
assert_eq "1" "$(cat "${WORK_DIR}/status")" "fails the run"
assert_eq "55" "$(count_matches "$FAKE_COSIGN_LOG" '^sign ')" "signs nothing it has no digest for, and everything else"
assert_contains "$(cat "${WORK_DIR}/out.log")" "Not signed (1): docker.io/oneuptime/runner:enterprise-14.0.102" "names it"

echo "── no version ──"
FAKE_INSPECT_FAIL="" FAKE_COSIGN_FAIL="" run_sign no-version
assert_eq "1" "$(cat "${WORK_DIR}/status")" "refuses to run without a version"
assert_eq "0" "$(count_matches "$FAKE_COSIGN_LOG" '^sign ')" "and signs nothing"

echo ""
echo "sign_docker_images: ${PASS} passed, ${FAIL} failed"
(( FAIL == 0 ))
