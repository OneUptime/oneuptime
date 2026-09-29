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

import BaseAPI from "../../../Server/API/BaseAPI";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DashboardService from "../../../Server/Services/DashboardService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRouter } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import {
  DASHBOARD_MASTER_PASSWORD_COOKIE_IDENTIFIER,
  DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE,
} from "../../../Types/Dashboard/MasterPassword";
import Dictionary from "../../../Types/Dictionary";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import CookieParser from "cookie-parser";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { AddressInfo } from "net";

/*
 * The public dashboard and public status page routes, driven through a real
 * Express app with cookie-parser and the production error handler, carrying
 * the host-wide dashboard access-token cookie after it has stopped decoding.
 *
 * That cookie reaches these routes whenever the page is served from the
 * dashboard's host, and it outlives its usefulness whenever the encryption
 * secret is rotated inside its Max-Age. getUserMiddleware answered it with
 * 401 "AccessToken is invalid or expired" before the route asked whether the
 * dashboard was public at all; the public clients cannot refresh a dashboard
 * session, so that 401 became a login redirect - a reload loop on the
 * preview route, and a fresh master-password prompt for a viewer who had
 * already entered it.
 *
 * Here those routes must answer the stale cookie exactly as they answer no
 * cookie, and the authenticated routes mounted beside them must still 401.
 * Only the data layer is stubbed; tokens are real JWTs.
 */

const INVALID_ACCESS_TOKEN_MESSAGE: string =
  "AccessToken is invalid or expired. Please refresh your token.";

const PUBLIC_DASHBOARD_ID: ObjectID = new ObjectID(
  "d0000000-0000-4000-8000-000000000001",
);
const PROTECTED_DASHBOARD_ID: ObjectID = new ObjectID(
  "d0000000-0000-4000-8000-000000000002",
);
const PRIVATE_DASHBOARD_ID: ObjectID = new ObjectID(
  "d0000000-0000-4000-8000-000000000003",
);
const PUBLIC_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "50000000-0000-4000-8000-000000000001",
);

/*
 * Well-formed and inside its lifetime, but signed with a secret this instance
 * no longer uses: what every signed-in browser holds right after a rotation.
 */
const STALE_ACCESS_TOKEN: string = jwt.sign(
  {
    userId: "33333333-3333-4333-8333-333333333333",
    email: "viewer@example.com",
    name: "Viewer",
    isMasterAdmin: false,
    isGlobalLogin: true,
    sessionId: "44444444-4444-4444-8444-444444444444",
  },
  `${EncryptionSecret.toString()}-before-rotation`,
  { expiresIn: 15 * 60 },
);

const STALE_SESSION_COOKIE: Dictionary<string> = {
  [CookieUtil.getUserTokenKey()]: STALE_ACCESS_TOKEN,
};

const masterPasswordCookie: (dashboardId: ObjectID) => Dictionary<string> = (
  dashboardId: ObjectID,
): Dictionary<string> => {
  return {
    [CookieUtil.getDashboardMasterPasswordKey(dashboardId)]:
      JSONWebToken.signJsonPayload(
        {
          dashboardId: dashboardId.toString(),
          type: DASHBOARD_MASTER_PASSWORD_COOKIE_IDENTIFIER,
        },
        60 * 60,
      ),
  };
};

const buildDashboard: (data: {
  id: ObjectID;
  isPublicDashboard: boolean;
  enableMasterPassword?: boolean;
}) => Dashboard = (data: {
  id: ObjectID;
  isPublicDashboard: boolean;
  enableMasterPassword?: boolean;
}): Dashboard => {
  const dashboard: Dashboard = new Dashboard();
  dashboard.id = data.id;
  dashboard.name = `Dashboard ${data.id.toString()}`;
  dashboard.isPublicDashboard = data.isPublicDashboard;
  dashboard.enableMasterPassword = Boolean(data.enableMasterPassword);

  if (data.enableMasterPassword) {
    dashboard.masterPassword = new HashedString("stored-hash", true);
  }

  return dashboard;
};

