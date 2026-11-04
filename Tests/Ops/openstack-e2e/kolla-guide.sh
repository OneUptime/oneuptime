#!/usr/bin/env bash
#
# Follow the Kolla-Ansible guide on the deployment kolla-aio.sh left, with the guide's exact
# commands, and record what comes out. OneUptime itself is fake-oneuptime.py, which keeps what
# it is sent: replaying that through the real scan and evaluator is what the tests in
# packages/Common/Tests do.
#
# Every block after `follow` is the guide's text, placeholders and all, and
# OpenStackDeploymentGuides.test.ts fails when a block here and the guide differ. So this is
# the guide being followed, not a copy of it that can drift. `follow` fills the placeholders
# in, and each answer a person would type is given on its standard input.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/kolla-guide.sh <phase>, in this order:
#
#   prepare               starts the fake OneUptime and what keeps its OTLP
#   record                what the cloud and each exporter answer, before anything changes
#   alerts                the guide's first step: a receiver and rules, for Kolla's Alertmanager
#   kolla-exporter        the agent on Kolla's own exporter, and what the cloud stands on
#   full-view             the agent's own exporter, on the guide's first credential
#   own-exporter          the agent on an exporter you already run, at the agent's version
#   own-exporter-170      the same, at Kolla's version
#   without-docker        the agent as systemd services, which is what a Kolla node can run
#   logs                  the logs profile, on Kolla's own files
#   infrastructure-only   the guide's second credential, with its policy overrides
#   drill                 breaks two things and records what Alertmanager posts

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$HERE/../../../agents/OpenStackAgent" && pwd)"
# shellcheck source=Tests/Ops/openstack-e2e/kolla-env.sh
source "$HERE/kolla-env.sh"

GUIDE_RECORDING="$OUTPUT_DIR/guide"
GUIDE_DIR="$KOLLA_HOME/guide"
COMMANDS="$GUIDE_RECORDING/commands.log"
PROBLEMS="$GUIDE_RECORDING/problems.txt"
AGENT_FOLDER="/opt/oneuptime-openstack-agent"
LOGS_FOLDER="/opt/oneuptime-openstack-logs"

mkdir -p "$GUIDE_RECORDING"
sudo mkdir -p "$GUIDE_DIR"
sudo chown "$(id -u):$(id -g)" "$GUIDE_DIR"

ONEUPTIME_PORT=8099
ONEUPTIME_URL="http://$KOLLA_API_ADDRESS:$ONEUPTIME_PORT"
INGESTION_KEY="rig-ingestion-key"
HEARTBEAT_KEY="rig-heartbeat-key"
CLOUD_NAME="kolla-aio"
KEYSTONE_URL="http://$KOLLA_VIP:5000/v3"
MONITORING_PASSWORD="ou-rig-monitoring-password"
OWN_EXPORTER_PORT=9180
OWN_EXPORTER_170_PORT=9181

# The expiry the guide prints, when it is read on the date OpenStackDeploymentGuides.test.ts
# reads it, and one a year from now to use instead.
GUIDE_EXPIRATION="2027-11-04T00:00:00"
EXPIRATION="$(date -u -d '+1 year' +%Y-%m-%dT%H:%M:%S)"

# Read from what ships, so this can never test another version.
COLLECTOR_IMAGE="$(grep -E '^[[:space:]]*image:[[:space:]]*otel/opentelemetry-collector-contrib' "$AGENT_DIR/docker-compose.yml" | head -1 | awk '{print $2}')"
EXPORTER_IMAGE="$(grep -E '^[[:space:]]*image:[[:space:]]*ghcr.io/openstack-exporter/' "$AGENT_DIR/docker-compose.yml" | head -1 | awk '{print $2}')"
EXPORTER_170_IMAGE="ghcr.io/openstack-exporter/openstack-exporter:1.7.0"
EXPORTER_FLAGS="$(awk '/^  [a-z]/ { in_exporter = ($0 == "  openstack-exporter:") } in_exporter && /^[[:space:]]*- --disable-metric=/ { print $2 }' "$AGENT_DIR/docker-compose.yml" | tr '\n' ' ')"
CURL_IMAGE="$(grep -E '^CURL_IMAGE=' "$AGENT_DIR/troubleshoot.sh" | head -1 | cut -d '"' -f 2)"

log() {
  printf '\n=== %s\n' "$*"
}

problem() {
  printf '%s\n' "$*" | tee -a "$PROBLEMS" >&2
}

