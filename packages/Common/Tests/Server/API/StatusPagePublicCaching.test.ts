import StatusPageIncidentCategoryService from "../../../Server/Services/StatusPageIncidentCategoryService";
import File from "../../../Models/DatabaseModels/File";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import StatusPageFooterLinkService from "../../../Server/Services/StatusPageFooterLinkService";
import StatusPageHeaderLinkService from "../../../Server/Services/StatusPageHeaderLinkService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "../../../Server/Services/StatusPageService";
import StatusPageSsoService from "../../../Server/Services/StatusPageSsoService";
import CookieUtil from "../../../Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import { STATUS_PAGE_IMAGE_MAX_AGE_SECONDS } from "../../../Server/Utils/StatusPage/StatusPageAccessRules";
import StatusPageImageCache from "../../../Server/Utils/StatusPage/StatusPageImageCache";
import StatusPageOverviewCache, {
  STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE,
  StatusPageOverviewBase,
} from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { MASTER_PASSWORD_COOKIE_IDENTIFIER } from "../../../Types/StatusPage/MasterPassword";
import FakeGlobalCacheStrings from "../TestingUtils/Redis/FakeGlobalCacheStrings";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT A STATUS PAGE KEEPS FOR ITS VISITORS, AND WHO IT IS NEVER KEPT FOR.
 *
 * A public status page's view reads nothing from Postgres once it is kept:
 * the page's rules of who may read it, its SEO row and settings, its
 * overview, the lists its tabs read and its images (StatusPageReadCache,
 * StatusPageOverviewCache, StatusPageImageCache). These run every route as
 * a browser reaches it - the real caches, the real read check and the real
 * Response - over a stand-in for the page's rows, and pin down:
 *
 *   - hits, misses, and what starts a new generation of a page's copies,
 *     here and in another pod;
 *   - every page kept apart from every other;
 *   - privacy, the hard rule: a page that limits who sees it - signing in,
 *     a master password, single sign-on, an IP allow list - is never served
 *     from a copy to a visitor it does not let in, never sent a public
 *     Cache-Control, also when it is made private while its copies are kept,
 *     on its custom domain or on OneUptime's;
 *   - images: Cache-Control, ETag and 304;
 *   - how stale a page can be: what a visitor sees right after an incident
 *     is posted, and that the lifetime is short enough for an outage.
 *
 * Redis is a stand-in every "pod" shares (FakeGlobalCacheStrings). Another
 * pod is this process with its own memory cleared.
 */

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

const API_PATH: string = "/status-page";

const ROUTES: Dictionary<string> = {
  seo: `${API_PATH}/seo/:statusPageIdOrDomain`,
  domain: `${API_PATH}/domain`,
  masterPage: `${API_PATH}/master-page/:statusPageId`,
  overview: `${API_PATH}/overview/:statusPageIdOrDomain`,
  summary: `${API_PATH}/summary/:statusPageIdOrDomain`,
  favicon: `${API_PATH}/favicon/:statusPageIdOrDomain`,
  logo: `${API_PATH}/logo/:statusPageIdOrDomain`,
  darkThemeLogo: `${API_PATH}/dark-theme-logo/:statusPageIdOrDomain`,
  coverImage: `${API_PATH}/cover-image/:statusPageIdOrDomain`,
  incidents: `${API_PATH}/incidents/:statusPageIdOrDomain`,
  incident: `${API_PATH}/incidents/:statusPageIdOrDomain/:incidentId`,
  episodes: `${API_PATH}/episodes/:statusPageIdOrDomain`,
  scheduledMaintenance: `${API_PATH}/scheduled-maintenance-events/:statusPageIdOrDomain`,
  announcements: `${API_PATH}/announcements/:statusPageIdOrDomain`,
};

// The lists a page's tabs read, and what builds each.
const LISTS: Array<{ route: string; builder: string }> = [
  { route: ROUTES["incidents"]!, builder: "incidents" },
  { route: ROUTES["episodes"]!, builder: "episodes" },
  {
    route: ROUTES["scheduledMaintenance"]!,
    builder: "scheduledMaintenance",
  },
  { route: ROUTES["announcements"]!, builder: "announcements" },
];

const PRIMARY_HOST: string = "oneuptime.example.com";
const VISITOR_IP: string = "203.0.113.9";

// A status page as its rows hold it.
interface PageState {
  id: ObjectID;
  projectId: ObjectID;
  domain: string;
  pageTitle: string;
  isPublicStatusPage: boolean;
  enableMasterPassword: boolean;
  masterPassword: string | undefined;
  ipWhitelist: string | undefined;
  requireSsoForLogin: boolean;
  isArchived: boolean;
  customJavaScript: string;
  favicon: Buffer | undefined;
  logo: Buffer | undefined;
  // What the page's lists show, by list.
  incidents: Array<string>;
}

let pages: Map<string, PageState>;

// Each read of a page's row, by what it was for.
let rowReads: Array<string>;

// Each build of a page's overview, list or uptime history.
let builds: Array<string>;

let redis: FakeGlobalCacheStrings;

function addPage(overrides?: Partial<PageState>): PageState {
  const id: ObjectID = ObjectID.generate();

  const page: PageState = {
    id: id,
    projectId: ObjectID.generate(),
    domain: `status-${id.toString().slice(0, 8)}.example.test`,
    pageTitle: "Acme status",
    isPublicStatusPage: true,
    enableMasterPassword: false,
    masterPassword: undefined,
    ipWhitelist: undefined,
    requireSsoForLogin: false,
    isArchived: false,
    customJavaScript: "window.tenantCode = true;",
    favicon: Buffer.from(`favicon of ${id.toString()}`),
    logo: Buffer.from(`logo of ${id.toString()}`),
    incidents: ["Website is slow"],
    ...(overrides || {}),
  };

  pages.set(id.toString(), page);

  return page;
}

