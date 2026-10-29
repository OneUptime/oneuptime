#!/bin/bash
# The live heap of one OneUptime server other than the App - the Probe, the
# Runner, the ingress sidecar (packages/Nginx) - a while after it starts, run
# natively the way its image runs it: from /usr/src/app and /usr/src/Common
# (a private mount namespace maps them onto this checkout), ts-node
# transpile-only, the node flags of the package's start script and the
# image's heap limit. NODE_ENV=development is ts-node's own compile (every
# module's source map inline in its code); production is Common's
# transpiler (packages/Common/Server/Utils/TsNode/Transpiler.js). /etc/nginx
# and /var/log/nginx are empty in the namespace, so the sidecar's
# certificate jobs write nothing on this machine.
#
#   server-heap.sh <package> <development|production> [seconds] [env file]
#     server-heap.sh Nginx production 45 /tmp/oneuptime-perf/app.env
#     server-heap.sh Probe development 45 /tmp/oneuptime-perf/probe.env
#   prints heap-snapshot.js's JSON (rss, heapUsed, ... modules) for the
#   server <seconds> (45) after it starts, then stops it.
#
# Needs: Linux, root (unshare -m), npm ci in the package. Settings: PERF_DIR
# (the server's log), PERF_SERVER_INSPECTOR (9391), PERF_SERVER_PORT (3391,
# the port the server listens on).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PERF_DIR="${PERF_DIR:-/tmp/oneuptime-perf}"
PACKAGE="${1:-}"
MODE="${2:-}"
AFTER="${3:-45}"
ENV_FILE="${4:-}"
INSPECTOR="${PERF_SERVER_INSPECTOR:-9391}"
SERVER_PORT="${PERF_SERVER_PORT:-3391}"

if [ -z "$PACKAGE" ] || { [ "$MODE" != "development" ] && [ "$MODE" != "production" ]; }; then
  sed -n '2,21p' "${BASH_SOURCE[0]}"
  exit 1
fi
if [ ! -d "$REPO/packages/$PACKAGE/node_modules" ]; then
  echo "run npm ci in packages/$PACKAGE first"
  exit 1
fi

# The flags between "exec node" and "Index.ts" in the package's start script.
FLAGS="$(node -e '
  const start = require(process.argv[1]).scripts.start || "";
  const at = start.indexOf("exec node ");
  const end = start.indexOf(" Index.ts");
  process.stdout.write(at >= 0 && end > at ? start.slice(at + 10, end) : "--require ts-node/register");
' "$REPO/packages/$PACKAGE/package.json")"

mkdir -p "$PERF_DIR"
LOG="$PERF_DIR/server-heap-$PACKAGE-$MODE.log"

unshare -m --propagation private bash -c '
  set -e
  mount -t tmpfs tmpfs /usr/src
  mkdir -p /usr/src/app /usr/src/Common
  mount --bind "$0/packages/$1" /usr/src/app
  mount --bind "$0/packages/Common" /usr/src/Common
  mkdir -p /etc/nginx /var/log/nginx
  mount -t tmpfs tmpfs /etc/nginx
  mount -t tmpfs tmpfs /var/log/nginx
  cd /usr/src/app
  if [ -n "$5" ]; then
    set -a
    . "$5"
    set +a
  fi
  export NODE_ENV="$2" TS_NODE_TRANSPILE_ONLY=1 PORT="$4" LOG_LEVEL=ERROR DISABLE_TELEMETRY=true
  # shellcheck disable=SC2086
  exec node $6 --max-old-space-size=8096 --inspect=127.0.0.1:"$3" Index.ts
' "$REPO" "$PACKAGE" "$MODE" "$INSPECTOR" "$SERVER_PORT" "$ENV_FILE" "$FLAGS" >"$LOG" 2>&1 &
PID=$!

sleep "$AFTER"
node "$HERE/heap-snapshot.js" "$INSPECTOR"
status=$?

kill -INT "$PID" 2>/dev/null
for _ in $(seq 1 20); do
  if ! ps -p "$PID" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
kill -9 "$PID" 2>/dev/null
exit "$status"
