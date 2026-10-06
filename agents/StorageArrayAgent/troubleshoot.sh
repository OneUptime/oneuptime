#!/usr/bin/env bash
#
# OneUptime Storage Array Agent — Diagnostic ("doctor")
# ------------------------------------------------------
# Run this on the machine where the agent is installed (docker compose,
# optionally wrapped by the systemd unit). It explains the #1 confusing
# failure mode: the storage array shows "Disconnected" in OneUptime and no
# metrics are ingested, yet the containers look healthy.
#
# Why that happens: the agent ships telemetry to `<url>/otlp/v1/*` with the
# ingestion key in the `x-oneuptime-token` header. If that key is missing,
# malformed, unknown or expired, the OTLP endpoints answer 401 (422 for a
# disabled key or a browser key). Neither is retryable, so the collector drops
# every batch and logs one "Exporting failed" line per batch, which is easy to
# miss while the container keeps running, and the array never flips to
# "connected" because connection status is driven purely by telemetry
# actually arriving. (Servers older than mid-2026 answered 200 instead and
# dropped the data without telling the collector at all.)
#
# How it gets a definitive answer: from inside the agent container's network
# namespace it calls `GET <url>/otlp/v1/validate`, a validation endpoint that
# judges the key alone (200 valid / 401 unknown, disabled or expired) and
# names its type, so a browser key, which validates but which ingest refuses
# from a collector, is caught too. On older servers that lack it, it falls
# back to `POST <url>/fluentd/v1/logs`, which runs the SAME auth but is NOT
# an /otlp path, so even a server that old answers a bad token with
# `400 Invalid service token` there (a current one answers 401/422).
#
# It also checks the array side of the chain, exactly as the collector
# reaches it: the FlashArray's native OpenMetrics endpoint
# (https://<array>/metrics/array?namespace=purefa), or Pure's exporter
# sidecar for an older FlashArray or a FlashBlade — DNS, TLS (arrays ship a
# self-signed certificate), whether the array has the native endpoint at all,
# and whether it accepts the read-only user's API token. The API token is
# handed to curl on stdin, never on a command line.
#
# Usage:
#   ./troubleshoot.sh [-d INSTALL_DIR] [--skip-egress] [--curl-image IMG] [--no-color]
#
# Defaults: INSTALL_DIR=/opt/oneuptime-storage-array-agent
#
# Requires: docker (required). The collector image is distroless (no shell,
# no curl), so the network probes run a small curl image as a sibling
# container sharing the agent's network namespace — the exact path the
# collector itself uses.

set -uo pipefail

# ----------------------------------------------------------------------------
# Config / args
# ----------------------------------------------------------------------------
DIR="/opt/oneuptime-storage-array-agent"
SKIP_EGRESS=0
CURL_IMAGE="curlimages/curl:latest"
USE_COLOR=1
AGENT_CONTAINER="oneuptime-storage-array-agent"

while [ $# -gt 0 ]; do
  case "$1" in
    -d|--dir)      DIR="${2:-}"; shift 2 ;;
    --skip-egress) SKIP_EGRESS=1; shift ;;
    --curl-image)  CURL_IMAGE="${2:-}"; shift 2 ;;
    --no-color)    USE_COLOR=0; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,45p'
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

# Read one variable from .env the way Docker Compose v2 does (the same rules
# install.sh writes by): the last assignment wins, single-quoted values are
# literal, double-quoted values undo \\ \" and $$, and an unquoted value
# stops at " #" and is trimmed. Without this a quoted token would be probed
# with its quotes still on.
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

# Read an env var as the running container actually sees it (env_file and
# compose defaults included). Falls back to the .env file when the container
# isn't running.
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
# follow the collector's real path: compose network (the exporter sidecars'
# names resolve there), DNS, proxy, firewall, TLS. The collector image is
# distroless, so we run a sibling curl container with --network container:.
# Falls back to the default bridge when the agent container is down (close
# enough for a reachability verdict; the runtime section already failed by
# then). Extra `docker run` options (e.g. -i) go in DOCKER_RUN_EXTRA; curl
# args follow.
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

# The value of label $2 on the first $1{...} line of a metrics body ($3).
metric_label() {
  printf '%s\n' "$3" | grep "^$1{" | head -1 | sed -n "s/.*[{,]$2=\"\([^\"]*\)\".*/\1/p"
}

