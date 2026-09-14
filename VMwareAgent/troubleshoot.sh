#!/usr/bin/env bash
#
# OneUptime VMware Agent — Diagnostic ("doctor")
# -----------------------------------------------
# Run this on the machine where the agent is installed (docker compose,
# optionally wrapped by the systemd unit). It explains the #1 confusing
# failure mode: the vCenter shows "Disconnected" in OneUptime and no metrics
# are ingested, yet the container looks healthy and the collector logs show
# no errors.
#
# Why that happens: the agent ships telemetry to `<url>/otlp/v1/*` with the
# ingestion key in the `x-oneuptime-token` header. If that key is missing,
# malformed, or revoked, the OTLP endpoints *deliberately return HTTP 200 and
# silently drop the data* (so a misconfigured collector can't retry-flood the
# server). The collector therefore reports success, logs nothing, and the
# vCenter never flips to "connected" because connection status is driven
# purely by telemetry actually arriving.
#
# How it gets a definitive answer: from inside the agent container's network
# namespace it calls `GET <url>/otlp/v1/validate`, a validation endpoint that
# returns a REAL status (200 valid / 401 invalid) instead of the silent 200.
# On older servers that lack it, it falls back to `POST <url>/fluentd/v1/logs`,
# which runs the SAME auth but is NOT an /otlp path — so a bad token returns
# `400 Invalid service token` rather than the silent 200.
#
# It also checks the vSphere side of the chain: that vCenter's SDK endpoint is
# reachable from the agent's network namespace (DNS, TLS trust — vCenter ships
# a self-signed certificate by default) and, where the vCenter REST API is
# available, that the configured user and password are actually accepted.
#
# Usage:
#   ./troubleshoot.sh [-d INSTALL_DIR] [--skip-egress] [--curl-image IMG] [--no-color]
#
# Defaults: INSTALL_DIR=/opt/oneuptime-vmware-agent
#
# Requires: docker (required). The collector image is distroless (no shell,
# no curl), so the network probes run a small curl image as a sibling
# container sharing the agent's network namespace — the exact path the
# collector itself uses.

set -uo pipefail

# ----------------------------------------------------------------------------
# Config / args
# ----------------------------------------------------------------------------
DIR="/opt/oneuptime-vmware-agent"
SKIP_EGRESS=0
CURL_IMAGE="curlimages/curl:latest"
USE_COLOR=1
AGENT_CONTAINER="oneuptime-vmware-agent"

while [ $# -gt 0 ]; do
  case "$1" in
    -d|--dir)      DIR="${2:-}"; shift 2 ;;
    --skip-egress) SKIP_EGRESS=1; shift ;;
    --curl-image)  CURL_IMAGE="${2:-}"; shift 2 ;;
    --no-color)    USE_COLOR=0; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,39p'
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

# Read one variable from .env the way Docker Compose v2 does (the same rules
# install.sh writes by): the last assignment wins, single-quoted values are
# literal, double-quoted values undo \\ \" and $$, and an unquoted value
# stops at " #" and is trimmed. Without this a quoted password would be
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

# Read an env var as the running container actually sees it (compose defaults
# included). Falls back to the .env file when the container isn't running.
agent_env() {
  local v=""
  v=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$AGENT_CONTAINER" 2>/dev/null \
        | sed -n "s/^$1=//p" | head -1)
  if [ -z "$v" ] && [ -f "$ENV_FILE" ]; then
    v=$(dotenv_get "$1" "$ENV_FILE")
  fi
  printf '%s' "$v"
}

# Run curl from INSIDE the agent container's network namespace, so probes
# follow the collector's real path: compose network, DNS, proxy, firewall,
# TLS. The collector image is distroless, so we run a sibling curl container
# with --network container:. Falls back to the default bridge when the agent
# container is down (close enough for a reachability verdict; the runtime
# section already failed by then). Extra `docker run` options (e.g. -e) go
# in DOCKER_RUN_EXTRA; curl args follow.
declare -a DOCKER_RUN_EXTRA=()
agent_netns_curl() {
  if [ "${AGENT_RUNNING:-0}" = 1 ]; then
    docker run --rm --network "container:$AGENT_CONTAINER" ${DOCKER_RUN_EXTRA[@]+"${DOCKER_RUN_EXTRA[@]}"} "$CURL_IMAGE" "$@" 2>&1
  else
    docker run --rm ${DOCKER_RUN_EXTRA[@]+"${DOCKER_RUN_EXTRA[@]}"} "$CURL_IMAGE" "$@" 2>&1
  fi
}

