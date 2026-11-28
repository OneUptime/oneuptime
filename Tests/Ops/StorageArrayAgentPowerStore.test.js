"use strict";

/**
 * Dell PowerStore in the Storage Array Agent (#11002).
 *
 * The agent reads a PowerStore through Dell's powerstore-metrics-exporter,
 * which logs in to the cluster itself, and takes the cluster's alerts as
 * syslog on a collector of their own. What holds that together:
 *
 *  - docker-compose.yml builds Dell's exporter from powerstore-exporter.Dockerfile
 *    (a pinned base, Dell's release binary checked against its SHA-256, run as
 *    nobody) and gives it only its own settings; its command writes the
 *    exporter's config.yml to a tmpfs from them, quoting the user and password
 *    so they reach PowerStore exactly as typed, and never puts a value of
 *    .env on a command line;
 *  - the syslog collector (powerstore-syslog) runs the agent's collector image
 *    with powerstore-syslog.yaml, publishes the syslog port and never sees the
 *    PowerStore password; that config's severities are Dell's own lists;
 *  - otel-collector-config.powerstore.yaml names only series Dell's exporter
 *    sends, and derives the two used percents the catalog and templates read;
 *  - install.sh asks for the user and the password (silently, a $ allowed),
 *    writes them for Compose, and keeps the PowerStore's options on a re-run;
 *  - troubleshoot.sh probes Dell's exporter the way the collector scrapes it,
 *    with no credential, and names the cause when it does not answer.
 *
 * The recordings (packages/Common/Tests/Fixtures/DellPowerStoreExporter) are
 * what storage-array-agent-powerstore-behaviour.sh saved from the shipped
 * files running against a stand-in PowerStore; that script runs them in CI.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");
const { agentFilesCurlStub } = require("./Utils/AgentFilesCurlStub");
const { agentKindVersion } = require("./Utils/AgentKindVersion");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "StorageArrayAgent");
const FIXTURES_DIR = path.join(__dirname, "Fixtures", "DellPowerStore");
const RECORDINGS_DIR = path.join(
  REPO_ROOT,
  "packages/Common/Tests/Fixtures/DellPowerStoreExporter/v1.0.3",
);
const PLATFORM_DIR = path.join(
  REPO_ROOT,
  "packages/Common/Types/StorageArray/Platforms/Dell/PowerStore",
);
const COLLECTOR_SERVICE = "oneuptime-storage-array-agent";
const CONFIG = "otel-collector-config.powerstore.yaml";
const SYSLOG_CONFIG = "powerstore-syslog.yaml";
const DOCKERFILE = "powerstore-exporter.Dockerfile";
const INGESTION_KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";
// Every character .env quoting and the exporter's YAML have to carry.
const PASSWORD = 'O\'ne "up" #time: \\ $HOME';

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "powerstore-agent-"));
  scratchDirs.push(dir);
  return dir;
}

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function agentText(name) {
  return fs.readFileSync(path.join(AGENT_DIR, name), "utf8");
}

function compose() {
  return yaml.load(agentText("docker-compose.yml"));
}

/* name{labels} value lines of a Prometheus text recording. */
function promSeries(part) {
  const text = fs.readFileSync(
    path.join(RECORDINGS_DIR, "bulk", `${part}.prom`),
    "utf8",
  );
  return text
    .split("\n")
    .filter((line) => {
      return line !== "" && !line.startsWith("#");
    })
    .map((line) => {
      const match = /^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{(.*)\})? (\S+)$/.exec(
        line,
      );
      expect({ line, parsed: Boolean(match) }).toEqual({ line, parsed: true });
      const labels = {};
      for (const [, key, value] of (match[2] || "").matchAll(
        /([A-Za-z_][A-Za-z0-9_]*)="((?:[^"\\]|\\.)*)"/g,
      )) {
        labels[key] = value;
      }
      return { name: match[1], labels, value: Number(match[3]) };
    });
}

/* Every series name Dell's exporter answered, on every part it serves. */
function exportedNames() {
  const names = new Set();
  for (const file of fs.readdirSync(path.join(RECORDINGS_DIR, "bulk"))) {
    for (const series of promSeries(file.replace(/\.prom$/, ""))) {
      names.add(series.name);
    }
  }
  return names;
}

/* The datapoints the collector sent, from its recorded OTLP JSON lines. */
function recordedDatapoints(metricName) {
  const points = [];
  const text = fs.readFileSync(
    path.join(RECORDINGS_DIR, "collector", "metrics.jsonl"),
    "utf8",
  );
  for (const line of text.split("\n").filter(Boolean)) {
    for (const resourceMetrics of JSON.parse(line).resourceMetrics || []) {
      for (const scopeMetrics of resourceMetrics.scopeMetrics || []) {
        for (const metric of scopeMetrics.metrics || []) {
          if (metric.name !== metricName) {
            continue;
          }
          for (const point of (metric.gauge || metric.sum).dataPoints) {
            const attributes = {};
            for (const attribute of point.attributes || []) {
              attributes[attribute.key] = Object.values(attribute.value)[0];
            }
            points.push({
              unit: metric.unit,
              value: point.asDouble ?? Number(point.asInt),
              attributes,
            });
          }
        }
      }
    }
  }
  return points;
}

/* The log records the syslog collector sent, from its recorded OTLP lines. */
function recordedLogs() {
  const records = [];
  const text = fs.readFileSync(
    path.join(RECORDINGS_DIR, "collector", "syslog.jsonl"),
    "utf8",
  );
  for (const line of text.split("\n").filter(Boolean)) {
    for (const resourceLogs of JSON.parse(line).resourceLogs || []) {
      const resource = {};
      for (const attribute of resourceLogs.resource.attributes || []) {
        resource[attribute.key] = Object.values(attribute.value)[0];
      }
      for (const scopeLogs of resourceLogs.scopeLogs || []) {
        for (const record of scopeLogs.logRecords || []) {
          const attributes = {};
          for (const attribute of record.attributes || []) {
            attributes[attribute.key] = Object.values(attribute.value)[0];
          }
          records.push({
            resource,
            severityText: record.severityText,
            severityNumber: record.severityNumber,
            body: record.body ? Object.values(record.body)[0] : undefined,
            attributes,
          });
        }
      }
    }
  }
  return records;
}

/* ================================================== Dell's exporter service */

