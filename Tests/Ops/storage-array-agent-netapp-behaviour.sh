#!/usr/bin/env bash
#
# Run the Storage Array Agent's NetApp ONTAP chain from
# agents/StorageArrayAgent/docker-compose.yml - the netapp-harvest service
# (NetApp Harvest, profile netapp-ontap, with the shipped netapp-harvest.yml
# and netapp-harvest-{rest,keyperf,restperf}.yaml) and the collector running
# otel-collector-config.netapp-ontap.yaml - against a stand-in ONTAP cluster,
# and check what the agent sends OneUptime.
#
# Why this exists (#11001): OneUptime reads NetApp ONTAP through Harvest, so
# what reaches it is what Harvest makes of the cluster's REST API: series
# named and labelled by Harvest's templates and plugins, rates computed by
# its KeyPerf and RestPerf collectors, EMS events exported its way, and an
# object it could not read reported in its own metadata series. None of that
# is in the agent's files, and no ONTAP is reachable from CI, so this runs the
# real Harvest image against Tests/Ops/Fixtures/NetAppOntap/fake-ontap.js,
# which answers every endpoint the shipped templates read, shaped as ONTAP's
# REST API reference and Harvest's testdata shape them. Two scenarios: an
# ONTAP 9.16.1 AFF HA pair with a broken disk, a failed shelf power supply, a
# port down, an unhealthy SnapMirror relationship and EMS events, and an
# Amazon FSx for NetApp ONTAP file system, where fsxadmin is refused what
# Amazon does not let it read (HTTP 403).
#
# The test .env is quoted by install.sh's own compose_env_quote, and the
# cluster password is O'ne "up" #time: \ $HOME: the stand-in logs whether the
# Basic credentials Harvest sent are exactly the ones configured, so the run
# proves the password survives .env, Compose and Harvest's ${VAR} expansion.
#
# The only change to the shipped files: the collector scrapes Harvest every
# 10 seconds instead of 60 (scrape_timeout 9s instead of 50s), so a run takes
# minutes. Harvest runs its shipped schedules. The compose override adds the
# stand-in cluster (on the node image) and an OTLP sink (the collector image,
# writing what it receives as JSON), and names the agent's collector
# container after the run, so an agent installed on the machine is left alone.
#
# With --record <dir> it runs the shipped files unmodified instead, and saves
# Harvest's own /metrics at the moments
# packages/Common/Tests/Fixtures/NetAppHarvest/26.11.0/README.md describes:
# ontap.prom, ontap-ems-cleared.prom, ontap-ems-after.prom and fsx.prom.
#
# Needs docker (with Compose v2), openssl and node.
# Usage: bash Tests/Ops/storage-array-agent-netapp-behaviour.sh [--record <dir>]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_DIR="${REPO_ROOT}/agents/StorageArrayAgent"
FAKE_ONTAP="${REPO_ROOT}/Tests/Ops/Fixtures/NetAppOntap/fake-ontap.js"
# Warmed by the Ops workflow before the real-Docker tests run.
NODE_IMAGE="public.ecr.aws/docker/library/node:26-alpine3.24"
RUN_ID="storage-array-netapp-$$"
SHIPPED_FILES=(
  docker-compose.yml
  netapp-harvest.yml
  netapp-harvest-rest.yaml
  netapp-harvest-keyperf.yaml
  netapp-harvest-restperf.yaml
  otel-collector-config.netapp-ontap.yaml
)
# Every quoting rule between .env and the cluster: a single quote (so
# compose_env_quote double-quotes it), double quotes, " #" (a comment in an
# unquoted value), ": " (YAML), a backslash and a $ (interpolation).
PASSWORD=$'O\'ne "up" #time: \\ $HOME'

RECORD_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --record)
      RECORD_DIR="${2:?--record needs a directory}"
      shift 2
      ;;
    *)
      echo "usage: $0 [--record <dir>]" >&2
      exit 2
      ;;
  esac
done

WORK_DIR="$(mktemp -d)"
chmod 0755 "${WORK_DIR}"
SCENARIO=""

compose() {
  docker compose -p "${RUN_ID}" --project-directory "${WORK_DIR}" \
    -f "${WORK_DIR}/docker-compose.yml" -f "${WORK_DIR}/docker-compose.override.yml" "$@"
}

fake_log() {
  compose logs --no-log-prefix fake-ontap 2>/dev/null
}

harvest_log() {
  compose logs --no-log-prefix netapp-harvest 2>/dev/null
}

