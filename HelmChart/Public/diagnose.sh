#!/usr/bin/env bash
#
# OneUptime Self-Hosted Performance Diagnostic
#
# Read-only script that inspects an OneUptime deployment on Kubernetes,
# flags performance issues, and prints a ranked summary of action steps.
#
# Usage:
#   ./diagnose.sh                                # auto-detect namespace
#   ./diagnose.sh -n my-namespace                # specify namespace
#   ./diagnose.sh -n my-namespace -r my-release  # specify helm release name
#   ./diagnose.sh --no-color                     # disable color output
#   ./diagnose.sh --output report.txt            # custom report file
#
# Requirements: kubectl with access to the cluster. jq is optional.
# The script only runs read queries; it does not modify cluster state.

set -u
set -o pipefail

# ---------------------------------------------------------------------------
# Config / flags
# ---------------------------------------------------------------------------

NAMESPACE=""
RELEASE=""
USE_COLOR=1
REPORT_FILE=""
LOG_LOOKBACK_LINES=500

usage() {
  sed -n '2,16p' "$0"
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--namespace) NAMESPACE="$2"; shift 2 ;;
    -r|--release)   RELEASE="$2"; shift 2 ;;
    --output)       REPORT_FILE="$2"; shift 2 ;;
    --no-color)     USE_COLOR=0; shift ;;
    -h|--help)      usage ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ ! -t 1 ]; then
  USE_COLOR=0
fi

if [ "$USE_COLOR" = "1" ]; then
  C_RED=$'\033[31m';    C_YEL=$'\033[33m'; C_GRN=$'\033[32m'
  C_BLU=$'\033[34m';    C_DIM=$'\033[2m';  C_BOLD=$'\033[1m'
  C_RST=$'\033[0m'
else
  C_RED=""; C_YEL=""; C_GRN=""; C_BLU=""; C_DIM=""; C_BOLD=""; C_RST=""
fi

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TS_FILE=$(date -u +"%Y%m%d-%H%M%S")
if [ -z "$REPORT_FILE" ]; then
  REPORT_FILE="oneuptime-diagnostic-${TS_FILE}.txt"
fi

# Findings storage. Each entry: "SEVERITY|COMPONENT|MESSAGE|ACTION"
# Bash 3.2 compatible (no associative arrays).
FINDINGS=()

add_finding() {
  # $1=severity (CRIT|WARN|INFO|OK)  $2=component  $3=message  $4=action
  FINDINGS+=("$1|$2|$3|$4")
}

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

section()   { echo; echo "${C_BOLD}${C_BLU}== $* ==${C_RST}"; }
step()      { printf "%s\n" "$*"; }
ok()        { printf "  ${C_GRN}OK${C_RST}    %s\n" "$*"; }
warn()      { printf "  ${C_YEL}WARN${C_RST}  %s\n" "$*"; }
crit()      { printf "  ${C_RED}CRIT${C_RST}  %s\n" "$*"; }
info()      { printf "  ${C_DIM}info${C_RST}  %s\n" "$*"; }
note()      { printf "  ${C_DIM}%s${C_RST}\n" "$*"; }

# Capture all output to report file too. Use tee via process substitution.
exec > >(tee "$REPORT_FILE") 2>&1

trap 'echo; echo "Report saved to: $REPORT_FILE"' EXIT

# ---------------------------------------------------------------------------
# kubectl helpers
# ---------------------------------------------------------------------------

require_kubectl() {
  if ! command -v kubectl >/dev/null 2>&1; then
    echo "ERROR: kubectl not found on PATH" >&2
    exit 1
  fi
  if ! kubectl version --client=true --output=json >/dev/null 2>&1 && \
     ! kubectl version --client >/dev/null 2>&1; then
    echo "ERROR: kubectl is not working" >&2
    exit 1
  fi
}

kc() { kubectl -n "$NAMESPACE" "$@"; }

# Run a command inside a pod, suppress stderr unless it failed.
kc_exec() {
  local pod="$1"; shift
  local container_flag=()
  if [ -n "${EXEC_CONTAINER:-}" ]; then
    container_flag=(-c "$EXEC_CONTAINER")
  fi
  kubectl -n "$NAMESPACE" exec "$pod" "${container_flag[@]}" -- "$@" 2>/dev/null
}

# Return the first ready pod matching a label selector, or empty.
first_ready_pod() {
  local selector="$1"
  kc get pod -l "$selector" \
    -o jsonpath='{range .items[?(@.status.phase=="Running")]}{.metadata.name}{"\n"}{end}' \
    2>/dev/null | head -n1
}

# Get a secret value (b64 decoded) safely.
secret_value() {
  local name="$1" key="$2"
  kc get secret "$name" -o jsonpath="{.data.$key}" 2>/dev/null | base64 -d 2>/dev/null
}

# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