# ============================================================================
printf "%s%sOneUptime Storage Array Agent — Diagnostic%s\n" "$C_BOLD" "$C_BLU" "$C_OFF"
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
  # A second array's agent on this machine has its own container name
  # (README.md, "Monitoring several arrays"): ask compose which container
  # this directory runs, and keep the default name when it cannot tell.
  CID=$(cd "$DIR" 2>/dev/null && docker compose ps -a -q oneuptime-storage-array-agent 2>/dev/null | head -1)
  if [ -n "$CID" ]; then
    NAME=$(docker inspect -f '{{.Name}}' "$CID" 2>/dev/null | sed 's#^/##')
    [ -n "$NAME" ] && AGENT_CONTAINER="$NAME"
  fi
else
  warn "No compose install at '$DIR' — re-run with -d <dir> if you installed elsewhere."
fi

# systemd wrapper (optional — it only wraps docker compose).
if command -v systemctl >/dev/null 2>&1; then
  SYSD=$(systemctl is-active oneuptime-storage-array-agent 2>/dev/null || true)
  [ "$SYSD" = "active" ] && info "systemd unit oneuptime-storage-array-agent is active."
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
  add_finding "The agent container is not running (state: $STATE). A restart loop usually means a config error (an empty STORAGE_ARRAY_NAME, an endpoint with https:// in it, a STORAGE_ARRAY_INSECURE_SKIP_VERIFY that is not true/false) — check: docker logs $AGENT_CONTAINER"
fi

# ----------------------------------------------------------------------------
section "2. Array endpoint & API token"
# ----------------------------------------------------------------------------
# Which shipped config runs decides how the collector reaches the array:
#   otel-collector-config.yaml                     https://<array>/metrics/*?namespace=purefa
#   otel-collector-config.flasharray-exporter.yaml http://pure-fa-exporter:9490/metrics/*?endpoint=<array>
#   otel-collector-config.flashblade.yaml          http://pure-fb-exporter:9491/metrics/*?endpoint=<array>
# The probe below asks the array endpoint the same way, with the same API
# token, from the collector's own network namespace.
CONFIG_NAME=$(agent_env STORAGE_ARRAY_COLLECTOR_CONFIG)
[ -z "$CONFIG_NAME" ] && CONFIG_NAME="otel-collector-config.yaml"
CONFIG_FILE="$DIR/$CONFIG_NAME"
PROFILES=$(agent_env COMPOSE_PROFILES)
STORAGE_SYSTEM=$(agent_env STORAGE_SYSTEM)
SKIP_VERIFY=$(agent_env STORAGE_ARRAY_INSECURE_SKIP_VERIFY)
SKIP_VERIFY=$(printf '%s' "$SKIP_VERIFY" | tr '[:upper:]' '[:lower:]')
MODE=""; NEED_PROFILE=""; EXPECT_SYSTEM=""; INFO_METRIC=""; PLATFORM=""
ARRAY_VERDICT="UNKNOWN"   # UNKNOWN | OK | TOKEN | NO_NATIVE | EXPORTER_DOWN | UNREACHABLE | TLS | MISCONFIGURED | NOT_PURE

case "$CONFIG_NAME" in
  otel-collector-config.yaml)
    MODE="native"; EXPECT_SYSTEM="purestorage.flasharray"; INFO_METRIC="purefa_info"; PLATFORM="FlashArray" ;;
  otel-collector-config.flasharray-exporter.yaml)
    MODE="fa-exporter"; NEED_PROFILE="flasharray-exporter"; EXPECT_SYSTEM="purestorage.flasharray"; INFO_METRIC="purefa_info"; PLATFORM="FlashArray" ;;
  otel-collector-config.flashblade.yaml)
    MODE="fb-exporter"; NEED_PROFILE="flashblade"; EXPECT_SYSTEM="purestorage.flashblade"; INFO_METRIC="purefb_info"; PLATFORM="FlashBlade" ;;
  *)
    warn "STORAGE_ARRAY_COLLECTOR_CONFIG='$CONFIG_NAME' is not one of the shipped configs — skipping the array probe."
    add_finding "STORAGE_ARRAY_COLLECTOR_CONFIG should name one of the shipped configs: otel-collector-config.yaml (FlashArray, native), otel-collector-config.flasharray-exporter.yaml (older FlashArray) or otel-collector-config.flashblade.yaml (FlashBlade)."
    ARRAY_VERDICT="MISCONFIGURED" ;;
