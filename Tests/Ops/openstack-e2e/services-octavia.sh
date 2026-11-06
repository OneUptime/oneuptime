#!/usr/bin/env bash
#
# Octavia on a real DevStack: load balancers on the amphora provider, which boots real VMs on
# the runner's KVM, and on the ovn provider, which boots none. What it records (#5741):
#
#   baseline                   a load balancer ACTIVE and ONLINE on the amphora provider, with traffic
#   baseline-one-minute-later  the same, so a rate can be read from the stats between the two
#   active-standby             a pair of amphorae on one load balancer, MASTER and BACKUP
#   ovn-provider               a load balancer on the ovn provider
#   pool-members-down          every member of a pool failing its health checks
#   pending-update             stuck in PENDING_UPDATE, because the worker that would finish it is stopped
#   pending-create             stuck in PENDING_CREATE, the same way
#   lb-error                   a load balancer in ERROR, because Nova would not boot its amphora
#   amphora-near-expiry        an amphora's certificate three weeks from expiring, written into its row
#   two-masters                an active-standby pair with both masters, written into its row
#   amphora-error              an amphora in ERROR, written into its row
#   api-down                   Octavia's API stopped, with the amphorae and their traffic still running
#   recovered                  everything started again
#
# Which amphora read needs Octavia's admin rule is in octavia-policy.txt beside the scenes, and
# access-matrix.sh runs on this cloud afterwards, as every group's job does.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/services-octavia.sh

set -euo pipefail

# shellcheck source=Tests/Ops/openstack-e2e/services-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/services-lib.sh"

export RECORD_SERVICES="load-balancer compute identity"

lb_field() {
  openstack loadbalancer show "$1" -f value -c "$2"
}

lb_provisioning() {
  lb_field "$1" provisioning_status
}

# What creating an amphora costs under nested KVM: a few minutes, and more on a busy runner.
wait_lb_active() {
  wait_for_either "Load balancer $1" ACTIVE ERROR 180 10 lb_provisioning "$1"
}

log "The estate: a network, two web servers and a client to send them traffic"
services_base
services_network ou-payments ou-net 10.77.0.0/24
IMAGE="$(cirros_image)"
[ -n "$IMAGE" ] || {
  echo "DevStack left no cirros image" >&2
  exit 1
}

export OS_PROJECT_NAME=ou-payments
SUBNET_ID="$(openstack subnet show ou-net-subnet -f value -c id)"
openstack security group show ou-web >/dev/null 2>&1 || {
  openstack security group create ou-web >/dev/null
  openstack security group rule create --protocol tcp --dst-port 22 --remote-ip 0.0.0.0/0 ou-web >/dev/null
}
# On its own, so the members-down scene can take it away and give it back.
openstack security group rule create --protocol tcp --dst-port 80 --remote-ip 0.0.0.0/0 ou-web -f value -c id >"$OUTPUT_DIR/.web-rule" 2>/dev/null \
  || true

WEB_USER_DATA="$(mktemp)"
cat >"$WEB_USER_DATA" <<'USERDATA'
#!/bin/sh
# The usual member on cirros: answer on port 80, forever. The length tells a client when it has
# the whole answer, or it and nc would each wait for the other to hang up.
while true; do printf 'HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nok\n' | nc -l -p 80 >/dev/null 2>&1; done &
USERDATA

for server in ou-web-1 ou-web-2; do
  openstack server show "$server" >/dev/null 2>&1 \
    || openstack server create --flavor ou.tiny --image "$IMAGE" --network ou-net --security-group ou-web \
      --config-drive true --user-data "$WEB_USER_DATA" "$server" >/dev/null
