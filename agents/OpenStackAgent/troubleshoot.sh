#!/usr/bin/env bash
#
# OneUptime OpenStack Agent — Diagnostic ("doctor")
# --------------------------------------------------
# Run this on the machine where the agent is installed, with or without Docker.
# It answers two questions, and each of them hides behind a healthy-looking agent:
#
# Why is the cloud "Disconnected" in OneUptime? The agent ships telemetry to
# `<url>/otlp/v1/*` with the ingestion key in the `x-oneuptime-token` header. If
# that key is missing, malformed, unknown or expired, the OTLP endpoints answer
# 401 (422 for a disabled key or a browser key). Neither is retryable, so the
# collector drops every batch and logs one "Exporting failed" line per batch,
# and the cloud never flips to "connected" because connection status is driven
# purely by telemetry actually arriving. So it asks `GET <url>/otlp/v1/validate`,
# which judges the key alone, and on older servers that lack it falls back to
# `POST <url>/fluentd/v1/logs`, which runs the SAME auth.
#
# What can this credential really read? OpenStack has no global read-only role,
# and a 200 is no proof: Neutron and Cinder answer a plain reader with a 200 and
# only its own project. So it logs in to Keystone with the credential in
# clouds.yaml, reads every path the agent needs (the list in
# Tests/Ops/openstack-e2e/access-matrix.py) a small page at a time, and reports
# each as reads everything, may be own project only, refused or not deployed,
# with which pages and alerts go without it and what to do.
#
# Usage:
#   ./troubleshoot.sh [-d INSTALL_DIR] [--skip-egress] [--skip-access] [--curl-image IMG] [--no-color]
#
# Defaults: INSTALL_DIR=/opt/oneuptime-openstack-agent
#
# Requires: docker on a Docker install. The collector and exporter images are
# distroless (no shell, no curl), so the network probes run a small curl image
# as a sibling container sharing their network namespace: the exact path they
# use. Without Docker it needs curl, and the probes run on the machine itself.
# Nothing secret goes on a command line: the credential, the token Keystone
# gives for it and the ingestion key all reach curl on stdin.

set -uo pipefail

# ----------------------------------------------------------------------------
# Config / args
# ----------------------------------------------------------------------------
DIR="/opt/oneuptime-openstack-agent"
SKIP_EGRESS=0
SKIP_ACCESS=0
# Pinned, as the Database agent's doctor pins it: this image is handed the
# credential, so it must never be whatever "latest" has become.
CURL_IMAGE="curlimages/curl:8.22.0@sha256:58adaa4e8dca9c988bae2aba4ab3434a0bb2da16bbe3f92dec39ec7785166777"
USE_COLOR=1
AGENT_CONTAINER="oneuptime-openstack-agent"
EXPORTER_CONTAINER="oneuptime-openstack-exporter"
AGENT_SERVICE="oneuptime-openstack-agent"
EXPORTER_SERVICE="oneuptime-openstack-exporter"
EXPORTER_SYSTEM_USER="oneuptime-openstack"

while [ $# -gt 0 ]; do
  case "$1" in
    -d|--dir)      DIR="${2:-}"; shift 2 ;;
    --skip-egress) SKIP_EGRESS=1; shift ;;
    --skip-access) SKIP_ACCESS=1; shift ;;
    --curl-image)  CURL_IMAGE="${2:-}"; shift 2 ;;
    --no-color)    USE_COLOR=0; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,36p'
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ----------------------------------------------------------------------------
# Pretty printing
# ----------------------------------------------------------------------------
if [ "$USE_COLOR" = 1 ] && [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_BLU=$'\033[36m'
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YEL=""; C_BLU=""; C_BOLD=""; C_DIM=""; C_OFF=""
fi

FAIL_COUNT=0
WARN_COUNT=0
declare -a FINDINGS=()

section() { printf "\n%s── %s ──%s\n" "$C_BOLD" "$1" "$C_OFF"; }
pass()    { printf "  %s✔%s %s\n" "$C_GRN" "$C_OFF" "$1"; }
warn()    { printf "  %s▲%s %s\n" "$C_YEL" "$C_OFF" "$1"; WARN_COUNT=$((WARN_COUNT+1)); }
fail()    { printf "  %s✗%s %s\n" "$C_RED" "$C_OFF" "$1"; FAIL_COUNT=$((FAIL_COUNT+1)); }
info()    { printf "  %s•%s %s\n" "$C_BLU" "$C_OFF" "$1"; }
detail()  { printf "    %s%s%s\n" "$C_DIM" "$1" "$C_OFF"; }
add_finding() { FINDINGS+=("$1"); }

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
CONFIG_FILE="$DIR/otel-collector-config.yaml"
ENV_FILE="$DIR/.env"
CLOUDS_FILE="$DIR/clouds.yaml"

# An install without Docker puts the collector's binary in the install
# directory, and systemd reads its .env by rules of its own.
NATIVE=0
if [ -x "$DIR/otelcol-contrib" ]; then
  NATIVE=1
fi

# Read one variable from .env the way Docker Compose v2 does (the same rules
# install.sh writes by): the last assignment wins, single-quoted values are
# literal, double-quoted values undo \\ \" and $$, and an unquoted value
# stops at " #" and is trimmed. Without this a quoted URL or key would be
# probed with its quotes still on.
dotenv_get() {
  local name="$1" file="$2" raw="" value="" rest="" ch=""
  raw=$(grep "^[[:space:]]*$name=" "$file" 2>/dev/null | tail -1) || true
  [ -n "$raw" ] || return 0
  value="${raw#*=}"
  case "$value" in
    \'*\'*)
      value="${value#\'}"
      value="${value%%\'*}"
      ;;
    \"*\"*)
      value="${value#\"}"
      rest="$value"
      value=""
      while [ -n "$rest" ]; do
        ch="${rest:0:1}"
        if [ "$ch" = '\' ] && [ -n "${rest:1:1}" ] && [ "${rest:1:1}" != '$' ]; then
          value="$value${rest:1:1}"
          rest="${rest:2}"
        elif [ "$ch" = '$' ] && [ "${rest:1:1}" = '$' ]; then
          value="$value\$"
          rest="${rest:2}"
        elif [ "$ch" = '"' ]; then
          break
        else
          value="$value$ch"
          rest="${rest:1}"
        fi
      done
      ;;
    *)
      value="${value%% #*}"
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"
      value="${value//\$\$/\$}"
      ;;
  esac
  printf '%s' "$value"
}

# The same for the .env of an install without Docker, which systemd reads: $ is
# literal, and install.sh writes every value double-quoted with \ and " escaped.
systemd_env_get() {
  local name="$1" file="$2" raw="" value="" rest="" ch=""
  raw=$(grep "^[[:space:]]*$name=" "$file" 2>/dev/null | tail -1) || true
  [ -n "$raw" ] || return 0
  value="${raw#*=}"
  case "$value" in
    \'*\'*)
      value="${value#\'}"
      value="${value%%\'*}"
      ;;
    \"*\"*)
      rest="${value#\"}"
      value=""
      while [ -n "$rest" ]; do
        ch="${rest:0:1}"
        if [ "$ch" = '\' ] && [ -n "${rest:1:1}" ]; then
          value="$value${rest:1:1}"
          rest="${rest:2}"
        elif [ "$ch" = '"' ]; then
          break
        else
          value="$value$ch"
          rest="${rest:1}"
        fi
      done
      ;;
    *)
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"
      ;;
  esac
  printf '%s' "$value"
}

# Read an env var as the running container actually sees it (compose defaults
# included). Falls back to the .env file when the container isn't running.
agent_env() {
  local v=""
  if [ "$NATIVE" = 1 ]; then
    systemd_env_get "$1" "$ENV_FILE"
    return 0
  fi
  v=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$AGENT_CONTAINER" 2>/dev/null \
        | sed -n "s/^$1=//p" | head -1)
  if [ -z "$v" ] && [ -f "$ENV_FILE" ]; then
    v=$(dotenv_get "$1" "$ENV_FILE")
  fi
  printf '%s' "$v"
}

# A value as a JSON string, for the Keystone request. Pure parameter expansion:
# the value never leaves this shell.
json_string() {
  local value="$1" tab=$'\t' newline=$'\n' return=$'\r'
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$tab/\\t}"
  value="${value//$newline/\\n}"
  value="${value//$return/\\r}"
  printf '"%s"' "$value"
}

# Read one `key: value` from clouds.yaml: the first one in the file, since every
# entry holds the same credential. Undoes what install.sh wrote, and what someone
# editing the file by hand may write instead. Prints nothing when it is absent.
clouds_yaml_get() {
  local line="" value="" rest="" ch="" decoded=""
  [ -r "$CLOUDS_FILE" ] || return 0
  line="$(grep -E "^[[:space:]]+$1:[[:space:]]" "$CLOUDS_FILE" 2>/dev/null | head -1)" || true
  [ -n "$line" ] || return 0
  value="${line#*:}"
  value="${value#"${value%%[![:space:]]*}"}"
  case "$value" in
    \"*)
      rest="${value#\"}"
      while [ -n "$rest" ]; do
        ch="${rest:0:1}"
        if [ "$ch" = '\' ]; then
          case "${rest:1:1}" in
            t) decoded="$decoded"$'\t' ;;
            n) decoded="$decoded"$'\n' ;;
            r) decoded="$decoded"$'\r' ;;
            *) decoded="$decoded${rest:1:1}" ;;
          esac
          rest="${rest:2}"
        elif [ "$ch" = '"' ]; then
          break
        else
          decoded="$decoded$ch"
          rest="${rest:1}"
        fi
      done
      ;;
    \'*)
      rest="${value#\'}"
      while [ -n "$rest" ]; do
        ch="${rest:0:1}"
        if [ "$ch" = "'" ] && [ "${rest:1:1}" = "'" ]; then
          decoded="$decoded'"
          rest="${rest:2}"
        elif [ "$ch" = "'" ]; then
          break
        else
          decoded="$decoded$ch"
          rest="${rest:1}"
        fi
      done
      ;;
    *)
      decoded="${value%% #*}"
      decoded="${decoded%"${decoded##*[![:space:]]}"}"
      ;;
  esac
  printf '%s' "$decoded"
}

