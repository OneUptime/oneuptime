#!/usr/bin/env bash
#
# Record what a cloud's control plane says when it breaks, from real clusters.
#
# A DevStack runs one RabbitMQ and one MySQL on one machine, so it cannot lose a node,
# lose quorum or split in two, and those are what the alert templates on them are for.
# This runs the real thing in containers on the runner, with the exporters Kolla-Ansible
# pins, and breaks each one the way it breaks in production:
#
#   rabbitmq   three nodes: a node down, a partition, its alarms, unacked and unconsumed
#              messages, file descriptors, every node down
#   mariadb    three Galera nodes: desynced, cut off, down, quorum lost, too many
#              connections, slow queries, every node down
#   memcached  two: nothing connected, evicting, one down, both down
#   haproxy    a backend of two and a backend of one: a server down, a backend down,
#              5xx and 4xx answers
#   ovn        a three-member Raft cluster for each database: a member down, no leader,
#              ovn-northd down
#   alerting   Prometheus and Alertmanager as Kolla-Ansible configures them, with a
#              webhook receiver, so the payload OneUptime is sent is a recording too
#
# After each break it records every exporter's whole answer, and goes on to the next
# whether or not the last one went as planned: what did not is named at the end, and in
# OUTPUT_DIR/control-plane-clusters/problems.txt.
#
# Everything is in containers but the exporters, which are the release archives
# Kolla-Ansible pins (kolla/common/sources.yaml), each held to the sha256 it pins.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/control-plane-clusters.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$HERE/../../../agents/OpenStackAgent"
OUTPUT_DIR="${OUTPUT_DIR:-out}"
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
RECORDING="$OUTPUT_DIR/control-plane-clusters"
WORK="$(mktemp -d)"
chmod 0755 "$WORK"
mkdir -p "$RECORDING"
: >"$RECORDING/problems.txt"

# The versions Docker Hub's official images carry, by digest.
RABBITMQ_IMAGE="rabbitmq:4.1-management@sha256:e1763bfb4a15f9646f9bad2fbae857f4499614577d1165450331189efdb6ea3b"
MARIADB_IMAGE="mariadb:11.4@sha256:d1891ede5a559f1086f55053bb8cc1569b0298338c4d72d71725a7f74f6ba620"
MEMCACHED_IMAGE="memcached:1.6@sha256:aea0d81d101a9b64fe30cf2cf2f96144e284f8e9552bb084a03f4e12e9043bab"
HAPROXY_IMAGE="haproxy:2.8@sha256:1ede2210e3256ce9331d06e100603acca8ff23bf0b9ca265d8598399b17f40e7"
UBUNTU_IMAGE="ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852"
COLLECTOR_IMAGE="$(grep -E '^[[:space:]]*image:[[:space:]]*otel/opentelemetry-collector-contrib' "$AGENT_DIR/docker-compose.yml" | head -1 | awk '{print $2}')"

# Kolla-Ansible's pins, with its own sha256 of each amd64 archive.
MYSQLD_EXPORTER_URL="https://github.com/prometheus/mysqld_exporter/releases/download/v0.20.0/mysqld_exporter-0.20.0.linux-amd64.tar.gz"
MYSQLD_EXPORTER_SHA="5773496e9962ca3817b3599fe4d74f218c95c1295eb2a742462df8e035fe51bd"
MEMCACHED_EXPORTER_URL="https://github.com/prometheus/memcached_exporter/releases/download/v0.17.0/memcached_exporter-0.17.0.linux-amd64.tar.gz"
MEMCACHED_EXPORTER_SHA="40e85262e4340a56fa7cc96722cd596d25ed76ab501459b0b42f1f8e0562d0d1"
NETWORK_EXPORTER_URL="https://github.com/openstack-k8s-operators/openstack-network-exporter/releases/download/v0.3.0/openstack-network-exporter-linux-amd64"
NETWORK_EXPORTER_SHA="bca401a6854bdc350578ff9e3477b4c54527c3f677d7549191e2523f1d03605d"
PROMETHEUS_URL="https://github.com/prometheus/prometheus/releases/download/v3.13.3/prometheus-3.13.3.linux-amd64.tar.gz"
PROMETHEUS_SHA="b349c732d8a853e657d0e7ae1bbad4d11b586615fb65fdc59d896b9f869c001e"
ALERTMANAGER_URL="https://github.com/prometheus/alertmanager/releases/download/v0.34.1/alertmanager-0.34.1.linux-amd64.tar.gz"
ALERTMANAGER_SHA="265b9d1e55ef0d5306a436018af6d2b686c2ce051f03d968f7464ecb1372a7e8"

NETWORK="ou-control-plane"
DB_PASSWORD="ou-recording"

log() {
  printf '\n=== %s\n' "$*"
}

problem() {
  printf '%s\n' "$*" | tee -a "$RECORDING/problems.txt" >&2
}

