#!/usr/bin/env bash
#
# The OpenStack agent installed the way its docs say, against the real cloud DevStack
# deployed on this runner, as a person would: the commands are lifted out of the docs page
# (agent-install-docs.py), the answers are typed on stdin, and what the agent sends goes to a
# stand-in OneUptime (agent-install-oneuptime.py) that serves the files and keeps every batch.
#
# OpenStackAgentInstallers.test.js and OpenStackAgentWithoutDocker.test.js run the same script
# against stubs. This shows what only the real thing can:
#
#   plain-docker    Docker, as a person with the docker group and no other rights. The cloud
#                   reports, the docs' commands all work, troubleshoot.sh tells the truth about
#                   a healthy agent and about each thing broken in turn, stopping Nova leaves the
#                   other services reporting, and a re-run upgrades the agent from an older release
#   root-docker     Docker, with sudo: the exporter really runs as uid 65532 and reads a clouds.yaml
#                   of mode 0600 that it owns, under a root umask of 077, which start-agent.sh never
#                   exercises. The docs' systemd unit starts, stops and comes back after a kill
#   without-docker  The pinned releases past their digest check, run by this machine's systemd:
#                   their sandboxes, their users, what they listen on, a restart after a kill, a
#                   password holding every character that could go wrong, and an upgrade of the
#                   binary itself
#   clean-ubuntu, clean-rocky, clean-docker
#                   The same install on a machine with nothing on it but systemd, curl and sudo (and
#                   Docker, for the last): Ubuntu 24.04 and Rocky 9. The machines stand apart on
#                   Docker's network, as an agent should.
#   old-glibc       Rocky 8, whose glibc 2.28 the exporter's release can't run on: the install says so
#                   and changes nothing, where it used to leave a service restarting for ever.
#
# Every check is reported, and one that fails costs no other, because a DevStack takes half an hour
# to deploy. Everything goes in $OUTPUT_DIR/agent-install, with results.txt saying how each went.
#
# It runs on this runner as root, as a user with no rights and as the runner's own user, changes the
# cloud (service_type on each API, an account, Nova's API stopped for a while), and starts things
# that listen on 4318, 8888, 8891 and 9180. Never point it at a cloud that matters.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/agent-install.sh
#   AGENT_INSTALL_PHASES="without-docker clean-ubuntu" runs only those.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
AGENT_DIR="$REPO_ROOT/agents/OpenStackAgent"
DOCS_PAGE="$REPO_ROOT/packages/App/FeatureSet/Docs/Content/en/telemetry/openstack.md"
CATALOG="$REPO_ROOT/packages/Common/Types/InstallScripts/InstallScripts.ts"

mkdir -p "${OUTPUT_DIR:-out}/agent-install"
OUTPUT="$(cd "${OUTPUT_DIR:-out}/agent-install" && pwd)"
WORK="$(mktemp -d)"
RESULTS="$OUTPUT/results.txt"
: >"$RESULTS"

export OS_CLOUD="${OS_CLOUD:-devstack-admin}"

PHASES="${AGENT_INSTALL_PHASES:-plain-docker root-docker without-docker clean-ubuntu clean-rocky old-glibc clean-docker}"
PORT=4318
REGION=RegionOne
PLAIN_USER=ou-plain
DEFAULT_DIR=/opt/oneuptime-openstack-agent
AGENT_CONTAINER=oneuptime-openstack-agent
EXPORTER_CONTAINER=oneuptime-openstack-exporter
AGENT_SERVICE=oneuptime-openstack-agent
EXPORTER_SERVICE=oneuptime-openstack-exporter
EXPORTER_SYSTEM_USER=oneuptime-openstack

# What the installers must carry exactly as typed: everything a shell, YAML, JSON, Compose's .env
# or systemd's would each take for something else.
HOSTILE_SECRET='s3cr$t'\''x"y\ #: {z} %h'
HOSTILE_CLOUD_NAME='Lab Cloud #1 $west'

FAILURES=0
PASSES=0
PHASE=setup
PHASE_DIR="$OUTPUT/setup"
mkdir -p "$PHASE_DIR"
STANDIN_PID=""
HOLDER_PID=""

cleanup() {
  [ -z "$STANDIN_PID" ] || kill "$STANDIN_PID" 2>/dev/null
  [ -z "$HOLDER_PID" ] || kill "$HOLDER_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

phase() {
  PHASE="$1"
  PHASE_DIR="$OUTPUT/$1"
  mkdir -p "$PHASE_DIR"
  printf '\n\n======== %s: %s\n' "$1" "$2"
}
section() { printf '\n--- %s\n' "$1"; }
pass() {
  PASSES=$((PASSES + 1))
  printf '  ok    %s\n' "$1"
  printf 'ok    %s: %s\n' "$PHASE" "$1" >>"$RESULTS"
}
fail() {
  FAILURES=$((FAILURES + 1))
  printf '  FAIL  %s\n' "$1"
  printf 'FAIL  %s: %s\n' "$PHASE" "$1" >>"$RESULTS"
  printf '::error title=agent install, %s::%s\n' "$PHASE" "$1"
}
note() {
  printf '  note  %s\n' "$1"
  printf 'note  %s: %s\n' "$PHASE" "$1" >>"$RESULTS"
}

# check <what> <command...>: a command that says yes or no.
check() {
  local what="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    pass "$what"
  else
    fail "$what"
  fi
}

# check_equal <what> <wanted> <got>
check_equal() {
  if [ "$2" = "$3" ]; then
    pass "$1 ($3)"
  else
    fail "$1: wanted '$2', got '$3'"
  fi
}

# wait_for <seconds> <what> <command...>: true as soon as the command is, and says how long it took.
wait_for() {
  local seconds="$1" what="$2" started waited
  shift 2
  started="$(date +%s)"
  while true; do
    if "$@" >/dev/null 2>&1; then
      waited=$(($(date +%s) - started))
      pass "$what (after ${waited}s)"
      return 0
    fi
    waited=$(($(date +%s) - started))
    if [ "$waited" -ge "$seconds" ]; then
      fail "$what (waited ${seconds}s)"
      return 1
    fi
    sleep 5
  done
}

# says <file> <text>...: what a log or a script's output has to hold, word for word.
says() {
  local file="$1" needle
  shift
  for needle in "$@"; do
    if grep -qF -- "$needle" "$file"; then
      pass "$(basename "$file") says: $needle"
    else
      fail "$(basename "$file") does not say: $needle"
    fi
  done
}

never_says() {
  local file="$1" needle
  shift
  for needle in "$@"; do
    if grep -qF -- "$needle" "$file"; then
      fail "$(basename "$file") says what it must not: $needle"
    else
      pass "$(basename "$file") does not say: $needle"
    fi
  done
}

# holds_no_secret <file>: never by value, here or in results.txt, which are both kept.
holds_no_secret() {
  local file="$1" name
  for name in INGESTION_KEY BAD_INGESTION_KEY APP_SECRET ACCOUNT_PASSWORD; do
    if [ -n "${!name:-}" ] && grep -qF -- "${!name}" "$file"; then
      fail "$(basename "$file") holds $name"
      return 0
    fi
  done
  pass "$(basename "$file") holds no secret"
}

# ----------------------------------------------------------------------------
# What reached the stand-in OneUptime
# ----------------------------------------------------------------------------
REQUESTS="$OUTPUT/oneuptime/requests.jsonl"
asked() { python3 -I "$HERE/agent-install-check.py" "$REQUESTS" "$@"; }

# wait_reports <since> <seconds> <prefix>...: each series arrives, in its own time. The longest
# wait is what a person waits: this is how many seconds "in minutes" really is.
wait_reports() {
  local since="$1" seconds="$2" prefix started
  shift 2
  started="$(date +%s)"
  for prefix in "$@"; do
    while ! asked "$since" reports "$prefix" >"$WORK/first"; do
      if [ $(($(date +%s) - started)) -ge "$seconds" ]; then
        break
      fi
      sleep 5
    done
    if asked "$since" reports "$prefix" >"$WORK/first"; then
      pass "$prefix series reached OneUptime, $(cat "$WORK/first")s after that point"
    else
      fail "no $prefix series reached OneUptime in ${seconds}s"
    fi
  done
}

check_identity() {
  local since="$1" cloud="$2" version="$3" answer=""
  if answer="$(asked "$since" identity "$cloud" "$version" "$REGION")"; then
    pass "every batch says cloud '$cloud', agent $version, region $REGION, and no service.name"
  else
    fail "a batch is wrong: $answer"
  fi
}

# wait_value <since> <seconds> <metric> <value>: a value reported since then.
wait_value() {
  local since="$1" seconds="$2" metric="$3" wanted="$4" started got=""
  started="$(date +%s)"
  while [ $(($(date +%s) - started)) -lt "$seconds" ]; do
    got="$(asked "$since" last "$metric" 2>/dev/null || true)"
    if [ "$got" = "$wanted" ]; then
      pass "$metric reads $wanted"
      return 0
    fi
    sleep 5
  done
  fail "$metric did not read $wanted in ${seconds}s (it read '$got')"
}

# ----------------------------------------------------------------------------
# Who runs what
# ----------------------------------------------------------------------------
# The person with the docker group and no other rights, from their home folder. stdin is theirs:
# it is what they type.
as_plain() {
  (cd / && timeout 1200 sudo -u "$PLAIN_USER" -H bash -euo pipefail -c "cd ~; $1")
}
# Root's file, whoever is asking: the agent's folder can be nobody else's to read.
stat_of() { sudo stat -c '%a %U:%G' "$1" 2>/dev/null; }
hash_of() { sudo sha256sum "$1" 2>/dev/null | cut -d ' ' -f 1; }
pid_of_container() { docker inspect -f '{{.State.Pid}}' "$1" 2>/dev/null; }
uid_of_pid() { ps -o uid= -p "$1" 2>/dev/null | tr -d ' '; }
user_of_pid() { ps -o user= -p "$1" 2>/dev/null | tr -d ' '; }
main_pid() { systemctl show -p MainPID --value "$1" 2>/dev/null; }
capabilities_of() { sudo awk '/^CapEff:/ { print $2 }' "/proc/$1/status" 2>/dev/null; }
container_id() { docker inspect -f '{{.Id}}' "$1" 2>/dev/null; }
container_is_running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]; }
container_is_gone() { ! docker inspect "$1" >/dev/null 2>&1; }