esac

if [ -n "$MODE" ]; then
  case "$MODE" in
    native)      info "Mode: $PLATFORM, native OpenMetrics on the array ($CONFIG_NAME)" ;;
    fa-exporter) info "Mode: $PLATFORM through Pure's exporter, the pure-fa-exporter service ($CONFIG_NAME)" ;;
    fb-exporter) info "Mode: $PLATFORM through Pure's exporter, the pure-fb-exporter service ($CONFIG_NAME)" ;;
  esac

  if [ -d "$DIR" ] && [ ! -f "$CONFIG_FILE" ]; then
    fail "The selected config $CONFIG_FILE is missing — the collector mounts an empty directory in its place and cannot start."
    add_finding "Download $CONFIG_NAME next to docker-compose.yml (re-running install.sh does this), then: cd $DIR && docker compose up -d"
  fi

  # The exporter only runs when its compose profile is active.
  if [ -n "$NEED_PROFILE" ]; then
    case ",$(printf '%s' "$PROFILES" | tr -d ' ')," in
      *",$NEED_PROFILE,"*) pass "COMPOSE_PROFILES includes '$NEED_PROFILE' (starts the exporter this config scrapes)." ;;
      *)
        fail "COMPOSE_PROFILES='$PROFILES' does not include '$NEED_PROFILE' — the exporter this config scrapes never starts."
        add_finding "Set COMPOSE_PROFILES=$NEED_PROFILE in $ENV_FILE (it must match STORAGE_ARRAY_COLLECTOR_CONFIG=$CONFIG_NAME), then: cd $DIR && docker compose up -d" ;;
    esac
  fi

  # storage.system should name the platform the config reads.
  if [ -z "$STORAGE_SYSTEM" ]; then
    info "STORAGE_SYSTEM is not set — docker-compose.yml stamps purestorage.flasharray."
    STORAGE_SYSTEM="purestorage.flasharray"
  fi
  if [ "$STORAGE_SYSTEM" != "$EXPECT_SYSTEM" ]; then
    warn "STORAGE_SYSTEM='$STORAGE_SYSTEM' but $CONFIG_NAME reads a $PLATFORM ($EXPECT_SYSTEM)."
    add_finding "Set STORAGE_SYSTEM=$EXPECT_SYSTEM in $ENV_FILE so OneUptime shows the right platform, then: cd $DIR && docker compose up -d"
  fi

  if [ "$MODE" = "fb-exporter" ]; then
    ENDPOINT_VAR="PURE_FB_ENDPOINT"; TOKEN_VAR="PURE_FB_API_TOKEN"
  else
    ENDPOINT_VAR="PURE_FA_ENDPOINT"; TOKEN_VAR="PURE_FA_API_TOKEN"
  fi
  ENDPOINT=$(agent_env "$ENDPOINT_VAR")
  ARRAY_TOKEN=$(agent_env "$TOKEN_VAR")
  ENDPOINT_HOST="${ENDPOINT%%:*}"

  if [ -z "$ENDPOINT" ]; then
    fail "$ENDPOINT_VAR is not set — the collector doesn't know which array to read."
    add_finding "Set $ENDPOINT_VAR in $ENV_FILE to the array's management address (host name or IP, no https://) and restart: cd $DIR && docker compose up -d"
    ARRAY_VERDICT="MISCONFIGURED"
  fi
  case "$ENDPOINT" in
    *://*)
      fail "$ENDPOINT_VAR='$ENDPOINT' has a scheme — it must be the bare host name or IP."
      add_finding "Remove the scheme from $ENDPOINT_VAR in $ENV_FILE (fa01.example.com, not https://fa01.example.com) and restart the agent."
      ARRAY_VERDICT="MISCONFIGURED" ;;
  esac
  # The localhost trap: inside the agent container, localhost is the agent.
  case "$ENDPOINT_HOST" in
    localhost|127.0.0.1)
      fail "$ENDPOINT_VAR points at localhost — inside the agent container that is the agent itself, not the array."
      add_finding "$ENDPOINT_VAR must be the array's management address, reachable from a container: its DNS name or IP, never localhost."
      ARRAY_VERDICT="MISCONFIGURED" ;;
  esac
  if [ -z "$ARRAY_TOKEN" ]; then
    fail "$TOKEN_VAR is not set — the array refuses every scrape without an API token."
    add_finding "Create an API token for a $PLATFORM user with the readonly role (README.md) and set $TOKEN_VAR in $ENV_FILE, then restart the agent."
    ARRAY_VERDICT="MISCONFIGURED"
  else
    TOKEN_UUID='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
    if [ "$MODE" = "fb-exporter" ]; then
      if [[ "$ARRAY_TOKEN" =~ ^T-$TOKEN_UUID$ ]]; then
        pass "$TOKEN_VAR is set and shaped like a FlashBlade API token (T-…)."
      else
        warn "$TOKEN_VAR does not look like a FlashBlade API token (T- followed by a UUID) — check you pasted the token, not a password."
      fi
    else
      if [[ "$ARRAY_TOKEN" =~ ^$TOKEN_UUID$ ]]; then
        pass "$TOKEN_VAR is set and shaped like a FlashArray API token (a UUID)."
      else
        warn "$TOKEN_VAR does not look like a FlashArray API token (a UUID) — check you pasted the token, not a password."
      fi
    fi
  fi
  if [ "$MODE" = "native" ]; then
    case "$SKIP_VERIFY" in
      true|false) ;;
      "") info "STORAGE_ARRAY_INSECURE_SKIP_VERIFY is empty — docker-compose.yml defaults it to true." ; SKIP_VERIFY="true" ;;
      *)  fail "STORAGE_ARRAY_INSECURE_SKIP_VERIFY='$SKIP_VERIFY' is not a boolean — the collector refuses to start."
          add_finding "Set STORAGE_ARRAY_INSECURE_SKIP_VERIFY to exactly true or false in $ENV_FILE and restart the agent."
          ARRAY_VERDICT="MISCONFIGURED" ;;
    esac
  fi

  if [ "$ARRAY_VERDICT" = "UNKNOWN" ]; then
    declare -a PROBE_ARGS=()
    case "$MODE" in
      native)
        PROBE_URL="https://$ENDPOINT/metrics/array?namespace=purefa"
        # -k ONLY when the collector itself skips verification, so a
        # certificate failure is reported exactly as the collector hits it.
        [ "$SKIP_VERIFY" = "true" ] && PROBE_ARGS=(-k) ;;
      fa-exporter) PROBE_URL="http://pure-fa-exporter:9490/metrics/array?endpoint=$ENDPOINT" ;;
      fb-exporter) PROBE_URL="http://pure-fb-exporter:9491/metrics/array?endpoint=$ENDPOINT" ;;
    esac
    info "Probing $PROBE_URL as the collector does (Bearer API token)."
    # The token reaches curl on stdin (-H @-), never on a command line.
    DOCKER_RUN_EXTRA=(-i)
    PROBE_OUT=$(printf 'Authorization: Bearer %s\n' "$ARRAY_TOKEN" \
      | agent_netns_curl ${PROBE_ARGS[@]+"${PROBE_ARGS[@]}"} -sS -m 60 -H @- -w $'\nOUSTATUS:%{http_code}' "$PROBE_URL")
    PROBE_EXIT=$?
    DOCKER_RUN_EXTRA=()
    PROBE_CODE=$(printf '%s\n' "$PROBE_OUT" | sed -n 's/^OUSTATUS:\([0-9]\{3\}\).*/\1/p' | head -1)
    PROBE_BODY=$(printf '%s\n' "$PROBE_OUT" | sed '/^OUSTATUS:/,$d')
    [ -z "$PROBE_CODE" ] && PROBE_CODE="000"
    PROBE_HEAD=$(printf '%s' "$PROBE_BODY" | tr '\n' ' ' | head -c 220)

    if [ "$PROBE_EXIT" != "0" ] || [ "$PROBE_CODE" = "000" ]; then
      fail "No answer from $PROBE_URL (curl exit $PROBE_EXIT)."
      detail "curl: $PROBE_HEAD"
      ARRAY_VERDICT="UNREACHABLE"
      case "$PROBE_BODY" in
        *"pure-fa-exporter"*|*"pure-fb-exporter"*)
          ARRAY_VERDICT="EXPORTER_DOWN"
          add_finding "The exporter service is not running, so its name does not resolve on the compose network. Set COMPOSE_PROFILES=$NEED_PROFILE in $ENV_FILE and run: cd $DIR && docker compose up -d (then check: docker compose ps)." ;;
        *"certificate"*|*"SSL"*|*"TLS"*|*"self-signed"*|*"self signed"*|*"unable to get local issuer"*)
          ARRAY_VERDICT="TLS"
          add_finding "TLS verification against the array fails — it presents its default self-signed certificate. Set STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true in $ENV_FILE, or install a certificate from a CA the collector image trusts, then restart the agent." ;;
        *"Could not resolve host"*|*"Name or service not known"*)
          add_finding "DNS resolution of the array's address fails from the agent container. Check $ENDPOINT_VAR and the machine's DNS." ;;
        *"refused"*|*"timed out"*|*"Failed to connect"*)
          add_finding "The connection to the array is refused or times out — a firewall between this machine and the array's management network is blocking TCP 443, or $ENDPOINT_VAR is wrong." ;;
        *)
          add_finding "The collector cannot reach $PROBE_URL. Verify $ENDPOINT_VAR and that this machine reaches the array's management interface on TCP 443." ;;
      esac
    elif [ "$PROBE_CODE" = "200" ] && printf '%s\n' "$PROBE_BODY" | grep -q "^$INFO_METRIC{"; then
      ARRAY_VERDICT="OK"
      INFO_NAME=$(metric_label "$INFO_METRIC" array_name "$PROBE_BODY")
      INFO_OS=$(metric_label "$INFO_METRIC" os "$PROBE_BODY")
      INFO_VERSION=$(metric_label "$INFO_METRIC" version "$PROBE_BODY")
      SERIES=$(printf '%s\n' "$PROBE_BODY" | grep -c "^${INFO_METRIC%_info}_" || true)
      pass "The array answers with metrics: ${INFO_NAME:-?} (${INFO_OS:-?} ${INFO_VERSION:-?}), $SERIES ${INFO_METRIC%_info}_* series on /metrics/array."
      [ "$MODE" = "native" ] && [ "$SKIP_VERIFY" = "true" ] && detail "TLS verification is OFF (STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true)."
    elif [ "$PROBE_CODE" = "401" ] || [ "$PROBE_CODE" = "403" ]; then
      fail "The array REJECTED the API token (HTTP $PROBE_CODE)."
      ARRAY_VERDICT="TOKEN"
      add_finding "The array does not accept $TOKEN_VAR. Create a new API token for the read-only user (README.md), paste it into $ENV_FILE, then: cd $DIR && docker compose up -d. A token created with an expiry stops working when it expires."
    elif [ "$MODE" = "native" ] && [ "$PROBE_CODE" = "404" ]; then
      fail "The array has no native OpenMetrics endpoint (HTTP 404 on /metrics/array) — its Purity//FA is older than 6.7."
      ARRAY_VERDICT="NO_NATIVE"
      add_finding "Use Pure's exporter for this FlashArray: re-run install.sh and choose the older-Purity option, or set STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml and COMPOSE_PROFILES=flasharray-exporter in $ENV_FILE, then: cd $DIR && docker compose up -d. Upgrading the array to Purity//FA 6.7 or later brings the native endpoint."
    else
      case "$PROBE_BODY" in
        *"failed to login"*)
          fail "Pure's exporter could not log in to the array with the API token (HTTP $PROBE_CODE)."
          detail "Exporter: $PROBE_HEAD"
          ARRAY_VERDICT="TOKEN"
          add_finding "The array does not accept $TOKEN_VAR. Create a new API token for the read-only user (README.md), paste it into $ENV_FILE, then: cd $DIR && docker compose up -d." ;;
        *"not a valid"*)
          fail "$ENDPOINT_VAR='$ENDPOINT' does not answer as a $PLATFORM REST API (HTTP $PROBE_CODE)."
          detail "Exporter: $PROBE_HEAD"
          ARRAY_VERDICT="NOT_PURE"
          add_finding "$ENDPOINT_VAR must be the $PLATFORM's management address (the one its GUI and REST API answer on). Fix it in $ENV_FILE and restart the agent." ;;
        *)
          if [ "$PROBE_CODE" = "200" ]; then
            fail "$PROBE_URL answered HTTP 200 but without $INFO_METRIC — not Pure's metrics."
            ARRAY_VERDICT="NOT_PURE"
            add_finding "Something answers at $ENDPOINT, but not with Pure's $INFO_METRIC series (a proxy? the wrong host?). $ENDPOINT_VAR must be the $PLATFORM's own management address."
          else
            fail "$PROBE_URL answered HTTP $PROBE_CODE."
            ARRAY_VERDICT="UNREACHABLE"
            add_finding "The array endpoint answers HTTP $PROBE_CODE: $PROBE_HEAD"
          fi
          detail "Response head: $PROBE_HEAD" ;;
      esac
    fi
  fi
