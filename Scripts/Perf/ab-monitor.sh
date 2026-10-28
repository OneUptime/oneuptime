#!/bin/bash
# A/B of one monitor check's cost (monitor-cost.js): the baseline
# (make-baseline.sh) and this checkout in turn, <rounds> times each, the
# same kind and number of calls, against the running stack's data.
#
# Usage: ab-monitor.sh <heartbeat|probe> <calls> <rounds> [baseline]
#        (default baseline: $PERF_DIR/baseline)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PERF_DIR="${PERF_DIR:-/tmp/oneuptime-perf}"
KIND="$1"
CALLS="$2"
ROUNDS="$3"
BASELINE="${4:-$PERF_DIR/baseline}"

for round in $(seq 1 "$ROUNDS"); do
  for side in baseline branch; do
    if [ "$side" = "baseline" ]; then
      source="$BASELINE"
    else
      source="$REPO"
    fi
    line=$(PERF_SOURCE="$source" bash "$HERE/in-app.sh" "$HERE/monitor-cost.js" "$KIND" "$CALLS" 2>&1 | grep "calls: cpu")
    echo "round $round $side: $line"
  done
done