# Each node has an address of its own on the loopback, so a target's host name tells one
# from another as it does on a real cloud: the collector's host label is the host.
node_address() {
  printf '127.0.1.%s' "$1"
}

fetch() {
  local url="$1" sha="$2" file="$3" actual
  curl -fsSL --retry 5 --retry-all-errors -o "$file" "$url" || {
    problem "Could not download $url"
    return 1
  }
  actual="$(sha256sum "$file" | cut -d ' ' -f 1)"
  if [ "$actual" != "$sha" ]; then
    problem "$url does not match the sha256 Kolla-Ansible pins: $actual"
    return 1
  fi
}

fetch_tar_binary() {
  local url="$1" sha="$2" binary="$3" file
  file="$WORK/$binary.tar.gz"
  fetch "$url" "$sha" "$file" || return 1
  tar --strip-components=1 -xzf "$file" -C "$WORK" --wildcards "*/$binary" || {
    problem "$binary is not in $url"
    return 1
  }
}

# Wait for a command to succeed: a cluster is not ready when its container starts.
wait_for() {
  local what="$1" attempts="$2" attempt
  shift 2
  for attempt in $(seq 1 "$attempts"); do
    if "$@" >/dev/null 2>&1; then
      echo "$what: ready"
      return 0
    fi
    sleep 3
    : "$attempt"
  done
  problem "$what never became ready"
  return 1
}

# name=url of every endpoint a scene reads.
ENDPOINTS=()

add_endpoint() {
  ENDPOINTS+=("$1=$2")
}

# Every endpoint's whole answer at this moment, with how it answered.
scrape_into() {
  local folder="$1" entry name url code
  mkdir -p "$folder"
  : >"$folder/status.txt"
  for entry in "${ENDPOINTS[@]}"; do
    name="${entry%%=*}"
    url="${entry#*=}"
    code="$(curl -sS --max-time 20 -o "$folder/$name.prom" -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
    printf '%s %s %s\n' "$code" "$name" "$url" >>"$folder/status.txt"
    [ -s "$folder/$name.prom" ] || rm -f "${folder:?}/${name:?}.prom"
  done
}

# One scene: now, and again a little later, because a counter's growth takes two readings
# and what a cluster says settles over a few seconds. $1 is the scene's name.
record() {
  local scene="$1"
  echo "--- recording $scene"
  scrape_into "$RECORDING/$scene/first"
  date +%s >"$RECORDING/$scene/first/at.txt"
  sleep "${RECORD_GAP:-30}"
  scrape_into "$RECORDING/$scene/second"
  date +%s >"$RECORDING/$scene/second/at.txt"
}

# Cut two containers off from each other, leaving the host able to scrape both, as a
# switch failing does. Docker's own chain, which it leaves alone and which sees what
# crosses its bridge once br_netfilter is on.
container_address() {
  docker inspect -f "{{(index .NetworkSettings.Networks \"$NETWORK\").IPAddress}}" "$1"
}

cut_off() {
  local a b
  a="$(container_address "$1")"
  b="$(container_address "$2")"
  sudo iptables -I DOCKER-USER -s "$a" -d "$b" -j DROP
  sudo iptables -I DOCKER-USER -s "$b" -d "$a" -j DROP
}

reconnect() {
  local a b
  a="$(container_address "$1")"
  b="$(container_address "$2")"
  sudo iptables -D DOCKER-USER -s "$a" -d "$b" -j DROP
  sudo iptables -D DOCKER-USER -s "$b" -d "$a" -j DROP
}

# ----------------------------------------------------------------------------
# RabbitMQ: three nodes
# ----------------------------------------------------------------------------
rabbit_cluster_of_three() {
  [ "$(docker exec ou-rabbit1 rabbitmqctl -q cluster_status --formatter json \
    | python3 -I -c 'import json,sys; print(len(json.load(sys.stdin)["running_nodes"]))')" = "3" ]
}

start_rabbit() {
  local node="$1" address
  address="$(node_address "$node")"
  docker run -d --name "ou-rabbit$node" --hostname "rabbit$node" --network "$NETWORK" \
    --network-alias "rabbit$node" \
    --ulimit nofile=1024:1024 \
    -e RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS="-kernel net_ticktime 10" \
    -v "$WORK/rabbitmq.conf:/etc/rabbitmq/conf.d/90-ou.conf:ro" \
    -v "$WORK/erlang.cookie:/var/lib/rabbitmq/.erlang.cookie" \
    -p "$address:15692:15692" \
    -p "$address:5672:5672" \
    "$RABBITMQ_IMAGE" >/dev/null
}

python_amqp() {
  "$WORK/venv/bin/python" -I "$HERE/control-plane-amqp.py" "$@"
}

