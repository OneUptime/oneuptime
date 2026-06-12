#!/usr/bin/env bash
#
# OneUptime Proxmox Agent — Diagnostic ("doctor")
# ------------------------------------------------
# Run this on the machine where the agent is installed (docker compose,
# optionally wrapped by the systemd unit). It explains the #1 confusing
# failure mode: the cluster shows "Disconnected" in OneUptime and no metrics
# are ingested, yet the containers look healthy and the collector logs show
# no errors.
#
# Why that happens: the agent ships telemetry to `<url>/otlp/v1/*` with the
# ingestion key in the `x-oneuptime-token` header. If that key is missing,
# malformed, or revoked, the OTLP endpoints *deliberately return HTTP 200 and
# silently drop the data* (so a misconfigured collector can't retry-flood the
# server). The collector therefore reports success, logs nothing, and the
# cluster never flips to "connected" because connection status is driven
# purely by telemetry actually arriving.
#
# How it gets a definitive answer: from inside the agent container's network
# namespace it calls `GET <url>/otlp/v1/validate`, a validation endpoint that
# returns a REAL status (200 valid / 401 invalid) instead of the silent 200.
# On older servers that lack it, it falls back to `POST <url>/fluentd/v1/logs`,
# which runs the SAME auth but is NOT an /otlp path — so a bad token returns
# `400 Invalid service token` rather than the silent 200.
#
# Usage:
#   ./troubleshoot.sh [-d INSTALL_DIR] [--skip-egress] [--curl-image IMG] [--no-color]
#
# Defaults: INSTALL_DIR=/opt/oneuptime-proxmox-agent
#
# Requires: docker (required). The collector image is distroless (no shell,
# no curl), so the network probes run a small curl image as a sibling
# container sharing the agent's network namespace — the exact path the
# collector itself uses.

set -uo pipefail

# ----------------------------------------------------------------------------
# Config / args
# ----------------------------------------------------------------------------
DIR="/opt/oneuptime-proxmox-agent"
SKIP_EGRESS=0
CURL_IMAGE="curlimages/curl:latest"
USE_COLOR=1
AGENT_CONTAINER="oneuptime-proxmox-agent"
EXPORTER_CONTAINER="oneuptime-pve-exporter"

while [ $# -gt 0 ]; do
  case "$1" in
    -d|--dir)      DIR="${2:-}"; shift 2 ;;
    --skip-egress) SKIP_EGRESS=1; shift ;;
    --curl-image)  CURL_IMAGE="${2:-}"; shift 2 ;;
    --no-color)    USE_COLOR=0; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,35p'
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

# Read an env var as the running container actually sees it (compose defaults
# included). Falls back to the .env file when the container isn't running.
agent_env() {
  local v=""
  v=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$AGENT_CONTAINER" 2>/dev/null \
        | sed -n "s/^$1=//p" | head -1)
  if [ -z "$v" ] && [ -f "$ENV_FILE" ]; then
    v=$(sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | tail -1)
  fi
  printf '%s' "$v"
}

# Globals populated by agent_netns_req()
RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""

# Make an HTTP request ($1=GET|POST, $2=url, $3=token or "") from INSIDE the
# agent container's network namespace, so it follows the collector's real
# path: compose network, DNS, proxy, firewall, TLS. The collector image is
# distroless, so we run a sibling curl container with --network container:.
agent_netns_req() {
  local method="$1" url="$2" token="$3"
  RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""
  local -a args=(-sS -m 15 -w $'\nOUSTATUS:%{http_code}' -X "$method" "$url")
  [ -n "$token" ] && args+=(-H "x-oneuptime-token: $token")
  [ "$method" = "POST" ] && args+=(-H "Content-Type: application/json" --data '{}')
  local raw=""
  if [ "${AGENT_RUNNING:-0}" = 1 ]; then
    raw=$(docker run --rm --network "container:$AGENT_CONTAINER" "$CURL_IMAGE" "${args[@]}" 2>&1)
  else
    # Agent container down — probe from the default bridge instead (close
    # enough for an egress verdict; the runtime section already failed).
    raw=$(docker run --rm "$CURL_IMAGE" "${args[@]}" 2>&1)
  fi
  RESP_EXIT=$?
  RESP_CODE=$(printf '%s\n' "$raw" | sed -n 's/^OUSTATUS:\([0-9]\{3\}\).*/\1/p' | head -1)
  RESP_BODY=$(printf '%s\n' "$raw" | sed '/^OUSTATUS:/,$d' | head -c 1000)
  [ -z "$RESP_CODE" ] && RESP_CODE="000"
}