function pageOf(id: unknown): PageState | undefined {
  return pages.get(String(id));
}

function fileOf(page: PageState, bytes: Buffer | undefined): File | undefined {
  if (!bytes) {
    return undefined;
  }

  const file: File = new File();
  file._id = ObjectID.generate().toString();
  file.file = bytes;
  file.fileType = "image/png" as never;
  file.name = "image.png";
  file.projectId = page.projectId;
  return file;
}

// A page's row with the columns a read selects.
function rowOf(page: PageState, select: Dictionary<unknown>): StatusPage {
  const row: StatusPage = new StatusPage();
  row._id = page.id.toString();

  const columns: Dictionary<unknown> = {
    projectId: page.projectId,
    pageTitle: page.pageTitle,
    name: page.pageTitle,
    isPublicStatusPage: page.isPublicStatusPage,
    enableMasterPassword: page.enableMasterPassword,
    masterPassword: page.masterPassword,
    ipWhitelist: page.ipWhitelist,
    requireSsoForLogin: page.requireSsoForLogin,
    isArchived: page.isArchived,
    customJavaScript: page.customJavaScript,
    customCSS: "body { color: red; }",
    headerHTML: "<b>tenant header</b>",
    footerHTML: "<b>tenant footer</b>",
    faviconFile: fileOf(page, page.favicon),
    logoFile: fileOf(page, page.logo),
    showIncidentsOnStatusPage: true,
  };

  for (const column of Object.keys(select)) {
    if (column in columns && columns[column] !== undefined) {
      (row as unknown as Dictionary<unknown>)[column] = columns[column];
    }
  }

  return row;
}

// What a read of a page's row was for, by what it selects.
function purposeOf(select: Dictionary<unknown>): string {
  if ("ipWhitelist" in select) {
    return "access-rules";
  }

  if ("enableSearchEngineIndexing" in select) {
    return "seo";
  }

  if ("logoAltText" in select) {
    return "master-page";
  }

  for (const image of ["faviconFile", "logoFile", "darkThemeLogoFile"]) {
    if (image in select) {
      return `image:${image}`;
    }
  }

  if (Object.keys(select).join(",") === "projectId") {
    return "project";
  }

  return `other:${Object.keys(select).join(",")}`;
}