fi

# ----------------------------------------------------------------------------
section "3. Array-name stamping"
# ----------------------------------------------------------------------------
# A missing storage.array.name is the exact analog of the Kubernetes agent's
# "no k8s.cluster.name ⇒ the cluster never connects" failure: discovery keys
# on that resource attribute, so without it no storage array ever appears.
# The collector refuses to start with an empty one.
ARRAY_NAME=$(agent_env STORAGE_ARRAY_NAME)
ARRAY_NAME_OK=0
if [ -n "$ARRAY_NAME" ]; then
  info "Reporting as array name: '${C_BOLD}${ARRAY_NAME}${C_OFF}'  (this is the storage.array.name OneUptime keys on)"
  detail "If this differs from a previous install, OneUptime shows a NEW array entry; the old one stays 'Disconnected'."
  ARRAY_NAME_OK=1
else
  fail "STORAGE_ARRAY_NAME is empty — the collector refuses to start without it, and no array can register."
  add_finding "Set STORAGE_ARRAY_NAME in $ENV_FILE and restart the agent. Discovery keys on the storage.array.name resource attribute it feeds."
fi
if [ -f "$CONFIG_FILE" ]; then
  if grep -q 'storage.array.name' "$CONFIG_FILE"; then
    pass "Collector config stamps the storage.array.name resource attribute."
  else
    fail "Collector config has NO storage.array.name resource processor — metrics will not attribute to an array."
    add_finding "The resource processor stamping storage.array.name was removed from $CONFIG_FILE. Restore the shipped config."
  fi
  if grep -q 'scrape_endpoint:' "$CONFIG_FILE"; then
    pass "Collector config labels every scrape job with its scrape_endpoint."
  else
    warn "Collector config has no scrape_endpoint labels — deleted volumes, hosts or file systems can linger in the inventory."
    add_finding "Restore the scrape_endpoint labels of the shipped $CONFIG_NAME (static_configs → labels)."
  fi
