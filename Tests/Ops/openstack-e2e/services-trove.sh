#!/usr/bin/env bash
#
# Trove on a real DevStack. Its plugin builds a guest image while it deploys, and a database
# instance is a VM that pulls its database from a container registry, so whether one reaches
# ACTIVE on a runner is what this finds out. What it records (#5744):
#
#   baseline            Trove's lists, before any instance
#   instance-building   an instance on its way, in BUILD
#   instance-active     that instance ACTIVE, if a runner can get it there
#   instance-error      an instance Nova refuses, in ERROR
#   taskmanager-down    trove-taskmanager stopped
#   api-down            Trove's API stopped
#
# instance-active is allowed to fail, and fails the job if it does, with why in failed.txt.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/services-trove.sh

set -euo pipefail

# shellcheck source=Tests/Ops/openstack-e2e/services-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/services-lib.sh"

export RECORD_SERVICES="database compute identity"

instance_status() {
  openstack database instance show "$1" -f value -c status
}

log "The estate"
services_base
# Trove's plugin installs its command line only from git, and this deploys from the release.
openstack database instance list >/dev/null 2>&1 || ensure_client python-troveclient
services_network admin ou-db-net 10.79.0.0/24
openstack flavor show ou.db >/dev/null 2>&1 \
  || openstack flavor create --vcpus 1 --ram 1536 --disk 10 ou.db >/dev/null
NETWORK="$(openstack network show ou-db-net -f value -c id)"
DATASTORE="${TROVE_DATASTORE_TYPE:-mysql}"
DATASTORE_VERSION="$(openstack datastore version list "$DATASTORE" -f value -c Name | head -1)"
echo "Datastore $DATASTORE $DATASTORE_VERSION on network $NETWORK"

make_instance() {
  local name="$1" flavor="$2"
  openstack database instance show "$name" >/dev/null 2>&1 \
    || openstack database instance create "$name" --flavor "$flavor" --size 1 \
      --nic "net-id=$NETWORK" --datastore "$DATASTORE" --datastore-version "$DATASTORE_VERSION" >/dev/null
}

drive_baseline() {
  note "On its own: Trove's lists before any instance. Guest image: $(openstack image list --tag trove -f value -c Name | head -1)."
  openstack datastore list || true
  openstack datastore version list "$DATASTORE" || true
}

scene baseline \
  "Trove's lists, before any instance." \
  drive_baseline

drive_instance_building() {
  make_instance ou-db-ok ou.db
  wait_for "ou-db-ok" BUILD 24 5 instance_status ou-db-ok
  note "On its own: an instance on its way."
}

scene instance-building \
  "A database instance in BUILD." \
  drive_instance_building

# Booting the guest, pulling the database image from inside it, and starting the database:
# upstream's own job gives this forty minutes, on machines larger than this one.
drive_instance_active() {
  local status=""
  for _ in $(seq 1 120); do
    status="$(instance_status ou-db-ok 2>/dev/null || true)"
    case "$status" in
      ACTIVE | ERROR) break ;;
    esac
    sleep 20
  done
  openstack database instance show ou-db-ok || true
  openstack server list --all-projects --name ou-db-ok -c ID -c Name -c Status -c Host || true
  if [ "$status" != ACTIVE ]; then
    note "It did not reach ACTIVE on this runner: it is $status."
    # Nova's fault only says it ran out of retries. Why is in nova-compute's own log, which later
    # steps would push out of what the job keeps.
    sudo journalctl -u devstack@n-cpu.service --no-pager -n 3000 >"$OUTPUT_DIR/instance-active/n-cpu.log" || true
    grep -E " ERROR |Failed to|Exception" "$OUTPUT_DIR/instance-active/n-cpu.log" | tail -40 || true
    return 1
  fi
  note "On its own: the guest booted, pulled its database and came up on this runner."
}

scene instance-active \
  "That instance ACTIVE, if a runner can get it there." \
  drive_instance_active

drive_instance_error() {
  make_instance ou-db-no-host ou.impossible
  wait_for "ou-db-no-host" ERROR 72 5 instance_status ou-db-no-host
  note "On its own: Nova refused it, and Trove gave up. The instance's fault says Nova's reason."
  openstack database instance show ou-db-no-host || true
}

scene instance-error \
  "A database instance in ERROR, because Nova refused it." \
  drive_instance_error

drive_taskmanager_down() {
  stop_unit devstack@tr-tmgr.service
  sleep 30
  note "On its own: trove-taskmanager is stopped. Trove's lists do not ask it for anything, and it has no service list to say so."
}

undo_taskmanager_down() {
  start_unit devstack@tr-tmgr.service
}

scene taskmanager-down \
  "trove-taskmanager stopped." \
  drive_taskmanager_down undo_taskmanager_down

# A site of Apache's on this release, not a unit of its own.
drive_api_down() {
  sudo a2dissite trove-api
  sudo systemctl reload apache2
  sleep 10
  note "On its own: Trove's API is stopped, by taking its site off Apache, which is how DevStack runs it."
}

undo_api_down() {
  sudo a2ensite trove-api
  sudo systemctl reload apache2
}

scene api-down \
  "Trove's API stopped." \
  drive_api_down undo_api_down

finish_scenes
