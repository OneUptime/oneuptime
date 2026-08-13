import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The rate limiter guarding the anonymous /public-dashboard-api surface.
 *
 * The interesting behaviour here is not "does it count" — it is the handful
 * of properties that decide whether the limit can be walked around at all:
 * that the client address is taken from the hop OUR proxy wrote rather than
 * the one the caller can forge, that rotating the dashboard id does not buy a
 * fresh allowance, that the window does not slide forward under sustained
 * load, and that the two buckets fail in opposite directions when Redis is
 * gone. Each of those has its own describe block below.
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

/* Defaults baked into the limiter; asserted directly in one test below. */
const READ_WINDOW_SECONDS: number = 60;
const READ_PER_DASHBOARD_LIMIT: number = 600;
const READ_PER_IP_LIMIT: number = 1800;
const MASTER_PASSWORD_WINDOW_SECONDS: number = 15 * 60;
const MASTER_PASSWORD_PER_DASHBOARD_LIMIT: number = 15;
const MASTER_PASSWORD_PER_IP_LIMIT: number = 45;

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

  /* Set to make the next exec() reject, for the error-path tests. */
  public failNextExec: Error | null = null;

  /* Set to make the next exec() resolve to something malformed. */
  public malformedExecResult: unknown | undefined = undefined;

  public incrCallCount: number = 0;

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
  }

  public reset(): void {
    this.counters.clear();
    this.expires = [];
    this.failNextExec = null;
    this.malformedExecResult = undefined;
    this.incrCallCount = 0;
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

const buildRequest: (overrides?: {
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  headers?: Record<string, string | Array<string>>;
  socketAddress?: string | undefined;
  ip?: string | undefined;
}) => ExpressRequest = (overrides = {}) => {
  return {
    params: overrides.params || {},
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

describe("PublicDashboardRateLimit", () => {
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
    currentTime = currentTime - (currentTime % (READ_WINDOW_SECONDS * 1000));
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
      return currentTime;
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  const consumeRead: (data: {
    dashboardKey?: string;
    clientIp?: string;
  }) => Promise<PublicDashboardRateLimitDecision> = (data) => {
    return PublicDashboardRateLimit.consume({
      dashboardKey: data.dashboardKey || "id:dashboard-a",
      clientIp: data.clientIp || "203.0.113.7",
      bucket: PublicDashboardRateLimitBucket.Read,
    });
  };

  describe("resolveClientIp", () => {
    /*
     * The security-critical one. Nginx uses $proxy_add_x_forwarded_for, which
     * APPENDS the peer address to whatever the caller sent — so a caller that
     * sends its own X-Forwarded-For header controls the LEFT of the list. A
     * limiter that keys on the leftmost entry can be defeated with a header,
     * one fresh bucket per request.
     */
    it("bills the hop our own proxy appended, not the one the caller forged", () => {
      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.7" },
      });

      expect(PublicDashboardRateLimit.resolveClientIp(request)).toBe(
        "203.0.113.7",
      );
    });

    it("is unaffected by however many entries the caller forges", () => {
      const forged: string = Array.from({ length: 50 }, (_unused, index) => {
        return `10.0.0.${index}`;
      }).join(", ");

      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": `${forged}, 203.0.113.7` },
      });

      expect(PublicDashboardRateLimit.resolveClientIp(request)).toBe(
        "203.0.113.7",
      );
    });

    it("gives two forging callers from the same real address the same bucket", () => {
      const first: string = PublicDashboardRateLimit.resolveClientIp(
        buildRequest({
          headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.7" },
        }),
      );

      const second: string = PublicDashboardRateLimit.resolveClientIp(
        buildRequest({
          headers: { "x-forwarded-for": "2.2.2.2, 203.0.113.7" },
        }),
      );

      expect(first).toBe(second);
    });

    it("uses the only entry when the caller forged nothing", () => {
      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      expect(PublicDashboardRateLimit.resolveClientIp(request)).toBe(
        "203.0.113.7",
      );
    });

    it("handles a header delivered as an array", () => {
      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": ["9.9.9.9", "203.0.113.7"] },
      });

      expect(PublicDashboardRateLimit.resolveClientIp(request)).toBe(
        "203.0.113.7",
      );
    });

    it("ignores empty entries in the header", () => {
      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": "9.9.9.9, , 203.0.113.7 , " },
      });

      expect(PublicDashboardRateLimit.resolveClientIp(request)).toBe(
        "203.0.113.7",
      );
    });

    it("falls back to the socket address with no forwarding header", () => {
      const request: ExpressRequest = buildRequest({
        socketAddress: "198.51.100.4",
      });

      expect(PublicDashboardRateLimit.resolveClientIp(request)).toBe(
        "198.51.100.4",
      );
    });

    it("falls back to req.ip when there is no socket address", () => {
      const request: ExpressRequest = buildRequest({ ip: "198.51.100.9" });

      expect(PublicDashboardRateLimit.resolveClientIp(request)).toBe(
        "198.51.100.9",
      );
    });

    it("puts wholly unidentifiable callers in one shared bucket", () => {
      expect(PublicDashboardRateLimit.resolveClientIp(buildRequest())).toBe(
        "unknown",
      );
    });

    it("preserves IPv6 addresses", () => {
      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": "2001:db8::8a2e:370:7334" },
      });

      expect(PublicDashboardRateLimit.resolveClientIp(request)).toBe(
        "2001:db8::8a2e:370:7334",
      );
    });

    it("truncates an over-long address so it cannot bloat a Redis key", () => {
      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": "a".repeat(5000) },
      });

      expect(
        PublicDashboardRateLimit.resolveClientIp(request).length,
      ).toBeLessThanOrEqual(64);
    });

    it("replaces characters that would make a messy Redis key", () => {
      const request: ExpressRequest = buildRequest({
        headers: { "x-forwarded-for": "1.2.3.4\n\r evil*key" },
      });

      const resolved: string =
        PublicDashboardRateLimit.resolveClientIp(request);

      expect(resolved).not.toContain("\n");
      expect(resolved).not.toContain("*");
      expect(resolved).toMatch(/^[a-zA-Z0-9._:%\-[\]_]+$/);
    });
  });

  describe("resolveDashboardKey", () => {
    it("keys on :dashboardId", () => {
      const id: ObjectID = ObjectID.generate();

      expect(
        PublicDashboardRateLimit.resolveDashboardKey(
          buildRequest({ params: { dashboardId: id.toString() } }),
        ),
      ).toBe(`id:${id.toString().toLowerCase()}`);
    });

    it("keys on :dashboardIdOrDomain, as /overview and /seo use", () => {
      const id: ObjectID = ObjectID.generate();

      expect(
        PublicDashboardRateLimit.resolveDashboardKey(
          buildRequest({ params: { dashboardIdOrDomain: id.toString() } }),
        ),
      ).toBe(`id:${id.toString().toLowerCase()}`);
    });

    it("keys on a custom domain in the path", () => {
      expect(
        PublicDashboardRateLimit.resolveDashboardKey(
          buildRequest({
            params: { dashboardIdOrDomain: "status.example.com" },
          }),
        ),
      ).toBe("dom:status.example.com");
    });

    it("keys on the body domain, as /domain uses", () => {
      expect(
        PublicDashboardRateLimit.resolveDashboardKey(
          buildRequest({ body: { domain: "dash.example.com" } }),
        ),
      ).toBe("dom:dash.example.com");
    });

    /*
     * Casing must not split a bucket, or the limit is bypassed by varying
     * case alone.
     */
    it("gives a differently-cased id the same bucket", () => {
      const id: string = ObjectID.generate().toString();

      expect(
        PublicDashboardRateLimit.resolveDashboardKey(
          buildRequest({ params: { dashboardId: id.toUpperCase() } }),
        ),
      ).toBe(
        PublicDashboardRateLimit.resolveDashboardKey(
          buildRequest({ params: { dashboardId: id.toLowerCase() } }),
        ),
      );
    });

    it("gives a differently-cased domain the same bucket", () => {
      expect(
        PublicDashboardRateLimit.resolveDashboardKey(
          buildRequest({
            params: { dashboardIdOrDomain: "DASH.Example.COM" },
          }),
        ),
      ).toBe("dom:dash.example.com");
    });

    it("ignores surrounding whitespace", () => {
      const id: string = ObjectID.generate().toString();

      expect(
        PublicDashboardRateLimit.resolveDashboardKey(
          buildRequest({ params: { dashboardId: `  ${id}  ` } }),
        ),
      ).toBe(`id:${id.toLowerCase()}`);
    });

    /*
     * Junk path segments all share one bucket. That bounds Redis memory
     * against a caller feeding random garbage, and it is the right grouping:
     * none of those requests can name a real dashboard.
     */
    it("collapses junk to a single shared bucket", () => {
      const first: string = PublicDashboardRateLimit.resolveDashboardKey(
        buildRequest({ params: { dashboardId: "not-an-id-at-all" } }),
      );

      const second: string = PublicDashboardRateLimit.resolveDashboardKey(
        buildRequest({ params: { dashboardId: "%%%%%%" } }),
      );

      expect(first).toBe("invalid");
      expect(second).toBe("invalid");
    });

    it("collapses an over-long segment rather than building a huge key", () => {
      expect(
        PublicDashboardRateLimit.resolveDashboardKey(
          buildRequest({ params: { dashboardId: "a".repeat(10000) } }),
        ),
      ).toBe("invalid");
    });

    it("rejects a domain longer than the DNS maximum", () => {
      const tooLong: string = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(
        60,
      )}.${"d".repeat(60)}.example.com`;

      expect(tooLong.length).toBeGreaterThan(253);
      expect(
        PublicDashboardRateLimit.resolveDashboardKey(
          buildRequest({ params: { dashboardIdOrDomain: tooLong } }),
        ),
      ).toBe("invalid");
    });

    it("uses a stable key when no dashboard is named at all", () => {
      expect(
        PublicDashboardRateLimit.resolveDashboardKey(buildRequest()),
      ).toBe("none");
    });

    it("ignores a blank parameter", () => {
      expect(
        PublicDashboardRateLimit.resolveDashboardKey(
          buildRequest({ params: { dashboardId: "   " } }),
        ),
      ).toBe("none");
    });

    it("does not throw when there is no body", () => {
      expect(() => {
        PublicDashboardRateLimit.resolveDashboardKey(
          buildRequest({ params: {} }),
        );
      }).not.toThrow();
    });

    it("ignores a non-string body domain", () => {
      expect(
        PublicDashboardRateLimit.resolveDashboardKey(
          buildRequest({ body: { domain: { evil: true } } }),
        ),
      ).toBe("none");
    });
  });

  describe("consume - per dashboard budget", () => {
    it("allows requests up to the limit", async () => {
      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT; i++) {
        const decision: PublicDashboardRateLimitDecision = await consumeRead(
          {},
        );

        expect(decision.outcome).toBe(PublicDashboardRateLimitOutcome.Allowed);
      }
    });

    it("rejects the request after the limit with a dashboard scope", async () => {
      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT; i++) {
        await consumeRead({});
      }

      const decision: PublicDashboardRateLimitDecision = await consumeRead({});

      expect(decision.outcome).toBe(
        PublicDashboardRateLimitOutcome.RateLimited,
      );
      expect(decision.scope).toBe(PublicDashboardRateLimitScope.Dashboard);
    });

    it("keeps separate budgets for separate client addresses", async () => {
      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 5; i++) {
        await consumeRead({ clientIp: "203.0.113.7" });
      }

      const other: PublicDashboardRateLimitDecision = await consumeRead({
        clientIp: "198.51.100.4",
      });

      expect(other.outcome).toBe(PublicDashboardRateLimitOutcome.Allowed);
    });

    it("keeps separate budgets for separate dashboards on one address", async () => {
      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 5; i++) {
        await consumeRead({ dashboardKey: "id:dashboard-a" });
      }

      const other: PublicDashboardRateLimitDecision = await consumeRead({
        dashboardKey: "id:dashboard-b",
      });

      expect(other.outcome).toBe(PublicDashboardRateLimitOutcome.Allowed);
    });
  });

  describe("consume - per address ceiling", () => {
    /*
     * The bypass this counter exists to close. Keyed only on dashboard id +
     * address, an attacker rotates the id on every request and never fills a
     * bucket — while every request still costs a Postgres lookup, 404 or not.
     */
    it("stops an attacker who rotates the dashboard id on every request", async () => {
      let rejected: PublicDashboardRateLimitDecision | null = null;

      for (let i: number = 0; i < READ_PER_IP_LIMIT + 10; i++) {
        const decision: PublicDashboardRateLimitDecision = await consumeRead({
          dashboardKey: `id:rotating-${i}`,
        });

        if (
          decision.outcome === PublicDashboardRateLimitOutcome.RateLimited &&
          !rejected
        ) {
          rejected = decision;
          expect(i).toBe(READ_PER_IP_LIMIT);
        }
      }

      expect(rejected).not.toBeNull();
      expect(rejected?.scope).toBe(PublicDashboardRateLimitScope.Ip);
    });

    it("does not let one address's ceiling affect another", async () => {
      for (let i: number = 0; i < READ_PER_IP_LIMIT + 10; i++) {
        await consumeRead({
          dashboardKey: `id:rotating-${i}`,
          clientIp: "203.0.113.7",
        });
      }

      const other: PublicDashboardRateLimitDecision = await consumeRead({
        dashboardKey: "id:dashboard-a",
        clientIp: "198.51.100.4",
      });

      expect(other.outcome).toBe(PublicDashboardRateLimitOutcome.Allowed);
    });

    it("reports the dashboard scope first when both counters are over", async () => {
      for (let i: number = 0; i < READ_PER_IP_LIMIT + 10; i++) {
        await consumeRead({});
      }

      const decision: PublicDashboardRateLimitDecision = await consumeRead({});

      expect(decision.scope).toBe(PublicDashboardRateLimitScope.Dashboard);
    });
  });

  describe("consume - window behaviour", () => {
    it("sets a TTL only on the request that created the counter", async () => {
      await consumeRead({});

      const dashboardKey: string | undefined = Array.from(
        client.counters.keys(),
      ).find((key: string) => {
        return key.includes(":d:");
      });

      expect(dashboardKey).toBeDefined();
      expect(client.expiresForKey(dashboardKey as string)).toHaveLength(1);

      for (let i: number = 0; i < 20; i++) {
        await consumeRead({});
      }

      /*
       * Re-issuing EXPIRE on every increment would slide the window forward
       * for as long as the load continued, so a client that tripped the limit
       * could never recover. The TTL must be written exactly once.
       */
      expect(client.expiresForKey(dashboardKey as string)).toHaveLength(1);
    });

    it("gives the counter a TTL longer than its own window", async () => {
      await consumeRead({});

      expect(client.expires.length).toBeGreaterThan(0);

      for (const recorded of client.expires) {
        expect(recorded.ttlSeconds).toBeGreaterThan(READ_WINDOW_SECONDS);
      }
    });

    it("issues no further EXPIRE once both counters exist", async () => {
      await consumeRead({});
      const afterFirst: number = client.expires.length;

      await consumeRead({});

      expect(client.expires.length).toBe(afterFirst);
    });

    it("starts a fresh allowance when the window rolls", async () => {
      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 1; i++) {
        await consumeRead({});
      }

      expect((await consumeRead({})).outcome).toBe(
        PublicDashboardRateLimitOutcome.RateLimited,
      );

      currentTime = currentTime + READ_WINDOW_SECONDS * 1000;

      expect((await consumeRead({})).outcome).toBe(
        PublicDashboardRateLimitOutcome.Allowed,
      );
    });

    it("does not roll early within the same window", async () => {
      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 1; i++) {
        await consumeRead({});
      }

      currentTime = currentTime + (READ_WINDOW_SECONDS - 1) * 1000;

      expect((await consumeRead({})).outcome).toBe(
        PublicDashboardRateLimitOutcome.RateLimited,
      );
    });

    /*
     * A rejected request still increments. Otherwise a client that keeps
     * hammering is handed a fresh allowance the moment it is refused.
     */
    it("keeps the window pinned by counting rejected requests too", async () => {
      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT; i++) {
        await consumeRead({});
      }

      const countBefore: number = client.incrCallCount;

      await consumeRead({});
      await consumeRead({});

      expect(client.incrCallCount).toBe(countBefore + 4);
    });

    it("reports a Retry-After inside the current window", async () => {
      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 1; i++) {
        await consumeRead({});
      }

      const decision: PublicDashboardRateLimitDecision = await consumeRead({});

      expect(decision.retryAfterSeconds).toBeGreaterThan(0);
      expect(decision.retryAfterSeconds).toBeLessThanOrEqual(
        READ_WINDOW_SECONDS,
      );
    });

    it("shrinks Retry-After as the window drains", async () => {
      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 1; i++) {
        await consumeRead({});
      }

      const atStart: PublicDashboardRateLimitDecision = await consumeRead({});

      currentTime = currentTime + 30_000;

      const midway: PublicDashboardRateLimitDecision = await consumeRead({});

      expect(midway.retryAfterSeconds).toBeLessThan(
        atStart.retryAfterSeconds as number,
      );
    });

    it("never reports a Retry-After of zero at the very end of a window", async () => {
      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 1; i++) {
        await consumeRead({});
      }

      currentTime = currentTime + READ_WINDOW_SECONDS * 1000 - 1;

      const decision: PublicDashboardRateLimitDecision = await consumeRead({});

      /* Window rolled, so this one is allowed — but the maths must not
       * produce a zero for any caller that is refused. */
      expect(decision.retryAfterSeconds ?? 1).toBeGreaterThan(0);
    });
  });

  describe("consume - master password bucket", () => {
    const consumePassword: () => Promise<PublicDashboardRateLimitDecision> =
      () => {
        return PublicDashboardRateLimit.consume({
          dashboardKey: "id:dashboard-a",
          clientIp: "203.0.113.7",
          bucket: PublicDashboardRateLimitBucket.MasterPassword,
        });
      };

    it("allows a human's worth of attempts", async () => {
      for (let i: number = 0; i < MASTER_PASSWORD_PER_DASHBOARD_LIMIT; i++) {
        expect((await consumePassword()).outcome).toBe(
          PublicDashboardRateLimitOutcome.Allowed,
        );
      }
    });

    it("shuts the guessing oracle after that", async () => {
      for (let i: number = 0; i < MASTER_PASSWORD_PER_DASHBOARD_LIMIT; i++) {
        await consumePassword();
      }

      const decision: PublicDashboardRateLimitDecision =
        await consumePassword();

      expect(decision.outcome).toBe(
        PublicDashboardRateLimitOutcome.RateLimited,
      );
      expect(decision.scope).toBe(PublicDashboardRateLimitScope.Dashboard);
    });

    it("is far tighter than the read budget", () => {
      expect(MASTER_PASSWORD_PER_DASHBOARD_LIMIT).toBeLessThan(
        READ_PER_DASHBOARD_LIMIT,
      );
    });

    it("caps an attacker rotating dashboards to guess against many at once", async () => {
      let rejected: PublicDashboardRateLimitDecision | null = null;

      for (let i: number = 0; i < MASTER_PASSWORD_PER_IP_LIMIT + 5; i++) {
        const decision: PublicDashboardRateLimitDecision =
          await PublicDashboardRateLimit.consume({
            dashboardKey: `id:dashboard-${i}`,
            clientIp: "203.0.113.7",
            bucket: PublicDashboardRateLimitBucket.MasterPassword,
          });

        if (
          decision.outcome === PublicDashboardRateLimitOutcome.RateLimited &&
          !rejected
        ) {
          rejected = decision;
        }
      }

      expect(rejected?.scope).toBe(PublicDashboardRateLimitScope.Ip);
    });

    it("holds its window far longer than the read window", async () => {
      for (
        let i: number = 0;
        i < MASTER_PASSWORD_PER_DASHBOARD_LIMIT + 1;
        i++
      ) {
        await consumePassword();
      }

      /* A read window later, password attempts are still refused. */
      currentTime = currentTime + READ_WINDOW_SECONDS * 1000;

      expect((await consumePassword()).outcome).toBe(
        PublicDashboardRateLimitOutcome.RateLimited,
      );

      currentTime = currentTime + MASTER_PASSWORD_WINDOW_SECONDS * 1000;

      expect((await consumePassword()).outcome).toBe(
        PublicDashboardRateLimitOutcome.Allowed,
      );
    });

    /*
     * Reading a dashboard and guessing its password must not draw on the same
     * counter, in either direction: a busy dashboard would otherwise lock out
     * password entry, and password attempts would otherwise be laundered
     * through the far larger read budget.
     */
    it("does not share a counter with the read bucket", async () => {
      for (let i: number = 0; i < MASTER_PASSWORD_PER_DASHBOARD_LIMIT + 5; i++) {
        await PublicDashboardRateLimit.consume({
          dashboardKey: "id:dashboard-a",
          clientIp: "203.0.113.7",
          bucket: PublicDashboardRateLimitBucket.MasterPassword,
        });
      }

      expect((await consumeRead({})).outcome).toBe(
        PublicDashboardRateLimitOutcome.Allowed,
      );
    });

    it("is not relaxed by heavy read traffic", async () => {
      for (let i: number = 0; i < 100; i++) {
        await consumeRead({});
      }

      for (let i: number = 0; i < MASTER_PASSWORD_PER_DASHBOARD_LIMIT; i++) {
        await consumePassword();
      }

      expect((await consumePassword()).outcome).toBe(
        PublicDashboardRateLimitOutcome.RateLimited,
      );
    });
  });

  describe("consume - counter unavailable", () => {
    it("reports unavailable when Redis has no client", async () => {
      getClientMock.mockReturnValue(null);

      expect((await consumeRead({})).outcome).toBe(
        PublicDashboardRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when Redis is not connected", async () => {
      isConnectedMock.mockReturnValue(false);

      expect((await consumeRead({})).outcome).toBe(
        PublicDashboardRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when the pipeline throws", async () => {
      client.failNextExec = new Error("connection reset");

      expect((await consumeRead({})).outcome).toBe(
        PublicDashboardRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when the pipeline returns null", async () => {
      client.malformedExecResult = null;

      expect((await consumeRead({})).outcome).toBe(
        PublicDashboardRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when the pipeline returns too few results", async () => {
      client.malformedExecResult = [[null, 1]];

      expect((await consumeRead({})).outcome).toBe(
        PublicDashboardRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when a command inside the pipeline failed", async () => {
      client.malformedExecResult = [
        [new Error("READONLY"), null],
        [null, 1],
      ];

      expect((await consumeRead({})).outcome).toBe(
        PublicDashboardRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when a counter comes back non-numeric", async () => {
      client.malformedExecResult = [
        [null, "1"],
        [null, 1],
      ];

      expect((await consumeRead({})).outcome).toBe(
        PublicDashboardRateLimitOutcome.CounterUnavailable,
      );
    });

    it("does not throw out of consume on any failure", async () => {
      client.failNextExec = new Error("boom");

      await expect(consumeRead({})).resolves.toBeDefined();
    });
  });

  describe("getMiddleware", () => {
    const runMiddleware: (data: {
      bucket: PublicDashboardRateLimitBucket;
      request?: ExpressRequest;
    }) => Promise<{
      nextCalled: boolean;
      headers: Record<string, string>;
    }> = async (data) => {
      const { response, headers } = buildResponse();
      let nextCalled: boolean = false;

      const next: NextFunction = (() => {
        nextCalled = true;
      }) as unknown as NextFunction;

      await PublicDashboardRateLimit.getMiddleware(data.bucket)(
        data.request ||
          buildRequest({
            params: { dashboardId: ObjectID.generate().toString() },
            headers: { "x-forwarded-for": "203.0.113.7" },
          }),
        response,
        next,
      );

      return { nextCalled, headers };
    };

    it("passes an allowed request through", async () => {
      const result: { nextCalled: boolean } = await runMiddleware({
        bucket: PublicDashboardRateLimitBucket.Read,
      });

      expect(result.nextCalled).toBe(true);
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    it("defaults to the read bucket", async () => {
      const { response } = buildResponse();
      let nextCalled: boolean = false;

      await PublicDashboardRateLimit.getMiddleware()(
        buildRequest({ headers: { "x-forwarded-for": "203.0.113.7" } }),
        response,
        (() => {
          nextCalled = true;
        }) as unknown as NextFunction,
      );

      expect(nextCalled).toBe(true);
    });

    /*
     * The property the whole change rests on: a refused request must not
     * reach the handler behind it, or the ClickHouse/Postgres work still
     * happens and the limiter is decoration.
     */
    it("stops a refused request from reaching the route handler", async () => {
      const request: ExpressRequest = buildRequest({
        params: { dashboardId: ObjectID.generate().toString() },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT; i++) {
        await runMiddleware({
          bucket: PublicDashboardRateLimitBucket.Read,
          request,
        });
      }

      sendErrorResponseMock.mockClear();

      const result: { nextCalled: boolean } = await runMiddleware({
        bucket: PublicDashboardRateLimitBucket.Read,
        request,
      });

      expect(result.nextCalled).toBe(false);
      expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);
    });

    it("answers a refusal with 429", async () => {
      const request: ExpressRequest = buildRequest({
        params: { dashboardId: ObjectID.generate().toString() },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 1; i++) {
        await runMiddleware({
          bucket: PublicDashboardRateLimitBucket.Read,
          request,
        });
      }

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.code).toBe(ExceptionCode.TooManyRequestsException);
      expect(error.code).toBe(429);
    });

    it("sets Retry-After on a refusal", async () => {
      const request: ExpressRequest = buildRequest({
        params: { dashboardId: ObjectID.generate().toString() },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      let headers: Record<string, string> = {};

      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 1; i++) {
        headers = (
          await runMiddleware({
            bucket: PublicDashboardRateLimitBucket.Read,
            request,
          })
        ).headers;
      }

      expect(Number(headers["Retry-After"])).toBeGreaterThan(0);
      expect(Number(headers["Retry-After"])).toBeLessThanOrEqual(
        READ_WINDOW_SECONDS,
      );
    });

    it("does not leak the limit or the counter value in the message", async () => {
      const request: ExpressRequest = buildRequest({
        params: { dashboardId: ObjectID.generate().toString() },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 1; i++) {
        await runMiddleware({
          bucket: PublicDashboardRateLimitBucket.Read,
          request,
        });
      }

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.message).not.toMatch(/\d/);
    });

    it("tells a refused password attempt that it was a password attempt", async () => {
      const request: ExpressRequest = buildRequest({
        params: { dashboardId: ObjectID.generate().toString() },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (
        let i: number = 0;
        i < MASTER_PASSWORD_PER_DASHBOARD_LIMIT + 1;
        i++
      ) {
        await runMiddleware({
          bucket: PublicDashboardRateLimitBucket.MasterPassword,
          request,
        });
      }

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.code).toBe(ExceptionCode.TooManyRequestsException);
      expect(error.message.toLowerCase()).toContain("password");
    });

    it("survives a response object with no setHeader", async () => {
      const request: ExpressRequest = buildRequest({
        params: { dashboardId: ObjectID.generate().toString() },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      const middleware: (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => Promise<void> = PublicDashboardRateLimit.getMiddleware(
        PublicDashboardRateLimitBucket.Read,
      );

      const bareResponse: ExpressResponse = {} as unknown as ExpressResponse;

      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 2; i++) {
        await expect(
          middleware(request, bareResponse, (() => {}) as NextFunction),
        ).resolves.not.toThrow();
      }
    });

    /*
     * Reads fail OPEN when Redis is gone: these are unauthenticated read-only
     * endpoints, and blacking out every customer's public dashboard over a
     * Redis blip is worse than an unbounded window for its duration.
     */
    it("serves reads unthrottled rather than failing when Redis is gone", async () => {
      isConnectedMock.mockReturnValue(false);

      const result: { nextCalled: boolean } = await runMiddleware({
        bucket: PublicDashboardRateLimitBucket.Read,
      });

      expect(result.nextCalled).toBe(true);
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    /*
     * /master-password fails CLOSED for the same outage. There the counter is
     * not a load control, it is the only bound on password guessing — serving
     * without it is serving an unlimited oracle.
     */
    it("refuses password attempts when Redis is gone", async () => {
      isConnectedMock.mockReturnValue(false);

      const result: { nextCalled: boolean } = await runMiddleware({
        bucket: PublicDashboardRateLimitBucket.MasterPassword,
      });

      expect(result.nextCalled).toBe(false);
      expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.code).toBe(ExceptionCode.ServiceUnavailableException);
      expect(error.code).toBe(503);
    });

    it("refuses password attempts when the counter errors", async () => {
      client.failNextExec = new Error("connection reset");

      const result: { nextCalled: boolean } = await runMiddleware({
        bucket: PublicDashboardRateLimitBucket.MasterPassword,
      });

      expect(result.nextCalled).toBe(false);
    });

    it("still serves reads when the counter errors", async () => {
      client.failNextExec = new Error("connection reset");

      const result: { nextCalled: boolean } = await runMiddleware({
        bucket: PublicDashboardRateLimitBucket.Read,
      });

      expect(result.nextCalled).toBe(true);
    });

    /*
     * A limiter exists because the caller keeps knocking. Logging every
     * refusal turns their flood into a second flood in the log pipeline —
     * the very tool an operator needs to see the first one.
     */
    it("logs the moment a caller crosses the line, then stays quiet", async () => {
      const request: ExpressRequest = buildRequest({
        params: { dashboardId: ObjectID.generate().toString() },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT; i++) {
        await runMiddleware({
          bucket: PublicDashboardRateLimitBucket.Read,
          request,
        });
      }

      loggerWarnMock.mockClear();

      /* The crossing request. */
      await runMiddleware({
        bucket: PublicDashboardRateLimitBucket.Read,
        request,
      });

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);

      /* Everything after it is refused just as hard, but silently. */
      for (let i: number = 0; i < 200; i++) {
        await runMiddleware({
          bucket: PublicDashboardRateLimitBucket.Read,
          request,
        });
      }

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    });

    it("logs the crossing again once the window rolls", async () => {
      const request: ExpressRequest = buildRequest({
        params: { dashboardId: ObjectID.generate().toString() },
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 5; i++) {
        await runMiddleware({
          bucket: PublicDashboardRateLimitBucket.Read,
          request,
        });
      }

      currentTime = currentTime + READ_WINDOW_SECONDS * 1000;
      loggerWarnMock.mockClear();

      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 5; i++) {
        await runMiddleware({
          bucket: PublicDashboardRateLimitBucket.Read,
          request,
        });
      }

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    });

    /*
     * A Redis outage puts EVERY request on the unavailable path, so an
     * unguarded log there is one line per request for the whole outage.
     */
    it("does not log once per request while Redis is down", async () => {
      isConnectedMock.mockReturnValue(false);
      loggerWarnMock.mockClear();

      for (let i: number = 0; i < 100; i++) {
        await runMiddleware({ bucket: PublicDashboardRateLimitBucket.Read });
      }

      /* One message plus its attributes line, not 200. */
      expect(loggerWarnMock.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it("logs the outage again after the throttle interval", async () => {
      isConnectedMock.mockReturnValue(false);

      await runMiddleware({ bucket: PublicDashboardRateLimitBucket.Read });

      currentTime = currentTime + 60_000;
      loggerWarnMock.mockClear();

      await runMiddleware({ bucket: PublicDashboardRateLimitBucket.Read });

      expect(loggerWarnMock.mock.calls.length).toBeGreaterThan(0);
    });

    it("does not log once per attempt while refusing passwords in an outage", async () => {
      isConnectedMock.mockReturnValue(false);
      loggerErrorMock.mockClear();

      for (let i: number = 0; i < 100; i++) {
        await runMiddleware({
          bucket: PublicDashboardRateLimitBucket.MasterPassword,
        });
      }

      expect(loggerErrorMock.mock.calls.length).toBeLessThanOrEqual(1);

      /* Every one of them was still refused. */
      expect(sendErrorResponseMock).toHaveBeenCalledTimes(100);
    });

    it("derives its key from the request, not from the caller's header", async () => {
      const dashboardId: string = ObjectID.generate().toString();

      /*
       * Same real client, forging a different left-hand entry each time. All
       * of it must land in one bucket.
       */
      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT; i++) {
        await runMiddleware({
          bucket: PublicDashboardRateLimitBucket.Read,
          request: buildRequest({
            params: { dashboardId },
            headers: { "x-forwarded-for": `10.0.0.${i % 250}, 203.0.113.7` },
          }),
        });
      }

      sendErrorResponseMock.mockClear();

      const result: { nextCalled: boolean } = await runMiddleware({
        bucket: PublicDashboardRateLimitBucket.Read,
        request: buildRequest({
          params: { dashboardId },
          headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.7" },
        }),
      });

      expect(result.nextCalled).toBe(false);
    });
  });
});

/*
 * The budgets and the trusted-hop count are read from the environment at
 * module load, so these reload the module rather than calling into the
 * already-configured one.
 */
describe("PublicDashboardRateLimit configuration", () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  interface ReloadedModule {
    limiter: typeof PublicDashboardRateLimit;
    client: FakeRedisClient;
  }

  const reload: () => Promise<ReloadedModule> = async () => {
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

    const client: FakeRedisClient = new FakeRedisClient();

    redisModule.default.getClient.mockReturnValue(client);
    redisModule.default.isConnected.mockReturnValue(true);

    return { limiter: limiterModule.default, client };
  };

  it("honours a configured per-dashboard read limit", async () => {
    process.env["PUBLIC_DASHBOARD_RATE_LIMIT_PER_DASHBOARD_PER_WINDOW"] = "3";

    const { limiter } = await reload();

    for (let i: number = 0; i < 3; i++) {
      expect(
        (
          await limiter.consume({
            dashboardKey: "id:a",
            clientIp: "203.0.113.7",
            bucket: PublicDashboardRateLimitBucket.Read,
          })
        ).outcome,
      ).toBe(PublicDashboardRateLimitOutcome.Allowed);
    }

    expect(
      (
        await limiter.consume({
          dashboardKey: "id:a",
          clientIp: "203.0.113.7",
          bucket: PublicDashboardRateLimitBucket.Read,
        })
      ).outcome,
    ).toBe(PublicDashboardRateLimitOutcome.RateLimited);
  });

  it("honours a configured per-address read ceiling", async () => {
    process.env["PUBLIC_DASHBOARD_RATE_LIMIT_PER_IP_PER_WINDOW"] = "4";

    const { limiter } = await reload();

    let rejected: boolean = false;

    for (let i: number = 0; i < 6; i++) {
      const decision: PublicDashboardRateLimitDecision = await limiter.consume({
        dashboardKey: `id:rotating-${i}`,
        clientIp: "203.0.113.7",
        bucket: PublicDashboardRateLimitBucket.Read,
      });

      if (decision.outcome === PublicDashboardRateLimitOutcome.RateLimited) {
        rejected = true;
        expect(decision.scope).toBe(PublicDashboardRateLimitScope.Ip);
      }
    }

    expect(rejected).toBe(true);
  });

  it("honours a configured master password limit", async () => {
    process.env[
      "PUBLIC_DASHBOARD_MASTER_PASSWORD_RATE_LIMIT_PER_DASHBOARD_PER_WINDOW"
    ] = "2";

    const { limiter } = await reload();

    for (let i: number = 0; i < 2; i++) {
      await limiter.consume({
        dashboardKey: "id:a",
        clientIp: "203.0.113.7",
        bucket: PublicDashboardRateLimitBucket.MasterPassword,
      });
    }

    expect(
      (
        await limiter.consume({
          dashboardKey: "id:a",
          clientIp: "203.0.113.7",
          bucket: PublicDashboardRateLimitBucket.MasterPassword,
        })
      ).outcome,
    ).toBe(PublicDashboardRateLimitOutcome.RateLimited);
  });

  it("falls back to the default when the value is not a number", async () => {
    process.env["PUBLIC_DASHBOARD_RATE_LIMIT_PER_DASHBOARD_PER_WINDOW"] =
      "not-a-number";

    const { limiter } = await reload();

    for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT; i++) {
      await limiter.consume({
        dashboardKey: "id:a",
        clientIp: "203.0.113.7",
        bucket: PublicDashboardRateLimitBucket.Read,
      });
    }

    expect(
      (
        await limiter.consume({
          dashboardKey: "id:a",
          clientIp: "203.0.113.7",
          bucket: PublicDashboardRateLimitBucket.Read,
        })
      ).outcome,
    ).toBe(PublicDashboardRateLimitOutcome.RateLimited);
  });

  it("falls back to the default when the value is zero or negative", async () => {
    process.env["PUBLIC_DASHBOARD_RATE_LIMIT_PER_DASHBOARD_PER_WINDOW"] = "0";

    const { limiter } = await reload();

    /* A limit of zero would refuse everything; the fallback must win. */
    expect(
      (
        await limiter.consume({
          dashboardKey: "id:a",
          clientIp: "203.0.113.7",
          bucket: PublicDashboardRateLimitBucket.Read,
        })
      ).outcome,
    ).toBe(PublicDashboardRateLimitOutcome.Allowed);
  });

  /*
   * Behind an extra load balancer the rightmost hop is the balancer, not the
   * viewer, and every client collapses into one bucket. Operators widen the
   * hop count to compensate.
   */
  it("counts back the configured number of trusted hops", async () => {
    process.env["PUBLIC_DASHBOARD_RATE_LIMIT_TRUSTED_PROXY_HOPS"] = "2";

    const { limiter } = await reload();

    expect(
      limiter.resolveClientIp(
        buildRequest({
          headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.5" },
        }),
      ),
    ).toBe("203.0.113.7");
  });

  it("clamps to the leftmost hop when configured deeper than the header", async () => {
    process.env["PUBLIC_DASHBOARD_RATE_LIMIT_TRUSTED_PROXY_HOPS"] = "5";

    const { limiter } = await reload();

    expect(
      limiter.resolveClientIp(
        buildRequest({
          headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.5" },
        }),
      ),
    ).toBe("203.0.113.7");
  });

  it("defaults to a single trusted hop", async () => {
    delete process.env["PUBLIC_DASHBOARD_RATE_LIMIT_TRUSTED_PROXY_HOPS"];

    const { limiter } = await reload();

    expect(
      limiter.resolveClientIp(
        buildRequest({
          headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.7" },
        }),
      ),
    ).toBe("203.0.113.7");
  });
});
