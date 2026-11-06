#!/usr/bin/env bash
#
# Record what a real OpenStack cloud answers, for the OpenStack product's
# tests to replay. Writes one folder per "scene" under OUTPUT_DIR:
#
#   <scene>/api/<name>.json      what each read-only API call answers
#   <scene>/exporter/<svc>.prom  what openstack-exporter says for each service
#   <scene>/exporter/status.txt  how long each exporter scrape took, and its code
#   <scene>/cli.txt              what the openstack CLI said, for a human reviewer
#   <scene>/recon/<server>-<what>.json  what Swift's recon says, when RECON_TARGETS names its servers
#
# Nothing here is a secret: DevStack's own throwaway cloud, on a runner that is
# gone when the job ends. Tokens are still scrubbed, because a recording should
# never teach anyone to keep one.
#
# Usage:
#   OUTPUT_DIR=out OS_CLOUD=devstack-admin EXPORTER_URL=http://127.0.0.1:9180 \
#     bash Tests/Ops/openstack-e2e/record.sh <scene>
#
# RECORD_SERVICES narrows which of the exporter's services a scene scrapes one at a time,
# for a run that only cares about a few of them.

set -euo pipefail

SCENE="${1:?usage: record.sh <scene>}"
OUTPUT_DIR="${OUTPUT_DIR:-out}"
EXPORTER_URL="${EXPORTER_URL:-http://127.0.0.1:9180}"
EXPORTER_CLOUD="${EXPORTER_CLOUD:-RegionOne}"
# A second exporter, at the last non-alpha release, recorded beside the first so
# a metric that differs between them is seen rather than discovered later.
EXPORTER_STABLE_URL="${EXPORTER_STABLE_URL:-}"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"

SERVICES="identity compute placement network volume image load-balancer baremetal container-infra orchestration dns sharev2 object-store database gnocchi"
RECORD_SERVICES="${RECORD_SERVICES:-$SERVICES}"
# name=host:port for each of Swift's storage servers, read directly: recon is not in the catalog.
RECON_TARGETS="${RECON_TARGETS:-}"
# cloud=service for another clouds.yaml entry's view of a service that answers by who asks.
EXPORTER_ALSO="${EXPORTER_ALSO:-}"

SCENE_DIR="$OUTPUT_DIR/$SCENE"
mkdir -p "$SCENE_DIR/api" "$SCENE_DIR/exporter"

scrub() {
  # A token, in the two shapes an answer can carry one, and the links that
  # name the runner's own address: replaced so a recording diffs cleanly
  # between runs.
  sed -E \
    -e 's/gAAAA[A-Za-z0-9_=-]+/REDACTED-TOKEN/g' \
    -e 's#"(X-Auth-Token|x-auth-token|x-subject-token)": *"[^"]*"#"\1": "REDACTED-TOKEN"#g' \
    -e 's#https?://[0-9]{1,3}(\.[0-9]{1,3}){3}#https://openstack.example#g'
}

TOKEN="$(openstack token issue -f value -c id)"
CATALOG="$(openstack catalog list -f json)"

# The endpoint of a service type in this region, or nothing when the cloud does
# not run it. A python one-liner because `openstack catalog show` prints a
# multi-line table, and jq is not on every image this runs on.
endpoint_of() {
  CATALOG="$CATALOG" python3 -I -c '
import json, os, sys
for service in json.loads(os.environ["CATALOG"]):
    if service.get("Type") == sys.argv[1] or service.get("type") == sys.argv[1]:
        for endpoint in service.get("Endpoints") or service.get("endpoints") or []:
            if endpoint.get("interface") == "public":
                print(endpoint["url"].rstrip("/"))
                sys.exit(0)
' "$1"
}

