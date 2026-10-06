#!/usr/bin/env bash
#
# Run the Kubernetes agent's eBPF span filters — `filter/ebpf-unlinked-db`
# and `filter/ebpf-unlinked-client`, exactly as the chart renders them —
# inside the collector image the chart ships, push spans through them, and
# check which come out the other side.
#
# Why this exists: the helm-unittest suite pins the OTTL conditions as TEXT,
# and `otelcol validate` (validate-collector-configs.sh) proves they PARSE, but
# neither shows what they do to a span. The conditions decide which of the
# agent's traces a customer gets to see, so a wrong one is not a crash, it is
# quietly missing data — or the flood of one-span `set`/`evalsha` "traces"
# these filters exist to remove, back again. Only running them can tell those
# apart, and only on the collector version the agent actually runs: OTTL
# grammar moves between releases (IsRootSpan() does not exist on 0.96.0).
#
# Variants: the defaults (ebpf.dropDatabaseServerSpans and
# ebpf.dropUnlinkedDatabaseCalls on, ebpf.dropUnlinkedClientCalls off);
# dropUnlinkedDatabaseCalls=false, which must keep an application's unlinked
# database calls while still dropping the database server's own spans;
# dropUnlinkedClientCalls=true, alone and with each database switch off,
# which must drop an application's other unlinked client calls and nothing
# the database switches decide about — and, with every database switch off,
# leave the database spans alone.
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

# render_variant <dir> <processors> [helm --set args...]: render the chart and
# lift the eBPF span filters of its traces pipeline (<dir>/config.yaml, in
# pipeline order) and the collector image (<dir>/image) out of it, so this
# tests what ships rather than a copy of it. <processors> is the comma-separated
# list of filter/ebpf-unlinked-* processors the render must run, in order.
render_variant() {
  local dir="$1"
  local processors="$2"
  shift 2
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
const [rendered, outDir, expectedList] = process.argv.slice(1);
const expected = expectedList.split(",").filter(Boolean);
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
const inPipeline = collector.service.pipelines.traces.processors.filter((p) => {
  return p.startsWith("filter/ebpf-unlinked-");
});
const defined = Object.keys(collector.processors).filter((p) => {
  return p.startsWith("filter/ebpf-unlinked-");
});
if (JSON.stringify(inPipeline) !== JSON.stringify(expected)) {
  throw new Error(`the traces pipeline runs [${inPipeline}], expected [${expected}]`);
}
if (JSON.stringify([...defined].sort()) !== JSON.stringify([...expected].sort())) {
  throw new Error(`the render defines [${defined}], expected [${expected}]`);
}

const processors = {};
for (const name of inPipeline) {
  processors[name] = collector.processors[name];
}
const config = {
  receivers: { otlp: { protocols: { http: { endpoint: "0.0.0.0:4318" } } } },
  processors,
  exporters: { file: { path: "/out/spans.json" } },
  service: {
    pipelines: {
      traces: {
        receivers: ["otlp"],
        processors: inPipeline,
        exporters: ["file"],
      },
    },
  },
};
fs.writeFileSync(`${outDir}/config.yaml`, yaml.dump(config));
fs.writeFileSync(`${outDir}/image`, image);
' "${dir}/rendered.yaml" "${dir}" "${processors}"
  chmod 0755 "${dir}"
  chmod 0644 "${dir}/config.yaml"
}

