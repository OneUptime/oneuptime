"use strict";

/**
 * The Storage Array Agent reading a Dell PowerScale cluster (#11003):
 * agents/StorageArrayAgent/otel-collector-config.powerscale.yaml, and how
 * install.sh sets it up.
 *
 * The collector polls ISILON-MIB over SNMP with its own snmp receiver, so
 * nothing runs beside it. The cluster's own objects are read once, through
 * one node (snmp/cluster, snmp/quotas); a node's objects describe only the
 * node that answers, so every node has a receiver of its own: snmp/node-1 to
 * snmp/node-252, each a copy of snmp/node at POWERSCALE_NODE_<n>, run only
 * when install.sh lists it in POWERSCALE_SNMP_RECEIVERS.
 *
 * `otelcol validate` (validate-collector-configs.sh) proves the config
 * starts, and the recorded capture the Common tests read proves what it
 * sends (packages/Common/Tests/Helpers/StorageArray/PowerScale); this proves
 * its shape, and runs install.sh for real with docker and curl stubbed.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");
const { agentFilesCurlStub } = require("./Utils/AgentFilesCurlStub");
const { agentKindVersion } = require("./Utils/AgentKindVersion");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "StorageArrayAgent");
const CONFIG_NAME = "otel-collector-config.powerscale.yaml";
const CONFIG_PATH = path.join(AGENT_DIR, CONFIG_NAME);
const PLATFORM_PATH = path.join(
  REPO_ROOT,
  "packages/Common/Types/StorageArray/Platforms/Dell/PowerScale/PowerScalePlatform.ts",
);
const INGESTION_KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";
// OneFS's own default community: it holds a $.
const COMMUNITY = "I$ilonpublic";
const MAX_NODES = 252;

const TEXT = fs.readFileSync(CONFIG_PATH, "utf8");
const CONFIG = yaml.load(TEXT);
const RECEIVERS = CONFIG.receivers;

/*
 * install.sh's PLATFORMS table, one line per menu choice: PowerScale's
 * number in the menu is its line's place, and every other line's address,
 * token, user and kept settings (fields 4, 5, 10 and 12) are written to
 * .env empty. Read from the script, so a platform added later moves neither.
 */
const PLATFORM_TABLE = fs
  .readFileSync(path.join(AGENT_DIR, "install.sh"), "utf8")
  .split('\nPLATFORMS="\n')[1]
  .split('\n"\n')[0]
  .split("\n")
  .filter((line) => {
    return line.trim() !== "";
  })
  .map((line) => {
    return line.split("|");
  });
const POWERSCALE_ROW = PLATFORM_TABLE.findIndex((fields) => {
  return fields[0] === CONFIG_NAME;
});
const MENU_NUMBER = String(POWERSCALE_ROW + 1);
const OTHER_PLATFORMS_EMPTY = {};
for (const fields of PLATFORM_TABLE) {
  if (fields[0] === CONFIG_NAME) {
    continue;
  }
  for (const field of [fields[3], fields[4], fields[9], fields[11]]) {
    for (const name of field.split(" ")) {
      if (name !== "-" && name !== "") {
        OTHER_PLATFORMS_EMPTY[name] = "''";
      }
    }
  }
}

const SNMP_SETTINGS = {
  version: "${env:POWERSCALE_SNMP_VERSION:-v2c}",
  community: "${env:POWERSCALE_SNMP_COMMUNITY}",
  user: "${env:POWERSCALE_SNMP_USER:-}",
  security_level: "${env:POWERSCALE_SNMP_SECURITY_LEVEL:-auth_priv}",
  auth_type: "${env:POWERSCALE_SNMP_AUTH_PROTOCOL:-SHA}",
  auth_password: "${env:POWERSCALE_SNMP_AUTH_PASSWORD:-}",
  privacy_type: "${env:POWERSCALE_SNMP_PRIVACY_PROTOCOL:-AES}",
  privacy_password: "${env:POWERSCALE_SNMP_PRIVACY_PASSWORD:-}",
};

function slotNames() {
  return Array.from({ length: MAX_NODES }, (_, index) => {
    return `snmp/node-${index + 1}`;
  });
}

