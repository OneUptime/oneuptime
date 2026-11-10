#!/usr/bin/env bash
#
# Pushes the packages build-package.sh wrote, as one multi-platform package,
# to each registry given, and with --sign signs each push by its digest:
#
#   bash Scripts/CrossplaneProvider/publish-package.sh --version 14.0.105 \
#     --repository ghcr.io/oneuptime/provider-oneuptime \
#     --repository docker.io/oneuptime/provider-oneuptime [--sign] [--input <dir>]
#
# The tag is v<version>: Crossplane resolves a package's versions, and the
# dependencies of a Configuration on it, as semantic versions with a v. The
# registries must be logged in to already (docker login); the crossplane CLI
# reads the same credentials.
#
# --sign signs with Sigstore's cosign, keyless, as the release signs its
# images (Scripts/GHA/sign_docker_images.sh): in GitHub Actions the
# certificate names the release workflow, which the job's OIDC token proves
# (the job needs id-token: write). --recursive signs the index and each
# platform's package, so either verifies:
#
#   cosign verify ghcr.io/oneuptime/provider-oneuptime:v<version> \
#     --certificate-identity \
#       https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
#     --certificate-oidc-issuer https://token.actions.githubusercontent.com
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../GHA/retry.sh
source "${ROOT}/Scripts/GHA/retry.sh"

VERSION=""
INPUT="${ROOT}/Crossplane/packages"
REPOSITORIES=()
SIGN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --repository) REPOSITORIES+=("$2"); shift 2 ;;
    --input) INPUT="$2"; shift 2 ;;
    --sign) SIGN=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

VERSION="${VERSION#v}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "--version must be MAJOR.MINOR.PATCH, got '${VERSION}'." >&2
  exit 2
fi
if [[ ${#REPOSITORIES[@]} -eq 0 ]]; then
  echo "Give at least one --repository." >&2
  exit 2
fi
tools=(crossplane)
if [[ "$SIGN" == true ]]; then
  tools+=(cosign docker python3)
fi
for tool in "${tools[@]}"; do
  command -v "$tool" >/dev/null || { echo "$tool is not on PATH." >&2; exit 1; }
done

shopt -s nullglob
files=("${INPUT}"/provider-oneuptime-*.xpkg)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "No packages in ${INPUT}: run build-package.sh first." >&2
  exit 1
fi
package_files="$(IFS=','; echo "${files[*]}")"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# The digest a tag names, written to <file>: a tag can move, a digest cannot,
# so the signature is made for the digest.
resolve_digest() {
  local ref="$1" file="$2"
  rm -f "$file"
  docker buildx imagetools inspect "$ref" --format '{{json .Manifest}}' >"${file}.json" || return 1
  python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["digest"])' "${file}.json" >"$file" || return 1
  [[ "$(cat "$file")" == sha256:* ]]
}

for repository in "${REPOSITORIES[@]}"; do
  ref="${repository}:v${VERSION}"
  echo "==> ${ref}"
  retry_with_backoff "push of ${ref}" \
    crossplane xpkg push --package-files="$package_files" "$ref"
  if [[ "$SIGN" == true ]]; then
    retry_with_backoff "digest of ${ref}" resolve_digest "$ref" "${WORK_DIR}/digest"
    digest="$(cat "${WORK_DIR}/digest")"
    retry_with_backoff "signature for ${ref}" \
      cosign sign --yes --recursive "${repository}@${digest}"
    echo "Signed ${ref} (${digest})"
  fi
done