describe("docker-compose.yml: Dell's PowerStore exporter", () => {
  const service = compose().services["powerstore-exporter"];

  test("is built here from the pinned Dockerfile, never pulled, and tagged with Dell's release", () => {
    expect(service.build).toEqual({ context: ".", dockerfile: DOCKERFILE });
    expect(service.pull_policy).toBe("never");
    const release = /powerstore-metrics-exporter_v(\d+\.\d+\.\d+)\//.exec(
      agentText(DOCKERFILE),
    );
    expect(release).not.toBeNull();
    // A new release, or a new revision of the image, is a new tag, so
    // Compose builds it instead of keeping the old image.
    const tag = `oneuptime-storage-array-agent/powerstore-exporter:${release[1]}-`;
    expect(service.image.slice(0, tag.length)).toBe(tag);
    expect(service.image.slice(tag.length)).toMatch(/^[1-9][0-9]*$/);
  });

  test("starts only under the powerstore profile, unpublished and without privileges", () => {
    expect(service.profiles).toEqual(["powerstore"]);
    expect(service.expose).toEqual(["9010"]);
    expect(service).not.toHaveProperty("ports");
    expect(service.read_only).toBe(true);
    // Its config and the bulk archive live in memory only.
    expect(service.tmpfs).toEqual(["/tmp:size=256m,mode=1777"]);
    expect(service.cap_drop).toEqual(["ALL"]);
    expect(service.security_opt).toEqual(["no-new-privileges:true"]);
    expect(service.restart).toBe("unless-stopped");
    expect(service.logging).toEqual({
      driver: "json-file",
      options: { "max-size": "10m", "max-file": "3" },
    });
  });

  test("is given only its own settings, never the whole .env", () => {
    expect(service).not.toHaveProperty("env_file");
    expect(service.environment).toEqual([
      "POWERSTORE_ENDPOINT=${POWERSTORE_ENDPOINT:-}",
      "POWERSTORE_USERNAME=${POWERSTORE_USERNAME:-}",
      "POWERSTORE_PASSWORD=${POWERSTORE_PASSWORD:-}",
      "POWERSTORE_BULK_METRICS=${POWERSTORE_BULK_METRICS:-true}",
      "POWERSTORE_API_VERSION=${POWERSTORE_API_VERSION:-v3}",
      "POWERSTORE_REQUEST_LIMIT=${POWERSTORE_REQUEST_LIMIT:-16}",
    ]);
  });

  test("its command reads every value from its environment, so none reaches a command line", () => {
    expect(service.entrypoint).toEqual(["/bin/sh", "-c"]);
    expect(service.command).toHaveLength(1);
    // Compose would substitute a single $ from .env into the command, which
    // `docker inspect` and `ps` show: every $ in it is $$, the shell's.
    const single = service.command[0].replace(/\$\$/g, "").match(/\$/g);
    expect(single).toBeNull();
  });
});

/*
 * The command as the container's shell runs it: Compose turns $$ into $.
 * The exporter it execs is replaced by `stub`, and its tmpfs directory by
 * `dir`.
 */
function exporterCommand(dir, stub) {
  const command = compose().services["powerstore-exporter"].command[0].replace(
    /\$\$/g,
    "$",
  );
  expect(command).toContain("dir=/tmp/powerstore-exporter\n");
  expect(command).toContain(
    'exec /powerstore-exporter/powerstore-metrics-exporter -c "$dir/config.yml"',
  );
  return command
    .replace("dir=/tmp/powerstore-exporter\n", `dir='${dir}'\n`)
    .replace(
      "exec /powerstore-exporter/powerstore-metrics-exporter",
      `exec '${stub}'`,
    );
}

/* Run the exporter's command under sh with `env`, as its container does. */
function runExporterCommand(env) {
  const dir = scratch();
  const tmpfs = path.join(dir, "tmpfs");
  const stub = path.join(dir, "exporter");
  // The stand-in exporter prints the config it was handed and its mode.
  writeExecutable(
    stub,
    `#!/bin/sh
[ "$1" = "-c" ] || exit 9
printf 'MODE:%s\\n' "$(stat -c %a "$2")"
cat "$2"
`,
  );
  const result = spawnSync("sh", ["-c", exporterCommand(tmpfs, stub)], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
    timeout: 20000,
  });
  const mode = /^MODE:(\d+)\n/.exec(result.stdout || "");
  return {
    status: result.status,
    stderr: result.stderr,
    mode: mode ? mode[1] : null,
    config: mode ? yaml.load(result.stdout.slice(mode[0].length)) : null,
    tmpfs,
  };
}

const LOGIN = {
  POWERSTORE_ENDPOINT: "ps01.example.com",
  POWERSTORE_USERNAME: "oneuptime",
  POWERSTORE_PASSWORD: PASSWORD,
};

describe("the config Dell's exporter starts with", () => {
  test("is Dell's config.yml for one cluster, written owner-only to the tmpfs", () => {
    const run = runExporterCommand({ ...LOGIN });

    expect(run.status).toBe(0);
    expect(run.mode).toBe("600");
    expect(run.config).toEqual({
      exporter: {
        port: 9010,
        reqLimit: 16,
        bulkDir: `${run.tmpfs}/bulk/`,
        bulkCron: "*/5 * * * *",
        https: { enable: false },
      },
      // Dell's logger writes to stdout as well as to this file.
      log: { type: "logfmt", path: "/dev/null", level: "info" },
      storageList: [
        {
          ip: "ps01.example.com",
          user: "oneuptime",
          password: PASSWORD,
          apiVersion: "v3",
          apiLimit: 5000,
          bulkCollector: true,
        },
      ],
    });
    expect(fs.existsSync(path.join(run.tmpfs, "bulk"))).toBe(true);
  });

  test.each([
    ["quotes, a colon, a #, a backslash and a $", PASSWORD],
    ["a lone single quote", "'"],
    ["two single quotes", "''"],
    ["YAML's indicators first", "- [x] {y} *z &a !b %c @d `e` |f >g ?h"],
    ["what YAML would read as other types", "yes"],
    ["a number", "0123"],
    ["null", "null"],
    ["a tilde", "~"],
    ["spaces around it", "  pass word  "],
    ["a tab", "pass\tword"],
    ["shell syntax", "$(id) `id` ${HOME} $HOME; rm -rf /"],
    ["an escape YAML's double quotes would read", "\\n\\t\\u0041"],
    ["letters beyond ASCII", "pässwörd-密码-パスワード"],
    ["a comment", "pass #word"],
    ["a document marker", "--- ..."],
  ])("carries a password with %s exactly", (_label, password) => {
    const run = runExporterCommand({
      ...LOGIN,
      POWERSTORE_PASSWORD: password,
    });
    expect(run.status).toBe(0);
    expect(run.config.storageList[0].password).toBe(password);
    expect(run.config.storageList[0].user).toBe("oneuptime");
  });

  test("carries a user name and an address exactly too", () => {
    const run = runExporterCommand({
      POWERSTORE_ENDPOINT: "10.0.0.20",
      POWERSTORE_USERNAME: "dom'ain\\one uptime",
      POWERSTORE_PASSWORD: "x",
    });
    expect(run.status).toBe(0);
    expect(run.config.storageList[0]).toMatchObject({
      ip: "10.0.0.20",
      user: "dom'ain\\one uptime",
    });
  });

  test.each([
    [undefined, true],
    ["", true],
    ["true", true],
    ["yes", true],
    ["false", false],
    ["False", false],
    ["FALSE", false],
    ["no", false],
    ["0", false],
  ])("reads POWERSTORE_BULK_METRICS=%p as bulk %p", (value, bulk) => {
    const env = { ...LOGIN };
    if (value !== undefined) {
      env.POWERSTORE_BULK_METRICS = value;
    }
    expect(runExporterCommand(env).config.storageList[0].bulkCollector).toBe(
      bulk,
    );
  });

  test.each([
    [undefined, "v3"],
    ["v3", "v3"],
    ["v1", "v1"],
    ["v2", "v3"],
    ["", "v3"],
  ])("reads POWERSTORE_API_VERSION=%p as %p", (value, version) => {
    const env = { ...LOGIN };
    if (value !== undefined) {
      env.POWERSTORE_API_VERSION = value;
    }
    expect(runExporterCommand(env).config.storageList[0].apiVersion).toBe(
      version,
    );
  });

  test.each([
    [undefined, 16],
    ["8", 8],
    ["200", 200],
    ["", 16],
    ["many", 16],
    ["-1", 16],
    ["0", 16],
    ["08", 16],
    ["8; rm -rf /", 16],
  ])("reads POWERSTORE_REQUEST_LIMIT=%p as %p", (value, limit) => {
    const env = { ...LOGIN };
    if (value !== undefined) {
      env.POWERSTORE_REQUEST_LIMIT = value;
    }
    expect(runExporterCommand(env).config.exporter.reqLimit).toBe(limit);
  });

  test("refuses to start without the address, user or password, and names what is missing, not what is set", () => {
    const run = runExporterCommand({
      POWERSTORE_ENDPOINT: "ps01.example.com",
      POWERSTORE_PASSWORD: PASSWORD,
    });
    expect(run.status).toBe(1);
    expect(run.config).toBeNull();
    expect(run.stderr).toContain("Not set in .env: POWERSTORE_USERNAME.");
    expect(run.stderr).not.toContain(PASSWORD);
    expect(run.stderr).not.toContain("ps01.example.com");

    const none = runExporterCommand({});
    expect(none.status).toBe(1);
    expect(none.stderr).toContain(
      "Not set in .env: POWERSTORE_ENDPOINT POWERSTORE_USERNAME POWERSTORE_PASSWORD.",
    );
  });
});

