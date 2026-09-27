import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  expectNoUserSecrets,
  MockIdentityRouter,
  RouteHandler,
  withSecretColumns,
} from "./IdentityRouterTestUtil";
import {
  VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
  VERIFICATION_EMAIL_RESEND_INVALID_MESSAGE,
  VERIFICATION_EMAIL_RESEND_WINDOW_IN_SECONDS,
} from "../../../FeatureSet/Identity/Utils/VerificationEmailResendPolicy";
import VerificationEmailResendToken, {
  VerificationEmailResendTokenClaims,
} from "../../../FeatureSet/Identity/Utils/VerificationEmailResendToken";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
  IdentityRateLimitOutcome,
  VERIFICATION_EMAIL_RESEND_RATE_LIMITED_MESSAGE,
  VERIFICATION_EMAIL_RESEND_UNAVAILABLE_MESSAGE,
} from "Common/Server/Middleware/IdentityRateLimit";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import User from "Common/Models/DatabaseModels/User";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import BadDataException from "Common/Types/Exception/BadDataException";
import DatabaseNotConnectedException from "Common/Types/Exception/DatabaseNotConnectedException";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import ServiceUnavailableException from "Common/Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "Common/Types/Exception/TooManyRequestsException";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * AN UNVERIFIED ACCOUNT CAN ASK FOR ANOTHER VERIFICATION LINK WITHOUT SIGNING
 * IN -- BUT ONLY WITH A CREDENTIAL, ONLY TO ITS OWN STORED ADDRESS, AND ONLY
 * AS OFTEN AS THE POLICY ALLOWS.
 *
 * POST /resend-verification-email is anonymous and every request that gets
 * through it sends an email. That makes the assertions that matter the ones
 * about what does NOT happen:
 *
 *   - it never takes an address. It takes exactly one credential -- the signed
 *     resend token /signup hands the page, or the token from an emailed
 *     verification link -- and the mail goes to the address STORED on the
 *     account, and only while that still equals the address the credential
 *     was minted for. An address in the body is ignored;
 *
 *   - every invalid request gets the SAME refusal, byte for byte: a missing,
 *     doubled, forged, expired or spent credential, an unknown link, a link
 *     past the age cap, a missing account, an unclaimed invitation, a changed
 *     address. A route that named the reason would be an oracle for which
 *     tokens and accounts exist. Where a credential can be rejected on its
 *     face it is rejected before any database query, and a link row with no
 *     userId never becomes a user query with its predicate dropped;
 *
 *   - a Redis fence, read FIRST, keeps a caller pressing during the cooldown
 *     off Postgres entirely, and its atomic claim means two concurrent
 *     requests cannot both mail. With Redis down it fails CLOSED (503), like
 *     the limiter in front of it. A send that fails releases only the fence
 *     THIS request set;
 *
 *   - the reply never carries a verification token -- not even with the
 *     end-to-end seam switched on -- and the logs never carry the credential.
 *
 * The limiter in front of the handler is the real IdentityRateLimit
 * middleware, so the ordering test proves it is wired, not just declared.
 * GlobalCache is the real class with its three fence methods spied on, so a
 * renamed method or a changed namespace fails here. The last block runs
 * /signup and feeds the token it hands out straight back into this route.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

let mockBillingEnabled: boolean = true;

/*
 * Served through a getter so one file can run as both deployment shapes. See
 * SignupMasterAdminElection.test.ts for why defineProperty, not a spread.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual, __esModule: true };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  return mocked;
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

const createEmailVerificationToken: jest.Mock = jest.fn();
const findEmailVerificationToken: jest.Mock = jest.fn();
const findEmailVerificationTokens: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return findEmailVerificationToken(...args);
      },
      findBy: (...args: Array<unknown>): unknown => {
        return findEmailVerificationTokens(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return createEmailVerificationToken(...args);
      },
      deleteOneBy: jest.fn(),
    },
  };
});

const userFindOneBy: jest.Mock = jest.fn();
const userUpdateOneBy: jest.Mock = jest.fn();
const userUpdateOneById: jest.Mock = jest.fn();
const userUpdateOneByIdAndFetch: jest.Mock = jest.fn();
const userCreateUserOnSignup: jest.Mock = jest.fn();
const userVerifyHashedColumnValue: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      updateOneBy: (...args: Array<unknown>): unknown => {
        return userUpdateOneBy(...args);
      },
      updateOneById: (...args: Array<unknown>): unknown => {
        return userUpdateOneById(...args);
      },
      updateOneByIdAndFetch: (...args: Array<unknown>): unknown => {
        return userUpdateOneByIdAndFetch(...args);
      },
      create: jest.fn(),
      createUserOnSignup: (...args: Array<unknown>): unknown => {
        return userCreateUserOnSignup(...args);
      },
      verifyHashedColumnValue: (...args: Array<unknown>): unknown => {
        return userVerifyHashedColumnValue(...args);
      },
      countBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
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
      findBy: (): Array<unknown> => {
        return [];
      },
      findOneBy: jest.fn(),
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

const createSession: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (...args: Array<unknown>): unknown => {
        return createSession(...args);
      },
      revokeAllSessionsByUserId: jest.fn(),
      findActiveSessionByRefreshToken: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
    },
  };
});

const sendMail: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: (...args: Array<unknown>): Promise<void> => {
        sendMail(...args);
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
        const hostname: typeof import("Common/Types/API/Hostname") =
          jest.requireActual("Common/Types/API/Hostname");

        return Promise.resolve(new hostname.default("oneuptime.test"));
      },
      getHttpProtocol: (): Promise<unknown> => {
        const protocol: typeof import("Common/Types/API/Protocol") =
          jest.requireActual("Common/Types/API/Protocol");

        return Promise.resolve(protocol.default.HTTPS);
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

const sendVerificationEmail: jest.Mock = jest.fn();
const sendCompleteRegistrationEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: (...args: Array<unknown>): unknown => {
        return sendVerificationEmail(...args);
      },
      sendCompleteRegistrationEmail: (...args: Array<unknown>): unknown => {
        return sendCompleteRegistrationEmail(...args);
      },
    },
  };
});

const consumeRegistrationToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/UserRegistrationToken", () => {
  return {
    __esModule: true,
    REGISTRATION_TOKEN_EXPIRY_IN_DAYS: 7,
    default: {
      consumeRegistrationToken: (...args: Array<unknown>): unknown => {
        return consumeRegistrationToken(...args);
      },
      generateRegistrationToken: jest.fn(),
      generateRegistrationLink: jest.fn(),
      getRegistrationLink: jest.fn(),
    },
  };
});

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (): Promise<unknown> => {
        return Promise.resolve({});
      },
    },
  };
});

// Every log line is captured, so the tests can prove what never reaches one.
const loggerInfo: jest.Mock = jest.fn();
const loggerError: jest.Mock = jest.fn();
const loggerWarn: jest.Mock = jest.fn();
const loggerDebug: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: (...args: Array<unknown>): void => {
        loggerInfo(...args);
      },
      error: (...args: Array<unknown>): void => {
        loggerError(...args);
      },
      warn: (...args: Array<unknown>): void => {
        loggerWarn(...args);
      },
      debug: (...args: Array<unknown>): void => {
        loggerDebug(...args);
      },
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
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: (...args: Array<unknown>): unknown => {
        return sendEntityResponse(...args);
      },
      sendJsonObjectResponse: (...args: Array<unknown>): unknown => {
        return sendJsonObjectResponse(...args);
      },
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const ROUTE: string = "/resend-verification-email";

/* Restated from the route on purpose: renaming it strands every live fence. */
const FENCE_NAMESPACE: string = "identity-verification-email-resend";

const USER_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID: string = "33333333-3333-4333-8333-333333333333";
const USER_EMAIL: string = "new-user@example.com";
const LINK_TOKEN: string = "44444444-4444-4444-8444-444444444444";
const LINK_ROW_ID: string = "55555555-5555-4555-8555-555555555555";
const CLIENT_IP: string = "203.0.113.9";

const MS_IN_SECOND: number = 1000;
const MS_IN_MINUTE: number = 60 * MS_IN_SECOND;
const MS_IN_HOUR: number = 60 * MS_IN_MINUTE;
const MS_IN_DAY: number = 24 * MS_IN_HOUR;

const E2E_FLAG: string = "EXPOSE_VERIFICATION_CODE_IN_API_RESPONSE_FOR_E2E";

const UUID_PATTERN: RegExp =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const FENCE_VALUE_PATTERN: RegExp = /^(\d+):([0-9a-f-]{36})$/;

/*
 * The route's clock, pinned to a whole second so every retry-after the tests
 * compute is exact. Tests that need time to pass move it.
 */
