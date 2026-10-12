/*
 * Docs overhaul task 25a: what the RUM Overview, Browser Setup, Mobile Setup
 * and Core Web Vitals pages say about OneUptime, held to the code that does
 * it. Where a page shows an example - a resource, an attribute list, a route
 * pattern, a key's origins - the example is run through the product code it
 * describes: the ingest classifier, the label promotion, the origin
 * allowlist, the web vital definitions and the recommendation templates.
 * RumDocsTranslations holds the translations to these English pages.
 *
 * App tests read no React module, so the Dashboard's words are read from its
 * source files as text; Common's types and the ingest service are imported.
 * What the OpenTelemetry SDKs themselves do is the SDKs' and is not in this
 * repository; where their telemetry meets OneUptime's code - an attribute
 * OneUptime reads, a header, a route - it is held here.
 */

/*
 * The ingest service's module graph reaches the queue and the password hash
 * helper. Replaced with factories, as HostResourceNotMistakenForRum does:
 * the classifier under test touches neither.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  RUM_BROWSER_PACKAGES,
  RUM_BROWSER_SETUP_DOCS_URL,
  RUM_MOBILE_SETUP_DOCS_URL,
  RUM_WEB_VITALS_DOCS_URL,
  getRumIngestionKeyType,
  getRumMobileResourceAttributes,
} from "../../../FeatureSet/Dashboard/src/Components/Rum/RumSetupGuide";
import OtelIngestBaseService from "../../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import { DocsFence, readPage, scanMarkdown } from "./DocsContentSupport";
import { stepCount, tables } from "./DocsPageShape";
import { escapeRegExp } from "./DocsTranslationChecks";
import { sectionInLanguage } from "./NetworkDocsLabels";
import {
  APPLICATION_SIDE_MENU,
  BROWSER_SETUP,
  MOBILE_SETUP,
  RUM_INDEX,
  RUM_SETUP_PAGES,
  RumDocsPageEntry,
  WEB_VITALS,
  WEB_VITAL_RATING_LABELS,
  WEB_VITAL_RECOMMENDATION_NAMES,
} from "./RumDocsPages";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import { FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import {
  RumAlertTemplate,
  getAllRumAlertTemplates,
} from "Common/Types/Monitor/RumAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import {
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SESSION_REPLAY_MAX_SESSION_MS,
} from "Common/Types/Rum/SessionReplay";
import {
  WebVitalDefinition,
  WebVitalDefinitions,
  WebVitalRouteAttributeKeys,
} from "Common/Types/Rum/WebVitals";
import { DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE } from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
} from "Common/Types/Telemetry/TelemetryIngestSurface";
import { SessionRotationReason } from "Common/Utils/Rum/SessionIdentity";
import OriginAllowList from "Common/Utils/Telemetry/OriginAllowList";
import { extractOneuptimeLabelNames } from "Common/Server/Utils/Telemetry/OneuptimeLabel";
import { ExpressRequest } from "Common/Server/Utils/Express";
import { describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const SOURCES: Record<string, string> = {
  navigationItems: `${DASHBOARD}/Utils/NavigationItems.tsx`,
  rumSideMenu: `${DASHBOARD}/Pages/Rum/SideMenu.tsx`,
  applicationSideMenu: `${DASHBOARD}/Pages/Rum/View/SideMenu.tsx`,
  developerDocsPages: `${DASHBOARD}/Components/DeveloperDocs/DeveloperDocsPages.ts`,
  rumApplications: `${DASHBOARD}/Pages/Rum/RumApplications.tsx`,
  overview: `${DASHBOARD}/Pages/Rum/View/Overview.tsx`,
  overviewHelpers: `${DASHBOARD}/Pages/Rum/View/OverviewHelpers.ts`,
  settingsSideMenu: `${DASHBOARD}/Pages/Settings/SideMenu.tsx`,
  ingestionKeyForm: `${DASHBOARD}/Components/Telemetry/IngestionKeyForm.ts`,
  ingestionKeyView: `${DASHBOARD}/Pages/Settings/TelemetryIngestionKeyView.tsx`,
  replayCard: `${DASHBOARD}/Components/SessionReplay/ReplayCard.tsx`,
  replayUrlState: `${DASHBOARD}/Components/SessionReplay/ReplayPlayerUrlState.ts`,
  webVitalsCard: `${DASHBOARD}/Components/TelemetryResource/WebVitalsCard.tsx`,
  routeBreakdownCard: `${DASHBOARD}/Components/TelemetryResource/WebVitalRouteBreakdownCard.tsx`,
  telemetryMetrics: `${DASHBOARD}/Components/TelemetryResource/telemetryMetrics.ts`,
  metricQuery: `${DASHBOARD}/Components/Metrics/MetricQuery.tsx`,
  englishLocale: `${DASHBOARD}/Locales/en.json`,
  sideMenuSectionState:
    "packages/Common/UI/Components/SideMenu/SideMenuSectionState.ts",
  rumApplicationService:
    "packages/Common/Server/Services/RumApplicationService.ts",
  ingestMiddleware: "packages/Common/Server/Middleware/TelemetryIngest.ts",
  corsOptions: "packages/Common/Server/Utils/CorsOptions.ts",
  startServer: "packages/Common/Server/Utils/StartServer.ts",
  otelIngest: "packages/App/FeatureSet/Telemetry/API/OTelIngest.ts",
  otelRequestMiddleware:
    "packages/App/FeatureSet/Telemetry/Middleware/OtelRequestMiddleware.ts",
  otelIngestBase:
    "packages/App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts",
  performanceRecorder:
    "packages/App/FeatureSet/BrowserRecorder/src/PerformanceRecorder.ts",
  mobileRecorderPackage: "packages/App/FeatureSet/MobileRecorder/package.json",
};

const INLINE_CODE: RegExp = /`([^`]+)`/g;
const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
// A side menu's section or a link's title: `title="Basic"` or `title: "Overview"`.
const MENU_TITLE: RegExp = /<SideMenuSection title="([^"]+)">|title: "([^"]+)"/g;
// The Developer section, added to a view menu by a helper.
const DEVELOPER_SECTION_CALL: string = "getDeveloperSideMenuSection(";
// A Developer page's title in DeveloperDocsPages.ts.
const DEVELOPER_PAGE_TITLE: RegExp = /title: "([^"]+)"/g;
// A Dashboard field, column, tile or menu title.
const TITLE: RegExp = /title(?:: |=)"([^"]+)"/g;
// The values a list of OpenTelemetry resource attributes sets in a TS sample.
const RESOURCE_ATTRIBUTE: RegExp = /^\s*"([a-z_.]+)":/gm;
// An npm package a TS sample imports.
const IMPORT_FROM: RegExp = /from "(@opentelemetry\/[^"]+)"/g;
// A package an `npm install` command installs.
const NPM_PACKAGE: RegExp = /@opentelemetry\/[a-z0-9-]+/g;
// The bucket edges of one histogram: `createHistogram("web_vital.lcp", ... buckets(0, 1000, ...)`.
const HISTOGRAM_BUCKETS: RegExp =
  /createHistogram\("(web_vital\.[a-z]+)",[^\n]*?buckets\(([^)]*)\)/g;
// The regular expression of the page's toRoutePattern.
const ROUTE_PATTERN_LITERAL: RegExp = /path\.replace\(\/(.+)\/gi, "\/:id"\)/;
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;

function source(name: string): string {
  return fs.readFileSync(path.join(REPO_DIR, SOURCES[name] as string), "utf8");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

function section(page: string, heading: string): string {
  return sectionInLanguage("en", page, heading);
}

function allMatches(
  text: string,
  pattern: RegExp,
  group: number,
): Array<string> {
  return Array.from(text.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[group] as string;
    },
  );
}

function inlineCodeOf(text: string): Array<string> {
  return allMatches(text, INLINE_CODE, 1);
}

function boldOf(text: string): Array<string> {
  return allMatches(text, BOLD, 1);
}

function fencesOf(page: string, language: string): Array<DocsFence> {
  return scanMarkdown(englishPage(page)).fences.filter(
    (fence: DocsFence): boolean => {
      return fence.lang === language;
    },
  );
}

// The one fence of a page whose code holds this text.
function fenceHolding(page: string, text: string): DocsFence {
  const found: Array<DocsFence> = scanMarkdown(englishPage(page)).fences.filter(
    (fence: DocsFence): boolean => {
      return fence.code.includes(text);
    },
  );

  expect({ text, fences: found.length }).toEqual({ text, fences: 1 });

  return found[0] as DocsFence;
}

// The lines of a section that start with one of these prefixes.
function linesStartingWith(text: string, prefix: string): Array<string> {
  return text.split("\n").filter((line: string): boolean => {
    return line.startsWith(prefix);
  });
}

// A table row of a section's tables, found by its first cell.
function rowOf(text: string, firstCell: string): Array<string> {
  for (const table of tables(text)) {
    for (const row of table) {
      if (row[0] === firstCell) {
        return row;
      }
    }
  }

  throw new Error(`No table row starts with ${firstCell}`);
}

// A string constant's value in a source file: `NAME: string = "value"`.
function stringConstant(text: string, name: string): string {
  const match: RegExpMatchArray | null = text.match(
    new RegExp(`${escapeRegExp(name)}: string =\\s*"([^"]+)"`),
  );

  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

  return (match as RegExpMatchArray)[1] as string;
}

// A number constant's value in a source file: `NAME: number = 1000`.
function numberConstant(text: string, name: string): number {
  const match: RegExpMatchArray | null = text.match(
    new RegExp(`${escapeRegExp(name)}: number =\\s*([\\d_]+)`),
  );

  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

  return Number(((match as RegExpMatchArray)[1] as string).split("_").join(""));
}

/*
 * The side menu sections and their links, in order, from a menu written as
 * <SideMenuSection title> elements with link titles inside them.
 */
