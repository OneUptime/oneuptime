#!/usr/bin/env bash
#
# Run the Kubernetes agent's `filter/cpu-utilization` and
# `transform/cpu-utilization` processors — exactly as the chart renders them —
# inside the collector image the chart ships, push kubelet CPU metrics through
# them, and check what comes out the other side.
#
# Why this exists: the kubeletstats receiver stopped sending
# k8s.node.cpu.utilization, k8s.pod.cpu.utilization and
# container.cpu.utilization (collector 0.125.0); it sends the same values (cores
# in use) as *.cpu.usage. OneUptime's ingest, Kubernetes pages, dashboards and
# monitors read the old names, so the node collector sends them again: node and
# pod CPU copied (the *.cpu.usage originals stay), container CPU renamed. The
# helm-unittest suite pins the processors as TEXT and `otelcol validate` proves
# they PARSE; only running them shows what they send. A wrong statement is not a
# crash: it is every CPU chart and CPU monitor in OneUptime quietly empty, or
# each CPU series counted twice.
#
# Twice: on the collector the chart pins, with the metrics its receiver sends,
# and on 0.96.0 (rendered for that tag), which `helm upgrade --reuse-values`
# keeps, with the metrics that receiver sends — the *.cpu.utilization among
# them, which the filter has to clear before the copies replace them. Both must
# come out the same. Each datapoint carries a `case` attribute naming where it
# came from, and every metric a value, so a copy is told apart from an
# original.
#
# Needs docker and helm. Usage: bash Tests/Ops/agent-cpu-names-behaviour.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART="${REPO_ROOT}/HelmChart/Public/kubernetes-agent"
CURL_IMAGE="curlimages/curl:8.10.1"
RUN_ID="agent-cpu-names-$$"

