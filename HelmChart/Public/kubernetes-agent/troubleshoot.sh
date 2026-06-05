#!/usr/bin/env bash
#
# OneUptime Kubernetes Agent — Diagnostic ("doctor")
# ---------------------------------------------------
# Run this from a machine with `kubectl` access to the cluster where the agent
# is installed. It explains the #1 confusing failure mode: the agent shows
# "Disconnected" in OneUptime and no metrics are ingested, yet the pods look
# healthy and the collector logs show no errors.
#
# Why that happens: the agent ships telemetry to `<url>/otlp/v1/*` with the
# ingestion key in the `x-oneuptime-token` header. If that key is missing,
# malformed, or revoked, the OTLP endpoints *deliberately return HTTP 200 and
# silently drop the data* (so a misconfigured collector can't retry-flood the
# server). The collector therefore reports success, logs nothing, and the
# cluster never flips to "connected" because connection status is driven purely
# by telemetry actually arriving (a cron marks a cluster disconnected after
# ~5 min without data).
#
# How it gets a definitive answer: from inside the cluster it calls
# `GET <url>/otlp/v1/validate`, a validation endpoint that returns a REAL status
# (200 valid / 401 invalid) instead of the silent 200. On older servers that
# lack it, it falls back to `POST <url>/fluentd/v1/logs`, which runs the SAME
# auth but is NOT an /otlp path — so a bad token returns `400 Invalid service
# token` rather than the silent 200.
#
# Usage:
#   ./troubleshoot.sh [-n NAMESPACE] [--skip-egress] [--curl-image IMG] [--no-color]
#
# Defaults: NAMESPACE=oneuptime-agent
#
# Requires: kubectl (required), curl on this machine (for the health/self-metric
# port-forward checks — optional), and the cluster being able to pull a small
# curl image for the egress test (skipped gracefully if it can't).

set -uo pipefail

# ----------------------------------------------------------------------------
# Config / args
# ----------------------------------------------------------------------------
NS="oneuptime-agent"
SKIP_EGRESS=0
CURL_IMAGE="curlimages/curl:latest"
USE_COLOR=1

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--namespace) NS="${2:-}"; shift 2 ;;
    --skip-egress)  SKIP_EGRESS=1; shift ;;
    --curl-image)   CURL_IMAGE="${2:-}"; shift 2 ;;
    --no-color)     USE_COLOR=0; shift ;;
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
# Cleanup
# ----------------------------------------------------------------------------
PF_PID=""
cleanup() {
  [ -n "$PF_PID" ] && kill "$PF_PID" >/dev/null 2>&1
  # Best-effort removal of any probe pod we created.
  kubectl delete pod -n "$NS" -l oneuptime-doctor=true --now >/dev/null 2>&1 &
}
trap cleanup EXIT INT TERM

# ----------------------------------------------------------------------------
# Portable helpers
# ----------------------------------------------------------------------------
b64decode() {
  # GNU: -d / --decode ; BSD/macOS: -D ; try them in order.
  if base64 --decode >/dev/null 2>&1 <<<"YQ=="; then base64 --decode
  elif base64 -d >/dev/null 2>&1 <<<"YQ=="; then base64 -d
  else base64 -D
  fi
}

# Globals populated by incluster_req()
RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""; PROBE_LAUNCH_ERR=""