# ----------------------------------------------------------------------------
# What a person types, in the order install.sh asks on a machine that has never run it
# ----------------------------------------------------------------------------
# URL, key, cloud name, Keystone (without /v3, which it adds), the regions (the default), yes to
# an application credential, and its ID and secret. Keystone here speaks http, so no private CA.
application_credential_answers() {
  printf '%s\n' "$ONEUPTIME_URL" "$INGESTION_KEY" "$1" "$AUTH_URL" "" "" "$APP_ID" "$APP_SECRET"
}
# The same, no to an application credential, then the account, its password, its project, and the
# default for the two domains.
password_answers() {
  printf '%s\n' "$ONEUPTIME_URL" "$INGESTION_KEY" "$1" "$AUTH_URL" "" "n" \
    "$ACCOUNT" "$ACCOUNT_PASSWORD" "$ACCOUNT" "" ""
}
# What a person types when clouds.yaml is gone: yes to an application credential, and it.
credential_answers() {
  printf '%s\n' "" "$APP_ID" "$APP_SECRET"
}

# ----------------------------------------------------------------------------
# The credential, as the docs' level 1 makes it
# ----------------------------------------------------------------------------
ACCOUNT=oneuptime-monitoring
ACCOUNT_PASSWORD="$HOSTILE_SECRET"
APP_ID=""
APP_SECRET=""

as_account() {
  env -u OS_CLOUD OS_AUTH_URL="$AUTH_URL" OS_IDENTITY_API_VERSION=3 \
    OS_USERNAME="$ACCOUNT" OS_PASSWORD="$ACCOUNT_PASSWORD" OS_PROJECT_NAME="$ACCOUNT" \
    OS_USER_DOMAIN_NAME=Default OS_PROJECT_DOMAIN_NAME=Default "$@"
}

# make_credential <name> [<secret>]: into APP_ID and APP_SECRET. The expiry is the docs'.
make_credential() {
  local name="$1" secret="${2:-}" answer=""
  local -a extra=()
  [ -z "$secret" ] || extra=(--secret "$secret")
  if ! answer="$(as_account openstack application credential create "$name" \
    --role admin --access-rules "$(cat "$WORK/access-rules-for-this-cloud.json")" \
    --expiration 2030-11-01T00:00:00 ${extra[@]+"${extra[@]}"} -f json 2>"$PHASE_DIR/credential-$name.err")"; then
    fail "could not make the application credential $name: $(cat "$PHASE_DIR/credential-$name.err")"
    return 1
  fi
  # The client's words differ by release, as they do in access-matrix.sh.
  APP_ID="$(printf '%s' "$answer" | python3 -I -c 'import json,sys; c=json.load(sys.stdin); print(c.get("id") or c["ID"])')"
  APP_SECRET="$(printf '%s' "$answer" | python3 -I -c 'import json,sys; c=json.load(sys.stdin); print(c.get("secret") or c["Secret"])')"
  if [ -z "$APP_ID" ] || [ -z "$APP_SECRET" ]; then
    fail "the application credential $name came back with no ID or no secret"
    return 1
  fi
  pass "application credential $name made, limited by access rules"
}

set_service_type() {
  local conf="$1" type="$2"
  sudo test -f "$conf" || return 0
  sudo grep -q "^service_type = $type" "$conf" && return 0
  sudo sed -i "/^\[keystone_authtoken\]/a service_type = $type" "$conf"
}

prepare_cloud() {
  phase setup "The cloud, the releases, and a stand-in OneUptime"
  AUTH_URL="$(openstack endpoint list --service identity --interface public -f value -c URL | head -1)"
  HOST_IP="$(printf '%s' "$AUTH_URL" | sed -E 's|^[a-z]+://\[?([^]/:]+)\]?.*|\1|')"
  if [ -z "$AUTH_URL" ] || [ -z "$HOST_IP" ]; then
    fail "could not read Keystone's address from the cloud"
    return 1
  fi
  note "Keystone is at $AUTH_URL"
  ONEUPTIME_URL="http://$HOST_IP:$PORT"
  INGESTION_KEY="$(python3 -I -c 'import uuid; print(uuid.uuid4())')"
  BAD_INGESTION_KEY="$(python3 -I -c 'import uuid; print(uuid.uuid4())')"

  section "Lift the docs' commands out of the page"
  DOCS="$WORK/docs"
  mkdir -p "$DOCS"
  if python3 -I "$HERE/agent-install-docs.py" "$DOCS_PAGE" "$DOCS" "$ONEUPTIME_URL" "$CATALOG"; then
    pass "lifted the install, upgrade, systemd, doctor and uninstall commands from the page"
  else
    fail "the docs page no longer holds the commands this runs"
    return 1
  fi

  section "An older release to upgrade from: the collector before this one, and files that say so"
  COLLECTOR_VERSION="$(sed -n 's/^COLLECTOR_VERSION="\(.*\)"$/\1/p' "$AGENT_DIR/install.sh")"
  AGENT_VERSION="$(grep -A1 'key: oneuptime.agent.version' "$AGENT_DIR/otel-collector-config.yaml" | sed -n 's/^ *value: "\(.*\)"$/\1/p')"
  OLDER_VERSION="0.$(($(printf '%s' "$COLLECTOR_VERSION" | cut -d . -f 2) - 1)).0"
  CURRENT_RELEASE="$WORK/release-current"
  OLDER_RELEASE="$WORK/release-older"
  cp -R "$AGENT_DIR" "$CURRENT_RELEASE"
  cp -R "$AGENT_DIR" "$OLDER_RELEASE"
  if ! curl -fsSL --retry 5 --retry-delay 5 -o "$WORK/older.tar.gz" \
    "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OLDER_VERSION}/otelcol-contrib_${OLDER_VERSION}_linux_amd64.tar.gz"; then
    fail "could not download the collector's release $OLDER_VERSION to upgrade from"
    return 1
  fi
  sed -i "s/^COLLECTOR_VERSION=.*/COLLECTOR_VERSION=\"$OLDER_VERSION\"/; s/^COLLECTOR_SHA256_AMD64=.*/COLLECTOR_SHA256_AMD64=\"$(sha256sum "$WORK/older.tar.gz" | cut -d ' ' -f 1)\"/" \
    "$OLDER_RELEASE/install.sh"
  sed -i "s|otel/opentelemetry-collector-contrib:$COLLECTOR_VERSION|otel/opentelemetry-collector-contrib:$OLDER_VERSION|" \
    "$OLDER_RELEASE/docker-compose.yml"
  sed -i "s/value: \"$AGENT_VERSION\"/value: \"$OLDER_VERSION\"/" "$OLDER_RELEASE/otel-collector-config.yaml"
  if cmp -s "$AGENT_DIR/otel-collector-config.yaml" "$OLDER_RELEASE/otel-collector-config.yaml" \
    || cmp -s "$AGENT_DIR/docker-compose.yml" "$OLDER_RELEASE/docker-compose.yml" \
    || cmp -s "$AGENT_DIR/install.sh" "$OLDER_RELEASE/install.sh"; then
    fail "the older release is no different from this one"
  else
    pass "the older release is collector $OLDER_VERSION, and this one is $COLLECTOR_VERSION, agent $AGENT_VERSION"
  fi
  rm -f "$WORK/older.tar.gz"

  section "A stand-in OneUptime on $ONEUPTIME_URL"
  mkdir -p "$OUTPUT/oneuptime"
  ln -sfn "$CURRENT_RELEASE" "$WORK/served"
  ONEUPTIME_STAND_IN_KEY="$INGESTION_KEY" python3 -I "$HERE/agent-install-oneuptime.py" "$PORT" \
    "$OUTPUT/oneuptime" "$WORK/served" "$DOCS/served-files.txt" &
  STANDIN_PID=$!
  wait_for 30 "it serves the install script as plain text" \
    bash -c "curl -fsS -o /dev/null -w '%{content_type}' '$ONEUPTIME_URL/install/openstack-agent' | grep -q '^text/plain'"

  section "Level 1 as the docs make it: an account, its project, and rules fitted to this cloud"
  openstack project show "$ACCOUNT" >/dev/null 2>&1 || openstack project create --domain default "$ACCOUNT" >/dev/null
  openstack user show "$ACCOUNT" >/dev/null 2>&1 || openstack user create --domain default --password "$ACCOUNT_PASSWORD" "$ACCOUNT" >/dev/null
  openstack role add --project "$ACCOUNT" --user "$ACCOUNT" admin >/dev/null
  (cd "$WORK" \
    && curl -fsSLO "$ONEUPTIME_URL/install/openstack-agent/access/application-credential-access-rules.json" \
    && curl -fsSLO "$ONEUPTIME_URL/install/openstack-agent/access/access-rules-for-cloud.py")
  if as_account openstack catalog list -f json \
    | python3 -I "$WORK/access-rules-for-cloud.py" "$WORK/application-credential-access-rules.json" \
      >"$WORK/access-rules-for-this-cloud.json"; then
    pass "access rules fitted to this cloud's catalog"
  else
    fail "could not fit the access rules to this cloud"
    return 1
  fi
  make_credential oneuptime-agent || return 1

  # What the docs ask of a cloud for access rules, and access-matrix.sh proves.
  set_service_type /etc/nova/nova.conf compute
  set_service_type /etc/neutron/neutron.conf network
  set_service_type /etc/cinder/cinder.conf block-storage
  set_service_type /etc/glance/glance-api.conf image
  set_service_type /etc/placement/placement.conf placement
  local unit
  for unit in devstack@n-api.service devstack@q-svc.service devstack@neutron-api.service \
    devstack@c-api.service devstack@g-api.service devstack@placement-api.service; do
    if systemctl list-unit-files --no-legend "$unit" 2>/dev/null | grep -q .; then
      sudo systemctl restart "$unit"
    fi
  done
  wait_for 180 "the APIs answer again, with service_type set" \
    bash -c "openstack compute service list && openstack network agent list && openstack image list && openstack volume service list"

  # A runner leaves /opt open to anyone, and a machine a person installs on doesn't.
  sudo chmod 0755 /opt
  sudo useradd --create-home --shell /bin/bash --groups docker "$PLAIN_USER"
  PLAIN_HOME="$(getent passwd "$PLAIN_USER" | cut -d : -f 6)"
  PLAIN_UID="$(id -u "$PLAIN_USER")"
  PLAIN_GID="$(id -g "$PLAIN_USER")"
  PLAIN_DIR="$PLAIN_HOME/oneuptime-openstack-agent"
  check "$PLAIN_USER has no sudo" bash -c "! sudo -l -U '$PLAIN_USER' | grep -q 'may run'"
  check "$PLAIN_USER cannot write to /opt" bash -c "! sudo -u '$PLAIN_USER' test -w /opt"
}

