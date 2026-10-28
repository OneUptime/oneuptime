#!/bin/bash
# A production-like OneUptime stack on one machine, for measuring CPU: the
# App and the Probe run natively, the way their images run them
# (NODE_ENV=production, ts-node in transpile-only mode, the image's paths),
# against Postgres, Valkey and ClickHouse containers of their own.
#
# Each Node process runs in a private mount namespace (unshare -m, so root)
# in which /usr/src/app and /usr/src/Common are this checkout's packages, as
# the images lay them out. Containers are named "$PERF_PREFIX-*" and every
# process's PID is kept in $PERF_DIR, so `down` stops only what `up` started.
#
#   stack.sh up [--probe]          containers, then the App (and the Probe)
#   stack.sh app-restart [K=V ...] the App again; K=V lines go into its env,
#                                  e.g. APP_NODE_FLAGS=--inspect=127.0.0.1:9371
#   stack.sh probe-restart         the Probe again
#   stack.sh probe-stop            stop the Probe
#   stack.sh down [--all]          stop the App and Probe (--all: containers too)
#   stack.sh wait-ready            until the App answers /api/status/ready
#
# Settings (environment): PERF_DIR (/tmp/oneuptime-perf), PERF_PREFIX
# (oneuptime-perf), PERF_SOURCE (this checkout; another checkout's root runs
# that code - see make-baseline.sh), PERF_APP_PORT (3371), PERF_PROBE_PORT
# (3372), PERF_PG_PORT (15371), PERF_VALKEY_PORT (16371), PERF_CH_PORT (18371).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PERF_DIR="${PERF_DIR:-/tmp/oneuptime-perf}"
PERF_PREFIX="${PERF_PREFIX:-oneuptime-perf}"
PERF_SOURCE="${PERF_SOURCE:-$REPO}"
PERF_APP_PORT="${PERF_APP_PORT:-3371}"
PERF_PG_PORT="${PERF_PG_PORT:-15371}"
PERF_VALKEY_PORT="${PERF_VALKEY_PORT:-16371}"
PERF_CH_PORT="${PERF_CH_PORT:-18371}"
PASSWORD="please-change-this-to-random-value"

export PERF_DIR PERF_PREFIX PERF_SOURCE PERF_APP_PORT PERF_PG_PORT PERF_VALKEY_PORT PERF_CH_PORT
mkdir -p "$PERF_DIR"

running() {
  docker ps --filter "name=^$1\$" --format x | grep -q x
}

start_containers() {
  # The images and settings docker-compose.base.yml runs, but for more
  # Postgres connections: in-app.sh scripts open pools of their own beside
  # the App's.
  if ! running "$PERF_PREFIX-pg"; then
    docker run -d --rm --name "$PERF_PREFIX-pg" -e POSTGRES_PASSWORD="$PASSWORD" \
      -e POSTGRES_USER=postgres -e POSTGRES_DB=oneuptimedb \
      -p "$PERF_PG_PORT:5432" postgres:15 -c max_connections=300 >/dev/null
  fi
  if ! running "$PERF_PREFIX-valkey"; then
    docker run -d --rm --name "$PERF_PREFIX-valkey" -p "$PERF_VALKEY_PORT:6379" \
      valkey/valkey:9.1-alpine valkey-server --requirepass "$PASSWORD" \
      --save "" --appendonly no >/dev/null
  fi
  if ! running "$PERF_PREFIX-ch"; then
    # The same config.d and users.d drop-ins docker-compose.base.yml mounts.
    docker run -d --rm --name "$PERF_PREFIX-ch" --hostname clickhouse \
      -e CLICKHOUSE_USER=default -e CLICKHOUSE_PASSWORD="$PASSWORD" \
      -e CLICKHOUSE_DB=oneuptime -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
      -p "$PERF_CH_PORT:8123" \
      -v "$REPO/Clickhouse/config.d/cluster.xml:/etc/clickhouse-server/config.d/cluster.xml:ro" \
      -v "$REPO/Clickhouse/config.d/system-log-ttl.xml:/etc/clickhouse-server/config.d/system-log-ttl.xml:ro" \
      -v "$REPO/Clickhouse/config.d/logger.xml:/etc/clickhouse-server/config.d/logger.xml:ro" \
      -v "$REPO/Clickhouse/users.d/distributed-insert-tuning.xml:/etc/clickhouse-server/users.d/distributed-insert-tuning.xml:ro" \
      clickhouse/clickhouse-server:26.7 >/dev/null
  fi
  for _ in $(seq 1 60); do
    if docker exec "$PERF_PREFIX-pg" pg_isready -U postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
}

