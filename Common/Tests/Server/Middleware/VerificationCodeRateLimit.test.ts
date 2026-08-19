import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * GHSA-5cr8-vph4-3hrf — the request limiter in front of the notification
 * channel verify and resend routes.
 *
 * The durable controls in ChannelVerification already bound guessing against
 * one issued code. What this limiter exists for is what a per-row counter
 * cannot see: a caller creating fresh rows to farm fresh attempt budgets, and
 * the volume of real messages sent to somebody who never asked for them. So
 * the tests that matter here are the ones about what the counters are KEYED
 * on — an address the caller cannot forge, a user id that survives row
 * rotation — plus the window arithmetic and the Redis-outage behaviour.
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
import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
  VerificationCodeRateLimitDecision,
  VerificationCodeRateLimitOutcome,
  VerificationCodeRateLimitScope,
} from "../../../Server/Middleware/VerificationCodeRateLimit";
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

/* Defaults baked into the limiter; asserted directly in one test below. */
const VERIFY_WINDOW_SECONDS: number = 15 * 60;
const VERIFY_PER_ITEM_LIMIT: number = 10;
const VERIFY_PER_USER_LIMIT: number = 50;
const VERIFY_PER_IP_LIMIT: number = 150;
const RESEND_PER_ITEM_LIMIT: number = 5;
const RESEND_PER_USER_LIMIT: number = 15;
const RESEND_PER_IP_LIMIT: number = 45;

const ITEM_A: string = "1a2b3c4d-1111-4111-8111-111111111111";
const ITEM_B: string = "1a2b3c4d-2222-4222-8222-222222222222";
const USER_A: string = "1a2b3c4d-3333-4333-8333-333333333333";
const USER_B: string = "1a2b3c4d-4444-4444-8444-444444444444";

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
  public failNextExec: Error | null = null;
  public malformedExecResult: unknown | undefined = undefined;

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
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
  body?: Record<string, unknown>;
  headers?: Record<string, string | Array<string>>;
  socketAddress?: string | undefined;
  userId?: string | undefined;
}

