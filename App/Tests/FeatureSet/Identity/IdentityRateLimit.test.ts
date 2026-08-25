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
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * ---------------------------------------------------------------------------
 * Attempt limiting on the anonymous credential routes — POST /login,
 * POST /verify-totp-auth, POST /verify-webauthn-auth and
 * POST /verify-totp-enrolment — exercised through the real routers with the
 * real middleware in front of the real handler.
 *
 * WHAT THESE TESTS ARE ACTUALLY PINNING
 *
 * Not "does a counter count". The properties that decide whether the limit
 * can be walked around at all, each of which is a way the limiter could look
 * present in a diff and be worth nothing:
 *
 *   - it runs BEFORE the handler, so a refused attempt never reaches the user
 *     lookup or the bcrypt verify;
 *   - rotating the email address in the body does not buy a fresh bucket;
 *   - changing the CASE of the email address does not either;
 *   - nor does switching between the two wire SHAPES an email arrives in,
 *     and -- the other half of that same coin -- two different accounts are
 *     not silently collapsed onto one shared counter;
 *   - a caller-supplied X-Forwarded-For entry does not buy a fresh bucket;
 *   - the window does not slide forward under sustained load, which would
 *     turn a fifteen minute pause into a permanent lockout;
 *   - it fails CLOSED, so a Redis outage does not quietly restore the
 *     unlimited guessing oracle it exists to close.
 *
 * The /verify-totp-auth case is the one that matters most. It is reached with
 * a valid password already accepted, so the only thing left is a six digit
 * code, and TotpAuth accepts fourteen of the 10^6 of them at any instant
 * (TotpValidationWindow = 3 steps either side of now, across both entries in
 * SupportedTotpAlgorithms). Unbounded, that is a second factor bypassed in
 * minutes.
 *
 * Redis is faked rather than mocked per-assertion: INCR really increments and
 * EXPIRE really records a TTL, so the window and reset tests exercise the
 * limiter's arithmetic instead of restating it. Everything else the handlers
 * reach (sessions, cookies, mail, tokens) is mocked, because none of it is
 * what is under test.
 * ---------------------------------------------------------------------------
 */

interface RecordedExpire {
  key: string;
  ttlSeconds: number;
}

class FakeRedisClient {
  public counters: Map<string, number> = new Map();
  public expires: Array<RecordedExpire> = [];

