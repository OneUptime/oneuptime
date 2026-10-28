#!/bin/bash
# A/B of the whole stack: the baseline (make-baseline.sh) and this checkout
# in turn, <rounds> times each, against the same containers and seed.
#
# First every idle round: restart the App from that side's source, wait for
# it, warm up 4 minutes (JIT, caches, every job's first runs), sample
# <idleMinutes> with no Probe and no traffic. Then every load round: restart
# the App and the Probe from that side's source and sample <loadMinutes> of
# steady load after 2 minutes of it (load-phase.sh: the Probe's checks,
# heartbeats, OTLP from 20 collectors, 5 people on the Dashboard).
#
# Idle rounds come first because a load leaves work behind for minutes
# (ClickHouse merging what was inserted, jobs going over new rows), which an
# idle window after it would count; alternating sides keeps that, and slow
# drift (data growing, the machine's other work), from favouring either.
#
# Usage: ab-stack.sh <seed.json> <idleMinutes> <loadMinutes> [rounds] [baseline]
#        (defaults: 2 rounds, $PERF_DIR/baseline)
# Results: $PERF_DIR/results/ab-r<round>-<side>-idle.json and -load.json;
# ab-summary.py prints them side by side.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PERF_DIR="${PERF_DIR:-/tmp/oneuptime-perf}"
SEED="$1"
IDLE="$2"
LOAD="$3"
ROUNDS="${4:-2}"
BASELINE="${5:-$PERF_DIR/baseline}"

source_of() {
  if [ "$1" = "baseline" ]; then
    echo "$BASELINE"
  else
    echo "$REPO"
  fi
}

for round in $(seq 1 "$ROUNDS"); do
  for side in baseline branch; do
    label="ab-r$round-$side-idle"
    echo "=== $label ($(date -u +%H:%M:%S))"
    bash "$HERE/stack.sh" probe-stop >/dev/null
    PERF_SOURCE="$(source_of "$side")" bash "$HERE/stack.sh" app-restart >/dev/null
    bash "$HERE/stack.sh" wait-ready || exit 1
    sleep 240
    python3 -I "$HERE/cpu-sample.py" "$IDLE" "$label" --interval 60 | tail -n 6
  done
done

for round in $(seq 1 "$ROUNDS"); do
  for side in baseline branch; do
    label="ab-r$round-$side-load"
    echo "=== $label ($(date -u +%H:%M:%S))"
    bash "$HERE/stack.sh" probe-stop >/dev/null
    PERF_SOURCE="$(source_of "$side")" bash "$HERE/stack.sh" app-restart >/dev/null
    bash "$HERE/stack.sh" wait-ready || exit 1
    PERF_SOURCE="$(source_of "$side")" bash "$HERE/stack.sh" probe-restart >/dev/null
    bash "$HERE/load-phase.sh" "$SEED" "$label" "$LOAD" 120 20 5 | tail -n 12
  done
done

bash "$HERE/stack.sh" probe-stop >/dev/null
echo "ab-stack done ($(date -u +%H:%M:%S))"
python3 -I "$HERE/ab-summary.py" "$PERF_DIR/results"
