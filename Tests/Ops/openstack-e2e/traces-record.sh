#!/usr/bin/env bash
#
# Record what OSProfiler's OTLP driver really sends when a real request is signed, through
# the agent's real traces profile. The OpenStack product's traces stand on this: the
# driver is marked experimental, says nothing about a cloud or a host, and writes names
# and parents its own way, and only its output says what those are on a given release.
#
# The issue's "done when" is the signed-boot scene: one trace across Nova, Neutron and
# Placement, tied to the instance it made, through the local collector. The others answer
# what a page and a guide have to say out loud:
#
#   off-signed-list           OSProfiler off, as a cloud is by default: a signed request
#                             still answers, and makes nothing
#   no-libraries-signed-list  On, without the OpenTelemetry libraries each service needs:
#                             what a service says, and whether anything breaks
#   unsigned-list             On, and not signed: nothing. It is per request by design
#   wrong-key-list            On, signed with the wrong key: nothing, and no error
#   signed-list               A read, across Nova and Keystone
#   signed-boot               A boot, with --wait, which is the trace the product is for
#   signed-show               The instance by id: what a path can say about a resource
#   signed-boot-failed        No valid host: what a failure looks like in the driver's spans
#   signed-volume             A volume made, attached, detached and deleted: Cinder
#   signed-network            A network, subnet, port and router: Neutron on its own
#   signed-image, signed-token  Glance and Keystone
#   signed-delete             Deleting what was booted
#   collector-down-*          The local collector stopped: whether a signed request or a
#                             boot notices, which decides if tracing can hurt a cloud
#   signed-boot-sql           trace_sqlalchemy on: what it costs in spans, and what it holds
#   signed-boot-requests      trace_requests on: the client spans it adds between services
#   signed-by-header          A request signed by hand, with no OSProfiler where it was sent
#                             from, as a probe's scheduled check would have to
#   signed-boot-placement     Placement with the one line a local patch adds, because stock
#                             Placement cannot start the driver at all
#   signed-boot-whole         That, with Nova's conductor and scheduler on one worker each:
#                             a service that forks workers after making its driver sends nothing
#   signed-boot-failed-whole  No valid host again, with the service that fails it traced
#   signed-boot-osprofiler-fix  Stock Placement over the fix OSProfiler itself could take
#   native-messaging-*        Where a release has it, oslo.messaging's own OpenTelemetry tracing
#   native-both-*             That and oslo.middleware's, with nothing signed: what an always-on
#                             feed would be, and what it costs an idle cloud in spans
#   native-with-osprofiler-boot  Both of those and OSProfiler at once, signed
#   off-again-signed-boot     Off again: nothing, and nothing broken
#
# Which services a stock boot crosses, and which of them go quiet, is what check.txt and the
# guide read from this, so nothing here decides it in advance: a release that does better
# says so in its summary.
#
# The key is generated here and goes nowhere but the services' configs and the environment
# of each signed command. Before anything is uploaded, remove-key replaces it wherever it
# turned up and writes down where that was, because where it can turn up is a finding.
#
# Puts back every file it edits when it ends, whichever way it ends, so the logs step after
# it starts from the cloud it expects.
#
# Writes under $OUTPUT_DIR/traces/:
#
#   otlp-driver.json.gz  what the driver sent, before anything touched it
#   otlp-agent.json.gz   what the agent's traces profile would have sent to OneUptime
#   scenes.jsonl         each scene: when, how long, its exit code, its Trace IDs, its spans
#   summary.json         each scene's trace, service by service, with its spans and bytes
#   native-summary.json  what the scenes with nothing signed made, by scope, where they ran
#   native-settings.txt  what was added to each API's pipeline for them
#   check.txt            whether the "done when" held on this run
#   key-check.txt        how many times the key was found in each file, before it was removed
#   ids.env              the ids of what the scenes made
#   context/*.json       what the cloud says those are, to hold a trace's ids against
#   versions.txt         the versions a release really runs, and what the client offers
#   profiler-conf.txt    the [profiler] section, without the key
#   journal.jsonl.gz     what the services logged, to hold a trace's requests against
#   stuck/<name>/        when a cloud did not come back: each service's status, last lines, and
#                        where each of its processes is, by py-spy
#   which-services-start.txt  then, whether it is the libraries or the driver, and which service
#   scene-output/        what each scene's commands printed, for a person to check
#   collector.log        the collector's own log
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/traces-record.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$HERE/../../../agents/OpenStackAgent" && pwd)"
OUTPUT_DIR="$(mkdir -p "${OUTPUT_DIR:-out}" && cd "${OUTPUT_DIR:-out}" && pwd)"
TRACES_DIR="$OUTPUT_DIR/traces"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"
CONFIGURE="$HERE/logs-configure.py"
READ="$HERE/traces-read.py"
VENV="${DEVSTACK_VENV:-/opt/stack/data/venv}"
# The release's own pins, which is what a deployment tool would install.
CONSTRAINTS="${DEVSTACK_CONSTRAINTS:-/opt/stack/requirements/upper-constraints.txt}"
COLLECTOR_NAME=ou-openstack-traces

