#!/usr/bin/env bash
#
# OneUptime XCP-ng Agent — Diagnostic ("doctor")
# -----------------------------------------------
# Run this on the machine where the agent is installed (docker compose,
# optionally wrapped by the systemd unit). It walks the chain from Xen
# Orchestra to OneUptime in the order data travels it, and names the first
# step that fails:
#
#   1. the agent's container is there and running;
#   2. Xen Orchestra answers at XO_URL, from the agent's own network;
#   3. its OpenMetrics plugin answers (/openmetrics/health);
#   4. its certificate checks out against what the agent trusts (xo-ca.pem:
#      the pinned certificate, XO_CA_FILE's bundle, or this machine's), and
#      the pinned one is still the one it presents;
#   5. it accepts the plugin's secret (401 and the plugin's own reason, or
#      200);
#   6. what it answers is Xen Orchestra's OpenMetrics, with
#      xcp_pool_connected, and how many pools it reports;
#   7. the ingestion key has the right shape, 8. the collector's own
#      counters, and 9. OneUptime is reachable and accepts the key;
#   10. what the collector logged lately.
#
# Why step 9 matters: the agent ships telemetry to `<url>/otlp/v1/*` with
# the ingestion key in the `x-oneuptime-token` header. If that key is
# missing, malformed, unknown or expired, the OTLP endpoints answer 401 (422
# for a disabled key or a browser key). Neither is retryable, so the
# collector drops every batch and logs one "Exporting failed" line per
# batch, which is easy to miss while the container keeps running, and the
# pools never flip to "connected" because connection status is driven purely
# by telemetry actually arriving. From inside the agent container's network
# namespace it calls `GET <url>/otlp/v1/validate`, which judges the key alone
# (200 valid / 401 unknown, disabled or expired) and names its type, so a
# browser key, which validates but which ingest refuses from a collector, is
# caught too. On older servers that lack it, it falls back to
# `POST <url>/fluentd/v1/logs`, which runs the SAME auth but is NOT an /otlp
# path, so even a server that old answers a bad token with
# `400 Invalid service token` there (a current one answers 401/422).
#
# The OpenMetrics secret and the ingestion key reach curl on stdin, never on
# a command line, and neither is ever printed.
#
# Usage:
#   ./troubleshoot.sh [-d INSTALL_DIR] [--skip-egress] [--curl-image IMG] [--no-color]
#
# Defaults: INSTALL_DIR=/opt/oneuptime-xcp-ng-agent
#
# Requires: docker (required); openssl (optional: names the certificate
# Xen Orchestra presents and its fingerprint). The collector image is
# distroless (no shell, no curl), so the network probes run a small curl
# image as a sibling container sharing the agent's network namespace — the
# exact path the collector itself uses.

set -uo pipefail

# ----------------------------------------------------------------------------
# Config / args
# ----------------------------------------------------------------------------
DIR="/opt/oneuptime-xcp-ng-agent"
SKIP_EGRESS=0
# Pinned, as the Database and OpenStack agents' doctors pin it: this image is
# handed the secret and the key, so it must never be whatever "latest" has
# become.
CURL_IMAGE="curlimages/curl:8.22.0@sha256:58adaa4e8dca9c988bae2aba4ab3434a0bb2da16bbe3f92dec39ec7785166777"
USE_COLOR=1
AGENT_CONTAINER="oneuptime-xcp-ng-agent"

while [ $# -gt 0 ]; do
  case "$1" in
    -d|--dir)      DIR="${2:-}"; shift 2 ;;
    --skip-egress) SKIP_EGRESS=1; shift ;;
    --curl-image)  CURL_IMAGE="${2:-}"; shift 2 ;;
    --no-color)    USE_COLOR=0; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,50p'
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
ENV_FILE="$DIR/.env"
CONFIG_FILE="$DIR/otel-collector-config.yaml"
CA_PEM="$DIR/xo-ca.pem"

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

# Read an env var as the running container actually sees it (compose
# defaults included). Falls back to the .env file when the container isn't
# running.
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
# section already failed by then). `--stdin` first hands curl this
# function's stdin (a secret, as a header), and only then: run without it,
# a container would read the script's own stdin, which is the script itself
# when it runs as `curl ... | bash`. xo-ca.pem is mounted at /xo-ca.pem.
agent_netns_curl() {
  local -a run=(--rm)
  if [ "${1:-}" = "--stdin" ]; then
    run+=(-i)
    shift
  fi
  if [ "${AGENT_RUNNING:-0}" = 1 ]; then
    run+=(--network "container:$AGENT_CONTAINER")
  fi
  if [ -f "$CA_PEM" ]; then
    run+=(-v "$CA_PEM:/xo-ca.pem:ro")
  fi
  docker run "${run[@]}" "$CURL_IMAGE" "$@" 2>&1
}

# Globals populated by agent_netns_req() and xo_req()
RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""; RESP_TYPE=""

