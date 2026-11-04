#!/usr/bin/env bash
#
# Record what a real OpenStack cloud's services write: their log lines with their
# tracebacks, their notifications through oslo.messaging's log driver, and their CADF
# audit events. Parsing all of that is what the OpenStack product's logs, events and
# audit trails stand on, and the formats in the documentation are not what a cloud
# writes: DevStack alone colours its lines and leaves out the time and the process.
#
# Run last, because it changes every service's config and restarts them. It makes the
# failures it records, on a throwaway cloud:
#
#   keystone-defaults  Keystone's notifications with notification_opt_out left alone,
#                      and a failed and a good login: its defaults and docs disagree
#                      on failed logins, so this says which is true
#   devstack           DevStack's own format, in the journal. Every scene below, with
#                      the real journald profile running and writing what it would send
#   oslo-default       oslo.log's default format, in files, as Kolla-Ansible's services
#                      write it, with the real files profile running
#   json               use_json, as a deployment that ships its logs as JSON sets it
#   journal-native     use_journal, as OpenStack-Ansible sets it
#
# Nothing is scrubbed here, on purpose: a test that says no password reaches OneUptime
# has to be run on what the services really wrote. import-log-recording.py replaces each
# secret when lines are copied into the repository. It is DevStack's own throwaway cloud
# on a runner that is gone when the job ends.
#
# Writes under $OUTPUT_DIR/service-logs/<phase>/:
#
#   journal.jsonl.gz    what each unit wrote: time, unit, host, process, priority, line
#   scenes.jsonl        each scene: its name, when it ran, and whether it went as planned
#   ids.env             the ids of what the scenes made
#   api/<name>.json     what Nova's instance actions answered for those
#   otlp-logs.json      what the agent's logs profile would have sent to OneUptime
#   files/<svc>/*.log   the log files, in the oslo-default phase
#   scene-output/       what each scene's commands printed, for a person to check
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/logs-record.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$HERE/../../../agents/OpenStackAgent" && pwd)"
OUTPUT_DIR="$(mkdir -p "${OUTPUT_DIR:-out}" && cd "${OUTPUT_DIR:-out}" && pwd)"
LOGS_DIR="$OUTPUT_DIR/service-logs"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"
CONFIGURE="$HERE/logs-configure.py"

mkdir -p "$LOGS_DIR"

log() {
  printf '\n=== %s\n' "$*"
}

# The user the services run as, who owns their config.
SERVICE_USER="$(stat -c %U /etc/nova/nova.conf)"
HOST="$(openstack compute service list --service nova-compute -f value -c Host | head -1)"
IMAGE="$(openstack image list --status active -f value -c Name | grep -i cirros | head -1)"
AUTH_URL="$(openstack endpoint list --service identity --interface public -f value -c URL | head -1)"
VENV="${DEVSTACK_VENV:-/opt/stack/data/venv}"

# Every service's main config, as DevStack writes it. A release or a network backend may
# not have one of these, so each use checks.
SERVICE_CONFS=(
  /etc/nova/nova.conf
  /etc/nova/nova_cell1.conf
  /etc/nova/nova-cpu.conf
  /etc/neutron/neutron.conf
  /etc/cinder/cinder.conf
  /etc/glance/glance-api.conf
  /etc/keystone/keystone.conf
  /etc/placement/placement.conf
)

ini_set() {
  sudo python3 -I "$CONFIGURE" ini-set "$@"
}

ini_delete() {
  sudo python3 -I "$CONFIGURE" ini-delete "$@"
}

set_on_all() {
  local section="$1" key="$2" value="$3" conf
  for conf in "${SERVICE_CONFS[@]}"; do
    if sudo test -f "$conf"; then
      ini_set "$conf" "$section" "$key" "$value"
    fi
  done
}

delete_on_all() {
  local section="$1" key="$2" conf
  for conf in "${SERVICE_CONFS[@]}"; do
    if sudo test -f "$conf"; then
      ini_delete "$conf" "$section" "$key"
    fi
  done
}

