import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsAnchorAlias,
  getEnglishAnchorAliases,
} from "../../../FeatureSet/Docs/Utils/AnchorAliases";
import {
  XCP_NG_AGENT_CA_FILE,
  XCP_NG_AGENT_CONTAINER,
  XCP_NG_AGENT_INSTALL_DIR,
  XCP_NG_AGENT_RECREATE_COMMAND,
  XCP_NG_MINIMUM_XEN_ORCHESTRA_VERSION,
  XCP_NG_OPENMETRICS_PATH,
  getXcpNgAgentDownloadCommand,
  getXcpNgAgentUpgradeCommand,
  getXcpNgSetupGuide,
} from "../../../FeatureSet/Dashboard/src/Pages/XcpNg/Utils/DocumentationMarkdown";
import {
  SetupGuideContent,
  SetupGuideLink,
  SetupGuideTopic,
} from "../../../FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  diagramSkeleton,
  escapeRegExp,
  navTitle,
} from "./DocsTranslationChecks";
import { tabPanel } from "./DocsPageShape";
import { dashboardLocale, drawnDashboardLabel } from "./DocsDashboardLabels";
import { sectionInLanguage } from "./NetworkDocsLabels";
import {
  XcpNgAlertTemplate,
  getAllXcpNgAlertTemplates,
  getXcpNgDefaultAlertTemplateId,
} from "Common/Types/Monitor/XcpNgAlertTemplates";
import {
  XcpNgMetricDefinition,
  getAllXcpNgMetricCategories,
  getAllXcpNgMetrics,
} from "Common/Types/Monitor/XcpNgMetricCatalog";
import {
  XCP_NG_ID_ATTRIBUTE,
  XCP_NG_POOL_ID_ATTRIBUTE,
  XCP_NG_POOL_NAME_ATTRIBUTE,
  XCP_NG_RATE_TYPED_AS_COUNTER_SERIES,
  XCP_NG_SCOPE_ATTRIBUTE,
  XEN_ORCHESTRA_NAME_ATTRIBUTE,
  XcpNgDerivedSeries,
  XcpNgScope,
} from "Common/Types/XcpNg/XcpNgTelemetry";
import {
  XCP_NG_POOL_RESOURCE_ATTRIBUTE,
  XcpNgResourceFilterAttributeKeys,
} from "Common/Utils/Monitor/MonitorStepMetricQueries";
import {
  InstallScriptEntry,
  InstallScriptName,
  getInstallScriptEntry,
  getInstallScriptFile,
} from "Common/Types/InstallScripts/InstallScripts";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
  MonitorTypeProps,
} from "Common/Types/Monitor/MonitorType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepXcpNgMonitor from "Common/Types/Monitor/MonitorStepXcpNgMonitor";
import {
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "Common/Types/ObjectID";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The XCP-ng docs against the product they describe (#10995).
 *
 * Markdown is not compiled, so nothing else notices when the metric catalog
 * gains a series the monitor page never lists, an alert template moves its
 * threshold or its window, the agent's .env gains a variable the guide does
 * not explain, the in-app setup guide and the docs stop saying the same
 * thing, or a translation drifts from its English page. Each test reads the
 * source of truth - the catalog, the template registry, the agent's files,
 * the in-app guide, the nav, the Dashboard's locales - and checks the shipped
 * pages still tell the same story, in all 17 docs languages.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CONTENT_DIR: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content",
);
const DOCS_LOCALES_DIR: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Locales",
);
const AGENT_DIR: string = path.join(REPO_ROOT, "agents/XcpNgAgent");
const MONITOR_FORM: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Components/Form/Monitor/XcpNgMonitor/XcpNgMonitorStepForm.tsx",
);
// The step card the form sits in, titled per monitor type.
const MONITOR_STEP_FORM: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep.tsx",
);
// The plugin's health check, which answers without the secret.
const HEALTH_PATH: string = "/openmetrics/health";

const TELEMETRY_PAGE: string = "telemetry/xcp-ng";
const MONITOR_PAGE: string = "monitor/xcp-ng-monitor";
const OWNED_PAGES: ReadonlyArray<string> = [TELEMETRY_PAGE, MONITOR_PAGE];

// The docs show OneUptime Cloud's address; a self-hosted reader puts theirs.
const DOCS_ONEUPTIME_URL: string = "https://oneuptime.com";

// The anchor the in-app guide links to (Pages/XcpNg/Utils/DocumentationMarkdown).
const CERTIFICATE_HEADING: string = "## Xen Orchestra's certificate";
const CERTIFICATE_ANCHOR: string = "xen-orchestras-certificate";

const TRANSLATED_LANGUAGES: ReadonlyArray<string> =
  SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
    return language !== "en";
  });

interface LanguagePage {
  language: string;
  page: string;
}

const TRANSLATED_PAGES: ReadonlyArray<LanguagePage> =
  TRANSLATED_LANGUAGES.flatMap((language: string): Array<LanguagePage> => {
    return OWNED_PAGES.map((page: string): LanguagePage => {
      return { language, page };
    });
  });

const EVERY_PAGE: ReadonlyArray<LanguagePage> = [
  ...OWNED_PAGES.map((page: string): LanguagePage => {
    return { language: "en", page };
  }),
  ...TRANSLATED_PAGES,
];