# Make an HTTP request ($1=GET|POST, $2=url, $3=token or "") to OneUptime
# from inside the agent container's network namespace. The key reaches curl
# on stdin. Without pipefail here: the status wanted is curl's.
agent_netns_req() {
  local method="$1" url="$2" token="$3"
  RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""
  local -a args=(-sS -m 15 -w $'\nOUSTATUS:%{http_code}' -X "$method" -H @-)
  [ "$method" = "POST" ] && args+=(-H "Content-Type: application/json" --data '{}')
  args+=("$url")
  local raw=""
  raw=$(set +o pipefail; printf 'x-oneuptime-token: %s\n' "$token" | agent_netns_curl --stdin "${args[@]}")
  RESP_EXIT=$?
  RESP_CODE=$(printf '%s\n' "$raw" | sed -n 's/^OUSTATUS:\([0-9]\{3\}\).*/\1/p' | head -1)
  RESP_BODY=$(printf '%s\n' "$raw" | sed '/^OUSTATUS:/,$d' | head -c 1000)
  [ -z "$RESP_CODE" ] && RESP_CODE="000"
}

# A hard connectivity failure (no HTTP response at all).
is_conn_fail() { [ "$RESP_CODE" = "000" ] || [ "${RESP_EXIT:-1}" != "0" ]; }

# The address curl connects to: XO_ADDRESS's host, an IPv6 one in brackets.
XO_HOST=""; XO_PORT=""
xo_connect_host() {
  case "$XO_HOST" in
    *:*) printf '[%s]' "$XO_HOST" ;;
    *) printf '%s' "$XO_HOST" ;;
  esac
}

# Where a request to Xen Orchestra goes, the way the collector sends it: to
# XO_ADDRESS, checking the certificate against XO_TLS_SERVER_NAME when it is
# set (curl's --connect-to). Sets XO_REQ_URL and XO_REQ_ARGS for <path>.
declare -a XO_REQ_ARGS=()
XO_REQ_URL=""
xo_target() {
  XO_REQ_ARGS=()
  if [ "$XO_SCHEME" = "https" ] && [ -n "$XO_TLS_SERVER_NAME" ]; then
    XO_REQ_ARGS=(--connect-to "$XO_TLS_SERVER_NAME:$XO_PORT:$(xo_connect_host):$XO_PORT")
    XO_REQ_URL="https://$XO_TLS_SERVER_NAME:$XO_PORT$1"
  else
    XO_REQ_URL="$XO_SCHEME://$XO_ADDRESS$1"
  fi
}

# A request to Xen Orchestra. $1 is "trust" (check the certificate against
# xo-ca.pem, as the collector does), "look" (read the answer whatever the
# certificate: only to tell reachability and the plugin apart from trust,
# which "trust" then checks; nothing secret is sent that way) or "secret"
# (trust, and the secret on stdin). Then the path, then curl's arguments.
# Fills RESP_*.
xo_req() {
  local mode="$1" path="$2" raw=""
  shift 2
  local -a args=(-sS -m 60 -w $'\nOUSTATUS:%{http_code}\nOUTYPE:%{content_type}' "$@")
  if [ "$XO_SCHEME" = "https" ]; then
    if [ "$mode" = "look" ]; then
      args+=(-k)
    else
      args+=(--cacert /xo-ca.pem)
    fi
  fi
  xo_target "$path"
  args+=(${XO_REQ_ARGS[@]+"${XO_REQ_ARGS[@]}"})
  RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""; RESP_TYPE=""
  if [ "$mode" = "secret" ]; then
    raw=$(set +o pipefail; printf 'Authorization: Bearer %s\n' "$XO_SECRET" | agent_netns_curl --stdin -H @- "${args[@]}" "$XO_REQ_URL")
  else
    raw=$(agent_netns_curl "${args[@]}" "$XO_REQ_URL")
  fi
  RESP_EXIT=$?
  RESP_CODE=$(printf '%s\n' "$raw" | sed -n 's/^OUSTATUS:\([0-9]\{3\}\).*/\1/p' | tail -1)
  RESP_TYPE=$(printf '%s\n' "$raw" | sed -n 's/^OUTYPE://p' | tail -1)
  RESP_BODY=$(printf '%s\n' "$raw" | sed '/^OUSTATUS:/,$d')
  [ -z "$RESP_CODE" ] && RESP_CODE="000"
}

# The first certificate of a curl -w '%{certs}' answer, as PEM.
first_certificate() {
  awk '/-----BEGIN CERTIFICATE-----/ { sub(/^Cert:/, ""); found = 1 } found { print } /-----END CERTIFICATE-----/ && found { exit }'
}

# A fingerprint as typed (colons, spaces, "sha256 Fingerprint=" or not) as
# 64 upper-case hex digits, or nothing when it is not a SHA-256 fingerprint.
normalize_fingerprint() {
  local value="$1"
  value="${value#*=}"
  value="$(printf '%s' "$value" | tr -d ': \t' | tr '[:lower:]' '[:upper:]')"
  if printf '%s' "$value" | grep -Eq '^[0-9A-F]{64}$'; then
    printf '%s' "$value"
  fi
}

# The SHA-256 fingerprint (AB:CD:...) of the PEM on stdin, when openssl is here.
pem_fingerprint() {
  command -v openssl >/dev/null 2>&1 || return 0
  openssl x509 -noout -fingerprint -sha256 2>/dev/null | sed 's/^[^=]*=//' | tr '[:lower:]' '[:upper:]'
}

# The value of label $2 on each line of metric $1 in body $3.
metric_label_values() {
  printf '%s\n' "$3" | grep "^$1{" | sed -n "s/.*[{,]$2=\"\([^\"]*\)\".*/\1/p"
}