function installPageRows(): void {
  jest
    .spyOn(StatusPageService, "findOneById")
    .mockImplementation((async (args: {
      id: ObjectID;
      select: Dictionary<unknown>;
    }) => {
      const page: PageState | undefined = pageOf(args.id);
      rowReads.push(purposeOf(args.select));
      return page ? rowOf(page, args.select) : null;
    }) as never);

  jest.spyOn(StatusPageService, "findOneBy").mockImplementation((async (args: {
    query: Dictionary<unknown>;
    select: Dictionary<unknown>;
  }) => {
    const page: PageState | undefined = pageOf(args.query["_id"]);
    rowReads.push(purposeOf(args.select));

    if (!page || (args.query["isArchived"] === false && page.isArchived)) {
      return null;
    }

    return rowOf(page, args.select);
  }) as never);

  // A custom domain: verified, for its own page only.
  jest
    .spyOn(StatusPageDomainService, "findOneBy")
    .mockImplementation((async (args: { query: Dictionary<unknown> }) => {
      const page: PageState | undefined = Array.from(pages.values()).find(
        (candidate: PageState): boolean => {
          return candidate.domain === args.query["fullDomain"];
        },
      );

      if (
        !page ||
        (args.query["statusPageId"] &&
          String(args.query["statusPageId"]) !== page.id.toString())
      ) {
        return null;
      }

      rowReads.push("domain");

      return { _id: ObjectID.generate().toString(), statusPageId: page.id };
    }) as never);

  jest
    .spyOn(StatusPageSsoService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest
    .spyOn(StatusPageFooterLinkService, "findBy")
    .mockResolvedValue([] as never);
  jest.spyOn(StatusPageIncidentCategoryService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(StatusPageHeaderLinkService, "findBy")
    .mockResolvedValue([] as never);
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

  // What the page shows, built from its rows - counted per build.
  jest
    .spyOn(StatusPageAPI.prototype, "buildOverviewBase")
    .mockImplementation(async (statusPageId: ObjectID) => {
      const page: PageState = pageOf(statusPageId)!;
      builds.push(`overview:${page.id.toString()}`);

      const base: StatusPageOverviewBase = {
        response: {
          pageTitle: page.pageTitle,
          activeIncidents: page.incidents.map((title: string) => {
            return { title: title };
          }),
        },
        uptimeHistory: {
          monitorIds: [],
          monitorGroups: [],
          rankedMonitorStatusIds: [],
          startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          endDate: new Date(),
        },
      };

      return base;
    });

  jest.spyOn(StatusPageAPI.prototype, "buildUptimeHistory").mockImplementation(
    async (data: {
      timezone: string;
    }): Promise<{
      json: JSONObject;
      cutIn: string;
    }> => {
      builds.push(`history:${data.timezone}`);
      return {
        json: { uptimeDailyAggregate: { timezone: data.timezone } },
        cutIn: data.timezone,
      };
    },
  );

  const list: (
    name: string,
  ) => (statusPageId: ObjectID) => Promise<JSONObject> = (name: string) => {
    return async (statusPageId: ObjectID): Promise<JSONObject> => {
      const page: PageState = pageOf(statusPageId)!;
      builds.push(`${name}:${page.id.toString()}`);
      return {
        list: name,
        page: page.id.toString(),
        incidents: [...page.incidents],
      };
    };
  };

  jest
    .spyOn(StatusPageAPI.prototype, "readShownIncidents")
    .mockImplementation(list("incidents"));
  jest
    .spyOn(StatusPageAPI.prototype, "readShownEpisodes")
    .mockImplementation(list("episodes"));
  jest
    .spyOn(StatusPageAPI.prototype, "readShownAnnouncements")
    .mockImplementation(list("announcements"));
  jest
    .spyOn(StatusPageAPI, "readShownScheduledMaintenanceEvents")
    .mockImplementation(
      async (data: { statusPageId: ObjectID }): Promise<JSONObject> => {
        return await list("scheduledMaintenance")(data.statusPageId);
      },
    );
}

// What a request answered, as a browser sees it.
interface Answer {
  status: number;
  headers: Dictionary<string>;
  body: unknown;
  error: unknown;
}

function makeRequest(data: {
  params: Dictionary<string>;
  host: string;
  body?: JSONObject | undefined;
  headers?: Dictionary<string> | undefined;
  cookies?: Dictionary<string> | undefined;
}): ExpressRequest {
  const headers: Dictionary<string> = {
    host: data.host,
    "x-forwarded-for": VISITOR_IP,
    ...(data.headers || {}),
  };

  return {
    params: data.params,
    body: data.body || {},
    query: {},
    cookies: data.cookies || {},
    headers: headers,
    hostname: data.host,
    socket: { remoteAddress: VISITOR_IP },
    ip: VISITOR_IP,
    ips: [],
    method: "GET",
    get: (name: string): string | undefined => {
      return headers[name.toLowerCase()];
    },
  } as unknown as ExpressRequest;
}

function makeResponse(answer: Answer): ExpressResponse {
  const response: Record<string, unknown> = {
    headersSent: false,
    locals: {},
    set: (key: string, value: string): unknown => {
      answer.headers[key.toLowerCase()] = String(value);
      return response;
    },
    setHeader: (key: string, value: string): unknown => {
      answer.headers[key.toLowerCase()] = String(value);
      return response;
    },
    getHeader: (key: string): string | undefined => {
      return answer.headers[key.toLowerCase()];
    },
    removeHeader: (key: string): void => {
      delete answer.headers[key.toLowerCase()];
    },
    status: (code: number): unknown => {
      answer.status = code;
      return response;
    },
    send: (body: unknown): unknown => {
      answer.body = body;
      return response;
    },
    end: (body?: unknown): unknown => {
      answer.body = body;
      return response;
    },
    sendFile: (): void => {
      answer.body = "the default favicon";
    },
  };

  return response as unknown as ExpressResponse;
}

// A request, as Express runs it: the page's gate first, then the route.
async function call(data: {
  route: string;
  params: Dictionary<string>;
  method?: "get" | "post" | undefined;
  host?: string | undefined;
  body?: JSONObject | undefined;
  headers?: Dictionary<string> | undefined;
  cookies?: Dictionary<string> | undefined;
}): Promise<Answer> {
  const answer: Answer = {
    status: 200,
    headers: {},
    body: undefined,
    error: undefined,
  };
  const req: ExpressRequest = makeRequest({
    params: data.params,
    host: data.host || PRIMARY_HOST,
    body: data.body,
    headers: data.headers,
    cookies: data.cookies,
  });
  const res: ExpressResponse = makeResponse(answer);

  for (const param of mockRouter.params) {
    const value: string | undefined = data.params[param.name];

    if (value === undefined) {
      continue;
    }

    let isLetThrough: boolean = false;

    await new Promise<void>((resolve: () => void) => {
      void param.handler(
        req,
        res,
        ((err?: unknown) => {
          isLetThrough = !err;
          resolve();
        }) as NextFunction,
        value,
        param.name,
      );
      setTimeout(resolve, 50);
    });

    if (!isLetThrough) {
      return answer;
    }
  }

  const methods: Array<"get" | "post"> = data.method
    ? [data.method]
    : ["get", "post"];

  const route:
    | {
        handlerFunction: (
          req: ExpressRequest,
          res: ExpressResponse,
          next: NextFunction,
        ) => void | Promise<void>;
      }
    | undefined = methods
    .map((method: "get" | "post") => {
      try {
        return mockRouter.match(method, data.route);
      } catch {
        return undefined;
      }
    })
    .find(Boolean);

  await route!.handlerFunction(req, res, ((err?: unknown) => {
    answer.error = err;
  }) as NextFunction);

  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });

  return answer;
}

function page(route: string, statusPageIdOrDomain: string): Dictionary<string> {
  void route;
  return { statusPageIdOrDomain: statusPageIdOrDomain };
}

async function overview(
  target: PageState,
  options?: {
    host?: string;
    cookies?: Dictionary<string>;
    timezone?: string;
  },
): Promise<Answer> {
  return await call({
    route: ROUTES["overview"]!,
    method: "post",
    params: page("overview", target.id.toString()),
    host: options?.host,
    cookies: options?.cookies,
    body: { timezone: options?.timezone || "Europe/Berlin" },
  });
}

async function image(
  target: PageState,
  route: string,
  headers?: Dictionary<string>,
): Promise<Answer> {
  return await call({
    route: route,
    method: "get",
    params: page(route, target.domain),
    host: target.domain,
    headers: headers,
  });
}

async function openList(
  target: PageState,
  route: string,
  cookies?: Dictionary<string>,
): Promise<Answer> {
  return await call({
    route: route,
    method: "post",
    params: page(route, target.id.toString()),
    host: target.domain,
    cookies: cookies,
  });
}