dump_logs() {
  [ -f "${WORK_DIR}/docker-compose.override.yml" ] || return 0
  if [ -s "${WORK_DIR}/check.out" ]; then
    echo "---- what the sink is missing"
    cat "${WORK_DIR}/check.out"
  fi
  echo "---- fake-ontap (${SCENARIO})"
  fake_log | tail -n 60 || true
  echo "---- netapp-harvest"
  harvest_log | grep -v 'msg=Collected' | tail -n 60 || true
  echo "---- collector"
  compose logs --no-log-prefix oneuptime-storage-array-agent 2>&1 | tail -n 30 || true
  echo "---- otlp-sink"
  compose logs --no-log-prefix otlp-sink 2>&1 | tail -n 15 || true
}

cleanup() {
  if [ -f "${WORK_DIR}/docker-compose.override.yml" ]; then
    compose down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1"
  dump_logs
  exit 1
}

wait_for() {
  local what="$1" limit="$2" started=$SECONDS
  shift 2
  until "$@"; do
    if ((SECONDS - started > limit)); then
      fail "${what} (waited ${limit}s)"
    fi
    sleep 2
  done
  echo "ok: ${what} ($((SECONDS - started))s)"
}

# ---- The shipped files ------------------------------------------------------
for f in "${SHIPPED_FILES[@]}"; do
  cp "${AGENT_DIR}/${f}" "${WORK_DIR}/${f}"
done
if [ -z "${RECORD_DIR}" ]; then
  sed -i 's/scrape_interval: 60s/scrape_interval: 10s/; s/scrape_timeout: 50s/scrape_timeout: 9s/' \
    "${WORK_DIR}/otel-collector-config.netapp-ontap.yaml"
  grep -q 'scrape_interval: 10s' "${WORK_DIR}/otel-collector-config.netapp-ontap.yaml" \
    || fail "the collector config no longer scrapes every 60 seconds; update this script"
else
  for f in "${SHIPPED_FILES[@]}"; do
    cmp -s "${AGENT_DIR}/${f}" "${WORK_DIR}/${f}" || fail "${f} is not the shipped file"
  done
fi

COLLECTOR_IMAGE="$(sed -n 's/^ *image: *\(otel\/opentelemetry-collector-contrib:[^ ]*\).*/\1/p' "${WORK_DIR}/docker-compose.yml" | head -n 1)"
[ -n "${COLLECTOR_IMAGE}" ] || fail "no collector image in docker-compose.yml"
# The version the agent's files stamp, as the Dashboard compares it: the
# collector's until the files change on it (AgentFilesVersion.test.ts).
AGENT_VERSION="$(sed -n 's/^export const STORAGE_ARRAY_AGENT_VERSION: string = "\([0-9.]*\)";$/\1/p' "${REPO_ROOT}/packages/App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind.ts")"
[ -n "${AGENT_VERSION}" ] || fail "no STORAGE_ARRAY_AGENT_VERSION in AgentKind.ts"

# .env is written as install.sh writes it: with install.sh's own quoting.
quote_function="$(sed -n '/^compose_env_quote() {$/,/^}$/p' "${AGENT_DIR}/install.sh")"
[ -n "${quote_function}" ] || fail "install.sh has no compose_env_quote"
eval "${quote_function}"

# A value in single quotes for the override's YAML, with $ escaped for Compose.
yaml_compose_quote() {
  local value="${1//\$/\$\$}"
  printf "'%s'" "${value//\'/\'\'}"
}

# ---- The stand-in cluster and the OTLP sink ---------------------------------
mkdir -p "${WORK_DIR}/fake" "${WORK_DIR}/otlp-sink/out"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=fake-ontap" \
  -keyout "${WORK_DIR}/fake/key.pem" -out "${WORK_DIR}/fake/cert.pem" >/dev/null 2>&1
cp "${FAKE_ONTAP}" "${WORK_DIR}/fake/fake-ontap.js"
cat >"${WORK_DIR}/otlp-sink/config.yaml" <<'EOF'
# What OneUptime would receive: the agent exports OTLP/HTTP to
# ${ONEUPTIME_URL}/otlp, and this writes every request as a line of JSON.
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        metrics_url_path: /otlp/v1/metrics
exporters:
  file:
    path: /out/metrics.json
service:
  pipelines:
    metrics:
      receivers: [otlp]
      exporters: [file]
