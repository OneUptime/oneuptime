#!/bin/bash
# Runs one of this folder's scripts the way the App runs: in a private mount
# namespace (unshare -m, so root) in which /usr/src/app and /usr/src/Common
# are $PERF_SOURCE's packages, with the stack's app.env and ts-node in
# transpile-only mode - so the script can require the App's and Common's
# TypeScript as the App's own code does, against the stack's datastores.
# Queue workers are off: the script's process never takes the App's jobs.
#
# Usage: in-app.sh <script.js> [args...]
# Settings: PERF_DIR, PERF_SOURCE (see stack.sh).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PERF_DIR="${PERF_DIR:-/tmp/oneuptime-perf}"
PERF_SOURCE="${PERF_SOURCE:-$REPO}"
SCRIPT="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
shift

if [ ! -f "$PERF_DIR/app.env" ]; then
  python3 -I "$HERE/make_env.py"
fi

# shellcheck disable=SC2016
exec unshare -m --propagation private bash -c '
  set -euo pipefail
  source="$1"
  env_file="$2"
  script="$3"
  shift 3
  mount -t tmpfs tmpfs /usr/src
  mkdir -p /usr/src/app /usr/src/Common
  mount --bind "$source/packages/App" /usr/src/app
  mount --bind "$source/packages/Common" /usr/src/Common
  set -a
  . "$env_file"
  set +a
  export DISABLE_QUEUE_WORKERS=true
  export NODE_PATH=/usr/src/app/node_modules
  cd /usr/src/app
  exec node --no-node-snapshot --max-old-space-size=8096 --require ts-node/register "$script" "$@"
' in-app "$PERF_SOURCE" "$PERF_DIR/app.env" "$SCRIPT" "$@"
