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
# checkout), python3 (it reads the engines' answers), and network access to
# the engines' chart repositories and registries (kubecost.github.io,
# opencost.github.io, icr.io, ghcr.io, quay.io and Docker Hub).
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
#
# Then what the agent reads beside the allocations, from the same engines,
# and the allocations themselves: a Kubecost's /model/allocation answers per
# namespace unless asked per container, which the agent does.
#
#   4. The Prometheus each engine reads, for memory right-sizing (#9777):
#      Kubecost 2's (from its ConfigMap) and OpenCost's (its
#      PROMETHEUS_SERVER_ENDPOINT, here Kubecost 2's Prometheus), as /healthz
#      names it, and the peaks the agent's own query reads there. Kubecost 3
#      reads none, which /healthz says plainly, and beside the chart's bundled
#      Prometheus the agent reads that one instead. An OpenCost agent on
#      five-minute windows ships to a stand-in for OneUptime, whose log shows
#      the rows arriving with their memory peaks.
#   5. Where each engine's prices come from (#9851), as /healthz says it:
#      Kubecost 3 too, from its aggregator's own APIs, once the aggregator has
#      collected the cluster.
#   6. The chart's default install (#9852): its bundled OpenCost and
#      Prometheus as the chart renders them, and this checkout's agent, which
#      reads Kubecost 2 instead. The cost-engine job the chart renders asks
#      the agent, and scrapes Kubecost's prices; the job it rendered before
#      the fix scrapes the bundled OpenCost's, beside Kubecost's allocations.
#      The OpenCost agent's shipment says where its memory peaks come from
#      (#9970): the Prometheus its engine reads.
#   7. A later reading of a closed hour (#9969), what the agent's corrections
#      of a Kubecost's reconciled hours rest on: asked again for an hour,
#      each engine answers for that hour alone (whole, or short of its end
#      just after it closes), names each container once and every container
#      it named before, and for an hour from before the cluster existed
#      answers with nothing, which the agent takes as nothing to correct with.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

KUBECOST2_CHART_VERSION="${KUBECOST2_CHART_VERSION:-2.8.7}"
KUBECOST3_CHART_VERSION="${KUBECOST3_CHART_VERSION:-3.3.2}"
OPENCOST_CHART_VERSION="${OPENCOST_CHART_VERSION:-2.5.34}"
NODE_IMAGE="${NODE_IMAGE:-node:26-alpine}"
CURL_IMAGE="${CURL_IMAGE:-curlimages/curl:8.11.1}"
# How long the collector is given to scrape every job at least once.
COLLECT_SECONDS="${COLLECT_SECONDS:-150}"
# How long Kubecost 3's aggregator is given to collect the cluster and answer
# for its allocations: it says nothing of it, its prices included, until then
# (about twenty minutes).
KUBECOST3_COLLECT_SECONDS="${KUBECOST3_COLLECT_SECONDS:-2400}"
# How long the five-minute OpenCost agent is given to ship a window.
SHIP_SECONDS="${SHIP_SECONDS:-600}"

REPO_DIR="$(cd "${TESTS_DIR}/../.." && pwd)"
AGENT_DIR="${REPO_DIR}/agents/KubernetesCostAgent"
WORK_DIR="$(mktemp -d)"
PROBE_NS="cost-metrics-probe"
BUNDLED_NS="cost-metrics-bundled"
RELEASE="oneuptime-agent"
# Where the agents ship: a stand-in for OneUptime that logs what arrives.
SINK_URL="http://cost-sink.${PROBE_NS}.svc.cluster.local:8080"
BUNDLED_PROMETHEUS="http://${RELEASE}-kubernetes-agent-cost-prometheus.${BUNDLED_NS}.svc.cluster.local:9090"
KC2_PROMETHEUS="http://kubecost-prometheus-server.kubecost"

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