mkdir -p "$TRACES_DIR/scene-output" "$TRACES_DIR/context"
chmod 0777 "$TRACES_DIR"
: >"$TRACES_DIR/scenes.jsonl"
: >"$TRACES_DIR/ids.env"

log() {
  printf '\n=== %s\n' "$*"
}

STARTED="$(date -u '+%Y-%m-%d %H:%M:%S')"
HMAC_KEY="$(openssl rand -hex 32)"
HOST="$(openstack compute service list --service nova-compute -f value -c Host | head -1)"
IMAGE="$(openstack image list --status active -f value -c Name | grep -i cirros | head -1)"

# As logs-record.sh keeps them: a release or a network backend may not have one of these.
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
# Where the APIs' pipelines are, for oslo.middleware's filter. Keystone and Placement have
# none to add it to: they build theirs in code.
PASTE_FILES=(
  /etc/nova/api-paste.ini
  /etc/neutron/api-paste.ini
  /etc/cinder/api-paste.ini
  /etc/glance/glance-api-paste.ini
)
# A service's config that OSProfiler stays off in, once it has shown it cannot start with it on.
declare -A NOT_TRACED_CONFS=()
SAVED_DIR="$(mktemp -d)"
PLACEMENT_WSGI="$("$VENV/bin/python" -I -c 'import placement.wsgi as module; print(module.__file__)' 2>/dev/null || true)"
OSPROFILER_OPTS="$("$VENV/bin/python" -I -c 'import osprofiler.opts as module; print(module.__file__)' 2>/dev/null || true)"

saved_name() {
  printf '%s/%s' "$SAVED_DIR" "$(printf '%s' "$1" | tr '/' '_')"
}

save_files() {
  local file
  for file in "$@"; do
    if [ -n "$file" ] && sudo test -f "$file"; then
      sudo cp -p "$file" "$(saved_name "$file")"
    fi
  done
}

restore_files() {
  local file
  for file in "$@"; do
    if [ -n "$file" ] && sudo test -f "$(saved_name "$file")"; then
      sudo cp -p "$(saved_name "$file")" "$file"
    fi
  done
}

save_files "${SERVICE_CONFS[@]}" "${PASTE_FILES[@]}" "$PLACEMENT_WSGI" "$OSPROFILER_OPTS"

set_in() {
  if sudo test -f "$1"; then
    sudo python3 -I "$CONFIGURE" ini-set "$1" "$2" "$3" "$4"
  fi
}

set_profiler() {
  local key="$1" value="$2" conf
  for conf in "${SERVICE_CONFS[@]}"; do
    if [ -n "${NOT_TRACED_CONFS[$conf]:-}" ]; then
      continue
    fi
    if sudo test -f "$conf"; then
      sudo python3 -I "$CONFIGURE" ini-set "$conf" profiler "$key" "$value"
    fi
  done
}

# When a whole cloud will not come back with the driver on: whether the libraries alone do that,
# and if not, which service does, one config at a time, each kept on only if the cloud answers
# with it on. What it finds is in which-services-start.txt, and the scenes go on with those.
find_what_starts_with_the_driver() {
  local line conf units answer
  : >"$TRACES_DIR/which-services-start.txt"
  set_profiler enabled False
  if restart_services; then
    echo "With the libraries in and OSProfiler off, the cloud answers." >>"$TRACES_DIR/which-services-start.txt"
  else
    echo "With the libraries in and OSProfiler off, the cloud does not answer." >>"$TRACES_DIR/which-services-start.txt"
    return 0
  fi
  for line in \
    "/etc/keystone/keystone.conf devstack@keystone" \
    "/etc/glance/glance-api.conf devstack@g-api" \
    "/etc/placement/placement.conf devstack@placement-api" \
    "/etc/neutron/neutron.conf devstack@neutron-api devstack@neutron-rpc-server" \
    "/etc/cinder/cinder.conf devstack@c-api devstack@c-sch devstack@c-vol" \
    "/etc/nova/nova-cpu.conf devstack@n-cpu" \
    "/etc/nova/nova_cell1.conf devstack@n-cond-cell1" \
    "/etc/nova/nova.conf devstack@n-api devstack@n-api-meta devstack@n-sch devstack@n-super-cond"; do
    conf="${line%% *}"
    units="${line#* }"
    if ! sudo test -f "$conf"; then
      continue
    fi
    log "With OSProfiler on in $conf alone"
    set_in "$conf" profiler enabled True
    answer=yes
    # shellcheck disable=SC2086
    sudo timeout 120 systemctl restart $units || answer=no
    wait_until_answers 90 || answer=no
    echo "$conf ($units): $answer" >>"$TRACES_DIR/which-services-start.txt"
    if [ "$answer" != yes ]; then
      record_where_everything_is "$(basename "$conf")"
      clear_what_is_stuck
      NOT_TRACED_CONFS[$conf]=1
      set_in "$conf" profiler enabled False
      # shellcheck disable=SC2086
      sudo timeout 120 systemctl restart $units || true
      wait_until_answers 90 || true
    fi
  done
  cat "$TRACES_DIR/which-services-start.txt"
}

