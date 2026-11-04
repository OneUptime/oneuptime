#!/usr/bin/env bash
#
# What a real OpenStack does when what it stands on goes away, minute by minute.
#
# control-plane-clusters.sh breaks real clusters, on their own. This breaks the RabbitMQ,
# the database, the Memcached, the ovn-controller, the Open vSwitch and the libvirt a real
# DevStack depends on, and records both sides as it happens: what the dependency's own
# exporter says, and what openstack-exporter says about the services above it. That is
# what the alert templates' dependencies are read from: which per-service series fall,
# in what order, and how long after the dependency, so that one incident can open rather
# than twenty, and each resolves on its own when the thing is started again.
#
# It also runs openstack-exporter exactly as Kolla-Ansible runs it, in single-cloud mode
# with no /probe, on the port Kolla-Ansible gives it, so the "bring your own exporter"
# path is held to what that really says.
#
#   control-plane-cloud.sh start    enable and start the exporters
#   control-plane-cloud.sh drills   break each thing in turn, and put it back
#
# Each drill goes on whether or not the last one went as planned: what did not is named at
# the end, and in OUTPUT_DIR/control-plane-cloud/problems.txt. Only ever on a DevStack.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/control-plane-cloud.sh start

set -uo pipefail

ACTION="${1:?usage: control-plane-cloud.sh start|drills}"
OUTPUT_DIR="${OUTPUT_DIR:-out}"
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
RECORDING="$OUTPUT_DIR/control-plane-cloud"
mkdir -p "$RECORDING"
touch "$RECORDING/problems.txt"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"
EXPORTER_URL="${EXPORTER_URL:-http://127.0.0.1:9180}"
EXPORTER_CLOUD="${EXPORTER_CLOUD:-RegionOne}"
SINGLE_CLOUD_EXPORTER_IMAGE="${EXPORTER_STABLE_IMAGE:-ghcr.io/openstack-exporter/openstack-exporter:1.7.0}"
# Where the exporters live, for as long as the runner does.
BIN=/opt/ou-control-plane

# Kolla-Ansible's pins, with its own sha256 of each amd64 archive.
MYSQLD_EXPORTER_URL="https://github.com/prometheus/mysqld_exporter/releases/download/v0.20.0/mysqld_exporter-0.20.0.linux-amd64.tar.gz"
MYSQLD_EXPORTER_SHA="5773496e9962ca3817b3599fe4d74f218c95c1295eb2a742462df8e035fe51bd"
MEMCACHED_EXPORTER_URL="https://github.com/prometheus/memcached_exporter/releases/download/v0.17.0/memcached_exporter-0.17.0.linux-amd64.tar.gz"
MEMCACHED_EXPORTER_SHA="40e85262e4340a56fa7cc96722cd596d25ed76ab501459b0b42f1f8e0562d0d1"
NETWORK_EXPORTER_URL="https://github.com/openstack-k8s-operators/openstack-network-exporter/releases/download/v0.3.0/openstack-network-exporter-linux-amd64"
NETWORK_EXPORTER_SHA="bca401a6854bdc350578ff9e3477b4c54527c3f677d7549191e2523f1d03605d"

problem() {
  printf '%s\n' "$*" | tee -a "$RECORDING/problems.txt" >&2
}

unit_exists() {
  systemctl list-unit-files --no-legend "$1" 2>/dev/null | grep -q .
}

fetch() {
  local url="$1" sha="$2" file="$3" actual
  sudo curl -fsSL --retry 5 --retry-all-errors -o "$file" "$url" || {
    problem "Could not download $url"
    return 1
  }
  actual="$(sudo sha256sum "$file" | cut -d ' ' -f 1)"
  if [ "$actual" != "$sha" ]; then
    problem "$url does not match the sha256 Kolla-Ansible pins: $actual"
    return 1
  fi
}

fetch_tar_binary() {
  local url="$1" sha="$2" binary="$3"
  fetch "$url" "$sha" "$BIN/$binary.tar.gz" || return 1
  sudo tar --strip-components=1 -xzf "$BIN/$binary.tar.gz" -C "$BIN" --wildcards "*/$binary"
}

# The password DevStack gave the database, from the connection string it wrote for Keystone.
database_password() {
  sudo sed -n 's/^connection *= *//p' /etc/keystone/keystone.conf | head -1 \
    | python3 -I -c 'import sys, urllib.parse; print(urllib.parse.urlsplit(sys.stdin.read().strip()).password or "")'
}

