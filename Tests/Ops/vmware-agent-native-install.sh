#!/usr/bin/env bash
#
# The VMware agent installed without Docker, end to end: the commands the
# docs give for it (packages/App/FeatureSet/Docs/Content/en/telemetry/
# vmware.md — "Alternative — Without Docker", and the upgrade and uninstall
# that follow), run as written by a sudo user inside a systemd container,
# against a vCenter simulator (vcsim, from govmomi) and a stand-in OneUptime
# that records what reaches /otlp/v1/*.
#
# VMwareAgentWithoutDocker.test.js runs the same commands against stubs; this
# shows what only the real thing can:
#
#   - the release URL and the archive's layout are real: the pinned
#     otelcol-contrib is downloaded from GitHub and runs;
#   - systemd loads the shipped unit (systemd-analyze verify), runs the
#     collector as a throwaway user (DynamicUser) inside its sandbox, under
#     a root umask of 077, and the collector starts;
#   - the .env, read by systemd and then by the collector, gets an AD-style
#     DOMAIN\user and a password with $, #, spaces, quotes and a backslash to
#     vCenter exactly as typed — vcsim refuses any other login;
#   - metrics reach OneUptime with the ingestion key, the vCenter name and
#     the agent version stamped, and no service.name;
#   - another collector holding localhost:8888 does not stop it: its own
#     counters are on 127.0.0.1:8890;
#   - ESXi syslog, uncommented as the docs say, is received on 5514 with
#     nothing to publish, and shipped as logs;
#   - the docs' upgrade restarts it on fresh files and keeps .env, and the
#     uninstall leaves nothing behind.
#
# Needs docker (systemd runs as PID 1 in a --privileged container, on a
# cgroup v2 host), python3, and network access to github.com and the
# distribution's package mirror. Not part of `npm test`; the "Ops Config
# Test" workflow runs it on every PR.
#
# Usage: bash Tests/Ops/vmware-agent-native-install.sh [--image IMAGE]
#   IMAGE defaults to public.ecr.aws/docker/library/ubuntu:24.04; Debian,
#   Ubuntu and RHEL-family images (apt or dnf) work, e.g. debian:11
#   (systemd 247) or rockylinux:8 (systemd 239).

set -euo pipefail

BASE_IMAGE="public.ecr.aws/docker/library/ubuntu:24.04"
while [ $# -gt 0 ]; do
  case "$1" in
    --image) BASE_IMAGE="${2:?--image needs a value}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_DIR="${REPO_ROOT}/agents/VMwareAgent"
DOCS_PAGE="${REPO_ROOT}/packages/App/FeatureSet/Docs/Content/en/telemetry/vmware.md"
RUN_ID="vmware-native-e2e-$$"
IMAGE_TAG="oneuptime-vmware-native-e2e:$(printf '%s' "${BASE_IMAGE}" | tr -c 'a-zA-Z0-9.-' '-')"

# vcsim, pinned with the sha256 of each archive (checksums.txt of the
# govmomi release): the binary runs in CI, so it is checked against a digest
# kept here, not one fetched from the same release.
VCSIM_VERSION="0.56.0"
VCSIM_SHA256_X86_64="1d207f69a1c78a4bc819a66c568013035229a91696131e9756be0444077ac2fe"
VCSIM_SHA256_ARM64="65e31a3b9f970a32f2078b34c51fd4659cb4eadefc555ffb7de422cb8c08da02"

# What the reader types into .env: vcsim accepts exactly this login.
VCENTER_NAME="e2e-vcenter"
VCENTER_USER='VSPHERE\oneuptime'
VCENTER_PASS='Sp3c$ial #pass "q" \ end'
INGESTION_KEY="0f8fad5b-d9cb-469f-a165-70867728950e"

SERVICE="oneuptime-vmware-agent"
INSTALL_DIR="/opt/oneuptime-vmware-agent"

WORK_DIR="$(mktemp -d)"
CONTAINER="${RUN_ID}"
FAILURES=0