wait_until_answers() {
  local attempt
  for attempt in $(seq 1 60); do
    if openstack compute service list -f value -c State 2>/dev/null | grep -q '^up$'; then
      return 0
    fi
    sleep 5
    : "$attempt"
  done
  echo "The cloud did not answer after a restart" >&2
  return 1
}

# Only the OpenStack services, which is what the configs above are read by. A service that
# will not start is what the journal is being kept to explain, so the phase goes on.
restart_services() {
  log "Restarting the services"
  sudo systemctl restart 'devstack@*' || true
  wait_until_answers || sudo systemctl --no-pager --failed 'devstack@*' || true
}

# ----------------------------------------------------------------------------
# A phase, and its scenes
# ----------------------------------------------------------------------------
PHASE=""
PHASE_DIR=""
PHASE_STARTED=""

start_phase() {
  PHASE="$1"
  PHASE_DIR="$LOGS_DIR/$PHASE"
  mkdir -p "$PHASE_DIR/api" "$PHASE_DIR/scene-output"
  : >"$PHASE_DIR/scenes.jsonl"
  : >"$PHASE_DIR/ids.env"
  PHASE_STARTED="$(date -u '+%Y-%m-%d %H:%M:%S')"
  log "Phase $PHASE"
}

# What each unit wrote since the phase began, keeping the fields a recording reads.
end_phase() {
  local journal="$PHASE_DIR/journal.jsonl.gz"
  sudo journalctl --no-pager -o json --since "$PHASE_STARTED UTC" -u 'devstack@*' \
    | python3 -I "$CONFIGURE" journal-lines \
    | gzip -9 >"$journal"
  sudo chown -R "$(id -u)" "$PHASE_DIR"
  echo "Phase $PHASE: $(wc -c <"$journal") bytes of journal"
}

remember() {
  printf '%s=%s\n' "$1" "$2" >>"$PHASE_DIR/ids.env"
}

# One scene, with a failure written down rather than costing the scenes after it. The
# subshell keeps set -e working inside it, which an `if` around it would turn off.
scene() {
  local name="$1" started ended code
  shift
  log "Scene $name"
  started="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  set +e
  ( set -e; "$@" ) >"$PHASE_DIR/scene-output/$name.txt" 2>&1
  code=$?
  set -e
  ended="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf '{"scene":"%s","startedAt":"%s","endedAt":"%s","exitCode":%s}\n' \
    "$name" "$started" "$ended" "$code" >>"$PHASE_DIR/scenes.jsonl"
  if [ "$code" != 0 ]; then
    echo "Scene $name did not go as planned (exit $code):" >&2
    tail -5 "$PHASE_DIR/scene-output/$name.txt" >&2 || true
  fi
}

id_of_server() {
  openstack server show "$1" -f value -c id
}

wait_for_status() {
  local name="$1" wanted="$2" status="" attempt
  for attempt in $(seq 1 60); do
    status="$(openstack server show "$name" -f value -c status 2>/dev/null || true)"
    if [ "$status" = "$wanted" ]; then
      return 0
    fi
    sleep 5
    : "$attempt"
  done
  echo "$name is $status and not $wanted" >&2
  return 1
}

wait_for_volume() {
  local name="$1" wanted="$2" status="" attempt
  for attempt in $(seq 1 60); do
    status="$(openstack volume show "$name" -f value -c status 2>/dev/null || true)"
    if [ "$status" = "$wanted" ]; then
      return 0
    fi
    sleep 5
    : "$attempt"
  done
  echo "$name is $status and not $wanted" >&2
  return 1
}