discover() {
  section "Discovery"
  require_kubectl

  local ctx
  ctx=$(kubectl config current-context 2>/dev/null || echo "unknown")
  step "kube context : $ctx"
  step "started at   : $TS"

  if [ -z "$NAMESPACE" ]; then
    NAMESPACE=$(kubectl get pods -A -l appname=oneuptime \
      -o jsonpath='{.items[0].metadata.namespace}' 2>/dev/null)
    if [ -z "$NAMESPACE" ]; then
      echo "ERROR: could not auto-detect OneUptime namespace." >&2
      echo "Pass --namespace <name>." >&2
      exit 1
    fi
  fi
  step "namespace    : $NAMESPACE"

  if [ -z "$RELEASE" ]; then
    # Release name is the prefix of "<release>-app" pod's `app` label.
    local app_label
    app_label=$(kc get pod -l "appname=oneuptime" \
      -o jsonpath='{range .items[*]}{.metadata.labels.app}{"\n"}{end}' 2>/dev/null \
      | grep -E -- '-app$' | head -n1)
    if [ -n "$app_label" ]; then
      RELEASE="${app_label%-app}"
    fi
    if [ -z "$RELEASE" ]; then
      # Fall back to common name.
      RELEASE="oneuptime"
    fi
  fi
  step "release      : $RELEASE"
  step "report file  : $REPORT_FILE"
}

# ---------------------------------------------------------------------------
# 1. Pod health
# ---------------------------------------------------------------------------

check_pod_health() {
  section "Pod health"
  local all_pods
  all_pods=$(kc get pods -l appname=oneuptime -o wide 2>/dev/null)
  if [ -z "$all_pods" ]; then
    crit "No OneUptime pods found in namespace $NAMESPACE."
    add_finding "CRIT" "cluster" \
      "No pods found with label appname=oneuptime in namespace $NAMESPACE" \
      "Verify the helm release is installed: helm -n $NAMESPACE list"
    return
  fi
  echo "$all_pods" | sed 's/^/    /'

  # Pending pods.
  local pending
  pending=$(kc get pods -l appname=oneuptime \
    --field-selector=status.phase=Pending \
    -o jsonpath='{range .items[*]}{.metadata.name}{" "}{end}' 2>/dev/null)
  if [ -n "$pending" ]; then
    crit "Pods stuck Pending: $pending"
    add_finding "CRIT" "scheduler" \
      "Pods are Pending and not scheduled: $pending" \
      "Run 'kubectl -n $NAMESPACE describe pod <name>' for each; common causes are insufficient CPU/memory in the cluster or PVCs that cannot bind. Add nodes or relax resource requests in values.yaml."
  fi

  # CrashLoopBackOff / Error.
  local bad
  bad=$(kc get pods -l appname=oneuptime \
    -o jsonpath='{range .items[*]}{.metadata.name}={.status.containerStatuses[*].state.waiting.reason}{"\n"}{end}' \
    2>/dev/null | grep -E "CrashLoopBackOff|Error|ImagePullBackOff|CreateContainerConfigError" || true)
  if [ -n "$bad" ]; then
    crit "Pods in error state:"
    echo "$bad" | sed 's/^/      /'
    add_finding "CRIT" "pods" \
      "Pods in CrashLoopBackOff or error state" \
      "Run 'kubectl -n $NAMESPACE logs <pod> --previous' and 'kubectl -n $NAMESPACE describe pod <pod>'. CrashLoopBackOff typically means missing config/secret, failed migration, or a database the app cannot reach."
  fi

  # Restart counts and OOMKilled.
  local restarts_out
  restarts_out=$(kc get pods -l appname=oneuptime \
    -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.containerStatuses[0].restartCount}{" "}{.status.containerStatuses[0].lastState.terminated.reason}{"\n"}{end}' \
    2>/dev/null)
  while IFS=' ' read -r pod restarts last_reason; do
    [ -z "$pod" ] && continue
    if [ "${restarts:-0}" -ge 5 ]; then
      warn "$pod restarted ${restarts} times (last: ${last_reason:-unknown})"
      if [ "${last_reason:-}" = "OOMKilled" ]; then
        add_finding "CRIT" "$pod" \
          "OOMKilled — container memory limit too low (restarted ${restarts}x)" \
          "Raise the container's memory limit in values.yaml for this component and run 'helm upgrade'. For clickhouse/postgresql/redis, also raise the JVM/buffer-cache settings if applicable."
      else
        add_finding "WARN" "$pod" \
          "Restarted ${restarts} times (last reason: ${last_reason:-unknown})" \
          "Check 'kubectl -n $NAMESPACE logs $pod --previous' and 'kubectl -n $NAMESPACE describe pod $pod' for the termination cause."
      fi
    fi
  done <<< "$restarts_out"

  # Recent events that look bad.
  local events
  events=$(kc get events --sort-by=.lastTimestamp 2>/dev/null \
    | grep -E "Warning|Error|Failed|Evicted|FailedScheduling|OOM" \
    | tail -n 15 || true)
  if [ -n "$events" ]; then
    info "Recent warning/error events:"
    echo "$events" | sed 's/^/      /'
  fi
}

# ---------------------------------------------------------------------------
# 2. Resource usage (CPU/memory)
# ---------------------------------------------------------------------------

