import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import {
  DATABASE_AGENT_CONFIGS,
  DATABASE_AGENT_DOCKER_COMPOSE,
  DATABASE_AGENT_ENGINES,
  DatabaseAgentEngine,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseAgentConfigs";
import {
  DATABASE_AGENT_INSTALL_DIRECTORY,
  DATABASE_AGENT_RAW_URL,
  DATABASE_AGENT_SYSTEM_OPTIONS,
  DEFAULT_DATABASE_AGENT_SYSTEM,
  DatabaseDocumentationTarget,
  getDatabaseAgentEngine,
  getDatabaseAgentEnvFile,
  getDatabaseAgentInstallationMarkdown,
  getDatabaseAgentKubernetesManifest,
  getDatabaseAgentSetupGuide,
  getDatabaseAgentSystem,
  getDatabaseAgentSystems,
  getDatabaseDocumentationHeading,
  getDatabaseOwnCollectorMarkdown,
  getDatabaseOwnCollectorSetupGuide,
  resolveDatabaseAgentIdentity,
  resolveDatabaseAgentSystem,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationMarkdown";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideStepVariant,
  SetupGuideTopic,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
  getCollectorReceiverComponentName,
  getDatabaseSystemDisplayName,
} from "../../../Types/DatabaseServer/DatabaseSystem";

/*
 * The Database Agent guide as the Documentation card lays it out: an
 * engine picker on the product page, then a few steps — the monitoring
 * user, the install (script, Docker Compose, or a Deployment for a
 * Kubernetes database) and how to check it worked — and everything else
 * folded under Advanced and Troubleshooting.
 *
 * DatabaseDocumentationMarkdown.test.ts pins the identity, quoting and
 * escaping rules on the single-document guide; these tests hold the setup
 * guide to the same pieces (parity), and pin what is new in it: that each
 * engine only shows its own instructions, that the reader's URL and key
 * reach the install command only once a real key is picked, that a
 * Kubernetes database is offered its Deployment first, and that every file,
 * variable and flag it names exists in agents/DatabaseAgent.
 */

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..", "..", "..");
const AGENT_DIR: string = path.join(REPO_ROOT, "agents", "DatabaseAgent");

const URL: string = "https://oneuptime.example.com";
const KEY: string = "ingest-key-123";
const DATABASE_ID: string = "3c1e9a52-1f2b-4c3d-9e8f-0a1b2c3d4e5f";
const HEALTH_URL: string = "/dashboard/p1/monitors/create?monitorType=Database";
const RECOMMENDATIONS_URL: string = `/dashboard/p1/databases/${DATABASE_ID}/recommendations`;

const SYSTEMS: Array<string> = DATABASE_AGENT_SYSTEM_OPTIONS.map(
  (option: SetupGuideOption): string => {
    return option.key;
  },
);

const HEALTH_MONITOR_SYSTEMS: Array<string> = [
  "postgresql",
  "mysql",
  "microsoft.sql_server",
];

function readAgentFile(...segments: Array<string>): string {
  return fs.readFileSync(path.join(AGENT_DIR, ...segments), "utf8");
}

function engineOf(system: string): DatabaseAgentEngine {
  const engine: DatabaseAgentEngine | null = getDatabaseAgentEngine(system);
  if (!engine) {
    throw new Error(`No agent config monitors ${system}`);
  }
  return engine;
}

function productGuide(
  system: string,
  overrides?: { apiKey?: string; hasApiKey?: boolean; oneuptimeUrl?: string },
): SetupGuideContent {
  return getDatabaseAgentSetupGuide({
    oneuptimeUrl: overrides?.oneuptimeUrl ?? URL,
    apiKey: overrides?.apiKey ?? KEY,
    hasApiKey: overrides?.hasApiKey,
    engine: engineOf(system),
    system: system,
    databaseHealthMonitorUrl: HEALTH_URL,
  });
}

function rowGuide(
  database: DatabaseDocumentationTarget,
  overrides?: { apiKey?: string; hasApiKey?: boolean },
): SetupGuideContent {
  return getDatabaseAgentSetupGuide({
    oneuptimeUrl: URL,
    apiKey: overrides?.apiKey ?? KEY,
    hasApiKey: overrides?.hasApiKey,
    engine: engineOf(database.dbSystem || ""),
    system: database.dbSystem,
    database: database,
    databaseHealthMonitorUrl: HEALTH_URL,
    recommendationsUrl: RECOMMENDATIONS_URL,
  });
}

function stepTitled(guide: SetupGuideContent, title: string): SetupGuideStep {
  const step: SetupGuideStep | undefined = guide.steps.find(
    (candidate: SetupGuideStep): boolean => {
      return candidate.title === title;
    },
  );
  if (!step) {
    throw new Error(`No step titled "${title}"`);
  }
  return step;
}

function variantLabels(step: SetupGuideStep): Array<string> {
  return (step.variants || []).map((variant: SetupGuideStepVariant): string => {
    return variant.label;
  });
}

function variantOf(guide: SetupGuideContent, label: string): string {
  const variant: SetupGuideStepVariant | undefined = (
    stepTitled(guide, "Install the agent").variants || []
  ).find((candidate: SetupGuideStepVariant): boolean => {
    return candidate.label === label;
  });
  if (!variant) {
    throw new Error(`No install variant labelled "${label}"`);
  }
  return variant.markdown;
}

function topicTitles(
  topics: Array<SetupGuideTopic> | undefined,
): Array<string> {
  return (topics || []).map((topic: SetupGuideTopic): string => {
    return topic.title;
  });
}

function topicOf(
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
): SetupGuideTopic {
  const topic: SetupGuideTopic | undefined = (topics || []).find(
    (candidate: SetupGuideTopic): boolean => {
      return candidate.title === title;
    },
  );
  if (!topic) {
    throw new Error(`No topic titled "${title}"`);
  }
  return topic;
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

// The line of some markdown that runs install.sh (the first one).
function installCommandOf(markdown: string): string {
  const command: string | undefined = markdown
    .split("\n")
    .find((line: string): boolean => {
      return line.endsWith(" bash install.sh");
    });
  if (!command) {
    throw new Error("No install.sh command line");
  }
  return command;
}

// Every line of some markdown that runs install.sh.
function installCommandsOf(markdown: string): Array<string> {
  return markdown.split("\n").filter((line: string): boolean => {
    return line.endsWith("bash install.sh");
  });
}

/* The fenced block that sets ONEUPTIME_URL: the `.env` file. */
function envBlockOf(markdown: string): string {
  const block: { language: string; body: string } | undefined = codeBlocks(
    markdown,
  ).find((candidate: { language: string; body: string }): boolean => {
    return candidate.body.includes("\nONEUPTIME_URL=");
  });
  if (!block) {
    throw new Error("No .env block");
  }
  return block.body;
}

/*
 * Environment variable names the compose file passes to the collector: its
 * oneuptime-database-agent service only.
 */
function composeVariables(): Set<string> {
  const compose: string = readAgentFile("docker-compose.yml");
  const start: number = compose.indexOf("\n  oneuptime-database-agent:\n");
  const next: number = compose.slice(start + 1).search(/\n {2}[a-z0-9-]+:\n/);
  const collector: string =
    next < 0 ? compose.slice(start) : compose.slice(start, start + 1 + next);

  expect(start).toBeGreaterThanOrEqual(0);

  return new Set<string>(
    Array.from(collector.matchAll(/^\s*-\s*([A-Z_]+)=\$\{/gm)).map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    ),
  );
}

// The README's grant blocks, which every guide's grants must be.
const README_BLOCKS: Array<string> = codeBlocks(readAgentFile("README.md"))
  .filter((block: { language: string; body: string }): boolean => {
    return ["sql", "text", "js"].includes(block.language);
  })
  .map((block: { language: string; body: string }): string => {
    return block.body;
  });

/*
 * A line each engine's grants carry, so a guide can be checked for showing
 * only its own engine's login.
 */
const GRANT_SIGNATURES: Record<DatabaseAgentEngine, string | null> = {
  postgresql: "GRANT pg_monitor TO oneuptime_monitor;",
  mysql: "GRANT PROCESS, REPLICATION CLIENT ON *.*",
  redis: "ACL SETUSER oneuptime_monitor",
  mongodb: 'roles: [{ role: "clusterMonitor", db: "admin" }]',
  sqlserver: "GRANT VIEW SERVER STATE TO oneuptime_monitor;",
  oracledb: "GRANT SELECT_CATALOG_ROLE TO oneuptime_monitor;",
  elasticsearch: "POST /_security/role/oneuptime_monitor",
  memcached: null,
};

function hasQueryEvents(engine: DatabaseAgentEngine): boolean {
  return DATABASE_AGENT_CONFIGS[engine].includes("db.server.top_query:");
}

function expectPlainOneLine(text: string | undefined): void {
  expect(text).toBeTruthy();
  // Rendered as plain text, so no markdown.
  expect(text).not.toMatch(/[`*[\]]/);
  expect(text).not.toContain("\n");
}

/*
 * Every "step N" the guide's text refers to is the step on screen with
 * that number: step 1 is the ingestion key (SetupGuideCard's own), and the
 * guide's steps follow from 2. Memcached has no monitoring-user step, so
 * its check is step 3, not 4.
 */
function expectStepReferencesToMatch(guide: SetupGuideContent): void {
  const markdown: string = getSetupGuideMarkdown(guide).replace(
    /^## Step \d+: .*$/gm,
    "",
  );
  const references: Array<RegExpMatchArray> = Array.from(
    markdown.matchAll(/[^.:\n]*\bstep (\d+)\b[^.\n]*/g),
  );
  expect(references.length).toBeGreaterThan(0);

  for (const reference of references) {
    const sentence: string = reference[0];
    const stepNumber: number = Number(reference[1]);
    if (stepNumber === 1) {
      expect({ sentence, aboutTheKey: sentence.includes("key") }).toEqual({
        sentence,
        aboutTheKey: true,
      });
      continue;
    }
    const step: SetupGuideStep | undefined = guide.steps[stepNumber - 2];
    expect({ sentence, exists: Boolean(step) }).toEqual({
      sentence,
      exists: true,
    });
    if (sentence.includes("diagnostic script")) {
      expect({ sentence, title: step!.title }).toEqual({
        sentence,
        title: "Verify the installation",
      });
    } else {
      expect({ sentence, title: step!.title }).toEqual({
        sentence,
        title: "Create a monitoring user",
      });
    }
  }
}

describe("the engine picker", () => {
  test("offers every engine the agent monitors, forks included, in catalog order", () => {
    expect(SYSTEMS).toEqual(getDatabaseAgentSystems());
    expect(SYSTEMS).toEqual([
      "postgresql",
      "mysql",
      "mariadb",
      "microsoft.sql_server",
      "oracle.db",
      "redis",
      "valkey",
      "keydb",
      "dragonfly",
      "memcached",
      "mongodb",
      "elasticsearch",
      "opensearch",
    ]);
  });

  test("labels each engine with the catalog's display name", () => {
    for (const option of DATABASE_AGENT_SYSTEM_OPTIONS) {
      expect(option.label).toBe(getDatabaseSystemDisplayName(option.key));
    }
    expect(
      DATABASE_AGENT_SYSTEM_OPTIONS.map((option: SetupGuideOption): string => {
        return option.label;
      }),
    ).toEqual([
      "PostgreSQL",
      "MySQL",
      "MariaDB",
      "SQL Server",
      "Oracle",
      "Redis",
      "Valkey",
      "KeyDB",
      "Dragonfly",
      "Memcached",
      "MongoDB",
      "Elasticsearch",
      "OpenSearch",
    ]);
  });

  test("describes each engine in one line: the receiver it runs, and the name a fork reports", () => {
    for (const option of DATABASE_AGENT_SYSTEM_OPTIONS) {
      const engine: DatabaseAgentEngine = engineOf(option.key);
      expectPlainOneLine(option.description);
      expect(option.description).toContain(
        `${getCollectorReceiverComponentName(engine)} receiver`,
      );
      expect(option.badge).toBeUndefined();

      const isFork: boolean = getDatabaseAgentSystem(engine) !== option.key;
      expect({
        system: option.key,
        namesItself: (option.description || "").includes(
          `reports the server as ${option.label}`,
        ),
      }).toEqual({ system: option.key, namesItself: isFork });
    }
  });

  test("opens on PostgreSQL, and anything it does not offer resolves to PostgreSQL", () => {
    expect(DEFAULT_DATABASE_AGENT_SYSTEM).toBe("postgresql");
    expect(SYSTEMS[0]).toBe(DEFAULT_DATABASE_AGENT_SYSTEM);
    for (const value of [
      undefined,
      null,
      "",
      "postgres",
      "MySQL",
      "sqlite",
      "couchdb",
      "acmedb",
    ]) {
      expect(resolveDatabaseAgentSystem(value)).toBe("postgresql");
    }
    for (const system of SYSTEMS) {
      expect(resolveDatabaseAgentSystem(system)).toBe(system);
    }
  });
});

describe.each(SYSTEMS)("the %s guide on the product page", (system: string) => {
  const engine: DatabaseAgentEngine = engineOf(system);
  const guide: SetupGuideContent = productGuide(system);
  const markdown: string = getSetupGuideMarkdown(guide);
  const label: string = getDatabaseSystemDisplayName(system);

  test("is the monitoring user, the install and the check — Memcached has no users", () => {
    const titles: Array<string> = guide.steps.map(
      (step: SetupGuideStep): string => {
        return step.title;
      },
    );
    expect(titles).toEqual(
      engine === "memcached"
        ? ["Install the agent", "Verify the installation"]
        : [
            "Create a monitoring user",
            "Install the agent",
            "Verify the installation",
          ],
    );
    for (const step of guide.steps) {
      expectPlainOneLine(step.description);
    }
  });

  test("installs with the script or Docker Compose — no Kubernetes Deployment without a database", () => {
    expect(variantLabels(stepTitled(guide, "Install the agent"))).toEqual([
      "Install script",
      "Docker Compose",
    ]);
    expect(markdown).not.toContain("kind: Deployment");
    expect(markdown).not.toContain("kubectl");
  });

  test("the install script gets the URL, the key and the engine up front", () => {
    const script: string = variantOf(guide, "Install script");
    expect(script).toContain(
      `curl -sSL ${DATABASE_AGENT_RAW_URL}/install.sh -o install.sh\n`,
    );
    expect(installCommandOf(script)).toBe(
      `ONEUPTIME_URL=${URL} ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY} DATABASE_SYSTEM=${system} bash install.sh`,
    );
    // It asks for the rest, never for what the command line already gives.
    expect(script).not.toContain("your OneUptime URL");
    expect(script).not.toContain("the ingestion key from step 1");
    expect(script).toContain("the endpoint to connect to");
  });

  test("Docker Compose downloads the engine's config and writes the .env with the URL and key", () => {
    const compose: string = variantOf(guide, "Docker Compose");
    expect(compose).toContain(
      `curl -fsSL ${DATABASE_AGENT_RAW_URL}/docker-compose.yml -o docker-compose.yml`,
    );
    expect(compose).toContain(
      `curl -fsSL ${DATABASE_AGENT_RAW_URL}/configs/${engine}.yaml -o otel-collector-config.yaml`,
    );
    expect(envBlockOf(compose)).toBe(
      getDatabaseAgentEnvFile({
        oneuptimeUrl: URL,
        apiKey: KEY,
        engine: engine,
        identity: resolveDatabaseAgentIdentity(system),
        system: system,
      }),
    );
    expect(envBlockOf(compose)).toContain(`\nONEUPTIME_URL=${URL}\n`);
    expect(envBlockOf(compose)).toContain(
      `\nONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}\n`,
    );
    expect(envBlockOf(compose)).toContain(`\nDATABASE_SYSTEM=${system}\n`);
    expect(envBlockOf(compose)).toMatch(/\nDATABASE_SERVER_ID=$/);
    expect(compose).toContain("```bash\ndocker compose up -d\n```");
    expect(compose).not.toContain("Pick an ingestion key in step 1");
  });

  test("the .env names exactly the variables the compose file passes to the collector", () => {
    const named: Array<string> = envBlockOf(variantOf(guide, "Docker Compose"))
      .split("\n")
      .filter((line: string): boolean => {
        return !line.startsWith("#");
      })
      .map((line: string): string => {
        return line.split("=")[0]!;
      });
    expect(new Set(named)).toEqual(composeVariables());
  });

  test("shows only this engine's login, in the README's own words", () => {
    const signature: string | null = GRANT_SIGNATURES[engine];
    const steps: string = guide.steps
      .map((step: SetupGuideStep): string => {
        return step.markdown || "";
      })
      .join("\n");

    if (signature) {
      const user: string =
        stepTitled(guide, "Create a monitoring user").markdown || "";
      for (const block of codeBlocks(user)) {
        expect({
          system,
          inReadme: README_BLOCKS.includes(block.body),
        }).toEqual({ system, inReadme: true });
      }
      // OpenSearch is not shown Elasticsearch's security API.
      expect(steps.includes(signature)).toBe(system !== "opensearch");
    }

    for (const other of DATABASE_AGENT_ENGINES) {
      const otherSignature: string | null = GRANT_SIGNATURES[other];
      if (other !== engine && otherSignature) {
        expect({
          system,
          other,
          shown: markdown.includes(otherSignature),
        }).toEqual({ system, other, shown: false });
      }
    }
  });

  test("keeps configuration and reference material out of the steps", () => {
    const steps: string = guide.steps
      .map((step: SetupGuideStep): string => {
        return `${step.markdown || ""}${(step.variants || [])
          .map((variant: SetupGuideStepVariant): string => {
            return variant.markdown;
          })
          .join("\n")}`;
      })
      .join("\n");
    for (const advanced of [
      "| Variable | Required | Description |",
      "pg_stat_statements",
      "--force-recreate",
      "docker compose down",
      "INSTALL_DIR=",
      "oneuptime-database-ai-agent",
      DATABASE_AGENT_CONFIGS[engine].trimEnd(),
      DATABASE_AGENT_DOCKER_COMPOSE.trimEnd(),
    ]) {
      expect(steps).not.toContain(advanced);
    }
  });

  test("has no row identity, no alerting and no id", () => {
    expect(guide.intro).toBeUndefined();
    expect(topicTitles(guide.advanced)).not.toContain("Alert on this database");
    expect(markdown).not.toContain("**This database**");
    expect(markdown).not.toContain(DATABASE_ID);
  });

  test("folds the reference material under Advanced", () => {
    const titles: Array<string> = topicTitles(guide.advanced);
    const expected: Array<string> = ["What the agent collects"];
    if (hasQueryEvents(engine)) {
      expected.push("Query samples and top queries");
    }
    expected.push(
      "Environment variables",
      "The files the agent runs",
      "Upgrade or uninstall the agent",
    );
    if (HEALTH_MONITOR_SYSTEMS.includes(system)) {
      expected.push("No agent? Use a Database Health monitor");
    }
    expect(titles).toEqual(expected);
    expect(titles.length).toBeGreaterThanOrEqual(4);
    expect(titles.length).toBeLessThanOrEqual(8);
  });

  test("every Advanced topic has a plain one-line summary", () => {
    for (const topic of guide.advanced || []) {
      expectPlainOneLine(topic.summary);
      expect(topic.markdown.trim().length).toBeGreaterThan(0);
    }
  });

  test("says what the agent collects from this engine", () => {
    const collects: string = topicOf(
      guide.advanced,
      "What the agent collects",
    ).markdown;
    expect(collects).toContain(
      `The OneUptime Database Agent collects ${label} engine metrics — `,
    );
    expect(collects).toContain(`(\`configs/${engine}.yaml\`)`);
    expect(collects.includes("query samples")).toBe(hasQueryEvents(engine));
  });

  test("the files topic embeds the compose file and this engine's config, and no other", () => {
    const files: string = topicOf(
      guide.advanced,
      "The files the agent runs",
    ).markdown;
    expect(files).toContain(DATABASE_AGENT_DOCKER_COMPOSE.trimEnd());
    expect(files).toContain(DATABASE_AGENT_CONFIGS[engine].trimEnd());
    for (const other of DATABASE_AGENT_ENGINES) {
      if (other !== engine) {
        expect(files).not.toContain(DATABASE_AGENT_CONFIGS[other].trimEnd());
      }
    }
    // The embedded config keeps its ${env:...} references literally.
    expect(files).toContain('value: "${env:DATABASE_SYSTEM}"');
  });

  test("the variables table documents every variable the collector reads", () => {
    const table: string = topicOf(
      guide.advanced,
      "Environment variables",
    ).markdown;
    for (const variable of composeVariables()) {
      expect(table).toContain(`| \`${variable}\` |`);
    }
  });

  test("the check says where the database shows up and how to diagnose it", () => {
    const verify: string =
      stepTitled(guide, "Verify the installation").markdown || "";
    expect(verify).toContain("the database appears under **Databases**");
    expect(verify).toContain(
      `curl -sSL ${DATABASE_AGENT_RAW_URL}/troubleshoot.sh -o troubleshoot.sh\nbash troubleshoot.sh    # add -d <dir> if you installed outside ${DATABASE_AGENT_INSTALL_DIRECTORY}`,
    );
  });

  test("troubleshooting is titled by symptom", () => {
    const titles: Array<string> = topicTitles(guide.troubleshooting);
    expect(titles).toContain("The database does not appear under Databases");
    expect(titles).toContain("The agent cannot connect to the database");
    expect(titles).toContain('The collector log shows "Exporting failed"');
    expect(titles).toContain("The agent container keeps restarting");
    expect(
      titles.some((title: string): boolean => {
        return title.startsWith("Login");
      }),
    ).toBe(engine !== "memcached");
    for (const topic of guide.troubleshooting || []) {
      expect(topic.markdown.trim().length).toBeGreaterThan(0);
    }
  });

  test("has two to four prerequisites, the product page's naming the identity", () => {
    const prerequisites: Array<string> = guide.prerequisites || [];
    expect(prerequisites.length).toBeGreaterThanOrEqual(2);
    expect(prerequisites.length).toBeLessThanOrEqual(4);
    expect(prerequisites[0]).toContain("Docker Engine 20.10+");
    expect(prerequisites.join("\n")).toContain(
      "The host name your applications use",
    );
    expect(prerequisites.join("\n").includes("SASL")).toBe(
      engine === "memcached",
    );
  });

  test("links to documentation that exists", () => {
    const links: Array<{ title: string; url: string }> = guide.links || [];
    expect(links[0]).toEqual({
      title: "Database Agent documentation",
      url: "/docs/telemetry/databases",
    });
    expect(links.length).toBe(HEALTH_MONITOR_SYSTEMS.includes(system) ? 2 : 1);
    for (const link of links) {
      expect(link.url.startsWith("/docs/")).toBe(true);
      expect(
        fs.existsSync(
          path.join(
            REPO_ROOT,
            "packages/App/FeatureSet/Docs/Content/en",
            `${link.url.replace(/^\/docs\//, "")}.md`,
          ),
        ),
      ).toBe(true);
    }
  });

  test("with a key picked, no placeholder is left anywhere", () => {
    expect(markdown).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
    expect(markdown).not.toContain(SETUP_GUIDE_URL_PLACEHOLDER);
  });

  test("every step it refers to by number is that step", () => {
    expectStepReferencesToMatch(guide);
    expectStepReferencesToMatch(
      productGuide(system, {
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
        hasApiKey: false,
      }),
    );
    expectStepReferencesToMatch(
      rowGuide({
        id: DATABASE_ID,
        dbSystem: system,
        endpoints: ["db.data.svc.cluster.local:1234@prod"],
        kubernetesNamespace: "data",
        isKubernetes: true,
      }),
    );
  });
});