# ----------------------------------------------------------------------------
# What every install has to come to
# ----------------------------------------------------------------------------
# The doctor's verdict on an agent that works: the script's own words.
doctor_is_healthy() {
  local log="$1" status="$2"
  check_equal "troubleshoot.sh exits 0" 0 "$status"
  says "$log" "The agent looks healthy and OneUptime accepts the token." \
    "Reached OneUptime and the ingestion token is VALID" \
    "0 failed check(s)"
  holds_no_secret "$log"
}

keep_logs_of_containers() {
  local name
  for name in "$AGENT_CONTAINER" "$EXPORTER_CONTAINER"; do
    docker logs "$name" >"$PHASE_DIR/$name.log" 2>&1 || true
    # Not all of it: its environment holds the ingestion key.
    docker inspect -f '{{json .HostConfig}}' "$name" >"$PHASE_DIR/$name.host-config.json" 2>/dev/null || true
  done
  docker ps -a >"$PHASE_DIR/docker-ps.txt" 2>&1 || true
}

# A phase that went wrong must cost only itself. One agent to a cloud, and these names are shared.
clear_agents() {
  sudo systemctl start devstack@n-api.service 2>/dev/null || true
  sudo systemctl disable --now "$AGENT_SERVICE" "$EXPORTER_SERVICE" >/dev/null 2>&1 || true
  sudo rm -f "/etc/systemd/system/$AGENT_SERVICE.service" "/etc/systemd/system/$EXPORTER_SERVICE.service"
  sudo systemctl daemon-reload
  docker rm -f "$AGENT_CONTAINER" "$EXPORTER_CONTAINER" >/dev/null 2>&1 || true
  docker network prune -f >/dev/null 2>&1 || true
  sudo rm -rf "$DEFAULT_DIR" "$PLAIN_DIR"
  sudo userdel "$EXPORTER_SYSTEM_USER" >/dev/null 2>&1 || true
}

keep_logs_of_services() {
  sudo journalctl -u "$AGENT_SERVICE" -u "$EXPORTER_SERVICE" --no-pager -n 2000 \
    >"$PHASE_DIR/journal.txt" 2>&1 || true
  sudo systemctl status --no-pager "$AGENT_SERVICE" "$EXPORTER_SERVICE" \
    >"$PHASE_DIR/systemctl-status.txt" 2>&1 || true
}

# What the docs say a Compose install is: read only, no capabilities, nothing published.
exporter_container_is_locked_down() {
  check_equal "the exporter's root filesystem is read only" true \
    "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$EXPORTER_CONTAINER" 2>/dev/null)"
  check_equal "the exporter holds no capabilities" "0000000000000000" \
    "$(capabilities_of "$(pid_of_container "$EXPORTER_CONTAINER")")"
  check_equal "the exporter's port is published nowhere" "map[]" \
    "$(docker inspect -f '{{.HostConfig.PortBindings}}' "$EXPORTER_CONTAINER" 2>/dev/null)"
}

summary_since() {
  asked "$1" summary | sed 's/^/  /' || true
}