# ============================================================================
printf "%s%sOneUptime XCP-ng Agent — Diagnostic%s\n" "$C_BOLD" "$C_BLU" "$C_OFF"
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
  # Another Xen Orchestra's agent on this machine has its own container name
  # (README.md, "Reading several Xen Orchestras"): the one install.sh writes
  # to .env as XCP_NG_AGENT_CONTAINER_NAME, which docker-compose.yml reads.
  # Ask compose which container this directory runs, then, and keep the name
  # .env gives (else the default) when it cannot tell.
  ENV_CONTAINER=$(dotenv_get XCP_NG_AGENT_CONTAINER_NAME "$ENV_FILE")
  [ -n "$ENV_CONTAINER" ] && AGENT_CONTAINER="$ENV_CONTAINER"
  CID=$(cd "$DIR" 2>/dev/null && docker compose ps -a -q oneuptime-xcp-ng-agent 2>/dev/null | head -1)
  if [ -n "$CID" ]; then
    NAME=$(docker inspect -f '{{.Name}}' "$CID" 2>/dev/null | sed 's#^/##')
    [ -n "$NAME" ] && AGENT_CONTAINER="$NAME"
  fi
else
  warn "No compose install at '$DIR' — re-run with -d <dir> if you installed elsewhere."
fi

# systemd wrapper (optional — it only wraps docker compose).
if command -v systemctl >/dev/null 2>&1; then
  SYSD=$(systemctl is-active oneuptime-xcp-ng-agent 2>/dev/null || true)
  [ "$SYSD" = "active" ] && info "systemd unit oneuptime-xcp-ng-agent is active."
fi

AGENT_RUNNING=0
STATE=$(docker inspect -f '{{.State.Status}} restarting={{.State.Restarting}} restarts={{.RestartCount}}' "$AGENT_CONTAINER" 2>/dev/null)
if [ -z "$STATE" ]; then
  fail "Container '$AGENT_CONTAINER' does not exist."
  add_finding "The agent container isn't created. Start it: cd $DIR && docker compose up -d (a missing xo-ca.pem stops it with \"bind source path does not exist\": run install.sh again)."
elif printf '%s' "$STATE" | grep -q '^running restarting=false'; then
  pass "Container '$AGENT_CONTAINER' is running ($STATE)"
  AGENT_RUNNING=1
else
  fail "Container '$AGENT_CONTAINER' is NOT healthy: $STATE"
  add_finding "The agent container is not running (state: $STATE). A restart loop usually means a config error (an empty XO_NAME and XO_ADDRESS: the resource processor refuses an empty xen_orchestra.name) — check: docker logs $AGENT_CONTAINER"
fi

if [ -d "$CA_PEM" ]; then
  fail "$CA_PEM is a directory, not the certificates the agent trusts for Xen Orchestra."
  add_finding "Docker made $CA_PEM a directory because the file was missing when the agent started. Remove it (rmdir $CA_PEM) and run install.sh again, which writes it."
elif [ ! -s "$CA_PEM" ]; then
  if [ -d "$DIR" ]; then
    fail "$CA_PEM is missing: the collector cannot check Xen Orchestra's certificate, so it reads nothing."
    add_finding "Run install.sh again: it writes xo-ca.pem (Xen Orchestra's pinned certificate, XO_CA_FILE's bundle, or this machine's)."
  fi
elif ! grep -q "BEGIN CERTIFICATE" "$CA_PEM" 2>/dev/null; then
  fail "$CA_PEM holds no PEM certificate: the collector refuses to read Xen Orchestra."
  add_finding "Run install.sh again: it writes xo-ca.pem."
fi

# ----------------------------------------------------------------------------
section "2. Xen Orchestra reachable"
# ----------------------------------------------------------------------------
XO_SCHEME=$(agent_env XO_SCHEME)
[ -z "$XO_SCHEME" ] && XO_SCHEME="https"
XO_ADDRESS=$(agent_env XO_ADDRESS)
XO_TLS_SERVER_NAME=$(agent_env XO_TLS_SERVER_NAME)
XO_TLS_FINGERPRINT=$(agent_env XO_TLS_FINGERPRINT)
XO_CA_FILE=$(agent_env XO_CA_FILE)
# The container holds the secret with every $ doubled for the collector, and
# .env holds it so too (install.sh): undo that once.
XO_SECRET=$(agent_env XO_OPENMETRICS_SECRET)
XO_SECRET="${XO_SECRET//\$\$/\$}"
XO_VERDICT="UNKNOWN"   # UNKNOWN | OK | MISCONFIGURED | UNREACHABLE | NO_PLUGIN | NOT_XO | TLS | DRIFT | NO_NAMES | SECRET | NO_POOLS

case "$XO_ADDRESS" in
  \[*\]:*) XO_HOST="${XO_ADDRESS#\[}"; XO_HOST="${XO_HOST%%\]*}"; XO_PORT="${XO_ADDRESS##*\]:}" ;;
  \[*\]) XO_HOST="${XO_ADDRESS#\[}"; XO_HOST="${XO_HOST%\]}"; XO_PORT="" ;;
  *:*) XO_HOST="${XO_ADDRESS%%:*}"; XO_PORT="${XO_ADDRESS#*:}" ;;
  *) XO_HOST="$XO_ADDRESS"; XO_PORT="" ;;
esac
if [ -z "$XO_PORT" ]; then
  if [ "$XO_SCHEME" = "http" ]; then XO_PORT=80; else XO_PORT=443; fi
fi