check_resources() {
  section "Resource usage"

  local top_out
  top_out=$(kc top pods -l appname=oneuptime --no-headers 2>&1)
  if echo "$top_out" | grep -qiE "metrics.*not available|metrics-server|error"; then
    warn "kubectl top is unavailable (metrics-server not installed?)"
    add_finding "WARN" "cluster" \
      "metrics-server not available — cannot measure pod CPU/memory" \
      "Install metrics-server: kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml"
    return
  fi
  echo "$top_out" | sed 's/^/    /'

  # Compare usage vs limits for each pod (first container only).
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local pod cpu mem
    pod=$(echo "$line" | awk '{print $1}')
    cpu=$(echo "$line" | awk '{print $2}')
    mem=$(echo "$line" | awk '{print $3}')

    local cpu_m mem_mi
    cpu_m=$(parse_cpu "$cpu")
    mem_mi=$(parse_mem "$mem")

    local cpu_limit_raw mem_limit_raw cpu_limit mem_limit
    cpu_limit_raw=$(kc get pod "$pod" -o jsonpath='{.spec.containers[0].resources.limits.cpu}' 2>/dev/null)
    mem_limit_raw=$(kc get pod "$pod" -o jsonpath='{.spec.containers[0].resources.limits.memory}' 2>/dev/null)
    cpu_limit=$([ -n "$cpu_limit_raw" ] && parse_cpu "$cpu_limit_raw" || echo "")
    mem_limit=$([ -n "$mem_limit_raw" ] && parse_mem "$mem_limit_raw" || echo "")

    if [ -n "$cpu_limit" ] && [ "$cpu_limit" -gt 0 ] 2>/dev/null; then
      local cpu_pct=$(( cpu_m * 100 / cpu_limit ))
      if [ "$cpu_pct" -ge 90 ]; then
        warn "$pod CPU at ${cpu_pct}% of limit"
        add_finding "WARN" "$pod" \
          "CPU usage at ${cpu_pct}% of configured limit — likely throttling" \
          "Raise the CPU limit for this component in values.yaml, or scale horizontally by increasing replicaCount / enabling HPA."
      fi
    fi
    if [ -n "$mem_limit" ] && [ "$mem_limit" -gt 0 ] 2>/dev/null; then
      local mem_pct=$(( mem_mi * 100 / mem_limit ))
      if [ "$mem_pct" -ge 90 ]; then
        crit "$pod memory at ${mem_pct}% of limit — OOM risk"
        add_finding "CRIT" "$pod" \
          "Memory at ${mem_pct}% of configured limit — imminent OOMKill risk" \
          "Raise the memory limit for this component in values.yaml and run 'helm upgrade'."
      elif [ "$mem_pct" -ge 75 ]; then
        warn "$pod memory at ${mem_pct}% of limit"
        add_finding "WARN" "$pod" \
          "Memory at ${mem_pct}% of configured limit" \
          "Consider raising the memory limit before it becomes critical."
      fi
    fi
  done <<< "$top_out"

  # Node pressure.
  local nodes
  nodes=$(kubectl top nodes --no-headers 2>/dev/null || true)
  if [ -n "$nodes" ]; then
    info "Node resource usage:"
    echo "$nodes" | sed 's/^/      /'
    while IFS= read -r nline; do
      [ -z "$nline" ] && continue
      local cpu_pct mem_pct
      cpu_pct=$(echo "$nline" | awk '{print $3}' | tr -d '%')
      mem_pct=$(echo "$nline" | awk '{print $5}' | tr -d '%')
      local name
      name=$(echo "$nline" | awk '{print $1}')
      if [ -n "$cpu_pct" ] && [ "$cpu_pct" -ge 85 ] 2>/dev/null; then
        add_finding "WARN" "node/$name" \
          "Node CPU at ${cpu_pct}%" \
          "Add nodes to the cluster or reduce request counts on heavy workloads (e.g., scale down probe replicas)."
      fi
      if [ -n "$mem_pct" ] && [ "$mem_pct" -ge 85 ] 2>/dev/null; then
        add_finding "WARN" "node/$name" \
          "Node memory at ${mem_pct}%" \
          "Add nodes or move heavy workloads (clickhouse, postgresql) to a dedicated node pool."
      fi
    done <<< "$nodes"
  fi
}

# Convert CPU string (e.g. "250m", "1") to millicores.
parse_cpu() {
  local s="$1"
  case "$s" in
    *m) echo "${s%m}" ;;
    *)  echo $(( ${s%.*} * 1000 )) ;;
  esac
}

# Convert memory string (e.g. "128Mi", "1Gi") to Mi.
parse_mem() {
  local s="$1"
  case "$s" in
    *Gi) echo $(( ${s%Gi} * 1024 )) ;;
    *Mi) echo "${s%Mi}" ;;
    *G)  echo $(( ${s%G} * 1024 )) ;;
    *M)  echo "${s%M}" ;;
    *Ki) echo $(( ${s%Ki} / 1024 )) ;;
    *)   echo "0" ;;
  esac
}

# ---------------------------------------------------------------------------
# 3. PostgreSQL
# ---------------------------------------------------------------------------

