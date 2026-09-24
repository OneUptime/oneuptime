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
# shares the agent's network namespace. That image is pinned by digest: it
# joins the agent's network and is handed the ingestion key, so it must be
# the image this script was written against, not whatever a tag points to
# today. The key reaches curl on stdin (`curl --config -`), never on a
# command line, where any local user could read it with `ps`.

set -uo pipefail

# ----------------------------------------------------------------------------
# Config / args
# ----------------------------------------------------------------------------
DIR="/opt/oneuptime-database-agent"
CURL_IMAGE="curlimages/curl:8.22.0@sha256:58adaa4e8dca9c988bae2aba4ab3434a0bb2da16bbe3f92dec39ec7785166777"
USE_COLOR=1

while [ $# -gt 0 ]; do
  case "$1" in
    -d|--dir)      DIR="${2:-}"; shift 2 ;;
    --curl-image)  CURL_IMAGE="${2:-}"; shift 2 ;;
    --no-color)    USE_COLOR=0; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,37p'
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
# follow the collector's real path (compose network, DNS, firewall). Curl
# also reads a config from stdin (`--config -`): what is piped in never
# appears on a command line. Callers with nothing to pipe close stdin.
agent_netns_curl() {
  if [ "$AGENT_RUNNING" = 1 ]; then
    docker run -i --rm --network "container:$AGENT_CONTAINER" "$CURL_IMAGE" "$@" 2>&1
  else
    docker run -i --rm "$CURL_IMAGE" "$@" 2>&1
  fi
}

# The ingestion-key header as a curl config line, for `--config -` on
# stdin. Curl config strings are double-quoted with \ escapes.
token_header_config() {
  local token="$1"
  token="${token//\\/\\\\}"
  token="${token//\"/\\\"}"
  printf 'header = "x-oneuptime-token: %s"\n' "$token"
}

# The config every engine uses (configs/<name>.yaml, named after its
# receiver) — the same mapping as install.sh's config_for_engine.
config_for_engine() {
  case "$1" in
    postgresql) printf 'postgresql' ;;
    mysql|mariadb) printf 'mysql' ;;
    redis|valkey|keydb|dragonfly) printf 'redis' ;;
    mongodb) printf 'mongodb' ;;
    microsoft.sql_server) printf 'sqlserver' ;;
    oracle.db) printf 'oracledb' ;;
    elasticsearch|opensearch) printf 'elasticsearch' ;;
    memcached) printf 'memcached' ;;
  esac
}

# The same lists install.sh checks against (keep the two in step).
is_local_only_host() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    ""|localhost|*.localhost|127.*|::1|"[::1]"|0.0.0.0|::|"(local)"|.) return 0 ;;
    host.docker.internal|host.containers.internal|gateway.docker.internal) return 0 ;;
    docker.for.mac.localhost|kubernetes.docker.internal) return 0 ;;
    *) return 1 ;;
  esac
}

# A private / CGNAT IPv4, an IPv6 unique-local address, a single-label name
# or a Kubernetes cluster-local name: only unique inside one network, so
# OneUptime never registers a database from it on its own.
is_network_local_name() {
  local host octet1 octet2
  host="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  if [[ "$host" =~ ^([0-9]+)\.([0-9]+)\.[0-9]+\.[0-9]+$ ]]; then
    octet1="${BASH_REMATCH[1]}"
    octet2="${BASH_REMATCH[2]}"
    [ "$octet1" -eq 10 ] && return 0
    [ "$octet1" -eq 172 ] && [ "$octet2" -ge 16 ] && [ "$octet2" -le 31 ] && return 0
    [ "$octet1" -eq 192 ] && [ "$octet2" -eq 168 ] && return 0
    [ "$octet1" -eq 100 ] && [ "$octet2" -ge 64 ] && [ "$octet2" -le 127 ] && return 0
    return 1
  fi
  case "$host" in
    f[cd]*:*) return 0 ;;
    *:*) return 1 ;;
    *.cluster.local|*.svc|*.svc.*) return 0 ;;
    *.*) return 1 ;;
    *) return 0 ;;
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

AGENT_CONFIG="$(config_for_engine "$DATABASE_SYSTEM")"
if [ -n "$AGENT_CONFIG" ]; then
  pass "Engine: $DATABASE_SYSTEM (configs/$AGENT_CONFIG.yaml)"
else
  fail "DATABASE_SYSTEM='$DATABASE_SYSTEM' is not an engine the agent ships a config for."
  add_finding "Set DATABASE_SYSTEM in $ENV_FILE to postgresql, mysql, mariadb, redis, valkey, keydb, dragonfly, mongodb, microsoft.sql_server, oracle.db, elasticsearch, opensearch or memcached, and re-run install.sh so the matching config is downloaded."
fi

