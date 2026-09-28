#!/usr/bin/env bash

# Seeds a Dockerfile's public.ecr.aws base images into the local image store
# before `docker build` runs, falling back to Docker Hub when ECR will not
# serve them.
#
# Every Node base image in this repo is pulled from public.ecr.aws, which is
# Amazon's mirror of Docker's official images. Anonymous pullers share one
# bandwidth quota there, and a busy CI window exhausts it. When that happens the
# build dies before it has read a single instruction of the Dockerfile:
#
#   #4 [internal] load metadata for public.ecr.aws/docker/library/node:26-bookworm-slim
#   #4 ERROR: failed to copy: httpReadSeeker: failed open: unexpected status code
#   https://public.ecr.aws/v2/docker/library/node/manifests/sha256:6629…: 429 Too
#   Many Requests - Server message: toomanyrequests: Data limit exceeded
#
# That is what reddened Build on master in runs 36338348855 and 36315910324. The
# step already retries three times, but a *data* quota does not clear in the
# thirty seconds those attempts span, so all three burn and the job goes red on
# an image nobody changed.
#
# The way out is that BuildKit resolves `FROM` from the local image store when
# the reference is already there, without asking any registry for the manifest.
# So: pull each ECR base image up front; if ECR is over its quota, pull the same
# image from Docker Hub (public.ecr.aws/docker/library/* is a mirror of
# docker.io/library/*, so it is the identical image) and tag it under the ECR
# name the Dockerfile asks for. The build then finds it locally and the quota
# never enters into it.
#
# This is deliberately only used by the Build workflow, whose jobs run a plain
# single-platform `docker build`. The release workflows build multi-platform
# images with buildx, where a single-architecture image in the local store is
# not a valid substitute.
#
# Usage:
#   warm_base_images.sh <dockerfile> [<dockerfile>...] [--image <reference>]...
#
# A Dockerfile contributes every public.ecr.aws image its FROM lines name.
# --image names one outright, for a caller whose Dockerfile does not exist on
# disk to be read: Tests/Ops writes its Dockerfiles at run time inside the test,
# and those builds hit the same quota as any other.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=Scripts/GHA/retry.sh
source "${SCRIPT_DIR}/retry.sh"
# shellcheck source=Scripts/GHA/base_images.sh
source "${SCRIPT_DIR}/base_images.sh"

# The docker client to drive. Overridable so Scripts/GHA/Tests can substitute a
# stub and exercise the fallback without a daemon or a network.
DOCKER="${WARM_BASE_IMAGES_DOCKER:-docker}"

# ECR gets a short ladder rather than retry.sh's default minutes. A data quota
# is not going to free up while we wait, and we have a mirror standing by, so
# there is no reason to spend three minutes proving it per image. The mirror
# pull keeps the default ladder: a 429 from Docker Hub *is* a per-window rate
# limit that clears, and by then it is the last thing we can try.
ECR_RETRY_DELAYS="${WARM_BASE_IMAGES_ECR_DELAYS-5 20}"


# Makes one base image resolvable locally under the name the Dockerfile uses.
warm_image() {
	local image="$1"

	if "$DOCKER" image inspect "$image" > /dev/null 2>&1; then
		echo "✅ ${image} is already in the local image store"
		return 0
	fi

	# Saved and restored around the call rather than written as an assignment
	# prefix: whether `VAR=x some_function` leaves VAR set afterwards is
	# version-dependent in bash, and that must not be what decides the ladder
	# the mirror pull below gets.
	local previous_delays="$RETRY_REGISTRY_READ_DELAYS"
	local ecr_status=0

	RETRY_REGISTRY_READ_DELAYS="$ECR_RETRY_DELAYS"
	retry_registry_read "pull ${image}" "$DOCKER" pull "$image" || ecr_status=$?
	RETRY_REGISTRY_READ_DELAYS="$previous_delays"

	if (( ecr_status == 0 )); then
		echo "✅ Pulled ${image} from public.ecr.aws"
		return 0
	fi

	local mirror
	if ! mirror="$(hub_mirror_for "$image")"; then
		echo "❌ ${image} could not be pulled and is not a docker/library image, so there is no Docker Hub mirror to fall back to." >&2
		return 1
	fi

	echo "⚠️  public.ecr.aws would not serve ${image} — falling back to its Docker Hub original ${mirror}." >&2

	if ! retry_registry_read "pull ${mirror}" "$DOCKER" pull "$mirror"; then
		echo "❌ Neither public.ecr.aws nor Docker Hub would serve ${image}." >&2
		return 1
	fi

	# Tag it under the name the Dockerfile asks for. BuildKit resolves `FROM`
	# from the local store, so the build never asks ECR about it.
	if ! "$DOCKER" tag "$mirror" "$image"; then
		echo "❌ Could not tag ${mirror} as ${image}." >&2
		return 1
	fi

	echo "✅ Tagged Docker Hub's ${mirror} as ${image} for the build to pick up locally"
}

usage() {
	cat <<'EOF' >&2
Usage: warm_base_images.sh [<dockerfile>...] [--image <reference>]...

Seeds the public.ecr.aws base images into the local image store, from Docker Hub
when ECR is over its anonymous data quota.

	<dockerfile>          Warm every public.ecr.aws image its FROM lines name.
	--image <reference>   Warm this image. Repeatable. For a build whose
	                      Dockerfile is not on disk to be read.
EOF
}

main() {
	local -a images=()
	local -a dockerfiles=()
	local image dockerfile

	while [[ $# -gt 0 ]]; do
		case "$1" in
		--image)
			if [[ -z "${2:-}" ]]; then
				echo "❌ --image needs an image reference." >&2
				return 1
			fi
			images+=("$2")
			shift 2
			;;
		-h | --help)
			usage
			return 0
			;;
		--*)
			echo "❌ Unknown option: $1" >&2
			usage
			return 1
			;;
		*)
			dockerfiles+=("$1")
			shift
			;;
		esac
	done

	if (( ${#dockerfiles[@]} == 0 && ${#images[@]} == 0 )); then
		usage
		return 1
	fi

	# Checked here rather than inside collect_ecr_base_images: that runs in a
	# process substitution, whose exit status the `while read` loop below cannot
	# see, so a bad path would otherwise warm nothing and still report success.
	for dockerfile in "${dockerfiles[@]+"${dockerfiles[@]}"}"; do
		if [[ ! -f "$dockerfile" ]]; then
			echo "❌ No such Dockerfile: ${dockerfile}" >&2
			return 1
		fi
	done

	if (( ${#dockerfiles[@]} > 0 )); then
		while read -r image; do
			[[ -n "$image" ]] && images+=("$image")
		done < <(collect_ecr_base_images "${dockerfiles[@]}")
	fi

	# Deduped: --image may name one a Dockerfile already contributed.
	if (( ${#images[@]} > 0 )); then
		local -a unique=()
		while read -r image; do
			[[ -n "$image" ]] && unique+=("$image")
		done < <(printf '%s\n' "${images[@]}" | sort -u)
		images=("${unique[@]}")
	fi

	if (( ${#images[@]} == 0 )); then
		echo "No public.ecr.aws base images in: ${dockerfiles[*]}"
		return 0
	fi

	local failed=0
	for image in "${images[@]}"; do
		warm_image "$image" || failed=1
	done

	return "$failed"
}

main "$@"