# JSON as one `path<TAB>value` line per value (.token.roles[0].name<TAB>admin),
# so a bare machine with no jq or python can answer questions about it.
json_flatten() {
  LC_ALL=C grep -Eo '"([^"\\]|\\.)*"|-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?|true|false|null|[][{}:,]' \
    | LC_ALL=C awk '
      function unquote(s) {
        if (substr(s, 1, 1) != "\"") return s
        s = substr(s, 2, length(s) - 2)
        gsub(/\\\//, "/", s)
        return s
      }
      function here(   i, p) {
        p = ""
        for (i = 1; i <= depth; i++) p = p (kind[i] == "o" ? "." name[i] : "[" position[i] "]")
        return p
      }
      {
        if ($0 == "{" || $0 == "[") {
          depth++
          kind[depth] = ($0 == "{" ? "o" : "a")
          position[depth] = 0
          name[depth] = ""
          wantname = ($0 == "{")
          next
        }
        if ($0 == "}" || $0 == "]") { depth--; wantname = 0; next }
        if ($0 == ":") { wantname = 0; next }
        if ($0 == ",") { if (kind[depth] == "a") position[depth]++; else wantname = 1; next }
        if (wantname) { name[depth] = unquote($0); next }
        print here() "\t" unquote($0)
      }'
}

# The value at one path of flattened JSON ($1), or nothing.
flat_get() {
  printf '%s\n' "$1" | awk -F '\t' -v path="$2" '$1 == path { print $2; exit }'
}

# A list in flattened JSON ($1): how many rows the list named $2 holds, and which
# projects the rows that are this project's alone belong to (their attribute $3).
# Prints "<rows> <how many projects> <the projects>". A shared or external network
# and a public image are anyone's to see, whoever owns them, so they prove nothing.
list_summary() {
  printf '%s\n' "$1" | awk -F '\t' -v key="$2" -v attr="$3" '
    BEGIN { prefix = "." key "["; n = length(prefix) }
    substr($1, 1, n) == prefix {
      rest = substr($1, n + 1)
      row = rest; sub(/\].*/, "", row)
      field = rest; sub(/^[0-9]+\]\.?/, "", field)
      seen[row] = 1
      if (field == attr && $2 != "null") project[row] = $2
      if ((field == "shared" || field == "router:external") && $2 == "true") anyones[row] = 1
      if (field == "visibility" && $2 != "private") anyones[row] = 1
    }
    END {
      for (row in seen) {
        rows++
        if (!(row in anyones) && (row in project) && !(project[row] in counted)) {
          counted[project[row]] = 1
          projects++
          names = names " " project[row]
        }
      }
      print rows + 0, projects + 0, names
    }'
}

# curl on the network path of container $1, or from the default bridge when it
# is "" (close enough for a reachability verdict; the runtime section already
# failed by then), or on this machine without Docker. Extra `docker run` options
# (a CA file) go in DOCKER_RUN_EXTRA. Only with --stdin does Docker read this
# script's stdin, which is the script itself when it runs as `curl ... | bash`.
declare -a DOCKER_RUN_EXTRA=()
network_curl() {
  local container="$1"; shift
  local -a run=(--rm)
  if [ "${1:-}" = "--stdin" ]; then
    run+=(-i)
    shift
  fi
  if [ "$NATIVE" = 1 ]; then
    curl "$@" 2>&1
    return $?
  fi
  [ -n "$container" ] && run+=(--network "container:$container")
  docker run "${run[@]}" ${DOCKER_RUN_EXTRA[@]+"${DOCKER_RUN_EXTRA[@]}"} "$CURL_IMAGE" "$@" 2>&1
}

# Globals populated by agent_netns_req() and openstack_req()
RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""

# Make an HTTP request ($1=GET|POST, $2=url, $3=token or "") from INSIDE the
# agent container's network namespace, so it follows the collector's real
# path: compose network, DNS, proxy, firewall, TLS. The key reaches curl on
# stdin. Without pipefail here: the status wanted is curl's.
agent_netns_req() {
  local method="$1" url="$2" token="$3"
  RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""
  local -a args=(-sS -m 15 -w $'\nOUSTATUS:%{http_code}' -X "$method" -H @-)
  [ "$method" = "POST" ] && args+=(-H "Content-Type: application/json" --data '{}')
  args+=("$url")
  local raw=""
  DOCKER_RUN_EXTRA=()
  raw=$(set +o pipefail; printf 'x-oneuptime-token: %s\n' "$token" | network_curl "$AGENT_NETWORK" --stdin "${args[@]}")
  RESP_EXIT=$?
  RESP_CODE=$(printf '%s\n' "$raw" | sed -n 's/^OUSTATUS:\([0-9]\{3\}\).*/\1/p' | head -1)
  RESP_BODY=$(printf '%s\n' "$raw" | sed '/^OUSTATUS:/,$d' | head -c 1000)
  [ -z "$RESP_CODE" ] && RESP_CODE="000"
}

# A hard connectivity failure (no HTTP response at all).
is_conn_fail() { [ "$RESP_CODE" = "000" ] || [ "${RESP_EXIT:-1}" != "0" ]; }

# A request to OpenStack, on the exporter's network path, with its CA. Whatever
# headers it needs, the token among them, are $1, and reach curl on stdin. The
# rest are curl's arguments. Fills RESP_* with the whole answer.
openstack_req() {
  local headers="$1"; shift
  local raw=""
  RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""
  raw=$(set +o pipefail; printf '%s\n' "$headers" | network_curl "$OPENSTACK_NETWORK" --stdin \
    -sS -m 30 ${TLS_ARGS[@]+"${TLS_ARGS[@]}"} -H @- -w $'\nOUSTATUS:%{http_code}' "$@")
  RESP_EXIT=$?
  RESP_CODE=$(printf '%s\n' "$raw" | sed -n 's/^OUSTATUS:\([0-9]\{3\}\).*/\1/p' | head -1)
  RESP_BODY=$(printf '%s\n' "$raw" | sed '/^OUSTATUS:/,$d')
  [ -z "$RESP_CODE" ] && RESP_CODE="000"
}

# What curl's exit code says about the way to an address.
explain_curl_exit() {
  case "$1" in
    6) echo "DNS: this path cannot resolve the host" ;;
    7) echo "the connection was refused, or there is no route" ;;
    28) echo "nothing answered in time" ;;
    35|51|58|60|77) echo "TLS: the certificate is not trusted on this path" ;;
    *) echo "curl exit $1" ;;
  esac
}

# ============================================================================
printf "%s%sOneUptime OpenStack Agent — Diagnostic%s\n" "$C_BOLD" "$C_BLU" "$C_OFF"
printf "%sInstall dir:%s %s\n" "$C_DIM" "$C_OFF" "$DIR"

# ----------------------------------------------------------------------------
section "1. Runtime"
# ----------------------------------------------------------------------------
AGENT_RUNNING=0
AGENT_NETWORK=""
OPENSTACK_NETWORK=""
STATE=""
EXPORTER_RUNNING=0

if [ "$NATIVE" = 1 ]; then
  pass "Install dir '$DIR' holds the agent without Docker (systemd services)"
  if ! command -v curl >/dev/null 2>&1; then
    fail "curl not found on PATH. Without Docker, the probes below run on this machine with curl."
    exit 1
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    fail "systemctl not found on PATH, so the agent's services cannot run here."
    exit 1
  fi
  STATE=$(systemctl is-active "$AGENT_SERVICE" 2>/dev/null || true)
  if [ "$STATE" = "active" ]; then
    pass "Service '$AGENT_SERVICE' is active"
    AGENT_RUNNING=1
  else
    fail "Service '$AGENT_SERVICE' is NOT active: ${STATE:-unknown}"
    add_finding "The collector's service is not running. Look at why: journalctl -u $AGENT_SERVICE -n 100 --no-pager. 'Failed with result 'resources'' means systemd cannot read $ENV_FILE; 'cannot unmarshal the configuration' means a value in it is not one the collector takes."
  fi
else
  if ! command -v docker >/dev/null 2>&1; then
    fail "docker not found on PATH. The agent runs in Docker — install it / run this on the agent machine."
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    fail "Docker daemon unreachable (permissions?). Try sudo, or add your user to the docker group."
    exit 1
  fi
  pass "Docker daemon reachable"

  if [ -d "$DIR" ] && [ -f "$DIR/docker-compose.yml" ]; then
    pass "Install dir '$DIR' exists (compose install)"
  else
    warn "No compose install at '$DIR' — re-run with -d <dir> if you installed elsewhere."
  fi

  # systemd wrapper (optional — it only wraps docker compose).
  if command -v systemctl >/dev/null 2>&1; then
    SYSD=$(systemctl is-active "$AGENT_SERVICE" 2>/dev/null || true)
    [ "$SYSD" = "active" ] && info "systemd unit $AGENT_SERVICE is active."
  fi

  STATE=$(docker inspect -f '{{.State.Status}} restarting={{.State.Restarting}} restarts={{.RestartCount}}' "$AGENT_CONTAINER" 2>/dev/null)
  if [ -z "$STATE" ]; then
    fail "Container '$AGENT_CONTAINER' does not exist."
    add_finding "The agent container isn't created. Start it: cd $DIR && docker compose up -d"
  elif printf '%s' "$STATE" | grep -q '^running restarting=false'; then
    pass "Container '$AGENT_CONTAINER' is running ($STATE)"
    AGENT_RUNNING=1
    AGENT_NETWORK="$AGENT_CONTAINER"
    OPENSTACK_NETWORK="$AGENT_CONTAINER"
  else
    fail "Container '$AGENT_CONTAINER' is NOT healthy: $STATE"
    add_finding "The agent container is not running (state: $STATE). A restart loop usually means a config error — check: docker logs $AGENT_CONTAINER"
  fi
fi

# The exporter: the bundled one, or your own at OPENSTACK_EXPORTER_ADDRESS.
if [ "$NATIVE" = 1 ]; then
  BUNDLED_EXPORTER_ADDRESS="127.0.0.1:9180"
else
  BUNDLED_EXPORTER_ADDRESS="openstack-exporter:9180"
fi
EXPORTER_ADDRESS=$(agent_env OPENSTACK_EXPORTER_ADDRESS)
[ -z "$EXPORTER_ADDRESS" ] && EXPORTER_ADDRESS="$BUNDLED_EXPORTER_ADDRESS"
EXPORTER_BUNDLED=0
[ "$EXPORTER_ADDRESS" = "$BUNDLED_EXPORTER_ADDRESS" ] && EXPORTER_BUNDLED=1

# An exporter in single-cloud mode, such as Kolla-Ansible's: read on /metrics, with no /probe.
SINGLE_CLOUD_TARGETS=$(agent_env OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS)
[ "$SINGLE_CLOUD_TARGETS" = "[]" ] && SINGLE_CLOUD_TARGETS=""
[ -n "$SINGLE_CLOUD_TARGETS" ] && EXPORTER_BUNDLED=0

if [ -n "$SINGLE_CLOUD_TARGETS" ]; then
  info "No bundled exporter: the agent reads your own at $SINGLE_CLOUD_TARGETS on /metrics (OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS), and its clouds.yaml holds the credential."
elif [ "$EXPORTER_BUNDLED" = 0 ]; then
  info "No bundled exporter: the agent reads your own at $EXPORTER_ADDRESS (OPENSTACK_EXPORTER_ADDRESS), and its clouds.yaml holds the credential."
elif [ "$NATIVE" = 1 ]; then
  EXP_STATE=$(systemctl is-active "$EXPORTER_SERVICE" 2>/dev/null || true)
  if [ "$EXP_STATE" = "active" ]; then
    pass "Service '$EXPORTER_SERVICE' is active"
    EXPORTER_RUNNING=1
  else
    fail "Service '$EXPORTER_SERVICE' is NOT active: ${EXP_STATE:-unknown}"
    add_finding "The exporter's service is not running, so the agent has nothing to scrape. Look at why: journalctl -u $EXPORTER_SERVICE -n 100 --no-pager"
  fi
