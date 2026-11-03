"use strict";

/**
 * The Docker Swarm agent's inventory poller (agents/DockerSwarmAgent/
 * inventory-snapshot.sh), run for real against a stand-in for a manager's
 * Docker API: a `curl` first on PATH that answers each endpoint the poller
 * asks for from a file, as a swarm manager's daemon would.
 * DockerSwarmInventorySnapshot.test.js and swarm-agent-inventory-behaviour.sh
 * both run it through here, so they read the same swarm.
 *
 *   write-api <dir>              the stand-in API's answers, into <dir>
 *   run-once <apiDir> <outDir>   one snapshot of each file, into <outDir>
 *   activate-last-worker <apiDir>   the last node (past the first kilobyte of
 *                                the inventory) goes from drain to active
 *   collector-config <dir>       <dir>/config.yaml: the agent's two inventory
 *                                receivers exactly as it ships them, reading
 *                                /data, and file exporters for what they read
 *                                (/out/logs.json, /out/metrics.json)
 *   check-collected <logs.json> <metrics.json> <snapshots>
 *                                the collector read every one of <snapshots>
 *                                snapshots in full, the last one's change
 *                                included, and each one's metrics
 *
 * The swarm (buildSwarmApi): three managers - the leader, one reachable and
 * one Swarm cannot reach, which is down - and a drained worker; a service
 * two of whose three replicas run, after a rejected task and two failed ones
 * in the last hour and an older failure that no longer counts, whose update
 * paused; a global service on every node; a job service that ran to
 * completion; a service of no stack; and their tasks, the current ones and
 * the ones each slot replaced.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SCRIPT = path.join(
  REPO_ROOT,
  "agents",
  "DockerSwarmAgent",
  "inventory-snapshot.sh",
);

const MINUTE_MS = 60 * 1000;

// "2026-11-02T21:30:15.123456789Z", as the Docker API writes a timestamp.
function dockerTime(ms) {
  return new Date(ms).toISOString().replace("Z", "456789Z");
}

const NODE_IDS = {
  leader: "n1leader0000000000000000a",
  reachable: "n2reachable00000000000000",
  unreachable: "n3unreachable000000000000",
  worker: "n4worker00000000000000000",
};

const SERVICE_IDS = {
  checkout: "s1checkout000000000000000",
  agent: "s2agent000000000000000000",
  migrate: "s3migrate0000000000000000",
  cron: "s4cron0000000000000000000",
};

// The Docker Engine API's answers for one swarm, `nowMs` its "now".
function buildSwarmApi(nowMs) {
  const node = (id, hostname, state, role, availability, managerStatus) => {
    return {
      ID: id,
      Description: {
        Hostname: hostname,
        Engine: { EngineVersion: "28.5.1" },
        Resources: { NanoCPUs: 4000000000, MemoryBytes: 8589934592 },
      },
      Status: {
        State: state,
        Addr: `10.0.0.${Object.values(NODE_IDS).indexOf(id) + 11}`,
        ...(state === "down" ? { Message: "heartbeat failure" } : {}),
      },
      Spec: { Role: role, Availability: availability },
      ...(managerStatus ? { ManagerStatus: managerStatus } : {}),
    };
  };

  const nodes = [
    node(NODE_IDS.leader, "swarm-manager-01", "ready", "manager", "active", {
      Leader: true,
      Reachability: "reachable",
      Addr: "10.0.0.11:2377",
    }),
    node(NODE_IDS.reachable, "swarm-manager-02", "ready", "manager", "active", {
      Reachability: "reachable",
      Addr: "10.0.0.12:2377",
    }),
    node(
      NODE_IDS.unreachable,
      "swarm-manager-03",
      "down",
      "manager",
      "active",
      { Reachability: "unreachable", Addr: "10.0.0.13:2377" },
    ),
    node(NODE_IDS.worker, "swarm-worker-01", "ready", "worker", "drain", null),
  ];

  const services = [
    {
      ID: SERVICE_IDS.checkout,
      CreatedAt: dockerTime(nowMs - 30 * 24 * 60 * MINUTE_MS),
      UpdatedAt: dockerTime(nowMs - 50 * MINUTE_MS),
      Spec: {
        Name: "shop_checkout",
        Labels: { "com.docker.stack.namespace": "shop" },
        Mode: { Replicated: { Replicas: 3 } },
        TaskTemplate: {
          ContainerSpec: {
            Image:
              "registry.acme-swarm.example/shop/checkout:2.7.0@sha256:0123456789abcdef",
          },
        },
      },
      ServiceStatus: { RunningTasks: 2, DesiredTasks: 3 },
      UpdateStatus: {
        State: "paused",
        StartedAt: dockerTime(nowMs - 50 * MINUTE_MS),
        Message: "update paused due to failure or early termination of task x7",
      },
    },
    {
      ID: SERVICE_IDS.agent,
      Spec: {
        Name: "monitoring_node-agent",
        Labels: { "com.docker.stack.namespace": "monitoring" },
        Mode: { Global: {} },
        TaskTemplate: { ContainerSpec: { Image: "acme/node-agent:1.4" } },
      },
      ServiceStatus: { RunningTasks: 3, DesiredTasks: 3 },
    },
    {
      ID: SERVICE_IDS.migrate,
      Spec: {
        Name: "shop_migrate",
        Labels: { "com.docker.stack.namespace": "shop" },
        Mode: { ReplicatedJob: { MaxConcurrent: 1, TotalCompletions: 1 } },
        TaskTemplate: { ContainerSpec: { Image: "acme/migrate:2.7.0" } },
      },
      ServiceStatus: { RunningTasks: 0, DesiredTasks: 0, CompletedTasks: 1 },
    },
    {
      ID: SERVICE_IDS.cron,
      Spec: {
        Name: "nightly_cleanup",
        Labels: {},
        Mode: { Replicated: { Replicas: 1 } },
        TaskTemplate: { ContainerSpec: { Image: "acme/cleanup:1" } },
      },
      ServiceStatus: { RunningTasks: 1, DesiredTasks: 1 },
    },
  ];

  const task = (
    id,
    serviceId,
    slot,
    nodeId,
    desired,
    state,
    minutesAgo,
    extra,
  ) => {
    return {
      ID: id,
      ServiceID: serviceId,
      ...(slot === null ? {} : { Slot: slot }),
      NodeID: nodeId,
      DesiredState: desired,
      Spec: {
        ContainerSpec: {
          Image:
            serviceId === SERVICE_IDS.checkout
              ? "registry.acme-swarm.example/shop/checkout:2.7.0@sha256:0123456789abcdef"
              : "acme/node-agent:1.4",
        },
      },
      Status: {
        State: state,
        Timestamp: dockerTime(nowMs - minutesAgo * MINUTE_MS),
        ...extra,
      },
    };
  };

  const tasks = [
    task(
      "t1running0000000000000000",
      SERVICE_IDS.checkout,
      1,
      NODE_IDS.leader,
      "running",
      "running",
      40,
      {
        ContainerStatus: { ContainerID: "c".repeat(64), ExitCode: 0 },
      },
    ),
    task(
      "t2running0000000000000000",
      SERVICE_IDS.checkout,
      2,
      NODE_IDS.reachable,
      "running",
      "running",
      40,
      {
        ContainerStatus: { ContainerID: "d".repeat(64), ExitCode: 0 },
      },
    ),
    // Slot 3 cannot be placed: no node has the memory it reserves.
    task(
      "t3pending0000000000000000",
      SERVICE_IDS.checkout,
      3,
      "",
      "running",
      "pending",
      12,
      {
        Err: "no suitable node (insufficient resources on 3 nodes)",
      },
    ),
    // What slot 3 was before: rejected, then failed twice, in the last hour.
    task(
      "t4rejected000000000000000",
      SERVICE_IDS.checkout,
      3,
      NODE_IDS.reachable,
      "shutdown",
      "rejected",
      20,
      {
        Err: "no suitable node (insufficient resources on 3 nodes)",
      },
    ),
    task(
      "t5failed00000000000000000",
      SERVICE_IDS.checkout,
      3,
      NODE_IDS.leader,
      "shutdown",
      "failed",
      30,
      {
        Err: "task: non-zero exit (1)",
        ContainerStatus: { ContainerID: "e".repeat(64), ExitCode: 1 },
      },
    ),
    task(
      "t6failed00000000000000000",
      SERVICE_IDS.checkout,
      3,
      NODE_IDS.leader,
      "shutdown",
      "failed",
      35,
      {
        Err: "task: non-zero exit (137)",
        ContainerStatus: { ContainerID: "f".repeat(64), ExitCode: 137 },
      },
    ),
    // Older than the hour: history, not a crash loop.
    task(
      "t7oldfail0000000000000000",
      SERVICE_IDS.checkout,
      2,
      NODE_IDS.leader,
      "shutdown",
      "failed",
      180,
      {
        Err: "task: non-zero exit (2)",
      },
    ),
    // The global service on each node but the drained one... and the down one.
    task(
      "t8global00000000000000000",
      SERVICE_IDS.agent,
      null,
      NODE_IDS.leader,
      "running",
      "running",
      600,
      {},
    ),
    task(
      "t9global00000000000000000",
      SERVICE_IDS.agent,
      null,
      NODE_IDS.reachable,
      "running",
      "running",
      600,
      {},
    ),
    task(
      "t10global0000000000000000",
      SERVICE_IDS.agent,
      null,
      NODE_IDS.worker,
      "running",
      "running",
      600,
      {},
    ),
    // The job's task, done.
    task(
      "t11job00000000000000000000",
      SERVICE_IDS.migrate,
      1,
      NODE_IDS.leader,
      "complete",
      "complete",
      90,
      {},
    ),
  ];

  return {
    info: { Name: "swarm-manager-01" },
    nodes: nodes,
    services: services,
    tasks: tasks,
    networks: [
      { Id: "net1", Name: "shop_default", Driver: "overlay", Scope: "swarm" },
      { Id: "net2", Name: "bridge", Driver: "bridge", Scope: "local" },
    ],
    secrets: [
      {
        ID: "sec1",
        Spec: { Name: "shop_db_password" },
        CreatedAt: dockerTime(nowMs - 60 * MINUTE_MS),
        UpdatedAt: dockerTime(nowMs - 60 * MINUTE_MS),
      },
    ],
    configs: [],
    volumes: {
      Volumes: [
        {
          Name: "shop_data",
          Driver: "local",
          Scope: "local",
          Mountpoint: "/var/lib/docker/volumes/shop_data/_data",
        },
      ],
    },
  };
}

/*
 * The stand-in `curl`: the poller calls curl --silent --fail --unix-socket
 * <socket> http://localhost<endpoint>. Each endpoint is a file; an endpoint
 * with no file fails, as a daemon's error does under --fail.
 */
