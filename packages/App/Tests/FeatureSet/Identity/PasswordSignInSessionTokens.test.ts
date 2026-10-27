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
import JSONWebToken, {
  EARLIER_RELEASE_ACCESS_TOKEN_LIFETIME_IN_SECONDS,
  PURPOSE_CLAIM,
} from "Common/Server/Utils/JsonWebToken";
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
import JsonWebTokenPurpose from "Common/Types/JsonWebTokenPurpose";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * WHAT A PASSWORD SIGN-IN AND A REFRESH HAND OUT IS A SESSION, AND STAYS ONE
 * THROUGH AN UPGRADE.
 *
 * The API takes as a session only a session's own access token
 * (JsonWebTokenPurpose.UserSession), never an SSO sign-in or a status page's
 * session. So every route that hands out an access token has to hand out
 * one that says what it is, or nobody could use what they signed in with:
 *
 *   - POST /login, the browser's cookie and the mobile app's token;
 *   - POST /refresh-token, which renews them every fifteen minutes.
 *
 * And nobody is signed out by the upgrade that made tokens say what they
 * are for: an access token the release before signed (no purpose, fifteen
 * minutes) is still the session it is, and its refresh renews it into one
 * that says so.
 *
 * Each route runs through its real handler, with the real CookieUtil and
 * JSONWebToken minting the tokens; only the database, mail and the response
 * writer are stand-ins. What the route handed out is read the way the API
 * reads every request (UserMiddleware.readRequestSession).
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
      revokeSessionById: jest.fn(),
      revokeAllSessionsByUserId: jest.fn(),
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
  // The access token in the response body, for the mobile app.
  bodyAccessToken: string | null;
}

async function invoke(
  uri: string,
  body: unknown,
  cookies: Dictionary<string> = {},
): Promise<HandedOut> {
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

  return { cookies: setCookies, bodyAccessToken };
}

function credentials(): JSONObject {
  return {
    data: {
      email: USER_EMAIL,
      password: { _type: "HashedString", value: PASSWORD },
    },
  };
}

// A request that carries `token` where the API reads a session.
function requestCarrying(
  token: string,
  carrier: "cookie" | "bearer",
): ExpressRequest {
  return {
    params: {},
    query: {},
    body: {},
    cookies:
      carrier === "cookie" ? { [CookieUtil.getUserTokenKey()]: token } : {},
    headers: carrier === "bearer" ? { authorization: `Bearer ${token}` } : {},
  } as unknown as ExpressRequest;
}

// What the API makes of `token`, sent as the access-token cookie and as a bearer token.
async function readAsSession(token: string): Promise<Array<string>> {
  const kinds: Array<string> = [];

  for (const carrier of ["cookie", "bearer"] as const) {
    const read: RequestSession = await UserMiddleware.readRequestSession(
      requestCarrying(token, carrier),
    );

    kinds.push(
      read.kind === "user"
        ? `user ${read.session.userId.toString()} in session ${read.session.sessionId?.toString()}`
        : read.kind,
    );
  }

  return kinds;
}

function theSession(sessionId: string): Array<string> {
  const read: string = `user ${USER_ID} in session ${sessionId}`;
  return [read, read];
}

// The access token the release before signed: every claim it held, and no purpose.
function earlierReleaseAccessToken(): string {
  return JSONWebToken.signJsonPayload(
    {
      userId: USER_ID,
      email: USER_EMAIL,
      name: "Dana Scully",
      timezone: null,
      isMasterAdmin: false,
      isGlobalLogin: true,
      sessionId: SESSION_ID,
      projectId: "",
    },
    EARLIER_RELEASE_ACCESS_TOKEN_LIFETIME_IN_SECONDS,
  );
}

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
  it("sets an access-token cookie that says it is a session, of the session it made", async () => {
    const { cookies } = await invoke("/login", credentials());
    const token: string | undefined = cookies[CookieUtil.getUserTokenKey()];

    expect(token).toBeDefined();
    expect(JSONWebToken.decodeJsonPayload(token!)).toEqual(
      expect.objectContaining({
        [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSession,
        userId: USER_ID,
        sessionId: SESSION_ID,
      }),
    );
    expect(await readAsSession(token!)).toEqual(theSession(SESSION_ID));
  });

  it("hands the mobile app an access token the API takes as the same session", async () => {
    const { bodyAccessToken } = await invoke("/login", credentials());

    expect(bodyAccessToken).not.toBeNull();
    expect(
      JSONWebToken.decodeJsonPayload(bodyAccessToken!)[PURPOSE_CLAIM],
    ).toBe(JsonWebTokenPurpose.UserSession);
    expect(await readAsSession(bodyAccessToken!)).toEqual(
      theSession(SESSION_ID),
    );
  });

  it("hands out nothing that lasts longer than fifteen minutes as a session", async () => {
    const { cookies, bodyAccessToken } = await invoke("/login", credentials());

    for (const token of [
      cookies[CookieUtil.getUserTokenKey()]!,
      bodyAccessToken!,
    ]) {
      const claims: JSONObject = JSONWebToken.decodeJsonPayload(token);

      expect((claims["exp"] as number) - (claims["iat"] as number)).toBe(
        15 * 60,
      );
    }
  });
});

