"use strict";

/**
 * The Database Agent's collector configs (agents/DatabaseAgent/configs), one
 * per engine, and the files that install and run them.
 *
 * OneUptime registers a database from what these configs stamp on every
 * batch, so their shape is part of the product, not decoration:
 *
 *  - the `resource` processor UPSERTS the identity — db.system.name,
 *    server.address, server.port — and `oneuptime.database.agent: "true"`,
 *    which tells ingest the address was set on purpose;
 *  - `oneuptime.database.server.id` is optional and must never reach
 *    OneUptime empty. The resource processor refuses to start on an empty
 *    value, so a transform sets it and deletes it again when it is blank;
 *  - nothing stamps `k8s.cluster.name` (ingest reads it as the Kubernetes
 *    agent's heartbeat) or runs a `resourcedetection` processor (its
 *    `system` detector makes the agent's machine look like the monitored
 *    resource, a Host);
 *  - `service.name` is deleted, or the batch routes to a phantom Service;
 *  - one receiver instance per pipeline, because the stamp would merge a
 *    second server into the first.
 *
 * `otelcol validate` (validate-collector-configs.sh) proves the configs
 * start; this proves they say the right thing.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = "agents/DatabaseAgent";
const ENGINES = [
  "postgresql",
  "mysql",
  "redis",
  "mongodb",
  "sqlserver",
  "oracledb",
  "elasticsearch",
  "memcached",
];
/* Engines whose receiver emits query samples and top queries as logs. */
const ENGINES_WITH_QUERY_EVENTS = [
  "postgresql",
  "mysql",
  "mongodb",
  "sqlserver",
  "oracledb",
];
/* Receivers whose server.address / server.port are off by default upstream. */
const ENGINES_NEEDING_ADDRESS_ATTRIBUTES = ["redis", "mongodb"];
/* Receivers with a TLS `insecure` switch (the others choose TLS elsewhere). */
const ENGINES_WITH_TLS_SWITCH = ["postgresql", "mysql", "redis", "mongodb"];
/* Receivers whose default resource attributes include the database host's name. */
const ENGINES_REPORTING_HOST_NAME = ["sqlserver", "oracledb"];
const COLLECTOR = /otel\/opentelemetry-collector-contrib:(\d+\.\d+\.\d+)/g;
const OPTIONAL_ID_STATEMENTS = [
  'set(resource.attributes["oneuptime.database.server.id"], "${env:DATABASE_SERVER_ID}")',
  'delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""',
];
/*
 * Query events get a message: the query text, else the event's name — and
 * only when the record has no body of its own. DatabaseAgentQueryEventBody
 * Runtime.test.js runs these statements in the real collector.
 */
const QUERY_EVENT_BODY_PROCESSOR = "transform/query_event_body";
const QUERY_EVENT_BODY_STATEMENTS = [
  'set(log.body, log.attributes["db.query.text"]) where (log.body == nil or log.body == "") and log.attributes["db.query.text"] != nil and log.attributes["db.query.text"] != ""',
  'set(log.body, log.event_name) where (log.body == nil or log.body == "") and log.event_name != ""',
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function configText(engine) {
  return read(`${AGENT_DIR}/configs/${engine}.yaml`);
}

function config(engine) {
  return yaml.load(configText(engine));
}

function composePin() {
  const pins = [...read(`${AGENT_DIR}/docker-compose.yml`).matchAll(COLLECTOR)];
  expect(pins).toHaveLength(1);
  return pins[0][1];
}

function composeEnvironment() {
  const compose = yaml.load(read(`${AGENT_DIR}/docker-compose.yml`));
  return compose.services["oneuptime-database-agent"].environment.map(
    (entry) => {
      return entry.split("=")[0];
    },
  );
}

/*
 * The variables the OneUptime AI agent service reads from the same .env
 * (`NAME=${NAME...}`), leaving out the ones the compose file fixes itself
 * (its resource type).
 */
function aiAgentEnvironmentFromDotenv() {
  const compose = yaml.load(read(`${AGENT_DIR}/docker-compose.yml`));
  return compose.services["oneuptime-database-ai-agent"].environment
    .filter((entry) => {
      const [name, value] = entry.split(/=(.*)/s);
      return value.startsWith(`\${${name}`);
    })
    .map((entry) => {
      return entry.split("=")[0];
    });
}

/* The body of a shell function `name() { ... }` in a script. */
function shellFunction(script, name) {
  const match = script.match(
    new RegExp(`\\n${name}\\(\\) \\{([\\s\\S]*?)\\n\\}`),
  );
  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });
  return match[1];
}

