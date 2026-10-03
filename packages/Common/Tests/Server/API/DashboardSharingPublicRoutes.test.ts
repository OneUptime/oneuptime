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

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import DashboardAPI from "../../../Server/API/DashboardAPI";
import DashboardService from "../../../Server/Services/DashboardService";
import PublicDashboardRateLimit from "../../../Server/Middleware/PublicDashboardRateLimit";
import CookieUtil from "../../../Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import {
  DASHBOARD_ACCESS_CHOICES,
  DashboardAccess,
  DashboardAccessState,
  getDashboardAccess,
  getDashboardAccessChanges,
  isDashboardMasterPasswordRequired,
  isDashboardPasswordNeededFor,
  isDashboardPublic,
} from "../../../Types/Dashboard/DashboardAccess";
import {
  DASHBOARD_MASTER_PASSWORD_INVALID_MESSAGE,
  DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE,
} from "../../../Types/Dashboard/MasterPassword";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import CookieParser from "cookie-parser";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

/*
 * A real Express app: an error that walks the many routes registered after
 * the one that threw is deferred with setImmediate, which Common's jsdom
 * environment does not expose. Lend it Node's.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * Who can view a dashboard, at the API a visitor of its public link talks
 * to: the metadata answer the public dashboard app loads first, the
 * master-password unlock, and the overview behind the read check - driven
 * through a real Express app with the production error handler. Only the
 * data layer (and the hash check) is stubbed.
 *
 * For every state a dashboard can start in, moved to every choice the
 * Sharing page offers (Types/Dashboard/DashboardAccess, written as only the
 * columns that change, with a password whenever the move needs one), a
 * visitor gets exactly what the choice says, with billing on and off:
 *
 *   - Only people in this project: the link answers nobody; the password
 *     route says the dashboard is not public.
 *   - Anyone with the link: the link opens; there is no password to enter.
 *   - Anyone with the link and a password: the link asks for the password,
 *     the password unlocks it, and the unlocked visitor gets in. Never the
 *     locked state, where the server lets nobody in.
 *
 * And a dashboard already locked (the switch on, no password - the API can
 * still store that) fails closed: the app is told to ask for a password, no
 * password unlocks it, and the read check refuses everyone.
 */

const DASHBOARD_ID: ObjectID = new ObjectID(
  "da5a0000-0000-4000-8000-000000000001",
);

const PASSWORD: string = "open sesame";

// The states a dashboard can start in (what the server stores).
const START_STATES: Array<[string, DashboardAccessState]> = [
  [
    "a new, private dashboard",
    {
      isPublicDashboard: false,
      enableMasterPassword: false,
      hasMasterPassword: false,
    },
  ],
  [
    "a private dashboard with the switch on and a password set",
    {
      isPublicDashboard: false,
      enableMasterPassword: true,
      hasMasterPassword: true,
    },
  ],
  [
    "a private dashboard with the switch on and no password",
    {
      isPublicDashboard: false,
      enableMasterPassword: true,
      hasMasterPassword: false,
    },
  ],
  [
    "a public dashboard",
    {
      isPublicDashboard: true,
      enableMasterPassword: false,
      hasMasterPassword: false,
    },
  ],
  [
    "a public dashboard with a password set but switched off",
    {
      isPublicDashboard: true,
      enableMasterPassword: false,
      hasMasterPassword: true,
    },
  ],
  [
    "a password-protected dashboard",
    {
      isPublicDashboard: true,
      enableMasterPassword: true,
      hasMasterPassword: true,
    },
  ],
  [
    "a locked dashboard: the switch on and no password",
    {
      isPublicDashboard: true,
      enableMasterPassword: true,
      hasMasterPassword: false,
    },
  ],
];

// The dashboard the fake data layer hands back.
let stored: Dashboard = new Dashboard();

const storedDashboard: (state: DashboardAccessState) => Dashboard = (
  state: DashboardAccessState,
): Dashboard => {
  const dashboard: Dashboard = new Dashboard();
  dashboard.id = DASHBOARD_ID;
  dashboard._id = DASHBOARD_ID.toString();
  dashboard.name = "Checkout";
  dashboard.isPublicDashboard = state.isPublicDashboard === true;
  dashboard.enableMasterPassword = state.enableMasterPassword === true;
  dashboard.isArchived = false;

  if (state.hasMasterPassword) {
    dashboard.masterPassword = new HashedString("stored-hash", true);
    dashboard.masterPasswordSalt = "salt-that-must-stay-home";
  }

  return dashboard;
};

