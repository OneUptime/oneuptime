#!/usr/bin/env bash
#
# Heat and Magnum on one real DevStack, because Magnum builds its clusters with Heat. What it
# records (#5743):
#
#   heat-baseline           stacks CREATE_COMPLETE and CREATE_FAILED, in two projects, one of them
#                           owning an instance and a volume
#   heat-held-in-progress   stacks held in CREATE_IN_PROGRESS and UPDATE_IN_PROGRESS by a resource
#                           that takes as long as it is told to
#   heat-update-failed      a stack whose update failed
#   heat-engine-down        the engine stopped: Heat's API asks the engine for most of what it says
#   heat-engine-restarted   what the engine makes of stacks it was working on when it stopped
#   heat-api-down           Heat's API stopped
#   magnum-baseline         a cluster template, and what Magnum says with no cluster yet
#   magnum-creating         clusters CREATE_IN_PROGRESS
#   magnum-failed           a cluster that ran out of its time: CREATE_FAILED
#   magnum-conductor-down   Magnum's conductor stopped
#   magnum-api-down         Magnum's API stopped
#   magnum-real-image       how far a cluster on the real Fedora CoreOS image gets on a runner
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/services-heat-magnum.sh

set -euo pipefail

# shellcheck source=Tests/Ops/openstack-e2e/services-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/services-lib.sh"

export RECORD_SERVICES="orchestration container-infra compute volume identity"

TEMPLATES="$(mktemp -d)"

stack_status() {
  openstack stack show "$1" -f value -c stack_status
}

# Asks Heat which engines it has, which is itself a call to an engine. Up if any is: a stopped
# engine keeps its row for a while after a new one starts.
engine_status() {
  local statuses
  statuses="$(openstack orchestration service list -f value -c Status 2>/dev/null)"
  if printf '%s\n' "$statuses" | grep -qx up; then
    echo up
  elif [ -n "$statuses" ]; then
    echo down
  fi
}

log "The estate"
services_base
# These plugins install their command lines only from git, and this deploys from the release.
openstack stack list >/dev/null 2>&1 || ensure_client python-heatclient
openstack coe cluster list >/dev/null 2>&1 || ensure_client python-magnumclient
services_network ou-payments ou-net 10.77.0.0/24
IMAGE="$(cirros_image)"
[ -n "$IMAGE" ] || {
  echo "DevStack left no cirros image" >&2
  exit 1
}

# What a stack usually owns: an instance, a volume and the attachment between them.
cat >"$TEMPLATES/owns.yaml" <<YAML
heat_template_version: rocky
description: OneUptime test stack, owning an instance and a volume
resources:
  server:
    type: OS::Nova::Server
    properties:
      flavor: ou.tiny
      image: $IMAGE
      networks: [{network: ou-net}]
  volume:
    type: OS::Cinder::Volume
    properties:
      size: 1
  attachment:
    type: OS::Cinder::VolumeAttachment
    properties:
      instance_uuid: {get_resource: server}
      volume_id: {get_resource: volume}
outputs:
  server_id:
    value: {get_resource: server}
YAML

# The failure operators see most: Nova's "No valid host", through Heat.
cat >"$TEMPLATES/no-valid-host.yaml" <<YAML
heat_template_version: rocky
description: OneUptime test stack, asking for an instance no hypervisor can hold
resources:
  server:
    type: OS::Nova::Server
    properties:
      flavor: ou.impossible
      image: $IMAGE
      networks: [{network: ou-net}]
YAML

# Heat's own test resource: it takes as long as it is told, and fails when it is told. No VM,
# so nothing here costs the runner memory, and it is held in progress for as long as a scene needs.
cat >"$TEMPLATES/test-resource.yaml" <<'YAML'
heat_template_version: rocky
description: OneUptime test stack, built on Heat's own test resource
parameters:
  value: {type: string, default: first}
  fail: {type: boolean, default: false}
  create_seconds: {type: number, default: 0}
  update_seconds: {type: number, default: 0}
resources:
  held:
    type: OS::Heat::TestResource
    properties:
      value: {get_param: value}
      fail: {get_param: fail}
      action_wait_secs:
        create: {get_param: create_seconds}
        update: {get_param: update_seconds}
YAML

in_project() {
  local project="$1"
  shift
  OS_PROJECT_NAME="$project" "$@"
}

create_stack() {
  local project="$1" name="$2" template="$3"
  shift 3
  if ! in_project "$project" openstack stack show "$name" >/dev/null 2>&1; then
    in_project "$project" openstack stack create --template "$TEMPLATES/$template" "$@" "$name" >/dev/null
  fi
}

status_in() {
  in_project "$1" openstack stack show "$2" -f value -c stack_status
}

