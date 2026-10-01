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
import DashboardService from "../../../Server/Services/DashboardService";
import PublicDashboardRateLimit from "../../../Server/Middleware/PublicDashboardRateLimit";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSsoService from "../../../Server/Services/StatusPageSsoService";
import StatusPageFooterLinkService from "../../../Server/Services/StatusPageFooterLinkService";
import StatusPageHeaderLinkService from "../../../Server/Services/StatusPageHeaderLinkService";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Dictionary from "../../../Types/Dictionary";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import CookieParser from "cookie-parser";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

/*
 * A real Express app: an error that walks the many routes registered after
 * the one that threw is deferred with setImmediate, which Common's jsdom
 * environment does not expose (see MultipartFormData.test.ts). Lend it
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
 * The public status page and dashboard routes, driven through a real Express
 * app with the production error handler, for an archived page and dashboard
 * beside a live one.
 *
 * Archiving takes a status page offline and a dashboard off its public link.
 * Most public reads go through hasReadAccess, which refuses archived ones; the
 * routes below are the ones that answer before it - the page's SEO lookup,
 * its branding, its badge, the master page the status page app loads first,
 * and the master-password unlock - so each is checked here on its own. The
 * answer must be the one a missing page gets, so archiving cannot be told
 * apart from never having existed. Only the data layer is stubbed.
 */

const LIVE_PAGE_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000001",
);
const ARCHIVED_PAGE_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000002",
);
const LIVE_DASHBOARD_ID: ObjectID = new ObjectID(
  "da000000-0000-4000-8000-000000000001",
);
const ARCHIVED_DASHBOARD_ID: ObjectID = new ObjectID(
  "da000000-0000-4000-8000-000000000002",
);

const BADGE_TOKEN: string = "badge-token";

function buildPage(id: ObjectID, isArchived: boolean): StatusPage {
  const page: StatusPage = new StatusPage();
  page.id = id;
  page._id = id.toString();
  page.projectId = new ObjectID("5a000000-0000-4000-8000-0000000000ff");
  page.name = `Page ${id.toString()}`;
  page.pageTitle = `Title ${id.toString()}`;
  page.isPublicStatusPage = true;
  page.isArchived = isArchived;
  page.enableEmbeddedOverallStatus = true;
  page.embeddedOverallStatusToken = BADGE_TOKEN;
  page.enableMasterPassword = true;
  page.masterPassword = new HashedString("stored-hash", true);
  return page;
}

function buildDashboard(id: ObjectID, isArchived: boolean): Dashboard {
  const dashboard: Dashboard = new Dashboard();
  dashboard.id = id;
  dashboard._id = id.toString();
  dashboard.name = `Dashboard ${id.toString()}`;
  dashboard.isPublicDashboard = true;
  dashboard.isArchived = isArchived;
  dashboard.enableMasterPassword = true;
  dashboard.masterPassword = new HashedString("stored-hash", true);
  return dashboard;
}

const PAGES: Dictionary<StatusPage> = {
  [LIVE_PAGE_ID.toString()]: buildPage(LIVE_PAGE_ID, false),
  [ARCHIVED_PAGE_ID.toString()]: buildPage(ARCHIVED_PAGE_ID, true),
};

const DASHBOARDS: Dictionary<Dashboard> = {
  [LIVE_DASHBOARD_ID.toString()]: buildDashboard(LIVE_DASHBOARD_ID, false),
  [ARCHIVED_DASHBOARD_ID.toString()]: buildDashboard(
    ARCHIVED_DASHBOARD_ID,
    true,
  ),
};

/*
 * A findOneBy that honours the plain-value filters these routes send, so a
 * route that asks for `isArchived: false` really does not find an archived
 * page - and one that forgets to ask does.
 */
function matches(
  row: Record<string, unknown>,
  query: Dictionary<unknown>,
): boolean {
  for (const key of Object.keys(query)) {
    const expected: unknown = query[key];

    if (key === "_id") {
      if (String(expected) !== String((row as JSONObject)["_id"])) {
        return false;
      }
      continue;
    }

    if (
      typeof expected === "boolean" ||
      typeof expected === "string" ||
      typeof expected === "number"
    ) {
      if ((row as Dictionary<unknown>)[key] !== expected) {
        return false;
      }
    }
  }

  return true;
}

type HttpResult = { status: number; body: JSONObject | null };

