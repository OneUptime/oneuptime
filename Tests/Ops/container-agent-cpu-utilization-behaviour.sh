#!/usr/bin/env bash
#
# Run the container agents' CPU and percent processors -- the Docker, Podman
# and Docker Swarm agents' configs exactly as they ship -- in the collector
# image the agents are built FROM, and check what comes out.
#
# Why this exists: the docker_stats receiver's own container.cpu.utilization
# is computed from one one-shot stats sample (since collector 0.150.0; and
# Podman's Docker-compatible API never sends a previous reading), so it is a
# flat line near zero that never follows the load. The agents turn it off and
# build container.cpu.utilization from container.cpu.usage.total: copy,
# cumulative_to_delta, delta_to_rate, scale to percent of one core ("%"); and
# they give container.memory.percent, a 0-100 figure the receiver labels "1",
# the unit "%". ContainerAgentCpuUtilization.test.js pins the processors as
# TEXT and `otelcol validate` proves they PARSE; only running them shows what
# they send. A wrong statement is not a crash: it is every container CPU chart
# and monitor in OneUptime quietly wrong.
#
# Two parts, for each agent:
#   1. Fed scrapes: two containers over six 30-second scrapes, posted to the
#      processors in order. A quarter of a core reads 25%, one and a half cores
#      150%, idle 0%, 10 ms of CPU per second 1%; the first scrape and the one
#      after a container restart send no CPU percent; container.cpu.usage.total
#      and the memory percent's value go on unchanged.
#   2. A real daemon: the agent's whole metrics pipeline (its docker_stats
#      receiver, scraping every 2 seconds, and every processor) against this
#      machine's Docker daemon, with a container held to half a core by its CPU
#      quota and burning all of it. container.cpu.utilization must read about
#      50%, equal the rate of container.cpu.usage.total, and
#      container.memory.percent must be usage over limit, in "%". The Podman
#      agent's receiver is pointed at the Docker socket (mounted where it looks
#      for Podman's): that checks its pipeline, not Podman's API.
#
# Needs docker and node (js-yaml from this package). Usage:
#   bash Tests/Ops/container-agent-cpu-utilization-behaviour.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELPER="${REPO_ROOT}/Tests/Ops/Utils/ContainerAgentCpuBehaviour.js"
CURL_IMAGE="curlimages/curl:8.10.1"
LOAD_IMAGE="public.ecr.aws/docker/library/busybox:1.37"
RUN_ID="container-agent-cpu-$$"

# The collector the Docker and Podman images are built FROM (the Swarm
# agent's compose file pins the same one: ContainerImageHardening.test.js).
COLLECTOR_IMAGE="$(sed -n 's/^FROM \(otel\/opentelemetry-collector-contrib:[^ ]*\)$/\1/p' \
  "${REPO_ROOT}/agents/DockerAgent/Dockerfile.tpl")"
if [ -z "${COLLECTOR_IMAGE}" ]; then
  echo "FAILED: no collector FROM line in agents/DockerAgent/Dockerfile.tpl"
  exit 1
fi