drive_heat_baseline() {
  # The exporter reads as one project and asks Heat for no others, so this holds some in that
  # project and some in another: which of them its series name is what this is here to show.
  create_stack ou-payments ou-stack-ok owns.yaml
  create_stack ou-payments ou-stack-failed no-valid-host.yaml
  create_stack admin ou-stack-admin-ok test-resource.yaml
  create_stack admin ou-stack-admin-failed test-resource.yaml --parameter fail=true
  wait_for_either "ou-stack-ok" CREATE_COMPLETE CREATE_FAILED 72 5 status_in ou-payments ou-stack-ok
  wait_for "ou-stack-failed" CREATE_FAILED 72 5 status_in ou-payments ou-stack-failed
  wait_for "ou-stack-admin-ok" CREATE_COMPLETE 36 5 status_in admin ou-stack-admin-ok
  wait_for "ou-stack-admin-failed" CREATE_FAILED 36 5 status_in admin ou-stack-admin-failed
  note "On their own: Nova said No valid host to one, and Heat's test resource was told to fail by the other."
  in_project ou-payments openstack stack resource list ou-stack-ok || true
}

scene heat-baseline \
  "Stacks CREATE_COMPLETE and CREATE_FAILED in two projects, one owning an instance and a volume." \
  drive_heat_baseline

drive_heat_held() {
  create_stack admin ou-stack-creating test-resource.yaml --parameter create_seconds=3000
  wait_for "ou-stack-creating" CREATE_IN_PROGRESS 24 5 status_in admin ou-stack-creating
  create_stack admin ou-stack-updating test-resource.yaml --parameter update_seconds=3000
  wait_for "ou-stack-updating" CREATE_COMPLETE 36 5 status_in admin ou-stack-updating
  openstack stack update --existing --parameter value=second ou-stack-updating >/dev/null
  wait_for "ou-stack-updating" UPDATE_IN_PROGRESS 24 5 status_in admin ou-stack-updating
  note "On their own: Heat's test resource is taking as long as it was told to, which reads the same as a resource that hangs."
}

scene heat-held-in-progress \
  "Stacks held in CREATE_IN_PROGRESS and UPDATE_IN_PROGRESS." \
  drive_heat_held

drive_heat_update_failed() {
  create_stack admin ou-stack-update-fails test-resource.yaml
  wait_for "ou-stack-update-fails" CREATE_COMPLETE 36 5 status_in admin ou-stack-update-fails
  openstack stack update --existing --parameter fail=true ou-stack-update-fails >/dev/null
  wait_for "ou-stack-update-fails" UPDATE_FAILED 36 5 status_in admin ou-stack-update-fails
  note "On its own: Heat's test resource was told to fail its update."
}

scene heat-update-failed \
  "A stack whose update failed." \
  drive_heat_update_failed

drive_engine_down() {
  stop_unit devstack@h-eng.service
  # Heat's API asks an engine for its lists, so with none left this waits for an RPC timeout,
  # and what the exporter gets during that wait is what this records.
  sleep 90
  note "On its own: the engine is stopped. Heat's API takes its lists from an engine over RPC, so whatever it answers here is what it answers."
}

scene heat-engine-down \
  "Heat's engine stopped, with stacks in progress." \
  drive_engine_down

drive_engine_restarted() {
  start_unit devstack@h-eng.service
  wait_for "Heat's engine" up 36 10 engine_status
  # Heat marks what its dead engine was working on as failed when it restarts.
  wait_for_either "ou-stack-creating" CREATE_FAILED CREATE_COMPLETE 36 10 status_in admin ou-stack-creating || true
  note "On its own: what the engine makes of the stacks it was working on when it stopped."
  openstack stack list || true
}

scene heat-engine-restarted \
  "The engine started again, and what it did with the stacks it left in progress." \
  drive_engine_restarted

drive_heat_api_down() {
  stop_unit devstack@h-api.service
  sleep 10
  note "On its own: Heat's API is stopped."
}

undo_heat_api_down() {
  start_unit devstack@h-api.service
  wait_for "Heat's API" up 36 5 engine_status
}

scene heat-api-down \
  "Heat's API stopped." \
  drive_heat_api_down undo_heat_api_down

# Magnum's only in-tree driver at this release is Heat's, on Fedora CoreOS. DevStack downloads
# the image, and magnum_register_image marks it. A cluster of cirros, marked the same way, gets
# through Magnum's validation and Heat's stack, then waits for an agent cirros does not have:
# which is the real path to CREATE_IN_PROGRESS and, when its own timeout passes, CREATE_FAILED.
cluster_status() {
  openstack coe cluster show "$1" -f value -c status
}

magnum_estate() {
  local file
  openstack keypair show ou-key >/dev/null 2>&1 || openstack keypair create ou-key >/dev/null
  openstack flavor show ou.kube >/dev/null 2>&1 \
    || openstack flavor create --vcpus 1 --ram 512 --disk 2 ou.kube >/dev/null
  if ! openstack image show ou-fake-coreos >/dev/null 2>&1; then
    file="$(mktemp)"
    openstack image save --file "$file" "$IMAGE"
    openstack image create ou-fake-coreos --disk-format qcow2 --container-format bare \
      --property os_distro=fedora-coreos --public --file "$file" >/dev/null
    rm -f "$file"
  fi
}

