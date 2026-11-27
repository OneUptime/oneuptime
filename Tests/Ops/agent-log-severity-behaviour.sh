#!/usr/bin/env bash
#
# Run the agents' log severity chain in the real collector, with each config
# exactly as it ships, over the corpus of Tests/Ops/Utils/LogSeverityCorpus.js
# (real log lines, many of them captured from the programs that write them),
# and check the level every record leaves with.
#
# Why this exists (issue #10972): container runtimes record no severity, so
# the agents read one off the line, and for the lines they could not read
# they guessed from the stream: stderr was ERROR. The read missed a time
# ending in "Z", hclog's "@level", klog's letter and PostgreSQL's "LOG", and
# programs write all their logs to stderr more often than not, so their INFO
# and WARN lines were stored as Errors - and `filters.logs.minSeverity: ERROR`
# kept them. ContainerAgentLogSeverity.test.js runs the chain's patterns in
# JavaScript; only the collector shows what RE2, expr-lang and the stanza
# operators make of them, on the version the agent runs - and, for the
# Kubernetes agent, on 0.96.0, which an upgrade with --reuse-values keeps.
#
# Each case is its own container's log file, in the layout its runtime
# writes: a Kubernetes node's /var/log/pods (CRI lines), Docker's json-file
# logs (the Docker and Docker Swarm agents) and Podman's k8s-file logs. Every
# case must leave with the corpus's severity, at the number OneUptime's ingest
# stores the word it names at (LOG_SEVERITY_NUMBER_BY_TEXT, issue #11228: the
# collector's severityText is the word the chain lifted), no case may leave
# twice or not at all, and the collector may log no error from the chain. With
# filters.logs.minSeverity=ERROR, what is below ERROR must be dropped at the
# node and what has no severity kept.
#
# CONFIG_ROOT runs it against another checkout's configs and chart (the
# corpus and this script stay this checkout's): that is how the misreading of
# a config from before the fix is shown.
#
# Needs docker and helm. Usage: bash Tests/Ops/agent-log-severity-behaviour.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG_ROOT="${CONFIG_ROOT:-${REPO_ROOT}}"
CHART="${CONFIG_ROOT}/HelmChart/Public/kubernetes-agent"
RUN_ID="agent-log-severity-$$"

