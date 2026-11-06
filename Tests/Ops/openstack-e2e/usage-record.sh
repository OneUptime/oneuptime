#!/usr/bin/env bash
#
# Record what a real cloud's inventory says over a test period, across a resize and a deletion, and
# what's deliberately been left to waste, for the Spend page and its recommendations (#5748).
#
# A recording is one moment, so this makes several, minutes apart, and writes down when each was
# taken. A test replays them through the real scan and adds up what the worker would, against a hand
# calculation of the same times.
#
#   ou-usage-resized   ou.tiny from the start. Resized to ou.small between the 2nd and 3rd readings.
#   ou-usage-deleted   ou.tiny from the start. Deleted between the 4th and 5th readings.
#
#   usage-start          the first reading, which counts nothing
#   usage-before-resize  five minutes on
#   usage-after-resize   the resize has been confirmed
#   usage-before-delete  five minutes on
#   usage-after-delete   the deletion has gone through
#   usage-end            five minutes on
#
# Waste, each with something in use beside it that no rule may name:
#
#   ou-image-unused          private, and nothing has ever booted from it
#   ou-image-used            private, and ou-usage-on-image runs on it
#   ou-image-behind-volume   private, and ou-vol-from-image was made from it
#   ou-image-protected       private, nothing booted from it, and someone said to keep it
#   ou-vol-free, ou-stopped, ou-spare's address and ou-snap come from estate.sh
#
# And four hosts on Nova's fake driver in a zone of their own, because a DevStack's one real host
# can't show a host that could be emptied: three holding two m1.small each (over half their memory)
# and ou-use-quiet holding one ou.tiny. Each is MediumFakeDriver, 10 vCPUs at 4:1 and 8192 MB less
# 512 reserved. The resize has come to land on ou-use-quiet, the emptiest, so as it ended, by hand:
# ou-use-1 holds 4,224 MB (55%) with ou-usage-on-image, the other two busy hosts 4,096 MB (53%), and
# ou-use-quiet an ou.tiny and an ou.small, 384 MB (5%) and 3 of 40 vCPUs (8%). What it holds fits on
# any of them, and with ou-use-quiet gone the other three can still lose a host: 3 x 7,680 MB is
# 23,040, of which 12,800 would be in use, and 15,360 are left after losing one.
#
# Then it runs each rule's command, so a test can hold them to what they say they list.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/usage-record.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"
OUTPUT_DIR="${OUTPUT_DIR:-out}"
VENV="${DEVSTACK_VENV:-/opt/stack/data/venv}"
STATE="/var/tmp/ou-usage"
ZONE="ou-use-zone"
READING_GAP_SECONDS="${READING_GAP_SECONDS:-300}"
# What this run reads: nothing else it does needs Keystone's or Placement's other lists on every scene.
export RECORD_SERVICES="identity compute placement network volume image"

log() {
  printf '\n=== %s\n' "$*"
}

STACK_USER="$(systemctl show devstack@n-cpu.service -p User --value 2>/dev/null || true)"
STACK_USER="${STACK_USER:-root}"

add_host() {
  local name="$1"
  sudo install -d -o "$STACK_USER" "$STATE" "$STATE/$name" "$STATE/$name/instances"
  sudo tee "$STATE/$name.conf" >/dev/null <<CONF
[DEFAULT]
host = $name
compute_driver = fake.MediumFakeDriver
state_path = $STATE/$name
instances_path = $STATE/$name/instances
cpu_allocation_ratio = 4.0
ram_allocation_ratio = 1.0
disk_allocation_ratio = 1.0
reserved_host_memory_mb = 512
reserved_host_disk_mb = 0
CONF
  sudo chmod a+r "$STATE/$name.conf"
  sudo systemd-run --unit="ou-usage-$name" --collect --uid="$STACK_USER" \
    "$VENV/bin/nova-compute" \
    --config-file /etc/nova/nova-cpu.conf \
    --config-file "$STATE/$name.conf" >/dev/null
}

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

host_is_up() {
  [ "$(openstack compute service list --service nova-compute --host "$1" -f value -c State 2>/dev/null)" = "up" ]
}

is_discovered() {
  sudo "$VENV/bin/nova-manage" cell_v2 discover_hosts >/dev/null 2>&1 || true
  openstack hypervisor list -f value -c "Hypervisor Hostname" | grep -qE "^$1(\.|$)"
}

server_status_is() {
  [ "$(openstack server show "$1" -f value -c status 2>/dev/null || true)" = "$2" ]
}

server_is_gone() {
  ! openstack server show "$1" >/dev/null 2>&1
}

volume_status_is() {
  [ "$(openstack volume show "$1" -f value -c status 2>/dev/null || true)" = "$2" ]
}

# A reading, and when it was taken: the time is the whole point of it.
reading() {
  local scene="$1"
  bash "$HERE/record.sh" "$scene"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$OUTPUT_DIR/$scene/recorded-at.txt"
}

boot() {
  local name="$1" flavor="$2" host="$3" image="$4"
  openstack server show "$name" >/dev/null 2>&1 \
    || openstack server create --flavor "$flavor" --image "$image" --nic none \
      --availability-zone "$ZONE:$host" "$name" >/dev/null
}

IMAGE="$(openstack image list --status active -f value -c Name | grep -i cirros | head -1)"
WORK="$(mktemp -d)"

