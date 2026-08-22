import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The throttle in front of the public marketing forms.
 *
 * The endpoint behind it is anonymous by construction — it exists so a
 * stranger who has not signed up can ask to talk to sales — and each accepted
 * submission spends two things that are not free: a row in the conversion
 * ledger that ad platforms are later told about, and an email into the sales
 * inbox.
 *
 * What matters here is what the counters are KEYED on and which way it fails:
 *
 *   - the client address must come from the trusted end of X-Forwarded-For. A
 *     caller who can pick their own bucket has no limit at all;
 *   - the email bucket must be the hash, never the address, because Redis keys
 *     turn up in slow logs and SCAN output;
 *   - a Redis outage must let leads through, not refuse them.
 * ---------------------------------------------------------------------------
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

import Attribution from "../../../Server/Utils/Attribution";
import Redis from "../../../Server/Infrastructure/Redis";
import MarketingFormRateLimit, {
  MarketingFormRateLimitDecision,
  MarketingFormRateLimitOutcome,
  MarketingFormRateLimitScope,
} from "../../../Server/Middleware/MarketingFormRateLimit";
import { ExpressRequest } from "../../../Server/Utils/Express";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;

// Defaults baked into the limiter; asserted directly in one test below.
const WINDOW_SECONDS: number = 60 * 60;
const PER_EMAIL_LIMIT: number = 5;
const PER_IP_LIMIT: number = 20;

interface RecordedExpire {
  key: string;
  ttlSeconds: number;
}

/*
 * A fake that behaves like a Redis counter store rather than a bag of
 * assertions: INCR really increments and EXPIRE really records a TTL, so the
 * window and reset tests exercise the limiter's arithmetic instead of
 * restating it.
 */
