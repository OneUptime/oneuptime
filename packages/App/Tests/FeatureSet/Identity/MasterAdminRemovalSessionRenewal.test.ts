import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import UserMiddleware, {
  RequestSession,
} from "Common/Server/Middleware/UserAuthorization";
import CookieUtil from "Common/Server/Utils/Cookie";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import User from "Common/Models/DatabaseModels/User";
import CookieName from "Common/Types/CookieName";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SESSION RENEWED AFTER SOMEONE'S MASTER ADMIN ACCESS WAS REMOVED IS NO
 * MASTER ADMIN'S, AND NEITHER IS THE BROWSER THAT HOLDS IT.
 *
 * Another master admin removes the access (Admin Dashboard > Users > Master
 * Admin Access). The person stays signed in: their next request is answered
 * as the member they are (UserMiddleware.readRequestSession reads their
 * account), and their session's next renewal - POST /refresh-token, at most
 * 15 minutes later - hands out an access token that no longer says master
 * admin, and takes away the flag the dashboards read to show a master
 * admin's links and settings (CookieName.IsMasterAdmin).
 *
 * Each route runs through its real handler, with the real CookieUtil and
 * JSONWebToken; only the database, mail and the response writer are
 * stand-ins. The account is one row, read the way the routes and the
 * session reader read it.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * The server does not require single sign-on here: every sign-in and sign-up
 * asks SsoRequiredSignIn first, which reads GlobalConfig. Driven for real in
 * SsoRequiredSignInRoutes.test.ts.
 */
jest.mock("Common/Server/Utils/SsoRequiredSignIn", () => {
  return jest
    .requireActual<typeof import("./SsoNotRequiredStandIn")>(
      "./SsoNotRequiredStandIn",
    )
    .ssoNotRequired();
});

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: (): MockIdentityRouter => {
        return mockRouter;
      },
    },
    getClientIp: (): string => {
      return "127.0.0.1";
    },
    extractDeviceInfo: (): Record<string, unknown> => {
      return {};
    },
    headerValueToString: (): string => {
      return "";
    },
  };
});

const PASSWORD: string = "correct horse battery staple";
const USER_EMAIL: string = "fox.mulder@example.com";
const USER_ID: string = "4dfe0000-0000-4000-8000-0000000000d1";
const SESSION_ID: string = "4dfe0000-0000-4000-8000-0000000000d2";
const RENEWED_SESSION_ID: string = "4dfe0000-0000-4000-8000-0000000000d3";

/*
 * The account as Postgres holds it. Every lookup hands back only the columns
 * it selected, as TypeORM would.
 */
const storedRow: Record<string, unknown> = {};

function resetStoredRow(isMasterAdmin: boolean): void {
  for (const key of Object.keys(storedRow)) {
    delete storedRow[key];
  }

  Object.assign(storedRow, {
    _id: USER_ID,
    email: new Email(USER_EMAIL),
    name: "Fox Mulder",
    password: "stored-hash",
    passwordSalt: "stored-salt",
    isEmailVerified: true,
    isMasterAdmin: isMasterAdmin,
    isBlocked: false,
    enableTwoFactorAuth: false,
    timezone: null,
  });
}

function projectOntoSelect(select: Record<string, unknown>): User {
  const user: User = new User();

  for (const column of Object.keys(select)) {
    if (select[column] && storedRow[column] !== undefined) {
      (user as unknown as Record<string, unknown>)[column] = storedRow[column];
    }
  }

  return user;
}

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (data: { select: Record<string, unknown> }): Promise<User> => {
        return Promise.resolve(projectOntoSelect(data.select));
      },
      findOneById: (data: {
        select: Record<string, unknown>;
      }): Promise<User> => {
        return Promise.resolve(projectOntoSelect(data.select));
      },
      verifyHashedColumnValue: (data: {
        plainValue: string;
      }): Promise<boolean> => {
        return Promise.resolve(data.plainValue === PASSWORD);
      },
      // What readRequestSession asks of every session it reads, from the account.
      isUserBlocked: (): Promise<boolean> => {
        return Promise.resolve(storedRow["isBlocked"] === true);
      },
      isUserMasterAdmin: (): Promise<boolean> => {
        return Promise.resolve(storedRow["isMasterAdmin"] === true);
      },
      updateOneByIdAndFetch: jest.fn(),
      updateOneBy: jest.fn(),
      updateOneById: jest.fn(),
      createUserOnSignup: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/UserRegistrationToken", () => {
  return {
    __esModule: true,
    default: { consumeRegistrationToken: jest.fn() },
  };
});

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn(), create: jest.fn() },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: { refreshUserAllPermissions: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserTotpAuthService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
      findOneBy: jest.fn(),
      create: jest.fn(),
      updateOneById: jest.fn(),
      deleteBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
      verifyAuthentication: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserTwoFactorBackupCodeService", () => {
  return {
    __esModule: true,
    default: {
      countUnusedForUser: (): Promise<number> => {
        return Promise.resolve(0);
      },
      consumeCode: jest.fn(),
      generateForUserIfNone: jest.fn(),
    },
  };
});

