"""CPU (and memory) of the stack's processes and containers over a window.

Reads the App's and the Probe's PIDs from $PERF_DIR (stack.sh writes them)
and their CPU and resident memory, children included, from /proc; and each
container's "$PERF_PREFIX-*" CPU and memory from its cgroup (cgroup v2).
Prints one line per interval, then the totals in CPU seconds and in percent
of one core with the memory at the end, and what Postgres did in the window
(statements committed, rows read, and the tables read most, from
pg_stat_database and pg_stat_user_tables), and writes them to
$PERF_DIR/results/<label>.json.

Usage: python3 -I cpu-sample.py <minutes> <label> [--interval SECONDS]
"""

import json
import os
import subprocess
import sys
import time

PERF_DIR = os.environ.get("PERF_DIR", "/tmp/oneuptime-perf")
PREFIX = os.environ.get("PERF_PREFIX", "oneuptime-perf")
CONTAINERS = ["pg", "ch", "valkey"]
TICKS = os.sysconf(os.sysconf_names["SC_CLK_TCK"])

minutes = float(sys.argv[1])
label = sys.argv[2]
interval = 30.0
if "--interval" in sys.argv:
    interval = float(sys.argv[sys.argv.index("--interval") + 1])


def read_pid(name):
    path = os.path.join(PERF_DIR, name + ".pid")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return int(handle.read().strip())


