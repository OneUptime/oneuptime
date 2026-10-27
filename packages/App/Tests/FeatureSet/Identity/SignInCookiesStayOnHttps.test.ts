import {
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
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * EVERY COOKIE A SIGN-IN HANDS OUT OVER HTTPS IS SECURE; OVER PLAIN HTTP,
 * SIGNING IN STILL WORKS.
 *
 * A cookie without Secure goes with every request to its host, plain HTTP
 * included. The dashboard's sign-in routes set the session's access token,
 * its refresh token and the cookies the dashboards read, so after an HTTPS
 * sign-in one http:// request to the same host - typed, followed, or slipped
 * into another plain-HTTP page by someone on the network - carried the
 * session in clear text.
 *
 * Each route here runs through its real handler, with the real CookieUtil
 * deciding by the real rule (RequestTransport.isHttps): what the route sets
 * is Secure when the browser is on HTTPS, which the request says the way
 * Express says it behind OneUptime's ingress - req.secure, read from the
 * X-Forwarded-Proto the ingress forwards - or which HTTP_PROTOCOL=https says
 * for the installation's own address. A plain-HTTP installation's routes
 * set every cookie as before, so its people can still sign in.
 *
 * The database, mail and the response writer are stand-ins.
 * Common/Tests/Server/Utils/CookiesStayOnHttps.test.ts drives the rule
 * through a real Express app and real HTTP requests.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

type SignInEnv = {
  httpProtocol: string;
  host: string;
};

type SignInEnvGlobal = typeof globalThis & {
  __signInCookiesEnv: SignInEnv;
};

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

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const envGlobal: SignInEnvGlobal = globalThis as SignInEnvGlobal;

  envGlobal.__signInCookiesEnv = {
    httpProtocol: "http://",
    host: "oneuptime.example.com",
  };

  for (const [name, key] of [
    ["HttpProtocol", "httpProtocol"],
    ["Host", "host"],
  ] as Array<[string, keyof SignInEnv]>) {
    Object.defineProperty(mocked, name, {
      configurable: true,
      enumerable: true,
      get: (): unknown => {
        return envGlobal.__signInCookiesEnv[key];
      },
    });
  }

  return mocked;
});

function setEnv(overrides: Partial<SignInEnv>): void {
  const envGlobal: SignInEnvGlobal = globalThis as SignInEnvGlobal;

  envGlobal.__signInCookiesEnv = {
    ...envGlobal.__signInCookiesEnv,
    ...overrides,
  };
}

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

const INSTALLATION_HOST: string = "oneuptime.example.com";
const PASSWORD: string = "correct horse battery staple";
const USER_EMAIL: string = "fox.mulder@example.com";
const USER_ID: string = "5ecc0000-0000-4000-8000-0000000000c1";
const SESSION_ID: string = "5ecc0000-0000-4000-8000-0000000000c2";

const storedRow: Record<string, unknown> = {
  _id: USER_ID,
  email: new Email(USER_EMAIL),
  name: "Fox Mulder",
  password: "stored-hash",
  passwordSalt: "stored-salt",
  isEmailVerified: true,
  isMasterAdmin: false,
  isBlocked: false,
  enableTwoFactorAuth: false,
  timezone: "Europe/London",
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

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (data: { select: Record<string, unknown> }): unknown => {
        return Promise.resolve(projectOntoSelect(data.select));
      },
      findOneById: (data: { select: Record<string, unknown> }): unknown => {
        return Promise.resolve(projectOntoSelect(data.select));
      },
      verifyHashedColumnValue: (data: {
        plainValue: string;
      }): Promise<boolean> => {
        return Promise.resolve(data.plainValue === PASSWORD);
      },
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
      generatePasskeyAuthenticationOptions: (): Promise<unknown> => {
        return Promise.resolve({
          challengeId: "c".repeat(43),
          options: { challenge: "server-challenge" },
        });
      },
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

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (): Promise<unknown> => {
        return Promise.resolve({
          session: { id: new ObjectID(SESSION_ID) },
          refreshToken: "refresh-token",
          refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
        });
      },
      findActiveSessionByRefreshToken: (): Promise<unknown> => {
        return Promise.resolve({
          id: new ObjectID(SESSION_ID),
          userId: new ObjectID(USER_ID),
          refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
          additionalInfo: { isGlobalLogin: true },
        });
      },
      renewSessionWithNewRefreshToken: (): Promise<unknown> => {
        return Promise.resolve({
          session: { id: new ObjectID(SESSION_ID) },
          refreshToken: "rotated-refresh-token",
          refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
        });
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
            return "oneuptime.example.com";
          },
        });
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "https://";
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

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      sendEntityResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

interface WrittenCookie {
  name: string;
  value: string;
  options: JSONObject;
  cleared: boolean;
}

/*
 * How the browser reached OneUptime, as the request tells the route:
 * `secure` is req.secure, which Express reads from the X-Forwarded-Proto
 * OneUptime's ingress forwards, and `host` is the Host header it passes on.
 */
interface Transport {
  secure: boolean;
  host: string;
}

