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

import BaseAPI from "../../../Server/API/BaseAPI";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import PublicDashboardRateLimit from "../../../Server/Middleware/PublicDashboardRateLimit";
import DashboardDomainService from "../../../Server/Services/DashboardDomainService";
import DashboardService from "../../../Server/Services/DashboardService";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import CookieUtil from "../../../Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import File from "../../../Models/DatabaseModels/File";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import MimeType from "../../../Types/File/MimeType";
import { DASHBOARD_MASTER_PASSWORD_COOKIE_IDENTIFIER } from "../../../Types/Dashboard/MasterPassword";
import Dictionary from "../../../Types/Dictionary";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import CookieParser from "cookie-parser";
import express from "express";
import type { SpyInstance } from "jest-mock";
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
 * What a dashboard's public link answers, route by route, for every way a
 * dashboard can be shared and every visitor - driven through a real Express
 * app with cookie-parser and the production error handler. Only the data
 * layer (projection-aware: a lookup gets back only the columns it selected)
 * and the hash check are stubbed; unlock cookies are real JWTs.
 *
 *   - The metadata the public dashboard app loads first answers a dashboard
 *     anyone with the link may view in full; one shared with a password with
 *     only what its password prompt shows (the name, the page title, the
 *     favicon) until the visitor enters it; a visitor its IP allowlist
 *     refuses with 403; and a dashboard shared only with its project, an
 *     archived one and a malformed id exactly like an id no dashboard has.
 *   - The page head (SEO) holds only what every visitor sees, whoever asks.
 *   - The password route answers a private dashboard like a missing one, and
 *     tries no password from an address the IP allowlist refuses.
 *   - Every public dashboard route, including ones added later, answers a
 *     private or archived dashboard exactly like a missing one, and reads
 *     nothing it would send before deciding.
 */

const PUBLIC_ID: ObjectID = new ObjectID(
  "ab000000-0000-4000-8000-000000000001",
);
const PROTECTED_ID: ObjectID = new ObjectID(
  "ab000000-0000-4000-8000-000000000002",
);
const LOCKED_ID: ObjectID = new ObjectID(
  "ab000000-0000-4000-8000-000000000003",
);
const PRIVATE_ID: ObjectID = new ObjectID(
  "ab000000-0000-4000-8000-000000000004",
);
const PRIVATE_WITH_PASSWORD_ID: ObjectID = new ObjectID(
  "ab000000-0000-4000-8000-000000000005",
);
const ARCHIVED_ID: ObjectID = new ObjectID(
  "ab000000-0000-4000-8000-000000000006",
);
const ARCHIVED_PROTECTED_ID: ObjectID = new ObjectID(
  "ab000000-0000-4000-8000-000000000007",
);
const ALLOWLISTED_ID: ObjectID = new ObjectID(
  "ab000000-0000-4000-8000-000000000008",
);
const ALLOWLISTED_PROTECTED_ID: ObjectID = new ObjectID(
  "ab000000-0000-4000-8000-000000000009",
);
const PLAIN_ID: ObjectID = new ObjectID("ab000000-0000-4000-8000-00000000000a");
// An id no dashboard has: what every refusal of the link must read like.
const MISSING_ID: ObjectID = new ObjectID(
  "ab000000-0000-4000-8000-0000000000ff",
);

const MALFORMED_ID: string = "not-a-dashboard-id";

// A dashboard whose lookup fails (the database is unreachable, say).
const FAILING_ID: ObjectID = new ObjectID(
  "ab000000-0000-4000-8000-0000000000fe",
);

const PUBLIC_DOMAIN: string = "status.public.example.com";
const PROTECTED_DOMAIN: string = "status.protected.example.com";
const ALLOWLISTED_DOMAIN: string = "status.allowlisted.example.com";
const PRIVATE_DOMAIN: string = "status.private.example.com";
const ARCHIVED_DOMAIN: string = "status.archived.example.com";
const UNKNOWN_DOMAIN: string = "status.nobody.example.com";

const PASSWORD: string = "open sesame";

const ALLOWED_IP: string = "203.0.113.7";
const OTHER_IP: string = "198.51.100.5";

const DEFAULT_SEO_DESCRIPTION: string = "View dashboard metrics and insights.";

/*
 * Columns a route sends a visitor. None may be read for a dashboard before
 * the link has decided the visitor may see it.
 */
const CONTENT_COLUMNS: Array<string> = [
  "name",
  "description",
  "pageTitle",
  "pageDescription",
  "logoFile",
  "faviconFile",
  "dashboardViewConfig",
];