# Make an HTTP request ($1=GET|POST, $2=url, $3=token) from *inside* the cluster
# so it follows the agent's real egress path: NetworkPolicy, DNS, proxy, TLS.
# Prefers an existing `debug` sidecar in the agent pod (exact same network
# namespace), otherwise launches a throwaway curl pod in the namespace.
incluster_req() {
  local method="$1" url="$2" token="$3"
  RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""

  # POST endpoints want a JSON body; GET (the /status validation endpoint) does
  # not. Token is a UUID (validated before we call this), so it's safe to inline.
  local body_args=""
  [ "$method" = "POST" ] && body_args="-H 'Content-Type: application/json' --data '{}'"

  # -w prints OUSTATUS, then we echo curl's exit code.
  local snippet
  snippet=$(cat <<EOF
out=\$(curl -sS -m 15 -w '\nOUSTATUS:%{http_code}' \
  -X $method '$url' \
  -H 'x-oneuptime-token: $token' \
  $body_args 2>&1); cx=\$?
printf '%s\n' "\$out"
printf 'OUEXIT:%s\n' "\$cx"
EOF
)

  local raw=""
  if [ -n "${SIDECAR_POD:-}" ]; then
    raw=$(kubectl exec "$SIDECAR_POD" -n "$NS" -c debug -- sh -c "$snippet" 2>&1)
  else
    local pod="oub-curl-${RANDOM}"
    raw=$(kubectl run "$pod" -n "$NS" --rm -i --restart=Never \
            --image="$CURL_IMAGE" \
            --labels="oneuptime-doctor=true" \
            --command -- sh -c "$snippet" 2>&1)
  fi

  RESP_CODE=$(printf '%s\n' "$raw" | sed -n 's/^OUSTATUS:\([0-9]\{3\}\).*/\1/p' | head -1)
  RESP_EXIT=$(printf '%s\n' "$raw" | sed -n 's/^OUEXIT:\([0-9]\{1,3\}\).*/\1/p' | head -1)
  # Body = everything up to the OUSTATUS marker, minus kubectl run noise.
  RESP_BODY=$(printf '%s\n' "$raw" \
    | sed '/^OUSTATUS:/,$d' \
    | grep -vE '^(If you|pod ".*" deleted|Error from server|Warning:)' \
    | head -c 1000)
  [ -z "$RESP_CODE" ] && RESP_CODE="000"

  # Distinguish "the probe couldn't even start" (admission/image/exec failure)
  # from "egress is broken". Otherwise a PodSecurity-restricted namespace looks
  # like a network outage.
  PROBE_LAUNCH_ERR=""
  if [ "$RESP_CODE" = "000" ]; then
    case "$raw" in
      *"violates PodSecurity"*|*"is forbidden"*|*"forbidden:"*|*"admission webhook"*|\
      *"ImagePullBackOff"*|*"ErrImagePull"*|*"cannot create"*|*"AlreadyExists"*|\
      *"unable to upgrade connection"*|*"container not found"*|*"not found"*|*"timed out waiting"*)
        PROBE_LAUNCH_ERR=$(printf '%s' "$raw" | tr '\n' ' ' | head -c 220) ;;
    esac
  fi
}

# ============================================================================
printf "%s%sOneUptime Kubernetes Agent — Diagnostic%s\n" "$C_BOLD" "$C_BLU" "$C_OFF"
printf "%sNamespace:%s %s\n" "$C_DIM" "$C_OFF" "$NS"

# ----------------------------------------------------------------------------
section "1. Cluster access"
# ----------------------------------------------------------------------------
if ! command -v kubectl >/dev/null 2>&1; then
  fail "kubectl not found on PATH. Install it / point it at the cluster and re-run."
  exit 1
fi
if ! kubectl get --raw='/version' >/dev/null 2>&1 && ! kubectl get ns "$NS" >/dev/null 2>&1; then
  fail "kubectl cannot reach the cluster API. Check your kubeconfig / context."
  detail "Current context: $(kubectl config current-context 2>/dev/null || echo '?')"
  exit 1
fi
pass "kubectl can reach the cluster (context: $(kubectl config current-context 2>/dev/null || echo '?'))"

if ! kubectl get ns "$NS" >/dev/null 2>&1; then
  fail "Namespace '$NS' does not exist."
  detail "If you installed into a different namespace, re-run with: -n <namespace>"
  detail "Find it with:  helm list -A | grep -i agent     (or)   kubectl get ns"
  exit 1
fi
pass "Namespace '$NS' exists"

# ----------------------------------------------------------------------------
section "2. Agent workloads"
# ----------------------------------------------------------------------------
SEL="app.kubernetes.io/part-of=oneuptime"
WORKLOADS=$(kubectl get deploy,daemonset -n "$NS" -l "$SEL" \
  -o jsonpath='{range .items[*]}{.kind}{"\t"}{.metadata.name}{"\n"}{end}' 2>/dev/null)