describe("each option shows only its own instructions", () => {
  const userStep: (system: string) => string = (system: string): string => {
    return (
      stepTitled(productGuide(system), "Create a monitoring user").markdown ||
      ""
    );
  };

  test("MariaDB's extra replica-status grant is MariaDB's", () => {
    expect(userStep("mariadb")).toContain(
      "GRANT SLAVE MONITOR ON *.* TO 'oneuptime_monitor'@'%';",
    );
    expect(userStep("mysql")).not.toContain("SLAVE MONITOR");
    expect(userStep("mysql")).not.toContain("MariaDB");
  });

  test("OpenSearch gets its own permissions, Elasticsearch its security API", () => {
    expect(userStep("opensearch")).toContain(
      "give the monitoring user the cluster permission `cluster_monitor` and the index permission `indices_monitor` on `*`",
    );
    expect(userStep("opensearch")).not.toContain("_security");
    expect(userStep("opensearch")).toContain(
      "On a cluster without security, leave `DATABASE_USERNAME` and `DATABASE_PASSWORD` empty.",
    );
    expect(userStep("elasticsearch")).toContain(
      "POST /_security/role/oneuptime_monitor",
    );
    expect(userStep("elasticsearch")).not.toContain("OpenSearch");
  });

  test("the Redis forks are told the ACL is the same, Redis is not", () => {
    for (const fork of ["valkey", "keydb", "dragonfly"]) {
      expect(userStep(fork)).toContain(
        "Valkey, KeyDB and Dragonfly take the same ACL.",
      );
      expect(userStep(fork)).toContain("ACL SETUSER oneuptime_monitor");
    }
    expect(userStep("redis")).not.toContain("Valkey");
  });

  test("query-event requirements wait under their own topic", () => {
    const postgres: SetupGuideContent = productGuide("postgresql");
    const queries: string = topicOf(
      postgres.advanced,
      "Query samples and top queries",
    ).markdown;
    expect(userStep("postgresql")).not.toContain("pg_stat_statements");
    expect(queries).toContain(
      "```sql\nCREATE EXTENSION IF NOT EXISTS pg_stat_statements;\n```",
    );
    expect(queries).toContain("explain plans additionally need `SELECT`");
    expect(queries).toContain("`failed to explain`");

    expect(userStep("mongodb")).not.toContain("Explain plans");
    expect(userStep("mongodb")).toContain(
      "run one agent per replica-set member",
    );
    expect(
      topicOf(productGuide("mongodb").advanced, "Query samples and top queries")
        .markdown,
    ).toContain('`{ role: "read", db: "<database>" }`');
  });

  /*
   * Nothing the single-document guide said about a login is lost: every
   * grant block it showed is in the setup guide of an engine that config
   * monitors, and every sentence either there or in the query-event topic
   * (bar the one OpenSearch sentence the setup guide words for OpenSearch).
   */
  test("every fact of the single-document grants survives the split", () => {
    for (const engine of DATABASE_AGENT_ENGINES) {
      if (engine === "memcached") {
        // No login to create: the step becomes a prerequisite, reworded.
        const memcached: SetupGuideContent = productGuide("memcached");
        const prerequisite: string = (memcached.prerequisites || []).join("\n");
        expect(topicTitles(memcached.advanced)).not.toContain(
          "Create a monitoring user",
        );
        expect(prerequisite).toContain("Memcached has no users");
        expect(prerequisite).toContain(
          "the agent runs `stats` over the text protocol",
        );
        expect(prerequisite).toContain("without SASL authentication (`-S`)");
        expect(envBlockOf(variantOf(memcached, "Docker Compose"))).toContain(
          "\nDATABASE_USERNAME=\nDATABASE_PASSWORD=\n",
        );
        continue;
      }

      const document: string = getDatabaseAgentInstallationMarkdown({
        oneuptimeUrl: URL,
        apiKey: KEY,
        engine: engine,
      });
      const section: string = document.substring(
        document.indexOf("## Create a monitoring user"),
        document.indexOf("## Quick Start — Install Script"),
      );
      const structured: string = SYSTEMS.filter((system: string): boolean => {
        return engineOf(system) === engine;
      })
        .map((system: string): string => {
          return getSetupGuideMarkdown(productGuide(system));
        })
        .join("\n");

      for (const block of codeBlocks(section)) {
        expect({ engine, kept: structured.includes(block.body) }).toEqual({
          engine,
          kept: true,
        });
      }

      const prose: string = section
        .replace(/```[\s\S]*?```/g, "\n\n")
        .replace(/^## Create a monitoring user$/m, "");
      const sentences: Array<string> = prose
        .split(/\n\s*\n|(?<=\.)\s+(?=[A-Z`])/)
        .map((sentence: string): string => {
          return sentence.trim();
        })
        .filter((sentence: string): boolean => {
          return sentence.length > 0;
        });
      expect(sentences.length).toBeGreaterThan(0);
      for (const sentence of sentences) {
        if (sentence.startsWith("On OpenSearch with the security plugin")) {
          continue;
        }
        expect({
          engine,
          sentence,
          kept: structured.includes(sentence),
        }).toEqual({ engine, sentence, kept: true });
      }
    }
  });
});

describe("before a key is picked", () => {
  test.each(SYSTEMS)(
    "the %s install command carries neither a placeholder nor a URL, and says the script asks",
    (system: string) => {
      const guide: SetupGuideContent = productGuide(system, {
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
        hasApiKey: false,
      });
      const markdown: string = getSetupGuideMarkdown(guide);
      const script: string = variantOf(guide, "Install script");

      expect(installCommandOf(script)).toBe(
        `DATABASE_SYSTEM=${system} bash install.sh`,
      );
      expect(script).toContain(
        "The script asks for your OneUptime URL, the ingestion key from step 1",
      );
      expect(script).toContain("the endpoint to connect to");
      // No install.sh line anywhere — the upgrade topic's included — stores a key.
      const commands: Array<string> = installCommandsOf(markdown);
      expect(commands.length).toBeGreaterThanOrEqual(3);
      for (const command of commands) {
        expect(command).not.toContain("ONEUPTIME_TELEMETRY_INGESTION_KEY");
        expect(command).not.toContain("ONEUPTIME_URL");
        expect(command).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
      }

      // The hand-written .env shows where the key goes, and says so.
      const compose: string = variantOf(guide, "Docker Compose");
      expect(envBlockOf(compose)).toContain(
        `\nONEUPTIME_TELEMETRY_INGESTION_KEY=${SETUP_GUIDE_API_KEY_PLACEHOLDER}\n`,
      );
      expect(compose).toContain(
        `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
      );
    },
  );

  test("without hasApiKey, the placeholder itself means no key", () => {
    const guide: SetupGuideContent = getDatabaseAgentSetupGuide({
      oneuptimeUrl: URL,
      apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
      engine: "postgresql",
    });
    expect(installCommandOf(variantOf(guide, "Install script"))).toBe(
      "DATABASE_SYSTEM=postgresql bash install.sh",
    );

    const withKey: SetupGuideContent = getDatabaseAgentSetupGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "postgresql",
    });
    expect(installCommandOf(variantOf(withKey, "Install script"))).toBe(
      `ONEUPTIME_URL=${URL} ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY} DATABASE_SYSTEM=postgresql bash install.sh`,
    );
  });

  test("a placeholder never reaches the command line, whatever hasApiKey says", () => {
    const guide: SetupGuideContent = productGuide("mysql", {
      apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
      hasApiKey: true,
    });
    expect(installCommandOf(variantOf(guide, "Install script"))).toBe(
      "DATABASE_SYSTEM=mysql bash install.sh",
    );
  });

  test("an unknown OneUptime URL is asked for, while a picked key is still passed", () => {
    const guide: SetupGuideContent = productGuide("postgresql", {
      oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    });
    const script: string = variantOf(guide, "Install script");
    expect(installCommandOf(script)).toBe(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY} DATABASE_SYSTEM=postgresql bash install.sh`,
    );
    expect(script).toContain(
      "The script asks for your OneUptime URL, the endpoint",
    );
    expect(script).not.toContain("the ingestion key from step 1");
  });

  test("a key with shell characters reaches install.sh as one quoted word", () => {
    const guide: SetupGuideContent = productGuide("postgresql", {
      apiKey: "it's $ecret; really",
    });
    const command: string = installCommandOf(
      variantOf(guide, "Install script"),
    );
    expect(command).toBe(
      `ONEUPTIME_URL=${URL} ONEUPTIME_TELEMETRY_INGESTION_KEY='it'\\''s $ecret; really' DATABASE_SYSTEM=postgresql bash install.sh`,
    );
    const words: Array<string> = command
      .replace(/ bash install\.sh$/, "")
      .match(/[A-Z_]+=(?:'(?:[^']|'\\'')*'|\S*)/g)!;
    for (const word of words) {
      expect(word).toMatch(
        /^[A-Z_]+=(?:[A-Za-z0-9._:@%+,/=-]+|'(?:[^']|'\\'')*')$/,
      );
    }
  });
});

