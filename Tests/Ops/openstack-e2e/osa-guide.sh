#!/usr/bin/env bash
#
# Follow the OpenStack-Ansible guide on the deployment osa-aio.sh left, with the guide's exact
# commands, and record what comes out. OneUptime itself is fake-oneuptime.py, as in
# kolla-guide.sh, whose header says why.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/osa-guide.sh <phase>, in this order:
#
#   prepare              starts Docker again, the fake OneUptime and what keeps its OTLP
#   record               what the cloud and the agent's exporter answer, before anything changes
#   full-view            the agent, on the guide's first credential
#   stands-on            RabbitMQ's and HAProxy's exporters, as the guide turns them on
#   logs                 the logs profile, on the journal, with its containers' passed through
#   infrastructure-only  the guide's second credential, with its policy overrides

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=Tests/Ops/openstack-e2e/osa-env.sh
source "$HERE/osa-env.sh"

GUIDE_RECORDING="$OUTPUT_DIR/guide"
GUIDE_DIR="$OSA_HOME/guide"
ONEUPTIME_URL="http://$OSA_MANAGEMENT_ADDRESS:8099"
# shellcheck source=Tests/Ops/openstack-e2e/guide-follow.sh
source "$HERE/guide-follow.sh"

mkdir -p "$GUIDE_RECORDING" "$GUIDE_DIR"

CLOUD_NAME="osa-aio"

fill_placeholders() {
  local text="$1"
  text="${text//<an address the agent can reach>/$OSA_MANAGEMENT_ADDRESS}"
  printf '%s' "$text"
}

AS_DEPLOYER="sudo -H env PATH=$PATH"
LOGGED_IN_AS_ADMIN=". ~/openrc"
LOGGED_IN_AS_ACCOUNT=". ~/openrc
export OS_USERNAME=oneuptime-monitoring OS_PASSWORD='$MONITORING_PASSWORD'
export OS_PROJECT_NAME=oneuptime-monitoring OS_TENANT_NAME=oneuptime-monitoring"

# The guide's commands in its utility container: lxc-attach, then the openrc there.
utility_runs() {
  local utility
  utility="$(sudo lxc-ls -1 2>/dev/null | grep utility | head -n 1 || true)"
  if [ -n "$utility" ]; then
    printf '%s' "sudo lxc-attach -n $utility -- env PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root"
  else
    printf '%s' "sudo -H env PATH=$PATH"
  fi
}

prepare() {
  log "Docker again, for the agent, with what LXC containers forward left alone"
  sudo systemctl start docker
  sudo iptables -I DOCKER-USER -j ACCEPT || true
  sudo iptables -P FORWARD ACCEPT
  docker info --format 'Docker {{.ServerVersion}}'

  log "A OneUptime for the guide to name"
  start_fake_oneuptime "$OUTPUT_DIR"
  docker pull -q "$COLLECTOR_IMAGE"
}

start_recording_exporter() {
  local file="$OSA_HOME/exporter-clouds.yaml"
  sed 's/^\( *\)default:/\1RegionOne:/' "$OS_CLIENT_CONFIG_FILE" >"$file"
  chmod a+r "$file"
  docker rm -f ou-own-exporter >/dev/null 2>&1 || true
  # shellcheck disable=SC2086 # One flag per word.
  docker run -d --name ou-own-exporter --network host -v "$file:/etc/openstack/clouds.yaml:ro" \
    "$EXPORTER_IMAGE" --multi-cloud --web.listen-address="$OSA_MANAGEMENT_ADDRESS:9180" \
    --endpoint-type=internal --os-client-config=/etc/openstack/clouds.yaml $EXPORTER_FLAGS >/dev/null
}

record_cloud() {
  local service conf
  log "OpenStack-Ansible's own files"
  sudo cat /etc/openstack_deploy/user_variables.yml >"$OSA_RECORDING/user_variables.yml" 2>/dev/null || true
  in_utility 'cat ~/openrc' | sed -E "s/(OS_PASSWORD=).*/\1REDACTED/" >"$OSA_RECORDING/openrc.txt" || true
  in_utility 'cat ~/.config/openstack/clouds.yaml' | sed -E 's/(password:).*/\1 REDACTED/' >"$OSA_RECORDING/clouds.txt" || true
  sudo lxc-ls -f >"$OSA_RECORDING/containers.txt" 2>&1 || true
  openstack endpoint list >"$OSA_RECORDING/endpoints.txt" 2>&1 || true
  # The claim the guide makes for access rules, read from each service's own file.
  for service in nova neutron cinder glance placement; do
    conf="/etc/$service/$service.conf"
    [ "$service" != glance ] || conf="/etc/glance/glance-api.conf"
    for container in $(sudo lxc-ls -1 | grep -E "${service}_(api|server)|${service}-api" | head -1); do
      sudo lxc-attach -n "$container" -- grep -A40 '^\[keystone_authtoken\]' "$conf" 2>/dev/null \
        | grep -E '^service_type' | sed "s/^/$service: /"
    done
  done >"$OSA_RECORDING/service-types.txt" || true

  log "What the agent's exporter says about this cloud, and what its APIs answer"
  start_recording_exporter
  sleep 5
  OUTPUT_DIR="$OUTPUT_DIR" EXPORTER_URL="http://$OSA_MANAGEMENT_ADDRESS:9180" bash "$HERE/record.sh" healthy
}

