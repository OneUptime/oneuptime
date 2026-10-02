import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The rate limiter in front of the MCP authorization server (/mcp/oauth/...).
 *
 * Every endpoint behind it answers callers nobody has identified, so beyond
 * "does it count" the properties that decide whether the limit means anything:
 * that the client address is the hop OUR proxy wrote and not the one the
 * caller can forge; that one bucket or one address being exhausted leaves the
 * others alone; that the window does not slide forward under sustained load;
 * and what happens when there is no counter at all - registration, the one
 * endpoint that writes a row for an anonymous caller, is refused, while a
 * Redis blip must not sign every connected client out of everything else.
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

/*
 * The real resolver, wrapped so one test can make it return something no
 * real address looks like (the limiter sanitises whatever it is handed).
 */
jest.mock("../../../Server/Utils/ClientIp", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/ClientIp",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: jest.fn(actual["default"] as (...args: Array<unknown>) => unknown),
  };
});

import Redis from "../../../Server/Infrastructure/Redis";
import logger from "../../../Server/Utils/Logger";
import resolveTrustedClientIp from "../../../Server/Utils/ClientIp";
import McpOAuthRateLimit, {
  McpOAuthRateLimitBucket,
  McpOAuthRateLimitDecision,
  McpOAuthRateLimitOutcome,
  McpOAuthRateLimitRejectionHandler,
} from "../../../Server/Middleware/McpOAuthRateLimit";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const loggerWarnMock: MockedFn = logger.warn as unknown as MockedFn;
const resolveTrustedClientIpMock: MockedFn =
  resolveTrustedClientIp as unknown as MockedFn;

const WINDOW_SECONDS: number = 15 * 60;
const WINDOW_MS: number = WINDOW_SECONDS * 1000;

const CLIENT_IP: string = "203.0.113.7";
const OTHER_CLIENT_IP: string = "198.51.100.4";

const LIMITS: Array<[McpOAuthRateLimitBucket, number]> = [
  [McpOAuthRateLimitBucket.Authorize, 300],
  [McpOAuthRateLimitBucket.Token, 1200],
  [McpOAuthRateLimitBucket.Register, 60],
  [McpOAuthRateLimitBucket.Revoke, 600],
  [McpOAuthRateLimitBucket.Consent, 600],
];

const FAIL_OPEN_BUCKETS: Array<McpOAuthRateLimitBucket> = [
  McpOAuthRateLimitBucket.Authorize,
  McpOAuthRateLimitBucket.Token,
  McpOAuthRateLimitBucket.Revoke,
  McpOAuthRateLimitBucket.Consent,
];

interface RecordedExpire {
  key: string;
  ttlSeconds: number;
}

/*
 * A fake that behaves like a Redis counter store rather than a bag of
 * assertions: INCR really increments and EXPIRE really records a TTL, so the
 * window tests exercise the limiter's arithmetic instead of restating it.
 */
class FakeRedisClient {
  public counters: Map<string, number> = new Map();
  public expires: Array<RecordedExpire> = [];
  public incrCallCount: number = 0;
  public failNextIncr: Error | null = null;
  public failNextExpire: Error | null = null;
  public nextIncrResult: unknown | undefined = undefined;

  public async incr(key: string): Promise<unknown> {
    this.incrCallCount++;

    if (this.failNextIncr) {
      const error: Error = this.failNextIncr;
      this.failNextIncr = null;
      throw error;
    }

    const next: number = (this.counters.get(key) || 0) + 1;
    this.counters.set(key, next);

    if (typeof this.nextIncrResult !== "undefined") {
      const result: unknown = this.nextIncrResult;
      this.nextIncrResult = undefined;
      return result;
    }

    return next;
  }

  public async expire(key: string, ttlSeconds: number): Promise<number> {
    if (this.failNextExpire) {
      const error: Error = this.failNextExpire;
      this.failNextExpire = null;
      throw error;
    }

    this.expires.push({ key, ttlSeconds });
    return 1;
  }

  public keys(): Array<string> {
    return Array.from(this.counters.keys());
  }

  public expiresForKey(key: string): Array<RecordedExpire> {
    return this.expires.filter((recorded: RecordedExpire): boolean => {
      return recorded.key === key;
    });
  }
}

