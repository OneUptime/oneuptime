#!/usr/bin/env bash
#
# Record what a real Placement says of an estate with more than one host in it, because a
# DevStack's one compute host cannot show the thing the capacity pages exist for: thousands of
# vCPUs free and no room for one large instance. Every scene is real Nova and real Placement.
# Only the three extra hosts are not real machines: nova-compute runs them on its fake driver,
# which reports a fixed size and pretends to boot, and that is all Placement ever knows of a
# host anyway. Their instances have no network, so Neutron is never asked to bind a port on them.
#
# The three hosts are all MediumFakeDriver, 10 vCPUs, 8192 MB and 1028 GB. What differs is what
# an operator sets, which is what the arithmetic has to get right:
#
#                 cpu ratio   ram ratio   reserved MB   capacity (vCPU, MB, GB)
#   ou-cap-1         4.0         1.0          512          40,  7680, 1028
#   ou-cap-2         2.0         1.5         1024          20, 10752, 1028
#   ou-cap-3         1.0         1.0         2048          10,  6144, 1028
#
# Each holds two m1.small (1 vCPU, 2048 MB, 20 GB), so free is 38/3584/988, 18/6656/988 and
# 8/2048/988, and 12 GB of free memory is spread so thinly no host can take ou.fragmented
# (6912 MB). The tests hold the product's counts to a hand calculation on these answers.
#
#   capacity-healthy        the estate as above
#   capacity-host-lost      ou-cap-2's nova-compute stopped: Placement still offers it
#   capacity-host-disabled  ou-cap-3 disabled: Placement stops offering it (COMPUTE_STATUS_DISABLED)
#   capacity-orphan         an allocation on ou-cap-1 no instance owns, and what
#                           nova-manage placement audit says of it
#   capacity-orphan-fixed   after nova-manage placement audit --delete
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/capacity-record.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"
OUTPUT_DIR="${OUTPUT_DIR:-out}"
VENV="${DEVSTACK_VENV:-/opt/stack/data/venv}"
STATE="/var/tmp/ou-capacity"
ZONE="ou-zone-a"

log() {
  printf '\n=== %s\n' "$*"
}

endpoint_of() {
  openstack catalog list -f json | python3 -I -c '
import json, sys
for service in json.load(sys.stdin):
    if service.get("Type") == sys.argv[1] or service.get("type") == sys.argv[1]:
        for endpoint in service.get("Endpoints") or service.get("endpoints") or []:
            if endpoint.get("interface") == "public":
                print(endpoint["url"].rstrip("/"))
                sys.exit(0)
' "$1"
}

export OS_TOKEN
OS_TOKEN="$(openstack token issue -f value -c id)"
export OS_PLACEMENT_URL
OS_PLACEMENT_URL="$(endpoint_of placement)"
export OS_COMPUTE_URL
OS_COMPUTE_URL="$(endpoint_of compute)"

placement_call() {
  python3 -I "$HERE/capacity-placement.py" "$@"
}

start_host() {
  local name="$1"
  sudo systemd-run --unit="ou-capacity-$name" --collect \
    "$VENV/bin/nova-compute" \
    --config-file /etc/nova/nova-cpu.conf \
    --config-file "$STATE/$name.conf" >/dev/null
}

stop_host() {
  sudo systemctl stop "ou-capacity-$1"
}

add_host() {
  local name="$1" cpu_ratio="$2" ram_ratio="$3" reserved_mb="$4"
  sudo mkdir -p "$STATE/$name/instances"
  sudo tee "$STATE/$name.conf" >/dev/null <<CONF
[DEFAULT]
host = $name
compute_driver = fake.MediumFakeDriver
state_path = $STATE/$name
instances_path = $STATE/$name/instances
cpu_allocation_ratio = $cpu_ratio
ram_allocation_ratio = $ram_ratio
disk_allocation_ratio = 1.0
reserved_host_memory_mb = $reserved_mb
reserved_host_disk_mb = 0
CONF
  start_host "$name"
}

# Each state a scene waits for is one OpenStack only notices when a heartbeat ages out.
wait_until() {
  local what="$1" attempts="$2" attempt
  shift 2
  for attempt in $(seq 1 "$attempts"); do
    if "$@" >/dev/null 2>&1; then
      echo "$what"
      return 0
    fi
    sleep 5
    : "$attempt"
  done
  echo "Gave up waiting: $what" >&2
  return 1
}

host_is() {
  [ "$(openstack compute service list --service nova-compute --host "$1" -f value -c State 2>/dev/null)" = "$2" ]
}

provider_of() {
  openstack hypervisor list -f value -c "Hypervisor Hostname" | grep -E "^$1(\.|$)" | head -1
}

is_discovered() {
  sudo "$VENV/bin/nova-manage" cell_v2 discover_hosts >/dev/null 2>&1 || true
  openstack hypervisor list -f value -c "Hypervisor Hostname" | grep -qE "^$1(\.|$)"
}

record() {
  local scene="$1"
  bash "$HERE/record.sh" "$scene"
  OS_TOKEN="$(openstack token issue -f value -c id)"
  placement_call providers "$OUTPUT_DIR/$scene/placement"
  placement_call candidates "$OUTPUT_DIR/$scene/candidates"
  {
    echo "\$ openstack aggregate list --long"
    openstack aggregate list --long || true
    echo "\$ openstack availability zone list --compute --long"
    openstack availability zone list --compute --long || true
  } >>"$OUTPUT_DIR/$scene/cli.txt" 2>&1
}

