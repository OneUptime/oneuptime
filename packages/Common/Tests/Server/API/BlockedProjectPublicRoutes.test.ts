jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import DashboardAPI from "../../../Server/API/DashboardAPI";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import PublicDashboardRateLimit from "../../../Server/Middleware/PublicDashboardRateLimit";
import DashboardDomainService from "../../../Server/Services/DashboardDomainService";
import DashboardService from "../../../Server/Services/DashboardService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import StatusPageFooterLinkService from "../../../Server/Services/StatusPageFooterLinkService";
import StatusPageHeaderLinkService from "../../../Server/Services/StatusPageHeaderLinkService";
import StatusPageOidcService from "../../../Server/Services/StatusPageOidcService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSsoService from "../../../Server/Services/StatusPageSsoService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { STATUS_PAGE_ROUTE_PARAMS } from "../../../Server/Utils/StatusPage/BlockedProjectStatusPages";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import CookieParser from "cookie-parser";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

/*
 * A real Express app: an error that walks the many routes registered after
 * the one that threw is deferred with setImmediate, which Common's jsdom
 * environment does not expose (see ArchivedPublicRoutes.test.ts). Lend it
 * Node's.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * ---------------------------------------------------------------------------
 * A BLOCKED PROJECT'S STATUS PAGES AND PUBLIC DASHBOARDS ARE TAKEN DOWN.
 *
 * A master admin blocks a project (Admin Dashboard > Projects) to take it
 * offline - spam sites have used status pages to put pages for pirated films
 * into search results. Every public route then answers its pages the way it
 * answers a page that does not exist, kept out of search results; a page of
 * a project that is not blocked answers exactly as before, and unblocking
 * puts every page back.
 *
 * The real routers on a real Express app with the production error handler;
 * only the data layer is stubbed. The status page API is walked route by
 * route: every route that names a page - by id or by custom domain - must
 * answer a blocked page as not found, so a route added later that slips past
 * the gate fails here.
 * ---------------------------------------------------------------------------
 */

const BLOCKED_PROJECT_ID: ObjectID = new ObjectID(
  "b10c0000-0000-4000-8000-0000000000b1",
);
const LIVE_PROJECT_ID: ObjectID = new ObjectID(
  "b10c0000-0000-4000-8000-0000000000a1",
);

const BLOCKED_PAGE_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-000000000001",
);
const LIVE_PAGE_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-000000000002",
);
const BLOCKED_PAGE_DOMAIN: string = "status.pirated-films.example";
const LIVE_PAGE_DOMAIN: string = "status.acme.example";

const BLOCKED_DASHBOARD_ID: ObjectID = new ObjectID(
  "da000000-0000-4000-8000-0000000000b1",
);
const LIVE_DASHBOARD_ID: ObjectID = new ObjectID(
  "da000000-0000-4000-8000-0000000000a1",
);
const BLOCKED_DASHBOARD_DOMAIN: string = "metrics.pirated-films.example";
const LIVE_DASHBOARD_DOMAIN: string = "metrics.acme.example";

const BADGE_TOKEN: string = "badge-token";

const NOINDEX: string = "noindex, nofollow";

// Which projects a master admin blocked, as the Project rows say.
const blockedProjectIds: Set<string> = new Set<string>();

function buildPage(id: ObjectID, projectId: ObjectID): StatusPage {
  const page: StatusPage = new StatusPage();
  page.id = id;
  page._id = id.toString();
  page.projectId = projectId;
  page.name = `Page ${id.toString()}`;
  page.pageTitle = `Title ${id.toString()}`;
  page.pageDescription = "A status page.";
  page.isPublicStatusPage = true;
  page.isArchived = false;
  page.enableEmbeddedOverallStatus = true;
  page.embeddedOverallStatusToken = BADGE_TOKEN;
  return page;
}

function buildDashboard(id: ObjectID, projectId: ObjectID): Dashboard {
  const dashboard: Dashboard = new Dashboard();
  dashboard.id = id;
  dashboard._id = id.toString();
  dashboard.projectId = projectId;
  dashboard.name = `Dashboard ${id.toString()}`;
  dashboard.pageTitle = `Dashboard title ${id.toString()}`;
  dashboard.isPublicDashboard = true;
  dashboard.isArchived = false;
  dashboard.enableMasterPassword = false;
  return dashboard;
}