// Every dashboard here is of one project, and so is every image it shows.
const DASHBOARD_PROJECT_ID: ObjectID = new ObjectID(
  "ab000000-0000-4000-8000-0000000000ee",
);

const imageFile: (bytes: string) => File = (bytes: string): File => {
  const file: File = new File();
  file.file = Buffer.from(bytes);
  file.fileType = MimeType.png;
  // A dashboard shows only files of its own project (FileOwnership).
  file.projectId = DASHBOARD_PROJECT_ID;
  return file;
};

const base64Of: (bytes: string) => string = (bytes: string): string => {
  return Buffer.from(bytes).toString("base64");
};

type StoredOptions = {
  id: ObjectID;
  label: string;
  isPublicDashboard: boolean;
  enableMasterPassword?: boolean | undefined;
  hasMasterPassword?: boolean | undefined;
  isArchived?: boolean | undefined;
  ipWhitelist?: string | undefined;
  withoutPageBranding?: boolean | undefined;
};

const storedDashboard: (options: StoredOptions) => Dashboard = (
  options: StoredOptions,
): Dashboard => {
  const dashboard: Dashboard = new Dashboard();
  dashboard.id = options.id;
  dashboard._id = options.id.toString();
  dashboard.projectId = DASHBOARD_PROJECT_ID;
  dashboard.name = `${options.label} name`;
  dashboard.description = `${options.label} description`;

  if (!options.withoutPageBranding) {
    dashboard.pageTitle = `${options.label} page title`;
    dashboard.pageDescription = `${options.label} page description`;
    dashboard.logoFile = imageFile(`${options.label} logo`);
    dashboard.faviconFile = imageFile(`${options.label} favicon`);
  }

  dashboard.dashboardViewConfig = {
    components: [],
    heightInDashboardUnits: 10,
  } as unknown as DashboardViewConfig;
  dashboard.isPublicDashboard = options.isPublicDashboard;
  dashboard.enableMasterPassword = options.enableMasterPassword === true;
  dashboard.isArchived = options.isArchived === true;

  if (options.hasMasterPassword) {
    dashboard.masterPassword = new HashedString("stored-hash", true);
    dashboard.masterPasswordSalt = "salt-that-must-stay-home";
  }

  if (options.ipWhitelist) {
    dashboard.ipWhitelist = options.ipWhitelist;
  }

  return dashboard;
};

const DASHBOARDS: Dictionary<Dashboard> = {};

for (const options of [
  { id: PUBLIC_ID, label: "Public", isPublicDashboard: true },
  {
    id: PROTECTED_ID,
    label: "Protected",
    isPublicDashboard: true,
    enableMasterPassword: true,
    hasMasterPassword: true,
  },
  {
    id: LOCKED_ID,
    label: "Locked",
    isPublicDashboard: true,
    enableMasterPassword: true,
  },
  { id: PRIVATE_ID, label: "Private", isPublicDashboard: false },
  {
    id: PRIVATE_WITH_PASSWORD_ID,
    label: "Private with password",
    isPublicDashboard: false,
    enableMasterPassword: true,
    hasMasterPassword: true,
  },
  {
    id: ARCHIVED_ID,
    label: "Archived",
    isPublicDashboard: true,
    isArchived: true,
  },
  {
    id: ARCHIVED_PROTECTED_ID,
    label: "Archived protected",
    isPublicDashboard: true,
    enableMasterPassword: true,
    hasMasterPassword: true,
    isArchived: true,
  },
  {
    id: ALLOWLISTED_ID,
    label: "Allowlisted",
    isPublicDashboard: true,
    ipWhitelist: `10.0.0.0/8\n${ALLOWED_IP}`,
  },
  {
    id: ALLOWLISTED_PROTECTED_ID,
    label: "Allowlisted protected",
    isPublicDashboard: true,
    enableMasterPassword: true,
    hasMasterPassword: true,
    ipWhitelist: ALLOWED_IP,
  },
  {
    id: PLAIN_ID,
    label: "Plain",
    isPublicDashboard: true,
    withoutPageBranding: true,
  },
] as Array<StoredOptions>) {
  DASHBOARDS[options.id.toString()] = storedDashboard(options);
}

const DOMAINS: Dictionary<ObjectID> = {
  [PUBLIC_DOMAIN]: PUBLIC_ID,
  [PROTECTED_DOMAIN]: PROTECTED_ID,
  [ALLOWLISTED_DOMAIN]: ALLOWLISTED_ID,
  [PRIVATE_DOMAIN]: PRIVATE_ID,
  [ARCHIVED_DOMAIN]: ARCHIVED_ID,
};