WORK_DIR="$(mktemp -d)"
cleanup() {
  docker ps -aq --filter "name=${RUN_ID}-" | xargs docker rm -f >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT
chmod 0755 "${WORK_DIR}"

# js-yaml is a devDependency of this package.
cd "${REPO_ROOT}/Tests/Ops"
HELPER="${REPO_ROOT}/Tests/Ops/Utils/LogSeverityBehaviour.js"

# The image the container agents are built FROM.
AGENT_IMAGE="$(sed -n 's/^FROM \(otel\/opentelemetry-collector-contrib:[^ ]*\).*/\1/p' "${CONFIG_ROOT}/agents/DockerAgent/Dockerfile.tpl")"

failures=0

# run_collector <label> <image> <fixture mount point> <layout> [--min-severity LEVEL]
run_collector() {
  local label="$1" image="$2" mount="$3" layout="$4"
  shift 4
  local dir="${WORK_DIR}/${label}"

  node "${HELPER}" fixtures "${layout}" "${dir}/logs"
  chmod -R a+rX "${dir}"
  mkdir -p "${dir}/out"
  chmod 0777 "${dir}/out"
  chmod 0644 "${dir}/config.yaml"

  echo "    collector image: ${image}"
  docker run -d --name "${RUN_ID}-${label}" \
    --hostname "severity-behaviour" \
    -v "${dir}/config.yaml":/etc/behaviour/config.yaml:ro \
    -v "${dir}/logs":"${mount}":ro \
    -v "${dir}/out":/out \
    "${image}" --config /etc/behaviour/config.yaml >/dev/null

  # The file exporter writes as records arrive, and the recombine operator
  # holds each file's last record for its 5s flush period. Wait until the
  # count stops growing.
  local previous=-1 count=0 stable=0
  for _ in $(seq 1 90); do
    sleep 1
    count="$(node "${HELPER}" count "${dir}/out/logs.json")"
    if [ "${count}" = "${previous}" ] && [ "${count}" != "0" ]; then
      stable=$((stable + 1))
      if [ "${stable}" -ge 8 ]; then
        break
      fi
    else
      stable=0
    fi
    previous="${count}"
  done

  # Stopped before it is judged, so the exporter has written all it holds
  # and the file is whole.
  docker stop --time 20 "${RUN_ID}-${label}" >/dev/null 2>&1 || true
  docker logs "${RUN_ID}-${label}" >"${dir}/collector.log" 2>&1 || true

  if ! node "${HELPER}" check "${dir}/logs/../cases.json" "${dir}/out/logs.json" "${dir}/collector.log" "$@"; then
    echo "    FAILED: ${label}"
    tail -20 "${dir}/collector.log"
    failures=$((failures + 1))
  fi

  docker rm -f "${RUN_ID}-${label}" >/dev/null 2>&1 || true
}

# kubernetes_case <label> [--min-severity LEVEL] [helm --set flags...]
kubernetes_case() {
  local label="$1"
  shift
  local filter=()
  if [ "${1:-}" = "--min-severity" ]; then
    filter=(--min-severity "$2")
    shift 2
  fi
  local dir="${WORK_DIR}/${label}"
  mkdir -p "${dir}"

  echo "==> ${label}: the kubernetes-agent chart's DaemonSet"
  helm template behaviour "${CHART}" \
    --set clusterName=behaviour-test \
    --set oneuptime.url=https://oneuptime.example.com \
    --set oneuptime.apiKey=behaviour-test \
    --set logs.enabled=true \
    --set logs.mode=daemonset \
    "$@" \
    >"${dir}/rendered.yaml"

  if [ "${#filter[@]}" -gt 0 ]; then
    node "${HELPER}" config kubernetes "${dir}/rendered.yaml" "${dir}" --min-severity
  else
    node "${HELPER}" config kubernetes "${dir}/rendered.yaml" "${dir}"
  fi

  run_collector "${label}" "$(cat "${dir}/image")" /var/log/pods pods "${filter[@]}"
}

# agent_case <agent> <layout> <mount point>
agent_case() {
  local agent="$1" layout="$2" mount="$3"
  local label
  label="$(echo "${agent}" | tr '[:upper:]' '[:lower:]')"
  local dir="${WORK_DIR}/${label}"
  mkdir -p "${dir}"

  echo "==> ${label}: agents/${agent}/otel-collector-config.yaml"
  node "${HELPER}" config agent "${CONFIG_ROOT}/agents/${agent}/otel-collector-config.yaml" "${dir}"
  run_collector "${label}" "${AGENT_IMAGE}" "${mount}" "${layout}"
}

kubernetes_case kubernetes-pinned
# `helm upgrade --reuse-values` keeps the image.tag an older install was
# given, and the chart pinned 0.96.0 before.
kubernetes_case kubernetes-0.96.0 --set image.tag=0.96.0
# What the issue asked of the filter: drop what is below ERROR at the node,
# and keep what has no severity.
kubernetes_case kubernetes-min-error --min-severity ERROR --set filters.logs.minSeverity=ERROR
kubernetes_case kubernetes-0.96.0-min-error --min-severity ERROR --set filters.logs.minSeverity=ERROR --set image.tag=0.96.0
agent_case DockerAgent docker /var/lib/docker/containers
agent_case DockerSwarmAgent docker /var/lib/docker/containers
agent_case PodmanAgent podman /var/lib/containers/storage/overlay-containers

if [ "${failures}" -gt 0 ]; then
  echo "${failures} run(s) stored log lines at the wrong severity"
  exit 1
fi
echo "==> every line leaves every agent at the level it names, and with no level where it names none"