if [ -z "$WORKLOADS" ]; then
  # Fall back to a looser selector in case labels were overridden.
  WORKLOADS=$(kubectl get deploy,daemonset -n "$NS" \
    -o jsonpath='{range .items[*]}{.kind}{"\t"}{.metadata.name}{"\n"}{end}' 2>/dev/null \
    | grep -iE 'agent|collector|otel' )
fi

if [ -z "$WORKLOADS" ]; then
  fail "No OneUptime agent workloads found in '$NS'."
  add_finding "Agent is not installed in namespace '$NS' (no Deployment/DaemonSet found). Re-check the namespace, or (re)install the Helm chart."
  AGENT_FOUND=0
else
  AGENT_FOUND=1
  pass "Found agent workloads:"
  printf '%s\n' "$WORKLOADS" | while IFS=$'\t' read -r kind name; do
    detail "$kind/$name"
  done
fi

# Locate the metrics-collector Deployment — it emits cluster metrics + the
# k8s.cluster.name that drives the connected/disconnected status.
METRICS_DEPLOY=$(kubectl get deploy -n "$NS" -l "$SEL,component=metrics-collector" \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
[ -z "$METRICS_DEPLOY" ] && METRICS_DEPLOY=$(kubectl get deploy -n "$NS" \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null \
  | grep -iE 'agent|collector|otel' | grep -viE 'state-metrics|ebpf|profil|log' | head -1)

# ----------------------------------------------------------------------------
section "3. Pod health"
# ----------------------------------------------------------------------------
METRICS_READY=0
if [ -n "$METRICS_DEPLOY" ]; then
  READY=$(kubectl get deploy "$METRICS_DEPLOY" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null)
  WANT=$(kubectl get deploy "$METRICS_DEPLOY" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null)
  READY=${READY:-0}; WANT=${WANT:-1}
  if [ "$READY" -ge 1 ] && [ "$READY" = "$WANT" ]; then
    pass "metrics-collector Deployment '$METRICS_DEPLOY' ready ($READY/$WANT)"
    METRICS_READY=1
  else
    fail "metrics-collector Deployment '$METRICS_DEPLOY' NOT ready ($READY/$WANT)"
    add_finding "The metrics-collector pod is not Running/Ready. The cluster cannot connect or send metrics until it is. See the pod state below."
  fi
else
  warn "Could not identify the metrics-collector Deployment by label; checking all agent pods."
fi

# Per-pod state for every agent pod; surface crashloops / config errors / pending.
PODS=$(kubectl get pods -n "$NS" -l "$SEL" \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null)
[ -z "$PODS" ] && PODS=$(kubectl get pods -n "$NS" -o name 2>/dev/null | sed 's#pod/##' | grep -iE 'agent|collector|otel')

if [ -n "$PODS" ]; then
  while read -r pod; do
    [ -z "$pod" ] && continue
    phase=$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null)
    # Aggregate container readiness + the most informative waiting/terminated reason.
    reason=$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{range .status.containerStatuses[*]}{.state.waiting.reason}{" "}{.lastState.terminated.reason}{" "}{end}' 2>/dev/null | tr -s ' ')
    restarts=$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{range .status.containerStatuses[*]}{.restartCount}{"+"}{end}' 2>/dev/null | sed 's/+$//')
    notready=$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{range .status.containerStatuses[?(@.ready==false)]}{.name}{" "}{end}' 2>/dev/null)
    if [ "$phase" = "Running" ] && [ -z "$notready" ]; then
      pass "pod $pod: Running (restarts: ${restarts:-0})"
    else
      fail "pod $pod: phase=$phase notReady=[${notready:-}] reason=[$(echo "$reason" | xargs)] restarts=${restarts:-0}"
      # Pull the last few events for this pod — usually names the real cause.
      ev=$(kubectl get events -n "$NS" --field-selector "involvedObject.name=$pod" \
            -o jsonpath='{range .items[-3:]}{.reason}: {.message}{"\n"}{end}' 2>/dev/null | tail -3)
      [ -n "$ev" ] && printf '%s' "$ev" | while read -r l; do detail "$l"; done
      case "$reason" in
        *CreateContainerConfigError*|*CreateContainerError*)
          add_finding "Pod $pod has a config error (often a missing/renamed Secret or key). Verify the api-key Secret exists — see the Token section." ;;
        *ImagePull*|*ErrImage*)
          add_finding "Pod $pod cannot pull its image (ImagePullBackOff). Check image registry access / airgap mirror." ;;
        *CrashLoop*)
          add_finding "Pod $pod is CrashLooping. Inspect: kubectl logs -n $NS $pod -c otel-collector --previous" ;;
        *)
          [ "$phase" = "Pending" ] && add_finding "Pod $pod is Pending (no schedulable node / resources / tolerations). See events above." ;;
      esac
    fi
  done <<< "$PODS"
