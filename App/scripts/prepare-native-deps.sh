#!/usr/bin/env bash

set -euo pipefail

common_dir="/usr/src/Common"

# Refresh Common's node_modules if any dependency declared in package.json is
# missing from node_modules. This catches the case where the image was built
# before a dependency was added (so /usr/src/Common/node_modules is stale).
if ! (
  cd "${common_dir}" &&
  node -e "
    const pkg = require('./package.json');
    const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
    for (const name of deps) {
      try { require.resolve(name + '/package.json', { paths: [process.cwd()] }); }
      catch (e) { console.error('missing:', name); process.exit(1); }
    }
  "
) >/dev/null 2>&1; then
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
