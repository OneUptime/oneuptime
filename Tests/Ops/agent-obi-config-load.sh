#!/usr/bin/env bash
#
# Load the Kubernetes agent's OBI (OpenTelemetry eBPF Instrumentation)
# configuration — the config file and the eBPF DaemonSet's env, exactly as the
# chart renders them — in the OBI image the chart pins, and check what OBI
# makes of it.
#
# Why this exists: the helm-unittest suite pins the config file and the env as
# TEXT, and text cannot tell whether OBI accepts them or what it does with
# them. Each of these has bitten, or nearly:
#
#   - OBI (since v0.11) refuses to start on a metrics feature it does not know, so
#     the `application_host` the chart used to pass crash-loops every node on
#     v0.14. A wrong config is a DaemonSet that never comes up.
#   - OBI's YAML loader ignores keys it does not know, so a setting OBI renamed
#     is not an error: it is a setting that quietly stopped doing anything.
#   - A second top-level `ebpf:` key (the log enricher already renders one) is
#     a YAML parse error.
#   - A non-empty attributes.select.traces.include REPLACES OBI's default span
#     attributes rather than adding to them.
#   - A feature OBI deprecated still loads, with a warning on every start, until
#     the release that removes it refuses to start (`application_span`, which
#     the chart passed until it moved to `application_span_otel`).
#
# Only the OBI build the agent runs can tell those apart from a config that
# works. It loads and validates its configuration and, with
# OTEL_EBPF_LOG_CONFIG=yaml, prints the EFFECTIVE result before it touches
# eBPF. So each render is loaded UNPRIVILEGED — all capabilities dropped, no
# network, read-only root; never --privileged, never --pid=host — and the
# container is removed once the dump is out (it would give up moments later,
# for lack of privileges). The dump is then checked against the render and
# against what each variant is meant to switch on.
#
# The image is the one the chart renders, so bumping ebpf.image.tag re-runs
# all of this on the new OBI. OBI_IMAGE overrides it, to try an OBI build
# that is not tagged yet:
#
#   OBI_IMAGE=otel/ebpf-instrument:main bash Tests/Ops/agent-obi-config-load.sh
#
# Without the override, a tag nobody can pull fails this test, on purpose: a
# chart pinning an image that does not exist puts every node in
# ImagePullBackOff. Checks that only apply to some OBI versions (the span
# attribute selection the chart renders for v0.14+, the trace-context setting
# v0.14 added) follow the rendered tag and the version OBI reports, so the
# same script covers the pinned release and a newer build tried with
# OBI_IMAGE. The one variant that renders an older tag on purpose (v0.13.0,
# the release a --reuse-values upgrade keeps) always loads in that tag.
#
# Needs docker, helm and node. Usage: bash Tests/Ops/agent-obi-config-load.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART="${REPO_ROOT}/HelmChart/Public/kubernetes-agent"
RUN_ID="agent-obi-config-load-$$"
# What OBI logs right before it prints its effective configuration.
MARKER="Running OpenTelemetry eBPF Instrumentation with configuration"
FAILURES=0

