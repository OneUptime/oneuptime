import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * ---------------------------------------------------------------------------
 * Attempt limiting on the status page private user login, POST /login on the
 * status page identity router, exercised through the real router with the
 * real limiter in front of the real handler.
 *
 * The limiter's own arithmetic is covered in
 * Common/Tests/Server/Middleware/IdentityRateLimit.test.ts. What this file
 * pins is the wiring: that the route has the limiter, that it runs before the
 * user lookup and the password verify, that it is keyed the way the status
 * page login form actually sends credentials, and that it fails closed.
 * ---------------------------------------------------------------------------
 */

class FakeRedisClient {
  public counters: Map<string, number> = new Map();

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
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

  public expire(): FakePipeline {
    this.commands.push((): [Error | null, unknown] => {
      return [null, 1];
    });

    return this;
  }

  public async exec(): Promise<unknown> {
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

const privateUserFindOneBy: jest.Mock = jest.fn();
const privateUserVerifyHashedColumnValue: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPagePrivateUserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return privateUserFindOneBy(...args);
      },
      findOneById: jest.fn(),
      updateOneBy: jest.fn(),
      updateOneById: jest.fn(),
      verifyHashedColumnValue: (...args: Array<unknown>): unknown => {
        return privateUserVerifyHashedColumnValue(...args);
      },
    },
  };
});

const statusPageFindOneById: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return statusPageFindOneById(...args);
      },
      getStatusPageURL: (): Promise<string> => {
        return Promise.resolve("https://status.example.com");
      },
    },
  };
});