describe("powerstore-exporter.Dockerfile", () => {
  const dockerfile = agentText(DOCKERFILE);
  const instructions = dockerfile
    .split("\n")
    .filter((line) => {
      return /^[A-Z]+ /.test(line);
    })
    .map((line) => {
      return line.split(" ")[0];
    });

  test("builds Dell's documented image: busybox, the release binary, nothing else", () => {
    expect(instructions).toEqual([
      "FROM",
      "ADD",
      "RUN",
      "USER",
      "EXPOSE",
      "ENTRYPOINT",
    ]);
  });

  test("pins its base by digest", () => {
    expect(dockerfile).toMatch(
      /^FROM quay\.io\/prometheus\/busybox-linux-amd64:latest@sha256:[0-9a-f]{64}$/m,
    );
  });

  test("checks Dell's release binary against its SHA-256 before it is used", () => {
    const add = /^ADD (\S+) (\S+)$/m.exec(dockerfile);
    expect(add[1]).toMatch(
      /^https:\/\/github\.com\/dell\/powerstore-metrics-exporter\/releases\/download\/powerstore-metrics-exporter_v\d+\.\d+\.\d+\/powerstore-metrics-exporter$/,
    );
    expect(add[2]).toBe("/powerstore-exporter/powerstore-metrics-exporter");
    expect(dockerfile).toMatch(
      /^RUN echo "[0-9a-f]{64} {2}\/powerstore-exporter\/powerstore-metrics-exporter" \| sha256sum -c - \\$/m,
    );
  });

  test("runs the exporter as nobody, on the port the collector scrapes", () => {
    expect(dockerfile).toMatch(/^USER 65534:65534$/m);
    expect(dockerfile).toMatch(/^EXPOSE 9010$/m);
    expect(dockerfile).toContain(
      'ENTRYPOINT ["/powerstore-exporter/powerstore-metrics-exporter"]',
    );
    // Its config, which holds the password, is never part of the image.
    expect(dockerfile).not.toMatch(/^(COPY|ADD) .*config/m);
  });

  test("names the release the recordings were made with", () => {
    const readme = fs.readFileSync(
      path.join(RECORDINGS_DIR, "README.md"),
      "utf8",
    );
    const release = /powerstore-metrics-exporter_v(\d+\.\d+\.\d+)\//.exec(
      dockerfile,
    )[1];
    expect(path.basename(RECORDINGS_DIR)).toBe(`v${release}`);
    expect(readme).toContain(`v${release}`);
  });
});

/* ===================================================== the syslog collector */

describe("docker-compose.yml: PowerStore's syslog collector", () => {
  const services = compose().services;
  const service = services["powerstore-syslog"];

  test("runs the agent's own collector image, only under the powerstore profile", () => {
    expect(service.image).toBe(services[COLLECTOR_SERVICE].image);
    expect(agentText("docker-compose.yml")).toContain(
      "image: &collector-image otel/opentelemetry-collector-contrib:",
    );
    expect(agentText("docker-compose.yml")).toContain(
      "image: *collector-image",
    );
    expect(service.profiles).toEqual(["powerstore"]);
  });

  test("mounts its config read-only, and publishes the syslog port for TCP and UDP", () => {
    expect(service.volumes).toEqual([
      `./${SYSLOG_CONFIG}:/etc/otelcol-contrib/config.yaml:ro`,
    ]);
    expect(service.ports).toEqual([
      "${POWERSTORE_SYSLOG_PORT:-5514}:5514/tcp",
      "${POWERSTORE_SYSLOG_PORT:-5514}:5514/udp",
    ]);
    // TLS ships commented out: its port and the certificate mounts.
    const text = agentText("docker-compose.yml");
    expect(text).toContain('      # - "6514:6514/tcp"\n');
    expect(text).toContain(
      "      # - ./powerstore-syslog-tls.crt:/etc/otelcol-contrib/powerstore-syslog-tls.crt:ro\n",
    );
    expect(text).toContain(
      "      # - ./powerstore-syslog-tls.key:/etc/otelcol-contrib/powerstore-syslog-tls.key:ro\n",
    );
  });

  test("is given what its config reads, and never the PowerStore's password", () => {
    expect(service).not.toHaveProperty("env_file");
    /*
     * The three the agent needs too are required here as there - no
     * default (the agent page's Required column reads the compose file so) -
     * and the platform has the PowerStore's own.
     */
    expect(service.environment).toEqual([
      "ONEUPTIME_URL=${ONEUPTIME_URL}",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY=${ONEUPTIME_TELEMETRY_INGESTION_KEY}",
      "STORAGE_ARRAY_NAME=${STORAGE_ARRAY_NAME}",
      "STORAGE_SYSTEM=${STORAGE_SYSTEM:-dell.powerstore}",
    ]);
    const read = new Set(
      [...agentText(SYSLOG_CONFIG).matchAll(/\$\{env:([A-Z0-9_]+)\}/g)].map(
        (match) => {
          return match[1];
        },
      ),
    );
    expect([...read].sort()).toEqual(
      service.environment
        .map((line) => {
          return line.split("=")[0];
        })
        .sort(),
    );
  });

  test("is hardened like the agent's other containers", () => {
    expect(service.read_only).toBe(true);
    expect(service.cap_drop).toEqual(["ALL"]);
    expect(service.security_opt).toEqual(["no-new-privileges:true"]);
    expect(service.restart).toBe("unless-stopped");
  });
});

