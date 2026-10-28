import {
  ADMIN_DASHBOARD_LABELS,
  DATA_RETENTION,
  DROP_FILTERS_AND_SCRUB_RULES,
  INGESTION_KEYS,
  KEPT_AS_WRITTEN,
  TELEMETRY_ADMIN_PAGES,
  TOPOLOGY,
  TOPOLOGY_READ_ROLES,
  TelemetryAdminDocsPageEntry,
} from "./TelemetryAdminDocsPages";
import { readPage } from "./DocsContentSupport";
import {
  MenuSection,
  PACKAGES_DIR,
  menuSections,
  readCommonSource,
  readDashboardSource,
  sectionByTitle,
  startsCollapsed,
} from "./DocsDashboardMenus";
import { adminDashboardLabel } from "./DocsAdminDashboard";
import { escapeRegExp, navTitle } from "./DocsTranslationChecks";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import LogFilterConfig from "../../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/LogFilterConfig";
import TraceFilterConfig from "../../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/TraceFilterConfig";
import { buildFilterQuery } from "../../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/FilterQueryParser";
import { FilterFieldDefinition } from "../../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/Types";
import {
  SERVICE_STATUS_LABELS,
  ServiceMapEntry,
  ServiceMapModel,
  ServiceMapStatus,
  buildServiceMapModel,
} from "../../../FeatureSet/Dashboard/src/Components/Topology/ServiceMapViewModel";
import {
  TopologyEntity,
  TopologyRelationship,
} from "../../../FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import {
  SERVICE_MAP_TOLERATED_ERROR_RATE,
  healthForErrorRate,
} from "../../../FeatureSet/Dashboard/src/Components/Topology/TopologyMeta";
import {
  compileFilter,
  evaluateCompiledFilter,
} from "../../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import LogDropFilterService, {
  LoadedLogDropFilter,
} from "../../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TelemetryIngest, {
  getEffectiveRequestsPerMinuteLimit,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import Response from "Common/Server/Utils/Response";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitOutcome,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE } from "Common/Server/Services/PayAsYouGoBillingService";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import Project from "Common/Models/DatabaseModels/Project";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TraceDropFilter from "Common/Models/DatabaseModels/TraceDropFilter";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import {
  TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
} from "Common/Types/Billing/PayAsYouGoPricing";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import { JSONObject } from "Common/Types/JSON";
import LogDropFilterAction from "Common/Types/Log/LogDropFilterAction";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS } from "Common/Types/Rum/SessionReplay";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  MAX_SAMPLE_PERCENTAGE,
  MIN_SAMPLE_PERCENTAGE,
  shouldDropBySampling,
} from "Common/Types/Telemetry/DropFilterSampling";
import {
  LOG_SCRUB_RULE_DEFAULTS,
  SCRUB_RULE_REGEX_FLAGS,
  ScrubRegExp,
  TRACE_SCRUB_RULE_DEFAULTS,
} from "Common/Types/Telemetry/ScrubRule";
import TelemetryIngestionKeyPolicy, {
  DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE,
} from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
  IDENTITY_REGISTRATION_SURFACES,
} from "Common/Types/Telemetry/TelemetryIngestSurface";
import TelemetryRetentionConfig, {
  HARDCODED_DEFAULT_TELEMETRY_RETENTION_IN_DAYS,
  resolveTelemetryRetentionInDays,
} from "Common/Types/Telemetry/TelemetryRetentionConfig";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import LogSeverity from "Common/Types/Log/LogSeverity";
import TimeRange from "Common/Types/Time/TimeRange";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import OriginAllowList from "Common/Utils/Telemetry/OriginAllowList";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type below must resolve to the same @types/jest global namespace as the
 * jest.fn()/jest.mock() calls (the StatusPageCertsJobs pattern).
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 38 added four pages the docs never had: Ingestion Keys,
 * Topology, Drop Filters & Scrub Rules and Data Retention. Between them they
 * name a great deal of the product - how a request's key is checked and what
 * each refusal says, what a Browser key may do, every menu, card, button and
 * default of the key, filter, rule and retention pages, the order telemetry
 * goes through as it arrives, what the service map's statuses mean, and
 * which setting decides how long a record is kept.
 *
 * Markdown is not compiled, so nothing else notices when the product moves
 * on. These hold the English pages to the source: the ingest guard is run
 * (its key resolver, responder and rate limiter mocked) on the requests the
 * Troubleshooting table names, the filter evaluator, the drop and scrub
 * engines, the retention resolver and the service map's model are run on
 * the pages' own examples, Common's models and types are imported, and the
 * Dashboard's pages and the ingest services are read as text (an App test
 * must not import the Dashboard's React components). A renamed label, a
 * changed default or a new rule fails here until the English pages follow -
 * and TelemetryAdminDocsTranslations then carries the change into every
 * language.
 *
 * The retention override cards are drawn by the Enterprise Edition (ee/):
 * that half runs where ee/ is checked out, which is the Enterprise Edition
 * Test workflow (.github/workflows/test.ee.yaml).
 */

/*
 * The ingest guard's three collaborators, mocked at the module boundary so
 * a key of any shape can be put in front of the real guard without a
 * database or Redis. The limiter keeps its real outcome enum: the guard
 * compares against it by value.
 */
jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: jest.fn(),
      getProjectIdFromSecretKey: jest.fn(),
      markUsed: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
    },
  };
});

jest.mock(
  "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      default: {
        consume: jest.fn(),
      },
    };
  },
);

type MockFn = jest.Mock;

const REPO_DIR: string = path.resolve(PACKAGES_DIR, "..");
const EE_DIR: string = path.join(REPO_DIR, "ee");

