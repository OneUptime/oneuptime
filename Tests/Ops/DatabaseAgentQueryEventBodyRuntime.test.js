"use strict";

/**
 * Runtime counterpart to the query-event body check in
 * DatabaseAgentConfigs.test.js.
 *
 * The postgresql, mysql, mongodb, sqlserver and oracledb receivers emit query
 * samples and top queries with an EMPTY body and the query in the
 * db.query.text attribute. OneUptime stored that body as "{}" and the Logs tab
 * showed "{}" as the message of every one (e2e, collector 0.161.0: 202,246
 * postgresql and 42,320 mysql rows with body '{}'). Each config's logs
 * pipeline now copies the query text into the body.
 *
 * DatabaseAgentConfigs.test.js pins the statements; this runs them. It takes
 * each shipped config's logs-pipeline processors AS SHIPPED, feeds them the
 * records the receivers really produced (the attributes below are the e2e
 * rows' own) through an OTLP JSON file, and reads back what the pipeline
 * would have exported:
 *
 *   - a query event gets its query text as the body, and keeps the attribute;
 *   - a query event without query text gets its event name;
 *   - a record that already has a body (a filelog line) keeps it.
 *
 * OTTL's view of an empty body (nil) is exactly the kind of fact a collector
 * upgrade can change without `otelcol validate` noticing, which is why this
 * exists next to the static check.
 *
 * It needs a working Docker daemon and pulls an image, so it is OFF by default
 * and never runs in the normal `npm test` / CI path. Enable it explicitly:
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
const ENGINES_WITH_QUERY_EVENTS = [
  "postgresql",
  "mysql",
  "mongodb",
  "sqlserver",
  "oracledb",
];

const ENABLED = process.env.RUN_CONTAINER_AGENT_RUNTIME_TESTS === "1";

function docker(args, options) {
  return spawnSync("docker", args, { encoding: "utf8", ...options });
}

function collectorImage() {
  const compose = fs.readFileSync(
    path.join(AGENT_DIR, "docker-compose.yml"),
    "utf8",
  );
  return compose.match(
    /otel\/opentelemetry-collector-contrib:\d+\.\d+\.\d+/,
  )[0];
}

const AVAILABLE = ENABLED && docker(["version"]).status === 0;
const describeRuntime = AVAILABLE ? describe : describe.skip;

function stringAttribute(key, value) {
  return { key, value: { stringValue: value } };
}

/*
 * The e2e rows, as the receivers emitted them: no body, the query in
 * db.query.text, the event's name in eventName.
 */
const QUERY_SAMPLE = {
  timeUnixNano: "1790297479222170624",
  eventName: "db.server.query_sample",
  attributes: [
    stringAttribute("db.system.name", "postgresql"),
    stringAttribute("db.namespace", "orders"),
    stringAttribute("db.query.text", "SELECT ? AS ok"),
    stringAttribute("user.name", "oneuptime_monitor"),
    stringAttribute("postgresql.state", "idle"),
  ],
};
const TOP_QUERY = {
  timeUnixNano: "1790297461110186496",
  eventName: "db.server.top_query",
  attributes: [
    stringAttribute("db.system.name", "mysql"),
    stringAttribute("db.query.text", "SHOW GLOBAL STATUS"),
    stringAttribute(
      "mysql.events_statements_summary_by_digest.digest",
      "070e38632eb4444e50cdcbf0b17474ba801e203add89783a24584951442a2317",
    ),
  ],
};
const TOP_QUERY_WITHOUT_TEXT = {
  timeUnixNano: "1790297461110186496",
  eventName: "db.server.top_query",
  attributes: [stringAttribute("db.query.text", "")],
};
const LOG_FILE_LINE = {
  timeUnixNano: "1790297479222170624",
  body: {
    stringValue:
      "2026-09-25 00:51:17 UTC [804] LOG:  checkpoint starting: time",
  },
  attributes: [stringAttribute("db.query.text", "SELECT 1")],
};
const RECORDS = [
  QUERY_SAMPLE,
  TOP_QUERY,
  TOP_QUERY_WITHOUT_TEXT,
  LOG_FILE_LINE,
];

/* What the agent's .env hands the processors (the identity stamp). */
const ENV = {
  DATABASE_SYSTEM: "postgresql",
  DATABASE_SERVER_ADDRESS: "pg16.rcv-e2e.example.net",
  DATABASE_SERVER_PORT: "5432",
  DATABASE_SERVER_ID: "",
};

/*
 * The shipped config with its receiver and exporter swapped for a file in and
 * a file out, and its logs pipeline's processors kept exactly as shipped.
 */
