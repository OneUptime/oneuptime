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
  test("runs exactly one receiver instance, the engine's own, in every pipeline", () => {
    const parsed = config(engine);

    expect(Object.keys(parsed.receivers)).toEqual([engine]);

    for (const [name, pipeline] of Object.entries(parsed.service.pipelines)) {
      expect({ name, receivers: pipeline.receivers }).toEqual({
        name,
        receivers: [engine],
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
    expect(resourceAttribute(engine, "oneuptime.agent.version")).toEqual({
      key: "oneuptime.agent.version",
      value: composePin(),
      action: "upsert",
    });
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
        processors: [
          "memory_limiter",
          "resource",
          "transform/optional_identity",
          "batch",
        ],
      });
    }
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

    expect(Object.keys(compose.services)).toEqual(["oneuptime-database-agent"]);
    expect(service.image).toBe(
      `otel/opentelemetry-collector-contrib:${composePin()}`,
    );
    // One agent per database: several copies on one machine must not clash.
    expect(service.container_name).toBeUndefined();
    expect(service.volumes).toContain(
      "./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro",
    );
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
    const passed = [...composeEnvironment()].sort();

    expect(reused).toEqual(passed);
    expect(written).toEqual(passed);
  });

  test("install.sh downloads a config that exists for every engine it accepts", () => {
    const script = read(`${AGENT_DIR}/install.sh`);

    expect(script).toContain(
      'download_agent_file "$REPO_BASE/configs/$AGENT_CONFIG.yaml" "$INSTALL_DIR/otel-collector-config.yaml"',
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
