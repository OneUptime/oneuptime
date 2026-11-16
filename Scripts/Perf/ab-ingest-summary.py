"""Prints ab-ingest.sh's results side by side, round by round: under the
steady load the percent of one core the App and each datastore used, the
batches a second the App finished and how long its OTLP jobs ran (median of
the windows' p50 and p90); under the burst the batches a second it finished
and how long the rest took to work off; and the load average at the start
and end of each window. Then each side's mean, and the change from the
baseline to the branch.

Usage: python3 -I ab-ingest-summary.py [resultsDir]   (default $PERF_DIR/results)
"""

import json
import os
import re
import sys

RESULTS = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.path.join(os.environ.get("PERF_DIR", "/tmp/oneuptime-perf"), "results")
)
LABEL = re.compile(r"^ingest-r(\d+)-([a-z0-9]+)\.txt$")


def read_json(name):
    path = os.path.join(RESULTS, name)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def median(values):
    values = sorted(value for value in values if value is not None)
    if not values:
        return None
    return values[len(values) // 2]


def queue_summary(samples):
    if not samples:
        return None
    return {
        "per_second": sum(sample["completed"] for sample in samples)
        / (10 * len(samples)),
        "run_p50": median(sample["runMs"]["p50"] for sample in samples),
        "run_p90": median(sample["runMs"]["p90"] for sample in samples),
        "backlog_end": samples[-1]["backlog"],
    }


rounds = []
for name in sorted(os.listdir(RESULTS)):
    match = LABEL.match(name)
    if not match:
        continue
    round_number, side = int(match.group(1)), match.group(2)
    label = f"ingest-r{round_number}-{side}"
    with open(os.path.join(RESULTS, name), encoding="utf-8") as handle:
        notes = handle.read()
    loads = dict(re.findall(r"^(\w+ load average at \w+): (.+)$", notes, re.M))
    drained = re.search(r"backlog (\d+) drained in (\d+) s", notes)
    cpu = read_json(f"{label}-steady.json")
    rounds.append(
        {
            "round": round_number,
            "side": side,
            "cpu": cpu["totals"] if cpu else {},
            "steady": queue_summary(read_json(f"{label}-steady-queue.json")),
            "burst": queue_summary(read_json(f"{label}-burst-queue.json")),
            "loads": loads,
            "drain": (int(drained.group(1)), int(drained.group(2))) if drained else None,
        }
    )

if not rounds:
    print("no ingest-r<round>-<side>.txt files in", RESULTS)
    sys.exit(1)

rounds.sort(key=lambda entry: (entry["round"], 0 if entry["side"] == "baseline" else 1))


def percent(entry, process):
    value = entry["cpu"].get(process)
    return f"{value['percent_of_core']:.1f}" if value else "-"


def number(value, digits=0):
    return "-" if value is None else f"{value:.{digits}f}"


print("Steady load: percent of one core, batches a second, OTLP job run time (ms)")
print("| round | side | App | ClickHouse | Valkey | Postgres | batches/s | job p50 | job p90 | load avg start | load avg end |")
print("|---|---|---|---|---|---|---|---|---|---|---|")
for entry in rounds:
    steady = entry["steady"] or {}
    print(
        f"| {entry['round']} | {entry['side']} | {percent(entry, 'app')} | {percent(entry, 'ch')} | "
        f"{percent(entry, 'valkey')} | {percent(entry, 'pg')} | {number(steady.get('per_second'), 1)} | "
        f"{number(steady.get('run_p50'))} | {number(steady.get('run_p90'))} | "
        f"{entry['loads'].get('steady load average at start', '-')} | {entry['loads'].get('steady load average at end', '-')} |"
    )

print()
print("Burst: batches a second finished, what was left and how long it took to work off")
print("| round | side | batches/s | job p50 (ms) | backlog at the end | worked off in (s) | load avg start | load avg end |")
print("|---|---|---|---|---|---|---|---|")
for entry in rounds:
    burst = entry["burst"] or {}
    drain = entry["drain"] or (None, None)
    print(
        f"| {entry['round']} | {entry['side']} | {number(burst.get('per_second'), 1)} | {number(burst.get('run_p50'))} | "
        f"{number(drain[0])} | {number(drain[1])} | {entry['loads'].get('burst load average at start', '-')} | "
        f"{entry['loads'].get('burst load average at end', '-')} |"
    )


def mean_of(side, pick):
    values = [pick(entry) for entry in rounds if entry["side"] == side]
    values = [value for value in values if value is not None]
    return sum(values) / len(values) if values else None


print()
print("Means: baseline -> branch (change)")
for name, pick in (
    ("App, % of a core (steady)", lambda e: e["cpu"].get("app", {}).get("percent_of_core")),
    ("ClickHouse, % of a core (steady)", lambda e: e["cpu"].get("ch", {}).get("percent_of_core")),
    ("job p50 ms (steady)", lambda e: (e["steady"] or {}).get("run_p50")),
    ("batches/s (burst)", lambda e: (e["burst"] or {}).get("per_second")),
):
    before, after = mean_of("baseline", pick), mean_of("branch", pick)
    if before is None or after is None:
        continue
    change = (after - before) / before * 100 if before else 0
    print(f"  {name}: {before:.1f} -> {after:.1f} ({change:+.0f}%)")