# An application credential, as the guide's first level makes it, in the utility container.
full_view() {
  local phase="full-view" output="$GUIDE_DIR/credential.txt" id secret public_keystone ca status=0
  log "The guide's first credential, and the agent's own exporter"
  remove_agent

  FOLLOW_AS="$(utility_runs)" FOLLOW_LOGIN="$LOGGED_IN_AS_ADMIN" GUIDE_DIR=/tmp follow <<'GUIDE' || status=$?
openstack project create --domain default oneuptime-monitoring
openstack user create --domain default --password-prompt oneuptime-monitoring
openstack role add --project oneuptime-monitoring --user oneuptime-monitoring admin
GUIDE
  FOLLOW_AS="$(utility_runs)" FOLLOW_LOGIN="$LOGGED_IN_AS_ACCOUNT" FOLLOW_OUTPUT="$output" GUIDE_DIR=/tmp follow <<'GUIDE' || status=$?
curl -fsSLO https://oneuptime.example/install/openstack-agent/access/application-credential-access-rules.json
curl -fsSLO https://oneuptime.example/install/openstack-agent/access/access-rules-for-cloud.py
openstack catalog list -f json | python3 access-rules-for-cloud.py \
  application-credential-access-rules.json > access-rules-for-this-cloud.json
openstack application credential create oneuptime-agent \
  --role admin \
  --access-rules "$(cat access-rules-for-this-cloud.json)" \
  --expiration 2027-11-04T00:00:00
GUIDE
  id="$(credential_field id "$output")"
  secret="$(credential_field secret "$output")"
  forget_in_commands "$secret"
  mkdir -p "$GUIDE_RECORDING/$phase"
  if [ -z "$id" ] || [ -z "$secret" ]; then
    problem "$phase: the credential's id and secret are not in what it printed"
    return 1
  fi

  # What a machine outside the cloud can reach: its public endpoints, which are HTTPS with a
  # certificate of OpenStack-Ansible's own authority.
  public_keystone="$(openstack endpoint list --service identity --interface public -f value -c URL | head -1)"
  ca="/etc/openstack_deploy/pki/roots/ExampleCorpRoot/certs/ExampleCorpRoot.crt"
  sudo test -f "$ca" || problem "$phase: OpenStack-Ansible's authority is not at $ca"
  sudo cp "$ca" "$GUIDE_DIR/ca.pem"
  sudo chmod a+r "$GUIDE_DIR/ca.pem"

  keep_otlp_in "$phase"
  FOLLOW_ANSWERS="$(printf '%s\n' "$ONEUPTIME_URL" "$INGESTION_KEY" "$CLOUD_NAME" "${public_keystone%/}/v3" RegionOne Y "$id" "$secret" "$GUIDE_DIR/ca.pem")" \
    follow <<'GUIDE' || status=$?
curl -fsSL https://oneuptime.example/install/openstack-agent -o install.sh && bash install.sh
GUIDE
  verify_agent
  wait_for_what_it_sends "$phase" || status=$?
  troubleshoot "$phase"
  keep_what_the_agent_was "$phase"
  stop_keeping_otlp "$phase"
  return "$status"
}