const HEADING_LEVEL: RegExp = /^(#+) /;
const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const INLINE_CODE: RegExp = /`([^`\n]+)`/g;
const TITLE_PROPERTY: RegExp = /title: "([^"]+)"/g;
const LABEL_PROPERTY: RegExp = /label: "([^"]+)"/g;
const NAVBAR_CATEGORY: RegExp = /category: (\w+)Category/;
const RESOURCE_NAME_PROP: RegExp = /resourceName="([^"]+)"/;
const FENCED_TEXT: RegExp = /```text\n([\s\S]*?)\n```/g;
const QUOTED: RegExp = /"([^"]+)"/g;
// A resource's own Topology page, as ResourceTopologyLinks names it.
const RESOURCE_TOPOLOGY_PAGE: RegExp = /page: PageMap\.([A-Z_]+_TOPOLOGY),/g;
// The button on the master map that leads back to a resource's own map.
const RESOURCE_TOPOLOGY_LINK_TEXT: RegExp =
  /linkText: translationKey\("([^"]+)"\)/g;

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

/*
 * The body rows of the first table in a piece of markdown whose header row
 * starts with `firstHeader` ("" for a table whose first header cell is
 * empty), as cells.
 */
function tableRows(
  markdown: string,
  firstHeader: string,
): Array<Array<string>> {
  const lines: Array<string> = markdown.split("\n");
  const headerStart: string = firstHeader ? `| ${firstHeader} |` : "| |";
  const start: number = lines.findIndex((line: string): boolean => {
    return line.startsWith(headerStart);
  });

  expect({ firstHeader, found: start >= 0 }).toEqual({
    firstHeader,
    found: true,
  });

  const rows: Array<Array<string>> = [];

  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) {
      break;
    }

    rows.push(tableCells(line));
  }

  return rows;
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

// The number a `const NAME: number = <expression>;` declaration holds.
function numberConstant(source: string, name: string): number {
  const match: RegExpExecArray | null = new RegExp(
    `const ${escapeRegExp(name)}: number =\\s*([\\d_ *]+);`,
  ).exec(source);

  expect({ name, declared: match !== null }).toEqual({
    name,
    declared: true,
  });

  return (match?.[1] || "")
    .split("*")
    .map((factor: string): number => {
      return Number(factor.split("_").join("").trim());
    })
    .reduce((product: number, factor: number): number => {
      return product * factor;
    }, 1);
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

// A list as a page writes it in prose: "A, B or C".
function writtenList(
  items: ReadonlyArray<string>,
  conjunction: string,
): string {
  if (items.length < 2) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
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

// The Products menu category a navbar item is listed under.
function productsMenuCategory(itemKey: string): string {
  const items: string = readDashboardSource("Utils/NavigationItems.tsx");
  const start: number = items.indexOf(`t("navbar.items.${itemKey}"`);

  expect({ itemKey, listed: start >= 0 }).toEqual({ itemKey, listed: true });

  const entry: string = items.slice(start, items.indexOf("},", start));
  const category: RegExpExecArray | null = NAVBAR_CATEGORY.exec(entry);

  return category?.[1] || "";
}

const SETTINGS_MENU: string = readDashboardSource(
  "Pages/Settings/SideMenu.tsx",
);

/*
 * ---------------------------------------------------------------------
 * The ingest guard, run for real on a key of any shape
 * ---------------------------------------------------------------------
 */

const PROJECT_ID: string = "5d3b0f1a-0000-4000-8000-000000000001";
const INGESTION_KEY_ID: string = "5d3b0f1a-0000-4000-8000-000000000002";
const SECRET: string = "documented-secret-ingestion-key";
const ALLOWED_ORIGIN: string = "https://app.example.com";

function policy(
  overrides: Partial<TelemetryIngestionKeyPolicy>,
): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: new ObjectID(INGESTION_KEY_ID),
    projectId: new ObjectID(PROJECT_ID),
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ...overrides,
  };
}

function browserPolicy(
  overrides: Partial<TelemetryIngestionKeyPolicy>,
): TelemetryIngestionKeyPolicy {
  return policy({
    keyType: TelemetryIngestionKeyType.Browser,
    allowedOrigins: [ALLOWED_ORIGIN],
    ...overrides,
  });
}

interface GuardAnswer {
  // The status the refusal is sent with, or 200 when the request went on.
  status: number;
  message: string;
  retryAfter: string | null;
}

/*
 * What the guard answers a request: the refusal it hands the responder (its
 * exception is the status), or 200 when it calls next().
 */
async function guardAnswer(data: {
  surface: TelemetryIngestSurface;
  headers: Record<string, string>;
  resolvesTo: TelemetryIngestionKeyPolicy | null;
  limited?: boolean;
}): Promise<GuardAnswer> {
  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as MockFn
  ).mockResolvedValue(data.resolvesTo as never);
  (
    TelemetryIngestionKeyService.markUsed as unknown as MockFn
  ).mockResolvedValue(undefined as never);
  (
    TelemetryIngestionKeyRateLimiter.consume as unknown as MockFn
  ).mockResolvedValue(
    (data.limited
      ? {
          outcome: TelemetryIngestionKeyLimitOutcome.RateLimited,
          retryAfterSeconds: 7,
          isFirstRejectionInWindow: true,
        }
      : { outcome: TelemetryIngestionKeyLimitOutcome.Allowed }) as never,
  );

  const headers: Record<string, string> = {};
  const setHeader: MockFn = jest.fn(
    (name: unknown, value: unknown): unknown => {
      headers[String(name)] = String(value);
      return undefined;
    },
  );
  const next: MockFn = jest.fn();
  const req: ExpressRequest = {
    headers: data.headers,
    id: "docs-request",
  } as unknown as ExpressRequest;
  const res: ExpressResponse = { setHeader } as unknown as ExpressResponse;

  await TelemetryIngest.forSurface(data.surface)(
    req,
    res,
    next as unknown as NextFunction,
  );

  const sent: MockFn = Response.sendErrorResponse as unknown as MockFn;

  if (sent.mock.calls.length === 0) {
    expect(next).toHaveBeenCalled();
    return { status: 200, message: "", retryAfter: null };
  }

  const refusal: Exception = sent.mock.calls[0]?.[2] as Exception;

  return {
    status: refusal.code,
    message: refusal.message,
    retryAfter: headers["Retry-After"] || null,
  };
}

const WITH_KEY: Record<string, string> = { "x-oneuptime-token": SECRET };

describe("Ingestion Keys (telemetry/ingestion-keys)", () => {
  const page: string = english(INGESTION_KEYS);
  const listPage: string = readDashboardSource(
    "Pages/Settings/TelemetryIngestionKeys.tsx",
  );
  const keyPage: string = readDashboardSource(
    "Pages/Settings/TelemetryIngestionKeyView.tsx",
  );
  const createForm: string = readDashboardSource(
    "Components/Telemetry/IngestionKeyForm.ts",
  );
  const keyService: string = readCommonSource(
    "Server/Services/TelemetryIngestionKeyService.ts",
  );
  const ingestGuard: string = readCommonSource(
    "Server/Middleware/TelemetryIngest.ts",
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("opens from Project Settings → Telemetry & APM, a section that starts collapsed", () => {
    const telemetry: MenuSection = sectionByTitle(
      menuSections(SETTINGS_MENU),
      "Telemetry & APM",
    );

    expect(telemetry.items).toEqual(["Ingestion Keys", "Data Retention"]);
    expect(startsCollapsed(SETTINGS_MENU, "Telemetry & APM")).toBe(true);
    expect(page).toContain(
      "Go to **Project Settings → Telemetry & APM → Ingestion Keys**. **Telemetry & APM** starts collapsed in the side menu: click it to open it.",
    );
  });

  it("lists keys with the columns the page names, and creates them with Create Ingestion Key", () => {
    const columns: string = between(listPage, "columns={[", "]}\n");

    expect(allMatches(columns, TITLE_PROPERTY)).toEqual([
      "Name",
      "Type",
      "Last Used",
      "Description",
    ]);
    expect(listPage).toContain('singularName="Ingestion Key"');
    expect(listPage).toContain('noValueMessage: "Never",');
    expect(page).toContain(
      "The list shows each key's **Name**, **Type**, **Last Used** and **Description**.",
    );
    expect(page).toContain("Click **Create Ingestion Key**.");
  });

  it("starts a new key as a Server key named after its type, with the steps the page walks", () => {
    expect(createForm).toContain(
      'SERVER_INGESTION_KEY_NAME: string = translationKey("Server key");',
    );
    expect(between(createForm, 'title: "Key Type",', "onChange")).toContain(
      "defaultValue: TelemetryIngestionKeyType.Server,",
    );
    expect(createForm).toContain('{ id: "key", title: "Key" }');
    expect(createForm).toContain('title: "Browser Settings",');
    expect(createForm).toContain('{ id: "billing", title: "Billing" }');

    // The description is folded under Advanced on the first step.
    expect(between(createForm, 'title: "Description",', "},")).toContain(
      "collapsibleSection: advanced,",
    );
    // A Browser key's origins on Browser Settings, its pinned name under Advanced.
    expect(
      between(
        createForm,
        'getAllowedOriginsField({\n            stepId: "browser-settings"',
        "})",
      ),
    ).toContain("showIf: isBrowserIngestionKey");
    expect(
      between(
        createForm,
        'getPinnedServiceNameField({\n            stepId: "browser-settings"',
        "})",
      ),
    ).toContain("collapsibleSection: advanced");

    expect(page).toContain(
      "The dialog starts with the name **Server key** and the **Server** type.",
    );
    expect(page).toContain(
      "A **Browser** key asks for its **Allowed Origins** on the next step, **Browser Settings**, with its **Pinned Service Name** under **Advanced**.",
    );
    expect(page).toContain(
      "The create dialog then ends on a **Billing** step with the pricing.",
    );
  });

  it("opens a new key on its own page, where its secret is", () => {
    expect(listPage).toContain(
      "Navigation.navigate(getIngestionKeyRoute(item));",
    );
    expect(between(keyPage, "secretKey: true,", "isCopyable")).toContain(
      "fieldType: FieldType.HiddenText,",
    );
    expect(
      readCommonSource("UI/Components/HiddenText/HiddenText.tsx"),
    ).toContain('translator.translateText("Click to reveal")');
    expect(page).toContain(
      "The key's own page opens: copy its **Secret Key** and give it to your senders.",
    );
  });

  it("starts every setup guide with Choose an ingestion key", () => {
    const card: string = readDashboardSource(
      "Components/SetupGuide/SetupGuideCard.tsx",
    );
    expect(card).toContain(
      'SETUP_GUIDE_KEY_STEP_TITLE: string = translationKey(\n  "Choose an ingestion key",\n);',
    );
    // Step 1 of every guide, in the reader's language.
    expect(card).toContain("title: translate(SETUP_GUIDE_KEY_STEP_TITLE),");
    expect(page).toContain(
      "Every product's **Setup Guide** starts with **Choose an ingestion key**",
    );
  });

  it("names the roles that manage keys as the model grants them, and none of the Telemetry roles", () => {
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    const create: string = PermissionHelper.getTitle(
      Permission.CreateTelemetryIngestionKey,
    );

    expect(permissionTitles(key.createRecordPermissions)).toEqual([
      "Project Owner",
      "Project Admin",
      create,
    ]);

    for (const role of [
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
    ]) {
      expect({
        role,
        reads: key.readRecordPermissions.includes(role),
        creates: key.createRecordPermissions.includes(role),
      }).toEqual({ role, reads: false, creates: false });
    }

    expect(page).toContain(
      `**A role that manages ingestion keys.** Project Owner or Project Admin, or a custom role with the ${create} permission. The Telemetry roles do not include ingestion keys.`,
    );
  });

  it("asks a project on the Free plan of OneUptime Cloud for a payment method before it creates a key", () => {
    expect(between(keyService, "onBeforeCreate(", "onBeforeDelete(")).toContain(
      "await PayAsYouGoBillingService.requirePayAsYouGo(projectId);",
    );
    expect(ExceptionCode.PaymentRequiredException).toBe(402);
    expect(
      PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE.startsWith("Add a payment method"),
    ).toBe(true);
    expect(page).toContain(
      "| `402` with `Add a payment method` | On OneUptime Cloud, the project is on the Free plan and has no payment method yet. |",
    );
  });

  it("reads the key from x-oneuptime-token first, then the two older headers, over HTTP and gRPC alike", () => {
    const grpcServer: string = readPackageFile(
      "App/FeatureSet/Telemetry/GrpcServer.ts",
    );

    for (const source of [ingestGuard, grpcServer]) {
      const token: number = source.indexOf('"x-oneuptime-token"');
      const service: number = source.indexOf('"x-oneuptime-service-token"');
      const ingestion: number = source.indexOf('"x-oneuptime-ingestion-key"');

      expect(token).toBeGreaterThan(-1);
      expect(service).toBeGreaterThan(token);
      expect(ingestion).toBeGreaterThan(service);
    }

    expect(page).toContain(
      "OneUptime also reads the key from an `x-oneuptime-ingestion-key` or `x-oneuptime-service-token` header, which some older setups send.",
    );
    expect(page).toContain("x-oneuptime-token: YOUR_ONEUPTIME_INGESTION_KEY");
  });

  it("accepts a Browser key only for traces, logs, metrics and session replays", () => {
    expect(Array.from(BROWSER_ALLOWED_INGEST_SURFACES).sort()).toEqual(
      [
        TelemetryIngestSurface.OtelTraces,
        TelemetryIngestSurface.OtelLogs,
        TelemetryIngestSurface.OtelMetrics,
        TelemetryIngestSurface.SessionReplay,
      ].sort(),
    );

    // Every endpoint the page names as refusing a Browser key does.
    for (const surface of [
      TelemetryIngestSurface.Grpc,
      TelemetryIngestSurface.Mqtt,
      TelemetryIngestSurface.OtelProfiles,
      TelemetryIngestSurface.Pyroscope,
      TelemetryIngestSurface.Syslog,
      TelemetryIngestSurface.Fluent,
      TelemetryIngestSurface.SourceMap,
    ]) {
      expect({
        surface,
        browser: BROWSER_ALLOWED_INGEST_SURFACES.has(surface),
      }).toEqual({ surface, browser: false });
    }

    const rows: Array<Array<string>> = tableRows(
      section(page, "## Server or Browser"),
      "",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(["For", "Sends", "A secret", "Origins", "Requests per minute"]);
    expect(rows[1]).toEqual([
      "Sends",
      "Every kind of telemetry, to every endpoint",
      "Traces, logs, metrics and session replays",
    ]);
    expect(page).toContain(
      "OneUptime refuses a Browser key everywhere else, such as over gRPC and MQTT, for profiles, syslog, Fluent Bit and Fluentd, and for source map uploads.",
    );
  });

  it("gives a Browser key 6,000 requests a minute by default and a Server key no limit", () => {
    expect(DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE).toBe(6000);
    expect(
      getEffectiveRequestsPerMinuteLimit(
        policy({}),
        TelemetryIngestSurface.OtelTraces,
      ),
    ).toBeNull();
    expect(
      getEffectiveRequestsPerMinuteLimit(
        browserPolicy({}),
        TelemetryIngestSurface.OtelTraces,
      ),
    ).toBe(DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE);
    // A limit set on a key wins, for a Server key too.
    expect(
      getEffectiveRequestsPerMinuteLimit(
        policy({ requestsPerMinuteLimit: 120 }),
        TelemetryIngestSurface.OtelTraces,
      ),
    ).toBe(120);

    const limit: string =
      DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE.toLocaleString("en-US");

    expect(page).toContain(
      `| Requests per minute | No limit, unless you set one | ${limit}, unless you set another limit |`,
    );
    expect(page).toContain(
      `A Browser key gets ${limit} when you leave it empty.`,
    );
  });

  it("never changes a key's type once it is created", () => {
    expect(
      new TelemetryIngestionKey().getColumnAccessControlFor("keyType")?.update,
    ).toEqual([]);
    expect(keyService).toContain(
      "The key type cannot be changed after the key is created. Create a new ingestion key instead.",
    );
    expect(page).toContain(
      "The type cannot be changed after the key is created.",
    );
  });

  it("holds an origin to its scheme, host and port, with one leading wildcard and exact app identities", () => {
    // The page's own list is one the form and the server accept.
    const example: Array<string> = JSON.parse(
      between(page, "```json\n", "```").slice("```json\n".length),
    ) as Array<string>;

    expect(example).toEqual([
      "https://app.example.com",
      "https://*.example.com",
      "app://com.example.mobile",
    ]);

    for (const origin of example) {
      expect({
        origin,
        problem: OriginAllowList.validateOriginPattern(origin),
      }).toEqual({ origin, problem: null });
    }

    expect(
      OriginAllowList.matches("https://app.example.com:8443", [
        "https://app.example.com",
      ]),
    ).toBe(false);
    expect(
      OriginAllowList.matches("https://shop.example.com", [
        "https://*.example.com",
      ]),
    ).toBe(true);
    expect(
      OriginAllowList.matches("https://example.com", ["https://*.example.com"]),
    ).toBe(false);
    expect(
      OriginAllowList.validateOriginPattern("app://*.example.com"),
    ).not.toBeNull();
    expect(
      OriginAllowList.matches("http://localhost:3000", [
        "https://app.example.com",
      ]),
    ).toBe(false);

    expect(page).toContain(
      "An origin is a scheme, a host and an optional port: `https://app.example.com` does not cover `https://app.example.com:8443`. One leading `*.` covers every subdomain, but not the bare domain itself.",
    );
  });

  it("keeps at least one origin on a Browser key, and checks it on every request", async () => {
    expect(keyService).toContain(
      "A Browser ingestion key must keep at least one allowed origin.",
    );

    const allowed: GuardAnswer = await guardAnswer({
      surface: TelemetryIngestSurface.OtelTraces,
      headers: { ...WITH_KEY, origin: ALLOWED_ORIGIN },
      resolvesTo: browserPolicy({}),
    });

    expect(allowed.status).toBe(200);
  });

  it("files OTLP/HTTP data under a key's Pinned Service Name, and keeps pinned keys away from agent registration", () => {
    const queue: string = readPackageFile(
      "App/FeatureSet/Telemetry/Services/Queue/TelemetryQueueService.ts",
    );

    expect(queue).toContain("ingestionKeyPolicy?.pinnedServiceName");
    expect(queue).toContain("if (isOtelType && pinnedServiceName) {");
    expect(Array.from(IDENTITY_REGISTRATION_SURFACES).sort()).toEqual(
      [
        TelemetryIngestSurface.KubernetesAgentRunner,
        TelemetryIngestSurface.KubernetesAiAgent,
        TelemetryIngestSurface.ResourceAiAgent,
      ].sort(),
    );
    expect(page).toContain(
      "| **Pinned Service Name** | Files everything the key sends over OTLP/HTTP under this one service, whatever `service.name` the sender set.",
    );
    expect(page).toContain(
      "The Kubernetes agent's Runner and AI agent, and the infrastructure AI agents, do not register with a pinned key: give them an unpinned Server key.",
    );
  });

  it("turns a key off on Access & Limits, resets its secret, and deletes it from its page", () => {
    expect(keyPage).toContain(
      '{ title: "Access & Limits", id: "access-and-limits" }',
    );
    expect(between(keyPage, 'title: "Enabled",', "description:")).toContain(
      'stepId: "access-and-limits",',
    );
    expect(keyPage).toContain('text="Disabled — telemetry refused"');
    expect(keyPage).toContain('title={"Reset Secret Key"}');
    expect(keyPage).toContain("<ModelDelete");
    // The card's edit button and the delete card are drawn with the model's name.
    expect(new TelemetryIngestionKey().singularName).toBe(
      "Telemetry Ingestion Key",
    );
    expect(
      readCommonSource("UI/Components/ModelDetail/CardModelDetail.tsx"),
    ).toContain('template: "Edit {{itemName}}",');
    expect(
      readCommonSource("UI/Components/ModelDelete/ModelDelete.tsx"),
    ).toContain('template: "Delete {{itemName}}",');

    const rows: Array<Array<string>> = tableRows(
      section(page, "## Rotate, turn off or delete a key"),
      "To",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[2] as string;
      }),
    ).toEqual([
      "`422` until you turn it back on",
      "`401` until they send the new secret",
      "`401`",
    ]);
    expect(rows[0]?.[1]).toContain(
      "Click **Edit Telemetry Ingestion Key**, open **Access & Limits** and turn **Enabled** off.",
    );
  });

  it("reaches every server within a minute, and records Last Used At every few minutes", () => {
    expect(numberConstant(keyService, "POSITIVE_TTL_MS")).toBe(60 * 1000);
    expect(numberConstant(keyService, "LAST_USED_THROTTLE_MS")).toBe(
      5 * 60 * 1000,
    );
    expect(page).toContain(
      "**Changes reach every server within a minute.** Turning a key off, resetting its secret, or changing its origins, expiry or limit takes effect within about a minute.",
    );
    expect(page).toContain(
      "**Last Used At** is updated every few minutes, not on every request.",
    );
  });

  it("refuses an expiry in the past, so a key cannot be saved already dead", () => {
    expect(keyService).toContain("The expiry date must be in the future.");
    expect(
      between(keyPage, 'title: "Expires At",', "},\n          {"),
    ).toContain("dateShouldBeInTheFuture: true,");
  });

  describe("answers each request the Troubleshooting table names with that status and sentence", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Troubleshooting"),
      "Answer",
    );

    function row(fragment: string): Array<string> {
      const found: Array<string> | undefined = rows.find(
        (candidate: Array<string>): boolean => {
          return (candidate[0] || "").includes(`\`${fragment}\``);
        },
      );

      expect({ fragment, found: Boolean(found) }).toEqual({
        fragment,
        found: true,
      });

      return found as Array<string>;
    }

    // "`401` with `Missing ingestion token`" to [401, "Missing ingestion token"].
    function statusAndFragment(cells: Array<string>): [number, string] {
      const codes: Array<string> = inlineCodes(cells[0] || "");

      return [Number(codes[0]), codes[1] as string];
    }

    it("lists every refusal the guard and the billing check send, and nothing else", () => {
      expect(rows.map(statusAndFragment)).toEqual([
        [401, "Missing ingestion token"],
        [401, "Invalid ingestion token"],
        [401, "This telemetry ingestion key expired."],
        [402, "Add a payment method"],
        [422, "This telemetry ingestion key has been disabled."],
        [422, "A browser ingestion key cannot be used for"],
        [422, "did not send an Origin header"],
        [422, "is not allowed for this browser ingestion key"],
        [422, "is pinned to a single service"],
        [429, "Too many telemetry requests for this ingestion key"],
      ]);
    });

    it.each([
      {
        fragment: "Missing ingestion token",
        request: {
          surface: TelemetryIngestSurface.OtelTraces,
          headers: {},
          resolvesTo: null,
        },
      },
      {
        fragment: "Invalid ingestion token",
        request: {
          surface: TelemetryIngestSurface.OtelTraces,
          headers: WITH_KEY,
          resolvesTo: null,
        },
      },
      {
        fragment: "This telemetry ingestion key expired.",
        request: {
          surface: TelemetryIngestSurface.OtelTraces,
          headers: WITH_KEY,
          resolvesTo: policy({ expiresAt: new Date(Date.now() - 60 * 1000) }),
        },
      },
      {
        fragment: "This telemetry ingestion key has been disabled.",
        request: {
          surface: TelemetryIngestSurface.OtelTraces,
          headers: WITH_KEY,
          resolvesTo: policy({ isEnabled: false }),
        },
      },
      {
        fragment: "A browser ingestion key cannot be used for",
        request: {
          surface: TelemetryIngestSurface.Syslog,
          headers: { ...WITH_KEY, origin: ALLOWED_ORIGIN },
          resolvesTo: browserPolicy({}),
        },
      },
      {
        fragment: "did not send an Origin header",
        request: {
          surface: TelemetryIngestSurface.OtelLogs,
          headers: WITH_KEY,
          resolvesTo: browserPolicy({}),
        },
      },
      {
        fragment: "is not allowed for this browser ingestion key",
        request: {
          surface: TelemetryIngestSurface.OtelMetrics,
          headers: { ...WITH_KEY, origin: "https://elsewhere.example.org" },
          resolvesTo: browserPolicy({}),
        },
      },
      {
        fragment: "is pinned to a single service",
        request: {
          surface: TelemetryIngestSurface.KubernetesAgentRunner,
          headers: WITH_KEY,
          resolvesTo: policy({ pinnedServiceName: "checkout" }),
        },
      },
      {
        fragment: "Too many telemetry requests for this ingestion key",
        request: {
          surface: TelemetryIngestSurface.OtelTraces,
          headers: WITH_KEY,
          resolvesTo: policy({ requestsPerMinuteLimit: 1 }),
          limited: true,
        },
      },
    ])(
      "$fragment",
      async (scenario: {
        fragment: string;
        request: {
          surface: TelemetryIngestSurface;
          headers: Record<string, string>;
          resolvesTo: TelemetryIngestionKeyPolicy | null;
          limited?: boolean;
        };
      }) => {
        const [status] = statusAndFragment(row(scenario.fragment));
        const answer: GuardAnswer = await guardAnswer(scenario.request);

        expect({
          status: answer.status,
          says: answer.message.includes(scenario.fragment),
        }).toEqual({ status, says: true });

        if (status === 429) {
          // Exporters wait as long as the answer says before retrying.
          expect(answer.retryAfter).toBe("7");
        }
      },
    );

    it("names the statuses by the exceptions the guard sends", () => {
      expect(ExceptionCode.NotAuthenticatedException).toBe(401);
      expect(ExceptionCode.NotAuthorizedException).toBe(422);
      expect(ExceptionCode.TooManyRequestsException).toBe(429);
    });
  });
});