async function openItem(
  target: PageState,
  incidentId: string,
  cookies?: Dictionary<string>,
): Promise<Answer> {
  return await call({
    route: ROUTES["incident"]!,
    method: "post",
    params: {
      statusPageIdOrDomain: target.id.toString(),
      incidentId: incidentId,
    },
    host: target.domain,
    cookies: cookies,
  });
}

async function masterPage(target: PageState, host: string): Promise<Answer> {
  return await call({
    route: ROUTES["masterPage"]!,
    method: "post",
    params: { statusPageId: target.id.toString() },
    host: host,
  });
}

function count(list: Array<string>, entry: string): number {
  return list.filter((item: string): boolean => {
    return item === entry;
  }).length;
}

// The page's settings changed by a write, as DatabaseService reports it.
async function writePage(
  target: PageState,
  written: Partial<PageState> & Dictionary<unknown>,
): Promise<void> {
  Object.assign(target, written);

  await StatusPageOverviewCache.afterUpdate({
    tableName: "StatusPage",
    rows: [{ projectId: target.projectId.toString() }],
    written: written,
  });
}

/*
 * Another pod of the install: its own memory - every cache, the domains
 * and projects it resolved - and the same Redis.
 */
function becomeAnotherPod(): void {
  StatusPageAPI.clearOverviewResponseCache();
  StatusPageService.clearStatusPageDomainToIdCache();
  StatusPageService.clearProjectIdOfStatusPageCache();
}

// A write in another pod: the project's new generation, in Redis alone.
function changeInAnotherPod(target: PageState): void {
  redis.setRaw(
    `${STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE}-generation-${target.projectId
      .toString()
      .toLowerCase()}`,
    `changed-${ObjectID.generate().toString()}`,
  );
}

// Moves the clock on, for everything that reads Date.now().
function advanceClock(ms: number): void {
  const now: number = Date.now() + ms;
  jest.spyOn(Date, "now").mockReturnValue(now);
}

function masterPasswordCookie(target: PageState): Dictionary<string> {
  return {
    [CookieUtil.getStatusPageMasterPasswordKey(target.id)]:
      JSONWebToken.signJsonPayload(
        {
          statusPageId: target.id.toString(),
          type: MASTER_PASSWORD_COOKIE_IDENTIFIER,
        },
        3600,
      ),
  };
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  mockRouter.params.length = 0;
  new StatusPageAPI();
});

beforeEach(() => {
  pages = new Map<string, PageState>();
  rowReads = [];
  builds = [];

  StatusPageAPI.clearOverviewResponseCache();
  StatusPageService.clearStatusPageDomainToIdCache();
  StatusPageService.clearProjectIdOfStatusPageCache();

  redis = new FakeGlobalCacheStrings().install();
  installPageRows();

  process.env["HOST"] = PRIMARY_HOST;
});

afterEach(() => {
  jest.restoreAllMocks();
  StatusPageAPI.clearOverviewResponseCache();
});

describe("a public page's view, kept for every visitor", () => {
  test("the second visitor of a page reads none of its rows and builds nothing", async () => {
    const acme: PageState = addPage();

    const first: Answer = await overview(acme);
    expect(first.error).toBeUndefined();

    const readsAfterFirst: number = rowReads.length;
    const buildsAfterFirst: number = builds.length;

    const second: Answer = await overview(acme);

    expect(second.error).toBeUndefined();
    expect(rowReads.length).toBe(readsAfterFirst);
    expect(builds.length).toBe(buildsAfterFirst);
    expect(second.body).toEqual(first.body);

    // Kept by no cache in front of OneUptime, as before.
    expect(second.headers["cache-control"]).toBe(
      "no-store, no-cache, must-revalidate",
    );
  });

  test("the page's rules of who may read it are read once, not once per request of a view", async () => {
    const acme: PageState = addPage();

    for (let i: number = 0; i < 5; i++) {
      expect((await overview(acme)).error).toBeUndefined();
      for (const list of LISTS) {
        expect((await openList(acme, list.route)).error).toBeUndefined();
      }
    }

    expect(count(rowReads, "access-rules")).toBe(1);
  });

  test("SEO, settings, lists and images are each read once for every visitor", async () => {
    const acme: PageState = addPage();

    for (let i: number = 0; i < 3; i++) {
      expect(
        (
          await call({
            route: ROUTES["seo"]!,
            method: "get",
            params: { statusPageIdOrDomain: acme.domain },
          })
        ).status,
      ).toBe(200);
      expect((await masterPage(acme, acme.domain)).status).toBe(200);
      expect((await image(acme, ROUTES["favicon"]!)).status).toBe(200);

      for (const list of LISTS) {
        expect((await openList(acme, list.route)).status).toBe(200);
      }
    }

    expect(count(rowReads, "seo")).toBe(1);
    expect(count(rowReads, "master-page")).toBe(1);
    expect(count(rowReads, "image:faviconFile")).toBe(1);

    for (const list of LISTS) {
      expect(count(builds, `${list.builder}:${acme.id.toString()}`)).toBe(1);
    }
  });

  test("the summary reads the overview the page keeps", async () => {
    const acme: PageState = addPage();

    await overview(acme);
    const builtBefore: number = builds.length;

    const summary: Answer = await call({
      route: ROUTES["summary"]!,
      method: "get",
      params: { statusPageIdOrDomain: acme.id.toString() },
    });

    expect(summary.error).toBeUndefined();
    expect(builds.length).toBe(builtBefore);
  });

  test("an item opened by its id - a subscriber's email link - is kept like its list, and apart from it", async () => {
    const acme: PageState = addPage();
    const incidentId: string = ObjectID.generate().toString();

    for (let i: number = 0; i < 3; i++) {
      const answer: Answer = await openItem(acme, incidentId);

      expect(answer.error).toBeUndefined();
      expect((answer.body as JSONObject)["incidents"]).toEqual(acme.incidents);
      // A page's item, too, is kept by no cache in front of OneUptime.
      expect(answer.headers["cache-control"]).toBe(
        "no-store, no-cache, must-revalidate",
      );
    }

    expect(count(builds, `incidents:${acme.id.toString()}`)).toBe(1);

    // Another item, and the list, are each their own.
    await openItem(acme, ObjectID.generate().toString());
    await openList(acme, ROUTES["incidents"]!);

    expect(count(builds, `incidents:${acme.id.toString()}`)).toBe(3);
  });

  test("an item the page does not show - or an id nobody has - is read every time, never kept", async () => {
    const acme: PageState = addPage({ incidents: [] });

    for (let i: number = 0; i < 3; i++) {
      expect(
        (
          (await openItem(acme, ObjectID.generate().toString()))
            .body as JSONObject
        )["incidents"],
      ).toEqual([]);
    }

    const sameId: string = ObjectID.generate().toString();
    await openItem(acme, sameId);
    await openItem(acme, sameId);

    expect(count(builds, `incidents:${acme.id.toString()}`)).toBe(5);
    expect(
      redis.keys().filter((key: string): boolean => {
        return key.includes("|item-");
      }),
    ).toEqual([]);
  });

  test("an item taken off the page leaves its copy at once", async () => {
    const acme: PageState = addPage({ incidents: ["Website is slow"] });
    const incidentId: string = ObjectID.generate().toString();

    await openItem(acme, incidentId);

    acme.incidents = [];
    await StatusPageOverviewCache.afterUpdate({
      tableName: "Incident",
      rows: [{ projectId: acme.projectId.toString() }],
      written: { isVisibleOnStatusPage: false },
    });

    expect(
      ((await openItem(acme, incidentId)).body as JSONObject)["incidents"],
    ).toEqual([]);
  });
});