  /* Set to make the next exec() reject, for the error-path test. */
  public failNextExec: Error | null = null;

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
  }

  public reset(): void {
    this.counters.clear();
    this.expires = [];
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

const verifyWebAuthnAuthentication: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Array<unknown> => {
        return [];
      },
      verifyAuthentication: (...args: Array<unknown>): unknown => {
        return verifyWebAuthnAuthentication(...args);
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

/* The shipped defaults, restated so a change to either has to be deliberate. */
const WINDOW_SECONDS: number = 15 * 60;
const PER_ACCOUNT_LIMIT: number = 10;
const PER_IP_LIMIT: number = 150;

const PASSWORD: string = "correct horse battery staple";
const USER_EMAIL: string = "totp.user@example.com";
const TOTP_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

/* The address our own Nginx appends. Everything below is billed to it. */
const REAL_CLIENT_IP: string = "203.0.113.9";

type AttemptOptions = {
  uri?: string;
  email?: string;

  /*
   * Which wire shape to send `email` in. Both are first-party and both reach
   * the routes limited here: the dashboard's /login serializes the User model
   * through ModelAPI, and the mobile app hand-builds the same envelope, so
   * "object" is what POST /login actually receives in production -- hence the
   * default. The dashboard's second-step calls spread raw form values instead,
   * so those send "string". See resolveAccountKey for the full account.
   */
  emailShape?: "string" | "object";
  code?: string;
  headers?: Record<string, string | Array<string>>;
  socketAddress?: string;
};

type AttemptResult = {
  reachedHandler: boolean;
  errorCode: ExceptionCode | undefined;
  errorMessage: string | undefined;
  retryAfter: string | undefined;
};

/*
 * One request through the WHOLE registered chain — limiter first, handler
 * last — which is the only arrangement that can tell a wired-up limiter from
 * an unwired one. `next` is what Express would call between handlers, so a
 * limiter that refuses simply never calls it and the handler never runs.
 */
type AttemptFunction = (options?: AttemptOptions) => Promise<AttemptResult>;

const attempt: AttemptFunction = async (
  options: AttemptOptions = {},
): Promise<AttemptResult> => {
  const uri: string = options.uri || "/verify-totp-auth";

  const handlers: Array<RouteHandler> = mockRouter.matchAll("post", uri);

  const emailValue: string =
    options.email === undefined ? USER_EMAIL : options.email;

  const emailField: unknown =
    options.emailShape === "string"
      ? emailValue
      : { _type: "Email", value: emailValue };

  const req: ExpressRequest = buildRequest(
    {
      data: {
        email: emailField,
        password: { _type: "HashedString", value: PASSWORD },
        code: options.code === undefined ? "000000" : options.code,
        twoFactorAuthId: TOTP_ID.toString(),
      },
    },
    {
      headers: options.headers || { "x-forwarded-for": REAL_CLIENT_IP },
      socketAddress: options.socketAddress || REAL_CLIENT_IP,
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

  for (let index: number = 0; index < handlers.length; index++) {
    const handler: RouteHandler = handlers[index] as RouteHandler;

    let continued: boolean = false;

    const next: NextFunction = ((): void => {
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

  const call: Array<unknown> | undefined = sendErrorResponse.mock.calls[
    sendErrorResponse.mock.calls.length - 1
  ] as Array<unknown> | undefined;

  const error: Exception | undefined = call?.[2] as Exception | undefined;

  return {
    reachedHandler,
    errorCode: error?.code,
    errorMessage: error?.message,
    retryAfter: headers["Retry-After"],
  };
};

/*
 * An account with 2FA switched on, stored the way Postgres would hand it back.
 */
type StoredUserFunction = () => Promise<User>;

const storedUser: StoredUserFunction = async (): Promise<User> => {
  const salt: string = PasswordHash.generateSalt();

  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.email = new Email(USER_EMAIL);
  user.isEmailVerified = true;
  user.isMasterAdmin = false;
  user.enableTwoFactorAuth = true;
  user.passwordSalt = salt;
  user.password = new HashedString(
    await PasswordHash.hash({ plainValue: PASSWORD, salt: salt }),
    true,
  );

  return user;
};

type EnrolmentFunction = () => { row: UserTotpAuth; code: () => string };

const enrolment: EnrolmentFunction = () => {
  const secret: string = TotpAuth.generateSecret();

  const otpUrl: string = buildOtpauthUri({
    secret: secret,
    label: USER_EMAIL,
    algorithm: "SHA1",
  });

  const row: UserTotpAuth = new UserTotpAuth();
  row.id = TOTP_ID;
  row.twoFactorSecret = secret;
  row.twoFactorOtpUrl = otpUrl;
  row.isVerified = true;

  return {
    row: row,
    code: (): string => {
      return conformingAppCode(otpUrl);
    },
  };
};

let findOneBy: jest.SpiedFunction<typeof UserService.findOneBy>;

beforeEach(() => {
  jest.clearAllMocks();

  redisClient.reset();
  isRedisConnected = true;

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  } as never);

  totpFindBy.mockResolvedValue([] as never);
  totpFindOneBy.mockResolvedValue(null as never);

  /*
   * The handler's first database read. Whether this ran is how every test
   * below decides if the request got past the limiter.
   */
  findOneBy = jest
    .spyOn(UserService, "findOneBy")
    .mockResolvedValue(null as never);

  jest.spyOn(UserService, "updateOneById").mockResolvedValue(1 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the credential routes have a limiter in front of the handler", () => {
  /*
   * Registration order is the whole point. A limiter behind the handler would
   * count attempts it had already served, which is not a limit.
   */
  it.each([
    ["/login"],
    ["/verify-totp-auth"],
    ["/verify-webauthn-auth"],
    ["/verify-totp-enrolment"],
    ["/verify-backup-code"],
  ])("%s runs middleware before its handler", (uri: string) => {
    expect(mockRouter.matchAll("post", uri).length).toBeGreaterThan(1);
  });

  /*
   * WHY THIS IS AN EXCLUSION LIST AND NOT AN INCLUSION LIST.
   *
   * The obvious way to write this test is to enumerate the credential routes
   * and check each one has a limiter. That version existed here, and it could
   * not do its own job: it FILTERED the registered routes through the very
   * list it then asserted against, so a route absent from the list was absent
   * from both sides and matched. /verify-backup-code was added to
   * Authentication.ts and this test -- whose stated purpose was that "it must
   * not be possible to add a fifth credential route and have it quietly go
   * uncounted" -- stayed green.
   *
   * So the default is inverted. Every POST on this router is treated as a
   * credential route unless it is named below, which means a new one fails
   * this test on the day it is added. The author then has to make a choice in
   * writing: attach a limiter, or state here why the route accepts no
   * credential. Both are fine; silence is not.
   *
   * The routes listed below take no password and no second factor. They are
   * not unlimited in any dangerous sense -- /signup and /forgot-password sit
   * behind the captcha, /verify-email, /reset-password and /refresh-token
   * carry a server-minted single-use token, and /logout revokes rather than
   * grants -- but none of them is a guessing oracle against a stored
   * credential, which is what IdentityRateLimit exists to bound.
   */
  const ROUTES_THAT_ACCEPT_NO_CREDENTIAL: Array<string> = [
    "/signup",
    "/forgot-password",
    "/verify-email",
    "/reset-password",
    "/refresh-token",
    "/logout",
  ];

  it("leaves no POST route on this router unlimited by accident", () => {
    const unlimitedCredentialRoutes: Array<string> = mockRouter.routes
      .filter(
        (route: { method: string; uri: string; handlers: Array<unknown> }) => {
          return (
            route.method === "POST" &&
            !ROUTES_THAT_ACCEPT_NO_CREDENTIAL.includes(route.uri) &&
            route.handlers.length < 2
          );
        },
      )
      .map((route: { uri: string }) => {
        return route.uri;
      });

    expect(unlimitedCredentialRoutes.sort()).toEqual([]);
  });

  /*
   * The guard above is only as good as its knowledge that routes exist at all.
   * If the router were captured empty -- a refactor that moves these handlers
   * elsewhere, a mock that stops recording -- every filter above would run
   * over nothing and pass. Pin the floor.
   */
  it("actually saw the router's routes", () => {
    const postRoutes: Array<string> = mockRouter.routes
      .filter((route: { method: string }) => {
        return route.method === "POST";
      })
      .map((route: { uri: string }) => {
        return route.uri;
      });

    expect(postRoutes).toContain("/login");
    expect(postRoutes).toContain("/verify-backup-code");
    expect(postRoutes.length).toBeGreaterThanOrEqual(
      ROUTES_THAT_ACCEPT_NO_CREDENTIAL.length + 5,
    );
  });
});

describe("POST /verify-totp-auth — bounding the guesses", () => {
  it("lets an honest user through while they are inside the budget", async () => {
    const user: User = await storedUser();
    const totp: ReturnType<EnrolmentFunction> = enrolment();

    findOneBy.mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(totp.row as never);

    const result: AttemptResult = await attempt({ code: totp.code() });

    expect(result.reachedHandler).toBe(true);
    expect(sendEntityResponse).toHaveBeenCalled();
    expect(sendErrorResponse).not.toHaveBeenCalled();
  });

  it("refuses the attempt after the per-account budget is spent", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      const allowed: AttemptResult = await attempt();
      expect(allowed.reachedHandler).toBe(true);
    }

    findOneBy.mockClear();

    const refused: AttemptResult = await attempt();

    expect(refused.reachedHandler).toBe(false);
    expect(refused.errorCode).toBe(ExceptionCode.TooManyRequestsException);
  });

  /*
   * The refusal has to land before the user lookup and the bcrypt verify.
   * A limiter that answers 429 only after paying for the guess still lets an
   * attacker spend our CPU, and — worse — still tells them, by timing, that
   * the address they tried exists.
   */
  it("refuses before the handler touches the database", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt();
    }

    findOneBy.mockClear();

    await attempt();

    expect(findOneBy).not.toHaveBeenCalled();
  });

  it("tells the caller when the window rolls", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt();
    }

    const refused: AttemptResult = await attempt();

    expect(Number(refused.retryAfter)).toBeGreaterThan(0);
    expect(Number(refused.retryAfter)).toBeLessThanOrEqual(WINDOW_SECONDS);
  });

  /*
   * The 429 says nothing the 400 above it would not have said. A limiter that
   * refused a real address sooner than an invented one would hand back the
   * account enumeration the handlers are careful to withhold.
   */
  it("says the same thing whether or not the account exists", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt();
    }

    const missingAccount: AttemptResult = await attempt();

    redisClient.reset();
    findOneBy.mockResolvedValue((await storedUser()) as never);

    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt();
    }

    const realAccount: AttemptResult = await attempt();

    expect(realAccount.errorMessage).toBe(missingAccount.errorMessage);
  });
});