const FAKE_CURL = `#!/bin/sh
for argument in "$@"; do url="$argument"; done
endpoint="\${url#http://localhost}"
case "$endpoint" in
  /info) file=info ;;
  /nodes) file=nodes ;;
  "/services?status=true") file=services ;;
  /tasks) file=tasks ;;
  /networks) file=networks ;;
  /secrets) file=secrets ;;
  /configs) file=configs ;;
  /volumes) file=volumes ;;
  *) exit 22 ;;
esac
[ -f "$SWARM_API_DIR/$file.json" ] || exit 22
cat "$SWARM_API_DIR/$file.json"
`;

function writeApi(apiDir, api) {
  fs.mkdirSync(apiDir, { recursive: true });
  for (const [name, value] of Object.entries(api)) {
    if (value === null) {
      continue;
    }
    fs.writeFileSync(path.join(apiDir, `${name}.json`), JSON.stringify(value));
  }
  const binDir = path.join(apiDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "curl"), FAKE_CURL, { mode: 0o755 });
}

/*
 * One `inventory-snapshot.sh --once` against the stand-in API in apiDir:
 * the inventory and the metrics it wrote into outDir, as the collector would
 * read them.
 */
function runOnce(apiDir, outDir, env) {
  fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(outDir, "oneuptime-docker-swarm-inventory.log");
  const metricsPath = path.join(
    outDir,
    "oneuptime-docker-swarm-inventory-metrics.json",
  );
  execFileSync("sh", [SCRIPT, "--once"], {
    env: {
      PATH: `${path.join(apiDir, "bin")}:${process.env.PATH}`,
      SWARM_API_DIR: apiDir,
      DOCKER_INVENTORY_LOG_PATH: logPath,
      DOCKER_INVENTORY_METRICS_PATH: metricsPath,
      ...(env || {}),
    },
    encoding: "utf8",
  });
  const inventoryText = fs.readFileSync(logPath, "utf8");
  const metricsText = fs.readFileSync(metricsPath, "utf8");
  return {
    inventoryText: inventoryText,
    inventory: inventoryText
      .split("\n")
      .filter((line) => {
        return line.trim().length > 0;
      })
      .map((line) => {
        return JSON.parse(line);
      }),
    metricsText: metricsText,
    metrics: JSON.parse(metricsText),
  };
}

