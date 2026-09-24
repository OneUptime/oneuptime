import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import {
  DATABASE_AGENT_COLLECTOR_IMAGE,
  DATABASE_AGENT_CONFIGS,
  DATABASE_AGENT_DOCKER_COMPOSE,
  DATABASE_AGENT_ENGINES,
  DatabaseAgentEngine,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseAgentConfigs";
import {
  DATABASE_HEALTH_MONITOR_SYSTEMS,
  DatabaseAgentIdentity,
  DatabaseDocumentationTarget,
  getDatabaseAgentEndpoint,
  getDatabaseAgentEngine,
  getDatabaseAgentEngineLabel,
  getDatabaseAgentEnvFile,
  getDatabaseAgentInstallationMarkdown,
  getDatabaseAgentKubernetesManifest,
  getDatabaseAgentSystem,
  getDatabaseAgentSystems,
  getDatabaseHealthMonitorCreateUrl,
  getDatabaseOwnCollectorMarkdown,
  getDatabaseProbeEndpoint,
  resolveDatabaseAgentIdentity,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationMarkdown";
import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
  getCollectorReceiverComponentName,
} from "../../../Types/DatabaseServer/DatabaseSystem";
import {
  canonicalizeDatabaseEndpoint,
  DatabaseEndpoint,
  getDatabaseEndpointScope,
} from "../../../Types/DatabaseServer/DatabaseEndpoint";
import {
  DatabaseAlertTemplate,
  getDatabaseAlertTemplates,
} from "../../../Types/Monitor/DatabaseAlertTemplates";
import MonitorType from "../../../Types/Monitor/MonitorType";
import SeriesResourceLabels from "../../../Server/Utils/Monitor/SeriesResourceLabels";

/*
 * The in-app Database Agent guide. The agent is config-only, so a guide that
 * shows a paraphrase of the config — or an .env that names a variable the
 * compose file does not pass through — installs an agent that silently
 * reports nothing (or reports under the wrong identity). These tests hold the
 * embedded copies byte-identical to agents/DatabaseAgent and pin the values
 * a row's Documentation tab prefills. For the engines the agent ships no
 * config for, they hold the "your own collector" guide to the engine
 * catalog: every engine with a receiver or a metrics endpoint gets a
 * complete, well-formed collector config, and "no engine metrics" is said
 * only of an engine that runs inside the application.
 */

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..", "..", "..");
const AGENT_DIR: string = path.join(REPO_ROOT, "agents", "DatabaseAgent");
const MARKDOWN_SOURCE: string = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "packages",
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Pages",
    "Database",
    "Utils",
    "DocumentationMarkdown.ts",
  ),
  "utf8",
);

const URL: string = "https://oneuptime.example.com";
const KEY: string = "ingest-key-123";
const DATABASE_ID: string = "3c1e9a52-1f2b-4c3d-9e8f-0a1b2c3d4e5f";

function readAgentFile(...segments: Array<string>): string {
  return fs.readFileSync(path.join(AGENT_DIR, ...segments), "utf8");
}