const DASHBOARDS: Dictionary<Dashboard> = {
  [PUBLIC_DASHBOARD_ID.toString()]: buildDashboard({
    id: PUBLIC_DASHBOARD_ID,
    isPublicDashboard: true,
  }),
  [PROTECTED_DASHBOARD_ID.toString()]: buildDashboard({
    id: PROTECTED_DASHBOARD_ID,
    isPublicDashboard: true,
    enableMasterPassword: true,
  }),
  [PRIVATE_DASHBOARD_ID.toString()]: buildDashboard({
    id: PRIVATE_DASHBOARD_ID,
    isPublicDashboard: false,
  }),
};

type HttpResult = { status: number; body: JSONObject | null };

function send(data: {
  port: number;
  method: "GET" | "POST";
  path: string;
  cookies?: Dictionary<string> | undefined;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string =
        data.method === "POST" ? JSON.stringify(data.body || {}) : "";

      const cookieHeader: string = Object.entries(data.cookies || {})
        .map(([name, value]: [string, string]) => {
          return `${name}=${value}`;
        })
        .join("; ");

      const headers: http.OutgoingHttpHeaders = {
        // What the public dashboard and status page clients send.
        tenantid: "",
      };

      if (cookieHeader) {
        headers["cookie"] = cookieHeader;
      }

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

/*
 * Response.sendErrorResponse (the middleware) writes { message }; the
 * production error handler (a handler's next(err)) writes { error }.
 */
const errorMessageOf: (result: HttpResult) => unknown = (
  result: HttpResult,
): unknown => {
  return result.body?.["message"] ?? result.body?.["error"];
};

type RouteHandler = (...args: Array<unknown>) => unknown;

type RouterLayer = {
  route?: {
    path: string;
    methods: Dictionary<boolean>;
    stack: Array<{ handle: RouteHandler }>;
  };
};

type RegisteredRoute = {
  key: string;
  handlers: Array<RouteHandler>;
};

// The routes an Express router has registered, as "METHOD path" + handlers.
const listRoutes: (router: ExpressRouter) => Array<RegisteredRoute> = (
  router: ExpressRouter,
): Array<RegisteredRoute> => {
  const layers: Array<RouterLayer> = (
    router as unknown as { stack: Array<RouterLayer> }
  ).stack;

  const routes: Array<RegisteredRoute> = [];

  for (const layer of layers) {
    if (!layer.route) {
      continue;
    }

    for (const method of Object.keys(layer.route.methods)) {
      routes.push({
        key: `${method.toUpperCase()} ${layer.route.path}`,
        handlers: layer.route.stack.map((entry: { handle: RouteHandler }) => {
          return entry.handle;
        }),
      });
    }
  }

  return routes;
};

describe("public routes with an access-token cookie that no longer decodes", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    jest
      .spyOn(DashboardService, "findOneById")
      .mockImplementation(async (data: { id: ObjectID }) => {
        return DASHBOARDS[data.id.toString()] || null;
      });

    jest
      .spyOn(StatusPageService, "findOneById")
      .mockImplementation(async (data: { id: ObjectID }) => {
        if (data.id.toString() !== PUBLIC_STATUS_PAGE_ID.toString()) {
          return null;
        }

        const statusPage: StatusPage = new StatusPage();
        statusPage.id = PUBLIC_STATUS_PAGE_ID;
        statusPage.isPublicStatusPage = true;
        return statusPage;
      });

    jest.spyOn(StatusPageResourceService, "findBy").mockResolvedValue([]);

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

  describe("public dashboard routes", () => {
    it("serves a public dashboard's overview", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: `/api/dashboard/overview/${PUBLIC_DASHBOARD_ID.toString()}`,
        cookies: STALE_SESSION_COOKIE,
      });

      expect(result.status).toBe(200);
      expect(result.body?.["_id"]).toBe(PUBLIC_DASHBOARD_ID.toString());
      expect(result.body?.["name"]).toBe(
        `Dashboard ${PUBLIC_DASHBOARD_ID.toString()}`,
      );
    });

    it("serves a public dashboard's metadata", async () => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/dashboard/metadata/${PUBLIC_DASHBOARD_ID.toString()}`,
        cookies: STALE_SESSION_COOKIE,
      });

      expect(result.status).toBe(200);
      expect(result.body?.["_id"]).toBe(PUBLIC_DASHBOARD_ID.toString());
      expect(result.body?.["isPublicDashboard"]).toBe(true);
    });

    /*
     * The master-password case from the report: the viewer already entered
     * the password, and the stale session cookie must not send them back to
     * the prompt.
     */
    it("serves a protected dashboard to a viewer holding its master-password cookie", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: `/api/dashboard/overview/${PROTECTED_DASHBOARD_ID.toString()}`,
        cookies: {
          ...STALE_SESSION_COOKIE,
          ...masterPasswordCookie(PROTECTED_DASHBOARD_ID),
        },
      });

      expect(result.status).toBe(200);
      expect(result.body?.["_id"]).toBe(PROTECTED_DASHBOARD_ID.toString());
    });

    /*
     * Anonymous is not "let in". Access is still the dashboard's own
     * decision, and a refusal names the dashboard's reason rather than the
     * stale session's.
     */
    it.each([
      [
        "asks for the master password on a protected dashboard",
        PROTECTED_DASHBOARD_ID,
        DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE,
      ],
      [
        "refuses a dashboard that is not public",
        PRIVATE_DASHBOARD_ID,
        "This dashboard is not available.",
      ],
    ])(
      "%s, for the dashboard's reason",
      async (_label: string, dashboardId: ObjectID, message: string) => {
        const result: HttpResult = await send({
          port,
          method: "GET",
          path: `/api/dashboard/overview/${dashboardId.toString()}`,
          cookies: STALE_SESSION_COOKIE,
        });

        expect(result.status).toBe(401);
        expect(errorMessageOf(result)).toBe(message);
      },
    );

    /*
     * The whole contract in one assertion: to a public route, a session
     * cookie that no longer decodes is the same as no session cookie.
     */
    it.each([
      ["GET", `/api/dashboard/overview/${PUBLIC_DASHBOARD_ID.toString()}`],
      ["POST", `/api/dashboard/metadata/${PUBLIC_DASHBOARD_ID.toString()}`],
      ["GET", `/api/dashboard/overview/${PROTECTED_DASHBOARD_ID.toString()}`],
      ["GET", `/api/dashboard/overview/${PRIVATE_DASHBOARD_ID.toString()}`],
    ] as Array<["GET" | "POST", string]>)(
      "answers %s %s exactly as it answers a request with no session cookie",
      async (method: "GET" | "POST", path: string) => {
        const withStaleCookie: HttpResult = await send({
          port,
          method,
          path,
          cookies: STALE_SESSION_COOKIE,
        });
        const withoutCookie: HttpResult = await send({ port, method, path });

        expect(withStaleCookie).toEqual(withoutCookie);
      },
    );
  });

  describe("public status page routes", () => {
    it("serves a public status page's resources", async () => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/status-page/resources/${PUBLIC_STATUS_PAGE_ID.toString()}`,
        cookies: STALE_SESSION_COOKIE,
      });

      expect(result.status).toBe(200);
      expect(result.body?.["data"]).toEqual([]);
    });
  });

  /*
   * Mounted on the same routers, reached through the same prefixes. These
   * need to know who is calling, so a dead session is still a 401 - the
   * answer that makes the dashboard client refresh.
   */
  describe("authenticated routes", () => {
    it.each([
      ["the dashboard CRUD list", "/api/dashboard/get-list"],
      ["the status page CRUD list", "/api/status-page/get-list"],
      [
        "the status page test email report",
        "/api/status-page/test-email-report",
      ],
    ])("still answer %s with a 401", async (_label: string, path: string) => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path,
        cookies: STALE_SESSION_COOKIE,
        body: {
          statusPageId: PUBLIC_STATUS_PAGE_ID.toString(),
          email: "someone@example.com",
        },
      });

      expect(result.status).toBe(401);
      expect(errorMessageOf(result)).toBe(INVALID_ACCESS_TOKEN_MESSAGE);
    });
  });
});