drill_rabbitmq() {
  log "RabbitMQ"
  cat >"$WORK/rabbitmq.conf" <<'EOF'
cluster_formation.peer_discovery_backend = classic_config
cluster_formation.classic_config.nodes.1 = rabbit@rabbit1
cluster_formation.classic_config.nodes.2 = rabbit@rabbit2
cluster_formation.classic_config.nodes.3 = rabbit@rabbit3
cluster_partition_handling = ignore
loopback_users = none
handshake_timeout = 600000
EOF
  chmod 0644 "$WORK/rabbitmq.conf"
  printf 'ouRecordingCookieOuRecordingCookie' >"$WORK/erlang.cookie"
  sudo chown 999:999 "$WORK/erlang.cookie"
  sudo chmod 0400 "$WORK/erlang.cookie"

  local node
  for node in 1 2 3; do
    start_rabbit "$node"
  done
  wait_for "RabbitMQ's three nodes" 80 rabbit_cluster_of_three || return 1

  for node in 1 2 3; do
    add_endpoint "rabbitmq-$node" "http://$(node_address "$node"):15692/metrics"
  done
  # What RabbitMQ can say per queue, once, for what a per-queue alert would read.
  add_endpoint "rabbitmq-1-detailed" "http://$(node_address 1):15692/metrics/detailed?family=queue_coarse_metrics&family=queue_consumer_count"

  RECORD_GAP=10 record rabbitmq-empty

  if python3 -m venv "$WORK/venv" && "$WORK/venv/bin/pip" -q install pika==1.3.2; then
    local client
    python_amqp healthy "$(node_address 1)" &
    client=$!
    sleep 10
    record rabbitmq-healthy

    python_amqp no-consumers "$(node_address 1)"
    kill "$client" 2>/dev/null
    sleep 10
    record rabbitmq-queue-without-consumers

    python_amqp unacked "$(node_address 1)" &
    client=$!
    sleep 15
    record rabbitmq-messages-unacknowledged
    kill "$client" 2>/dev/null
    sleep 5
    python_amqp drain "$(node_address 1)"

    python_amqp hold-connections "$(node_address 1)" 950 &
    client=$!
    sleep 30
    record rabbitmq-file-descriptors-high
    kill "$client" 2>/dev/null
    sleep 10
  else
    problem "No AMQP client: no drills of messages or file descriptors"
  fi

  docker exec ou-rabbit2 rabbitmqctl set_vm_memory_high_watermark absolute 1MB >/dev/null \
    || problem "Could not lower rabbit2's memory watermark"
  sleep 15
  record rabbitmq-memory-alarm
  docker exec ou-rabbit2 rabbitmqctl set_vm_memory_high_watermark 0.6 >/dev/null
  sleep 15

  docker exec ou-rabbit3 rabbitmqctl set_disk_free_limit 100000GB >/dev/null \
    || problem "Could not raise rabbit3's disk limit"
  sleep 15
  record rabbitmq-disk-alarm
  docker exec ou-rabbit3 rabbitmqctl set_disk_free_limit 50MB >/dev/null
  sleep 15

  RECORD_GAP=10 record rabbitmq-recovered-from-alarms

  docker stop ou-rabbit3 >/dev/null
  sleep 30
  record rabbitmq-node-down
  docker start ou-rabbit3 >/dev/null
  wait_for "rabbit3 back in the cluster" 60 rabbit_cluster_of_three

  # Cut one node off from the other two. With partition handling on ignore each side
  # carries on, which is what a partition is: nobody stops, and the two sides disagree.
  cut_off ou-rabbit3 ou-rabbit1
  cut_off ou-rabbit3 ou-rabbit2
  sleep 45
  {
    echo "--- rabbit1"
    docker exec ou-rabbit1 rabbitmq-diagnostics -q cluster_status
    echo "--- rabbit3"
    docker exec ou-rabbit3 rabbitmq-diagnostics -q cluster_status
  } >"$RECORDING/rabbitmq-partition-cluster-status.txt" 2>&1
  record rabbitmq-partition
  reconnect ou-rabbit3 ou-rabbit1
  reconnect ou-rabbit3 ou-rabbit2
  # A partition stays one until a side restarts: RabbitMQ will not guess which to keep.
  docker exec ou-rabbit3 rabbitmqctl stop_app >/dev/null
  docker exec ou-rabbit3 rabbitmqctl start_app >/dev/null
  wait_for "the partition healed" 60 rabbit_cluster_of_three
  RECORD_GAP=10 record rabbitmq-recovered

  docker stop ou-rabbit1 ou-rabbit2 ou-rabbit3 >/dev/null
  sleep 15
  record rabbitmq-cluster-down
  docker start ou-rabbit1 ou-rabbit2 ou-rabbit3 >/dev/null
  wait_for "RabbitMQ's three nodes back" 80 rabbit_cluster_of_three
}

