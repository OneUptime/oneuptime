"""Writes app.env and probe.env into $PERF_DIR for stack.sh.

The App's settings are config.example.env's, with production on
(ENVIRONMENT/NODE_ENV production, transpile-only ts-node, logs at ERROR as
config.example.env ships them) and pointed at the stack's own containers.
The Probe registers itself as the instance's global probe, with private
network monitors allowed (the load's targets are on the docker bridge).

Usage: python3 -I make_env.py [KEY=VALUE ...]   (extra lines for app.env)
Settings (environment): see stack.sh. PERF_PROBE_WORKERS (20) and
PERF_PROBE_FETCH_LIMIT (50) size the Probe like a big install's: compose
ships 5 and 10, which checks at most 50 monitors a minute.
"""

import hashlib
import os
import sys

REPO = os.environ.get("PERF_SOURCE") or os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
PERF_DIR = os.environ.get("PERF_DIR", "/tmp/oneuptime-perf")
APP_PORT = os.environ.get("PERF_APP_PORT", "3371")
PROBE_PORT = os.environ.get("PERF_PROBE_PORT", "3372")


def stack_value(purpose):
    """A value of this stack's own for `purpose`, the same on every run."""
    prefix = os.environ.get("PERF_PREFIX", "oneuptime-perf")
    return hashlib.sha256(f"{prefix}:{purpose}".encode("utf-8")).hexdigest()[:40]


# Not config.example.env's placeholders: the App refuses those for probes.
REGISTER_KEY = stack_value("register-probe")
PROBE_KEY = stack_value("global-probe-1")

OVERRIDES = {
    "HOST": "localhost:" + APP_PORT,
    "HTTP_PROTOCOL": "http",
    "ENVIRONMENT": "production",
    "NODE_ENV": "production",
    "DATABASE_HOST": "127.0.0.1",
    "DATABASE_PORT": os.environ.get("PERF_PG_PORT", "15371"),
    "VALKEY_HOST": "127.0.0.1",
    "VALKEY_PORT": os.environ.get("PERF_VALKEY_PORT", "16371"),
    "CLICKHOUSE_HOST": "127.0.0.1",
    "CLICKHOUSE_PORT": os.environ.get("PERF_CH_PORT", "18371"),
    "SERVER_APP_HOSTNAME": "127.0.0.1",
    "APP_PORT": APP_PORT,
    "PORT": APP_PORT,
    "BILLING_ENABLED": "false",
    "CAPTCHA_ENABLED": "false",
    "LOG_LEVEL": os.environ.get("PERF_LOG_LEVEL", "ERROR"),
    "DISABLE_UPDATE_CHECK": "true",
    "DISABLE_TELEMETRY": "true",
    "TS_NODE_TRANSPILE_ONLY": "1",
    "REGISTER_PROBE_KEY": REGISTER_KEY,
    "GLOBAL_PROBE_1_KEY": PROBE_KEY,
}

lines = []
seen = set()

with open(os.path.join(REPO, "config.example.env"), encoding="utf-8") as handle:
    for raw in handle:
        line = raw.rstrip("\n")
        if not line or line.startswith("#") or "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        if key in OVERRIDES:
            line = key + "=" + OVERRIDES[key]
        seen.add(key)
        lines.append(line)

for key, value in OVERRIDES.items():
    if key not in seen:
        lines.append(key + "=" + value)

lines.extend(sys.argv[1:])

os.makedirs(PERF_DIR, exist_ok=True)

with open(os.path.join(PERF_DIR, "app.env"), "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")

probe = {
    "ONEUPTIME_URL": "http://127.0.0.1:" + APP_PORT,
    "REGISTER_PROBE_KEY": REGISTER_KEY,
    "PROBE_NAME": "Probe-1",
    "PROBE_DESCRIPTION": "Global probe to monitor oneuptime resources",
    "PROBE_MONITORING_WORKERS": os.environ.get("PERF_PROBE_WORKERS", "20"),
    "PROBE_MONITOR_FETCH_LIMIT": os.environ.get("PERF_PROBE_FETCH_LIMIT", "50"),
    "PROBE_KEY": PROBE_KEY,
    "PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS": "60000",
    "PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS": "60000",
    "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS": "true",
    "BILLING_ENABLED": "false",
    "PORT": PROBE_PORT,
    "NODE_ENV": "production",
    "ENVIRONMENT": "production",
    "LOG_LEVEL": os.environ.get("PERF_LOG_LEVEL", "ERROR"),
    "DISABLE_TELEMETRY": "true",
    "ENABLE_PROFILING": "false",
    "TS_NODE_TRANSPILE_ONLY": "1",
    "HOST": "localhost:" + APP_PORT,
    "HTTP_PROTOCOL": "http",
}

with open(os.path.join(PERF_DIR, "probe.env"), "w", encoding="utf-8") as handle:
    for key, value in probe.items():
        handle.write(key + '="' + value + '"\n')

print("wrote", len(lines), "App settings and", len(probe), "Probe settings to", PERF_DIR)