# ----------------------------------------------------------------------------
# Following the guide
# ----------------------------------------------------------------------------
# Runs the text on its standard input as the guide says it. Its settings, given in front:
#   FOLLOW_AS       who runs it. Root by default, as install.sh writes to /opt
#   FOLLOW_ANSWERS  what a person would type at its questions
#   FOLLOW_LOGIN    what a person would have done first, in the same shell
#   FOLLOW_OUTPUT   a file to keep its output in, for what comes next to read
#   FOLLOW_LIMIT    seconds, for what the guide leaves running until someone stops it
follow() {
  local text status=0 output
  text="$(cat)"
  text="${text//https:\/\/oneuptime.example/$ONEUPTIME_URL}"
  text="${text//<inventory>/$KOLLA_INVENTORY}"
  text="${text//<kolla_internal_vip_address>/$KOLLA_VIP}"
  text="${text//<secret key>/$HEARTBEAT_KEY}"
  # It asks a terminal, and there is none: the one word changed from what the guide says.
  text="${text//--password-prompt/--password $MONITORING_PASSWORD}"
  text="${text//$GUIDE_EXPIRATION/$EXPIRATION}"
  output="${FOLLOW_OUTPUT:-$(mktemp)}"
  printf '\n$ %s\n' "${text//$MONITORING_PASSWORD/<password>}" | tee -a "$COMMANDS"
  (
    cd "$GUIDE_DIR" || exit 1
    # shellcheck disable=SC2086 # Who runs it is one or two words.
    ${FOLLOW_LIMIT:+timeout "$FOLLOW_LIMIT"} ${FOLLOW_AS:-sudo -E env "PATH=$PATH"} \
      bash -uo pipefail -c "set -e; ${FOLLOW_LOGIN:-}
$text" <<<"${FOLLOW_ANSWERS:-}"
  ) >"$output" 2>&1 || status=$?
  sed -e "s/$MONITORING_PASSWORD/<password>/g" "$output" | tee -a "$COMMANDS"
  printf '[exit %s]\n' "$status" | tee -a "$COMMANDS"
  if [ -z "${FOLLOW_OUTPUT:-}" ]; then
    rm -f "$output"
  fi
  return "$status"
}

AS_PERSON="env"
LOGGED_IN_AS_ADMIN="source /etc/kolla/admin-openrc.sh"
LOGGED_IN_AS_ACCOUNT="source /etc/kolla/admin-openrc.sh
export OS_USERNAME=oneuptime-monitoring OS_PASSWORD='$MONITORING_PASSWORD'
export OS_PROJECT_NAME=oneuptime-monitoring OS_TENANT_NAME=oneuptime-monitoring"

# ----------------------------------------------------------------------------
# What stands in for OneUptime
# ----------------------------------------------------------------------------
keep_otlp_in() {
  local folder="$GUIDE_RECORDING/$1/otlp"
  docker rm -f ou-sink >/dev/null 2>&1 || true
  mkdir -p "$folder"
  chmod 0777 "$folder"
  docker run -d --name ou-sink --network host --user "$(id -u):$(id -g)" \
    -v "$HERE/collector-sink.yaml:/etc/otelcol-contrib/config.yaml:ro" \
    -v "$folder:/recording" \
    "$COLLECTOR_IMAGE" --config=/etc/otelcol-contrib/config.yaml >/dev/null
}

stop_keeping_otlp() {
  docker logs ou-sink >"$GUIDE_RECORDING/${1}/sink.log" 2>&1 || true
  docker rm -f ou-sink >/dev/null 2>&1 || true
}

prepare() {
  log "A OneUptime for the guide to name"
  nohup python3 -I "$HERE/fake-oneuptime.py" "$ONEUPTIME_PORT" "$AGENT_DIR" "$OUTPUT_DIR" \
    http://127.0.0.1:14318 >"$GUIDE_RECORDING/fake-oneuptime.log" 2>&1 &
  disown
  for attempt in $(seq 1 20); do
    if curl -fsS --max-time 3 "$ONEUPTIME_URL/otlp/v1/validate" >/dev/null; then
      echo "It answers at $ONEUPTIME_URL"
      break
    fi
    sleep 1
    : "$attempt"
  done
  docker pull -q "$COLLECTOR_IMAGE"
}