# The Prometheus each case's agent reads memory peaks from (#9777): its
# address, or, after "error:", what /healthz says instead. OpenCost reads
# Kubecost 2's Prometheus in this suite (install_engines).
PROMETHEUS_CASES="
kc2-frontend|${KC2_PROMETHEUS}
kc2-costmodel|${KC2_PROMETHEUS}
kc3-frontend|error:Kubecost 3 reads no Prometheus
opencost-api|${KC2_PROMETHEUS}.svc.cluster.local:80
opencost-ui|${KC2_PROMETHEUS}.svc.cluster.local:80
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

# A stand-in for OneUptime's cost ingest: it takes every shipment and logs,
# one JSON line each, the window, how many rows came, how many carried a
# memory peak, and what the agent said priced them.
start_sink() {
    kubectl apply -f - >/dev/null <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cost-sink
  namespace: ${PROBE_NS}
spec:
  replicas: 1
  selector:
    matchLabels: { app: cost-sink }
  template:
    metadata:
      labels: { app: cost-sink }
    spec:
      containers:
        - name: sink
          image: ${NODE_IMAGE}
          command: ["node", "-e"]
          args:
            - |
              require("http").createServer((req, res) => {
                const chunks = [];
                req.on("data", (c) => chunks.push(c));
                req.on("end", () => {
                  try {
                    const p = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                    const rows = p.allocations || [];
                    console.log(JSON.stringify({
                      cluster: p.clusterName,
                      window: rows[0] ? rows[0].windowStart : "",
                      rows: rows.length,
                      withPeak: rows.filter((r) => r.ramBytesUsageMax > 0).length,
                      costEngine: p.costEngine || null,
                    }));
                  } catch (e) {
                    console.log(JSON.stringify({ error: String(e) }));
                  }
                  res.writeHead(200, { "Content-Type": "application/json" });
                  res.end("{}");
                });
              }).listen(8080);
          ports:
            - { containerPort: 8080 }
---
apiVersion: v1
kind: Service
metadata:
  name: cost-sink
  namespace: ${PROBE_NS}
spec:
  selector: { app: cost-sink }
  ports:
    - { port: 8080, targetPort: 8080 }
EOF
    kubectl -n "$PROBE_NS" rollout status deploy/cost-sink --timeout=300s >/dev/null
}