start_exporters() {
  sudo mkdir -p "$BIN"

  # RabbitMQ's own, on 15692, as Kolla-Ansible turns it on.
  sudo rabbitmq-plugins enable rabbitmq_prometheus || problem "Could not enable RabbitMQ's Prometheus plugin"

  if fetch_tar_binary "$MYSQLD_EXPORTER_URL" "$MYSQLD_EXPORTER_SHA" mysqld_exporter; then
    sudo tee "$BIN/my.cnf" >/dev/null <<EOF
[client]
host=127.0.0.1
port=3306
user=root
password=$(database_password)
EOF
    sudo chmod 0600 "$BIN/my.cnf"
    sudo systemd-run --unit=ou-mysqld-exporter --collect "$BIN/mysqld_exporter" \
      --config.my-cnf "$BIN/my.cnf" --web.listen-address 127.0.0.1:9104 \
      || problem "Could not start mysqld_exporter"
  fi

  if fetch_tar_binary "$MEMCACHED_EXPORTER_URL" "$MEMCACHED_EXPORTER_SHA" memcached_exporter; then
    sudo systemd-run --unit=ou-memcached-exporter --collect "$BIN/memcached_exporter" \
      --memcached.address 127.0.0.1:11211 --web.listen-address 127.0.0.1:9150 \
      || problem "Could not start memcached_exporter"
  fi

  if fetch "$NETWORK_EXPORTER_URL" "$NETWORK_EXPORTER_SHA" "$BIN/openstack-network-exporter"; then
    sudo chmod 0755 "$BIN/openstack-network-exporter"
    # Where DevStack's packages keep these sockets, and Kolla-Ansible's /run/ovn beside it.
    sudo systemd-run --unit=ou-network-exporter --collect \
      -E OPENSTACK_NETWORK_EXPORTER_HTTP_LISTEN=127.0.0.1:1981 \
      -E OPENSTACK_NETWORK_EXPORTER_OVN_RUNDIR=/var/run/ovn \
      -E OPENSTACK_NETWORK_EXPORTER_OVSDB_RUNDIR=/var/run/ovn \
      -E OPENSTACK_NETWORK_EXPORTER_OVS_RUNDIR=/var/run/openvswitch \
      "$BIN/openstack-network-exporter" \
      || problem "Could not start openstack-network-exporter"
  fi

  # As ansible/roles/prometheus/templates/prometheus-openstack-exporter.json.j2 runs it,
  # with its single entry called default, and OS_COMPUTE_API_VERSION as Kolla-Ansible sets
  # it. Public rather than internal only because that is what a DevStack's catalog has.
  local clouds="$RECORDING/clouds-single-cloud.yaml"
  sudo sed 's/^\( *\)devstack-admin:/\1default:/' /etc/openstack/clouds.yaml | sudo tee "$clouds" >/dev/null
  sudo chmod a+r "$clouds"
  docker run -d --name ou-openstack-exporter-kolla --network host --restart unless-stopped \
    -e OS_COMPUTE_API_VERSION=latest \
    -v "$clouds:/etc/openstack/clouds.yaml:ro" \
    "$SINGLE_CLOUD_EXPORTER_IMAGE" \
    --endpoint-type=public --os-client-config=/etc/openstack/clouds.yaml \
    --web.listen-address=:9198 default >/dev/null \
    || problem "Could not start the exporter in single-cloud mode"

  sleep 5
  systemctl --no-pager --lines=5 status ou-mysqld-exporter ou-memcached-exporter ou-network-exporter >&2 || true
}

# Everything that says anything, at this moment, into a folder.
scrape_everything() {
  local folder="$1" entry name url code service
  mkdir -p "$folder"
  : >"$folder/status.txt"
  date +%s >"$folder/at.txt"
  for service in identity compute placement network volume; do
    code="$(curl -sS --max-time 60 -o "$folder/exporter-$service.prom" -w '%{http_code}' \
      "$EXPORTER_URL/probe?cloud=$EXPORTER_CLOUD&include_services=$service" 2>/dev/null || echo 000)"
    printf '%s exporter-%s\n' "$code" "$service" >>"$folder/status.txt"
  done
  for entry in \
    rabbitmq=http://127.0.0.1:15692/metrics \
    mysqld=http://127.0.0.1:9104/metrics \
    memcached=http://127.0.0.1:9150/metrics \
    network=http://127.0.0.1:1981/metrics \
    libvirt=http://127.0.0.1:9177/metrics \
    single-cloud=http://127.0.0.1:9198/metrics; do
    name="${entry%%=*}"
    url="${entry#*=}"
    code="$(curl -sS --max-time 60 -o "$folder/$name.prom" -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
    printf '%s %s\n' "$code" "$name" >>"$folder/status.txt"
  done
  find "$folder" -name '*.prom' -size 0 -delete
}