check_postgres() {
  section "PostgreSQL"
  local pod
  pod=$(first_ready_pod "app=${RELEASE}-postgresql")
  if [ -z "$pod" ]; then
    info "No in-cluster PostgreSQL found (external Postgres?). Skipping."
    add_finding "INFO" "postgresql" \
      "No in-cluster PostgreSQL detected" \
      "If using externalPostgres, check the managed DB's monitoring console for slow queries, CPU, and connection saturation."
    return
  fi
  step "pod: $pod"

  local pw db user
  pw=$(secret_value "${RELEASE}-postgresql" "postgres-password")
  db="oneuptimedb"
  user="postgres"
  if [ -z "$pw" ]; then
    warn "Could not read postgres password from secret ${RELEASE}-postgresql"
    add_finding "WARN" "postgresql" \
      "Could not read postgres password — DB checks skipped" \
      "Verify secret '${RELEASE}-postgresql' exists and your kubeconfig can read it."
    return
  fi

  local psql_cmd="PGPASSWORD=$pw psql -U $user -d $db -tA"

  # Connection count vs max.
  local conn_used conn_max
  conn_used=$(kc_exec "$pod" sh -c "$psql_cmd -c 'SELECT count(*) FROM pg_stat_activity;'" | tr -d ' \r')
  conn_max=$(kc_exec "$pod" sh -c "$psql_cmd -c 'SHOW max_connections;'" | tr -d ' \r')
  if [ -n "$conn_used" ] && [ -n "$conn_max" ]; then
    local pct=$(( conn_used * 100 / conn_max ))
    step "connections: ${conn_used}/${conn_max} (${pct}%)"
    if [ "$pct" -ge 90 ]; then
      crit "Postgres connection pool near exhaustion: ${conn_used}/${conn_max}"
      add_finding "CRIT" "postgresql" \
        "Connection pool at ${pct}% (${conn_used}/${conn_max})" \
        "Increase postgresql.primary.extendedConfiguration.max_connections in values.yaml, or check app/worker for connection leaks. Also confirm pgbouncer is in front if you have many app replicas."
    elif [ "$pct" -ge 70 ]; then
      warn "Postgres connections at ${pct}%"
      add_finding "WARN" "postgresql" \
        "Connection pool at ${pct}% (${conn_used}/${conn_max})" \
        "Monitor; if it climbs further, bump max_connections or add pgbouncer."
    fi
  fi

  # Long-running queries.
  local long_queries
  long_queries=$(kc_exec "$pod" sh -c "$psql_cmd -c \"SELECT pid, EXTRACT(EPOCH FROM (now()-query_start))::int AS secs, state, left(query, 200) FROM pg_stat_activity WHERE state != 'idle' AND query_start IS NOT NULL ORDER BY secs DESC LIMIT 5;\"")
  if [ -n "$long_queries" ]; then
    info "Top in-flight queries (pid | seconds | state | query):"
    echo "$long_queries" | sed 's/^/      /'
    local worst
    worst=$(echo "$long_queries" | head -n1 | awk -F'|' '{print $2}' | tr -d ' ')
    if [ -n "$worst" ] && [ "$worst" -ge 60 ] 2>/dev/null; then
      warn "Longest active query has been running ${worst}s"
      add_finding "WARN" "postgresql" \
        "A query has been running for ${worst}s" \
        "Inspect with: kubectl -n $NAMESPACE exec $pod -- psql -U $user -d $db -c \"SELECT * FROM pg_stat_activity WHERE state != 'idle' ORDER BY query_start;\". Add an index, kill the query, or tune the offending app code path."
    fi
  fi

  # Dead tuples (autovacuum keeping up?).
  local bloat
  bloat=$(kc_exec "$pod" sh -c "$psql_cmd -c \"SELECT relname, n_live_tup, n_dead_tup, last_autovacuum FROM pg_stat_user_tables WHERE n_dead_tup > 50000 ORDER BY n_dead_tup DESC LIMIT 5;\"")
  if [ -n "$bloat" ]; then
    warn "Tables with high dead-tuple counts (autovacuum may be falling behind):"
    echo "$bloat" | sed 's/^/      /'
    add_finding "WARN" "postgresql" \
      "Tables have >50k dead tuples — autovacuum may not be keeping up" \
      "Run 'VACUUM (VERBOSE, ANALYZE) <table>' on the worst offenders. Long-term: tune autovacuum (autovacuum_vacuum_scale_factor=0.05, autovacuum_naptime=15s) in values.yaml."
  fi

  # Database size.
  local dbsize
  dbsize=$(kc_exec "$pod" sh -c "$psql_cmd -c \"SELECT pg_size_pretty(pg_database_size('$db'));\"" | tr -d ' \r')
  step "database size: $dbsize"

  # Cache hit ratio.
  local cache_hit
  cache_hit=$(kc_exec "$pod" sh -c "$psql_cmd -c \"SELECT round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) FROM pg_stat_database;\"" | tr -d ' \r')
  if [ -n "$cache_hit" ]; then
    step "cache hit ratio: ${cache_hit}%"
    # Compare as integer percentage.
    local hit_int=${cache_hit%.*}
    if [ -n "$hit_int" ] && [ "$hit_int" -lt 95 ] 2>/dev/null; then
      warn "Postgres cache hit ratio ${cache_hit}% is low (target >99%)"
      add_finding "WARN" "postgresql" \
        "Cache hit ratio ${cache_hit}% — shared_buffers likely too small for working set" \
        "Raise postgresql.primary.extendedConfiguration.shared_buffers (rule of thumb: 25% of pod memory). Also bump effective_cache_size to ~50%."
    fi
  fi
}