EOF
chmod 0644 "${WORK_DIR}"/fake/* "${WORK_DIR}/otlp-sink/config.yaml"
chmod 0755 "${WORK_DIR}/fake" "${WORK_DIR}/otlp-sink"
# The collector image writes as a non-root user.
chmod 0777 "${WORK_DIR}/otlp-sink/out"

# ---- What reached the sink --------------------------------------------------
cat >"${WORK_DIR}/check.js" <<'EOF'
// Reads the OTLP sink's output (one ExportMetricsServiceRequest per line) and
// prints every way it differs from what the agent must send OneUptime for the
// scenario. Exits 1 when there is any.
"use strict";
const fs = require("fs");

const [scenario, file, arrayName, agentVersion] = process.argv.slice(2);
const TIB = 2 ** 40;
const problems = [];
const problem = (text) => {
  if (!problems.includes(text)) {
    problems.push(text);
  }
};

// The prometheus receiver's own series about each scrape.
const RECEIVER_OWN = new Set(["up", "scrape_duration_seconds", "scrape_samples_scraped", "scrape_samples_post_metric_relabeling", "scrape_series_added"]);
// What otel-collector-config.netapp-ontap.yaml drops.
const SELF_TIMING = /^netapp_(poller_.*|metadata_(exporter_.*|component_count|target_goroutines|target_ping|collector_(api_time|bytesRx|calc_time|metrics|numCalls|numPartials|parse_time|pluginInstances|plugin_time|poll_time|skips|task_time)))$/;

function attributes(list) {
  const out = {};
  for (const a of list || []) {
    const v = a.value || {};
    out[a.key] = v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue;
  }
  return out;
}

// The latest datapoint of every series.
const latest = new Map();
let requests = 0;
const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
for (const line of text.split("\n")) {
  if (!line.trim()) {
    continue;
  }
  let request;
  try {
    request = JSON.parse(line);
  } catch (err) {
    continue; // still being written
  }
  requests++;
  for (const rm of request.resourceMetrics || []) {
    const resource = attributes(rm.resource && rm.resource.attributes);
    if (resource["storage.array.name"] !== arrayName) {
      problem(`the resource's storage.array.name is ${JSON.stringify(resource["storage.array.name"])}, not ${JSON.stringify(arrayName)}`);
    }
    if (resource["storage.system"] !== "netapp.ontap") {
      problem(`the resource's storage.system is ${JSON.stringify(resource["storage.system"])}, not "netapp.ontap"`);
    }
    if (resource["oneuptime.agent.version"] !== agentVersion) {
      problem(`the resource's oneuptime.agent.version is ${JSON.stringify(resource["oneuptime.agent.version"])}, not ${JSON.stringify(agentVersion)}`);
    }
    for (const key of ["service.name", "service.instance.id"]) {
      if (key in resource) {
        problem(`the resource carries ${key}=${JSON.stringify(resource[key])}`);
      }
    }
    for (const sm of rm.scopeMetrics || []) {
      for (const metric of sm.metrics || []) {
        const data = metric.gauge || metric.sum || metric.histogram || metric.summary || {};
        for (const dp of data.dataPoints || []) {
          const attrs = attributes(dp.attributes);
          if (!metric.name.startsWith("netapp_") && !RECEIVER_OWN.has(metric.name)) {
            problem(`a datapoint is named ${metric.name}, not netapp_*`);
          }
          if (attrs.scrape_endpoint !== "harvest") {
            problem(`${metric.name} is labelled scrape_endpoint=${JSON.stringify(attrs.scrape_endpoint)}, not "harvest"`);
          }
          if (SELF_TIMING.test(metric.name)) {
            problem(`Harvest's self-timing series ${metric.name} reached OneUptime`);
          }
          // A series that left a scrape gets a staleness marker: no recorded
          // value (flag 1). Harvest's metadata_component_status changes its
          // reason label, so its old series go stale this way.
          const stale = (Number(dp.flags || 0) & 1) === 1;
          const value = dp.asDouble !== undefined ? Number(dp.asDouble) : Number(dp.asInt);
          const key = `${metric.name}${JSON.stringify(Object.entries(attrs).sort())}`;
          const time = Number(dp.timeUnixNano || 0);
          const previous = latest.get(key);
          const values = previous ? previous.values : new Set();
          if (!stale) {
            values.add(value);
          }
          if (!previous || previous.time <= time) {
            latest.set(key, { name: metric.name, attrs, value, time, values, stale });
          }
        }
      }
    }
  }
}
if (requests === 0) {
  problem("nothing has reached the sink");
}

// The series named name, with the labels of match, still being sent.
function series(name, match = {}, includeStale = false) {
  return [...latest.values()].filter(
    (s) => s.name === name && (includeStale || !s.stale) && Object.entries(match).every(([k, v]) => s.attrs[k] === v),
  );
}

function label(name, match) {
  return `${name}{${Object.entries(match).map(([k, v]) => `${k}="${v}"`).join(",")}}`;
}

function one(name, match) {
  const found = series(name, match);
  if (found.length !== 1) {
    problem(`expected one ${label(name, match)}, found ${found.length}`);
    return null;
  }
  return found[0].value;
}

function expectValue(name, match, test, description) {
  const value = one(name, match);
  if (value !== null && !test(value)) {
    problem(`${label(name, match)} is ${value}, not ${description}`);
  }
}

function expectRatio(part, whole, match, expected, description) {
  const a = one(part, match);
  const b = one(whole, match);
  if (a !== null && b !== null && !(b > 0 && Math.abs(a / b - expected) <= 0.006)) {
    problem(`${label(part, match)} / ${whole} is ${b > 0 ? (a / b).toFixed(4) : "undefined"}, not ${description}`);
  }
}

// A series that held the value at some point: an EMS event is exported for
// one poll only.
function expectEver(name, match, expected, description) {
  const found = series(name, match, true);
  if (found.length !== 1) {
    problem(`expected one ${label(name, match)}, found ${found.length}`);
  } else if (!found[0].values.has(expected)) {
    problem(`${label(name, match)} never held ${expected}: ${description}`);
  }
}

function expectNone(name, match = {}) {
  const found = series(name, match);
  if (found.length) {
    problem(`${label(name, match)} reached OneUptime ${found.length} time(s); it must not`);
  }
}

const between = (low, high) => (v) => v >= low && v <= high;
const is = (expected) => (v) => v === expected;

function expectCollectors(statusOf) {
  const collectors = series("netapp_metadata_component_status", { type: "collector" });
  if (collectors.length !== 23) {
    problem(`netapp_metadata_component_status has ${collectors.length} collectors, not the 23 the shipped templates name`);
  }
  for (const c of collectors) {
    const [status, reason] = statusOf(`${c.attrs.name}:${c.attrs.target}`);
    if (c.value !== status || (reason && c.attrs.reason !== reason)) {
      problem(`collector ${c.attrs.name}:${c.attrs.target} reports status ${c.value} (${c.attrs.reason}), not ${status}${reason ? ` (${reason})` : ""}`);
    }
  }
}

if (scenario === "ontap") {
  expectValue("netapp_cluster_new_status", { cluster: "ontap-prod-01" }, is(1), "1: the cluster's health is ok");
  for (const node of ["ontap-prod-01-01", "ontap-prod-01-02"]) {
    expectValue("netapp_node_new_status", { node }, is(1), "1: both nodes are healthy");
  }

  const aggregates = series("netapp_aggr_space_total").map((s) => s.attrs.aggr).sort().join(",");
  if (aggregates !== "aggr1_n01,aggr1_n02") {
    problem(`netapp_aggr_space_total is for [${aggregates}], not aggr1_n01 and aggr1_n02 (Harvest leaves the root aggregates out)`);
  }
  for (const [aggr, used] of [["aggr1_n01", 0.82], ["aggr1_n02", 0.93]]) {
    expectValue("netapp_aggr_space_total", { aggr }, between(45.5 * TIB, 46.5 * TIB), "about 46 TiB");
    expectRatio("netapp_aggr_space_used", "netapp_aggr_space_total", { aggr }, used, `${used * 100}% used`);
  }

  for (const [volume, used] of [["vol_home", 0.64], ["vol_projects", 0.96], ["vol_db", 0.71]]) {
    expectRatio("netapp_volume_size_used", "netapp_volume_size_total", { volume }, used, `${used * 100}% used`);
  }
  const volumes = ["vol_home", "vol_projects", "vol_db", "vol_logs", "vol_web_dr", "vol_erp_dr", "vol_home_dr", "svm_nas_root"];
  const latency = { vol_db: [850, 950, "about 900 µs"], vol_projects: [7000, 8000, "about 7500 µs"] };
  for (const volume of volumes) {
    const [low, high, description] = latency[volume] || [50, 1000, "a few hundred µs"];
    expectValue("netapp_volume_read_latency", { volume }, between(low, high), description);
    expectValue("netapp_volume_read_ops", { volume }, (v) => v > 0, "above 0");
    expectValue("netapp_volume_total_data", { volume }, (v) => v > 0, "above 0");
  }
  expectNone("netapp_volume_size_used", { volume: "vol0" });

  expectRatio("netapp_lun_size_used", "netapp_lun_size", { lun: "lun_db01" }, 0.55, "55% used");
  expectValue("netapp_lun_new_status", { lun: "lun_db02" }, is(0), "0: lun_db02 is offline");

  const disks = series("netapp_disk_new_status");
  if (disks.length !== 12) {
    problem(`netapp_disk_new_status has ${disks.length} disks, not 12`);
  }
  for (const d of disks) {
    const expected = d.attrs.disk === "1.0.7" ? 0 : 1;
    if (d.value !== expected) {
      problem(`netapp_disk_new_status{disk="${d.attrs.disk}"} is ${d.value}, not ${expected}`);
    }
  }

  expectValue("netapp_shelf_psu_status", { shelf: "1.0", psu_id: "1" }, is(1), "1: PSU 1 is ok");
  expectValue("netapp_shelf_psu_status", { shelf: "1.0", psu_id: "2" }, is(0), "0: PSU 2 has failed");

  const ports = series("netapp_net_port_status");
  if (ports.length !== 7) {
    problem(`netapp_net_port_status has ${ports.length} ports, not 7`);
  }
  for (const p of ports) {
    const expected = p.attrs.node === "ontap-prod-01-01" && p.attrs.port === "e0c" ? 0 : 1;
    if (p.value !== expected) {
      problem(`netapp_net_port_status{node="${p.attrs.node}",port="${p.attrs.port}"} is ${p.value}, not ${expected}`);
    }
  }

  const fc = series("netapp_fcp_link_failure");
  if (fc.length !== 4) {
    problem(`netapp_fcp_link_failure has ${fc.length} ports, not 4`);
  }
  for (const p of fc) {
    const rising = p.attrs.node === "ontap-prod-01-01" && p.attrs.port === "0d";
    if (rising ? !(p.value > 0) : p.value !== 0) {
      problem(`netapp_fcp_link_failure{node="${p.attrs.node}",port="${p.attrs.port}"} is ${p.value}, not ${rising ? "above 0" : "0"}`);
    }
  }

  const lag = {
    "svm_dr:vol_web_dr": between(25 * 60 - 60, 25 * 60 + 90),
    "svm_dr:vol_erp_dr": between(190 * 60 - 60, 190 * 60 + 90),
    "svm_dr:vol_home_dr": between(6 * 3600 - 60, 6 * 3600 + 300),
    "svm_dr:vol_db_sync": is(0),
  };
  for (const [destination, test] of Object.entries(lag)) {
    expectValue("netapp_snapmirror_lag_time", { destination_location: destination }, test, "the scenario's lag");
  }
  if (series("netapp_snapmirror_labels").length !== 4) {
    problem(`netapp_snapmirror_labels has ${series("netapp_snapmirror_labels").length} relationships, not 4`);
  }
  const erp = series("netapp_snapmirror_labels", { destination_location: "svm_dr:vol_erp_dr" })[0];
  if (erp && (erp.attrs.healthy !== "false" || erp.attrs.unhealthy_reason !== "Transfer failed.")) {
    problem(`svm_dr:vol_erp_dr is healthy=${erp.attrs.healthy}, unhealthy_reason=${JSON.stringify(erp.attrs.unhealthy_reason)}`);
  }
  expectValue("netapp_snapmirror_schedule_seconds", { destination_location: "svm_dr:vol_web_dr" }, is(3600), "3600: its schedule is hourly");
  expectValue("netapp_snapmirror_schedule_seconds", { destination_location: "svm_dr:vol_erp_dr" }, is(3600), "3600: its schedule is hourly");
  expectValue("netapp_snapmirror_schedule_seconds", { destination_location: "svm_dr:vol_home_dr" }, is(86400), "86400: its schedule is daily");
  expectNone("netapp_snapmirror_schedule_seconds", { destination_location: "svm_dr:vol_db_sync" });

  expectValue("netapp_health_disk_alerts", { disk: "1.0.7" }, is(1), "1: disk 1.0.7 is broken");
  expectEver("netapp_ems_events", { message: "disk.outOfService", disk: "1.0.7" }, 1, "the event was never raised");
  expectEver("netapp_ems_events", { message: "monitor.fan.failed", node: "ontap-prod-01-02" }, 1, "the event was never raised");

  expectCollectors(() => [0, "running"]);
  expectValue("netapp_metadata_collector_instances", { collector: "Rest", object: "Volume", task: "data" }, (v) => v >= 8, "8 or more");
} else if (scenario === "fsx") {
  expectValue("netapp_cluster_new_status", { cluster: "FsxId0a1b2c3d4e5f6a7b8" }, is(1), "1: the file system's health is ok");
  for (const node of ["FsxId0a1b2c3d4e5f6a7b8-01", "FsxId0a1b2c3d4e5f6a7b8-02"]) {
    expectValue("netapp_node_new_status", { node }, is(1), "1: both nodes are healthy");
  }
  expectValue("netapp_aggr_space_total", { aggr: "aggr1" }, between(1.95 * TIB, 2.05 * TIB), "about 2 TiB");
  expectRatio("netapp_aggr_space_used", "netapp_aggr_space_total", { aggr: "aggr1" }, 0.4, "40% used");
  expectRatio("netapp_volume_size_used", "netapp_volume_size_total", { volume: "vol_files" }, 0.58, "58% used");
  expectRatio("netapp_volume_size_used", "netapp_volume_size_total", { volume: "vol_backup" }, 0.2, "20% used");
  expectValue("netapp_volume_read_latency", { volume: "vol_files" }, between(400, 560), "about 480 µs");

  // What fsxadmin is refused: the object's collector fails, and nothing of it
  // reaches OneUptime. FSx has no LUNs, SnapMirror relationships or FC ports.
  const refused = ["Rest:Disk", "Rest:Shelf", "Rest:Sensor", "Rest:FCP", "RestPerf:Disk"];
  const empty = ["Rest:Lun", "KeyPerf:Lun", "Rest:SnapMirror", "RestPerf:FcpPort"];
  expectCollectors((name) => {
    if (refused.includes(name)) {
      return [2, null];
    }
    if (empty.includes(name)) {
      return [1, "no instances"];
    }
    return [0, "running"];
  });
  for (const name of ["netapp_disk_new_status", "netapp_shelf_new_status", "netapp_shelf_psu_status", "netapp_environment_sensor_status", "netapp_fcp_labels", "netapp_health_disk_alerts", "netapp_health_shelf_alerts", "netapp_health_support_alerts", "netapp_ems_events"]) {
    expectNone(name);
  }
} else {
  problem(`unknown scenario ${scenario}`);
}

if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}
console.log(`ok: ${latest.size} series in ${requests} request(s)`);
EOF

sink_checks_pass() {
  node "${WORK_DIR}/check.js" "${SCENARIO}" "${WORK_DIR}/otlp-sink/out/metrics.json" "${ARRAY_NAME}" "${AGENT_VERSION}" \
    >"${WORK_DIR}/check.out" 2>&1
}

# ---- Waiting for what Harvest and the stand-in say --------------------------
# Whether the log of service $1 has a line with $2 in it. The log is read
# whole first: grep -q would stop reading at the first match and, under
# pipefail, fail the pipeline it matched in.
log_has() {
  local log
  log="$(compose logs --no-log-prefix "$1" 2>/dev/null)"
  grep -qF -- "$2" <<<"${log}"
}

fake_says() {
  log_has fake-ontap "$1"
}

# The collectors Harvest started (collector:object), from its log.
harvest_collectors() {
  harvest_log | grep -F 'msg="best-fit template"' | sed -n 's/.* collector=\([^ ]*\) .*/\1/p' | sort -u
}