# Globals populated by agent_netns_req()
RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""

# Make an HTTP request ($1=GET|POST, $2=url, $3=token or "") from inside the
# agent container's network namespace.
agent_netns_req() {
  local method="$1" url="$2" token="$3"
  RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""
  local -a args=(-sS -m 15 -w $'\nOUSTATUS:%{http_code}' -X "$method" "$url")
  [ -n "$token" ] && args+=(-H "x-oneuptime-token: $token")
  [ "$method" = "POST" ] && args+=(-H "Content-Type: application/json" --data '{}')
  local raw=""
  DOCKER_RUN_EXTRA=()
  raw=$(agent_netns_curl "${args[@]}")
  RESP_EXIT=$?
  RESP_CODE=$(printf '%s\n' "$raw" | sed -n 's/^OUSTATUS:\([0-9]\{3\}\).*/\1/p' | head -1)
  RESP_BODY=$(printf '%s\n' "$raw" | sed '/^OUSTATUS:/,$d' | head -c 1000)
  [ -z "$RESP_CODE" ] && RESP_CODE="000"
}

# A hard connectivity failure (no HTTP response at all).
is_conn_fail() { [ "$RESP_CODE" = "000" ] || [ "${RESP_EXIT:-1}" != "0" ]; }

# ============================================================================
printf "%s%sOneUptime VMware Agent — Diagnostic%s\n" "$C_BOLD" "$C_BLU" "$C_OFF"
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
  SYSD=$(systemctl is-active oneuptime-vmware-agent 2>/dev/null || true)
  [ "$SYSD" = "active" ] && info "systemd unit oneuptime-vmware-agent is active."
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
  add_finding "The agent container is not running (state: $STATE). A restart loop usually means a config error (an unquoted VCENTER_INSECURE_SKIP_VERIFY that is not true/false, an endpoint without a scheme) — check: docker logs $AGENT_CONTAINER"
fi

# ----------------------------------------------------------------------------
section "2. vCenter reachability & credentials"
# ----------------------------------------------------------------------------
# The vcenter receiver connects to <endpoint>/sdk with a username/password.
# Three things go wrong here in practice: the endpoint is unreachable from
# the container (DNS/firewall/localhost trap), TLS fails because vCenter's
# self-signed certificate is not trusted and VCENTER_INSECURE_SKIP_VERIFY
# is still false, or the vSphere user is rejected / under-privileged.
VCENTER_ENDPOINT=$(agent_env VCENTER_ENDPOINT)
VCENTER_ENDPOINT="${VCENTER_ENDPOINT%/}"
# Host part only (no scheme, port or path) for the sanity checks below.
VCENTER_HOSTPART="${VCENTER_ENDPOINT#*://}"
VCENTER_HOSTPART="${VCENTER_HOSTPART%%/*}"
VCENTER_HOSTPART="${VCENTER_HOSTPART%%:*}"
VCENTER_USERNAME=$(agent_env VCENTER_USERNAME)
VCENTER_PASSWORD=$(agent_env VCENTER_PASSWORD)
SKIP_VERIFY=$(agent_env VCENTER_INSECURE_SKIP_VERIFY)
SKIP_VERIFY=$(printf '%s' "$SKIP_VERIFY" | tr '[:upper:]' '[:lower:]')
COLLECTION_INTERVAL=$(agent_env VCENTER_COLLECTION_INTERVAL)
[ -z "$COLLECTION_INTERVAL" ] && COLLECTION_INTERVAL="2m"
VCENTER_OK=0            # SDK endpoint answered
CRED_VERDICT="UNKNOWN"  # UNKNOWN | VALID | INVALID | INCONCLUSIVE

