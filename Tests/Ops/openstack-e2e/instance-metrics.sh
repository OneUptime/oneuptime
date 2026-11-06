#!/usr/bin/env bash
#
# Record what the two sources of real VM metrics say about instances doing known
# things, at the same moments:
#
#   ou-burner   spins on its CPU, writes to its disk and sends packets
#   ou-running  sits idle, and has a volume attached
#   ou-stopped  is shut off, which is how a libvirt counter reads when it has no
#               process behind it
#
# So the product's rates, its "same shape from either source" and what a hypervisor
# says about its busiest instance are all tested on what really came out, rather
# than on what the exporters' source code suggests.
#
# After the drills on purpose, so the scenes they recorded hold the estate they
# always held. Writes under OUTPUT_DIR/instance-metrics:
#
#   scrape-01/at.txt          when this scrape began, in seconds since the epoch
#   scrape-01/libvirt.prom    what the libvirt exporter answered
#   scrape-01/ceilometer.prom what Ceilometer's exporter answered
#   servers.json              what Nova says each instance is, and where it is
#   hypervisors.json          and each hypervisor
#   status.txt                each scrape's status, so an empty answer is explained
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/instance-metrics.sh

set -uo pipefail

OUTPUT_DIR="${OUTPUT_DIR:-out}"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"
TARGET="$OUTPUT_DIR/instance-metrics"
SCRAPES="${INSTANCE_METRICS_SCRAPES:-12}"
SPACING_SECONDS="${INSTANCE_METRICS_SPACING_SECONDS:-30}"
LIBVIRT_URL="${LIBVIRT_EXPORTER_URL:-http://127.0.0.1:9177/metrics}"
CEILOMETER_URL="${CEILOMETER_EXPORTER_URL:-http://127.0.0.1:9101/metrics}"

mkdir -p "$TARGET"
: >"$TARGET/status.txt"

IMAGE="$(openstack image list --status active -f value -c Name | grep -i cirros | head -1)"

# Busy on all three at once. Busybox's dd has conv=fsync, which is what makes the
# writes reach the disk rather than the guest's page cache.
USER_DATA="$(mktemp)"
cat >"$USER_DATA" <<'EOF'
#!/bin/sh
while :; do :; done &
while :; do dd if=/dev/zero of=/root/ou-burn bs=1M count=8 conv=fsync 2>/dev/null; sleep 2; done &
while :; do ping -c 20 -i 0.2 -s 1400 -W 1 "$(ip route | awk '/default/ {print $3; exit}')" >/dev/null 2>&1 || ping -c 20 -i 0.2 -s 1400 -W 1 10.78.0.1 >/dev/null 2>&1; sleep 1; done &
EOF

export OS_PROJECT_NAME=ou-research
if ! openstack server show ou-burner >/dev/null 2>&1; then
  openstack server create --flavor ou.tiny --image "$IMAGE" --network ou-research-net \
    --config-drive true --user-data "$USER_DATA" ou-burner >/dev/null
fi
for attempt in $(seq 1 60); do
  [ "$(openstack server show ou-burner -f value -c status 2>/dev/null)" = "ACTIVE" ] && break
  sleep 5
  : "$attempt"
done
unset OS_PROJECT_NAME

# Its first polling cycle, and the guest's own boot, have to pass before a reading says
# anything about the loop: cirros takes about a minute on a runner without nested KVM.
sleep "${INSTANCE_METRICS_SETTLE_SECONDS:-120}"

scrape() {
  local url="$1" file="$2" label="$3" code
  code="$(curl -sS --max-time 20 -o "$file" -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
  printf '%s %s %s\n' "$(basename "$(dirname "$file")")" "$label" "$code" >>"$TARGET/status.txt"
  [ "$code" = "200" ] && [ -s "$file" ] || rm -f "$file"
}

for number in $(seq -w 1 "$SCRAPES"); do
  folder="$TARGET/scrape-$number"
  mkdir -p "$folder"
  date +%s >"$folder/at.txt"
  scrape "$LIBVIRT_URL" "$folder/libvirt.prom" libvirt
  scrape "$CEILOMETER_URL" "$folder/ceilometer.prom" ceilometer
  sleep "$SPACING_SECONDS"
done

openstack server list --all-projects --long -f json >"$TARGET/servers.json" 2>/dev/null || true
openstack hypervisor list --long -f json >"$TARGET/hypervisors.json" 2>/dev/null || true

cat "$TARGET/status.txt"

# Which names came out, for whoever reads the run's log before the artifact.
for source in libvirt ceilometer; do
  file="$TARGET/scrape-$(printf '%02d' 1)/$source.prom"
  if [ -f "$file" ]; then
    echo "--- $source: $(grep -vc '^#' "$file") series in the first scrape"
    grep -v '^#' "$file" | sed -E 's/[{ ].*//' | sort -u | head -80
  else
    echo "--- $source: nothing recorded"
  fi
done
