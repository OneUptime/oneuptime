import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
} from "Common/Server/Middleware/IdentityRateLimit";
import UserService from "Common/Server/Services/UserService";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * ---------------------------------------------------------------------------
 * IdentityRateLimitBucket.BackupCode -- the counter POST /verify-backup-code
 * sits on, exercised through the real router with the real middleware in front
 * of the real handler.
 *
 * WHY THE RECOVERY ROUTE CANNOT SHARE THE SECOND-STEP COUNTER
 *
 * Everybody who arrives at /verify-backup-code has ALREADY failed at the
 * factor they normally use. That is the entire premise of the route: the
 * phone is gone, the security key is in a taxi, or -- the case that made this
 * a bug rather than a theory -- the authenticator app is showing codes from a
 * drifted clock, which fails every single time no matter how carefully they
 * retype it.
 *
 * While /verify-backup-code shared IdentityRateLimitBucket.TwoFactor, that
 * user spent all ten of the second-step attempts proving their app was
 * useless, and then the one route that could still have let them in answered
 * "Too many sign-in attempts" before it ever looked at the code in their hand.
 * The limiter inverted its own purpose: it locked the door that exists
 * because the other door is locked. A recovery path must not be spendable by
 * failures on the path it recovers from.
 *
 * The route is still counted, on its own budget, because it re-verifies the
 * email and password ahead of the code exactly like its siblings and is
 * therefore a password oracle in its own right. What the limiter is NOT doing
 * here is guarding the codes themselves -- ten characters over a 32 symbol
 * alphabet is 2^50, so guessing is bounded by the code space by roughly ten
 * orders of magnitude more than by any counter.
 *
 * WHAT THIS FILE PINS THAT AN ENUM-VALUE ASSERTION WOULD NOT
 *
 * A new enum member and a new config constant can be added, look completely
 * correct in a diff, and still leave the two routes sharing one counter --
 * the middleware could be built for the wrong bucket, or getBucketConfig
 * could fall through and hand the new bucket the login budget. So the
 * assertions below are made against the Redis keys the middleware actually
 * builds and against whether a request survives a spent sibling budget, not
 * against the name of the bucket that was passed somewhere.
 *
 * Redis is faked rather than mocked per-assertion: INCR really increments,
 * and every key it is asked for is recorded, so "which counter did this
 * request spend" is answered by the middleware's own arithmetic instead of
 * being restated by the test. Everything else the handler reaches (sessions,
 * cookies, mail, tokens) is mocked, because none of it is under test.
 *
 * SIBLINGS, SO NOTHING HERE IS DUPLICATED
 *
 *  - IdentityRateLimit.test.ts owns the shared limiter behaviour: window
 *    arithmetic, email-shape and address key derivation, and the budgets on
 *    /login and the second-step routes.
 *  - BackupCodeLoginVerification.test.ts owns what the handler does once the
 *    limiter has let a request through.
 * ---------------------------------------------------------------------------
 */

interface RecordedExpire {
  key: string;
  ttlSeconds: number;
}

class FakeRedisClient {
  public counters: Map<string, number> = new Map();
  public expires: Array<RecordedExpire> = [];

  /*
   * Every key INCR was asked for, in order. This is the whole instrument: a
   * request that lands on the wrong bucket says so here, in the key, whatever
   * the enum in the source says.
   */
  public incrementedKeys: Array<string> = [];

  /* Set to make the next exec() reject, for the error-path test. */
  public failNextExec: Error | null = null;

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
  }

  public reset(): void {
    this.counters.clear();
    this.expires = [];
    this.incrementedKeys = [];
    this.failNextExec = null;
  }
}

type QueuedCommand = () => [Error | null, unknown];

class FakePipeline {
  private commands: Array<QueuedCommand> = [];

  public constructor(private client: FakeRedisClient) {}

  public incr(key: string): FakePipeline {
    this.commands.push((): [Error | null, unknown] => {
      const next: number = (this.client.counters.get(key) || 0) + 1;
      this.client.counters.set(key, next);
      this.client.incrementedKeys.push(key);
      return [null, next];
    });

    return this;
  }

