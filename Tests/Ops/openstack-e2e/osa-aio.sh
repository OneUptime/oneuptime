#!/usr/bin/env bash
#
# Deploy an all-in-one OpenStack with OpenStack-Ansible, as its quick start says, because that
# is what the OpenStack-Ansible guide starts from. osa-guide.sh then follows that guide on what
# this leaves.
#
# The quick start asks for 8 vCPUs and 80 GB, and a runner has 4 vCPUs and about that disk. So
# this asks no tempest of it, and otherwise waits. What else it changes is for the runner:
#
#  - Docker stops while this runs. A real host has none, and Docker's own firewall rule drops
#    what LXC containers forward. OpenStack-Ansible's own gate flushes those rules for the same
#    reason. osa-guide.sh starts it again, for the agent to run in.
#  - The system's packages are not upgraded and it does not reboot, which the quick start
#    recommends, because a runner cannot come back from one.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/osa-aio.sh deploy|estate

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=Tests/Ops/openstack-e2e/osa-env.sh
source "$HERE/osa-env.sh"

mkdir -p "$OSA_RECORDING"

log() {
  printf '\n=== %s\n' "$*"
}

# A step's whole output goes to the recording, because Ansible's would fill the job's log,
# and its end to the job's log when it fails.
logged() {
  local name="$1" file="$OSA_RECORDING/$1.log" status=0 started
  shift
  started="$(date +%s)"
  log "$name: $*"
  "$@" >"$file" 2>&1 || status=$?
  printf '%s took %s seconds, and exited %s\n' "$name" "$(($(date +%s) - started))" "$status" |
    tee -a "$OSA_RECORDING/timings.txt"
  if [ "$status" != 0 ]; then
    tail -n 150 "$file"
    # What the LXC base image's build said, which Ansible only reports the exit code of. It
    # runs in a chroot and the host's shell redirects it, so this is the host's own /var/log.
    sudo tail -n 60 /var/log/lxc-cache-prep-commands.log 2>/dev/null \
      | tee "$OSA_RECORDING/lxc-cache-prep.log" || true
  fi
  df -h / | tail -n 1
  free -m | sed -n 2p
  return "$status"
}

# As the quick start says: the root user, in the repository's own folder.
as_root_in_repository() {
  sudo -H env SCENARIO="$OSA_SCENARIO" \
    ANSIBLE_FORCE_COLOR=false ANSIBLE_NOCOLOR=true TERM=linux \
    bash -euo pipefail -c "cd /opt/openstack-ansible && $*"
}

prepare_host() {
  log "The runner, before anything"
  df -h /
  free -m
  ip -brief address
  # A runner's image writes this line with a stray word in it, which breaks name resolution.
  sudo sed -i 's/^-e \+//g' /etc/hosts

  log "No Docker, and none of its firewall, while this runs"
  sudo systemctl stop docker.socket docker containerd || true
  sudo iptables -F
  sudo iptables -X || true
  sudo iptables -t nat -F
  sudo iptables -t nat -X || true
  sudo iptables -t mangle -F
  sudo iptables -t mangle -X || true
  sudo iptables -P INPUT ACCEPT
  sudo iptables -P FORWARD ACCEPT

  # A runner carries a dozen vendors' package sources, and the LXC base image inherits the
  # machine's, without their keys, so its first apt-get fails. A real host has its distribution's.
  log "Only the distribution's own package sources"
  sudo find /etc/apt/sources.list.d -type f ! -name 'ubuntu.sources' -print -delete
  # And a runner's image points those at a mirror list in /etc/apt/apt-mirrors.txt, which the base
  # image is not given, so its first apt-get ends at once with 100. A real host names a mirror.
  sudo sed -i 's|mirror+file:/etc/apt/apt-mirrors.txt|http://azure.archive.ubuntu.com/ubuntu/|' \
    /etc/apt/sources.list.d/ubuntu.sources
  grep -h '^URIs:' /etc/apt/sources.list.d/ubuntu.sources || true

  log "What the playbooks log in to this machine with"
  sudo systemctl start ssh.socket ssh 2>/dev/null || sudo systemctl start ssh
  sudo apt-get update -qq
  sudo apt-get install -y -qq git "linux-modules-extra-$(uname -r)" || sudo apt-get install -y -qq git
}

deploy() {
  prepare_host
  log "OpenStack-Ansible ($OSA_BRANCH)"
  sudo rm -rf /opt/openstack-ansible
  sudo git clone --quiet "$OSA_GIT" /opt/openstack-ansible
  sudo git -C /opt/openstack-ansible checkout --quiet "$OSA_BRANCH"
  sudo git -C /opt/openstack-ansible log -1 --format='openstack-ansible: %H %s' | tee "$OSA_RECORDING/versions.txt"

  logged bootstrap-ansible as_root_in_repository scripts/bootstrap-ansible.sh
  logged bootstrap-aio as_root_in_repository scripts/bootstrap-aio.sh
  sudo cat /etc/openstack_deploy/user_variables.yml >"$OSA_RECORDING/user_variables.yml" 2>/dev/null || true
  logged setup-hosts as_root_in_repository openstack-ansible openstack.osa.setup_hosts
  logged setup-infrastructure as_root_in_repository openstack-ansible openstack.osa.setup_infrastructure
  logged setup-openstack as_root_in_repository \
    openstack-ansible openstack.osa.setup_openstack -e tempest_install=no -e tempest_run=no -e rally_install=no

  log "What it left"
  sudo lxc-ls -f | tee "$OSA_RECORDING/containers.txt" || true
  {
    uname -r
    free -m
    df -h /
  } >>"$OSA_RECORDING/versions.txt"
}

estate() {
  log "The openstack command line, on this machine, as its utility container has it"
  python3 -m venv "$OSA_HOME/venv" 2>/dev/null || {
    sudo apt-get install -y -qq python3-venv
    python3 -m venv "$OSA_HOME/venv"
  }
  "$OSA_HOME/venv/bin/pip" install -q -U pip
  "$OSA_HOME/venv/bin/pip" install -q python-openstackclient \
    -c "https://releases.openstack.org/constraints/upper/$OSA_RELEASE"
  in_utility 'cat /root/.config/openstack/clouds.yaml' >"$OS_CLIENT_CONFIG_FILE"
  chmod 0600 "$OS_CLIENT_CONFIG_FILE"
  openstack service list
  openstack compute service list
  openstack network agent list
  openstack volume service list

  log "What estate.sh needs"
  openstack network show public >/dev/null 2>&1 || {
    openstack network create --external --provider-physical-network physnet1 \
      --provider-network-type flat public >/dev/null
    openstack subnet create --no-dhcp --network public --subnet-range 172.29.248.0/22 \
      --allocation-pool start=172.29.248.110,end=172.29.248.200 --gateway 172.29.248.100 public-subnet >/dev/null
  }
  if ! openstack image show cirros >/dev/null 2>&1; then
    curl -fsSL --retry 5 --retry-all-errors -o "$OSA_HOME/cirros.img" \
      https://github.com/cirros-dev/cirros/releases/download/0.6.3/cirros-0.6.3-x86_64-disk.img
    openstack image create --disk-format qcow2 --container-format bare --public \
      --file "$OSA_HOME/cirros.img" cirros >/dev/null
  fi
  bash "$HERE/estate.sh"
}

case "${1:-}" in
  deploy) deploy ;;
  estate) estate ;;
  *)
    echo "Usage: osa-aio.sh deploy|estate" >&2
    exit 2
    ;;
esac
