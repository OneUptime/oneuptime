import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import CookieUtil from "Common/Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import User from "Common/Models/DatabaseModels/User";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RequestOrigin from "Common/Types/RequestOrigin";
import { SessionEndCause } from "Common/Types/UserSession/SessionEndCause";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * WHAT THE SIGN-IN ROUTES TELL THE AUDIT LOG (issue #6762).
 *
 * The audit log records every sign-in and how each session ended; the
 * session service hands it the events (UserSessionService), and these routes
 * tell the service what only they know:
 *
 *   - POST /login: how the person signed in - a password, with no second
 *     factor for an account without one - and where from, as the request
 *     says it (RequestOriginUtil);
 *   - POST /logout: that the session ended because its person signed out,
 *     and where they signed out from;
 *   - POST /refresh-token: that a session whose refresh token ran out
 *     timed out, rather than being revoked.
 *
 * Each route runs through its real handler; the database, mail and the
 * response writer are stand-ins (the harness of
 * PasswordSignInSessionTokens.test.ts). The second factors, passkeys and
 * sign-in links are pinned in their own suites.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * The server does not require single sign-on here: every sign-in and sign-up
 * asks SsoRequiredSignIn first, which reads GlobalConfig. Driven for real in
 * SsoRequiredSignInRoutes.test.ts.
 */
jest.mock("Common/Server/Utils/SsoRequiredSignIn", () => {
  return (
    jest.requireActual(
      "./SsoNotRequiredStandIn",
    ) as typeof import("./SsoNotRequiredStandIn")
  ).ssoNotRequired();
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
const USER_EMAIL: string = "dana.scully@example.com";
const USER_ID: string = "3cde0000-0000-4000-8000-0000000000c1";
const SESSION_ID: string = "3cde0000-0000-4000-8000-0000000000c2";
const RENEWED_SESSION_ID: string = "3cde0000-0000-4000-8000-0000000000c3";

/*
 * The user row as Postgres holds it. Every lookup hands back only the
 * columns it selected, exactly as TypeORM would.
 */
const storedRow: Record<string, unknown> = {
  _id: USER_ID,
  email: new Email(USER_EMAIL),
  name: "Dana Scully",
  password: "stored-hash",
  passwordSalt: "stored-salt",
  isEmailVerified: true,
  isMasterAdmin: false,
  isBlocked: false,
  enableTwoFactorAuth: false,
  timezone: null,
};

function projectOntoSelect(select: Record<string, unknown>): User {
  const user: User = new User();

  for (const column of Object.keys(select)) {
    if (select[column] && storedRow[column] !== undefined) {
      (user as unknown as Record<string, unknown>)[column] = storedRow[column];
    }
  }

  return user;
}

const userFindOneBy: jest.Mock = jest.fn();
const userFindOneById: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      findOneById: (...args: Array<unknown>): unknown => {
        return userFindOneById(...args);
      },
      verifyHashedColumnValue: (data: {
        plainValue: string;
      }): Promise<boolean> => {
        return Promise.resolve(data.plainValue === PASSWORD);
      },
      // What readRequestSession asks of every session it reads.
      isUserBlocked: (): Promise<boolean> => {
        return Promise.resolve(false);
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
const revokeSessionById: jest.Mock = jest.fn();
const revokeSessionByRefreshToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      /*
       * No session lengths are set: every renewal goes ahead
       * (SessionLengthRefresh.test.ts drives them set).
       */
      ...(
        jest.requireActual(
          "./SessionLengthsNotSetStandIn",
        ) as typeof import("./SessionLengthsNotSetStandIn")
      ).sessionLengthsNotSet(),
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
      revokeAllSessionsByUserId: jest.fn(),
      revokeSessionByRefreshToken: (...args: Array<unknown>): unknown => {
        return revokeSessionByRefreshToken(...args);
      },
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
const sendEmptySuccessResponse: jest.Mock = jest.fn();

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
      sendEmptySuccessResponse: (...args: Array<unknown>): unknown => {
        return sendEmptySuccessResponse(...args);
      },
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

interface Outcome {
  error: Exception | null;
}

async function invoke(
  uri: string,
  body: unknown,
  cookies: Dictionary<string> = {},
  headers: Dictionary<string> = {},
): Promise<Outcome> {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body);
  (req as unknown as { cookies: Dictionary<string> }).cookies = cookies;
  (req as unknown as { headers: Dictionary<string> }).headers = {
    ...((req as unknown as { headers?: Dictionary<string> }).headers || {}),
    ...headers,
  };
  const res: ExpressResponse = buildResponse();

  let nextError: Exception | null = null;

  const next: NextFunction = ((err?: Exception): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  await handler(req, res, next);

  return { error: nextError };
}

function credentials(): JSONObject {
  return {
    data: {
      email: USER_EMAIL,
      password: { _type: "HashedString", value: PASSWORD },
    },
  };
}

const CHROME_ON_MAC: string =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

beforeEach(() => {
  jest.clearAllMocks();

  userFindOneBy.mockImplementation((data: { select: JSONObject }) => {
    return Promise.resolve(projectOntoSelect(data.select));
  });
  userFindOneById.mockImplementation((data: { select: JSONObject }) => {
    return Promise.resolve(projectOntoSelect(data.select));
  });

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

describe("POST /login with the right password", () => {
  it("tells the session it was a password, with no second factor", async () => {
    const outcome: Outcome = await invoke("/login", credentials());

    expect(outcome.error).toBeNull();
    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        userId: new ObjectID(USER_ID),
        isGlobalLogin: true,
        signIn: { method: SignInMethod.Password, secondFactor: undefined },
      }),
    );
  });

  it("and where it came from, in words OneUptime spells out - never the User-Agent itself", async () => {
    await invoke("/login", credentials(), {}, { "user-agent": CHROME_ON_MAC });

    const origin: RequestOrigin = (
      createSession.mock.calls[0]![0] as { requestOrigin: RequestOrigin }
    ).requestOrigin;

    expect(origin).toBeDefined();
    expect(origin.device).toBe("Chrome 130 on macOS");
    expect(JSON.stringify(origin)).not.toContain("Mozilla");
  });

  it("a wrong password makes no session, so nothing is recorded", async () => {
    await invoke("/login", {
      data: {
        email: USER_EMAIL,
        password: { _type: "HashedString", value: "wrong password" },
      },
    });

    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("POST /logout", () => {
  it("ends the browser's session as signed out, from where they signed out", async () => {
    await invoke(
      "/logout",
      {},
      { [CookieUtil.getRefreshTokenKey()]: "refresh-token" },
      { "user-agent": CHROME_ON_MAC },
    );

    expect(revokeSessionByRefreshToken).toHaveBeenCalledTimes(1);
    expect(revokeSessionByRefreshToken.mock.calls[0]![0]).toBe(
      "refresh-token",
    );

    const options: { cause: SessionEndCause; requestOrigin: RequestOrigin } =
      revokeSessionByRefreshToken.mock.calls[0]![1] as {
        cause: SessionEndCause;
        requestOrigin: RequestOrigin;
      };

    expect(options.cause).toBe(SessionEndCause.SignedOut);
    expect(options.requestOrigin.device).toBe("Chrome 130 on macOS");
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  it("ends the mobile app's session the same way, by the token in its body", async () => {
    await invoke("/logout", { refreshToken: "mobile-refresh-token" });

    expect(revokeSessionByRefreshToken).toHaveBeenCalledWith(
      "mobile-refresh-token",
      expect.objectContaining({ cause: SessionEndCause.SignedOut }),
    );
  });

  it("without a session there is nothing to end, and nothing recorded", async () => {
    await invoke("/logout", {});

    expect(revokeSessionByRefreshToken).not.toHaveBeenCalled();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });
});

describe("POST /refresh-token", () => {
  it("a session whose refresh token ran out timed out: it is ended as Expired", async () => {
    findActiveSessionByRefreshToken.mockResolvedValue({
      id: new ObjectID(SESSION_ID),
      userId: new ObjectID(USER_ID),
      refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAgo(1),
      additionalInfo: { isGlobalLogin: true },
    });

    await invoke(
      "/refresh-token",
      {},
      { [CookieUtil.getRefreshTokenKey()]: "refresh-token" },
    );

    expect(revokeSessionById).toHaveBeenCalledTimes(1);
    expect(revokeSessionById.mock.calls[0]![0].toString()).toBe(SESSION_ID);
    expect(revokeSessionById.mock.calls[0]![1]).toEqual({
      cause: SessionEndCause.Expired,
    });
    expect(renewSessionWithNewRefreshToken).not.toHaveBeenCalled();
  });

  it("a live session is renewed, and nothing is ended", async () => {
    await invoke(
      "/refresh-token",
      {},
      { [CookieUtil.getRefreshTokenKey()]: "refresh-token" },
    );

    expect(revokeSessionById).not.toHaveBeenCalled();
    expect(renewSessionWithNewRefreshToken).toHaveBeenCalledTimes(1);
  });
});
