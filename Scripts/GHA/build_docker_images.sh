#!/usr/bin/env bash

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: build_docker_images.sh --image <name> --version <version> --dockerfile <path> [options]

Runs a SINGLE docker buildx build per call and pushes the resulting image
digest under both the community and enterprise tag sets. IS_ENTERPRISE_EDITION
is read at runtime (process.env / window.process.env, set by docker-compose
and the Helm chart), so the two variants would produce byte-identical images
— we just tag the same digest twice and skip the duplicate build.

Required flags:
	--image <name>        Image name without registry prefix (example: mcp)
	--version <version>   Version/tag string appended to the generated tags
	--dockerfile <path>   Path to the Dockerfile relative to the repo root

Optional flags:
	--context <path>      Build context directory (default: .)
	--platforms <list>    Comma-separated platforms passed to docker buildx (default: linux/amd64,linux/arm64)
	                      When a single platform is given, tags are suffixed with the arch
	                      (e.g. -amd64 or -arm64) so parallel builds don't overwrite each other.
	--git-sha <sha>       Commit SHA used for the GIT_SHA build arg (default: detected via git)
	--extra-tags <tag>    Additional tag (no version) for the community image (can be repeated)
	--extra-enterprise-tags <tag>  Additional tag (no version) for the enterprise image (can be repeated)
EOF
}

IMAGE=""
VERSION=""
DOCKERFILE=""
CONTEXT="."
PLATFORMS="linux/amd64,linux/arm64"
GIT_SHA=""
EXTRA_TAGS=()
EXTRA_ENTERPRISE_TAGS=()

while [[ $# -gt 0 ]]; do
	case "$1" in
		--image)
			IMAGE="$2"
			shift 2
			;;
		--version)
			VERSION="$2"
			shift 2
			;;
		--dockerfile)
			DOCKERFILE="$2"
			shift 2
			;;
		--context)
			CONTEXT="$2"
			shift 2
			;;
		--platforms)
			PLATFORMS="$2"
			shift 2
			;;
		--git-sha)
			GIT_SHA="$2"
			shift 2
			;;
		--extra-tags)
			EXTRA_TAGS+=("$2")
			shift 2
			;;
		--extra-enterprise-tags)
			EXTRA_ENTERPRISE_TAGS+=("$2")
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

if [[ -z "$IMAGE" || -z "$VERSION" || -z "$DOCKERFILE" ]]; then
	echo "Missing required arguments" >&2
	usage
	exit 1
fi

if [[ -z "$GIT_SHA" ]]; then
	if ! GIT_SHA=$(git rev-parse HEAD 2>/dev/null); then
		echo "Failed to detect git SHA. Provide --git-sha." >&2
		exit 1
	fi
fi

# Determine if this is a single-platform build.
# When building for a single platform, append the arch suffix to tags
# so that parallel per-arch jobs don't overwrite each other.
ARCH_SUFFIX=""
if [[ "$PLATFORMS" != *","* ]]; then
	# Single platform — extract arch (e.g. linux/amd64 -> amd64)
	ARCH_SUFFIX="-${PLATFORMS#*/}"
fi

SANITIZED_VERSION="${VERSION//+/-}"

# Both variants share the same cache scope so a rebuild on the enterprise tag
# path is a pure cache hit (and historically they had separate scopes that
# never shared work despite producing identical layers).
CACHE_REF="ghcr.io/oneuptime/${IMAGE}:cache-${IMAGE}"

push_tag() {
	local tag_suffix="$1"
	TAG_ARGS+=(--tag "oneuptime/${IMAGE}:${tag_suffix}${ARCH_SUFFIX}")
	TAG_ARGS+=(--tag "ghcr.io/oneuptime/${IMAGE}:${tag_suffix}${ARCH_SUFFIX}")
}

TAG_ARGS=()
# Community tags
push_tag "${SANITIZED_VERSION}"
for tag_suffix in "${EXTRA_TAGS[@]+"${EXTRA_TAGS[@]}"}"; do
	push_tag "${tag_suffix}"
done
# Enterprise tags (same digest, different name — runtime env decides behavior)
push_tag "enterprise-${SANITIZED_VERSION}"
for tag_suffix in "${EXTRA_ENTERPRISE_TAGS[@]+"${EXTRA_ENTERPRISE_TAGS[@]}"}"; do
	push_tag "${tag_suffix}"
done

echo "🚀 Building ${IMAGE} (${VERSION}) [${PLATFORMS}] — single build, tagged as both community and enterprise"
docker buildx build \
	--file "$DOCKERFILE" \
	--platform "$PLATFORMS" \
	--push \
	--cache-from "type=registry,ref=${CACHE_REF}" \
	--cache-to "type=registry,ref=${CACHE_REF},mode=max" \
	"${TAG_ARGS[@]}" \
	--build-arg "GIT_SHA=${GIT_SHA}" \
	--build-arg "APP_VERSION=${VERSION}" \
	--build-arg "IS_ENTERPRISE_EDITION=false" \
	"$CONTEXT"

echo "✅ Pushed ${IMAGE}:${SANITIZED_VERSION}${ARCH_SUFFIX} and ${IMAGE}:enterprise-${SANITIZED_VERSION}${ARCH_SUFFIX} (same digest)"