create_template() {
  local name="$1" image="$2" flavor="$3"
  openstack coe cluster template show "$name" >/dev/null 2>&1 \
    || openstack coe cluster template create "$name" --coe kubernetes --image "$image" \
      --external-network public --flavor "$flavor" --master-flavor "$flavor" \
      --network-driver flannel --docker-storage-driver overlay2 --dns-nameserver 8.8.8.8 \
      --floating-ip-disabled >/dev/null
}

drive_magnum_baseline() {
  magnum_estate
  create_template ou-template ou-fake-coreos ou.kube
  note "On its own: a template, and Magnum's services, with no cluster yet."
  openstack coe cluster template list || true
}

scene magnum-baseline \
  "A cluster template, and what Magnum says with no cluster yet." \
  drive_magnum_baseline

drive_magnum_creating() {
  openstack coe cluster show ou-cluster-times-out >/dev/null 2>&1 \
    || openstack coe cluster create ou-cluster-times-out --cluster-template ou-template --keypair ou-key \
      --master-count 1 --node-count 1 --timeout 8 >/dev/null
  openstack coe cluster show ou-cluster-long >/dev/null 2>&1 \
    || openstack coe cluster create ou-cluster-long --cluster-template ou-template --keypair ou-key \
      --master-count 1 --node-count 1 --timeout 45 >/dev/null
  wait_for "ou-cluster-times-out" CREATE_IN_PROGRESS 24 5 cluster_status ou-cluster-times-out
  note "On its own: Magnum accepted both, and Heat is building their stacks."
  openstack coe cluster list || true
  openstack stack list --nested || true
}

scene magnum-creating \
  "Clusters CREATE_IN_PROGRESS." \
  drive_magnum_creating

drive_magnum_failed() {
  # Eight minutes of its own timeout, and Magnum's conductor noticing on its next sync.
  wait_for "ou-cluster-times-out" CREATE_FAILED 96 10 cluster_status ou-cluster-times-out
  note "On its own: the cluster's Heat stack ran out of its time, waiting for an agent cirros does not have."
  openstack coe cluster show ou-cluster-times-out -c status -c status_reason -c faults -c stack_id || true
}

scene magnum-failed \
  "A cluster that ran out of its time: CREATE_FAILED, beside one still CREATE_IN_PROGRESS." \
  drive_magnum_failed

magnum_conductor_state() {
  openstack coe service list -f value -c state | sort -u | head -1
}

drive_magnum_conductor_down() {
  stop_unit devstack@magnum-cond.service
  wait_for "Magnum's conductor" down 36 10 magnum_conductor_state
  note "On its own: the conductor is stopped, and Magnum's API says so once its heartbeat is old enough."
}

undo_magnum_conductor_down() {
  start_unit devstack@magnum-cond.service
  wait_for "Magnum's conductor" up 36 10 magnum_conductor_state
}

scene magnum-conductor-down \
  "Magnum's conductor stopped." \
  drive_magnum_conductor_down undo_magnum_conductor_down

drive_magnum_api_down() {
  stop_unit devstack@magnum-api.service
  sleep 10
  note "On its own: Magnum's API is stopped."
}

undo_magnum_api_down() {
  start_unit devstack@magnum-api.service
  wait_for "Magnum's conductor" up 24 5 magnum_conductor_state
}

scene magnum-api-down \
  "Magnum's API stopped." \
  drive_magnum_api_down undo_magnum_api_down

# Last, and allowed to fail: what the real image does on a runner. It needs a container registry
# from inside a VM and more memory than the rest of this, so this is an attempt, with a limit.
drive_magnum_real_image() {
  local image terminal=""
  image="$(openstack image list --property os_distro=fedora-coreos -f value -c Name | grep -v ou-fake-coreos | head -1)"
  if [ -z "$image" ]; then
    note "DevStack left no Fedora CoreOS image, so a real cluster was not tried."
    return 0
  fi
  # Six gigabytes of a runner's sixteen: the cirros clusters have said what they had to say.
  openstack coe cluster delete ou-cluster-long ou-cluster-times-out || true
  openstack flavor show ou.kube.real >/dev/null 2>&1 \
    || openstack flavor create --vcpus 2 --ram 3072 --disk 15 ou.kube.real >/dev/null
  create_template ou-template-real "$image" ou.kube.real
  openstack coe cluster create ou-cluster-real --cluster-template ou-template-real --keypair ou-key \
    --master-count 1 --node-count 1 --timeout 25 >/dev/null
  for _ in $(seq 1 90); do
    terminal="$(cluster_status ou-cluster-real 2>/dev/null || true)"
    case "$terminal" in
      CREATE_COMPLETE | CREATE_FAILED) break ;;
    esac
    sleep 20
  done
  note "A cluster on the real image $image, with 25 minutes to finish, reached $terminal on this runner."
  openstack coe cluster show ou-cluster-real -c status -c status_reason -c faults -c master_addresses -c node_addresses || true
}

scene magnum-real-image \
  "How far a cluster on the real Fedora CoreOS image gets on a runner." \
  drive_magnum_real_image

finish_scenes