function menuSections(
  text: string,
  developerItems: Array<string>,
): Array<{ section: string; items: Array<string> }> {
  const sections: Array<{ section: string; items: Array<string> }> = [];
  const developerAt: number = text.indexOf(DEVELOPER_SECTION_CALL);
  let developerAdded: boolean = false;

  for (const match of Array.from(text.matchAll(MENU_TITLE))) {
    if (!developerAdded && developerAt >= 0 && (match.index || 0) > developerAt) {
      sections.push({ section: "Developer", items: developerItems });
      developerAdded = true;
    }

    if (match[1]) {
      sections.push({ section: match[1], items: [] });
    } else if (match[2] && sections.length > 0) {
      (sections[sections.length - 1] as { items: Array<string> }).items.push(
        match[2],
      );
    }
  }

  return sections;
}

/* -------------------------------------------------- Ingest classifier */

// getRumClientType and getServiceNameFromAttributes are protected statics.
const ingest: Record<string, any> = OtelIngestBaseService as unknown as Record<
  string,
  any
>;

function attribute(key: string, value: string): JSONObject {
  if (key === "browser.brands") {
    return {
      key: key,
      value: { arrayValue: { values: [{ stringValue: value }] } },
    };
  }

  return { key: key, value: { stringValue: value } };
}

function resource(pairs: Record<string, string>): JSONArray {
  return Object.entries(pairs).map(([key, value]: [string, string]) => {
    return attribute(key, value);
  }) as JSONArray;
}

function classify(pairs: Record<string, string>): string | null {
  return ingest["getRumClientType"](resource(pairs)) as string | null;
}

/*
 * The attributes an OTEL_RESOURCE_ATTRIBUTES value sets, decoded the way the
 * OpenTelemetry SDKs decode it.
 */
function resourceAttributesValue(value: string): Record<string, string> {
  const pairs: Record<string, string> = {};

  for (const pair of value.split(",")) {
    const separator: number = pair.indexOf("=");
    pairs[decodeURIComponent(pair.slice(0, separator))] = decodeURIComponent(
      pair.slice(separator + 1),
    );
  }

  return pairs;
}

const OTEL_RESOURCE_ATTRIBUTES_LINE: RegExp =
  /^OTEL_RESOURCE_ATTRIBUTES="([^"]+)"$/m;