# Kubecost 3 says nothing of a cluster, its prices included, until its
# aggregator has collected it, and its Allocation API answers with nothing
# for a few minutes more (on a fresh kind cluster, /model/allocation was
# still empty when /model/clusters/status first listed it): wait for both
# before any agent reads it.
wait_for_kubecost3_collection() {
    local deadline=$((SECONDS + KUBECOST3_COLLECT_SECONDS)) clusters="" rows=""
    log "Waiting for Kubecost 3's aggregator to collect the cluster..."
    until [ "$SECONDS" -ge "$deadline" ]; do
        clusters="$(kubectl -n "$PROBE_NS" exec curl -- curl -s -m 15 \
            "${KC3}:9090/model/clusters/status?window=2d" 2>/dev/null || true)"
        grep -q '"id":"cost-metrics-3"' <<<"$clusters" && break
        sleep 20
    done
    assert_present "Kubecost 3's aggregator has collected the cluster (/model/clusters/status)" "$clusters" '"provider":"custom"'
    # measure_allocation_grouping says what it answered in the end.
    until [ "$SECONDS" -ge "$deadline" ]; do
        rows="$(allocation_rows "${KC3}:9090/model/allocation?window=2d&accumulate=true")"
        [ "${rows% *}" -gt 0 ] 2>/dev/null && break
        sleep 20
    done
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

# "<rows> <rows naming a container>" of an Allocation API answer.
allocation_rows() {
    # allocation_rows <url>
    kubectl -n "$PROBE_NS" exec curl -- curl -s -m 60 "$1" 2>/dev/null | python3 -I -c '
import json, sys
try:
    data = json.load(sys.stdin).get("data") or []
except ValueError:
    data = []
rows = [row for group in data if group for row in group.values()]
named = [row for row in rows if (row.get("properties") or {}).get("container")]
print(len(rows), len(named))'
}

# A Kubecost's aggregator answers /model/allocation per namespace unless it
# is told to group by each container (CONTAINER_AGGREGATE in the agent's
# CostEngineClient): a Kubecost that changes that fails here first.
measure_allocation_grouping() {
    local name url rows
    log "How each Kubecost groups its Allocation API's answer..."
    for name in kubecost2 kubecost3; do
        url="${KC2}:9090"
        [ "$name" = kubecost3 ] && url="${KC3}:9090"
        rows="$(allocation_rows "${url}/model/allocation?window=2d&accumulate=true")"
        if [ "${rows#* }" = "0" ] && [ "${rows% *}" -gt 0 ] 2>/dev/null; then
            pass "${name}: /model/allocation, asked nothing, answers ${rows% *} rows per namespace, none naming a container"
        else
            fail "${name}: /model/allocation, asked nothing, was expected per namespace (rows, rows naming a container: ${rows})"
        fi
        rows="$(allocation_rows "${url}/model/allocation?window=2d&accumulate=true&aggregate=cluster,node,namespace,controllerKind,controller,pod,container")"
        if [ "${rows#* }" -gt 0 ] 2>/dev/null; then
            pass "${name}: asked per container, it answers ${rows#* } rows naming their container"
        else
            fail "${name}: asked per container, it named no container (rows, rows naming a container: ${rows})"
        fi
    done
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

# Run this checkout's agent, behind the Service the chart renders for it.
deploy_agent() {
    # deploy_agent <case> <cost.engine.url> [extra env entries, one per line]
    local name="$1" url="$2" extra="${3:-}" ns
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
            - { name: ONEUPTIME_URL, value: "${SINK_URL}" }
            - { name: ONEUPTIME_API_KEY, value: "cost-metrics" }
            - { name: CLUSTER_NAME, value: "cost-metrics" }
            - { name: COST_ENGINE_URL, value: "${url}" }
            - { name: HEALTH_PORT, value: "13134" }
$(sed 's/^/            /' <<<"$extra")
          ports:
            - { name: health, containerPort: 13134 }
          volumeMounts:
            - { name: dist, mountPath: /app }
      volumes:
        - name: dist
          configMap:
            name: cost-agent-dist
EOF
}

start_agents() {
    local name url extra
    # Read Services across the cluster, and the pods and ConfigMaps that name
    # an engine's Prometheus (#9777), as the chart's ClusterRole lets the
    # agent do.
    kubectl apply -f - >/dev/null <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: cost-metrics-agent
rules:
  - apiGroups: [""]
    resources: ["services", "pods", "configmaps"]
    verbs: ["get", "list", "watch"]
EOF

    while IFS='|' read -r name url _ _ _; do
        [ -n "$name" ] || continue
        extra=""
        # Five-minute windows, which OpenCost prices from its Prometheus on
        # the spot: a shipment, memory peaks and all, within minutes.
        if [ "$name" = "opencost-api" ]; then
            extra="- { name: WINDOW_SECONDS, value: \"300\" }
- { name: POLL_INTERVAL_SECONDS, value: \"20\" }
- { name: ENGINE_SETTLE_SECONDS, value: \"30\" }
- { name: LOOKBACK_WINDOWS, value: \"1\" }"
        fi
        deploy_agent "$name" "$url" "$extra"
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

healthz_of() {
    # healthz_of <case namespace>
    kubectl -n "$PROBE_NS" exec curl -- curl -s -m 10 \
        "http://${RELEASE}-kubernetes-agent-cost.${1}.svc.cluster.local:13134/healthz" 2>/dev/null || true
}

# The /healthz of a case once it carries a needle, or as it is at the deadline.
healthz_with() {
    # healthz_with <case namespace> <needle> <seconds>
    local deadline=$((SECONDS + $3)) got=""
    until [ "$SECONDS" -ge "$deadline" ]; do
        got="$(healthz_of "$1")"
        grep -qF -- "$2" <<<"$got" && break
        sleep 5
    done
    printf '%s' "$got"
}

# --- Memory peaks from the engine's own Prometheus (#9777) --------------------

check_prometheus() {
    local name expected healthz
    log "Asking each agent which Prometheus it reads memory peaks from..."
    while IFS='|' read -r name expected; do
        [ -n "$name" ] || continue
        case "$expected" in
            error:*)
                healthz="$(healthz_with "$(case_namespace "$name")" "${expected#error:}" 240)"
                assert_present "${name}: /healthz says plainly why there is no Prometheus" "$healthz" "${expected#error:}"
                assert_absent "${name}: and names none" "$healthz" '"costPrometheusUrl"'
                ;;
            *)
                healthz="$(healthz_with "$(case_namespace "$name")" "\"costPrometheusUrl\":\"${expected}\"" 240)"
                assert_present "${name}: reads memory peaks from the Prometheus the engine reads (${expected})" "$healthz" "\"costPrometheusUrl\":\"${expected}\""
                assert_present "${name}: found as the engine's own, its cAdvisor job read off it" "$healthz" '"origin":"engine","source":'
                assert_present "${name}: at the job Kubecost's Prometheus scrapes cAdvisor under" "$healthz" '"cadvisorJob":"kubernetes-nodes-cadvisor"'
                ;;
        esac
    done <<<"$PROMETHEUS_CASES"
}

# The agent's own peak query, against the Prometheus its /healthz names: the
# containers with a memory peak over the last ten minutes.
check_peaks() {
    local ns peaks
    ns="$(case_namespace kc2-frontend)"
    peaks="$(kubectl -n "$ns" exec deploy/cost-agent -- node -e '
        const http = require("http");
        http.get("http://127.0.0.1:13134/healthz", (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", async () => {
                const health = JSON.parse(body);
                const { PrometheusClient } = require("/app/PrometheusClient.js");
                const prometheus = {
                    url: health.costPrometheusUrl,
                    origin: health.costPrometheus.origin,
                    source: health.costPrometheus.source,
                    cadvisorJob: health.costPrometheus.cadvisorJob,
                    cluster: health.costPrometheus.cluster || null,
                    note: "",
                };
                const client = new PrometheusClient({
                    current: () => prometheus,
                    reason: () => "",
                    refreshIfDue: async () => {},
                });
                const end = new Date(Math.floor(Date.now() / 60000) * 60000);
                const peaks = await client.fetchMemoryPeaks({
                    windowStart: new Date(end.getTime() - 600000),
                    windowEnd: end,
                });
                console.log(peaks.size);
            });
        });
    ' 2>/dev/null | tail -n 1)"
    if [ "${peaks:-0}" -gt 0 ] 2>/dev/null; then
        pass "kc2-frontend: the agent's peak query reads ${peaks} containers' memory peaks from Kubecost's Prometheus"
    else
        fail "kc2-frontend: the agent's peak query read no memory peak from Kubecost's Prometheus (got '${peaks}')"
    fi
}

# The sink's log lines from the five-minute OpenCost agent.
shipments_of_opencost() {
    kubectl -n "$PROBE_NS" logs deploy/cost-sink 2>/dev/null \
        | grep -F '"engine":"OpenCost"' | grep -F '"window":' || true
}

# A shipment, end to end: the rows reach the stand-in for OneUptime with
# their memory peaks, and say where their prices come from.
check_shipment() {
    local deadline=$((SECONDS + SHIP_SECONDS)) shipment=""
    log "Waiting for the five-minute OpenCost agent to ship a window..."
    until [ "$SECONDS" -ge "$deadline" ]; do
        shipment="$(shipments_of_opencost | grep -vF '"withPeak":0,' | tail -n 1)"
        [ -n "$shipment" ] && break
        sleep 10
    done
    if [ -n "$shipment" ]; then
        pass "opencost-api: a shipped window's rows carry memory peaks from the Prometheus OpenCost reads ($(grep -oE '"rows":[0-9]+,"withPeak":[0-9]+' <<<"$shipment"))"
        assert_present "opencost-api: and say OpenCost's default rates priced them" "$shipment" '"pricingSource":"default-rates"'
        # #9970: and where those peaks come from, the Prometheus the engine
        # reads, which the note on stopping the bundled engine reads.
        assert_present "opencost-api: and say their memory peaks come from the engine's own Prometheus" "$shipment" '"memoryPeaksFrom":"engine"'
    else
        fail "opencost-api: no shipment with memory peaks reached the stand-in for OneUptime"
        shipments_of_opencost | tail -n 3 | sed 's/^/        /'
    fi
}

# --- Where each engine's prices come from (#9851) ------------------------------

check_pricing() {
    local name healthz
    log "Asking each agent where its engine's prices come from..."
    for name in kc2-frontend kc3-frontend opencost-api; do
        healthz="$(healthz_with "$(case_namespace "$name")" '"pricingSource":"default-rates"' 300)"
        assert_present "${name}: /healthz says the engine prices this kind cluster at its default rates" "$healthz" '"pricingSource":"default-rates"'
    done
}

# --- The chart's default install: the bundled engine beside Kubecost (#9852) ---

# The chart's bundled OpenCost and Prometheus, its RBAC, API key Secret,
# agent Service and agent, as `helm template` renders them with no cost
# values set; the agent runs this checkout's code (the chart's image would be
# the released agent's).
start_bundled() {
    local rendered="${WORK_DIR}/bundled.yaml" agent="${WORK_DIR}/bundled-agent.yaml"
    log "Installing the chart's bundled cost engine beside them..."
    harness_namespace "$BUNDLED_NS"
    kubectl -n "$BUNDLED_NS" create configmap cost-agent-dist --from-file="${WORK_DIR}/dist" \
        --dry-run=client -o yaml | kubectl apply -f - >/dev/null
    render_chart "$BUNDLED_NS" templates/opencost.yaml \
        --show-only templates/prometheus-cost.yaml \
        --show-only templates/rbac.yaml \
        --show-only templates/secret.yaml \
        --show-only templates/service-cost-agent.yaml >"$rendered"
    kubectl apply -f "$rendered" >/dev/null
    render_chart "$BUNDLED_NS" templates/deployment-cost-agent.yaml \
        --set "oneuptime.url=${SINK_URL}" >"$agent"
    kubectl -n "$BUNDLED_NS" delete deployment "${RELEASE}-kubernetes-agent-cost" \
        --ignore-not-found --wait=true >/dev/null 2>&1 || true
    kubectl patch --local -f "$agent" --type=json -o yaml -p "[
        {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/image\", \"value\": \"${NODE_IMAGE}\"},
        {\"op\": \"add\", \"path\": \"/spec/template/spec/containers/0/command\", \"value\": [\"node\", \"/app/Index.js\"]},
        {\"op\": \"add\", \"path\": \"/spec/template/spec/containers/0/volumeMounts\", \"value\": [{\"name\": \"dist\", \"mountPath\": \"/app\"}]},
        {\"op\": \"add\", \"path\": \"/spec/template/spec/volumes\", \"value\": [{\"name\": \"dist\", \"configMap\": {\"name\": \"cost-agent-dist\"}}]}
    ]" | kubectl apply -f - >/dev/null
    for deploy in opencost cost-prometheus cost; do
        kubectl -n "$BUNDLED_NS" rollout status "deploy/${RELEASE}-kubernetes-agent-${deploy}" --timeout=600s >/dev/null
    done

    # Kubecost 3 beside the bundled Prometheus: no Prometheus of its own.
    deploy_agent kc3-bundled-prometheus "${KC3}:9090" "- { name: COST_PROMETHEUS_URL, value: \"${BUNDLED_PROMETHEUS}\" }
- { name: COST_PROMETHEUS_BUNDLED, value: \"true\" }"
    kubectl -n "$(case_namespace kc3-bundled-prometheus)" rollout status deploy/cost-agent --timeout=300s >/dev/null
}

check_bundled() {
    local healthz targets
    log "Asking the bundled install's agent which engine it reads..."
    healthz="$(healthz_with "$BUNDLED_NS" '"bundledEngineUnused":true' 240)"
    assert_present "bundled: the agent reads the cluster's own Kubecost instead of the bundled OpenCost" "$healthz" '"engine":"Kubecost","service":"kubecost/kubecost-cost-analyzer","bundledEngineUnused":true'
    healthz="$(healthz_with "$BUNDLED_NS" "\"costPrometheusUrl\":\"${KC2_PROMETHEUS}\"" 240)"
    assert_present "bundled: and reads memory peaks from Kubecost's own Prometheus" "$healthz" "\"costPrometheusUrl\":\"${KC2_PROMETHEUS}\""

    # It looks where the engine it reads serves them once it reads it, within
    # a minute.
    local deadline=$((SECONDS + 180))
    until [ "$SECONDS" -ge "$deadline" ]; do
        targets="$(kubectl -n "$PROBE_NS" exec curl -- curl -s -m 10 \
            "http://${RELEASE}-kubernetes-agent-cost.${BUNDLED_NS}.svc.cluster.local:13134/scrape-targets" 2>/dev/null || true)"
        grep -q 'kubecost-cost-analyzer' <<<"$targets" && break
        sleep 5
    done
    assert_eq "bundled: the agent hands the collector Kubecost's price metrics, not the bundled OpenCost's" \
        '[{"targets":["kubecost-cost-analyzer.kubecost.svc:9090"],"labels":{"__scheme__":"http","__metrics_path__":"/model/metrics"}}]' \
        "$targets"

    healthz="$(healthz_with "$(case_namespace kc3-bundled-prometheus)" "\"costPrometheusUrl\":\"${BUNDLED_PROMETHEUS}\"" 240)"
    assert_present "kc3-bundled-prometheus: Kubecost 3's memory peaks come from the bundled Prometheus" "$healthz" "\"costPrometheusUrl\":\"${BUNDLED_PROMETHEUS}\""
    assert_present "kc3-bundled-prometheus: and /healthz says why" "$healthz" "Kubecost 3 reads no Prometheus"
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
        # The chart's default install (#9852), whose agent reads Kubecost 2:
        # the job it renders now, and the one it rendered before the fix (as
        # preferExisting=false still renders it), the bundled OpenCost's
        # static target.
        render_chart "$BUNDLED_NS" templates/configmap-deployment.yaml >"${WORK_DIR}/bundled-job.yaml"
        cost_engine_job "${WORK_DIR}/bundled-job.yaml" "bundled" | sed 's/^/        /'
        render_chart "$BUNDLED_NS" templates/configmap-deployment.yaml \
            --set cost.engine.preferExisting=false >"${WORK_DIR}/bundled-before.yaml"
        cost_engine_job "${WORK_DIR}/bundled-before.yaml" "bundled-before" | sed 's/^/        /'
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

# The address a job scraped its prices from: its service.instance.id.
instance_of() {
    # instance_of <collector log> <job>
    awk -v job="$2" '
        /service.name: Str\(/ { match($0, /Str\([^)]*\)/); current = substr($0, RSTART + 4, RLENGTH - 5); next }
        current == job && /service.instance.id: Str\(/ { match($0, /Str\([^)]*\)/); print substr($0, RSTART + 4, RLENGTH - 5) }
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
        for name in bundled bundled-before; do
            [ -n "$(price_families_of "$log_file" "$name")" ] || missing=$((missing + 1))
        done
        grep -q 'Failed to scrape Prometheus endpoint' "$log_file" || missing=$((missing + 1))
        [ "$missing" -eq 0 ] && break
        sleep 5
    done

    # #9852: the default install's job scrapes the prices of the engine its
    # agent reads; the job it rendered before scraped the bundled OpenCost's.
    families="$(price_families_of "$log_file" bundled | grep -c . || true)"
    if [ "${families:-0}" -gt 0 ]; then
        pass "bundled: the default install's cost-engine job scrapes ${families} price series families"
    else
        fail "bundled: the default install's cost-engine job scraped no price series"
    fi
    assert_eq "bundled: from Kubecost, the engine its agent reads" \
        "kubecost-cost-analyzer.kubecost.svc:9090" "$(instance_of "$log_file" bundled)"
    assert_eq "bundled-before: the job rendered before the fix scraped the bundled OpenCost's prices instead (the bug)" \
        "${RELEASE}-kubernetes-agent-opencost.${BUNDLED_NS}.svc.cluster.local:9003" "$(instance_of "$log_file" bundled-before)"

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

# --- A later reading of a closed hour (#9969) ----------------------------------
#
# The cost agent reads again each hour a Kubecost that reads the cloud's bill
# priced, 36 hours, 47 hours and four days after it closed, and brings what
# OneUptime holds in line with it container by container. No Kubecost reads a bill on kind, so this measures
# what that rests on, by this checkout's CostEngineClient and
# readingCoversWindow, in an agent's pod:
#
#   - asked again for a closed hour, an engine answers for that hour and no
#     wider (a day's set would be taken for the hour, 24 times over);
#   - it names each container once, and every container it named the first
#     time (a correction is made per container, and one that vanished from a
#     later reading is left as it was);
#   - asked for an hour it holds nothing of, here one before this cluster
#     existed, as an hour past Kubecost's hourly figures would be, it answers
#     with nothing, which leaves the hour as OneUptime has it.

READING_CASES="kc2-frontend kc3-frontend opencost-api"
# How long apart the two readings of the hour are.
REREAD_SECONDS="${REREAD_SECONDS:-300}"
# How long to wait for a closed hour every engine has rows for: on a fresh
# cluster, the first hour that closes after the engines start, and the hour
# or so a Kubecost's aggregator may take to collect it.
CLOSED_HOUR_WAIT_SECONDS="${CLOSED_HOUR_WAIT_SECONDS:-5400}"

# The agent's own reading of one hour of a case's engine, as JSON: its rows,
# how many lie within the hour, its distinct containers, readingCoversWindow's
# verdict (null when whole) and the containers, sorted; or the error the
# engine answered with. The agent's log lines go to stdout too, so the reading
# is the line marked READING.
later_reading() {
    # later_reading <case> <window start, epoch ms>
    local url
    url="$(awk -F'|' -v name="$1" '$1 == name {print $2}' <<<"$CASES")"
    kubectl -n "$(case_namespace "$1")" exec deploy/cost-agent -- env LOG_LEVEL=error node -e '
const { CostEngineClient } = require("/app/CostEngineClient.js");
const { readingCoversWindow } = require("/app/CostEngineResolver.js");
const [url, startMs] = process.argv.slice(1);
const windowStart = new Date(Number(startMs));
const windowEnd = new Date(Number(startMs) + 3600000);
const bound = (allocation, key) => {
  return Date.parse((allocation.window && allocation.window[key]) || allocation[key] || "");
};
new CostEngineClient({ baseUrl: url })
  .fetchAllocations({ windowStart, windowEnd })
  .then((allocations) => {
    const within = allocations.filter((allocation) => {
      const start = bound(allocation, "start");
      const end = bound(allocation, "end");
      return (!Number.isFinite(start) || start >= windowStart.getTime() - 60000) &&
        (!Number.isFinite(end) || end <= windowEnd.getTime() + 60000);
    }).length;
    const containers = allocations.map((allocation) => {
      const p = allocation.properties || {};
      return [p.namespace, p.controllerKind, p.controller, p.pod, p.container].map((part) => part || "").join("/");
    }).sort();
    console.log("READING " + JSON.stringify({
      rows: allocations.length,
      within,
      distinct: new Set(containers).size,
      verdict: readingCoversWindow({ allocations, windowStart, windowEnd, clusterId: "" }),
      containers,
    }));
  })
  .catch((err) => {
    console.log("READING " + JSON.stringify({ error: String((err && err.message) || err) }));
  });
' "$url" "$2" 2>/dev/null | sed -n 's/^READING //p' | tail -n 1 || true
}

# One field of a reading, for the checks below.
reading_field() {
    # reading_field <reading JSON> <field>
    python3 -I -c '
import json, sys
try:
    value = json.loads(sys.argv[1]).get(sys.argv[2])
except ValueError:
    value = "unreadable"
print("null" if value is None else value)' "$1" "$2"
}

check_later_readings() {
    local name hour latest back first second old answered missing waiting deadline
    # The hour both readings ask for, pinned: the latest of the last three
    # closed hours every engine has rows for. On a fresh cluster the hours
    # before the engines ran have none, and an aggregator may collect a
    # closed hour an hour or more after it closes: wait for one.
    deadline=$((SECONDS + CLOSED_HOUR_WAIT_SECONDS))
    latest=$(( ($(date -u +%s) / 3600 - 1) * 3600 * 1000 ))
    hour="$latest"
    waiting="$READING_CASES"
    log "Waiting for a closed hour every engine has rows for..."
    until [ "$SECONDS" -ge "$deadline" ]; do
        latest=$(( ($(date -u +%s) / 3600 - 1) * 3600 * 1000 ))
        for back in 0 1 2; do
            hour=$((latest - back * 3600 * 1000))
            waiting=""
            for name in $READING_CASES; do
                if ! [ "$(reading_field "$(later_reading "$name" "$hour")" rows)" -gt 0 ] 2>/dev/null; then
                    waiting="${waiting} ${name}"
                fi
            done
            [ -z "$waiting" ] && break 2
        done
        sleep 60
    done
    if [ -n "$waiting" ]; then
        hour="$latest"
        log "No closed hour of the last three has rows from every engine; checking the latest"
    fi

    log "Reading the hour from $(date -u -d "@$((hour / 1000))" +%H:%M) UTC of each engine again, ${REREAD_SECONDS}s apart..."
    for name in $READING_CASES; do
        later_reading "$name" "$hour" >"${WORK_DIR}/reading-${name}.json"
    done
    sleep "$REREAD_SECONDS"

    for name in $READING_CASES; do
        first="$(cat "${WORK_DIR}/reading-${name}.json")"
        second="$(later_reading "$name" "$hour")"

        if [ "$(reading_field "$second" rows)" -gt 0 ] 2>/dev/null && \
            [ "$(reading_field "$second" rows)" = "$(reading_field "$second" within)" ]; then
            pass "${name}: asked again for a closed hour, every one of its $(reading_field "$second" rows) rows lies within that hour"
        else
            fail "${name}: asked again for a closed hour, it answered rows outside it, or none (rows, within: $(reading_field "$second" rows), $(reading_field "$second" within); $(reading_field "$second" error))"
        fi

        assert_eq "${name}: and names each container once" \
            "$(reading_field "$second" rows)" "$(reading_field "$second" distinct)"

        # The hour's own rows: whole, or, just after the hour closes, short of
        # its end while the engine collects it. Never another window's set.
        # The agent corrects an hour only with a whole reading, and reads it
        # again 36 hours after it closed, by when the engine holds all of it.
        case "$(reading_field "$second" verdict)" in
            null)
                pass "${name}: the reading is the hour's own and whole, which the agent would correct the hour with" ;;
            *"stop at"*)
                pass "${name}: the reading is the hour's own, short of its end while the engine collects it, which the agent passes over ($(reading_field "$second" verdict))" ;;
            *)
                fail "${name}: the reading is not the hour's own: $(reading_field "$second" verdict)" ;;
        esac

        missing="$(python3 -I -c '
import json, sys
first = set(json.loads(sys.argv[1]).get("containers") or [])
second = set(json.loads(sys.argv[2]).get("containers") or [])
print(len(first - second))' "$first" "$second" 2>/dev/null || echo "unreadable")"
        assert_eq "${name}: the later reading names every container the first one did ($(reading_field "$first" rows), then $(reading_field "$second" rows) rows)" \
            "0" "$missing"

        old="$(later_reading "$name" "$((hour - 72 * 3600 * 1000))")"
        answered="$(reading_field "$old" error)"
        if [ "$answered" = "null" ]; then answered=""; else answered=" (the engine answered: ${answered})"; fi
        assert_eq "${name}: an hour from before this cluster existed answers with no row${answered}" \
            "0" "$(reading_field "$old" rows)"
        assert_present "${name}: which the agent takes as nothing to correct the hour with" \
            "$(reading_field "$old" verdict)" "nothing for the window"
    done
}

# --- Run --------------------------------------------------------------------

for tool in docker node npm python3; do
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
start_sink
measure_engines
wait_for_kubecost3_collection
measure_allocation_grouping
build_agent
start_agents
check_agents
check_prometheus
check_peaks
check_pricing
start_bundled
check_bundled
start_collector
check_collector
check_shipment
check_later_readings

harness_report
