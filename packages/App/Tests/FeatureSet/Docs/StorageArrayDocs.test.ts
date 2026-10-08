import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  StorageArrayAlertTemplate,
  getAllStorageArrayAlertTemplates,
} from "Common/Types/Monitor/StorageArrayAlertTemplates";
import {
  StorageArrayMetricDefinition,
  getAllStorageArrayMetricCategories,
  getAllStorageArrayMetrics,
} from "Common/Types/Monitor/StorageArrayMetricCatalog";
import { StorageArrayNameLabelKeys } from "Common/Server/Utils/Monitor/SeriesResourceLabels";
import StorageSystem, {
  StorageSystemUtil,
} from "Common/Types/StorageArray/StorageSystem";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepStorageArrayMonitor from "Common/Types/Monitor/MonitorStepStorageArrayMonitor";
import {
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Storage Arrays docs against the product they describe.
 *
 * Markdown is not compiled, so nothing else notices when the metric catalog
 * gains a series the monitor page never lists, an alert template changes its
 * threshold without the docs following, the agent gains a variable the
 * install guide does not explain, a scrape interval moves, or a nav link
 * points at a page that was renamed. Each test reads the source of truth —
 * the catalog, the template registry, the agent's files, the nav — and checks
 * the shipped pages still tell the same story.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CONTENT_DIR: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content",
);
const AGENT_DIR: string = path.join(REPO_ROOT, "agents/StorageArrayAgent");

const TELEMETRY_PAGE: string = "telemetry/storage-arrays";
const MONITOR_PAGE: string = "monitor/storage-array-monitor";

const OWNED_PAGES: ReadonlyArray<string> = [TELEMETRY_PAGE, MONITOR_PAGE];

/*
 * Every language directory that ships the Storage Arrays pages. `fa` is the
 * only translated corpus for the infrastructure agents (every other language
 * falls back to English per page at request time), as for Ceph and VMware.
 */
const TRANSLATED_LANGUAGES: ReadonlyArray<string> = ["fa"];

const SHIPPED_CONFIGS: ReadonlyArray<string> = [
  "otel-collector-config.yaml",
  "otel-collector-config.flasharray-exporter.yaml",
  "otel-collector-config.flashblade.yaml",
];