else
  EXP_STATE=$(docker inspect -f '{{.State.Status}}' "$EXPORTER_CONTAINER" 2>/dev/null)
  if [ "$EXP_STATE" = "running" ]; then
    pass "Bundled exporter '$EXPORTER_CONTAINER' is running"
    EXPORTER_RUNNING=1
    OPENSTACK_NETWORK="$EXPORTER_CONTAINER"
  elif [ -n "$EXP_STATE" ]; then
    fail "Bundled exporter '$EXPORTER_CONTAINER' is NOT running (state: $EXP_STATE)"
    add_finding "The bundled exporter container is down — the agent has nothing to scrape. Check: docker logs $EXPORTER_CONTAINER"
  else
    fail "Bundled exporter '$EXPORTER_CONTAINER' does not exist."
    add_finding "The agent scrapes the bundled exporter, and it never started. Set COMPOSE_PROFILES=openstack-exporter in $ENV_FILE and run: cd $DIR && docker compose up -d. Or, if you run your own, set OPENSTACK_EXPORTER_ADDRESS to it."
  fi
fi

# clouds.yaml: readable by its owner alone, and that owner must be the user the
# exporter runs as, or the exporter cannot read the credential and exits.
CLOUDS_READABLE=0
if [ "$EXPORTER_BUNDLED" = 1 ]; then
  if [ ! -f "$CLOUDS_FILE" ]; then
    fail "$CLOUDS_FILE does not exist, so the exporter has no credential."
    add_finding "Run install.sh again: with no clouds.yaml it asks for the credential and writes one."
  else
    CLOUDS_MODE=$(ls -ln "$CLOUDS_FILE" 2>/dev/null | awk '{print $1}')
    CLOUDS_OWNER=$(ls -ln "$CLOUDS_FILE" 2>/dev/null | awk '{print $3}')
    case "$CLOUDS_MODE" in
      -rw-------*) pass "clouds.yaml is readable by its owner alone" ;;
      *)
        warn "clouds.yaml holds the credential, and its mode is $CLOUDS_MODE: others can read it."
        add_finding "Make clouds.yaml private: chmod 600 $CLOUDS_FILE"
        ;;
    esac
    EXPORTER_UID=""
    if [ "$NATIVE" = 1 ]; then
      EXPORTER_UID=$(id -u "$EXPORTER_SYSTEM_USER" 2>/dev/null)
    else
      EXPORTER_UID=$(docker inspect -f '{{.Config.User}}' "$EXPORTER_CONTAINER" 2>/dev/null)
      [ -z "$EXPORTER_UID" ] && EXPORTER_UID=$(agent_env OPENSTACK_EXPORTER_USER)
      [ -z "$EXPORTER_UID" ] && EXPORTER_UID="65532"
      EXPORTER_UID="${EXPORTER_UID%%:*}"
    fi
    if [ -n "$EXPORTER_UID" ] && [ -n "$CLOUDS_OWNER" ] && [ "$EXPORTER_UID" != "$CLOUDS_OWNER" ] && [ "$EXPORTER_UID" != "0" ]; then
      fail "The exporter runs as uid $EXPORTER_UID, and clouds.yaml belongs to uid $CLOUDS_OWNER, so the exporter cannot read it."
      add_finding "Give clouds.yaml to the exporter's user: sudo chown $EXPORTER_UID $CLOUDS_FILE. Then restart the agent."
    fi
    if [ -r "$CLOUDS_FILE" ]; then
      CLOUDS_READABLE=1
    else
      warn "This user cannot read clouds.yaml, so the credential checks below are skipped. Run this with sudo."
    fi
  fi
fi

# ----------------------------------------------------------------------------
section "2. openstack-exporter reachability"
# ----------------------------------------------------------------------------
EXPORTER_OK=0
declare -a REGIONS=()
CLOUDS_LIST=$(agent_env OPENSTACK_EXPORTER_CLOUDS)
[ -z "$CLOUDS_LIST" ] && CLOUDS_LIST="[RegionOne]"
case "$CLOUDS_LIST" in
  \[*\])
    while IFS= read -r REGION; do
      [ -n "$REGION" ] && REGIONS+=("$REGION")
    done <<EOF
$(printf '%s' "$CLOUDS_LIST" | sed 's/^\[//; s/\]$//' | tr ',' '\n' | sed "s/^[[:space:]\"']*//; s/[[:space:]\"']*\$//")
EOF
    ;;
  *)
    fail "OPENSTACK_EXPORTER_CLOUDS is '$CLOUDS_LIST' — not a list in square brackets, so the collector refuses to start."
    add_finding "Write OPENSTACK_EXPORTER_CLOUDS in $ENV_FILE as a comma-separated list in square brackets, e.g. OPENSTACK_EXPORTER_CLOUDS=[RegionOne,RegionTwo], and restart the agent."
    ;;
esac

if [ "$NATIVE" = 0 ]; then
  # The localhost trap: inside the agent container, localhost is the agent
  # itself — it can never reach an exporter running on this machine.
  case "$EXPORTER_ADDRESS" in
    localhost:*|127.0.0.1:*)
      fail "OPENSTACK_EXPORTER_ADDRESS is '$EXPORTER_ADDRESS' — inside the agent container that is the agent itself, not this machine."
      add_finding "OPENSTACK_EXPORTER_ADDRESS must be reachable from a container: use the host's LAN IP or DNS name (or host.docker.internal on Docker Desktop), never localhost." ;;
  esac
fi

# A target list as words, one per line: a target that names its region gives its address.
target_addresses() {
  printf '%s' "$1" | sed 's/^\[//; s/\]$//' | tr ',' '\n' \
    | sed "s/^[[:space:]\"']*//; s/[[:space:]\"']*\$//; s/^[^@]*@//" | grep -v '^$'
}

# What the collector asks of an exporter in single-cloud mode: everything, on /metrics.
if [ -n "$SINGLE_CLOUD_TARGETS" ]; then
  for TARGET in $(target_addresses "$SINGLE_CLOUD_TARGETS"); do
    SCRAPE_OUT=$(network_curl "$AGENT_NETWORK" -sS -m 110 "http://${TARGET}/metrics")
    SCRAPE_EXIT=$?
    SERIES=$(printf '%s\n' "$SCRAPE_OUT" | grep -c '^openstack_' 2>/dev/null || true)
    if [ "$SCRAPE_EXIT" != "0" ]; then
      fail "Cannot reach the exporter at $TARGET from the agent's network."
      detail "curl: $(printf '%s' "$SCRAPE_OUT" | tr '\n' ' ' | head -c 200)"
      add_finding "The collector cannot scrape $TARGET. Kolla-Ansible binds it to the API network, behind its internal VIP on 9198: check this machine has a route there."
    elif printf '%s\n' "$SCRAPE_OUT" | grep -Eq '^openstack_identity_up(\{[^}]*\})? 1'; then
      pass "The exporter at $TARGET reads the cloud ($SERIES openstack_* series)."
      EXPORTER_OK=1
    elif [ "$SERIES" = "0" ]; then
      fail "The exporter at $TARGET answers /metrics with no openstack_* series."
      add_finding "An exporter started with --multi-cloud only answers on /probe, so it does not belong in OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS. Set OPENSTACK_EXPORTER_ADDRESS to it instead, with OPENSTACK_EXPORTER_CLOUDS naming its clouds.yaml entries."
    else
      warn "The exporter at $TARGET answers, but openstack_identity_up is not 1: it could not read Keystone's lists."
      add_finding "The exporter at $TARGET reads nothing from Keystone. Look at its log: on Kolla-Ansible, /var/log/kolla/prometheus/ on the host that runs it."
    fi
  done
fi

# One scrape of the lightest service, per region: exactly what the collector
# asks, from the collector's network. It logs in to Keystone with the entry
# named for that region, so it tests the whole chain to Keystone.
for REGION in ${REGIONS[@]+"${REGIONS[@]}"}; do
  SCRAPE_URL="http://${EXPORTER_ADDRESS}/probe?cloud=${REGION// /%20}&include_services=identity"
  SCRAPE_OUT=$(network_curl "$AGENT_NETWORK" -sS -m 110 "$SCRAPE_URL")
  SCRAPE_EXIT=$?
  SERIES=$(printf '%s\n' "$SCRAPE_OUT" | grep -c '^openstack_' 2>/dev/null || true)
  if [ "$SCRAPE_EXIT" != "0" ]; then
    fail "Region $REGION: cannot reach the exporter at $EXPORTER_ADDRESS from the agent's network."
    detail "curl: $(printf '%s' "$SCRAPE_OUT" | tr '\n' ' ' | head -c 200)"
    add_finding "The collector cannot scrape $EXPORTER_ADDRESS. If you run your own exporter, check the address and that it runs with --multi-cloud; without it there is no /probe, so set OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS instead. If you meant the bundled one, set COMPOSE_PROFILES=openstack-exporter and restart."
  elif printf '%s\n' "$SCRAPE_OUT" | grep -Eq '^openstack_identity_up(\{[^}]*\})? 1'; then
    pass "Region $REGION: the exporter reads Keystone ($SERIES openstack_* series, openstack_identity_up 1)."
    EXPORTER_OK=1
  elif printf '%s\n' "$SCRAPE_OUT" | grep -Eq '^openstack_identity_up(\{[^}]*\})? 0'; then
    warn "Region $REGION: the exporter answers, but openstack_identity_up is 0: it could not read Keystone's lists."
    add_finding "The exporter logs in but reads nothing from Keystone in region $REGION. The access check below says what this credential may read."
  else
    fail "Region $REGION: the exporter answered with no openstack_identity_up series."
    detail "Response head: $(printf '%s' "$SCRAPE_OUT" | head -c 200)"
    add_finding "The exporter has no clouds.yaml entry named \"$REGION\", or cannot log in with it. Each region needs an entry named for it. Check the exporter's log. An exporter started without --multi-cloud, as Kolla-Ansible starts it, has no /probe: set OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS and OPENSTACK_EXPORTER_CLOUDS=[] instead."
    if [ "$EXPORTER_RUNNING" = 1 ] && [ "$NATIVE" = 0 ]; then
      AUTHERR=$(docker logs --tail 50 "$EXPORTER_CONTAINER" 2>&1 | grep -iE '401|auth|permission|denied|x509|could not|failed' | tail -3)
      if [ -n "$AUTHERR" ]; then
        warn "The exporter's log shows:"
        printf '%s\n' "$AUTHERR" | while read -r l; do detail "$(printf '%s' "$l" | head -c 160)"; done
      fi
    fi
  fi
done

# ----------------------------------------------------------------------------
section "3. Keystone: DNS, TLS and the credential"
# ----------------------------------------------------------------------------
# The credential in clouds.yaml, as the exporter logs in with it. It reaches curl
# on stdin, and the token Keystone gives back stays in this shell.
KEYSTONE_OK=0
KEYSTONE_TOKEN=""
TOKEN_FLAT=""
OWN_PROJECT=""
HAS_ADMIN_ROLE=0
HAS_ACCESS_RULES=0
declare -a TLS_ARGS=()
CREDENTIAL_KIND=""
AUTH_URL=""

