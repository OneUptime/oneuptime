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