const FENCE_LINE: RegExp = /^\s*```/;
/* The divider row under a markdown table header: `| --- | --- |`. */
const TABLE_DIVIDER: RegExp = /^\|\s*-/;

/*
 * js-yaml from Common/node_modules, as OpenTelemetryCollectorExampleDocs
 * .test.ts and QueuesDocs.test.ts load it: Common declares js-yaml 4, App
 * declares no YAML parser.
 */
interface JsYamlModule {
  load: (text: string) => unknown;
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: JsYamlModule = require(
  path.join(REPO_ROOT, "packages", "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

interface ScrapeJob {
  job_name: string;
  metrics_path: string;
  scrape_interval: string;
  static_configs: Array<{ labels: { scrape_endpoint: string } }>;
}

function pageFile(language: string, relative: string): string {
  return path.join(CONTENT_DIR, language, `${relative}.md`);
}

function readPage(relative: string, language: string = "en"): string {
  return fs.readFileSync(pageFile(language, relative), "utf8");
}

function readAgentFile(file: string): string {
  return fs.readFileSync(path.join(AGENT_DIR, file), "utf8");
}

/* The body of one "## Heading" section, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(/^(#{1,6})\s/);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

/* The cells of a markdown table row, trimmed. */
function cells(row: string): Array<string> {
  return row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell: string): string => {
      return cell.trim();
    });
}

/* Table rows (not the header or the divider) of the given markdown. */
function tableRows(markdown: string): Array<string> {
  return markdown.split("\n").filter((line: string): boolean => {
    return line.startsWith("| ") && !TABLE_DIVIDER.test(line);
  });
}

/* Every backticked identifier in a page, in order, duplicates kept. */
function backtickedIdentifiers(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(/`([^`\n]+)`/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

/* Fenced code blocks of a page, each as its full text between the fences. */
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

function navGroup(title: string): NavGroup {
  const group: NavGroup | undefined = DocsNav.find(
    (item: NavGroup): boolean => {
      return item.title === title;
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
}

function platformName(system: StorageSystem): string {
  return StorageSystemUtil.getShortName(system);
}

/* A catalog entry's pinned label filters, as the docs write them: `key=value`. */
function pinnedFilters(metric: StorageArrayMetricDefinition): Array<string> {
  return Object.entries(metric.attributes || {}).map(
    ([key, value]: [string, string]): string => {
      return `\`${key}=${value}\``;
    },
  );
}

/*
 * The variables the agent's .env carries: exactly what install.sh writes,
 * which is what docker-compose.yml passes to the collector (env_file) and
 * reads for itself (the config to mount, the profile to start).
 */
function dotenvVariables(): Array<string> {
  const heredoc: RegExpMatchArray | null = readAgentFile("install.sh").match(
    /cat > "\$ENV_FILE" <<ENVEOF\n([\s\S]*?)\nENVEOF/,
  );

  expect(heredoc).not.toBeNull();

  return (heredoc as RegExpMatchArray)[1]!
    .split("\n")
    .map((line: string): string => {
      return line.split("=")[0] as string;
    });
}

function scrapeJobs(config: string): Array<ScrapeJob> {
  const parsed: {
    receivers: { prometheus: { config: { scrape_configs: Array<ScrapeJob> } } };
  } = jsYaml.load(readAgentFile(config)) as never;

  return parsed.receivers.prometheus.config.scrape_configs;
}

/* A Prometheus duration as the docs say it: 60s → "60 seconds", 2m → "2 minutes". */
function spokenDuration(duration: string): string {
  const match: RegExpMatchArray = duration.match(
    /^(\d+)(s|m)$/,
  ) as RegExpMatchArray;
  const value: number = Number(match[1]);
  const seconds: number = match[2] === "m" ? value * 60 : value;

  if (seconds % 60 === 0 && seconds >= 120) {
    return `${seconds / 60} minutes`;
  }

  return `${seconds} seconds`;
}

interface TemplateShape {
  metricName: string;
  attributes: Array<string>;
  groupBy: string | undefined;
  aggregation: string;
  rollingTime: RollingTime;
  fire: CriteriaFilter;
  recover: CriteriaFilter;
}

/* What a template builds: its query and its two criteria. */
function templateShape(template: StorageArrayAlertTemplate): TemplateShape {
  const step: MonitorStep = template.getMonitorStep({
    arrayIdentifier: "docs-array",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Docs",
  });
  const monitor: MonitorStepStorageArrayMonitor = step.data!
    .storageArrayMonitor as MonitorStepStorageArrayMonitor;
  const query: MonitorStepStorageArrayMonitor["metricViewConfig"]["queryConfigs"][number] =
    monitor.metricViewConfig.queryConfigs[0]!;
  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

  return {
    metricName: query.metricQueryData.filterData.metricName as string,
    attributes: Object.entries(
      (query.metricQueryData.filterData.attributes || {}) as Record<
        string,
        string
      >,
    ).map(([key, value]: [string, string]): string => {
      return `\`${key}=${value}\``;
    }),
    groupBy: query.metricQueryData.groupByAttributeKeys?.[0],
    aggregation: query.metricQueryData.filterData.aggegationType as string,
    rollingTime: monitor.rollingTime,
    fire: instances[0]!.data!.filters[0]!,
    recover: instances[1]!.data!.filters[0]!,
  };
}

const COMPARISON: Partial<Record<FilterType, string>> = {
  [FilterType.GreaterThan]: ">",
  [FilterType.LessThan]: "<",
  [FilterType.GreaterThanOrEqualTo]: "≥",
  [FilterType.LessThanOrEqualTo]: "≤",
};

/* A threshold as the docs write it: 0.11000000000000001 → "0.11". */
function threshold(value: unknown): string {
  return String(Number(Number(value).toPrecision(6)));
}

/* The row of a template in its platform's table. */
function templateRow(template: StorageArrayAlertTemplate): string | undefined {
  const table: string = section(
    section(readPage(MONITOR_PAGE), "## Pre-built Alert Templates"),
    `### ${platformName(template.storageSystems[0]!)}`,
  );

  return tableRows(table).find((line: string): boolean => {
    return cells(line)[0] === template.name;
  });
}

/* In-page anchors of a page that no heading of the same page slugifies to. */
function brokenAnchors(markdown: string): Array<string> {
  const headings: Set<string> = new Set<string>();
  const anchors: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const heading: RegExpMatchArray | null = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      headings.add(slugify(heading[1] as string));
    }

    for (const match of line.matchAll(/\]\(#([^)]+)\)/g)) {
      anchors.push(match[1] as string);
    }
  }

  return anchors.filter((anchor: string): boolean => {
    return !headings.has(decodeURIComponent(anchor));
  });
}

describe("Storage Array docs", (): void => {
  describe("pages", (): void => {
    it("ship both English pages", (): void => {
      for (const page of OWNED_PAGES) {
        expect({
          page,
          exists: fs.existsSync(pageFile("en", page)),
        }).toEqual({ page, exists: true });
      }
    });

    it("open with the titles the nav uses", (): void => {
      expect(readPage(TELEMETRY_PAGE).split("\n")[0]).toBe(
        "# OneUptime Storage Array Agent",
      );
      expect(readPage(MONITOR_PAGE).split("\n")[0]).toBe(
        "# Storage Array Monitor",
      );
    });

    it("keep every code fence closed", (): void => {
      for (const language of ["en", ...TRANSLATED_LANGUAGES]) {
        for (const page of OWNED_PAGES) {
          const fences: number = readPage(page, language)
            .split("\n")
            .filter((line: string): boolean => {
              return FENCE_LINE.test(line);
            }).length;

          expect({ language, page, fences: fences % 2 }).toEqual({
            language,
            page,
            fences: 0,
          });
        }
      }
    });

    it("only link to /docs/ pages that exist", (): void => {
      for (const language of ["en", ...TRANSLATED_LANGUAGES]) {
        for (const page of OWNED_PAGES) {
          const targets: Array<string> = Array.from(
            readPage(page, language).matchAll(
              /\]\((\/docs\/[^)#]+)(?:#[^)]*)?\)/g,
            ),
          ).map((match: RegExpMatchArray): string => {
            return match[1] as string;
          });

          expect(targets.length).toBeGreaterThan(0);

          for (const target of targets) {
            expect({
              language,
              page,
              target,
              exists: fs.existsSync(
                pageFile("en", target.replace("/docs/", "")),
              ),
            }).toEqual({ language, page, target, exists: true });
          }
        }
      }
    });

    it("only link to headings of the same page that exist", (): void => {
      for (const language of ["en", ...TRANSLATED_LANGUAGES]) {
        for (const page of OWNED_PAGES) {
          expect({
            language,
            page,
            broken: brokenAnchors(readPage(page, language)),
          }).toEqual({ language, page, broken: [] });
        }
      }
    });

    it("cross-link each other", (): void => {
      expect(readPage(TELEMETRY_PAGE)).toContain(`](/docs/${MONITOR_PAGE})`);
      expect(readPage(MONITOR_PAGE)).toContain(`](/docs/${TELEMETRY_PAGE})`);
    });

    it("name both launch platforms and the Everpure rename", (): void => {
      for (const page of OWNED_PAGES) {
        const markdown: string = readPage(page);

        for (const system of StorageSystemUtil.getAllSystems()) {
          expect(markdown).toContain(StorageSystemUtil.getDisplayName(system));
        }
      }

      expect(readPage(TELEMETRY_PAGE)).toContain("**Everpure**");
    });

    it("carry no Ceph or VMware-only concepts", (): void => {
      for (const page of OWNED_PAGES) {
        const markdown: string = readPage(page);

        for (const stray of [
          "ceph_",
          "CEPH_",
          "ceph.cluster.name",
          "vcenter.",
          "VCENTER_",
          "AI agent",
          "ONEUPTIME_AI_",
        ]) {
          expect({ page, stray, present: markdown.includes(stray) }).toEqual({
            page,
            stray,
            present: false,
          });
        }
      }
    });
  });

  describe("navigation", (): void => {
    it("lists the monitor page in the Infrastructure Monitors group, right after the Ceph monitor", (): void => {
      const urls: Array<string> = navGroup("Infrastructure Monitors").links.map(
        (link: NavLink): string => {
          return link.url;
        },
      );

      const index: number = urls.indexOf(`/docs/${MONITOR_PAGE}`);

      expect(index).toBeGreaterThan(0);
      expect(urls[index - 1]).toBe("/docs/monitor/ceph-monitor");
    });

    it("lists the agent page in the Infrastructure Agents group, right after the Ceph agent", (): void => {
      const urls: Array<string> = navGroup("Infrastructure Agents").links.map(
        (link: NavLink): string => {
          return link.url;
        },
      );

      const index: number = urls.indexOf(`/docs/${TELEMETRY_PAGE}`);

      expect(index).toBeGreaterThan(0);
      expect(urls[index - 1]).toBe("/docs/telemetry/ceph");
    });

    it("uses the product's titles", (): void => {
      const titles: Array<string> = [
        ...navGroup("Infrastructure Monitors").links,
        ...navGroup("Infrastructure Agents").links,
      ].map((link: NavLink): string => {
        return link.title;
      });

      expect(titles).toEqual(
        expect.arrayContaining([
          "Storage Array Monitor",
          "Storage Array Agent",
        ]),
      );
    });

    it("resolves only to its own page from either URL (the nav matches pages by substring)", (): void => {
      for (const page of OWNED_PAGES) {
        const matching: Array<string> = DocsNav.flatMap(
          (group: NavGroup): Array<NavLink> => {
            return group.links;
          },
        )
          .filter((link: NavLink): boolean => {
            return link.url.toLowerCase().includes(page);
          })
          .map((link: NavLink): string => {
            return link.url;
          });

        expect(matching).toEqual([`/docs/${page}`]);
      }
    });
  });

  describe("monitor page", (): void => {
    it("lists every catalog metric in its category's table, with its filter, platform and unit", (): void => {
      const catalog: string = section(
        readPage(MONITOR_PAGE),
        "## Collected Metrics",
      );

      for (const metric of getAllStorageArrayMetrics()) {
        const table: string = section(catalog, `### ${metric.category}`);
        const row: string | undefined = tableRows(table).find(
          (line: string): boolean => {
            const [name, filter] = cells(line);
            const filters: Array<string> = pinnedFilters(metric);
            return (
              name === `\`${metric.metricName}\`` &&
              (filters.length === 0
                ? filter === "—"
                : filters.every((pinned: string): boolean => {
                    return (filter as string).includes(pinned);
                  }) && (filter as string).split(",").length === filters.length)
            );
          },
        );

        expect({ metric: metric.id, listed: Boolean(row) }).toEqual({
          metric: metric.id,
          listed: true,
        });

        const [, , platform, unit] = cells(row as string);
        expect({ metric: metric.id, platform }).toEqual({
          metric: metric.id,
          platform: metric.storageSystems.map(platformName).join(", "),
        });
        expect({ metric: metric.id, unit }).toEqual({
          metric: metric.id,
          unit: metric.unit ? `\`${metric.unit}\`` : "—",
        });
      }
    });

    it("lists nothing the catalog does not ship", (): void => {
      const catalog: string = section(
        readPage(MONITOR_PAGE),
        "## Collected Metrics",
      );
      const metrics: Array<StorageArrayMetricDefinition> =
        getAllStorageArrayMetrics();
      const rows: Array<string> = getAllStorageArrayMetricCategories().flatMap(
        (category: string): Array<string> => {
          return tableRows(section(catalog, `### ${category}`)).filter(
            (line: string): boolean => {
              return !line.startsWith("| Metric ");
            },
          );
        },
      );

      expect(rows.length).toBe(metrics.length);
    });

    it("has one metric table per catalog category, in catalog order", (): void => {
      const catalog: string = section(
        readPage(MONITOR_PAGE),
        "## Collected Metrics",
      );
      const headings: Array<string> = catalog
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("### ");
        })
        .map((line: string): string => {
          return line.replace(/^### /, "");
        });

      expect(headings).toEqual(getAllStorageArrayMetricCategories());
    });

    it("lists every alert template by its exact name in its platform's table, with category and severity, and states the counts", (): void => {
      const templates: Array<StorageArrayAlertTemplate> =
        getAllStorageArrayAlertTemplates();
      const intro: string = section(
        readPage(MONITOR_PAGE),
        "## Pre-built Alert Templates",
      );
      const count: (system: StorageSystem) => number = (
        system: StorageSystem,
      ): number => {
        return templates.filter((template: StorageArrayAlertTemplate) => {
          return template.storageSystems.includes(system);
        }).length;
      };

      expect(intro).toContain(
        `OneUptime ships ${templates.length} templates — ${count(
          StorageSystem.PureStorageFlashArray,
        )} for FlashArray and ${count(
          StorageSystem.PureStorageFlashBlade,
        )} for FlashBlade`,
      );

      for (const template of templates) {
        expect(template.storageSystems).toHaveLength(1);

        const row: string | undefined = templateRow(template);

        expect({ template: template.id, listed: Boolean(row) }).toEqual({
          template: template.id,
          listed: true,
        });

        const [, category, severity] = cells(row as string);
        expect({ template: template.id, category, severity }).toEqual({
          template: template.id,
          category: template.category,
          severity: template.severity,
        });
      }
    });

    it("lists no template the registry does not ship", (): void => {
      const intro: string = section(
        readPage(MONITOR_PAGE),
        "## Pre-built Alert Templates",
      );

      for (const system of StorageSystemUtil.getAllSystems()) {
        const shipped: Array<string> = getAllStorageArrayAlertTemplates()
          .filter((template: StorageArrayAlertTemplate): boolean => {
            return template.storageSystems.includes(system);
          })
          .map((template: StorageArrayAlertTemplate): string => {
            return template.name;
          });
        const listed: Array<string> = tableRows(
          section(intro, `### ${platformName(system)}`),
        )
          .map((line: string): string => {
            return cells(line)[0] as string;
          })
          .filter((name: string): boolean => {
            return name !== "Template";
          });

        expect({ system, listed: [...listed].sort() }).toEqual({
          system,
          listed: [...shipped].sort(),
        });
      }
    });

    it("describes the query each template builds: metric, label filters, aggregation, group-by and window", (): void => {
      for (const template of getAllStorageArrayAlertTemplates()) {
        const shape: TemplateShape = templateShape(template);
        const watches: string = cells(templateRow(template) as string)[3]!;

        expect({ template: template.id, watches }).toEqual({
          template: template.id,
          watches: expect.stringContaining(`\`${shape.metricName}\``),
        });
        for (const filter of shape.attributes) {
          expect({ template: template.id, watches }).toEqual({
            template: template.id,
            watches: expect.stringContaining(filter),
          });
        }
        expect({ template: template.id, watches }).toEqual({
          template: template.id,
          watches: expect.stringContaining(`${shape.aggregation}`),
        });
        if (shape.groupBy) {
          expect({ template: template.id, watches }).toEqual({
            template: template.id,
            watches: expect.stringContaining(`per \`${shape.groupBy}\``),
          });
        }
        expect({ template: template.id, watches }).toEqual({
          template: template.id,
          watches: expect.stringContaining(shape.rollingTime.toLowerCase()),
        });
      }
    });

    it("states when each template fires and recovers, with the thresholds the templates ship", (): void => {
      for (const template of getAllStorageArrayAlertTemplates()) {
        const shape: TemplateShape = templateShape(template);
        const firesWhen: string = cells(templateRow(template) as string)[4]!;

        expect({ template: template.id, firesWhen }).toEqual({
          template: template.id,
          firesWhen: expect.stringContaining(
            `${COMPARISON[shape.fire.filterType as FilterType]} ${threshold(
              shape.fire.value,
            )}`,
          ),
        });

        if (shape.recover.filterType === FilterType.EqualTo) {
          // A state-in-a-label series: it recovers when the series is gone.
          expect(shape.recover.value).toBe(0);
          expect({ template: template.id, firesWhen }).toEqual({
            template: template.id,
            firesWhen: expect.stringContaining("recovers when"),
          });
        } else {
          expect({ template: template.id, firesWhen }).toEqual({
            template: template.id,
            firesWhen: expect.stringContaining(
              `recovers at ${
                COMPARISON[shape.recover.filterType as FilterType]
              } ${threshold(shape.recover.value)}`,
            ),
          });
        }
      }
    });

    it("documents the identity attributes, the array scope and the Terraform escape hatch", (): void => {
      const markdown: string = readPage(MONITOR_PAGE);

      for (const key of StorageArrayNameLabelKeys) {
        expect(markdown).toContain(`\`${key}\``);
      }

      for (const system of StorageSystemUtil.getAllSystems()) {
        expect(markdown).toContain(`\`${system}\``);
      }

      expect(markdown).toContain("`storage_array_monitor`");
      expect(markdown).toContain("`storageArrayMonitor`");
      expect(markdown).toContain("`arrayIdentifier`");
      expect(markdown).toContain("](/docs/terraform/monitor-steps)");
    });
  });

  describe("telemetry page", (): void => {
    it("documents every variable the agent's .env carries, and nothing else", (): void => {
      const table: string = section(
        readPage(TELEMETRY_PAGE),
        "## Environment Variables",
      );
      const documented: Array<string> = tableRows(table)
        .map((line: string): string | null => {
          const match: RegExpMatchArray | null = line.match(
            /^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/,
          );
          return match ? (match[1] as string) : null;
        })
        .filter((name: string | null): name is string => {
          return name !== null;
        });

      expect(documented.sort()).toEqual(dotenvVariables().sort());
    });

    it("documents every variable the collector configs read", (): void => {
      const table: string = section(
        readPage(TELEMETRY_PAGE),
        "## Environment Variables",
      );

      for (const config of SHIPPED_CONFIGS) {
        const variables: Array<string> = Array.from(
          readAgentFile(config).matchAll(/\$\{env:([A-Z0-9_]+)\}/g),
        ).map((match: RegExpMatchArray): string => {
          return match[1] as string;
        });

        expect(variables.length).toBeGreaterThan(0);

        for (const variable of variables) {
          expect({
            config,
            variable,
            documented: table.includes(`\`${variable}\``),
          }).toEqual({ config, variable, documented: true });
        }
      }
    });

    it("uses a complete .env in the Docker Compose quick start", (): void => {
      const quickStart: string = section(
        readPage(TELEMETRY_PAGE),
        "## Alternative — Docker Compose",
      );

      for (const name of dotenvVariables()) {
        expect(quickStart).toContain(`\n${name}=`);
      }

      expect(quickStart).toContain("STORAGE_ARRAY_NAME=my-storage-array");
      expect(quickStart).toContain("docker compose up -d");
      for (const config of SHIPPED_CONFIGS) {
        expect(quickStart).toContain(config);
      }
    });

    it("names the discovery attribute, the agent paths, the read-only user and the native endpoint", (): void => {
      const markdown: string = readPage(TELEMETRY_PAGE);

      expect(markdown).toContain("`storage.array.name`");
      expect(markdown).toContain("`storage.system`");
      expect(markdown).toContain("`/opt/oneuptime-storage-array-agent`");
      expect(markdown).toContain("oneuptime-storage-array-agent");
      expect(markdown).toContain(
        "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/install.sh",
      );
      expect(markdown).toContain(
        "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/troubleshoot.sh",
      );
      expect(markdown).toContain("pureadmin create --role readonly");
      expect(markdown).toContain("pureadmin create --api-token");
      expect(markdown).toContain("**readonly**");
      expect(markdown).toContain("namespace=purefa");
      expect(markdown).toContain("/otlp/v1/validate");
      expect(markdown).toContain("Telemetry & APM → Ingestion Keys");
    });

    it("matches the paths, defaults and names the agent ships", (): void => {
      const markdown: string = readPage(TELEMETRY_PAGE);
      const install: string = readAgentFile("install.sh");
      const compose: string = readAgentFile("docker-compose.yml");
      const unit: string = readAgentFile(
        "systemd/oneuptime-storage-array-agent.service",
      );

      expect(install).toContain(
        'INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-storage-array-agent}"',
      );
      expect(unit).toContain(
        "WorkingDirectory=/opt/oneuptime-storage-array-agent",
      );
      expect(compose).toContain(
        "container_name: oneuptime-storage-array-agent",
      );
      expect(compose).toContain(
        "STORAGE_SYSTEM=${STORAGE_SYSTEM:-purestorage.flasharray}",
      );
      expect(compose).toContain(
        "STORAGE_ARRAY_INSECURE_SKIP_VERIFY=${STORAGE_ARRAY_INSECURE_SKIP_VERIFY:-true}",
      );
      expect(markdown).toContain("Defaults to `purestorage.flasharray`");
      expect(markdown).toContain("Defaults to `true`");

      for (const service of ["pure-fa-exporter", "pure-fb-exporter"]) {
        expect(compose).toContain(`  ${service}:\n`);
        expect(markdown).toContain(`\`${service}\``);
      }
      for (const profile of ["flasharray-exporter", "flashblade"]) {
        expect(compose).toContain(`profiles: ["${profile}"]`);
        expect(markdown).toContain(`COMPOSE_PROFILES=${profile}`);
      }
    });

    it("states the scrape intervals the configs ship", (): void => {
      const scrapes: string = section(
        readPage(TELEMETRY_PAGE),
        "## How the Agent Scrapes",
      );

      for (const config of SHIPPED_CONFIGS) {
        for (const job of scrapeJobs(config)) {
          const endpoint: string =
            job.static_configs[0]!.labels.scrape_endpoint;

          expect(job.metrics_path).toBe(`/metrics/${endpoint}`);
          expect(scrapes).toContain(`\`/metrics/${endpoint}\``);
          expect({
            job: job.job_name,
            stated: scrapes.includes(spokenDuration(job.scrape_interval)),
          }).toEqual({ job: job.job_name, stated: true });
        }
      }

      expect(scrapes).toContain("`scrape_endpoint: <endpoint>`");
      expect(scrapes).toContain("`send_batch_max_size`");
    });

    it("names every catalog metric's family on the what-gets-collected table", (): void => {
      const collected: string = section(
        readPage(TELEMETRY_PAGE),
        "## What Gets Collected",
      );
      const families: Array<string> = Array.from(
        collected.matchAll(/`(pure(?:fa|fb)_[a-z_]+)(\*?)`/g),
      ).map((match: RegExpMatchArray): string => {
        return `${match[1]}${match[2]}`;
      });

      for (const metric of getAllStorageArrayMetrics()) {
        expect({
          metric: metric.metricName,
          named: families.some((family: string): boolean => {
            return family.endsWith("*")
              ? metric.metricName.startsWith(family.slice(0, -1))
              : metric.metricName === family;
          }),
        }).toEqual({ metric: metric.metricName, named: true });
      }
    });

    it("explains the syslog option the configs ship", (): void => {
      const syslog: string = section(
        readPage(TELEMETRY_PAGE),
        "## Optional — Ship the Array's Syslog",
      );
      const compose: string = readAgentFile("docker-compose.yml");

      expect(syslog).toContain("5514");
      expect(syslog).toContain("RFC 3164");
      expect(syslog).toContain("Settings → System → Syslog Servers");
      expect(compose).toContain('#   - "5514:5514/udp"');
      for (const config of SHIPPED_CONFIGS) {
        const text: string = readAgentFile(config);
        expect(text).toContain('#     listen_address: "0.0.0.0:5514"');
        expect(text).toContain("#   protocol: rfc3164");
      }
    });

    it("gives the curl test the native endpoint answers", (): void => {
      const blocks: Array<string> = codeBlocks(readPage(TELEMETRY_PAGE));

      expect(blocks).toEqual(
        expect.arrayContaining([
          "curl -k 'https://<array>/metrics/array?namespace=purefa' --header 'Authorization: Bearer <api-token>' | grep purefa_info",
        ]),
      );
    });
  });

  describe("translations", (): void => {
    it("ship both pages in every translated language", (): void => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const page of OWNED_PAGES) {
          expect({
            language,
            page,
            exists: fs.existsSync(pageFile(language, page)),
          }).toEqual({ language, page, exists: true });
        }
      }
    });

    it("keep every backticked identifier, in order", (): void => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const page of OWNED_PAGES) {
          expect({
            language,
            page,
            identifiers: backtickedIdentifiers(readPage(page, language)),
          }).toEqual({
            language,
            page,
            identifiers: backtickedIdentifiers(readPage(page)),
          });
        }
      }
    });

    it("keep every code block byte-identical", (): void => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const page of OWNED_PAGES) {
          expect({
            language,
            page,
            blocks: codeBlocks(readPage(page, language)),
          }).toEqual({ language, page, blocks: codeBlocks(readPage(page)) });
        }
      }
    });

    it("keep the same heading structure, table row counts and line count", (): void => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const page of OWNED_PAGES) {
          const english: Array<string> = readPage(page).split("\n");
          const translated: Array<string> = readPage(page, language).split(
            "\n",
          );

          expect({ language, page, lines: translated.length }).toEqual({
            language,
            page,
            lines: english.length,
          });

          const shape: (lines: Array<string>) => Array<string> = (
            lines: Array<string>,
          ): Array<string> => {
            return lines.map((line: string): string => {
              const heading: RegExpMatchArray | null =
                line.match(/^(#{1,6})\s/);
              if (heading) {
                return heading[1] as string;
              }
              if (line.startsWith("|")) {
                return "|";
              }
              if (FENCE_LINE.test(line)) {
                return "```";
              }
              return "";
            });
          };

          expect(shape(translated)).toEqual(shape(english));
        }
      }
    });

    it("keep every alert template name untranslated so the picker and the docs agree", (): void => {
      for (const language of TRANSLATED_LANGUAGES) {
        const markdown: string = readPage(MONITOR_PAGE, language);

        for (const template of getAllStorageArrayAlertTemplates()) {
          expect({
            language,
            template: template.id,
            present: markdown.includes(`| ${template.name} `),
          }).toEqual({ language, template: template.id, present: true });
        }
      }
    });

    it("mention the reserved array attribute and the Terraform escape hatch where English does", (): void => {
      for (const language of ["en", ...TRANSLATED_LANGUAGES]) {
        expect(readPage("monitor/custom-code-monitor", language)).toContain(
          "`storage.array.name`",
        );
        expect(readPage("terraform/monitor-steps", language)).toContain(
          "`storage_array_monitor`",
        );
      }
    });
  });

  describe("terraform provider", (): void => {
    it("registers the storage_array_monitor escape hatch on the MonitorStep key the Common layer defines", (): void => {
      const source: string = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "Scripts/TerraformProvider/StaticFiles/monitorsteps.go",
        ),
        "utf8",
      );

      expect(source).toContain(
        '{"storage_array_monitor", "storageArrayMonitor"},',
      );
      expect(source).toMatch(
        /"storage_array_monitor":\s+"Raw JSON escape hatch for the Storage Array monitor config/,
      );

      const step: MonitorStep = new MonitorStep();
      expect(Object.keys(step.data || {})).toEqual(
        expect.arrayContaining(["storageArrayMonitor"]),
      );
    });
  });
});
