import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * SIGNING IN SAYS NOTHING ABOUT WHICH ADDRESSES HAVE AN ACCOUNT (#9745).
 *
 * POST /login refused three kinds of address, and told them apart:
 *
 *   - an address with no account: "Email or password does not match.",
 *     answered at once;
 *   - an account with no password yet - an invitation nobody has claimed,
 *     or an account a master admin made without one: "You have not signed
 *     up so far. Please go to the registration page to sign up.";
 *   - an account with a password, and a wrong one typed: "Email or password
 *     does not match.", after a scrypt derivation (tens of milliseconds).
 *
 * So the words said whether an address had an unclaimed account, and how
 * long the refusal took said whether it had any. All three are now the same
 * refusal, after the same work: one password check, or one derivation spent
 * in its place (PasswordHash.spendVerificationTime). Its person signs up
 * through their invitation, or asks Forgot password for a link (#9260).
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

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
const USER_EMAIL: string = "grace@example.com";
const USER_ID: string = "55555555-5555-4555-8555-555555555555";

/*
 * The account at the address, as Postgres holds it, or null for none. Every
 * lookup hands back only the columns it selected, as TypeORM would.
 */
let storedRow: Record<string, unknown> | null = null;

function projectOntoSelect(select: Record<string, unknown>): User | null {
  if (!storedRow) {
    return null;
  }

  const user: User = new User();

  for (const column of Object.keys(select)) {
    if (select[column] && storedRow[column] !== undefined) {
      (user as unknown as Record<string, unknown>)[column] = storedRow[column];
    }
  }

  return user;
}

const userFindOneBy: jest.Mock = jest.fn();
const verifyHashedColumnValue: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      findOneById: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      verifyHashedColumnValue: (...args: Array<unknown>): unknown => {
        return verifyHashedColumnValue(...args);
      },
      updateOneBy: jest.fn(),
      updateOneById: jest.fn(),
      updateOneByIdAndFetch: jest.fn(),
      createUserOnSignup: jest.fn(),
    },
  };
});

// Each derivation spent in place of a password check.
const spendVerificationTime: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      spendVerificationTime: (...args: Array<unknown>): unknown => {
        return spendVerificationTime(...args);
      },
    },
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
      findOneBy: (): Promise<null> => {
        return Promise.resolve(null);
      },
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

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      ...(
        jest.requireActual(
          "./SessionLengthsNotSetStandIn",
        ) as typeof import("./SessionLengthsNotSetStandIn")
      ).sessionLengthsNotSet(),
      createSession: (...args: Array<unknown>): unknown => {
        return createSession(...args);
      },
      findActiveSessionByRefreshToken: jest.fn(),
      revokeSessionById: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
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

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      setUserCookie: jest.fn(),
      removeAllCookies: jest.fn(),
      removeCookie: jest.fn(),
      getRefreshTokenFromExpressRequest: (): undefined => {
        return undefined;
      },
      getUserTokenKey: jest.fn(),
      getRefreshTokenKey: jest.fn(),
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

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      sign: (): string => {
        return "signed-token";
      },
      signUserLoginToken: (): string => {
        return "signed-user-token";
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
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const AUTHENTICATION_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "FeatureSet",
    "Identity",
    "API",
    "Authentication.ts",
  ),
  "utf8",
);

type InvokeResult = { nextError: Exception | null };

const invoke: (uri: string, body: unknown) => Promise<InvokeResult> = async (
  uri: string,
  body: unknown,
): Promise<InvokeResult> => {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body);
  const res: ExpressResponse = buildResponse();

  let nextError: Exception | null = null;

  const next: NextFunction = ((err?: Exception): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  await handler(req, res, next);

  return { nextError };
};

// Exactly what the sign-in page posts.
function credentials(password: string = PASSWORD): JSONObject {
  return {
    data: {
      email: USER_EMAIL,
      password: { _type: "HashedString", value: password },
    },
  };
}

