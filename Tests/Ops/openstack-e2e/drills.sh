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
#   compute-forced-down   nova-compute forced down by an operator, while it runs: Nova
#                         says so in forced_down, and the exporter has no such label
#   compute-down          nova-compute stopped
#   network-agent-down    the Neutron agent stopped (OVN or ML2/OVS, whichever
#                         this cloud runs)
#   volume-service-down   cinder-volume stopped
#   scheduler-down        nova-scheduler stopped
#   compute-api-down      Nova's API stopped: every other service still answers
#   external-network-full an external network with no addresses left
#   router-agents-removed a router taken off the only L3 agent holding it: no series is
#                         left to say so (ML2/OVS only, OVN has no L3 agents)
#   l3-agent-down         the L3 agent stopped, and a floating IP associated meanwhile,
#                         which nothing can bring up (ML2/OVS only)
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

any_l3_agent_down() {
  if openstack network agent list --agent-type l3 -f value -c Alive | grep -qiE '^(false|xxx|:-\()$'; then
    echo down
  else
    echo up
  fi
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

# Why a service will not change state is in its unit and its config, and the job's
# runner is gone by the time anyone reads the failure.
explain() {
  local unit="$1"
  sudo systemctl status --no-pager --lines=5 "$unit" 2>&1 | sed 's/^/  /' >&2 || true
  sudo grep -hE '^(report_interval|service_down_time|agent_down_time)' \
    /etc/nova/nova.conf /etc/nova/nova-cpu.conf /etc/cinder/cinder.conf /etc/neutron/neutron.conf 2>/dev/null \
    | sort -u | sed 's/^/  /' >&2 || true
}

# Stop a service, record the scene once the API says it is down, and start it again.
# One that goes wrong is reported at the end instead of costing the drills after it.
FAILED=()
drill() {
  local scene="$1" unit="$2" what="$3" state="$4"
  echo "--- $what ($unit stopped)"
  sudo systemctl stop "$unit"
  if wait_until "$what" down 60 "$state"; then
    record "$scene"
  else
    explain "$unit"
    FAILED+=("$scene")
  fi
  sudo systemctl start "$unit"
  wait_until "$what" up 60 "$state" || {
    explain "$unit"
    FAILED+=("$scene: it did not come back")
  }
}

# Forced down, from an operator's mouth rather than a missed heartbeat: Nova reads it as
# down at once, while nova-compute goes on running. 2.11 is the microversion it arrived in.
force_compute() {
  openstack --os-compute-api-version 2.11 compute service set "--$1" "$HOST" nova-compute
}

drill_compute_forced_down() {
  echo "--- A compute service forced down by an operator"
  if ! force_compute down; then
    FAILED+=("compute-forced-down: it could not be forced down")
    return 0
  fi
  if wait_until "nova-compute on $HOST, forced" down 12 compute_state; then
    record compute-forced-down
  else
    FAILED+=("compute-forced-down")
  fi
  force_compute up || FAILED+=("compute-forced-down: it could not be let back up")
  wait_until "nova-compute on $HOST, let back up" up 60 compute_state \
    || FAILED+=("compute-forced-down: it did not come back")
}

# Five addresses, and DHCP off so all five are there to take. The network type is the
# cloud's own default, which is all an external network needs for addresses to be taken
# from it: nothing is routed through it. Its own network rather than DevStack's `public`,
# which every other scene needs addresses from.
FULL_POOL="ou-full-pool"

fill_external_pool() {
  local taken=0 total used

  openstack network create --external "$FULL_POOL" >/dev/null || return 1
  openstack subnet create --no-dhcp --network "$FULL_POOL" --subnet-range 203.0.113.0/29 \
    "$FULL_POOL-v4" >/dev/null || return 1

  # One more than it holds, so the last one says Neutron has none left.
  while [ "$taken" -lt 6 ]; do
    if ! openstack floating ip create "$FULL_POOL" >/dev/null 2>&1; then
      break
    fi
    taken=$((taken + 1))
  done

  total="$(openstack ip availability show "$FULL_POOL" -f value -c total_ips)" || return 1
  used="$(openstack ip availability show "$FULL_POOL" -f value -c used_ips)" || return 1
  echo "$FULL_POOL: $used of $total addresses taken, by $taken floating IPs"
  [ -n "$total" ] && [ "$used" = "$total" ] && [ "$total" -gt 0 ]
}

empty_external_pool() {
  local address
  for address in $(openstack floating ip list --network "$FULL_POOL" -f value -c ID 2>/dev/null || true); do
    openstack floating ip delete "$address" || true
  done
  openstack network delete "$FULL_POOL" || FAILED+=("external-network-full: its network is still there")
}

drill_external_network_full() {
  echo "--- An external network with no addresses left"
  if fill_external_pool; then
    record external-network-full
  else
    FAILED+=("external-network-full: it did not fill up")
  fi
  empty_external_pool
}

# What only ML2/OVS has: OVN has no L3 agents, so a router there has none to lose.
drill_router_agents_removed() {
  local agent router
  agent="$(openstack network agent list --agent-type l3 -f value -c ID | head -1)"
  router="$(openstack router list --name ou-router -f value -c ID | head -1)"

  echo "--- A router taken off the only L3 agent holding it"
  if ! openstack network agent remove router --l3 "$agent" "$router"; then
    FAILED+=("router-agents-removed: it could not be taken off $agent")
    return 0
  fi
  record router-agents-removed
  openstack network agent add router --l3 "$agent" "$router" \
    || FAILED+=("router-agents-removed: it could not be put back on $agent")
}

# Neutron leaves a floating IP DOWN until the L3 agent has set it up, so one associated
# while the agent is stopped stays down: the state the floating IP pages and alert read.
drill_l3_agent_down() {
  local spare server unit="devstack@q-l3.service"

  echo "--- The L3 agent stopped"
  sudo systemctl stop "$unit"
  if wait_until "the L3 agent" down 60 any_l3_agent_down; then
    spare="$(openstack floating ip list --tags ou-spare -f value -c "Floating IP Address" | head -1)"
    server="$( (openstack server list --all-projects --name '^ou-stopped$' -f value -c ID || true) | head -1)"
    if [ -n "$spare" ] && [ -n "$server" ] && openstack server add floating ip "$server" "$spare"; then
      record l3-agent-down
      openstack server remove floating ip "$server" "$spare" \
        || FAILED+=("l3-agent-down: $spare is still on $server")
    else
      # The agent being down is worth recording without the address.
      FAILED+=("l3-agent-down: no floating IP could be associated")
      record l3-agent-down
    fi
  else
    explain "$unit"
    FAILED+=("l3-agent-down")
  fi
  sudo systemctl start "$unit"
  wait_until "the L3 agent" up 60 any_l3_agent_down || {
    explain "$unit"
    FAILED+=("l3-agent-down: it did not come back")
  }
}

echo "Drilling on host $HOST"
record healthy

echo "--- A compute service disabled on purpose"
openstack compute service set --disable --disable-reason "OneUptime drill: planned maintenance" "$HOST" nova-compute
record compute-disabled
openstack compute service set --enable "$HOST" nova-compute

drill_compute_forced_down

drill compute-down devstack@n-cpu.service "nova-compute on $HOST" compute_state

if UNIT="$(network_agent_unit)"; then
  drill network-agent-down "$UNIT" "a Neutron agent" any_network_agent_down
else
  echo "No Neutron agent unit found on this cloud: skipping that drill." >&2
fi

if unit_exists devstack@c-vol.service; then
  drill volume-service-down devstack@c-vol.service "cinder-volume" volume_state
fi

drill scheduler-down devstack@n-sch.service "nova-scheduler" scheduler_state

echo "--- Nova's API stopped"
sudo systemctl stop devstack@n-api.service
sleep 10
record compute-api-down
sudo systemctl start devstack@n-api.service
wait_until "Nova's API" up 24 bash -c 'openstack compute service list >/dev/null 2>&1 && echo up'

drill_external_network_full

if unit_exists devstack@q-l3.service; then
  drill_router_agents_removed
  drill_l3_agent_down
else
  echo "No L3 agent unit on this cloud, which is what OVN is: skipping those drills."
fi

record recovered

if [ "${#FAILED[@]}" -gt 0 ]; then
  printf 'A drill did not go as planned: %s\n' "${FAILED[@]}" >&2
  exit 1
fi