# ----------------------------------------------------------------------------
# Docker, as a person with the docker group and nothing else
# ----------------------------------------------------------------------------
phase_plain_docker() {
  phase plain-docker "Docker, as a person with the docker group and no other rights"
  local log="$PHASE_DIR/install.log" status=0 started doctor="" since
  ln -sfn "$OLDER_RELEASE" "$WORK/served"

  section "The docs' commands, as written, answering each question"
  started="$(date +%s)"
  application_credential_answers "$HOSTILE_CLOUD_NAME" | as_plain "$(cat "$DOCS/install-docker.sh")" >"$log" 2>&1 || status=$?
  check_equal "the install commands exit 0" 0 "$status"
  sed 's/^/    /' "$log" | tail -40
  says "$log" "Installing to: $PLAIN_DIR" \
    "This user has no rights on /opt, so the agent goes in its home folder." \
    "Keystone accepted the credential." \
    "OneUptime OpenStack Agent is running!"
  holds_no_secret "$log"
  never_says "$log" "does not serve the agent's files"

  section "What it left behind"
  check_equal ".env is its alone" "600 $PLAIN_USER:$PLAIN_USER" "$(stat_of "$PLAIN_DIR/.env")"
  check_equal "clouds.yaml is its alone" "600 $PLAIN_USER:$PLAIN_USER" "$(stat_of "$PLAIN_DIR/clouds.yaml")"
  check "the exporter is told to run as this user" sudo grep -qx "OPENSTACK_EXPORTER_USER=$PLAIN_UID:$PLAIN_GID" "$PLAIN_DIR/.env"
  check_equal "the exporter's process runs as this user" "$PLAIN_UID" "$(uid_of_pid "$(pid_of_container "$EXPORTER_CONTAINER")")"
  exporter_container_is_locked_down
  check "the secret is in clouds.yaml, as typed" sudo grep -qF "$(python3 -I -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$APP_SECRET")" "$PLAIN_DIR/clouds.yaml"
  check "the secret is in nobody's environment" bash -c "! docker inspect '$AGENT_CONTAINER' '$EXPORTER_CONTAINER' | grep -qF -- \"\$1\"" _ "$APP_SECRET"

  section "The cloud reports, with what the older release says it is"
  wait_reports "$started" 360 openstack_nova_ openstack_neutron_ openstack_cinder_ openstack_placement_ openstack_identity_ openstack_glance_
  check_identity "$started" "$HOSTILE_CLOUD_NAME" "$OLDER_VERSION"
  summary_since "$started"

  section "Check the agent is running, as the docs say"
  status=0
  as_plain "$(sed "s|^cd $DEFAULT_DIR.*|cd $PLAIN_DIR|" "$DOCS/check-running.sh")" >"$PHASE_DIR/check-running.log" 2>&1 || status=$?
  check_equal "the docs' check commands exit 0" 0 "$status"
  says "$PHASE_DIR/check-running.log" "$AGENT_CONTAINER" "$EXPORTER_CONTAINER" "Everything is ready. Begin running and processing data."

  # The line install.sh ends on: this user has no sudo, and the agent is not in the default folder.
  doctor="$(sed -n 's/^If nothing shows up: //p' "$log")"
  if [ -z "$doctor" ]; then
    fail "install.sh did not say how to run troubleshoot.sh"
    doctor="curl -fsSL $ONEUPTIME_URL/install/openstack-agent/troubleshoot.sh | bash -s -- -d $PLAIN_DIR"
  fi
  run_plain_doctor() {
    local name="$1" status=0
    as_plain "$doctor" </dev/null >"$PHASE_DIR/doctor-$name.log" 2>&1 || status=$?
    DOCTOR_LOG="$PHASE_DIR/doctor-$name.log"
    DOCTOR_STATUS="$status"
  }

  section "troubleshoot.sh on a healthy agent, by the line install.sh ends on"
  run_plain_doctor healthy
  doctor_is_healthy "$DOCTOR_LOG" "$DOCTOR_STATUS"
  says "$DOCTOR_LOG" "Docker daemon reachable" \
    "Container '$AGENT_CONTAINER' is running" \
    "Bundled exporter '$EXPORTER_CONTAINER' is running" \
    "clouds.yaml is readable by its owner alone" \
    "Region $REGION: the exporter reads Keystone" \
    "Keystone accepted the credential" \
    "An application credential limited by access rules." \
    "That adds up to Full view" \
    "Collector config stamps the openstack.cloud.name resource attribute." \
    "Bytes are leaving the collector and the server is returning 2xx."

  section "troubleshoot.sh on a key OneUptime refuses"
  as_plain "cd '$PLAIN_DIR'; sed -i \"s/^ONEUPTIME_TELEMETRY_INGESTION_KEY=.*/ONEUPTIME_TELEMETRY_INGESTION_KEY='$BAD_INGESTION_KEY'/\" .env; docker compose up -d" \
    >"$PHASE_DIR/bad-key.log" 2>&1
  since="$(date +%s)"
  wait_for 140 "a batch with the bad key is refused" asked "$since" refused
  run_plain_doctor bad-key
  check_equal "troubleshoot.sh exits 1" 1 "$DOCTOR_STATUS"
  says "$DOCTOR_LOG" "REJECTED the token" \
    "ROOT CAUSE: the ingestion token is rejected by OneUptime." \
    "Collector reports send_failed" \
    "Exporting failed"
  holds_no_secret "$DOCTOR_LOG"
  as_plain "cd '$PLAIN_DIR'; sed -i \"s/^ONEUPTIME_TELEMETRY_INGESTION_KEY=.*/ONEUPTIME_TELEMETRY_INGESTION_KEY='$INGESTION_KEY'/\" .env; docker compose up -d" \
    >>"$PHASE_DIR/bad-key.log" 2>&1
  since="$(date +%s)"
  wait_reports "$since" 140 openstack_nova_

  section "troubleshoot.sh on a stopped exporter"
  docker stop "$EXPORTER_CONTAINER" >/dev/null
  run_plain_doctor exporter-stopped
  check_equal "troubleshoot.sh exits 1" 1 "$DOCTOR_STATUS"
  says "$DOCTOR_LOG" "Bundled exporter '$EXPORTER_CONTAINER' is NOT running" \
    "ROOT CAUSE: the collector has no OpenStack metrics to ship"
  docker start "$EXPORTER_CONTAINER" >/dev/null

  section "troubleshoot.sh on a stopped collector"
  docker stop "$AGENT_CONTAINER" >/dev/null
  run_plain_doctor collector-stopped
  check_equal "troubleshoot.sh exits 1" 1 "$DOCTOR_STATUS"
  says "$DOCTOR_LOG" "Container '$AGENT_CONTAINER' is NOT healthy" \
    "ROOT CAUSE: the agent isn't running."
  docker start "$AGENT_CONTAINER" >/dev/null
  since="$(date +%s)"
  wait_reports "$since" 140 openstack_nova_

  section "Nova's API stopped: the others keep reporting, and troubleshoot.sh says which is failing"
  sudo systemctl stop devstack@n-api.service
  since="$(date +%s)"
  wait_reports "$since" 140 openstack_neutron_ openstack_cinder_ openstack_placement_
  wait_value "$since" 240 openstack_nova_up 0.0
  wait_reports "$since" 330 openstack_identity_ openstack_glance_
  run_plain_doctor nova-stopped
  says "$DOCTOR_LOG" "compute: failing at" "Reached OneUptime and the ingestion token is VALID"
  summary_since "$since"
  sudo systemctl start devstack@n-api.service
  wait_for 120 "Nova's API answers again" openstack compute service list
  since="$(date +%s)"
  wait_value "$since" 240 openstack_nova_up 1.0

  section "A re-run with a secret Keystone refuses stops there, and leaves the agent alone"
  local clouds_before env_before exporter_before agent_before
  clouds_before="$(hash_of "$PLAIN_DIR/clouds.yaml")"
  env_before="$(hash_of "$PLAIN_DIR/.env")"
  exporter_before="$(container_id "$EXPORTER_CONTAINER")"
  agent_before="$(container_id "$AGENT_CONTAINER")"
  status=0
  as_plain "OPENSTACK_APPLICATION_CREDENTIAL_ID='$APP_ID' OPENSTACK_APPLICATION_CREDENTIAL_SECRET=not-the-secret bash install.sh" \
    </dev/null >"$PHASE_DIR/rerun-refused.log" 2>&1 || status=$?
  check_equal "it exits 1" 1 "$status"
  says "$PHASE_DIR/rerun-refused.log" "Keystone refused this credential (HTTP 401)." "Nothing was installed or changed."
  check_equal "clouds.yaml is as it was" "$clouds_before" "$(hash_of "$PLAIN_DIR/clouds.yaml")"
  check_equal ".env is as it was" "$env_before" "$(hash_of "$PLAIN_DIR/.env")"
  check_equal "the exporter was not touched" "$exporter_before" "$(container_id "$EXPORTER_CONTAINER")"
  check_equal "the collector was not touched" "$agent_before" "$(container_id "$AGENT_CONTAINER")"

  section "A credential revoked on the cloud, and put right as the docs say: move clouds.yaml aside, run it again"
  as_account openstack application credential delete oneuptime-agent >/dev/null
  run_plain_doctor credential-revoked
  check_equal "troubleshoot.sh exits 1" 1 "$DOCTOR_STATUS"
  says "$DOCTOR_LOG" "Keystone has no such application credential (HTTP 404)" \
    "ROOT CAUSE: the credential in clouds.yaml gets no token from Keystone."
  never_says "$DOCTOR_LOG" "does not answer as Keystone"
  make_credential oneuptime-agent-2 "$HOSTILE_SECRET"
  status=0
  credential_answers | as_plain "mv '$PLAIN_DIR/clouds.yaml' '$PLAIN_DIR/clouds.yaml.aside'; bash install.sh" \
    >"$PHASE_DIR/replace-credential.log" 2>&1 || status=$?
  check_equal "the re-run with a new credential exits 0" 0 "$status"
  holds_no_secret "$PHASE_DIR/replace-credential.log"
  check_equal "the new clouds.yaml is its alone" "600 $PLAIN_USER:$PLAIN_USER" "$(stat_of "$PLAIN_DIR/clouds.yaml")"
  since="$(date +%s)"
  wait_reports "$since" 140 openstack_nova_ openstack_neutron_
  run_plain_doctor credential-replaced
  doctor_is_healthy "$DOCTOR_LOG" "$DOCTOR_STATUS"
  as_plain "rm -f '$PLAIN_DIR/clouds.yaml.aside'" </dev/null

  section "A re-run upgrades it: the docs' commands, with nothing to answer"
  # The docs tell people to edit this file, so an upgrade must not lose the edit silently.
  as_plain "sed -i '0,/scrape_interval: 300s/s//scrape_interval: 301s/' '$PLAIN_DIR/otel-collector-config.yaml'" </dev/null
  ln -sfn "$CURRENT_RELEASE" "$WORK/served"
  clouds_before="$(hash_of "$PLAIN_DIR/clouds.yaml")"
  env_before="$(hash_of "$PLAIN_DIR/.env")"
  exporter_before="$(container_id "$EXPORTER_CONTAINER")"
  agent_before="$(container_id "$AGENT_CONTAINER")"
  status=0
  as_plain "$(cat "$DOCS/upgrade.sh")" </dev/null >"$PHASE_DIR/upgrade.log" 2>&1 || status=$?
  # From the next second: the old collector's last batch can land in this one as it stops.
  since="$(($(date +%s) + 1))"
  check_equal "the upgrade asks nothing, and exits 0" 0 "$status"
  says "$PHASE_DIR/upgrade.log" "Found an existing configuration" "you had edited these files"
  check_equal "the answers in .env are kept" "$env_before" "$(hash_of "$PLAIN_DIR/.env")"
  check_equal "the credential in clouds.yaml is kept" "$clouds_before" "$(hash_of "$PLAIN_DIR/clouds.yaml")"
  check "the config is this release's" sudo cmp -s "$AGENT_DIR/otel-collector-config.yaml" "$PLAIN_DIR/otel-collector-config.yaml"
  check "the compose file is this release's" sudo cmp -s "$AGENT_DIR/docker-compose.yml" "$PLAIN_DIR/docker-compose.yml"
  check "the edit is kept beside it" sudo bash -c "grep -l 'scrape_interval: 301s' '$PLAIN_DIR'/otel-collector-config.yaml.bak.*"
  check "the collector was recreated" test "$agent_before" != "$(container_id "$AGENT_CONTAINER")"
  check "the exporter was recreated" test "$exporter_before" != "$(container_id "$EXPORTER_CONTAINER")"
  check_equal "the collector runs this release's image" "otel/opentelemetry-collector-contrib:$COLLECTOR_VERSION" \
    "$(docker inspect -f '{{.Config.Image}}' "$AGENT_CONTAINER" 2>/dev/null)"
  check_equal "the exporter still runs as this user" "$PLAIN_UID" "$(uid_of_pid "$(pid_of_container "$EXPORTER_CONTAINER")")"
  wait_reports "$since" 140 openstack_nova_ openstack_neutron_
  check_identity "$since" "$HOSTILE_CLOUD_NAME" "$AGENT_VERSION"

  keep_logs_of_containers

  section "Uninstall: the docs' commands, in the folder it used, with no sudo"
  status=0
  as_plain "$(sed "s|$DEFAULT_DIR|$PLAIN_DIR|g; s|^sudo ||" "$DOCS/uninstall-docker.sh")" </dev/null \
    >"$PHASE_DIR/uninstall.log" 2>&1 || status=$?
  check_equal "the uninstall commands exit 0" 0 "$status"
  check "the containers are gone" bash -c "! docker inspect '$AGENT_CONTAINER' '$EXPORTER_CONTAINER'"
  check "the folder is gone" bash -c "! sudo test -e '$PLAIN_DIR'"
}

