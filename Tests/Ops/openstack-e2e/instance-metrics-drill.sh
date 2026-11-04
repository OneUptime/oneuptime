#!/usr/bin/env bash
#
# The long drill behind real VM metrics: a noisy instance and a noisy neighbour, for long
# enough that an alert template's whole 15-minute window fills, then quiet for long enough
# that it empties, with both sources read by the agent's real collector at its real pace
# and Ceilometer polling at its real default of five minutes. What the collector would have
# sent to OneUptime is what gets replayed: otlp/metrics.json. This only makes it happen,
# and says when:
#
#   burn      ou-burner has one vCPU and spins on it, and its disk is throttled by libvirt,
#             which is what a slow backend looks like from above: Instance CPU Saturated
#             and Instance Disk Latency High
#   neighbour ou-hog boots with more vCPUs than the runner has threads, and spins on them
#             all, while the disk's throttle comes off: Hypervisor CPU Saturated, the
#             first two recovering, and every instance on it really waiting for a CPU
#   quiet     both have stopped, on timers in their guests: all of them recover
#
# Then what a counter and a series really do through the things that happen to them:
#
#   ou-running is hard rebooted   every counter it has goes back to nothing
#   ou-burner is shut off         how a source stops talking about an instance
#   ou-hog is deleted             the same, for one that no longer exists
#
# Writes OUTPUT_DIR/instance-metrics-drill/timeline.txt, a line for each of those with its
# time in seconds since the epoch, and servers.json with what Nova says each instance is.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/instance-metrics-drill.sh

set -uo pipefail

OUTPUT_DIR="${OUTPUT_DIR:-out}"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"
TARGET="$OUTPUT_DIR/instance-metrics-drill"
HOLD_SECONDS="${INSTANCE_METRICS_DRILL_HOLD_SECONDS:-1200}"
# A guest's boot, and a first polling cycle after it.
SETTLE_SECONDS="${INSTANCE_METRICS_DRILL_SETTLE_SECONDS:-150}"
POLLING_INTERVAL="${INSTANCE_METRICS_DRILL_POLLING_INTERVAL:-300}"
POLLING_CONF="/etc/ceilometer/polling.yaml"
CEILOMETER_UNIT="devstack@ceilometer-acompute.service"

mkdir -p "$TARGET"
: >"$TARGET/timeline.txt"

mark() {
  printf '%s %s\n' "$(date +%s)" "$1" | tee -a "$TARGET/timeline.txt"
}

wait_for_status() {
  local name="$1" wanted="$2" attempt
  for attempt in $(seq 1 90); do
    [ "$(openstack server show "$name" -f value -c status 2>/dev/null)" = "$wanted" ] && return 0
    sleep 5
    : "$attempt"
  done
  echo "$name never reached $wanted." >&2
  return 1
}

boot() {
  local name="$1" flavor="$2" script="$3"
  OS_PROJECT_NAME=ou-research openstack server create --flavor "$flavor" --image "$IMAGE" \
    --network ou-research-net --config-drive true --user-data "$script" "$name" >/dev/null
  OS_PROJECT_NAME=ou-research wait_for_status "$name" ACTIVE
}

# Nova's name for an instance's domain is only shown to an admin, and its UUID is libvirt's.
domain_of() {
  sudo virsh domname "$(OS_PROJECT_NAME=ou-research openstack server show "$1" -f value -c id 2>/dev/null)"
}

IMAGE="$(openstack image list --status active -f value -c Name | grep -i cirros | head -1)"
THREADS="$(nproc)"

# What a cloud left alone polls at, rather than the minute the rest of the rig asks for.
if [ -f "$POLLING_CONF" ]; then
  sudo sed -i -E "s/^( *interval:).*/\1 $POLLING_INTERVAL/" "$POLLING_CONF"
  sudo systemctl restart "$CEILOMETER_UNIT"
fi
mark "polling-every-$POLLING_INTERVAL"

# More vCPUs than the runner has threads, so nothing on it gets one whenever it wants.
HOG_VCPUS=$((THREADS + 2))
openstack flavor show ou.hog >/dev/null 2>&1 \
  || openstack flavor create --vcpus "$HOG_VCPUS" --ram 256 --disk 1 ou.hog >/dev/null

BURN_SECONDS=$((HOLD_SECONDS * 2 + SETTLE_SECONDS * 2))
BURNER_SCRIPT="$(mktemp)"
cat >"$BURNER_SCRIPT" <<EOF
#!/bin/sh
while :; do :; done &
cpu=\$!
while :; do dd if=/dev/zero of=/root/ou-burn bs=64k count=32 conv=fsync 2>/dev/null; sleep 1; done &
disk=\$!
while :; do ping -c 20 -i 0.2 -s 1400 -W 1 "\$(ip route | awk '/default/ {print \$3; exit}')" >/dev/null 2>&1; sleep 1; done &
net=\$!
sleep $BURN_SECONDS
kill \$cpu \$disk \$net
EOF

HOG_SCRIPT="$(mktemp)"
cat >"$HOG_SCRIPT" <<EOF
#!/bin/sh
pids=""
i=0
while [ \$i -lt $HOG_VCPUS ]; do
  while :; do :; done &
  pids="\$pids \$!"
  i=\$((i + 1))
done
sleep $HOLD_SECONDS
kill \$pids
EOF

boot ou-burner ou.tiny "$BURNER_SCRIPT"
BURNER_DOMAIN="$(domain_of ou-burner)"
sleep "$SETTLE_SECONDS"

# A limit on the disk from above: the guest's requests wait in QEMU, and libvirt counts that
# wait as the time they took, as it would a slow volume backend.
if ! sudo virsh blkdeviotune "$BURNER_DOMAIN" vda --write-iops-sec 4 --live; then
  echo "Could not throttle $BURNER_DOMAIN's disk, so its latency never rises." >&2
fi
mark burn
sleep "$HOLD_SECONDS"

sudo virsh blkdeviotune "$BURNER_DOMAIN" vda --write-iops-sec 0 --live || true
mark neighbour-booting
boot ou-hog ou.hog "$HOG_SCRIPT"
sleep "$SETTLE_SECONDS"
mark neighbour
sleep "$HOLD_SECONDS"

mark quiet
sleep "$((HOLD_SECONDS / 4))"

mark reboot-ou-running
OS_PROJECT_NAME=ou-payments openstack server reboot --hard ou-running >/dev/null
OS_PROJECT_NAME=ou-payments wait_for_status ou-running ACTIVE
sleep "$((HOLD_SECONDS / 4))"

mark stop-ou-burner
OS_PROJECT_NAME=ou-research openstack server stop ou-burner >/dev/null
OS_PROJECT_NAME=ou-research wait_for_status ou-burner SHUTOFF
sleep "$((HOLD_SECONDS / 4))"

mark delete-ou-hog
OS_PROJECT_NAME=ou-research openstack server delete --wait ou-hog >/dev/null
sleep "$((HOLD_SECONDS / 4))"
mark end

openstack server list --all-projects --long -f json >"$TARGET/servers.json" 2>/dev/null || true
openstack hypervisor list --long -f json >"$TARGET/hypervisors.json" 2>/dev/null || true

cat "$TARGET/timeline.txt"
exit 0