describe("a database's own guide", () => {
  const database: DatabaseDocumentationTarget = {
    id: DATABASE_ID,
    name: "PostgreSQL db.prod.internal:5432",
    dbSystem: "postgresql",
    serverAddress: "db.prod.internal",
    serverPort: 5432,
    endpoints: ["db.prod.internal:5432"],
  };
  const guide: SetupGuideContent = rowGuide(database);
  const markdown: string = getSetupGuideMarkdown(guide);

  test("opens with this database's identity", () => {
    expect(guide.intro).toContain("**This database**");
    expect(guide.intro).toContain("| `DATABASE_SYSTEM` | `postgresql` |");
    expect(guide.intro).toContain(
      `| \`DATABASE_SERVER_ID\` | \`${DATABASE_ID}\` |`,
    );
    expect(guide.intro).toContain(
      "| `DATABASE_SERVER_ADDRESS` | `db.prod.internal` |",
    );
    expect(guide.intro).toContain("| `DATABASE_SERVER_PORT` | `5432` |");
    expect(guide.intro).toContain(
      "`DATABASE_SERVER_ID` is stamped on the agent's data as `oneuptime.database.server.id`",
    );
  });

  test("installs for this database: its identity and id on the command line, after the URL and key", () => {
    expect(installCommandOf(variantOf(guide, "Install script"))).toBe(
      `ONEUPTIME_URL=${URL} ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY} DATABASE_SYSTEM=postgresql DATABASE_SERVER_ADDRESS=db.prod.internal DATABASE_SERVER_PORT=5432 DATABASE_SERVER_ID=${DATABASE_ID} bash install.sh`,
    );
    expect(envBlockOf(variantOf(guide, "Docker Compose"))).toContain(
      `\nDATABASE_SERVER_ID=${DATABASE_ID}`,
    );
    // The row is known, so the script is not said to ask for its name.
    expect(variantOf(guide, "Install script")).not.toContain(
      "it also asks for the host name",
    );
  });

  test("says this database's Engine metrics turn Connected, and troubleshoots them", () => {
    expect(stepTitled(guide, "Verify the installation").markdown).toContain(
      "this database's **Engine metrics** status turns to Connected",
    );
    const titles: Array<string> = topicTitles(guide.troubleshooting);
    expect(titles[0]).toBe(
      'Engine metrics reads "Not connected" or "Disconnected"',
    );
    expect(titles).not.toContain(
      "The database does not appear under Databases",
    );
    expect(
      topicOf(
        guide.troubleshooting,
        'Engine metrics reads "Not connected" or "Disconnected"',
      ).markdown,
    ).toContain(`\`${DATABASE_ID}\``);
  });

  test("alerting comes first under Advanced, with the id and the Recommendations tab", () => {
    expect(topicTitles(guide.advanced)[0]).toBe("Alert on this database");
    const alerting: string = topicOf(
      guide.advanced,
      "Alert on this database",
    ).markdown;
    expect(alerting).toContain(
      `\`oneuptime.database.server.id\` = \`${DATABASE_ID}\``,
    );
    expect(alerting).toContain(
      `The [Recommendations](${RECOMMENDATIONS_URL}) tab offers ready-made PostgreSQL monitors`,
    );
    expect(alerting).toContain("`cumulativetodelta` processor");
  });

  test("the Database Health monitor names this database's endpoint", () => {
    expect(
      topicOf(guide.advanced, "No agent? Use a Database Health monitor")
        .markdown,
    ).toContain(
      `[create a Database Health monitor](${HEALTH_URL}) (PostgreSQL, MySQL and SQL Server). It uses the same monitoring user. Point it at \`db.prod.internal:5432\`, one of this database's endpoints`,
    );
  });

  test("does not ask for the identity up front: the row has one", () => {
    expect((guide.prerequisites || []).join("\n")).not.toContain(
      "The host name your applications use",
    );
  });

  test("is not a Kubernetes install", () => {
    expect(variantLabels(stepTitled(guide, "Install the agent"))).toEqual([
      "Install script",
      "Docker Compose",
    ]);
    expect(markdown).not.toContain("kind: Deployment");
  });
});

