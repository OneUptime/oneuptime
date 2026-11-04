#!/usr/bin/env bash
#
# Find out, on this cloud's real policies, what each way of giving the OpenStack
# agent access can read, and prove the ones we recommend cannot write:
#
#   admin                 what there is to see
#   reader                a plain reader on one project, with default policy
#   monitoring-role       the oneuptime_monitoring role, with the policy overrides
#                         in agents/OpenStackAgent/access/ applied to each service
#   monitoring-admin-get  an application credential on an admin account, limited
#                         by access rules to reading
#
# See access-matrix.py for why a 200 is not enough. The matrix is written to
# $OUTPUT_DIR/access/matrix.json. Changes this cloud's policy files, and takes
# them back off again: drills.sh runs after this and needs the defaults.
#
# Each level also runs the agent's exporter, because what the product shows is what
# the exporter gets, which a list of API answers only suggests. Written to
# $OUTPUT_DIR/access/exporter/<level>/.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACCESS_DIR="$HERE/../../../agents/OpenStackAgent/access"
OUTPUT_DIR="${OUTPUT_DIR:-out}"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"

AGENT_DIR="$HERE/../../../agents/OpenStackAgent"

mkdir -p "$OUTPUT_DIR/access"

PASSWORD="ou-$(openssl rand -hex 12)"
AUTH_URL="$(openstack endpoint list --service identity --interface public -f value -c URL | head -1)"
ADMIN_TOKEN="$(openstack token issue -f value -c id)"

# Give an extra account a token for one project, by its role.
token_for() {
  local user="$1" project="$2"
  openstack --os-cloud= --os-auth-url "$AUTH_URL" --os-identity-api-version 3 \
    --os-username "$user" --os-password "$PASSWORD" \
    --os-user-domain-name Default --os-project-name "$project" --os-project-domain-name Default \
    token issue -f value -c id
}

# Read from what ships, so this can never test another exporter or other flags.
EXPORTER_IMAGE="$(grep -E '^[[:space:]]*image:[[:space:]]*ghcr.io/openstack-exporter/' "$AGENT_DIR/docker-compose.yml" | head -1 | sed -E 's/^[[:space:]]*image:[[:space:]]*//')"
EXPORTER_FLAGS="$(grep -E '^[[:space:]]*- --disable-metric=' "$AGENT_DIR/docker-compose.yml" | sed -E 's/^[[:space:]]*- //' | tr '\n' ' ')"
EXPORTER_SERVICES="identity compute placement network volume image"

scrape_into() {
  local base_url="$1" folder="$2" service code
  mkdir -p "$folder"
  : >"$folder/status.txt"
  for service in $EXPORTER_SERVICES; do
    code="$(curl -sS --max-time 180 -o "$folder/$service.prom" -w '%{http_code}' \
      "$base_url/probe?cloud=RegionOne&include_services=$service" || echo 000)"
    printf '%s %s %s series\n' "$service" "$code" "$(grep -vc '^#' "$folder/$service.prom" || true)" |
      tee -a "$folder/status.txt"
  done
}

# Run the agent's exporter with this credential and record what it gets. The file is
# a throwaway cloud's secret, but it still goes as soon as it has been used.
exporter_sees() {
  local level="$1" clouds_file="$2" folder="$OUTPUT_DIR/access/exporter/$1"
  echo "--- What the exporter gets as $level"
  chmod a+r "$clouds_file"
  docker rm -f ou-openstack-exporter-access >/dev/null 2>&1 || true
  # shellcheck disable=SC2086 # One flag per word.
  docker run -d --name ou-openstack-exporter-access --network host \
    -v "$clouds_file:/etc/openstack/clouds.yaml:ro" \
    "$EXPORTER_IMAGE" --multi-cloud --web.listen-address=:9182 --os-client-config=/etc/openstack/clouds.yaml \
    $EXPORTER_FLAGS >/dev/null
  sleep 3
  scrape_into http://127.0.0.1:9182 "$folder"
  docker logs ou-openstack-exporter-access >"$folder/exporter.log" 2>&1 || true
  docker rm -f ou-openstack-exporter-access >/dev/null 2>&1 || true
  rm -f "$clouds_file"
}