// An account at the address: signed up (with a password), or not yet.
function storeAccount(data: { hasPassword: boolean }): void {
  storedRow = {
    _id: USER_ID,
    email: new Email(USER_EMAIL),
    name: "Grace Hopper",
    password: data.hasPassword ? "stored-hash" : null,
    passwordSalt: data.hasPassword ? "stored-salt" : null,
    isEmailVerified: true,
    isMasterAdmin: false,
    isBlocked: false,
    enableTwoFactorAuth: false,
    timezone: null,
  };
}

interface Refusal {
  status: number | undefined;
  message: string | undefined;
  name: string | undefined;
}

// The one refusal sent, as the browser reads it.
function refusal(): Refusal {
  expect(sendErrorResponse).toHaveBeenCalledTimes(1);

  const error: Exception = sendErrorResponse.mock.calls[0]![2] as Exception;

  return {
    status: (error as unknown as { code?: number }).code,
    message: error.message,
    name: error.constructor.name,
  };
}

// The password checks made: real ones, and ones spent in place of one.
function passwordWork(): { checked: number; spent: number } {
  return {
    checked: verifyHashedColumnValue.mock.calls.length,
    spent: spendVerificationTime.mock.calls.length,
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  storedRow = null;

  userFindOneBy.mockImplementation((data: { select: JSONObject }) => {
    return Promise.resolve(projectOntoSelect(data.select));
  });
  verifyHashedColumnValue.mockImplementation(
    (data: { plainValue: string }): Promise<boolean> => {
      return Promise.resolve(data.plainValue === PASSWORD);
    },
  );
  spendVerificationTime.mockResolvedValue(undefined);
  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
});

describe("POST /login - one refusal for every address", () => {
  it("an address with no account: the wrong-password refusal, after a password check's worth of work", async () => {
    await invoke("/login", credentials());

    expect(refusal().message).toBe("Email or password does not match.");
    expect(passwordWork()).toEqual({ checked: 0, spent: 1 });
    expect(spendVerificationTime).toHaveBeenCalledWith(PASSWORD);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("an account nobody has set a password on: the same refusal, after the same work (the regression)", async () => {
    storeAccount({ hasPassword: false });

    await invoke("/login", credentials());

    expect(refusal().message).toBe("Email or password does not match.");
    expect(passwordWork()).toEqual({ checked: 0, spent: 1 });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("an account with a password, and a wrong one typed: the same refusal, after one real check", async () => {
    storeAccount({ hasPassword: true });

    await invoke("/login", credentials("not the password"));

    expect(refusal().message).toBe("Email or password does not match.");
    expect(passwordWork()).toEqual({ checked: 1, spent: 0 });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("the three refusals cannot be told apart", async () => {
    const refusals: Array<Refusal> = [];

    await invoke("/login", credentials());
    refusals.push(refusal());

    sendErrorResponse.mockClear();
    storeAccount({ hasPassword: false });
    await invoke("/login", credentials());
    refusals.push(refusal());

    sendErrorResponse.mockClear();
    storeAccount({ hasPassword: true });
    await invoke("/login", credentials("not the password"));
    refusals.push(refusal());

    expect(refusals[1]).toEqual(refusals[0]);
    expect(refusals[2]).toEqual(refusals[0]);
  });

  it("the right password still signs a signed-up account in, with no work spent", async () => {
    storeAccount({ hasPassword: true });

    const result: InvokeResult = await invoke("/login", credentials());

    expect(result.nextError).toBeNull();
    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(passwordWork()).toEqual({ checked: 1, spent: 0 });
  });

  it("a second step for an address with no account is refused alike, after the same work", async () => {
    await invoke("/verify-totp-auth", {
      ...credentials(),
      code: "123456",
    });

    expect(refusal().message).toBe("Email or password does not match.");
    expect(passwordWork()).toEqual({ checked: 0, spent: 1 });
  });
});

describe("the sign-in source says nothing more", () => {
  it("never tells anyone to go and sign up", () => {
    expect(AUTHENTICATION_SOURCE).not.toContain(
      "You have not signed up so far.",
    );
    expect(AUTHENTICATION_SOURCE).not.toContain(
      "Please go to the registration page",
    );
  });
});
