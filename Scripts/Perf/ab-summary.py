"""Prints ab-stack.sh's results side by side: for each phase (idle, load) and
process, the percent of one core each side used in each round, the mean of
the rounds and the change from the baseline to the branch; then the memory
each process held at the end of its windows (mean of the rounds).

Usage: python3 -I ab-summary.py [resultsDir]   (default $PERF_DIR/results)
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
LABEL = re.compile(r"^ab-r(\d+)-([a-z0-9]+)-(idle|load)\.json$")
ORDER = ["app", "probe", "pg", "ch", "valkey"]

cpu = {}
memory = {}
sides = []

for name in sorted(os.listdir(RESULTS)):
    match = LABEL.match(name)
    if not match:
        continue
    round_number, side, phase = int(match.group(1)), match.group(2), match.group(3)
    if side not in sides:
        sides.append(side)
    with open(os.path.join(RESULTS, name), encoding="utf-8") as handle:
        totals = json.load(handle)["totals"]
    for process, value in totals.items():
        cpu.setdefault(phase, {}).setdefault(process, {}).setdefault(side, {})[
            round_number
        ] = value["percent_of_core"]
        if "memory_mb_end" in value:
            memory.setdefault(phase, {}).setdefault(process, {}).setdefault(side, {})[
                round_number
            ] = value["memory_mb_end"]

if not cpu:
    print("no ab-r<round>-<side>-<phase>.json files in", RESULTS)
    sys.exit(1)

# The side compared against first: the baseline.
sides.sort(key=lambda side: 0 if side in ("baseline", "master") else 1)


def ordered(processes):
    return sorted(processes, key=lambda key: ORDER.index(key) if key in ORDER else len(ORDER))


def mean(values):
    return sum(values) / len(values)


for phase in ("idle", "load"):
    if phase not in cpu:
        continue
    print(f"{phase}: percent of one core (rounds; mean)")
    for process in ordered(cpu[phase]):
        means = []
        parts = []
        for side in sides:
            rounds = cpu[phase][process].get(side, {})
            if not rounds:
                continue
            values = [rounds[number] for number in sorted(rounds)]
            means.append(mean(values))
            listed = " ".join(f"{value:.2f}" for value in values)
            parts.append(f"{side} {listed} ({means[-1]:.2f})")
        change = ""
        if len(means) == 2 and means[0] > 0:
            change = f"  {(means[1] - means[0]) / means[0] * 100:+.1f}%"
        print(f"  {process:7s} " + "  ".join(parts) + change)
    if phase in memory:
        parts = []
        for process in ordered(memory[phase]):
            by_side = []
            for side in sides:
                rounds = memory[phase][process].get(side, {})
                if rounds:
                    by_side.append(f"{side} {mean(list(rounds.values())):.0f}")
            parts.append(f"{process} " + " / ".join(by_side))
        print("  memory at the end, MB: " + "; ".join(parts))