describe("the RUM setup pages in the docs' nav", () => {
  const group: NavGroup | undefined = DocsNav.find((candidate: NavGroup) => {
    return candidate.title === "Real User Monitoring";
  });

  it("open the Real User Monitoring group, in this order", () => {
    expect(group).toBeDefined();
    expect(
      (group as NavGroup).links.slice(0, RUM_SETUP_PAGES.length).map(
        (link: NavLink): { page: string; navTitle: string } => {
          return {
            page: link.url.slice("/docs/".length),
            navTitle: link.title,
          };
        },
      ),
    ).toEqual(
      RUM_SETUP_PAGES.map((entry: RumDocsPageEntry) => {
        return { page: entry.page, navTitle: entry.navTitle };
      }),
    );
  });

  it.each(RUM_SETUP_PAGES)(
    "$page is titled as its nav link",
    (entry: RumDocsPageEntry) => {
      expect(englishPage(entry.page).split("\n")[0]).toBe(
        `# ${entry.navTitle}`,
      );
    },
  );

  it("are the pages the Dashboard's RUM setup guide links to", () => {
    expect(RUM_BROWSER_SETUP_DOCS_URL).toBe(`/docs/${BROWSER_SETUP}`);
    expect(RUM_MOBILE_SETUP_DOCS_URL).toBe(`/docs/${MOBILE_SETUP}`);
    expect(RUM_WEB_VITALS_DOCS_URL).toBe(`/docs/${WEB_VITALS}`);
  });
});

describe("RUM Overview: where RUM lives in the Dashboard", () => {
  const where: string = section(RUM_INDEX, "## Where to find it");

  it("opens Real User Monitoring from the Products menu's Resources group", () => {
    const locale: {
      navbar: {
        items: Record<string, string>;
        categories: Record<string, string>;
      };
    } = JSON.parse(source("englishLocale"));
    const menu: string = source("navigationItems");
    const item: string = menu.slice(
      menu.indexOf('title: t("navbar.items.rumTitle")'),
    );

    expect(item.slice(0, item.indexOf("category:") + 40)).toContain(
      "category: resourcesCategory",
    );
    expect(menu).toContain(
      'const resourcesCategory: string = t("navbar.categories.resources");',
    );
    expect(locale.navbar.items["rumTitle"]).toBe("Real User Monitoring");
    expect(locale.navbar.categories["resources"]).toBe("Resources");

    for (const page of [RUM_INDEX, BROWSER_SETUP, MOBILE_SETUP]) {
      expect(englishPage(page)).toContain(
        "**Products → Resources → Real User Monitoring**",
      );
    }
  });

  it("names the product menu's sections and links, and which start folded", () => {
    const menu: string = source("rumSideMenu");
    const titles: Array<string> = allMatches(menu, TITLE, 1);
    const folded: string = source("sideMenuSectionState");

    expect(titles).toEqual([
      "Real User Monitoring",
      "All Applications",
      "Settings",
      "Owner Rules",
      "Label Rules",
      "Session Replay",
      "Advanced",
      "Archived",
    ]);

    expect(where).toContain("**All Applications**");
    expect(linesStartingWith(where, "- **Settings**:")).toEqual([
      "- **Settings**: **Owner Rules**, **Label Rules** and the project-wide **Session Replay** switch.",
    ]);
    expect(linesStartingWith(where, "- **Advanced**:")).toEqual([
      "- **Advanced**: **Archived**, the applications you archived.",
    ]);

    for (const title of ["Settings", "Advanced", "Developer"]) {
      expect(folded).toContain(`"${title}",`);
    }

    for (const title of ["Basic", "Observability", "Session Replay"]) {
      expect(folded).not.toContain(`  "${title}",`);
    }
  });

  it("lists the All Applications columns the page names", () => {
    const list: string = source("rumApplications");
    const columns: Array<string> = allMatches(list, TITLE, 1);

    for (const column of ["Client Type", "Status", "Last Seen"]) {
      expect(columns).toContain(column);
      expect(where).toContain(`**${column}**`);
    }
  });

  it("lays out an application's side menu as its table does", () => {
    const developerItems: Array<string> = allMatches(
      source("developerDocsPages"),
      DEVELOPER_PAGE_TITLE,
      1,
    );

    expect(developerItems).toEqual(["Terraform", "API", "AI Assistants"]);

    const sections: Array<{ section: string; items: Array<string> }> =
      menuSections(source("applicationSideMenu"), developerItems);

    expect(sections).toEqual(
      APPLICATION_SIDE_MENU.map(
        (entry: { section: string; items: ReadonlyArray<string> }) => {
          return { section: entry.section, items: [...entry.items] };
        },
      ),
    );

    for (const entry of APPLICATION_SIDE_MENU) {
      expect(rowOf(where, `**${entry.section}**`)).toEqual([
        `**${entry.section}**`,
        entry.items
          .map((item: string): string => {
            return `**${item}**`;
          })
          .join(", "),
      ]);
    }

    expect(where).toContain(
      "**Settings**, **Developer** and **Advanced** start folded",
    );
  });
});

