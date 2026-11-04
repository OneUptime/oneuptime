#!/usr/bin/env bash
#
# Break a real OpenStack cloud in the ways that page operators, one at a time,
# and record what its APIs and openstack-exporter then say. The OpenStack
# product's health rules and alert templates are tested on these scenes, above
# all on which series go away and which read 0: guessing that wrong is how a
# template ends up never firing, or never recovering (#5433).
#
#   healthy               the estate as estate.sh left it
#   compute-disabled      nova-compute disabled on purpose: planned work, must
#                         never read as a failure
#   compute-down          nova-compute stopped
#   network-agent-down    the Neutron agent stopped (OVN or ML2/OVS, whichever
#                         this cloud runs)
#   volume-service-down   cinder-volume stopped
#   scheduler-down        nova-scheduler stopped
#   compute-api-down      Nova's API stopped: every other service still answers
#   recovered             everything started again
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/drills.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"
HOST="$(openstack compute service list --service nova-compute -f value -c Host | head -1)"

record() {
  bash "$HERE/record.sh" "$1"
}

# Run a command until its output is the wanted word. OpenStack only notices a
# stopped service when its heartbeat ages past service_down_time (a minute by
# default), so a drill records nothing until the API itself says so.
wait_until() {
  local what="$1" wanted="$2" attempts="${3:-60}" attempt actual=""
  shift 3
  for attempt in $(seq 1 "$attempts"); do
    actual="$("$@" 2>/dev/null || true)"
    if [ "$actual" = "$wanted" ]; then
      echo "$what: $wanted"
      return 0
    fi
    sleep 5
    : "$attempt"
  done
  echo "$what never became $wanted (it is '$actual')" >&2
  return 1
}

compute_state() {
  openstack compute service list --service nova-compute --host "$HOST" -f value -c State
}

scheduler_state() {
  openstack compute service list --service nova-scheduler -f value -c State | sort -u | head -1
}

volume_state() {
  openstack volume service list --service cinder-volume -f value -c State | sort -u | head -1
}

# The units of a running DevStack differ by release and network backend.
unit_exists() {
  systemctl list-unit-files --no-legend "$1" 2>/dev/null | grep -q .
}

network_agent_unit() {
  local unit
  for unit in devstack@q-ovn-agent.service ovn-controller.service devstack@q-agt.service devstack@neutron-agent.service; do
    if unit_exists "$unit"; then
      printf '%s' "$unit"
      return 0
    fi
  done
  return 1
}

any_network_agent_down() {
  if openstack network agent list -f value -c Alive | grep -qiE '^(false|xxx|:-\()$'; then
    echo down
  else
    echo up
  fi
}

echo "Drilling on host $HOST"
record healthy

echo "--- A compute service disabled on purpose"
openstack compute service set --disable --disable-reason "OneUptime drill: planned maintenance" "$HOST" nova-compute
record compute-disabled
openstack compute service set --enable "$HOST" nova-compute

echo "--- nova-compute stopped"
sudo systemctl stop devstack@n-cpu.service
wait_until "nova-compute on $HOST" down 60 compute_state
record compute-down
sudo systemctl start devstack@n-cpu.service
wait_until "nova-compute on $HOST" up 60 compute_state

if UNIT="$(network_agent_unit)"; then
  echo "--- Neutron agent stopped ($UNIT)"
  sudo systemctl stop "$UNIT"
  wait_until "a Neutron agent" down 60 any_network_agent_down
  record network-agent-down
  sudo systemctl start "$UNIT"
  wait_until "every Neutron agent" up 60 any_network_agent_down
else
  echo "No Neutron agent unit found on this cloud: skipping that drill." >&2
fi

if unit_exists devstack@c-vol.service; then
  echo "--- cinder-volume stopped"
  sudo systemctl stop devstack@c-vol.service
  wait_until "cinder-volume" down 60 volume_state
  record volume-service-down
  sudo systemctl start devstack@c-vol.service
  wait_until "cinder-volume" up 60 volume_state
fi

echo "--- nova-scheduler stopped"
sudo systemctl stop devstack@n-sch.service
wait_until "nova-scheduler" down 60 scheduler_state
record scheduler-down
sudo systemctl start devstack@n-sch.service
wait_until "nova-scheduler" up 60 scheduler_state

echo "--- Nova's API stopped"
sudo systemctl stop devstack@n-api.service
sleep 10
record compute-api-down
sudo systemctl start devstack@n-api.service
wait_until "Nova's API" up 24 bash -c 'openstack compute service list >/dev/null 2>&1 && echo up'

record recovered
