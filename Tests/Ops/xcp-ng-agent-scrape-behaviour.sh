#!/usr/bin/env bash
#
# Run the XCP-ng Agent's collector from agents/XcpNgAgent/docker-compose.yml,
# exactly as it ships, against a stand-in Xen Orchestra serving the recorded
# scrape (Tests/Ops/Fixtures/XcpNg/XenOrchestraScrape.js) over HTTPS, and
# check what reaches OneUptime.
#
# Why this exists: Xen Orchestra's OpenMetrics plugin serves every pool from
# one endpoint, types eight per-second rate series `counter`, stamps its
# samples in SECONDS (OpenMetrics), leaves xcp_pool_connected without a
# timestamp, labels the IPMI host power with no pool, and ends its body with
# "# EOF" and no newline. How the collector's prometheus receiver reads all
# of that - names, types, timestamps, staleness - decides what OneUptime
# stores, and only the real collector shows it. XcpNgAgentConfigs.test.js
# pins the config as TEXT and `otelcol validate` proves it PARSES; this runs
# it.
#
# The only changes to the shipped files: the collector scrapes every 5
# seconds instead of 60 (with a 4-second timeout instead of 50). Its own
# pipeline and its otlp_http exporter run unchanged: ONEUPTIME_URL points at
# a stand-in OneUptime that logs each export's path and token and hands it
# on to an OTLP sink - a second collector, the same image, whose file
# exporter writes what it receives.
#
# The stand-ins: Xen Orchestra (Tests/Ops/Utils/FakeXenOrchestra.js, behind
# a certificate made here and pinned as install.sh pins one, answering only
# the right Bearer secret - which has a $ in it, held doubled in .env as
# install.sh writes it - and losing the unnamed pool from its third scrape
# on), the OneUptime relay and the sink. It checks, from the sink's file
# (Utils/XcpNgAgentScrapeBehaviour.js):
#
#   1. two OTLP resources per scrape, one per pool, each carrying
#      xcp_ng.pool.id, xcp_ng.pool.name (not for the pool XAPI names
#      nothing), xen_orchestra.name and oneuptime.agent.version, and no
#      service.name; nothing but xcp_* series and no resource without a
#      pool; every served sample of a pool exported with its value and the
#      second Xen Orchestra served; the eight rate series as gauges with the
#      values served, also those that went down; one staleness marker, for
#      the lost pool's xcp_pool_connected;
#   2. a wrong secret: nothing is sent, and the collector logs the 401;
#   3. a certificate that is not the pinned one: nothing is sent, the
#      secret never reaches the server, and the collector logs why;
#   4. Xen Orchestra's own self-signed certificate (no subjectAltName),
#      pinned exactly: nothing is sent, and the collector logs why.
#
# With --write-fixtures it also writes the export of scrapes 1 and 2 to
# packages/Common/Tests/Server/Utils/Telemetry/Fixtures/XcpNg/
# AgentOtlpScrape{1,2}.json (README.md there says how they are normalized);
# without it, it holds this run to those files.
#
# Needs docker (with Compose v2), node and openssl.
# Usage: bash Tests/Ops/xcp-ng-agent-scrape-behaviour.sh [--write-fixtures]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_DIR="${REPO_ROOT}/agents/XcpNgAgent"
FIXTURES_DIR="${REPO_ROOT}/packages/Common/Tests/Server/Utils/Telemetry/Fixtures/XcpNg"
HELPER="${REPO_ROOT}/Tests/Ops/Utils/XcpNgAgentScrapeBehaviour.js"
# Warmed by the Ops workflow before the real-Docker tests run.
NODE_IMAGE="public.ecr.aws/docker/library/node:26-alpine3.24"
# On a machine where others run Docker too, OPS_RUNTIME_NAME_PREFIX starts the
# names of what this run creates.
RUN_ID="${OPS_RUNTIME_NAME_PREFIX:-}xcp-ng-scrape-$$"
WRITE_FIXTURES=""
if [ "${1:-}" = "--write-fixtures" ]; then
  WRITE_FIXTURES="--write-fixtures"
