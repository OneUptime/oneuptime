#!/usr/bin/env bash
#
# Run the Proxmox agent's collector and its pve-api-failover container from
# agents/ProxmoxAgent/docker-compose.yml, exactly as they ship, against three
# stand-in Proxmox VE nodes and a stand-in prometheus-pve-exporter, and check
# which node the collector reads the cluster from while nodes go down, lose
# quorum and come back.
#
# Why this exists (#6844): the collector read the whole cluster through
# PVE_HOST alone, so an agent whose PVE_HOST was one node went blind exactly
# when that node went down. pve-api-failover now checks PVE_HOST's API, then
# each node of PVE_NODES, every 15 seconds, and writes the first that answers
# (with the token, the first that is part of the quorate cluster) to a file
# the collector's cluster scrape reads its target from (file_sd_configs).
# ProxmoxApiFailover.test.js runs the script with stand-ins for curl; only the
# real containers show the whole chain: the curl image's busybox shell, the
# tmpfs volume the two share as two different users, the collector's file_sd
# picking up each new choice, and the target it then hands the exporter.
#
# The only change to the shipped files: the collector scrapes every 5 seconds
# instead of 30, so each step takes seconds rather than minutes.
#
# The stand-ins are one small Node.js script: three nodes answering the
# Proxmox VE API on HTTPS port 8006 (/version and /cluster/status, quorate
# unless the test says otherwise), the exporter logging every scrape's target
# and answering pve_up, and an OTLP endpoint for the collector to send to.
#
# Needs docker (with Compose v2) and openssl.
# Usage: bash Tests/Ops/proxmox-agent-failover-behaviour.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_DIR="${REPO_ROOT}/agents/ProxmoxAgent"
# Warmed by the Ops workflow before the real-Docker tests run.
NODE_IMAGE="public.ecr.aws/docker/library/node:26-alpine3.24"
RUN_ID="pve-failover-$$"
TOKEN_ID="monitoring@pam!oneuptime"
TOKEN_SECRET="0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11"

WORK_DIR="$(mktemp -d)"

compose() {
  docker compose -p "${RUN_ID}" --project-directory "${WORK_DIR}" \
    -f "${WORK_DIR}/docker-compose.yml" -f "${WORK_DIR}/docker-compose.override.yml" "$@"
}

dump_logs() {
  echo "---- pve-api-failover"
  compose logs --no-log-prefix pve-api-failover 2>&1 | tail -n 30 || true
  echo "---- fake-exporter (last scrapes)"
  compose logs --no-log-prefix fake-exporter 2>&1 | tail -n 30 || true
  echo "---- collector"
  compose logs --no-log-prefix oneuptime-proxmox-agent 2>&1 | tail -n 40 || true
}

cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1"
  dump_logs
  exit 1
}

# ---- The shipped files, scraping every 5 seconds ----------------------------
cp "${AGENT_DIR}/docker-compose.yml" "${WORK_DIR}/docker-compose.yml"
sed 's/scrape_interval: 30s/scrape_interval: 5s/' \
  "${AGENT_DIR}/otel-collector-config.yaml" >"${WORK_DIR}/otel-collector-config.yaml"
if grep -q 'scrape_interval: 30s' "${WORK_DIR}/otel-collector-config.yaml"; then
  fail "the collector config still scrapes every 30 seconds"
fi

# ---- A certificate for the stand-in nodes -----------------------------------
mkdir -p "${WORK_DIR}/fakes" "${WORK_DIR}/state"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=pve" \
  -keyout "${WORK_DIR}/fakes/key.pem" -out "${WORK_DIR}/fakes/cert.pem" >/dev/null 2>&1
chmod 0644 "${WORK_DIR}/fakes/key.pem" "${WORK_DIR}/fakes/cert.pem"
chmod 0755 "${WORK_DIR}/fakes" "${WORK_DIR}/state"

cat >"${WORK_DIR}/fakes/fakes.js" <<'EOF'
// The stand-ins: `node fakes.js node <name>` answers the Proxmox VE API on
// HTTPS 8006, `node fakes.js exporter` is pve-exporter on 9221, and
// `node fakes.js otlp` takes the collector's OTLP on 4318.
const fs = require("fs");
const http = require("http");
const https = require("https");

const [role, name] = process.argv.slice(2);

