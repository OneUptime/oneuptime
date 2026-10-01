#!/usr/bin/env bash
#
# Run the Kubernetes agent's `filter/ebpf-unlinked-db` processor — exactly as
# the chart renders it — inside the collector image the chart ships, push
# spans through it, and check which come out the other side.
#
# Why this exists: the helm-unittest suite pins the OTTL condition as TEXT,
# and `otelcol validate` (validate-collector-configs.sh) proves it PARSES, but
# neither shows what it does to a span. The condition decides which of the
# agent's traces a customer gets to see, so a wrong one is not a crash, it is
# quietly missing data — or the flood of one-span `set`/`evalsha` "traces"
# this filter exists to remove, back again. Only running it can tell those
# apart, and only on the collector version the agent actually runs: OTTL
# grammar moves between releases (IsRootSpan() does not exist on 0.96.0).
#
# Two variants: the defaults (both ebpf.dropDatabaseServerSpans and
# ebpf.dropUnlinkedDatabaseCalls on), and dropUnlinkedDatabaseCalls=false,
# which must keep an application's unlinked calls while still dropping the
# database server's own spans.
#
# The spans below are shaped like the ones OBI sent from the test cluster:
# its resource carries telemetry.distro.name=opentelemetry-ebpf-instrumentation,
# database spans carry db.system.name, and "no parent" is an empty parent id.
#
# Needs docker and helm. Usage: bash Tests/Ops/agent-trace-filter-behaviour.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART="${REPO_ROOT}/HelmChart/Public/kubernetes-agent"
CURL_IMAGE="curlimages/curl:8.10.1"
RUN_ID="agent-trace-filter-$$"

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

# render_variant <dir> [helm --set args...]: render the chart and lift the
# processor definition (<dir>/config.yaml) and the collector image
# (<dir>/image) out of it, so this tests what ships rather than a copy of it.
render_variant() {
  local dir="$1"
  shift
  mkdir -p "${dir}"
  helm template behaviour "${CHART}" \
    --set clusterName=behaviour-test \
    --set oneuptime.url=https://oneuptime.example.com \
    --set oneuptime.apiKey=behaviour-test \
    "$@" \
    >"${dir}/rendered.yaml"
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
const filter = collector.processors["filter/ebpf-unlinked-db"];
if (!filter) {
  throw new Error("filter/ebpf-unlinked-db is not in the default render");
}
if (!collector.service.pipelines.traces.processors.includes("filter/ebpf-unlinked-db")) {
  throw new Error("filter/ebpf-unlinked-db is defined but not in the traces pipeline");
}

const config = {
  receivers: { otlp: { protocols: { http: { endpoint: "0.0.0.0:4318" } } } },
  processors: { "filter/ebpf-unlinked-db": filter },
  exporters: { file: { path: "/out/spans.json" } },
  service: {
    pipelines: {
      traces: {
        receivers: ["otlp"],
        processors: ["filter/ebpf-unlinked-db"],
        exporters: ["file"],
      },
    },
  },
};
fs.writeFileSync(`${outDir}/config.yaml`, yaml.dump(config));
fs.writeFileSync(`${outDir}/image`, image);
' "${dir}/rendered.yaml" "${dir}"
  chmod 0755 "${dir}"
  chmod 0644 "${dir}/config.yaml"
}

# Each span is named for what must happen to it: SERVER (a database server's
# own span, linked or not) and CALL (an application's unlinked database call)
# are dropped while their switch is on; KEEP is always kept. Ids are hex: the
# collector's OTLP/JSON decoder reads trace and span ids as hex, not base64.
node -e '
const fs = require("fs");
const OBI = "opentelemetry-ebpf-instrumentation";
const TRACE = "5b8efff798038103d269b633813fc60c";
let next = 1;
function span(name, kind, parentSpanId, attributes) {
  return {
    traceId: TRACE,
    spanId: (next++).toString(16).padStart(16, "0"),
    parentSpanId,
    name,
    kind,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000000001000000",
    attributes: Object.entries(attributes).map(([key, value]) => {
      return { key, value: { stringValue: value } };
    }),
  };
}
function resource(distro, service, spans) {
  const attributes = [{ key: "service.name", value: { stringValue: service } }];
  if (distro) {
    attributes.push({ key: "telemetry.distro.name", value: { stringValue: distro } });
  }
  return { resource: { attributes }, scopeSpans: [{ scope: { name: "behaviour" }, spans }] };
}
const SERVER = 2;
const CLIENT = 3;
const PRODUCER = 4;
const PARENT = "00000000000000aa";
const payload = {
  resourceSpans: [
    // valkey-server: its own span for every command it receives, unlinked
    // (caller on another node) or linked (same node).
    resource(OBI, "oneuptime-valkey", [
      span("SERVER valkey server set", SERVER, "", { "db.system.name": "redis", "db.operation.name": "set" }),
      span("SERVER valkey server get linked under the call", SERVER, PARENT, { "db.system.name": "redis", "db.operation.name": "get" }),
    ]),
    // A queue worker polling Redis outside any request, and one inside one.
    resource(OBI, "oneuptime-worker", [
      span("CALL worker unlinked evalsha", CLIENT, "", { "db.system.name": "redis", "db.operation.name": "evalsha" }),
      span("KEEP worker evalsha inside a request", CLIENT, PARENT, { "db.system.name": "redis" }),
      span("KEEP worker kafka publish", PRODUCER, "", { "messaging.system": "kafka" }),
    ]),
    resource(OBI, "oneuptime-app", [
      span("KEEP app request root", SERVER, "", { "http.request.method": "POST", "http.route": "/otlp/v1/traces" }),
      span("KEEP app SELECT inside the request", CLIENT, PARENT, { "db.system.name": "postgresql" }),
      // The older semantic-convention key, for an OBI that still sends it.
      span("CALL app unlinked SELECT on db.system", CLIENT, "", { "db.system": "postgresql" }),
    ]),
    resource(OBI, "oneuptime-postgresql", [
      span("SERVER postgres server SELECT", SERVER, "", { "db.system.name": "postgresql" }),
      // Linked by OBI under a same-node call (black-box propagation): still a
      // duplicate of that call, and dropped like the unlinked one.
      span("SERVER postgres server SELECT linked under the call", SERVER, PARENT, { "db.system.name": "postgresql" }),
    ]),
    // An application pushing its own SDK spans to the agent: never touched.
    resource(null, "sdk-app", [
      span("KEEP sdk unlinked redis call", CLIENT, "", { "db.system.name": "redis" }),
    ]),
    resource("some-other-distro", "other", [
      span("KEEP other distro unlinked redis call", CLIENT, "", { "db.system.name": "redis" }),
    ]),
  ],
};
fs.writeFileSync(process.argv[1], JSON.stringify(payload));
' "${WORK_DIR}/payload.json"
chmod 0644 "${WORK_DIR}/payload.json"