/* Environment variable names the compose file passes to the collector. */
function composeVariables(): Set<string> {
  return new Set<string>(
    Array.from(
      readAgentFile("docker-compose.yml").matchAll(/^\s*-\s*([A-Z_]+)=\$\{/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    }),
  );
}

/* Fenced code blocks of some markdown, with their info string. */
function codeBlocks(
  markdown: string,
): Array<{ language: string; body: string }> {
  const blocks: Array<{ language: string; body: string }> = [];
  let current: { language: string; lines: Array<string> } | null = null;

  for (const line of markdown.split("\n")) {
    const fence: RegExpMatchArray | null = line.match(/^```(\S*)\s*$/);
    if (fence) {
      if (current) {
        blocks.push({
          language: current.language,
          body: current.lines.join("\n"),
        });
        current = null;
      } else {
        current = { language: fence[1] || "", lines: [] };
      }
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }

  expect(current).toBeNull();
  return blocks;
}

function rowFor(
  descriptor: DatabaseSystemDescriptor,
): DatabaseDocumentationTarget {
  return {
    id: DATABASE_ID,
    dbSystem: descriptor.system,
    serverAddress: "db.prod.example.com",
    serverPort: descriptor.defaultPort,
  };
}

/* A row's Documentation tab, as DocumentationCard picks it. */
function guideFor(database: DatabaseDocumentationTarget): string {
  const engine: DatabaseAgentEngine | null = getDatabaseAgentEngine(
    database.dbSystem,
  );
  return engine
    ? getDatabaseAgentInstallationMarkdown({
        oneuptimeUrl: URL,
        apiKey: KEY,
        engine: engine,
        system: database.dbSystem,
        database: database,
      })
    : getDatabaseOwnCollectorMarkdown({
        oneuptimeUrl: URL,
        apiKey: KEY,
        database: database,
      });
}

describe("the embedded agent files are the shipped ones", () => {
  test("one embedded config per shipped configs/*.yaml, and nothing else", () => {
    const shipped: Array<string> = fs
      .readdirSync(path.join(AGENT_DIR, "configs"))
      .filter((file: string): boolean => {
        return file.endsWith(".yaml");
      })
      .map((file: string): string => {
        return file.replace(/\.yaml$/, "");
      })
      .sort();

    expect([...DATABASE_AGENT_ENGINES].sort()).toEqual(shipped);
    expect(Object.keys(DATABASE_AGENT_CONFIGS).sort()).toEqual(shipped);
  });

  test.each([...DATABASE_AGENT_ENGINES])(
    "configs/%s.yaml is embedded byte for byte",
    (engine: DatabaseAgentEngine) => {
      expect(DATABASE_AGENT_CONFIGS[engine]).toBe(
        readAgentFile("configs", `${engine}.yaml`),
      );
    },
  );

  test("docker-compose.yml is embedded byte for byte", () => {
    expect(DATABASE_AGENT_DOCKER_COMPOSE).toBe(
      readAgentFile("docker-compose.yml"),
    );
  });

  test("the collector image is the compose file's pin", () => {
    const match: RegExpMatchArray | null = readAgentFile(
      "docker-compose.yml",
    ).match(/^\s*image:\s*(\S+)\s*$/m);

    expect(match).not.toBeNull();
    expect(DATABASE_AGENT_COLLECTOR_IMAGE).toBe(match![1]);
  });

  test("every config is named after the receiver it runs", () => {
    for (const engine of DATABASE_AGENT_ENGINES) {
      expect(DATABASE_AGENT_CONFIGS[engine]).toContain(
        `\nreceivers:\n  ${engine}:\n`,
      );
    }
  });
});

describe("getDatabaseAgentEngine", () => {
  test.each([
    ["postgresql", "postgresql"],
    ["postgres", "postgresql"],
    ["mysql", "mysql"],
    ["mariadb", "mysql"],
    ["percona", "mysql"],
    ["Redis", "redis"],
    ["valkey", "redis"],
    ["keydb", "redis"],
    ["dragonflydb", "redis"],
    ["mongodb", "mongodb"],
    ["microsoft.sql_server", "sqlserver"],
    ["mssql", "sqlserver"],
    ["oracle", "oracledb"],
    ["elasticsearch", "elasticsearch"],
    ["opensearch", "elasticsearch"],
    ["memcached", "memcached"],
  ])("a %s row runs configs/%s.yaml", (dbSystem: string, engine: string) => {
    expect(getDatabaseAgentEngine(dbSystem)).toBe(engine);
  });

  test("is null for an engine the agent ships no config for", () => {
    for (const dbSystem of [
      "sqlite",
      "tidb",
      "cockroachdb",
      "clickhouse",
      "sap.hana",
      "snowflake",
      "couchdb",
      "acmedb",
      "",
    ]) {
      expect({ dbSystem, engine: getDatabaseAgentEngine(dbSystem) }).toEqual({
        dbSystem,
        engine: null,
      });
    }
    expect(getDatabaseAgentEngine(undefined)).toBeNull();
    expect(getDatabaseAgentEngine(null)).toBeNull();
  });

  test("labels name every engine a config monitors", () => {
    expect(getDatabaseAgentEngineLabel("mysql")).toBe("MySQL / MariaDB");
    expect(getDatabaseAgentEngineLabel("redis")).toBe(
      "Redis / Valkey / KeyDB / Dragonfly",
    );
    expect(getDatabaseAgentEngineLabel("elasticsearch")).toBe(
      "Elasticsearch / OpenSearch",
    );
    expect(getDatabaseAgentEngineLabel("sqlserver")).toBe("SQL Server");
  });
});

describe("getDatabaseAgentSystem / getDatabaseAgentSystems", () => {
  test("a row keeps its own engine when the config monitors it", () => {
    expect(getDatabaseAgentSystem("mysql", "mariadb")).toBe("mariadb");
    expect(getDatabaseAgentSystem("redis", "Valkey")).toBe("valkey");
    expect(getDatabaseAgentSystem("sqlserver", "mssql")).toBe(
      "microsoft.sql_server",
    );
    expect(getDatabaseAgentSystem("elasticsearch", "opensearch")).toBe(
      "opensearch",
    );
  });

  test("otherwise the engine the config is named after", () => {
    expect(getDatabaseAgentSystem("mysql")).toBe("mysql");
    expect(getDatabaseAgentSystem("oracledb")).toBe("oracle.db");
    expect(getDatabaseAgentSystem("sqlserver", null)).toBe(
      "microsoft.sql_server",
    );
    // A row of another engine never leaks its name into this config.
    expect(getDatabaseAgentSystem("mysql", "postgresql")).toBe("mysql");
  });

  test("the product page offers every engine a shipped config monitors, forks included", () => {
    const systems: Array<string> = getDatabaseAgentSystems();

    expect([...systems].sort()).toEqual(
      [
        "dragonfly",
        "elasticsearch",
        "keydb",
        "mariadb",
        "memcached",
        "microsoft.sql_server",
        "mongodb",
        "mysql",
        "opensearch",
        "oracle.db",
        "postgresql",
        "redis",
        "valkey",
      ].sort(),
    );
    for (const system of systems) {
      expect(getDatabaseAgentEngine(system)).not.toBeNull();
    }
  });
});

describe("resolveDatabaseAgentIdentity", () => {
  test("the product page gets placeholders and the engine's default port", () => {
    const identity: DatabaseAgentIdentity =
      resolveDatabaseAgentIdentity("mysql");

    expect(identity).toEqual({
      serverAddress: "db.example.com",
      serverPort: 3306,
      endpoint: "db.example.com:3306",
      databaseId: "",
      isPrefilled: false,
    });
  });

  test("a row uses its serverAddress / serverPort", () => {
    expect(
      resolveDatabaseAgentIdentity("postgresql", {
        id: DATABASE_ID,
        serverAddress: "DB.Prod.Internal",
        serverPort: 6432,
      }),
    ).toEqual({
      serverAddress: "db.prod.internal",
      serverPort: 6432,
      endpoint: "db.prod.internal:6432",
      databaseId: DATABASE_ID,
      isPrefilled: true,
    });
  });

  test("without an address, the first parseable endpoint (cluster qualifier dropped)", () => {
    const identity: DatabaseAgentIdentity = resolveDatabaseAgentIdentity(
      "postgresql",
      {
        id: DATABASE_ID,
        endpoints: [
          "localhost:5432",
          "postgres.payments.svc.cluster.local:5432@prod",
        ],
        kubernetesNamespace: "payments",
      },
    );

    expect(identity.serverAddress).toBe("postgres.payments.svc.cluster.local");
    expect(identity.serverPort).toBe(5432);
    expect(identity.endpoint).toBe("postgres.payments.svc.cluster.local:5432");
    expect(identity.isPrefilled).toBe(true);
  });

  test("brackets an IPv6 address in the endpoint", () => {
    expect(
      resolveDatabaseAgentIdentity("postgresql", {
        id: DATABASE_ID,
        serverAddress: "2001:db8::10",
        serverPort: 5432,
      }).endpoint,
    ).toBe("[2001:db8::10]:5432");
  });

  test("an unknown engine without a port leaves the port out", () => {
    const identity: DatabaseAgentIdentity = resolveDatabaseAgentIdentity(
      "someengine",
      { id: DATABASE_ID, serverAddress: "db.example.com" },
    );
    expect(identity.serverPort).toBeNull();
    expect(identity.endpoint).toBe("db.example.com");
  });

  test("the agent's endpoint is a URL for the elasticsearch receiver only", () => {
    const identity: DatabaseAgentIdentity = resolveDatabaseAgentIdentity(
      "opensearch",
      { id: DATABASE_ID, serverAddress: "search.prod.example.com" },
    );

    expect(getDatabaseAgentEndpoint("elasticsearch", identity)).toBe(
      "http://search.prod.example.com:9200",
    );
    expect(getDatabaseAgentEndpoint("postgresql", identity)).toBe(
      "search.prod.example.com:9200",
    );
  });
});

describe("the .env file", () => {
  test("interpolates the viewer's URL and key and single-quotes the password", () => {
    const env: string = getDatabaseAgentEnvFile({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "postgresql",
      identity: resolveDatabaseAgentIdentity("postgresql", {
        id: DATABASE_ID,
        serverAddress: "db.prod.internal",
        serverPort: 5432,
      }),
    });

    expect(env.split("\n")).toEqual([
      `ONEUPTIME_URL=${URL}`,
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`,
      "DATABASE_SYSTEM=postgresql",
      "DATABASE_ENDPOINT=db.prod.internal:5432",
      "DATABASE_ENDPOINT_HOST=db.prod.internal",
      "DATABASE_ENDPOINT_PORT=5432",
      "DATABASE_ORACLE_SERVICE=",
      "DATABASE_SERVER_ADDRESS=db.prod.internal",
      "DATABASE_SERVER_PORT=5432",
      "DATABASE_USERNAME=oneuptime_monitor",
      "DATABASE_PASSWORD='a-strong-password'",
      "DATABASE_TLS_INSECURE=true",
      "DATABASE_TLS_INSECURE_SKIP_VERIFY=false",
      "DATABASE_COLLECTION_INTERVAL=30s",
      "DATABASE_QUERY_EVENTS=false",
      `DATABASE_SERVER_ID=${DATABASE_ID}`,
    ]);
  });

  test("a fork reports itself: a MariaDB row's .env says mariadb and runs the mysql config", () => {
    const env: string = getDatabaseAgentEnvFile({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "mysql",
      system: "mariadb",
      identity: resolveDatabaseAgentIdentity("mariadb"),
    });

    expect(env).toContain("\nDATABASE_SYSTEM=mariadb\n");
  });

  test("per-engine shapes: SQL Server host/port, Oracle service, Elasticsearch URL, Memcached no login", () => {
    const sqlserver: string = getDatabaseAgentEnvFile({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "sqlserver",
      identity: resolveDatabaseAgentIdentity("microsoft.sql_server", {
        id: DATABASE_ID,
        serverAddress: "sql.prod.internal",
      }),
    });
    expect(sqlserver).toContain("\nDATABASE_SYSTEM=microsoft.sql_server\n");
    expect(sqlserver).toContain("\nDATABASE_ENDPOINT_HOST=sql.prod.internal\n");
    expect(sqlserver).toContain("\nDATABASE_ENDPOINT_PORT=1433\n");

    const oracle: string = getDatabaseAgentEnvFile({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "oracledb",
      identity: resolveDatabaseAgentIdentity("oracle.db"),
    });
    expect(oracle).toContain("\nDATABASE_ORACLE_SERVICE=FREEPDB1\n");
    expect(oracle).toContain("\nDATABASE_ENDPOINT=db.example.com:1521\n");

    const search: string = getDatabaseAgentEnvFile({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "elasticsearch",
      identity: resolveDatabaseAgentIdentity("elasticsearch"),
    });
    expect(search).toContain(
      "\nDATABASE_ENDPOINT=http://db.example.com:9200\n",
    );
    expect(search).toContain("\nDATABASE_ENDPOINT_HOST=db.example.com\n");

    const memcached: string = getDatabaseAgentEnvFile({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "memcached",
      identity: resolveDatabaseAgentIdentity("memcached"),
    });
    expect(memcached).toContain("\nDATABASE_USERNAME=\n");
    expect(memcached).toContain("\nDATABASE_PASSWORD=\n");
  });

  test("Redis leaves the username empty (requirepass-only servers)", () => {
    const env: string = getDatabaseAgentEnvFile({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "redis",
      identity: resolveDatabaseAgentIdentity("redis"),
    });
    expect(env).toContain("\nDATABASE_USERNAME=\n");
    expect(env).toContain("DATABASE_SERVER_PORT=6379");
    expect(env).toContain("\nDATABASE_SERVER_ID=");
  });

  test.each([...DATABASE_AGENT_ENGINES])(
    "the %s .env names exactly the variables the compose file passes to the collector",
    (engine: DatabaseAgentEngine) => {
      const passed: Set<string> = composeVariables();
      const env: string = getDatabaseAgentEnvFile({
        oneuptimeUrl: URL,
        apiKey: KEY,
        engine: engine,
        identity: resolveDatabaseAgentIdentity(getDatabaseAgentSystem(engine)),
      });

      const named: Array<string> = env
        .split("\n")
        .map((line: string): string => {
          return line.split("=")[0]!;
        });
      expect(passed.size).toBeGreaterThan(12);
      expect(new Set(named)).toEqual(passed);
    },
  );
});