const PAGES: Dictionary<() => StatusPage> = {
  [BLOCKED_PAGE_ID.toString()]: () => {
    return buildPage(BLOCKED_PAGE_ID, BLOCKED_PROJECT_ID);
  },
  [LIVE_PAGE_ID.toString()]: () => {
    return buildPage(LIVE_PAGE_ID, LIVE_PROJECT_ID);
  },
};

const PAGE_DOMAINS: Dictionary<ObjectID> = {
  [BLOCKED_PAGE_DOMAIN]: BLOCKED_PAGE_ID,
  [LIVE_PAGE_DOMAIN]: LIVE_PAGE_ID,
};

const DASHBOARDS: Dictionary<() => Dashboard> = {
  [BLOCKED_DASHBOARD_ID.toString()]: () => {
    return buildDashboard(BLOCKED_DASHBOARD_ID, BLOCKED_PROJECT_ID);
  },
  [LIVE_DASHBOARD_ID.toString()]: () => {
    return buildDashboard(LIVE_DASHBOARD_ID, LIVE_PROJECT_ID);
  },
};

const DASHBOARD_DOMAINS: Dictionary<ObjectID> = {
  [BLOCKED_DASHBOARD_DOMAIN]: BLOCKED_DASHBOARD_ID,
  [LIVE_DASHBOARD_DOMAIN]: LIVE_DASHBOARD_ID,
};

/*
 * A fresh row on every read, as the database hands one: routes change the
 * rows they read before sending them (the master page drops the page's
 * projectId), and a stub that handed out one shared object would carry that
 * into every later read.
 */
function lookUp<T>(rows: Dictionary<() => T>, id: unknown): T | null {
  const build: (() => T) | undefined = rows[String(id).toLowerCase()];
  return build ? build() : null;
}

/*
 * A findOneBy that honours the plain-value filters the routes send, so a
 * route that asks for `isArchived: false` (or a badge token) really filters.
 */
function matches(
  row: Record<string, unknown>,
  query: Dictionary<unknown>,
): boolean {
  for (const key of Object.keys(query)) {
    const expected: unknown = query[key];

    if (key === "_id") {
      if (String(expected).toLowerCase() !== String(row["_id"])) {
        return false;
      }
      continue;
    }

    if (
      typeof expected === "boolean" ||
      typeof expected === "string" ||
      typeof expected === "number"
    ) {
      if (row[key] !== expected) {
        return false;
      }
    }
  }

  return true;
}

type HttpResult = {
  status: number;
  body: JSONObject | null;
  robots: string | undefined;
  contentType: string | undefined;
};

function send(data: {
  port: number;
  method: string;
  path: string;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const hasBody: boolean = data.method !== "GET";
      const payload: string = hasBody ? JSON.stringify(data.body || {}) : "";

      const headers: http.OutgoingHttpHeaders = { tenantid: "" };

      if (hasBody) {
        headers["content-type"] = "application/json";
        headers["content-length"] = Buffer.byteLength(payload);
      }

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: data.method,
          headers,
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | null = null;

            try {
              body = raw ? (JSON.parse(raw) as JSONObject) : null;
            } catch {
              body = { raw };
            }

            const robots: string | string[] | undefined =
              response.headers["x-robots-tag"];

            resolve({
              status: response.statusCode || 0,
              body,
              robots: Array.isArray(robots) ? robots.join(", ") : robots,
              contentType: response.headers["content-type"],
            });
          });
        },
      );

      request.on("error", reject);

      if (payload) {
        request.write(payload);
      }

      request.end();
    },
  );
}

function errorMessageOf(result: HttpResult): unknown {
  return (
    result.body?.["message"] ?? result.body?.["error"] ?? result.body?.["raw"]
  );
}

// A route of a router, as Express keeps it.
type RouterRoute = { path: string; methods: Array<string> };

type RouterLayer = {
  route?: { path: string; methods: Dictionary<boolean> };
};

function routesOf(router: { stack: Array<RouterLayer> }): Array<RouterRoute> {
  const routes: Array<RouterRoute> = [];

  for (const layer of router.stack) {
    if (!layer.route) {
      continue;
    }

    routes.push({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods)
        .filter((method: string): boolean => {
          return Boolean(layer.route!.methods[method]);
        })
        .map((method: string): string => {
          return method.toUpperCase();
        }),
    });
  }

  return routes;
}

