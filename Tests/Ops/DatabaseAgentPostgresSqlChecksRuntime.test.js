"use strict";

/**
 * Runtime counterpart to the "postgresql config's SQL checks" in
 * DatabaseAgentConfigs.test.js.
 *
 * The PostgreSQL config reads what the postgresql receiver does not report
 * - how long the server has been up, the oldest transaction ID age, the
 * longest open transaction and the sessions waiting on a lock - with the
 * collector's sqlquery receiver, over the agent's own monitoring login. A
 * query that the monitoring role may not run, a column that comes back as
 * text, or a connection setting the receiver reads differently would all
 * pass `otelcol validate` and leave four monitors watching nothing. So this
 * runs the shipped config AS SHIPPED (its receivers and its metrics
 * pipeline's processors; only the exporter is a file) against a real
 * PostgreSQL with a role that holds nothing but pg_monitor, a transaction
 * left open on a row, and a second session waiting for that row's lock,
 * and reads back what would have been exported:
 *
 *   - the four metrics arrive, whole numbers, with the values the server
 *     is in (a transaction open for seconds, one session waiting);
 *   - they carry the same identity stamp as the receiver's own metrics, so
 *     OneUptime attributes them to the same database;
 *   - the receiver's own metrics still arrive beside them.
 *
 * It needs a working Docker daemon and pulls two images, so it is OFF by
 * default and never runs in the normal `npm test` / CI path. Enable it
 * explicitly:
 *
 *   RUN_CONTAINER_AGENT_RUNTIME_TESTS=1 npm test
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "DatabaseAgent");
const POSTGRES_IMAGE = "postgres:15";
const SQL_CHECK_METRICS = [
  "postgresql.uptime",
  "postgresql.xid.oldest_age",
  "postgresql.transaction.longest_duration",
  "postgresql.sessions.waiting_on_lock",
];
const COLLECTOR_PIN = /otel\/opentelemetry-collector-contrib:\d+\.\d+\.\d+/;

const ENABLED = process.env.RUN_CONTAINER_AGENT_RUNTIME_TESTS === "1";

function docker(args, options) {
  return spawnSync("docker", args, { encoding: "utf8", ...options });
}

function collectorImage() {
  const compose = fs.readFileSync(
    path.join(AGENT_DIR, "docker-compose.yml"),
    "utf8",
  );
  return compose.match(COLLECTOR_PIN)[0];
}

function sleep(seconds) {
  execFileSync("sh", ["-c", `sleep ${seconds}`]);
}

const AVAILABLE = ENABLED && docker(["version"]).status === 0;
const describeRuntime = AVAILABLE ? describe : describe.skip;

const SUFFIX = `${process.pid}`;
const NETWORK = `oneuptime-dbagent-sql-${SUFFIX}`;
const POSTGRES = `oneuptime-dbagent-sql-pg-${SUFFIX}`;
const COLLECTOR = `oneuptime-dbagent-sql-otel-${SUFFIX}`;
// What the monitoring role's password may hold (no space: see the config).
const PASSWORD = "S3cret'quoted$dollar@at#hash";

/*
 * The agent's .env as install.sh writes it for this server (the login with
 * every $ doubled for the collector).
 */
const ENV = {
  DATABASE_SYSTEM: "postgresql",
  DATABASE_ENDPOINT: `${POSTGRES}:5432`,
  DATABASE_ENDPOINT_HOST: POSTGRES,
  DATABASE_ENDPOINT_PORT: "5432",
  DATABASE_SERVER_ADDRESS: "orders-db.example.net",
  DATABASE_SERVER_PORT: "5432",
  DATABASE_USERNAME: "oneuptime_monitor",
  DATABASE_PASSWORD: PASSWORD.split("$").join("$$"),
  DATABASE_TLS_INSECURE: "true",
  DATABASE_TLS_INSECURE_SKIP_VERIFY: "false",
  DATABASE_TLS_SSLMODE: "disable",
  DATABASE_COLLECTION_INTERVAL: "5s",
  DATABASE_QUERY_EVENTS: "false",
  DATABASE_SERVER_ID: "",
  ONEUPTIME_URL: "https://oneuptime.example.com",
  ONEUPTIME_TELEMETRY_INGESTION_KEY: "unused",
};