# What Nova says happened to an instance, with and without changes-since, as a probe
# reads it on a cloud with notifications off.
record_instance_actions() {
  local key="$1" id="$2" token nova request
  token="$(openstack token issue -f value -c id)"
  nova="$(openstack endpoint list --service compute --interface public -f value -c URL | head -1)"
  curl -sS --max-time 60 -H "X-Auth-Token: $token" -H "OpenStack-API-Version: compute 2.90" \
    "$nova/servers/$id" >"$PHASE_DIR/api/$key-server.json" || true
  curl -sS --max-time 60 -H "X-Auth-Token: $token" -H "OpenStack-API-Version: compute 2.90" \
    "$nova/servers/$id/os-instance-actions" >"$PHASE_DIR/api/$key-actions.json" || true
  curl -sS --max-time 60 -H "X-Auth-Token: $token" -H "OpenStack-API-Version: compute 2.90" \
    "$nova/servers/$id/os-instance-actions?changes-since=2000-01-01T00:00:00Z" \
    >"$PHASE_DIR/api/$key-actions-changes-since.json" || true
  curl -sS --max-time 60 -H "X-Auth-Token: $token" -H "OpenStack-API-Version: compute 2.1" \
    "$nova/servers/$id/os-instance-actions" >"$PHASE_DIR/api/$key-actions-2-1.json" || true
  request="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["instanceActions"][0]["request_id"])' \
    "$PHASE_DIR/api/$key-actions.json" 2>/dev/null || true)"
  if [ -n "$request" ]; then
    remember "${key}_request_id" "$request"
    curl -sS --max-time 60 -H "X-Auth-Token: $token" -H "OpenStack-API-Version: compute 2.90" \
      "$nova/servers/$id/os-instance-actions/$request" >"$PHASE_DIR/api/$key-action-detail.json" || true
  fi
}

# ----------------------------------------------------------------------------
# The scenes
# ----------------------------------------------------------------------------
scene_failed_logins() {
  local attempt body
  # A real user with the wrong password, a user who does not exist, and a good login.
  for attempt in $(seq 1 12); do
    body='{"auth":{"identity":{"methods":["password"],"password":{"user":{"name":"admin","domain":{"name":"Default"},"password":"ou-wrong-password"}}}}}'
    curl -sS --max-time 30 -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' \
      -d "$body" "$AUTH_URL/auth/tokens"
    body='{"auth":{"identity":{"methods":["password"],"password":{"user":{"name":"ou-nobody","domain":{"name":"Default"},"password":"ou-wrong-password"}}}}}'
    curl -sS --max-time 30 -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' \
      -d "$body" "$AUTH_URL/auth/tokens"
    : "$attempt"
  done
  openstack token issue -f value -c expires
}

scene_instance_lifecycle() {
  export OS_PROJECT_NAME=ou-payments
  openstack server create --wait --flavor ou.tiny --image "$IMAGE" --network ou-net ou-log-vm
  remember instance_ok "$(id_of_server ou-log-vm)"
  openstack server stop ou-log-vm
  wait_for_status ou-log-vm SHUTOFF
  openstack server start ou-log-vm
  wait_for_status ou-log-vm ACTIVE
  openstack server reboot --wait ou-log-vm
  openstack server rebuild --wait --image "$IMAGE" --password ou-log-admin-password ou-log-vm
  openstack server pause ou-log-vm
  openstack server unpause ou-log-vm
  record_instance_actions instance_ok "$(id_of_server ou-log-vm)"
}

# No hypervisor can hold the flavor, so the scheduler says No Valid Host.
scene_failed_build_scheduler() {
  export OS_PROJECT_NAME=ou-payments
  openstack server create --flavor ou.impossible --image "$IMAGE" --network ou-net ou-log-novalid
  wait_for_status ou-log-novalid ERROR
  remember instance_no_valid_host "$(id_of_server ou-log-novalid)"
  record_instance_actions instance_no_valid_host "$(id_of_server ou-log-novalid)"
}

# An image bigger inside than the flavor's disk. Glance and the API only see how big its
# file is, so the compute host fails after it was chosen, with a traceback,
# compute.exception and instance.create.error.
scene_failed_build_compute() {
  export OS_PROJECT_NAME=ou-payments
  qemu-img create -f qcow2 "$PHASE_DIR/too-big.qcow2" 20G
  openstack image create --disk-format qcow2 --container-format bare \
    --file "$PHASE_DIR/too-big.qcow2" "ou-log-broken-$PHASE" >/dev/null
  rm -f "$PHASE_DIR/too-big.qcow2"
  openstack server create --flavor ou.tiny --image "ou-log-broken-$PHASE" --network ou-net "ou-log-broken-$PHASE"
  wait_for_status "ou-log-broken-$PHASE" ERROR
  remember instance_spawn_failed "$(id_of_server "ou-log-broken-$PHASE")"
  record_instance_actions instance_spawn_failed "$(id_of_server "ou-log-broken-$PHASE")"
  openstack server delete "ou-log-broken-$PHASE"
  openstack image delete "ou-log-broken-$PHASE"
}

