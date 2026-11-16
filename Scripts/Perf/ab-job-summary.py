"""Prints ab-job.sh's results side by side: for each job, the CPU of one run
(milliseconds) each side took in each round, the mean of the rounds and the
change from the baseline to the branch, then the Postgres, ClickHouse and
Valkey calls of one run on each side (the last round's: they do not drift).

Usage: python3 -I ab-job-summary.py [resultsDir]
       (default $PERF_DIR/results/ab-job)
"""

import json
import os
import re
import sys

RESULTS = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.path.join(
        os.environ.get("PERF_DIR", "/tmp/oneuptime-perf"), "results", "ab-job"
    )
)
LABEL = re.compile(r"^ab-job-r(\d+)-([a-z0-9]+)\.json$")

# runs[job][side][round] = the row job-cost.js wrote for it.
runs = {}
sides = []

for name in sorted(os.listdir(RESULTS)):
    match = LABEL.match(name)
    if not match:
        continue
    round_number, side = int(match.group(1)), match.group(2)
    if side not in sides:
        sides.append(side)
    with open(os.path.join(RESULTS, name), encoding="utf-8") as handle:
        rows = json.load(handle)
    for row in rows:
        runs.setdefault(row["name"], {}).setdefault(side, {})[round_number] = row

if not runs:
    print("no ab-job-r<round>-<side>.json files in", RESULTS)
    sys.exit(1)

# The side compared against first: the baseline.
sides.sort(key=lambda side: 0 if side in ("baseline", "main", "master") else 1)


def mean(values):
    return sum(values) / len(values) if values else 0.0


def calls(row):
    if not row:
        return "-"
    return "pg %s ch %s valkey %s" % (row["pg"], row["ch"], row["valkey"])


for job in sorted(runs):
    by_side = runs[job]
    means = {}
    print(job)
    for side in sides:
        rounds = by_side.get(side, {})
        cpu = [rounds[number]["cpuMs"] for number in sorted(rounds)]
        means[side] = mean(cpu)
        last = rounds[max(rounds)] if rounds else None
        errors = sorted(
            {rounds[number]["error"] for number in rounds if rounds[number].get("error")}
        )
        print(
            "  %-9s %s ms/run (mean %.1f)  %s%s"
            % (
                side,
                ", ".join("%.1f" % value for value in cpu) or "-",
                means[side],
                calls(last),
                ("  error: " + "; ".join(errors)) if errors else "",
            )
        )
    if len(sides) == 2 and means[sides[0]] > 0:
        change = (means[sides[1]] - means[sides[0]]) / means[sides[0]] * 100
        print("  change    %+.0f%%" % change)
