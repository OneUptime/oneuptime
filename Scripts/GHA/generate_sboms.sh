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

Only community tags are scanned. The enterprise images are built from the same
Dockerfile in the same job and differ solely in ENV/LABEL metadata
(IS_ENTERPRISE_EDITION) — no RUN step reads that build arg, so the installed
package set is byte-identical and a second scan would emit a duplicate.

Required flags:
	--version <version>   Version to scan (matches the pushed tag, e.g. 11.5)

Optional flags:
	--output-dir <path>   Directory for generated SBOMs (default: ./sbom)
	--platform <platform> Platform to scan from the multi-arch index (default: linux/amd64)
	--registry <host>     Registry to read from (default: ghcr.io/oneuptime)
EOF
}

VERSION=""
OUTPUT_DIR="./sbom"
PLATFORM="linux/amd64"
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
		--platform)
			PLATFORM="$2"
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
	WORKFLOW_IMAGES="$(grep -oE -- '--image [a-z0-9-]+' "$RELEASE_WORKFLOW" | awk '{print $2}' | sort -u)"
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
PLATFORM_SLUG="${PLATFORM//\//-}"

# syft ignores --platform for remote (registry:) sources — anchore/syft#1803,
# still open. It falls back to the linux/amd64 manifest, which is why that is
# our default: the bug is a no-op for us. Any other platform would silently
# produce an amd64 SBOM under a filename claiming otherwise, so refuse rather
# than publish a mislabelled artifact. The per-image check below re-verifies
# against the SBOM's own metadata regardless.
if [[ "$PLATFORM" != "linux/amd64" ]]; then
	echo "❌ --platform ${PLATFORM} requested, but syft ignores --platform for registry sources (anchore/syft#1803)." >&2
	echo "   It would emit a linux/amd64 SBOM named '${PLATFORM_SLUG}'. Refusing to publish a mislabelled SBOM." >&2
	exit 1
fi

mkdir -p "$OUTPUT_DIR"

FAILED=()

for image in "${IMAGES[@]}"; do
	ref="${REGISTRY}/${image}:${SANITIZED_VERSION}"
	out="${OUTPUT_DIR}/${image}-${SANITIZED_VERSION}-${PLATFORM_SLUG}.cdx.json"

	echo "📦 Scanning ${ref} (${PLATFORM})"

	# `registry:` forces syft to read the manifest over the registry API rather
	# than looking for a local daemon image. --platform is required because the
	# tag resolves to a multi-arch index; without it syft picks the runner's
	# arch, which would silently vary with the runner image.
	if ! syft "registry:${ref}" \
		--platform "$PLATFORM" \
		--output "cyclonedx-json=${out}"; then
		echo "❌ Failed to generate SBOM for ${ref}" >&2
		FAILED+=("$image")
		continue
	fi

	# A syft run that resolves an empty or wrong-media-type manifest can still
	# exit 0 while producing an SBOM with no components. That would attach a
	# useless file to the release, so treat it as a failure. Read the recorded
	# architecture back out at the same time so a silently-wrong platform
	# (anchore/syft#1803) cannot ship under a filename that claims otherwise.
	if ! sbom_stats="$(python3 - "$out" <<'PY'
import json, sys

doc = json.load(open(sys.argv[1]))
count = len(doc.get("components", []))
component = (doc.get("metadata", {}) or {}).get("component", {}) or {}
props = component.get("properties", []) or []
arch = next(
    (p.get("value") for p in props if p.get("name", "").endswith(":architecture")),
    "unknown",
)
print(count, arch)
PY
	)"; then
		echo "❌ Could not parse SBOM for ${ref}" >&2
		FAILED+=("$image")
		continue
	fi

	component_count="${sbom_stats%% *}"
	sbom_arch="${sbom_stats##* }"

	if [[ "$component_count" -eq 0 ]]; then
		echo "❌ SBOM for ${ref} contains zero components" >&2
		FAILED+=("$image")
		continue
	fi

	# "unknown" means syft did not record an architecture property — not proof of
	# a mismatch, so only a real disagreement is fatal.
	if [[ "$sbom_arch" != "unknown" && "$sbom_arch" != "${PLATFORM#*/}" ]]; then
		echo "❌ SBOM for ${ref} reports architecture '${sbom_arch}', expected '${PLATFORM#*/}'" >&2
		FAILED+=("$image")
		continue
	fi

	echo "✅ ${out} (${component_count} components, arch=${sbom_arch})"
done

if [[ ${#FAILED[@]} -gt 0 ]]; then
	echo "" >&2
	echo "❌ SBOM generation failed for: ${FAILED[*]}" >&2
	exit 1
fi

echo ""
echo "✅ Generated ${#IMAGES[@]} CycloneDX SBOMs in ${OUTPUT_DIR}"
ls -la "$OUTPUT_DIR"