# One hypervisor has nowhere to migrate to, which is a real failure a real migration can
# have, and resizing onto the same host goes through most of a migration's steps.
scene_migrate() {
  export OS_PROJECT_NAME=ou-payments
  openstack server migrate ou-log-vm || true
  sleep 20
  openstack server migrate --live-migration ou-log-vm || true
  sleep 20
  openstack server set --state active ou-log-vm || true
  wait_for_status ou-log-vm ACTIVE
  openstack server resize --flavor ou.tiny2 ou-log-vm
  wait_for_status ou-log-vm VERIFY_RESIZE
  openstack server resize confirm ou-log-vm
  wait_for_status ou-log-vm ACTIVE
  record_instance_actions instance_migrated "$(id_of_server ou-log-vm)"
}

scene_service_disabled() {
  openstack compute service set --disable --disable-reason "OneUptime recording: planned maintenance" "$HOST" nova-compute
  sleep 15
  openstack compute service set --enable "$HOST" nova-compute
}

scene_volume_attach() {
  export OS_PROJECT_NAME=ou-payments
  openstack volume create --size 1 ou-log-vol
  wait_for_volume ou-log-vol available
  remember volume_attached "$(openstack volume show ou-log-vol -f value -c id)"
  openstack server add volume ou-log-vm ou-log-vol
  wait_for_volume ou-log-vol in-use
  openstack volume snapshot create --force --volume ou-log-vol ou-log-snap
  sleep 10
  openstack volume snapshot delete ou-log-snap
  sleep 5
  openstack server remove volume ou-log-vm ou-log-vol
  wait_for_volume ou-log-vol available
  openstack volume delete ou-log-vol
}

scene_network() {
  export OS_PROJECT_NAME=ou-payments
  openstack network create ou-log-net
  openstack subnet create --network ou-log-net --subnet-range 10.79.0.0/24 ou-log-subnet
  openstack port create --network ou-log-net ou-log-port
  openstack router create ou-log-router
  openstack router add subnet ou-log-router ou-log-subnet
  openstack router remove subnet ou-log-router ou-log-subnet
  openstack router delete ou-log-router
  openstack port delete ou-log-port
  openstack subnet delete ou-log-subnet
  openstack network delete ou-log-net
}

# Open to the world on a sensitive port, on every port, over IPv6, and a rule that is not.
scene_security_group() {
  export OS_PROJECT_NAME=ou-payments
  openstack security group create ou-log-sg
  remember security_group "$(openstack security group show ou-log-sg -f value -c id)"
  openstack security group rule create --ingress --protocol tcp --dst-port 22 --remote-ip 0.0.0.0/0 ou-log-sg
  openstack security group rule create --ingress --ethertype IPv6 --protocol tcp --dst-port 3389 --remote-ip ::/0 ou-log-sg
  openstack security group rule create --ingress --protocol tcp --dst-port 1:65535 --remote-ip 0.0.0.0/0 ou-log-sg
  openstack security group rule create --ingress --protocol tcp --dst-port 443 --remote-ip 10.0.0.0/8 ou-log-sg
  openstack security group delete ou-log-sg
}

scene_public_image() {
  head -c 1048576 /dev/zero >"$PHASE_DIR/empty.raw"
  openstack image create --public --disk-format raw --container-format bare \
    --file "$PHASE_DIR/empty.raw" ou-log-public
  remember public_image "$(openstack image show ou-log-public -f value -c id)"
  openstack image set --private ou-log-public
  openstack image set --public ou-log-public
  openstack image delete ou-log-public
  rm -f "$PHASE_DIR/empty.raw"
}