describe("Data Retention (telemetry/data-retention)", () => {
  const page: string = english(DATA_RETENTION);
  const settings: string = readDashboardSource(
    "Pages/Settings/TelemetrySettings.tsx",
  );
  const ingest: string = readCommonSource(
    "Server/Services/OpenTelemetryIngestService.ts",
  );

  it("opens from Project Settings → Telemetry & APM → Data Retention", () => {
    expect(
      sectionByTitle(menuSections(SETTINGS_MENU), "Telemetry & APM").items,
    ).toContain("Data Retention");
    expect(page).toContain(
      "Go to **Project Settings → Telemetry & APM → Data Retention**. **Telemetry & APM** starts collapsed in the side menu: click it to open it.",
    );
  });

  it("keeps everything for 15 days until the project's default is changed, on a card of every edition", () => {
    expect(HARDCODED_DEFAULT_TELEMETRY_RETENTION_IN_DAYS).toBe(15);
    expect(
      new Project().getTableColumnMetadata("defaultTelemetryRetentionInDays")
        .title,
    ).toBe("Default Telemetry Data Retention (Days)");
    expect(
      between(
        readCommonSource("Models/DatabaseModels/Project.ts"),
        'title: "Default Telemetry Data Retention (Days)",',
        "public defaultTelemetryRetentionInDays",
      ),
    ).toContain("default: 15,");

    expect(settings).toContain('title: "Telemetry Data Retention",');
    expect(settings).toContain('editButtonText="Edit Retention Settings"');
    expect(settings).toContain('title: "Default Retention (Days)",');
    expect(
      between(
        settings,
        'title: "Default Retention (Days)",',
        "},\n          },",
      ),
    ).toContain("minValue: 1,");
    expect(
      readCommonSource("UI/Components/ModelDetail/CardModelDetail.tsx"),
    ).toContain("submitButtonText={`Save Changes`}");

    expect(page).toContain("then deletes them: 15 days unless you change it.");
    expect(page).toContain(
      "Click **Edit Retention Settings**, enter the number of days, at least 1, and click **Save Changes**.",
    );
  });

  it("lets the Project Owner and Project Admin change the project's retention", () => {
    const editors: Array<Permission> = new Project().getColumnAccessControlFor(
      "defaultTelemetryRetentionInDays",
    )?.update as Array<Permission>;

    expect(permissionTitles(editors)).toEqual([
      "Project Owner",
      "Project Admin",
    ]);
    expect(page).toContain(
      "**A role that changes the project.** Project Owner or Project Admin change the project's retention.",
    );
  });

  it("reads the six settings in the order the table lists them, the first one set deciding", () => {
    const rows: Array<Array<string>> = tableRows(page, "Order");

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(["1", "2", "3", "4", "5", "6"]);

    // Every setting set, each to its own number of days: 1 decides first.
    const serviceConfig: TelemetryRetentionConfig = {
      logs: { default: 2, bySeverity: { [LogSeverity.Error]: 1 } },
    };
    const projectConfig: TelemetryRetentionConfig = {
      logs: { default: 5, bySeverity: { [LogSeverity.Error]: 4 } },
    };
    const everything: Parameters<typeof resolveTelemetryRetentionInDays>[0] = {
      pillar: "logs",
      bucketKey: LogSeverity.Error,
      serviceConfig,
      serviceRetentionInDays: 3,
      projectConfig,
      projectRetentionInDays: 6,
    };

    expect(resolveTelemetryRetentionInDays(everything)).toBe(1);

    // Take each one away in turn, and the next one in the table decides.
    expect(
      resolveTelemetryRetentionInDays({
        ...everything,
        serviceConfig: { logs: { default: 2 } },
      }),
    ).toBe(2);
    expect(
      resolveTelemetryRetentionInDays({ ...everything, serviceConfig: null }),
    ).toBe(3);
    expect(
      resolveTelemetryRetentionInDays({
        ...everything,
        serviceConfig: null,
        serviceRetentionInDays: null,
      }),
    ).toBe(4);
    expect(
      resolveTelemetryRetentionInDays({
        ...everything,
        serviceConfig: null,
        serviceRetentionInDays: null,
        projectConfig: { logs: { default: 5 } },
      }),
    ).toBe(5);
    expect(
      resolveTelemetryRetentionInDays({
        ...everything,
        serviceConfig: null,
        serviceRetentionInDays: null,
        projectConfig: null,
      }),
    ).toBe(6);
    // A span status is a bucket of the traces type, as a log severity is of logs.
    expect(
      resolveTelemetryRetentionInDays({
        pillar: "traces",
        bucketKey: SpanStatus.Error,
        projectConfig: { traces: { byStatus: { [SpanStatus.Error]: 90 } } },
        projectRetentionInDays: 15,
      }),
    ).toBe(90);
  });

  it("applies the overrides only where the Enterprise Edition is active, and sells them with the Scale plan", () => {
    expect(
      between(
        ingest,
        "public static applyRetentionOverrideEdition(",
        "public static",
      ),
    ).toContain("EnterpriseFeature.TelemetryRetention");
    expect(
      readDashboardSource("Enterprise/EnterpriseEligibility.ts"),
    ).toContain(
      "TELEMETRY_RETENTION_REQUIRED_PLAN: EnterpriseRequiredPlan =\n  PlanType.Scale;",
    );
    expect(
      new Project().getColumnBillingAccessControl("telemetryRetentionConfig")
        ?.update,
    ).toBe(PlanType.Scale);
    expect(page).toContain(
      "**Settings 1 to 5 are retention overrides.** They are part of the [Enterprise Edition](/docs/self-hosted/enterprise), and of the Scale plan on OneUptime Cloud. Without them, every record is kept for the project's default.",
    );
  });

  it("stamps a record's retention as it arrives, and picks up a change within five minutes", () => {
    expect(numberConstant(ingest, "PROJECT_RETENTION_CACHE_TTL_SECONDS")).toBe(
      5 * 60,
    );
    expect(numberConstant(ingest, "SERVICE_RESOLUTION_CACHE_TTL_SECONDS")).toBe(
      5 * 60,
    );

    const logs: string = readPackageFile(
      "App/FeatureSet/Telemetry/Services/OtelLogsIngestService.ts",
    );

    expect(logs).toContain("retentionDate: retentionDateDb,");
    expect(page).toContain(
      "**A change applies to new telemetry.** A record keeps the date it was stamped with: a shorter retention does not delete it sooner, and a longer one does not keep it longer. New records follow a change within about five minutes.",
    );
  });

  it("keeps an exception as long as the span or log it came from", () => {
    const traces: string = readPackageFile(
      "App/FeatureSet/Telemetry/Services/OtelTracesIngestService.ts",
    );
    const logs: string = readPackageFile(
      "App/FeatureSet/Telemetry/Services/OtelLogsIngestService.ts",
    );

    // A span's exception resolves its retention as the span does.
    const spanRetention: string = between(
      traces,
      "private static finalizeSpanRow(",
      "private static buildExceptionRow(",
    );
    const exceptionRetention: string = between(
      traces,
      "private static buildExceptionRow(",
      "const attributes: JSONObject",
    );

    for (const part of [spanRetention, exceptionRetention]) {
      expect(part).toContain('pillar: "traces",');
    }

    // A log's exception takes the log's own expiry date.
    expect(logs).toContain("retentionDate: data.retentionDateDb,");
    expect(page).toContain(
      "**Exceptions follow what they were found in.** An exception is kept as long as the span or log it came from.",
    );
  });

  it("names the resources whose Settings page has the two retention cards", () => {
    const pages: Array<string> = [
      "Service",
      "Host",
      "Kubernetes",
      "Docker",
      "Podman",
      "DockerSwarm",
      "Proxmox",
      "Ceph",
      "StorageArray",
      "VMware",
      "Database",
      "Serverless",
      "Cloud",
      "Rum",
      "IoT",
    ];
    /*
     * Each page draws the cards folded under its More settings: through the
     * shared fold (TelemetryResourceMoreSettings), or - a RUM application -
     * the shell inside a fold of its own.
     */
    const names: Array<string> = pages.map((folder: string): string => {
      const settingsPage: string = readDashboardSource(
        `Pages/${folder}/View/Settings.tsx`,
      );
      const drawnBy: string = settingsPage.includes(
        "<TelemetryResourceMoreSettings",
      )
        ? "<TelemetryResourceMoreSettings"
        : "<TelemetryResourceRetentionSettings";

      expect(settingsPage).toContain(drawnBy);

      return (
        RESOURCE_NAME_PROP.exec(between(settingsPage, drawnBy, "/>"))?.[1] || ""
      );
    });

    expect(names).toEqual([
      "service",
      "host",
      "Kubernetes cluster",
      "Docker host",
      "Podman host",
      "Docker Swarm cluster",
      "Proxmox cluster",
      "Ceph cluster",
      "storage array",
      "vCenter",
      "database",
      "serverless function",
      "cloud resource",
      "RUM application",
      "IoT fleet",
    ]);
    expect(page).toContain(
      "Services, hosts, Kubernetes clusters, Docker and Podman hosts, Docker Swarm, Proxmox and Ceph clusters, storage arrays, vCenters, databases, serverless functions, cloud resources, RUM applications and IoT fleets all have these cards.",
    );
    // And says where they wait: folded under the page's More settings.
    expect(page).toContain(
      "Open the service's or resource's **Settings** page, then **More settings**.",
    );
  });

  it("names the Enterprise Edition's override cards and fields as it draws them, where ee/ is checked out", () => {
    // Core CI runs without ee/: the page is held to it wherever ee/ is present.
    if (!fs.existsSync(EE_DIR)) {
      return;
    }

    const read: (relative: string) => string = (relative: string): string => {
      return fs.readFileSync(
        path.join(EE_DIR, "Dashboard/TelemetryRetention", relative),
        "utf8",
      );
    };
    const projectCard: string = read("ProjectTelemetryRetentionByType.tsx");
    const resourceCards: string = read(
      "TelemetryResourceRetentionSettings.tsx",
    );
    const form: string = read("TelemetryRetentionConfigForm.tsx");
    const notice: string = read("TelemetryRetentionLicenseNotice.tsx");

    expect(projectCard).toContain('title: "Retention by Telemetry Type",');
    expect(projectCard).toContain('editButtonText="Edit Overrides"');
    expect(resourceCards).toContain('title: "Telemetry Data Retention",');
    expect(resourceCards).toContain(
      'title: "Retain Telemetry Data For (Days)",',
    );
    expect(resourceCards).toContain('title: "Retention by Telemetry Type",');

    for (const field of [
      "Logs default (days)",
      "Traces default (days)",
      "Metrics default (days)",
      "Profiles default (days)",
    ]) {
      expect({ field, drawn: form.includes(`"${field}"`) }).toEqual({
        field,
        drawn: true,
      });
      expect(page).toContain(`**${field}**`);
    }

    // One field for each log severity, and one for each of the three span statuses.
    expect(form).toContain("LOG_SEVERITIES.map(");
    expect(
      allMatches(between(form, "SPAN_STATUSES", "];"), LABEL_PROPERTY),
    ).toEqual(["Error", "Ok", "Unset"]);
    expect(page).toContain(
      "| Traces | **Traces default (days)**, and one field for each span status: Error, Ok and Unset |",
    );

    expect(notice).toContain(
      "new telemetry is kept for the project's default retention",
    );
    expect(notice).toContain("Nothing configured here is deleted");
  });

  it("lets a Cloud project below the Scale plan remove an override a trial left set", () => {
    const leftover: string = readDashboardSource(
      "Components/TelemetryResource/RetentionOverrideLeftoverCopy.ts",
    );

    expect(leftover).toContain(
      'removeButton: translationKey("Remove Override"),',
    );
    expect(page).toContain(
      "Its page shows it under the upgrade card, with a **Remove Override** button that works on every plan.",
    );
  });

  it("names the other data's own retention: replays, monitor logs and monitor metrics", () => {
    expect(DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS).toBe(7);

    const admin: string = readPackageFile(
      "App/FeatureSet/AdminDashboard/src/Pages/Settings/DataRetention/Index.tsx",
    );

    expect(admin).toContain("Leave empty for 1 day.");
    expect(admin).toContain("Leave empty for 30 days.");

    for (const label of ADMIN_DASHBOARD_LABELS[DATA_RETENTION] || []) {
      expect(admin).toContain(`title: "${label}",`);
      expect(adminDashboardLabel("en", label)).toBe(label);
    }

    const rows: Array<Array<string>> = tableRows(page, "Data");

    expect(
      rows.map((row: Array<string>): string => {
        return row[1] as string;
      }),
    ).toEqual([
      `${DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS} days unless changed`,
      "1 day unless changed",
      "30 days unless changed",
    ]);
  });

  it("bills telemetry on OneUptime Cloud by the GB and the days it is kept, 15 days included", () => {
    expect(TELEMETRY_PRICE_RETENTION_IN_DAYS).toBe(15);
    expect(
      readCommonSource(
        "Server/Types/Billing/MeteredPlan/TelemetryMeteredPlan.ts",
      ),
    ).toContain(
      "this.getBillableRetentionInDays(data.retentionInDays) *\n      this.unitCostInUSD",
    );
    expect(
      readCommonSource("Server/Types/Billing/MeteredPlan/AllMeteredPlans.ts"),
    ).toContain(
      "TELEMETRY_PRICE_IN_USD_PER_GB / TELEMETRY_PRICE_RETENTION_IN_DAYS;",
    );

    const usage: string = readDashboardSource(
      "Pages/Settings/UsageHistory.tsx",
    );

    expect(usage).toContain('title: "Telemetry Usage History",');
    expect(usage).toContain('title: "Data Retention (in Days)",');
    expect(
      sectionByTitle(menuSections(SETTINGS_MENU), "Billing and Invoices").items,
    ).toContain("Usage History");
    expect(page).toContain(
      "telemetry is billed per GB ingested, and the per-GB price includes 15 days of retention. Longer retention costs proportionally more: 30 days costs twice as much per GB as 15. Shorter retention costs proportionally less, but retention under 7 days is billed as 7 days. **Project Settings → Billing and Invoices → Usage History**",
    );
  });

  it("bills logs, traces, metrics and profiles for at least 7 days, and keeps them for the days set", () => {
    expect(TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS).toBe(7);

    const meteredPlan: string = readCommonSource(
      "Server/Types/Billing/MeteredPlan/TelemetryMeteredPlan.ts",
    );

    expect(meteredPlan).toContain(
      "return Math.max(retentionInDays, this.minimumBillableRetentionInDays);",
    );
    // The row keeps the days the telemetry is kept: Usage History shows them.
    expect(
      readCommonSource("Server/Services/TelemetryUsageBillingService.ts"),
    ).toContain("retainTelemetryDataForDays: data.retentionInDays,");

    const plans: string = readCommonSource(
      "Server/Types/Billing/MeteredPlan/AllMeteredPlans.ts",
    );

    for (const productType of [
      "Logs",
      "Metrics",
      "Traces",
      "Profiles",
      "SecurityEvents",
    ]) {
      expect({
        productType,
        // Read as one line: the formatter may wrap the value.
        floored: between(
          plans,
          `productType: ProductType.${productType},`,
          "});",
        )
          .replace(/\s+/g, " ")
          .includes(
            "minimumBillableRetentionInDays: TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS,",
          ),
      }).toEqual({ productType, floored: true });
    }

    // Session replays have a retention of their own, and no minimum.
    expect(
      between(plans, "productType: ProductType.SessionReplay,", "});"),
    ).not.toContain("minimumBillableRetentionInDays");

    // Retention is still set in whole days from 1: only what it costs changes.
    expect(page).toContain(
      "Click **Edit Retention Settings**, enter the number of days, at least 1, and click **Save Changes**.",
    );
    expect(page).toContain(
      `retention under ${TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS} days is billed as ${TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS} days.`,
    );
  });

  it("hides an expired record at once, and frees its disk at the next midnight", () => {
    expect(
      readCommonSource("Server/Services/AnalyticsDatabaseService.ts"),
    ).toContain('return " AND retentionDate >= now()";');

    const ttl: string = readCommonSource(
      "Types/AnalyticsDatabase/RetentionTtl.ts",
    );

    expect(ttl).toContain("toStartOfDay(retentionDate");
    expect(ttl).toContain("+ INTERVAL 1 DAY DELETE");

    for (const model of ["Log", "Metric"]) {
      expect(readCommonSource(`Models/AnalyticsModels/${model}.ts`)).toContain(
        "ttlExpression: RETENTION_TTL_ROUNDED_UP_TO_EVENT_DAY,",
      );
    }

    expect(page).toContain(
      "Expired records stop showing in searches, charts and lists as soon as they expire. On disk, logs and metrics are deleted at the first midnight after that, so their space comes back up to a day later.",
    );
  });
});

