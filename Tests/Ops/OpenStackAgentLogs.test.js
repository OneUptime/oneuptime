"use strict";

/**
 * The OpenStack agent's optional logs profile: what runs on a controller or a compute node.
 *
 * Its install script runs for real in a scratch directory, with `docker`, `curl`,
 * `journalctl`, `systemctl` and `id` replaced by recording stubs. What it must never get
 * wrong:
 *  - it only ever reads: a compose service with every capability gone but the one that reads
 *    a file, and a throwaway system user in the one group that reads the journal;
 *  - a stack trace is one record, and two workers' lines are never joined;
 *  - a re-run is the upgrade and asks nothing;
 *  - the key is in a file only root reads, on no command line and in no program's environment.
 *
 * The real collector checks these configs in validate-collector-configs.sh, and reads a real
 * journal and real files on a real DevStack in openstack-e2e/logs-record.sh. What the expressions
 * mean is pinned here, because a collector that starts can still join the wrong lines.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");
const { agentFilesCurlStub } = require("./Utils/AgentFilesCurlStub");
const { loadInstallScriptsCatalog } = require("./Utils/InstallScriptsCatalog");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "OpenStackAgent");
const SCRIPT = path.join(AGENT_DIR, "install-logs.sh");
const INSTALL_NAME = "openstack-agent";

const COLLECTOR_RELEASES =
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download";
const URL = "https://oneuptime.example.com";
const KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";

const read = (file) => {
  return fs.readFileSync(path.join(AGENT_DIR, file), "utf8");
};

const filesConfig = yaml.load(read("otel-collector-logs-files.yaml"));
const journalConfig = yaml.load(read("otel-collector-logs-journald.yaml"));
const compose = yaml.load(read("docker-compose.logs.yml"));
const unit = read("systemd/oneuptime-openstack-logs-native.service");

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openstack-logs-"));
  scratchDirs.push(dir);
  return dir;
}

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

// `$STUB_DIR/journal-answer` is what journalctl finds; a release archive is a real one.
function installStubs(dir, { withDocker = true } = {}) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  if (withDocker) {
    writeExecutable(
      path.join(bin, "docker"),
      `#!/usr/bin/env bash
printf '%s | %s\\n' "$PWD" "$*" >> "$STUB_DIR/docker.log"
case "$*" in
  "compose -f docker-compose.logs.yml up"*) env | sort > "$STUB_DIR/env-at-up.txt" ;;
esac
exit 0
`,
    );
  }
  writeExecutable(
    path.join(bin, "curl"),
    agentFilesCurlStub({
      installName: INSTALL_NAME,
      agentDirectory: "OpenStackAgent",
      servedDir: AGENT_DIR,
      extraCases: `case "$url" in
  ${COLLECTOR_RELEASES}/*)
    [ -f "$STUB_DIR/release.tar.gz" ] || exit 22
    cp "$STUB_DIR/release.tar.gz" "$out"
    exit 0
    ;;
esac`,
    }),
  );
  writeExecutable(
    path.join(bin, "uname"),
    `#!/usr/bin/env bash\ncase "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac\n`,
  );
  writeExecutable(
    path.join(bin, "journalctl"),
    `#!/usr/bin/env bash\ncat "$STUB_DIR/journal-answer" 2>/dev/null\nexit 0\n`,
  );
  writeExecutable(
    path.join(bin, "systemctl"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/systemctl.log"\nenv | sort > "$STUB_DIR/env-at-systemctl.txt"\n`,
  );
  writeExecutable(
    path.join(bin, "id"),
    `#!/usr/bin/env bash\necho "\${FAKE_UID:-0}"\n`,
  );
  return bin;
}

function install(
  dir,
  { env = {}, input = "", args = [], stubs = {}, script = SCRIPT } = {},
) {
  const bin = fs.existsSync(path.join(dir, "bin"))
    ? path.join(dir, "bin")
    : installStubs(dir, stubs);
  const installDir = path.join(dir, "logs");
  const result = spawnSync("bash", [script, ...args], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: dir,
      STUB_DIR: dir,
      INSTALL_DIR: installDir,
      SYSTEMD_UNIT_DIR: path.join(dir, "units"),
      ...env,
    },
    input,
    encoding: "utf8",
    timeout: 120000,
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    installDir,
    envFile: readIfExists(path.join(installDir, ".env")),
    docker: readIfExists(path.join(dir, "docker.log")),
    systemctl: readIfExists(path.join(dir, "systemctl.log")),
  };
}

const ANSWERS = {
  ONEUPTIME_URL: URL,
  ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
  OPENSTACK_CLOUD_NAME: "production",
  OPENSTACK_NODE_NAME: "compute-01",
};

describe("the files profile, which reads Kolla-Ansible's", () => {
  const receiver = filesConfig.receivers.filelog;
  const service = compose.services["oneuptime-openstack-logs"];

  test("reads OpenStack's services by name, and nothing else in the folder", () => {
    expect(receiver.include).toContain("/var/log/kolla/nova/*.log");
    expect(receiver.include).toContain("/var/log/kolla/neutron/*.log");
    expect(receiver.include).toContain("/var/log/kolla/keystone/*.log");

    for (const notOpenStack of ["rabbitmq", "mariadb", "haproxy", "libvirt"]) {
      expect(receiver.include.join("\n")).not.toContain(notOpenStack);
    }

    // A web server's own logs are not oslo.log's.
    expect(receiver.exclude).toContain("/var/log/kolla/*/*access*.log");
    expect(receiver.storage).toBe("file_storage");
  });

  test("can read a file and do nothing else", () => {
    expect(service.read_only).toBe(true);
    expect(service.cap_drop).toEqual(["ALL"]);
    expect(service.cap_add).toEqual(["DAC_READ_SEARCH"]);
    expect(service.security_opt).toContain("no-new-privileges:true");

    const logs = service.volumes.find((volume) => {
      return volume.includes(":/var/log/kolla");
    });

    expect(logs.endsWith(":ro")).toBe(true);
    expect(logs).toContain("kolla_logs");
  });

  test("a collector with no cloud name in it never reaches OneUptime as a Service", () => {
    const attributes = filesConfig.processors.resource.attributes;
    const deleted = attributes
      .filter((attribute) => {
        return attribute.action === "delete";
      })
      .map((attribute) => {
        return attribute.key;
      });

    expect(deleted).toEqual(
      expect.arrayContaining(["service.name", "service.instance.id"]),
    );
    expect(
      attributes.find((attribute) => {
        return attribute.key === "openstack.cloud.name";
      }).value,
    ).toBe("${env:OPENSTACK_CLOUD_NAME}");
  });

  test("keeps its place across a restart, and sends what is new", () => {
    expect(receiver.start_at).toBe("end");
    expect(service.volumes).toContain(
      "oneuptime-openstack-logs-state:/var/lib/otelcol/file_storage",
    );
    expect(filesConfig.service.extensions).toContain("file_storage");
  });
});