scene_identity() {
  openstack user create --domain default --password ou-log-user-password ou-log-user
  remember identity_user "$(openstack user show ou-log-user -f value -c id)"
  remember admin_project "$(openstack project show admin -f value -c id)"
  # A grant on the project that administers the cloud, and one on an ordinary project.
  openstack role add --project admin --user ou-log-user member
  openstack role add --project ou-payments --user ou-log-user member
  openstack role remove --project admin --user ou-log-user member
  openstack project create --domain default ou-log-project
  openstack project delete ou-log-project
  # The two kinds of application credential: does anything say which was made?
  openstack application credential create ou-log-restricted
  openstack application credential create --unrestricted ou-log-unrestricted
  openstack application credential delete ou-log-restricted
  openstack application credential delete ou-log-unrestricted
  openstack user delete ou-log-user
}

# Nothing answers on the bus: what a service says about that, while it says it.
scene_rabbit_down() {
  sudo systemctl stop rabbitmq-server
  openstack server list --all-projects >/dev/null 2>&1 || true
  sleep 75
  sudo systemctl start rabbitmq-server
  sleep 60
  wait_until_answers
}

# The bus is up and the conductor is not, so a call waits for a reply and times out.
scene_conductor_down() {
  local units=() unit
  for unit in devstack@n-cond-cell1.service devstack@n-super-cond.service; do
    if systemctl list-unit-files --no-legend "$unit" 2>/dev/null | grep -q .; then
      units+=("$unit")
    fi
  done
  sudo systemctl stop "${units[@]}"
  sleep 90
  sudo systemctl start "${units[@]}"
  wait_until_answers
}

scene_database_down() {
  local unit=mysql
  systemctl list-unit-files --no-legend mysql.service 2>/dev/null | grep -q . || unit=mariadb
  sudo systemctl stop "$unit"
  openstack server list --all-projects >/dev/null 2>&1 || true
  openstack token issue >/dev/null 2>&1 || true
  sleep 45
  openstack server list --all-projects >/dev/null 2>&1 || true
  sudo systemctl start "$unit"
  sleep 30
  wait_until_answers
}

# Keystone given keys that cannot read the tokens it gave out: what a controller whose
# Fernet keys differ from the others' does on a real cloud.
scene_token_validation() {
  local token nova manage keys=/etc/keystone/fernet-keys
  manage="$(command -v keystone-manage || echo "$VENV/bin/keystone-manage")"
  token="$(openstack token issue -f value -c id)"
  nova="$(openstack endpoint list --service compute --interface public -f value -c URL | head -1)"
  sudo cp -a "$keys" "$keys.ou-backup"
  sudo rm -rf "$keys"
  sudo "$manage" fernet_setup --keystone-user "$SERVICE_USER" --keystone-group "$(id -gn "$SERVICE_USER")"
  sudo systemctl restart devstack@keystone.service
  sleep 5
  curl -sS --max-time 30 -o /dev/null -w '%{http_code}\n' -H "X-Auth-Token: $token" "$nova/servers" || true
  curl -sS --max-time 30 -o /dev/null -w '%{http_code}\n' -H "X-Auth-Token: $token" "$AUTH_URL/projects" || true
  sleep 30
  sudo rm -rf "$keys"
  sudo mv "$keys.ou-backup" "$keys"
  sudo systemctl restart devstack@keystone.service
  sleep 5
  restart_services
}

scene_cleanup() {
  export OS_PROJECT_NAME=ou-payments
  openstack server delete --wait ou-log-vm || true
  openstack server delete --wait ou-log-novalid || true
}

# ----------------------------------------------------------------------------
# The agent's logs profiles, recording instead of sending
# ----------------------------------------------------------------------------
COLLECTOR_PID_FILE="$LOGS_DIR/collector.pid"