# How many data polls collector:object $1 has finished.
data_polls() {
  harvest_log | grep -F 'msg=Collected' | grep -F ' task=data ' | grep -cF " collector=$1 " || true
}

# The instances the EMS collector exported in its data poll number $1.
ems_poll_instances() {
  harvest_log | grep -F 'msg=Collected' | grep -F ' collector=Ems:Ems task=data ' \
    | sed -n "$1p" | sed -n 's/.* instances=\([0-9]*\) .*/\1/p'
}

ems_polls_at_least() {
  [ "$(data_polls Ems:Ems)" -ge "$1" ]
}

# Every collector has finished at least $1 data polls.
every_collector_polled() {
  local collectors c
  collectors="$(harvest_collectors)"
  [ "$(printf '%s\n' "${collectors}" | grep -c .)" -eq 23 ] || return 1
  for c in ${collectors}; do
    [ "$(data_polls "${c}")" -ge "$1" ] || return 1
  done
}

# Every collector that has finished a data poll has finished $1, and the
# slowest schedule (Rest, 3 minutes) has come round: what still answers 403 or
# has nothing to collect never finishes one.
every_working_collector_polled() {
  local c n
  [ "$(data_polls Rest:Volume)" -ge "$1" ] || return 1
  for c in $(harvest_collectors); do
    n="$(data_polls "${c}")"
    [ "${n}" -eq 0 ] || [ "${n}" -ge "$1" ] || return 1
  done
}