keystone_auth_body() {
  if [ "$CREDENTIAL_KIND" = "application_credential" ]; then
    printf '{"auth":{"identity":{"methods":["application_credential"],"application_credential":{"id":%s,"secret":%s}}}}' \
      "$(json_string "$(clouds_yaml_get application_credential_id)")" \
      "$(json_string "$(clouds_yaml_get application_credential_secret)")"
  else
    printf '{"auth":{"identity":{"methods":["password"],"password":{"user":{"name":%s,"domain":{"name":%s},"password":%s}}},"scope":{"project":{"name":%s,"domain":{"name":%s}}}}}' \
      "$(json_string "$(clouds_yaml_get username)")" \
      "$(json_string "$(clouds_yaml_get user_domain_name)")" \
      "$(json_string "$(clouds_yaml_get password)")" \
      "$(json_string "$(clouds_yaml_get project_name)")" \
      "$(json_string "$(clouds_yaml_get project_domain_name)")"
  fi
}

if [ "$EXPORTER_BUNDLED" = 0 ]; then
  info "Skipped: your own exporter holds the credential, on its own machine."
elif [ "$CLOUDS_READABLE" = 0 ]; then
  info "Skipped: no clouds.yaml this user can read."
else
  AUTH_URL=$(clouds_yaml_get auth_url)
  while [ "${AUTH_URL%/}" != "$AUTH_URL" ]; do AUTH_URL="${AUTH_URL%/}"; done
  case "$AUTH_URL" in
    ""|*/v3) ;;
    *) AUTH_URL="$AUTH_URL/v3" ;;
  esac
  if [ -n "$(clouds_yaml_get application_credential_id)" ]; then
    CREDENTIAL_KIND="application_credential"
  elif [ -n "$(clouds_yaml_get username)" ]; then
    CREDENTIAL_KIND="password"
  fi

  # The CA the exporter trusts, or no check at all if clouds.yaml asks for that.
  CACERT=$(clouds_yaml_get cacert)
  if [ "$(clouds_yaml_get verify)" = "false" ]; then
    TLS_ARGS=(-k)
    warn "clouds.yaml has verify: false, so nothing checks Keystone's certificate, and anything on the way can read the credential."
  elif [ -n "$CACERT" ]; then
    if [ "$NATIVE" = 1 ] && [ -f "$CACERT" ]; then
      TLS_ARGS=(--cacert "$CACERT")
    elif [ "$NATIVE" = 0 ] && [ -f "$DIR/ca.pem" ]; then
      DOCKER_RUN_EXTRA=(-v "$DIR/ca.pem:/tmp/oneuptime-ca.pem:ro")
      TLS_ARGS=(--cacert /tmp/oneuptime-ca.pem)
    else
      warn "clouds.yaml names a CA ($CACERT), and it is not where this script looks: the checks below use the default trust store."
    fi
  fi

  if [ -z "$AUTH_URL" ]; then
    fail "clouds.yaml names no auth_url."
    add_finding "$CLOUDS_FILE has no auth_url. Move it aside and run install.sh again to write a new one."
  elif [ -z "$CREDENTIAL_KIND" ]; then
    warn "clouds.yaml holds no credential this script can read, so what it can read is not checked here."
  else
    info "Keystone: $AUTH_URL"
    LOGIN=$(set +o pipefail; keystone_auth_body | network_curl "$OPENSTACK_NETWORK" --stdin \
      -sS -m 30 ${TLS_ARGS[@]+"${TLS_ARGS[@]}"} -i -X POST -H "Content-Type: application/json" --data-binary @- \
      -w $'\nOUSTATUS:%{http_code}' "$AUTH_URL/auth/tokens")
    LOGIN_EXIT=$?
    LOGIN_CODE=$(printf '%s\n' "$LOGIN" | sed -n 's/^OUSTATUS:\([0-9]\{3\}\).*/\1/p' | head -1)
    [ -z "$LOGIN_CODE" ] && LOGIN_CODE="000"
    case "$LOGIN_CODE" in
      200|201)
        pass "DNS and TLS are fine, and Keystone accepted the credential (HTTP $LOGIN_CODE)."
        KEYSTONE_OK=1
        KEYSTONE_TOKEN=$(printf '%s\n' "$LOGIN" | tr -d '\r' | sed -n 's/^[Xx]-[Ss][Uu][Bb][Jj][Ee][Cc][Tt]-[Tt][Oo][Kk][Ee][Nn]:[[:space:]]*//p' | tail -1)
        TOKEN_FLAT=$(printf '%s\n' "$LOGIN" | tr -d '\r' | sed '/^OUSTATUS:/,$d' | awk '/^HTTP\// { headers = 1; body = ""; next } headers { if (NF == 0) headers = 0; next } { body = body $0 "\n" } END { printf "%s", body }' | json_flatten)
        OWN_PROJECT=$(flat_get "$TOKEN_FLAT" '.token.project.id')
        ROLES=$(printf '%s\n' "$TOKEN_FLAT" | awk -F '\t' '$1 ~ /^\.token\.roles\[[0-9]+\]\.name$/ { printf "%s%s", sep, $2; sep = ", " }')
        case ",$(printf '%s' "$ROLES" | tr -d ' ')," in
          *,admin,*) HAS_ADMIN_ROLE=1 ;;
        esac
        info "Roles on project ${OWN_PROJECT:-?}: ${ROLES:-none listed}"
        if [ "$CREDENTIAL_KIND" = "password" ]; then
          warn "This is a username and password. It can do whatever its account can, and an application credential is better (README.md, \"Access\")."
        elif [ -n "$(flat_get "$TOKEN_FLAT" '.token.application_credential.access_rules[0].path')" ]; then
          HAS_ACCESS_RULES=1
          pass "An application credential limited by access rules."
        elif [ "$HAS_ADMIN_ROLE" = 1 ]; then
          warn "A plain admin application credential: it has no access rules, so it can write. Add them where you can (README.md, \"Level 1: Full view\")."
        else
          info "An application credential with no access rules."
        fi
        if [ "$(flat_get "$TOKEN_FLAT" '.token.application_credential.restricted')" = "false" ]; then
          warn "This application credential was created --unrestricted: it can make more credentials. Replace it with one that is not."
        fi
        ;;
      401)
        fail "Keystone REFUSED this credential (HTTP 401)."
        add_finding "Keystone refuses the credential in $CLOUDS_FILE: the ID, secret or password is wrong, it has expired or been deleted, or its account lost its role on the project. Make a new one (README.md, \"Access\"), move clouds.yaml aside and run install.sh again."
        ;;
      000)
        WHY=$(explain_curl_exit "$LOGIN_EXIT")
        fail "No answer from Keystone at $AUTH_URL: $WHY."
        detail "curl: $(printf '%s' "$LOGIN" | sed '/^OUSTATUS:/,$d' | tr '\n' ' ' | head -c 200)"
        case "$LOGIN_EXIT" in
          35|51|58|60|77) add_finding "Keystone's certificate is not trusted where the exporter runs. For a cloud with its own CA: OPENSTACK_CA_FILE=/path/to/ca.pem bash install.sh" ;;
          *) add_finding "Keystone cannot be reached from where the exporter runs ($WHY). Check $AUTH_URL and the network between this machine and it." ;;
        esac
        ;;
      *)
        fail "Keystone answered HTTP $LOGIN_CODE at $AUTH_URL/auth/tokens, not a token."
        add_finding "$AUTH_URL does not answer as Keystone (HTTP $LOGIN_CODE). It is the identity endpoint, ending in /v3."
        ;;
    esac
  fi
fi

# The catalog's entries: type<TAB>region<TAB>interface<TAB>url.
CATALOG=""
if [ "$KEYSTONE_OK" = 1 ]; then
  CATALOG=$(printf '%s\n' "$TOKEN_FLAT" | awk -F '\t' '
    $1 ~ /^\.token\.catalog\[[0-9]+\]\.type$/ {
      n = $1; sub(/^\.token\.catalog\[/, "", n); sub(/\].*/, "", n)
      type[n] = $2
      next
    }
    $1 ~ /^\.token\.catalog\[[0-9]+\]\.endpoints\[[0-9]+\]\.[a-z_]+$/ {
      split($1, parts, /\[/)
      n = parts[2]; sub(/\].*/, "", n)
      e = parts[3]; sub(/\].*/, "", e)
      f = parts[3]; sub(/.*\]\./, "", f)
      value[n "," e "," f] = $2
      seen[n "," e] = 1
    }
    END {
      for (k in seen) {
        split(k, ids, ",")
        region = value[k ",region_id"]
        if (region == "") region = value[k ",region"]
        print type[ids[1]] "\t" region "\t" value[k ",interface"] "\t" value[k ",url"]
      }
    }' | sort)
fi

# The public URL of a service type in a region, or nothing. Cinder goes by more
# than one type, and which it uses depends on the release.
catalog_url() {
  local service="$1" region="$2" type="" url=""
  for type in "$service" $([ "$service" = "block-storage" ] && echo "volumev3 volume"); do
    url=$(printf '%s\n' "$CATALOG" | awk -F '\t' -v t="$type" -v r="$region" '$1 == t && $2 == r && $3 == "public" { print $4; exit }')
    if [ -n "$url" ]; then
      printf '%s' "${url%/}"
      return 0
    fi
  done
}

# Where a read's path starts: the catalog's URL, with the version the path names
# taken off it or the version its service needs put on it.
read_base() {
  local service="$1" url="$2"
  case "$service" in
    identity) url="${url%/v3}" ;;
    network) url="${url%/v2.0}" ;;
    image) url="${url%/v2}" ;;
    load-balancer) url="${url%/v2.0}"; url="${url%/v2}" ;;
    baremetal) url="${url%/v1}" ;;
    compute) case "$url" in */v2*) ;; *) url="$url/v2.1" ;; esac ;;
    block-storage) case "$url" in */v3*) ;; *) url="$url/v3" ;; esac ;;
  esac
  printf '%s' "$url"
}

# ----------------------------------------------------------------------------
section "4. Every service in the catalog"
# ----------------------------------------------------------------------------
if [ "$KEYSTONE_OK" = 0 ]; then
  info "Skipped: it takes a login to Keystone to get the catalog."