# ----------------------------------------------------------------------------
# What the cloud and each exporter answer, before the guide changes anything
# ----------------------------------------------------------------------------
# A person's exporter, as the guide's "Use an exporter you already run" asks for: with
# --multi-cloud, an entry named for the region, and what the bundled one turns off, off.
start_own_exporter() {
  local name="$1" image="$2" port="$3" file="$KOLLA_HOME/$1-clouds.yaml"
  sudo cat /etc/kolla/clouds.yaml | sed 's/^\( *\)kolla-admin:/\1RegionOne:/' >"$file"
  chmod a+r "$file"
  docker rm -f "$name" >/dev/null 2>&1 || true
  # shellcheck disable=SC2086 # One flag per word.
  docker run -d --name "$name" --network host -v "$file:/etc/openstack/clouds.yaml:ro" \
    "$image" --multi-cloud --web.listen-address="$KOLLA_API_ADDRESS:$port" \
    --os-client-config=/etc/openstack/clouds.yaml $EXPORTER_FLAGS >/dev/null
}

# Each target Kolla's own Prometheus names, as it answers them.
scrape_control_plane() {
  local folder="$OUTPUT_DIR/control-plane" job target code
  mkdir -p "$folder"
  : >"$folder/status.txt"
  while read -r job target; do
    code="$(curl -sS --max-time 30 -o "$folder/$job.prom" -w '%{http_code}' "http://$target/metrics" 2>/dev/null || echo 000)"
    printf '%s %s %s %s series\n' "$code" "$job" "$target" "$(grep -vc '^#' "$folder/$job.prom" 2>/dev/null || echo 0)" |
      tee -a "$folder/status.txt"
  done < <(sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 -I "$HERE/kolla-prometheus-targets.py")
}

record_cloud() {
  log "Kolla's own files"
  sudo cat /etc/kolla/prometheus-server/prometheus.yml | sed -E 's/(password:).*/\1 REDACTED/' \
    >"$KOLLA_RECORDING/prometheus.yml"
  # shellcheck disable=SC2024 # Written as this user, read as root.
  sudo docker inspect prometheus_openstack_exporter --format '{{json .Config.Env}}' \
    | tr ',' '\n' | grep -E 'OS_|KOLLA_' | grep -viE 'password' >"$KOLLA_RECORDING/exporter-env.txt" || true
  sudo cat /etc/kolla/prometheus-openstack-exporter/config.json >"$KOLLA_RECORDING/exporter-config.json" || true
  for service in nova-api neutron-server cinder-api glance-api placement-api; do
    sudo grep -A40 '^\[keystone_authtoken\]' "/etc/kolla/$service/${service%%-*}.conf" 2>/dev/null \
      | grep -E '^service_type' | sed "s/^/$service: /"
  done >"$KOLLA_RECORDING/service-types.txt" || true
  sudo grep -h -A40 '^\[keystone_authtoken\]' /etc/kolla/glance-api/glance-api.conf 2>/dev/null \
    | grep -E '^service_type' | sed 's/^/glance-api: /' >>"$KOLLA_RECORDING/service-types.txt" || true

  log "What each exporter says about this cloud, and what its APIs answer"
  start_own_exporter ou-own-exporter "$EXPORTER_IMAGE" "$OWN_EXPORTER_PORT"
  start_own_exporter ou-own-exporter-170 "$EXPORTER_170_IMAGE" "$OWN_EXPORTER_170_PORT"
  sleep 5
  OUTPUT_DIR="$OUTPUT_DIR" EXPORTER_URL="http://$KOLLA_API_ADDRESS:$OWN_EXPORTER_PORT" \
    EXPORTER_STABLE_URL="http://$KOLLA_API_ADDRESS:$OWN_EXPORTER_170_PORT" \
    bash "$HERE/record.sh" healthy

  log "What Kolla's own exporter says on /metrics, through its VIP"
  local folder="$OUTPUT_DIR/healthy/exporter-kolla" code seconds
  mkdir -p "$folder"
  read -r code seconds < <(curl -sS --max-time 120 -o "$folder/all.prom" -w '%{http_code} %{time_total}\n' \
    "http://$KOLLA_VIP:9198/metrics" || echo "000 0")
  printf 'all %s %ss\n' "$code" "$seconds" | tee "$folder/status.txt"
  curl -sS --max-time 120 -o /dev/null -w 'probe %{http_code}\n' \
    "http://$KOLLA_VIP:9198/probe?cloud=default&include_services=identity" | tee -a "$folder/status.txt"

  log "What the cloud stands on says"
  scrape_control_plane
}

