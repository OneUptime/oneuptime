#!/usr/bin/env bash
#
# Where each cost engine serves its price metrics, measured on the engines
# themselves, and the kubernetes-agent chart's collector scraping them through
# the cost agent (issue #9776). Opt-in: it pulls Kubecost's and OpenCost's
# images (about 2 GB) and waits for them to start, so it is not part of the
# helm-test job. Run it by name when the cost agent's EngineMetrics, the
# chart's cost-engine job or an engine's version changes:
#
#   bash HelmChart/Tests/run.sh cost-engine-metrics
#
# It needs Docker (for KinD), node and npm (it builds the cost agent from this
# checkout), and network access to the engines' chart repositories and
# registries (kubecost.github.io, opencost.github.io, icr.io, ghcr.io, quay.io
# and Docker Hub).
#
# The chart scraped <cost.engine.url>/metrics, and a Kubecost named by its
# frontend - the URL the docs gave - answers that with its web page. Three
# steps, each against Kubecost 2, Kubecost 3 and OpenCost installed from
# their own charts:
#
#   1. What each engine's Services answer at /metrics and /model/metrics: the
#      shapes the agent's EngineMetrics is written for. A new engine version
#      that moves its metrics fails here first. (Kubecost 3's /model/metrics
#      is its aggregator's: 404 while it starts, then Go runtime series and
#      no price, which is why the agent takes only an address with prices.)
#   2. This checkout's cost agent, run once per way of naming an engine in
#      cost.engine.url, behind the Service the chart renders for it: where
#      /scrape-targets says the price metrics are, and which engine /healthz
#      says it reads.
#   3. The cost-engine job the chart renders for each, run in the collector
#      image the chart pins: every one scrapes price series. So does no job
#      the chart rendered before the fix (the agent off, which still scrapes
#      the URL's /metrics): the bug, measured.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

KUBECOST2_CHART_VERSION="${KUBECOST2_CHART_VERSION:-2.8.7}"
KUBECOST3_CHART_VERSION="${KUBECOST3_CHART_VERSION:-3.3.2}"
OPENCOST_CHART_VERSION="${OPENCOST_CHART_VERSION:-2.5.34}"
NODE_IMAGE="${NODE_IMAGE:-node:26-alpine}"
CURL_IMAGE="${CURL_IMAGE:-curlimages/curl:8.11.1}"
# How long the collector is given to scrape every job at least once.
COLLECT_SECONDS="${COLLECT_SECONDS:-150}"

REPO_DIR="$(cd "${TESTS_DIR}/../.." && pwd)"
AGENT_DIR="${REPO_DIR}/agents/KubernetesCostAgent"
WORK_DIR="$(mktemp -d)"
PROBE_NS="cost-metrics-probe"
RELEASE="oneuptime-agent"

KC2="http://kubecost-cost-analyzer.kubecost.svc.cluster.local"
KC3="http://kubecost-frontend.kubecost3.svc.cluster.local"
OC="http://opencost.opencost.svc.cluster.local"
FINOPS="http://kubecost-finopsagent.kubecost3.svc"

# Each way of naming an engine: case, cost.engine.url, the target and path the
# agent should hand the collector, and the engine /healthz should name.
CASES="
kc2-frontend|${KC2}:9090|kubecost-cost-analyzer.kubecost.svc.cluster.local:9090|/model/metrics|Kubecost
kc2-costmodel|${KC2}:9003|kubecost-cost-analyzer.kubecost.svc.cluster.local:9003|/metrics|Kubecost
kc3-frontend|${KC3}:9090|kubecost-finopsagent.kubecost3.svc:80|/metrics|Kubecost
opencost-api|${OC}:9003|opencost.opencost.svc.cluster.local:9003|/metrics|OpenCost
opencost-ui|${OC}:9090|opencost.opencost.svc.cluster.local:9090|/model/metrics|OpenCost
"

# Set as the EXIT trap once the cluster is up: harness_start_cluster sets its
# own, which this one replaces and still runs.
cleanup() {
    rm -rf "$WORK_DIR"
    if [ "$HELM_TEST_MANAGED_CLUSTER" != "true" ]; then
        harness_delete_cluster
    fi
}

log() {
    echo "[$(date +%H:%M:%S)] $*"
}

case_namespace() {
    echo "cost-metrics-$1"
}

# --- The engines, from their own charts --------------------------------------

