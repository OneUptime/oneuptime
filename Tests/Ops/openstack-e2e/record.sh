#!/usr/bin/env bash
#
# Record what a real OpenStack cloud answers, for the OpenStack product's
# tests to replay. Writes one folder per "scene" under OUTPUT_DIR:
#
#   <scene>/api/<name>.json      what each read-only API call answers
#   <scene>/exporter/<svc>.prom  what openstack-exporter says for each service
#   <scene>/exporter/status.txt  how long each exporter scrape took, and its code
#   <scene>/cli.txt              what the openstack CLI said, for a human reviewer
#
# Nothing here is a secret: DevStack's own throwaway cloud, on a runner that is
# gone when the job ends. Tokens are still scrubbed, because a recording should
# never teach anyone to keep one.
#
# Usage:
#   OUTPUT_DIR=out OS_CLOUD=devstack-admin EXPORTER_URL=http://127.0.0.1:9180 \
#     bash Tests/Ops/openstack-e2e/record.sh <scene>

set -euo pipefail

SCENE="${1:?usage: record.sh <scene>}"
OUTPUT_DIR="${OUTPUT_DIR:-out}"
EXPORTER_URL="${EXPORTER_URL:-http://127.0.0.1:9180}"
EXPORTER_CLOUD="${EXPORTER_CLOUD:-devstack-admin}"
# A second exporter, at the last non-alpha release, recorded beside the first so
# a metric that differs between them is seen rather than discovered later.
EXPORTER_STABLE_URL="${EXPORTER_STABLE_URL:-}"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"

SERVICES="identity compute placement network volume image load-balancer baremetal container-infra orchestration dns sharev2 object-store database gnocchi"

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
  local args=(-sS --max-time 120 -H "X-Auth-Token: $TOKEN" -H "Accept: application/json" -o "$SCENE_DIR/api/$name.raw" -w '%{http_code}')
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
  fi

  cinder="$(endpoint_of volumev3)"
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
  fi

  ironic="$(endpoint_of baremetal)"
  if [ -n "$ironic" ]; then
    call ironic-nodes "$ironic/v1/nodes/detail" "X-OpenStack-Ironic-API-Version: 1.82"
    call ironic-conductors "$ironic/v1/conductors" "X-OpenStack-Ironic-API-Version: 1.82"
  fi

  heat="$(endpoint_of orchestration)"
  [ -z "$heat" ] || call heat-stacks "$heat/stacks?global_tenant=true"
  magnum="$(endpoint_of container-infra)"
  [ -z "$magnum" ] || call magnum-clusters "$magnum/clusters" "OpenStack-API-Version: container-infra latest"
  designate="$(endpoint_of dns)"
  [ -z "$designate" ] || call designate-zones "$designate/v2/zones" "X-Auth-All-Projects: true"
  manila="$(endpoint_of sharev2)"
  [ -z "$manila" ] || call manila-shares "$manila/shares/detail?all_tenants=1"
  swift="$(endpoint_of object-store)"
  [ -z "$swift" ] || call swift-account "$swift"
  trove="$(endpoint_of database)"
  [ -z "$trove" ] || call trove-instances "$trove/instances"
}

# One scrape per service, as the agent's collector makes them, with how long
# each took: that is what the agent's intervals and timeouts are chosen from.
record_exporter() {
  local base_url="$1" folder="$2" service code seconds
  mkdir -p "$SCENE_DIR/$folder"
  : >"$SCENE_DIR/$folder/status.txt"
  for service in $SERVICES; do
    read -r code seconds < <(curl -sS --max-time 300 -o "$SCENE_DIR/$folder/$service.prom" \
      -w '%{http_code} %{time_total}\n' \
      "$base_url/probe?cloud=$EXPORTER_CLOUD&include_services=$service" || echo "000 0")
    printf '%s %s %ss\n' "$service" "$code" "$seconds" | tee -a "$SCENE_DIR/$folder/status.txt"
    # A service that is not in the catalog answers with nothing to say.
    [ -s "$SCENE_DIR/$folder/$service.prom" ] || rm -f "$SCENE_DIR/$folder/$service.prom"
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
    echo "\$ openstack compute service list"; openstack compute service list || true
    echo "\$ openstack network agent list"; openstack network agent list || true
    echo "\$ openstack volume service list"; openstack volume service list || true
    echo "\$ openstack server list --all-projects"; openstack server list --all-projects || true
    echo "\$ openstack volume list --all-projects"; openstack volume list --all-projects || true
    echo "\$ openstack hypervisor list"; openstack hypervisor list || true
  } >"$SCENE_DIR/cli.txt" 2>&1
}

echo "Recording scene $SCENE"
record_exporter "$EXPORTER_URL" exporter
if [ -n "$EXPORTER_STABLE_URL" ]; then
  record_exporter "$EXPORTER_STABLE_URL" exporter-stable
fi
record_api
record_cli
echo "Scene $SCENE: $(find "$SCENE_DIR" -type f | wc -l) files"
