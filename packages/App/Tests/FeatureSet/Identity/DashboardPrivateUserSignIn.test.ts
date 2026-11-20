jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
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

/*
 * The limiters fail closed without Redis, and have suites of their own
 * (IdentityRateLimit, PublicDashboardRateLimit): here they let every
 * request through, and note which bucket each route counts in.
 */
const rateLimitBuckets: Array<string> = [];

jest.mock("Common/Server/Middleware/IdentityRateLimit", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Middleware/IdentityRateLimit",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getMiddleware: (bucket: string): unknown => {
        return (_req: unknown, _res: unknown, next: () => void): void => {
          rateLimitBuckets.push(`identity:${bucket}`);
          next();
        };
      },
    },
  };
});

jest.mock("Common/Server/Middleware/PublicDashboardRateLimit", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Middleware/PublicDashboardRateLimit",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getMiddleware: (bucket: string): unknown => {
        return (_req: unknown, _res: unknown, next: () => void): void => {
          rateLimitBuckets.push(`public-dashboard:${bucket}`);
          next();
        };
      },
    },
  };
});

import DashboardPrivateUserAuthenticationAPI, {
  DASHBOARD_SIGN_IN_BODY_MESSAGE,
  DASHBOARD_SIGN_IN_FOREIGN_PAGE_MESSAGE,
} from "../../../FeatureSet/Identity/API/DashboardPrivateUserAuthentication";
import { IdentityRateLimitBucket } from "Common/Server/Middleware/IdentityRateLimit";
import DashboardOidcService from "Common/Server/Services/DashboardOidcService";
import DashboardPrivateUserService from "Common/Server/Services/DashboardPrivateUserService";
import DashboardPrivateUserSessionService from "Common/Server/Services/DashboardPrivateUserSessionService";
import DashboardService from "Common/Server/Services/DashboardService";
import DashboardSsoService from "Common/Server/Services/DashboardSsoService";
import MailService from "Common/Server/Services/MailService";
import ProjectService from "Common/Server/Services/ProjectService";
import {
  PRIVATE_USER_SESSION_SIGNED_OUT_REASON,
  PRIVATE_USER_SIGN_IN_NO_LONGER_ACCEPTED_REASON,
} from "Common/Server/Services/PrivateUserSessionServiceBase";
import CookieUtil, {
  PUBLIC_DASHBOARD_API_COOKIE_PATH,
} from "Common/Server/Utils/Cookie";
import { PUBLIC_DASHBOARD_NOT_FOUND_MESSAGE } from "Common/Server/Utils/Dashboard/PublicDashboardAccess";
import JSONWebToken, {
  DashboardPrivateUserSessionClaims,
} from "Common/Server/Utils/JsonWebToken";
import PasswordHash from "Common/Server/Utils/PasswordHash";
import PublicMessageRateLimit, {
  PublicMessageKind,
} from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardPrivateUser from "Common/Models/DatabaseModels/DashboardPrivateUser";
import DashboardPrivateUserSession from "Common/Models/DatabaseModels/DashboardPrivateUserSession";
import { RESET_LINK_MESSAGES } from "Common/Types/Accounts/SignInMessages";
import {
  DASHBOARD_PRIVATE_USER_CREDENTIALS_MESSAGE,
  DASHBOARD_SESSION_EXPIRED_MESSAGE,
  DASHBOARD_SIGN_IN_CODE_INVALID_MESSAGE,
  DASHBOARD_SIGN_IN_NOT_ASKED_MESSAGE,
  DASHBOARD_SIGNED_OUT_MESSAGE,
  DASHBOARD_SSO_ONLY_MESSAGE,
} from "Common/Types/Dashboard/DashboardPrivateUserSignIn";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import TooManyRequestsException from "Common/Types/Exception/TooManyRequestsException";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import { getJestSpyOn } from "Common/Tests/Spy";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import { CookieParser } from "Common/Tests/Server/TestingUtils/PasskeyHttpIntegration";
import { ExpressJson, createExpressApp } from "Common/Server/Utils/Express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * ---------------------------------------------------------------------------
 * A DASHBOARD'S PUBLIC LINK SIGNS ITS PRIVATE USERS IN, OUT, AND BACK IN
 * WITH A NEW PASSWORD (#10250) - and says nothing about who is invited.
 *
 * The real sign-in router, mounted where the identity service mounts it
 * (/api/dashboard/private-user, where every host's /public-dashboard-api/
 * private-user leads), behind a real Express app with cookie-parser and the
 * production error handler; its cookies are read from real Set-Cookie
 * headers, its tokens are real JWTs. The public link's decision is the real
 * one (DashboardService.decidePublicAccess). Only the data layer, the mail
 * and the hash check are stand-ins.
 *
 *   - sign-in: the right password signs in, with three HttpOnly,
 *     SameSite=Strict cookies sent only to the link's API; a wrong
 *     password, an address nobody invited and one invited with no password
 *     yet get the very same answer; a dashboard that takes only single
 *     sign-on takes no password; a request another site's page sent, or
 *     one that is not JSON, is refused before anything is read;
 *   - sign-out ends the session, by its refresh token or its sign-out
 *     cookie, and clears every cookie;
 *   - a refresh renews only a session that still counts, and ends one that
 *     does not;
 *   - a forgotten password gets the same answer for every address, counted
 *     per caller and per address before the address is looked up, and a
 *     reset link that works once, for a day;
 *   - a single sign-on code becomes a session on this host, once;
 *   - the sign-in page is told the ways in, and nothing else of them;
 *   - none of it answers for a dashboard that does not ask its visitors to
 *     sign in.
 * ---------------------------------------------------------------------------
 */

const DASHBOARD_ID: ObjectID = new ObjectID(
  "7dab0000-0000-4000-8000-000000000001",
);
const OTHER_DASHBOARD_ID: ObjectID = new ObjectID(
  "7dab0000-0000-4000-8000-000000000002",
);
const MISSING_DASHBOARD_ID: ObjectID = new ObjectID(
  "7dab0000-0000-4000-8000-0000000000ff",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "7dab0000-0000-4000-8000-0000000000ee",
);
const PRIVATE_USER_ID: ObjectID = new ObjectID(
  "7dab0000-0000-4000-8000-0000000000a1",
);
const SESSION_ID: ObjectID = new ObjectID(
  "7dab0000-0000-4000-8000-0000000000b1",
);

const INVITED_EMAIL: string = "reader@example.com";
const UNKNOWN_EMAIL: string = "stranger@example.com";
const NO_PASSWORD_EMAIL: string = "invited-no-password@example.com";
const PASSWORD: string = "correct horse battery staple 9";

const DASHBOARD_ADDRESS: string = "https://dashboards.acme.example.com";

let stored: Dashboard | null = null;

const dashboardThatAsksVisitorsToSignIn: () => Dashboard = (): Dashboard => {
  const dashboard: Dashboard = new Dashboard();
  dashboard.id = DASHBOARD_ID;
  dashboard._id = DASHBOARD_ID.toString();
  dashboard.projectId = PROJECT_ID;
  dashboard.name = "Checkout";
  dashboard.pageTitle = "Checkout status";
  dashboard.isPublicDashboard = true;
  dashboard.enableMasterPassword = false;
  dashboard.requireSignIn = true;
  dashboard.requireSsoForLogin = false;
  dashboard.isArchived = false;
  return dashboard;
};

const privateUser: (
  email: string,
  withPassword: boolean,
) => DashboardPrivateUser = (
  email: string,
  withPassword: boolean,
): DashboardPrivateUser => {
  const user: DashboardPrivateUser = new DashboardPrivateUser();
  user.id = PRIVATE_USER_ID;
  user._id = PRIVATE_USER_ID.toString();
  user.email = new Email(email);
  user.dashboardId = DASHBOARD_ID;
  user.projectId = PROJECT_ID;

  if (withPassword) {
    user.password = new HashedString("stored-hash", true);
  }

  return user;
};

const sessionRow: (data?: {
  dashboardId?: ObjectID | undefined;
}) => DashboardPrivateUserSession = (data?: {
  dashboardId?: ObjectID | undefined;
}): DashboardPrivateUserSession => {
  const session: DashboardPrivateUserSession =
    new DashboardPrivateUserSession();
  session.id = SESSION_ID;
  session._id = SESSION_ID.toString();
  session.dashboardId = data?.dashboardId || DASHBOARD_ID;
  session.dashboardPrivateUserId = PRIVATE_USER_ID;
  session.projectId = PROJECT_ID;
  return session;
};

const NEW_SESSION: () => {
  session: DashboardPrivateUserSession;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
} = () => {
  return {
    session: sessionRow(),
    refreshToken: "8dab0000-0000-4000-8000-000000000001",
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
};

type HttpResult = {
  status: number;
  body: JSONObject | null;
  setCookie: Array<string>;
};

let port: number = 0;

function send(data: {
  path: string;
  body?: JSONObject | undefined;
  rawBody?: string | undefined;
  contentType?: string | undefined;
  cookie?: string | undefined;
  origin?: string | undefined;
  forwardedFor?: string | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string =
        data.rawBody !== undefined
          ? data.rawBody
          : JSON.stringify(data.body || {});

      const headers: http.OutgoingHttpHeaders = {
        "content-type": data.contentType || "application/json",
        "content-length": Buffer.byteLength(payload),
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0",
      };

      if (data.cookie) {
        headers["cookie"] = data.cookie;
      }

      if (data.origin) {
        headers["origin"] = data.origin;
      }

      if (data.forwardedFor) {
        headers["x-forwarded-for"] = data.forwardedFor;
      }

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/api/dashboard/private-user${data.path}`,
          method: "POST",
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
      request.write(payload);
      request.end();
    },
  );
}

function errorMessageOf(result: HttpResult): unknown {
  return result.body?.["message"] ?? result.body?.["error"];
}

// The Set-Cookie header of one cookie, by name.
function setCookieOf(result: HttpResult, name: string): string | undefined {
  return result.setCookie.find((header: string): boolean => {
    return header.startsWith(`${name}=`);
  });
}

function cookieValueOf(result: HttpResult, name: string): string | undefined {
  const header: string | undefined = setCookieOf(result, name);

  return header ? header.split(";")[0]!.substring(name.length + 1) : undefined;
}

// A cookie the answer removes: emptied, and expired.
const EMPTIED_COOKIE: RegExp = /^[^=]+=;/;
const EXPIRED_COOKIE: RegExp = /Expires=Thu, 01 Jan 1970/i;

function isCleared(header: string | undefined): boolean {
  return Boolean(
    header && EMPTIED_COOKIE.test(header) && EXPIRED_COOKIE.test(header),
  );
}

const TOKEN_COOKIE: string =
  CookieUtil.getDashboardPrivateUserTokenKey(DASHBOARD_ID);
const REFRESH_COOKIE: string =
  CookieUtil.getDashboardPrivateUserRefreshTokenKey(DASHBOARD_ID);
const SIGN_OUT_COOKIE: string =
  CookieUtil.getDashboardPrivateUserSignOutKey(DASHBOARD_ID);

const login: (
  email: string,
  password: string,
  options?: { dashboardId?: ObjectID; origin?: string; forwardedFor?: string },
) => Promise<HttpResult> = (
  email: string,
  password: string,
  options?: { dashboardId?: ObjectID; origin?: string; forwardedFor?: string },
): Promise<HttpResult> => {
  return send({
    path: `/login/${(options?.dashboardId || DASHBOARD_ID).toString()}`,
    body: { data: { email, password } },
    origin: options?.origin,
    forwardedFor: options?.forwardedFor,
  });
};

const forgotPassword: (
  email: string,
  dashboardId?: ObjectID,
) => Promise<HttpResult> = (
  email: string,
  dashboardId?: ObjectID,
): Promise<HttpResult> => {
  return send({
    path: `/forgot-password/${(dashboardId || DASHBOARD_ID).toString()}`,
    body: { data: { email } },
  });
};

let server: http.Server;

beforeAll(async () => {
  const app: ReturnType<typeof createExpressApp> = createExpressApp();
  app.use(CookieParser());
  app.use(ExpressJson());
  app.use("/api/dashboard/private-user", DashboardPrivateUserAuthenticationAPI);
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
});

beforeEach(() => {
  jest.restoreAllMocks();
  rateLimitBuckets.length = 0;
  stored = dashboardThatAsksVisitorsToSignIn();

  getJestSpyOn(DashboardService, "findOneById").mockImplementation(
    async (data: { id: ObjectID }): Promise<Dashboard | null> => {
      return stored && data.id.toString() === DASHBOARD_ID.toString()
        ? stored
        : null;
    },
  );
  getJestSpyOn(DashboardService, "getPublicDashboardUrl").mockResolvedValue(
    DASHBOARD_ADDRESS,
  );
  getJestSpyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

  // The invited reader with a password, one invited with none yet, nobody else.
  getJestSpyOn(DashboardPrivateUserService, "findOneBy").mockImplementation(
    async (data: {
      query: { email: Email; dashboardId: ObjectID };
    }): Promise<DashboardPrivateUser | null> => {
      if (data.query.dashboardId.toString() !== DASHBOARD_ID.toString()) {
        return null;
      }

      const email: string = data.query.email.toString();

      if (email === INVITED_EMAIL) {
        return privateUser(INVITED_EMAIL, true);
      }

      if (email === NO_PASSWORD_EMAIL) {
        return privateUser(NO_PASSWORD_EMAIL, false);
      }

      return null;
    },
  );
  getJestSpyOn(DashboardPrivateUserService, "findOneById").mockResolvedValue(
    privateUser(INVITED_EMAIL, true),
  );
  getJestSpyOn(
    DashboardPrivateUserService,
    "verifyHashedColumnValue",
  ).mockImplementation(
    async (data: { plainValue: string }): Promise<boolean> => {
      return data.plainValue === PASSWORD;
    },
  );
  getJestSpyOn(DashboardPrivateUserService, "updateOneById").mockResolvedValue(
    undefined,
  );

  getJestSpyOn(
    DashboardPrivateUserSessionService,
    "createSession",
  ).mockResolvedValue(NEW_SESSION());
  getJestSpyOn(
    DashboardPrivateUserSessionService,
    "findSignedInSession",
  ).mockResolvedValue(null);
  getJestSpyOn(
    DashboardPrivateUserSessionService,
    "revokeSessionByRefreshToken",
  ).mockResolvedValue(true);
  getJestSpyOn(
    DashboardPrivateUserSessionService,
    "revokeLiveSessionOfPrivateUser",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    DashboardPrivateUserSessionService,
    "revokeSessionById",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    DashboardPrivateUserSessionService,
    "findActiveSessionByRefreshToken",
  ).mockResolvedValue(sessionRow());
  getJestSpyOn(
    DashboardPrivateUserSessionService,
    "doesSignInStillCount",
  ).mockResolvedValue(true);
  getJestSpyOn(
    DashboardPrivateUserSessionService,
    "renewSessionWithNewRefreshToken",
  ).mockResolvedValue(NEW_SESSION());
  getJestSpyOn(
    DashboardPrivateUserSessionService,
    "exchangeLoginCode",
  ).mockResolvedValue(NEW_SESSION());

  getJestSpyOn(MailService, "sendMail").mockResolvedValue(undefined);
  getJestSpyOn(PasswordHash, "spendVerificationTime").mockResolvedValue(
    undefined,
  );
  getJestSpyOn(PublicMessageRateLimit, "assertMaySend").mockResolvedValue(
    undefined,
  );
});

describe("signing in with a password", () => {
  it("signs an invited private user in, with three HttpOnly, SameSite=Strict cookies sent only to the link's API, and answers only their address", async () => {
    const result: HttpResult = await login(INVITED_EMAIL, PASSWORD);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ email: INVITED_EMAIL });

    const token: string | undefined = setCookieOf(result, TOKEN_COOKIE);
    const refresh: string | undefined = setCookieOf(result, REFRESH_COOKIE);
    const signOut: string | undefined = setCookieOf(result, SIGN_OUT_COOKIE);

    for (const header of [token, refresh, signOut]) {
      expect(header).toBeDefined();
      expect(header).toMatch(/; HttpOnly/);
      expect(header).toMatch(/; SameSite=Strict/);
    }

    expect(token).toContain(`Path=${PUBLIC_DASHBOARD_API_COOKIE_PATH};`);
    expect(refresh).toContain(`Path=${PUBLIC_DASHBOARD_API_COOKIE_PATH};`);
    expect(signOut).toContain(
      `Path=${PUBLIC_DASHBOARD_API_COOKIE_PATH}/private-user/logout/${DASHBOARD_ID.toString()};`,
    );

    // The access token is this session's, of this dashboard, for its purpose only.
    const claims: DashboardPrivateUserSessionClaims =
      JSONWebToken.decodeDashboardPrivateUserSession(
        cookieValueOf(result, TOKEN_COOKIE)!,
      );

    expect(claims.dashboardId.toString()).toBe(DASHBOARD_ID.toString());
    expect(claims.userId.toString()).toBe(PRIVATE_USER_ID.toString());
    expect(claims.sessionId.toString()).toBe(SESSION_ID.toString());
    expect(() => {
      return JSONWebToken.decode(cookieValueOf(result, TOKEN_COOKIE)!);
    }).toThrow();
    expect(() => {
      return JSONWebToken.decodeDashboardPrivateUserSessionToSignOut(
        cookieValueOf(result, TOKEN_COOKIE)!,
      );
    }).toThrow();

    const created: Record<string, unknown> = (
      DashboardPrivateUserSessionService.createSession as unknown as jest.Mock
    ).mock.calls[0]![0] as Record<string, unknown>;

    expect(created["resourceId"]?.toString()).toBe(DASHBOARD_ID.toString());
    expect(created["privateUserId"]?.toString()).toBe(
      PRIVATE_USER_ID.toString(),
    );
    expect(created["signIn"]).toEqual({ method: SignInMethod.Password });
  });

  it("counts every attempt in the private-user sign-in bucket, before anything is read", async () => {
    await login(INVITED_EMAIL, "not it");

    expect(rateLimitBuckets).toEqual([
      `identity:${IdentityRateLimitBucket.DashboardPrivateUserLogin}`,
    ]);
  });

  it("answers a wrong password, an address nobody invited and one invited with no password yet exactly alike", async () => {
    const answers: Array<HttpResult> = [
      await login(INVITED_EMAIL, "not the password"),
      await login(UNKNOWN_EMAIL, PASSWORD),
      await login(NO_PASSWORD_EMAIL, PASSWORD),
    ];

    for (const answer of answers) {
      expect(answer.status).toBe(400);
      expect(errorMessageOf(answer)).toBe(
        DASHBOARD_PRIVATE_USER_CREDENTIALS_MESSAGE,
      );
      expect(answer.setCookie).toEqual([]);
      expect(answer).toEqual(answers[0]);
    }

    // The two with no password to check spend as long as a check takes.
    expect(PasswordHash.spendVerificationTime).toHaveBeenCalledTimes(2);
    expect(
      DashboardPrivateUserSessionService.createSession,
    ).not.toHaveBeenCalled();
  });

  it("looks the address up on this dashboard alone: a private user of another dashboard is nobody here", async () => {
    await login(INVITED_EMAIL, PASSWORD);

    const lookup: { query: Record<string, unknown> } = (
      DashboardPrivateUserService.findOneBy as unknown as jest.Mock
    ).mock.calls[0]![0] as { query: Record<string, unknown> };

    expect(lookup.query["dashboardId"]?.toString()).toBe(
      DASHBOARD_ID.toString(),
    );
  });

  it("takes no password on a dashboard that takes only single sign-on, before looking anybody up", async () => {
    stored!.requireSsoForLogin = true;

    for (const email of [INVITED_EMAIL, UNKNOWN_EMAIL]) {
      const result: HttpResult = await login(email, PASSWORD);

      expect(result.status).toBe(400);
      expect(errorMessageOf(result)).toBe(DASHBOARD_SSO_ONLY_MESSAGE);
    }

    expect(DashboardPrivateUserService.findOneBy).not.toHaveBeenCalled();
  });

  it("signs nobody in on a dashboard that does not ask its visitors to sign in", async () => {
    stored!.requireSignIn = false;

    const result: HttpResult = await login(INVITED_EMAIL, PASSWORD);

    expect(result.status).toBe(400);
    expect(errorMessageOf(result)).toBe(DASHBOARD_SIGN_IN_NOT_ASKED_MESSAGE);
    expect(DashboardPrivateUserService.findOneBy).not.toHaveBeenCalled();
  });

  it("answers a dashboard shared only with its project, an archived one and a missing one alike", async () => {
    const missing: HttpResult = await login(INVITED_EMAIL, PASSWORD, {
      dashboardId: MISSING_DASHBOARD_ID,
    });

    expect(missing.status).toBe(404);
    expect(errorMessageOf(missing)).toBe(PUBLIC_DASHBOARD_NOT_FOUND_MESSAGE);

    stored!.isPublicDashboard = false;
    expect(await login(INVITED_EMAIL, PASSWORD)).toEqual(missing);

    stored = dashboardThatAsksVisitorsToSignIn();
    stored.isArchived = true;
    expect(await login(INVITED_EMAIL, PASSWORD)).toEqual(missing);

    expect(DashboardPrivateUserService.findOneBy).not.toHaveBeenCalled();
  });

  it("refuses an address the dashboard's IP allowlist does not name before looking anybody up", async () => {
    stored!.ipWhitelist = "203.0.113.7";

    const refused: HttpResult = await login(INVITED_EMAIL, PASSWORD, {
      forwardedFor: "198.51.100.5",
    });

    expect(refused.status).toBe(403);
    expect(DashboardPrivateUserService.findOneBy).not.toHaveBeenCalled();
  });

  it("refuses a request another site's page had a browser send, before counting or reading anything", async () => {
    const result: HttpResult = await login(INVITED_EMAIL, PASSWORD, {
      origin: "https://evil.example.net",
    });

    expect(result.status).toBe(403);
    expect(errorMessageOf(result)).toBe(DASHBOARD_SIGN_IN_FOREIGN_PAGE_MESSAGE);
    expect(rateLimitBuckets).toEqual([]);
    expect(DashboardPrivateUserService.findOneBy).not.toHaveBeenCalled();

    // The dashboard's own page, on the host the request goes to, is let in.
    expect(
      (
        await login(INVITED_EMAIL, PASSWORD, {
          origin: `http://127.0.0.1:${port}`,
        })
      ).status,
    ).toBe(200);
  });

  it("takes only a JSON body, the one kind another site's page cannot send without asking first", async () => {
    const result: HttpResult = await send({
      path: `/login/${DASHBOARD_ID.toString()}`,
      rawBody: `data[email]=${INVITED_EMAIL}&data[password]=${PASSWORD}`,
      contentType: "application/x-www-form-urlencoded",
    });

    expect(result.status).toBe(400);
    expect(errorMessageOf(result)).toBe(DASHBOARD_SIGN_IN_BODY_MESSAGE);
    expect(DashboardPrivateUserService.findOneBy).not.toHaveBeenCalled();
  });

  it("refuses an empty address or password before any lookup, where an empty value would match everyone", async () => {
    for (const [email, password] of [
      ["", PASSWORD],
      [INVITED_EMAIL, ""],
    ]) {
      const result: HttpResult = await login(email!, password!);

      expect(result.status).toBe(400);
    }

    const notText: HttpResult = await send({
      path: `/login/${DASHBOARD_ID.toString()}`,
      body: { data: { email: { $ne: "" }, password: [PASSWORD] } },
    });

    expect(notText.status).toBe(400);
    expect(DashboardPrivateUserService.findOneBy).not.toHaveBeenCalled();
  });
});

