#!/usr/bin/env bash
#
# Fetches the resources an Iron Bank hardening_manifest.yaml lists, as Iron
# Bank's pipeline does before it builds, so a build of the Dockerfile beside it
# reads what Iron Bank's would:
#
#   - a docker:// resource is pulled by its digest (Docker checks the content
#     against it) and given the name in its `tag`, which the Dockerfile's FROM
#     uses;
#   - an http(s):// resource is downloaded into the directory as its
#     `filename`, and its sha256 or sha512 checked.
#
# Anything else the manifest format allows (s3://, `urls` mirrors, `auth`) is
# refused rather than skipped: the build would then read something Iron Bank's
# does not.
#
# Usage:
#   bash Scripts/IronBank/fetch_resources.sh IronBank/App
#
# Needs docker, curl and yq (mikefarah's, which GitHub's Ubuntu runners have).
# The Iron Bank Preflight workflow (.github/workflows/iron-bank.yml) runs it.

set -euo pipefail

DIR="${1:?Usage: fetch_resources.sh <directory with hardening_manifest.yaml>}"
MANIFEST="${DIR}/hardening_manifest.yaml"

if ! command -v yq >/dev/null 2>&1; then
	echo "fetch_resources.sh needs yq (https://github.com/mikefarah/yq)" >&2
	exit 1
fi

field() {
	yq -r ".resources[$1].$2 // \"\"" "$MANIFEST"
}

# Docker Hub has bad minutes: retry a pull before giving up on it.
pull() {
	local attempt
	for attempt in 1 2 3 4; do
		if docker pull --quiet "$1"; then
			return 0
		fi
		echo "docker pull $1 failed (attempt ${attempt}), retrying" >&2
		sleep $((attempt * 10))
	done
	return 1
}

COUNT="$(yq -r '.resources // [] | length' "$MANIFEST")"

for ((i = 0; i < COUNT; i++)); do
	URL="$(field "$i" url)"

	if [[ -n "$(field "$i" urls)" || -n "$(field "$i" auth)" ]]; then
		echo "Resource $((i + 1)): urls and auth are not supported here" >&2
		exit 1
	fi

	case "$URL" in
	docker://*@sha256:*)
		REFERENCE="${URL#docker://}"
		TAG="$(field "$i" tag)"
		if [[ -z "$TAG" ]]; then
			echo "Resource $((i + 1)) (${URL}) has no tag" >&2
			exit 1
		fi
		pull "$REFERENCE"
		docker tag "$REFERENCE" "$TAG"
		echo "✅ ${TAG} is ${REFERENCE}"
		;;
	docker://*)
		echo "Resource $((i + 1)) (${URL}) is not pinned by digest" >&2
		exit 1
		;;
	http://* | https://*)
		FILENAME="$(field "$i" filename)"
		TYPE="$(field "$i" validation.type)"
		VALUE="$(field "$i" validation.value)"
		if [[ -z "$FILENAME" || "$FILENAME" == */* ]]; then
			echo "Resource $((i + 1)) (${URL}) needs a filename without a slash" >&2
			exit 1
		fi
		if [[ "$TYPE" != "sha256" && "$TYPE" != "sha512" ]] || [[ -z "$VALUE" ]]; then
			echo "Resource $((i + 1)) (${URL}) needs a sha256 or sha512 validation" >&2
			exit 1
		fi
		curl -fsSL --retry 5 --retry-all-errors -o "${DIR}/${FILENAME}" "$URL"
		echo "${VALUE}  ${DIR}/${FILENAME}" | "${TYPE}sum" --check --strict -
		;;
	*)
		echo "Resource $((i + 1)) has a URL this does not fetch: ${URL}" >&2
		exit 1
		;;
	esac
done

echo "Fetched ${COUNT} resource(s) of ${MANIFEST}"
