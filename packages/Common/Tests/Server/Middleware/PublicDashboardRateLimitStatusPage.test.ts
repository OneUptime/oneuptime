import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The status page master password bucket of PublicDashboardRateLimit.
 *
 * PublicDashboardRateLimit.test.ts covers the limiter's shared mechanics
 * (address resolution, window arithmetic, pipeline failures) through the
 * dashboard buckets. What this file pins is what is specific to the status
 * page bucket: that it is keyed on the status page rather than on anything
 * dashboard-shaped, that its counters never touch the dashboard ones in
 * either direction, that it has its own budget and settings, and that it
 * fails closed like the dashboard password bucket.
 */

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
    },
  };
});

import Redis from "../../../Server/Infrastructure/Redis";
import Response from "../../../Server/Utils/Response";
import logger from "../../../Server/Utils/Logger";
import PublicDashboardRateLimit, {
  PublicDashboardRateLimitBucket,
  PublicDashboardRateLimitDecision,
  PublicDashboardRateLimitOutcome,
  PublicDashboardRateLimitScope,
} from "../../../Server/Middleware/PublicDashboardRateLimit";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import Exception from "../../../Types/Exception/Exception";
import ObjectID from "../../../Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;
const loggerWarnMock: MockedFn = logger.warn as unknown as MockedFn;
const loggerErrorMock: MockedFn = logger.error as unknown as MockedFn;

/* Defaults baked into the limiter, restated so a change has to be deliberate. */
const WINDOW_SECONDS: number = 15 * 60;
const PER_STATUS_PAGE_LIMIT: number = 15;
const PER_IP_LIMIT: number = 45;
const DASHBOARD_MASTER_PASSWORD_PER_DASHBOARD_LIMIT: number = 15;

const STATUS_PAGE_BUCKET: PublicDashboardRateLimitBucket =
  PublicDashboardRateLimitBucket.StatusPageMasterPassword;

const CLIENT_IP: string = "203.0.113.7";

/* Same counting fake as the dashboard limiter tests use. */
interface RecordedExpire {
  key: string;
  ttlSeconds: number;
}

class FakeRedisClient {
  public counters: Map<string, number> = new Map();
  public expires: Array<RecordedExpire> = [];