describe("signing out", () => {
  it("ends the session by its refresh token and clears every cookie of it, each on its own path", async () => {
    const result: HttpResult = await send({
      path: `/logout/${DASHBOARD_ID.toString()}`,
      cookie: `${REFRESH_COOKIE}=the-refresh-token`,
    });

    expect(result.status).toBe(200);
    expect(
      DashboardPrivateUserSessionService.revokeSessionByRefreshToken,
    ).toHaveBeenCalledWith("the-refresh-token", {
      reason: PRIVATE_USER_SESSION_SIGNED_OUT_REASON,
    });

    expect(isCleared(setCookieOf(result, TOKEN_COOKIE))).toBe(true);
    expect(isCleared(setCookieOf(result, REFRESH_COOKIE))).toBe(true);
    expect(isCleared(setCookieOf(result, SIGN_OUT_COOKIE))).toBe(true);
    expect(setCookieOf(result, SIGN_OUT_COOKIE)).toContain(
      `Path=${PUBLIC_DASHBOARD_API_COOKIE_PATH}/private-user/logout/${DASHBOARD_ID.toString()};`,
    );
  });

  it("ends it by its sign-out cookie when the refresh token was lost to a renewal", async () => {
    getJestSpyOn(
      DashboardPrivateUserSessionService,
      "revokeSessionByRefreshToken",
    ).mockResolvedValue(false);

    const signOutToken: string =
      JSONWebToken.signDashboardPrivateUserSessionSignOutToken({
        dashboardId: DASHBOARD_ID,
        userId: PRIVATE_USER_ID,
        sessionId: SESSION_ID,
        expiresInSeconds: 3600,
      });

    await send({
      path: `/logout/${DASHBOARD_ID.toString()}`,
      cookie: `${REFRESH_COOKIE}=a-rotated-token; ${SIGN_OUT_COOKIE}=${signOutToken}`,
    });

    const revoked: Record<string, unknown> = (
      DashboardPrivateUserSessionService.revokeLiveSessionOfPrivateUser as unknown as jest.Mock
    ).mock.calls[0]![0] as Record<string, unknown>;

    expect(revoked["resourceId"]?.toString()).toBe(DASHBOARD_ID.toString());
    expect(revoked["privateUserId"]?.toString()).toBe(
      PRIVATE_USER_ID.toString(),
    );
    expect(revoked["sessionId"]?.toString()).toBe(SESSION_ID.toString());
  });

  it("ends nothing with another dashboard's sign-out cookie, or an access token in its place", async () => {
    const otherDashboards: string =
      JSONWebToken.signDashboardPrivateUserSessionSignOutToken({
        dashboardId: OTHER_DASHBOARD_ID,
        userId: PRIVATE_USER_ID,
        sessionId: SESSION_ID,
        expiresInSeconds: 3600,
      });
    const accessToken: string =
      JSONWebToken.signDashboardPrivateUserSessionToken({
        dashboardId: DASHBOARD_ID,
        userId: PRIVATE_USER_ID,
        sessionId: SESSION_ID,
        expiresInSeconds: 900,
      });

    for (const token of [otherDashboards, accessToken]) {
      const result: HttpResult = await send({
        path: `/logout/${DASHBOARD_ID.toString()}`,
        cookie: `${SIGN_OUT_COOKIE}=${token}`,
      });

      expect(result.status).toBe(200);
    }

    expect(
      DashboardPrivateUserSessionService.revokeLiveSessionOfPrivateUser,
    ).not.toHaveBeenCalled();
  });

  it("answers a browser holding no session the same, and clears the cookies all the same", async () => {
    const result: HttpResult = await send({
      path: `/logout/${DASHBOARD_ID.toString()}`,
    });

    expect(result.status).toBe(200);
    expect(isCleared(setCookieOf(result, TOKEN_COOKIE))).toBe(true);
  });

  it("refuses a sign-out another site's page had a browser send: no other site can sign the reader out", async () => {
    const result: HttpResult = await send({
      path: `/logout/${DASHBOARD_ID.toString()}`,
      cookie: `${REFRESH_COOKIE}=the-refresh-token`,
      origin: "https://evil.example.net",
    });

    expect(result.status).toBe(403);
    expect(
      DashboardPrivateUserSessionService.revokeSessionByRefreshToken,
    ).not.toHaveBeenCalled();
  });
});