# RabbitMQ's and HAProxy's exporters, which the guide turns on, and whether the agent then
# reads them. This leaves the agent from full-view running, as a person's would be.
stands_on() {
  local phase="stands-on" rabbit status=0
  log "What the cloud stands on: RabbitMQ"
  sudo tee -a /etc/openstack_deploy/user_variables.yml >/dev/null <<'GUIDE'
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
GUIDE
  FOLLOW_AS="$AS_DEPLOYER" GUIDE_DIR=/opt/openstack-ansible follow <<'GUIDE' || status=$?
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
GUIDE

  log "What the cloud stands on: HAProxy"
  sed -e "s/<an address the agent can reach>/$OSA_MANAGEMENT_ADDRESS/" <<'GUIDE' | sudo tee -a /etc/openstack_deploy/user_variables.yml >/dev/null
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
GUIDE
  FOLLOW_AS="$AS_DEPLOYER" GUIDE_DIR=/opt/openstack-ansible follow <<'GUIDE' || status=$?
openstack-ansible openstack.osa.haproxy
GUIDE

  mkdir -p "$GUIDE_RECORDING/$phase" "$OUTPUT_DIR/control-plane"
  rabbit="$(sudo lxc-ls -f -F NAME,IPV4 | awk '/rabbit/ { for (i = 2; i <= NF; i++) if ($i ~ /^172\.29\.23[6-9]\./) { gsub(/,/, "", $i); print $i; exit } }')"
  : >"$OUTPUT_DIR/control-plane/status.txt"
  for target in "rabbitmq=$rabbit:15692" "haproxy=$OSA_MANAGEMENT_ADDRESS:1936"; do
    local job="${target%%=*}" address="${target#*=}" code
    code="$(curl -sS --max-time 30 -o "$OUTPUT_DIR/control-plane/$job.prom" -w '%{http_code}' "http://$address/metrics" 2>/dev/null || echo 000)"
    printf '%s %s %s\n' "$code" "$job" "$address" | tee -a "$OUTPUT_DIR/control-plane/status.txt"
  done

  keep_otlp_in "$phase"
  {
    printf 'OPENSTACK_RABBITMQ_TARGETS=[%s:15692]\n' "$rabbit"
    printf 'OPENSTACK_HAPROXY_TARGETS=[%s:1936]\n' "$OSA_MANAGEMENT_ADDRESS"
  } | sudo tee -a "$AGENT_FOLDER/.env" >/dev/null
  (cd "$AGENT_FOLDER" && sudo docker compose up -d) 2>&1 | tee -a "$GUIDE_RECORDING/commands.log" || status=$?
  sleep 200
  keep_what_the_agent_was "$phase"
  stop_keeping_otlp "$phase"
  return "$status"
}

logs_profile() {
  local phase="logs" status=0
  log "The logs profile, on the journal"
  remove_agent
  keep_otlp_in "$phase"
  {
    sudo ls -la /var/log/journal/ || true
    sudo journalctl --no-pager -n 20 -u 'nova-*' -u 'neutron-*' -u 'keystone*' -m || true
    sudo journalctl --no-pager -m -F _SYSTEMD_UNIT 2>/dev/null | sort -u | grep -E 'nova|neutron|cinder|glance|keystone|placement' || true
  } >"$GUIDE_RECORDING/$phase/journal-before.txt" 2>&1
  FOLLOW_ANSWERS="$(printf '%s\n' "$ONEUPTIME_URL" "$INGESTION_KEY" "$CLOUD_NAME")" follow <<'GUIDE' || status=$?
curl -fsSLO https://oneuptime.example/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
GUIDE
  sudo systemctl status oneuptime-openstack-logs --no-pager 2>&1 | tee -a "$GUIDE_RECORDING/commands.log" || true

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
  sudo journalctl -u oneuptime-openstack-logs --no-pager >"$GUIDE_RECORDING/$phase/collector.log" 2>&1 || true
  if [ -s "$GUIDE_RECORDING/$phase/otlp/logs.json" ]; then
    echo "It sent $(wc -c <"$GUIDE_RECORDING/$phase/otlp/logs.json") bytes of logs."
  else
    problem "$phase: the logs profile sent nothing"
    status=1
  fi
  sudo systemctl disable --now oneuptime-openstack-logs >/dev/null 2>&1 || true
  stop_keeping_otlp "$phase"
  return "$status"
}