# A hard connectivity failure (no HTTP response at all).
is_conn_fail() { [ "$RESP_CODE" = "000" ] || [ "${RESP_EXIT:-1}" != "0" ]; }

# ============================================================================
printf "%s%sOneUptime Proxmox Agent — Diagnostic%s\n" "$C_BOLD" "$C_BLU" "$C_OFF"
printf "%sInstall dir:%s %s\n" "$C_DIM" "$C_OFF" "$DIR"

# ----------------------------------------------------------------------------
section "1. Runtime"
# ----------------------------------------------------------------------------
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
  SYSD=$(systemctl is-active oneuptime-proxmox-agent 2>/dev/null || true)
  [ "$SYSD" = "active" ] && info "systemd unit oneuptime-proxmox-agent is active."
fi

AGENT_RUNNING=0
STATE=$(docker inspect -f '{{.State.Status}} restarting={{.State.Restarting}} restarts={{.RestartCount}}' "$AGENT_CONTAINER" 2>/dev/null)
if [ -z "$STATE" ]; then
  fail "Container '$AGENT_CONTAINER' does not exist."
  add_finding "The agent container isn't created. Start it: cd $DIR && docker compose up -d"
elif printf '%s' "$STATE" | grep -q '^running restarting=false'; then
  pass "Container '$AGENT_CONTAINER' is running ($STATE)"
  AGENT_RUNNING=1
else
  fail "Container '$AGENT_CONTAINER' is NOT healthy: $STATE"
  add_finding "The agent container is not running (state: $STATE). A restart loop usually means a config error — check: docker logs $AGENT_CONTAINER"
fi

# Bundled exporter (only when the pve-exporter compose profile is enabled).
EXPORTER_BUNDLED=0
EXP_STATE=$(docker inspect -f '{{.State.Status}}' "$EXPORTER_CONTAINER" 2>/dev/null)
if [ -n "$EXP_STATE" ]; then
  EXPORTER_BUNDLED=1
  if [ "$EXP_STATE" = "running" ]; then
    pass "Bundled exporter '$EXPORTER_CONTAINER' is running"
  else
    fail "Bundled exporter '$EXPORTER_CONTAINER' is NOT running (state: $EXP_STATE)"
    add_finding "The bundled pve-exporter container is down — the agent has nothing to scrape. Check: docker logs $EXPORTER_CONTAINER"
  fi
else
  info "No bundled exporter container — assuming an external pve-exporter (PVE_EXPORTER_URL)."
fi

# ----------------------------------------------------------------------------
section "2. pve-exporter reachability"
# ----------------------------------------------------------------------------
PVE_EXPORTER_URL=$(agent_env PVE_EXPORTER_URL)
[ -z "$PVE_EXPORTER_URL" ] && PVE_EXPORTER_URL="pve-exporter:9221"
PVE_HOST=$(agent_env PVE_HOST)
EXPORTER_OK=0

if [ -z "$PVE_HOST" ]; then
  fail "PVE_HOST is not set — the exporter doesn't know which Proxmox VE API host to query."
  add_finding "Set PVE_HOST in $ENV_FILE to any node of the cluster (e.g. 192.168.1.10) and restart: docker compose up -d"