// The whole metadata answer, for a visitor the link lets in.
const fullMetadata: (
  id: ObjectID,
  label: string,
  enableMasterPassword: boolean,
) => JSONObject = (
  id: ObjectID,
  label: string,
  enableMasterPassword: boolean,
): JSONObject => {
  return {
    _id: id.toString(),
    name: `${label} name`,
    isPublicDashboard: true,
    enableMasterPassword,
    pageTitle: `${label} page title`,
    faviconFile: { file: base64Of(`${label} favicon`), fileType: "image/png" },
    description: `${label} description`,
    pageDescription: `${label} page description`,
    logoFile: { file: base64Of(`${label} logo`), fileType: "image/png" },
  };
};

// What a password prompt shows: all a locked link's metadata may carry.
const promptMetadata: (id: ObjectID, label: string) => JSONObject = (
  id: ObjectID,
  label: string,
): JSONObject => {
  return {
    ...fullMetadata(id, label, true),
    description: "",
    pageDescription: "",
    logoFile: null,
  };
};

const unlockCookie: (dashboardId: ObjectID) => string = (
  dashboardId: ObjectID,
): string => {
  return `${CookieUtil.getDashboardMasterPasswordKey(dashboardId)}=${JSONWebToken.signJsonPayload(
    {
      dashboardId: dashboardId.toString(),
      type: DASHBOARD_MASTER_PASSWORD_COOKIE_IDENTIFIER,
    },
    60 * 60,
  )}`;
};

type HttpResult = {
  status: number;
  body: JSONObject | null;
  setCookie: Array<string>;
};

type SendOptions = {
  method: "GET" | "POST";
  path: string;
  cookie?: string | undefined;
  forwardedFor?: string | undefined;
  body?: JSONObject | undefined;
};

type Lookup = { id: string; select: Dictionary<unknown> };

const lookups: Array<Lookup> = [];

let port: number = 0;

function send(options: SendOptions): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string =
        options.method === "POST" ? JSON.stringify(options.body || {}) : "";

      // What the public dashboard client sends.
      const headers: http.OutgoingHttpHeaders = { tenantid: "" };

      if (options.method === "POST") {
        headers["content-type"] = "application/json";
        headers["content-length"] = Buffer.byteLength(payload);
      }

      if (options.cookie) {
        headers["cookie"] = options.cookie;
      }

      // What our Nginx appends: the address it accepted the connection from.
      if (options.forwardedFor) {
        headers["x-forwarded-for"] = options.forwardedFor;
      }

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port,
          path: options.path,
          method: options.method,
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
  return result.body?.["message"] ?? result.body?.["error"];
}

const metadata: (
  id: ObjectID | string,
  options?: { cookie?: string; forwardedFor?: string },
) => Promise<HttpResult> = (
  id: ObjectID | string,
  options?: { cookie?: string; forwardedFor?: string },
): Promise<HttpResult> => {
  return send({
    method: "POST",
    path: `/api/dashboard/metadata/${id.toString()}`,
    cookie: options?.cookie,
    forwardedFor: options?.forwardedFor,
  });
};

const seo: (
  idOrDomain: ObjectID | string,
  options?: { cookie?: string; forwardedFor?: string },
) => Promise<HttpResult> = (
  idOrDomain: ObjectID | string,
  options?: { cookie?: string; forwardedFor?: string },
): Promise<HttpResult> => {
  return send({
    method: "GET",
    path: `/api/dashboard/seo/${idOrDomain.toString()}`,
    cookie: options?.cookie,
    forwardedFor: options?.forwardedFor,
  });
};

const unlock: (
  id: ObjectID | string,
  options?: { forwardedFor?: string },
) => Promise<HttpResult> = (
  id: ObjectID | string,
  options?: { forwardedFor?: string },
): Promise<HttpResult> => {
  return send({
    method: "POST",
    path: `/api/dashboard/master-password/${id.toString()}`,
    forwardedFor: options?.forwardedFor,
    body: { password: PASSWORD },
  });
};

// The lookups made for one dashboard since the last clear.
const lookupsFor: (id: ObjectID | string) => Array<Lookup> = (
  id: ObjectID | string,
): Array<Lookup> => {
  return lookups.filter((lookup: Lookup): boolean => {
    return lookup.id === id.toString();
  });
};

