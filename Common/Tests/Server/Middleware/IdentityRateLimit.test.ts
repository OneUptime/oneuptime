import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The attempt limiter guarding the anonymous credential routes -- POST /login,
 * the three second-step routes, and POST /verify-backup-code.
 *
 * What is worth asserting here is not "does it count". It is the handful of
 * properties that decide whether the limit bounds anything at all:
 *
 *  - the client address comes from the hop OUR proxy wrote, not the one the
 *    caller can forge, or a header buys a fresh bucket every request;
 *  - the account key is read out of BOTH shapes `email` legitimately arrives
 *    in, because the shipped clients disagree, and reading only one of them
 *    would drop every dashboard login into the shared "none" bucket;
 *  - rotating the email address still runs into the per-address ceiling;
 *  - the window does not slide forward under sustained load, which would make
 *    a tripped limit a permanent lockout;
 *  - the buckets are separate, so failing the password step cannot spend the
 *    recovery step's budget;
 *  - a missing counter fails CLOSED, unlike the verification-code limiter.
 *
 * Each has its own describe block below.
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
import IdentityRateLimit, {
  IdentityRateLimitBucket,
  IdentityRateLimitDecision,
  IdentityRateLimitOutcome,
  IdentityRateLimitScope,
} from "../../../Server/Middleware/IdentityRateLimit";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
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

/*
 * The shipped defaults. Asserted directly in one test below so that a change
 * to any of them has to be made deliberately rather than drifting.
 */
const WINDOW_SECONDS: number = 15 * 60;
const PER_ACCOUNT_LIMIT: number = 10;
const PER_IP_LIMIT: number = 150;

/* Mirrors the limiter's own TTL_MULTIPLIER. */
const TTL_MULTIPLIER: number = 2;

/*
 * A fake that behaves like a Redis counter store rather than a bag of
 * assertions: INCR really increments and EXPIRE really records a TTL, so the
 * window and reset tests exercise the limiter's arithmetic instead of
 * restating it.
 */
interface RecordedExpire {
  key: string;
  ttlSeconds: number;
}

class FakeRedisClient {
  public counters: Map<string, number> = new Map();
  public expires: Array<RecordedExpire> = [];

  /* Set to make the next exec() reject, for the error-path tests. */
  public failNextExec: Error | null = null;

  /* Set to make the next exec() resolve to something malformed. */
  public malformedExecResult: unknown | undefined = undefined;

  public incrCallCount: number = 0;
  public pipelineCallCount: number = 0;

  public pipeline(): FakePipeline {
    this.pipelineCallCount++;
    return new FakePipeline(this);
  }

  public reset(): void {
    this.counters.clear();
    this.expires = [];
    this.failNextExec = null;
    this.malformedExecResult = undefined;
    this.incrCallCount = 0;
    this.pipelineCallCount = 0;
  }

  public expiresForKey(key: string): Array<RecordedExpire> {
    return this.expires.filter((recorded: RecordedExpire) => {
      return recorded.key === key;
    });
  }