// The records of one kind, by a field of their data.
function recordsOf(inventory, kind) {
  return inventory
    .filter((record) => {
      return record["oneuptime.dockerswarm.kind"] === kind;
    })
    .map((record) => {
      return record.data;
    });
}

function attributesOf(resource) {
  const result = {};
  for (const attribute of (resource && resource.attributes) || []) {
    result[attribute.key] = attribute.value.stringValue;
  }
  return result;
}

/*
 * The metrics line as a list of { name, resource attributes, value, time },
 * one per data point.
 */
function readMetricPoints(metrics) {
  const points = [];
  for (const resourceMetrics of metrics.resourceMetrics || []) {
    const resource = attributesOf(resourceMetrics.resource);
    for (const scopeMetrics of resourceMetrics.scopeMetrics || []) {
      for (const metric of scopeMetrics.metrics || []) {
        for (const point of (metric.gauge && metric.gauge.dataPoints) || []) {
          points.push({
            name: metric.name,
            unit: metric.unit,
            scope: scopeMetrics.scope && scopeMetrics.scope.name,
            resource: resource,
            value: Number(point.asInt),
            timeUnixNano: point.timeUnixNano,
          });
        }
      }
    }
  }
  return points;
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const SHIPPED_CONFIG = path.join(
  REPO_ROOT,
  "agents",
  "DockerSwarmAgent",
  "otel-collector-config.yaml",
);

const INVENTORY_RECEIVERS = ["filelog/inventory", "otlpjsonfile/inventory"];

/*
 * A collector config of the agent's two inventory receivers as it ships them
 * - their operators, start_at and polling untouched - reading the files from
 * /data instead of /var/log, and writing what they read to /out.
 */
function buildCollectorConfig() {
  const shipped = yaml.load(fs.readFileSync(SHIPPED_CONFIG, "utf8"));
  const receivers = {};
  for (const name of INVENTORY_RECEIVERS) {
    const receiver = shipped.receivers[name];
    if (!receiver) {
      throw new Error(`the agent's config has no ${name} receiver`);
    }
    receivers[name] = {
      ...receiver,
      include: receiver.include.map((file) => {
        return file.replace("/var/log/", "/data/");
      }),
      // A test cannot wait a minute between snapshots: poll often.
      poll_interval: "1s",
    };
  }
  return {
    receivers: receivers,
    exporters: {
      "file/logs": { path: "/out/logs.json" },
      "file/metrics": { path: "/out/metrics.json" },
    },
    service: {
      pipelines: {
        logs: {
          receivers: ["filelog/inventory"],
          exporters: ["file/logs"],
        },
        metrics: {
          receivers: ["otlpjsonfile/inventory"],
          exporters: ["file/metrics"],
        },
      },
    },
  };
}

// Every line a file exporter wrote, each an OTLP export.
function readExports(file) {
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => {
      return line.trim().length > 0;
    })
    .map((line) => {
      return JSON.parse(line);
    });
}

