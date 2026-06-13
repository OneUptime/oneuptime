#!/usr/bin/env bash
#
# OneUptime Ceph Agent — Diagnostic ("doctor")
# ---------------------------------------------
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
# It also catches the Ceph-specific trap: only the ACTIVE mgr returns
# metrics — standbys answer with an empty body (or a redirect/error). If you
# scrape only one mgr and it goes standby after a failover, metrics silently
# stop with zero errors anywhere.
#
# Usage:
#   ./troubleshoot.sh [-d INSTALL_DIR] [--skip-egress] [--curl-image IMG] [--no-color]
#
# Defaults: INSTALL_DIR=/opt/oneuptime-ceph-agent
#
# Requires: docker (required). The collector image is distroless (no shell,
# no curl), so the network probes run a small curl image as a sibling
# container sharing the agent's network namespace — the exact path the
# collector itself uses.

set -uo pipefail

# ----------------------------------------------------------------------------
# Config / args
# ----------------------------------------------------------------------------
DIR="/opt/oneuptime-ceph-agent"
SKIP_EGRESS=0
CURL_IMAGE="curlimages/curl:latest"
USE_COLOR=1
AGENT_CONTAINER="oneuptime-ceph-agent"

while [ $# -gt 0 ]; do
  case "$1" in
    -d|--dir)      DIR="${2:-}"; shift 2 ;;
    --skip-egress) SKIP_EGRESS=1; shift ;;
    --curl-image)  CURL_IMAGE="${2:-}"; shift 2 ;;
    --no-color)    USE_COLOR=0; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,40p'
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
# path: DNS, proxy, firewall, TLS. The collector image is distroless, so we
# run a sibling curl container with --network container:.
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
printf "%s%sOneUptime Ceph Agent — Diagnostic%s\n" "$C_BOLD" "$C_BLU" "$C_OFF"
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
  SYSD=$(systemctl is-active oneuptime-ceph-agent 2>/dev/null || true)
  [ "$SYSD" = "active" ] && info "systemd unit oneuptime-ceph-agent is active."
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

# ----------------------------------------------------------------------------
section "2. mgr endpoints"
# ----------------------------------------------------------------------------
# Only the ACTIVE mgr returns metrics. Standbys answer with an empty body, a
# redirect to the active mgr, or an HTTP error (when
# mgr/prometheus/standby_behaviour=error). The agent must therefore scrape
# EVERY mgr so metrics survive failover — and "everything configured is a
# standby" is the silent failure this section catches.
RAW_ENDPOINTS=$(agent_env CEPH_MGR_ENDPOINTS)
MGR_OK=0; MGR_TOTAL=0; ACTIVE_FOUND=""

if [ -z "$RAW_ENDPOINTS" ]; then
  fail "CEPH_MGR_ENDPOINTS is not set — the collector has nothing to scrape."
  add_finding "Set CEPH_MGR_ENDPOINTS in $ENV_FILE to ALL mgr daemons (active + standbys), e.g. [mon1:9283,mon2:9283,mon3:9283], and restart the agent."
