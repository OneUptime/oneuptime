#!/usr/bin/env bash
#
# Run the real OpenTelemetry Collector over every collector config this repo
# ships and make it build the pipeline for real.
#
# `otelcol validate` is not a YAML check. It resolves every component id,
# constructs each receiver/processor/exporter, and — the reason this exists —
# builds the stanza operator graph inside the filelog receiver, which compiles
# the RE2 regexes and the expr-lang expressions. That is the whole class of
# error the jest suite in this directory cannot see: it parses the YAML with
# js-yaml and reasons about it, so a malformed regex, a bad `output`/`default`
# operator id, or an expr string one backslash short reads as a perfectly good
# string to it and as a collector that refuses to start to everyone else.
#
# The Kubernetes agent's config lives inside a Helm template, so it is rendered
# with `helm template` and lifted out of the ConfigMap first.
#
# Needs docker (to run the pinned collector image), helm and openssl. All three
# are present on GitHub-hosted ubuntu runners.
#
# Usage: bash Tests/Ops/validate-collector-configs.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The version the agent images are built FROM. Keep this in step with the
# Dockerfiles; validating against a different collector proves less than it
# looks, because operator and receiver schemas move between releases.
COLLECTOR_IMAGE="otel/opentelemetry-collector-contrib:0.161.0"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

# The collector image runs as a non-root user, so it cannot read into the 0700
# directory mktemp hands back. Nothing secret goes in here — the configs are all
# in the repo — so open it up rather than running the container as root.
chmod 0755 "${WORK_DIR}"

# `validate` does more than parse: components read the paths they were
# configured with while the pipeline is being built. The node collector's
# hostmetrics receiver checks its root_path, and kubeletstats, k8sattributes and
# the cadvisor prometheus receiver all read the service-account credentials they
# authenticate with. Those are real paths on a Kubernetes node and none of them
# exists in this container, so they are stubbed — which is what lets the
# DaemonSet config be validated AS SHIPPED, rather than with the receivers that
# are inconvenient to validate switched off.
#
# The CA has to be a certificate the Go x509 parser accepts, not a placeholder
# string: kubeletstats reads it through certutil, and a file it cannot parse
# fails the same way a missing one does. Nothing is signed or verified with it —
# `validate` never starts the pipeline, so nothing connects.
mkdir -p "${WORK_DIR}/hostfs" "${WORK_DIR}/serviceaccount"
echo "validate-only" >"${WORK_DIR}/serviceaccount/token"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj "/CN=otelcol-validate" \
  -keyout "${WORK_DIR}/serviceaccount/ca.key" \
  -out "${WORK_DIR}/serviceaccount/ca.crt" 2>/dev/null
chmod 0755 "${WORK_DIR}/hostfs" "${WORK_DIR}/serviceaccount"
chmod 0644 "${WORK_DIR}/serviceaccount/token" "${WORK_DIR}/serviceaccount/ca.crt"

SERVICE_ACCOUNT_DIR=/var/run/secrets/kubernetes.io/serviceaccount
STUB_MOUNTS=(
  -v "${WORK_DIR}/hostfs":/host:ro
  -v "${WORK_DIR}/serviceaccount/token":"${SERVICE_ACCOUNT_DIR}/token":ro
  -v "${WORK_DIR}/serviceaccount/ca.crt":"${SERVICE_ACCOUNT_DIR}/ca.crt":ro
)

