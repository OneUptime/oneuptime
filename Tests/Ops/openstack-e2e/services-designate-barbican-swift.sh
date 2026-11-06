#!/usr/bin/env bash
#
# Designate, Barbican and Swift on one real DevStack, because none of them needs much of a
# runner. What it records (#5744):
#
#   designate-baseline     zones and recordsets ACTIVE, in two projects
#   designate-pending      a zone and a recordset PENDING, with the worker that would finish them stopped
#   designate-error        a zone and a recordset in ERROR, because the DNS server they go to is stopped
#   designate-api-down     Designate's API stopped
#   barbican-baseline      secrets and orders, in two projects
#   barbican-api-down      Barbican's API stopped
#   swift-baseline         containers and objects in two projects, with what /recon says
#   swift-reseller-admin   the same, read by a credential allowed into any account
#   swift-api-down         Swift's proxy stopped, with what /recon says
#   swift-object-down      Swift's object server stopped, with its proxy still answering
#
# The exporter has no reader for Barbican: barbican-no-exporter.txt holds what it says when asked.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/services-designate-barbican-swift.sh

set -euo pipefail

# shellcheck source=Tests/Ops/openstack-e2e/services-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/services-lib.sh"

export RECORD_SERVICES="dns object-store identity"

log "The estate"
services_base
# Barbican's plugin installs its command line only from git, and this deploys from the release.
openstack secret list >/dev/null 2>&1 || ensure_client python-barbicanclient

in_payments() {
  OS_PROJECT_NAME=ou-payments "$@"
}

# ------------------------------------------------------------------ Designate

zone_status() {
  openstack zone show "$1" -f value -c status
}

zone_status_in_payments() {
  in_payments openstack zone show "$1" -f value -c status
}

recordset_status() {
  openstack recordset show "$1" "$2" -f value -c status
}

make_zone() {
  openstack zone show "$1" >/dev/null 2>&1 || openstack zone create --email hostmaster@example.org "$1" >/dev/null
}

make_recordset() {
  local zone="$1" name="$2"
  openstack recordset show "$zone" "$name.$zone" >/dev/null 2>&1 \
    || openstack recordset create --type A --record 192.0.2.10 "$zone" "$name" >/dev/null
}

drive_designate_baseline() {
  make_zone ou-active.example.org.
  wait_for_either "ou-active.example.org." ACTIVE ERROR 36 5 zone_status ou-active.example.org.
  make_recordset ou-active.example.org. www
  wait_for_either "www.ou-active.example.org." ACTIVE ERROR 36 5 recordset_status ou-active.example.org. www.ou-active.example.org.
  in_payments openstack zone show ou-payments.example.org. >/dev/null 2>&1 \
    || in_payments openstack zone create --email hostmaster@example.org ou-payments.example.org. >/dev/null
  wait_for_either "ou-payments.example.org." ACTIVE ERROR 36 5 zone_status_in_payments ou-payments.example.org.
  note "On their own, with Designate's bind9 backend answering."
}

scene designate-baseline \
  "Zones and recordsets ACTIVE, in two projects." \
  drive_designate_baseline

drive_designate_pending() {
  stop_unit devstack@designate-worker.service
  make_zone ou-pending.example.org.
  make_recordset ou-active.example.org. pending
  wait_for "ou-pending.example.org." PENDING 12 5 zone_status ou-pending.example.org.
  wait_for "pending.ou-active.example.org." PENDING 12 5 recordset_status ou-active.example.org. pending.ou-active.example.org.
  note "On their own: Designate's worker is stopped, so the API's changes are accepted and nothing carries them out."
}

undo_designate_pending() {
  start_unit devstack@designate-worker.service
  wait_for_either "ou-pending.example.org." ACTIVE ERROR 36 10 zone_status ou-pending.example.org.
}

scene designate-pending \
  "A zone and a recordset PENDING, with the worker that would finish them stopped." \
  drive_designate_pending undo_designate_pending

# The DNS server the worker writes to. Its name on this distribution, whichever it is.
bind_unit() {
  local unit
  for unit in named.service bind9.service; do
    if unit_exists "$unit"; then
      printf '%s' "$unit"
      return 0
    fi
  done
  return 1
}

drive_designate_error() {
  local unit
  unit="$(bind_unit)"
  stop_unit "$unit"
  make_zone ou-error.example.org.
  make_recordset ou-active.example.org. error
  # The worker keeps trying for a while before it calls it an error (poll_max_retries, poll_retry_interval).
  if wait_for "ou-error.example.org." ERROR 48 10 zone_status ou-error.example.org.; then
    note "On its own: the DNS server the worker writes to is stopped, and the worker gave up on the zone."
  else
    note "Written into its row, because the worker had not given up after eight minutes: UPDATE zones SET status='ERROR'."
    db designate "UPDATE zones SET status='ERROR', action='CREATE' WHERE name='ou-error.example.org.'"
  fi
  if wait_for "error.ou-active.example.org." ERROR 12 10 recordset_status ou-active.example.org. error.ou-active.example.org.; then
    note "The recordset went to ERROR on its own."
  else
    note "The recordset written into its row, because it had not reached ERROR: UPDATE records SET status='ERROR', which is where a recordset's status comes from."
    db designate "UPDATE records SET status='ERROR', action='CREATE' WHERE recordset_id IN (SELECT id FROM recordsets WHERE name='error.ou-active.example.org.')"
  fi
}

undo_designate_error() {
  start_unit "$(bind_unit)"
}

scene designate-error \
  "A zone and a recordset in ERROR, because the DNS server they go to is stopped." \
  drive_designate_error undo_designate_error

drive_designate_api_down() {
  stop_unit devstack@designate-api.service
  sleep 10
  note "On its own: Designate's API is stopped."
}

