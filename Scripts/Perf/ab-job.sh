#!/bin/bash
# A/B of what named Worker jobs cost per run (job-cost.js): the baseline
# (make-baseline.sh) and this checkout in turn, <rounds> times each, each
# run of job-cost.js running only the jobs whose names hold one of the
# comma-separated <names> (case-insensitive), <runs> times each, against the
# running stack's data. Minutes instead of the twenty and more a whole
# job-cost.js run takes; ab-job-summary.py then prints every job's CPU and
# Postgres, ClickHouse and Valkey calls per run, side by side.
#
# The jobs do here what they do in production (send notifications, delete
# rows): run it only against a stack of this kit's, seeded with seed.js.
#
# Usage: ab-job.sh <names> <runs> <rounds> [baseline]
#        (default baseline: $PERF_DIR/baseline)
#        e.g. ab-job.sh AIInsight:ScanForInsights,Incident 3 2
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PERF_DIR="${PERF_DIR:-/tmp/oneuptime-perf}"
NAMES="$1"
RUNS="$2"
ROUNDS="$3"
BASELINE="${4:-$PERF_DIR/baseline}"
RESULTS="$PERF_DIR/results/ab-job"

mkdir -p "$RESULTS"
rm -f "$RESULTS"/ab-job-r*-*.json

for round in $(seq 1 "$ROUNDS"); do
  for side in baseline branch; do
    if [ "$side" = "baseline" ]; then
      source="$BASELINE"
    else
      source="$REPO"
    fi
    out="$RESULTS/ab-job-r$round-$side.json"
    echo "round $round $side"
    PERF_SOURCE="$source" bash "$HERE/in-app.sh" "$HERE/job-cost.js" "$RUNS" "$out" "$NAMES" 2>&1 |
      grep -E "ms/run|jobs:" | sed "s/^/  /"
  done
done

python3 -I "$HERE/ab-job-summary.py" "$RESULTS"
