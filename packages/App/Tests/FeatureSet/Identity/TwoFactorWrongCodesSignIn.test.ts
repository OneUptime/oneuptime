import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import {
  buildOtpauthUri,
  conformingAppCode,
} from "Common/Tests/Server/TestingUtils/AuthenticatorApp";
import {
  TestRedisClient,
  connectTestRedis,
} from "Common/Tests/Server/TestingUtils/Redis/TestRedisClient";
import Redis from "Common/Server/Infrastructure/Redis";
import UserService from "Common/Server/Services/UserService";
import PasswordHash from "Common/Server/Utils/PasswordHash";
import TotpAuth from "Common/Server/Utils/TotpAuth";
import User from "Common/Models/DatabaseModels/User";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import HashedString from "Common/Types/HashedString";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * Wrong second-step codes are counted for the account, wherever they come
 * from: the routes of the real router, the real sign-in limiter in front of
 * them, and a real Valkey behind both.
 *
 * It needs Valkey: CI's test-setup.sh starts one on localhost:6310. Locally,
 * a disposable one:
 *
 *   docker run -d --rm -p 16397:6379 valkey/valkey:9.1-alpine
 *   TWO_FACTOR_WRONG_CODES_TEST_REDIS_URL=redis://localhost:16397 \
 *     npx jest Tests/FeatureSet/Identity/TwoFactorWrongCodesSignIn.test.ts
 *
 * Every account, address and network here is this run's own, and the keys
 * the suite wrote are removed after each test.
 */

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
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

const totpFindBy: jest.Mock = jest.fn();
const totpFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserTotpAuthService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return totpFindBy(...args);
      },
      findOneBy: (...args: Array<unknown>): unknown => {
        return totpFindOneBy(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Array<unknown> => {
        return [];
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
        return Promise.resolve(10);
      },
      consumeCode: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
    },
  };
});

const createSession: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (...args: Array<unknown>): unknown => {
        return createSession(...args);
      },
      revokeAllSessionsByUserId: (): Promise<void> => {
        return Promise.resolve();
      },
      findActiveSessionByRefreshToken: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
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
      getRefreshTokenFromExpressRequest: jest.fn(),
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

const sendTwoFactorWrongCodesEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: jest.fn(),
      sendTwoFactorBackupCodeUsedEmail: (): Promise<void> => {
        return Promise.resolve();
      },
      sendTwoFactorWrongCodesEmail: (...args: Array<unknown>): unknown => {
        return sendTwoFactorWrongCodesEmail(...args);
      },
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
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: (...args: Array<unknown>): unknown => {
        return sendEntityResponse(...args);
      },
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

// Importing the router registers every handler, and every middleware, above.
import "../../../FeatureSet/Identity/API/Authentication";

const PASSWORD: string = "correct horse battery staple";
const TOTP_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

/*
 * This run's own networks, in the documentation ranges: random, so two runs
 * against one Valkey never count each other's attempts.
 */
const RUN_HIGH: number = 1 + Math.floor(Math.random() * 0xfffe);
const RUN_LOW: number = Math.floor(Math.random() * 0xff00);

// IPv6 network `index` of this run: a /64 of its own.
function networkAddress(index: number): string {
  return `2001:db8:${RUN_HIGH.toString(16)}:${(RUN_LOW + index).toString(16)}::1`;
}

let client: TestRedisClient;
const writtenKeyPatterns: Set<string> = new Set<string>();

type AttemptResult = {
  reachedHandler: boolean;
  errorCode: ExceptionCode | undefined;
  errorMessage: string | undefined;
  retryAfter: string | undefined;
  signedIn: boolean;
};

/*
 * One request through the WHOLE registered chain: the sign-in limiter first,
 * the handler last, from the address `clientIp`.
 */