wait_for_server() {
  local name="$1" attempt status=""
  for attempt in $(seq 1 60); do
    status="$(openstack server show "$name" -f value -c status 2>/dev/null || true)"
    if [ "$status" = "ACTIVE" ]; then
      return 0
    fi
    if [ "$status" = "ERROR" ]; then
      openstack server show "$name" -f value -c fault >&2 || true
      return 1
    fi
    sleep 5
    : "$attempt"
  done
  echo "$name is still $status" >&2
  return 1
}

log "Three more hosts, on the fake driver"
add_host ou-cap-1 4.0 1.0 512
add_host ou-cap-2 2.0 1.5 1024
add_host ou-cap-3 1.0 1.0 2048
for name in ou-cap-1 ou-cap-2 ou-cap-3; do
  wait_until "$name is discovered" 60 is_discovered "$name"
  wait_until "$name is up" 60 host_is "$name" up
done

log "A zone, and an aggregate that overlaps it"
openstack aggregate show ou-rack-a >/dev/null 2>&1 \
  || openstack aggregate create --zone "$ZONE" ou-rack-a >/dev/null
openstack aggregate show ou-gold >/dev/null 2>&1 \
  || openstack aggregate create ou-gold >/dev/null
for name in ou-cap-1 ou-cap-2 ou-cap-3; do
  openstack aggregate add host ou-rack-a "$name" >/dev/null || true
done
openstack aggregate add host ou-gold ou-cap-1 >/dev/null || true
openstack aggregate add host ou-gold ou-cap-2 >/dev/null || true

log "Flavors a hand calculation can tell apart"
# 12 GB of memory is free across the zone, and no host of it has this much.
openstack flavor show ou.fragmented >/dev/null 2>&1 \
  || openstack flavor create --vcpus 1 --ram 6912 --disk 1 ou.fragmented >/dev/null
# Only Placement can answer for this one: inventories do not say who holds a trait.
openstack flavor show ou.gold >/dev/null 2>&1 \
  || openstack flavor create --vcpus 1 --ram 512 --disk 1 \
    --property trait:CUSTOM_OU_GOLD=required ou.gold >/dev/null
placement_call set-trait "$(provider_of ou-cap-1)" CUSTOM_OU_GOLD

log "Two m1.small on each"
IMAGE="$(openstack image list --status active -f value -c Name | grep -i cirros | head -1)"
for name in ou-cap-1 ou-cap-2 ou-cap-3; do
  for count in 1 2; do
    server="ou-cap-$name-$count"
    openstack server show "$server" >/dev/null 2>&1 \
      || openstack server create --flavor m1.small --image "$IMAGE" --nic none \
        --availability-zone "$ZONE:$name" "$server" >/dev/null
  done
done
for name in ou-cap-1 ou-cap-2 ou-cap-3; do
  for count in 1 2; do
    wait_for_server "ou-cap-$name-$count"
  done
done
# A collection's usages are read on every collection, and the fake host reports on its own period.
sleep 30
record capacity-healthy

log "ou-cap-2 lost: Placement still offers it"
stop_host ou-cap-2
wait_until "ou-cap-2 is down" 60 host_is ou-cap-2 down
record capacity-host-lost
start_host ou-cap-2
wait_until "ou-cap-2 is up" 60 host_is ou-cap-2 up

log "ou-cap-3 disabled: Placement stops offering it"
openstack compute service set --disable --disable-reason "Planned work" ou-cap-3 nova-compute
wait_until "ou-cap-3 holds COMPUTE_STATUS_DISABLED" 60 \
  placement_call has-trait "$(provider_of ou-cap-3)" COMPUTE_STATUS_DISABLED
record capacity-host-disabled
openstack compute service set --enable ou-cap-3 nova-compute
wait_until "ou-cap-3 no longer holds COMPUTE_STATUS_DISABLED" 60 \
  bash -c "! python3 -I '$HERE/capacity-placement.py' has-trait '$(provider_of ou-cap-3)' COMPUTE_STATUS_DISABLED"

log "An allocation no instance owns"
ORPHAN="$(python3 -I -c 'import uuid; print(uuid.uuid4())')"
OS_ORPHAN_PROJECT="$(openstack project show admin -f value -c id)"
OS_ORPHAN_USER="$(openstack user show admin -f value -c id)"
export OS_ORPHAN_PROJECT OS_ORPHAN_USER
placement_call orphan "$(provider_of ou-cap-1)" "$ORPHAN"
record capacity-orphan
echo "$ORPHAN" >"$OUTPUT_DIR/capacity-orphan/orphan-consumer.txt"
{
  echo "\$ nova-manage placement audit --verbose"
  # It exits 3 for "found something and deleted nothing", which is what this is for.
  sudo "$VENV/bin/nova-manage" placement audit --verbose || echo "exit code $?"
} | tee "$OUTPUT_DIR/capacity-orphan/nova-manage-audit.txt"
{
  echo "\$ nova-manage placement audit --verbose --delete"
  sudo "$VENV/bin/nova-manage" placement audit --verbose --delete || echo "exit code $?"
} | tee -a "$OUTPUT_DIR/capacity-orphan/nova-manage-audit.txt"
# What the audit did not delete is not worth recording as fixed.
placement_call forget "$ORPHAN" || true
sleep 15
record capacity-orphan-fixed

log "Done: what each host's service said, for whoever reads a failed run"
sudo journalctl --no-pager -n 400 -u 'ou-capacity-*' >"$OUTPUT_DIR/capacity-fake-hosts.log" 2>&1 || true
sudo chown -R "$(id -u)" "$OUTPUT_DIR" 2>/dev/null || true