/*
 * Which middleware each route mounts. The tests above prove the behaviour on
 * a sample; these keep every route on the right side of the line, including
 * ones added later.
 */
describe("which routes treat an undecodable access token as anonymous", () => {
  type SplitRoutes = {
    custom: Array<RegisteredRoute>;
    inherited: Array<RegisteredRoute>;
  };

  type SplitRoutesFunction = (data: {
    router: ExpressRouter;
    inheritedRouter: ExpressRouter;
  }) => SplitRoutes;

  const splitRoutes: SplitRoutesFunction = (data: {
    router: ExpressRouter;
    inheritedRouter: ExpressRouter;
  }): SplitRoutes => {
    const inheritedKeys: Set<string> = new Set(
      listRoutes(data.inheritedRouter).map((route: RegisteredRoute) => {
        return route.key;
      }),
    );

    const routes: Array<RegisteredRoute> = listRoutes(data.router);

    return {
      custom: routes.filter((route: RegisteredRoute) => {
        return !inheritedKeys.has(route.key);
      }),
      inherited: routes.filter((route: RegisteredRoute) => {
        return inheritedKeys.has(route.key);
      }),
    };
  };

  const mountsPublic: (route: RegisteredRoute) => boolean = (
    route: RegisteredRoute,
  ): boolean => {
    return route.handlers.includes(
      UserMiddleware.getPublicRouteUserMiddleware as RouteHandler,
    );
  };

  const mountsStrict: (route: RegisteredRoute) => boolean = (
    route: RegisteredRoute,
  ): boolean => {
    return route.handlers.includes(
      UserMiddleware.getUserMiddleware as RouteHandler,
    );
  };

  it("mounts the public variant on every public dashboard route", () => {
    const { custom, inherited }: SplitRoutes = splitRoutes({
      router: new DashboardAPI().getRouter(),
      inheritedRouter: new BaseAPI(Dashboard, DashboardService).getRouter(),
    });

    expect(custom.length).toBeGreaterThan(0);

    for (const route of custom) {
      expect([route.key, mountsPublic(route), mountsStrict(route)]).toEqual([
        route.key,
        true,
        false,
      ]);
    }

    for (const route of inherited) {
      expect([route.key, mountsPublic(route), mountsStrict(route)]).toEqual([
        route.key,
        false,
        true,
      ]);
    }
  });

  /*
   * The status page has the same exposure: its preview is served from the
   * dashboard's host, so the dashboard cookie rides along, and its public
   * routes decide access from the page's own cookies (StatusPageService
   * .hasReadAccess), never from the dashboard session.
   *
   * test-email-report is the exception - it acts for a signed-in project
   * member and requires authentication - and must stay strict.
   */
  it("mounts the public variant on every public status page route, and only there", () => {
    const { custom, inherited }: SplitRoutes = splitRoutes({
      router: new StatusPageAPI().getRouter(),
      inheritedRouter: new BaseAPI(StatusPage, StatusPageService).getRouter(),
    });

    const strictCustomRoutes: Array<string> = custom
      .filter(mountsStrict)
      .map((route: RegisteredRoute) => {
        return route.key;
      });

    expect(strictCustomRoutes).toEqual(["POST /status-page/test-email-report"]);

    const testEmailReport: RegisteredRoute | undefined = custom.find(
      (route: RegisteredRoute) => {
        return route.key === "POST /status-page/test-email-report";
      },
    );

    expect(testEmailReport?.handlers).toContain(
      UserMiddleware.requireUserAuthentication as RouteHandler,
    );
    expect(mountsPublic(testEmailReport!)).toBe(false);

    expect(custom.filter(mountsPublic).length).toBeGreaterThan(0);

    for (const route of inherited) {
      expect([route.key, mountsPublic(route), mountsStrict(route)]).toEqual([
        route.key,
        false,
        true,
      ]);
    }
  });
});