# ----------------------------------------------------------------------------
# MariaDB and Galera: three nodes
# ----------------------------------------------------------------------------
galera_options() {
  local node="$1"
  printf '%s\n' \
    --wsrep_on=ON \
    --wsrep_provider=/usr/lib/galera/libgalera_smm.so \
    --wsrep_cluster_name=ou-recording \
    --wsrep_cluster_address=gcomm://galera1,galera2,galera3 \
    "--wsrep_node_name=galera$node" \
    "--wsrep_node_address=galera$node" \
    --wsrep_sst_method=mariabackup \
    "--wsrep_sst_auth=root:$DB_PASSWORD" \
    --binlog_format=ROW \
    --default_storage_engine=InnoDB \
    --innodb_autoinc_lock_mode=2 \
    --bind-address=0.0.0.0 \
    --max_connections=60 \
    --slow_query_log=ON \
    --long_query_time=0.1
}

start_galera() {
  local node="$1" first="${2:-}" address options=()
  address="$(node_address "$node")"
  mapfile -t options < <(galera_options "$node")
  docker run -d --name "ou-galera$node" --hostname "galera$node" --network "$NETWORK" \
    --network-alias "galera$node" \
    -e MARIADB_ROOT_PASSWORD="$DB_PASSWORD" \
    -e MARIADB_ROOT_HOST=% \
    -v "ou-galera$node:/var/lib/mysql" \
    -p "$address:3306:3306" \
    ou-mariadb-galera ${first:+--wsrep-new-cluster} "${options[@]}" >/dev/null
}

galera_sql() {
  local node="$1"
  shift
  docker exec -e MYSQL_PWD="$DB_PASSWORD" "ou-galera$node" mariadb -uroot -N -e "$*"
}

galera_size_is() {
  local node="$1" wanted="$2"
  [ "$(galera_sql "$node" "SHOW GLOBAL STATUS LIKE 'wsrep_cluster_size'" | awk '{print $2}')" = "$wanted" ]
}

galera_synced() {
  [ "$(galera_sql "$1" "SHOW GLOBAL STATUS LIKE 'wsrep_local_state'" | awk '{print $2}')" = "4" ]
}

galera_connections_under() {
  [ "$(galera_sql "$1" "SHOW GLOBAL STATUS LIKE 'Threads_connected'" | awk '{print $2}')" -lt "$2" ]
}

start_mysqld_exporter() {
  local node="$1" address
  address="$(node_address "$node")"
  cat >"$WORK/my-$node.cnf" <<EOF
[client]
host=$address
port=3306
user=root
password=$DB_PASSWORD
EOF
  chmod 0600 "$WORK/my-$node.cnf"
  # As Kolla-Ansible runs it: its default collectors, and nothing else on the command line.
  "$WORK/mysqld_exporter" --config.my-cnf "$WORK/my-$node.cnf" \
    --web.listen-address "$address:9104" >"$RECORDING/mysqld-exporter-$node.log" 2>&1 &
}

