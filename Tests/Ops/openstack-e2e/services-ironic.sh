#!/usr/bin/env bash
#
# Ironic on a real DevStack, with fake hardware: its API, conductor and state machine are real,
# and only the power and the disks are not, so every state below is one Ironic reached by doing
# what it does, unless how.txt says otherwise. Nova runs its Ironic driver here, so the
# hypervisor list is the one a real bare metal cloud has. What it records (#5742):
#
#   baseline                 nodes available and active, the conductor alive
#   half-enrolled            a node left in enroll with no resource class or driver details, and
#                            what Nova's hypervisor list and the exporter's compute scrape then say
#   maintenance              a node someone put in maintenance, with their reason
#   clean-failed             cleaning a node with a step that does not exist
#   wait-call-back           a node waiting for an agent that will never call
#   deploy-failed            that node, once Ironic gives up on it
#   power-off-while-active   a node deployed and powered off
#   conductor-down           the conductor stopped
#   api-down                 Ironic's API stopped
#   recovered                everything started again
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/services-ironic.sh

set -euo pipefail

# shellcheck source=Tests/Ops/openstack-e2e/services-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/services-lib.sh"

export RECORD_SERVICES="baremetal compute placement identity"

provision_state() {
  openstack baremetal node show "$1" -f value -c provision_state
}

power_state() {
  openstack baremetal node show "$1" -f value -c power_state
}

# What Nova's Ironic driver wants to see, on a node every part of which is fake.
fake_node() {
  local name="$1"
  shift
  openstack baremetal node show "$name" >/dev/null 2>&1 \
    || openstack baremetal node create --name "$name" --driver fake-hardware \
      --boot-interface fake --deploy-interface fake --management-interface fake --power-interface fake \
      --network-interface noop --resource-class baremetal \
      --property cpus=2 --property memory_mb=4096 --property local_gb=40 --property cpu_arch=x86_64 \
      "$@" >/dev/null
}

to_manageable() {
  openstack baremetal node manage "$1"
  wait_for "$1" manageable 24 5 provision_state "$1"
}

to_available() {
  to_manageable "$1"
  openstack baremetal node provide "$1"
  wait_for "$1" available 36 5 provision_state "$1"
}

hypervisor_count() {
  openstack hypervisor list -f value -c "Hypervisor Hostname" | wc -l | tr -d ' '
}

conductor_alive() {
  openstack baremetal conductor list -f value -c Alive | sort -u | head -1
}

log "The estate"
services_base
PAYMENTS="$(openstack project show ou-payments -f value -c id)"

drive_baseline() {
  fake_node ou-node-available
  to_available ou-node-available
  # Owned by a project, because Ironic answers a project's reader with what that project owns.
  fake_node ou-node-active --owner "$PAYMENTS"
  to_available ou-node-active
  openstack baremetal node deploy ou-node-active
  wait_for "ou-node-active" active 36 5 provision_state ou-node-active
  note "On their own, on fake hardware: Ironic's state machine took each node through it."
  # Nova finds a node on its next periodic, about a minute. What it then says is what this
  # records, whatever it is, so a different count is worth saying and is no failure.
  if wait_for "Nova's hypervisors" 2 24 10 hypervisor_count; then
    note "Nova's Ironic driver lists both as hypervisors."
  else
    note "Nova's hypervisor list has $(hypervisor_count) after four minutes, with two nodes enrolled."
  fi
  openstack hypervisor list || true
}

scene baseline \
  "Two nodes on fake hardware, one available and one active, with Nova's Ironic driver reading them." \
  drive_baseline

# The state that broke an exporter's hypervisor list once (openstack-exporter issue 428).
drive_half_enrolled() {
  openstack baremetal node show ou-node-half >/dev/null 2>&1 \
    || openstack baremetal node create --name ou-node-half --driver fake-hardware >/dev/null
  wait_for "ou-node-half" enroll 12 5 provision_state ou-node-half
  note "On its own: created and left, with no resource class, properties or driver details, as an operator midway through enrolling leaves it."
  # Two of Nova's periodics, so what it says is what it goes on saying, whatever that is. It is
  # not an assertion: this scene is here to find out.
  sleep 150
  openstack hypervisor list || true
  sudo journalctl -u devstack@n-cpu.service --no-pager -n 400 2>/dev/null | grep -E "ou-node-half|$(openstack baremetal node show ou-node-half -f value -c uuid)" | tail -20 || true
}

scene half-enrolled \
  "A node left in enroll, with no resource class or driver details: what Nova's hypervisor list and the exporter's compute scrape then say." \
  drive_half_enrolled

drive_maintenance() {
  fake_node ou-node-maintenance
  to_available ou-node-maintenance
  openstack baremetal node maintenance set ou-node-maintenance --reason "OneUptime drill: a disk being swapped"
  note "On its own: an operator put it in maintenance, with a reason."
}