// Every OID a receiver reads: its metrics', attributes' and resource attributes'.
function oidsOf(receiver) {
  const oids = [];
  for (const attribute of Object.values(receiver.resource_attributes || {})) {
    if (attribute.scalar_oid) {
      oids.push({ oid: attribute.scalar_oid, scalar: true });
    }
    if (attribute.oid) {
      oids.push({ oid: attribute.oid, scalar: false });
    }
  }
  for (const attribute of Object.values(receiver.attributes || {})) {
    if (attribute.oid) {
      oids.push({ oid: attribute.oid, scalar: false });
    }
  }
  for (const metric of Object.values(receiver.metrics || {})) {
    for (const scalar of metric.scalar_oids || []) {
      oids.push({ oid: scalar.oid, scalar: true });
    }
    for (const column of metric.column_oids || []) {
      oids.push({ oid: column.oid, scalar: false });
    }
  }
  return oids;
}

// The metric names a platform's snapshot reads, from its TypeScript source.
function snapshotMetricNames() {
  const source = fs.readFileSync(PLATFORM_PATH, "utf8");
  const block = source.match(/snapshotMetricNames: \[([\s\S]*?)\n {2}\],/);
  expect(block).not.toBeNull();
  return [...block[1].matchAll(/"(powerscale_[a-z0-9_]+)"/g)].map((match) => {
    return match[1];
  });
}

// The metric names the config sends: its receivers' and the transform's copies.
function sentMetricNames() {
  const names = new Set();
  for (const name of ["snmp/cluster", "snmp/quotas", "snmp/node"]) {
    for (const metric of Object.keys(RECEIVERS[name].metrics)) {
      names.add(metric);
    }
  }
  const statements = CONFIG.processors["transform/powerscale"].metric_statements
    .flatMap((block) => {
      return block.statements;
    })
    .join("\n");
  for (const match of statements.matchAll(
    /copy_metric\(name="([a-z0-9_]+)"\)/g,
  )) {
    names.add(match[1]);
  }
  return names;
}