install_engines() {
    cat >"${WORK_DIR}/kubecost2.yaml" <<'EOF'
# The smallest Kubecost 2 that runs its cost model, frontend and aggregator.
global:
  grafana:
    enabled: false
    proxy: false
forecasting:
  enabled: false
diagnostics:
  enabled: false
persistentVolume:
  size: 2Gi
prometheus:
  server:
    global:
      external_labels:
        cluster_id: cost-metrics
    persistentVolume:
      size: 2Gi
    retention: 3d
kubecostProductConfigs:
  clusterName: cost-metrics
EOF
    cat >"${WORK_DIR}/kubecost3.yaml" <<'EOF'
# The smallest Kubecost 3 that runs its frontend, aggregator, local store
# and the finops agent that carries the metrics.
global:
  clusterId: cost-metrics-3
forecasting:
  enabled: false
cloudCost:
  enabled: false
clusterController:
  enabled: false
networkCosts:
  enabled: false
mcp:
  enabled: false
aggregator:
  resources:
    requests:
      memory: 512Mi
      cpu: 100m
  persistentConfigsStorage:
    storageRequest: 1Gi
  aggregatorDbStorage:
    storageRequest: 4Gi
localStore:
  persistentVolume:
    size: 2Gi
EOF

    log "Installing Kubecost ${KUBECOST2_CHART_VERSION}, Kubecost ${KUBECOST3_CHART_VERSION} and OpenCost (chart ${OPENCOST_CHART_VERSION})..."
    helm upgrade --install kubecost cost-analyzer \
        --repo https://kubecost.github.io/cost-analyzer --version "$KUBECOST2_CHART_VERSION" \
        --namespace kubecost --create-namespace -f "${WORK_DIR}/kubecost2.yaml" >/dev/null
    helm upgrade --install kubecost kubecost \
        --repo https://kubecost.github.io/kubecost --version "$KUBECOST3_CHART_VERSION" \
        --namespace kubecost3 --create-namespace -f "${WORK_DIR}/kubecost3.yaml" >/dev/null
    # OpenCost reads the Prometheus Kubecost 2 runs, rather than a third one.
    helm upgrade --install opencost opencost \
        --repo https://opencost.github.io/opencost-helm-chart --version "$OPENCOST_CHART_VERSION" \
        --namespace opencost --create-namespace \
        --set opencost.prometheus.internal.serviceName=kubecost-prometheus-server \
        --set opencost.prometheus.internal.namespaceName=kubecost \
        --set opencost.prometheus.internal.port=80 >/dev/null

    for ns in kubecost kubecost3 opencost; do
        kubectl -n "$ns" wait --for=condition=Ready pod --all --timeout=900s >/dev/null
    done
}

# --- Asking from inside the cluster ------------------------------------------

start_probe() {
    harness_namespace "$PROBE_NS"
    kubectl -n "$PROBE_NS" run curl --image="$CURL_IMAGE" --restart=Never \
        --command -- sleep 86400 >/dev/null 2>&1 || true
    kubectl -n "$PROBE_NS" wait --for=condition=Ready pod/curl --timeout=300s >/dev/null
}

# "<status> <content type>" of a URL, and whether it carries a price series.
ask() {
    # ask <url>
    kubectl -n "$PROBE_NS" exec curl -- sh -c '
        meta=$(curl -sS -m 20 -o /tmp/body -w "%{http_code} %{content_type}" "$1" 2>/dev/null) || meta="000 none"
        if grep -qE "^(node_(cpu|gpu|ram|total)_hourly_cost|pv_hourly_cost|kubecost_cluster_management_cost|kubecost_network_(zone|region|internet)_egress_cost)[{ ]" /tmp/body 2>/dev/null; then
            echo "$meta prices"
        else
            echo "$meta no-prices"
        fi
    ' _ "$1"
}

# "<status> <media type> <prices|no-prices>" of a URL, the type without its
# parameters.
answer_of() {
    # answer_of <url>
    local got
    got="$(ask "$1")"
    printf '%s %s %s' "$(awk '{print $1}' <<<"$got")" \
        "$(awk '{print $2}' <<<"$got" | sed 's/;.*//')" "$(awk '{print $NF}' <<<"$got")"
}