async function attempt(data: {
  uri: string;
  email: string;
  clientIp: string;
  body: Record<string, unknown>;
}): Promise<AttemptResult> {
  const handlers: Array<RouteHandler> = mockRouter.matchAll("post", data.uri);

  const req: ExpressRequest = buildRequest(
    {
      data: {
        email: data.email,
        password: { _type: "HashedString", value: PASSWORD },
        ...data.body,
      },
    },
    {
      headers: { "x-forwarded-for": data.clientIp },
      socketAddress: data.clientIp,
    },
  );

  const headers: Record<string, string> = {};

  const res: ExpressResponse = {
    ...buildResponse(),
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as ExpressResponse;

  const errorsBefore: number = sendErrorResponse.mock.calls.length;
  const entitiesBefore: number = sendEntityResponse.mock.calls.length;

  let reachedHandler: boolean = false;

  for (let index: number = 0; index < handlers.length; index++) {
    const handler: RouteHandler = handlers[index] as RouteHandler;

    let continued: boolean = false;

    const next: NextFunction = ((err?: unknown): void => {
      if (err) {
        throw err;
      }

      continued = true;
    }) as unknown as NextFunction;

    if (index === handlers.length - 1) {
      reachedHandler = true;
    }

    await handler(req, res, next);

    if (!continued) {
      break;
    }
  }

  const errorCall: Array<unknown> | undefined =
    sendErrorResponse.mock.calls.length > errorsBefore
      ? (sendErrorResponse.mock.calls[
          sendErrorResponse.mock.calls.length - 1
        ] as Array<unknown>)
      : undefined;

  const error: Exception | undefined = errorCall?.[2] as Exception | undefined;

  return {
    reachedHandler,
    errorCode: error?.code,
    errorMessage: error?.message,
    retryAfter: headers["Retry-After"],
    signedIn: sendEntityResponse.mock.calls.length > entitiesBefore,
  };
}

type Account = {
  user: User;
  email: string;
  code: () => string;
};

let accountCounter: number = 0;

// An account with two factor authentication on and one authenticator app.
async function newAccount(): Promise<Account> {
  accountCounter++;

  const email: string = `wrong.codes.${RUN_HIGH.toString(16)}.${RUN_LOW.toString(
    16,
  )}.${accountCounter}@example.com`;

  const salt: string = PasswordHash.generateSalt();

  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.email = new Email(email);
  user.name = undefined as never;
  user.isEmailVerified = true;
  user.isMasterAdmin = false;
  user.isBlocked = false;
  user.enableTwoFactorAuth = true;
  user.passwordSalt = salt;
  user.password = new HashedString(
    await PasswordHash.hash({ plainValue: PASSWORD, salt: salt }),
    true,
  );

  const secret: string = TotpAuth.generateSecret();
  const otpUrl: string = buildOtpauthUri({
    secret: secret,
    label: email,
    algorithm: "SHA1",
  });

  const row: UserTotpAuth = new UserTotpAuth();
  row.id = TOTP_ID;
  row.twoFactorSecret = secret;
  row.twoFactorOtpUrl = otpUrl;
  row.isVerified = true;

  jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
  totpFindBy.mockResolvedValue([row] as never);
  totpFindOneBy.mockResolvedValue(row as never);

  writtenKeyPatterns.add(`identity:rl:*${email}*`);
  writtenKeyPatterns.add(`*${user.id!.toString()}*`);

  return {
    user,
    email,
    code: (): string => {
      return conformingAppCode(otpUrl);
    },
  };
}

// A six digit code the account's app is not showing.
function wrongCode(account: Account): string {
  const right: string = account.code();

  return right === "000000" ? "111111" : "000000";
}

let verifyToken: jest.SpiedFunction<typeof TotpAuth.verifyToken>;

beforeAll(async () => {
  client = await connectTestRedis(
    process.env["TWO_FACTOR_WRONG_CODES_TEST_REDIS_URL"],
  );
});

beforeEach(() => {
  jest.clearAllMocks();

  jest.mocked(Redis.getClient).mockReturnValue(client);
  jest.mocked(Redis.isConnected).mockReturnValue(true);

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  } as never);

  jest.spyOn(UserService, "updateOneById").mockResolvedValue(1 as never);

  verifyToken = jest.spyOn(TotpAuth, "verifyToken");

  sendTwoFactorWrongCodesEmail.mockResolvedValue(undefined as never);
});

afterEach(async () => {
  jest.restoreAllMocks();

  for (const pattern of writtenKeyPatterns) {
    const keys: Array<string> = await client.keys(pattern);

    if (keys.length > 0) {
      await client.del(...keys);
    }
  }

  writtenKeyPatterns.clear();

  for (let index: number = 0; index < 64; index++) {
    const keys: Array<string> = await client.keys(
      `identity:rl:*${networkAddress(index).replace("::1", "")}*`,
    );

    if (keys.length > 0) {
      await client.del(...keys);
    }
  }
});

afterAll(() => {
  client?.disconnect();
});

describe("wrong authenticator codes are counted for the account, wherever they come from", () => {
  it("a password holder sending from network after network has only the account's few codes checked", async () => {
    const account: Account = await newAccount();

    const results: Array<AttemptResult> = [];

    for (let index: number = 0; index < 40; index++) {
      results.push(
        await attempt({
          uri: "/verify-totp-auth",
          email: account.email,
          clientIp: networkAddress(index),
          body: {
            code: wrongCode(account),
            twoFactorAuthId: TOTP_ID.toString(),
          },
        }),
      );
    }

    // Every attempt got past the sign-in limiter: each network is new.
    expect(
      results.filter((result: AttemptResult): boolean => {
        return result.reachedHandler;
      }),
    ).toHaveLength(40);

    // Only five codes were checked; the rest waited, without a check.
    expect(verifyToken).toHaveBeenCalledTimes(5);
    expect(
      results.slice(5).every((result: AttemptResult): boolean => {
        return result.errorCode === ExceptionCode.TooManyRequestsException;
      }),
    ).toBe(true);
  });
});