# ----------------------------------------------------------------------------
# Docker, with sudo: the uid 65532 path, and the docs' systemd unit
# ----------------------------------------------------------------------------
phase_root_docker() {
  phase root-docker "Docker with sudo: uid 65532 reads a clouds.yaml of mode 0600, under a root umask of 077"
  local log="$PHASE_DIR/install.log" status=0 started since folder clouds_before
  ln -sfn "$CURRENT_RELEASE" "$WORK/served"
  folder="$(mktemp -d)"
  started="$(date +%s)"
  application_credential_answers "uid-65532" \
    | timeout 900 sudo bash -euo pipefail -c "umask 077; cd '$folder'; $(cat "$DOCS/install-docker.sh")" \
      >"$log" 2>&1 || status=$?
  check_equal "the install commands exit 0, under sudo" 0 "$status"
  sed 's/^/    /' "$log" | tail -25
  says "$log" "Installing to: $DEFAULT_DIR"
  holds_no_secret "$log"

  section "uid 65532 owns the credential, and reads it"
  check_equal "clouds.yaml is mode 0600, uid 65532's" "600 65532:65532" "$(sudo stat -c '%a %u:%g' "$DEFAULT_DIR/clouds.yaml")"
  check_equal ".env is root's alone" "600 root:root" "$(stat_of "$DEFAULT_DIR/.env")"
  check "the exporter is told to run as 65532" sudo grep -qx "OPENSTACK_EXPORTER_USER=65532:65532" "$DEFAULT_DIR/.env"
  check_equal "the exporter's container says 65532" "65532:65532" "$(docker inspect -f '{{.Config.User}}' "$EXPORTER_CONTAINER" 2>/dev/null)"
  check_equal "the exporter's process runs as 65532, on this machine's own process table" "65532" "$(uid_of_pid "$(pid_of_container "$EXPORTER_CONTAINER")")"
  exporter_container_is_locked_down
  wait_reports "$started" 140 openstack_nova_ openstack_neutron_ openstack_cinder_ openstack_placement_
  check_identity "$started" "uid-65532" "$AGENT_VERSION"

  section "troubleshoot.sh, as the docs say, with sudo"
  status=0
  (cd "$folder" && bash -euo pipefail -c "$(cat "$DOCS/troubleshoot.sh")") </dev/null >"$PHASE_DIR/doctor-healthy.log" 2>&1 || status=$?
  doctor_is_healthy "$PHASE_DIR/doctor-healthy.log" "$status"
  says "$PHASE_DIR/doctor-healthy.log" "clouds.yaml is readable by its owner alone" "That adds up to Full view"
  never_says "$PHASE_DIR/doctor-healthy.log" "so the exporter cannot read it"

  section "troubleshoot.sh without sudo says to use it, rather than that the credential isn't there"
  note "the agent's folder, installed under a root umask of 077: $(stat_of "$DEFAULT_DIR")"
  as_plain "curl -fsSL '$ONEUPTIME_URL/install/openstack-agent/troubleshoot.sh' | bash -s -- -d '$DEFAULT_DIR'" </dev/null \
    >"$PHASE_DIR/doctor-no-sudo.log" 2>&1 || true
  says "$PHASE_DIR/doctor-no-sudo.log" "Run this with sudo"
  never_says "$PHASE_DIR/doctor-no-sudo.log" "does not exist"

  section "A re-run that names a region this cloud lacks stops there"
  status=0
  sudo env OPENSTACK_EXPORTER_CLOUDS="$REGION,RegionTwo" bash "$folder/install.sh" </dev/null >"$PHASE_DIR/rerun-region.log" 2>&1 || status=$?
  check_equal "it exits 1" 1 "$status"
  says "$PHASE_DIR/rerun-region.log" "this cloud's service catalog has no region \"RegionTwo\"" "Nothing was installed or changed."

  section "The docs' systemd unit: enabled, and it starts, stops and comes back"
  status=0
  (cd "$folder" && bash -euo pipefail -c "$(cat "$DOCS/systemd-unit.sh")") </dev/null >"$PHASE_DIR/systemd-unit.log" 2>&1 || status=$?
  check_equal "the docs' commands exit 0" 0 "$status"
  check "the unit is the shipped file" sudo cmp -s "$AGENT_DIR/systemd/$AGENT_SERVICE.service" "/etc/systemd/system/$AGENT_SERVICE.service"
  check "systemd-analyze verify finds nothing wrong with it" bash -c "! systemd-analyze verify '/etc/systemd/system/$AGENT_SERVICE.service' 2>&1 | grep -F '$AGENT_SERVICE'"
  wait_for 180 "the unit is active" systemctl is-active --quiet "$AGENT_SERVICE"
  check "the unit starts on boot" systemctl is-enabled --quiet "$AGENT_SERVICE"
  wait_for 60 "the collector and the exporter run under it" bash -c "$(declare -f container_is_running); container_is_running '$AGENT_CONTAINER' && container_is_running '$EXPORTER_CONTAINER'"
  sudo systemctl stop "$AGENT_SERVICE"
  wait_for 60 "stopping the unit stops the containers" bash -c "$(declare -f container_is_gone); container_is_gone '$AGENT_CONTAINER' && container_is_gone '$EXPORTER_CONTAINER'"
  sudo systemctl start "$AGENT_SERVICE"
  since="$(date +%s)"
  wait_for 180 "starting the unit starts them again" bash -c "$(declare -f container_is_running); container_is_running '$AGENT_CONTAINER' && container_is_running '$EXPORTER_CONTAINER'"
  wait_reports "$since" 140 openstack_nova_

  section "The unit comes back after it is killed, and Docker brings back a collector that dies"
  local restarts_before pid
  restarts_before="$(systemctl show -p NRestarts --value "$AGENT_SERVICE")"
  sudo systemctl kill -s KILL "$AGENT_SERVICE"
  wait_for 180 "systemd restarted the unit" bash -c "[ \"\$(systemctl show -p NRestarts --value '$AGENT_SERVICE')\" -gt '$restarts_before' ] && systemctl is-active --quiet '$AGENT_SERVICE'"
  wait_for 180 "the containers are running under it again" bash -c "$(declare -f container_is_running); container_is_running '$AGENT_CONTAINER' && container_is_running '$EXPORTER_CONTAINER'"
  check_equal "the exporter still runs as 65532" "65532" "$(uid_of_pid "$(pid_of_container "$EXPORTER_CONTAINER")")"
  restarts_before="$(docker inspect -f '{{.RestartCount}}' "$AGENT_CONTAINER" 2>/dev/null)"
  pid="$(pid_of_container "$AGENT_CONTAINER")"
  sudo kill -9 "$pid"
  wait_for 60 "Docker restarted the collector" bash -c "[ \"\$(docker inspect -f '{{.RestartCount}}' '$AGENT_CONTAINER')\" -gt '$restarts_before' ] && [ \"\$(docker inspect -f '{{.State.Running}}' '$AGENT_CONTAINER')\" = true ]"
  since="$(date +%s)"
  wait_reports "$since" 140 openstack_nova_ openstack_neutron_

  section "clouds.yaml given to root locks uid 65532 out, troubleshoot.sh says so, and a re-run puts it right"
  sudo chown root:root "$DEFAULT_DIR/clouds.yaml"
  docker restart "$EXPORTER_CONTAINER" >/dev/null
  sleep 5
  status=0
  (cd "$folder" && sudo bash troubleshoot.sh) </dev/null >"$PHASE_DIR/doctor-root-owns-clouds.log" 2>&1 || status=$?
  check_equal "troubleshoot.sh exits 1" 1 "$status"
  says "$PHASE_DIR/doctor-root-owns-clouds.log" "The exporter runs as uid 65532, and clouds.yaml belongs to uid 0, so the exporter cannot read it."
  status=0
  sudo bash "$folder/install.sh" </dev/null >"$PHASE_DIR/rerun-owner.log" 2>&1 || status=$?
  since="$(date +%s)"
  check_equal "the re-run exits 0" 0 "$status"
  check_equal "clouds.yaml is uid 65532's again" "600 65532:65532" "$(sudo stat -c '%a %u:%g' "$DEFAULT_DIR/clouds.yaml")"
  wait_reports "$since" 140 openstack_nova_
  wait_for 120 "the systemd unit is still active after a re-run recreated what it runs" systemctl is-active --quiet "$AGENT_SERVICE"

  section "A credential replaced by exporting it: the old file is kept, as private as it was"
  clouds_before="$(hash_of "$DEFAULT_DIR/clouds.yaml")"
  make_credential oneuptime-agent-3
  status=0
  sudo env OPENSTACK_APPLICATION_CREDENTIAL_ID="$APP_ID" OPENSTACK_APPLICATION_CREDENTIAL_SECRET="$APP_SECRET" \
    bash "$folder/install.sh" </dev/null >"$PHASE_DIR/rerun-credential.log" 2>&1 || status=$?
  since="$(date +%s)"
  check_equal "the re-run exits 0" 0 "$status"
  says "$PHASE_DIR/rerun-credential.log" "clouds.yaml changed. The old one is kept as"
  holds_no_secret "$PHASE_DIR/rerun-credential.log"
  check "clouds.yaml changed" test "$clouds_before" != "$(hash_of "$DEFAULT_DIR/clouds.yaml")"
  check_equal "the old file is as private as it was" "600 65532:65532" \
    "$(sudo bash -c "stat -c '%a %u:%g' '$DEFAULT_DIR'/clouds.yaml.bak.*")"
  wait_reports "$since" 140 openstack_nova_

  keep_logs_of_containers

  section "Uninstall: the docs' commands"
  status=0
  (cd "$folder" && bash -euo pipefail -c "$(cat "$DOCS/uninstall-systemd-unit.sh")") </dev/null >"$PHASE_DIR/uninstall.log" 2>&1 || status=$?
  check_equal "taking the unit away exits 0" 0 "$status"
  status=0
  sudo bash -euo pipefail -c "$(cat "$DOCS/uninstall-docker.sh")" </dev/null >>"$PHASE_DIR/uninstall.log" 2>&1 || status=$?
  check_equal "the uninstall commands exit 0" 0 "$status"
  check "the unit is gone" bash -c "! test -e '/etc/systemd/system/$AGENT_SERVICE.service'"
  check "the containers are gone" bash -c "! docker inspect '$AGENT_CONTAINER' '$EXPORTER_CONTAINER'"
  check "the folder is gone" bash -c "! sudo test -e '$DEFAULT_DIR'"
  sudo rm -rf "$folder"
}