done
wait_for_either "ou-web-1" ACTIVE ERROR 60 5 server_status ou-web-1
wait_for_either "ou-web-2" ACTIVE ERROR 60 5 server_status ou-web-2
WEB_1="$(openstack server show ou-web-1 -f json -c addresses | python3 -I -c 'import json,sys; print(list(json.load(sys.stdin)["addresses"].values())[0][0])')"
WEB_2="$(openstack server show ou-web-2 -f json -c addresses | python3 -I -c 'import json,sys; print(list(json.load(sys.stdin)["addresses"].values())[0][0])')"
echo "Members will be $WEB_1 and $WEB_2"
unset OS_PROJECT_NAME

log "Which amphora reads need Octavia's admin rule, in the words of its own policy"
{
  echo "\$ oslopolicy-policy-generator --namespace octavia"
  for tool in oslopolicy-policy-generator /opt/stack/data/venv/bin/oslopolicy-policy-generator; do
    if command -v "$tool" >/dev/null 2>&1; then
      "$tool" --namespace octavia 2>/dev/null | grep -E '^"?(os_load-balancer_api:amphora:|load-balancer:(admin|read|read-global|global_observer|observer_and_owner|member_and_owner)|context_is_admin)' || true
      break
    fi
  done
  echo "\$ [certificates] and [house_keeping] on this cloud"
  sudo grep -E '^(cert_validity_time|cert_expiry_buffer|cert_generator|spare_amphora_pool_size)' /etc/octavia/octavia.conf || echo "(all at their defaults)"
} >"$OUTPUT_DIR/octavia-policy.txt" 2>&1
cat "$OUTPUT_DIR/octavia-policy.txt"

log "The load balancers, all at once: an amphora takes minutes to boot, and these do not depend on each other"
PAYMENTS="$(openstack project show ou-payments -f value -c id)"
create_lb() {
  local name="$1"
  shift
  openstack loadbalancer show "$name" >/dev/null 2>&1 \
    || openstack loadbalancer create --name "$name" --vip-subnet-id "$SUBNET_ID" --project "$PAYMENTS" "$@" >/dev/null
}

create_lb ou-lb --provider amphora

# Octavia's flavor is how one load balancer asks for a pair where the cloud's default is one.
active_standby_flavor() {
  openstack loadbalancer flavorprofile show ou-ha >/dev/null 2>&1 \
    || openstack loadbalancer flavorprofile create --name ou-ha --provider amphora \
      --flavor-data '{"loadbalancer_topology": "ACTIVE_STANDBY"}' >/dev/null
  openstack loadbalancer flavor show ou-ha >/dev/null 2>&1 \
    || openstack loadbalancer flavor create --name ou-ha --flavorprofile ou-ha --enable >/dev/null
}
ACTIVE_STANDBY=1
if ! active_standby_flavor || ! create_lb ou-lb-ha --provider amphora --flavor ou-ha; then
  ACTIVE_STANDBY=0
  echo "No active-standby load balancer on this cloud: its scenes will say so."
fi

# The ovn provider only exists on this backend, and needs none of the runner's memory.
OVN_PROVIDER=0
if openstack loadbalancer provider list -f value -c name | grep -qx ovn; then
  if create_lb ou-lb-ovn --provider ovn; then
    OVN_PROVIDER=1
  fi
else
  echo "No ovn provider on this cloud: leaving that one out."
fi

AMPHORA_PROVIDER=1
wait_lb_active ou-lb || AMPHORA_PROVIDER=0

# Each step leaves the load balancer PENDING_UPDATE for a moment, and the next refuses until
# it is back: 409 is Octavia's answer to going too soon.
add_member() {
  local lb="$1" pool="$2" address="$3" number="$4"
  openstack loadbalancer member show "$pool" "$pool-member-$number" >/dev/null 2>&1 \
    || openstack loadbalancer member create --name "$pool-member-$number" --subnet-id "$SUBNET_ID" \
      --address "$address" --protocol-port 80 "$pool" >/dev/null
  wait_lb_active "$lb"
}

