#!/usr/bin/env bash
#
# Dump the containers that serve /api/* into ./E2E, so a failing e2e run
# carries the reason with it.
#
# The express error handler answers a 500 with a fixed {"error":"Server Error"}
# for anything that is not an OneUptime Exception (Common/Server/Utils/
# StartServer.ts). The class, the message and the stack only ever reach the
# app container's stdout, and the e2e job used to dump the e2e container alone
# — so every one of those 500s arrived in CI unexplained and the runner was
# torn down with the answer on it.
#
# Runs on a path that is already failing, so it never fails: no `set -e`, and
# every command is allowed to fall over quietly.

set +e

COMPOSE_FILE="${1:-docker-compose.yml}"
OUT_DIR="${2:-./E2E/container-logs}"
TAIL="${3:-20000}"

# app serves /api/*; ingress fronts it; probe/postgres/clickhouse/valkey are
# where an infrastructure failure would show up first.
SERVICES="app ingress probe-1 postgres clickhouse valkey"

mkdir -p "$OUT_DIR"

echo "Dumping container logs from ${COMPOSE_FILE} into ${OUT_DIR}"

for service in $SERVICES; do
  out="${OUT_DIR}/${service}.log"
  docker compose -f "$COMPOSE_FILE" logs --no-color --timestamps --tail="$TAIL" "$service" >"$out" 2>&1
  if [ -s "$out" ]; then
    echo "  ${service}: $(wc -l <"$out" | tr -d ' ') lines -> ${out}"
  else
    echo "  ${service}: no log captured"
    rm -f "$out"
  fi
done

# Surface the errors inline too. The uploaded artifact is the full record, but
# a reader looking at the failed step should not have to download it first.
if [ -f "${OUT_DIR}/app.log" ]; then
  echo ""
  echo "===== last 100 error lines from the app container ====="
  grep -iE "error|exception|unhandled|stripe" "${OUT_DIR}/app.log" | tail -100
  echo "===== end app container errors ====="
fi

exit 0
