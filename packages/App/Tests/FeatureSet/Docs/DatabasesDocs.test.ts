import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
  getDatabaseSystemDescriptor,
  normalizeDatabaseSystem,
} from "Common/Types/DatabaseServer/DatabaseSystem";
import {
  DatabaseServerMetricDefinition,
  getDatabaseServerMetrics,
} from "Common/Types/DatabaseServer/DatabaseServerMetricCatalog";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
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
];

/* The engine row labels of the "What Gets Collected" table. */
const COLLECTED_ROW_LABELS: Readonly<Record<string, string>> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  redis: "Redis / Valkey",
  mongodb: "MongoDB",
};

const FENCE_LINE: RegExp = /^\s*```/;
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
 * Metrics a config switches on: the `<name>:` / `enabled: true` pairs of
 * the receiver's metrics block (the metrics sit at six spaces under
 * receivers.<engine>.metrics in every config).
 */
function enabledMetrics(engine: string): Array<string> {
  return Array.from(
    readConfig(engine).matchAll(/^ {6}([a-z0-9_.]+):\n {8}enabled: true$/gm),
  )
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    })
    .filter((name: string): boolean => {
      return name.startsWith(`${engine}.`);
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

/* The literal db.system.name the config's resource processor stamps. */
function stampedSystem(engine: string): string {
  const match: RegExpMatchArray | null = readConfig(engine).match(
    /- key: db\.system\.name\n\s+value: ([a-z0-9_.]+)\n\s+action: upsert/,
  );

  expect({ engine, stamped: Boolean(match) }).toEqual({
    engine,
    stamped: true,
  });

  return (match as RegExpMatchArray)[1] as string;
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
          return /^ONEUPTIME_URL=/m.test(text);
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
    it("stamps each engine's canonical db.system.name, from a receiver the engine registry knows", (): void => {
      for (const engine of AGENT_ENGINES) {
        const system: string = stampedSystem(engine);
        const descriptor: DatabaseSystemDescriptor | null =
          getDatabaseSystemDescriptor(system);

        expect({
          engine,
          system,
          normalized: normalizeDatabaseSystem(system),
        }).toEqual({ engine, system, normalized: system });
        expect({
          engine,
          receiver: descriptor?.receiverTypes.includes(engine) ?? false,
        }).toEqual({ engine, receiver: true });
      }
    });

    it("never switches off, and never leaves off, a metric the Overview charts", (): void => {
      for (const engine of AGENT_ENGINES) {
        const catalog: Array<DatabaseServerMetricDefinition> =
          getDatabaseServerMetrics(stampedSystem(engine));
        const config: string = readConfig(engine);
        const offByDefault: Set<string> = new Set<string>(
          commentedOptionalMetrics(engine),
        );

        expect({ engine, curated: catalog.length > 0 }).toEqual({
          engine,
          curated: true,
        });

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

        expect(enabled.length).toBeGreaterThan(0);

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
});
