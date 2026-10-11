import {
  DocsFence,
  DocsHeading,
  readPage,
  scanPage,
} from "./DocsContentSupport";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import StatusPageAPI from "Common/Server/API/StatusPageAPI";
import GzipRequestBodyMiddleware from "Common/Server/Middleware/GzipRequestBody";
import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import PayAsYouGoBillingService, {
  PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
} from "Common/Server/Services/PayAsYouGoBillingService";
import StatusPageDomainService from "Common/Server/Services/StatusPageDomainService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import {
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import {
  expressErrorHandler,
  jsonBodyParserOptions,
} from "Common/Server/Utils/StartServer";
import StatusPageOverviewCache from "Common/Server/Utils/StatusPage/StatusPageOverviewCache";
import LogExceptionExtractor, {
  ExtractedLogException,
} from "Common/Server/Utils/Telemetry/LogExceptionExtractor";
import { AttributeType } from "Common/Server/Utils/Telemetry/Telemetry";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import Color from "Common/Types/Color";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import ForbiddenException from "Common/Types/Exception/ForbiddenException";
import MasterPasswordRequiredException from "Common/Types/Exception/MasterPasswordRequiredException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import { STATUS_PAGE_NOT_FOUND_MESSAGE } from "Common/Types/StatusPage/StatusPageArchive";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
} from "Common/Types/Telemetry/TelemetryIngestSurface";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import ts from "typescript";
import zlib from "zlib";
import StatusPageDisplaySettingsCopy, {
  DISPLAY_DAYS_SENTENCE,
  DISPLAY_SECTIONS,
  DisplaySectionDefinition,
} from "../../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCopy";
import FluentAPI from "../../../FeatureSet/Telemetry/API/Fluent";
import OTelIngestAPI from "../../../FeatureSet/Telemetry/API/OTelIngest";
import SyslogAPI from "../../../FeatureSet/Telemetry/API/Syslog";
import FluentLogsIngestService from "../../../FeatureSet/Telemetry/Services/FluentLogsIngestService";
import SyslogQueueService from "../../../FeatureSet/Telemetry/Services/Queue/SyslogQueueService";
import SyslogIngestService from "../../../FeatureSet/Telemetry/Services/SyslogIngestService";
import {
  ParsedSyslogMessage,
  parseSyslogMessage,
} from "../../../FeatureSet/Telemetry/Utils/SyslogParser";

/*
 * Docs overhaul task 12: what the English Serilog, Fluent Bit, Fluentd,
 * Syslog and status page Public API pages say the product does, each fact
 * held to the code that makes it true - the ingest guard, the ingest routes
 * and services, the ingress, the status page API and its access check - so a
 * page fails HERE when the product changes under it. The translations say the
 * same things in the English pages' shape
 * (LogShipperAndPublicApiDocsTranslations), so these facts hold for every
 * language.
 *
 * Pure modules and services are imported and run, with the database and the
 * queue left out (a service's own lookups are stubbed). React views cannot be
 * imported into App's tests, so a Dashboard view is read as text and only its
 * literal titles and defaults are compared. Facts other suites already hold
 * are left to them: the OTLP responses, key settings and log exception
 * detection (OpenTelemetryDocsFacts), which incidents a page lists
 * (OneStatusPagePerAudienceDocs), and who can see a status page
 * (StatusPageAccessDocs).
 */

/*
 * The ingest services pull in the per-signal queue services, which load
 * BullMQ at import time. Nothing queue-side runs here: the one queue call the
 * Syslog page describes is stubbed where it is checked.
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

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function readSource(relativeToPackages: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativeToPackages), "utf8");
}

function dashboardSource(relative: string): string {
  return readSource(path.join("App/FeatureSet/Dashboard/src", relative));
}

// Source text with every run of whitespace as one space, to read across lines.
const WHITESPACE_RUN: RegExp = /\s+/g;

function oneLine(text: string): string {
  return text.replace(WHITESPACE_RUN, " ");
}

const SERILOG: string = "telemetry/serilog";
const FLUENT_BIT: string = "telemetry/fluentbit";
const FLUENTD: string = "telemetry/fluentd";
const SYSLOG: string = "telemetry/syslog";
const PUBLIC_API: string = "status-pages/public-api";

// The pages that walk a reader through making an ingestion key.
const KEY_STEP_PAGES: Array<string> = [SERILOG, FLUENT_BIT, FLUENTD];

// The pages whose Troubleshooting answers 401, 402 and 422.
const SHIPPER_PAGES: Array<string> = [SERILOG, FLUENT_BIT, FLUENTD, SYSLOG];

// The ingest surface each shipper page's data arrives on.
const SURFACE_OF_PAGE: Record<string, TelemetryIngestSurface> = {
  [SERILOG]: TelemetryIngestSurface.OtelLogs,
  [FLUENT_BIT]: TelemetryIngestSurface.OtelLogs,
  [FLUENTD]: TelemetryIngestSurface.Fluent,
  [SYSLOG]: TelemetryIngestSurface.Syslog,
};

function englishPage(page: string): string {
  return readPage("en", page);
}

// The rows of the Markdown table whose header row is `header`.
function tableAfter(page: string, header: string): Array<Array<string>> {
  const lines: Array<string> = englishPage(page).split("\n");
  const start: number = lines.indexOf(header);

  expect({ page, header, found: start >= 0 }).toEqual({
    page,
    header,
    found: true,
  });

  const rows: Array<Array<string>> = [];

  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) {
      break;
    }

    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows;
}

const INLINE_CODE_SPAN: RegExp = /`([^`]+)`/g;

// The inline code spans of a piece of Markdown, in order.
function codeSpans(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(INLINE_CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The page's fenced code blocks, Mermaid diagrams left out.
function codeBlocks(page: string): Array<DocsFence> {
  return scanPage("en", page).fences.filter((fence: DocsFence): boolean => {
    return fence.lang !== "mermaid";
  });
}

// The one code block whose info string says this title.
function codeBlockTitled(page: string, title: string): Array<DocsFence> {
  return codeBlocks(page).filter((fence: DocsFence): boolean => {
    return fence.info.includes(`title="${title}"`);
  });
}

// The page's Mermaid diagram.
function diagram(page: string): string {
  const fences: Array<DocsFence> = scanPage("en", page).fences.filter(
    (fence: DocsFence): boolean => {
      return fence.lang === "mermaid";
    },
  );

  expect({ page, diagrams: fences.length }).toEqual({ page, diagrams: 1 });

  return (fences[0] as DocsFence).code;
}

// The text of a `:::details` answer whose title contains `title`.
function detailsAnswer(page: string, title: string): string {
  const lines: Array<string> = englishPage(page).split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.startsWith(":::details ") && line.includes(title);
  });

  expect({ page, title, found: start >= 0 }).toEqual({
    page,
    title,
    found: true,
  });

  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    if (line.trim() === ":::") {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

const BOLD_SPAN: RegExp = /\*\*([^*]+)\*\*/g;

// The bold spans of a piece of Markdown, in order.
function boldSpans(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(BOLD_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

const PATH_SEPARATOR: string = " → ";

// Every bold menu path a page names, as its parts: "Products → Logs".
function menuPaths(page: string): Array<Array<string>> {
  return boldSpans(englishPage(page))
    .filter((span: string): boolean => {
      return span.includes(PATH_SEPARATOR);
    })
    .map((span: string): Array<string> => {
      return span.split(PATH_SEPARATOR);
    });
}

/*
 * The side menu sections and items a Dashboard SideMenu draws, as
 * "Section → Item", read from its source text.
 */
const SIDE_MENU_SECTION_TITLE: RegExp =
  /title: "([^"]+)",(?: defaultCollapsed: true,)? items: \[/g;
const SIDE_MENU_ITEM_TITLE: RegExp = /link: \{ title: "([^"]+)"/g;

function sideMenuEntries(relative: string): Array<string> {
  const source: string = oneLine(dashboardSource(relative));
  const entries: Array<string> = [];
  const sections: Array<RegExpMatchArray> = Array.from(
    source.matchAll(SIDE_MENU_SECTION_TITLE),
  );

  sections.forEach((section: RegExpMatchArray, index: number): void => {
    const next: RegExpMatchArray | undefined = sections[index + 1];
    const body: string = source.slice(
      (section.index as number) + section[0].length,
      next ? next.index : undefined,
    );

    for (const item of body.matchAll(SIDE_MENU_ITEM_TITLE)) {
      entries.push(`${section[1] as string}${PATH_SEPARATOR}${item[1]}`);
    }
  });

  return entries;
}

// A status page side menu section is a <SideMenuSection title="...">.
const SIDE_MENU_SECTION_ELEMENT: RegExp =
  /<SideMenuSection title="([^"]+)"[^>]*>/g;
const SIDE_MENU_LINK_TITLE: RegExp = /title: "([^"]+)"/g;

function statusPageSideMenuEntries(): Array<string> {
  const source: string = oneLine(
    dashboardSource("Pages/StatusPages/View/SideMenu.tsx"),
  );
  const entries: Array<string> = [];
  const sections: Array<RegExpMatchArray> = Array.from(
    source.matchAll(SIDE_MENU_SECTION_ELEMENT),
  );

  sections.forEach((section: RegExpMatchArray, index: number): void => {
    const next: RegExpMatchArray | undefined = sections[index + 1];
    const body: string = source.slice(
      (section.index as number) + section[0].length,
      next ? next.index : undefined,
    );

    for (const item of body.matchAll(SIDE_MENU_LINK_TITLE)) {
      entries.push(`${section[1] as string}${PATH_SEPARATOR}${item[1]}`);
    }
  });

  return entries;
}

// The Products menu's items, by their English titles.
const NAVBAR_ITEM_KEY: RegExp = /t\("navbar\.items\.([A-Za-z]+Title)"/g;

function productsMenuItems(): Array<string> {
  const english: JSONObject = JSON.parse(
    dashboardSource("Locales/en.json"),
  ) as JSONObject;
  const items: JSONObject = (english["navbar"] as JSONObject)[
    "items"
  ] as JSONObject;

  return Array.from(
    dashboardSource("Utils/NavigationItems.tsx").matchAll(NAVBAR_ITEM_KEY),
  ).map((match: RegExpMatchArray): string => {
    return items[match[1] as string] as string;
  });
}

// What an Express router serves: each route's path and methods.
interface RouterLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
}

function routesOf(router: ExpressRouter): Dictionary<Array<string>> {
  const routes: Dictionary<Array<string>> = {};

  for (const layer of (router as unknown as { stack: Array<RouterLayer> })
    .stack) {
    if (!layer.route) {
      continue;
    }

    const methods: Array<string> = Object.keys(layer.route.methods).map(
      (method: string): string => {
        return method.toUpperCase();
      },
    );

    routes[layer.route.path] = Array.from(
      new Set<string>([...(routes[layer.route.path] || []), ...methods]),
    ).sort();
  }

  return routes;
}

/*
 * A location block of the ingress template, from `location <path> {` to
 * its closing brace, and the server block around it.
 */
// A comment runs from # to the end of its line, and one of them quotes a "{".
const NGINX_COMMENT: RegExp = /#[^\n]*/g;
const NGINX_TEMPLATE: string = readSource(
  "Nginx/default.conf.template",
).replace(NGINX_COMMENT, "");
const NGINX_CONF: string = readSource("Nginx/nginx.conf").replace(
  NGINX_COMMENT,
  "",
);

function blockFrom(text: string, open: number): string {
  let depth: number = 0;

  for (let index: number = open; index < text.length; index++) {
    if (text[index] === "{") {
      depth++;
    } else if (text[index] === "}") {
      depth--;

      if (depth === 0) {
        return text.slice(open, index + 1);
      }
    }
  }

  throw new Error(`No closing brace after ${open}`);
}

function nginxLocations(location: string): Array<string> {
  const blocks: Array<string> = [];
  const opening: string = `location ${location} {`;
  let at: number = NGINX_TEMPLATE.indexOf(opening);

  while (at >= 0) {
    blocks.push(
      blockFrom(NGINX_TEMPLATE, at + opening.length - 1).replace(
        "{",
        `${opening.slice(0, -1)}{`,
      ),
    );
    at = NGINX_TEMPLATE.indexOf(opening, at + opening.length);
  }

  return blocks;
}

