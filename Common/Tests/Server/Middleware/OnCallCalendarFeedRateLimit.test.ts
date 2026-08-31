import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The rate limiter in front of the public on-call calendar feed routes.
 *
 * Beyond "does it count", the properties that decide whether the limit can be
 * walked around or can leak the credential it guards: that the client address
 * is taken from the hop OUR proxy wrote rather than the one the caller can
 * forge; that rotating tokens does not buy a fresh allowance; that the window
 * does not slide forward under sustained load; that a Redis outage fails OPEN
 * (this is load control, the route behind it still checks the token); and --
 * the one that is specific to this limiter -- that the token never appears in
 * a Redis key or a log line, in any form.
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
import OnCallCalendarFeedRateLimit, {
  ON_CALL_CALENDAR_FEED_TOKEN_PATTERN,
  OnCallCalendarFeedRateLimitDecision,
  OnCallCalendarFeedRateLimitOutcome,
  OnCallCalendarFeedRateLimitScope,
} from "../../../Server/Middleware/OnCallCalendarFeedRateLimit";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import Exception from "../../../Types/Exception/Exception";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { createHash, randomBytes } from "crypto";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;
const loggerWarnMock: MockedFn = logger.warn as unknown as MockedFn;
const loggerErrorMock: MockedFn = logger.error as unknown as MockedFn;
const loggerInfoMock: MockedFn = logger.info as unknown as MockedFn;
const loggerDebugMock: MockedFn = logger.debug as unknown as MockedFn;

/* Defaults baked into EnvironmentConfig; asserted directly in one test. */
const WINDOW_SECONDS: number = 60;
const PER_TOKEN_LIMIT: number = 60;
const PER_IP_LIMIT: number = 3000;

/* A token exactly as the feed routes mint them: 32 random bytes, base64url. */
function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

const TOKEN_A: string = mintToken();
const TOKEN_B: string = mintToken();

/*
 * A fake that behaves like a Redis counter store rather than a bag of
 * assertions: INCR really increments and EXPIRE really records a TTL, so the
 * window/reset/pinning tests exercise the limiter's arithmetic instead of
 * restating it.
 */
interface RecordedExpire {
  key: string;
  ttlSeconds: number;
}

class FakeRedisClient {
  public counters: Map<string, number> = new Map();
  public expires: Array<RecordedExpire> = [];
  public failNextExec: Error | null = null;
  public malformedExecResult: unknown | undefined = undefined;
  public incrCallCount: number = 0;

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
  }

  public keys(): Array<string> {
    return Array.from(this.counters.keys());
  }

  public expiresForKey(key: string): Array<RecordedExpire> {
    return this.expires.filter((recorded: RecordedExpire) => {
      return recorded.key === key;
    });
  }
}

type QueuedCommand = () => [Error | null, unknown];

class FakePipeline {
  private commands: Array<QueuedCommand> = [];

  public constructor(private client: FakeRedisClient) {}