  public keysMatching(fragment: string): Array<string> {
    return Array.from(this.counters.keys()).filter((key: string) => {
      return key.includes(fragment);
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
  body?: unknown;
  headers?: Record<string, string | Array<string>>;
  socketAddress?: string | undefined;
  ip?: string | undefined;
}

const buildRequest: (overrides?: BuildRequestOverrides) => ExpressRequest = (
  overrides: BuildRequestOverrides = {},
) => {
  return {
    body: overrides.body,
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

describe("IdentityRateLimit", () => {
  let client: FakeRedisClient;
  let nowSpy: ReturnType<typeof jest.spyOn>;
  let currentTime: number;

  beforeEach(() => {
    jest.clearAllMocks();

    client = new FakeRedisClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);

    /*
     * Pinned to the start of a window so counters and Retry-After maths are
     * deterministic. Tests that care about window boundaries move it.
     */
    currentTime = 1_700_000_000_000;
    currentTime = currentTime - (currentTime % (WINDOW_SECONDS * 1000));
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
      return currentTime;
    });

    /*
     * The unavailable-log throttle is static state that outlives a test, so
     * every test starts from a clock far enough past the last log for the
     * next one to be allowed.
     */
    currentTime = currentTime + 0;
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  const consume: (data: {
    accountKey?: string;
    clientIp?: string;
    bucket?: IdentityRateLimitBucket;
  }) => Promise<IdentityRateLimitDecision> = (data: {
    accountKey?: string;
    clientIp?: string;
    bucket?: IdentityRateLimitBucket;
  }) => {
    return IdentityRateLimit.consume({
      accountKey: data.accountKey || "user@example.com",
      clientIp: data.clientIp || "203.0.113.7",
      bucket: data.bucket || IdentityRateLimitBucket.Login,
    });
  };

  describe("resolveClientIp", () => {
    /*
     * The security-critical one. Nginx uses $proxy_add_x_forwarded_for, which
     * APPENDS the peer address -- so a caller who sends their own
     * X-Forwarded-For controls the LEFT of the list. Keying on the leftmost
     * entry means a header per request is a bucket per request, which is no
     * limit at all.
     */
    it("reads the address our proxy appended, not the one the caller sent", () => {
      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.7" },
      });

      expect(IdentityRateLimit.resolveClientIp(request)).toBe("203.0.113.7");
    });

    it("gives a caller rotating the forged left-hand entry one single bucket", () => {
      const first: string = IdentityRateLimit.resolveClientIp(
        buildRequest({
          headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.7" },
        }),
      );
      const second: string = IdentityRateLimit.resolveClientIp(
        buildRequest({
          headers: { "x-forwarded-for": "2.2.2.2, 203.0.113.7" },
        }),
      );

      expect(first).toBe(second);
    });

    it("uses the sole entry when the header carries exactly one hop", () => {
      expect(
        IdentityRateLimit.resolveClientIp(
          buildRequest({ headers: { "x-forwarded-for": "203.0.113.7" } }),
        ),
      ).toBe("203.0.113.7");
    });

    it("joins a repeated header in wire order and still reads the right end", () => {
      expect(
        IdentityRateLimit.resolveClientIp(
          buildRequest({
            headers: { "x-forwarded-for": ["9.9.9.9", "203.0.113.7"] },
          }),
        ),
      ).toBe("203.0.113.7");
    });

    it("falls back to the transport peer when the header is absent", () => {
      expect(
        IdentityRateLimit.resolveClientIp(
          buildRequest({ socketAddress: "198.51.100.4" }),
        ),
      ).toBe("198.51.100.4");
    });

    /*
     * Node reports the IPv4-mapped form on a dual-stack listener. Left as-is
     * one caller would land in two buckets depending on which shape their
     * address arrived in.
     */
    it("normalizes an IPv4-mapped IPv6 peer to the bare IPv4 literal", () => {
      expect(
        IdentityRateLimit.resolveClientIp(
          buildRequest({ socketAddress: "::ffff:198.51.100.4" }),
        ),
      ).toBe("198.51.100.4");
    });

    it("shares one bucket across everything with no resolvable address", () => {
      expect(IdentityRateLimit.resolveClientIp(buildRequest({}))).toBe(
        "unknown",
      );
    });

    it("refuses to trust an unparseable value in the trusted position", () => {
      expect(
        IdentityRateLimit.resolveClientIp(
          buildRequest({ headers: { "x-forwarded-for": "1.2.3.4, garbage" } }),
        ),
      ).toBe("unknown");
    });

    it("keeps a hostile header out of the Redis key charset", () => {
      const resolved: string = IdentityRateLimit.resolveClientIp(
        buildRequest({ socketAddress: "1.2.3.4" }),
      );

      expect(resolved).toMatch(/^[a-zA-Z0-9._:%\-[\]@]*$/);
    });
  });

  describe("resolveAccountKey", () => {
    /*
     * `email` legitimately arrives in two shapes and the shipped clients
     * disagree: the dashboard's /login sends the serialized Email envelope,
     * its /verify-totp-auth sends a bare string. Both must key the same, or
     * the per-account budget can be taken twice by alternating them.
     */
    it("reads the bare string shape the second-step routes send", () => {
      expect(
        IdentityRateLimit.resolveAccountKey(
          buildRequest({ body: { data: { email: "user@example.com" } } }),
        ),
      ).toBe("user@example.com");
    });

    it("reads the serialized Email envelope that /login sends", () => {
      expect(
        IdentityRateLimit.resolveAccountKey(
          buildRequest({
            body: {
              data: { email: { _type: "Email", value: "user@example.com" } },
            },
          }),
        ),
      ).toBe("user@example.com");
    });

    it("keys both shapes identically, so alternating them buys nothing", () => {
      const fromString: string = IdentityRateLimit.resolveAccountKey(
        buildRequest({ body: { data: { email: "user@example.com" } } }),
      );
      const fromEnvelope: string = IdentityRateLimit.resolveAccountKey(
        buildRequest({
          body: {
            data: { email: { _type: "Email", value: "user@example.com" } },
          },
        }),
      );

      expect(fromString).toBe(fromEnvelope);
    });

    it("unwraps any object carrying a string value, not only _type Email", () => {
      expect(
        IdentityRateLimit.resolveAccountKey(
          buildRequest({
            body: { data: { email: { value: "user@example.com" } } },
          }),
        ),
      ).toBe("user@example.com");
    });

    it("accepts the flatter top-level shape as well as the nested one", () => {
      expect(
        IdentityRateLimit.resolveAccountKey(
          buildRequest({ body: { email: "user@example.com" } }),
        ),
      ).toBe("user@example.com");
    });

    it("prefers the nested field when both are present", () => {
      expect(
        IdentityRateLimit.resolveAccountKey(
          buildRequest({
            body: {
              email: "top@example.com",
              data: { email: "nested@example.com" },
            },
          }),
        ),
      ).toBe("nested@example.com");
    });

    /* Case alone must not buy a fresh allowance. */
    it("lower-cases, so Bob@ and bob@ are one bucket", () => {
      expect(
        IdentityRateLimit.resolveAccountKey(
          buildRequest({ body: { data: { email: "Bob@Example.COM" } } }),
        ),
      ).toBe("bob@example.com");
    });

    it("trims surrounding whitespace before keying", () => {
      expect(
        IdentityRateLimit.resolveAccountKey(
          buildRequest({ body: { data: { email: "  user@example.com  " } } }),
        ),
      ).toBe("user@example.com");
    });

    it("buckets a missing body rather than throwing", () => {
      expect(IdentityRateLimit.resolveAccountKey(buildRequest({}))).toBe(
        "none",
      );
    });

    it("buckets a non-string email rather than throwing", () => {
      expect(
        IdentityRateLimit.resolveAccountKey(
          buildRequest({ body: { data: { email: 12345 } } }),
        ),
      ).toBe("none");
    });

    it("buckets an array email rather than indexing it", () => {
      expect(
        IdentityRateLimit.resolveAccountKey(
          buildRequest({ body: { data: { email: ["a@example.com"] } } }),
        ),
      ).toBe("none");
    });

    it("buckets a whitespace-only email", () => {
      expect(
        IdentityRateLimit.resolveAccountKey(
          buildRequest({ body: { data: { email: "   " } } }),
        ),
      ).toBe("none");
    });

    it("buckets a null data envelope rather than throwing", () => {
      expect(
        IdentityRateLimit.resolveAccountKey(
          buildRequest({ body: { data: null } }),
        ),
      ).toBe("none");
    });

    /*
     * The key segment is caller-supplied, so it must not be able to carry
     * newlines, spaces or wildcards into a Redis key.
     */
    it("strips anything outside the key charset", () => {
      const key: string = IdentityRateLimit.resolveAccountKey(
        buildRequest({ body: { data: { email: "a b\nc\r*d@example.com" } } }),
      );

      expect(key).toMatch(/^[a-zA-Z0-9._:%\-[\]@]*$/);
      expect(key).not.toContain("*");
      expect(key).not.toContain("\n");
    });

    it("bounds the key segment length", () => {
      const key: string = IdentityRateLimit.resolveAccountKey(
        buildRequest({
          body: { data: { email: `${"a".repeat(5000)}@example.com` } },
        }),
      );

      expect(key.length).toBeLessThanOrEqual(64);
    });
  });

  describe("getBucketConfig", () => {
    it("ships the documented login budget", () => {
      expect(
        IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.Login),
      ).toEqual({
        windowSeconds: WINDOW_SECONDS,
        perAccountLimit: PER_ACCOUNT_LIMIT,
        perIpLimit: PER_IP_LIMIT,
      });
    });

    it("ships the documented two-factor budget", () => {
      expect(
        IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.TwoFactor),
      ).toEqual({
        windowSeconds: WINDOW_SECONDS,
        perAccountLimit: PER_ACCOUNT_LIMIT,
        perIpLimit: PER_IP_LIMIT,
      });
    });

    it("ships the documented backup-code budget", () => {
      expect(
        IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.BackupCode),
      ).toEqual({
        windowSeconds: WINDOW_SECONDS,
        perAccountLimit: PER_ACCOUNT_LIMIT,
        perIpLimit: PER_IP_LIMIT,
      });
    });

    it("falls back to the login budget for an unknown bucket", () => {
      expect(
        IdentityRateLimit.getBucketConfig(
          "not-a-bucket" as IdentityRateLimitBucket,
        ),
      ).toEqual(
        IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.Login),
      );
    });
  });

  describe("the per-account counter", () => {
    it("allows exactly the budget and refuses the one after", async () => {
      for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
        expect((await consume({})).outcome).toBe(
          IdentityRateLimitOutcome.Allowed,
        );
      }

      const refused: IdentityRateLimitDecision = await consume({});

      expect(refused.outcome).toBe(IdentityRateLimitOutcome.RateLimited);
      expect(refused.scope).toBe(IdentityRateLimitScope.Account);
    });

    it("keys the account counter on the address too, so it is not a lockout weapon", async () => {
      for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 1; i++) {
        await consume({ clientIp: "198.51.100.1" });
      }

      /*
       * The same victim account, from the account owner's own address, is
       * still served -- an attacker cannot burn a stranger's budget.
       */
      expect((await consume({ clientIp: "203.0.113.7" })).outcome).toBe(
        IdentityRateLimitOutcome.Allowed,
      );
    });

    it("separates two accounts from one address", async () => {
      for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 1; i++) {
        await consume({ accountKey: "a@example.com" });
      }

      expect((await consume({ accountKey: "b@example.com" })).outcome).toBe(
        IdentityRateLimitOutcome.Allowed,
      );
    });

    it("flags only the request that first crossed the line", async () => {
      for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
        await consume({});
      }

      const first: IdentityRateLimitDecision = await consume({});
      const second: IdentityRateLimitDecision = await consume({});

      expect(first.isFirstRejectionInWindow).toBe(true);
      expect(second.isFirstRejectionInWindow).toBe(false);
    });

    it("counts a refused request too, so hammering keeps the window pinned", async () => {
      for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 5; i++) {
        await consume({});
      }

      const accountKeys: Array<string> = client.keysMatching(":a:");

      expect(accountKeys).toHaveLength(1);
      expect(client.counters.get(accountKeys[0] as string)).toBe(
        PER_ACCOUNT_LIMIT + 5,
      );
    });
  });

  describe("the per-address ceiling", () => {
    /*
     * The email address is a request-body field, so the per-account counter
     * alone is bypassed by changing it. The address counter is the ceiling
     * that survives that rotation.
     */
    it("bounds a caller who uses a fresh email address every request", async () => {
      let refusedAt: number = -1;

      for (let i: number = 0; i < PER_IP_LIMIT + 1; i++) {
        const decision: IdentityRateLimitDecision = await consume({
          accountKey: `user-${i}@example.com`,
        });

        if (decision.outcome === IdentityRateLimitOutcome.RateLimited) {
          refusedAt = i;
          expect(decision.scope).toBe(IdentityRateLimitScope.Ip);
          break;
        }
      }

      expect(refusedAt).toBe(PER_IP_LIMIT);
    });

    it("does not refuse a different address once one is over its ceiling", async () => {
      for (let i: number = 0; i < PER_IP_LIMIT + 1; i++) {
        await consume({
          accountKey: `user-${i}@example.com`,
          clientIp: "198.51.100.1",
        });
      }

      expect(
        (
          await consume({
            accountKey: "someone@example.com",
            clientIp: "203.0.113.9",
          })
        ).outcome,
      ).toBe(IdentityRateLimitOutcome.Allowed);
    });

    /*
     * When both counters are over, the account one is the more specific and
     * the more useful thing to put in a log line.
     */
    it("reports the account scope first when both counters are over", async () => {
      for (let i: number = 0; i < PER_IP_LIMIT + 1; i++) {
        await consume({ accountKey: `user-${i}@example.com` });
      }

      const decision: IdentityRateLimitDecision = await consume({
        accountKey: "user-0@example.com",
      });

      expect(decision.outcome).toBe(IdentityRateLimitOutcome.RateLimited);
      expect(decision.scope).toBe(IdentityRateLimitScope.Ip);

      /* Now push that one account over its own budget as well. */
      for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 2; i++) {
        await consume({ accountKey: "user-0@example.com" });
      }

      const both: IdentityRateLimitDecision = await consume({
        accountKey: "user-0@example.com",
      });

      expect(both.scope).toBe(IdentityRateLimitScope.Account);
    });
  });

  describe("buckets are separate", () => {
    /*
     * The property that matters most: everybody at /verify-backup-code has
     * just failed the factor above it. If the recovery route shared that
     * counter it would answer "too many attempts" to exactly the user it
     * exists to rescue.
     */
    it("does not let a spent two-factor budget close the recovery route", async () => {
      for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 1; i++) {
        await consume({ bucket: IdentityRateLimitBucket.TwoFactor });
      }

      expect(
        (await consume({ bucket: IdentityRateLimitBucket.BackupCode })).outcome,
      ).toBe(IdentityRateLimitOutcome.Allowed);
    });

    it("does not let /login noise refuse a user finishing a two-factor login", async () => {
      for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 1; i++) {
        await consume({ bucket: IdentityRateLimitBucket.Login });
      }

      expect(
        (await consume({ bucket: IdentityRateLimitBucket.TwoFactor })).outcome,
      ).toBe(IdentityRateLimitOutcome.Allowed);
    });

    it("gives every bucket its own key namespace", async () => {
      await consume({ bucket: IdentityRateLimitBucket.Login });
      await consume({ bucket: IdentityRateLimitBucket.TwoFactor });
      await consume({ bucket: IdentityRateLimitBucket.BackupCode });

      expect(client.keysMatching(":login:")).toHaveLength(2);
      expect(client.keysMatching(":two-factor:")).toHaveLength(2);
      expect(client.keysMatching(":backup-code:")).toHaveLength(2);
    });
  });

  describe("the window", () => {
    it("resets the allowance when the window rolls", async () => {
      for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 1; i++) {
        await consume({});
      }

      currentTime = currentTime + WINDOW_SECONDS * 1000;

      expect((await consume({})).outcome).toBe(
        IdentityRateLimitOutcome.Allowed,
      );
    });

    /*
     * Re-issuing EXPIRE on every increment would slide the window forward for
     * as long as the attempts continue, turning a tripped limit into a
     * permanent lockout.
     */
    it("sets the expiry only on the write that created the key", async () => {
      await consume({});
      await consume({});
      await consume({});

      const accountKey: string = client.keysMatching(":a:")[0] as string;

      expect(client.expiresForKey(accountKey)).toHaveLength(1);
    });

    it("outlives its window so a boundary request cannot read a reclaimed key", async () => {
      await consume({});

      const accountKey: string = client.keysMatching(":a:")[0] as string;
      const recorded: RecordedExpire = client.expiresForKey(
        accountKey,
      )[0] as RecordedExpire;

      expect(recorded.ttlSeconds).toBe(WINDOW_SECONDS * TTL_MULTIPLIER);
    });

    it("tells a refused caller how long is left in the current window", async () => {
      /* A quarter of the way into the window. */
      currentTime = currentTime + (WINDOW_SECONDS * 1000) / 4;

      for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
        await consume({});
      }

      const decision: IdentityRateLimitDecision = await consume({});

      expect(decision.retryAfterSeconds).toBe((WINDOW_SECONDS * 3) / 4);
    });

    it("never tells a caller to retry in zero seconds", async () => {
      /* One millisecond before the window rolls. */
      currentTime = currentTime + WINDOW_SECONDS * 1000 - 1;

      for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
        await consume({});
      }

      const decision: IdentityRateLimitDecision = await consume({});

      expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });

    it("costs one round trip on the common allowed path", async () => {
      /* First request creates both keys, so it also issues the EXPIRE pass. */
      await consume({});
      client.pipelineCallCount = 0;

      await consume({});

      expect(client.pipelineCallCount).toBe(1);
    });
  });

  describe("when the counter is unavailable", () => {
    /*
     * The opposite of VerificationCodeRateLimit. Nothing else on these routes
     * counts attempts, so serving them without the counter means serving the
     * unlimited guessing oracle the middleware exists to close.
     */
    it("reports unavailable when Redis has no client", async () => {
      getClientMock.mockReturnValue(null);

      expect((await consume({})).outcome).toBe(
        IdentityRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when Redis is disconnected", async () => {
      isConnectedMock.mockReturnValue(false);

      expect((await consume({})).outcome).toBe(
        IdentityRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when the pipeline rejects", async () => {
      client.failNextExec = new Error("boom");

      expect((await consume({})).outcome).toBe(
        IdentityRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when the pipeline returns nothing", async () => {
      client.malformedExecResult = null;

      expect((await consume({})).outcome).toBe(
        IdentityRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when the pipeline returns too few results", async () => {
      client.malformedExecResult = [[null, 1]];

      expect((await consume({})).outcome).toBe(
        IdentityRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when a counter carries an error", async () => {
      client.malformedExecResult = [
        [new Error("WRONGTYPE"), null],
        [null, 1],
      ];

      expect((await consume({})).outcome).toBe(
        IdentityRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when a counter is not numeric", async () => {
      client.malformedExecResult = [
        [null, "1"],
        [null, 1],
      ];

      expect((await consume({})).outcome).toBe(
        IdentityRateLimitOutcome.CounterUnavailable,
      );
    });

    it("does not throw out of consume on any failure", async () => {
      client.failNextExec = new Error("boom");

      await expect(consume({})).resolves.toBeDefined();
    });
  });

  describe("getMiddleware", () => {
    const runMiddleware: (data: {
      bucket?: IdentityRateLimitBucket;
      request?: ExpressRequest;
    }) => Promise<{
      nextCalled: boolean;
      headers: Record<string, string>;
    }> = async (data: {
      bucket?: IdentityRateLimitBucket;
      request?: ExpressRequest;
    }) => {
      const { response, headers } = buildResponse();
      let nextCalled: boolean = false;

      const next: NextFunction = (() => {
        nextCalled = true;
      }) as unknown as NextFunction;

      await IdentityRateLimit.getMiddleware(
        data.bucket || IdentityRateLimitBucket.Login,
      )(
        data.request ||
          buildRequest({
            body: { data: { email: "user@example.com" } },
            headers: { "x-forwarded-for": "203.0.113.7" },
          }),
        response,
        next,
      );

      return { nextCalled, headers };
    };

    it("passes an allowed request through", async () => {
      const result: { nextCalled: boolean } = await runMiddleware({});

      expect(result.nextCalled).toBe(true);
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    /*
     * The property the whole middleware rests on: a refused request must not
     * reach the handler, or the user lookup and the bcrypt verify behind it
     * still happen and the limiter is decoration.
     */
    it("stops a refused request from reaching the route handler", async () => {
      const request: ExpressRequest = buildRequest({
        body: { data: { email: "user@example.com" } },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
        await runMiddleware({ request });
      }

      sendErrorResponseMock.mockClear();

      const result: { nextCalled: boolean } = await runMiddleware({ request });

      expect(result.nextCalled).toBe(false);
      expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);
    });

    it("answers a refusal with 429", async () => {
      const request: ExpressRequest = buildRequest({
        body: { data: { email: "user@example.com" } },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 1; i++) {
        await runMiddleware({ request });
      }

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.code).toBe(ExceptionCode.TooManyRequestsException);
    });

    it("sets Retry-After on a refusal", async () => {
      const request: ExpressRequest = buildRequest({
        body: { data: { email: "user@example.com" } },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      let headers: Record<string, string> = {};

      for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 1; i++) {
        headers = (await runMiddleware({ request })).headers;
      }

      expect(Number(headers["Retry-After"])).toBeGreaterThan(0);
    });

    /*
     * These routes are careful not to say which half of a credential was
     * wrong. A limiter that answered differently for a real address than an
     * invented one would hand back the enumeration the handlers withhold.
     */
    it("says the same thing whichever counter fired", async () => {
      const accountRefused: ExpressRequest = buildRequest({
        body: { data: { email: "user@example.com" } },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 1; i++) {
        await runMiddleware({ request: accountRefused });
      }

      const accountMessage: string = (
        sendErrorResponseMock.mock.calls[0]?.[2] as Exception
      ).message;

      sendErrorResponseMock.mockClear();
      client.reset();

      for (let i: number = 0; i < PER_IP_LIMIT + 1; i++) {
        await runMiddleware({
          request: buildRequest({
            body: { data: { email: `user-${i}@example.com` } },
            headers: { "x-forwarded-for": "203.0.113.7" },
          }),
        });
      }

      const ipMessage: string = (
        sendErrorResponseMock.mock.calls[0]?.[2] as Exception
      ).message;

      expect(accountMessage).toBe(ipMessage);
    });

    /*
     * Fails closed. A 503 rather than an unthrottled route: logging in is
     * already impossible with Redis down, so this costs no availability that
     * was not already lost.
     */
    it("refuses with 503 rather than running unthrottled", async () => {
      isConnectedMock.mockReturnValue(false);

      const result: { nextCalled: boolean } = await runMiddleware({});

      expect(result.nextCalled).toBe(false);

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.code).toBe(ExceptionCode.ServiceUnavailableException);
    });

    it("logs the crossing once rather than every refusal", async () => {
      const request: ExpressRequest = buildRequest({
        body: { data: { email: "user@example.com" } },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < PER_ACCOUNT_LIMIT; i++) {
        await runMiddleware({ request });
      }

      loggerWarnMock.mockClear();

      await runMiddleware({ request });
      await runMiddleware({ request });
      await runMiddleware({ request });

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    });

    /*
     * A Redis outage puts every request on the unavailable path, so an
     * unguarded log line there is one per request for as long as it lasts.
     */
    it("throttles the counter-unavailable log", async () => {
      isConnectedMock.mockReturnValue(false);
      loggerErrorMock.mockClear();

      /* Move well past any interval a previous test may have consumed. */
      currentTime = currentTime + 10 * 60 * 1000;

      await runMiddleware({ bucket: IdentityRateLimitBucket.BackupCode });
      await runMiddleware({ bucket: IdentityRateLimitBucket.BackupCode });
      await runMiddleware({ bucket: IdentityRateLimitBucket.BackupCode });

      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    });

    it("logs the counter-unavailable condition again once the interval passes", async () => {
      isConnectedMock.mockReturnValue(false);
      loggerErrorMock.mockClear();

      currentTime = currentTime + 10 * 60 * 1000;
      await runMiddleware({ bucket: IdentityRateLimitBucket.TwoFactor });

      currentTime = currentTime + 61 * 1000;
      await runMiddleware({ bucket: IdentityRateLimitBucket.TwoFactor });

      expect(loggerErrorMock).toHaveBeenCalledTimes(2);
    });

    it("survives a response with no setHeader", async () => {
      const request: ExpressRequest = buildRequest({
        body: { data: { email: "user@example.com" } },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < PER_ACCOUNT_LIMIT + 1; i++) {
        await consume({
          accountKey: "user@example.com",
          clientIp: "203.0.113.7",
        });
      }

      let nextCalled: boolean = false;

      await expect(
        IdentityRateLimit.getMiddleware(IdentityRateLimitBucket.Login)(
          request,
          {} as unknown as ExpressResponse,
          (() => {
            nextCalled = true;
          }) as unknown as NextFunction,
        ),
      ).resolves.toBeUndefined();

      expect(nextCalled).toBe(false);
    });

    /*
     * The middleware and consume() must agree on the key, or the middleware
     * counts in a bucket nothing else reads.
     */
    it("counts the middleware request into the same bucket consume uses", async () => {
      await runMiddleware({});

      const decision: IdentityRateLimitDecision = await consume({
        accountKey: "user@example.com",
        clientIp: "203.0.113.7",
        bucket: IdentityRateLimitBucket.Login,
      });

      expect(decision.outcome).toBe(IdentityRateLimitOutcome.Allowed);

      const accountKeys: Array<string> = client.keysMatching(":login:a:");

      expect(accountKeys).toHaveLength(1);
      expect(client.counters.get(accountKeys[0] as string)).toBe(2);
    });
  });
});