  /* Set to make the next exec() reject, for the error-path tests. */
  public failNextExec: Error | null = null;

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
  }

  public keysStartingWith(prefix: string): Array<string> {
    return Array.from(this.counters.keys()).filter((key: string) => {
      return key.startsWith(prefix);
    });
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

interface BuildRequestOverrides {
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  headers?: Record<string, string | Array<string>>;
}

const buildRequest: (overrides?: BuildRequestOverrides) => ExpressRequest = (
  overrides: BuildRequestOverrides = {},
) => {
  return {
    params: overrides.params || {},
    body: overrides.body,
    headers: overrides.headers || {},
    socket: {},
  } as unknown as ExpressRequest;
};

describe("PublicDashboardRateLimit - status page master password bucket", () => {
  let client: FakeRedisClient;
  let nowSpy: ReturnType<typeof jest.spyOn>;
  let currentTime: number;

  beforeEach(() => {
    jest.clearAllMocks();

    client = new FakeRedisClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);

    /* Pinned to the start of a window so the counters are deterministic. */
    currentTime = 1_700_000_000_000;
    currentTime = currentTime - (currentTime % (WINDOW_SECONDS * 1000));
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
      return currentTime;
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  const consumeStatusPage: (data?: {
    resourceKey?: string;
    clientIp?: string;
  }) => Promise<PublicDashboardRateLimitDecision> = (
    data: { resourceKey?: string; clientIp?: string } = {},
  ) => {
    return PublicDashboardRateLimit.consume({
      resourceKey: data.resourceKey || "id:status-page-a",
      clientIp: data.clientIp || CLIENT_IP,
      bucket: STATUS_PAGE_BUCKET,
    });
  };

  describe("resolveStatusPageKey", () => {
    it("keys a status page by its id", () => {
      const statusPageId: string = ObjectID.generate().toString();

      expect(
        PublicDashboardRateLimit.resolveStatusPageKey(
          buildRequest({ params: { statusPageId } }),
        ),
      ).toBe(`id:${statusPageId.toLowerCase()}`);
    });

    it("keys an id identically regardless of case or surrounding space", () => {
      const statusPageId: string = ObjectID.generate().toString();

      expect(
        PublicDashboardRateLimit.resolveStatusPageKey(
          buildRequest({
            params: { statusPageId: `  ${statusPageId.toUpperCase()} ` },
          }),
        ),
      ).toBe(`id:${statusPageId.toLowerCase()}`);
    });

    /*
     * The route only accepts an id, so a domain can never reach a real status
     * page through it and must not be handed a bucket of its own.
     */
    it("collapses a domain into the shared invalid bucket", () => {
      expect(
        PublicDashboardRateLimit.resolveStatusPageKey(
          buildRequest({ params: { statusPageId: "status.example.com" } }),
        ),
      ).toBe("invalid");
    });

    it("collapses junk path segments into one bucket", () => {
      const first: string = PublicDashboardRateLimit.resolveStatusPageKey(
        buildRequest({ params: { statusPageId: "junk-1" } }),
      );
      const second: string = PublicDashboardRateLimit.resolveStatusPageKey(
        buildRequest({ params: { statusPageId: "x".repeat(5000) } }),
      );

      expect(first).toBe("invalid");
      expect(second).toBe("invalid");
    });

    it("buckets a missing id rather than throwing", () => {
      expect(
        PublicDashboardRateLimit.resolveStatusPageKey(buildRequest()),
      ).toBe("none");
      expect(
        PublicDashboardRateLimit.resolveStatusPageKey(
          buildRequest({ params: { statusPageId: "   " } }),
        ),
      ).toBe("none");
      expect(
        PublicDashboardRateLimit.resolveStatusPageKey({} as ExpressRequest),
      ).toBe("none");
    });

    /*
     * Only :statusPageId names the status page. A caller cannot steer the
     * key by adding the parameters or body field the dashboard key reads.
     */
    it("ignores the fields the dashboard key reads", () => {
      const statusPageId: string = ObjectID.generate().toString();

      expect(
        PublicDashboardRateLimit.resolveStatusPageKey(
          buildRequest({
            params: {
              statusPageId,
              dashboardId: ObjectID.generate().toString(),
              dashboardIdOrDomain: "dash.example.com",
            },
            body: { domain: "status.example.com" },
          }),
        ),
      ).toBe(`id:${statusPageId.toLowerCase()}`);

      expect(
        PublicDashboardRateLimit.resolveStatusPageKey(
          buildRequest({
            params: { dashboardId: ObjectID.generate().toString() },
          }),
        ),
      ).toBe("none");
    });
  });

  describe("consume", () => {
    it("allows a human's worth of attempts", async () => {
      for (let i: number = 0; i < PER_STATUS_PAGE_LIMIT; i++) {
        expect((await consumeStatusPage()).outcome).toBe(
          PublicDashboardRateLimitOutcome.Allowed,
        );
      }
    });

    it("refuses the attempt after that, on the status page counter", async () => {
      for (let i: number = 0; i < PER_STATUS_PAGE_LIMIT; i++) {
        await consumeStatusPage();
      }

      const decision: PublicDashboardRateLimitDecision =
        await consumeStatusPage();

      expect(decision.outcome).toBe(
        PublicDashboardRateLimitOutcome.RateLimited,
      );
      expect(decision.scope).toBe(PublicDashboardRateLimitScope.Dashboard);
      expect(decision.isFirstRejectionInWindow).toBe(true);
      expect(decision.retryAfterSeconds).toBeGreaterThan(0);
      expect(decision.retryAfterSeconds).toBeLessThanOrEqual(WINDOW_SECONDS);
    });

    it("keeps separate budgets for separate client addresses", async () => {
      for (let i: number = 0; i < PER_STATUS_PAGE_LIMIT + 5; i++) {
        await consumeStatusPage();
      }

      expect(
        (await consumeStatusPage({ clientIp: "198.51.100.4" })).outcome,
      ).toBe(PublicDashboardRateLimitOutcome.Allowed);
    });

    /*
     * The bypass the address counter exists to close: rotating the status
     * page id lands every guess in a fresh per-page bucket.
     */
    it("caps a caller rotating status pages to guess against many at once", async () => {
      let rejected: PublicDashboardRateLimitDecision | null = null;
      let rejectedAt: number = -1;

      for (let i: number = 0; i < PER_IP_LIMIT + 5; i++) {
        const decision: PublicDashboardRateLimitDecision =
          await consumeStatusPage({ resourceKey: `id:status-page-${i}` });

        if (
          decision.outcome === PublicDashboardRateLimitOutcome.RateLimited &&
          !rejected
        ) {
          rejected = decision;
          rejectedAt = i;
        }
      }

      expect(rejectedAt).toBe(PER_IP_LIMIT);
      expect(rejected?.scope).toBe(PublicDashboardRateLimitScope.Ip);
    });

    it("holds its window for the full fifteen minutes", async () => {
      for (let i: number = 0; i < PER_STATUS_PAGE_LIMIT + 1; i++) {
        await consumeStatusPage();
      }

      currentTime = currentTime + (WINDOW_SECONDS - 1) * 1000;

      expect((await consumeStatusPage()).outcome).toBe(
        PublicDashboardRateLimitOutcome.RateLimited,
      );

      currentTime = currentTime + 1000;

      expect((await consumeStatusPage()).outcome).toBe(
        PublicDashboardRateLimitOutcome.Allowed,
      );
    });

    it("writes each counter's expiry once, longer than the window", async () => {
      for (let i: number = 0; i < 5; i++) {
        await consumeStatusPage();
      }

      expect(client.expires).toHaveLength(2);

      for (const recorded of client.expires) {
        expect(recorded.ttlSeconds).toBeGreaterThan(WINDOW_SECONDS);
      }
    });
  });

  /*
   * The status page and dashboard password buckets share an implementation,
   * not counters. A status page's guesses must not spend a dashboard's
   * allowance, nor be laundered through it, in either direction.
   */
  describe("separation from the dashboard buckets", () => {
    it("keeps its counters under its own prefix", async () => {
      await consumeStatusPage();

      const keys: Array<string> = Array.from(client.counters.keys());

      expect(keys).toHaveLength(2);

      for (const key of keys) {
        expect(key.startsWith("pspage:rl:")).toBe(true);
        expect(key.startsWith("pdash:")).toBe(false);
      }
    });

    it("never writes a dashboard key", async () => {
      await consumeStatusPage();

      expect(client.keysStartingWith("pdash:")).toEqual([]);

      await PublicDashboardRateLimit.consume({
        resourceKey: "id:status-page-a",
        clientIp: CLIENT_IP,
        bucket: PublicDashboardRateLimitBucket.MasterPassword,
      });

      expect(client.keysStartingWith("pdash:")).toHaveLength(2);
      expect(client.keysStartingWith("pspage:")).toHaveLength(2);
    });

    it("is not spent by dashboard password attempts", async () => {
      /*
       * The same key segment and address on purpose: only the bucket differs,
       * so any sharing would show up here.
       */
      for (
        let i: number = 0;
        i < DASHBOARD_MASTER_PASSWORD_PER_DASHBOARD_LIMIT + 50;
        i++
      ) {
        await PublicDashboardRateLimit.consume({
          resourceKey: "id:status-page-a",
          clientIp: CLIENT_IP,
          bucket: PublicDashboardRateLimitBucket.MasterPassword,
        });
      }

      expect((await consumeStatusPage()).outcome).toBe(
        PublicDashboardRateLimitOutcome.Allowed,
      );
    });

    it("does not spend the dashboard password budget", async () => {
      for (let i: number = 0; i < PER_IP_LIMIT + 50; i++) {
        await consumeStatusPage();
      }

      expect(
        (
          await PublicDashboardRateLimit.consume({
            resourceKey: "id:status-page-a",
            clientIp: CLIENT_IP,
            bucket: PublicDashboardRateLimitBucket.MasterPassword,
          })
        ).outcome,
      ).toBe(PublicDashboardRateLimitOutcome.Allowed);
    });

    it("is not relaxed by dashboard read traffic", async () => {
      for (let i: number = 0; i < 100; i++) {
        await PublicDashboardRateLimit.consume({
          resourceKey: "id:status-page-a",
          clientIp: CLIENT_IP,
          bucket: PublicDashboardRateLimitBucket.Read,
        });
      }

      for (let i: number = 0; i < PER_STATUS_PAGE_LIMIT; i++) {
        await consumeStatusPage();
      }

      expect((await consumeStatusPage()).outcome).toBe(
        PublicDashboardRateLimitOutcome.RateLimited,
      );
    });
  });

  describe("getMiddleware", () => {
    interface MiddlewareResult {
      nextCalled: boolean;
      headers: Record<string, string>;
    }

    const runMiddleware: (
      request?: ExpressRequest,
    ) => Promise<MiddlewareResult> = async (request?: ExpressRequest) => {
      const headers: Record<string, string> = {};
      let nextCalled: boolean = false;

      const response: ExpressResponse = {
        setHeader: (name: string, value: string): void => {
          headers[name] = value;
        },
      } as unknown as ExpressResponse;

      await PublicDashboardRateLimit.getMiddleware(STATUS_PAGE_BUCKET)(
        request ||
          buildRequest({
            params: { statusPageId: ObjectID.generate().toString() },
            headers: { "x-forwarded-for": CLIENT_IP },
          }),
        response,
        (() => {
          nextCalled = true;
        }) as unknown as NextFunction,
      );

      return { nextCalled, headers };
    };

    it("passes an allowed attempt through", async () => {
      const result: MiddlewareResult = await runMiddleware();

      expect(result.nextCalled).toBe(true);
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    it("stops a refused attempt before the handler, with a 429 about passwords", async () => {
      const request: ExpressRequest = buildRequest({
        params: { statusPageId: ObjectID.generate().toString() },
        headers: { "x-forwarded-for": CLIENT_IP },
      });

      for (let i: number = 0; i < PER_STATUS_PAGE_LIMIT; i++) {
        expect((await runMiddleware(request)).nextCalled).toBe(true);
      }

      const refused: MiddlewareResult = await runMiddleware(request);

      expect(refused.nextCalled).toBe(false);
      expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.code).toBe(ExceptionCode.TooManyRequestsException);
      expect(error.message.toLowerCase()).toContain("password");
      expect(error.message).not.toMatch(/\d/);
      expect(Number(refused.headers["Retry-After"])).toBeGreaterThan(0);
      expect(Number(refused.headers["Retry-After"])).toBeLessThanOrEqual(
        WINDOW_SECONDS,
      );
    });

    it("keys the attempt on the status page named in the path", async () => {
      const statusPageId: string = ObjectID.generate().toString();

      await runMiddleware(
        buildRequest({
          params: { statusPageId },
          headers: { "x-forwarded-for": CLIENT_IP },
        }),
      );

      expect(
        client.counters.get(
          `pspage:rl:${STATUS_PAGE_BUCKET}:s:id:${statusPageId.toLowerCase()}:${CLIENT_IP}:${Math.floor(
            currentTime / (WINDOW_SECONDS * 1000),
          )}`,
        ),
      ).toBe(1);
    });

    /*
     * The address comes from the hop our proxy wrote. A caller forging a
     * different left-hand X-Forwarded-For entry on every guess still lands
     * in one bucket.
     */
    it("is not escaped by forging X-Forwarded-For", async () => {
      const statusPageId: string = ObjectID.generate().toString();

      for (let i: number = 0; i < PER_STATUS_PAGE_LIMIT; i++) {
        await runMiddleware(
          buildRequest({
            params: { statusPageId },
            headers: { "x-forwarded-for": `10.0.0.${i}, ${CLIENT_IP}` },
          }),
        );
      }

      const result: MiddlewareResult = await runMiddleware(
        buildRequest({
          params: { statusPageId },
          headers: { "x-forwarded-for": `1.2.3.4, ${CLIENT_IP}` },
        }),
      );

      expect(result.nextCalled).toBe(false);
    });

    /*
     * Fails CLOSED, like the dashboard password bucket: without the counter
     * nothing bounds guessing at all.
     */
    it("refuses attempts with a 503 when Redis is gone", async () => {
      isConnectedMock.mockReturnValue(false);

      const result: MiddlewareResult = await runMiddleware();

      expect(result.nextCalled).toBe(false);

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.code).toBe(ExceptionCode.ServiceUnavailableException);
    });

    it("refuses attempts when Redis has no client", async () => {
      getClientMock.mockReturnValue(null);

      expect((await runMiddleware()).nextCalled).toBe(false);
    });

    it("refuses attempts when the counter errors", async () => {
      client.failNextExec = new Error("connection reset");

      expect((await runMiddleware()).nextCalled).toBe(false);
    });

    it("logs the crossing once rather than every refusal", async () => {
      const request: ExpressRequest = buildRequest({
        params: { statusPageId: ObjectID.generate().toString() },
        headers: { "x-forwarded-for": CLIENT_IP },
      });

      for (let i: number = 0; i < PER_STATUS_PAGE_LIMIT; i++) {
        await runMiddleware(request);
      }

      loggerWarnMock.mockClear();

      for (let i: number = 0; i < 50; i++) {
        await runMiddleware(request);
      }

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
      expect(String(loggerWarnMock.mock.calls[0]?.[0])).toContain(
        "status page",
      );
    });

    it("does not log once per attempt while refusing in an outage", async () => {
      isConnectedMock.mockReturnValue(false);
      loggerErrorMock.mockClear();

      for (let i: number = 0; i < 100; i++) {
        await runMiddleware();
      }

      expect(loggerErrorMock.mock.calls.length).toBeLessThanOrEqual(1);
      expect(sendErrorResponseMock).toHaveBeenCalledTimes(100);
    });
  });
});

/*
 * The budgets are read from the environment at module load, so these reload
 * the module rather than calling into the already-configured one.
 */
describe("PublicDashboardRateLimit - status page master password configuration", () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  const reload: () => Promise<typeof PublicDashboardRateLimit> = async () => {
    jest.resetModules();

    const redisModule: {
      default: { getClient: MockedFn; isConnected: MockedFn };
    } = (await import("../../../Server/Infrastructure/Redis")) as unknown as {
      default: { getClient: MockedFn; isConnected: MockedFn };
    };

    const limiterModule: { default: typeof PublicDashboardRateLimit } =
      (await import(
        "../../../Server/Middleware/PublicDashboardRateLimit"
      )) as unknown as { default: typeof PublicDashboardRateLimit };

    redisModule.default.getClient.mockReturnValue(new FakeRedisClient());
    redisModule.default.isConnected.mockReturnValue(true);

    return limiterModule.default;
  };

  const countAllowed: (
    limiter: typeof PublicDashboardRateLimit,
    bucket: PublicDashboardRateLimitBucket,
    attempts: number,
    rotateResource?: boolean,
  ) => Promise<number> = async (
    limiter: typeof PublicDashboardRateLimit,
    bucket: PublicDashboardRateLimitBucket,
    attempts: number,
    rotateResource: boolean = false,
  ) => {
    let allowed: number = 0;

    for (let i: number = 0; i < attempts; i++) {
      const decision: PublicDashboardRateLimitDecision = await limiter.consume({
        resourceKey: rotateResource ? `id:rotating-${i}` : "id:a",
        clientIp: CLIENT_IP,
        bucket,
      });

      if (decision.outcome === PublicDashboardRateLimitOutcome.Allowed) {
        allowed++;
      }
    }

    return allowed;
  };

  it("honours a configured per-status-page limit", async () => {
    process.env[
      "STATUS_PAGE_MASTER_PASSWORD_RATE_LIMIT_PER_STATUS_PAGE_PER_WINDOW"
    ] = "2";

    const limiter: typeof PublicDashboardRateLimit = await reload();

    expect(await countAllowed(limiter, STATUS_PAGE_BUCKET, 5)).toBe(2);
  });

  it("honours a configured per-address ceiling", async () => {
    process.env["STATUS_PAGE_MASTER_PASSWORD_RATE_LIMIT_PER_IP_PER_WINDOW"] =
      "3";

    const limiter: typeof PublicDashboardRateLimit = await reload();

    expect(await countAllowed(limiter, STATUS_PAGE_BUCKET, 6, true)).toBe(3);
  });

  /*
   * One surface's settings must not move the other's budget, or tuning the
   * dashboard would silently loosen or tighten status pages.
   */
  it("is not moved by the dashboard password settings", async () => {
    process.env[
      "PUBLIC_DASHBOARD_MASTER_PASSWORD_RATE_LIMIT_PER_DASHBOARD_PER_WINDOW"
    ] = "2";

    const limiter: typeof PublicDashboardRateLimit = await reload();

    expect(
      await countAllowed(
        limiter,
        STATUS_PAGE_BUCKET,
        PER_STATUS_PAGE_LIMIT + 5,
      ),
    ).toBe(PER_STATUS_PAGE_LIMIT);
    expect(
      await countAllowed(
        limiter,
        PublicDashboardRateLimitBucket.MasterPassword,
        5,
      ),
    ).toBe(2);
  });

  it("does not move the dashboard password budget", async () => {
    process.env[
      "STATUS_PAGE_MASTER_PASSWORD_RATE_LIMIT_PER_STATUS_PAGE_PER_WINDOW"
    ] = "2";

    const limiter: typeof PublicDashboardRateLimit = await reload();

    expect(
      await countAllowed(
        limiter,
        PublicDashboardRateLimitBucket.MasterPassword,
        DASHBOARD_MASTER_PASSWORD_PER_DASHBOARD_LIMIT + 5,
      ),
    ).toBe(DASHBOARD_MASTER_PASSWORD_PER_DASHBOARD_LIMIT);
  });

  it("falls back to the default when the value is not a positive number", async () => {
    process.env[
      "STATUS_PAGE_MASTER_PASSWORD_RATE_LIMIT_PER_STATUS_PAGE_PER_WINDOW"
    ] = "0";
    process.env["STATUS_PAGE_MASTER_PASSWORD_RATE_LIMIT_WINDOW_SECONDS"] =
      "not-a-number";

    const limiter: typeof PublicDashboardRateLimit = await reload();

    expect(
      await countAllowed(
        limiter,
        STATUS_PAGE_BUCKET,
        PER_STATUS_PAGE_LIMIT + 5,
      ),
    ).toBe(PER_STATUS_PAGE_LIMIT);
  });
});