# ----------------------------------------------------------------------------
# The guide's first step: what is already firing
# ----------------------------------------------------------------------------
alerts() {
  log "Forward what is already firing"
  sudo mkdir -p /etc/kolla/config/prometheus
  sudo chown -R "$(id -u):$(id -g)" /etc/kolla/config
  sed -e "s#https://oneuptime.example#$ONEUPTIME_URL#" -e "s#<secret key>#$HEARTBEAT_KEY#" \
    >/etc/kolla/config/prometheus/prometheus-alertmanager.yml <<'GUIDE'
global:
  resolve_timeout: 5m
route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 10s
  group_interval: 5m
  repeat_interval: 3h
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.example/heartbeat/<secret key>"
        send_resolved: true
templates:
  - '/etc/prometheus/*.tmpl'
GUIDE

  # Kolla-Ansible ships no rules, so nothing fires until there are some, which the guide says.
  cat >/etc/kolla/config/prometheus/oneuptime-rig.rules <<'RULES'
groups:
  - name: oneuptime-rig
    rules:
      - alert: MemcachedDown
        expr: memcached_up == 0
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: Memcached is down
          description: 'Memcached behind {{ $labels.instance }} answers nothing'
      - alert: NovaComputeDown
        expr: openstack_nova_agent_state{service="nova-compute",adminState="enabled"} == 0
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: nova-compute is down
          description: 'nova-compute on {{ $labels.hostname }} has stopped reporting'
RULES

  FOLLOW_AS="$AS_PERSON" follow <<'GUIDE'
kolla-ansible reconfigure -i <inventory> --tags prometheus
GUIDE
  local status=$?
  sudo cat /etc/kolla/prometheus-alertmanager/prometheus-alertmanager.yml \
    >"$KOLLA_RECORDING/prometheus-alertmanager.yml" 2>/dev/null || true
  sudo cat /etc/kolla/prometheus-server/prometheus.yml | sed -E 's/(password:).*/\1 REDACTED/' \
    >"$KOLLA_RECORDING/prometheus-after-rules.yml"
  return "$status"
}

# ----------------------------------------------------------------------------
# The agent, four ways
# ----------------------------------------------------------------------------
remove_agent() {
  if [ -f "$AGENT_FOLDER/docker-compose.yml" ]; then
    (cd "$AGENT_FOLDER" && sudo docker compose down --remove-orphans) >/dev/null 2>&1 || true
  fi
  sudo systemctl disable --now oneuptime-openstack-agent oneuptime-openstack-exporter >/dev/null 2>&1 || true
  sudo rm -f /etc/systemd/system/oneuptime-openstack-agent.service /etc/systemd/system/oneuptime-openstack-exporter.service
  sudo systemctl daemon-reload || true
  sudo rm -rf "$AGENT_FOLDER"
}

keep_what_the_agent_was() {
  local phase="$1" folder="$GUIDE_RECORDING/$1"
  mkdir -p "$folder"
  sudo cat "$AGENT_FOLDER/.env" >"$folder/env.txt" 2>/dev/null || true
  (
    cd "$AGENT_FOLDER" || exit 0
    sudo docker compose ps -a >"$folder/compose-ps.txt" 2>&1
    sudo docker compose logs --no-color >"$folder/compose-logs.txt" 2>&1
  ) || true
  sudo journalctl -u oneuptime-openstack-agent -u oneuptime-openstack-exporter --no-pager \
    >"$folder/journal.txt" 2>&1 || true
  [ -s "$folder/journal.txt" ] || rm -f "$folder/journal.txt"
  : "$phase"
}

# Until the collector has sent every service's series, which the slowest two read every 5
# minutes, and a second scrape of everything after that, for what takes two to work out.
wait_for_what_it_sends() {
  local phase="$1" file="$GUIDE_RECORDING/$1/otlp/metrics.json" waited=0
  while [ "$waited" -lt 480 ]; do
    if [ -s "$file" ] && grep -q 'openstack_nova_' "$file" && grep -q 'openstack_neutron_' "$file" \
      && grep -q 'openstack_identity_' "$file" && grep -q 'openstack_glance_' "$file"; then
      echo "$phase: every service's series arrived after $waited seconds"
      sleep 130
      return 0
    fi
    sleep 15
    waited=$((waited + 15))
  done
  problem "$phase: not every service's series arrived in $waited seconds"
  return 1
}