drill_mariadb() {
  log "MariaDB and Galera"
  fetch_tar_binary "$MYSQLD_EXPORTER_URL" "$MYSQLD_EXPORTER_SHA" mysqld_exporter || return 1

  # A joining node's state transfer needs these two, and the official image only says
  # it carries them, so the digest above is all that is pinned and these are made sure of.
  docker build -q -t ou-mariadb-galera - >/dev/null <<EOF || return 1
FROM $MARIADB_IMAGE
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends socat iproute2
EOF

  local node attempt slow
  start_galera 1 first
  wait_for "the first Galera node" 80 galera_size_is 1 1 || {
    docker logs ou-galera1 2>&1 | tail -40 >&2
    return 1
  }
  start_galera 2
  wait_for "two Galera nodes" 80 galera_size_is 1 2 || {
    docker logs ou-galera2 2>&1 | tail -40 >&2
    return 1
  }
  start_galera 3
  wait_for "three Galera nodes" 80 galera_size_is 1 3 || {
    docker logs ou-galera3 2>&1 | tail -40 >&2
    return 1
  }
  wait_for "galera3 in sync" 80 galera_synced 3

  for node in 1 2 3; do
    start_mysqld_exporter "$node"
    add_endpoint "mysqld-$node" "http://$(node_address "$node"):9104/metrics"
  done
  sleep 5
  record mariadb-healthy

  # Asked to fall out of step on purpose, as a backup does: what Atmosphere's rule leaves out.
  galera_sql 2 "SET GLOBAL wsrep_desync=ON" || problem "Could not desync galera2"
  sleep 5
  record mariadb-node-desynced
  galera_sql 2 "SET GLOBAL wsrep_desync=OFF"
  wait_for "galera2 back in sync" 40 galera_synced 2

  cut_off ou-galera3 ou-galera1
  cut_off ou-galera3 ou-galera2
  sleep 20
  record mariadb-node-cut-off
  reconnect ou-galera3 ou-galera1
  reconnect ou-galera3 ou-galera2
  wait_for "galera3 back after being cut off" 60 galera_synced 3
  RECORD_GAP=10 record mariadb-recovered

  docker stop ou-galera3 >/dev/null
  sleep 15
  record mariadb-node-down
  docker start ou-galera3 >/dev/null
  wait_for "galera3 back" 80 galera_synced 3

  # Connections held open, past 80% of max_connections and short of it.
  for attempt in $(seq 1 52); do
    docker exec -d -e MYSQL_PWD="$DB_PASSWORD" ou-galera1 mariadb -uroot -e 'SELECT SLEEP(100)' >/dev/null
    : "$attempt"
  done
  sleep 10
  record mariadb-too-many-connections
  sleep 60
  wait_for "galera1's connections let go" 40 galera_connections_under 1 10

  # Queries over long_query_time, for the whole of a recording's two readings.
  (
    for attempt in $(seq 1 240); do
      galera_sql 2 'SELECT SLEEP(0.2)' >/dev/null 2>&1
      : "$attempt"
    done
  ) &
  slow=$!
  sleep 10
  record mariadb-slow-queries
  kill "$slow" 2>/dev/null
  sleep 5

  # Killed, not stopped: a node that says goodbye leaves a smaller cluster with quorum.
  docker kill ou-galera2 ou-galera3 >/dev/null
  sleep 20
  record mariadb-quorum-lost
  galera_sql 1 "SET GLOBAL wsrep_provider_options='pc.bootstrap=YES'" \
    || problem "Could not put galera1 back in charge"
  docker start ou-galera2 ou-galera3 >/dev/null
  wait_for "three Galera nodes again" 80 galera_size_is 1 3
  wait_for "galera2 in sync again" 80 galera_synced 2
  wait_for "galera3 in sync again" 80 galera_synced 3

  docker stop ou-galera1 ou-galera2 ou-galera3 >/dev/null
  sleep 15
  record mariadb-cluster-down

  # A whole cluster that stopped has to be told which node to start from.
  docker rm -f ou-galera1 >/dev/null
  docker run --rm -v ou-galera1:/var/lib/mysql "$UBUNTU_IMAGE" \
    sed -i 's/^safe_to_bootstrap: 0/safe_to_bootstrap: 1/' /var/lib/mysql/grastate.dat
  start_galera 1 first
  wait_for "the first Galera node, again" 80 galera_size_is 1 1
  docker start ou-galera2 ou-galera3 >/dev/null
  wait_for "three Galera nodes after the whole cluster stopped" 80 galera_size_is 1 3
  RECORD_GAP=10 record mariadb-recovered-from-cluster-down
}

# ----------------------------------------------------------------------------
# Memcached: two
# ----------------------------------------------------------------------------
memcached_exporter_says_up() {
  curl -fsS --max-time 3 "http://$1:9150/metrics" | grep -q '^memcached_up 1'
}

drill_memcached() {
  log "Memcached"
  fetch_tar_binary "$MEMCACHED_EXPORTER_URL" "$MEMCACHED_EXPORTER_SHA" memcached_exporter || return 1
  local node address clients writer
  for node in 1 2; do
    address="$(node_address "$node")"
    # Eight megabytes, so a few writes evict.
    docker run -d --name "ou-memcached$node" -p "$address:11211:11211" \
      "$MEMCACHED_IMAGE" -m 8 -I 256k >/dev/null
    "$WORK/memcached_exporter" --memcached.address "$address:11211" \
      --web.listen-address "$address:9150" >"$RECORDING/memcached-exporter-$node.log" 2>&1 &
    add_endpoint "memcached-$node" "http://$address:9150/metrics"
    wait_for "memcached $node" 20 memcached_exporter_says_up "$address"
  done
  # Nothing has ever connected but the exporter.
  record memcached-no-clients

  python3 -I -c '
import socket, sys, time
held = [socket.create_connection((sys.argv[1], 11211)) for _ in range(20)]
time.sleep(60)
' "$(node_address 1)" &
  clients=$!
  sleep 5
  record memcached-with-clients
  wait "$clients" 2>/dev/null

  python3 -I -c '
import socket, sys, time
held = socket.create_connection((sys.argv[1], 11211))
value = b"x" * 100000
end = time.time() + 60
number = 0
while time.time() < end:
    number += 1
    held.sendall(b"set ou-%d 0 0 %d\r\n%b\r\n" % (number, len(value), value))
    held.recv(100)
    time.sleep(0.1)
' "$(node_address 2)" &
  writer=$!
  sleep 15
  record memcached-evictions-high
  wait "$writer" 2>/dev/null

  docker stop ou-memcached2 >/dev/null
  sleep 5
  RECORD_GAP=10 record memcached-one-down
  docker stop ou-memcached1 >/dev/null
  sleep 5
  RECORD_GAP=10 record memcached-cluster-down
  docker start ou-memcached1 ou-memcached2 >/dev/null
  sleep 5
  RECORD_GAP=10 record memcached-recovered
}