# ---------------------------------------------------------------------------
# 4. Clickhouse
# ---------------------------------------------------------------------------

check_clickhouse() {
  section "Clickhouse"
  local pod
  pod=$(first_ready_pod "app=${RELEASE}-clickhouse")
  if [ -z "$pod" ]; then
    # Also try app.kubernetes.io/name=clickhouse.
    pod=$(first_ready_pod "app.kubernetes.io/name=clickhouse")
  fi
  if [ -z "$pod" ]; then
    info "No in-cluster Clickhouse found (external Clickhouse?). Skipping."
    add_finding "INFO" "clickhouse" \
      "No in-cluster Clickhouse detected" \
      "If using externalClickhouse, check its query_log and disk usage directly."
    return
  fi
  step "pod: $pod"

  local pw user db
  pw=$(secret_value "${RELEASE}-clickhouse" "admin-password")
  user="oneuptime"
  db="default"
  local ch_args=(--user "$user" --database "$db")
  if [ -n "$pw" ]; then
    ch_args+=(--password "$pw")
  fi

  # In-flight queries.
  local procs
  procs=$(kc_exec "$pod" clickhouse-client "${ch_args[@]}" \
    --query "SELECT round(elapsed,1) AS secs, formatReadableSize(memory_usage) AS mem, left(query, 160) FROM system.processes ORDER BY elapsed DESC LIMIT 5 FORMAT TabSeparated")
  if [ -n "$procs" ]; then
    info "Top in-flight Clickhouse queries (secs | memory | query):"
    echo "$procs" | sed 's/^/      /'
    local worst
    worst=$(echo "$procs" | head -n1 | awk '{print $1}')
    # ${worst%.*} strips decimals.
    if [ -n "$worst" ] && [ "${worst%.*}" -ge 30 ] 2>/dev/null; then
      warn "Clickhouse has a query running for ${worst}s"
      add_finding "WARN" "clickhouse" \
        "A Clickhouse query has been running ${worst}s" \
        "Check system.query_log for the pattern. Common fixes: add a PRIMARY KEY column to the WHERE clause, lower the dashboard time range, or shorten retention so tables stay smaller."
    fi
  fi

  # Disk usage.
  local df_out
  df_out=$(kc_exec "$pod" df -h /var/lib/clickhouse 2>/dev/null | tail -n1)
  if [ -n "$df_out" ]; then
    local used_pct=$(echo "$df_out" | awk '{print $5}' | tr -d '%')
    step "disk: $df_out"
    if [ -n "$used_pct" ] && [ "$used_pct" -ge 85 ] 2>/dev/null; then
      crit "Clickhouse disk at ${used_pct}% full"
      add_finding "CRIT" "clickhouse" \
        "Clickhouse data disk at ${used_pct}% full" \
        "Resize the PVC (clickhouse.persistence.size in values.yaml), or shorten retention. Telemetry retention per project is set in the OneUptime UI under Project Settings → Telemetry."
    elif [ -n "$used_pct" ] && [ "$used_pct" -ge 70 ] 2>/dev/null; then
      warn "Clickhouse disk at ${used_pct}%"
      add_finding "WARN" "clickhouse" \
        "Clickhouse data disk at ${used_pct}% full" \
        "Plan to expand the PVC or reduce retention soon."
    fi
  fi

  # Top tables by size.
  local tables
  tables=$(kc_exec "$pod" clickhouse-client "${ch_args[@]}" \
    --query "SELECT table, formatReadableSize(sum(bytes_on_disk)) AS size, sum(rows) AS rows FROM system.parts WHERE active GROUP BY table ORDER BY sum(bytes_on_disk) DESC LIMIT 10 FORMAT PrettyCompactNoEscapes")
  if [ -n "$tables" ]; then
    info "Top Clickhouse tables by size:"
    echo "$tables" | sed 's/^/      /'
  fi

  # Slow queries from query_log.
  local slow
  slow=$(kc_exec "$pod" clickhouse-client "${ch_args[@]}" \
    --query "SELECT round(query_duration_ms/1000,1) AS secs, formatReadableSize(memory_usage) AS mem, read_rows, left(query, 160) FROM system.query_log WHERE event_time > now()-3600 AND type='QueryFinish' AND query_duration_ms > 5000 ORDER BY query_duration_ms DESC LIMIT 5 FORMAT TabSeparated")
  if [ -n "$slow" ]; then
    warn "Slow Clickhouse queries in the last hour (>5s):"
    echo "$slow" | sed 's/^/      /'
    add_finding "WARN" "clickhouse" \
      "Slow Clickhouse queries (>5s) observed in the last hour" \
      "Open Clickhouse system.query_log for full context. Often caused by dashboards with wide time ranges or missing index columns. Consider lowering default dashboard ranges and tuning Clickhouse merge_tree settings."
  fi

  # Merge backlog.
  local merges
  merges=$(kc_exec "$pod" clickhouse-client "${ch_args[@]}" \
    --query "SELECT count() FROM system.merges" | tr -d ' \r')
  if [ -n "$merges" ] && [ "$merges" -ge 10 ] 2>/dev/null; then
    warn "Clickhouse merge backlog: $merges in-flight merges"
    add_finding "WARN" "clickhouse" \
      "Clickhouse has $merges merges in flight — ingest may be outrunning compaction" \
      "Check insert volume; consider batching inserts (larger batches via OTel Collector) or raising background_pool_size."
  fi
}