# The configs reference these through ${env:...}. The values are never used —
# nothing connects during `validate` — but they have to resolve.
ENV_ARGS=(
  -e "ONEUPTIME_URL=https://oneuptime.example.com"
  -e "ONEUPTIME_SERVICE_TOKEN=validate-only"
  -e "ONEUPTIME_API_KEY=validate-only"
  -e "DOCKER_HOST_NAME=validate-only"
  -e "DOCKER_SWARM_CLUSTER_NAME=validate-only"
  -e "PODMAN_HOST_NAME=validate-only"
  # The docker_stats receiver's api_version. An unset variable resolves to an
  # empty string, which validate accepts and the receiver takes as "negotiate
  # with the daemon" (see ContainerAgentDockerApiVersion.test.js) — so validate
  # the value the images and compose files actually ship.
  -e "DOCKER_API_VERSION=1.44"
  -e "APP_VERSION=validate-only"
  -e "HOSTNAME=validate-only"
  -e "NODE_IP=127.0.0.1"
  -e "NODE_NAME=validate-only"
  # The node collector's kubeletstats and k8sattributes both construct a
  # Kubernetes client while the pipeline is being built, and client-go's
  # in-cluster config refuses to load without these two. Nothing connects —
  # `validate` never starts the pipeline — so any address will do. (The
  # service-account CA is optional to client-go, which only logs when it is
  # missing, so the token stub below is all the filesystem it needs.)
  -e "KUBERNETES_SERVICE_HOST=127.0.0.1"
  -e "KUBERNETES_SERVICE_PORT=6443"
  # The VMware agent (a native vcenter receiver, no exporter sidecar). The
  # receiver's config validation parses the endpoint as a URL and the TLS
  # flag as a boolean — an unset variable resolves to an empty string, which
  # fails both — so give them the shapes the compose file ships.
  -e "ONEUPTIME_TELEMETRY_INGESTION_KEY=validate-only"
  -e "VMWARE_VCENTER_NAME=validate-only"
  -e "VCENTER_ENDPOINT=https://vcenter.example.com"
  -e "VCENTER_USERNAME=validate-only"
  -e "VCENTER_PASSWORD=validate-only"
  -e "VCENTER_INSECURE_SKIP_VERIFY=true"
  -e "VCENTER_COLLECTION_INTERVAL=2m"
  # The Proxmox and Ceph agents (prometheus receivers scraping an exporter
  # and the mgr prometheus module). A scrape target has to parse as
  # host:port, and the Ceph targets are one YAML list, so give them the
  # shapes their compose files and install scripts write.
  -e "PROXMOX_CLUSTER_NAME=validate-only"
  -e "PVE_HOST=pve.example.com"
  -e "PVE_EXPORTER_URL=pve-exporter:9221"
  -e "CEPH_CLUSTER_NAME=validate-only"
  -e "CEPH_MGR_ENDPOINTS=[ceph-mon-1:9283,ceph-mon-2:9283]"
  # The Storage Array Agent (a prometheus receiver scraping a FlashArray's
  # native endpoint, or Pure's exporter sidecars). The prometheus receiver
  # parses the scrape target and the TLS flag (an unquoted boolean), and the
  # resource processor refuses to start on an empty array name — so give them
  # the shapes install.sh writes.
  -e "STORAGE_ARRAY_NAME=validate-only"
  -e "STORAGE_SYSTEM=purestorage.flasharray"
  -e "PURE_FA_ENDPOINT=flasharray.example.com"
  -e "PURE_FA_API_TOKEN=validate-only"
  -e "PURE_FB_ENDPOINT=flashblade.example.com"
  -e "PURE_FB_API_TOKEN=validate-only"
  -e "STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true"
  # The Database Agent (one config per engine under agents/DatabaseAgent/
  # configs). The postgresql receiver splits the endpoint as host:port and
  # refuses an empty username or password, the TLS flags and the two event
  # toggles are unquoted booleans, and the interval is a duration — so give
  # them the shapes install.sh writes. Query events are ON here because that
  # is the stricter path (the mongodb receiver validates its top-query
  # settings only when the event is enabled).
  -e "DATABASE_SYSTEM=validate-only"
  -e "DATABASE_ENDPOINT=db.example.com:5432"
  # The SQL Server receiver takes host and port apart (the port is an
  # integer field), and the Oracle receiver needs a service name.
  -e "DATABASE_ENDPOINT_HOST=db.example.com"
  -e "DATABASE_ENDPOINT_PORT=5432"
  -e "DATABASE_ORACLE_SERVICE=FREEPDB1"
  -e "DATABASE_SERVER_ADDRESS=db.example.com"
  -e "DATABASE_SERVER_PORT=5432"
  -e "DATABASE_USERNAME=validate-only"
  -e "DATABASE_PASSWORD=validate-only"
  -e "DATABASE_TLS_INSECURE=true"
  -e "DATABASE_TLS_INSECURE_SKIP_VERIFY=false"
  -e "DATABASE_COLLECTION_INTERVAL=30s"
  -e "DATABASE_QUERY_EVENTS=true"
  # The optional link to an existing database is EMPTY in a default install,
  # and an empty value is exactly what the resource processor refuses to
  # start with ("Either field value ... must be specified"). Validate that
  # case: the configs set it from a transform processor instead.
  -e "DATABASE_SERVER_ID="
)

failures=0

validate() {
  local label="$1"
  local config="$2"
  shift 2
  # Anything after the config: extra `-e NAME=value` overrides for this run.

  echo "==> ${label}"
  chmod 0644 "${config}"

  if docker run --rm \
    "${ENV_ARGS[@]}" \
    "$@" \
    "${STUB_MOUNTS[@]}" \
    -v "$(dirname "${config}")":/validate:ro \
    "${COLLECTOR_IMAGE}" \
    validate --config "/validate/$(basename "${config}")"; then
    echo "    ok"
  else
    echo "    FAILED: ${label}"
    failures=$((failures + 1))
  fi
}