# Posted from a container on the same network: newer collectors listen on
# [::] and a published port does not always reach that from the host.
# post <label> <file>
post() {
  docker run --rm --network "${RUN_ID}" -v "${WORK_DIR}":/work:ro "${CURL_IMAGE}" \
    -s -o /dev/null -w "%{http_code}" -H "Content-Type: application/json" \
    --data "@/work/$2" "http://${RUN_ID}-$1:4318/v1/traces" || true
}

echo '{"resourceSpans":[]}' >"${WORK_DIR}/empty.json"
chmod 0644 "${WORK_DIR}/empty.json"

# run_variant <label> <mode> [helm --set args...]: render the chart with the
# given values, run its filter in its collector, post the spans and check
# what survives. mode: "defaults" (SERVER and CALL dropped) or "calls-kept"
# (SERVER dropped, CALL kept).
run_variant() {
  local label="$1"
  local mode="$2"
  shift 2
  local dir="${WORK_DIR}/${label}"
  echo "==> ${label}: rendering kubernetes-agent chart $*"
  render_variant "${dir}" "$@"
  local image
  image="$(cat "${dir}/image")"
  echo "    collector image: ${image}"
  mkdir -p "${dir}/out"
  chmod 0777 "${dir}/out"
  local status
  local ready
  docker run -d --name "${RUN_ID}-${label}" --network "${RUN_ID}" \
    -v "${dir}/config.yaml":/etc/behaviour/config.yaml:ro \
    -v "${dir}/out":/out \
    "${image}" --config /etc/behaviour/config.yaml >/dev/null

  ready=""
  for _ in $(seq 1 30); do
    if [ "$(post "${label}" empty.json)" = "200" ]; then
      ready=yes
      break
    fi
    sleep 1
  done
  if [ -z "${ready}" ]; then
    echo "    FAILED: the collector never accepted OTLP"
    docker logs "${RUN_ID}-${label}" 2>&1 | tail -20
    exit 1
  fi

  status="$(post "${label}" payload.json)"
  if [ "${status}" != "200" ]; then
    echo "    FAILED: posting the spans returned HTTP ${status}"
    docker logs "${RUN_ID}-${label}" 2>&1 | tail -20
    exit 1
  fi

  # The file exporter writes as spans arrive; give it a moment to flush.
  for _ in $(seq 1 20); do
    if [ -s "${dir}/out/spans.json" ] && grep -q "KEEP" "${dir}/out/spans.json"; then
      break
    fi
    sleep 0.5
  done

  node -e '
  const fs = require("fs");
  const [exported, payloadFile, mode] = process.argv.slice(1);
  const keepCalls = mode === "calls-kept";
  const kept = new Set();
  const text = fs.existsSync(exported) ? fs.readFileSync(exported, "utf8") : "";
  for (const line of text.split("\n").filter(Boolean)) {
    for (const rs of JSON.parse(line).resourceSpans || []) {
      for (const ss of rs.scopeSpans || []) {
        for (const span of ss.spans || []) {
          kept.add(span.name);
        }
      }
    }
  }
  const sent = [];
  for (const rs of JSON.parse(fs.readFileSync(payloadFile, "utf8")).resourceSpans) {
    for (const ss of rs.scopeSpans) {
      for (const span of ss.spans) {
        sent.push(span.name);
      }
    }
  }
  let failures = 0;
  for (const name of sent) {
    const shouldKeep =
      name.startsWith("KEEP") || (name.startsWith("CALL") && keepCalls);
    const ok = kept.has(name) === shouldKeep;
    console.log(`    ${ok ? "ok    " : "FAILED"} ${name} -> ${kept.has(name) ? "kept" : "dropped"}`);
    if (!ok) {
      failures++;
    }
  }
  if (failures > 0) {
    console.error(`${failures} span(s) were handled wrongly by filter/ebpf-unlinked-db`);
    process.exit(1);
  }
  ' "${dir}/out/spans.json" "${WORK_DIR}/payload.json" "${mode}"
  echo "    ${label}: filter/ebpf-unlinked-db behaves as documented on ${image}"
}

docker network create "${RUN_ID}" >/dev/null
run_variant defaults defaults
run_variant calls-kept calls-kept --set ebpf.dropUnlinkedDatabaseCalls=false
echo "==> filter/ebpf-unlinked-db behaves as documented"
