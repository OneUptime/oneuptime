#!/usr/bin/env bash
#
# OneUptime Docker Swarm Agent — Diagnostic ("doctor")
# ----------------------------------------------------
# Run this on the swarm MANAGER node where the agent is installed. It
# explains the #1 confusing failure mode: the cluster shows "Disconnected"
# in OneUptime and no telemetry is ingested, yet the containers look
# healthy and the collector logs show no errors.
#
# Why that happens: the agent ships telemetry to `<url>/otlp/v1/*` with the
# ingestion key in the `x-oneuptime-service-token` header. If that key is
# missing, malformed, or revoked, the OTLP endpoints *deliberately return
# HTTP 200 and silently drop the data*. The collector reports success, logs
# nothing, and the cluster never flips to "connected" because connection
# status is driven purely by telemetry actually arriving.
#
# How it gets a definitive answer: from inside the agent container's network
# namespace it calls `GET <url>/otlp/v1/validate`, which returns a REAL
# status (200 valid / 401 invalid) instead of the silent 200.
#
# Usage:
#   ./troubleshoot.sh [-d INSTALL_DIR] [--skip-egress] [--curl-image IMG] [--no-color]
#
# Default: INSTALL_DIR=/opt/oneuptime-docker-swarm-agent
#
# Requires: docker. The collector image is distroless (no shell/curl), so
# network probes run a small curl image as a sibling container sharing the
# agent's network namespace — the exact path the collector itself uses.

set -uo pipefail

DIR="/opt/oneuptime-docker-swarm-agent"
SKIP_EGRESS=0
CURL_IMAGE="curlimages/curl:latest"
USE_COLOR=1
AGENT_CONTAINER="oneuptime-docker-swarm-agent"
INVENTORY_CONTAINER="oneuptime-docker-swarm-inventory"

while [ $# -gt 0 ]; do
  case "$1" in
    -d|--dir)      DIR="${2:-}"; shift 2 ;;
    --skip-egress) SKIP_EGRESS=1; shift ;;
    --curl-image)  CURL_IMAGE="${2:-}"; shift 2 ;;
    --no-color)    USE_COLOR=0; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,30p'
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

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

CONFIG_FILE="$DIR/otel-collector-config.yaml"
ENV_FILE="$DIR/.env"

agent_env() {
  local v=""
  v=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$AGENT_CONTAINER" 2>/dev/null \
        | sed -n "s/^$1=//p" | head -1)
  if [ -z "$v" ] && [ -f "$ENV_FILE" ]; then
    v=$(sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | tail -1)
  fi
  printf '%s' "$v"
}

RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""
agent_netns_req() {
  local method="$1" url="$2" token="$3"
  RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""
  local -a args=(-sS -m 15 -w $'\nOUSTATUS:%{http_code}' -X "$method" "$url")
  [ -n "$token" ] && args+=(-H "x-oneuptime-service-token: $token")
  [ "$method" = "POST" ] && args+=(-H "Content-Type: application/json" --data '{}')
  local raw=""
  if [ "${AGENT_RUNNING:-0}" = 1 ]; then
    raw=$(docker run --rm --network "container:$AGENT_CONTAINER" "$CURL_IMAGE" "${args[@]}" 2>&1)
  else
    raw=$(docker run --rm "$CURL_IMAGE" "${args[@]}" 2>&1)
  fi
  RESP_EXIT=$?
  RESP_CODE=$(printf '%s\n' "$raw" | sed -n 's/^OUSTATUS:\([0-9]\{3\}\).*/\1/p' | head -1)
  RESP_BODY=$(printf '%s\n' "$raw" | sed '/^OUSTATUS:/,$d' | head -c 1000)
  [ -z "$RESP_CODE" ] && RESP_CODE="000"
}
is_conn_fail() { [ "$RESP_CODE" = "000" ] || [ "${RESP_EXIT:-1}" != "0" ]; }

printf "%s%sOneUptime Docker Swarm Agent — Diagnostic%s\n" "$C_BOLD" "$C_BLU" "$C_OFF"
printf "%sInstall dir:%s %s\n" "$C_DIM" "$C_OFF" "$DIR"

# ----------------------------------------------------------------------------
section "1. Runtime"
# ----------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  fail "docker not found on PATH — run this on the swarm manager where the agent is installed."
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

AGENT_RUNNING=0
STATE=$(docker inspect -f '{{.State.Status}} restarting={{.State.Restarting}} restarts={{.RestartCount}}' "$AGENT_CONTAINER" 2>/dev/null)
if [ -z "$STATE" ]; then
  fail "Container '$AGENT_CONTAINER' does not exist."
  add_finding "The collector container isn't created. Start it: cd $DIR && docker compose up -d"
elif printf '%s' "$STATE" | grep -q '^running restarting=false'; then
  pass "Container '$AGENT_CONTAINER' is running ($STATE)"
  AGENT_RUNNING=1
