import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The Redis arithmetic behind the customer-facing monthly budget. The gate
 * tests mock the whole rate limiter, so without this file the INCRBY /
 * check-after / refund-on-refusal semantics exist only behind mocks — the
 * budget could be deleted from the limiter and every suite would stay
 * green.
 */

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
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

import Redis from "Common/Server/Infrastructure/Redis";
import SessionReplayRateLimiter, {
  SessionReplayLimitDecision,
  SessionReplayLimitOutcome,
} from "../../FeatureSet/Telemetry/Utils/SessionReplayRateLimiter";
import { SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY } from "../../FeatureSet/Telemetry/Config";
import SessionReplayUsage from "Common/Server/Utils/SessionReplay/SessionReplayUsage";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();

const ONE_GB: number = 1024 * 1024 * 1024;

interface FakeRedisClient {
  incrby: MockedFn;
  decrby: MockedFn;
  expire: MockedFn;
  get: MockedFn;
}

function buildClient(): FakeRedisClient {
  return {
    incrby: jest.fn(),
    decrby: jest.fn(),
    expire: jest.fn(),
    get: jest.fn(),
  };
}

describe("SessionReplayRateLimiter.consumeApplicationMonthlyBudget", () => {
  let client: FakeRedisClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = buildClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);
    client.expire.mockResolvedValue(1 as never);
    client.decrby.mockResolvedValue(0 as never);
  });

  test("the first chunk of the month creates the key with a TTL that outlives any month", async () => {
    client.incrby.mockResolvedValue(7000 as never);

    const decision: SessionReplayLimitDecision =
      await SessionReplayRateLimiter.consumeApplicationMonthlyBudget({
        projectId: PROJECT_ID,
        rumApplicationId: RUM_APPLICATION_ID,
        bytes: 7000,
        budgetBytes: ONE_GB,
      });

    expect(decision.outcome).toBe(SessionReplayLimitOutcome.Allowed);

    /* Keyed per application per UTC month, from the SHARED key builder. */
    const key: string = client.incrby.mock.calls[0]![0] as string;
    expect(key).toContain("replay:rate:bytes-month:");
    expect(key).toContain(PROJECT_ID.toString());
    expect(key).toContain(RUM_APPLICATION_ID.toString());

    expect(client.expire).toHaveBeenCalledTimes(1);
    const ttl: number = client.expire.mock.calls[0]![1] as number;
    /* A key created on day 1 must survive a 31-day month plus margin. */
    expect(ttl).toBeGreaterThanOrEqual(32 * 24 * 60 * 60);
  });

  test("a subsequent chunk does not re-arm the TTL", async () => {
    client.incrby.mockResolvedValue(14000 as never);

    await SessionReplayRateLimiter.consumeApplicationMonthlyBudget({
      projectId: PROJECT_ID,
      rumApplicationId: RUM_APPLICATION_ID,
      bytes: 7000,
      budgetBytes: ONE_GB,
    });

    expect(client.expire).not.toHaveBeenCalled();
  });

  test("the crossing chunk is still accepted; everything after is refused", async () => {
    /*
     * Deliberate check-after-increment: refusing mid-session leaves an
     * unplayable fragment, and the overshoot is bounded by one request.
     */
    client.incrby.mockResolvedValue(ONE_GB as never);

    const crossing: SessionReplayLimitDecision =
      await SessionReplayRateLimiter.consumeApplicationMonthlyBudget({
        projectId: PROJECT_ID,
        rumApplicationId: RUM_APPLICATION_ID,
        bytes: 7000,
        budgetBytes: ONE_GB,
      });

    expect(crossing.outcome).toBe(SessionReplayLimitOutcome.Allowed);

    client.incrby.mockResolvedValue((ONE_GB + 7000) as never);

    const over: SessionReplayLimitDecision =
      await SessionReplayRateLimiter.consumeApplicationMonthlyBudget({
        projectId: PROJECT_ID,
        rumApplicationId: RUM_APPLICATION_ID,
        bytes: 7000,
        budgetBytes: ONE_GB,
      });

    expect(over.outcome).toBe(SessionReplayLimitOutcome.BudgetExhausted);
  });

  test("refused bytes are refunded so the counter stays an honest usage figure", async () => {
    client.incrby.mockResolvedValue((ONE_GB + 7000) as never);

    await SessionReplayRateLimiter.consumeApplicationMonthlyBudget({
      projectId: PROJECT_ID,
      rumApplicationId: RUM_APPLICATION_ID,
      bytes: 7000,
      budgetBytes: ONE_GB,
    });

    /*
     * Unlike the daily counter (which resets in 24h), this one is read
     * back as "usage" by the Dashboard for up to 31 days — without the
     * refund, every post-exhaustion upload attempt inflates the figure
     * past both the budget and the bytes actually stored, and a mid-month
     * budget raise finds its headroom already eaten.
     */
    expect(client.decrby).toHaveBeenCalledTimes(1);
    expect(client.decrby.mock.calls[0]![1]).toBe(7000);
  });

  test("a failed refund still refuses the chunk rather than throwing", async () => {
    client.incrby.mockResolvedValue((ONE_GB + 7000) as never);
    client.decrby.mockRejectedValue(new Error("redis blip") as never);

    const decision: SessionReplayLimitDecision =
      await SessionReplayRateLimiter.consumeApplicationMonthlyBudget({
        projectId: PROJECT_ID,
        rumApplicationId: RUM_APPLICATION_ID,
        bytes: 7000,
        budgetBytes: ONE_GB,
      });

    expect(decision.outcome).toBe(SessionReplayLimitOutcome.BudgetExhausted);
  });

  test("fails CLOSED as retryable when Redis is unreachable", async () => {
    isConnectedMock.mockReturnValue(false);

    const decision: SessionReplayLimitDecision =
      await SessionReplayRateLimiter.consumeApplicationMonthlyBudget({
        projectId: PROJECT_ID,
        rumApplicationId: RUM_APPLICATION_ID,
        bytes: 7000,
        budgetBytes: ONE_GB,
      });

    expect(decision.outcome).toBe(SessionReplayLimitOutcome.CounterUnavailable);
  });

  test("fails CLOSED when the increment itself throws", async () => {
    client.incrby.mockRejectedValue(new Error("redis down") as never);

    const decision: SessionReplayLimitDecision =
      await SessionReplayRateLimiter.consumeApplicationMonthlyBudget({
        projectId: PROJECT_ID,
        rumApplicationId: RUM_APPLICATION_ID,
        bytes: 7000,
        budgetBytes: ONE_GB,
      });

    expect(decision.outcome).toBe(SessionReplayLimitOutcome.CounterUnavailable);
  });
});