/*
 * The setup guide is built from the same pieces as the single-document
 * guide, whose tests pin the subtle rules — the identity a row resolves
 * to, a SQL Server named instance's port, the shell quoting of the command
 * line. Before a key is picked the two install the same way, byte for byte.
 */
describe("parity with the single-document guide", () => {
  const ROWS: Array<DatabaseDocumentationTarget> = [
    {
      id: DATABASE_ID,
      dbSystem: "postgresql",
      serverAddress: "db.prod.internal",
      serverPort: 5432,
    },
    { id: DATABASE_ID, dbSystem: "postgresql" },
    {
      id: DATABASE_ID,
      dbSystem: "valkey",
      serverAddress: "cache.prod.internal",
    },
    {
      id: DATABASE_ID,
      dbSystem: "postgresql",
      serverAddress: "2001:db8::10",
      serverPort: 5432,
    },
    {
      id: DATABASE_ID,
      dbSystem: "microsoft.sql_server",
      serverAddress: "sql1.corp.example.com\\inst01",
      endpoints: ["sql1.corp.example.com\\inst01"],
    },
    {
      id: DATABASE_ID,
      dbSystem: "microsoft.sql_server",
      endpoints: ["sql1.corp.example.com\\inst01,14330"],
    },
    { id: "it's; odd", dbSystem: "mysql", serverAddress: "db.example.com" },
    { id: DATABASE_ID, dbSystem: "mariadb", serverAddress: "10.0.0.5" },
    {
      id: DATABASE_ID,
      dbSystem: "opensearch",
      serverAddress: "search.prod.example.com",
    },
    {
      id: DATABASE_ID,
      dbSystem: "postgresql",
      endpoints: ["postgres.payments.svc.cluster.local:5432@prod"],
      kubernetesNamespace: "payments",
      isKubernetes: true,
    },
  ];

  test.each(ROWS)(
    "installs the same way, and writes the same .env and manifest (%j)",
    (database: DatabaseDocumentationTarget) => {
      const engine: DatabaseAgentEngine = engineOf(database.dbSystem || "");
      const document: string = getDatabaseAgentInstallationMarkdown({
        oneuptimeUrl: URL,
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
        engine: engine,
        system: database.dbSystem,
        database: database,
      });
      const guide: SetupGuideContent = rowGuide(database, {
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
        hasApiKey: false,
      });

      expect(installCommandOf(variantOf(guide, "Install script"))).toBe(
        installCommandOf(document),
      );
      expect(envBlockOf(variantOf(guide, "Docker Compose"))).toBe(
        envBlockOf(document),
      );
      expect(guide.intro).toContain(
        document.substring(
          document.indexOf("| Setting | Value |"),
          document.indexOf("\n\n## Prerequisites"),
        ),
      );

      const documentManifest: { language: string; body: string } | undefined =
        codeBlocks(document).find(
          (block: { language: string; body: string }): boolean => {
            return block.body.startsWith("apiVersion: apps/v1");
          },
        );
      if (database.isKubernetes) {
        expect(variantOf(guide, "Kubernetes")).toContain(
          documentManifest!.body,
        );
      } else {
        expect(documentManifest).toBeUndefined();
      }
    },
  );

  test("the product page's picked engine installs the same way too", () => {
    for (const system of SYSTEMS) {
      const document: string = getDatabaseAgentInstallationMarkdown({
        oneuptimeUrl: URL,
        apiKey: KEY,
        engine: engineOf(system),
        system: system,
      });
      const guide: SetupGuideContent = productGuide(system, {
        hasApiKey: false,
      });
      expect(installCommandOf(variantOf(guide, "Install script"))).toBe(
        installCommandOf(document),
      );
      expect(envBlockOf(variantOf(guide, "Docker Compose"))).toBe(
        envBlockOf(document),
      );
    }
  });
});

