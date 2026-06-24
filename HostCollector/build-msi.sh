#!/bin/bash
#
# Wraps the cross-compiled Windows binaries (produced by build.sh) into MSI
# installers using wixl (msitools). Run build.sh first.
#
# Usage:  bash build-msi.sh <version>

sudo apt update
sudo apt install -y msitools wixl

# Exit script on any error
set -e

# Variables
OUTPUT_DIR="./dist"
APP_NAME="oneuptime-host-collector"

# Take version from the first argument
APP_VERSION=$1

echo "Building MSI for version: $APP_VERSION"

# Paths to the Windows binaries produced by build.sh
BINARIES=(
  "./dist/windows_amd64/oneuptime-host-collector.exe"
  "./dist/windows_arm64/oneuptime-host-collector.exe"
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

  echo "Building MSI for binary: $BINARY and arch: $ARCH"

  # Substitute the binary path and version into the WXS template
  sed "s|binary_placeholder|$BINARY|g" "$WXS_INPUT_FILE" > "$WXS_OUTPUT_FILE"
  sed -i "s|version_placeholder|$APP_VERSION|g" "$WXS_OUTPUT_FILE"

  echo "Packaging $BINARY into $MSI_FILE..."
  wixl -o "$MSI_FILE" "$WXS_OUTPUT_FILE"

  if [ $? -eq 0 ]; then
    echo "MSI successfully created: $MSI_FILE"
  else
    echo "Error: Failed to create MSI for $ARCH."
    exit 1
  fi
done
