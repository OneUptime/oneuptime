#!/usr/bin/env bash
#
# Manila on a real DevStack, with its dummy driver: its API, scheduler and share manager are
# real, and only the storage is not. Two backends, one of which takes as long as it is told to
# create a share (dummy_driver_driver_methods_delays). What it records (#5744):
#
#   baseline            shares available, in two projects
#   share-error         a share no backend can take, which the scheduler puts in error
#   share-stuck         a share held in creating by the slow backend
#   share-service-down  manila-share stopped
#   scheduler-down      manila-scheduler stopped
#   api-down            Manila's API stopped
#   recovered           everything started again
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/services-manila.sh

set -euo pipefail

# shellcheck source=Tests/Ops/openstack-e2e/services-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/services-lib.sh"

export RECORD_SERVICES="sharev2 identity"

share_status() {
  openstack share show "$1" -f value -c status
}

share_status_in() {
  OS_PROJECT_NAME="$1" openstack share show "$2" -f value -c status
}

service_state() {
  openstack share service list --binary "$1" -f value -c State | sort -u | head -1
}

share_type() {
  local name="$1" backend="$2"
  openstack share type show "$name" >/dev/null 2>&1 \
    || openstack share type create "$name" false --extra-specs "share_backend_name=$backend" >/dev/null
}

log "The estate"
services_base
share_type ou-alpha ALPHA
share_type ou-slow SLOW
share_type ou-nowhere NOWHERE

drive_baseline() {
  openstack share show ou-share-admin >/dev/null 2>&1 \
    || openstack share create NFS 1 --name ou-share-admin --share-type ou-alpha >/dev/null
  OS_PROJECT_NAME=ou-payments openstack share show ou-share-payments >/dev/null 2>&1 \
    || OS_PROJECT_NAME=ou-payments openstack share create NFS 2 --name ou-share-payments --share-type ou-alpha >/dev/null
  wait_for_either "ou-share-admin" available error 36 5 share_status ou-share-admin
  wait_for_either "ou-share-payments" available error 36 5 share_status_in ou-payments ou-share-payments
  note "On their own, on the dummy driver: Manila's scheduler and share manager took each through it."
}

scene baseline \
  "Shares available, in two projects." \
  drive_baseline

drive_share_error() {
  openstack share show ou-share-error >/dev/null 2>&1 \
    || openstack share create NFS 1 --name ou-share-error --share-type ou-nowhere >/dev/null
  wait_for "ou-share-error" error 36 5 share_status ou-share-error
  note "On its own: no backend matches its share type, so the scheduler gave up on it."
  openstack share message list --resource-id "$(openstack share show ou-share-error -f value -c id)" || true
}

scene share-error \
  "A share in error, because no backend could take it." \
  drive_share_error

drive_share_stuck() {
  openstack share show ou-share-stuck >/dev/null 2>&1 \
    || openstack share create NFS 1 --name ou-share-stuck --share-type ou-slow >/dev/null
  wait_for "ou-share-stuck" creating 24 5 share_status ou-share-stuck
  # Past where a create usually takes seconds, so this is what stuck looks like and not just early.
  sleep 60
  wait_for "ou-share-stuck" creating 2 5 share_status ou-share-stuck
  note "On its own: the slow backend is taking the 50 minutes it was told to, which reads the same as a backend that hangs."
}

scene share-stuck \
  "A share held in creating by a backend that does not finish." \
  drive_share_stuck

drive_share_service_down() {
  stop_unit devstack@m-shr.service
  wait_for "manila-share" down 36 10 service_state manila-share
  note "On its own: manila-share is stopped, and Manila says so once its heartbeat is old enough."
}

undo_share_service_down() {
  start_unit devstack@m-shr.service
  wait_for "manila-share" up 36 10 service_state manila-share
}

scene share-service-down \
  "manila-share stopped, with shares still listed." \
  drive_share_service_down undo_share_service_down

drive_scheduler_down() {
  stop_unit devstack@m-sch.service
  wait_for "manila-scheduler" down 36 10 service_state manila-scheduler
  note "On its own: manila-scheduler is stopped."
}

undo_scheduler_down() {
  start_unit devstack@m-sch.service
  wait_for "manila-scheduler" up 36 10 service_state manila-scheduler
}

scene scheduler-down \
  "manila-scheduler stopped." \
  drive_scheduler_down undo_scheduler_down

drive_api_down() {
  stop_unit devstack@m-api.service
  sleep 10
  note "On its own: Manila's API is stopped."
}

undo_api_down() {
  start_unit devstack@m-api.service
  wait_for "Manila's API" up 24 5 service_state manila-share
}

scene api-down \
  "Manila's API stopped." \
  drive_api_down undo_api_down

drive_recovered() {
  note "Everything started again. The share in error stays in error, and the stuck one is what it was."
}

scene recovered \
  "Everything started again." \
  drive_recovered

finish_scenes