function send(data: {
  port: number;
  method: "GET" | "POST";
  path: string;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string =
        data.method === "POST" ? JSON.stringify(data.body || {}) : "";

      const headers: http.OutgoingHttpHeaders = { tenantid: "" };

      if (data.method === "POST") {
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

            resolve({ status: response.statusCode || 0, body });
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

describe("archived status pages and dashboards on their public routes", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    /*
     * The password routes' attempt limiter fails closed without Redis; it has
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

    jest
      .spyOn(StatusPageService, "findOneById")
      .mockImplementation(async (data: { id: ObjectID }) => {
        return PAGES[data.id.toString()] || null;
      });

    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockImplementation(async (data: { query: Dictionary<unknown> }) => {
        const page: StatusPage | undefined = Object.values(PAGES).find(
          (candidate: StatusPage): boolean => {
            return matches(
              candidate as unknown as Record<string, unknown>,
              data.query,
            );
          },
        );
        return page || null;
      });

    jest.spyOn(StatusPageResourceService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(StatusPageSsoService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(StatusPageFooterLinkService, "findBy").mockResolvedValue([]);
    jest.spyOn(StatusPageHeaderLinkService, "findBy").mockResolvedValue([]);

    jest
      .spyOn(DashboardService, "findOneById")
      .mockImplementation(async (data: { id: ObjectID }) => {
        return DASHBOARDS[data.id.toString()] || null;
      });

    const app: express.Express = express();
    app.use(CookieParser());
    app.use(express.json());
    app.use("/api", new DashboardAPI().getRouter());
    app.use("/api", new StatusPageAPI().getRouter());
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

    jest.restoreAllMocks();
  });

  describe("a status page", () => {
    it("SEO: a live page answers with its title, an archived one is not found", async () => {
      const live: HttpResult = await send({
        port,
        method: "GET",
        path: `/api/status-page/seo/${LIVE_PAGE_ID.toString()}`,
      });

      expect(live.status).toBe(200);
      expect(live.body?.["title"]).toBe(`Title ${LIVE_PAGE_ID.toString()}`);

      const archived: HttpResult = await send({
        port,
        method: "GET",
        path: `/api/status-page/seo/${ARCHIVED_PAGE_ID.toString()}`,
      });

      expect(archived.status).toBe(404);
      expect(errorMessageOf(archived)).toBe("Status Page not found");
    });

    it("the master page - the first thing the status page app loads - refuses an archived page as it refuses a missing one", async () => {
      const live: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/status-page/master-page/${LIVE_PAGE_ID.toString()}`,
      });

      expect(live.status).toBe(200);
      // The flag is read to decide, not handed to the page.
      expect(
        (live.body?.["statusPage"] as JSONObject | undefined)?.["isArchived"],
      ).toBeUndefined();

      const archived: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/status-page/master-page/${ARCHIVED_PAGE_ID.toString()}`,
      });
      const missing: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/status-page/master-page/${ObjectID.generate().toString()}`,
      });

      expect(archived.status).toBe(missing.status);
      expect(errorMessageOf(archived)).toBe(errorMessageOf(missing));
      expect(errorMessageOf(archived)).toBe("Status Page not found");
    });

    it("the overview - and every read behind hasReadAccess - is not found", async () => {
      const archived: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/status-page/overview/${ARCHIVED_PAGE_ID.toString()}`,
      });

      expect(archived.status).toBe(404);
      expect(errorMessageOf(archived)).toBe("Status Page not found");
    });

    it("the embedded badge stops: an archived page has no status to show", async () => {
      const archived: HttpResult = await send({
        port,
        method: "GET",
        path: `/api/status-page/badge/${ARCHIVED_PAGE_ID.toString()}?token=${BADGE_TOKEN}`,
      });

      expect(archived.status).toBe(404);
      expect(errorMessageOf(archived)).toBe(
        "Status badge not found or disabled",
      );
    });

    it("the logo and cover image are not served", async () => {
      for (const asset of ["logo", "cover-image"]) {
        const archived: HttpResult = await send({
          port,
          method: "GET",
          path: `/api/status-page/${asset}/${ARCHIVED_PAGE_ID.toString()}`,
        });

        expect({ asset, status: archived.status }).toEqual({
          asset,
          status: 404,
        });
      }
    });

    it("the master password cannot unlock an archived page", async () => {
      const archived: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/status-page/master-password/${ARCHIVED_PAGE_ID.toString()}`,
        body: { password: "anything" },
      });

      expect(archived.status).toBe(404);
      expect(errorMessageOf(archived)).toBe("Status Page not found");
    });
  });

  describe("a dashboard", () => {
    it("SEO: an archived dashboard is not found", async () => {
      const live: HttpResult = await send({
        port,
        method: "GET",
        path: `/api/dashboard/seo/${LIVE_DASHBOARD_ID.toString()}`,
      });

      expect(live.status).toBe(200);

      const archived: HttpResult = await send({
        port,
        method: "GET",
        path: `/api/dashboard/seo/${ARCHIVED_DASHBOARD_ID.toString()}`,
      });

      expect(archived.status).toBe(404);
      expect(errorMessageOf(archived)).toBe("Dashboard not found");
    });

    it("metadata, the public viewer's first request, is not found", async () => {
      const live: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/dashboard/metadata/${LIVE_DASHBOARD_ID.toString()}`,
      });

      expect(live.status).toBe(200);

      const archived: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/dashboard/metadata/${ARCHIVED_DASHBOARD_ID.toString()}`,
      });

      expect(archived.status).toBe(404);
      expect(errorMessageOf(archived)).toBe("Dashboard not found");
    });

    it("the overview is not available, even though the dashboard is set to public", async () => {
      const archived: HttpResult = await send({
        port,
        method: "GET",
        path: `/api/dashboard/overview/${ARCHIVED_DASHBOARD_ID.toString()}`,
      });

      expect(archived.status).toBe(401);
      expect(errorMessageOf(archived)).toBe("This dashboard is not available.");
    });

    it("the master password cannot unlock an archived dashboard", async () => {
      const archived: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/dashboard/master-password/${ARCHIVED_DASHBOARD_ID.toString()}`,
        body: { password: "anything" },
      });

      expect(archived.status).toBe(404);
      expect(errorMessageOf(archived)).toBe("Dashboard not found");
    });
  });
});