const NGINX_SERVER_OPENING: RegExp = /^server \{$/gm;
// A location line, which may end in spaces where a comment was.
const NGINX_LOCATION_OPENING: RegExp = /^ {4}location [^\n]*\{[ \t]*$/gm;

// The text of the server block holding `at`, its location blocks taken out.
function serverLevelText(at: number): string {
  const openings: Array<number> = Array.from(
    NGINX_TEMPLATE.matchAll(NGINX_SERVER_OPENING),
  ).map((match: RegExpMatchArray): number => {
    return (match.index as number) + match[0].length - 1;
  });

  for (const opening of openings) {
    const server: string = blockFrom(NGINX_TEMPLATE, opening);

    if (at < opening || at > opening + server.length) {
      continue;
    }

    let serverOnly: string = server;

    for (const location of server.matchAll(NGINX_LOCATION_OPENING)) {
      const block: string = blockFrom(
        server,
        (location.index as number) + location[0].lastIndexOf("{"),
      );
      serverOnly = serverOnly.replace(block, "");
    }

    return serverOnly;
  }

  throw new Error(`No server block holds ${at}`);
}

/*
 * nginx's own default for a request body, client_max_body_size 1m, which
 * applies wherever the configuration sets none.
 */
const NGINX_DEFAULT_BODY_LIMIT_BYTES: number = 1024 * 1024;

// The body limit the ingress applies to one location, in bytes.
function ingressBodyLimit(location: string): number {
  const blocks: Array<string> = nginxLocations(location);

  expect({ location, blocks: blocks.length }).toEqual({ location, blocks: 1 });

  const block: string = blocks[0] as string;

  expect({
    location,
    setsItsOwnLimit: block.includes("client_max_body_size"),
    serverSetsALimit: serverLevelText(
      NGINX_TEMPLATE.indexOf(`location ${location} {`),
    ).includes("client_max_body_size"),
    httpSetsALimit: NGINX_CONF.includes("client_max_body_size"),
  }).toEqual({
    location,
    setsItsOwnLimit: false,
    serverSetsALimit: false,
    httpSetsALimit: false,
  });

  return NGINX_DEFAULT_BODY_LIMIT_BYTES;
}

// A request as the ingest guard reads it: headers only.
function ingestRequest(headers: Record<string, string>): ExpressRequest {
  return {
    headers,
    body: {},
    params: {},
    query: {},
    cookies: {},
    socket: { remoteAddress: "198.51.100.20" },
  } as unknown as ExpressRequest;
}

interface GuardAnswer {
  // The refusal the guard sent, if it sent one.
  refusal?: unknown;
  // What it handed to the next handler: undefined to admit, or an error.
  passed?: unknown;
  // Whether it called the next handler at all.
  admitted: boolean;
}

// Runs the ingest guard of one surface on a request.
async function runGuard(
  surface: TelemetryIngestSurface,
  headers: Record<string, string>,
): Promise<GuardAnswer> {
  const answer: GuardAnswer = { admitted: false };

  jest
    .spyOn(Response, "sendErrorResponse")
    .mockImplementation(
      (_req: ExpressRequest, _res: ExpressResponse, error: unknown): void => {
        answer.refusal = error;
      },
    );

  await TelemetryIngest.forSurface(surface)(
    ingestRequest(headers),
    {} as ExpressResponse,
    ((error?: unknown): void => {
      answer.admitted = true;
      answer.passed = error;
    }) as NextFunction,
  );

  return answer;
}

function policyOf(
  overrides: Partial<TelemetryIngestionKeyPolicy>,
): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ...overrides,
  };
}

// The guard's answer to a request carrying a key that resolves to `policy`.
async function guardWithKey(
  surface: TelemetryIngestSurface,
  policy: TelemetryIngestionKeyPolicy | null,
): Promise<GuardAnswer> {
  jest
    .spyOn(TelemetryIngestionKeyService, "getPolicyFromSecretKey")
    .mockResolvedValue(policy as never);
  jest
    .spyOn(TelemetryIngestionKeyService, "markUsed")
    .mockResolvedValue(undefined as never);

  return runGuard(surface, {
    "x-oneuptime-token": ObjectID.generate().toString(),
  });
}

// What the App's last error handler writes for an error: status and body.
interface ErrorAnswer {
  status: number;
  body: unknown;
}

function errorAnswer(error: Error): ErrorAnswer {
  const answer: ErrorAnswer = { status: 0, body: undefined };
  const res: ExpressResponse = {
    headersSent: false,
    status: (status: number): ExpressResponse => {
      answer.status = status;
      return res;
    },
    send: (body: unknown): ExpressResponse => {
      answer.body = body;
      return res;
    },
  } as unknown as ExpressResponse;

  expressErrorHandler(error, ingestRequest({}), res, (() => {
    return undefined;
  }) as NextFunction);

  return answer;
}

// The status code an exception class answers with.
function codeOf(error: unknown): number | undefined {
  return (error as { code?: number }).code;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the ingestion key the shipper pages make", () => {
  it("is opened from Products → Project Settings, under Telemetry & APM → Ingestion Keys", () => {
    const step: string =
      "Go to **Products → Project Settings**, open **Telemetry & APM** in the side menu and select **Ingestion Keys**.";

    expect(productsMenuItems()).toContain("Project Settings");
    expect(sideMenuEntries("Pages/Settings/SideMenu.tsx")).toContain(
      `Telemetry & APM${PATH_SEPARATOR}Ingestion Keys`,
    );

    for (const page of KEY_STEP_PAGES) {
      expect({ page, says: englishPage(page).includes(step) }).toEqual({
        page,
        says: true,
      });
    }

    expect(englishPage(SYSLOG)).toContain(
      "create a **Server** key under **Products → Project Settings → Telemetry & APM → Ingestion Keys**, and copy its **Secret Key**",
    );
  });

  it("is created with Create Ingestion Key, the table's and the dialog's button", () => {
    const table: string = oneLine(
      dashboardSource("Pages/Settings/TelemetryIngestionKeys.tsx"),
    );
    const baseTable: string = oneLine(
      readSource("Common/UI/Components/ModelTable/BaseModelTable.tsx"),
    );
    const modelTable: string = oneLine(
      readSource("Common/UI/Components/ModelTable/ModelTable.tsx"),
    );

    // The verb is Create unless a table names another, and this one does not.
    expect(table).toContain('singularName="Ingestion Key"');
    expect(table).not.toContain("createVerb");
    expect(baseTable).toContain('const verb: string = data.verb || "Create";');
    expect(baseTable).toContain(
      'Create: translationKey("Create {{itemName}}")',
    );
    expect(baseTable).toContain(
      'return translateCreateAction(translator, { verb: props.createVerb, itemName: props.singularName || model.singularName || "", });',
    );
    // The dialog's submit button reads the same.
    expect(modelTable).toContain(
      '? translateCreateAction(translator, { verb: props.createVerb, itemName: props.singularName || model.singularName || "", })',
    );

    for (const page of KEY_STEP_PAGES) {
      expect({
        page,
        says: englishPage(page).includes(
          "Click **Create Ingestion Key**. The dialog has the key's name filled in and **Server** picked",
        ),
      }).toEqual({ page, says: true });
    }
  });

  it("starts with its name filled in and Server picked", () => {
    const form: string = oneLine(
      dashboardSource("Components/Telemetry/IngestionKeyForm.ts"),
    );

    expect(form).toContain(
      "defaultValue: options.keyName || getDefaultIngestionKeyName(options.keyType),",
    );
    expect(form).toContain(
      'value: TelemetryIngestionKeyType.Server, title: "Server",',
    );
    expect(form).toContain(
      "required: true, defaultValue: TelemetryIngestionKeyType.Server,",
    );
  });

  it("opens on its own page, where its Secret Key is copied", () => {
    const table: string = oneLine(
      dashboardSource("Pages/Settings/TelemetryIngestionKeys.tsx"),
    );
    const view: string = oneLine(
      dashboardSource("Pages/Settings/TelemetryIngestionKeyView.tsx"),
    );

    expect(table).toContain(
      "if (modalType === ModalType.Create && item._id) { Navigation.navigate(getIngestionKeyRoute(item)); }",
    );
    expect(table).toContain(
      "RouteMap[PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW]",
    );
    expect(view).toContain(
      'field: { secretKey: true, }, title: "Secret Key", fieldType: FieldType.HiddenText, opts: { isCopyable: true, },',
    );

    for (const page of KEY_STEP_PAGES) {
      expect({
        page,
        says: englishPage(page).includes(
          "The new key opens on its own page. Copy its **Secret Key**",
        ),
      }).toEqual({ page, says: true });
    }
  });

  it("is sent in the x-oneuptime-token header, the one the ingest guard reads first", () => {
    expect(
      oneLine(readSource("Common/Server/Middleware/TelemetryIngest.ts")),
    ).toContain(
      'let oneuptimeToken: string | undefined = req.headers[ "x-oneuptime-token" ] as string | undefined;',
    );

    for (const page of SHIPPER_PAGES) {
      expect({
        page,
        names: englishPage(page).includes("`x-oneuptime-token`"),
      }).toEqual({ page, names: true });
    }
  });

  it("has an Enabled switch on its page, the kill switch the 422 answer turns back on", () => {
    const view: string = oneLine(
      dashboardSource("Pages/Settings/TelemetryIngestionKeyView.tsx"),
    );

    expect(view).toContain(
      'field: { isEnabled: true, }, title: "Enabled", stepId: "access-and-limits", fieldType: FormFieldSchemaType.Toggle,',
    );
  });
});