describe("renewing a session", () => {
  const refresh: (cookie?: string) => Promise<HttpResult> = (
    cookie?: string,
  ): Promise<HttpResult> => {
    return send({
      path: `/refresh-token/${DASHBOARD_ID.toString()}`,
      cookie,
    });
  };

  it("renews a session that still counts, with new cookies", async () => {
    const result: HttpResult = await refresh(`${REFRESH_COOKIE}=refresh-1`);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ email: INVITED_EMAIL });
    expect(setCookieOf(result, TOKEN_COOKIE)).toMatch(/; HttpOnly/);
    expect(
      DashboardPrivateUserSessionService.renewSessionWithNewRefreshToken,
    ).toHaveBeenCalledTimes(1);
  });

  it("answers a browser with no refresh token as signed out", async () => {
    const result: HttpResult = await refresh();

    expect(result.status).toBe(401);
    expect(errorMessageOf(result)).toBe(DASHBOARD_SIGNED_OUT_MESSAGE);
    expect(isCleared(setCookieOf(result, TOKEN_COOKIE))).toBe(true);
  });

  it("ends a session of another dashboard presented here", async () => {
    getJestSpyOn(
      DashboardPrivateUserSessionService,
      "findActiveSessionByRefreshToken",
    ).mockResolvedValue(sessionRow({ dashboardId: OTHER_DASHBOARD_ID }));

    const result: HttpResult = await refresh(`${REFRESH_COOKIE}=refresh-1`);

    expect(result.status).toBe(401);
    expect(errorMessageOf(result)).toBe(DASHBOARD_SESSION_EXPIRED_MESSAGE);
    expect(
      DashboardPrivateUserSessionService.revokeSessionById,
    ).toHaveBeenCalled();
    expect(
      DashboardPrivateUserSessionService.renewSessionWithNewRefreshToken,
    ).not.toHaveBeenCalled();
  });

  it("ends a session whose sign-in no longer counts: Require SSO turned on, or its provider turned off", async () => {
    getJestSpyOn(
      DashboardPrivateUserSessionService,
      "doesSignInStillCount",
    ).mockResolvedValue(false);

    const result: HttpResult = await refresh(`${REFRESH_COOKIE}=refresh-1`);

    expect(result.status).toBe(401);
    expect(
      DashboardPrivateUserSessionService.revokeSessionById,
    ).toHaveBeenCalledWith(SESSION_ID, {
      reason: PRIVATE_USER_SIGN_IN_NO_LONGER_ACCEPTED_REASON,
    });
    expect(isCleared(setCookieOf(result, REFRESH_COOKIE))).toBe(true);
  });

  it("ends a session whose private user was removed", async () => {
    getJestSpyOn(DashboardPrivateUserService, "findOneById").mockResolvedValue(
      null,
    );

    const result: HttpResult = await refresh(`${REFRESH_COOKIE}=refresh-1`);

    expect(result.status).toBe(401);
    expect(
      DashboardPrivateUserSessionService.revokeSessionById,
    ).toHaveBeenCalled();
  });

  it("renews nothing once the dashboard stops asking its visitors to sign in, and clears the cookies", async () => {
    stored!.requireSignIn = false;

    const result: HttpResult = await refresh(`${REFRESH_COOKIE}=refresh-1`);

    expect(result.status).toBe(400);
    expect(isCleared(setCookieOf(result, TOKEN_COOKIE))).toBe(true);
    expect(
      DashboardPrivateUserSessionService.renewSessionWithNewRefreshToken,
    ).not.toHaveBeenCalled();
  });
});