else
  info "Exporter: $PVE_EXPORTER_URL  →  Proxmox VE API host: $PVE_HOST"
  # The localhost trap: inside the agent container, localhost is the agent
  # itself — it can never reach an exporter running on this machine.
  case "$PVE_EXPORTER_URL" in
    localhost:*|127.0.0.1:*)
      fail "PVE_EXPORTER_URL is '$PVE_EXPORTER_URL' — inside the agent container that is the agent itself, not this machine."
      add_finding "PVE_EXPORTER_URL must be reachable from a container: use the host's LAN IP or DNS name (or host.docker.internal on Docker Desktop), never localhost." ;;
  esac

  # Scrape exactly what the collector scrapes, from the collector's netns.
  SCRAPE_URL="http://${PVE_EXPORTER_URL}/pve?target=${PVE_HOST}&cluster=1&node=1"
  if [ "$AGENT_RUNNING" = 1 ]; then
    SCRAPE_OUT=$(docker run --rm --network "container:$AGENT_CONTAINER" "$CURL_IMAGE" -sS -m 30 "$SCRAPE_URL" 2>&1)
  else
    SCRAPE_OUT=$(docker run --rm "$CURL_IMAGE" -sS -m 30 "$SCRAPE_URL" 2>&1)
  fi
  SCRAPE_EXIT=$?
  PVE_SERIES=$(printf '%s\n' "$SCRAPE_OUT" | grep -c '^pve_' 2>/dev/null || true)
  if [ "$SCRAPE_EXIT" != "0" ]; then
    fail "Cannot reach the exporter at $PVE_EXPORTER_URL from the agent's network."
    detail "curl: $(printf '%s' "$SCRAPE_OUT" | tr '\n' ' ' | head -c 200)"
    add_finding "The collector cannot scrape $PVE_EXPORTER_URL. If you run your own exporter, verify the address is container-reachable; if you meant the bundled one, set COMPOSE_PROFILES=pve-exporter and restart."
  elif printf '%s\n' "$SCRAPE_OUT" | grep -q '^pve_up'; then
    pass "Exporter scrape OK — $PVE_SERIES pve_* series (pve_up present)."
    EXPORTER_OK=1
  elif [ "${PVE_SERIES:-0}" -gt 0 ] 2>/dev/null; then
    warn "Exporter answered with $PVE_SERIES pve_* series but no pve_up — partial scrape; check the exporter logs."
    EXPORTER_OK=1
  else
    fail "Exporter answered but returned ZERO pve_* series — it cannot read the Proxmox VE API."
    detail "Response head: $(printf '%s' "$SCRAPE_OUT" | head -c 200)"
    add_finding "The exporter reaches no PVE data: the API token is wrong or under-privileged. Check PVE_API_TOKEN_ID (user@realm!tokenname) / PVE_API_TOKEN_SECRET, and that the token has the PVEAuditor role on path / (privilege separation disabled or permissions granted to the token itself)."
    if [ "$EXPORTER_BUNDLED" = 1 ]; then
      AUTHERR=$(docker logs --tail 50 "$EXPORTER_CONTAINER" 2>&1 | grep -iE '401|595|auth|permission|denied' | tail -3)
      if [ -n "$AUTHERR" ]; then
        warn "Exporter log shows auth errors:"
        printf '%s\n' "$AUTHERR" | while read -r l; do detail "$(printf '%s' "$l" | head -c 160)"; done
      fi
    fi
  fi
fi

# ----------------------------------------------------------------------------
section "3. Cluster-name stamping"
# ----------------------------------------------------------------------------
# A missing proxmox.cluster.name is the exact analog of the Kubernetes agent's
# "no k8s.cluster.name ⇒ the cluster never connects" failure: discovery keys
# on that resource attribute, so without it metrics ingest into the project
# but no Proxmox cluster ever appears.
CLUSTER_NAME=$(agent_env PROXMOX_CLUSTER_NAME)
CLUSTER_NAME_OK=0
if [ -n "$CLUSTER_NAME" ]; then
  info "Reporting as cluster name: '${C_BOLD}${CLUSTER_NAME}${C_OFF}'  (this is the proxmox.cluster.name OneUptime keys on)"
  detail "If this differs from a previous install, OneUptime shows a NEW cluster entry; the old one stays 'Disconnected'."
  CLUSTER_NAME_OK=1