let clock: Date = new Date();

type AgoFunction = (amount: number) => Date;

const secondsAgo: AgoFunction = (seconds: number): Date => {
  return new Date(clock.getTime() - seconds * MS_IN_SECOND);
};

const minutesAgo: AgoFunction = (minutes: number): Date => {
  return new Date(clock.getTime() - minutes * MS_IN_MINUTE);
};

const hoursAgo: AgoFunction = (hours: number): Date => {
  return new Date(clock.getTime() - hours * MS_IN_HOUR);
};

const daysAgo: AgoFunction = (days: number): Date => {
  return new Date(clock.getTime() - days * MS_IN_DAY);
};

type StoredUserOptions = {
  id?: string;
  email?: string | null;
  isEmailVerified?: boolean;
  isBlocked?: boolean;
  hasPassword?: boolean;
};

type StoredUserFunction = (options?: StoredUserOptions) => User;

/*
 * The account as UserService hands it back -- a real model, carrying every
 * secret column a stored row can carry, so that a reply leaking any of them
 * would show up in expectNoUserSecrets.
 */
const storedUser: StoredUserFunction = (
  options: StoredUserOptions = {},
): User => {
  const user: User = new User();
  user._id = options.id || USER_ID;
  user.name = new Name("New User");
  user.isEmailVerified = options.isEmailVerified || false;
  user.isBlocked = options.isBlocked || false;

  if (options.email !== null) {
    user.email = new Email(options.email || USER_EMAIL);
  }

  if (options.hasPassword !== false) {
    withSecretColumns(user);
  }

  return user;
};

type LinkRowOptions = {
  userId?: string | null;
  email?: string | null;
  createdAt?: Date | null;
};

type LinkRowFunction = (options?: LinkRowOptions) => EmailVerificationToken;

/*
 * The EmailVerificationToken row behind an emailed link -- by default the
 * welcome link, two days old, so its one-day expiry has long passed. Expired
 * links are what this route exists to recover from.
 */
const linkRow: LinkRowFunction = (
  options: LinkRowOptions = {},
): EmailVerificationToken => {
  const row: EmailVerificationToken = new EmailVerificationToken();
  row._id = LINK_ROW_ID;
  row.token = new ObjectID(LINK_TOKEN);
  row.expires = new Date(daysAgo(1).getTime());

  if (options.userId !== null) {
    row.userId = new ObjectID(
      options.userId === undefined ? USER_ID : options.userId,
    );
  }

  if (options.email !== null) {
    row.email = new Email(options.email || USER_EMAIL);
  }

  if (options.createdAt !== null) {
    row.createdAt = options.createdAt || daysAgo(2);
  }

  return row;
};

type ResendTokenOptions = {
  userId?: string;
  email?: string;
  issuedAt?: Date;
};

type ResendTokenFunction = (options?: ResendTokenOptions) => string;

/* A genuine resend token, as /signup would have minted it -- by default ten minutes ago. */
const resendTokenFor: ResendTokenFunction = (
  options: ResendTokenOptions = {},
): string => {
  const token: string | null = VerificationEmailResendToken.generate({
    userId: new ObjectID(options.userId || USER_ID),
    email: new Email(options.email || USER_EMAIL),
    now: options.issuedAt || minutesAgo(10),
  });

  if (!token) {
    throw new Error("Could not mint a resend token for the test");
  }

  return token;
};

type HistoryFunction = (...sendTimes: Array<Date>) => Array<JSONObject>;

// The rows the policy query returns: only createdAt is selected.
const history: HistoryFunction = (
  ...sendTimes: Array<Date>
): Array<JSONObject> => {
  return sendTimes.map((createdAt: Date) => {
    return { createdAt: createdAt };
  });
};

type ResendBodyFunction = (token: string) => unknown;

const resendBody: ResendBodyFunction = (token: string): unknown => {
  return { data: { resendToken: token } };
};

const linkBody: ResendBodyFunction = (token: string): unknown => {
  return { data: { verificationToken: token } };
};

type InvokeResult = {
  /* Whatever the handler passed to next(): an Exception, or a raw Error. */
  nextError: unknown;

  /* The JSON body of a 200, or null when the handler sent none. */
  reply: JSONObject | null;
};

type InvokeFunction = (uri: string, body: unknown) => Promise<InvokeResult>;

/*
 * The route HANDLER, without the limiter in front of it: see the first
 * describe block for the limiter, which is exercised through matchAll.
 */
const invoke: InvokeFunction = async (
  uri: string,
  body: unknown,
): Promise<InvokeResult> => {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body);
  const res: ExpressResponse = buildResponse();

  let nextError: unknown = null;

  const next: NextFunction = ((err?: unknown): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  const repliesBefore: number = sendJsonObjectResponse.mock.calls.length;

  await handler(req, res, next);

  const calls: Array<Array<unknown>> = sendJsonObjectResponse.mock
    .calls as Array<Array<unknown>>;

  return {
    nextError,
    reply:
      calls.length > repliesBefore
        ? (calls[calls.length - 1]![2] as JSONObject)
        : null,
  };
};

type ResendFunction = (body: unknown) => Promise<InvokeResult>;

const resend: ResendFunction = (body: unknown): Promise<InvokeResult> => {
  return invoke(ROUTE, body);
};

type ExpectReplyFunction = (result: InvokeResult, expected: JSONObject) => void;

const expectReply: ExpectReplyFunction = (
  result: InvokeResult,
  expected: JSONObject,
): void => {
  expect(result.nextError).toBeNull();
  expect(result.reply).toEqual(expected);
};

type ExpectRefusalFunction = (result: InvokeResult) => void;

// The one refusal, and the proof that nothing was sent or claimed on the way.
const expectInvalidRefusal: ExpectRefusalFunction = (
  result: InvokeResult,
): void => {
  expect(result.nextError).toBeInstanceOf(BadDataException);
  expect((result.nextError as Exception).code).toBe(
    ExceptionCode.BadDataException,
  );
  expect((result.nextError as Exception).code).toBe(400);
  expect((result.nextError as Exception).message).toBe(
    VERIFICATION_EMAIL_RESEND_INVALID_MESSAGE,
  );
  expect(result.reply).toBeNull();
  expect(sendVerificationEmail).not.toHaveBeenCalled();
  expect(setStringIfNotExists).not.toHaveBeenCalled();
};

type DescribeLogArgFunction = (arg: unknown) => string;

