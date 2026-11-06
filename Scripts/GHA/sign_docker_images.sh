#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=Scripts/GHA/retry.sh
source "${SCRIPT_DIR}/retry.sh"

usage() {
	cat <<'EOF'
Usage: sign_docker_images.sh --version <version> [options]

Signs every image a release publishes with Sigstore's cosign, keyless: the
signing certificate names this repository's release workflow, which GitHub's
OIDC token proves, and the signature is recorded in Sigstore's public
transparency log. Anyone can then check an image before it crosses into their
network:

  cosign verify docker.io/oneuptime/app:<version> \
    --certificate-identity \
      https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com

Each version tag, community and enterprise-, is signed by digest on Docker Hub
and on GHCR, recursively, so the image of each platform carries a signature as
well as the multi-arch index: a platform's image copied on its own (as
HelmChart/AirGap/install.sh saves them) verifies too.

Required flags:
	--version <version>   The release (matches the pushed tags, e.g. 14.0.102)

Optional flags:
	--registries <list>   Space-separated registries to sign in
	                      (default: "docker.io/oneuptime ghcr.io/oneuptime")
EOF
}

VERSION=""
REGISTRIES="docker.io/oneuptime ghcr.io/oneuptime"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--version)
			VERSION="$2"
			shift 2
			;;
		--registries)
			REGISTRIES="$2"
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

if [[ -z "$VERSION" ]]; then
	echo "Missing required argument: --version" >&2
	usage
	exit 1
fi

if [[ -z "${REGISTRIES//[[:space:]]/}" ]]; then
	echo "--registries names no registry" >&2
	exit 1
fi

# Every image release.yml builds: the drift check below fails the run if a
# build job is added without it, so no published image goes unsigned.
IMAGES=(
	app
	docker-agent
	e2e
	home
	kubernetes-ai-agent
	kubernetes-cost-agent
	kubernetes-log-tailer
	nginx
	podman-agent
	probe
	resource-ai-agent
	runner
	test
	test-server
)

# build_docker_images.sh builds each image twice, so each has both tags.
TAG_PREFIXES=("" "enterprise-")

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_WORKFLOW="${REPO_ROOT}/.github/workflows/release.yml"

if [[ -f "$RELEASE_WORKFLOW" ]]; then
	WORKFLOW_IMAGES="$(grep -oE -- '--image [a-z0-9-]+' "$RELEASE_WORKFLOW" | awk '{print $2}' | sort -u || true)"
	if [[ -z "$WORKFLOW_IMAGES" ]]; then
		echo "❌ Found no '--image <name>' arguments in ${RELEASE_WORKFLOW}; the drift check cannot run." >&2
		exit 1
	fi
	SCRIPT_IMAGES="$(printf '%s\n' "${IMAGES[@]}" | sort -u)"
	if [[ "$WORKFLOW_IMAGES" != "$SCRIPT_IMAGES" ]]; then
		echo "❌ Image list drift between release.yml and sign_docker_images.sh" >&2
		echo "--- only in release.yml ---" >&2
		comm -23 <(printf '%s\n' "$WORKFLOW_IMAGES") <(printf '%s\n' "$SCRIPT_IMAGES") >&2
		echo "--- only in sign_docker_images.sh ---" >&2
		comm -13 <(printf '%s\n' "$WORKFLOW_IMAGES") <(printf '%s\n' "$SCRIPT_IMAGES") >&2
		exit 1
	fi
	echo "✅ Image list matches release.yml (${#IMAGES[@]} images)"
else
	echo "⚠️  ${RELEASE_WORKFLOW} not found — skipping image list drift check"
fi

for tool in cosign docker python3; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "${tool} not found on PATH." >&2
		exit 1
	fi
done

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# The digest a tag names, written to <file>: a tag can move, a digest cannot,
# so the signature is made for the digest. Each step returns on failure
# itself: retry_with_backoff runs this in a condition, where bash ignores
# set -e.
resolve_digest() {
	local ref="$1"
	local file="$2"

	rm -f "$file"
	docker buildx imagetools inspect "$ref" --format '{{json .Manifest}}' >"${file}.json" || return 1
	python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["digest"])' "${file}.json" >"$file" || return 1
	[[ -s "$file" ]]
}

FAILED=()
SIGNED=0

for image in "${IMAGES[@]}"; do
	for prefix in "${TAG_PREFIXES[@]}"; do
		for registry in $REGISTRIES; do
			ref="${registry}/${image}:${prefix}${VERSION}"
			digest_file="${WORK_DIR}/digest"

			if ! retry_with_backoff "digest of ${ref}" resolve_digest "$ref" "$digest_file"; then
				FAILED+=("$ref")
				continue
			fi

			digest="$(cat "$digest_file")"
			case "$digest" in
				sha256:*) ;;
				*)
					echo "❌ ${ref} resolved to '${digest}', which is no digest" >&2
					FAILED+=("$ref")
					continue
					;;
			esac

			if retry_with_backoff "signature for ${ref}" \
				cosign sign --yes --recursive "${registry}/${image}@${digest}"; then
				echo "✅ Signed ${ref} (${digest})"
				SIGNED=$(( SIGNED + 1 ))
			else
				FAILED+=("$ref")
			fi
		done
	done
done

if (( ${#FAILED[@]} > 0 )); then
	echo "❌ Not signed (${#FAILED[@]}): ${FAILED[*]}" >&2
	exit 1
fi

echo "✅ Signed ${SIGNED} image tags"