function anyValue(value) {
  if (!value) {
    return undefined;
  }
  if (value.stringValue !== undefined) {
    return value.stringValue;
  }
  if (value.kvlistValue) {
    const result = {};
    for (const entry of value.kvlistValue.values || []) {
      result[entry.key] = anyValue(entry.value);
    }
    return result;
  }
  return value.intValue ?? value.doubleValue ?? value.boolValue;
}

/*
 * The log records the collector sent, as { kind, data }: the envelope's
 * kind is a record attribute, its data the body.
 */
function readCollectedRecords(logsFile) {
  const records = [];
  for (const exported of readExports(logsFile)) {
    for (const resourceLogs of exported.resourceLogs || []) {
      for (const scopeLogs of resourceLogs.scopeLogs || []) {
        for (const record of scopeLogs.logRecords || []) {
          const attributes = {};
          for (const attribute of record.attributes || []) {
            attributes[attribute.key] = anyValue(attribute.value);
          }
          records.push({
            kind: attributes["oneuptime.dockerswarm.kind"],
            data: anyValue(record.body),
          });
        }
      }
    }
  }
  return records;
}

function readCollectedPoints(metricsFile) {
  const points = [];
  for (const exported of readExports(metricsFile)) {
    points.push(...readMetricPoints(exported));
  }
  return points;
}