const describeLogArg: DescribeLogArgFunction = (arg: unknown): string => {
  if (typeof arg === "string") {
    return arg;
  }

  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message} ${arg.stack || ""}`;
  }

  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    // Circular or otherwise unserializable: its string form is all there is.
    return String(arg);
  }
};

type AllLogTextFunction = () => string;

// Everything written to every log level, as text.
const allLogText: AllLogTextFunction = (): string => {
  const lines: Array<string> = [];

  for (const logMock of [loggerInfo, loggerError, loggerWarn, loggerDebug]) {
    for (const call of logMock.mock.calls as Array<Array<unknown>>) {
      lines.push(call.map(describeLogArg).join(" "));
    }
  }

  return lines.join("\n");
};

type FindArgsFunction = (mock: jest.Mock) => Record<string, any>;

const firstCallArgs: FindArgsFunction = (
  mock: jest.Mock,
): Record<string, any> => {
  expect(mock).toHaveBeenCalled();

  return mock.mock.calls[0]![0] as Record<string, any>;
};

type RawOperatorValueFunction = (operator: unknown) => unknown;

/*
 * QueryHelper.greaterThanEqualTo builds a TypeORM Raw operator with the bound
 * value under a random parameter name; this digs the value back out.
 */
const rawOperatorValue: RawOperatorValueFunction = (
  operator: unknown,
): unknown => {
  const parameters: Record<string, unknown> = (
    operator as { objectLiteralParameters: Record<string, unknown> }
  ).objectLiteralParameters;

  const values: Array<unknown> = Object.values(parameters || {});

  expect(values).toHaveLength(1);

  return values[0];
};

let getString: jest.SpiedFunction<typeof GlobalCache.getString>;
let setStringIfNotExists: jest.SpiedFunction<
  typeof GlobalCache.setStringIfNotExists
>;
let deleteKeyIfValue: jest.SpiedFunction<typeof GlobalCache.deleteKeyIfValue>;

/* The verification token the (mocked) mailer minted on the last send. */
let lastMintedVerificationToken: string | null = null;

let savedE2eFlag: string | undefined;

type ApplyDefaultsFunction = () => void;

/*
 * The happy path, as a baseline every test then bends one way: an unverified
 * account with a password, a two-day-old welcome link for it, one earlier
 * send (the welcome mail, ten minutes ago -- when the default resend token was
 * issued), no fence, and a mailer that works.
 */
const applyDefaults: ApplyDefaultsFunction = (): void => {
  jest.clearAllMocks();
  jest.restoreAllMocks();

  mockBillingEnabled = true;
  delete process.env[E2E_FLAG];

  clock = new Date(Math.floor(Date.now() / MS_IN_SECOND) * MS_IN_SECOND);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(clock.getTime());
  });

  getString = jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
  setStringIfNotExists = jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockResolvedValue(true);
  deleteKeyIfValue = jest
    .spyOn(GlobalCache, "deleteKeyIfValue")
    .mockResolvedValue(true);

  userFindOneBy.mockResolvedValue(storedUser());
  findEmailVerificationToken.mockResolvedValue(linkRow());
  findEmailVerificationTokens.mockResolvedValue(history(minutesAgo(10)));
  createEmailVerificationToken.mockResolvedValue(null);

  lastMintedVerificationToken = null;
  sendVerificationEmail.mockImplementation(async (): Promise<void> => {
    // What the real mailer does first: mint a fresh link token.
    lastMintedVerificationToken = ObjectID.generate().toString();
  });

  createSession.mockResolvedValue({
    session: { id: new ObjectID("11111111-1111-4111-8111-111111111111") },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
};

beforeEach(() => {
  savedE2eFlag = process.env[E2E_FLAG];
  applyDefaults();
});

afterEach(() => {
  jest.restoreAllMocks();

  if (savedE2eFlag === undefined) {
    delete process.env[E2E_FLAG];
  } else {
    process.env[E2E_FLAG] = savedE2eFlag;
  }
});

describe("the limiter runs before the handler", () => {
  type LimiterRunFunction = () => Promise<{
    reachedNext: boolean;
    headers: Array<Array<unknown>>;
  }>;

  // The FIRST registered handler only: the limiter, alone.
  const runLimiter: LimiterRunFunction = async (): Promise<{
    reachedNext: boolean;
    headers: Array<Array<unknown>>;
  }> => {
    const limiter: RouteHandler = mockRouter.matchAll("post", ROUTE)[0]!;

    const req: ExpressRequest = buildRequest(resendBody(resendTokenFor()), {
      headers: { "x-forwarded-for": CLIENT_IP },
      socketAddress: CLIENT_IP,
    });
    const res: ExpressResponse = buildResponse();

    let reachedNext: boolean = false;

    const next: NextFunction = ((): void => {
      reachedNext = true;
    }) as unknown as NextFunction;

    await limiter(req, res, next);

    return {
      reachedNext,
      headers: (res.setHeader as unknown as jest.Mock).mock.calls as Array<
        Array<unknown>
      >,
    };
  };

  it("registers exactly two handlers, the limiter first", () => {
    const handlers: Array<RouteHandler> = mockRouter.matchAll("post", ROUTE);

    expect(handlers).toHaveLength(2);
    expect(handlers[0]).not.toBe(handlers[1]);
    expect(handlers[1]).toBe(mockRouter.match("post", ROUTE));
  });

  it("bills its own verification-email-resend bucket, keyed on the client address", async () => {
    const consume: jest.SpiedFunction<typeof IdentityRateLimit.consume> = jest
      .spyOn(IdentityRateLimit, "consume")
      .mockResolvedValue({
        outcome: IdentityRateLimitOutcome.Allowed,
      });

    const { reachedNext } = await runLimiter();

    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls[0]![0]).toEqual({
      bucket: IdentityRateLimitBucket.VerificationEmailResend,
      // The body carries no address, so the account key is the shared "none".
      accountKey: "none",
      clientIp: CLIENT_IP,
    });
    expect(reachedNext).toBe(true);

    // The limiter alone touches nothing the handler would.
    expect(findEmailVerificationToken).not.toHaveBeenCalled();
    expect(userFindOneBy).not.toHaveBeenCalled();
    expect(getString).not.toHaveBeenCalled();
  });

  it("refuses a spent budget with the resend wording, and the handler never runs", async () => {
    jest.spyOn(IdentityRateLimit, "consume").mockResolvedValue({
      outcome: IdentityRateLimitOutcome.RateLimited,
      retryAfterSeconds: 120,
      isFirstRejectionInWindow: false,
    });

    const { reachedNext, headers } = await runLimiter();

    expect(reachedNext).toBe(false);
    expect(sendErrorResponse).toHaveBeenCalledTimes(1);

    const error: Exception = sendErrorResponse.mock.calls[0]![2] as Exception;

    expect(error).toBeInstanceOf(TooManyRequestsException);
    expect(error.message).toBe(VERIFICATION_EMAIL_RESEND_RATE_LIMITED_MESSAGE);
    expect(headers).toContainEqual(["Retry-After", "120"]);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("fails closed with the resend wording when the counter is unavailable", async () => {
    jest.spyOn(IdentityRateLimit, "consume").mockResolvedValue({
      outcome: IdentityRateLimitOutcome.CounterUnavailable,
    });

    const { reachedNext } = await runLimiter();

    expect(reachedNext).toBe(false);

    const error: Exception = sendErrorResponse.mock.calls[0]![2] as Exception;

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.message).toBe(VERIFICATION_EMAIL_RESEND_UNAVAILABLE_MESSAGE);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });
});

describe("a resend token from signup", () => {
  it("mails a fresh link to the account it names", async () => {
    const user: User = storedUser();
    userFindOneBy.mockResolvedValue(user);

    const result: InvokeResult = await resend(resendBody(resendTokenFor()));

    expect(result.nextError).toBeNull();
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);

    /*
     * The mailer is handed the STORED account -- the very model the lookup
     * returned -- and mails whatever address that holds.
     */
    const mailed: User = sendVerificationEmail.mock.calls[0]![0] as User;

    expect(mailed).toBe(user);
    expect(mailed.id!.toString()).toBe(USER_ID);
    expect(mailed.email!.toString()).toBe(USER_EMAIL);
  });

  it("answers that the mail went out and when another may be asked for", async () => {
    expectReply(await resend(resendBody(resendTokenFor())), {
      emailSent: true,
      alreadyVerified: false,
      retryAfterSeconds: 60,
    });
  });

  it("looks the account up by the id in the token, as root, selecting only what it needs", async () => {
    await resend(resendBody(resendTokenFor()));

    const lookup: Record<string, any> = firstCallArgs(userFindOneBy);

    expect(lookup["query"]["_id"].toString()).toBe(USER_ID);
    expect(Object.keys(lookup["query"])).toEqual(["_id"]);
    expect(lookup["select"]).toEqual({
      _id: true,
      email: true,
      name: true,
      isEmailVerified: true,
      isBlocked: true,
      password: true,
    });
    expect(lookup["props"]).toEqual({ isRoot: true });
  });

  it("never consults the link-token table for a resend token", async () => {
    await resend(resendBody(resendTokenFor()));

    expect(findEmailVerificationToken).not.toHaveBeenCalled();
  });

  it("claims the fence for exactly the cooldown, under the route's namespace", async () => {
    await resend(resendBody(resendTokenFor()));

    expect(setStringIfNotExists).toHaveBeenCalledTimes(1);

    const [namespace, key, value, options] =
      setStringIfNotExists.mock.calls[0]!;

    expect(namespace).toBe(FENCE_NAMESPACE);
    expect(key).toBe(USER_ID);
    expect(options).toEqual({
      expiresInSeconds: VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
    });

    /*
     * "<claimedAtEpochMs>:<random uuid>": when it was claimed, so the cheap
     * read can say how long is left, and a random half so the release after a
     * failed send can only ever remove THIS request's fence.
     */
    const match: RegExpMatchArray | null = value.match(FENCE_VALUE_PATTERN);

    expect(match).not.toBeNull();
    expect(match![1]).toBe(String(clock.getTime()));
  });

  it("claims a different fence value on every request", async () => {
    await resend(resendBody(resendTokenFor()));
    await resend(resendBody(resendTokenFor()));

    expect(setStringIfNotExists).toHaveBeenCalledTimes(2);
    expect(setStringIfNotExists.mock.calls[0]![2]).not.toBe(
      setStringIfNotExists.mock.calls[1]![2],
    );
  });

  it("reads the fence first, then the history, then claims, then sends", async () => {
    await resend(resendBody(resendTokenFor()));

    expect(getString).toHaveBeenCalledWith(FENCE_NAMESPACE, USER_ID);

    const readAt: number = getString.mock.invocationCallOrder[0]!;
    const historyAt: number =
      findEmailVerificationTokens.mock.invocationCallOrder[0]!;
    const claimAt: number = setStringIfNotExists.mock.invocationCallOrder[0]!;
    const sendAt: number = sendVerificationEmail.mock.invocationCallOrder[0]!;

    expect(readAt).toBeLessThan(historyAt);
    expect(historyAt).toBeLessThan(claimAt);
    expect(claimAt).toBeLessThan(sendAt);
  });

  it("asks for the account's send history since the start of the hour", async () => {
    // Issued ten minutes ago: the hour reaches further back than issuance.
    await resend(resendBody(resendTokenFor()));

    const query: Record<string, any> = firstCallArgs(
      findEmailVerificationTokens,
    );

    expect(query["query"]["userId"].toString()).toBe(USER_ID);
    expect(rawOperatorValue(query["query"]["createdAt"])).toEqual(
      new Date(
        clock.getTime() - VERIFICATION_EMAIL_RESEND_WINDOW_IN_SECONDS * 1000,
      ),
    );
    expect(query["select"]).toEqual({ createdAt: true });
    expect(query["sort"]).toEqual({ createdAt: SortOrder.Descending });
    expect(query["limit"]).toBe(100);
    expect(query["skip"]).toBe(0);
    expect(query["props"]).toEqual({ isRoot: true });
  });

  it("reaches back to issuance when the token is older than the hour", async () => {
    /*
     * Otherwise the resends a day-old token has already bought would fall
     * outside the query and the per-credential cap would never see them.
     */
    const issuedAt: Date = hoursAgo(20);

    await resend(resendBody(resendTokenFor({ issuedAt })));

    expect(
      rawOperatorValue(
        firstCallArgs(findEmailVerificationTokens)["query"]["createdAt"],
      ),
    ).toEqual(issuedAt);
  });

  it("ignores an address supplied alongside the token", async () => {
    const result: InvokeResult = await resend({
      data: {
        resendToken: resendTokenFor(),
        email: "attacker@evil.test",
        toEmail: "attacker@evil.test",
      },
    });

    expect(result.reply!["emailSent"]).toBe(true);
    expect(
      (sendVerificationEmail.mock.calls[0]![0] as User).email!.toString(),
    ).toBe(USER_EMAIL);
    expect(JSON.stringify(userFindOneBy.mock.calls[0]![0])).not.toContain(
      "attacker",
    );
  });

  it("accepts a token whose empty sibling field is the only other thing present", async () => {
    // Exactly one NON-EMPTY credential: an empty other field is no credential.
    const result: InvokeResult = await resend({
      data: { resendToken: resendTokenFor(), verificationToken: "" },
    });

    expect(result.reply!["emailSent"]).toBe(true);
  });

  it("logs the send against the account id and nothing else", async () => {
    await resend(resendBody(resendTokenFor()));

    const sentLog: Array<unknown> | undefined = (
      loggerInfo.mock.calls as Array<Array<unknown>>
    ).find((call: Array<unknown>) => {
      return call[0] === "Verification email resent";
    });

    expect(sentLog).toBeDefined();
    expect(sentLog![1]).toEqual({ userId: USER_ID });
  });
});

describe("the token from an expired verification link", () => {
  it("mails a fresh link to the account the link belongs to", async () => {
    const user: User = storedUser();
    userFindOneBy.mockResolvedValue(user);

    const result: InvokeResult = await resend(linkBody(LINK_TOKEN));

    expectReply(result, {
      emailSent: true,
      alreadyVerified: false,
      retryAfterSeconds: 60,
    });
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmail.mock.calls[0]![0]).toBe(user);
  });

  it("finds the link's row by its token, as root, selecting only what it needs", async () => {
    await resend(linkBody(LINK_TOKEN));

    const lookup: Record<string, any> = firstCallArgs(
      findEmailVerificationToken,
    );

    expect(lookup["query"]["token"]).toBeInstanceOf(ObjectID);
    expect(lookup["query"]["token"].toString()).toBe(LINK_TOKEN);
    expect(lookup["select"]).toEqual({
      _id: true,
      userId: true,
      email: true,
      createdAt: true,
    });
    expect(lookup["props"]).toEqual({ isRoot: true });
  });

  it("looks the account up by the row's userId", async () => {
    await resend(linkBody(LINK_TOKEN));

    expect(firstCallArgs(userFindOneBy)["query"]["_id"].toString()).toBe(
      USER_ID,
    );
  });

  it("counts the send history from when the link was minted", async () => {
    const createdAt: Date = daysAgo(3);
    findEmailVerificationToken.mockResolvedValue(linkRow({ createdAt }));

    await resend(linkBody(LINK_TOKEN));

    expect(
      rawOperatorValue(
        firstCallArgs(findEmailVerificationTokens)["query"]["createdAt"],
      ),
    ).toEqual(createdAt);
  });

  it("still honours a link exactly fourteen days old", async () => {
    findEmailVerificationToken.mockResolvedValue(
      linkRow({ createdAt: daysAgo(14) }),
    );

    expect((await resend(linkBody(LINK_TOKEN))).reply!["emailSent"]).toBe(true);
  });

  it("still honours a link that has not expired yet", async () => {
    findEmailVerificationToken.mockResolvedValue(
      linkRow({ createdAt: minutesAgo(30) }),
    );
    findEmailVerificationTokens.mockResolvedValue(history(minutesAgo(30)));

    expect((await resend(linkBody(LINK_TOKEN))).reply!["emailSent"]).toBe(true);
  });

  it("does not count the link's own mail as one of the resends it buys", async () => {
    /*
     * The row itself is in the history, stamped at exactly its createdAt --
     * the moment the credential was issued -- plus two resends since. Two is
     * under the cap of three, so this one goes out.
     */
    const createdAt: Date = daysAgo(2);
    findEmailVerificationToken.mockResolvedValue(linkRow({ createdAt }));
    findEmailVerificationTokens.mockResolvedValue(
      history(createdAt, hoursAgo(30), minutesAgo(5)),
    );

    expect((await resend(linkBody(LINK_TOKEN))).reply!["emailSent"]).toBe(true);
  });
});

type InvalidCase = {
  label: string;
  body: () => unknown;
  setup?: () => void;

  /*
   * How far the request is allowed to get before it is refused:
   *  - "nothing": rejected on its face -- no query of any kind;
   *  - "link-lookup": the link row is read, and nothing after it;
   *  - "user-lookup": the account is read, but no fence and no history;
   *  - "policy": the fence and the history are read, but nothing is claimed.
   */
  reaches: "nothing" | "link-lookup" | "user-lookup" | "policy";
};

type ForgedTokenFunction = () => string;

const forgedResendToken: ForgedTokenFunction = (): string => {
  const genuine: string = resendTokenFor();
  const signature: string = genuine.slice(-43);
  const flipped: string =
    (signature[0] === "A" ? "B" : "A") + signature.slice(1);

  return genuine.slice(0, -43) + flipped;
};

const editedResendToken: ForgedTokenFunction = (): string => {
  const genuine: string = resendTokenFor();
  const [prefix, payload, signature] = genuine.split(".");
  const claims: JSONObject = JSON.parse(
    Buffer.from(payload!, "base64url").toString("utf8"),
  ) as JSONObject;

  claims["u"] = OTHER_USER_ID;

  return `${prefix}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
};