harvest_metrics() {
  compose exec -T fake-ontap wget -qO- http://netapp-harvest:12990/metrics
}

# ---- One scenario -----------------------------------------------------------
# start_scenario <scenario> <ONTAP user> <STORAGE_ARRAY_NAME> <seconds the
# stand-in runs before Harvest starts>
start_scenario() {
  local user="$2" delay="$4"
  SCENARIO="$1"
  ARRAY_NAME="$3"
  if [ -f "${WORK_DIR}/docker-compose.override.yml" ]; then
    compose down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -f "${WORK_DIR}/otlp-sink/out/metrics.json" "${WORK_DIR}/check.out"

  # Names of this run's own, so an agent installed on the machine is left alone.
  cat >"${WORK_DIR}/docker-compose.override.yml" <<EOF
services:
  oneuptime-storage-array-agent:
    container_name: ${RUN_ID}-collector
  fake-ontap:
    image: ${NODE_IMAGE}
    command: ["node", "/fake/fake-ontap.js"]
    environment:
      ONTAP_SCENARIO: ${SCENARIO}
      ONTAP_USERNAME: $(yaml_compose_quote "${user}")
      ONTAP_PASSWORD: $(yaml_compose_quote "${PASSWORD}")
    volumes: ["./fake:/fake:ro"]
  otlp-sink:
    image: ${COLLECTOR_IMAGE}
    command: ["--config", "/etc/otlp-sink/config.yaml"]
    volumes: ["./otlp-sink/config.yaml:/etc/otlp-sink/config.yaml:ro", "./otlp-sink/out:/out"]
EOF

  cat >"${WORK_DIR}/.env" <<EOF
ONEUPTIME_URL=$(compose_env_quote "http://otlp-sink:4318")
ONEUPTIME_TELEMETRY_INGESTION_KEY=$(compose_env_quote "behaviour-test")
STORAGE_ARRAY_NAME=$(compose_env_quote "${ARRAY_NAME}")
STORAGE_SYSTEM=netapp.ontap
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.netapp-ontap.yaml
COMPOSE_PROFILES=netapp-ontap
NETAPP_ONTAP_ENDPOINT=$(compose_env_quote "fake-ontap")
NETAPP_ONTAP_USERNAME=$(compose_env_quote "${user}")
NETAPP_ONTAP_PASSWORD=$(compose_env_quote "${PASSWORD}")
STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true
EOF

  echo "==> ${SCENARIO}: starting the stand-in cluster, then Harvest and the collector"
  compose up --no-start --quiet-pull >/dev/null 2>&1 || compose up --no-start --quiet-pull
  compose start fake-ontap otlp-sink >/dev/null 2>&1
  # Looked for often: when Harvest starts after the stand-in is a condition of
  # the recording (see below).
  local tries=0
  until fake_says " listening on 443"; do
    tries=$((tries + 1))
    [ "${tries}" -lt 300 ] || fail "the stand-in ${SCENARIO} cluster never listened"
    sleep 0.2
  done
  echo "ok: the stand-in ${SCENARIO} cluster listens"
  sleep "${delay}"
  compose start netapp-harvest oneuptime-storage-array-agent >/dev/null 2>&1

  # Only these: no Pure Storage exporter was started.
  local running
  running="$(compose ps --services --status running | sort | tr '\n' ' ')"
  [ "${running}" = "fake-ontap netapp-harvest oneuptime-storage-array-agent otlp-sink " ] \
    || fail "unexpected services running: ${running}"
}