# ----------------------------------------------------------------------------
# Without Docker, on this machine's own systemd
# ----------------------------------------------------------------------------
phase_without_docker() {
  phase without-docker "The pinned releases past their digest check, run by systemd"
  local log="$PHASE_DIR/install.log" status=0 started since folder pid collector_uid clouds_before env_before exporter_pid collector_pid
  ln -sfn "$OLDER_RELEASE" "$WORK/served"
  folder="$(mktemp -d)"

  section "Another collector already holds the port a collector takes by default"
  python3 -I -m http.server 8888 --bind 127.0.0.1 --directory "$WORK/docs" >/dev/null 2>&1 &
  HOLDER_PID=$!

  section "The docs' commands, as written, under a umask of 077: no to an application credential"
  started="$(date +%s)"
  password_answers "$HOSTILE_CLOUD_NAME" \
    | timeout 900 bash -euo pipefail -c "umask 077; cd '$folder'; $(cat "$DOCS/install-without-docker.sh")" \
      >"$log" 2>&1 || status=$?
  check_equal "the install commands exit 0" 0 "$status"
  sed 's/^/    /' "$log" | tail -25
  says "$log" "Keystone accepted the credential." "OneUptime OpenStack Agent is running!"
  holds_no_secret "$log"

  section "The binaries past their digest check, and what it left behind"
  sudo "$DEFAULT_DIR/otelcol-contrib" --version >"$PHASE_DIR/versions.txt" 2>&1 || fail "the collector's binary does not run"
  sudo "$DEFAULT_DIR/openstack-exporter" --version >>"$PHASE_DIR/versions.txt" 2>&1 || fail "the exporter's binary does not run"
  says "$PHASE_DIR/versions.txt" "$OLDER_VERSION" "2.0.0"
  check_equal "the collector's binary" "755 root:root" "$(stat_of "$DEFAULT_DIR/otelcol-contrib")"
  check_equal "the exporter's binary" "755 root:root" "$(stat_of "$DEFAULT_DIR/openstack-exporter")"
  check_equal "the config, for a user that holds nothing" "644 root:root" "$(stat_of "$DEFAULT_DIR/otel-collector-config.yaml")"
  check_equal ".env is root's alone" "600 root:root" "$(stat_of "$DEFAULT_DIR/.env")"
  check_equal "clouds.yaml is the exporter's user's alone" "600 $EXPORTER_SYSTEM_USER:$EXPORTER_SYSTEM_USER" "$(stat_of "$DEFAULT_DIR/clouds.yaml")"
  check_equal "the folder can be walked through" "755 root:root" "$(stat_of "$DEFAULT_DIR")"

  section "The units, on this machine's systemd"
  check "the collector's unit is the shipped file" sudo cmp -s "$OLDER_RELEASE/systemd/$AGENT_SERVICE-native.service" "/etc/systemd/system/$AGENT_SERVICE.service"
  check "the exporter's unit is the shipped file" sudo cmp -s "$OLDER_RELEASE/systemd/$EXPORTER_SERVICE-native.service" "/etc/systemd/system/$EXPORTER_SERVICE.service"
  systemd-analyze verify "/etc/systemd/system/$AGENT_SERVICE.service" "/etc/systemd/system/$EXPORTER_SERVICE.service" >"$PHASE_DIR/systemd-analyze-verify.txt" 2>&1
  check "systemd-analyze verify finds nothing wrong with them" bash -c "! grep -F oneuptime-openstack '$PHASE_DIR/systemd-analyze-verify.txt'"
  sudo systemd-analyze security "$AGENT_SERVICE" "$EXPORTER_SERVICE" --no-pager >"$PHASE_DIR/systemd-analyze-security.txt" 2>&1 || true
  check "the collector starts on boot" systemctl is-enabled --quiet "$AGENT_SERVICE"
  check "the exporter starts on boot" systemctl is-enabled --quiet "$EXPORTER_SERVICE"
  wait_for 60 "the collector's service is active" systemctl is-active --quiet "$AGENT_SERVICE"
  wait_for 60 "the exporter's service is active" systemctl is-active --quiet "$EXPORTER_SERVICE"
  wait_for 60 "the collector started" bash -c "sudo journalctl -u '$AGENT_SERVICE' --no-pager | grep -q 'Everything is ready. Begin running and processing data.'"

  section "Who they run as, and what each can see"
  exporter_pid="$(main_pid "$EXPORTER_SERVICE")"
  collector_pid="$(main_pid "$AGENT_SERVICE")"
  check_equal "the exporter's user" "$EXPORTER_SYSTEM_USER" "$(user_of_pid "$exporter_pid")"
  collector_uid="$(uid_of_pid "$collector_pid")"
  if [ -n "$collector_uid" ] && [ "$collector_uid" -ge 61184 ] && [ "$collector_uid" -le 65519 ]; then
    pass "the collector runs as a throwaway user (uid $collector_uid)"
  else
    fail "the collector runs as uid '$collector_uid', not a throwaway user"
  fi
  check_equal "the exporter holds no capabilities" "0000000000000000" "$(capabilities_of "$exporter_pid")"
  check_equal "the collector holds no capabilities" "0000000000000000" "$(capabilities_of "$collector_pid")"
  check "the collector's process has the key it sends" sudo grep -qaF "$INGESTION_KEY" "/proc/$collector_pid/environ"
  check "the collector never sees the credential" bash -c "! sudo grep -qaF \"\$1\" '/proc/$collector_pid/environ'" _ "$ACCOUNT_PASSWORD"
  check "the exporter never sees the ingestion key" bash -c "! sudo grep -qaF '$INGESTION_KEY' '/proc/$exporter_pid/environ'"
  check "no secret is on any command line" bash -c "! ps -eo args | grep -F -e \"\$1\" -e '$INGESTION_KEY' | grep -v grep" _ "$ACCOUNT_PASSWORD"
  sudo ss -ltnp >"$PHASE_DIR/listening.txt" 2>&1
  says "$PHASE_DIR/listening.txt" "127.0.0.1:9180" "127.0.0.1:8891" "127.0.0.1:8888"
  never_says "$PHASE_DIR/listening.txt" "0.0.0.0:9180" "*:9180" "0.0.0.0:8891" "*:8891"

  section "The cloud reports: the password reached Keystone as typed, and the name reached OneUptime"
  wait_reports "$started" 360 openstack_nova_ openstack_neutron_ openstack_cinder_ openstack_placement_ openstack_identity_ openstack_glance_
  check_identity "$started" "$HOSTILE_CLOUD_NAME" "$OLDER_VERSION"
  summary_since "$started"

  section "troubleshoot.sh, as the docs say, on a healthy agent"
  status=0
  (cd "$folder" && bash -euo pipefail -c "$(cat "$DOCS/troubleshoot.sh")") </dev/null >"$PHASE_DIR/doctor-healthy.log" 2>&1 || status=$?
  doctor_is_healthy "$PHASE_DIR/doctor-healthy.log" "$status"
  says "$PHASE_DIR/doctor-healthy.log" "holds the agent without Docker" \
    "Service '$AGENT_SERVICE' is active" \
    "Service '$EXPORTER_SERVICE' is active" \
    "clouds.yaml is readable by its owner alone" \
    "This is a username and password." \
    "That adds up to Full view"

  section "systemd brings each back after a kill, and a restart reports again"
  sudo kill -9 "$exporter_pid"
  wait_for 60 "the exporter came back, as a new process" bash -c "[ \"\$(systemctl show -p MainPID --value '$EXPORTER_SERVICE')\" != '$exporter_pid' ] && systemctl is-active --quiet '$EXPORTER_SERVICE'"
  sudo kill -9 "$collector_pid"
  wait_for 60 "the collector came back, as a new process" bash -c "[ \"\$(systemctl show -p MainPID --value '$AGENT_SERVICE')\" != '$collector_pid' ] && systemctl is-active --quiet '$AGENT_SERVICE'"
  since="$(date +%s)"
  wait_reports "$since" 140 openstack_nova_
  sudo systemctl restart "$EXPORTER_SERVICE" "$AGENT_SERVICE"
  since="$(date +%s)"
  wait_reports "$since" 140 openstack_neutron_

  section "troubleshoot.sh on a stopped exporter"
  sudo systemctl stop "$EXPORTER_SERVICE"
  status=0
  (cd "$folder" && sudo bash troubleshoot.sh) </dev/null >"$PHASE_DIR/doctor-exporter-stopped.log" 2>&1 || status=$?
  check_equal "troubleshoot.sh exits 1" 1 "$status"
  says "$PHASE_DIR/doctor-exporter-stopped.log" "Service '$EXPORTER_SERVICE' is NOT active" \
    "ROOT CAUSE: the collector has no OpenStack metrics to ship"
  sudo systemctl start "$EXPORTER_SERVICE"

  section "troubleshoot.sh on a key OneUptime refuses"
  sudo sed -i "s/^ONEUPTIME_TELEMETRY_INGESTION_KEY=.*/ONEUPTIME_TELEMETRY_INGESTION_KEY=\"$BAD_INGESTION_KEY\"/" "$DEFAULT_DIR/.env"
  sudo systemctl restart "$AGENT_SERVICE"
  since="$(date +%s)"
  wait_for 140 "a batch with the bad key is refused" asked "$since" refused
  status=0
  (cd "$folder" && sudo bash troubleshoot.sh) </dev/null >"$PHASE_DIR/doctor-bad-key.log" 2>&1 || status=$?
  check_equal "troubleshoot.sh exits 1" 1 "$status"
  says "$PHASE_DIR/doctor-bad-key.log" "REJECTED the token" "ROOT CAUSE: the ingestion token is rejected by OneUptime." "Exporting failed"
  sudo sed -i "s/^ONEUPTIME_TELEMETRY_INGESTION_KEY=.*/ONEUPTIME_TELEMETRY_INGESTION_KEY=\"$INGESTION_KEY\"/" "$DEFAULT_DIR/.env"
  sudo systemctl restart "$AGENT_SERVICE"

  section "troubleshoot.sh on a setting the collector refuses to start with"
  sudo sed -i 's/^OPENSTACK_EXPORTER_CLOUDS=.*/OPENSTACK_EXPORTER_CLOUDS=RegionOne/' "$DEFAULT_DIR/.env"
  sudo systemctl restart "$AGENT_SERVICE"
  sleep 5
  status=0
  (cd "$folder" && sudo bash troubleshoot.sh) </dev/null >"$PHASE_DIR/doctor-bad-list.log" 2>&1 || status=$?
  check_equal "troubleshoot.sh exits 1" 1 "$status"
  says "$PHASE_DIR/doctor-bad-list.log" "Service '$AGENT_SERVICE' is NOT active" \
    "not a list in square brackets" \
    "ROOT CAUSE: the agent isn't running."
  sudo sed -i "s/^OPENSTACK_EXPORTER_CLOUDS=.*/OPENSTACK_EXPORTER_CLOUDS=\"[$REGION]\"/" "$DEFAULT_DIR/.env"
  sudo systemctl restart "$AGENT_SERVICE"
  since="$(date +%s)"
  wait_reports "$since" 140 openstack_nova_

  section "A re-run upgrades it: the docs' commands under sudo, with nothing to answer, and a new binary"
  sudo sed -i '0,/scrape_interval: 300s/s//scrape_interval: 301s/' "$DEFAULT_DIR/otel-collector-config.yaml"
  ln -sfn "$CURRENT_RELEASE" "$WORK/served"
  clouds_before="$(hash_of "$DEFAULT_DIR/clouds.yaml")"
  env_before="$(hash_of "$DEFAULT_DIR/.env")"
  exporter_pid="$(main_pid "$EXPORTER_SERVICE")"
  collector_pid="$(main_pid "$AGENT_SERVICE")"
  status=0
  (cd "$folder" && sudo bash -euo pipefail -c "$(cat "$DOCS/upgrade.sh")") </dev/null >"$PHASE_DIR/upgrade.log" 2>&1 || status=$?
  # From the next second: the old collector's last batch can land in this one as it stops.
  since="$(($(date +%s) + 1))"
  check_equal "the upgrade asks nothing, and exits 0" 0 "$status"
  says "$PHASE_DIR/upgrade.log" "Found an existing configuration" "you had edited these files"
  sudo "$DEFAULT_DIR/otelcol-contrib" --version >"$PHASE_DIR/versions-after.txt" 2>&1
  says "$PHASE_DIR/versions-after.txt" "$COLLECTOR_VERSION"
  check_equal "the answers in .env are kept" "$env_before" "$(hash_of "$DEFAULT_DIR/.env")"
  check_equal "the credential in clouds.yaml is kept" "$clouds_before" "$(hash_of "$DEFAULT_DIR/clouds.yaml")"
  check "the config is this release's" sudo cmp -s "$AGENT_DIR/otel-collector-config.yaml" "$DEFAULT_DIR/otel-collector-config.yaml"
  check "the edit is kept beside it" sudo bash -c "grep -l 'scrape_interval: 301s' '$DEFAULT_DIR'/otel-collector-config.yaml.bak.*"
  check "the collector is a new process" test "$collector_pid" != "$(main_pid "$AGENT_SERVICE")"
  check "the exporter is a new process" test "$exporter_pid" != "$(main_pid "$EXPORTER_SERVICE")"
  wait_reports "$since" 140 openstack_nova_ openstack_neutron_
  check_identity "$since" "$HOSTILE_CLOUD_NAME" "$AGENT_VERSION"

  keep_logs_of_services

  section "Uninstall: the docs' commands"
  status=0
  (cd "$folder" && bash -euo pipefail -c "$(cat "$DOCS/uninstall-without-docker.sh")") </dev/null >"$PHASE_DIR/uninstall.log" 2>&1 || status=$?
  check_equal "the uninstall commands exit 0" 0 "$status"
  check "the services are gone" bash -c "! systemctl is-active --quiet '$AGENT_SERVICE' && ! systemctl is-active --quiet '$EXPORTER_SERVICE'"
  check "the units are gone" bash -c "! test -e '/etc/systemd/system/$AGENT_SERVICE.service' && ! test -e '/etc/systemd/system/$EXPORTER_SERVICE.service'"
  check "the folder is gone" bash -c "! sudo test -e '$DEFAULT_DIR'"
  check "the exporter's user is gone" bash -c "! id '$EXPORTER_SYSTEM_USER'"
  check "nothing listens on 9180 or 8891" bash -c "! sudo ss -ltn | grep -E ':(9180|8891) '"
  kill "$HOLDER_PID" 2>/dev/null
  HOLDER_PID=""
  sudo rm -rf "$folder"
}

