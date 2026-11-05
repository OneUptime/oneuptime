#!/usr/bin/env bash
#
# What each project's quotas really say, on estate.sh's projects: the agent leaves these off
# unless asked, so nothing else here records them. Starts the exporter the agent starts for
# them, with the flags docker-compose.yml gives it, and the agent's real collector config with
# its hourly jobs asked once a minute, so a run does not wait up to an hour for a first read.
# Everything else about those jobs is what ships.
#
# Writes under OUTPUT_DIR:
#
#   quotas/exporter/<service>.prom  what the quota exporter says, one service at a time
#   quotas/exporter/status.txt      each scrape's status and duration
#   quotas/cli.txt                  what the openstack CLI says, for a person to check it against
#   quotas/otlp/metrics.json        what the collector would have sent to OneUptime
#   logs/ou-openstack-quota-*.log   the containers' logs
#
# Usage: OUTPUT_DIR=out OS_CLOUD=devstack-admin bash Tests/Ops/openstack-e2e/quota-record.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$HERE/../../../agents/OpenStackAgent"
OUTPUT_DIR="${OUTPUT_DIR:-out}"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"
REGION="${OPENSTACK_REGION:-RegionOne}"
EXPORTER_PORT=9183

# Read from what ships, so this can never record another exporter or other flags.
EXPORTER_IMAGE="$(grep -E '^[[:space:]]*image:[[:space:]]*ghcr.io/openstack-exporter/' "$AGENT_DIR/docker-compose.yml" | head -1 | awk '{print $2}')"
COLLECTOR_IMAGE="$(grep -E '^[[:space:]]*image:[[:space:]]*otel/opentelemetry-collector-contrib' "$AGENT_DIR/docker-compose.yml" | head -1 | awk '{print $2}')"
EXPORTER_FLAGS="$(sed -n '/^  openstack-quota-exporter:$/,/^  [a-z-]*:$/p' "$AGENT_DIR/docker-compose.yml" | grep -E '^[[:space:]]*- --disable-metric=' | sed -E 's/^[[:space:]]*- //' | tr '\n' ' ')"

[ -n "$EXPORTER_IMAGE" ] && [ -n "$COLLECTOR_IMAGE" ] && [ -n "$EXPORTER_FLAGS" ] || {
  echo "Could not read the quota exporter from $AGENT_DIR/docker-compose.yml" >&2
  exit 1
}

SCENE_DIR="$OUTPUT_DIR/quotas"
mkdir -p "$SCENE_DIR/exporter" "$SCENE_DIR/otlp" "$OUTPUT_DIR/logs"
chmod 0777 "$SCENE_DIR/otlp"

CLOUDS_FILE="$(mktemp)"
CONFIG_FILE="$(mktemp)"
finish() {
  for name in ou-openstack-quota-collector ou-openstack-quota-exporter; do
    docker logs "$name" >"$OUTPUT_DIR/logs/$name.log" 2>&1 || true
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  rm -f "$CLOUDS_FILE" "$CONFIG_FILE"
}
trap finish EXIT

# Named for the region, as the agent names each clouds.yaml entry.
sudo sed "s/^\( *\)devstack-admin:/\1$REGION:/" /etc/openstack/clouds.yaml | sudo tee "$CLOUDS_FILE" >/dev/null
sudo chmod a+r "$CLOUDS_FILE"

# shellcheck disable=SC2086 # One flag per word, on purpose.
docker run -d --name ou-openstack-quota-exporter --network host \
  -v "$CLOUDS_FILE:/etc/openstack/clouds.yaml:ro" \
  "$EXPORTER_IMAGE" --multi-cloud "--web.listen-address=:$EXPORTER_PORT" --os-client-config=/etc/openstack/clouds.yaml \
  $EXPORTER_FLAGS

# What a person would ask of the same projects, to read the series against.
{
  for project in ou-payments ou-research; do
    echo "== openstack limits show --absolute --project $project"
    openstack limits show --absolute --project "$project" || true
    echo "== openstack quota show $project"
    openstack quota show "$project" || true
    echo "== openstack project show $project"
    openstack project show "$project" -f value -c id || true
  done
} >"$SCENE_DIR/cli.txt" 2>&1