describe("every page kept apart", () => {
  test("each page is served its own overview, lists, settings and images - in one project or two", async () => {
    const acme: PageState = addPage({ pageTitle: "Acme", incidents: ["A"] });
    const sameProject: PageState = addPage({
      pageTitle: "Acme EU",
      projectId: acme.projectId,
      incidents: ["B"],
    });
    const otherProject: PageState = addPage({
      pageTitle: "Globex",
      incidents: ["C"],
    });

    for (const target of [acme, sameProject, otherProject, acme]) {
      const shown: Answer = await overview(target);
      expect((shown.body as JSONObject)["pageTitle"]).toBe(target.pageTitle);

      const incidents: Answer = await openList(target, ROUTES["incidents"]!);
      expect((incidents.body as JSONObject)["page"]).toBe(target.id.toString());
      expect((incidents.body as JSONObject)["incidents"]).toEqual(
        target.incidents,
      );

      const favicon: Answer = await image(target, ROUTES["favicon"]!);
      expect(favicon.body).toEqual(target.favicon);

      const settings: Answer = await masterPage(target, target.domain);
      expect(
        ((settings.body as JSONObject)["statusPage"] as JSONObject)["_id"],
      ).toBe(target.id.toString());
    }
  });

  test("a change to one project's page leaves another project's pages kept", async () => {
    const acme: PageState = addPage();
    const globex: PageState = addPage();

    await overview(acme);
    await overview(globex);

    await writePage(acme, { pageTitle: "Acme, renamed" });

    builds = [];
    await overview(acme);
    await overview(globex);

    expect(builds).toEqual([
      `overview:${acme.id.toString()}`,
      "history:Europe/Berlin",
    ]);
  });
});

describe("what takes a page's copies away", () => {
  test("a write to the page's settings shows at once: a new title, a new favicon", async () => {
    const acme: PageState = addPage();

    const before: Answer = await image(acme, ROUTES["favicon"]!);
    expect((await overview(acme)).body).toMatchObject({
      pageTitle: "Acme status",
    });

    await writePage(acme, {
      pageTitle: "Acme, renamed",
      favicon: Buffer.from("a new favicon"),
    });

    expect((await overview(acme)).body).toMatchObject({
      pageTitle: "Acme, renamed",
    });

    const after: Answer = await image(acme, ROUTES["favicon"]!);
    expect(after.body).toEqual(Buffer.from("a new favicon"));
    expect(after.headers["etag"]).not.toBe(before.headers["etag"]);
  });

  test("an incident taken off the page leaves its lists at once", async () => {
    const acme: PageState = addPage({ incidents: ["Website is slow"] });

    expect(
      ((await openList(acme, ROUTES["incidents"]!)).body as JSONObject)[
        "incidents"
      ],
    ).toEqual(["Website is slow"]);

    acme.incidents = [];
    await StatusPageOverviewCache.afterUpdate({
      tableName: "Incident",
      rows: [{ projectId: acme.projectId.toString() }],
      written: { isPrivate: true },
    });

    expect(
      ((await openList(acme, ROUTES["incidents"]!)).body as JSONObject)[
        "incidents"
      ],
    ).toEqual([]);
  });

  test("a change made in another pod leaves this pod's copies within SHARED_GENERATION_READ_TTL_MS", async () => {
    const acme: PageState = addPage({ incidents: ["Website is slow"] });

    await openList(acme, ROUTES["incidents"]!);

    acme.incidents = [];
    changeInAnotherPod(acme);

    advanceClock(StatusPageOverviewCache.SHARED_GENERATION_READ_TTL_MS + 1);

    expect(
      ((await openList(acme, ROUTES["incidents"]!)).body as JSONObject)[
        "incidents"
      ],
    ).toEqual([]);
  });
});