else
  case "$RAW_ENDPOINTS" in
    \[*\]) pass "CEPH_MGR_ENDPOINTS is bracket-wrapped (parses as a target list)." ;;
    *)
      fail "CEPH_MGR_ENDPOINTS is missing the square brackets: '$RAW_ENDPOINTS'"
      add_finding "Wrap CEPH_MGR_ENDPOINTS in square brackets ([host:port,host:port]) — without them the collector treats the whole string as a single invalid target." ;;
  esac

  ENDPOINTS=$(printf '%s' "$RAW_ENDPOINTS" | tr -d '[]' | tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -v '^$')
  MGR_TOTAL=$(printf '%s\n' "$ENDPOINTS" | grep -c . || true)
  if [ "${MGR_TOTAL:-0}" -le 1 ]; then
    warn "Only ONE mgr endpoint is configured — after an active-mgr failover, metrics will silently stop."
    add_finding "List EVERY mgr daemon in CEPH_MGR_ENDPOINTS (find them with: ceph orch ps --daemon-type mgr). Scrapes of standby mgrs are cheap and return empty responses."
  fi

  while read -r ep; do
    [ -z "$ep" ] && continue
    if [ "$AGENT_RUNNING" = 1 ]; then
      BODY=$(docker run --rm --network "container:$AGENT_CONTAINER" "$CURL_IMAGE" -sS -m 10 "http://$ep/metrics" 2>&1)
    else
      BODY=$(docker run --rm "$CURL_IMAGE" -sS -m 10 "http://$ep/metrics" 2>&1)
    fi
    EX=$?
    if [ "$EX" != "0" ]; then
      warn "mgr $ep: unreachable ($(printf '%s' "$BODY" | tr '\n' ' ' | head -c 120))"
    elif printf '%s\n' "$BODY" | grep -q '^ceph_health_status'; then
      SERIES=$(printf '%s\n' "$BODY" | grep -c '^ceph_' || true)
      pass "mgr $ep: ACTIVE — serving metrics ($SERIES ceph_* series)."
      MGR_OK=$((MGR_OK+1)); ACTIVE_FOUND="$ep"
    elif [ -z "$(printf '%s' "$BODY" | tr -d '[:space:]')" ]; then
      info "mgr $ep: reachable, empty body — a STANDBY mgr (expected; not an error)."
    else
      info "mgr $ep: reachable but no ceph_health_status — standby redirect/error or module disabled."
      detail "Response head: $(printf '%s' "$BODY" | tr '\n' ' ' | head -c 120)"
    fi
  done <<< "$ENDPOINTS"

  if [ "$MGR_OK" -ge 1 ]; then
    pass "At least one endpoint ($ACTIVE_FOUND) serves cluster metrics."
  else
    fail "NO configured endpoint returned ceph_health_status — the collector is scraping only standbys, or the prometheus module is disabled."
    add_finding "No active mgr among the configured endpoints. Check 'ceph mgr stat' for the active mgr and make sure it is listed in CEPH_MGR_ENDPOINTS; if no mgr serves metrics at all, run: ceph mgr module enable prometheus"
  fi
fi

# honor_labels keeps ceph_daemon/pool_id/instance labels stable across mgr
# failovers — without it series break every time the active mgr changes.
if [ -f "$CONFIG_FILE" ]; then
  if grep -qE '^[[:space:]]*honor_labels:[[:space:]]*true' "$CONFIG_FILE"; then
    pass "Collector config has honor_labels: true."
  else
    fail "Collector config is missing honor_labels: true — series identity breaks on every mgr failover."
    add_finding "Restore honor_labels: true under the scrape job in $CONFIG_FILE (shipped default)."
  fi
else
  warn "Config file $CONFIG_FILE not found — skipping the config checks (custom install dir? re-run with -d)."
fi

# ----------------------------------------------------------------------------
section "3. Cluster-name stamping"
# ----------------------------------------------------------------------------
# A missing ceph.cluster.name is the exact analog of the Kubernetes agent's
# "no k8s.cluster.name ⇒ the cluster never connects" failure: discovery keys
# on that resource attribute, so without it metrics ingest into the project
# but no Ceph cluster ever appears.
CLUSTER_NAME=$(agent_env CEPH_CLUSTER_NAME)
CLUSTER_NAME_OK=0
if [ -n "$CLUSTER_NAME" ]; then
  info "Reporting as cluster name: '${C_BOLD}${CLUSTER_NAME}${C_OFF}'  (this is the ceph.cluster.name OneUptime keys on)"
  detail "If this differs from a previous install, OneUptime shows a NEW cluster entry; the old one stays 'Disconnected'."
  CLUSTER_NAME_OK=1
else
  fail "CEPH_CLUSTER_NAME is empty — without it no Ceph cluster registers in OneUptime."
  add_finding "Set CEPH_CLUSTER_NAME in $ENV_FILE and restart the agent. Discovery keys on the ceph.cluster.name resource attribute it feeds."
fi
if [ -f "$CONFIG_FILE" ]; then
  if grep -q 'ceph.cluster.name' "$CONFIG_FILE"; then
    pass "Collector config stamps the ceph.cluster.name resource attribute."
  else
    fail "Collector config has NO ceph.cluster.name resource processor — metrics will not attribute to a cluster."
    add_finding "The resource processor stamping ceph.cluster.name was removed from $CONFIG_FILE. Restore the shipped config."
  fi
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
    detail "(Scrape errors for STANDBY mgrs are expected noise when standby_behaviour=error.)"
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
elif [ "$MGR_OK" -lt 1 ]; then
  printf "%s%sROOT CAUSE: no configured mgr endpoint serves metrics (active-mgr trap).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "Only the ACTIVE mgr returns metrics — see Section 2 for which endpoints answered.\n"
elif [ "$CLUSTER_NAME_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: CEPH_CLUSTER_NAME is missing — no cluster can register.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
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