stop_pid() {
  local file="$PERF_DIR/$1.pid"
  if [ -f "$file" ]; then
    local pid
    pid=$(cat "$file")
    # SIGINT first: a --cpu-prof run writes its profile on the way out.
    kill -INT "$pid" 2>/dev/null
    for _ in $(seq 1 60); do
      if ! ps -p "$pid" >/dev/null 2>&1; then break; fi
      sleep 1
    done
    kill -9 "$pid" 2>/dev/null
    rm -f "$file"
  fi
}

start_node() {
  local name="$1"
  local package="$2"
  local flags_variable="$3"
  # shellcheck disable=SC2016
  PERF_PACKAGE="$package" PERF_FLAGS_VARIABLE="$flags_variable" PERF_ENV_FILE="$PERF_DIR/$name.env" \
    nohup unshare -m --propagation private bash -c '
      set -euo pipefail
      mount -t tmpfs tmpfs /usr/src
      mkdir -p /usr/src/app /usr/src/Common
      mount --bind "$PERF_SOURCE/packages/$PERF_PACKAGE" /usr/src/app
      mount --bind "$PERF_SOURCE/packages/Common" /usr/src/Common
      set -a
      . "$PERF_ENV_FILE"
      set +a
      cd /usr/src/app
      export NODE_OPTIONS="--max-old-space-size=8096"
      flags="${!PERF_FLAGS_VARIABLE:-}"
      # shellcheck disable=SC2086
      exec node --no-node-snapshot $flags --require ts-node/register Index.ts
    ' >"$PERF_DIR/$name.log" 2>&1 &
  echo $! >"$PERF_DIR/$name.pid"
  echo "$name pid $(cat "$PERF_DIR/$name.pid") from $PERF_SOURCE"
}

wait_ready() {
  for _ in $(seq 1 200); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PERF_APP_PORT/api/status/ready")" = "200" ]; then
      echo "App ready"
      return 0
    fi
    sleep 3
  done
  echo "App not ready; see $PERF_DIR/app.log"
  return 1
}

command="${1:-}"
shift || true

case "$command" in
  up)
    python3 -I "$HERE/make_env.py"
    start_containers
    start_node app App APP_NODE_FLAGS
    if [ "${1:-}" = "--probe" ]; then
      wait_ready && start_node probe Probe PROBE_NODE_FLAGS
    fi
    ;;
  app-restart)
    python3 -I "$HERE/make_env.py" "$@"
    stop_pid app
    start_node app App APP_NODE_FLAGS
    ;;
  probe-restart)
    python3 -I "$HERE/make_env.py"
    stop_pid probe
    start_node probe Probe PROBE_NODE_FLAGS
    ;;
  probe-stop)
    stop_pid probe
    ;;
  down)
    stop_pid probe
    stop_pid app
    if [ "${1:-}" = "--all" ]; then
      for name in ch valkey pg; do
        docker rm -f -v "$PERF_PREFIX-$name" >/dev/null 2>&1
      done
    fi
    echo "down"
    ;;
  wait-ready)
    wait_ready
    ;;
  *)
    sed -n '2,23p' "${BASH_SOURCE[0]}"
    exit 1
    ;;
esac