add_http_service() {
  local lb="$1"
  openstack loadbalancer listener show "$lb-listener" >/dev/null 2>&1 \
    || openstack loadbalancer listener create --name "$lb-listener" --protocol HTTP --protocol-port 80 "$lb" >/dev/null
  wait_lb_active "$lb"
  openstack loadbalancer pool show "$lb-pool" >/dev/null 2>&1 \
    || openstack loadbalancer pool create --name "$lb-pool" --listener "$lb-listener" --protocol HTTP --lb-algorithm ROUND_ROBIN >/dev/null
  wait_lb_active "$lb"
  openstack loadbalancer healthmonitor show "$lb-monitor" >/dev/null 2>&1 \
    || openstack loadbalancer healthmonitor create --name "$lb-monitor" --type HTTP --delay 5 --timeout 3 --max-retries 2 "$lb-pool" >/dev/null
  wait_lb_active "$lb"
  add_member "$lb" "$lb-pool" "$WEB_1" 1
  add_member "$lb" "$lb-pool" "$WEB_2" 2
}

lb_operating() {
  lb_field "$1" operating_status
}

# The ovn provider has its own rules: TCP or UDP listeners, SOURCE_IP_PORT, and no HTTP health
# monitor, so its member reads NO_MONITOR. It is here, whichever way the amphorae go.
drive_ovn_provider() {
  if [ "$OVN_PROVIDER" = 0 ]; then
    note "The ovn provider is not on this cloud, or would not take a load balancer."
    return 1
  fi
  wait_lb_active ou-lb-ovn
  openstack loadbalancer listener show ou-lb-ovn-listener >/dev/null 2>&1 \
    || openstack loadbalancer listener create --name ou-lb-ovn-listener --protocol TCP --protocol-port 80 ou-lb-ovn >/dev/null
  wait_lb_active ou-lb-ovn
  openstack loadbalancer pool show ou-lb-ovn-pool >/dev/null 2>&1 \
    || openstack loadbalancer pool create --name ou-lb-ovn-pool --listener ou-lb-ovn-listener --protocol TCP --lb-algorithm SOURCE_IP_PORT >/dev/null
  wait_lb_active ou-lb-ovn
  add_member ou-lb-ovn ou-lb-ovn-pool "$WEB_1" 1
  note "On its own, on the ovn provider, which boots no VM and has no amphora rows."
}

# If a runner cannot boot an amphora, say so with what it did say, and record what the ovn
# provider can show. Nothing below this block has to care which it was.
if [ "$AMPHORA_PROVIDER" = 0 ]; then
  drive_amphora_failed() {
    note "The amphora provider did not finish on this runner: ou-lb is $(lb_provisioning ou-lb)."
    openstack loadbalancer amphora list || true
    openstack server list --all-projects --name amphora -c ID -c Name -c Status -c Host || true
    sudo journalctl -u devstack@o-cw.service --no-pager -n 60 || true
    return 1
  }
  drive_ovn_error() {
    db octavia "UPDATE load_balancer SET provisioning_status='ERROR', operating_status='ERROR' WHERE name='ou-lb-ovn'"
    note "Written into its row: the amphora provider, which would reach this on its own, did not run here."
  }
  undo_ovn_error() {
    db octavia "UPDATE load_balancer SET provisioning_status='ACTIVE', operating_status='ONLINE' WHERE name='ou-lb-ovn'"
  }
  drive_ovn_api_down() {
    stop_unit devstack@o-api.service
    sleep 10
    note "On its own: Octavia's API is stopped."
  }
  undo_ovn_api_down() {
    start_unit devstack@o-api.service
  }
  scene amphora-provider-failed "What the amphora provider said when it could not finish on this runner." drive_amphora_failed
  scene ovn-provider "A load balancer ACTIVE on the ovn provider, with a member." drive_ovn_provider
  scene lb-error "That load balancer in ERROR." drive_ovn_error undo_ovn_error
  scene api-down "Octavia's API stopped." drive_ovn_api_down undo_ovn_api_down
  finish_scenes
  exit 1
