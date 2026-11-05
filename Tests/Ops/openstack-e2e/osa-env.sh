# What osa-aio.sh and osa-guide.sh agree on. Sourced, never run.

set -uo pipefail

# The release the guide was read from.
OSA_RELEASE="${OSA_RELEASE:-2026.1}"
OSA_BRANCH="stable/$OSA_RELEASE"
# Its mirror: opendev.org answers a runner's many requests less reliably than GitHub does.
# The roles it clones are the repository's own choice, and come from opendev.org.
OSA_GIT="https://github.com/openstack/openstack-ansible"
# The quick start's default: every service in an LXC container of its own.
OSA_SCENARIO="${OSA_SCENARIO:-aio_lxc}"

OSA_HOME="/opt/ou-osa"
OSA_MANAGEMENT_ADDRESS="172.29.236.100"

OUTPUT_DIR="${OUTPUT_DIR:-out}"
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
OSA_RECORDING="$OUTPUT_DIR/osa"

sudo mkdir -p "$OSA_HOME"
sudo chown "$(id -u):$(id -g)" "$OSA_HOME"

export PATH="$OSA_HOME/venv/bin:$PATH"
export OS_CLIENT_CONFIG_FILE="$OSA_HOME/clouds.yaml"
export OS_CLOUD="${OS_CLOUD:-default}"

# The guide's way in: its utility container, which holds the command line and the credential.
# A metal scenario has neither container nor need of one.
in_utility() {
  local utility
  utility="$(sudo lxc-ls -1 2>/dev/null | grep utility | head -n 1 || true)"
  if [ -n "$utility" ]; then
    sudo lxc-attach -n "$utility" -- env PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root \
      bash -c "$1"
  else
    sudo -H bash -c "$1"
  fi
}
