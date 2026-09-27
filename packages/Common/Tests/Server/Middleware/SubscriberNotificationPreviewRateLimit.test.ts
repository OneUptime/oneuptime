import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The limit in front of "Preview notification" (POST /preview on the
 * subscriber notification preview router). A preview sends nothing, but it
 * renders an email for every status page the caller can read, and any
 * audience role may call it. What matters is that it is per user, that it
 * really counts, that a caller who keeps trying stays refused for the
 * window, and that it FAILS OPEN when Redis is unreachable: a preview is not
 * worth taking away from everyone during a Redis outage.
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
import SubscriberNotificationPreviewRateLimit, {
  SubscriberNotificationPreviewRateLimitConfig,
  SubscriberNotificationPreviewRateLimitDecision,
  SubscriberNotificationPreviewRateLimitOutcome,
} from "../../../Server/Middleware/SubscriberNotificationPreviewRateLimit";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";

type MockedFn = ReturnType<typeof jest.fn>;

const USER_A: string = "1a2b3c4d-3333-4333-8333-333333333333";
const USER_B: string = "1a2b3c4d-4444-4444-8444-444444444444";

// A Redis counter store: INCR really increments, EXPIRE records the TTL.
class FakeRedisClient {
  public counters: Map<string, number> = new Map();
  public expires: Map<string, number> = new Map();
  public failIncr: Error | null = null;

  public async incr(key: string): Promise<number> {
    if (this.failIncr) {
      throw this.failIncr;
    }

    const next: number = (this.counters.get(key) || 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  public async expire(key: string, ttlSeconds: number): Promise<number> {
    this.expires.set(key, ttlSeconds);
    return 1;
  }
}

let client: FakeRedisClient;

function request(userId: string | undefined): ExpressRequest {
  return {
    userAuthorization: userId ? { userId: new ObjectID(userId) } : undefined,
    headers: {},
  } as unknown as ExpressRequest;
}

interface MiddlewareCall {
  nextCalled: boolean;
  error: unknown;
  retryAfter: string | undefined;
}

async function callMiddleware(
  userId: string | undefined,
): Promise<MiddlewareCall> {
  (Response.sendErrorResponse as unknown as MockedFn).mockClear();

  const headers: Record<string, string> = {};
  const res: ExpressResponse = {
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as ExpressResponse;
  const next: MockedFn = jest.fn();

  await SubscriberNotificationPreviewRateLimit.getMiddleware()(
    request(userId),
    res,
    next as unknown as NextFunction,
  );

  const errorCall: Array<unknown> | undefined = (
    Response.sendErrorResponse as unknown as MockedFn
  ).mock.calls[0];

  return {
    nextCalled: next.mock.calls.length > 0,
    error: errorCall ? errorCall[2] : undefined,
    retryAfter: headers["Retry-After"],
  };
}

beforeEach(() => {
  // Mid-window, so no test straddles two windows.
  jest
    .spyOn(Date, "now")
    .mockReturnValue(Date.UTC(2026, 8, 27, 10, 7, 30) as never);

  client = new FakeRedisClient();
  (Redis.getClient as unknown as MockedFn).mockReturnValue(client);
  (Redis.isConnected as unknown as MockedFn).mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("SubscriberNotificationPreviewRateLimit", () => {
  const config: SubscriberNotificationPreviewRateLimitConfig =
    SubscriberNotificationPreviewRateLimit.getConfig();

  it("allows sixty previews every ten minutes per user", () => {
    expect(config).toEqual({ windowSeconds: 10 * 60, perUserLimit: 60 });
  });

  it("lets a user preview up to the limit, then refuses with 429 and Retry-After", async () => {
    for (let i: number = 0; i < config.perUserLimit; i++) {
      const call: MiddlewareCall = await callMiddleware(USER_A);
      expect(call.nextCalled).toBe(true);
      expect(call.error).toBeUndefined();
    }

    const refused: MiddlewareCall = await callMiddleware(USER_A);

    expect(refused.nextCalled).toBe(false);
    expect(refused.error).toBeInstanceOf(TooManyRequestsException);
    expect(Number(refused.retryAfter)).toBeGreaterThan(0);
    expect(Number(refused.retryAfter)).toBeLessThanOrEqual(
      config.windowSeconds,
    );
  });

  it("counts per user: one user's previews do not use up another's", async () => {
    for (let i: number = 0; i <= config.perUserLimit; i++) {
      await callMiddleware(USER_A);
    }

    expect((await callMiddleware(USER_A)).nextCalled).toBe(false);
    expect((await callMiddleware(USER_B)).nextCalled).toBe(true);
  });

  it("keeps counting refused requests, so hammering does not earn a fresh allowance", async () => {
    for (let i: number = 0; i < config.perUserLimit + 5; i++) {
      await callMiddleware(USER_A);
    }

    const keys: Array<string> = Array.from(client.counters.keys());
    expect(keys).toHaveLength(1);
    expect(client.counters.get(keys[0]!)).toBe(config.perUserLimit + 5);
  });

  it("does not share its counter with the test email's", async () => {
    await callMiddleware(USER_A);

    const keys: Array<string> = Array.from(client.counters.keys());
    expect(keys[0]).toContain("subnotifpreview:");
    expect(keys[0]).not.toContain("subnotiftest:");
  });

  it("sets the expiry once, when the counter is created, outliving its window", async () => {
    await callMiddleware(USER_A);
    await callMiddleware(USER_A);

    const keys: Array<string> = Array.from(client.expires.keys());
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain(USER_A);
    expect(client.expires.get(keys[0]!)).toBe(config.windowSeconds * 2);
  });

  it("fails open when Redis is not connected: the preview is served", async () => {
    (Redis.isConnected as unknown as MockedFn).mockReturnValue(false);

    const call: MiddlewareCall = await callMiddleware(USER_A);

    expect(call.nextCalled).toBe(true);
    expect(call.error).toBeUndefined();
  });

  it("fails open when the counter errors", async () => {
    client.failIncr = new Error("READONLY");

    const decision: SubscriberNotificationPreviewRateLimitDecision =
      await SubscriberNotificationPreviewRateLimit.consume({
        userKey: USER_A,
      });

    expect(decision.outcome).toBe(
      SubscriberNotificationPreviewRateLimitOutcome.CounterUnavailable,
    );
    expect((await callMiddleware(USER_A)).nextCalled).toBe(true);
  });
});