else
  [ "$AGENT_FOUND" = 1 ] && warn "No pods found for the agent workloads."
fi

# Is a debug sidecar already present? (lets us probe egress from the exact netns)
SIDECAR_POD=""
if [ -n "$PODS" ]; then
  while read -r pod; do
    [ -z "$pod" ] && continue
    if kubectl get pod "$pod" -n "$NS" -o jsonpath='{.spec.containers[*].name}' 2>/dev/null | tr ' ' '\n' | grep -qx 'debug'; then
      SIDECAR_POD="$pod"; break
    fi
  done <<< "$PODS"
fi
[ -n "$SIDECAR_POD" ] && info "debug sidecar detected in $SIDECAR_POD — egress test will use the collector's exact network path."

# Pick one metrics-collector pod for port-forward checks.
PRIMARY_POD=$(kubectl get pods -n "$NS" -l "$SEL,component=metrics-collector" \
  -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' 2>/dev/null | awk '{print $1}')
[ -z "$PRIMARY_POD" ] && PRIMARY_POD=$(printf '%s\n' "$PODS" | head -1)

# ----------------------------------------------------------------------------
section "4. Ingestion token (shape)"
# ----------------------------------------------------------------------------
TOKEN=""; TOKEN_SHAPE_OK=0; TOKEN_HAS_WS=0
UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

# Read the Secret name + key straight from the live Deployment env, so we don't
# guess at the release name.
SECRET_NAME=""; SECRET_KEY="api-key"
if [ -n "$METRICS_DEPLOY" ]; then
  SECRET_NAME=$(kubectl get deploy "$METRICS_DEPLOY" -n "$NS" \
    -o jsonpath='{.spec.template.spec.containers[?(@.name=="otel-collector")].env[?(@.name=="ONEUPTIME_API_KEY")].valueFrom.secretKeyRef.name}' 2>/dev/null)
  K=$(kubectl get deploy "$METRICS_DEPLOY" -n "$NS" \
    -o jsonpath='{.spec.template.spec.containers[?(@.name=="otel-collector")].env[?(@.name=="ONEUPTIME_API_KEY")].valueFrom.secretKeyRef.key}' 2>/dev/null)
  [ -n "$K" ] && SECRET_KEY="$K"
fi

if [ -z "$SECRET_NAME" ]; then
  warn "Couldn't resolve the api-key Secret from the Deployment; trying common names."
  for cand in "$NS" kubernetes-agent oneuptime-kubernetes-agent; do
    if kubectl get secret "$cand" -n "$NS" >/dev/null 2>&1; then SECRET_NAME="$cand"; break; fi
  done
fi

if [ -n "$SECRET_NAME" ] && kubectl get secret "$SECRET_NAME" -n "$NS" >/dev/null 2>&1; then
  RAW=$(kubectl get secret "$SECRET_NAME" -n "$NS" -o jsonpath="{.data.${SECRET_KEY//./\\.}}" 2>/dev/null)
  if [ -z "$RAW" ]; then
    fail "Secret '$SECRET_NAME' has no '$SECRET_KEY' value (empty)."
    add_finding "The ingestion key Secret is empty. Reinstall/upgrade with --set oneuptime.apiKey=<key>."
  else
    # Sentinel 'X' preserves any trailing newline (which $() would otherwise
    # strip) so we can catch the classic 'echo key | base64' corruption.
    TOKEN=$(printf '%s' "$RAW" | b64decode 2>/dev/null; printf 'X')
    TOKEN="${TOKEN%X}"
    TRIMMED=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
    MASK="${TRIMMED:0:8}…${TRIMMED: -4}"
    if [ "$TOKEN" != "$TRIMMED" ]; then
      fail "Token in Secret '$SECRET_NAME' contains whitespace/newline — the collector sends it literally, so OneUptime can't match it."
      add_finding "The api-key has stray whitespace/newline (classic 'echo key | base64' bug — echo adds a trailing \\n; use 'printf %s' or --set oneuptime.apiKey=). Recreate it cleanly and re-run."
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
      add_finding "The api-key is not a UUID, so OneUptime can never resolve it (telemetry is silently dropped). Set a real Telemetry Ingestion Key."
    fi
  fi
else
  fail "Could not find the api-key Secret in '$NS'."
  add_finding "The ingestion key Secret is missing — pods likely fail with CreateContainerConfigError. Reinstall the chart."
fi

# ----------------------------------------------------------------------------
section "5. Collector config (URL & cluster name)"
# ----------------------------------------------------------------------------
BASE_URL=""; CLUSTER_NAME=""
CM_NAME=$(kubectl get deploy "$METRICS_DEPLOY" -n "$NS" \
  -o jsonpath='{.spec.template.spec.volumes[?(@.name=="config")].configMap.name}' 2>/dev/null)
if [ -n "$CM_NAME" ]; then
  CFG=$(kubectl get cm "$CM_NAME" -n "$NS" -o jsonpath='{.data.otel-collector-config\.yaml}' 2>/dev/null)
  # The otlphttp exporter endpoint is the only one shaped like https://.../otlp
  EP=$(printf '%s\n' "$CFG" | grep -oE 'endpoint:[[:space:]]*"https?://[^"]+/otlp"' | head -1 \
        | sed -E 's/endpoint:[[:space:]]*"//; s/"$//')
  if [ -n "$EP" ]; then
    BASE_URL="${EP%/otlp}"
    pass "OneUptime URL (from exporter config): $BASE_URL"
  else
    warn "Couldn't parse the exporter endpoint from ConfigMap '$CM_NAME'."
  fi
fi
# Cluster name = k8s.cluster.name attribute = CLUSTER_NAME env on the collector.
CLUSTER_NAME=$(kubectl get deploy "$METRICS_DEPLOY" -n "$NS" \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="otel-collector")].env[?(@.name=="CLUSTER_NAME")].value}' 2>/dev/null)
if [ -n "$CLUSTER_NAME" ]; then
  info "Reporting as cluster name: '${C_BOLD}${CLUSTER_NAME}${C_OFF}'  (this is the k8s.cluster.name OneUptime keys on)"
  detail "If this differs from your previous install, OneUptime shows a NEW cluster entry; the old one stays 'Disconnected'."