/*
 * Exhaustion has to stay VISIBLE in the counter.
 *
 * Neither budget has a flag of its own: /config's budget pause and the
 * health card's budget states both decide "spent" by comparing this
 * counter with the same limit the gate enforces. A blanket refund on every
 * refusal put the counter back under the limit, so the gate refused every
 * chunk for the rest of the window while /config kept answering
 * enabled:true - the recorder went on loading, buffering and posting every
 * 15 seconds into a 204, which is exactly the waste the config signal
 * exists to end. The rule that satisfies both halves: keep the crossing
 * request charged, refund everything after it.
 */
describe("SessionReplayRateLimiter byte budgets stay observable after exhaustion", () => {
  let client: FakeRedisClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = buildClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);
    client.expire.mockResolvedValue(1 as never);
    client.decrby.mockResolvedValue(0 as never);
  });

  test("the daily request that crosses the limit leaves the counter AT OR OVER it", async () => {
    const limit: number = SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY;

    /* One byte over: this request is the one that exhausted the budget. */
    client.incrby.mockResolvedValue((limit + 1) as never);

    const decision: SessionReplayLimitDecision =
      await SessionReplayRateLimiter.consumeByteBudget({
        projectId: PROJECT_ID,
        bytes: 7000,
      });

    expect(decision.outcome).toBe(SessionReplayLimitOutcome.BudgetExhausted);
    /* No refund: refunding here would hide the exhaustion from /config. */
    expect(client.decrby).not.toHaveBeenCalled();
  });

  test("every daily refusal AFTER the crossing one is refunded, so usage stops growing", async () => {
    const limit: number = SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY;

    /* Already over before this request: previous = limit + 1. */
    client.incrby.mockResolvedValue((limit + 1 + 7000) as never);

    const decision: SessionReplayLimitDecision =
      await SessionReplayRateLimiter.consumeByteBudget({
        projectId: PROJECT_ID,
        bytes: 7000,
      });

    expect(decision.outcome).toBe(SessionReplayLimitOutcome.BudgetExhausted);
    expect(client.decrby).toHaveBeenCalledTimes(1);
    expect(client.decrby.mock.calls[0]![1]).toBe(7000);
  });

  test("the monthly request that crosses the ceiling is not refunded either", async () => {
    /* previous = ONE_GB - 1000, which is UNDER the budget: the crossing one. */
    client.incrby.mockResolvedValue((ONE_GB + 6000) as never);

    const decision: SessionReplayLimitDecision =
      await SessionReplayRateLimiter.consumeApplicationMonthlyBudget({
        projectId: PROJECT_ID,
        rumApplicationId: RUM_APPLICATION_ID,
        bytes: 7000,
        budgetBytes: ONE_GB,
      });

    expect(decision.outcome).toBe(SessionReplayLimitOutcome.BudgetExhausted);
    expect(client.decrby).not.toHaveBeenCalled();
  });

  test("refundByteBudget gives daily bytes back for a request some later gate refused", async () => {
    await SessionReplayRateLimiter.refundByteBudget({
      projectId: PROJECT_ID,
      bytes: 7000,
    });

    expect(client.decrby).toHaveBeenCalledTimes(1);
    expect(client.decrby.mock.calls[0]![0]).toContain("replay:rate:bytes:");
    expect(client.decrby.mock.calls[0]![1]).toBe(7000);
  });

  test("refundByteBudget is a no-op for zero bytes and when Redis is down", async () => {
    await SessionReplayRateLimiter.refundByteBudget({
      projectId: PROJECT_ID,
      bytes: 0,
    });

    isConnectedMock.mockReturnValue(false);

    await SessionReplayRateLimiter.refundByteBudget({
      projectId: PROJECT_ID,
      bytes: 7000,
    });

    expect(client.decrby).not.toHaveBeenCalled();
  });
});