describe("a forgotten password", () => {
  it("answers every address alike: an invited one, one nobody invited, and one invited with no password", async () => {
    const answers: Array<HttpResult> = [
      await forgotPassword(INVITED_EMAIL),
      await forgotPassword(UNKNOWN_EMAIL),
      await forgotPassword(NO_PASSWORD_EMAIL),
    ];

    for (const answer of answers) {
      expect(answer.status).toBe(200);
      expect(answer).toEqual(answers[0]);
    }
  });

  it("emails an invited private user a link to the dashboard's own address, whose token only its hash is kept of, for a day", async () => {
    await forgotPassword(INVITED_EMAIL);

    const update: { id: ObjectID; data: Record<string, unknown> } = (
      DashboardPrivateUserService.updateOneById as unknown as jest.Mock
    ).mock.calls[0]![0] as { id: ObjectID; data: Record<string, unknown> };

    expect(update.id.toString()).toBe(PRIVATE_USER_ID.toString());

    const expires: Date = update.data["resetPasswordExpires"] as Date;
    const hoursAhead: number = (expires.getTime() - Date.now()) / 3600000;

    expect(hoursAhead).toBeGreaterThan(23);
    expect(hoursAhead).toBeLessThanOrEqual(24);

    const mail: { toEmail: Email; templateType: string; vars: JSONObject } = (
      MailService.sendMail as unknown as jest.Mock
    ).mock.calls[0]![0] as {
      toEmail: Email;
      templateType: string;
      vars: JSONObject;
    };

    expect(mail.toEmail.toString()).toBe(INVITED_EMAIL);
    expect(mail.templateType).toBe(EmailTemplateType.PrivateUserForgotPassword);
    expect(mail.vars["resourceName"]).toBe("Checkout status");

    const link: string = mail.vars["tokenVerifyUrl"] as string;
    const prefix: string = `${DASHBOARD_ADDRESS}/reset-password/`;

    expect(link.startsWith(prefix)).toBe(true);

    // The link carries the token; the row keeps only its hash.
    const token: string = link.substring(prefix.length);

    expect(ObjectID.isValidUUID(token)).toBe(true);
    expect(update.data["resetPasswordToken"]).not.toBe(token);
    expect(update.data["resetPasswordToken"]).not.toContain(token);
  });

  it("sends nothing, and writes nothing, for an address nobody invited", async () => {
    await forgotPassword(UNKNOWN_EMAIL);

    expect(DashboardPrivateUserService.updateOneById).not.toHaveBeenCalled();
    expect(MailService.sendMail).not.toHaveBeenCalled();
  });

  it("counts every request per caller and per address before the address is looked up", async () => {
    const order: Array<string> = [];

    getJestSpyOn(PublicMessageRateLimit, "assertMaySend").mockImplementation(
      async (data: { kind: PublicMessageKind }): Promise<void> => {
        order.push(`counted ${data.kind}`);
      },
    );
    getJestSpyOn(DashboardPrivateUserService, "findOneBy").mockImplementation(
      async (): Promise<DashboardPrivateUser | null> => {
        order.push("looked up");
        return null;
      },
    );

    await forgotPassword(UNKNOWN_EMAIL);

    expect(order).toEqual([
      `counted ${PublicMessageKind.PrivateUserPasswordReset}`,
      "looked up",
    ]);

    const counted: { contacts: Array<unknown> } = (
      PublicMessageRateLimit.assertMaySend as unknown as jest.Mock
    ).mock.calls[0]![0] as { contacts: Array<unknown> };

    expect(counted.contacts).toEqual([
      PublicMessageRateLimit.forEmail(new Email(UNKNOWN_EMAIL)),
    ]);
  });

  it("refuses alike, invited or not, once the limit is reached, and says when to come back", async () => {
    getJestSpyOn(PublicMessageRateLimit, "assertMaySend").mockRejectedValue(
      new TooManyRequestsException(
        "Too many password resets have been asked for. Try again later.",
      ),
    );

    const invited: HttpResult = await forgotPassword(INVITED_EMAIL);
    const unknown: HttpResult = await forgotPassword(UNKNOWN_EMAIL);

    expect(invited.status).toBe(429);
    expect(unknown).toEqual(invited);
    expect(DashboardPrivateUserService.findOneBy).not.toHaveBeenCalled();
    expect(MailService.sendMail).not.toHaveBeenCalled();
  });

  it("takes no request on a dashboard that takes only single sign-on", async () => {
    stored!.requireSsoForLogin = true;

    const result: HttpResult = await forgotPassword(INVITED_EMAIL);

    expect(result.status).toBe(400);
    expect(errorMessageOf(result)).toBe(DASHBOARD_SSO_ONLY_MESSAGE);
    expect(MailService.sendMail).not.toHaveBeenCalled();
  });
});