# ----------------------------------------------------------------------------
# HAProxy: as Kolla-Ansible configures its metrics, in front of what answers as told
# ----------------------------------------------------------------------------
start_backend() {
  python3 -I "$HERE/control-plane-backend.py" "$1" "$WORK/backends/$1" >/dev/null 2>&1 &
  echo $! >"$WORK/backend-$1.pid"
}

drill_haproxy() {
  log "HAProxy"
  local address port traffic
  address="$(node_address 1)"
  mkdir -p "$WORK/backends"
  for port in 18081 18082 18083; do
    printf '200\n' >"$WORK/backends/$port"
    start_backend "$port"
  done
  # The names and shape Kolla-Ansible's templates write: <service>_front and <service>_back.
  cat >"$WORK/haproxy.cfg" <<EOF
global
  maxconn 2048
defaults
  mode http
  timeout connect 5s
  timeout client 60s
  timeout server 60s
  timeout check 5s
listen metrics
  bind $address:9101
  mode http
  http-request use-service prometheus-exporter if { path /metrics }
frontend nova_api_front
  bind $address:18774
  default_backend nova_api_back
backend nova_api_back
  option httpchk GET /healthcheck
  http-check expect status 200
  server controller-1 127.0.0.1:18081 check inter 2s fall 2 rise 2
  server controller-2 127.0.0.1:18082 check inter 2s fall 2 rise 2
frontend keystone_internal_front
  bind $address:15000
  default_backend keystone_internal_back
backend keystone_internal_back
  option httpchk GET /healthcheck
  http-check expect status 200
  server controller-1 127.0.0.1:18083 check inter 2s fall 2 rise 2
EOF
  chmod 0644 "$WORK/haproxy.cfg"
  docker run -d --name ou-haproxy --network host \
    -v "$WORK/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro" "$HAPROXY_IMAGE" >/dev/null
  add_endpoint haproxy "http://$address:9101/metrics"
  wait_for "HAProxy's metrics" 20 curl -fsS --max-time 3 "http://$address:9101/metrics" || return 1

  (
    while :; do
      curl -s -o /dev/null --max-time 2 "http://$address:18774/" || true
      curl -s -o /dev/null --max-time 2 "http://$address:15000/" || true
      sleep 0.2
    done
  ) &
  traffic=$!
  sleep 10
  record haproxy-healthy

  printf '500\n' >"$WORK/backends/18081"
  printf '500\n' >"$WORK/backends/18082"
  sleep 5
  record haproxy-api-5xx
  printf '401\n' >"$WORK/backends/18081"
  printf '401\n' >"$WORK/backends/18082"
  sleep 5
  record haproxy-api-401
  printf '200\n' >"$WORK/backends/18081"
  printf '200\n' >"$WORK/backends/18082"
  sleep 5
  RECORD_GAP=10 record haproxy-recovered-from-errors

  kill "$(cat "$WORK/backend-18082.pid")" 2>/dev/null
  sleep 10
  record haproxy-server-down
  kill "$(cat "$WORK/backend-18081.pid")" 2>/dev/null
  sleep 10
  record haproxy-backend-down
  start_backend 18081
  start_backend 18082
  sleep 10
  RECORD_GAP=10 record haproxy-recovered
  kill "$traffic" 2>/dev/null
}