cli_into() {
  {
    echo "\$ openstack compute service list"
    timeout 60 openstack compute service list
    echo "\$ openstack network agent list"
    timeout 60 openstack network agent list
    echo "\$ openstack volume service list"
    timeout 60 openstack volume service list
  } >"$1/cli.txt" 2>&1
}

# Every worker back up, which is what a person would check before calling it over.
workers_are_up() {
  local answer
  answer="$(timeout 60 openstack compute service list -f value -c State 2>/dev/null)" || return 1
  [ -n "$answer" ] || return 1
  printf '%s\n' "$answer" | grep -qv '^up$' && return 1
  answer="$(timeout 60 openstack network agent list -f value -c Alive 2>/dev/null)" || return 1
  [ -n "$answer" ] || return 1
  printf '%s\n' "$answer" | grep -qiE '^(false|xxx|:-\()$' && return 1
  return 0
}

wait_until_recovered() {
  local scene="$1" attempt
  for attempt in $(seq 1 60); do
    if workers_are_up; then
      echo "$scene: everything is back."
      return 0
    fi
    sleep 5
    : "$attempt"
  done
  problem "$scene: not everything came back in five minutes"
  return 1
}

# Stop some units, record each minute for as long as the drill lasts, and start them again.
drill() {
  local scene="$1" minutes="$2" minute unit started
  shift 2
  echo "--- $scene: stopping $*"
  scrape_everything "$RECORDING/$scene/before"
  sudo systemctl stop "$@" || problem "$scene: could not stop $*"
  for minute in $(seq 1 "$minutes"); do
    sleep 60
    scrape_everything "$RECORDING/$scene/minute-$minute"
  done
  cli_into "$RECORDING/$scene/minute-$minutes"
  started=0
  for unit in "$@"; do
    sudo systemctl start "$unit" || problem "$scene: could not start $unit"
    started=1
  done
  [ "$started" = 1 ] || problem "$scene: nothing to start"
  wait_until_recovered "$scene"
  scrape_everything "$RECORDING/$scene/recovered"
  cli_into "$RECORDING/$scene/recovered"
}

run_drills() {
  scrape_everything "$RECORDING/healthy"
  cli_into "$RECORDING/healthy"

  if unit_exists rabbitmq-server.service; then
    drill rabbitmq-down 5 rabbitmq-server.service
  else
    problem "This cloud has no rabbitmq-server unit"
  fi

  if unit_exists mysql.service; then
    drill mariadb-down 4 mysql.service
  elif unit_exists mariadb.service; then
    drill mariadb-down 4 mariadb.service
  else
    problem "This cloud has no database unit"
  fi

  if unit_exists memcached.service; then
    drill memcached-down 2 memcached.service
  fi

  # Only a cloud on OVN has one. ML2/OVS has no ovn-controller to stop.
  if unit_exists ovn-controller.service && systemctl is-active -q ovn-controller.service; then
    drill ovn-controller-down 4 ovn-controller.service
  fi

  if unit_exists ovs-vswitchd.service && systemctl is-active -q ovs-vswitchd.service; then
    drill ovs-down 3 ovs-vswitchd.service
  fi

  # Its sockets start it again when anything knocks, and nova-compute knocks.
  if unit_exists libvirtd.service; then
    drill libvirt-down 3 libvirtd.socket libvirtd-ro.socket libvirtd-admin.socket libvirtd.service
  fi

  # What the exporter in single-cloud mode does with no Keystone: its source exits.
  if unit_exists devstack@keystone.service; then
    drill keystone-down 3 devstack@keystone.service
    docker logs ou-openstack-exporter-kolla >"$RECORDING/exporter-single-cloud.log" 2>&1
  fi

  if [ -s "$RECORDING/problems.txt" ]; then
    echo "Not everything went as planned:" >&2
    cat "$RECORDING/problems.txt" >&2
    exit 1
  fi
}

case "$ACTION" in
  start) start_exporters ;;
  drills) run_drills ;;
  *)
    echo "usage: control-plane-cloud.sh start|drills" >&2
    exit 2
    ;;
esac
