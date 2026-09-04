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
COLLECTOR_IMAGE="otel/opentelemetry-collector-contrib:0.154.0"

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
  # empty string, which validate accepts and the receiver reads as its own 1.25
  # default — so validate the value the images and compose files actually ship.
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
)

failures=0

validate() {
  local label="$1"
  local config="$2"

  echo "==> ${label}"
  chmod 0644 "${config}"

  if docker run --rm \
    "${ENV_ARGS[@]}" \
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

for agent in DockerAgent PodmanAgent DockerSwarmAgent; do
  # Copied into the work dir so every config is mounted from one place and the
  # bind mount cannot pick up anything else from the agent directory.
  cp "${REPO_ROOT}/${agent}/otel-collector-config.yaml" "${WORK_DIR}/${agent}.yaml"
  validate "${agent}" "${WORK_DIR}/${agent}.yaml"
done

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
    if (!key.endsWith(".yaml") || !String(value).includes("service:")) {
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

if [ "${failures}" -ne 0 ]; then
  echo
  echo "${failures} collector config(s) failed validation"
  exit 1
fi

echo
echo "all collector configs validated against ${COLLECTOR_IMAGE}"
