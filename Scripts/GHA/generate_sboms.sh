#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=Scripts/GHA/retry.sh
source "${SCRIPT_DIR}/retry.sh"

usage() {
	cat <<'EOF'
Usage: generate_sboms.sh --version <version> [options]

Generates a CycloneDX SBOM for each published OneUptime image by reading the
already-pushed manifest straight out of GHCR — no docker pull, no daemon.

This complements (does not replace) the SPDX attestations that
build_docker_images.sh attaches at build time. The attestation answers "what is
in this image?" for anyone holding the image reference; these files are the
artifact we attach to the GitHub release, so an enterprise buyer or a
Dependency-Track instance can ingest them without touching a registry.

Every image is scanned once per published architecture. The package sets really
do differ between them — Chrome build skew in probe, disjoint Debian packages,
and arch-specific npm binaries (@esbuild/linux-x64 vs @esbuild/linux-arm64) in
every Node image — so an amd64-only SBOM ingested by an arm64 operator produces
both false negatives and false positives.

Only community tags are scanned. The enterprise images are built from the same
Dockerfile in the same job and differ solely in ENV/LABEL metadata
(IS_ENTERPRISE_EDITION) — no RUN step reads that build arg. Verified against the
registry: for all 12 images on both architectures, :release and
:enterprise-release resolve to identical platform-manifest digests and identical
rootfs.diff_ids, so a second scan would emit a byte-equivalent duplicate.

Required flags:
	--version <version>   Version to scan (matches the pushed tag, e.g. 11.5)

Optional flags:
	--output-dir <path>   Directory for generated SBOMs (default: ./sbom)
	--platforms <list>    Comma-separated platforms to scan
	                      (default: linux/amd64,linux/arm64)
	--registry <host>     Registry to read from (default: ghcr.io/oneuptime)
EOF
}

VERSION=""
OUTPUT_DIR="./sbom"
PLATFORMS="linux/amd64,linux/arm64"
REGISTRY="ghcr.io/oneuptime"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--version)
			VERSION="$2"
			shift 2
			;;
		--output-dir)
			OUTPUT_DIR="$2"
			shift 2
			;;
		--platforms)
			PLATFORMS="$2"
			shift 2
			;;
		--registry)
			REGISTRY="$2"
			shift 2
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage
			exit 1
			;;
	esac
done

if [[ -z "$VERSION" ]]; then
	echo "Missing required argument: --version" >&2
	usage
	exit 1
fi

# Keep in sync with the *-docker-image-build jobs in release.yml. The drift
# check below fails the build if they diverge, so adding a 13th image without
# adding it here is caught in CI rather than silently shipping an SBOM set that
# is missing an image.
IMAGES=(
	runner
	app
	docker-agent
	e2e
	home
	kubernetes-cost-agent
	kubernetes-log-tailer
	nginx
	podman-agent
	probe
	test
	test-server
)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_WORKFLOW="${REPO_ROOT}/.github/workflows/release.yml"

if [[ -f "$RELEASE_WORKFLOW" ]]; then
	# `|| true` because a zero-match grep exits 1, and under `set -o pipefail`
	# that would abort the script here — before the diagnostic block below ever
	# runs, leaving a red step with no output at all. The empty check that
	# follows is load-bearing: `|| true` alone would let an empty result reach
	# comm, which emits a spurious blank entry instead of a clear error.
	WORKFLOW_IMAGES="$(grep -oE -- '--image [a-z0-9-]+' "$RELEASE_WORKFLOW" | awk '{print $2}' | sort -u || true)"
	if [[ -z "$WORKFLOW_IMAGES" ]]; then
		echo "❌ Found no '--image <name>' arguments in ${RELEASE_WORKFLOW}; the drift check cannot run." >&2
		echo "   The build jobs were probably refactored (e.g. to a matrix). Update this check." >&2
		exit 1
	fi
	SCRIPT_IMAGES="$(printf '%s\n' "${IMAGES[@]}" | sort -u)"
	if [[ "$WORKFLOW_IMAGES" != "$SCRIPT_IMAGES" ]]; then
		echo "❌ Image list drift between release.yml and generate_sboms.sh" >&2
		echo "--- only in release.yml ---" >&2
		comm -23 <(printf '%s\n' "$WORKFLOW_IMAGES") <(printf '%s\n' "$SCRIPT_IMAGES") >&2
		echo "--- only in generate_sboms.sh ---" >&2
		comm -13 <(printf '%s\n' "$WORKFLOW_IMAGES") <(printf '%s\n' "$SCRIPT_IMAGES") >&2
		exit 1
	fi
	echo "✅ Image list matches release.yml (${#IMAGES[@]} images)"
else
	echo "⚠️  ${RELEASE_WORKFLOW} not found — skipping image list drift check"
fi

if ! command -v syft >/dev/null 2>&1; then
	echo "syft not found on PATH. Install it first (anchore/sbom-action/download-syft in CI)." >&2
	exit 1
fi

SANITIZED_VERSION="${VERSION//+/-}"

IFS=',' read -ra PLATFORM_LIST <<< "$PLATFORMS"

mkdir -p "$OUTPUT_DIR"

FAILED=()

