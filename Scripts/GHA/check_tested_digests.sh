#!/usr/bin/env bash

# Checks that every tag a release moves `release` to is the image its e2e
# jobs ran.
#
#   check_tested_digests.sh --images "<image> <image> ..." --version <version>
#
# Why this exists. The release's e2e jobs (release.yml's test-e2e-release-*)
# boot the -amd64 tags each build's amd64 leg pushes (app:<version>-amd64,
# app:enterprise-<version>-amd64), so they start as soon as the builds are
# done rather than after every merge job has queued for a runner and run -
# as master's e2e jobs do (test-release.yaml). The merge jobs run beside them
# and join each image's -amd64 and -arm64 tags into the multi-arch tags
# (<version>, enterprise-<version>), and push-release-tags moves `release`
# and `enterprise-release` to those. An amd64 pull of a merged tag gets that
# index's linux/amd64 image, which must be the very image the e2e jobs ran -
# the -amd64 tag's - or the release ships an image nothing tested: a merge of
# other tags, or a per-arch tag pushed again after the e2e jobs pulled it (a
# build re-run, a second run of the same version).
#
# So, for each image and each edition, this reads the linux/amd64 entry of
# the merged tag's index and of the -amd64 tag's (docker buildx imagetools
# inspect), and passes only when they are the same digest. It reads every
# image before it fails, then names each one that differs or could not be
# read. A merged tag that is not a multi-arch index, or whose index has no
# linux/amd64 image or more than one, fails too. A per-arch tag that is a
# single image manifest rather than an index (a build without attestations)
# is its own linux/amd64 image. Reads are retried through retry_registry_read
# (Scripts/GHA/retry.sh), for what a later attempt can clear.
#
# It reads GHCR: the merges read the per-arch tags there and push-release-tags
# reads the merged tags there, and every build and merge names Docker Hub and
# GHCR in one push, so both registries carry the same digests.
#
# Needs bash 4.3 or later, docker (buildx) and jq, which GitHub's Ubuntu
# runners have. Tested by Scripts/GHA/Tests/check_tested_digests_test.sh.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=Scripts/GHA/retry.sh
source "${SCRIPT_DIR}/retry.sh"

REGISTRY="ghcr.io/oneuptime"

usage() {
	cat <<'EOF' >&2
Usage: check_tested_digests.sh --images "<image> <image> ..." --version <version>

Fails unless each image's <version> and enterprise-<version> tags carry, as
their linux/amd64 image, the image of the matching -amd64 tag.
EOF
}

IMAGES=""
VERSION=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--images)
			if [[ $# -lt 2 ]]; then
				usage
				exit 2
			fi
			IMAGES="$2"
			shift 2
			;;
		--version)
			if [[ $# -lt 2 ]]; then
				usage
				exit 2
			fi
			VERSION="$2"
			shift 2
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage
			exit 2
			;;
	esac
done

if [[ -z "$VERSION" ]]; then
	echo "Missing --version" >&2
	usage
	exit 2
fi

# The images, one word each, over any number of lines; commas count as
# spaces. (-d '' reads to the end, not to the first newline, so read returns
# non-zero at the end of its input.)
IMAGE_LIST=()
read -r -d '' -a IMAGE_LIST <<< "${IMAGES//,/ }" || true

if (( ${#IMAGE_LIST[@]} == 0 )); then
	# Checking nothing must not look like every image passing.
	echo "::error title=Tested images not checked::--images names no image"
	exit 1
fi

# The tags as the builds and merges push them (build_docker_images.sh).
SANITIZED_VERSION="${VERSION//+/-}"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# <reference>'s manifest (an index or one image's), as JSON, into <file>.
inspect_manifest() {
	docker buildx imagetools inspect "$1" --format '{{json .Manifest}}' >"$2"
}

# What jq makes of a manifest: the linux/amd64 image's digest, or a line
# starting "none: " that says why there is none.
AMD64_DIGEST_FILTER='
	if (.manifests | type) == "array" then
		[.manifests[]
			| select(.platform.os == "linux" and .platform.architecture == "amd64")
			| .digest]
		| if length == 1 then .[0]
			elif length == 0 then "none: no linux/amd64 image in its index"
			else "none: \(length) linux/amd64 images in its index" end
	elif $kind == "tested" then (.digest // "none: no digest")
	else "none: not a multi-arch index" end
'

# The linux/amd64 image of <reference>, by digest, on stdout. <kind> is
# "merged" (must be a multi-arch index with exactly one linux/amd64 image) or
# "tested" (an index's linux/amd64 image, or the manifest itself). Says why on
# stderr, last line, and returns non-zero when it cannot tell.
amd64_digest() {
	local reference="$1" kind="$2"
	local file="${WORK_DIR}/manifest.json"
	local digest

	# retry.sh's own lines go to the log, never into the answer.
	if ! retry_registry_read "reading ${reference}" \
		inspect_manifest "$reference" "$file" >&2; then
		echo "could not read ${reference}" >&2
		return 1
	fi

	if ! digest="$(jq -r --arg kind "$kind" "$AMD64_DIGEST_FILTER" "$file" 2>&1)"; then
		echo "could not read ${reference}'s manifest: ${digest}" >&2
		return 1
	fi

	if [[ "$digest" != sha256:* ]]; then
		echo "${reference}: ${digest#none: }" >&2
		return 1
	fi

	echo "$digest"
}

# Sets the variable named <name> to <reference>'s linux/amd64 digest, with
# everything amd64_digest said kept for the log; on failure, to why (its last
# line), and returns non-zero.
read_amd64_digest() {
	local -n answer="$1"
	local reference="$2" kind="$3"
	local why="${WORK_DIR}/why.txt"
	local status=0

	answer="$(amd64_digest "$reference" "$kind" 2>"$why")" || status=$?
	cat "$why" >&2
	if (( status != 0 )); then
		answer="$(tail -n 1 "$why")"
		return 1
	fi
	return 0
}

failed=()

for image in "${IMAGE_LIST[@]}"; do
	for tag in "${SANITIZED_VERSION}" "enterprise-${SANITIZED_VERSION}"; do
		merged="${REGISTRY}/${image}:${tag}"
		tested="${merged}-amd64"
		merged_digest=""
		tested_digest=""

		if ! read_amd64_digest merged_digest "$merged" merged; then
			echo "::error title=Untested image::${image}:${tag} - ${merged_digest}"
			failed+=("${image}:${tag}")
			continue
		fi

		if ! read_amd64_digest tested_digest "$tested" tested; then
			echo "::error title=Untested image::${image}:${tag} - ${tested_digest}"
			failed+=("${image}:${tag}")
			continue
		fi

		if [[ "$merged_digest" == "$tested_digest" ]]; then
			echo "✅ ${image}:${tag}'s linux/amd64 image is ${merged_digest}, the one the e2e jobs ran (${image}:${tag}-amd64)"
		else
			echo "::error title=Untested image::${image}:${tag}'s linux/amd64 image is ${merged_digest}, but the e2e jobs ran ${image}:${tag}-amd64, ${tested_digest}"
			failed+=("${image}:${tag}")
		fi
	done
done

if (( ${#failed[@]} > 0 )); then
	echo "::error title=Release tags not moved::not the images the e2e jobs ran: ${failed[*]}"
	exit 1
fi

echo "Every merged tag is the image the e2e jobs ran: ${IMAGE_LIST[*]} (${SANITIZED_VERSION}, enterprise-${SANITIZED_VERSION})"