# ----------------------------------------------------------------------------
# On a machine with nothing on it
# ----------------------------------------------------------------------------
# start_clean_machine <name> <image> <Dockerfile's RUN> <docker run's options...>
start_clean_machine() {
  local name="$1" image="$2" install="$3" tag="oneuptime-openstack-agent-install-$1"
  shift 3
  if ! docker build -q -t "$tag" - >"$PHASE_DIR/image.log" 2>&1 <<DOCKERFILE; then
FROM $image
RUN $install
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
DOCKERFILE
    cat "$PHASE_DIR/image.log"
    fail "could not build the clean machine from $image"
    return 1
  fi
  if ! docker run -d --name "$name" "$@" "$tag" >/dev/null; then
    fail "could not start the clean machine"
    return 1
  fi
  wait_for 90 "systemd is up" docker exec "$name" bash -c \
    'state=$(systemctl is-system-running 2>/dev/null); [ "$state" = running ] || [ "$state" = degraded ]'
  docker exec "$name" systemctl --version 2>/dev/null | head -1 >"$PHASE_DIR/systemd-version.txt"
  note "$(cat "$PHASE_DIR/systemd-version.txt")"
}

keep_machine_logs() {
  local name="$1"
  docker exec "$name" bash -c "journalctl --no-pager -n 3000" >"$PHASE_DIR/journal.txt" 2>&1 || true
  docker rm -f "$name" >/dev/null 2>&1 || true
}

