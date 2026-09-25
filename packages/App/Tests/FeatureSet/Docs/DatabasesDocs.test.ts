import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
  getCollectorReceiverComponentName,
  getDatabaseSystemDescriptor,
  getDatabaseSystemDisplayName,
  getDatabaseReceiverSystemHint,
  getDatabaseSystemMetricsEngine,
  isAutoCreatableDatabaseSystem,
  normalizeDatabaseSystem,
  refineDatabaseSystemFromVersion,
} from "Common/Types/DatabaseServer/DatabaseSystem";
import {
  DatabaseServerMetricDefinition,
  getDatabaseServerMetrics,
} from "Common/Types/DatabaseServer/DatabaseServerMetricCatalog";
import { isDatabaseConnectionSpanName } from "Common/Types/DatabaseServer/DatabaseConnectionSpan";
import {
  buildDatabaseServerDisplayName,
  canonicalizeDatabaseEndpoint,
  DatabaseEndpoint,
  formatDatabaseEndpoint,
  getDatabaseEndpointScope,
  isHostRelativeDatabaseHost,
  isLoopbackDatabaseHost,
  NETWORK_SCOPED_NAME_SUFFIXES,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";
import { classifyContainer } from "Common/Types/DatabaseServer/DatabaseContainerClassifier";
import {
  classifyContainerCommand,
  ContainerCommandRole,
  reduceContainerCommand,
} from "Common/Types/DatabaseServer/DatabaseContainerCommand";
import {
  DatabaseAlertTemplate,
  getDatabaseAlertTemplates,
} from "Common/Types/Monitor/DatabaseAlertTemplates";
import { resolveDatabaseFromResourceAttributes } from "Common/Types/DatabaseServer/DatabaseTelemetryResolver";
import {
  DATABASE_LIVENESS_DESCRIPTION,
  DATABASE_SERVER_LIVE_WINDOW_MINUTES,
  DatabaseEngineMetricsStatus,
  DatabaseLivenessStatus,
  getDatabaseEngineMetricsStatusLabel,
  getDatabaseLivenessLabel,
} from "../../../FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import path from "path";

/*
 * The Databases docs hub against the Database Agent and the product it
 * describes.
 *
 * Markdown is not compiled, so nothing else notices when the agent's
 * docker-compose.yml gains a variable the page never explains, the
 * Kubernetes manifest or the .env sample falls behind the compose file, a
 * config starts enabling a metric the "What Gets Collected" table does not
 * list, the engine registry learns a receiver the "own collector" section
 * does not name, or an anchor points at a heading that was renamed. Each
 * test reads the source of truth — the compose file, the configs, the
 * registries, the nav — and checks the page still tells the same story.
 *
 * The configs are read as text on purpose (this package has no YAML types);
 * their structure — the identity stamp, the blank-safe id, no
 * resourcedetection — is pinned by Tests/Ops/DatabaseAgentConfigs.test.js,
 * and `otelcol validate` runs them for real (Tests/Ops/
 * validate-collector-configs.sh).
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CONTENT_DIR: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content",
);
const AGENT_DIR: string = path.join(REPO_ROOT, "agents/DatabaseAgent");
const CONFIG_DIR: string = path.join(AGENT_DIR, "configs");

const PAGE: string = "telemetry/databases";
const PAGE_URL: string = `/docs/${PAGE}`;

/* The engines the agent ships a config for, by file name (= receiver type). */
const AGENT_ENGINES: ReadonlyArray<string> = [
  "postgresql",
  "mysql",
  "redis",
  "mongodb",
  "sqlserver",
  "oracledb",
  "elasticsearch",
  "memcached",
];

/* The engine row labels of the "What Gets Collected" table. */
const COLLECTED_ROW_LABELS: Readonly<Record<string, string>> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  redis: "Redis / Valkey / KeyDB / Dragonfly",
  mongodb: "MongoDB",
  sqlserver: "SQL Server",
  oracledb: "Oracle",
  elasticsearch: "Elasticsearch / OpenSearch",
  memcached: "Memcached",
};

/* Configs whose receiver has no optional metric worth switching on. */
const ENGINES_WITHOUT_EXTRA_METRICS: ReadonlyArray<string> = ["memcached"];

/*
 * The canonical engine each config is named after (what install.sh writes
 * as DATABASE_SYSTEM when the user picks that engine by its own name).
 */
const CONFIG_SYSTEM: Readonly<Record<string, string>> = {
  postgresql: "postgresql",
  mysql: "mysql",
  redis: "redis",
  mongodb: "mongodb",
  sqlserver: "microsoft.sql_server",
  oracledb: "oracle.db",
  elasticsearch: "elasticsearch",
  memcached: "memcached",
};

const FENCE_LINE: RegExp = /^\s*```/;
/* A key (or comment) at the receiver's own level or above: a block ends. */
const RECEIVER_LEVEL_LINE: RegExp = /^ {0,4}[a-z#]/;
/* Bare environment variable names in the compose file's environment block. */
const COMPOSE_ENV_LINE: RegExp = /^\s*-\s*([A-Z][A-Z0-9_]+)=/;
/* A backticked token shaped like an environment variable. */
const ENV_TOKEN: RegExp = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
/* The image pin, wherever it is written. */
const COLLECTOR_PIN: RegExp =
  /otel\/opentelemetry-collector-contrib:(\d+\.\d+\.\d+)/g;

function pageFile(relative: string): string {
  return path.join(CONTENT_DIR, "en", `${relative}.md`);
}

function readPage(relative: string = PAGE): string {
  return fs.readFileSync(pageFile(relative), "utf8");
}

function readAgentFile(relative: string): string {
  return fs.readFileSync(path.join(AGENT_DIR, relative), "utf8");
}

function readConfig(engine: string): string {
  return fs.readFileSync(path.join(CONFIG_DIR, `${engine}.yaml`), "utf8");
}

/* The page's lines outside fenced code blocks. */
function proseLines(markdown: string): Array<string> {
  const lines: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence) {
      lines.push(line);
    }
  }

  return lines;
}

/* The body of one heading's section, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const body: Array<string> = [];
  let inFence: boolean = false;

  for (const line of lines.slice(start + 1)) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
    }

    const match: RegExpMatchArray | null = inFence
      ? null
      : line.match(/^(#{1,6})\s/);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

/* Fenced code blocks of some markdown, each as its full text between the fences. */
function codeBlocks(markdown: string): Array<string> {
  const blocks: Array<string> = [];
  let current: Array<string> | null = null;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      if (current) {
        blocks.push(current.join("\n"));
        current = null;
      } else {
        current = [];
      }
      continue;
    }

    if (current) {
      current.push(line);
    }
  }

  return blocks;
}

/* Heading ids of a page, computed the way the renderer computes them. */
function headingSlugs(markdown: string): Set<string> {
  const slugs: Set<string> = new Set<string>();

  for (const line of proseLines(markdown)) {
    const heading: RegExpMatchArray | null = line.match(/^#{1,6}\s+(.*)$/);

    if (heading && heading[1]) {
      slugs.add(slugify(heading[1].trim()));
    }
  }

  return slugs;
}

/* Backticked tokens outside code blocks. */
function backtickedTokens(markdown: string): Array<string> {
  return proseLines(markdown).flatMap((line: string): Array<string> => {
    return Array.from(line.matchAll(/`([^`\n]+)`/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );
  });
}

/* The first backticked token of every row of the first table in some markdown. */
function firstColumnTokens(markdown: string): Array<string> {
  const tokens: Array<string> = [];

  for (const line of markdown.split("\n")) {
    const match: RegExpMatchArray | null = line.match(/^\|\s*`([^`]+)`\s*\|/);

    if (match) {
      tokens.push(match[1] as string);
    }
  }

  return tokens;
}

/* Environment variables the agent's docker-compose.yml passes to the collector. */
function composeEnvironmentVariables(): Array<string> {
  const names: Array<string> = [];

  for (const line of readAgentFile("docker-compose.yml").split("\n")) {
    const match: RegExpMatchArray | null = line.match(COMPOSE_ENV_LINE);

    if (match) {
      names.push(match[1] as string);
    }
  }

  expect(names.length).toBeGreaterThan(0);

  return names;
}

/* Every ${env:NAME} a config reads. */
function configEnvironmentVariables(engine: string): Array<string> {
  return Array.from(
    readConfig(engine).matchAll(/\$\{env:([A-Z][A-Z0-9_]*)\}/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });
}

/*
 * The receiver's `metrics:` block of a config: from `    metrics:` (four
 * spaces, under receivers.<engine>) to the next key at four spaces or less.
 */
function receiverMetricsBlock(engine: string): string {
  const lines: Array<string> = readConfig(engine).split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line === "    metrics:";
  });

  if (start < 0) {
    return "";
  }

  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    if (RECEIVER_LEVEL_LINE.test(line)) {
      break;
    }
    body.push(line);
  }

  return body.join("\n");
}

/*
 * Metrics a config switches on: the `<name>:` / `enabled: true` pairs of
 * the receiver's metrics block (the metrics sit at six spaces under
 * receivers.<engine>.metrics in every config). Not only `<engine>.*`: the
 * elasticsearch receiver also emits `jvm.*`.
 */
function enabledMetrics(engine: string): Array<string> {
  return Array.from(
    receiverMetricsBlock(engine).matchAll(
      /^ {6}([a-z0-9_.]+):\n {8}enabled: true$/gm,
    ),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });
}

/* The "other optional metrics, all off by default" a config lists in a comment. */
function commentedOptionalMetrics(engine: string): Array<string> {
  return Array.from(
    readConfig(engine).matchAll(
      new RegExp(`^\\s*#\\s+(${engine}\\.[a-z0-9_.]+)\\s+\\(`, "gm"),
    ),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });
}

/*
 * install.sh's case tables, as { input pattern → output } pairs: which
 * spellings normalize_engine accepts and the engine it writes, and which
 * config config_for_engine picks for each engine.
 */
function installCaseTable(functionName: string): Array<{
  inputs: Array<string>;
  output: string;
}> {
  const match: RegExpMatchArray | null = readAgentFile("install.sh").match(
    new RegExp(`\\n${functionName}\\(\\) \\{([\\s\\S]*?)\\n\\}`),
  );

  expect({ functionName, found: Boolean(match) }).toEqual({
    functionName,
    found: true,
  });

  return Array.from(
    (match as RegExpMatchArray)[1]!.matchAll(
      /^\s+([a-z0-9._|]+)\) printf '([a-z0-9._]+)' ;;$/gm,
    ),
  ).map((row: RegExpMatchArray): { inputs: Array<string>; output: string } => {
    return {
      inputs: (row[1] as string).split("|"),
      output: row[2] as string,
    };
  });
}