const INVALID_CASES: Array<InvalidCase> = [
  // --- the body itself ---
  {
    label: "no body at all",
    body: (): unknown => {
      return undefined;
    },
    reaches: "nothing",
  },
  {
    label: "an empty body",
    body: (): unknown => {
      return {};
    },
    reaches: "nothing",
  },
  {
    label: "a null data envelope",
    body: (): unknown => {
      return { data: null };
    },
    reaches: "nothing",
  },
  {
    label: "a data envelope that is an array",
    body: (): unknown => {
      return { data: [resendTokenFor()] };
    },
    reaches: "nothing",
  },
  {
    label: "a data envelope that is a string",
    body: (): unknown => {
      return { data: resendTokenFor() };
    },
    reaches: "nothing",
  },
  {
    label: "a credential at the top level instead of under data",
    body: (): unknown => {
      return { resendToken: resendTokenFor() };
    },
    reaches: "nothing",
  },
  {
    label: "neither credential",
    body: (): unknown => {
      return { data: {} };
    },
    reaches: "nothing",
  },
  {
    label: "only an email address",
    body: (): unknown => {
      return { data: { email: USER_EMAIL } };
    },
    reaches: "nothing",
  },
  {
    label: "both credentials",
    body: (): unknown => {
      return {
        data: { resendToken: resendTokenFor(), verificationToken: LINK_TOKEN },
      };
    },
    reaches: "nothing",
  },
  {
    label: "an empty resend token",
    body: (): unknown => {
      return { data: { resendToken: "" } };
    },
    reaches: "nothing",
  },
  {
    label: "an empty verification token",
    body: (): unknown => {
      return { data: { verificationToken: "" } };
    },
    reaches: "nothing",
  },
  {
    label: "both credentials empty",
    body: (): unknown => {
      return { data: { resendToken: "", verificationToken: "" } };
    },
    reaches: "nothing",
  },
  {
    label: "a numeric resend token",
    body: (): unknown => {
      return { data: { resendToken: 12345 } };
    },
    reaches: "nothing",
  },
  {
    label: "a resend token wrapped in an object",
    body: (): unknown => {
      return { data: { resendToken: { value: resendTokenFor() } } };
    },
    reaches: "nothing",
  },
  {
    label: "a resend token wrapped in an array",
    body: (): unknown => {
      return { data: { resendToken: [resendTokenFor()] } };
    },
    reaches: "nothing",
  },
  {
    label: "a verification token serialized as an ObjectID envelope",
    body: (): unknown => {
      return {
        data: { verificationToken: { _type: "ObjectID", value: LINK_TOKEN } },
      };
    },
    reaches: "nothing",
  },
  {
    label: "a boolean verification token",
    body: (): unknown => {
      return { data: { verificationToken: true } };
    },
    reaches: "nothing",
  },

  // --- the resend token ---
  {
    label: "a resend token with a forged signature",
    body: (): unknown => {
      return resendBody(forgedResendToken());
    },
    reaches: "nothing",
  },
  {
    label: "a resend token edited to name another account",
    body: (): unknown => {
      return resendBody(editedResendToken());
    },
    reaches: "nothing",
  },
  {
    label: "an expired resend token",
    body: (): unknown => {
      return resendBody(resendTokenFor({ issuedAt: hoursAgo(25) }));
    },
    reaches: "nothing",
  },
  {
    label: "a resend token issued in the far future",
    body: (): unknown => {
      return resendBody(
        resendTokenFor({ issuedAt: new Date(clock.getTime() + MS_IN_DAY) }),
      );
    },
    reaches: "nothing",
  },
  {
    label: "a session JWT in place of a resend token",
    body: (): unknown => {
      return resendBody(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6Im5ldy11c2VyQGV4YW1wbGUuY29tIn0.c2lnbmF0dXJl",
      );
    },
    reaches: "nothing",
  },
  {
    label: "a link token in the resend token field",
    body: (): unknown => {
      return resendBody(LINK_TOKEN);
    },
    reaches: "nothing",
  },

  // --- the link token, on its face ---
  {
    label: "a verification token that is not a UUID",
    body: (): unknown => {
      return linkBody("not-a-uuid");
    },
    reaches: "nothing",
  },
  {
    label: "a verification token carrying a SQL payload",
    body: (): unknown => {
      return linkBody(`${LINK_TOKEN}' OR '1'='1`);
    },
    reaches: "nothing",
  },
  {
    label: "a verification token with trailing text",
    body: (): unknown => {
      return linkBody(`${LINK_TOKEN}0`);
    },
    reaches: "nothing",
  },
  {
    label: "a resend token in the verification token field",
    body: (): unknown => {
      return linkBody(resendTokenFor());
    },
    reaches: "nothing",
  },

  // --- the link token's row ---
  {
    label: "a link token nobody minted",
    body: (): unknown => {
      return linkBody(LINK_TOKEN);
    },
    setup: (): void => {
      findEmailVerificationToken.mockResolvedValue(null);
    },
    reaches: "link-lookup",
  },
  {
    label: "a link row with no userId",
    body: (): unknown => {
      return linkBody(LINK_TOKEN);
    },
    setup: (): void => {
      findEmailVerificationToken.mockResolvedValue(linkRow({ userId: null }));
    },
    reaches: "link-lookup",
  },
  {
    label: "a link row with an empty userId",
    body: (): unknown => {
      return linkBody(LINK_TOKEN);
    },
    setup: (): void => {
      findEmailVerificationToken.mockResolvedValue(linkRow({ userId: "" }));
    },
    reaches: "link-lookup",
  },
  {
    label: "a link row with no email",
    body: (): unknown => {
      return linkBody(LINK_TOKEN);
    },
    setup: (): void => {
      findEmailVerificationToken.mockResolvedValue(linkRow({ email: null }));
    },
    reaches: "link-lookup",
  },
  {
    label: "a link row a millisecond past fourteen days old",
    body: (): unknown => {
      return linkBody(LINK_TOKEN);
    },
    setup: (): void => {
      findEmailVerificationToken.mockResolvedValue(
        linkRow({ createdAt: new Date(daysAgo(14).getTime() - 1) }),
      );
    },
    reaches: "link-lookup",
  },
  {
    label: "a link row months old",
    body: (): unknown => {
      return linkBody(LINK_TOKEN);
    },
    setup: (): void => {
      findEmailVerificationToken.mockResolvedValue(
        linkRow({ createdAt: daysAgo(120) }),
      );
    },
    reaches: "link-lookup",
  },
  {
    label: "a link row with no createdAt",
    body: (): unknown => {
      return linkBody(LINK_TOKEN);
    },
    setup: (): void => {
      findEmailVerificationToken.mockResolvedValue(
        linkRow({ createdAt: null }),
      );
    },
    reaches: "link-lookup",
  },
  {
    label: "a link row with an unreadable createdAt",
    body: (): unknown => {
      return linkBody(LINK_TOKEN);
    },
    setup: (): void => {
      findEmailVerificationToken.mockResolvedValue(
        linkRow({ createdAt: new Date("not a date") }),
      );
    },
    reaches: "link-lookup",
  },

  // --- the account ---
  {
    label: "a resend token for an account that no longer exists",
    body: (): unknown => {
      return resendBody(resendTokenFor());
    },
    setup: (): void => {
      userFindOneBy.mockResolvedValue(null);
    },
    reaches: "user-lookup",
  },
  {
    label: "a link for an account that no longer exists",
    body: (): unknown => {
      return linkBody(LINK_TOKEN);
    },
    setup: (): void => {
      userFindOneBy.mockResolvedValue(null);
    },
    reaches: "user-lookup",
  },
  {
    label: "a resend token for an unclaimed invitation with no password",
    body: (): unknown => {
      return resendBody(resendTokenFor());
    },
    setup: (): void => {
      userFindOneBy.mockResolvedValue(storedUser({ hasPassword: false }));
    },
    reaches: "user-lookup",
  },
  {
    label: "a link for an unclaimed invitation with no password",
    body: (): unknown => {
      return linkBody(LINK_TOKEN);
    },
    setup: (): void => {
      userFindOneBy.mockResolvedValue(storedUser({ hasPassword: false }));
    },
    reaches: "user-lookup",
  },
  {
    label: "a resend token minted before the account changed its address",
    body: (): unknown => {
      return resendBody(resendTokenFor({ email: "old-address@example.com" }));
    },
    reaches: "user-lookup",
  },
  {
    label: "a link minted before the account changed its address",
    body: (): unknown => {
      return linkBody(LINK_TOKEN);
    },
    setup: (): void => {
      findEmailVerificationToken.mockResolvedValue(
        linkRow({ email: "old-address@example.com" }),
      );
    },
    reaches: "user-lookup",
  },
  {
    label: "a resend token naming an address this account never had",
    body: (): unknown => {
      return resendBody(resendTokenFor({ email: "someone-else@example.com" }));
    },
    reaches: "user-lookup",
  },
  {
    label: "an account with no stored address",
    body: (): unknown => {
      return resendBody(resendTokenFor());
    },
    setup: (): void => {
      userFindOneBy.mockResolvedValue(storedUser({ email: null }));
    },
    reaches: "user-lookup",
  },

  // --- the credential has bought all it will ever buy ---
  {
    label: "a resend token that has already bought its three resends",
    body: (): unknown => {
      return resendBody(resendTokenFor({ issuedAt: minutesAgo(30) }));
    },
    setup: (): void => {
      findEmailVerificationTokens.mockResolvedValue(
        history(minutesAgo(30), minutesAgo(25), minutesAgo(15), minutesAgo(5)),
      );
    },
    reaches: "policy",
  },
  {
    label:
      "a link whose account has been mailed three times since it was minted",
    body: (): unknown => {
      return linkBody(LINK_TOKEN);
    },
    setup: (): void => {
      const createdAt: Date = daysAgo(2);
      findEmailVerificationToken.mockResolvedValue(linkRow({ createdAt }));
      findEmailVerificationTokens.mockResolvedValue(
        history(createdAt, hoursAgo(30), hoursAgo(20), minutesAgo(5)),
      );
    },
    reaches: "policy",
  },
];

