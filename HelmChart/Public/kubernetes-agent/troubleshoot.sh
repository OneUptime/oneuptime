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
# ~15 min without data).
#
# How it gets a definitive answer: from inside the cluster it calls
# `GET <url>/otlp/v1/validate`, a validation endpoint that returns a REAL status
# (200 valid / 401 invalid) instead of the silent 200. On older servers that
# lack it, it falls back to `POST <url>/fluentd/v1/logs`, which runs the SAME
# auth but is NOT an /otlp path — so a bad token returns `400 Invalid service
# token` rather than the silent 200.
#
# When the chart is installed with `cost.enabled=true` it also diagnoses the
# cost pipeline (Section 9), which fails the same silent way: the cost-agent /
# OpenCost / Prometheus pods, the poller's own /healthz (it reports its last
# poll and ship error), and whether the cost engine's Allocation API answers.
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

# Format an epoch as UTC RFC3339 to the SECOND. GNU date takes -d @EPOCH,
# BSD/macOS date takes -r EPOCH; try them in order.
utc_rfc3339() {
  date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null
}

# Globals populated by incluster_req()
RESP_CODE=""; RESP_EXIT=""; RESP_BODY=""; PROBE_LAUNCH_ERR=""
# How much of a response body incluster_req keeps. 1 kB covers every API error
# message we match on; the cost section raises it for one probe whose body is a
# list of every scrape target in the cluster.
RESP_MAX_BYTES=1000

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
    | head -c "$RESP_MAX_BYTES")
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

# ----------------------------------------------------------------------------
section "9. Cost pipeline"
# ----------------------------------------------------------------------------
# Everything below is gated on the cost-agent Deployment existing — i.e. on the
# chart having been installed with `--set cost.enabled=true`.
#
# Cost fails the same silent way the ingestion token does: nothing crashes, the
# workloads above stay green, and the Kubernetes Cost dashboard just never grows
# a row. The two failures a real install hit:
#   * the cost-agent image tag didn't exist in the registry, so one pod out of a
#     dozen healthy ones sat in ImagePullBackOff, and
#   * the poller sent a millisecond-precision `window` bound, which both engines
#     reject with `400 ... illegal window`. It retries the next window forever
#     and reports that ONLY on its own /healthz — which still answers 200,
#     because the shipper, never handed a row, has nothing to complain about.
COST_ENABLED=0        # 1 once a cost-agent Deployment is found
COST_OK=1             # flips to 0 on the first cost-specific failure
COST_BUNDLED=0        # 1 = chart's own OpenCost, 0 = external cost.engine.url
COST_PROBE_OK=1       # 0 once an in-cluster probe couldn't even start
COST_MS_WINDOW_BUG=0  # 1 when the poller's own error is the millisecond window