fi

WORK_DIR="$(mktemp -d)"

compose() {
  docker compose -p "${RUN_ID}" --project-directory "${WORK_DIR}" \
    -f "${WORK_DIR}/docker-compose.yml" -f "${WORK_DIR}/docker-compose.override.yml" "$@"
}

dump_logs() {
  echo "---- fake-xo"
  compose logs --no-log-prefix fake-xo 2>&1 | tail -n 20 || true
  echo "---- oneuptime (relay)"
  compose logs --no-log-prefix oneuptime 2>&1 | tail -n 10 || true
  echo "---- collector"
  compose logs --no-log-prefix oneuptime-xcp-ng-agent 2>&1 | tail -n 30 || true
  echo "---- otlp-sink"
  compose logs --no-log-prefix otlp-sink 2>&1 | tail -n 10 || true
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

# ---- The shipped files, scraping every 5 seconds -----------------------------
cp "${AGENT_DIR}/docker-compose.yml" "${WORK_DIR}/docker-compose.yml"
sed -e 's/scrape_interval: 60s/scrape_interval: 5s/' -e 's/scrape_timeout: 50s/scrape_timeout: 4s/' \
  "${AGENT_DIR}/otel-collector-config.yaml" >"${WORK_DIR}/otel-collector-config.yaml"
if grep -qE 'scrape_interval: 60s|scrape_timeout: 50s' "${WORK_DIR}/otel-collector-config.yaml"; then
  fail "the collector config still scrapes every 60 seconds"
fi
# Everything else is as shipped.
diff <(grep -vE 'scrape_(interval|timeout):' "${AGENT_DIR}/otel-collector-config.yaml") \
  <(grep -vE 'scrape_(interval|timeout):' "${WORK_DIR}/otel-collector-config.yaml") >/dev/null \
  || fail "the collector config differs from the shipped one in more than its interval"
COLLECTOR_IMAGE="$(sed -n 's/^ *image: *\(otel\/opentelemetry-collector-contrib:[^ ]*\).*/\1/p' "${AGENT_DIR}/docker-compose.yml" | head -1)"
AGENT_VERSION="$(sed -n 's/^ *value: "\([0-9.]*\)"$/\1/p' "${AGENT_DIR}/otel-collector-config.yaml" | head -1)"
[ -n "${COLLECTOR_IMAGE}" ] && [ -n "${AGENT_VERSION}" ] || fail "could not read the collector pin or the agent version"
echo "==> collector ${COLLECTOR_IMAGE}, reporting agent version ${AGENT_VERSION}"

# ---- Certificates for the stand-in Xen Orchestra -----------------------------
mkdir -p "${WORK_DIR}/certs" "${WORK_DIR}/fakes" "${WORK_DIR}/sink" "${WORK_DIR}/out"
# Xen Orchestra's, then the one it is "renewed" to, both naming its address.
for name in xo renewed; do
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=xo.example.test" \
    -addext "subjectAltName=DNS:xo.example.test" \
    -keyout "${WORK_DIR}/certs/${name}.key" -out "${WORK_DIR}/certs/${name}.pem" >/dev/null 2>&1
done
# The one Xen Orchestra makes for itself (@xen-orchestra/self-signed): no
# subjectAltName, no CN.
openssl req -batch -new -x509 -days 360 -nodes -newkey rsa:2048 \
  -subj "/C=AU/ST=Some-State/O=Internet Widgits Pty Ltd" \
  -keyout "${WORK_DIR}/certs/autocert.key" -out "${WORK_DIR}/certs/autocert.pem" >/dev/null 2>&1
# Pinned, as install.sh pins XO_TLS_FINGERPRINT's certificate.
cp "${WORK_DIR}/certs/xo.pem" "${WORK_DIR}/xo-ca.pem"
chmod 0644 "${WORK_DIR}"/certs/* "${WORK_DIR}/xo-ca.pem"
chmod 0755 "${WORK_DIR}" "${WORK_DIR}/certs" "${WORK_DIR}/fakes" "${WORK_DIR}/sink"
# The sink's collector runs as a non-root user and writes here.
chmod 0777 "${WORK_DIR}/out"

# ---- The stand-in OneUptime: logs each export, hands it to the sink ----------
cat >"${WORK_DIR}/fakes/relay.js" <<'EOF'
const http = require("http");
http
  .createServer((req, res) => {
    console.log(`OTLP ${req.method} ${req.url} token=${req.headers["x-oneuptime-token"] || ""}`);
    const upstream = http.request(
      { host: "otlp-sink", port: 4318, path: req.url, method: req.method, headers: req.headers },
      (answer) => {
        res.writeHead(answer.statusCode, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      res.writeHead(502);
      res.end(String(error));
    });
    req.pipe(upstream);
  })
  .listen(4318);
EOF

cat >"${WORK_DIR}/sink/sink.yaml" <<'EOF'
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        metrics_url_path: /otlp/v1/metrics
exporters:
  file:
    path: /out/metrics.json
service:
  pipelines:
    metrics:
      receivers: [otlp]
      exporters: [file]
EOF
chmod 0644 "${WORK_DIR}/fakes/relay.js" "${WORK_DIR}/sink/sink.yaml"

# ---- The stand-ins, on the agent's own compose network -----------------------
# The secret as Xen Orchestra holds it ($$ is Compose's $): a $, and what YAML
# would read as a list and a map, were the collector to read it as YAML.
cat >"${WORK_DIR}/docker-compose.override.yml" <<EOF
services:
  oneuptime-xcp-ng-agent:
    # A name of this run's own, so a real install on the machine is left alone.
    container_name: ${RUN_ID}-collector
  fake-xo:
    image: ${NODE_IMAGE}
    command: ["node", "/ops/Utils/FakeXenOrchestra.js"]
    environment:
      - "XO_SECRET=[behaviour] s3cr\$\$et: +1"
      - XO_CERT=/certs/\${FAKE_XO_CERT:-xo}.pem
      - XO_KEY=/certs/\${FAKE_XO_CERT:-xo}.key
      - XO_PORT=443
      - XO_BASE_SECONDS=1795000000
      - XO_LOSE_POOL_AT=3
    volumes:
      - "${REPO_ROOT}/Tests/Ops/Utils:/ops/Utils:ro"
      - "${REPO_ROOT}/Tests/Ops/Fixtures:/ops/Fixtures:ro"
      - "./certs:/certs:ro"
    networks:
      default:
        aliases: [xo.example.test]
  oneuptime:
    image: ${NODE_IMAGE}
    command: ["node", "/fakes/relay.js"]
    volumes: ["./fakes:/fakes:ro"]
  otlp-sink:
    image: ${COLLECTOR_IMAGE}
    command: ["--config", "/sink/sink.yaml"]
    volumes: ["./sink:/sink:ro", "./out:/out"]
EOF

# As install.sh writes it: the secret escaped once more for the collector.
# write_env <the secret, every $ doubled> [XO_NAME]
write_env() {
  cat >"${WORK_DIR}/.env" <<EOF
# XO_OPENMETRICS_SECRET is escaped for the collector: every \$ is written as \$\$.
ONEUPTIME_URL='http://oneuptime:4318'
ONEUPTIME_TELEMETRY_INGESTION_KEY='behaviour-ingestion-key'
XO_URL='https://xo.example.test'
XO_SCHEME=https
XO_ADDRESS='xo.example.test:443'
XO_OPENMETRICS_SECRET='$1'
XO_NAME='${2:-xo-behaviour}'
XO_TLS_FINGERPRINT=''
XO_CA_FILE=''
XO_TLS_SERVER_NAME=''
EOF
}
SECRET_FOR_COLLECTOR='[behaviour] s3cr$$et: +1'
write_env "${SECRET_FOR_COLLECTOR}"

# ---- Waiting for what the containers say -------------------------------------
fake_log() {
  compose logs --no-log-prefix fake-xo 2>/dev/null || true
}

collector_log() {
  compose logs --no-log-prefix oneuptime-xcp-ng-agent 2>/dev/null || true
}

served_count() {
  fake_log | grep -c ' served=' || true
}

served_at_least() {
  [ "$(served_count)" -ge "$1" ]
}

fake_says() {
  fake_log | grep -qF "$1"
}

collector_says() {
  collector_log | grep -qF "$1"
}

sink_lines() {
  if [ -f "${WORK_DIR}/out/metrics.json" ]; then
    grep -c . "${WORK_DIR}/out/metrics.json" || true
  else
    echo 0
  fi
}

relay_posts() {
  compose logs --no-log-prefix oneuptime 2>/dev/null | grep -c '^OTLP ' || true
}

wait_for() {
  local what="$1" limit="$2" started=$SECONDS
  shift 2
  until "$@"; do
    if ((SECONDS - started > limit)); then
      fail "${what} (waited ${limit}s)"
    fi
    sleep 1
  done
  echo "ok: ${what} ($((SECONDS - started))s)"
}

# Nothing reaches OneUptime for $1 seconds.
nothing_sent_for() {
  local seconds="$1" lines posts
  lines="$(sink_lines)"
  posts="$(relay_posts)"
  sleep "${seconds}"
  [ "$(sink_lines)" = "${lines}" ] || fail "data reached the sink"
  [ "$(relay_posts)" = "${posts}" ] || fail "the collector exported something"
  echo "ok: nothing reached OneUptime in ${seconds}s"
}

# ---- Run ---------------------------------------------------------------------
echo "==> starting the stand-ins"
compose up -d --quiet-pull fake-xo oneuptime otlp-sink >/dev/null
wait_for "the stand-in Xen Orchestra listens" 60 fake_says "LISTENING 443"

echo "==> 1. the agent reads both pools, three scrapes"
compose up -d --quiet-pull oneuptime-xcp-ng-agent >/dev/null
running=$(compose ps --services --status running | sort | tr '\n' ' ')
[ "${running}" = "fake-xo oneuptime oneuptime-xcp-ng-agent otlp-sink " ] \
  || fail "unexpected services running: ${running}"
wait_for "Xen Orchestra served four scrapes" 90 served_at_least 4
collector_log >"${WORK_DIR}/collector.log"
if grep -E '\b(warn|error)\b' "${WORK_DIR}/collector.log" | grep -q .; then
  grep -E '\b(warn|error)\b' "${WORK_DIR}/collector.log" | head -5
  fail "the collector logged a warning or an error while reading Xen Orchestra"
fi
echo "ok: the collector logged no warning and no error (# EOF without a newline, OpenMetrics seconds, a sample with no timestamp)"
# The batch processor sends what it holds when the collector stops.
compose stop -t 30 oneuptime-xcp-ng-agent >/dev/null 2>&1
sleep 3
[ "$(sink_lines)" -gt 0 ] || fail "nothing reached the sink"
fake_log >"${WORK_DIR}/fake-xo.log"
compose logs --no-log-prefix oneuptime >"${WORK_DIR}/relay.log" 2>&1
if [ -n "${WRITE_FIXTURES}" ]; then
  mkdir -p "${FIXTURES_DIR}"
fi
node "${HELPER}" check "${WORK_DIR}/out/metrics.json" "${WORK_DIR}/fake-xo.log" \
  "${WORK_DIR}/relay.log" "${AGENT_VERSION}" "${FIXTURES_DIR}" ${WRITE_FIXTURES} \
  || fail "what the agent sent is not what Xen Orchestra served"

echo "==> 2. a wrong secret: nothing is sent, and the collector logs the 401"
write_env 'not-the-secret'
compose up -d --force-recreate oneuptime-xcp-ng-agent >/dev/null 2>&1
wait_for "Xen Orchestra refuses the secret" 60 fake_says "wrong-secret"
wait_for "the collector logs the 401" 30 collector_says "server returned HTTP status 401 Unauthorized"
nothing_sent_for 12
if collector_log | grep -qF 'not-the-secret'; then
  fail "the collector logged the secret"
fi

echo "==> 3. a certificate that is not the pinned one: nothing is sent, and the secret never leaves"
write_env "${SECRET_FOR_COLLECTOR}"
FAKE_XO_CERT=renewed compose up -d --force-recreate fake-xo >/dev/null 2>&1
wait_for "the renewed stand-in listens" 60 fake_says "LISTENING 443"
compose up -d --force-recreate oneuptime-xcp-ng-agent >/dev/null 2>&1
wait_for "the collector refuses the certificate" 60 \
  collector_says "tls: failed to verify certificate: x509: certificate signed by unknown authority"
nothing_sent_for 12
if fake_says "REQUEST GET /openmetrics/metrics"; then
  fail "a request reached the stand-in through a certificate the agent does not trust"
fi
echo "ok: no request reached Xen Orchestra"

echo "==> 4. Xen Orchestra's own self-signed certificate, pinned exactly: refused, it names no host"
cp "${WORK_DIR}/certs/autocert.pem" "${WORK_DIR}/xo-ca.pem"
FAKE_XO_CERT=autocert compose up -d --force-recreate fake-xo >/dev/null 2>&1
wait_for "the self-signed stand-in listens" 60 fake_says "LISTENING 443"
compose up -d --force-recreate oneuptime-xcp-ng-agent >/dev/null 2>&1
wait_for "the collector says the certificate names no host" 60 \
  collector_says "x509: certificate is not valid for any names, but wanted to match xo.example.test"
nothing_sent_for 12
if fake_says "REQUEST GET /openmetrics/metrics"; then
  fail "a request reached the stand-in through a certificate that names no host"
fi
echo "ok: no request reached Xen Orchestra"

echo "==> 5. a name YAML would read as a map: it still arrives as the text it is"
cp "${WORK_DIR}/certs/xo.pem" "${WORK_DIR}/xo-ca.pem"
write_env "${SECRET_FOR_COLLECTOR}" 'XO: lab [2026]'
compose up -d --force-recreate fake-xo >/dev/null 2>&1
wait_for "the stand-in listens again" 60 fake_says "LISTENING 443"
lines_before="$(sink_lines)"
compose up -d --force-recreate oneuptime-xcp-ng-agent >/dev/null 2>&1
sink_grew() {
  [ "$(sink_lines)" -gt "${lines_before}" ]
}
wait_for "the agent sends again" 60 sink_grew
tail -n 1 "${WORK_DIR}/out/metrics.json" | node -e '
let text = "";
process.stdin.on("data", (chunk) => {
  text += chunk;
});
process.stdin.on("end", () => {
  const names = JSON.parse(text).resourceMetrics.map((resourceMetrics) => {
    const name = resourceMetrics.resource.attributes.find((attribute) => {
      return attribute.key === "xen_orchestra.name";
    });
    return JSON.stringify(name && name.value);
  });
  const expected = JSON.stringify({ stringValue: "XO: lab [2026]" });
  const ok = names.length > 0 && names.every((name) => name === expected);
  console.log(`${ok ? "ok" : "FAILED"}: xen_orchestra.name is the text on every pool (${names.join(", ")})`);
  process.exit(ok ? 0 : 1);
});
' || fail "XO_NAME did not arrive as the text it is"

echo "PASS: the XCP-ng Agent sends each pool what Xen Orchestra served, and nothing it cannot trust"