const contentColumnsRead: (id: ObjectID | string) => Array<string> = (
  id: ObjectID | string,
): Array<string> => {
  const read: Set<string> = new Set();

  for (const lookup of lookupsFor(id)) {
    for (const column of Object.keys(lookup.select)) {
      if (CONTENT_COLUMNS.includes(column)) {
        read.add(column);
      }
    }
  }

  return Array.from(read).sort();
};

type RouteHandler = (...args: Array<unknown>) => unknown;

type RouterLayer = {
  route?: {
    path: string;
    methods: Dictionary<boolean>;
    stack: Array<{ handle: RouteHandler }>;
  };
};

// The routes an Express router has registered, as "METHOD path".
const listRouteKeys: (router: ExpressRouter) => Array<string> = (
  router: ExpressRouter,
): Array<string> => {
  const keys: Array<string> = [];

  for (const layer of (router as unknown as { stack: Array<RouterLayer> })
    .stack) {
    if (!layer.route) {
      continue;
    }

    for (const method of Object.keys(layer.route.methods)) {
      keys.push(`${method.toUpperCase()} ${layer.route.path}`);
    }
  }

  return keys;
};

let api: DashboardAPI;
let verifyPassword: SpyInstance<
  typeof DashboardService.verifyHashedColumnValue
>;

