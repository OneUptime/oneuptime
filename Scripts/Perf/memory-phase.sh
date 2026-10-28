#!/bin/bash
# Memory over a window of steady load (or of idle, with 0 collectors and 0
# users and no heartbeats): the same generators as load-phase.sh - heartbeats
# for every seeded Incoming Request monitor, OTLP logs, traces and metrics
# from <collectors> collectors, <users> people on the Dashboard - while the
# Probe (if it runs) checks the seeded monitors. Warms up for <warmupSeconds>,
# samples <minutes> with memory-sample.py, then stops the generators it
# started. With an inspector port (the App started with
# APP_NODE_FLAGS=--inspect=127.0.0.1:<port>), the App's live heap after a full
# garbage collection is read every <heapEvery> samples of 30 seconds.
#
# Usage: memory-phase.sh <seed.json> <label> <minutes> [warmupSeconds] [collectors] [users] [inspectorPort] [heapEvery]
#        (defaults: 120 s, 20 collectors, 5 users, no inspector, 4;
#         0 collectors and 0 users measures idle: no generator at all)
# Results: $PERF_DIR/results/<label>.memory.json
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PERF_DIR="${PERF_DIR:-/tmp/oneuptime-perf}"
SEED="$1"
LABEL="$2"
MINUTES="$3"
WARMUP="${4:-120}"
COLLECTORS="${5:-20}"
USERS="${6:-5}"
INSPECTOR="${7:-}"
HEAP_EVERY="${8:-4}"
TOTAL=$((MINUTES + 1 + WARMUP / 60))
mkdir -p "$PERF_DIR/results"

started=()
if [ "$COLLECTORS" != "0" ] || [ "$USERS" != "0" ]; then
  node "$HERE/heartbeats.js" "$SEED" "$TOTAL" >"$PERF_DIR/$LABEL-heartbeats.log" 2>&1 &
  started+=($!)
fi
if [ "$COLLECTORS" != "0" ]; then
  node "$HERE/otlp-load.js" "$SEED" "$TOTAL" "$COLLECTORS" "${PERF_OTLP_PERIOD_MS:-4000}" >"$PERF_DIR/$LABEL-otlp.log" 2>&1 &
  started+=($!)
fi
if [ "$USERS" != "0" ]; then
  node "$HERE/browse-load.js" "$SEED" "$USERS" "$TOTAL" 15000 >"$PERF_DIR/$LABEL-browse.log" 2>&1 &
  started+=($!)
fi

sleep "$WARMUP"

if [ -n "$INSPECTOR" ]; then
  python3 -I "$HERE/memory-sample.py" "$MINUTES" "$LABEL" --interval 30 --app-inspector "$INSPECTOR" --heap-every "$HEAP_EVERY"
else
  python3 -I "$HERE/memory-sample.py" "$MINUTES" "$LABEL" --interval 30
fi

# Only the generators this script started.
for pid in "${started[@]}"; do
  kill "$pid" 2>/dev/null
done
wait 2>/dev/null

echo "memory phase $LABEL done"
for log in "$PERF_DIR/$LABEL-otlp.log" "$PERF_DIR/$LABEL-heartbeats.log" "$PERF_DIR/$LABEL-browse.log"; do
  if [ -f "$log" ]; then
    tail -n 1 "$log"
  fi
done