for agent in DockerAgent PodmanAgent DockerSwarmAgent VMwareAgent ProxmoxAgent CephAgent; do
  # Copied into the work dir so every config is mounted from one place and the
  # bind mount cannot pick up anything else from the agent directory.
  cp "${REPO_ROOT}/agents/${agent}/otel-collector-config.yaml" "${WORK_DIR}/${agent}.yaml"
  validate "${agent}" "${WORK_DIR}/${agent}.yaml"
done

# The Storage Array Agent ships one config per way of reading an array:
# docker-compose.yml mounts the one STORAGE_ARRAY_COLLECTOR_CONFIG names (the
# FlashArray's native endpoint, or Pure's FlashArray / FlashBlade exporter).
# Every one of them is validated.
STORAGE_ARRAY_AGENT_CONFIGS=(
  otel-collector-config.yaml
  otel-collector-config.flasharray-exporter.yaml
  otel-collector-config.flashblade.yaml
)

for config in "${STORAGE_ARRAY_AGENT_CONFIGS[@]}"; do
  cp "${REPO_ROOT}/agents/StorageArrayAgent/${config}" "${WORK_DIR}/StorageArrayAgent-${config}"
  validate "StorageArrayAgent / ${config}" "${WORK_DIR}/StorageArrayAgent-${config}"
done

# STORAGE_ARRAY_NAME is stamped as storage.array.name by the resource
# processor, which refuses to start on an empty value — so an agent whose
# .env lost it fails loudly at startup instead of shipping data no array
# can claim.
if docker run --rm "${ENV_ARGS[@]}" -e "STORAGE_ARRAY_NAME=" "${STUB_MOUNTS[@]}" \
  -v "${WORK_DIR}":/validate:ro "${COLLECTOR_IMAGE}" \
  validate --config /validate/StorageArrayAgent-otel-collector-config.yaml >/dev/null 2>&1; then
  echo "    FAILED: StorageArrayAgent started with an empty STORAGE_ARRAY_NAME"
  failures=$((failures + 1))
else
  echo "==> StorageArrayAgent refuses an empty STORAGE_ARRAY_NAME: ok"
fi

# The Database Agent ships one config per receiver; install.sh downloads the
# chosen one as otel-collector-config.yaml. Every one of them is validated.
DATABASE_AGENT_ENGINES=(postgresql mysql redis mongodb sqlserver oracledb elasticsearch memcached)

# The per-config shape of DATABASE_ENDPOINT: a URL for the elasticsearch
# receiver (its scheme picks TLS), host:port everywhere else.
database_agent_env() {
  case "$1" in
    elasticsearch) printf '%s\n' -e "DATABASE_ENDPOINT=https://db.example.com:9200" ;;
  esac
}

for engine in "${DATABASE_AGENT_ENGINES[@]}"; do
  cp "${REPO_ROOT}/agents/DatabaseAgent/configs/${engine}.yaml" "${WORK_DIR}/DatabaseAgent-${engine}.yaml"
  mapfile -t engine_env < <(database_agent_env "${engine}")
  validate "DatabaseAgent / ${engine}" "${WORK_DIR}/DatabaseAgent-${engine}.yaml" ${engine_env[@]+"${engine_env[@]}"}
done

# DATABASE_SYSTEM is stamped as db.system.name by the resource processor,
# which refuses to start on an empty value — so an agent whose .env lost it
# fails loudly at startup instead of reporting under no engine.
if docker run --rm "${ENV_ARGS[@]}" -e "DATABASE_SYSTEM=" "${STUB_MOUNTS[@]}" \
  -v "${WORK_DIR}":/validate:ro "${COLLECTOR_IMAGE}" \
  validate --config /validate/DatabaseAgent-postgresql.yaml >/dev/null 2>&1; then
  echo "    FAILED: DatabaseAgent / postgresql started with an empty DATABASE_SYSTEM"
  failures=$((failures + 1))
else
  echo "==> DatabaseAgent refuses an empty DATABASE_SYSTEM: ok"
fi

# The Kubernetes agent, both of its collector ConfigMaps, rendered from the
# chart the way a user installs it. `--set logs.mode=daemonset` is what turns on
# the filelog receiver that carries the severity chain; without it the operator
# graph is not in the rendered output at all and this would validate nothing.
echo "==> rendering kubernetes-agent chart"
helm template validate "${REPO_ROOT}/HelmChart/Public/kubernetes-agent" \
  --set clusterName=validate-only \
  --set oneuptime.url=https://oneuptime.example.com \
  --set oneuptime.apiKey=validate-only \
  --set logs.enabled=true \
  --set logs.mode=daemonset \
  >"${WORK_DIR}/kubernetes-agent.rendered.yaml"