describe("the product-level guide", () => {
  const markdown: string = getDatabaseAgentInstallationMarkdown({
    oneuptimeUrl: URL,
    apiKey: KEY,
    engine: "mysql",
  });

  test("embeds the compose file and the selected engine's config verbatim", () => {
    expect(markdown).toContain(DATABASE_AGENT_DOCKER_COMPOSE.trimEnd());
    expect(markdown).toContain(DATABASE_AGENT_CONFIGS.mysql.trimEnd());
    expect(markdown).not.toContain(DATABASE_AGENT_CONFIGS.postgresql.trimEnd());
  });

  test("shows the MySQL grants and nothing about the other engines' logins", () => {
    expect(markdown).toContain(
      "GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_monitor'@'%';",
    );
    expect(markdown).toContain("SLAVE MONITOR");
    expect(markdown).not.toContain("GRANT pg_monitor");
    expect(markdown).not.toContain("ACL SETUSER");
  });

  test("has no row block, no alerting section, an empty DATABASE_SERVER_ID and no Kubernetes manifest", () => {
    expect(markdown).not.toContain("## This database");
    expect(markdown).not.toContain("## Alert on this database");
    expect(markdown).toContain("\nDATABASE_SERVER_ID=\n");
    expect(markdown).not.toContain("kind: Deployment");
    expect(markdown).toContain("DATABASE_SYSTEM=mysql bash install.sh");
  });

  test("picking a fork on the product page installs it under its own name", () => {
    const mariadb: string = getDatabaseAgentInstallationMarkdown({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "mysql",
      system: "mariadb",
    });

    expect(mariadb).toContain("DATABASE_SYSTEM=mariadb bash install.sh");
    expect(mariadb).toContain("collects MariaDB engine metrics");
    expect(mariadb).toContain(DATABASE_AGENT_CONFIGS.mysql.trimEnd());
  });

  test("never ships a placeholder key or URL, and never prints env references unescaped", () => {
    expect(markdown).toContain(`ONEUPTIME_URL=${URL}`);
    expect(markdown).toContain(`ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`);
    expect(MARKDOWN_SOURCE).not.toContain("<YOUR_API_KEY>");
    expect(MARKDOWN_SOURCE).not.toContain("your-telemetry-ingestion-key");
    // The embedded config keeps its ${env:...} references literally.
    expect(markdown).toContain('endpoint: "${env:DATABASE_ENDPOINT}"');
  });

  test("documents every agent environment variable", () => {
    for (const variable of composeVariables()) {
      expect(markdown).toContain(`| \`${variable}\` |`);
    }
  });

  test("tells a hand-written .env to double every $ in the password", () => {
    expect(markdown).toContain("write every `$` in it as `$$`");
    expect(markdown).not.toContain(
      "If the password contains `$`, `#`, spaces or quotes, single-quote it",
    );
  });

  test("offers the Database Health monitor for MySQL, with the link when given", () => {
    expect(markdown).toContain("Database Health monitor");
    const linked: string = getDatabaseAgentInstallationMarkdown({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "postgresql",
      databaseHealthMonitorUrl: "/dashboard/p1/monitors/create",
    });
    expect(linked).toContain(
      "[create a Database Health monitor](/dashboard/p1/monitors/create)",
    );
  });

  test("does not offer it for Redis or MongoDB", () => {
    for (const engine of ["redis", "mongodb"] as Array<DatabaseAgentEngine>) {
      expect(
        getDatabaseAgentInstallationMarkdown({
          oneuptimeUrl: URL,
          apiKey: KEY,
          engine: engine,
        }),
      ).not.toContain("Database Health monitor");
    }
    expect(DATABASE_HEALTH_MONITOR_SYSTEMS).toEqual([
      "postgresql",
      "mysql",
      "microsoft.sql_server",
    ]);
  });
});

