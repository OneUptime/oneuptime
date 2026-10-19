#!/bin/bash

sudo apt update
sudo apt install -y msitools wixl


# Exit script on any error
set -e

# Variables
OUTPUT_DIR="./dist"
APP_NAME="oneuptime-infrastructure-agent"
# windows/oneuptime-infrastructure-agent.wxs says how the installer upgrades
# and handles the agent's service.
WXS_FILE="./windows/$APP_NAME.wxs"
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

# The Windows Installer platform of each MSI. wixl cannot build an ARM64
# package, so the arm64 MSI is an x64 one carrying the arm64 program, which
# Windows 11 on Arm installs. Not x86: Windows Installer maps a 32-bit
# package's ProgramFiles64Folder to the 32-bit Program Files, so the native
# ARM64 program missed C:\Program Files\OneUptimeInfrastructureAgent, where
# the docs say it is (Windows 10 on Arm, which has no x64 emulation, has been
# out of support since October 2025).
WIXL_ARCHES=("x64" "x64")

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
  MSI_FILE="$OUTPUT_DIR/$APP_NAME-$ARCH.msi"

  # log binary and arch
  echo "Building MSI for binary: $BINARY and arch: $ARCH"

  echo "Packaging $BINARY into $MSI_FILE..."
  wixl -a "${WIXL_ARCHES[$i]}" \
    -D "Arch=$ARCH" \
    -D "Version=$APP_VERSION" \
    -D "Binary=$BINARY" \
    -o "$MSI_FILE" "$WXS_FILE"

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