# Ten more instances than a project's default leaves room for, and this all runs as one project.
openstack quota set --instances 50 --cores 100 --ram 204800 \
  "$(openstack token issue -f value -c project_id)"

log "Four hosts, on the fake driver, in a zone of their own"
for name in ou-use-1 ou-use-2 ou-use-3 ou-use-quiet; do
  add_host "$name"
done
for name in ou-use-1 ou-use-2 ou-use-3 ou-use-quiet; do
  wait_until "$name is discovered" 60 is_discovered "$name"
  wait_until "$name is up" 60 host_is_up "$name"
done
openstack aggregate show ou-use-rack >/dev/null 2>&1 \
  || openstack aggregate create --zone "$ZONE" ou-use-rack >/dev/null
for name in ou-use-1 ou-use-2 ou-use-3 ou-use-quiet; do
  openstack aggregate add host ou-use-rack "$name" >/dev/null || true
done

log "Two m1.small on each busy host, and one ou.tiny on the quiet one"
openstack flavor show ou.small >/dev/null 2>&1 \
  || openstack flavor create --vcpus 2 --ram 256 --disk 1 ou.small >/dev/null
for name in ou-use-1 ou-use-2 ou-use-3; do
  for count in 1 2; do
    boot "ou-use-$name-$count" m1.small "$name" "$IMAGE"
  done
done
boot ou-use-quiet-1 ou.tiny ou-use-quiet "$IMAGE"
for name in ou-use-1 ou-use-2 ou-use-3; do
  for count in 1 2; do
    wait_until "ou-use-$name-$count is ACTIVE" 60 server_status_is "ou-use-$name-$count" ACTIVE
  done
done
wait_until "ou-use-quiet-1 is ACTIVE" 60 server_status_is ou-use-quiet-1 ACTIVE

log "What's been left, each beside something in use"
upload() {
  local name="$1" protected="$2"
  openstack image show "$name" >/dev/null 2>&1 && return 0
  head -c 1048576 /dev/zero >"$WORK/blank.raw"
  # shellcheck disable=SC2086 # Nothing, or the one word it says.
  openstack image create --private --disk-format raw --container-format bare \
    $protected --file "$WORK/blank.raw" "$name" >/dev/null
}
upload ou-image-unused ""
upload ou-image-protected "--protected"
# A real image, because what boots from it or is made from it has to get somewhere.
openstack image show ou-image-used >/dev/null 2>&1 || {
  openstack image save --file "$WORK/cirros.img" "$IMAGE"
  openstack image create --private --disk-format qcow2 --container-format bare \
    --file "$WORK/cirros.img" ou-image-used >/dev/null
}
openstack image show ou-image-behind-volume >/dev/null 2>&1 \
  || openstack image create --private --disk-format qcow2 --container-format bare \
    --file "$WORK/cirros.img" ou-image-behind-volume >/dev/null
boot ou-usage-on-image ou.tiny ou-use-1 ou-image-used
wait_until "ou-usage-on-image is ACTIVE" 60 server_status_is ou-usage-on-image ACTIVE
openstack volume show ou-vol-from-image >/dev/null 2>&1 \
  || openstack volume create --size 1 --image ou-image-behind-volume ou-vol-from-image >/dev/null
wait_until "ou-vol-from-image is available" 60 volume_status_is ou-vol-from-image available

log "A test period: a resize and a deletion, with readings between"
boot ou-usage-resized ou.tiny ou-use-1 "$IMAGE"
boot ou-usage-deleted ou.tiny ou-use-1 "$IMAGE"
wait_until "ou-usage-resized is ACTIVE" 60 server_status_is ou-usage-resized ACTIVE
wait_until "ou-usage-deleted is ACTIVE" 60 server_status_is ou-usage-deleted ACTIVE
# Its usages are read on its own period, and a fake host reports on that.
sleep 60

reading usage-start
sleep "$READING_GAP_SECONDS"
reading usage-before-resize

openstack server resize --flavor ou.small ou-usage-resized
wait_until "ou-usage-resized is waiting to be confirmed" 60 server_status_is ou-usage-resized VERIFY_RESIZE
openstack server resize confirm ou-usage-resized
wait_until "ou-usage-resized is ACTIVE again" 60 server_status_is ou-usage-resized ACTIVE
reading usage-after-resize
sleep "$READING_GAP_SECONDS"
reading usage-before-delete

openstack server delete ou-usage-deleted
wait_until "ou-usage-deleted is gone" 60 server_is_gone ou-usage-deleted
reading usage-after-delete
sleep "$READING_GAP_SECONDS"
reading usage-end

log "What each rule's command says"
mkdir -p "$OUTPUT_DIR/usage-commands"
run_command() {
  local file="$1"
  shift
  {
    echo "\$ $*"
    "$@" || echo "exit code $?"
  } >"$OUTPUT_DIR/usage-commands/$file.txt" 2>&1
}
run_command unattached-volume openstack volume list --all-projects --status available --long
run_command spare-floating-ip openstack floating ip list --status DOWN --long
run_command shut-off-instance openstack server list --all-projects --status SHUTOFF --long
run_command unused-image openstack image list --long
run_command old-snapshot openstack volume snapshot list --all-projects --long
run_command movable-host openstack hypervisor list --long
run_command movable-host-instances openstack server list --all-projects --host ou-use-quiet --long

log "What was left running, for whoever reads this later"
openstack server list --all-projects -c Name -c Status -c "Flavor Name" || true