cleanup() {
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

pass() { printf '  \342\234\224 %s\n' "$1"; }
fail() {
  printf '  \342\234\227 %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}
section() { printf '\n== %s ==\n' "$1"; }

in_container() { docker exec "${CONTAINER}" bash -c "$1"; }
as_reader() {
  docker exec -u tester -w /home/tester \
    -e SUDO_EDITOR="cp /e2e/env-content" \
    "${CONTAINER}" bash -euo pipefail -c "$1"
}

# wait_for <seconds> <description> <shell test run in the container>
wait_for() {
  local seconds="$1" what="$2" check="$3" waited=0
  until in_container "${check}" >/dev/null 2>&1; do
    if [ "${waited}" -ge "${seconds}" ]; then
      fail "${what} (waited ${seconds}s)"
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  pass "${what}"
}

show_agent_log() {
  echo "---- journalctl -u ${SERVICE} (last 60 lines) ----"
  in_container "journalctl -u ${SERVICE} --no-pager -n 60" || true
  echo "----"
}

# ----------------------------------------------------------------------------
section "The docs' commands"
# ----------------------------------------------------------------------------
# Lift the blocks out of the page, so this runs what readers copy. The
# agent's own files are served from this checkout (file:///src) instead of
# GitHub's master branch, which a pull request has not reached yet; the
# collector release is downloaded for real.
python3 - "${DOCS_PAGE}" "${WORK_DIR}" <<'PY'
import pathlib, re, sys

page = pathlib.Path(sys.argv[1]).read_text()
out = pathlib.Path(sys.argv[2])
RAW = "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/"


def section(heading):
    lines = page.split("\n")
    start = lines.index(heading)
    level = len(heading) - len(heading.lstrip("#"))
    body = []
    for line in lines[start + 1:]:
        match = re.match(r"^(#{1,6})\s", line)
        if match and len(match.group(1)) <= level:
            break
        body.append(line)
    return "\n".join(body)


def blocks(text):
    return re.findall(r"^```bash\n(.*?)\n```$", text, re.S | re.M)


install, env_commands, env_content, start = blocks(section("## Alternative — Without Docker"))
upgrade = [b for b in blocks(section("## Upgrading the Agent")) if b.startswith('cd "$(mktemp -d)"')][0]
uninstall = [b for b in blocks(section("## Uninstalling the Agent")) if b.startswith("sudo systemctl disable")][0]

for name, text in {
    "install.sh": install,
    "env-commands.sh": env_commands,
    "env-content.template": env_content,
    "start.sh": start,
    "upgrade.sh": upgrade,
    "uninstall.sh": uninstall,
}.items():
    (out / name).write_text(text.replace(RAW, "file:///src/") + "\n")
PY

# The settings as a reader fills them in.
python3 - "${WORK_DIR}" "${VCENTER_NAME}" "${VCENTER_USER}" "${VCENTER_PASS}" "${INGESTION_KEY}" <<'PY'
import pathlib, sys

work, name, user, password, key = sys.argv[1:]
work = pathlib.Path(work)
env = (work / "env-content.template").read_text()
for old, new in {
    "ONEUPTIME_URL=YOUR_ONEUPTIME_URL": "ONEUPTIME_URL=http://127.0.0.1:4318",
    "ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN": f"ONEUPTIME_TELEMETRY_INGESTION_KEY={key}",
    "VMWARE_VCENTER_NAME=my-vcenter": f"VMWARE_VCENTER_NAME={name}",
    "VCENTER_ENDPOINT=https://vcsa.example.com": "VCENTER_ENDPOINT=https://127.0.0.1:8989",
    "VCENTER_USERNAME='oneuptime@vsphere.local'": f"VCENTER_USERNAME='{user}'",
    "VCENTER_PASSWORD='a-strong-password'": f"VCENTER_PASSWORD='{password}'",
    "VCENTER_COLLECTION_INTERVAL=2m": "VCENTER_COLLECTION_INTERVAL=20s",
}.items():
    assert env.count(old) == 1, old
    env = env.replace(old, new)
(work / "env-content").write_text(env)
PY
pass "lifted the install, settings, start, upgrade and uninstall blocks"

# ----------------------------------------------------------------------------
section "The machine: ${BASE_IMAGE} with systemd, vcsim and a stand-in OneUptime"
# ----------------------------------------------------------------------------
case "$(uname -m)" in
  x86_64 | amd64) VCSIM_ARCH="x86_64"; VCSIM_SHA256="${VCSIM_SHA256_X86_64}" ;;
  aarch64 | arm64) VCSIM_ARCH="arm64"; VCSIM_SHA256="${VCSIM_SHA256_ARM64}" ;;
  *) echo "No vcsim build pinned for $(uname -m)" >&2; exit 1 ;;