describe("the monitoring-user grants match the agent's README", () => {
  const README_BLOCKS: Array<string> = codeBlocks(readAgentFile("README.md"))
    .filter((block: { language: string; body: string }): boolean => {
      return ["sql", "text", "js"].includes(block.language);
    })
    .map((block: { language: string; body: string }): string => {
      return block.body;
    });

  test.each([...DATABASE_AGENT_ENGINES])(
    "the %s guide's grant blocks are the README's",
    (engine: DatabaseAgentEngine) => {
      const markdown: string = getDatabaseAgentInstallationMarkdown({
        oneuptimeUrl: URL,
        apiKey: KEY,
        engine: engine,
      });
      const section: string = markdown.substring(
        markdown.indexOf("## Create a monitoring user"),
        markdown.indexOf("## Quick Start — Install Script"),
      );

      for (const block of codeBlocks(section)) {
        expect({
          engine,
          inReadme: README_BLOCKS.includes(block.body),
        }).toEqual({ engine, inReadme: true });
      }
    },
  );

  /*
   * Regression: with pg_monitor and query events on, every EXPLAIN of a top
   * query failed with "permission denied", and nothing said why.
   */
  test("the PostgreSQL guide explains that plans need table access", () => {
    const markdown: string = getDatabaseAgentInstallationMarkdown({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "postgresql",
    });

    expect(markdown).toContain("explain plans additionally need `SELECT`");
    expect(markdown).toContain("`failed to explain`");
  });
});