fi

stats_field() {
  openstack loadbalancer stats show "$1" -f value -c "$2" 2>/dev/null
}

traffic_moved() {
  local connections
  connections="$(stats_field ou-lb total_connections || echo 0)"
  [ "${connections:-0}" -gt 0 ] && echo yes || echo no
}

start_client() {
  local vip user_data
  vip="$(lb_field ou-lb vip_address)"
  user_data="$(mktemp)"
  cat >"$user_data" <<USERDATA
#!/bin/sh
# A request a second, and beside each one something no HTTP server can read, so request_errors moves.
while true; do
  wget -q -O /dev/null "http://$vip/" >/dev/null 2>&1
  printf 'NOT HTTP\r\n\r\n' | nc -w 1 "$vip" 80 >/dev/null 2>&1
  sleep 1
done &
USERDATA
  export OS_PROJECT_NAME=ou-payments
  openstack server show ou-client >/dev/null 2>&1 \
    || openstack server create --flavor ou.tiny --image "$IMAGE" --network ou-net --security-group ou-web \
      --config-drive true --user-data "$user_data" ou-client >/dev/null
  wait_for_either "ou-client" ACTIVE ERROR 60 5 server_status ou-client
  unset OS_PROJECT_NAME
}

drive_baseline() {
  add_http_service ou-lb
  start_client
  wait_for "ou-lb operating status" ONLINE 40 15 lb_operating ou-lb
  # Stats reach Octavia with an amphora's heartbeat, every 10 seconds.
  wait_for "traffic through ou-lb" yes 40 15 traffic_moved
  note "On its own: the amphora provider booted a real amphora, its members answer their health monitor, and a client inside the network is sending traffic."
  openstack loadbalancer amphora list || true
}

drive_one_minute_later() {
  sleep 60
  note "Nothing changed but the traffic, so what stats_* says here minus what it says in baseline is a rate over about a minute."
}

drive_active_standby() {
  if [ "$ACTIVE_STANDBY" = 0 ]; then
    note "Octavia would not take an active-standby load balancer on this cloud."
    return 1
  fi
  wait_lb_active ou-lb-ha
  add_http_service ou-lb-ha
  wait_for "ou-lb-ha operating status" ONLINE 40 15 lb_operating ou-lb-ha
  note "On its own: two amphorae on one load balancer, one MASTER and one BACKUP."
  openstack loadbalancer amphora list --loadbalancer ou-lb-ha || true
}

scene baseline \
  "A load balancer ACTIVE and ONLINE on the amphora provider, with traffic through it." \
  drive_baseline
scene baseline-one-minute-later \
  "The same about a minute later, with the traffic still flowing." \
  drive_one_minute_later
scene active-standby \
  "A load balancer with a pair of amphorae, MASTER and BACKUP." \
  drive_active_standby
scene ovn-provider \
  "A load balancer ACTIVE on the ovn provider, with a member." \
  drive_ovn_provider

# Every member fails its checks because the security group stops letting them through, which
# is what a member's service dying looks like from Octavia, and can be undone without a reboot.
pool_operating() {
  openstack loadbalancer pool show ou-lb-pool -f value -c operating_status
}

drive_members_down() {
  local rule
  rule="$(cat "$OUTPUT_DIR/.web-rule" 2>/dev/null || true)"
  [ -n "$rule" ] || rule="$(OS_PROJECT_NAME=ou-payments openstack security group rule list ou-web --protocol tcp --dst-port 80 -f value -c ID | head -1)"
  OS_PROJECT_NAME=ou-payments openstack security group rule delete "$rule"
  rm -f "$OUTPUT_DIR/.web-rule"
  wait_for "ou-lb-pool operating status" ERROR 40 15 pool_operating
  note "On their own: every member started failing its health monitor once the security group stopped letting checks through."
  openstack loadbalancer member list ou-lb-pool || true
  openstack loadbalancer status show ou-lb || true
}