describe("RUM Overview: how OneUptime recognises RUM", () => {
  const recognises: string = section(
    RUM_INDEX,
    "## How OneUptime recognises RUM",
  );
  const rules: Array<string> = recognises
    .split("\n")
    .filter((line: string): boolean => {
      return /^\d\. /.test(line);
    });

  it("states four rules, in the classifier's order", () => {
    expect(rules).toHaveLength(4);
  });

  it("files a batch with any one of rule 1's browser attributes as browser RUM", () => {
    const attributes: Array<string> = inlineCodeOf(rules[0] as string);

    expect(attributes).toEqual([
      "browser.platform",
      "browser.language",
      "browser.brands",
    ]);

    for (const key of attributes) {
      expect({
        key,
        type: classify({ "service.name": "storefront-web", [key]: "x" }),
      }).toEqual({ key, type: "browser" });
    }

    // "a non-empty browser.brands": an empty list is no signal.
    expect(
      ingest["getRumClientType"]([
        { key: "browser.brands", value: { arrayValue: { values: [] } } },
      ]),
    ).toBeNull();
  });

  it("files a batch with rule 2's device attributes as mobile RUM", () => {
    const attributes: Array<string> = inlineCodeOf(rules[1] as string);

    expect(attributes).toEqual(["device.id", "device.model.identifier"]);

    for (const key of attributes) {
      expect({
        key,
        type: classify({ "service.name": "storefront-mobile", [key]: "x" }),
      }).toEqual({ key, type: "mobile" });
    }
  });

  it("files device.manufacturer as mobile only without any of rule 3's host identities", () => {
    const [manufacturer, ...hostIdentity]: Array<string> = inlineCodeOf(
      rules[2] as string,
    );

    expect(manufacturer).toBe("device.manufacturer");
    expect(hostIdentity).toEqual(["host.name", "host.id", "k8s.node.name"]);
    expect(classify({ "device.manufacturer": "Samsung" })).toBe("mobile");

    for (const key of hostIdentity) {
      expect({
        key,
        type: classify({ "device.manufacturer": "Dell Inc.", [key]: "x" }),
      }).toEqual({ key, type: null });
    }
  });

  it("files everything else as a backend service, never twice", async () => {
    expect(classify({ "service.name": "checkout" })).toBeNull();

    // A RUM batch names no backend service, so none is created for it.
    await expect(
      ingest["getServiceNameFromAttributes"](
        { headers: {} } as unknown as ExpressRequest,
        resource({
          "service.name": "storefront-web",
          "browser.language": "en-US",
        }),
      ),
    ).resolves.toBeNull();
  });

  it("lists, in the attribute table, the attributes the rules name", () => {
    const firstColumn: Array<string> = (tables(recognises)[0] || [])
      .slice(1)
      .flatMap((row: Array<string>): Array<string> => {
        return inlineCodeOf(row[0] as string);
      });

    expect(firstColumn).toEqual([
      "service.name",
      "browser.platform",
      "browser.language",
      "browser.brands",
      "device.id",
      "device.model.identifier",
      "device.manufacturer",
      "telemetry.sdk.language",
      "telemetry.sdk.version",
      "oneuptime.label.<name>",
    ]);
    expect(rowOf(recognises, "`service.name`")[1]).toBe("**Yes**");
  });

  it("reads the SDK version from telemetry.sdk.version, then oneuptime.agent.version", () => {
    const base: string = source("otelIngestBase");

    expect(base).toContain(
      'this.getStringAttribute(data.attributes, "telemetry.sdk.version") ||\n            this.getStringAttribute(data.attributes, "oneuptime.agent.version");',
    );
    expect(rowOf(recognises, "`telemetry.sdk.version`")[2]).toContain(
      "`oneuptime.agent.version` is read when it is missing",
    );
  });

  it("fills the Clients page from browser.platform, then device.model.identifier", () => {
    const base: string = source("otelIngestBase");

    expect(base).toContain(
      'const clientName: string | null =\n          this.getStringAttribute(data.attributes, "browser.platform") ||\n          this.getStringAttribute(data.attributes, "device.model.identifier");',
    );
    expect(rowOf(recognises, "`browser.platform`, `browser.language`, `browser.brands`")[2]).toContain(
      "`browser.platform` also fills the **Clients** page",
    );
    expect(rowOf(recognises, "`device.id`, `device.model.identifier`")[2]).toContain(
      "`device.model.identifier` also fills the **Clients** page",
    );
  });

  it("promotes oneuptime.label.<name> to the label <name>:<value>", () => {
    expect(
      extractOneuptimeLabelNames(
        resource({ "oneuptime.label.env": "production" }),
      ),
    ).toEqual(["env:production"]);
    expect(rowOf(recognises, "`oneuptime.label.<name>`")[2]).toContain(
      "`<name>:<value>`",
    );
  });

  it("matches the application by service.name, ignoring case", () => {
    const service: string = source("rumApplicationService");

    expect(service).toContain(
      "appIdentifier: QueryHelper.findWithSameText(data.appIdentifier)",
    );
    expect(recognises).toContain("by `service.name`, ignoring case");
  });
});

describe("RUM Overview: what you get", () => {
  const what: string = section(RUM_INDEX, "## What you get");

  it("names the overview's tiles, in the order the page draws them", () => {
    const overview: string = source("overview");
    const tilesSource: string = overview.slice(
      overview.indexOf("const tiles: Array<ResourceOverviewTile> = ["),
      overview.indexOf("const syncId"),
    );
    const tiles: Array<string> = allMatches(tilesSource, TITLE, 1);

    expect(tiles).toEqual([
      "Page loads",
      "Page load time (p95)",
      "Events",
      "Error rate",
      "Event duration (p95)",
      "Exceptions",
      "Clients",
      "Sessions recorded",
    ]);
    expect(boldOf(rowOf(what, "**Overview**")[1] as string)).toEqual(tiles);
  });

  it("counts page loads from the documentLoad span", () => {
    expect(
      stringConstant(source("overviewHelpers"), "PAGE_LOAD_SPAN_NAME"),
    ).toBe("documentLoad");
    expect(what).toContain("counts the `documentLoad` span");
  });

  it("names the Core Web Vitals card, and the recommendations it offers", () => {
    expect(source("webVitalsCard")).toContain('label="Core Web Vitals"');

    const ids: Array<string> = getAllRumAlertTemplates().map(
      (template: RumAlertTemplate): string => {
        return template.id;
      },
    );

    for (const id of [
      "rum-poor-inp",
      "rum-failed-user-operations",
      "rum-unhandled-exceptions",
      "rum-session-replay-daily-budget-spent",
    ]) {
      expect(ids).toContain(id);
    }

    expect(rowOf(what, "**Recommendations**")[1]).toBe(
      "Ready-made monitors for the application: poor Core Web Vitals, failed requests, browser exceptions and, once it records, Session Replay budgets.",
    );
  });

  it("turns Disconnected after 15 minutes of silence, counted only while OneUptime was receiving", () => {
    const service: string = source("rumApplicationService");
    const list: string = source("rumApplications");

    expect(service).toContain(
      "await ReceivingCoverage.getSilenceCutoff({\n      silenceInMinutes: 15,\n    });",
    );
    expect(list).toContain('text={isConnected ? "Connected" : "Disconnected"}');
    expect(what).toContain(
      "An application shows **Connected** while telemetry arrives and **Disconnected** after 15 minutes without any.",
    );

    for (const page of [MOBILE_SETUP]) {
      expect(englishPage(page)).toContain(
        "**Disconnected** after 15 minutes without telemetry",
      );
    }
  });
});