describe("powerstore-syslog.yaml", () => {
  const text = agentText(SYSLOG_CONFIG);
  const parsed = yaml.load(text);

  test("listens on TCP and UDP on the port the compose file publishes, parsing both alike", () => {
    expect(Object.keys(parsed.receivers)).toEqual(["syslog/tcp", "syslog/udp"]);
    expect(parsed.receivers["syslog/tcp"].tcp).toEqual({
      listen_address: "0.0.0.0:5514",
    });
    expect(parsed.receivers["syslog/udp"].udp).toEqual({
      listen_address: "0.0.0.0:5514",
    });
    for (const receiver of Object.values(parsed.receivers)) {
      expect(receiver.protocol).toBe("rfc3164");
      expect(receiver.location).toBe("UTC");
    }
    // One list of operators, anchored once and used twice.
    expect(parsed.receivers["syslog/udp"].operators).toEqual(
      parsed.receivers["syslog/tcp"].operators,
    );
    expect(text).toContain("operators: &powerstore-operators\n");
    expect(text.split("*powerstore-operators").length - 1).toBe(2);
  });

  test("ships syslog over TLS commented out, on 6514 with the certificates the compose file mounts", () => {
    for (const line of [
      "  # syslog/tls:",
      '  #     listen_address: "0.0.0.0:6514"',
      "  #       cert_file: /etc/otelcol-contrib/powerstore-syslog-tls.crt",
      "  #       key_file: /etc/otelcol-contrib/powerstore-syslog-tls.key",
      "  #   protocol: rfc3164",
      "  #   operators: *powerstore-operators",
    ]) {
      expect(text).toContain(`${line}\n`);
    }
  });

  test("runs one logs pipeline into OneUptime, stamping the array as the metrics do", () => {
    expect(parsed.service.pipelines).toEqual({
      logs: {
        receivers: ["syslog/tcp", "syslog/udp"],
        processors: [
          "memory_limiter",
          "transform/powerstore-record",
          "transform/powerstore-alert-severity",
          "resource",
          "batch",
        ],
        exporters: ["otlphttp"],
      },
    });
    expect(parsed.exporters).toEqual(yaml.load(agentText(CONFIG)).exporters);
    expect(parsed.processors.resource).toEqual(
      yaml.load(agentText(CONFIG)).processors.resource,
    );
  });

  /*
   * Dell's Events and Alerts Reference Guide gives every event code's
   * severity (Fixtures/DellPowerStore/event-codes.json, read from its Rev
   * A08): the config's Critical and Major lists are exactly its own.
   */
  test("calls an alert Critical or Major exactly when Dell's guide does", () => {
    const codes = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "event-codes.json"), "utf8"),
    );
    const statements =
      parsed.processors["transform/powerstore-alert-severity"].log_statements[0]
        .statements;
    const listed = (severity) => {
      const statement = statements.find((candidate) => {
        return candidate.startsWith(
          `set(attributes["powerstore.alert.severity"], "${severity}")`,
        );
      });
      expect(statement).toBeDefined();
      return [...statement.matchAll(/\(\?:([0-9A-Fa-f|]+)\)\$/g)].flatMap(
        (match) => {
          return match[1].split("|").map((code) => {
            return `0x${code.toUpperCase()}`;
          });
        },
      );
    };
    const critical = listed("Critical");
    const major = listed("Major");
    expect(critical.length).toBe(new Set(critical).size);
    expect(major.length).toBe(new Set(major).size);
    expect([...critical].sort()).toEqual([...codes.CRITICAL].sort());
    expect([...major].sort()).toEqual([...codes.MAJOR].sort());
    expect(critical.length).toBe(163);
    expect(major.length).toBe(614);
  });

  test("writes every attribute PowerStore's alert templates read", () => {
    const syslog = fs.readFileSync(
      path.join(PLATFORM_DIR, "PowerStoreSyslog.ts"),
      "utf8",
    );
    // The object's values, after its type.
    const block =
      /POWERSTORE_LOG_ATTRIBUTES: \{[\s\S]*?\} = \{([\s\S]*?)\n\};/.exec(
        syslog,
      );
    expect(block).not.toBeNull();
    const names = [...block[1].matchAll(/"(powerstore\.[a-z._]+)"/g)].map(
      (match) => {
        return match[1];
      },
    );
    expect(names).toHaveLength(9);
    for (const name of names) {
      expect({
        name,
        written: text.includes(`set(attributes["${name}"],`),
      }).toEqual({
        name,
        written: true,
      });
    }
  });
});

/*
 * The syslog samples (Fixtures/DellPowerStore/syslog-samples.txt: three
 * lines a real PowerStore sent, as SC4S's tests hold them, and lines built
 * on Dell's documented record), as the shipped syslog collector made them
 * logs of the array.
 */
