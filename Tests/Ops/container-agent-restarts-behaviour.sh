#!/usr/bin/env bash
#
# Run the container agents' restart processors -- the Docker and Podman
# agents' configs exactly as they ship -- in the collector image the agents
# are built FROM, and check what comes out.
#
# Why this exists: OneUptime's Container Restart Loop template used to count
# container.restarts' growth between two samples of the same minute, which
# missed every restart between two minutes' samples. The agents now copy
# container.restarts to container.restarts.increase and turn the copy into
# the restarts since the previous sample of the same container
# (cumulative_to_delta), and the template sums that.
# ContainerAgentRestarts.test.js pins the processors as TEXT and
# `otelcol validate` proves they PARSE; only running them shows what they
# send. A wrong statement is not a crash: it is a restart loop that never
# alerts.
#
# Two parts, for each agent:
#   1. Fed samples: two containers over seven samples, posted to the
#      processors in order, minutes and an hour apart as well as 30 seconds.
#      Every sample but the first sends the restarts since the one before,
#      across any gap; a sample whose count went down (a manual restart)
#      sends none; container.restarts goes on unchanged.
#   2. A real daemon: the agent's whole metrics pipeline (its docker_stats
#      receiver, scraping every 2 seconds, and every processor) against this
#      machine's Docker daemon, and a container in a restart loop (it exits
#      a second after it starts, under --restart=always). Its count must grow,
#      the increases must add up to exactly that growth, and some of its
#      samples must have been taken while Docker was restarting it: Docker
#      reports such a container as running and answers the receiver's stats
#      request with empty stats (a memory limit of 0), so the receiver keeps
#      sampling it between its runs. The Podman agent's receiver is pointed
#      at the Docker socket (mounted where it looks for Podman's): that
#      checks its pipeline, not Podman's API.
#
# Needs docker and node (js-yaml from this package). Usage:
#   bash Tests/Ops/container-agent-restarts-behaviour.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELPER="${REPO_ROOT}/Tests/Ops/Utils/ContainerAgentRestartsBehaviour.js"
# The real-daemon config and the point counter are the CPU test's.
CPU_HELPER="${REPO_ROOT}/Tests/Ops/Utils/ContainerAgentCpuBehaviour.js"
CURL_IMAGE="curlimages/curl:8.10.1"
LOOP_IMAGE="public.ecr.aws/docker/library/busybox:1.37"
RUN_ID="container-agent-restarts-$$"

# The collector the Docker and Podman images are built FROM.
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

  echo "==> ${agent}: the restart processors, fed samples, on ${COLLECTOR_IMAGE}"
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

  # One sample at a time, in order: cumulative_to_delta compares each with
  # the one before. Each request is exported before the receiver answers it.
  local index status
  for index in 0 1 2 3 4 5 6; do
    status="$(post "scrape-${index}.json")"
    if [ "${status}" != "200" ]; then
      echo "    FAILED: posting sample ${index} returned HTTP ${status}"
      docker logs "${host}" 2>&1 | tail -20
      exit 1
    fi
  done

  # The file exporter writes as metrics arrive; give it a moment to flush
  # every sample's count (one per container per sample).
  for _ in $(seq 1 20); do
    if [ "$(node "${CPU_HELPER}" count "${dir}/out/metrics.json" container.restarts)" -ge 14 ]; then
      break
    fi
    sleep 0.5
  done

  node "${HELPER}" check-synthetic "${agent}" "${dir}/out/metrics.json"
  docker rm -f -v "${host}" >/dev/null
  echo "==> ${agent}: every sample sends the restarts since the one before, whatever the gap"
}

# against_daemon <agent>
against_daemon() {
  local agent="$1"
  local dir="${WORK_DIR}/${agent}-daemon"
  mkdir -p "${dir}/out"
  chmod 0755 "${dir}"
  chmod 0777 "${dir}/out"

  echo "==> ${agent}: its whole metrics pipeline against this machine's Docker daemon, and a restart loop"
  local socket
  socket="$(node "${CPU_HELPER}" real-config "${agent}" "${dir}" 2s)"
  chmod 0644 "${dir}/config.yaml"

  # The collector first, so the receiver sees the looping container start.
  local host="${RUN_ID}-${agent,,}-collector"
  # Root, to read the daemon's socket, as the agent images run.
  docker run -d --name "${host}" --user 0:0 \
    -e DOCKER_API_VERSION=1.44 \
    -e DOCKER_HOST_NAME=behaviour-test \
    -e PODMAN_HOST_NAME=behaviour-test \
    -e APP_VERSION=behaviour-test \
    -v /var/run/docker.sock:"${socket}" \
    -v "${dir}/config.yaml":/etc/behaviour/config.yaml:ro \
    -v "${dir}/out":/out \
    "${COLLECTOR_IMAGE}" --config /etc/behaviour/config.yaml >/dev/null
  sleep 3

  # Exits a second after it starts, and Docker starts it again, waiting
  # 100 ms, then twice as long each time.
  local looping="${RUN_ID}-${agent,,}-looping"
  docker run -d --name "${looping}" --restart=always "${LOOP_IMAGE}" \
    sh -c 'sleep 1; exit 1' >/dev/null

  # Until the count has grown by several restarts and a sample was taken
  # while Docker was restarting it: about half a minute.
  local ready="no"
  for _ in $(seq 1 120); do
    ready="$(node "${HELPER}" ready-real "${dir}/out/metrics.json" "${looping}")"
    if [ "${ready}" = "yes" ]; then
      break
    fi
    sleep 1
  done
  # Stop scraping before reading, so the export is whole.
  docker stop -t 5 "${host}" >/dev/null

  echo "    Docker's own count for it: $(docker inspect --format '{{.RestartCount}}' "${looping}")"
  node "${HELPER}" check-real "${agent}" "${dir}/out/metrics.json" "${looping}"
  docker rm -f -v "${host}" "${looping}" >/dev/null
  echo "==> ${agent}: a restart loop is sampled between its runs, and every restart is sent"
}

for agent in DockerAgent PodmanAgent; do
  synthetic "${agent}"
done

for agent in DockerAgent PodmanAgent; do
  against_daemon "${agent}"
done