function paramsOf(path: string): Array<string> {
  return (path.match(/:[A-Za-z]+/g) || []).map((param: string) => {
    return param.slice(1);
  });
}

/*
 * The route's path with the page put in for the parameter that names it,
 * and a well-formed value for every other parameter.
 */
function urlFor(data: {
  routePath: string;
  page: string;
  pageParam?: string | undefined;
}): string {
  return `/api${data.routePath.replace(
    /:([A-Za-z]+)/g,
    (_match: string, param: string): string => {
      if (data.pageParam ? param === data.pageParam : isPageParam(param)) {
        return data.page;
      }

      if (param === "token") {
        return "a".repeat(64);
      }

      if (param === "resourceType") {
        return "monitor";
      }

      return ObjectID.generate().toString();
    },
  )}`;
}

function isPageParam(param: string): boolean {
  return STATUS_PAGE_ROUTE_PARAMS.includes(param);
}

let server: http.Server;
let port: number;
let statusPageRoutes: Array<RouterRoute>;
let dashboardRoutes: Array<RouterRoute>;

let projectFindOneById: jest.SpyInstance;
let statusPageFindOneById: jest.SpyInstance;
let statusPageDomainFindOneBy: jest.SpyInstance;
let footerLinksFindBy: jest.SpyInstance;

function forgetEverythingCached(): void {
  for (const projectId of [BLOCKED_PROJECT_ID, LIVE_PROJECT_ID]) {
    ProjectService.forgetBlockedStatus(projectId);
  }

  StatusPageService.clearProjectIdOfStatusPageCache();
  StatusPageService.clearStatusPageDomainToIdCache();
}

beforeAll(async () => {
  /*
   * The dashboard routes' rate limiter fails closed without Redis; it has
   * its own tests. Let every request through, so these reach the route.
   */
  jest
    .spyOn(PublicDashboardRateLimit, "getMiddleware")
    .mockReturnValue(
      async (
        _req: ExpressRequest,
        _res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        next();
      },
    );

  projectFindOneById = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      const project: Project = new Project();
      project.id = data.id;
      project.isBlocked = blockedProjectIds.has(
        data.id.toString().toLowerCase(),
      );
      return project;
    }) as never);

  statusPageFindOneById = jest
    .spyOn(StatusPageService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      return lookUp(PAGES, data.id);
    }) as never);

  jest.spyOn(StatusPageService, "findOneBy").mockImplementation((async (data: {
    query: Dictionary<unknown>;
  }) => {
    const page: StatusPage | undefined = Object.values(PAGES)
      .map((build: () => StatusPage): StatusPage => {
        return build();
      })
      .find((candidate: StatusPage): boolean => {
        return matches(
          candidate as unknown as Record<string, unknown>,
          data.query,
        );
      });
    return page || null;
  }) as never);

  statusPageDomainFindOneBy = jest
    .spyOn(StatusPageDomainService, "findOneBy")
    .mockImplementation((async (data: { query: Dictionary<unknown> }) => {
      const statusPageId: ObjectID | undefined =
        PAGE_DOMAINS[String(data.query["fullDomain"])];

      if (!statusPageId) {
        return null;
      }

      const domain: StatusPageDomain = new StatusPageDomain();
      domain.statusPageId = statusPageId;
      return domain;
    }) as never);

  jest.spyOn(StatusPageResourceService, "findBy").mockResolvedValue([]);
  jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(StatusPageSsoService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(StatusPageSsoService, "findBy").mockResolvedValue([]);
  jest.spyOn(StatusPageOidcService, "findBy").mockResolvedValue([]);
  footerLinksFindBy = jest
    .spyOn(StatusPageFooterLinkService, "findBy")
    .mockResolvedValue([]);
  jest.spyOn(StatusPageHeaderLinkService, "findBy").mockResolvedValue([]);

  jest.spyOn(DashboardService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    return lookUp(DASHBOARDS, data.id);
  }) as never);

  jest
    .spyOn(DashboardDomainService, "findOneBy")
    .mockImplementation((async (data: { query: Dictionary<unknown> }) => {
      const dashboardId: ObjectID | undefined =
        DASHBOARD_DOMAINS[String(data.query["fullDomain"])];

      if (!dashboardId) {
        return null;
      }

      const domain: DashboardDomain = new DashboardDomain();
      domain.dashboardId = dashboardId;
      return domain;
    }) as never);

  const statusPageAPI: StatusPageAPI = new StatusPageAPI();
  const dashboardAPI: DashboardAPI = new DashboardAPI();

  statusPageRoutes = routesOf(
    statusPageAPI.getRouter() as unknown as { stack: Array<RouterLayer> },
  );
  dashboardRoutes = routesOf(
    dashboardAPI.getRouter() as unknown as { stack: Array<RouterLayer> },
  );

  const app: express.Express = express();
  app.use(CookieParser());
  app.use(express.json());
  app.use("/api", dashboardAPI.getRouter());
  app.use("/api", statusPageAPI.getRouter());
  app.use(expressErrorHandler);

  server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });

  forgetEverythingCached();
  jest.restoreAllMocks();
});