undo_members_down() {
  OS_PROJECT_NAME=ou-payments openstack security group rule create --protocol tcp --dst-port 80 --remote-ip 0.0.0.0/0 ou-web >/dev/null
  wait_for "ou-lb-pool operating status" ONLINE 40 15 pool_operating
}

scene pool-members-down \
  "Every member of ou-lb-pool failing its health monitor, with the load balancer still provisioning ACTIVE." \
  drive_members_down undo_members_down

# The worker carries out what the API accepts. With it stopped, a change is accepted and never
# finished, which is the stuck state operators see when a worker dies or RabbitMQ loses a message.
drive_pending_update() {
  stop_unit devstack@o-cw.service
  openstack loadbalancer listener set --description "OneUptime drill: nobody will finish this" ou-lb-listener
  wait_for "ou-lb provisioning status" PENDING_UPDATE 12 5 lb_provisioning ou-lb
  note "On its own: the worker is stopped, so the API's change is accepted and nothing finishes it."
}

scene pending-update \
  "ou-lb stuck in PENDING_UPDATE, because the worker that would finish its listener's change is stopped." \
  drive_pending_update

drive_pending_create() {
  openstack loadbalancer create --name ou-lb-pending --vip-subnet-id "$SUBNET_ID" --project "$PAYMENTS" --provider amphora >/dev/null
  wait_for "ou-lb-pending provisioning status" PENDING_CREATE 12 5 lb_provisioning ou-lb-pending
  note "On its own: the worker is still stopped, so the new load balancer is accepted and nothing builds it."
}

undo_pending() {
  start_unit devstack@o-cw.service
  wait_lb_active ou-lb
  wait_lb_active ou-lb-pending
  # A gigabyte of the runner back, and nothing later reads it.
  openstack loadbalancer delete ou-lb-pending
}

scene pending-create \
  "ou-lb-pending stuck in PENDING_CREATE, for the same reason." \
  drive_pending_create undo_pending

# Quota on the project amphorae boot in is the plainest real way to get there: Nova refuses the
# amphora, and the worker gives up on the load balancer. The database is the fallback.
AMPHORA_PROJECT=""
drive_lb_error() {
  local compute
  compute="$(openstack loadbalancer amphora list -f value -c id | head -1)"
  compute="$(openstack loadbalancer amphora show "$compute" -f value -c compute_id)"
  AMPHORA_PROJECT="$(openstack server show "$compute" -f value -c project_id)"
  printf '%s' "$AMPHORA_PROJECT" >"$OUTPUT_DIR/.amphora-project"
  openstack quota show "$AMPHORA_PROJECT" -f value -c instances >"$OUTPUT_DIR/.amphora-quota" 2>/dev/null || true
  # Forced: Nova refuses a limit below what the running amphorae already use.
  openstack quota set --force --instances 0 "$AMPHORA_PROJECT"

  openstack loadbalancer create --name ou-lb-failed --vip-subnet-id "$SUBNET_ID" --project "$PAYMENTS" --provider amphora >/dev/null
  if wait_for "ou-lb-failed provisioning status" ERROR 60 10 lb_provisioning ou-lb-failed; then
    note "On its own: Nova refused the amphora, because the project amphorae boot in has no instance quota, and the worker gave up."
  else
    note "Written into its row, because the worker had not given up after ten minutes: UPDATE load_balancer SET provisioning_status='ERROR'."
    db octavia "UPDATE load_balancer SET provisioning_status='ERROR', operating_status='ERROR' WHERE name='ou-lb-failed'"
  fi
}

undo_lb_error() {
  local project quota
  project="$(cat "$OUTPUT_DIR/.amphora-project" 2>/dev/null || true)"
  quota="$(cat "$OUTPUT_DIR/.amphora-quota" 2>/dev/null || true)"
  [ -z "$project" ] || openstack quota set --instances "${quota:-10}" "$project"
}

