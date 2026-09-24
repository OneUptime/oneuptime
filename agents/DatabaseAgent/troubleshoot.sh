#!/usr/bin/env bash
#
# OneUptime Database Agent — Diagnostic ("doctor")
# -------------------------------------------------
# Run this on the machine where the agent is installed. It walks the whole
# chain and ends with a VERDICT naming the most likely root cause:
#
#   1. Runtime        docker, the install directory, the agent container.
#   2. Configuration  the .env values the collector config depends on,
#                     including the identity (DATABASE_SERVER_ADDRESS) —
#                     a local-only address such as localhost is ignored
#                     by OneUptime, so nothing would ever appear.
#   3. Database       TCP reachability of DATABASE_ENDPOINT from INSIDE the
#                     agent's network namespace (the collector's real path),
#                     and the receiver errors in the collector log
#                     (authentication, permissions, TLS).
#   4. OneUptime      a definitive ingestion-key check. OneUptime's OTLP
#                     endpoints deliberately answer a bad key with a silent
#                     200 (so a misconfigured collector cannot retry-flood
#                     the server), which means the collector log looks clean
#                     while every datapoint is dropped. `GET <url>/otlp/v1/
#                     validate` returns a real 200 (valid) / 401 (invalid);
#                     older servers fall back to `POST <url>/fluentd/v1/logs`,
#                     which runs the same auth but answers 400 on a bad key.
#
# Usage:
#   ./troubleshoot.sh [-d INSTALL_DIR] [--curl-image IMG] [--no-color]
#
# Defaults: INSTALL_DIR=/opt/oneuptime-database-agent
#
# Requires: docker. The collector image is distroless (no shell, no curl),
# so the network probes run a small curl image as a sibling container that
# shares the agent's network namespace.

set -uo pipefail

# ----------------------------------------------------------------------------
# Config / args
# ----------------------------------------------------------------------------
DIR="/opt/oneuptime-database-agent"
CURL_IMAGE="curlimages/curl:latest"
USE_COLOR=1

while [ $# -gt 0 ]; do
  case "$1" in
    -d|--dir)      DIR="${2:-}"; shift 2 ;;
    --curl-image)  CURL_IMAGE="${2:-}"; shift 2 ;;
    --no-color)    USE_COLOR=0; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,33p'
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
add_finding() { FINDINGS+=("$1"); }

ENV_FILE="$DIR/.env"
CONFIG_FILE="$DIR/otel-collector-config.yaml"

# Read one variable from .env the way Docker Compose v2 does (the same rules
# install.sh writes by): the last assignment wins, single-quoted values are
# literal, double-quoted values undo \\ \" and $$, and an unquoted value
# stops at " #" and is trimmed.
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

AGENT_CONTAINER=""
AGENT_RUNNING=0

# Read an env var as the running container sees it (compose defaults
# included). Falls back to the .env file when the container is not running.
agent_env() {
  local v=""
  if [ -n "$AGENT_CONTAINER" ]; then
    v=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$AGENT_CONTAINER" 2>/dev/null \
          | sed -n "s/^$1=//p" | head -1)
  fi
  if [ -z "$v" ] && [ -f "$ENV_FILE" ]; then
    v=$(dotenv_get "$1" "$ENV_FILE")
  fi
  printf '%s' "$v"
}

# Run curl from INSIDE the agent container's network namespace, so probes
# follow the collector's real path (compose network, DNS, firewall).
agent_netns_curl() {
  if [ "$AGENT_RUNNING" = 1 ]; then
    docker run --rm --network "container:$AGENT_CONTAINER" "$CURL_IMAGE" "$@" 2>&1
  else
    docker run --rm "$CURL_IMAGE" "$@" 2>&1
  fi
}

is_local_only_host() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    ""|localhost|*.localhost|127.*|::1|0.0.0.0|::|host.docker.internal|host.containers.internal|gateway.docker.internal) return 0 ;;
    *) return 1 ;;
  esac
}

