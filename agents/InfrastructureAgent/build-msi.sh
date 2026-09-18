#!/bin/bash

sudo apt update
sudo apt install -y msitools wixl


# Exit script on any error
set -e

# Variables
OUTPUT_DIR="./dist"
APP_NAME="oneuptime-infrastructure-agent"
# Take version from --version argument

APP_VERSION=$1

# Log version
echo "Building MSI for version: $APP_VERSION"

# Paths to binaries
BINARIES=(
  "./dist/oneuptime_windows_amd64_v1/oneuptime-infrastructure-agent.exe"
  "./dist/oneuptime_windows_arm64_v8.0/oneuptime-infrastructure-agent.exe"
)

# Architecture mappings
ARCHES=("amd64" "arm64")

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# Check if wixl is installed
if ! command -v wixl &> /dev/null; then
  echo "Error: wixl is not installed. Please install it using 'sudo apt install -y msitools wixl'."
  exit 1
fi

# Generate MSI files for each binary
for i in "${!BINARIES[@]}"; do
  BINARY="${BINARIES[$i]}"
  ARCH="${ARCHES[$i]}"
  WXS_INPUT_FILE="./windows/app-$ARCH-template.wxs"
  WXS_OUTPUT_FILE="./windows/app-$ARCH.wxs"
  MSI_FILE="$OUTPUT_DIR/$APP_NAME-$ARCH.msi"

  # log binary and arch
  echo "Building MSI for binary: $BINARY and arch: $ARCH"

  # Update the WXS file with the correct binary
  sed "s|binary_placeholder|$BINARY|g" $WXS_INPUT_FILE > "$WXS_OUTPUT_FILE"

  # Update version in WXS file
  sed -i "s|version_placeholder|$APP_VERSION|g" "$WXS_OUTPUT_FILE"

  echo "Packaging $BINARY into $MSI_FILE..."
  wixl -o "$MSI_FILE" "$WXS_OUTPUT_FILE"

  if [ $? -eq 0 ]; then
    echo "MSI successfully created: $MSI_FILE"
  else
    echo "Error: Failed to create MSI for $ARCH."
    exit 1
  fi

  # The MSIs are built here, after `goreleaser release` has already finished,
  # so GoReleaser's sboms: config never sees them. Generate theirs by hand so
  # every artifact on the release has one. Scan the .exe rather than the .msi:
  # syft does not understand the MSI container format and would report zero
  # components, and the .exe is what actually lands on the host.
  SBOM_FILE="$OUTPUT_DIR/$APP_NAME-$ARCH.msi.cdx.json"
  echo "Generating SBOM for $BINARY into $SBOM_FILE..."
  # `file:` is explicit on purpose. Given a bare path syft tries its image
  # providers first (oci, docker-archive, snap, ...) and only falls back to
  # local-file, so a path that happens to look like an image reference, or a
  # transient registry lookup, can turn a local scan into a confusing failure.
  syft "file:$BINARY" --output "cyclonedx-json=$SBOM_FILE"

  COMPONENTS=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1])).get("components", [])))' "$SBOM_FILE")
  if [ "$COMPONENTS" -eq 0 ]; then
    echo "Error: SBOM for $ARCH MSI has zero components." >&2
    exit 1
  fi
  echo "SBOM created: $SBOM_FILE ($COMPONENTS components)"
done