troubleshoot() {
  local phase="$1"
  curl -fsSL "$ONEUPTIME_URL/install/openstack-agent/troubleshoot.sh" -o "$GUIDE_DIR/troubleshoot.sh"
  (cd "$GUIDE_DIR" && sudo bash troubleshoot.sh --no-color) >"$GUIDE_RECORDING/$phase/troubleshoot.txt" 2>&1 || true
  tail -n 15 "$GUIDE_RECORDING/$phase/troubleshoot.txt"
}

# The guide's check, once the agent is up.
verify_agent() {
  FOLLOW_LIMIT=30 follow <<'GUIDE' || true
cd /opt/oneuptime-openstack-agent
docker compose ps
docker compose logs -f oneuptime-openstack-agent
GUIDE
}

kolla_exporter() {
  local phase="kolla-exporter" targets="$GUIDE_DIR/targets.env" status=0
  log "The agent, on Kolla's own exporter"
  remove_agent
  keep_otlp_in "$phase"
  curl -fsSL "$ONEUPTIME_URL/install/openstack-agent" -o "$GUIDE_DIR/install.sh"
  FOLLOW_ANSWERS="$(printf '%s\n%s\n%s\n' "$ONEUPTIME_URL" "$INGESTION_KEY" "$CLOUD_NAME")" follow <<'GUIDE' || status=$?
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
GUIDE
  verify_agent

  log "What the cloud stands on, from what Kolla's Prometheus already knows"
  FOLLOW_OUTPUT="$targets" follow <<'GUIDE' || status=$?
curl -fsSLO https://oneuptime.example/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
GUIDE
  cp "$targets" "$KOLLA_RECORDING/control-plane-targets.txt"
  sudo tee -a "$AGENT_FOLDER/.env" <"$targets" >/dev/null
  (cd "$AGENT_FOLDER" && sudo docker compose up -d) 2>&1 | tee -a "$COMMANDS" || status=$?

  wait_for_what_it_sends "$phase" || status=$?
  troubleshoot "$phase"
  keep_what_the_agent_was "$phase"
  stop_keeping_otlp "$phase"
  return "$status"
}

full_view() {
  local phase="full-view" output="$GUIDE_DIR/credential.txt" id secret status=0
  log "The guide's first credential, and the agent's own exporter"
  remove_agent

  FOLLOW_AS="$AS_PERSON" FOLLOW_LOGIN="$LOGGED_IN_AS_ADMIN" follow <<'GUIDE' || status=$?
openstack project create --domain default oneuptime-monitoring
openstack user create --domain default --password-prompt oneuptime-monitoring
openstack role add --project oneuptime-monitoring --user oneuptime-monitoring admin
GUIDE
  FOLLOW_AS="$AS_PERSON" FOLLOW_LOGIN="$LOGGED_IN_AS_ACCOUNT" FOLLOW_OUTPUT="$output" follow <<'GUIDE' || status=$?
curl -fsSLO https://oneuptime.example/install/openstack-agent/access/application-credential-access-rules.json
curl -fsSLO https://oneuptime.example/install/openstack-agent/access/access-rules-for-cloud.py
openstack catalog list -f json | python3 access-rules-for-cloud.py \
  application-credential-access-rules.json > access-rules-for-this-cloud.json
openstack application credential create oneuptime-agent \
  --role admin \
  --access-rules "$(cat access-rules-for-this-cloud.json)" \
  --expiration 2027-11-04T00:00:00
GUIDE
  mkdir -p "$GUIDE_RECORDING/$phase"
  cp "$GUIDE_DIR/access-rules-for-this-cloud.json" "$GUIDE_RECORDING/$phase/" 2>/dev/null || true
  id="$(awk -F'|' '$2 ~ /^ *[Ii][Dd] *$/ { gsub(/ /, "", $3); print $3 }' "$output" | head -1)"
  secret="$(awk -F'|' '$2 ~ /^ *[Ss]ecret *$/ { gsub(/ /, "", $3); print $3 }' "$output" | head -1)"
  if [ -n "$secret" ]; then
    sed -i "s/$secret/<secret>/g" "$COMMANDS"
  fi
  if [ -z "$id" ] || [ -z "$secret" ]; then
    problem "$phase: the credential's id and secret are not in what it printed"
    return 1
  fi

  keep_otlp_in "$phase"
  FOLLOW_ANSWERS="$(printf '%s\n' "$ONEUPTIME_URL" "$INGESTION_KEY" "$CLOUD_NAME" "$KEYSTONE_URL" RegionOne Y "$id" "$secret")" \
    follow <<'GUIDE' || status=$?
curl -fsSL https://oneuptime.example/install/openstack-agent -o install.sh && bash install.sh
GUIDE
  verify_agent
  wait_for_what_it_sends "$phase" || status=$?
  troubleshoot "$phase"
  keep_what_the_agent_was "$phase"
  stop_keeping_otlp "$phase"

  remove_agent
  FOLLOW_AS="$AS_PERSON" FOLLOW_LOGIN="$LOGGED_IN_AS_ACCOUNT" follow <<'GUIDE' || true
openstack application credential delete oneuptime-agent
GUIDE
  (
    # shellcheck disable=SC1091 # Written by kolla-ansible post-deploy.
    source /etc/kolla/admin-openrc.sh
    openstack user delete oneuptime-monitoring
    openstack project delete oneuptime-monitoring
  ) || true
  return "$status"
}

