#!/usr/bin/env bash
#
# Run the Docker Swarm agent's inventory pipeline - its poller,
# agents/DockerSwarmAgent/inventory-snapshot.sh, and the collector's two
# receivers that read what it writes, exactly as they ship - and check that
# the collector reads EVERY snapshot in full.
#
# Why this exists: the poller rewrites its two files in place, through a
# rename, and the collector knows a file by its first kilobyte (its
# fingerprint). A file that starts like one it has already read is taken for
# that file, and read from where it stopped. The inventory used to start with
# the swarm's first node, the same bytes every time, so a calm swarm's
# identical snapshot was never read again - its inventory aged out of
# OneUptime 15 minutes after the agent started - and in a swarm whose
# snapshot filled a kilobyte, nothing past it changed in OneUptime unless the
# first kilobyte did. DockerSwarmInventorySnapshot.test.js checks the files
# the poller writes; only the collector itself shows what it reads of them.
#
# Three snapshots of a stand-in swarm (Utils/DockerSwarmInventoryBehaviour.js:
# the manager's API answered from files): the second identical to the first,
# the third changing only its last node, past the inventory's first
# kilobyte. All three must arrive in full - every node of each, and the
# change - and each one's metrics.
#
# Needs docker, jq and node (js-yaml from this package). Usage:
#   bash Tests/Ops/swarm-agent-inventory-behaviour.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELPER="${REPO_ROOT}/Tests/Ops/Utils/DockerSwarmInventoryBehaviour.js"
RUN_ID="swarm-agent-inventory-$$"

# The collector the agent runs: the image its docker-compose.yml pins.
COLLECTOR_IMAGE="$(sed -n 's/^ *image: \(otel\/opentelemetry-collector-contrib:[^ ]*\)$/\1/p' \
  "${REPO_ROOT}/agents/DockerSwarmAgent/docker-compose.yml" | head -n 1)"
if [ -z "${COLLECTOR_IMAGE}" ]; then
  echo "FAILED: no collector image in agents/DockerSwarmAgent/docker-compose.yml"
  exit 1
fi

WORK_DIR="$(mktemp -d)"
cleanup() {
  docker rm -f -v "${RUN_ID}" >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT
chmod 0755 "${WORK_DIR}"

# js-yaml is a devDependency of this package.
cd "${REPO_ROOT}/Tests/Ops"

mkdir -p "${WORK_DIR}/data" "${WORK_DIR}/out" "${WORK_DIR}/config"
# The collector image runs as a non-root user and writes its output here.
chmod 0777 "${WORK_DIR}/out"
chmod 0755 "${WORK_DIR}/data" "${WORK_DIR}/config"

node "${HELPER}" write-api "${WORK_DIR}/api"
node "${HELPER}" collector-config "${WORK_DIR}/config"

snapshot() {
  node "${HELPER}" run-once "${WORK_DIR}/api" "${WORK_DIR}/data"
  chmod 0644 "${WORK_DIR}"/data/*
}

wait_for_snapshots() {
  local wanted="$1"
  for _ in $(seq 1 30); do
    if node "${HELPER}" check-collected "${WORK_DIR}/out/logs.json" \
      "${WORK_DIR}/out/metrics.json" "${wanted}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

echo "==> the Swarm agent's inventory receivers, on ${COLLECTOR_IMAGE}"
snapshot
docker run -d --name "${RUN_ID}" \
  -v "${WORK_DIR}/config/config.yaml:/etc/otelcol-contrib/config.yaml:ro" \
  -v "${WORK_DIR}/data:/data:ro" \
  -v "${WORK_DIR}/out:/out" \
  "${COLLECTOR_IMAGE}" >/dev/null

# The first snapshot, read at start.
wait_for_snapshots 1 || true

# Two seconds apart, so the metrics' time (in whole seconds) moves on.
sleep 2
echo "==> a second snapshot of the same swarm"
snapshot
wait_for_snapshots 2 || true

sleep 2
echo "==> a third, with a change past the inventory's first kilobyte"
node "${HELPER}" activate-last-worker "${WORK_DIR}/api"
snapshot

if wait_for_snapshots 3; then
  echo "PASSED: the collector read all three snapshots in full, and their metrics"
  exit 0
fi

node "${HELPER}" check-collected "${WORK_DIR}/out/logs.json" \
  "${WORK_DIR}/out/metrics.json" 3 || true
echo "--- the collector's log:"
docker logs "${RUN_ID}" 2>&1 | tail -n 30
exit 1