function pinsIn(text: string): Array<string> {
  return Array.from(text.matchAll(COLLECTOR_PIN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function navGroup(title: string): NavGroup {
  const group: NavGroup | undefined = DocsNav.find(
    (item: NavGroup): boolean => {
      return item.title === title;
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
}

describe("Databases docs", (): void => {
  describe("page", (): void => {
    it("ships in English and opens with the nav's title", (): void => {
      expect(fs.existsSync(pageFile(PAGE))).toBe(true);
      expect(readPage().split("\n")[0]).toBe("# Databases");
    });

    it("keeps every code fence closed", (): void => {
      const fences: number = readPage()
        .split("\n")
        .filter((line: string): boolean => {
          return FENCE_LINE.test(line);
        }).length;

      expect(fences % 2).toBe(0);
    });

    it("only links to /docs/ pages that exist, and to headings those pages have", (): void => {
      const links: Array<RegExpMatchArray> = Array.from(
        proseLines(readPage())
          .join("\n")
          .matchAll(/\]\((\/docs\/[^)#]+)(?:#([^)]*))?\)/g),
      );

      expect(links.length).toBeGreaterThan(0);

      for (const link of links) {
        const target: string = (link[1] as string).replace("/docs/", "");
        const anchor: string | undefined = link[2];
        const exists: boolean = fs.existsSync(pageFile(target));

        expect({ target, exists }).toEqual({ target, exists: true });

        if (anchor) {
          expect({
            target,
            anchor,
            resolves: headingSlugs(readPage(target)).has(anchor),
          }).toEqual({ target, anchor, resolves: true });
        }
      }
    });

    it("only uses in-page anchors that a heading on the page produces", (): void => {
      const markdown: string = readPage();
      const slugs: Set<string> = headingSlugs(markdown);
      const anchors: Array<string> = Array.from(
        proseLines(markdown)
          .join("\n")
          .matchAll(/\]\(#([^)]*)\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(anchors.length).toBeGreaterThan(0);

      for (const anchor of anchors) {
        expect({ anchor, resolves: slugs.has(anchor) }).toEqual({
          anchor,
          resolves: true,
        });
      }
    });

    it("covers what the product needs explained: sources, the agent, Kubernetes, endpoints, lifecycle and troubleshooting", (): void => {
      const markdown: string = readPage();

      for (const heading of [
        "## How databases are detected",
        "### From application traces",
        "### From Kubernetes",
        "### From Docker and Podman",
        "### From the Database Agent or your own collector",
        "## The Database Agent",
        "## Kubernetes",
        "## Using your own OpenTelemetry Collector",
        "## Endpoints and the one-owner rule",
        "## Lifecycle, archiving and retention",
        "## Troubleshooting",
      ]) {
        expect({
          heading,
          present: markdown.includes(`\n${heading}\n`),
        }).toEqual({ heading, present: true });
      }

      const lifecycle: string = section(
        markdown,
        "## Lifecycle, archiving and retention",
      );

      expect(lifecycle).toContain("**Archive to dismiss.**");
      expect(lifecycle).toContain(
        "applies to telemetry collected from the database itself",
      );
      expect(section(markdown, "## Troubleshooting")).toContain(
        "receiver batches that do not name their server are ignored",
      );
    });
  });

  describe("navigation", (): void => {
    it("lists the hub in the Telemetry group, right after the VMware agent", (): void => {
      const links: Array<NavLink> = navGroup("Telemetry").links;
      const index: number = links.findIndex((link: NavLink): boolean => {
        return link.url === PAGE_URL;
      });

      expect(index).toBeGreaterThan(0);
      expect(links[index]?.title).toBe("Databases");
      expect(links[index - 1]?.url).toBe("/docs/telemetry/vmware");
    });

    /*
     * Docs/Index.ts resolves a request to the FIRST nav link whose URL
     * contains the requested path, so an earlier link containing this
     * page's path would steal it, and a later page whose path is a
     * substring of this URL would be served as this one.
     */
    it("is the link the docs router resolves the page to, and steals no other page", (): void => {
      const all: Array<NavLink> = DocsNav.flatMap(
        (group: NavGroup): Array<NavLink> => {
          return group.links;
        },
      );
      const resolved: NavLink | undefined = all.find(
        (link: NavLink): boolean => {
          return link.url.toLocaleLowerCase().includes(PAGE);
        },
      );

      expect(resolved?.url).toBe(PAGE_URL);

      const ownIndex: number = all.indexOf(resolved as NavLink);

      for (const link of all.slice(ownIndex + 1)) {
        const linkPath: string = link.url.replace("/docs/", "");

        expect({
          url: link.url,
          stolen: linkPath.length > 0 && PAGE_URL.includes(linkPath),
        }).toEqual({ url: link.url, stolen: false });
      }
    });
  });

  describe("the Database Agent", (): void => {
    it("documents every variable docker-compose.yml passes, and nothing it does not", (): void => {
      const compose: Array<string> = composeEnvironmentVariables();
      const table: Array<string> = firstColumnTokens(
        section(readPage(), "### Environment Variables"),
      );

      expect([...table].sort()).toEqual([...compose].sort());

      const readme: Array<string> = firstColumnTokens(
        section(readAgentFile("README.md"), "## Environment Variables"),
      );

      expect([...readme].sort()).toEqual([...compose].sort());
    });

    it("writes the same variables into the .env samples as docker-compose.yml passes", (): void => {
      const compose: Array<string> = [...composeEnvironmentVariables()].sort();

      const envSample: (markdown: string, heading: string) => Array<string> = (
        markdown: string,
        heading: string,
      ): Array<string> => {
        const block: string | undefined = codeBlocks(
          section(markdown, heading),
        ).find((text: string): boolean => {
          return text.split("\n").some((line: string): boolean => {
            return line.startsWith("ONEUPTIME_URL=");
          });
        });

        expect({ heading, sample: Boolean(block) }).toEqual({
          heading,
          sample: true,
        });

        return Array.from((block as string).matchAll(/^([A-Z][A-Z0-9_]+)=/gm))
          .map((match: RegExpMatchArray): string => {
            return match[1] as string;
          })
          .sort();
      };

      expect(envSample(readPage(), "### Alternative — Docker Compose")).toEqual(
        compose,
      );
      expect(
        envSample(
          readAgentFile("README.md"),
          "## Quick Start — Docker Compose",
        ),
      ).toEqual(compose);
    });

    it("passes every variable the configs read, and every variable passed is read by a config or by install.sh", (): void => {
      const compose: Set<string> = new Set<string>(
        composeEnvironmentVariables(),
      );
      const read: Set<string> = new Set<string>();

      for (const engine of AGENT_ENGINES) {
        for (const name of configEnvironmentVariables(engine)) {
          read.add(name);
          expect({ engine, name, passed: compose.has(name) }).toEqual({
            engine,
            name,
            passed: true,
          });
        }
      }

      const installScript: string = readAgentFile("install.sh");

      for (const name of compose) {
        expect({
          name,
          used: read.has(name) || installScript.includes(`$${name}`),
        }).toEqual({ name, used: true });
      }
    });

    it("mentions no variable the agent does not have, apart from the app-side tuning table", (): void => {
      const markdown: string = readPage();
      const known: Set<string> = new Set<string>([
        ...composeEnvironmentVariables(),
        ...firstColumnTokens(section(markdown, "## Self-hosted tuning")),
        // install.sh's install directory, which is not passed to the collector.
        "INSTALL_DIR",
        // Oracle's built-in role, which only looks like a variable.
        "SELECT_CATALOG_ROLE",
      ]);

      for (const token of backtickedTokens(markdown)) {
        if (ENV_TOKEN.test(token)) {
          expect({ token, known: known.has(token) }).toEqual({
            token,
            known: true,
          });
        }
      }
    });

    it("sets every compose variable in the Kubernetes manifest, and runs the pinned image there", (): void => {
      const manifest: string | undefined = codeBlocks(
        section(readPage(), "## Kubernetes"),
      ).find((text: string): boolean => {
        return text.includes("kind: Deployment");
      });

      expect(manifest).toBeDefined();

      const names: Array<string> = Array.from(
        (manifest as string).matchAll(/^\s*- name: ([A-Z][A-Z0-9_]+)$/gm),
      )
        .map((match: RegExpMatchArray): string => {
          return match[1] as string;
        })
        .sort();

      expect(names).toEqual([...composeEnvironmentVariables()].sort());

      const composePins: Array<string> = pinsIn(
        readAgentFile("docker-compose.yml"),
      );

      expect(composePins.length).toBe(1);
      expect(pinsIn(manifest as string)).toEqual(composePins);
    });

    it("keeps oneuptime.agent.version in every config in step with the image pin", (): void => {
      const pin: string = pinsIn(
        readAgentFile("docker-compose.yml"),
      )[0] as string;

      for (const engine of AGENT_ENGINES) {
        expect({
          engine,
          stamped: readConfig(engine).includes(
            `- key: oneuptime.agent.version\n        value: "${pin}"`,
          ),
        }).toEqual({ engine, stamped: true });
      }
    });

    it("ships one config per engine the page names, and the page names every config", (): void => {
      const shipped: Array<string> = fs
        .readdirSync(CONFIG_DIR)
        .filter((file: string): boolean => {
          return file.endsWith(".yaml");
        })
        .map((file: string): string => {
          return file.replace(/\.yaml$/, "");
        })
        .sort();

      expect(shipped).toEqual([...AGENT_ENGINES].sort());

      const markdown: string = readPage();

      for (const engine of AGENT_ENGINES) {
        expect(markdown).toContain(`\`configs/${engine}.yaml\``);
      }
    });

    it("gives the same monitoring-user grants as the agent's README", (): void => {
      const docs: Array<string> = codeBlocks(
        section(readPage(), "### Create a monitoring user"),
      );
      const readme: Array<string> = codeBlocks(
        section(readAgentFile("README.md"), "## Create a monitoring user"),
      );

      expect(docs.length).toBeGreaterThanOrEqual(AGENT_ENGINES.length);
      expect(docs).toEqual(readme);
    });
  });

  describe("the configs against the product's registries", (): void => {
    it("stamps db.system.name from DATABASE_SYSTEM, so a fork run by its family's config reports itself", (): void => {
      for (const engine of AGENT_ENGINES) {
        expect({
          engine,
          stamp: readConfig(engine).includes(
            '- key: db.system.name\n        value: "${env:DATABASE_SYSTEM}"\n        action: upsert',
          ),
        }).toEqual({ engine, stamp: true });
      }
    });

    it("install.sh writes only canonical engines, each run by a config whose receiver the engine registry lists for it", (): void => {
      const configs: Map<string, string> = new Map<string, string>();

      for (const row of installCaseTable("config_for_engine")) {
        for (const input of row.inputs) {
          configs.set(input, row.output);
        }
      }

      const written: Set<string> = new Set<string>();

      for (const row of installCaseTable("normalize_engine")) {
        const system: string = row.output;
        const descriptor: DatabaseSystemDescriptor | null =
          getDatabaseSystemDescriptor(system);
        const config: string | undefined = configs.get(system);

        written.add(system);

        // The value stamped as db.system.name is the engine's own.
        expect({ system, normalized: normalizeDatabaseSystem(system) }).toEqual(
          { system, normalized: system },
        );
        expect({ system, config: config ?? null }).toEqual({
          system,
          config: expect.any(String),
        });
        expect({
          system,
          config,
          monitors: descriptor?.receiverTypes.includes(config as string),
        }).toEqual({ system, config, monitors: true });
        expect(fs.existsSync(path.join(CONFIG_DIR, `${config}.yaml`))).toBe(
          true,
        );

        // Every spelling install.sh accepts means that engine to OneUptime.
        for (const input of row.inputs) {
          expect({ input, system: normalizeDatabaseSystem(input) }).toEqual({
            input,
            system,
          });
        }
      }

      // Every engine a shipped config monitors can be installed by name.
      for (const descriptor of DATABASE_SYSTEMS) {
        const runnable: boolean = AGENT_ENGINES.some(
          (engine: string): boolean => {
            return descriptor.receiverTypes.includes(engine);
          },
        );

        expect({
          system: descriptor.system,
          installable: written.has(descriptor.system),
        }).toEqual({ system: descriptor.system, installable: runnable });
      }

      // And every shipped config is reachable.
      expect([...new Set(configs.values())].sort()).toEqual(
        [...AGENT_ENGINES].sort(),
      );
    });

    it("gives every accepted engine the default port the engine registry has", (): void => {
      for (const row of installCaseTable("default_port_for")) {
        for (const system of row.inputs) {
          expect({ system, port: Number(row.output) }).toEqual({
            system,
            port: getDatabaseSystemDescriptor(system)?.defaultPort,
          });
        }
      }
    });

    it("never switches off, and never leaves off, a metric the Overview charts", (): void => {
      for (const engine of AGENT_ENGINES) {
        const catalog: Array<DatabaseServerMetricDefinition> =
          getDatabaseServerMetrics(
            getDatabaseSystemMetricsEngine(CONFIG_SYSTEM[engine]),
          );
        const config: string = readConfig(engine);
        const offByDefault: Set<string> = new Set<string>(
          commentedOptionalMetrics(engine),
        );

        for (const metric of catalog) {
          expect({
            engine,
            metric: metric.metricName,
            disabled: config.includes(
              `      ${metric.metricName}:\n        enabled: false`,
            ),
            leftOff: offByDefault.has(metric.metricName),
          }).toEqual({
            engine,
            metric: metric.metricName,
            disabled: false,
            leftOff: false,
          });
        }
      }
    });

    it("lists exactly the metrics each config switches on in the What Gets Collected table", (): void => {
      const table: string = section(readPage(), "### What Gets Collected");

      for (const engine of AGENT_ENGINES) {
        const label: string = COLLECTED_ROW_LABELS[engine] as string;
        const row: string | undefined = table
          .split("\n")
          .find((line: string): boolean => {
            return line.startsWith(`| ${label} |`);
          });

        expect({ engine, row: Boolean(row) }).toEqual({ engine, row: true });

        // Column 3: "Also enabled by the agent (off upstream)".
        const cell: string = ((row as string).split("|")[3] as string).trim();
        const listed: Array<string> = Array.from(
          cell.matchAll(/`([^`]+)`/g),
        ).map((match: RegExpMatchArray): string => {
          return match[1] as string;
        });
        const enabled: Array<string> = enabledMetrics(engine);

        expect({ engine, enablesSome: enabled.length > 0 }).toEqual({
          engine,
          enablesSome: !ENGINES_WITHOUT_EXTRA_METRICS.includes(engine),
        });

        const covers: (token: string, metric: string) => boolean = (
          token: string,
          metric: string,
        ): boolean => {
          return token.endsWith("*")
            ? metric.startsWith(token.slice(0, -1))
            : metric === token;
        };

        for (const metric of enabled) {
          expect({
            engine,
            metric,
            listed: listed.some((token: string): boolean => {
              return covers(token, metric);
            }),
          }).toEqual({ engine, metric, listed: true });
        }

        for (const token of listed) {
          expect({
            engine,
            token,
            enabled: enabled.some((metric: string): boolean => {
              return covers(token, metric);
            }),
          }).toEqual({ engine, token, enabled: true });
        }
      }
    });

    it("names every receiver the engine registry recognises in the own-collector section", (): void => {
      const intro: string = (
        section(readPage(), "## Using your own OpenTelemetry Collector").split(
          "\n",
        ) as Array<string>
      ).find((line: string): boolean => {
        return line.includes("receivers");
      }) as string;

      expect(intro).toBeDefined();

      const receivers: Array<string> = Array.from(intro.matchAll(/`([a-z]+)`/g))
        .map((match: RegExpMatchArray): string => {
          return match[1] as string;
        })
        .sort();

      const registry: Array<string> = Array.from(
        new Set<string>(
          DATABASE_SYSTEMS.flatMap(
            (descriptor: DatabaseSystemDescriptor): Array<string> => {
              return [...descriptor.receiverTypes];
            },
          ),
        ),
      ).sort();

      expect(receivers).toEqual(registry);
    });
  });

  /*
   * Rule 1 of the own-collector section lists, in order, the attributes a
   * receiver batch can name its server by. The resolver's candidate list is
   * the source of truth: a receiver whose attribute the page leaves out
   * reads as "ignored until you stamp server.address" when it is not.
   */
  it("names every attribute the resolver reads a batch's server from, in the resolver's order", (): void => {
    const resolver: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages/Common/Types/DatabaseServer/DatabaseTelemetryResolver.ts",
      ),
      "utf8",
    );
    const candidates: string | undefined = (
      resolver.match(
        /const candidates: Array<\{ address: string \| null; port: string \| null \}> = \[([\s\S]*?)\n {2}\];/,
      ) as RegExpMatchArray | null
    )?.[1];

    expect(candidates).toBeDefined();

    const addressAttributes: Array<string> = [
      "server.address",
      ...Array.from(
        (candidates as string).matchAll(
          /address: readAttribute\(attributes, "([a-z_.]+)"\)|readAttribute\(\s*attributes,\s*"(service\.instance\.id)",?\s*\)/g,
        ),
      ).map((match: RegExpMatchArray): string => {
        return (match[1] || match[2]) as string;
      }),
    ];
    const ruleOne: string = (
      section(readPage(), "## Using your own OpenTelemetry Collector").split(
        "\n",
      ) as Array<string>
    ).find((line: string): boolean => {
      return line.startsWith("1. **Every batch must name the server.**");
    }) as string;

    expect(ruleOne).toBeDefined();
    expect(addressAttributes.length).toBeGreaterThan(3);

    const positions: Array<number> = addressAttributes.map(
      (attribute: string): number => {
        const position: number = ruleOne.indexOf(`\`${attribute}\``);

        expect({ attribute, named: position >= 0 }).toEqual({
          attribute,
          named: true,
        });

        return position;
      },
    );

    expect(positions).toEqual(
      [...positions].sort((a: number, b: number): number => {
        return a - b;
      }),
    );
  });

  function ownCollectorRuleOne(): string {
    return (
      section(readPage(), "## Using your own OpenTelemetry Collector").split(
        "\n",
      ) as Array<string>
    ).find((line: string): boolean => {
      return line.startsWith("1. **Every batch must name the server.**");
    }) as string;
  }

  /*
   * Regression: the page said SAP HANA batches were ignored until stamped.
   * The resolver reads saphana.host now: a real hostname attaches (and may
   * create), a single-label one only ever joins.
   */
  it("says SAP HANA batches attach by HANA's own hostname, and a single-label one never creates", (): void => {
    const ruleOne: string = ownCollectorRuleOne();
    const hint: string | null = getDatabaseReceiverSystemHint([
      "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/saphanareceiver",
    ]);

    expect(ruleOne).toContain(
      "The `saphana` receiver's batches attach by HANA's own hostname",
    );
    expect(ruleOne).toContain(
      "a single-label name — which only joins a database that already has it and never creates one",
    );
    expect(ruleOne).toContain(
      `SAP HANA's default port, ${getDatabaseSystemDescriptor("sap.hana")?.defaultPort}`,
    );

    const named: ReturnType<typeof resolveDatabaseFromResourceAttributes> =
      resolveDatabaseFromResourceAttributes({
        attributes: {
          "db.system": "saphana",
          "saphana.host": "hana.prod.example.com",
        },
        receiverSystemHint: hint,
      });

    expect(named?.endpoint).toEqual({
      host: "hana.prod.example.com",
      port: 30015,
    });
    expect(named?.allowCreate).toBe(true);

    const singleLabel: ReturnType<
      typeof resolveDatabaseFromResourceAttributes
    > = resolveDatabaseFromResourceAttributes({
      attributes: { "db.system": "saphana", "saphana.host": "hana01" },
      receiverSystemHint: hint,
    });

    // Still an endpoint to join a database by, never one to create from.
    expect(singleLabel?.endpoint?.host).toBe("hana01");
    expect(singleLabel?.allowCreate).toBe(false);

    // The receiver is not among the ones "ignored until you stamp".
    const ignored: string = ruleOne.substring(
      ruleOne.indexOf("Receivers that report none of them"),
      ruleOne.indexOf("are ignored until"),
    );

    expect(ignored).not.toContain("HANA");
  });

  /*
   * The example is a raw server version string, as a batch may carry it —
   * not the `mysql` receiver's, which reports only the leading number (the
   * page once claimed it read `10.11.7-MariaDB…`), and that number names
   * no fork.
   */
  it("names the forks a server's version string refines, with an example the code refines", (): void => {
    const ruleOne: string = ownCollectorRuleOne();
    const example: RegExpMatchArray | null = ruleOne.match(
      /`db\.system\.version` holding [^(]*\(`([^`]+)` is (\w+)\)/,
    );

    expect(example).not.toBeNull();

    /*
     * e2e (collector 0.161.0): against MariaDB 11.4, whose VERSION() is
     * '11.4.13-MariaDB-ubu2404', the mysql receiver's db.system.version was
     * '11.4.13'. The page quotes that pair, and the bare number still names
     * MariaDB — by its major version, which MySQL never reached.
     */
    const receiverVersion: RegExpMatchArray | null = ruleOne.match(
      /The `mysql` receiver reports only the number there \(`([^`]+)`, never `([^`]+)`\)/,
    );

    expect(receiverVersion).not.toBeNull();
    expect(receiverVersion![1]).toBe("11.4.13");
    expect(
      refineDatabaseSystemFromVersion("mysql", receiverVersion![1] as string),
    ).toBe("mariadb");
    expect(
      refineDatabaseSystemFromVersion("mysql", receiverVersion![2] as string),
    ).toBe("mariadb");
    // What it reported for MySQL 8.4 in the same run stays MySQL.
    expect(refineDatabaseSystemFromVersion("mysql", "8.4.11")).toBe("mysql");
    // "not a MariaDB 5.5": its bare number is a MySQL one.
    expect(ruleOne).toContain("but not a MariaDB 5.5");
    expect(refineDatabaseSystemFromVersion("mysql", "5.5.68")).toBe("mysql");

    const [, version, forkName] = example as RegExpMatchArray;

    expect(
      getDatabaseSystemDisplayName(
        refineDatabaseSystemFromVersion("mysql", version as string),
      ),
    ).toBe(forkName);

    // Every other fork the resolver refines to by version is named too.
    const refinable: Array<string> = DATABASE_SYSTEMS.filter(
      (descriptor: DatabaseSystemDescriptor): boolean => {
        return Boolean(descriptor.versionPattern);
      },
    ).map((descriptor: DatabaseSystemDescriptor): string => {
      return descriptor.displayName;
    });

    expect(refinable).toContain(forkName);

    for (const displayName of refinable) {
      expect({ displayName, named: ruleOne.includes(displayName) }).toEqual({
        displayName,
        named: true,
      });
    }

    // ...and the agent's mysql config switches the version attribute on.
    expect(readConfig("mysql")).toMatch(
      /\n\s+db\.system\.version:\s*\n\s+enabled:\s*true/,
    );
    expect(ruleOne).toContain(
      "Stamping `db.system.name` with the fork's name is the reliable way",
    );
  });

  /*
   * The engine table is the page's promise about every engine OneUptime
   * knows: what it normalises spans to, its default port, its family,
   * whether traces create it and where its engine metrics come from. The
   * in-app Documentation tab builds its per-engine guide from the same
   * catalog, so a row that drifts from the catalog contradicts the product.
   */
  describe("the supported databases table", (): void => {
    const AGENT_CONFIG_FOR: (descriptor: DatabaseSystemDescriptor) => string = (
      descriptor: DatabaseSystemDescriptor,
    ): string => {
      return (
        AGENT_ENGINES.find((engine: string): boolean => {
          return descriptor.receiverTypes.includes(engine);
        }) || ""
      );
    };

    function expectedMetricsCell(descriptor: DatabaseSystemDescriptor): string {
      const source: DatabaseSystemDescriptor["engineMetrics"] =
        descriptor.engineMetrics;
      switch (source.kind) {
        case "receiver": {
          const agent: string = AGENT_CONFIG_FOR(descriptor);
          return agent
            ? `Database Agent (\`${agent}\` receiver)`
            : `\`${getCollectorReceiverComponentName(
                descriptor.receiverTypes[0] as string,
              )}\` receiver`;
        }
        case "prometheus":
          return `Prometheus, \`:${source.port}${source.path}\``;
        case "cloud-monitoring":
          return `\`${source.receiver}\` receiver (cloud monitoring)`;
        case "embedded":
          return "None (in-process)";
        default:
          return "None built in";
      }
    }

    function tableRows(): Map<string, Array<string>> {
      const rows: Map<string, Array<string>> = new Map<string, Array<string>>();

      for (const line of section(readPage(), "## Supported databases").split(
        "\n",
      )) {
        const cells: Array<string> = line
          .split("|")
          .slice(1, -1)
          .map((cell: string): string => {
            return cell.trim();
          });
        const system: RegExpMatchArray | null = (cells[1] || "").match(
          /^`([^`]+)`$/,
        );

        // Six cells and a backticked engine: a data row, not the header.
        if (cells.length === 6 && system && cells[0] !== "Engine") {
          expect({
            system: system[1],
            duplicate: rows.has(system[1] as string),
          }).toEqual({ system: system[1], duplicate: false });
          rows.set(system[1] as string, cells);
        }
      }

      return rows;
    }

    it("has one row per catalog engine and nothing else", (): void => {
      expect([...tableRows().keys()].sort()).toEqual(
        DATABASE_SYSTEMS.map((descriptor: DatabaseSystemDescriptor): string => {
          return descriptor.system;
        }).sort(),
      );
    });

    it("states each engine's name, default port, family, create policy and metrics source as the catalog has them", (): void => {
      const rows: Map<string, Array<string>> = tableRows();

      for (const descriptor of DATABASE_SYSTEMS) {
        const cells: Array<string> = rows.get(descriptor.system) || [];

        expect({ system: descriptor.system, cells }).toEqual({
          system: descriptor.system,
          cells: [
            descriptor.displayName,
            `\`${descriptor.system}\``,
            descriptor.defaultPort === null
              ? "—"
              : String(descriptor.defaultPort),
            descriptor.family
              ? getDatabaseSystemDisplayName(descriptor.family)
              : "—",
            isAutoCreatableDatabaseSystem(descriptor.system)
              ? "Yes"
              : descriptor.deployment === "embedded"
                ? "No (in-process)"
                : "No (cloud API)",
            expectedMetricsCell(descriptor),
          ],
        });
      }
    });

    it("is sorted by engine name, so a reader can find a row", (): void => {
      const names: Array<string> = [...tableRows().values()].map(
        (cells: Array<string>): string => {
          return cells[0] as string;
        },
      );

      expect(names).toEqual(
        [...names].sort((a: string, b: string): number => {
          return a.localeCompare(b);
        }),
      );
    });

    it("says the create policy follows the table, not a hand-kept list", (): void => {
      const policy: string = section(readPage(), "### From application traces");

      expect(policy).toContain(
        "the **Created from traces** column of [Supported databases](#supported-databases)",
      );
    });
  });

  describe("the discovery window", (): void => {
    const JOB: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages/App/FeatureSet/Workers/Jobs/TelemetryEntity/ComputeServiceDependencies.ts",
      ),
      "utf8",
    );

    /*
     * Regression: the page said "one 10-minute window" and "10 calls in ten
     * minutes" while the job counts calls over a 15-minute window, so an
     * operator tuning DATABASE_SERVER_MIN_CALLS got two thirds of the rate
     * they meant.
     */
    it("names the window the job really counts over, and how often it runs", (): void => {
      const windowMinutes: string = (
        JOB.match(
          /export const WINDOW_MINUTES: number = (\d+);/,
        ) as RegExpMatchArray | null
      )?.[1] as string;
      const schedule: string = (
        JOB.match(
          /const EVERY_TEN_MINUTES: string = "\*\/(\d+) \* \* \* \*";/,
        ) as RegExpMatchArray | null
      )?.[1] as string;

      expect(windowMinutes).toBeDefined();
      expect(schedule).toBeDefined();

      const markdown: string = readPage();
      const tuning: string = section(markdown, "## Self-hosted tuning");

      expect(tuning).toContain(
        `within the ${windowMinutes}-minute window each ${schedule}-minute run looks at`,
      );
      expect(section(markdown, "### From application traces")).toContain(
        `Every ${schedule} minutes OneUptime summarises the CLIENT spans your applications sent in the last ${windowMinutes} minutes`,
      );
      expect(markdown).toContain(
        `fewer than 10 queries in the last ${windowMinutes} minutes`,
      );
      expect(markdown).not.toMatch(/10-minute window|in ten minutes/);
    });
  });

  describe("the rest of the docs point here", (): void => {
    it.each([
      "monitor/database-health-monitor",
      "telemetry/kubernetes-agent",
      "telemetry/docker-host",
      "telemetry/podman-host",
      "inventory/overview",
    ])("%s links to the Databases page", (page: string): void => {
      expect(readPage(page)).toContain(`](${PAGE_URL})`);
    });

    it("the inventory's manual database type sends database servers to Databases", (): void => {
      const line: string | undefined = readPage("inventory/overview")
        .split("\n")
        .find((text: string): boolean => {
          return text.startsWith("- `external.database`");
        });

      expect(line).toBeDefined();
      expect(line).toContain("**Databases → Create Database**");
      expect(line).toContain(`](${PAGE_URL})`);
    });
  });

  describe("what the page promises beyond the agent", (): void => {
    it("explains how a monitor's alerts attach to a database", (): void => {
      const alerts: string = section(readPage(), "## Alerts on a database");

      expect(alerts).toContain("`oneuptime.database.server.id`");
      expect(alerts).toContain("**Alerts** and **Incidents** tabs");
      expect(alerts).toContain("cumulative counter");
    });

    it("says a database receiver's data stays the database's in a shared host or Kubernetes pipeline", (): void => {
      const troubleshooting: string = section(
        readPage(),
        "### The metrics land on a Host, or a new Service appears",
      );

      expect(troubleshooting).toContain(
        "A database receiver's data belongs to the database even when the receiver shares a collector",
      );
      expect(troubleshooting).toContain("`oneuptime.host.id`");
      // The old promise was the opposite.
      expect(troubleshooting).not.toContain(
        "the batch belongs to the Host first",
      );
      // What still makes a Host, and whose retention the re-homed data gets.
      expect(troubleshooting).toContain(
        "Only a single resource that itself also carries `system.*` or `process.*` metrics stays a Host",
      );
      expect(troubleshooting).toContain("the project's default");
      expect(troubleshooting).toContain(
        "neither registers an Inventory Host nor keeps one alive with a heartbeat",
      );
    });

    it("tells a hand-written .env and a Kubernetes Secret to double every $ in the password", (): void => {
      const markdown: string = readPage();

      expect(section(markdown, "### Alternative — Docker Compose")).toContain(
        "write every `$` in it as `$$`",
      );
      expect(section(markdown, "## Kubernetes")).toContain(
        "write every `$` in the password as `$$`",
      );
      // The old advice (single quotes fix `$`) is gone.
      expect(markdown).not.toContain("single-quote a password containing `$`");
    });

    /*
     * Regression: the hand-written .env samples doubled every `$` but did
     * not say so the way install.sh's own .env does, and install.sh read
     * such a file as holding the password as typed — the documented
     * upgrade (re-running it) doubled every `$` again. The samples now
     * open with install.sh's line, and nothing tells a reader that an .env
     * install.sh wrote needs its `$` doubled by a re-run.
     */
    it("opens the .env samples with install.sh's own line saying every $ is doubled", (): void => {
      const marker: string = (
        readAgentFile("install.sh").match(
          /^COLLECTOR_ESCAPE_MARKER="(.*)"$/m,
        ) as RegExpMatchArray
      )[1]!.replace(/\\\$/g, "$");

      expect(marker).toBe(
        "# DATABASE_USERNAME and DATABASE_PASSWORD are escaped for the collector: every $ is written as $$.",
      );
      for (const [markdown, heading] of [
        [readPage(), "### Alternative — Docker Compose"],
        [readAgentFile("README.md"), "## Quick Start — Docker Compose"],
      ] as Array<[string, string]>) {
        const sample: string | undefined = codeBlocks(
          section(markdown, heading),
        ).find((text: string): boolean => {
          return text.includes("\nONEUPTIME_URL=");
        });

        expect({ heading, first: (sample || "").split("\n")[0] }).toEqual({
          heading,
          first: marker,
        });
      }
      expect(readPage()).not.toContain("older `install.sh`");
    });

    /*
     * Regression: the pages said any character is fine in the password and
     * named only the semicolon for SQL Server, whose receiver builds an
     * unquoted connection string: a `"` or a surrounding space failed
     * every login with a plain "Login failed".
     */
    it("names every character the SQL Server connection string cannot carry, and how to reach a named instance", (): void => {
      for (const [markdown, heading] of [
        [readPage(), "#### SQL Server"],
        [readAgentFile("README.md"), "### SQL Server"],
      ] as Array<[string, string]>) {
        const text: string = section(markdown, heading);

        expect({ heading, text }).toEqual({
          heading,
          text: expect.stringContaining(
            'must not contain a semicolon (`;`) or a double quote (`"`), nor start or end with a space',
          ),
        });
        expect({ heading, text }).toEqual({
          heading,
          text: expect.stringContaining(
            "SELECT local_tcp_port FROM sys.dm_exec_connections WHERE session_id = @@SPID;",
          ),
        });
      }
      for (const markdown of [readPage(), readAgentFile("README.md")]) {
        for (const line of markdown.split("\n")) {
          if (line.includes("Any character is fine in the password")) {
            expect(line).toContain("SQL Server");
          }
        }
      }
    });

    /*
     * Regression: the diagnostic said "No problems found" over a receiver
     * error none of its patterns knew, and the docs sent MySQL's 1227
     * ("Access denied; you need … privilege(s)", a missing grant) to the
     * credentials bullet.
     */
    it("sends each collector-log error to the fix it needs", (): void => {
      const errors: string = section(
        readPage(),
        "### Login, permission or TLS errors in the collector log",
      );
      const bullet: (needle: string) => string = (needle: string): string => {
        return (
          errors.split("\n").find((line: string): boolean => {
            return line.startsWith("- ") && line.includes(needle);
          }) || ""
        );
      };

      expect(bullet("`password authentication failed`")).toContain(
        "`Access denied for user`",
      );
      expect(bullet("`password authentication failed`")).not.toContain(
        "`Access denied`,",
      );
      expect(bullet("`permission denied`")).toContain(
        "`Access denied; you need … privilege(s)`",
      );
      expect(bullet("`ORA-12514`")).toContain("`DATABASE_ORACLE_SERVICE`");
      expect(bullet("`ORA-28000`")).toContain("locked");
      expect(errors).toContain("any other receiver error");
    });

    /*
     * Regression: an upgrade backed up every file whose upstream version
     * changed — a collector pin bump changes them all — and told the user
     * to re-apply edits they never made.
     */
    /*
     * Regression: the page said the `mysql` receiver's db.system.version
     * reads `10.11.7-MariaDB…` and so names the fork. The pinned receiver
     * reports only the leading version number (`11.4.2`), which
     * refineDatabaseSystemFromVersion can never read as MariaDB; the fork
     * is named by the receiver's own db.system.name resource attribute.
     */
    it("names MariaDB the way the pinned mysql receiver actually can", (): void => {
      const markdown: string = readPage();
      const ownCollector: string = section(
        markdown,
        "## Using your own OpenTelemetry Collector",
      );

      const engine: string = section(
        markdown,
        "### Which engine a database shows",
      );
      const grants: string = section(markdown, "#### MySQL / MariaDB");

      expect(markdown).not.toContain("10.11.7-MariaDB");
      expect(ownCollector).toContain("`resource_attributes.db.system.name`");
      /*
       * Regression (e2e, collector 0.161.0): the page promised a "-MariaDB"
       * version string the receiver never sends. A MySQL-labelled agent
       * against MariaDB 11.4 reported the bare '11.4.13' and stayed MySQL.
       * The bare number now names MariaDB by its major version …
       */
      expect(engine).toContain(
        "`mysql` with `11.4.13`, the bare number the `mysql` receiver reports for MariaDB 11.4, is MariaDB",
      );
      expect(refineDatabaseSystemFromVersion("mysql", "11.4.13")).toBe(
        "mariadb",
      );
      // … a raw VERSION() string, as a span may carry it, still does …
      expect(
        refineDatabaseSystemFromVersion("mysql", "10.11.7-MariaDB-1:10.11.7"),
      ).toBe("mariadb");
      // … and DATABASE_SYSTEM=mariadb stays the reliable way.
      expect(grants).toContain(
        "Set `DATABASE_SYSTEM=mariadb` for a MariaDB server",
      );
      expect(grants).toContain("That is the reliable way.");
      expect(grants).toContain("but a MariaDB 5.5 stays MySQL");
      expect(refineDatabaseSystemFromVersion("mysql", "5.5.68")).toBe("mysql");
      // The receiver's db.system.name value is an engine OneUptime knows.
      expect(normalizeDatabaseSystem("mariadb")).toBe("mariadb");
    });

    it("promises a backup only for a file the user edited, and says how install.sh knows", (): void => {
      for (const [markdown, heading] of [
        [readPage(), "### Upgrading and uninstalling"],
        [readAgentFile("README.md"), "## Upgrading, Uninstalling"],
      ] as Array<[string, string]>) {
        const text: string = section(markdown, heading);

        expect({ heading, text }).toEqual({
          heading,
          text: expect.stringContaining("`.agent-files.sha256`"),
        });
        expect({ heading, text }).toEqual({
          heading,
          text: expect.stringContaining("a file nobody edited is replaced"),
        });
        /*
         * Regression (live re-verification): a re-run replaced the config
         * and ran a plain `up -d`, which Compose treats as nothing to do
         * when only a bind-mounted file changed — the old config kept
         * running. The script recreates the container; the pages say so.
         */
        expect({ heading, text }).toEqual({
          heading,
          text: expect.stringMatching(
            /recreates the agent's container|the agent's container is recreated/,
          ),
        });
        expect({ heading, text }).toEqual({
          heading,
          text: expect.stringContaining(
            "Apply any edit to `.env` or `otel-collector-config.yaml` with `docker compose up -d --force-recreate`",
          ),
        });
      }
      expect(readAgentFile("install.sh")).toContain(
        "\n    docker compose up -d --force-recreate\n",
      );
    });

    it("explains that PostgreSQL explain plans need table access, and that it is not a missing grant", (): void => {
      const markdown: string = readPage();

      expect(section(markdown, "#### PostgreSQL")).toContain(
        "`failed to explain`",
      );
      expect(
        section(
          markdown,
          "### Login, permission or TLS errors in the collector log",
        ),
      ).toContain(
        "`failed to explain` on PostgreSQL top queries is not a missing grant",
      );
    });
  });

  /*
   * Alerting: which monitors land on a database, and what can be
   * thresholded. The engine list and the pipeline snippet are read against
   * the template library and the shipped configs, so neither can drift.
   */
  describe("alerts on a database", (): void => {
    it("names exactly the engines the Recommendations tab has monitors for", (): void => {
      const recommended: string = section(
        readPage(),
        "### Recommended monitors",
      );
      const match: RegExpMatchArray | null = recommended.match(
        /for these engines: ([^.]+)\./,
      );

      expect(match).not.toBeNull();

      const listed: Array<string> = (match as RegExpMatchArray)[1]!
        .split(/, | and /)
        .map((name: string): string => {
          return name.trim();
        })
        .sort();
      const withTemplates: Array<string> = DATABASE_SYSTEMS.filter(
        (descriptor: DatabaseSystemDescriptor): boolean => {
          return getDatabaseAlertTemplates(descriptor.system).length > 0;
        },
      )
        .map((descriptor: DatabaseSystemDescriptor): string => {
          return descriptor.displayName;
        })
        .sort();

      expect(withTemplates.length).toBeGreaterThan(0);
      expect(listed).toEqual(withTemplates);
      expect(recommended).toContain("`oneuptime.database.server.id`");
    });

    it("explains every way a hand-built monitor attaches to a database", (): void => {
      const built: string = section(readPage(), "### Monitors you build");

      for (const phrase of [
        "filters on `oneuptime.database.server.id`",
        "group the query by `oneuptime.database.server.id`",
        "silenced by that database's scheduled maintenance",
        "**Database Health** and **SQL Query** monitors attach to the database whose endpoints include the host and port they connect to",
        "Metrics and **Traces** monitors that filter `server.address`",
        "Grouping by `server.address` attaches nothing",
      ]) {
        expect({ phrase, present: built.includes(phrase) }).toEqual({
          phrase,
          present: true,
        });
      }
    });

    /*
     * Regression: the page said to "alert on its rate instead" — but the
     * monitor path has no rate (no Rate aggregation, no delta evaluation),
     * so there was nothing to follow the advice with.
     */
    it("sends a counter through cumulativetodelta rather than a rate monitors do not have", (): void => {
      const markdown: string = readPage();
      const whatToAlertOn: string = section(markdown, "### What to alert on");

      expect(markdown).not.toContain("alert on its rate instead");
      expect(whatToAlertOn).toContain("cumulative counter");
      expect(whatToAlertOn).toContain("`cumulativetodelta`");
      expect(whatToAlertOn).toContain("monitors have no rate function");
    });

    it("adds cumulativetodelta to the metrics pipeline every shipped config has, just before batch", (): void => {
      const snippet: string | undefined = codeBlocks(
        section(readPage(), "### What to alert on"),
      ).find((block: string): boolean => {
        return block.includes("cumulativetodelta/");
      });

      expect(snippet).toBeDefined();

      const processorId: string = (
        (snippet as string).match(
          /^ {2}(cumulativetodelta\/[a-z]+):$/m,
        ) as RegExpMatchArray | null
      )?.[1] as string;

      expect(processorId).toBeDefined();

      // Only counters are listed, matched by exact name.
      expect(snippet).toContain("match_type: strict");

      const snippetPipeline: string = (
        (snippet as string).match(
          /^ {6}processors: \[([^\]]+)\]$/m,
        ) as RegExpMatchArray | null
      )?.[1] as string;

      expect(snippetPipeline).toBeDefined();

      for (const engine of AGENT_ENGINES) {
        const shipped: string | undefined = (
          readConfig(engine).match(
            /^ {4}metrics:\n {6}receivers: \[[^\]]*\]\n {6}processors: \[([^\]]+)\]$/m,
          ) as RegExpMatchArray | null
        )?.[1];

        expect({ engine, shipped: Boolean(shipped) }).toEqual({
          engine,
          shipped: true,
        });

        const expected: Array<string> = (shipped as string)
          .split(",")
          .map((id: string): string => {
            return id.trim();
          });
        expected.splice(expected.indexOf("batch"), 0, processorId);

        expect({ engine, pipeline: snippetPipeline }).toEqual({
          engine,
          pipeline: expected.join(", "),
        });
      }
    });

    function templateMetrics(engine: string): Array<string> {
      return getDatabaseAlertTemplates(engine).flatMap(
        (template: DatabaseAlertTemplate): Array<string> => {
          return template.metricNames;
        },
      );
    }

    /*
     * Regression: SQL Server's transaction-log and lock-wait-time templates
     * and Oracle's session / process limit templates read metrics that never
     * arrive on the agent's default setup, so the monitors watched nothing.
     */
    it("says why SQL Server and Oracle have no log, lock-wait or limit monitor, and the library agrees", (): void => {
      const recommended: string = section(
        readPage(),
        "### Recommended monitors",
      );
      const sqlServer: Array<string> = templateMetrics("microsoft.sql_server");
      const oracle: Array<string> = templateMetrics("oracle.db");

      expect(recommended).toContain(
        "SQL Server has no transaction-log or lock-wait-time monitor",
      );
      expect(recommended).toContain(
        "Oracle none on its session or process limit",
      );

      for (const absent of [
        "sqlserver.transaction_log.usage",
        "sqlserver.lock.wait_time.avg",
      ]) {
        expect(sqlServer).not.toContain(absent);
      }
      for (const absent of [
        "oracledb.sessions.limit",
        "oracledb.processes.usage",
        "oracledb.processes.limit",
      ]) {
        expect(oracle).not.toContain(absent);
      }

      // What the list promises instead is what the templates read.
      expect(recommended).toContain("blocked sessions");
      expect(sqlServer).toContain("sqlserver.processes.blocked");
      expect(recommended).toContain("full tablespaces");
      expect(oracle).toContain("oracledb.tablespace.utilization");
    });

    it("warns that SQL Server's rates are since-start totals, and no template thresholds one", (): void => {
      const whatToAlertOn: string = section(readPage(), "### What to alert on");
      const sqlServer: Array<string> = templateMetrics("microsoft.sql_server");

      expect(whatToAlertOn).toContain("`sqlserver.*.rate` metrics");
      expect(whatToAlertOn).toContain("total since the server started");

      const rateSuffix: RegExp = /\.rate$/;

      for (const metricName of sqlServer) {
        expect({ metricName, isRate: rateSuffix.test(metricName) }).toEqual({
          metricName,
          isRate: false,
        });
      }

      // The point-in-time values it recommends instead are the ones read.
      expect(whatToAlertOn).toContain(
        "blocked sessions, pending memory grants, page life expectancy, buffer cache hit ratio",
      );
      expect(sqlServer).toEqual(
        expect.arrayContaining([
          "sqlserver.processes.blocked",
          "sqlserver.memory.grants.pending.count",
          "sqlserver.page.life_expectancy",
          "sqlserver.page.buffer_cache.hit_ratio",
        ]),
      );
    });

    it("describes Create monitor on a Metrics-tab chart and the two cases it refuses", (): void => {
      const built: string = section(readPage(), "### Monitors you build");
      const dashboard: string = path.join(
        REPO_ROOT,
        "packages/App/FeatureSet/Dashboard/src",
      );
      const modal: string = fs.readFileSync(
        path.join(
          dashboard,
          "Components/DatabaseServer/DatabaseMetricChartModal.tsx",
        ),
        "utf8",
      );
      const metricsTab: string = fs.readFileSync(
        path.join(dashboard, "Pages/Database/View/Metrics.tsx"),
        "utf8",
      );
      const link: string = fs.readFileSync(
        path.join(
          dashboard,
          "Pages/Database/Utils/DatabaseMetricMonitorLink.ts",
        ),
        "utf8",
      );

      expect(built).toContain("**Metrics** tab has **Create monitor**");
      expect(built).toContain(
        "filtered on the database's `oneuptime.database.server.id`",
      );
      expect(metricsTab).toContain("<DatabaseMetricChartModal");
      expect(modal).toContain("Create monitor");
      expect(link).toContain("[DATABASE_SERVER_ID_SCOPE_ATTRIBUTE]");

      // The two blockers the page names.
      expect(built).toContain("for a cumulative counter");
      expect(link).toMatch(/export const DATABASE_METRIC_MONITOR_RATE_BLOCKER/);
      expect(built).toContain("a metric that does not carry the database's id");
      expect(link).toMatch(
        /export const DATABASE_METRIC_MONITOR_NOT_LINKED_BLOCKER/,
      );
    });
  });

  /*
   * The numbers and rules the page states about discovery, identity and a
   * discovered database's lifecycle, read against the code that applies
   * them.
   */
  describe("discovery, identity and lifecycle", (): void => {
    function sourceNumber(relativeFile: string, name: string): number {
      const source: string = fs.readFileSync(
        path.join(REPO_ROOT, relativeFile),
        "utf8",
      );
      const match: RegExpMatchArray | null = source.match(
        new RegExp(`const ${name}: number =\\s*([\\d\\s*]+);`),
      );

      expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

      return (match as RegExpMatchArray)[1]!
        .split("*")
        .reduce((product: number, factor: string): number => {
          return product * Number(factor.trim());
        }, 1);
    }

    const SERVICE: string =
      "packages/Common/Server/Services/DatabaseServerService.ts";
    const DISCOVERY_JOB: string =
      "packages/App/FeatureSet/Workers/Jobs/DatabaseServer/DiscoverContainerDatabases.ts";

    /*
     * Regression: collector-created databases were exempt from the budget
     * ("do not count towards the auto-create budget"), so a collector keyed
     * on pod IPs could mint databases without bound. They count now; only
     * databases created by hand are exempt.
     */
    it("counts collector-created databases towards the auto-create budget, and says so everywhere", (): void => {
      const markdown: string = readPage();
      const budget: number = sourceNumber(
        SERVICE,
        "DEFAULT_AUTO_CREATE_BUDGET",
      );
      const warningMinutes: number =
        sourceNumber(SERVICE, "AUTO_CREATE_BUDGET_WARNING_MS") / 60000;
      const budgetSection: string = section(
        markdown,
        "### The auto-create budget",
      );

      expect(markdown).not.toContain("do not count towards the auto-create");
      expect(budgetSection).toContain(
        "Traces, Kubernetes, Docker, Podman and collectors",
      );
      expect(budgetSection).toContain(`fewer than ${budget} live`);
      expect(budgetSection).toContain(
        `at most once every ${warningMinutes} minutes per project`,
      );
      expect(
        section(markdown, "### From the Database Agent or your own collector"),
      ).toContain("count towards the [auto-create budget]");

      const tuningRow: string | undefined = section(
        markdown,
        "## Self-hosted tuning",
      )
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith("| `DATABASE_SERVER_AUTO_CREATE_BUDGET` |");
        });

      expect(tuningRow).toContain(`| \`${budget}\` |`);
      expect(tuningRow).toContain("collectors");
      expect(tuningRow).not.toContain("non-agent");
    });

    /*
     * Regression: the page said Engine metrics reads "Not connected" after
     * 15 minutes without data; the product shows Disconnected for a
     * collector that stopped, and Not connected only when none ever
     * reported.
     */
    it("describes the three engine-metrics statuses by the labels the product shows", (): void => {
      const markdown: string = readPage();
      const lifecycle: string = section(
        markdown,
        "## Lifecycle, archiving and retention",
      );
      const staleMinutes: number = sourceNumber(
        SERVICE,
        "DEFAULT_COLLECTOR_STALE_MINUTES",
      );
      const minimum: number = sourceNumber(
        SERVICE,
        "MIN_COLLECTOR_STALE_MINUTES",
      );

      for (const status of Object.values(DatabaseEngineMetricsStatus)) {
        const label: string = getDatabaseEngineMetricsStatusLabel(status);

        expect({ label, described: lifecycle.includes(`_${label}_`) }).toEqual({
          label,
          described: true,
        });
      }

      expect(lifecycle).toContain(
        `_Disconnected_ once a collector that reported stops for ${staleMinutes} minutes`,
      );
      expect(lifecycle).toContain("_Not connected_ when no Database Agent");
      expect(section(markdown, "## Self-hosted tuning")).toContain(
        `before Engine metrics reads Disconnected (minimum ${minimum})`,
      );
      expect(markdown).not.toContain("_Not connected_ after");
      expect(markdown).not.toContain("reads Not connected (minimum");
    });

    it("states the Kubernetes and container discovery rules the job applies", (): void => {
      const markdown: string = readPage();
      const kubernetes: string = section(markdown, "### From Kubernetes");
      const containers: string = section(
        markdown,
        "### From Docker and Podman",
      );
      const lifetimeMinutes: number =
        sourceNumber(DISCOVERY_JOB, "MIN_OBSERVED_LIFETIME_MS") / 60000;

      /*
       * e2e: a pod in CrashLoopBackOff became a database and counted as a
       * running instance. The lifetime gate now starts when the pod last
       * turned Ready (the candidate-pod query reads the Ready condition),
       * and an instance is a pod whose database container is running.
       */
      const job: string = fs.readFileSync(
        path.join(REPO_ROOT, DISCOVERY_JOB),
        "utf8",
      );

      expect(kubernetes).toContain(
        `A database appears once one of its pods has been Ready for about ${lifetimeMinutes} minutes`,
      );
      expect(kubernetes).toContain(
        "A crash-looping pod turns Ready afresh on every restart, so it never becomes a database",
      );
      expect(job).toContain("rc.value ->> 'type' = 'Ready'");
      expect(job).toContain("export function kubernetesMemberTiming(");
      expect(kubernetes).toContain(
        "**Instances** on its page counts the pods whose database container is running — not one waiting in `CrashLoopBackOff` or `ImagePullBackOff`, or one that has terminated",
      );
      expect(job).toContain("export function isRunningKubernetesMember(");
      expect(kubernetes).not.toContain("counts the Running pods");
      expect(markdown).not.toMatch(/been Running for about/);
      expect(
        section(markdown, "### A Kubernetes database was not detected"),
      ).toContain(
        `one of the database's pods must have been Ready for about ${lifetimeMinutes} minutes; a pod in \`CrashLoopBackOff\` turns Ready afresh on every restart`,
      );

      expect(containers).toContain(
        `run for less than ${lifetimeMinutes} minutes never become databases`,
      );
      expect(kubernetes).toContain("a workload scaled to zero shows 0");
      expect(kubernetes).toContain(
        "one-off `kubectl run` pods that declare no port",
      );
      /*
       * What the scan reads, now that it projects a container's command
       * line: the program, a shell's flags and the known command names of
       * its script (reduceContainerCommand) — never the values.
       */
      expect(kubernetes).toContain(
        "OneUptime reads pod metadata, labels, images, declared ports and what a container's command line runs — the program's name, a shell's flags and which well-known client, keep-alive and shell commands its script runs (any other command is only noted as unrecognised) — never environment variables, argument values, script text or secrets.",
      );
      expect(kubernetes).toContain(
        "only positive evidence makes it anything else",
      );
      expect(kubernetes).toContain("`redis-server --sentinel`");
    });

    /*
     * e2e (docker-spans): a container's 10-minute age was counted from its
     * first sighting, and a duplicate host registration took a database
     * over. The age now comes from `container.uptime`, and of two hosts with
     * one name only the most recently seen is read.
     */
    it("states how Docker and Podman containers are aged, filtered and read", (): void => {
      const markdown: string = readPage();
      const containers: string = section(
        markdown,
        "### From Docker and Podman",
      );
      const job: string = fs.readFileSync(
        path.join(REPO_ROOT, DISCOVERY_JOB),
        "utf8",
      );
      const ingest: string = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "packages/App/FeatureSet/Telemetry/Services/OtelMetricsIngestService.ts",
        ),
        "utf8",
      );
      const archiveDays: number = sourceNumber(
        SERVICE,
        "DEFAULT_AUTO_ARCHIVE_DAYS",
      );

      expect(containers).toContain(
        "A container's age is its uptime, so one that has already run that long becomes a database on the first run after the agent is installed.",
      );
      expect(ingest).toContain('"container.uptime"');
      for (const agent of ["DockerAgent", "PodmanAgent"]) {
        const config: string = fs.readFileSync(
          path.join(REPO_ROOT, "agents", agent, "otel-collector-config.yaml"),
          "utf8",
        );
        const uptimeEnabled: RegExp =
          /\n\s+container\.uptime:\s*\n\s+enabled:\s*true/;
        expect({
          agent,
          uptime: uptimeEnabled.test(config),
        }).toEqual({ agent, uptime: true });
      }

      expect(containers).toContain(
        "A host registered twice under the same name is read once, through the registration seen most recently.",
      );
      expect(job).toContain("export function dedupeParentsByIdentifier(");

      expect(containers).toContain("never by the command they run (see below)");
      expect(containers).toContain(
        "containers the kubelet runs on a Docker node (Kubernetes discovery finds those as pods)",
      );
      expect(
        classifyContainer({
          name: "k8s_postgres_postgres-0_data_1234_0",
          imageName: "postgres:16",
          labels: { "io.kubernetes.pod.name": "postgres-0" },
        }),
      ).toBeNull();

      expect(containers).toContain(
        `Left alone, it is [archived automatically](#lifecycle-archiving-and-retention) ${archiveDays} days after the container stops.`,
      );
    });

    /*
     * Regression: the page listed `sleep` and "an interactive shell,
     * directly or through `sh -c`" as client runs, but a `sh -c` script
     * that sleeps and then starts the server IS the server (the classifier
     * failed open only after CD-1). Every command line the page names is
     * run through the classifier and must land on the side the page puts
     * it on.
     */
    it("classifies every command line the Kubernetes section names the way it says", (): void => {
      const kubernetes: string = section(readPage(), "### From Kubernetes");
      const tooLongScript: string = `echo ${"x".repeat(20000)}`;

      const notServers: Array<{
        named: string;
        argv: Array<string>;
        role: ContainerCommandRole;
      }> = [
        { named: "`psql`", argv: ["psql", "-h", "db"], role: "client" },
        { named: "`redis-cli`", argv: ["redis-cli", "ping"], role: "client" },
        { named: "`mongosh`", argv: ["mongosh"], role: "client" },
        { named: "`pg_dump`", argv: ["pg_dump", "shop"], role: "client" },
        { named: "`mysql`", argv: ["mysql", "-e", "SELECT 1"], role: "client" },
        {
          named: "`sleep infinity`",
          argv: ["sleep", "infinity"],
          role: "keep-alive",
        },
        {
          named: "`tail -f /dev/null`",
          argv: ["tail", "-f", "/dev/null"],
          role: "keep-alive",
        },
        { named: "an interactive shell", argv: ["bash"], role: "keep-alive" },
        {
          named:
            "`sh -c` script runs nothing but such tools, shell builtins and plain utilities (`echo`, `cp`)",
          argv: [
            "sh",
            "-c",
            "until pg_isready -h db; do echo waiting; sleep 1; done; cp /seed.sql /tmp/ && psql -f /tmp/seed.sql",
          ],
          role: "client",
        },
        {
          named: "`redis-sentinel`",
          argv: ["redis-sentinel", "/etc/sentinel.conf"],
          role: "companion",
        },
        {
          named: "`redis-server --sentinel`",
          argv: ["redis-server", "/etc/sentinel.conf", "--sentinel"],
          role: "companion",
        },
        /*
         * e2e: client runs behind a launcher were read as servers. The
         * launchers the page names are looked through to their program.
         */
        {
          named: "`env PGPASSWORD=… psql`",
          argv: ["env", "PGPASSWORD=s3cret", "psql", "-h", "db"],
          role: "client",
        },
        {
          named: "`tini -- redis-cli`",
          argv: ["tini", "--", "redis-cli", "monitor"],
          role: "client",
        },
        {
          named: "`nohup`",
          argv: ["nohup", "psql", "-h", "db"],
          role: "client",
        },
        {
          named: "`setsid`",
          argv: ["setsid", "sleep", "infinity"],
          role: "keep-alive",
        },
        {
          named: "`dumb-init`",
          argv: ["dumb-init", "--", "redis-cli", "ping"],
          role: "client",
        },
        {
          named: "`docker-entrypoint.sh` are looked through",
          argv: ["docker-entrypoint.sh", "sleep", "infinity"],
          role: "keep-alive",
        },
        {
          named: "`exec`, `env` and `nohup` inside a script",
          argv: ["sh", "-c", "exec env PGPASSWORD=x nohup psql -h db"],
          role: "client",
        },
      ];

      const servers: Array<{ named: string; argv: Array<string> }> = [
        {
          named: "`sleep 5 && exec redis-server`",
          argv: ["sh", "-c", "sleep 5 && exec redis-server /conf/redis.conf"],
        },
        {
          named: "`bash -ecx 'exec cockroach start …'`",
          argv: ["bash", "-ecx", "exec cockroach start --insecure"],
        },
        { named: "`sh /start.sh`", argv: ["sh", "/start.sh"] },
        {
          named: "`tini -- docker-entrypoint.sh postgres`",
          argv: ["tini", "--", "docker-entrypoint.sh", "postgres"],
        },
        {
          named: "`docker-entrypoint.sh -c max_connections=200`",
          argv: ["docker-entrypoint.sh", "-c", "max_connections=200"],
        },
        // A wrapper with arguments of its own is not read past, whatever follows.
        { named: "`gosu postgres …`", argv: ["gosu", "postgres", "psql"] },
        { named: "`timeout 30 …`", argv: ["timeout", "30", "psql"] },
        {
          named: "a script too long to read",
          argv: ["sh", "-c", tooLongScript],
        },
      ];

      for (const example of notServers) {
        expect({
          named: example.named,
          onPage: kubernetes.includes(example.named),
          role: classifyContainerCommand({ command: example.argv }),
        }).toEqual({ named: example.named, onPage: true, role: example.role });
      }

      for (const example of servers) {
        expect({
          named: example.named,
          onPage: kubernetes.includes(example.named),
          role: classifyContainerCommand({ command: example.argv }),
        }).toEqual({ named: example.named, onPage: true, role: "server" });
      }

      expect(
        section(readPage(), "### A Kubernetes database was not detected"),
      ).toContain(
        "a client or debug run of a database image (directly, through `sh -c`, or behind `env`, `nohup`, `tini`, `dumb-init` or `docker-entrypoint.sh`)",
      );

      // Whatever the classifier only notes as unrecognised is never read.
      expect(
        reduceContainerCommand([
          "sh",
          "-c",
          "exec my-server --password=s3cret",
        ]),
      ).not.toContain("s3cret");
      expect(
        reduceContainerCommand([
          "sh",
          "-c",
          "exec my-server --password=s3cret",
        ]).join(" "),
      ).not.toContain("my-server");
    });

    /*
     * Regression: "Compose replicas (`db-1`, `db-2`) are one database" — the
     * classifier no longer strips a trailing number (it merged `redis-6379`
     * and `redis-6380`, two servers); it groups by Compose / Swarm service.
     */
    it("groups containers the way the classifier does", (): void => {
      const containers: string = section(
        readPage(),
        "### From Docker and Podman",
      );

      expect(containers).not.toContain("Compose replicas");
      expect(containers).toContain("`redis-6379` and `redis-6380` stay two");

      const workload: (
        name: string,
        labels?: Record<string, string>,
      ) => string | undefined = (
        name: string,
        labels?: Record<string, string>,
      ): string | undefined => {
        return classifyContainer({
          name: name,
          imageName: "redis:7.2",
          labels: labels || {},
        })?.workloadName;
      };

      expect(workload("redis-6379")).not.toBe(workload("redis-6380"));

      const compose: (replica: string) => Record<string, string> = (
        replica: string,
      ): Record<string, string> => {
        return {
          "com.docker.compose.project": "shop",
          "com.docker.compose.service": "cache",
          "com.docker.compose.container-number": replica,
        };
      };

      expect(workload("shop-cache-1", compose("1"))).toBe(
        workload("shop-cache-2", compose("2")),
      );
    });

    /*
     * Regression: "A two-part name such as `postgres.prod` is not expanded"
     * — a pod's `<service>.<namespace>` is now read as the Service it is.
     */
    it("reads a pod's two-part name as the Service, as the page now says", (): void => {
      const markdown: string = readPage();
      const endpoint: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
        system: "postgresql",
        address: "postgres.prod",
        caller: {
          kubernetesNamespace: "shop",
          kubernetesClusterName: "my-cluster",
          isEphemeral: true,
        },
        purpose: "client-call",
      });

      expect(endpoint ? formatDatabaseEndpoint(endpoint) : null).toBe(
        "postgres.prod.svc.cluster.local:5432@my-cluster",
      );
      expect(markdown).not.toContain("is not expanded");
      expect(section(markdown, "### From Kubernetes")).toContain(
        "`postgres.prod` (the Service `postgres` in namespace `prod`)",
      );
    });

    it("lists every network-scoped name suffix, and the SQL Server instance form, as the endpoint rules have them", (): void => {
      const endpoints: string = section(
        readPage(),
        "## Endpoints and the one-owner rule",
      );

      for (const suffix of NETWORK_SCOPED_NAME_SUFFIXES) {
        expect({ suffix, listed: endpoints.includes(`\`${suffix}\``) }).toEqual(
          { suffix, listed: true },
        );
      }

      const named: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
        system: "microsoft.sql_server",
        address: "sql1.corp\\INST01",
        caller: { isEphemeral: true },
        purpose: "client-call",
      });
      const withPort: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
        system: "microsoft.sql_server",
        address: "sql1.corp\\INST01,14330",
        caller: { isEphemeral: true },
        purpose: "client-call",
      });

      expect(named ? formatDatabaseEndpoint(named) : null).toBe(
        "sql1.corp\\inst01",
      );
      expect(withPort ? formatDatabaseEndpoint(withPort) : null).toBe(
        "sql1.corp:14330",
      );
      expect(endpoints).toContain("`sql1.corp\\inst01`, with no port");
      expect(endpoints).toContain("`sql1.corp:14330` needs no instance name");
    });

    /*
     * Regression: "archive one, remove its endpoint, add it to the other"
     * cannot be followed — a database's primary endpoint cannot be removed,
     * and an archived database keeps its endpoints.
     */
    it("merges two databases in a way the product allows", (): void => {
      const markdown: string = readPage();
      const endpoints: string = section(
        markdown,
        "## Endpoints and the one-owner rule",
      );

      expect(markdown).not.toContain("remove its endpoint");
      expect(endpoints).toContain(
        "Note the endpoints of the one you do not keep, delete it, and add those endpoints as aliases on the other straight away.",
      );
      expect(endpoints).toContain("which cannot be removed");
    });

    it("states the alias and archive timings the service applies", (): void => {
      const markdown: string = readPage();
      const releaseHours: number =
        sourceNumber(SERVICE, "WORKLOAD_ALIAS_RELEASE_MINUTES") / 60;
      const goneMinutes: number = sourceNumber(
        SERVICE,
        "WORKLOAD_GONE_MINUTES",
      );
      const restoreDays: number = sourceNumber(
        SERVICE,
        "MANUAL_RESTORE_GRACE_DAYS",
      );
      const archiveDays: number = sourceNumber(
        SERVICE,
        "DEFAULT_AUTO_ARCHIVE_DAYS",
      );
      const refreshSeconds: number = sourceNumber(
        "packages/Common/Server/Services/DatabaseServerEndpointService.ts",
        "ENDPOINT_MATCH_REFRESH_SECONDS",
      );
      const endpoints: string = section(
        markdown,
        "## Endpoints and the one-owner rule",
      );
      const lifecycle: string = section(
        markdown,
        "## Lifecycle, archiving and retention",
      );

      expect(goneMinutes).toBe(60);
      expect(refreshSeconds).toBe(3600);
      expect(endpoints).toContain(`released about ${releaseHours} hours after`);
      expect(section(markdown, "### From Kubernetes")).toContain(
        `released again about ${releaseHours} hours after a second cluster appears`,
      );
      expect(endpoints).toContain("has not been seen for an hour");
      expect(endpoints).toContain("refreshed at most once an hour");
      expect(endpoints).toContain(
        "Endpoints a person added are never moved or released.",
      );
      expect(lifecycle).toContain(`has seen for ${archiveDays} days`);
      expect(lifecycle).toContain(`stays restored for ${restoreDays} days`);
      // A trace-created duplicate a person restored keeps its endpoints as long.
      expect(endpoints).toContain(
        `or restored from the archive in the last ${Math.max(restoreDays, archiveDays)} days`,
      );
      expect(lifecycle).toContain("attached on their own do not count");
      expect(lifecycle).toContain("are not archived while it is dark");
    });

    /*
     * Regression: the page said any source refines a database to a fork and
     * that a fork is never undone, that traces restore a retired workload's
     * database, that recommendations appear once "engine metrics" arrive
     * (any batch did), and that scheduled maintenance "applies" to the
     * monitors that filter on the id (it silenced only grouped series).
     */
    it("states engine refinement, restoring, recommendations and maintenance the way the code now decides them", (): void => {
      const markdown: string = readPage();
      const lookbackDays: number = sourceNumber(
        "packages/App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseEngineMetricsProbe.ts",
        "DATABASE_ENGINE_METRICS_LOOKBACK_DAYS",
      );
      const engine: string = section(
        markdown,
        "### Which engine a database shows",
      );
      const alerts: string = section(markdown, "## Alerts on a database");
      const lifecycle: string = section(
        markdown,
        "## Lifecycle, archiving and retention",
      );
      const monitorResource: string = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "packages/Common/Server/Utils/Monitor/MonitorResource.ts",
        ),
        "utf8",
      );

      expect(markdown).not.toContain("any source may refine");
      expect(markdown).not.toContain("never downgraded");
      expect(markdown).not.toContain("once any source names it");
      expect(engine).toContain(
        "Application traces alone never refine an engine an image or a collector determined",
      );
      expect(engine).toContain(
        "A fork is undone only by a container image naming its family engine",
      );

      expect(lifecycle).toContain(
        "application traces that still name its Service neither restore it nor count as seeing it",
      );

      expect(section(alerts, "### Recommended monitors")).toContain(
        `stamped with the database's \`oneuptime.database.server.id\` in the last ${lookbackDays} days`,
      );

      // The maintenance promise holds only while the evaluation wires it.
      expect(alerts).toContain(
        "those monitors open no new incidents or alerts, unless they also name a resource that is outside the window",
      );
      expect(markdown).not.toContain("scheduled maintenance applies to them");
      expect(monitorResource).toContain(
        "MonitorMaintenanceSuppression.isMonitorSuppressed(",
      );
    });

    /*
     * Regression: the samples stamped `db.internal`, a `.internal` name —
     * which never creates a database on its own — right before saying the
     * database appears after the first collection.
     */
    it("uses an identity in the .env samples that creates its database", (): void => {
      for (const [markdown, heading] of [
        [readPage(), "### Alternative — Docker Compose"],
        [readAgentFile("README.md"), "## Quick Start — Docker Compose"],
      ] as Array<[string, string]>) {
        const sample: string | undefined = codeBlocks(
          section(markdown, heading),
        ).find((text: string): boolean => {
          return text.includes("DATABASE_SERVER_ADDRESS=");
        });
        const address: string = (
          (sample as string).match(
            /^DATABASE_SERVER_ADDRESS=(.*)$/m,
          ) as RegExpMatchArray
        )[1]!;
        const endpoint: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
          system: "postgresql",
          address: address,
          caller: { isEphemeral: true },
          purpose: "collector",
        });

        expect({
          heading,
          address,
          scope: endpoint ? getDatabaseEndpointScope(endpoint) : null,
        }).toEqual({
          heading,
          address,
          scope: "global",
        });
      }
    });

    it("sends readers of the probe monitors' pages to the alerts section", (): void => {
      const slugs: Set<string> = headingSlugs(readPage());

      expect(slugs.has("alerts-on-a-database")).toBe(true);

      for (const page of [
        "monitor/database-health-monitor",
        "monitor/sql-monitor",
      ]) {
        expect({
          page,
          linked: readPage(page).includes(
            `](${PAGE_URL}#alerts-on-a-database)`,
          ),
        }).toEqual({ page, linked: true });
      }
    });

    it("promises Open database on exactly the pages that render it", (): void => {
      const markdown: string = readPage();
      const pages: string = path.join(
        REPO_ROOT,
        "packages/App/FeatureSet/Dashboard/src/Pages",
      );
      const rendersBadge: (relative: string) => boolean = (
        relative: string,
      ): boolean => {
        return fs
          .readFileSync(path.join(pages, relative), "utf8")
          .includes("<DatabaseServerWorkloadBadge");
      };

      expect(section(markdown, "### From Kubernetes")).toContain(
        "the workload's StatefulSet or Deployment page, and each of its pods' pages, name the database it runs with an **Open database** link",
      );
      for (const relative of [
        "Kubernetes/View/StatefulSetDetail.tsx",
        "Kubernetes/View/DeploymentDetail.tsx",
        "Kubernetes/View/PodDetail.tsx",
      ]) {
        expect({ relative, renders: rendersBadge(relative) }).toEqual({
          relative,
          renders: true,
        });
      }

      expect(section(markdown, "### From Docker and Podman")).toContain(
        "each container's page links back to its database (**Open database**)",
      );
      for (const relative of [
        "Docker/View/ContainerDetail.tsx",
        "Podman/View/ContainerDetail.tsx",
      ]) {
        expect({ relative, renders: rendersBadge(relative) }).toEqual({
          relative,
          renders: true,
        });
      }

      expect(
        fs.readFileSync(
          path.join(
            REPO_ROOT,
            "packages/App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServerWorkloadBadge.tsx",
          ),
          "utf8",
        ),
      ).toContain("Open database");
    });
  });

  /*
   * What the end-to-end run against real databases, a kind cluster, the
   * Docker agent and the pinned collector (0.161.0) found the page getting
   * wrong. Each claim is checked against the code that decides it, fed the
   * run's own data.
   */
  describe("what the end-to-end run found", (): void => {
    it("says the PostgreSQL, SQL Server and Memcached receivers report no version", (): void => {
      const collected: string = section(readPage(), "### What Gets Collected");

      expect(collected).toContain(
        "The PostgreSQL, SQL Server and Memcached receivers report none, so under the agent alone those databases show no version",
      );

      // The resource of the e2e pg16 agent's batches, as ClickHouse stored it.
      const postgres: ReturnType<typeof resolveDatabaseFromResourceAttributes> =
        resolveDatabaseFromResourceAttributes({
          attributes: {
            "service.instance.id": "e2e-receivers-postgres:5432",
            "server.address": "pg16.rcv-e2e.example.net",
            "server.port": 5432,
            "db.system.name": "postgresql",
            "oneuptime.database.agent": "true",
            "oneuptime.agent.version": "0.161.0",
          },
        });

      expect(postgres?.system).toBe("postgresql");
      expect(postgres?.version).toBeNull();

      // MySQL 8.4 in the same run: the receiver's db.system.version.
      expect(
        resolveDatabaseFromResourceAttributes({
          attributes: {
            "server.address": "mysql84.rcv-e2e.example.net",
            "server.port": 3306,
            "db.system.name": "mysql",
            "db.system.version": "8.4.11",
            "mysql.instance.endpoint": "e2e-receivers-mysql:3306",
          },
        })?.version,
      ).toBe("8.4.11");
    });

    /*
     * e2e: agents that stopped read Disconnected after 12m52s and 14m56s of
     * real silence, not the 15 minutes the page promised: the threshold
     * counted from collectorLastSeenAt, which the ingest maintenance fence
     * lets move only every ~5 minutes. The sweep now allows for that lag,
     * so 15 minutes is a floor — and the page says how late it can be.
     */
    it("says Disconnected comes at least 15 minutes after the last data, and at most how late", (): void => {
      const markdown: string = readPage();
      const lifecycle: string = section(
        markdown,
        "## Lifecycle, archiving and retention",
      );
      const read: (relative: string) => string = (relative: string): string => {
        return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
      };
      const SERVICE: string =
        "packages/Common/Server/Services/DatabaseServerService.ts";
      const staleMinutes: number = Number(
        (
          read(SERVICE).match(
            /const DEFAULT_COLLECTOR_STALE_MINUTES: number = (\d+);/,
          ) as RegExpMatchArray
        )[1],
      );

      const lagMinutes: number = Number(
        (
          read(SERVICE).match(
            /const COLLECTOR_HEARTBEAT_LAG_MINUTES: number = (\d+);/,
          ) as RegExpMatchArray
        )[1],
      );
      const ingest: string = read(
        "packages/App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts",
      );

      expect(staleMinutes).toBe(15);
      // The sweep runs every 5 minutes …
      expect(
        read(
          "packages/App/FeatureSet/Workers/Jobs/DatabaseServer/CleanupStaleResources.ts",
        ),
      ).toContain("schedule: EVERY_FIVE_MINUTE");
      // … against collectorLastSeenAt, pushed back by the heartbeat's lag …
      expect(read(SERVICE)).toContain(
        'AND ("collectorLastSeenAt" IS NULL OR "collectorLastSeenAt" < $1)',
      );
      expect(read(SERVICE)).toMatch(
        /this\.getCollectorStaleThresholdMinutes\(\) \+\s+COLLECTOR_HEARTBEAT_LAG_MINUTES/,
      );
      // … which covers the fence (5 minutes, +25% jitter) and its 30 s memo.
      expect(ingest).toMatch(
        /MAINTENANCE_FENCE_TTL_SECONDS: number = 5 \* 60;/,
      );
      expect(ingest).toMatch(
        /MAINTENANCE_FENCE_NEGATIVE_MEMO_TTL_SECONDS: number = 30;/,
      );
      expect(lagMinutes * 60).toBeGreaterThanOrEqual(5 * 60 * 1.25 + 30);

      expect(lifecycle).toContain(
        `The ${staleMinutes} minutes are a floor: OneUptime records a collector's heartbeat only every 5 minutes or so while data flows, so it waits ${lagMinutes} minutes on top of them, counted from the last recorded heartbeat, and it checks every 5 minutes`,
      );
      expect(lifecycle).toContain(
        `between ${staleMinutes} and about ${staleMinutes + lagMinutes + 5} minutes after its last data point`,
      );
      expect(section(markdown, "## Self-hosted tuning")).toContain(
        `at least this long after the last data, and up to about ${lagMinutes + 5} minutes more`,
      );
    });

    it("says Valkey's redis_version is not its own, and the product ignores it", (): void => {
      const grants: string = section(
        readPage(),
        "#### Redis / Valkey / KeyDB / Dragonfly",
      );

      expect(grants).toContain(
        "which Valkey keeps at `7.2.4` (the Redis release it forked from)",
      );

      // e2e: valkey/valkey:8 answers INFO with redis_version:7.2.4 next to valkey_version:8.1.10.
      const valkey: ReturnType<typeof resolveDatabaseFromResourceAttributes> =
        resolveDatabaseFromResourceAttributes({
          attributes: {
            "server.address": "valkey8.rcv-e2e.example.net",
            "server.port": 6379,
            "db.system.name": "valkey",
            "redis.version": "7.2.4",
          },
        });

      expect(valkey?.system).toBe("valkey");
      expect(valkey?.version).toBeNull();
    });

    it("names Kubernetes databases by namespace and workload, as discovery does", (): void => {
      const endpoints: string = section(
        readPage(),
        "## Endpoints and the one-owner rule",
      );

      expect(endpoints).toContain(
        "`<namespace>/<workload>` in Kubernetes (`PostgreSQL data/postgres`)",
      );
      // The e2e StatefulSet data/postgres.
      expect(
        buildDatabaseServerDisplayName({
          system: "postgresql",
          namespace: "data",
          workloadName: "postgres",
        }),
      ).toBe("PostgreSQL data/postgres");
      expect(
        buildDatabaseServerDisplayName({
          system: "postgresql",
          endpoint: { host: "db.example.com", port: 5432 },
        }),
      ).toBe("PostgreSQL db.example.com:5432");
    });

    it("tells a Docker-detected database to take the agent from its Documentation tab", (): void => {
      const markdown: string = readPage();
      const containers: string = section(
        markdown,
        "### From Docker and Podman",
      );

      expect(containers).toContain(
        "install the [Database Agent](#the-database-agent) from the database's own **Documentation** tab: its install command and `.env` carry `DATABASE_SERVER_ID`, prefilled",
      );
      expect(section(markdown, "### Two databases for one server")).toContain(
        "a database detected from its Docker or Podman containers",
      );
      // The guide a row's Documentation tab renders does prefill the id.
      expect(
        fs.readFileSync(
          path.join(
            REPO_ROOT,
            "packages/App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationMarkdown.ts",
          ),
          "utf8",
        ),
      ).toContain("DATABASE_SERVER_ID=${shellWord(identity.databaseId)}");
    });

    /*
     * e2e: no Docker container row ever had labels, so Compose replicas,
     * Testcontainers and one-offs all became databases; and client / debug
     * containers of database images (`sleep infinity`, a psql loop) did too,
     * as Docker discovery never sees a command line.
     */
    it("says what Docker and Podman discovery needs from the agent, and what it cannot tell apart", (): void => {
      const containers: string = section(
        readPage(),
        "### From Docker and Podman",
      );

      expect(containers).toContain(
        "once its `otel-collector-config.yaml` copies them (`container_labels_to_metric_labels`). An older Docker or Podman agent does not: update it",
      );
      for (const agent of ["DockerAgent", "PodmanAgent"]) {
        const config: string = fs.readFileSync(
          path.join(REPO_ROOT, "agents", agent, "otel-collector-config.yaml"),
          "utf8",
        );

        // The labels the page's grouping and exclusions rest on are sent …
        expect({
          agent,
          labels: config.includes("container_labels_to_metric_labels:"),
        }).toEqual({ agent, labels: true });
        for (const label of [
          "com.docker.compose.project",
          "com.docker.compose.service",
          "com.docker.compose.oneoff",
          "org.testcontainers",
        ]) {
          expect({
            agent,
            label,
            sent: config.includes(`${label}: ${label}`),
          }).toEqual({ agent, label, sent: true });
        }
        // … and the command line is not, which is the limitation the page states.
        expect(config).not.toMatch(
          /\n\s+container\.command_line:\s*\n\s+enabled:\s*true/,
        );
      }

      expect(containers).toContain(
        "a long-running client or debug container of a database image (`sleep infinity`, a `psql` or `redis-cli` loop) becomes a database once it has run for 10 minutes",
      );
      // e2e-docker-spans-pg-sleep: postgres:16 running `sleep infinity`.
      expect(
        classifyContainer({
          name: "e2e-docker-spans-pg-sleep",
          imageName: "postgres:16",
          labels: {},
        })?.system,
      ).toBe("postgresql");
      // e2e-docker-spans-tc-pg: a Testcontainers run, once its labels arrive.
      expect(
        classifyContainer({
          name: "e2e-docker-spans-tc-pg",
          imageName: "postgres:16",
          labels: {
            "org.testcontainers": "true",
            "org.testcontainers.sessionId": "3f1c",
          },
        }),
      ).toBeNull();
    });

    it("creates a cluster-local Service name with its cluster in a project that has one", (): void => {
      const markdown: string = readPage();
      const service: string = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "packages/Common/Server/Services/DatabaseServerService.ts",
        ),
        "utf8",
      );

      // The server refuses the unqualified Service name there (e2e: HTTP 400) …
      expect(service).toContain(
        "private async refuseUnqualifiedKubernetesServiceName(",
      );
      expect(service).toContain(
        "as an endpoint on the database's Endpoints tab once it is created.",
      );
      // … so both places that say "create it by hand" say how.
      expect(
        section(markdown, "### From the Database Agent or your own collector"),
      ).toContain(
        "create the database as `postgres.prod.svc.cluster.local:5432@my-cluster`, then add the unqualified `postgres.prod.svc.cluster.local:5432`",
      );
      expect(
        section(markdown, "### The agent runs but no database appears"),
      ).toContain(
        "create a cluster-local Service name with its cluster (`postgres.prod.svc.cluster.local:5432@my-cluster`) — the unqualified name is refused there",
      );
    });

    it("says connection spans are not queries, naming spans the rule really drops", (): void => {
      const markdown: string = readPage();
      const traces: string = section(markdown, "### From application traces");

      expect(traces).toContain(
        "the endpoint received at least 10 queries in the 15-minute window a run looks at",
      );
      expect(traces).toContain(
        "A client library's connection-management spans (`pg.connect` and `pg-pool.connect` from node-postgres, `redis-connect`, `connect`, …) are not queries: they count neither here nor in a database's **Queries**",
      );
      // The threshold's other two mentions say the same.
      const minCallsRow: string | undefined = section(
        markdown,
        "## Self-hosted tuning",
      )
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith("| `DATABASE_SERVER_MIN_CALLS` |");
        });
      expect(minCallsRow).toContain(
        "| Queries an endpoint needs within the 15-minute window",
      );
      expect(minCallsRow).toContain(
        "(connection spans such as `pg.connect` do not count)",
      );
      expect(
        section(markdown, "### A database my applications use was not created"),
      ).toContain(
        "fewer than 10 queries in the last 15 minutes (connection spans such as `pg.connect` and `pg-pool.connect` do not count)",
      );
      expect(markdown).not.toMatch(/\b10 calls\b|Calls an endpoint needs/);
      // The discovery count leaves them out the way the page says.
      expect(
        fs.readFileSync(
          path.join(
            REPO_ROOT,
            "packages/Common/Server/Utils/Telemetry/DatabaseEndpointDiscovery.ts",
          ),
          "utf8",
        ),
      ).toMatch(/countIf\(\$\{databaseQuerySpanSql\(\)\}\) AS callCount/);
      // e2e: node-postgres sent pg-pool.connect and pg.connect around every query.
      for (const name of ["pg.connect", "pg-pool.connect", "redis-connect"]) {
        expect(traces).toContain(`\`${name}\``);
        expect(isDatabaseConnectionSpanName(name)).toBe(true);
      }
      expect(isDatabaseConnectionSpanName("pg.query:SELECT")).toBe(false);
    });

    it("promises a curated Overview for every engine the agent monitors", (): void => {
      const collected: string = section(readPage(), "### What Gets Collected");

      expect(collected).toContain(
        "charts a curated set for every engine in this table",
      );
      for (const system of Object.values(CONFIG_SYSTEM)) {
        expect({
          system,
          tiles: getDatabaseServerMetrics(system).length > 0,
        }).toEqual({ system, tiles: true });
      }
      for (const fork of ["mariadb", "valkey", "opensearch"]) {
        expect({
          fork,
          tiles: getDatabaseServerMetrics(fork).length > 0,
        }).toEqual({ fork, tiles: true });
      }
    });

    it("gives own collectors the query-event body transform the agent configs run", (): void => {
      const ownCollector: string = section(
        readPage(),
        "## Using your own OpenTelemetry Collector",
      );
      const block: string | undefined = ownCollector
        .split("```yaml\n")
        .slice(1)
        .map((part: string): string => {
          return part.substring(0, part.indexOf("```"));
        })
        .find((part: string): boolean => {
          return part.includes("transform/query_event_body:");
        });

      expect(block).toBeDefined();

      const statements: (text: string) => Array<string> = (
        text: string,
      ): Array<string> => {
        return Array.from(text.matchAll(/^\s+- (set\(log\.body, .+)$/gm)).map(
          (match: RegExpMatchArray): string => {
            return match[1] as string;
          },
        );
      };

      expect(statements(block as string)).toHaveLength(2);
      for (const engine of [
        "postgresql",
        "mysql",
        "mongodb",
        "sqlserver",
        "oracledb",
      ]) {
        expect({ engine, statements: statements(readConfig(engine)) }).toEqual({
          engine,
          statements: statements(block as string),
        });
      }
      expect(section(readPage(), "### What Gets Collected")).toContain(
        "with the query text as their message",
      );
    });

    /*
     * UI review: the Overview header's pill said "Connected" for databases
     * whose engine metrics were not; it now reads Last seen, in words of its
     * own. The page described only Last seen and the Engine metrics status.
     */
    it("describes the header's liveness pill by the labels and window the product uses", (): void => {
      const lifecycle: string = section(
        readPage(),
        "## Lifecycle, archiving and retention",
      );

      for (const status of Object.values(DatabaseLivenessStatus)) {
        const label: string = getDatabaseLivenessLabel(status);
        expect({ label, described: lifecycle.includes(`_${label}_`) }).toEqual({
          label,
          described: true,
        });
      }
      expect(lifecycle).toContain(
        `saw the database in the last ${DATABASE_SERVER_LIVE_WINDOW_MINUTES} minutes`,
      );
      expect(lifecycle).toContain(
        "It says nothing about engine metrics, which have a status of their own.",
      );
      // The pill's own hover text names the same sources and the same split.
      expect(DATABASE_LIVENESS_DESCRIPTION).toContain(
        `in the last ${DATABASE_SERVER_LIVE_WINDOW_MINUTES} minutes`,
      );
      expect(DATABASE_LIVENESS_DESCRIPTION).toContain(
        "the separate Engine metrics status",
      );
    });

    /*
     * The Metrics tab's rows: a catalog metric reads as its Overview tile,
     * captioned; MariaDB's mysql.buffer_pool.limit (a page count declared in
     * bytes, 8112 read "7.9 KiB") reads in pages.
     */
    it("says what a Metrics tab row's value is, and how MariaDB's buffer pool limit reads", (): void => {
      const collected: string = section(readPage(), "### What Gets Collected");
      const queries: string = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "packages/App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries.ts",
        ),
        "utf8",
      );
      const metricsTab: string = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "packages/App/FeatureSet/Dashboard/src/Pages/Database/View/Metrics.tsx",
        ),
        "utf8",
      );

      expect(collected).toContain(
        "a metric the Overview charts shows the Overview's value — its series combined the same way, a counter as a per-second rate — with a caption saying how (_total of series_, _per second, all series_); every other row shows the average of its series",
      );
      for (const caption of ["total of series", "per second, all series"]) {
        expect({
          caption,
          inCode: queries.includes(`how = "${caption}"`),
        }).toEqual({ caption, inCode: true });
      }
      expect(metricsTab).toContain(
        'DATABASE_METRIC_LIST_DEFAULT_CAPTION: string = "average of series"',
      );

      expect(collected).toContain(
        "MariaDB reports `mysql.buffer_pool.limit` as the buffer pool's page count rather than the bytes the receiver declares, so on a MariaDB database that row and its chart read in pages.",
      );
      expect(queries).toMatch(
        /system: "mariadb",\s+metricName: "mysql\.buffer_pool\.limit",\s+correction: \{\s+unit: "\{pages\}",/,
      );
      expect(metricsTab).toContain("getRowValueUnit={getRowValueUnit}");
      // No curated tile reads it: the Overview's "Buffer pool size" is in pages on both.
      expect(
        getDatabaseServerMetrics("mariadb").some(
          (definition: DatabaseServerMetricDefinition): boolean => {
            return definition.metricName === "mysql.buffer_pool.limit";
          },
        ),
      ).toBe(false);
    });

    /*
     * e2e: the Created feed item said "the first time telemetry for it
     * arrived" for every source, and a person's alias add or remove never
     * reached the Feed.
     */
    it("says what the Feed records about how a database was found and its aliases", (): void => {
      const markdown: string = readPage();
      const service: string = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "packages/Common/Server/Services/DatabaseServerService.ts",
        ),
        "utf8",
      );
      const endpointService: string = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "packages/Common/Server/Services/DatabaseServerEndpointService.ts",
        ),
        "utf8",
      );

      expect(section(markdown, "## How databases are detected")).toContain(
        "the first item on its **Feed** says what found it: the Kubernetes workload and its cluster, the Docker or Podman container — or Compose or Swarm service — and its host, the endpoint applications called, or the Database Agent (with its version) or collector that reported it",
      );
      for (const origin of [
        "on Kubernetes cluster ",
        "`container ",
        "ContainerWorkloadKind.ComposeService",
        "ContainerWorkloadKind.SwarmService",
        " host ",
        "was created automatically: detected from application traces",
        " calling ",
        "the Database Agent",
        "was created automatically: reported by ",
      ]) {
        expect({ origin, inCode: service.includes(origin) }).toEqual({
          origin,
          inCode: true,
        });
      }

      expect(
        section(markdown, "## Endpoints and the one-owner rule"),
      ).toContain(
        "Each alias added or removed this way goes on the database's **Feed**, naming the endpoint and who changed it; discovery's own endpoint changes do not.",
      );
      expect(endpointService).toContain("Added the endpoint");
      expect(endpointService).toContain("Removed the endpoint");
      expect(endpointService).toContain("userId: data.userId");
    });
  });

  /*
   * install.sh and troubleshoot.sh decide, in bash, whether the identity a
   * user gives can ever create a database — install.sh then asks for
   * DATABASE_SERVER_ID, troubleshoot.sh warns. The product decides the same
   * in DatabaseEndpoint.ts. Each script's two classifiers are run for real
   * over a table of names and held to the product's answer.
   */
  describe("the agent scripts classify an identity the way the product does", (): void => {
    const HOSTS: ReadonlyArray<string> = [
      // Local to one machine.
      "localhost",
      "LOCALHOST",
      "localhost.",
      "api.localhost",
      "localhost.localdomain",
      "localhost4",
      "localhost6",
      "ip6-localhost",
      "ip6-loopback",
      "127.0.0.1",
      "127.1.2.3",
      "::1",
      "::",
      "0.0.0.0",
      "(local)",
      ".",
      "host.docker.internal",
      "gateway.docker.internal",
      "kubernetes.docker.internal",
      "vm.docker.internal",
      "host.containers.internal",
      "docker.for.mac.localhost",
      "host.minikube.internal",
      "host.k3d.internal",
      "host.lima.internal",
      "host.orb.internal",
      "host.rancher-desktop.internal",
      // Unique inside one network only.
      "db",
      "postgres",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.10",
      "100.64.0.1",
      "100.127.255.255",
      "169.254.169.254",
      "fd00::1",
      "fc00::5",
      "fe80::1",
      "febf::1",
      "db.internal",
      "db.internal.",
      "db.prod.internal",
      "host.internal",
      "host.a.b.internal",
      "pg.local",
      "nas.home.arpa",
      "db.localdomain",
      "postgres.prod.svc.cluster.local",
      "postgres.prod.svc",
      "mongo-0.mongo.prod.svc.cluster.local",
      // One server project-wide.
      "db.example.com",
      "DB.Example.COM",
      "db.example.com.",
      "postgres.prod",
      "db.internal.example.com",
      "pg.local.example.com",
      "172.32.0.1",
      "172.15.0.1",
      "100.128.0.1",
      "8.8.8.8",
      "2001:db8::1",
    ];

    function shellFunction(file: string, name: string): string {
      const match: RegExpMatchArray | null = readAgentFile(file).match(
        new RegExp(`\\n(${name}\\(\\) \\{[\\s\\S]*?\\n\\})`),
      );

      expect({ file, name, found: Boolean(match) }).toEqual({
        file,
        name,
        found: true,
      });

      return (match as RegExpMatchArray)[1]!;
    }

    function runClassifier(file: string, name: string): Map<string, boolean> {
      const script: string = `${shellFunction(file, name)}
for host in "$@"; do
  if ${name} "$host"; then echo 1; else echo 0; fi
done`;
      const result: SpawnSyncReturns<string> = spawnSync(
        "bash",
        ["-c", script, "classify", ...HOSTS],
        { encoding: "utf8" },
      );

      expect({
        file,
        name,
        status: result.status,
        stderr: result.stderr,
      }).toEqual({ file, name, status: 0, stderr: "" });

      const answers: Array<string> = result.stdout.trim().split("\n");

      expect(answers.length).toBe(HOSTS.length);

      return new Map<string, boolean>(
        HOSTS.map((host: string, index: number): [string, boolean] => {
          return [host, answers[index] === "1"];
        }),
      );
    }

    // What the product makes of the name as the agent's server.address.
    function productIsLocalOnly(host: string): boolean {
      return isLoopbackDatabaseHost(host) || isHostRelativeDatabaseHost(host);
    }

    function productNeverCreates(host: string): boolean {
      const endpoint: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
        system: "postgresql",
        address: host,
        caller: { isEphemeral: true },
        purpose: "collector",
      });

      return !endpoint || getDatabaseEndpointScope(endpoint) === "local";
    }

    it.each(["install.sh", "troubleshoot.sh"])(
      "%s refuses exactly the names that only mean something on one machine",
      (file: string): void => {
        const answers: Map<string, boolean> = runClassifier(
          file,
          "is_local_only_host",
        );

        for (const host of HOSTS) {
          expect({ host, localOnly: answers.get(host) }).toEqual({
            host,
            localOnly: productIsLocalOnly(host),
          });
        }
      },
    );

    /*
     * Regression: `.internal`, `.local`, `.home.arpa` and `.localdomain`
     * names and link-local addresses never create a database, but the
     * scripts read them as unique, so install.sh did not ask for
     * DATABASE_SERVER_ID and no database ever appeared.
     */
    it.each(["install.sh", "troubleshoot.sh"])(
      "%s asks for DATABASE_SERVER_ID for exactly the names that never create a database",
      (file: string): void => {
        const answers: Map<string, boolean> = runClassifier(
          file,
          "is_network_local_name",
        );

        for (const host of HOSTS) {
          if (productIsLocalOnly(host)) {
            // Refused before this question is asked.
            continue;
          }

          expect({ host, networkLocal: answers.get(host) }).toEqual({
            host,
            networkLocal: productNeverCreates(host),
          });
        }
      },
    );
  });
});