describe("a Kubernetes database's guide", () => {
  const database: DatabaseDocumentationTarget = {
    id: DATABASE_ID,
    dbSystem: "valkey",
    endpoints: ["valkey.cache.svc.cluster.local:6379@prod"],
    kubernetesNamespace: "cache",
    isKubernetes: true,
  };
  const guide: SetupGuideContent = rowGuide(database);

  test("offers the Deployment first, then the script and Docker Compose", () => {
    expect(variantLabels(stepTitled(guide, "Install the agent"))).toEqual([
      "Kubernetes",
      "Install script",
      "Docker Compose",
    ]);
    expect(stepTitled(guide, "Install the agent").description).toContain(
      "Run it as a Deployment next to the database",
    );
  });

  test("the Deployment is prefilled for the row's namespace, engine and id", () => {
    const kubernetes: string = variantOf(guide, "Kubernetes");
    expect(kubernetes).toContain(
      `curl -fsSL ${DATABASE_AGENT_RAW_URL}/configs/redis.yaml -o config.yaml`,
    );
    expect(kubernetes).toContain(
      "kubectl -n cache create configmap oneuptime-database-agent --from-file=config.yaml=config.yaml",
    );
    expect(kubernetes).toContain(
      `--from-literal=ONEUPTIME_TELEMETRY_INGESTION_KEY='${KEY}'`,
    );
    expect(kubernetes).toContain(
      getDatabaseAgentKubernetesManifest({
        oneuptimeUrl: URL,
        engine: "redis",
        identity: resolveDatabaseAgentIdentity("valkey", database),
        namespace: "cache",
        system: "valkey",
      }),
    );
    expect(kubernetes).toContain('value: "valkey"');
    expect(kubernetes).toContain(`value: "${DATABASE_ID}"`);
    expect(kubernetes).toContain("write every `$` in it as `$$`");
    expect(kubernetes).not.toContain("Pick an ingestion key in step 1");
  });

  test("the prerequisites, the check and the connection help speak Kubernetes too", () => {
    expect((guide.prerequisites || [])[0]).toContain(
      "`kubectl` access to the `cache` namespace",
    );
    expect(stepTitled(guide, "Verify the installation").markdown).toContain(
      "`kubectl -n cache logs deployment/oneuptime-database-agent`",
    );
    expect(
      topicOf(guide.troubleshooting, "The agent cannot connect to the database")
        .markdown,
    ).toContain("`<service>.cache.svc.cluster.local`");
    expect(
      topicOf(guide.troubleshooting, "The agent container keeps restarting")
        .markdown,
    ).toContain("`kubectl -n cache logs deployment/oneuptime-database-agent`");
    expect(
      topicOf(
        rowGuide({ ...database, isKubernetes: false }).troubleshooting,
        "The agent container keeps restarting",
      ).markdown,
    ).not.toContain("kubectl");
    expect(
      topicOf(guide.advanced, "What the agent collects").markdown,
    ).toContain("The OneUptime Database Agent collects Valkey engine metrics");
  });

  test("before a key is picked the Secret shows the placeholder, and says to pick one", () => {
    const kubernetes: string = variantOf(
      rowGuide(database, {
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
        hasApiKey: false,
      }),
      "Kubernetes",
    );
    expect(kubernetes).toContain(
      `--from-literal=ONEUPTIME_TELEMETRY_INGESTION_KEY='${SETUP_GUIDE_API_KEY_PLACEHOLDER}'`,
    );
    expect(kubernetes).toContain("Pick an ingestion key in step 1");
  });

  test("a row without a namespace deploys into default", () => {
    const withoutNamespace: SetupGuideContent = rowGuide({
      ...database,
      kubernetesNamespace: "  ",
    });
    expect(variantOf(withoutNamespace, "Kubernetes")).toContain(
      "kubectl -n default create configmap",
    );
    expect((withoutNamespace.prerequisites || [])[0]).toContain(
      "`kubectl` access to the `default` namespace",
    );
  });

  test("a database outside Kubernetes never gets the Deployment", () => {
    const outside: SetupGuideContent = rowGuide({
      ...database,
      isKubernetes: false,
    });
    expect(variantLabels(stepTitled(outside, "Install the agent"))).toEqual([
      "Install script",
      "Docker Compose",
    ]);
    expect(getSetupGuideMarkdown(outside)).not.toContain("kubectl");
  });
});