function runtimeConfig(engine) {
  const shipped = yaml.load(
    fs.readFileSync(path.join(AGENT_DIR, "configs", `${engine}.yaml`), "utf8"),
  );
  return {
    receivers: {
      otlp_json_file: { include: ["/in/*.json"], start_at: "beginning" },
    },
    processors: shipped.processors,
    exporters: { file: { path: "/out/out.json" } },
    service: {
      pipelines: {
        logs: {
          receivers: ["otlp_json_file"],
          processors: shipped.service.pipelines.logs.processors,
          exporters: ["file"],
        },
      },
    },
  };
}

function exportedRecords(outFile) {
  if (!fs.existsSync(outFile)) {
    return [];
  }
  const records = [];
  for (const line of fs.readFileSync(outFile, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    for (const resourceLogs of JSON.parse(line).resourceLogs || []) {
      for (const scopeLogs of resourceLogs.scopeLogs || []) {
        records.push(...(scopeLogs.logRecords || []));
      }
    }
  }
  return records;
}

function attributeValue(record, key) {
  const attribute = (record.attributes || []).find((entry) => {
    return entry.key === key;
  });
  return attribute ? attribute.value.stringValue : undefined;
}

/* Run the pipeline over RECORDS and return what it exported, in order. */
function runPipeline(engine) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-dbagent-"));
  const inDir = path.join(workDir, "in");
  const outDir = path.join(workDir, "out");
  fs.mkdirSync(inDir);
  fs.mkdirSync(outDir);
  fs.writeFileSync(
    path.join(workDir, "config.yaml"),
    yaml.dump(runtimeConfig(engine), { lineWidth: -1 }),
  );
  fs.writeFileSync(
    path.join(inDir, "events.json"),
    `${JSON.stringify({
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: { name: `receiver/${engine}receiver` },
              logRecords: RECORDS,
            },
          ],
        },
      ],
    })}\n`,
  );
  // The collector runs as a non-root user.
  for (const entry of [workDir, inDir, outDir]) {
    fs.chmodSync(entry, 0o777);
  }

  const name = `oneuptime-dbagent-body-test-${process.pid}-${engine}`;
  docker(["rm", "-f", name]);
  const args = ["run", "-d", "--name", name];
  for (const [key, value] of Object.entries(ENV)) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(
    "-v",
    `${path.join(workDir, "config.yaml")}:/etc/otelcol-contrib/config.yaml:ro`,
    "-v",
    `${inDir}:/in:ro`,
    "-v",
    `${outDir}:/out`,
    collectorImage(),
  );
  const started = docker(args);
  if (started.status !== 0) {
    throw new Error(`docker run failed: ${started.stderr}`);
  }

  const outFile = path.join(outDir, "out.json");
  let records = [];
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      records = exportedRecords(outFile);
      if (records.length >= RECORDS.length) {
        break;
      }
      execFileSync("sh", ["-c", "sleep 1"]);
    }
    if (records.length < RECORDS.length) {
      const logs = docker(["logs", name]);
      throw new Error(
        `${engine}: exported ${records.length} of ${RECORDS.length} records.\n${logs.stdout}\n${logs.stderr}`,
      );
    }
  } finally {
    docker(["rm", "-f", name]);
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  return records;
}

describeRuntime("query events through the shipped logs pipeline", () => {
  beforeAll(() => {
    const pulled = docker(["pull", collectorImage()], { timeout: 600000 });
    if (pulled.status !== 0) {
      throw new Error(`could not pull ${collectorImage()}: ${pulled.stderr}`);
    }
  }, 660000);

  test.each(ENGINES_WITH_QUERY_EVENTS)(
    "the %s config gives every query event a readable message",
    (engine) => {
      const [sample, top, topWithoutText, fileLine] = runPipeline(engine);

      expect(sample.body).toEqual({ stringValue: "SELECT ? AS ok" });
      expect(attributeValue(sample, "db.query.text")).toBe("SELECT ? AS ok");
      expect(top.body).toEqual({ stringValue: "SHOW GLOBAL STATUS" });
      expect(attributeValue(top, "db.query.text")).toBe("SHOW GLOBAL STATUS");
      expect(topWithoutText.body).toEqual({
        stringValue: "db.server.top_query",
      });
      expect(fileLine.body).toEqual(LOG_FILE_LINE.body);
    },
    120000,
  );
});

describe("Database Agent runtime tests", () => {
  test("are opt-in, and say so when a daemon is missing", () => {
    if (ENABLED && !AVAILABLE) {
      throw new Error(
        "RUN_CONTAINER_AGENT_RUNTIME_TESTS=1 was set but no Docker daemon answered `docker version`.",
      );
    }
    expect(AVAILABLE).toBe(ENABLED);
  });
});