check_logs() {
  local errors
  # The run is shorter than the 4 minutes after which Harvest would write its
  # first AutoSupport payload into its read-only filesystem.
  log_has netapp-harvest 'msg="Autosupport is disabled"' || fail "Harvest's AutoSupport is not disabled"
  errors="$(harvest_log | grep -F 'level=ERROR' || true)"
  if [ "${SCENARIO}" = "fsx" ]; then
    [ -n "${errors}" ] || fail "Harvest logged no error for what fsxadmin is refused"
    errors="$(printf '%s\n' "${errors}" | grep -vF 'StatusCode: 403, Error: Permission denied' || true)"
  fi
  [ -z "${errors}" ] || fail "Harvest logged errors the scenario does not cause: ${errors}"
  echo "ok: Harvest logged no error but the ones the scenario causes"

  for service in netapp-harvest fake-ontap oneuptime-storage-array-agent; do
    if log_has "${service}" "${PASSWORD}"; then
      fail "the ${service} log holds the cluster password"
    fi
  done
  echo "ok: no log holds the password"

  fake_says "AUTH the Basic credentials received are exactly ONTAP_USERNAME and ONTAP_PASSWORD" \
    || fail "Harvest never sent the configured credentials"
  ! fake_says "AUTH MISMATCH" || fail "Harvest sent other credentials than the configured ones"
  [ -z "$(fake_log | grep -E ' (GET|POST|PUT|PATCH|DELETE) /' | grep -v ' auth=ok$' || true)" ] \
    || fail "a request was answered without the configured credentials"
  echo "ok: every request carried exactly the configured user and password"

  [ -z "$(fake_log | grep -F ' UNKNOWN ' || true)" ] \
    || fail "Harvest asked the stand-in for endpoints it does not know: $(fake_log | grep -F ' UNKNOWN ' | sort -u)"
  echo "ok: the stand-in knew every endpoint Harvest read"
}