describe("the ways a caller might try to buy a fresh bucket", () => {
  /*
   * The email address is a field in the request body, so it costs nothing to
   * change. If it were the only key, an attacker guessing TOTP codes would
   * simply cycle addresses and never meet a limit at all — and against the
   * second factor that works, because a code guessed for ANY account is a
   * bypass. The per-address counter is what survives this.
   */
  it("rotating the email address still runs into the per-address ceiling", async () => {
    for (let i: number = 0; i < PER_IP_LIMIT; i++) {
      const allowed: AttemptResult = await attempt({
        email: `victim-${i}@example.com`,
      });

      expect(allowed.reachedHandler).toBe(true);
    }

    const refused: AttemptResult = await attempt({
      email: "victim-fresh@example.com",
    });

    expect(refused.reachedHandler).toBe(false);
    expect(refused.errorCode).toBe(ExceptionCode.TooManyRequestsException);
  });

  /*
   * Postgres matches the address case-insensitively, so BOB@ and bob@ are one
   * account. If the counter disagreed, holding shift would double the budget.
   */
  it("changing the case of the email address does not reset the count", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt({ email: USER_EMAIL });
    }

    const refused: AttemptResult = await attempt({
      email: USER_EMAIL.toUpperCase(),
    });

    expect(refused.reachedHandler).toBe(false);
    expect(refused.errorCode).toBe(ExceptionCode.TooManyRequestsException);
  });

  /*
   * `email` reaches these routes in two shapes, and both are first-party.
   * POST /login gets the serialized envelope { _type: "Email", value } --
   * from the dashboard via ModelAPI's JSONFunctions.serialize, and from the
   * mobile app which hand-builds it. The dashboard's second-step calls spread
   * raw form values instead, so those send a bare string. The handler treats
   * them identically because BaseModel.fromJSON resolves both to one address,
   * so the counter has to as well -- otherwise alternating the two shapes
   * takes the per-account budget twice.
   */
  it("counts the two wire shapes of one address as one account", async () => {
    const half: number = PER_ACCOUNT_LIMIT / 2;

    for (let i: number = 0; i < half; i++) {
      await attempt({ emailShape: "string" });
    }

    for (let i: number = 0; i < half; i++) {
      await attempt({ emailShape: "object" });
    }

    const refused: AttemptResult = await attempt({ emailShape: "object" });

    expect(refused.reachedHandler).toBe(false);
    expect(refused.errorCode).toBe(ExceptionCode.TooManyRequestsException);
  });

  /*
   * The other half of the same coin, and the more damaging one.
   *
   * If the limiter cannot read the shape the shipped clients actually send,
   * every account collapses onto the single shared "none" key. That is not a
   * weaker limit, it is a much TIGHTER one applied to the wrong thing: one
   * office behind one NAT would be refused after ten sign-ins between all of
   * them, rather than the hundred and fifty the per-address ceiling exists to
   * allow. This test fails against exactly that mistake.
   */
  it("gives two different accounts on one address their own budgets", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt({ email: "first.colleague@example.com" });
    }

    const spent: AttemptResult = await attempt({
      email: "first.colleague@example.com",
    });
    expect(spent.reachedHandler).toBe(false);

    const colleague: AttemptResult = await attempt({
      email: "second.colleague@example.com",
    });

    expect(colleague.reachedHandler).toBe(true);
  });

  /*
   * X-Forwarded-For is a list that every proxy APPENDS to, so its leftmost
   * entries are whatever the caller chose to send. A limiter that read the
   * left-hand end would hand out a fresh bucket for every forged value — no
   * limit at all. The address is taken from the hop our own Nginx wrote.
   */
  it("a forged X-Forwarded-For entry does not reset the count", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt({ headers: { "x-forwarded-for": REAL_CLIENT_IP } });
    }

    const refused: AttemptResult = await attempt({
      headers: {
        "x-forwarded-for": `198.51.100.${PER_ACCOUNT_LIMIT}, ${REAL_CLIENT_IP}`,
      },
    });

    expect(refused.reachedHandler).toBe(false);
    expect(refused.errorCode).toBe(ExceptionCode.TooManyRequestsException);
  });

  /*
   * The flip side: a genuinely different client must not inherit somebody
   * else's spent budget. One noisy office does not lock out the internet.
   */
  it("a different client still gets its own budget", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt();
    }

    const other: AttemptResult = await attempt({
      headers: { "x-forwarded-for": "198.51.100.4" },
      socketAddress: "198.51.100.4",
    });

    expect(other.reachedHandler).toBe(true);
  });

  /*
   * Separate buckets, so spending the password budget cannot lock a user out
   * of finishing a two-factor login they had already started — and so an
   * attacker cannot use cheap /login noise to mask their code guessing.
   */
  it("the password bucket and the second-factor bucket are independent", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt({ uri: "/login" });
    }

    const refusedLogin: AttemptResult = await attempt({ uri: "/login" });
    expect(refusedLogin.reachedHandler).toBe(false);

    const totpVerify: AttemptResult = await attempt({
      uri: "/verify-totp-auth",
    });
    expect(totpVerify.reachedHandler).toBe(true);
  });

  it("/verify-webauthn-auth shares the second-step budget", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt({ uri: "/verify-totp-auth" });
    }

    const refused: AttemptResult = await attempt({
      uri: "/verify-webauthn-auth",
    });

    expect(refused.reachedHandler).toBe(false);
    expect(refused.errorCode).toBe(ExceptionCode.TooManyRequestsException);
  });

  it("/verify-totp-enrolment shares the second-step budget", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt({ uri: "/verify-totp-auth" });
    }

    const refused: AttemptResult = await attempt({
      uri: "/verify-totp-enrolment",
    });

    expect(refused.reachedHandler).toBe(false);
    expect(refused.errorCode).toBe(ExceptionCode.TooManyRequestsException);
  });
});