describe("a row the guide cannot fully prefill", () => {
  test("without an address, the script asks for the name and the samples say to replace it", () => {
    const guide: SetupGuideContent = rowGuide({
      id: DATABASE_ID,
      dbSystem: "postgresql",
    });
    expect(installCommandOf(variantOf(guide, "Install script"))).toBe(
      `ONEUPTIME_URL=${URL} ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY} DATABASE_SYSTEM=postgresql DATABASE_SERVER_ID=${DATABASE_ID} bash install.sh`,
    );
    expect(guide.intro).toContain(
      "the install script asks for the host name your applications use to reach it, and in the samples below replace `db.example.com` with that name",
    );
    expect(envBlockOf(variantOf(guide, "Docker Compose"))).toContain(
      "\nDATABASE_SERVER_ADDRESS=db.example.com\n",
    );
  });

  test("a SQL Server named instance without a port leaves the port to the reader", () => {
    const guide: SetupGuideContent = rowGuide({
      id: DATABASE_ID,
      dbSystem: "microsoft.sql_server",
      serverAddress: "sql1.corp.example.com\\inst01",
    });
    const command: string = installCommandOf(
      variantOf(guide, "Install script"),
    );
    expect(command).toBe(
      `ONEUPTIME_URL=${URL} ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY} DATABASE_SYSTEM=microsoft.sql_server DATABASE_SERVER_ADDRESS=sql1.corp.example.com DATABASE_SERVER_ID=${DATABASE_ID} bash install.sh`,
    );
    expect(command).not.toContain("\\");
    expect(guide.intro).toContain("named instance `inst01`");
    expect(guide.intro).toContain(
      "| `DATABASE_SERVER_PORT` | `<instance-tcp-port>` |",
    );
    expect(envBlockOf(variantOf(guide, "Docker Compose"))).toContain(
      "\nDATABASE_ENDPOINT_PORT=<instance-tcp-port>\n",
    );
  });
});

