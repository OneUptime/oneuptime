import { describe, expect, test } from "@jest/globals";
import fs from "fs";
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
  getDatabaseAgentEngine,
  getDatabaseAgentEngineLabel,
  getDatabaseAgentEnvFile,
  getDatabaseAgentInstallationMarkdown,
  getDatabaseAgentKubernetesManifest,
  getDatabaseOwnCollectorMarkdown,
  resolveDatabaseAgentIdentity,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationMarkdown";

/*
 * The in-app Database Agent guide. The agent is config-only, so a guide that
 * shows a paraphrase of the config — or an .env that names a variable the
 * compose file does not pass through — installs an agent that silently
 * reports nothing (or reports under the wrong identity). These tests hold the
 * embedded copies byte-identical to agents/DatabaseAgent and pin the values
 * a row's Documentation tab prefills.
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
});

describe("getDatabaseAgentEngine", () => {
  test("maps a row's engine (aliases included) to an agent config", () => {
    expect(getDatabaseAgentEngine("postgresql")).toBe("postgresql");
    expect(getDatabaseAgentEngine("postgres")).toBe("postgresql");
    expect(getDatabaseAgentEngine("mariadb")).toBe("mysql");
    expect(getDatabaseAgentEngine("Redis")).toBe("redis");
    expect(getDatabaseAgentEngine("mongodb")).toBe("mongodb");
  });

  test("is null for an engine the agent ships no config for", () => {
    expect(getDatabaseAgentEngine("microsoft.sql_server")).toBeNull();
    expect(getDatabaseAgentEngine("sqlite")).toBeNull();
    expect(getDatabaseAgentEngine("")).toBeNull();
    expect(getDatabaseAgentEngine(undefined)).toBeNull();
  });

  test("labels", () => {
    expect(getDatabaseAgentEngineLabel("mysql")).toBe("MySQL / MariaDB");
    expect(getDatabaseAgentEngineLabel("redis")).toBe("Redis / Valkey");
  });
});

describe("resolveDatabaseAgentIdentity", () => {
  test("the product page gets placeholders and the engine's default port", () => {
    const identity: DatabaseAgentIdentity =
      resolveDatabaseAgentIdentity("mysql");

    expect(identity).toEqual({
      serverAddress: "db.internal",
      serverPort: 3306,
      endpoint: "db.internal:3306",
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

  test("names only variables the compose file passes to the collector", () => {
    const compose: string = readAgentFile("docker-compose.yml");
    const passed: Set<string> = new Set(
      Array.from(compose.matchAll(/^\s*-\s*([A-Z_]+)=\$\{/gm)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    );
    const env: string = getDatabaseAgentEnvFile({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "mongodb",
      identity: resolveDatabaseAgentIdentity("mongodb"),
    });

    const named: Array<string> = env.split("\n").map((line: string): string => {
      return line.split("=")[0]!;
    });
    expect(passed.size).toBeGreaterThan(10);
    expect(new Set(named)).toEqual(passed);
  });
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
    expect(markdown).not.toContain("GRANT pg_monitor");
    expect(markdown).not.toContain("ACL SETUSER");
  });

  test("has no row block, an empty DATABASE_SERVER_ID and no Kubernetes manifest", () => {
    expect(markdown).not.toContain("## This database");
    expect(markdown).toContain("\nDATABASE_SERVER_ID=\n");
    expect(markdown).not.toContain("kind: Deployment");
    expect(markdown).toContain("DATABASE_SYSTEM=mysql bash install.sh");
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
    for (const variable of [
      "ONEUPTIME_URL",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "DATABASE_SYSTEM",
      "DATABASE_ENDPOINT",
      "DATABASE_SERVER_ADDRESS",
      "DATABASE_SERVER_PORT",
      "DATABASE_USERNAME",
      "DATABASE_PASSWORD",
      "DATABASE_TLS_INSECURE",
      "DATABASE_TLS_INSECURE_SKIP_VERIFY",
      "DATABASE_COLLECTION_INTERVAL",
      "DATABASE_QUERY_EVENTS",
      "DATABASE_SERVER_ID",
    ]) {
      expect(markdown).toContain(`| \`${variable}\` |`);
    }
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
    expect(markdown).not.toContain("replace `db.internal`");
  });

  test("tells the user to replace the placeholder when the row has no address", () => {
    const markdown: string = getDatabaseAgentInstallationMarkdown({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "postgresql",
      database: { id: DATABASE_ID, dbSystem: "postgresql" },
    });

    expect(markdown).toContain("replace `db.internal`");
    expect(markdown).toContain("DATABASE_SERVER_ADDRESS=db.internal");
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

describe("getDatabaseAgentKubernetesManifest", () => {
  const manifest: string = getDatabaseAgentKubernetesManifest({
    oneuptimeUrl: URL,
    engine: "redis",
    identity: resolveDatabaseAgentIdentity("redis", {
      id: DATABASE_ID,
      serverAddress: "redis-master.cache.svc.cluster.local",
    }),
    namespace: "cache",
  });

  test("runs the pinned collector image with the row's values", () => {
    expect(manifest).toContain(`image: ${DATABASE_AGENT_COLLECTOR_IMAGE}`);
    expect(manifest).toContain("namespace: cache");
    expect(manifest).toContain(`value: "${URL}"`);
    expect(manifest).toContain('value: "redis"');
    expect(manifest).toContain(
      'value: "redis-master.cache.svc.cluster.local:6379"',
    );
    expect(manifest).toContain('value: "6379"');
    expect(manifest).toContain(`value: "${DATABASE_ID}"`);
    expect(manifest).toContain("mountPath: /etc/otelcol-contrib");
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

describe("engines without an agent config", () => {
  test("an engine with a contrib receiver gets the own-collector recipe", () => {
    const markdown: string = getDatabaseOwnCollectorMarkdown({
      oneuptimeUrl: URL,
      apiKey: KEY,
      database: {
        id: DATABASE_ID,
        dbSystem: "mssql",
        serverAddress: "sql.prod.internal",
      },
    });

    expect(markdown).toContain("`sqlserver` receiver");
    expect(markdown).toContain("value: microsoft.sql_server");
    expect(markdown).toContain('value: "sql.prod.internal"');
    expect(markdown).toContain("value: 1433");
    expect(markdown).toContain(`value: "${DATABASE_ID}"`);
    expect(markdown).toContain(`endpoint: "${URL}/otlp"`);
    expect(markdown).toContain(`x-oneuptime-token: "${KEY}"`);
    expect(markdown).toContain("key: service.name\n        action: delete");
    // SQL Server is one of the Database Health monitor's engines.
    expect(markdown).toContain("Database Health monitor");
  });

  test("an engine with no receiver explains what the page shows instead", () => {
    const markdown: string = getDatabaseOwnCollectorMarkdown({
      oneuptimeUrl: URL,
      apiKey: KEY,
      database: { id: DATABASE_ID, dbSystem: "sqlite" },
    });

    expect(markdown).toContain(
      "There is no OpenTelemetry Collector receiver for SQLite",
    );
    expect(markdown).toContain(DATABASE_ID);
    expect(markdown).not.toContain("resource/database");
    expect(markdown).not.toContain("Database Health monitor");
  });
});
