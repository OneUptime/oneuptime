#!/usr/bin/env bash

set -euo pipefail

common_dir="/usr/src/Common"

if [ ! -d "${common_dir}/node_modules/isolated-vm" ]; then
  echo "Installing Common dependencies..."
  npm --prefix "${common_dir}" install
fi

if (
  cd "${common_dir}" &&
  node --no-node-snapshot -e "require('isolated-vm')"
) >/dev/null 2>&1; then
  exit 0
fi

echo "Rebuilding isolated-vm for Node $(node -p 'process.version')..."

npm --prefix "${common_dir}" rebuild isolated-vm

(
  cd "${common_dir}" &&
  node --no-node-snapshot -e "require('isolated-vm')"
) >/dev/null