describe("a database's own guide", () => {
  const database: DatabaseDocumentationTarget = {
    id: DATABASE_ID,
    name: "PostgreSQL db.prod.internal:5432",
    dbSystem: "postgresql",
    serverAddress: "db.prod.internal",
    serverPort: 5432,
  };

  test("prefills the identity and the id everywhere", () => {
    const markdown: string = getDatabaseAgentInstallationMarkdown({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "postgresql",
      database: database,
    });

    expect(markdown).toContain("## This database");
    expect(markdown).toContain(
      `| \`DATABASE_SERVER_ID\` | \`${DATABASE_ID}\` |`,
    );
    expect(markdown).toContain(`DATABASE_SERVER_ID=${DATABASE_ID}\n`);
    expect(markdown).toContain(
      `DATABASE_SYSTEM=postgresql DATABASE_SERVER_ADDRESS=db.prod.internal DATABASE_SERVER_PORT=5432 DATABASE_SERVER_ID=${DATABASE_ID} bash install.sh`,
    );
    expect(markdown).not.toContain("replace `db.example.com`");
  });

  /*
   * Regression: a row without an address (every Docker- or Podman-detected
   * database) got the placeholder address on the install
   * command line; install.sh took the placeholder as given instead of
   * asking for the real name, and the row claimed it.
   */
  test("a row without an address gets no placeholder address on the install command line", () => {
    const markdown: string = getDatabaseAgentInstallationMarkdown({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "postgresql",
      database: { id: DATABASE_ID, dbSystem: "postgresql" },
    });
    const command: string | undefined = markdown
      .split("\n")
      .find((line: string): boolean => {
        return line.endsWith(" bash install.sh");
      });

    expect(command).toBe(
      `DATABASE_SYSTEM=postgresql DATABASE_SERVER_ID=${DATABASE_ID} bash install.sh`,
    );
    // The samples keep the placeholder, and say to replace it.
    expect(markdown).toContain("replace `db.example.com`");
    expect(markdown).toContain("DATABASE_SERVER_ADDRESS=db.example.com");
    expect(markdown).toContain("the install script asks for the host name");
  });

  test("a fork's row installs under its own engine with its family's config", () => {
    const markdown: string = guideFor({
      id: DATABASE_ID,
      dbSystem: "valkey",
      serverAddress: "cache.prod.internal",
    });

    expect(markdown).toContain(
      `DATABASE_SYSTEM=valkey DATABASE_SERVER_ADDRESS=cache.prod.internal DATABASE_SERVER_PORT=6379 DATABASE_SERVER_ID=${DATABASE_ID} bash install.sh`,
    );
    expect(markdown).toContain("| `DATABASE_SYSTEM` | `valkey` |");
    expect(markdown).toContain(DATABASE_AGENT_CONFIGS.redis.trimEnd());
  });

  test("tells the reader how to alert on this database", () => {
    const markdown: string = getDatabaseAgentInstallationMarkdown({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "postgresql",
      database: database,
    });

    expect(markdown).toContain("## Alert on this database");
    expect(markdown).toContain(
      `\`oneuptime.database.server.id\` = \`${DATABASE_ID}\``,
    );
  });

  test("points at the row's Recommendations tab for an engine with recommended monitors", () => {
    const recommendationsUrl: string = `/dashboard/p1/databases/${DATABASE_ID}/recommendations`;
    const linked: string = getDatabaseAgentInstallationMarkdown({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "postgresql",
      database: database,
      recommendationsUrl: recommendationsUrl,
    });

    expect(linked).toContain(
      `The [Recommendations](${recommendationsUrl}) tab offers ready-made PostgreSQL monitors`,
    );
    expect(linked).toContain("To build your own, create a **Metrics** monitor");

    // Without a URL the tab is still named.
    expect(
      getDatabaseAgentInstallationMarkdown({
        oneuptimeUrl: URL,
        apiKey: KEY,
        engine: "postgresql",
        database: database,
      }),
    ).toContain(
      "The **Recommendations** tab offers ready-made PostgreSQL monitors",
    );

    // A fork gets its family receiver's set, under its own name.
    expect(
      guideFor({
        id: DATABASE_ID,
        dbSystem: "valkey",
        serverAddress: "cache.example.com",
      }),
    ).toContain("tab offers ready-made Valkey monitors");
  });

  // The guide says every recommended set has a check for metrics stopping.
  test("every engine with recommended monitors has an Engine Metrics Stopped check", () => {
    const engines: Array<string> = DATABASE_SYSTEMS.filter(
      (descriptor: DatabaseSystemDescriptor): boolean => {
        return getDatabaseAlertTemplates(descriptor.system).length > 0;
      },
    ).map((descriptor: DatabaseSystemDescriptor): string => {
      return descriptor.system;
    });

    expect(engines.length).toBeGreaterThan(0);

    for (const system of engines) {
      expect({
        system,
        hasStoppedCheck: getDatabaseAlertTemplates(system).some(
          (template: DatabaseAlertTemplate): boolean => {
            return template.name === "Engine Metrics Stopped";
          },
        ),
      }).toEqual({ system, hasStoppedCheck: true });
    }
  });

  test("never points at an empty Recommendations tab", () => {
    for (const system of ["clickhouse", "cockroachdb", "ibm.db2", "AcmeDB"]) {
      expect(getDatabaseAlertTemplates(system)).toEqual([]);

      const markdown: string = guideFor({
        id: DATABASE_ID,
        dbSystem: system,
        serverAddress: "db.example.com",
      });

      expect({
        system,
        recommends: markdown.includes("Recommendations"),
      }).toEqual({
        system,
        recommends: false,
      });
      expect(markdown).toContain(
        "Create a **Metrics** monitor over an engine metric and filter it on that attribute",
      );
    }

    // An engine the agent has no config for, with recommended monitors.
    expect(
      guideFor({
        id: DATABASE_ID,
        dbSystem: "couchdb",
        serverAddress: "couch.example.com",
      }),
    ).toContain("tab offers ready-made CouchDB monitors");
  });

  /*
   * Regression: the guide said a counter "needs a rate before it can be
   * alerted on", but monitors have no rate; the collector's
   * cumulativetodelta processor is what makes a counter thresholdable.
   */
  test("sends counters through cumulativetodelta, not a rate monitors do not have", () => {
    const markdown: string = getDatabaseAgentInstallationMarkdown({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "postgresql",
      database: database,
    });

    expect(markdown).toContain("`cumulativetodelta` processor");
    expect(markdown).toContain("monitors have no rate");
    expect(MARKDOWN_SOURCE).not.toContain("needs a rate");
  });

  test("a Kubernetes database gets the Deployment for its namespace", () => {
    const markdown: string = getDatabaseAgentInstallationMarkdown({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "postgresql",
      database: {
        id: DATABASE_ID,
        dbSystem: "postgresql",
        endpoints: ["postgres.payments.svc.cluster.local:5432@prod"],
        kubernetesNamespace: "payments",
        isKubernetes: true,
      },
    });

    expect(markdown).toContain("## Run the agent in Kubernetes");
    expect(markdown).toContain("kubectl -n payments create configmap");
    expect(markdown).toContain(
      "/agents/DatabaseAgent/configs/postgresql.yaml -o config.yaml",
    );
    expect(markdown).toContain("namespace: payments");
    expect(markdown).toContain(`value: "${DATABASE_ID}"`);
    expect(markdown).toContain("write every `$` in it as `$$`");
  });

  test("a non-Kubernetes database gets no manifest", () => {
    expect(
      getDatabaseAgentInstallationMarkdown({
        oneuptimeUrl: URL,
        apiKey: KEY,
        engine: "postgresql",
        database: database,
      }),
    ).not.toContain("kind: Deployment");
  });
});