# What the guide gives, with two of its settings written out so a scene can turn them on.
profiler_on() {
  set_profiler enabled True
  set_profiler hmac_keys "$HMAC_KEY"
  set_profiler connection_string otlp://127.0.0.1:4318
  # Off unless a scene below turns it on: they are the costs to state, not the default.
  set_profiler trace_sqlalchemy False
  set_profiler trace_requests False
}

# How long a cloud gets to come back. It takes about a minute when nothing is wrong. Nothing
# here waits for longer than this on one command, because on Hibiscus, with the driver's
# libraries in, a restart never came back, and that cost the whole step and said nothing.
COMES_BACK_WITHIN=240
ONE_READ_WITHIN=30
# Past this no scene starts, which leaves the end of the script the time to put the cloud back
# and write down what happened, inside the step's own limit.
SCENES_WITHIN=3600

# Every part a boot needs, because a restart brings them back one at a time.
answers_now() {
  timeout "$ONE_READ_WITHIN" openstack compute service list --service nova-compute -f value -c State 2>/dev/null | grep -q '^up$' \
    && timeout "$ONE_READ_WITHIN" openstack network list -f value -c ID >/dev/null 2>&1 \
    && timeout "$ONE_READ_WITHIN" openstack image list -f value -c ID >/dev/null 2>&1 \
    && timeout "$ONE_READ_WITHIN" openstack volume service list -f value -c State 2>/dev/null | grep -q '^up$'
}

wait_until_answers() {
  local until_then=$((SECONDS + ${1:-$COMES_BACK_WITHIN}))
  while [ "$SECONDS" -lt "$until_then" ]; do
    if answers_now; then
      return 0
    fi
    sleep 5
  done
  echo "The cloud did not answer after a restart" >&2
  return 1
}

# Where every process of every service is, so that a service that hangs says where. Once per
# name, in stuck/<name>/.
record_where_everything_is() {
  local name="$1" folder="$TRACES_DIR/stuck/$1" unit pid
  mkdir -p "$folder"
  sudo "$VENV/bin/pip" install py-spy >"$folder/py-spy-install.txt" 2>&1 || true
  systemctl list-jobs --no-pager >"$folder/jobs.txt" 2>&1 || true
  systemctl list-units --no-pager --all 'devstack@*' >"$folder/units.txt" 2>&1 || true
  for unit in $(systemctl list-units --no-legend --plain --all 'devstack@*' | awk '{ print $1 }'); do
    {
      systemctl status --no-pager --lines=0 "$unit" || true
      echo
      sudo journalctl --no-pager -n 60 -u "$unit" || true
      echo
      for pid in $(systemctl show -p MainPID --value "$unit") \
        $(sudo cat "/sys/fs/cgroup/system.slice/system-devstack.slice/$unit/cgroup.procs" 2>/dev/null); do
        if [ "$pid" != 0 ]; then
          echo "--- where $pid is"
          sudo timeout 20 "$VENV/bin/py-spy" dump --pid "$pid" || true
        fi
      done
    } >"$folder/$unit.txt" 2>&1
  done
}

clear_what_is_stuck() {
  sudo systemctl cancel || true
  sudo systemctl reset-failed 'devstack@*' || true
}

STUCK_RESTARTS=0

# Whether it came back. A caller that goes on regardless has what it needs to say why not.
restart_services() {
  local code=0
  log "Restarting the services"
  sudo timeout "$COMES_BACK_WITHIN" systemctl restart 'devstack@*' || code=$?
  if ! wait_until_answers; then
    code=1
  fi
  if [ "$code" != 0 ]; then
    STUCK_RESTARTS=$((STUCK_RESTARTS + 1))
    record_where_everything_is "restart-$STUCK_RESTARTS"
    clear_what_is_stuck
  fi
  # A service that has just come back can still be registering itself.
  sleep 20
  return "$code"
}

