#!/usr/bin/env bash
#
# Run the Kubernetes agent's `filter/ebpf-node-inspector` processor — exactly
# as the chart renders it — inside the collector image the chart ships, push
# metric datapoints through it, and check which come out the other side.
#
# Why this exists: OBI v0.14 starts tracing a Node.js process before it
# injects its Node.js agent through the process's inspector, so its own
# GET /json/list (and /json/version) and the WebSocket upgrade after them, on
# 127.0.0.1:9229, are counted in the app's http.server.* metrics. The filter
# drops those datapoints, and nothing else. The helm-unittest suite pins its
# OTTL condition as TEXT and `otelcol validate` proves it PARSES; only running
# it shows which datapoints it drops, on the collector version the agent
# actually runs. A wrong condition is not a crash: it is an app's own request
# metrics quietly missing, or the inspector's routes back among them.
#
# The datapoints are shaped like the ones OBI v0.14.0 sent from the test
# cluster: histograms named http.server.request.duration,
# http.server.request.body.size and http.server.response.body.size, with
# http.request.method, http.response.status_code, http.route, server.address,
# server.port (an integer) and url.scheme, under a resource that carries
# telemetry.distro.name=opentelemetry-ebpf-instrumentation. Each one also
# carries a `case` attribute naming what must happen to it: DROP or KEEP.
#
# Needs docker and helm. Usage: bash Tests/Ops/agent-metric-filter-behaviour.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART="${REPO_ROOT}/HelmChart/Public/kubernetes-agent"
CURL_IMAGE="curlimages/curl:8.10.1"
RUN_ID="agent-metric-filter-$$"
LABEL="defaults"

