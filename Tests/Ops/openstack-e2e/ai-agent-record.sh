#!/usr/bin/env bash
#
# The OpenStack AI agent's real code against a real cloud, and what it says when one part
# of that cloud breaks: the policy and the executor the image ships (compiled the way its
# Dockerfile compiles them), over real sockets, with the credential clouds.yaml holds.
# ai-agent-read.js runs every command the policy allows, healthy and with nova-compute
# stopped, and keeps each one's exact output. Those outputs are what an investigation on a
# stopped nova-compute would read. The model is not called here: this proves what it is
# given, and not what it would write from it.
#
# Then ai-agent-fix.js makes real changes, with a write credential made the way the guide
# says: a real disabled nova-compute is proposed for re-enabling and re-enabled on approval, a
# real fake-driver hypervisor's evacuation is proposed with its real instances and projects, and
# what that credential cannot do is asked of the cloud directly. There is no OneUptime here
# either: "proposed" and "approved" are what the agent is handed when a fix is. What the cloud
# did about it is read back through the admin's own client, never through the agent.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/ai-agent-record.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
AGENT="$ROOT/agents/ResourceAIAgent"
OUTPUT_DIR="${OUTPUT_DIR:?Say where the recording goes}"

export OS_CLOUD="${OS_CLOUD:-devstack-admin}"
mkdir -p "$OUTPUT_DIR/ai-agent"

