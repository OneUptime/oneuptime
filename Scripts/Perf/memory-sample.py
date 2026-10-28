"""The memory of the stack's processes and containers over a window.

Every interval it records, for the App and the Probe (their PIDs from
$PERF_DIR, children included), resident memory split into anonymous and
file-backed pages (/proc/<pid>/status), and for each "$PERF_PREFIX-*"
container (pg, ch, valkey, and app when the App runs as its image) its
cgroup's memory split the same way (memory.stat: anon is what the server
holds, file is page cache the kernel takes back when it needs it). It also reads ClickHouse's own accounting (MemoryTracking and the sizes
of its caches), Postgres's connections and Valkey's used_memory. With
--app-inspector PORT (the App started with
APP_NODE_FLAGS=--inspect=127.0.0.1:PORT), every --heap-every samples it runs
heap-snapshot.js for the App's live heap after a full garbage collection,
and at the end fits how fast that grows, in MB an hour.

Prints one line per interval and a summary, and writes both to
$PERF_DIR/results/<label>.memory.json.

Usage: python3 -I memory-sample.py <minutes> <label> [--interval SECONDS]
       [--app-inspector PORT] [--heap-every N]
"""

import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PERF_DIR = os.environ.get("PERF_DIR", "/tmp/oneuptime-perf")
PREFIX = os.environ.get("PERF_PREFIX", "oneuptime-perf")
CH_PORT = os.environ.get("PERF_CH_PORT", "18371")
PASSWORD = "please-change-this-to-random-value"
CONTAINERS = ["pg", "ch", "valkey", "app"]


def option(name, default):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


minutes = float(sys.argv[1])
label = sys.argv[2]
interval = float(option("--interval", "30"))
inspector = option("--app-inspector", None)
heap_every = int(option("--heap-every", "4"))


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


def process_memory(pid):
    """RSS, anonymous and file-backed resident MB of a process and its children."""
    totals = {"rss": 0, "anon": 0, "file": 0}
    keys = {"VmRSS:": "rss", "RssAnon:": "anon", "RssFile:": "file"}
    for each in descendants(pid):
        try:
            with open(f"/proc/{each}/status", encoding="utf-8") as handle:
                for line in handle:
                    parts = line.split()
                    if parts and parts[0] in keys:
                        totals[keys[parts[0]]] += int(parts[1])
        except OSError:
            pass
    return {key: round(value / 1024, 1) for key, value in totals.items()}