const FENCE_LINE: RegExp = /^\s*```/;
const MERMAID_FENCE: RegExp = /^\s*```mermaid\b/;
const TABLE_DIVIDER: RegExp = /^\|\s*-/;
const ENV_REFERENCE: RegExp = /\$\{env:([A-Z0-9_]+)\}/g;
const COMPOSE_REFERENCE: RegExp = /\$\{([A-Z][A-Z0-9_]*)/g;
// A variable install.sh writes to the .env: NAME=value.
const DOTENV_LINE: RegExp = /^[A-Z][A-Z0-9_]*=/;
// A curl that skips the certificate check.
const INSECURE_CURL: RegExp = /\bcurl\b.*\s-k\b/;
// A line with words to translate, not only names and code.
const PROSE_LINE: RegExp = /[A-Za-z]{4,}.*[A-Za-z]{4,}/;

/*
 * js-yaml from Common/node_modules, as StorageArrayDocs.test.ts loads it:
 * Common declares js-yaml 4, App declares no YAML parser.
 */
interface JsYamlModule {
  load: (text: string) => unknown;
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: JsYamlModule = require(
  path.join(REPO_ROOT, "packages", "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

function pageFile(language: string, relative: string): string {
  return path.join(CONTENT_DIR, language, `${relative}.md`);
}

function readPage(relative: string, language: string = "en"): string {
  return fs.readFileSync(pageFile(language, relative), "utf8");
}

function readAgentFile(file: string): string {
  return fs.readFileSync(path.join(AGENT_DIR, file), "utf8");
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

/* Table rows (not the divider) of the given markdown. */
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

/*
 * Fenced code blocks of a page, each as its text between the fences, a
 * diagram as its skeleton when asked: a translation draws its diagram in its
 * own words, so only its node ids, shapes, arrows and lines are the English.
 */
function codeBlocks(
  markdown: string,
  options: { diagramsBySkeleton: boolean } = { diagramsBySkeleton: false },
): Array<string> {
  const blocks: Array<string> = [];
  let current: Array<string> | null = null;
  let diagram: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      if (current) {
        const code: string = current.join("\n");
        blocks.push(
          diagram && options.diagramsBySkeleton ? diagramSkeleton(code) : code,
        );
        current = null;
      } else {
        current = [];
        diagram = MERMAID_FENCE.test(line);
      }
      continue;
    }

    if (current) {
      current.push(line);
    }
  }

  return blocks;
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

    const heading: RegExpMatchArray | null = line.match(/^#{2,6}\s+(.*)$/);
    if (heading) {
      headings.add(slugifyMarkdownHeading((heading[1] as string).trim()));
    }

    for (const match of line.matchAll(/\]\(#([^)]+)\)/g)) {
      anchors.push(decodeURIComponent(match[1] as string));
    }
  }

  return anchors.filter((anchor: string): boolean => {
    return !headings.has(anchor);
  });
}

function anchorsOf(markdown: string): Set<string> {
  const anchors: Set<string> = new Set<string>();
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    const heading: RegExpMatchArray | null = inFence
      ? null
      : line.match(/^#{2,6}\s+(.*)$/);
    if (heading) {
      anchors.add(slugifyMarkdownHeading((heading[1] as string).trim()));
    }
  }

  return anchors;
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

function navUrls(title: string): Array<string> {
  return navGroup(title).links.map((link: NavLink): string => {
    return link.url;
  });
}

/* The variables install.sh writes to the agent's .env, in its heredoc. */
function dotenvVariables(): Array<string> {
  const heredoc: RegExpMatchArray | null = readAgentFile("install.sh").match(
    /cat > "\$ENV_FILE" <<ENVEOF\n([\s\S]*?)\nENVEOF/,
  );

  expect(heredoc).not.toBeNull();

  return (heredoc as RegExpMatchArray)[1]!
    .split("\n")
    .filter((line: string): boolean => {
      return DOTENV_LINE.test(line);
    })
    .map((line: string): string => {
      return line.split("=")[0] as string;
    });
}

/* The variables docker-compose.yml reads from the .env next to it. */
function composeVariables(): Array<string> {
  return Array.from(
    new Set(
      Array.from(
        readAgentFile("docker-compose.yml").matchAll(COMPOSE_REFERENCE),
      )
        .map((match: RegExpMatchArray): string => {
          return match[1] as string;
        })
        .filter((name: string): boolean => {
          // ${XO_NAME:-${XO_ADDRESS:-}} reads XO_ADDRESS again: one variable.
          return name.length > 0;
        }),
    ),
  ).sort();
}

/* The variables the docs' environment table names, in its first column. */
function documentedVariables(language: string = "en"): Array<string> {
  return tableRows(
    sectionInLanguage(language, TELEMETRY_PAGE, "## Environment variables"),
  )
    .map((line: string): string | null => {
      const match: RegExpMatchArray | null = line.match(
        /^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/,
      );
      return match ? (match[1] as string) : null;
    })
    .filter((name: string | null): name is string => {
      return name !== null;
    });
}

interface ScrapeJob {
  job_name: string;
  metrics_path: string;
  scrape_interval: string;
  scheme: string;
}

interface CollectorConfig {
  receivers: { prometheus: { config: { scrape_configs: Array<ScrapeJob> } } };
  processors: Record<string, unknown>;
  service: {
    pipelines: { metrics: { processors: Array<string> } };
  };
}

function collectorConfig(): CollectorConfig {
  return jsYaml.load(
    readAgentFile("otel-collector-config.yaml"),
  ) as CollectorConfig;
}

/* A Prometheus duration as the docs say it: 60s -> "60 seconds". */
function spokenSeconds(duration: string): string {
  const match: RegExpMatchArray = duration.match(
    /^(\d+)s$/,
  ) as RegExpMatchArray;
  return `${Number(match[1])} seconds`;
}

function guideFor(
  method: "install-script" | "docker-compose",
): SetupGuideContent {
  return getXcpNgSetupGuide({
    oneuptimeUrl: DOCS_ONEUPTIME_URL,
    apiKey: "<YOUR_API_KEY>",
    hasApiKey: false,
    method,
  });
}

function guideTopic(
  guide: SetupGuideContent,
  title: string,
  kind: "advanced" | "troubleshooting",
): SetupGuideTopic {
  const topic: SetupGuideTopic | undefined = (guide[kind] || []).find(
    (item: SetupGuideTopic): boolean => {
      return item.title === title;
    },
  );

  expect({ title, found: Boolean(topic) }).toEqual({ title, found: true });

  return topic as SetupGuideTopic;
}

interface TemplateShape {
  metricNames: Array<string>;
  attributes: Array<string>;
  groupBy: string | undefined;
  aggregation: string;
  rollingTime: string;
  isFormula: boolean;
  fire: Array<CriteriaFilter>;
  recover: Array<CriteriaFilter>;
}

/* What a template builds: its queries and its two criteria. */
function templateShape(template: XcpNgAlertTemplate): TemplateShape {
  const step: MonitorStep = template.getMonitorStep({
    poolIdentifier: "b7569d99-30f8-178a-7d94-801de3e29b5b",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Docs",
  });
  const monitor: MonitorStepXcpNgMonitor = step.data!
    .xcpNgMonitor as MonitorStepXcpNgMonitor;
  const queries: MonitorStepXcpNgMonitor["metricViewConfig"]["queryConfigs"] =
    monitor.metricViewConfig.queryConfigs;
  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

  return {
    metricNames: queries.map(
      (
        query: MonitorStepXcpNgMonitor["metricViewConfig"]["queryConfigs"][number],
      ): string => {
        return query.metricQueryData.filterData.metricName as string;
      },
    ),
    attributes: Array.from(
      new Set(
        queries.flatMap(
          (
            query: MonitorStepXcpNgMonitor["metricViewConfig"]["queryConfigs"][number],
          ): Array<string> => {
            return Object.entries(
              (query.metricQueryData.filterData.attributes || {}) as Record<
                string,
                string
              >,
            ).map(([key, value]: [string, string]): string => {
              return `\`${key} = ${value}\``;
            });
          },
        ),
      ),
    ),
    groupBy: queries[0]!.metricQueryData.groupByAttributeKeys?.[0],
    aggregation: queries[0]!.metricQueryData.filterData
      .aggegationType as string,
    rollingTime: monitor.rollingTime as string,
    isFormula: monitor.metricViewConfig.formulaConfigs.length > 0,
    fire: instances[0]!.data!.filters,
    recover: instances[1]!.data!.filters,
  };
}

/* A threshold as the docs write it: 0.8099999999999999 -> "0.81". */
function threshold(value: unknown): string {
  return String(Number(Number(value).toPrecision(6)));
}

/* The row of a template in the monitor page's template table. */
function templateRow(template: XcpNgAlertTemplate): Array<string> {
  const table: string = section(
    readPage(MONITOR_PAGE),
    "## Pre-built Alert Templates",
  );
  const row: string | undefined = tableRows(table).find(
    (line: string): boolean => {
      return cells(line)[0] === template.name;
    },
  );

  expect({ template: template.id, listed: Boolean(row) }).toEqual({
    template: template.id,
    listed: true,
  });

  return cells(row as string);
}

/* A catalog unit as the monitor page's Unit column writes it. */
function unitCell(unit: string | undefined): string {
  if (!unit) {
    return "—";
  }
  return unit.replace(/^\{(.*)\}$/, "$1");
}

/*
 * The Dashboard labels these pages quote in bold. A translation names each
 * as its language's Dashboard draws it once the locale words it; a label the
 * locale has no word for yet (the XCP-ng ones, until the Dashboard's keys are
 * translated) is not checked, and is checked as soon as it is.
 */
const QUOTED_LABELS: ReadonlyArray<string> = [
  "Products",
  "Infrastructure",
  "All Pools",
  "Overview",
  "Hosts",
  "VMs",
  "Storage",
  "Topology",
  "Resource Usage",
  "Recommendations",
  "Metrics",
  "Logs",
  "Incidents",
  "Alerts",
  "Scheduled Maintenance",
  "Feed",
  "Owners",
  "Settings",
  "Documentation",
  "Agent Version",
  "Disconnected",
  "Healthy",
  "Degraded",
  "Unhealthy",
  "Needs attention",
  "Monitors",
  "Create Monitor",
  "Monitor Type",
  "More monitor types",
  "Name",
  "Next",
  "What to alert on",
  "Change",
  "More fields",
  "Advanced",
  "Select Metrics",
  "Group by",
  "Criteria",
  "Resource Scope",
  "UUID",
  "Host Name",
  "XCP-ng Pool",
  "Add XCP-ng Pool",
  "Storage Repository",
  "Virtual Disk",
  "Project Settings",
  "Telemetry & APM",
  "Ingestion Keys",
  "Offline",
  "Operational",
];

/* Every bold span of a line, a path's steps one by one. */
function boldLabelsOf(line: string): Array<string> {
  return Array.from(line.matchAll(/\*\*([^*\n]+?)\*\*/g)).flatMap(
    (match: RegExpMatchArray): Array<string> => {
      return (match[1] as string)
        .split(/ [→←] /)
        .map((label: string): string => {
          return label.replace(/[:：]$/, "").trim();
        });
    },
  );
}

/* The locale's own word for a label, or null while it has none of its own. */
function lookedUpLabel(language: string, label: string): string | null {
  const value: unknown = dashboardLocale(language)[label];

  if (typeof value !== "string" || !value.trim() || value === label) {
    return null;
  }

  return drawnDashboardLabel(language, label);
}

describe("XCP-ng docs", (): void => {
  describe("pages", (): void => {
    it("ship both English pages, titled as the nav titles them", (): void => {
      expect(readPage(TELEMETRY_PAGE).split("\n")[0]).toBe("# XCP-ng Agent");
      expect(readPage(MONITOR_PAGE).split("\n")[0]).toBe("# XCP-ng Monitor");
    });

    it("keep every code fence closed, in every language", (): void => {
      for (const { language, page } of EVERY_PAGE) {
        const fences: number = readPage(page, language)
          .split("\n")
          .filter((line: string): boolean => {
            return FENCE_LINE.test(line);
          }).length;

        expect({ language, page, odd: fences % 2 }).toEqual({
          language,
          page,
          odd: 0,
        });
      }
    });

    it("only link to /docs/ pages the nav has, in every language", (): void => {
      const navPages: Set<string> = new Set(
        DocsNav.flatMap((group: NavGroup): Array<string> => {
          return group.links.map((link: NavLink): string => {
            return link.url;
          });
        }),
      );

      for (const { language, page } of EVERY_PAGE) {
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
            inNav: navPages.has(target),
          }).toEqual({ language, page, target, inNav: true });
        }
      }
    });

    it("only link to headings that exist, on the same page or the other XCP-ng page, in every language", (): void => {
      for (const { language, page } of EVERY_PAGE) {
        const markdown: string = readPage(page, language);

        expect({ language, page, broken: brokenAnchors(markdown) }).toEqual({
          language,
          page,
          broken: [],
        });

        for (const match of markdown.matchAll(
          /\]\(\/docs\/(telemetry\/xcp-ng|monitor\/xcp-ng-monitor)#([^)]+)\)/g,
        )) {
          const other: string = match[1] as string;
          const anchor: string = decodeURIComponent(match[2] as string);

          expect({
            language,
            page,
            link: `${other}#${anchor}`,
            exists: anchorsOf(readPage(other, language)).has(anchor),
          }).toEqual({
            language,
            page,
            link: `${other}#${anchor}`,
            exists: true,
          });
        }
      }
    });

    it("cross-link each other", (): void => {
      expect(readPage(TELEMETRY_PAGE)).toContain(`](/docs/${MONITOR_PAGE})`);
      expect(readPage(MONITOR_PAGE)).toContain(`](/docs/${TELEMETRY_PAGE})`);
    });

    it("carry no Proxmox, storage array or AI agent concepts", (): void => {
      for (const page of OWNED_PAGES) {
        const markdown: string = readPage(page);

        for (const stray of [
          "pve_",
          "PVE_",
          "proxmox.cluster.name",
          "storage.array.name",
          "ONEUPTIME_AI_",
          "AI agent",
          "insecure_skip_verify",
          "INSECURE_SKIP_VERIFY",
        ]) {
          expect({ page, stray, present: markdown.includes(stray) }).toEqual({
            page,
            stray,
            present: false,
          });
        }
      }
    });

    it("skip a certificate check only for the health check, which sends no secret", (): void => {
      const insecure: Array<string> = codeBlocks(readPage(TELEMETRY_PAGE))
        .join("\n")
        .split("\n")
        .filter((line: string): boolean => {
          return INSECURE_CURL.test(line);
        });

      expect(insecure).toEqual([
        `curl -k https://xo.example.com${HEALTH_PATH}`,
      ]);
      expect(readAgentFile("install.sh")).toContain(HEALTH_PATH);
    });
  });

  describe("navigation", (): void => {
    it("lists the monitor page in Infrastructure Monitors, right after the Proxmox monitor", (): void => {
      const urls: Array<string> = navUrls("Infrastructure Monitors");
      const index: number = urls.indexOf(`/docs/${MONITOR_PAGE}`);

      expect(index).toBeGreaterThan(0);
      expect(urls[index - 1]).toBe("/docs/monitor/proxmox-monitor");
    });

    it("lists the agent page in Infrastructure Agents, right after the Proxmox agent", (): void => {
      const urls: Array<string> = navUrls("Infrastructure Agents");
      const index: number = urls.indexOf(`/docs/${TELEMETRY_PAGE}`);

      expect(index).toBeGreaterThan(0);
      expect(urls[index - 1]).toBe("/docs/telemetry/proxmox");
    });

    it("titles the links as the pages title themselves", (): void => {
      const links: Array<NavLink> = [
        ...navGroup("Infrastructure Monitors").links,
        ...navGroup("Infrastructure Agents").links,
      ];

      expect(
        links
          .filter((link: NavLink): boolean => {
            return link.url.includes("xcp-ng");
          })
          .map((link: NavLink): string => {
            return `${link.title} -> ${link.url}`;
          })
          .sort(),
      ).toEqual([
        `XCP-ng Agent -> /docs/${TELEMETRY_PAGE}`,
        `XCP-ng Monitor -> /docs/${MONITOR_PAGE}`,
      ]);
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

    it("has both links' titles in every docs locale, each naming XCP-ng", (): void => {
      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const locale: { navLinks: Record<string, string> } = JSON.parse(
          fs.readFileSync(
            path.join(DOCS_LOCALES_DIR, `${language}.json`),
            "utf8",
          ),
        ) as { navLinks: Record<string, string> };

        for (const title of ["XCP-ng Agent", "XCP-ng Monitor"]) {
          const translated: string | undefined = locale.navLinks[title];

          expect({ language, title, translated }).toEqual({
            language,
            title,
            translated: expect.stringContaining("XCP-ng"),
          });
        }
      }
    });
  });

  describe("monitor page", (): void => {
    it("names the monitor type as the picker offers it, under Infrastructure", (): void => {
      const props: MonitorTypeProps | undefined =
        MonitorTypeHelper.getAllMonitorTypeProps().find(
          (item: MonitorTypeProps): boolean => {
            return item.monitorType === MonitorType.XcpNg;
          },
        );
      const infrastructure: MonitorTypeCategory | undefined =
        MonitorTypeHelper.getMonitorTypeCategories().find(
          (category: MonitorTypeCategory): boolean => {
            return category.label === "Infrastructure";
          },
        );
      const create: string = section(
        readPage(MONITOR_PAGE),
        "## Create an XCP-ng monitor",
      );

      expect(props?.title).toBe("XCP-ng");
      expect(infrastructure?.monitorTypes).toContain(MonitorType.XcpNg);
      expect(create).toContain(
        `pick **${props?.title}** under **Infrastructure**`,
      );
      // The search word the page gives finds the type by its title.
      expect(create).toContain("type `xcp` in the search box");
      expect(props?.title.toLowerCase()).toContain("xcp");
    });

    it("starts a new monitor on the template the form starts on", (): void => {
      const template: XcpNgAlertTemplate | undefined =
        getAllXcpNgAlertTemplates().find(
          (item: XcpNgAlertTemplate): boolean => {
            return item.id === getXcpNgDefaultAlertTemplateId();
          },
        );

      expect(readPage(MONITOR_PAGE)).toContain(
        `A new monitor starts on **${template?.name}**`,
      );
    });

    it("names the form's fields and scope options as the form draws them", (): void => {
      const form: string = fs.readFileSync(MONITOR_FORM, "utf8");
      const settings: string = section(
        readPage(MONITOR_PAGE),
        "## Monitor settings",
      );

      for (const field of [
        "XCP-ng Pool",
        "Resource Scope",
        "UUID",
        "Host Name",
        "XCP-ng Metric",
      ]) {
        expect({ field, inForm: form.includes(`title="${field}"`) }).toEqual({
          field,
          inForm: true,
        });
        expect({
          field,
          inDocs: settings.includes(`| **${field}** |`),
        }).toEqual({ field, inDocs: true });
      }

      const options: Array<string> = Array.from(
        form.matchAll(/\{ label: "([^"]+)", value: XcpNgScope\.\w+ \}/g),
      ).map((match: RegExpMatchArray): string => {
        return `**${match[1]}**`;
      });
      const scopeRow: string = tableRows(settings).find(
        (line: string): boolean => {
          return line.startsWith("| **Resource Scope** |");
        },
      ) as string;

      expect(options.length).toBe(Object.values(XcpNgScope).length);
      for (const option of options) {
        expect(scopeRow).toContain(option);
      }
      expect(fs.readFileSync(MONITOR_STEP_FORM, "utf8")).toContain(
        'title="XCP-ng Monitor Configuration"',
      );
      expect(readPage(MONITOR_PAGE)).toContain(
        "Under **XCP-ng Monitor Configuration**, pick the pool from **XCP-ng Pool**.",
      );
    });

    it("names the attributes the filters, the templates and the pool scope compare", (): void => {
      const markdown: string = readPage(MONITOR_PAGE);
      const identity: string = section(markdown, "## Resource identity");

      for (const key of Object.values(XcpNgResourceFilterAttributeKeys)) {
        expect(markdown).toContain(`\`${key}\``);
      }
      expect(markdown).toContain(`\`${XCP_NG_POOL_RESOURCE_ATTRIBUTE}\``);
      expect(XCP_NG_POOL_RESOURCE_ATTRIBUTE).toBe(
        `resource.${XCP_NG_POOL_ID_ATTRIBUTE}`,
      );
      expect(identity).toContain(`\`resource.${XCP_NG_POOL_NAME_ATTRIBUTE}\``);
      expect(identity).toContain(
        `\`resource.${XEN_ORCHESTRA_NAME_ATTRIBUTE}\``,
      );

      const scopeRow: string = tableRows(identity).find(
        (line: string): boolean => {
          return line.startsWith(`| \`${XCP_NG_SCOPE_ATTRIBUTE}\` |`);
        },
      ) as string;
      const idRow: string | undefined = tableRows(identity).find(
        (line: string): boolean => {
          return line.startsWith(`| \`${XCP_NG_ID_ATTRIBUTE}\` |`);
        },
      );

      for (const scope of Object.values(XcpNgScope)) {
        expect(cells(scopeRow)[1]).toContain(`\`${scope}\``);
      }
      expect(idRow).toBeDefined();
    });

    it("lists every catalog metric in its category's table, with its unit, and nothing else", (): void => {
      const catalog: string = section(
        readPage(MONITOR_PAGE),
        "## Collected Metrics",
      );
      let listed: number = 0;

      for (const category of getAllXcpNgMetricCategories()) {
        listed += tableRows(section(catalog, `### ${category}`)).filter(
          (line: string): boolean => {
            return !line.startsWith("| Metric ");
          },
        ).length;
      }

      for (const metric of getAllXcpNgMetrics()) {
        const row: string | undefined = tableRows(
          section(catalog, `### ${metric.category}`),
        ).find((line: string): boolean => {
          return cells(line)[0] === `\`${metric.metricName}\``;
        });

        expect({ metric: metric.id, listed: Boolean(row) }).toEqual({
          metric: metric.id,
          listed: true,
        });
        expect({ metric: metric.id, unit: cells(row as string)[1] }).toEqual({
          metric: metric.id,
          unit: unitCell(metric.unit),
        });
      }

      expect(listed).toBe(getAllXcpNgMetrics().length);
    });

    it("has one metric table per catalog category, in catalog order", (): void => {
      const headings: Array<string> = section(
        readPage(MONITOR_PAGE),
        "## Collected Metrics",
      )
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("### ");
        })
        .map((line: string): string => {
          return line.replace(/^### /, "");
        });

      expect(headings).toEqual(getAllXcpNgMetricCategories());
    });

    it("says a rate typed as a counter is a rate, for exactly the eight such series", (): void => {
      const catalog: string = section(
        readPage(MONITOR_PAGE),
        "## Collected Metrics",
      );
      const rates: Array<string> = getAllXcpNgMetrics()
        .filter((metric: XcpNgMetricDefinition): boolean => {
          return Boolean(metric.isRateTypedAsCounter);
        })
        .map((metric: XcpNgMetricDefinition): string => {
          return metric.metricName;
        });

      expect([...rates].sort()).toEqual(
        [...XCP_NG_RATE_TYPED_AS_COUNTER_SERIES].sort(),
      );
      for (const metric of rates) {
        const row: string = tableRows(catalog).find((line: string): boolean => {
          return cells(line)[0] === `\`${metric}\``;
        }) as string;

        expect({ metric, says: cells(row)[2] }).toEqual({
          metric,
          says: expect.stringContaining("A rate, though Xen Orchestra"),
        });
      }
    });

    it("lists every alert template by its exact name, category and severity, and states the count", (): void => {
      const templates: Array<XcpNgAlertTemplate> = getAllXcpNgAlertTemplates();
      const intro: string = section(
        readPage(MONITOR_PAGE),
        "## Pre-built Alert Templates",
      );
      const listed: Array<string> = tableRows(intro)
        .map((line: string): string => {
          return cells(line)[0] as string;
        })
        .filter((name: string): boolean => {
          return name !== "Template";
        });

      expect(intro).toContain(
        `The **What to alert on** list offers ${templates.length} templates.`,
      );
      expect(listed).toEqual(
        templates.map((template: XcpNgAlertTemplate): string => {
          return template.name;
        }),
      );

      for (const template of templates) {
        const row: Array<string> = templateRow(template);

        expect({
          template: template.id,
          category: row[1],
          severity: row[2],
        }).toEqual({
          template: template.id,
          category: template.category,
          severity: template.severity,
        });
      }
    });

    it("describes the query each template builds: metrics, filters, aggregation, group-by and window", (): void => {
      for (const template of getAllXcpNgAlertTemplates()) {
        const shape: TemplateShape = templateShape(template);
        const watches: string = templateRow(template)[3] as string;

        for (const metricName of shape.metricNames) {
          expect({ template: template.id, watches }).toEqual({
            template: template.id,
            watches: expect.stringContaining(`\`${metricName}\``),
          });
        }
        for (const filter of shape.attributes) {
          expect({ template: template.id, watches }).toEqual({
            template: template.id,
            watches: expect.stringContaining(filter),
          });
        }
        expect({ template: template.id, watches }).toEqual({
          template: template.id,
          watches: expect.stringContaining(
            shape.isFormula ? `(both ${shape.aggregation})` : shape.aggregation,
          ),
        });
        if (shape.groupBy) {
          expect({ template: template.id, watches }).toEqual({
            template: template.id,
            watches: expect.stringContaining(`per \`${shape.groupBy}\``),
          });
        } else {
          expect({ template: template.id, watches }).toEqual({
            template: template.id,
            watches: expect.stringContaining("over the whole pool"),
          });
        }
        expect({ template: template.id, watches }).toEqual({
          template: template.id,
          watches: expect.stringContaining(shape.rollingTime.toLowerCase()),
        });
      }
    });

    it("states when each template fires and recovers, with the thresholds the templates ship", (): void => {
      for (const template of getAllXcpNgAlertTemplates()) {
        const shape: TemplateShape = templateShape(template);
        const row: Array<string> = templateRow(template);
        const fires: string = row[4] as string;
        const recovers: string = row[5] as string;
        const fire: CriteriaFilter = shape.fire[0]!;
        const recover: CriteriaFilter = shape.recover[0]!;

        // The heartbeat: a count below 0, which only its no-data policy meets.
        if (fire.filterType === FilterType.LessThan && fire.value === 0) {
          expect(fires).toBe("No data for the whole window");
          expect(recovers).toBe("Data arrives again");
          expect(recover.filterType).toBe(FilterType.GreaterThanOrEqualTo);
          continue;
        }

        expect({ template: template.id, fires }).toEqual({
          template: template.id,
          fires: expect.stringContaining(threshold(fire.value)),
        });
        expect({ template: template.id, recovers }).toEqual({
          template: template.id,
          recovers: expect.stringContaining(threshold(recover.value)),
        });

        if (shape.fire.length > 1) {
          // A pair of comparisons on one object (Host Restarted).
          for (const extra of shape.fire.slice(1)) {
            expect(fires).toContain(`\`${shape.metricNames[1]}\` is 1`);
            expect(extra.filterType).toBe(FilterType.GreaterThan);
            expect(extra.value).toBe(0);
          }
          expect(fires).toContain(`below ${threshold(fire.value)}`);
          expect(recovers).toContain(`at ${threshold(recover.value)} or more`);
          expect(recovers).toContain(
            `\`${shape.metricNames[1]}\` is ${threshold(shape.recover[1]!.value)}`,
          );
          continue;
        }

        const fireWord: string =
          fire.filterType === FilterType.LessThan ? "Below" : "Above";
        expect({ template: template.id, fires }).toEqual({
          template: template.id,
          fires: expect.stringMatching(
            new RegExp(
              `^${fireWord} ${escapeRegExp(threshold(fire.value))}\\b`,
            ),
          ),
        });

        const recoverWord: string =
          recover.filterType === FilterType.LessThanOrEqualTo
            ? "At or below"
            : "At";
        expect({ template: template.id, recovers }).toEqual({
          template: template.id,
          recovers: expect.stringMatching(
            new RegExp(
              `^${recoverWord} ${escapeRegExp(threshold(recover.value))}\\b`,
            ),
          ),
        });
      }
    });

    it("documents the Terraform attribute as the provider and the step define it", (): void => {
      const terraform: string = section(readPage(MONITOR_PAGE), "## Terraform");
      const provider: string = fs.readFileSync(
        path.join(
          REPO_ROOT,
          "Scripts/TerraformProvider/StaticFiles/monitorsteps.go",
        ),
        "utf8",
      );
      const step: MonitorStep = new MonitorStep();

      expect(provider).toContain('{"xcp_ng_monitor", "xcpNgMonitor"},');
      expect(Object.keys(step.data || {})).toEqual(
        expect.arrayContaining(["xcpNgMonitor"]),
      );
      expect(terraform).toContain("`xcp_ng_monitor`");
      expect(terraform).toContain("`xcpNgMonitor`");
      for (const key of [
        "poolIdentifier",
        "resourceFilters",
        "metricViewConfig",
        "rollingTime",
      ]) {
        expect(terraform).toContain(`\`${key}\``);
      }
      for (const key of Object.keys(XcpNgResourceFilterAttributeKeys)) {
        expect(terraform).toContain(`\`${key}\``);
      }
      expect(terraform).toContain("](/docs/terraform/monitor-steps)");
      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect({
          language,
          listed: readPage("terraform/monitor-steps", language).includes(
            "`xcp_ng_monitor`",
          ),
        }).toEqual({ language, listed: true });
      }
    });
  });

  describe("agent page", (): void => {
    it("documents every variable the agent's .env carries, and nothing else", (): void => {
      expect([...documentedVariables()].sort()).toEqual(
        [...dotenvVariables()].sort(),
      );
    });

    it("documents every variable the collector config and the Compose file read", (): void => {
      const documented: Array<string> = documentedVariables();

      for (const match of readAgentFile("otel-collector-config.yaml").matchAll(
        ENV_REFERENCE,
      )) {
        expect(documented).toContain(match[1]);
      }
      for (const name of composeVariables()) {
        expect(documented).toContain(name);
      }
    });

    it("writes, in the Docker Compose quick start, exactly the .env the Compose file reads", (): void => {
      const quickStart: string = tabPanel(
        readPage(TELEMETRY_PAGE),
        "Docker Compose",
      );
      const env: string = codeBlocks(quickStart).find(
        (block: string): boolean => {
          return block.startsWith("ONEUPTIME_URL=");
        },
      ) as string;
      const written: Array<string> = env
        .split("\n")
        .map((line: string): string => {
          return line.split("=")[0] as string;
        })
        .sort();

      expect(written).toEqual(composeVariables());
      expect(env).toContain("XO_OPENMETRICS_SECRET='");
      expect(quickStart).toContain(
        getXcpNgAgentDownloadCommand(DOCS_ONEUPTIME_URL),
      );
      expect(quickStart).toContain(`\`${XCP_NG_AGENT_CA_FILE}\``);
      expect(quickStart).toContain("docker compose up -d");
    });

    it("matches the paths, names and files the agent ships and every OneUptime serves", (): void => {
      const markdown: string = readPage(TELEMETRY_PAGE);
      const compose: string = readAgentFile("docker-compose.yml");
      const entry: InstallScriptEntry | null = getInstallScriptEntry(
        InstallScriptName.XcpNgAgent,
      );

      expect(readAgentFile("install.sh")).toContain(
        `INSTALL_DIR="\${INSTALL_DIR:-${XCP_NG_AGENT_INSTALL_DIR}}"`,
      );
      expect(readAgentFile("systemd/oneuptime-xcp-ng-agent.service")).toContain(
        `WorkingDirectory=${XCP_NG_AGENT_INSTALL_DIR}`,
      );
      expect(compose).toContain(`container_name: ${XCP_NG_AGENT_CONTAINER}`);
      expect(compose).toContain(`source: ./${XCP_NG_AGENT_CA_FILE}`);
      expect(markdown).toContain(`\`${XCP_NG_AGENT_INSTALL_DIR}\``);
      expect(markdown).toContain(`docker logs -f ${XCP_NG_AGENT_CONTAINER}`);
      expect(markdown).toContain(
        `curl -fsSL ${DOCS_ONEUPTIME_URL}/install/${InstallScriptName.XcpNgAgent} -o install.sh`,
      );

      for (const match of markdown.matchAll(
        /https:\/\/oneuptime\.com\/install\/xcp-ng-agent\/([A-Za-z0-9._/-]+)/g,
      )) {
        expect({
          file: match[1],
          served: Boolean(
            entry && getInstallScriptFile(entry, match[1] as string),
          ),
        }).toEqual({ file: match[1], served: true });
      }
    });

    it("states the scrape the config ships: Xen Orchestra's path, every 60 seconds, with the Bearer secret", (): void => {
      const config: CollectorConfig = collectorConfig();
      const job: ScrapeJob =
        config.receivers.prometheus.config.scrape_configs[0]!;
      const works: string = section(
        readPage(TELEMETRY_PAGE),
        "## How it works",
      );

      expect(job.metrics_path).toBe(XCP_NG_OPENMETRICS_PATH);
      expect(works).toContain(`\`${job.metrics_path}\``);
      expect(works).toContain(`Every ${spokenSeconds(job.scrape_interval)}`);
      expect(works).toContain("Bearer token");
      expect(readAgentFile("otel-collector-config.yaml")).toContain(
        "type: Bearer",
      );
    });

    it("names the processors it tells people to keep, as the config names them", (): void => {
      const config: CollectorConfig = collectorConfig();
      const pipeline: Array<string> =
        config.service.pipelines.metrics.processors;
      const markdown: string = readPage(TELEMETRY_PAGE);

      expect(pipeline).toContain("transform/xcp-ng-rates");
      expect(pipeline).toContain("resource");
      expect(
        pipeline.some((name: string): boolean => {
          return name.startsWith("groupbyattrs");
        }),
      ).toBe(true);
      expect(markdown).toContain("`transform/xcp-ng-rates`");
      expect(markdown).toContain("`groupbyattrs`");
      expect(markdown).toContain("`resource`");

      // The labels go into the resource processor, next to an attribute it still sets.
      const resource: string = JSON.stringify(config.processors["resource"]);
      expect(resource).toContain('"oneuptime.agent.version"');
      expect(markdown).toContain(
        "to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:",
      );
    });

    it("lists the eight counters that are rates, as the config turns them into gauges", (): void => {
      const rates: string = section(
        readPage(TELEMETRY_PAGE),
        "### The counters that are rates",
      );
      const config: string = readAgentFile("otel-collector-config.yaml");

      for (const series of XCP_NG_RATE_TYPED_AS_COUNTER_SERIES) {
        expect(rates).toContain(`\`${series}\``);
        expect(config).toContain(
          `convert_sum_to_gauge() where metric.name == "${series}"`,
        );
      }
      expect(rates).toContain("eight throughput series");
      expect(XCP_NG_RATE_TYPED_AS_COUNTER_SERIES).toHaveLength(8);
    });

    it("lists the series OneUptime derives, and the attributes it stamps", (): void => {
      const adds: string = section(
        readPage(TELEMETRY_PAGE),
        "### What OneUptime adds",
      );
      const listed: Array<string> = tableRows(adds)
        .map((line: string): string => {
          return cells(line)[0] as string;
        })
        .filter((name: string): boolean => {
          return name.startsWith("`");
        });

      expect(listed).toEqual(
        Object.values(XcpNgDerivedSeries).map((name: string): string => {
          return `\`${name}\``;
        }),
      );
      expect(adds).toContain(`\`${XCP_NG_SCOPE_ATTRIBUTE}\``);
      expect(adds).toContain(`\`${XCP_NG_ID_ATTRIBUTE}\``);
      for (const scope of Object.values(XcpNgScope)) {
        expect(adds).toContain(`\`${scope}\``);
      }
    });

    it("names the pool's identity as the agent stamps it", (): void => {
      const markdown: string = readPage(TELEMETRY_PAGE);
      const config: string = readAgentFile("otel-collector-config.yaml");

      for (const attribute of [
        XCP_NG_POOL_ID_ATTRIBUTE,
        XCP_NG_POOL_NAME_ATTRIBUTE,
        XEN_ORCHESTRA_NAME_ATTRIBUTE,
      ]) {
        expect(markdown).toContain(`\`${attribute}\``);
        expect(config).toContain(attribute);
      }
    });

    it("gives the versions the product needs, and says plainly what has not been tried", (): void => {
      const versions: string = section(
        readPage(TELEMETRY_PAGE),
        "### Supported versions",
      );

      expect(versions).toContain(
        `| Xen Orchestra | ${XCP_NG_MINIMUM_XEN_ORCHESTRA_VERSION} or later, with the OpenMetrics plugin \`xo-server-openmetrics\` 1.9 |`,
      );
      expect(versions).toContain("| XCP-ng | 8.3 LTS |");
      expect(versions).toContain("| XenServer | Not tried yet |");
      expect(readPage(TELEMETRY_PAGE)).toContain(
        `- Xen Orchestra ${XCP_NG_MINIMUM_XEN_ORCHESTRA_VERSION} or later`,
      );
    });

    it("says what the plugin does not cover yet, and where each lands", (): void => {
      const notYet: string = section(
        readPage(TELEMETRY_PAGE),
        "## What the plugin does not cover yet",
      );

      for (const issue of ["10997", "10999", "10996"]) {
        expect(notYet).toContain(
          `(https://github.com/OneUptime/oneuptime/issues/${issue})`,
        );
      }
      for (const gap of [
        "**Alarms**",
        "**HA state**",
        "**pool master**",
        "**missing patches**",
        "**backups**",
        "**snapshots**",
        "**link state**",
      ]) {
        expect(notYet).toContain(gap);
      }
    });

    it("upgrades with the commands the outdated-version sign shows, naming Agent Version where it is drawn", (): void => {
      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const upgrade: string = sectionInLanguage(
          language,
          TELEMETRY_PAGE,
          "## Upgrading the agent",
        );

        expect(upgrade).toContain(
          "```bash\n" +
            getXcpNgAgentUpgradeCommand(DOCS_ONEUPTIME_URL) +
            "\n```",
        );
        expect(upgrade).toContain(
          "```bash\n" +
            getXcpNgAgentDownloadCommand(DOCS_ONEUPTIME_URL) +
            "\n" +
            XCP_NG_AGENT_RECREATE_COMMAND +
            "\n```",
        );
        expect(upgrade).toContain("`INSTALL_DIR=<folder> bash install.sh`");
        for (const label of ["Agent Version", "Overview", "Settings"]) {
          expect({
            language,
            label,
            named: upgrade.includes(
              `**${drawnDashboardLabel(language, label)}**`,
            ),
          }).toEqual({
            language,
            label,
            named: true,
          });
        }
      }
    });

    it("gives the certificate commands the agent's README gives", (): void => {
      const readmeFile: string = path.join(AGENT_DIR, "README.md");
      const certificate: string = section(
        readPage(TELEMETRY_PAGE),
        CERTIFICATE_HEADING,
      );
      const docsCode: string = codeBlocks(certificate).join("\n");

      expect(docsCode).toContain("[http.listen.1]");
      expect(docsCode).toContain("subjectAltName=DNS:");
      expect(certificate).toContain("`systemctl restart xo-server`");

      if (!fs.existsSync(readmeFile)) {
        return;
      }

      const readme: string = section(
        fs.readFileSync(readmeFile, "utf8"),
        "### When Xen Orchestra uses its own self-signed certificate",
      );

      for (const block of codeBlocks(readme)) {
        for (const line of block.split("\n")) {
          expect({ line, inDocs: docsCode.includes(line) }).toEqual({
            line,
            inDocs: true,
          });
        }
      }
    });
  });

  describe("the in-app setup guide", (): void => {
    it("links to docs pages and headings that exist", (): void => {
      for (const method of ["install-script", "docker-compose"] as const) {
        const guide: SetupGuideContent = guideFor(method);
        const text: string = JSON.stringify(guide);

        for (const link of guide.links || []) {
          expect(
            navUrls("Infrastructure Agents")
              .concat(navUrls("Infrastructure Monitors"))
              .includes((link as SetupGuideLink).url),
          ).toBe(true);
        }

        expect(text).toContain(`/docs/${TELEMETRY_PAGE}#${CERTIFICATE_ANCHOR}`);
      }

      expect(
        slugifyMarkdownHeading(CERTIFICATE_HEADING.replace(/^## /, "")),
      ).toBe(CERTIFICATE_ANCHOR);
      expect(anchorsOf(readPage(TELEMETRY_PAGE)).has(CERTIFICATE_ANCHOR)).toBe(
        true,
      );
    });

    it("names the same variables as the docs", (): void => {
      const guide: string = guideTopic(
        guideFor("install-script"),
        "Environment variables",
        "advanced",
      ).markdown;
      const named: Array<string> = Array.from(
        guide.matchAll(/^\| `([A-Z][A-Z0-9_]+)` \|/gm),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect([...named].sort()).toEqual([...documentedVariables()].sort());
    });

    it("names the same certificate errors and their fixes as the docs", (): void => {
      const guide: string = guideTopic(
        guideFor("install-script"),
        "Certificate errors",
        "troubleshooting",
      ).markdown;
      const docs: string = readPage(TELEMETRY_PAGE);

      for (const match of guide.matchAll(/`(x509: [^`]+)`/g)) {
        expect(docs).toContain(`\`${match[1]}\``);
      }
      expect(docs).toContain("`x509: certificate is not valid for any names`");
    });

    it("tells the same Docker Compose story: the variables, the quotes and the certificate file", (): void => {
      const step: string = JSON.stringify(guideFor("docker-compose").steps);
      const quickStart: string = tabPanel(
        readPage(TELEMETRY_PAGE),
        "Docker Compose",
      );

      for (const name of composeVariables()) {
        if (step.includes(`${name}=`)) {
          expect(quickStart).toContain(`\n${name}=`);
        }
      }
      expect(step).toContain(XCP_NG_AGENT_CA_FILE);
      expect(step).toContain("$$");
      expect(quickStart).toContain("`$$`");
    });
  });

  describe("translations", (): void => {
    it("ship both pages in every language", (): void => {
      for (const { language, page } of TRANSLATED_PAGES) {
        expect({
          language,
          page,
          exists: fs.existsSync(pageFile(language, page)),
        }).toEqual({
          language,
          page,
          exists: true,
        });
      }
    });

    it("open with the language's own nav title", (): void => {
      for (const language of TRANSLATED_LANGUAGES) {
        expect(readPage(TELEMETRY_PAGE, language).split("\n")[0]).toBe(
          `# ${navTitle(language, "XCP-ng Agent")}`,
        );
        expect(readPage(MONITOR_PAGE, language).split("\n")[0]).toBe(
          `# ${navTitle(language, "XCP-ng Monitor")}`,
        );
      }
    });

    it("keep the same heading structure, table rows, fences and line count", (): void => {
      const shape: (lines: Array<string>) => Array<string> = (
        lines: Array<string>,
      ): Array<string> => {
        return lines.map((line: string): string => {
          const heading: RegExpMatchArray | null = line.match(/^(#{1,6})\s/);
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

      for (const { language, page } of TRANSLATED_PAGES) {
        const english: Array<string> = readPage(page).split("\n");
        const translated: Array<string> = readPage(page, language).split("\n");

        expect({ language, page, lines: translated.length }).toEqual({
          language,
          page,
          lines: english.length,
        });
        expect({ language, page, shape: shape(translated) }).toEqual({
          language,
          page,
          shape: shape(english),
        });
      }
    });

    it("keep every code block byte-identical, and every diagram's skeleton", (): void => {
      for (const { language, page } of TRANSLATED_PAGES) {
        expect({
          language,
          page,
          blocks: codeBlocks(readPage(page, language), {
            diagramsBySkeleton: true,
          }),
        }).toEqual({
          language,
          page,
          blocks: codeBlocks(readPage(page), { diagramsBySkeleton: true }),
        });
      }
    });

    it("keep every backticked identifier, in order", (): void => {
      for (const { language, page } of TRANSLATED_PAGES) {
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
    });

    it("keep every alert template name in English, as the picker shows it", (): void => {
      for (const language of TRANSLATED_LANGUAGES) {
        const markdown: string = readPage(MONITOR_PAGE, language);

        for (const template of getAllXcpNgAlertTemplates()) {
          expect({
            language,
            template: template.id,
            row: markdown.includes(`\n| ${template.name} |`),
          }).toEqual({ language, template: template.id, row: true });
        }
      }
    });

    it("answer the certificate section's English anchor, which the in-app guide links to", (): void => {
      for (const language of TRANSLATED_LANGUAGES) {
        const aliases: Array<DocsAnchorAlias> = getEnglishAnchorAliases(
          readPage(TELEMETRY_PAGE),
          readPage(TELEMETRY_PAGE, language),
        );

        expect({
          language,
          answers: aliases.some((alias: DocsAnchorAlias): boolean => {
            return alias.englishAnchor === CERTIFICATE_ANCHOR;
          }),
        }).toEqual({ language, answers: true });
      }
    });

    it("are translated, not copied: almost every line of prose differs from the English", (): void => {
      for (const { language, page } of TRANSLATED_PAGES) {
        const english: Array<string> = readPage(page).split("\n");
        const translated: Array<string> = readPage(page, language).split("\n");
        let inFence: boolean = false;
        let prose: number = 0;
        let copied: number = 0;

        english.forEach((line: string, index: number): void => {
          if (FENCE_LINE.test(line)) {
            inFence = !inFence;
            return;
          }
          const words: string = line
            .replace(/`[^`]*`/g, "")
            .replace(/\]\([^)]*\)/g, "");
          if (inFence || !PROSE_LINE.test(words)) {
            return;
          }
          prose++;
          if (translated[index] === line) {
            copied++;
          }
        });

        expect({ language, page, copiedShare: copied / prose < 0.05 }).toEqual({
          language,
          page,
          copiedShare: true,
        });
      }
    });

    it("name the Dashboard as each language's Dashboard draws it, wherever its locale words a label", (): void => {
      for (const { language, page } of TRANSLATED_PAGES) {
        const english: Array<string> = readPage(page).split("\n");
        const translated: Array<string> = readPage(page, language).split("\n");

        english.forEach((line: string, index: number): void => {
          for (const label of boldLabelsOf(line)) {
            if (!QUOTED_LABELS.includes(label)) {
              continue;
            }
            const drawn: string | null = lookedUpLabel(language, label);
            if (drawn === null) {
              continue;
            }
            expect({
              language,
              page,
              line: index + 1,
              label,
              drawn: translated[index]!.includes(drawn),
            }).toEqual({ language, page, line: index + 1, label, drawn: true });
          }
        });
      }
    });
  });
});