/*
 * What check-collected holds the collector to, as a list of failures
 * (empty when it read every snapshot in full).
 */
function checkCollected(logsFile, metricsFile, snapshots) {
  const failures = [];
  const records = readCollectedRecords(logsFile);
  const snapshotIds = new Set(
    records
      .filter((record) => {
        return record.kind === "Snapshot";
      })
      .map((record) => {
        return record.data && record.data.Id;
      }),
  );
  if (snapshotIds.size !== snapshots) {
    failures.push(
      `read ${snapshotIds.size} snapshots, expected ${snapshots}: a snapshot that starts like the last one is not read again`,
    );
  }
  const nodes = records.filter((record) => {
    return record.kind === "Node";
  });
  if (nodes.length !== snapshots * 4) {
    failures.push(
      `read ${nodes.length} node records, expected ${snapshots * 4} (four nodes, every snapshot)`,
    );
  }
  const lastWorker = nodes.filter((record) => {
    return record.data && record.data.ID === NODE_IDS.worker;
  });
  const last = lastWorker[lastWorker.length - 1];
  if (!last || last.data.Availability !== "active") {
    failures.push(
      "the last snapshot's change, past the inventory's first kilobyte, never arrived",
    );
  }
  const readyPoints = readCollectedPoints(metricsFile).filter((point) => {
    return point.name === "docker.swarm.node.ready";
  });
  const readings = new Set(
    readyPoints.map((point) => {
      return point.timeUnixNano;
    }),
  );
  if (readings.size !== snapshots) {
    failures.push(
      `read ${readings.size} metrics readings, expected ${snapshots}`,
    );
  }
  return failures;
}

// The last node of the swarm - past the inventory's first kilobyte - is put back to work.
function activateLastWorker(apiDir) {
  const file = path.join(apiDir, "nodes.json");
  const nodes = JSON.parse(fs.readFileSync(file, "utf8"));
  const worker = nodes.find((node) => {
    return node.ID === NODE_IDS.worker;
  });
  worker.Spec.Availability = "active";
  fs.writeFileSync(file, JSON.stringify(nodes));
}

module.exports = {
  NODE_IDS,
  SCRIPT,
  SERVICE_IDS,
  buildCollectorConfig,
  buildSwarmApi,
  checkCollected,
  activateLastWorker,
  readMetricPoints,
  recordsOf,
  runOnce,
  tempDir,
  writeApi,
};

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "write-api") {
    writeApi(args[0], buildSwarmApi(Date.now()));
  } else if (command === "run-once") {
    runOnce(args[0], args[1]);
  } else if (command === "activate-last-worker") {
    activateLastWorker(args[0]);
  } else if (command === "collector-config") {
    fs.mkdirSync(args[0], { recursive: true });
    fs.writeFileSync(
      path.join(args[0], "config.yaml"),
      yaml.dump(buildCollectorConfig()),
    );
  } else if (command === "check-collected") {
    const failures = checkCollected(args[0], args[1], Number(args[2]));
    if (failures.length > 0) {
      process.stderr.write(`FAILED:\n  ${failures.join("\n  ")}\n`);
      process.exit(1);
    }
    process.stdout.write("ok\n");
  } else {
    process.stderr.write(`unknown command: ${command}\n`);
    process.exit(2);
  }
}
