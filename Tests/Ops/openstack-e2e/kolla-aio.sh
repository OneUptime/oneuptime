#!/usr/bin/env bash
#
# Deploy an all-in-one OpenStack with Kolla-Ansible, as its quick start says, with Prometheus
# and Alertmanager on, because that is what the Kolla-Ansible guide starts from. kolla-guide.sh
# then follows that guide on what this leaves.
#
# The quick start asks for two network interfaces and a spare address for the VIP, and a
# runner has one interface on a network it does not own. So a veth pair stands in for the
# two, on a network of its own. Everything else is the quick start's. What differs from
# Kolla-Ansible's defaults is in the rig's globals below, each with its reason:
# /etc/kolla/globals.yml itself is the example it ships.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/kolla-aio.sh deploy|estate

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=Tests/Ops/openstack-e2e/kolla-env.sh
source "$HERE/kolla-env.sh"

mkdir -p "$KOLLA_RECORDING"

log() {
  printf '\n=== %s\n' "$*"
}

# A step's whole output goes to the recording, because Ansible's would fill the job's log,
# and its end to the job's log when it fails.
logged() {
  local name="$1" file="$KOLLA_RECORDING/$1.log" status=0 started
  shift
  started="$(date +%s)"
  log "$name: $*"
  "$@" >"$file" 2>&1 || status=$?
  printf '%s took %s seconds, and exited %s\n' "$name" "$(($(date +%s) - started))" "$status" |
    tee -a "$KOLLA_RECORDING/timings.txt"
  if [ "$status" != 0 ]; then
    tail -n 150 "$file"
  fi
  df -h / | tail -n 1
  free -m | sed -n 2p
  return "$status"
}

prepare_host() {
  log "The runner, before anything"
  df -h /
  free -m
  ip -brief address
  # A runner's image writes this line with a stray word in it, which breaks name resolution.
  sudo sed -i 's/^-e \+//g' /etc/hosts
  docker system prune -af >/dev/null 2>&1 || true

  log "Two interfaces for the quick start to name"
  sudo ip link add "$KOLLA_API_INTERFACE" type veth peer name "$KOLLA_EXTERNAL_INTERFACE"
  sudo ip addr add "$KOLLA_API_ADDRESS/24" dev "$KOLLA_API_INTERFACE"
  sudo ip link set "$KOLLA_API_INTERFACE" up
  sudo ip link set "$KOLLA_EXTERNAL_INTERFACE" up

  log "A volume group for Cinder, on a file"
  sudo apt-get update -qq
  sudo apt-get install -y -qq git python3-dev python3-venv libffi-dev gcc libssl-dev libdbus-glib-1-dev lvm2 thin-provisioning-tools
  sudo apt-get install -y -qq "linux-modules-extra-$(uname -r)" || true
  sudo modprobe iscsi_tcp || true
  sudo modprobe dm_thin_pool || true
  sudo fallocate -l 20G /var/lib/ou-cinder-volumes.img
  local loop
  loop="$(sudo losetup --find --show /var/lib/ou-cinder-volumes.img)"
  sudo pvcreate "$loop"
  sudo vgcreate cinder-volumes "$loop"
}

install_kolla() {
  log "Kolla-Ansible ($KOLLA_BRANCH), in a virtual environment"
  sudo mkdir -p "$KOLLA_HOME" /etc/kolla
  sudo chown "$(id -u):$(id -g)" "$KOLLA_HOME" /etc/kolla
  python3 -m venv "$KOLLA_VENV"
  "$KOLLA_VENV/bin/pip" install -q -U pip
  "$KOLLA_VENV/bin/pip" install -q "git+$KOLLA_GIT@$KOLLA_BRANCH"
  cp -r "$KOLLA_VENV/share/kolla-ansible/etc_examples/kolla/"* /etc/kolla
  cp "$KOLLA_VENV/share/kolla-ansible/ansible/inventory/all-in-one" "$KOLLA_INVENTORY"
  kolla-ansible install-deps
  kolla-genpwd

  mkdir -p /etc/kolla/globals.d
  cat >/etc/kolla/globals.d/rig.yml <<GLOBALS
kolla_base_distro: "ubuntu"
network_interface: "$KOLLA_API_INTERFACE"
neutron_external_interface: "$KOLLA_EXTERNAL_INTERFACE"
kolla_internal_vip_address: "$KOLLA_VIP"
# What the guide starts from. Kolla-Ansible leaves it off.
enable_prometheus: true
# So the guide's table of what exporter 1.7.0 goes without is tested on a cloud with a Cinder.
enable_cinder: true
enable_cinder_backend_lvm: true
# A runner has 4 vCPUs and 16 GB, and nothing here needs more than a worker of each.
openstack_service_workers: 1
openstack_service_rpc_workers: 1
# Software virtualization, so a runner without /dev/kvm can run this too.
nova_compute_virt_type: "qemu"
# Nothing here reads these, and they take memory the rest needs.
enable_heat: false
enable_horizon: false
GLOBALS
  cp /etc/kolla/globals.d/rig.yml "$KOLLA_RECORDING/globals-rig.yml"
}