# ----------------------------------------------------------------------------
# OVN: three Raft members for each database, each with the exporter beside it
# ----------------------------------------------------------------------------
drill_ovn() {
  log "OVN"
  fetch "$NETWORK_EXPORTER_URL" "$NETWORK_EXPORTER_SHA" "$WORK/openstack-network-exporter" || return 1
  chmod 0755 "$WORK/openstack-network-exporter"
  local node address members=""
  for node in 1 2 3; do
    address="$(node_address "$node")"
    docker run -d --name "ou-ovn$node" --hostname "ovn$node" --network "$NETWORK" \
      -v "$WORK/openstack-network-exporter:/usr/local/bin/openstack-network-exporter:ro" \
      -v "$HERE/control-plane-ovn-member.sh:/usr/local/bin/ovn-member.sh:ro" \
      -p "$address:1981:1981" \
      "$UBUNTU_IMAGE" sleep infinity >/dev/null
    docker exec "ou-ovn$node" bash -c 'apt-get update -qq && apt-get install -y -qq --no-install-recommends ovn-central procps >/dev/null' \
      || problem "Could not install OVN in ou-ovn$node"
    # A package's own services do not start without systemd. Should one have, it goes.
    docker exec "ou-ovn$node" bash -c 'pkill -f ovsdb-server; pkill ovn-northd; true'
    add_endpoint "ovn-$node" "http://$address:1981/metrics"
    members="$members $(container_address "ou-ovn$node")"
  done
  # Addresses rather than names: Raft listens on the address it is given, and OVS wants
  # one it can bind to.
  # shellcheck disable=SC2086
  set -- $members
  local first="$1"
  docker exec -e OVN_MEMBERS="$members" ou-ovn1 bash /usr/local/bin/ovn-member.sh create "$1" \
    >"$RECORDING/ovn-member-1.log" 2>&1 || problem "The first OVN member did not start"
  docker exec -e OVN_MEMBERS="$members" ou-ovn2 bash /usr/local/bin/ovn-member.sh join "$2" "$first" \
    >"$RECORDING/ovn-member-2.log" 2>&1 || problem "OVN member 2 did not join"
  docker exec -e OVN_MEMBERS="$members" ou-ovn3 bash /usr/local/bin/ovn-member.sh join "$3" "$first" \
    >"$RECORDING/ovn-member-3.log" 2>&1 || problem "OVN member 3 did not join"
  for node in 1 2 3; do
    docker exec -d "ou-ovn$node" bash /usr/local/bin/ovn-member.sh exporter
  done
  sleep 10
  docker exec ou-ovn1 ovs-appctl -t /run/ovn/ovnsb_db.ctl cluster/status OVN_Southbound \
    >"$RECORDING/ovn-healthy-cluster-status.txt" 2>&1
  record ovn-healthy

  docker exec ou-ovn3 bash /usr/local/bin/ovn-member.sh stop
  sleep 20
  record ovn-member-down
  docker exec ou-ovn3 bash /usr/local/bin/ovn-member.sh start
  sleep 15

  # Two of three gone. What the one left says is what the alert has to read: it may go on
  # calling itself the leader for a while, which is why this is drilled and not assumed.
  docker exec ou-ovn2 bash /usr/local/bin/ovn-member.sh stop
  docker exec ou-ovn3 bash /usr/local/bin/ovn-member.sh stop
  sleep 30
  docker exec ou-ovn1 ovs-appctl -t /run/ovn/ovnsb_db.ctl cluster/status OVN_Southbound \
    >"$RECORDING/ovn-no-leader-cluster-status.txt" 2>&1
  record ovn-no-leader
  docker exec ou-ovn2 bash /usr/local/bin/ovn-member.sh start
  docker exec ou-ovn3 bash /usr/local/bin/ovn-member.sh start
  sleep 20
  RECORD_GAP=10 record ovn-recovered

  for node in 1 2 3; do
    docker exec "ou-ovn$node" pkill ovn-northd || true
  done
  sleep 10
  RECORD_GAP=10 record ovn-northd-down
}

# ----------------------------------------------------------------------------
# Alertmanager: what it posts when an alert fires, and when it stops
# ----------------------------------------------------------------------------
drill_alerting() {
  log "Prometheus and Alertmanager, as Kolla-Ansible configures them"
  fetch_tar_binary "$PROMETHEUS_URL" "$PROMETHEUS_SHA" prometheus || return 1
  fetch_tar_binary "$ALERTMANAGER_URL" "$ALERTMANAGER_SHA" alertmanager || return 1
  mkdir -p "$RECORDING/alertmanager"
  python3 -I "$HERE/control-plane-webhook-sink.py" 9099 "$RECORDING/alertmanager" >/dev/null 2>&1 &
  local sink=$!

  local rabbit prometheus alertmanager
  rabbit="$(node_address 1):15692"
  # The job names Kolla-Ansible's prometheus.yml.j2 writes, with a rule of the kind
  # /etc/kolla/config/prometheus/*.rules holds: Kolla-Ansible ships none of its own.
  cat >"$WORK/prometheus.yml" <<EOF
global:
  scrape_interval: 5s
  evaluation_interval: 5s
rule_files:
  - $WORK/ou.rules
scrape_configs:
  - job_name: rabbitmq
    static_configs:
      - targets: ['$rabbit']
alerting:
  alertmanagers:
    - static_configs:
        - targets: ['127.0.0.1:9093']
EOF
  cat >"$WORK/ou.rules" <<'EOF'
groups:
  - name: rabbitmq.rules
    rules:
      - alert: RabbitMQNodeDown
        expr: up{job="rabbitmq"} == 0
        for: 10s
        labels:
          severity: critical
        annotations:
          summary: RabbitMQ node down
          description: "RabbitMQ node down on {{ $labels.instance }}"
EOF
  # What the guide tells a Kolla-Ansible operator to put in
  # /etc/kolla/config/prometheus/prometheus-alertmanager.yml, but for the address.
  cat >"$WORK/alertmanager.yml" <<'EOF'
global:
  resolve_timeout: 5m
route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 10s
  group_interval: 5s
  repeat_interval: 3h
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "http://127.0.0.1:9099/heartbeat/recording"
        send_resolved: true
EOF
  "$WORK/prometheus" --config.file="$WORK/prometheus.yml" --storage.tsdb.path="$WORK/prometheus-data" \
    --web.listen-address=127.0.0.1:9091 >"$RECORDING/prometheus.log" 2>&1 &
  prometheus=$!
  "$WORK/alertmanager" --config.file="$WORK/alertmanager.yml" --storage.path="$WORK/alertmanager-data" \
    --web.listen-address=127.0.0.1:9093 --cluster.listen-address= >"$RECORDING/alertmanager.log" 2>&1 &
  alertmanager=$!
  wait_for "Prometheus" 20 curl -fsS --max-time 3 http://127.0.0.1:9091/-/ready
  wait_for "Alertmanager" 20 curl -fsS --max-time 3 http://127.0.0.1:9093/-/ready

  docker stop ou-rabbit1 >/dev/null
  wait_for "Alertmanager's firing webhook" 40 bash -c "grep -ls '\"status\":\"firing\"' '$RECORDING/alertmanager/'*.json | grep -q ."
  docker start ou-rabbit1 >/dev/null
  wait_for "Alertmanager's resolved webhook" 60 bash -c "grep -ls '\"status\":\"resolved\"' '$RECORDING/alertmanager/'*.json | grep -q ."
  kill "$prometheus" "$alertmanager" "$sink" 2>/dev/null
}

