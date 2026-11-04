#!/usr/bin/env bash
#
# Stop what start-agent.sh started, keep its logs, and fail if the collector
# never exported anything: a recording with no OTLP in it is no recording.

set -uo pipefail

OUTPUT_DIR="${OUTPUT_DIR:-out}"
mkdir -p "$OUTPUT_DIR/logs"
# Throwaway credentials, but a recording should not teach anyone to keep them.
rm -f "$OUTPUT_DIR/clouds.yaml"

for name in ou-openstack-collector ou-openstack-exporter ou-openstack-exporter-stable ou-openstack-exporter-kolla ou-libvirt-exporter; do
  docker logs "$name" >"$OUTPUT_DIR/logs/$name.log" 2>&1 || true
  docker rm -f "$name" >/dev/null 2>&1 || true
done

if [ -s "$OUTPUT_DIR/otlp/metrics.json" ]; then
  echo "The collector exported $(wc -c <"$OUTPUT_DIR/otlp/metrics.json") bytes of OTLP."
else
  echo "The collector exported nothing: see $OUTPUT_DIR/logs/ou-openstack-collector.log" >&2
  exit 1
fi