describe("PowerStore's syslog, as the shipped collector sends it", () => {
  const records = recordedLogs();
  const byBody = (body) => {
    const found = records.filter((record) => {
      return record.body === body;
    });
    expect({ body, found: found.length }).toEqual({ body, found: 1 });
    return found[0];
  };

  test("every line is a log of the array, whatever it says", () => {
    const samples = fs
      .readFileSync(path.join(FIXTURES_DIR, "syslog-samples.txt"), "utf8")
      .split("\n")
      .filter(Boolean);
    // The samples, and the two lines the behaviour script sends itself.
    expect(records.length).toBeGreaterThanOrEqual(samples.length);
    for (const record of records) {
      expect(record.resource).toEqual({
        "storage.array.name": "ps-prod-01",
        "storage.system": "dell.powerstore",
        "oneuptime.agent.version": agentKindVersion(
          "STORAGE_ARRAY_AGENT_VERSION",
        ),
      });
      // PowerStore's record is read out; nothing raw is left behind.
      expect(record.attributes).not.toHaveProperty("powerstore");
      expect(record.attributes).not.toHaveProperty("message");
    }
  });

  test("an active alert carries PowerStore's record, its severity from Dell's codes", () => {
    const portDown = byBody("Port link is down.");
    expect(portDown.attributes).toMatchObject({
      "powerstore.message_type": "AlertEvent",
      "powerstore.host": "PS4f5c9a3d21e7-B",
      "powerstore.alert.id": "7c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5",
      "powerstore.alert.state": "Active",
      "powerstore.event.code": "0x00307404",
      "powerstore.event.name": "PORT_LINK_DOWN",
      "powerstore.resource.type": "fc_port",
      "powerstore.resource.name": "BaseEnclosure-NodeB-IoModule0-FEPort1",
      "powerstore.appliance.name": "ps-prod-01-appliance-2",
      "powerstore.system_impact":
        "Host connectivity through this port is lost.",
      "powerstore.repair_flow":
        "Check cabling, your SFP connectors, and connectivity to the port.",
      // Sent at syslog's info priority; Dell's guide lists the code as Major.
      "powerstore.alert.severity": "Major",
    });
    expect(portDown.severityText).toBe("Major");
    expect(portDown.severityNumber).toBe(17);

    const drive = byBody(
      "Drive in bus 0 enclosure 0 slot 7 has failed for this reason: media failure.",
    );
    expect(drive.attributes["powerstore.alert.severity"]).toBe("Critical");
    expect(drive.severityText).toBe("Critical");
    expect(drive.severityNumber).toBe(21);

    expect(
      byBody("Physical capacity utilization is above 90 percent.").attributes[
        "powerstore.alert.severity"
      ],
    ).toBe("Major");
  });

  test("a code Dell's guide does not list takes the line's syslog priority", () => {
    const newer = byBody(
      "An event code Dell's guide of February 2025 does not list.",
    );
    // <107>: err.
    expect(newer.attributes["powerstore.event.code"]).toBe("0x0ff00101");
    expect(newer.attributes["powerstore.alert.severity"]).toBe("Major");
  });

  test("a Cleared line closes its alert and has no severity of its own", () => {
    const up = byBody("Port state has changed from Down to Up.");
    expect(up.attributes).toMatchObject({
      "powerstore.alert.id": "7c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5",
      "powerstore.alert.state": "Cleared",
      "powerstore.resource.name": "BaseEnclosure-NodeB-IoModule0-FEPort1",
    });
    expect(up.attributes).not.toHaveProperty("powerstore.alert.severity");
    // The same alert id as the line that raised it, which it resolves.
    expect(byBody("Port link is down.").attributes["powerstore.alert.id"]).toBe(
      up.attributes["powerstore.alert.id"],
    );
  });

  test("an audit event carries who did what, and is no alert", () => {
    const login = byBody('User "admin" logged in successfully.');
    expect(login.attributes).toMatchObject({
      "powerstore.message_type": "Authentication",
      "powerstore.audit.id": "2341",
      "powerstore.audit.user": "admin",
      "powerstore.audit.action": "None",
      "powerstore.audit.status": "success",
      "powerstore.audit.resource_type": "login_session",
      "powerstore.audit.client_ip": "10.114.173.252",
      "powerstore.appliance": "APM00243620939",
    });
    expect(login.attributes).not.toHaveProperty("powerstore.alert.id");
    expect(login.attributes).not.toHaveProperty("powerstore.alert.severity");
  });

  test("a line that is not PowerStore's is kept as it came", () => {
    const foreign = byBody("This line is not PowerStore's at all.");
    expect(
      Object.keys(foreign.attributes).filter((key) => {
        return key.startsWith("powerstore.");
      }),
    ).toEqual([]);
  });

  /*
   * The record's regex is RE2 in the config; JavaScript reads the same
   * pattern once its named groups are spelled (?<name>).
   */
  test("the record's pattern reads every PowerStore line of the samples, and no other", () => {
    const operators = yaml.load(agentText(SYSLOG_CONFIG)).receivers[
      "syslog/tcp"
    ].operators;
    const pattern = new RegExp(operators[0].regex.replace(/\(\?P</g, "(?<"));
    const samples = fs
      .readFileSync(path.join(FIXTURES_DIR, "syslog-samples.txt"), "utf8")
      .split("\n")
      .filter(Boolean);
    const read = samples.map((line) => {
      // What the rfc3164 parser hands the operators: the message after the
      // header (<pri>timestamp host).
      const message = line.replace(
        /^<\d+>\w{3} [ \d]\d \d{2}:\d{2}:\d{2} \S+ /,
        "",
      );
      const match = pattern.exec(message);
      return match ? match.groups.sdid : null;
    });
    expect(read).toEqual([
      "PowerStore_audit_event",
      "PowerStore_audit_event",
      "PowerStore_remote_logging_alert",
      "PowerStore_remote_logging_alert",
      "PowerStore_remote_logging_alert",
      "PowerStore_remote_logging_alert",
      "PowerStore_remote_logging_alert",
      "PowerStore_remote_logging_alert",
      null,
    ]);
  });
});

/* ===================================================== the collector config */

describe("otel-collector-config.powerstore.yaml", () => {
  const parsed = yaml.load(agentText(CONFIG));
  const exported = exportedNames();

  test("scrapes each part Dell's exporter serves, and only those", () => {
    const parts = parsed.receivers.prometheus.config.scrape_configs.map(
      (job) => {
        return job.metrics_path.replace(
          "/metrics/${env:POWERSTORE_ENDPOINT}/",
          "",
        );
      },
    );
    expect([...parts].sort()).toEqual(
      fs
        .readdirSync(path.join(RECORDINGS_DIR, "bulk"))
        .map((file) => {
          return file.replace(/\.prom$/, "");
        })
        .sort(),
    );
  });

  test("names only series Dell's exporter sends, and derives the two percents the catalog reads", () => {
    const text = agentText(CONFIG);
    const named = new Set(
      [...text.matchAll(/\b(powerstore_[A-Za-z_]+)\b/g)].map((match) => {
        return match[1];
      }),
    );
    const derived = [
      "powerstore_cap_physical_used_percent",
      "powerstore_filesystem_logical_used_percent",
    ];
    for (const name of named) {
      expect({
        name,
        known: exported.has(name) || derived.includes(name),
      }).toEqual({ name, known: true });
    }
    const metrics = fs.readFileSync(
      path.join(PLATFORM_DIR, "PowerStoreMetrics.ts"),
      "utf8",
    );
    for (const name of derived) {
      expect(exported.has(name)).toBe(false);
      expect(metrics).toContain(`"${name}"`);
    }
  });

  test("divides each appliance's and each file system's used space by its own total", () => {
    const rules =
      parsed.processors["metricsgeneration/powerstore-space-used-percent"]
        .rules;
    expect(rules).toEqual([
      {
        name: "powerstore_cap_physical_used_percent",
        unit: "%",
        type: "calculate",
        metric1: "powerstore_cap_last_physical_used",
        metric2: "powerstore_cap_last_physical_total",
        operation: "percent",
      },
      {
        name: "powerstore_filesystem_logical_used_percent",
        unit: "%",
        type: "calculate",
        metric1: "powerstore_filesystem_logical_used",
        metric2: "powerstore_filesystem_logical_provisioned",
        operation: "percent",
      },
    ]);
    // Each object a resource of its own, keyed by the label its series carry.
    const keys = parsed.processors["groupbyattrs/powerstore-space-object"].keys;
    expect(keys).toEqual(["appliance_id", "name"]);
    for (const rule of rules) {
      for (const metric of [rule.metric1, rule.metric2]) {
        const series = [
          ...promSeries("capacity"),
          ...promSeries("file"),
        ].filter((candidate) => {
          return candidate.name === metric;
        });
        expect(series.length).toBeGreaterThan(0);
        for (const one of series) {
          expect(
            keys.filter((key) => {
              return key in one.labels;
            }),
          ).toHaveLength(1);
        }
      }
    }
  });

  test("sent each used percent as used / total of the same scrape, with the object's own label", () => {
    const cases = [
      [
        "powerstore_cap_physical_used_percent",
        "capacity",
        "powerstore_cap_last_physical_used",
        "powerstore_cap_last_physical_total",
        "appliance_id",
      ],
      [
        "powerstore_filesystem_logical_used_percent",
        "file",
        "powerstore_filesystem_logical_used",
        "powerstore_filesystem_logical_provisioned",
        "name",
      ],
    ];
    for (const [percent, part, used, total, key] of cases) {
      const series = promSeries(part);
      const valueOf = (name, id) => {
        return series.find((one) => {
          return one.name === name && one.labels[key] === id;
        }).value;
      };
      const points = recordedDatapoints(percent);
      const ids = [
        ...new Set(
          series
            .filter((one) => {
              return one.name === total;
            })
            .map((one) => {
              return one.labels[key];
            }),
        ),
      ];
      expect(
        [
          ...new Set(
            points.map((point) => {
              return point.attributes[key];
            }),
          ),
        ].sort(),
      ).toEqual([...ids].sort());
      for (const point of points) {
        const id = point.attributes[key];
        expect(point.unit).toBe("%");
        expect(point.attributes.scrape_endpoint).toBe(part);
        expect(point.value).toBeCloseTo(
          (valueOf(used, id) / valueOf(total, id)) * 100,
          6,
        );
      }
    }
  });

  test("reads a Healthy node as 1, as Dell's description of the series says, and keeps its state", () => {
    expect(
      parsed.processors["transform/powerstore-node-state"].metric_statements,
    ).toEqual([
      {
        context: "datapoint",
        statements: [
          'set(value_double, 1.0) where metric.name == "powerstore_hardware_node_state" and attributes["state"] == "Healthy"',
        ],
      },
    ]);
    // Dell's exporter writes 0 for every node; the collector's 1 for each
    // Healthy one.
    const nodes = promSeries("hardware").filter((one) => {
      return one.name === "powerstore_hardware_node_state";
    });
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.value).toBe(0);
    }
    for (const point of recordedDatapoints("powerstore_hardware_node_state")) {
      expect(point.value).toBe(point.attributes.state === "Healthy" ? 1 : 0);
    }
  });
});

