#!/usr/bin/env bash

set -euo pipefail

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
	ai-agent
	app
	docker-agent
	e2e
	home
	kubernetes-cost-agent
	kubernetes-log-tailer
	nginx
	podman-agent
	probe
	runbook-agent
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

for image in "${IMAGES[@]}"; do
	ref="${REGISTRY}/${image}:${SANITIZED_VERSION}"

	for platform in "${PLATFORM_LIST[@]}"; do
		platform="$(echo "$platform" | xargs)"  # trim whitespace
		[[ -z "$platform" ]] && continue

		platform_slug="${platform//\//-}"
		out="${OUTPUT_DIR}/${image}-${SANITIZED_VERSION}-${platform_slug}.cdx.json"

		echo "📦 Scanning ${ref} (${platform})"

		# `registry:` forces syft to read the manifest over the registry API
		# rather than looking for a local daemon image. --platform is required
		# because the tag resolves to a multi-arch index; without it syft picks
		# the runner's arch, which would silently vary with the runner image.
		# syft resolves the platform correctly for an index and hard-errors on a
		# mismatch (anchore/stereoscope#336), so a wrong platform fails here
		# rather than producing a mislabelled file.
		if ! syft "registry:${ref}" \
			--platform "$platform" \
			--output "cyclonedx-json=${out}"; then
			echo "❌ Failed to generate SBOM for ${ref} (${platform})" >&2
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
			FAILED+=("${image}/${platform}")
			continue
		fi

		if [[ "$component_count" -eq 0 ]]; then
			echo "❌ SBOM for ${ref} (${platform}) contains zero components" >&2
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