# Only what a patch to Placement changed, which takes seconds rather than a whole cloud.
restart_placement() {
  sudo systemctl restart devstack@placement-api || true
  sleep 15
}

signed() {
  OS_PROFILE="$HMAC_KEY" timeout 300 openstack "$@"
}

remember() {
  printf '%s=%s\n' "$1" "$2" >>"$TRACES_DIR/ids.env"
}

# With sudo, because the collector runs as root and writes its files for root alone.
spans_so_far() {
  sudo python3 -I "$READ" count "$TRACES_DIR/otlp-driver.json" 2>/dev/null || echo 0
}

# One scene, with a failure written down rather than costing the scenes after it. The
# subshell keeps set -e working inside it, which an `if` around it would turn off.
#
# EXPECT_NO_SPANS and MUST_SUCCEED say what check.txt holds it to. It waits past the
# driver's batch interval, five seconds by default, before counting what the scene made.
scene() {
  local name="$1" started ended began finished code before after traces seconds output
  shift
  if [ "$SECONDS" -gt "$SCENES_WITHIN" ]; then
    echo "Scene $name did not start: this has run for too long already." | tee -a "$TRACES_DIR/scenes-not-run.txt" >&2
    return 0
  fi
  log "Scene $name"
  output="$TRACES_DIR/scene-output/$name.txt"
  before="$(spans_so_far)"
  started="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  began="$(date +%s.%N)"
  set +e
  ( set -e; "$@" ) >"$output" 2>&1
  code=$?
  set -e
  finished="$(date +%s.%N)"
  ended="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  sleep 15
  after="$(spans_so_far)"
  seconds="$(awk -v a="$began" -v b="$finished" 'BEGIN { printf "%.3f", b - a }')"
  traces="$( (grep -oE 'Trace ID: [0-9a-f-]{36}' "$output" || true) | awk '{ printf "%s\"%s\"", (NR > 1 ? "," : ""), $3 }')"
  printf '{"scene":"%s","startedAt":"%s","endedAt":"%s","seconds":%s,"exitCode":%s,"traceIds":[%s],"spansMade":%s,"expectsNoSpans":%s,"mustSucceed":%s}\n' \
    "$name" "$started" "$ended" "$seconds" "$code" "$traces" "$((after - before))" \
    "${EXPECT_NO_SPANS:-false}" "${MUST_SUCCEED:-false}" >>"$TRACES_DIR/scenes.jsonl"
  echo "Scene $name: exit $code, ${seconds}s, $((after - before)) spans"
  if [ "$code" != 0 ]; then
    echo "Scene $name did not go as planned (exit $code):" >&2
    tail -5 "$output" >&2 || true
  fi
}

