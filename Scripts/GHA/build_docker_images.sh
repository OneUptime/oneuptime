#!/usr/bin/env bash

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: build_docker_images.sh --image <name> --version <version> --dockerfile <path> [options]

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
	--extra-tags <tag>    Additional tags for the community image (can be repeated)
	--extra-enterprise-tags <tag>  Additional tags for the enterprise image (can be repeated)
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

build_variant() {
	local variant_prefix="$1"       # "" or "enterprise-"
	local enterprise_flag="$2"      # false/true
	local -n extra_tags_ref="$3"    # Array reference with extra tag suffixes
	local sanitized_version
	sanitized_version="${VERSION//+/-}"

	local cache_scope="${IMAGE}-${variant_prefix:-community}"

	local -a args
	args=(
		docker buildx build
		--file "$DOCKERFILE"
		--platform "$PLATFORMS"
		--push
		--cache-from "type=registry,ref=ghcr.io/oneuptime/${IMAGE}:cache-${cache_scope}"
		--cache-to "type=registry,ref=ghcr.io/oneuptime/${IMAGE}:cache-${cache_scope},mode=max"
	)

	args+=(
		--tag "oneuptime/${IMAGE}:${variant_prefix}${sanitized_version}${ARCH_SUFFIX}"
		--tag "ghcr.io/oneuptime/${IMAGE}:${variant_prefix}${sanitized_version}${ARCH_SUFFIX}"
	)

	for tag_suffix in "${extra_tags_ref[@]}"; do
		args+=(--tag "oneuptime/${IMAGE}:${tag_suffix}${ARCH_SUFFIX}")
		args+=(--tag "ghcr.io/oneuptime/${IMAGE}:${tag_suffix}${ARCH_SUFFIX}")
	done

	args+=(
		--build-arg "GIT_SHA=${GIT_SHA}"
		--build-arg "APP_VERSION=${VERSION}"
		--build-arg "IS_ENTERPRISE_EDITION=${enterprise_flag}"
		"$CONTEXT"
	)

	"${args[@]}"
}

echo "🚀 Building docker images for ${IMAGE} (${VERSION}) [${PLATFORMS}]"
build_variant "" false EXTRA_TAGS
echo "✅ Pushed community image for ${IMAGE}:${VERSION}${ARCH_SUFFIX}"
build_variant "enterprise-" true EXTRA_ENTERPRISE_TAGS
echo "✅ Pushed enterprise image for ${IMAGE}:enterprise-${VERSION}${ARCH_SUFFIX}"