scene maintenance \
  "A node someone put in maintenance on purpose, with their reason." \
  drive_maintenance

# A clean step nothing provides is refused by the conductor, not the API, which is how a node
# really gets to `clean failed` without a broken disk. It also goes into maintenance by itself.
drive_clean_failed() {
  fake_node ou-node-clean-failed
  to_manageable ou-node-clean-failed
  openstack baremetal node clean ou-node-clean-failed \
    --clean-steps '[{"interface": "deploy", "step": "ou_no_such_step"}]'
  if wait_for "ou-node-clean-failed" "clean failed" 36 5 provision_state ou-node-clean-failed; then
    note "On its own: the conductor could not run the step it was given."
  else
    note "Written into its row, because the conductor did not get there: UPDATE nodes SET provision_state='clean failed'."
    db ironic "UPDATE nodes SET provision_state='clean failed', maintenance=1, maintenance_reason='OneUptime drill', last_error='OneUptime drill: written into this row' WHERE name='ou-node-clean-failed'"
  fi
  openstack baremetal node show ou-node-clean-failed -c provision_state -c maintenance -c maintenance_reason -c last_error || true
}

scene clean-failed \
  "A node in clean failed, with its fault." \
  drive_clean_failed

# The direct deploy interface really waits for an agent to call back, and no agent will on fake
# hardware, so this is Node Stuck Transitioning and then a real deploy failure: DevStack is told
# (IRONIC_CALLBACK_TIMEOUT) to give up in two minutes rather than half an hour.
drive_wait_call_back() {
  local image
  image="$(openstack image list --status active -f value -c ID -c Name | grep -i cirros | head -1 | cut -d' ' -f1)"
  fake_node ou-node-deploy-failed
  openstack baremetal node set ou-node-deploy-failed --deploy-interface direct
  to_available ou-node-deploy-failed
  openstack baremetal node set ou-node-deploy-failed --instance-info "image_source=$image" --instance-info root_gb=1
  openstack baremetal node deploy ou-node-deploy-failed
  wait_for "ou-node-deploy-failed" "wait call-back" 60 5 provision_state ou-node-deploy-failed
  note "On its own: Ironic is waiting for a deploy agent, which does not exist on fake hardware."
}

scene wait-call-back \
  "A node waiting in wait call-back for an agent that will never call." \
  drive_wait_call_back

drive_deploy_failed() {
  if wait_for "ou-node-deploy-failed" "deploy failed" 60 10 provision_state ou-node-deploy-failed; then
    note "On its own: the callback never came, and Ironic gave up."
  else
    note "Written into its row, because Ironic had not given up after ten minutes: UPDATE nodes SET provision_state='deploy failed'."
    db ironic "UPDATE nodes SET provision_state='deploy failed', last_error='OneUptime drill: written into this row' WHERE name='ou-node-deploy-failed'"
  fi
  openstack baremetal node show ou-node-deploy-failed -c provision_state -c last_error || true
}

scene deploy-failed \
  "That node in deploy failed, with its fault." \
  drive_deploy_failed

drive_power_off() {
  openstack baremetal node power off ou-node-active
  wait_for "ou-node-active power" "power off" 24 5 power_state ou-node-active
  note "On its own: an active node powered off by someone, which Ironic records and leaves active."
}

undo_power_off() {
  openstack baremetal node power on ou-node-active
}

scene power-off-while-active \
  "A node that is deployed, with its power off." \
  drive_power_off undo_power_off

drive_conductor_down() {
  stop_unit devstack@ir-cond.service
  # A conductor is called dead when its heartbeat ages past heartbeat_timeout, a minute by default.
  wait_for "the conductor" False 36 10 conductor_alive
  note "On its own: the conductor is stopped, and Ironic's API says so once its heartbeat is old enough."
}

undo_conductor_down() {
  start_unit devstack@ir-cond.service
  wait_for "the conductor" True 36 10 conductor_alive
}

scene conductor-down \
  "Ironic's conductor stopped, with nodes still listed." \
  drive_conductor_down undo_conductor_down

drive_api_down() {
  stop_unit devstack@ir-api.service
  sleep 10
  note "On its own: Ironic's API is stopped."
}

undo_api_down() {
  start_unit devstack@ir-api.service
  wait_for "Ironic's API" available 24 5 provision_state ou-node-available
}

scene api-down \
  "Ironic's API stopped." \
  drive_api_down undo_api_down

drive_recovered() {
  wait_for "the conductor" True 12 5 conductor_alive
  note "Everything started again. The nodes that failed stay failed, as they do on a real cloud."
}

scene recovered \
  "Everything started again." \
  drive_recovered

finish_scenes
