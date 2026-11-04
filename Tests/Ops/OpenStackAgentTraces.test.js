"use strict";

/**
 * The OpenStack agent's optional traces profile: what it listens on, what it takes out, and
 * install-traces.sh run for real in a scratch directory with `docker`, `curl`, `id`, `uname`
 * and `systemctl` replaced by recording stubs.
 *
 * What it must never get wrong:
 *  - it listens on the machine's loopback alone, whatever way it runs, because OSProfiler's
 *    driver posts plain HTTP and what it posts is not for the network;
 *  - what a traced call was handed never leaves the machine;
 *  - it keeps the driver's service.name, because that is the one thing that says which
 *    service a span is from, where the logs profile deletes its own;
 *  - it stamps the cloud the driver never says, because nothing else joins a span to a cloud;
 *  - it never touches OpenStack's own config;
 *  - the ingestion key is in no program's environment or arguments;
 *  - a re-run is the upgrade, and keeps every answer.
 *
 * Tests/Ops/validate-collector-configs.sh runs the real collector over the config, and
 * Tests/Ops/openstack-e2e/traces-record.sh runs it on a real cloud.
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
const SCRIPT = path.join(AGENT_DIR, "install-traces.sh");
const COLLECTOR_RELEASES =
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download";

const URL = "https://oneuptime.example.com";
const KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";

function agentFile(name) {
  return fs.readFileSync(path.join(AGENT_DIR, name), "utf8");
}

const CONFIG = yaml.load(agentFile("otel-collector-traces.yaml"));
const COMPOSE = yaml.load(agentFile("docker-compose.traces.yml"));
const COLLECTOR = COMPOSE.services["oneuptime-openstack-traces"];
const UNIT = agentFile("systemd/oneuptime-openstack-traces-native.service");
const PIPELINE = CONFIG.service.pipelines.traces;

describe("the collector's config", () => {
  test("it takes OTLP over HTTP and nothing else, at the address it is given", () => {
    expect(CONFIG.receivers.otlp.protocols).toEqual({
      http: { endpoint: "${env:OPENSTACK_TRACES_LISTEN_ADDRESS}" },
    });
    expect(PIPELINE.receivers).toEqual(["otlp"]);
    expect(Object.keys(CONFIG.service.pipelines)).toEqual(["traces"]);
  });

  test("what a traced call was handed is deleted, and these are what OneUptime deletes too", () => {
    const actions = CONFIG.processors["attributes/what-a-call-was-handed"].actions;

    for (const action of actions) {
      expect(action.action).toBe("delete");
    }

    const deleted = actions
      .map((action) => {
        return action.key;
      })
      .sort();

    expect(deleted).toEqual(["args", "db.params", "kwargs", "result"]);

    const source = fs.readFileSync(
      path.join(REPO_ROOT, "packages/Common/Utils/OpenStack/OpenStackTraces.ts"),
      "utf8",
    );
    const list = source.match(
      /OSPROFILER_ATTRIBUTES_NEVER_STORED: ReadonlyArray<string> = \[([^\]]*)\]/,
    );

    expect(list).not.toBeNull();
    expect(
      list[1]
        .split(",")
        .map((word) => {
          return word.trim().replace(/"/g, "");
        })
        .filter(Boolean)
        .sort(),
    ).toEqual(deleted);
  });

  test("the deletes run before anything could batch or send them", () => {
    const processors = PIPELINE.processors;

    expect(processors[0]).toBe("memory_limiter");
    expect(processors.indexOf("attributes/what-a-call-was-handed")).toBeLessThan(
      processors.indexOf("batch"),
    );
    expect(processors[processors.length - 1]).toBe("batch");
  });

  test("it says which cloud, region and machine, which the driver never does", () => {
    const stamped = {};

    for (const attribute of CONFIG.processors.resource.attributes) {
      stamped[attribute.key] = attribute;
      expect(attribute.action).toBe("upsert");
    }

    expect(stamped["openstack.cloud.name"].value).toBe(
      "${env:OPENSTACK_CLOUD_NAME}",
    );
    expect(stamped["openstack.region.name"].value).toBe(
      "${env:OPENSTACK_REGION_NAME}",
    );
    expect(stamped["openstack.node.name"].value).toBe(
      "${env:OPENSTACK_NODE_NAME}",
    );
    expect(PIPELINE.processors).toContain("resource");
  });

  test("it keeps service.name: the logs profile deletes its own, and these need it", () => {
    for (const attribute of CONFIG.processors.resource.attributes) {
      expect(attribute.key).not.toBe("service.name");
    }
  });

  test("it sends to the OneUptime it was given, with the key in a header", () => {
    expect(PIPELINE.exporters).toEqual(["otlphttp"]);
    expect(CONFIG.exporters.otlphttp.endpoint).toBe("${env:ONEUPTIME_URL}/otlp");
    expect(CONFIG.exporters.otlphttp.headers["x-oneuptime-token"]).toBe(
      "${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}",
    );
  });

  test("the OTLP address is not a default anyone could widen by accident", () => {
    expect(agentFile("otel-collector-traces.yaml")).not.toContain("0.0.0.0");
  });
});

describe("with Docker", () => {
  test("it publishes on the machine's loopback, unless someone names another address", () => {
    expect(COLLECTOR.ports).toEqual([
      "${OPENSTACK_TRACES_PUBLISH_ADDRESS:-127.0.0.1}:4318:4318",
    ]);
    expect(COLLECTOR.network_mode).toBeUndefined();
  });

  test("inside the container it listens on every address, which only the ports above reach", () => {
    expect(COLLECTOR.environment).toContain(
      "OPENSTACK_TRACES_LISTEN_ADDRESS=0.0.0.0:4318",
    );
  });

  test("it can do nothing but take spans and send them", () => {
    expect(COLLECTOR.read_only).toBe(true);
    expect(COLLECTOR.cap_drop).toEqual(["ALL"]);
    expect(COLLECTOR.cap_add).toBeUndefined();
    expect(COLLECTOR.security_opt).toEqual(["no-new-privileges:true"]);
    expect(COLLECTOR.user).toBeUndefined();
  });

  test("it runs the collector the rest of the agent pins", () => {
    const agent = yaml.load(agentFile("docker-compose.yml"));

    expect(COLLECTOR.image).toBe(
      agent.services["oneuptime-openstack-agent"].image,
    );
  });

  test("it mounts its config and nothing else", () => {
    expect(COLLECTOR.volumes).toEqual([
      "./otel-collector-traces.yaml:/etc/otelcol-contrib/config.yaml:ro",
    ]);
  });

  test("every variable the config reads is given", () => {
    const given = COLLECTOR.environment.map((line) => {
      return line.split("=")[0];
    });

    for (const name of agentFile("otel-collector-traces.yaml").match(
      /\$\{env:([A-Z_]+)\}/g,
    )) {
      expect(given).toContain(name.slice("${env:".length, -1));
    }
  });
});

describe("without Docker", () => {
  test("it listens on the machine's loopback by default", () => {
    expect(UNIT).toContain(
      "Environment=OPENSTACK_TRACES_LISTEN_ADDRESS=127.0.0.1:4318",
    );
  });

  test("its own metrics are on a port no other collector on the machine takes", () => {
    expect(UNIT).toContain("port: 8893");
    expect(
      agentFile("systemd/oneuptime-openstack-agent-native.service"),
    ).toContain("port: 8891");
    expect(
      agentFile("systemd/oneuptime-openstack-logs-native.service"),
    ).toContain("port: 8892");
  });

  test("it runs as a throwaway user that can write nothing", () => {
    expect(UNIT).toContain("DynamicUser=yes");
    expect(UNIT).toContain("ProtectSystem=strict");
    expect(UNIT).toContain("NoNewPrivileges=yes");
    expect(UNIT).not.toContain("StateDirectory");
    expect(UNIT).not.toContain("SupplementaryGroups");
  });

  test("the default region and cloud are what the config needs, and .env can change them", () => {
    expect(UNIT).toContain("Environment=OPENSTACK_CLOUD_NAME=openstack");
    expect(UNIT).toContain("Environment=OPENSTACK_REGION_NAME=RegionOne");
    expect(UNIT).toContain(
      "EnvironmentFile=/opt/oneuptime-openstack-traces/.env",
    );
  });
});

describe("what every OneUptime serves", () => {
  test("the script and each file it downloads, for its own release", () => {
    const { INSTALL_SCRIPTS } = loadInstallScriptsCatalog();
    const entry = INSTALL_SCRIPTS.find((script) => {
      return script.name === "openstack-agent";
    });

    for (const file of [
      "install-traces.sh",
      "docker-compose.traces.yml",
      "otel-collector-traces.yaml",
      "systemd/oneuptime-openstack-traces-native.service",
    ]) {
      expect(entry.files).toContain(file);
      expect(fs.existsSync(path.join(AGENT_DIR, file))).toBe(true);
    }
  });
});

describe("the script's pins", () => {
  const script = fs.readFileSync(SCRIPT, "utf8");

  function pin(text, name) {
    const found = text.match(new RegExp(`^${name}="([^"]+)"`, "m"));

    expect(found).not.toBeNull();

    return found[1];
  }

  test("the same collector release and checksums as the agent's own installer", () => {
    const installer = agentFile("install.sh");

    for (const name of [
      "COLLECTOR_VERSION",
      "COLLECTOR_SHA256_AMD64",
      "COLLECTOR_SHA256_ARM64",
    ]) {
      expect(pin(script, name)).toBe(pin(installer, name));
    }
  });

  test("the release is the one the compose file pins, and the config stamps", () => {
    const version = pin(script, "COLLECTOR_VERSION");

    expect(COLLECTOR.image.split(":")[1]).toBe(version);

    const stamped = CONFIG.processors.resource.attributes.find((attribute) => {
      return attribute.key === "oneuptime.agent.version";
    });

    expect(stamped.value).toBe(version);
  });

  test("it never edits OpenStack's config, and only says what to set", () => {
    expect(script).not.toMatch(/\/etc\/(nova|neutron|cinder|glance|keystone|placement)/);
    expect(script).not.toMatch(/crudini|iniset|sed -i/);
    expect(script).toContain("hmac_keys = <your key>");
  });

  test("it never asks for the HMAC key, which is not this collector's to hold", () => {
    expect(script).not.toMatch(/read[^\n]*(HMAC|hmac|OS_PROFILE)/);
    expect(script).not.toContain("OSPROFILER");
    expect(script).not.toContain("OS_PROFILE");
  });
});

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function setup({
  uid = "1000",
  kernel = "Linux",
  arch = "x86_64",
  hasDocker = true,
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openstack-traces-"));
  scratchDirs.push(dir);
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const units = path.join(dir, "units");
  fs.mkdirSync(units);
  const releases = path.join(dir, "releases");
  fs.mkdirSync(releases);

  const version = COLLECTOR.image.split(":")[1];
  const archive = `otelcol-contrib_${version}_linux_amd64.tar.gz`;
  const work = path.join(dir, "work");
  fs.mkdirSync(work);
  writeExecutable(
    path.join(work, "otelcol-contrib"),
    '#!/bin/sh\necho "fake collector"\n',
  );
  expect(
    spawnSync("tar", [
      "-czf",
      path.join(releases, archive),
      "-C",
      work,
      "otelcol-contrib",
    ]).status,
  ).toBe(0);

  writeExecutable(
    path.join(bin, "id"),
    `#!/usr/bin/env bash\necho "${uid}"\n`,
  );
  writeExecutable(
    path.join(bin, "uname"),
    `#!/usr/bin/env bash
case "$1" in
  -s) echo "${kernel}" ;;
  -m) echo "${arch}" ;;
esac
`,
  );
  writeExecutable(
    path.join(bin, "hostname"),
    '#!/usr/bin/env bash\necho "compute-01"\n',
  );
  writeExecutable(
    path.join(bin, "systemctl"),
    '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$STUB_DIR/systemctl.log"\n',
  );
  /*
   * `docker` keeps its arguments and the whole environment it ran in, so a test can look
   * for the key in either.
   */
  if (hasDocker) {
    writeExecutable(
      path.join(bin, "docker"),
      `#!/usr/bin/env bash
printf '%s | %s\\n' "$PWD" "$*" >> "$STUB_DIR/docker.log"
env >> "$STUB_DIR/docker-env.log"
case "$*" in
  "compose -f docker-compose.traces.yml pull"*) [ -f "$STUB_DIR/pull.fail" ] && exit 1 ;;
  "compose -f docker-compose.traces.yml up"*) [ -f "$STUB_DIR/up.fail" ] && exit 1 ;;
esac
exit 0
`,
    );
  } else {
    // The PATH below leaves the machine's own docker out of reach of a test without one.
    writeExecutable(
      path.join(bin, "docker"),
      '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$STUB_DIR/docker.log"\nexit 127\n',
    );
  }
  writeExecutable(
    path.join(bin, "curl"),
    agentFilesCurlStub({
      installName: "openstack-agent",
      agentDirectory: "OpenStackAgent",
      servedDir: AGENT_DIR,
      extraCases: `case "$url" in
  ${COLLECTOR_RELEASES}/*)
    src="$RELEASE_DIR/\${url##*/}"
    [ -f "$src" ] || exit 22
    cp "$src" "$out"
    exit 0
    ;;
esac`,
    }),
  );

  // The script with its checksum replaced by that of this machine's fake archive.
  function scriptWithFakePin() {
    const copy = path.join(dir, "install-with-fake-pin.sh");
    fs.writeFileSync(
      copy,
      fs
        .readFileSync(SCRIPT, "utf8")
        .replace(
          /^COLLECTOR_SHA256_AMD64=.*$/m,
          `COLLECTOR_SHA256_AMD64="${sha256(path.join(releases, archive))}"`,
        ),
    );
    return copy;
  }

  const installDir = path.join(dir, "traces");

  return {
    dir,
    installDir,
    unit: path.join(units, "oneuptime-openstack-traces.service"),
    run({ env = {}, input = "", args = [], script = null } = {}) {
      const result = spawnSync("bash", [script || SCRIPT, ...args], {
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: dir,
          STUB_DIR: dir,
          RELEASE_DIR: releases,
          INSTALL_DIR: installDir,
          SYSTEMD_UNIT_DIR: units,
          ...env,
        },
        input,
        encoding: "utf8",
        timeout: 120000,
      });

      return {
        status: result.status,
        output: `${result.stdout}${result.stderr}`,
        envFile: readIfExists(path.join(installDir, ".env")),
      };
    },
    scriptWithFakePin,
    log(name) {
      const text = readIfExists(path.join(dir, `${name}.log`));

      return text ? text.trimEnd().split("\n") : [];
    },
    file(name) {
      return readIfExists(path.join(installDir, name));
    },
  };
}