# js-yaml is a devDependency of this package, so the extraction runs with
# Tests/Ops as its working directory.
cd "${REPO_ROOT}/Tests/Ops"

node -e '
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const [rendered, outDir] = process.argv.slice(1);
const docs = yaml.loadAll(fs.readFileSync(rendered, "utf8"));
let found = 0;

for (const doc of docs) {
  if (!doc || doc.kind !== "ConfigMap" || !doc.data) {
    continue;
  }

  for (const [key, value] of Object.entries(doc.data)) {
    // A collector config has a service with pipelines. The OBI config of the
    // eBPF DaemonSet (obi-config.yaml) is YAML too, and with log correlation
    // on it carries `- service:` selectors. It is not a collector config, and
    // `otelcol validate` would reject it. (No apostrophes in this script: it
    // is inside a single-quoted shell string.)
    if (
      !key.endsWith(".yaml") ||
      !String(value).includes("service:") ||
      !String(value).includes("pipelines:")
    ) {
      continue;
    }

    // Parsing before writing it out means a ConfigMap whose collector config is
    // not even YAML fails here, naming the ConfigMap, rather than inside the
    // collector.
    yaml.load(value);
    const name = `k8s-${doc.metadata.name}.yaml`;
    fs.writeFileSync(path.join(outDir, name), value);
    console.log(name);
    found++;
  }
}

if (found === 0) {
  throw new Error(`${rendered}: no collector ConfigMap found to validate`);
}
' "${WORK_DIR}/kubernetes-agent.rendered.yaml" "${WORK_DIR}" >"${WORK_DIR}/k8s-configs.txt"

while read -r name; do
  validate "kubernetes-agent / ${name}" "${WORK_DIR}/${name}"
done <"${WORK_DIR}/k8s-configs.txt"

# The span filter ebpf.dropUnlinkedClientCalls adds to the traces pipeline is
# opt-in, so the render above does not have it. Validate the collector
# Deployment config with it on as well: its OTTL is then checked against this
# collector too, not only the one the chart ships
# (agent-trace-filter-behaviour.sh runs it there).
echo "==> rendering kubernetes-agent chart with ebpf.dropUnlinkedClientCalls=true"
helm template validate "${REPO_ROOT}/HelmChart/Public/kubernetes-agent" \
  --set clusterName=validate-only \
  --set oneuptime.url=https://oneuptime.example.com \
  --set oneuptime.apiKey=validate-only \
  --set ebpf.dropUnlinkedClientCalls=true \
  >"${WORK_DIR}/kubernetes-agent-client-calls.rendered.yaml"
node -e '
const fs = require("fs");
const yaml = require("js-yaml");

const [rendered, out] = process.argv.slice(1);
const configMap = yaml.loadAll(fs.readFileSync(rendered, "utf8")).find((doc) => {
  return doc && doc.kind === "ConfigMap" && doc.metadata.name === "validate-kubernetes-agent-deployment";
});
const config = configMap.data["otel-collector-config.yaml"];
if (!yaml.load(config).service.pipelines.traces.processors.includes("filter/ebpf-unlinked-client")) {
  throw new Error(`${rendered}: filter/ebpf-unlinked-client is not in the traces pipeline`);
}
fs.writeFileSync(out, config);
' "${WORK_DIR}/kubernetes-agent-client-calls.rendered.yaml" \
  "${WORK_DIR}/k8s-deployment-client-calls.yaml"
validate "kubernetes-agent / collector Deployment, ebpf.dropUnlinkedClientCalls=true" \
  "${WORK_DIR}/k8s-deployment-client-calls.yaml"

# The VMware config lists the receiver's optional metrics in a comment and
# tells users to enable any of them "the same way", and OneUptime's VMware
# metric catalog asks for three of them (vcenter.host.memory.active /
# .ballooned / .granted). A metric the pinned collector does not know is a
# config that refuses to start ("'metrics' has invalid keys"), which is what
# those three were on 0.154.0. So validate the config once more with every
# listed metric switched on.
node -e '
const fs = require("fs");
const yaml = require("js-yaml");