/*
 * What the recombine's expression says of a line, read as the collector reads it. The pattern
 * has nothing RE2 and JavaScript read differently: no lookaround, no backreference.
 */
function firstEntryOf(config) {
  const operators = config.receivers.filelog
    ? config.receivers.filelog.operators
    : config.receivers.journald.operators;
  const recombine = operators.find((operator) => {
    return operator.type === "recombine";
  });
  const matches = Array.from(
    recombine.is_first_entry.matchAll(/body matches "((?:[^"\\]|\\.)*)"/g),
  ).map((match) => {
    // The expression's own string, one level of escaping down.
    return new RegExp(match[1].replace(/\\\\/g, "\\"));
  });

  expect(matches).toHaveLength(3);

  // not ((A and not B) or C)
  return (body) => {
    return !(
      (matches[0].test(body) && !matches[1].test(body)) ||
      matches[2].test(body)
    );
  };
}

describe.each([
  ["files", filesConfig],
  ["journal", journalConfig],
])("a stack trace is one record, in the %s profile", (_name, config) => {
  const isFirstEntry = firstEntryOf(config);

  test.each([
    // Hand-written, from oslo.log's format: the rig records the real ones.
    "2026-10-30 10:00:00.123 1234 INFO nova.compute.manager [req-g req-r 1a2b 3c4d - - default default] Started",
    "2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [req-g req-r 1a2b 3c4d - - default default] [instance: 1cd8b1e6-41ab-4e40-a4c6-b8b1a7d1f9f0] Failed to build",
    "2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [-] Failed",
    "ERROR nova.compute.manager [None req-r demo admin] [instance: 1cd8b1e6-41ab-4e40-a4c6-b8b1a7d1f9f0] Failed",
    "\u001b[01;31mERROR nova.compute.manager [\u001b[01;36mNone req-r \u001b[00;36mdemo admin\u001b[01;31m] \u001b[01;35mFailed\u001b[00m",
    "2026-10-30 10:00:00.123 1234 WARNING oslo.messaging._drivers.impl_rabbit [-] Connection lost",
    "A sentence a service printed on its own",
  ])("starts a record: %s", (line) => {
    expect(isFirstEntry(line)).toBe(true);
  });

  test.each([
    "2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [instance: 1cd8b1e6-41ab-4e40-a4c6-b8b1a7d1f9f0] Traceback (most recent call last):",
    '2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager   File "/opt/stack/nova/nova/compute/manager.py", line 2437, in _build',
    "2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager nova.exception.PortBindingFailed: Binding failed",
    "2026-10-30 10:00:00.123 1234 TRACE nova.compute.manager Traceback (most recent call last):",
    "ERROR nova.compute.manager   File \"/opt/stack/nova/nova/compute/manager.py\", line 2437, in _build",
    "Traceback (most recent call last):",
    '  File "/opt/stack/nova/nova/compute/manager.py", line 2437, in _build',
    "ValueError: nothing to see",
    "oslo_messaging.exceptions.MessagingTimeout: Timed out",
  ])("joins the one before: %s", (line) => {
    expect(isFirstEntry(line)).toBe(false);
  });

  test("is quick on a long line of the shape it looks for", () => {
    const long = `2026-10-30 10:00:00.123 1234 ERROR ${"nova.".repeat(20000)}`;
    const startedAt = Date.now();

    isFirstEntry(long);

    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});

describe("the files profile keeps two workers apart", () => {
  const operators = filesConfig.receivers.filelog.operators;
  const recombine = operators.find((operator) => {
    return operator.type === "recombine";
  });

  test("joins only within one process of one file", () => {
    expect(recombine.source_identifier).toBe(
      'attributes["openstack.log.stream"]',
    );

    const stream = operators.filter((operator) => {
      return (
        operator.type === "add" &&
        operator.field === 'attributes["openstack.log.stream"]'
      );
    });

    expect(stream).toHaveLength(2);
    expect(stream[0].value).toContain('attributes["process.pid"]');
    expect(stream[0].value).toContain('attributes["log.file.path"]');
  });

  test("reads the time and process off the front of a line, in the zone it was written in", () => {
    const parser = operators.find((operator) => {
      return operator.type === "regex_parser";
    });
    const pattern = new RegExp(
      parser.regex.replace("(?P<oslo_time>", "(?<oslo_time>").replace(
        "(?P<oslo_pid>",
        "(?<oslo_pid>",
      ),
    );
    const match = pattern.exec(
      "2026-10-30 10:00:00.123 1234 INFO nova.compute.manager [-] Started",
    );

    expect(match.groups.oslo_time).toBe("2026-10-30 10:00:00.123");
    expect(match.groups.oslo_pid).toBe("1234");
    expect(parser.timestamp.location).toBe("${env:OPENSTACK_LOGS_TIMEZONE}");
    expect(parser.on_error).toBe("send_quiet");
  });

  test("the temporary stream name does not reach OneUptime", () => {
    const removed = operators.filter((operator) => {
      return (
        operator.type === "remove" &&
        operator.field === 'attributes["openstack.log.stream"]'
      );
    });

    expect(removed).toHaveLength(1);
  });
});

describe("the journal profile, which reads OpenStack-Ansible's and DevStack's", () => {
  const receiver = journalConfig.receivers.journald;

  test("reads the units it is told to and takes a line's words as a string", () => {
    expect(receiver.units).toBe("${env:OPENSTACK_LOGS_UNITS}");
    // DevStack's colours make journalctl write a line as a list of bytes.
    expect(receiver.convert_message_bytes).toBe(true);
    // OpenStack-Ansible passes its containers' journals through.
    expect(receiver.merge).toBe(true);
    expect(receiver.storage).toBe("file_storage");
  });

  test.each([
    "nova-*",
    "neutron-*",
    "cinder-*",
    "glance-*",
    "keystone*",
    "devstack@*",
  ])("its default units name %s", (pattern) => {
    expect(unit).toContain(pattern);
  });

  test("runs unprivileged, in the group that reads the journal, and writes only its place", () => {
    expect(unit).toContain("DynamicUser=yes");
    expect(unit).toContain("SupplementaryGroups=systemd-journal");
    expect(unit).toContain("CapabilityBoundingSet=\n");
    expect(unit).toContain("NoNewPrivileges=yes");
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain("StateDirectory=oneuptime-openstack-logs");
  });

  test("its metrics port cannot collide with the agent's collector", () => {
    expect(unit).toContain("port: 8892");
    expect(read("systemd/oneuptime-openstack-agent-native.service")).not.toContain(
      "port: 8892",
    );
  });

  test("hands over every field oslo.log's own journal handler writes", () => {
    const moved = receiver.operators
      .filter((operator) => {
        return operator.type === "move";
      })
      .map((operator) => {
        return operator.to;
      });

    for (const field of [
      "journald.unit",
      "journald.hostname",
      "journald.logger_name",
      "journald.logger_level",
      "journald.request_id",
      "journald.global_request_id",
      "journald.project_id",
      "journald.project_name",
      "journald.user_id",
      "journald.user_name",
      "journald.exception_info",
    ]) {
      expect(moved).toContain(`attributes["${field}"]`);
    }
  });

  test("never reaches OneUptime as a Service", () => {
    const deleted = journalConfig.processors.resource.attributes
      .filter((attribute) => {
        return attribute.action === "delete";
      })
      .map((attribute) => {
        return attribute.key;
      });

    expect(deleted).toEqual(
      expect.arrayContaining(["service.name", "service.instance.id"]),
    );
  });
});

describe("both profiles send the same record", () => {
  test.each([
    ["files", filesConfig],
    ["journal", journalConfig],
  ])("%s names its cloud and machine", (_name, config) => {
    const keys = config.processors.resource.attributes.map((attribute) => {
      return attribute.key;
    });

    expect(keys).toEqual(
      expect.arrayContaining([
        "openstack.cloud.name",
        "openstack.node.name",
        "oneuptime.agent.version",
      ]),
    );
    expect(config.service.pipelines.logs.processors[0]).toBe("memory_limiter");
    expect(config.service.pipelines.logs.exporters).toEqual(["otlphttp"]);
  });
});

describe("the collector the journal's service downloads", () => {
  const sums = (text) => {
    return {
      version: /^COLLECTOR_VERSION="([^"]+)"/m.exec(text)[1],
      amd64: /^COLLECTOR_SHA256_AMD64="([0-9a-f]{64})"/m.exec(text)[1],
      arm64: /^COLLECTOR_SHA256_ARM64="([0-9a-f]{64})"/m.exec(text)[1],
    };
  };

  test("is the release install.sh pins, with the same sums", () => {
    const installer = read("install.sh");
    const logs = read("install-logs.sh");

    expect(sums(logs)).toEqual(sums(installer));
  });

  test("is the version the compose file runs and the configs report", () => {
    const { version } = sums(read("install-logs.sh"));

    expect(compose.services["oneuptime-openstack-logs"].image).toBe(
      `otel/opentelemetry-collector-contrib:${version}`,
    );
    for (const config of [filesConfig, journalConfig]) {
      expect(
        config.processors.resource.attributes.find((attribute) => {
          return attribute.key === "oneuptime.agent.version";
        }).value,
      ).toBe(version);
    }
  });
});