describe("the Database Health monitor on a database's guide", () => {
  test("the create link opens the form with the Database Health type picked", () => {
    const url: string = getDatabaseHealthMonitorCreateUrl(
      "/dashboard/p1/monitors/create",
    );

    expect(url).toBe("/dashboard/p1/monitors/create?monitorType=Database");

    // The value the monitor-create page reads back is a monitor type it knows.
    const picked: string | null = new URLSearchParams(
      url.substring(url.indexOf("?")),
    ).get("monitorType");
    expect(picked).toBe(MonitorType.Database);
    expect(Object.values(MonitorType)).toContain(picked);

    // A route that already carries a query keeps it.
    expect(getDatabaseHealthMonitorCreateUrl("/create?a=1")).toBe(
      "/create?a=1&monitorType=Database",
    );
  });

  /*
   * Regression: the Documentation card linked the bare monitor-create page,
   * so "create a Database Health monitor" landed on the type picker.
   */
  test("the Documentation card prefills the type and links the row's Recommendations tab", () => {
    const card: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages/App/FeatureSet/Dashboard/src/Components/DatabaseServer/DocumentationCard.tsx",
      ),
      "utf8",
    );

    expect(card).toMatch(
      /getDatabaseHealthMonitorCreateUrl\(\s*RouteUtil\.populateRouteParams\(\s*RouteMap\[PageMap\.MONITOR_CREATE\]/,
    );
    expect(card).toContain(
      "RouteMap[PageMap.DATABASE_SERVER_VIEW_RECOMMENDATIONS]",
    );
    expect(card.match(/recommendationsUrl: recommendationsUrl,/g)?.length).toBe(
      2,
    );
    expect(
      card.match(/databaseHealthMonitorUrl: databaseHealthMonitorUrl,/g)
        ?.length,
    ).toBe(2);

    expect(
      getDatabaseAgentInstallationMarkdown({
        oneuptimeUrl: URL,
        apiKey: KEY,
        engine: "postgresql",
        databaseHealthMonitorUrl: getDatabaseHealthMonitorCreateUrl(
          "/dashboard/p1/monitors/create",
        ),
      }),
    ).toContain(
      "[create a Database Health monitor](/dashboard/p1/monitors/create?monitorType=Database)",
    );
  });

  test("getDatabaseProbeEndpoint picks the first endpoint a probe can name exactly", () => {
    expect(
      getDatabaseProbeEndpoint({
        id: DATABASE_ID,
        dbSystem: "postgresql",
        endpoints: [
          "postgres.payments.svc.cluster.local:5432@prod",
          "db.prod.internal:5432",
          "db.example.com:5432",
        ],
      }),
    ).toBe("db.prod.internal:5432");

    // A named instance carries no port for the probe form to hold.
    expect(
      getDatabaseProbeEndpoint({
        id: DATABASE_ID,
        dbSystem: "microsoft.sql_server",
        endpoints: ["sql1.corp\\inst01", "sql1.corp:14330"],
      }),
    ).toBe("sql1.corp:14330");

    expect(
      getDatabaseProbeEndpoint({
        id: DATABASE_ID,
        dbSystem: "postgresql",
        endpoints: ["postgres.payments.svc.cluster.local:5432@prod"],
      }),
    ).toBeNull();
    expect(
      getDatabaseProbeEndpoint({ id: DATABASE_ID, dbSystem: "postgresql" }),
    ).toBeNull();
    expect(getDatabaseProbeEndpoint(null)).toBeNull();
  });

  /*
   * The endpoint the guide tells the reader to point the probe at must be
   * the one the monitor's alerts are resolved by: a probe step's host and
   * port go through SeriesResourceLabels.buildDatabaseEndpointRef, and the
   * result is looked up among the database's endpoints verbatim.
   */
  test.each([
    ["postgresql", "db.prod.internal:5432"],
    ["mysql", "orders.example.com:3307"],
    ["microsoft.sql_server", "10.0.0.5:1433"],
  ])(
    "a %s probe at the endpoint the guide names resolves to that endpoint",
    (system: string, endpoint: string) => {
      const named: string | null = getDatabaseProbeEndpoint({
        id: DATABASE_ID,
        dbSystem: system,
        endpoints: [endpoint],
      });

      expect(named).toBe(endpoint);

      const separator: number = endpoint.lastIndexOf(":");
      expect(
        SeriesResourceLabels.buildDatabaseEndpointRef({
          address: endpoint.substring(0, separator),
          port: Number(endpoint.substring(separator + 1)),
          system: system,
        }),
      ).toBe(named);
    },
  );

  test("says which endpoint to connect to for the probe's alerts to land on the database", () => {
    const withEndpoint: string = guideFor({
      id: DATABASE_ID,
      dbSystem: "postgresql",
      serverAddress: "db.prod.internal",
      serverPort: 5432,
      endpoints: ["db.prod.internal:5432"],
    });
    expect(withEndpoint).toContain(
      "Point it at `db.prod.internal:5432`, one of this database's endpoints, and its alerts and incidents appear on this database's Alerts and Incidents tabs.",
    );

    const onlyQualified: string = guideFor({
      id: DATABASE_ID,
      dbSystem: "mysql",
      endpoints: ["mysql.shop.svc.cluster.local:3306@prod"],
      kubernetesNamespace: "shop",
      isKubernetes: true,
    });
    expect(onlyQualified).toContain(
      "written without an `@cluster` suffix — a probe reports no cluster.",
    );

    const productPage: string = getDatabaseAgentInstallationMarkdown({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "sqlserver",
    });
    expect(productPage).toContain(
      "Its alerts and incidents also appear on the database whose endpoints include the host and port it connects to.",
    );
  });
});