describe("Ingestion keys: a Browser key for the web, a Server key for mobile", () => {
  it("draws the key's create form and page with the labels the pages name", () => {
    const form: string = source("ingestionKeyForm");
    const view: string = source("ingestionKeyView");
    const settings: string = source("settingsSideMenu");
    const browser: string = englishPage(BROWSER_SETUP);

    for (const title of [
      "Key Type",
      "Browser",
      "Server",
      "Browser Settings",
      "Allowed Origins",
      "Pinned Service Name",
      "Billing",
    ]) {
      expect({ title, form: form.includes(`title: "${title}"`) }).toEqual({
        title,
        form: true,
      });
    }

    for (const title of [
      "Requests Per Minute Limit",
      "Expires At",
      "Enabled",
      "Secret Key",
      "Pinned Service Name",
      "Allowed Origins",
    ]) {
      expect({ title, view: view.includes(`title: "${title}"`) }).toEqual({
        title,
        view: true,
      });
      expect(browser).toContain(`**${title}**`);
    }

    expect(form).toContain(
      "The key type cannot be changed after creation.",
    );
    expect(browser).toContain(
      "The key type cannot be changed after the key is created.",
    );

    // "open Telemetry & APM": a section that starts folded.
    expect(settings).toContain(
      'title: "Telemetry & APM",\n      defaultCollapsed: true,',
    );
    expect(settings).toContain('title: "Ingestion Keys"');
  });

  it("puts the Billing step only on the Free plan, as the browser page says", () => {
    const form: string = source("ingestionKeyForm");

    expect(form).toContain('{ id: "billing", title: "Billing" }');
    expect(form).toContain("Billing, on the Free plan only");
    expect(englishPage(BROWSER_SETUP)).toContain(
      "On OneUptime Cloud's Free plan, a last **Billing** step shows the telemetry price first.",
    );
  });

  it("gives a web app a Browser key and a mobile app a Server key", () => {
    expect(getRumIngestionKeyType("browser")).toBe(
      TelemetryIngestionKeyType.Browser,
    );
    expect(getRumIngestionKeyType("mobile")).toBe(
      TelemetryIngestionKeyType.Server,
    );

    const getStarted: string = section(RUM_INDEX, "## Get started");

    expect(getStarted).toContain("A web app needs a **Browser** key");
    expect(getStarted).toContain(
      "A mobile app needs a **Server** key, because a mobile SDK sends no `Origin` header.",
    );
  });

  it("lets a Browser key write only OTLP traces, logs, metrics and session replays", () => {
    expect([...BROWSER_ALLOWED_INGEST_SURFACES].sort()).toEqual(
      [
        TelemetryIngestSurface.OtelTraces,
        TelemetryIngestSurface.OtelLogs,
        TelemetryIngestSurface.OtelMetrics,
        TelemetryIngestSurface.SessionReplay,
      ].sort(),
    );
    expect(englishPage(BROWSER_SETUP)).toContain(
      "A Browser key writes OTLP traces, logs and metrics, and session replays; every other ingest route refuses it.",
    );
  });

  it("holds a Browser key to 6000 requests a minute unless the key sets its own", () => {
    const allows: string = section(BROWSER_SETUP, "## What a Browser key allows");
    const row: Array<string> = rowOf(allows, "**Requests Per Minute Limit**");

    expect(DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE).toBe(6000);
    expect(row[1]).toContain(
      `${DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE} requests per minute unless you set your own`,
    );
  });

  it("matches a *. origin the way the Allowed Origins row says", () => {
    const allows: string = section(BROWSER_SETUP, "## What a Browser key allows");

    expect(rowOf(allows, "**Allowed Origins**")[1]).toContain(
      "`https://*.example.com` covers every subdomain of `example.com`, but not `example.com` itself.",
    );

    const allowed: Array<string> = ["https://*.example.com"];

    expect(OriginAllowList.matches("https://app.example.com", allowed)).toBe(
      true,
    );
    expect(
      OriginAllowList.matches("https://eu.app.example.com", allowed),
    ).toBe(true);
    expect(OriginAllowList.matches("https://example.com", allowed)).toBe(
      false,
    );
    expect(OriginAllowList.matches("https://evilexample.com", allowed)).toBe(
      false,
    );
    // Each origin keeps its scheme.
    expect(OriginAllowList.matches("http://app.example.com", allowed)).toBe(
      false,
    );
  });

  it("quotes the refusals word for word, with the statuses they come with", () => {
    const middleware: string = source("ingestMiddleware");
    const browser: string = section(BROWSER_SETUP, "## Troubleshooting");
    const mobile: string = section(MOBILE_SETUP, "## Troubleshooting");

    expect(ExceptionCode.NotAuthorizedException).toBe(422);
    expect(ExceptionCode.NotAuthenticatedException).toBe(401);

    expect(middleware).toContain(
      "return `Origin ${origin} is not allowed for this browser ingestion key.`;",
    );
    expect(browser).toContain(
      "- `422` with `Origin https://app.example.com is not allowed for this browser ingestion key.`",
    );

    expect(middleware).toContain(
      '"This telemetry ingestion key has been disabled."',
    );
    expect(browser).toContain(
      "- `422` with `This telemetry ingestion key has been disabled.`",
    );

    const noOrigin: string =
      "This request did not send an Origin header, so it cannot be checked against the allowed origins of this browser ingestion key. Use a server ingestion key for requests that are not sent by a browser.";

    expect(middleware).toContain(noOrigin);
    expect(mobile).toContain(`a \`422\` that reads \`${noOrigin}\``);
  });

  it("checks a key with GET /otlp/v1/validate, as the pages show it", () => {
    const routes: string = source("otelIngest");

    expect(routes).toContain('router.get(\n  "/otlp/v1/validate",');
    expect(routes).toContain("valid: true,");
    expect(routes).toContain("{ statusCode: new StatusCode(401) }");
    expect(routes).toContain(
      "It is accepted only from a browser, only from one of its allowed origins",
    );

    const check: string = [
      "curl -i https://oneuptime.com/otlp/v1/validate \\",
      '  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"',
    ].join("\n");

    expect(fenceHolding(BROWSER_SETUP, "/otlp/v1/validate").code).toBe(check);
    expect(fenceHolding(MOBILE_SETUP, "/otlp/v1/validate").code).toBe(check);
  });
});