jest.mock("Common/Server/Services/StatusPagePrivateUserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: jest.fn(),
      findActiveSessionByRefreshToken: jest.fn(),
      isLoginCodeSession: jest.fn(),
      exchangeLoginCode: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectSmtpConfigService", () => {
  return {
    __esModule: true,
    default: {
      toEmailServer: (): undefined => {
        return undefined;
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
      getHost: jest.fn(),
      getHttpProtocol: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      setStatusPagePrivateUserCookie: jest.fn(),
      removeCookie: jest.fn(),
      removeStatusPageMasterPasswordCookie: jest.fn(),
      getCookieFromExpressRequest: jest.fn(),
      getRefreshTokenFromExpressRequest: jest.fn(),
      getStatusPageMasterPasswordKey: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      sign: jest.fn(),
      signStatusPageLoginToken: jest.fn(),
      decode: jest.fn(),
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
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler, and every middleware, above.
import "../../../FeatureSet/Identity/API/StatusPageAuthentication";

/* The shipped defaults, restated so a change to either has to be deliberate. */
const WINDOW_SECONDS: number = 15 * 60;
const PER_ACCOUNT_LIMIT: number = 10;
const PER_IP_LIMIT: number = 150;

const STATUS_PAGE_ID: string = "e7f4d2a0-1b3c-4d5e-8f90-a1b2c3d4e5f6";
const USER_EMAIL: string = "private.user@example.com";

/* The address our own Nginx appends. Everything below is billed to it. */
const REAL_CLIENT_IP: string = "203.0.113.9";

type AttemptOptions = {
  email?: string;

  /*
   * The status page login form goes through ModelForm, which serializes the
   * model, so the envelope is what production sends. The bare string is the
   * shape a hand-written client might send instead.
   */
  emailShape?: "string" | "object";
  statusPageId?: string;
  headers?: Record<string, string | Array<string>>;
};

type AttemptResult = {
  reachedHandler: boolean;
  handlerError: Exception | undefined;
  errorCode: ExceptionCode | undefined;
  errorMessage: string | undefined;
  retryAfter: string | undefined;
};

/*
 * One request through the whole registered chain -- limiter first, handler
 * last. A limiter that refuses never calls next, so the handler never runs.
 */
type AttemptFunction = (options?: AttemptOptions) => Promise<AttemptResult>;

const attempt: AttemptFunction = async (
  options: AttemptOptions = {},
): Promise<AttemptResult> => {
  const handlers: Array<RouteHandler> = mockRouter.matchAll("post", "/login");

  const emailValue: string = options.email || USER_EMAIL;

  const req: ExpressRequest = buildRequest(
    {
      data: {
        statusPageId: options.statusPageId || STATUS_PAGE_ID,
        email:
          options.emailShape === "string"
            ? emailValue
            : { _type: "Email", value: emailValue },
        password: { _type: "HashedString", value: "a wrong guess" },
      },
    },
    {
      headers: options.headers || { "x-forwarded-for": REAL_CLIENT_IP },
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

  const errorResponsesBefore: number = sendErrorResponse.mock.calls.length;

  let reachedHandler: boolean = false;
  let handlerError: Exception | undefined = undefined;

  for (let index: number = 0; index < handlers.length; index++) {
    const handler: RouteHandler = handlers[index] as RouteHandler;
    const isHandler: boolean = index === handlers.length - 1;

    let continued: boolean = false;

    const next: NextFunction = ((err?: Exception): void => {
      if (isHandler) {
        handlerError = err;
      }

      continued = true;
    }) as unknown as NextFunction;

    if (isHandler) {
      reachedHandler = true;
    }

    await handler(req, res, next);

    if (!continued) {
      break;
    }
  }

  const call: Array<unknown> | undefined =
    sendErrorResponse.mock.calls.length > errorResponsesBefore
      ? (sendErrorResponse.mock.calls[
          sendErrorResponse.mock.calls.length - 1
        ] as Array<unknown>)
      : undefined;

  const error: Exception | undefined = call?.[2] as Exception | undefined;

  return {
    reachedHandler,
    handlerError,
    errorCode: error?.code,
    errorMessage: error?.message,
    retryAfter: headers["Retry-After"],
  };
};

describe("Status page /login - attempt limiting", () => {
  let nowSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.clearAllMocks();
    redisClient.counters.clear();
    isRedisConnected = true;

    /*
     * Pinned to the start of a window, so a loop that straddled a boundary
     * cannot see its counter reset halfway and never reach the limit.
     */
    let pinnedTime: number = 1_700_000_000_000;
    pinnedTime = pinnedTime - (pinnedTime % (WINDOW_SECONDS * 1000));

    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
      return pinnedTime;
    });

    statusPageFindOneById.mockResolvedValue({
      id: new ObjectID(STATUS_PAGE_ID),
      requireSsoForLogin: false,
    });

    privateUserFindOneBy.mockResolvedValue({
      id: ObjectID.generate(),
      email: USER_EMAIL,
      statusPageId: new ObjectID(STATUS_PAGE_ID),
    });

    privateUserVerifyHashedColumnValue.mockResolvedValue(false);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it("registers a limiter ahead of the handler", () => {
    const handlers: Array<RouteHandler> = mockRouter.matchAll(
      "post",
      "/login",
    );

    expect(handlers).toHaveLength(2);
    expect(handlers[0]).not.toBe(mockRouter.match("post", "/login"));
  });

  it("lets a person's worth of wrong passwords reach the handler", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      const result: AttemptResult = await attempt();

      expect(result.reachedHandler).toBe(true);
      expect(result.handlerError).toBeInstanceOf(BadDataException);
    }

    expect(privateUserVerifyHashedColumnValue).toHaveBeenCalledTimes(
      PER_ACCOUNT_LIMIT,
    );
  });

  /*
   * The point of the change: a refused guess never reaches the user lookup
   * or the scrypt verify.
   */
  it("refuses the next guess before the user lookup and the password check", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt();
    }

    privateUserFindOneBy.mockClear();
    privateUserVerifyHashedColumnValue.mockClear();
    statusPageFindOneById.mockClear();

    for (let i: number = 0; i < 20; i++) {
      const result: AttemptResult = await attempt();

      expect(result.reachedHandler).toBe(false);
      expect(result.errorCode).toBe(ExceptionCode.TooManyRequestsException);
    }

    expect(privateUserFindOneBy).not.toHaveBeenCalled();
    expect(privateUserVerifyHashedColumnValue).not.toHaveBeenCalled();
    expect(statusPageFindOneById).not.toHaveBeenCalled();
  });

  it("tells a refused caller when to come back", async () => {
    let result: AttemptResult | null = null;

    for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 1; i++) {
      result = await attempt();
    }

    expect(Number(result?.retryAfter)).toBeGreaterThan(0);
    expect(Number(result?.retryAfter)).toBeLessThanOrEqual(WINDOW_SECONDS);
  });

  /*
   * The production form sends the envelope. If the limiter only understood
   * the bare string, every real login would share one "none" bucket.
   */
  it("keys the serialized email envelope and the bare string identically", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt({ emailShape: i % 2 === 0 ? "object" : "string" });
    }

    expect((await attempt({ emailShape: "object" })).reachedHandler).toBe(
      false,
    );
    expect((await attempt({ emailShape: "string" })).reachedHandler).toBe(
      false,
    );
  });

  it("is not escaped by changing the email's case", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt();
    }

    expect(
      (await attempt({ email: USER_EMAIL.toUpperCase() })).reachedHandler,
    ).toBe(false);
  });

  it("does not refuse a different account on the same address", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 5; i++) {
      await attempt();
    }

    expect(
      (await attempt({ email: "someone.else@example.com" })).reachedHandler,
    ).toBe(true);
  });

  it("caps an address rotating email addresses", async () => {
    let reached: number = 0;

    for (let i: number = 0; i < PER_IP_LIMIT + 10; i++) {
      if ((await attempt({ email: `rotating-${i}@example.com` })).reachedHandler) {
        reached++;
      }
    }

    expect(reached).toBe(PER_IP_LIMIT);
  });

  /*
   * The account counter is keyed on the email alone, not on the status page,
   * so switching the status page id does not buy a fresh allowance for the
   * same address.
   */
  it("is not escaped by switching the status page id", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt();
    }

    expect(
      (await attempt({ statusPageId: ObjectID.generate().toString() }))
        .reachedHandler,
    ).toBe(false);
  });

  it("is not escaped by forging X-Forwarded-For", async () => {
    for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
      await attempt({
        headers: { "x-forwarded-for": `10.0.0.${i}, ${REAL_CLIENT_IP}` },
      });
    }

    expect(
      (
        await attempt({
          headers: { "x-forwarded-for": `1.2.3.4, ${REAL_CLIENT_IP}` },
        })
      ).reachedHandler,
    ).toBe(false);
  });

  it("writes only status page login counters", async () => {
    await attempt();

    const keys: Array<string> = Array.from(redisClient.counters.keys());

    expect(keys).toHaveLength(2);

    for (const key of keys) {
      expect(key).toContain(":status-page-login:");
    }
  });

  /*
   * Fails closed: nothing else counts status page login attempts, so without
   * the counter the route would be an unlimited guessing oracle again.
   */
  it("refuses with 503 rather than running unthrottled when Redis is gone", async () => {
    isRedisConnected = false;

    const result: AttemptResult = await attempt();

    expect(result.reachedHandler).toBe(false);
    expect(result.errorCode).toBe(ExceptionCode.ServiceUnavailableException);
    expect(privateUserFindOneBy).not.toHaveBeenCalled();
    expect(privateUserVerifyHashedColumnValue).not.toHaveBeenCalled();
  });
});
