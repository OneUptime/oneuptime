#!/usr/bin/env bash
#
# Run the probe's real collector against the cloud DevStack deployed on this runner, behind
# DevStack's tls-proxy. A probe never sends a credential over plain HTTP, and every other test of
# it replays a recording, so this is the only thing that shows a real cloud accepts the requests
# the probe makes. packages/Probe/Tests/Utils/OpenStack/OpenStackLiveCloud.test.ts says what it
# holds it to, and stops and starts Neutron and Keystone to do it.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/probe-live.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY="$(cd "$HERE/../../.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-out}"
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"

# The CLI's JSON has said "ID" and "id" in different releases.
field() {
  python3 -I -c 'import json, sys; print({key.lower(): value for key, value in json.load(sys.stdin).items()}[sys.argv[1]])' "$1"
}

unit_named() {
  local unit
  for unit in "$@"; do
    if systemctl list-unit-files --no-legend "$unit" 2>/dev/null | grep -q .; then
      printf '%s' "$unit"
      return 0
    fi
  done
  echo "None of these units exists: $*" >&2
  return 1
}

AUTH_URL="$(openstack endpoint list --service identity --interface public -f value -c URL | head -1)"
AUTH_HOST="$(python3 -I -c 'import sys, urllib.parse; print(urllib.parse.urlsplit(sys.argv[1]).hostname)' "$AUTH_URL")"

# What this job is for. A catalog with one plain address would prove something else.
openstack endpoint list --interface public -f value -c "Service Name" -c URL | tee "$OUTPUT_DIR/public-endpoints.txt"
if grep -E ' http://' "$OUTPUT_DIR/public-endpoints.txt"; then
  echo "tls-proxy left those on plain HTTP" >&2
  exit 1
fi

ADMIN_CREDENTIAL="$(openstack application credential create ou-probe-admin -f json)"
# Each on a line of its own: set -e doesn't stop for a failure inside a command's own environment.
ADMIN_CREDENTIAL_ID="$(printf '%s' "$ADMIN_CREDENTIAL" | field id)"
ADMIN_CREDENTIAL_SECRET="$(printf '%s' "$ADMIN_CREDENTIAL" | field secret)"

# A user of its own, whose password is known, with a role on ou-research and none on ou-payments.
USER_NAME=ou-probe-reader
USER_PASSWORD="$(python3 -I -c 'import secrets; print(secrets.token_hex(16))')"
openstack user create --domain default --password "$USER_PASSWORD" "$USER_NAME" >/dev/null
openstack role add --user "$USER_NAME" --project ou-research reader
READER_CREDENTIAL="$(openstack --os-username "$USER_NAME" --os-password "$USER_PASSWORD" --os-project-name ou-research \
  application credential create ou-probe-reader -f json)"
READER_CREDENTIAL_ID="$(printf '%s' "$READER_CREDENTIAL" | field id)"
READER_CREDENTIAL_SECRET="$(printf '%s' "$READER_CREDENTIAL" | field secret)"
NEUTRON_UNIT="$(unit_named devstack@neutron-api.service devstack@q-svc.service)"
KEYSTONE_UNIT="$(unit_named devstack@keystone.service)"

cd "$REPOSITORY/packages/Probe"

RUN_OPENSTACK_LIVE_CLOUD_TESTS=true \
  OPENSTACK_LIVE_AUTH_URL="$AUTH_URL" \
  OPENSTACK_LIVE_HOST="$AUTH_HOST" \
  OPENSTACK_LIVE_OUTPUT_DIR="$OUTPUT_DIR" \
  OPENSTACK_LIVE_ADMIN_CREDENTIAL_ID="$ADMIN_CREDENTIAL_ID" \
  OPENSTACK_LIVE_ADMIN_CREDENTIAL_SECRET="$ADMIN_CREDENTIAL_SECRET" \
  OPENSTACK_LIVE_READER_CREDENTIAL_ID="$READER_CREDENTIAL_ID" \
  OPENSTACK_LIVE_READER_CREDENTIAL_SECRET="$READER_CREDENTIAL_SECRET" \
  OPENSTACK_LIVE_USER="$USER_NAME" \
  OPENSTACK_LIVE_PASSWORD="$USER_PASSWORD" \
  OPENSTACK_LIVE_NEUTRON_UNIT="$NEUTRON_UNIT" \
  OPENSTACK_LIVE_KEYSTONE_UNIT="$KEYSTONE_UNIT" \
  npx jest --no-watchman --runInBand Tests/Utils/OpenStack/OpenStackLiveCloud.test.ts