  public expire(key: string, ttlSeconds: number): FakePipeline {
    this.commands.push((): [Error | null, unknown] => {
      this.client.expires.push({ key, ttlSeconds });
      return [null, 1];
    });

    return this;
  }

  public async exec(): Promise<unknown> {
    if (this.client.failNextExec) {
      const error: Error = this.client.failNextExec;
      this.client.failNextExec = null;
      throw error;
    }

    return this.commands.map((command: QueuedCommand) => {
      return command();
    });
  }
}

const redisClient: FakeRedisClient = new FakeRedisClient();
let isRedisConnected: boolean = true;

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return isRedisConnected ? redisClient : null;
      },
      isConnected: (): boolean => {
        return isRedisConnected;
      },
    },
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

jest.mock("Common/Server/Services/UserTotpAuthService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Array<unknown> => {
        return [];
      },
      findOneBy: (): unknown => {
        return null;
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

/*
 * Mocked for the same reason BackupCodeLoginVerification.test.ts mocks it: the
 * credential arithmetic needs a database to mean anything, and none of it is
 * reached in this file -- every request here is stopped either by the limiter
 * or by the "no such account" refusal at the end of login().
 */
jest.mock("Common/Server/Services/UserTwoFactorBackupCodeService", () => {
  return {
    __esModule: true,
    default: {
      consumeCode: jest.fn(),
      countUnusedForUser: jest.fn(),
      generateForUserIfNone: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: jest.fn(),
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

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: { sendVerificationEmail: jest.fn() },
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
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

// Importing the router registers every handler, and every middleware, above.
import "../../../FeatureSet/Identity/API/Authentication";

/* The shipped defaults, restated so a change to any of them has to be deliberate. */
const DEFAULT_WINDOW_SECONDS: number = 15 * 60;
const DEFAULT_PER_ACCOUNT_LIMIT: number = 10;
const DEFAULT_PER_IP_LIMIT: number = 150;

const BACKUP_CODE_URI: string = "/verify-backup-code";
const TWO_FACTOR_URIS: Array<string> = [
  "/verify-totp-auth",
  "/verify-webauthn-auth",
  "/verify-totp-enrolment",
];

/*
 * The bucket names as they appear inside a counter key. Written out rather
 * than read off the enum on purpose: these strings are persisted in Redis, so
 * renaming one silently hands every caller a fresh budget mid-window, and the
 * test that would notice cannot be reading the same constant the code does.
 */
const BACKUP_CODE_KEY_SEGMENT: string = "identity:rl:backup-code:";
const TWO_FACTOR_KEY_SEGMENT: string = "identity:rl:two-factor:";

const PASSWORD: string = "correct horse battery staple";
const USER_EMAIL: string = "locked.out@example.com";

/* The address our own Nginx appends. Everything below is billed to it. */
const REAL_CLIENT_IP: string = "203.0.113.9";

type AttemptOptions = {
  uri?: string;
  email?: string;

  /*
   * Run only the FIRST registered handler instead of the whole chain. This is
   * how the "the limiter is in front, not behind" tests tell a route whose
   * first handler refuses from one that merely happens to refuse somewhere.
   */
  firstHandlerOnly?: boolean;
};

type AttemptResult = {
  reachedHandler: boolean;
  calledNext: boolean;
  errorCode: ExceptionCode | undefined;
  errorMessage: string | undefined;
  retryAfter: string | undefined;
};

/*
 * One request through the WHOLE registered chain -- limiter first, handler
 * last -- which is the only arrangement that can tell a wired-up limiter from
 * an unwired one. `next` is what Express would call between handlers, so a
 * limiter that refuses simply never calls it and the handler never runs.
 */
type AttemptFunction = (options?: AttemptOptions) => Promise<AttemptResult>;

const attempt: AttemptFunction = async (
  options: AttemptOptions = {},
): Promise<AttemptResult> => {
  const uri: string = options.uri || BACKUP_CODE_URI;

  const allHandlers: Array<RouteHandler> = mockRouter.matchAll("post", uri);

  const handlers: Array<RouteHandler> = options.firstHandlerOnly
    ? allHandlers.slice(0, 1)
    : allHandlers;

  const req: ExpressRequest = buildRequest(
    {
      data: {
        email: options.email === undefined ? USER_EMAIL : options.email,
        password: { _type: "HashedString", value: PASSWORD },
        backupCode: "AAAAA-BBBBB",
      },
    },
    {
      headers: { "x-forwarded-for": REAL_CLIENT_IP },
      socketAddress: REAL_CLIENT_IP,
    },
  );

  const headers: Record<string, string> = {};

  const res: ExpressResponse = {
    ...buildResponse(),
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as ExpressResponse;

  /*
   * Only the refusals produced by THIS request are read back. Reading the
   * mock's last call outright would let a refusal from an earlier attempt in
   * the same test stand in for one that never happened here.
   */
  const callsBefore: number = sendErrorResponse.mock.calls.length;

  let reachedHandler: boolean = false;
  let calledNext: boolean = false;

  for (let index: number = 0; index < handlers.length; index++) {
    const handler: RouteHandler = handlers[index] as RouteHandler;

    let continued: boolean = false;

    const next: NextFunction = ((): void => {
      continued = true;
    }) as unknown as NextFunction;

    if (index === allHandlers.length - 1) {
      reachedHandler = true;
    }

    await handler(req, res, next);

    if (!continued) {
      break;
    }

    calledNext = true;
  }

  const call: Array<unknown> | undefined = sendErrorResponse.mock.calls[
    sendErrorResponse.mock.calls.length - 1
  ] as Array<unknown> | undefined;

  const error: Exception | undefined =
    sendErrorResponse.mock.calls.length > callsBefore
      ? (call?.[2] as Exception | undefined)
      : undefined;

  return {
    reachedHandler,
    calledNext,
    errorCode: error?.code,
    errorMessage: error?.message,
    retryAfter: headers["Retry-After"],
  };
};

/* The keys a single attempt on `uri` asked Redis to increment. */
type KeysSpentFunction = (uri: string) => Promise<Array<string>>;

const keysSpentBy: KeysSpentFunction = async (
  uri: string,
): Promise<Array<string>> => {
  redisClient.incrementedKeys = [];

  await attempt({ uri: uri });

  return [...redisClient.incrementedKeys];
};

let findOneBy: jest.SpiedFunction<typeof UserService.findOneBy>;

beforeEach(() => {
  jest.clearAllMocks();

  redisClient.reset();
  isRedisConnected = true;

  /*
   * The handler's first database read, and the bcrypt verify sits right
   * behind it. Whether this ran is how the tests below decide if a request
   * got past the limiter or was stopped in front of it.
   */
  findOneBy = jest
    .spyOn(UserService, "findOneBy")
    .mockResolvedValue(null as never);

  jest.spyOn(UserService, "updateOneById").mockResolvedValue(1 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which counter each route spends", () => {
  /*
   * The bucket a middleware was BUILT for is invisible from the outside --
   * `getMiddleware(TwoFactor)` and `getMiddleware(BackupCode)` are the same
   * shape of function. The Redis key is where the choice becomes observable,
   * so that is what is asserted: a route wired to the wrong bucket writes the
   * wrong key here and nothing else in the diff has to change for it.
   */
  it("POST /verify-backup-code spends the backup-code counter", async () => {
    const keys: Array<string> = await keysSpentBy(BACKUP_CODE_URI);

    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      expect(key.startsWith(BACKUP_CODE_KEY_SEGMENT)).toBe(true);
      expect(key).not.toContain(TWO_FACTOR_KEY_SEGMENT);
    }
  });

  /*
   * The other half of the move. Giving the recovery route its own bucket is
   * worth nothing if one of the three routes it is being separated FROM went
   * along with it -- /verify-webauthn-auth and /verify-totp-enrolment are the
   * easy ones to drag across, because they sit next to each other in the file
   * and share a limiter constant.
   */
  it.each(TWO_FACTOR_URIS)(
    "POST %s still spends the two-factor counter",
    async (uri: string) => {
      const keys: Array<string> = await keysSpentBy(uri);

      expect(keys.length).toBeGreaterThan(0);

      for (const key of keys) {
        expect(key.startsWith(TWO_FACTOR_KEY_SEGMENT)).toBe(true);
        expect(key).not.toContain(BACKUP_CODE_KEY_SEGMENT);
      }
    },
  );

  /*
   * Same person, same address, same instant -- and the keys must still not
   * collide, because a shared key IS a shared budget however the buckets are
   * named.
   *
   * The second assertion is the one with teeth. Substituting the bucket
   * segment turns one set of keys into the other EXACTLY, which proves the
   * separation comes from the bucket alone: the account segment, the address
   * segment and the window index are identical, so this cannot pass by
   * accident of a differently-derived key that happens to differ today and
   * collides tomorrow.
   */
  it("keys one account and one address differently for the two buckets", async () => {
    const fixedNow: number = Date.parse("2026-01-01T00:07:00.000Z");

    jest.spyOn(Date, "now").mockImplementation((): number => {
      return fixedNow;
    });

    const twoFactorKeys: Array<string> = await keysSpentBy("/verify-totp-auth");
    const backupCodeKeys: Array<string> = await keysSpentBy(BACKUP_CODE_URI);

    /* One account counter and one address counter, per request. */
    expect(backupCodeKeys).toHaveLength(2);
    expect(twoFactorKeys).toHaveLength(2);

    const shared: Array<string> = backupCodeKeys.filter((key: string) => {
      return twoFactorKeys.includes(key);
    });

    expect(shared).toEqual([]);

    const rebucketed: Array<string> = backupCodeKeys.map((key: string) => {
      return key.replace("backup-code", "two-factor");
    });

    expect(rebucketed).toEqual(twoFactorKeys);

    /* And the keys really are built from this caller, not from a constant. */
    expect(backupCodeKeys[0]).toContain(USER_EMAIL);
    expect(backupCodeKeys[0]).toContain(REAL_CLIENT_IP);
    expect(backupCodeKeys[1]).toContain(REAL_CLIENT_IP);
  });
});

describe("neither budget can be spent by the other", () => {
  /*
   * THE BUG, stated as a test.
   *
   * A user whose authenticator app has drifted out of the +/- 90 second
   * window fails /verify-totp-auth every time, so ten failures is what a
   * genuine locked-out user LOOKS like -- not an attack, the normal way into
   * this route. On the shared counter their eleventh request, the first one
   * carrying a backup code that would actually have worked, was refused
   * before the handler read it.
   */
  it("leaves the recovery route servable after the second-step budget is spent", async () => {
    for (let i: number = 0; i < DEFAULT_PER_ACCOUNT_LIMIT; i++) {
      const allowed: AttemptResult = await attempt({
        uri: "/verify-totp-auth",
      });

      expect(allowed.reachedHandler).toBe(true);
    }

    const refusedSecondStep: AttemptResult = await attempt({
      uri: "/verify-totp-auth",
    });

    expect(refusedSecondStep.reachedHandler).toBe(false);
    expect(refusedSecondStep.errorCode).toBe(
      ExceptionCode.TooManyRequestsException,
    );

    findOneBy.mockClear();

    const recovery: AttemptResult = await attempt({ uri: BACKUP_CODE_URI });

    expect(recovery.reachedHandler).toBe(true);
    expect(findOneBy).toHaveBeenCalled();
  });

  /*
   * The mirror image, which matters for a different reason: a user who is
   * fumbling printed codes must not be locked out of the authenticator app
   * they may still be able to reach, and an attacker must not be able to use
   * cheap noise on the recovery route to close the ordinary second step.
   */
  it("leaves the second step servable after the recovery budget is spent", async () => {
    for (let i: number = 0; i < DEFAULT_PER_ACCOUNT_LIMIT; i++) {
      const allowed: AttemptResult = await attempt({ uri: BACKUP_CODE_URI });

      expect(allowed.reachedHandler).toBe(true);
    }

    const refusedRecovery: AttemptResult = await attempt({
      uri: BACKUP_CODE_URI,
    });

    expect(refusedRecovery.reachedHandler).toBe(false);

    const secondStep: AttemptResult = await attempt({
      uri: "/verify-totp-auth",
    });

    expect(secondStep.reachedHandler).toBe(true);
  });

  /*
   * A separate bucket is not an unlimited one. The route re-submits the email
   * and password and runs the same verifyHashedColumnValue as its siblings
   * before it looks at the code, so an unbounded one would be a password
   * oracle -- and the one an attacker refused at /login and at
   * /verify-totp-auth would move to next.
   */
  it("still bounds attempts aimed at the recovery route itself", async () => {
    for (let i: number = 0; i < DEFAULT_PER_ACCOUNT_LIMIT; i++) {
      await attempt();
    }

    const refused: AttemptResult = await attempt();

    expect(refused.reachedHandler).toBe(false);
    expect(refused.errorCode).toBe(ExceptionCode.TooManyRequestsException);
    expect(Number(refused.retryAfter)).toBeGreaterThan(0);
    expect(Number(refused.retryAfter)).toBeLessThanOrEqual(
      DEFAULT_WINDOW_SECONDS,
    );
  });

  it("refuses the spent attempt before the password check runs", async () => {
    for (let i: number = 0; i < DEFAULT_PER_ACCOUNT_LIMIT; i++) {
      await attempt();
    }

    findOneBy.mockClear();

    await attempt();

    expect(findOneBy).not.toHaveBeenCalled();
  });
});

describe("the limiter is the first handler on the route", () => {
  /*
   * Registration ORDER is the property, not registration. A limiter behind
   * the handler counts attempts it has already served, which on a route that
   * verifies a password is not a limit but a receipt.
   *
   * Running handler[0] on its own is what separates the two: if the counter
   * is spent by that call alone, the middleware is genuinely in front.
   */
  it("counts the attempt from the first handler alone", async () => {
    expect(mockRouter.matchAll("post", BACKUP_CODE_URI).length).toBeGreaterThan(
      1,
    );

    const result: AttemptResult = await attempt({ firstHandlerOnly: true });

    expect(result.calledNext).toBe(true);
    expect(findOneBy).not.toHaveBeenCalled();

    expect(redisClient.incrementedKeys.length).toBeGreaterThan(0);

    for (const key of redisClient.incrementedKeys) {
      expect(key.startsWith(BACKUP_CODE_KEY_SEGMENT)).toBe(true);
    }
  });

  /*
   * And the refusal comes from that same first handler: it stops calling
   * next, so nothing behind it -- the user lookup, the bcrypt verify -- ever
   * runs, and a flood costs us no CPU it can also time.
   */
  it("refuses from the first handler once the budget is spent", async () => {
    for (let i: number = 0; i < DEFAULT_PER_ACCOUNT_LIMIT; i++) {
      await attempt({ firstHandlerOnly: true });
    }

    const refused: AttemptResult = await attempt({ firstHandlerOnly: true });

    expect(refused.calledNext).toBe(false);
    expect(refused.errorCode).toBe(ExceptionCode.TooManyRequestsException);
  });
});

/*
 * The budgets are read from the environment once, at module load, so these
 * reload the module rather than calling into the already-configured one.
 */
describe("the backup-code bucket configuration", () => {
  type BucketConfigShape = {
    windowSeconds: number;
    perAccountLimit: number;
    perIpLimit: number;
  };

  type ReloadedConfigs = {
    login: BucketConfigShape;
    twoFactor: BucketConfigShape;
    backupCode: BucketConfigShape;
  };

  interface IdentityRateLimitModule {
    default: {
      getBucketConfig: (bucket: IdentityRateLimitBucket) => BucketConfigShape;
    };
  }

  const ENV_KEYS: Array<string> = [
    "IDENTITY_LOGIN_RATE_LIMIT_WINDOW_SECONDS",
    "IDENTITY_LOGIN_RATE_LIMIT_PER_ACCOUNT_PER_WINDOW",
    "IDENTITY_LOGIN_RATE_LIMIT_PER_IP_PER_WINDOW",
    "IDENTITY_TWO_FACTOR_RATE_LIMIT_WINDOW_SECONDS",
    "IDENTITY_TWO_FACTOR_RATE_LIMIT_PER_ACCOUNT_PER_WINDOW",
    "IDENTITY_TWO_FACTOR_RATE_LIMIT_PER_IP_PER_WINDOW",
    "IDENTITY_BACKUP_CODE_RATE_LIMIT_WINDOW_SECONDS",
    "IDENTITY_BACKUP_CODE_RATE_LIMIT_PER_ACCOUNT_PER_WINDOW",
    "IDENTITY_BACKUP_CODE_RATE_LIMIT_PER_IP_PER_WINDOW",
  ];

  type ConfigsUnderEnvFunction = (
    env: Record<string, string>,
  ) => ReloadedConfigs;

  const configsUnderEnv: ConfigsUnderEnvFunction = (
    env: Record<string, string>,
  ): ReloadedConfigs => {
    const previous: Record<string, string | undefined> = {};

    for (const key of ENV_KEYS) {
      previous[key] = process.env[key];

      const configured: string | undefined = env[key];

      if (configured === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = configured;
      }
    }

    let configs: ReloadedConfigs | null = null;

    try {
      jest.isolateModules((): void => {
        /*
         * A fresh require is the point: the three bucket constants are
         * captured from the environment once, at module load, so a static
         * import would only ever report whatever the test process started
         * with.
         */
        /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const freshModule: IdentityRateLimitModule = require("Common/Server/Middleware/IdentityRateLimit");
        /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

        configs = {
          login: freshModule.default.getBucketConfig(
            IdentityRateLimitBucket.Login,
          ),
          twoFactor: freshModule.default.getBucketConfig(
            IdentityRateLimitBucket.TwoFactor,
          ),
          backupCode: freshModule.default.getBucketConfig(
            IdentityRateLimitBucket.BackupCode,
          ),
        };
      });
    } finally {
      for (const key of ENV_KEYS) {
        const restored: string | undefined = previous[key];

        if (restored === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = restored;
        }
      }
    }

    if (!configs) {
      throw new Error("The reloaded module produced no bucket configuration");
    }

    return configs;
  };

  /*
   * getBucketConfig ends in an unconditional `return LOGIN_BUCKET`, so a
   * bucket it does not name explicitly is handed the PASSWORD budget rather
   * than erroring. Under the shipped defaults all three budgets carry the
   * same three numbers, so that fallthrough is invisible to any assertion
   * made on values -- distinct configured numbers are what make it visible.
   */
  it("hands each bucket its own configured budget rather than falling through", () => {
    const configs: ReloadedConfigs = configsUnderEnv({
      IDENTITY_LOGIN_RATE_LIMIT_WINDOW_SECONDS: "111",
      IDENTITY_LOGIN_RATE_LIMIT_PER_ACCOUNT_PER_WINDOW: "11",
      IDENTITY_LOGIN_RATE_LIMIT_PER_IP_PER_WINDOW: "1111",
      IDENTITY_TWO_FACTOR_RATE_LIMIT_WINDOW_SECONDS: "222",
      IDENTITY_TWO_FACTOR_RATE_LIMIT_PER_ACCOUNT_PER_WINDOW: "22",
      IDENTITY_TWO_FACTOR_RATE_LIMIT_PER_IP_PER_WINDOW: "2222",
      IDENTITY_BACKUP_CODE_RATE_LIMIT_WINDOW_SECONDS: "333",
      IDENTITY_BACKUP_CODE_RATE_LIMIT_PER_ACCOUNT_PER_WINDOW: "33",
      IDENTITY_BACKUP_CODE_RATE_LIMIT_PER_IP_PER_WINDOW: "3333",
    });

    expect(configs.backupCode).toEqual({
      windowSeconds: 333,
      perAccountLimit: 33,
      perIpLimit: 3333,
    });

    expect(configs.twoFactor).toEqual({
      windowSeconds: 222,
      perAccountLimit: 22,
      perIpLimit: 2222,
    });

    expect(configs.login).toEqual({
      windowSeconds: 111,
      perAccountLimit: 11,
      perIpLimit: 1111,
    });
  });

  /*
   * The documented defaults, which are what a self-hosted instance that
   * configures nothing actually runs on. Fifteen minutes, ten attempts for
   * one account from one address, a hundred and fifty for the address itself
   * so that an office behind one NAT is not refused as a group.
   */
  it("falls back to the documented defaults when nothing is configured", () => {
    const configs: ReloadedConfigs = configsUnderEnv({});

    expect(configs.backupCode).toEqual({
      windowSeconds: DEFAULT_WINDOW_SECONDS,
      perAccountLimit: DEFAULT_PER_ACCOUNT_LIMIT,
      perIpLimit: DEFAULT_PER_IP_LIMIT,
    });
  });

  /*
   * Under the defaults the three configs are indistinguishable by value, so
   * this is the assertion that still catches a fallthrough there: the object
   * handed back for the recovery bucket must not be the LOGIN one. If it
   * were, setting IDENTITY_BACKUP_CODE_* would silently do nothing on a
   * production instance and the recovery route would share the password
   * budget instead -- the same class of bug this change fixed, one bucket
   * over.
   */
  it("does not hand the recovery bucket the login or two-factor config object", () => {
    const backupCodeConfig: ReturnType<
      typeof IdentityRateLimit.getBucketConfig
    > = IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.BackupCode);

    expect(backupCodeConfig).not.toBe(
      IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.Login),
    );

    expect(backupCodeConfig).not.toBe(
      IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.TwoFactor),
    );

    expect(
      IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.TwoFactor),
    ).not.toBe(
      IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.Login),
    );

    /* And the same bucket keeps answering with the same config. */
    expect(backupCodeConfig).toBe(
      IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.BackupCode),
    );
  });
});