if [ -z "$XO_ADDRESS" ]; then
  fail "XO_ADDRESS is not set — the collector doesn't know which Xen Orchestra to read."
  add_finding "Set XO_URL in $ENV_FILE to Xen Orchestra's address (e.g. https://xo.example.com) and run install.sh again: it writes XO_SCHEME and XO_ADDRESS from it."
  XO_VERDICT="MISCONFIGURED"
fi
case "$XO_SCHEME" in
  https) ;;
  http)
    warn "XO_SCHEME is http: the OpenMetrics secret and everything Xen Orchestra reports cross the network in clear."
    add_finding "Reading Xen Orchestra over http:// is for a lab only. Give it a certificate that names its address (README.md, \"Xen Orchestra's certificate\"), set XO_URL to https://… and run install.sh again."
    ;;
  *)
    fail "XO_SCHEME is '$XO_SCHEME' — neither https nor http, so the collector cannot read Xen Orchestra."
    add_finding "Set XO_URL in $ENV_FILE to Xen Orchestra's https:// address and run install.sh again."
    XO_VERDICT="MISCONFIGURED"
    ;;
esac
# The localhost trap: inside the agent container, localhost is the agent.
case "$XO_HOST" in
  localhost|127.*|::1|0:0:0:0:0:0:0:1)
    fail "XO_ADDRESS points at localhost ($XO_HOST) — inside the agent container that is the agent itself, not Xen Orchestra."
    add_finding "XO_URL must be Xen Orchestra's address as this machine's containers reach it: its DNS name or IP on the network (or host.docker.internal on Docker Desktop), never localhost. Fix it in $ENV_FILE and run install.sh again."
    XO_VERDICT="MISCONFIGURED" ;;
esac
if [ -z "$XO_SECRET" ]; then
  fail "XO_OPENMETRICS_SECRET is not set — Xen Orchestra refuses every scrape without the plugin's secret."
  add_finding "Copy the secret from Xen Orchestra (Settings → Plugins → openmetrics) and run install.sh again (it asks for it)."
  XO_VERDICT="MISCONFIGURED"
fi

if [ "$XO_VERDICT" = "UNKNOWN" ]; then
  info "Xen Orchestra: $XO_SCHEME://$XO_ADDRESS${XO_TLS_SERVER_NAME:+ (certificate checked against $XO_TLS_SERVER_NAME)}"
  xo_req look /openmetrics/health
  if [ "$RESP_CODE" = "000" ]; then
    fail "Xen Orchestra does not answer at $XO_SCHEME://$XO_ADDRESS from the agent's network (curl exit ${RESP_EXIT:-?})."
    detail "curl: $(printf '%s' "$RESP_BODY" | tr '\n' ' ' | head -c 200)"
    XO_VERDICT="UNREACHABLE"
    case "$RESP_BODY" in
      *"Could not resolve host"*|*"Name or service not known"*)
        add_finding "The agent's container cannot resolve $XO_HOST. Use a name the machine's DNS answers (a name only /etc/hosts knows is not seen inside the container), or Xen Orchestra's IP address, in XO_URL, and run install.sh again." ;;
      *"refused"*|*"timed out"*|*"Failed to connect"*|*"Timeout"*)
        add_finding "The connection to $XO_ADDRESS is refused or times out — Xen Orchestra is not listening there (check XO_URL's port: 443 on an XOA, 80 on Xen Orchestra built from sources unless it was given HTTPS), or a firewall between this machine and Xen Orchestra blocks it." ;;
      *"wrong version number"*|*"SSL"*)
        add_finding "Xen Orchestra does not speak $XO_SCHEME on $XO_ADDRESS: an XO from sources listens with http:// on port 80 by default. Fix XO_URL and run install.sh again." ;;
      *)
        add_finding "The agent cannot reach Xen Orchestra at $XO_SCHEME://$XO_ADDRESS. Check XO_URL and that this machine reaches Xen Orchestra." ;;
    esac
  else
    pass "Xen Orchestra answers at $XO_SCHEME://$XO_ADDRESS (HTTP $RESP_CODE on /openmetrics/health)."
  fi
fi

# ----------------------------------------------------------------------------
section "3. OpenMetrics plugin (/openmetrics/health)"
# ----------------------------------------------------------------------------
if [ "$XO_VERDICT" = "UNKNOWN" ]; then
  if [ "$RESP_CODE" = "200" ] && printf '%s' "$RESP_BODY" | grep -q '"status":"ok"'; then
    pass "The OpenMetrics plugin answers: {\"status\":\"ok\"}."
  elif printf '%s' "$RESP_BODY" | grep -q "problem proxying"; then
    fail "Xen Orchestra answers, but its OpenMetrics plugin does not (HTTP $RESP_CODE: \"There was a problem proxying this request.\")."
    XO_VERDICT="NO_PLUGIN"
    add_finding "Turn on the OpenMetrics plugin in Xen Orchestra: Settings → Plugins → openmetrics. An XOA needs a Premium licence for it; Xen Orchestra built from sources includes it. The agent needs Xen Orchestra 6.9 or later."
  else
    fail "$XO_SCHEME://$XO_ADDRESS/openmetrics/health answered HTTP $RESP_CODE, not the plugin's {\"status\":\"ok\"}."
    detail "Response head: $(printf '%s' "$RESP_BODY" | tr '\n' ' ' | head -c 200)"
    XO_VERDICT="NOT_XO"
    add_finding "Whatever answers at $XO_ADDRESS has no /openmetrics: a Xen Orchestra older than 6.9, one whose OpenMetrics plugin is not installed, or not Xen Orchestra at all (a proxy in front of it?). XO_URL must be Xen Orchestra's own address."
  fi