/*
 * The mandated-enrolment route, added with the admin MFA work, is the one it
 * would be easiest to leave out — guessing its CODE is pointless, because
 * /login hands the user the very secret the code is derived from, so it reads
 * like a route with nothing to guess.
 *
 * It is a password oracle all the same. It reaches the same login() function
 * and runs the same verifyHashedColumnValue before it ever looks at the
 * enrolment, so leaving it unlimited would not be one unguarded route, it
 * would be a hole in the fence around the other three: an attacker refused at
 * /login simply re-points the same password guesses here.
 */
describe("POST /verify-totp-enrolment", () => {
  it("bounds password guessing aimed at it directly", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      const allowed: AttemptResult = await attempt({
        uri: "/verify-totp-enrolment",
      });

      expect(allowed.reachedHandler).toBe(true);
    }

    const refused: AttemptResult = await attempt({
      uri: "/verify-totp-enrolment",
    });

    expect(refused.reachedHandler).toBe(false);
    expect(refused.errorCode).toBe(ExceptionCode.TooManyRequestsException);
  });

  it("refuses before the handler touches the database", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt({ uri: "/verify-totp-enrolment" });
    }

    findOneBy.mockClear();

    await attempt({ uri: "/verify-totp-enrolment" });

    expect(findOneBy).not.toHaveBeenCalled();
  });

  it("refuses rather than running unthrottled when Redis is gone", async () => {
    isRedisConnected = false;

    const result: AttemptResult = await attempt({
      uri: "/verify-totp-enrolment",
    });

    expect(result.reachedHandler).toBe(false);
    expect(result.errorCode).toBe(ExceptionCode.ServiceUnavailableException);
  });
});