describe("POST /refresh-token", () => {
  it("renews the browser's session into an access token that says it is one", async () => {
    const { cookies } = await invoke(
      "/refresh-token",
      {},
      { [CookieUtil.getRefreshTokenKey()]: "refresh-token" },
    );
    const token: string | undefined = cookies[CookieUtil.getUserTokenKey()];

    expect(token).toBeDefined();
    expect(JSONWebToken.decodeJsonPayload(token!)[PURPOSE_CLAIM]).toBe(
      JsonWebTokenPurpose.UserSession,
    );
    expect(await readAsSession(token!)).toEqual(theSession(RENEWED_SESSION_ID));
  });

  it("renews the mobile app's session the same way", async () => {
    const { bodyAccessToken } = await invoke("/refresh-token", {
      refreshToken: "refresh-token",
    });

    expect(bodyAccessToken).not.toBeNull();
    expect(
      JSONWebToken.decodeJsonPayload(bodyAccessToken!)[PURPOSE_CLAIM],
    ).toBe(JsonWebTokenPurpose.UserSession);
    expect(await readAsSession(bodyAccessToken!)).toEqual(
      theSession(RENEWED_SESSION_ID),
    );
  });
});

/*
 * The upgrade that made tokens say what they are for signs nobody out. A
 * browser or phone still holds an access token the release before signed,
 * and while the upgrade rolls out a server of that release can sign one
 * more on a refresh.
 */
describe("an access token the release before signed", () => {
  it("is still the session it is, sent as the access-token cookie or a bearer token", async () => {
    expect(await readAsSession(earlierReleaseAccessToken())).toEqual(
      theSession(SESSION_ID),
    );
  });

  it("is renewed by its refresh token into one that says it is a session", async () => {
    const { cookies, bodyAccessToken } = await invoke(
      "/refresh-token",
      {},
      {
        [CookieUtil.getUserTokenKey()]: earlierReleaseAccessToken(),
        [CookieUtil.getRefreshTokenKey()]: "refresh-token",
      },
    );

    for (const token of [
      cookies[CookieUtil.getUserTokenKey()]!,
      bodyAccessToken!,
    ]) {
      expect(JSONWebToken.decodeJsonPayload(token)[PURPOSE_CLAIM]).toBe(
        JsonWebTokenPurpose.UserSession,
      );
      expect(await readAsSession(token)).toEqual(
        theSession(RENEWED_SESSION_ID),
      );
    }
  });
});

/*
 * And the other way round: whatever else a sign-in leaves in the browser is
 * no way to be that person without the session.
 */
describe("what a sign-in leaves that is no session", () => {
  it("an SSO sign-in of the same person is refused where a session is read", async () => {
    const user: User = new User();
    user.id = new ObjectID(USER_ID);
    user.email = new Email(USER_EMAIL);
    user.name = new Name("Dana Scully");

    const ssoSignIns: Array<string> = [
      CookieUtil.getSSOToken({
        user: user,
        projectId: ObjectID.generate(),
        ssoProviderId: ObjectID.generate(),
        ssoProviderType: SsoProviderType.ProjectSSO,
      }),
      CookieUtil.getGlobalSSOToken({
        user: user,
        ssoProviderId: ObjectID.generate(),
        ssoProviderType: SsoProviderType.GlobalOIDC,
      }),
    ];

    for (const token of ssoSignIns) {
      expect(await readAsSession(token)).toEqual(["invalid", "invalid"]);
    }
  });
});