describe("agents/StorageArrayAgent/otel-collector-config.powerscale.yaml", () => {
  test("has the cluster's, the quotas' and the node template's receivers, then one slot per node, 1 to 252", () => {
    expect(Object.keys(RECEIVERS)).toEqual([
      "snmp/cluster",
      "snmp/quotas",
      "snmp/node",
      ...slotNames(),
    ]);
  });

  test("each slot is the node template at its own node's address, and nothing else", () => {
    const template = RECEIVERS["snmp/node"];
    for (let n = 1; n <= MAX_NODES; n++) {
      const slot = RECEIVERS[`snmp/node-${n}`];
      expect(slot).toEqual({
        ...template,
        endpoint: `udp://\${env:POWERSCALE_NODE_${n}:-127.0.0.1}:161`,
      });
      // A slot no node fills still validates: it is never in the pipeline.
      expect(TEXT).toContain(
        `  snmp/node-${n}: { <<: *powerscale_node, endpoint: "udp://\${env:POWERSCALE_NODE_${n}:-127.0.0.1}:161" }\n`,
      );
    }
    const slots = TEXT.match(
      /# POWERSCALE NODE SLOTS BEGIN\n([\s\S]*?)\n {2}# POWERSCALE NODE SLOTS END/,
    );
    expect(slots).not.toBeNull();
    expect(slots[1].split("\n")).toHaveLength(MAX_NODES);
  });

  test("reads the cluster and its quotas through the node at POWERSCALE_ENDPOINT, every receiver with the same credentials", () => {
    for (const name of ["snmp/cluster", "snmp/quotas", "snmp/node"]) {
      const receiver = RECEIVERS[name];
      expect(receiver.endpoint).toBe("udp://${env:POWERSCALE_ENDPOINT}:161");
      expect(receiver).toMatchObject(SNMP_SETTINGS);
    }
  });

  test("polls the cluster and each node every minute and the quotas every five, never longer than an interval", () => {
    const seconds = (duration) => {
      const match = /^(\d+)s$/.exec(duration);
      expect(match).not.toBeNull();
      return Number(match[1]);
    };
    expect(RECEIVERS["snmp/cluster"].collection_interval).toBe("60s");
    expect(RECEIVERS["snmp/quotas"].collection_interval).toBe("300s");
    expect(RECEIVERS["snmp/node"].collection_interval).toBe("60s");
    for (const name of ["snmp/cluster", "snmp/quotas", "snmp/node"]) {
      const receiver = RECEIVERS[name];
      expect(seconds(receiver.timeout)).toBeLessThan(
        seconds(receiver.collection_interval),
      );
    }
  });

  test("reads only ISILON-MIB and MIB-II/IF-MIB, scalars at .0 and columns without", () => {
    for (const name of ["snmp/cluster", "snmp/quotas", "snmp/node"]) {
      for (const { oid, scalar } of oidsOf(RECEIVERS[name])) {
        expect({
          name,
          oid,
          known: /^1\.3\.6\.1\.(4\.1\.12124|2\.1)\./.test(oid),
        }).toEqual({ name, oid, known: true });
        expect({ name, oid, scalar, endsInZero: oid.endsWith(".0") }).toEqual({
          name,
          oid,
          scalar,
          endsInZero: scalar,
        });
      }
    }
  });

  test("the cluster's poll keeps to the cluster's objects and each node's to its own", () => {
    for (const { oid } of oidsOf(RECEIVERS["snmp/cluster"])) {
      expect(oid.startsWith("1.3.6.1.4.1.12124.2.")).toBe(false);
    }
    for (const { oid } of oidsOf(RECEIVERS["snmp/quotas"])) {
      expect(oid.startsWith("1.3.6.1.4.1.12124.1.12.")).toBe(true);
    }
    for (const { oid } of oidsOf(RECEIVERS["snmp/node"])) {
      expect(oid.startsWith("1.3.6.1.4.1.12124.1.")).toBe(false);
    }
  });

  test("labels each poll's identity series with the poll it is", () => {
    const labelled = (receiver, metric, endpoint) => {
      const oids = [
        ...(receiver.metrics[metric].scalar_oids || []),
        ...(receiver.metrics[metric].column_oids || []),
      ];
      expect(receiver.attributes.scrape_endpoint).toEqual({ enum: [endpoint] });
      for (const oid of oids) {
        expect(oid.attributes).toContainEqual({
          name: "scrape_endpoint",
          value: endpoint,
        });
      }
    };
    labelled(RECEIVERS["snmp/cluster"], "powerscale_cluster_health", "cluster");
    labelled(RECEIVERS["snmp/cluster"], "powerscale_cluster_nodes", "cluster");
    labelled(
      RECEIVERS["snmp/quotas"],
      "powerscale_quota_usage_bytes",
      "quotas",
    );
    labelled(RECEIVERS["snmp/node"], "powerscale_node_health", "node");
  });

  test("sends every series the platform reads, each named powerscale_", () => {
    const sent = sentMetricNames();
    for (const name of sent) {
      expect(name).toMatch(/^powerscale_[a-z0-9_]+$/);
    }
    for (const name of snapshotMetricNames()) {
      expect({ name, sent: sent.has(name) }).toEqual({ name, sent: true });
    }
  });

  test("runs the receivers install.sh lists, through the transform, filter, identity and batch, into OneUptime", () => {
    expect(TEXT).toContain(
      "      receivers: ${env:POWERSCALE_SNMP_RECEIVERS:-[snmp/cluster, snmp/quotas, snmp/node]}\n",
    );
    expect(Object.keys(CONFIG.service.pipelines)).toEqual(["metrics"]);
    expect(CONFIG.service.pipelines.metrics.processors).toEqual([
      "memory_limiter",
      "transform/powerscale",
      "filter/powerscale",
      "resource",
      "batch",
    ]);
    expect(CONFIG.service.pipelines.metrics.exporters).toEqual(["otlphttp"]);
    expect(CONFIG.exporters.otlphttp).toEqual({
      endpoint: "${env:ONEUPTIME_URL}/otlp",
      headers: {
        "x-oneuptime-token": "${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}",
      },
    });
  });

  test("stamps the array identity and the agent's version as every agent config does, and never splits a poll", () => {
    // The agent's files' version, not the collector's (AgentFilesVersion.test.ts).
    const version = agentKindVersion("STORAGE_ARRAY_AGENT_VERSION");
    expect(CONFIG.processors.resource.attributes).toEqual([
      {
        key: "storage.array.name",
        value: "${env:STORAGE_ARRAY_NAME}",
        action: "upsert",
      },
      {
        key: "storage.system",
        value: "${env:STORAGE_SYSTEM}",
        action: "upsert",
      },
      { key: "oneuptime.agent.version", value: version, action: "upsert" },
      { key: "service.name", action: "delete" },
      { key: "service.instance.id", action: "delete" },
    ]);
    expect(CONFIG.processors.batch).not.toHaveProperty("send_batch_max_size");
    expect(CONFIG.processors.memory_limiter.limit_mib).toBeGreaterThan(0);
  });

  test("moves the receivers' identity onto each series and drops what it cannot make a number of", () => {
    const transform = CONFIG.processors["transform/powerscale"];
    expect(transform.error_mode).toBe("ignore");
    const statements = transform.metric_statements
      .flatMap((block) => {
        return block.statements;
      })
      .join("\n");
    for (const label of ["cluster", "node", "drive", "quota", "limit"]) {
      expect(statements).toContain(`datapoint.attributes["${label}"]`);
    }
    expect(statements).toContain(
      'delete_matching_keys(resource.attributes, "^powerscale\\\\.")',
    );
    const drops = CONFIG.processors["filter/powerscale"].metrics.datapoint;
    expect(drops).toContain(
      'metric.name == "powerscale_interface_status" and datapoint.attributes["interface_type"] == "24"',
    );
    expect(drops).toContain(
      'metric.name == "powerscale_quota_used_percent" and datapoint.attributes["limit"] == nil',
    );
  });

  test("reads only variables install.sh writes, or ones it gives a default", () => {
    const install = fs.readFileSync(path.join(AGENT_DIR, "install.sh"), "utf8");
    const written = new Set([
      "ONEUPTIME_URL",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "STORAGE_ARRAY_NAME",
      "STORAGE_SYSTEM",
      "POWERSCALE_ENDPOINT",
      "POWERSCALE_SNMP_COMMUNITY",
    ]);
    const extra = install.match(
      /PLATFORM_EXTRA_VARIABLES="(POWERSCALE_[^"$]+)/,
    );
    expect(extra).not.toBeNull();
    for (const name of extra[1].trim().split(/\s+/)) {
      written.add(name);
    }
    for (const match of TEXT.matchAll(/\$\{env:([A-Z0-9_]+)(:-[^}]*)?\}/g)) {
      const [, name, fallback] = match;
      if (/^POWERSCALE_NODE_\d+$/.test(name)) {
        // A slot's address, which install.sh writes for each node it lists.
        expect(fallback).toBe(":-127.0.0.1");
        continue;
      }
      expect({ name, written: written.has(name) }).toEqual({
        name,
        written: true,
      });
    }
  });
});

