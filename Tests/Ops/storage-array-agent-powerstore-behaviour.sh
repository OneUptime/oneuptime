#!/usr/bin/env bash
#
# Run the Storage Array Agent for a Dell PowerStore exactly as
# agents/StorageArrayAgent ships it (docker-compose.yml under the `powerstore`
# profile, the image powerstore-exporter.Dockerfile builds around Dell's
# powerstore-metrics-exporter v1.0.3 release, the collector with
# otel-collector-config.powerstore.yaml and the syslog collector with
# powerstore-syslog.yaml) against a stand-in PowerStore,
# and check what reaches OneUptime.
#
# No PowerStore is reachable from CI, so the cluster is
# Tests/Ops/Fixtures/DellPowerStore/fake-powerstore.js: Dell's REST API as its
# reference and Dell's exporter source describe it (see its header). Dell's
# exporter itself is the real one, unmodified: what it answers here is what it
# answers an array that says the same things. OneUptime is an OTLP sink (the
# collector image with an otlp receiver and a file exporter).
#
# It checks that:
#   - the exporter logs in with the user and password .env holds, byte for
#     byte (the password exercises every character .env quoting has to get
#     right), turns the bulk archive on and reads it, and never logs the
#     password;
#   - every batch carries storage.array.name, storage.system=dell.powerstore
#     and oneuptime.agent.version, and no service.name;
#   - every part of the cluster the config scrapes arrives, labelled with its
#     scrape_endpoint, with the families OneUptime reads;
#   - the collector's own work is right: a healthy node's state reads 1, and
#     each appliance's and file system's used percent is used / total;
#   - PowerStore's syslog, sent over TCP and UDP to the published port, arrives
#     as logs of the array with PowerStore's record in flat attributes, the
#     alert severity from Dell's event codes, and none on a Cleared line.
#
# The only change to the shipped files: the collector scrapes every 15
# seconds instead of every 1 and 5 minutes, so a run takes two minutes.
#
# With `--record <dir>` it instead runs the shipped files unmodified and saves
# what Dell's exporter answers on each of its paths (fetched from inside its
# own container), in bulk mode and per object, what the collector derives, and
# what the syslog collector makes of the samples: the recordings in
# packages/Common/Tests/Fixtures/DellPowerStoreExporter.
#
# Needs docker (with Compose v2), openssl, and network access to quay.io and
# github.com for the exporter's image the first time it is built.
# Usage: bash Tests/Ops/storage-array-agent-powerstore-behaviour.sh [--record <dir>]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_DIR="${REPO_ROOT}/agents/StorageArrayAgent"
FIXTURES_DIR="${REPO_ROOT}/Tests/Ops/Fixtures/DellPowerStore"
# Warmed by the Ops workflow before the real-Docker tests run.
NODE_IMAGE="public.ecr.aws/docker/library/node:26-alpine3.24"
RUN_ID="powerstore-behaviour-$$"
USERNAME="oneuptime"
# Every character .env quoting has to carry: quotes, a colon, a #, a
# backslash and a dollar sign.
PASSWORD="O'ne \"up\" #time: \\ \$HOME"
SYSLOG_PORT="${POWERSTORE_BEHAVIOUR_SYSLOG_PORT:-25514}"
ARRAY_NAME="ps-prod-01"
ENDPOINT="fake-powerstore"

RECORD_DIR=""
if [ "${1:-}" = "--record" ]; then
  RECORD_DIR="$(cd "${2:?--record needs a directory}" && pwd)"
fi

WORK_DIR="$(mktemp -d)"
chmod 0755 "${WORK_DIR}"

compose() {
  docker compose -p "${RUN_ID}" --project-directory "${WORK_DIR}" \
    -f "${WORK_DIR}/docker-compose.yml" -f "${WORK_DIR}/docker-compose.override.yml" "$@"
}

dump_logs() {
  echo "---- fake-powerstore (last requests)"
  compose logs --no-log-prefix fake-powerstore 2>&1 | tail -n 40 || true
  echo "---- powerstore-exporter"
  compose logs --no-log-prefix powerstore-exporter 2>&1 | tail -n 40 || true
  echo "---- collector"
  compose logs --no-log-prefix oneuptime-storage-array-agent 2>&1 | tail -n 40 || true
  echo "---- syslog collector"
  compose logs --no-log-prefix powerstore-syslog 2>&1 | tail -n 40 || true
}

cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1"
  dump_logs
  exit 1
}

