#!/usr/bin/env bash

set -euo pipefail

app_dir="/usr/src/app"
common_dir="/usr/src/Common"

# Refresh a package's node_modules if any dependency declared in its
# package.json is missing. This catches the case where the image was built
# before a dependency was added (so the container's node_modules is stale).
# In dev the source tree is bind-mounted while node_modules stays in an
# anonymous volume, so a package.json change alone won't pull in new deps until
# the image is rebuilt -- this self-heals that gap on startup.
refresh_deps_if_missing() {
  local dir="$1"
  local label="$2"
  if ! (
    cd "${dir}" &&
    node -e "
      const pkg = require('./package.json');
      const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
      for (const name of deps) {
        try { require.resolve(name + '/package.json', { paths: [process.cwd()] }); }
        catch (e) { console.error('missing:', name); process.exit(1); }
      }
    "
  ) >/dev/null 2>&1; then
    echo "Installing ${label} dependencies..."
    npm --prefix "${dir}" install
  fi
}

# App's own node_modules (e.g. aedes/ws for the MQTT ingestion server) can be
# stale for the same reason Common's can, so refresh both.
refresh_deps_if_missing "${app_dir}" "App"
refresh_deps_if_missing "${common_dir}" "Common"

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