/* A case table's `pattern|pattern) printf 'value' ;;` rows: input → value. */
function caseTable(script, name) {
  const table = new Map();
  for (const row of shellFunction(script, name).matchAll(
    /^\s+([a-z0-9._|]+)\) printf '([a-z0-9._]+)' ;;$/gm,
  )) {
    for (const input of row[1].split("|")) {
      table.set(input, row[2]);
    }
  }
  return table;
}

/* The distinct values a case table prints. */
function caseOutputs(script, name) {
  return [...new Set(caseTable(script, name).values())].sort();
}

function resourceAttribute(engine, key) {
  return config(engine).processors.resource.attributes.find((attribute) => {
    return attribute.key === key;
  });
}

describe.each(ENGINES)("the %s config", (engine) => {
  test("runs the engine's own receiver in every pipeline, and only PostgreSQL's SQL checks beside it", () => {
    const parsed = config(engine);

    /*
     * One engine, one server: the resource processor stamps one identity on
     * everything a pipeline carries. PostgreSQL's config also reads what its
     * receiver does not report (a restart, transaction ID wraparound, long
     * transactions, lock waits) with the collector's sqlquery receiver -
     * the same server over the same login, in the metrics pipeline only.
     */
    const extra = engine === "postgresql" ? ["sqlquery/oneuptime"] : [];

    expect(Object.keys(parsed.receivers)).toEqual([engine, ...extra]);

    for (const [name, pipeline] of Object.entries(parsed.service.pipelines)) {
      expect({ name, receivers: pipeline.receivers }).toEqual({
        name,
        receivers: name === "metrics" ? [engine, ...extra] : [engine],
      });
    }
  });

  test("upserts the database's identity and the agent's marker", () => {
    /*
     * The engine comes from DATABASE_SYSTEM, not from the file: one config
     * monitors a family (mysql.yaml runs MySQL and MariaDB), and the
     * database must show the engine the user named.
     */
    expect(resourceAttribute(engine, "db.system.name")).toEqual({
      key: "db.system.name",
      value: "${env:DATABASE_SYSTEM}",
      action: "upsert",
    });
    expect(resourceAttribute(engine, "server.address")).toEqual({
      key: "server.address",
      value: "${env:DATABASE_SERVER_ADDRESS}",
      action: "upsert",
    });
    expect(resourceAttribute(engine, "server.port")).toEqual({
      key: "server.port",
      value: "${env:DATABASE_SERVER_PORT}",
      action: "upsert",
    });
    expect(resourceAttribute(engine, "oneuptime.database.agent")).toEqual({
      key: "oneuptime.database.agent",
      value: "true",
      action: "upsert",
    });
    /*
     * The files' own version: the collector release the compose file pins,
     * its last number raised each time the files change on that collector
     * (Common's AgentFilesVersion pins which), and the same in every config.
     */
    const stamp = resourceAttribute(engine, "oneuptime.agent.version");
    expect({ key: stamp.key, action: stamp.action }).toEqual({
      key: "oneuptime.agent.version",
      action: "upsert",
    });
    const [pinMajor, pinMinor, pinPatch] = composePin().split(".").map(Number);
    const [major, minor, patch] = stamp.value.split(".").map(Number);
    expect([major, minor]).toEqual([pinMajor, pinMinor]);
    expect(patch).toBeGreaterThanOrEqual(pinPatch);
    expect(stamp.value).toBe(
      resourceAttribute("postgresql", "oneuptime.agent.version").value,
    );
  });

  test("keeps server.port an integer and the marker a string", () => {
    const text = configText(engine);

    // Unquoted, so the collector resolves the variable to an int.
    expect(text).toMatch(
      /- key: server\.port\n\s+value: \$\{env:DATABASE_SERVER_PORT\}\n/,
    );
    // Quoted, so YAML does not turn it into a boolean.
    expect(text).toMatch(
      /- key: oneuptime\.database\.agent\n\s+value: "true"\n/,
    );
  });

  test("deletes service.name and stamps nothing that names another resource", () => {
    const attributes = config(engine).processors.resource.attributes;

    expect(
      attributes.find((attribute) => {
        return attribute.key === "service.name";
      }),
    ).toEqual({ key: "service.name", action: "delete" });

    for (const attribute of attributes) {
      expect({
        key: attribute.key,
        foreign: /^(k8s|host|os|container|cloud)\./.test(attribute.key),
      }).toEqual({ key: attribute.key, foreign: false });
    }

    expect(configText(engine)).not.toMatch(/attributes\["k8s\./);
  });

  test("sets oneuptime.database.server.id only when DATABASE_SERVER_ID is not blank, on metrics and logs", () => {
    const transform = config(engine).processors["transform/optional_identity"];

    expect(transform.metric_statements).toEqual(OPTIONAL_ID_STATEMENTS);
    expect(transform.log_statements).toEqual(OPTIONAL_ID_STATEMENTS);
    expect(
      resourceAttribute(engine, "oneuptime.database.server.id"),
    ).toBeUndefined();
  });

  test("has no resourcedetection processor anywhere", () => {
    const parsed = config(engine);

    for (const name of Object.keys(parsed.processors)) {
      expect(name.startsWith("resourcedetection")).toBe(false);
    }

    for (const pipeline of Object.values(parsed.service.pipelines)) {
      for (const name of pipeline.processors) {
        expect(name.startsWith("resourcedetection")).toBe(false);
      }
    }
  });

  test("limits memory first, stamps before the optional id, and batches last", () => {
    for (const [name, pipeline] of Object.entries(
      config(engine).service.pipelines,
    )) {
      expect({ name, processors: pipeline.processors }).toEqual({
        name,
        processors:
          name === "logs"
            ? [
                "memory_limiter",
                "resource",
                "transform/optional_identity",
                QUERY_EVENT_BODY_PROCESSOR,
                "batch",
              ]
            : [
                "memory_limiter",
                "resource",
                "transform/optional_identity",
                "batch",
              ],
      });
    }
  });

  /*
   * The receivers emit query samples and top queries with an EMPTY body and
   * the query in db.query.text, so the Logs tab showed "{}" as the message
   * of every one (e2e: 202,246 postgresql and 42,320 mysql rows with body
   * '{}', db.query.text e.g. 'SELECT ? AS ok' and 'SHOW GLOBAL STATUS').
   * The logs pipeline copies the query into the body; a record that
   * already has one — a filelog line — keeps it.
   */
  test("gives query events their query text as the message, in the logs pipeline only", () => {
    const parsed = config(engine);
    const transform = parsed.processors[QUERY_EVENT_BODY_PROCESSOR];

    if (ENGINES_WITH_QUERY_EVENTS.includes(engine)) {
      expect(transform).toEqual({
        error_mode: "ignore",
        log_statements: QUERY_EVENT_BODY_STATEMENTS,
      });
      expect(parsed.service.pipelines.logs.processors).toContain(
        QUERY_EVENT_BODY_PROCESSOR,
      );
    } else {
      expect(transform).toBeUndefined();
    }
    expect(parsed.service.pipelines.metrics.processors).not.toContain(
      QUERY_EVENT_BODY_PROCESSOR,
    );
  });

  test("exports to OneUptime's OTLP endpoint with the ingestion key, and nowhere else", () => {
    const parsed = config(engine);

    expect(parsed.exporters).toEqual({
      otlphttp: {
        endpoint: "${env:ONEUPTIME_URL}/otlp",
        headers: {
          "x-oneuptime-token": "${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}",
        },
      },
    });

    for (const pipeline of Object.values(parsed.service.pipelines)) {
      expect(pipeline.exporters).toEqual(["otlphttp"]);
    }
  });

  test("leaves the TLS flags and the event toggles unquoted, so they resolve to booleans", () => {
    const text = configText(engine);

    if (ENGINES_WITH_TLS_SWITCH.includes(engine)) {
      expect(text).toMatch(/^\s+insecure: \$\{env:DATABASE_TLS_INSECURE\}$/m);
    } else {
      // TLS is chosen elsewhere (the URL's scheme, the driver) or absent.
      expect(text).not.toMatch(/\$\{env:DATABASE_TLS_INSECURE\}/);
    }
    if (
      engine === "sqlserver" ||
      engine === "oracledb" ||
      engine === "memcached"
    ) {
      expect(text).not.toMatch(/DATABASE_TLS_INSECURE_SKIP_VERIFY/);
    } else {
      expect(text).toMatch(
        /^\s+insecure_skip_verify: \$\{env:DATABASE_TLS_INSECURE_SKIP_VERIFY\}$/m,
      );
    }
    expect(text).not.toMatch(/"\$\{env:DATABASE_TLS_INSECURE/);
    expect(text).not.toMatch(/"\$\{env:DATABASE_QUERY_EVENTS\}"/);
    // A port field is an integer: unquoted, like server.port.
    expect(text).not.toMatch(/"\$\{env:DATABASE_ENDPOINT_PORT\}"/);
  });

  test("switches off a receiver-reported host.name, which would name the database machine as a Host", () => {
    const attributes =
      config(engine).receivers[engine].resource_attributes || {};

    if (ENGINES_REPORTING_HOST_NAME.includes(engine)) {
      expect(attributes["host.name"]).toEqual({ enabled: false });
    } else {
      expect(attributes["host.name"]).toBeUndefined();
    }
  });

  test("needs no login it cannot use, and never logs one in over an unexpanded placeholder", () => {
    const receiver = config(engine).receivers[engine];

    if (engine === "memcached") {
      // The receiver has no credentials; it must run over TCP.
      expect(receiver.username).toBeUndefined();
      expect(receiver.password).toBeUndefined();
      expect(receiver.transport).toBe("tcp");
    } else {
      expect(receiver.username).toBe("${env:DATABASE_USERNAME}");
      expect(receiver.password).toBe("${env:DATABASE_PASSWORD}");
    }
  });

  test("ships query events only where the receiver has them, behind DATABASE_QUERY_EVENTS", () => {
    const parsed = config(engine);
    const receiver = parsed.receivers[engine];

    if (ENGINES_WITH_QUERY_EVENTS.includes(engine)) {
      expect(receiver.events).toEqual({
        "db.server.query_sample": { enabled: "${env:DATABASE_QUERY_EVENTS}" },
        "db.server.top_query": { enabled: "${env:DATABASE_QUERY_EVENTS}" },
      });
      expect(Object.keys(parsed.service.pipelines).sort()).toEqual([
        "logs",
        "metrics",
      ]);
    } else {
      expect(receiver.events).toBeUndefined();
      expect(Object.keys(parsed.service.pipelines)).toEqual(["metrics"]);
    }
  });

  test("turns on the receiver's own server.address / server.port where they are off upstream", () => {
    const attributes = config(engine).receivers[engine].resource_attributes;

    if (ENGINES_NEEDING_ADDRESS_ATTRIBUTES.includes(engine)) {
      expect(attributes["server.address"]).toEqual({ enabled: true });
      expect(attributes["server.port"]).toEqual({ enabled: true });
    }
  });

  test("reads only variables docker-compose.yml passes", () => {
    const passed = new Set(composeEnvironment());

    for (const match of configText(engine).matchAll(
      /\$\{env:([A-Z][A-Z0-9_]*)\}/g,
    )) {
      expect({ name: match[1], passed: passed.has(match[1]) }).toEqual({
        name: match[1],
        passed: true,
      });
    }
  });
});

describe("the Database Agent install", () => {
  test("docker-compose.yml runs the pinned collector under a compose-derived name", () => {
    const compose = yaml.load(read(`${AGENT_DIR}/docker-compose.yml`));
    const service = compose.services["oneuptime-database-agent"];

    expect(Object.keys(compose.services)).toEqual([
      "oneuptime-database-agent",
      "oneuptime-database-ai-agent",
    ]);
    expect(service.image).toBe(
      `otel/opentelemetry-collector-contrib:${composePin()}`,
    );
    // One agent per database: several copies on one machine must not clash.
    expect(service.container_name).toBeUndefined();
    expect(service.volumes).toContain(
      "./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro",
    );
  });

  test("the OneUptime AI agent runs beside it: unprivileged, read-only, the same .env and database", () => {
    const compose = yaml.load(read(`${AGENT_DIR}/docker-compose.yml`));
    const service = compose.services["oneuptime-database-ai-agent"];
    const environment = Object.fromEntries(
      service.environment.map((entry) => {
        return entry.split(/=(.*)/s).slice(0, 2);
      }),
    );

    expect(service.image).toBe("oneuptime/resource-ai-agent:release");
    // One agent per database, like the collector: no fixed container name.
    expect(service.container_name).toBeUndefined();
    expect(service.user).toBe("1000:1000");
    expect(service.read_only).toBe(true);
    expect(service.tmpfs).toEqual(["/tmp"]);
    expect(service.cap_drop).toEqual(["ALL"]);
    expect(service.extra_hosts).toEqual(
      compose.services["oneuptime-database-agent"].extra_hosts,
    );
    expect(service.volumes).toBeUndefined();
    expect(environment.ONEUPTIME_AI_AGENT_RESOURCE_TYPE).toBe("database");
    // Read-only unless the .env says otherwise.
    expect(environment.ONEUPTIME_AI_ALLOW_WRITES).toBe(
      "${ONEUPTIME_AI_ALLOW_WRITES:-false}",
    );

    // Every connection and identity variable the collector reads, the same way.
    const collector = Object.fromEntries(
      compose.services["oneuptime-database-agent"].environment.map((entry) => {
        return entry.split(/=(.*)/s).slice(0, 2);
      }),
    );
    for (const name of [
      "ONEUPTIME_URL",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "DATABASE_SYSTEM",
      "DATABASE_ENDPOINT",
      "DATABASE_ENDPOINT_HOST",
      "DATABASE_ENDPOINT_PORT",
      "DATABASE_SERVER_ADDRESS",
      "DATABASE_SERVER_PORT",
      "DATABASE_SERVER_ID",
      "DATABASE_USERNAME",
      "DATABASE_PASSWORD",
      "DATABASE_TLS_INSECURE",
      "DATABASE_TLS_INSECURE_SKIP_VERIFY",
    ]) {
      expect({ name, value: environment[name] }).toEqual({
        name,
        value: collector[name],
      });
    }
  });

  test("the optional id defaults to blank rather than to an unset variable", () => {
    expect(read(`${AGENT_DIR}/docker-compose.yml`)).toContain(
      "- DATABASE_SERVER_ID=${DATABASE_SERVER_ID:-}",
    );
  });

  test("install.sh reuses and writes exactly the variables docker-compose.yml passes", () => {
    const script = read(`${AGENT_DIR}/install.sh`);
    const namesMatch = script.match(/^ENV_NAMES="([^"]+)"$/m);

    expect(namesMatch).not.toBeNull();

    const reused = namesMatch[1]
      .split(/[\s\\]+/)
      .filter(Boolean)
      .sort();
    const heredoc = script.match(/<<ENVEOF\n([\s\S]*?)\nENVEOF/);

    expect(heredoc).not.toBeNull();

    const written = [...heredoc[1].matchAll(/^([A-Z][A-Z0-9_]+)=/gm)]
      .map((match) => {
        return match[1];
      })
      .sort();
    const passed = [
      ...new Set([...composeEnvironment(), ...aiAgentEnvironmentFromDotenv()]),
    ].sort();

    expect(reused).toEqual(passed);
    expect(written).toEqual(passed);
  });

  test("install.sh downloads a config that exists for every engine it accepts", () => {
    const script = read(`${AGENT_DIR}/install.sh`);

    // From the OneUptime it reports to (/install/database-agent/configs/...).
    expect(script).toContain(
      'download_agent_file "configs/$AGENT_CONFIG.yaml" "$INSTALL_DIR/otel-collector-config.yaml"',
    );
    expect(script).toContain(
      'AGENT_CONFIG="$(config_for_engine "$DATABASE_SYSTEM")"',
    );

    const engines = caseOutputs(script, "normalize_engine");
    const configsByEngine = caseTable(script, "config_for_engine");

    // Every engine normalize_engine writes has a config, and every config
    // ships.
    for (const engine of engines) {
      expect({ engine, config: configsByEngine.get(engine) || null }).toEqual({
        engine,
        config: expect.any(String),
      });
    }
    const configs = [...new Set(configsByEngine.values())].sort();
    expect(configs).toEqual([...ENGINES].sort());
    for (const config of configs) {
      expect(
        fs.existsSync(
          path.join(REPO_ROOT, AGENT_DIR, "configs", `${config}.yaml`),
        ),
      ).toBe(true);
    }
    // And every engine a config serves is one normalize_engine can write.
    expect([...configsByEngine.keys()].sort()).toEqual([...engines].sort());
  });

  /*
   * troubleshoot.sh checks the installed config against DATABASE_SYSTEM
   * with its own copy of the engine → config table.
   */
  test("install.sh and troubleshoot.sh map every engine to the same config", () => {
    const installed = caseTable(
      read(`${AGENT_DIR}/install.sh`),
      "config_for_engine",
    );
    const troubleshoot = caseTable(
      read(`${AGENT_DIR}/troubleshoot.sh`),
      "config_for_engine",
    );

    expect(installed.size).toBeGreaterThan(8);
    expect([...troubleshoot.entries()].sort()).toEqual(
      [...installed.entries()].sort(),
    );
  });

  /*
   * troubleshoot.sh repeats install.sh's two host classifiers (each script
   * is downloaded on its own, so neither can source the other). Every
   * decision line — the ones that return — must match.
   */
  test("install.sh and troubleshoot.sh agree on which names can never identify a database", () => {
    const decisions = (file, name) => {
      const match = read(`${AGENT_DIR}/${file}`).match(
        new RegExp(`\\n${name}\\(\\) \\{([\\s\\S]*?)\\n\\}`),
      );
      expect({ file, name, found: Boolean(match) }).toEqual({
        file,
        name,
        found: true,
      });
      return match[1]
        .split("\n")
        .map((line) => {
          return line.trim();
        })
        .filter((line) => {
          return /\breturn [01]\b/.test(line);
        });
    };

    for (const name of ["is_local_only_host", "is_network_local_name"]) {
      const installed = decisions("install.sh", name);

      expect(installed.length).toBeGreaterThan(2);
      expect(decisions("troubleshoot.sh", name)).toEqual(installed);
    }
  });

  test("the systemd unit runs the install directory install.sh defaults to", () => {
    const script = read(`${AGENT_DIR}/install.sh`);
    const unit = read(`${AGENT_DIR}/systemd/oneuptime-database-agent.service`);
    const defaultDir = script.match(/INSTALL_DIR="\$\{INSTALL_DIR:-([^}]+)\}"/);

    expect(defaultDir).not.toBeNull();
    expect(unit).toContain(`WorkingDirectory=${defaultDir[1]}\n`);
  });
});

/*
 * PostgreSQL's SQL checks: what the postgresql receiver does not report,
 * read with the collector's sqlquery receiver over the same server and
 * login. Common's DatabaseAlertTemplates suite holds the four metrics to
 * the templates that read them; this holds the receiver to the agent's
 * own connection settings and to views the monitoring role can read.
 */
// A FROM followed by a name that is not a call (EXTRACT(EPOCH FROM max(...))).
const SQL_CHECK_RELATION = /\bFROM\s+([a-z_]+)\b(?!\s*\()/gi;
const SQL_CHECK_PORT_LINE = /\n\s+port: \$\{env:DATABASE_ENDPOINT_PORT\}\n/;

describe("the postgresql config's SQL checks", () => {
  const receiver = () => {
    return config("postgresql").receivers["sqlquery/oneuptime"];
  };

  test("connect to the agent's endpoint, with its login and its TLS mode, every collection interval", () => {
    const sql = receiver();

    expect(sql.driver).toBe("postgres");
    expect(sql.host).toBe("${env:DATABASE_ENDPOINT_HOST}");
    expect(sql.port).toBe("${env:DATABASE_ENDPOINT_PORT}");
    // The database the postgresql receiver connects to as well.
    expect(sql.database).toBe("postgres");
    expect(sql.username).toBe("${env:DATABASE_USERNAME}");
    expect(sql.password).toBe("${env:DATABASE_PASSWORD}");
    expect(sql.additional_params).toEqual({
      sslmode: "${env:DATABASE_TLS_SSLMODE}",
    });
    expect(sql.collection_interval).toBe(
      config("postgresql").receivers.postgresql.collection_interval,
    );
    // No datasource: a connection string would carry the password unescaped.
    expect(sql.datasource).toBeUndefined();
  });

  test("keep the port an integer field", () => {
    expect(configText("postgresql")).toMatch(SQL_CHECK_PORT_LINE);
  });

  test("read only the catalog views pg_monitor covers, never a table", () => {
    const [query, ...rest] = receiver().queries;

    expect(rest).toEqual([]);
    for (const view of [
      "pg_postmaster_start_time()",
      "pg_database",
      "pg_stat_activity",
    ]) {
      expect(query.sql).toContain(view);
    }
    const relations = [...query.sql.matchAll(SQL_CHECK_RELATION)].map(
      (match) => {
        return match[1];
      },
    );
    expect(relations.length).toBeGreaterThan(0);
    for (const relation of relations) {
      expect(["pg_database", "pg_stat_activity"]).toContain(relation);
    }
    // Its own session's transaction is never "the longest".
    expect(query.sql).toContain("pid <> pg_backend_pid()");
  });

  test("report four whole-number gauges, each in its unit", () => {
    const [query] = receiver().queries;

    expect(
      query.metrics.map((metric) => {
        return [
          metric.metric_name,
          metric.data_type,
          metric.value_type,
          metric.unit,
        ];
      }),
    ).toEqual([
      ["postgresql.uptime", "gauge", "int", "s"],
      ["postgresql.xid.oldest_age", "gauge", "int", "{transactions}"],
      ["postgresql.transaction.longest_duration", "gauge", "int", "s"],
      ["postgresql.sessions.waiting_on_lock", "gauge", "int", "{sessions}"],
    ]);
    for (const metric of query.metrics) {
      expect(query.sql).toContain(`AS ${metric.value_column}`);
    }
  });

  test("run in the metrics pipeline only, behind the same identity stamp", () => {
    const pipelines = config("postgresql").service.pipelines;

    expect(pipelines.metrics.receivers).toContain("sqlquery/oneuptime");
    expect(pipelines.logs.receivers).not.toContain("sqlquery/oneuptime");
    expect(pipelines.metrics.processors).toEqual(
      config("mysql").service.pipelines.metrics.processors,
    );
  });
});
