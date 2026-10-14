#!/usr/bin/env bash

# Runs BuildKit's build checks over a Dockerfile -- `docker buildx build
# --check`, which parses it, resolves the stage graph and checks it without
# building anything -- and keeps going when public.ecr.aws will not serve its
# base images.
#
# --check still loads the metadata of every image a FROM names, and every Node
# and Go base image in this repo comes from public.ecr.aws, whose anonymous
# pullers share one data quota that a busy CI window exhausts:
#
#   #3 ERROR: failed to copy: httpReadSeeker: failed open: unexpected status
#   code https://public.ecr.aws/v2/docker/library/node/manifests/sha256:86f0…:
#   429 Too Many Requests - Server message: toomanyrequests: Data limit exceeded
#
# That turned Ops Config Test red on master twice on 2026-10-14 (runs
# 38508021632 and 38526538639), on a Dockerfile nobody had changed. A re-run
# passes only when it lands on a runner whose address still has quota, and
# warm_base_images.sh cannot help: .oss-scanner/Dockerfile pins its bases by
# digest, and a digest reference cannot be tagged into the local image store
# under ECR's name.
#
# So the check runs against ECR first, as the Dockerfile says. When ECR refuses
# with that 429 -- and only then -- it runs again with every
# public.ecr.aws/docker/library/* base replaced by its Docker Hub original,
# `--build-context <ref>=docker-image://<hub ref>`, as build_docker_images.sh
# does for the release builds. public.ecr.aws/docker/library/* mirrors
# docker.io/library/*: the same images under the same digests, so the second
# run checks the Dockerfile against the very images the first one would have.
# The jobs that run this pull Docker Hub through .github/actions/
# docker-hub-mirror, so the second run does not lean on Docker Hub's own
# anonymous limit either.
#
# Any other failure, a Dockerfile BuildKit rejects among them, fails as it did:
# the check is never run a second time to get past one.
#
# Usage:
#   buildx_check.sh <dockerfile> [<docker buildx build option>...]
#
# e.g. buildx_check.sh .oss-scanner/Dockerfile
#      buildx_check.sh Dockerfile.production --target enterprise
#
# The build context is an empty directory: --check reads only the Dockerfile,
# and this keeps it from uploading the repository.
#
# The docker client to drive is overridable (BUILDX_CHECK_DOCKER) so
# Scripts/GHA/Tests/buildx_check_test.sh can exercise the fallback with a stub,
# without a daemon or a network.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=Scripts/GHA/base_images.sh
source "${SCRIPT_DIR}/base_images.sh"

DOCKER="${BUILDX_CHECK_DOCKER:-docker}"

# The quota refusal, on one line of BuildKit's output: public.ecr.aws named
# with a 429 or with ECR's "toomanyrequests" code.
ECR_QUOTA_REFUSAL='public\.ecr\.aws.*(429 Too Many Requests|toomanyrequests)'

WORK_DIR=""

cleanup() {
	[[ -n "$WORK_DIR" ]] && rm -rf "$WORK_DIR"
}

usage() {
	cat <<'EOF' >&2
Usage: buildx_check.sh <dockerfile> [<docker buildx build option>...]

Runs `docker buildx build --check` over <dockerfile> with an empty context. If
public.ecr.aws refuses its base images with its anonymous-quota 429, runs it
again with each public.ecr.aws/docker/library/* base taken from Docker Hub.
EOF
}

main() {
	if [[ $# -eq 0 || "$1" == "-h" || "$1" == "--help" ]]; then
		usage
		[[ $# -eq 0 ]] && return 1
		return 0
	fi

	local dockerfile="$1"
	shift

	if [[ ! -f "$dockerfile" ]]; then
		echo "❌ No such Dockerfile: ${dockerfile}" >&2
		return 1
	fi

	WORK_DIR="$(mktemp -d)"
	trap cleanup EXIT

	local context="${WORK_DIR}/context"
	local output="${WORK_DIR}/check.log"
	mkdir -p "$context"

	local status=0
	"$DOCKER" buildx build --check -f "$dockerfile" "$@" "$context" 2>&1 | tee "$output"
	status=${PIPESTATUS[0]}

	if (( status == 0 )); then
		return 0
	fi

	if ! grep -qE "$ECR_QUOTA_REFUSAL" "$output"; then
		return "$status"
	fi

	local -a substitutions=()
	local image hub_image
	while read -r image; do
		[[ -n "$image" ]] || continue
		if hub_image="$(hub_mirror_for "$image")"; then
			substitutions+=(--build-context "${image}=docker-image://${hub_image}")
		fi
	done < <(collect_ecr_base_images "$dockerfile")

	if (( ${#substitutions[@]} == 0 )); then
		echo "❌ public.ecr.aws is over its anonymous quota, and ${dockerfile} names no public.ecr.aws/docker/library image to take from Docker Hub instead." >&2
		return "$status"
	fi

	echo "::warning title=public.ecr.aws over its anonymous quota::Checking ${dockerfile} again with its public.ecr.aws/docker/library base images taken from Docker Hub, the same images under the same digests."

	"$DOCKER" buildx build --check -f "$dockerfile" "${substitutions[@]}" "$@" "$context"
}

main "$@"