clouds_file() {
  local candidate
  for candidate in "${OS_CLIENT_CONFIG_FILE:-}" "$PWD/clouds.yaml" "$HOME/.config/openstack/clouds.yaml" /etc/openstack/clouds.yaml; do
    if [ -n "$candidate" ] && [ -r "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  echo "No clouds.yaml this user can read." >&2
  return 1
}

HOST="$(openstack compute service list --service nova-compute -f value -c Host | head -1)"
if [ -z "$HOST" ]; then
  echo "This cloud has no nova-compute to stop." >&2
  exit 1
fi

echo "--- Build the agent as its image does"
(
  cd "$AGENT"
  npm ci --ignore-scripts --no-audit --no-fund
  node Scripts/SyncCommon.js --check
  npm run compile
)

export OS_CLIENT_CONFIG_FILE
OS_CLIENT_CONFIG_FILE="$(clouds_file)"
export ONEUPTIME_AI_OPENSTACK_CLOUD="$OS_CLOUD"
export ONEUPTIME_AI_AGENT_RESOURCE_TYPE=openstack
export OPENSTACK_CLOUD_NAME=rig
export ONEUPTIME_URL=http://127.0.0.1:9
export ONEUPTIME_TELEMETRY_INGESTION_KEY=never-sent

read_cloud() {
  node "$HERE/ai-agent-read.js" "$AGENT" "$1" "$HOST" "$OUTPUT_DIR/ai-agent"
}

# A password in an instance's user data, the way tenants put one there. Nova hands it back to
# an admin, as base64, and neither form may reach the output.
PLANTED_SECRET="ou-ai-agent-rig-$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
USER_DATA_FILE="$(mktemp)"
printf '#cloud-config\npassword: %s\n' "$PLANTED_SECRET" >"$USER_DATA_FILE"
IMAGE="$(openstack image list --status active -f value -c Name | grep -i cirros | head -1)"
echo "--- An instance with a password in its user data"
# In the project with room in its quota, on that project's network.
OS_PROJECT_NAME=ou-research openstack server create --flavor ou.tiny --image "$IMAGE" \
  --network ou-research-net --user-data "$USER_DATA_FILE" --wait ou-user-data >/dev/null
export AI_AGENT_PLANTED_SERVER
AI_AGENT_PLANTED_SERVER="$(OS_PROJECT_NAME=ou-research openstack server show ou-user-data -f value -c id)"
export AI_AGENT_PLANTED_SECRETS
AI_AGENT_PLANTED_SECRETS="$PLANTED_SECRET,$(base64 -w0 "$USER_DATA_FILE")"

compute_state() {
  openstack compute service list --service nova-compute --host "$HOST" -f value -c State
}

wait_for_compute() {
  local wanted="$1" elapsed=0
  until [ "$(compute_state)" = "$wanted" ]; do
    if [ "$elapsed" -ge 300 ]; then
      echo "nova-compute on $HOST did not read $wanted in $elapsed seconds." >&2
      return 1
    fi
    sleep 10
    elapsed=$((elapsed + 10))
  done
}

STATUS=0

echo "--- The agent reads a healthy cloud"
read_cloud healthy || STATUS=1

echo "--- nova-compute stopped on $HOST: the agent reads what that left"
sudo systemctl stop devstack@n-cpu.service
if wait_for_compute down; then
  read_cloud compute-down || STATUS=1
else
  STATUS=1
fi
sudo systemctl start devstack@n-cpu.service
wait_for_compute up || STATUS=1

# ---- Fixes, on a real cloud ---------------------------------------------------------

ACCESS_DIR="$ROOT/agents/OpenStackAgent/access"
fix() {
  node "$HERE/ai-agent-fix.js" "$AGENT" "$OUTPUT_DIR/ai-agent" "$@"
}

service_status() {
  openstack compute service list --service nova-compute --host "$1" -f value -c Status
}

echo "--- Make the write credential, as the guide says"
WRITE_PASSWORD="ou-$(openssl rand -hex 12)"
openstack role create oneuptime_remediation >/dev/null
openstack project create --domain default --description "OneUptime fixes: holds nothing" oneuptime-remediation >/dev/null
openstack quota set --instances 0 --cores 0 --ram 0 --key-pairs 0 oneuptime-remediation
openstack user create --domain default --password "$WRITE_PASSWORD" oneuptime-remediation >/dev/null
openstack role add --project oneuptime-remediation --user oneuptime-remediation admin
openstack role add --project oneuptime-remediation --user oneuptime-remediation oneuptime_remediation

# Access rules need service_type set for keystonemiddleware, and an API restart.
for pair in /etc/nova/nova.conf:compute /etc/neutron/neutron.conf:network; do
  conf="${pair%%:*}"
  kind="${pair##*:}"
  if [ -f "$conf" ]; then
    sudo sed -i '/^service_type *=/d' "$conf"
    sudo sed -i "/^\[keystone_authtoken\]/a service_type = $kind" "$conf"
  fi
done
for unit in devstack@n-api.service devstack@q-svc.service devstack@neutron-api.service; do
  if systemctl list-unit-files "$unit" >/dev/null 2>&1; then
    sudo systemctl restart "$unit" || true
  fi
done

# The one policy file, merged the way an operator would, for what access rules cannot see.
# Most clouds never set it, so finding nothing is an answer here and not a failure.
NOVA_POLICY="$( (sudo grep -hE '^policy_file *=' /etc/nova/nova.conf 2>/dev/null || true) | head -1 | sed -E 's/^policy_file *= *//')"
NOVA_POLICY="${NOVA_POLICY:-/etc/nova/policy.yaml}"
case "$NOVA_POLICY" in
  /*) ;;
  *) NOVA_POLICY="/etc/nova/$NOVA_POLICY" ;;
esac
if sudo test -f "$NOVA_POLICY"; then
  sudo cat "$NOVA_POLICY" | python3 -I "$HERE/merge-policy.py" "$ACCESS_DIR/policy/write-nova.yaml" | sudo tee "$NOVA_POLICY.ou-merged" >/dev/null
  sudo mv -f "$NOVA_POLICY.ou-merged" "$NOVA_POLICY"
else
  sudo cp "$ACCESS_DIR/policy/write-nova.yaml" "$NOVA_POLICY"
fi
sudo chmod a+r "$NOVA_POLICY"

AUTH_URL="$(openstack endpoint list --service identity --interface public -f value -c URL | head -1)"
as_write_account() {
  env -u OS_CLOUD -u OS_CLIENT_CONFIG_FILE \
    OS_AUTH_URL="$AUTH_URL" OS_IDENTITY_API_VERSION=3 \
    OS_USERNAME=oneuptime-remediation OS_PASSWORD="$WRITE_PASSWORD" OS_USER_DOMAIN_NAME=Default \
    OS_PROJECT_NAME=oneuptime-remediation OS_PROJECT_DOMAIN_NAME=Default \
    openstack "$@"
}
RULES_FILE="$(mktemp)"
openstack catalog list -f json \
  | python3 -I "$ACCESS_DIR/access-rules-for-cloud.py" "$ACCESS_DIR/write-application-credential-access-rules.json" >"$RULES_FILE"
CREDENTIAL="$(as_write_account application credential create oneuptime-agent-fixes \
  --role admin --role oneuptime_remediation \
  --access-rules "$(cat "$RULES_FILE")" -f json)"
export ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID
ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID="$(printf '%s' "$CREDENTIAL" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
export ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET
ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET="$(printf '%s' "$CREDENTIAL" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["secret"])')"
export OPENSTACK_AUTH_URL="$AUTH_URL"
export ONEUPTIME_AI_ALLOW_WRITES=true
export ONEUPTIME_AI_FIXES=ask-for-approval
# The tokens this credential gets are checked by services that just restarted.
wait_for_compute up || STATUS=1

echo "--- With writes off, nothing runs"
fix writes-off "$HOST" || STATUS=1

echo "--- A real disabled nova-compute: proposed, and re-enabled on approval"
openstack compute service set --disable --disable-reason "ou rig: planned" "$HOST" nova-compute
if [ "$(service_status "$HOST")" != "disabled" ]; then
  echo "nova-compute on $HOST did not read disabled." >&2
  STATUS=1
fi
fix propose-enable "$HOST" || STATUS=1
# A proposal changes nothing.
if [ "$(service_status "$HOST")" != "disabled" ]; then
  echo "Proposing the fix changed the service." >&2
  STATUS=1
fi
fix approve-enable "$HOST" || STATUS=1
if [ "$(service_status "$HOST")" = "enabled" ]; then
  echo "nova-compute on $HOST reads enabled again, to the admin's own client." \
    | tee "$OUTPUT_DIR/ai-agent/fixes/enable-confirmed.txt"
else
  echo "nova-compute on $HOST did not come back enabled." >&2
  STATUS=1
fi
# Whatever happened, the next steps need it enabled.
openstack compute service set --enable "$HOST" nova-compute || true

echo "--- A real instance: started and rebooted on approval, and what stays out of reach"
if SERVER_ID="$(OS_PROJECT_NAME=ou-research openstack server show ou-user-data -f value -c id 2>/dev/null)"; then
  OS_PROJECT_NAME=ou-research openstack server stop ou-user-data
  until [ "$(OS_PROJECT_NAME=ou-research openstack server show ou-user-data -f value -c status)" = "SHUTOFF" ]; do sleep 3; done
  fix change server start "$SERVER_ID" || STATUS=1
  until [ "$(OS_PROJECT_NAME=ou-research openstack server show ou-user-data -f value -c status)" = "ACTIVE" ]; do sleep 3; done
  fix change server reboot --soft "$SERVER_ID" || STATUS=1
  for words in "server delete $SERVER_ID" "server stop $SERVER_ID" "server set --state error $SERVER_ID" \
    "user list" "quota set --instances 100 ou-research" "security group delete default" \
    "compute service set --down $HOST nova-compute" "server migrate confirm $SERVER_ID" \
    "server reboot $SERVER_ID --hard"; do
    # shellcheck disable=SC2086
    fix refused $words || STATUS=1
  done
  fix least-privilege "$SERVER_ID" || STATUS=1
  if ! OS_PROJECT_NAME=ou-research openstack server show ou-user-data >/dev/null 2>&1; then
    echo "The write credential got further than it should: the instance is gone." >&2
    STATUS=1
  fi
else
  echo "The planted instance is not there to work on." >&2
  STATUS=1
fi

echo "--- A real fake-driver hypervisor, and what evacuating it would touch"
FAKE_HOST=ou-fake-compute
VENV="${DEVSTACK_VENV:-/opt/stack/data/venv}"
STATE=/var/tmp/ou-fake-compute
# As capacity-record.sh runs its fake hosts: as whoever runs the real nova-compute.
STACK_USER="$(systemctl show devstack@n-cpu.service -p User --value 2>/dev/null || true)"
STACK_USER="${STACK_USER:-root}"
sudo install -d -o "$STACK_USER" "$STATE" "$STATE/instances"
sudo tee "$STATE/nova.conf" >/dev/null <<CONF
[DEFAULT]
host = $FAKE_HOST
compute_driver = fake.MediumFakeDriver
state_path = $STATE
instances_path = $STATE/instances
CONF
sudo chmod a+r "$STATE/nova.conf"
sudo systemd-run --unit=ou-fake-compute --collect --uid="$STACK_USER" \
  "$VENV/bin/nova-compute" \
  --config-file /etc/nova/nova-cpu.conf \
  --config-file "$STATE/nova.conf" >/dev/null

wait_for_host() {
  local host="$1" wanted="$2" elapsed=0
  until [ "$(openstack compute service list --service nova-compute --host "$host" -f value -c State)" = "$wanted" ]; do
    if [ "$elapsed" -ge 300 ]; then
      echo "nova-compute on $host did not read $wanted in $elapsed seconds." >&2
      return 1
    fi
    sudo "$VENV/bin/nova-manage" cell_v2 discover_hosts >/dev/null 2>&1 || true
    sleep 10
    elapsed=$((elapsed + 10))
  done
}

if wait_for_host "$FAKE_HOST" up; then
  sudo "$VENV/bin/nova-manage" cell_v2 discover_hosts >/dev/null 2>&1 || true
  sleep 15
  # The estate leaves this project close to its quota, on purpose.
  openstack quota set --instances 20 --cores 40 ou-payments
  # Naming the host takes the admin role in the project the instance goes in, and the estate only
  # makes this user a member of them.
  openstack role add --project ou-research --user admin admin
  openstack role add --project ou-payments --user admin admin
  # No network: a fake host has no agent to bind a port. Two projects, so there are two to list.
  OS_PROJECT_NAME=ou-research openstack server create --flavor ou.tiny --image "$IMAGE" --nic none \
    --availability-zone "nova:$FAKE_HOST" --wait ou-evacuate-research >/dev/null || STATUS=1
  OS_PROJECT_NAME=ou-payments openstack server create --flavor ou.tiny --image "$IMAGE" --nic none \
    --availability-zone "nova:$FAKE_HOST" --wait ou-evacuate-payments >/dev/null || STATUS=1
  sudo systemctl stop ou-fake-compute
  if wait_for_host "$FAKE_HOST" down; then
    fix propose-evacuate "$FAKE_HOST" "ou-evacuate-research,ou-evacuate-payments" "ou-research,ou-payments" || STATUS=1
    # Done for real too, though the issue only asks for the proposal: Nova's answer is the record.
    fix approve-evacuate "$FAKE_HOST" || echo "The evacuation itself did not finish: see its result." >&2
    openstack server list --all-projects --name ou-evacuate --long -f json \
      >"$OUTPUT_DIR/ai-agent/fixes/evacuate-after.json" || true
  else
    STATUS=1
  fi
else
  sudo journalctl -u ou-fake-compute --no-pager -n 100 >"$OUTPUT_DIR/ai-agent/fixes/fake-compute.log" || true
  STATUS=1
fi

for name in ou-evacuate-research ou-evacuate-payments; do
  openstack server delete --all-projects "$name" 2>/dev/null || true
done
OS_PROJECT_NAME=ou-research openstack server delete --wait ou-user-data || true

exit "$STATUS"