if [ -z "$VCENTER_ENDPOINT" ]; then
  fail "VCENTER_ENDPOINT is not set — the collector doesn't know which vCenter to poll."
  add_finding "Set VCENTER_ENDPOINT in $ENV_FILE to scheme + host of your vCenter (e.g. https://vcsa.example.com, no /sdk) and restart: docker compose up -d"
else
  info "vCenter endpoint: $VCENTER_ENDPOINT  →  polled as ${VCENTER_ENDPOINT}/sdk every $COLLECTION_INTERVAL as '${VCENTER_USERNAME:-<no user>}'"
  case "$VCENTER_ENDPOINT" in
    http://*|https://*) ;;
    *)
      fail "VCENTER_ENDPOINT has no scheme — the receiver needs <scheme>://<host> (usually https://)."
      add_finding "Prefix VCENTER_ENDPOINT with https:// in $ENV_FILE and restart the agent." ;;
  esac
  case "$VCENTER_ENDPOINT" in
    */sdk)
      warn "VCENTER_ENDPOINT ends in /sdk — the receiver appends /sdk itself (polling ${VCENTER_ENDPOINT}/sdk); use scheme + host only."
      add_finding "Remove the trailing /sdk from VCENTER_ENDPOINT in $ENV_FILE and restart the agent."
      # Probe what the user meant so the rest of this section is still useful.
      VCENTER_ENDPOINT="${VCENTER_ENDPOINT%/sdk}" ;;
  esac
  # The localhost trap: inside the agent container, localhost is the agent
  # itself — it can never reach anything running on this machine.
  case "$VCENTER_HOSTPART" in
    localhost|127.0.0.1|::1|"[::1]")
      fail "VCENTER_ENDPOINT points at localhost — inside the agent container that is the agent itself, not this machine."
      add_finding "VCENTER_ENDPOINT must be reachable from a container: use the vCenter's DNS name or IP (or host.docker.internal on Docker Desktop), never localhost." ;;
  esac
  case "$SKIP_VERIFY" in
    true|false) ;;
    "") warn "VCENTER_INSECURE_SKIP_VERIFY is empty — the collector refuses to start on an empty boolean. Set it to true or false." ;;
    *)  fail "VCENTER_INSECURE_SKIP_VERIFY='$SKIP_VERIFY' is not a boolean — the collector refuses to start."
        add_finding "Set VCENTER_INSECURE_SKIP_VERIFY to exactly true or false in $ENV_FILE and restart the agent." ;;
  esac

  # Unauthenticated SDK probe: vimServiceVersions.xml is served by every
  # vCenter and ESXi host and proves DNS, routing and TLS from the agent's
  # network namespace. -k is added ONLY when the collector itself skips
  # verification, so a certificate failure is reported exactly as the
  # collector would hit it.
  declare -a CURL_TLS=()
  [ "$SKIP_VERIFY" = "true" ] && CURL_TLS=(-k)
  SDK_URL="${VCENTER_ENDPOINT}/sdk/vimServiceVersions.xml"
  DOCKER_RUN_EXTRA=()
  SDK_OUT=$(agent_netns_curl ${CURL_TLS[@]+"${CURL_TLS[@]}"} -sS -m 20 -w $'\nOUSTATUS:%{http_code}' "$SDK_URL")
  SDK_EXIT=$?
  SDK_CODE=$(printf '%s\n' "$SDK_OUT" | sed -n 's/^OUSTATUS:\([0-9]\{3\}\).*/\1/p' | head -1)
  SDK_BODY=$(printf '%s\n' "$SDK_OUT" | sed '/^OUSTATUS:/,$d')
  if [ "$SDK_EXIT" != "0" ] || [ -z "$SDK_CODE" ] || [ "$SDK_CODE" = "000" ]; then
    fail "Cannot reach $SDK_URL from the agent's network (curl exit $SDK_EXIT)."
    detail "curl: $(printf '%s' "$SDK_BODY" | tr '\n' ' ' | head -c 220)"
    case "$SDK_BODY" in
      *"certificate"*|*"SSL"*|*"TLS"*|*"self-signed"*|*"self signed"*|*"unable to get local issuer"*)
        add_finding "TLS verification against vCenter fails — it is almost certainly presenting its default self-signed (VMCA) certificate. Either set VCENTER_INSECURE_SKIP_VERIFY=true in $ENV_FILE, or install a certificate vCenter's clients can verify, then restart the agent." ;;
      *"Could not resolve host"*|*"Name or service not known"*)
        add_finding "DNS resolution of the vCenter host fails from the agent container. Check VCENTER_ENDPOINT and the machine's DNS." ;;
      *"refused"*|*"timed out"*|*"Connection timed out"*|*"Failed to connect"*)
        add_finding "Connection to vCenter is refused/times out — a firewall between this machine and vCenter is blocking TCP 443, or the endpoint is wrong." ;;
      *)
        add_finding "The collector cannot reach ${VCENTER_ENDPOINT}/sdk. Verify VCENTER_ENDPOINT and that this machine can reach vCenter on TCP 443." ;;
    esac
  elif printf '%s' "$SDK_BODY" | grep -q '<namespace>urn:vim25</namespace>'; then
    pass "vSphere SDK reachable at $SDK_URL (HTTP $SDK_CODE, urn:vim25 advertised)."
    SDK_VER=$(printf '%s\n' "$SDK_BODY" | sed -n 's/.*<version>\([0-9.]*\)<\/version>.*/\1/p' | head -1)
    [ -n "$SDK_VER" ] && detail "Newest vim25 API version offered: $SDK_VER"
    VCENTER_OK=1
    [ "$SKIP_VERIFY" = "true" ] && detail "TLS verification is OFF (VCENTER_INSECURE_SKIP_VERIFY=true)."
  else
    warn "$SDK_URL answered HTTP $SDK_CODE but did not look like a vSphere SDK endpoint."
    detail "Response head: $(printf '%s' "$SDK_BODY" | tr '\n' ' ' | head -c 200)"
    add_finding "Something answers at $VCENTER_ENDPOINT but it is not the vSphere SDK (a reverse proxy? the wrong host?). The receiver needs the vCenter Server / ESXi host itself."
    VCENTER_OK=1
  fi

  # Credential probe via the vCenter REST API (vSphere 7.0+): POST
  # /api/session with basic auth returns 201 when the user is accepted and
  # 401 when it is not. Standalone ESXi hosts and vSphere 6.x have no REST
  # session endpoint (404) — then only the collector log can tell.
  if [ "$VCENTER_OK" = 1 ] && [ -n "$VCENTER_USERNAME" ] && [ -n "$VCENTER_PASSWORD" ]; then
    # The password never appears on a command line: it reaches curl through
    # the sibling container's environment and curl's own -u expansion.
    DOCKER_RUN_EXTRA=(-e "OU_USERPWD=${VCENTER_USERNAME}:${VCENTER_PASSWORD}" -e "OU_URL=${VCENTER_ENDPOINT}/api/session" --entrypoint sh)
    AUTH_CODE=$(agent_netns_curl -c 'exec curl "$@" -u "$OU_USERPWD" "$OU_URL"' sh ${CURL_TLS[@]+"${CURL_TLS[@]}"} -sS -m 20 -o /dev/null -w '%{http_code}' -X POST | tail -c 3)
    DOCKER_RUN_EXTRA=()
    case "$AUTH_CODE" in
      201|200)
        pass "vCenter ACCEPTED the credentials for '$VCENTER_USERNAME' (POST /api/session → $AUTH_CODE)."
        detail "Accepted ≠ privileged: the user still needs the Read-Only role propagated from the vCenter root (see README.md)."
        CRED_VERDICT="VALID" ;;
      401|403)
        fail "vCenter REJECTED the credentials for '$VCENTER_USERNAME' (POST /api/session → $AUTH_CODE)."
        CRED_VERDICT="INVALID"
        add_finding "vCenter rejects VCENTER_USERNAME / VCENTER_PASSWORD. Use the full principal (user@vsphere.local or DOMAIN\\user), check how the password is quoted in $ENV_FILE (single-quote it if it contains \$, #, spaces or quotes — Docker Compose expands \$VAR and treats \" #\" as a comment otherwise; install.sh quotes it for you), confirm the account is not locked, then: cd $DIR && docker compose up -d" ;;
      404)
        info "No REST session endpoint (404) — a standalone ESXi host or a pre-7.0 vCenter; credentials can only be judged from the collector log (Section 7)."
        CRED_VERDICT="INCONCLUSIVE" ;;
      *)
        warn "Credential probe inconclusive (POST /api/session → '${AUTH_CODE:-none}')."
        CRED_VERDICT="INCONCLUSIVE" ;;
    esac
  elif [ "$VCENTER_OK" = 1 ]; then
    fail "VCENTER_USERNAME / VCENTER_PASSWORD not set — the receiver cannot log in."
    add_finding "Set VCENTER_USERNAME and VCENTER_PASSWORD in $ENV_FILE (a vSphere user with the Read-Only role) and restart the agent."
  fi