describe("the installer is served with the agent's other files", () => {
  test("every file it downloads is in the catalog", () => {
    const entry = loadInstallScriptsCatalog().INSTALL_SCRIPTS.find((script) => {
      return script.name === INSTALL_NAME;
    });
    const fetched = Array.from(
      read("install-logs.sh").matchAll(/download_agent_file "([^"]+)"/g),
    ).map((match) => {
      return match[1];
    });

    expect(fetched.filter((file) => !file.startsWith("$"))).toEqual(
      expect.arrayContaining([
        "docker-compose.logs.yml",
        "otel-collector-logs-files.yaml",
        "otel-collector-logs-journald.yaml",
        "systemd/oneuptime-openstack-logs-native.service",
      ]),
    );

    for (const file of fetched) {
      if (!file.startsWith("$")) {
        expect(entry.files).toContain(file);
      }
    }

    expect(entry.files).toContain("install-logs.sh");
  });
});

describe("installing the files profile", () => {
  test("writes every answer, starts it, and shows the key to nobody", () => {
    const dir = scratch();
    const result = install(dir, { env: ANSWERS, args: ["files"] });

    expect(result.status).toBe(0);
    expect(result.output).not.toContain(KEY);
    expect(result.envFile).toContain(`ONEUPTIME_URL='${URL}'`);
    expect(result.envFile).toContain(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY='${KEY}'`,
    );
    expect(result.envFile).toContain("OPENSTACK_CLOUD_NAME='production'");
    expect(result.envFile).toContain("OPENSTACK_NODE_NAME='compute-01'");
    expect(result.envFile).toContain("OPENSTACK_LOGS_TIMEZONE='UTC'");
    expect(
      fs.statSync(path.join(result.installDir, ".env")).mode & 0o777,
    ).toBe(0o600);
    expect(
      fs.existsSync(path.join(result.installDir, "otel-collector-logs-files.yaml")),
    ).toBe(true);
    expect(result.docker).toContain("compose -f docker-compose.logs.yml up -d");

    // Compose reads .env alone, so every start runs what every later one will.
    const atUp = readIfExists(path.join(dir, "env-at-up.txt"));
    expect(atUp).not.toContain(KEY);
  });

  test("a value the shell or Compose would mangle reaches them as typed", () => {
    const dir = scratch();
    const result = install(dir, {
      env: { ...ANSWERS, OPENSTACK_CLOUD_NAME: "it's $HOME \\ cloud" },
      args: ["files"],
    });

    expect(result.status).toBe(0);
    expect(result.envFile).toContain(
      'OPENSTACK_CLOUD_NAME="it\'s $$HOME \\\\ cloud"',
    );
  });

  test("a re-run is the upgrade: it asks nothing, and keeps every answer", () => {
    const dir = scratch();

    install(dir, { env: ANSWERS, args: ["files"] });

    const again = install(dir);

    expect(again.status).toBe(0);
    expect(again.output).toContain("reusing it");
    expect(again.envFile).toContain(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY='${KEY}'`,
    );
    expect(again.envFile).toContain("OPENSTACK_NODE_NAME='compute-01'");
    expect(again.docker.match(/ up -d/g)).toHaveLength(2);
  });

  test("a file someone edited is kept beside the new one, and named", () => {
    const dir = scratch();
    const first = install(dir, { env: ANSWERS, args: ["files"] });

    fs.appendFileSync(
      path.join(first.installDir, "otel-collector-logs-files.yaml"),
      "# edited\n",
    );

    const again = install(dir);

    expect(again.status).toBe(0);
    expect(again.output).toContain("otel-collector-logs-files.yaml.bak.");
  });

  test("says what is missing rather than half installing", () => {
    const dir = scratch();
    const result = install(dir, {
      env: { ...ANSWERS, PATH: "" },
      args: ["files"],
      stubs: { withDocker: false },
    });

    expect(result.status).not.toBe(0);
  });

  test("refuses an argument it does not know", () => {
    const dir = scratch();
    const result = install(dir, { env: ANSWERS, args: ["kolla"] });

    expect(result.status).toBe(2);
    expect(result.output).toContain("Usage:");
  });
});