describe("Drop Filters & Scrub Rules (telemetry/drop-filters-and-scrub-rules)", () => {
  const page: string = english(DROP_FILTERS_AND_SCRUB_RULES);
  const dropForm: string = readDashboardSource(
    "Components/Telemetry/DropFilterForm.tsx",
  );
  const scrubForm: string = readDashboardSource(
    "Components/Telemetry/ScrubRuleForm.ts",
  );
  const logsIngest: string = readPackageFile(
    "App/FeatureSet/Telemetry/Services/OtelLogsIngestService.ts",
  );
  const tracesIngest: string = readPackageFile(
    "App/FeatureSet/Telemetry/Services/OtelTracesIngestService.ts",
  );

  type GetRegex = (
    patternType: string,
    customRegex?: string,
  ) => ScrubRegExp | null;

  const getRegexForPattern: GetRegex = (
    LogScrubRuleService as unknown as { getRegexForPattern: GetRegex }
  ).getRegexForPattern.bind(LogScrubRuleService);

  // A compiled log scrub rule, as ingest loads one.
  function scrubRule(
    patternType: string,
    action: string,
    fields: string = LogScrubField.Both,
  ): { rule: LogScrubRule; regex: ScrubRegExp } {
    const rule: LogScrubRule = new LogScrubRule();
    rule.patternType = patternType;
    rule.scrubAction = action;
    rule.fieldsToScrub = fields;

    return { rule, regex: getRegexForPattern(patternType) as ScrubRegExp };
  }

  function scrubbedBody(
    body: string,
    rules: Array<{ rule: LogScrubRule; regex: ScrubRegExp }>,
  ): string {
    return LogScrubRuleService.scrubLog(
      { body, attributes: {} },
      rules as never,
    )["body"] as string;
  }

  it("lives under Logs → Settings and Traces → Settings, with Pipelines and Recording Rules", () => {
    for (const [folder, title] of [
      ["Logs", "Log Settings"],
      ["Traces", "Trace Settings"],
    ] as Array<[string, string]>) {
      const menu: string = readDashboardSource(
        `Pages/${folder}/Settings/SideMenu.tsx`,
      );

      expect(sectionByTitle(menuSections(menu), title).items).toEqual([
        "Pipelines",
        "Drop Filters",
        "Scrub Rules",
        "Recording Rules",
      ]);
    }

    expect(page).toContain(
      "Go to **Logs → Settings → Drop Filters**, or **Traces → Settings → Drop Filters** for spans.",
    );
    expect(page).toContain(
      "Go to **Logs → Settings → Scrub Rules**, or **Traces → Settings → Scrub Rules** for spans.",
    );
  });

  it("drops first, then scrubs, then runs pipelines, for logs and spans alike", () => {
    const logOrder: Array<number> = [
      logsIngest.indexOf("LogDropFilterService.shouldDropLog("),
      logsIngest.indexOf("LogScrubRuleService.scrubLog("),
      logsIngest.indexOf("LogPipelineService.processLog("),
    ];
    const spanOrder: Array<number> = [
      tracesIngest.indexOf("TraceDropFilterService.shouldDropSpan("),
      tracesIngest.indexOf("TraceScrubRuleService.scrubSpan("),
      tracesIngest.indexOf("TracePipelineService.processSpan("),
    ];

    for (const order of [logOrder, spanOrder]) {
      expect(order[0]).toBeGreaterThan(-1);
      expect(order).toEqual(
        [...order].sort((a: number, b: number) => {
          return a - b;
        }),
      );
    }

    // Syslog, Fluent Bit and Fluentd logs go through the same three.
    for (const service of ["SyslogIngestService", "FluentLogsIngestService"]) {
      const source: string = readPackageFile(
        `App/FeatureSet/Telemetry/Services/${service}.ts`,
      );

      for (const engine of [
        "LogDropFilterService.loadDropFilters",
        "LogScrubRuleService.loadScrubRules",
        "LogPipelineService.loadPipelines",
      ]) {
        expect({ service, engine, runs: source.includes(engine) }).toEqual({
          service,
          engine,
          runs: true,
        });
      }
    }

    expect(page).toContain(
      "Log drop filters and scrub rules apply to logs from OpenTelemetry, syslog, Fluent Bit and Fluentd alike.",
    );
  });

  it("applies a new or changed rule within a minute, and never to what is stored", () => {
    for (const service of [
      "LogDropFilterService",
      "TraceDropFilterService",
      "LogScrubRuleService",
      "TraceScrubRuleService",
    ]) {
      expect({
        service,
        ttl: numberConstant(
          readPackageFile(`App/FeatureSet/Telemetry/Services/${service}.ts`),
          "CACHE_TTL_MS",
        ),
      }).toEqual({ service, ttl: 60 * 1000 });
    }

    expect(dropForm).toContain(
      'translationKey(\n  "The filter applies to new logs within a minute of being created.",\n)',
    );
    expect(page).toContain(
      "**They act on new records only.** A rule you create or change applies to records that arrive about a minute later. Records already stored are not changed.",
    );
  });

  it("stores nothing of a dropped record: no exception, no bill, nothing for a monitor to read", () => {
    expect(logsIngest).toContain("A drop-filtered log already `continue`d");
    expect(tracesIngest).toContain(
      "Exception rows are only built for spans that survived",
    );

    // Usage is counted from the stored rows, and monitors read stored logs.
    const billing: string = readCommonSource(
      "Server/Services/TelemetryUsageBillingService.ts",
    );

    expect(billing).toContain("SpanService.groupTelemetryUsageByService(");
    expect(billing).toContain("LogService.groupTelemetryUsageByService(");
    expect(
      readPackageFile(
        "App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts",
      ),
    ).toContain("LogService.");
    expect(page).toContain(
      "**A dropped record is gone.** No search, chart, monitor or recording rule ever sees it, and no exception is made from it. On OneUptime Cloud, it is not billed either.",
    );
  });

  it("creates a filter on Match then Action, Drop picked, with the description and Enabled under Advanced", () => {
    expect(dropForm).toContain('{ title: "Match", id: "match" },');
    expect(dropForm).toContain('{ title: "Action", id: "action" },');
    // Action is two plain choices, Drop first, each with its line.
    expect(
      allMatches(
        between(dropForm, "radioButtonOptions: [", "],"),
        TITLE_PROPERTY,
      ),
    ).toEqual(["Drop", "Sample"]);
    expect(
      readDashboardSource("Pages/Logs/Settings/DropFilters.tsx"),
    ).toContain("action: LogDropFilterAction.Drop,");
    expect(MIN_SAMPLE_PERCENTAGE).toBe(1);
    expect(MAX_SAMPLE_PERCENTAGE).toBe(99);

    for (const field of ['title: "Description",', 'title: "Enabled",']) {
      expect(between(dropForm, field, "},")).toContain(
        "collapsibleSection: advanced,",
      );
    }

    // The create button names the table's model, as a table's always does.
    expect(new LogDropFilter().singularName).toBe("Log Drop Filter");
    expect(new TraceDropFilter().singularName).toBe("Trace Drop Filter");
    expect(new LogScrubRule().singularName).toBe("Log Scrub Rule");
    expect(new TraceScrubRule().singularName).toBe("Trace Scrub Rule");

    expect(page).toContain(
      "On **Action**, keep **Drop** to discard every matching record, or pick **Sample** and enter the **Sample Percentage** to keep, from 1 to 99.",
    );
    expect(page).toContain(
      "To save it without dropping anything yet, turn **Enabled** off under **Advanced** before you create it.",
    );
  });

  it("names the fields a filter tests, for logs and for spans, as the builder lists them", () => {
    const labels: (fields: Array<FilterFieldDefinition>) => string = (
      fields: Array<FilterFieldDefinition>,
    ): string => {
      return fields
        .map((field: FilterFieldDefinition): string => {
          return `**${field.label}**`;
        })
        .join(", ");
    };

    expect(page).toContain(`| Logs | ${labels(LogFilterConfig.fields)} |`);
    expect(page).toContain(`| Spans | ${labels(TraceFilterConfig.fields)} |`);
    expect(LogFilterConfig.customAttributeLabel).toBe("Custom Attribute...");
    expect(page).toContain("and any attribute with **Custom Attribute...**:");
  });

  it("names the operators as the builder draws them, and matches the way the page says", () => {
    const condition: string = readDashboardSource(
      "Components/FilterQueryBuilder/FilterCondition.tsx",
    );

    expect(
      allMatches(
        between(condition, "const operatorOptions", "];"),
        LABEL_PROPERTY,
      ),
    ).toEqual(["equals", "does not equal", "contains", "is one of"]);
    expect(
      tableRows(page, "Operator").map((row: Array<string>): string => {
        return unbold(row[0] as string);
      }),
    ).toEqual(["equals", "does not equal", "contains", "is one of"]);

    const matches: (query: string, row: JSONObject) => boolean = (
      query: string,
      row: JSONObject,
    ): boolean => {
      return evaluateCompiledFilter(row, compileFilter(query));
    };

    // equals keeps its case; contains does not, and takes % as a wildcard.
    expect(matches("severityText = 'Debug'", { severityText: "Debug" })).toBe(
      true,
    );
    expect(matches("severityText = 'Debug'", { severityText: "DEBUG" })).toBe(
      false,
    );
    expect(matches("severityText != 'Debug'", { severityText: "Error" })).toBe(
      true,
    );
    expect(
      matches("body LIKE 'healthcheck'", { body: "GET /HealthCheck 200" }),
    ).toBe(true);
    expect(matches("body LIKE 'GET%200'", { body: "GET /health 200" })).toBe(
      true,
    );
    expect(
      matches("severityText IN ('Debug', 'Trace')", { severityText: "Trace" }),
    ).toBe(true);
  });

  it("previews the example's conditions as the query the page shows, which drops a health check's debug lines", () => {
    const query: string = buildFilterQuery(
      [
        { field: "severityText", operator: "=", value: "Debug" },
        { field: "body", operator: "LIKE", value: "healthcheck" },
      ],
      "AND",
      LogFilterConfig,
    );

    expect(query).toBe("severityText = 'Debug' AND body LIKE 'healthcheck'");
    expect(page).toContain(`\`\`\`text\n${query}\n\`\`\``);

    const compiled: ReturnType<typeof compileFilter> = compileFilter(query, {
      emptyQueryMatches: false,
    });

    expect(
      evaluateCompiledFilter(
        { severityText: "Debug", body: "healthcheck ok" },
        compiled,
      ),
    ).toBe(true);
    expect(
      evaluateCompiledFilter(
        { severityText: "Information", body: "healthcheck ok" },
        compiled,
      ),
    ).toBe(false);
  });

  it("samples record by record, and lets a record a sample keeps go on to the next filter", () => {
    // At 10, a record whose draw falls in the first tenth is kept.
    expect(
      shouldDropBySampling(10, () => {
        return 0.05;
      }),
    ).toBe(false);
    expect(
      shouldDropBySampling(10, () => {
        return 0.5;
      }),
    ).toBe(true);

    const filter: (
      action: string,
      percentage?: number,
    ) => LoadedLogDropFilter = (
      action: string,
      percentage?: number,
    ): LoadedLogDropFilter => {
      const dropFilter: LogDropFilter = new LogDropFilter();
      dropFilter.action = action;

      if (percentage !== undefined) {
        dropFilter.samplePercentage = percentage;
      }

      return {
        filter: dropFilter,
        compiledFilter: compileFilter("severityText = 'Debug'", {
          emptyQueryMatches: false,
        }),
        projectId: new ObjectID(PROJECT_ID),
      };
    };

    const random: { mockRestore: () => void } = jest
      .spyOn(Math, "random")
      .mockReturnValue(0);

    try {
      const debugLine: JSONObject = { severityText: "Debug", body: "x" };

      // The sample keeps it, and the drop filter after it drops it.
      expect(
        LogDropFilterService.shouldDropLog(debugLine, [
          filter(LogDropFilterAction.Sample, 50),
          filter(LogDropFilterAction.Drop),
        ]),
      ).toBe(true);
      // The sample alone keeps it.
      expect(
        LogDropFilterService.shouldDropLog(debugLine, [
          filter(LogDropFilterAction.Sample, 50),
        ]),
      ).toBe(false);
    } finally {
      random.mockRestore();
    }

    expect(page).toContain(
      "Filters run in the order of the list, and the first one that drops a record decides; a record a sample keeps goes on to the next filter.",
    );
  });

  it("counts what a filter dropped on the list and on the filter's own page", () => {
    const list: string = readDashboardSource(
      "Pages/Logs/Settings/DropFilters.tsx",
    );
    const view: string = readDashboardSource(
      "Pages/Logs/Settings/DropFilterView.tsx",
    );

    expect(list).toContain('title: "Dropped",');
    expect(list).toContain('title: "Last Dropped",');
    expect(list).toContain('translator.translateText("Nothing dropped yet")');
    expect(view).toContain('title: "Activity",');
    expect(view).toContain(
      "Updated by the ingest pipeline within a minute of a drop.",
    );
    expect(view).toContain('title="Filter Conditions"');
    expect(page).toContain(
      "The **Drop Filters** list shows each filter's **Dropped** count and when it **Last Dropped**. **Nothing dropped yet** means it has never matched. A filter's own page has the same under **Activity**, updated within a minute of a drop.",
    );
  });

  it("lets the Telemetry roles read filters and rules, and only Project Owner, Project Admin or a custom permission change them", () => {
    for (const model of [
      new LogDropFilter(),
      new TraceDropFilter(),
      new LogScrubRule(),
      new TraceScrubRule(),
    ]) {
      for (const role of [
        Permission.TelemetryAdmin,
        Permission.TelemetryMember,
        Permission.TelemetryViewer,
      ]) {
        expect({
          model: model.tableName,
          role,
          reads: model.readRecordPermissions.includes(role),
          creates: model.createRecordPermissions.includes(role),
        }).toEqual({
          model: model.tableName,
          role,
          reads: true,
          creates: false,
        });
      }

      expect(
        permissionTitles(model.createRecordPermissions).slice(0, 2),
      ).toEqual(["Project Owner", "Project Admin"]);
    }

    expect(
      PermissionHelper.getTitle(Permission.CreateProjectLogDropFilter),
    ).toBe("Create Log Drop Filter");
    expect(
      PermissionHelper.getTitle(Permission.CreateProjectTraceScrubRule),
    ).toBe("Create Trace Scrub Rule");
    expect(page).toContain(
      "Project Owner or Project Admin, or a custom role with the permission for what you change, such as Create Log Drop Filter or Create Trace Scrub Rule. The Telemetry roles can see filters and rules, but not change them.",
    );
  });

  it("names the pattern types in the form's order, each finding its example", () => {
    expect(
      allMatches(
        between(scrubForm, 'title: "Pattern Type",', "onChange"),
        LABEL_PROPERTY,
      ),
    ).toEqual(
      tableRows(page, "Pattern Type").map((row: Array<string>): string => {
        return unbold(row[0] as string);
      }),
    );

    const examples: Record<string, Array<string>> = {
      [LogScrubPatternType.Email]: ["jane@example.com"],
      [LogScrubPatternType.CreditCard]: ["4111 1111 1111 1111"],
      [LogScrubPatternType.SSN]: ["123-45-6789"],
      [LogScrubPatternType.PhoneNumber]: ["555-123-4567"],
      [LogScrubPatternType.IPAddress]: ["192.168.1.1"],
    };
    const rows: Array<Array<string>> = tableRows(page, "Pattern Type");

    Object.keys(examples).forEach(
      (patternType: string, index: number): void => {
        const written: Array<string> = inlineCodes(rows[index]?.[1] || "");

        expect({ patternType, written }).toEqual({
          patternType,
          written: examples[patternType],
        });

        for (const example of written) {
          const regex: ScrubRegExp = getRegexForPattern(
            patternType,
          ) as ScrubRegExp;

          expect({
            patternType,
            example,
            whole: regex.replace(example, (): string => {
              return "";
            }),
          }).toEqual({ patternType, example, whole: "" });
        }
      },
    );

    // The keys a sensitive-keys rule catches, whatever their values.
    const keyRegex: ScrubRegExp = getRegexForPattern(
      LogScrubPatternType.SensitiveKeys,
    ) as ScrubRegExp;

    for (const key of inlineCodes(rows[5]?.[1] || "")) {
      expect({ key, caught: keyRegex.test(key) }).toEqual({
        key,
        caught: true,
      });
    }

    // A custom pattern is matched with its case, and only with the g flag.
    expect(SCRUB_RULE_REGEX_FLAGS).toBe("g");
  });

  it("redacts, masks or hashes the example as the page shows, and redacts unless told otherwise", () => {
    expect(LOG_SCRUB_RULE_DEFAULTS.scrubAction).toBe(LogScrubAction.Redact);
    expect(LOG_SCRUB_RULE_DEFAULTS.fieldsToScrub).toBe(LogScrubField.Both);
    expect(TRACE_SCRUB_RULE_DEFAULTS.scrubAction).toBe(LogScrubAction.Redact);
    expect(TRACE_SCRUB_RULE_DEFAULTS.fieldsToScrub).toBe(TraceScrubField.All);
    expect(scrubForm).toContain(
      '[LogScrubPatternType.Email]: translationKey("Scrub email addresses")',
    );

    const blocks: Array<string> = allMatches(page, FENCED_TEXT);
    const before: string = blocks.find((block: string): boolean => {
      return block.startsWith("Payment failed");
    }) as string;
    const after: string = blocks.find((block: string): boolean => {
      return block.startsWith("Redact:");
    }) as string;
    const shown: Record<string, string> = {};

    for (const line of after.split("\n")) {
      const colon: number = line.indexOf(":");

      shown[line.slice(0, colon)] = line.slice(colon + 1).trim();
    }

    expect(before).toBe("Payment failed for jane@example.com");

    for (const [label, action] of [
      ["Redact", LogScrubAction.Redact],
      ["Mask", LogScrubAction.Mask],
      ["Hash", LogScrubAction.Hash],
    ] as Array<[string, string]>) {
      expect({
        label,
        stored: scrubbedBody(before, [
          scrubRule(LogScrubPatternType.Email, action),
        ]),
      }).toEqual({ label, stored: shown[label] });
    }
  });

  it("masks each kind of value the way the Mask row says", () => {
    const mask: (patternType: string, value: string) => string = (
      patternType: string,
      value: string,
    ): string => {
      return scrubbedBody(value, [scrubRule(patternType, LogScrubAction.Mask)]);
    };

    expect(mask(LogScrubPatternType.CreditCard, "4111 1111 1111 1234")).toBe(
      "****-****-****-1234",
    );
    expect(mask(LogScrubPatternType.SSN, "123-45-6789")).toBe("***-**-6789");
    expect(mask(LogScrubPatternType.PhoneNumber, "555-123-4567")).toBe(
      "***-***-4567",
    );
    expect(mask(LogScrubPatternType.IPAddress, "192.168.1.1")).toBe(
      "***.***.***.***",
    );

    // A sensitive value keeps its first and last characters.
    const secret: JSONObject = LogScrubRuleService.scrubLog(
      { body: "", attributes: { api_key: "abcdef" } },
      [
        scrubRule(LogScrubPatternType.SensitiveKeys, LogScrubAction.Mask),
      ] as never,
    );

    expect((secret["attributes"] as JSONObject)["api_key"]).toBe("a****f");
  });

  it("names the fields a rule scrubs, the default first, as the form draws them", () => {
    expect(
      allMatches(
        between(scrubForm, "LOG_SCRUB_RULE_FORM_OPTIONS", "fieldsToScrubHelp"),
        LABEL_PROPERTY,
      ),
    ).toEqual(["Both (Body & Attributes)", "Body Only", "Attributes Only"]);
    expect(
      allMatches(
        between(
          scrubForm,
          "TRACE_SCRUB_RULE_FORM_OPTIONS",
          "fieldsToScrubHelp",
        ),
        LABEL_PROPERTY,
      ),
    ).toEqual([
      "All (Name, Attributes & Events)",
      "Span Name Only",
      "Attributes Only",
      "Event Attributes Only",
    ]);
    expect(page).toContain(
      "**Fields to Scrub** is **Both (Body & Attributes)** for a log rule unless you pick **Body Only** or **Attributes Only**, and **All (Name, Attributes & Events)** for a span rule unless you pick **Span Name Only**, **Attributes Only** or **Event Attributes Only**.",
    );
  });

  it("scrubs exceptions with their records, and session replays with the log rules", () => {
    expect(logsIngest).toContain("so scrubbed secrets never reach the");
    expect(
      readPackageFile(
        "App/FeatureSet/Telemetry/Services/TraceScrubRuleService.ts",
      ),
    ).toContain("public static scrubExceptionContent(");
    expect(
      readPackageFile(
        "App/FeatureSet/Telemetry/Services/SessionReplayScrubService.ts",
      ),
    ).toContain("return await LogScrubRuleService.loadScrubRules(projectId);");
    expect(page).toContain(
      "**Session replays are scrubbed too.** Log scrub rules also run over session replay recordings, behind the masking the recorder does in the browser.",
    );
  });

  it("flags a custom rule that scrubs nothing", () => {
    expect(
      readDashboardSource("Components/Telemetry/ScrubRulePatternPill.tsx"),
    ).toContain('text="Scrubs nothing"');
    expect(page).toContain(
      ":::details A custom scrub rule says Scrubs nothing",
    );
  });
});