# The collector release install-logs.sh pins, held to its checksum, as an install is.
collector_binary() {
  local version arch sha archive dir="$LOGS_DIR/collector"
  version="$(grep -E '^COLLECTOR_VERSION=' "$AGENT_DIR/install-logs.sh" | head -1 | cut -d'"' -f2)"
  case "$(uname -m)" in
    x86_64 | amd64) arch=amd64; sha="$(grep -E '^COLLECTOR_SHA256_AMD64=' "$AGENT_DIR/install-logs.sh" | cut -d'"' -f2)" ;;
    *) arch=arm64; sha="$(grep -E '^COLLECTOR_SHA256_ARM64=' "$AGENT_DIR/install-logs.sh" | cut -d'"' -f2)" ;;
  esac
  mkdir -p "$dir"
  archive="$dir/otelcol-contrib.tar.gz"
  if [ ! -x "$dir/otelcol-contrib" ]; then
    curl -fsSL --retry 3 -o "$archive" \
      "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${version}/otelcol-contrib_${version}_linux_${arch}.tar.gz"
    echo "$sha  $archive" | sha256sum -c - >&2
    tar --no-same-owner -xzf "$archive" -C "$dir" otelcol-contrib
    rm -f "$archive"
  fi
  printf '%s' "$dir/otelcol-contrib"
}

# As root, where the unit it ships in runs as a user of the journal's group: this is about
# what comes out, and the unit's sandbox is tested on its own.
start_journald_profile() {
  local binary state
  binary="$(collector_binary)"
  state="$PHASE_DIR/collector-state"
  mkdir -p "$state"
  sudo env \
    ONEUPTIME_URL=http://127.0.0.1:9 \
    ONEUPTIME_TELEMETRY_INGESTION_KEY=recording \
    OPENSTACK_CLOUD_NAME=devstack \
    OPENSTACK_NODE_NAME="$HOST" \
    "OPENSTACK_LOGS_UNITS=[devstack@*]" \
    OPENSTACK_LOGS_STATE_DIRECTORY="$state" \
    OPENSTACK_LOGS_RECORDING_FILE="$PHASE_DIR/otlp-logs.json" \
    nohup "$binary" \
    --config="$AGENT_DIR/otel-collector-logs-journald.yaml" \
    --config="$HERE/collector-logs-recording.yaml" \
    "--set=service::telemetry::metrics::readers=[{pull: {exporter: {prometheus: {host: 127.0.0.1, port: 8892}}}}]" \
    >"$PHASE_DIR/collector.log" 2>&1 &
  echo $! >"$COLLECTOR_PID_FILE"
  sleep 10
}

stop_journald_profile() {
  # Its last batch has a few seconds to reach the file.
  sleep 15
  sudo pkill -f "otel-collector-logs-journald.yaml" || true
  sleep 3
  sudo chown -R "$(id -u)" "$PHASE_DIR"
  rm -rf "$PHASE_DIR/collector-state"
  echo "The journald profile wrote $(wc -c <"$PHASE_DIR/otlp-logs.json" 2>/dev/null || echo 0) bytes"
}

start_files_profile() {
  local image files_dir="$1" state="$PHASE_DIR/collector-state"
  image="$(grep -E '^[[:space:]]*image:[[:space:]]*otel/opentelemetry-collector-contrib' "$AGENT_DIR/docker-compose.logs.yml" | head -1 | awk '{print $2}')"
  mkdir -p "$state"
  chmod 0777 "$state" "$PHASE_DIR"
  docker run -d --name ou-openstack-logs-files --network host --user 0:0 \
    -v "$AGENT_DIR/otel-collector-logs-files.yaml:/etc/otelcol-contrib/config.yaml:ro" \
    -v "$HERE/collector-logs-recording.yaml:/etc/otelcol-contrib/recording.yaml:ro" \
    -v "$files_dir:/var/log/kolla:ro" \
    -v "$state:/var/lib/otelcol/file_storage" \
    -v "$PHASE_DIR:/recording" \
    -e ONEUPTIME_URL=http://127.0.0.1:9 \
    -e ONEUPTIME_TELEMETRY_INGESTION_KEY=recording \
    -e OPENSTACK_CLOUD_NAME=devstack \
    -e OPENSTACK_NODE_NAME="$HOST" \
    -e OPENSTACK_LOGS_TIMEZONE=UTC \
    -e OPENSTACK_LOGS_RECORDING_FILE=/recording/otlp-logs.json \
    "$image" --config=/etc/otelcol-contrib/config.yaml --config=/etc/otelcol-contrib/recording.yaml \
    "--set=service::telemetry::metrics::readers=[{pull: {exporter: {prometheus: {host: 127.0.0.1, port: 8892}}}}]"
  sleep 10
}