describe("choosing the profile", () => {
  test("asks when it cannot tell, and takes the answer", () => {
    const dir = scratch();
    const result = install(dir, {
      env: ANSWERS,
      input: "neither\nfiles\n",
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain("How does this machine's OpenStack log?");
    expect(result.docker).toContain("docker-compose.logs.yml");
  });

  test("finds OpenStack's units in the journal", () => {
    const dir = scratch();

    fs.writeFileSync(path.join(dir, "journal-answer"), "a line\n");

    const result = install(dir, {
      env: { ...ANSWERS, FAKE_UID: "1000" },
    });

    // It found the journal, then says it needs root, without having downloaded anything.
    expect(result.output).toContain("Found OpenStack's services");
    expect(result.status).toBe(1);
    expect(result.output).toContain("needs root");
    expect(result.systemctl).toBe("");
  });

  test("reads an answer from the environment, for a run across a fleet", () => {
    const dir = scratch();
    const result = install(dir, {
      env: { ...ANSWERS, OPENSTACK_LOGS_PROFILE: "FILES" },
    });

    expect(result.status).toBe(0);
    expect(result.docker).toContain("docker-compose.logs.yml");
  });
});

/*
 * A collector release that is only a file, and this script with its sum pinned, so that what
 * is checked is the installing and not the download: the real sum is held to install.sh's.
 */
function withRelease(dir) {
  const content = path.join(dir, "release");

  // What /etc/systemd/system stands for here.
  fs.mkdirSync(path.join(dir, "units"));
  fs.mkdirSync(content);
  fs.writeFileSync(path.join(content, "otelcol-contrib"), "#!/bin/sh\n");
  spawnSync("tar", ["-czf", path.join(dir, "release.tar.gz"), "-C", content, "otelcol-contrib"]);

  const sum = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(dir, "release.tar.gz")))
    .digest("hex");
  const script = path.join(dir, "install-logs.sh");

  fs.writeFileSync(
    script,
    fs
      .readFileSync(SCRIPT, "utf8")
      .replace(/^COLLECTOR_SHA256_AMD64=.*$/m, `COLLECTOR_SHA256_AMD64="${sum}"`),
  );

  return script;
}

