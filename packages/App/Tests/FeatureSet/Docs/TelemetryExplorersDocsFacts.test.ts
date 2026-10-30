import {
  EXCEPTIONS,
  KEPT_AS_WRITTEN,
  LOGS_EXPLORER,
  METRICS_EXPLORER,
  METRIC_PIPELINE_RULE_TYPES,
  SERVICES,
  SIGNAL_READ_PERMISSION_TITLES,
  TELEMETRY_READ_ROLES,
  TRACES_EXPLORER,
} from "./TelemetryExplorersDocsPages";
import { readPage } from "./DocsContentSupport";
import {
  MenuSection,
  PACKAGES_DIR,
  developerSection,
  menuSections,
  readCommonSource,
  readDashboardSource,
  sectionByTitle,
  startsCollapsed,
} from "./DocsDashboardMenus";
import { escapeRegExp } from "./DocsTranslationChecks";
import {
  AI_TASK_PRESENTATION,
  EXCEPTION_AI_TASK_TYPES,
  ExceptionAITaskType,
} from "../../../FeatureSet/Dashboard/src/Utils/ExceptionAIAssistance";
import {
  ExceptionTriageAction,
  getExceptionTriageActions,
  getResolveInNextReleaseAction,
} from "../../../FeatureSet/Dashboard/src/Utils/ExceptionDetailPresentation";
import { AI_INSIGHTS_SWITCHES } from "../../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Span from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import { PerformanceFindingType } from "Common/Types/AI/CodeFixTaskContext";
import {
  WORTH_FIXING_MIN_MS,
  WORTH_FIXING_MIN_PERCENT_OF_TRACE,
} from "Common/Utils/Suggestions/TracePerformanceFixSuggestion";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import ErrorClass, {
  NON_ACTIONABLE_ERROR_CLASSES,
  isNonActionableErrorClass,
} from "Common/Types/Telemetry/ErrorClass";
import TimeRange from "Common/Types/Time/TimeRange";
import { EXCEPTION_DIGEST_WINDOW_HOURS } from "Common/Types/Telemetry/ExceptionAIDigest";
import { MAX_SIMILAR_EXCEPTIONS } from "Common/Types/Telemetry/SimilarExceptions";
import { EXCEPTION_TREND_BUCKET_COUNT } from "Common/Types/Telemetry/ExceptionListStats";
import {
  EXCEPTION_USER_ID_ATTRIBUTE_KEYS,
  readExceptionUserId,
} from "Common/Utils/Exceptions/ExceptionUserId";
import {
  CORE_LOGS_TABLE_COLUMN_OPTIONS,
  DEFAULT_LOGS_TABLE_COLUMNS,
  LogsTableColumnOption,
} from "Common/UI/Components/LogsViewer/types";
import MetricFormulaEvaluator from "Common/Utils/Metrics/MetricFormulaEvaluator";
import { DEFAULT_SAVED_VIEW_TIME_RANGE } from "Common/Utils/Telemetry/SavedViewTimeRange";
import { INTERACTIVE_READ_TIME_LIMIT } from "Common/Server/Utils/AnalyticsDatabase/QuerySettingsHelper";
import { normalizeExceptionText } from "Common/Server/Utils/Telemetry/ExceptionSanitizer";
import LogExceptionExtractor from "Common/Server/Utils/Telemetry/LogExceptionExtractor";
import { extractOneuptimeLabelNames } from "Common/Server/Utils/Telemetry/OneuptimeLabel";
import PinServiceName from "Common/Server/Utils/Telemetry/PinServiceName";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 37 added five pages the docs never had: the Service
 * Catalog and the Logs, Traces, Metrics and Exceptions explorers. Between
 * them they name a great deal of the product - how ingest files telemetry
 * under a service and what it reads from it, every tab, menu, column,
 * default, limit and button of the explorers, how exceptions are found,
 * grouped, triaged and fixed, and who may read what.
 *
 * Markdown is not compiled, so nothing else notices when the product moves
 * on. These hold the English pages to the source: Common's models, types
 * and helpers imported (and run on made-up input where a page gives an
 * example), the Dashboard's React-free modules imported and its pages read
 * as text, and the ingest services and the workers read as text (an App
 * test must not import the Dashboard's React components). A renamed label,
 * a changed default or a new rule fails here until the English pages
 * follow - and TelemetryExplorersDocsTranslations then carries the change
 * into every language.
 *
 * The retention override cards are drawn by the Enterprise Edition (ee/):
 * that half runs where ee/ is checked out, which is the Enterprise Edition
 * Test workflow (.github/workflows/test.ee.yaml).
 */

const REPO_DIR: string = path.resolve(PACKAGES_DIR, "..");
const EE_DIR: string = path.join(REPO_DIR, "ee");

const HEADING_LEVEL: RegExp = /^(#+) /;
const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const INLINE_CODE: RegExp = /`([^`\n]+)`/g;
const TITLE_PROPERTY: RegExp = /title: "([^"]+)"/g;
const LABEL_PROPERTY: RegExp = /label: "([^"]+)"/g;
const LABEL_ATTRIBUTE: RegExp = /label="([^"]+)"/g;
const RESOURCE_ATTRIBUTE_READ: RegExp =
  /getResourceStringAttribute\(\s*attributes,\s*"([^"]+)"/g;
const TRANSLATION_KEY: RegExp = /translationKey\("([^"]+)"\)/g;
const NUMBER_LIST: RegExp = /\[([\d,\s]+)\]/;
const NUMBER: RegExp = /\d+/g;
// A navbar entry's group: `category: observabilityCategory`.
const NAVBAR_CATEGORY: RegExp = /category: (\w+)Category/;
// A row of the shortcuts help: `{ keys: ["j"], description: ... }`.
const SHORTCUT_KEYS: RegExp = /keys: \[([^\]]+)\]/g;

const NUMBER_WORDS: Record<number, string> = {
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
};

function english(page: string): string {
  return readPage("en", page);
}

// A file of any package, as text.
function readPackageFile(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

/*
 * The text of the section under `heading` ("## X"), up to the next heading of
 * its level or above. A heading the page lacks fails, naming it.
 */
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n${heading}\n`);

  expect({ heading: heading, found: start >= 0 }).toEqual({
    heading: heading,
    found: true,
  });

  const level: number = (heading.match(HEADING_LEVEL)?.[1] || "#").length;
  const rest: string = markdown.slice(start + heading.length + 2);
  const end: number = rest.search(new RegExp(`\\n#{1,${level}} `));

  return end === -1 ? rest : rest.slice(0, end);
}

// The cells of a markdown table row, trimmed, without the empty outer ones.
function tableCells(row: string): Array<string> {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
}

// The body rows of the first table in a piece of markdown, as cells.
function tableRows(markdown: string): Array<Array<string>> {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("|");
  });

  if (start < 0) {
    return [];
  }

  const rows: Array<Array<string>> = [];

  for (const line of lines.slice(start)) {
    if (!line.startsWith("|")) {
      break;
    }

    rows.push(tableCells(line));
  }

  return rows.slice(2);
}

// The first cell of each body row of the first table, bold markers dropped.
function firstColumn(markdown: string): Array<string> {
  return tableRows(markdown).map((row: Array<string>): string => {
    return unbold(row[0] || "");
  });
}

function unbold(text: string): string {
  return text.split("**").join("");
}