if [ -f "$CONFIG_FILE" ] && [ -n "$AGENT_CONFIG" ]; then
  # The config's one receiver sits at two spaces under `receivers:`.
  if grep -q "^  $AGENT_CONFIG:\$" "$CONFIG_FILE"; then
    pass "otel-collector-config.yaml is the $AGENT_CONFIG config"
  else
    fail "otel-collector-config.yaml is not the $AGENT_CONFIG config (DATABASE_SYSTEM changed after install?)."
    add_finding "The collector config does not match DATABASE_SYSTEM ($DATABASE_SYSTEM). Re-run install.sh to download configs/$AGENT_CONFIG.yaml."
  fi
  # Older configs stamped a fixed engine instead of DATABASE_SYSTEM.
  if ! grep -q 'value: "${env:DATABASE_SYSTEM}"' "$CONFIG_FILE"; then
    warn "The config stamps a fixed db.system.name rather than DATABASE_SYSTEM ($DATABASE_SYSTEM), so the database shows the config's engine. Re-run install.sh for the current config."
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

DATABASE_SERVER_ID=$(agent_env DATABASE_SERVER_ID)
if [ -n "$DATABASE_SERVER_ID" ]; then
  if [[ "$DATABASE_SERVER_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
    pass "Linked to database $DATABASE_SERVER_ID (oneuptime.database.server.id)"
  else
    fail "DATABASE_SERVER_ID='$DATABASE_SERVER_ID' is not a database id (a UUID) — OneUptime ignores it."
    add_finding "Copy the id from the database's Documentation tab in OneUptime into DATABASE_SERVER_ID, then: cd $DIR && docker compose up -d"
  fi
elif [ -n "$DATABASE_SERVER_ADDRESS" ] && is_network_local_name "$DATABASE_SERVER_ADDRESS"; then
  warn "'$DATABASE_SERVER_ADDRESS' is only unique inside one network (private IP, single-label or cluster-local name), so OneUptime will not create a database from it on its own."
  add_finding "The data only joins a database that already has $DATABASE_SERVER_ADDRESS:${DATABASE_SERVER_PORT:-?} as an endpoint. Create it under Databases → Create Database with that address and port, or set DATABASE_SERVER_ID to the id on its Documentation tab."
fi

case "$AGENT_CONFIG" in
  postgresql|mysql|sqlserver|oracledb)
    if [ -z "$DATABASE_USERNAME" ]; then
      fail "DATABASE_USERNAME is empty — the $DATABASE_SYSTEM receiver refuses to start without one."
    fi
    ;;
esac
if [ "$AGENT_CONFIG" = "oracledb" ] && [ -z "$(agent_env DATABASE_ORACLE_SERVICE)" ]; then
  fail "DATABASE_ORACLE_SERVICE is empty — the Oracle receiver needs the service to connect to."
  add_finding "Set DATABASE_ORACLE_SERVICE in $ENV_FILE to the service name (e.g. FREEPDB1, ORCLPDB1), then: cd $DIR && docker compose up -d"
fi

# The collector expands $ inside the password once more ($$ → $, ${NAME} →
# another variable), so install.sh writes every $ doubled and marks the file.
# A password with a $ in an .env without that mark reaches the database
# altered. The password itself is never printed.
DATABASE_PASSWORD_VALUE=$(agent_env DATABASE_PASSWORD)
if [[ "$DATABASE_PASSWORD_VALUE" == *'$'* ]] && [ -f "$ENV_FILE" ] \
  && ! grep -q "escaped for the collector" "$ENV_FILE"; then
  warn "DATABASE_PASSWORD contains \$, which the collector expands (\$\$ becomes \$, \${NAME} becomes a variable) — and this .env was not written with every \$ doubled."
  add_finding "Write every \$ in DATABASE_PASSWORD (and DATABASE_USERNAME) as \$\$ in $ENV_FILE, or re-run install.sh, which does it for you. Then: cd $DIR && docker compose up -d"
fi
unset DATABASE_PASSWORD_VALUE

# ----------------------------------------------------------------------------
section "3. Database reachability & receiver errors"
# ----------------------------------------------------------------------------
if [ -n "$DATABASE_ENDPOINT" ]; then
  # Elasticsearch / OpenSearch endpoints are URLs.
  EP_HOSTPORT="${DATABASE_ENDPOINT#*://}"
  EP_HOSTPORT="${EP_HOSTPORT%%/*}"
  EP_HOST="${EP_HOSTPORT%:*}"
  EP_PORT="${EP_HOSTPORT##*:}"
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
  ALL_LOGS=$(docker logs --tail 300 "$AGENT_CONTAINER" 2>&1)
  # The database checks read only the receiver's own lines: a TLS or auth
  # error on the way to OneUptime is the exporter's, and must not read as a
  # database problem (it gets its own check below).
  RECEIVER_LOGS=$(printf '%s\n' "$ALL_LOGS" | grep '"otelcol.component.kind": "receiver"')
  # A failed EXPLAIN of a top query is not a missing grant: pg_monitor
  # deliberately gives no access to tables, and the plan just stays empty.
  # It gets its own check below and is kept out of the others.
  EXPLAIN_FAILURES=$(printf '%s\n' "$RECEIVER_LOGS" | grep -c 'failed to explain')
  # Match only the "error" field of each line: the receivers log the
  # (obfuscated) query text beside it, and a table named `certificates` or a
  # query mentioning `permission` must not read as a TLS or grant problem.
  ERRORS=$(printf '%s\n' "$RECEIVER_LOGS" | grep -v 'failed to explain' \
    | sed -nE 's/.*"error": "(([^"\\]|\\.)*)".*/\1/p')
  check_log() {
    local pattern="$1" message="$2" finding="$3"
    if printf '%s' "$ERRORS" | grep -qiE "$pattern"; then
      fail "$message"
      add_finding "$finding"
    fi
  }
  check_log "password authentication failed|Access denied for user|WRONGPASS|NOAUTH|Authentication failed|auth error|Login failed for user|ORA-01017|security_exception|status code 401|unable to authenticate" \
    "The collector log shows the database REJECTING the login." \
    "Check DATABASE_USERNAME / DATABASE_PASSWORD. The collector expands \$ inside them, so every \$ must be written as \$\$ in .env (install.sh does this); a password containing #, spaces or quotes must be quoted in .env (install.sh does this too)."
  check_log "permission denied|must be superuser|pg_monitor|command denied|NOPERM|not authorized on admin|VIEW SERVER STATE|VIEW SERVER PERFORMANCE STATE|ORA-00942|ORA-01031|status code 403" \
    "The collector log shows missing privileges for the monitoring user." \
    "Grant the least-privilege role for $DATABASE_SYSTEM from the README (pg_monitor; PROCESS, REPLICATION CLIENT + performance_schema; the INFO/PING ACL; clusterMonitor; VIEW SERVER STATE; SELECT_CATALOG_ROLE; the monitor privilege)."
  check_log "SSL is not enabled on the server|x509:|tls: |certificate verify|certificate signed by unknown|server gave HTTP response to HTTPS client|malformed HTTP response" \
    "The collector log shows a TLS problem." \
    "Match DATABASE_TLS_INSECURE to the server: true when it does not speak TLS, false when it requires it (plus DATABASE_TLS_INSECURE_SKIP_VERIFY=true for a certificate the image does not trust). For Elasticsearch / OpenSearch, DATABASE_ENDPOINT's http:// or https:// decides it — re-run install.sh after changing DATABASE_TLS_INSECURE."
  check_log "pg_stat_statements" \
    "Top queries are on but pg_stat_statements is missing." \
    "Run CREATE EXTENSION pg_stat_statements; in each monitored database, or set DATABASE_QUERY_EVENTS=false."
  if [ "$EXPLAIN_FAILURES" -gt 0 ]; then
    warn "$EXPLAIN_FAILURES top quer(y/ies) could not be EXPLAINed: explain plans need SELECT on the tables the queries touch, which pg_monitor does not grant. Metrics and top queries are unaffected; only the plans stay empty."
    add_finding "For explain plans on top queries, GRANT SELECT on the application's tables to the monitoring user (for example GRANT SELECT ON ALL TABLES IN SCHEMA app TO oneuptime_monitor), or accept empty plans."
  fi
  if printf '%s' "$ALL_LOGS" | grep '"otelcol.component.kind": "exporter"' | grep -q "Exporting failed"; then
    fail "The collector log shows exports to OneUptime failing."
    add_finding "The collector cannot deliver to ONEUPTIME_URL ($(agent_env ONEUPTIME_URL)). Check the URL, outbound HTTPS from this machine and, for a self-hosted server, its certificate. The ingestion check below narrows it down."
  fi
  if printf '%s' "$ALL_LOGS" | grep -q "Everything is ready"; then
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
  OUT=$(token_header_config "$TOKEN" | agent_netns_curl --config - -sS -m 15 -o /dev/null -w '%{http_code}' "$BASE_URL/otlp/v1/validate")
  CODE=$(printf '%s' "$OUT" | tail -c 3)
  case "$CODE" in
    200) pass "Reached OneUptime and the ingestion key is VALID (/otlp/v1/validate → 200)." ;;
    401|403)
      fail "Reached OneUptime, but it REJECTED the ingestion key (/otlp/v1/validate → $CODE)."
      add_finding "The ingestion key is wrong or revoked. OneUptime answers OTLP with a silent 200 on a bad key, so the collector log looks clean. Create a key under Project Settings → Telemetry & APM → Ingestion Keys."
      ;;
    404)
      OUT=$(token_header_config "$TOKEN" | agent_netns_curl --config - -sS -m 15 -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" --data '{}' "$BASE_URL/fluentd/v1/logs")
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