describe("installing the journal profile", () => {
  test("is a systemd service, whose key only root reads and no program is handed", () => {
    const dir = scratch();
    const script = withRelease(dir);
    const result = install(dir, {
      env: ANSWERS,
      args: ["journald"],
      script,
    });

    expect(result.status).toBe(0);
    expect(result.output).not.toContain(KEY);
    expect(result.envFile).toContain(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY="${KEY}"`,
    );
    expect(
      fs.statSync(path.join(result.installDir, ".env")).mode & 0o777,
    ).toBe(0o600);
    expect(result.systemctl).toContain("daemon-reload");
    expect(result.systemctl).toContain("enable oneuptime-openstack-logs");
    expect(result.systemctl).toContain("restart oneuptime-openstack-logs");
    expect(readIfExists(path.join(dir, "env-at-systemctl.txt"))).not.toContain(
      KEY,
    );
    expect(
      fs.existsSync(path.join(result.installDir, "otelcol-contrib")),
    ).toBe(true);
    expect(
      fs.statSync(path.join(result.installDir, "otelcol-contrib")).mode & 0o111,
    ).not.toBe(0);
  });

  test("a folder of someone's choosing goes into the installed unit", () => {
    const dir = scratch();
    const script = withRelease(dir);
    const result = install(dir, { env: ANSWERS, args: ["journald"], script });
    const installed = readIfExists(
      path.join(dir, "units", "oneuptime-openstack-logs.service"),
    );

    expect(result.status).toBe(0);
    expect(installed).toContain(`EnvironmentFile=${result.installDir}/.env`);
    expect(installed).not.toContain("/opt/oneuptime-openstack-logs");
  });

  test("a units list someone set is kept, and otherwise the unit's default stands", () => {
    const dir = scratch();
    const script = withRelease(dir);
    const plain = install(dir, { env: ANSWERS, args: ["journald"], script });

    expect(plain.envFile).not.toContain("OPENSTACK_LOGS_UNITS");

    const set = install(dir, {
      env: { OPENSTACK_LOGS_UNITS: "[nova-*]" },
      args: ["journald"],
      script,
    });

    expect(set.envFile).toContain('OPENSTACK_LOGS_UNITS="[nova-*]"');
  });

  test("an archive that is not the pinned one is not installed", () => {
    const dir = scratch();

    withRelease(dir);

    // The script as shipped, with its real sum, against an archive that does not match it.
    const result = install(dir, { env: ANSWERS, args: ["journald"] });

    expect(result.status).toBe(1);
    expect(result.output).toContain("does not match the sha256");
    expect(result.systemctl).toBe("");
    expect(
      fs.existsSync(path.join(result.installDir, "otelcol-contrib")),
    ).toBe(false);
  });

  test("a re-run finds the journal again, without being told", () => {
    const dir = scratch();
    const script = withRelease(dir);

    install(dir, { env: ANSWERS, args: ["journald"], script });

    const again = install(dir, { script });

    expect(again.status).toBe(0);
    expect(again.systemctl.match(/restart/g)).toHaveLength(2);
    expect(again.envFile).toContain(`ONEUPTIME_TELEMETRY_INGESTION_KEY="${KEY}"`);
  });

  test("refuses without root, naming the command", () => {
    const dir = scratch();
    const result = install(dir, {
      env: { ...ANSWERS, FAKE_UID: "1000" },
      args: ["journald"],
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain("sudo bash install-logs.sh journald");
  });
});