clouds_for_user() {
  local user="$1" project="$2" file
  file="$(mktemp)"
  cat >"$file" <<CLOUDS
clouds:
  RegionOne:
    region_name: RegionOne
    identity_api_version: 3
    auth:
      auth_url: $AUTH_URL
      username: $user
      password: $PASSWORD
      project_name: $project
      user_domain_name: Default
      project_domain_name: Default
CLOUDS
  printf '%s' "$file"
}

clouds_for_application_credential() {
  local file
  file="$(mktemp)"
  cat >"$file" <<CLOUDS
clouds:
  RegionOne:
    region_name: RegionOne
    identity_api_version: 3
    auth_type: v3applicationcredential
    auth:
      auth_url: $AUTH_URL
      application_credential_id: $APPCRED_ID
      application_credential_secret: $APPCRED_SECRET
CLOUDS
  printf '%s' "$file"
}

echo "--- What the exporter gets as admin, to compare the others with"
scrape_into "${EXPORTER_URL:-http://127.0.0.1:9180}" "$OUTPUT_DIR/access/exporter/admin"

echo "--- Accounts"
for user in ou-reader ou-monitor; do
  openstack user show "$user" >/dev/null 2>&1 \
    || openstack user create --domain default --password "$PASSWORD" "$user" >/dev/null
  openstack user set --password "$PASSWORD" "$user"
done
openstack role add --project ou-payments --user ou-reader reader
openstack role show oneuptime_monitoring >/dev/null 2>&1 \
  || openstack role create oneuptime_monitoring >/dev/null
openstack role add --project ou-payments --user ou-monitor oneuptime_monitoring
openstack role add --project ou-payments --user ou-monitor reader

echo "--- An application credential on the admin account, limited to reads"
RULES_FILE="$ACCESS_DIR/application-credential-access-rules.json"
APPCRED_JSON="$(openstack application credential create ou-read-only \
  --role admin --access-rules "$(cat "$RULES_FILE")" -f json 2>"$OUTPUT_DIR/access/appcred-error.txt" || true)"
APPCRED_TOKEN=""
if [ -n "$APPCRED_JSON" ]; then
  APPCRED_ID="$(printf '%s' "$APPCRED_JSON" | python3 -I -c 'import json,sys; c=json.load(sys.stdin); print(c.get("id") or c["ID"])')"
  APPCRED_SECRET="$(printf '%s' "$APPCRED_JSON" | python3 -I -c 'import json,sys; c=json.load(sys.stdin); print(c.get("secret") or c["Secret"])')"
  APPCRED_TOKEN="$(openstack --os-cloud= --os-auth-url "$AUTH_URL" --os-identity-api-version 3 \
    --os-auth-type v3applicationcredential \
    --os-application-credential-id "$APPCRED_ID" --os-application-credential-secret "$APPCRED_SECRET" \
    token issue -f value -c id)" || APPCRED_TOKEN=""
else
  echo "Could not create it: see access/appcred-error.txt" >&2
fi

export OPENSTACK_CATALOG_JSON
OPENSTACK_CATALOG_JSON="$(openstack catalog list -f json)"

echo "--- Before the policy overrides"
{
  echo "admin=$ADMIN_TOKEN"
  echo "reader=$(token_for ou-reader ou-payments)"
  echo "monitoring-role=$(token_for ou-monitor ou-payments)"
  [ -z "$APPCRED_TOKEN" ] || echo "monitoring-admin-get=$APPCRED_TOKEN"
} | python3 -I "$HERE/access-matrix.py" "$OUTPUT_DIR/access/matrix-default-policy.json"

echo "--- With the policy overrides"
# oslo.policy notices a changed file on its own, so no service restarts. Every file
# touched here is put back at the end.
WRITTEN=()
BACKED_UP=()
restore_policy() {
  local file
  for file in "${WRITTEN[@]:-}"; do
    [ -z "$file" ] || sudo rm -f "$file"
  done
  for file in "${BACKED_UP[@]:-}"; do
    [ -z "$file" ] || sudo mv -f "$file.ou-backup" "$file"
  done
}
trap restore_policy EXIT