/*
 * Regression: the placeholder was `db.internal`, a `.internal` name — which
 * only resolves inside one network and never creates a database on its own —
 * so a sample copied as given never made the database it promised.
 */
describe("the placeholder identity", () => {
  test("is a name that creates its database", () => {
    const identity: DatabaseAgentIdentity =
      resolveDatabaseAgentIdentity("postgresql");
    const endpoint: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
      system: "postgresql",
      address: identity.serverAddress,
      port: identity.serverPort,
      caller: { isEphemeral: true },
      purpose: "collector",
    });

    expect(identity.isPrefilled).toBe(false);
    expect(endpoint).not.toBeNull();
    expect(getDatabaseEndpointScope(endpoint as DatabaseEndpoint)).toBe(
      "global",
    );
    expect(MARKDOWN_SOURCE).not.toContain("db.internal");
  });
});

describe("getDatabaseAgentKubernetesManifest", () => {
  const manifest: string = getDatabaseAgentKubernetesManifest({
    oneuptimeUrl: URL,
    engine: "redis",
    system: "valkey",
    identity: resolveDatabaseAgentIdentity("valkey", {
      id: DATABASE_ID,
      serverAddress: "redis-master.cache.svc.cluster.local",
    }),
    namespace: "cache",
  });

  test("runs the pinned collector image with the row's values", () => {
    expect(manifest).toContain(`image: ${DATABASE_AGENT_COLLECTOR_IMAGE}`);
    expect(manifest).toContain("namespace: cache");
    expect(manifest).toContain(`value: "${URL}"`);
    expect(manifest).toContain('value: "valkey"');
    expect(manifest).toContain(
      'value: "redis-master.cache.svc.cluster.local:6379"',
    );
    expect(manifest).toContain('value: "6379"');
    expect(manifest).toContain(`value: "${DATABASE_ID}"`);
    expect(manifest).toContain("mountPath: /etc/otelcol-contrib");
  });

  test("sets every variable the compose file passes", () => {
    const names: Array<string> = Array.from(
      manifest.matchAll(/^\s*- name: ([A-Z][A-Z0-9_]+)$/gm),
    )
      .map((match: RegExpMatchArray): string => {
        return match[1]!;
      })
      .sort();

    expect(names).toEqual([...composeVariables()].sort());
  });

  test("keeps secrets in a Secret and never stamps k8s.cluster.name", () => {
    expect(manifest).toContain("secretKeyRef:");
    expect(manifest).not.toContain(KEY);
    expect(manifest).not.toContain("k8s.cluster.name");
  });

  test("an empty namespace falls back to default", () => {
    expect(
      getDatabaseAgentKubernetesManifest({
        oneuptimeUrl: URL,
        engine: "redis",
        identity: resolveDatabaseAgentIdentity("redis"),
        namespace: "  ",
      }),
    ).toContain("namespace: default");
  });
});

/*
 * Every engine the catalog knows gets a guide on its Documentation tab.
 * Regression: engines with a contrib receiver (SAP HANA, Cloud Spanner) or
 * their own Prometheus endpoint (ClickHouse, CockroachDB, Neo4j, …) were
 * told "there is no OpenTelemetry Collector receiver … no engine metrics",
 * and SQL Server, Oracle, Elasticsearch and Memcached rows got only a
 * processor and an exporter, with no receiver and no pipeline.
 */