def container_memory(name):
    container_id = subprocess.run(
        ["docker", "inspect", "-f", "{{.Id}}", f"{PREFIX}-{name}"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
    if not container_id:
        return None
    base = f"/sys/fs/cgroup/system.slice/docker-{container_id}.scope"
    values = {}
    try:
        with open(f"{base}/memory.current", encoding="utf-8") as handle:
            values["current"] = round(int(handle.read().strip()) / 1048576, 1)
        with open(f"{base}/memory.stat", encoding="utf-8") as handle:
            for line in handle:
                key, value = line.split()
                if key in ("anon", "file", "kernel", "shmem", "sock"):
                    values[key] = round(int(value) / 1048576, 1)
    except OSError:
        return None
    return values


def clickhouse_memory():
    """ClickHouse's own accounting: tracked memory and its caches, in MB."""
    query = (
        "SELECT metric, value FROM system.asynchronous_metrics WHERE metric IN "
        "('MemoryResident', 'MarkCacheBytes', 'UncompressedCacheBytes', "
        "'PrimaryIndexCacheBytes', 'IndexMarkCacheBytes', 'IndexUncompressedCacheBytes', "
        "'MMapCacheCells', 'QueryCacheBytes', 'PageCacheBytes', 'jemalloc.resident', "
        "'jemalloc.allocated', 'CompiledExpressionCacheBytes', 'FilesystemCacheBytes') "
        "UNION ALL SELECT metric, toFloat64(value) FROM system.metrics WHERE metric = 'MemoryTracking' "
        "FORMAT TabSeparated"
    )
    request = urllib.request.Request(
        f"http://127.0.0.1:{CH_PORT}/",
        data=query.encode("utf-8"),
        headers={"X-ClickHouse-User": "default", "X-ClickHouse-Key": PASSWORD},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            text = response.read().decode("utf-8")
    except OSError:
        return None
    values = {}
    for line in text.splitlines():
        key, value = line.split("\t")
        number = float(value)
        values[key] = round(number / 1048576, 1) if key != "MMapCacheCells" else number
    return values


def postgres_connections():
    out = subprocess.run(
        [
            "docker", "exec", f"{PREFIX}-pg", "psql", "-U", "postgres", "-d", "oneuptimedb",
            "-At", "-c", "SELECT count(*), count(*) FILTER (WHERE state = 'idle') FROM pg_stat_activity WHERE backend_type = 'client backend'",
        ],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
    if "|" not in out:
        return None
    total, idle = out.split("|")
    return {"connections": int(total), "idle": int(idle)}


def valkey_memory():
    out = subprocess.run(
        ["docker", "exec", f"{PREFIX}-valkey", "valkey-cli", "-a", PASSWORD, "--no-auth-warning", "INFO", "memory"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    for line in out.splitlines():
        if line.startswith("used_memory:"):
            return round(int(line.split(":")[1]) / 1048576, 1)
    return None


def app_heap():
    """The App's live heap after a full garbage collection (heap-snapshot.js)."""
    out = subprocess.run(
        ["node", os.path.join(HERE, "heap-snapshot.js"), inspector],
        capture_output=True,
        text=True,
        check=False,
        timeout=300,
    ).stdout
    try:
        value = json.loads(out)
    except ValueError:
        return None
    return {key: value[key] for key in ("heapUsed", "external", "arrayBuffers", "rss")}


def sample(index):
    row = {"t": round(time.time() - started)}
    for name in ("app", "probe"):
        pid = read_pid(name)
        if pid is not None:
            row[name] = process_memory(pid)
    for name in CONTAINERS:
        value = container_memory(name)
        if value is not None:
            row["container_" + name] = value
    row["clickhouse"] = clickhouse_memory()
    row["postgres"] = postgres_connections()
    row["valkey_used"] = valkey_memory()
    if inspector and index % heap_every == 0:
        row["app_heap"] = app_heap()
    return row


def line(row):
    parts = [time.strftime("%H:%M:%S")]
    for name in ("app", "probe"):
        if name in row:
            parts.append(f"{name} rss {row[name]['rss']:.0f} (anon {row[name]['anon']:.0f})")
    for name in CONTAINERS:
        key = "container_" + name
        if key in row:
            parts.append(f"{name}-container anon {row[key].get('anon', 0):.0f} file {row[key].get('file', 0):.0f}")
    if row.get("app_heap"):
        parts.append(f"app heap {row['app_heap']['heapUsed']:.0f}")
    return "  ".join(parts)


def slope(points):
    """Least-squares MB an hour of (seconds, MB) points."""
    if len(points) < 2:
        return None
    n = len(points)
    mean_t = sum(t for t, _ in points) / n
    mean_v = sum(v for _, v in points) / n
    den = sum((t - mean_t) ** 2 for t, _ in points)
    if den == 0:
        return None
    return round(sum((t - mean_t) * (v - mean_v) for t, v in points) / den * 3600, 1)


started = time.time()
deadline = started + minutes * 60
rows = []
index = 0
while True:
    row = sample(index)
    rows.append(row)
    print(line(row), flush=True)
    index += 1
    if time.time() + interval > deadline:
        break
    time.sleep(max(0.0, interval - (time.time() - started - row["t"])))

summary = {"label": label, "seconds": round(time.time() - started)}
for name in ("app", "probe"):
    values = [row[name] for row in rows if name in row]
    if values:
        summary[name] = {
            "rss_first": values[0]["rss"],
            "rss_last": values[-1]["rss"],
            "rss_max": max(v["rss"] for v in values),
            "anon_last": values[-1]["anon"],
            "rss_mb_per_hour": slope([(row["t"], row[name]["rss"]) for row in rows if name in row]),
        }
for name in CONTAINERS:
    values = [row["container_" + name] for row in rows if "container_" + name in row]
    if values:
        summary[name + "_container"] = {
            "anon_last": values[-1].get("anon"),
            "anon_max": max(v.get("anon", 0) for v in values),
            "file_last": values[-1].get("file"),
            "current_last": values[-1].get("current"),
        }
heaps = [(row["t"], row["app_heap"]["heapUsed"]) for row in rows if row.get("app_heap")]
if heaps:
    summary["app_heap"] = {
        "first": heaps[0][1],
        "last": heaps[-1][1],
        "max": max(v for _, v in heaps),
        "mb_per_hour": slope(heaps),
    }
if rows[-1].get("clickhouse"):
    summary["clickhouse_last"] = rows[-1]["clickhouse"]
if rows[-1].get("postgres"):
    summary["postgres_last"] = rows[-1]["postgres"]
summary["valkey_used_last"] = rows[-1].get("valkey_used")

print("--- " + label + ": " + json.dumps(summary, indent=1))
os.makedirs(os.path.join(PERF_DIR, "results"), exist_ok=True)
with open(os.path.join(PERF_DIR, "results", label + ".memory.json"), "w", encoding="utf-8") as handle:
    json.dump({"summary": summary, "rows": rows}, handle, indent=1)