else
  fail "PROXMOX_CLUSTER_NAME is empty — without it no Proxmox cluster registers in OneUptime."
  add_finding "Set PROXMOX_CLUSTER_NAME in $ENV_FILE and restart the agent. Discovery keys on the proxmox.cluster.name resource attribute it feeds."
fi
if [ -f "$CONFIG_FILE" ]; then
  if grep -q 'proxmox.cluster.name' "$CONFIG_FILE"; then
    pass "Collector config stamps the proxmox.cluster.name resource attribute."
  else
    fail "Collector config has NO proxmox.cluster.name resource processor — metrics will not attribute to a cluster."
    add_finding "The resource processor stamping proxmox.cluster.name was removed from $CONFIG_FILE. Restore the shipped config."
  fi
else
  warn "Config file $CONFIG_FILE not found — skipping the config check (custom install dir? re-run with -d)."
fi

# ----------------------------------------------------------------------------
section "4. Ingestion token (shape)"
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
    add_finding "The ingestion key is not a UUID, so OneUptime can never resolve it (telemetry is silently dropped). Set a real Telemetry Ingestion Key."
  fi
fi

# ----------------------------------------------------------------------------
section "5. Collector health & self-metrics"
# ----------------------------------------------------------------------------
# The collector serves its own metrics on localhost:8888 inside the container
# (default internal telemetry) — reachable only from its network namespace.
SENT="?"; FAILED="?"; ACCEPTED="?"
if [ "$AGENT_RUNNING" = 1 ]; then
  SELF=$(docker run --rm --network "container:$AGENT_CONTAINER" "$CURL_IMAGE" -sS -m 5 "http://127.0.0.1:8888/metrics" 2>/dev/null)
  if [ -n "$SELF" ]; then
    ACCEPTED=$(printf '%s\n' "$SELF" | awk '/^otelcol_receiver_accepted_metric_points/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    SENT=$(printf '%s\n' "$SELF" | awk '/^otelcol_exporter_sent_metric_points/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    FAILED=$(printf '%s\n' "$SELF" | awk '/^otelcol_exporter_send_failed_/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    info "Collector self-metrics: accepted=$ACCEPTED  sent=$SENT  send_failed=$FAILED"
    if [ "${FAILED:-0}" -gt 0 ] 2>/dev/null; then
      fail "Collector reports send_failed > 0 → exports are erroring (network/URL/TLS)."
      add_finding "Collector send_failed=$FAILED. The collector cannot deliver to OneUptime — investigate egress/DNS/TLS/firewall (next section)."
    elif [ "${ACCEPTED:-0}" -eq 0 ] 2>/dev/null; then
      warn "No datapoints accepted yet — the scrape is failing (see Section 2) or the collector started <30s ago."
    elif [ "${SENT:-0}" -gt 0 ] 2>/dev/null; then
      pass "Bytes are leaving the collector and the server is returning 2xx."
      detail "NOTE: a bad token ALSO returns 2xx (silent drop). The token probe below settles it."
    fi
  else
    warn "Couldn't scrape collector self-metrics (:8888) — skipping (telemetry address may be customized)."
  fi
else
  warn "Agent container not running — skipping self-metrics."
fi

# ----------------------------------------------------------------------------
section "6. Egress + DEFINITIVE token check"
# ----------------------------------------------------------------------------
# This is the part you can't see from the agent side. From the agent's own
# network namespace we ask OneUptime's validation endpoint for a real verdict:
#   GET /otlp/v1/validate  → 200 {valid:true} | 401 {valid:false}
# Older servers without that endpoint (404) fall back to:
#   POST /otlp/v1/metrics → reachability only (returns 200 even on a bad token)
#   POST /fluentd/v1/logs → bad token returns 400 "Invalid service token"
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
  add_finding "DEFINITIVE: the ingestion key is unknown/revoked server-side. On /otlp this is hidden behind a silent 200, which is why the agent looks healthy while nothing ingests. FIX: create or copy a live Telemetry Ingestion Key in OneUptime, update ONEUPTIME_TELEMETRY_INGESTION_KEY in $ENV_FILE, then: cd $DIR && docker compose up -d"
}

# Fallback token oracle for servers without /otlp/v1/validate.
fluentd_token_probe() {
  agent_netns_req POST "$BASE_URL/fluentd/v1/logs" "$TOKEN"
  case "$RESP_BODY" in
    *"Invalid service token"*)
      fail "OneUptime REJECTED this token: \"Invalid service token\" (HTTP $RESP_CODE)."
      TOKEN_VERDICT="INVALID"; token_invalid_finding ;;
    *"Missing header"*)
      fail "Server says the token header is missing (HTTP $RESP_CODE) — a proxy may be stripping it."
      TOKEN_VERDICT="INVALID"
      add_finding "The x-oneuptime-token header isn't arriving at OneUptime — check any egress proxy that might strip headers." ;;
    *)
      if [ "$RESP_CODE" = "404" ]; then
        warn "/fluentd/v1/logs returned 404 — token check inconclusive."
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
    info "Validation endpoint not on this server version (404) — falling back to legacy probes."
    agent_netns_req POST "$BASE_URL/otlp/v1/metrics" "$TOKEN"
    if is_conn_fail; then
      egress_fail_finding "$BASE_URL/otlp/v1/metrics"
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
  printf "%s%sROOT CAUSE: the agent container isn't running.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "Fix the container (see Section 1) — until it runs, nothing is scraped or shipped.\n"
