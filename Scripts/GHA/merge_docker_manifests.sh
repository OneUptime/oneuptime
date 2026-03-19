#!/usr/bin/env bash

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: merge_docker_manifests.sh --image <name> --tags <tag1,tag2,...>

Combines per-architecture images (tagged with -amd64 / -arm64 suffixes) into
multi-arch manifests and pushes them to Docker Hub and GHCR.

Required flags:
	--image <name>       Image name without registry prefix (example: nginx)
	--tags <list>        Comma-separated list of final manifest tags to create
	                     (e.g. "10.0.31,release,enterprise-10.0.31,enterprise-release")
EOF
}

IMAGE=""
TAGS=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--image)
			IMAGE="$2"
			shift 2
			;;
		--tags)
			TAGS="$2"
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

if [[ -z "$IMAGE" || -z "$TAGS" ]]; then
	echo "Missing required arguments" >&2
	usage
	exit 1
fi

GHCR="ghcr.io/oneuptime"
DOCKER_HUB="oneuptime"

IFS=',' read -ra TAG_LIST <<< "$TAGS"

for tag in "${TAG_LIST[@]}"; do
	tag="$(echo "$tag" | xargs)"  # trim whitespace
	[[ -z "$tag" ]] && continue

	echo "🔗 Creating multi-arch manifest for ${IMAGE}:${tag}"

	# Use GHCR as the source for arch-specific images (no rate limits in GHA)
	# and push the merged manifest to both registries
	docker buildx imagetools create \
		--tag "${GHCR}/${IMAGE}:${tag}" \
		--tag "${DOCKER_HUB}/${IMAGE}:${tag}" \
		"${GHCR}/${IMAGE}:${tag}-amd64" \
		"${GHCR}/${IMAGE}:${tag}-arm64"

	echo "✅ Pushed multi-arch manifest for ${IMAGE}:${tag}"
done