if (role === "node") {
  https
    .createServer(
      {
        key: fs.readFileSync("/fakes/key.pem"),
        cert: fs.readFileSync("/fakes/cert.pem"),
      },
      (req, res) => {
        const json = (status, data) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data }));
        };
        if (!req.headers.authorization) {
          return json(401, null);
        }
        if (req.url === "/api2/json/cluster/status") {
          let state = "quorate";
          try {
            state = fs.readFileSync(`/state/${name}`, "utf8").trim();
          } catch (err) {
            // No file: quorate.
          }
          return json(200, [
            { type: "cluster", name: "lab", nodes: 3, quorate: state === "quorate" ? 1 : 0 },
            { type: "node", name, online: 1, local: 1 },
          ]);
        }
        return json(200, { version: "9.0.3", release: "9.0" });
      },
    )
    .listen(8006);
} else if (role === "exporter") {
  http
    .createServer((req, res) => {
      const url = new URL(req.url, "http://exporter");
      console.log(
        `SCRAPE target=${url.searchParams.get("target")} cluster=${url.searchParams.get("cluster")} node=${url.searchParams.get("node")}`,
      );
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      res.end('# TYPE pve_up gauge\npve_up{id="node/pve1"} 1\n');
    })
    .listen(9221);
} else {
  http
    .createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        console.log(`OTLP ${req.method} ${req.url}`);
        res.writeHead(200, { "Content-Type": "application/x-protobuf" });
        res.end();
      });
    })
    .listen(4318);
}
EOF

# ---- The stand-ins, on the agent's own compose network ----------------------
{
  echo "services:"
  # Names of this run's own, so a real install on the machine is left alone.
  echo "  oneuptime-proxmox-agent:"
  echo "    container_name: ${RUN_ID}-collector"
  echo "  pve-api-failover:"
  echo "    container_name: ${RUN_ID}-failover"
  for svc in pve1 pve2 pve3; do
    echo "  ${svc}:"
    echo "    image: ${NODE_IMAGE}"
    echo "    command: [\"node\", \"/fakes/fakes.js\", \"node\", \"${svc}\"]"
    echo "    volumes: [\"./fakes:/fakes:ro\", \"./state:/state:ro\"]"
  done
  echo "  fake-exporter:"
  echo "    image: ${NODE_IMAGE}"
  echo "    command: [\"node\", \"/fakes/fakes.js\", \"exporter\"]"
  echo "    volumes: [\"./fakes:/fakes:ro\"]"
  echo "  otlp-sink:"
  echo "    image: ${NODE_IMAGE}"
  echo "    command: [\"node\", \"/fakes/fakes.js\", \"otlp\"]"
  echo "    volumes: [\"./fakes:/fakes:ro\"]"
} >"${WORK_DIR}/docker-compose.override.yml"

cat >"${WORK_DIR}/.env" <<EOF
ONEUPTIME_URL=http://otlp-sink:4318
ONEUPTIME_TELEMETRY_INGESTION_KEY=behaviour-test
PROXMOX_CLUSTER_NAME=behaviour
PVE_HOST=pve1
PVE_NODES=[pve1,pve2,pve3]
PVE_EXPORTER_URL=fake-exporter:9221
PVE_API_TOKEN_ID='${TOKEN_ID}'
PVE_API_TOKEN_SECRET=${TOKEN_SECRET}
EOF

# ---- Waiting for what the containers say ------------------------------------
failover_says() {
  compose logs --no-log-prefix pve-api-failover 2>/dev/null | grep -qF "$1"
}

# A line of pve-api-failover's matching the extended regular expression $1.
failover_matches() {
  compose logs --no-log-prefix pve-api-failover 2>/dev/null | grep -qE "$1"
}

scrape_count() {
  compose logs --no-log-prefix fake-exporter 2>/dev/null | grep -c '^SCRAPE ' || true
}

# A cluster scrape at node $2 after the first $1 scrapes.
cluster_scrape_after() {
  compose logs --no-log-prefix fake-exporter 2>/dev/null | grep '^SCRAPE ' \
    | tail -n +"$(($1 + 1))" | grep -qx "SCRAPE target=$2 cluster=1 node=0"
}

# The node collectors were scraped at every node.
node_scrapes_at_every_node() {
  local log
  log=$(compose logs --no-log-prefix fake-exporter 2>/dev/null)
  for node in pve1 pve2 pve3; do
    grep -qx "SCRAPE target=${node} cluster=0 node=1" <<<"${log}" || return 1
  done
}

otlp_received() {
  compose logs --no-log-prefix otlp-sink 2>/dev/null | grep -q '^OTLP POST /otlp/v1/metrics'
}

failover_last_line_is() {
  [ "$(compose logs --no-log-prefix pve-api-failover 2>/dev/null | tail -n 1)" = "$1" ]
}