describe("what the shipper pages say an ingest request is answered", () => {
  const PAYMENT_ANSWER: string =
    "`402`: on OneUptime Cloud, the project is on the Free plan and has no payment method. Add one under **Project Settings → Billing and Invoices → Billing**.";
  const KEY_ANSWER: string =
    "`422`: the key is disabled, or it is a Browser key. Turn **Enabled** back on in the key's settings, or create a **Server** key.";

  it("answers each page's 401, 402 and 422 in Troubleshooting", () => {
    for (const page of SHIPPER_PAGES) {
      const text: string = englishPage(page);

      expect({
        page,
        unauthenticated: text.includes("missing, unknown or expired"),
        payment: text.includes(PAYMENT_ANSWER),
        key: text.includes(KEY_ANSWER),
      }).toEqual({ page, unauthenticated: true, payment: true, key: true });
    }
  });

  it("answers a request with no key with 401", async () => {
    for (const page of SHIPPER_PAGES) {
      const answer: GuardAnswer = await runGuard(
        SURFACE_OF_PAGE[page] as TelemetryIngestSurface,
        {},
      );

      expect({ page, code: codeOf(answer.refusal) }).toEqual({
        page,
        code: ExceptionCode.NotAuthenticatedException,
      });
      expect(answer.refusal).toBeInstanceOf(NotAuthenticatedException);
      expect(answer.admitted).toBe(false);
    }

    expect(ExceptionCode.NotAuthenticatedException).toBe(401);
  });

  it("answers an unknown key with 401", async () => {
    for (const page of SHIPPER_PAGES) {
      const answer: GuardAnswer = await guardWithKey(
        SURFACE_OF_PAGE[page] as TelemetryIngestSurface,
        null,
      );

      expect({ page, code: codeOf(answer.refusal) }).toEqual({
        page,
        code: 401,
      });
    }
  });

  it("answers an expired key with 401", async () => {
    for (const page of SHIPPER_PAGES) {
      const answer: GuardAnswer = await guardWithKey(
        SURFACE_OF_PAGE[page] as TelemetryIngestSurface,
        policyOf({ expiresAt: new Date(Date.now() - 60 * 1000) }),
      );

      expect({ page, code: codeOf(answer.refusal) }).toEqual({
        page,
        code: 401,
      });
    }
  });

  it("answers a disabled key with 422", async () => {
    for (const page of SHIPPER_PAGES) {
      const answer: GuardAnswer = await guardWithKey(
        SURFACE_OF_PAGE[page] as TelemetryIngestSurface,
        policyOf({ isEnabled: false }),
      );

      expect(answer.refusal).toBeInstanceOf(NotAuthorizedException);
      expect({ page, code: codeOf(answer.refusal) }).toEqual({
        page,
        code: 422,
      });
    }

    expect(ExceptionCode.NotAuthorizedException).toBe(422);
  });

  it("answers a Browser key with 422, whether or not its surface takes one", async () => {
    // Syslog and Fluentd never take a Browser key; OTLP logs take one only from a browser.
    expect(
      BROWSER_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.Syslog),
    ).toBe(false);
    expect(
      BROWSER_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.Fluent),
    ).toBe(false);
    expect(
      BROWSER_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.OtelLogs),
    ).toBe(true);

    for (const page of SHIPPER_PAGES) {
      const answer: GuardAnswer = await guardWithKey(
        SURFACE_OF_PAGE[page] as TelemetryIngestSurface,
        policyOf({
          keyType: TelemetryIngestionKeyType.Browser,
          allowedOrigins: ["https://app.example.com"],
        }),
      );

      // A server sends no Origin, so even OTLP logs refuse the key.
      expect({ page, code: codeOf(answer.refusal) }).toEqual({
        page,
        code: 422,
      });
    }
  });

  it("admits a Server key that is enabled and not expired", async () => {
    for (const page of SHIPPER_PAGES) {
      const answer: GuardAnswer = await guardWithKey(
        SURFACE_OF_PAGE[page] as TelemetryIngestSurface,
        policyOf({}),
      );

      expect({
        page,
        admitted: answer.admitted,
        passed: answer.passed,
        refusal: answer.refusal,
      }).toEqual({
        page,
        admitted: true,
        passed: undefined,
        refusal: undefined,
      });
    }
  });

  it("answers 402 when the project may not run up telemetry charges", async () => {
    /*
     * The key lookup itself asks billing (requireBillingForPolicy), so the
     * refusal reaches the guard as a thrown PaymentRequiredException, which
     * the guard hands to the App's last error handler.
     */
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    key.id = ObjectID.generate();
    key.projectId = ObjectID.generate();

    jest
      .spyOn(TelemetryIngestionKeyService, "findOneBy")
      .mockResolvedValue(key as never);
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(false as never);

    let refused: unknown = undefined;

    try {
      await TelemetryIngestionKeyService.getPolicyFromSecretKey(
        ObjectID.generate().toString(),
      );
    } catch (error) {
      refused = error;
    }

    expect(refused).toBeInstanceOf(PaymentRequiredException);
    expect(ExceptionCode.PaymentRequiredException).toBe(402);
    expect(errorAnswer(refused as Error)).toEqual({
      status: 402,
      body: { error: PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE },
    });

    // And with a payment method on file, the same key resolves.
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(true as never);

    const policy: TelemetryIngestionKeyPolicy | null =
      await TelemetryIngestionKeyService.getPolicyFromSecretKey(
        ObjectID.generate().toString(),
      );

    expect(policy?.keyType).toBe(TelemetryIngestionKeyType.Server);
  });

  it("hands a 402 from the key lookup on, so it is answered as such", async () => {
    for (const page of SHIPPER_PAGES) {
      jest
        .spyOn(TelemetryIngestionKeyService, "getPolicyFromSecretKey")
        .mockRejectedValue(
          new PaymentRequiredException(
            PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
          ) as never,
        );

      const answer: GuardAnswer = await runGuard(
        SURFACE_OF_PAGE[page] as TelemetryIngestSurface,
        { "x-oneuptime-token": ObjectID.generate().toString() },
      );

      expect({ page, code: codeOf(answer.passed) }).toEqual({
        page,
        code: 402,
      });
    }
  });

  it("sends the payment method to Project Settings → Billing and Invoices → Billing", () => {
    expect(sideMenuEntries("Pages/Settings/SideMenu.tsx")).toContain(
      `Billing and Invoices${PATH_SEPARATOR}Billing`,
    );
    expect(PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE).toContain(
      "Add a payment method",
    );
  });

  it("says a Free plan project needs a payment method before it can send telemetry", () => {
    for (const page of SHIPPER_PAGES) {
      expect({
        page,
        says: englishPage(page).includes(
          "a project on the Free plan needs a payment method before it can send telemetry",
        ),
      }).toEqual({ page, says: true });
    }

    expect(PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE).toContain(
      "even on the Free plan",
    );
  });
});

describe("the Products paths the pages name", () => {
  it("start from an item of the Products menu", () => {
    const items: Array<string> = productsMenuItems();

    for (const page of [...SHIPPER_PAGES, PUBLIC_API]) {
      for (const parts of menuPaths(page)) {
        if (parts[0] !== "Products") {
          continue;
        }

        const item: string = parts[1] as string;

        expect({ page, item, inMenu: items.includes(item) }).toEqual({
          page,
          item,
          inMenu: true,
        });
      }
    }
  });
});

/*
 * The OTLP router, as the App serves it: Serilog and Fluent Bit post to
 * these paths.
 */
const OTLP_ROUTES: Dictionary<Array<string>> = routesOf(OTelIngestAPI);

describe("the Serilog page", () => {
  it("has the sink post to the OTLP logs route, on the OTLP logs surface", () => {
    expect(OTLP_ROUTES["/otlp/v1/logs"]).toEqual(["POST"]);
    expect(
      oneLine(readSource("App/FeatureSet/Telemetry/API/OTelIngest.ts")),
    ).toContain(
      'router.post( "/otlp/v1/logs", TelemetryIngestionDisabled.middleware, OpenTelemetryRequestMiddleware.parseBody, ingestMetricsMiddleware("logs"), OpenTelemetryRequestMiddleware.getProductType, TelemetryIngest.forSurface(TelemetryIngestSurface.OtelLogs),',
    );
    expect(englishPage(SERILOG)).toContain(
      "the final URL it posts to is `https://oneuptime.com/otlp/v1/logs`",
    );
    expect(nginxLocations("/otlp").length).toBeGreaterThan(0);
  });

  it("names the exception attributes OneUptime turns into an exception", () => {
    const extracted: ExtractedLogException | null =
      LogExceptionExtractor.extractFromLogRecord({
        body: "Failed to process payment for order 42",
        attributes: {
          "exception.type": "System.InvalidOperationException",
          "exception.message": "Card declined",
          "exception.stacktrace":
            "System.InvalidOperationException: Card declined\n   at Shop.Payments.ProcessPayment() in /app/Payments.cs:line 12",
        },
        // Serilog's Information level: the attributes count at any severity.
        severityNumber: 9,
        hasTraceAndSpan: true,
      });

    expect(extracted?.exceptionType).toBe("System.InvalidOperationException");
    expect(extracted?.message).toBe("Card declined");
    expect(extracted?.stackTrace).toContain("ProcessPayment");
    expect(englishPage(SERILOG)).toContain(
      "the sink attaches the OpenTelemetry `exception.type`, `exception.message`, and `exception.stacktrace` attributes",
    );
  });

  it("says log and trace exceptions share one fingerprint, so one issue", () => {
    for (const service of [
      "OtelLogsIngestService",
      "OtelTracesIngestService",
    ]) {
      expect({
        service,
        fingerprints: readSource(
          `App/FeatureSet/Telemetry/Services/${service}.ts`,
        ).includes("ExceptionUtil.getFingerprint({"),
      }).toEqual({ service, fingerprints: true });
    }

    expect(englishPage(SERILOG)).toContain(
      "An error reported by both a trace and a log collapses into a single issue.",
    );
  });

  it("links to the OpenTelemetry page's exceptions and quickstart sections", () => {
    const anchors: Array<string> = scanPage(
      "en",
      "telemetry/open-telemetry",
    ).headings.map((heading: DocsHeading): string => {
      return heading.slug;
    });

    expect(anchors).toContain("exceptions-from-logs");
    expect(anchors).toContain("quickstart");
    expect(englishPage(SERILOG)).toContain(
      "(/docs/telemetry/open-telemetry#exceptions-from-logs)",
    );
    expect(englishPage(SERILOG)).toContain(
      "(/docs/telemetry/open-telemetry#quickstart)",
    );
  });

  it("sends the key in the header every example sets", () => {
    for (const fence of codeBlocks(SERILOG)) {
      if (!fence.code.includes("oneuptime.com/otlp")) {
        continue;
      }

      expect({
        example: fence.info,
        header: fence.code.includes('"x-oneuptime-token"'),
        base: fence.code.includes('"https://oneuptime.com/otlp"'),
        appendsNoPath: fence.code.includes('"https://oneuptime.com/otlp/v1'),
      }).toEqual({
        example: fence.info,
        header: true,
        base: true,
        appendsNoPath: false,
      });
    }
  });
});

describe("the Fluent Bit page", () => {
  const OTLP_URI: RegExp = /(logs|metrics|traces)_uri: "([^"]+)"/g;

  // An output named opentelemetry, not the opentelemetry_envelope processor.
  const OPENTELEMETRY_OUTPUT: RegExp = /^\s*- name: opentelemetry$/m;

  it("points every opentelemetry output at the OTLP routes OneUptime serves", () => {
    const outputs: Array<DocsFence> = codeBlocks(FLUENT_BIT).filter(
      (fence: DocsFence): boolean => {
        return OPENTELEMETRY_OUTPUT.test(fence.code);
      },
    );

    // The step's output, the complete example and the self-hosted one.
    expect(outputs.length).toBe(3);

    for (const output of outputs) {
      const uris: Array<string> = Array.from(
        output.code.matchAll(OTLP_URI),
      ).map((match: RegExpMatchArray): string => {
        return `${match[1]}=${match[2]}`;
      });

      expect(uris.sort()).toEqual([
        "logs=/otlp/v1/logs",
        "metrics=/otlp/v1/metrics",
        "traces=/otlp/v1/traces",
      ]);

      for (const uri of uris) {
        const route: string = uri.split("=")[1] as string;

        expect({ route, methods: OTLP_ROUTES[route] }).toEqual({
          route,
          methods: ["POST"],
        });
      }

      expect(output.code).toContain(
        "- x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN",
      );
    }
  });

  it("uses TLS on 443 for OneUptime Cloud, and plain HTTP on 80 without tls when self-hosted", () => {
    const cloud: Array<DocsFence> = codeBlocks(FLUENT_BIT).filter(
      (fence: DocsFence): boolean => {
        return fence.code.includes('host: "oneuptime.com"');
      },
    );
    const selfHosted: Array<DocsFence> = codeBlocks(FLUENT_BIT).filter(
      (fence: DocsFence): boolean => {
        return fence.code.includes('host: "your-oneuptime-instance.com"');
      },
    );

    expect(cloud.length).toBe(2);
    expect(selfHosted.length).toBe(1);

    for (const fence of cloud) {
      expect(fence.code).toContain("port: 443");
      expect(fence.code).toContain("tls: On");
    }

    expect((selfHosted[0] as DocsFence).code).toContain("port: 80");
    expect((selfHosted[0] as DocsFence).code).not.toContain("tls:");
  });

  it("names the service with service.name on every input it configures", () => {
    for (const fence of codeBlocks(FLUENT_BIT)) {
      if (!fence.code.includes("inputs:")) {
        continue;
      }

      expect(oneLine(fence.code)).toContain(
        "- name: opentelemetry_envelope - name: content_modifier context: otel_resource_attributes action: upsert key: service.name value: YOUR_SERVICE_NAME",
      );
    }
  });
});

interface FluentInternals {
  DEFAULT_SERVICE_NAME: string;
  BODY_FIELDS: Array<string>;
  SEVERITY_FIELDS: Array<string>;
  TRACE_ID_FIELDS: Array<string>;
  SPAN_ID_FIELDS: Array<string>;
  normalizeLogEntries(payload: unknown): Array<JSONObject>;
  extractBodyFromEntry(entry: JSONObject): string;
  extractSeverityFromEntry(entry: JSONObject): {
    number: number;
    text: LogSeverity;
  };
  extractStringField(
    entry: JSONObject,
    fields: Array<string>,
  ): string | undefined;
  buildFluentAttributes(
    entry: JSONObject,
  ): Dictionary<AttributeType | Array<AttributeType>>;
  getServiceNameFromHeaders(req: ExpressRequest, defaultName?: string): string;
}

const FLUENT: FluentInternals =
  FluentLogsIngestService as unknown as FluentInternals;

const FLUENT_SERVICE_SOURCE: string = oneLine(
  readSource("App/FeatureSet/Telemetry/Services/FluentLogsIngestService.ts"),
);