esac
curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors \
  -o "${WORK_DIR}/vcsim.tar.gz" \
  "https://github.com/vmware/govmomi/releases/download/v${VCSIM_VERSION}/vcsim_Linux_${VCSIM_ARCH}.tar.gz"
if command -v sha256sum >/dev/null 2>&1; then
  echo "${VCSIM_SHA256}  ${WORK_DIR}/vcsim.tar.gz" | sha256sum -c - >/dev/null
else
  echo "${VCSIM_SHA256}  ${WORK_DIR}/vcsim.tar.gz" | shasum -a 256 -c - >/dev/null
fi
tar -xzf "${WORK_DIR}/vcsim.tar.gz" -C "${WORK_DIR}" vcsim
pass "vcsim ${VCSIM_VERSION} (${VCSIM_ARCH}), checked against its pinned sha256"

# The stand-in OneUptime: records each OTLP request's path, ingestion key
# and (decompressed) body, and answers 200 like OneUptime does.
cat >"${WORK_DIR}/mock_oneuptime.py" <<'PY'
import gzip, json, sys, zlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn


# http.server.ThreadingHTTPServer, which Python 3.6 (RHEL 8) lacks.
class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

LOG = sys.argv[2]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        encoding = (self.headers.get("Content-Encoding") or "").lower()
        if encoding == "gzip":
            body = gzip.decompress(body)
        elif encoding == "deflate":
            body = zlib.decompress(body)
        with open(LOG, "a") as log:
            log.write(json.dumps({
                "path": self.path,
                "token": self.headers.get("x-oneuptime-token"),
                "body": body.decode("latin-1"),
            }) + "\n")
        self.send_response(200)
        self.send_header("Content-Type", "application/x-protobuf")
        self.send_header("Content-Length", "0")
        self.end_headers()


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
PY

# The docs' syslog step 1: uncomment the two syslog receivers and the logs
# pipeline of the shipped config, nothing else.
cat >"${WORK_DIR}/enable-syslog.sed" <<'SED'
s/^  # syslog\/tcp:$/  syslog\/tcp:/
s/^  # syslog\/udp:$/  syslog\/udp:/
s/^  #   tcp:$/    tcp:/
s/^  #   udp:$/    udp:/
s/^  #     listen_address: "0\.0\.0\.0:5514"$/      listen_address: "0.0.0.0:5514"/
s/^  #   protocol: rfc3164$/    protocol: rfc3164/
s/^    # logs:$/    logs:/
s/^    #   receivers: \[syslog\/tcp, syslog\/udp\]$/      receivers: [syslog\/tcp, syslog\/udp]/
s/^    #   processors: \[memory_limiter, resource, batch\]$/      processors: [memory_limiter, resource, batch]/
s/^    #   exporters: \[otlphttp\]$/      exporters: [otlphttp]/
SED

# check_requests <path> <python expression over r (one request)>: whether a
# recorded request matches.
cat >"${WORK_DIR}/check_requests.py" <<'PY'
import json, sys

path, expression = sys.argv[1], sys.argv[2]
try:
    requests = [json.loads(line) for line in open("/var/log/mock-oneuptime.jsonl")]
except FileNotFoundError:
    requests = []
sys.exit(0 if any(r["path"] == path and eval(expression, {"r": r}) for r in requests) else 1)
PY