else
  warn "Couldn't read CLUSTER_NAME — if unset, telemetry may not attribute to a cluster."
fi

# ----------------------------------------------------------------------------
section "6. Collector health & self-metrics"
# ----------------------------------------------------------------------------
SENT="?"; FAILED="?"; QUEUED="?"
if command -v curl >/dev/null 2>&1 && [ -n "$PRIMARY_POD" ]; then
  kubectl port-forward -n "$NS" "pod/$PRIMARY_POD" 11313:13133 18888:8888 >/dev/null 2>&1 &
  PF_PID=$!
  sleep 2
  if kill -0 "$PF_PID" 2>/dev/null; then
    if curl -fsS -m 5 "http://127.0.0.1:11313/" >/dev/null 2>&1; then
      pass "Collector health endpoint (:13133) is up."
    else
      warn "Collector health endpoint (:13133) not responding (pod may be starting)."
    fi
    METRICS_DUMP=$(curl -fsS -m 5 "http://127.0.0.1:18888/metrics" 2>/dev/null)
    if [ -n "$METRICS_DUMP" ]; then
      SENT=$(printf '%s\n' "$METRICS_DUMP" | awk '/^otelcol_exporter_sent_(metric_points|log_records|spans)/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
      FAILED=$(printf '%s\n' "$METRICS_DUMP" | awk '/^otelcol_exporter_send_failed_/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
      QUEUED=$(printf '%s\n' "$METRICS_DUMP" | awk '/^otelcol_exporter_queue_size/{s+=$2} END{if(s=="")print "0"; else printf "%d", s}')
      info "Collector self-metrics: sent=$SENT  send_failed=$FAILED  queue_size=$QUEUED"
      if [ "$FAILED" != "?" ] && [ "${FAILED:-0}" -gt 0 ] 2>/dev/null; then
        fail "Collector reports send_failed > 0 → exports are erroring (network/URL/TLS)."
        add_finding "Collector send_failed=$FAILED. The collector cannot deliver to $BASE_URL — investigate egress/DNS/TLS/firewall (see next section)."
      elif [ "${SENT:-0}" -gt 0 ] 2>/dev/null; then
        info "Bytes are leaving the collector and the server is returning 2xx."
        detail "NOTE: a bad token ALSO returns 2xx (silent drop). The token probe below settles it."
      fi
    else
      warn "Couldn't scrape collector self-metrics (:8888). Skipping (version/port may differ)."
    fi
    kill "$PF_PID" >/dev/null 2>&1; PF_PID=""
  else
    warn "port-forward failed; skipping health/self-metric checks."
  fi
else
  warn "Skipping health/self-metrics (no local curl, or no running pod)."
fi

# ----------------------------------------------------------------------------
section "7. Egress + DEFINITIVE token check"
# ----------------------------------------------------------------------------
# This is the part you can't see from the agent side. From INSIDE the cluster we
# ask OneUptime's ingestion-key validation endpoint for a real verdict:
#   GET /otlp/v1/validate  → 200 {valid:true} | 401 {valid:false}
# Older servers without that endpoint (404) fall back to:
#   POST /otlp/v1/metrics → reachability only (returns 200 even on a bad token)
#   POST /fluentd/v1/logs → bad token returns 400 "Invalid service token"
TOKEN_VERDICT="UNKNOWN"   # UNKNOWN | VALID | INVALID | INCONCLUSIVE
EGRESS="UNKNOWN"          # UNKNOWN | OK | FAIL | SKIPPED

# A hard connectivity failure (no HTTP response at all).
is_conn_fail() { [ "$RESP_CODE" = "000" ] || [ "${RESP_EXIT:-1}" != "0" ]; }

# Couldn't even launch the probe (admission/image/exec) — NOT an egress verdict.
note_probe_launch_err() {
  warn "Couldn't start the in-cluster probe (not an egress verdict): $PROBE_LAUNCH_ERR"
  detail "Likely PodSecurity/admission, image-pull, or exec restrictions in '$NS'."
  detail "Best fix: install with --set debug.enabled=true and re-run — the probe then execs the existing sidecar instead of creating a pod."
  EGRESS="SKIPPED"
  add_finding "Egress/token probe couldn't run in this namespace (restricted). Enable the debug sidecar (debug.enabled=true) and re-run, or run the manual curl printed in the verdict."
}

# Emit the right finding for a connectivity failure based on curl's message.
egress_fail_finding() {
  fail "Cannot reach $1 from inside the cluster (curl exit ${RESP_EXIT:-?})."
  local e; e=$(printf '%s' "$RESP_BODY" | tr '\n' ' ' | head -c 200)
  [ -n "$e" ] && detail "curl: $e"
  EGRESS="FAIL"
  case "$RESP_BODY" in
    *"Could not resolve host"*|*"Name or service not known"*)
      add_finding "DNS resolution of the OneUptime host fails from the cluster. Check the URL and in-cluster DNS/egress." ;;
    *"certificate"*|*"SSL"*|*"TLS"*|*"self-signed"*|*"self signed"*)
      add_finding "TLS verification to $BASE_URL fails (cert/CA). The collector image's trust store must accept the cert." ;;
    *"refused"*|*"timed out"*|*"Connection timed out"*|*"Failed to connect"*)
      add_finding "Connection to $BASE_URL is refused/times out — firewall/NetworkPolicy/proxy is blocking cluster egress." ;;
    *)
      add_finding "Egress to $BASE_URL failed from the cluster. Verify oneuptime.url and that pods can reach it." ;;
  esac
}