wait_for_server() {
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

# What the cloud says an instance is and what asked for it, to hold a trace's ids against:
# its id, its host, its ports, and the request ID of each of its actions.
record_instance() {
  local key="$1" name="$2" id
  id="$(openstack server show "$name" -f value -c id)"
  remember "$key" "$id"
  openstack server show "$name" -f json >"$TRACES_DIR/context/$key-server.json" || true
  openstack server event list "$id" -f json >"$TRACES_DIR/context/$key-events.json" || true
  openstack port list --server "$id" -f json >"$TRACES_DIR/context/$key-ports.json" || true
}

# ----------------------------------------------------------------------------
# The scenes
# ----------------------------------------------------------------------------
scene_signed_list() {
  signed server list --all-projects
}

scene_unsigned_list() {
  timeout 300 openstack server list --all-projects
}

scene_wrong_key_list() {
  OS_PROFILE=ou-not-the-key timeout 300 openstack server list --all-projects
}

scene_signed_boot() {
  export OS_PROJECT_NAME=ou-payments
  signed server create --wait --flavor ou.tiny --image "$IMAGE" --network ou-net "$1"
}

scene_signed_show() {
  export OS_PROJECT_NAME=ou-payments
  signed server show ou-trace-vm
}

scene_signed_boot_failed() {
  export OS_PROJECT_NAME=ou-payments
  signed server create --flavor ou.impossible --image "$IMAGE" --network ou-net ou-trace-failed
  wait_for_server ou-trace-failed ERROR
}

scene_signed_volume() {
  export OS_PROJECT_NAME=ou-payments
  signed volume create --size 1 ou-trace-vol
  wait_for_volume ou-trace-vol available
  signed server add volume ou-trace-vm ou-trace-vol
  wait_for_volume ou-trace-vol in-use
  signed server remove volume ou-trace-vm ou-trace-vol
  wait_for_volume ou-trace-vol available
  signed volume delete ou-trace-vol
}

scene_signed_network() {
  export OS_PROJECT_NAME=ou-payments
  signed network create ou-trace-net
  signed subnet create --network ou-trace-net --subnet-range 10.78.0.0/24 ou-trace-subnet
  signed port create --network ou-trace-net ou-trace-port
  signed router create ou-trace-router
  signed router delete ou-trace-router
  signed port delete ou-trace-port
  signed subnet delete ou-trace-subnet
  signed network delete ou-trace-net
}

scene_signed_image() {
  signed image show "$IMAGE"
}

# With the flag rather than the environment, to prove the two are the same. The guide
# leads with the environment, because a flag stays in a shell's history and the process
# list.
scene_signed_token() {
  timeout 300 openstack --os-profile "$HMAC_KEY" token issue -f value -c expires
}

scene_signed_delete() {
  export OS_PROJECT_NAME=ou-payments
  signed server delete --wait ou-trace-failed
  signed server delete --wait ou-trace-vm
}

scene_boot_and_delete() {
  export OS_PROJECT_NAME=ou-payments
  signed server create --wait --flavor ou.tiny --image "$IMAGE" --network ou-net "$1"
  openstack server delete --wait "$1"
}

scene_boot_failed_and_delete() {
  export OS_PROJECT_NAME=ou-payments
  signed server create --flavor ou.impossible --image "$IMAGE" --network ou-net "$1"
  wait_for_server "$1" ERROR
  openstack server delete --wait "$1"
}

# What a client without OSProfiler sends to sign a request: the two headers its WSGI middleware
# reads, as OpenStackTraceSigning.ts writes them. Prints the ID it chose as the client prints
# its own, so the scene finds its trace the same way.
scene_signed_by_header() {
  local token url trace_id info hmac
  token="$(openstack token issue -f value -c id)"
  url="$(openstack endpoint list --service compute --interface public -f value -c URL | head -1)"
  trace_id="$(python3 -I -c 'import uuid; print(uuid.uuid4())')"
  read -r info hmac < <(OU_TRACES_KEY="$HMAC_KEY" python3 -I "$READ" sign "$trace_id")
  curl -sS --fail -o /dev/null -w '%{http_code}\n' \
    -H "X-Auth-Token: $token" -H "X-Trace-Info: $info" -H "X-Trace-HMAC: $hmac" "$url/servers"
  echo "Trace ID: $trace_id"
}

# Signed by nobody: what native tracing makes of an ordinary boot. Remembered, because what
# Nova says asked for it is what a span's request ID is held to.
scene_unsigned_boot_and_delete() {
  export OS_PROJECT_NAME=ou-payments
  timeout 300 openstack server create --wait --flavor ou.tiny --image "$IMAGE" --network ou-net "$1"
  record_instance "${1//-/_}" "$1"
  openstack server delete --wait "$1"
}

# A minute of nothing, which is what an always-on feed costs a cloud nobody is using.
scene_idle() {
  sleep 60
}

# ----------------------------------------------------------------------------
# The agent's traces profile, recording instead of sending
# ----------------------------------------------------------------------------
start_collector() {
  local image
  image="$(grep -E '^[[:space:]]*image:[[:space:]]*otel/opentelemetry-collector-contrib' "$AGENT_DIR/docker-compose.traces.yml" | head -1 | awk '{print $2}')"
  docker run -d --name "$COLLECTOR_NAME" --network host --user 0:0 \
    -v "$AGENT_DIR/otel-collector-traces.yaml:/etc/otelcol-contrib/config.yaml:ro" \
    -v "$HERE/collector-traces-recording.yaml:/etc/otelcol-contrib/recording.yaml:ro" \
    -v "$TRACES_DIR:/recording" \
    -e ONEUPTIME_URL=http://127.0.0.1:9 \
    -e ONEUPTIME_TELEMETRY_INGESTION_KEY=recording \
    -e OPENSTACK_CLOUD_NAME=devstack \
    -e OPENSTACK_REGION_NAME="${OPENSTACK_REGION:-RegionOne}" \
    -e OPENSTACK_NODE_NAME="$HOST" \
    -e OPENSTACK_TRACES_LISTEN_ADDRESS=127.0.0.1:4318 \
    -e OPENSTACK_TRACES_RECORDING_DIR=/recording \
    "$image" --config=/etc/otelcol-contrib/config.yaml --config=/etc/otelcol-contrib/recording.yaml \
    "--set=service::telemetry::metrics::readers=[{pull: {exporter: {prometheus: {host: 127.0.0.1, port: 8893}}}}]"
  wait_for_collector
}

# It answers an empty POST with an error of its own once it is listening.
wait_for_collector() {
  local attempt
  for attempt in $(seq 1 30); do
    if [ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -X POST http://127.0.0.1:4318/v1/traces 2>/dev/null || true)" != "000" ]; then
      return 0
    fi
    sleep 2
    : "$attempt"
  done
  echo "The collector is not listening on 4318" >&2
  docker logs "$COLLECTOR_NAME" >&2 || true
  return 1
}

# ----------------------------------------------------------------------------
# What it takes to fill the holes in a stock trace
# ----------------------------------------------------------------------------
# The line the guide gives an operator, exactly: Placement keeps a config of its own, and
# OSProfiler registers [profiler_otlp] on the global one only, so the driver's first read of
# it ends the driver. OpenStackTracesGuide.test.ts holds the guide to this line.
apply_placement_patch() {
  if [ -z "$PLACEMENT_WSGI" ]; then
    echo "Placement's WSGI module was not found." >&2
    return 1
  fi
  sudo sed -i '/profiler\.set_defaults(config)/a\        config.register_opts(profiler._OTLP_OPTS, group="profiler_otlp")' "$PLACEMENT_WSGI"
  sudo grep -c '_OTLP_OPTS' "$PLACEMENT_WSGI"
}

# The change that would make that line needless, for every project with a config of its own.
# Not something the guide gives: it is what would be proposed to OSProfiler, tried here.
apply_osprofiler_fix() {
  if [ -z "$OSPROFILER_OPTS" ]; then
    echo "OSProfiler's opts module was not found." >&2
    return 1
  fi
  sudo python3 -I "$CONFIGURE" insert-after "$OSPROFILER_OPTS" \
    "conf.register_opts(_PROFILER_OPTS, group=_profiler_opt_group)" \
    "    conf.register_opts(_JAEGER_OPTS, group=_jaegerprofiler_opt_group)" \
    "    conf.register_opts(_OTLP_OPTS, group=_otlp_profiler_opt_group)"
}

# One worker runs in the process that made the driver, so nothing has to survive a fork.
one_worker_each() {
  set_in /etc/nova/nova.conf conductor workers 1
  set_in /etc/nova/nova_cell1.conf conductor workers 1
  set_in /etc/nova/nova.conf scheduler workers 1
}

# ----------------------------------------------------------------------------
# OpenStack's own OpenTelemetry tracing, where a release ships it
# ----------------------------------------------------------------------------
has_native_tracing() {
  "$VENV/bin/python" -I -c 'import oslo_messaging._tracing.client, oslo_middleware.tracing' 2>/dev/null
}

native_messaging_on() {
  local conf
  for conf in "${SERVICE_CONFS[@]}"; do
    set_in "$conf" oslo_messaging_tracing tracing_enabled True
    set_in "$conf" oslo_messaging_tracing otel_exporter_otlp_endpoint http://127.0.0.1:4318
  done
  # It takes one name per config file, so that is as fine as this can tell services apart.
  set_in /etc/nova/nova.conf oslo_messaging_tracing tracing_service_name nova
  set_in /etc/nova/nova_cell1.conf oslo_messaging_tracing tracing_service_name nova-conductor
  set_in /etc/nova/nova-cpu.conf oslo_messaging_tracing tracing_service_name nova-compute
  set_in /etc/neutron/neutron.conf oslo_messaging_tracing tracing_service_name neutron
  set_in /etc/cinder/cinder.conf oslo_messaging_tracing tracing_service_name cinder
}

native_middleware_on() {
  local file
  for file in "${PASTE_FILES[@]}"; do
    if sudo test -f "$file"; then
      echo "$file: $(sudo python3 -I "$CONFIGURE" paste-otel "$file") pipelines"
    fi
  done
  for pair in /etc/nova/nova.conf:nova-api /etc/neutron/neutron.conf:neutron-server \
    /etc/cinder/cinder.conf:cinder-api /etc/glance/glance-api.conf:glance-api; do
    set_in "${pair%%:*}" oslo_middleware_tracing enabled True
    set_in "${pair%%:*}" oslo_middleware_tracing otlp_endpoint http://127.0.0.1:4318
    set_in "${pair%%:*}" oslo_middleware_tracing service_name "${pair##*:}"
  done
}

# What each service says about all of it, and what it wrote into its pipelines, as a person
# would look: where this works or fails is in these lines, not in the spans.
record_native_settings() {
  {
    for file in "${PASTE_FILES[@]}"; do
      if sudo test -f "$file"; then
        echo "--- $file"
        sudo grep -nE 'otel_tracing|TracingMiddleware' "$file" || true
      fi
    done
  } >"$TRACES_DIR/native-settings.txt" 2>&1
}

# ----------------------------------------------------------------------------
# Whichever way this ends
# ----------------------------------------------------------------------------
HOLDS=1

finish() {
  local code=$?
  trap - EXIT INT TERM
  set +e
  log "Putting the cloud back"
  restore_files "${SERVICE_CONFS[@]}" "${PASTE_FILES[@]}" "$PLACEMENT_WSGI" "$OSPROFILER_OPTS"
  sudo rm -rf "$SAVED_DIR"
  clear_what_is_stuck
  (
    export OS_PROJECT_NAME=ou-payments
    for name in ou-trace-vm ou-trace-failed ou-trace-collector-down ou-trace-sql ou-trace-requests \
      ou-trace-placement ou-trace-whole ou-trace-whole-failed ou-trace-fix ou-trace-native-messaging \
      ou-trace-native-both ou-trace-native-osprofiler ou-trace-off; do
      timeout "$ONE_READ_WITHIN" openstack server delete "$name" >/dev/null 2>&1
    done
    timeout "$ONE_READ_WITHIN" openstack volume delete ou-trace-vol >/dev/null 2>&1
  )
  restart_services

  log "What was recorded"
  # Its last batch has a few seconds to reach the file.
  sleep 15
  docker logs "$COLLECTOR_NAME" >"$TRACES_DIR/collector.log" 2>&1
  docker rm -f "$COLLECTOR_NAME" >/dev/null 2>&1
  sudo chown -R "$(id -u)" "$TRACES_DIR"
  sudo journalctl --no-pager -o json --since "$STARTED UTC" -u 'devstack@*' \
    | python3 -I "$CONFIGURE" journal-lines \
    | gzip -9 >"$TRACES_DIR/journal.jsonl.gz"
  python3 -I "$READ" summary "$TRACES_DIR"
  python3 -I "$READ" native "$TRACES_DIR"
  python3 -I "$READ" check "$TRACES_DIR" && HOLDS=0
  gzip -9f "$TRACES_DIR/otlp-driver.json" "$TRACES_DIR/otlp-agent.json"
  # Last, so it reads everything that will be uploaded.
  OU_TRACES_KEY="$HMAC_KEY" python3 -I "$READ" remove-key "$TRACES_DIR"
  find "$TRACES_DIR" -maxdepth 1 -type f -exec ls -l {} +

  if [ "$code" != 0 ]; then
    exit "$code"
  fi
  exit "$HOLDS"
}
trap finish EXIT INT TERM

# ----------------------------------------------------------------------------
# The phases
# ----------------------------------------------------------------------------
{
  echo "What this release installs, in the services' virtual environment:"
  "$VENV/bin/pip" list 2>/dev/null \
    | grep -iE '^(osprofiler|opentelemetry-[a-z-]+|oslo\.(middleware|messaging)|keystoneauth1|python-openstackclient|osc-lib) ' || true
  echo
  echo "What its pins say:"
  grep -iE '^(osprofiler|opentelemetry-(sdk|exporter-otlp))===' "$CONSTRAINTS" || true
  echo
  echo "Whether the client offers --os-profile, which it only does with osprofiler installed:"
  openstack --help 2>/dev/null | grep -A1 -- '--os-profile' || echo "No --os-profile here."
} >"$TRACES_DIR/versions.txt"
cat "$TRACES_DIR/versions.txt"

openstack hypervisor list -f json >"$TRACES_DIR/context/hypervisors.json" || true
# ou.impossible asks for more memory than the estate's quota holds, and the point of that
# scene is that the scheduler refuses it: a quota refusal never gets past nova-api.
openstack quota set --instances 20 --cores 40 --ram -1 ou-payments

start_collector

log "OSProfiler off, as a cloud is by default"
EXPECT_NO_SPANS=true MUST_SUCCEED=true scene off-signed-list scene_signed_list

log "OSProfiler on, without the OpenTelemetry libraries"
profiler_on
sudo sed -n '/^\[profiler\]/,/^\[/p' /etc/nova/nova.conf | sed -E 's/^(hmac_keys[[:space:]]*=[[:space:]]*).*/\1<hmac-key>/' >"$TRACES_DIR/profiler-conf.txt"

if "$VENV/bin/python" -I -c 'import opentelemetry.sdk' 2>/dev/null; then
  echo "This release's services already hold the OpenTelemetry SDK." | tee -a "$TRACES_DIR/versions.txt"
else
  restart_services || true
  EXPECT_NO_SPANS=true MUST_SUCCEED=true scene no-libraries-signed-list scene_signed_list
fi

log "OSProfiler on, with the libraries each service needs"
if ! sudo "$VENV/bin/pip" install -c "$CONSTRAINTS" opentelemetry-sdk opentelemetry-exporter-otlp >"$TRACES_DIR/pip-install.txt" 2>&1; then
  echo "The libraries did not install with this release's pins:" >&2
  tail -20 "$TRACES_DIR/pip-install.txt" >&2
  exit 1
fi
{
  echo
  echo "What was installed for the driver:"
  "$VENV/bin/pip" list 2>/dev/null | grep -iE '^(opentelemetry-|protobuf|grpcio)' || true
} >>"$TRACES_DIR/versions.txt"
if ! restart_services; then
  log "The cloud did not come back with the driver on"
  find_what_starts_with_the_driver
fi

EXPECT_NO_SPANS=true MUST_SUCCEED=true scene unsigned-list scene_unsigned_list
EXPECT_NO_SPANS=true MUST_SUCCEED=true scene wrong-key-list scene_wrong_key_list
MUST_SUCCEED=true scene signed-list scene_signed_list
MUST_SUCCEED=true scene signed-boot scene_signed_boot ou-trace-vm
( export OS_PROJECT_NAME=ou-payments; record_instance instance_booted ou-trace-vm ) || true
scene signed-show scene_signed_show
scene signed-boot-failed scene_signed_boot_failed
( export OS_PROJECT_NAME=ou-payments; record_instance instance_failed ou-trace-failed ) || true
scene signed-volume scene_signed_volume
scene signed-network scene_signed_network
scene signed-image scene_signed_image
scene signed-token scene_signed_token
scene signed-delete scene_signed_delete
scene signed-by-header scene_signed_by_header

log "With the local collector stopped: does anything notice?"
docker stop "$COLLECTOR_NAME" >/dev/null
MUST_SUCCEED=true scene collector-down-signed-list scene_signed_list
MUST_SUCCEED=true scene collector-down-signed-boot scene_boot_and_delete ou-trace-collector-down
docker start "$COLLECTOR_NAME" >/dev/null
wait_for_collector

log "trace_sqlalchemy on: what it costs, and what it holds"
set_profiler trace_sqlalchemy True
restart_services || true
scene signed-boot-sql scene_boot_and_delete ou-trace-sql
set_profiler trace_sqlalchemy False

log "trace_requests on: the client spans it adds between services"
set_profiler trace_requests True
restart_services || true
scene signed-boot-requests scene_boot_and_delete ou-trace-requests
set_profiler trace_requests False

log "Placement, with the one line a local patch adds"
apply_placement_patch || echo "The patch did not apply: check.txt will say what is missing." >&2
restart_placement
scene signed-boot-placement scene_boot_and_delete ou-trace-placement

log "That, with Nova's conductor and scheduler on one worker each"
one_worker_each
restart_services || true
scene signed-boot-whole scene_boot_and_delete ou-trace-whole
scene signed-boot-failed-whole scene_boot_failed_and_delete ou-trace-whole-failed

log "Stock Placement over the fix OSProfiler could take"
restore_files "${SERVICE_CONFS[@]}" "$PLACEMENT_WSGI"
profiler_on
apply_osprofiler_fix || echo "The fix did not apply: check.txt will say what is missing." >&2
restart_services || true
scene signed-boot-osprofiler-fix scene_boot_and_delete ou-trace-fix
restore_files "$OSPROFILER_OPTS"

if has_native_tracing; then
  log "oslo.messaging's own tracing, with OSProfiler off"
  restore_files "${SERVICE_CONFS[@]}"
  native_messaging_on
  restart_services || true
  scene native-messaging-boot scene_unsigned_boot_and_delete ou-trace-native-messaging
  scene native-messaging-idle scene_idle

  log "oslo.middleware's as well"
  native_middleware_on
  record_native_settings
  restart_services || true
  scene native-both-boot scene_unsigned_boot_and_delete ou-trace-native-both
  scene native-both-idle scene_idle

  log "Both of those and OSProfiler at once"
  profiler_on
  restart_services || true
  scene native-with-osprofiler-boot scene_boot_and_delete ou-trace-native-osprofiler

  restore_files "${SERVICE_CONFS[@]}" "${PASTE_FILES[@]}"
  profiler_on
else
  echo "This release has no oslo.messaging or oslo.middleware tracing to try." | tee -a "$TRACES_DIR/versions.txt"
  restore_files "${SERVICE_CONFS[@]}"
  profiler_on
fi

log "Off again"
set_profiler enabled False
restart_services || true
EXPECT_NO_SPANS=true MUST_SUCCEED=true scene off-again-signed-boot scene_boot_and_delete ou-trace-off