describe("a new password from a reset link", () => {
  const reset: (token: string, password: string) => Promise<HttpResult> = (
    token: string,
    password: string,
  ): Promise<HttpResult> => {
    return send({
      path: `/reset-password/${DASHBOARD_ID.toString()}`,
      body: { data: { resetPasswordToken: token, password } },
    });
  };

  it("saves the new password of the link's private user, on this dashboard, and tells them", async () => {
    getJestSpyOn(
      DashboardPrivateUserService,
      "findByResetPasswordToken",
    ).mockResolvedValue({
      user: privateUser(INVITED_EMAIL, true),
      isExpired: false,
    });

    const result: HttpResult = await reset("a-token", PASSWORD);

    expect(result.status).toBe(200);

    const lookup: Record<string, unknown> = (
      DashboardPrivateUserService.findByResetPasswordToken as unknown as jest.Mock
    ).mock.calls[0]![0] as Record<string, unknown>;

    expect(lookup["resourceId"]?.toString()).toBe(DASHBOARD_ID.toString());

    const update: { data: Record<string, unknown> } = (
      DashboardPrivateUserService.updateOneById as unknown as jest.Mock
    ).mock.calls[0]![0] as { data: Record<string, unknown> };

    expect(update.data["password"]).toBeInstanceOf(HashedString);

    const mail: { templateType: string } = (
      MailService.sendMail as unknown as jest.Mock
    ).mock.calls[0]![0] as { templateType: string };

    expect(mail.templateType).toBe(
      EmailTemplateType.PrivateUserPasswordChanged,
    );
  });

  it("refuses a link that was used or never was, and one that ran out, saving nothing", async () => {
    getJestSpyOn(
      DashboardPrivateUserService,
      "findByResetPasswordToken",
    ).mockResolvedValue({ user: null, isExpired: false });

    const invalid: HttpResult = await reset("a-token", PASSWORD);

    expect(invalid.status).toBe(400);
    expect(errorMessageOf(invalid)).toBe(RESET_LINK_MESSAGES.invalid);

    getJestSpyOn(
      DashboardPrivateUserService,
      "findByResetPasswordToken",
    ).mockResolvedValue({
      user: privateUser(INVITED_EMAIL, true),
      isExpired: true,
    });

    const expired: HttpResult = await reset("a-token", PASSWORD);

    expect(errorMessageOf(expired)).toBe(RESET_LINK_MESSAGES.expired);
    expect(DashboardPrivateUserService.updateOneById).not.toHaveBeenCalled();
  });

  it("holds the new password to the one password rule", async () => {
    getJestSpyOn(
      DashboardPrivateUserService,
      "findByResetPasswordToken",
    ).mockResolvedValue({
      user: privateUser(INVITED_EMAIL, true),
      isExpired: false,
    });

    const result: HttpResult = await reset("a-token", "short");

    expect(result.status).toBe(400);
    expect(DashboardPrivateUserService.updateOneById).not.toHaveBeenCalled();
  });
});

