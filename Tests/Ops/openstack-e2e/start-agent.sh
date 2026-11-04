#!/usr/bin/env bash
#
# Start the OpenStack agent's pinned exporter and collector against the cloud
# DevStack deployed on this runner, with the collector's real config. The
# collector writes what it would send to a file instead, so the recording holds
# exactly the OTLP OneUptime would ingest, attributes and all.
#
# Beside it runs the exporter's last non-alpha release, for record.sh to
# compare: see "To settle" on the epic.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$HERE/../../../agents/OpenStackAgent"
OUTPUT_DIR="${OUTPUT_DIR:-out}"

# Read the pins from what ships, so this rig can never test another version.
EXPORTER_IMAGE="$(grep -E '^[[:space:]]*image:[[:space:]]*ghcr.io/openstack-exporter/' "$AGENT_DIR/docker-compose.yml" | head -1 | awk '{print $2}')"
COLLECTOR_IMAGE="$(grep -E '^[[:space:]]*image:[[:space:]]*otel/opentelemetry-collector-contrib' "$AGENT_DIR/docker-compose.yml" | head -1 | awk '{print $2}')"
EXPORTER_STABLE_IMAGE="${EXPORTER_STABLE_IMAGE:-ghcr.io/openstack-exporter/openstack-exporter:1.7.0}"

[ -n "$EXPORTER_IMAGE" ] && [ -n "$COLLECTOR_IMAGE" ] || {
  echo "Could not read the agent's image pins from $AGENT_DIR/docker-compose.yml" >&2
  exit 1
}

mkdir -p "$OUTPUT_DIR/otlp"
chmod 0777 "$OUTPUT_DIR/otlp"

# DevStack's clouds.yaml is the credential: its admin cloud on this runner.
CLOUDS_FILE=/etc/openstack/clouds.yaml
sudo chmod a+r "$CLOUDS_FILE"

docker run -d --name ou-openstack-exporter --network host \
  -v "$CLOUDS_FILE:/etc/openstack/clouds.yaml:ro" \
  "$EXPORTER_IMAGE" --multi-cloud --web.listen-address=:9180 --os-client-config=/etc/openstack/clouds.yaml \
  --disable-slow-metrics --disable-metric=neutron-ports --disable-metric=neutron-port \
  --disable-metric=neutron-ports_no_ips --disable-metric=neutron-ports_lb_not_active

docker run -d --name ou-openstack-exporter-stable --network host \
  -v "$CLOUDS_FILE:/etc/openstack/clouds.yaml:ro" \
  "$EXPORTER_STABLE_IMAGE" --multi-cloud --web.listen-address=:9181 --os-client-config=/etc/openstack/clouds.yaml

docker run -d --name ou-openstack-collector --network host \
  -v "$(cd "$AGENT_DIR" && pwd)/otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro" \
  -v "$HERE/collector-recording.yaml:/etc/otelcol-contrib/recording.yaml:ro" \
  -v "$(cd "$OUTPUT_DIR" && pwd)/otlp:/recording" \
  -e ONEUPTIME_URL=http://127.0.0.1:9 \
  -e ONEUPTIME_TELEMETRY_INGESTION_KEY=recording \
  -e OPENSTACK_CLOUD_NAME=devstack \
  -e OPENSTACK_EXPORTER_CLOUDS='[devstack-admin]' \
  -e OPENSTACK_EXPORTER_ADDRESS=127.0.0.1:9180 \
  "$COLLECTOR_IMAGE" --config=/etc/otelcol-contrib/config.yaml --config=/etc/otelcol-contrib/recording.yaml

# The exporter answers once it is listening. Keystone's answer is the real test,
# and a scrape of the identity service exercises it.
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 60 "http://127.0.0.1:9180/probe?cloud=devstack-admin&include_services=identity" | grep -q '^openstack_identity_up'; then
    echo "The exporter reads the cloud."
    exit 0
  fi
  sleep 5
  : "$attempt"
done

docker logs ou-openstack-exporter 2>&1 | tail -40 >&2
echo "The exporter never read the cloud." >&2
exit 1
