#!/usr/bin/env bash
#
# Run the journald operators of OneUptime's default host collector config -
# exactly as the server sends it to a Linux host (Tests/Ops/HostCollectorDefaults/
# linux.yaml, which HostCollectorDefaultConfig.test.ts holds to the default) -
# inside the collector release the host installers pin, feed them journal
# entries as journalctl hands them over, and check what comes out.
#
# Why this exists (issue #9748): the journal arrived whole, one JSON map per
# entry, so a host's Logs read JSON, no line said which systemd unit it was
# about, and a failed unit's page could not say why it failed. The operators
# now send each entry as its message, at its level, filed under its unit
# (systemd.unit.name), with systemd's own result and exit status where PID 1
# said them, and drop the rest of the entry: its command line, its user, its
# cursor. `otelcol validate` proves the expressions parse; only running them
# shows which entries they file where, and what they leave on the host.
#
# The journald receiver itself needs journalctl, which the collector image
# has not: the entries go in through a filelog receiver that parses each
# line into the body as the journald receiver hands it over, then through
# the very operators the default config gives journald.
#
# Needs docker and node. Usage: bash Tests/Ops/host-collector-journal-behaviour.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_ID="host-collector-journal-$$"

WORK_DIR="$(mktemp -d)"
cleanup() {
  docker ps -aq --filter "name=${RUN_ID}" | xargs docker rm -f >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT
chmod 0755 "${WORK_DIR}"
mkdir -p "${WORK_DIR}/in" "${WORK_DIR}/out"
chmod 0755 "${WORK_DIR}/in"
chmod 0777 "${WORK_DIR}/out"

# The release a host runs, from where it is pinned.
HOST_COLLECTOR_VERSION="$(sed -n 's/^export const HOST_COLLECTOR_PINNED_VERSION: string = "\(.*\)";$/\1/p' \
  "${REPO_ROOT}/packages/Common/Types/HostCollector/HostCollector.ts")"
if [ -z "${HOST_COLLECTOR_VERSION}" ]; then
  echo "HOST_COLLECTOR_PINNED_VERSION not found in HostCollector.ts"
  exit 1
fi
IMAGE="otel/opentelemetry-collector-contrib:${HOST_COLLECTOR_VERSION}"
echo "==> collector image: ${IMAGE}"

# js-yaml is a devDependency of this package.
cd "${REPO_ROOT}/Tests/Ops"

# The pipeline: the default's journald operators behind a filelog receiver.
node -e '
const fs = require("fs");
const yaml = require("js-yaml");
const [defaultConfig, out] = process.argv.slice(1);
const config = yaml.load(fs.readFileSync(defaultConfig, "utf8"));
const operators = config.receivers.journald.operators;
if (!Array.isArray(operators) || operators.length === 0) {
  console.error("The default config gives journald no operators.");
  process.exit(1);
}
fs.writeFileSync(out, yaml.dump({
  receivers: {
    filelog: {
      include: ["/in/journal.jsonl"],
      start_at: "beginning",
      operators: [{ type: "json_parser", parse_to: "body" }, ...operators],
    },
  },
  exporters: { file: { path: "/out/logs.json" } },
  service: { pipelines: { logs: { receivers: ["filelog"], exporters: ["file"] } } },
}));
' "${REPO_ROOT}/Tests/Ops/HostCollectorDefaults/linux.yaml" "${WORK_DIR}/config.yaml"
chmod 0644 "${WORK_DIR}/config.yaml"

# What journalctl -o json hands over: every value text. Each entry names its
# case in CASE, which the operators drop with the rest of the entry, so the
# message carries it too.
node -e '
const fs = require("fs");
const entries = [
  {
    MESSAGE: "case=exit nginx.service: Main process exited, code=exited, status=1/FAILURE",
    PRIORITY: "5", _PID: "1", _SYSTEMD_UNIT: "init.scope", UNIT: "nginx.service",
    EXIT_CODE: "exited", EXIT_STATUS: "1", SYSLOG_IDENTIFIER: "systemd",
    MESSAGE_ID: "98e322203f7a4ed290d09fe03c09fe15", _CMDLINE: "/sbin/init", _UID: "0",
  },
  {
    MESSAGE: "case=result nginx.service: Failed with result 'exit-code'.",
    PRIORITY: "4", _PID: "1", _SYSTEMD_UNIT: "init.scope", UNIT: "nginx.service",
    UNIT_RESULT: "exit-code", SYSLOG_IDENTIFIER: "systemd",
  },
  {
    MESSAGE: "case=own nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)",
    PRIORITY: "3", _PID: "4242", _SYSTEMD_UNIT: "nginx.service", SYSLOG_IDENTIFIER: "nginx",
    _CMDLINE: "nginx -g daemon on; --password=hunter2", _EXE: "/usr/sbin/nginx", _UID: "33",
    __CURSOR: "s=abc;i=1",
  },
  {
    MESSAGE: "case=spoof I am not systemd",
    PRIORITY: "6", _PID: "777", _SYSTEMD_UNIT: "evil.service", UNIT: "nginx.service",
    UNIT_RESULT: "success", EXIT_CODE: "exited", EXIT_STATUS: "0",
  },
  { MESSAGE: "case=emerg everything is on fire", PRIORITY: "0", _PID: "1", _SYSTEMD_UNIT: "init.scope" },
  { PRIORITY: "7", _PID: "1", _SYSTEMD_UNIT: "init.scope", _CMDLINE: "case=nomessage --token=s3cret" },
];
fs.writeFileSync(process.argv[1], entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
' "${WORK_DIR}/in/journal.jsonl"
chmod 0644 "${WORK_DIR}/in/journal.jsonl"

docker run -d --name "${RUN_ID}" \
  -v "${WORK_DIR}/config.yaml":/etc/behaviour/config.yaml:ro \
  -v "${WORK_DIR}/in":/in:ro \
  -v "${WORK_DIR}/out":/out \
  "${IMAGE}" --config /etc/behaviour/config.yaml >/dev/null

# The file exporter writes as records arrive; wait for all six.
for _ in $(seq 1 60); do
  if [ -s "${WORK_DIR}/out/logs.json" ] && node -e '
const fs = require("fs");
let count = 0;
for (const line of fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean)) {
  for (const rl of JSON.parse(line).resourceLogs || []) {
    for (const sl of rl.scopeLogs || []) {
      count += (sl.logRecords || []).length;
    }
  }
}
process.exit(count >= 6 ? 0 : 1);
' "${WORK_DIR}/out/logs.json"; then
    break
  fi
  sleep 1
done

if ! node -e '
const fs = require("fs");
const records = [];
const text = fs.existsSync(process.argv[1]) ? fs.readFileSync(process.argv[1], "utf8") : "";
for (const line of text.split("\n").filter(Boolean)) {
  for (const rl of JSON.parse(line).resourceLogs || []) {
    for (const sl of rl.scopeLogs || []) {
      for (const record of sl.logRecords || []) {
        const attributes = {};
        for (const a of record.attributes || []) {
          attributes[a.key] = Object.values(a.value)[0];
        }
        delete attributes["log.file.name"];
        records.push({
          body: record.body || {},
          severityNumber: record.severityNumber,
          severityText: record.severityText,
          attributes,
        });
      }
    }
  }
}
const of = (name) => {
  return records.find((record) => {
    return typeof record.body.stringValue === "string" && record.body.stringValue.startsWith(`case=${name} `);
  });
};
const want = {
  exit: {
    severityNumber: 10, severityText: "INFO2",
    attributes: {
      "systemd.unit.name": "nginx.service", "systemd.unit.exit_code": "exited",
      "systemd.unit.exit_status": "1", "syslog.identifier": "systemd", "process.pid": "1",
    },
  },
  result: {
    severityNumber: 13, severityText: "WARN",
    attributes: {
      "systemd.unit.name": "nginx.service", "systemd.unit.result": "exit-code",
      "syslog.identifier": "systemd", "process.pid": "1",
    },
  },
  own: {
    severityNumber: 17, severityText: "ERROR",
    attributes: { "systemd.unit.name": "nginx.service", "syslog.identifier": "nginx", "process.pid": "4242" },
  },
  // Its own unit; a UNIT, a result and an exit only systemd may give.
  spoof: {
    severityNumber: 9, severityText: "INFO",
    attributes: { "systemd.unit.name": "evil.service", "process.pid": "777" },
  },
  emerg: {
    severityNumber: 21, severityText: "FATAL",
    attributes: { "systemd.unit.name": "init.scope", "process.pid": "1" },
  },
};
let failures = 0;
const check = (name, ok, said) => {
  console.log(`    ${ok ? "ok    " : "FAILED"} ${name}${ok ? "" : ` -> ${said}`}`);
  if (!ok) {
    failures++;
  }
};
for (const [name, expected] of Object.entries(want)) {
  const got = of(name);
  check(
    `${name}: its message is the line, its level and attributes as expected`,
    Boolean(got) &&
      got.severityNumber === expected.severityNumber &&
      got.severityText === expected.severityText &&
      JSON.stringify(Object.entries(got.attributes).sort()) ===
        JSON.stringify(Object.entries(expected.attributes).sort()),
    JSON.stringify(got || "dropped"),
  );
}
// Nothing else of an entry leaves the host: not its command line, not its user.
check(
  "no command line, executable, user or cursor in any record",
  !text.includes("hunter2") && !text.includes("s3cret") && !text.includes("/usr/sbin/nginx") && !text.includes("s=abc"),
  "a field the operators should have dropped left",
);
// An entry with no message is sent with nothing of it.
const empty = records.filter((record) => {
  return record.body.stringValue === undefined;
});
check(
  "an entry with no message leaves with an empty body",
  empty.length === 1 && JSON.stringify(empty[0].body.kvlistValue || {}) === JSON.stringify({}),
  JSON.stringify(empty),
);
process.exit(failures > 0 ? 1 : 0);
' "${WORK_DIR}/out/logs.json"; then
  echo "    FAILED: the journald operators"
  docker logs "${RUN_ID}" 2>&1 | tail -20
  exit 1
fi

echo "==> each journal line leaves the host as its message, at its level, under its unit, with systemd's result and exit status, and nothing else"