token_invalid_finding() {
  add_finding "DEFINITIVE: the ingestion key in the Secret is unknown/revoked server-side. On /otlp this is hidden behind a silent 200, which is why the agent looks healthy while nothing ingests. FIX: create or copy a live Telemetry Ingestion Key in OneUptime, then: helm upgrade <release> oneuptime/kubernetes-agent -n $NS --reuse-values --set oneuptime.apiKey=<key>"
}

# Fallback token oracle for servers without /otlp/v1/validate.
fluentd_token_probe() {
  incluster_req POST "$BASE_URL/fluentd/v1/logs" "$TOKEN"
  case "$RESP_BODY" in
    *"Invalid service token"*)
      fail "OneUptime REJECTED this token: \"Invalid service token\" (HTTP $RESP_CODE)."
      TOKEN_VERDICT="INVALID"; token_invalid_finding ;;
    *"Missing header"*)
      fail "Server says the token header is missing (HTTP $RESP_CODE) — a proxy may be stripping it."
      TOKEN_VERDICT="INVALID"
      add_finding "The x-oneuptime-token header isn't arriving at OneUptime — check any egress proxy/ingress that might strip headers." ;;
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
  warn "No OneUptime URL parsed; cannot run the egress/token probe."; EGRESS="SKIPPED"