# ---------------------------------------------------------------------------
# 5. Redis
# ---------------------------------------------------------------------------

check_redis() {
  section "Redis"
  local pod
  pod=$(first_ready_pod "app=${RELEASE}-redis")
  if [ -z "$pod" ]; then
    info "No in-cluster Redis found (external Redis?). Skipping."
    add_finding "INFO" "redis" \
      "No in-cluster Redis detected" \
      "If using externalRedis, check its INFO memory and stats from the managed console."
    return
  fi
  step "pod: $pod"

  local pw
  pw=$(secret_value "${RELEASE}-redis" "redis-password")
  local auth_arg=()
  if [ -n "$pw" ]; then
    auth_arg=(-a "$pw" --no-auth-warning)
  fi

  local info_mem info_stats
  info_mem=$(kc_exec "$pod" redis-cli "${auth_arg[@]}" INFO memory 2>/dev/null)
  info_stats=$(kc_exec "$pod" redis-cli "${auth_arg[@]}" INFO stats 2>/dev/null)

  if [ -z "$info_mem" ]; then
    warn "Could not query Redis (auth failed or pod not ready)"
    return
  fi

  local used_human used_bytes max_bytes evicted
  used_human=$(echo "$info_mem" | grep -E "^used_memory_human:" | tr -d '\r' | cut -d: -f2)
  used_bytes=$(echo "$info_mem" | grep -E "^used_memory:" | tr -d '\r' | cut -d: -f2)
  max_bytes=$(echo "$info_mem" | grep -E "^maxmemory:" | tr -d '\r' | cut -d: -f2)
  evicted=$(echo "$info_stats" | grep -E "^evicted_keys:" | tr -d '\r' | cut -d: -f2)

  step "memory used: $used_human  evicted_keys: ${evicted:-0}"

  if [ -n "$max_bytes" ] && [ "$max_bytes" -gt 0 ] 2>/dev/null; then
    local pct=$(( used_bytes * 100 / max_bytes ))
    step "memory pct : ${pct}% of maxmemory"
    if [ "$pct" -ge 85 ]; then
      warn "Redis memory at ${pct}% of maxmemory"
      add_finding "WARN" "redis" \
        "Redis memory at ${pct}% of maxmemory" \
        "Raise redis.master.resources.limits.memory and maxmemory in values.yaml."
    fi
  fi
  if [ -n "$evicted" ] && [ "$evicted" -gt 0 ] 2>/dev/null; then
    crit "Redis has evicted ${evicted} keys — cache or queue data is being lost"
    add_finding "CRIT" "redis" \
      "Redis has evicted ${evicted} keys" \
      "Increase Redis memory immediately (values.yaml: redis.master.resources.limits.memory). If used as a queue (BullMQ), eviction loses jobs — switch maxmemory-policy to 'noeviction' so the app fails fast instead, then size up."
  fi

  # Queue backlog (BullMQ uses bull:* keys).
  local queue_keys
  queue_keys=$(kc_exec "$pod" redis-cli "${auth_arg[@]}" --scan --pattern "bull:*:wait" 2>/dev/null | head -n 10)
  if [ -n "$queue_keys" ]; then
    info "BullMQ wait queues found (showing depth):"
    while IFS= read -r k; do
      [ -z "$k" ] && continue
      local depth
      depth=$(kc_exec "$pod" redis-cli "${auth_arg[@]}" LLEN "$k" 2>/dev/null | tr -d ' \r')
      echo "      $k -> $depth"
      if [ -n "$depth" ] && [ "$depth" -ge 1000 ] 2>/dev/null; then
        add_finding "WARN" "worker" \
          "Queue $k has $depth jobs waiting" \
          "Scale up the worker deployment (replicaCount in values.yaml) or check worker logs for stuck/failed jobs."
      fi
    done <<< "$queue_keys"
  fi
}

# ---------------------------------------------------------------------------
# 6. Storage / PVCs
# ---------------------------------------------------------------------------

