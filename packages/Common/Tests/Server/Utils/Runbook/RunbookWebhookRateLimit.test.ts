import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The two counters in front of a runbook's webhook URL: every call counts
 * against the caller's address, and a call about to start a run counts
 * against the runbook. Each really counts in a fixed one-minute window,
 * says when to try again, logs a flood once, and FAILS CLOSED when Redis
 * cannot count - a webhook starts scripts on Runners, and the run queue
 * lives in Redis too.
 */

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
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

import Redis from "../../../../Server/Infrastructure/Redis";
import RunbookWebhookRateLimit, {
  RUNBOOK_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS,
  RunbookWebhookRateLimitDecision,
  RunbookWebhookRateLimitOutcome,
} from "../../../../Server/Utils/Runbook/RunbookWebhookRateLimit";
import { ExpressRequest } from "../../../../Server/Utils/Express";
import ObjectID from "../../../../Types/ObjectID";
import {
  RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE,
  RUNBOOK_WEBHOOK_RUNS_PER_MINUTE,
} from "../../../../Types/Runbook/RunbookWebhook";

type MockedFn = ReturnType<typeof jest.fn>;

const RUNBOOK_A: ObjectID = new ObjectID(
  "aaaaaaaa-1111-4111-8111-111111111111",
);
const RUNBOOK_B: ObjectID = new ObjectID(
  "bbbbbbbb-2222-4222-8222-222222222222",
);

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

  // As Redis answers GET: the count as a string, or null for no key.
  public async get(key: string): Promise<string | null> {
    const count: number | undefined = this.counters.get(key);

    return count === undefined ? null : String(count);
  }

  /*
   * The limiter counts through pipelines (ClientRateLimitCounter): each
   * command runs through the methods above, and the answer is ioredis's,
   * [error, value] per command.
   */
  public pipeline(): FakePipeline {
    return new FakePipeline(this);
  }
}

class FakePipeline {
  private commands: Array<() => Promise<unknown>> = [];

  public constructor(private client: FakeRedisClient) {}

  public incr(key: string): FakePipeline {
    this.commands.push((): Promise<unknown> => {
      return this.client.incr(key);
    });
    return this;
  }

  public expire(key: string, ttlSeconds: number): FakePipeline {
    this.commands.push((): Promise<unknown> => {
      return this.client.expire(key, ttlSeconds);
    });
    return this;
  }

  public get(key: string): FakePipeline {
    this.commands.push((): Promise<unknown> => {
      return this.client.get(key);
    });
    return this;
  }

  public async exec(): Promise<Array<[Error | null, unknown]>> {
    const results: Array<[Error | null, unknown]> = [];

    for (const command of this.commands) {
      try {
        results.push([null, await command()]);
      } catch (error) {
        results.push([error as Error, null]);
      }
    }

    return results;
  }
}

let client: FakeRedisClient;
let now: number;

function requestFrom(address: string): ExpressRequest {
  return {
    headers: {},
    socket: { remoteAddress: address },
    ip: address,
  } as unknown as ExpressRequest;
}

beforeEach(() => {
  // 10:07:30: thirty seconds into a window.
  now = Date.UTC(2026, 9, 15, 10, 7, 30);
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });

  client = new FakeRedisClient();
  (Redis.getClient as unknown as MockedFn).mockReturnValue(client);
  (Redis.isConnected as unknown as MockedFn).mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("per runbook", () => {
  it("lets the minute's runs through, then refuses the rest of the window with when to try again", async () => {
    for (let i: number = 0; i < RUNBOOK_WEBHOOK_RUNS_PER_MINUTE; i++) {
      expect(
        (await RunbookWebhookRateLimit.consumeForRunbook(RUNBOOK_A)).outcome,
      ).toBe(RunbookWebhookRateLimitOutcome.Allowed);
    }

    const first: RunbookWebhookRateLimitDecision =
      await RunbookWebhookRateLimit.consumeForRunbook(RUNBOOK_A);
    const second: RunbookWebhookRateLimitDecision =
      await RunbookWebhookRateLimit.consumeForRunbook(RUNBOOK_A);

    expect(first).toEqual({
      outcome: RunbookWebhookRateLimitOutcome.RateLimited,
      retryAfterSeconds: 30,
      isFirstRejectionInWindow: true,
    });
    expect(second.outcome).toBe(RunbookWebhookRateLimitOutcome.RateLimited);
    expect(second.isFirstRejectionInWindow).toBe(false);
  });

  it("counts each runbook on its own", async () => {
    for (let i: number = 0; i < RUNBOOK_WEBHOOK_RUNS_PER_MINUTE + 5; i++) {
      await RunbookWebhookRateLimit.consumeForRunbook(RUNBOOK_A);
    }

    expect(
      (await RunbookWebhookRateLimit.consumeForRunbook(RUNBOOK_B)).outcome,
    ).toBe(RunbookWebhookRateLimitOutcome.Allowed);
  });

  it("starts afresh in the next window", async () => {
    for (let i: number = 0; i < RUNBOOK_WEBHOOK_RUNS_PER_MINUTE + 1; i++) {
      await RunbookWebhookRateLimit.consumeForRunbook(RUNBOOK_A);
    }

    now += RUNBOOK_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS * 1000;

    expect(
      (await RunbookWebhookRateLimit.consumeForRunbook(RUNBOOK_A)).outcome,
    ).toBe(RunbookWebhookRateLimitOutcome.Allowed);
  });

  it("sets a key's expiry once, two windows long, so calls cannot slide it", async () => {
    await RunbookWebhookRateLimit.consumeForRunbook(RUNBOOK_A);
    await RunbookWebhookRateLimit.consumeForRunbook(RUNBOOK_A);

    expect([...client.expires.values()]).toEqual([
      RUNBOOK_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS * 2,
    ]);
    expect([...client.counters.keys()][0]).toContain(
      `r:${RUNBOOK_A.toString()}`,
    );
  });
});