# An engine prices its nodes a little after it is Ready, so a URL is asked
# again for a while before its answer counts.
measure() {
    # measure <description> <url> <expected "status type prices">
    local got deadline=$((SECONDS + 120))
    got="$(answer_of "$2")"
    while [ "$got" != "$3" ] && [ "$SECONDS" -lt "$deadline" ]; do
        sleep 5
        got="$(answer_of "$2")"
    done
    assert_eq "$1" "$3" "$got"
}

measure_engines() {
    log "What each engine's Services answer..."
    measure "Kubecost 2's frontend answers /metrics with its web page" "${KC2}:9090/metrics" "200 text/html no-prices"
    measure "Kubecost 2's frontend passes /model/metrics on to its cost model" "${KC2}:9090/model/metrics" "200 text/plain prices"
    measure "Kubecost 2's cost model serves its prices at /metrics" "${KC2}:9003/metrics" "200 text/plain prices"
    measure "Kubecost 3's frontend answers /metrics with its web page" "${KC3}:9090/metrics" "200 text/html no-prices"
    # Its /model/ is the aggregator, whose /metrics is 404 while it starts and
    # then its own Go runtime series: Prometheus' format, and no price.
    assert_eq "Kubecost 3's frontend has no price series at /model/metrics (its /model/ is the aggregator)" \
        "no-prices" "$(answer_of "${KC3}:9090/model/metrics" | awk '{print $NF}')"
    measure "Kubecost 3's finops agent serves the prices at /metrics" "${FINOPS}:80/metrics" "200 text/plain prices"
    measure "OpenCost's API serves its prices at /metrics" "${OC}:9003/metrics" "200 text/plain prices"
    measure "OpenCost's UI answers /metrics with its web page" "${OC}:9090/metrics" "200 text/html no-prices"
    measure "OpenCost's UI passes /model/metrics on to its API" "${OC}:9090/model/metrics" "200 text/plain prices"
}

# --- This checkout's cost agent, behind the chart's Service --------------------