else
  info "Skipped: Xen Orchestra is not reachable or not configured (see above)."
fi

# ----------------------------------------------------------------------------
section "4. Xen Orchestra's certificate"
# ----------------------------------------------------------------------------
if [ "$XO_VERDICT" != "UNKNOWN" ]; then
  info "Skipped: Xen Orchestra is not reachable or not configured (see above)."
elif [ "$XO_SCHEME" = "http" ]; then
  info "Skipped: XO_URL uses http:// — there is no certificate to check (see the warning above)."
elif [ ! -s "$CA_PEM" ] || [ -d "$CA_PEM" ]; then
  fail "No xo-ca.pem to check Xen Orchestra's certificate against (see Section 1)."
  XO_VERDICT="TLS"
else
  if [ -n "$XO_TLS_FINGERPRINT" ]; then
    info "Trust: Xen Orchestra's own certificate, pinned (XO_TLS_FINGERPRINT)."
  elif [ -n "$XO_CA_FILE" ]; then
    info "Trust: the CA bundle XO_CA_FILE named ($XO_CA_FILE), copied to xo-ca.pem."
  else
    info "Trust: this machine's CA bundle, copied to xo-ca.pem."
  fi
  # What Xen Orchestra presents, read without trusting it, to name it.
  xo_target /openmetrics/health
  CERTS_RAW=$(agent_netns_curl -sS -m 30 -k -o /dev/null -w '%{certs}' ${XO_REQ_ARGS[@]+"${XO_REQ_ARGS[@]}"} "$XO_REQ_URL")
  SERVED_PEM=$(printf '%s\n' "$CERTS_RAW" | first_certificate)
  SERVED_FP=$(printf '%s\n' "$SERVED_PEM" | pem_fingerprint)
  SERVED_NAMES=$(printf '%s\n' "$CERTS_RAW" | sed -n 's/^X509v3 Subject Alternative Name://p' | head -1)
  PIN_DRIFTED=0
  if [ -n "$XO_TLS_FINGERPRINT" ] && [ -n "$SERVED_FP" ] \
    && [ "$(normalize_fingerprint "$XO_TLS_FINGERPRINT")" != "$(normalize_fingerprint "$SERVED_FP")" ]; then
    PIN_DRIFTED=1
  fi

  xo_req trust /openmetrics/health
  if [ "$RESP_CODE" != "000" ]; then
    pass "Xen Orchestra's certificate checks out against xo-ca.pem${XO_TLS_SERVER_NAME:+ for $XO_TLS_SERVER_NAME}."
    if [ -n "$XO_TLS_FINGERPRINT" ] && [ -n "$SERVED_FP" ]; then
      if [ "$PIN_DRIFTED" = 0 ]; then
        pass "It is the pinned certificate (SHA-256 $SERVED_FP)."
      else
        warn "It checks out, but its fingerprint is not XO_TLS_FINGERPRINT's ($SERVED_FP)."
        add_finding "XO_TLS_FINGERPRINT in $ENV_FILE no longer names the certificate Xen Orchestra presents, though xo-ca.pem still trusts it. Run install.sh again with XO_TLS_FINGERPRINT=$SERVED_FP once you have checked it on Xen Orchestra."
      fi
    fi
    if command -v openssl >/dev/null 2>&1 && [ -n "$SERVED_PEM" ]; then
      if ! printf '%s\n' "$SERVED_PEM" | openssl x509 -noout -checkend 2592000 >/dev/null 2>&1; then
        warn "Xen Orchestra's certificate expires within 30 days: the agent stops reading Xen Orchestra when it does."
        add_finding "Renew Xen Orchestra's certificate before it expires$( [ -n "$XO_TLS_FINGERPRINT" ] && printf ', then run install.sh again with the new XO_TLS_FINGERPRINT')."
      fi
    fi
  else
    TLS_ERROR=$(printf '%s' "$RESP_BODY" | grep -v '^OU' | tr '\n' ' ' | head -c 300)
    if [ -n "$SERVED_PEM" ] && [ -z "$SERVED_NAMES" ]; then
      fail "Xen Orchestra's certificate is issued to no name (no subjectAltName), so it can never be checked."
      XO_VERDICT="NO_NAMES"
      add_finding "Xen Orchestra presents a certificate with no subjectAltName — most likely the self-signed one it makes for itself. The collector checks that a certificate is issued to the address it connects to (as every current TLS client does) and never skips that check, so it cannot trust this one, pinned or not. Give Xen Orchestra a certificate that names its address (README.md, \"Xen Orchestra's certificate\"), then run install.sh again."
    elif [ "$PIN_DRIFTED" = 1 ] || { [ -n "$XO_TLS_FINGERPRINT" ] && [ -z "$SERVED_FP" ] && ! printf '%s' "$TLS_ERROR" | grep -qE 'subject name|expired'; }; then
      fail "Xen Orchestra presents a certificate that is NOT the pinned one."
      detail "XO_TLS_FINGERPRINT:     $XO_TLS_FINGERPRINT"
      detail "Xen Orchestra presents: ${SERVED_FP:-? (install openssl to see its fingerprint)}"
      XO_VERDICT="DRIFT"
      add_finding "Xen Orchestra's certificate changed since the agent pinned it (renewed, or made again when it expired), or something between this machine and Xen Orchestra intercepts the connection. Check the fingerprint on Xen Orchestra's machine (openssl x509 -noout -fingerprint -sha256 -in <the certificate xo-server uses>) and, if it is Xen Orchestra's, run install.sh again with XO_TLS_FINGERPRINT=${SERVED_FP:-<that fingerprint>}."
    else
      case "$TLS_ERROR" in
        *"subject name"*)
          fail "Xen Orchestra's certificate is not issued to ${XO_TLS_SERVER_NAME:-$XO_HOST} (it names: ${SERVED_NAMES:-?})."
          XO_VERDICT="TLS"
          add_finding "Set XO_TLS_SERVER_NAME in $ENV_FILE to one of the names the certificate lists, or use one of them in XO_URL, then run install.sh again."
          ;;
        *"expired"*)
          fail "Xen Orchestra's certificate has expired: the collector refuses it, pinned or not."
          XO_VERDICT="TLS"
          add_finding "Renew Xen Orchestra's certificate, then run install.sh again (a new certificate has a new fingerprint: XO_TLS_FINGERPRINT must name it)."
          ;;
        *)
          fail "Xen Orchestra's certificate does not check out against xo-ca.pem."
          XO_VERDICT="TLS"
          add_finding "xo-ca.pem does not hold the CA that issued Xen Orchestra's certificate${SERVED_FP:+ (SHA-256 $SERVED_FP)}. Run install.sh again with XO_CA_FILE set to that CA's bundle, or XO_TLS_FINGERPRINT set to the certificate's fingerprint once you have checked it on Xen Orchestra."
          ;;
      esac
    fi
    detail "curl: $TLS_ERROR"
  fi