/* ================================================================ install.sh */

function installStubs(dir) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s | %s\\n' "$PWD" "$*" >> "$STUB_DIR/docker.log"
exit 0
`,
  );
  writeExecutable(
    path.join(bin, "curl"),
    agentFilesCurlStub({
      installName: "storage-array-agent",
      agentDirectory: "StorageArrayAgent",
      servedDir: AGENT_DIR,
    }),
  );
  return bin;
}

function install(dir, { env = {}, input = "" } = {}) {
  const bin = fs.existsSync(path.join(dir, "bin"))
    ? path.join(dir, "bin")
    : installStubs(dir);
  const installDir = path.join(dir, "agent");
  const result = spawnSync("bash", [path.join(AGENT_DIR, "install.sh")], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: dir,
      STUB_DIR: dir,
      INSTALL_DIR: installDir,
      ...env,
    },
    input,
    encoding: "utf8",
    timeout: 60000,
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    installDir,
    envFile: readIfExists(path.join(installDir, ".env")),
    docker: readIfExists(path.join(dir, "docker.log")),
  };
}

function envLines(envFile) {
  const values = {};
  for (const line of envFile.split("\n").filter(Boolean)) {
    const at = line.indexOf("=");
    values[line.slice(0, at)] = line.slice(at + 1);
  }
  return values;
}

/*
 * A value of .env as Compose reads it (compose-go's dotenv): single quotes
 * literal, double quotes with \\ \" and $$ undone.
 */
function composeValue(raw) {
  if (raw.startsWith("'")) {
    expect(raw.endsWith("'")).toBe(true);
    return raw.slice(1, -1);
  }
  if (raw.startsWith('"')) {
    expect(raw.endsWith('"')).toBe(true);
    return raw.slice(1, -1).replace(/\$\$|\\(.)/g, (match, escaped) => {
      return match === "$$" ? "$" : escaped;
    });
  }
  return raw;
}

function answers(...lines) {
  return `${lines.join("\n")}\n`;
}

/* The menu number of the PowerStore line of install.sh's PLATFORMS table. */
function powerStoreChoice() {
  const table = /^PLATFORMS="\n([\s\S]*?)\n"$/m.exec(agentText("install.sh"));
  const lines = table[1].split("\n").filter((line) => {
    return line.trim() !== "";
  });
  const index = lines.findIndex((line) => {
    return line.startsWith(`${CONFIG}|`);
  });
  expect(index).toBeGreaterThan(-1);
  return String(index + 1);
}

describe("agents/StorageArrayAgent/install.sh for a PowerStore", () => {
  test("asks for the cluster, a user and its password, and writes what the exporter and the collector read", () => {
    const dir = scratch();
    const run = install(dir, {
      input: answers(
        "https://oneuptime.example.com",
        INGESTION_KEY,
        powerStoreChoice(),
        "ps-prod-01",
        "https://ps-prod-01.example.com/",
        "oneuptime",
        PASSWORD,
      ),
    });

    expect(run.status).toBe(0);
    const values = envLines(run.envFile);
    expect(values).toMatchObject({
      STORAGE_SYSTEM: "dell.powerstore",
      STORAGE_ARRAY_COLLECTOR_CONFIG: CONFIG,
      COMPOSE_PROFILES: "powerstore",
      STORAGE_ARRAY_NAME: "'ps-prod-01'",
      // The bare address Dell's exporter wants.
      POWERSTORE_ENDPOINT: "'ps-prod-01.example.com'",
      POWERSTORE_USERNAME: "'oneuptime'",
      // Pure's settings stay empty.
      PURE_FA_ENDPOINT: "''",
      PURE_FA_API_TOKEN: "''",
    });
    // The password reaches Compose exactly as typed, $ and all.
    expect(composeValue(values.POWERSTORE_PASSWORD)).toBe(PASSWORD);
    // Its options stay empty, so the compose file's defaults apply.
    for (const name of [
      "POWERSTORE_BULK_METRICS",
      "POWERSTORE_API_VERSION",
      "POWERSTORE_REQUEST_LIMIT",
      "POWERSTORE_SYSLOG_PORT",
    ]) {
      expect(values[name]).toBe("''");
    }
    expect(fs.statSync(path.join(run.installDir, ".env")).mode & 0o777).toBe(
      0o600,
    );
    // The password was read without echo, and is never printed.
    expect(agentText("install.sh")).toContain(
      `read -rsp "That user's password: " "$TOKEN_VARIABLE"`,
    );
    expect(run.output).not.toContain(PASSWORD);
    // Dell's exporter does not verify the cluster's certificate: no question.
    expect(run.output).not.toContain("self-signed certificate");
    expect(run.output).not.toContain("API token");
    expect(run.output).toContain(
      "Reading the PowerStore at ps-prod-01.example.com through Dell's exporter (powerstore-exporter).",
    );
  });

  test("downloads the exporter's Dockerfile and the syslog config beside the configs", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_ARRAY_COLLECTOR_CONFIG: CONFIG,
        STORAGE_ARRAY_NAME: "ps-prod-01",
        POWERSTORE_ENDPOINT: "ps-prod-01.example.com",
        POWERSTORE_USERNAME: "oneuptime",
        POWERSTORE_PASSWORD: PASSWORD,
      },
    });

    expect(run.status).toBe(0);
    for (const file of [
      "docker-compose.yml",
      CONFIG,
      DOCKERFILE,
      SYSLOG_CONFIG,
    ]) {
      expect(fs.readFileSync(path.join(run.installDir, file), "utf8")).toBe(
        agentText(file),
      );
    }
    // Every profile's containers stop, then what .env selects starts.
    expect(run.docker).toContain(
      "compose --profile flasharray-exporter --profile flashblade --profile powerstore --profile netapp-ontap down --remove-orphans",
    );
    expect(run.docker).toContain("compose up -d --force-recreate");
  });

  test("STORAGE_SYSTEM=dell.powerstore picks the PowerStore config without asking", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_SYSTEM: "dell.powerstore",
        STORAGE_ARRAY_NAME: "ps-prod-01",
        POWERSTORE_ENDPOINT: "10.0.0.30",
        POWERSTORE_USERNAME: "oneuptime",
        POWERSTORE_PASSWORD: "secret",
      },
    });

    expect(run.status).toBe(0);
    expect(run.output).not.toContain("Which array does this agent monitor?");
    expect(envLines(run.envFile)).toMatchObject({
      STORAGE_ARRAY_COLLECTOR_CONFIG: CONFIG,
      COMPOSE_PROFILES: "powerstore",
      STORAGE_SYSTEM: "dell.powerstore",
    });
  });

  test("a re-run reuses the login and keeps the options set in .env, without asking", () => {
    const dir = scratch();
    const first = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_ARRAY_COLLECTOR_CONFIG: CONFIG,
        STORAGE_ARRAY_NAME: "ps-prod-01",
        POWERSTORE_ENDPOINT: "ps-prod-01.example.com",
        POWERSTORE_USERNAME: "oneuptime",
        POWERSTORE_PASSWORD: PASSWORD,
      },
    });
    expect(first.status).toBe(0);
    // An older PowerStoreOS, and a second agent's syslog port.
    const envFile = path.join(first.installDir, ".env");
    fs.writeFileSync(
      envFile,
      first.envFile
        .replace("POWERSTORE_BULK_METRICS=''", "POWERSTORE_BULK_METRICS=false")
        .replace("POWERSTORE_SYSLOG_PORT=''", "POWERSTORE_SYSLOG_PORT=5515"),
    );

    // No input at all: any prompt would read EOF and stop the script.
    const second = install(dir);
    expect(second.status).toBe(0);
    expect(second.output).toContain("reusing it");
    const values = envLines(second.envFile);
    expect(composeValue(values.POWERSTORE_PASSWORD)).toBe(PASSWORD);
    expect(values.POWERSTORE_USERNAME).toBe("'oneuptime'");
    expect(composeValue(values.POWERSTORE_BULK_METRICS)).toBe("false");
    expect(composeValue(values.POWERSTORE_SYSLOG_PORT)).toBe("5515");
    expect(second.output).not.toContain(PASSWORD);
  });

  test("still refuses a $ in a value the collector reads", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_ARRAY_COLLECTOR_CONFIG: CONFIG,
        STORAGE_ARRAY_NAME: "ps-prod-01",
        POWERSTORE_ENDPOINT: "ps$01.example.com",
      },
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("POWERSTORE_ENDPOINT must not contain a $");
    expect(run.envFile).toBe("");
  });
});

/* =========================================================== troubleshoot.sh */

/*
 * `docker` answers as a healthy install would: the container's environment
 * from container.env, OneUptime accepting the key, and the probe of Dell's
 * exporter (any powerstore-exporter:9010 URL) from exporter.out with
 * exporter.exit as curl's exit code. Every call is logged, and what a
 * `docker run -i` read on stdin too.
 */
function troubleshootStubs(dir) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s' "$*" | tr '\\n' ' ' >> "$STUB_DIR/docker.log"
printf '\\n' >> "$STUB_DIR/docker.log"
case "$1" in
  info) exit 0 ;;
  compose) exit 0 ;;
  inspect)
    case "$*" in
      *Config.Env*) cat "$STUB_DIR/container.env" ;;
      *restarting*) printf 'running restarting=false restarts=0\\n' ;;
    esac
    exit 0 ;;
  logs) exit 0 ;;
  run)
    for arg in "$@"; do
      [ "$arg" = "-i" ] && cat >> "$STUB_DIR/stdin.log"
    done
    case "$*" in
      */otlp/v1/validate*) printf '{"valid":true,"keyType":"Server"}\\nOUSTATUS:200\\n' ;;
      *127.0.0.1:8888/metrics*)
        printf 'otelcol_receiver_accepted_metric_points 10\\notelcol_exporter_sent_metric_points 10\\notelcol_exporter_send_failed_metric_points 0\\n' ;;
      *powerstore-exporter:9010/*)
        cat "$STUB_DIR/exporter.out"
        exit "$(cat "$STUB_DIR/exporter.exit")" ;;
    esac
    exit 0 ;;
esac
exit 0
`,
  );
  return bin;
}