/* ------------------------------------------------------------ install.sh */

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "storage-array-powerscale-"),
  );
  scratchDirs.push(dir);
  return dir;
}

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

function install(dir, { env = {}, input = "" } = {}) {
  const bin = path.join(dir, "bin");
  if (!fs.existsSync(bin)) {
    fs.mkdirSync(bin);
    writeExecutable(
      path.join(bin, "docker"),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/docker.log"
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
  }
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
  const envFile = path.join(installDir, ".env");
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    installDir,
    envFile: fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "",
  };
}

/* The .env as Compose reads it: NAME -> raw value as written, in order. */
function envLines(envFile) {
  const values = {};
  for (const line of envFile.split("\n").filter(Boolean)) {
    const at = line.indexOf("=");
    values[line.slice(0, at)] = line.slice(at + 1);
  }
  return values;
}

function answers(...lines) {
  return `${lines.join("\n")}\n`;
}

const BASE_ENV = {
  ONEUPTIME_URL: "https://oneuptime.example.com",
  ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
  STORAGE_ARRAY_COLLECTOR_CONFIG: CONFIG_NAME,
  STORAGE_ARRAY_NAME: "ps-prod",
};

describe("install.sh for a PowerScale cluster", () => {
  test("reads the PLATFORMS table it derives the menu number and other platforms from", () => {
    expect(POWERSCALE_ROW).toBeGreaterThan(-1);
    expect(PLATFORM_TABLE[POWERSCALE_ROW]).toHaveLength(13);
    expect(PLATFORM_TABLE[POWERSCALE_ROW][1]).toBe("dell.powerscale");
    // The Pure platforms' at least, and none of PowerScale's own.
    expect(OTHER_PLATFORMS_EMPTY).toMatchObject({
      PURE_FA_ENDPOINT: "''",
      PURE_FA_API_TOKEN: "''",
      PURE_FB_ENDPOINT: "''",
      PURE_FB_API_TOKEN: "''",
    });
    for (const name of Object.keys(OTHER_PLATFORMS_EMPTY)) {
      expect(name.startsWith("POWERSCALE_")).toBe(false);
    }
  });

  test("from the menu: every node's address, SNMP v2c and the community, written for the collector", () => {
    const dir = scratch();
    const run = install(dir, {
      input: answers(
        "https://oneuptime.example.com/",
        INGESTION_KEY,
        MENU_NUMBER,
        "ps-prod",
        "10.20.0.11, 10.20.0.12,10.20.0.12,https://10.20.0.13/, fd00::14",
        "",
        COMMUNITY,
      ),
    });

    expect(run.status).toBe(0);
    expect(run.output).toContain(
      `${MENU_NUMBER}) Dell PowerScale (Isilon), polled over SNMP`,
    );
    expect(run.output).toContain(
      "Use each node's own address, not the SmartConnect name.",
    );
    expect(envLines(run.envFile)).toEqual({
      ONEUPTIME_URL: "'https://oneuptime.example.com'",
      ONEUPTIME_TELEMETRY_INGESTION_KEY: `'${INGESTION_KEY}'`,
      STORAGE_ARRAY_NAME: "'ps-prod'",
      STORAGE_SYSTEM: "dell.powerscale",
      STORAGE_ARRAY_COLLECTOR_CONFIG: CONFIG_NAME,
      COMPOSE_PROFILES: "",
      // Every other platform's settings stay empty: switching is an .env edit.
      ...OTHER_PLATFORMS_EMPTY,
      // The cluster's own objects are read through the first node.
      POWERSCALE_ENDPOINT: "'10.20.0.11'",
      // Single-quoted: Compose reads the $ literally.
      POWERSCALE_SNMP_COMMUNITY: `'${COMMUNITY}'`,
      POWERSCALE_SNMP_VERSION: "'v2c'",
      POWERSCALE_SNMP_USER: "''",
      POWERSCALE_SNMP_SECURITY_LEVEL: "'auth_priv'",
      POWERSCALE_SNMP_AUTH_PROTOCOL: "'SHA'",
      POWERSCALE_SNMP_AUTH_PASSWORD: "''",
      POWERSCALE_SNMP_PRIVACY_PROTOCOL: "'AES'",
      POWERSCALE_SNMP_PRIVACY_PASSWORD: "''",
      // Each address once, without a scheme or path.
      POWERSCALE_NODES: "'10.20.0.11,10.20.0.12,10.20.0.13,fd00::14'",
      POWERSCALE_SNMP_RECEIVERS:
        "'[snmp/cluster, snmp/quotas, snmp/node-1, snmp/node-2, snmp/node-3, snmp/node-4]'",
      POWERSCALE_NODE_1: "'10.20.0.11'",
      POWERSCALE_NODE_2: "'10.20.0.12'",
      POWERSCALE_NODE_3: "'10.20.0.13'",
      // An IPv6 address in brackets, as udp://[...]:161 needs it.
      POWERSCALE_NODE_4: "'[fd00::14]'",
      STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
      // Named after its directory, <scratch>/agent, as every second array's agent is (#11168).
      STORAGE_ARRAY_AGENT_CONTAINER_NAME:
        "'oneuptime-storage-array-agent-agent'",
    });
    // The community was read without echo, and no TLS question was asked.
    expect(run.output).not.toContain(COMMUNITY);
    expect(run.output).not.toContain("self-signed certificate");
    expect(run.output).toContain(
      "Reading the PowerScale cluster at 10.20.0.11 over SNMP (ISILON-MIB).",
    );
    expect(run.output).toContain(
      "Polling 4 nodes over SNMP v2c: 10.20.0.11, 10.20.0.12, 10.20.0.13, fd00::14.",
    );
    expect(fs.statSync(path.join(run.installDir, ".env")).mode & 0o777).toBe(
      0o600,
    );
    // It downloaded its config, with the others.
    expect(
      fs.readFileSync(path.join(run.installDir, CONFIG_NAME), "utf8"),
    ).toBe(TEXT);
  });

  test("STORAGE_SYSTEM=dell.powerscale picks the PowerScale config without the menu", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_SYSTEM: "dell.powerscale",
        STORAGE_ARRAY_NAME: "ps-prod",
      },
      input: answers("10.20.0.21", "2c", "public-ro"),
    });
    expect(run.status).toBe(0);
    expect(run.output).not.toContain("Which array does this agent monitor?");
    expect(envLines(run.envFile)).toMatchObject({
      STORAGE_ARRAY_COLLECTOR_CONFIG: CONFIG_NAME,
      POWERSCALE_ENDPOINT: "'10.20.0.21'",
      POWERSCALE_NODES: "'10.20.0.21'",
      POWERSCALE_SNMP_RECEIVERS: "'[snmp/cluster, snmp/quotas, snmp/node-1]'",
      POWERSCALE_NODE_1: "'10.20.0.21'",
      POWERSCALE_SNMP_COMMUNITY: "'public-ro'",
    });
    expect(run.output).toContain("Polling 1 node over SNMP v2c: 10.20.0.21.");
  });

  test("an address already set is the default node list, and Enter keeps it", () => {
    const dir = scratch();
    const run = install(dir, {
      env: { ...BASE_ENV, POWERSCALE_ENDPOINT: "https://10.20.0.31/" },
      input: answers("", "", "public-ro"),
    });
    // read -p prompts only on a terminal; the answers' order is the check.
    expect(run.status).toBe(0);
    expect(envLines(run.envFile)).toMatchObject({
      POWERSCALE_ENDPOINT: "'10.20.0.31'",
      POWERSCALE_NODES: "'10.20.0.31'",
      POWERSCALE_NODE_1: "'10.20.0.31'",
    });
  });

  test("SNMPv3: a user and passwords instead of a community, none echoed", () => {
    const dir = scratch();
    const run = install(dir, {
      env: BASE_ENV,
      input: answers(
        "10.20.0.41,10.20.0.42",
        "3",
        "oneuptime",
        "auth$pass1",
        "priv#pass2",
      ),
    });
    expect(run.status).toBe(0);
    const values = envLines(run.envFile);
    expect(values).toMatchObject({
      POWERSCALE_SNMP_VERSION: "'v3'",
      POWERSCALE_SNMP_USER: "'oneuptime'",
      POWERSCALE_SNMP_SECURITY_LEVEL: "'auth_priv'",
      POWERSCALE_SNMP_AUTH_PROTOCOL: "'SHA'",
      POWERSCALE_SNMP_AUTH_PASSWORD: "'auth$pass1'",
      POWERSCALE_SNMP_PRIVACY_PROTOCOL: "'AES'",
      POWERSCALE_SNMP_PRIVACY_PASSWORD: "'priv#pass2'",
      // SNMPv3 reads no community, so none was asked for.
      POWERSCALE_SNMP_COMMUNITY: "''",
    });
    expect(run.output).not.toContain("Read-only SNMP community");
    expect(run.output).not.toContain("auth$pass1");
    expect(run.output).not.toContain("priv#pass2");
    expect(run.output).toContain(
      "Polling 2 nodes over SNMP v3: 10.20.0.41, 10.20.0.42.",
    );
  });

  test("SNMPv3 with authentication only asks for no privacy password", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ...BASE_ENV,
        POWERSCALE_SNMP_VERSION: "v3",
        POWERSCALE_SNMP_SECURITY_LEVEL: "AUTH_NO_PRIV",
        POWERSCALE_SNMP_AUTH_PROTOCOL: "sha256",
      },
      input: answers("10.20.0.51", "monitor", "authonly1"),
    });
    expect(run.status).toBe(0);
    expect(envLines(run.envFile)).toMatchObject({
      POWERSCALE_SNMP_SECURITY_LEVEL: "'auth_no_priv'",
      POWERSCALE_SNMP_AUTH_PROTOCOL: "'SHA256'",
      POWERSCALE_SNMP_PRIVACY_PASSWORD: "''",
    });
    expect(run.output).not.toContain("SNMPv3 privacy password");
  });

  test("a re-run reuses every setting from .env, asks nothing and writes the same file", () => {
    const dir = scratch();
    const first = install(dir, {
      env: BASE_ENV,
      input: answers("10.20.0.61,10.20.0.62", "", COMMUNITY),
    });
    expect(first.status).toBe(0);
    const again = install(dir, {
      env: { ONEUPTIME_URL: "", ONEUPTIME_TELEMETRY_INGESTION_KEY: "" },
      input: "",
    });
    expect(again.status).toBe(0);
    expect(again.output).toContain("reusing it");
    expect(again.output).not.toContain("Every node's address");
    expect(again.envFile).toBe(first.envFile);
  });

  test("a node list edited in .env takes effect on the next run", () => {
    const dir = scratch();
    const first = install(dir, {
      env: BASE_ENV,
      input: answers("10.20.0.71", "", "public-ro"),
    });
    expect(first.status).toBe(0);
    const envFile = path.join(first.installDir, ".env");
    fs.writeFileSync(
      envFile,
      first.envFile.replace(
        "POWERSCALE_NODES='10.20.0.71'",
        "POWERSCALE_NODES='10.20.0.71,10.20.0.72,10.20.0.73'",
      ),
    );
    const again = install(dir, { env: {}, input: "" });
    expect(again.status).toBe(0);
    expect(envLines(again.envFile)).toMatchObject({
      POWERSCALE_SNMP_RECEIVERS:
        "'[snmp/cluster, snmp/quotas, snmp/node-1, snmp/node-2, snmp/node-3]'",
      POWERSCALE_NODE_3: "'10.20.0.73'",
    });
  });

  test.each([
    [
      "a node with a port",
      { POWERSCALE_NODES: "10.20.0.81:1161" },
      "names a port: OneFS answers SNMP on",
    ],
    [
      "more nodes than OneFS's largest cluster",
      {
        POWERSCALE_NODES: Array.from({ length: MAX_NODES + 1 }, (_, i) => {
          return `10.21.${Math.floor(i / 250)}.${(i % 250) + 1}`;
        }).join(","),
      },
      `lists more than ${MAX_NODES} nodes`,
    ],
    [
      "no address at all",
      { POWERSCALE_NODES: " , ," },
      "names no node address",
    ],
    [
      "an SNMP version OneFS does not answer",
      { POWERSCALE_NODES: "10.20.0.82", POWERSCALE_SNMP_VERSION: "v1" },
      "must be v2c or v3",
    ],
    [
      "a security level the receiver has not",
      {
        POWERSCALE_NODES: "10.20.0.83",
        POWERSCALE_SNMP_SECURITY_LEVEL: "authpriv",
      },
      "must be auth_priv, auth_no_priv or no_auth_no_priv",
    ],
    [
      "a community the collector would rewrite",
      {
        POWERSCALE_NODES: "10.20.0.84",
        POWERSCALE_SNMP_COMMUNITY: "ab$${PATH}",
      },
      "must not contain $$ or ${",
    ],
  ])("refuses %s", (_name, env, message) => {
    const dir = scratch();
    const run = install(dir, {
      env: { ...BASE_ENV, ...env },
      input: answers("", "", "public-ro"),
    });
    expect(run.status).toBe(1);
    expect(run.output).toContain(message);
    expect(run.envFile).toBe("");
  });

  test("252 nodes fill every slot", () => {
    const dir = scratch();
    const nodes = Array.from({ length: MAX_NODES }, (_, i) => {
      return `10.22.${Math.floor(i / 250)}.${(i % 250) + 1}`;
    });
    const run = install(dir, {
      env: {
        ...BASE_ENV,
        POWERSCALE_NODES: nodes.join(","),
        POWERSCALE_SNMP_VERSION: "v2c",
        POWERSCALE_SNMP_COMMUNITY: "public-ro",
      },
    });
    expect(run.status).toBe(0);
    const values = envLines(run.envFile);
    expect(values[`POWERSCALE_NODE_${MAX_NODES}`]).toBe(
      `'${nodes[MAX_NODES - 1]}'`,
    );
    expect(values.POWERSCALE_SNMP_RECEIVERS).toBe(
      `'[snmp/cluster, snmp/quotas, ${slotNames().join(", ")}]'`,
    );
  });
});