WORK_DIR="$(mktemp -d)"
cleanup() {
  docker ps -aq --filter "name=${RUN_ID}-" | xargs docker rm -f >/dev/null 2>&1 || true
  docker network rm "${RUN_ID}" >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT
chmod 0755 "${WORK_DIR}"

# js-yaml is a devDependency of this package.
cd "${REPO_ROOT}/Tests/Ops"

docker network create "${RUN_ID}" >/dev/null

# run_case <label> <receiver: pinned | 0.96.0> [helm --set ...]
run_case() {
  local label="$1"
  local receiver="$2"
  shift 2
  local dir="${WORK_DIR}/${label}"
  mkdir -p "${dir}/out"
  chmod 0755 "${dir}"
  # The collector image runs as a non-root user and writes its output here.
  chmod 0777 "${dir}/out"

  echo "==> ${label}: rendering kubernetes-agent chart $*"
  helm template behaviour "${CHART}" \
    --set clusterName=behaviour-test \
    --set oneuptime.url=https://oneuptime.example.com \
    --set oneuptime.apiKey=behaviour-test \
    "$@" \
    >"${dir}/rendered.yaml"

  # The two processors and the image, lifted out of the render, so this tests
  # what ships rather than a copy of it.
  node -e '
const fs = require("fs");
const yaml = require("js-yaml");
const [rendered, outDir] = process.argv.slice(1);
const docs = yaml.loadAll(fs.readFileSync(rendered, "utf8")).filter(Boolean);

const daemonSet = docs.find((d) => {
  return d.kind === "DaemonSet" && d.metadata.name === "behaviour-kubernetes-agent-logs";
});
if (!daemonSet) {
  throw new Error("the node collector DaemonSet is not in the render");
}
const image = daemonSet.spec.template.spec.containers[0].image;

const configMap = docs.find((d) => {
  return d.kind === "ConfigMap" && d.metadata.name === "behaviour-kubernetes-agent-daemonset";
});
const collector = yaml.load(configMap.data["otel-collector-config.yaml"]);
const names = ["filter/cpu-utilization", "transform/cpu-utilization"];
for (const name of names) {
  if (!collector.processors[name]) {
    throw new Error(`${name} is not in the default render`);
  }
}
// Right after memory_limiter, filter first, so everything after them (the
// telemetry filters among them) sees the names OneUptime does.
const processors = collector.service.pipelines.metrics.processors;
if (processors.slice(0, 3).join(",") !== `memory_limiter,${names.join(",")}`) {
  throw new Error(`the metrics pipeline runs ${processors.join(", ")}`);
}

const config = {
  receivers: { otlp: { protocols: { http: { endpoint: "0.0.0.0:4318" } } } },
  processors: Object.fromEntries(names.map((name) => [name, collector.processors[name]])),
  exporters: { file: { path: "/out/metrics.json" } },
  service: {
    pipelines: {
      metrics: { receivers: ["otlp"], processors: names, exporters: ["file"] },
    },
  },
};
fs.writeFileSync(`${outDir}/config.yaml`, yaml.dump(config));
fs.writeFileSync(`${outDir}/image`, image);
' "${dir}/rendered.yaml" "${dir}"
  chmod 0644 "${dir}/config.yaml"
  local image
  image="$(cat "${dir}/image")"
  echo "    collector image: ${image}"

  # What each receiver sends for one node, one pod and one container: gauges in
  # cores, the pinned one as *.cpu.usage only, 0.96.0 also as *.cpu.utilization
  # (unit "1", the same value) and with no container.cpu.usage (it was off).
  node -e '
const fs = require("fs");
const [out, receiver] = process.argv.slice(1);
function str(key, value) {
  return { key, value: { stringValue: value } };
}
function gauge(name, unit, description, value) {
  return {
    name,
    unit,
    description,
    gauge: {
      dataPoints: [
        {
          attributes: [str("case", `${receiver} ${name}`)],
          timeUnixNano: "1700000060000000000",
          asDouble: value,
        },
      ],
    },
  };
}
const USAGE = "Total CPU usage (sum of all cores per second) averaged over the sample window";
function resource(attributes, metrics) {
  return {
    resource: { attributes },
    scopeMetrics: [{ scope: { name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/kubeletstatsreceiver" }, metrics }],
  };
}
const node = [gauge("k8s.node.cpu.usage", "{cpu}", USAGE, 1.5), gauge("k8s.node.memory.usage", "By", "Node memory usage", 1024)];
const pod = [gauge("k8s.pod.cpu.usage", "{cpu}", USAGE, 0.25)];
const container = [];
if (receiver === "0.96.0") {
  node.unshift(gauge("k8s.node.cpu.utilization", "1", "Node CPU utilization", 1.5));
  pod.unshift(gauge("k8s.pod.cpu.utilization", "1", "Pod CPU utilization", 0.25));
  container.push(gauge("container.cpu.utilization", "1", "Container CPU utilization", 0.125));
} else {
  container.push(gauge("container.cpu.usage", "{cpu}", USAGE, 0.125));
}
const payload = {
  resourceMetrics: [
    resource([str("k8s.node.name", "node-1")], node),
    resource([str("k8s.pod.uid", "pod-1")], pod),
    resource([str("k8s.pod.uid", "pod-1"), str("k8s.container.name", "app")], container),
  ],
};
fs.writeFileSync(out, JSON.stringify(payload));
' "${dir}/payload.json" "${receiver}"
  chmod 0644 "${dir}/payload.json"
  echo '{"resourceMetrics":[]}' >"${dir}/empty.json"
  chmod 0644 "${dir}/empty.json"

  local host="${RUN_ID}-${label}"
  docker run -d --name "${host}" --network "${RUN_ID}" \
    -v "${dir}/config.yaml":/etc/behaviour/config.yaml:ro \
    -v "${dir}/out":/out \
    "${image}" --config /etc/behaviour/config.yaml >/dev/null

  # Posted from a container on the same network: newer collectors listen on
  # [::] and a published port does not always reach that from the host.
  post() {
    docker run --rm --network "${RUN_ID}" -v "${dir}":/work:ro "${CURL_IMAGE}" \
      -s -o /dev/null -w "%{http_code}" -H "Content-Type: application/json" \
      --data "@/work/$1" "http://${host}:4318/v1/metrics" || true
  }

  local ready=""
  for _ in $(seq 1 30); do
    if [ "$(post empty.json)" = "200" ]; then
      ready=yes
      break
    fi
    sleep 1
  done
  if [ -z "${ready}" ]; then
    echo "    FAILED: the collector never accepted OTLP"
    docker logs "${host}" 2>&1 | tail -20
    exit 1
  fi

  local status
  status="$(post payload.json)"
  if [ "${status}" != "200" ]; then
    echo "    FAILED: posting the metrics returned HTTP ${status}"
    docker logs "${host}" 2>&1 | tail -20
    exit 1
  fi

  # The file exporter writes as metrics arrive; give it a moment to flush.
  for _ in $(seq 1 20); do
    if [ -s "${dir}/out/metrics.json" ] && grep -q "container.cpu" "${dir}/out/metrics.json"; then
      break
    fi
    sleep 0.5
  done

  node -e '
const fs = require("fs");
const [exported, receiver, image] = process.argv.slice(1);
const text = fs.existsSync(exported) ? fs.readFileSync(exported, "utf8") : "";
const sent = [];
for (const line of text.split("\n").filter(Boolean)) {
  for (const rm of JSON.parse(line).resourceMetrics || []) {
    for (const sm of rm.scopeMetrics || []) {
      for (const metric of sm.metrics || []) {
        for (const dp of metric.gauge.dataPoints) {
          sent.push(`${metric.name} unit=${metric.unit} value=${dp.asDouble} "${metric.description}"`);
        }
      }
    }
  }
}
const USAGE = "Total CPU usage (sum of all cores per second) averaged over the sample window";
// What OneUptime gets whichever collector runs: the old names with their
// unit and description, the node and pod *.cpu.usage kept, no
// container.cpu.usage, and everything else as it was.
const expected = [
  `k8s.node.cpu.usage unit={cpu} value=1.5 "${USAGE}"`,
  `k8s.node.cpu.utilization unit=1 value=1.5 "Node CPU utilization"`,
  `k8s.node.memory.usage unit=By value=1024 "Node memory usage"`,
  `k8s.pod.cpu.usage unit={cpu} value=0.25 "${USAGE}"`,
  `k8s.pod.cpu.utilization unit=1 value=0.25 "Pod CPU utilization"`,
  `container.cpu.utilization unit=1 value=0.125 "Container CPU utilization"`,
].sort();
const got = [...sent].sort();
const ok = JSON.stringify(got) === JSON.stringify(expected);
for (const line of expected) {
  console.log(`    ${got.includes(line) ? "ok    " : "MISSING"} ${line}`);
}
for (const line of got.filter((l) => !expected.includes(l))) {
  console.log(`    EXTRA  ${line}`);
}
if (!ok) {
  console.error(`the CPU metrics came out wrong from ${receiver} receiver metrics on ${image}`);
  process.exit(1);
}
' "${dir}/out/metrics.json" "${receiver}" "${image}"
  echo "==> ${label}: kubelet CPU reaches OneUptime under the names it reads, on ${image}"
}

run_case pinned pinned
run_case reuse-values 0.96.0 --set image.tag=0.96.0
