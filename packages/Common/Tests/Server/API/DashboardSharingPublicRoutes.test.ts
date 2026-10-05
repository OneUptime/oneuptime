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
import File from "../../../Models/DatabaseModels/File";
import MimeType from "../../../Types/File/MimeType";
import {
  DASHBOARD_ACCESS_CHOICES,
  DashboardAccess,
  DashboardAccessState,
  getDashboardAccess,
  getDashboardAccessChanges,
  isDashboardMasterPasswordRequired,
  isDashboardPasswordNeededFor,
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
 *   - Only people in this project: the link answers nobody, and every
 *     route reads exactly as it does for a dashboard that does not exist -
 *     the metadata, the password route and the overview alike.
 *   - Anyone with the link: the link opens, the metadata carries everything,
 *     and there is no password to enter.
 *   - Anyone with the link and a password: the metadata carries only what
 *     the password prompt shows (the name, the page title, the favicon), the
 *     password unlocks it, and the unlocked visitor gets the rest. Never the
 *     locked state, where the server lets nobody in.
 *
 * And a dashboard already locked (the switch on, no password - the API can
 * still store that) fails closed: the app is told to ask for a password, no
 * password unlocks it, and the read check refuses everyone.
 */

const DASHBOARD_ID: ObjectID = new ObjectID(
  "da5a0000-0000-4000-8000-000000000001",
);

// An id no dashboard has: what every refusal of the link must read like.
const MISSING_DASHBOARD_ID: ObjectID = new ObjectID(
  "da5a0000-0000-4000-8000-0000000000ff",
);

const imageFile: (bytes: string) => File = (bytes: string): File => {
  const file: File = new File();
  file.file = Buffer.from(bytes);
  file.fileType = MimeType.png;
  return file;
};

const base64Of: (bytes: string) => string = (bytes: string): string => {
  return Buffer.from(bytes).toString("base64");
};

// What the password prompt shows: all a locked link's metadata may carry.
const PROMPT_METADATA: JSONObject = {
  _id: DASHBOARD_ID.toString(),
  name: "Checkout",
  isPublicDashboard: true,
  enableMasterPassword: true,
  pageTitle: "Checkout status",
  faviconFile: { file: base64Of("favicon-bytes"), fileType: "image/png" },
  description: "",
  pageDescription: "",
  logoFile: null,
};

// The whole answer, for a visitor the link lets in.
const fullMetadata: (enableMasterPassword: boolean) => JSONObject = (
  enableMasterPassword: boolean,
): JSONObject => {
  return {
    ...PROMPT_METADATA,
    enableMasterPassword,
    description: "Orders and payments",
    pageDescription: "How checkout is doing right now",
    logoFile: { file: base64Of("logo-bytes"), fileType: "image/png" },
  };
};

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
  dashboard.description = "Orders and payments";
  dashboard.pageTitle = "Checkout status";
  dashboard.pageDescription = "How checkout is doing right now";
  dashboard.logoFile = imageFile("logo-bytes");
  dashboard.faviconFile = imageFile("favicon-bytes");
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

  const metadata: (
    cookie?: string | undefined,
    dashboardId?: ObjectID | undefined,
  ) => Promise<HttpResult> = (
    cookie?: string | undefined,
    dashboardId?: ObjectID | undefined,
  ): Promise<HttpResult> => {
    return send({
      port,
      method: "POST",
      path: `/api/dashboard/metadata/${(dashboardId || DASHBOARD_ID).toString()}`,
      cookie,
    });
  };

  const overview: (
    cookie?: string | undefined,
    dashboardId?: ObjectID | undefined,
  ) => Promise<HttpResult> = (
    cookie?: string | undefined,
    dashboardId?: ObjectID | undefined,
  ): Promise<HttpResult> => {
    return send({
      port,
      method: "GET",
      path: `/api/dashboard/overview/${(dashboardId || DASHBOARD_ID).toString()}`,
      cookie,
    });
  };

  const unlock: (
    password: string,
    dashboardId?: ObjectID | undefined,
  ) => Promise<HttpResult> = (
    password: string,
    dashboardId?: ObjectID | undefined,
  ): Promise<HttpResult> => {
    return send({
      port,
      method: "POST",
      path: `/api/dashboard/master-password/${(dashboardId || DASHBOARD_ID).toString()}`,
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

          // The public app's first request never carries the password's hash or salt...
          const meta: HttpResult = await metadata();

          expect(JSON.stringify(meta.body)).not.toContain("stored-hash");
          expect(JSON.stringify(meta.body)).not.toContain("new-hash");
          expect(JSON.stringify(meta.body)).not.toContain("salt");

          const anonymous: HttpResult = await overview();
          const unlocked: HttpResult = await unlock(PASSWORD);

          if (to === DashboardAccess.ProjectOnly) {
            /*
             * ...and for a dashboard only its project sees, every route says
             * exactly what it says for a dashboard that does not exist.
             */
            expect(meta.status).toBe(404);
            expect(errorMessageOf(meta)).toBe("Dashboard not found");
            expect(meta).toEqual(
              await metadata(undefined, MISSING_DASHBOARD_ID),
            );

            expect(anonymous.status).toBe(401);
            expect(errorMessageOf(anonymous)).toBe(
              "This dashboard is not available.",
            );
            expect(anonymous).toEqual(
              await overview(undefined, MISSING_DASHBOARD_ID),
            );

            expect(unlocked.status).toBe(404);
            expect(errorMessageOf(unlocked)).toBe("Dashboard not found");
            expect(unlocked).toEqual(
              await unlock(PASSWORD, MISSING_DASHBOARD_ID),
            );
            return;
          }

          // ...says the link answers, and whether it asks for the password.
          expect(meta.status).toBe(200);
          expect(meta.body?.["isPublicDashboard"]).toBe(true);
          expect(meta.body?.["enableMasterPassword"]).toBe(
            isDashboardMasterPasswordRequired(state),
          );

          if (to === DashboardAccess.AnyoneWithLink) {
            // Everything, to anyone with the link.
            expect(meta.body).toEqual(fullMetadata(false));

            expect(anonymous.status).toBe(200);
            expect(anonymous.body?.["name"]).toBe("Checkout");
            // There is no password to enter.
            expect(unlocked.status).toBe(400);
            expect(errorMessageOf(unlocked)).toBe(
              "Master password has not been configured for this dashboard.",
            );
            return;
          }

          // The password: the prompt shows the name, title and favicon only...
          expect(meta.body).toEqual(PROMPT_METADATA);

          // ...it is asked for, it unlocks, and the visitor gets in.
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

          // Unlocked, the metadata carries the rest too.
          expect((await metadata(cookie)).body).toEqual(fullMetadata(true));
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
      expect(meta.body).toEqual(PROMPT_METADATA);

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

    it("a private dashboard with its password switch left on tells the public app nothing at all, not even about a password", async () => {
      stored = storedDashboard({
        isPublicDashboard: false,
        enableMasterPassword: true,
        hasMasterPassword: true,
      });

      const meta: HttpResult = await metadata();

      expect(meta.status).toBe(404);
      expect(meta).toEqual(await metadata(undefined, MISSING_DASHBOARD_ID));
      expect(JSON.stringify(meta.body)).not.toContain("Checkout");
    });

    it("a private dashboard's metadata stays hidden from a visitor holding an unlock cookie it once set", async () => {
      // Shared with a password: the visitor unlocks it...
      stored = storedDashboard({
        isPublicDashboard: true,
        enableMasterPassword: true,
        hasMasterPassword: true,
      });

      const cookie: string | undefined = unlockCookieFrom(
        await unlock(PASSWORD),
      );

      expect(cookie).toBeDefined();

      // ...and then it goes back to the project only.
      stored = dashboardAfter(
        {
          isPublicDashboard: true,
          enableMasterPassword: true,
          hasMasterPassword: true,
        },
        DashboardAccess.ProjectOnly,
      );

      const meta: HttpResult = await metadata(cookie);

      expect(meta.status).toBe(404);
      expect(meta).toEqual(await metadata(cookie, MISSING_DASHBOARD_ID));
      expect((await overview(cookie)).status).toBe(401);
    });
  });
});
