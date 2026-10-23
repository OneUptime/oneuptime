#!/usr/bin/env bash
#
# Run the Kubernetes agent's event processors - `resource` and
# `transform/severity`, exactly as the chart renders them - inside the
# collector image the chart ships, feed them the records the k8sobjects
# receiver sends for Kubernetes Events, and check what comes out.
#
# Why this exists (issue #5179): a watched Event arrives WRAPPED - the
# record's body is the watch event, {type: ADDED|MODIFIED|DELETED,
# object: <the Event>} - and the severity rule read body["type"], the
# watch's verb, so it never matched: every OOMKilling,
# FailedGetResourceMetric and FailedComputeMetricsReplicas warning left the
# cluster as an INFO log, and severity filters, drop filters and monitors
# could not tell it from a Normal event. The helm-unittest suite pins the
# statements as TEXT and `otelcol validate` proves they PARSE; only running
# them shows which records they mark, on the collector version the agent
# actually runs - and on 0.96.0, which an upgrade with --reuse-values keeps.
#
# The records are shaped like the ones the receiver sends for the Events in
# the issue: kernel-monitor's OOMKilling on two AKS nodes (in "default", as
# a Node's Events are), and the horizontal-pod-autoscaler's
# FailedGetResourceMetric and FailedComputeMetricsReplicas on HPAs in
# aks-istio-system and app-routing-system - added, updated as they repeat,
# and deleted when their hour is up - beside Normal Events and the pulled
# resource specs that share the pipeline. Each carries a `case` attribute
# that starts with the severity it must leave with: WARN or INFO.
#
# Needs docker and helm. Usage: bash Tests/Ops/agent-event-severity-behaviour.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART="${REPO_ROOT}/HelmChart/Public/kubernetes-agent"
RUN_ID="agent-event-severity-$$"

