#!/usr/bin/env bash
#
# Cross-platform build for the OneUptime Host Collector.
#
# Generates the custom collector Go source with the OpenTelemetry Collector
# Builder (ocb), then cross-compiles native binaries for Windows / Linux / macOS
# and packages them (zip for Windows, tar.gz otherwise) under ./dist.
#
# Usage:  bash build.sh <version>
#
# Requires: Go (>= the toolchain required by the collector release) and network
# access to fetch the collector component modules. CGO is disabled so the build
# cross-compiles cleanly.
set -euo pipefail

OCB_VERSION="v0.154.0"
BINARY="oneuptime-host-collector"
BUILD_DIR="./_build"
DIST_DIR="./dist"
VERSION="${1:-0.0.0-dev}"

echo "==> Building OneUptime Host Collector ${VERSION} (ocb ${OCB_VERSION})"

# 1. Install the OpenTelemetry Collector Builder (ocb).
go install "go.opentelemetry.io/collector/cmd/builder@${OCB_VERSION}"
BUILDER="$(go env GOPATH)/bin/builder"

# 2. Generate the collector Go source (without compiling — we cross-compile below).
rm -rf "${BUILD_DIR}"
"${BUILDER}" --config builder-config.yaml --skip-compilation

# 3. Cross-compile each target and package it alongside the matching sample config.
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

targets=(
  "windows/amd64"
  "windows/arm64"
  "linux/amd64"
  "linux/arm64"
  "darwin/amd64"
  "darwin/arm64"
)

for target in "${targets[@]}"; do
  os="${target%/*}"
  arch="${target#*/}"
  ext=""
  [ "${os}" = "windows" ] && ext=".exe"

  outdir="${DIST_DIR}/${os}_${arch}"
  mkdir -p "${outdir}"
  echo "==> Compiling ${os}/${arch}"

  ( cd "${BUILD_DIR}" && GOOS="${os}" GOARCH="${arch}" CGO_ENABLED=0 \
      go build -trimpath -ldflags "-s -w" -o "../${outdir}/${BINARY}${ext}" . )

  # Bundle the OS-appropriate sample config next to the binary.
  case "${os}" in
    windows) cp config.windows.yaml "${outdir}/config.yaml" ;;
    darwin)  cp config.macos.yaml   "${outdir}/config.yaml" ;;
    *)       cp config.linux.yaml   "${outdir}/config.yaml" ;;
  esac

  if [ "${os}" = "windows" ]; then
    ( cd "${outdir}" && zip -q "../${BINARY}_${os}_${arch}.zip" "${BINARY}${ext}" "config.yaml" )
  else
    ( cd "${outdir}" && tar -czf "../${BINARY}_${os}_${arch}.tar.gz" "${BINARY}${ext}" "config.yaml" )
  fi
done

echo "==> Done. Release artifacts:"
ls -la "${DIST_DIR}"/*.zip "${DIST_DIR}"/*.tar.gz 2>/dev/null || true