describe("the window", () => {
  /*
   * The expiry is set once, on the write that created the key. Re-issuing it
   * on every increment would push the reset further out for as long as the
   * attempts kept coming — so a caller who tripped the limit and then kept
   * retrying, which is exactly what a locked-out human does, would never get
   * back in. That is a permanent lockout dressed up as a rate limit.
   */
  it("does not slide forward while attempts keep arriving", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 5; i++) {
      await attempt();
    }

    const accountExpires: Array<RecordedExpire> = redisClient.expires.filter(
      (recorded: RecordedExpire) => {
        return recorded.key.includes(":a:");
      },
    );

    expect(accountExpires).toHaveLength(1);
    expect(accountExpires[0]?.ttlSeconds).toBe(WINDOW_SECONDS * 2);
  });

  /*
   * The clock is moved rather than waited on. Only Date.now is replaced --
   * jest.useFakeTimers cannot install here, and the limiter reads nothing
   * else to decide which window a request lands in.
   */
  it("lets the caller back in once the window has rolled", async () => {
    let now: number = Date.parse("2026-01-01T00:00:00.000Z");

    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt();
    }

    expect((await attempt()).reachedHandler).toBe(false);

    now += (WINDOW_SECONDS + 30) * 1000;

    expect((await attempt()).reachedHandler).toBe(true);
  });
});