async function invoke(
  uri: string,
  transport: Transport,
  data: { body?: unknown; cookies?: Dictionary<string> } = {},
): Promise<Array<WrittenCookie>> {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const written: Array<WrittenCookie> = [];

  const req: ExpressRequest = {
    body: data.body || {},
    params: {},
    query: {},
    cookies: data.cookies || {},
    secure: transport.secure,
    headers: {
      host: transport.host,
      origin: `${transport.secure ? "https" : "http"}://${transport.host}`,
    },
    socket: { remoteAddress: "127.0.0.1" },
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    // What Express gives every response: the request it answers.
    req: req,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    cookie: jest.fn((name: string, value: string, options: JSONObject) => {
      written.push({ name, value, options, cleared: false });
    }),
    clearCookie: jest.fn((name: string, options: JSONObject) => {
      written.push({ name, value: "", options, cleared: true });
    }),
  } as unknown as ExpressResponse;

  let nextError: Exception | null = null;

  const next: NextFunction = ((err?: Exception): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  await handler(req, res, next);

  expect(nextError).toBeNull();
  expect(sendErrorResponse).not.toHaveBeenCalled();
  expect(written.length).toBeGreaterThan(0);

  return written;
}

function credentials(): JSONObject {
  return {
    data: {
      email: USER_EMAIL,
      password: { _type: "HashedString", value: PASSWORD },
    },
  };
}

function secureFlags(written: Array<WrittenCookie>): Dictionary<boolean> {
  const flags: Dictionary<boolean> = {};

  for (const cookie of written) {
    flags[`${cookie.cleared ? "clear " : ""}${cookie.name}`] =
      cookie.options["secure"] === true;
  }

  return flags;
}

function expectEvery(written: Array<WrittenCookie>, secure: boolean): void {
  const flags: Dictionary<boolean> = secureFlags(written);

  for (const name of Object.keys(flags)) {
    expect({ cookie: name, secure: flags[name] }).toEqual({
      cookie: name,
      secure,
    });
  }
}

// A sign-in's cookies: the session's two tokens and what the dashboards read.
const SESSION_COOKIES: Array<string> = [
  CookieUtil.getUserTokenKey(),
  CookieUtil.getRefreshTokenKey(),
  "user-id",
  "user-email",
  "user-name",
  "user-timezone",
];

const TLS_AT_THE_INGRESS: Transport = { secure: true, host: INSTALLATION_HOST };
const BEHIND_A_PROXY: Transport = { secure: false, host: INSTALLATION_HOST };

beforeEach(() => {
  jest.clearAllMocks();
  setEnv({ httpProtocol: "http://", host: INSTALLATION_HOST });
});

describe("POST /login with the right password", () => {
  it("over TLS, every cookie it sets is Secure - the session's tokens first", async () => {
    const written: Array<WrittenCookie> = await invoke(
      "/login",
      TLS_AT_THE_INGRESS,
      { body: credentials() },
    );

    const flags: Dictionary<boolean> = secureFlags(written);

    for (const name of SESSION_COOKIES) {
      expect({ cookie: name, secure: flags[name] }).toEqual({
        cookie: name,
        secure: true,
      });
    }

    expectEvery(written, true);
  });

  it("on an HTTPS installation behind a proxy that does not say https, still Secure", async () => {
    setEnv({ httpProtocol: "https://" });

    expectEvery(
      await invoke("/login", BEHIND_A_PROXY, { body: credentials() }),
      true,
    );
  });

  it("on a plain-HTTP installation, as before, so the browser keeps them and the person is signed in", async () => {
    const written: Array<WrittenCookie> = await invoke(
      "/login",
      BEHIND_A_PROXY,
      { body: credentials() },
    );

    expectEvery(written, false);
    expect(
      written.find((cookie: WrittenCookie) => {
        return cookie.name === CookieUtil.getUserTokenKey();
      })?.value,
    ).toBeTruthy();
  });
});

describe("POST /refresh-token, which renews the session every fifteen minutes", () => {
  const signedIn: Dictionary<string> = {
    [CookieUtil.getRefreshTokenKey()]: "refresh-token",
  };

  it("over TLS, re-sets the session Secure - so a session from before the upgrade becomes Secure at its next renewal", async () => {
    expectEvery(
      await invoke("/refresh-token", TLS_AT_THE_INGRESS, {
        cookies: signedIn,
      }),
      true,
    );
  });

  it("on an HTTPS installation behind a proxy that does not say https", async () => {
    setEnv({ httpProtocol: "https://" });

    expectEvery(
      await invoke("/refresh-token", BEHIND_A_PROXY, { cookies: signedIn }),
      true,
    );
  });

  it("on a plain-HTTP installation, as before", async () => {
    expectEvery(
      await invoke("/refresh-token", BEHIND_A_PROXY, { cookies: signedIn }),
      false,
    );
  });
});

describe("POST /logout", () => {
  const signedIn: Dictionary<string> = {
    [CookieUtil.getUserTokenKey()]: "access-token",
    [CookieUtil.getRefreshTokenKey()]: "refresh-token",
    "user-id": USER_ID,
  };

  it("over TLS, clears every cookie the browser sent with Secure, as it was set", async () => {
    const written: Array<WrittenCookie> = await invoke(
      "/logout",
      TLS_AT_THE_INGRESS,
      { cookies: signedIn },
    );

    for (const cookie of written) {
      expect(cookie.cleared).toBe(true);
    }

    expectEvery(written, true);
  });

  it("on a plain-HTTP installation, as before", async () => {
    expectEvery(
      await invoke("/logout", BEHIND_A_PROXY, { cookies: signedIn }),
      false,
    );
  });
});

describe("POST /passkey-login-options", () => {
  it("over HTTPS, the challenge cookie is Secure and stays SameSite=Strict", async () => {
    setEnv({ httpProtocol: "https://" });

    const written: Array<WrittenCookie> = await invoke(
      "/passkey-login-options",
      TLS_AT_THE_INGRESS,
    );

    expectEvery(written, true);
    expect(written[0]!.options["sameSite"]).toBe("strict");
    expect(written[0]!.options["httpOnly"]).toBe(true);
  });
});