# ============================================================================
printf "%s%sOneUptime Database Agent — Diagnostic%s\n" "$C_BOLD" "$C_BLU" "$C_OFF"
printf "%sInstall dir:%s %s\n" "$C_DIM" "$C_OFF" "$DIR"

# ----------------------------------------------------------------------------
section "1. Runtime"
# ----------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  fail "docker not found on PATH. The agent runs in Docker — run this on the agent machine."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon unreachable (permissions?). Try sudo, or add your user to the docker group."
  exit 1
fi
pass "Docker daemon reachable"

if [ -f "$DIR/docker-compose.yml" ] && [ -f "$CONFIG_FILE" ]; then
  pass "Install dir '$DIR' has docker-compose.yml and otel-collector-config.yaml"
else
  fail "No complete install at '$DIR' — re-run with -d <dir> if you installed elsewhere."
  add_finding "The install directory is incomplete. Re-run install.sh, or download docker-compose.yml and configs/<engine>.yaml (saved as otel-collector-config.yaml)."
fi

# One agent per database, so there is no fixed container name: ask Compose.
if [ -f "$DIR/docker-compose.yml" ]; then
  AGENT_CONTAINER=$(cd "$DIR" && docker compose ps -a -q oneuptime-database-agent 2>/dev/null | head -1)
fi
if [ -z "$AGENT_CONTAINER" ]; then
  fail "The agent container does not exist."
  add_finding "The agent container isn't created. Start it: cd $DIR && docker compose up -d"
else
  STATE=$(docker inspect -f '{{.State.Status}} restarting={{.State.Restarting}} restarts={{.RestartCount}}' "$AGENT_CONTAINER" 2>/dev/null)
  if printf '%s' "$STATE" | grep -q '^running restarting=false'; then
    pass "Agent container is running ($STATE)"
    AGENT_RUNNING=1
  else
    fail "Agent container is NOT healthy: $STATE"
    add_finding "The agent container is not running (state: $STATE). A restart loop is almost always a config error the collector names on its first log lines — check: cd $DIR && docker compose logs --tail 50"
  fi
fi

# ----------------------------------------------------------------------------
section "2. Configuration"
# ----------------------------------------------------------------------------
DATABASE_SYSTEM=$(agent_env DATABASE_SYSTEM)
DATABASE_ENDPOINT=$(agent_env DATABASE_ENDPOINT)
DATABASE_SERVER_ADDRESS=$(agent_env DATABASE_SERVER_ADDRESS)
DATABASE_SERVER_PORT=$(agent_env DATABASE_SERVER_PORT)
DATABASE_USERNAME=$(agent_env DATABASE_USERNAME)
ONEUPTIME_URL=$(agent_env ONEUPTIME_URL)
TOKEN=$(agent_env ONEUPTIME_TELEMETRY_INGESTION_KEY)

case "$DATABASE_SYSTEM" in
  postgresql|mysql|redis|mongodb) pass "Engine: $DATABASE_SYSTEM" ;;
  *)
    fail "DATABASE_SYSTEM='$DATABASE_SYSTEM' is not one of postgresql, mysql, redis, mongodb."
    add_finding "Set DATABASE_SYSTEM in $ENV_FILE and re-run install.sh so the matching config is downloaded."
    ;;
esac

if [ -f "$CONFIG_FILE" ] && [ -n "$DATABASE_SYSTEM" ]; then
  if grep -q "value: $DATABASE_SYSTEM\$" "$CONFIG_FILE"; then
    pass "otel-collector-config.yaml is the $DATABASE_SYSTEM config"
  else
    fail "otel-collector-config.yaml is not the $DATABASE_SYSTEM config (DATABASE_SYSTEM changed after install?)."
    add_finding "The collector config does not match DATABASE_SYSTEM. Re-run install.sh to download configs/$DATABASE_SYSTEM.yaml."
  fi
  if grep -q "^[[:space:]]*resourcedetection" "$CONFIG_FILE"; then
    warn "The config has a resourcedetection processor: it adds this machine's host.name / os.type, which makes the machine look like the monitored resource. The shipped configs leave it out."
  fi
