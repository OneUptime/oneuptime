#!/usr/bin/env bash
#
# Builds the Crossplane package of the generated provider
# (Crossplane/provider-oneuptime, from `npm run generate-crossplane-provider`):
# for each platform, the provider binary, its runtime image, and a package
# (.xpkg) with the image in it, so installing the package is all a cluster
# needs.
#
#   bash Scripts/CrossplaneProvider/build-package.sh --version 14.0.105 \
#     [--platforms linux/amd64,linux/arm64] [--output <dir>]
#
# Writes <output>/provider-oneuptime-<arch>.xpkg for each platform
# (default output: Crossplane/packages). publish-package.sh pushes them as one
# multi-platform package. Needs go, docker (with buildx) and the crossplane
# CLI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROVIDER_DIR="${ROOT}/Crossplane/provider-oneuptime"
VERSION=""
PLATFORMS="linux/amd64,linux/arm64"
OUTPUT="${ROOT}/Crossplane/packages"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --platforms) PLATFORMS="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "--version is required (the OneUptime release, such as 14.0.105)." >&2
  exit 2
fi
VERSION="${VERSION#v}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "--version must be MAJOR.MINOR.PATCH, got '${VERSION}'." >&2
  exit 2
fi
if [[ ! -f "${PROVIDER_DIR}/go.mod" || ! -d "${PROVIDER_DIR}/package/crds" ]]; then
  echo "No generated provider at ${PROVIDER_DIR}: run npm run generate-crossplane-provider first." >&2
  exit 1
fi
for tool in go docker crossplane; do
  command -v "$tool" >/dev/null || { echo "$tool is not on PATH." >&2; exit 1; }
done

mkdir -p "$OUTPUT"
IFS=',' read -r -a platforms <<<"$PLATFORMS"
for platform in "${platforms[@]}"; do
  os="${platform%%/*}"
  arch="${platform##*/}"
  echo "==> ${platform}: provider binary"
  (
    cd "$PROVIDER_DIR"
    CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath \
      -ldflags "-s -w -X github.com/oneuptime/crossplane-provider-oneuptime/internal/version.Version=v${VERSION}" \
      -o "bin/${os}_${arch}/provider" ./cmd/provider
  )

  echo "==> ${platform}: runtime image"
  runtime="provider-oneuptime-runtime:${VERSION}-${arch}"
  docker buildx build --platform "$platform" --load --tag "$runtime" "$PROVIDER_DIR"

  echo "==> ${platform}: package"
  rm -f "${OUTPUT}/provider-oneuptime-${arch}.xpkg"
  crossplane xpkg build \
    --package-root="${PROVIDER_DIR}/package" \
    --embed-runtime-image="$runtime" \
    --package-file="${OUTPUT}/provider-oneuptime-${arch}.xpkg"
done

ls -l "$OUTPUT"