stop_files_profile() {
  sleep 15
  docker logs ou-openstack-logs-files >"$PHASE_DIR/collector.log" 2>&1 || true
  docker rm -f ou-openstack-logs-files >/dev/null 2>&1 || true
  sudo chown -R "$(id -u)" "$PHASE_DIR"
  rm -rf "$PHASE_DIR/collector-state"
  echo "The files profile wrote $(wc -c <"$PHASE_DIR/otlp-logs.json" 2>/dev/null || echo 0) bytes"
}

# ----------------------------------------------------------------------------
# The phases
# ----------------------------------------------------------------------------
openstack flavor show ou.tiny2 >/dev/null 2>&1 \
  || openstack flavor create --vcpus 1 --ram 192 --disk 1 ou.tiny2 >/dev/null
# The estate leaves this project at its quota on purpose, and these scenes add to it.
openstack quota set --instances 20 --cores 40 ou-payments

# Keystone with its own defaults, apart from where its notifications go.
start_phase keystone-defaults
ini_set /etc/keystone/keystone.conf oslo_messaging_notifications driver log
ini_set /etc/keystone/keystone.conf DEFAULT notification_format cadf
sudo systemctl restart devstack@keystone.service
sleep 10
scene failed-logins scene_failed_logins
end_phase

log "Notifications through the log driver, and audit events"
set_on_all oslo_messaging_notifications driver log
for conf in /etc/nova/nova.conf /etc/nova/nova_cell1.conf /etc/nova/nova-cpu.conf; do
  if sudo test -f "$conf"; then
    ini_set "$conf" notifications notification_format versioned
    ini_set "$conf" notifications notify_on_state_change vm_and_task_state
  fi
done
# Said out loud, because the defaults and the docs disagree. keystone-defaults says which
# is true; the guide sets this.
ini_set /etc/keystone/keystone.conf DEFAULT notification_opt_out identity.authenticate.pending

# keystonemiddleware's audit filter, with the map its project's pycadf ships. A release
# whose paste file looks different is written down, not fatal.
audit_filter() {
  local paste="$1" map="$2" conf="$3" map_file count
  map_file="$(sudo find "$VENV" /usr/local /usr/lib -name "$map" -print -quit 2>/dev/null || true)"
  if [ -z "$map_file" ] || ! sudo test -f "$paste" || ! sudo test -f "$conf"; then
    echo "No audit filter for $paste: map '$map_file'" | tee -a "$LOGS_DIR/audit-filter.txt"
    return 0
  fi
  count="$(sudo python3 -I "$CONFIGURE" paste-audit "$paste" "$map_file")"
  ini_set "$conf" audit_middleware_notifications driver log
  echo "$paste: audit in $count pipeline(s), with $map_file" | tee -a "$LOGS_DIR/audit-filter.txt"
}
audit_filter /etc/nova/api-paste.ini nova_api_audit_map.conf /etc/nova/nova.conf
audit_filter /etc/neutron/api-paste.ini neutron_api_audit_map.conf /etc/neutron/neutron.conf
audit_filter /etc/cinder/api-paste.ini cinder_api_audit_map.conf /etc/cinder/cinder.conf
audit_filter /etc/glance/glance-api-paste.ini glance_api_audit_map.conf /etc/glance/glance-api.conf

restart_services

start_phase devstack
start_journald_profile || echo "The journald profile did not start: see $PHASE_DIR/collector.log" >&2
scene failed-logins scene_failed_logins
scene identity scene_identity
scene instance-lifecycle scene_instance_lifecycle
scene failed-build-scheduler scene_failed_build_scheduler
scene failed-build-compute scene_failed_build_compute
scene migrate scene_migrate
scene service-disabled scene_service_disabled
scene volume-attach scene_volume_attach
scene network scene_network
scene security-group scene_security_group
scene public-image scene_public_image
scene conductor-down scene_conductor_down
scene rabbit-down scene_rabbit_down
scene database-down scene_database_down
scene token-validation scene_token_validation
scene cleanup scene_cleanup
stop_journald_profile || true
end_phase