type RunInvalidCaseFunction = (
  invalidCase: InvalidCase,
) => Promise<InvokeResult>;

const runInvalidCase: RunInvalidCaseFunction = async (
  invalidCase: InvalidCase,
): Promise<InvokeResult> => {
  invalidCase.setup?.();
  return resend(invalidCase.body());
};

describe("every invalid request gets the same refusal", () => {
  it.each(
    INVALID_CASES.map((invalidCase: InvalidCase) => {
      return [invalidCase.label, invalidCase];
    }),
  )("refuses %s", async (_label: unknown, invalidCase: unknown) => {
    const theCase: InvalidCase = invalidCase as InvalidCase;

    const result: InvokeResult = await runInvalidCase(theCase);

    expectInvalidRefusal(result);

    const reachesLinkLookup: boolean =
      theCase.reaches !== "nothing" &&
      (theCase.body() as { data?: JSONObject }).data?.["verificationToken"] !==
        undefined;

    if (theCase.reaches === "nothing") {
      /*
       * Rejected on its face: not one query, not one Redis round trip. A
       * malformed link token in particular never reaches the token column.
       */
      expect(findEmailVerificationToken).not.toHaveBeenCalled();
      expect(userFindOneBy).not.toHaveBeenCalled();
    } else if (reachesLinkLookup) {
      expect(findEmailVerificationToken).toHaveBeenCalledTimes(1);
    }

    if (theCase.reaches === "link-lookup") {
      /*
       * Above all for the row with no userId: querying the account with
       * `_id: undefined` drops the predicate, and TypeORM answers with
       * somebody else's account.
       */
      expect(userFindOneBy).not.toHaveBeenCalled();
    }

    if (theCase.reaches === "user-lookup") {
      expect(userFindOneBy).toHaveBeenCalledTimes(1);
    }

    if (theCase.reaches !== "policy") {
      expect(getString).not.toHaveBeenCalled();
      expect(findEmailVerificationTokens).not.toHaveBeenCalled();
    } else {
      expect(getString).toHaveBeenCalledTimes(1);
      expect(findEmailVerificationTokens).toHaveBeenCalledTimes(1);
    }
  });

  it("says exactly the same thing, with the same status, in every one of those cases", async () => {
    const answers: Set<string> = new Set();

    for (const invalidCase of INVALID_CASES) {
      applyDefaults();

      const result: InvokeResult = await runInvalidCase(invalidCase);
      const error: Exception = result.nextError as Exception;

      answers.add(
        JSON.stringify({
          type: error.constructor.name,
          code: error.code,
          message: error.message,
          reply: result.reply,
        }),
      );
    }

    expect(Array.from(answers)).toEqual([
      JSON.stringify({
        type: "BadDataException",
        code: 400,
        message: VERIFICATION_EMAIL_RESEND_INVALID_MESSAGE,
        reply: null,
      }),
    ]);
  });

  it("never names the account, the address or the credential in the refusal", async () => {
    for (const invalidCase of INVALID_CASES) {
      applyDefaults();

      const message: string = (
        (await runInvalidCase(invalidCase)).nextError as Exception
      ).message;

      expect(message).not.toContain(USER_ID);
      expect(message).not.toContain(USER_EMAIL);
      expect(message).not.toContain(LINK_TOKEN);
    }
  });
});