elif [ "$TOKEN_VERDICT" = "INVALID" ]; then
  printf "%s%sROOT CAUSE: the ingestion token is rejected by OneUptime.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "This is the classic trap: /otlp returns 200 and drops the data, so the agent\n"
  printf "looks healthy while the cluster stays Disconnected with no metrics.\n"
elif [ "$EGRESS" = "FAIL" ]; then
  printf "%s%sROOT CAUSE: the agent can't deliver telemetry to OneUptime (network/URL/TLS).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$EXPORTER_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: the collector has no pve metrics to ship (exporter scrape failing).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "Fix the exporter (see Section 2) — usually the PVE API token or PVE_EXPORTER_URL.\n"
elif [ "$CLUSTER_NAME_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: PROXMOX_CLUSTER_NAME is missing — no cluster can register.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$TOKEN_HAS_WS" = 1 ]; then
  printf "%s%sROOT CAUSE: the ingestion key has stray whitespace.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "The collector sends the key with that whitespace, so OneUptime can't match it and\n"
  printf "drops the data behind /otlp's silent 200. Fix %s and restart.\n" "$ENV_FILE"
elif [ "$TOKEN_SHAPE_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: the ingestion key is empty/malformed.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$TOKEN_VERDICT" = "VALID" ]; then
  printf "%s%sThe agent looks healthy and OneUptime accepts the token.%s\n" "$C_BOLD" "$C_GRN" "$C_OFF"
  printf "If the dashboard still says Disconnected:\n"
  printf "  1. Give it ~2-5 min — status flips to Connected on the next telemetry batch,\n"
  printf "     and the disconnect cron runs on a 5-minute cycle.\n"
  printf "  2. Look for a %sNEW%s cluster entry named '%s' — if you changed the cluster name,\n" "$C_BOLD" "$C_OFF" "${CLUSTER_NAME:-?}"
  printf "     the OLD entry stays Disconnected (that's expected; it's stale).\n"
else
  printf "%sInconclusive from this machine.%s Next steps:\n" "$C_BOLD" "$C_OFF"
  printf "  • On the OneUptime server, search ingest logs for: \"Invalid service token\".\n"
  printf "  • Confirm the key under Project Settings → Telemetry Ingestion Keys still exists.\n"
  if [ -n "$BASE_URL" ]; then
    printf "  • Run the definitive token check by hand (200 = valid, 401 = bad/revoked key):\n"
    printf "      %sdocker run --rm --network container:%s %s \\\\\n        -i -H \"x-oneuptime-token: <key>\" %s/otlp/v1/validate%s\n" \
      "$C_DIM" "$AGENT_CONTAINER" "$CURL_IMAGE" "$BASE_URL" "$C_OFF"
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