describe("when Redis is unreachable", () => {
  /*
   * Fails CLOSED, which is the opposite of what a load-shedding limiter does
   * and the right answer here: nothing in Postgres counts login attempts, so
   * serving these routes without the counter is serving the unlimited
   * guessing oracle the middleware exists to close.
   *
   * It costs no availability that was not already lost — a successful login
   * writes the user's permissions to the same Redis through GlobalCache, and
   * that throws when it is down. The difference is a 503 that says to come
   * back shortly instead of a 500.
   */
  it("refuses the attempt rather than serving it unthrottled", async () => {
    isRedisConnected = false;

    const result: AttemptResult = await attempt();

    expect(result.reachedHandler).toBe(false);
    expect(result.errorCode).toBe(ExceptionCode.ServiceUnavailableException);
  });

  it("refuses when the counter errors mid-pipeline too", async () => {
    redisClient.failNextExec = new Error("READONLY: cannot write to replica");

    const result: AttemptResult = await attempt();

    expect(result.reachedHandler).toBe(false);
    expect(result.errorCode).toBe(ExceptionCode.ServiceUnavailableException);
  });

  it("resumes serving once Redis comes back", async () => {
    isRedisConnected = false;
    expect((await attempt()).reachedHandler).toBe(false);

    isRedisConnected = true;
    expect((await attempt()).reachedHandler).toBe(true);
  });
});

describe("a request that does not name an account", () => {
  /*
   * `email` is whatever JSON the caller sent. A missing one, or one that is
   * an object rather than a string, must land in a bucket rather than throw
   * out of the limiter and surface as a 500 — and it must be a SHARED bucket,
   * so a caller cannot get a private allowance by omitting the field.
   */
  it("counts a missing email address against one shared bucket", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      const allowed: AttemptResult = await attempt({ email: "" });
      expect(allowed.reachedHandler).toBe(true);
    }

    const refused: AttemptResult = await attempt({ email: "" });

    expect(refused.reachedHandler).toBe(false);
    expect(refused.errorCode).toBe(ExceptionCode.TooManyRequestsException);
  });
});