const ANSWERED = {
  ONEUPTIME_URL: URL,
  ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
  OPENSTACK_CLOUD_NAME: "prod-east",
  OPENSTACK_REGION_NAME: "RegionTwo",
};

describe("install-traces.sh with Docker", () => {
  test("it uses Docker where the machine has it, and starts the collector", () => {
    const machine = setup();
    const run = machine.run({ env: ANSWERED });

    expect(run.status).toBe(0);
    expect(run.output).toContain("Found Docker Compose");
    expect(machine.file("docker-compose.traces.yml")).toBe(
      agentFile("docker-compose.traces.yml"),
    );
    expect(machine.file("otel-collector-traces.yaml")).toBe(
      agentFile("otel-collector-traces.yaml"),
    );

    const docker = machine.log("docker").join("\n");

    expect(docker).toContain("compose -f docker-compose.traces.yml pull");
    expect(docker).toContain(
      "compose -f docker-compose.traces.yml up -d --force-recreate",
    );
  });

  test("its answers go into .env, for it alone", () => {
    const machine = setup();
    const run = machine.run({ env: ANSWERED });

    expect(run.envFile).toContain(`ONEUPTIME_URL='${URL}'`);
    expect(run.envFile).toContain(`ONEUPTIME_TELEMETRY_INGESTION_KEY='${KEY}'`);
    expect(run.envFile).toContain("OPENSTACK_CLOUD_NAME='prod-east'");
    expect(run.envFile).toContain("OPENSTACK_REGION_NAME='RegionTwo'");
    expect(run.envFile).toContain("OPENSTACK_NODE_NAME='compute-01'");
    expect(
      fs.statSync(path.join(machine.installDir, ".env")).mode & 0o777,
    ).toBe(0o600);
  });

  test("the key is in no program's arguments or environment", () => {
    const machine = setup();

    machine.run({ env: ANSWERED });

    expect(machine.log("docker").join("\n")).not.toContain(KEY);
    expect(machine.log("docker-env").join("\n")).not.toContain(KEY);
  });

  test("the key, typed at its prompt, reaches .env and never the screen", () => {
    const machine = setup();
    const run = machine.run({
      input: `${URL}\n${KEY}\n\n\n`,
    });

    expect(run.status).toBe(0);
    expect(run.envFile).toContain(`ONEUPTIME_TELEMETRY_INGESTION_KEY='${KEY}'`);
    expect(run.output).not.toContain(KEY);
  });

  test("a cloud and a region nobody named take the defaults", () => {
    const machine = setup();
    const run = machine.run({ input: `${URL}\n${KEY}\n\n\n` });

    expect(run.envFile).toContain("OPENSTACK_CLOUD_NAME='openstack'");
    expect(run.envFile).toContain("OPENSTACK_REGION_NAME='RegionOne'");
  });

  test("a value a shell or Compose would mangle arrives as typed", () => {
    const machine = setup();
    const run = machine.run({
      env: { ...ANSWERED, OPENSTACK_CLOUD_NAME: `it's $5 "east"` },
    });

    expect(run.status).toBe(0);
    expect(run.envFile).toContain(
      'OPENSTACK_CLOUD_NAME="it\'s $$5 \\"east\\""',
    );
  });

  test("a publish address someone named is kept, and none is written otherwise", () => {
    const named = setup();

    expect(
      named.run({
        env: { ...ANSWERED, OPENSTACK_TRACES_PUBLISH_ADDRESS: "10.0.3.1" },
      }).envFile,
    ).toContain("OPENSTACK_TRACES_PUBLISH_ADDRESS='10.0.3.1'");

    const plain = setup();

    expect(plain.run({ env: ANSWERED }).envFile).not.toContain(
      "OPENSTACK_TRACES_PUBLISH_ADDRESS",
    );
  });

  test("it says what to set on the services, with the address it listens on", () => {
    const machine = setup();
    const run = machine.run({ env: ANSWERED });

    expect(run.output).toContain("connection_string = otlp://127.0.0.1:4318");
    expect(run.output).toContain("opentelemetry-sdk opentelemetry-exporter-otlp");
    expect(run.output).toContain("trace_sqlalchemy = False");
    expect(run.output).not.toContain(KEY);
  });

  test("an image it cannot pull is no reason to stop: this machine may hold it", () => {
    const machine = setup();

    fs.writeFileSync(path.join(machine.dir, "pull.fail"), "");

    const run = machine.run({ env: ANSWERED });

    expect(run.status).toBe(0);
    expect(run.output).toContain("could not pull the image");
  });

  test("a collector that will not start stops it", () => {
    const machine = setup();

    fs.writeFileSync(path.join(machine.dir, "up.fail"), "");

    expect(machine.run({ env: ANSWERED }).status).not.toBe(0);
  });

  test("a re-run is the upgrade: it asks nothing and keeps every answer", () => {
    const machine = setup();
    const first = machine.run({ env: ANSWERED });
    const second = machine.run();

    expect(second.status).toBe(0);
    expect(second.output).toContain("Found an existing configuration");
    expect(second.envFile).toBe(first.envFile);
  });

  test("a file you edited is kept next to the new one, and said", () => {
    const machine = setup();

    machine.run({ env: ANSWERED });
    fs.writeFileSync(
      path.join(machine.installDir, "otel-collector-traces.yaml"),
      "# edited\n",
    );

    const second = machine.run();

    expect(second.output).toContain("These files differ".toLowerCase());
    expect(
      fs.readdirSync(machine.installDir).some((file) => {
        return file.startsWith("otel-collector-traces.yaml.bak.");
      }),
    ).toBe(true);
    expect(machine.file("otel-collector-traces.yaml")).toBe(
      agentFile("otel-collector-traces.yaml"),
    );
  });

  test("an argument it does not know stops it, before anything is written", () => {
    const machine = setup();
    const run = machine.run({ env: ANSWERED, args: ["--force"] });

    expect(run.status).toBe(2);
    expect(run.output).toContain("Usage: bash install-traces.sh");
    expect(fs.existsSync(machine.installDir)).toBe(false);
  });

  test("a OneUptime older than the script: its files come from GitHub", () => {
    const machine = setup();

    fs.writeFileSync(
      path.join(machine.dir, "oneuptime.answer"),
      "404 text/html",
    );

    const run = machine.run({ env: ANSWERED });

    expect(run.status).toBe(0);
    expect(run.output).toContain("Downloading them from GitHub");
    expect(machine.log("curl").join("\n")).toContain(
      "raw.githubusercontent.com/OneUptime/oneuptime/master/agents/OpenStackAgent",
    );
  });
});

