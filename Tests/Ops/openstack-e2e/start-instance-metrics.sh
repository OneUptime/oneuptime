#!/usr/bin/env bash
#
# Turn on the two things that can say what an instance is really doing, on the
# cloud DevStack deployed on this runner:
#
#   prometheus-libvirt-exporter, pinned by digest, reading the runner's libvirt
#   through its read-only socket, on the port Kolla-Ansible runs it on.
#
#   Ceilometer's own exporter (`[polling] enable_prometheus_exporter`, from
#   2025.1), when the workflow enabled Ceilometer on this entry. DevStack's plugin
#   has already written ceilometer.conf, so this adds the section to it and restarts
#   the polling agent. oslo.config reads a repeated section as one, so nothing that
#   was there has to be found or moved.
#
# Each is on its own: a cloud where one fails still records the other, and
# instance-metrics.sh says which it got. Nothing the product reads has come from a
# guess about these two: their names and labels are what the recordings say.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/start-instance-metrics.sh

set -uo pipefail

LIBVIRT_EXPORTER_IMAGE="ghcr.io/inovex/prometheus-libvirt-exporter:v2.6.2@sha256:ef97d552166eb72cb471b2bda9adb8588d8d7500b9a001e6f6245e195eef4d80"
LIBVIRT_SOCKET="/var/run/libvirt/libvirt-sock-ro"
CEILOMETER_CONF="/etc/ceilometer/ceilometer.conf"
CEILOMETER_UNIT="devstack@ceilometer-acompute.service"

wait_for_series() {
  local name="$1" url="$2" series="$3" attempt
  for attempt in $(seq 1 24); do
    if curl -fsS --max-time 20 "$url" 2>/dev/null | grep -q "^$series"; then
      echo "$name answers with $series."
      return 0
    fi
    sleep 5
    : "$attempt"
  done
  echo "$name never answered with $series." >&2
  return 1
}

docker run -d --name ou-libvirt-exporter --network host \
  -v "$LIBVIRT_SOCKET:$LIBVIRT_SOCKET:ro" \
  "$LIBVIRT_EXPORTER_IMAGE" >/dev/null \
  || echo "The libvirt exporter did not start." >&2
wait_for_series "The libvirt exporter" "http://127.0.0.1:9177/metrics" "libvirt_up" \
  || docker logs ou-libvirt-exporter 2>&1 | tail -40 >&2

if [ -f "$CEILOMETER_CONF" ] && systemctl cat "$CEILOMETER_UNIT" >/dev/null 2>&1; then
  # Notifications go nowhere on this cloud, and Ceilometer warns that a batch
  # shorter than one metric's samples cuts what its exporter holds.
  sudo tee -a "$CEILOMETER_CONF" >/dev/null <<'EOF'

[polling]
enable_prometheus_exporter = true
prometheus_listen_addresses = 127.0.0.1:9101
enable_notifications = false
batch_size = 1000
EOF
  sudo systemctl restart "$CEILOMETER_UNIT"
  # It only has something to say after a polling cycle: a minute on this rig.
  wait_for_series "Ceilometer's exporter" "http://127.0.0.1:9101/metrics" "ceilometer_" \
    || sudo journalctl -u "$CEILOMETER_UNIT" --no-pager -n 60 >&2
else
  echo "Ceilometer is not deployed here: no exporter to start." >&2
fi

# The workflow carries on either way: a failed source costs its recording, not the drills.
exit 0