interface BuildRequestOverrides {
  headers?: Record<string, string | Array<string>>;
  socketAddress?: string | undefined;
  ip?: string | undefined;
}

const buildRequest: (overrides?: BuildRequestOverrides) => ExpressRequest = (
  overrides: BuildRequestOverrides = {},
): ExpressRequest => {
  return {
    headers: overrides.headers || {},
    socket: { remoteAddress: overrides.socketAddress },
    ip: overrides.ip,
  } as unknown as ExpressRequest;
};

// A request as it arrives through the bundled Nginx: the proxy appended the peer.
const requestFrom: (clientIp: string, forged?: string) => ExpressRequest = (
  clientIp: string,
  forged?: string,
): ExpressRequest => {
  return buildRequest({
    headers: {
      "x-forwarded-for": forged ? `${forged}, ${clientIp}` : clientIp,
    },
  });
};

interface BuiltResponse {
  response: ExpressResponse;
  headers: Record<string, string>;
}

const buildResponse: () => BuiltResponse = (): BuiltResponse => {
  const headers: Record<string, string> = {};

  const response: ExpressResponse = {
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as ExpressResponse;

  return { response, headers };
};

interface Rejection {
  req: ExpressRequest;
  res: ExpressResponse;
  statusCode: number;
  retryAfterSeconds?: number | undefined;
}

// Every string that reached logger.warn, flattened.
const everythingWarned: () => string = (): string => {
  return loggerWarnMock.mock.calls
    .flat()
    .map((value: unknown): string => {
      if (value instanceof Error) {
        return value.message;
      }

      return typeof value === "string" ? value : JSON.stringify(value);
    })
    .join("\n");
};

let testIndex: number = 0;

describe("McpOAuthRateLimit", () => {
  let client: FakeRedisClient;
  let nowSpy: ReturnType<typeof jest.spyOn>;
  let currentTime: number;

  beforeEach(() => {
    jest.clearAllMocks();

    client = new FakeRedisClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);

    /*
     * Each test starts on a window boundary, a day after the previous one:
     * the limiter remembers when it last logged "counter unavailable", and a
     * day is well past that throttle, so no test inherits another's silence.
     */
    testIndex++;
    currentTime = 1_800_000_000_000 + testIndex * 24 * 60 * 60 * 1000;
    currentTime = currentTime - (currentTime % WINDOW_MS);

    nowSpy = jest.spyOn(Date, "now").mockImplementation((): number => {
      return currentTime;
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  const consume: (data?: {
    bucket?: McpOAuthRateLimitBucket;
    clientIp?: string;
  }) => Promise<McpOAuthRateLimitDecision> = (
    data: { bucket?: McpOAuthRateLimitBucket; clientIp?: string } = {},
  ): Promise<McpOAuthRateLimitDecision> => {
    return McpOAuthRateLimit.consume({
      bucket: data.bucket || McpOAuthRateLimitBucket.Register,
      clientIp: data.clientIp || CLIENT_IP,
    });
  };

  const consumeTimes: (
    count: number,
    data?: { bucket?: McpOAuthRateLimitBucket; clientIp?: string },
  ) => Promise<Array<McpOAuthRateLimitDecision>> = async (
    count: number,
    data: { bucket?: McpOAuthRateLimitBucket; clientIp?: string } = {},
  ): Promise<Array<McpOAuthRateLimitDecision>> => {
    const decisions: Array<McpOAuthRateLimitDecision> = [];

    for (let index: number = 0; index < count; index++) {
      decisions.push(await consume(data));
    }

    return decisions;
  };

  const keyFor: (
    bucket: McpOAuthRateLimitBucket,
    clientIp: string,
    at?: number,
  ) => string = (
    bucket: McpOAuthRateLimitBucket,
    clientIp: string,
    at?: number,
  ): string => {
    const windowIndex: number = Math.floor((at ?? currentTime) / WINDOW_MS);

    return `mcpoauth:rl:${bucket}:${clientIp}:${windowIndex}`;
  };

  describe("budgets", () => {
    it.each(LIMITS)(
      "the %s bucket allows %i requests per window",
      (bucket: McpOAuthRateLimitBucket, limit: number) => {
        expect(McpOAuthRateLimit.getLimit(bucket)).toBe(limit);
      },
    );

    it("has exactly the five buckets - an endpoint without a budget would be an endpoint without a limit", () => {
      expect(Object.values(McpOAuthRateLimitBucket).sort()).toEqual(
        LIMITS.map(([bucket]: [McpOAuthRateLimitBucket, number]): string => {
          return bucket;
        }).sort(),
      );
    });

    it("registration - the anonymous database write - has the smallest budget", () => {
      const registerLimit: number = McpOAuthRateLimit.getLimit(
        McpOAuthRateLimitBucket.Register,
      );

      for (const [bucket, limit] of LIMITS) {
        if (bucket !== McpOAuthRateLimitBucket.Register) {
          expect(limit).toBeGreaterThan(registerLimit);
        }
      }
    });
  });

  describe("consume", () => {
    it.each(LIMITS)(
      "%s: request number %i is the last one allowed, and the next is refused",
      async (bucket: McpOAuthRateLimitBucket, limit: number) => {
        const allowed: Array<McpOAuthRateLimitDecision> = await consumeTimes(
          limit,
          { bucket },
        );

        for (const decision of allowed) {
          expect(decision.outcome).toBe(McpOAuthRateLimitOutcome.Allowed);
        }

        const refused: McpOAuthRateLimitDecision = await consume({ bucket });

        expect(refused.outcome).toBe(McpOAuthRateLimitOutcome.RateLimited);
      },
    );

    it("an allowed request carries no retry hint", async () => {
      const decision: McpOAuthRateLimitDecision = await consume();

      expect(decision).toEqual({ outcome: McpOAuthRateLimitOutcome.Allowed });
    });

    it("counts in one key per bucket, per address, per window", async () => {
      await consumeTimes(3);

      expect(client.keys()).toEqual([
        keyFor(McpOAuthRateLimitBucket.Register, CLIENT_IP),
      ]);
      expect(
        client.counters.get(
          keyFor(McpOAuthRateLimitBucket.Register, CLIENT_IP),
        ),
      ).toBe(3);
    });

    it("costs exactly one INCR per request", async () => {
      await consumeTimes(5);

      expect(client.incrCallCount).toBe(5);
    });

    it("sets the key's expiry only on the write that created it, at twice the window", async () => {
      await consumeTimes(10);

      const key: string = keyFor(McpOAuthRateLimitBucket.Register, CLIENT_IP);

      expect(client.expiresForKey(key)).toEqual([
        { key, ttlSeconds: WINDOW_SECONDS * 2 },
      ]);
    });

    it("does not re-issue the expiry for refused requests either: a flood cannot keep its own window alive", async () => {
      await consumeTimes(60 + 25);

      const key: string = keyFor(McpOAuthRateLimitBucket.Register, CLIENT_IP);

      expect(client.expiresForKey(key)).toHaveLength(1);
    });

    it("tells the first refusal in a window apart from the ones after it", async () => {
      await consumeTimes(60);

      const first: McpOAuthRateLimitDecision = await consume();
      const second: McpOAuthRateLimitDecision = await consume();
      const third: McpOAuthRateLimitDecision = await consume();

      expect(first.isFirstRejectionInWindow).toBe(true);
      expect(second.isFirstRejectionInWindow).toBe(false);
      expect(third.isFirstRejectionInWindow).toBe(false);
    });

    it("says how long until the window ends: the whole window at its start", async () => {
      await consumeTimes(60);

      const refused: McpOAuthRateLimitDecision = await consume();

      expect(refused.retryAfterSeconds).toBe(WINDOW_SECONDS);
    });

    it("says how long until the window ends: what is left of it, part-way through", async () => {
      await consumeTimes(60);

      currentTime += 10 * 60 * 1000;

      const refused: McpOAuthRateLimitDecision = await consume();

      expect(refused.retryAfterSeconds).toBe(5 * 60);
    });

    it("rounds the retry hint UP to a whole second: a caller told to wait is never told too little", async () => {
      await consumeTimes(60);

      // A second and a half of the window is left.
      currentTime += WINDOW_MS - 1500;

      const refused: McpOAuthRateLimitDecision = await consume();

      expect(refused.retryAfterSeconds).toBe(2);
    });

    it("never hints zero, even a millisecond before the window ends", async () => {
      await consumeTimes(60);

      currentTime += WINDOW_MS - 1;

      const refused: McpOAuthRateLimitDecision = await consume();

      expect(refused.outcome).toBe(McpOAuthRateLimitOutcome.RateLimited);
      expect(refused.retryAfterSeconds).toBe(1);
    });

    it("a refused caller is allowed again when the next window opens", async () => {
      await consumeTimes(61);

      currentTime += WINDOW_MS;

      const decision: McpOAuthRateLimitDecision = await consume();

      expect(decision.outcome).toBe(McpOAuthRateLimitOutcome.Allowed);
      expect(client.keys()).toEqual([
        keyFor(
          McpOAuthRateLimitBucket.Register,
          CLIENT_IP,
          currentTime - WINDOW_MS,
        ),
        keyFor(McpOAuthRateLimitBucket.Register, CLIENT_IP),
      ]);
    });

    it("the window is fixed, not sliding: requests late in a window do not carry into the next", async () => {
      // Spend most of the budget in the last minute of a window...
      currentTime += WINDOW_MS - 60 * 1000;
      await consumeTimes(59);

      // ...and the next window starts from zero a minute later.
      currentTime += 60 * 1000;

      const decisions: Array<McpOAuthRateLimitDecision> =
        await consumeTimes(60);

      for (const decision of decisions) {
        expect(decision.outcome).toBe(McpOAuthRateLimitOutcome.Allowed);
      }

      expect((await consume()).outcome).toBe(
        McpOAuthRateLimitOutcome.RateLimited,
      );
    });

    it("the limit still applies at the very end of the window", async () => {
      await consumeTimes(60);

      currentTime += WINDOW_MS - 1;

      expect((await consume()).outcome).toBe(
        McpOAuthRateLimitOutcome.RateLimited,
      );
    });

    it("exhausting one bucket leaves the same address's other buckets alone", async () => {
      await consumeTimes(61, { bucket: McpOAuthRateLimitBucket.Register });

      for (const bucket of FAIL_OPEN_BUCKETS) {
        expect((await consume({ bucket })).outcome).toBe(
          McpOAuthRateLimitOutcome.Allowed,
        );
      }

      expect(
        (await consume({ bucket: McpOAuthRateLimitBucket.Register })).outcome,
      ).toBe(McpOAuthRateLimitOutcome.RateLimited);
    });

    it("one address exhausting its budget does not refuse another address", async () => {
      await consumeTimes(61, { clientIp: CLIENT_IP });

      expect((await consume({ clientIp: OTHER_CLIENT_IP })).outcome).toBe(
        McpOAuthRateLimitOutcome.Allowed,
      );
      expect((await consume({ clientIp: CLIENT_IP })).outcome).toBe(
        McpOAuthRateLimitOutcome.RateLimited,
      );
    });

    describe("with no counter to count in", () => {
      it("Redis disconnected: says so, and asks Redis nothing", async () => {
        isConnectedMock.mockReturnValue(false);

        const decision: McpOAuthRateLimitDecision = await consume();

        expect(decision).toEqual({
          outcome: McpOAuthRateLimitOutcome.CounterUnavailable,
        });
        expect(client.incrCallCount).toBe(0);
      });

      it("no Redis client at all: says so", async () => {
        getClientMock.mockReturnValue(null);

        expect(await consume()).toEqual({
          outcome: McpOAuthRateLimitOutcome.CounterUnavailable,
        });
      });

      it("INCR failing: says so instead of throwing", async () => {
        client.failNextIncr = new Error("connection reset");

        await expect(consume()).resolves.toEqual({
          outcome: McpOAuthRateLimitOutcome.CounterUnavailable,
        });
      });

      it("EXPIRE failing: says so instead of throwing", async () => {
        client.failNextExpire = new Error("connection reset");

        await expect(consume()).resolves.toEqual({
          outcome: McpOAuthRateLimitOutcome.CounterUnavailable,
        });
      });

      it.each([
        ["a string", "7"],
        ["null", null],
        ["an object", { count: 7 }],
      ])(
        "INCR answering %s instead of a number: says so, and never reads it as 'under the limit'",
        async (_label: string, result: unknown) => {
          client.nextIncrResult = result;

          const decision: McpOAuthRateLimitDecision = await consume();

          expect(decision.outcome).toBe(
            McpOAuthRateLimitOutcome.CounterUnavailable,
          );
          expect(client.expires).toHaveLength(0);
        },
      );

      it("logs a counter failure, with the bucket and the address", async () => {
        client.failNextIncr = new Error("connection reset");

        await consume({ bucket: McpOAuthRateLimitBucket.Token });

        expect(everythingWarned()).toContain(McpOAuthRateLimitBucket.Token);
        expect(everythingWarned()).toContain(CLIENT_IP);
        expect(everythingWarned()).toContain("connection reset");
      });

      it("logs a persisting counter failure once a minute, not once per request", async () => {
        client.failNextIncr = new Error("connection reset");
        await consume();

        const warningsAfterFirst: number = loggerWarnMock.mock.calls.length;

        expect(warningsAfterFirst).toBeGreaterThan(0);

        for (let index: number = 0; index < 20; index++) {
          client.failNextIncr = new Error("connection reset");
          await consume();
        }

        expect(loggerWarnMock.mock.calls.length).toBe(warningsAfterFirst);

        currentTime += 60 * 1000;
        client.failNextIncr = new Error("connection reset");
        await consume();

        expect(loggerWarnMock.mock.calls.length).toBe(warningsAfterFirst * 2);
      });

      it("recovers as soon as the counter does", async () => {
        client.failNextIncr = new Error("connection reset");

        expect((await consume()).outcome).toBe(
          McpOAuthRateLimitOutcome.CounterUnavailable,
        );
        expect((await consume()).outcome).toBe(
          McpOAuthRateLimitOutcome.Allowed,
        );
      });
    });
  });

  describe("resolveClientIp", () => {
    it("bills the hop our own proxy appended, not the one the caller forged", () => {
      expect(
        McpOAuthRateLimit.resolveClientIp(
          buildRequest({
            headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.7" },
          }),
        ),
      ).toBe("203.0.113.7");
    });

    it("is unaffected by however many entries the caller forges", () => {
      const forged: string = Array.from(
        { length: 50 },
        (_unused: unknown, index: number): string => {
          return `10.0.0.${index}`;
        },
      ).join(", ");

      expect(
        McpOAuthRateLimit.resolveClientIp(
          buildRequest({
            headers: { "x-forwarded-for": `${forged}, 203.0.113.7` },
          }),
        ),
      ).toBe("203.0.113.7");
    });

    it("refuses an empty trusted position rather than walking left onto caller data", () => {
      expect(
        McpOAuthRateLimit.resolveClientIp(
          buildRequest({
            headers: { "x-forwarded-for": "9.9.9.9, , 203.0.113.7 , " },
          }),
        ),
      ).toBe("unknown");
    });

    it("falls back to the socket address with no forwarding header", () => {
      expect(
        McpOAuthRateLimit.resolveClientIp(
          buildRequest({ socketAddress: "198.51.100.4" }),
        ),
      ).toBe("198.51.100.4");
    });

    it("falls back to req.ip when there is no socket address", () => {
      expect(
        McpOAuthRateLimit.resolveClientIp(buildRequest({ ip: "198.51.100.9" })),
      ).toBe("198.51.100.9");
    });

    it("puts wholly unidentifiable callers in one shared bucket", () => {
      expect(McpOAuthRateLimit.resolveClientIp(buildRequest())).toBe("unknown");
    });

    it("preserves IPv6 addresses", () => {
      expect(
        McpOAuthRateLimit.resolveClientIp(
          buildRequest({
            headers: { "x-forwarded-for": "2001:db8::8a2e:370:7334" },
          }),
        ),
      ).toBe("2001:db8::8a2e:370:7334");
    });

    it("an over-long header value is not an address, and cannot bloat a Redis key", () => {
      const resolved: string = McpOAuthRateLimit.resolveClientIp(
        buildRequest({ headers: { "x-forwarded-for": "a".repeat(5000) } }),
      );

      expect(resolved.length).toBeLessThanOrEqual(64);
    });

    it("replaces anything that is not an address character before it goes into a key", () => {
      resolveTrustedClientIpMock.mockReturnValueOnce(
        "203.0.113.7\r\nDEL mcpoauth:rl:* /etc",
      );

      const resolved: string =
        McpOAuthRateLimit.resolveClientIp(buildRequest());

      expect(resolved).toBe("203.0.113.7__DEL_mcpoauth:rl:___etc");
      expect(resolved).toMatch(/^[a-zA-Z0-9._:%\-[\]]+$/);
    });

    it("caps whatever it is handed at 64 characters", () => {
      resolveTrustedClientIpMock.mockReturnValueOnce("f".repeat(500));

      expect(McpOAuthRateLimit.resolveClientIp(buildRequest())).toBe(
        "f".repeat(64),
      );
    });

    it("keeps a bracketed IPv6 literal and a zone id intact", () => {
      resolveTrustedClientIpMock.mockReturnValueOnce("[fe80::1%eth0]");

      expect(McpOAuthRateLimit.resolveClientIp(buildRequest())).toBe(
        "[fe80::1%eth0]",
      );
    });
  });

  describe("getMiddleware", () => {
    interface Harness {
      rejections: Array<Rejection>;
      next: MockedFn;
      run: (req?: ExpressRequest) => Promise<BuiltResponse>;
    }

    const harness: (bucket: McpOAuthRateLimitBucket) => Harness = (
      bucket: McpOAuthRateLimitBucket,
    ): Harness => {
      const rejections: Array<Rejection> = [];
      const next: MockedFn = jest.fn();

      const onRejected: McpOAuthRateLimitRejectionHandler = (
        data: Rejection,
      ): void => {
        rejections.push(data);
      };

      const middleware: (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => Promise<void> = McpOAuthRateLimit.getMiddleware(bucket, onRejected);

      const run: (req?: ExpressRequest) => Promise<BuiltResponse> = async (
        req?: ExpressRequest,
      ): Promise<BuiltResponse> => {
        const built: BuiltResponse = buildResponse();

        await middleware(
          req || requestFrom(CLIENT_IP),
          built.response,
          next as unknown as NextFunction,
        );

        return built;
      };

      return { rejections, next, run };
    };

    it("lets a request under the limit through, untouched", async () => {
      const { rejections, next, run } = harness(McpOAuthRateLimitBucket.Token);

      const built: BuiltResponse = await run();

      expect(next).toHaveBeenCalledTimes(1);
      // next() with no argument: an argument would be routed as an error.
      expect(next.mock.calls[0]).toEqual([]);
      expect(rejections).toHaveLength(0);
      expect(built.headers).toEqual({});
    });

    it("counts in the bucket it was made for", async () => {
      await harness(McpOAuthRateLimitBucket.Revoke).run();

      expect(client.keys()).toEqual([
        keyFor(McpOAuthRateLimitBucket.Revoke, CLIENT_IP),
      ]);
    });

    it("refuses a request over the limit with 429 and never calls next", async () => {
      const { rejections, next, run } = harness(
        McpOAuthRateLimitBucket.Register,
      );

      for (let index: number = 0; index < 60; index++) {
        await run();
      }

      expect(next).toHaveBeenCalledTimes(60);

      const request: ExpressRequest = requestFrom(CLIENT_IP);
      const built: BuiltResponse = await run(request);

      expect(next).toHaveBeenCalledTimes(60);
      expect(rejections).toHaveLength(1);
      expect(rejections[0]!.statusCode).toBe(429);
      // The handler is given the request and response to answer on.
      expect(rejections[0]!.req).toBe(request);
      expect(rejections[0]!.res).toBe(built.response);
    });

    it("tells a refused caller when to come back, in the header and to the handler", async () => {
      const { rejections, run } = harness(McpOAuthRateLimitBucket.Register);

      for (let index: number = 0; index < 60; index++) {
        await run();
      }

      currentTime += 5 * 60 * 1000;

      const built: BuiltResponse = await run();

      expect(built.headers["Retry-After"]).toBe("600");
      expect(rejections[0]!.retryAfterSeconds).toBe(600);
    });

    it("the handler writes the refusal: the middleware itself sends no body and no status", async () => {
      const { run } = harness(McpOAuthRateLimitBucket.Register);

      for (let index: number = 0; index < 60; index++) {
        await run();
      }

      /*
       * buildResponse() has setHeader and nothing else, so a middleware that
       * tried res.status() or res.json() would throw here.
       */
      await expect(run()).resolves.toBeDefined();
    });

    it("logs one line per address per window, not one per refused request", async () => {
      const { run } = harness(McpOAuthRateLimitBucket.Register);

      for (let index: number = 0; index < 60 + 15; index++) {
        await run();
      }

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
      expect(everythingWarned()).toContain(McpOAuthRateLimitBucket.Register);
      expect(everythingWarned()).toContain(CLIENT_IP);
    });

    it("bills the request to the address our proxy wrote: forging a new leftmost entry per request buys nothing", async () => {
      const { rejections, next, run } = harness(
        McpOAuthRateLimitBucket.Register,
      );

      for (let index: number = 0; index < 61; index++) {
        await run(requestFrom(CLIENT_IP, `10.9.${index}.1`));
      }

      expect(next).toHaveBeenCalledTimes(60);
      expect(rejections).toHaveLength(1);
      expect(client.keys()).toEqual([
        keyFor(McpOAuthRateLimitBucket.Register, CLIENT_IP),
      ]);
    });

    it("two real addresses behind the proxy have a budget each", async () => {
      const { rejections, run } = harness(McpOAuthRateLimitBucket.Register);

      for (let index: number = 0; index < 61; index++) {
        await run(requestFrom(CLIENT_IP));
      }

      await run(requestFrom(OTHER_CLIENT_IP));

      expect(rejections).toHaveLength(1);
    });

    describe("when the counter is unavailable", () => {
      beforeEach(() => {
        isConnectedMock.mockReturnValue(false);
      });

      it("registration fails CLOSED: 503 through the handler, and next is never called", async () => {
        const { rejections, next, run } = harness(
          McpOAuthRateLimitBucket.Register,
        );

        const built: BuiltResponse = await run();

        expect(next).not.toHaveBeenCalled();
        expect(rejections).toHaveLength(1);
        expect(rejections[0]!.statusCode).toBe(503);
        // Nothing to wait for: there is no window to come back in.
        expect(rejections[0]!.retryAfterSeconds).toBeUndefined();
        expect(built.headers).toEqual({});
      });

      it("registration stays closed for every request while it lasts", async () => {
        const { rejections, next, run } = harness(
          McpOAuthRateLimitBucket.Register,
        );

        for (let index: number = 0; index < 5; index++) {
          await run();
        }

        expect(next).not.toHaveBeenCalled();
        expect(rejections).toHaveLength(5);
      });

      it.each(FAIL_OPEN_BUCKETS)(
        "%s fails OPEN: a Redis blip must not sign every connected client out",
        async (bucket: McpOAuthRateLimitBucket) => {
          const { rejections, next, run } = harness(bucket);

          await run();

          expect(next).toHaveBeenCalledTimes(1);
          expect(next.mock.calls[0]).toEqual([]);
          expect(rejections).toHaveLength(0);
        },
      );

      it("says in the log that requests are going through unthrottled - once a minute, not once per request", async () => {
        const { run } = harness(McpOAuthRateLimitBucket.Token);

        for (let index: number = 0; index < 25; index++) {
          await run();
        }

        expect(loggerWarnMock).toHaveBeenCalledTimes(1);
        expect(everythingWarned()).toContain(McpOAuthRateLimitBucket.Token);

        currentTime += 60 * 1000;
        await run();

        expect(loggerWarnMock).toHaveBeenCalledTimes(2);
      });

      it("a counter that throws is handled the same way as one that is absent", async () => {
        isConnectedMock.mockReturnValue(true);

        const register: Harness = harness(McpOAuthRateLimitBucket.Register);
        const token: Harness = harness(McpOAuthRateLimitBucket.Token);

        client.failNextIncr = new Error("connection reset");
        await register.run();

        client.failNextIncr = new Error("connection reset");
        await token.run();

        expect(register.next).not.toHaveBeenCalled();
        expect(register.rejections[0]!.statusCode).toBe(503);
        expect(token.next).toHaveBeenCalledTimes(1);
        expect(token.rejections).toHaveLength(0);
      });
    });
  });
});