# One read-only call. A refusal or an absent route is a recording too: the
# probe collector's tests replay what the API said, not what we hoped for.
call() {
  local name="$1" url="$2" microversion_header="${3:-}" code
  # CALL_TOKEN reads as another project, for a service that only answers a project about itself.
  local args=(-sS --max-time 120 -H "X-Auth-Token: ${CALL_TOKEN:-$TOKEN}" -H "Accept: application/json" -o "$SCENE_DIR/api/$name.raw" -w '%{http_code}')
  if [ -n "$microversion_header" ]; then
    args+=(-H "$microversion_header")
  fi
  code="$(curl "${args[@]}" "$url" || echo 000)"
  if [ -s "$SCENE_DIR/api/$name.raw" ]; then
    scrub <"$SCENE_DIR/api/$name.raw" >"$SCENE_DIR/api/$name.json"
  else
    printf '{}\n' >"$SCENE_DIR/api/$name.json"
  fi
  rm -f "$SCENE_DIR/api/$name.raw"
  printf '%s %s %s\n' "$code" "$name" "${url#https://}" >>"$SCENE_DIR/api-status.txt"
}

# "<id> <name>" for each row of a list this scene has recorded, for the reads of each one. A
# name goes in a file name, so it keeps only what a file name can hold.
rows_of() {
  python3 -I -c '
import json, sys
try:
    with open(sys.argv[1]) as handle:
        rows = json.load(handle).get(sys.argv[2]) or []
except (OSError, ValueError, AttributeError):
    rows = []
for row in rows:
    key = row.get("id") or row.get("uuid") or ""
    name = row.get("name") or row.get("stack_name") or key
    print(key, "".join(c if c.isalnum() or c in "._-" else "_" for c in name) or key)
' "$SCENE_DIR/api/$1.json" "$2"
}

# A token for a project this account has a role on, by the project's id.
token_of_project_id() {
  local name
  name="$(openstack project show "$1" -f value -c name 2>/dev/null || true)"
  [ -n "$name" ] || return 0
  OS_PROJECT_NAME="$name" openstack token issue -f value -c id 2>/dev/null || true
}

# What a call's headers said, which is all Swift says about a whole account.
call_headers() {
  local name="$1" url="$2" code
  code="$(curl -sS --max-time 60 -I -H "X-Auth-Token: ${CALL_TOKEN:-$TOKEN}" -D "$SCENE_DIR/api/$name.headers.raw" -o /dev/null -w '%{http_code}' "$url" || echo 000)"
  if [ -s "$SCENE_DIR/api/$name.headers.raw" ]; then
    scrub <"$SCENE_DIR/api/$name.headers.raw" | tr -d '\r' >"$SCENE_DIR/api/$name.headers.txt"
  fi
  rm -f "$SCENE_DIR/api/$name.headers.raw"
  printf '%s %s %s\n' "$code" "$name" "${url#https://}" >>"$SCENE_DIR/api-status.txt"
}

record_octavia() {
  local octavia="$1" id name
  call octavia-versions "$octavia/"
  call octavia-healthmonitors "$octavia/v2/lbaas/healthmonitors"
  call octavia-flavors "$octavia/v2/lbaas/flavors"
  call octavia-quotas "$octavia/v2/lbaas/quotas"
  while read -r id name; do
    [ -n "$id" ] || continue
    call "octavia-lb-status-$name" "$octavia/v2/lbaas/loadbalancers/$id/status"
    call "octavia-lb-stats-$name" "$octavia/v2/lbaas/loadbalancers/$id/stats"
  done < <(rows_of octavia-loadbalancers loadbalancers)
  while read -r id name; do
    [ -n "$id" ] || continue
    call "octavia-listener-stats-$name" "$octavia/v2/lbaas/listeners/$id/stats"
  done < <(rows_of octavia-listeners listeners)
  while read -r id name; do
    [ -n "$id" ] || continue
    call "octavia-members-$name" "$octavia/v2/lbaas/pools/$id/members"
  done < <(rows_of octavia-pools pools)
  # By id: an amphora has no name.
  while read -r id name; do
    [ -n "$id" ] || continue
    call "octavia-amphora-stats-${id:0:8}" "$octavia/v2/octavia/amphorae/$id/stats"
  done < <(rows_of octavia-amphorae amphorae)
}

