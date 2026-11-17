#!/bin/bash
# A/B of telemetry ingest: the baseline (make-baseline.sh) and this checkout
# in turn, <rounds> times each, under otlp-load.js's OTLP load, the Probe
# stopped. Each round, per side:
#
#   - steady: the kit's load (20 collectors every <steadyPeriodMs>, 15
#     batches a second at 4000), sampled <minutes> after 2 minutes of it:
#     cpu-sample.py for the CPU of the App and the datastores, ingest-queue.js
#     for the jobs' run times, ClickHouse's part log for the parts its
#     inserts made and merged;
#   - burst: 20 collectors every <burstPeriodMs> for <burstSeconds>, more than
#     one App may keep up with, ingest-queue.js counting how many batches a
#     second it finished, then the time it took to work off what was left.
#
# The load average is printed at the start and end of each window. Sides
# alternate, so slow drift (data growing, the machine's other work) favours
# neither.
#
# Usage: ab-ingest.sh <seed.json> [rounds] [minutes] [steadyPeriodMs]
#                     [burstPeriodMs] [burstSeconds] [baseline]
#        (defaults: 2 rounds, 4 minutes, 4000, 1000, 90, $PERF_DIR/baseline)
# Results: $PERF_DIR/results/ingest-r<round>-<side>-steady.json (cpu-sample),
# -steady-queue.json and -burst-queue.json (ingest-queue.js), and
# ingest-r<round>-<side>.txt (load averages, drain time); ab-ingest-summary.py
# prints them side by side.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PERF_DIR="${PERF_DIR:-/tmp/oneuptime-perf}"
SEED="$1"
ROUNDS="${2:-2}"
MINUTES="${3:-4}"
STEADY_PERIOD="${4:-4000}"
BURST_PERIOD="${5:-1000}"
BURST_SECONDS="${6:-90}"
BASELINE="${7:-$PERF_DIR/baseline}"
RESULTS="$PERF_DIR/results"
mkdir -p "$RESULTS"

source_of() {
  if [ "$1" = "baseline" ]; then
    echo "$BASELINE"
  else
    echo "$REPO"
  fi
}

load_average() {
  cut -d' ' -f1-3 /proc/loadavg
}

backlog() {
  docker exec "${PERF_PREFIX:-oneuptime-perf}-valkey" valkey-cli \
    -a please-change-this-to-random-value --no-auth-warning \
    llen bull:Telemetry:wait 2>/dev/null || echo 0
}

# ClickHouse's new parts and merges between two UTC times: every insert
# writes a part (and one more for each materialized view it feeds), and the
# merges write them all again - the ClickHouse CPU an insert rate costs.
parts_between() {
  local ch="${PERF_PREFIX:-oneuptime-perf}-ch"
  docker exec "$ch" clickhouse-client --password please-change-this-to-random-value \
    -q "SYSTEM FLUSH LOGS" >/dev/null 2>&1
  docker exec "$ch" clickhouse-client --password please-change-this-to-random-value \
    -q "SELECT countIf(event_type = 'NewPart'), countIf(event_type = 'MergeParts') FROM system.part_log WHERE event_time BETWEEN '$1' AND '$2'" \
    2>/dev/null | tr '\t' ' '
}

for round in $(seq 1 "$ROUNDS"); do
  for side in baseline branch; do
    label="ingest-r$round-$side"
    notes="$RESULTS/$label.txt"
    echo "=== $label ($(date -u +%H:%M:%S))"
    bash "$HERE/stack.sh" probe-stop >/dev/null
    PERF_SOURCE="$(source_of "$side")" bash "$HERE/stack.sh" app-restart >/dev/null
    bash "$HERE/stack.sh" wait-ready || exit 1

    # Steady load: CPU, and how long each job ran.
    node "$HERE/otlp-load.js" "$SEED" $((MINUTES + 3)) 20 "$STEADY_PERIOD" \
      >"$PERF_DIR/$label-steady-otlp.log" 2>&1 &
    loader=$!
    sleep 120
    echo "steady load average at start: $(load_average)" | tee "$notes"
    steady_start="$(date -u '+%F %T')"
    node "$HERE/ingest-queue.js" $((MINUTES * 60)) 10 "$RESULTS/$label-steady-queue.json" \
      >/dev/null 2>&1 &
    queue=$!
    python3 -I "$HERE/cpu-sample.py" "$MINUTES" "$label-steady" --interval 30 | tail -n 6
    wait "$queue"
    steady_end="$(date -u '+%F %T')"
    echo "steady load average at end: $(load_average)" | tee -a "$notes"
    echo "steady ClickHouse parts (new, merged): $(parts_between "$steady_start" "$steady_end")" |
      tee -a "$notes"
    kill "$loader" 2>/dev/null
    wait "$loader" 2>/dev/null

    # Let the steady load's jobs finish before the burst counts its own.
    for _ in $(seq 1 60); do
      if [ "$(backlog)" = "0" ]; then break; fi
      sleep 2
    done

    # Burst: how many batches a second one App finishes.
    echo "burst load average at start: $(load_average)" | tee -a "$notes"
    node "$HERE/otlp-load.js" "$SEED" 60 20 "$BURST_PERIOD" \
      >"$PERF_DIR/$label-burst-otlp.log" 2>&1 &
    loader=$!
    node "$HERE/ingest-queue.js" "$BURST_SECONDS" 10 "$RESULTS/$label-burst-queue.json" \
      | tail -n 3
    kill "$loader" 2>/dev/null
    wait "$loader" 2>/dev/null
    echo "burst load average at end: $(load_average)" | tee -a "$notes"

    # How long the rest of the burst took to work off.
    drain_start=$(date +%s)
    left=$(backlog)
    while [ "$(backlog)" != "0" ] && [ $(($(date +%s) - drain_start)) -lt 900 ]; do
      sleep 2
    done
    echo "burst backlog $left drained in $(($(date +%s) - drain_start)) s" | tee -a "$notes"
  done
done

echo "ab-ingest done ($(date -u +%H:%M:%S))"
python3 -I "$HERE/ab-ingest-summary.py" "$RESULTS"