// The shipped config, metrics only, exporting to a file.
function runtimeConfig() {
  const shipped = yaml.load(
    fs.readFileSync(path.join(AGENT_DIR, "configs", "postgresql.yaml"), "utf8"),
  );
  const metrics = shipped.service.pipelines.metrics;
  return {
    receivers: shipped.receivers,
    processors: shipped.processors,
    exporters: { file: { path: "/out/out.json" } },
    service: {
      pipelines: {
        metrics: {
          receivers: metrics.receivers,
          processors: metrics.processors,
          exporters: ["file"],
        },
      },
    },
  };
}

function psql(sql, detached) {
  const args = ["exec"];
  if (detached) {
    args.push("-d");
  }
  args.push(POSTGRES, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1");
  args.push("-c", sql);
  const result = docker(args);
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr}`);
  }
}

function exportedMetrics(outFile) {
  const found = [];
  if (!fs.existsSync(outFile)) {
    return found;
  }
  for (const line of fs.readFileSync(outFile, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    for (const resourceMetrics of JSON.parse(line).resourceMetrics || []) {
      const attributes = {};
      for (const attribute of resourceMetrics.resource?.attributes || []) {
        attributes[attribute.key] =
          attribute.value.stringValue ?? attribute.value.intValue;
      }
      for (const scopeMetrics of resourceMetrics.scopeMetrics || []) {
        for (const metric of scopeMetrics.metrics || []) {
          const points = (metric.gauge || metric.sum || {}).dataPoints || [];
          for (const point of points) {
            found.push({
              name: metric.name,
              resource: attributes,
              value:
                point.asInt !== undefined
                  ? Number(point.asInt)
                  : point.asDouble,
              isInt: point.asInt !== undefined,
            });
          }
        }
      }
    }
  }
  return found;
}

describeRuntime("PostgreSQL's SQL checks against a real server", () => {
  let workDir = "";
  let outFile = "";

  beforeAll(() => {
    for (const image of [collectorImage(), POSTGRES_IMAGE]) {
      const pulled = docker(["pull", image], { timeout: 600000 });
      if (pulled.status !== 0) {
        throw new Error(`could not pull ${image}: ${pulled.stderr}`);
      }
    }

    docker(["network", "create", NETWORK]);
    const started = docker([
      "run",
      "-d",
      "--rm",
      "--name",
      POSTGRES,
      "--network",
      NETWORK,
      "-e",
      "POSTGRES_PASSWORD=postgres",
      POSTGRES_IMAGE,
    ]);
    if (started.status !== 0) {
      throw new Error(`could not start PostgreSQL: ${started.stderr}`);
    }
    for (let attempt = 0; attempt < 60; attempt++) {
      if (
        docker(["exec", POSTGRES, "pg_isready", "-U", "postgres"]).status === 0
      ) {
        break;
      }
      sleep(1);
    }
    sleep(2);

    // A role that holds nothing but pg_monitor, as the README grants.
    const literal = `'${PASSWORD.split("'").join("''")}'`;
    psql(
      `CREATE ROLE oneuptime_monitor LOGIN PASSWORD ${literal}; GRANT pg_monitor TO oneuptime_monitor;`,
    );
    psql(
      "CREATE TABLE orders (id int PRIMARY KEY); INSERT INTO orders VALUES (1);",
    );
    // A transaction left open on a row, and a session waiting for its lock.
    psql(
      "BEGIN; UPDATE orders SET id = 1 WHERE id = 1; SELECT pg_sleep(300); COMMIT;",
      true,
    );
    sleep(1);
    psql("UPDATE orders SET id = 1 WHERE id = 1;", true);
    sleep(2);

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-dbagent-sql-"));
    const outDir = path.join(workDir, "out");
    fs.mkdirSync(outDir);
    fs.writeFileSync(
      path.join(workDir, "config.yaml"),
      yaml.dump(runtimeConfig(), { lineWidth: -1 }),
    );
    // The collector runs as a non-root user.
    fs.chmodSync(workDir, 0o777);
    fs.chmodSync(outDir, 0o777);
    outFile = path.join(outDir, "out.json");

    const args = ["run", "-d", "--name", COLLECTOR, "--network", NETWORK];
    for (const [key, value] of Object.entries(ENV)) {
      args.push("-e", `${key}=${value}`);
    }
    args.push(
      "-v",
      `${path.join(workDir, "config.yaml")}:/etc/otelcol-contrib/config.yaml:ro`,
      "-v",
      `${outDir}:/out`,
      collectorImage(),
    );
    const collector = docker(args);
    if (collector.status !== 0) {
      throw new Error(`could not start the collector: ${collector.stderr}`);
    }
  }, 900000);

  afterAll(() => {
    docker(["rm", "-f", "-v", COLLECTOR]);
    docker(["rm", "-f", "-v", POSTGRES]);
    docker(["network", "rm", NETWORK]);
    if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  function waitForSqlChecks() {
    let metrics = [];
    for (let attempt = 0; attempt < 60; attempt++) {
      metrics = exportedMetrics(outFile);
      const names = new Set(
        metrics.map((metric) => {
          return metric.name;
        }),
      );
      if (
        SQL_CHECK_METRICS.every((name) => {
          return names.has(name);
        }) &&
        names.has("postgresql.backends")
      ) {
        return metrics;
      }
      sleep(1);
    }
    const logs = docker(["logs", COLLECTOR]);
    throw new Error(
      `the four SQL checks did not arrive.\n${logs.stdout}\n${logs.stderr}`,
    );
  }

  test("the four metrics arrive as whole numbers, saying what the server is in", () => {
    const metrics = waitForSqlChecks();
    const latest = (name) => {
      const points = metrics.filter((metric) => {
        return metric.name === name;
      });
      return points[points.length - 1];
    };

    for (const name of SQL_CHECK_METRICS) {
      expect({ name, isInt: latest(name).isInt }).toEqual({
        name,
        isInt: true,
      });
    }
    expect(latest("postgresql.uptime").value).toBeGreaterThan(0);
    expect(latest("postgresql.xid.oldest_age").value).toBeGreaterThan(0);
    expect(
      latest("postgresql.transaction.longest_duration").value,
    ).toBeGreaterThanOrEqual(1);
    expect(
      latest("postgresql.sessions.waiting_on_lock").value,
    ).toBeGreaterThanOrEqual(1);
  }, 120000);

  test("they carry the identity stamp the receiver's own metrics carry", () => {
    const metrics = waitForSqlChecks();
    const uptime = metrics.find((metric) => {
      return metric.name === "postgresql.uptime";
    });
    const backends = metrics.find((metric) => {
      return metric.name === "postgresql.backends";
    });

    for (const key of [
      "db.system.name",
      "server.address",
      "server.port",
      "oneuptime.database.agent",
      "oneuptime.agent.version",
    ]) {
      expect({ key, value: uptime.resource[key] }).toEqual({
        key,
        value: backends.resource[key],
      });
    }
    expect(uptime.resource["db.system.name"]).toBe("postgresql");
    expect(uptime.resource["server.address"]).toBe("orders-db.example.net");
    expect(uptime.resource["service.name"]).toBeUndefined();
  }, 120000);
});

describe("PostgreSQL SQL check runtime tests", () => {
  test("are opt-in, and say so when a daemon is missing", () => {
    if (ENABLED && !AVAILABLE) {
      throw new Error(
        "RUN_CONTAINER_AGENT_RUNTIME_TESTS=1 was set but no Docker daemon answered `docker version`.",
      );
    }
    expect(AVAILABLE).toBe(ENABLED);
  });
});