fi

if [ -z "$DATABASE_SERVER_ADDRESS" ]; then
  fail "DATABASE_SERVER_ADDRESS is empty."
  add_finding "Set DATABASE_SERVER_ADDRESS to the host name your applications use for this database."
elif is_local_only_host "$DATABASE_SERVER_ADDRESS"; then
  fail "DATABASE_SERVER_ADDRESS='$DATABASE_SERVER_ADDRESS' only means something on one machine — OneUptime ignores it."
  add_finding "OneUptime never registers a database under a local-only address. Set DATABASE_SERVER_ADDRESS to the host name your applications connect to, then: cd $DIR && docker compose up -d"
else
  pass "Identity: $DATABASE_SERVER_ADDRESS:${DATABASE_SERVER_PORT:-?} (server.address / server.port)"
fi

case "$DATABASE_SERVER_ADDRESS" in
  *.svc.cluster.local|*.svc)
    if [ -z "$(agent_env KUBERNETES_CLUSTER_NAME)" ]; then
      warn "A cluster-local address without KUBERNETES_CLUSTER_NAME: it is only unique inside one cluster, so OneUptime will not create a database from it."
      add_finding "Set KUBERNETES_CLUSTER_NAME to the cluster name the OneUptime Kubernetes agent uses, or set DATABASE_SERVER_ID to the database OneUptime already detected."
    fi
    ;;
esac

if [ "$DATABASE_SYSTEM" = "postgresql" ] || [ "$DATABASE_SYSTEM" = "mysql" ]; then
  if [ -z "$DATABASE_USERNAME" ]; then
    fail "DATABASE_USERNAME is empty — the $DATABASE_SYSTEM receiver refuses to start without one."
  fi
fi

# ----------------------------------------------------------------------------
section "3. Database reachability & receiver errors"
# ----------------------------------------------------------------------------
if [ -n "$DATABASE_ENDPOINT" ]; then
  EP_HOST="${DATABASE_ENDPOINT%:*}"
  EP_PORT="${DATABASE_ENDPOINT##*:}"
  # curl's telnet:// scheme is a plain TCP connect: -v prints the connection
  # line as soon as the handshake completes, then -m ends the idle session.
  PROBE=$(agent_netns_curl -v --connect-timeout 5 -m 3 "telnet://$EP_HOST:$EP_PORT" </dev/null)
  if printf '%s' "$PROBE" | grep -qE "Connected to|Established connection"; then
    pass "TCP connect to $DATABASE_ENDPOINT from the agent's network works"
  else
    fail "Cannot open a TCP connection to $DATABASE_ENDPOINT from the agent's network."
    printf '%s\n' "$PROBE" | grep -E "Could not resolve|refused|timed out|Failed to connect" | head -3 | sed 's/^/      /'
    if is_local_only_host "$EP_HOST"; then
      add_finding "'$EP_HOST' inside the container is the container itself. Use host.docker.internal:$EP_PORT with the database listening on the Docker bridge too, or uncomment network_mode: host in docker-compose.yml and use localhost:$EP_PORT."
    else
      add_finding "Check DNS, firewalls and the database's listen address / allow-list (pg_hba.conf, bind-address, bind, net.bindIp) for connections from this machine."
    fi
  fi
else
  fail "DATABASE_ENDPOINT is empty."
fi

