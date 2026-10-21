#!/usr/bin/env bash

# Which base images a Dockerfile pulls from public.ecr.aws, and where else the
# same image can be had. Source it; it defines functions and runs nothing.
#
# Every Node base image in this repo comes from public.ecr.aws, Amazon's mirror
# of Docker's official images. Anonymous pullers there share one bandwidth
# quota, and a busy CI window exhausts it:
#
#   #4 ERROR: failed to copy: httpReadSeeker: failed open: unexpected status
#   from GET request to https://public.ecr.aws/v2/docker/library/node/manifests/
#   sha256:6629…: 429 Too Many Requests
#   toomanyrequests: Data limit exceeded
#
# That has reddened master repeatedly, in two different shapes, on an image
# nobody touched:
#
#   - the Build workflow's plain `docker build` (runs 36338348855, 36315910324),
#     which Scripts/GHA/warm_base_images.sh fixes by seeding the local image
#     store, since BuildKit resolves `FROM` from there without asking any
#     registry;
#   - the release workflows' `docker buildx build --push` (run 36367719252),
#     where seeding cannot help: the docker-container builder has its own store
#     and does not read the daemon's. Scripts/GHA/build_docker_images.sh fixes
#     that with `--build-context`, which substitutes the image outright.
#
# Both need the same two answers -- which references are affected, and what
# each one's Docker Hub original is -- so they are written once, here. Getting
# the mapping wrong in either place means silently going back to ECR and failing
# the way it did before.
#
# public.ecr.aws/docker/library/* IS docker.io/library/*: ECR mirrors Docker's
# official images, so the substitute is the same image from its origin, not a
# lookalike.

ECR_LIBRARY_PREFIX="public.ecr.aws/docker/library/"
HUB_LIBRARY_PREFIX="docker.io/library/"

# collect_ecr_base_images <dockerfile> [<dockerfile>...]
#
# Prints each distinct public.ecr.aws image named by a FROM instruction, one per
# line. Nothing else: an image from another registry is not what fails here, and
# a bare word is an earlier build stage, which must never be treated as an image.
collect_ecr_base_images() {
	local dockerfile token line
	local -a found=()

	for dockerfile in "$@"; do
		# Field 2 of a FROM line is the image, except that flags such as
		# `--platform=$BUILDPLATFORM` come first, so skip leading flags.
		# Anything after the image (`AS <stage>`) is ignored.
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

	# Deduped: the App Dockerfile names the same base image in several stages.
	if (( ${#found[@]} > 0 )); then
		printf '%s\n' "${found[@]}" | sort -u
	fi
}

# hub_mirror_for <image>
#
# Prints the Docker Hub image that <image> mirrors, or fails for anything
# outside docker/library, which has no mapping here.
hub_mirror_for() {
	local image="$1"

	if [[ "$image" != "${ECR_LIBRARY_PREFIX}"* ]]; then
		return 1
	fi

	echo "${HUB_LIBRARY_PREFIX}${image#"${ECR_LIBRARY_PREFIX}"}"
}