undo_designate_api_down() {
  start_unit devstack@designate-api.service
}

scene designate-api-down \
  "Designate's API stopped." \
  drive_designate_api_down undo_designate_api_down

# ------------------------------------------------------------------ Barbican

order_status() {
  openstack secret order get "$1" -f value -c Status
}

drive_barbican_baseline() {
  local href
  openstack role add --project ou-payments --user admin creator 2>/dev/null \
    || echo "No creator role on this cloud: the second project's secret goes by member alone."
  openstack secret store --name ou-secret-admin --payload "not a secret: a throwaway cloud" >/dev/null
  in_payments openstack secret store --name ou-secret-payments --payload "not a secret: a throwaway cloud" >/dev/null
  # An order is what makes Barbican's own workers do something: it creates the key itself.
  href="$(openstack secret order create --name ou-order-ok --algorithm aes --bit-length 256 --mode cbc \
    --payload-content-type application/octet-stream key -f value -c "Order href")"
  wait_for_either "ou-order-ok" ACTIVE ERROR 24 5 order_status "$href"
  # One the worker cannot satisfy, for what a failed order reads as.
  openstack secret order create --name ou-order-unsatisfiable --algorithm aes --bit-length 1 --mode cbc \
    --payload-content-type application/octet-stream key -f value -c "Order href" >"$OUTPUT_DIR/.bad-order" 2>"$OUTPUT_DIR/.bad-order-error" \
    || note "Barbican refused an order for a one-bit key outright: $(head -c 200 "$OUTPUT_DIR/.bad-order-error")"
  sleep 15
  note "On their own."
  # Asked once: what the exporter says about a service it has no reader for.
  curl -sS --max-time 30 -w '\nHTTP %{http_code}\n' \
    "${EXPORTER_URL:-http://127.0.0.1:9180}/probe?cloud=RegionOne&include_services=key-manager" \
    >"$OUTPUT_DIR/barbican-no-exporter.txt" 2>&1 || true
  cat "$OUTPUT_DIR/barbican-no-exporter.txt"
}

scene barbican-baseline \
  "Secrets and orders, in two projects." \
  drive_barbican_baseline

drive_barbican_api_down() {
  stop_unit devstack@barbican-svc.service
  sleep 10
  note "On its own: Barbican's API is stopped."
}

undo_barbican_api_down() {
  start_unit devstack@barbican-svc.service
}

scene barbican-api-down \
  "Barbican's API stopped." \
  drive_barbican_api_down undo_barbican_api_down

# ------------------------------------------------------------------ Swift

# Recon is on each storage server's own port, and is not in the catalog. These are DevStack's
# ports for its one replica. A real cloud names its own servers.
RECON_PORTS="object=6613 container=6611 account=6612"
recon_address="127.0.0.1"
if ! curl -sS --max-time 5 -o /dev/null "http://127.0.0.1:6613/recon/version"; then
  recon_address="$(hostname -I | awk '{print $1}')"
fi
RECON_TARGETS=""
for target in $RECON_PORTS; do
  RECON_TARGETS="$RECON_TARGETS ${target%%=*}=$recon_address:${target#*=}"
done
export RECON_TARGETS

object_file="$(mktemp)"
head -c 2048 /dev/zero >"$object_file"

drive_swift_baseline() {
  openstack container create ou-container-admin >/dev/null
  openstack object create --name ou-object-1 ou-container-admin "$object_file" >/dev/null
  in_payments openstack container create ou-container-payments >/dev/null
  in_payments openstack object create --name ou-object-1 ou-container-payments "$object_file" >/dev/null
  in_payments openstack object create --name ou-object-2 ou-container-payments "$object_file" >/dev/null
  note "On their own. The exporter's credential is on one project, and the account it lists is that project's."
  # Replication and the auditors report through recon on their own schedule.
  sleep 60
  swift_recon
}

swift_recon() {
  local tool
  for tool in swift-recon /opt/stack/data/venv/bin/swift-recon; do
    if command -v "$tool" >/dev/null 2>&1; then
      echo "\$ swift-recon --all"
      "$tool" --all 2>&1 | tail -60 || true
      return 0
    fi
  done
}

scene swift-baseline \
  "Containers and objects in two projects, with what /recon says." \
  drive_swift_baseline

drive_swift_reseller_admin() {
  openstack role show ResellerAdmin >/dev/null 2>&1 || openstack role create ResellerAdmin >/dev/null
  openstack role add --project admin --user admin ResellerAdmin
  note "On its own: this credential now has the role Swift lets into any account, which is what reading every project's usage takes."
}

undo_swift_reseller_admin() {
  openstack role remove --project admin --user admin ResellerAdmin
}

scene swift-reseller-admin \
  "The same, read by a credential allowed into any account." \
  drive_swift_reseller_admin undo_swift_reseller_admin

drive_swift_api_down() {
  stop_unit devstack@s-proxy.service
  sleep 10
  note "On its own: Swift's proxy, its API, is stopped. Its storage servers still answer recon."
}

undo_swift_api_down() {
  start_unit devstack@s-proxy.service
}

scene swift-api-down \
  "Swift's proxy stopped, with what /recon says." \
  drive_swift_api_down undo_swift_api_down

drive_swift_object_down() {
  stop_unit devstack@s-object.service
  sleep 10
  note "On its own: Swift's object server is stopped, with its proxy still answering, so its account and container lists still work."
}

undo_swift_object_down() {
  start_unit devstack@s-object.service
}

scene swift-object-down \
  "Swift's object server stopped, with its proxy still answering." \
  drive_swift_object_down undo_swift_object_down

rm -f "$object_file"
finish_scenes
