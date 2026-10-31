#!/usr/bin/env bash
#
# Run the Kubernetes agent's Job failures processors -- the cluster
# collector's transform/job-failures-increase and
# cumulative_to_delta/job-failures-increase exactly as the chart renders
# them, then its resource processor -- in the collector image the chart
# ships, feed them what the metrics pipeline gets for four Jobs over seven
# samples, and check what comes out.
#
# Why this exists: OneUptime's Job Failures template used to count
# k8s.job.failed_pods' growth between two samples of the same minute, which
# missed every failure between two minutes' samples, and read a Job
# recreated under the same name as failures. The chart now sends
# k8s.job.failed_pods.increase, the failures since the previous sample of
# the same Job, and the template sums that. k8s_cluster sends the count as
# a GAUGE (cumulative_to_delta leaves gauges alone) on the Job's own
# resource, keyed by its UID, and the processors run in the metrics
# pipeline itself, beside every other metric the cluster collector sends.
# tests/job-failures-increase_test.yaml pins the processors as TEXT and
# `otelcol validate` proves they PARSE; only running them shows what they
# send. A wrong statement is not a crash: it is a failing Job that never
# alerts, or every Job in a CronJob's history alerting at once.
#
# Twice: on the collector the chart pins, and on 0.96.0 (rendered for that
# tag), which `helm upgrade --reuse-values` keeps and where the copy's gauge
# is made a sum in datapoint context. Both must send the same increases:
#   - a failing Job's failures between every two samples, 30 seconds, five
#     minutes and an hour apart;
#   - nothing for a Job recreated under the same name (a new UID at 0) at
#     its first sample, then its own failure;
#   - nothing for a count that went down in the same Job, then the next
#     failure from it;
#   - 0 for a Job that failed long ago;
# with the Job's UID, name and namespace kept and the cluster name stamped:
# exactly the attributes k8s.job.failed_pods carries at the same sample, the
# same at every sample of a Job however many pods it retried with; and
# k8s.job.failed_pods itself, the Jobs' other gauges, a container's
# restart count and a Prometheus counter beside them, out as they came in.
# Utils/KubernetesAgentJobFailuresIncreaseBehaviour.js builds the config and
# the payloads and checks the export; KubernetesAgentJobFailuresIncrease.test.js
# holds them to the arithmetic.
#
# Needs docker, helm and node (js-yaml from this package). Usage:
#   bash Tests/Ops/agent-job-failures-increase-behaviour.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART="${REPO_ROOT}/HelmChart/Public/kubernetes-agent"
HELPER="${REPO_ROOT}/Tests/Ops/Utils/KubernetesAgentJobFailuresIncreaseBehaviour.js"
CURL_IMAGE="curlimages/curl:8.10.1"
RUN_ID="agent-job-failures-increase-$$"

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

EXPECTED_COUNT="$(node "${HELPER}" expected-count)"

# run_case <label> [helm --set ...]
run_case() {
  local label="$1"
  shift
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

  # The processors and the image, lifted out of the render, so this tests
  # what ships rather than a copy of it.
  node "${HELPER}" config "${dir}/rendered.yaml" "${dir}"
  chmod 0644 "${dir}"/*.json "${dir}/config.yaml"
  local image
  image="$(cat "${dir}/image")"
  echo "    collector image: ${image}"

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

  # One sample at a time, in order: cumulative_to_delta compares each with
  # the one before. With no batch processor, each request is exported before
  # the receiver answers it.
  local index status
  for index in 0 1 2 3 4 5 6; do
    status="$(post "scrape-${index}.json")"
    if [ "${status}" != "200" ]; then
      echo "    FAILED: posting sample ${index} returned HTTP ${status}"
      docker logs "${host}" 2>&1 | tail -20
      exit 1
    fi
  done

  # The file exporter writes as metrics arrive; give it a moment to flush.
  for _ in $(seq 1 20); do
    if [ "$(node "${HELPER}" count "${dir}/out/metrics.json")" -ge "${EXPECTED_COUNT}" ]; then
      break
    fi
    sleep 0.5
  done

  node "${HELPER}" check "${dir}/out/metrics.json" "${label} on ${image}"
  docker rm -f "${host}" >/dev/null
  echo "==> ${label}: every Job's failures since its previous sample, on ${image}"
}

run_case pinned
run_case reuse-values --set image.tag=0.96.0
