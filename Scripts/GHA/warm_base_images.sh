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
#   warm_base_images.sh <dockerfile> [<dockerfile>...]

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=Scripts/GHA/retry.sh
source "${SCRIPT_DIR}/retry.sh"

# The docker client to drive. Overridable so Scripts/GHA/Tests can substitute a
# stub and exercise the fallback without a daemon or a network.
DOCKER="${WARM_BASE_IMAGES_DOCKER:-docker}"

# The registry whose quota is the problem, and the mirror it copies. Both are
# prefixes of a full image reference.
ECR_LIBRARY_PREFIX="public.ecr.aws/docker/library/"
HUB_LIBRARY_PREFIX="docker.io/library/"

# ECR gets a short ladder rather than retry.sh's default minutes. A data quota
# is not going to free up while we wait, and we have a mirror standing by, so
# there is no reason to spend three minutes proving it per image. The mirror
# pull keeps the default ladder: a 429 from Docker Hub *is* a per-window rate
# limit that clears, and by then it is the last thing we can try.
ECR_RETRY_DELAYS="${WARM_BASE_IMAGES_ECR_DELAYS-5 20}"

if [[ "$#" -eq 0 ]]; then
	echo "Usage: warm_base_images.sh <dockerfile> [<dockerfile>...]" >&2
	exit 1
fi

# Collects the ECR base images referenced by the given Dockerfiles.
#
# Only public.ecr.aws references are returned: everything else either already
# comes from Docker Hub (which is not the registry failing) or is an earlier
# build stage by name, which must not be pulled at all.
collect_ecr_base_images() {
	local dockerfile token
	local -a found=()

	for dockerfile in "$@"; do
		# Field 2 of a FROM line is the image, except that `--platform=...` and
		# friends come first, so skip leading flags. Anything after the image
		# (`AS <stage>`) is ignored.
		while read -r line; do
			local -a fields=()
			read -ra fields <<< "$line" || true
			local index=1
			while (( index < ${#fields[@]} )); do
				token="${fields[index]}"
				if [[ "$token" == --* ]]; then
					index=$(( index + 1 ))
					continue
				fi
				break
			done
			(( index < ${#fields[@]} )) || continue
			token="${fields[index]}"
			[[ "$token" == public.ecr.aws/* ]] || continue
			found+=("$token")
		done < <(grep -iE '^[[:space:]]*FROM[[:space:]]' "$dockerfile" || true)
	done

	# Dedupe: the App Dockerfile names the same base image in several stages, and
	# pulling it once is enough.
	if (( ${#found[@]} > 0 )); then
		printf '%s\n' "${found[@]}" | sort -u
	fi
}

# Maps an ECR library reference to the Docker Hub image it mirrors.
# Fails for anything outside docker/library, which we have no mirror mapping for.
hub_mirror_for() {
	local image="$1"

	if [[ "$image" != "${ECR_LIBRARY_PREFIX}"* ]]; then
		return 1
	fi

	echo "${HUB_LIBRARY_PREFIX}${image#"${ECR_LIBRARY_PREFIX}"}"
}

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

main() {
	local -a images=()
	local image dockerfile

	# Checked here rather than inside collect_ecr_base_images: that runs in a
	# process substitution, whose exit status the `while read` loop below cannot
	# see, so a bad path would otherwise warm nothing and still report success.
	for dockerfile in "$@"; do
		if [[ ! -f "$dockerfile" ]]; then
			echo "❌ No such Dockerfile: ${dockerfile}" >&2
			return 1
		fi
	done

	while read -r image; do
		[[ -n "$image" ]] && images+=("$image")
	done < <(collect_ecr_base_images "$@")

	if (( ${#images[@]} == 0 )); then
		echo "No public.ecr.aws base images in: $*"
		return 0
	fi

	local failed=0
	for image in "${images[@]}"; do
		warm_image "$image" || failed=1
	done

	return "$failed"
}

main "$@"