describe("a blocked account", () => {
  it("is told it is blocked, and mailed nothing", async () => {
    userFindOneBy.mockResolvedValue(storedUser({ isBlocked: true }));

    const result: InvokeResult = await resend(resendBody(resendTokenFor()));

    expect(result.nextError).toBeInstanceOf(BadDataException);
    expect((result.nextError as Exception).message).toBe(
      ExceptionMessages.UserBlocked,
    );
    expect(result.reply).toBeNull();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(getString).not.toHaveBeenCalled();
    expect(setStringIfNotExists).not.toHaveBeenCalled();
  });

  it("is told it is blocked ahead of being told it is already verified", async () => {
    userFindOneBy.mockResolvedValue(
      storedUser({ isBlocked: true, isEmailVerified: true }),
    );

    const result: InvokeResult = await resend(linkBody(LINK_TOKEN));

    expect((result.nextError as Exception).message).toBe(
      ExceptionMessages.UserBlocked,
    );
    expect(result.reply).toBeNull();
  });
});

describe("an account that is already verified", () => {
  it.each([
    [
      "a resend token",
      (): unknown => {
        return resendBody(resendTokenFor());
      },
    ],
    [
      "a link token",
      (): unknown => {
        return linkBody(LINK_TOKEN);
      },
    ],
  ])(
    "is told so through %s, and mailed nothing",
    async (_label: string, body: () => unknown) => {
      userFindOneBy.mockResolvedValue(storedUser({ isEmailVerified: true }));

      const result: InvokeResult = await resend(body());

      expectReply(result, {
        emailSent: false,
        alreadyVerified: true,
        retryAfterSeconds: 0,
      });
      expect(sendVerificationEmail).not.toHaveBeenCalled();
      expect(getString).not.toHaveBeenCalled();
      expect(findEmailVerificationTokens).not.toHaveBeenCalled();
      expect(setStringIfNotExists).not.toHaveBeenCalled();
    },
  );
});