else
  for REGION in ${REGIONS[@]+"${REGIONS[@]}"}; do
    IN_REGION=$(printf '%s\n' "$CATALOG" | awk -F '\t' -v r="$REGION" '$2 == r && $3 == "public" { print $1 "\t" $4 }')
    if [ -z "$IN_REGION" ]; then
      fail "Region $REGION: the service catalog lists no public endpoint there."
      add_finding "Region \"$REGION\" is not in this cloud's catalog (it lists: $(printf '%s\n' "$CATALOG" | awk -F '\t' '{print $2}' | sort -u | paste -sd, -)). Region names are case sensitive: fix OPENSTACK_EXPORTER_CLOUDS in $ENV_FILE and run install.sh again."
      continue
    fi
    info "Region $REGION"
    while IFS=$'\t' read -r SERVICE_TYPE SERVICE_URL <&3; do
      openstack_req "Accept: application/json" -o /dev/null "$SERVICE_URL"
      case "$RESP_CODE" in
        000)
          fail "$SERVICE_TYPE: no answer at $SERVICE_URL: $(explain_curl_exit "$RESP_EXIT")."
          add_finding "$SERVICE_TYPE does not answer at $SERVICE_URL from where the exporter runs, so its series go missing (the others keep reporting)."
          ;;
        5*)
          warn "$SERVICE_TYPE: failing at $SERVICE_URL (HTTP $RESP_CODE)."
          add_finding "$SERVICE_TYPE answers HTTP $RESP_CODE at $SERVICE_URL, so its series go missing (the others keep reporting)."
          ;;
        *) pass "$SERVICE_TYPE: answers at $SERVICE_URL (HTTP $RESP_CODE)." ;;
      esac
    done 3<<EOF
$IN_REGION
EOF
  done
fi

# ----------------------------------------------------------------------------
section "5. What this credential can read"
# ----------------------------------------------------------------------------
# Each read the agent needs, from Tests/Ops/openstack-e2e/access-matrix.py: one
# small page of it, because monitoring must never be what takes a cloud down (an
# unscoped port list can saturate Neutron: openstack-exporter issue 540).
#
#   service type | what it reads | path and query | the list in the answer |
#   the attribute naming a row's project | its API version header |
#   what goes without it | what to do
#
# A row's project attribute: "-" means the list is not per project, so a 200 is
# the answer. "*" means a project's own view of it is empty, so any row proves
# it: Neutron answers a plain reader's list of agents with a 200 and no rows.
# Otherwise a 200 proves nothing by itself: see classify_read.
#
# What to do: policy:<service>:<the line, as in access/policy/<service>.yaml>;
# code:<service>, which scopes the list in its own code, so no policy line opens
# it; any, which any credential may read; or text:<what to say>.
TODAY="$(date -u +%Y-%m-%d)T00:00:00"

COUNT_ALL=0; COUNT_OWN=0; COUNT_REFUSED=0; COUNT_ABSENT=0; COUNT_FAILING=0; COUNT_EXPECTED=0
INFRA_READS=0; INFRA_GAPS=0; PROJECT_GAPS=0; ADMIN_ONLY_GAPS=0

# The answer in RESP_*, as one of all, own, refused, absent, failing, expected, in
# RESULT, with what it rests on in REASON.
#
# The trap: Neutron and Cinder answer a plain reader with a 200 and only its own
# project, and quietly ignore all_tenants=1. So a list earns "reads everything"
# only by showing rows it could not otherwise see: two projects, or one that is
# not this credential's. A list where every row has one project id, the
# credential's own, may be its own project only. An empty list proves nothing,
# unless the credential has the admin role, when empty is the likely truth.
classify_read() {
  local key="$1" attr="$2" flat="" summary="" rows=0 projects=0 names=""
  REASON=""
  case "$RESP_CODE" in
    2*) ;;
    401|403) RESULT="refused"; REASON=" (HTTP $RESP_CODE)"; return 0 ;;
    404) RESULT="absent"; REASON=" (HTTP 404: this cloud has no such API)"; return 0 ;;
    000) RESULT="failing"; REASON=" (no answer: $(explain_curl_exit "$RESP_EXIT"))"; return 0 ;;
    *)
      # Neutron creates a project's default security group as it lists them, and zero
      # quota does not let it. Every level 2 credential gets this, and it is harmless.
      if [ "$RESP_CODE" = "409" ] && [ "$key" = "security_groups" ]; then
        RESULT="expected"
      else
        RESULT="failing"
      fi
      REASON=" (HTTP $RESP_CODE)"
      return 0
      ;;
  esac
  if [ "$attr" = "-" ]; then
    RESULT="all"
    return 0
  fi
  flat=$(printf '%s\n' "$RESP_BODY" | json_flatten)
  summary=$(list_summary "$flat" "$key" "$attr")
  rows="${summary%% *}"
  summary="${summary#* }"
  projects="${summary%% *}"
  names="${summary#* }"
  names="${names# }"
  if [ "$attr" = "*" ] && [ "$rows" -gt 0 ]; then
    RESULT="all"
  elif [ "$projects" -ge 2 ]; then
    RESULT="all"
    REASON=" ($projects projects in $rows rows)"
  elif [ "$projects" = 1 ] && [ -n "$OWN_PROJECT" ] && [ "$names" != "$OWN_PROJECT" ]; then
    RESULT="all"
    REASON=" (every row is in one project, and not this credential's)"
  elif [ "$projects" = 1 ]; then
    RESULT="own"
    REASON=" (every row is in one project)"
  elif [ "$HAS_ADMIN_ROLE" = 1 ]; then
    RESULT="all"
    REASON=" (nothing here to tell by, and the credential has the admin role)"
  else
    RESULT="own"
    REASON=" (a 200 with nothing here to tell by)"
  fi
}

# What the credential's own project holds. Where Cinder has enforce_new_defaults off,
# which is Cinder's own default, any role on a project can create that project's
# volumes, reader and oneuptime_monitoring included. So a monitoring credential
# belongs on a project of its own that holds nothing and has zero quota, and one on a
# real project may be able to write there. One row of each is all it takes to know.
check_project_holdings() {
  local region="$1" service="" what="" read_path="" key="" version="" url="" rows="" headers=""
  local holds="" unknown="" asked=0
  [ -n "$OWN_PROJECT" ] || return 0
  while IFS='|' read -r service what read_path key version <&4; do
    url=$(catalog_url "$service" "$region")
    [ -n "$url" ] || continue
    headers="X-Auth-Token: $KEYSTONE_TOKEN"$'\n'"Accept: application/json"
    [ "$version" = "-" ] || headers="$headers"$'\n'"$version"
    openstack_req "$headers" "$(read_base "$service" "$url")${read_path//@PROJECT@/$OWN_PROJECT}"
    case "$RESP_CODE" in
      2*)
        asked=$((asked+1))
        rows=$(list_summary "$(printf '%s\n' "$RESP_BODY" | json_flatten)" "$key" "-")
        if [ "${rows%% *}" -gt 0 ]; then
          holds="${holds:+$holds, }$what"
        fi
        ;;
      *)
        unknown="${unknown:+$unknown, }$what"
        ;;
    esac
  done 4<<'HOLDINGS'
compute|instances|/servers?limit=1|servers|OpenStack-API-Version: compute 2.90
block-storage|volumes|/volumes?limit=1|volumes|OpenStack-API-Version: volume 3.50
network|networks|/v2.0/networks?project_id=@PROJECT@&limit=1&fields=id|networks|-
network|routers|/v2.0/routers?project_id=@PROJECT@&limit=1&fields=id|routers|-
network|floating IPs|/v2.0/floatingips?project_id=@PROJECT@&limit=1&fields=id|floatingips|-
HOLDINGS
  if [ -n "$holds" ]; then
    warn "This credential's project holds things in region $region: $holds."
    detail "Where Cinder has enforce_new_defaults off, which is Cinder's own default, any role on a project can create that project's volumes, reader and oneuptime_monitoring included, so this credential may be able to write there."
    detail "Unless this is the project you mean it to watch, give the agent a project of its own that holds nothing and has zero quota (README.md, \"Level 2: Infrastructure only\")."
    add_finding "This credential's project holds things ($holds in region $region), and on many clouds any role on a project can write there. Section 5 says what to do."
  elif [ "$asked" -eq 0 ]; then
    info "Could not tell what this credential's project holds in region $region."
  elif [ -n "$unknown" ]; then
    info "This credential's project holds nothing this script could ask about in region $region, but it could not ask about: $unknown."
  else
    pass "This credential's project holds no instances, volumes, networks, routers or floating IPs in region $region."
  fi
}

print_fix() {
  local fix="$1" rest="" file=""
  case "$fix" in
    policy:*)
      rest="${fix#policy:}"
      file="${rest%%:*}"
      detail "To read it: use a full-view credential (README.md, \"Level 1: Full view\"), or give this account the oneuptime_monitoring role and add this line, on every controller, to the file named by [oslo_policy] policy_file in $file.conf, which is /etc/$file/policy.yaml unless your deployment says otherwise:"
      detail "  ${rest#*:}"
      ;;
    code:*)
      detail "${fix#code:} scopes this list to the credential's own project in its code, so no policy line opens it. To read every project: use a full-view credential (README.md, \"Level 1: Full view\"), or give this account a role on each project you want seen, which on many clouds also lets it write there."
      ;;
    any)
      detail "Any credential may read this, so look at this application credential's access rules (access/application-credential-access-rules.json, fitted to this cloud by access/access-rules-for-cloud.py)."
      ;;
    text:*)
      detail "${fix#text:}"
      ;;
  esac
}

report_read() {
  local service="$1" read="$2" cost="$3" fix="$4"
  case "$RESULT" in
    all)
      pass "$service: $read — reads everything$REASON"
      COUNT_ALL=$((COUNT_ALL+1))
      ;;
    own)
      warn "$service: $read — may be own project only$REASON"
      detail "Goes without it: $cost"
      print_fix "$fix"
      COUNT_OWN=$((COUNT_OWN+1))
      ;;
    refused)
      warn "$service: $read — refused$REASON"
      detail "Goes without it: $cost"
      print_fix "$fix"
      if [ "$HAS_ACCESS_RULES" = 1 ] && [ "$RESP_CODE" = "401" ]; then
        detail "With access rules, a 401 means they do not list this path, or this service's keystonemiddleware has no service_type set and has not been restarted, or it sits behind a path prefix, which the shipped rules do not fit: access-rules-for-cloud.py fits them to this cloud (README.md, \"Level 1: Full view\")."
      fi
      COUNT_REFUSED=$((COUNT_REFUSED+1))
      ;;
    absent)
      info "$service: $read — not deployed$REASON"
      detail "Nothing to do if this cloud does not run it. Goes without it: $cost"
      COUNT_ABSENT=$((COUNT_ABSENT+1))
      ;;
    failing)
      warn "$service: $read — could not ask$REASON. That says nothing about the credential: section 4 looks at the service."
      COUNT_FAILING=$((COUNT_FAILING+1))
      ;;
    expected)
      info "$service: $read — expected on a project with zero quota$REASON"
      detail "Neutron tries to create the project's default security group when it lists them, and zero quota does not let it, so it answers 409 Quota exceeded. That is harmless, and nothing to fix: this project holds nothing, and Neutron would only show it its own."
      COUNT_EXPECTED=$((COUNT_EXPECTED+1))
      ;;
  esac
  # What the answers add up to, from the reads each kind of access differs on.
  case "$service:$read" in
    compute:services|compute:hypervisors|placement:*|network:agents)
      INFRA_READS=$((INFRA_READS+1))
      case "$RESULT" in own|refused) INFRA_GAPS=$((INFRA_GAPS+1)) ;; esac
      ;;
    # Only full view reads these: Cinder's own code asks for an admin.
    block-storage:services|block-storage:pools)
      case "$RESULT" in own|refused) ADMIN_ONLY_GAPS=$((ADMIN_ONLY_GAPS+1)) ;; esac
      ;;
    "compute:servers, all projects"|"block-storage:volumes, all projects"|network:networks|network:routers|"network:floating IPs")
      case "$RESULT" in own|refused) PROJECT_GAPS=$((PROJECT_GAPS+1)) ;; esac
      ;;
  esac
}