fi

# ----------------------------------------------------------------------------
section "5. OpenMetrics secret"
# ----------------------------------------------------------------------------
METRICS_BODY=""
if [ "$XO_VERDICT" != "UNKNOWN" ]; then
  info "Skipped: fix the step above first."
else
  xo_req secret /openmetrics/metrics
  METRICS_BODY="$RESP_BODY"
  case "$RESP_CODE" in
    200)
      pass "Xen Orchestra accepts the secret (/openmetrics/metrics → 200)." ;;
    401)
      XO_VERDICT="SECRET"
      if printf '%s' "$RESP_BODY" | grep -q "does not match"; then
        fail "Xen Orchestra REFUSED the secret (401: \"Query authentication does not match server setting\")."
        add_finding "XO_OPENMETRICS_SECRET is not the OpenMetrics plugin's secret. Copy it from Xen Orchestra (Settings → Plugins → openmetrics) — it changes when someone sets a new one there — and run install.sh again with XO_OPENMETRICS_SECRET set to it."
      else
        fail "Xen Orchestra got no secret (401: \"Query is not authenticated\")."
        add_finding "No Authorization header reached Xen Orchestra: XO_OPENMETRICS_SECRET is empty, or a proxy between this machine and Xen Orchestra strips the header."
      fi ;;
    000)
      fail "No answer from /openmetrics/metrics (curl exit ${RESP_EXIT:-?})."
      detail "curl: $(printf '%s' "$RESP_BODY" | tr '\n' ' ' | head -c 200)"
      XO_VERDICT="UNREACHABLE"
      add_finding "Xen Orchestra stopped answering while it gathered the metrics. A Xen Orchestra whose hosts answer slowly can take long: the collector waits 50 seconds for it." ;;
    *)
      fail "/openmetrics/metrics answered HTTP $RESP_CODE."
      detail "Response head: $(printf '%s' "$RESP_BODY" | tr '\n' ' ' | head -c 200)"
      XO_VERDICT="NO_PLUGIN"
      add_finding "Xen Orchestra accepts the secret but fails to gather the metrics (HTTP $RESP_CODE): look at xo-server's log for xo:xo-server-openmetrics, and check every pool's hosts answer Xen Orchestra." ;;
  esac
fi

# ----------------------------------------------------------------------------
section "6. Pools Xen Orchestra reports"
# ----------------------------------------------------------------------------
if [ "$XO_VERDICT" != "UNKNOWN" ]; then
  info "Skipped: fix the step above first."