# Ready-state of one cost Deployment, named by its `component` label. Reports
# the image ref alongside, and names ImagePullBackOff explicitly instead of
# leaving it as a generic "not ready" — an unpullable tag is the known way this
# feature dies.
cost_deploy_check() {
  local comp="$1" label="$2"
  local dep ready want img reasons
  dep=$(kubectl get deploy -n "$NS" -l "$SEL,component=$comp" \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  if [ -z "$dep" ]; then
    fail "$label Deployment (component=$comp) not found in '$NS'."
    add_finding "The $label Deployment is missing while cost is enabled — the chart rendered a partial cost stack. Re-run: helm upgrade <release> oneuptime/kubernetes-agent -n $NS --reuse-values --set cost.enabled=true"
    COST_OK=0
    return 1
  fi
  ready=$(kubectl get deploy "$dep" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null)
  want=$(kubectl get deploy "$dep" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null)
  img=$(kubectl get deploy "$dep" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null)
  ready=${ready:-0}; want=${want:-1}
  if [ "$ready" -ge 1 ] && [ "$ready" = "$want" ]; then
    pass "$label Deployment '$dep' ready ($ready/$want)"
    detail "image: ${img:-?}"
    return 0
  fi

  COST_OK=0
  # The waiting reason decides which failure this is — ImagePullBackOff gets
  # named on the failing line itself rather than left as a generic "not ready",
  # because among a dozen healthy pods it is the one nobody goes looking for.
  reasons=$(kubectl get pods -n "$NS" -l "$SEL,component=$comp" \
    -o jsonpath='{range .items[*]}{.status.containerStatuses[*].state.waiting.reason}{" "}{end}' 2>/dev/null | tr -s ' ')
  reasons=$(printf '%s' "$reasons" | xargs)
  case "$reasons" in
    *ImagePull*|*ErrImage*)
      fail "$label Deployment '$dep' NOT ready ($ready/$want) — ImagePullBackOff: cannot pull '${img:-?}'."
      add_finding "$label is in ImagePullBackOff — the tag '${img##*:}' does not exist in the registry (or it isn't reachable from this cluster). This is the known cost failure: the chart used to default cost.agent.image.tag to the chart appVersion, a tag the release pipeline never publishes. Upgrade the chart, or pin a tag that exists: helm upgrade <release> oneuptime/kubernetes-agent -n $NS --reuse-values --set cost.agent.image.tag=release" ;;
    *CreateContainerConfigError*|*CreateContainerError*)
      fail "$label Deployment '$dep' NOT ready ($ready/$want) — container config error."
      add_finding "$label has a config error (usually a missing/renamed api-key Secret key). See Section 4." ;;
    *CrashLoop*)
      fail "$label Deployment '$dep' NOT ready ($ready/$want) — CrashLoopBackOff."
      add_finding "$label is CrashLooping. Inspect: kubectl logs -n $NS deploy/$dep --previous" ;;
    *)
      fail "$label Deployment '$dep' NOT ready ($ready/$want)${reasons:+ — waiting: $reasons}"
      add_finding "$label Deployment '$dep' is not Ready ($ready/$want) — no cost data can flow until it is. Pod state and events are in Section 3." ;;
  esac
  detail "image: ${img:-?}"
  return 1
}

# One in-cluster HTTP probe for this section, reusing Section 7's helper (the
# existing debug sidecar, else a throwaway curl pod). Returns non-zero when the
# probe couldn't run, and latches that so we don't try to start a pod per
# endpoint in a namespace that won't let us start one at all.
# The ingestion token is deliberately NOT sent: none of these endpoints
# authenticate, and cost.engine.url can point at a third-party engine.
cost_probe() {
  [ "$COST_PROBE_OK" = 1 ] || return 1
  incluster_req "$1" "$2" ""
  if [ -n "$PROBE_LAUNCH_ERR" ]; then
    COST_PROBE_OK=0
    warn "Couldn't start the in-cluster probe — skipping the cost HTTP checks."
    detail "$PROBE_LAUNCH_ERR"
    detail "Install with --set debug.enabled=true and re-run; the probe then execs the existing sidecar instead of creating a pod."
    return 1
  fi
  return 0
}

# Scrape-target health for one Prometheus job, out of the last /api/v1/targets
# body. Each activeTarget object begins with "discoveredLabels", so splitting
# there puts one target per line and lets a health be attributed to its own job
# (the response is a flat list across every job).
PROM_UP=0; PROM_TOTAL=0; PROM_ERR=""
prom_job_health() {
  local job="$1" recs
  PROM_UP=0; PROM_TOTAL=0; PROM_ERR=""
  recs=$(printf '%s' "$RESP_BODY" \
    | awk '{gsub(/\{"discoveredLabels"/, "\n{\"discoveredLabels\""); print}' \
    | grep -F "\"scrapePool\":\"$job\"")
  [ -z "$recs" ] && return 0
  PROM_TOTAL=$(printf '%s\n' "$recs" | grep -c .)
  PROM_UP=$(printf '%s\n' "$recs" | grep -c '"health":"up"')
  # First NON-empty lastError among the unhealthy targets ([^"][^"]* rather
  # than \+, which BSD sed doesn't take).
  PROM_ERR=$(printf '%s\n' "$recs" | grep -v '"health":"up"' \
    | sed -n 's/.*"lastError":"\([^"][^"]*\)".*/\1/p' | head -1)
}