/* ---------------------------------------------------------- troubleshoot.sh */

describe("troubleshoot.sh for a PowerScale cluster", () => {
  /*
   * snmpget, stubbed: it answers clusterName for the node it knows when the
   * snmp.conf SNMPCONFPATH names holds the community, and logs its
   * arguments, which must never carry the community.
   */
  function withSnmpget(dir) {
    writeExecutable(
      path.join(dir, "bin", "snmpget"),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/snmpget.log"
conf="$SNMPCONFPATH/snmp.conf"
[ -f "$conf" ] && cp "$conf" "$STUB_DIR/snmp.conf.seen"
host=""
for arg in "$@"; do
  if [ "$arg" = "1.3.6.1.4.1.12124.1.1.1.0" ]; then break; fi
  host="$arg"
done
if [ "$host" = "10.20.0.91" ] && grep -qx 'defCommunity I\\$ilonpublic' "$conf"; then
  printf '"ps-prod"\\n'
  exit 0
fi
printf 'Timeout: No Response from %s.\\n' "$host"
exit 1
`,
    );
  }

  function troubleshoot(dir, installDir) {
    const result = spawnSync(
      "bash",
      [path.join(AGENT_DIR, "troubleshoot.sh"), "-d", installDir],
      {
        env: {
          PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
          STUB_DIR: dir,
        },
        encoding: "utf8",
        timeout: 60000,
      },
    );
    return `${result.stdout}${result.stderr}`;
  }

  test("knows the PowerScale config, and probes each node over SNMP with the community in a file of its own", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ...BASE_ENV,
        POWERSCALE_NODES: "10.20.0.91,10.20.0.92",
        POWERSCALE_SNMP_VERSION: "v2c",
        POWERSCALE_SNMP_COMMUNITY: COMMUNITY,
      },
    });
    expect(run.status).toBe(0);
    withSnmpget(dir);
    const output = troubleshoot(dir, run.installDir);

    expect(output).toContain(
      "Mode: PowerScale cluster, polled over SNMP by the collector itself",
    );
    expect(output).not.toContain("is not one of the shipped configs");
    expect(output).toContain("Polling 2 node(s): 10.20.0.91 10.20.0.92");
    expect(output).toContain("Node 10.20.0.91 answers SNMP: cluster ps-prod.");
    expect(output).toContain("Node 10.20.0.92 does not answer SNMP");
    // The community reached snmpget in its snmp.conf, never on a command line.
    const calls = fs.readFileSync(path.join(dir, "snmpget.log"), "utf8");
    expect(calls).not.toContain(COMMUNITY);
    expect(calls.split("\n").filter(Boolean)).toHaveLength(2);
    expect(fs.readFileSync(path.join(dir, "snmp.conf.seen"), "utf8")).toBe(
      `defVersion 2c\ndefCommunity ${COMMUNITY}\n`,
    );
    expect(output).not.toContain(COMMUNITY);
  });

  test("an SNMPv3 cluster's user and passwords go in the file too, in Net-SNMP's names", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ...BASE_ENV,
        POWERSCALE_NODES: "10.20.0.93",
        POWERSCALE_SNMP_VERSION: "v3",
        POWERSCALE_SNMP_USER: "monitor",
        POWERSCALE_SNMP_AUTH_PROTOCOL: "SHA256",
        POWERSCALE_SNMP_AUTH_PASSWORD: "authpass123",
        POWERSCALE_SNMP_PRIVACY_PROTOCOL: "AES256",
        POWERSCALE_SNMP_PRIVACY_PASSWORD: "privpass123",
      },
    });
    expect(run.status).toBe(0);
    withSnmpget(dir);
    const output = troubleshoot(dir, run.installDir);
    expect(output).toContain("Node 10.20.0.93 does not answer SNMP");
    expect(fs.readFileSync(path.join(dir, "snmp.conf.seen"), "utf8")).toBe(
      [
        "defVersion 3",
        "defSecurityName monitor",
        "defSecurityLevel authPriv",
        "defAuthType SHA-256",
        "defAuthPassphrase authpass123",
        "defPrivType AES-256",
        "defPrivPassphrase privpass123",
        "",
      ].join("\n"),
    );
    const calls = fs.readFileSync(path.join(dir, "snmpget.log"), "utf8");
    expect(calls).not.toContain("authpass123");
    expect(calls).not.toContain("privpass123");
    expect(output).toContain(
      "No node of the cluster answered SNMP from this machine.",
    );
  });
});