describe("the Fluentd page", () => {
  const RECORDS_HEADER: string =
    "| Log field | Read from the record's first field of | Notes |";

  // The record fields the table names for one log field.
  function fieldsRead(logField: string): Array<string> {
    const row: Array<string> | undefined = tableAfter(
      FLUENTD,
      RECORDS_HEADER,
    ).find((cells: Array<string>): boolean => {
      return cells[0] === logField;
    });

    expect({ logField, found: Boolean(row) }).toEqual({
      logField,
      found: true,
    });

    return codeSpans((row as Array<string>)[1] as string);
  }

  it("sends to /fluentd/logs, which the ingress hands to the Fluentd route", () => {
    const blocks: Array<string> = nginxLocations("/fluentd/logs");

    expect(blocks.length).toBe(1);
    expect(blocks[0]).toContain(
      "rewrite ^/fluentd/logs(.*)$ /fluentd/v1/logs$1 break;",
    );
    expect(routesOf(FluentAPI)["/fluentd/v1/logs"]).toEqual(["POST"]);
    expect(
      oneLine(readSource("App/FeatureSet/Telemetry/API/Fluent.ts")),
    ).toContain("TelemetryIngest.forSurface(TelemetryIngestSurface.Fluent)");

    const outputs: Array<DocsFence> = codeBlockTitled(FLUENTD, "fluentd.conf");

    expect(outputs.length).toBe(2);

    for (const output of outputs) {
      expect(output.code).toContain(
        "endpoint https://oneuptime.com/fluentd/logs",
      );
    }

    expect(englishPage(FLUENTD)).toContain(
      "`http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`",
    );
  });

  it("sends the key and the service name in the headers OneUptime reads", () => {
    const HEADERS_LINE: RegExp = /^ {2}headers (\{.*\})$/m;

    for (const output of codeBlockTitled(FLUENTD, "fluentd.conf")) {
      const match: RegExpMatchArray | null = output.code.match(HEADERS_LINE);
      const headers: JSONObject = JSON.parse(
        (match as RegExpMatchArray)[1] as string,
      ) as JSONObject;

      expect(Object.keys(headers).sort()).toEqual([
        "x-oneuptime-service-name",
        "x-oneuptime-token",
      ]);
    }

    const req: ExpressRequest = ingestRequest({
      "x-oneuptime-service-name": "checkout",
    });

    expect(
      FLUENT.getServiceNameFromHeaders(req, FLUENT.DEFAULT_SERVICE_NAME),
    ).toBe("checkout");
  });

  it("files logs under Fluentd when the service header is missing", () => {
    expect(FLUENT.DEFAULT_SERVICE_NAME).toBe("Fluentd");
    expect(
      FLUENT.getServiceNameFromHeaders(
        ingestRequest({}),
        FLUENT.DEFAULT_SERVICE_NAME,
      ),
    ).toBe("Fluentd");
    expect(FLUENT_SERVICE_SOURCE).toContain(
      "const serviceName: string = this.getServiceNameFromHeaders( req, this.DEFAULT_SERVICE_NAME, );",
    );
    expect(tableAfter(FLUENTD, RECORDS_HEADER)).toContainEqual([
      "Service",
      "the `x-oneuptime-service-name` header",
      "`Fluentd` when the header is not set.",
    ]);
  });

  it("reads each log field from the record fields the table names, in its order", () => {
    expect(fieldsRead("Body")).toEqual(FLUENT.BODY_FIELDS);
    expect(fieldsRead("Severity")).toEqual(FLUENT.SEVERITY_FIELDS);
    expect(fieldsRead("Trace ID")).toEqual(FLUENT.TRACE_ID_FIELDS);
    expect(fieldsRead("Span ID")).toEqual(FLUENT.SPAN_ID_FIELDS);
  });

  it("takes the body from the first of its fields the record has, else the whole record", () => {
    expect(FLUENT.extractBodyFromEntry({ text: "third", log: "second" })).toBe(
      "second",
    );
    expect(FLUENT.extractBodyFromEntry({ msg: "a", message: "first" })).toBe(
      "first",
    );

    const record: JSONObject = { event: "login", user: "ada" };

    expect(FLUENT.extractBodyFromEntry(record)).toBe(JSON.stringify(record));
    expect(englishPage(FLUENTD)).toContain(
      "A record with none of them is stored whole, as JSON.",
    );
  });

  it("maps the severity names the table gives, in any case, and stores anything else as Unspecified", () => {
    const row: Array<string> | undefined = tableAfter(
      FLUENTD,
      RECORDS_HEADER,
    ).find((cells: Array<string>): boolean => {
      return cells[0] === "Severity";
    });
    const NAMES_PART: RegExp = /^Names such as (.*), in any case\./;
    const names: Array<string> = codeSpans(
      ((row as Array<string>)[2] as string).match(NAMES_PART)?.[1] || "",
    );

    expect(names).toEqual([
      "trace",
      "debug",
      "info",
      "notice",
      "warn",
      "error",
      "critical",
      "fatal",
    ]);

    for (const name of names) {
      for (const written of [
        name,
        name.toUpperCase(),
        `${name.charAt(0).toUpperCase()}${name.slice(1)}`,
      ]) {
        expect({
          written,
          stored: FLUENT.extractSeverityFromEntry({ level: written }).text,
        }).not.toEqual({ written, stored: LogSeverity.Unspecified });
      }
    }

    expect(FLUENT.extractSeverityFromEntry({ level: "verbose" }).text).toBe(
      LogSeverity.Unspecified,
    );
    expect(FLUENT.extractSeverityFromEntry({ priority: 3 }).text).toBe(
      LogSeverity.Unspecified,
    );
    expect((row as Array<string>)[2]).toContain(
      "Any other value is stored as `Unspecified`.",
    );
    expect(LogSeverity.Unspecified).toBe("Unspecified");
  });

  it("links a log to its trace and span by the fields the table names", () => {
    for (const field of FLUENT.TRACE_ID_FIELDS) {
      expect(
        FLUENT.extractStringField(
          { [field]: "4bf92f3577b34da6" },
          FLUENT.TRACE_ID_FIELDS,
        ),
      ).toBe("4bf92f3577b34da6");
    }

    for (const field of FLUENT.SPAN_ID_FIELDS) {
      expect(
        FLUENT.extractStringField(
          { [field]: "00f067aa0ba902b7" },
          FLUENT.SPAN_ID_FIELDS,
        ),
      ).toBe("00f067aa0ba902b7");
    }
  });

  it("stores every other field as a fluentd. attribute, flattening objects and keeping lists as JSON", () => {
    const attributes: Dictionary<AttributeType | Array<AttributeType>> =
      FLUENT.buildFluentAttributes({
        message: "GET /health 200",
        level: "info",
        trace_id: "4bf92f3577b34da6",
        span_id: "00f067aa0ba902b7",
        container_name: "web",
        kubernetes: { pod_name: "web-7d9c", labels: { app: "web" } },
        tags: ["blue", "canary"],
      });

    expect(attributes).toEqual({
      "fluentd.container_name": "web",
      "fluentd.kubernetes.pod_name": "web-7d9c",
      "fluentd.kubernetes.labels.app": "web",
      "fluentd.tags": '["blue","canary"]',
    });

    const page: string = englishPage(FLUENTD);

    expect(page).toContain(
      "Every other field becomes an attribute named `fluentd.` and the field's name",
    );
    expect(page).toContain(
      "a `container_name` field is `@fluentd.container_name` in the Logs explorer",
    );
    expect(page).toContain(
      "A nested object is flattened with dots, such as `fluentd.kubernetes.pod_name`, and a list is stored as JSON.",
    );
  });

  it("times each log when OneUptime takes it in, not by a field of the record", () => {
    expect(FLUENT_SERVICE_SOURCE).toContain(
      "const ingestionDate: Date = OneUptimeDate.getCurrentDate();",
    );
    expect(FLUENT_SERVICE_SOURCE).toContain(
      "time: OneUptimeDate.toClickhouseDateTime64(ingestionDate),",
    );

    for (const fields of [
      FLUENT.BODY_FIELDS,
      FLUENT.SEVERITY_FIELDS,
      FLUENT.TRACE_ID_FIELDS,
      FLUENT.SPAN_ID_FIELDS,
    ]) {
      expect(fields).not.toContain("time");
    }

    expect(tableAfter(FLUENTD, RECORDS_HEADER)).toContainEqual([
      "Time",
      "—",
      "The time OneUptime receives the record.",
    ]);
  });

  it("reads a JSON array of records, which json_array true sends", () => {
    expect(
      FLUENT.normalizeLogEntries([
        { message: "one", level: "info" },
        { message: "two", level: "warn" },
      ]),
    ).toEqual([
      { message: "one", level: "info" },
      { message: "two", level: "warn" },
    ]);

    for (const output of codeBlockTitled(FLUENTD, "fluentd.conf")) {
      expect(output.code).toContain("json_array true");
      expect(output.code).toContain("content_type application/json");
      expect(output.code).toContain("flush_interval 10s");
    }

    expect(englishPage(FLUENTD)).toContain(
      "`flush_interval 10s` sends the buffer every 10 seconds",
    );
  });

  it("keeps each request under the 1 MB the ingress accepts on this endpoint", () => {
    const limit: number = ingressBodyLimit("/fluentd/logs");
    const CHUNK_LIMIT: RegExp = /^ {4}chunk_limit_size (\d+)k$/m;

    for (const output of codeBlockTitled(FLUENTD, "fluentd.conf")) {
      const match: RegExpMatchArray | null = output.code.match(CHUNK_LIMIT);

      expect(match).not.toBeNull();

      const chunkBytes: number =
        parseInt((match as RegExpMatchArray)[1] as string, 10) * 1024;

      /*
       * json_array sends a chunk as "[" + its records + "]" in place of the
       * chunk's last separator: a request is a chunk and a byte or two.
       */
      expect(chunkBytes + 2).toBeLessThan(limit);
    }

    expect(limit).toBe(1024 * 1024);
    expect(englishPage(FLUENTD)).toContain(
      "`chunk_limit_size 900k` keeps each request under 1 MB, the most OneUptime accepts on this endpoint.",
    );
    expect(detailsAnswer(FLUENTD, "Fluentd logs `413`")).toContain(
      "The request is over 1 MB, the most OneUptime accepts on this endpoint. Set `chunk_limit_size 900k` in the `<buffer>` section",
    );
  });

  it("puts Fluentd logs through the log pipelines, drop filters and scrub rules", () => {
    expect(FLUENT_SERVICE_SOURCE).toContain(
      "loadedPipelines = await LogPipelineService.loadPipelines(projectId); loadedDropFilters = await LogDropFilterService.loadDropFilters(projectId); loadedScrubRules = await LogScrubRuleService.loadScrubRules(projectId);",
    );
    expect(FLUENT_SERVICE_SOURCE).toContain(
      "LogDropFilterService.shouldDropLog(logRow, loadedDropFilters)",
    );
    expect(FLUENT_SERVICE_SOURCE).toContain(
      "logRow = LogScrubRuleService.scrubLog(logRow, loadedScrubRules);",
    );
    expect(FLUENT_SERVICE_SOURCE).toContain(
      "logRow = LogPipelineService.processLog(logRow, loadedPipelines);",
    );
    expect(englishPage(FLUENTD)).toContain(
      "Fluentd logs go through your [log pipelines](/docs/telemetry/log-pipelines), drop filters and scrub rules like any other log.",
    );
  });
});

interface SyslogInternals {
  DEFAULT_SERVICE_NAME: string;
  normalizeMessages(payload: unknown): Array<string>;
  mapSeverity(severity?: number): { number: number; text: LogSeverity };
  getSeverityLabel(severity: number): string;
  getFacilityLabel(facility: number): string;
  resolveServiceName(req: ExpressRequest, parsed: ParsedSyslogMessage): string;
  buildAttributes(data: {
    parsed: ParsedSyslogMessage;
    primaryEntityId: ObjectID;
    serviceName: string;
  }): Dictionary<AttributeType | Array<AttributeType>>;
}

const SYSLOG_SERVICE: SyslogInternals =
  SyslogIngestService as unknown as SyslogInternals;

const SYSLOG_SERVICE_SOURCE: string = oneLine(
  readSource("App/FeatureSet/Telemetry/Services/SyslogIngestService.ts"),
);

// The messages of the Syslog page's request body example.
function requestBodyMessages(): Array<string> {
  const body: DocsFence | undefined = codeBlocks(SYSLOG).find(
    (fence: DocsFence): boolean => {
      return fence.lang === "json" && fence.code.includes('"messages"');
    },
  );

  return (JSON.parse((body as DocsFence).code) as JSONObject)[
    "messages"
  ] as Array<string>;
}

// The Syslog page's test message: the one its curl example sends.
function testMessage(): string {
  const curl: DocsFence | undefined = codeBlocks(SYSLOG).find(
    (fence: DocsFence): boolean => {
      return fence.lang === "bash" && fence.code.includes("curl");
    },
  );
  const DATA_ARGUMENT: RegExp = /-d '([\s\S]*?)'\s*$/;
  const data: RegExpMatchArray | null = (curl as DocsFence).code.match(
    DATA_ARGUMENT,
  );

  return (
    (JSON.parse((data as RegExpMatchArray)[1] as string) as JSONObject)[
      "messages"
    ] as Array<string>
  )[0] as string;
}