WORK_DIR="$(mktemp -d)"
cleanup() {
  docker ps -aq --filter "name=${RUN_ID}-" | xargs -r docker rm -f -v >/dev/null 2>&1 || true
  docker network rm "${RUN_ID}" >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT
chmod 0755 "${WORK_DIR}"

# js-yaml is a devDependency of this package.
cd "${REPO_ROOT}/Tests/Ops"

docker network create "${RUN_ID}" >/dev/null

# synthetic <agent>
synthetic() {
  local agent="$1"
  local dir="${WORK_DIR}/${agent}-synthetic"
  mkdir -p "${dir}/out"
  chmod 0755 "${dir}"
  # The collector image runs as a non-root user and writes its output here.
  chmod 0777 "${dir}/out"

  echo "==> ${agent}: the CPU and percent processors, fed scrapes, on ${COLLECTOR_IMAGE}"
  node "${HELPER}" synthetic-config "${agent}" "${dir}"
  chmod 0644 "${dir}"/*.json "${dir}/config.yaml"

  local host="${RUN_ID}-${agent,,}"
  docker run -d --name "${host}" --network "${RUN_ID}" \
    -v "${dir}/config.yaml":/etc/behaviour/config.yaml:ro \
    -v "${dir}/out":/out \
    "${COLLECTOR_IMAGE}" --config /etc/behaviour/config.yaml >/dev/null

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

  # One scrape at a time, in order: cumulative_to_delta compares each with the
  # one before. Each request is exported before the receiver answers it.
  local index status
  for index in 0 1 2 3 4 5; do
    status="$(post "scrape-${index}.json")"
    if [ "${status}" != "200" ]; then
      echo "    FAILED: posting scrape ${index} returned HTTP ${status}"
      docker logs "${host}" 2>&1 | tail -20
      exit 1
    fi
  done

  # The file exporter writes as metrics arrive; give it a moment to flush
  # every scrape's memory percent (one per container per scrape).
  for _ in $(seq 1 20); do
    if [ "$(node "${HELPER}" count "${dir}/out/metrics.json" container.memory.percent)" -ge 12 ]; then
      break
    fi
    sleep 0.5
  done

  node "${HELPER}" check-synthetic "${agent}" "${dir}/out/metrics.json"
  docker rm -f -v "${host}" >/dev/null
  echo "==> ${agent}: container CPU is the interval's percent of one core, memory percent says \"%\""
}

# against_daemon <agent>
against_daemon() {
  local agent="$1"
  local dir="${WORK_DIR}/${agent}-daemon"
  mkdir -p "${dir}/out"
  chmod 0755 "${dir}"
  chmod 0777 "${dir}/out"

  echo "==> ${agent}: its whole metrics pipeline against this machine's Docker daemon"
  local socket
  socket="$(node "${HELPER}" real-config "${agent}" "${dir}" 2s)"
  chmod 0644 "${dir}/config.yaml"

  local load="${RUN_ID}-${agent,,}-load"
  # Half a core by quota, and a loop that would take all of one.
  docker run -d --name "${load}" --cpus=0.5 --memory=64m "${LOAD_IMAGE}" \
    sh -c 'while :; do :; done' >/dev/null

  local host="${RUN_ID}-${agent,,}-collector"
  # Root, to read the daemon's socket, as the agent images run.
  docker run -d --name "${host}" --user 0:0 \
    -e DOCKER_API_VERSION=1.44 \
    -e DOCKER_HOST_NAME=behaviour-test \
    -e PODMAN_HOST_NAME=behaviour-test \
    -e DOCKER_SWARM_CLUSTER_NAME=behaviour-test \
    -e APP_VERSION=behaviour-test \
    -v /var/run/docker.sock:"${socket}" \
    -v "${dir}/config.yaml":/etc/behaviour/config.yaml:ro \
    -v "${dir}/out":/out \
    "${COLLECTOR_IMAGE}" --config /etc/behaviour/config.yaml >/dev/null

  # The first scrape sends no CPU percent; wait for five that do.
  local count=0
  for _ in $(seq 1 60); do
    count="$(node "${HELPER}" count "${dir}/out/metrics.json" container.cpu.utilization "${load}")"
    if [ "${count}" -ge 5 ]; then
      break
    fi
    sleep 1
  done
  if [ "${count}" -lt 5 ]; then
    echo "    FAILED: ${count} container.cpu.utilization points for ${load} in 60 s"
    docker logs "${host}" 2>&1 | tail -20
    exit 1
  fi

  # Half a core is 50%; a CI runner's neighbours get 15 points of slack.
  node "${HELPER}" check-real "${agent}" "${dir}/out/metrics.json" "${load}" 50 15
  docker rm -f -v "${host}" "${load}" >/dev/null
  echo "==> ${agent}: a container on half a core reads half a core"
}

for agent in DockerAgent PodmanAgent DockerSwarmAgent; do
  synthetic "${agent}"
done

for agent in DockerAgent PodmanAgent DockerSwarmAgent; do
  against_daemon "${agent}"
done
