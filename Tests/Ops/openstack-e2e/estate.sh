#!/usr/bin/env bash
#
# Build the known estate the OpenStack recordings are made from, on a cloud
# DevStack just deployed. Every page, health rule and alert template in the
# OpenStack product is tested on what this estate makes a real cloud answer,
# so it holds one of everything worth telling apart: instances running, shut
# off and failed, volumes available, attached and in error, a network with a
# router and floating IPs, two projects to own them.
#
# Idempotent enough to run twice on one cloud, because a step that fails
# half-way on a CI runner is cheaper to run again than a DevStack is to
# deploy. Names all start with "ou-", so nothing else in the cloud is touched.
#
# Usage: OS_CLOUD=devstack-admin bash Tests/Ops/openstack-e2e/estate.sh

set -euo pipefail

export OS_CLOUD="${OS_CLOUD:-devstack-admin}"

log() {
  printf '\n=== %s\n' "$*"
}

# The id of the named thing, or nothing when it does not exist yet.
id_of() {
  openstack "$@" -f value -c ID 2>/dev/null | head -1 || true
}

wait_for_server() {
  local name="$1" wanted="$2" project="$3" status="" attempt
  for attempt in $(seq 1 90); do
    status="$(openstack server show "$name" --os-project-name "$project" -f value -c status 2>/dev/null || true)"
    if [ "$status" = "$wanted" ]; then
      echo "$name is $wanted"
      return 0
    fi
    # A server that went to ERROR on its own will never become what was
    # asked for: say so now rather than after the full wait.
    if [ "$status" = "ERROR" ] && [ "$wanted" != "ERROR" ]; then
      openstack server show "$name" --os-project-name "$project" -f value -c fault >&2 || true
      echo "$name went to ERROR while waiting for $wanted" >&2
      return 1
    fi
    sleep 5
    : "$attempt"
  done
  echo "$name did not reach $wanted (it is $status)" >&2
  return 1
}

wait_for_volume() {
  local name="$1" wanted="$2" project="$3" status="" attempt
  for attempt in $(seq 1 60); do
    status="$(openstack volume show "$name" --os-project-name "$project" -f value -c status 2>/dev/null || true)"
    if [ "$status" = "$wanted" ]; then
      echo "$name is $wanted"
      return 0
    fi
    sleep 5
    : "$attempt"
  done
  echo "$name did not reach $wanted (it is $status)" >&2
  return 1
}

log "Projects and their quotas"
for project in ou-payments ou-research; do
  openstack project show "$project" >/dev/null 2>&1 \
    || openstack project create --domain default --description "OneUptime test estate" "$project" >/dev/null
  # admin needs a role on the project to create resources in it.
  openstack role add --project "$project" --user admin member >/dev/null
done
# Instances low enough that the estate itself comes close, so quota series have
# something to say. Memory high enough for ou.impossible: quota is checked before
# scheduling, and the failure wanted here is the scheduler's.
openstack quota set --instances 4 --cores 8 --ram 2097152 ou-payments
openstack quota set --instances 20 --cores 40 --ram 40960 ou-research

log "Flavors"
openstack flavor show ou.tiny >/dev/null 2>&1 \
  || openstack flavor create --vcpus 1 --ram 128 --disk 1 ou.tiny >/dev/null
# No hypervisor can hold this one, so an instance of it fails with Nova's
# "No valid host" and its fault message: the failure operators see most.
openstack flavor show ou.impossible >/dev/null 2>&1 \
  || openstack flavor create --vcpus 1 --ram 1048576 --disk 1 ou.impossible >/dev/null

log "Image"
IMAGE="$(openstack image list --status active -f value -c Name | grep -i cirros | head -1)"
[ -n "$IMAGE" ] || { echo "DevStack left no cirros image" >&2; exit 1; }
echo "Using $IMAGE"

log "Network, subnet, router and floating IPs"
export OS_PROJECT_NAME=ou-payments
openstack network show ou-net >/dev/null 2>&1 || openstack network create ou-net >/dev/null
openstack subnet show ou-subnet >/dev/null 2>&1 \
  || openstack subnet create --network ou-net --subnet-range 10.77.0.0/24 ou-subnet >/dev/null