# Every cluster scrape after the first $1 is at node $2.
only_cluster_scrapes_at() {
  local others
  others=$(compose logs --no-log-prefix fake-exporter 2>/dev/null | grep '^SCRAPE ' \
    | tail -n +"$(($1 + 1))" | grep 'cluster=1 node=0' | grep -vx "SCRAPE target=$2 cluster=1 node=0" || true)
  [ -z "${others}" ]
}

wait_for() {
  local what="$1" limit="$2" started=$SECONDS
  shift 2
  until "$@"; do
    if ((SECONDS - started > limit)); then
      fail "${what} (waited ${limit}s)"
    fi
    sleep 2
  done
  echo "ok: ${what} ($((SECONDS - started))s)"
}

# ---- Run --------------------------------------------------------------------
echo "==> starting the collector, pve-api-failover and the stand-ins"
compose up -d --quiet-pull pve1 pve2 pve3 fake-exporter otlp-sink >/dev/null
compose up -d --quiet-pull oneuptime-proxmox-agent pve-api-failover >/dev/null

# Only these: no AI agent and no bundled exporter were started.
running=$(compose ps --services | sort | tr '\n' ' ')
[ "${running}" = "fake-exporter oneuptime-proxmox-agent otlp-sink pve-api-failover pve1 pve2 pve3 " ] \
  || fail "unexpected services running: ${running}"

echo "==> 1. every node up: the cluster is read from PVE_HOST"
wait_for "pve-api-failover reads the cluster from pve1" 60 failover_says "Reading the cluster from pve1."
wait_for "the collector scrapes the cluster at pve1" 60 cluster_scrape_after 0 pve1
wait_for "the collector scrapes the node collectors at every node" 60 node_scrapes_at_every_node
wait_for "the collector sends what it scraped" 60 otlp_received

# A node that hangs: paused, it still takes the connection (the kernel does)
# but never answers the TLS handshake, as a node that froze or lost its disk
# does. Its name keeps resolving, so the run is the same on every platform.
# (Why each node was passed over is pinned word for word, against stand-ins
# for curl, by ProxmoxApiFailover.test.js.)
echo "==> 2. pve1 hangs: the cluster is read from pve2"
compose pause pve1 >/dev/null 2>&1
mark=$(scrape_count)
wait_for "pve-api-failover moves to pve2" 60 failover_matches "^Reading the cluster from pve2: pve1 [a-z ]+\.$"
wait_for "the collector scrapes the cluster at pve2" 60 cluster_scrape_after "${mark}" pve2

echo "==> 3. pve2 loses quorum: the cluster is read from pve3"
echo noquorum >"${WORK_DIR}/state/pve2"
mark=$(scrape_count)
wait_for "pve-api-failover passes over pve2" 60 \
  failover_matches "^Reading the cluster from pve3: pve1 [a-z ]+; pve2 is not part of the quorate cluster\.$"
wait_for "the collector scrapes the cluster at pve3" 60 cluster_scrape_after "${mark}" pve3

echo "==> 4. pve1 answers again: the cluster is read from PVE_HOST again"
rm -f "${WORK_DIR}/state/pve2"
compose unpause pve1 >/dev/null 2>&1
wait_for "pve-api-failover goes back to pve1" 60 failover_last_line_is "Reading the cluster from pve1."
mark=$(scrape_count)
wait_for "the collector scrapes the cluster at pve1 again" 60 cluster_scrape_after "${mark}" pve1
# Once moved, it stays: over the next two scrape intervals every cluster scrape is pve1's.
mark=$(scrape_count)
sleep 12
only_cluster_scrapes_at "${mark}" pve1 || fail "the collector still scrapes the cluster elsewhere than pve1"
echo "ok: every cluster scrape since is at pve1"

echo "==> 5. the token never left curl's stdin"
if compose logs --no-log-prefix pve-api-failover 2>/dev/null | grep -qF "${TOKEN_SECRET}"; then
  fail "pve-api-failover logged the token secret"
fi
if docker inspect -f '{{json .Config.Cmd}}' "${RUN_ID}-failover" | grep -qF "${TOKEN_SECRET}"; then
  fail "the token secret is on pve-api-failover's command line"
fi
echo "ok: the token secret is in no log and on no command line"

echo "==> 6. docker stop stops pve-api-failover at once"
started=$SECONDS
compose stop pve-api-failover >/dev/null 2>&1
((SECONDS - started <= 8)) || fail "pve-api-failover took $((SECONDS - started))s to stop"
echo "ok: stopped in $((SECONDS - started))s"

echo "PASS: the collector reads the cluster from the next node whose API answers"