WORK_DIR="$(mktemp -d)"
cleanup() {
  docker ps -aq --filter "name=${RUN_ID}-" | xargs docker rm -f >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT
chmod 0755 "${WORK_DIR}"

# js-yaml is a devDependency of this package.
cd "${REPO_ROOT}/Tests/Ops"

# The records, once for every run.
node -e '
const fs = require("fs");
function kv(key, value) {
  if (value && typeof value === "object") {
    return { key, value: { kvlistValue: { values: Object.entries(value).map(([k, v]) => kv(k, v)) } } };
  }
  if (typeof value === "number") {
    return { key, value: { intValue: String(value) } };
  }
  return { key, value: { stringValue: value } };
}
function body(value) {
  return { kvlistValue: { values: Object.entries(value).map(([k, v]) => kv(k, v)) } };
}
function event(fields) {
  return {
    apiVersion: "events.k8s.io/v1",
    kind: "Event",
    metadata: { name: fields.name, namespace: fields.namespace, uid: fields.uid },
    type: fields.type,
    reason: fields.reason,
    note: fields.note,
    regarding: fields.regarding,
    reportingController: fields.controller || "",
    reportingInstance: fields.instance || "",
    deprecatedSource: { component: fields.controller || "", host: fields.instance || "" },
    deprecatedCount: fields.count || 1,
    deprecatedFirstTimestamp: "2026-10-21T08:00:00Z",
    deprecatedLastTimestamp: "2026-10-21T08:05:00Z",
  };
}
const oomUserPool = event({
  name: "aks-userpool-11935137-vmss00000o.180a1",
  namespace: "default",
  uid: "4d6f0a52-1f3e-4b7a-9a40-000000000001",
  type: "Warning",
  reason: "OOMKilling",
  note: "Memory cgroup out of memory: Killed process 318623 (MainThread) total-vm:10568040kB, anon-rss:1033284kB",
  regarding: { kind: "Node", name: "aks-userpool-11935137-vmss00000o", uid: "aks-userpool-11935137-vmss00000o" },
  controller: "kernel-monitor",
  instance: "aks-userpool-11935137-vmss00000o",
  count: 2,
});
const oomAgentPool = event({
  name: "aks-agentpool-19172126-vmss000000.180a2",
  namespace: "default",
  uid: "4d6f0a52-1f3e-4b7a-9a40-000000000002",
  type: "Warning",
  reason: "OOMKilling",
  note: "Memory cgroup out of memory: Killed process 401385 (DelayedTaskSche)",
  regarding: { kind: "Node", name: "aks-agentpool-19172126-vmss000000", uid: "aks-agentpool-19172126-vmss000000" },
  controller: "kernel-monitor",
  instance: "aks-agentpool-19172126-vmss000000",
});
const istiodMetric = event({
  name: "istiod.180a3",
  namespace: "aks-istio-system",
  uid: "4d6f0a52-1f3e-4b7a-9a40-000000000003",
  type: "Warning",
  reason: "FailedGetResourceMetric",
  note: "failed to get cpu utilization: unable to get metrics for resource cpu: no metrics returned from resource metrics API",
  regarding: { kind: "HorizontalPodAutoscaler", namespace: "aks-istio-system", name: "istiod", apiVersion: "autoscaling/v2" },
  controller: "horizontal-pod-autoscaler",
  count: 3,
});
const nginxReplicas = event({
  name: "nginx.180a4",
  namespace: "app-routing-system",
  uid: "4d6f0a52-1f3e-4b7a-9a40-000000000004",
  type: "Warning",
  reason: "FailedComputeMetricsReplicas",
  note: "invalid metrics (1 invalid out of 1), first error is: failed to get cpu resource metric value",
  regarding: { kind: "HorizontalPodAutoscaler", namespace: "app-routing-system", name: "nginx", apiVersion: "autoscaling/v2" },
  controller: "horizontal-pod-autoscaler",
});
const pulled = event({
  name: "web-5d9c7b8f6-x2x7q.180a5",
  namespace: "shop",
  uid: "4d6f0a52-1f3e-4b7a-9a40-000000000005",
  type: "Normal",
  reason: "Pulled",
  note: "Container image \"nginx:1.27\" already present on machine",
  regarding: { kind: "Pod", namespace: "shop", name: "web-5d9c7b8f6-x2x7q" },
  controller: "kubelet",
  instance: "aks-userpool-11935137-vmss00000o",
});
const podSpec = { apiVersion: "v1", kind: "Pod", metadata: { name: "web-5d9c7b8f6-x2x7q", namespace: "shop" }, status: { phase: "Running" } };
const cases = [
  ["WARN OOMKilling on a node, added", body({ type: "ADDED", object: oomUserPool })],
  ["WARN OOMKilling on a node, repeated", body({ type: "MODIFIED", object: oomUserPool })],
  ["WARN OOMKilling on a node, deleted when its hour is up", body({ type: "DELETED", object: oomUserPool })],
  ["WARN OOMKilling on another node", body({ type: "ADDED", object: oomAgentPool })],
  ["WARN FailedGetResourceMetric on an HPA in aks-istio-system", body({ type: "MODIFIED", object: istiodMetric })],
  ["WARN FailedComputeMetricsReplicas on an HPA in app-routing-system", body({ type: "ADDED", object: nginxReplicas })],
  ["WARN a Warning Event pulled instead of watched", body(istiodMetric)],
  ["INFO a Normal Event", body({ type: "ADDED", object: pulled })],
  ["INFO a pulled Pod spec", body(podSpec)],
];
const payload = {
  resourceLogs: [{
    resource: { attributes: [] },
    scopeLogs: [{
      scope: { name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/k8sobjectsreceiver" },
      logRecords: cases.map(([name, recordBody]) => ({
        observedTimeUnixNano: "1792656300000000000",
        attributes: [
          { key: "event.domain", value: { stringValue: "k8s" } },
          { key: "k8s.resource.name", value: { stringValue: name.includes("Pod spec") ? "pods" : "events" } },
          { key: "case", value: { stringValue: name } },
        ],
        body: recordBody,
      })),
    }],
  }],
};
fs.writeFileSync(process.argv[1], JSON.stringify(payload) + "\n");
' "${WORK_DIR}/records.json"

failures=0

# run_case <label> [extra helm --set flags...]
run_case() {
  local label="$1"
  shift
  local dir="${WORK_DIR}/${label}"
  mkdir -p "${dir}/in" "${dir}/out"
  cp "${WORK_DIR}/records.json" "${dir}/in/records.json"
  # The collector image runs as a non-root user.
  chmod 0755 "${dir}" "${dir}/in"
  chmod 0644 "${dir}/in/records.json"
  chmod 0777 "${dir}/out"

  echo "==> ${label}: rendering kubernetes-agent chart"
  helm template behaviour "${CHART}" \
    --set clusterName=behaviour-test \
    --set oneuptime.url=https://oneuptime.example.com \
    --set oneuptime.apiKey=behaviour-test \
    "$@" \
    >"${dir}/rendered.yaml"

  # Lift the logs pipeline's processors and the collector image out of the
  # render, so this tests what ships rather than a copy of it.
  node -e '
const fs = require("fs");
const yaml = require("js-yaml");
const [rendered, outDir] = process.argv.slice(1);
const docs = yaml.loadAll(fs.readFileSync(rendered, "utf8")).filter(Boolean);
const deployment = docs.find((d) => {
  return d.kind === "Deployment" && d.metadata.name === "behaviour-kubernetes-agent";
});
const configMap = docs.find((d) => {
  return d.kind === "ConfigMap" && d.metadata.name === "behaviour-kubernetes-agent-deployment";
});
if (!deployment || !configMap) {
  throw new Error("the collector Deployment or its ConfigMap is not in the render");
}
const collector = yaml.load(configMap.data["otel-collector-config.yaml"]);
const logs = collector.service.pipelines.logs;
if (!logs.receivers.includes("k8sobjects")) {
  throw new Error("the logs pipeline no longer reads the k8sobjects receiver");
}
// The processors that change what an Event record says, in pipeline order.
// memory_limiter, k8sattributes (it needs the API server) and batch do not.
const wanted = ["resource", "transform/severity"];
for (const name of wanted) {
  if (!logs.processors.includes(name)) {
    throw new Error(`${name} is not in the logs pipeline`);
  }
}
const processors = {};
for (const name of logs.processors.filter((p) => wanted.includes(p))) {
  processors[name] = collector.processors[name];
}
const config = {
  receivers: { otlpjsonfile: { include: ["/in/*.json"], start_at: "beginning" } },
  processors,
  exporters: { file: { path: "/out/logs.json" } },
  service: {
    pipelines: {
      logs: {
        receivers: ["otlpjsonfile"],
        processors: logs.processors.filter((p) => wanted.includes(p)),
        exporters: ["file"],
      },
    },
  },
};
fs.writeFileSync(`${outDir}/config.yaml`, yaml.dump(config, { lineWidth: -1 }));
fs.writeFileSync(`${outDir}/image`, deployment.spec.template.spec.containers[0].image);
' "${dir}/rendered.yaml" "${dir}"
  chmod 0644 "${dir}/config.yaml"
  local image
  image="$(cat "${dir}/image")"
  echo "    collector image: ${image}"

  docker run -d --name "${RUN_ID}-${label}" \
    -e ONEUPTIME_API_KEY=behaviour-test \
    -v "${dir}/config.yaml":/etc/behaviour/config.yaml:ro \
    -v "${dir}/in":/in:ro \
    -v "${dir}/out":/out \
    "${image}" --config /etc/behaviour/config.yaml >/dev/null

  # The file exporter writes as records arrive; wait for all of them.
  for _ in $(seq 1 60); do
    if [ -s "${dir}/out/logs.json" ] && node -e '
const fs = require("fs");
let count = 0;
for (const line of fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean)) {
  for (const rl of JSON.parse(line).resourceLogs || []) {
    for (const sl of rl.scopeLogs || []) {
      count += (sl.logRecords || []).length;
    }
  }
}
process.exit(count >= 9 ? 0 : 1);
' "${dir}/out/logs.json"; then
      break
    fi
    sleep 1
  done

  if ! node -e '
const fs = require("fs");
const [exported, recordsFile] = process.argv.slice(1);
const sent = [];
for (const rl of JSON.parse(fs.readFileSync(recordsFile, "utf8")).resourceLogs) {
  for (const sl of rl.scopeLogs) {
    for (const record of sl.logRecords) {
      sent.push(record.attributes.find((a) => a.key === "case").value.stringValue);
    }
  }
}
const got = new Map();
const text = fs.existsSync(exported) ? fs.readFileSync(exported, "utf8") : "";
for (const line of text.split("\n").filter(Boolean)) {
  for (const rl of JSON.parse(line).resourceLogs || []) {
    const cluster = (rl.resource.attributes || []).find((a) => a.key === "k8s.cluster.name");
    for (const sl of rl.scopeLogs || []) {
      for (const record of sl.logRecords || []) {
        const name = record.attributes.find((a) => a.key === "case").value.stringValue;
        got.set(name, {
          number: record.severityNumber,
          text: record.severityText,
          cluster: cluster ? cluster.value.stringValue : "",
        });
      }
    }
  }
}
let failures = 0;
for (const name of sent) {
  const out = got.get(name);
  const want = name.startsWith("WARN") ? { number: 13, text: "WARN" } : { number: 9, text: "INFO" };
  const ok = Boolean(out) && out.number === want.number && out.text === want.text && out.cluster === "behaviour-test";
  console.log(`    ${ok ? "ok    " : "FAILED"} ${name} -> ${out ? `${out.text} (${out.number}), cluster ${out.cluster || "none"}` : "dropped"}`);
  if (!ok) {
    failures++;
  }
}
process.exit(failures > 0 ? 1 : 0);
' "${dir}/out/logs.json" "${WORK_DIR}/records.json"; then
    echo "    FAILED: ${label}"
    docker logs "${RUN_ID}-${label}" 2>&1 | tail -20
    failures=$((failures + 1))
  fi

  docker rm -f "${RUN_ID}-${label}" >/dev/null 2>&1 || true
}

run_case defaults
# `helm upgrade --reuse-values` keeps the image.tag an older install was
# given, and the chart pinned 0.96.0 before.
run_case reuse-values-0.96.0 --set image.tag=0.96.0

if [ "${failures}" -gt 0 ]; then
  echo "${failures} run(s) marked Kubernetes Events wrongly"
  exit 1
fi
echo "==> every Warning Event leaves the agent as WARN, and nothing else does"
