# What following a deployment tool's guide takes, whichever tool it is. Sourced by
# kolla-guide.sh and osa-guide.sh, never run. They set:
#
#   GUIDE_RECORDING  where what it did is recorded
#   GUIDE_DIR        the folder a person would run the guide's commands in
#   ONEUPTIME_URL    the OneUptime the guide is followed against
#   fill_placeholders()  turns the guide's placeholders into this cloud's values
#
# A block handed to `follow` is the guide's own text: OpenStackDeploymentGuides.test.ts fails
# when one and the guide differ. So what runs is the guide, not a copy of it that can drift.

set -uo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../agents/OpenStackAgent" && pwd)"
SINK_CONFIG="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/collector-sink.yaml"

INGESTION_KEY="rig-ingestion-key"
HEARTBEAT_KEY="rig-heartbeat-key"
MONITORING_PASSWORD="ou-rig-monitoring-password"

# The expiry the guide prints, when it is read on the date OpenStackDeploymentGuides.test.ts
# reads it, and one a year from now to use instead.
GUIDE_EXPIRATION="2027-11-04T00:00:00"
EXPIRATION="$(date -u -d '+1 year' +%Y-%m-%dT%H:%M:%S)"

# Read from what ships, so this can never test another version.
COLLECTOR_IMAGE="$(grep -E '^[[:space:]]*image:[[:space:]]*otel/opentelemetry-collector-contrib' "$AGENT_DIR/docker-compose.yml" | head -1 | awk '{print $2}')"
EXPORTER_IMAGE="$(grep -E '^[[:space:]]*image:[[:space:]]*ghcr.io/openstack-exporter/' "$AGENT_DIR/docker-compose.yml" | head -1 | awk '{print $2}')"
EXPORTER_FLAGS="$(sed -n '/^  openstack-exporter:$/,/^  [a-z-]*:$/p' "$AGENT_DIR/docker-compose.yml" | grep -E '^[[:space:]]*- --disable-metric=' | sed -E 's/^[[:space:]]*- //' | tr '\n' ' ')"
CURL_IMAGE="$(grep -E '^CURL_IMAGE=' "$AGENT_DIR/troubleshoot.sh" | head -1 | cut -d '"' -f 2)"

AGENT_FOLDER="/opt/oneuptime-openstack-agent"
LOGS_FOLDER="/opt/oneuptime-openstack-logs"

log() {
  printf '\n=== %s\n' "$*"
}

problem() {
  printf '%s\n' "$*" | tee -a "$GUIDE_RECORDING/problems.txt" >&2
}

# Runs the text on its standard input as the guide says it. Its settings, given in front:
#   FOLLOW_AS       who runs it. Root by default, as install.sh writes to /opt
#   FOLLOW_ANSWERS  what a person would type at its questions
#   FOLLOW_LOGIN    what a person would have done first, in the same shell
#   FOLLOW_OUTPUT   a file to keep its output in, for what comes next to read
#   FOLLOW_LIMIT    seconds, for what the guide leaves running until someone stops it
follow() {
  local text status=0 output commands="$GUIDE_RECORDING/commands.log"
  text="$(fill_placeholders "$(cat)")"
  text="${text//https:\/\/oneuptime.example/$ONEUPTIME_URL}"
  text="${text//<secret key>/$HEARTBEAT_KEY}"
  # It asks a terminal, and there is none: the one word changed from what the guide says.
  text="${text//--password-prompt/--password $MONITORING_PASSWORD}"
  text="${text//$GUIDE_EXPIRATION/$EXPIRATION}"
  output="${FOLLOW_OUTPUT:-$(mktemp)}"
  printf '\n$ %s\n' "${text//$MONITORING_PASSWORD/<password>}" | tee -a "$commands"
  # Through a pipe, because lxc-attach gives whatever file its output goes to to root, mode 0700,
  # which left OpenStack-Ansible's guide unable to read what its own commands printed.
  (
    cd "$GUIDE_DIR" || exit 1
    # shellcheck disable=SC2086 # Who runs it is one or more words.
    ${FOLLOW_LIMIT:+timeout "$FOLLOW_LIMIT"} ${FOLLOW_AS:-sudo -E env "PATH=$PATH"} \
      bash -uo pipefail -c "set -e; ${FOLLOW_LOGIN:-}
$text" <<<"${FOLLOW_ANSWERS:-}"
  ) 2>&1 | cat >"$output"
  status="${PIPESTATUS[0]}"
  sed -e "s/$MONITORING_PASSWORD/<password>/g" "$output" | tee -a "$commands"
  printf '[exit %s]\n' "$status" | tee -a "$commands"
  if [ -z "${FOLLOW_OUTPUT:-}" ]; then
    rm -f "$output"
  fi
  return "$status"
}