describe("a page built once for every pod", () => {
  test("another pod serves the overview, its uptime history and the lists one pod built", async () => {
    const acme: PageState = addPage();

    const here: Answer = await overview(acme);
    const lists: Array<Answer> = [];
    for (const list of LISTS) {
      lists.push(await openList(acme, list.route));
    }

    becomeAnotherPod();
    builds = [];

    const there: Answer = await overview(acme);

    expect(there.body).toEqual(here.body);

    for (let i: number = 0; i < LISTS.length; i++) {
      expect((await openList(acme, LISTS[i]!.route)).body).toEqual(
        lists[i]!.body,
      );
    }

    // Nothing built again: not the overview, not its history, not a list.
    expect(builds).toEqual([]);
  });

  test("an overview read from Redis is served no longer than one built here: the TTL_MS of its build", async () => {
    const acme: PageState = addPage();

    await overview(acme);

    // Another pod reads it 10 s after it was built...
    advanceClock(10_000);
    becomeAnotherPod();
    builds = [];
    await overview(acme);
    expect(builds).toEqual([]);

    // ...and keeps it only for the 5 s its build has left.
    advanceClock(5_001);
    await overview(acme);
    expect(builds).toContain(`overview:${acme.id.toString()}`);
  });

  test("while Redis cannot be reached, each pod builds its own, as before", async () => {
    const acme: PageState = addPage();
    redis.isReachable = false;

    await overview(acme);
    becomeAnotherPod();
    await overview(acme);

    expect(count(builds, `overview:${acme.id.toString()}`)).toBe(2);
  });
});

/*
 * PRIVACY: every way a page limits who sees it. Anonymous visitors are
 * refused - never served a copy kept for those it lets in - and nothing of
 * the page is sent with a public Cache-Control.
 */
const PRIVATE_PAGES: Array<{
  name: string;
  state: Partial<PageState>;
  error: string;
}> = [
  {
    name: "a page its readers sign in to",
    state: { isPublicStatusPage: false },
    error: "NotAuthenticatedException",
  },
  {
    name: "a page behind a master password",
    state: {
      isPublicStatusPage: false,
      enableMasterPassword: true,
      masterPassword: "a-password-hash",
    },
    error: "MasterPasswordRequiredException",
  },
  {
    name: "a page that requires single sign-on",
    state: { isPublicStatusPage: false, requireSsoForLogin: true },
    error: "NotAuthenticatedException",
  },
  {
    name: "a public page with an IP allow list the visitor is not on",
    state: { isPublicStatusPage: true, ipWhitelist: "198.51.100.0/24" },
    error: "ForbiddenException",
  },
];

describe("privacy: a page that limits who sees it", () => {
  test.each(PRIVATE_PAGES)(
    "$name: an anonymous visitor is refused the overview and every list, before any copy is asked for",
    async ({ state, error }: { state: Partial<PageState>; error: string }) => {
      const restricted: PageState = addPage(state);

      const shown: Answer = await overview(restricted);
      expect((shown.error as Error).constructor.name).toBe(error);
      expect(shown.body).toBeUndefined();

      for (const list of LISTS) {
        const answer: Answer = await openList(restricted, list.route);
        expect((answer.error as Error).constructor.name).toBe(error);
        expect(answer.body).toBeUndefined();
      }

      // Nor an incident opened from an email's link.
      const item: Answer = await openItem(
        restricted,
        ObjectID.generate().toString(),
      );
      expect((item.error as Error).constructor.name).toBe(error);
      expect(item.body).toBeUndefined();

      // Nothing was built for a visitor the page does not let in.
      expect(builds).toEqual([]);
    },
  );

  test.each(PRIVATE_PAGES)(
    "$name: its images are never sent with a public Cache-Control",
    async ({ state }: { state: Partial<PageState> }) => {
      const restricted: PageState = addPage(state);

      for (const route of [ROUTES["favicon"]!, ROUTES["logo"]!]) {
        for (let i: number = 0; i < 2; i++) {
          const answer: Answer = await image(restricted, route);

          expect(answer.status).toBe(200);
          expect(answer.headers["cache-control"]).toBe(
            `private, max-age=${STATUS_PAGE_IMAGE_MAX_AGE_SECONDS}`,
          );
          expect(answer.headers["cache-control"]).not.toContain("public");
        }
      }
    },
  );

  test("a visitor a page lets in is served its copy, which a page's other visitor is refused", async () => {
    const restricted: PageState = addPage({
      isPublicStatusPage: false,
      enableMasterPassword: true,
      masterPassword: "a-password-hash",
    });

    const allowed: Answer = await overview(restricted, {
      cookies: masterPasswordCookie(restricted),
    });
    expect(allowed.error).toBeUndefined();
    expect(allowed.body).toMatchObject({ pageTitle: "Acme status" });
    expect(allowed.headers["cache-control"]).toBe(
      "no-store, no-cache, must-revalidate",
    );

    // The copy is kept - and still not served to a visitor without the password.
    const refused: Answer = await overview(restricted);
    expect((refused.error as Error).constructor.name).toBe(
      "MasterPasswordRequiredException",
    );
    expect(refused.body).toBeUndefined();

    // A password for another page lets nobody in here.
    const otherPage: PageState = addPage();
    const wrongCookie: Answer = await overview(restricted, {
      cookies: {
        [CookieUtil.getStatusPageMasterPasswordKey(restricted.id)]:
          masterPasswordCookie(otherPage)[
            CookieUtil.getStatusPageMasterPasswordKey(otherPage.id)
          ]!,
      },
    });
    expect(wrongCookie.body).toBeUndefined();
  });

  test("an archived page is served from no copy: it reads as a page that does not exist", async () => {
    const acme: PageState = addPage();

    await overview(acme);
    await image(acme, ROUTES["logo"]!);

    await writePage(acme, { isArchived: true });

    const shown: Answer = await overview(acme);
    expect((shown.error as Error).constructor.name).toBe("NotFoundException");

    const logo: Answer = await image(acme, ROUTES["logo"]!);
    expect(logo.status).toBe(404);
  });
});