class FakeRedisClient {
  public counters: Map<string, number> = new Map<string, number>();
  public expires: Array<RecordedExpire> = [];
  public failNextExec: Error | null = null;
  public malformedExecResult: unknown | undefined = undefined;

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
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

type ConsumeFunction = (data?: {
  emailKey?: string | undefined;
  clientIp?: string | undefined;
}) => Promise<MarketingFormRateLimitDecision>;

const consume: ConsumeFunction = (
  data: { emailKey?: string | undefined; clientIp?: string | undefined } = {},
): Promise<MarketingFormRateLimitDecision> => {
  return MarketingFormRateLimit.consume({
    emailKey: data.emailKey || "email-a",
    clientIp: data.clientIp || "203.0.113.7",
  });
};

type BuildRequestFunction = (overrides?: {
  headers?: Record<string, string | Array<string>>;
  socketAddress?: string | undefined;
}) => ExpressRequest;

const buildRequest: BuildRequestFunction = (
  overrides: {
    headers?: Record<string, string | Array<string>>;
    socketAddress?: string | undefined;
  } = {},
): ExpressRequest => {
  return {
    headers: overrides.headers || {},
    socket: { remoteAddress: overrides.socketAddress },
  } as unknown as ExpressRequest;
};

describe("MarketingFormRateLimit", () => {
  let client: FakeRedisClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new FakeRedisClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);
    jest
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-19T10:00:00.000Z").getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("budgets", () => {
    test("publishes the defaults it enforces", () => {
      expect(MarketingFormRateLimit.getLimits()).toEqual({
        windowSeconds: WINDOW_SECONDS,
        perEmailLimit: PER_EMAIL_LIMIT,
        perIpLimit: PER_IP_LIMIT,
      });
    });

    test("allows a submission right up to the per-email limit", async () => {
      for (let attempt: number = 0; attempt < PER_EMAIL_LIMIT; attempt++) {
        const decision: MarketingFormRateLimitDecision = await consume();
        expect(decision.outcome).toBe(MarketingFormRateLimitOutcome.Allowed);
      }
    });

    test("rejects the submission after the per-email limit", async () => {
      for (let attempt: number = 0; attempt < PER_EMAIL_LIMIT; attempt++) {
        await consume();
      }

      const decision: MarketingFormRateLimitDecision = await consume();

      expect(decision.outcome).toBe(MarketingFormRateLimitOutcome.RateLimited);
      expect(decision.scope).toBe(MarketingFormRateLimitScope.Email);
    });

    /*
     * A corporate NAT can put a whole company behind one address, so the
     * address budget is deliberately several times the per-email one.
     */
    test("rejects on the address budget once enough addresses are used", async () => {
      for (let attempt: number = 0; attempt < PER_IP_LIMIT; attempt++) {
        await consume({ emailKey: `email-${attempt}` });
      }

      const decision: MarketingFormRateLimitDecision = await consume({
        emailKey: "one-more-email",
      });

      expect(decision.outcome).toBe(MarketingFormRateLimitOutcome.RateLimited);
      expect(decision.scope).toBe(MarketingFormRateLimitScope.Ip);
    });

    test("keeps a rejected caller pinned rather than handing back allowance", async () => {
      for (let attempt: number = 0; attempt < PER_EMAIL_LIMIT + 3; attempt++) {
        await consume();
      }

      // Every request counts, including the refused ones.
      const emailKeys: Array<string> = client.keysMatching(":e:email-a:");

      expect(client.counters.get(emailKeys[0]!)).toBe(PER_EMAIL_LIMIT + 3);
    });

    test("keeps separate budgets per email and per address", async () => {
      for (let attempt: number = 0; attempt < PER_EMAIL_LIMIT; attempt++) {
        await consume({ emailKey: "email-a" });
      }

      expect((await consume({ emailKey: "email-b" })).outcome).toBe(
        MarketingFormRateLimitOutcome.Allowed,
      );
    });
  });

  describe("the window", () => {
    test("resets when the window rolls", async () => {
      for (let attempt: number = 0; attempt < PER_EMAIL_LIMIT + 1; attempt++) {
        await consume();
      }

      jest
        .spyOn(Date, "now")
        .mockReturnValue(new Date("2026-08-19T11:00:01.000Z").getTime());

      expect((await consume()).outcome).toBe(
        MarketingFormRateLimitOutcome.Allowed,
      );
    });

    /*
     * The expiry is set only on the write that CREATED the key. Re-issuing it
     * on every increment would slide the window forward for as long as the
     * load continues, so a caller who tripped the limit once could never
     * recover.
     */
    test("sets the expiry once per key, not on every increment", async () => {
      await consume();
      await consume();
      await consume();

      expect(client.expires).toHaveLength(2);
      expect(client.expires[0]?.ttlSeconds).toBe(WINDOW_SECONDS * 2);
    });

    test("tells a rejected caller when the window actually rolls", async () => {
      jest
        .spyOn(Date, "now")
        .mockReturnValue(new Date("2026-08-19T10:59:00.000Z").getTime());

      for (let attempt: number = 0; attempt < PER_EMAIL_LIMIT + 1; attempt++) {
        await consume();
      }

      const decision: MarketingFormRateLimitDecision = await consume();

      expect(decision.retryAfterSeconds).toBe(60);
    });
  });

  describe("the client address", () => {
    /*
     * Express.getClientIp takes the LEFTMOST X-Forwarded-For entry, which the
     * caller sets themselves. For a rate limiter that is fatal: a fresh
     * spoofed value per request is a fresh bucket per request, which is no
     * limit at all. The shared ClientIp helper reads from the trusted end.
     */
    test("ignores an address the caller prepended to X-Forwarded-For", async () => {
      const spoofed: string = MarketingFormRateLimit.resolveClientIp(
        buildRequest({
          headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.7" },
          socketAddress: "10.0.0.1",
        }),
      );

      const alsoSpoofed: string = MarketingFormRateLimit.resolveClientIp(
        buildRequest({
          headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.7" },
          socketAddress: "10.0.0.1",
        }),
      );

      // Two different forged values, one bucket.
      expect(spoofed).toBe(alsoSpoofed);
      expect(spoofed).not.toBe("1.2.3.4");
    });

    /*
     * Everything with no resolvable address shares one bucket. That is the
     * conservative direction: an unidentifiable caller should not be handed a
     * private allowance.
     */
    test("collapses an unresolvable address into one shared bucket", () => {
      expect(MarketingFormRateLimit.resolveClientIp(buildRequest())).toBe(
        "unknown",
      );
    });

    test("sanitizes the address into a predictable key charset", () => {
      const resolved: string = MarketingFormRateLimit.resolveClientIp(
        buildRequest({ socketAddress: "2001:db8::1" }),
      );

      expect(resolved).toMatch(/^[a-zA-Z0-9._:%\-[\]]+$/);
    });
  });

  describe("the email key", () => {
    /*
     * Redis keys turn up in slow logs, monitoring and SCAN output. A
     * prospect's address does not belong in any of them.
     */
    test("is the hash, never the address", () => {
      const key: string =
        MarketingFormRateLimit.resolveEmailKey("ada@example.com");

      expect(key).not.toContain("ada");
      expect(key).not.toContain("@");
      expect(Attribution.hashEmail("ada@example.com")).toContain(key);
    });

    test("matches addresses differing only in case or padding", () => {
      expect(MarketingFormRateLimit.resolveEmailKey("  ADA@Example.com ")).toBe(
        MarketingFormRateLimit.resolveEmailKey("ada@example.com"),
      );
    });

    test("separates genuinely different addresses", () => {
      expect(
        MarketingFormRateLimit.resolveEmailKey("ada@example.com"),
      ).not.toBe(MarketingFormRateLimit.resolveEmailKey("grace@example.com"));
    });

    test.each([undefined, "", "   "])(
      "collapses %p into one shared bucket",
      (value: string | undefined) => {
        expect(MarketingFormRateLimit.resolveEmailKey(value)).toBe("none");
      },
    );
  });

  /*
   * This limiter FAILS OPEN, deliberately. The thing behind it is a sales
   * lead: refusing real leads for the duration of a Redis incident costs more
   * than the spam a short unthrottled window admits. That is the opposite of
   * the call IdentityRateLimit makes, and correctly so — there the counter is
   * the only thing between an attacker and an account.
   */
  describe("when the counter is unavailable", () => {
    test("reports unavailable rather than rejecting when Redis has no client", async () => {
      getClientMock.mockReturnValue(null);

      expect((await consume()).outcome).toBe(
        MarketingFormRateLimitOutcome.CounterUnavailable,
      );
    });

    test("reports unavailable when Redis is disconnected", async () => {
      isConnectedMock.mockReturnValue(false);

      expect((await consume()).outcome).toBe(
        MarketingFormRateLimitOutcome.CounterUnavailable,
      );
    });

    test("reports unavailable when the pipeline throws", async () => {
      client.failNextExec = new Error("connection reset");

      expect((await consume()).outcome).toBe(
        MarketingFormRateLimitOutcome.CounterUnavailable,
      );
    });

    test.each([
      ["a null result", null],
      ["a short result", [[null, 1]]],
      [
        "a non-numeric counter",
        [
          [null, "1"],
          [null, 1],
        ],
      ],
      [
        "a per-command error",
        [
          [new Error("bad"), null],
          [null, 1],
        ],
      ],
    ])(
      "reports unavailable for %s rather than trusting it",
      async (_label: string, result: unknown) => {
        client.malformedExecResult = result;

        expect((await consume()).outcome).toBe(
          MarketingFormRateLimitOutcome.CounterUnavailable,
        );
      },
    );
  });
});
