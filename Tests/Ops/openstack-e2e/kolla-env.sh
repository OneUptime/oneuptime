# What kolla-aio.sh and kolla-guide.sh agree on. Sourced, never run.

set -uo pipefail

# The release the guide was read from. Its images are quay.io/openstack.kolla/*:2026.1-ubuntu-noble.
KOLLA_RELEASE="${KOLLA_RELEASE:-2026.1}"
KOLLA_BRANCH="stable/$KOLLA_RELEASE"
# Its mirror: opendev.org answers a runner's many requests less reliably than GitHub does.
KOLLA_GIT="https://github.com/openstack/kolla-ansible"

KOLLA_HOME="/opt/ou-kolla"
KOLLA_VENV="$KOLLA_HOME/venv"
KOLLA_RUNTIME_VENV="$KOLLA_HOME/runtime"
KOLLA_INVENTORY="$KOLLA_HOME/all-in-one"

KOLLA_API_INTERFACE="ou-api"
KOLLA_EXTERNAL_INTERFACE="ou-ext"
KOLLA_API_ADDRESS="192.168.100.10"
KOLLA_VIP="192.168.100.250"

OUTPUT_DIR="${OUTPUT_DIR:-out}"
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
KOLLA_RECORDING="$OUTPUT_DIR/kolla"

export PATH="$KOLLA_VENV/bin:$PATH"
export OS_CLIENT_CONFIG_FILE=/etc/kolla/clouds.yaml
export OS_CLOUD="${OS_CLOUD:-kolla-admin}"