  public incr(key: string): FakePipeline {
    this.commands.push((): [Error | null, unknown] => {
      this.client.incrCallCount++;
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

    if (typeof this.client.malformedExecResult !== "undefined") {
      const result: unknown = this.client.malformedExecResult;
      this.client.malformedExecResult = undefined;
      return result;
    }

    return this.commands.map((command: QueuedCommand) => {
      return command();
    });
  }
}

interface BuildRequestOverrides {
  token?: string | undefined;
  params?: Record<string, string>;
  headers?: Record<string, string | Array<string>>;
  socketAddress?: string | undefined;
  ip?: string | undefined;
}

const buildRequest: (overrides?: BuildRequestOverrides) => ExpressRequest = (
  overrides: BuildRequestOverrides = {},
) => {
  const params: Record<string, string> = { ...(overrides.params || {}) };

  if (overrides.token !== undefined) {
    params["token"] = overrides.token;
  }

  return {
    params,
    headers: overrides.headers || {},
    socket: { remoteAddress: overrides.socketAddress },
    ip: overrides.ip,
  } as unknown as ExpressRequest;
};

interface BuiltResponse {
  response: ExpressResponse;
  headers: Record<string, string>;
}

const buildResponse: () => BuiltResponse = () => {
  const headers: Record<string, string> = {};

  const response: ExpressResponse = {
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as ExpressResponse;

  return { response, headers };
};

/* Every string that reached any logger method, flattened. */
function everythingLogged(): string {
  const mocks: Array<MockedFn> = [
    loggerWarnMock,
    loggerErrorMock,
    loggerInfoMock,
    loggerDebugMock,
  ];

  return mocks
    .flatMap((mock: MockedFn) => {
      return mock.mock.calls.flat();
    })
    .map((value: unknown) => {
      if (value instanceof Error) {
        return `${value.message} ${value.stack || ""}`;
      }

      if (typeof value === "string") {
        return value;
      }

      return JSON.stringify(value);
    })
    .join("\n");
}

describe("OnCallCalendarFeedRateLimit", () => {
  let client: FakeRedisClient;
  let nowSpy: ReturnType<typeof jest.spyOn>;
  let currentTime: number;

  beforeEach(() => {
    jest.clearAllMocks();

    client = new FakeRedisClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);

    currentTime = 1_700_000_000_000;
    currentTime = currentTime - (currentTime % (WINDOW_SECONDS * 1000));
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
      return currentTime;
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  const consume: (data: {
    tokenKey?: string;
    clientIp?: string;
  }) => Promise<OnCallCalendarFeedRateLimitDecision> = (data: {
    tokenKey?: string;
    clientIp?: string;
  }) => {
    return OnCallCalendarFeedRateLimit.consume({
      tokenKey: data.tokenKey || OnCallCalendarFeedRateLimit.hashToken(TOKEN_A),
      clientIp: data.clientIp || "203.0.113.7",
    });
  };

  describe("configuration", () => {
    it("ships the documented defaults", () => {
      expect(OnCallCalendarFeedRateLimit.getConfig()).toEqual({
        windowSeconds: WINDOW_SECONDS,
        perTokenLimit: PER_TOKEN_LIMIT,
        perIpLimit: PER_IP_LIMIT,
      });
    });

    it("hands back a copy, so a caller cannot mutate the limits", () => {
      const config: { perTokenLimit: number } =
        OnCallCalendarFeedRateLimit.getConfig();

      config.perTokenLimit = 1;

      expect(OnCallCalendarFeedRateLimit.getConfig().perTokenLimit).toBe(
        PER_TOKEN_LIMIT,
      );
    });

    it("accepts exactly the 43-character base64url token shape", () => {
      expect(ON_CALL_CALENDAR_FEED_TOKEN_PATTERN.test(TOKEN_A)).toBe(true);
      expect(TOKEN_A).toHaveLength(43);
      expect(ON_CALL_CALENDAR_FEED_TOKEN_PATTERN.test(`${TOKEN_A}=`)).toBe(
        false,
      );
      expect(ON_CALL_CALENDAR_FEED_TOKEN_PATTERN.test(TOKEN_A.slice(1))).toBe(
        false,
      );
      expect(
        ON_CALL_CALENDAR_FEED_TOKEN_PATTERN.test(
          `${TOKEN_A.slice(0, 42)}+`.replace("+", "/"),
        ),
      ).toBe(false);
    });
  });

  describe("resolveClientIp", () => {
    it("bills the hop our own proxy appended, not the one the caller forged", () => {
      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.7" },
      });

      expect(OnCallCalendarFeedRateLimit.resolveClientIp(request)).toBe(
        "203.0.113.7",
      );
    });

    it("is unaffected by however many entries the caller forges", () => {
      const forged: string = Array.from(
        { length: 50 },
        (_unused: unknown, index: number) => {
          return `10.0.0.${index}`;
        },
      ).join(", ");

      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": `${forged}, 203.0.113.7` },
      });

      expect(OnCallCalendarFeedRateLimit.resolveClientIp(request)).toBe(
        "203.0.113.7",
      );
    });

    it("refuses an empty trusted position rather than walking left onto caller data", () => {
      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": "9.9.9.9, , 203.0.113.7 , " },
      });

      expect(OnCallCalendarFeedRateLimit.resolveClientIp(request)).toBe(
        "unknown",
      );
    });

    it("falls back to the socket address with no forwarding header", () => {
      const request: ExpressRequest = buildRequest({
        socketAddress: "198.51.100.4",
      });

      expect(OnCallCalendarFeedRateLimit.resolveClientIp(request)).toBe(
        "198.51.100.4",
      );
    });

    it("falls back to req.ip when there is no socket address", () => {
      const request: ExpressRequest = buildRequest({ ip: "198.51.100.9" });

      expect(OnCallCalendarFeedRateLimit.resolveClientIp(request)).toBe(
        "198.51.100.9",
      );
    });

    it("puts wholly unidentifiable callers in one shared bucket", () => {
      expect(OnCallCalendarFeedRateLimit.resolveClientIp(buildRequest())).toBe(
        "unknown",
      );
    });

    it("preserves IPv6 addresses", () => {
      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": "2001:db8::8a2e:370:7334" },
      });

      expect(OnCallCalendarFeedRateLimit.resolveClientIp(request)).toBe(
        "2001:db8::8a2e:370:7334",
      );
    });

    it("truncates an over-long address so it cannot bloat a Redis key", () => {
      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": "a".repeat(5000) },
      });

      expect(
        OnCallCalendarFeedRateLimit.resolveClientIp(request).length,
      ).toBeLessThanOrEqual(64);
    });
  });

  describe("resolveTokenKey", () => {
    it("never contains the token itself", () => {
      const key: string = OnCallCalendarFeedRateLimit.resolveTokenKey(
        buildRequest({ token: TOKEN_A }),
      );

      expect(key).not.toContain(TOKEN_A);
      /* Nor any substantial substring of it. */
      expect(key).not.toContain(TOKEN_A.slice(0, 8));
      expect(key).not.toContain(TOKEN_A.slice(-8));
    });

    it("is a truncated SHA-256 of the token", () => {
      const expected: string = createHash("sha256")
        .update(TOKEN_A, "utf8")
        .digest("hex")
        .slice(0, 16);

      expect(
        OnCallCalendarFeedRateLimit.resolveTokenKey(
          buildRequest({ token: TOKEN_A }),
        ),
      ).toBe(`t:${expected}`);
    });

    it("is stable for the same token and distinct for different tokens", () => {
      const first: string = OnCallCalendarFeedRateLimit.resolveTokenKey(
        buildRequest({ token: TOKEN_A }),
      );
      const again: string = OnCallCalendarFeedRateLimit.resolveTokenKey(
        buildRequest({ token: TOKEN_A }),
      );
      const other: string = OnCallCalendarFeedRateLimit.resolveTokenKey(
        buildRequest({ token: TOKEN_B }),
      );

      expect(first).toBe(again);
      expect(first).not.toBe(other);
    });

    it("agrees with hashToken, so a route holding the token builds the same key", () => {
      expect(
        OnCallCalendarFeedRateLimit.resolveTokenKey(
          buildRequest({ token: TOKEN_A }),
        ),
      ).toBe(OnCallCalendarFeedRateLimit.hashToken(TOKEN_A));
    });

    it("ignores surrounding whitespace", () => {
      expect(
        OnCallCalendarFeedRateLimit.resolveTokenKey(
          buildRequest({ token: `  ${TOKEN_A}  ` }),
        ),
      ).toBe(OnCallCalendarFeedRateLimit.hashToken(TOKEN_A));
    });

    it("collapses anything not shaped like a token to one shared bucket", () => {
      for (const junk of [
        "abc",
        TOKEN_A.slice(1),
        `${TOKEN_A}x`,
        "a".repeat(43).replace("a", "+"),
        "../../etc/passwd",
        "x".repeat(5000),
      ]) {
        expect(
          OnCallCalendarFeedRateLimit.resolveTokenKey(
            buildRequest({ token: junk }),
          ),
        ).toBe("invalid");
      }
    });

    it("uses a stable key when no token is present at all", () => {
      expect(OnCallCalendarFeedRateLimit.resolveTokenKey(buildRequest())).toBe(
        "none",
      );
      expect(
        OnCallCalendarFeedRateLimit.resolveTokenKey(
          buildRequest({ token: "" }),
        ),
      ).toBe("none");
      expect(
        OnCallCalendarFeedRateLimit.resolveTokenKey(
          buildRequest({ token: "   " }),
        ),
      ).toBe("none");
    });

    it("does not throw when params is missing entirely", () => {
      expect(
        OnCallCalendarFeedRateLimit.resolveTokenKey({
          headers: {},
        } as unknown as ExpressRequest),
      ).toBe("none");
    });

    it("ignores a non-string token parameter", () => {
      expect(
        OnCallCalendarFeedRateLimit.resolveTokenKey({
          params: { token: 42 },
          headers: {},
        } as unknown as ExpressRequest),
      ).toBe("none");
    });
  });

  describe("consume - per token budget", () => {
    it("allows requests up to the limit", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT; i++) {
        const decision: OnCallCalendarFeedRateLimitDecision = await consume({});

        expect(decision.outcome).toBe(
          OnCallCalendarFeedRateLimitOutcome.Allowed,
        );
      }
    });

    it("rejects the request after the limit with a token scope", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT; i++) {
        await consume({});
      }

      const decision: OnCallCalendarFeedRateLimitDecision = await consume({});

      expect(decision.outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.RateLimited,
      );
      expect(decision.scope).toBe(OnCallCalendarFeedRateLimitScope.Token);
      expect(decision.isFirstRejectionInWindow).toBe(true);
    });

    it("marks only the crossing request as the first rejection", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT + 1; i++) {
        await consume({});
      }

      const decision: OnCallCalendarFeedRateLimitDecision = await consume({});

      expect(decision.outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.RateLimited,
      );
      expect(decision.isFirstRejectionInWindow).toBe(false);
    });

    it("keeps separate budgets for separate client addresses", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT; i++) {
        await consume({ clientIp: "203.0.113.7" });
      }

      const decision: OnCallCalendarFeedRateLimitDecision = await consume({
        clientIp: "203.0.113.8",
      });

      expect(decision.outcome).toBe(OnCallCalendarFeedRateLimitOutcome.Allowed);
    });

    it("keeps separate budgets for separate tokens on one address", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT; i++) {
        await consume({
          tokenKey: OnCallCalendarFeedRateLimit.hashToken(TOKEN_A),
        });
      }

      const decision: OnCallCalendarFeedRateLimitDecision = await consume({
        tokenKey: OnCallCalendarFeedRateLimit.hashToken(TOKEN_B),
      });

      expect(decision.outcome).toBe(OnCallCalendarFeedRateLimitOutcome.Allowed);
    });

    it("gives every junk token one small shared budget", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT; i++) {
        await consume({ tokenKey: "invalid" });
      }

      const decision: OnCallCalendarFeedRateLimitDecision = await consume({
        tokenKey: "invalid",
      });

      expect(decision.outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.RateLimited,
      );
    });
  });

  describe("consume - per address ceiling", () => {
    /*
     * The token counter is trivially bypassed by rotating tokens; the address
     * counter is the ceiling that survives it. Every guess at a token costs a
     * Postgres lookup, so guessing must be bounded per address regardless of
     * how many distinct guesses are made.
     */
    it("stops an attacker who rotates the token on every request", async () => {
      let rejected: OnCallCalendarFeedRateLimitDecision | null = null;

      for (let i: number = 0; i < PER_IP_LIMIT + 1; i++) {
        const decision: OnCallCalendarFeedRateLimitDecision = await consume({
          tokenKey: OnCallCalendarFeedRateLimit.hashToken(mintToken()),
        });

        if (
          decision.outcome === OnCallCalendarFeedRateLimitOutcome.RateLimited
        ) {
          rejected = decision;
          break;
        }
      }

      expect(rejected).not.toBeNull();
      expect(rejected?.scope).toBe(OnCallCalendarFeedRateLimitScope.Ip);
      expect(rejected?.isFirstRejectionInWindow).toBe(true);
    });

    it("does not let one address's ceiling affect another", async () => {
      for (let i: number = 0; i < PER_IP_LIMIT; i++) {
        await consume({
          tokenKey: OnCallCalendarFeedRateLimit.hashToken(mintToken()),
          clientIp: "203.0.113.7",
        });
      }

      const decision: OnCallCalendarFeedRateLimitDecision = await consume({
        clientIp: "203.0.113.8",
      });

      expect(decision.outcome).toBe(OnCallCalendarFeedRateLimitOutcome.Allowed);
    });

    it("reports the token scope first when both counters are over", async () => {
      for (let i: number = 0; i < PER_IP_LIMIT; i++) {
        await consume({});
      }

      const decision: OnCallCalendarFeedRateLimitDecision = await consume({});

      expect(decision.outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.RateLimited,
      );
      expect(decision.scope).toBe(OnCallCalendarFeedRateLimitScope.Token);
    });
  });

  describe("consume - Redis keys", () => {
    it("never writes the token into a Redis key", async () => {
      await OnCallCalendarFeedRateLimit.getMiddleware()(
        buildRequest({
          token: TOKEN_A,
          headers: { "x-forwarded-for": "203.0.113.7" },
        }),
        buildResponse().response,
        (() => {}) as unknown as NextFunction,
      );

      expect(client.keys().length).toBeGreaterThan(0);

      for (const key of client.keys()) {
        expect(key).not.toContain(TOKEN_A);
        expect(key).not.toContain(TOKEN_A.slice(0, 8));
      }
    });

    it("namespaces its keys away from the other limiters", async () => {
      await consume({});

      for (const key of client.keys()) {
        expect(key.startsWith("oncal:rl:")).toBe(true);
      }
    });

    it("writes exactly one token counter and one address counter per request", async () => {
      await consume({});

      expect(client.keys()).toHaveLength(2);
      expect(
        client.keys().filter((key: string) => {
          return key.startsWith("oncal:rl:t:");
        }),
      ).toHaveLength(1);
      expect(
        client.keys().filter((key: string) => {
          return key.startsWith("oncal:rl:i:");
        }),
      ).toHaveLength(1);
    });
  });

  describe("consume - window behaviour", () => {
    it("sets a TTL only on the request that created the counter", async () => {
      await consume({});

      expect(client.expires).toHaveLength(2);

      await consume({});

      expect(client.expires).toHaveLength(2);
    });

    it("gives the counter a TTL longer than its own window", async () => {
      await consume({});

      for (const recorded of client.expires) {
        expect(recorded.ttlSeconds).toBeGreaterThan(WINDOW_SECONDS);
        expect(recorded.ttlSeconds).toBe(WINDOW_SECONDS * 2);
      }
    });

    it("starts a fresh allowance when the window rolls", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT + 1; i++) {
        await consume({});
      }

      expect((await consume({})).outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.RateLimited,
      );

      currentTime = currentTime + WINDOW_SECONDS * 1000;

      expect((await consume({})).outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.Allowed,
      );
    });

    it("does not roll early within the same window", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT + 1; i++) {
        await consume({});
      }

      currentTime = currentTime + WINDOW_SECONDS * 1000 - 1;

      expect((await consume({})).outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.RateLimited,
      );
    });

    it("keeps the window pinned by counting rejected requests too", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT + 5; i++) {
        await consume({});
      }

      /* Both counters incremented on every one of them, refused or not. */
      expect(client.incrCallCount).toBe((PER_TOKEN_LIMIT + 5) * 2);
    });

    it("reports a Retry-After inside the current window", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT; i++) {
        await consume({});
      }

      const decision: OnCallCalendarFeedRateLimitDecision = await consume({});

      expect(decision.retryAfterSeconds).toBeGreaterThan(0);
      expect(decision.retryAfterSeconds).toBeLessThanOrEqual(WINDOW_SECONDS);
    });

    it("shrinks Retry-After as the window drains", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT; i++) {
        await consume({});
      }

      const atStart: number = (await consume({})).retryAfterSeconds || 0;

      currentTime = currentTime + 45 * 1000;

      const later: number = (await consume({})).retryAfterSeconds || 0;

      expect(later).toBeLessThan(atStart);
      expect(later).toBe(15);
    });

    it("never reports a Retry-After of zero at the very end of a window", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT; i++) {
        await consume({});
      }

      currentTime = currentTime + WINDOW_SECONDS * 1000 - 1;

      const decision: OnCallCalendarFeedRateLimitDecision = await consume({});

      expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });
  });

  describe("consume - counter unavailable", () => {
    it("reports unavailable when Redis has no client", async () => {
      getClientMock.mockReturnValue(null);

      expect((await consume({})).outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when Redis is not connected", async () => {
      isConnectedMock.mockReturnValue(false);

      expect((await consume({})).outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when the pipeline throws", async () => {
      client.failNextExec = new Error("connection reset");

      expect((await consume({})).outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when the pipeline returns null", async () => {
      client.malformedExecResult = null;

      expect((await consume({})).outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when the pipeline returns too few results", async () => {
      client.malformedExecResult = [[null, 1]];

      expect((await consume({})).outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when a command inside the pipeline failed", async () => {
      client.malformedExecResult = [
        [new Error("OOM"), null],
        [null, 1],
      ];

      expect((await consume({})).outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when a counter comes back non-numeric", async () => {
      client.malformedExecResult = [
        [null, "1"],
        [null, 1],
      ];

      expect((await consume({})).outcome).toBe(
        OnCallCalendarFeedRateLimitOutcome.CounterUnavailable,
      );
    });

    it("does not throw out of consume on any failure", async () => {
      client.failNextExec = new Error("boom");

      await expect(consume({})).resolves.toBeDefined();
    });

    it("does not name the token key when logging a counter failure", async () => {
      client.failNextExec = new Error("connection reset");

      const tokenKey: string = OnCallCalendarFeedRateLimit.hashToken(TOKEN_A);

      await consume({ tokenKey });

      const logged: string = everythingLogged();

      expect(logged).not.toContain(TOKEN_A);
      expect(logged).not.toContain(tokenKey);
    });
  });

  describe("getMiddleware", () => {
    const runMiddleware: (request?: ExpressRequest) => Promise<{
      nextCalled: boolean;
      headers: Record<string, string>;
    }> = async (request?: ExpressRequest) => {
      const { response, headers } = buildResponse();
      let nextCalled: boolean = false;

      const next: NextFunction = (() => {
        nextCalled = true;
      }) as unknown as NextFunction;

      await OnCallCalendarFeedRateLimit.getMiddleware()(
        request ||
          buildRequest({
            token: TOKEN_A,
            headers: { "x-forwarded-for": "203.0.113.7" },
          }),
        response,
        next,
      );

      return { nextCalled, headers };
    };

    it("passes an allowed request through", async () => {
      const result: { nextCalled: boolean } = await runMiddleware();

      expect(result.nextCalled).toBe(true);
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    it("stops a refused request from reaching the route handler", async () => {
      const request: ExpressRequest = buildRequest({
        token: TOKEN_A,
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < PER_TOKEN_LIMIT; i++) {
        await runMiddleware(request);
      }

      sendErrorResponseMock.mockClear();

      const result: { nextCalled: boolean } = await runMiddleware(request);

      expect(result.nextCalled).toBe(false);
      expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);
    });

    it("answers a refusal with 429", async () => {
      const request: ExpressRequest = buildRequest({
        token: TOKEN_A,
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < PER_TOKEN_LIMIT + 1; i++) {
        await runMiddleware(request);
      }

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.code).toBe(ExceptionCode.TooManyRequestsException);
      expect(error.code).toBe(429);
    });

    it("sets Retry-After on a refusal", async () => {
      const request: ExpressRequest = buildRequest({
        token: TOKEN_A,
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      let headers: Record<string, string> = {};

      for (let i: number = 0; i < PER_TOKEN_LIMIT + 1; i++) {
        headers = (await runMiddleware(request)).headers;
      }

      expect(Number(headers["Retry-After"])).toBeGreaterThan(0);
      expect(Number(headers["Retry-After"])).toBeLessThanOrEqual(
        WINDOW_SECONDS,
      );
    });

    it("does not leak the limit, the counter or the token in the message", async () => {
      const request: ExpressRequest = buildRequest({
        token: TOKEN_A,
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < PER_TOKEN_LIMIT + 1; i++) {
        await runMiddleware(request);
      }

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.message).not.toMatch(/\d/);
      expect(error.message).not.toContain(TOKEN_A);
    });

    it("survives a response object with no setHeader", async () => {
      const request: ExpressRequest = buildRequest({
        token: TOKEN_A,
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      const middleware: (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => Promise<void> = OnCallCalendarFeedRateLimit.getMiddleware();

      const bareResponse: ExpressResponse = {} as unknown as ExpressResponse;

      for (let i: number = 0; i < PER_TOKEN_LIMIT + 2; i++) {
        await expect(
          middleware(request, bareResponse, (() => {}) as NextFunction),
        ).resolves.not.toThrow();
      }
    });

    /*
     * FAILS OPEN. The limiter is load control; the route behind it still
     * checks the token. A Redis blip must not black out every subscribed
     * calendar.
     */
    it("serves feeds unthrottled rather than failing when Redis is gone", async () => {
      isConnectedMock.mockReturnValue(false);

      const result: { nextCalled: boolean } = await runMiddleware();

      expect(result.nextCalled).toBe(true);
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    it("serves feeds unthrottled when there is no Redis client at all", async () => {
      getClientMock.mockReturnValue(null);

      const result: { nextCalled: boolean } = await runMiddleware();

      expect(result.nextCalled).toBe(true);
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    it("still serves feeds when the counter errors", async () => {
      client.failNextExec = new Error("connection reset");

      const result: { nextCalled: boolean } = await runMiddleware();

      expect(result.nextCalled).toBe(true);
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    it("never answers 503 for an outage", async () => {
      isConnectedMock.mockReturnValue(false);

      for (let i: number = 0; i < 50; i++) {
        await runMiddleware();
      }

      expect(sendErrorResponseMock).not.toHaveBeenCalled();
      expect(loggerErrorMock).not.toHaveBeenCalled();
    });

    it("logs the moment a caller crosses the line, then stays quiet", async () => {
      const request: ExpressRequest = buildRequest({
        token: TOKEN_A,
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < PER_TOKEN_LIMIT; i++) {
        await runMiddleware(request);
      }

      loggerWarnMock.mockClear();

      await runMiddleware(request);

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);

      for (let i: number = 0; i < 200; i++) {
        await runMiddleware(request);
      }

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    });

    it("logs the crossing again once the window rolls", async () => {
      const request: ExpressRequest = buildRequest({
        token: TOKEN_A,
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < PER_TOKEN_LIMIT + 5; i++) {
        await runMiddleware(request);
      }

      currentTime = currentTime + WINDOW_SECONDS * 1000;
      loggerWarnMock.mockClear();

      for (let i: number = 0; i < PER_TOKEN_LIMIT + 5; i++) {
        await runMiddleware(request);
      }

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    });

    it("names the address and the scope in the crossing log, and nothing about the token", async () => {
      const request: ExpressRequest = buildRequest({
        token: TOKEN_A,
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < PER_TOKEN_LIMIT + 1; i++) {
        await runMiddleware(request);
      }

      const line: string = String(loggerWarnMock.mock.calls[0]?.[0]);

      expect(line).toContain("203.0.113.7");
      expect(line).toContain("token limit");
      expect(line).not.toContain(TOKEN_A);
      expect(line).not.toContain(
        OnCallCalendarFeedRateLimit.hashToken(TOKEN_A),
      );
    });

    it("does not log once per request while Redis is down", async () => {
      isConnectedMock.mockReturnValue(false);
      loggerWarnMock.mockClear();

      for (let i: number = 0; i < 100; i++) {
        await runMiddleware();
      }

      /* One message plus its attributes line, not 200. */
      expect(loggerWarnMock.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it("logs the outage again after the throttle interval", async () => {
      isConnectedMock.mockReturnValue(false);

      await runMiddleware();

      currentTime = currentTime + 60_000;
      loggerWarnMock.mockClear();

      await runMiddleware();

      expect(loggerWarnMock.mock.calls.length).toBeGreaterThan(0);
    });

    /*
     * The property that is specific to this limiter: it sits on a URL whose
     * path segment IS the credential, and every log line it could ever emit
     * -- crossing, outage, counter failure -- is exercised here with the
     * token in the request. None of them may contain it.
     */
    it("never logs the token, in any code path", async () => {
      const request: ExpressRequest = buildRequest({
        token: TOKEN_A,
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      /* Crossing path. */
      for (let i: number = 0; i < PER_TOKEN_LIMIT + 3; i++) {
        await runMiddleware(request);
      }

      /* Counter failure path. */
      client.failNextExec = new Error(`redis said: ${TOKEN_A}`);
      currentTime = currentTime + 61_000;
      await runMiddleware(request);

      /* Outage path. */
      isConnectedMock.mockReturnValue(false);
      currentTime = currentTime + 61_000;
      await runMiddleware(request);

      const logged: string = everythingLogged();

      /*
       * The Redis error above deliberately carries the token to prove the
       * limiter's own lines never do; strip that one echo before asserting.
       */
      const withoutEchoedError: string = logged
        .split("\n")
        .filter((line: string) => {
          return !line.includes("redis said:");
        })
        .join("\n");

      expect(withoutEchoedError).not.toContain(TOKEN_A);
      expect(withoutEchoedError).not.toContain(TOKEN_A.slice(0, 10));
      expect(withoutEchoedError).not.toContain(
        OnCallCalendarFeedRateLimit.hashToken(TOKEN_A).slice(2),
      );
    });

    it("derives its key from the request, not from the caller's header", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT; i++) {
        await runMiddleware(
          buildRequest({
            token: TOKEN_A,
            headers: { "x-forwarded-for": `10.0.0.${i % 250}, 203.0.113.7` },
          }),
        );
      }

      sendErrorResponseMock.mockClear();

      const result: { nextCalled: boolean } = await runMiddleware(
        buildRequest({
          token: TOKEN_A,
          headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.7" },
        }),
      );

      expect(result.nextCalled).toBe(false);
    });

    it("bills a request with a malformed token to the shared invalid bucket", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT; i++) {
        await runMiddleware(
          buildRequest({
            token: `junk-${i}`,
            headers: { "x-forwarded-for": "203.0.113.7" },
          }),
        );
      }

      sendErrorResponseMock.mockClear();

      const result: { nextCalled: boolean } = await runMiddleware(
        buildRequest({
          token: "another-junk-token",
          headers: { "x-forwarded-for": "203.0.113.7" },
        }),
      );

      expect(result.nextCalled).toBe(false);
    });

    it("does not let junk tokens eat a real token's budget", async () => {
      for (let i: number = 0; i < PER_TOKEN_LIMIT + 5; i++) {
        await runMiddleware(
          buildRequest({
            token: `junk-${i}`,
            headers: { "x-forwarded-for": "203.0.113.7" },
          }),
        );
      }

      sendErrorResponseMock.mockClear();

      const result: { nextCalled: boolean } = await runMiddleware(
        buildRequest({
          token: TOKEN_A,
          headers: { "x-forwarded-for": "203.0.113.7" },
        }),
      );

      expect(result.nextCalled).toBe(true);
    });
  });
});

/*
 * The budgets are read from the environment at module load (through
 * EnvironmentConfig), so these reload the module rather than calling into the
 * already-configured one.
 */
describe("OnCallCalendarFeedRateLimit configuration", () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  interface ReloadedModule {
    limiter: typeof OnCallCalendarFeedRateLimit;
    client: FakeRedisClient;
  }

  const reload: () => Promise<ReloadedModule> = async () => {
    jest.resetModules();

    const redisModule: {
      default: { getClient: MockedFn; isConnected: MockedFn };
    } = (await import("../../../Server/Infrastructure/Redis")) as unknown as {
      default: { getClient: MockedFn; isConnected: MockedFn };
    };

    const limiterModule: { default: typeof OnCallCalendarFeedRateLimit } =
      (await import(
        "../../../Server/Middleware/OnCallCalendarFeedRateLimit"
      )) as unknown as { default: typeof OnCallCalendarFeedRateLimit };

    const client: FakeRedisClient = new FakeRedisClient();

    redisModule.default.getClient.mockReturnValue(client);
    redisModule.default.isConnected.mockReturnValue(true);

    return { limiter: limiterModule.default, client };
  };

  it("honours a configured per-token limit", async () => {
    process.env["ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW"] = "3";

    const { limiter } = await reload();

    expect(limiter.getConfig().perTokenLimit).toBe(3);

    for (let i: number = 0; i < 3; i++) {
      expect(
        (
          await limiter.consume({
            tokenKey: "t:abc",
            clientIp: "203.0.113.7",
          })
        ).outcome,
      ).toBe(OnCallCalendarFeedRateLimitOutcome.Allowed);
    }

    expect(
      (
        await limiter.consume({
          tokenKey: "t:abc",
          clientIp: "203.0.113.7",
        })
      ).outcome,
    ).toBe(OnCallCalendarFeedRateLimitOutcome.RateLimited);
  });

  it("honours a configured per-address ceiling", async () => {
    process.env["ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW"] = "4";

    const { limiter } = await reload();

    expect(limiter.getConfig().perIpLimit).toBe(4);

    let rejected: boolean = false;

    for (let i: number = 0; i < 6; i++) {
      const decision: OnCallCalendarFeedRateLimitDecision =
        await limiter.consume({
          tokenKey: `t:rotating-${i}`,
          clientIp: "203.0.113.7",
        });

      if (decision.outcome === OnCallCalendarFeedRateLimitOutcome.RateLimited) {
        rejected = true;
        expect(decision.scope).toBe(OnCallCalendarFeedRateLimitScope.Ip);
      }
    }

    expect(rejected).toBe(true);
  });

  it("honours a configured window", async () => {
    process.env["ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS"] = "120";

    const { limiter, client } = await reload();

    expect(limiter.getConfig().windowSeconds).toBe(120);

    await limiter.consume({ tokenKey: "t:abc", clientIp: "203.0.113.7" });

    for (const recorded of client.expires) {
      expect(recorded.ttlSeconds).toBe(240);
    }
  });

  it("falls back to the defaults for a value that is not a positive integer", async () => {
    process.env["ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW"] =
      "lots";
    process.env["ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW"] = "0";
    process.env["ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS"] = "1.5";

    const { limiter } = await reload();

    expect(limiter.getConfig()).toEqual({
      windowSeconds: WINDOW_SECONDS,
      perTokenLimit: PER_TOKEN_LIMIT,
      perIpLimit: PER_IP_LIMIT,
    });
  });

  it("treats a blank value as unset", async () => {
    process.env["ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW"] = "";

    const { limiter } = await reload();

    expect(limiter.getConfig().perTokenLimit).toBe(PER_TOKEN_LIMIT);
  });
});