/*
 * The invariant /config and the health card actually depend on, driven
 * through a real counter rather than through mocked return values: after
 * the budget is exhausted, SessionReplayUsage - the same shared key builder
 * both sides read - must still report usage AT OR OVER the limit, however
 * many refused requests follow. That is what makes resolveBudgetPause's
 * `usedToday >= dailyLimit` and isDailyBudgetSpent reachable at all.
 */
describe("an exhausted daily budget is still visible to the readers", () => {
  test("usage stays at or over the limit across a storm of refused requests", async () => {
    const counters: Map<string, number> = new Map<string, number>();

    const statefulClient: {
      incrby: (key: string, by: number) => Promise<number>;
      decrby: (key: string, by: number) => Promise<number>;
      expire: () => Promise<number>;
      get: (key: string) => Promise<string | null>;
    } = {
      incrby: (key: string, by: number): Promise<number> => {
        const next: number = (counters.get(key) || 0) + by;
        counters.set(key, next);
        return Promise.resolve(next);
      },
      decrby: (key: string, by: number): Promise<number> => {
        const next: number = (counters.get(key) || 0) - by;
        counters.set(key, next);
        return Promise.resolve(next);
      },
      expire: (): Promise<number> => {
        return Promise.resolve(1);
      },
      get: (key: string): Promise<string | null> => {
        const value: number | undefined = counters.get(key);
        return Promise.resolve(value === undefined ? null : String(value));
      },
    };

    getClientMock.mockReturnValue(statefulClient);
    isConnectedMock.mockReturnValue(true);

    const limit: number = SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY;
    /* Ten chunks is enough to cross any sane limit without a huge loop. */
    const chunkBytes: number = Math.ceil(limit / 10) + 1;

    let firstRefusalAt: number = -1;

    for (let attempt: number = 0; attempt < 40; attempt++) {
      const decision: SessionReplayLimitDecision =
        await SessionReplayRateLimiter.consumeByteBudget({
          projectId: PROJECT_ID,
          bytes: chunkBytes,
        });

      if (
        decision.outcome === SessionReplayLimitOutcome.BudgetExhausted &&
        firstRefusalAt < 0
      ) {
        firstRefusalAt = attempt;
      }
    }

    expect(firstRefusalAt).toBeGreaterThanOrEqual(0);

    const usedToday: number | null =
      await SessionReplayUsage.getProjectBytesUsedToday(PROJECT_ID);

    /* What resolveBudgetPause tests. It must hold, and keep holding. */
    expect(usedToday).not.toBeNull();
    expect(usedToday as number).toBeGreaterThanOrEqual(limit);

    /*
     * And it must not run away either: the refused requests after the
     * crossing one are refunded, so the figure rests within one chunk of
     * the limit rather than growing with every retry.
     */
    expect(usedToday as number).toBeLessThan(limit + chunkBytes);
  });
});
