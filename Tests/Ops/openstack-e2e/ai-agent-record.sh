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

OS_PROJECT_NAME=ou-research openstack server delete --wait ou-user-data || true

exit "$STATUS"