build_agent() {
    log "Building the cost agent from this checkout..."
    (cd "$AGENT_DIR" && npm ci --prefer-offline --no-audit --no-fund >/dev/null && npm run compile >/dev/null)
    mkdir -p "${WORK_DIR}/dist"
    cp "${AGENT_DIR}"/build/dist/*.js "${WORK_DIR}/dist/"
}

render_chart() {
    # render_chart <namespace> <template> [helm --set arguments...]
    local ns="$1" template="$2"
    shift 2
    helm template "$RELEASE" "$KUBERNETES_AGENT_CHART_DIR" --namespace "$ns" \
        --set clusterName=cost-metrics \
        --set oneuptime.url=http://127.0.0.1:9 \
        --set oneuptime.apiKey=cost-metrics \
        --set cost.metrics.scrapeInterval=15s \
        --show-only "$template" "$@"
}

start_agents() {
    local name url ns
    # Read Services across the cluster, as the chart's ClusterRole lets the
    # agent do.
    kubectl apply -f - >/dev/null <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: cost-metrics-agent
rules:
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["get", "list", "watch"]
EOF

    while IFS='|' read -r name url _ _ _; do
        [ -n "$name" ] || continue
        ns="$(case_namespace "$name")"
        harness_namespace "$ns"
        kubectl -n "$ns" create configmap cost-agent-dist --from-file="${WORK_DIR}/dist" \
            --dry-run=client -o yaml | kubectl apply -f - >/dev/null
        kubectl -n "$ns" create serviceaccount cost-agent --dry-run=client -o yaml | kubectl apply -f - >/dev/null
        kubectl create clusterrolebinding "cost-metrics-agent-${name}" --clusterrole=cost-metrics-agent \
            --serviceaccount="${ns}:cost-agent" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

        # The Service the chart renders for the agent, as rendered.
        render_chart "$ns" templates/service-cost-agent.yaml --set "cost.engine.url=${url}" \
            | kubectl apply -f - >/dev/null

        # The agent, labelled as the chart labels it, so that Service finds it.
        # Replaced on every run, so a kept cluster runs this checkout's code.
        kubectl -n "$ns" delete deployment cost-agent --ignore-not-found --wait=true >/dev/null 2>&1 || true
        kubectl apply -f - >/dev/null <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cost-agent
  namespace: ${ns}
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: kubernetes-agent
      app.kubernetes.io/instance: ${RELEASE}
      component: cost-agent
  template:
    metadata:
      labels:
        app.kubernetes.io/name: kubernetes-agent
        app.kubernetes.io/instance: ${RELEASE}
        component: cost-agent
    spec:
      serviceAccountName: cost-agent
      containers:
        - name: cost-agent
          image: ${NODE_IMAGE}
          command: ["node", "/app/Index.js"]
          env:
            - { name: ONEUPTIME_URL, value: "http://127.0.0.1:9" }
            - { name: ONEUPTIME_API_KEY, value: "cost-metrics" }
            - { name: CLUSTER_NAME, value: "cost-metrics" }
            - { name: COST_ENGINE_URL, value: "${url}" }
            - { name: HEALTH_PORT, value: "13134" }
          ports:
            - { name: health, containerPort: 13134 }
          volumeMounts:
            - { name: dist, mountPath: /app }
      volumes:
        - name: dist
          configMap:
            name: cost-agent-dist
EOF
    done <<<"$CASES"

    while IFS='|' read -r name _ _ _ _; do
        [ -n "$name" ] || continue
        kubectl -n "$(case_namespace "$name")" rollout status deploy/cost-agent --timeout=300s >/dev/null
    done <<<"$CASES"
}

# What the agent behind the chart's Service answers, at the address the
# chart's cost-engine job asks.
scrape_targets_of() {
    # scrape_targets_of <case>
    kubectl -n "$PROBE_NS" exec curl -- curl -s -m 10 \
        "http://${RELEASE}-kubernetes-agent-cost.$(case_namespace "$1").svc.cluster.local:13134/scrape-targets" 2>/dev/null || true
}

check_agents() {
    local name expected_target expected_path expected_engine got deadline healthz
    log "Asking each agent where the price metrics are..."
    # Each looks when it starts, then every minute until it finds them.
    deadline=$((SECONDS + 180))
    while IFS='|' read -r name _ _ _ _; do
        [ -n "$name" ] || continue
        until [ "$SECONDS" -ge "$deadline" ]; do
            got="$(scrape_targets_of "$name")"
            [ -n "$got" ] && [ "$got" != "[]" ] && break
            sleep 5
        done
    done <<<"$CASES"

    while IFS='|' read -r name _ expected_target expected_path expected_engine; do
        [ -n "$name" ] || continue
        assert_eq "${name}: the agent hands the collector the engine's price metrics" \
            "[{\"targets\":[\"${expected_target}\"],\"labels\":{\"__scheme__\":\"http\",\"__metrics_path__\":\"${expected_path}\"}}]" \
            "$(scrape_targets_of "$name")"
        healthz="$(kubectl -n "$PROBE_NS" exec curl -- curl -s -m 10 \
            "http://${RELEASE}-kubernetes-agent-cost.$(case_namespace "$name").svc.cluster.local:13134/healthz" 2>/dev/null || true)"
        assert_present "${name}: /healthz names the engine as ${expected_engine}" "$healthz" "\"engine\":\"${expected_engine}\""
    done <<<"$CASES"
}

# --- The chart's cost-engine job, in the chart's collector ---------------------

# The cost-engine job of a rendered deployment collector configuration, at
# column 0 and renamed, for a scrape_configs list of its own.
cost_engine_job() {
    # cost_engine_job <rendered configmap file> <new job name>
    # The job is `- job_name: cost-engine` at 12 spaces in the rendered
    # ConfigMap, and ends at the next line indented 12 or less.
    awk -v name="$2" '
        $0 == "            - job_name: cost-engine" { injob = 1; print "- job_name: " name; next }
        injob {
            match($0, /^ */)
            if (RLENGTH < length($0) && RLENGTH <= 12) { injob = 0; next }
            print substr($0, 13)
        }
    ' "$1"
}