infrastructure_only() {
  local phase="infrastructure-only" output="$GUIDE_DIR/credential.txt" service id secret code status=0
  local folder="$GUIDE_RECORDING/$phase/exporter" clouds="$OSA_HOME/infrastructure-clouds.yaml"
  log "The guide's second credential: a role of its own, with the policy overrides"
  remove_agent
  FOLLOW_AS="$(utility_runs)" FOLLOW_LOGIN="$LOGGED_IN_AS_ADMIN" GUIDE_DIR=/tmp follow <<'GUIDE' || true
openstack application credential delete oneuptime-agent || true
GUIDE
  in_utility '. ~/openrc; openstack user delete oneuptime-monitoring; openstack project delete oneuptime-monitoring' || true
  FOLLOW_AS="$(utility_runs)" FOLLOW_LOGIN="$LOGGED_IN_AS_ADMIN" GUIDE_DIR=/tmp follow <<'GUIDE' || status=$?
openstack role create oneuptime_monitoring
openstack project create --domain default --description "OneUptime monitoring: holds nothing" oneuptime-monitoring
openstack quota set --instances 0 --cores 0 --ram 0 --key-pairs 0 oneuptime-monitoring
openstack quota set --volumes 0 --gigabytes 0 --snapshots 0 --backups 0 --backup-gigabytes 0 oneuptime-monitoring
openstack quota set --networks 0 --subnets 0 --ports 0 --routers 0 --floating-ips 0 --secgroups 0 --secgroup-rules 0 oneuptime-monitoring
openstack user create --domain default --password-prompt oneuptime-monitoring
openstack role add --project oneuptime-monitoring --user oneuptime-monitoring oneuptime_monitoring
openstack role add --project oneuptime-monitoring --user oneuptime-monitoring reader
GUIDE
  FOLLOW_AS="env" follow <<'GUIDE' || status=$?
curl -fsSLO https://oneuptime.example/install/openstack-agent/access/policy/nova.yaml
curl -fsSLO https://oneuptime.example/install/openstack-agent/access/policy/neutron.yaml
curl -fsSLO https://oneuptime.example/install/openstack-agent/access/policy/placement.yaml
curl -fsSLO https://oneuptime.example/install/openstack-agent/access/policy/keystone.yaml
GUIDE
  # As the guide says: each file's rules, under its service's variable.
  for service in nova neutron placement keystone; do
    {
      printf '%s_policy_overrides:\n' "$service"
      sed -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' -e 's/^/  /' "$GUIDE_DIR/$service.yaml"
    } | sudo tee -a /etc/openstack_deploy/user_variables.yml >/dev/null
  done
  FOLLOW_AS="$AS_DEPLOYER" GUIDE_DIR=/opt/openstack-ansible follow <<'GUIDE' || status=$?
openstack-ansible openstack.osa.nova --tags nova-policy-override
GUIDE
  for service in neutron placement keystone; do
    (
      cd /opt/openstack-ansible || exit 1
      sudo -H env "PATH=$PATH" bash -c "openstack-ansible openstack.osa.$service --tags $service-policy-override"
    ) 2>&1 | tail -n 5 | tee -a "$GUIDE_RECORDING/commands.log" || status=$?
  done

  FOLLOW_AS="$(utility_runs)" FOLLOW_LOGIN="$LOGGED_IN_AS_ACCOUNT" FOLLOW_OUTPUT="$output" GUIDE_DIR=/tmp follow <<'GUIDE' || status=$?
openstack application credential create oneuptime-agent \
  --expiration 2027-11-04T00:00:00
GUIDE
  id="$(credential_field id "$output")"
  secret="$(credential_field secret "$output")"
  forget_in_commands "$secret"
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
      auth_url: $(openstack endpoint list --service identity --interface internal -f value -c URL | head -1)/v3
      application_credential_id: $id
      application_credential_secret: $secret
CLOUDS
  chmod a+r "$clouds"
  docker rm -f ou-infrastructure-exporter >/dev/null 2>&1 || true
  # shellcheck disable=SC2086 # One flag per word.
  docker run -d --name ou-infrastructure-exporter --network host -v "$clouds:/etc/openstack/clouds.yaml:ro" \
    "$EXPORTER_IMAGE" --multi-cloud --web.listen-address="$OSA_MANAGEMENT_ADDRESS:9182" \
    --endpoint-type=internal --os-client-config=/etc/openstack/clouds.yaml $EXPORTER_FLAGS >/dev/null
  sleep 5
  : >"$folder/status.txt"
  for service in identity compute placement network volume image; do
    code="$(curl -sS --max-time 180 -o "$folder/$service.prom" -w '%{http_code}' \
      "http://$OSA_MANAGEMENT_ADDRESS:9182/probe?cloud=RegionOne&include_services=$service" || echo 000)"
    printf '%s %s %s series\n' "$service" "$code" "$(grep -vc '^#' "$folder/$service.prom" || true)" | tee -a "$folder/status.txt"
  done
  docker logs ou-infrastructure-exporter >"$folder/exporter.log" 2>&1 || true
  docker rm -f ou-infrastructure-exporter >/dev/null 2>&1 || true
  rm -f "$clouds"
  return "$status"
}

case "${1:-}" in
  prepare) prepare ;;
  record) record_cloud ;;
  full-view) full_view ;;
  stands-on) stands_on ;;
  logs) logs_profile ;;
  infrastructure-only) infrastructure_only ;;
  *)
    echo "Usage: osa-guide.sh prepare|record|full-view|stands-on|logs|infrastructure-only" >&2
    exit 2
    ;;
esac