const createSession: jest.Mock = jest.fn();
const findActiveSessionByRefreshToken: jest.Mock = jest.fn();
const renewSessionWithNewRefreshToken: jest.Mock = jest.fn();
const revokeAllSessionsByUserId: jest.Mock = jest.fn();
const revokeSessionById: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (...args: Array<unknown>): unknown => {
        return createSession(...args);
      },
      findActiveSessionByRefreshToken: (...args: Array<unknown>): unknown => {
        return findActiveSessionByRefreshToken(...args);
      },
      renewSessionWithNewRefreshToken: (...args: Array<unknown>): unknown => {
        return renewSessionWithNewRefreshToken(...args);
      },
      revokeSessionById: (...args: Array<unknown>): unknown => {
        return revokeSessionById(...args);
      },
      revokeAllSessionsByUserId: (...args: Array<unknown>): unknown => {
        return revokeAllSessionsByUserId(...args);
      },
      revokeSessionByRefreshToken: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      shouldDisableSignup: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
      getHost: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "localhost";
          },
        });
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "http://";
          },
        });
      },
    },
  };
});

jest.mock("Common/Server/Utils/Captcha", () => {
  return {
    __esModule: true,
    default: {
      verifyCaptcha: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: jest.fn(),
      sendCompleteRegistrationEmail: jest.fn(),
      sendTwoFactorBackupCodeUsedEmail: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    getLogAttributesFromRequest: (): Record<string, unknown> => {
      return {};
    },
  };
});

const sendErrorResponse: jest.Mock = jest.fn();
const sendEntityResponse: jest.Mock = jest.fn();
const sendJsonObjectResponse: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      sendEntityResponse: (...args: Array<unknown>): unknown => {
        return sendEntityResponse(...args);
      },
      sendJsonObjectResponse: (...args: Array<unknown>): unknown => {
        return sendJsonObjectResponse(...args);
      },
      sendEmptySuccessResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

interface HandedOut {
  // The cookies the route set, by name.
  cookies: Dictionary<string>;
  // The cookies the route took away, by name.
  cleared: Array<string>;
  // The access token in the response body, for the mobile app.
  bodyAccessToken: string | null;
}

async function invoke(
  uri: string,
  body: unknown,
  cookies: Dictionary<string> = {},
): Promise<HandedOut> {
  sendEntityResponse.mockClear();
  sendJsonObjectResponse.mockClear();

  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body);
  (req as unknown as { cookies: Dictionary<string> }).cookies = cookies;
  const res: ExpressResponse = buildResponse();

  let nextError: Exception | null = null;

  const next: NextFunction = ((err?: Exception): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  await handler(req, res, next);

  expect(nextError).toBeNull();
  expect(sendErrorResponse).not.toHaveBeenCalled();

  const setCookies: Dictionary<string> = {};

  for (const call of (res.cookie as unknown as jest.Mock).mock.calls) {
    setCookies[call[0] as string] = call[1] as string;
  }

  const cleared: Array<string> = (
    res.clearCookie as unknown as jest.Mock
  ).mock.calls.map((call: Array<unknown>): string => {
    return call[0] as string;
  });

  let bodyAccessToken: string | null = null;

  if (sendEntityResponse.mock.calls.length > 0) {
    const options: { miscData?: JSONObject } | undefined = sendEntityResponse
      .mock.calls[0]![4] as { miscData?: JSONObject } | undefined;

    bodyAccessToken = (options?.miscData?.["accessToken"] as string) || null;
  }

  if (sendJsonObjectResponse.mock.calls.length > 0) {
    const sent: JSONObject = sendJsonObjectResponse.mock
      .calls[0]![2] as JSONObject;

    bodyAccessToken = (sent["accessToken"] as string) || null;
  }

  return { cookies: setCookies, cleared, bodyAccessToken };
}

function credentials(): JSONObject {
  return {
    data: {
      email: USER_EMAIL,
      password: { _type: "HashedString", value: PASSWORD },
    },
  };
}

// What the API makes of an access token, as every request reads it.
async function readAsSession(token: string): Promise<string> {
  const read: RequestSession = await UserMiddleware.readRequestSession({
    params: {},
    query: {},
    body: {},
    cookies: { [CookieUtil.getUserTokenKey()]: token },
    headers: {},
  } as unknown as ExpressRequest);

  if (read.kind !== "user") {
    return read.kind;
  }

  return read.session.isMasterAdmin ? "a master admin" : "a member";
}

function saysMasterAdmin(token: string): unknown {
  return JSONWebToken.decodeJsonPayload(token)["isMasterAdmin"];
}

function renew(): Promise<HandedOut> {
  return invoke(
    "/refresh-token",
    {},
    { [CookieUtil.getRefreshTokenKey()]: "refresh-token" },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStoredRow(true);

  createSession.mockResolvedValue({
    session: { id: new ObjectID(SESSION_ID) },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
  });

  findActiveSessionByRefreshToken.mockResolvedValue({
    id: new ObjectID(SESSION_ID),
    userId: new ObjectID(USER_ID),
    refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
    additionalInfo: { isGlobalLogin: true },
  });

  renewSessionWithNewRefreshToken.mockResolvedValue({
    session: { id: new ObjectID(RENEWED_SESSION_ID) },
    refreshToken: "rotated-refresh-token",
    refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
  });
});

describe("a master admin signed in", () => {
  it("is handed a master admin's session, and the flag the dashboards read", async () => {
    const { cookies, cleared } = await invoke("/login", credentials());
    const token: string = cookies[CookieUtil.getUserTokenKey()]!;

    expect(saysMasterAdmin(token)).toBe(true);
    expect(await readAsSession(token)).toBe("a master admin");
    expect(cookies[CookieName.IsMasterAdmin]).toBe("true");
    expect(cleared).not.toContain(CookieName.IsMasterAdmin);
  });

  it("keeps both through a renewal while they are one", async () => {
    const { cookies, bodyAccessToken } = await renew();

    for (const token of [
      cookies[CookieUtil.getUserTokenKey()]!,
      bodyAccessToken!,
    ]) {
      expect(saysMasterAdmin(token)).toBe(true);
      expect(await readAsSession(token)).toBe("a master admin");
    }

    expect(cookies[CookieName.IsMasterAdmin]).toBe("true");
  });
});

describe("once another master admin removed their access", () => {
  it("their session is a member's from the very next request, before any renewal", async () => {
    const { cookies } = await invoke("/login", credentials());
    const token: string = cookies[CookieUtil.getUserTokenKey()]!;

    expect(await readAsSession(token)).toBe("a master admin");

    resetStoredRow(false);

    // The token still says it; the account no longer does, and the account is asked.
    expect(saysMasterAdmin(token)).toBe(true);
    expect(await readAsSession(token)).toBe("a member");
  });

  it("the renewal hands out a session that no longer says master admin, to the browser and the app", async () => {
    resetStoredRow(false);

    const { cookies, bodyAccessToken } = await renew();

    for (const token of [
      cookies[CookieUtil.getUserTokenKey()]!,
      bodyAccessToken!,
    ]) {
      expect(saysMasterAdmin(token)).toBe(false);
      expect(await readAsSession(token)).toBe("a member");
    }
  });

  it("the renewal takes away the flag the dashboards read, so they stop showing a master admin's links", async () => {
    resetStoredRow(false);

    const { cookies, cleared } = await renew();

    expect(cookies[CookieName.IsMasterAdmin]).toBeUndefined();
    expect(cleared).toContain(CookieName.IsMasterAdmin);
  });

  // "The projects they are a member of stay as they are": nobody is signed out.
  it("ends none of their sessions, and renews the one they have", async () => {
    resetStoredRow(false);

    const { cookies } = await renew();

    expect(cookies[CookieUtil.getUserTokenKey()]).toBeDefined();
    expect(cookies[CookieUtil.getRefreshTokenKey()]).toBe(
      "rotated-refresh-token",
    );
    expect(revokeAllSessionsByUserId).not.toHaveBeenCalled();
    expect(revokeSessionById).not.toHaveBeenCalled();
  });
});

describe("someone who is not a master admin", () => {
  it("signing in takes away a flag the browser may hold from before", async () => {
    resetStoredRow(false);

    const { cookies, cleared } = await invoke("/login", credentials());

    expect(saysMasterAdmin(cookies[CookieUtil.getUserTokenKey()]!)).toBe(false);
    expect(cookies[CookieName.IsMasterAdmin]).toBeUndefined();
    expect(cleared).toContain(CookieName.IsMasterAdmin);
  });
});