record_ironic() {
  local ironic="$1" version="X-OpenStack-Ironic-API-Version: 1.82" id name system
  call ironic-versions "$ironic/"
  call ironic-drivers "$ironic/v1/drivers" "$version"
  # A project's admin reads only the nodes its project owns, and no conductor. These are what the
  # same reads say with system scope, where this cloud has an entry for it.
  system="$(OS_CLOUD=devstack-system-admin openstack token issue -f value -c id 2>/dev/null || true)"
  if [ -n "$system" ]; then
    CALL_TOKEN="$system" call ironic-nodes-as-system "$ironic/v1/nodes/detail" "$version"
    CALL_TOKEN="$system" call ironic-conductors-as-system "$ironic/v1/conductors" "$version"
  fi
  while read -r id name; do
    [ -n "$id" ] || continue
    call "ironic-node-validate-$name" "$ironic/v1/nodes/$id/validate" "$version"
  done < <(rows_of ironic-nodes nodes)
}

record_heat() {
  local heat="$1" id name project token base
  # What the exporter reads. An admin's plain list already holds every project's stacks, each
  # saying its project, while heat-stacks asks for them by name and Heat refuses: its policy
  # stacks:global_index defaults to nobody.
  call heat-stacks-own "$heat/stacks"
  call heat-services "$heat/services"
  # Heat answers a token about its own project's stacks, so each is read as its own project. Only
  # ours: what a Magnum cluster's stack owns is most of a recording, and says nothing new.
  while read -r id name project; do
    [ -n "$id" ] || continue
    token="$(token_of_project_id "$project")"
    base="${heat%/*}/$project"
    CALL_TOKEN="$token" call "heat-stack-$name" "$base/stacks/$name/$id"
    CALL_TOKEN="$token" call "heat-stack-resources-$name" "$base/stacks/$name/$id/resources?nested_depth=2"
  done < <(python3 -I -c '
import json, sys
try:
    with open(sys.argv[1]) as handle:
        rows = json.load(handle).get("stacks") or []
except (OSError, ValueError, AttributeError):
    rows = []
for row in rows:
    if (row.get("stack_name") or "").startswith("ou-stack-"):
        print(row.get("id"), row.get("stack_name"), row.get("project") or "")
' "$SCENE_DIR/api/heat-stacks-own.json")
}

record_magnum() {
  local magnum="$1" version="OpenStack-API-Version: container-infra latest" id name
  call magnum-clustertemplates "$magnum/clustertemplates" "$version"
  call magnum-services "$magnum/mservices" "$version"
  while read -r id name; do
    [ -n "$id" ] || continue
    call "magnum-cluster-$name" "$magnum/clusters/$id" "$version"
    call "magnum-nodegroups-$name" "$magnum/clusters/$id/nodegroups" "$version"
  done < <(rows_of magnum-clusters clusters)
}

record_designate() {
  local designate="$1" every="X-Auth-All-Projects: true" id name
  call designate-pools "$designate/v2/pools"
  call designate-service-statuses "$designate/v2/service_statuses"
  while read -r id name; do
    [ -n "$id" ] || continue
    call "designate-recordsets-$name" "$designate/v2/zones/$id/recordsets" "$every"
  done < <(rows_of designate-zones zones)
}

record_manila() {
  local manila="$1" version="X-OpenStack-Manila-API-Version: 2.65"
  # With a microversion, which the exporter does not ask for, and manila-shares does not either.
  call manila-shares-versioned "$manila/shares/detail?all_tenants=1" "$version"
  call manila-services "$manila/services" "$version"
  call manila-pools "$manila/scheduler-stats/pools/detail" "$version"
  call manila-types "$manila/types" "$version"
}

record_barbican() {
  local barbican="$1" token
  call barbican-versions "$barbican/"
  call barbican-secrets "$barbican/v1/secrets"
  call barbican-orders "$barbican/v1/orders"
  call barbican-containers "$barbican/v1/containers"
  # Barbican has no list across projects, so what a second project holds takes its own token.
  token="$(OS_PROJECT_NAME=ou-payments openstack token issue -f value -c id 2>/dev/null || true)"
  if [ -n "$token" ]; then
    CALL_TOKEN="$token" call barbican-secrets-ou-payments "$barbican/v1/secrets"
    CALL_TOKEN="$token" call barbican-orders-ou-payments "$barbican/v1/orders"
  fi
}

record_swift() {
  local swift="$1" root="${1%%/v1*}" project token
  call swift-info "$root/info"
  call_headers swift-account-own "$swift"
  # Another project's account, as this admin and then as that project: which of them answers
  # is whether one credential can read every project's usage.
  project="$(openstack project show ou-payments -f value -c id 2>/dev/null || true)"
  if [ -n "$project" ]; then
    call swift-account-ou-payments-as-admin "${swift%/AUTH_*}/AUTH_$project"
    call_headers swift-account-ou-payments-as-admin "${swift%/AUTH_*}/AUTH_$project"
    token="$(OS_PROJECT_NAME=ou-payments openstack token issue -f value -c id 2>/dev/null || true)"
    if [ -n "$token" ]; then
      CALL_TOKEN="$token" call swift-account-ou-payments "${swift%/AUTH_*}/AUTH_$project"
      CALL_TOKEN="$token" call_headers swift-account-ou-payments "${swift%/AUTH_*}/AUTH_$project"
    fi
  fi
}

record_recon() {
  local target server address what file code
  [ -n "$RECON_TARGETS" ] || return 0
  mkdir -p "$SCENE_DIR/recon"
  : >"$SCENE_DIR/recon/status.txt"
  for target in $RECON_TARGETS; do
    server="${target%%=*}"
    address="${target#*=}"
    for what in version mem load async sockstat devices mounted unmounted diskusage ringmd5 swiftconfmd5 quarantined driveaudit time \
      replication/object replication/container replication/account auditor/object auditor/container auditor/account \
      updater/object updater/container expirer/object sharding reconstruction/object; do
      file="$SCENE_DIR/recon/$server-${what//\//-}.json"
      code="$(curl -sS --max-time 20 -o "$file" -w '%{http_code}' "http://$address/recon/$what" || echo 000)"
      printf '%s %s %s\n' "$code" "$server" "$what" >>"$SCENE_DIR/recon/status.txt"
      # A server that is down, and a read this server does not have, say so in the status alone.
      [ "$code" = 200 ] || rm -f "$file"
    done
  done
}

record_trove() {
  local trove="$1"
  # What the exporter reads, which only an admin can.
  call trove-mgmt-instances "$trove/mgmt/instances?include_clustered=False&deleted=False"
  call trove-datastores "$trove/datastores"
  call trove-flavors "$trove/flavors"
}

record_gnocchi() {
  local gnocchi="$1"
  call gnocchi-versions "$gnocchi/"
  call gnocchi-status "$gnocchi/v1/status?details=true"
  call gnocchi-archive-policies "$gnocchi/v1/archive_policy"
  # What the exporter's total_metrics would page through, a few of.
  call gnocchi-metrics-some "$gnocchi/v1/metric?limit=5"
}

# A month as a probe asks CloudKitty about it: UTC, to the second, with no zone, percent-encoded.
cloudkitty_period() {
  python3 -I -c '
import datetime, sys, urllib.parse
now = datetime.datetime.now(datetime.timezone.utc)
first = now.year * 12 + now.month - 1 - int(sys.argv[1])
def month(index):
    return urllib.parse.quote(datetime.datetime(index // 12, index % 12 + 1, 1).isoformat(), safe="")
print(f"begin={month(first)}&end={month(first + 1)}")
' "$1"
}

# What a probe reads of CloudKitty, as it reads it: its version document and what its API check
# asks, then this month and last, summary first. Then as a project's member, which CloudKitty's
# own policy narrows to that project.
record_cloudkitty() {
  local cloudkitty="$1" month="" period="" back=0 project="" token=""
  call cloudkitty-versions "$cloudkitty/"
  call cloudkitty-info-metrics "$cloudkitty/v1/info/metrics"
  for month in this-month last-month; do
    period="$(cloudkitty_period "$back")"
    call "cloudkitty-summary-$month" "$cloudkitty/v2/summary?$period&groupby=project_id&limit=1000&offset=0"
    call "cloudkitty-report-$month" "$cloudkitty/v1/report/summary?$period&groupby=tenant_id&all_tenants=true"
    back=$((back + 1))
  done
  project="$(openstack project show ou-payments -f value -c id 2>/dev/null || true)"
  [ -n "$project" ] || return 0
  token="$(token_of_project_id "$project")"
  [ -n "$token" ] || return 0
  period="$(cloudkitty_period 0)"
  CALL_TOKEN="$token" call cloudkitty-summary-this-month-ou-payments \
    "$cloudkitty/v2/summary?$period&groupby=project_id&limit=1000&offset=0"
  CALL_TOKEN="$token" call cloudkitty-report-this-month-ou-payments \
    "$cloudkitty/v1/report/summary?$period&groupby=tenant_id&all_tenants=true"
}

record_api() {
  : >"$SCENE_DIR/api-status.txt"
  local nova neutron cinder glance placement keystone octavia ironic heat magnum designate manila swift trove

  keystone="$(endpoint_of identity)"
  if [ -n "$keystone" ]; then
    call keystone-versions "$keystone/"
    call keystone-regions "$keystone/v3/regions"
    call keystone-projects "$keystone/v3/projects"
    call keystone-domains "$keystone/v3/domains"
    call keystone-services "$keystone/v3/services"
    call keystone-endpoints "$keystone/v3/endpoints"
    call keystone-roles "$keystone/v3/roles"
    # The probe's collector reads these for their counts, and its parity tests replay them.
    call keystone-users "$keystone/v3/users"
    call keystone-groups "$keystone/v3/groups"
  fi

  nova="$(endpoint_of compute)"
  if [ -n "$nova" ]; then
    local mv="OpenStack-API-Version: compute 2.90"
    call nova-versions "${nova%/v2.1*}/"
    call nova-servers "$nova/servers/detail?all_tenants=1&limit=1000" "$mv"
    call nova-servers-changes-since "$nova/servers/detail?all_tenants=1&limit=1000&changes-since=2000-01-01T00:00:00Z" "$mv"
    call nova-services "$nova/os-services" "$mv"
    call nova-hypervisors "$nova/os-hypervisors/detail" "$mv"
    # From 2.88, hypervisors stop reporting vCPUs, memory and disk, and capacity
    # moves to Placement. Older clouds and older exporters read this shape.
    call nova-hypervisors-before-2-88 "$nova/os-hypervisors/detail" "OpenStack-API-Version: compute 2.87"
    call nova-aggregates "$nova/os-aggregates" "$mv"
    call nova-azs "$nova/os-availability-zone/detail" "$mv"
    call nova-azs-list "$nova/os-availability-zone" "$mv"
    call nova-flavors "$nova/flavors/detail?is_public=None" "$mv"
    call nova-limits "$nova/limits" "$mv"
    call nova-usage "$nova/os-simple-tenant-usage?detailed=1&start=2000-01-01T00:00:00" "$mv"
    local failed
    # Nova's API is down in one of the drills: nothing to look up then.
    failed="$( (openstack server list --all-projects --name '^ou-failed$' -f value -c ID 2>/dev/null || true) | head -1)"
    if [ -n "$failed" ]; then
      call nova-server-failed "$nova/servers/$failed" "$mv"
      call nova-server-failed-actions "$nova/servers/$failed/os-instance-actions" "$mv"
    fi
  fi

  placement="$(endpoint_of placement)"
  if [ -n "$placement" ]; then
    local pmv="OpenStack-API-Version: placement 1.39"
    call placement-versions "$placement/"
    call placement-providers "$placement/resource_providers" "$pmv"
    local provider
    provider="$( (openstack resource provider list -f value -c uuid 2>/dev/null || true) | head -1)"
    if [ -n "$provider" ]; then
      call placement-inventories "$placement/resource_providers/$provider/inventories" "$pmv"
      call placement-usages "$placement/resource_providers/$provider/usages" "$pmv"
      call placement-aggregates "$placement/resource_providers/$provider/aggregates" "$pmv"
      call placement-allocations "$placement/resource_providers/$provider/allocations" "$pmv"
    fi
  fi

  neutron="$(endpoint_of network)"
  if [ -n "$neutron" ]; then
    call neutron-agents "$neutron/v2.0/agents"
    call neutron-networks "$neutron/v2.0/networks"
    call neutron-subnets "$neutron/v2.0/subnets"
    call neutron-routers "$neutron/v2.0/routers"
    call neutron-floatingips "$neutron/v2.0/floatingips"
    call neutron-ip-availabilities "$neutron/v2.0/network-ip-availabilities"
    call neutron-security-groups "$neutron/v2.0/security-groups"
    call neutron-ports-limited "$neutron/v2.0/ports?limit=100"
    call neutron-quotas "$neutron/v2.0/quotas"
    call neutron-extensions "$neutron/v2.0/extensions"
    local router dhcp_agent
    # The estate's own router, so a drill that takes it off its agent shows in the answer.
    router="$( (openstack router list --name ou-router -f value -c ID 2>/dev/null || true) | head -1)"
    [ -n "$router" ] || router="$( (openstack router list -f value -c ID 2>/dev/null || true) | head -1)"
    if [ -n "$router" ]; then
      # OVN has no such agents, and answers with an empty list.
      call neutron-router-l3-agents "$neutron/v2.0/routers/$router/l3-agents"
    fi
    dhcp_agent="$( (openstack network agent list --agent-type dhcp -f value -c ID 2>/dev/null || true) | head -1)"
    if [ -n "$dhcp_agent" ]; then
      # OVN has none of these either, and there is no agent to ask about.
      call neutron-agent-dhcp-networks "$neutron/v2.0/agents/$dhcp_agent/dhcp-networks"
    fi
  fi

  # A current catalog calls it block-storage, an older one volumev3.
  cinder="$(endpoint_of block-storage)"
  [ -n "$cinder" ] || cinder="$(endpoint_of volumev3)"
  if [ -n "$cinder" ]; then
    local cmv="OpenStack-API-Version: volume 3.50"
    call cinder-volumes "$cinder/volumes/detail?all_tenants=1&limit=1000" "$cmv"
    call cinder-services "$cinder/os-services" "$cmv"
    call cinder-pools "$cinder/scheduler-stats/get_pools?detail=true" "$cmv"
    call cinder-snapshots "$cinder/snapshots/detail?all_tenants=1&limit=1000" "$cmv"
    call cinder-backups "$cinder/backups/detail?all_tenants=1&limit=1000" "$cmv"
    call cinder-types "$cinder/types" "$cmv"
  fi

  glance="$(endpoint_of image)"
  if [ -n "$glance" ]; then
    call glance-images "$glance/v2/images?limit=1000"
  fi

  octavia="$(endpoint_of load-balancer)"
  if [ -n "$octavia" ]; then
    call octavia-loadbalancers "$octavia/v2/lbaas/loadbalancers"
    call octavia-listeners "$octavia/v2/lbaas/listeners"
    call octavia-pools "$octavia/v2/lbaas/pools"
    call octavia-amphorae "$octavia/v2/octavia/amphorae"
    call octavia-providers "$octavia/v2/lbaas/providers"
    record_octavia "$octavia"
  fi

  ironic="$(endpoint_of baremetal)"
  if [ -n "$ironic" ]; then
    call ironic-nodes "$ironic/v1/nodes/detail" "X-OpenStack-Ironic-API-Version: 1.82"
    call ironic-conductors "$ironic/v1/conductors" "X-OpenStack-Ironic-API-Version: 1.82"
    record_ironic "$ironic"
  fi

  heat="$(endpoint_of orchestration)"
  if [ -n "$heat" ]; then
    call heat-stacks "$heat/stacks?global_tenant=true"
    record_heat "$heat"
  fi
  magnum="$(endpoint_of container-infra)"
  if [ -n "$magnum" ]; then
    call magnum-clusters "$magnum/clusters" "OpenStack-API-Version: container-infra latest"
    record_magnum "$magnum"
  fi
  designate="$(endpoint_of dns)"
  if [ -n "$designate" ]; then
    call designate-zones "$designate/v2/zones" "X-Auth-All-Projects: true"
    record_designate "$designate"
  fi
  manila="$(endpoint_of sharev2)"
  if [ -n "$manila" ]; then
    call manila-shares "$manila/shares/detail?all_tenants=1"
    record_manila "$manila"
  fi
  swift="$(endpoint_of object-store)"
  if [ -n "$swift" ]; then
    call swift-account "$swift"
    record_swift "$swift"
  fi
  trove="$(endpoint_of database)"
  if [ -n "$trove" ]; then
    call trove-instances "$trove/instances"
    record_trove "$trove"
  fi

  # None has a line above: the exporter has no reader for Barbican or CloudKitty, and Gnocchi's
  # catalog type is not what its exporter is called.
  local barbican gnocchi cloudkitty
  barbican="$(endpoint_of key-manager)"
  [ -z "$barbican" ] || record_barbican "$barbican"
  gnocchi="$(endpoint_of metric)"
  [ -z "$gnocchi" ] || record_gnocchi "$gnocchi"
  cloudkitty="$(endpoint_of rating)"
  [ -z "$cloudkitty" ] || record_cloudkitty "$cloudkitty"

  record_recon
}

# One scrape per service, as the agent's collector makes them, with how long
# each took: that is what the agent's intervals and timeouts are chosen from.
record_exporter() {
  local base_url="$1" folder="$2" service code seconds
  mkdir -p "$SCENE_DIR/$folder"
  : >"$SCENE_DIR/$folder/status.txt"
  for service in $RECORD_SERVICES; do
    read -r code seconds < <(curl -sS --max-time 300 -o "$SCENE_DIR/$folder/$service.prom" \
      -w '%{http_code} %{time_total}\n' \
      "$base_url/probe?cloud=$EXPORTER_CLOUD&include_services=$service" || echo "000 0")
    printf '%s %s %ss\n' "$service" "$code" "$seconds" | tee -a "$SCENE_DIR/$folder/status.txt"
    # A service that is not in the catalog answers with nothing to say.
    [ -s "$SCENE_DIR/$folder/$service.prom" ] || rm -f "$SCENE_DIR/$folder/$service.prom"
  done
  local also cloud
  for also in $EXPORTER_ALSO; do
    cloud="${also%%=*}"
    service="${also#*=}"
    read -r code seconds < <(curl -sS --max-time 300 -o "$SCENE_DIR/$folder/$service-as-$cloud.prom" \
      -w '%{http_code} %{time_total}\n' \
      "$base_url/probe?cloud=$cloud&include_services=$service" || echo "000 0")
    printf '%s-as-%s %s %ss\n' "$service" "$cloud" "$code" "$seconds" | tee -a "$SCENE_DIR/$folder/status.txt"
    [ -s "$SCENE_DIR/$folder/$service-as-$cloud.prom" ] || rm -f "$SCENE_DIR/$folder/$service-as-$cloud.prom"
  done
  # And one scrape of everything at once, which is what upstream issue 660 is
  # about: does one failing service empty the rest?
  read -r code seconds < <(curl -sS --max-time 600 -o "$SCENE_DIR/$folder/all-at-once.prom" \
    -w '%{http_code} %{time_total}\n' \
    "$base_url/probe?cloud=$EXPORTER_CLOUD" || echo "000 0")
  printf 'all-at-once %s %ss\n' "$code" "$seconds" | tee -a "$SCENE_DIR/$folder/status.txt"
}

record_cli() {
  # What an operator would read, so a reviewer can check a page against it.
  {
    echo "\$ openstack compute service list --long"
    openstack --os-compute-api-version 2.11 compute service list --long || true
    echo "\$ openstack network agent list"; openstack network agent list || true
    echo "\$ openstack volume service list"; openstack volume service list || true
    echo "\$ openstack server list --all-projects"; openstack server list --all-projects || true
    echo "\$ openstack volume list --all-projects"; openstack volume list --all-projects || true
    echo "\$ openstack hypervisor list"; openstack hypervisor list || true
    echo "\$ openstack aggregate list --long"; openstack aggregate list --long || true
    echo "\$ openstack image list --long"; openstack image list --long || true
    echo "\$ openstack ip availability list"; openstack ip availability list || true
    echo "\$ openstack floating ip list --long"; openstack floating ip list --long || true
    record_cli_of_other_services
  } >"$SCENE_DIR/cli.txt" 2>&1
}

# Only for what this cloud runs, so a core recording's cli.txt says what it always said.
cli_line() {
  echo "\$ $*"
  "$@" || true
}

record_cli_of_other_services() {
  local name
  if [ -n "$(endpoint_of load-balancer)" ]; then
    cli_line openstack loadbalancer list
    cli_line openstack loadbalancer listener list
    cli_line openstack loadbalancer pool list
    cli_line openstack loadbalancer amphora list
    cli_line openstack loadbalancer provider list
    while read -r _ name; do
      [ -z "$name" ] || cli_line openstack loadbalancer member list "$name"
    done < <(rows_of octavia-pools pools)
    while read -r _ name; do
      [ -z "$name" ] || cli_line openstack loadbalancer stats show "$name"
    done < <(rows_of octavia-loadbalancers loadbalancers)
  fi
  if [ -n "$(endpoint_of baremetal)" ]; then
    cli_line openstack baremetal node list --fields name provision_state power_state maintenance maintenance_reason resource_class last_error
    cli_line openstack baremetal conductor list
    cli_line openstack baremetal driver list
  fi
  if [ -n "$(endpoint_of orchestration)" ]; then
    cli_line openstack stack list --all-projects
    cli_line openstack stack list
    cli_line openstack orchestration service list
  fi
  if [ -n "$(endpoint_of container-infra)" ]; then
    cli_line openstack coe cluster list
    cli_line openstack coe cluster template list
    cli_line openstack coe service list
  fi
  if [ -n "$(endpoint_of sharev2)" ]; then
    cli_line openstack share list --all-projects
    cli_line openstack share service list
    cli_line openstack share pool list
  fi
  if [ -n "$(endpoint_of dns)" ]; then
    cli_line openstack zone list --all-projects
    cli_line openstack recordset list all --all-projects
    cli_line openstack dns service list
  fi
  if [ -n "$(endpoint_of key-manager)" ]; then
    cli_line openstack secret list
    cli_line openstack secret order list
  fi
  if [ -n "$(endpoint_of object-store)" ]; then
    cli_line openstack container list
    cli_line openstack object store account show
  fi
  if [ -n "$(endpoint_of database)" ]; then
    cli_line openstack database instance list
    cli_line openstack database instance list --all-projects
    cli_line openstack datastore list
  fi
  if [ -n "$(endpoint_of metric)" ]; then
    cli_line gnocchi status
  fi
  if [ -n "$(endpoint_of rating)" ]; then
    cli_line openstack rating module list
    cli_line openstack rating info metric list
    cli_line openstack rating hashmap service list
    cli_line openstack rating summary get
  fi
}

echo "Recording scene $SCENE"
record_exporter "$EXPORTER_URL" exporter
if [ -n "$EXPORTER_STABLE_URL" ]; then
  record_exporter "$EXPORTER_STABLE_URL" exporter-stable
fi
record_api
record_cli
echo "Scene $SCENE: $(find "$SCENE_DIR" -type f | wc -l) files"