else
  warn "Config file $CONFIG_FILE not found — skipping the config checks (custom install dir? re-run with -d)."
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
    add_finding "The ingestion key is not a UUID, so OneUptime can never resolve it (every export is refused with 401). Set a real Telemetry Ingestion Key."
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
    info "Collector self-metrics: accepted=$ACCEPTED  sent=$SENT  send_failed=$FAILED"
    if [ "${FAILED:-0}" -gt 0 ] 2>/dev/null; then
      fail "Collector reports send_failed > 0 → exports are failing (a refused key, or network/URL/TLS)."
      add_finding "Collector send_failed=$FAILED. The collector cannot deliver to OneUptime — the next section tells a refused ingestion key (401/422) apart from an egress/DNS/TLS/firewall problem."
    elif [ "${ACCEPTED:-0}" -eq 0 ] 2>/dev/null; then
      warn "No datapoints accepted yet — the array scrape is failing (see Section 2 / 7) or the collector started less than a minute ago."
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
section "6. Egress + DEFINITIVE token check"
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
    *"refused"*|*"timed out"*|*"Failed to connect"*)
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
  warn "Token unusable/missing; cannot run the authenticated probe (fix Section 4 first)."; EGRESS="SKIPPED"
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
section "7. Recent collector errors"
# ----------------------------------------------------------------------------
if [ "$AGENT_RUNNING" = 1 ] || [ -n "$STATE" ]; then
  LOGERR=$(docker logs --tail 500 "$AGENT_CONTAINER" 2>&1 \
    | grep -iE 'error|failed|denied|refused|x509|tls|deadline|429|throttl|unauthori|status 40[0-9]|no such host|must be specified' | tail -50)
  if [ -n "$LOGERR" ]; then
    warn "Recent error-ish log lines from the collector (last 50):"
    printf '%s\n' "$LOGERR" | while read -r l; do detail "$(printf '%s' "$l" | head -c 160)"; done
    if printf '%s' "$LOGERR" | grep -qiE 'must be specified'; then
      add_finding "The collector log shows the resource processor refusing an empty value — STORAGE_ARRAY_NAME (or STORAGE_SYSTEM) is empty. Set it in $ENV_FILE and restart the agent."
    fi
    if printf '%s' "$LOGERR" | grep -qiE 'status 401|status 403|Unauthorized'; then
      add_finding "The collector log shows the array refusing the scrape (401/403): the API token is wrong, expired, or its user lost the readonly role."
    fi
    if printf '%s' "$LOGERR" | grep -qiE 'status 404'; then
      add_finding "The collector log shows HTTP 404 from the array: no native OpenMetrics endpoint (Purity//FA older than 6.7) — use otel-collector-config.flasharray-exporter.yaml (see Section 2)."
    fi
    if printf '%s' "$LOGERR" | grep -qiE 'x509'; then
      add_finding "The collector log shows a TLS (x509) failure against the array: set STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true in $ENV_FILE (arrays ship a self-signed certificate) and restart the agent."
    fi
  else
    pass "No export or scrape errors in recent collector logs."
    detail "(A refused ingestion key would show here as 'Exporting failed … HTTP Status Code 401/422'.)"
  fi