own_exporter() {
  local phase="$1" address="$2" status=0
  log "The agent, on an exporter someone already runs: $phase"
  remove_agent
  keep_otlp_in "$phase"
  curl -fsSL "$ONEUPTIME_URL/install/openstack-agent" -o "$GUIDE_DIR/install.sh"
  FOLLOW_ANSWERS="$(printf '%s\n' "$ONEUPTIME_URL" "$INGESTION_KEY" "$CLOUD_NAME" RegionOne)" \
    OPENSTACK_EXPORTER_ADDRESS="$address" follow <<'GUIDE' || status=$?
bash install.sh
GUIDE
  sudo docker compose --project-directory "$AGENT_FOLDER" ps -a 2>&1 | tee -a "$COMMANDS" || true
  wait_for_what_it_sends "$phase" || status=$?
  keep_what_the_agent_was "$phase"
  stop_keeping_otlp "$phase"
  return "$status"
}

# On a Kolla node Docker has no NAT of its own (docker_disable_default_iptables_rules), so
# this is the way to run the agent there. A prerequisite says to run it off the cloud, and
# on one machine there is nowhere else: this says whether it works when someone does not.
without_docker() {
  local phase="without-docker" status=0
  log "The agent as systemd services, on a Kolla node"
  remove_agent
  keep_otlp_in "$phase"
  curl -fsSL "$ONEUPTIME_URL/install/openstack-agent" -o "$GUIDE_DIR/install.sh"
  FOLLOW_ANSWERS="$(printf '%s\n' "$ONEUPTIME_URL" "$INGESTION_KEY" "$CLOUD_NAME")" \
    OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS="$KOLLA_VIP:9198" OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
    follow <<'GUIDE' || status=$?
bash install.sh --without-docker
GUIDE
  sudo systemctl status oneuptime-openstack-agent --no-pager 2>&1 | tee -a "$COMMANDS" || true
  wait_for_what_it_sends "$phase" || status=$?
  keep_what_the_agent_was "$phase"
  stop_keeping_otlp "$phase"
  remove_agent
  return "$status"
}