fi

# ----------------------------------------------------------------------------
section "3. vCenter-name stamping"
# ----------------------------------------------------------------------------
# A missing vmware.vcenter.name is the exact analog of the Kubernetes agent's
# "no k8s.cluster.name ⇒ the cluster never connects" failure: discovery keys
# on that resource attribute, so without it metrics ingest into the project
# but no vCenter ever appears.
VCENTER_NAME=$(agent_env VMWARE_VCENTER_NAME)
VCENTER_NAME_OK=0
if [ -n "$VCENTER_NAME" ]; then
  info "Reporting as vCenter name: '${C_BOLD}${VCENTER_NAME}${C_OFF}'  (this is the vmware.vcenter.name OneUptime keys on)"
  detail "If this differs from a previous install, OneUptime shows a NEW vCenter entry; the old one stays 'Disconnected'."
  VCENTER_NAME_OK=1
else
  fail "VMWARE_VCENTER_NAME is empty — without it no vCenter registers in OneUptime."
  add_finding "Set VMWARE_VCENTER_NAME in $ENV_FILE and restart the agent. Discovery keys on the vmware.vcenter.name resource attribute it feeds."
fi
if [ -f "$CONFIG_FILE" ]; then
  if grep -q 'vmware.vcenter.name' "$CONFIG_FILE"; then
    pass "Collector config stamps the vmware.vcenter.name resource attribute."
  else
    fail "Collector config has NO vmware.vcenter.name resource processor — metrics will not attribute to a vCenter."
    add_finding "The resource processor stamping vmware.vcenter.name was removed from $CONFIG_FILE. Restore the shipped config."
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
  DOCKER_RUN_EXTRA=()
  SELF=$(agent_netns_curl -sS -m 5 "http://127.0.0.1:8888/metrics" 2>/dev/null)
  if [ -n "$SELF" ]; then
    ACCEPTED=$(printf '%s\n' "$SELF" | awk '/^otelcol_receiver_accepted_metric_points/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    SENT=$(printf '%s\n' "$SELF" | awk '/^otelcol_exporter_sent_metric_points/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    FAILED=$(printf '%s\n' "$SELF" | awk '/^otelcol_exporter_send_failed_/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    SCRAPE_ERR=$(printf '%s\n' "$SELF" | awk '/^otelcol_scraper_errored_metric_points/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    info "Collector self-metrics: accepted=$ACCEPTED  sent=$SENT  send_failed=$FAILED  scrape_errors=$SCRAPE_ERR"
    if [ "${FAILED:-0}" -gt 0 ] 2>/dev/null; then
      fail "Collector reports send_failed > 0 → exports are erroring (network/URL/TLS)."
      add_finding "Collector send_failed=$FAILED. The collector cannot deliver to OneUptime — investigate egress/DNS/TLS/firewall (next section)."
    elif [ "${ACCEPTED:-0}" -eq 0 ] 2>/dev/null; then
      warn "No datapoints accepted yet — the vCenter collection is failing (see Section 2 / 7) or the collector started less than one interval ($COLLECTION_INTERVAL) ago."
    elif [ "${SENT:-0}" -gt 0 ] 2>/dev/null; then
      pass "Bytes are leaving the collector and the server is returning 2xx."
      detail "NOTE: a bad token ALSO returns 2xx (silent drop). The token probe below settles it."
    fi
    if [ "${SCRAPE_ERR:-0}" -gt 0 ] 2>/dev/null; then
      warn "scrape_errors=$SCRAPE_ERR — some vSphere objects could not be collected (permissions on part of the inventory, or performance counters disabled). See Section 7."
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
    | grep -iE 'error|failed|denied|refused|x509|tls|deadline|429|throttl|incorrect user|unauthori|permission|NoPermission|InvalidLogin' | tail -50)
  if [ -n "$LOGERR" ]; then
    warn "Recent error-ish log lines from the collector (last 50):"
    printf '%s\n' "$LOGERR" | while read -r l; do detail "$(printf '%s' "$l" | head -c 160)"; done
    if printf '%s' "$LOGERR" | grep -qiE 'incorrect user|InvalidLogin|Cannot complete login'; then
      CRED_VERDICT="INVALID"
      add_finding "The collector log shows vSphere rejecting the login (InvalidLogin). Fix VCENTER_USERNAME / VCENTER_PASSWORD in $ENV_FILE and restart the agent."
    elif printf '%s' "$LOGERR" | grep -qiE 'NoPermission|not have permission'; then
      add_finding "The collector log shows vSphere permission errors: the user lacks the Read-Only role on part of the inventory. Grant it on the top-level vCenter object with 'Propagate to children' (see README.md)."
    fi
  else
    pass "No export errors in recent collector logs."
    detail "(Expected when a token is silently dropped — absence of errors does NOT mean data is landing.)"
  fi
else
  info "Container not present — no collector log to inspect."
fi

# ============================================================================
section "8. VERDICT"
# ============================================================================
if [ "$AGENT_RUNNING" != 1 ]; then
  printf "%s%sROOT CAUSE: the agent container isn't running.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "Fix the container (see Section 1) — until it runs, nothing is collected or shipped.\n"
elif [ "$TOKEN_VERDICT" = "INVALID" ]; then
  printf "%s%sROOT CAUSE: the ingestion token is rejected by OneUptime.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "This is the classic trap: /otlp returns 200 and drops the data, so the agent\n"
  printf "looks healthy while the vCenter stays Disconnected with no metrics.\n"
elif [ "$EGRESS" = "FAIL" ]; then
  printf "%s%sROOT CAUSE: the agent can't deliver telemetry to OneUptime (network/URL/TLS).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$VCENTER_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: the collector cannot reach vCenter (endpoint / DNS / TLS).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "Fix the vSphere side (see Section 2) — usually VCENTER_ENDPOINT or the self-signed\n"
  printf "certificate (VCENTER_INSECURE_SKIP_VERIFY=true).\n"
elif [ "$CRED_VERDICT" = "INVALID" ]; then
  printf "%s%sROOT CAUSE: vCenter rejects the vSphere credentials.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "Fix VCENTER_USERNAME / VCENTER_PASSWORD (see Section 2) and restart the agent.\n"
elif [ "$VCENTER_NAME_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: VMWARE_VCENTER_NAME is missing — no vCenter can register.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$TOKEN_HAS_WS" = 1 ]; then
  printf "%s%sROOT CAUSE: the ingestion key has stray whitespace.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "The collector sends the key with that whitespace, so OneUptime can't match it and\n"
  printf "drops the data behind /otlp's silent 200. Fix %s and restart.\n" "$ENV_FILE"
elif [ "$TOKEN_SHAPE_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: the ingestion key is empty/malformed.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$TOKEN_VERDICT" = "VALID" ]; then
  printf "%s%sThe agent looks healthy and OneUptime accepts the token.%s\n" "$C_BOLD" "$C_GRN" "$C_OFF"
  printf "If the dashboard still says Disconnected:\n"
  printf "  1. Give it one collection interval (%s) plus ~2-5 min — status flips to Connected\n" "$COLLECTION_INTERVAL"
  printf "     on the next telemetry batch, and the disconnect cron runs on a 5-minute cycle.\n"
  printf "  2. Look for a %sNEW%s vCenter entry named '%s' — if you changed the vCenter name,\n" "$C_BOLD" "$C_OFF" "${VCENTER_NAME:-?}"
  printf "     the OLD entry stays Disconnected (that's expected; it's stale).\n"
  printf "  3. Hosts/VMs present but a page is empty? The Read-Only role must be propagated\n"
  printf "     to children — an un-propagated role hides everything below the vCenter object.\n"
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
