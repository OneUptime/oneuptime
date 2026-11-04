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

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACCESS_DIR="$HERE/../../../agents/OpenStackAgent/access"
OUTPUT_DIR="${OUTPUT_DIR:-out}"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"

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
  APPCRED_ID="$(printf '%s' "$APPCRED_JSON" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
  APPCRED_SECRET="$(printf '%s' "$APPCRED_JSON" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["secret"])')"
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
# oslo.policy notices a changed file on its own, so no service restarts. Every
# file written here is removed at the end.
WRITTEN=()
apply_policy() {
  local service="$1" source="$ACCESS_DIR/policy/$1.yaml" target="/etc/$1/policy.yaml"
  [ -f "$source" ] || return 0
  [ -d "/etc/$service" ] || return 0
  sudo cp "$source" "$target"
  sudo chmod a+r "$target"
  WRITTEN+=("$target")
}
for service in nova neutron cinder placement keystone glance octavia ironic; do
  apply_policy "$service"
done
trap 'for file in "${WRITTEN[@]:-}"; do [ -z "$file" ] || sudo rm -f "$file"; done' EXIT
# Give the services a moment to read the changed files on their next request.
sleep 5

{
  echo "admin=$(openstack token issue -f value -c id)"
  echo "reader=$(token_for ou-reader ou-payments)"
  echo "monitoring-role=$(token_for ou-monitor ou-payments)"
} | python3 -I "$HERE/access-matrix.py" "$OUTPUT_DIR/access/matrix.json"