else
  case "$RESP_TYPE" in
    application/openmetrics-text*) pass "The answer is OpenMetrics ($RESP_TYPE)." ;;
    *)
      warn "The answer's Content-Type is '$RESP_TYPE', not application/openmetrics-text — the collector then misreads Xen Orchestra's timestamps (seconds, not milliseconds)."
      add_finding "Something between this machine and Xen Orchestra rewrites the Content-Type of /openmetrics/metrics. Point XO_URL at Xen Orchestra itself." ;;
  esac
  POOL_COUNT=$(printf '%s\n' "$METRICS_BODY" | grep -c '^xcp_pool_connected{' || true)
  if [ "${POOL_COUNT:-0}" -gt 0 ] 2>/dev/null; then
    POOL_NAMES=$(metric_label_values xcp_pool_connected pool_name "$METRICS_BODY" | sed 's/^$/(a pool with no name)/' | paste -sd, - | sed 's/,/, /g')
    SERIES=$(printf '%s\n' "$METRICS_BODY" | grep -c '^xcp_' || true)
    pass "Xen Orchestra reports $POOL_COUNT pool(s): ${POOL_NAMES:-?} — $SERIES xcp_* series."
    XO_VERDICT="OK"
    HOSTS_DOWN=$(printf '%s\n' "$METRICS_BODY" | grep '^xcp_host_status{' | grep -vc 'power_state="Running"' || true)
    if [ "${HOSTS_DOWN:-0}" -gt 0 ] 2>/dev/null; then
      info "$HOSTS_DOWN host(s) are not running: Xen Orchestra reports their status and nothing else."
    fi
  elif printf '%s' "$METRICS_BODY" | grep -q "No connected hosts"; then
    warn "Xen Orchestra is connected to no pool: there is nothing to report."
    XO_VERDICT="NO_POOLS"
    add_finding "Connect Xen Orchestra to your pools (Settings → Servers in Xen Orchestra). Each pool appears in OneUptime on the next scrape once it is."
  else
    fail "The answer holds no xcp_pool_connected series — not Xen Orchestra's metrics."
    detail "Response head: $(printf '%s' "$METRICS_BODY" | tr '\n' ' ' | head -c 200)"
    XO_VERDICT="NOT_XO"
    add_finding "XO_URL must be Xen Orchestra's own address, with its OpenMetrics plugin turned on (Xen Orchestra 6.9 or later)."
  fi
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
# (default internal telemetry) — reachable only from its network namespace.
SENT="?"; FAILED="?"; ACCEPTED="?"
if [ "$AGENT_RUNNING" = 1 ]; then
  SELF=$(agent_netns_curl -sS -m 5 "http://127.0.0.1:8888/metrics" 2>/dev/null)
  if [ -n "$SELF" ]; then
    ACCEPTED=$(printf '%s\n' "$SELF" | awk '/^otelcol_receiver_accepted_metric_points/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    SENT=$(printf '%s\n' "$SELF" | awk '/^otelcol_exporter_sent_metric_points/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    FAILED=$(printf '%s\n' "$SELF" | awk '/^otelcol_exporter_send_failed_/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
    info "Collector self-metrics: accepted=$ACCEPTED  sent=$SENT  send_failed=$FAILED"
    if [ "${FAILED:-0}" -gt 0 ] 2>/dev/null; then
      fail "Collector reports send_failed > 0 → exports are failing (a refused key, or network/URL/TLS)."
      add_finding "Collector send_failed=$FAILED. The collector cannot deliver to OneUptime — the next section tells a refused ingestion key (401/422) apart from an egress/DNS/TLS/firewall problem."
    elif [ "${ACCEPTED:-0}" -eq 0 ] 2>/dev/null; then
      warn "No datapoints accepted yet — the Xen Orchestra scrape is failing (see Sections 2-6 and 10) or the collector started less than a minute ago."
    elif [ "${SENT:-0}" -gt 0 ] 2>/dev/null; then
      pass "Bytes are leaving the collector and the server is returning 2xx."
      detail "NOTE: servers older than mid-2026 answered 2xx even for a bad key. The token probe below settles it."
    fi
  else
    warn "Couldn't scrape collector self-metrics (:8888) — skipping (telemetry address may be customized)."
  fi
else
  warn "Agent container not running — skipping self-metrics."
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
  add_finding "DEFINITIVE: OneUptime does not accept this ingestion key (unknown, revoked, disabled, expired, or a browser key). Every export is refused (401/422) and dropped, and the collector only logs 'Exporting failed', which is why the agent looks healthy while nothing ingests. FIX: create or copy a live server Telemetry Ingestion Key in OneUptime, update ONEUPTIME_TELEMETRY_INGESTION_KEY in $ENV_FILE, then: cd $DIR && docker compose up -d"
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
if [ "$AGENT_RUNNING" = 1 ] || [ -n "$STATE" ]; then
  LOGERR=$(docker logs --tail 500 "$AGENT_CONTAINER" 2>&1 \
    | grep -iE 'error|failed|denied|refused|x509|tls|deadline|429|throttl|unauthori|status 40[0-9]|status 50[0-9]|no such host|must be specified' | tail -50)
  if [ -n "$LOGERR" ]; then
    warn "Recent error-ish log lines from the collector (last 50):"
    printf '%s\n' "$LOGERR" | while read -r l; do detail "$(printf '%s' "$l" | head -c 220)"; done
    if printf '%s' "$LOGERR" | grep -qiE 'not valid for any names'; then
      add_finding "The collector log shows Xen Orchestra's certificate is issued to no name (no subjectAltName — Xen Orchestra's own self-signed one): it can never be checked. Give Xen Orchestra a certificate that names its address (README.md, \"Xen Orchestra's certificate\")."
    elif printf '%s' "$LOGERR" | grep -qiE "doesn't contain any IP SANs|is valid for|not .* matches"; then
      add_finding "The collector log shows Xen Orchestra's certificate is not issued to the address it connects to: set XO_TLS_SERVER_NAME in $ENV_FILE to a name the certificate lists and run: cd $DIR && docker compose up -d --force-recreate"
    elif printf '%s' "$LOGERR" | grep -qiE 'x509|failed to verify certificate'; then
      add_finding "The collector log shows Xen Orchestra's certificate failing the check against xo-ca.pem (x509): its certificate changed since install.sh trusted it, or xo-ca.pem does not hold its CA. Run install.sh again."
    fi
    if printf '%s' "$LOGERR" | grep -qiE 'unable to read CA cert|unable to use specified CA cert|unable to load specified CA cert'; then
      add_finding "The collector log shows it cannot read xo-ca.pem, so it never scrapes Xen Orchestra. Run install.sh again: it writes the file."
    fi
    if printf '%s' "$LOGERR" | grep -qiE 'status 401'; then
      add_finding "The collector log shows Xen Orchestra refusing the scrape (401): XO_OPENMETRICS_SECRET is not the OpenMetrics plugin's secret."
    fi
    if printf '%s' "$LOGERR" | grep -qiE 'status 50[0-9]'; then
      add_finding "The collector log shows Xen Orchestra failing the scrape (5xx): the OpenMetrics plugin is not loaded, or failed to gather the metrics (xo-server's log says why)."
    fi
    if printf '%s' "$LOGERR" | grep -qiE 'context deadline exceeded'; then
      add_finding "The collector log shows a scrape timing out: Xen Orchestra took longer than 50 seconds to gather the metrics, usually because a host does not answer it."
    fi
  else
    pass "No scrape or export errors in recent collector logs."
    detail "(A refused ingestion key would show here as 'Exporting failed … HTTP Status Code 401/422'.)"
  fi
else
  info "Container not present — no collector log to inspect."
fi

# ============================================================================
section "11. VERDICT"
# ============================================================================
if [ "$AGENT_RUNNING" != 1 ]; then
  printf "%s%sROOT CAUSE: the agent container isn't running.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "Fix the container (see Section 1) — until it runs, nothing is scraped or shipped.\n"
elif [ "$TOKEN_VERDICT" = "INVALID" ]; then
  printf "%s%sROOT CAUSE: the ingestion token is rejected by OneUptime.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "This is the classic trap: /otlp refuses every batch (401/422) and the collector\n"
  printf "drops it, yet the agent looks healthy while the pools stay Disconnected.\n"
elif [ "$EGRESS" = "FAIL" ]; then
  printf "%s%sROOT CAUSE: the agent can't deliver telemetry to OneUptime (network/URL/TLS).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$XO_VERDICT" != "OK" ] && [ "$XO_VERDICT" != "UNKNOWN" ]; then
  case "$XO_VERDICT" in
    MISCONFIGURED)
      printf "%s%sROOT CAUSE: the Xen Orchestra settings in .env are incomplete or invalid.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
      printf "Fix what Section 2 lists and run install.sh again.\n" ;;
    UNREACHABLE)
      printf "%s%sROOT CAUSE: the agent cannot reach Xen Orchestra (step 2).%s\n" "$C_BOLD" "$C_RED" "$C_OFF" ;;
    NO_PLUGIN)
      printf "%s%sROOT CAUSE: Xen Orchestra's OpenMetrics plugin does not answer (step 3).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
      printf "Turn it on under Settings → Plugins → openmetrics (Xen Orchestra 6.9 or later).\n" ;;
    NOT_XO)
      printf "%s%sROOT CAUSE: what answers at XO_URL is not Xen Orchestra's OpenMetrics (steps 3 and 6).%s\n" "$C_BOLD" "$C_RED" "$C_OFF" ;;
    NO_NAMES)
      printf "%s%sROOT CAUSE: Xen Orchestra's certificate names no host, so it can never be checked (step 4).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
      printf "Give Xen Orchestra a certificate that names its address (README.md, \"Xen Orchestra's certificate\").\n" ;;
    DRIFT)
      printf "%s%sROOT CAUSE: Xen Orchestra's certificate is no longer the one the agent pinned (step 4).%s\n" "$C_BOLD" "$C_RED" "$C_OFF" ;;
    TLS)
      printf "%s%sROOT CAUSE: the agent does not trust Xen Orchestra's certificate (step 4).%s\n" "$C_BOLD" "$C_RED" "$C_OFF" ;;
    SECRET)
      printf "%s%sROOT CAUSE: Xen Orchestra refuses the OpenMetrics secret (step 5).%s\n" "$C_BOLD" "$C_RED" "$C_OFF" ;;
    NO_POOLS)
      printf "%s%sROOT CAUSE: Xen Orchestra is connected to no pool, so there is nothing to report (step 6).%s\n" "$C_BOLD" "$C_RED" "$C_OFF" ;;
  esac
elif [ "$TOKEN_HAS_WS" = 1 ]; then
  printf "%s%sROOT CAUSE: the ingestion key has stray whitespace.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "The collector sends the key with that whitespace, so OneUptime can't match it and\n"
  printf "refuses every export. Fix %s and restart.\n" "$ENV_FILE"
elif [ "$TOKEN_SHAPE_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: the ingestion key is empty/malformed.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$TOKEN_VERDICT" = "VALID" ]; then
  printf "%s%sThe agent looks healthy and OneUptime accepts the token.%s\n" "$C_BOLD" "$C_GRN" "$C_OFF"
  printf "If the pools still say Disconnected:\n"
  printf "  1. Give it ~2-5 min — status flips to Connected on the next telemetry batch,\n"
  printf "     and the disconnect cron runs on a 5-minute cycle.\n"
  printf "  2. Each pool is matched on its XAPI UUID, so a renamed pool keeps its history;\n"
  printf "     a pool Xen Orchestra no longer reports stays Disconnected (that's expected).\n"
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