describe("install-traces.sh without Docker", () => {
  test("it needs root and Linux, and says so", () => {
    const notRoot = setup({ uid: "1000" });
    const asUser = notRoot.run({ env: ANSWERED, args: ["native"] });

    expect(asUser.status).toBe(1);
    expect(asUser.output).toContain("needs root");

    const notLinux = setup({ uid: "0", kernel: "Darwin" });
    const elsewhere = notLinux.run({ env: ANSWERED, args: ["native"] });

    expect(elsewhere.status).toBe(1);
    expect(elsewhere.output).toContain("needs Linux");
  });

  test("a machine it has no release for stops before anything is asked or written", () => {
    const machine = setup({ uid: "0", arch: "riscv64" });
    const run = machine.run({ env: ANSWERED, args: ["native"] });

    expect(run.status).toBe(1);
    expect(run.output).toContain("riscv64");
    expect(fs.existsSync(machine.installDir)).toBe(false);
  });

  test("it installs the pinned release, and starts it on every boot", () => {
    const machine = setup({ uid: "0" });
    const run = machine.run({
      env: ANSWERED,
      args: ["native"],
      script: machine.scriptWithFakePin(),
    });

    expect(run.status).toBe(0);
    expect(fs.existsSync(path.join(machine.installDir, "otelcol-contrib"))).toBe(
      true,
    );
    expect(machine.file("otel-collector-traces.yaml")).toBe(
      agentFile("otel-collector-traces.yaml"),
    );
    expect(fs.readFileSync(machine.unit, "utf8")).toContain(
      `--config=${machine.installDir}/otel-collector-traces.yaml`,
    );
    expect(machine.log("systemctl")).toEqual([
      "daemon-reload",
      "enable oneuptime-openstack-traces",
      "restart oneuptime-openstack-traces",
    ]);
    expect(machine.log("docker")).toEqual([]);
  });

  test("its .env is quoted for systemd", () => {
    const machine = setup({ uid: "0" });
    const run = machine.run({
      env: { ...ANSWERED, OPENSTACK_CLOUD_NAME: 'say "east"' },
      args: ["native"],
      script: machine.scriptWithFakePin(),
    });

    expect(run.envFile).toContain('OPENSTACK_CLOUD_NAME="say \\"east\\""');
    expect(run.envFile).toContain(`ONEUPTIME_TELEMETRY_INGESTION_KEY="${KEY}"`);
  });

  test("an address for services in containers of their own is kept, and said", () => {
    const machine = setup({ uid: "0" });
    const run = machine.run({
      env: { ...ANSWERED, OPENSTACK_TRACES_LISTEN_ADDRESS: "10.0.3.1:4318" },
      args: ["native"],
      script: machine.scriptWithFakePin(),
    });

    expect(run.envFile).toContain(
      'OPENSTACK_TRACES_LISTEN_ADDRESS="10.0.3.1:4318"',
    );
    expect(run.output).toContain("connection_string = otlp://10.0.3.1:4318");
  });

  test("the real script refuses an archive that does not match, and installs nothing", () => {
    const machine = setup({ uid: "0" });
    const run = machine.run({ env: ANSWERED, args: ["native"] });

    expect(run.status).toBe(1);
    expect(run.output).toContain("does not match the sha256");
    expect(fs.existsSync(path.join(machine.installDir, "otelcol-contrib"))).toBe(
      false,
    );
    expect(machine.log("systemctl")).toEqual([]);
  });

  test("a re-run stays without Docker, whatever the machine holds by now", () => {
    const machine = setup({ uid: "0" });
    const script = machine.scriptWithFakePin();

    machine.run({ env: ANSWERED, args: ["native"], script });

    const second = machine.run({ script });

    expect(second.status).toBe(0);
    expect(second.output).toContain("Found an existing configuration");
    expect(machine.log("docker")).toEqual([]);
  });
});