# ---- The shipped files ------------------------------------------------------
for file in docker-compose.yml otel-collector-config.powerstore.yaml \
  powerstore-syslog.yaml powerstore-exporter.Dockerfile; do
  cp "${AGENT_DIR}/${file}" "${WORK_DIR}/${file}"
done
if [ -z "${RECORD_DIR}" ]; then
  sed -e 's/scrape_interval: 300s/scrape_interval: 15s/' \
    -e 's/scrape_timeout: 240s/scrape_timeout: 12s/' \
    -e 's/scrape_interval: 60s/scrape_interval: 15s/' \
    -e 's/scrape_timeout: 50s/scrape_timeout: 12s/' \
    "${AGENT_DIR}/otel-collector-config.powerstore.yaml" \
    >"${WORK_DIR}/otel-collector-config.powerstore.yaml"
  if grep -Eq 'scrape_interval: (300|60)s' "${WORK_DIR}/otel-collector-config.powerstore.yaml"; then
    fail "the collector config still scrapes at its shipped intervals"
  fi
fi

# ---- The stand-ins ------------------------------------------------------------
mkdir -p "${WORK_DIR}/fakes" "${WORK_DIR}/sink"
cp "${FIXTURES_DIR}/fake-powerstore.js" "${WORK_DIR}/fakes/fake-powerstore.js"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=${ENDPOINT}" \
  -addext "subjectAltName=DNS:${ENDPOINT}" \
  -keyout "${WORK_DIR}/fakes/key.pem" -out "${WORK_DIR}/fakes/cert.pem" >/dev/null 2>&1
chmod 0644 "${WORK_DIR}/fakes/key.pem" "${WORK_DIR}/fakes/cert.pem"
chmod 0777 "${WORK_DIR}/sink"

COLLECTOR_IMAGE="$(grep -Eo 'otel/opentelemetry-collector-contrib:[0-9.]+' "${AGENT_DIR}/docker-compose.yml" | head -n 1)"

cat >"${WORK_DIR}/sink.yaml" <<'EOF'
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        metrics_url_path: /otlp/v1/metrics
        logs_url_path: /otlp/v1/logs
exporters:
  file/metrics:
    path: /sink/metrics.jsonl
  file/logs:
    path: /sink/logs.jsonl
service:
  pipelines:
    metrics:
      receivers: [otlp]
      exporters: [file/metrics]
    logs:
      receivers: [otlp]
      exporters: [file/logs]
EOF

cat >"${WORK_DIR}/docker-compose.override.yml" <<EOF
services:
  fake-powerstore:
    image: ${NODE_IMAGE}
    command: ["node", "/fakes/fake-powerstore.js"]
    environment:
      - FAKE_POWERSTORE_CERT=/fakes/cert.pem
      - FAKE_POWERSTORE_KEY=/fakes/key.pem
      - FAKE_POWERSTORE_USERNAME=${USERNAME}
      - FAKE_POWERSTORE_PASSWORD=\${FAKE_POWERSTORE_PASSWORD}
    volumes:
      - ./fakes:/fakes:ro
  otlp-sink:
    image: ${COLLECTOR_IMAGE}
    volumes:
      - ./sink.yaml:/etc/otelcol-contrib/config.yaml:ro
      - ./sink:/sink
  oneuptime-storage-array-agent:
    container_name: ${RUN_ID}-collector
    depends_on: [otlp-sink, powerstore-exporter]
  powerstore-exporter:
    depends_on: [fake-powerstore]
EOF

# ---- .env, quoted the way install.sh quotes it ------------------------------
# compose_env_quote from install.sh: single quotes when they can carry the
# value, else double quotes with \\, \" and \$\$ escaped.
compose_env_quote() {
  local value="$1"
  case "$value" in
    *\'* | *\\)
      value="${value//\\/\\\\}"
      value="${value//\"/\\\"}"
      value="${value//\$/\$\$}"
      printf '"%s"' "$value"
      ;;
    *)
      printf "'%s'" "$value"
      ;;
  esac
}
{
  echo "ONEUPTIME_URL=$(compose_env_quote "http://otlp-sink:4318")"
  echo "ONEUPTIME_TELEMETRY_INGESTION_KEY=$(compose_env_quote "behaviour-test-key")"
  echo "STORAGE_ARRAY_NAME=$(compose_env_quote "${ARRAY_NAME}")"
  echo "STORAGE_SYSTEM=dell.powerstore"
  echo "STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.powerstore.yaml"
  echo "COMPOSE_PROFILES=powerstore"
  echo "POWERSTORE_ENDPOINT=$(compose_env_quote "${ENDPOINT}")"
  echo "POWERSTORE_USERNAME=$(compose_env_quote "${USERNAME}")"
  echo "POWERSTORE_PASSWORD=$(compose_env_quote "${PASSWORD}")"
  echo "POWERSTORE_SYSLOG_PORT=${SYSLOG_PORT}"
  echo "STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true"
  echo "FAKE_POWERSTORE_PASSWORD=$(compose_env_quote "${PASSWORD}")"
} >"${WORK_DIR}/.env"
chmod 0600 "${WORK_DIR}/.env"