function parsed(raw: string): ParsedSyslogMessage {
  const message: ParsedSyslogMessage | null = parseSyslogMessage(raw);

  expect({ raw, parsed: message !== null }).toEqual({ raw, parsed: true });

  return message as ParsedSyslogMessage;
}

// A request carrying a gzip-compressed body, as a forwarder sends it.
function gzipRequest(body: Buffer): ExpressRequest {
  const stream: PassThrough = new PassThrough();
  const req: ExpressRequest = stream as unknown as ExpressRequest;

  (req as unknown as { headers: Record<string, string> }).headers = {
    "content-encoding": "gzip",
    "content-length": String(body.length),
  };

  setImmediate(() => {
    stream.end(body);
  });

  return req;
}

// Runs one middleware on a request, resolving with what it passed on.
function runMiddleware(
  middleware: RequestHandler,
  req: ExpressRequest,
): Promise<unknown> {
  return new Promise<unknown>((resolve: (value: unknown) => void) => {
    middleware(
      req,
      {} as ExpressResponse,
      ((error?: unknown) => {
        resolve(error);
      }) as NextFunction,
    );
  });
}

// What the App reads from a gzip-compressed body: the inflated bytes.
async function inflatedBody(text: string): Promise<unknown> {
  const req: ExpressRequest = gzipRequest(zlib.gzipSync(Buffer.from(text)));

  expect(
    await runMiddleware(
      GzipRequestBodyMiddleware.parseBody as RequestHandler,
      req,
    ),
  ).toBeUndefined();

  return (req as unknown as { body: unknown }).body;
}

interface SyslogIngestAnswer {
  calls: Array<string>;
  passed: unknown;
}

// Runs the Syslog endpoint's handler on a body, after the ingest guard admitted it.
async function ingestSyslog(body: unknown): Promise<SyslogIngestAnswer> {
  const answer: SyslogIngestAnswer = { calls: [], passed: undefined };

  jest
    .spyOn(Response, "sendEmptySuccessResponse")
    .mockImplementation((): void => {
      answer.calls.push("answered");
    });
  jest
    .spyOn(SyslogQueueService, "addSyslogIngestJob")
    .mockImplementation(async (): Promise<void> => {
      answer.calls.push("queued");
    });

  const req: ExpressRequest = ingestRequest({});
  (req as unknown as { projectId: ObjectID }).projectId = ObjectID.generate();
  (req as unknown as { body: unknown }).body = body;

  await SyslogIngestService.ingestSyslog(
    req,
    {} as ExpressResponse,
    ((error?: unknown): void => {
      answer.passed = error;
    }) as NextFunction,
  );

  return answer;
}