else
  info "Container not present — no collector log to inspect."
fi

# ============================================================================
section "8. VERDICT"
# ============================================================================
if [ "$AGENT_RUNNING" != 1 ]; then
  printf "%s%sROOT CAUSE: the agent container isn't running.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "Fix the container (see Section 1) — until it runs, nothing is scraped or shipped.\n"
elif [ "$TOKEN_VERDICT" = "INVALID" ]; then
  printf "%s%sROOT CAUSE: the ingestion token is rejected by OneUptime.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "This is the classic trap: /otlp refuses every batch (401/422) and the collector\n"
  printf "drops it, yet the agent looks healthy while the array stays Disconnected.\n"
elif [ "$EGRESS" = "FAIL" ]; then
  printf "%s%sROOT CAUSE: the agent can't deliver telemetry to OneUptime (network/URL/TLS).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$ARRAY_VERDICT" != "OK" ] && [ "$ARRAY_VERDICT" != "UNKNOWN" ]; then
  case "$ARRAY_VERDICT" in
    TOKEN)
      printf "%s%sROOT CAUSE: the array rejects the API token.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
      printf "Create a new API token for the read-only user (see Section 2) and restart the agent.\n" ;;
    NO_NATIVE)
      printf "%s%sROOT CAUSE: the FlashArray has no native OpenMetrics endpoint (Purity//FA < 6.7).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
      printf "Switch to the exporter config (see Section 2).\n" ;;
    EXPORTER_DOWN)
      printf "%s%sROOT CAUSE: Pure's exporter service is not running.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
      printf "COMPOSE_PROFILES must match STORAGE_ARRAY_COLLECTOR_CONFIG (see Section 2).\n" ;;
    TLS)
      printf "%s%sROOT CAUSE: the collector does not trust the array's TLS certificate.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
      printf "Set STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true (see Section 2).\n" ;;
    MISCONFIGURED)
      printf "%s%sROOT CAUSE: the array settings in .env are incomplete or invalid.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
      printf "Fix what Section 2 lists and restart the agent.\n" ;;
    *)
      printf "%s%sROOT CAUSE: the collector cannot read the array (address / network).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
      printf "Fix the array side (see Section 2) — usually the endpoint or a firewall.\n" ;;
  esac
elif [ "$ARRAY_NAME_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: STORAGE_ARRAY_NAME is missing — no array can register.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
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
  printf "  2. Look for a %sNEW%s array entry named '%s' — if you changed the array name,\n" "$C_BOLD" "$C_OFF" "${ARRAY_NAME:-?}"
  printf "     the OLD entry stays Disconnected (that's expected; it's stale).\n"
  printf "  3. Volumes, hosts and pods arrive every 2 minutes, directories every 30 minutes,\n"
  printf "     FlashBlade file systems and buckets every 5 minutes.\n"
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