# Each span is named for what must happen to it: SERVER (a database server's
# own span, linked or not), CALL (an application's unlinked database call) and
# CLIENT (an application's other unlinked client call) are dropped while their
# switch is on; KEEP is always kept. Ids are hex: the collector's OTLP/JSON
# decoder reads trace and span ids as hex, not base64.
node -e '
const fs = require("fs");
const OBI = "opentelemetry-ebpf-instrumentation";
const TRACE = "5b8efff798038103d269b633813fc60c";
let next = 1;
function span(name, kind, parentSpanId, attributes, statusCode) {
  const s = {
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
  if (statusCode) {
    s.status = { code: statusCode };
  }
  return s;
}
function resource(distro, service, spans) {
  const attributes = [{ key: "service.name", value: { stringValue: service } }];
  if (distro) {
    attributes.push({ key: "telemetry.distro.name", value: { stringValue: distro } });
  }
  return { resource: { attributes }, scopeSpans: [{ scope: { name: "behaviour" }, spans }] };
}
const UNSPECIFIED = 0;
const INTERNAL = 1;
const SERVER = 2;
const CLIENT = 3;
const PRODUCER = 4;
const CONSUMER = 5;
const STATUS_ERROR = 2;
const PARENT = "00000000000000aa";
// An HTTP call as OBI v0.14 records it, to the ClickHouse HTTP interface.
const clickhouse = {
  "http.request.method": "POST",
  "url.full": "http://oneuptime-clickhouse:4129/",
  "server.address": "oneuptime-clickhouse",
  "server.port": "4129",
  "service.peer.name": "oneuptime-clickhouse",
  "http.response.status_code": "200",
};
// A probe calling an API that OBI traces on the same node: OBI links the
// request the API served under the call, so the call is that trace root.
const probeCall = span("CLIENT probe unlinked POST /probe-ingest/monitor/list, the root of the API request OBI linked under it", CLIENT, "", {
  "http.request.method": "POST",
  "server.address": "oneuptime-app",
  "service.peer.name": "oneuptime-app",
});
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
      span("KEEP worker kafka consume", CONSUMER, "", { "messaging.system": "kafka" }),
      // OBI v0.14 types a messaging receive or settle as CLIENT.
      span("KEEP worker NATS receive OBI types CLIENT", CLIENT, "", { "messaging.system": "nats", "messaging.operation.type": "receive" }),
      // Its own HTTP calls: outside any request, inside one, and failed.
      span("CLIENT worker unlinked POST / to the ClickHouse HTTP interface", CLIENT, "", clickhouse),
      span("KEEP worker POST / to ClickHouse inside a request", CLIENT, PARENT, clickhouse),
      span("CLIENT worker unlinked call that failed", CLIENT, "", { "http.request.method": "GET", "server.address": "billing.example.com", "http.response.status_code": "503" }, STATUS_ERROR),
      // GenAI calls: LLM cost and token figures come from these spans.
      span("KEEP worker unlinked OpenAI chat call", CLIENT, "", { "http.request.method": "POST", "gen_ai.operation.name": "chat", "gen_ai.provider.name": "openai" }),
      span("KEEP worker unlinked GenAI call on the older gen_ai.system", CLIENT, "", { "http.request.method": "POST", "gen_ai.system": "openai" }),
    ]),
    // A controller renewing its lease, a metrics agent pushing over gRPC.
    resource(OBI, "keda-operator", [
      span("CLIENT keda unlinked PUT lease renewal", CLIENT, "", { "http.request.method": "PUT", "url.full": "https://34.118.224.1:443/apis/coordination.k8s.io/v1/namespaces/default/leases/operator.keda.sh", "server.address": "34.118.224.1" }),
    ]),
    resource(OBI, "gmp-collector", [
      span("CLIENT gmp unlinked gRPC CreateTimeSeries", CLIENT, "", { "rpc.system.name": "grpc", "rpc.method": "google.monitoring.v3.MetricService/CreateTimeSeries", "server.address": "monitoring.googleapis.com" }),
    ]),
    resource(OBI, "oneuptime-probe", [probeCall]),
    resource(OBI, "oneuptime-app", [
      span("KEEP app request root", SERVER, "", { "http.request.method": "POST", "http.route": "/otlp/v1/traces" }),
      // The stateless filter keeps it when it drops the call above it: the
      // documented cost of ebpf.dropUnlinkedClientCalls.
      span("KEEP app request OBI linked under the probe call", SERVER, probeCall.spanId, { "http.request.method": "POST", "http.route": "/probe-ingest/monitor/list" }),
      span("KEEP app SELECT inside the request", CLIENT, PARENT, { "db.system.name": "postgresql" }),
      span("KEEP app GET inside the request", CLIENT, PARENT, { "http.request.method": "GET", "server.address": "downstream" }),
      span("KEEP app internal span with no parent", INTERNAL, "", {}),
      span("KEEP app span of no kind with no parent", UNSPECIFIED, "", { "http.request.method": "GET" }),
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
      span("KEEP sdk unlinked HTTP call", CLIENT, "", { "http.request.method": "GET" }),
    ]),
    resource("some-other-distro", "other", [
      span("KEEP other distro unlinked redis call", CLIENT, "", { "db.system.name": "redis" }),
      span("KEEP other distro unlinked HTTP call", CLIENT, "", { "http.request.method": "GET" }),
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

# run_variant <label> <dropped> <processors> [helm --set args...]: render the
# chart with the given values, run its eBPF span filters (<processors>, see
# render_variant) in its collector, post the spans and check what survives.
# <dropped> is the comma-separated list of span-name prefixes (SERVER, CALL,
# CLIENT) whose spans must be dropped; every other span must be kept.
run_variant() {
  local label="$1"
  local dropped="$2"
  local processors="$3"
  shift 3
  local dir="${WORK_DIR}/${label}"
  echo "==> ${label}: rendering kubernetes-agent chart $*"
  render_variant "${dir}" "${processors}" "$@"
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
  const [exported, payloadFile, droppedList] = process.argv.slice(1);
  const dropped = droppedList.split(",").filter(Boolean);
  const prefixes = ["KEEP", "SERVER", "CALL", "CLIENT"];
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
    const prefix = name.split(" ")[0];
    if (!prefixes.includes(prefix)) {
      throw new Error(`span "${name}" does not start with one of ${prefixes}`);
    }
    const shouldKeep = !dropped.includes(prefix);
    const ok = kept.has(name) === shouldKeep;
    console.log(`    ${ok ? "ok    " : "FAILED"} ${name} -> ${kept.has(name) ? "kept" : "dropped"}`);
    if (!ok) {
      failures++;
    }
  }
  if (failures > 0) {
    console.error(`${failures} span(s) were handled wrongly by the eBPF span filters`);
    process.exit(1);
  }
  ' "${dir}/out/spans.json" "${WORK_DIR}/payload.json" "${dropped}"
  echo "    ${label}: as documented on ${image} (${processors})"
}

DB=filter/ebpf-unlinked-db
CLIENT=filter/ebpf-unlinked-client

docker network create "${RUN_ID}" >/dev/null
run_variant defaults SERVER,CALL "${DB}"
run_variant calls-kept SERVER "${DB}" --set ebpf.dropUnlinkedDatabaseCalls=false
run_variant client-calls SERVER,CALL,CLIENT "${DB},${CLIENT}" --set ebpf.dropUnlinkedClientCalls=true
run_variant client-calls-db-calls-kept SERVER,CLIENT "${DB},${CLIENT}" \
  --set ebpf.dropUnlinkedClientCalls=true --set ebpf.dropUnlinkedDatabaseCalls=false
run_variant client-calls-only CLIENT "${CLIENT}" --set ebpf.dropUnlinkedClientCalls=true \
  --set ebpf.dropUnlinkedDatabaseCalls=false --set ebpf.dropDatabaseServerSpans=false
echo "==> the eBPF span filters behave as documented"