describe("the Syslog page", () => {
  const ATTRIBUTES_HEADER: string =
    "| Attribute | Value | From the test message |";
  const SEVERITY_HEADER: string =
    "| Syslog severity | Code | OneUptime severity |";

  it("posts to /syslog/v1/logs, which the ingress passes on as is, on the Syslog surface", () => {
    const blocks: Array<string> = nginxLocations("/syslog/v1/logs");

    expect(blocks.length).toBe(1);
    expect(blocks[0]).toContain("proxy_pass");
    expect(blocks[0]).not.toContain("rewrite");
    expect(routesOf(SyslogAPI)["/syslog/v1/logs"]).toEqual(["POST"]);
    expect(
      oneLine(readSource("App/FeatureSet/Telemetry/API/Syslog.ts")),
    ).toContain("TelemetryIngest.forSurface(TelemetryIngestSurface.Syslog)");
    expect(englishPage(SYSLOG)).toContain(
      "POST https://oneuptime.com/syslog/v1/logs",
    );
  });

  it("keeps each request under the ingress's 1 MB", () => {
    expect(ingressBodyLimit("/syslog/v1/logs")).toBe(1024 * 1024);
    expect(englishPage(SYSLOG)).toContain(
      "Keep each request under 1 MB: OneUptime's ingress does not raise nginx's default request-body limit for this endpoint.",
    );
  });

  it("parses both messages of the request body example", () => {
    const [rfc5424, rfc3164] = requestBodyMessages() as [string, string];

    expect(parsed(rfc5424).version).toBe(1);
    expect(parsed(rfc3164).version).toBeUndefined();
    expect(parsed(rfc3164)).toMatchObject({
      priority: 13,
      hostname: "db-01",
      appName: "postgres",
      procId: "2419",
      message: "connection received from 10.0.0.12",
    });
  });

  it("reads every body format the page lists, and only those", async () => {
    const [first, second] = requestBodyMessages() as [string, string];

    // A JSON object with a messages array.
    expect(
      SYSLOG_SERVICE.normalizeMessages({ messages: [first, second] }),
    ).toEqual([first, second]);
    // A JSON array of messages.
    expect(SYSLOG_SERVICE.normalizeMessages([first, second])).toEqual([
      first,
      second,
    ]);
    // A JSON object with one message, several lines read as several messages.
    expect(
      SYSLOG_SERVICE.normalizeMessages({ message: `${first}\n${second}` }),
    ).toEqual([first, second]);
    // Newline-separated messages, gzip-compressed: the App inflates them to bytes.
    const inflated: unknown = await inflatedBody(`${first}\n${second}\n`);

    expect(Buffer.isBuffer(inflated)).toBe(true);
    expect(SYSLOG_SERVICE.normalizeMessages(inflated)).toEqual([first, second]);

    expect(
      tableAfter(SYSLOG, "| Body | How to send it |").map(
        (cells: Array<string>): string => {
          return cells[0] as string;
        },
      ),
    ).toEqual([
      "A JSON object with a `messages` array",
      "A JSON array of messages",
      "A JSON object with one `message`",
      "Newline-separated messages",
    ]);
  });

  it("does not read a JSON body that is gzip-compressed as JSON", async () => {
    const json: string = JSON.stringify({ messages: requestBodyMessages() });

    expect(SYSLOG_SERVICE.normalizeMessages(await inflatedBody(json))).toEqual([
      json,
    ]);
    expect(englishPage(SYSLOG)).toContain(
      "A gzip-compressed body is always read as newline-separated messages, so do not compress a JSON body.",
    );
  });

  it("rejects a plain-text body that is not gzip-compressed with 400", async () => {
    // What the App's JSON body parser leaves of a text/plain body.
    const req: ExpressRequest = new PassThrough() as unknown as ExpressRequest;
    const line: string = testMessage();

    (req as unknown as { headers: Record<string, string> }).headers = {
      "content-type": "text/plain",
      "content-length": String(Buffer.byteLength(line)),
    };

    expect(
      await runMiddleware(
        ExpressJson(jsonBodyParserOptions) as RequestHandler,
        req,
      ),
    ).toBeUndefined();

    const answer: SyslogIngestAnswer = await ingestSyslog(
      (req as unknown as { body: unknown }).body,
    );

    expect(answer.passed).toBeInstanceOf(BadRequestException);
    expect(codeOf(answer.passed)).toBe(400);
    expect((answer.passed as Error).message).toBe(
      "No syslog messages found in request.",
    );
    expect(answer.calls).toEqual([]);
    expect(englishPage(SYSLOG)).toContain(
      "A plain-text body that is not gzip-compressed is not read, and the request is rejected with `400`.",
    );
    expect(detailsAnswer(SYSLOG, "HTTP 400, or no logs appear")).toContain(
      "Empty bodies — and plain-text bodies that are not gzip-compressed — are rejected with HTTP 400.",
    );
  });

  it("answers as soon as it has read the messages, and queues them after", async () => {
    const answer: SyslogIngestAnswer = await ingestSyslog({
      messages: [testMessage()],
    });

    expect(answer.passed).toBeUndefined();
    expect(answer.calls).toEqual(["answered", "queued"]);
    expect(englishPage(SYSLOG)).toContain(
      "OneUptime answers as soon as it has read the messages from the request, and parses and stores them a moment later.",
    );
  });

  it("gives the test message the attributes the table shows", () => {
    const message: string = testMessage();
    const serviceId: ObjectID = ObjectID.generate();
    const attributes: Dictionary<AttributeType | Array<AttributeType>> =
      SYSLOG_SERVICE.buildAttributes({
        parsed: parsed(message),
        primaryEntityId: serviceId,
        serviceName: "production-web",
      });
    const STRUCTURED_PAIR: RegExp = /^`([^`]+)` = `([^`]+)`$/;
    const expected: Dictionary<AttributeType> = {};

    for (const [names, , fromTestMessage] of tableAfter(
      SYSLOG,
      ATTRIBUTES_HEADER,
    ) as Array<[string, string, string]>) {
      const pair: RegExpMatchArray | null =
        fromTestMessage.match(STRUCTURED_PAIR);

      if (pair) {
        expected[pair[1] as string] = pair[2] as string;
        continue;
      }

      if (fromTestMessage === "the whole line") {
        expected[codeSpans(names)[0] as string] = message;
        continue;
      }

      const keys: Array<string> = codeSpans(names);
      const values: Array<string> = codeSpans(fromTestMessage);

      expect({ names, values: values.length }).toEqual({
        names,
        values: keys.length,
      });

      keys.forEach((key: string, index: number): void => {
        expected[key] = values[index] as string;
      });
    }

    const stored: Dictionary<string> = {};

    for (const key of Object.keys(expected)) {
      stored[key] = String(attributes[key]);
    }

    expect(stored).toEqual(expected);

    // Nothing syslog the table leaves out.
    expect(
      Object.keys(attributes)
        .filter((key: string): boolean => {
          return key.startsWith("syslog.");
        })
        .sort(),
    ).toEqual(Object.keys(expected).sort());
  });

  it("files the test message as the page says it appears", () => {
    const message: ParsedSyslogMessage = parsed(testMessage());
    const req: ExpressRequest = ingestRequest({
      "x-oneuptime-service-name": "production-web",
    });

    expect(SYSLOG_SERVICE.resolveServiceName(req, message)).toBe(
      "production-web",
    );
    expect(message.message).toBe("502 on /api/login");
    expect(SYSLOG_SERVICE.mapSeverity(message.severity).text).toBe(
      LogSeverity.Error,
    );
    expect(englishPage(SYSLOG)).toContain(
      "the log appears in the `production-web` service with the body `502 on /api/login`, severity `Error`",
    );
  });

  it("maps every syslog severity as the severity table says", () => {
    const rows: Array<Array<string>> = tableAfter(SYSLOG, SEVERITY_HEADER);
    const codes: Array<number> = [];

    for (const [names, codesCell, severity] of rows as Array<
      [string, string, string]
    >) {
      const stored: string = codeSpans(severity)[0] as string;

      if (codesCell === "—") {
        expect(names).toBe("No priority in the message");
        expect(SYSLOG_SERVICE.mapSeverity(undefined).text).toBe(stored);
        continue;
      }

      const rowCodes: Array<number> = codeSpans(codesCell).map(
        (code: string): number => {
          return parseInt(code, 10);
        },
      );
      const labels: Array<string> = names
        .split(", ")
        .map((name: string): string => {
          return name.toLowerCase();
        });

      expect({ names, labels: labels.length }).toEqual({
        names,
        labels: rowCodes.length,
      });

      rowCodes.forEach((code: number, index: number): void => {
        codes.push(code);
        expect({
          code,
          label: SYSLOG_SERVICE.getSeverityLabel(code),
          stored: SYSLOG_SERVICE.mapSeverity(code).text,
        }).toEqual({ code, label: labels[index], stored });
      });
    }

    // Every syslog severity, 0 to 7, has its row.
    expect(codes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("stores a message with no timestamp at the time it is received", () => {
    expect(parsed("<13>disk almost full").timestamp).toBeUndefined();
    expect(SYSLOG_SERVICE_SOURCE).toContain(
      "const timestamp: Date = parsed.timestamp || OneUptimeDate.getCurrentDate();",
    );
    expect(englishPage(SYSLOG)).toContain(
      "A message without a timestamp is stored with the time OneUptime received it.",
    );
  });

  it("names the service from the header, then APP-NAME, then the hostname, then Syslog", () => {
    const SERVICE_ORDER: Array<string> = [
      "the `x-oneuptime-service-name` header;",
      "the message's `APP-NAME` (or tag);",
      "the message's hostname;",
      "`Syslog`.",
    ];
    const order: string = SERVICE_ORDER.map(
      (step: string, index: number): string => {
        return `${index + 1}. ${step}`;
      },
    ).join("\n");

    expect(englishPage(SYSLOG)).toContain(order);

    const withHeader: ExpressRequest = ingestRequest({
      "x-oneuptime-service-name": "edge",
    });
    const withoutHeader: ExpressRequest = ingestRequest({});

    expect(
      SYSLOG_SERVICE.resolveServiceName(
        withHeader,
        parsed("<13>Feb  5 17:32:18 db-01 postgres[2419]: ready"),
      ),
    ).toBe("edge");
    expect(
      SYSLOG_SERVICE.resolveServiceName(
        withoutHeader,
        parsed("<13>Feb  5 17:32:18 db-01 postgres[2419]: ready"),
      ),
    ).toBe("postgres");
    expect(
      SYSLOG_SERVICE.resolveServiceName(
        withoutHeader,
        parsed('<13>Feb  5 17:32:18 fw-01 status="Terminated"'),
      ),
    ).toBe("fw-01");
    expect(
      SYSLOG_SERVICE.resolveServiceName(
        withoutHeader,
        parsed("<13>disk almost full"),
      ),
    ).toBe("Syslog");
    expect(SYSLOG_SERVICE.DEFAULT_SERVICE_NAME).toBe("Syslog");
  });

  it("finds the logs by the search examples the page gives", () => {
    const errorLine: ParsedSyslogMessage = parsed(
      "<11>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 - upstream timed out",
    );
    const attributes: Dictionary<AttributeType | Array<AttributeType>> =
      SYSLOG_SERVICE.buildAttributes({
        parsed: errorLine,
        primaryEntityId: ObjectID.generate(),
        serviceName: "nginx",
      });

    expect(attributes["syslog.severity.name"]).toBe("error");
    expect(attributes["syslog.hostname"]).toBe("web-01");
    expect(englishPage(SYSLOG)).toContain(
      "for example `@syslog.severity.name:error` or `@syslog.hostname:web-01`",
    );
  });

  it("forwards from rsyslog in the JSON body OneUptime reads", () => {
    const configuration: DocsFence = codeBlockTitled(
      SYSLOG,
      "/etc/rsyslog.d/oneuptime.conf",
    )[0] as DocsFence;
    const TEMPLATE_STRING: RegExp = /string="((?:\\"|[^"])*)"\)/;
    const template: string = (
      configuration.code.match(TEMPLATE_STRING) as RegExpMatchArray
    )[1] as string;
    const ESCAPED_QUOTE: RegExp = /\\"/g;
    const body: string = template
      .replace(ESCAPED_QUOTE, '"')
      .replace("%PRI%", "34")
      .replace("%TIMESTAMP:::date-rfc3339%", "2025-03-02T14:48:05.003Z")
      .replace("%HOSTNAME%", "web-01")
      .replace("%APP-NAME%", "nginx")
      .replace("%PROCID%", "7421")
      .replace("%MSGID%", "ID47")
      .replace("%msg:::json%", "502 on /api/login");
    const messages: Array<string> = SYSLOG_SERVICE.normalizeMessages(
      JSON.parse(body),
    );

    expect(messages.length).toBe(1);
    expect(parsed(messages[0] as string)).toMatchObject({
      version: 1,
      hostname: "web-01",
      appName: "nginx",
      procId: "7421",
      msgId: "ID47",
      message: "502 on /api/login",
    });
    expect(configuration.code).toContain('restpath="syslog/v1/logs"');
    expect(configuration.code).toContain(
      '"x-oneuptime-token: YOUR_TELEMETRY_KEY"',
    );
  });

  it("batches from rsyslog as gzip-compressed lines, which OneUptime reads one message each", async () => {
    const batching: DocsFence | undefined = codeBlockTitled(
      SYSLOG,
      "/etc/rsyslog.d/oneuptime.conf",
    ).find((fence: DocsFence): boolean => {
      return fence.code.includes('batch="on"');
    });
    const LINE_TEMPLATE: RegExp = /string="([^"]*)"\)/;
    const template: string = (
      (batching as DocsFence).code.match(LINE_TEMPLATE) as RegExpMatchArray
    )[1] as string;
    const line: (msg: string) => string = (msg: string): string => {
      return template
        .replace("%PRI%", "13")
        .replace("%TIMESTAMP:::date-rfc3339%", "2025-03-02T14:48:05.003Z")
        .replace("%HOSTNAME%", "db-01")
        .replace("%APP-NAME%", "postgres")
        .replace("%PROCID%", "2419")
        .replace("%MSGID%", "-")
        .replace("%msg%", msg);
    };

    expect((batching as DocsFence).code).toContain('batch.format="newline"');
    expect((batching as DocsFence).code).toContain('compress="on"');

    const messages: Array<string> = SYSLOG_SERVICE.normalizeMessages(
      await inflatedBody(
        `${line("checkpoint starting")}\n${line("checkpoint complete")}`,
      ),
    );

    expect(
      messages.map((message: string): string => {
        return parsed(message).message;
      }),
    ).toEqual(["checkpoint starting", "checkpoint complete"]);
  });

  it("puts syslog through the log pipelines, so a Key=Value Parser can read key=value messages", () => {
    expect(SYSLOG_SERVICE_SOURCE).toContain(
      "loadedPipelines = await LogPipelineService.loadPipelines(projectId);",
    );
    expect(SYSLOG_SERVICE_SOURCE).toContain(
      "logRow = LogPipelineService.processLog(logRow, loadedPipelines);",
    );

    // A firewall's key=value line keeps its pairs in the body.
    expect(
      parsed(
        '<134>Feb  5 17:32:18 fw-01 log_component="IPSec" con_name="HQ-Branch1" status="Terminated"',
      ).message,
    ).toBe('log_component="IPSec" con_name="HQ-Branch1" status="Terminated"');
  });
});

/*
 * The status page API, as the App mounts it under /api: its router, built
 * the way BaseAPI/Index.ts builds it.
 */
const STATUS_PAGE_API_SOURCE: string = readSource(
  "Common/Server/API/StatusPageAPI.ts",
);
const STATUS_PAGE_API_AST: ts.SourceFile = ts.createSourceFile(
  "StatusPageAPI.ts",
  STATUS_PAGE_API_SOURCE,
  ts.ScriptTarget.Latest,
  true,
);

// Every node of a tree that passes `test`, in source order.
function nodesWhere(
  root: ts.Node,
  test: (node: ts.Node) => boolean,
): Array<ts.Node> {
  const found: Array<ts.Node> = [];
  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (test(node)) {
      found.push(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(root);

  return found;
}

// The property names of an object literal, in order.
function keysOf(literal: ts.ObjectLiteralExpression): Array<string> {
  return literal.properties.map(
    (property: ts.ObjectLiteralElementLike): string => {
      return ((property as ts.PropertyAssignment).name as ts.Identifier).text;
    },
  );
}

// The keys of the `response` object a StatusPageAPI method builds.
function responseKeysOf(methodName: string): Array<string> {
  const method: ts.Node | undefined = nodesWhere(
    STATUS_PAGE_API_AST,
    (node: ts.Node): boolean => {
      return (
        ts.isMethodDeclaration(node) &&
        (node.name as ts.Identifier).text === methodName
      );
    },
  )[0];

  expect({ methodName, found: Boolean(method) }).toEqual({
    methodName,
    found: true,
  });

  const responses: Array<ts.Node> = nodesWhere(
    method as ts.Node,
    (node: ts.Node): boolean => {
      return (
        ts.isVariableDeclaration(node) &&
        (node.name as ts.Identifier).text === "response" &&
        Boolean(node.initializer) &&
        ts.isObjectLiteralExpression(node.initializer as ts.Expression)
      );
    },
  );

  expect({ methodName, responses: responses.length }).toEqual({
    methodName,
    responses: 1,
  });

  return keysOf(
    (responses[0] as ts.VariableDeclaration)
      .initializer as ts.ObjectLiteralExpression,
  );
}

// The route registration whose path mentions `path`: this.router.post(...).
function routeRegistration(pathPart: string): ts.CallExpression {
  const registrations: Array<ts.Node> = nodesWhere(
    STATUS_PAGE_API_AST,
    (node: ts.Node): boolean => {
      return (
        ts.isCallExpression(node) &&
        node.expression.getText().startsWith("this.router.") &&
        Boolean(node.arguments[0]) &&
        (node.arguments[0] as ts.Expression).getText().includes(pathPart)
      );
    },
  );

  expect({ pathPart, registrations: registrations.length }).toEqual({
    pathPart,
    registrations: 1,
  });

  return registrations[0] as ts.CallExpression;
}

// The member names of a type alias declared inside a node.
function typeMembers(root: ts.Node, typeName: string): Array<string> {
  const alias: ts.Node | undefined = nodesWhere(
    root,
    (node: ts.Node): boolean => {
      return ts.isTypeAliasDeclaration(node) && node.name.text === typeName;
    },
  )[0];

  return (
    (alias as ts.TypeAliasDeclaration).type as ts.TypeLiteralNode
  ).members.map((member: ts.TypeElement): string => {
    return (member.name as ts.Identifier).text;
  });
}

const STATUS_PAGE_ROUTES: Dictionary<Array<string>> = routesOf(
  new StatusPageAPI().getRouter(),
);

// The status page API's routes, as the docs write them under /status-page-api.
function documentedRoute(endpoint: string): string {
  const PARAMETER: RegExp = /\{([A-Za-z]+)\}/g;

  return `/status-page${endpoint.replace(PARAMETER, ":$1")}`;
}

// The keys a docs table lists, from its first column.
function keysListed(page: string, header: string): Array<string> {
  return tableAfter(page, header).flatMap(
    (cells: Array<string>): Array<string> => {
      return codeSpans(cells[0] as string);
    },
  );
}

// A request for a status page, as the access check reads it.
function statusPageRequest(): ExpressRequest {
  return {
    headers: { "x-forwarded-for": "203.0.113.9" },
    body: {},
    params: {},
    query: {},
    cookies: {},
    socket: { remoteAddress: "203.0.113.9" },
    ip: "203.0.113.9",
    ips: [],
  } as unknown as ExpressRequest;
}

interface AccessAnswer {
  hasReadAccess: boolean;
  error?: unknown;
}

// What the access check answers for a page with these settings.
async function accessTo(
  statusPage: StatusPage | null,
  lookup?: Error,
): Promise<AccessAnswer> {
  if (lookup) {
    jest
      .spyOn(StatusPageService, "findOneById")
      .mockRejectedValue(lookup as never);
  } else {
    jest
      .spyOn(StatusPageService, "findOneById")
      .mockResolvedValue(statusPage as never);
  }

  return StatusPageService.hasReadAccess({
    statusPageId: ObjectID.generate(),
    req: statusPageRequest(),
  });
}

function statusPageWith(settings: Partial<StatusPage>): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage.id = ObjectID.generate();
  statusPage.isPublicStatusPage = false;
  statusPage.isArchived = false;
  statusPage.enableMasterPassword = false;
  Object.assign(statusPage, settings);
  return statusPage;
}

/*
 * The labels of the diagram's answers, E404["404: Status Page<br/>not found"],
 * read as one line: the breaks keep the diagram inside the docs column.
 */
const DIAGRAM_ANSWER: RegExp = /(E\d{3}|OK)\["([^"]+)"\]/g;
const LINE_BREAK: RegExp = /<br\/>/g;

function diagramAnswers(): Dictionary<string> {
  const answers: Dictionary<string> = {};

  for (const match of diagram(PUBLIC_API).matchAll(DIAGRAM_ANSWER)) {
    answers[match[1] as string] = (match[2] as string).replace(
      LINE_BREAK,
      " ",
    );
  }

  return answers;
}

describe("the Public API page", () => {
  const ENDPOINTS_HEADER: string = "| Endpoint | Methods | Returns |";

  it("is served under /status-page-api, which the ingress hands to the App's /api/status-page", () => {
    const blocks: Array<string> = nginxLocations("/status-page-api/");

    // One per server block: custom domains and OneUptime's own host alike.
    expect(blocks.length).toBe(3);

    for (const block of blocks) {
      expect(block).toContain(
        "rewrite ^/status-page-api/(.*)$ /api/status-page/$1 break;",
      );
    }

    const baseApi: string = oneLine(
      readSource("App/FeatureSet/BaseAPI/Index.ts"),
    );

    expect(baseApi).toContain('const APP_NAME: string = "api";');
    expect(baseApi).toContain(
      "app.use( `/${APP_NAME.toLocaleLowerCase()}`, new StatusPageAPI().getRouter(), );",
    );
    expect(new StatusPage().getCrudApiPath()?.toString()).toBe("/status-page");

    expect(
      tableAfter(PUBLIC_API, "| Where the page runs | Base URL |").map(
        (cells: Array<string>): string => {
          return cells[1] as string;
        },
      ),
    ).toEqual([
      "`https://oneuptime.com/status-page-api`",
      "`https://<your-oneuptime-host>/status-page-api`",
      "`https://status.example.com/status-page-api`",
    ]);
  });

  it("lists every endpoint the API serves for a page, with its methods", () => {
    const rows: Array<Array<string>> = tableAfter(PUBLIC_API, ENDPOINTS_HEADER);

    expect(rows.length).toBe(10);

    for (const [endpoint, methods] of rows as Array<[string, string]>) {
      const route: string = documentedRoute(codeSpans(endpoint)[0] as string);

      expect({ route, methods: STATUS_PAGE_ROUTES[route] }).toEqual({
        route,
        methods: codeSpans(methods).sort(),
      });
    }
  });

  it("answers GET on the lists, and POST only on single items, episodes and uptime", () => {
    const page: string = englishPage(PUBLIC_API);

    expect(page).toContain(
      "The list endpoints answer `GET` as well as `POST`; the single-item endpoints and the episode endpoints answer `POST`.",
    );
    expect(
      STATUS_PAGE_ROUTES["/status-page/episodes/:statusPageIdOrDomain"],
    ).toEqual(["POST"]);
    expect(STATUS_PAGE_ROUTES["/status-page/uptime/:statusPageId"]).toEqual([
      "POST",
    ]);
  });

  it("takes the page's ID or a verified custom domain", async () => {
    // Not a UUID and no dot: no page, so 404 before any lookup.
    expect(
      await StatusPageService.resolveStatusPageIdOrNull("not-a-status-page"),
    ).toBeNull();

    const id: ObjectID = ObjectID.generate();

    expect(
      (
        await StatusPageService.resolveStatusPageIdOrNull(id.toString())
      )?.toString(),
    ).toBe(id.toString());

    // A domain is looked up among verified domains only.
    let query: unknown = undefined;

    jest
      .spyOn(StatusPageDomainService, "findOneBy")
      .mockImplementation(async (options: unknown): Promise<null> => {
        query = (options as { query: unknown }).query;
        return null;
      });

    expect(
      await StatusPageService.resolveStatusPageIdOrNull(
        `unverified-${ObjectID.generate().toString()}.example.com`,
      ),
    ).toBeNull();
    expect(query).toMatchObject({ domain: { isVerified: true } });

    expect(oneLine(STATUS_PAGE_API_SOURCE)).toContain(
      'if (!statusPageId) { throw new NotFoundException("Status Page not found"); }',
    );
    expect(englishPage(PUBLIC_API)).toContain(
      "you can send the page's ID or one of its verified custom domains, such as `status.example.com`.",
    );
  });

  it("reads the uptime endpoint's ID as is, so a domain is answered 401", async () => {
    const uptime: string = routeRegistration("/uptime/:statusPageId").getText();

    expect(uptime).not.toContain("resolveStatusPageIdOrThrow");
    expect(oneLine(uptime)).toContain(
      'new ObjectID( req.params["statusPageId"] as string, )',
    );

    // A domain is no page's ID: the lookup fails or finds nothing.
    for (const lookup of [
      new Error('invalid input syntax for type uuid: "status.example.com"'),
      undefined,
    ]) {
      const answer: AccessAnswer = await accessTo(null, lookup);

      expect(answer.hasReadAccess).toBe(false);
      expect(codeOf(answer.error)).toBe(401);
    }

    expect(englishPage(PUBLIC_API)).toContain(
      "The uptime endpoint takes the ID only, and answers a domain with `401`.",
    );
  });

  it("answers as the diagram draws it", async () => {
    const answers: Dictionary<string> = diagramAnswers();

    expect(answers).toEqual({
      E404: "404: Status Page not found",
      E403: "403: IP address blocked",
      OK: "200 with JSON",
      E401: "401: not authenticated",
    });

    // Archived: as missing.
    const archived: AccessAnswer = await accessTo(
      statusPageWith({ isArchived: true, isPublicStatusPage: true }),
    );

    expect(archived.error).toBeInstanceOf(NotFoundException);
    expect((archived.error as Error).message).toBe(
      STATUS_PAGE_NOT_FOUND_MESSAGE,
    );
    expect(`${codeOf(archived.error)}: ${STATUS_PAGE_NOT_FOUND_MESSAGE}`).toBe(
      answers["E404"],
    );

    // An allowlist without the caller: 403, even on a public page.
    const blocked: AccessAnswer = await accessTo(
      statusPageWith({ isPublicStatusPage: true, ipWhitelist: "10.0.0.0/8" }),
    );

    expect(blocked.error).toBeInstanceOf(ForbiddenException);
    expect(codeOf(blocked.error)).toBe(403);
    expect((blocked.error as Error).message).toContain("is blocked");

    // Public: read.
    expect(
      (await accessTo(statusPageWith({ isPublicStatusPage: true })))
        .hasReadAccess,
    ).toBe(true);
    expect(
      (
        await accessTo(
          statusPageWith({
            isPublicStatusPage: true,
            ipWhitelist: "203.0.113.0/24",
          }),
        )
      ).hasReadAccess,
    ).toBe(true);

    // Private, with no session: 401.
    const privatePage: AccessAnswer = await accessTo(statusPageWith({}));

    expect(privatePage.error).toBeInstanceOf(NotAuthenticatedException);
    expect(codeOf(privatePage.error)).toBe(401);

    // Private, password-protected, with no password: 401 too.
    const locked: AccessAnswer = await accessTo(
      statusPageWith({
        enableMasterPassword: true,
        masterPassword: new HashedString("not-sent"),
      }),
    );

    expect(locked.error).toBeInstanceOf(MasterPasswordRequiredException);
    expect(codeOf(locked.error)).toBe(401);
  });

  it("answers a well-formed ID that no page has as it answers a private page", async () => {
    const unknown: AccessAnswer = await accessTo(null);

    expect(unknown.error).toBeInstanceOf(NotAuthenticatedException);
    expect(codeOf(unknown.error)).toBe(401);

    const page: string = englishPage(PUBLIC_API);

    expect(page).toContain(
      "An ID that is well formed but belongs to no status page goes down the same path as a private page, and is answered `401`.",
    );
    expect(page).toContain(
      "A well-formed ID that no status page has is answered `401` too.",
    );
  });

  it("gives each error its status and a JSON body with the reason in error", () => {
    const rows: Array<Array<string>> = tableAfter(
      PUBLIC_API,
      "| Status | When |",
    );

    expect(
      rows.map((cells: Array<string>): string => {
        return codeSpans(cells[0] as string)[0] as string;
      }),
    ).toEqual([
      String(ExceptionCode.BadDataException),
      String(ExceptionCode.NotAuthenticatedException),
      String(ExceptionCode.ForbiddenException),
      String(ExceptionCode.NotFoundException),
    ]);

    const example: DocsFence | undefined = codeBlocks(PUBLIC_API).find(
      (fence: DocsFence): boolean => {
        return fence.lang === "json" && fence.code.includes('"error"');
      },
    );
    const body: JSONObject = JSON.parse(
      (example as DocsFence).code,
    ) as JSONObject;

    // The uptime endpoint throws this, and the App's last error handler answers it.
    expect(oneLine(STATUS_PAGE_API_SOURCE)).toContain(
      `throw new BadDataException( "${body["error"] as string}", );`,
    );
    expect(errorAnswer(new BadDataException(body["error"] as string))).toEqual({
      status: 400,
      body,
    });

    // And the Node.js example reads the reason from the same key.
    const node: DocsFence = codeBlockTitled(
      PUBLIC_API,
      "status.mjs",
    )[0] as DocsFence;

    expect(node.code).toContain("${body.error}");
  });

  it("refuses a list the page switches off with 400, naming the list", () => {
    const source: string = oneLine(STATUS_PAGE_API_SOURCE);

    expect(source).toContain(
      'if (!statusPage.showIncidentsOnStatusPage) { throw new BadDataException( "Incidents are not enabled on this status page.", ); }',
    );
    expect(source).toContain(
      "if (!statusPage.showEpisodesOnStatusPage) { throw new BadDataException(",
    );
    expect(source).toContain(
      "if (!statusPage.showScheduledMaintenanceEventsOnStatusPage) { throw new BadDataException(",
    );
    expect(source).toContain(
      "if (!statusPage.showAnnouncementsOnStatusPage) { throw new BadDataException(",
    );
    expect(englishPage(PUBLIC_API)).toContain(
      "A list that is switched off refuses its endpoint, for example `Incidents are not enabled on this status page.`",
    );
  });

  it("reaches each list back as far as its days setting, 14 by default", () => {
    const statusPage: StatusPage = new StatusPage();
    const source: string = oneLine(STATUS_PAGE_API_SOURCE);

    for (const section of DISPLAY_SECTIONS) {
      if (!section.days || section.id === "uptime-history") {
        continue;
      }

      const column: string = section.days.column;

      expect({
        column,
        default: statusPage.getTableColumnMetadata(column).defaultValue,
        read: source.includes(
          `OneUptimeDate.getSomeDaysAgo( statusPage.${column} || 14, )`,
        ),
      }).toEqual({ column, default: 14, read: true });
    }

    expect(
      DISPLAY_SECTIONS.filter((section: DisplaySectionDefinition): boolean => {
        return Boolean(section.days) && section.id !== "uptime-history";
      }).length,
    ).toBe(4);
    expect(DISPLAY_DAYS_SENTENCE.other).toBe("Show the last {{count}} days");
    expect(englishPage(PUBLIC_API)).toContain(
      "Each list reaches back as far as its **Show the last … days** setting (14 by default).",
    );
  });

  it("names the card the settings are on, and the downtime statuses", () => {
    const page: string = englishPage(PUBLIC_API);

    expect(StatusPageDisplaySettingsCopy.cardTitle).toBe(
      "What your status page shows",
    );
    expect(StatusPageDisplaySettingsCopy.downtimeLabel).toBe(
      "Counts as downtime",
    );
    expect(page).toContain("in the **What your status page shows** card");
    expect(page).toContain(
      "Time counts as downtime when its monitor status is one of the page's **Counts as downtime** statuses.",
    );
  });

  it("returns a record by its ID however old, and an episode the page does not show as 404", () => {
    const source: string = oneLine(STATUS_PAGE_API_SOURCE);

    expect(source).toContain(
      "if (incidentId) { incidentQuery = { monitors: monitorsOnStatusPage as any, projectId: statusPage.projectId!, _id: incidentId.toString(), }; }",
    );
    expect(source).toContain(
      'if (!incidentShownOnStatusPage) { throw new NotFoundException("Episode not found"); }',
    );
    expect(englishPage(PUBLIC_API)).toContain(
      "One the page does not show at all, such as an incident on a monitor that is not on the page, comes back as an empty list, and an episode as `404`.",
    );
  });

  it("serves the overview from a cache at most 15 seconds old", () => {
    expect(StatusPageOverviewCache.TTL_MS).toBe(15 * 1000);
    expect(englishPage(PUBLIC_API)).toContain("it is at most 15 seconds old");
  });

  it("lists every key of the overview response, and only those", () => {
    // The first "Key" table is the overview's; the uptime one comes later.
    expect(keysListed(PUBLIC_API, "| Key | What it holds |").sort()).toEqual(
      responseKeysOf("buildOverviewResponse").sort(),
    );
  });

  it("names the response keys of each list endpoint", () => {
    const rows: Array<Array<string>> = tableAfter(
      PUBLIC_API,
      "| Endpoint | Keys in the response |",
    );
    const METHOD_OF: Record<string, string> = {
      Incidents: "getIncidents",
      Episodes: "getEpisodes",
      "Scheduled maintenance events": "getScheduledMaintenanceEvents",
      Announcements: "getAnnouncements",
    };

    expect(
      rows.map((cells: Array<string>): string => {
        return cells[0] as string;
      }),
    ).toEqual(Object.keys(METHOD_OF));

    for (const [endpoint, keys] of rows as Array<[string, string]>) {
      expect({ endpoint, keys: codeSpans(keys).sort() }).toEqual({
        endpoint,
        keys: responseKeysOf(METHOD_OF[endpoint] as string).sort(),
      });
    }
  });

  it("gives the overall status as the worst status on the page, or the lowest with nothing on it", () => {
    const operational: MonitorStatus = new MonitorStatus();
    operational._id = ObjectID.generate().toString();
    operational.priority = 1;
    const degraded: MonitorStatus = new MonitorStatus();
    degraded._id = ObjectID.generate().toString();
    degraded.priority = 2;
    const offline: MonitorStatus = new MonitorStatus();
    offline._id = ObjectID.generate().toString();
    offline.priority = 3;
    const monitorStatuses: Array<MonitorStatus> = [
      operational,
      degraded,
      offline,
    ];

    const resourceIn: (status: MonitorStatus) => StatusPageResource = (
      status: MonitorStatus,
    ): StatusPageResource => {
      const resource: StatusPageResource = new StatusPageResource();
      resource.monitor = new Monitor();
      resource.monitor.currentMonitorStatusId = new ObjectID(
        status._id as string,
      );
      return resource;
    };

    expect(
      StatusPageService.getOverallMonitorStatus({
        statusPageResources: [resourceIn(degraded), resourceIn(operational)],
        monitorStatuses,
        monitorGroupCurrentStatuses: {
          [ObjectID.generate().toString()]: new ObjectID(offline._id as string),
        },
      }),
    ).toBe(offline);
    expect(
      StatusPageService.getOverallMonitorStatus({
        statusPageResources: [resourceIn(operational), resourceIn(degraded)],
        monitorStatuses,
        monitorGroupCurrentStatuses: {},
      }),
    ).toBe(degraded);
    // Nothing on the page: the project's lowest-priority status.
    expect(
      StatusPageService.getOverallMonitorStatus({
        statusPageResources: [],
        monitorStatuses,
        monitorGroupCurrentStatuses: {},
      }),
    ).toBe(operational);

    const page: string = englishPage(PUBLIC_API);

    expect(page).toContain(
      "The overall status is the worst current status of the monitors and monitor groups on the page, the one with the highest priority.",
    );
    expect(page).toContain(
      "| `overallStatus` | The page's overall status, a monitor status as above. A page with nothing on it gets the project's lowest-priority status. |",
    );
  });

  it("shows a monitor status as the overview sends it", () => {
    const example: DocsFence | undefined = codeBlocks(PUBLIC_API).find(
      (fence: DocsFence): boolean => {
        return (
          fence.lang === "json" &&
          fence.code.includes('"isOperationalState"') &&
          !fence.code.includes("statusPageResourceUptimes")
        );
      },
    );
    const shown: JSONObject = JSON.parse(
      (example as DocsFence).code,
    ) as JSONObject;
    const status: MonitorStatus = new MonitorStatus();
    status._id = shown["_id"] as string;
    status.name = shown["name"] as string;
    status.color = new Color((shown["color"] as JSONObject)["value"] as string);
    status.isOperationalState = shown["isOperationalState"] as boolean;
    status.priority = shown["priority"] as number;

    expect(
      JSON.parse(
        JSON.stringify(DatabaseBaseModel.toJSON(status, MonitorStatus)),
      ),
    ).toEqual(shown);

    // The fields the overview reads of each monitor status.
    expect(oneLine(STATUS_PAGE_API_SOURCE)).toContain(
      "const monitorStatuses: Array<MonitorStatus> = await MonitorStatusService.findBy({ query: { projectId: statusPage.projectId!, }, select: { name: true, color: true, priority: true, isOperationalState: true, }, sort: { priority: SortOrder.Ascending, },",
    );
  });

  it("shows the uptime response with the keys the endpoint sends", () => {
    const uptime: ts.CallExpression = routeRegistration(
      "/uptime/:statusPageId",
    );
    const sent: ts.Node | undefined = nodesWhere(
      uptime,
      (node: ts.Node): boolean => {
        return (
          ts.isCallExpression(node) &&
          node.expression.getText() === "Response.sendJsonObjectResponse"
        );
      },
    )[0];
    const responseKeys: Array<string> = keysOf(
      (sent as ts.CallExpression).arguments[2] as ts.ObjectLiteralExpression,
    );
    const example: DocsFence | undefined = codeBlocks(PUBLIC_API).find(
      (fence: DocsFence): boolean => {
        return (
          fence.lang === "json" &&
          fence.code.includes("statusPageResourceUptimes")
        );
      },
    );
    const shown: JSONObject = JSON.parse(
      (example as DocsFence).code,
    ) as JSONObject;
    const group: JSONObject = (
      shown["groupUptimes"] as Array<JSONObject>
    )[0] as JSONObject;
    const resource: JSONObject = (
      shown["statusPageResourceUptimes"] as Array<JSONObject>
    )[0] as JSONObject;

    expect(Object.keys(shown).sort()).toEqual([...responseKeys].sort());
    expect(Object.keys(group).sort()).toEqual(
      typeMembers(uptime, "StatusPageGroupUptime").sort(),
    );
    expect(Object.keys(resource).sort()).toEqual(
      typeMembers(uptime, "ResourceUptime").sort(),
    );
    expect(
      Object.keys(
        (
          group["statusPageResourceUptimes"] as Array<JSONObject>
        )[0] as JSONObject,
      ).sort(),
    ).toEqual(typeMembers(uptime, "ResourceUptime").sort());

    // An ID and a date as the response writes them.
    expect(
      JSON.parse(
        JSON.stringify({
          id: new ObjectID(
            (resource["statusPageResourceId"] as JSONObject)["value"] as string,
          ),
        }),
      ),
    ).toEqual({ id: resource["statusPageResourceId"] });
    expect(
      JSON.parse(JSON.stringify({ at: new Date("2026-09-01T00:00:00Z") })),
    ).toEqual({
      at: shown["startDate"],
    });

    // The table names the response's keys.
    for (const key of [
      "statusPageResourceUptimes",
      "groupUptimes",
      "uptimePercent",
      "currentStatus",
    ]) {
      expect(englishPage(PUBLIC_API)).toContain(`| \`${key}\` |`);
    }
  });

  it("covers 14 days up to now by default, and at most 90 days", () => {
    const uptime: string = oneLine(
      routeRegistration("/uptime/:statusPageId").getText(),
    );

    expect(uptime).toContain(
      "let startDate: Date = OneUptimeDate.getSomeDaysAgo(14); let endDate: Date = OneUptimeDate.getCurrentDate();",
    );
    expect(uptime).toContain(
      'if (OneUptimeDate.isAfter(startDate, endDate)) { throw new BadDataException("Start date cannot be after end date"); }',
    );
    expect(uptime).toContain(
      "OneUptimeDate.getDaysBetweenTwoDatesInclusive(startDate, endDate) > 90",
    );

    expect(tableAfter(PUBLIC_API, "| Field | Default | Notes |")).toEqual([
      ["`startDate`", "14 days ago", "An ISO 8601 date and time."],
      [
        "`endDate`",
        "Now",
        "Must not be before `startDate`. The range can cover at most 90 days.",
      ],
    ]);
  });

  it("counts a group's uptime and status over every resource beneath it", () => {
    const uptime: string = oneLine(
      routeRegistration("/uptime/:statusPageId").getText(),
    );

    expect(uptime).toContain(
      "StatusPageGroupTreeUtil.getGroupAndDescendants({",
    );
    expect(uptime).toContain("if (group.showUptimePercent) {");
    expect(uptime).toContain("if (group.showCurrentStatus) {");
    expect(uptime).toContain(
      "if (!resource.showCurrentStatus) { resourceUptime.currentStatus = null; }",
    );
    expect(englishPage(PUBLIC_API)).toContain(
      "A group's `uptimePercent` and `currentStatus` cover every resource beneath it, nested groups included; its `statusPageResourceUptimes` lists only the resources directly in it.",
    );
  });

  it("finds the status page ID on the page's Overview, in Status Page Details", () => {
    const overview: string = oneLine(
      dashboardSource("Pages/StatusPages/View/Index.tsx"),
    );

    expect(overview).toContain('cardProps={{ title: "Status Page Details", }}');
    expect(overview).toContain(
      'field: { _id: true, }, title: "Status Page ID",',
    );
    expect(statusPageSideMenuEntries()).toContain(
      `Basic${PATH_SEPARATOR}Overview`,
    );
    expect(
      oneLine(dashboardSource("Pages/StatusPages/SideMenu.tsx")),
    ).toContain('title: "All Status Pages"');
    expect(productsMenuItems()).toContain("Status Pages");
    expect(englishPage(PUBLIC_API)).toContain(
      "Open the page in the dashboard (**Status Pages → All Status Pages**, then the page). The **Status Page Details** card on its **Overview** shows the **Status Page ID**.",
    );
  });

  it("serves llms.txt next to the RSS feed, pointing at both the feed and the overview", () => {
    const frontend: string = oneLine(
      readSource("App/FeatureSet/Frontend/Index.ts"),
    );
    const handler: string = readSource(
      "App/FeatureSet/Frontend/Utils/StatusPage.ts",
    );

    expect(frontend).toContain('app.get("/rss", handleRSS);');
    expect(frontend).toContain('app.get( "/llms.txt",');
    expect(frontend).toContain(
      'app.get("/status-page/:statusPageId/llms.txt", handleLlmsTxt);',
    );
    expect(handler).toContain("- [RSS Feed](${rssFeedUrl})");
    expect(handler).toContain("- [Status Overview JSON](${overviewApiUrl})");
    expect(handler).toContain("/overview/${statusPageId}");
    expect(englishPage(PUBLIC_API)).toContain(
      "Next to `/rss`, every status page serves `/llms.txt`, which points AI agents at the RSS feed and the overview JSON.",
    );
  });

  it("reads a page over MCP with no API key, on by default and switched off under AI → MCP", () => {
    const statusPage: StatusPage = new StatusPage();
    const mcp: string = oneLine(
      dashboardSource("Pages/StatusPages/View/Mcp.tsx"),
    );
    const tools: string = oneLine(
      readSource("App/FeatureSet/MCP/Tools/PublicStatusPageTools.ts"),
    );
    const handler: string = oneLine(
      readSource("App/FeatureSet/MCP/Handlers/ToolHandler.ts"),
    );

    expect(
      statusPage.getTableColumnMetadata("enableMcpServer").defaultValue,
    ).toBe(true);
    expect(statusPage.getTableColumnMetadata("enableMcpServer").title).toBe(
      "Enable MCP Server",
    );
    expect(mcp).toContain('title="Enable MCP Server"');
    expect(mcp).toContain(
      "const mcpUrl: string = `${HTTP_PROTOCOL}${HOST}/mcp`;",
    );
    expect(statusPageSideMenuEntries()).toContain(`AI${PATH_SEPARATOR}MCP`);
    expect(tools).toContain('required: ["statusPageIdOrDomain"]');
    expect(tools).toContain(
      "await StatusPageService.isMcpServerEnabled(statusPageIdOrDomain);",
    );
    expect(handler).toContain(
      "if (isPublicStatusPageTool(name)) { logger.debug(`Executing public status page tool: ${name}`); const responseText: string = await handlePublicStatusPageTool(name, args);",
    );
    expect(englishPage(PUBLIC_API)).toContain(
      "AI agents can read the page through OneUptime's MCP server at `https://oneuptime.com/mcp`, with no API key, by passing the page's ID or domain as `statusPageIdOrDomain`. It is on by default; turn it off with **Enable MCP Server** under **AI → MCP** in the page's side menu.",
    );
  });

  it("reads the fields its examples print", () => {
    const incidents: string = oneLine(STATUS_PAGE_API_SOURCE);

    // The incidents example prints each incident's title and current state.
    expect(incidents).toContain(
      "let selectIncidents: Select<Incident> = { createdAt: true, declaredAt: true, updatedAt: true, title: true,",
    );
    expect(incidents).toContain(
      "currentIncidentState: { name: true, color: true, _id: true, order: true, },",
    );

    const node: DocsFence = codeBlockTitled(
      PUBLIC_API,
      "incidents.mjs",
    )[0] as DocsFence;
    const python: DocsFence = codeBlockTitled(
      PUBLIC_API,
      "incidents.py",
    )[0] as DocsFence;

    expect(node.code).toContain("const { incidents } = await response.json();");
    expect(node.code).toContain(
      "incident.title, incident.currentIncidentState?.name",
    );
    expect(python.code).toContain('json.load(response)["incidents"]');

    // The uptime examples print each group's name and percentage.
    for (const title of ["uptime.mjs", "uptime.py"]) {
      const example: string = (
        codeBlockTitled(PUBLIC_API, title)[0] as DocsFence
      ).code;

      expect({ title, groups: example.includes("groupUptimes") }).toEqual({
        title,
        groups: true,
      });
      expect(example).toContain("statusPageGroupName");
      expect(example).toContain("uptimePercent");
    }
  });
});