const CLUSTER =
  'powerstore_cluster{IP="ps-prod-01.example.com",global_id="PS4f5c9a3d21e7",management_address="10.0.0.30",master_appliance_id="A1",name="ps-prod-01"} 0';

const POWERSTORE_ENV = {
  ONEUPTIME_URL: "https://oneuptime.example.com",
  ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
  STORAGE_ARRAY_NAME: "ps-prod-01",
  STORAGE_SYSTEM: "dell.powerstore",
  STORAGE_ARRAY_COLLECTOR_CONFIG: CONFIG,
  COMPOSE_PROFILES: "powerstore",
  POWERSTORE_ENDPOINT: "ps-prod-01.example.com",
  POWERSTORE_USERNAME: "oneuptime",
  POWERSTORE_PASSWORD: "S3cret-Passw0rd",
};

function doctor(env, { body = "", status = "200", curlExit = 0 } = {}) {
  const dir = scratch();
  const bin = troubleshootStubs(dir);
  const envText = `${Object.entries(env)
    .map(([key, value]) => {
      return `${key}=${value}`;
    })
    .join("\n")}\n`;
  fs.writeFileSync(path.join(dir, "container.env"), envText);
  fs.writeFileSync(
    path.join(dir, "exporter.out"),
    `${body}\nOUSTATUS:${status}\n`,
  );
  fs.writeFileSync(path.join(dir, "exporter.exit"), `${curlExit}\n`);
  const installDir = path.join(dir, "agent");
  fs.mkdirSync(installDir);
  for (const file of fs.readdirSync(AGENT_DIR)) {
    if (file.endsWith(".yml") || file.endsWith(".yaml")) {
      fs.copyFileSync(path.join(AGENT_DIR, file), path.join(installDir, file));
    }
  }
  fs.writeFileSync(path.join(installDir, ".env"), envText);

  const result = spawnSync(
    "bash",
    [path.join(AGENT_DIR, "troubleshoot.sh"), "-d", installDir, "--no-color"],
    {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, STUB_DIR: dir },
      input: "",
      encoding: "utf8",
      timeout: 60000,
    },
  );
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    docker: readIfExists(path.join(dir, "docker.log")),
    stdin: readIfExists(path.join(dir, "stdin.log")),
  };
}