# ---- Behaviour --------------------------------------------------------------
if [ -z "${RECORD_DIR}" ]; then
  # The stand-in runs 6 seconds before Harvest starts, so its EMS events at
  # 0 seconds fall inside Harvest's first EMS window (which ends 5 seconds
  # before the cluster's time) and are exported from the first EMS poll.
  start_scenario ontap harvest-ro "dc1-ontap-prod" 6
  wait_for "the sink holds every series of the ONTAP cluster, with its values" 300 sink_checks_pass
  check_logs

  start_scenario fsx fsxadmin "fsx-files-prod" 0
  wait_for "the sink holds the FSx file system, and nothing of what fsxadmin is refused" 300 sink_checks_pass
  check_logs

  echo "PASS: Harvest reads the stand-in ONTAP and FSx clusters, and the agent sends OneUptime what it reads"
  exit 0
fi

# ---- Recording --------------------------------------------------------------
OUT="${WORK_DIR}/record"
mkdir -p "${OUT}"

save_metrics() {
  harvest_metrics >"${OUT}/$1"
  grep -q '^netapp_' "${OUT}/$1" || fail "Harvest served no netapp_ series for $1"
  echo "    saved $1: $(wc -l <"${OUT}/$1") lines, $(wc -c <"${OUT}/$1") bytes, the stand-in at $(fake_log | tail -n 1 | awk '{print $2}')"
}

