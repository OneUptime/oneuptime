#!/usr/bin/env bash
#
# Gnocchi on a real DevStack, deployed by Ceilometer's plugin, which is how it is deployed now:
# Gnocchi's own repository no longer has one. What it records (#5744):
#
#   baseline            measures being processed, gnocchi-metricd running
#   metricd-stopped     gnocchi-metricd stopped, and its processors gone from the status
#   backlog-growing     measures arriving with nothing to process them
#   backlog-growing-more  more of them, so a rate can be read from the two
#   recovered           gnocchi-metricd running again, and the backlog gone
#   api-down            Gnocchi's API stopped
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/services-gnocchi.sh

set -euo pipefail

# shellcheck source=Tests/Ops/openstack-e2e/services-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/services-lib.sh"

export RECORD_SERVICES="gnocchi identity"

log "The estate"
services_base

GNOCCHI="$(openstack catalog list -f json | python3 -I -c '
import json, sys
for service in json.load(sys.stdin):
    if (service.get("Type") or service.get("type")) == "metric":
        for endpoint in service.get("Endpoints") or service.get("endpoints") or []:
            if endpoint.get("interface") == "public":
                print(endpoint["url"].rstrip("/"))
                raise SystemExit(0)
')"
[ -n "$GNOCCHI" ] || {
  echo "Gnocchi is not in this cloud's catalog" >&2
  exit 1
}
echo "Gnocchi answers at $GNOCCHI"

# Its command line is a separate package nobody else here installs. Its words are nice to have.
ensure_client gnocchiclient 2>/dev/null || echo "No gnocchi command line: cli.txt goes without it."

# The token is asked for on each call, because a scene can outlast one's patience with a wait.
api() {
  local method="$1" path="$2" body="${3:-}"
  local token
  token="$(openstack token issue -f value -c id)"
  if [ -n "$body" ]; then
    curl -sS --max-time 60 -X "$method" -H "X-Auth-Token: $token" -H "Content-Type: application/json" -d "$body" "$GNOCCHI$path"
  else
    curl -sS --max-time 60 -X "$method" -H "X-Auth-Token: $token" "$GNOCCHI$path"
  fi
}

status_field() {
  api GET "/v1/status?details=true" | python3 -I -c '
import json, sys
status = json.load(sys.stdin)
if sys.argv[1] == "processors":
    print(len((status.get("metricd") or {}).get("processors") or []))
else:
    print((status.get("storage") or {}).get("summary", {}).get(sys.argv[1]))
' "$1"
}

log "An archive policy and some metrics, as a real writer leaves them"
api POST /v1/archive_policy '{"name": "ou-policy", "definition": [{"granularity": "1s", "points": 3600}]}' >/dev/null || true
METRICS=()
for number in 1 2 3 4 5; do
  id="$(api POST /v1/metric "{\"name\": \"ou-metric-$number\", \"archive_policy_name\": \"ou-policy\"}" \
    | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
  METRICS+=("$id")
done
echo "Metrics: ${METRICS[*]}"

# Measures on each metric, a second apart: a batch of them, as a polling agent's would be.
write_measures() {
  local count="$1" id body
  body="$(python3 -I -c '
import datetime, json, sys
now = datetime.datetime.now(datetime.timezone.utc)
print(json.dumps([
    {"timestamp": (now - datetime.timedelta(seconds=i)).isoformat(), "value": float(i)}
    for i in range(int(sys.argv[1]))
]))
' "$count")"
  for id in "${METRICS[@]}"; do
    api POST "/v1/metric/$id/measures" "$body" >/dev/null
  done
}

processors_present() {
  local count
  count="$(status_field processors 2>/dev/null || echo 0)"
  [ "${count:-0}" -gt 0 ] && echo yes || echo no
}

drive_baseline() {
  write_measures 60
  wait_for "the processors" yes 36 5 processors_present
  note "On its own: measures written, and gnocchi-metricd processing them."
  status_field measures
}

scene baseline \
  "Measures being processed, with gnocchi-metricd running." \
  drive_baseline

processors_gone() {
  local count
  count="$(status_field processors 2>/dev/null || echo 1)"
  [ "${count:-1}" = 0 ] && echo yes || echo no
}

drive_metricd_stopped() {
  stop_unit devstack@gnocchi-metricd.service
  # Its coordination group forgets a member when the member's heartbeat stops.
  if wait_for "the processors going" yes 36 10 processors_gone; then
    note "On its own: gnocchi-metricd is stopped, and Gnocchi's status stopped naming it."
  else
    note "gnocchi-metricd is stopped, and six minutes later Gnocchi's status still named it: $(status_field processors) processors."
  fi
}

scene metricd-stopped \
  "gnocchi-metricd stopped." \
  drive_metricd_stopped

drive_backlog_growing() {
  write_measures 600
  note "On its own: measures arriving, with nothing to process them. status_measures_to_process says $(status_field measures)."
}

scene backlog-growing \
  "Measures arriving with nothing to process them." \
  drive_backlog_growing

drive_backlog_growing_more() {
  sleep 60
  write_measures 600
  note "On its own: a minute later, and more. status_measures_to_process says $(status_field measures)."
}

scene backlog-growing-more \
  "More of them, a minute later, so a rate can be read from the two." \
  drive_backlog_growing_more

backlog_gone() {
  local count
  count="$(status_field measures 2>/dev/null || echo 1)"
  [ "${count:-1}" = 0 ] && echo yes || echo no
}

drive_recovered() {
  start_unit devstack@gnocchi-metricd.service
  wait_for "the processors" yes 36 5 processors_present
  wait_for "the backlog" yes 60 10 backlog_gone
  note "On its own: gnocchi-metricd started again, and worked through the backlog."
}

scene recovered \
  "gnocchi-metricd running again, and the backlog gone." \
  drive_recovered

drive_api_down() {
  stop_unit devstack@gnocchi-api.service
  sleep 10
  note "On its own: Gnocchi's API is stopped, with gnocchi-metricd still running."
}

undo_api_down() {
  start_unit devstack@gnocchi-api.service
}

scene api-down \
  "Gnocchi's API stopped." \
  drive_api_down undo_api_down

finish_scenes