install_client() {
  log "The openstack command line"
  "$KOLLA_VENV/bin/pip" install -q python-openstackclient \
    -c "https://releases.openstack.org/constraints/upper/$KOLLA_RELEASE"
}

record_what_runs() {
  {
    echo "kolla-ansible: $KOLLA_BRANCH at $(git ls-remote "$KOLLA_GIT" "refs/heads/$KOLLA_BRANCH" | cut -f1)"
    "$KOLLA_VENV/bin/pip" list 2>/dev/null | grep -iE '^(kolla|ansible)' || true
    echo "kernel: $(uname -r)"
    docker version --format 'docker: {{.Server.Version}}' || true
    echo "--- containers"
    docker ps --format '{{.Names}} {{.Image}}' | sort
  } >"$KOLLA_RECORDING/versions.txt" 2>&1
  sudo cat /etc/docker/daemon.json >"$KOLLA_RECORDING/docker-daemon.json" 2>/dev/null || true
  docker image ls --format '{{.Repository}}:{{.Tag}} {{.Size}}' >"$KOLLA_RECORDING/images.txt" 2>&1 || true
}

deploy() {
  prepare_host
  install_kolla
  logged bootstrap-servers kolla-ansible bootstrap-servers -i "$KOLLA_INVENTORY"
  logged prechecks kolla-ansible prechecks -i "$KOLLA_INVENTORY"
  logged pull kolla-ansible pull -i "$KOLLA_INVENTORY"
  logged deploy kolla-ansible deploy -i "$KOLLA_INVENTORY"
  logged post-deploy kolla-ansible post-deploy -i "$KOLLA_INVENTORY"
  install_client
  record_what_runs
  openstack service list
  openstack compute service list
  openstack network agent list
  openstack volume service list
}

estate() {
  log "What the quick start's init-runonce would make, and estate.sh needs"
  openstack network show public >/dev/null 2>&1 || {
    openstack network create --external --provider-physical-network physnet1 \
      --provider-network-type flat public >/dev/null
    openstack subnet create --no-dhcp --network public --subnet-range 192.168.100.0/24 \
      --allocation-pool start=192.168.100.100,end=192.168.100.199 --gateway "$KOLLA_API_ADDRESS" public-subnet >/dev/null
  }
  if ! openstack image show cirros >/dev/null 2>&1; then
    curl -fsSL --retry 5 --retry-all-errors -o "$KOLLA_HOME/cirros.img" \
      https://github.com/cirros-dev/cirros/releases/download/0.6.3/cirros-0.6.3-x86_64-disk.img
    openstack image create --disk-format qcow2 --container-format bare --public \
      --file "$KOLLA_HOME/cirros.img" cirros >/dev/null
  fi
  bash "$HERE/estate.sh"

  log "An aggregate, which DevStack's recordings do not hold, so a page's is read from a real one"
  openstack aggregate show ou-aggregate >/dev/null 2>&1 || {
    openstack aggregate create ou-aggregate >/dev/null
    openstack aggregate add host ou-aggregate \
      "$(openstack compute service list --service nova-compute -f value -c Host | head -1)" >/dev/null
  }
  openstack aggregate list
}

case "${1:-}" in
  deploy) deploy ;;
  estate) estate ;;
  *)
    echo "Usage: kolla-aio.sh deploy|estate" >&2
    exit 2
    ;;
esac