describe("Topology (telemetry/topology)", () => {
  const page: string = english(TOPOLOGY);
  const topologyPage: string = readDashboardSource(
    "Pages/Topology/TopologyPage.tsx",
  );
  const serviceMap: string = readDashboardSource(
    "Components/Topology/ServiceMapGraph.tsx",
  );

  const NOW: Date = new Date();

  function entity(key: string, type: string): TopologyEntity {
    return {
      entityKey: key,
      displayName: key,
      entityType: type,
      source: EntitySource.Discovered,
      lastSeenAt: NOW,
    };
  }

  function calls(
    from: string,
    to: string,
    callCount: number,
    errorCount: number,
  ): TopologyRelationship {
    return {
      fromEntityKey: from,
      toEntityKey: to,
      relationshipType: EntityRelationshipType.DependsOn,
      callCount,
      errorCount,
      avgDurationMs: 5,
    };
  }

  it("opens from Products → Observability → Topology, and from Inventory → Topology Map", () => {
    expect(navbarValue("items", "topologyTitle")).toBe("Topology");
    expect(productsMenuCategory("topologyTitle")).toBe("observability");
    expect(
      between(
        readDashboardSource("Pages/Inventory/SideMenu.tsx"),
        'title: "Topology Map",',
        "},",
      ),
    ).toContain("RouteMap[PageMap.TOPOLOGY]");
    expect(page).toContain(
      "Go to **Products → Observability → Topology**. **Inventory → Topology Map** opens the same page.",
    );
  });

  it("names every resource that has a Topology page of its own, and each page is in its side menu", () => {
    expect(page).toContain(
      "A vCenter, a Kubernetes cluster, a host, a Docker or Podman host, a Docker Swarm, Proxmox or Ceph cluster and a storage array each have a **Topology** page of their own.",
    );

    // Each of the nine is a page of the resource, under Topology in its side menu.
    for (const [menu, key] of [
      ["VMware", "VMWARE_VCENTER_VIEW_TOPOLOGY"],
      ["Kubernetes", "KUBERNETES_CLUSTER_VIEW_TOPOLOGY"],
      ["Host", "HOST_VIEW_TOPOLOGY"],
      ["Docker", "DOCKER_HOST_VIEW_TOPOLOGY"],
      ["Podman", "PODMAN_HOST_VIEW_TOPOLOGY"],
      ["DockerSwarm", "DOCKER_SWARM_CLUSTER_VIEW_TOPOLOGY"],
      ["Proxmox", "PROXMOX_CLUSTER_VIEW_TOPOLOGY"],
      ["Ceph", "CEPH_CLUSTER_VIEW_TOPOLOGY"],
      ["StorageArray", "STORAGE_ARRAY_VIEW_TOPOLOGY"],
    ] as Array<[string, string]>) {
      const sideMenu: string = readDashboardSource(
        `Pages/${menu}/View/SideMenu.tsx`,
      );

      expect({ menu, linked: sideMenu.includes(`PageMap.${key}`) }).toEqual({
        menu,
        linked: true,
      });
      expect(between(sideMenu, `PageMap.${key}`, "/>").length).toBeGreaterThan(
        0,
      );
    }

    // The nine are the ones the master map links into, and no others.
    const links: string = readDashboardSource(
      "Components/ResourceTopology/ResourceTopologyLinks.ts",
    );

    expect(allMatches(links, RESOURCE_TOPOLOGY_PAGE).sort()).toEqual(
      [
        "CEPH_CLUSTER_VIEW_TOPOLOGY",
        "DOCKER_HOST_VIEW_TOPOLOGY",
        "DOCKER_SWARM_CLUSTER_VIEW_TOPOLOGY",
        "HOST_VIEW_TOPOLOGY",
        "KUBERNETES_CLUSTER_VIEW_TOPOLOGY",
        "PODMAN_HOST_VIEW_TOPOLOGY",
        "PROXMOX_CLUSTER_VIEW_TOPOLOGY",
        "STORAGE_ARRAY_VIEW_TOPOLOGY",
        "VMWARE_VCENTER_VIEW_TOPOLOGY",
      ].sort(),
    );
  });

  it("names the buttons that narrow a resource's map and lead between the two maps, as the Dashboard draws them", () => {
    const map: string = readDashboardSource(
      "Components/ResourceTopology/ResourceTopologyMap.tsx",
    );
    const panel: string = readDashboardSource(
      "Components/ResourceTopology/ResourceTopologyDetailPanel.tsx",
    );
    const resourcePage: string = readDashboardSource(
      "Components/ResourceTopology/ResourceTopologyPage.tsx",
    );
    const links: string = readDashboardSource(
      "Components/ResourceTopology/ResourceTopologyLinks.ts",
    );

    expect(map).toContain('tx("Needs attention", translator)');
    expect(panel).toContain('tx("Focus on this", translator)');
    expect(resourcePage).toContain('tx("Open in Topology", translator)');
    // The way back: one button per kind of resource, beside View details.
    const backLinks: Array<string> = allMatches(
      links,
      RESOURCE_TOPOLOGY_LINK_TEXT,
    );

    expect(Array.from(new Set<string>(backLinks)).sort()).toEqual(
      [
        "Open cluster topology",
        "Open host topology",
        "Open storage array topology",
        "Open vCenter topology",
      ].sort(),
    );
    expect(page).toContain(
      "**Open in Topology** opens the resource on **Infrastructure**, and its **Open vCenter topology**, **Open cluster topology**, **Open host topology** or **Open storage array topology** button leads back.",
    );
    expect(
      readDashboardSource("Components/Topology/InfrastructureExplorer.tsx"),
    ).toContain("useResourceTopologyLink(scope?.entity || null)");
  });

  it("names the three views, the question each answers, and opens on the Service Map for the past day", () => {
    expect(
      allMatches(between(topologyPage, "const TAB_NAMES", "];"), QUOTED),
    ).toEqual(["Service Map", "Infrastructure", "Network"]);

    const rows: Array<Array<string>> = tableRows(page, "View");

    for (const [view, question] of rows.map(
      (row: Array<string>): [string, string] => {
        return [unbold(row[0] as string), row[1] as string];
      },
    )) {
      expect({
        view,
        drawn: between(
          topologyPage,
          "viewDescriptions",
          "const selectTab",
        ).includes(`description: "${question}"`),
      }).toEqual({ view, drawn: true });
    }

    expect(
      rows.map((row: Array<string>): string => {
        return unbold(row[0] as string);
      }),
    ).toEqual(["Service Map", "Infrastructure", "Network"]);
    expect(topologyPage).toContain("range: TimeRange.PAST_ONE_DAY,");
    expect(TimeRange.PAST_ONE_DAY).toBe("Past 1 Day");
    expect(page).toContain(
      "It opens on the **Service Map**, for the **Past 1 Day**.",
    );
  });

  it("draws only what reported in the range unless Show inactive is on, and keeps the network view live", () => {
    expect(topologyPage).toContain('translateString("Show inactive")');
    expect(topologyPage).toContain(
      'inactive: event.target.checked ? "show" : null,',
    );
    expect(topologyPage).toContain(
      "The network map is live. Device connections refresh automatically.",
    );
    // The time picker is not drawn on the Network view.
    expect(
      between(topologyPage, "{!isNetworkTab && (", "</div>\n        )}"),
    ).toContain("<TelemetryTimeRangePicker");
    expect(topologyPage).toContain(
      'translateString("What is shown · About this data")',
    );
    expect(page).toContain(
      "**Only what was active is drawn.** A view shows the services and resources that reported in the time range, and the connections seen in it. Turn on **Show inactive** to draw the silent ones too.",
    );
  });

  it("finds calls between services every 10 minutes, and counts them over the latest 15", () => {
    const worker: string = readPackageFile(
      "App/FeatureSet/Workers/Jobs/TelemetryEntity/ComputeServiceDependencies.ts",
    );

    expect(worker).toContain(
      'const EVERY_TEN_MINUTES: string = "*/10 * * * *";',
    );
    expect(numberConstant(worker, "WINDOW_MINUTES")).toBe(15);
    expect(numberConstant(topologyPage, "METRICS_WINDOW_SECONDS")).toBe(
      15 * 60,
    );
    expect(page).toContain(
      "OneUptime looks for calls between services every 10 minutes, and the traffic figures cover the latest 15 minutes, not the whole time range.",
    );
  });

  it("gives each service the status the table names, from the share of its calls that failed", () => {
    expect(SERVICE_MAP_TOLERATED_ERROR_RATE).toBe(0.01);
    expect(healthForErrorRate(100, 1, SERVICE_MAP_TOLERATED_ERROR_RATE)).toBe(
      "healthy",
    );
    expect(healthForErrorRate(100, 2, SERVICE_MAP_TOLERATED_ERROR_RATE)).toBe(
      "degraded",
    );
    expect(healthForErrorRate(100, 5, SERVICE_MAP_TOLERATED_ERROR_RATE)).toBe(
      "critical",
    );

    const model: ServiceMapModel = buildServiceMapModel(
      [
        entity("web", EntityType.Service),
        entity("cart", EntityType.Service),
        entity("pay", EntityType.Service),
        entity("auth", EntityType.Service),
        entity("cron", EntityType.Service),
        entity("idle", EntityType.Service),
      ],
      [
        calls("web", "cart", 100, 1),
        calls("web", "pay", 100, 3),
        calls("web", "auth", 100, 5),
        calls("cron", "cart", 0, 0),
      ],
      {},
    );
    const status: (key: string) => ServiceMapStatus = (
      key: string,
    ): ServiceMapStatus => {
      return (model.entryByKey.get(key) as ServiceMapEntry).status;
    };

    expect(status("cart")).toBe("healthy");
    expect(status("pay")).toBe("degraded");
    expect(status("auth")).toBe("critical");
    expect(status("web")).toBe("entry");
    expect(status("idle")).toBe("isolated");
    expect(
      (model.entryByKey.get("pay") as ServiceMapEntry).needsAttention,
    ).toBe(true);

    expect(
      tableRows(page, "Status").map((row: Array<string>): string => {
        return unbold(row[0] as string);
      }),
    ).toEqual([
      SERVICE_STATUS_LABELS.healthy,
      SERVICE_STATUS_LABELS.degraded,
      SERVICE_STATUS_LABELS.critical,
      SERVICE_STATUS_LABELS.entry,
      SERVICE_STATUS_LABELS.isolated,
    ]);
    expect(page).toContain(
      "| **Healthy** | At most 1% of the calls it received failed. |",
    );
    expect(page).toContain(
      "| **Some errors** | More than 1% and less than 5% failed. |",
    );
    expect(page).toContain("| **High error rate** | 5% or more failed. |");
  });

  it("names the service map's controls, panels and table as they are drawn", () => {
    const entityPanel: string = readDashboardSource(
      "Components/Topology/EntityDetailPanel.tsx",
    );
    const edgePanel: string = readDashboardSource(
      "Components/Topology/EdgeDetailPanel.tsx",
    );

    for (const label of [
      "Traces for this service",
      "Inventory details",
      "Active incidents",
      "Active alerts",
    ]) {
      expect({ label, drawn: entityPanel.includes(`t("${label}")`) }).toEqual({
        label,
        drawn: true,
      });
    }

    expect(edgePanel).toContain('translateString("History")');
    expect(edgePanel).toContain(
      "History is available for calls between two instrumented services.",
    );

    for (const label of [
      "Needs attention",
      "Connection labels",
      "On hover",
      "Request rate",
      "Error rate",
      "Average latency",
      "Requests",
      "Avg latency",
      "Connections",
      "Show on map",
    ]) {
      expect({ label, drawn: serviceMap.includes(`t("${label}")`) }).toEqual({
        label,
        drawn: true,
      });
    }

    expect(serviceMap).toContain('t(option === "map" ? "Map" : "Table")');
    expect(page).toContain(
      "**Table** lists the same services with their **Requests**, **Error rate**, **Avg latency** and **Connections**, and **Show on map** draws one of them.",
    );
  });

  it("tells a reader the three ways calls between services are found", () => {
    expect(serviceMap).toContain("(the traceparent header)");
    expect(serviceMap).toContain(
      "Services report client spans for the databases and APIs they call",
    );
    expect(serviceMap).toContain(
      "The OneUptime Kubernetes agent runs with eBPF enabled.",
    );
    expect(page).toContain(
      "It sees one when a request carries trace context, the `traceparent` header, from one instrumented service to the next,",
    );
  });

  it("names the infrastructure and network views' controls as they are drawn", () => {
    const infrastructure: string = readDashboardSource(
      "Components/Topology/InfrastructureExplorer.tsx",
    );
    const network: string = readDashboardSource(
      "Components/Topology/NetworkTopologyExplorer.tsx",
    );
    const toolbar: string = readDashboardSource(
      "Components/Topology/NetworkTopologyToolbar.tsx",
    );

    expect(infrastructure).toContain(
      '{ id: "list", label: "List", icon: IconProp.TableCells },',
    );
    expect(infrastructure).toContain(
      '{ id: "map", label: "Map", icon: IconProp.FlowDiagram },',
    );
    expect(infrastructure).toContain('t("View details")');
    expect(infrastructure).toContain(
      "Where your services run. Replicas of one workload are grouped; open anything to look inside.",
    );
    expect(network).toContain('devices: "All devices"');
    expect(toolbar).toContain('translateString("Map options")');
    expect(
      readDashboardSource("Components/Topology/NetworkTopologyLiveView.tsx"),
    ).toContain("Export PDF");
    expect(page).toContain(
      "**Map options** arranges the map and picks what it includes, and **Export PDF** saves the map you see.",
    );
  });

  it("names the roles that read the map as the inventory grants them, which the Topology API checks", () => {
    const api: string = readPackageFile(
      "App/FeatureSet/BaseAPI/API/Topology.ts",
    );

    expect(api).toContain(
      "await ModelPermission.checkReadQueryPermission<InventoryItem>(",
    );

    const permission: string = PermissionHelper.getTitle(
      Permission.ReadTelemetryService,
    );

    expect(permissionTitles(new InventoryItem().readRecordPermissions)).toEqual(
      [...TOPOLOGY_READ_ROLES, permission],
    );
    expect(page).toContain(
      `**A role that reads telemetry.** ${writtenList(TOPOLOGY_READ_ROLES, "or")}, or a custom role with the ${permission} permission.`,
    );
  });
});