check_storage() {
  section "Storage / PVCs"
  local pvcs
  pvcs=$(kc get pvc 2>/dev/null)
  if [ -z "$pvcs" ]; then
    info "No PVCs in namespace."
    return
  fi
  echo "$pvcs" | sed 's/^/    /'

  # PVC fullness — only meaningful for pods we can exec into.
  local mounts
  mounts="postgresql:/bitnami/postgresql clickhouse:/var/lib/clickhouse redis:/data"

  for spec in $mounts; do
    local comp="${spec%%:*}"
    local path="${spec##*:}"
    local pod
    pod=$(first_ready_pod "app=${RELEASE}-${comp}")
    [ -z "$pod" ] && continue
    local df_line
    df_line=$(kc_exec "$pod" df -h "$path" 2>/dev/null | tail -n1)
    [ -z "$df_line" ] && continue
    local pct=$(echo "$df_line" | awk '{print $5}' | tr -d '%')
    step "$comp ($path): $df_line"
    if [ -n "$pct" ] && [ "$pct" -ge 90 ] 2>/dev/null; then
      crit "$comp PVC at ${pct}% full"
      add_finding "CRIT" "$comp" \
        "$comp data volume at ${pct}% full" \
        "Expand the PVC via values.yaml (e.g. ${comp}.persistence.size) and 'helm upgrade'. Some storage classes require deleting the StatefulSet (orphan, --cascade=orphan) to resize."
    elif [ -n "$pct" ] && [ "$pct" -ge 75 ] 2>/dev/null; then
      warn "$comp PVC at ${pct}%"
      add_finding "WARN" "$comp" \
        "$comp data volume at ${pct}% full" \
        "Plan PVC expansion before it fills up."
    fi
  done
}

# ---------------------------------------------------------------------------
# 7. Logs scan (app, worker, probe)
# ---------------------------------------------------------------------------

check_logs() {
  section "Application logs (last ${LOG_LOOKBACK_LINES} lines)"
  local components="app worker probe ai-agent home"
  for comp in $components; do
    local pod
    pod=$(first_ready_pod "app=${RELEASE}-${comp}")
    if [ -z "$pod" ]; then
      # Probes have suffixes — try a glob via grep on names.
      pod=$(kc get pod -l appname=oneuptime \
        -o jsonpath='{range .items[?(@.status.phase=="Running")]}{.metadata.name}{"\n"}{end}' \
        2>/dev/null | grep -E "^${RELEASE}-${comp}" | head -n1)
    fi
    [ -z "$pod" ] && continue

    local errs
    errs=$(kc logs "$pod" --tail="$LOG_LOOKBACK_LINES" 2>/dev/null \
      | grep -iE "error|timeout|econnrefused|slow query|stalled|out of memory" \
      | grep -viE "no error|errorhandler|errorboundary" \
      | sort | uniq -c | sort -rn | head -n 5 || true)

    if [ -z "$errs" ]; then
      ok "$comp ($pod): no notable errors in last ${LOG_LOOKBACK_LINES} lines"
    else
      warn "$comp ($pod): repeated error patterns:"
      echo "$errs" | sed 's/^/      /'
      # Heuristic findings.
      if echo "$errs" | grep -qi "ECONNREFUSED"; then
        add_finding "WARN" "$comp" \
          "Connection refused errors in $comp logs" \
          "Identify the unreachable service from the logs. Common targets: postgres, clickhouse, redis — check those pods are Running."
      fi
      if echo "$errs" | grep -qi "timeout"; then
        add_finding "WARN" "$comp" \
          "Timeout errors in $comp logs" \
          "Check whether the slow dependency is the database (see Postgres/Clickhouse sections) or an external HTTP target."
      fi
      if echo "$errs" | grep -qi "slow query"; then
        add_finding "WARN" "$comp" \
          "Slow query warnings in $comp logs" \
          "Cross-reference timestamps with the Postgres pg_stat_activity or Clickhouse query_log output above to identify the offending query."
      fi
      if echo "$errs" | grep -qi "out of memory\|JavaScript heap"; then
        add_finding "CRIT" "$comp" \
          "Out-of-memory errors in $comp logs" \
          "Raise the Node.js heap (--max-old-space-size) and the container memory limit for $comp in values.yaml."
      fi
    fi
  done
}

# ---------------------------------------------------------------------------
# 8. Autoscaling
# ---------------------------------------------------------------------------

check_autoscaling() {
  section "Autoscaling (HPA / KEDA)"
  local hpa
  hpa=$(kc get hpa 2>/dev/null)
  if [ -n "$hpa" ]; then
    echo "$hpa" | sed 's/^/    /'
    # Look for HPAs at maxReplicas.
    local maxed
    maxed=$(kc get hpa -o jsonpath='{range .items[*]}{.metadata.name}={.status.currentReplicas}/{.spec.maxReplicas}{"\n"}{end}' 2>/dev/null \
      | awk -F'=' '{split($2, a, "/"); if (a[1] == a[2] && a[1] > 0) print $0}')
    if [ -n "$maxed" ]; then
      warn "HPAs at max replicas (cannot scale further):"
      echo "$maxed" | sed 's/^/      /'
      add_finding "WARN" "autoscaling" \
        "One or more HPAs are pinned at maxReplicas — cannot scale further" \
        "Raise maxReplicas in values.yaml for the affected component, or investigate why load is sustained at the cap."
    fi
  fi

  local scaledobjects
  scaledobjects=$(kc get scaledobjects 2>/dev/null)
  if [ -n "$scaledobjects" ]; then
    info "KEDA ScaledObjects:"
    echo "$scaledobjects" | sed 's/^/    /'
  fi
}

