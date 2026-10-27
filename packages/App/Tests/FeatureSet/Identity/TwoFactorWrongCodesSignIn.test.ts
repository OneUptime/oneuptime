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
import { IDENTITY_COUNTER_UNAVAILABLE_MESSAGE } from "Common/Server/Middleware/IdentityRateLimit";
import UserService from "Common/Server/Services/UserService";
import PasswordHash from "Common/Server/Utils/PasswordHash";
import TotpAuth from "Common/Server/Utils/TotpAuth";
import PublicMessageRateLimit, {
  PublicMessageKind,
} from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import TwoFactorWrongCodes, {
  TwoFactorCodeKind,
} from "Common/Server/Utils/TwoFactorWrongCodes";
import User from "Common/Models/DatabaseModels/User";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import BadDataException from "Common/Types/Exception/BadDataException";
import UUIDColumnFilter from "Common/Server/Types/Database/UUIDColumnFilter";
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
 * Wrong second-step codes are counted for the ACCOUNT, wherever they come
 * from - through the routes of the real router, with the real sign-in limiter
 * in front of them and a real Valkey behind both.
 *
 * The sign-in limiter (IdentityRateLimit) counts per client; this count
 * holds the account. Pinned here, on /verify-totp-auth and
 * /verify-backup-code (the routes the dashboard, the mobile app and the MCP
 * sign-in all use):
 *
 *   - five wrong codes in a row are checked, from however many networks;
 *     then each next code waits (a minute, doubling, up to an hour) and is
 *     not checked at all while it waits, even when it is right;
 *   - only somebody with the password moves the count, or learns of it;
 *   - a sign-in that passes its second step forgets the wrong codes, and a
 *     security key, which nobody can guess, is never held;
 *   - backup codes have a count of their own, so wrong authenticator codes
 *     never close the way back in;
 *   - the owner is emailed once the waits begin, once a day at most;
 *   - with no count there is no check.
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
      updateOneById: (): Promise<void> => {
        return Promise.resolve();
      },
      deleteBy: (): Promise<number> => {
        return Promise.resolve(0);
      },
    },
  };
});

const webAuthnFindBy: jest.Mock = jest.fn();
const verifyWebAuthn: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return webAuthnFindBy(...args);
      },
      verifyAuthentication: (...args: Array<unknown>): unknown => {
        return verifyWebAuthn(...args);
      },
    },
  };
});