if [ -n "$AGENT_CONTAINER" ]; then
  LOGS=$(docker logs --tail 300 "$AGENT_CONTAINER" 2>&1)
  check_log() {
    local pattern="$1" message="$2" finding="$3"
    if printf '%s' "$LOGS" | grep -qiE "$pattern"; then
      fail "$message"
      add_finding "$finding"
    fi
  }
  check_log "password authentication failed|Access denied for user|WRONGPASS|NOAUTH|Authentication failed|auth error" \
    "The collector log shows the database REJECTING the login." \
    "Check DATABASE_USERNAME / DATABASE_PASSWORD. A password containing \$, # or spaces must be single-quoted in .env (install.sh does this)."
  check_log "permission denied|must be superuser|pg_monitor|command denied|NOPERM|not authorized on admin" \
    "The collector log shows missing privileges for the monitoring user." \
    "Grant the least-privilege role for $DATABASE_SYSTEM from the README (pg_monitor; PROCESS, REPLICATION CLIENT + performance_schema; the INFO/PING ACL; clusterMonitor)."
  check_log "SSL is not enabled on the server|x509:|tls: |certificate" \
    "The collector log shows a TLS problem." \
    "Match DATABASE_TLS_INSECURE to the server: true when it does not speak TLS, false when it requires it (plus DATABASE_TLS_INSECURE_SKIP_VERIFY=true for a certificate the image does not trust)."
  check_log "pg_stat_statements" \
    "Top queries are on but pg_stat_statements is missing." \
    "Run CREATE EXTENSION pg_stat_statements; in each monitored database, or set DATABASE_QUERY_EVENTS=false."
  if printf '%s' "$LOGS" | grep -q "Everything is ready"; then
    pass "The collector started its pipelines"
  fi
fi

# ----------------------------------------------------------------------------
section "4. OneUptime ingestion"
# ----------------------------------------------------------------------------
BASE_URL="${ONEUPTIME_URL%/}"
if [ -z "$BASE_URL" ] || [ -z "$TOKEN" ]; then
  fail "ONEUPTIME_URL or ONEUPTIME_TELEMETRY_INGESTION_KEY is empty."
  add_finding "Set both in $ENV_FILE (Project Settings → Telemetry & APM → Ingestion Keys)."
else
  OUT=$(agent_netns_curl -sS -m 15 -o /dev/null -w '%{http_code}' -H "x-oneuptime-token: $TOKEN" "$BASE_URL/otlp/v1/validate")
  CODE=$(printf '%s' "$OUT" | tail -c 3)
  case "$CODE" in
    200) pass "Reached OneUptime and the ingestion key is VALID (/otlp/v1/validate → 200)." ;;
    401|403)
      fail "Reached OneUptime, but it REJECTED the ingestion key (/otlp/v1/validate → $CODE)."
      add_finding "The ingestion key is wrong or revoked. OneUptime answers OTLP with a silent 200 on a bad key, so the collector log looks clean. Create a key under Project Settings → Telemetry & APM → Ingestion Keys."
      ;;
    404)
      OUT=$(agent_netns_curl -sS -m 15 -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" --data '{}' -H "x-oneuptime-token: $TOKEN" "$BASE_URL/fluentd/v1/logs")
      CODE=$(printf '%s' "$OUT" | tail -c 3)
      if [ "$CODE" = "400" ] || [ "$CODE" = "401" ]; then
        fail "OneUptime rejected the ingestion key (/fluentd/v1/logs → $CODE)."
        add_finding "The ingestion key is wrong or revoked."
      else
        pass "Reached OneUptime (legacy key check → $CODE)."
      fi
      ;;
    *)
      fail "Could not reach $BASE_URL from the agent's network (HTTP '$CODE')."
      add_finding "Check ONEUPTIME_URL and outbound HTTPS from this machine."
      ;;
  esac
fi

# ----------------------------------------------------------------------------
section "VERDICT"
# ----------------------------------------------------------------------------
if [ "$FAIL_COUNT" -eq 0 ]; then
  pass "No problems found ($WARN_COUNT warning(s)). Give it one collection interval, then look under Databases in OneUptime for $DATABASE_SERVER_ADDRESS:${DATABASE_SERVER_PORT:-?}."
  exit 0
fi
for finding in ${FINDINGS[@]+"${FINDINGS[@]}"}; do
  printf "  %s→%s %s\n" "$C_BOLD" "$C_OFF" "$finding"
done
exit 1