describe("Browser Setup: the SDK setup", () => {
  const browser: string = englishPage(BROWSER_SETUP);
  const telemetry: DocsFence = fenceHolding(
    BROWSER_SETUP,
    "const provider = new WebTracerProvider({\n  resource: resource,\n  spanProcessors: [\n    new BatchSpanProcessor(",
  );

  it("installs every package src/telemetry.ts imports, and the Dashboard guide's list", () => {
    const install: DocsFence = fenceHolding(
      BROWSER_SETUP,
      "npm install @opentelemetry/api \\\n  @opentelemetry/sdk-trace-web",
    );
    const installed: Array<string> = allMatches(install.code, NPM_PACKAGE, 0);
    const imported: Array<string> = allMatches(telemetry.code, IMPORT_FROM, 1);

    expect(telemetry.info).toBe('ts title="src/telemetry.ts"');

    for (const name of imported) {
      expect({ name, installed: installed.includes(name) }).toEqual({
        name,
        installed: true,
      });
    }

    for (const name of RUM_BROWSER_PACKAGES) {
      expect({ name, installed: installed.includes(name) }).toEqual({
        name,
        installed: true,
      });
    }
  });

  it("exports to /otlp/v1/traces with the x-oneuptime-token header", () => {
    expect(source("otelIngest")).toContain('"/otlp/v1/traces",');
    expect(telemetry.code).toContain("url: `${ONEUPTIME_URL}/otlp/v1/traces`,");
    expect(telemetry.code).toContain(
      'headers: { "x-oneuptime-token": ONEUPTIME_TOKEN },',
    );
  });

  it("has six steps in Set it up, as its card says", () => {
    expect(stepCount(section(BROWSER_SETUP, "## Set it up"))).toBe(6);
    expect(browser).toContain(
      "- [Set it up](#set-it-up): Six steps from a Browser key to your first page load.",
    );
  });

  it("marks the hand-built resource as browser RUM with the attributes its comment names", () => {
    const manual: DocsFence = fenceHolding(
      BROWSER_SETUP,
      "browser.language or browser.platform marks the telemetry as browser RUM.",
    );
    const keys: Array<string> = allMatches(manual.code, RESOURCE_ATTRIBUTE, 1);

    expect(keys).toEqual([
      "browser.language",
      "browser.platform",
      "browser.mobile",
      "user_agent.original",
    ]);
    expect(classify({ "service.name": "storefront-web", "browser.language": "en" })).toBe("browser");
    expect(classify({ "service.name": "storefront-web", "browser.platform": "macOS" })).toBe("browser");
    // Why the comment names two of the four: the others mark nothing.
    expect(classify({ "browser.mobile": "false" })).toBeNull();
    expect(classify({ "user_agent.original": "Mozilla/5.0" })).toBeNull();
  });

  it("names the session replay rotations the recorder makes", () => {
    const join: string = section(
      BROWSER_SETUP,
      "## Joining traces to session replay",
    );

    expect(SESSION_REPLAY_IDLE_ROLLOVER_MS).toBe(30 * 60 * 1000);
    expect(SESSION_REPLAY_MAX_SESSION_MS).toBe(4 * 60 * 60 * 1000);
    expect(SessionRotationReason.IdentityChange).toBe("identity-change");
    expect(join).toContain(
      "when the visitor comes back after 30 minutes idle, at the 4-hour cap, when `identify()` names a different user, or when another tab of the same visitor changed it first.",
    );
  });

  it("opens the replay ten seconds before an exception, from the card it names", () => {
    expect(source("replayCard")).toContain("Watch what the user saw");
    expect(source("replayUrlState")).toContain(
      "export const REPLAY_EXCEPTION_PRE_ROLL_MS: number = 10 * 1000;",
    );
    expect(section(BROWSER_SETUP, "## Report uncaught errors")).toContain(
      "**Watch what the user saw** card, which opens the replay ten seconds before the error.",
    );
  });

  it("states the endpoints the OTLP router serves, in both encodings, to any origin", () => {
    const reference: string = section(BROWSER_SETUP, "## Endpoint reference");
    const routes: string = source("otelIngest");

    for (const signal of ["traces", "metrics", "logs"]) {
      expect(routes).toContain(`"/otlp/v1/${signal}",`);
      expect(reference).toContain(`\`POST {host}/otlp/v1/${signal}\``);
    }

    const middleware: string = source("otelRequestMiddleware");

    expect(middleware).toContain('contentType.includes("application/x-protobuf")');
    expect(reference).toContain("OneUptime accepts OTLP/JSON and OTLP/protobuf.");

    // Any origin, and whatever request headers the browser asks to send.
    expect(source("startServer")).toContain(
      'res.header("Access-Control-Allow-Origin", "*");',
    );
    expect(source("corsOptions")).not.toContain("allowedHeaders:");
    expect(reference).toContain(
      "The endpoints answer cross-origin requests from any origin and allow the `x-oneuptime-token` header",
    );
  });

  it("exports metrics every 30 seconds, as the web vitals page counts on", () => {
    expect(
      fenceHolding(BROWSER_SETUP, "new PeriodicExportingMetricReader({").code,
    ).toContain("exportIntervalMillis: 30000,");
    expect(englishPage(WEB_VITALS)).toContain(
      "With the 30-second export interval from [Browser Setup](/docs/rum/browser-setup)",
    );
  });
});