describe("the four pages together", () => {
  it.each(TELEMETRY_ADMIN_PAGES)(
    "$page has a nav title in every docs locale",
    (entry: TelemetryAdminDocsPageEntry) => {
      expect(navTitle("en", entry.navTitle)).toBe(entry.navTitle);

      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const title: unknown = navTitle(language, entry.navTitle);

        expect({
          language,
          titled: typeof title === "string" && title.trim().length > 0,
        }).toEqual({ language, titled: true });
      }
    },
  );

  it("keep in English only the labels no Dashboard locale has, where the Dashboard draws them so", () => {
    const drawnIn: Record<string, string> = {
      "Service Map": "Pages/Topology/TopologyPage.tsx",
      "Some errors": "Components/Topology/ServiceMapViewModel.ts",
      "High error rate": "Components/Topology/ServiceMapViewModel.ts",
      "Entry point": "Components/Topology/ServiceMapViewModel.ts",
      "No calls observed": "Components/Topology/ServiceMapViewModel.ts",
    };
    const keptOnTopology: Array<string> = [
      ...(KEPT_AS_WRITTEN[TOPOLOGY] || []),
    ];

    expect([...keptOnTopology].sort()).toEqual(Object.keys(drawnIn).sort());

    for (const word of [
      ...keptOnTopology,
      ...(KEPT_AS_WRITTEN[DATA_RETENTION] || []),
    ]) {
      expect({ word, isKey: word in DASHBOARD_ENGLISH }).toEqual({
        word,
        isKey: false,
      });
    }

    for (const word of keptOnTopology) {
      expect({
        word,
        drawn: readDashboardSource(drawnIn[word] as string).includes(
          `"${word}"`,
        ),
      }).toEqual({ word, drawn: true });
    }
  });

  it("name the menus they open from in bold, as one path", () => {
    const paths: Record<string, Array<string>> = {
      [INGESTION_KEYS]: ["Project Settings → Telemetry & APM → Ingestion Keys"],
      [DATA_RETENTION]: [
        "Project Settings → Telemetry & APM → Data Retention",
        "Project Settings → Billing and Invoices → Usage History",
      ],
      [DROP_FILTERS_AND_SCRUB_RULES]: [
        "Logs → Settings → Drop Filters",
        "Traces → Settings → Drop Filters",
        "Logs → Settings → Scrub Rules",
        "Traces → Settings → Scrub Rules",
      ],
      [TOPOLOGY]: [
        "Products → Observability → Topology",
        "Inventory → Topology Map",
      ],
    };

    for (const entry of TELEMETRY_ADMIN_PAGES) {
      const named: Array<string> = boldNames(english(entry.page));

      for (const menuPath of paths[entry.page] || []) {
        expect({
          page: entry.page,
          menuPath,
          named: named.includes(menuPath),
        }).toEqual({
          page: entry.page,
          menuPath,
          named: true,
        });
      }
    }
  });
});