describe("privacy: a page made private while it is kept", () => {
  test("made private here: refused at once, and its images are private at once", async () => {
    const acme: PageState = addPage();
    const incidentId: string = ObjectID.generate().toString();

    expect((await overview(acme)).error).toBeUndefined();
    for (const list of LISTS) {
      expect((await openList(acme, list.route)).error).toBeUndefined();
    }
    expect((await openItem(acme, incidentId)).error).toBeUndefined();
    expect(
      (await image(acme, ROUTES["favicon"]!)).headers["cache-control"],
    ).toBe(`public, max-age=${STATUS_PAGE_IMAGE_MAX_AGE_SECONDS}`);

    await writePage(acme, { isPublicStatusPage: false });

    const shown: Answer = await overview(acme);
    expect((shown.error as Error).constructor.name).toBe(
      "NotAuthenticatedException",
    );
    expect(shown.body).toBeUndefined();

    for (const list of LISTS) {
      const answer: Answer = await openList(acme, list.route);
      expect(answer.body).toBeUndefined();
    }
    expect((await openItem(acme, incidentId)).body).toBeUndefined();

    expect(
      (await image(acme, ROUTES["favicon"]!)).headers["cache-control"],
    ).toBe(`private, max-age=${STATUS_PAGE_IMAGE_MAX_AGE_SECONDS}`);
  });

  test.each([
    ["an IP allow list added", { ipWhitelist: "198.51.100.0/24" }],
    [
      "a master password",
      {
        isPublicStatusPage: false,
        enableMasterPassword: true,
        masterPassword: "a-password-hash",
      },
    ],
    [
      "single sign-on required",
      { isPublicStatusPage: false, requireSsoForLogin: true },
    ],
  ])(
    "%s here: refused at once",
    async (_name: string, written: Partial<PageState>) => {
      const acme: PageState = addPage();

      expect((await overview(acme)).error).toBeUndefined();

      await writePage(acme, written);

      expect((await overview(acme)).body).toBeUndefined();
      expect(
        (await image(acme, ROUTES["favicon"]!)).headers["cache-control"],
      ).toContain("private");
    },
  );

  test("made private in another pod: refused here within SHARED_GENERATION_READ_TTL_MS, though this pod's copies have not run out", async () => {
    const acme: PageState = addPage();

    expect((await overview(acme)).error).toBeUndefined();

    acme.isPublicStatusPage = false;
    changeInAnotherPod(acme);

    advanceClock(StatusPageOverviewCache.SHARED_GENERATION_READ_TTL_MS + 1);

    // Well within the 5 s the rules are kept, and the overview's 15 s.
    const shown: Answer = await overview(acme);
    expect((shown.error as Error).constructor.name).toBe(
      "NotAuthenticatedException",
    );
    expect(shown.body).toBeUndefined();
    expect(
      (await image(acme, ROUTES["favicon"]!)).headers["cache-control"],
    ).toBe(`private, max-age=${STATUS_PAGE_IMAGE_MAX_AGE_SECONDS}`);
  });

  test("while Redis cannot be reached, the rules are read on every request: a change made in another pod is seen at once", async () => {
    const acme: PageState = addPage();
    redis.isReachable = false;

    expect((await overview(acme)).error).toBeUndefined();

    // Another pod makes the page private; nothing can tell this one.
    acme.isPublicStatusPage = false;

    const shown: Answer = await overview(acme);
    expect((shown.error as Error).constructor.name).toBe(
      "NotAuthenticatedException",
    );
    expect(shown.body).toBeUndefined();
    expect(count(rowReads, "access-rules")).toBe(2);
  });
});

describe("privacy: custom domains", () => {
  test("the settings kept with a page's custom code for its own domain are never served on OneUptime's host", async () => {
    const acme: PageState = addPage();

    const onItsDomain: Answer = await masterPage(acme, acme.domain);
    expect(
      (onItsDomain.body as JSONObject)["allowStatusPageCustomizations"],
    ).toBe(true);
    expect(
      ((onItsDomain.body as JSONObject)["statusPage"] as JSONObject)[
        "customJavaScript"
      ],
    ).toBe(acme.customJavaScript);

    const onOneUptime: Answer = await masterPage(acme, PRIMARY_HOST);
    expect(
      (onOneUptime.body as JSONObject)["allowStatusPageCustomizations"],
    ).toBe(false);
    expect(JSON.stringify(onOneUptime.body)).not.toContain("tenantCode");
    expect(JSON.stringify(onOneUptime.body)).not.toContain("tenant header");

    // And the other way round, from a copy kept for OneUptime's host first.
    const globex: PageState = addPage();
    await masterPage(globex, PRIMARY_HOST);
    expect(
      JSON.stringify((await masterPage(globex, globex.domain)).body),
    ).toContain("tenantCode");
  });

  test("a private page on its custom domain is refused there too, and its images are private", async () => {
    const acme: PageState = addPage({ isPublicStatusPage: false });

    const shown: Answer = await call({
      route: ROUTES["overview"]!,
      method: "post",
      params: { statusPageIdOrDomain: acme.domain },
      host: acme.domain,
    });

    expect((shown.error as Error).constructor.name).toBe(
      "NotAuthenticatedException",
    );
    expect(
      (await image(acme, ROUTES["favicon"]!)).headers["cache-control"],
    ).toBe(`private, max-age=${STATUS_PAGE_IMAGE_MAX_AGE_SECONDS}`);
  });

  test("a page served on its domain and by its id is one page: one overview", async () => {
    const acme: PageState = addPage();

    await call({
      route: ROUTES["overview"]!,
      method: "post",
      params: { statusPageIdOrDomain: acme.domain },
      host: acme.domain,
    });
    await overview(acme);

    expect(count(builds, `overview:${acme.id.toString()}`)).toBe(1);
  });

  test("the app's question, which page is this domain, is answered from the domain kept for the page's HTML", async () => {
    const acme: PageState = addPage();

    await call({
      route: ROUTES["seo"]!,
      method: "get",
      params: { statusPageIdOrDomain: acme.domain },
    });

    const before: number = count(rowReads, "domain");

    const answer: Answer = await call({
      route: ROUTES["domain"]!,
      method: "post",
      params: {},
      host: acme.domain,
      body: { domain: acme.domain },
    });

    expect(answer.body).toEqual({ statusPageId: acme.id.toString() });
    expect(count(rowReads, "domain")).toBe(before);
  });
});