describe("the troubleshooting of each engine's login", () => {
  test.each([...DATABASE_AGENT_ENGINES])(
    "%s: names the errors its own receiver logs",
    (engine: DatabaseAgentEngine) => {
      const guide: SetupGuideContent = productGuide(
        getDatabaseAgentSystem(engine),
      );
      const topic: SetupGuideTopic | undefined = (
        guide.troubleshooting || []
      ).find((candidate: SetupGuideTopic): boolean => {
        return candidate.title.startsWith("Login");
      });

      if (engine === "memcached") {
        expect(topic).toBeUndefined();
        return;
      }

      const hasTls: boolean = engine !== "sqlserver" && engine !== "oracledb";
      expect(topic!.title).toBe(
        hasTls
          ? "Login, permission or TLS errors in the collector log"
          : "Login or permission errors in the collector log",
      );
      expect(topic!.markdown.includes("TLS errors")).toBe(hasTls);
      expect(topic!.markdown).toContain(
        "the monitoring user is missing the grants from step 2",
      );
      expect(topic!.markdown).toContain("every `$` must be written as `$$`");

      /*
       * Every message named is one troubleshoot.sh looks for, and each is
       * named only for its own engine.
       */
      const troubleshoot: string = readAgentFile("troubleshoot.sh");
      const named: Array<string> = Array.from(
        topic!.markdown.matchAll(/^- ((?:`[^`]+`(?:, )?)+)/gm),
      ).flatMap((match: RegExpMatchArray): Array<string> => {
        return Array.from(match[1]!.matchAll(/`([^`]+)`/g)).map(
          (inner: RegExpMatchArray): string => {
            return inner[1]!.split(" …")[0]!;
          },
        );
      });
      expect(named.length).toBeGreaterThanOrEqual(2);
      for (const message of named) {
        if (message.startsWith("ORA-125") || message.startsWith("ORA-2800")) {
          continue;
        }
        if (
          message === "pg_stat_statements" ||
          message === "failed to explain"
        ) {
          expect(troubleshoot).toContain(message);
          continue;
        }
        expect({
          engine,
          message,
          checked: troubleshoot.includes(message),
        }).toEqual({ engine, message, checked: true });
      }
    },
  );

  test("only SQL Server is told about what its connection string cannot carry", () => {
    for (const engine of DATABASE_AGENT_ENGINES) {
      expect(
        getSetupGuideMarkdown(
          productGuide(getDatabaseAgentSystem(engine)),
        ).includes("the receiver's connection string cannot carry them"),
      ).toBe(engine === "sqlserver");
    }
  });

  test("only Oracle is told about its listener and locked accounts", () => {
    const oracle: string = getSetupGuideMarkdown(productGuide("oracle.db"));
    expect(oracle).toContain("`ORA-12514` or `ORA-12505`");
    expect(oracle).toContain("`lsnrctl services`");
    expect(oracle).toContain("`ORA-28000` or `ORA-28001`");
    expect(getSetupGuideMarkdown(productGuide("postgresql"))).not.toContain(
      "ORA-",
    );
  });
});

describe("the agent's own files back what the guide says", () => {
  const installScript: string = readAgentFile("install.sh");
  const troubleshoot: string = readAgentFile("troubleshoot.sh");
  const compose: string = readAgentFile("docker-compose.yml");
  const readme: string = readAgentFile("README.md");

  test("install.sh takes the URL and key from its environment before it prompts", () => {
    expect(installScript).toMatch(
      /if \[ -z "\$ONEUPTIME_URL" \]; then\n\s+prompt_required ONEUPTIME_URL/,
    );
    expect(installScript).toMatch(
      /if \[ -z "\$ONEUPTIME_TELEMETRY_INGESTION_KEY" \]; then\n\s+prompt_required ONEUPTIME_TELEMETRY_INGESTION_KEY/,
    );
    expect(installScript).toMatch(/if \[ -z "\$DATABASE_SYSTEM" \]; then/);
    expect(installScript).toMatch(
      /if \[ -z "\$DATABASE_SERVER_ADDRESS" \]; then/,
    );
  });

  test("install.sh and troubleshoot.sh default to the directory the guide names, and take another", () => {
    expect(installScript).toContain(
      `INSTALL_DIR="\${INSTALL_DIR:-${DATABASE_AGENT_INSTALL_DIRECTORY}}"`,
    );
    expect(troubleshoot).toContain(`DIR="${DATABASE_AGENT_INSTALL_DIRECTORY}"`);
    expect(troubleshoot).toMatch(/-d\|--dir\)\s+DIR=/);
  });

  test("every agent file a guide downloads exists", () => {
    const urls: Set<string> = new Set<string>();
    for (const system of SYSTEMS) {
      for (const guide of [
        productGuide(system),
        rowGuide({
          id: DATABASE_ID,
          dbSystem: system,
          endpoints: ["db.svc.data.svc.cluster.local:1234@prod"],
          kubernetesNamespace: "data",
          isKubernetes: true,
        }),
      ]) {
        for (const block of getSetupGuideCodeBlocks(guide)) {
          for (const match of block.matchAll(
            new RegExp(`${DATABASE_AGENT_RAW_URL}/(\\S+)`, "g"),
          )) {
            urls.add(match[1]!);
          }
        }
      }
    }
    expect([...urls].sort()).toEqual(
      [
        "install.sh",
        "troubleshoot.sh",
        "docker-compose.yml",
        ...DATABASE_AGENT_ENGINES.map((engine: DatabaseAgentEngine): string => {
          return `configs/${engine}.yaml`;
        }),
      ].sort(),
    );
    for (const file of urls) {
      expect({
        file,
        exists: fs.existsSync(path.join(AGENT_DIR, file)),
      }).toEqual({ file, exists: true });
    }
  });

  test("the connection help matches the compose file's own switches", () => {
    expect(compose).toContain('- "host.docker.internal:host-gateway"');
    expect(compose).toContain("# network_mode: host");
  });

  test("applying an edit recreates the container, as the README says", () => {
    expect(readme).toContain("docker compose up -d --force-recreate");
    expect(
      topicOf(
        productGuide("postgresql").advanced,
        "Upgrade or uninstall the agent",
      ).markdown,
    ).toContain("`docker compose up -d --force-recreate`");
  });

  test("the AI agent is described as install.sh runs it, per engine", () => {
    const supported: Array<string> = installScript
      .match(/^\s*([a-z|]+)\) AI_SUPPORTED="true" ;;$/m)![1]!
      .split("|");
    expect(compose).toContain("\n  oneuptime-database-ai-agent:\n");
    for (const engine of DATABASE_AGENT_ENGINES) {
      const files: string = topicOf(
        productGuide(getDatabaseAgentSystem(engine)).advanced,
        "The files the agent runs",
      ).markdown;
      expect(files).toContain("`oneuptime-database-ai-agent`");
      expect({
        engine,
        runsNothing: files.includes("so it runs nothing"),
      }).toEqual({ engine, runsNothing: !supported.includes(engine) });
    }
  });

  test("the credentials the script asks for follow install.sh's LOGIN", () => {
    const required: Array<string> = installScript
      .match(/^\s*([a-z|]+)\) LOGIN="required" ;;$/m)![1]!
      .split("|");
    const none: Array<string> = installScript
      .match(/^\s*([a-z|]+)\) LOGIN="none" ;;$/m)![1]!
      .split("|");
    for (const engine of DATABASE_AGENT_ENGINES) {
      const script: string = variantOf(
        productGuide(getDatabaseAgentSystem(engine)),
        "Install script",
      );
      let expected: string =
        "the monitoring credentials, if the server has users";
      if (required.includes(engine)) {
        expected = "the monitoring credentials (the password";
      }
      if (none.includes(engine)) {
        expect(script).not.toContain("monitoring credentials");
        continue;
      }
      expect({ engine, said: script.includes(expected) }).toEqual({
        engine,
        said: true,
      });
    }
    // Only Oracle is asked for a service name.
    expect(installScript).toMatch(
      /if \[ "\$AGENT_CONFIG" = "oracledb" \] && \[ -z "\$DATABASE_ORACLE_SERVICE" \]/,
    );
    for (const engine of DATABASE_AGENT_ENGINES) {
      expect(
        variantOf(
          productGuide(getDatabaseAgentSystem(engine)),
          "Install script",
        ).includes("the Oracle service name"),
      ).toBe(engine === "oracledb");
    }
  });

  test("query events are offered for exactly the configs install.sh asks about", () => {
    const withEvents: Array<string> = installScript
      .match(/^\s*([a-z|]+)\) HAS_QUERY_EVENTS="true" ;;$/m)![1]!
      .split("|");
    for (const engine of DATABASE_AGENT_ENGINES) {
      expect({
        engine,
        offered: topicTitles(
          productGuide(getDatabaseAgentSystem(engine)).advanced,
        ).includes("Query samples and top queries"),
      }).toEqual({ engine, offered: withEvents.includes(engine) });
    }
  });

  test("the TLS switches are offered for exactly the configs that read them", () => {
    const withoutTls: Array<string> = installScript
      .match(/^\s*([a-z|]+)\) HAS_TLS="" ;;$/m)![1]!
      .split("|");
    for (const engine of DATABASE_AGENT_ENGINES) {
      expect({
        engine,
        tls: getSetupGuideMarkdown(
          productGuide(getDatabaseAgentSystem(engine)),
        ).includes("TLS errors"),
      }).toEqual({ engine, tls: !withoutTls.includes(engine) });
    }
  });
});

/*
 * An engine the agent ships no config for: the guide is the collector
 * config that sends its engine metrics with this database's identity — or,
 * for an in-process engine, the application traces its page fills in from.
 */