describe("when Redis is unreachable", () => {
  /*
   * Fails CLOSED, exactly like its siblings, and the new bucket must not have
   * quietly acquired the opposite disposition. Nothing in Postgres counts
   * attempts, so serving this route without the counter serves the password
   * oracle the middleware exists to close -- and it costs no availability
   * that was not already lost, because a completed login writes the user's
   * permissions to the same Redis through GlobalCache.
   */
  it("refuses the recovery attempt rather than serving it unthrottled", async () => {
    isRedisConnected = false;

    const result: AttemptResult = await attempt();

    expect(result.reachedHandler).toBe(false);
    expect(result.errorCode).toBe(ExceptionCode.ServiceUnavailableException);
    expect(findOneBy).not.toHaveBeenCalled();
  });

  it("refuses when the counter errors mid-pipeline too", async () => {
    redisClient.failNextExec = new Error("READONLY: cannot write to replica");

    const result: AttemptResult = await attempt();

    expect(result.reachedHandler).toBe(false);
    expect(result.errorCode).toBe(ExceptionCode.ServiceUnavailableException);
  });

  it("resumes serving the recovery route once Redis comes back", async () => {
    isRedisConnected = false;
    expect((await attempt()).reachedHandler).toBe(false);

    isRedisConnected = true;

    const result: AttemptResult = await attempt();

    expect(result.reachedHandler).toBe(true);
    expect(redisClient.incrementedKeys.length).toBeGreaterThan(0);
  });
});