describe("a single sign-on code, exchanged on the dashboard's own host", () => {
  const exchange: (loginCode: unknown) => Promise<HttpResult> = (
    loginCode: unknown,
  ): Promise<HttpResult> => {
    return send({
      path: `/exchange-login-code/${DASHBOARD_ID.toString()}`,
      body: { loginCode: loginCode as string },
    });
  };

  it("becomes a session on this host, with its cookies", async () => {
    const result: HttpResult = await exchange(
      "9dab0000-0000-4000-8000-000000000001",
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ email: INVITED_EMAIL });
    expect(setCookieOf(result, TOKEN_COOKIE)).toMatch(/; SameSite=Strict/);

    const exchanged: Array<unknown> = (
      DashboardPrivateUserSessionService.exchangeLoginCode as unknown as jest.Mock
    ).mock.calls[0]!;

    expect(exchanged[0]).toBe("9dab0000-0000-4000-8000-000000000001");
    expect(
      (exchanged[1] as Record<string, unknown>)["resourceId"]?.toString(),
    ).toBe(DASHBOARD_ID.toString());
  });

  it("answers every code that cannot be exchanged alike: not a code, spent or run out, or another dashboard's", async () => {
    const notACode: HttpResult = await exchange("not-a-code");

    getJestSpyOn(
      DashboardPrivateUserSessionService,
      "exchangeLoginCode",
    ).mockResolvedValue(null);

    const spent: HttpResult = await exchange(
      "9dab0000-0000-4000-8000-000000000002",
    );

    for (const answer of [notACode, spent]) {
      expect(answer.status).toBe(400);
      expect(errorMessageOf(answer)).toBe(
        DASHBOARD_SIGN_IN_CODE_INVALID_MESSAGE,
      );
      expect(answer.setCookie).toEqual([]);
    }
  });

  it("ends the code's session when its provider no longer vouches for it", async () => {
    getJestSpyOn(
      DashboardPrivateUserSessionService,
      "doesSignInStillCount",
    ).mockResolvedValue(false);

    const result: HttpResult = await exchange(
      "9dab0000-0000-4000-8000-000000000003",
    );

    expect(errorMessageOf(result)).toBe(DASHBOARD_SIGN_IN_CODE_INVALID_MESSAGE);
    expect(
      DashboardPrivateUserSessionService.revokeSessionById,
    ).toHaveBeenCalled();
    expect(result.setCookie).toEqual([]);
  });
});