describe("an engine the agent has no config for", () => {
  const OWN_SYSTEMS: Array<DatabaseSystemDescriptor> = DATABASE_SYSTEMS.filter(
    (descriptor: DatabaseSystemDescriptor): boolean => {
      return getDatabaseAgentEngine(descriptor.system) === null;
    },
  );

  function ownGuide(
    database: DatabaseDocumentationTarget,
    overrides?: { apiKey?: string; hasApiKey?: boolean },
  ): SetupGuideContent {
    return getDatabaseOwnCollectorSetupGuide({
      oneuptimeUrl: URL,
      apiKey: overrides?.apiKey ?? KEY,
      hasApiKey: overrides?.hasApiKey,
      database: database,
      databaseHealthMonitorUrl: HEALTH_URL,
      recommendationsUrl: RECOMMENDATIONS_URL,
    });
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

  test("covers every catalog engine the agent does not", () => {
    expect(OWN_SYSTEMS.length).toBeGreaterThan(20);
    expect(OWN_SYSTEMS.length + SYSTEMS.length).toBe(DATABASE_SYSTEMS.length);
  });

  test.each(
    OWN_SYSTEMS.map((descriptor: DatabaseSystemDescriptor): string => {
      return descriptor.system;
    }),
  )("%s gets a guide in the setup layout", (system: string) => {
    const descriptor: DatabaseSystemDescriptor = OWN_SYSTEMS.find(
      (candidate: DatabaseSystemDescriptor): boolean => {
        return candidate.system === system;
      },
    )!;
    const database: DatabaseDocumentationTarget = rowFor(descriptor);
    const guide: SetupGuideContent = ownGuide(database);
    const markdown: string = getSetupGuideMarkdown(guide);

    // No picker, no agent install: the Documentation tab of one database.
    expect(markdown).not.toContain("install.sh");
    expect(markdown).not.toContain("docker compose");
    expect(guide.keyStep).toEqual({
      description: expect.any(String),
      endpointLabel: "OTLP endpoint",
      endpointValue: `${URL}/otlp`,
    });
    expect(guide.intro).toContain(
      "The OneUptime Database Agent ships configs for PostgreSQL",
    );
    for (const step of guide.steps) {
      expectPlainOneLine(step.description);
    }
    for (const topic of guide.advanced || []) {
      expectPlainOneLine(topic.summary);
    }
    for (const link of guide.links || []) {
      expect(
        fs.existsSync(
          path.join(
            REPO_ROOT,
            "packages/App/FeatureSet/Docs/Content/en",
            `${link.url.replace(/^\/docs\//, "")}.md`,
          ),
        ),
      ).toBe(true);
    }

    if (descriptor.engineMetrics.kind === "embedded") {
      expect(
        guide.steps.map((step: SetupGuideStep): string => {
          return step.title;
        }),
      ).toEqual(["Instrument your application"]);
      expect(guide.intro).toContain("runs inside your application's process");
      expect(
        stepTitled(guide, "Instrument your application").markdown,
      ).toContain(
        `export OTEL_EXPORTER_OTLP_ENDPOINT=${URL}/otlp\nexport OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=${KEY}`,
      );
      expect(markdown).not.toContain("resource/database");
      expect(markdown).toContain(`\`${DATABASE_ID}\``);
      return;
    }

    expect(
      guide.steps.map((step: SetupGuideStep): string => {
        return step.title;
      }),
    ).toEqual([guide.steps[0]!.title, "Verify the metrics arrive"]);

    // The collector config: well-formed, wired, and carrying URL, key and id.
    const configs: Array<{ language: string; body: string }> = codeBlocks(
      guide.steps[0]!.markdown || "",
    ).filter((block: { language: string; body: string }): boolean => {
      return block.language === "yaml";
    });
    expect(configs).toHaveLength(1);
    const config: string = configs[0]!.body;
    const parsed: {
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
    } = yaml.load(config) as never;
    for (const pipeline of Object.values(parsed.service?.pipelines || {})) {
      for (const receiver of pipeline.receivers) {
        expect(Object.keys(parsed.receivers || {})).toContain(receiver);
      }
      for (const processor of pipeline.processors) {
        expect(Object.keys(parsed.processors || {})).toContain(processor);
      }
      for (const exporter of pipeline.exporters) {
        expect(Object.keys(parsed.exporters || {})).toContain(exporter);
      }
    }
    expect(config).toContain(`endpoint: "${URL}/otlp"`);
    expect(config).toContain(`x-oneuptime-token: "${KEY}"`);
    expect(config).toContain(`value: "${DATABASE_ID}"`);
    expect(config).toContain("key: service.name\n        action: delete");

    // The same config the single-document guide shows.
    expect(
      getDatabaseOwnCollectorMarkdown({
        oneuptimeUrl: URL,
        apiKey: KEY,
        database: database,
      }),
    ).toContain(`\`\`\`yaml\n${config}\n\`\`\``);

    expect(topicTitles(guide.advanced)[0]).toBe("Alert on this database");
    expect(
      topicOf(guide.advanced, "Alert on this database").markdown,
    ).toContain(`\`oneuptime.database.server.id\` = \`${DATABASE_ID}\``);
    expect(topicTitles(guide.troubleshooting)).toEqual([
      'Engine metrics reads "Not connected"',
      "The metrics land on a Host, or a new Service appears",
    ]);
    expect(
      (guide.prerequisites || []).join("\n").includes("DATABASE_PASSWORD"),
    ).toBe(config.includes("${env:DATABASE_PASSWORD}"));
    expect(markdown).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
  });

  test("names the step after what the reader adds to the collector", () => {
    const title: (dbSystem: string) => string = (dbSystem: string): string => {
      return ownGuide({
        id: DATABASE_ID,
        dbSystem: dbSystem,
        serverAddress: "db.prod.example.com",
      }).steps[0]!.title;
    };
    expect(title("couchdb")).toBe("Add the couchdb receiver to your collector");
    expect(title("gcp.spanner")).toBe(
      "Add the google_cloud_spanner receiver to your collector",
    );
    expect(title("clickhouse")).toBe("Scrape ClickHouse's metrics endpoint");
    expect(title("dynamodb")).toBe(
      "Stamp this database's identity on its metrics",
    );
    expect(title("ibm.db2")).toBe(
      "Stamp this database's identity on its metrics",
    );
    expect(title("AcmeDB")).toBe(
      "Stamp this database's identity on its metrics",
    );
  });

  test("an unknown engine gets the identity stamp under its raw name", () => {
    const guide: SetupGuideContent = ownGuide({
      id: DATABASE_ID,
      dbSystem: "AcmeDB",
      serverAddress: "acme.prod.example.com",
    });
    const step: string = guide.steps[0]!.markdown || "";
    expect(step).toContain("OneUptime does not know AcmeDB's engine yet");
    expect(step).toContain("value: acmedb");
    expect(step).toContain('value: "acme.prod.example.com"');
  });

  test("before a key is picked the config shows the placeholder, and says to pick one", () => {
    const guide: SetupGuideContent = ownGuide(
      {
        id: DATABASE_ID,
        dbSystem: "couchdb",
        serverAddress: "couch.example.com",
      },
      { apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER },
    );
    const step: string = guide.steps[0]!.markdown || "";
    expect(step).toContain(
      `x-oneuptime-token: "${SETUP_GUIDE_API_KEY_PLACEHOLDER}"`,
    );
    expect(step).toContain("Pick an ingestion key in step 1");

    const embedded: string =
      ownGuide(
        { id: DATABASE_ID, dbSystem: "sqlite" },
        { apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER },
      ).steps[0]!.markdown || "";
    // Quoted, so the shell does not read `<` and `>` as redirections.
    expect(embedded).toContain(
      `export OTEL_EXPORTER_OTLP_HEADERS='x-oneuptime-token=${SETUP_GUIDE_API_KEY_PLACEHOLDER}'`,
    );
    expect(embedded).toContain("Pick an ingestion key in step 1");
  });

  test("a row without an address says to replace the placeholder name", () => {
    const step: string =
      ownGuide({ id: DATABASE_ID, dbSystem: "couchdb" }).steps[0]!.markdown ||
      "";
    expect(step).toContain(
      "This database has no address yet, so replace `db.example.com`",
    );
  });
});

describe("the Documentation tab's heading", () => {
  test("an engine the agent monitors is told to install it", () => {
    expect(
      getDatabaseDocumentationHeading({ id: DATABASE_ID, dbSystem: "mariadb" }),
    ).toEqual({
      title: "Connect MariaDB engine metrics",
      description:
        "Install the OneUptime Database Agent next to this database to add its engine metrics. Every value below is prefilled for this database, including its id.",
    });
  });

  test("another engine is pointed at its own collector, not the agent", () => {
    const heading: { title: string; description: string } =
      getDatabaseDocumentationHeading({ id: DATABASE_ID, dbSystem: "couchdb" });
    expect(heading.title).toBe("Connect CouchDB engine metrics");
    expect(heading.description).toContain("your own OpenTelemetry Collector");
    expect(heading.description).not.toContain(
      "Install the OneUptime Database Agent",
    );
  });

  test("an in-process engine is told there is no server to monitor", () => {
    const heading: { title: string; description: string } =
      getDatabaseDocumentationHeading({ id: DATABASE_ID, dbSystem: "sqlite" });
    expect(heading.title).toBe("Monitor SQLite");
    expect(heading.description).toContain(
      "runs inside your application's process",
    );
  });
});