# The credential's id and secret from what `openstack application credential create` printed.
credential_field() {
  awk -F'|' -v field="$1" 'tolower($2) ~ "^ *" field " *$" { gsub(/ /, "", $3); print $3 }' "$2" | head -1
}

forget_in_commands() {
  if [ -n "$1" ]; then
    sed -i "s/$1/<secret>/g" "$GUIDE_RECORDING/commands.log"
  fi
}

# What fake-oneuptime.py hands on is decoded and kept by a real collector, in a folder per
# part of the guide, so what each one sent can be told apart.
keep_otlp_in() {
  local folder="$GUIDE_RECORDING/$1/otlp"
  docker rm -f ou-sink >/dev/null 2>&1 || true
  mkdir -p "$folder"
  chmod 0777 "$folder"
  docker run -d --name ou-sink --network host --user "$(id -u):$(id -g)" \
    -v "$SINK_CONFIG:/etc/otelcol-contrib/config.yaml:ro" \
    -v "$folder:/recording" \
    "$COLLECTOR_IMAGE" --config=/etc/otelcol-contrib/config.yaml >/dev/null
}

stop_keeping_otlp() {
  docker logs ou-sink >"$GUIDE_RECORDING/$1/sink.log" 2>&1 || true
  docker rm -f ou-sink >/dev/null 2>&1 || true
}

start_fake_oneuptime() {
  local recording="$1" rig
  rig="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  nohup python3 -I "$rig/fake-oneuptime.py" 8099 "$AGENT_DIR" "$recording" \
    http://127.0.0.1:14318 >"$GUIDE_RECORDING/fake-oneuptime.log" 2>&1 &
  disown
  for attempt in $(seq 1 20); do
    if curl -fsS --max-time 3 "$ONEUPTIME_URL/otlp/v1/validate" >/dev/null; then
      echo "It answers at $ONEUPTIME_URL"
      return 0
    fi
    sleep 1
    : "$attempt"
  done
  problem "The fake OneUptime never answered at $ONEUPTIME_URL"
  return 1
}

# What a person has after the guide's download. An earlier part ran as root, and left its copy.
download_install_script() {
  sudo rm -f "$GUIDE_DIR/install.sh"
  curl -fsSL "$ONEUPTIME_URL/install/openstack-agent" -o "$GUIDE_DIR/install.sh"
}

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
  local folder="$GUIDE_RECORDING/$1"
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

# The guide's check, once the agent is up. -f never ends, so a limit does it.
verify_agent() {
  FOLLOW_LIMIT=30 follow <<'GUIDE' || true
cd /opt/oneuptime-openstack-agent
docker compose ps
docker compose logs -f oneuptime-openstack-agent
GUIDE
}

# Whether a line reaches a real OneUptime from the container that sends it. A OneUptime on
# this very machine proves little: the question is whether it can get off the machine at all.
record_where_the_logs_can_reach() {
  local container="$1" file="$2" network
  network="$(sudo docker inspect "$container" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' 2>/dev/null)"
  {
    echo "network: $network"
    sudo cat /etc/docker/daemon.json 2>/dev/null
    echo
    # What carries it out, when Docker was told to write no rules: one left from before can.
    sudo docker network inspect "$network" --format '{{range .IPAM.Config}}subnet: {{.Subnet}}{{end}}' 2>&1
    sudo iptables -t nat -S POSTROUTING 2>&1
    sudo docker run --rm --network "$network" "$CURL_IMAGE" -sS -o /dev/null -m 20 \
      -w 'oneuptime.com answers %{http_code}\n' https://oneuptime.com/ 2>&1
    sudo docker run --rm --network "$network" "$CURL_IMAGE" -sS -o /dev/null -m 20 \
      -w 'this OneUptime answers %{http_code}\n' "$ONEUPTIME_URL/otlp/v1/validate" 2>&1
  } | tee "$file"
}