const buildRequest: (overrides?: BuildRequestOverrides) => ExpressRequest = (
  overrides: BuildRequestOverrides = {},
) => {
  return {
    body: overrides.body,
    headers: overrides.headers || {},
    socket: { remoteAddress: overrides.socketAddress },
    userAuthorization: overrides.userId
      ? { userId: new ObjectID(overrides.userId) }
      : undefined,
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

describe("VerificationCodeRateLimit", () => {
  let client: FakeRedisClient;
  let nowSpy: ReturnType<typeof jest.spyOn>;
  let currentTime: number;

  beforeEach(() => {
    jest.clearAllMocks();

    client = new FakeRedisClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);

    currentTime = 1_800_000_000_000;
    currentTime = currentTime - (currentTime % (VERIFY_WINDOW_SECONDS * 1000));
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
      return currentTime;
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  const consume: (data: {
    itemKey?: string;
    userKey?: string;
    clientIp?: string;
    bucket?: VerificationCodeRateLimitBucket;
  }) => Promise<VerificationCodeRateLimitDecision> = (data: {
    itemKey?: string;
    userKey?: string;
    clientIp?: string;
    bucket?: VerificationCodeRateLimitBucket;
  }) => {
    return VerificationCodeRateLimit.consume({
      itemKey: data.itemKey || ITEM_A,
      userKey: data.userKey || USER_A,
      clientIp: data.clientIp || "203.0.113.7",
      bucket: data.bucket || VerificationCodeRateLimitBucket.Verify,
    });
  };

  describe("resolveClientIp", () => {
    /*
     * The security-critical one. Nginx uses $proxy_add_x_forwarded_for, which
     * APPENDS the peer address to whatever the caller sent — so a caller that
     * sends its own X-Forwarded-For controls the LEFT of the list. A limiter
     * keyed on the leftmost entry is defeated with a header: one fresh bucket
     * per request, which is no limit at all.
     */
    it("bills the hop our own proxy appended, not the one the caller forged", () => {
      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.7" },
      });

      expect(VerificationCodeRateLimit.resolveClientIp(request)).toBe(
        "203.0.113.7",
      );
    });

    it("falls back to the socket address when there is no forwarded header", () => {
      expect(
        VerificationCodeRateLimit.resolveClientIp(
          buildRequest({ socketAddress: "198.51.100.4" }),
        ),
      ).toBe("198.51.100.4");
    });

    it("puts every unidentifiable caller in one shared bucket", () => {
      expect(VerificationCodeRateLimit.resolveClientIp(buildRequest())).toBe(
        "unknown",
      );
    });
  });

  describe("resolveUserKey", () => {
    it("keys on the signed-in user", () => {
      expect(
        VerificationCodeRateLimit.resolveUserKey(
          buildRequest({ userId: USER_A }),
        ),
      ).toBe(USER_A);
    });

    it("puts a request with no session in one shared bucket", () => {
      expect(VerificationCodeRateLimit.resolveUserKey(buildRequest())).toBe(
        "anonymous",
      );
    });
  });

  describe("resolveItemKey", () => {
    it("keys on the item id from the body", () => {
      expect(
        VerificationCodeRateLimit.resolveItemKey(
          buildRequest({ body: { itemId: ITEM_A } }),
        ),
      ).toBe(ITEM_A);
    });

    it("normalises case so one row cannot become two buckets", () => {
      expect(
        VerificationCodeRateLimit.resolveItemKey(
          buildRequest({ body: { itemId: ITEM_A.toUpperCase() } }),
        ),
      ).toBe(ITEM_A);
    });

    /*
     * Bounds Redis memory against a caller feeding junk ids, and groups them
     * correctly: none of those requests can name a real row, so one small
     * shared allowance between all of them is exactly right.
     */
    it("collapses junk ids into one shared bucket", () => {
      expect(
        VerificationCodeRateLimit.resolveItemKey(
          buildRequest({ body: { itemId: "not-a-uuid" } }),
        ),
      ).toBe("invalid");

      expect(
        VerificationCodeRateLimit.resolveItemKey(
          buildRequest({ body: { itemId: "x".repeat(5000) } }),
        ),
      ).toBe("invalid");
    });

    it("handles a missing or non-string item id", () => {
      expect(VerificationCodeRateLimit.resolveItemKey(buildRequest())).toBe(
        "none",
      );
      expect(
        VerificationCodeRateLimit.resolveItemKey(
          buildRequest({ body: { itemId: 12345 } }),
        ),
      ).toBe("none");
      expect(
        VerificationCodeRateLimit.resolveItemKey(
          buildRequest({ body: { itemId: "   " } }),
        ),
      ).toBe("none");
    });
  });

  describe("counting", () => {
    it("allows requests up to the per-item limit and refuses the next one", async () => {
      for (let i: number = 0; i < VERIFY_PER_ITEM_LIMIT; i++) {
        const decision: VerificationCodeRateLimitDecision = await consume({});

        expect(decision.outcome).toBe(VerificationCodeRateLimitOutcome.Allowed);
      }

      const rejected: VerificationCodeRateLimitDecision = await consume({});

      expect(rejected.outcome).toBe(
        VerificationCodeRateLimitOutcome.RateLimited,
      );
      expect(rejected.scope).toBe(VerificationCodeRateLimitScope.Item);
      expect(rejected.isFirstRejectionInWindow).toBe(true);
    });

    it("reports only the first rejection of a window", async () => {
      for (let i: number = 0; i < VERIFY_PER_ITEM_LIMIT + 1; i++) {
        await consume({});
      }

      const second: VerificationCodeRateLimitDecision = await consume({});

      expect(second.outcome).toBe(VerificationCodeRateLimitOutcome.RateLimited);
      expect(second.isFirstRejectionInWindow).toBe(false);
    });

    /*
     * THE bypass this middleware exists to close. Nothing stops a caller
     * creating channel rows, and each new row is a fresh code with a fresh
     * five-attempt budget — so a per-row limit alone is worth nothing. The
     * user counter is what survives row rotation.
     */
    it("does not hand out a fresh allowance for a fresh row", async () => {
      let allowed: number = 0;

      for (let i: number = 0; i < VERIFY_PER_USER_LIMIT + 20; i++) {
        /* A different row every single time. */
        const decision: VerificationCodeRateLimitDecision = await consume({
          itemKey: `1a2b3c4d-0000-4000-8000-${i.toString().padStart(12, "0")}`,
        });

        if (decision.outcome === VerificationCodeRateLimitOutcome.Allowed) {
          allowed++;
        }
      }

      expect(allowed).toBe(VERIFY_PER_USER_LIMIT);
    });

    it("refuses on the user counter and names it", async () => {
      for (let i: number = 0; i < VERIFY_PER_USER_LIMIT; i++) {
        await consume({
          itemKey: `1a2b3c4d-0000-4000-8000-${i.toString().padStart(12, "0")}`,
        });
      }

      const rejected: VerificationCodeRateLimitDecision = await consume({
        itemKey: ITEM_B,
      });

      expect(rejected.scope).toBe(VerificationCodeRateLimitScope.User);
    });

    /*
     * And rotating the ACCOUNT does not work either, because the address
     * counter sits behind the user counter.
     */
    it("does not hand out a fresh allowance for a fresh account", async () => {
      let allowed: number = 0;

      for (let i: number = 0; i < VERIFY_PER_IP_LIMIT + 20; i++) {
        const decision: VerificationCodeRateLimitDecision = await consume({
          itemKey: `1a2b3c4d-0000-4000-8000-${i.toString().padStart(12, "0")}`,
          userKey: `1a2b3c4d-1000-4000-8000-${i.toString().padStart(12, "0")}`,
        });

        if (decision.outcome === VerificationCodeRateLimitOutcome.Allowed) {
          allowed++;
        }
      }

      expect(allowed).toBe(VERIFY_PER_IP_LIMIT);
    });

    it("keeps separate users apart", async () => {
      for (let i: number = 0; i < VERIFY_PER_ITEM_LIMIT + 1; i++) {
        await consume({ userKey: USER_A });
      }

      const otherUser: VerificationCodeRateLimitDecision = await consume({
        userKey: USER_B,
      });

      expect(otherUser.outcome).toBe(VerificationCodeRateLimitOutcome.Allowed);
    });

    /*
     * The item counter is keyed on item AND user, so a caller cannot burn the
     * real owner's allowance by hammering an id they do not own.
     */
    it("does not let one user spend another user's per-item allowance", async () => {
      for (let i: number = 0; i < VERIFY_PER_ITEM_LIMIT + 5; i++) {
        await consume({ userKey: USER_B, itemKey: ITEM_A });
      }

      expect(
        (await consume({ userKey: USER_A, itemKey: ITEM_A })).outcome,
      ).toBe(VerificationCodeRateLimitOutcome.Allowed);
    });

    it("counts verify and resend against separate budgets", async () => {
      for (let i: number = 0; i < RESEND_PER_ITEM_LIMIT + 1; i++) {
        await consume({ bucket: VerificationCodeRateLimitBucket.Resend });
      }

      expect(
        (await consume({ bucket: VerificationCodeRateLimitBucket.Verify }))
          .outcome,
      ).toBe(VerificationCodeRateLimitOutcome.Allowed);
    });

    it("holds resends to a tighter budget than verifies", async () => {
      let allowed: number = 0;

      for (let i: number = 0; i < RESEND_PER_USER_LIMIT + 10; i++) {
        const decision: VerificationCodeRateLimitDecision = await consume({
          itemKey: `1a2b3c4d-0000-4000-8000-${i.toString().padStart(12, "0")}`,
          bucket: VerificationCodeRateLimitBucket.Resend,
        });

        if (decision.outcome === VerificationCodeRateLimitOutcome.Allowed) {
          allowed++;
        }
      }

      expect(allowed).toBe(RESEND_PER_USER_LIMIT);
      expect(RESEND_PER_USER_LIMIT).toBeLessThan(VERIFY_PER_USER_LIMIT);
      expect(RESEND_PER_IP_LIMIT).toBeLessThan(VERIFY_PER_IP_LIMIT);
    });

    /*
     * A rejected request still consumes its counter. Otherwise a caller who
     * keeps hammering is handed a fresh allowance the moment they cross the
     * line, which is the opposite of what a limiter is for.
     */
    it("keeps counting rejected requests, so hammering does not reset the window", async () => {
      for (let i: number = 0; i < VERIFY_PER_ITEM_LIMIT + 25; i++) {
        await consume({});
      }

      const itemKeyPattern: string = `:t:${USER_A}:${ITEM_A}:`;
      const counterKey: string = Array.from(client.counters.keys()).find(
        (key: string) => {
          return key.includes(itemKeyPattern);
        },
      ) as string;

      expect(client.counters.get(counterKey)).toBe(VERIFY_PER_ITEM_LIMIT + 25);
    });
  });

  describe("windows", () => {
    it("sets a TTL only on the request that created the counter", async () => {
      await consume({});
      await consume({});
      await consume({});

      const counterKey: string = Array.from(client.counters.keys()).find(
        (key: string) => {
          return key.includes(`:t:${USER_A}:${ITEM_A}:`);
        },
      ) as string;

      /*
       * Re-issuing EXPIRE on every increment would slide the window forward
       * for as long as the load continued, so a caller who tripped the limit
       * once could never recover.
       */
      expect(client.expiresForKey(counterKey)).toHaveLength(1);
      expect(client.expiresForKey(counterKey)[0]?.ttlSeconds).toBe(
        VERIFY_WINDOW_SECONDS * 2,
      );
    });

    it("starts a fresh allowance in the next window", async () => {
      for (let i: number = 0; i < VERIFY_PER_ITEM_LIMIT + 1; i++) {
        await consume({});
      }

      currentTime += VERIFY_WINDOW_SECONDS * 1000;

      expect((await consume({})).outcome).toBe(
        VerificationCodeRateLimitOutcome.Allowed,
      );
    });

    it("tells a rejected caller when the window actually rolls", async () => {
      currentTime += 60 * 1000;

      for (let i: number = 0; i < VERIFY_PER_ITEM_LIMIT + 1; i++) {
        await consume({});
      }

      const rejected: VerificationCodeRateLimitDecision = await consume({});

      expect(rejected.retryAfterSeconds).toBe(VERIFY_WINDOW_SECONDS - 60);
    });
  });

  describe("when Redis is gone", () => {
    /*
     * Fails OPEN, unlike PublicDashboardRateLimit's master-password bucket.
     * The difference is that there the counter IS the only thing bounding
     * guesses; here the expiry, the attempt counter, the rotation and the
     * resend cooldown all live in Postgres and are all still in force, so
     * refusing every verification during a Redis blip would cost real users a
     * great deal to buy a control that is momentarily redundant.
     */
    it("reports the counter as unavailable when there is no client", async () => {
      getClientMock.mockReturnValue(null);

      expect((await consume({})).outcome).toBe(
        VerificationCodeRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports the counter as unavailable when Redis is disconnected", async () => {
      isConnectedMock.mockReturnValue(false);

      expect((await consume({})).outcome).toBe(
        VerificationCodeRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports the counter as unavailable when the pipeline throws", async () => {
      client.failNextExec = new Error("redis is unwell");

      expect((await consume({})).outcome).toBe(
        VerificationCodeRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports the counter as unavailable on a malformed reply", async () => {
      client.malformedExecResult = [[null, "not-a-number"]];

      expect((await consume({})).outcome).toBe(
        VerificationCodeRateLimitOutcome.CounterUnavailable,
      );
    });

    it("lets the request through rather than blocking verification", async () => {
      getClientMock.mockReturnValue(null);

      const next: NextFunction = jest.fn() as unknown as NextFunction;
      const built: BuiltResponse = buildResponse();

      await VerificationCodeRateLimit.getMiddleware(
        VerificationCodeRateLimitBucket.Verify,
      )(
        buildRequest({ body: { itemId: ITEM_A }, userId: USER_A }),
        built.response,
        next,
      );

      expect(next).toHaveBeenCalled();
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    /*
     * An outage means EVERY request takes this path, so an unguarded log line
     * is one per request for as long as the outage lasts — burying the
     * incident it is reporting.
     */
    it("does not log once per request during an outage", async () => {
      getClientMock.mockReturnValue(null);

      const middleware: (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => Promise<void> = VerificationCodeRateLimit.getMiddleware(
        VerificationCodeRateLimitBucket.Verify,
      );

      const built: BuiltResponse = buildResponse();

      for (let i: number = 0; i < 20; i++) {
        await middleware(
          buildRequest({ body: { itemId: ITEM_A }, userId: USER_A }),
          built.response,
          jest.fn() as unknown as NextFunction,
        );
      }

      expect(loggerWarnMock.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  describe("middleware", () => {
    const runMiddleware: (data: {
      bucket: VerificationCodeRateLimitBucket;
      times: number;
    }) => Promise<{
      next: NextFunction;
      headers: Record<string, string>;
    }> = async (data: {
      bucket: VerificationCodeRateLimitBucket;
      times: number;
    }) => {
      const middleware: (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => Promise<void> = VerificationCodeRateLimit.getMiddleware(data.bucket);

      let next: NextFunction = jest.fn() as unknown as NextFunction;
      const built: BuiltResponse = buildResponse();

      for (let i: number = 0; i < data.times; i++) {
        next = jest.fn() as unknown as NextFunction;

        await middleware(
          buildRequest({
            body: { itemId: ITEM_A },
            userId: USER_A,
            headers: { "x-forwarded-for": "203.0.113.7" },
          }),
          built.response,
          next,
        );
      }

      return { next, headers: built.headers };
    };

    it("calls next while the caller is inside the budget", async () => {
      const result: {
        next: NextFunction;
        headers: Record<string, string>;
      } = await runMiddleware({
        bucket: VerificationCodeRateLimitBucket.Verify,
        times: 1,
      });

      expect(result.next).toHaveBeenCalled();
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    it("answers 429 and sets Retry-After once the budget is spent", async () => {
      const result: {
        next: NextFunction;
        headers: Record<string, string>;
      } = await runMiddleware({
        bucket: VerificationCodeRateLimitBucket.Verify,
        times: VERIFY_PER_ITEM_LIMIT + 1,
      });

      expect(result.next).not.toHaveBeenCalled();
      expect(sendErrorResponseMock).toHaveBeenCalled();

      const exception: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(exception.code).toBe(ExceptionCode.TooManyRequestsException);
      expect(exception.message).toBe(
        "Too many verification attempts. Please try again later.",
      );
      expect(result.headers["Retry-After"]).toBe(String(VERIFY_WINDOW_SECONDS));
    });

    it("says something different when it is codes rather than attempts", async () => {
      await runMiddleware({
        bucket: VerificationCodeRateLimitBucket.Resend,
        times: RESEND_PER_ITEM_LIMIT + 1,
      });

      const exception: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(exception.message).toBe(
        "Too many verification codes requested. Please try again later.",
      );
    });

    /*
     * The forged-header case again, this time end to end: a caller who sends
     * a fresh X-Forwarded-For on every request must not land in a fresh
     * bucket every time.
     */
    it("cannot be escaped by rotating a forged X-Forwarded-For", async () => {
      const middleware: (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => Promise<void> = VerificationCodeRateLimit.getMiddleware(
        VerificationCodeRateLimitBucket.Verify,
      );

      const built: BuiltResponse = buildResponse();
      let allowed: number = 0;

      for (let i: number = 0; i < VERIFY_PER_ITEM_LIMIT + 10; i++) {
        const next: MockedFn = jest.fn();

        await middleware(
          buildRequest({
            body: { itemId: ITEM_A },
            userId: USER_A,
            headers: {
              "x-forwarded-for": `10.0.0.${i}, 203.0.113.7`,
            },
          }),
          built.response,
          next as unknown as NextFunction,
        );

        if (next.mock.calls.length > 0) {
          allowed++;
        }
      }

      expect(allowed).toBe(VERIFY_PER_ITEM_LIMIT);
    });
  });
});