describe("the fence -- a send claimed within the last minute", () => {
  type FenceValueFunction = (claimedAt: Date) => string;

  const fenceValue: FenceValueFunction = (claimedAt: Date): string => {
    return `${claimedAt.getTime()}:0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f`;
  };

  it("answers with the rest of the cooldown without touching Postgres", async () => {
    getString.mockResolvedValue(fenceValue(secondsAgo(20)));

    const result: InvokeResult = await resend(resendBody(resendTokenFor()));

    expectReply(result, {
      emailSent: false,
      alreadyVerified: false,
      retryAfterSeconds: 40,
    });

    /*
     * The point of reading the fence first: a caller pressing the button
     * during the cooldown costs a Redis GET, not a scan of a table whose
     * userId column has no index.
     */
    expect(findEmailVerificationTokens).not.toHaveBeenCalled();
    expect(setStringIfNotExists).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("rounds the remaining wait up to a whole second", async () => {
    getString.mockResolvedValue(
      fenceValue(new Date(secondsAgo(59).getTime() - 500)),
    );

    expect((await resend(resendBody(resendTokenFor()))).reply).toEqual({
      emailSent: false,
      alreadyVerified: false,
      retryAfterSeconds: 1,
    });
  });

  it("never says to wait longer than the cooldown, even for a claim stamped in the future", async () => {
    getString.mockResolvedValue(
      fenceValue(new Date(clock.getTime() + 10 * MS_IN_MINUTE)),
    );

    expect(
      (await resend(resendBody(resendTokenFor()))).reply!["retryAfterSeconds"],
    ).toBe(60);
  });

  it("never says to wait zero seconds for a fence Redis has not expired yet", async () => {
    getString.mockResolvedValue(fenceValue(secondsAgo(75)));

    expect(
      (await resend(resendBody(resendTokenFor()))).reply!["retryAfterSeconds"],
    ).toBe(1);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("falls through to the policy and the atomic claim when the fence cannot be read", async () => {
    /*
     * An unreadable value is not treated as "no fence": the claim below still
     * fails on it, because the key exists.
     */
    getString.mockResolvedValue("not-a-fence-value");
    setStringIfNotExists.mockResolvedValue(false);

    const result: InvokeResult = await resend(resendBody(resendTokenFor()));

    expect(findEmailVerificationTokens).toHaveBeenCalledTimes(1);
    expectReply(result, {
      emailSent: false,
      alreadyVerified: false,
      retryAfterSeconds: 60,
    });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });
});

describe("the policy over the account's send history", () => {
  it("makes the caller wait out the cooldown after a recent send of any kind", async () => {
    /*
     * The recent row could be a sign-in attempt's resend, an invitation, an
     * SSO confirmation: from the inbox's point of view it is all "another
     * email from OneUptime", so all of it counts.
     */
    findEmailVerificationTokens.mockResolvedValue(
      history(minutesAgo(10), secondsAgo(20)),
    );

    const result: InvokeResult = await resend(resendBody(resendTokenFor()));

    expectReply(result, {
      emailSent: false,
      alreadyVerified: false,
      retryAfterSeconds: 40,
    });
    expect(setStringIfNotExists).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("holds the account to five mails an hour", async () => {
    /*
     * Five sends in the last hour, all well apart; only one of them after the
     * token was issued, so the credential is nowhere near spent. The oldest
     * leaves the hour in ten minutes.
     */
    findEmailVerificationTokens.mockResolvedValue(
      history(
        minutesAgo(50),
        minutesAgo(40),
        minutesAgo(30),
        minutesAgo(20),
        minutesAgo(9),
      ),
    );

    const result: InvokeResult = await resend(resendBody(resendTokenFor()));

    expectReply(result, {
      emailSent: false,
      alreadyVerified: false,
      retryAfterSeconds: 600,
    });
    expect(setStringIfNotExists).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("lets the next resend through once the cooldown has passed", async () => {
    findEmailVerificationTokens.mockResolvedValue(
      history(minutesAgo(10), secondsAgo(61)),
    );

    expect(
      (await resend(resendBody(resendTokenFor()))).reply!["emailSent"],
    ).toBe(true);
  });
});

describe("two requests racing for the same send", () => {
  it("lets only the one that wins the claim send; the other is told to wait", async () => {
    setStringIfNotExists.mockResolvedValue(false);

    const result: InvokeResult = await resend(resendBody(resendTokenFor()));

    expectReply(result, {
      emailSent: false,
      alreadyVerified: false,
      retryAfterSeconds: VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
    });
    expect(sendVerificationEmail).not.toHaveBeenCalled();

    // It holds no fence, so it releases none -- the winner's stays put.
    expect(deleteKeyIfValue).not.toHaveBeenCalled();
  });
});

describe("with Redis unreachable", () => {
  type ExpectUnavailableFunction = (result: InvokeResult) => void;

  const expectUnavailable: ExpectUnavailableFunction = (
    result: InvokeResult,
  ): void => {
    expect(result.nextError).toBeInstanceOf(ServiceUnavailableException);
    expect((result.nextError as Exception).code).toBe(503);
    expect((result.nextError as Exception).message).toBe(
      VERIFICATION_EMAIL_RESEND_UNAVAILABLE_MESSAGE,
    );
    expect(result.reply).toBeNull();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  };

  it("fails closed when the fence cannot be read", async () => {
    getString.mockRejectedValue(
      new DatabaseNotConnectedException("Cache is not connected"),
    );

    const result: InvokeResult = await resend(resendBody(resendTokenFor()));

    expectUnavailable(result);
    expect(findEmailVerificationTokens).not.toHaveBeenCalled();
  });

  it("fails closed when the fence cannot be claimed", async () => {
    /*
     * Sending without the claim would put the send back on a read-then-act
     * race any two concurrent requests could win together.
     */
    setStringIfNotExists.mockRejectedValue(
      new DatabaseNotConnectedException("Cache is not connected"),
    );

    expectUnavailable(await resend(linkBody(LINK_TOKEN)));
  });

  it("passes any other cache failure through untouched rather than calling it an outage", async () => {
    const failure: Error = new Error("WRONGTYPE Operation against a key");
    getString.mockRejectedValue(failure);

    const result: InvokeResult = await resend(resendBody(resendTokenFor()));

    expect(result.nextError).toBe(failure);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });
});

describe("when the send itself fails", () => {
  const SMTP_FAILURE: Error = new Error("SMTP connection refused");

  it("releases exactly the fence it claimed, and reports the failure", async () => {
    sendVerificationEmail.mockRejectedValue(SMTP_FAILURE);

    const result: InvokeResult = await resend(resendBody(resendTokenFor()));

    const claimedValue: string = setStringIfNotExists.mock.calls[0]![2];

    /*
     * Nothing was sent, so nobody should wait out a cooldown for it. The
     * release is compare-and-delete on THIS request's value, so it can never
     * remove a fence a later request set after this one expired.
     */
    expect(deleteKeyIfValue).toHaveBeenCalledTimes(1);
    expect(deleteKeyIfValue).toHaveBeenCalledWith(
      FENCE_NAMESPACE,
      USER_ID,
      claimedValue,
    );
    expect(result.nextError).toBe(SMTP_FAILURE);
    expect(result.reply).toBeNull();
    expect(
      (loggerInfo.mock.calls as Array<Array<unknown>>).some(
        (call: Array<unknown>) => {
          return call[0] === "Verification email resent";
        },
      ),
    ).toBe(false);
  });

  it("still reports the send failure when the release fails too", async () => {
    const releaseFailure: DatabaseNotConnectedException =
      new DatabaseNotConnectedException("Cache is not connected");

    sendVerificationEmail.mockRejectedValue(SMTP_FAILURE);
    deleteKeyIfValue.mockRejectedValue(releaseFailure);

    const result: InvokeResult = await resend(resendBody(resendTokenFor()));

    // Best effort: the fence simply expires on its own.
    expect(result.nextError).toBe(SMTP_FAILURE);
    expect(loggerError).toHaveBeenCalledWith(releaseFailure, {});
  });

  it("does not release anything when the send succeeds", async () => {
    await resend(resendBody(resendTokenFor()));

    expect(deleteKeyIfValue).not.toHaveBeenCalled();
  });
});

describe("what the reply and the logs never carry", () => {
  type OutcomeCase = [string, () => unknown, () => void];

  const OUTCOMES: Array<OutcomeCase> = [
    [
      "a send through a resend token",
      (): unknown => {
        return resendBody(resendTokenFor());
      },
      (): void => {
        // The defaults send.
      },
    ],
    [
      "a send through a link token",
      (): unknown => {
        return linkBody(LINK_TOKEN);
      },
      (): void => {
        // The defaults send.
      },
    ],
    [
      "a cooldown",
      (): unknown => {
        return resendBody(resendTokenFor());
      },
      (): void => {
        findEmailVerificationTokens.mockResolvedValue(history(secondsAgo(5)));
      },
    ],
    [
      "an account already verified",
      (): unknown => {
        return linkBody(LINK_TOKEN);
      },
      (): void => {
        userFindOneBy.mockResolvedValue(storedUser({ isEmailVerified: true }));
      },
    ],
  ];

  it.each(OUTCOMES)(
    "carries no token of any kind in the reply to %s, even with the e2e seam on",
    async (_label: string, body: () => unknown, setup: () => void) => {
      /*
       * /signup's test-only seam hands the e2e stack the welcome token. This
       * route has no such seam and must not grow one: whoever can read the
       * reply could then verify an address without reading its mail.
       */
      process.env[E2E_FLAG] = "true";
      setup();

      const requestBody: unknown = body();
      const result: InvokeResult = await resend(requestBody);
      const replyText: string = JSON.stringify(result.reply);

      expect(result.reply).not.toBeNull();
      expect(Object.keys(result.reply!).sort()).toEqual([
        "alreadyVerified",
        "emailSent",
        "retryAfterSeconds",
      ]);
      expect(replyText).not.toMatch(UUID_PATTERN);
      expect(replyText).not.toContain(LINK_TOKEN);
      expect(replyText).not.toContain(JSON.stringify(requestBody));
      expect(replyText).not.toContain("v1.");

      if (lastMintedVerificationToken) {
        expect(replyText).not.toContain(lastMintedVerificationToken);
      }
    },
  );

  it.each(OUTCOMES)(
    "carries no user secrets in the reply to %s",
    async (_label: string, body: () => unknown, setup: () => void) => {
      setup();

      const result: InvokeResult = await resend(body());

      expectNoUserSecrets(result.reply!);
      expect(JSON.stringify(result.reply)).not.toContain(USER_EMAIL);
    },
  );

  it("never writes the resend token, the link token or the address to a log", async () => {
    const resendToken: string = resendTokenFor();

    await resend(resendBody(resendToken));
    await resend(linkBody(LINK_TOKEN));

    // A refusal, and a failed send whose release fails too.
    await resend(resendBody(resendTokenFor({ issuedAt: hoursAgo(25) })));
    sendVerificationEmail.mockRejectedValue(new Error("SMTP down"));
    deleteKeyIfValue.mockRejectedValue(new Error("release failed"));
    await resend(resendBody(resendToken));

    const logText: string = allLogText();

    expect(logText).toContain("Verification email resent");
    expect(logText).not.toContain(resendToken);
    expect(logText).not.toContain(resendToken.split(".")[1]!);
    expect(logText).not.toContain(LINK_TOKEN);
    expect(logText).not.toContain(USER_EMAIL);
    expect(logText).not.toContain("stored-password-hash");
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE ROUND TRIP: /signup HANDS OUT THE TOKEN, AND THIS ROUTE HONOURS IT.
 *
 * Only the hosted, verify-your-email branch of /signup gets one. A self-hosted
 * signup is signed straight in, a claimed invitation has already proved its
 * mailbox, and an invitation claimed WITHOUT its token has been sent a
 * registration link instead -- none of them is waiting on a verification mail.
 * ---------------------------------------------------------------------------
 */

describe("POST /signup -> POST /resend-verification-email", () => {
  const signupBody: (miscDataProps?: Record<string, unknown>) => unknown = (
    miscDataProps?: Record<string, unknown>,
  ): unknown => {
    return {
      data: {
        email: { _type: "Email", value: USER_EMAIL },
        password: { _type: "HashedString", value: "violet river lantern" },
        name: { _type: "Name", value: "New User" },
        companyName: "Example Inc",
      },
      ...(miscDataProps ? { miscDataProps } : {}),
    };
  };

  type MiscDataFunction = () => Record<string, any>;

  const signupMiscData: MiscDataFunction = (): Record<string, any> => {
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);

    const options: Record<string, any> = (sendEntityResponse.mock
      .calls[0]![4] || {}) as Record<string, any>;

    return (options["miscData"] || {}) as Record<string, any>;
  };

  type WelcomeTokenFunction = () => string;

  const welcomeToken: WelcomeTokenFunction = (): string => {
    expect(createEmailVerificationToken).toHaveBeenCalledTimes(1);

    return (
      createEmailVerificationToken.mock.calls[0]![0] as Record<string, any>
    )["data"]["token"].toString();
  };

  beforeEach(() => {
    userFindOneBy.mockResolvedValue(null);

    userCreateUserOnSignup.mockImplementation(
      async (data: Record<string, any>): Promise<unknown> => {
        const user: User = data["user"] as User;
        user._id = USER_ID;
        return withSecretColumns(user);
      },
    );
  });

  it("hands the hosted verify-your-email page a resend token and the cooldown", async () => {
    await invoke("/signup", signupBody());

    const miscData: Record<string, any> = signupMiscData();

    expect(miscData["emailVerificationRequired"]).toBe(true);
    expect(typeof miscData["verificationEmailResendToken"]).toBe("string");
    expect(miscData["verificationEmailResendToken"]).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/,
    );
    expect(miscData["verificationEmailResendAvailableInSeconds"]).toBe(60);
  });

  it("hands out a token that names the new account and the address it signed up with", async () => {
    await invoke("/signup", signupBody());

    const claims: VerificationEmailResendTokenClaims | null =
      VerificationEmailResendToken.verify(
        signupMiscData()["verificationEmailResendToken"],
        clock,
      );

    expect(claims!.userId.toString()).toBe(USER_ID);
    expect(claims!.email.toString()).toBe(USER_EMAIL);
  });

  it("hands out a token that neither is nor contains the welcome verification token", async () => {
    await invoke("/signup", signupBody());

    const token: string = signupMiscData()["verificationEmailResendToken"];
    const welcome: string = welcomeToken();
    const decodedPayload: string = Buffer.from(
      token.split(".")[1]!,
      "base64url",
    ).toString("utf8");

    expect(token).not.toContain(welcome);
    expect(decodedPayload).not.toContain(welcome);
    expect(JSON.stringify(signupMiscData())).not.toContain(welcome);
  });

  it("mints the resend token after the welcome row is written", async () => {
    /*
     * The per-credential cap counts sends STRICTLY after issuance, so the
     * welcome row must already exist when the token is stamped -- or the
     * token would arrive one resend down.
     */
    const generate: jest.SpiedFunction<
      typeof VerificationEmailResendToken.generate
    > = jest.spyOn(VerificationEmailResendToken, "generate");

    await invoke("/signup", signupBody());

    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      createEmailVerificationToken.mock.invocationCallOrder[0]!,
    ).toBeLessThan(generate.mock.invocationCallOrder[0]!);
  });

  it("offers no resend button, but still asks for verification, when a token cannot be minted", async () => {
    jest.spyOn(VerificationEmailResendToken, "generate").mockReturnValue(null);

    await invoke("/signup", signupBody());

    const miscData: Record<string, any> = signupMiscData();

    expect(miscData["emailVerificationRequired"]).toBe(true);
    expect(miscData).not.toHaveProperty("verificationEmailResendToken");
    expect(miscData).not.toHaveProperty(
      "verificationEmailResendAvailableInSeconds",
    );
  });

  it("resolves the same account when the token is fed back to /resend-verification-email", async () => {
    await invoke("/signup", signupBody());

    const token: string = signupMiscData()["verificationEmailResendToken"];

    /*
     * From here on the account exists, and its welcome mail went out just
     * now. (Forget signup's own "is this address taken?" lookup.)
     */
    userFindOneBy.mockClear();
    userFindOneBy.mockResolvedValue(storedUser());
    findEmailVerificationTokens.mockResolvedValue(history(clock));

    const immediately: InvokeResult = await resend(resendBody(token));

    expect(firstCallArgs(userFindOneBy)["query"]["_id"].toString()).toBe(
      USER_ID,
    );

    /*
     * Pressed straight away, it is told to wait out the cooldown the signup
     * reply already announced -- the welcome mail was that send.
     */
    expectReply(immediately, {
      emailSent: false,
      alreadyVerified: false,
      retryAfterSeconds: 60,
    });
    expect(sendVerificationEmail).not.toHaveBeenCalled();

    // A minute later it sends, to the account signup created.
    clock = new Date(clock.getTime() + 61 * MS_IN_SECOND);

    const aMinuteLater: InvokeResult = await resend(resendBody(token));

    expectReply(aMinuteLater, {
      emailSent: true,
      alreadyVerified: false,
      retryAfterSeconds: 60,
    });
    expect(
      (sendVerificationEmail.mock.calls[0]![0] as User).id!.toString(),
    ).toBe(USER_ID);
  });

  it("buys exactly three resends after the welcome mail, then stops working", async () => {
    await invoke("/signup", signupBody());

    const token: string = signupMiscData()["verificationEmailResendToken"];
    const welcomeSentAt: Date = new Date(clock.getTime());

    userFindOneBy.mockResolvedValue(storedUser());

    const sent: Array<Date> = [welcomeSentAt];
    const outcomes: Array<string> = [];

    for (let attempt: number = 0; attempt < 4; attempt++) {
      clock = new Date(clock.getTime() + 2 * MS_IN_MINUTE);
      findEmailVerificationTokens.mockResolvedValue(history(...sent));

      const result: InvokeResult = await resend(resendBody(token));

      if (result.reply?.["emailSent"] === true) {
        sent.push(new Date(clock.getTime()));
        outcomes.push("sent");
      } else if (result.nextError) {
        outcomes.push((result.nextError as Exception).message);
      } else {
        outcomes.push("waiting");
      }
    }

    // One solved captcha: the welcome mail plus three -- never a fourth.
    expect(outcomes).toEqual([
      "sent",
      "sent",
      "sent",
      VERIFICATION_EMAIL_RESEND_INVALID_MESSAGE,
    ]);
    expect(sendVerificationEmail).toHaveBeenCalledTimes(3);
  });

  it("gives a self-hosted signup, which is signed straight in, no resend token", async () => {
    mockBillingEnabled = false;

    await invoke("/signup", signupBody());

    const miscData: Record<string, any> = signupMiscData();

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(miscData["emailVerificationRequired"]).toBeUndefined();
    expect(miscData).not.toHaveProperty("verificationEmailResendToken");
    expect(miscData).not.toHaveProperty(
      "verificationEmailResendAvailableInSeconds",
    );
  });

  describe("claiming an invitation", () => {
    const INVITED_USER_ID: string = "66666666-6666-4666-8666-666666666666";

    beforeEach(() => {
      userFindOneBy.mockResolvedValue({
        _id: INVITED_USER_ID,
        id: new ObjectID(INVITED_USER_ID),
        password: undefined,
      });

      userUpdateOneByIdAndFetch.mockResolvedValue({
        _id: INVITED_USER_ID,
        id: new ObjectID(INVITED_USER_ID),
        email: {
          toString: (): string => {
            return USER_EMAIL;
          },
        },
        isMasterAdmin: false,
      });
    });

    it("gives a claimed invitation, whose mailbox is already proven, no resend token", async () => {
      consumeRegistrationToken.mockResolvedValue(true);

      await invoke(
        "/signup",
        signupBody({
          registrationToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      );

      const miscData: Record<string, any> = signupMiscData();

      expect(createSession).toHaveBeenCalledTimes(1);
      expect(miscData["emailVerificationRequired"]).toBeUndefined();
      expect(miscData).not.toHaveProperty("verificationEmailResendToken");
      expect(miscData).not.toHaveProperty(
        "verificationEmailResendAvailableInSeconds",
      );
    });

    it("gives an invitation claimed without its token -- sent a registration link instead -- no resend token", async () => {
      consumeRegistrationToken.mockResolvedValue(false);

      await invoke("/signup", signupBody());

      const miscData: Record<string, any> = signupMiscData();

      expect(sendCompleteRegistrationEmail).toHaveBeenCalledTimes(1);
      expect(createSession).not.toHaveBeenCalled();
      expect(miscData["registrationEmailSent"]).toBe(true);
      expect(miscData).not.toHaveProperty("verificationEmailResendToken");
      expect(miscData).not.toHaveProperty(
        "verificationEmailResendAvailableInSeconds",
      );
    });
  });
});