describe("the ways in the sign-in page is told of", () => {
  const signInMethods: () => Promise<HttpResult> = (): Promise<HttpResult> => {
    return send({ path: `/sign-in-methods/${DASHBOARD_ID.toString()}` });
  };

  beforeEach(() => {
    getJestSpyOn(DashboardSsoService, "findBy").mockResolvedValue([
      Object.assign(
        new (jest.requireActual<{
          default: new () => Record<string, unknown>;
        }>("Common/Models/DatabaseModels/DashboardSso").default)(),
        {
          id: new ObjectID("aaab0000-0000-4000-8000-000000000001"),
          name: "Acme Okta",
          description: "Use your Acme account",
          // What the lookup never selects, were it there: never sent.
          signOnURL: "https://idp.example.com/sso",
          publicCertificate: "-----BEGIN CERTIFICATE-----",
        },
      ),
    ]);
    getJestSpyOn(DashboardOidcService, "findBy").mockResolvedValue([
      Object.assign(
        new (jest.requireActual<{
          default: new () => Record<string, unknown>;
        }>("Common/Models/DatabaseModels/DashboardOidc").default)(),
        {
          id: new ObjectID("aaab0000-0000-4000-8000-000000000002"),
          name: "Acme Google",
          description: "",
          clientSecret: "never-sent",
        },
      ),
    ]);
  });

  it("names each provider that is on, by its name and words alone", async () => {
    const result: HttpResult = await signInMethods();

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      isPasswordSignInAllowed: true,
      samlProviders: [
        {
          _id: "aaab0000-0000-4000-8000-000000000001",
          name: "Acme Okta",
          description: "Use your Acme account",
        },
      ],
      oidcProviders: [
        {
          _id: "aaab0000-0000-4000-8000-000000000002",
          name: "Acme Google",
          description: "",
        },
      ],
    });
    expect(JSON.stringify(result.body)).not.toContain("never-sent");
    expect(JSON.stringify(result.body)).not.toContain("BEGIN CERTIFICATE");

    // Only providers that are on, of this dashboard, selecting only what is sent.
    const lookup: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = (DashboardSsoService.findBy as unknown as jest.Mock).mock
      .calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    };

    expect(lookup.query["isEnabled"]).toBe(true);
    expect(lookup.query["dashboardId"]?.toString()).toBe(
      DASHBOARD_ID.toString(),
    );
    expect(Object.keys(lookup.select).sort()).toEqual(
      ["_id", "description", "name"].sort(),
    );
  });

  it("offers no password on a dashboard that takes only single sign-on", async () => {
    stored!.requireSsoForLogin = true;

    const result: HttpResult = await signInMethods();

    expect(result.body?.["isPasswordSignInAllowed"]).toBe(false);
  });

  it("tells nothing of a dashboard that does not ask its visitors to sign in", async () => {
    stored!.requireSignIn = false;

    const result: HttpResult = await signInMethods();

    expect(result.status).toBe(400);
    expect(errorMessageOf(result)).toBe(DASHBOARD_SIGN_IN_NOT_ASKED_MESSAGE);
    expect(DashboardSsoService.findBy).not.toHaveBeenCalled();
  });
});