docker build -q -t "${IMAGE_TAG}" - >/dev/null <<DOCKERFILE
FROM ${BASE_IMAGE}
RUN if command -v apt-get >/dev/null; then \\
      apt-get update \\
      && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \\
           systemd systemd-sysv dbus sudo curl ca-certificates python3 tar gzip procps diffutils \\
      && rm -rf /var/lib/apt/lists/*; \\
    else \\
      dnf install -y systemd sudo python3 tar gzip procps-ng diffutils shadow-utils ca-certificates \\
      && (command -v curl >/dev/null || dnf install -y curl-minimal || dnf install -y curl) \\
      && dnf clean all; \\
    fi \\
 && useradd -m tester \\
 && echo 'tester ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/tester \\
 && chmod 0440 /etc/sudoers.d/tester
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
DOCKERFILE

docker run -d --name "${CONTAINER}" --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock \
  -v "${AGENT_DIR}:/src:ro" "${IMAGE_TAG}" >/dev/null
wait_for 60 "systemd is up" \
  'state=$(systemctl is-system-running 2>/dev/null); [ "$state" = running ] || [ "$state" = degraded ]'
SYSTEMD_VERSION="$(in_container 'systemctl --version | head -1')"
pass "${SYSTEMD_VERSION}"

docker exec "${CONTAINER}" mkdir -p /e2e
for file in vcsim mock_oneuptime.py check_requests.py enable-syslog.sed env-content \
  install.sh env-commands.sh start.sh upgrade.sh uninstall.sh; do
  docker cp "${WORK_DIR}/${file}" "${CONTAINER}:/e2e/${file}"
done
in_container 'chmod 0755 /e2e && chmod 0755 /e2e/vcsim && chmod 0644 /e2e/env-content'

# vcsim with the reader's login, the stand-in OneUptime, and another
# collector's internal telemetry already holding localhost:8888.
docker exec "${CONTAINER}" systemd-run --quiet --unit=vcsim \
  /e2e/vcsim -l 127.0.0.1:8989 -username "${VCENTER_USER}" -password "${VCENTER_PASS}"
docker exec "${CONTAINER}" systemd-run --quiet --unit=mock-oneuptime \
  python3 /e2e/mock_oneuptime.py 4318 /var/log/mock-oneuptime.jsonl
docker exec "${CONTAINER}" systemd-run --quiet --unit=another-collector \
  python3 -m http.server 8888 --bind 127.0.0.1
wait_for 30 "vcsim answers on its SDK" \
  'curl -fsk https://127.0.0.1:8989/sdk/vimServiceVersions.xml | grep -q urn:vim25'
wait_for 30 "the stand-in OneUptime and the other collector listen" \
  'curl -s -o /dev/null http://127.0.0.1:8888/ && python3 -c "import socket; socket.create_connection((\"127.0.0.1\", 4318), 2)"'

# ----------------------------------------------------------------------------
section "Install, as the docs say (a sudo user, root's umask 077)"
# ----------------------------------------------------------------------------
if as_reader "umask 077; $(cat "${WORK_DIR}/install.sh")" >"${WORK_DIR}/install.log" 2>&1; then
  pass "downloaded the pinned release and installed the files"
else
  cat "${WORK_DIR}/install.log"
  fail "the install commands failed"
  exit 1
fi
# The settings: created root's alone, then filled in through sudoedit (its
# editor writes what the reader typed).
as_reader "umask 077; $(cat "${WORK_DIR}/env-commands.sh")"
if [ "$(in_container "stat -c '%a %U' ${INSTALL_DIR}/.env")" = "600 root" ]; then
  pass ".env is root's alone (0600)"
else
  fail ".env is $(in_container "stat -c '%a %U' ${INSTALL_DIR}/.env"), not 600 root"
fi
if in_container "cmp -s /e2e/env-content ${INSTALL_DIR}/.env"; then
  pass ".env holds what was typed"
else
  fail ".env does not hold what was typed"
fi
for file in otelcol-contrib:755 otel-collector-config.yaml:644; do
  name="${file%%:*}"
  want="${file##*:}"
  got="$(in_container "stat -c '%a %U' ${INSTALL_DIR}/${name}")"
  if [ "${got}" = "${want} root" ]; then
    pass "${INSTALL_DIR}/${name} is ${want}, root's"
  else
    fail "${INSTALL_DIR}/${name} is ${got}, not ${want} root"
  fi
done
if in_container "cmp -s /src/systemd/oneuptime-vmware-agent-native.service /etc/systemd/system/${SERVICE}.service"; then
  pass "the unit is the shipped file"
else
  fail "the installed unit is not the shipped file"
fi
if verify="$(in_container "systemd-analyze verify /etc/systemd/system/${SERVICE}.service 2>&1")" && [ -z "${verify}" ]; then
  pass "systemd-analyze verify: clean"
else
  fail "systemd-analyze verify: ${verify}"
fi

as_reader "$(cat "${WORK_DIR}/start.sh")"
wait_for 60 "the service is active" "systemctl is-active --quiet ${SERVICE}" || show_agent_log
if in_container "systemctl is-enabled --quiet ${SERVICE}"; then
  pass "the service starts on boot"
else
  fail "the service is not enabled"
fi
wait_for 60 "the collector started (\"Everything is ready\")" \
  "journalctl -u ${SERVICE} --no-pager | grep -q 'Everything is ready. Begin running and processing data.'" || show_agent_log

MAIN_UID="$(in_container "ps -o uid= -p \$(systemctl show -p MainPID --value ${SERVICE}) | tr -d ' '")"
if [ "${MAIN_UID}" -ge 61184 ] && [ "${MAIN_UID}" -le 65519 ]; then
  pass "the collector runs as a dynamic user (uid ${MAIN_UID}), not root"
else
  fail "the collector runs as uid ${MAIN_UID}"
fi
CAPS="$(in_container "grep CapEff /proc/\$(systemctl show -p MainPID --value ${SERVICE})/status | awk '{print \$2}'")"
if [ "${CAPS}" = "0000000000000000" ]; then
  pass "with no capabilities"
else
  fail "with capabilities ${CAPS}"
fi

# ----------------------------------------------------------------------------
section "What reaches OneUptime"
# ----------------------------------------------------------------------------
# vcsim refuses any login but the one above, so metrics prove that systemd
# and the collector handed vCenter the user and password exactly as typed.
wait_for 90 "metrics arrive at /otlp/v1/metrics with the ingestion key" \
  "python3 /e2e/check_requests.py /otlp/v1/metrics 'r[\"token\"] == \"${INGESTION_KEY}\" and \"vcenter.vm.cpu.usage\" in r[\"body\"]'" || show_agent_log
for needle in "vmware.vcenter.name" "${VCENTER_NAME}" "oneuptime.agent.version" "DC0_H0_VM0"; do
  if in_container "python3 /e2e/check_requests.py /otlp/v1/metrics '\"${needle}\" in r[\"body\"]'"; then
    pass "the metrics carry ${needle}"
  else
    fail "no metrics carry ${needle}"
  fi
done
PIN="$(sed -n 's/^ *image: otel\/opentelemetry-collector-contrib:\([0-9.]*\)$/\1/p' "${AGENT_DIR}/docker-compose.yml")"
if in_container "python3 /e2e/check_requests.py /otlp/v1/metrics '\"${PIN}\" in r[\"body\"]'"; then
  pass "and the agent version ${PIN} the files pin"
else
  fail "the agent version ${PIN} is not stamped"
fi
if in_container "python3 /e2e/check_requests.py /otlp/v1/metrics '\"service.name\" in r[\"body\"]'"; then
  fail "a metric carries service.name, which would register a phantom Service"
else
  pass "no metric carries service.name"
fi
SELF="$(in_container "curl -s http://127.0.0.1:8890/metrics")"
if printf '%s\n' "${SELF}" | grep -q '^otelcol_exporter_sent_metric_points.* [1-9]'; then
  pass "the collector's own counters are on 127.0.0.1:8890, beside the collector holding 8888"
else
  fail "no sent-points counter on 127.0.0.1:8890"
fi

# ----------------------------------------------------------------------------
section "ESXi syslog, as the docs say: uncomment, restart, nothing to publish"
# ----------------------------------------------------------------------------
in_container "sed -i -f /e2e/enable-syslog.sed ${INSTALL_DIR}/otel-collector-config.yaml"
UNCOMMENTED="$(in_container "diff /src/otel-collector-config.yaml ${INSTALL_DIR}/otel-collector-config.yaml | grep -c '^>'" || true)"
if [ "${UNCOMMENTED}" = "12" ]; then
  pass "uncommented the two syslog receivers and the logs pipeline (12 lines)"
else
  fail "uncommenting changed ${UNCOMMENTED} lines, not 12"
fi
as_reader "sudo systemctl restart ${SERVICE}"
wait_for 60 "the collector listens for syslog on 5514" \
  "python3 -c 'import socket; socket.create_connection((\"127.0.0.1\", 5514), 2)'" || show_agent_log
in_container "printf '<14>Oct  7 11:52:00 esx-01 Hostd: e2e udp syslog line\n' > /dev/udp/127.0.0.1/5514; printf '<14>Oct  7 11:52:01 esx-02 Vpxa: e2e tcp syslog line\n' > /dev/tcp/127.0.0.1/5514"
wait_for 60 "ESXi syslog arrives at /otlp/v1/logs, on the vCenter" \
  "python3 /e2e/check_requests.py /otlp/v1/logs '\"e2e udp syslog line\" in r[\"body\"] and \"${VCENTER_NAME}\" in r[\"body\"]' && python3 /e2e/check_requests.py /otlp/v1/logs '\"e2e tcp syslog line\" in r[\"body\"]'" || show_agent_log

# ----------------------------------------------------------------------------
section "Upgrade, as the docs say"
# ----------------------------------------------------------------------------
ENV_BEFORE="$(in_container "sha256sum ${INSTALL_DIR}/.env")"
PID_BEFORE="$(in_container "systemctl show -p MainPID --value ${SERVICE}")"
if as_reader "$(cat "${WORK_DIR}/upgrade.sh")" >"${WORK_DIR}/upgrade.log" 2>&1; then
  pass "the upgrade commands ran"
else
  cat "${WORK_DIR}/upgrade.log"
  fail "the upgrade commands failed"
fi
wait_for 60 "the service is active again, a new process" \
  "systemctl is-active --quiet ${SERVICE} && [ \"\$(systemctl show -p MainPID --value ${SERVICE})\" != '${PID_BEFORE}' ]" || show_agent_log
if [ "$(in_container "sha256sum ${INSTALL_DIR}/.env")" = "${ENV_BEFORE}" ] \
  && [ "$(in_container "stat -c '%a %U' ${INSTALL_DIR}/.env")" = "600 root" ]; then
  pass ".env is kept, still root's alone"
else
  fail ".env changed in the upgrade"
fi
if in_container "cmp -s /src/otel-collector-config.yaml ${INSTALL_DIR}/otel-collector-config.yaml"; then
  pass "the config is the shipped one again"
else
  fail "the upgrade left the old config"
fi

# ----------------------------------------------------------------------------
section "Uninstall, as the docs say"
# ----------------------------------------------------------------------------
as_reader "$(cat "${WORK_DIR}/uninstall.sh")" >/dev/null 2>&1 || fail "the uninstall commands failed"
if in_container "! systemctl is-active --quiet ${SERVICE} && [ ! -e /etc/systemd/system/${SERVICE}.service ] && [ ! -e ${INSTALL_DIR} ] && [ ! -e /etc/systemd/system/multi-user.target.wants/${SERVICE}.service ]"; then
  pass "the service, its unit, its boot link and ${INSTALL_DIR} are gone"
else
  fail "the uninstall left something behind"
fi

echo
if [ "${FAILURES}" -gt 0 ]; then
  echo "${FAILURES} check(s) failed on ${BASE_IMAGE}."
  exit 1
fi
echo "Every check passed on ${BASE_IMAGE} (${SYSTEMD_VERSION})."
