#!/usr/bin/env bash

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: build_docker_images.sh --image <name> --version <version> --dockerfile <path> [options]

Builds the image twice — once as community (IS_ENTERPRISE_EDITION=false), once
as enterprise (IS_ENTERPRISE_EDITION=true) — and pushes each under its own tag
set. Both variants share a single GHA cache scope so the enterprise pass is
mostly a cache hit: BuildKit reuses any RUN/COPY layer whose effective inputs
are unchanged, and downstream RUN steps in our Dockerfiles don't read
$IS_ENTERPRISE_EDITION, so only the ENV/LABEL metadata differs between the two
final images.

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

# Single GHA cache scope per (image, arch). Community and enterprise share it
# so the second variant's build is mostly cache hits.
#
# Requires ACTIONS_RUNTIME_TOKEN + ACTIONS_CACHE_URL to be exposed to the
# step running this script. The workflow accomplishes that with
# `crazy-max/ghaction-github-runtime@v3` immediately after
# `docker/setup-buildx-action`.
CACHE_SCOPE="${IMAGE}${ARCH_SUFFIX}"

build_variant() {
	local variant_prefix="$1"       # "" for community, "enterprise-" for enterprise
	local enterprise_flag="$2"      # "false" or "true" — baked into ENV IS_ENTERPRISE_EDITION
	shift 2
	local extras=("$@")             # Remaining args are extra tag suffixes

	local -a tag_args
	tag_args=(
		--tag "oneuptime/${IMAGE}:${variant_prefix}${SANITIZED_VERSION}${ARCH_SUFFIX}"
		--tag "ghcr.io/oneuptime/${IMAGE}:${variant_prefix}${SANITIZED_VERSION}${ARCH_SUFFIX}"
	)
	for tag_suffix in "${extras[@]+"${extras[@]}"}"; do
		tag_args+=(--tag "oneuptime/${IMAGE}:${tag_suffix}${ARCH_SUFFIX}")
		tag_args+=(--tag "ghcr.io/oneuptime/${IMAGE}:${tag_suffix}${ARCH_SUFFIX}")
	done

	docker buildx build \
		--file "$DOCKERFILE" \
		--platform "$PLATFORMS" \
		--push \
		--cache-from "type=gha,scope=${CACHE_SCOPE}" \
		--cache-to "type=gha,mode=max,scope=${CACHE_SCOPE}" \
		"${tag_args[@]}" \
		--build-arg "GIT_SHA=${GIT_SHA}" \
		--build-arg "APP_VERSION=${VERSION}" \
		--build-arg "IS_ENTERPRISE_EDITION=${enterprise_flag}" \
		"$CONTEXT"
}

echo "🚀 Building docker images for ${IMAGE} (${VERSION}) [${PLATFORMS}]"
build_variant "" "false" "${EXTRA_TAGS[@]+"${EXTRA_TAGS[@]}"}"
echo "✅ Pushed community image for ${IMAGE}:${SANITIZED_VERSION}${ARCH_SUFFIX}"
build_variant "enterprise-" "true" "${EXTRA_ENTERPRISE_TAGS[@]+"${EXTRA_ENTERPRISE_TAGS[@]}"}"
echo "✅ Pushed enterprise image for ${IMAGE}:enterprise-${SANITIZED_VERSION}${ARCH_SUFFIX}"