describe("images: kept in memory, with Cache-Control and an ETag", () => {
  test.each([
    ["favicon", ROUTES["favicon"]!],
    ["logo", ROUTES["logo"]!],
  ])(
    "the %s carries a public Cache-Control and a strong ETag, and a browser that has it gets 304",
    async (_name: string, route: string) => {
      const acme: PageState = addPage();

      const first: Answer = await image(acme, route);

      expect(first.status).toBe(200);
      expect(first.headers["cache-control"]).toBe(
        `public, max-age=${STATUS_PAGE_IMAGE_MAX_AGE_SECONDS}`,
      );
      expect(first.headers["etag"]).toBe(
        StatusPageImageCache.getETag(first.body as Buffer),
      );
      expect(first.headers["x-content-type-options"]).toBe("nosniff");
      expect(first.headers["pragma"]).toBeUndefined();

      const fresh: Answer = await image(acme, route, {
        "if-none-match": first.headers["etag"]!,
      });

      expect(fresh.status).toBe(304);
      expect(fresh.body).toBeUndefined();
      expect(fresh.headers["etag"]).toBe(first.headers["etag"]);

      const stale: Answer = await image(acme, route, {
        "if-none-match": '"an-older-tag"',
      });

      expect(stale.status).toBe(200);
      expect(stale.body).toEqual(first.body);
    },
  );

  test("a page without a favicon gets the default one, as before - from its kept answer", async () => {
    const acme: PageState = addPage({ favicon: undefined });

    for (let i: number = 0; i < 2; i++) {
      const answer: Answer = await image(acme, ROUTES["favicon"]!);
      expect(answer.body).toBe("the default favicon");
    }

    expect(count(rowReads, "image:faviconFile")).toBe(1);
  });

  test("a page without a logo answers 404, as before", async () => {
    const acme: PageState = addPage({ logo: undefined });

    const answer: Answer = await image(acme, ROUTES["logo"]!);

    expect(answer.status).toBe(404);
    expect(answer.headers["cache-control"]).toBeUndefined();
  });

  test("a page that does not exist is never kept", async () => {
    const missing: string = ObjectID.generate().toString();

    for (let i: number = 0; i < 2; i++) {
      await call({
        route: ROUTES["logo"]!,
        method: "get",
        params: { statusPageIdOrDomain: missing },
      });
    }

    expect(count(rowReads, "image:logoFile")).toBe(2);
    expect(StatusPageImageCache.getSize().entries).toBe(0);
  });
});

describe("how stale a page can be", () => {
  test("TTL_MS is short enough for an outage page: 15 seconds", () => {
    expect(StatusPageOverviewCache.TTL_MS).toBe(15_000);
    expect(StatusPageServiceType.ACCESS_RULES_TTL_MS).toBeLessThanOrEqual(
      StatusPageOverviewCache.TTL_MS,
    );
  });

  test("an incident posted while the page is kept is shown within TTL_MS - on the overview and its list", async () => {
    const acme: PageState = addPage({ incidents: [] });

    expect((await overview(acme)).body).toMatchObject({ activeIncidents: [] });
    expect(
      ((await openList(acme, ROUTES["incidents"]!)).body as JSONObject)[
        "incidents"
      ],
    ).toEqual([]);

    // Posted now: a write that can only show more starts no new generation.
    acme.incidents = ["Checkout is down"];

    // Within the lifetime, a visitor may still see the page as it was...
    advanceClock(StatusPageOverviewCache.TTL_MS - 1_000);
    expect((await overview(acme)).body).toMatchObject({ activeIncidents: [] });

    // ...and once it runs out, every visitor sees the incident.
    advanceClock(1_001);
    expect((await overview(acme)).body).toMatchObject({
      activeIncidents: [{ title: "Checkout is down" }],
    });
    expect(
      ((await openList(acme, ROUTES["incidents"]!)).body as JSONObject)[
        "incidents"
      ],
    ).toEqual(["Checkout is down"]);
  });

  test("a page's settings are kept no longer than SETTINGS_TTL_MS, even with no write to mark a change", async () => {
    const acme: PageState = addPage();

    await masterPage(acme, acme.domain);
    expect(count(rowReads, "master-page")).toBe(1);

    advanceClock(StatusPageAPI.SETTINGS_TTL_MS + 1);
    await masterPage(acme, acme.domain);
    expect(count(rowReads, "master-page")).toBe(2);
  });
});