if [ "$SKIP_ACCESS" = 1 ]; then
  info "Skipped (--skip-access)."
elif [ "$KEYSTONE_OK" = 0 ]; then
  info "Skipped: it takes a login to Keystone to ask."
else
  REGION_COUNT=0
  for REGION in ${REGIONS[@]+"${REGIONS[@]}"}; do
    REGION_COUNT=$((REGION_COUNT+1))
    info "Region $REGION"
    NETWORKS_RESULT=""
    while IFS='|' read -r SERVICE READ READ_PATH KEY ATTR VERSION COST FIX <&3; do
      # Keystone is one for the whole cloud.
      if [ "$SERVICE" = "identity" ] && [ "$REGION_COUNT" -gt 1 ]; then
        continue
      fi
      if [ "$SERVICE" = "identity" ]; then
        URL="$AUTH_URL"
      else
        URL=$(catalog_url "$SERVICE" "$REGION")
      fi
      if [ -z "$URL" ]; then
        RESULT="absent"
        REASON=" (not in this region's catalog)"
        report_read "$SERVICE" "$READ" "$COST" "$FIX"
        continue
      fi
      HEADERS="X-Auth-Token: $KEYSTONE_TOKEN"$'\n'"Accept: application/json"
      [ "$VERSION" = "-" ] || HEADERS="$HEADERS"$'\n'"$VERSION"
      openstack_req "$HEADERS" "$(read_base "$SERVICE" "$URL")${READ_PATH//@TODAY@/$TODAY}"
      classify_read "$KEY" "$ATTR"
      # A subnet of a shared network is anyone's to see and carries no sign of it,
      # so the subnets tell nothing the networks did not.
      if [ "$SERVICE:$READ" = "network:networks" ]; then
        NETWORKS_RESULT="$RESULT"
      elif [ "$SERVICE:$READ" = "network:subnets" ] && [ "$RESULT" = "all" ] && [ "$NETWORKS_RESULT" = "own" ]; then
        RESULT="own"
        REASON=" (as for the networks: a subnet of a shared network is anyone's to see)"
      fi
      report_read "$SERVICE" "$READ" "$COST" "$FIX"
    done 3<<'READS'
identity|projects|/v3/projects|projects|-|-|the Projects page, and project names on instances, volumes and networks.|policy:keystone:"identity:list_projects": "rule:admin_required or role:oneuptime_monitoring"
identity|domains|/v3/domains|domains|-|-|domains on the Projects page.|policy:keystone:"identity:list_domains": "rule:admin_required or role:oneuptime_monitoring"
identity|regions|/v3/regions|regions|-|-|region names.|any
identity|services|/v3/services|services|-|-|service names on the Services page.|policy:keystone:"identity:list_services": "rule:admin_required or role:oneuptime_monitoring"
identity|endpoints|/v3/endpoints|endpoints|-|-|the endpoints each service answers on.|policy:keystone:"identity:list_endpoints": "rule:admin_required or role:oneuptime_monitoring"
compute|servers, all projects|/servers/detail?all_tenants=1&limit=100|servers|tenant_id|OpenStack-API-Version: compute 2.90|every instance, this credential's own project's too: the exporter asks Nova for all projects' servers, and when Nova refuses, that read fails whole. The Instances page, instance counts per hypervisor and project, and the alerts on instances go with it. Only a OneUptime probe, collecting without this agent, lists one project's instances.|policy:nova:"os_compute_api:servers:detail:get_all_tenants": "rule:context_is_admin or role:oneuptime_monitoring"
compute|services|/os-services|services|-|OpenStack-API-Version: compute 2.90|Nova's services on the Services page and Needs attention, and the alerts on them.|policy:nova:"os_compute_api:os-services:list": "rule:context_is_admin or role:oneuptime_monitoring"
compute|hypervisors|/os-hypervisors/detail?limit=100|hypervisors|-|OpenStack-API-Version: compute 2.90|the Hypervisors page, capacity, and the alerts on hypervisors.|policy:nova:"os_compute_api:os-hypervisors:list-detail": "rule:context_is_admin or role:oneuptime_monitoring"
compute|aggregates|/os-aggregates|aggregates|-|OpenStack-API-Version: compute 2.90|host aggregates on the Hypervisors page.|policy:nova:"os_compute_api:os-aggregates:index": "rule:context_is_admin or role:oneuptime_monitoring"
compute|availability zones, detail|/os-availability-zone/detail|availabilityZoneInfo|-|OpenStack-API-Version: compute 2.90|which hosts sit in which availability zone.|policy:nova:"os_compute_api:os-availability-zone:detail": "rule:context_is_admin or role:oneuptime_monitoring"
compute|flavors|/flavors/detail?is_public=None&limit=100|flavors|-|OpenStack-API-Version: compute 2.90|flavors, and how many more of one fit.|any
compute|usage per project|/os-simple-tenant-usage?start=@TODAY@&limit=10|tenant_usages|-|OpenStack-API-Version: compute 2.90|usage per project. The agent only reads it with --disable-metric=nova-server_local_gb taken out (README.md, "What it costs").|policy:nova:"os_compute_api:os-simple-tenant-usage:list": "rule:context_is_admin or role:oneuptime_monitoring"
placement|resource providers|/resource_providers|resource_providers|-|OpenStack-API-Version: placement 1.39|how full the cloud really is, on the capacity pages and their alerts.|policy:placement:"placement:resource_providers:list": "rule:admin_api or role:oneuptime_monitoring"
network|agents|/v2.0/agents|agents|*|-|network agents on the Services page and Needs attention, and the alerts on them.|policy:neutron:"get_agent": "role:admin or role:oneuptime_monitoring"
network|networks|/v2.0/networks?limit=100&fields=project_id&fields=shared&fields=router:external|networks|project_id|-|networks in other projects on the Networks page.|code:Neutron
network|subnets|/v2.0/subnets?limit=100&fields=project_id|subnets|project_id|-|subnets in other projects on the Networks page.|code:Neutron
network|routers|/v2.0/routers?limit=100&fields=project_id|routers|project_id|-|routers in other projects on the Routers page, and the alerts on them.|code:Neutron
network|floating IPs|/v2.0/floatingips?limit=100&fields=project_id|floatingips|project_id|-|floating IPs in other projects.|code:Neutron
network|IP availabilities|/v2.0/network-ip-availabilities|network_ip_availabilities|project_id|-|address pools, and the alerts on running out of addresses.|policy:neutron:"get_network_ip_availability": "role:admin or role:oneuptime_monitoring"
network|security groups|/v2.0/security-groups?limit=100&fields=project_id&fields=shared|security_groups|project_id|-|security group counts for other projects.|code:Neutron
network|ports|/v2.0/ports?limit=100&fields=project_id|ports|project_id|-|nothing by default: only the per-port series read every port, and they are off (README.md, "What it costs").|code:Neutron
network|quotas|/v2.0/quotas|quotas|-|-|network quotas per project. The agent only reads them with --disable-metric=neutron-quota_network taken out (README.md, "What it costs").|text:Only an admin reads these: use a full-view credential (README.md, "Level 1: Full view").
block-storage|volumes, all projects|/volumes/detail?all_tenants=1&limit=100|volumes|os-vol-tenant-attr:tenant_id|OpenStack-API-Version: volume 3.50|volumes in other projects on the Volumes page, and the alerts on them.|code:Cinder
block-storage|services|/os-services|services|-|OpenStack-API-Version: volume 3.50|cinder-volume and cinder-scheduler state on the Services page and Needs attention, and the alerts on them.|text:Cinder's own code asks for an admin here, after policy has already passed, so no policy line opens it. Only a full-view credential reads it (README.md, "Level 1: Full view").
block-storage|pools|/scheduler-stats/get_pools?detail=true|pools|-|OpenStack-API-Version: volume 3.50|storage pools, and the alerts on a filling pool.|text:Cinder's own code asks for an admin here, after policy has already passed, so no policy line opens it. Only a full-view credential reads it (README.md, "Level 1: Full view").
block-storage|snapshots, all projects|/snapshots/detail?all_tenants=1&limit=100|snapshots|os-extended-snapshot-attributes:project_id|OpenStack-API-Version: volume 3.50|snapshots in other projects.|code:Cinder
block-storage|backups, all projects|/backups/detail?all_tenants=1&limit=100|backups|os-backup-project-attr:project_id|OpenStack-API-Version: volume 3.50|backups in other projects.|code:Cinder
block-storage|volume types|/types|volume_types|-|OpenStack-API-Version: volume 3.50|volume types.|any
image|images|/v2/images?limit=100|images|owner|-|private images in other projects.|text:Glance shows any credential the public images and its own. To read every project's: use a full-view credential (README.md, "Level 1: Full view").
load-balancer|load balancers|/v2/lbaas/loadbalancers?limit=100&fields=project_id|loadbalancers|project_id|-|load balancers in other projects.|text:Octavia shows a project reader its own. To read every project's: use a full-view credential (README.md, "Level 1: Full view").
load-balancer|amphorae|/v2/octavia/amphorae?limit=100|amphorae|-|-|amphorae.|text:Only an admin reads these: use a full-view credential (README.md, "Level 1: Full view").
baremetal|nodes|/v1/nodes/detail?limit=100|nodes|*|X-OpenStack-Ironic-API-Version: 1.82|bare metal nodes.|text:Ironic shows a project only the nodes it owns. To read them all: use a full-view credential (README.md, "Level 1: Full view").
READS
    check_project_holdings "$REGION"
  done

  EXPECTED_NOTE=""
  [ "$COUNT_EXPECTED" = 0 ] || EXPECTED_NOTE=" Expected on a project with zero quota: $COUNT_EXPECTED."
  info "Reads everything: $COUNT_ALL. May be own project only: $COUNT_OWN. Refused: $COUNT_REFUSED. Not deployed: $COUNT_ABSENT. Could not ask: $COUNT_FAILING.$EXPECTED_NOTE"
  if [ "$INFRA_READS" -gt 0 ] && [ "$INFRA_GAPS" = 0 ] && [ "$PROJECT_GAPS" = 0 ] && [ "$ADMIN_ONLY_GAPS" = 0 ]; then
    pass "That adds up to Full view: hypervisors, services and capacity, and every project's instances, volumes and networks."
  elif [ "$INFRA_READS" -gt 0 ] && [ "$INFRA_GAPS" = 0 ]; then
    info "That adds up to Infrastructure only: control-plane health and capacity, and every project's instances, with volumes, networks and routers only where this account has a role. Not cinder-volume or cinder-scheduler state, or storage pools: only a full-view credential reads those."
  elif [ "$INFRA_GAPS" = "$INFRA_READS" ] && [ "$COUNT_OWN" -gt 0 ]; then
    info "That adds up to Project view: this credential's own project, and no infrastructure. Through the agent that means no instances either: the exporter asks Nova for all projects' servers, Nova refuses, and that read fails whole. Only a OneUptime probe, collecting without this agent, lists one project's instances."
  else
    info "That falls between the three levels (README.md, \"Access\"): the lines above say what it reads."
  fi
  ACCESS_GAPS=$((COUNT_OWN+COUNT_REFUSED))
  if [ "$ACCESS_GAPS" -gt 0 ]; then
    add_finding "This credential cannot read everything: $COUNT_REFUSED reads refused, $COUNT_OWN that may be its own project only. Section 5 says what goes without each and what to do. That is fine if it is the level of access you chose."
  fi