# One syft scan, in the shape retry_registry_read needs: a command it can just
# run again.
#
# The `rm -f` is what makes re-running safe. A syft run that dies partway
# through a read can leave a truncated file behind, and release.yml attaches
# `sbom/*.cdx.json` by glob — so every attempt starts from no file at all, and
# the component check below can only ever be reading output this attempt wrote.
#
# `registry:` forces syft to read the manifest over the registry API rather than
# looking for a local daemon image. --platform is required because the tag
# resolves to a multi-arch index; without it syft picks the runner's arch, which
# would silently vary with the runner image. syft resolves the platform
# correctly for an index and hard-errors on a mismatch (anchore/stereoscope#336),
# so a wrong platform fails here rather than producing a mislabelled file.
scan_image() {
	local ref="$1"
	local platform="$2"
	local out="$3"

	rm -f "$out"

	syft "registry:${ref}" \
		--platform "$platform" \
		--output "cyclonedx-json=${out}"
}

# Fallback for an image the registry reader cannot get through.
#
# syft streams blobs with go-containerregistry, which restarts the whole read
# when the registry shapes it. That is survivable for a small image and not for
# a large one: release 12.0.27 burned all four attempts on the same blob of
# home, which is a single 7.4GB layer in a 7.86GB image, while the smaller
# images scanned either side of it succeeded — so this is throughput shaping on
# one enormous blob, not an account-wide limit. syft has no knob for it; `syft
# config` exposes registry auth and TLS and nothing about retries or timeouts.
#
# `docker pull` uses a different puller, one that retries and resumes each layer
# rather than restarting the read from zero, which is what a throttled
# multi-gigabyte download needs. So once the registry path is exhausted, pull the
# image and scan it out of the local daemon instead.
#
# The image is removed immediately afterwards. home is ~8GB and this loop makes
# 24 scans, so anything left behind would fill the runner.
scan_image_via_docker() {
	local ref="$1"
	local platform="$2"
	local out="$3"

	rm -f "$out"

	docker pull --platform "$platform" "$ref" || return 1

	# A `docker:` source cannot be told which platform to read, so the pull is
	# the only thing that selected it. Check what actually landed rather than
	# trusting it: a mislabelled SBOM is worse than a missing one, which is why
	# the registry path passes --platform in the first place. Anything other
	# than a plain os/arch platform fails here rather than being assumed.
	local got
	got="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$ref")"
	if [[ "$got" != "$platform" ]]; then
		echo "docker pull of ${ref} returned ${got}, expected ${platform}" >&2
		docker image rm "$ref" >/dev/null 2>&1 || true
		return 1
	fi

	local status=0
	syft "docker:${ref}" --output "cyclonedx-json=${out}" || status=$?

	docker image rm "$ref" >/dev/null 2>&1 || true

	return "$status"
}

for image in "${IMAGES[@]}"; do
	ref="${REGISTRY}/${image}:${SANITIZED_VERSION}"

	for platform in "${PLATFORM_LIST[@]}"; do
		platform="$(echo "$platform" | xargs)"  # trim whitespace
		[[ -z "$platform" ]] && continue

		platform_slug="${platform//\//-}"
		out="${OUTPUT_DIR}/${image}-${SANITIZED_VERSION}-${platform_slug}.cdx.json"

		echo "📦 Scanning ${ref} (${platform})"

		# Retried rather than run once: this loop makes 24 back-to-back reads
		# of every layer of every image, which is enough to trip GHCR's rate
		# limiter. See Scripts/GHA/retry.sh — the retry is conditional, so a
		# tag that genuinely is not there still fails on the first attempt.
		scanned=false

		if retry_registry_read "SBOM scan of ${ref} (${platform})" \
			scan_image "$ref" "$platform" "$out"; then
			scanned=true
		elif command -v docker >/dev/null 2>&1; then
			# Last chance before this failure strands the release. A tag that
			# genuinely is not there fails again here, quickly, and logs a
			# second clear error rather than a misleading one.
			echo "↪ Registry read did not get through; retrying ${ref} (${platform}) via docker pull." >&2
			df -h / | tail -1 | awk '{print "   runner disk: " $4 " free of " $2}' >&2

			if retry_registry_read "docker-pull SBOM scan of ${ref} (${platform})" \
				scan_image_via_docker "$ref" "$platform" "$out"; then
				scanned=true
			fi
		else
			echo "↪ docker is not on PATH, so the pull fallback is unavailable." >&2
		fi

		if [[ "$scanned" != "true" ]]; then
			echo "❌ Failed to generate SBOM for ${ref} (${platform})" >&2
			rm -f "$out"
			FAILED+=("${image}/${platform}")
			continue
		fi

		# A syft run that resolves an empty or wrong-media-type manifest can
		# still exit 0 while producing an SBOM with no components. That would
		# attach a useless file to the release, so treat it as a failure.
		if ! component_count="$(python3 - "$out" <<'PY'
import json, sys

doc = json.load(open(sys.argv[1]))
print(len(doc.get("components", [])))
PY
		)"; then
			echo "❌ Could not parse SBOM for ${ref} (${platform})" >&2
			rm -f "$out"
			FAILED+=("${image}/${platform}")
			continue
		fi

		if [[ "$component_count" -eq 0 ]]; then
			echo "❌ SBOM for ${ref} (${platform}) contains zero components" >&2
			rm -f "$out"
			FAILED+=("${image}/${platform}")
			continue
		fi

		echo "✅ ${out} (${component_count} components)"
	done
done

if [[ ${#FAILED[@]} -gt 0 ]]; then
	echo "" >&2
	echo "❌ SBOM generation failed for: ${FAILED[*]}" >&2
	exit 1
fi

echo ""
echo "✅ Generated $(( ${#IMAGES[@]} * ${#PLATFORM_LIST[@]} )) CycloneDX SBOMs in ${OUTPUT_DIR} (${#IMAGES[@]} images × ${#PLATFORM_LIST[@]} platforms)"
ls -la "$OUTPUT_DIR"