describe("Mobile Setup", () => {
  const mobile: string = englishPage(MOBILE_SETUP);

  it("sets the resource the Dashboard's mobile guide sets, and it is mobile RUM", () => {
    const line: RegExpMatchArray | null = mobile.match(
      OTEL_RESOURCE_ATTRIBUTES_LINE,
    );

    expect(line).not.toBeNull();
    expect((line as RegExpMatchArray)[1]).toBe(
      getRumMobileResourceAttributes("storefront-mobile"),
    );

    const pairs: Record<string, string> = resourceAttributesValue(
      (line as RegExpMatchArray)[1] as string,
    );

    expect(pairs["service.name"]).toBe("storefront-mobile");
    expect(classify(pairs)).toBe("mobile");
  });

  it("files every platform's sample resource as mobile RUM", () => {
    const reactNative: DocsFence = fenceHolding(
      MOBILE_SETUP,
      'import * as Device from "expo-device";',
    );

    expect(allMatches(reactNative.code, RESOURCE_ATTRIBUTE, 1)).toEqual([
      "service.name",
      "device.manufacturer",
      "device.model.identifier",
      "telemetry.sdk.language",
    ]);

    // The Android and iOS samples set the same two device attributes.
    for (const needle of [
      '.put("device.model.identifier", Build.MODEL)',
      '"device.model.identifier": .string(UIDevice.current.model),',
    ]) {
      expect(mobile).toContain(needle);
    }

    expect(
      classify({
        "service.name": "storefront-android",
        "device.manufacturer": "Google",
        "device.model.identifier": "Pixel 8",
      }),
    ).toBe("mobile");
  });

  it("needs a Server key: a Browser key's origin check refuses a request without Origin", () => {
    expect(mobile).toContain(
      "A **Browser** key is refused from a mobile app: it is checked against the `Origin` header, which mobile SDKs do not send.",
    );
    expect(source("ingestMiddleware")).toContain(
      'return "This request did not send an Origin header',
    );
  });

  it("records React Native sessions with the replay SDK, on an app:// identity", () => {
    const replay: string = section(MOBILE_SETUP, "## Session Replay on mobile");
    const replayPackage: { name: string } = JSON.parse(
      source("mobileRecorderPackage"),
    );

    expect(replayPackage.name).toBe("@oneuptime/react-native-replay");
    expect(replay).toContain(`\`${replayPackage.name}\``);
    expect(OriginAllowList.getMobileAppOrigin("com.example.storefront")).toBe(
      "app://com.example.storefront",
    );
    expect(source("ingestionKeyForm")).toContain(
      "exact app:// identities authorize mobile replay only",
    );
    expect(replay).toContain(
      "**Allowed Origins** list your app as `app://` followed by its Android application ID or iOS bundle ID",
    );
    // The page no longer says mobile apps cannot be recorded.
    expect(mobile).not.toContain("Session Replay is browser-only");
  });
});