describe("per address", () => {
  it("counts every call from one address, whichever runbook it names", async () => {
    for (
      let i: number = 0;
      i < RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE;
      i++
    ) {
      expect(
        (
          await RunbookWebhookRateLimit.consumeForAddress(
            requestFrom("203.0.113.7"),
          )
        ).outcome,
      ).toBe(RunbookWebhookRateLimitOutcome.Allowed);
    }

    expect(
      (
        await RunbookWebhookRateLimit.consumeForAddress(
          requestFrom("203.0.113.7"),
        )
      ).outcome,
    ).toBe(RunbookWebhookRateLimitOutcome.RateLimited);

    // Another address has its own budget.
    expect(
      (
        await RunbookWebhookRateLimit.consumeForAddress(
          requestFrom("198.51.100.4"),
        )
      ).outcome,
    ).toBe(RunbookWebhookRateLimitOutcome.Allowed);
  });

  it("reads the address the way every rate limit does, and puts callers without one in one bucket", () => {
    expect(
      RunbookWebhookRateLimit.getAddressKey(requestFrom("203.0.113.7")),
    ).toBe("203.0.113.7");
    expect(
      RunbookWebhookRateLimit.getAddressKey(requestFrom("::ffff:203.0.113.7")),
    ).toBe("203.0.113.7");
    expect(
      RunbookWebhookRateLimit.getAddressKey(requestFrom("2001:DB8::1")),
    ).toBe("2001:db8::1");
    expect(
      RunbookWebhookRateLimit.getAddressKey({
        headers: {},
      } as unknown as ExpressRequest),
    ).toBe("unknown");
  });
});

describe("when Redis cannot count", () => {
  it("refuses: not connected", async () => {
    (Redis.isConnected as unknown as MockedFn).mockReturnValue(false);

    expect(
      (await RunbookWebhookRateLimit.consumeForRunbook(RUNBOOK_A)).outcome,
    ).toBe(RunbookWebhookRateLimitOutcome.CounterUnavailable);
    expect(
      (
        await RunbookWebhookRateLimit.consumeForAddress(
          requestFrom("203.0.113.7"),
        )
      ).outcome,
    ).toBe(RunbookWebhookRateLimitOutcome.CounterUnavailable);
  });

  it("refuses: no client", async () => {
    (Redis.getClient as unknown as MockedFn).mockReturnValue(null);

    expect(
      (await RunbookWebhookRateLimit.consumeForRunbook(RUNBOOK_A)).outcome,
    ).toBe(RunbookWebhookRateLimitOutcome.CounterUnavailable);
  });

  it("refuses: the counter fails", async () => {
    client.failIncr = new Error(
      "READONLY You can't write against a read only replica.",
    );

    expect(
      (await RunbookWebhookRateLimit.consumeForRunbook(RUNBOOK_A)).outcome,
    ).toBe(RunbookWebhookRateLimitOutcome.CounterUnavailable);
  });
});

describe("when to try again", () => {
  it("is the seconds left in the window, at least one", () => {
    const windowStart: number = Date.UTC(2026, 9, 15, 10, 7, 0);

    expect(RunbookWebhookRateLimit.getSecondsUntilWindowEnd(windowStart)).toBe(
      60,
    );
    expect(
      RunbookWebhookRateLimit.getSecondsUntilWindowEnd(windowStart + 59500),
    ).toBe(1);
    expect(
      RunbookWebhookRateLimit.getSecondsUntilWindowEnd(windowStart + 59999),
    ).toBe(1);
  });
});