WORK_DIR="$(mktemp -d)"
cleanup() {
  docker ps -aq --filter "name=${RUN_ID}-" | xargs docker rm -f >/dev/null 2>&1 || true
  docker network rm "${RUN_ID}" >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

# The collector image runs as a non-root user and writes its output here.
mkdir -p "${WORK_DIR}/out"
chmod 0777 "${WORK_DIR}/out"
chmod 0755 "${WORK_DIR}"

# js-yaml is a devDependency of this package.
cd "${REPO_ROOT}/Tests/Ops"

# Render the chart with its defaults and lift the processor definition and
# the collector image out of it, so this tests what ships rather than a copy
# of it.
echo "==> ${LABEL}: rendering kubernetes-agent chart"
helm template behaviour "${CHART}" \
  --set clusterName=behaviour-test \
  --set oneuptime.url=https://oneuptime.example.com \
  --set oneuptime.apiKey=behaviour-test \
  >"${WORK_DIR}/rendered.yaml"
node -e '
const fs = require("fs");
const yaml = require("js-yaml");
const [rendered, outDir] = process.argv.slice(1);
const docs = yaml.loadAll(fs.readFileSync(rendered, "utf8")).filter(Boolean);

const deployment = docs.find((d) => {
  return d.kind === "Deployment" && d.metadata.name === "behaviour-kubernetes-agent";
});
if (!deployment) {
  throw new Error("the collector Deployment is not in the render");
}
const image = deployment.spec.template.spec.containers[0].image;

const configMap = docs.find((d) => {
  return d.kind === "ConfigMap" && d.metadata.name === "behaviour-kubernetes-agent-deployment";
});
const collector = yaml.load(configMap.data["otel-collector-config.yaml"]);
const filter = collector.processors["filter/ebpf-node-inspector"];
if (!filter) {
  throw new Error("filter/ebpf-node-inspector is not in the default render");
}
if (!collector.service.pipelines.metrics.processors.includes("filter/ebpf-node-inspector")) {
  throw new Error("filter/ebpf-node-inspector is defined but not in the metrics pipeline");
}

const config = {
  receivers: { otlp: { protocols: { http: { endpoint: "0.0.0.0:4318" } } } },
  processors: { "filter/ebpf-node-inspector": filter },
  exporters: { file: { path: "/out/metrics.json" } },
  service: {
    pipelines: {
      metrics: {
        receivers: ["otlp"],
        processors: ["filter/ebpf-node-inspector"],
        exporters: ["file"],
      },
    },
  },
};
fs.writeFileSync(`${outDir}/config.yaml`, yaml.dump(config));
fs.writeFileSync(`${outDir}/image`, image);
' "${WORK_DIR}/rendered.yaml" "${WORK_DIR}"
chmod 0644 "${WORK_DIR}/config.yaml"
IMAGE="$(cat "${WORK_DIR}/image")"
echo "    collector image: ${IMAGE}"

node -e '
const fs = require("fs");
const OBI = "opentelemetry-ebpf-instrumentation";
function str(key, value) {
  return { key, value: { stringValue: value } };
}
function int(key, value) {
  return { key, value: { intValue: String(value) } };
}
// One histogram datapoint as OBI v0.14.0 exports it, plus the case name.
function datapoint(name, { method = "GET", status, route, port = 9229, portAsString = false }) {
  const attributes = [str("http.request.method", method)];
  if (status !== undefined) {
    attributes.push(int("http.response.status_code", status));
  }
  attributes.push(
    str("http.route", route),
    str("server.address", "app26"),
    portAsString ? str("server.port", String(port)) : int("server.port", port),
    str("url.scheme", "http"),
    str("case", name),
  );
  return {
    attributes,
    startTimeUnixNano: "1700000000000000000",
    timeUnixNano: "1700000060000000000",
    count: "1",
    sum: 0.0012,
    bucketCounts: ["1", "0"],
    explicitBounds: [0.005],
  };
}
function histogram(metricName, dataPoints) {
  return {
    name: metricName,
    unit: metricName.endsWith(".duration") ? "s" : "By",
    histogram: { aggregationTemporality: 2, dataPoints },
  };
}
function resource(distro, service, metrics) {
  const attributes = [str("service.name", service)];
  if (distro) {
    attributes.push(str("telemetry.distro.name", distro));
  }
  return {
    resource: { attributes },
    scopeMetrics: [{ scope: { name: "go.opentelemetry.io/obi" }, metrics }],
  };
}
const payload = {
  resourceMetrics: [
    resource(OBI, "app26", [
      histogram("http.server.request.duration", [
        // The injection: OBI talking to the inspector of the app.
        datapoint("DROP GET /json/list 200 on 9229", { status: 200, route: "/json/list" }),
        datapoint("DROP GET /json/version 200 on 9229 (inspector already open)", { status: 200, route: "/json/version" }),
        datapoint("DROP GET /json/version 404 on 9229 (something else on 9229)", { status: 404, route: "/json/version" }),
        datapoint("DROP GET /json/list with no status on 9229", { route: "/json/list" }),
        datapoint("DROP GET /* 101 on 9229 (the WebSocket upgrade)", { status: 101, route: "/*" }),
        // Traffic of the app itself, on 9229 and elsewhere.
        datapoint("KEEP GET /* 200 on 9229 (not an upgrade)", { status: 200, route: "/*" }),
        datapoint("KEEP GET /* with no status on 9229", { route: "/*" }),
        datapoint("KEEP POST /json/list 200 on 9229", { method: "POST", status: 200, route: "/json/list" }),
        datapoint("KEEP GET /api/items/:id 200 on 9229 (an app route on 9229)", { status: 200, route: "/api/items/:id" }),
        datapoint("KEEP GET /json 200 on 9229 (another inspector route)", { status: 200, route: "/json" }),
        datapoint("KEEP GET /json/list/ 200 on 9229", { status: 200, route: "/json/list/" }),
        datapoint("KEEP GET /* 101 on 3000 (a WebSocket of the app)", { status: 101, route: "/*", port: 3000 }),
        datapoint("KEEP GET /json/list 200 on 9222 (Chrome DevTools)", { status: 200, route: "/json/list", port: 9222 }),
        datapoint("KEEP GET /json/list 200 on 9230 (an inspector OBI never dials)", { status: 200, route: "/json/list", port: 9230 }),
        datapoint("KEEP GET /ping 200 on 8080", { status: 200, route: "/ping", port: 8080 }),
        datapoint("KEEP GET /json/list 200 with server.port a string", { status: 200, route: "/json/list", portAsString: true }),
      ]),
      histogram("http.server.request.body.size", [
        datapoint("DROP request body size GET /json/list 200 on 9229", { status: 200, route: "/json/list" }),
        datapoint("KEEP request body size GET /ping 200 on 8080", { status: 200, route: "/ping", port: 8080 }),
      ]),
      histogram("http.server.response.body.size", [
        datapoint("DROP response body size GET /* 101 on 9229", { status: 101, route: "/*" }),
        datapoint("KEEP response body size GET /ping 200 on 8080", { status: 200, route: "/ping", port: 8080 }),
      ]),
      // The app calling some inspector: a client metric, not a request it served.
      histogram("http.client.request.duration", [
        datapoint("KEEP client duration GET /json/list 200 to 9229", { status: 200, route: "/json/list" }),
      ]),
      histogram("rpc.server.duration", [
        datapoint("KEEP rpc server duration GET /json/list on 9229", { status: 200, route: "/json/list" }),
      ]),
    ]),
    // Metrics an application pushes from its own SDK: never touched.
    resource("opentelemetry-js-instrumentation", "sdk-app", [
      histogram("http.server.request.duration", [
        datapoint("KEEP sdk GET /json/list 200 on 9229", { status: 200, route: "/json/list" }),
        datapoint("KEEP sdk GET /* 101 on 9229", { status: 101, route: "/*" }),
      ]),
    ]),
    resource(null, "no-distro", [
      histogram("http.server.request.duration", [
        datapoint("KEEP no distro GET /json/list 200 on 9229", { status: 200, route: "/json/list" }),
      ]),
    ]),
  ],
};
fs.writeFileSync(process.argv[1], JSON.stringify(payload));
' "${WORK_DIR}/payload.json"
chmod 0644 "${WORK_DIR}/payload.json"

echo '{"resourceMetrics":[]}' >"${WORK_DIR}/empty.json"
chmod 0644 "${WORK_DIR}/empty.json"

# Posted from a container on the same network: newer collectors listen on
# [::] and a published port does not always reach that from the host.
# post <file>
post() {
  docker run --rm --network "${RUN_ID}" -v "${WORK_DIR}":/work:ro "${CURL_IMAGE}" \
    -s -o /dev/null -w "%{http_code}" -H "Content-Type: application/json" \
    --data "@/work/$1" "http://${RUN_ID}-${LABEL}:4318/v1/metrics" || true
}

docker network create "${RUN_ID}" >/dev/null
docker run -d --name "${RUN_ID}-${LABEL}" --network "${RUN_ID}" \
  -v "${WORK_DIR}/config.yaml":/etc/behaviour/config.yaml:ro \
  -v "${WORK_DIR}/out":/out \
  "${IMAGE}" --config /etc/behaviour/config.yaml >/dev/null

ready=""
for _ in $(seq 1 30); do
  if [ "$(post empty.json)" = "200" ]; then
    ready=yes
    break
  fi
  sleep 1
done
if [ -z "${ready}" ]; then
  echo "    FAILED: the collector never accepted OTLP"
  docker logs "${RUN_ID}-${LABEL}" 2>&1 | tail -20
  exit 1
fi

status="$(post payload.json)"
if [ "${status}" != "200" ]; then
  echo "    FAILED: posting the datapoints returned HTTP ${status}"
  docker logs "${RUN_ID}-${LABEL}" 2>&1 | tail -20
  exit 1
fi

# The file exporter writes as datapoints arrive; give it a moment to flush.
for _ in $(seq 1 20); do
  if [ -s "${WORK_DIR}/out/metrics.json" ] && grep -q "KEEP" "${WORK_DIR}/out/metrics.json"; then
    break
  fi
  sleep 0.5
done

node -e '
const fs = require("fs");
const [exported, payloadFile] = process.argv.slice(1);
function cases(request) {
  const names = [];
  for (const rm of request.resourceMetrics || []) {
    for (const sm of rm.scopeMetrics || []) {
      for (const metric of sm.metrics || []) {
        const data = metric.histogram || metric.sum || metric.gauge || {};
        for (const dp of data.dataPoints || []) {
          const attribute = (dp.attributes || []).find((a) => {
            return a.key === "case";
          });
          names.push(attribute.value.stringValue);
        }
      }
    }
  }
  return names;
}
const kept = new Set();
const text = fs.existsSync(exported) ? fs.readFileSync(exported, "utf8") : "";
for (const line of text.split("\n").filter(Boolean)) {
  for (const name of cases(JSON.parse(line))) {
    kept.add(name);
  }
}
let failures = 0;
for (const name of cases(JSON.parse(fs.readFileSync(payloadFile, "utf8")))) {
  const ok = kept.has(name) === name.startsWith("KEEP");
  console.log(`    ${ok ? "ok    " : "FAILED"} ${name} -> ${kept.has(name) ? "kept" : "dropped"}`);
  if (!ok) {
    failures++;
  }
}
if (failures > 0) {
  console.error(`${failures} datapoint(s) were handled wrongly by filter/ebpf-node-inspector`);
  process.exit(1);
}
' "${WORK_DIR}/out/metrics.json" "${WORK_DIR}/payload.json"
echo "==> filter/ebpf-node-inspector behaves as documented on ${IMAGE}"