describe("Core Web Vitals", () => {
  const vitals: string = englishPage(WEB_VITALS);

  function definition(key: string): WebVitalDefinition {
    return WebVitalDefinitions.find(
      (candidate: WebVitalDefinition): boolean => {
        return candidate.key === key;
      },
    ) as WebVitalDefinition;
  }

  it("lists the names OneUptime probes for each vital, in its order, with each unit", () => {
    const names: string = section(WEB_VITALS, "## Metric names OneUptime recognises");
    const rows: Array<Array<string>> = (tables(names)[0] || []).slice(1);

    expect(
      rows.map((row: Array<string>) => {
        return {
          vital: (row[0] as string).split(":")[0],
          names: inlineCodeOf(row[1] as string),
          unit: row[2],
        };
      }),
    ).toEqual(
      WebVitalDefinitions.map((vital: WebVitalDefinition) => {
        return {
          vital: vital.key.toUpperCase(),
          names: vital.names,
          unit: vital.unit,
        };
      }),
    );

    for (const vital of WebVitalDefinitions) {
      expect(names).toContain(`${vital.key.toUpperCase()}: ${vital.label}`);
    }
  });

  it("rates each vital with the card's limits and its chips' words", () => {
    const ratings: string = section(WEB_VITALS, "## Rating thresholds");
    const table: Array<Array<string>> = tables(ratings)[0] || [];
    const card: string = source("webVitalsCard");
    const locale: Record<string, unknown> = JSON.parse(source("englishLocale"));

    expect(table[0]).toEqual([
      "Vital",
      ...WEB_VITAL_RATING_LABELS.map((label: string): string => {
        return `**${label}**`;
      }),
    ]);

    for (const label of WEB_VITAL_RATING_LABELS) {
      expect(card).toContain(`return "${label}";`);
      // No translation lookup: every language's card draws it in English.
      expect({ label, key: locale[label] }).toEqual({ label, key: undefined });
    }

    for (const row of table.slice(1)) {
      const vital: WebVitalDefinition = definition(
        (row[0] as string).toLowerCase(),
      );
      const numbers: Array<number> = row
        .slice(1)
        .flatMap((cell: string): Array<number> => {
          return (cell.match(NUMBER) || []).map(Number);
        });

      expect({ vital: vital.key, numbers }).toEqual({
        vital: vital.key,
        numbers: [
          vital.thresholds.warn,
          vital.thresholds.warn,
          vital.thresholds.danger,
          vital.thresholds.danger,
        ],
      });
    }
  });

  it("says the card is a mean over the range, and that the Metrics page offers P75", () => {
    const fetch: string = source("telemetryMetrics");
    const webVitalsFetch: string = fetch.slice(
      fetch.indexOf("export const fetchWebVitals"),
      fetch.indexOf("export interface WebVitalRoute "),
    );

    expect(webVitalsFetch).toContain("aggregationType: AggregationType.Avg,");
    expect(webVitalsFetch).toContain(
      "aggregationInterval: AggregationInterval.Total,",
    );
    expect(MetricsAggregationType.P75).toBe("P75");
    expect(source("metricQuery")).toContain(
      "DropdownUtil.getDropdownOptionsFromEnum(MetricsAggregationType)",
    );
    expect(vitals).toContain("The card shows the **mean** over the selected range");
    expect(vitals).toContain("with the **P75** aggregation");
  });

  it("puts the limits of each vital among its histogram's bucket edges", () => {
    const record: DocsFence = fenceHolding(WEB_VITALS, "onLCP(record(lcp));");
    const histograms: Array<RegExpMatchArray> = Array.from(
      record.code.matchAll(HISTOGRAM_BUCKETS),
    );

    expect(
      histograms.map((match: RegExpMatchArray): string => {
        return match[1] as string;
      }),
    ).toEqual([
      "web_vital.lcp",
      "web_vital.inp",
      "web_vital.fcp",
      "web_vital.ttfb",
      "web_vital.cls",
    ]);

    for (const match of histograms) {
      const vital: WebVitalDefinition = definition(
        (match[1] as string).split(".")[1] as string,
      );
      const edges: Array<number> = (match[2] as string)
        .split(",")
        .map((edge: string): number => {
          return Number(edge.trim());
        });

      expect(vital.names[0]).toBe(match[1]);
      expect(edges).toContain(vital.thresholds.warn);
      expect(edges).toContain(vital.thresholds.danger);
    }
  });

  it("rates the per-route INP with INP's limits", () => {
    const inp: WebVitalDefinition = definition("inp");

    expect(
      fenceHolding(WEB_VITALS, "observeInpPerRoute(toRoutePattern(").code,
    ).toContain(
      `"web_vital.rating": inpMs <= ${inp.thresholds.warn} ? "good" : inpMs <= ${inp.thresholds.danger} ? "needs-improvement" : "poor",`,
    );
  });

  it("measures INP per view the way the replay recorder does", () => {
    const recorder: string = source("performanceRecorder");
    const helper: string = fenceHolding(
      WEB_VITALS,
      "export function startView(route: string): void {",
    ).code;

    expect(helper).toContain(
      `const SETTLE_MS = ${numberConstant(recorder, "INP_VIEW_SETTLE_MS")};`,
    );
    expect(helper).toContain(
      `durationThreshold: ${numberConstant(recorder, "INP_DURATION_THRESHOLD_MS")},`,
    );
  });

  it("collapses ids to the route pattern, as its example says", () => {
    const code: string = fenceHolding(WEB_VITALS, "toRoutePattern = (").code;
    const literal: RegExpMatchArray | null = code.match(ROUTE_PATTERN_LITERAL);

    expect(literal).not.toBeNull();

    const pattern: RegExp = new RegExp(
      (literal as RegExpMatchArray)[1] as string,
      "gi",
    );
    const toRoutePattern: (path: string) => string = (
      path: string,
    ): string => {
      return path.replace(pattern, "/:id");
    };

    expect(toRoutePattern("/products/42")).toBe("/products/:id");
    expect(
      toRoutePattern("/orders/0b9a43c2-6c4e-4f1e-9a62-2d8f1f7f2a10/items"),
    ).toBe("/orders/:id/items");
    expect(toRoutePattern("/products")).toBe("/products");
    expect(code).toContain('// "/products/42" -> "/products/:id", also for UUIDs.');
  });

  it("reads the route from app.route, then url.template, for INP by route", () => {
    const card: string = source("routeBreakdownCard");

    expect(WebVitalRouteAttributeKeys).toEqual(["app.route", "url.template"]);
    expect(card).toContain(
      "const title: string = `${props.vital.key.toUpperCase()} by route`;",
    );
    expect(card).toContain(
      `export const WEB_VITALS_DOCS_URL: string =\n  "/docs/${WEB_VITALS}#single-page-apps";`,
    );
    expect(vitals).toContain("\n## Single-page apps\n");
    expect(vitals).toContain(
      "- **INP by route** on the overview, slowest first, from `app.route`; OneUptime also reads OpenTelemetry's `url.template`.",
    );
  });

  it("names the card's empty state as the card draws it", () => {
    expect(source("webVitalsCard")).toContain("No web vitals reported yet");
    expect(vitals).toContain(
      ':::details The card says "No web vitals reported yet"',
    );
  });

  it("lists the web vital recommendations with their metric, limit and severity", () => {
    const alert: string = section(WEB_VITALS, "## Alert on a vital");
    const rows: Array<Array<string>> = (tables(alert)[0] || []).slice(1);
    const templates: Array<RumAlertTemplate> = getAllRumAlertTemplates().filter(
      (template: RumAlertTemplate): boolean => {
        return template.category === "Core Web Vitals";
      },
    );

    expect(
      templates.map((template: RumAlertTemplate): string => {
        return template.name;
      }),
    ).toEqual([...WEB_VITAL_RECOMMENDATION_NAMES]);

    const args: {
      rumApplicationId: string;
      onlineMonitorStatusId: ObjectID;
      offlineMonitorStatusId: ObjectID;
      defaultIncidentSeverityId: ObjectID;
      defaultAlertSeverityId: ObjectID;
      monitorName: string;
    } = {
      rumApplicationId: ObjectID.generate().toString(),
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "storefront-web",
    };

    expect(
      templates.map((template: RumAlertTemplate) => {
        const step: MonitorStep = template.getMonitorStep(args);
        const metric: any = step.data?.metricMonitor;
        const breach: any =
          step.data?.monitorCriteria.data?.monitorCriteriaInstanceArray[0]
            ?.data?.filters[0];

        expect(metric.rollingTime).toBe(RollingTime.Past5Minutes);
        expect(
          metric.metricViewConfig.queryConfigs[0].metricQueryData.filterData
            .aggegationType,
        ).toBe(MetricsAggregationType.Avg);
        expect(breach.filterType).toBe(FilterType.GreaterThanOrEqualTo);

        return [
          `**${template.name}**`,
          `\`${metric.metricViewConfig.queryConfigs[0].metricQueryData.filterData.metricName}\``,
          String(breach.value),
          `**${template.severity}**`,
        ];
      }),
    ).toEqual(
      rows.map((row: Array<string>): Array<string> => {
        return [
          row[0] as string,
          row[1] as string,
          ((row[2] as string).match(NUMBER) || [])[0] as string,
          row[3] as string,
        ];
      }),
    );

    expect(alert).toContain(
      "Each one reads the five-minute average of its metric and fires when it reaches Google's poor limit",
    );
  });
});

describe("the code samples", () => {
  /*
   * Every TypeScript sample on the four pages is valid TypeScript, so a
   * reader who copies it gets no syntax error. Kotlin and Swift samples are
   * the SDKs' own; they are not parsed here.
   */
  it.each(RUM_SETUP_PAGES)(
    "$page has only TypeScript samples that parse",
    (entry: RumDocsPageEntry) => {
      const samples: Array<DocsFence> = [
        ...fencesOf(entry.page, "ts"),
        ...fencesOf(entry.page, "tsx"),
      ];
      const problems: Array<string> = samples.flatMap(
        (fence: DocsFence): Array<string> => {
          const result: ts.TranspileOutput = ts.transpileModule(fence.code, {
            fileName: fence.lang === "tsx" ? "sample.tsx" : "sample.ts",
            reportDiagnostics: true,
            compilerOptions: {
              jsx: ts.JsxEmit.Preserve,
              target: ts.ScriptTarget.ES2022,
            },
          });

          return (result.diagnostics || []).map(
            (diagnostic: ts.Diagnostic): string => {
              return `line ${fence.line}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
            },
          );
        },
      );

      expect(problems).toEqual([]);
    },
  );

  it("never prescribes the old, browser-only story for mobile", () => {
    expect(englishPage(RUM_INDEX)).not.toContain("browser-only");
    expect(englishPage(MOBILE_SETUP)).toContain(
      "Native Android and iOS apps, and the other platforms, have no session recorder",
    );
  });
});
