#!/usr/bin/env bash
#
# Run the Kubernetes agent's `filter/volume-series` processor -- exactly as
# the chart renders it -- inside the collector image the chart ships, push one
# scrape of the kubeletstats receiver's volume series through it, and check
# which come out the other side.
#
# Why this exists: the receiver's volume group sends five series for every
# volume of every pod, its service account token and its configMap, secret
# and downwardAPI volumes among them: a few small files in memory that
# OneUptime never reads, and most of the group's series. The node collector
# drops those (issue #9644), by the type the receiver gives a volume from its
# pod's spec, and a token by its name, since the receiver types no projected
# volume. A collector that types projected volumes (issue #9842,
# opentelemetry-collector-contrib#52198) has every one dropped by its type.
# tests/volume-series-filter_test.yaml pins the condition as TEXT and
# `otelcol validate` proves it PARSES; only running it shows what it drops. A
# wrong condition is not a crash: it is a claim's usage, an emptyDir or a
# generic ephemeral volume quietly missing from OneUptime, or the token series
# back.
#
# Twice: on the collector the chart pins, and on 0.96.0 (rendered for that
# tag), which `helm upgrade --reuse-values` keeps. Both must keep and drop the
# same volumes:
#   - dropped: configMap, secret and downwardAPI volumes; a volume typed
#     `projected`, whatever it is called; and, with no type, the service
#     account token Kubernetes mounts (kube-api-access-<suffix>) and the
#     EKS, Azure Workload Identity, Istio and Linkerd tokens;
#   - kept: a claim's volume whatever it is called, a generic ephemeral
#     volume typed or not, its claim named or not, an emptyDir, a hostPath,
#     a volume with no type and no token's name (a token's name only in
#     part included), and the node's, a pod's and a container's own series;
# each kept series once, its resource as it went in.
# Utils/KubernetesAgentVolumeSeriesBehaviour.js builds the config and the
# payload and checks the export; KubernetesAgentVolumeSeries.test.js holds
# them to the chart's condition.
#
# Needs docker, helm and node (js-yaml from this package). Usage:
#   bash Tests/Ops/agent-volume-series-behaviour.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART="${REPO_ROOT}/HelmChart/Public/kubernetes-agent"
HELPER="${REPO_ROOT}/Tests/Ops/Utils/KubernetesAgentVolumeSeriesBehaviour.js"
CURL_IMAGE="curlimages/curl:8.10.1"
RUN_ID="agent-volume-series-$$"

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

  # The filter and the image, lifted out of the render, so this tests what
  # ships rather than a copy of it.
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

  local status
  status="$(post payload.json)"
  if [ "${status}" != "200" ]; then
    echo "    FAILED: posting the scrape returned HTTP ${status}"
    docker logs "${host}" 2>&1 | tail -20
    exit 1
  fi

  # The file exporter writes as metrics arrive; give it a moment to flush.
  for _ in $(seq 1 20); do
    if [ "$(node "${HELPER}" count "${dir}/out/metrics.json")" -ge "${EXPECTED_COUNT}" ]; then
      break
    fi
    sleep 0.5
  done

  node "${HELPER}" check "${dir}/out/metrics.json" "${label} on ${image}"
  docker rm -f "${host}" >/dev/null
  echo "==> ${label}: the volumes OneUptime reads kept, the rest dropped, on ${image}"
}

run_case pinned
run_case reuse-values --set image.tag=0.96.0