describe("a dashboard's public link answers only what its visitor may see", () => {
  let server: http.Server;

  beforeAll(async () => {
    /*
     * The password route's attempt limiter fails closed without Redis; it
     * has its own tests. Let every request through, so these reach the routes.
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
      .mockImplementation(
        async (data: {
          id: ObjectID;
          select?: unknown;
        }): Promise<Dashboard | null> => {
          const select: Dictionary<unknown> = (data.select ||
            {}) as Dictionary<unknown>;

          lookups.push({ id: data.id.toString(), select });

          if (data.id.toString() === FAILING_ID.toString()) {
            throw new Error("connection reset");
          }

          const stored: Dashboard | undefined = DASHBOARDS[data.id.toString()];

          if (!stored) {
            return null;
          }

          // Only what the lookup asked for, the way the real service answers.
          const projected: Dashboard = new Dashboard();

          for (const column of Object.keys(select)) {
            (projected as unknown as Dictionary<unknown>)[column] = (
              stored as unknown as Dictionary<unknown>
            )[column];
          }

          return projected;
        },
      );

    jest
      .spyOn(DashboardDomainService, "findOneBy")
      .mockImplementation(
        async (
          data: FindOneBy<DashboardDomain>,
        ): Promise<DashboardDomain | null> => {
          const dashboardId: ObjectID | undefined =
            DOMAINS[String((data.query as Dictionary<unknown>)["fullDomain"])];

          if (!dashboardId) {
            return null;
          }

          const domain: DashboardDomain = new DashboardDomain();
          domain.dashboardId = dashboardId;
          return domain;
        },
      );

    // The stored hash stands for PASSWORD: the hashing has suites of its own.
    verifyPassword = jest
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

    api = new DashboardAPI();

    const app: express.Express = express();
    app.use(CookieParser());
    app.use(express.json());
    app.use("/api", api.getRouter());
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

  beforeEach(() => {
    lookups.length = 0;
    verifyPassword.mockClear();
  });

  describe.each([
    ["billing off (self-hosted)", false],
    ["billing on (OneUptime Cloud)", true],
  ])("%s", (_billing: string, isBillingEnabled: boolean) => {
    beforeEach(() => {
      setTestBillingEnabled(isBillingEnabled);
    });

    describe("the metadata the public dashboard app loads first", () => {
      it("answers a dashboard anyone with the link may view in full", async () => {
        const result: HttpResult = await metadata(PUBLIC_ID);

        expect(result.status).toBe(200);
        expect(result.body).toEqual(fullMetadata(PUBLIC_ID, "Public", false));
      });

      it("answers a password-protected dashboard with only what its password prompt shows", async () => {
        const result: HttpResult = await metadata(PROTECTED_ID);

        expect(result.status).toBe(200);
        expect(result.body).toEqual(promptMetadata(PROTECTED_ID, "Protected"));
      });

      it("reads only what the password prompt shows for a visitor who has not entered the password", async () => {
        await metadata(PROTECTED_ID);

        expect(contentColumnsRead(PROTECTED_ID)).toEqual(
          ["faviconFile", "name", "pageTitle"].sort(),
        );
      });

      it("answers in full once the visitor has entered the password, and still says the link asks for it", async () => {
        const result: HttpResult = await metadata(PROTECTED_ID, {
          cookie: unlockCookie(PROTECTED_ID),
        });

        expect(result.status).toBe(200);
        expect(result.body).toEqual(
          fullMetadata(PROTECTED_ID, "Protected", true),
        );
      });

      it("an unlock cookie for another dashboard unlocks nothing here", async () => {
        const result: HttpResult = await metadata(PROTECTED_ID, {
          cookie: unlockCookie(PUBLIC_ID),
        });

        expect(result.body).toEqual(promptMetadata(PROTECTED_ID, "Protected"));
      });

      it("an unlock cookie that does not decode unlocks nothing", async () => {
        const result: HttpResult = await metadata(PROTECTED_ID, {
          cookie: `${CookieUtil.getDashboardMasterPasswordKey(PROTECTED_ID)}=not-a-token`,
        });

        expect(result.body).toEqual(promptMetadata(PROTECTED_ID, "Protected"));
      });

      it("a locked dashboard (the switch on, no password) shows only its prompt, unlock cookie or not", async () => {
        for (const cookie of [undefined, unlockCookie(LOCKED_ID)]) {
          const result: HttpResult = await metadata(
            LOCKED_ID,
            cookie ? { cookie } : undefined,
          );

          expect(result.status).toBe(200);
          expect(result.body).toEqual(promptMetadata(LOCKED_ID, "Locked"));
        }
      });

      it("a missing dashboard is not found", async () => {
        const result: HttpResult = await metadata(MISSING_ID);

        expect(result.status).toBe(404);
        expect(errorMessageOf(result)).toBe("Dashboard not found");
      });

      it.each([
        ["a dashboard shared only with its project", PRIVATE_ID],
        [
          "a private dashboard with its password switch and a password left on",
          PRIVATE_WITH_PASSWORD_ID,
        ],
        ["an archived dashboard", ARCHIVED_ID],
        ["an archived password-protected dashboard", ARCHIVED_PROTECTED_ID],
      ])(
        "answers %s exactly like a dashboard that does not exist, and reads none of it",
        async (_label: string, id: ObjectID) => {
          const missing: HttpResult = await metadata(MISSING_ID);

          lookups.length = 0;

          for (const cookie of [undefined, unlockCookie(id)]) {
            const result: HttpResult = await metadata(
              id,
              cookie ? { cookie } : undefined,
            );

            expect(result).toEqual(missing);
          }

          expect(contentColumnsRead(id)).toEqual([]);
        },
      );

      it("answers a value that is not a dashboard id like a missing dashboard, without a query", async () => {
        const missing: HttpResult = await metadata(MISSING_ID);

        lookups.length = 0;

        expect(await metadata(MALFORMED_ID)).toEqual(missing);
        expect(lookups).toEqual([]);
      });

      it("lets in an address the IP allowlist names", async () => {
        const result: HttpResult = await metadata(ALLOWLISTED_ID, {
          forwardedFor: ALLOWED_IP,
        });

        expect(result.status).toBe(200);
        expect(result.body).toEqual(
          fullMetadata(ALLOWLISTED_ID, "Allowlisted", false),
        );
      });

      it("refuses any other address with 403, naming it, and reads nothing it would send", async () => {
        const result: HttpResult = await metadata(ALLOWLISTED_ID, {
          forwardedFor: OTHER_IP,
        });

        expect(result.status).toBe(403);
        expect(errorMessageOf(result)).toBe(
          `Your IP address ${OTHER_IP} is blocked from accessing this dashboard.`,
        );
        expect(JSON.stringify(result.body)).not.toContain("Allowlisted");
        expect(contentColumnsRead(ALLOWLISTED_ID)).toEqual([]);
      });

      it("refuses an address the allowlist does not name before showing a password prompt", async () => {
        for (const cookie of [
          undefined,
          unlockCookie(ALLOWLISTED_PROTECTED_ID),
        ]) {
          const result: HttpResult = await metadata(ALLOWLISTED_PROTECTED_ID, {
            forwardedFor: OTHER_IP,
            ...(cookie ? { cookie } : {}),
          });

          expect(result.status).toBe(403);
          expect(JSON.stringify(result.body)).not.toContain("Allowlisted");
        }

        // An address it names gets the prompt, and the password works there.
        expect(
          (
            await metadata(ALLOWLISTED_PROTECTED_ID, {
              forwardedFor: ALLOWED_IP,
            })
          ).body,
        ).toEqual(
          promptMetadata(ALLOWLISTED_PROTECTED_ID, "Allowlisted protected"),
        );
      });

      it("never carries a stored password's hash or salt", async () => {
        for (const id of Object.keys(DASHBOARDS)) {
          for (const cookie of [undefined, unlockCookie(new ObjectID(id))]) {
            const result: HttpResult = await metadata(id, {
              forwardedFor: ALLOWED_IP,
              ...(cookie ? { cookie } : {}),
            });

            expect(JSON.stringify(result.body)).not.toContain("stored-hash");
            expect(JSON.stringify(result.body)).not.toContain("salt");
          }
        }
      });
    });

    describe("the page head (SEO), rendered for whoever loads the page", () => {
      it("holds the title and description of a dashboard anyone with the link may view", async () => {
        const result: HttpResult = await seo(PUBLIC_ID);

        expect(result.status).toBe(200);
        expect(result.body).toEqual({
          _id: PUBLIC_ID.toString(),
          title: "Public page title",
          description: "Public page description",
        });
      });

      it("falls back to the name and description when no page title or description is set", async () => {
        expect((await seo(PLAIN_ID)).body).toEqual({
          _id: PLAIN_ID.toString(),
          title: "Plain name",
          description: "Plain description",
        });
      });

      it("holds only the title of a password-protected dashboard, even for a visitor holding its unlock cookie", async () => {
        const expected: JSONObject = {
          _id: PROTECTED_ID.toString(),
          title: "Protected page title",
          description: DEFAULT_SEO_DESCRIPTION,
        };

        expect((await seo(PROTECTED_ID)).body).toEqual(expected);
        expect(
          (await seo(PROTECTED_ID, { cookie: unlockCookie(PROTECTED_ID) }))
            .body,
        ).toEqual(expected);
        expect(contentColumnsRead(PROTECTED_ID)).toEqual(
          ["name", "pageTitle"].sort(),
        );
      });

      it("holds only the title of a locked dashboard", async () => {
        expect((await seo(LOCKED_ID)).body).toEqual({
          _id: LOCKED_ID.toString(),
          title: "Locked page title",
          description: DEFAULT_SEO_DESCRIPTION,
        });
      });

      it.each([
        ["a dashboard shared only with its project", PRIVATE_ID],
        [
          "a private dashboard with a password left on",
          PRIVATE_WITH_PASSWORD_ID,
        ],
        ["an archived dashboard", ARCHIVED_ID],
        ["a value that is not a dashboard id", MALFORMED_ID],
      ])(
        "says nothing about %s: not found, like a missing dashboard",
        async (_label: string, id: ObjectID | string) => {
          const missing: HttpResult = await seo(MISSING_ID);

          expect(missing.status).toBe(404);
          expect(errorMessageOf(missing)).toBe("Dashboard not found");

          lookups.length = 0;

          expect(await seo(id, { forwardedFor: ALLOWED_IP })).toEqual(missing);
          expect(contentColumnsRead(id)).toEqual([]);
        },
      );

      it.each([
        ["a dashboard with an IP allowlist", ALLOWLISTED_ID],
        [
          "a password-protected dashboard with an IP allowlist",
          ALLOWLISTED_PROTECTED_ID,
        ],
      ])(
        "holds only the generic title and description of %s, even for an address it names, and still answers so its llms.txt works",
        async (_label: string, id: ObjectID) => {
          for (const forwardedFor of [ALLOWED_IP, OTHER_IP]) {
            const result: HttpResult = await seo(id, { forwardedFor });

            expect(result.status).toBe(200);
            expect(result.body).toEqual({
              _id: id.toString(),
              title: "Dashboard",
              description: DEFAULT_SEO_DESCRIPTION,
            });
          }

          expect(contentColumnsRead(id)).toEqual([]);
        },
      );

      it("answers a custom domain the same way: a public dashboard's, and a private one's like a domain nobody has", async () => {
        const byDomain: HttpResult = await seo(PUBLIC_DOMAIN);

        expect(byDomain.status).toBe(200);
        expect(byDomain.body).toEqual((await seo(PUBLIC_ID)).body);

        const unknownDomain: HttpResult = await seo(UNKNOWN_DOMAIN);

        expect(unknownDomain.status).toBe(404);
        expect(await seo(PRIVATE_DOMAIN)).toEqual(unknownDomain);
        expect(await seo(ARCHIVED_DOMAIN)).toEqual(unknownDomain);
      });
    });

    describe("the custom domain lookup the public app makes on its own domain", () => {
      const lookUpDomain: (domain: string) => Promise<HttpResult> = (
        domain: string,
      ): Promise<HttpResult> => {
        return send({
          method: "POST",
          path: "/api/dashboard/domain",
          body: { domain },
        });
      };

      it.each([
        ["anyone with the link may view", PUBLIC_DOMAIN, PUBLIC_ID],
        ["is shared with a password", PROTECTED_DOMAIN, PROTECTED_ID],
        ["has an IP allowlist", ALLOWLISTED_DOMAIN, ALLOWLISTED_ID],
      ])(
        "names the dashboard of a domain whose dashboard %s: the routes the app calls next decide the rest",
        async (_label: string, domain: string, id: ObjectID) => {
          const result: HttpResult = await lookUpDomain(domain);

          expect(result.status).toBe(200);
          expect(result.body).toEqual({ dashboardId: id.toString() });
        },
      );

      it.each([
        ["a dashboard shared only with its project", PRIVATE_DOMAIN],
        ["an archived dashboard", ARCHIVED_DOMAIN],
      ])(
        "answers the domain of %s exactly like a domain no dashboard has",
        async (_label: string, domain: string) => {
          const unknown: HttpResult = await lookUpDomain(UNKNOWN_DOMAIN);

          expect(unknown.status).toBe(404);
          expect(errorMessageOf(unknown)).toBe("Dashboard not found");

          const result: HttpResult = await lookUpDomain(domain);

          expect(result).toEqual(unknown);
          expect(JSON.stringify(result.body)).not.toContain(
            DOMAINS[domain]!.toString(),
          );
        },
      );
    });

    describe("a lookup that fails", () => {
      it("is a server error on the routes that send the dashboard itself, never a not-found", async () => {
        for (const result of [
          await metadata(FAILING_ID),
          await seo(FAILING_ID),
        ]) {
          expect(result.status).toBe(500);
          expect(JSON.stringify(result.body)).not.toContain(
            "Dashboard not found",
          );
        }
      });

      it("is refused by the read check, which fails closed", async () => {
        const result: HttpResult = await send({
          method: "GET",
          path: `/api/dashboard/overview/${FAILING_ID.toString()}`,
        });

        expect(result.status).toBe(401);
        expect(errorMessageOf(result)).toBe("This dashboard is not available.");
      });
    });

    describe("the unlock cookie and the address are read only when the link needs them", () => {
      let decodeCookie: SpyInstance<typeof JSONWebToken.decodeJsonPayload>;

      beforeEach(() => {
        decodeCookie = jest.spyOn(JSONWebToken, "decodeJsonPayload");
      });

      afterEach(() => {
        decodeCookie.mockRestore();
      });

      it("never decodes an unlock cookie on a dashboard that asks for no password", async () => {
        await metadata(PUBLIC_ID, { cookie: unlockCookie(PUBLIC_ID) });
        await send({
          method: "GET",
          path: `/api/dashboard/overview/${PUBLIC_ID.toString()}`,
          cookie: unlockCookie(PUBLIC_ID),
        });

        expect(decodeCookie).not.toHaveBeenCalled();
      });

      it("decodes it on a dashboard that asks for the password", async () => {
        const result: HttpResult = await metadata(PROTECTED_ID, {
          cookie: unlockCookie(PROTECTED_ID),
        });

        expect(result.body).toEqual(
          fullMetadata(PROTECTED_ID, "Protected", true),
        );
        expect(decodeCookie).toHaveBeenCalled();
      });
    });

    describe("the password route", () => {
      it.each([
        ["a dashboard shared only with its project", PRIVATE_ID],
        [
          "a private dashboard with a password left on",
          PRIVATE_WITH_PASSWORD_ID,
        ],
        ["an archived password-protected dashboard", ARCHIVED_PROTECTED_ID],
        ["a value that is not a dashboard id", MALFORMED_ID],
      ])(
        "answers %s exactly like a dashboard that does not exist, and tries no password",
        async (_label: string, id: ObjectID | string) => {
          const missing: HttpResult = await unlock(MISSING_ID);

          expect(missing.status).toBe(404);
          expect(errorMessageOf(missing)).toBe("Dashboard not found");

          verifyPassword.mockClear();

          const result: HttpResult = await unlock(id);

          expect(result).toEqual(missing);
          expect(result.setCookie).toEqual([]);
          expect(verifyPassword).not.toHaveBeenCalled();
        },
      );

      it("tries no password from an address the IP allowlist does not name", async () => {
        const result: HttpResult = await unlock(ALLOWLISTED_PROTECTED_ID, {
          forwardedFor: OTHER_IP,
        });

        expect(result.status).toBe(403);
        expect(errorMessageOf(result)).toBe(
          `Your IP address ${OTHER_IP} is blocked from accessing this dashboard.`,
        );
        expect(result.setCookie).toEqual([]);
        expect(verifyPassword).not.toHaveBeenCalled();
      });

      it("unlocks from an address the IP allowlist names", async () => {
        const result: HttpResult = await unlock(ALLOWLISTED_PROTECTED_ID, {
          forwardedFor: ALLOWED_IP,
        });

        expect(result.status).toBe(200);
        expect(
          result.setCookie.some((header: string): boolean => {
            return header.startsWith(
              `${CookieUtil.getDashboardMasterPasswordKey(ALLOWLISTED_PROTECTED_ID)}=`,
            );
          }),
        ).toBe(true);
      });

      it("still says a public dashboard without a password has none to enter", async () => {
        const result: HttpResult = await unlock(PUBLIC_ID);

        expect(result.status).toBe(400);
        expect(errorMessageOf(result)).toBe(
          "Master password has not been configured for this dashboard.",
        );
      });
    });
  });

  /*
   * Every custom route the dashboard API registers - the public surface -
   * driven for a private and an archived dashboard, and compared with what
   * it answers for an id no dashboard has. Routes added later are walked
   * too: they get this check without anyone remembering to add it.
   */
  describe("every public dashboard route", () => {
    const REQUEST_BODY: JSONObject = {
      password: PASSWORD,
      attributeKey: "host.name",
      componentId: "ab000000-0000-4000-8000-0000000000cc",
      aggregateBy: {
        query: { name: "http.server.duration" },
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
      },
    };

    // The custom routes: everything but the inherited CRUD routes.
    const publicRoutes: () => Array<string> = (): Array<string> => {
      const inherited: Set<string> = new Set(
        listRouteKeys(new BaseAPI(Dashboard, DashboardService).getRouter()),
      );

      return listRouteKeys(api.getRouter()).filter((key: string): boolean => {
        return !inherited.has(key);
      });
    };

    /*
     * The one route that takes no dashboard: it turns a verified custom
     * domain into its dashboard's id for the public app, and every route that
     * id is then sent to decides access itself.
     */
    const DOMAIN_ROUTE: string = "POST /dashboard/domain";

    const pathFor: (key: string, id: string) => string = (
      key: string,
      id: string,
    ): string => {
      const routePath: string = key.split(" ")[1] || "";

      return `/api${routePath
        .replace(":dashboardIdOrDomain", id)
        .replace(":dashboardId", id)
        .replace(":resourceType", "monitor")}`;
    };

    it("takes a dashboard in its path, on every route but the domain lookup", () => {
      const routes: Array<string> = publicRoutes();
      const TAKES_A_DASHBOARD: RegExp = /:dashboardId(OrDomain)?\b/;

      expect(routes.length).toBeGreaterThan(8);
      expect(routes).toContain(DOMAIN_ROUTE);

      for (const key of routes) {
        if (key === DOMAIN_ROUTE) {
          continue;
        }

        expect([key, TAKES_A_DASHBOARD.test(key)]).toEqual([key, true]);
      }
    });

    it.each([
      ["a dashboard shared only with its project", PRIVATE_ID],
      [
        "a private dashboard with a password left on, to a visitor holding its unlock cookie",
        PRIVATE_WITH_PASSWORD_ID,
      ],
      ["an archived dashboard", ARCHIVED_ID],
    ])(
      "answers %s exactly like a missing one, reading nothing it would send",
      async (_label: string, id: ObjectID) => {
        for (const key of publicRoutes()) {
          if (key === DOMAIN_ROUTE) {
            continue;
          }

          const method: "GET" | "POST" = key.startsWith("GET") ? "GET" : "POST";

          const missing: HttpResult = await send({
            method,
            path: pathFor(key, MISSING_ID.toString()),
            body: REQUEST_BODY,
            cookie: unlockCookie(id),
            forwardedFor: ALLOWED_IP,
          });

          lookups.length = 0;

          const result: HttpResult = await send({
            method,
            path: pathFor(key, id.toString()),
            body: REQUEST_BODY,
            cookie: unlockCookie(id),
            forwardedFor: ALLOWED_IP,
          });

          expect([key, result]).toEqual([key, missing]);
          expect([key, contentColumnsRead(id)]).toEqual([key, []]);
        }
      },
    );
  });
});