else
  fail "Container '$AGENT_CONTAINER' is NOT healthy: $STATE"
  add_finding "The collector container is not running (state: $STATE). A restart loop usually means a config error — check: docker logs $AGENT_CONTAINER"
fi

INV_STATE=$(docker inspect -f '{{.State.Status}}' "$INVENTORY_CONTAINER" 2>/dev/null)
if [ -z "$INV_STATE" ]; then
  fail "Inventory poller '$INVENTORY_CONTAINER' does not exist — node/service/task lists will stay empty."
  add_finding "The inventory sidecar isn't created. It must run on a manager node. Start it: cd $DIR && docker compose up -d"
elif [ "$INV_STATE" = "running" ]; then
  pass "Inventory poller '$INVENTORY_CONTAINER' is running"
else
  fail "Inventory poller '$INVENTORY_CONTAINER' is NOT running (state: $INV_STATE)"
  add_finding "The inventory sidecar is down — the resource lists won't populate. Check: docker logs $INVENTORY_CONTAINER"
fi

# ----------------------------------------------------------------------------
section "2. Manager-node check (inventory)"
# ----------------------------------------------------------------------------
# The /nodes, /services, /tasks endpoints are manager-only. Probe the daemon
# via the same socket the inventory poller uses.
NODE_LS=$(docker node ls 2>&1)
if [ $? -eq 0 ]; then
  NODE_COUNT=$(printf '%s\n' "$NODE_LS" | grep -c -v '^ID' || true)
  pass "This is a swarm manager — 'docker node ls' works ($NODE_COUNT node(s) visible)."
else
  fail "'docker node ls' failed — this node is NOT a swarm manager (or not in a swarm)."
  detail "$(printf '%s' "$NODE_LS" | head -c 160)"
  add_finding "Run the agent on a MANAGER node. The inventory poller needs the manager API; on a worker it can only ship container metrics/logs, and the resource lists stay empty."
fi

# Has the poller written a snapshot yet?
if [ "${INV_STATE:-}" = "running" ]; then
  INV_LOG=$(docker exec "$INVENTORY_CONTAINER" sh -c 'wc -l < /var/log/oneuptime-docker-swarm-inventory.log 2>/dev/null' 2>/dev/null | tr -d '[:space:]')
  if [ -n "$INV_LOG" ] && [ "$INV_LOG" -gt 0 ] 2>/dev/null; then
    pass "Inventory snapshot present ($INV_LOG record(s) in the latest snapshot)."
  else
    warn "Inventory snapshot is empty or not written yet — give the poller one interval (default 5 min), then re-check."
  fi
fi

# ----------------------------------------------------------------------------
section "3. Cluster-name stamping"
# ----------------------------------------------------------------------------
CLUSTER_NAME=$(agent_env DOCKER_SWARM_CLUSTER_NAME)
CLUSTER_NAME_OK=0
if [ -n "$CLUSTER_NAME" ]; then
  info "Reporting as cluster name: '${C_BOLD}${CLUSTER_NAME}${C_OFF}' (the docker.swarm.cluster.name OneUptime keys on)"
  detail "If this differs from a previous install, OneUptime shows a NEW cluster entry; the old one stays 'Disconnected'."
  CLUSTER_NAME_OK=1
else
  fail "DOCKER_SWARM_CLUSTER_NAME is empty — without it no Docker Swarm cluster registers in OneUptime."
  add_finding "Set DOCKER_SWARM_CLUSTER_NAME in $ENV_FILE and restart the agent. Discovery keys on the docker.swarm.cluster.name resource attribute it feeds."
fi
if [ -f "$CONFIG_FILE" ]; then
  if grep -q 'docker.swarm.cluster.name' "$CONFIG_FILE"; then
    pass "Collector config stamps the docker.swarm.cluster.name resource attribute."
  else
    fail "Collector config has NO docker.swarm.cluster.name resource processor — telemetry will not attribute to a cluster."
    add_finding "The resource processor stamping docker.swarm.cluster.name was removed from $CONFIG_FILE. Restore the shipped config."
  fi
else
  warn "Config file $CONFIG_FILE not found — skipping (custom install dir? re-run with -d). The published image also bakes the config."
fi

# ----------------------------------------------------------------------------
section "4. Ingestion token (shape)"
# ----------------------------------------------------------------------------
TOKEN=$(agent_env ONEUPTIME_SERVICE_TOKEN)
TOKEN_SHAPE_OK=0; TOKEN_HAS_WS=0
UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
if [ -z "$TOKEN" ]; then
  fail "ONEUPTIME_SERVICE_TOKEN is not set."
  add_finding "Set ONEUPTIME_SERVICE_TOKEN in $ENV_FILE (Project Settings → Telemetry Ingestion Keys) and restart the agent."