# The file a service reads is that service's own setting: DevStack points Neutron at
# policy.json. A customer who merges into policy.yaml there changes nothing, which is
# why the access check reads what a credential can really see.
policy_file_of() {
  local service="$1" named
  named="$(sudo grep -hE '^policy_file *=' "/etc/$service/$service.conf" 2>/dev/null | head -1 | sed -E 's/^policy_file *= *//')"
  case "$named" in
    "") printf '/etc/%s/policy.yaml' "$service" ;;
    /*) printf '%s' "$named" ;;
    *) printf '/etc/%s/%s' "$service" "$named" ;;
  esac
}

# Merged over what is already there: DevStack's Neutron file holds a rule its own
# services need. YAML reads JSON, and both are flat maps of rule to check string.
apply_policy() {
  local service="$1" source="$ACCESS_DIR/policy/$1.yaml" target
  [ -f "$source" ] || return 0
  [ -d "/etc/$service" ] || return 0
  target="$(policy_file_of "$service")"
  if sudo test -f "$target"; then
    sudo cp "$target" "$target.ou-backup"
    BACKED_UP+=("$target")
    sudo cat "$target" | python3 -I "$HERE/merge-policy.py" "$source" | sudo tee "$target.ou-merged" >/dev/null
    sudo mv -f "$target.ou-merged" "$target"
  else
    sudo cp "$source" "$target"
    WRITTEN+=("$target")
  fi
  sudo chmod a+r "$target"
  echo "$service reads $target"
}
for service in nova neutron cinder placement keystone glance octavia ironic; do
  apply_policy "$service"
done
# Give the services a moment to read the changed files on their next request.
sleep 5

{
  echo "admin=$(openstack token issue -f value -c id)"
  echo "reader=$(token_for ou-reader ou-payments)"
  echo "monitoring-role=$(token_for ou-monitor ou-payments)"
} | python3 -I "$HERE/access-matrix.py" "$OUTPUT_DIR/access/matrix.json"

exporter_sees monitoring-role "$(clouds_for_user ou-monitor ou-payments)"
exporter_sees reader "$(clouds_for_user ou-reader ou-payments)"

restore_policy
trap - EXIT
WRITTEN=()
BACKED_UP=()

echo "--- An application credential limited by access rules"
# Each service only honours an access rule once keystonemiddleware knows its service
# type, and it refuses the token otherwise. So this level needs a config change and a
# restart on the cloud, which is what the docs have to say, and what this proves.
if [ -z "$APPCRED_TOKEN" ]; then
  echo "No application credential to test: see access/appcred-error.txt" >&2
  exit 0
fi

set_service_type() {
  local conf="$1" type="$2"
  sudo test -f "$conf" || return 0
  sudo sed -i "/^\[keystone_authtoken\]/a service_type = $type" "$conf"
}
set_service_type /etc/nova/nova.conf compute
set_service_type /etc/neutron/neutron.conf network
set_service_type /etc/cinder/cinder.conf block-storage
set_service_type /etc/glance/glance-api.conf image
set_service_type /etc/placement/placement.conf placement

restart_units() {
  local unit
  for unit in devstack@n-api.service devstack@q-svc.service devstack@neutron-api.service \
    devstack@c-api.service devstack@g-api.service devstack@placement-api.service; do
    if systemctl list-unit-files --no-legend "$unit" 2>/dev/null | grep -q .; then
      sudo systemctl restart "$unit"
    fi
  done
}
restart_units

# Wait for the APIs, or the drills after this meet a cloud still starting.
for attempt in $(seq 1 24); do
  if openstack compute service list >/dev/null 2>&1 \
    && openstack network agent list >/dev/null 2>&1 \
    && openstack image list >/dev/null 2>&1; then
    break
  fi
  sleep 5
  : "$attempt"
done

{
  echo "admin=$(openstack token issue -f value -c id)"
  echo "monitoring-admin-get=$APPCRED_TOKEN"
} | python3 -I "$HERE/access-matrix.py" "$OUTPUT_DIR/access/matrix-access-rules.json"

exporter_sees monitoring-admin-get "$(clouds_for_application_credential)"
