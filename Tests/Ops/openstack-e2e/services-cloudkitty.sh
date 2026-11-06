#!/usr/bin/env bash
#
# CloudKitty on a real DevStack, rating what Ceilometer wrote to Gnocchi. Each scene records what
# a probe reads of it (packages/Probe/Utils/OpenStack/Collectors/RatingCollector.ts). For #5748:
#
#   no-rating-data   deployed, with nothing booted: the summary a cloud without rating data gives
#   no-rule-yet      instances rated with no rule enabled, so CloudKitty's rate for them is 0
#   rated            a rule on, and at least one period rated above 0
#   api-down         CloudKitty's API stopped
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/services-cloudkitty.sh

set -euo pipefail

# shellcheck source=Tests/Ops/openstack-e2e/services-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/services-lib.sh"

export RECORD_SERVICES="gnocchi identity"

log "The estate"
services_base

CLOUDKITTY="$(openstack catalog list -f json | python3 -I -c '
import json, sys
for service in json.load(sys.stdin):
    if (service.get("Type") or service.get("type")) == "rating":
        for endpoint in service.get("Endpoints") or service.get("endpoints") or []:
            if endpoint.get("interface") == "public":
                print(endpoint["url"].rstrip("/"))
                raise SystemExit(0)
')"
[ -n "$CLOUDKITTY" ] || {
  echo "CloudKitty is not in this cloud's catalog" >&2
  exit 1
}
echo "CloudKitty answers at $CLOUDKITTY"

# The token is asked for on each call, because waiting for a period can outlast one's patience.
api() {
  local method="$1" path="$2" body="${3:-}"
  local token
  token="$(openstack token issue -f value -c id)"
  if [ -n "$body" ]; then
    curl -sS --max-time 60 -X "$method" -H "X-Auth-Token: $token" -H "Accept: application/json" \
      -H "Content-Type: application/json" -d "$body" "$CLOUDKITTY$path"
  else
    curl -sS --max-time 60 -X "$method" -H "X-Auth-Token: $token" -H "Accept: application/json" "$CLOUDKITTY$path"
  fi
}

json_field() {
  python3 -I -c 'import json, sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"
}

api_answers() {
  api GET /v1/info/metrics | python3 -I -c 'import json, sys; print("yes" if "metrics" in json.load(sys.stdin) else "no")'
}

# A period of an hour is CloudKitty's default, and a runner can't wait for one. Its first period
# for a project is the start of the month, so each metric costs a read of Gnocchi for every five
# minutes of the month so far: instances alone, as metrics.yml ships them.
log "Rate every five minutes, and only instances"
sudo tee /etc/cloudkitty/metrics.yml >/dev/null <<'METRICS'
metrics:
  cpu:
    unit: instance
    alt_name: instance
    groupby:
      - id
      - user_id
      - project_id
    metadata:
      - flavor_name
      - flavor_id
      - vcpus
    mutate: NUMBOOL
    extra_args:
      aggregation_method: mean
      resource_type: instance
      force_granularity: 300
METRICS
conf_add /etc/cloudkitty/cloudkitty.conf collect "period = 300"
sudo systemctl restart devstack@ck-proc.service devstack@ck-api.service
wait_for "CloudKitty's API" yes 36 5 api_answers

# "<rows> <rows above 0>" in this month's summary, which is what its defaults ask about.
summary_numbers() {
  api GET "/v2/summary?groupby=project_id&limit=1000" | python3 -I -c '
import json, sys
answer = json.load(sys.stdin)
columns = answer.get("columns") or []
results = answer.get("results") or []
rated = 0
if "rate" in columns:
    rated = sum(1 for row in results if float(row[columns.index("rate")] or 0) > 0)
print(len(results), rated)
'
}

summary_has_rows() {
  [ "$(summary_numbers | cut -d' ' -f1)" -gt 0 ] && echo yes || echo no
}

summary_has_a_rate() {
  [ "$(summary_numbers | cut -d' ' -f2)" -gt 0 ] && echo yes || echo no
}

# What a person needs when a wait ends with no rating: the debug lines would fill any log kept.
keep_logs() {
  local unit
  for unit in ck-proc ceilometer-acompute ceilometer-anotification gnocchi-metricd; do
    sudo journalctl -u "devstack@$unit.service" --no-pager -n 20000 \
      | grep -E ' (WARNING|ERROR|CRITICAL) |Traceback' | tail -200 >"$OUTPUT_DIR/$CURRENT_SCENE/$unit.log" || true
  done
}

drive_no_rating_data() {
  note "On its own: CloudKitty is deployed and nothing has been booted, so it has nothing to rate."
}

scene no-rating-data \
  "Deployed, with nothing to rate yet." \
  drive_no_rating_data

status_in() {
  OS_PROJECT_NAME="$1" openstack server show "$2" -f value -c status
}

# With no network, which is nothing CloudKitty rates. --nic none takes this microversion.
boot() {
  local project="$1" name="$2" image
  image="$(cirros_image)"
  OS_PROJECT_NAME="$project" openstack --os-compute-api-version 2.37 server create \
    --flavor ou.tiny --image "$image" --nic none "$name" >/dev/null
  wait_for_either "$name" ACTIVE ERROR 60 5 status_in "$project" "$name"
}

drive_no_rule_yet() {
  boot ou-payments ou-rated-payments
  boot ou-research ou-rated-research
  if ! wait_for "a rated period" yes 90 30 summary_has_rows; then
    keep_logs
    echo "CloudKitty rated no period in 45 minutes." >>"$OUTPUT_DIR/$CURRENT_SCENE/failed.txt"
    return 1
  fi
  note "On its own: an instance in each of two projects, polled by Ceilometer, with no rating rule enabled. The summary's rows and those above 0: $(summary_numbers)."
}

scene no-rule-yet \
  "Instances rated with no rule enabled." \
  drive_no_rule_yet

drive_rated() {
  local service
  api PUT /v1/rating/modules/hashmap '{"module_id": "hashmap", "enabled": true}' >/dev/null
  [ "$(api GET /v1/rating/modules/hashmap | json_field enabled)" = True ]
  service="$(api POST /v1/rating/module_config/hashmap/services '{"name": "instance"}' | json_field service_id)"
  api POST /v1/rating/module_config/hashmap/mappings \
    "{\"service_id\": \"$service\", \"type\": \"flat\", \"cost\": \"0.5\"}" >/dev/null
  # A rule is for the periods after it, and a processor that reads it again starts on them now.
  sudo systemctl restart devstack@ck-proc.service
  if ! wait_for "a rate above 0" yes 60 30 summary_has_a_rate; then
    keep_logs
    echo "A rule was on, and CloudKitty rated nothing above 0 in 30 minutes." >>"$OUTPUT_DIR/$CURRENT_SCENE/failed.txt"
    return 1
  fi
  note "On its own: hashmap enabled, with 0.5 flat for each instance each five-minute period. The periods before it stay at 0. The summary's rows and those above 0: $(summary_numbers)."
}

scene rated \
  "A rule on, and at least one period rated above 0." \
  drive_rated

drive_api_down() {
  stop_unit devstack@ck-api.service
  sleep 5
  note "On its own: CloudKitty's API is stopped, with its processor still running."
}

undo_api_down() {
  start_unit devstack@ck-api.service
}

scene api-down \
  "CloudKitty's API stopped." \
  drive_api_down undo_api_down

finish_scenes