const consumeBackupCode: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserTwoFactorBackupCodeService", () => {
  return {
    __esModule: true,
    default: {
      countUnusedForUser: (): Promise<number> => {
        return Promise.resolve(10);
      },
      consumeCode: (...args: Array<unknown>): unknown => {
        return consumeBackupCode(...args);
      },
      generateForUserIfNone: (): Promise<null> => {
        return Promise.resolve(null);
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
      sendVerificationEmail: (): Promise<void> => {
        return Promise.resolve();
      },
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

const INVALID_LOGIN_MESSAGE: string =
  "Invalid login: Email or password does not match.";

/*
 * This run's own networks, in the documentation ranges: random, so two runs
 * against one Valkey never count each other's attempts.
 */
const RUN_HIGH: number = 1 + Math.floor(Math.random() * 0xfffe);
const RUN_LOW: number = Math.floor(Math.random() * 0xf000);
const RUN_PREFIX: string = `2001:db8:${RUN_HIGH.toString(16)}:`;

let networkCounter: number = 0;

// A network nobody in this run has sent from yet: an IPv6 /64 of its own.
function newNetwork(): string {
  networkCounter++;

  return `${RUN_PREFIX}${(RUN_LOW + networkCounter).toString(16)}::1`;
}

let client: TestRedisClient;
const writtenUsers: Array<ObjectID> = [];
const writtenEmails: Array<string> = [];

// The clock the limiter and the count read: moved by the tests.
let now: number = 0;

function waitSeconds(seconds: number): void {
  now += seconds * 1000;
}

type AttemptResult = {
  reachedHandler: boolean;
  errorCode: ExceptionCode | undefined;
  errorMessage: string | undefined;
  retryAfter: string | undefined;
  signedIn: boolean;
  nextError: unknown;
};

/*
 * One request through the WHOLE registered chain: the sign-in limiter first,
 * the handler last, from the address `clientIp` (a new network unless one is
 * named).
 */
async function attempt(data: {
  uri: string;
  account: Account;
  clientIp?: string | undefined;
  password?: string | undefined;
  body: Record<string, unknown>;
}): Promise<AttemptResult> {
  const handlers: Array<RouteHandler> = mockRouter.matchAll("post", data.uri);
  const clientIp: string = data.clientIp || newNetwork();

  const req: ExpressRequest = buildRequest(
    {
      data: {
        // The dashboard's second steps send the address as a bare string.
        email: data.account.email,
        password: {
          _type: "HashedString",
          value: data.password === undefined ? PASSWORD : data.password,
        },
        ...data.body,
      },
    },
    {
      headers: { "x-forwarded-for": clientIp },
      socketAddress: clientIp,
    },
  );

  const headers: Record<string, string> = {};

  const res: ExpressResponse = {
    ...buildResponse(),
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as ExpressResponse;

  let reachedHandler: boolean = false;

  // What the chain handed to next(): an error, or that it went on.
  const passed: { nextError: unknown; continued: boolean } = {
    nextError: undefined,
    continued: false,
  };

  const next: NextFunction = ((err?: unknown): void => {
    if (err) {
      passed.nextError = err;
      return;
    }

    passed.continued = true;
  }) as unknown as NextFunction;

  for (let index: number = 0; index < handlers.length; index++) {
    const handler: RouteHandler = handlers[index] as RouteHandler;

    passed.continued = false;

    if (index === handlers.length - 1) {
      reachedHandler = true;
    }

    await handler(req, res, next);

    if (!passed.continued) {
      break;
    }
  }

  /*
   * This attempt's own answers, found by the response object they were
   * written to: attempts sent at the same moment answer in any order, so
   * "the last answer written" may be another attempt's.
   */
  const isThisAttempt: (call: Array<unknown>) => boolean = (
    call: Array<unknown>,
  ): boolean => {
    return call[1] === res;
  };

  const errorCall: Array<unknown> | undefined = (
    sendErrorResponse.mock.calls as Array<Array<unknown>>
  )
    .filter(isThisAttempt)
    .pop();

  const error: Exception | undefined = errorCall?.[2] as Exception | undefined;

  return {
    reachedHandler,
    errorCode: error?.code,
    errorMessage: error?.message,
    retryAfter: headers["Retry-After"],
    signedIn: (sendEntityResponse.mock.calls as Array<Array<unknown>>).some(
      isThisAttempt,
    ),
    nextError: passed.nextError,
  };
}

type Account = {
  user: User;
  email: string;
  // The account's one authenticator app.
  totp: UserTotpAuth;
  code: () => string;
  wrongCode: () => string;
};

let accountCounter: number = 0;

/*
 * An account with two factor authentication on and one authenticator app,
 * the only account the user lookup finds while the test runs.
 */
async function newAccount(options?: {
  isBlocked?: boolean | undefined;
  isEmailVerified?: boolean | undefined;
}): Promise<Account> {
  accountCounter++;

  const email: string = `wrong.codes.${RUN_HIGH.toString(16)}.${RUN_LOW.toString(
    16,
  )}.${accountCounter}@example.com`;

  const salt: string = PasswordHash.generateSalt();

  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.email = new Email(email);
  user.isEmailVerified = options?.isEmailVerified ?? true;
  user.isMasterAdmin = false;
  user.isBlocked = options?.isBlocked ?? false;
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

  writtenUsers.push(user.id!);
  writtenEmails.push(email);

  const code: () => string = (): string => {
    return conformingAppCode(otpUrl);
  };

  return {
    user,
    email,
    totp: row,
    code,
    wrongCode: (): string => {
      // A six digit code the account's app is not showing.
      return code() === "000000" ? "111111" : "000000";
    },
  };
}

function enterCode(
  account: Account,
  code: string,
  extra?: { clientIp?: string; password?: string },
): Promise<AttemptResult> {
  return attempt({
    uri: "/verify-totp-auth",
    account,
    clientIp: extra?.clientIp,
    password: extra?.password,
    body: { code: code, twoFactorAuthId: TOTP_ID.toString() },
  });
}

function enterBackupCode(
  account: Account,
  backupCode: string,
): Promise<AttemptResult> {
  return attempt({
    uri: "/verify-backup-code",
    account,
    body: { backupCode: backupCode },
  });
}

function useSecurityKey(account: Account): Promise<AttemptResult> {
  return attempt({
    uri: "/verify-webauthn-auth",
    account,
    body: { credential: { id: "credential-id", response: {} } },
  });
}

// Five wrong codes in a row, each from a new network: the waits begin.
async function fiveWrongCodes(account: Account): Promise<void> {
  for (let index: number = 0; index < 5; index++) {
    const result: AttemptResult = await enterCode(account, account.wrongCode());

    expect(result.errorMessage).toBe("Invalid code.");
  }
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

  /*
   * The middle of a quarter hour, so no test straddles a window of the
   * sign-in limiter by accident; the TOTP codes read the real clock.
   */
  now = Date.UTC(2026, 9, 18, 12, 7, 30);
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  } as never);

  jest.spyOn(UserService, "updateOneById").mockResolvedValue(1 as never);

  webAuthnFindBy.mockResolvedValue([] as never);
  verifyWebAuthn.mockResolvedValue(undefined as never);
  consumeBackupCode.mockResolvedValue(false as never);
  sendTwoFactorWrongCodesEmail.mockResolvedValue(undefined as never);

  verifyToken = jest.spyOn(TotpAuth, "verifyToken");
});

afterEach(async () => {
  jest.restoreAllMocks();

  const patterns: Array<string> = [
    `identity:rl:*${RUN_PREFIX}*`,
    `pubmsg:rl:*${RUN_PREFIX}*`,
  ];

  for (const email of writtenEmails) {
    patterns.push(`identity:rl:*${email}*`);
    // The verification links an address not verified yet is sent, by its hash.
    patterns.push(
      `pubmsg:rl:*:k:${PublicMessageRateLimit.getContactKey(
        PublicMessageRateLimit.forEmail(email),
      )}:*`,
    );
  }

  for (const userId of writtenUsers) {
    patterns.push(`identity:two-factor-wrong-codes:*${userId.toString()}*`);
  }

  for (const pattern of patterns) {
    const keys: Array<string> = await client.keys(pattern);

    if (keys.length > 0) {
      await client.del(...keys);
    }
  }

  writtenUsers.length = 0;
  writtenEmails.length = 0;
});

afterAll(() => {
  client?.disconnect();
});

describe("wrong authenticator codes are counted for the account, wherever they come from", () => {
  it("codes entered from network after network: five are checked for the account, and no more", async () => {
    const account: Account = await newAccount();

    const results: Array<AttemptResult> = [];

    for (let index: number = 0; index < 40; index++) {
      results.push(await enterCode(account, account.wrongCode()));
    }

    // Every attempt got past the sign-in limiter: each network is new.
    expect(
      results.filter((result: AttemptResult): boolean => {
        return result.reachedHandler;
      }),
    ).toHaveLength(40);

    expect(verifyToken).toHaveBeenCalledTimes(5);
    expect(
      results.slice(0, 5).map((result: AttemptResult) => {
        return result.errorMessage;
      }),
    ).toEqual(Array(5).fill("Invalid code."));
    expect(
      results.slice(5).every((result: AttemptResult): boolean => {
        return result.errorCode === ExceptionCode.TooManyRequestsException;
      }),
    ).toBe(true);
  });

  it("inside one network's own allowance the account still has only five codes checked", async () => {
    const account: Account = await newAccount();
    const network: string = newNetwork();

    const results: Array<AttemptResult> = [];

    // The sign-in limiter lets ten through for one account from one address.
    for (let index: number = 0; index < 10; index++) {
      results.push(
        await enterCode(account, account.wrongCode(), { clientIp: network }),
      );
    }

    expect(verifyToken).toHaveBeenCalledTimes(5);
    expect(
      results.slice(5).map((result: AttemptResult) => {
        return [result.reachedHandler, result.errorCode];
      }),
    ).toEqual(Array(5).fill([true, ExceptionCode.TooManyRequestsException]));
  });

  it("codes sent at the same moment from many networks: five are checked, never more", async () => {
    const account: Account = await newAccount();

    const results: Array<AttemptResult> = await Promise.all(
      Array.from({ length: 30 }, (): Promise<AttemptResult> => {
        return enterCode(account, account.wrongCode());
      }),
    );

    expect(verifyToken).toHaveBeenCalledTimes(5);
    expect(
      results.filter((result: AttemptResult): boolean => {
        return result.errorCode === ExceptionCode.TooManyRequestsException;
      }),
    ).toHaveLength(25);
  });

  it("the sixth code waits: it is refused with how long, in words and in Retry-After, and not checked - not even the right one", async () => {
    const account: Account = await newAccount();

    await fiveWrongCodes(account);
    verifyToken.mockClear();

    const result: AttemptResult = await enterCode(account, account.code());

    expect(result.errorCode).toBe(ExceptionCode.TooManyRequestsException);
    expect(result.errorMessage).toBe(
      TwoFactorWrongCodes.getWaitingMessage(
        TwoFactorCodeKind.AuthenticatorCode,
        60,
      ),
    );
    expect(result.errorMessage).toContain("Please wait 1 minute");
    expect(result.retryAfter).toBe("60");
    expect(result.signedIn).toBe(false);
    expect(verifyToken).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("asking again during the wait does not make it longer", async () => {
    const account: Account = await newAccount();

    await fiveWrongCodes(account);

    for (let second: number = 1; second <= 50; second++) {
      waitSeconds(1);

      const result: AttemptResult = await enterCode(
        account,
        account.wrongCode(),
      );

      expect(result.retryAfter).toBe(String(60 - second));
    }

    waitSeconds(10);

    expect((await enterCode(account, account.code())).signedIn).toBe(true);
  });

  it("once the wait is over the next code is checked, and the right one signs in", async () => {
    const account: Account = await newAccount();

    await fiveWrongCodes(account);
    waitSeconds(60);

    const result: AttemptResult = await enterCode(account, account.code());

    expect(result.signedIn).toBe(true);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("each further wrong code doubles the wait, up to an hour", async () => {
    const account: Account = await newAccount();

    await fiveWrongCodes(account);

    const waits: Array<string | undefined> = [];

    for (let index: number = 0; index < 9; index++) {
      const refused: AttemptResult = await enterCode(
        account,
        account.wrongCode(),
      );

      waits.push(refused.retryAfter);
      waitSeconds(Number(refused.retryAfter));

      expect((await enterCode(account, account.wrongCode())).errorMessage).toBe(
        "Invalid code.",
      );
    }

    expect(waits).toEqual([
      "60",
      "120",
      "240",
      "480",
      "960",
      "1920",
      "3600",
      "3600",
      "3600",
    ]);
  });

  it("an unknown authenticator id is a wrong code too", async () => {
    const account: Account = await newAccount();

    for (let index: number = 0; index < 5; index++) {
      totpFindOneBy.mockResolvedValueOnce(null as never);

      expect(
        (
          await attempt({
            uri: "/verify-totp-auth",
            account,
            body: {
              code: account.code(),
              twoFactorAuthId: ObjectID.generate().toString(),
            },
          })
        ).errorMessage,
      ).toBe("Invalid two factor auth id.");
    }

    expect((await enterCode(account, account.code())).errorCode).toBe(
      ExceptionCode.TooManyRequestsException,
    );
  });
});

describe("only somebody with the password moves the count, or learns of it", () => {
  it("wrong passwords never make the owner wait", async () => {
    const account: Account = await newAccount();

    for (let index: number = 0; index < 30; index++) {
      const result: AttemptResult = await enterCode(
        account,
        account.wrongCode(),
        { password: "not the password" },
      );

      expect(result.errorMessage).toBe(INVALID_LOGIN_MESSAGE);
    }

    expect(verifyToken).not.toHaveBeenCalled();
    expect(
      await client.exists(
        TwoFactorWrongCodes.getKey(
          TwoFactorCodeKind.AuthenticatorCode,
          account.user.id!,
        ),
      ),
    ).toBe(0);

    expect((await enterCode(account, account.code())).signedIn).toBe(true);
  });

  it("a caller without the password is told nothing about a wait", async () => {
    const account: Account = await newAccount();

    await fiveWrongCodes(account);

    const result: AttemptResult = await enterCode(account, account.code(), {
      password: "not the password",
    });

    expect(result.errorCode).toBe(ExceptionCode.BadDataException);
    expect(result.errorMessage).toBe(INVALID_LOGIN_MESSAGE);
    expect(result.retryAfter).toBeUndefined();
  });

  it("nor is anybody wrong codes are entered for, without the password: no email", async () => {
    const account: Account = await newAccount();

    for (let index: number = 0; index < 12; index++) {
      await enterCode(account, account.wrongCode(), {
        password: "not the password",
      });
    }

    expect(sendTwoFactorWrongCodesEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["a blocked account", { isBlocked: true }, ExceptionMessages.UserBlocked],
    [
      "an account whose address is not verified",
      { isEmailVerified: false },
      "Email is not verified. We have sent you an email with the verification link. Please do not forget to check spam.",
    ],
  ])(
    "%s is refused before the count, which stays untouched",
    async (
      _name: string,
      options: Record<string, boolean>,
      message: string,
    ) => {
      const account: Account = await newAccount(options);

      /*
       * An address not verified yet is mailed a fresh link by each of
       * these, up to the hour's limit on that address's sign-up emails
       * (PublicMessageRateLimit); then the sign-in is refused for that.
       */
      const answeredBeforeTheLinkLimit: number =
        options["isEmailVerified"] === false
          ? PublicMessageRateLimit.getConfig().kinds[
              PublicMessageKind.SignUpEmail
            ].perContactLimit
          : 8;

      for (let index: number = 0; index < 8; index++) {
        const result: AttemptResult = await enterCode(
          account,
          account.wrongCode(),
        );

        if (index < answeredBeforeTheLinkLimit) {
          expect(result.errorMessage).toBe(message);
          continue;
        }

        expect((result.nextError as Exception | undefined)?.code).toBe(
          ExceptionCode.TooManyRequestsException,
        );
        expect(result.retryAfter).toMatch(/^[1-9][0-9]*$/);
      }

      expect(
        await client.exists(
          TwoFactorWrongCodes.getKey(
            TwoFactorCodeKind.AuthenticatorCode,
            account.user.id!,
          ),
        ),
      ).toBe(0);
    },
  );
});

describe("a sign-in that passes its second step forgets the wrong codes", () => {
  it("wrong codes are counted in a row: four, a right one, then four more cost nothing", async () => {
    const account: Account = await newAccount();

    for (let round: number = 0; round < 3; round++) {
      for (let index: number = 0; index < 4; index++) {
        expect(
          (await enterCode(account, account.wrongCode())).errorMessage,
        ).toBe("Invalid code.");
      }

      expect((await enterCode(account, account.code())).signedIn).toBe(true);
    }

    expect(
      await client.exists(
        TwoFactorWrongCodes.getKey(
          TwoFactorCodeKind.AuthenticatorCode,
          account.user.id!,
        ),
      ),
    ).toBe(0);
  });

  it("a security key is never held: it signs in during a wait, and the wait is over", async () => {
    const account: Account = await newAccount();

    await fiveWrongCodes(account);

    expect((await enterCode(account, account.code())).errorCode).toBe(
      ExceptionCode.TooManyRequestsException,
    );

    expect((await useSecurityKey(account)).signedIn).toBe(true);
    expect(verifyWebAuthn).toHaveBeenCalledTimes(1);

    expect((await enterCode(account, account.wrongCode())).errorMessage).toBe(
      "Invalid code.",
    );
  });

  it("a backup code signs in during a wait for authenticator codes, and ends it", async () => {
    const account: Account = await newAccount();

    await fiveWrongCodes(account);
    consumeBackupCode.mockResolvedValueOnce(true as never);

    expect((await enterBackupCode(account, "abcde-fghij")).signedIn).toBe(true);

    expect((await enterCode(account, account.code())).signedIn).toBe(true);
  });
});

describe("backup codes: a count of their own", () => {
  it("wrong authenticator codes never make the way back in wait", async () => {
    const account: Account = await newAccount();

    await fiveWrongCodes(account);

    const result: AttemptResult = await enterBackupCode(account, "abcde-fghij");

    expect(result.errorMessage).toBe("Invalid backup code.");
    expect(consumeBackupCode).toHaveBeenCalledTimes(1);
  });

  it("five wrong backup codes, then the next waits and is not checked; authenticator codes are still checked", async () => {
    const account: Account = await newAccount();

    for (let index: number = 0; index < 5; index++) {
      expect((await enterBackupCode(account, "abcde-fghij")).errorMessage).toBe(
        "Invalid backup code.",
      );
    }

    consumeBackupCode.mockClear();

    const refused: AttemptResult = await enterBackupCode(
      account,
      "abcde-fghij",
    );

    expect(refused.errorCode).toBe(ExceptionCode.TooManyRequestsException);
    expect(refused.errorMessage).toBe(
      TwoFactorWrongCodes.getWaitingMessage(TwoFactorCodeKind.BackupCode, 60),
    );
    expect(refused.retryAfter).toBe("60");
    expect(consumeBackupCode).not.toHaveBeenCalled();

    expect((await enterCode(account, account.code())).signedIn).toBe(true);
  });

  it("a missing backup code is a typo, not a wrong code", async () => {
    const account: Account = await newAccount();

    for (let index: number = 0; index < 8; index++) {
      const result: AttemptResult = await attempt({
        uri: "/verify-backup-code",
        account,
        body: {},
      });

      expect(String((result.nextError as Error)?.message)).toContain(
        "Backup code",
      );
    }

    expect(
      await client.exists(
        TwoFactorWrongCodes.getKey(
          TwoFactorCodeKind.BackupCode,
          account.user.id!,
        ),
      ),
    ).toBe(0);
  });
});

describe("what is not counted", () => {
  it("a security key that fails is not a wrong code: nothing can be guessed there", async () => {
    const account: Account = await newAccount();

    verifyWebAuthn.mockRejectedValue(new Error("Verification failed") as never);

    for (let index: number = 0; index < 10; index++) {
      expect((await useSecurityKey(account)).signedIn).toBe(false);
    }

    expect(
      await client.keys(
        `identity:two-factor-wrong-codes:*${account.user.id!.toString()}*`,
      ),
    ).toEqual([]);
    expect((await enterCode(account, account.code())).signedIn).toBe(true);
  });

  it("a first enrolment's code is not counted: it is read off the QR code this very password holder was shown", async () => {
    const account: Account = await newAccount();

    // No verified factor yet: the account is being enrolled.
    totpFindBy.mockResolvedValue([] as never);

    const pending: UserTotpAuth = new UserTotpAuth();
    pending.id = TOTP_ID;
    pending.twoFactorSecret = TotpAuth.generateSecret();
    pending.isVerified = false;
    totpFindOneBy.mockResolvedValue(pending as never);

    for (let index: number = 0; index < 8; index++) {
      const result: AttemptResult = await attempt({
        uri: "/verify-totp-enrolment",
        account,
        body: { code: "000000", twoFactorAuthId: TOTP_ID.toString() },
      });

      expect([
        "Invalid code.",
        // The one code in a million that is right.
        undefined,
      ]).toContain(result.errorMessage);
    }

    expect(
      await client.keys(
        `identity:two-factor-wrong-codes:*${account.user.id!.toString()}*`,
      ),
    ).toEqual([]);
  });
});

describe("the owner is told", () => {
  it("when the waits begin, at the fifth wrong code, and not before", async () => {
    const account: Account = await newAccount();

    for (let index: number = 0; index < 4; index++) {
      await enterCode(account, account.wrongCode());
    }

    expect(sendTwoFactorWrongCodesEmail).not.toHaveBeenCalled();

    await enterCode(account, account.wrongCode());

    expect(sendTwoFactorWrongCodesEmail).toHaveBeenCalledTimes(1);
    expect(sendTwoFactorWrongCodesEmail).toHaveBeenCalledWith({
      user: account.user,
      wrongCodesInARow: 5,
    });
  });

  it("once a day, however many codes follow, of either kind", async () => {
    const account: Account = await newAccount();

    await fiveWrongCodes(account);

    for (let index: number = 0; index < 6; index++) {
      const refused: AttemptResult = await enterCode(
        account,
        account.wrongCode(),
      );

      waitSeconds(Number(refused.retryAfter));
      await enterCode(account, account.wrongCode());
    }

    for (let index: number = 0; index < 6; index++) {
      await enterBackupCode(account, "abcde-fghij");
    }

    expect(sendTwoFactorWrongCodesEmail).toHaveBeenCalledTimes(1);
  });

  it("a mail that fails changes nothing about the answer", async () => {
    const account: Account = await newAccount();

    sendTwoFactorWrongCodesEmail.mockRejectedValue(
      new Error("SMTP unreachable") as never,
    );

    for (let index: number = 0; index < 4; index++) {
      await enterCode(account, account.wrongCode());
    }

    const fifth: AttemptResult = await enterCode(account, account.wrongCode());

    expect(fifth.errorMessage).toBe("Invalid code.");
    expect(fifth.nextError).toBeUndefined();
    expect(sendTwoFactorWrongCodesEmail).toHaveBeenCalledTimes(1);
  });

  it("deciding whether to tell the owner can never change the answer, even when it throws", async () => {
    const account: Account = await newAccount();

    jest
      .spyOn(TwoFactorWrongCodes, "shouldTellOwner")
      .mockRejectedValue(new Error("unexpected") as never);

    for (let index: number = 0; index < 5; index++) {
      const result: AttemptResult = await enterCode(
        account,
        account.wrongCode(),
      );

      expect(result.errorMessage).toBe("Invalid code.");
      expect(result.nextError).toBeUndefined();
    }

    const backup: AttemptResult = await enterBackupCode(account, "abcde-fghij");

    expect(backup.errorMessage).toBe("Invalid backup code.");
    expect(backup.nextError).toBeUndefined();

    expect((await enterCode(account, account.code())).errorCode).toBe(
      ExceptionCode.TooManyRequestsException,
    );
  });
});

describe("a caller with the password gets no more codes checked by changing the request", () => {
  it("codes checked against two authenticator apps of one account share its one count", async () => {
    const account: Account = await newAccount();

    const secondSecret: string = TotpAuth.generateSecret();
    const secondOtpUrl: string = buildOtpauthUri({
      secret: secondSecret,
      label: account.email,
      algorithm: "SHA1",
    });
    const secondId: ObjectID = new ObjectID(
      "88888888-8888-4888-8888-888888888888",
    );

    const first: UserTotpAuth = account.totp;
    const second: UserTotpAuth = new UserTotpAuth();
    second.id = secondId;
    second.twoFactorSecret = secondSecret;
    second.twoFactorOtpUrl = secondOtpUrl;
    second.isVerified = true;

    totpFindBy.mockResolvedValue([first, second] as never);
    totpFindOneBy.mockImplementation(((args: {
      query: { _id: string };
    }): Promise<UserTotpAuth | null> => {
      return Promise.resolve(
        [first, second].find((row: UserTotpAuth): boolean => {
          return row.id!.toString() === args.query._id;
        }) || null,
      );
    }) as never);

    const secondCode: () => string = (): string => {
      return conformingAppCode(secondOtpUrl);
    };

    for (let index: number = 0; index < 5; index++) {
      const result: AttemptResult = await attempt({
        uri: "/verify-totp-auth",
        account,
        body: {
          code: account.wrongCode(),
          twoFactorAuthId: (index % 2 === 0 ? TOTP_ID : secondId).toString(),
        },
      });

      expect(result.errorMessage).toBe("Invalid code.");
    }

    verifyToken.mockClear();

    for (const [id, code] of [
      [TOTP_ID, account.code()],
      [secondId, secondCode()],
    ] as Array<[ObjectID, string]>) {
      const result: AttemptResult = await attempt({
        uri: "/verify-totp-auth",
        account,
        body: { code: code, twoFactorAuthId: id.toString() },
      });

      expect(result.errorCode).toBe(ExceptionCode.TooManyRequestsException);
    }

    expect(verifyToken).not.toHaveBeenCalled();
  });

  it("a code sent as a list, a number or an object is one attempt with one code checked - never the right one among many", async () => {
    const account: Account = await newAccount();

    const right: string = account.code();
    const shapes: Array<unknown> = [
      [
        ...Array.from({ length: 200 }, (_value: unknown, index: number) => {
          return String(index).padStart(6, "0");
        }),
        right,
      ],
      [right],
      Number(right),
      { value: right },
      `${right}${right}`,
    ];

    for (const shape of shapes) {
      const result: AttemptResult = await attempt({
        uri: "/verify-totp-auth",
        account,
        body: { code: shape, twoFactorAuthId: TOTP_ID.toString() },
      });

      expect(result.errorMessage).toBe("Invalid code.");
      expect(result.signedIn).toBe(false);
    }

    expect(verifyToken).toHaveBeenCalledTimes(shapes.length);
    expect(
      verifyToken.mock.results.map((result: { value: unknown }) => {
        return result.value;
      }),
    ).toEqual(Array(shapes.length).fill(false));

    expect((await enterCode(account, account.code())).errorCode).toBe(
      ExceptionCode.TooManyRequestsException,
    );
  });

  it("an id that is not one is counted like an app that is not the account's, and the owner is told when the waits begin", async () => {
    const account: Account = await newAccount();
    const row: UserTotpAuth = account.totp;

    // As the real query does: an id that is not a uuid is refused with a 400.
    totpFindOneBy.mockImplementation(((args: {
      query: { _id: unknown };
    }): Promise<UserTotpAuth> => {
      if (!UUIDColumnFilter.isUUIDText(args.query._id as string)) {
        return Promise.reject(
          new BadDataException('Invalid ID for "_id" in the query.'),
        );
      }

      return Promise.resolve(row);
    }) as never);

    for (let index: number = 0; index < 5; index++) {
      const result: AttemptResult = await attempt({
        uri: "/verify-totp-auth",
        account,
        body: { code: account.code(), twoFactorAuthId: `not-an-id-${index}` },
      });

      expect(result.nextError).toBeInstanceOf(BadDataException);
      expect(result.signedIn).toBe(false);
    }

    expect(verifyToken).not.toHaveBeenCalled();
    expect(sendTwoFactorWrongCodesEmail).toHaveBeenCalledTimes(1);
    expect(sendTwoFactorWrongCodesEmail).toHaveBeenCalledWith({
      user: account.user,
      wrongCodesInARow: 5,
    });

    expect((await enterCode(account, account.code())).errorCode).toBe(
      ExceptionCode.TooManyRequestsException,
    );
  });

  it("a backup code that cannot be looked up is counted, and the owner is told when the waits begin", async () => {
    const account: Account = await newAccount();

    consumeBackupCode.mockRejectedValue(new Error("connection lost") as never);

    for (let index: number = 0; index < 5; index++) {
      const result: AttemptResult = await enterBackupCode(
        account,
        "abcde-fghij",
      );

      expect((result.nextError as Error)?.message).toBe("connection lost");
    }

    expect(sendTwoFactorWrongCodesEmail).toHaveBeenCalledTimes(1);
    expect(sendTwoFactorWrongCodesEmail).toHaveBeenCalledWith({
      user: account.user,
      wrongCodesInARow: 5,
    });

    consumeBackupCode.mockClear();

    expect((await enterBackupCode(account, "abcde-fghij")).errorCode).toBe(
      ExceptionCode.TooManyRequestsException,
    );
    expect(consumeBackupCode).not.toHaveBeenCalled();
  });

  it("codes sent together the moment a wait ends: one is checked, and the rest wait for the next", async () => {
    const account: Account = await newAccount();

    await fiveWrongCodes(account);
    waitSeconds(60);
    verifyToken.mockClear();

    const results: Array<AttemptResult> = await Promise.all(
      Array.from({ length: 30 }, (): Promise<AttemptResult> => {
        return enterCode(account, account.wrongCode());
      }),
    );

    expect(verifyToken).toHaveBeenCalledTimes(1);

    const refused: Array<AttemptResult> = results.filter(
      (result: AttemptResult): boolean => {
        return result.errorCode === ExceptionCode.TooManyRequestsException;
      },
    );

    expect(refused).toHaveLength(29);
    expect(
      refused.map((result: AttemptResult) => {
        return result.retryAfter;
      }),
    ).toEqual(Array(29).fill("120"));
  });

  it("wrong backup codes sent at the same moment from many networks: five are checked, never more", async () => {
    const account: Account = await newAccount();

    const results: Array<AttemptResult> = await Promise.all(
      Array.from({ length: 30 }, (): Promise<AttemptResult> => {
        return enterBackupCode(account, "abcde-fghij");
      }),
    );

    expect(consumeBackupCode).toHaveBeenCalledTimes(5);
    expect(
      results.filter((result: AttemptResult): boolean => {
        return result.errorCode === ExceptionCode.TooManyRequestsException;
      }),
    ).toHaveLength(25);
  });

  it("the first enrolment route checks no code of an app the account already has, waiting or not", async () => {
    const account: Account = await newAccount();

    const enrol: () => Promise<AttemptResult> = (): Promise<AttemptResult> => {
      return attempt({
        uri: "/verify-totp-enrolment",
        account,
        body: { code: account.code(), twoFactorAuthId: TOTP_ID.toString() },
      });
    };

    expect((await enrol()).errorMessage).toBe(
      "Two factor authentication is already set up for this account.",
    );

    await fiveWrongCodes(account);
    verifyToken.mockClear();

    const result: AttemptResult = await enrol();

    expect(result.errorMessage).toBe(
      "Two factor authentication is already set up for this account.",
    );
    expect(result.signedIn).toBe(false);
    expect(verifyToken).not.toHaveBeenCalled();

    expect((await enterCode(account, account.code())).errorCode).toBe(
      ExceptionCode.TooManyRequestsException,
    );
  });
});

describe("no count, no check", () => {
  it("when the count fails, the code is not checked and the caller is asked to try again shortly", async () => {
    const account: Account = await newAccount();

    const evalSpy: jest.SpiedFunction<typeof client.eval> = jest
      .spyOn(client, "eval")
      .mockRejectedValue(new Error("connection lost") as never);

    const result: AttemptResult = await enterCode(account, account.code());

    expect(evalSpy).toHaveBeenCalled();
    expect(result.errorCode).toBe(ExceptionCode.ServiceUnavailableException);
    expect(result.errorMessage).toBe(IDENTITY_COUNTER_UNAVAILABLE_MESSAGE);
    expect(verifyToken).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();

    const backup: AttemptResult = await enterBackupCode(account, "abcde-fghij");

    expect(backup.errorCode).toBe(ExceptionCode.ServiceUnavailableException);
    expect(consumeBackupCode).not.toHaveBeenCalled();
  });
});