elif ! [[ "$TOKEN" =~ ^[A-Za-z0-9-]+$ ]]; then
  warn "Token unusable/missing; cannot run the authenticated probe (fix Section 4 first)."; EGRESS="SKIPPED"
else
  if [ -z "$SIDECAR_POD" ]; then
    info "No debug sidecar present — launching a throwaway curl pod ($CURL_IMAGE) in '$NS'."
    detail "For a test through the collector's EXACT egress path, install with --set debug.enabled=true and re-run."
  fi

  incluster_req GET "$BASE_URL/otlp/v1/validate" "$TOKEN"
  if [ -n "$PROBE_LAUNCH_ERR" ]; then
    note_probe_launch_err
  elif [ "$TOKEN_HAS_WS" = 1 ]; then
    # The agent sends the UNtrimmed value; a verdict on the trimmed UUID would
    # mislead. Treat any HTTP response as "reachable" and defer the verdict.
    if is_conn_fail; then
      egress_fail_finding "$BASE_URL/otlp/v1/validate"
    else
      pass "Reachable: $BASE_URL responded (HTTP $RESP_CODE)."; EGRESS="OK"
      warn "Skipping the live token verdict: the Secret has whitespace, so the agent sends a value that differs from the trimmed UUID we'd probe with. Fix the Secret (Section 4) and re-run."
    fi
  elif [ "$RESP_CODE" = "200" ]; then
    pass "Reached OneUptime and the ingestion token is VALID (/otlp/v1/validate → 200)."
    EGRESS="OK"; TOKEN_VERDICT="VALID"
  elif [ "$RESP_CODE" = "401" ] || [ "$RESP_CODE" = "403" ]; then
    fail "Reached OneUptime, but it REJECTED the token (/otlp/v1/validate → $RESP_CODE)."
    EGRESS="OK"; TOKEN_VERDICT="INVALID"; token_invalid_finding
  elif [ "$RESP_CODE" = "404" ]; then
    info "Validation endpoint not on this server version (404) — falling back to legacy probes."
    incluster_req POST "$BASE_URL/otlp/v1/metrics" "$TOKEN"
    if is_conn_fail; then
      egress_fail_finding "$BASE_URL/otlp/v1/metrics"
    else
      pass "Reachable: $BASE_URL/otlp/v1/metrics returned HTTP $RESP_CODE."; EGRESS="OK"
      if [ "$TOKEN_HAS_WS" = 1 ]; then
        warn "Skipping the live token verdict (Secret has whitespace; fix Section 4 and re-run)."
      else
        fluentd_token_probe
      fi
    fi
  elif is_conn_fail; then
    egress_fail_finding "$BASE_URL/otlp/v1/validate"
  else
    warn "Unexpected HTTP $RESP_CODE from /otlp/v1/validate; trying the legacy token probe."
    EGRESS="OK"; fluentd_token_probe
  fi
fi

