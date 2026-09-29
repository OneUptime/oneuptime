#!/usr/bin/env bash

set -euo pipefail

pids=()

cleanup() {
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
}

trap cleanup EXIT INT TERM

# The Enterprise Edition (ee/) in the dev container.
#
# Scripts/Dev/docker-compose.dev.yml bind-mounts the repository's ee/ at
# /usr/src/ee and puts /usr/src/ee/node_modules on an anonymous volume, so the
# host's node_modules (host-built, with host symlinks) never shadows it. That
# volume starts empty, so install ee's dependencies into it here. The
# Dockerfile's /usr/src/packages links make ee's file:../packages/{Common,App}
# dependencies resolve to /usr/src/Common and /usr/src/app.
#
# `npm ci` never rewrites ee/package-lock.json, which is the host's file here.
# --ignore-scripts keeps npm from running the linked Common and App packages'
# lifecycle scripts. A stamp of the lockfile skips the install on restarts
# until the lockfile changes.
#
# No ee/ (a Community-only checkout) means nothing to install, and the App runs
# as the Community Edition. A failed install stops the dev container: the App
# would otherwise find ee/ and refuse to boot with a less obvious error.
install_enterprise_deps() {
  local ee_dir="${1:-/usr/src/ee}"

  if [ ! -f "${ee_dir}/package.json" ]; then
    echo "No Enterprise Edition at ${ee_dir}; the App runs as the Community Edition."
    return 0
  fi

  local stamp="${ee_dir}/node_modules/.oneuptime-installed-lock"
  local wanted
  wanted="$(cksum < "${ee_dir}/package-lock.json")"

  if [ -f "${stamp}" ] && [ "$(cat "${stamp}")" = "${wanted}" ]; then
    echo "Enterprise Edition dependencies are up to date."
    return 0
  fi

  echo "Installing Enterprise Edition (ee/) dependencies..."
  if ! (cd "${ee_dir}" && npm ci --ignore-scripts); then
    echo "Installing the Enterprise Edition dependencies in ${ee_dir} failed." >&2
    return 1
  fi
  printf '%s\n' "${wanted}" > "${stamp}"
}

install_enterprise_deps /usr/src/ee

# Ensure Common has Linux-built node_modules before any frontend build runs.
# The image may carry a stale node_modules if package.json changed since the
# last image build, so refresh in place when key deps are missing.
bash ./scripts/prepare-native-deps.sh

npm run build-frontends

npm run watch-frontend:accounts &
pids+=($!)

npm run watch-frontend:dashboard &
pids+=($!)

npm run watch-frontend:admin-dashboard &
pids+=($!)

npm run watch-frontend:status-page &
pids+=($!)

npm run watch-frontend:public-dashboard &
pids+=($!)

npm run dev:api &
pids+=($!)

wait -n "${pids[@]}"