echo "==> building the exporter's image from powerstore-exporter.Dockerfile"
compose build powerstore-exporter >/dev/null || fail "the exporter's image did not build"

echo "==> starting the agent (profile powerstore) against the stand-in PowerStore"
compose up -d >/dev/null 2>&1 || fail "compose up failed"

# The exporter waits a minute after turning the bulk archive on before it
# reads it (its route.go), then serves.
wait_for() {
  local description="$1" seconds="$2"
  shift 2
  local waited=0
  until "$@" >/dev/null 2>&1; do
    if [ "${waited}" -ge "${seconds}" ]; then
      fail "timed out after ${seconds}s waiting for ${description}"
    fi
    sleep 5
    waited=$((waited + 5))
  done
}

exporter_answers() {
  compose exec -T powerstore-exporter wget -qO- \
    "http://127.0.0.1:9010/metrics/${ENDPOINT}/cluster" | grep -q '^powerstore_cluster{'
}
wait_for "the exporter to serve the cluster" 240 exporter_answers
echo "==> the exporter answers"

# ---- Recording ----------------------------------------------------------------
PARTS="cluster appliance capacity hardware port volume volumeGroup nas file"

record_parts() {
  local into="$1"
  mkdir -p "${into}"
  for part in ${PARTS}; do
    compose exec -T powerstore-exporter wget -qO- \
      "http://127.0.0.1:9010/metrics/${ENDPOINT}/${part}" >"${into}/${part}.prom" ||
      fail "the exporter did not answer /metrics/${ENDPOINT}/${part}"
    [ -s "${into}/${part}.prom" ] || fail "the exporter answered /metrics/${ENDPOINT}/${part} with nothing"
  done
}

if [ -n "${RECORD_DIR}" ]; then
  # The bulk archive is read when the exporter starts and every 5 minutes.
  record_parts "${RECORD_DIR}/bulk"
  echo "==> recorded the bulk-mode answers"
fi

# ---- What reaches OneUptime -----------------------------------------------------
cat >"${WORK_DIR}/check.js" <<'EOF'
"use strict";
// Reads the sink's OTLP/JSON lines and checks one claim, named by argv[2].
const fs = require("fs");
const [, , sinkDir, arrayName, claim, expectedCount] = process.argv;