/* The ✔ / ✗ / ▲ lines of the array section, in order. */
function arrayCheckLines(output) {
  const lines = output.split("\n");
  const start = lines.findIndex((line) => {
    return line === "── 2. Array endpoint & API token ──";
  });
  expect(start).toBeGreaterThan(-1);
  const end = lines.findIndex((line, index) => {
    return index > start && /^── .* ──$/.test(line);
  });
  return lines
    .slice(start + 1, end)
    .filter((line) => {
      return /^ {2}[✔✗▲] /.test(line);
    })
    .map((line) => {
      return line.trim();
    });
}

function exporterProbes(run) {
  return run.docker.split("\n").filter((line) => {
    return line.startsWith("run ") && line.includes("powerstore-exporter:9010");
  });
}

describe("agents/StorageArrayAgent/troubleshoot.sh for a PowerStore", () => {
  test("probes Dell's exporter at the cluster's path, as the collector scrapes it, and names the cluster", () => {
    const run = doctor(POWERSTORE_ENV, { body: CLUSTER });

    expect(arrayCheckLines(run.output)).toEqual([
      "✔ COMPOSE_PROFILES includes 'powerstore' (starts the exporter this config scrapes).",
      "✔ POWERSTORE_USERNAME and POWERSTORE_PASSWORD are set.",
      "✔ The cluster answers through Dell's exporter: ps-prod-01 (PowerStoreOS).",
    ]);
    const probes = exporterProbes(run);
    expect(probes).toHaveLength(1);
    expect(probes[0]).toContain(
      "http://powerstore-exporter:9010/metrics/ps-prod-01.example.com/cluster",
    );
    // No credential: Dell's exporter holds it.
    expect(probes[0]).not.toContain("-H");
    expect(probes[0]).not.toContain(" -i ");
    expect(run.stdin).toBe("");
    expect(run.output).not.toContain(POWERSTORE_ENV.POWERSTORE_PASSWORD);
    expect(run.docker).not.toContain(POWERSTORE_ENV.POWERSTORE_PASSWORD);
    expect(run.output).toContain(
      "Mode: PowerStore through Dell's exporter, the powerstore-exporter service",
    );
  });

  test("an exporter that does not answer is the root cause, with what starts it", () => {
    const run = doctor(POWERSTORE_ENV, {
      body: "curl: (6) Could not resolve host: powerstore-exporter",
      status: "000",
      curlExit: 6,
    });

    expect(run.status).toBe(1);
    expect(run.output).toContain(
      "ROOT CAUSE: Dell's exporter service does not answer.",
    );
    expect(run.output).toContain("docker compose logs powerstore-exporter");
  });

  test("an answer without the cluster is a login the exporter could not make", () => {
    // Dell's exporter answers 200 with nothing of the cluster's when the
    // cluster refuses its login.
    const run = doctor(POWERSTORE_ENV, { body: "" });

    expect(run.status).toBe(1);
    expect(arrayCheckLines(run.output)).toContain(
      "✗ Dell's exporter answered without powerstore_cluster: it could not log in to the PowerStore, or reach it.",
    );
    expect(run.output).toContain(
      "ROOT CAUSE: Dell's exporter cannot log in to the PowerStore, or reach it.",
    );
  });

  test("a missing user or password is a misconfiguration, and the exporter is not probed", () => {
    const { POWERSTORE_USERNAME, ...withoutUser } = POWERSTORE_ENV;
    expect(POWERSTORE_USERNAME).toBe("oneuptime");
    const run = doctor(withoutUser, { body: CLUSTER });

    expect(run.status).toBe(1);
    expect(arrayCheckLines(run.output)).toContain(
      "✗ POWERSTORE_USERNAME or POWERSTORE_PASSWORD is not set — Dell's exporter cannot log in to the PowerStore.",
    );
    expect(exporterProbes(run)).toEqual([]);
    expect(run.output).toContain(
      "ROOT CAUSE: the array settings in .env are incomplete or invalid.",
    );
  });

  test("a profile without powerstore never starts the exporter", () => {
    const run = doctor(
      { ...POWERSTORE_ENV, COMPOSE_PROFILES: "" },
      { body: CLUSTER },
    );
    expect(arrayCheckLines(run.output)).toContain(
      "✗ COMPOSE_PROFILES='' does not include 'powerstore' — the exporter this config scrapes never starts.",
    );
  });

  test("a PowerStore config stamped as a FlashArray is flagged", () => {
    const run = doctor(
      { ...POWERSTORE_ENV, STORAGE_SYSTEM: "purestorage.flasharray" },
      { body: CLUSTER },
    );
    expect(run.output).toContain(
      `STORAGE_SYSTEM='purestorage.flasharray' but ${CONFIG} reads a PowerStore (dell.powerstore).`,
    );
  });
});

/* ======================================================== the real containers */

describe("the real containers' run", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "storage-array-agent-powerstore-behaviour.sh"),
    "utf8",
  );

  test("storage-array-agent-powerstore-behaviour.sh runs in the Ops workflow, on the node image the workflow warms", () => {
    const workflow = fs.readFileSync(
      path.join(REPO_ROOT, ".github", "workflows", "test.ops.yaml"),
      "utf8",
    );
    const run = workflow.indexOf(
      "- run: bash Tests/Ops/storage-array-agent-powerstore-behaviour.sh",
    );
    const nodeImage = /^NODE_IMAGE="([^"]+)"$/m.exec(script)[1];
    const warm = workflow.indexOf(`warm_base_images.sh --image ${nodeImage}`);
    expect(run).toBeGreaterThan(-1);
    expect(warm).toBeGreaterThan(-1);
    expect(warm).toBeLessThan(run);
  });

  test("it runs the shipped files, changing only how often the collector scrapes", () => {
    for (const file of [
      "docker-compose.yml",
      CONFIG,
      DOCKERFILE,
      SYSLOG_CONFIG,
    ]) {
      expect(script).toContain(file);
    }
    expect(script).toContain("scrape_interval");
  });

  test("it passes bash -n", () => {
    const result = spawnSync(
      "bash",
      [
        "-n",
        path.join(__dirname, "storage-array-agent-powerstore-behaviour.sh"),
      ],
      { encoding: "utf8" },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