else
  TRIMMED=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
  MASK="${TRIMMED:0:8}…${TRIMMED: -4}"
  if [ "$TOKEN" != "$TRIMMED" ]; then
    fail "Token contains whitespace — the collector sends it literally, so OneUptime can't match it."
    add_finding "ONEUPTIME_SERVICE_TOKEN has stray whitespace in $ENV_FILE. Re-paste it cleanly and restart the agent."
    TOKEN_HAS_WS=1
  fi
  TOKEN="$TRIMMED"
  if [[ "$TRIMMED" =~ $UUID_RE ]]; then
    if [ "$TOKEN_HAS_WS" = 1 ]; then
      info "Underlying value (trimmed) IS a valid UUID ($MASK) — only the stray whitespace needs fixing."
    else
      pass "Token present and well-formed (UUID): $MASK"
      TOKEN_SHAPE_OK=1
    fi
  else
    fail "Token is not a valid UUID: '${MASK}' (len=${#TRIMMED})"
    add_finding "The ingestion key is not a UUID, so OneUptime can never resolve it (telemetry is silently dropped). Set a real Telemetry Ingestion Key."
  fi
fi

# ----------------------------------------------------------------------------
section "5. Collector health & self-metrics"
# ----------------------------------------------------------------------------
SENT="?"; FAILED="?"; ACCEPTED="?"
if [ "$AGENT_RUNNING" = 1 ]; then
  SELF=$(docker run --rm --network "container:$AGENT_CONTAINER" "$CURL_IMAGE" -sS -m 5 "http://127.0.0.1:8888/metrics" 2>/dev/null)
  if [ -n "$SELF" ]; then
    ACCEPTED=$(printf '%s\n' "$SELF" | awk '/^otelcol_receiver_accepted_metric_points/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    SENT=$(printf '%s\n' "$SELF" | awk '/^otelcol_exporter_sent_metric_points/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    FAILED=$(printf '%s\n' "$SELF" | awk '/^otelcol_exporter_send_failed_/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    info "Collector self-metrics: accepted=$ACCEPTED sent=$SENT send_failed=$FAILED"
    if [ "${FAILED:-0}" -gt 0 ] 2>/dev/null; then
      fail "Collector reports send_failed > 0 → exports are erroring (network/URL/TLS)."
      add_finding "Collector send_failed=$FAILED. The collector cannot deliver to OneUptime — investigate egress/DNS/TLS/firewall (next section)."
    elif [ "${SENT:-0}" -gt 0 ] 2>/dev/null; then
      pass "Bytes are leaving the collector and the server is returning 2xx."
      detail "NOTE: a bad token ALSO returns 2xx (silent drop). The token probe below settles it."
    fi
  else
    warn "Couldn't scrape collector self-metrics (:8888) — skipping (telemetry address may be customized)."
  fi
else
  warn "Collector container not running — skipping self-metrics."
fi

# ----------------------------------------------------------------------------
section "6. Egress + DEFINITIVE token check"
# ----------------------------------------------------------------------------
TOKEN_VERDICT="UNKNOWN"
EGRESS="UNKNOWN"
BASE_URL=$(agent_env ONEUPTIME_URL)
BASE_URL="${BASE_URL%/}"

token_invalid_finding() {
  add_finding "DEFINITIVE: the ingestion key is unknown/revoked server-side. On /otlp this is hidden behind a silent 200, which is why the agent looks healthy while nothing ingests. FIX: copy a live Telemetry Ingestion Key in OneUptime, update ONEUPTIME_SERVICE_TOKEN in $ENV_FILE, then: cd $DIR && docker compose up -d"
}

if [ "$SKIP_EGRESS" = 1 ]; then
  warn "Egress test skipped (--skip-egress)."; EGRESS="SKIPPED"
elif [ -z "$BASE_URL" ]; then
  warn "ONEUPTIME_URL is not set; cannot run the egress/token probe."; EGRESS="SKIPPED"
  add_finding "Set ONEUPTIME_URL in $ENV_FILE (e.g. https://oneuptime.com) and restart the agent."
elif ! [[ "$TOKEN" =~ ^[A-Za-z0-9-]+$ ]]; then
  warn "Token unusable/missing; cannot run the authenticated probe (fix Section 4 first)."; EGRESS="SKIPPED"
else
  agent_netns_req GET "$BASE_URL/otlp/v1/validate" "$TOKEN"
  if [ "$RESP_CODE" = "200" ]; then
    pass "Reached OneUptime and the ingestion token is VALID (/otlp/v1/validate → 200)."
    EGRESS="OK"; TOKEN_VERDICT="VALID"
  elif [ "$RESP_CODE" = "401" ] || [ "$RESP_CODE" = "403" ]; then
    fail "Reached OneUptime, but it REJECTED the token (/otlp/v1/validate → $RESP_CODE)."
    EGRESS="OK"; TOKEN_VERDICT="INVALID"; token_invalid_finding
  elif [ "$RESP_CODE" = "404" ]; then
    info "Validation endpoint not on this server version (404) — confirming reachability only."
    agent_netns_req POST "$BASE_URL/otlp/v1/metrics" "$TOKEN"
    if is_conn_fail; then
      fail "Cannot reach $BASE_URL/otlp/v1/metrics from the agent's network (curl exit ${RESP_EXIT:-?})."
      EGRESS="FAIL"
      add_finding "Egress to $BASE_URL failed from the collector container. Verify ONEUPTIME_URL and that this machine can reach it (DNS/TLS/firewall)."
    else
      pass "Reachable: $BASE_URL/otlp/v1/metrics returned HTTP $RESP_CODE (token check inconclusive on this server version)."
      EGRESS="OK"; TOKEN_VERDICT="INCONCLUSIVE"
    fi
  elif is_conn_fail; then
    fail "Cannot reach $BASE_URL/otlp/v1/validate from the agent's network (curl exit ${RESP_EXIT:-?})."
    EGRESS="FAIL"
    detail "curl: $(printf '%s' "$RESP_BODY" | tr '\n' ' ' | head -c 200)"
    add_finding "Egress to $BASE_URL failed from the collector container. Check ONEUPTIME_URL, DNS, TLS, and firewall/proxy egress."
  else
    warn "Unexpected HTTP $RESP_CODE from /otlp/v1/validate."; EGRESS="OK"
  fi
fi

# ----------------------------------------------------------------------------
section "7. Recent collector errors"
# ----------------------------------------------------------------------------
if [ "$AGENT_RUNNING" = 1 ] || [ -n "$STATE" ]; then
  LOGERR=$(docker logs --tail 500 "$AGENT_CONTAINER" 2>&1 \
    | grep -iE 'error|failed|denied|refused|x509|tls|deadline|429|throttl' | tail -50)
  if [ -n "$LOGERR" ]; then
    warn "Recent error-ish log lines from the collector (last 50):"
    printf '%s\n' "$LOGERR" | while read -r l; do detail "$(printf '%s' "$l" | head -c 160)"; done
  else
    pass "No export errors in recent collector logs."
    detail "(Expected when a token is silently dropped — absence of errors does NOT mean data is landing.)"
  fi
fi

# ============================================================================
section "8. VERDICT"
# ============================================================================
if [ "$AGENT_RUNNING" != 1 ]; then
  printf "%s%sROOT CAUSE: the collector container isn't running.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "Fix the container (see Section 1) — until it runs, nothing is shipped.\n"
elif [ "$TOKEN_VERDICT" = "INVALID" ]; then
  printf "%s%sROOT CAUSE: the ingestion token is rejected by OneUptime.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "The classic trap: /otlp returns 200 and drops the data, so the agent looks\n"
  printf "healthy while the cluster stays Disconnected with no telemetry.\n"
elif [ "$EGRESS" = "FAIL" ]; then
  printf "%s%sROOT CAUSE: the agent can't deliver telemetry to OneUptime (network/URL/TLS).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$CLUSTER_NAME_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: DOCKER_SWARM_CLUSTER_NAME is missing — no cluster can register.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$TOKEN_HAS_WS" = 1 ]; then
  printf "%s%sROOT CAUSE: the ingestion key has stray whitespace.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$TOKEN_SHAPE_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: the ingestion key is empty/malformed.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$TOKEN_VERDICT" = "VALID" ]; then
  printf "%s%sThe agent looks healthy and OneUptime accepts the token.%s\n" "$C_BOLD" "$C_GRN" "$C_OFF"
  printf "If the dashboard still says Disconnected, give it ~2-5 min (status flips on the\n"
  printf "next telemetry batch; the disconnect cron runs on a 5-minute cycle). If the\n"
  printf "resource lists are empty, confirm the inventory poller runs on a MANAGER (Section 2).\n"
else
  printf "%sInconclusive from this machine.%s On the OneUptime server, search ingest logs for\n" "$C_BOLD" "$C_OFF"
  printf "\"Invalid service token\", and confirm the key under Project Settings → Telemetry Ingestion Keys.\n"
fi

if [ ${#FINDINGS[@]} -gt 0 ]; then
  printf "\n%sFindings:%s\n" "$C_BOLD" "$C_OFF"
  i=1
  for f in "${FINDINGS[@]}"; do printf "  %d. %s\n" "$i" "$f"; i=$((i+1)); done
fi

printf "\n%s%d failed check(s), %d warning(s).%s\n" "$C_DIM" "$FAIL_COUNT" "$WARN_COUNT" "$C_OFF"
[ "$FAIL_COUNT" -gt 0 ] && exit 1
exit 0