fi

# ----------------------------------------------------------------------------
section "What the cloud stands on"
# ----------------------------------------------------------------------------
# Each is read only when someone named it, from the collector's own network. A target
# that does not answer costs its own series, and the Control Plane card says so.
#
#   check_control_plane <variable> <what it is> <a series that says it answers>
CONTROL_PLANE_NAMED=0
check_control_plane() {
  local variable="$1" what="$2" series="$3" list="" target="" answer="" code=""
  list=$(agent_env "$variable")
  if [ -z "$list" ] || [ "$list" = "[]" ]; then
    return 0
  fi
  CONTROL_PLANE_NAMED=1
  for target in $(target_addresses "$list"); do
    answer=$(network_curl "$AGENT_NETWORK" -sS -m 30 "http://${target}/metrics")
    code=$?
    if [ "$code" != "0" ]; then
      fail "$what at $target does not answer from the agent's network: $(explain_curl_exit "$code")."
      add_finding "The collector cannot scrape $what at $target ($variable). Check the address, and that this machine has a route to the network it listens on."
    elif printf '%s\n' "$answer" | grep -Eq "^${series}(\{[^}]*\})? 0"; then
      warn "$what at $target answers, and says the service behind it is down ($series 0)."
    elif printf '%s\n' "$answer" | grep -Eq "^${series}(\{[^}]*\})? "; then
      pass "$what at $target answers."
    else
      fail "$target answers, but with no $series: it is not $what."
      add_finding "$variable names $target, and what answers there is not $what. Check the port."
    fi
  done
}
check_control_plane OPENSTACK_RABBITMQ_TARGETS "RabbitMQ's Prometheus plugin" rabbitmq_identity_info
check_control_plane OPENSTACK_MARIADB_TARGETS "mysqld_exporter" mysql_up
check_control_plane OPENSTACK_MEMCACHED_TARGETS "memcached_exporter" memcached_up
check_control_plane OPENSTACK_HAPROXY_TARGETS "HAProxy's Prometheus exporter" haproxy_process_uptime_seconds
check_control_plane OPENSTACK_NETWORK_EXPORTER_TARGETS "openstack-network-exporter" ovs_build_info
check_control_plane OPENSTACK_LIBVIRT_HEALTH_TARGETS "prometheus-libvirt-exporter" libvirt_up
if [ "$CONTROL_PLANE_NAMED" = 0 ]; then
  info "None named, so the cloud's Control Plane card says each is not watched. README.md says how to name them."
fi

# ----------------------------------------------------------------------------
section "6. Cloud-name stamping"
# ----------------------------------------------------------------------------
# A missing openstack.cloud.name means metrics ingest into the project but no
# OpenStack cloud ever appears: discovery keys on that resource attribute.
CLOUD_NAME=$(agent_env OPENSTACK_CLOUD_NAME)
CLOUD_NAME_OK=0
if [ -n "$CLOUD_NAME" ]; then
  info "Reporting as cloud name: '${C_BOLD}${CLOUD_NAME}${C_OFF}'  (this is the openstack.cloud.name OneUptime keys on)"
  detail "If this differs from a previous install, OneUptime shows a NEW cloud entry; the old one stays 'Disconnected'."
  CLOUD_NAME_OK=1
else
  fail "OPENSTACK_CLOUD_NAME is empty — without it no OpenStack cloud registers in OneUptime."
  add_finding "Set OPENSTACK_CLOUD_NAME in $ENV_FILE and restart the agent. Discovery keys on the openstack.cloud.name resource attribute it feeds."
fi
if [ -f "$CONFIG_FILE" ]; then
  if grep -q 'openstack.cloud.name' "$CONFIG_FILE"; then
    pass "Collector config stamps the openstack.cloud.name resource attribute."
  else
    fail "Collector config has NO openstack.cloud.name resource processor — metrics will not attribute to a cloud."
    add_finding "The resource processor stamping openstack.cloud.name was removed from $CONFIG_FILE. Restore the shipped config."
  fi
else
  warn "Config file $CONFIG_FILE not found — skipping the config check (custom install dir? re-run with -d)."
fi

# ----------------------------------------------------------------------------
section "7. Ingestion token (shape)"
# ----------------------------------------------------------------------------
TOKEN=$(agent_env ONEUPTIME_TELEMETRY_INGESTION_KEY)
TOKEN_SHAPE_OK=0; TOKEN_HAS_WS=0
UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
if [ -z "$TOKEN" ]; then
  fail "ONEUPTIME_TELEMETRY_INGESTION_KEY is not set."
  add_finding "Set ONEUPTIME_TELEMETRY_INGESTION_KEY in $ENV_FILE (Project Settings → Telemetry Ingestion Keys) and restart the agent."
else
  TRIMMED=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
  MASK="${TRIMMED:0:8}…${TRIMMED: -4}"
  if [ "$TOKEN" != "$TRIMMED" ]; then
    fail "Token contains whitespace — the collector sends it literally, so OneUptime can't match it."
    add_finding "ONEUPTIME_TELEMETRY_INGESTION_KEY has stray whitespace in $ENV_FILE. Re-paste it cleanly and restart the agent."
    TOKEN_HAS_WS=1
  fi
  TOKEN="$TRIMMED"
  if [[ "$TRIMMED" =~ $UUID_RE ]]; then
    if [ "$TOKEN_HAS_WS" = 1 ]; then
      info "Underlying value (trimmed) IS a valid UUID ($MASK) — only the stray whitespace needs fixing."
    else
      pass "Token present and well-formed (UUID): $MASK"
      detail "Compare this against a *live* key under Project Settings → Telemetry Ingestion Keys."
      TOKEN_SHAPE_OK=1
    fi
  else
    fail "Token is not a valid UUID: '${MASK}' (len=${#TRIMMED})"
    add_finding "The ingestion key is not a UUID, so OneUptime can never resolve it (every export is refused with 401). Set a real Telemetry Ingestion Key."
  fi
fi

# ----------------------------------------------------------------------------
section "8. Collector health & self-metrics"
# ----------------------------------------------------------------------------
# The collector serves its own metrics on localhost:8888 inside the container
# (default internal telemetry), reachable only from its network namespace, and
# on 127.0.0.1:8891 without Docker (the unit says why).
SENT="?"; FAILED="?"; ACCEPTED="?"
if [ "$AGENT_RUNNING" = 1 ]; then
  if [ "$NATIVE" = 1 ]; then
    SELF=$(curl -sS -m 5 "http://127.0.0.1:8891/metrics" 2>/dev/null)
  else
    DOCKER_RUN_EXTRA=()
    SELF=$(docker run --rm --network "container:$AGENT_CONTAINER" "$CURL_IMAGE" -sS -m 5 "http://127.0.0.1:8888/metrics" 2>/dev/null)
  fi
  if [ -n "$SELF" ]; then
    ACCEPTED=$(printf '%s\n' "$SELF" | awk '/^otelcol_receiver_accepted_metric_points/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    SENT=$(printf '%s\n' "$SELF" | awk '/^otelcol_exporter_sent_metric_points/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    FAILED=$(printf '%s\n' "$SELF" | awk '/^otelcol_exporter_send_failed_/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    info "Collector self-metrics: accepted=$ACCEPTED  sent=$SENT  send_failed=$FAILED"
    if [ "${FAILED:-0}" -gt 0 ] 2>/dev/null; then
      fail "Collector reports send_failed > 0 → exports are failing (a refused key, or network/URL/TLS)."
      add_finding "Collector send_failed=$FAILED. The collector cannot deliver to OneUptime — the next section tells a refused ingestion key (401/422) apart from an egress/DNS/TLS/firewall problem."
    elif [ "${ACCEPTED:-0}" -eq 0 ] 2>/dev/null; then
      warn "No datapoints accepted yet — the scrapes are failing (see Section 2) or the collector started less than one scrape interval ago (2 to 5 minutes)."
    elif [ "${SENT:-0}" -gt 0 ] 2>/dev/null; then
      pass "Bytes are leaving the collector and the server is returning 2xx."
      detail "NOTE: servers older than mid-2026 answered 2xx even for a bad key. The token probe below settles it."
    fi
  else
    warn "Couldn't scrape collector self-metrics — skipping (telemetry address may be customized)."
  fi
else
  warn "Agent not running — skipping self-metrics."
fi

# ----------------------------------------------------------------------------
section "9. Egress + DEFINITIVE token check"
# ----------------------------------------------------------------------------
# A refused key shows up agent-side only as "Exporting failed" log lines. From
# the agent's own network namespace we ask OneUptime's validation endpoint for
# the verdict:
#   GET /otlp/v1/validate  → 200 {valid:true, keyType} | 401 {valid:false}
#   (a Browser key validates, but ingest refuses it from a collector with 422)
# Older servers without that endpoint (404) fall back to:
#   POST /otlp/v1/metrics → 401/422 means the key is refused; any other answer
#                           proves reachability only, because servers that
#                           predate the endpoint answer 2xx whatever the key
#   POST /fluentd/v1/logs → a bad token gets 400 "Invalid service token" from
#                           a server that old (401/422 from a current one)
TOKEN_VERDICT="UNKNOWN"   # UNKNOWN | VALID | INVALID | INCONCLUSIVE
EGRESS="UNKNOWN"          # UNKNOWN | OK | FAIL | SKIPPED

BASE_URL=$(agent_env ONEUPTIME_URL)
BASE_URL="${BASE_URL%/}"

egress_fail_finding() {
  fail "Cannot reach $1 from the agent's network (curl exit ${RESP_EXIT:-?})."
  local e; e=$(printf '%s' "$RESP_BODY" | tr '\n' ' ' | head -c 200)
  [ -n "$e" ] && detail "curl: $e"
  EGRESS="FAIL"
  case "$RESP_BODY" in
    *"Could not resolve host"*|*"Name or service not known"*)
      add_finding "DNS resolution of the OneUptime host fails from the agent container. Check ONEUPTIME_URL and the machine's DNS/egress." ;;
    *"certificate"*|*"SSL"*|*"TLS"*|*"self-signed"*|*"self signed"*)
      add_finding "TLS verification to $BASE_URL fails (cert/CA). The collector image's trust store must accept the cert." ;;
    *"refused"*|*"timed out"*|*"Connection timed out"*|*"Failed to connect"*)
      add_finding "Connection to $BASE_URL is refused/times out — firewall/proxy is blocking egress from this machine." ;;
    *)
      add_finding "Egress to $BASE_URL failed from the agent container. Verify ONEUPTIME_URL and that this machine can reach it." ;;
  esac
}