# ----------------------------------------------------------------------------
section "8. Recent collector errors"
# ----------------------------------------------------------------------------
if [ -n "$PRIMARY_POD" ]; then
  LOGERR=$(kubectl logs -n "$NS" "$PRIMARY_POD" -c otel-collector --tail=200 2>/dev/null \
    | grep -iE 'error|failed|denied|refused|x509|tls|deadline|429|throttl' | tail -8)
  if [ -n "$LOGERR" ]; then
    warn "Recent error-ish log lines from the collector:"
    printf '%s\n' "$LOGERR" | while read -r l; do detail "$(printf '%s' "$l" | head -c 160)"; done
  else
    pass "No export errors in recent collector logs."
    detail "(Expected when a token is silently dropped — absence of errors does NOT mean data is landing.)"
  fi
fi

# ============================================================================
section "VERDICT"
# ============================================================================
if [ "$AGENT_FOUND" != 1 ]; then
  printf "%s%sThe agent isn't installed in namespace '%s'.%s\n" "$C_BOLD" "$C_RED" "$NS" "$C_OFF"
elif [ "$TOKEN_VERDICT" = "INVALID" ]; then
  printf "%s%sROOT CAUSE: the ingestion token is rejected by OneUptime.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "This is the classic reinstall trap: /otlp returns 200 and drops the data, so the\n"
  printf "agent looks healthy while the cluster stays Disconnected with no metrics.\n"
elif [ "$METRICS_READY" != 1 ] && [ -n "$METRICS_DEPLOY" ]; then
  printf "%s%sROOT CAUSE: the metrics-collector pod isn't Running/Ready.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "Fix the pod (see Section 3) — until it runs, the cluster can't connect or send metrics.\n"
elif [ "$EGRESS" = "FAIL" ]; then
  printf "%s%sROOT CAUSE: the cluster can't deliver telemetry to OneUptime (network/URL/TLS).%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$TOKEN_HAS_WS" = 1 ]; then
  printf "%s%sROOT CAUSE: the api-key Secret has stray whitespace/newline.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "The collector sends the key with that whitespace, so OneUptime can't match it and\n"
  printf "drops the data behind /otlp's silent 200. Recreate the Secret cleanly and re-run.\n"
elif [ "$TOKEN_SHAPE_OK" != 1 ]; then
  printf "%s%sROOT CAUSE: the api-key Secret is empty/malformed.%s\n" "$C_BOLD" "$C_RED" "$C_OFF"
elif [ "$TOKEN_VERDICT" = "VALID" ] && [ "$METRICS_READY" = 1 ]; then
  printf "%s%sThe agent looks healthy and OneUptime accepts the token.%s\n" "$C_BOLD" "$C_GRN" "$C_OFF"
  printf "If the dashboard still says Disconnected:\n"
  printf "  1. Give it ~2-5 min — status flips to Connected on the next telemetry batch,\n"
  printf "     and the disconnect cron runs on a 5-minute cycle.\n"
  printf "  2. Look for a %sNEW%s cluster entry named '%s' — if you changed clusterName on\n" "$C_BOLD" "$C_OFF" "${CLUSTER_NAME:-?}"
  printf "     reinstall, the OLD entry stays Disconnected (that's expected; it's stale).\n"
else
  printf "%sInconclusive from inside the cluster.%s Next steps:\n" "$C_BOLD" "$C_OFF"
  printf "  • On the OneUptime server, search ingest logs for: \"Invalid service token\"\n"
  printf "    (it prints the rejected token, so you can match it to the Secret above).\n"
  printf "  • Confirm the key under Project Settings → Telemetry Ingestion Keys still exists.\n"
  if [ -n "$BASE_URL" ]; then
    printf "  • Run the definitive token check by hand (200 = valid, 401 = bad/revoked key):\n"
    if [ -n "$SIDECAR_POD" ]; then
      printf "      %skubectl exec -n %s %s -c debug -- \\\\\n        curl -i -H \"x-oneuptime-token: \$ONEUPTIME_API_KEY\" %s/otlp/v1/validate%s\n" "$C_DIM" "$NS" "$SIDECAR_POD" "$BASE_URL" "$C_OFF"
    else
      printf "      %s# (install with --set debug.enabled=true to get a shell in-cluster, then:)\n      kubectl exec -n %s <agent-pod> -c debug -- \\\\\n        curl -i -H \"x-oneuptime-token: <key>\" %s/otlp/v1/validate%s\n" "$C_DIM" "$NS" "$BASE_URL" "$C_OFF"
    fi
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