# oslo.log's own defaults, in a file per binary, with what DevStack changes taken out:
# what Kolla-Ansible's services write. Each service gets the folder Kolla gives it.
start_phase oslo-default
# Outside the runner's home, which the services' user may not be able to walk through.
FILES_DIR=/var/log/ou-kolla
for pair in \
  nova:/etc/nova/nova.conf nova:/etc/nova/nova_cell1.conf nova:/etc/nova/nova-cpu.conf \
  neutron:/etc/neutron/neutron.conf cinder:/etc/cinder/cinder.conf \
  glance:/etc/glance/glance-api.conf keystone:/etc/keystone/keystone.conf \
  placement:/etc/placement/placement.conf; do
  service="${pair%%:*}"
  conf="${pair#*:}"
  if sudo test -f "$conf"; then
    sudo mkdir -p "$FILES_DIR/$service"
    sudo chown "$SERVICE_USER" "$FILES_DIR/$service"
    ini_delete "$conf" DEFAULT logging_context_format_string
    ini_delete "$conf" DEFAULT logging_default_format_string
    ini_delete "$conf" DEFAULT logging_exception_prefix
    ini_delete "$conf" DEFAULT logging_debug_format_suffix
    ini_delete "$conf" DEFAULT logging_user_identity_format
    ini_delete "$conf" DEFAULT log_color
    ini_set "$conf" DEFAULT log_dir "$FILES_DIR/$service"
  fi
done
sudo chmod -R a+rX "$PHASE_DIR"
start_files_profile "$FILES_DIR" || echo "The files profile did not start" >&2
restart_services
sudo chmod -R a+rX "$FILES_DIR"
scene failed-logins scene_failed_logins
scene instance-lifecycle scene_instance_lifecycle
scene failed-build-scheduler scene_failed_build_scheduler
scene failed-build-compute scene_failed_build_compute
scene cleanup scene_cleanup
stop_files_profile || true
end_phase
sudo chmod -R a+rX "$FILES_DIR"
mkdir -p "$PHASE_DIR/files"
sudo cp -r "$FILES_DIR/." "$PHASE_DIR/files/"
sudo chown -R "$(id -u)" "$PHASE_DIR/files"
find "$PHASE_DIR/files" -name '*.log' -exec gzip -9 {} +
delete_on_all DEFAULT log_dir

# oslo.log's JSON formatter, written to the journal.
start_phase json
set_on_all DEFAULT use_json True
restart_services
scene failed-logins scene_failed_logins
scene instance-lifecycle scene_instance_lifecycle
scene failed-build-scheduler scene_failed_build_scheduler
scene failed-build-compute scene_failed_build_compute
scene cleanup scene_cleanup
end_phase
delete_on_all DEFAULT use_json

# oslo.log's own journal handler, which writes fields of its own beside the line: what
# OpenStack-Ansible sets. It needs a library DevStack does not install.
start_phase journal-native
if sudo apt-get install -y libsystemd-dev pkg-config >/dev/null 2>&1 \
  && sudo "$VENV/bin/pip" install systemd-python >/dev/null 2>&1; then
  set_on_all DEFAULT use_journal True
  restart_services
  start_journald_profile || echo "The journald profile did not start" >&2
  scene failed-logins scene_failed_logins
  scene instance-lifecycle scene_instance_lifecycle
  scene failed-build-scheduler scene_failed_build_scheduler
  scene failed-build-compute scene_failed_build_compute
  scene cleanup scene_cleanup
  stop_journald_profile || true
  delete_on_all DEFAULT use_journal
else
  echo "systemd-python did not install: no journal-native phase." | tee "$PHASE_DIR/skipped.txt"
fi
end_phase

log "What was recorded"
find "$LOGS_DIR" -maxdepth 2 -type f -printf '%p %s bytes\n' | sort