scene lb-error \
  "ou-lb-failed in ERROR, because Nova would not boot its amphora." \
  drive_lb_error undo_lb_error

# These three rows are written: nothing on a runner makes a certificate near expiry, or two
# masters, without waiting weeks or splitting a network the amphorae do not stand on.
amphora_of() {
  local lb_id role="$2" id
  lb_id="$(lb_field "$1" id)"
  id="$(db octavia "SELECT id FROM amphora WHERE load_balancer_id='$lb_id' AND role='$role' LIMIT 1" 2>/dev/null | tail -1)"
  # An UPDATE of no row would succeed, and the scene would record nothing it claims to.
  case "$id" in
    "" | id)
      echo "ou: $1 has no $role amphora" >&2
      return 1
      ;;
  esac
  printf '%s' "$id"
}

drive_near_expiry() {
  local id
  id="$(amphora_of ou-lb STANDALONE)"
  db octavia "SELECT cert_expiration FROM amphora WHERE id='$id'" | tail -1 >"$OUTPUT_DIR/.cert-expiration"
  printf '%s' "$id" >"$OUTPUT_DIR/.near-expiry-amphora"
  db octavia "UPDATE amphora SET cert_expiration = DATE_ADD(NOW(), INTERVAL 21 DAY) WHERE id='$id'"
  note "Written into its row, three weeks from now: nothing on a runner gets near expiry on its own. baseline holds what a real amphora's certificate says here, and octavia-policy.txt what sets it."
}

undo_near_expiry() {
  db octavia "UPDATE amphora SET cert_expiration = '$(cat "$OUTPUT_DIR/.cert-expiration")' WHERE id='$(cat "$OUTPUT_DIR/.near-expiry-amphora")'"
}

scene amphora-near-expiry \
  "An amphora whose certificate expires in three weeks." \
  drive_near_expiry undo_near_expiry

drive_two_masters() {
  local id
  id="$(amphora_of ou-lb-ha BACKUP)"
  printf '%s' "$id" >"$OUTPUT_DIR/.backup-amphora"
  db octavia "UPDATE amphora SET role='MASTER' WHERE id='$(cat "$OUTPUT_DIR/.backup-amphora")'"
  note "Written into its row: what a split pair reads as. Nothing here split it."
}

undo_two_masters() {
  db octavia "UPDATE amphora SET role='BACKUP' WHERE id='$(cat "$OUTPUT_DIR/.backup-amphora")'"
}

scene two-masters \
  "An active-standby pair whose rows both say MASTER." \
  drive_two_masters undo_two_masters

drive_amphora_error() {
  db octavia "UPDATE amphora SET status='ERROR' WHERE id='$(cat "$OUTPUT_DIR/.backup-amphora")'"
  note "Written into its row. The health manager would replace a real one."
}

undo_amphora_error() {
  db octavia "UPDATE amphora SET status='ALLOCATED' WHERE id='$(cat "$OUTPUT_DIR/.backup-amphora")'"
}

scene amphora-error \
  "An amphora in ERROR, beside a healthy one." \
  drive_amphora_error undo_amphora_error

drive_api_down() {
  stop_unit devstack@o-api.service
  sleep 10
  note "On its own: Octavia's API is stopped, and its amphorae and their traffic carry on without it."
}

undo_api_down() {
  start_unit devstack@o-api.service
  wait_for "Octavia's API" ACTIVE 24 5 lb_provisioning ou-lb
}

scene api-down \
  "Octavia's API stopped." \
  drive_api_down undo_api_down

drive_recovered() {
  wait_lb_active ou-lb
  note "Everything started again."
}

scene recovered "Everything back as it was in baseline, with ou-lb-failed still in ERROR." drive_recovered

finish_scenes