const [source, out] = process.argv.slice(1);
const text = fs.readFileSync(source, "utf8");
const listed = [...text.matchAll(/^\s*#\s+(vcenter\.[a-z0-9_.]+)\s/gm)].map(
  (match) => match[1],
);
if (listed.length === 0) {
  throw new Error(`${source}: found no optional vcenter metrics to enable`);
}
const config = yaml.load(text);
for (const metric of listed) {
  config.receivers.vcenter.metrics[metric] = { enabled: true };
}
fs.writeFileSync(out, yaml.dump(config));
console.log(listed.join(" "));
' "${REPO_ROOT}/agents/VMwareAgent/otel-collector-config.yaml" \
  "${WORK_DIR}/VMwareAgent-all-metrics.yaml"
validate "VMwareAgent, every optional metric its config lists enabled" \
  "${WORK_DIR}/VMwareAgent-all-metrics.yaml"

# Each Storage Array Agent config ships the syslog option commented out — a
# `syslog/tcp` / `syslog/udp` receiver pair and a `logs` pipeline — and tells
# users to uncomment it. Do exactly that (drop the `# ` each of those lines
# carries) and validate every config once more, so the option a user turns
# on is a config that starts. The YAML is checked to really carry both
# receivers and the pipeline, so an uncomment that matched nothing fails
# here instead of validating the config as shipped a second time.
for config in "${STORAGE_ARRAY_AGENT_CONFIGS[@]}"; do
  node -e '
const fs = require("fs");
const yaml = require("js-yaml");

const [source, out] = process.argv.slice(1);
const lines = [];
let prefix = null;
for (const line of fs.readFileSync(source, "utf8").split("\n")) {
  const header = line.match(/^( *)# (syslog\/(?:tcp|udp)|logs):$/);
  if (header) {
    prefix = header[1];
    lines.push(prefix + line.slice(prefix.length + 2));
    continue;
  }
  if (prefix !== null && line.startsWith(prefix + "#   ")) {
    lines.push(prefix + line.slice(prefix.length + 2));
    continue;
  }
  prefix = null;
  lines.push(line);
}
const text = lines.join("\n");
const config = yaml.load(text);
const logs = config.service.pipelines.logs;
if (
  !config.receivers["syslog/tcp"] ||
  !config.receivers["syslog/udp"] ||
  !logs ||
  logs.receivers.join(",") !== "syslog/tcp,syslog/udp"
) {
  throw new Error(`${source}: uncommenting found no syslog receivers / logs pipeline`);
}
fs.writeFileSync(out, text);
' "${REPO_ROOT}/agents/StorageArrayAgent/${config}" \
    "${WORK_DIR}/StorageArrayAgent-syslog-${config}"
  validate "StorageArrayAgent / ${config}, with the syslog receivers uncommented" \
    "${WORK_DIR}/StorageArrayAgent-syslog-${config}"
done

# Each Database Agent config lists its receiver's other optional metrics in a
# comment and tells users to enable any of them "the same way". A metric the
# pinned collector does not know is a config that refuses to start, so
# validate every config once more with every listed metric switched on.
# Memcached's receiver has no optional metric, so its config lists none.
DATABASE_AGENT_ENGINES_WITHOUT_OPTIONAL_METRICS=" memcached "
for engine in "${DATABASE_AGENT_ENGINES[@]}"; do
  case "${DATABASE_AGENT_ENGINES_WITHOUT_OPTIONAL_METRICS}" in
    *" ${engine} "*) continue ;;
  esac
  node -e '
const fs = require("fs");
const yaml = require("js-yaml");

const [source, out, engine] = process.argv.slice(1);
const text = fs.readFileSync(source, "utf8");
const pattern = new RegExp(`^\\s*#\\s+(${engine}\\.[a-z0-9_.]+)\\s`, "gm");
const listed = [...text.matchAll(pattern)].map((match) => match[1]);
if (listed.length === 0) {
  throw new Error(`${source}: found no optional ${engine} metrics to enable`);
}
const config = yaml.load(text);
config.receivers[engine].metrics = config.receivers[engine].metrics || {};
for (const metric of listed) {
  config.receivers[engine].metrics[metric] = { enabled: true };
}
fs.writeFileSync(out, yaml.dump(config));
console.log(listed.join(" "));
' "${REPO_ROOT}/agents/DatabaseAgent/configs/${engine}.yaml" \
    "${WORK_DIR}/DatabaseAgent-${engine}-all-metrics.yaml" "${engine}"
  mapfile -t engine_env < <(database_agent_env "${engine}")
  validate "DatabaseAgent / ${engine}, every optional metric its config lists enabled" \
    "${WORK_DIR}/DatabaseAgent-${engine}-all-metrics.yaml" ${engine_env[@]+"${engine_env[@]}"}
done

if [ "${failures}" -ne 0 ]; then
  echo
  echo "${failures} collector config(s) failed validation"
  exit 1
fi

echo
echo "all collector configs validated against ${COLLECTOR_IMAGE}"