token_invalid_finding() {
  add_finding "DEFINITIVE: OneUptime does not accept this ingestion key (unknown, revoked, disabled, expired, or a browser key). Every export is refused (401/422) and dropped, and the collector only logs 'Exporting failed', which is why the agent looks healthy while nothing ingests. FIX: create or copy a live server Telemetry Ingestion Key in OneUptime, update ONEUPTIME_TELEMETRY_INGESTION_KEY in $ENV_FILE, then restart the agent."
}

# Fallback token oracle for servers without /otlp/v1/validate, which answer
# a bad token here with 400 and one of the two bodies below. It also runs when
# /otlp/v1/validate gave an unexpected status, and a current server refuses a
# key with 401 or 422 and different wording, so those codes count as a refusal
# rather than falling through to "accepted".
fluentd_token_probe() {
  agent_netns_req POST "$BASE_URL/fluentd/v1/logs" "$TOKEN"
  case "$RESP_BODY" in
    *"Invalid service token"*)
      fail "OneUptime REJECTED this token: \"Invalid service token\" (HTTP $RESP_CODE)."
      TOKEN_VERDICT="INVALID"; token_invalid_finding ;;
    *"Missing header"*|*"Missing ingestion token"*)
      fail "Server says the token header is missing (HTTP $RESP_CODE) — a proxy may be stripping it."
      TOKEN_VERDICT="INVALID"
      add_finding "The x-oneuptime-token header isn't arriving at OneUptime — check any egress proxy that might strip headers." ;;
    *)
      if [ "$RESP_CODE" = "401" ] || [ "$RESP_CODE" = "422" ]; then
        fail "OneUptime REFUSED this token (/fluentd/v1/logs → HTTP $RESP_CODE)."
        TOKEN_VERDICT="INVALID"; token_invalid_finding
      elif [ "$RESP_CODE" = "404" ]; then
        warn "/fluentd/v1/logs returned 404 — token check inconclusive."
        TOKEN_VERDICT="INCONCLUSIVE"
      elif is_conn_fail; then
        warn "No HTTP answer from /fluentd/v1/logs (curl exit ${RESP_EXIT:-?}) — token check inconclusive."
        TOKEN_VERDICT="INCONCLUSIVE"
      else
        pass "Token ACCEPTED by OneUptime (auth passed; /fluentd returned HTTP $RESP_CODE)."
        TOKEN_VERDICT="VALID"
      fi ;;
  esac
}

if [ "$SKIP_EGRESS" = 1 ]; then
  warn "Egress test skipped (--skip-egress)."; EGRESS="SKIPPED"
elif [ -z "$BASE_URL" ]; then
  warn "ONEUPTIME_URL is not set; cannot run the egress/token probe."; EGRESS="SKIPPED"
  add_finding "Set ONEUPTIME_URL in $ENV_FILE (e.g. https://oneuptime.com) and restart the agent."
elif ! [[ "$TOKEN" =~ ^[A-Za-z0-9-]+$ ]]; then
  warn "Token unusable/missing; cannot run the authenticated probe (fix Section 7 first)."; EGRESS="SKIPPED"
else
  agent_netns_req GET "$BASE_URL/otlp/v1/validate" "$TOKEN"
  if [ "$RESP_CODE" = "200" ]; then
    EGRESS="OK"
    case "$RESP_BODY" in
      *'"keyType":"Browser"'*)
        fail "Reached OneUptime, but the token is a BROWSER ingestion key: it validates, yet ingest refuses it from a collector (422)."
        TOKEN_VERDICT="INVALID"; token_invalid_finding ;;
      *)
        pass "Reached OneUptime and the ingestion token is VALID (/otlp/v1/validate → 200)."
        TOKEN_VERDICT="VALID" ;;
    esac
  elif [ "$RESP_CODE" = "401" ] || [ "$RESP_CODE" = "403" ]; then
    fail "Reached OneUptime, but it REJECTED the token (/otlp/v1/validate → $RESP_CODE)."
    EGRESS="OK"; TOKEN_VERDICT="INVALID"; token_invalid_finding
  elif [ "$RESP_CODE" = "404" ]; then
    info "Validation endpoint not on this server version (404) — falling back to legacy probes."
    agent_netns_req POST "$BASE_URL/otlp/v1/metrics" "$TOKEN"
    if is_conn_fail; then
      egress_fail_finding "$BASE_URL/otlp/v1/metrics"
    elif [ "$RESP_CODE" = "401" ] || [ "$RESP_CODE" = "422" ]; then
      fail "Reached OneUptime, but /otlp/v1/metrics REFUSED the token (HTTP $RESP_CODE)."
      EGRESS="OK"; TOKEN_VERDICT="INVALID"; token_invalid_finding
    else
      pass "Reachable: $BASE_URL/otlp/v1/metrics returned HTTP $RESP_CODE."; EGRESS="OK"
      fluentd_token_probe
    fi
  elif is_conn_fail; then
    egress_fail_finding "$BASE_URL/otlp/v1/validate"
  else
    warn "Unexpected HTTP $RESP_CODE from /otlp/v1/validate; trying the legacy token probe."
    EGRESS="OK"; fluentd_token_probe
  fi
fi

# ----------------------------------------------------------------------------
section "10. Recent collector errors"
# ----------------------------------------------------------------------------
LOGERR=""
LOGS_READ=0
if [ "$NATIVE" = 1 ]; then
  if command -v journalctl >/dev/null 2>&1; then
    LOGS_READ=1
    LOGERR=$(journalctl -u "$AGENT_SERVICE" -n 500 --no-pager 2>&1 \
      | grep -iE 'error|failed|denied|refused|x509|tls|deadline|429|throttl' | tail -50)
  fi
elif [ "$AGENT_RUNNING" = 1 ] || [ -n "$STATE" ]; then
  LOGS_READ=1
  LOGERR=$(docker logs --tail 500 "$AGENT_CONTAINER" 2>&1 \
    | grep -iE 'error|failed|denied|refused|x509|tls|deadline|429|throttl' | tail -50)
fi
if [ "$LOGS_READ" = 1 ]; then
  if [ -n "$LOGERR" ]; then
    warn "Recent error-ish log lines from the collector (last 50):"
    printf '%s\n' "$LOGERR" | while read -r l; do detail "$(printf '%s' "$l" | head -c 160)"; done
  else
    pass "No export errors in recent collector logs."
    detail "(A refused ingestion key would show here as 'Exporting failed … HTTP Status Code 401/422'.)"
  fi
fi

# ============================================================================
section "11. VERDICT"
# ============================================================================
if [ "$AGENT_RUNNING" != 1 ]; then
  printf "%s%sROOT CAUSE: the agent isn't running.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "Fix it (see Section 1) — until it runs, nothing is scraped or shipped.\n"
elif [ "$TOKEN_VERDICT" = "INVALID" ]; then
  printf "%s%sROOT CAUSE: the ingestion token is rejected by OneUptime.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "This is the classic trap: /otlp refuses every batch (401/422) and the collector\n"
  printf "drops it, yet the agent looks healthy while the cloud stays Disconnected.\n"
elif [ "$EGRESS" = "FAIL" ]; then
  printf "%s%sROOT CAUSE: the agent can't deliver telemetry to OneUptime (network/URL/TLS).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$EXPORTER_BUNDLED" = 1 ] && [ "$CLOUDS_READABLE" = 1 ] && [ -n "$CREDENTIAL_KIND" ] && [ "$KEYSTONE_OK" = 0 ]; then
  printf "%s%sROOT CAUSE: the credential in clouds.yaml gets no token from Keystone.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "Fix it (see Section 3) — without a token the exporter reads nothing.\n"
elif [ "$EXPORTER_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: the collector has no OpenStack metrics to ship (exporter scrape failing).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "Fix the exporter (see Section 2) — usually clouds.yaml, or OPENSTACK_EXPORTER_ADDRESS.\n"
elif [ "$CLOUD_NAME_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: OPENSTACK_CLOUD_NAME is missing — no cloud can register.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$TOKEN_HAS_WS" = 1 ]; then
  printf "%s%sROOT CAUSE: the ingestion key has stray whitespace.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "The collector sends the key with that whitespace, so OneUptime can't match it and\n"
  printf "refuses every export. Fix %s and restart.\n" "$ENV_FILE"
elif [ "$TOKEN_SHAPE_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: the ingestion key is empty/malformed.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$TOKEN_VERDICT" = "VALID" ]; then
  printf "%s%sThe agent looks healthy and OneUptime accepts the token.%s\n" "$C_BOLD" "$C_GRN" "$C_OFF"
  printf "If the dashboard still says Disconnected:\n"
  printf "  1. Give it ~2-5 min — status flips to Connected on the next telemetry batch,\n"
  printf "     and the disconnect cron runs on a 5-minute cycle.\n"
  printf "  2. Look for a %sNEW%s cloud entry named '%s' — if you changed the cloud name,\n" "$C_BOLD" "$C_OFF" "${CLOUD_NAME:-?}"
  printf "     the OLD entry stays Disconnected (that's expected; it's stale).\n"
  if [ $((COUNT_OWN+COUNT_REFUSED)) -gt 0 ]; then
    printf "If a page is empty or an alert stays quiet, Section 5 says what this credential cannot read.\n"
  fi
else
  printf "%sInconclusive from this machine.%s Next steps:\n" "$C_BOLD" "$C_OFF"
  printf "  • On the OneUptime server, search ingest logs for: \"Invalid service token\".\n"
  printf "  • Confirm the key under Project Settings → Telemetry Ingestion Keys still exists.\n"
  if [ -n "$BASE_URL" ]; then
    printf "  • Run the definitive token check by hand (200 = valid, 401 = bad/revoked key):\n"
    printf "      %scurl -i -H \"x-oneuptime-token: <key>\" %s/otlp/v1/validate%s\n" \
      "$C_DIM" "$BASE_URL" "$C_OFF"
  fi
fi

if [ ${#FINDINGS[@]} -gt 0 ]; then
  printf "\n%sFindings:%s\n" "$C_BOLD" "$C_OFF"
  i=1
  for f in "${FINDINGS[@]}"; do printf "  %d. %s\n" "$i" "$f"; i=$((i+1)); done
fi

printf "\n%s%d failed check(s), %d warning(s).%s\n" "$C_DIM" "$FAIL_COUNT" "$WARN_COUNT" "$C_OFF"
[ "$FAIL_COUNT" -gt 0 ] && exit 1
exit 0