COST_AGENT_DEPLOY=$(kubectl get deploy -n "$NS" -l "$SEL,component=cost-agent" \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

if [ -z "$COST_AGENT_DEPLOY" ]; then
  if kubectl get deploy -n "$NS" -l "$SEL,component=opencost" -o name 2>/dev/null | grep -q .; then
    warn "A cost engine is deployed, but there is no cost-agent Deployment (cost.agent.enabled=false)."
    add_finding "The bundled cost engine runs but nothing polls it — cost.agent.enabled is false, so allocations are computed in-cluster and never shipped to OneUptime. Re-run with --set cost.agent.enabled=true."
  else
    info "Cost collection is not enabled here (no component=cost-agent Deployment) — skipping."
    detail "Enable it with: helm upgrade <release> oneuptime/kubernetes-agent -n $NS --reuse-values --set cost.enabled=true"
  fi
else
  COST_ENABLED=1

  # Read the engine URL and any pinned allocation path straight off the live
  # Deployment — same reason as the Secret in Section 4: no guessing at values.
  COST_ENGINE_URL=$(kubectl get deploy "$COST_AGENT_DEPLOY" -n "$NS" \
    -o jsonpath='{.spec.template.spec.containers[?(@.name=="cost-agent")].env[?(@.name=="COST_ENGINE_URL")].value}' 2>/dev/null)
  COST_ALLOC_PATH_CFG=$(kubectl get deploy "$COST_AGENT_DEPLOY" -n "$NS" \
    -o jsonpath='{.spec.template.spec.containers[?(@.name=="cost-agent")].env[?(@.name=="COST_ALLOCATION_PATH")].value}' 2>/dev/null)
  COST_ENGINE_URL=${COST_ENGINE_URL%/}   # a trailing slash would double up on the path

  cost_deploy_check cost-agent "cost-agent (allocation poller)"

  # The chart deploys OpenCost + its Prometheus only when cost.engine.url is
  # empty. With an external engine those pods SHOULD be absent — looking for
  # them there would report a healthy install as broken.
  if kubectl get deploy -n "$NS" -l "$SEL,component=opencost" -o name 2>/dev/null | grep -q .; then
    COST_BUNDLED=1
    cost_deploy_check opencost "opencost (bundled cost engine)"
    cost_deploy_check cost-prometheus "cost-prometheus (engine's TSDB)"
  else
    info "External cost engine configured: ${COST_ENGINE_URL:-?}"
    detail "The bundled OpenCost/Prometheus are intentionally not installed in this mode."
    # An in-cluster DNS name only resolves while its Service exists, so that
    # Service is what we check here.
    EHOST=${COST_ENGINE_URL#*://}; EHOST=${EHOST%%/*}; EHOST=${EHOST%%:*}
    ESHORT=${EHOST%.svc.cluster.local}; ESHORT=${ESHORT%.svc}
    case "$ESHORT" in
      "")
        warn "cost-agent has no COST_ENGINE_URL — the poller has nothing to query."
        add_finding "COST_ENGINE_URL is empty on the cost-agent Deployment. Set cost.engine.url (or clear it to use the bundled engine) and upgrade."
        COST_OK=0 ;;
      *[!0-9.]*)
        ESVC=${ESHORT%%.*}
        EREST=${ESHORT#*.}
        ENS=${EREST%%.*}
        [ "$ESVC" = "$ESHORT" ] && ENS="$NS"
        if kubectl get svc "$ESVC" -n "$ENS" >/dev/null 2>&1; then
          pass "Engine Service '$ENS/$ESVC' exists — '$EHOST' resolves inside the cluster."
        elif [ "$EHOST" != "$ESHORT" ] || [ "$ESVC" = "$ESHORT" ]; then
          fail "No Service '$ENS/$ESVC' in this cluster — '$EHOST' cannot resolve."
          add_finding "cost.engine.url points at the cluster-local name '$EHOST', but there is no Service '$ENS/$ESVC'. The poller's every request fails DNS. Correct cost.engine.url, or install the engine in that namespace."
          COST_OK=0
        else
          info "Engine host '$EHOST' is not a Service in this cluster — treating it as an external address; the allocation probe below is the real test."
        fi ;;
      *)
        info "Engine host '$EHOST' is an IP address — skipping the Service check." ;;
    esac
  fi

  # --------------------------------------------------------------------------
  # In-cluster HTTP probes
  # --------------------------------------------------------------------------
  if [ "$SKIP_EGRESS" = 1 ]; then
    warn "Cost HTTP checks skipped (--skip-egress)."
    COST_PROBE_OK=0
  fi

  # 9a. The poller's own /healthz. This is the only place the poll loop's error
  # surfaces: it does not crash, does not fail its probes, and logs at info.
  COST_POD_IP=$(kubectl get pods -n "$NS" -l "$SEL,component=cost-agent" \
    -o jsonpath='{.items[?(@.status.phase=="Running")].status.podIP}' 2>/dev/null | awk '{print $1}')
  if [ "$COST_PROBE_OK" = 1 ] && [ -z "$COST_POD_IP" ]; then
    warn "No Running cost-agent pod — skipping the /healthz check."
  elif cost_probe GET "http://$COST_POD_IP:13134/healthz"; then
    if [ "$RESP_CODE" != "200" ] && [ "$RESP_CODE" != "503" ]; then
      fail "cost-agent /healthz (:13134) did not answer (HTTP $RESP_CODE, curl exit ${RESP_EXIT:-?})."
      detail "$(printf '%s' "$RESP_BODY" | tr '\n' ' ' | head -c 200)"
      COST_OK=0
      add_finding "The cost-agent's health endpoint on :13134 is unreachable from inside the cluster, so the pod is failing its own readiness probe. Check: kubectl logs -n $NS deploy/$COST_AGENT_DEPLOY"
    else
      COST_STATUS=$(printf '%s' "$RESP_BODY" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -1)
      COST_POLL_ERR=$(printf '%s' "$RESP_BODY" | sed -n 's/.*"lastPollError":"\([^"]*\)".*/\1/p' | head -1)
      COST_SHIP_ERR=$(printf '%s' "$RESP_BODY" | sed -n 's/.*"lastShipError":"\([^"]*\)".*/\1/p' | head -1)
      info "cost-agent /healthz → HTTP $RESP_CODE (status=${COST_STATUS:-?})"
      [ "$RESP_CODE" = "200" ] && \
        detail "A 200 here does NOT mean cost data is flowing: the status code tracks the SHIPPER, which reports healthy until it has actually failed — and a poller that never gets a window past the engine hands it nothing to fail on. The two error fields below are the real signal."
      if [ -n "$COST_POLL_ERR" ]; then
        fail "Poller's last error: $COST_POLL_ERR"
        COST_OK=0
        case "$COST_POLL_ERR" in
          *"illegal window"*|*"Invalid 'window'"*|*.[0-9][0-9][0-9]Z*)
            COST_MS_WINDOW_BUG=1
            add_finding "KNOWN BUG: the cost agent is sending a millisecond-precision RFC3339 window ('...T16:00:00.000Z'), which no OpenCost/Kubecost layout parses — every window is rejected with HTTP 400 'illegal window' and nothing is ever shipped. Fixed in newer cost-agent images: helm upgrade <release> oneuptime/kubernetes-agent -n $NS --reuse-values --set cost.agent.image.tag=release, then restart: kubectl rollout restart -n $NS deploy/$COST_AGENT_DEPLOY" ;;
          *"did not answer any known allocation path"*|*"HTTP 404"*)
            add_finding "The cost engine at ${COST_ENGINE_URL:-?} serves none of the allocation paths the poller knows (/model/allocation, /allocation/compute, /allocation). If it exposes a different path, set cost.engine.allocationPath. Poller error: $COST_POLL_ERR" ;;
          *ECONNREFUSED*|*ENOTFOUND*|*EAI_AGAIN*|*timeout*|*ETIMEDOUT*)
            add_finding "The poller cannot reach the cost engine at ${COST_ENGINE_URL:-?} (DNS/refused/timeout). Poller error: $COST_POLL_ERR" ;;
          *)
            add_finding "The cost poller's last window failed: $COST_POLL_ERR" ;;
        esac
      fi
      if [ -n "$COST_SHIP_ERR" ]; then
        fail "Shipper's last error: $COST_SHIP_ERR"
        COST_OK=0
        case "$COST_SHIP_ERR" in
          *40[13]*|*"Invalid service token"*|*"token"*)
            add_finding "OneUptime rejected the cost payload's ingestion key — same key as Section 4. Shipper error: $COST_SHIP_ERR" ;;
          *404*)
            add_finding "OneUptime returned 404 for the cost ingest route (/telemetry/kubernetes-cost/ingest) — the server predates the cost feature, or a reverse proxy doesn't route it. Shipper error: $COST_SHIP_ERR" ;;
          *)
            add_finding "The cost agent could not ship allocations to OneUptime: $COST_SHIP_ERR" ;;
        esac
      fi
      if [ -z "$COST_POLL_ERR" ] && [ -z "$COST_SHIP_ERR" ]; then
        pass "cost-agent reports no poll or ship error."
        # /healthz only holds the LAST error, so a pod that restarted (or has
        # not polled since) looks clean. The log tail is the second opinion.
        COSTLOG=$(kubectl logs -n "$NS" "deploy/$COST_AGENT_DEPLOY" --tail=200 2>/dev/null \
          | grep -iE 'error|failed|illegal window|refused|denied' | tail -5)
        if [ -n "$COSTLOG" ]; then
          warn "…but the recent cost-agent logs contain errors:"
          printf '%s\n' "$COSTLOG" | while read -r cl; do detail "$(printf '%s' "$cl" | head -c 160)"; done
        fi
      fi
    fi
  fi

  # 9b. Does the engine's Allocation API actually answer? Probed with a
  # SECOND-precision window over the last closed hour — the exact format the
  # engines parse, so a 400 here means the engine, not the poller, is at fault.
  COST_ALLOC_PATH=""
  COST_WIN_END=$(( $(date -u +%s) / 3600 * 3600 ))
  COST_WINDOW="$(utc_rfc3339 $((COST_WIN_END - 3600))),$(utc_rfc3339 "$COST_WIN_END")"
  if [ "$COST_PROBE_OK" = 1 ] && [ -n "${COST_ENGINE_URL:-}" ]; then
    info "Probing the allocation API at $COST_ENGINE_URL (window $COST_WINDOW)"
    for cpath in /allocation/compute /allocation /model/allocation; do
      cost_probe GET "$COST_ENGINE_URL$cpath?window=$COST_WINDOW&accumulate=true" || break
      if is_conn_fail; then
        fail "Cannot reach the cost engine at $COST_ENGINE_URL (curl exit ${RESP_EXIT:-?})."
        detail "curl: $(printf '%s' "$RESP_BODY" | tr '\n' ' ' | head -c 200)"
        COST_OK=0
        add_finding "The cost engine at $COST_ENGINE_URL is unreachable from inside the cluster, so the poller has nothing to read. If it's the bundled engine, see the opencost pod above; if it's external, check cost.engine.url, DNS and any NetworkPolicy between the namespaces."
        break
      fi
      case "$RESP_CODE" in
        2??)
          pass "Allocation API answers on $cpath (HTTP $RESP_CODE)."
          [ "${COST_MS_WINDOW_BUG:-0}" = 1 ] && \
            detail "…and this probe used a SECOND-precision window on the very path the poller is failing on — so the engine is fine and the poller's window format is the bug."
          COST_ALLOC_PATH="$cpath"
          break ;;
        404)
          detail "$cpath → 404 (not this engine flavour)" ;;
        400)
          case "$RESP_BODY" in
            *"illegal window"*|*"Invalid 'window'"*)
              fail "$cpath → HTTP 400 'illegal window' for a second-precision RFC3339 window."
              detail "$(printf '%s' "$RESP_BODY" | tr '\n' ' ' | head -c 200)"
              COST_OK=0
              add_finding "The cost engine rejects the window format on $cpath. This is the same class of bug that made the poller ship nothing: the Allocation API parses RFC3339 with a fixed set of layouts and accepts no fractional seconds. Probe sent: window=$COST_WINDOW. Report this with the engine version — the poller cannot succeed while the engine 400s a valid window."
              break ;;
            *)
              detail "$cpath → HTTP 400: $(printf '%s' "$RESP_BODY" | tr '\n' ' ' | head -c 160)" ;;
          esac ;;
        *)
          detail "$cpath → HTTP $RESP_CODE: $(printf '%s' "$RESP_BODY" | tr '\n' ' ' | head -c 160)" ;;
      esac
    done
    if [ -z "$COST_ALLOC_PATH" ] && [ "$COST_OK" = 1 ] && [ "$COST_PROBE_OK" = 1 ]; then
      fail "No allocation path answered at $COST_ENGINE_URL (/allocation/compute, /allocation, /model/allocation)."
      COST_OK=0
      add_finding "The cost engine answers HTTP but serves none of the allocation paths the poller probes. Confirm it is OpenCost/Kubecost and, if its API lives elsewhere, set cost.engine.allocationPath."
    fi
    # A pinned path removes the poller's fallback: it queries that path only.
    if [ -n "$COST_ALLOC_PATH_CFG" ] && [ -n "$COST_ALLOC_PATH" ] && [ "$COST_ALLOC_PATH_CFG" != "$COST_ALLOC_PATH" ]; then
      fail "cost.engine.allocationPath is pinned to '$COST_ALLOC_PATH_CFG' but the engine answers on '$COST_ALLOC_PATH'."
      COST_OK=0
      add_finding "cost.engine.allocationPath pins the poller to '$COST_ALLOC_PATH_CFG', which this engine does not serve — and an explicit path disables the auto-probe, so it never tries '$COST_ALLOC_PATH'. Clear it (--set cost.engine.allocationPath=\"\") or set it to '$COST_ALLOC_PATH'."
    fi
  fi

  # 9c. The bundled Prometheus is what OpenCost reconstructs usage and price
  # history from. With either scrape target down it still answers the
  # allocation API — with empty or costless allocations.
  if [ "$COST_BUNDLED" = 1 ] && [ "$COST_PROBE_OK" = 1 ]; then
    PROM_SVC=$(kubectl get svc -n "$NS" -l "$SEL,component=cost-prometheus" \
      -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [ -z "$PROM_SVC" ]; then
      warn "No cost-prometheus Service found — skipping the scrape-target check."
    else
      # This body lists every discovered target with its labels, so it needs
      # far more than the default 1 kB.
      RESP_MAX_BYTES=400000
      cost_probe GET "http://$PROM_SVC.$NS.svc.cluster.local:9090/api/v1/targets?state=active"
      COST_TARGETS_RC=$?
      [ ${#RESP_BODY} -ge 400000 ] && detail "(targets response truncated at 400 kB — counts below may be partial)"
      RESP_MAX_BYTES=1000
      if [ "$COST_TARGETS_RC" != 0 ]; then
        :
      elif [ "$RESP_CODE" != "200" ]; then
        fail "cost-prometheus /api/v1/targets → HTTP $RESP_CODE (curl exit ${RESP_EXIT:-?})."
        COST_OK=0
        add_finding "The bundled cost Prometheus is not serving its API, so OpenCost has no usage/price history to allocate from. See the cost-prometheus pod in Section 3."
      else
        for pjob in kubernetes-nodes-cadvisor opencost; do
          prom_job_health "$pjob"
          if [ "$PROM_TOTAL" = 0 ]; then
            fail "cost-prometheus has no '$pjob' target at all."
            COST_OK=0
            if [ "$pjob" = "kubernetes-nodes-cadvisor" ]; then
              add_finding "The cost Prometheus discovered no cAdvisor targets — node discovery is failing (the agent ServiceAccount needs nodes + nodes/proxy). Without container usage, OpenCost can only produce empty or idle-only allocations."
            else
              add_finding "The cost Prometheus has no 'opencost' scrape target — its config didn't render or the pod is running an older ConfigMap. Restart it: kubectl rollout restart -n $NS deploy/$PROM_SVC"
            fi
          elif [ "$PROM_UP" = "$PROM_TOTAL" ]; then
            pass "cost-prometheus target '$pjob': $PROM_UP/$PROM_TOTAL up."
          else
            fail "cost-prometheus target '$pjob': only $PROM_UP/$PROM_TOTAL up."
            [ -n "$PROM_ERR" ] && detail "lastError: $(printf '%s' "$PROM_ERR" | head -c 200)"
            COST_OK=0
            if [ "$pjob" = "kubernetes-nodes-cadvisor" ]; then
              add_finding "$((PROM_TOTAL - PROM_UP)) of $PROM_TOTAL cAdvisor targets are down, so those nodes' containers get no usage series and their workloads will be missing (or priced as idle) in the cost data. lastError: ${PROM_ERR:-see the target page}"
            else
              add_finding "The cost Prometheus cannot scrape OpenCost (${PROM_UP}/${PROM_TOTAL} up), so node/PV prices never enter the TSDB and allocations come back without cost. lastError: ${PROM_ERR:-see the target page}"
            fi
          fi
        done
      fi
    fi
  fi

  if [ "$COST_OK" = 1 ] && [ "$COST_PROBE_OK" = 1 ]; then
    pass "Cost pipeline looks healthy."
    detail "Rows appear after the first hourly window closes and settles (~1h after install); the dashboard stays empty until then."
  elif [ "$COST_OK" = 1 ]; then
    # The workloads are fine, but the HTTP probes are the half that catches the
    # engine and window failures — don't call that a clean bill of health.
    info "Nothing wrong in the cost checks that could run, but the in-cluster HTTP probes didn't — the poller's /healthz and the engine's allocation API are unverified."
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

# Cost rides its own pipeline (poller → engine → /telemetry ingest), so it can
# be broken while telemetry is fine — and fixing telemetry won't start it.
if [ "$COST_ENABLED" = 1 ] && [ "$COST_OK" != 1 ]; then
  printf "\n%s%sCost collection is broken too (Section 9).%s It ships on a separate pipeline from\n" "$C_BOLD" "$C_RED" "$C_OFF"
  printf "telemetry, so anything fixed above leaves the Kubernetes Cost dashboard empty.\n"
fi

if [ ${#FINDINGS[@]} -gt 0 ]; then
  printf "\n%sFindings:%s\n" "$C_BOLD" "$C_OFF"
  i=1
  for f in "${FINDINGS[@]}"; do printf "  %d. %s\n" "$i" "$f"; i=$((i+1)); done
fi

printf "\n%s%d failed check(s), %d warning(s).%s\n" "$C_DIM" "$FAIL_COUNT" "$WARN_COUNT" "$C_OFF"
[ "$FAIL_COUNT" -gt 0 ] && exit 1
exit 0