beforeEach(() => {
  blockedProjectIds.clear();
  blockedProjectIds.add(BLOCKED_PROJECT_ID.toString().toLowerCase());
  forgetEverythingCached();
  jest.clearAllMocks();
});

// Every public route of the status page API that names a page.
function pageRoutes(): Array<RouterRoute> {
  return statusPageRoutes.filter((route: RouterRoute): boolean => {
    return paramsOf(route.path).some(isPageParam);
  });
}

function expectTakenDown(label: string, result: HttpResult): void {
  expect({
    label,
    status: result.status,
    message: errorMessageOf(result),
    robots: result.robots,
  }).toEqual({
    label,
    status: 404,
    message: "Status Page not found",
    robots: NOINDEX,
  });
}

describe("a status page of a blocked project", () => {
  it("the gate stands in front of the routes the status page app and its visitors use", () => {
    const paths: Array<string> = pageRoutes().map((route: RouterRoute) => {
      return route.path;
    });

    /*
     * Not the whole list - pageRoutes() is what the tests below walk - but
     * the surfaces that matter most, so the walk can never pass by finding
     * nothing to walk.
     */
    for (const expected of [
      "/status-page/seo/:statusPageIdOrDomain",
      "/status-page/favicon/:statusPageIdOrDomain",
      "/status-page/logo/:statusPageIdOrDomain",
      "/status-page/dark-theme-logo/:statusPageIdOrDomain",
      "/status-page/cover-image/:statusPageIdOrDomain",
      "/status-page/master-page/:statusPageId",
      "/status-page/master-password/:statusPageId",
      "/status-page/overview/:statusPageIdOrDomain",
      // What another OneUptime's External Status Page monitor reads.
      "/status-page/summary/:statusPageIdOrDomain",
      "/status-page/incidents/:statusPageIdOrDomain",
      "/status-page/incidents/:statusPageIdOrDomain/:incidentId",
      "/status-page/announcements/:statusPageIdOrDomain",
      "/status-page/announcements/:statusPageIdOrDomain/:announcementId",
      "/status-page/scheduled-maintenance-events/:statusPageIdOrDomain",
      "/status-page/episodes/:statusPageIdOrDomain",
      "/status-page/badge/:statusPageId",
      "/status-page/subscribe/:statusPageId",
      "/status-page/manage-subscription/:statusPageId",
      "/status-page/update-subscription/:statusPageId/:subscriberId/:token",
      "/status-page/get-subscription/:statusPageId/:subscriberId/:token",
      "/status-page/resources/:statusPageId",
      "/status-page/uptime/:statusPageId",
      "/status-page/sso/:statusPageId",
      "/status-page/oidc/:statusPageId",
      "/status-page/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it("every route that names the page by its id answers it as a page that does not exist, noindex", async () => {
    let checked: number = 0;

    for (const route of pageRoutes()) {
      for (const method of route.methods) {
        const result: HttpResult = await send({
          port,
          method,
          path: urlFor({
            routePath: route.path,
            page: BLOCKED_PAGE_ID.toString(),
          }),
        });

        expectTakenDown(`${method} ${route.path}`, result);
        checked++;
      }
    }

    expect(checked).toBeGreaterThanOrEqual(30);
  });

  it("every route that takes a page by its custom domain answers the blocked page's domain the same way", async () => {
    const domainRoutes: Array<RouterRoute> = pageRoutes().filter(
      (route: RouterRoute): boolean => {
        return paramsOf(route.path).includes("statusPageIdOrDomain");
      },
    );

    expect(domainRoutes.length).toBeGreaterThanOrEqual(10);

    for (const route of domainRoutes) {
      for (const method of route.methods) {
        const result: HttpResult = await send({
          port,
          method,
          path: urlFor({
            routePath: route.path,
            page: BLOCKED_PAGE_DOMAIN,
            pageParam: "statusPageIdOrDomain",
          }),
        });

        expectTakenDown(`${method} ${route.path} (custom domain)`, result);
      }
    }
  });

  it("is answered before the route's own code reads anything of the page", async () => {
    const result: HttpResult = await send({
      port,
      method: "POST",
      path: `/api/status-page/master-page/${BLOCKED_PAGE_ID.toString()}`,
    });

    expectTakenDown("master page", result);

    // The page's links are the master page route's own reads.
    expect(footerLinksFindBy).not.toHaveBeenCalled();

    // The only read of the page is its project, for the gate.
    for (const call of statusPageFindOneById.mock.calls) {
      expect((call[0] as { select: unknown }).select).toEqual({
        projectId: true,
      });
    }
  });

  it("answers /seo word for word as it answers a page that was never made", async () => {
    const blocked: HttpResult = await send({
      port,
      method: "GET",
      path: `/api/status-page/seo/${BLOCKED_PAGE_ID.toString()}`,
    });
    const missing: HttpResult = await send({
      port,
      method: "GET",
      path: `/api/status-page/seo/${ObjectID.generate().toString()}`,
    });

    expect(missing.status).toBe(404);
    expect(blocked.status).toBe(missing.status);
    expect(blocked.body).toEqual(missing.body);
  });

  it("its custom domain resolves to no page, as a domain no page has", async () => {
    const blocked: HttpResult = await send({
      port,
      method: "POST",
      path: "/api/status-page/domain",
      body: { domain: BLOCKED_PAGE_DOMAIN },
    });
    const unknown: HttpResult = await send({
      port,
      method: "POST",
      path: "/api/status-page/domain",
      body: { domain: "nobody.example.com" },
    });

    expect(unknown.status).toBe(400);
    expect(blocked.status).toBe(unknown.status);
    expect(errorMessageOf(blocked)).toBe(errorMessageOf(unknown));
    expect(errorMessageOf(blocked)).toBe(
      "No status page found with this domain",
    );
  });

  it("leaves the dashboard's own routes for the page (/:id) to their own access rules", async () => {
    const result: HttpResult = await send({
      port,
      method: "POST",
      path: `/api/status-page/${BLOCKED_PAGE_ID.toString()}/get-item`,
    });

    /*
     * The record routes every model has name the record :id, not the page's
     * public parameters: what they answer is up to their own middleware and
     * permissions, never the takedown.
     */
    expect(result.robots).toBeUndefined();
    expect(errorMessageOf(result)).not.toBe("Status Page not found");
  });
});

describe("a status page of a project that is not blocked", () => {
  it("answers as it always has, and is not marked noindex", async () => {
    const seo: HttpResult = await send({
      port,
      method: "GET",
      path: `/api/status-page/seo/${LIVE_PAGE_ID.toString()}`,
    });

    expect(seo.status).toBe(200);
    expect(seo.body?.["title"]).toBe(`Title ${LIVE_PAGE_ID.toString()}`);
    expect(seo.robots).toBeUndefined();

    const masterPage: HttpResult = await send({
      port,
      method: "POST",
      path: `/api/status-page/master-page/${LIVE_PAGE_ID.toString()}`,
    });

    expect(masterPage.status).toBe(200);
    expect(
      (masterPage.body?.["statusPage"] as JSONObject | undefined)?.["_id"],
    ).toBe(LIVE_PAGE_ID.toString());
    expect(masterPage.robots).toBeUndefined();

    for (const listing of ["sso", "oidc", "resources"]) {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/status-page/${listing}/${LIVE_PAGE_ID.toString()}`,
      });

      expect({ listing, status: result.status, robots: result.robots }).toEqual(
        { listing, status: 200, robots: undefined },
      );
    }
  });

  it("on its custom domain too", async () => {
    const seo: HttpResult = await send({
      port,
      method: "GET",
      path: `/api/status-page/seo/${LIVE_PAGE_DOMAIN}`,
    });

    expect(seo.status).toBe(200);
    expect(seo.body?.["_id"]).toBe(LIVE_PAGE_ID.toString());

    const domain: HttpResult = await send({
      port,
      method: "POST",
      path: "/api/status-page/domain",
      body: { domain: LIVE_PAGE_DOMAIN },
    });

    expect(domain.status).toBe(200);
    expect(domain.body?.["statusPageId"]).toBe(LIVE_PAGE_ID.toString());
  });
});

describe("blocking and unblocking", () => {
  it("unblocking the project puts its pages back, on the next request", async () => {
    const path: string = `/api/status-page/seo/${BLOCKED_PAGE_ID.toString()}`;

    expect((await send({ port, method: "GET", path })).status).toBe(404);

    // What ProjectService.onUpdateSuccess does when the flag is written.
    blockedProjectIds.clear();
    ProjectService.forgetBlockedStatus(BLOCKED_PROJECT_ID);

    const unblocked: HttpResult = await send({ port, method: "GET", path });

    expect(unblocked.status).toBe(200);
    expect(unblocked.body?.["title"]).toBe(
      `Title ${BLOCKED_PAGE_ID.toString()}`,
    );
    expect(unblocked.robots).toBeUndefined();
  });

  it("blocking a project takes its pages down on the next request", async () => {
    const path: string = `/api/status-page/master-page/${LIVE_PAGE_ID.toString()}`;

    expect((await send({ port, method: "POST", path })).status).toBe(200);

    blockedProjectIds.add(LIVE_PROJECT_ID.toString().toLowerCase());
    ProjectService.forgetBlockedStatus(LIVE_PROJECT_ID);

    expectTakenDown(
      "master page after the block",
      await send({ port, method: "POST", path }),
    );
  });
});

describe("what the gate costs", () => {
  it("reads the project, the page's project and the domain once, however many requests a page view makes", async () => {
    const requests: Array<{ method: string; path: string }> = [];

    for (const page of [BLOCKED_PAGE_ID.toString(), BLOCKED_PAGE_DOMAIN]) {
      for (const route of [
        "seo",
        "favicon",
        "logo",
        "overview",
        "incidents",
        "announcements",
      ]) {
        requests.push({
          method: route === "overview" ? "POST" : "GET",
          path: `/api/status-page/${route}/${page}`,
        });
      }
    }

    for (let pageView: number = 0; pageView < 3; pageView++) {
      for (const request of requests) {
        expectTakenDown(
          `${request.method} ${request.path}`,
          await send({ port, method: request.method, path: request.path }),
        );
      }
    }

    // Whether the project is blocked: once.
    expect(projectFindOneById).toHaveBeenCalledTimes(1);

    // The page's project: once.
    expect(statusPageFindOneById).toHaveBeenCalledTimes(1);

    // The custom domain: once.
    expect(statusPageDomainFindOneBy).toHaveBeenCalledTimes(1);
  });

  it("fails open: when the project cannot be read, the page goes through to its route", async () => {
    projectFindOneById.mockRejectedValueOnce(new Error("database unavailable"));

    const seo: HttpResult = await send({
      port,
      method: "GET",
      path: `/api/status-page/seo/${BLOCKED_PAGE_ID.toString()}`,
    });

    // The read that failed was the gate's, and the route answered as usual.
    expect(projectFindOneById).toHaveBeenCalledTimes(1);
    expect(seo.status).toBe(200);
    expect(seo.robots).toBeUndefined();
  });
});

describe("a public dashboard of a blocked project", () => {
  // Every public route of the dashboard API that names a dashboard.
  function dashboardPageRoutes(): Array<RouterRoute> {
    return dashboardRoutes.filter((route: RouterRoute): boolean => {
      return paramsOf(route.path).some((param: string): boolean => {
        return param === "dashboardId" || param === "dashboardIdOrDomain";
      });
    });
  }

  function dashboardUrl(routePath: string, dashboard: string): string {
    return `/api${routePath.replace(
      /:([A-Za-z]+)/g,
      (_match: string, param: string): string => {
        if (param === "dashboardId" || param === "dashboardIdOrDomain") {
          return dashboard;
        }

        if (param === "resourceType") {
          return "monitor";
        }

        return ObjectID.generate().toString();
      },
    )}`;
  }

  it("every public route answers it word for word as it answers a dashboard that was never made", async () => {
    const routes: Array<RouterRoute> = dashboardPageRoutes();

    expect(
      routes.map((route: RouterRoute) => {
        return route.path;
      }),
    ).toEqual(
      expect.arrayContaining([
        "/dashboard/seo/:dashboardIdOrDomain",
        "/dashboard/overview/:dashboardIdOrDomain",
        "/dashboard/metadata/:dashboardId",
        "/dashboard/view-config/:dashboardId",
        "/dashboard/master-password/:dashboardId",
      ]),
    );

    const missingId: string = ObjectID.generate().toString();

    for (const route of routes) {
      for (const method of route.methods) {
        const body: JSONObject =
          route.path.indexOf("master-password") !== -1
            ? { password: "anything" }
            : {};

        const blocked: HttpResult = await send({
          port,
          method,
          path: dashboardUrl(route.path, BLOCKED_DASHBOARD_ID.toString()),
          body,
        });
        const missing: HttpResult = await send({
          port,
          method,
          path: dashboardUrl(route.path, missingId),
          body,
        });

        expect({
          route: `${method} ${route.path}`,
          status: blocked.status,
          message: errorMessageOf(blocked),
        }).toEqual({
          route: `${method} ${route.path}`,
          status: missing.status,
          message: errorMessageOf(missing),
        });

        expect(blocked.status).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it("the routes that send the dashboard itself answer 404 Dashboard not found", async () => {
    for (const request of [
      { method: "GET", route: "seo" },
      { method: "POST", route: "metadata" },
    ]) {
      const blocked: HttpResult = await send({
        port,
        method: request.method,
        path: `/api/dashboard/${request.route}/${BLOCKED_DASHBOARD_ID.toString()}`,
      });

      expect({
        route: request.route,
        status: blocked.status,
        message: errorMessageOf(blocked),
      }).toEqual({
        route: request.route,
        status: 404,
        message: "Dashboard not found",
      });
    }
  });

  it("its custom domain answers as a domain no dashboard has", async () => {
    const seo: HttpResult = await send({
      port,
      method: "GET",
      path: `/api/dashboard/seo/${BLOCKED_DASHBOARD_DOMAIN}`,
    });

    expect(seo.status).toBe(404);
    expect(errorMessageOf(seo)).toBe("Dashboard not found");

    const blocked: HttpResult = await send({
      port,
      method: "POST",
      path: "/api/dashboard/domain",
      body: { domain: BLOCKED_DASHBOARD_DOMAIN },
    });
    const unknown: HttpResult = await send({
      port,
      method: "POST",
      path: "/api/dashboard/domain",
      body: { domain: "nobody.example.com" },
    });

    expect(unknown.status).toBe(404);
    expect(blocked.status).toBe(unknown.status);
    expect(errorMessageOf(blocked)).toBe(errorMessageOf(unknown));
  });

  it("a dashboard of a project that is not blocked answers as it always has", async () => {
    const seo: HttpResult = await send({
      port,
      method: "GET",
      path: `/api/dashboard/seo/${LIVE_DASHBOARD_ID.toString()}`,
    });

    expect(seo.status).toBe(200);
    expect(seo.body?.["title"]).toBe(
      `Dashboard title ${LIVE_DASHBOARD_ID.toString()}`,
    );

    const metadata: HttpResult = await send({
      port,
      method: "POST",
      path: `/api/dashboard/metadata/${LIVE_DASHBOARD_ID.toString()}`,
    });

    expect(metadata.status).toBe(200);
    expect(metadata.body?.["_id"]).toBe(LIVE_DASHBOARD_ID.toString());

    const domain: HttpResult = await send({
      port,
      method: "POST",
      path: "/api/dashboard/domain",
      body: { domain: LIVE_DASHBOARD_DOMAIN },
    });

    expect(domain.status).toBe(200);
    expect(domain.body?.["dashboardId"]).toBe(LIVE_DASHBOARD_ID.toString());
  });

  it("unblocking the project puts the dashboard's link back", async () => {
    const path: string = `/api/dashboard/metadata/${BLOCKED_DASHBOARD_ID.toString()}`;

    expect((await send({ port, method: "POST", path })).status).toBe(404);

    blockedProjectIds.clear();
    ProjectService.forgetBlockedStatus(BLOCKED_PROJECT_ID);

    expect((await send({ port, method: "POST", path })).status).toBe(200);
  });

  it("asks whether the project is blocked once, however many widget requests a view makes", async () => {
    for (let request: number = 0; request < 10; request++) {
      await send({
        port,
        method: "POST",
        path: `/api/dashboard/view-config/${BLOCKED_DASHBOARD_ID.toString()}`,
      });
    }

    expect(projectFindOneById).toHaveBeenCalledTimes(1);
  });
});