# clean_without_docker <machine> <image> <RUN>: as a sudo user, as the docs say.
clean_without_docker() {
  local machine="$1" image="$2" install="$3" log="$PHASE_DIR/install.log" status=0 started
  start_clean_machine "$machine" "$image" "$install" \
    --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock || return 0
  as_tester() { docker exec -i -u tester -w /home/tester "$machine" bash -euo pipefail -c "$1"; }

  started="$(date +%s)"
  application_credential_answers "$machine" | as_tester "umask 077; $(cat "$DOCS/install-without-docker.sh")" >"$log" 2>&1 || status=$?
  check_equal "the docs' commands exit 0 on a machine with nothing on it" 0 "$status"
  sed 's/^/    /' "$log" | tail -25
  says "$log" "Keystone accepted the credential." "OneUptime OpenStack Agent is running!"
  holds_no_secret "$log"
  wait_for 60 "the collector's service is active" docker exec "$machine" systemctl is-active --quiet "$AGENT_SERVICE"
  wait_for 60 "the exporter's service is active" docker exec "$machine" systemctl is-active --quiet "$EXPORTER_SERVICE"
  wait_reports "$started" 140 openstack_nova_ openstack_neutron_ openstack_cinder_ openstack_placement_
  check_identity "$started" "$machine" "$AGENT_VERSION"

  section "troubleshoot.sh, as the docs say, with no jq or python here to lean on"
  status=0
  as_tester "$(cat "$DOCS/troubleshoot.sh")" </dev/null >"$PHASE_DIR/doctor-healthy.log" 2>&1 || status=$?
  doctor_is_healthy "$PHASE_DIR/doctor-healthy.log" "$status"
  says "$PHASE_DIR/doctor-healthy.log" "holds the agent without Docker" "An application credential limited by access rules." "That adds up to Full view"

  section "A re-run asks nothing, and the services come back"
  status=0
  as_tester "$(sed 's/^bash install.sh/sudo bash install.sh/' "$DOCS/upgrade.sh")" </dev/null >"$PHASE_DIR/upgrade.log" 2>&1 || status=$?
  local since
  since="$(date +%s)"
  check_equal "the re-run exits 0" 0 "$status"
  wait_reports "$since" 140 openstack_nova_

  section "Uninstall: the docs' commands"
  status=0
  as_tester "$(cat "$DOCS/uninstall-without-docker.sh")" </dev/null >"$PHASE_DIR/uninstall.log" 2>&1 || status=$?
  check_equal "the uninstall commands exit 0" 0 "$status"
  check "the folder is gone" docker exec "$machine" bash -c "! test -e '$DEFAULT_DIR'"
  keep_machine_logs "$machine"
}

phase_clean_ubuntu() {
  phase clean-ubuntu "Without Docker on Ubuntu 24.04, with nothing on it but systemd, curl and sudo"
  clean_without_docker clean-ubuntu public.ecr.aws/docker/library/ubuntu:24.04 \
    "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends systemd systemd-sysv dbus sudo curl ca-certificates && rm -rf /var/lib/apt/lists/* && useradd -m tester && echo 'tester ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/tester && chmod 0440 /etc/sudoers.d/tester"
}

ROCKY_MACHINE="dnf install -y systemd sudo tar gzip procps-ng diffutils shadow-utils ca-certificates && (command -v curl >/dev/null || dnf install -y curl-minimal || dnf install -y curl) && dnf clean all && systemctl mask dnf-makecache.timer dnf-makecache.service && useradd -m tester && echo 'tester ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/tester && chmod 0440 /etc/sudoers.d/tester"

phase_clean_rocky() {
  phase clean-rocky "Without Docker on Rocky 9, the oldest of its family whose glibc the exporter's release runs on"
  clean_without_docker clean-rocky public.ecr.aws/docker/library/rockylinux:9 "$ROCKY_MACHINE"
}

# Recorded on Rocky 8: the exporter's release asks for GLIBC_2.32 and GLIBC_2.34, and exits.
phase_old_glibc() {
  phase old-glibc "Without Docker on Rocky 8, whose glibc the exporter's release can't run on"
  local machine=old-glibc log="$PHASE_DIR/install.log" status=0
  start_clean_machine "$machine" public.ecr.aws/docker/library/rockylinux:8 "$ROCKY_MACHINE" \
    --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock || return 0
  application_credential_answers "$machine" \
    | docker exec -i -u tester -w /home/tester "$machine" bash -euo pipefail -c "$(cat "$DOCS/install-without-docker.sh")" \
      >"$log" 2>&1 || status=$?
  check_equal "the install stops" 1 "$status"
  sed 's/^/    /' "$log" | tail -12
  says "$log" "the openstack-exporter release does not run on this machine, so nothing was installed or changed" \
    "It needs glibc 2.34 or later" \
    "install with Docker instead"
  holds_no_secret "$log"
  check "no service was left restarting" docker exec "$machine" bash -c "! systemctl is-active --quiet '$EXPORTER_SERVICE' && ! test -e '/etc/systemd/system/$EXPORTER_SERVICE.service'"
  check "no credential was written" docker exec "$machine" bash -c "! test -e '$DEFAULT_DIR/clouds.yaml' && ! test -e '$DEFAULT_DIR/.env'"
  keep_machine_logs "$machine"
}

# Docker in a machine of its own, started the way kind starts its nodes.
phase_clean_docker() {
  phase clean-docker "With Docker on Ubuntu 24.04: a person with only the docker group, on a machine with nothing else"
  local machine=clean-docker log="$PHASE_DIR/install.log" status=0 started doctor=""
  start_clean_machine "$machine" public.ecr.aws/docker/library/ubuntu:24.04 \
    "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends systemd systemd-sysv dbus curl ca-certificates iptables docker.io docker-compose-v2 && rm -rf /var/lib/apt/lists/* && systemctl enable docker && useradd -m -G docker tester" \
    --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock --tmpfs /tmp \
    -v /var/lib/docker -v /var/lib/containerd -v /lib/modules:/lib/modules:ro || return 0
  as_tester() { docker exec -i -u tester -w /home/tester "$machine" bash -euo pipefail -c "$1"; }
  if ! wait_for 120 "Docker runs on it" docker exec "$machine" docker info; then
    docker exec "$machine" bash -c "systemctl status docker --no-pager; journalctl -u docker --no-pager -n 100" >"$PHASE_DIR/docker-in-machine.txt" 2>&1 || true
    keep_machine_logs "$machine"
    return 0
  fi

  started="$(date +%s)"
  application_credential_answers "$machine" | as_tester "$(cat "$DOCS/install-docker.sh")" >"$log" 2>&1 || status=$?
  check_equal "the docs' commands exit 0 on a machine with nothing on it" 0 "$status"
  sed 's/^/    /' "$log" | tail -25
  says "$log" "Installing to: /home/tester/oneuptime-openstack-agent" "Keystone accepted the credential." "OneUptime OpenStack Agent is running!"
  holds_no_secret "$log"
  wait_reports "$started" 180 openstack_nova_ openstack_neutron_ openstack_cinder_ openstack_placement_
  check_identity "$started" "$machine" "$AGENT_VERSION"

  section "troubleshoot.sh, by the line install.sh ends on"
  doctor="$(sed -n 's/^If nothing shows up: //p' "$log")"
  status=0
  as_tester "$doctor" </dev/null >"$PHASE_DIR/doctor-healthy.log" 2>&1 || status=$?
  doctor_is_healthy "$PHASE_DIR/doctor-healthy.log" "$status"
  says "$PHASE_DIR/doctor-healthy.log" "Docker daemon reachable" "An application credential limited by access rules." "That adds up to Full view"
  keep_machine_logs "$machine"
}

# ----------------------------------------------------------------------------
# Run it
# ----------------------------------------------------------------------------
wants() { case " $PHASES " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

if prepare_cloud; then
  wants plain-docker && phase_plain_docker
  clear_agents
  wants root-docker && phase_root_docker
  clear_agents
  wants without-docker && phase_without_docker
  clear_agents
  wants clean-ubuntu && phase_clean_ubuntu
  wants clean-rocky && phase_clean_rocky
  wants old-glibc && phase_old_glibc
  wants clean-docker && phase_clean_docker
fi

# ----------------------------------------------------------------------------
# What this run may have let out
# ----------------------------------------------------------------------------
PHASE=finish
PHASE_DIR="$OUTPUT/finish"
mkdir -p "$PHASE_DIR"
section "No secret in anything kept"
if [ -n "${INGESTION_KEY:-}" ]; then
  # requests.jsonl is read from what arrived, and a body holds no header.
  FOUND=""
  for name in INGESTION_KEY BAD_INGESTION_KEY APP_SECRET ACCOUNT_PASSWORD; do
    # An empty one is in every file, and says nothing.
    if [ -n "${!name:-}" ]; then
      FOUND="$FOUND$(grep -rlF -- "${!name}" "$OUTPUT" 2>/dev/null | tr '\n' ' ')"
    fi
  done
  if [ -n "$FOUND" ]; then
    fail "a secret is in: $FOUND"
  else
    pass "neither the ingestion key nor any secret is in any file kept"
  fi
fi

printf '\n\n%s checks passed, %s failed. Each is in %s.\n' "$PASSES" "$FAILURES" "$RESULTS"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    printf '## Agent install: %s passed, %s failed\n\n' "$PASSES" "$FAILURES"
    if [ "$FAILURES" -gt 0 ]; then
      printf '```text\n'
      grep '^FAIL' "$RESULTS" || true
      printf '```\n'
    fi
  } >>"$GITHUB_STEP_SUMMARY"
fi
[ "$FAILURES" -eq 0 ]