# ---------------------------------------------------------------------------
# 9. Ingress / Nginx
# ---------------------------------------------------------------------------

check_ingress() {
  section "Ingress / Nginx"
  local pod
  pod=$(first_ready_pod "app=${RELEASE}-nginx")
  if [ -z "$pod" ]; then
    info "No nginx pod found — may be using cluster ingress controller. Skipping."
    return
  fi
  step "pod: $pod"

  local errs
  errs=$(kc logs "$pod" --tail=2000 2>/dev/null \
    | grep -E "\" 5[0-9]{2} | \" 499 " \
    | awk '{print $9}' | sort | uniq -c | sort -rn | head -n 5)
  if [ -n "$errs" ]; then
    warn "5xx/499 responses (count | status):"
    echo "$errs" | sed 's/^/      /'
    local total_5xx
    total_5xx=$(echo "$errs" | awk '{s+=$1} END{print s+0}')
    if [ "$total_5xx" -ge 50 ]; then
      add_finding "WARN" "nginx" \
        "$total_5xx 5xx/499 responses in last 2000 log lines" \
        "Trace 5xx to the upstream service (app/probe/api). 499 = client disconnected before response, usually means app is too slow — check app pod CPU and DB queries."
    fi
  else
    ok "No notable 5xx/499 spikes in nginx access log"
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print_summary() {
  echo
  echo "${C_BOLD}========================================================================${C_RST}"
  echo "${C_BOLD}  SUMMARY${C_RST}"
  echo "${C_BOLD}========================================================================${C_RST}"

  local n_crit=0 n_warn=0 n_info=0
  local idx
  for idx in "${FINDINGS[@]}"; do
    case "$idx" in
      CRIT\|*) n_crit=$((n_crit+1)) ;;
      WARN\|*) n_warn=$((n_warn+1)) ;;
      INFO\|*) n_info=$((n_info+1)) ;;
    esac
  done

  printf "  ${C_RED}critical${C_RST} : %d\n" "$n_crit"
  printf "  ${C_YEL}warning${C_RST}  : %d\n" "$n_warn"
  printf "  ${C_DIM}info${C_RST}     : %d\n" "$n_info"

  if [ ${#FINDINGS[@]} -eq 0 ]; then
    echo
    echo "${C_GRN}No issues detected by automated checks.${C_RST}"
    echo
    echo "If the customer is still seeing performance problems, gather:"
    echo "  - the specific page/API that's slow + timestamp"
    echo "  - browser DevTools Network tab waterfall"
    echo "  - this report file ($REPORT_FILE)"
    return
  fi

  local sev_order="CRIT WARN INFO"
  local sev_label
  for sev in $sev_order; do
    case "$sev" in
      CRIT) sev_label="${C_RED}CRITICAL${C_RST}" ;;
      WARN) sev_label="${C_YEL}WARNING${C_RST}"  ;;
      INFO) sev_label="${C_DIM}INFO${C_RST}"     ;;
    esac
    local n=0
    for f in "${FINDINGS[@]}"; do
      [ "${f%%|*}" = "$sev" ] && n=$((n+1))
    done
    [ "$n" -eq 0 ] && continue
    echo
    echo "${C_BOLD}-- ${sev_label} (${n}) --${C_RST}"
    local i=1
    for f in "${FINDINGS[@]}"; do
      [ "${f%%|*}" = "$sev" ] || continue
      # Split: SEV|COMP|MSG|ACTION
      local rest="${f#*|}"
      local comp="${rest%%|*}"
      rest="${rest#*|}"
      local msg="${rest%%|*}"
      local action="${rest#*|}"
      printf "\n  ${C_BOLD}%d. [%s]${C_RST} %s\n" "$i" "$comp" "$msg"
      printf "     ${C_DIM}action:${C_RST} %s\n" "$action"
      i=$((i+1))
    done
  done

  echo
  echo "${C_BOLD}========================================================================${C_RST}"
  echo "${C_BOLD}  NEXT STEPS${C_RST}"
  echo "${C_BOLD}========================================================================${C_RST}"
  echo
  echo "1. Address ${C_RED}CRITICAL${C_RST} findings first — they cause data loss or outages."
  echo "2. Most changes are made in your helm values.yaml, then:"
  echo "     helm upgrade ${RELEASE} oneuptime/oneuptime -n ${NAMESPACE} -f values.yaml"
  echo "3. After each change, re-run this script to confirm the issue is gone:"
  echo "     ./diagnose.sh -n ${NAMESPACE} -r ${RELEASE}"
  echo "4. If issues persist, attach ${REPORT_FILE}"
  echo "   to a support ticket at https://oneuptime.com/support"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

discover
check_pod_health
check_resources
check_postgres
check_clickhouse
check_redis
check_storage
check_logs
check_autoscaling
check_ingress
print_summary