# ----------------------------------------------------------------------------
# Logs, on Kolla's own files
# ----------------------------------------------------------------------------
logs_profile() {
  local phase="logs" network status=0
  log "The logs profile, on Kolla's files"
  keep_otlp_in "$phase"
  FOLLOW_ANSWERS="$(printf '%s\n' "$ONEUPTIME_URL" "$INGESTION_KEY" "$CLOUD_NAME")" follow <<'GUIDE' || status=$?
curl -fsSLO https://oneuptime.example/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
GUIDE
  sudo docker compose --project-directory "$LOGS_FOLDER" -f "$LOGS_FOLDER/docker-compose.logs.yml" ps -a 2>&1 | tee -a "$COMMANDS" || true

  # What a line needs to reach a real OneUptime from this container. A OneUptime on this very
  # machine proves little: the question is whether it can get off the machine at all.
  network="$(sudo docker inspect oneuptime-openstack-logs --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' 2>/dev/null)"
  {
    echo "network: $network"
    sudo cat /etc/docker/daemon.json
    echo
    if [ "$network" = "host" ]; then
      sudo docker run --rm --network host "$CURL_IMAGE" -sS -o /dev/null -m 20 -w 'oneuptime.com answers %{http_code}\n' https://oneuptime.com/ 2>&1
    else
      sudo docker run --rm --network "$network" "$CURL_IMAGE" -sS -o /dev/null -m 20 -w 'oneuptime.com answers %{http_code}\n' https://oneuptime.com/ 2>&1
      sudo docker run --rm --network "$network" "$CURL_IMAGE" -sS -o /dev/null -m 20 -w 'this OneUptime answers %{http_code}\n' "$ONEUPTIME_URL/otlp/v1/validate" 2>&1
    fi
  } | tee "$GUIDE_RECORDING/$phase/reach.txt"

  log "Make the services say something"
  for attempt in 1 2 3 4 5 6 7 8; do
    openstack server list --all-projects >/dev/null 2>&1 || true
    openstack volume list --all-projects >/dev/null 2>&1 || true
    openstack image list >/dev/null 2>&1 || true
    openstack network list >/dev/null 2>&1 || true
    openstack server show ou-does-not-exist >/dev/null 2>&1 || true
    sleep 15
    : "$attempt"
  done
  sudo docker logs oneuptime-openstack-logs >"$GUIDE_RECORDING/$phase/collector.log" 2>&1 || true
  if [ -s "$GUIDE_RECORDING/$phase/otlp/logs.json" ]; then
    echo "It sent $(wc -c <"$GUIDE_RECORDING/$phase/otlp/logs.json") bytes of logs."
  else
    problem "$phase: the logs profile sent nothing"
    status=1
  fi
  (cd "$LOGS_FOLDER" && sudo docker compose -f docker-compose.logs.yml down) >/dev/null 2>&1 || true
  stop_keeping_otlp "$phase"
  return "$status"
}

# ----------------------------------------------------------------------------
# The guide's second credential, and its policy overrides
# ----------------------------------------------------------------------------
infrastructure_only() {
  local phase="infrastructure-only" output="$GUIDE_DIR/credential.txt" file service code status=0
  log "The guide's second credential: a role of its own, with the policy overrides"
  remove_agent
  FOLLOW_AS="$AS_PERSON" FOLLOW_LOGIN="$LOGGED_IN_AS_ADMIN" follow <<'GUIDE' || status=$?
openstack role create oneuptime_monitoring
openstack project create --domain default --description "OneUptime monitoring: holds nothing" oneuptime-monitoring
openstack quota set --instances 0 --cores 0 --ram 0 --key-pairs 0 oneuptime-monitoring
openstack quota set --volumes 0 --gigabytes 0 --snapshots 0 --backups 0 --backup-gigabytes 0 oneuptime-monitoring
openstack quota set --networks 0 --subnets 0 --ports 0 --routers 0 --floating-ips 0 --secgroups 0 --secgroup-rules 0 oneuptime-monitoring
openstack user create --domain default --password-prompt oneuptime-monitoring
openstack role add --project oneuptime-monitoring --user oneuptime-monitoring oneuptime_monitoring
openstack role add --project oneuptime-monitoring --user oneuptime-monitoring reader
GUIDE
  FOLLOW_AS="$AS_PERSON" follow <<'GUIDE' || status=$?
curl -fsSLO https://oneuptime.example/install/openstack-agent/access/policy/nova.yaml
curl -fsSLO https://oneuptime.example/install/openstack-agent/access/policy/neutron.yaml
curl -fsSLO https://oneuptime.example/install/openstack-agent/access/policy/placement.yaml
curl -fsSLO https://oneuptime.example/install/openstack-agent/access/policy/keystone.yaml
GUIDE
  for service in nova neutron placement keystone; do
    mkdir -p "/etc/kolla/config/$service"
    cp "$GUIDE_DIR/$service.yaml" "/etc/kolla/config/$service/policy.yaml"
  done
  FOLLOW_AS="$AS_PERSON" follow <<'GUIDE' || status=$?
kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement
GUIDE
  FOLLOW_AS="$AS_PERSON" FOLLOW_LOGIN="$LOGGED_IN_AS_ACCOUNT" FOLLOW_OUTPUT="$output" follow <<'GUIDE' || status=$?
openstack application credential create oneuptime-agent \
  --expiration 2027-11-04T00:00:00
GUIDE
  local id secret folder="$GUIDE_RECORDING/$phase/exporter" clouds="$KOLLA_HOME/infrastructure-clouds.yaml"
  id="$(awk -F'|' '$2 ~ /^ *[Ii][Dd] *$/ { gsub(/ /, "", $3); print $3 }' "$output" | head -1)"
  secret="$(awk -F'|' '$2 ~ /^ *[Ss]ecret *$/ { gsub(/ /, "", $3); print $3 }' "$output" | head -1)"
  if [ -n "$secret" ]; then
    sed -i "s/$secret/<secret>/g" "$COMMANDS"
  fi
  if [ -z "$id" ] || [ -z "$secret" ]; then
    problem "$phase: the credential's id and secret are not in what it printed"
    return 1
  fi
  mkdir -p "$folder"
  cat >"$clouds" <<CLOUDS
clouds:
  RegionOne:
    region_name: RegionOne
    identity_api_version: 3
    auth_type: v3applicationcredential
    auth:
      auth_url: $KEYSTONE_URL
      application_credential_id: $id
      application_credential_secret: $secret
CLOUDS
  chmod a+r "$clouds"
  docker rm -f ou-infrastructure-exporter >/dev/null 2>&1 || true
  # shellcheck disable=SC2086 # One flag per word.
  docker run -d --name ou-infrastructure-exporter --network host -v "$clouds:/etc/openstack/clouds.yaml:ro" \
    "$EXPORTER_IMAGE" --multi-cloud --web.listen-address="$KOLLA_API_ADDRESS:9182" \
    --os-client-config=/etc/openstack/clouds.yaml $EXPORTER_FLAGS >/dev/null
  sleep 5
  : >"$folder/status.txt"
  for service in identity compute placement network volume image; do
    code="$(curl -sS --max-time 180 -o "$folder/$service.prom" -w '%{http_code}' \
      "http://$KOLLA_API_ADDRESS:9182/probe?cloud=RegionOne&include_services=$service" || echo 000)"
    printf '%s %s %s series\n' "$service" "$code" "$(grep -vc '^#' "$folder/$service.prom" || true)" | tee -a "$folder/status.txt"
  done
  docker logs ou-infrastructure-exporter >"$folder/exporter.log" 2>&1 || true
  docker rm -f ou-infrastructure-exporter >/dev/null 2>&1 || true
  rm -f "$clouds"
  return "$status"
}