# ----------------------------------------------------------------------------
# The collector, with the agent's real config, reading all of it
# ----------------------------------------------------------------------------
targets_of() {
  local dependency="$1" entry url list=""
  for entry in "${ENDPOINTS[@]}"; do
    case "${entry%%=*}" in
      *-detailed) ;;
      "$dependency"-[0-9]*)
        url="${entry#*=}"
        url="${url#http://}"
        list="$list,${url%%/*}"
        ;;
    esac
  done
  printf '[%s]' "${list#,}"
}

start_collector() {
  mkdir -p "$RECORDING/otlp"
  chmod 0777 "$RECORDING/otlp"
  docker run -d --name ou-control-plane-collector --network host \
    -v "$(cd "$AGENT_DIR" && pwd)/otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro" \
    -v "$HERE/collector-recording.yaml:/etc/otelcol-contrib/recording.yaml:ro" \
    -v "$RECORDING/otlp:/recording" \
    -e ONEUPTIME_URL=http://127.0.0.1:9 \
    -e ONEUPTIME_TELEMETRY_INGESTION_KEY=recording \
    -e OPENSTACK_CLOUD_NAME=recording \
    -e 'OPENSTACK_EXPORTER_CLOUDS=[]' \
    -e OPENSTACK_EXPORTER_ADDRESS=127.0.0.1:1 \
    -e 'OPENSTACK_LIBVIRT_EXPORTER_TARGETS=[]' \
    -e 'OPENSTACK_CEILOMETER_EXPORTER_TARGETS=[]' \
    -e "OPENSTACK_RABBITMQ_TARGETS=$(targets_of rabbitmq)" \
    -e "OPENSTACK_MARIADB_TARGETS=$(targets_of mysqld)" \
    -e "OPENSTACK_MEMCACHED_TARGETS=$(targets_of memcached)" \
    -e "OPENSTACK_HAPROXY_TARGETS=[$(node_address 1):9101]" \
    -e "OPENSTACK_NETWORK_EXPORTER_TARGETS=$(targets_of ovn)" \
    -e 'OPENSTACK_LIBVIRT_HEALTH_TARGETS=[]' \
    -e OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
    -e 'OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=[]' \
    "$COLLECTOR_IMAGE" --config=/etc/otelcol-contrib/config.yaml --config=/etc/otelcol-contrib/recording.yaml >/dev/null
}

sudo modprobe br_netfilter || true
sudo sysctl -q -w net.bridge.bridge-nf-call-iptables=1 || true
docker network create "$NETWORK" >/dev/null

# Each on its own: a cluster that will not form costs its own recording, not the others'.
drill_rabbitmq || problem "RabbitMQ's drills stopped early"
drill_memcached || problem "Memcached's drills stopped early"
drill_haproxy || problem "HAProxy's drills stopped early"
drill_ovn || problem "OVN's drills stopped early"
drill_mariadb || problem "MariaDB's drills stopped early"
drill_alerting || problem "The alerting drill stopped early"

# Last, once everything is back: it reads what a real scrape of all of this sends, with
# the keep lists and the increases the shipped config applies.
log "The agent's collector, on all of it"
start_collector
sleep 200
docker logs ou-control-plane-collector >"$RECORDING/collector.log" 2>&1

for name in $(docker ps -a --format '{{.Names}}' | grep '^ou-'); do
  docker logs "$name" 2>&1 | tail -200 >"$RECORDING/$name.log"
  docker rm -f "$name" >/dev/null 2>&1
done
docker network rm "$NETWORK" >/dev/null 2>&1
sudo iptables -F DOCKER-USER

if [ -s "$RECORDING/problems.txt" ]; then
  echo "Not everything went as planned:" >&2
  cat "$RECORDING/problems.txt" >&2
  # It is still a recording of everything that did: the job says so.
  exit 1
fi