// Every **bold** name in a piece of text, in order.
function boldNames(text: string): Array<string> {
  return Array.from(text.matchAll(BOLD)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// Every `inline code` span in a piece of text, in order.
function inlineCodes(text: string): Array<string> {
  return Array.from(text.matchAll(INLINE_CODE)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// Every capture of a pattern in a piece of source, in order.
function allMatches(source: string, pattern: RegExp): Array<string> {
  return Array.from(source.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The source between two markers, both of which must be there.
function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  expect({ from, found: start >= 0 }).toEqual({ from, found: true });

  const end: number = source.indexOf(to, start + from.length);

  expect({ to, found: end >= 0 }).toEqual({ to, found: true });

  return source.slice(start, end);
}

// The number a `const NAME: number = 123;` declaration holds.
function numberConstant(source: string, name: string): number {
  const match: RegExpExecArray | null = new RegExp(
    `const ${escapeRegExp(name)}: number = ([\\d_]+);`,
  ).exec(source);

  expect({ name, declared: match !== null }).toEqual({
    name,
    declared: true,
  });

  return Number((match?.[1] || "").split("_").join(""));
}

// The numbers a `const NAME: Array<number> = [...]` declaration lists.
function numberListConstant(source: string, name: string): Array<number> {
  const start: number = source.indexOf(`const ${name}: Array<number> =`);

  expect({ name, declared: start >= 0 }).toEqual({ name, declared: true });

  const list: RegExpExecArray | null = NUMBER_LIST.exec(source.slice(start));

  return Array.from((list?.[1] || "").matchAll(NUMBER)).map(
    (match: RegExpMatchArray): number => {
      return Number(match[0]);
    },
  );
}

/*
 * A list as a page writes it in prose: "A, B or C", or "A, B and C".
 */
function writtenList(items: Array<string>, conjunction: string): string {
  if (items.length < 2) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

// The distinct titles of a set of permissions, in the order first granted.
function permissionTitles(permissions: Array<Permission>): Array<string> {
  const titles: Array<string> = [];

  for (const permission of permissions) {
    const title: string = PermissionHelper.getTitle(permission);

    if (!titles.includes(title)) {
      titles.push(title);
    }
  }

  return titles;
}

/*
 * The sentence an explorer's "A role that reads telemetry." item writes:
 * the roles the model lets read, then the custom-role permission.
 */
function roleSentence(roles: Array<string>, permission: string): string {
  return `${writtenList(roles, "or")}, or a custom role with the ${permission} permission.`;
}

// The Products menu category a navbar item is listed under.
function productsMenuCategory(itemKey: string): string {
  const items: string = readDashboardSource("Utils/NavigationItems.tsx");
  const start: number = items.indexOf(`t("navbar.items.${itemKey}"`);

  expect({ itemKey, listed: start >= 0 }).toEqual({ itemKey, listed: true });

  const entry: string = items.slice(start, items.indexOf("},", start));
  const category: RegExpExecArray | null = NAVBAR_CATEGORY.exec(entry);

  return category?.[1] || "";
}

// The Dashboard's English locale, flat keys and the nested navbar.
const DASHBOARD_ENGLISH: Record<string, unknown> = JSON.parse(
  readDashboardSource("Locales/en.json"),
) as Record<string, unknown>;

function navbarValue(group: string, key: string): string {
  const navbar: Record<string, Record<string, string>> = DASHBOARD_ENGLISH[
    "navbar"
  ] as Record<string, Record<string, string>>;

  return navbar[group]?.[key] || "";
}

describe("Service Catalog (telemetry/services)", () => {
  const page: string = english(SERVICES);
  const ingest: string = readCommonSource(
    "Server/Services/OpenTelemetryIngestService.ts",
  );
  const ingestBase: string = readPackageFile(
    "App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts",
  );
  const serviceService: string = readCommonSource(
    "Server/Services/ServiceService.ts",
  );

  it("names the resource attributes a service's details come from, in the order ingest reads them", () => {
    const metadata: string = between(
      ingest,
      "private static buildServiceMetadataFromAttributes(",
      "private static async getProjectRetentionContext(",
    );
    const read: Array<string> = allMatches(metadata, RESOURCE_ATTRIBUTE_READ);
    const written: Array<string> = tableRows(
      section(page, "## How a service gets into the catalog"),
    ).flatMap((row: Array<string>): Array<string> => {
      return inlineCodes(row[1] || "");
    });

    expect(read).toEqual(written);
    // deployment.environment.name first; the older key only when it is absent.
    expect(metadata.indexOf('"deployment.environment.name"')).toBeLessThan(
      metadata.indexOf('"deployment.environment")'),
    );
    expect(page).toContain(
      "| Deployment Environment | `deployment.environment.name`, or `deployment.environment` |",
    );
  });

  it("files telemetry under the service named by service.name, matched without regard to case", () => {
    const findOrCreate: string = between(
      ingest,
      "private static async findOrCreateTelemetryService(",
      "public static",
    );

    expect(findOrCreate).toContain(
      "name: QueryHelper.findWithSameText(data.serviceName),",
    );
    // The resolution cache folds case and spacing the same way.
    expect(ingest).toContain(
      "return `${projectId.toString()}:${serviceName.toLowerCase().trim()}`;",
    );
    // A name it has not seen starts a new service, named after it.
    expect(findOrCreate).toContain("newService.name = data.serviceName;");
    expect(page).toContain(
      "It is compared without regard to case, so `Checkout-API` and `checkout-api` are one service. A new `service.name` starts a new service.",
    );
  });

  it("keeps an archived service collecting telemetry: ingest looks a service up by name alone", () => {
    const lookups: string = between(
      ingest,
      "private static async findOrCreateTelemetryService(",
      "public static",
    );

    expect(lookups).not.toContain("isArchived");
    expect(page).toContain(
      "An archived service is hidden from **All Services**, but it keeps collecting telemetry.",
    );
  });

  it("names a container's service after it for the Docker and Podman agents only, and leaves browsers and phones to RUM", () => {
    const naming: string = between(
      ingestBase,
      "protected static async getServiceNameFromAttributes(",
      "One-stop resolver",
    );

    // RUM first: a browser or app batch never names a service.
    expect(naming.indexOf("this.getRumClientType(attributes)")).toBeLessThan(
      naming.indexOf('"service.name"'),
    );
    expect(naming).toContain("this.isDockerRuntime(attributes)");
    expect(naming).toContain("this.isPodmanRuntime(attributes)");
    expect(page).toContain(
      "**Containers name themselves.** Telemetry from the Docker and Podman agents names a service after its container when it has no `service.name`.",
    );
    expect(page).toContain(
      "Telemetry from a browser or a mobile app belongs to a [RUM application](/docs/rum/applications) instead.",
    );
  });

  it("files the OpenTelemetry data a key with a Pinned Service Name sends under that name", () => {
    const attributes: JSONArray = [
      { key: "service.name", value: { stringValue: "payments-api" } },
      { key: "host.name", value: { stringValue: "web-1" } },
    ];
    const body: JSONObject = {
      resourceSpans: [{ resource: { attributes: attributes } }],
      resourceLogs: [{ resource: { attributes: [...attributes] } }],
    };

    expect(PinServiceName.pinInPlace(body, "storefront")).toBe(2);

    for (const container of ["resourceSpans", "resourceLogs"]) {
      const resource: JSONObject = (
        (body[container] as Array<JSONObject>)[0] as JSONObject
      )["resource"] as JSONObject;
      const serviceName: JSONObject | undefined = (
        resource["attributes"] as Array<JSONObject>
      ).find((attribute: JSONObject): boolean => {
        return attribute["key"] === "service.name";
      });

      expect({
        container,
        name: (serviceName?.["value"] as JSONObject | undefined)?.[
          "stringValue"
        ],
      }).toEqual({ container, name: "storefront" });
    }

    expect(
      readDashboardSource("Components/Telemetry/IngestionKeyForm.ts"),
    ).toContain('title: "Pinned Service Name",');
    expect(page).toContain(
      "**An ingestion key can name the service.** OpenTelemetry data sent with a key that has a **Pinned Service Name** is filed under that name, whatever its `service.name` says.",
    );
  });

  it("turns an oneuptime.label.<name> resource attribute into the label the page shows", () => {
    const attributes: JSONArray = [
      { key: "oneuptime.label.team", value: { stringValue: "payments" } },
      { key: "service.name", value: { stringValue: "checkout" } },
    ];

    expect(extractOneuptimeLabelNames(attributes)).toEqual(["team:payments"]);
    expect(ingest).toContain("await ServiceService.attachLabels({");
    expect(page).toContain(
      "A resource attribute named `oneuptime.label.<name>` adds the label `<name>:<value>` to the service, such as `oneuptime.label.team=payments` for `team:payments`.",
    );
  });

  it("moves Last Seen forward about once a minute", () => {
    expect(numberConstant(serviceService, "LAST_SEEN_THROTTLE_SECONDS")).toBe(
      60,
    );
    expect(page).toContain(
      "**Last Seen** is updated about once a minute, not on every batch, so it can trail live telemetry by a minute or so.",
    );
  });

  it("runs the label and owner rules on every new service, and gives it a color of its own", () => {
    const onCreate: string = between(
      serviceService,
      "protected override async onCreateSuccess(",
      "public async",
    );

    expect(onCreate).toContain(
      "ServiceLabelRuleEngineService.applyRulesToService(createdItem)",
    );
    expect(onCreate).toContain(
      "ServiceOwnerRuleEngineService.applyRulesToService(createdItem)",
    );
    expect(serviceService).toContain(
      "createBy.data.serviceColor = pickRandomDistinctColor();",
    );
    expect(page).toContain(
      "Label and owner rules run on it as on a discovered service.",
    );
    expect(page).toContain("a new service gets one of its own");
    expect(page).toContain(
      "Rules give new services their labels and owners as they are created, discovered ones included.",
    );
  });

  it("names the roles that read and change services as the Service model grants them", () => {
    const service: Service = new Service();
    const readers: Array<string> = permissionTitles(
      service.readRecordPermissions,
    );
    const readPermission: string = PermissionHelper.getTitle(
      Permission.ReadService,
    );

    expect(readers[readers.length - 1]).toBe(readPermission);
    expect(page).toContain(
      `**A role that reads services.** ${roleSentence(readers.slice(0, -1), readPermission)}`,
    );

    const writers: Array<Array<string>> = [
      [service.createRecordPermissions, Permission.CreateService],
      [service.updateRecordPermissions, Permission.EditService],
      [service.deleteRecordPermissions, Permission.DeleteService],
    ].map((grant: Array<Array<Permission> | Permission>): Array<string> => {
      const own: string = PermissionHelper.getTitle(grant[1] as Permission);

      return permissionTitles(grant[0] as Array<Permission>).filter(
        (title: string): boolean => {
          return title !== own;
        },
      );
    });

    // Creating, changing and deleting take the same roles.
    expect(writers[1]).toEqual(writers[0]);
    expect(writers[2]).toEqual(writers[0]);
    expect(page).toContain(
      `Creating, changing and deleting services takes ${writtenList(writers[0] as Array<string>, "or")}, or the matching service permissions.`,
    );
  });

  it("opens from Products → Resources → Services, whose menu holds All Services, the rules and Archived", () => {
    expect(productsMenuCategory("servicesTitle")).toBe("resources");
    expect(navbarValue("categories", "resources")).toBe("Resources");
    expect(navbarValue("items", "servicesTitle")).toBe("Services");
    expect(page).toContain("Go to **Products → Resources → Services**.");

    const menuSource: string = readDashboardSource(
      "Pages/Service/SideMenu.tsx",
    );
    const sections: Array<MenuSection> = menuSections(menuSource);

    expect(sectionByTitle(sections, "Services").items).toEqual([
      "All Services",
    ]);
    expect(sectionByTitle(sections, "Settings").items).toEqual([
      "Owner Rules",
      "Label Rules",
    ]);
    expect(sectionByTitle(sections, "Advanced").items).toEqual(["Archived"]);
    expect(startsCollapsed(menuSource, "Settings")).toBe(true);
    expect(page).toContain(
      "Find them under **Services → Settings → Owner Rules** and **Services → Settings → Label Rules**; **Settings** starts collapsed in the side menu.",
    );
    expect(page).toContain("open **Services → Advanced → Archived**.");
  });

  it("lists services with the columns, search, filters and bulk actions the page names", () => {
    const list: string = readDashboardSource("Pages/Service/Services.tsx");
    const columns: Array<string> = allMatches(
      list.slice(list.indexOf("columns={[")),
      TITLE_PROPERTY,
    );

    expect(columns).toEqual([
      "Name",
      "Description",
      "Technology",
      "Last Seen",
      "Labels",
      "Owners",
    ]);
    expect(page).toContain(
      `**All Services** lists every service with its ${writtenList(
        columns.map((column: string): string => {
          return `**${column}**`;
        }),
        "and",
      )}.`,
    );
    expect(list).toContain('searchableFields={["name", "description"]}');
    expect(list).toContain("showLabelsFacet: true,");
    expect(list).toContain(
      "query={mergeFiltersIntoQuery({ isArchived: false })}",
    );

    for (const bulk of [
      "useBulkLabelActions",
      "useBulkOwnerActions",
      "useBulkArchiveActions",
    ]) {
      expect(list).toContain(bulk);
    }

    expect(page).toContain(
      "Search by name or description, and filter by owner or label with the bar above the list.",
    );
    expect(page).toContain(
      "Select several services to add labels or owners to all of them at once, or to archive them.",
    );
  });

  it("describes a service's own menu section by section, with Developer and Advanced folded", () => {
    const menuSource: string = readDashboardSource(
      "Pages/Service/View/SideMenu.tsx",
    );
    const sections: Array<MenuSection> = menuSections(menuSource, {
      "{getDeveloperSideMenuSection(": developerSection(),
    });
    const written: Array<MenuSection> = tableRows(
      section(page, "## A service's pages"),
    ).map((row: Array<string>): MenuSection => {
      const title: string = unbold(row[0] || "");

      return {
        title: title,
        // The cell names the section again to say it starts collapsed.
        items: boldNames(row[1] || "").filter((name: string): boolean => {
          return name !== title;
        }),
      };
    });

    expect(written).toEqual(sections);
    expect(page).toContain(
      `A service's side menu has ${NUMBER_WORDS[sections.length]} sections:`,
    );

    for (const menuSection of sections) {
      expect({
        section: menuSection.title,
        folded: startsCollapsed(menuSource, menuSection.title),
      }).toEqual({
        section: menuSection.title,
        folded: ["Developer", "Advanced"].includes(menuSection.title),
      });
    }

    expect(page).toContain(
      "| **Developer** | **Terraform**, **API** and **AI Assistants**: the service managed from code. It starts collapsed. |",
    );
    expect(page).toContain("**Advanced** starts collapsed: expand it first.");
  });

  it("names the Settings page's cards, fields and buttons as the page draws them", () => {
    const settings: string = readDashboardSource(
      "Pages/Service/View/Settings.tsx",
    );
    const detailsCard: string = readDashboardSource(
      "Components/TelemetryResource/ResourceDetailsCard.tsx",
    );

    expect(settings).toContain('title="Service Details"');
    expect(detailsCard).toContain(
      'RESOURCE_DETAILS_EDIT_BUTTON_TEXT: string =\n  translationKey("Edit Details");',
    );
    expect(detailsCard).toContain('title: "Labels",');
    expect(settings).toContain('title: "Service Settings",');
    expect(settings).toContain('editButtonText="Edit Settings"');
    expect(settings).toContain('title: "Service Color",');

    const techStack: string = between(
      settings,
      'title: "Tech Stack",',
      "dropdownOptions",
    );

    expect(techStack).toContain("required: false,");
    expect(techStack).toContain(
      "Leave blank to use the language detected from this service's telemetry.",
    );
    expect(settings).toContain("<ArchiveResourceCard<Service>");

    expect(page).toContain(
      "On **Service Details**, click **Edit Details** to change its **Name**, **Description** or **Labels**.",
    );
    expect(page).toContain(
      "On **Service Settings**, click **Edit Settings**. The **Service Color** marks the service in charts and lists; a new service gets one of its own. **Tech Stack** is optional: leave it empty to show the language detected from its telemetry.",
    );
    expect(page).toContain("Archive it from its **Settings** page");
  });

  it("keeps retention overrides to the Enterprise Edition and the Scale plan", () => {
    expect(
      readDashboardSource("Enterprise/EnterpriseEligibility.ts"),
    ).toContain(
      "TELEMETRY_RETENTION_REQUIRED_PLAN: EnterpriseRequiredPlan =\n  PlanType.Scale;",
    );
    expect(
      between(
        ingest,
        "public static applyRetentionOverrideEdition(",
        "public static",
      ),
    ).toContain("EnterpriseFeature.TelemetryRetention");
    expect(page).toContain(
      "They are part of the [Enterprise Edition](/docs/self-hosted/enterprise), and of the Scale plan on OneUptime Cloud; without them the page shows what they add, and the service keeps the project's retention.",
    );
  });

  it("names the retention override cards as the Enterprise Edition draws them, where ee/ is checked out", () => {
    // Core CI runs without ee/: the page is held to it wherever ee/ is present.
    if (!fs.existsSync(EE_DIR)) {
      return;
    }

    const enterprise: string = fs.readFileSync(
      path.join(
        EE_DIR,
        "Dashboard/TelemetryRetention/TelemetryResourceRetentionSettings.tsx",
      ),
      "utf8",
    );

    for (const card of [
      "Telemetry Data Retention",
      "Retention by Telemetry Type",
    ]) {
      expect({ card, drawn: enterprise.includes(`title: "${card}",`) }).toEqual(
        { card, drawn: true },
      );
      expect(page).toContain(`**${card}**`);
    }
  });

  it("deletes a service's source maps, metric pipeline rules and LLM cost budgets with it", () => {
    for (const model of [
      "TelemetrySourceMap",
      "MetricPipelineRule",
      "LlmCostBudget",
    ]) {
      const source: string = readCommonSource(
        `Models/DatabaseModels/${model}.ts`,
      );
      const relation: number = source.indexOf("return Service;");

      expect({ model, relatesToService: relation >= 0 }).toEqual({
        model,
        relatesToService: true,
      });
      expect({
        model,
        cascades: source
          .slice(relation, relation + 400)
          .includes('onDelete: "CASCADE"'),
      }).toEqual({ model, cascades: true });
    }

    expect(page).toContain(
      "Deleting a service also deletes its source maps, and the metric pipeline rules and LLM cost budgets set for it. If OneUptime still receives its telemetry, the service is added back, without the labels, owners and settings you gave it.",
    );
  });
});

describe("Logs Explorer (telemetry/logs-explorer)", () => {
  const page: string = english(LOGS_EXPLORER);
  const dashboardViewer: string = readDashboardSource(
    "Components/Logs/LogsViewer.tsx",
  );
  const commonViewer: string = readCommonSource(
    "UI/Components/LogsViewer/LogsViewer.tsx",
  );

  it("names the explorer's tabs in the order they are drawn, and Settings' four rule pages", () => {
    const tabs: Array<string> = allMatches(
      readDashboardSource("Components/Logs/LogsNavTabs.tsx"),
      LABEL_PROPERTY,
    );
    const tabTable: string = section(
      page,
      "## How the explorer narrows your logs",
    );
    const settingsPages: Array<string> = menuSections(
      readDashboardSource("Pages/Logs/Settings/SideMenu.tsx"),
    ).flatMap((menuSection: MenuSection): Array<string> => {
      return menuSection.items;
    });

    expect(firstColumn(tabTable)).toEqual(tabs);
    expect(settingsPages).toEqual([
      "Pipelines",
      "Drop Filters",
      "Scrub Rules",
      "Recording Rules",
    ]);
    expect(page).toContain(
      `| **Settings** | What happens to logs as they arrive: ${writtenList(
        settingsPages.map((name: string): string => {
          return `**${name}**`;
        }),
        "and",
      )}. |`,
    );
    expect(
      [
        ...firstColumn(section(page, "## What happens to logs as they arrive")),
      ].sort(),
    ).toEqual([...settingsPages].sort());
  });

  it("opens on the past hour, newest first, 100 logs per page", () => {
    expect(DEFAULT_SAVED_VIEW_TIME_RANGE).toBe(TimeRange.PAST_ONE_HOUR);
    expect(numberConstant(dashboardViewer, "DEFAULT_PAGE_SIZE")).toBe(100);

    const defaults: string = readDashboardSource(
      "Components/Logs/LogsViewerDefaults.ts",
    );

    expect(defaults).toContain('sortField: "time",');
    expect(defaults).toContain("sortOrder: SortOrder.Descending,");
    expect(page).toContain(
      "| **Viewer** | Search, filter and read logs. It opens on the past hour, newest first, 100 logs per page. |",
    );
    expect(page).toContain(
      "The **Viewer** lists the past hour's logs, newest first, with their",
    );
  });

  it("lists the columns the list starts with, and the ones it can add", () => {
    const label: (id: string) => string = (id: string): string => {
      return (
        CORE_LOGS_TABLE_COLUMN_OPTIONS.find(
          (option: LogsTableColumnOption): boolean => {
            return option.id === id;
          },
        )?.label || id
      );
    };
    const shown: Array<string> = DEFAULT_LOGS_TABLE_COLUMNS.map(label);
    const addable: Array<string> = CORE_LOGS_TABLE_COLUMN_OPTIONS.map(
      (option: LogsTableColumnOption): string => {
        return option.label;
      },
    ).filter((name: string): boolean => {
      return !shown.includes(name);
    });

    expect(shown).toEqual(["Time", "Service", "Severity", "Message"]);
    expect(addable).toEqual(["Trace ID", "Span ID"]);

    const bold: string = writtenList(
      shown.map((name: string): string => {
        return `**${name}**`;
      }),
      "and",
    );

    expect(page).toContain(`newest first, with their ${bold}.`);
    expect(page).toContain(
      `${bold} come first; add **Trace ID**, **Span ID** or any attribute`,
    );
  });

  it("shows five lines either side from the same service, and up to 100 logs of the trace", () => {
    const details: string = readCommonSource(
      "UI/Components/LogsViewer/components/LogDetailsPanel.tsx",
    );
    const nearby: string = between(
      details,
      '"/telemetry/logs/context"',
      "headers:",
    );

    expect(nearby).toContain("primaryEntityId: primaryEntityId,");
    expect(nearby).toContain("count: 5,");
    expect(numberConstant(details, "TRACE_CONTEXT_LIMIT")).toBe(100);
    expect(details).toContain('translateText("Nearby (service + time)")');
    expect(details).toContain('translateText("This trace")');
    expect(page).toContain(
      "**Nearby (service + time)** shows the five lines before and after it from the same service, and **This trace** shows up to 100 logs of its trace.",
    );
  });

  it("checks for new logs every 10 seconds while Live is on", () => {
    expect(numberConstant(dashboardViewer, "LIVE_POLL_INTERVAL_MS")).toBe(
      10000,
    );
    expect(page).toContain("checks for new logs every 10 seconds");
    expect(page).toContain(
      "- [Follow logs live](#follow-logs-live): New lines every 10 seconds.",
    );
  });

  it("exports the page's logs: the shown columns as CSV, every field as JSON", () => {
    const exporter: string = readCommonSource("UI/Utils/LogExport.ts");

    expect(commonViewer).toContain(
      "exportLogs(displayedLogs, LogExportFormat.CSV, selectedColumns);",
    );
    expect(exporter).toContain(
      "export function exportLogsToJSON(logs: Array<Log>): string {",
    );
    expect(page).toContain(
      "**Export** downloads the logs on the page you are looking at. **Export as CSV** writes the columns you show; **Export as JSON** writes every field of each log, with all its attributes.",
    );
  });

  it("saves a view's search, chips, range, columns, sort and page size, and makes a project's first view its default", () => {
    const save: string = between(
      dashboardViewer,
      'submitButtonText="Save View"',
      "onSuccess",
    );

    for (const field of [
      "savedView.query = filterOptions;",
      "savedView.timeRange = serializeSavedViewTimeRange(timeRange);",
      "savedView.columns = selectedColumns;",
      "savedView.sortField = sortField;",
      "savedView.sortOrder = sortOrder;",
      "savedView.pageSize = pageSize;",
      "return leaveSavedViewDefaultOutUnlessTicked(savedView);",
    ]) {
      expect({ field, saved: save.includes(field) }).toEqual({
        field,
        saved: true,
      });
    }

    expect(
      readCommonSource("Server/Services/LogSavedViewService.ts"),
    ).toContain("createBy.data.isDefault = !existingDefaultView;");

    const dropdown: string = readCommonSource(
      "UI/Components/LogsViewer/components/SavedViewsDropdown.tsx",
    );

    for (const text of [
      "+ Save Current View",
      "Clear view",
      "Update",
      "Edit",
      "Delete",
    ]) {
      expect(dropdown).toContain(`translateText("${text}")`);
    }

    expect(dashboardViewer).toContain('title: "Set as default",');
    expect(page).toContain(
      "A saved view keeps a search, its filter chips, the time range, the columns, the sort and the page size, under a name.",
    );
    expect(page).toContain(
      "While the project has no default view, the next view saved becomes the default, and a project has one default at a time.",
    );
  });

  it("charts logs as a time series, a top list or a table, counted or unique, top 5 to 50", () => {
    const analytics: string = readCommonSource(
      "UI/Components/LogsViewer/components/LogsAnalyticsView.tsx",
    );

    expect(numberListConstant(analytics, "TOP_LIST_LIMITS")).toEqual([
      5, 10, 25, 50,
    ]);

    for (const option of [
      'label: "Timeseries"',
      'label: "Top List"',
      'label: "Table"',
      'label: "Count"',
      'label: "Unique Count"',
      'label: "Severity"',
      'label: "Service"',
      'label: "Trace ID"',
      'label: "Span ID"',
    ]) {
      expect(analytics).toContain(option);
    }

    expect(page).toContain(
      "Pick a time series, a top list or a table; count every log, or the unique values of one field; and group by severity, service, trace, span or any attribute, then by a second field. A top list or a table shows the top 5, 10, 25 or 50 groups.",
    );
  });

  it("opens related traces and metrics from the Traces and Metrics buttons, each saying what it cannot carry", () => {
    const pivots: string = between(dashboardViewer, "signalPivotActions", "];");

    expect(pivots).toContain('label: "Traces",');
    expect(pivots).toContain('label: "Metrics",');
    expect(pivots).toContain("tooltip: buildTooltip(");
    expect(page).toContain(
      "The **Traces** and **Metrics** buttons beside **Saved Views** open",
    );
  });

  it("names the Insights panels and what a top error offers", () => {
    const insights: string = readDashboardSource(
      "Components/Logs/LogsDashboard.tsx",
    );
    const detail: string = readDashboardSource(
      "Components/Logs/ErrorPatternDetail.tsx",
    );
    const cards: Array<string> = allMatches(insights, LABEL_ATTRIBUTE);

    expect(cards).toEqual(
      expect.arrayContaining(["Total logs", "Errors", "Distinct errors"]),
    );
    expect(insights).toContain('"Reporting sources"');
    expect(insights).toContain('translateText("Severity distribution")');
    expect(insights).toContain('translateText("Sources reporting logs")');
    expect(readDashboardSource("Components/Logs/TopErrorsPanel.tsx")).toContain(
      'translateText("Top errors")',
    );
    expect(detail).toContain('translateText("Open matching logs")');
    expect(detail).toContain('translateText("Explain with AI")');
    expect(page).toContain(
      "| Summary cards | **Total logs**, **Errors**, **Distinct errors** and **Reporting sources**. |",
    );
  });

  it("lists the shortcuts the help panel lists, in its order", () => {
    const help: string = readCommonSource(
      "UI/Components/LogsViewer/components/KeyboardShortcutsHelp.tsx",
    );
    const rows: string = between(help, "const SHORTCUT_ROWS", "];");

    expect(
      allMatches(rows, SHORTCUT_KEYS).map((keys: string): string => {
        return keys.trim();
      }),
    ).toEqual([
      '"j"',
      '"k"',
      "KeyboardKey.Enter",
      "KeyboardKey.Escape",
      '"/"',
      "KeyboardKey.Mod, KeyboardKey.Enter",
      '"?"',
    ]);
    expect(firstColumn(section(page, "## Keyboard shortcuts"))).toEqual([
      "`j` / `k`",
      "Enter",
      "Esc",
      "`/`",
      "⌘ + Enter or Ctrl + Enter",
      "`?`",
    ]);
  });

  it("stops a search after 45 seconds", () => {
    expect(INTERACTIVE_READ_TIME_LIMIT.maxExecutionTimeInSeconds).toBe(45);
    expect(INTERACTIVE_READ_TIME_LIMIT.timeoutOverflowMode).toBe("throw");
    expect(page).toContain(
      "A search that runs longer than 45 seconds is stopped.",
    );
  });
});

describe("Traces Explorer (telemetry/traces-explorer)", () => {
  const page: string = english(TRACES_EXPLORER);
  const viewer: string = readDashboardSource(
    "Components/Traces/TracesViewer.tsx",
  );
  const traceExplorer: string = readDashboardSource(
    "Components/Traces/TraceExplorer.tsx",
  );
  const header: string = readDashboardSource(
    "Components/Traces/TraceDetail/TraceHeader.tsx",
  );

  it("names the explorer's tabs in the order they are drawn, and Settings' four rule pages", () => {
    const tabs: Array<string> = allMatches(
      readDashboardSource("Components/Traces/TracesNavTabs.tsx"),
      LABEL_PROPERTY,
    );
    const settingsPages: Array<string> = menuSections(
      readDashboardSource("Pages/Traces/Settings/SideMenu.tsx"),
    ).flatMap((menuSection: MenuSection): Array<string> => {
      return menuSection.items;
    });

    expect(firstColumn(section(page, "## Traces and spans"))).toEqual(tabs);
    expect(page).toContain(
      `| **Settings** | What happens to spans as they arrive: ${writtenList(
        settingsPages.map((name: string): string => {
          return `**${name}**`;
        }),
        "and",
      )}. |`,
    );
    expect(
      [
        ...firstColumn(
          section(page, "## What happens to spans as they arrive"),
        ),
      ].sort(),
    ).toEqual([...settingsPages].sort());
  });

  it("opens on the past hour, newest first, 50 spans per page, and checks every 10 seconds while live", () => {
    const telemetryViewer: string = readCommonSource(
      "UI/Components/TelemetryViewer/TelemetryViewer.tsx",
    );

    expect(numberConstant(viewer, "DEFAULT_PAGE_SIZE")).toBe(50);
    expect(numberConstant(viewer, "LIVE_POLL_INTERVAL_MS")).toBe(10000);
    expect(telemetryViewer).toContain(
      'translateString(props.live.isLive ? "Live" : "Paused")',
    );
    expect(page).toContain(
      "It opens on the past hour, newest first, 50 spans per page.",
    );
    expect(page).toContain(
      "Click **Paused** above the list to turn on live updates. The button then reads **Live**, and the list checks for new spans every 10 seconds.",
    );
  });

  it("filters by the facets the sidebar draws, in its order, with Root spans under Span Type", () => {
    const facets: string = between(
      viewer,
      "const statusColorMap",
      "const histogramSeries",
    );
    const titles: Array<string> = allMatches(facets, TITLE_PROPERTY);
    const sidebar: string =
      page.split("\n").find((line: string): boolean => {
        return line.startsWith(
          "Click a value in the **Filters** sidebar to add it as a chip. The sidebar filters by",
        );
      }) || "";

    expect(titles).toEqual([
      "Service",
      "Status",
      "Span Type",
      "Has Exception",
      "Span Kind",
      "Span Name",
      "Service Instance",
      "Host Name",
    ]);
    expect(boldNames(sidebar).slice(1)).toEqual(titles);
    // Resource facets (hosts, clusters) sit between Service and Status.
    expect(facets.indexOf("...buildResourceFacetConfigs(")).toBeGreaterThan(
      facets.indexOf('title: "Service",'),
    );
    expect(facets.indexOf("...buildResourceFacetConfigs(")).toBeLessThan(
      facets.indexOf('title: "Status",'),
    );
    /*
     * Span Type is a choice of one whose values are named by
     * Types/Telemetry/TraceSpanType: Root spans among them.
     */
    expect(facets).toContain("chosenValue: spanType,");
    expect(facets).toContain("TRACE_SPAN_TYPE_OPTIONS.map(");
    for (const label of ["Entry spans", "Root spans", "All spans"]) {
      expect(readCommonSource("Types/Telemetry/TraceSpanType.ts")).toContain(
        `label: "${label}",`,
      );
    }
    expect(page).toContain(
      "By default the list shows **Entry spans**, the spans where a request or message enters a service",
    );
    expect(page).toContain(
      "Under **Span Type** in the sidebar, pick **Root spans** to list one row per request, or **All spans** to list every operation.",
    );
  });

  it("opens a span's whole trace from See full trace", () => {
    expect(
      readDashboardSource("Components/Traces/SpanDetailsPanel.tsx"),
    ).toContain("See full trace");
    expect(page).toContain("Click **See full trace** to open its whole trace.");
  });

  it("reads a trace's numbers and views as the trace page draws them", () => {
    const numbers: Array<string> = allMatches(header, LABEL_PROPERTY);

    expect(numbers).toEqual([
      "Duration",
      "Spans",
      "Services",
      "Errors",
      "Depth",
    ]);
    expect(firstColumn(section(page, "## Read a trace"))).toEqual(numbers);
    expect(header).toContain(
      'title="Show only the spans with an error status"',
    );

    const views: string = between(
      traceExplorer,
      '{ value: "waterfall", label: "Waterfall" },',
      "];",
    );
    const viewTable: string = section(page, "## Read a trace").slice(
      section(page, "## Read a trace").indexOf("Below them"),
    );

    expect(allMatches(views, LABEL_PROPERTY)).toEqual([
      "Waterfall",
      "Flame graph",
      "Service map",
      "Operations",
    ]);
    expect(firstColumn(viewTable)).toEqual([
      "Waterfall",
      "Flame graph",
      "Service map",
      "Operations",
    ]);
    expect(traceExplorer).toContain("Critical path");
    expect(traceExplorer).toContain("Errors only");
  });

  it("marks an operation called 10 or more times from one parent, and loads 500 spans at a time", () => {
    expect(
      numberConstant(
        readDashboardSource("Utils/TraceDetailPresentation.ts"),
        "REPEATED_CALL_THRESHOLD",
      ),
    ).toBe(10);
    expect(numberConstant(traceExplorer, "SPAN_PAGE_SIZE")).toBe(500);
    expect(page).toContain(
      "An operation called 10 or more times from one parent span is marked: often an N+1 query or a loop that could be batched.",
    );
    expect(page).toContain("A large trace loads 500 spans at a time.");
  });

  it("names the three performance patterns Fix performance with AI acts on, and when a trace is worth fixing", () => {
    const suggestionCopy: string = readDashboardSource(
      "Components/Traces/TraceDetail/TracePerformanceSuggestionCopy.ts",
    );

    expect(Object.values(PerformanceFindingType).sort()).toEqual(
      ["DominantSpan", "NPlusOneQuery", "SequentialSiblings"].sort(),
    );
    // The button is drawn by the finding strip, no longer by the header.
    expect(suggestionCopy).toContain('"Fix performance with AI"');
    expect(header).not.toContain('title="Fix performance with AI"');

    // The rule the tip states, number for number.
    expect(WORTH_FIXING_MIN_MS).toEqual({
      [PerformanceFindingType.NPlusOneQuery]: 100,
      [PerformanceFindingType.SequentialSiblings]: 100,
      [PerformanceFindingType.DominantSpan]: 500,
    });
    expect(WORTH_FIXING_MIN_PERCENT_OF_TRACE).toBe(10);
    expect(page).toContain(
      "**Fix performance with AI** shows only on a trace worth fixing: one with an N+1 query, calls made one after another that could run in parallel, or one call that takes most of the request, when it costs real time (100 ms or more for the calls together, 500 ms or more for a single call, and at least a tenth of the request).",
    );
  });

  /*
   * A fix for the trace that already did its work is linked, never offered
   * again (FixPerformanceTaskTrigger answers Done, the strip draws it), and
   * what else stops AI - Code's gate, asked by CodeFixStartGate - is said
   * with the step that clears it (the strip draws Code's own notice).
   */
  it("says a trace whose fix did its work links to it, and what else stops AI is said with its fix", () => {
    const suggestionCopy: string = readDashboardSource(
      "Components/Traces/TraceDetail/TracePerformanceSuggestionCopy.ts",
    );
    const strip: string = readDashboardSource(
      "Components/Traces/TraceDetail/TracePerformanceSuggestion.tsx",
    );
    const trigger: string = readCommonSource(
      "Server/Utils/AI/SRE/FixPerformanceTaskTrigger.ts",
    );
    const offer: string = readCommonSource(
      "Utils/Suggestions/SuggestionOffer.ts",
    );

    // Done is an offer, and the trace's own trigger answers it.
    expect(offer).toContain('Done = "Done",');
    expect(trigger).toContain("findFinishedFix");
    expect(trigger).toContain("PERFORMANCE_FIX_ALREADY_DONE_MESSAGE");
    expect(suggestionCopy).toContain('translationKey("View the task")');
    // Code's gate, asked for the run the click would queue, in Code's words.
    expect(trigger).toContain("CodeFixStartGate.check(");
    expect(strip).toContain("<CodeBlockerNotice");
    // The three the page names are what Code's gate says them as.
    const gate: string = readCommonSource(
      "Server/Utils/AI/CodeTask/CodeTaskGate.ts",
    );
    for (const blocker of [
      "CodeTaskBlockerType.PlanRequired",
      "CodeTaskBlockerType.NoAiCredits",
      "getRepositoryRunnerBlocker(",
    ]) {
      expect(gate).toContain(blocker);
    }

    expect(page).toContain(
      "Once a fix for the trace has done its work, the trace links to that fix's task instead of offering a second one. When something else stops AI working, such as the plan, used-up AI credits or no Runner online, the trace says what, with the link that clears it.",
    );
  });

  /*
   * A repository picker for Fix performance with AI: with several
   * repositories connected and none found to hold the trace's code for
   * certain, the suggestion lists them (FixPerformanceTaskTrigger), the
   * strip asks which one holds the code before the fix starts, and the
   * create route refuses a click without the pick.
   */
  it("says a trace no repository was matched to asks which repository holds the code", () => {
    const strip: string = readDashboardSource(
      "Components/Traces/TraceDetail/TracePerformanceSuggestion.tsx",
    );
    const trigger: string = readCommonSource(
      "Server/Utils/AI/SRE/FixPerformanceTaskTrigger.ts",
    );

    expect(page).toContain(
      "With several repositories connected and none matched to the trace's service or code, it first asks which repository holds the code.",
    );
    // Only between two or more, and only when the facts resolve none.
    expect(trigger).toContain("repositories.length > 1 ? repositories : []");
    expect(trigger).toContain("!isRepositoryResolved");
    expect(trigger).toContain("PICK_A_REPOSITORY_FOR_THE_FIX_MESSAGE");
    // The strip asks in the telemetry finding's own words.
    expect(strip).toContain("TELEMETRY_AI_FIX_COPY.pickRepository");
    expect(strip).toContain("needsRepositoryPick");
  });

  it("quotes the finding as the strip words it", () => {
    const suggestionCopy: string = readDashboardSource(
      "Components/Traces/TraceDetail/TracePerformanceSuggestionCopy.ts",
    );

    expect(suggestionCopy).toContain(
      'other: "The same database query ran {{count}} times in {{parent}}",',
    );
    expect(page).toContain(
      'It names what it found, such as "The same database query ran 40 times in ReportService.build", and starts an AI task that opens a pull request to fix it.',
    );
  });

  it("charts span counts, averages, medians and P95s, and analyses requests up to the top 100 groups", () => {
    const chartOptions: string = between(
      viewer,
      '{ value: "count", label: "Count" },',
      "];",
    );
    const analytics: string = readDashboardSource(
      "Components/Traces/TracesAnalyticsView.tsx",
    );

    expect(allMatches(chartOptions, LABEL_PROPERTY)).toEqual([
      "Count",
      "Avg Response Time",
      "Median (P50)",
      "P95",
    ]);
    expect(page).toContain(
      "Pick another measure in the chart's header to plot their average, median (P50) or P95 response time instead.",
    );

    const measures: Array<string> = allMatches(
      between(analytics, '{ value: "count", label: "Request Count" },', "];"),
      LABEL_PROPERTY,
    );

    expect(measures).toEqual([
      "Request Count",
      "Error Count",
      "Avg Response Time",
      "Median Response Time (P50)",
      "P90 Response Time",
      "P95 Response Time",
      "P99 Response Time",
      "Min Response Time",
      "Max Response Time",
    ]);
    expect(page).toContain(
      "measure request counts, error counts or response times (average, P50, P90, P95, P99, minimum or maximum)",
    );

    const limits: Array<number> = numberListConstant(
      analytics,
      "TOP_LIST_LIMITS",
    );

    expect(page).toContain(
      `A top list or a table shows the top ${limits[0]} to ${limits[limits.length - 1]} groups.`,
    );
  });

  it("sums up requests in Insights: P50, P95 and P99, services by error rate, recent failures and the slowest", () => {
    const insights: string = readDashboardSource(
      "Components/Traces/TracesDashboard.tsx",
    );

    for (const card of ["P50 Latency", "P95 Latency", "P99 Latency"]) {
      expect(insights).toContain(`>${card}</p>`);
    }

    expect(insights).toContain(
      "// Sort: highest error rate first, then by total traces",
    );
    expect(insights).toContain("summarizeRecentTraces(sampledSpans)");
    expect(insights).toContain("getSlowestTraces(allTraces, 8)");
    expect(page).toContain(
      "- the number of requests, the error rate, and the P50, P95 and P99 latency;",
    );
    expect(page).toContain(
      "- a health table of your services, sorted by error rate, so the services that need attention come first;",
    );
  });

  it("turns span counts, error counts and durations into metrics every minute", () => {
    const definition: string = readCommonSource(
      "Types/Trace/TraceRecordingRuleDefinition.ts",
    );
    const job: string = readPackageFile(
      "App/FeatureSet/Workers/Jobs/Traces/ComputeTraceRecordingRules.ts",
    );

    expect(definition).toContain("TraceAggregationType.ErrorCount");
    expect(definition).toContain("TraceAggregationType.AvgDurationSeconds");
    expect(job).toContain("schedule: EVERY_MINUTE");
    expect(page).toContain(
      "| **Recording Rules** | Turn span counts, error counts and durations into new metrics, every minute.",
    );
  });

  it("refreshes a trace from the trace page's Refresh button", () => {
    expect(header).toContain('title="Refresh"');
    expect(page).toContain(
      "Click **Refresh** on the trace's page to check again.",
    );
  });
});

describe("Metrics Explorer (telemetry/metrics-explorer)", () => {
  const page: string = english(METRICS_EXPLORER);
  const query: string = readDashboardSource(
    "Components/Metrics/MetricQuery.tsx",
  );
  const queryConfig: string = readDashboardSource(
    "Components/Metrics/MetricQueryConfig.tsx",
  );
  const explorer: string = readDashboardSource(
    "Components/Metrics/MetricExplorer.tsx",
  );

  it("names the explorer's tabs in the order they are drawn, and Settings' two rule pages", () => {
    const tabs: Array<string> = allMatches(
      readDashboardSource("Components/Metrics/MetricsNavTabs.tsx"),
      LABEL_PROPERTY,
    );
    const settingsPages: Array<string> = menuSections(
      readDashboardSource("Pages/Metrics/Settings/SideMenu.tsx"),
    ).flatMap((menuSection: MenuSection): Array<string> => {
      return menuSection.items;
    });

    expect(firstColumn(section(page, "## How the explorer works"))).toEqual(
      tabs,
    );
    expect(settingsPages).toEqual(["Pipeline Rules", "Recording Rules"]);
    expect(page).toContain(
      "| **Settings** | **Pipeline Rules** and **Recording Rules**: what happens to metrics as they arrive. |",
    );

    for (const settingsPage of settingsPages) {
      expect(page).toContain(`**Metrics → Settings → ${settingsPage}**`);
    }
  });

  it("opens the metric list on the past hour", () => {
    expect(
      readDashboardSource("Components/Metrics/MetricsViewer.tsx"),
    ).toContain(
      "let timeRange: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };",
    );
    expect(page).toContain(
      "| **Viewer** | The list of metrics, each with a small chart and its latest value. It opens on the past hour. |",
    );
  });

  it("aggregates by Avg by default, or Sum, Min, Max, Count and five percentiles", () => {
    const types: Array<string> = Object.values(AggregationType);

    expect([...types].sort()).toEqual(
      [
        "Avg",
        "Count",
        "Max",
        "Min",
        "P50",
        "P75",
        "P90",
        "P95",
        "P99",
        "Sum",
      ].sort(),
    );
    expect(query).toContain(
      "DropdownUtil.getDropdownOptionsFromEnum(MetricsAggregationType)",
    );
    expect(query).toContain(
      "props.data.filterData?.aggegationType?.toString() ||\n    MetricsAggregationType.Avg;",
    );
    // A histogram's percentile comes from its buckets.
    expect(readCommonSource("Types/BaseDatabase/AggregationType.ts")).toContain(
      "histogram bucket data",
    );
    expect(page).toContain(
      "Avg, which is the default, Sum, Min, Max, Count, or a percentile, P50, P75, P90, P95 or P99. A percentile of a histogram metric, such as a request duration, is worked out from its buckets.",
    );
  });

  it("names the query's filters, grouping and display settings as the editor draws them", () => {
    for (const text of [
      "Aggregate by",
      "Filters & grouping",
      "Filter by attributes",
      "Group by",
    ]) {
      expect(query).toContain(`translateText("${text}")`);
      expect(page).toContain(`**${text}**`);
    }

    for (const text of [
      "Display Settings",
      "Chart type",
      "Warning Threshold",
      "Critical Threshold",
    ]) {
      expect(queryConfig).toContain(`translateText("${text}")`);
      expect(page).toContain(`**${text}**`);
    }

    for (const toggle of [
      "Convert to per-second rate",
      "Overlay with previous query",
    ]) {
      expect(queryConfig).toContain(`title="${toggle}"`);
      expect(page).toContain(`**${toggle}**`);
    }

    expect(
      allMatches(
        between(queryConfig, "{ value: MetricChartType.LINE", "];"),
        LABEL_PROPERTY,
      ),
    ).toEqual(["Line", "Area", "Bar"]);
    expect(page).toContain("**Chart type** (Line, Area or Bar)");
  });

  it("adds queries and formulas, and reads a formula the way the page writes one", () => {
    const view: string = readDashboardSource(
      "Components/Metrics/MetricView.tsx",
    );

    expect(view).toContain('translateText("Add Metric")');
    expect(view).toContain('translateText("Add Formula")');

    // The page's error rate, its variables written either way.
    for (const formula of [
      "$b / $a * 100",
      "B / A * 100",
      "($b) / ($a) * 100",
    ]) {
      expect({
        formula,
        problem: MetricFormulaEvaluator.validateFormula({
          formula: formula,
          availableVariables: ["a", "b"],
        }),
      }).toEqual({ formula, problem: null });
    }

    // Every operator the page lists.
    expect(
      MetricFormulaEvaluator.validateFormula({
        formula: "(a + b - a) * b / a % b ^ 2",
        availableVariables: ["a", "b"],
      }),
    ).toBeNull();

    // A query that is not defined is named instead of drawn.
    expect(
      MetricFormulaEvaluator.validateFormula({
        formula: "$c / $a",
        availableVariables: ["a", "b"],
      }),
    ).toContain('"$c"');

    expect(page).toContain(
      "the operators `+`, `-`, `*`, `/`, `%` and `^`, and parentheses. For an error rate in percent, write `$b / $a * 100`.",
    );
    expect(page).toContain(
      "A variable can be written with or without its `$`, in any case. A formula that names a query you have not defined says so instead of drawing.",
    );
  });

  it("explores around a chart with the buttons the toolbar draws, and uses a chart from the Actions menu", () => {
    const buttons: Array<string> = firstColumn(
      section(page, "## Explore around a chart"),
    );

    expect(buttons).toEqual([
      "Logs",
      "Traces",
      "Investigate",
      "Events",
      "Compare",
    ]);

    for (const button of buttons) {
      expect(explorer).toContain(`translateText("${button}")`);
    }

    expect(explorer).toContain(
      "Investigate this window in a side panel — logs, traces, exceptions",
    );
    expect(explorer).toContain(
      "Overlay each chart with the previous period (dashed)",
    );
    expect(explorer).toContain('text="Actions"');
    expect(explorer).toContain('text="Create monitor from this view"');
    expect(explorer).toContain('text="Add to dashboard"');
    expect(explorer).toContain('label="Copy Link"');
    expect(page).toContain(
      "- **Actions → Create monitor from this view** opens",
    );
    expect(page).toContain("- **Actions → Add to dashboard** adds the chart");
  });

  it("names the Insights cards", () => {
    const insights: string = readDashboardSource(
      "Components/Metrics/MetricsDashboard.tsx",
    );

    expect(insights).toContain('label="Active metrics"');
    expect(insights).toContain('label="Reporting services"');
    expect(insights).toContain('label="Avg per service"');
    expect(page).toContain(
      "**Active metrics**, **Reporting services** and the average per service.",
    );
  });

  it("lists the pipeline rule types in the create form's order, run in list order with a service's rules first", () => {
    const rules: string = readDashboardSource(
      "Pages/Metrics/Settings/PipelineRules.tsx",
    );
    const cards: Array<string> = allMatches(
      between(rules, "const ruleTypeCardOptions", "];"),
      TITLE_PROPERTY,
    );

    expect(cards).toEqual([...METRIC_PIPELINE_RULE_TYPES]);
    expect(rules).toContain("enableDragAndDrop={true}");
    expect(rules).toContain('dragDropIndexField="sortOrder"');
    expect(
      readPackageFile(
        "App/FeatureSet/Telemetry/Services/MetricPipelineRuleService.ts",
      ),
    ).toContain("Evaluation order: service-scoped rules first");
    expect(page).toContain(
      "Rules run in the order of the list, which you change by dragging; a rule for one service runs before the rules for every service.",
    );
  });

  it("works out recording rules every minute", () => {
    expect(
      readPackageFile(
        "App/FeatureSet/Workers/Jobs/Metrics/ComputeRecordingRules.ts",
      ),
    ).toContain("schedule: EVERY_MINUTE");
    expect(page).toContain(
      "**Metrics → Settings → Recording Rules** works out new metrics from other metrics, every minute.",
    );
  });
});

describe("Exception Tracking (telemetry/exceptions)", () => {
  const page: string = english(EXCEPTIONS);
  const exceptionUtil: string = readPackageFile(
    "App/FeatureSet/Telemetry/Utils/Exception.ts",
  );
  const exceptionsViewer: string = readDashboardSource(
    "Components/Exceptions/ExceptionsViewer.tsx",
  );

  it("finds exceptions in span events, in logs with exception attributes, and in error logs written outside a span", () => {
    const stack: string = "Error: boom\n    at handler (server.js:12:5)";
    const errorLog: (severityNumber: number, inSpan: boolean) => boolean = (
      severityNumber: number,
      inSpan: boolean,
    ): boolean => {
      return (
        LogExceptionExtractor.extractFromLogRecord({
          body: stack,
          attributes: {},
          severityNumber: severityNumber,
          hasTraceAndSpan: inSpan,
        }) !== null
      );
    };

    // Error (17) and Fatal (21) logs with a stack trace, outside a span.
    expect(errorLog(17, false)).toBe(true);
    expect(errorLog(21, false)).toBe(true);
    // Below Error, or inside a span (the span reports it), none.
    expect(errorLog(13, false)).toBe(false);
    expect(errorLog(17, true)).toBe(false);

    // exception.* attributes count at any severity, inside a span too.
    for (const key of [
      "exception.type",
      "exception.message",
      "exception.stacktrace",
    ]) {
      expect({
        key,
        found:
          LogExceptionExtractor.extractFromLogRecord({
            body: "",
            attributes: { [key]: "TypeError" },
            severityNumber: 9,
            hasTraceAndSpan: true,
          }) !== null,
      }).toEqual({ key, found: true });
    }

    expect(
      readPackageFile(
        "App/FeatureSet/Telemetry/Services/OtelTracesIngestService.ts",
      ),
    ).toContain("if (eventName === SpanEventType.Exception) {");
    expect(page).toContain(
      "- a log with the `exception.type`, `exception.message` or `exception.stacktrace` attributes;",
    );
    expect(page).toContain(
      "- a log at Error or Fatal severity whose message holds a stack trace, when the log was not written inside a span (the span reports it already).",
    );
  });

  it("groups occurrences by service, type, message and stack trace, with changing values taken out", () => {
    const fingerprint: string = between(
      exceptionUtil,
      "public static getFingerprint(",
      "return hash;",
    );

    for (const part of [
      "primaryEntityId +",
      "normalizedMessage +",
      "normalizedStackTrace +",
      "type,",
    ]) {
      expect(fingerprint).toContain(part);
    }

    // The page's own example is one exception.
    expect(normalizeExceptionText("Order id=1042 not found")).toBe(
      normalizeExceptionText("Order id=2077 not found"),
    );
    // UUIDs, timestamps, IP and email addresses are taken out.
    expect(
      normalizeExceptionText(
        "user 550e8400-e29b-41d4-a716-446655440000 at 2026-01-02T03:04:05Z from 10.0.0.1 (ana@example.com)",
      ),
    ).toBe(
      normalizeExceptionText(
        "user 6fa459ea-ee8a-3ca4-894e-db77e160355e at 2026-09-08T07:06:05Z from 192.168.1.20 (bo@example.org)",
      ),
    );
    // Numbers of seven digits or more go; shorter ones stay.
    expect(normalizeExceptionText("job 1234567 failed")).toBe(
      normalizeExceptionText("job 7654321 failed"),
    );
    expect(normalizeExceptionText("retry 123456 failed")).not.toBe(
      normalizeExceptionText("retry 654321 failed"),
    );

    expect(page).toContain(
      "The fingerprint is made from the service, the exception type, the message and the stack trace. Values that change from call to call are taken out first: UUIDs and other IDs, timestamps, IP and email addresses, and numbers of seven digits or more. So `Order id=1042 not found` and `Order id=2077 not found` are one exception.",
    );
  });

  it("reopens a resolved exception on a later occurrence as Regressed, and leaves an archived one archived but counted", () => {
    // The statement itself, not the comment above it that names it.
    const update: string = between(
      exceptionUtil,
      'DO UPDATE SET\n          "occuranceCount" =',
      "`;",
    );

    /*
     * Reopened only by an occurrence after the resolve (a late one from
     * before does not), stamped Regressed as it is: the conditions
     * themselves are run on Postgres by ExceptionRegressionPostgres.
     */
    expect(update).toContain('"isResolved" = ${STAYS_RESOLVED_SQL}');
    expect(update).toContain(
      '"regressedAt" = CASE\n            WHEN "TelemetryException"."isResolved" AND NOT ${STAYS_RESOLVED_SQL}\n              THEN now()',
    );
    expect(exceptionUtil).toContain(
      'OR EXCLUDED."lastSeenAt" > "TelemetryException"."markedAsResolvedAt"',
    );
    expect(update).toContain(
      '"occuranceCount" =\n            "TelemetryException"."occuranceCount" + EXCLUDED."occuranceCount"',
    );
    expect(update).not.toContain('"isArchived"');

    // Archived exceptions stop counting towards monitors and new insights.
    expect(
      readPackageFile(
        "App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts",
      ),
    ).toContain(
      "const excludeArchived: boolean = !exceptionMonitorConfig.includeArchived;",
    );

    for (const detector of ["NewExceptionDetector", "ExceptionSpikeDetector"]) {
      expect(
        readCommonSource(
          `Server/Utils/AI/SRE/Insights/Detectors/${detector}.ts`,
        ),
      ).toContain("isArchived: false,");
    }

    expect(page).toContain(
      "**A new occurrence reopens a resolved exception.** If it happens again after you resolved it, the fix did not hold, and the exception is marked **Regressed**. An occurrence from before you resolved it that reaches OneUptime late does not reopen it.",
    );
    expect(page).toContain(
      "**An archived exception stays archived.** Its new occurrences are still counted, but they stop notifying.",
    );
  });

  it("records no exception for an event whose error.class is user-error or expected-denial", () => {
    expect([...NON_ACTIONABLE_ERROR_CLASSES].sort()).toEqual(
      ["expected-denial", "user-error"].sort(),
    );

    for (const errorClass of Object.values(ErrorClass)) {
      expect({
        errorClass,
        dropped: isNonActionableErrorClass(errorClass),
      }).toEqual({
        errorClass,
        dropped: ["user-error", "expected-denial"].includes(errorClass),
      });
    }

    expect(
      readPackageFile(
        "App/FeatureSet/Telemetry/Services/OtelTracesIngestService.ts",
      ),
    ).toContain(
      'if (isNonActionableErrorClass(eventAttributes["error.class"])) {\n              continue;',
    );
    expect(page).toContain(
      "set the `error.class` attribute to `user-error` or `expected-denial` on the span's exception event. OneUptime then records no exception for it.",
    );
  });

  it("counts the unresolved issues on the Exceptions tab, beside Insights, AI and the Setup Guide", () => {
    const tabsSource: string = readDashboardSource(
      "Components/Exceptions/ExceptionsNavTabs.tsx",
    );
    const badge: string = between(tabsSource, "ModelAPI.count({", "});");

    expect(allMatches(tabsSource, LABEL_PROPERTY)).toEqual([
      "Exceptions",
      "Insights",
      "AI",
      "Setup Guide",
    ]);
    expect(badge).toContain("isResolved: false,");
    expect(badge).toContain("isArchived: false,");
    expect(badge).toContain(
      "errorClass: new IncludesNone([...NON_ACTIONABLE_ERROR_CLASSES]),",
    );
    expect(page).toContain(
      "The badge on the **Exceptions** tab counts the unresolved issues, and the list opens on the **Unresolved** exceptions.",
    );
  });

  it("switches status and lens with the options the list draws, and filters by its facets", () => {
    const statuses: Array<string> = allMatches(
      between(
        exceptionsViewer,
        '["unresolved", translationKey("Unresolved")]',
        "] as Array<[ExceptionStatus",
      ),
      TRANSLATION_KEY,
    );

    expect(statuses).toEqual(["Unresolved", "Resolved", "Archived", "All"]);
    expect(page).toContain(
      "Switch between **Unresolved**, **Resolved**, **Archived** and **All**.",
    );

    for (const lens of [
      'translationKey("Issues")',
      'translationKey("User errors")',
    ]) {
      expect(exceptionsViewer).toContain(lens);
    }

    expect(exceptionsViewer).toContain('label: "Unhandled",');
    expect(exceptionsViewer).toContain('label: "Handled",');
    expect(page).toContain(
      "**Issues**, the default, hides user errors and expected denials, so the list shows what needs a fix. **User errors** shows only those, and **All** shows every exception.",
    );

    expect(
      allMatches(
        between(
          exceptionsViewer,
          'title: "Service",',
          'title: "Error Class",',
        ) + 'title: "Error Class",',
        TITLE_PROPERTY,
      ),
    ).toEqual(["Service", "Exception Type", "Environment", "Error Class"]);
    expect(page).toContain(
      "an **Exception Type**, an **Environment** or an **Error Class**.",
    );
  });

  it("describes the exception's own menu, with Settings under a folded Manage", () => {
    const menuSource: string = readDashboardSource(
      "Pages/Exceptions/View/SideMenu.tsx",
    );
    const items: Array<string> = menuSections(menuSource).flatMap(
      (menuSection: MenuSection): Array<string> => {
        return menuSection.items;
      },
    );

    expect(firstColumn(section(page, "## An exception's page"))).toEqual(items);
    expect(sectionByTitle(menuSections(menuSource), "Manage").items).toEqual([
      "Settings",
    ]);
    expect(startsCollapsed(menuSource, "Manage")).toBe(true);
    expect(page).toContain(
      "| **Settings** | Resolve or archive the exception. It is under **Manage**, which starts collapsed. |",
    );
  });

  it("resolves, reopens, archives and unarchives as the header and Settings do", () => {
    const labels: (
      isResolved: boolean,
      isArchived: boolean,
    ) => Array<string> = (
      isResolved: boolean,
      isArchived: boolean,
    ): Array<string> => {
      return getExceptionTriageActions({ isResolved, isArchived }).map(
        (action: ExceptionTriageAction): string => {
          return action.label;
        },
      );
    };

    expect(labels(false, false)).toEqual(["Resolve", "Archive"]);
    expect(labels(true, true)).toEqual(["Reopen", "Unarchive"]);

    // Beside Resolve, while the exception's occurrences name their release.
    const nextRelease: ExceptionTriageAction | null =
      getResolveInNextReleaseAction({
        isResolved: false,
        isArchived: false,
        lastSeenInRelease: "2.3.1",
      });

    expect(nextRelease?.label).toBe("Resolve in next release");
    expect(
      getResolveInNextReleaseAction({ isResolved: false, isArchived: false }),
    ).toBeNull();
    expect(
      firstColumn(section(page, "## Resolve, reopen and archive")),
    ).toEqual([
      "Resolve",
      nextRelease!.label,
      "Reopen",
      "Archive",
      "Unarchive",
    ]);
    expect(page).toContain(
      "**Resolve in next release** is in the menu beside **Resolve**, in the row's ⋯ menu, under **Bulk Actions** and on **Settings**, while the exception's occurrences name their release: the `service.version` resource attribute.",
    );

    const settings: string = readDashboardSource(
      "Components/Exceptions/ExceptionSettings.tsx",
    );

    expect(settings).toContain(
      'buttonLabel: isResolved ? "Mark as Unresolved" : "Mark as Resolved",',
    );
    expect(settings).toContain(
      'buttonLabel: isArchived ? "Unarchive" : "Archive",',
    );
    expect(settings).toContain('translationKey("Resolved by {{name}}")');
    expect(settings).toContain('translationKey("Archived by {{name}}")');
    expect(page).toContain(
      "Its buttons read **Mark as Resolved** or **Mark as Unresolved**, and **Archive** or **Unarchive**.",
    );
  });

  /*
   * The list does what the page does: each row's ⋯ menu has the row's two
   * moves (#5248), and ticked rows take the same four from Bulk Actions,
   * which says what it left alone and why.
   */
  it("changes one exception from its row's ⋯ menu, and several from Bulk Actions", () => {
    const triage: string = section(page, "## Resolve, reopen and archive");
    const viewer: string = readDashboardSource(
      "Components/Exceptions/ExceptionsViewer.tsx",
    );
    const row: string = readDashboardSource(
      "Components/Exceptions/ExceptionRow.tsx",
    );
    const actions: string = readDashboardSource(
      "Components/Exceptions/ExceptionRowActions.ts",
    );
    const telemetryViewer: string = readCommonSource(
      "UI/Components/TelemetryViewer/TelemetryViewer.tsx",
    );

    expect(triage).toContain(
      "The buttons at the top of the exception's page, its **Settings** page and the ⋯ menu on its row in the list change its status:",
    );
    expect(row).toContain("<RowActions<TelemetryException>");
    expect(viewer).toContain("actionButtons={exceptionRowActions}");

    expect(triage).toContain(
      "To change several at once, tick their rows in the list, or the box above the rows for every exception on the page, and use the same actions under **Bulk Actions**. It says which exceptions it changed, which it left as they were, and why.",
    );
    // The rows' boxes and the page's box are the shared list's.
    expect(viewer).toContain("buttons: exceptionBulkActions,");
    expect(telemetryViewer).toContain(
      'translateTemplate("Select all {{itemsName}} on this page"',
    );
    // The same four, in the row's order, each saying why it left one alone.
    expect(actions).toContain("return EXCEPTION_ROW_TRIAGE_ORDER.map(");
    expect(actions).toContain(
      "return bulkItemUnchanged(\n                  getGlobalTranslator().translateText(reason) || reason,",
    );
    expect(actions).toContain(": EXCEPTION_ALREADY_THERE[id];");
  });

  /*
   * Explain it with AI: the Overview's What happened card, its parts and
   * buttons as the card draws them, what OneUptime AI reads to write it, and
   * what is held back from the model.
   */
  it("explains an exception with OneUptime AI on its Overview, from what the page names", () => {
    const card: string = readDashboardSource(
      "Components/Exceptions/ExceptionAIExplanation.tsx",
    );
    const explorer: string = readDashboardSource(
      "Components/Exceptions/ExceptionExplorer.tsx",
    );
    const explainer: string = readCommonSource(
      "Server/Utils/AI/TelemetryAi/ExceptionExplanation.ts",
    );
    const prompt: string = readCommonSource(
      "Server/Utils/AI/TelemetryAi/ExceptionExplanationPrompt.ts",
    );
    const explain: string = section(page, "## Explain it with AI");

    // At the top of the Overview, and only while AI is offered.
    expect(
      between(
        explorer,
        "props.section === ExceptionDetailSection.Overview && (",
        "<ExceptionOccurrenceTrend",
      ),
    ).toContain("<ExceptionAIExplanation");
    expect(card).toContain("const isAiOffered: boolean = useAiOffered();");

    for (const label of [
      '"Explain with OneUptime AI"',
      'title="What happened"',
      '"Likely root cause"',
      '"Suggested fix"',
      '"Where to look"',
      '"Next steps"',
      '"Explain again"',
      'title="Open a fix pull request"',
      'title="Ask a follow-up"',
    ]) {
      expect(card).toContain(label);
    }

    expect(firstColumn(explain)).toEqual([
      "What happened",
      "Likely root cause",
      "Suggested fix",
      "Where to look",
      "Next steps",
    ]);
    expect(explain).toContain(
      "At the top of an exception's **Overview**, **Explain with OneUptime AI** asks OneUptime AI what went wrong.",
    );
    expect(explain).toContain(
      "**Open a fix pull request** opens the exception's **AI Assistance** page, and **Ask a follow-up** opens Ask AI on the exception.",
    );

    // What it reads: the latest occurrence, its trace and logs, the deploys.
    for (const service of [
      "ExceptionInstanceService.findBy",
      "SpanService.findBy",
      "LogService.findBy",
      "ChangeEventService.findBy",
    ]) {
      expect(explainer).toContain(service);
    }
    expect(explain).toContain(
      "It reads the stack trace, the trace and logs of the latest occurrence, and the deploys of the service around the time the exception started",
    );

    // What it holds back, and the switch and credits it honours.
    expect(prompt).toContain('"http.route",');
    expect(prompt).toContain('"http.status_code",');
    expect(prompt).toContain("sanitizeExceptionMessage");
    expect(explainer).toContain("AIService.assertProjectAIEnabled");
    expect(explainer).toContain("AIService.executeWithLogging");
    expect(explain).toContain(
      "IDs, email and IP addresses and tokens are taken out of everything that is sent, and of a span's attributes only a few, such as its route and status code, are sent.",
    );
    expect(explain).toContain(
      "is not offered while **Enable AI** is off. Anyone who can read the exception can ask for one.",
    );

    // Its Markdown is the model's: shown in safe mode.
    expect(card).toContain("safeMode={true}");
  });

  /*
   * Who owns an exception, and the list's order: the header's Assign, a
   * row's Assign to me, Bulk Actions' Assign to…, Assigned to me and the
   * sort menu, with their words as the Dashboard draws them.
   */
  it("assigns an exception to a person or a team, filters to your own, and sorts the list", () => {
    const viewer: string = readDashboardSource(
      "Components/Exceptions/ExceptionsViewer.tsx",
    );
    const actions: string = readDashboardSource(
      "Components/Exceptions/ExceptionRowActions.ts",
    );
    const assignee: string = readDashboardSource(
      "Components/Exceptions/ExceptionAssignee.tsx",
    );
    const assignment: string = readDashboardSource(
      "Utils/ExceptionAssignment.ts",
    );
    const triage: string = section(page, "## Resolve, reopen and archive");

    // The header's picker: one person or one team.
    expect(assignee).toContain('addButtonText="Assign"');
    expect(assignee).toContain("isSinglePick={true}");
    expect(assignee).toContain("PeoplePickerKind.User,");
    expect(assignee).toContain("PeoplePickerKind.Team,");
    expect(actions).toContain('translationKey("Assign to me")');
    expect(actions).toContain('translationKey("Assign to…")');
    expect(triage).toContain(
      "**Assign** in the exception's header gives it to one person or one team, and removing them unassigns it. Each row shows who owns it, its ⋯ menu offers **Assign to me**, and **Assign to…** under **Bulk Actions** assigns several at once.",
    );

    // Assigned to me and the sort menu, beside the lenses.
    expect(viewer).toContain('{translator.translateText("Assigned to me")}');
    expect(viewer).toContain("q.assignToUserId = UserUtil.getUserId();");
    for (const label of ['"Last seen"', '"First seen"', '"Most events"']) {
      expect(assignment).toContain(label);
    }
    expect(page).toContain(
      "**Assigned to me** shows only the exceptions assigned to you, and the sort menu orders the list by **Last seen**, **First seen** or **Most events**.",
    );
  });

  /*
   * Each row's affected users and trend chart: counted over the list's own
   * range, from the user attributes ingest reads, in the order it reads
   * them, and shown only when an occurrence named a user.
   */
  it("shows each row's affected users and its occurrences over the range picked", () => {
    const row: string = readDashboardSource(
      "Components/Exceptions/ExceptionRow.tsx",
    );
    const listStats: string = readDashboardSource(
      "Utils/ExceptionListStats.ts",
    );
    const traces: string = readPackageFile(
      "App/FeatureSet/Telemetry/Services/OtelTracesIngestService.ts",
    );
    const logs: string = readPackageFile(
      "App/FeatureSet/Telemetry/Services/OtelLogsIngestService.ts",
    );
    const users: string =
      "An occurrence names its user with the `user.id`, `enduser.id` or `enduser.pseudo.id` attribute, on the exception event, its span or log record, or its resource; occurrences that name no user are not counted.";

    expect(page).toContain(
      "Each row also shows how many users the exception affected in the time range you picked, and a small chart of its occurrences over that range.",
    );
    expect(page).toContain(users);

    // The attributes named, in the order ingest prefers them.
    expect(inlineCodes(users)).toEqual([...EXCEPTION_USER_ID_ATTRIBUTE_KEYS]);
    // On the exception event, then its span or log record, then its resource.
    expect(
      readExceptionUserId([
        { "enduser.id": "event" },
        { "user.id": "span", "resource.user.id": "resource" },
      ]),
    ).toBe("event");
    expect(
      readExceptionUserId([{}, { "user.id": "span", "resource.user.id": "r" }]),
    ).toBe("span");
    expect(readExceptionUserId([{}, { "resource.enduser.id": "r" }])).toBe("r");
    // An occurrence that names no user is not counted.
    expect(readExceptionUserId([{ "user.email": "a@example.com" }])).toBe("");
    expect(traces).toContain("userId: readExceptionUserId([");
    expect(logs).toContain("userId: readExceptionUserId([finalAttributes])");
    expect(row).toContain("affectedUsers > 0 &&");

    // Over the range picked: the rows' own range goes with the request.
    expect(exceptionsViewer).toContain("setListWindow(readWindow);");
    expect(exceptionsViewer).toContain(
      "buildExceptionListStatsRequest({ exceptions, window: listWindow })",
    );
    expect(listStats).toContain('"/telemetry-exception/list-stats"');
    expect(EXCEPTION_TREND_BUCKET_COUNT).toBeGreaterThan(1);
    expect(row).toContain("<ExceptionTrendSparkline");
  });

  /*
   * Merging a likely duplicate into the exception, and undoing it: offered
   * on the Similar exceptions card for the AI's "Likely the same bug" in the
   * same service, listed on the Overview, undone from either page, and only
   * by someone who may edit exceptions.
   */
  it("merges a likely duplicate into the exception, and unmerges it", () => {
    const similar: string = readDashboardSource(
      "Components/Exceptions/ExceptionSimilar.tsx",
    );
    const panel: string = readDashboardSource(
      "Components/Exceptions/ExceptionMergedPanel.tsx",
    );
    const explorer: string = readDashboardSource(
      "Components/Exceptions/ExceptionExplorer.tsx",
    );
    const merge: string = readCommonSource(
      "Server/Utils/Telemetry/TelemetryExceptionMerge.ts",
    );
    const ingest: string = readPackageFile(
      "App/FeatureSet/Telemetry/Utils/Exception.ts",
    );
    const explain: string = section(page, "## Explain it with AI");

    expect(explain).toContain(
      "Merge one that OneUptime AI calls **Likely the same bug**, in the same service, into this exception with **Merge** beside it: its occurrences, those so far and every new one, count on this exception from then on and show on its page, and it leaves the list.",
    );
    expect(explain).toContain(
      "**Merged into this exception** below lists what was merged in, and **Unmerge** beside each, or on a merged exception's own page, gives it back its own place in the list, its occurrences since included. Merging and unmerging take permission to edit exceptions.",
    );

    // Merge: only on the AI's duplicate, in the same service, for an editor.
    expect(similar).toContain("entry.isSameService === true");
    expect(similar).toContain(
      "verdict?.verdict === DuplicateVerdictKind.Duplicate",
    );
    expect(similar).toContain('title="Merge"');
    expect(explorer).toContain(
      "PermissionGate.check(new TelemetryException(), ModelAction.Update)",
    );
    expect(merge).toContain(
      "Only exceptions of the same service can be merged.",
    );
    expect(merge).toContain("ModelPermission.getUpdatableQuery(");

    // Every new occurrence counts there: the alias is read at ingest.
    expect(ingest).toContain(
      "await ExceptionUtil.withMergedSurvivors(exceptions)",
    );

    // Below, on the Overview, and on the merged one's own page.
    expect(panel).toContain('title="Merged into this exception"');
    expect(panel).toContain('title="Unmerge"');
    expect(panel).toContain(
      'template="This exception was merged into {{exception}}. Its occurrences count there."',
    );
  });

  it("names the five error classes, which ones Issues keeps, and the class an untriaged exception has", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Error classes"),
    );
    const classes: Array<string> = rows.map((row: Array<string>): string => {
      return inlineCodes(row[0] || "")[0] || "";
    });

    expect([...classes].sort()).toEqual([...Object.values(ErrorClass)].sort());

    for (const row of rows) {
      const errorClass: string = inlineCodes(row[0] || "")[0] || "";

      expect({ errorClass, inIssues: row[2] }).toEqual({
        errorClass,
        inIssues: isNonActionableErrorClass(errorClass) ? "No" : "Yes",
      });
    }

    const model: string = readCommonSource(
      "Models/DatabaseModels/TelemetryException.ts",
    );

    expect(model).toContain("default: ErrorClass.Unknown,");
    // Only the AI triage writes a class onto an exception.
    expect(
      readCommonSource("Server/Utils/AI/SRE/Insights/InsightTriageRunner.ts"),
    ).toContain('errorClassSource: "ai",');
    expect(page).toContain("An exception it has not triaged stays `unknown`.");
  });

  it("archives expected denials for you while the AI Insights switch is on", () => {
    const switchDefinition: { column: string; title: string } | undefined =
      AI_INSIGHTS_SWITCHES.find(
        (candidate: { column: string; title: string }): boolean => {
          return candidate.column === "autoArchiveNonActionableExceptions";
        },
      );

    expect(switchDefinition?.title).toBe(
      "Archive exceptions that are expected",
    );
    expect(
      readCommonSource("Server/Utils/AI/SRE/Insights/InsightTriageRunner.ts"),
    ).toContain(
      "classification === ExceptionAIClassification.ExpectedDenial &&\n      project.autoArchiveNonActionableExceptions === true",
    );
    expect(page).toContain(
      "With **Archive exceptions that are expected** on, in the settings of AI Insights, exceptions the triage finds to be expected denials are archived for you.",
    );
  });

  it("offers the three AI tasks with their start button, behind three readiness checks, paused while resolved or archived", () => {
    const titles: Array<string> = EXCEPTION_AI_TASK_TYPES.map(
      (taskType: ExceptionAITaskType): string => {
        return AI_TASK_PRESENTATION[taskType].title;
      },
    );

    expect(firstColumn(section(page, "## Fix it with AI"))).toEqual(titles);
    expect(
      AI_TASK_PRESENTATION[EXCEPTION_AI_TASK_TYPES[0] as ExceptionAITaskType]
        .startActionName,
    ).toBe("Fix with AI");
    expect(page).toContain("Start it with **Fix with AI**.");
    expect(page).toContain(
      `The **AI Assistance** page offers ${NUMBER_WORDS[titles.length]} tasks.`,
    );

    const readiness: string = readCommonSource("Types/AI/AIFixReadiness.ts");

    for (const check of [
      '"llmProvider"',
      '"repositoryResolved"',
      '"agentAvailable"',
    ]) {
      expect(readiness).toContain(check);
    }

    expect(
      readDashboardSource("Components/Exceptions/ExceptionAIAssistance.tsx"),
    ).toContain(
      "const isPaused: boolean = props.isResolved || props.isArchived;",
    );
    expect(page).toContain(
      "AI needs three things first: an LLM provider, a connected repository (on GitHub, GitLab, Forgejo or Gitea, or any Git server), and an AI agent online to run the task.",
    );
    expect(page).toContain(
      "The tasks pause while the exception is resolved or archived.",
    );

    /*
     * Who may start one: the server asks what asking AI to work in the
     * repository asks (assertMayAskForFix), and the card locks its buttons
     * for anyone who may not edit repositories.
     */
    expect(
      readCommonSource("Server/Services/TelemetryExceptionService.ts"),
    ).toContain("mayAsk = await CodeTaskAccess.canAskInRepository({");
    expect(
      readDashboardSource("Components/Exceptions/ExceptionAIAssistance.tsx"),
    ).toContain("new CodeRepository(),");
    expect(page).toContain(
      "Starting a task takes permission to edit the repository it works in: someone who can only read the exception sees its tasks but cannot start one.",
    );
  });

  /*
   * What's new on Insights: OneUptime AI's digest of the last day's new and
   * regressed exceptions, on request, not while AI is off.
   */
  it("offers What's new on Insights, a digest of the last day's new and regressed exceptions", () => {
    const insights: string = readDashboardSource(
      "Components/Exceptions/ExceptionsDashboard.tsx",
    );
    const digest: string = readDashboardSource(
      "Components/Exceptions/ExceptionAIDigest.tsx",
    );

    expect(insights).toContain("<ExceptionAIDigest />");
    expect(digest).toContain('title="What\'s new"');
    expect(digest).toContain(': "Summarize with OneUptime AI"');
    expect(digest).toContain("const isAiOffered: boolean = useAiOffered();");
    expect(EXCEPTION_DIGEST_WINDOW_HOURS).toBe(24);
    expect(page).toContain(
      "**What's new** at the top of the tab asks OneUptime AI, with **Summarize with OneUptime AI**, to sum up the exceptions first seen in the last 24 hours and the ones that came back after they were resolved: a few sentences over all of them, then each in one line, the most urgent first, linked to the exception.",
    );
    expect(page).toContain(
      "It is written when you ask and kept until a new occurrence arrives, so asking again spends nothing; it uses the project's AI credits, and is not offered while **Enable AI** is off.",
    );
  });

  /*
   * Similar exceptions on the Overview, with why each is listed, and
   * OneUptime AI's verdict on each, as the card and the scorer have them.
   */
  it("lists similar exceptions with why, and OneUptime AI's verdict on each", () => {
    const explorer: string = readDashboardSource(
      "Components/Exceptions/ExceptionExplorer.tsx",
    );
    const card: string = readDashboardSource(
      "Components/Exceptions/ExceptionSimilar.tsx",
    );

    // On the Overview, where a likely duplicate can be merged in.
    expect(explorer).toContain(
      "<ExceptionSimilar\n            telemetryExceptionId={props.telemetryExceptionId}\n            canMerge={canMergeIntoThis}",
    );
    expect(card).toContain('title="Similar exceptions"');
    for (const label of [
      '"Same message"',
      '"Same code location"',
      '"Similar message"',
      '"Check with OneUptime AI"',
      '"Likely the same bug"',
      '"A related bug"',
      '"A different bug"',
    ]) {
      expect(card).toContain(label);
    }
    expect(MAX_SIMILAR_EXCEPTIONS).toBe(5);
    // Kept by what it was written from, occurrence counts included.
    const checker: string = readCommonSource(
      "Server/Utils/AI/TelemetryAi/ExceptionDuplicateCheck.ts",
    );
    expect(checker).toContain("AiAnswerCache.key([");
    expect(checker).toContain("String(exception.occuranceCount || 0),");
    expect(page).toContain(
      "Its answer is kept until a new occurrence arrives.",
    );
    expect(page).toContain(
      "Below the cards, **Similar exceptions** lists up to five other exceptions that look like this one: the **Same message** once the values are taken out, the **Same code location** in your code, or a **Similar message** with most of the same words.",
    );
    expect(page).toContain(
      "**Check with OneUptime AI** says of each whether it is **Likely the same bug**, **A related bug** or **A different bug**, and why. The check uses the project's AI credits and is not offered while **Enable AI** is off.",
    );
  });

  it("names the Insights cards and lists", () => {
    const insights: string = readDashboardSource(
      "Components/Exceptions/ExceptionsDashboard.tsx",
    );

    for (const text of [
      'label="Unresolved"',
      'label="Resolved"',
      'label="Archived"',
      'translateText("Resolution rate")',
      'title="Most frequent bugs"',
      'title="Affected services"',
      'title="Recently active"',
    ]) {
      expect(insights).toContain(text);
    }

    expect(page).toContain(
      "The **Insights** tab counts your **Unresolved**, **Resolved** and **Archived** exceptions and your resolution rate, and lists the most frequent exceptions, the services they affect and the ones seen most recently.",
    );
  });
});

describe("the explorers together", () => {
  it("name the roles each signal's model lets read, in order, then its own permission", () => {
    const models: Record<string, Array<Permission>> = {
      [LOGS_EXPLORER]: new Log().accessControl?.read || [],
      [TRACES_EXPLORER]: new Span().accessControl?.read || [],
      [METRICS_EXPLORER]: new Metric().accessControl?.read || [],
      [EXCEPTIONS]: new TelemetryException().readRecordPermissions,
    };

    for (const page of Object.keys(SIGNAL_READ_PERMISSION_TITLES)) {
      const titles: Array<string> = permissionTitles(
        models[page] as Array<Permission>,
      );
      const permission: string = SIGNAL_READ_PERMISSION_TITLES[page] as string;

      expect({ page, titles }).toEqual({
        page,
        titles: [...TELEMETRY_READ_ROLES, permission],
      });
      expect({
        page,
        named: english(page).includes(
          `**A role that reads telemetry.** ${roleSentence([...TELEMETRY_READ_ROLES], permission)}`,
        ),
      }).toEqual({ page, named: true });
    }

    // Resolving and archiving an exception is an update.
    const exception: TelemetryException = new TelemetryException();
    const editors: Array<string> = permissionTitles(
      exception.updateRecordPermissions,
    );
    const editPermission: string = PermissionHelper.getTitle(
      Permission.EditTelemetryException,
    );

    expect(editors).toEqual(["Project Owner", "Project Admin", editPermission]);
    expect(english(EXCEPTIONS)).toContain(
      `Resolving and archiving takes Project Owner or Project Admin, or the ${editPermission} permission.`,
    );
  });

  it("open each explorer from the Observability group of the Products menu", () => {
    expect(navbarValue("categories", "observability")).toBe("Observability");

    for (const [itemKey, page] of [
      ["logsTitle", LOGS_EXPLORER],
      ["tracesTitle", TRACES_EXPLORER],
      ["metricsTitle", METRICS_EXPLORER],
      ["exceptionsTitle", EXCEPTIONS],
    ] as Array<[string, string]>) {
      const product: string = navbarValue("items", itemKey);

      expect({ itemKey, category: productsMenuCategory(itemKey) }).toEqual({
        itemKey,
        category: "observability",
      });
      expect({
        page,
        path: english(page).includes(
          `Go to **Products → Observability → ${product}**.`,
        ),
      }).toEqual({ page, path: true });
    }
  });

  it("keep in English only the words no Dashboard locale has, where the Dashboard draws them so", () => {
    /*
     * Where each is written: a Dashboard source, or (common:) a Common one
     * the Dashboard draws it from - the Span Type choices are named in
     * Types/Telemetry/TraceSpanType.
     */
    const drawnIn: Record<string, string> = {
      "Entry spans": "common:Types/Telemetry/TraceSpanType.ts",
      "Root spans": "common:Types/Telemetry/TraceSpanType.ts",
      "All spans": "common:Types/Telemetry/TraceSpanType.ts",
      "See full trace": "Components/Traces/SpanDetailsPanel.tsx",
      "Critical path": "Components/Traces/TraceExplorer.tsx",
      "Errors only": "Components/Traces/TraceExplorer.tsx",
    };
    const readDrawnIn: (source: string) => string = (
      source: string,
    ): string => {
      return source.startsWith("common:")
        ? readCommonSource(source.substring("common:".length))
        : readDashboardSource(source);
    };

    /*
     * The exception page's start button is a locale key since the
     * Profiler's Fix with AI spelled it out: every language draws it.
     */
    expect("Fix with AI" in DASHBOARD_ENGLISH).toBe(true);
    const kept: Array<string> = Object.values(KEPT_AS_WRITTEN).flat();

    expect([...kept].sort()).toEqual(Object.keys(drawnIn).sort());

    for (const word of kept) {
      expect({ word, isKey: word in DASHBOARD_ENGLISH }).toEqual({
        word,
        isKey: false,
      });
      expect({
        word,
        drawn: readDrawnIn(drawnIn[word] as string).includes(word),
      }).toEqual({ word, drawn: true });
    }
  });
});