describe("every catalog engine's Documentation tab", () => {
  test.each(
    DATABASE_SYSTEMS.map((descriptor: DatabaseSystemDescriptor): string => {
      return descriptor.system;
    }),
  )(
    "%s gets a guide whose YAML parses and whose pipeline is wired",
    (system: string) => {
      const descriptor: DatabaseSystemDescriptor = DATABASE_SYSTEMS.find(
        (candidate: DatabaseSystemDescriptor): boolean => {
          return candidate.system === system;
        },
      )!;
      const markdown: string = guideFor(rowFor(descriptor));

      for (const block of codeBlocks(markdown)) {
        if (block.language !== "yaml") {
          continue;
        }
        const parsed: unknown = yaml.load(block.body);
        expect(typeof parsed).toBe("object");

        const config: {
          receivers?: Record<string, unknown>;
          processors?: Record<string, unknown>;
          exporters?: Record<string, unknown>;
          service?: {
            pipelines?: Record<
              string,
              {
                receivers: Array<string>;
                processors: Array<string>;
                exporters: Array<string>;
              }
            >;
          };
        } = parsed as never;

        // Every component a pipeline names is defined in the same block.
        for (const pipeline of Object.values(config.service?.pipelines || {})) {
          for (const receiver of pipeline.receivers) {
            expect(Object.keys(config.receivers || {})).toContain(receiver);
          }
          for (const processor of pipeline.processors) {
            expect(Object.keys(config.processors || {})).toContain(processor);
          }
          for (const exporter of pipeline.exporters) {
            expect(Object.keys(config.exporters || {})).toContain(exporter);
          }
        }
      }

      if (descriptor.engineMetrics.kind === "embedded") {
        expect(markdown).toContain("runs inside your application's process");
        expect(markdown).not.toContain("resource/database");
        return;
      }

      // Never "no receiver" for an engine that has a way to its metrics.
      expect(markdown).not.toContain(
        "There is no OpenTelemetry Collector receiver",
      );
      expect(markdown).toContain(DATABASE_ID);
    },
  );

  test("an engine with a contrib receiver but no agent config gets the complete receiver config", () => {
    for (const system of [
      "sap.hana",
      "snowflake",
      "couchdb",
      "riak",
      "aerospike",
      "gcp.spanner",
    ]) {
      const descriptor: DatabaseSystemDescriptor = DATABASE_SYSTEMS.find(
        (candidate: DatabaseSystemDescriptor): boolean => {
          return candidate.system === system;
        },
      )!;
      const component: string = getCollectorReceiverComponentName(
        descriptor.receiverTypes[0]!,
      );
      const markdown: string = guideFor(rowFor(descriptor));
      const config: string = codeBlocks(markdown).find(
        (block: { language: string; body: string }): boolean => {
          return block.language === "yaml";
        },
      )!.body;

      expect({
        system,
        receiver: config.includes(`\n  ${component}:\n`),
      }).toEqual({ system, receiver: true });
      expect(config).toContain(`receivers: [${component}]`);
      expect(config).toContain(`value: ${system}`);
      expect(config).toContain('value: "db.prod.example.com"');
      expect(config).toContain(`value: "${DATABASE_ID}"`);
      expect(config).toContain(`endpoint: "${URL}/otlp"`);
      expect(config).toContain(`x-oneuptime-token: "${KEY}"`);
      expect(config).toContain("key: service.name\n        action: delete");
    }
  });

  test("an engine with its own Prometheus endpoint gets the scrape, with service.name and service.instance.id deleted", () => {
    const markdown: string = guideFor({
      id: DATABASE_ID,
      dbSystem: "clickhouse",
      serverAddress: "ch.prod.example.com",
    });
    const config: string = codeBlocks(markdown).find(
      (block: { language: string; body: string }): boolean => {
        return block.language === "yaml";
      },
    )!.body;

    expect(markdown).toContain("serves Prometheus metrics itself");
    expect(markdown).toContain("Enable the `<prometheus>` section");
    expect(config).toContain('metrics_path: "/metrics"');
    expect(config).toContain('targets: ["ch.prod.example.com:9363"]');
    expect(config).toContain("receivers: [prometheus/database]");
    expect(config).toContain(
      "key: service.instance.id\n        action: delete",
    );
    expect(config).toContain("value: 9000");
  });

  test("a managed cloud database is pointed at its provider's monitoring API", () => {
    const markdown: string = guideFor({
      id: DATABASE_ID,
      dbSystem: "dynamodb",
      serverAddress: "dynamodb.us-east-1.amazonaws.com",
    });

    expect(markdown).toContain("is a managed service");
    expect(markdown).toContain("`awsfirehose` receiver");
    expect(markdown).toContain("resource/database");
  });

  test("an engine with no built-in endpoint says what to do, and still gives the identity stamp", () => {
    const markdown: string = guideFor({
      id: DATABASE_ID,
      dbSystem: "ibm.db2",
      serverAddress: "db2.prod.example.com",
    });

    expect(markdown).toContain("The collector has no Db2 receiver");
    expect(markdown).toContain("resource/database");
    expect(markdown).toContain("value: ibm.db2");
  });

  test("an unknown engine gets the identity stamp under its raw name", () => {
    const markdown: string = guideFor({
      id: DATABASE_ID,
      dbSystem: "AcmeDB",
      serverAddress: "acme.prod.example.com",
    });

    expect(markdown).toContain("OneUptime does not know AcmeDB's engine yet");
    expect(markdown).toContain("value: acmedb");
  });

  test("an in-process engine explains what the page shows instead", () => {
    const markdown: string = guideFor({ id: DATABASE_ID, dbSystem: "sqlite" });

    expect(markdown).toContain(
      "SQLite runs inside your application's process, so there is no server to collect engine metrics from",
    );
    expect(markdown).toContain(DATABASE_ID);
    expect(markdown).not.toContain("resource/database");
    expect(markdown).not.toContain("Database Health monitor");
  });

  test("an own-collector guide with environment credentials says to double $ in them", () => {
    expect(
      guideFor({
        id: DATABASE_ID,
        dbSystem: "sap.hana",
        serverAddress: "hana.prod.example.com",
      }),
    ).toContain("write every `$` in a password as `$$`");
  });
});