start_collector() {
    local name url ns image
    image="$(awk '/^image:/ { f = 1; next } f && /repository:/ { r = $2 } f && /tag:/ { gsub(/"/, "", $2); t = $2; exit } END { print r ":" t }' \
        "${KUBERNETES_AGENT_CHART_DIR}/values.yaml")"

    {
        echo "receivers:"
        echo "  prometheus:"
        echo "    config:"
        echo "      scrape_configs:"
        while IFS='|' read -r name url _ _ _; do
            [ -n "$name" ] || continue
            ns="$(case_namespace "$name")"
            render_chart "$ns" templates/configmap-deployment.yaml --set "cost.engine.url=${url}" >"${WORK_DIR}/${name}.yaml"
            cost_engine_job "${WORK_DIR}/${name}.yaml" "$name" | sed 's/^/        /'
        done <<<"$CASES"
        # What the chart rendered before the fix: the agent off, the URL's
        # /metrics. Kubecost 2's frontend, the URL the docs gave.
        render_chart "$(case_namespace kc2-frontend)" templates/configmap-deployment.yaml \
            --set "cost.engine.url=${KC2}:9090" --set cost.agent.enabled=false >"${WORK_DIR}/without-agent.yaml"
        cost_engine_job "${WORK_DIR}/without-agent.yaml" "kc2-frontend-without-agent" | sed 's/^/        /'
        echo "exporters:"
        echo "  debug:"
        echo "    verbosity: detailed"
        echo "service:"
        echo "  pipelines:"
        echo "    metrics:"
        echo "      receivers: [prometheus]"
        echo "      exporters: [debug]"
    } >"${WORK_DIR}/collector.yaml"

    kubectl -n "$PROBE_NS" delete pod collector --ignore-not-found --wait=true >/dev/null 2>&1 || true
    kubectl -n "$PROBE_NS" create configmap collector --from-file=config.yaml="${WORK_DIR}/collector.yaml" \
        --dry-run=client -o yaml | kubectl apply -f - >/dev/null
    kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: collector
  namespace: ${PROBE_NS}
spec:
  containers:
    - name: otelcol
      image: ${image}
      args: ["--config=/conf/config.yaml"]
      volumeMounts:
        - { name: conf, mountPath: /conf }
  volumes:
    - name: conf
      configMap:
        name: collector
EOF
    kubectl -n "$PROBE_NS" wait --for=condition=Ready pod/collector --timeout=300s >/dev/null
}

# The price families a job's scrapes put through the pipeline, one per line.
price_families_of() {
    # price_families_of <collector log> <job>
    awk -v job="$2" '
        /service.name: Str\(/ { match($0, /Str\([^)]*\)/); current = substr($0, RSTART + 4, RLENGTH - 5) }
        current == job && /-> Name: / { n = $0; sub(/.*-> Name: /, "", n); if (n !~ /^(up|scrape_)/) print n }
    ' "$1" | sort -u
}

check_collector() {
    local name deadline log_file families
    log_file="${WORK_DIR}/collector.log"
    log "Letting the collector scrape every job..."
    deadline=$((SECONDS + COLLECT_SECONDS))
    until [ "$SECONDS" -ge "$deadline" ]; do
        kubectl -n "$PROBE_NS" logs collector >"$log_file" 2>/dev/null || true
        local missing=0
        while IFS='|' read -r name _ _ _ _; do
            [ -n "$name" ] || continue
            [ -n "$(price_families_of "$log_file" "$name")" ] || missing=$((missing + 1))
        done <<<"$CASES"
        grep -q 'Failed to scrape Prometheus endpoint' "$log_file" || missing=$((missing + 1))
        [ "$missing" -eq 0 ] && break
        sleep 5
    done

    while IFS='|' read -r name _ _ _ _; do
        [ -n "$name" ] || continue
        families="$(price_families_of "$log_file" "$name" | grep -c . || true)"
        if [ "${families:-0}" -gt 0 ]; then
            pass "${name}: the chart's cost-engine job scrapes ${families} price series families"
        else
            fail "${name}: the chart's cost-engine job scraped no price series"
        fi
    done <<<"$CASES"

    assert_eq "kc2-frontend-without-agent: scraping the frontend's /metrics gets no price series (the bug)" \
        "" "$(price_families_of "$log_file" kc2-frontend-without-agent)"
    if grep -q 'Failed to scrape Prometheus endpoint.*expected a valid start token, got \\"<\\"' "$log_file"; then
        pass "kc2-frontend-without-agent: the collector cannot parse the web page it gets"
    else
        fail "kc2-frontend-without-agent: no parse failure on the web page in the collector's log"
    fi
}

# --- Run --------------------------------------------------------------------

for tool in docker node npm; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        fail "${tool} is not installed; this suite needs it (see the header)"
        harness_report
        exit 1
    fi
done

harness_start_cluster
trap cleanup EXIT

install_engines
start_probe
measure_engines
build_agent
start_agents
check_agents
start_collector
check_collector

harness_report