def descendants(pid):
    found = [pid]
    out = subprocess.run(
        ["ps", "-o", "pid=", "--ppid", str(pid)],
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    for child in out.split():
        found.extend(descendants(int(child)))
    return found


def process_cpu(pid):
    total = 0.0
    for each in descendants(pid):
        try:
            with open(f"/proc/{each}/stat", encoding="utf-8") as handle:
                fields = handle.read().rsplit(")", 1)[1].split()
            total += (int(fields[11]) + int(fields[12])) / TICKS
        except OSError:
            pass
    return total


def process_memory_mb(pid):
    total = 0
    for each in descendants(pid):
        try:
            with open(f"/proc/{each}/status", encoding="utf-8") as handle:
                for line in handle:
                    if line.startswith("VmRSS:"):
                        total += int(line.split()[1])
        except OSError:
            pass
    return total / 1024


def container_id_of(name):
    return subprocess.run(
        ["docker", "inspect", "-f", "{{.Id}}", f"{PREFIX}-{name}"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()


def container_memory_mb(name):
    container_id = container_id_of(name)
    if not container_id:
        return None
    path = f"/sys/fs/cgroup/system.slice/docker-{container_id}.scope/memory.current"
    try:
        with open(path, encoding="utf-8") as handle:
            return int(handle.read().strip()) / 1024 / 1024
    except OSError:
        return None


def memory():
    values = {}
    for name in ("app", "probe"):
        pid = read_pid(name)
        if pid is not None:
            values[name] = process_memory_mb(pid)
    for name in CONTAINERS:
        value = container_memory_mb(name)
        if value is not None:
            values[name] = value
    return values


def postgres_counters():
    """Postgres's own counters: the database's and each table's reads."""
    query = (
        "SELECT 'db', xact_commit, tup_returned, tup_fetched, blks_hit + blks_read, 0 "
        "FROM pg_stat_database WHERE datname = current_database() "
        "UNION ALL SELECT relname, seq_scan, seq_tup_read, COALESCE(idx_scan, 0), "
        "COALESCE(idx_tup_fetch, 0), n_tup_ins + n_tup_upd + n_tup_del FROM pg_stat_user_tables"
    )
    out = subprocess.run(
        ["docker", "exec", f"{PREFIX}-pg", "psql", "-U", "postgres", "-d", "oneuptimedb", "-At", "-F", "\t", "-c", query],
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    counters = {}
    for line in out.splitlines():
        fields = line.split("\t")
        if len(fields) == 6:
            counters[fields[0]] = [int(value) for value in fields[1:]]
    return counters


def postgres_delta(before, after):
    if "db" not in before or "db" not in after:
        return None
    db = [b - a for a, b in zip(before["db"], after["db"])]
    tables = []
    for name, values in after.items():
        if name == "db" or name not in before:
            continue
        seq_scan, seq_rows, idx_scan, idx_rows, written = [
            b - a for a, b in zip(before[name], values)
        ]
        if seq_rows + idx_rows + written > 0:
            tables.append(
                {
                    "table": name,
                    "seq_scans": seq_scan,
                    "seq_rows_read": seq_rows,
                    "index_scans": idx_scan,
                    "index_rows_fetched": idx_rows,
                    "rows_written": written,
                }
            )
    tables.sort(key=lambda row: row["seq_rows_read"] + row["index_rows_fetched"], reverse=True)
    return {
        "commits": db[0],
        "rows_returned": db[1],
        "rows_fetched": db[2],
        "blocks_touched": db[3],
        "tables": tables[:20],
    }


def container_cpu(name):
    container_id = subprocess.run(
        ["docker", "inspect", "-f", "{{.Id}}", f"{PREFIX}-{name}"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
    if not container_id:
        return None
    path = f"/sys/fs/cgroup/system.slice/docker-{container_id}.scope/cpu.stat"
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                key, value = line.split()
                if key == "usage_usec":
                    return int(value) / 1e6
    except OSError:
        return None
    return None


def snapshot():
    values = {}
    for name in ("app", "probe"):
        pid = read_pid(name)
        if pid is not None:
            values[name] = process_cpu(pid)
    for name in CONTAINERS:
        value = container_cpu(name)
        if value is not None:
            values[name] = value
    return values


postgres_start = postgres_counters()
start = snapshot()
started = time.time()
previous, previous_time = dict(start), started
rows = []
deadline = started + minutes * 60
memory_max = memory()

while time.time() < deadline:
    time.sleep(max(0.0, min(interval, deadline - time.time())))
    now = time.time()
    current = snapshot()
    row = {"t": round(now - started)}
    parts = []
    for key, value in current.items():
        if key in previous:
            percent = (value - previous[key]) / (now - previous_time) * 100
            row[key] = round(percent, 1)
            parts.append(f"{key} {percent:5.1f}%")
    for key, value in memory().items():
        memory_max[key] = max(memory_max.get(key, 0), value)
    rows.append(row)
    print(time.strftime("%H:%M:%S") + " " + "  ".join(parts), flush=True)
    previous, previous_time = current, now

elapsed = time.time() - started
end = snapshot()
memory_end = memory()
postgres = postgres_delta(postgres_start, postgres_counters())
summary = {"label": label, "seconds": round(elapsed), "totals": {}, "rows": rows}
print(f"--- {label}: {elapsed:.0f} s")
for key, value in end.items():
    if key in start:
        used = value - start[key]
        summary["totals"][key] = {
            "cpu_seconds": round(used, 2),
            "percent_of_core": round(used / elapsed * 100, 2),
            "memory_mb_end": round(memory_end.get(key, 0)),
            "memory_mb_max": round(max(memory_max.get(key, 0), memory_end.get(key, 0))),
        }
        print(
            f"{key:8s} {used:8.1f} cpu-s  {used / elapsed * 100:6.2f}% of a core  "
            f"{memory_end.get(key, 0):7.0f} MB at the end"
        )

if postgres is not None:
    summary["postgres"] = postgres
    print(
        f"postgres: {postgres['commits'] / elapsed:.0f} commits/s, "
        f"{postgres['rows_returned'] / elapsed:.0f} rows returned/s, "
        f"{postgres['blocks_touched'] / elapsed:.0f} blocks/s; read most: "
        + ", ".join(
            f"{row['table']} {(row['seq_rows_read'] + row['index_rows_fetched']) / elapsed:.0f}/s"
            for row in postgres["tables"][:4]
        )
    )

os.makedirs(os.path.join(PERF_DIR, "results"), exist_ok=True)
with open(os.path.join(PERF_DIR, "results", label + ".json"), "w", encoding="utf-8") as handle:
    json.dump(summary, handle, indent=1)
