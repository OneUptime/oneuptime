#!/bin/bash
# Steady load on the running stack, measured: heartbeats for every seeded
# Incoming Request monitor, OTLP logs, traces and metrics from <collectors>
# collectors, and <users> people on the Dashboard - while the Probe (if it
# runs) checks the seeded monitors. Warms up for <warmupSeconds>, samples
# <minutes> with cpu-sample.py (with --profile also a CPU profile of the App,
# which must run with APP_NODE_FLAGS=--inspect=127.0.0.1:9371), then stops
# the generators it started.
#
# Usage: load-phase.sh <seed.json> <label> <minutes> [warmupSeconds] [collectors] [users] [--profile]
#        (defaults: 120 s, 20 collectors, 5 users; 0 users skips the browser)
# Settings: PERF_OTLP_PERIOD_MS (4000) - how often each collector sends. At
# 2000 the App's telemetry queue fell behind (it worked through about 22
# batches a second; 30 came in), and a window then measures a backlog.
# Results: $PERF_DIR/results/<label>.json (and <label>.cpuprofile).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PERF_DIR="${PERF_DIR:-/tmp/oneuptime-perf}"
SEED="$1"
LABEL="$2"
MINUTES="$3"
WARMUP="${4:-120}"
COLLECTORS="${5:-20}"
USERS="${6:-5}"
PROFILE="${7:-}"
TOTAL=$((MINUTES + 1 + WARMUP / 60))
mkdir -p "$PERF_DIR/results"

started=()
node "$HERE/heartbeats.js" "$SEED" "$TOTAL" >"$PERF_DIR/$LABEL-heartbeats.log" 2>&1 &
started+=($!)
node "$HERE/otlp-load.js" "$SEED" "$TOTAL" "$COLLECTORS" "${PERF_OTLP_PERIOD_MS:-4000}" >"$PERF_DIR/$LABEL-otlp.log" 2>&1 &
started+=($!)
if [ "$USERS" != "0" ]; then
  node "$HERE/browse-load.js" "$SEED" "$USERS" "$TOTAL" 15000 >"$PERF_DIR/$LABEL-browse.log" 2>&1 &
  started+=($!)
fi

sleep "$WARMUP"

if [ "$PROFILE" = "--profile" ]; then
  node "$HERE/cpu-profile.js" 9371 "$PERF_DIR/results/$LABEL.cpuprofile" \
    python3 -I "$HERE/cpu-sample.py" "$MINUTES" "$LABEL" --interval 30
else
  python3 -I "$HERE/cpu-sample.py" "$MINUTES" "$LABEL" --interval 30
fi

# Only the generators this script started.
for pid in "${started[@]}"; do
  kill "$pid" 2>/dev/null
done
wait 2>/dev/null

echo "load phase $LABEL done; what the generators sent:"
tail -n 1 "$PERF_DIR/$LABEL-otlp.log" "$PERF_DIR/$LABEL-heartbeats.log"
if [ "$USERS" != "0" ]; then
  tail -n 1 "$PERF_DIR/$LABEL-browse.log"
fi