openstack router show ou-router >/dev/null 2>&1 || {
  openstack router create ou-router >/dev/null
  openstack router set --external-gateway public ou-router
  openstack router add subnet ou-router ou-subnet
}
openstack security group show ou-web >/dev/null 2>&1 || {
  openstack security group create ou-web >/dev/null
  # Open to the world on purpose: the audit issue's risky-rule check reads it.
  openstack security group rule create --protocol tcp --dst-port 22 --remote-ip 0.0.0.0/0 ou-web >/dev/null
}

log "Instances"
boot() {
  local name="$1" flavor="$2"
  openstack server show "$name" >/dev/null 2>&1 \
    || openstack server create --flavor "$flavor" --image "$IMAGE" --network ou-net \
      --security-group ou-web --property owner=ou-payments "$name" >/dev/null
}
boot ou-running ou.tiny
boot ou-stopped ou.tiny
boot ou-failed ou.impossible
wait_for_server ou-running ACTIVE ou-payments
wait_for_server ou-stopped ACTIVE ou-payments
wait_for_server ou-failed ERROR ou-payments
openstack server stop ou-stopped
wait_for_server ou-stopped SHUTOFF ou-payments

log "Floating IPs: one attached, one spare"
if ! openstack floating ip list --tags ou-attached -f value -c ID | grep -q .; then
  ATTACHED_IP="$(openstack floating ip create public --tag ou-attached -f value -c floating_ip_address)"
  openstack server add floating ip ou-running "$ATTACHED_IP"
fi
if ! openstack floating ip list --tags ou-spare -f value -c ID | grep -q .; then
  openstack floating ip create public --tag ou-spare >/dev/null
fi

log "Volumes: available, attached and in error"
make_volume() {
  local name="$1"
  openstack volume show "$name" >/dev/null 2>&1 || openstack volume create --size 1 "$name" >/dev/null
  wait_for_volume "$name" available ou-payments
}
if openstack volume service list >/dev/null 2>&1; then
  make_volume ou-vol-free
  if [ "$(openstack volume show ou-vol-used -f value -c status 2>/dev/null || true)" != "in-use" ]; then
    make_volume ou-vol-used
    openstack server add volume ou-running ou-vol-used >/dev/null
    wait_for_volume ou-vol-used in-use ou-payments
  fi
  if [ "$(openstack volume show ou-vol-bad -f value -c status 2>/dev/null || true)" != "error" ]; then
    make_volume ou-vol-bad
    # A cloud admin forcing the state is the only way a healthy backend
    # produces this on demand; what the series then say is the same.
    OS_PROJECT_NAME=admin openstack volume set --state error "$(openstack volume show ou-vol-bad -f value -c id)"
  fi
  openstack volume snapshot show ou-snap >/dev/null 2>&1 \
    || openstack volume snapshot create --volume ou-vol-free ou-snap >/dev/null
else
  echo "No volume service in this cloud: leaving volumes out of the estate."
fi

log "A second project's instance, so that a part's blast radius has two owners"
export OS_PROJECT_NAME=ou-research
openstack network show ou-research-net >/dev/null 2>&1 || openstack network create ou-research-net >/dev/null
openstack subnet show ou-research-subnet >/dev/null 2>&1 \
  || openstack subnet create --network ou-research-net --subnet-range 10.78.0.0/24 ou-research-subnet >/dev/null
openstack server show ou-research-1 >/dev/null 2>&1 \
  || openstack server create --flavor ou.tiny --image "$IMAGE" --network ou-research-net ou-research-1 >/dev/null
wait_for_server ou-research-1 ACTIVE ou-research
unset OS_PROJECT_NAME

log "The estate"
openstack server list --all-projects -c Name -c Status -c "Flavor"
openstack volume list --all-projects -c Name -c Status 2>/dev/null || true
openstack floating ip list -c "Floating IP Address" -c Status 2>/dev/null || true
openstack compute service list
openstack network agent list
openstack volume service list 2>/dev/null || true