ready=0
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 120 "http://127.0.0.1:$EXPORTER_PORT/probe?cloud=$REGION&include_services=compute" | grep -q '^openstack_nova_limits_vcpus_max'; then
    ready=1
    break
  fi
  sleep 5
  : "$attempt"
done
if [ "$ready" != 1 ]; then
  echo "The quota exporter never said a Nova limit: see $OUTPUT_DIR/logs/ou-openstack-quota-exporter.log" >&2
  exit 1
fi

for service in compute network volume; do
  code="$(curl -sS --max-time 600 -o "$SCENE_DIR/exporter/$service.prom" \
    -w '%{http_code} %{time_total}' \
    "http://127.0.0.1:$EXPORTER_PORT/probe?cloud=$REGION&include_services=$service" || echo "000 0")"
  printf '%s %s\n' "$service" "$code" >>"$SCENE_DIR/exporter/status.txt"
done
cat "$SCENE_DIR/exporter/status.txt"

# The real config, asked sooner. Prometheus starts a job at a point in its interval, so at an
# hour the first read could be an hour away. Nothing else about it changes.
sed -E '/prometheus\/quotas:/,/What an instance is really doing/ {
  s/scrape_interval: 3600s/scrape_interval: 60s/
  s/scrape_timeout: 1800s/scrape_timeout: 50s/
}' "$AGENT_DIR/otel-collector-config.yaml" >"$CONFIG_FILE"
chmod a+r "$CONFIG_FILE"

docker run -d --name ou-openstack-quota-collector --network host \
  -v "$CONFIG_FILE:/etc/otelcol-contrib/config.yaml:ro" \
  -v "$HERE/collector-recording.yaml:/etc/otelcol-contrib/recording.yaml:ro" \
  -v "$(cd "$SCENE_DIR/otlp" && pwd):/recording" \
  -e ONEUPTIME_URL=http://127.0.0.1:9 \
  -e ONEUPTIME_TELEMETRY_INGESTION_KEY=recording \
  -e OPENSTACK_CLOUD_NAME=devstack \
  -e 'OPENSTACK_EXPORTER_CLOUDS=[]' \
  -e OPENSTACK_EXPORTER_ADDRESS=127.0.0.1:1 \
  -e "OPENSTACK_QUOTA_CLOUDS=[$REGION]" \
  -e "OPENSTACK_QUOTA_EXPORTER_ADDRESS=127.0.0.1:$EXPORTER_PORT" \
  -e 'OPENSTACK_LIBVIRT_EXPORTER_TARGETS=[]' \
  -e 'OPENSTACK_CEILOMETER_EXPORTER_TARGETS=[]' \
  -e 'OPENSTACK_RABBITMQ_TARGETS=[]' \
  -e 'OPENSTACK_MARIADB_TARGETS=[]' \
  -e 'OPENSTACK_MEMCACHED_TARGETS=[]' \
  -e 'OPENSTACK_HAPROXY_TARGETS=[]' \
  -e 'OPENSTACK_NETWORK_EXPORTER_TARGETS=[]' \
  -e 'OPENSTACK_LIBVIRT_HEALTH_TARGETS=[]' \
  -e "OPENSTACK_CONTROL_PLANE_REGION=$REGION" \
  -e 'OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=[]' \
  -e 'OPENSTACK_AGENT_SERVICES=.*' \
  -e OPENSTACK_AGENT_MEMORY_LIMIT_MIB=512 \
  -e 'OPENSTACK_DATABASE_EXPORTER_TARGETS=[]' \
  -e OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX= \
  -e 'OPENSTACK_WORKER_STATE_CLOUDS=[]' \
  -e OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS=127.0.0.1:1 \
  "$COLLECTOR_IMAGE" --config=/etc/otelcol-contrib/config.yaml --config=/etc/otelcol-contrib/recording.yaml

# Three reads, which is what an alert's window asks of them.
sleep 200

docker stop ou-openstack-quota-collector >/dev/null 2>&1 || true

if [ -s "$SCENE_DIR/otlp/metrics.json" ]; then
  echo "The collector exported $(wc -c <"$SCENE_DIR/otlp/metrics.json") bytes of quota series."
else
  echo "The collector exported no quota series." >&2
  exit 1
fi