# ----------------------------------------------------------------------------
# A firing alert, from Kolla's own Alertmanager
# ----------------------------------------------------------------------------
webhook_says() {
  grep -ls "\"status\":\"$1\"" "$OUTPUT_DIR"/alertmanager/*.json 2>/dev/null | grep -q .
}

wait_for_webhook() {
  local status="$1" limit="$2" waited=0
  while [ "$waited" -lt "$limit" ]; do
    if webhook_says "$status"; then
      echo "Alertmanager posted a $status webhook after $waited seconds."
      return 0
    fi
    sleep 10
    waited=$((waited + 10))
  done
  problem "Alertmanager posted no $status webhook in $limit seconds"
  return 1
}

drill() {
  local status=0
  log "Stop Memcached and nova-compute, as they stop in production"
  sudo docker stop memcached nova_compute
  wait_for_webhook firing 420 || status=$?
  # What Prometheus and Alertmanager say they did, whichever way that went.
  curl -sS --max-time 20 "http://$KOLLA_API_ADDRESS:9093/api/v2/alerts" >"$OUTPUT_DIR/alertmanager/alerts-while-firing.json" 2>&1 || true
  sudo docker start memcached nova_compute
  wait_for_webhook resolved 600 || status=$?
  sudo docker logs prometheus_alertmanager >"$OUTPUT_DIR/alertmanager/alertmanager.log" 2>&1 || true
  return "$status"
}

case "${1:-}" in
  prepare) prepare ;;
  record) record_cloud ;;
  alerts) alerts ;;
  kolla-exporter) kolla_exporter ;;
  full-view) full_view ;;
  own-exporter) own_exporter own-exporter "$KOLLA_API_ADDRESS:$OWN_EXPORTER_PORT" ;;
  own-exporter-170) own_exporter own-exporter-170 "$KOLLA_API_ADDRESS:$OWN_EXPORTER_170_PORT" ;;
  without-docker) without_docker ;;
  logs) logs_profile ;;
  infrastructure-only) infrastructure_only ;;
  drill) drill ;;
  *)
    echo "Usage: kolla-guide.sh prepare|record|alerts|kolla-exporter|full-view|own-exporter|own-exporter-170|without-docker|logs|infrastructure-only|drill" >&2
    exit 2
    ;;
esac