// The dashboard once the Sharing page's write for a move lands.
const dashboardAfter: (
  from: DashboardAccessState,
  to: DashboardAccess,
) => Dashboard = (
  from: DashboardAccessState,
  to: DashboardAccess,
): Dashboard => {
  const dashboard: Dashboard = storedDashboard(from);

  Object.assign(dashboard, getDashboardAccessChanges({ from, to }));

  if (isDashboardPasswordNeededFor({ from, to })) {
    dashboard.masterPassword = new HashedString("new-hash", true);
    dashboard.masterPasswordSalt = "new-salt";
  }

  return dashboard;
};

type HttpResult = {
  status: number;
  body: JSONObject | null;
  setCookie: Array<string>;
};

function send(data: {
  port: number;
  method: "GET" | "POST";
  path: string;
  body?: JSONObject | undefined;
  cookie?: string | undefined;
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

      if (data.cookie) {
        headers["cookie"] = data.cookie;
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

            resolve({
              status: response.statusCode || 0,
              body,
              setCookie: response.headers["set-cookie"] || [],
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

// The unlock cookie a successful password sets, as a browser sends it back.
function unlockCookieFrom(result: HttpResult): string | undefined {
  const name: string = CookieUtil.getDashboardMasterPasswordKey(DASHBOARD_ID);

  const cookie: string | undefined = result.setCookie.find(
    (header: string): boolean => {
      return header.startsWith(`${name}=`);
    },
  );

  return cookie ? cookie.split(";")[0] : undefined;
}

describe("a dashboard's public link answers whoever its Sharing choice says", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    /*
     * The password route's attempt limiter fails closed without Redis; it
     * has its own tests. Let every request through, so these reach the route.
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
      .spyOn(DashboardService, "findOneById")
      .mockImplementation(async (data: { id: ObjectID }) => {
        return data.id.toString() === DASHBOARD_ID.toString() ? stored : null;
      });

    // The stored hash stands for PASSWORD: bcrypt has suites of its own.
    jest
      .spyOn(DashboardService, "verifyHashedColumnValue")
      .mockImplementation(
        async (data: {
          item: Dashboard;
          columnName: string;
          plainValue: string;
        }): Promise<boolean> => {
          return Boolean(
            data.columnName === "masterPassword" &&
              data.item.masterPassword &&
              data.plainValue === PASSWORD,
          );
        },
      );

    const app: express.Express = express();
    app.use(CookieParser());
    app.use(express.json());
    app.use("/api", new DashboardAPI().getRouter());
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

    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  const metadata: () => Promise<HttpResult> = (): Promise<HttpResult> => {
    return send({
      port,
      method: "POST",
      path: `/api/dashboard/metadata/${DASHBOARD_ID.toString()}`,
    });
  };

  const overview: (cookie?: string | undefined) => Promise<HttpResult> = (
    cookie?: string | undefined,
  ): Promise<HttpResult> => {
    return send({
      port,
      method: "GET",
      path: `/api/dashboard/overview/${DASHBOARD_ID.toString()}`,
      cookie,
    });
  };

  const unlock: (password: string) => Promise<HttpResult> = (
    password: string,
  ): Promise<HttpResult> => {
    return send({
      port,
      method: "POST",
      path: `/api/dashboard/master-password/${DASHBOARD_ID.toString()}`,
      body: { password },
    });
  };

  describe.each([
    ["billing off (self-hosted)", false],
    ["billing on (OneUptime Cloud)", true],
  ])("%s", (_billing: string, isBillingEnabled: boolean) => {
    beforeEach(() => {
      setTestBillingEnabled(isBillingEnabled);
    });

    describe.each(START_STATES)(
      "%s",
      (_label: string, from: DashboardAccessState) => {
        it.each(
          DASHBOARD_ACCESS_CHOICES.map(
            (access: DashboardAccess): [DashboardAccess] => {
              return [access];
            },
          ),
        )("moved to %s", async (to: DashboardAccess) => {
          stored = dashboardAfter(from, to);

          const state: DashboardAccessState = {
            isPublicDashboard: stored.isPublicDashboard,
            enableMasterPassword: stored.enableMasterPassword,
            hasMasterPassword: Boolean(stored.masterPassword),
          };

          expect(getDashboardAccess(state)).toBe(to);

          // The public app's first request says what the rule says...
          const meta: HttpResult = await metadata();

          expect(meta.status).toBe(200);
          expect(meta.body?.["isPublicDashboard"]).toBe(
            isDashboardPublic(state),
          );
          expect(meta.body?.["enableMasterPassword"]).toBe(
            isDashboardMasterPasswordRequired(state),
          );
          // ...and never carries the password's hash or salt.
          expect(JSON.stringify(meta.body)).not.toContain("stored-hash");
          expect(JSON.stringify(meta.body)).not.toContain("new-hash");
          expect(JSON.stringify(meta.body)).not.toContain("salt");

          const anonymous: HttpResult = await overview();
          const unlocked: HttpResult = await unlock(PASSWORD);

          if (to === DashboardAccess.ProjectOnly) {
            expect(anonymous.status).toBe(401);
            expect(errorMessageOf(anonymous)).toBe(
              "This dashboard is not available.",
            );
            expect(unlocked.status).toBe(400);
            expect(errorMessageOf(unlocked)).toBe(
              "This dashboard is not publicly accessible.",
            );
            return;
          }

          if (to === DashboardAccess.AnyoneWithLink) {
            expect(anonymous.status).toBe(200);
            expect(anonymous.body?.["name"]).toBe("Checkout");
            // There is no password to enter.
            expect(unlocked.status).toBe(400);
            expect(errorMessageOf(unlocked)).toBe(
              "Master password has not been configured for this dashboard.",
            );
            return;
          }

          // The password: asked for, it unlocks, and the visitor gets in.
          expect(anonymous.status).toBe(401);
          expect(errorMessageOf(anonymous)).toBe(
            DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE,
          );

          const wrong: HttpResult = await unlock("not it");

          expect(wrong.status).toBe(400);
          expect(errorMessageOf(wrong)).toBe(
            DASHBOARD_MASTER_PASSWORD_INVALID_MESSAGE,
          );

          expect(unlocked.status).toBe(200);

          const cookie: string | undefined = unlockCookieFrom(unlocked);

          expect(cookie).toBeDefined();

          const afterUnlock: HttpResult = await overview(cookie);

          expect(afterUnlock.status).toBe(200);
          expect(afterUnlock.body?.["name"]).toBe("Checkout");
        });
      },
    );

    it("a dashboard already locked (the switch on, no password) fails closed: asked for a password no password unlocks", async () => {
      stored = storedDashboard({
        isPublicDashboard: true,
        enableMasterPassword: true,
        hasMasterPassword: false,
      });

      const meta: HttpResult = await metadata();

      expect(meta.status).toBe(200);
      expect(meta.body?.["enableMasterPassword"]).toBe(true);

      const anonymous: HttpResult = await overview();

      expect(anonymous.status).toBe(401);
      expect(errorMessageOf(anonymous)).toBe(
        DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE,
      );

      const unlocked: HttpResult = await unlock(PASSWORD);

      expect(unlocked.status).toBe(400);
      expect(errorMessageOf(unlocked)).toBe(
        "Master password has not been configured for this dashboard.",
      );
      expect(unlockCookieFrom(unlocked)).toBeUndefined();
    });

    it("a private dashboard with its password switch left on tells the public app nothing about a password", async () => {
      stored = storedDashboard({
        isPublicDashboard: false,
        enableMasterPassword: true,
        hasMasterPassword: true,
      });

      const meta: HttpResult = await metadata();

      expect(meta.status).toBe(200);
      expect(meta.body?.["isPublicDashboard"]).toBe(false);
      // The effective value: a private dashboard never asks for the password.
      expect(meta.body?.["enableMasterPassword"]).toBe(false);
    });
  });
});
