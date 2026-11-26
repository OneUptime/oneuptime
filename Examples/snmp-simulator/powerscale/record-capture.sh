#!/usr/bin/env bash
#
# Record what the Storage Array Agent sends for the simulated PowerScale
# cluster, and write it where the tests read it
# (packages/Common/Tests/Helpers/StorageArray/PowerScale/
# PowerScaleCapture.json).
#
# It replays the three answering nodes' walks (../data/powerscale-node-<n>)
# with snmpsim, runs the collector the agent pins over them with the
# agent's own PowerScale config, and writes the first round of polls (the
# cluster, its quotas and each node) to the file, as OTLP/JSON. Node 3 has
# no walk: its receiver polls an address nothing answers, as an offline
# node's does. Only the order of the series and their timestamps are
# normalized, so a re-recording of unchanged walks and config writes the
# same file.
#
# Needs docker and python3. Usage: bash record-capture.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
AGENT_DIR="${REPO_ROOT}/agents/StorageArrayAgent"
OUTPUT="${REPO_ROOT}/packages/Common/Tests/Helpers/StorageArray/PowerScale/PowerScaleCapture.json"

# The collector docker-compose.yml pins, so the capture is what the agent sends.
COLLECTOR_IMAGE="$(grep -o 'otel/opentelemetry-collector-contrib:[0-9.]*' "${AGENT_DIR}/docker-compose.yml" | head -n 1)"
SIMULATOR_IMAGE="oneuptime-snmp-simulator:local"
NAME="oneuptime-powerscale-capture-$$"
SUBNET_PREFIX="172.30.96"

WORK_DIR="$(mktemp -d)"
chmod 0777 "${WORK_DIR}"

cleanup() {
  docker rm -f "${NAME}-collector" "${NAME}-node-1" "${NAME}-node-2" "${NAME}-node-4" >/dev/null 2>&1 || true
  docker network rm "${NAME}" >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

docker build -q -t "${SIMULATOR_IMAGE}" "${HERE}/.." >/dev/null
docker network create --subnet "${SUBNET_PREFIX}.0/24" "${NAME}" >/dev/null
for node in 1 2 4; do
  docker run -d --name "${NAME}-node-${node}" --network "${NAME}" \
    --ip "${SUBNET_PREFIX}.1${node}" \
    -v "${HERE}/../data/powerscale-node-${node}:/data:ro" \
    "${SIMULATOR_IMAGE}" >/dev/null
done
# snmpsim indexes its data before it answers.
sleep 5

docker run -d --name "${NAME}-collector" --network "${NAME}" \
  -v "${AGENT_DIR}/otel-collector-config.powerscale.yaml:/etc/otelcol-contrib/config.yaml:ro" \
  -v "${HERE}/capture-overlay.yaml:/etc/otelcol-contrib/overlay.yaml:ro" \
  -v "${WORK_DIR}:/capture" \
  -e ONEUPTIME_URL=https://oneuptime.example.com \
  -e ONEUPTIME_TELEMETRY_INGESTION_KEY=capture \
  -e STORAGE_ARRAY_NAME=ps-prod \
  -e STORAGE_SYSTEM=dell.powerscale \
  -e POWERSCALE_ENDPOINT="${SUBNET_PREFIX}.11" \
  -e POWERSCALE_SNMP_COMMUNITY=public \
  -e POWERSCALE_NODE_1="${SUBNET_PREFIX}.11" \
  -e POWERSCALE_NODE_2="${SUBNET_PREFIX}.12" \
  -e POWERSCALE_NODE_3="${SUBNET_PREFIX}.13" \
  -e POWERSCALE_NODE_4="${SUBNET_PREFIX}.14" \
  -e "POWERSCALE_SNMP_RECEIVERS=[snmp/cluster, snmp/quotas, snmp/node-1, snmp/node-2, snmp/node-3, snmp/node-4]" \
  "${COLLECTOR_IMAGE}" \
  --config=/etc/otelcol-contrib/config.yaml \
  --config=/etc/otelcol-contrib/overlay.yaml >/dev/null

# Every receiver polls once as it starts and then every minute (the quotas
# every five): what arrives in the first 30 seconds is one round.
sleep 30
docker rm -f "${NAME}-collector" >/dev/null

python3 -I - "${WORK_DIR}/otlp.jsonl" "${OUTPUT}" <<'PYTHON'
import json
import sys

# 26 November 2026, 09:00 UTC, in nanoseconds: every datapoint's time.
CAPTURE_TIME = "1795770000000000000"

source, output = sys.argv[1], sys.argv[2]
resource_metrics = []
with open(source) as handle:
    for line in handle:
        if line.strip():
            resource_metrics.extend(json.loads(line)["resourceMetrics"])

def attribute_key(point):
    return json.dumps(point.get("attributes", []), sort_keys=True)

for resource in resource_metrics:
    for scope in resource.get("scopeMetrics", []):
        scope["metrics"].sort(key=lambda metric: metric["name"])
        for metric in scope["metrics"]:
            points = metric.get("gauge", metric.get("sum", {})).get("dataPoints", [])
            for point in points:
                point["timeUnixNano"] = CAPTURE_TIME
                point.pop("startTimeUnixNano", None)
                point["attributes"] = sorted(point.get("attributes", []), key=lambda a: a["key"])
            points.sort(key=attribute_key)

resource_metrics.sort(key=lambda resource: json.dumps(resource, sort_keys=True))
names = {
    metric["name"]
    for resource in resource_metrics
    for scope in resource.get("scopeMetrics", [])
    for metric in scope["metrics"]
}
for required in ("powerscale_cluster_health", "powerscale_quota_usage_bytes", "powerscale_node_health"):
    if required not in names:
        raise SystemExit(f"The capture has no {required}: the round was not complete.")

with open(output, "w") as handle:
    json.dump({"resourceMetrics": resource_metrics}, handle, indent=1, sort_keys=True)
    handle.write("\n")
print(f"{output}: {len(names)} metrics")
PYTHON