function lines(file) {
  const path = `${sinkDir}/${file}`;
  if (!fs.existsSync(path)) {
    return [];
  }
  return fs
    .readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function value(v) {
  if (!v) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("intValue" in v) return Number(v.intValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("boolValue" in v) return v.boolValue;
  return undefined;
}

function attrs(list) {
  const out = {};
  for (const a of list || []) out[a.key] = value(a.value);
  return out;
}

const points = [];
const resources = [];
for (const batch of lines("metrics.jsonl")) {
  for (const rm of batch.resourceMetrics || []) {
    const resource = attrs(rm.resource && rm.resource.attributes);
    resources.push(resource);
    for (const sm of rm.scopeMetrics || []) {
      for (const metric of sm.metrics || []) {
        const data = metric.gauge || metric.sum;
        for (const dp of (data && data.dataPoints) || []) {
          points.push({
            name: metric.name,
            value: dp.asDouble !== undefined ? dp.asDouble : Number(dp.asInt),
            attributes: attrs(dp.attributes),
            resource,
          });
        }
      }
    }
  }
}

const records = [];
for (const batch of lines("logs.jsonl")) {
  for (const rl of batch.resourceLogs || []) {
    const resource = attrs(rl.resource && rl.resource.attributes);
    for (const sl of rl.scopeLogs || []) {
      for (const record of sl.logRecords || []) {
        records.push({
          body: value(record.body),
          severityNumber: record.severityNumber,
          attributes: attrs(record.attributes),
          resource,
        });
      }
    }
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function latest(name, where) {
  const matching = points.filter((p) => {
    return (
      p.name === name &&
      Object.entries(where || {}).every(([k, v]) => p.attributes[k] === v)
    );
  });
  return matching.length ? matching[matching.length - 1] : null;
}

const ENDPOINTS = ["cluster", "appliance", "capacity", "hardware", "port", "volume", "volumegroup", "nas", "file"];
const FAMILIES = {
  cluster: ["powerstore_cluster", "powerstore_metro_status", "powerstore_metro_witness_status", "powerstore_metro_witness_conn_status"],
  appliance: ["powerstore_appliance", "powerstore_perf_avg_read_latency", "powerstore_perf_avg_write_iops", "powerstore_perf_avg_io_workload_cpu_utilization"],
  capacity: ["powerstore_cap_last_physical_total", "powerstore_cap_last_physical_used", "powerstore_cap_last_data_reduction"],
  hardware: ["powerstore_hardware_node_state", "powerstore_hardware_Drive_state", "powerstore_hardware_Fan_state", "powerstore_hardware_Power_Supply_state", "powerstore_hardware_Battery_state", "powerstore_hardware_drive_size", "powerstore_wear_metrics_by_drive"],
  port: ["powerstore_fc_port_is_link_up", "powerstore_eth_port_is_link_up", "powerstore_fc_port_current_speed", "powerstore_metricFcPort_avg_read_latency", "powerstore_metricEthPort_avg_bytes_rx_ps"],
  volume: ["powerstore_volume_state", "powerstore_volume_size", "powerstore_volume_logical_used", "powerstore_metricVolume_avg_read_latency"],
  volumegroup: ["powerstore_volumegroup_logical_provisioned", "powerstore_metricVg_avg_read_latency"],
  nas: ["powerstore_nas_server_operational_status", "powerstore_metricNas_avg_read_latency"],
  file: ["powerstore_filesystem_logical_used", "powerstore_filesystem_logical_provisioned", "powerstore_metricFilesystem_avg_read_latency"],
};

switch (claim) {
  case "metrics-arrived": {
    // The exporter's own series: a failed scrape's `up` carries the label too.
    const seen = new Set(
      points
        .filter((p) => p.name.startsWith("powerstore_"))
        .map((p) => p.attributes.scrape_endpoint),
    );
    for (const endpoint of ENDPOINTS) {
      if (!seen.has(endpoint)) fail(`no series of the exporter labelled scrape_endpoint=${endpoint} yet`);
    }
    for (const families of Object.values(FAMILIES)) {
      for (const family of families) {
        if (!latest(family)) fail(`no ${family} yet`);
      }
    }
    if (!latest("powerstore_cap_physical_used_percent")) fail("no used percent yet");
    if (!latest("powerstore_filesystem_logical_used_percent")) fail("no file system used percent yet");
    break;
  }
  case "metrics": {
    for (const resource of resources) {
      if (resource["storage.array.name"] !== arrayName) fail(`a batch without storage.array.name=${arrayName}: ${JSON.stringify(resource)}`);
      if (resource["storage.system"] !== "dell.powerstore") fail(`a batch with storage.system ${resource["storage.system"]}`);
      if (!resource["oneuptime.agent.version"]) fail("a batch without oneuptime.agent.version");
      if (resource["service.name"] !== undefined || resource["service.instance.id"] !== undefined) fail("a batch kept the receiver's service identity");
    }
    for (const [endpoint, families] of Object.entries(FAMILIES)) {
      for (const family of families) {
        const point = latest(family);
        if (!point) fail(`no ${family}`);
        if (point.attributes.scrape_endpoint !== endpoint) fail(`${family} labelled scrape_endpoint=${point.attributes.scrape_endpoint}, not ${endpoint}`);
        if (point.attributes.IP !== "fake-powerstore") fail(`${family} without the exporter's IP label`);
      }
    }
    for (const point of points) {
      if (!point.name.startsWith("powerstore_") && !["up", "scrape_duration_seconds", "scrape_samples_scraped", "scrape_samples_post_metric_relabeling", "scrape_series_added"].includes(point.name)) {
        fail(`an unexpected series ${point.name}`);
      }
    }
    const node = latest("powerstore_hardware_node_state", { name: "BaseEnclosure-NodeA", appliance_id: "A1" });
    if (!node || node.value !== 1 || node.attributes.state !== "Healthy") fail(`a healthy node reads ${JSON.stringify(node)}`);
    const drive = latest("powerstore_hardware_Drive_state", { name: "Drive_0_0_7", appliance_id: "A1" });
    if (!drive || drive.value !== 0) fail(`the failed drive reads ${JSON.stringify(drive)}`);
    const a1 = latest("powerstore_cap_physical_used_percent", { appliance_id: "A1" });
    const a2 = latest("powerstore_cap_physical_used_percent", { appliance_id: "A2" });
    if (!a1 || Math.abs(a1.value - 77.0051) > 0.01) fail(`A1's used percent reads ${JSON.stringify(a1)}`);
    if (!a2 || Math.abs(a2.value - 92.0946) > 0.01) fail(`A2's used percent reads ${JSON.stringify(a2)}`);
    if (a1.attributes.scrape_endpoint !== "capacity") fail("the used percent lost its scrape_endpoint label");
    const home = latest("powerstore_filesystem_logical_used_percent", { name: "fs-home" });
    if (!home || Math.abs(home.value - 94.5) > 0.01) fail(`fs-home's used percent reads ${JSON.stringify(home)}`);
    for (const point of points) {
      if ((point.name === "powerstore_cap_physical_used_percent" || point.name === "powerstore_filesystem_logical_used_percent") && point.resource["appliance_id"] !== undefined) {
        fail("a used percent kept its grouping in the resource");
      }
    }
    break;
  }
  case "logs-arrived": {
    if (records.length < Number(expectedCount)) fail(`${records.length} log records so far`);
    break;
  }
  case "logs": {
    for (const record of records) {
      if (record.resource["storage.array.name"] !== arrayName) fail("a log without the array's name");
      if (record.resource["storage.system"] !== "dell.powerstore") fail("a log without storage.system");
    }
    const byAlert = (id, state) => records.find((r) => r.attributes["powerstore.alert.id"] === id && r.attributes["powerstore.alert.state"] === state);
    const port = byAlert("7c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5", "Active");
    if (!port) fail("the port link down alert did not arrive");
    if (port.attributes["powerstore.alert.severity"] !== "Major" || port.severityNumber !== 17) fail(`the port alert reads ${JSON.stringify(port)}`);
    if (port.attributes["powerstore.event.code"] !== "0x00307404" || port.attributes["powerstore.resource.name"] !== "BaseEnclosure-NodeB-IoModule0-FEPort1") fail("the port alert lost its record");
    if (port.body !== "Port link is down.") fail(`the port alert's body is ${port.body}`);
    const drive = byAlert("0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d", "Active");
    if (!drive || drive.attributes["powerstore.alert.severity"] !== "Critical" || drive.severityNumber !== 21) fail(`the drive alert reads ${JSON.stringify(drive)}`);
    const unknown = byAlert("6f7a8b9c-0d1e-4f2a-b3c4-d5e6f7a8b9c0", "Active");
    if (!unknown || unknown.attributes["powerstore.alert.severity"] !== "Major") fail(`an unlisted code at priority err reads ${JSON.stringify(unknown)}`);
    const cleared = byAlert("7c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5", "Cleared");
    if (!cleared) fail("the port alert's Cleared line did not arrive");
    if (cleared.attributes["powerstore.alert.severity"] !== undefined) fail("a Cleared line has a severity");
    const realCleared = byAlert("ef7b021c-23a0-4821-8245-289cbdc7addd", "Cleared");
    if (!realCleared || realCleared.attributes["powerstore.event.code"] !== "0x00d00203") fail("the recorded Cleared alert did not parse");
    const audit = records.find((r) => r.attributes["powerstore.audit.id"] === "2341");
    if (!audit || audit.attributes["powerstore.audit.user"] !== "admin" || audit.attributes["powerstore.message_type"] !== "Authentication") fail("the audit event did not parse");
    const udp = records.find((r) => r.attributes["powerstore.alert.id"] === "9a8b7c6d-5e4f-4321-8765-0fedcba98765");
    if (!udp || udp.attributes["powerstore.alert.severity"] !== "Critical") fail("the alert sent over UDP did not arrive");
    const other = records.find((r) => r.body === "This line is not PowerStore's at all.");
    if (!other || other.attributes["powerstore.message_type"] !== undefined) fail("a line in another form was not kept as it came");
    break;
  }
  default:
    fail(`unknown claim ${claim}`);
}
EOF
cp "${WORK_DIR}/check.js" "${WORK_DIR}/sink/check.js"

check() {
  docker run --rm -v "${WORK_DIR}/sink":/sink:ro "${NODE_IMAGE}" node /sink/check.js /sink "${ARRAY_NAME}" "$@"
}

if [ -z "${RECORD_DIR}" ]; then
  wait_for "every part of the cluster to reach OneUptime" 240 check metrics-arrived
else
  # The shipped intervals: a part whose first scrape came before the
  # exporter answered is read again 5 minutes later.
  wait_for "every part of the cluster to reach OneUptime" 780 check metrics-arrived
fi
check metrics || fail "the metrics are not what OneUptime reads"
echo "==> metrics: every part, the array's identity, the node state and the used percents"

# ---- Credentials --------------------------------------------------------------
fake_log="$(compose logs --no-log-prefix fake-powerstore 2>&1)"
grep -q 'login_session user matched, password matched exactly' <<<"${fake_log}" ||
  fail "the exporter's login did not carry the password exactly"
grep -q 'latest_five_min_metrics/enable user matched, password matched exactly' <<<"${fake_log}" ||
  fail "the exporter did not turn the bulk archive on"
grep -q 'POST /api/rest/latest_five_min_metrics/download 200' <<<"${fake_log}" ||
  fail "the exporter did not download the bulk archive"
if grep -q 'did not match' <<<"${fake_log}"; then
  fail "a request carried other credentials"
fi
if grep -q 'UNKNOWN' <<<"${fake_log}"; then
  fail "the exporter asked the stand-in for something it does not answer"
fi
for service in powerstore-exporter oneuptime-storage-array-agent powerstore-syslog; do
  if compose logs --no-log-prefix "${service}" 2>&1 | grep -qF "${PASSWORD}"; then
    fail "${service} logged the password"
  fi
done
echo "==> credentials: the exporter logs in with .env's password exactly, and nothing logs it"

# ---- Syslog -------------------------------------------------------------------
SAMPLES="${FIXTURES_DIR}/syslog-samples.txt"
sent=0
while IFS= read -r line; do
  [ -n "${line}" ] || continue
  printf '%s\n' "${line}" >"/dev/tcp/127.0.0.1/${SYSLOG_PORT}" || fail "could not send syslog over TCP"
  sent=$((sent + 1))
done <"${SAMPLES}"
UDP_LINE='<106>Nov 26 09:05:00 PS4f5c9a3d21e7-A [358]: 2026-11-26T09:04:58 PS4f5c9a3d21e7-A PS4f5c9a3d21e7 358@7XKQ2T3 AlertEvent [PowerStore_remote_logging_alert@1139 sequence_number="60005" event_name="NODE_FAILED" resource_type="node" resource_name="BaseEnclosure-NodeB" alert_id="9a8b7c6d-5e4f-4321-8765-0fedcba98765" alert_state="Active" appliance_name="ps-prod-01-appliance-1" event_id="7e8f9012-3456-4c7d-e8f9-012345678901" event_code="0x00302B08" system_impact="" repair_flow=""] The Node has failed to start services.'
printf '%s' "${UDP_LINE}" >"/dev/udp/127.0.0.1/${SYSLOG_PORT}" || fail "could not send syslog over UDP"
sent=$((sent + 1))
wait_for "the syslog to reach OneUptime" 90 check logs-arrived "${sent}"
check logs || fail "the syslog is not what the alert templates read"
echo "==> syslog: PowerStore's records parsed over TCP and UDP, severities from Dell's codes"

if [ -n "${RECORD_DIR}" ]; then
  mkdir -p "${RECORD_DIR}/collector"
  cp "${WORK_DIR}/sink/metrics.jsonl" "${RECORD_DIR}/collector/metrics.jsonl"
  cp "${WORK_DIR}/sink/logs.jsonl" "${RECORD_DIR}/collector/syslog.jsonl"
  # Per object: the same exporter with the bulk archive off.
  sed -i 's/^POWERSTORE_BULK_METRICS=.*$//' "${WORK_DIR}/.env"
  echo "POWERSTORE_BULK_METRICS=false" >>"${WORK_DIR}/.env"
  compose up -d --force-recreate powerstore-exporter >/dev/null 2>&1 || fail "the exporter did not restart per object"
  wait_for "the exporter to serve per object" 120 exporter_answers
  record_parts "${RECORD_DIR}/per-object"
  echo "==> recorded the per-object answers"
fi

echo "ok: the PowerStore agent reads the stand-in cluster and its syslog as OneUptime expects"