WORK_DIR="$(mktemp -d)"
cleanup() {
  docker rm -f "${RUN_ID}" >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

# js-yaml is a devDependency of this package.
cd "${REPO_ROOT}/Tests/Ops"

render() {
  local dir="$1"
  shift
  mkdir -p "${dir}/config"
  helm template behaviour "${CHART}" \
    --set clusterName=obi-config-load \
    --set oneuptime.url=https://oneuptime.example.com \
    --set oneuptime.apiKey=obi-config-load \
    "$@" >"${dir}/rendered.yaml"
}

# Lift the eBPF DaemonSet's image, env and config mount, and the ConfigMap it
# mounts, out of the render, so this loads what ships rather than a copy of it.
# Writes config/ (the ConfigMap's files), env.list (docker --env-file),
# obi-config.rendered.yaml (the file OTEL_EBPF_CONFIG_PATH names), mount-path
# and image.
extract() {
  node -e '
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const dir = process.argv[1];
const docs = yaml.loadAll(fs.readFileSync(`${dir}/rendered.yaml`, "utf8")).filter(Boolean);

const daemonSet = docs.find((d) => {
  return d.kind === "DaemonSet" && d.spec.template.metadata.labels.component === "ebpf-instrument";
});
if (!daemonSet) {
  throw new Error("the eBPF DaemonSet is not in the render");
}
const pod = daemonSet.spec.template.spec;
const container = pod.containers.find((c) => {
  return c.name === "ebpf-instrument";
});

// The ConfigMap volume OBI reads its file from, and where it is mounted.
const mounts = (container.volumeMounts || []).filter((m) => {
  const volume = (pod.volumes || []).find((v) => {
    return v.name === m.name;
  });
  return volume && volume.configMap;
});
if (mounts.length !== 1) {
  throw new Error(`expected one ConfigMap mount on the OBI container, found ${mounts.length}`);
}
const mount = mounts[0];
const configMapName = pod.volumes.find((v) => {
  return v.name === mount.name;
}).configMap.name;
const configMap = docs.find((d) => {
  return d.kind === "ConfigMap" && d.metadata.name === configMapName;
});
if (!configMap) {
  throw new Error(`the ConfigMap ${configMapName} the DaemonSet mounts is not in the render`);
}
for (const [key, content] of Object.entries(configMap.data || {})) {
  fs.writeFileSync(`${dir}/config/${key}`, content);
}

// Env as the kubelet would hand it over. Downward-API values are stubbed;
// OTEL_EBPF_LOG_CONFIG=yaml is what makes OBI print its effective config.
const lines = [];
let configPath = null;
for (const entry of container.env || []) {
  let value = entry.value === undefined ? "" : String(entry.value);
  if (entry.valueFrom) {
    const fieldPath = entry.valueFrom.fieldRef && entry.valueFrom.fieldRef.fieldPath;
    if (fieldPath === "spec.nodeName") {
      value = "obi-config-load-node";
    } else if (fieldPath === "metadata.namespace") {
      value = daemonSet.metadata.namespace;
    } else {
      value = `stub-${entry.name.toLowerCase()}`;
    }
  }
  if (value.includes("\n")) {
    throw new Error(`${entry.name} has a multi-line value, which docker --env-file cannot carry`);
  }
  if (entry.name === "OTEL_EBPF_LOG_CONFIG") {
    continue;
  }
  if (entry.name === "OTEL_EBPF_CONFIG_PATH") {
    configPath = value;
  }
  lines.push(`${entry.name}=${value}`);
}
lines.push("OTEL_EBPF_LOG_CONFIG=yaml");

if (!configPath) {
  throw new Error("OTEL_EBPF_CONFIG_PATH is not set: OBI would not read the config file at all");
}
const key = path.posix.relative(mount.mountPath, configPath);
if (key.includes("/") || !configMap.data || configMap.data[key] === undefined) {
  throw new Error(`OTEL_EBPF_CONFIG_PATH=${configPath} is not a file of the ConfigMap mounted at ${mount.mountPath}`);
}
fs.copyFileSync(`${dir}/config/${key}`, `${dir}/obi-config.rendered.yaml`);
fs.writeFileSync(`${dir}/env.list`, lines.join("\n") + "\n");
const annotations = (daemonSet.spec.template.metadata || {}).annotations || {};
fs.writeFileSync(`${dir}/checksum`, annotations["checksum/config"] || "");
fs.writeFileSync(`${dir}/mount-path`, mount.mountPath);
fs.writeFileSync(`${dir}/image`, container.image);
' "$1"
  # OBI runs as root, but with every capability dropped root reads only what
  # the mode bits allow, and the files are not its own.
  chmod 0755 "$1/config"
  chmod 0644 "$1"/config/*
}

# The OBI image to load a render in: the one the render names, unless
# OBI_IMAGE overrides it. Pulled when it is not local yet.
obi_image() {
  local image="${OBI_IMAGE:-$(cat "$1/image")}"
  # A variant that renders an older ebpf.image.tag on purpose loads it in that
  # image, whatever OBI_IMAGE says.
  if [ -n "${PIN_IMAGE:-}" ]; then
    image="$(cat "$1/image")"
  fi
  if ! docker image inspect "${image}" >/dev/null 2>&1; then
    if ! docker pull -q "${image}" >/dev/null 2>"${WORK_DIR}/pull.err"; then
      echo "    FAILED: cannot pull ${image}" >&2
      sed 's/^/      /' "${WORK_DIR}/pull.err" >&2
      if [ -z "${OBI_IMAGE:-}" ]; then
        echo "    The chart pins an OBI image that cannot be pulled, so every node would sit in ImagePullBackOff. If the tag is just not published yet, this stays red until it is (OBI_IMAGE=<image> tries another build meanwhile)." >&2
      fi
      exit 1
    fi
  fi
  echo "${image}"
}

# True once OBI has printed the whole dump: it ends with an empty line, and a
# log line follows it soon after.
dump_complete() {
  awk -v marker="${MARKER}" '
    seen && (/^time=/ || /^$/) { complete = 1 }
    index($0, marker) { seen = 1 }
    END { exit complete ? 0 : 1 }
  ' "$1"
}

# Run OBI unprivileged on one render until its configuration is out (about a
# second), or it exits, or a minute passes. Leaves stdout.log (slog and the
# dump), stderr.log (where OBI reports a config it cannot load: that happens
# before its own logger is set up) and state ("<status> <exit code>").
run_obi() {
  local dir="$1"
  local env_file="$2"
  local image="$3"
  local state=""
  docker rm -f "${RUN_ID}" >/dev/null 2>&1 || true
  docker run -d --name "${RUN_ID}" \
    --cap-drop ALL --network none --read-only \
    --env-file "${env_file}" \
    -v "${dir}/config":"$(cat "${dir}/mount-path")":ro \
    "${image}" >/dev/null
  for _ in $(seq 1 120); do
    docker logs "${RUN_ID}" >"${dir}/stdout.log" 2>"${dir}/stderr.log"
    if dump_complete "${dir}/stdout.log"; then
      break
    fi
    state="$(docker inspect -f '{{.State.Status}}' "${RUN_ID}")"
    if [ "${state}" = "exited" ] || [ "${state}" = "dead" ]; then
      break
    fi
    sleep 0.5
  done
  # Again: a container that just exited may have written more since.
  docker logs "${RUN_ID}" >"${dir}/stdout.log" 2>"${dir}/stderr.log"
  docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "${RUN_ID}" >"${dir}/state"
  docker rm -f "${RUN_ID}" >/dev/null 2>&1 || true
}

# Prints why OBI did not load a render, or nothing when it did. Anything
# logged at ERROR before the dump counts; after it, the errors are the
# expected ones about missing privileges.
load_problems() {
  local dir="$1"
  cat "${dir}/stdout.log" "${dir}/stderr.log" |
    grep -E 'wrong configuration|parsing YAML configuration' || true
  # A deprecated metrics feature counts too: OBI (v0.12.2+) loads it with a
  # warning on every start, and the release that drops it refuses to start.
  cat "${dir}/stdout.log" "${dir}/stderr.log" |
    grep -E 'metrics feature is deprecated' || true
  awk -v marker="${MARKER}" 'index($0, marker) { exit } /level=ERROR/' "${dir}/stdout.log"
  if ! grep -qF "${MARKER}" "${dir}/stdout.log"; then
    echo "OBI never printed its configuration (container: $(cat "${dir}/state"))"
  fi
}

show_logs() {
  echo "      last log lines:"
  {
    grep -E '^time=' "$1/stdout.log" || true
    cat "$1/stderr.log"
  } | tail -20 | sed 's/^/      /'
}

# variant <name> <expected, as JSON overrides of the defaults below> [helm args...]
variant() {
  local name="$1"
  local expected="$2"
  shift 2
  local dir="${WORK_DIR}/${name}"
  local image
  local problems

  echo "==> ${name}"
  render "${dir}" "$@"
  extract "${dir}"
  image="$(obi_image "${dir}")"
  echo "${image}" >"${dir}/obi-image"
  echo "    loading it in ${image}"
  run_obi "${dir}" "${dir}/env.list" "${image}"

  problems="$(load_problems "${dir}")"
  if [ -n "${problems}" ]; then
    echo "    FAILED: ${image} did not load this render"
    echo "${problems}" | sed 's/^/      /'
    show_logs "${dir}"
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  if ! node -e '
const fs = require("fs");
const yaml = require("js-yaml");
const [dir, marker, overrides] = process.argv.slice(1);

const lines = fs.readFileSync(`${dir}/stdout.log`, "utf8").split("\n");
const start = lines.findIndex((l) => {
  return l.includes(marker);
}) + 1;
let end = start;
while (end < lines.length && !lines[end].startsWith("time=")) {
  end++;
}
const effective = yaml.load(lines.slice(start, end).join("\n"));
const rendered = yaml.load(fs.readFileSync(`${dir}/obi-config.rendered.yaml`, "utf8")) || {};

// OBI v0.14 span attributes that are on unless a selection says otherwise
// (pkg/export/attributes/attr_defs.go, the Traces section). The chart has to
// list them all next to service.peer.name, which v0.14 made opt-in and the
// service map reads: a non-empty include list replaces these.
const DEFAULT_SPAN_ATTRIBUTES_VERIFIED_FOR = "v0.14.0";
const DEFAULT_SPAN_ATTRIBUTES = [
  "dns.question.name",
  "url.query",
  "error.type",
  "http.request.method_original",
  "db.query.summary",
  "user_agent.original",
  "network.peer.address",
  "network.peer.port",
  "network.protocol.version",
];
const expected = Object.assign(
  {
    features: [
      "application",
      "application_span_otel",
      "application_service_graph",
      "network",
      "stats_tcp_rtt",
      "stats_tcp_failed_connections",
      "stats_tcp_retransmits",
    ],
    instrument: [{ exe_path: "*", k8s_namespace: "*" }],
    routes: null,
    logCorrelation: false,
    populateTraceContext: false,
    contextPropagation: "disabled",
    trackRequestHeaders: false,
    tracePrinter: "disabled",
    nodejs: true,
    excludeOtelInstrumentedServices: true,
    traceAttributes: DEFAULT_SPAN_ATTRIBUTES.concat(["service.peer.name"]),
  },
  JSON.parse(overrides),
);

function get(object, dotted) {
  return dotted.split(".").reduce((value, key) => {
    return value === null || value === undefined ? undefined : value[key];
  }, object);
}
function isEmpty(value) {
  if (value === "" || value === null || value === undefined || value === false) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return typeof value === "object" && Object.keys(value).length === 0;
}
// OBI prints every field of a selector, set or not; keep only the set ones,
// with keys sorted, so it compares with the few the chart writes.
function compact(value) {
  if (Array.isArray(value)) {
    return value.map(compact);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const inner = compact(value[key]);
      if (!isEmpty(inner)) {
        out[key] = inner;
      }
    }
    return out;
  }
  return value;
}
function same(a, b) {
  return JSON.stringify(compact(a)) === JSON.stringify(compact(b));
}
function sorted(list) {
  return (list || []).slice().sort();
}

let failures = 0;
function check(label, ok, actual) {
  console.log(`    ${ok ? "ok    " : "FAILED"} ${label}${ok ? "" : ` (OBI has: ${JSON.stringify(compact(actual))})`}`);
  if (!ok) {
    failures++;
  }
}

const features = get(effective, "metrics.features");
check(
  `metrics.features = ${expected.features.join(",")}`,
  same(sorted(features), sorted(expected.features)),
  features,
);

// Span metrics by their current name: OBI warns about the deprecated
// application_span (v0.12.2+) and refuses it next to application_span_otel.
check(
  "metrics.features asks for span metrics as application_span_otel, never application_span",
  !(features || []).includes("application_span") &&
    (features || []).includes("application_span_otel") === expected.features.includes("application_span_otel"),
  features,
);

const instrument = get(effective, "discovery.instrument");
check("discovery.instrument is the rendered selectors", same(instrument, get(rendered, "discovery.instrument")), instrument);
check(`discovery.instrument = ${JSON.stringify(expected.instrument)}`, same(instrument, expected.instrument), instrument);
const exclude = get(effective, "discovery.exclude_instrument");
check(
  "discovery.exclude_instrument is the rendered selectors",
  !isEmpty(compact(exclude)) && same(exclude, get(rendered, "discovery.exclude_instrument")),
  exclude,
);
// OBI ORs these older top-level selectors in with discovery.instrument, so
// any of them set would instrument processes the namespace rules leave out.
for (const legacy of ["executable_path", "autotargetexe", "open_port", "autotargetlanguage", "target_pids"]) {
  check(`${legacy} is not set`, isEmpty(compact(effective[legacy])), effective[legacy]);
}

const routes = effective.routes || {};
for (const [key, value] of Object.entries(rendered.routes || {})) {
  check(`routes.${key} is the rendered ${JSON.stringify(value)}`, same(routes[key], value), routes[key]);
}
if (expected.routes) {
  for (const [key, value] of Object.entries(expected.routes)) {
    check(`routes.${key} = ${JSON.stringify(value)}`, same(routes[key], value), routes[key]);
  }
} else {
  check("routes.patterns is empty", isEmpty(compact(routes.patterns)), routes.patterns);
}

const enricher = get(effective, "ebpf.log_enricher") || {};
if (expected.logCorrelation) {
  check(
    "ebpf.log_enricher.services is the rendered selector",
    !isEmpty(compact(enricher.services)) && same(enricher.services, get(rendered, "ebpf.log_enricher.services")),
    enricher.services,
  );
  check("ebpf.log_enricher.plain_text.enabled = false", get(enricher, "plain_text.enabled") === false, enricher.plain_text);
} else {
  check("ebpf.log_enricher.services is empty (enricher off)", isEmpty(compact(enricher.services)), enricher.services);
  check("ebpf.log_enricher.plain_text.enabled = true (untouched)", get(enricher, "plain_text.enabled") === true, enricher.plain_text);
}

// ebpf.populate_trace_context exists from OBI v0.14; an older OBI always
// fills the map, has no such setting, and ignores the env var.
const versionLine = lines.find((l) => {
  return l.includes("msg=\"OpenTelemetry eBPF Instrumentation\"");
}) || "";
const obiVersionMatch = /Version=v?(\d+)\.(\d+)\.(\d+)/.exec(versionLine);
const obiHasPopulate = !obiVersionMatch ||
  Number(obiVersionMatch[1]) > 0 || Number(obiVersionMatch[2]) >= 14;
const populate = get(effective, "ebpf.populate_trace_context");
if (obiHasPopulate) {
  check(`ebpf.populate_trace_context = ${expected.populateTraceContext}`, populate === expected.populateTraceContext, populate);
} else {
  check("ebpf.populate_trace_context unknown to this OBI (it always fills the map)", populate === undefined, populate);
}

// The chart renders its span-attribute list (the v0.14 defaults plus
// service.peer.name) only for an OBI tag of v0.14 or later, or one that is
// not a version: the same rule as kubernetes-agent.obiSelectsSpanAttributes.
const renderedImage = fs.readFileSync(`${dir}/image`, "utf8").trim();
const renderedTag = renderedImage.slice(renderedImage.lastIndexOf(":") + 1);
// A variant pinned to an older OBI (PIN_IMAGE) has to have run in it, or
// every check here tested another release.
if (process.env.PIN_IMAGE) {
  check(`OBI reports ${renderedTag}, the release the render pins`, versionLine.includes(`Version=${renderedTag} `), versionLine);
}
const tagVersion = /^v?(\d+)\.(\d+)\.(\d+)/.exec(renderedTag);
const chartSelectsAttributes = !tagVersion ||
  Number(tagVersion[1]) > 0 || Number(tagVersion[2]) >= 14;
const include = get(effective, "attributes.select.traces.include");
if (chartSelectsAttributes) {
  check(
    `attributes.select.traces.include = OBI defaults + service.peer.name`,
    same(sorted(include), sorted(expected.traceAttributes)),
    include,
  );
  // OBI echoes the list it was given, not the defaults it would otherwise
  // use, so the check above compares the chart with
  // DEFAULT_SPAN_ATTRIBUTES, which is a hand copy. Tie that copy to the OBI
  // it was read from: a chart that pins another tag must have it re-read.
  check(
    `the chart pins the OBI the default span attributes were read from (${DEFAULT_SPAN_ATTRIBUTES_VERIFIED_FOR})`,
    renderedTag === DEFAULT_SPAN_ATTRIBUTES_VERIFIED_FOR,
    `${renderedImage}: re-read the true entries of Traces.Section in pkg/export/attributes/attr_defs.go of that OBI, update DEFAULT_SPAN_ATTRIBUTES here and kubernetes-agent.obiSpanAttributes in the chart, then DEFAULT_SPAN_ATTRIBUTES_VERIFIED_FOR`,
  );
} else {
  check(
    `no span-attribute selection for ${renderedTag}: OBI keeps its own defaults`,
    isEmpty(include) && rendered.attributes === undefined,
    include,
  );
}

// The DaemonSet rolls when the config changes only if its checksum is of the
// config OBI reads. (The ConfigMap value carries the newline a YAML block
// scalar adds; the template hashes the text without it.)
const checksum = fs.readFileSync(`${dir}/checksum`, "utf8").trim();
const configText = fs.readFileSync(`${dir}/obi-config.rendered.yaml`, "utf8").replace(/\n$/, "");
const configHash = require("crypto").createHash("sha256").update(configText).digest("hex");
check("the DaemonSet checksum/config is the sha256 of the OBI config", checksum === configHash, `${checksum} vs ${configHash}`);

const nodejs = get(effective, "nodejs.enabled");
check(`nodejs.enabled = ${expected.nodejs}`, nodejs === expected.nodejs, nodejs);
const excludeOtel = get(effective, "discovery.exclude_otel_instrumented_services");
check(
  `discovery.exclude_otel_instrumented_services = ${expected.excludeOtelInstrumentedServices}`,
  excludeOtel === expected.excludeOtelInstrumentedServices,
  excludeOtel,
);
const propagation = get(effective, "ebpf.context_propagation");
check(`ebpf.context_propagation = ${expected.contextPropagation}`, propagation === expected.contextPropagation, propagation);
const trackHeaders = get(effective, "ebpf.track_request_headers");
check(`ebpf.track_request_headers = ${expected.trackRequestHeaders}`, trackHeaders === expected.trackRequestHeaders, trackHeaders);
check(`trace_printer = ${expected.tracePrinter}`, effective.trace_printer === expected.tracePrinter, effective.trace_printer);
const kube = get(effective, "attributes.kubernetes") || {};
check(
  "attributes.kubernetes: enabled, for cluster obi-config-load",
  String(kube.enable) === "true" && kube.cluster_name === "obi-config-load",
  { enable: kube.enable, cluster_name: kube.cluster_name },
);

process.exit(failures > 0 ? 1 : 0);
' "${dir}" "${MARKER}" "${expected}"; then
    FAILURES=$((FAILURES + 1))
  fi
}

# Values for the variants that set more than a key or two.
cat >"${WORK_DIR}/routes.yaml" <<'EOF'
ebpf:
  routes:
    patterns:
      - "/api/items/{id}"
      - "/otlp/v1/{signal}"
      - "/users/:id"
    unmatched: low-cardinality
EOF
cat >"${WORK_DIR}/namespace-include.yaml" <<'EOF'
namespaceFilters:
  rules:
    - action: include
      namespaces: ["oneuptime", "app-*"]
      scopes: ["ebpfDiscovery"]
EOF
cat >"${WORK_DIR}/all-on.yaml" <<'EOF'
ebpf:
  printTraces: true
  features:
    httpMetrics: true
    spanMetrics: true
    serviceGraph: true
    hostMetrics: true
    networkMetrics: true
    networkInterZoneMetrics: true
    tcpStats: true
  contextPropagation: true
  trackRequestHeaders: true
EOF
cat >"${WORK_DIR}/all-off.yaml" <<'EOF'
ebpf:
  features:
    httpMetrics: false
    spanMetrics: false
    serviceGraph: false
    hostMetrics: false
    networkMetrics: false
    networkInterZoneMetrics: false
    tcpStats: false
  nodejs:
    enabled: false
  excludeOtelInstrumentedServices: false
EOF

variant defaults '{}'
# A values file from before v0.14 that still turns hostMetrics on: the chart
# must not pass `application_host`, which OBI v0.14 refuses to start on.
variant old-host-metrics '{}' --set ebpf.features.hostMetrics=true
variant log-correlation '{"logCorrelation":true}' --set ebpf.logToTraceCorrelation=true
variant routes \
  '{"routes":{"unmatched":"low-cardinality","patterns":["/api/items/{id}","/otlp/v1/{signal}","/users/:id"]}}' \
  -f "${WORK_DIR}/routes.yaml"
variant namespace-include \
  '{"instrument":[{"exe_path":"*","k8s_namespace":"oneuptime"},{"exe_path":"*","k8s_namespace":"app-*"}]}' \
  -f "${WORK_DIR}/namespace-include.yaml"
variant all-on \
  '{"features":["application","application_span_otel","application_service_graph","network","network_inter_zone","stats_tcp_rtt","stats_tcp_failed_connections","stats_tcp_retransmits"],"contextPropagation":"headers","trackRequestHeaders":true,"tracePrinter":"text"}' \
  -f "${WORK_DIR}/all-on.yaml"
# With every feature off the chart renders OTEL_EBPF_METRICS_FEATURES="", and
# OBI reads an empty variable as an unset one: it keeps its own default,
# `application` (HTTP/gRPC RED metrics and body sizes). There is no OBI token
# for "none".
variant all-off \
  '{"features":["application"],"nodejs":false,"excludeOtelInstrumentedServices":false}' \
  -f "${WORK_DIR}/all-off.yaml"
# The profiler correlates samples with spans through OBI's traces_ctx_v1 pin,
# which v0.14 only fills when asked to (or for its own log enricher).
variant profiling '{"populateTraceContext":true}' --set profiling.enabled=true
variant span-metrics-off \
  '{"features":["application","application_service_graph","network","stats_tcp_rtt","stats_tcp_failed_connections","stats_tcp_retransmits"]}' \
  --set ebpf.features.spanMetrics=false
# The release a --reuse-values upgrade keeps (README, "Upgrading"): v0.13.0
# also deprecates application_span, and has to take the same render, minus the
# v0.14-only span-attribute selection. Loaded in v0.13.0 even with OBI_IMAGE.
PIN_IMAGE=1 variant pinned-v0.13.0 '{}' --set ebpf.image.tag=v0.13.0

# Negative control: the default render with a metrics feature no OBI knows —
# the failure class that application_host would have caused on v0.14. If this
# "loads", the checks above prove nothing.
UNKNOWN_FEATURE="not_an_obi_feature"
echo "==> negative control: OTEL_EBPF_METRICS_FEATURES=${UNKNOWN_FEATURE}"
control="${WORK_DIR}/negative-control"
mkdir -p "${control}"
cp -R "${WORK_DIR}/defaults/config" "${control}/config"
cp "${WORK_DIR}/defaults/mount-path" "${control}/"
{
  grep -v '^OTEL_EBPF_METRICS_FEATURES=' "${WORK_DIR}/defaults/env.list"
  echo "OTEL_EBPF_METRICS_FEATURES=${UNKNOWN_FEATURE}"
} >"${control}/env.list"
run_obi "${control}" "${control}/env.list" "$(cat "${WORK_DIR}/defaults/obi-image")"
problems="$(load_problems "${control}")"
if [ "$(cut -d' ' -f1 "${control}/state")" = "exited" ] &&
  [ "$(cut -d' ' -f2 "${control}/state")" != "0" ] &&
  echo "${problems}" | grep -qE "unknown metrics feature [^ ]*${UNKNOWN_FEATURE}"; then
  echo "    ok     OBI refused it (exit $(cut -d' ' -f2 "${control}/state")) and the harness caught it"
else
  echo "    FAILED: expected OBI to exit non-zero with unknown metrics feature \"${UNKNOWN_FEATURE}\" (container: $(cat "${control}/state"))"
  echo "${problems}" | sed 's/^/      /'
  show_logs "${control}"
  FAILURES=$((FAILURES + 1))
fi

# Negative control for the deprecation check: the default render with the
# chart's old span-metrics token. OBI has to warn about it (v0.12.2 to at
# least v0.14) or, once it drops the name, refuse it; either way
# load_problems has to report it, or its deprecation check proves nothing.
echo "==> negative control: OTEL_EBPF_METRICS_FEATURES with the deprecated application_span"
legacy="${WORK_DIR}/negative-control-legacy-span"
mkdir -p "${legacy}"
cp -R "${WORK_DIR}/defaults/config" "${legacy}/config"
cp "${WORK_DIR}/defaults/mount-path" "${legacy}/"
sed 's/^OTEL_EBPF_METRICS_FEATURES=\(.*\)application_span_otel/OTEL_EBPF_METRICS_FEATURES=\1application_span/' \
  "${WORK_DIR}/defaults/env.list" >"${legacy}/env.list"
if ! grep -qE '^OTEL_EBPF_METRICS_FEATURES=(.*,)?application_span(,|$)' "${legacy}/env.list"; then
  echo "    FAILED: could not swap application_span into the default env (the default no longer has application_span_otel?)"
  FAILURES=$((FAILURES + 1))
else
  run_obi "${legacy}" "${legacy}/env.list" "$(cat "${WORK_DIR}/defaults/obi-image")"
  problems="$(load_problems "${legacy}")"
  if echo "${problems}" | grep -qE 'metrics feature is deprecated.*feature=application_span use=application_span_otel|unknown metrics feature [^ ]*application_span'; then
    echo "    ok     OBI flagged application_span and the harness caught it"
  else
    echo "    FAILED: expected OBI to warn that application_span is deprecated, or to refuse it (container: $(cat "${legacy}/state"))"
    echo "${problems}" | sed 's/^/      /'
    show_logs "${legacy}"
    FAILURES=$((FAILURES + 1))
  fi
fi

if [ "${FAILURES}" -gt 0 ]; then
  echo "${FAILURES} of the runs above failed" >&2
  exit 1
fi
echo "==> every rendered OBI configuration loads, and does what it says, on $(cat "${WORK_DIR}/defaults/obi-image")"