prom_has() {
  grep -qE -- "$2" "${OUT}/$1" || fail "$1 has no line matching $2"
}

prom_lacks() {
  ! grep -qE -- "$2" "${OUT}/$1" || fail "$1 has a line matching $2"
}

# The stand-in's EMS events at 0 seconds must come in Harvest's second EMS
# poll, so that the scrape holding them is also one where every collector has
# polled twice: Harvest exports a raised event for one poll only, and Rest
# polls on the same 3 minutes as EMS. That needs Harvest's first EMS poll to
# come less than 5 seconds after the stand-in starts.
for attempt in 1 2 3; do
  start_scenario ontap harvest-ro "dc1-ontap-prod" 0
  wait_for "Harvest's first EMS poll" 60 ems_polls_at_least 1
  [ "$(ems_poll_instances 1)" != "0" ] || break
  [ "${attempt}" -lt 3 ] || fail "Harvest's first EMS poll came 5 seconds or more after the stand-in started, three times"
  echo "    Harvest's first EMS poll came 5 seconds or more after the stand-in started; starting again"
done

wait_for "Harvest's second EMS poll raised disk.outOfService and monitor.fan.failed" 240 ems_polls_at_least 2
[ "$(ems_poll_instances 2)" = "2" ] || fail "Harvest's second EMS poll exported $(ems_poll_instances 2) events, not 2"
wait_for "every collector has polled at least twice" 120 every_collector_polled 2
save_metrics ontap.prom
prom_has ontap.prom '^netapp_ems_events\{.*message="disk.outOfService".*\} 1$'
prom_has ontap.prom '^netapp_ems_events\{.*message="monitor.fan.failed".*\} 1$'
prom_has ontap.prom '^netapp_volume_read_latency\{.*volume="vol_db".*\} (8[5-9][0-9]|9[0-4][0-9])(\.[0-9]+)?$'

wait_for "Harvest's third EMS poll received monitor.fan.ok" 240 ems_polls_at_least 3
[ "$(ems_poll_instances 3)" = "1" ] || fail "Harvest's third EMS poll exported $(ems_poll_instances 3) events, not 1"
save_metrics ontap-ems-cleared.prom
prom_has ontap-ems-cleared.prom '^netapp_ems_events\{.*message="monitor.fan.failed".*\} 0$'
prom_lacks ontap-ems-cleared.prom '^netapp_ems_events\{.*message="disk.outOfService"'

wait_for "Harvest's fourth EMS poll" 240 ems_polls_at_least 4
save_metrics ontap-ems-after.prom
prom_lacks ontap-ems-after.prom '^netapp_ems_events'

wait_for "the sink holds every series of the ONTAP cluster, with its values" 120 sink_checks_pass
check_logs

start_scenario fsx fsxadmin "fsx-files-prod" 0
wait_for "every collector that can collect has polled at least twice" 300 every_working_collector_polled 2
save_metrics fsx.prom
prom_has fsx.prom '^netapp_metadata_component_status\{.*name="Rest".*target="Disk".*\} 2$'
wait_for "the sink holds the FSx file system, and nothing of what fsxadmin is refused" 120 sink_checks_pass
check_logs

mkdir -p "${RECORD_DIR}"
cp "${OUT}"/*.prom "${RECORD_DIR}/"
echo "PASS: recorded $(cd "${OUT}" && echo *.prom) into ${RECORD_DIR}"
