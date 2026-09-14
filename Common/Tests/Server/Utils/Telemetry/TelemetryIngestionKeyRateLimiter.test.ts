import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The per-key ceiling that makes a Browser ingestion key safe to publish.
 *
 * A browser key lives in the page: anyone who views source has it. The origin
 * allowlist bounds WHO can replay a scraped key, but nothing except this
 * counter bounds HOW MUCH they can push once they satisfy it - and unbounded
 * write volume into a customer's project is poisoned dashboards, forged spans
 * and, on a metered plan, their bill.
 *
 * Four properties decide whether that ceiling is real, and each is a silent
 * failure if it regresses:
 *
 *   1. Off-by-one. The Nth request in a window of N must be ADMITTED; only
 *      N + 1 is refused. A limiter that refuses the Nth quietly sells every
 *      customer one request per minute less than the number on their key.
 *   2. EXPIRE is issued ONLY on the write that created the counter. Re-issued
 *      on every increment it slides the TTL forward for as long as the load
 *      continues, so a fixed window under sustained traffic NEVER resets - a
 *      key that tripped its limit once can never recover, which is exactly the
 *      state an attacker's loop produces. Pinned here on the mock call counts,
 *      because it is invisible from the return value.
 *   3. The counter keeps incrementing on REJECTED requests. Being refused must
 *      not hand the hammering client a fresh allowance.
 *   4. It FAILS OPEN. No Redis client, a disconnected Redis, or an INCR that
 *      throws all resolve to CounterUnavailable and never propagate - the
 *      caller admits the request. Failing closed would turn a Redis blip into
 *      permanent, unreplayable telemetry loss for every paying customer at the
 *      moment their dashboards are needed most.
 *
 * Date.now is pinned throughout so the minute bucket and the retry-after are
 * facts of the test rather than of whichever second of the real minute the
 * suite happened to run in. Redis is mocked at the module boundary: nothing
 * here touches a real Redis, a real Postgres or the network.
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
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import Redis from "../../../../Server/Infrastructure/Redis";
import logger from "../../../../Server/Utils/Logger";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitDecision,
  TelemetryIngestionKeyLimitOutcome,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import ObjectID from "../../../../Types/ObjectID";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const loggerErrorMock: MockedFn = logger.error as unknown as MockedFn;

/* Constants baked into the limiter, named once so a change is a deliberate edit here too. */
const RATE_KEY_PREFIX: string = "telemetry:ingestkey:rate:";
const RATE_TTL_SECONDS: number = 120;
const WINDOW_MS: number = 60000;

interface RecordedExpire {
  key: string;
  ttlSeconds: number;
}

/*
 * A fake that behaves like a Redis counter rather than a bag of assertions:
 * INCR really increments and EXPIRE really records a TTL, so the window and
 * pinning tests exercise the limiter's arithmetic instead of restating it.
 */
class FakeRedisClient {
  public counters: Map<string, number> = new Map();
  public incrKeys: Array<string> = [];
  public expires: Array<RecordedExpire> = [];

  /* Set to make the next incr() reject, for the fail-open tests. */
  public failNextIncr: Error | null = null;

  public async incr(key: string): Promise<number> {
    this.incrKeys.push(key);

    if (this.failNextIncr) {
      const error: Error = this.failNextIncr;
      this.failNextIncr = null;
      throw error;
    }

    const next: number = (this.counters.get(key) || 0) + 1;
    this.counters.set(key, next);

    return next;
  }

  public async expire(key: string, ttlSeconds: number): Promise<number> {
    this.expires.push({ key, ttlSeconds });

    return 1;
  }

  public expiresForKey(key: string): Array<RecordedExpire> {
    return this.expires.filter((recorded: RecordedExpire) => {
      return recorded.key === key;
    });
  }
}

describe("TelemetryIngestionKeyRateLimiter", () => {
  const KEY_ID: ObjectID = new ObjectID("11111111-1111-1111-1111-111111111111");
  const OTHER_KEY_ID: ObjectID = new ObjectID(
    "22222222-2222-2222-2222-222222222222",
  );

  let client: FakeRedisClient;
  let nowSpy: ReturnType<typeof jest.spyOn>;
  let currentTime: number;

  beforeEach(() => {
    jest.clearAllMocks();

    client = new FakeRedisClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);

    /*
     * Pinned to the exact start of a minute bucket so the bucket number and
     * the retry-after are deterministic. Tests that care about where in the
     * window they sit move it themselves.
     */
    currentTime = 1_700_000_000_000;
    currentTime = currentTime - (currentTime % WINDOW_MS);

    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
      return currentTime;
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  const consume: (data: {
    ingestionKeyId?: ObjectID;
    limitPerMinute?: number;
  }) => Promise<TelemetryIngestionKeyLimitDecision> = (data: {
    ingestionKeyId?: ObjectID;
    limitPerMinute?: number;
  }): Promise<TelemetryIngestionKeyLimitDecision> => {
    return TelemetryIngestionKeyRateLimiter.consume({
      ingestionKeyId: data.ingestionKeyId || KEY_ID,
      limitPerMinute:
        typeof data.limitPerMinute === "number" ? data.limitPerMinute : 10,
    });
  };

  const expectedKeyFor: (keyId: ObjectID, atMs: number) => string = (
    keyId: ObjectID,
    atMs: number,
  ): string => {
    return `${RATE_KEY_PREFIX}${keyId.toString()}:${Math.floor(
      atMs / WINDOW_MS,
    )}`;
  };

  describe("the allowance boundary", () => {
    test("admits a request under the limit and gives it no retry-after", async () => {
      const decision: TelemetryIngestionKeyLimitDecision = await consume({
        limitPerMinute: 10,
      });

      expect(decision.outcome).toBe(TelemetryIngestionKeyLimitOutcome.Allowed);
      expect(decision.retryAfterSeconds).toBeUndefined();
      expect(decision.isFirstRejectionInWindow).toBeUndefined();
    });

    /*
     * The off-by-one. A limit of N means N requests get through, so the Nth
     * must be Allowed.
     */
    test("admits the Nth request in a window of N", async () => {
      const limit: number = 5;
      const outcomes: Array<TelemetryIngestionKeyLimitOutcome> = [];

      for (let index: number = 0; index < limit; index++) {
        const decision: TelemetryIngestionKeyLimitDecision = await consume({
          limitPerMinute: limit,
        });

        outcomes.push(decision.outcome);
      }

      expect(outcomes).toEqual([
        TelemetryIngestionKeyLimitOutcome.Allowed,
        TelemetryIngestionKeyLimitOutcome.Allowed,
        TelemetryIngestionKeyLimitOutcome.Allowed,
        TelemetryIngestionKeyLimitOutcome.Allowed,
        TelemetryIngestionKeyLimitOutcome.Allowed,
      ]);
    });

    test("refuses the N+1th request in a window of N", async () => {
      const limit: number = 5;

      for (let index: number = 0; index < limit; index++) {
        await consume({ limitPerMinute: limit });
      }

      const decision: TelemetryIngestionKeyLimitDecision = await consume({
        limitPerMinute: limit,
      });

      expect(decision.outcome).toBe(
        TelemetryIngestionKeyLimitOutcome.RateLimited,
      );
    });

    /*
     * Sampled at several offsets into the window, including both edges, so a
     * constant that happens to fall in range cannot pass this.
     */
    test("tells a refused caller to come back within the minute, never sooner than a second", async () => {
      const windowStart: number =
        1_700_000_000_000 - (1_700_000_000_000 % WINDOW_MS);

      const offsetsIntoWindow: Array<number> = [
        0, 1, 999, 30_000, 59_000, 59_999,
      ];

      for (const offset of offsetsIntoWindow) {
        client = new FakeRedisClient();
        getClientMock.mockReturnValue(client);
        currentTime = windowStart + offset;

        await consume({ limitPerMinute: 1 });

        const decision: TelemetryIngestionKeyLimitDecision = await consume({
          limitPerMinute: 1,
        });

        expect(decision.outcome).toBe(
          TelemetryIngestionKeyLimitOutcome.RateLimited,
        );
        expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
        expect(decision.retryAfterSeconds).toBeLessThanOrEqual(60);
      }
    });

    /*
     * A non-positive or non-finite limit is a bad row or a caller bug, not a
     * customer asking for a total blackout of their own ingest. It reads as
     * "no limit" and short-circuits before Redis is touched.
     */
    test("treats a non-positive or non-finite limit as no limit and never touches Redis", async () => {
      const badLimits: Array<number> = [
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ];

      for (const limit of badLimits) {
        const decision: TelemetryIngestionKeyLimitDecision = await consume({
          limitPerMinute: limit,
        });

        expect(decision.outcome).toBe(
          TelemetryIngestionKeyLimitOutcome.Allowed,
        );
      }

      expect(client.incrKeys).toHaveLength(0);
      expect(getClientMock).not.toHaveBeenCalled();
    });
  });

  describe("the fixed window does not slide", () => {
    /*
     * THE bug this suite exists for. EXPIRE belongs only on the write that
     * created the counter; issued on every increment it pushes the TTL out for
     * as long as traffic continues, so the window never rolls and a key that
     * tripped its limit once under load stays refused forever.
     */
    test("issues EXPIRE only on the write that created the counter", async () => {
      const limit: number = 3;

      for (let index: number = 0; index < 10; index++) {
        await consume({ limitPerMinute: limit });
      }

      const key: string = expectedKeyFor(KEY_ID, currentTime);

      expect(client.incrKeys).toHaveLength(10);
      expect(client.expiresForKey(key)).toHaveLength(1);
      expect(client.expiresForKey(key)[0]?.ttlSeconds).toBe(RATE_TTL_SECONDS);
    });

    test("issues EXPIRE once more for the next window's own counter", async () => {
      await consume({ limitPerMinute: 3 });
      await consume({ limitPerMinute: 3 });

      const firstKey: string = expectedKeyFor(KEY_ID, currentTime);

      currentTime = currentTime + WINDOW_MS;

      await consume({ limitPerMinute: 3 });
      await consume({ limitPerMinute: 3 });

      const secondKey: string = expectedKeyFor(KEY_ID, currentTime);

      expect(secondKey).not.toBe(firstKey);
      expect(client.expiresForKey(firstKey)).toHaveLength(1);
      expect(client.expiresForKey(secondKey)).toHaveLength(1);
      expect(client.expires).toHaveLength(2);
    });

    test("hands the key a fresh allowance once the minute bucket rolls", async () => {
      const limit: number = 2;

      await consume({ limitPerMinute: limit });
      await consume({ limitPerMinute: limit });

      const refused: TelemetryIngestionKeyLimitDecision = await consume({
        limitPerMinute: limit,
      });

      expect(refused.outcome).toBe(
        TelemetryIngestionKeyLimitOutcome.RateLimited,
      );

      currentTime = currentTime + WINDOW_MS;

      const afterRoll: TelemetryIngestionKeyLimitDecision = await consume({
        limitPerMinute: limit,
      });

      expect(afterRoll.outcome).toBe(TelemetryIngestionKeyLimitOutcome.Allowed);
    });

    /*
     * Standard fixed-window behaviour, and the point of it: a client hammering
     * a scraped key keeps its own window pinned rather than being handed a
     * fresh allowance for free by virtue of having been refused.
     */
    test("keeps counting rejected requests, so hammering does not buy a fresh allowance", async () => {
      const limit: number = 1;
      const key: string = expectedKeyFor(KEY_ID, currentTime);

      await consume({ limitPerMinute: limit });

      for (let index: number = 0; index < 5; index++) {
        const decision: TelemetryIngestionKeyLimitDecision = await consume({
          limitPerMinute: limit,
        });

        expect(decision.outcome).toBe(
          TelemetryIngestionKeyLimitOutcome.RateLimited,
        );
      }

      expect(client.counters.get(key)).toBe(6);
    });
  });

  describe("counter keying", () => {
    test("keys the counter on the ingestion key id and the current minute bucket", async () => {
      await consume({ limitPerMinute: 10 });

      expect(client.incrKeys).toEqual([
        `${RATE_KEY_PREFIX}${KEY_ID.toString()}:${currentTime / WINDOW_MS}`,
      ]);
    });

    test("does not let two ingestion keys share a counter", async () => {
      const limit: number = 1;

      await consume({ ingestionKeyId: KEY_ID, limitPerMinute: limit });

      const sameKeyAgain: TelemetryIngestionKeyLimitDecision = await consume({
        ingestionKeyId: KEY_ID,
        limitPerMinute: limit,
      });

      const otherKey: TelemetryIngestionKeyLimitDecision = await consume({
        ingestionKeyId: OTHER_KEY_ID,
        limitPerMinute: limit,
      });

      expect(sameKeyAgain.outcome).toBe(
        TelemetryIngestionKeyLimitOutcome.RateLimited,
      );
      expect(otherKey.outcome).toBe(TelemetryIngestionKeyLimitOutcome.Allowed);
      expect(client.counters.get(expectedKeyFor(KEY_ID, currentTime))).toBe(2);
      expect(
        client.counters.get(expectedKeyFor(OTHER_KEY_ID, currentTime)),
      ).toBe(1);
    });
  });

  describe("first rejection in the window", () => {
    /*
     * A refused caller keeps knocking, so a caller that logged every refusal
     * would answer an ingest flood with a log flood. Exactly one line per key
     * per minute is what an operator needs to see WHICH key is being abused.
     */
    test("marks only the request that crossed the line", async () => {
      const limit: number = 2;

      await consume({ limitPerMinute: limit });
      await consume({ limitPerMinute: limit });

      const first: TelemetryIngestionKeyLimitDecision = await consume({
        limitPerMinute: limit,
      });
      const second: TelemetryIngestionKeyLimitDecision = await consume({
        limitPerMinute: limit,
      });
      const third: TelemetryIngestionKeyLimitDecision = await consume({
        limitPerMinute: limit,
      });

      expect(first.isFirstRejectionInWindow).toBe(true);
      expect(second.isFirstRejectionInWindow).toBe(false);
      expect(third.isFirstRejectionInWindow).toBe(false);
    });

    test("marks the crossing again in the next window", async () => {
      const limit: number = 1;

      await consume({ limitPerMinute: limit });
      await consume({ limitPerMinute: limit });

      currentTime = currentTime + WINDOW_MS;

      await consume({ limitPerMinute: limit });

      const crossing: TelemetryIngestionKeyLimitDecision = await consume({
        limitPerMinute: limit,
      });

      expect(crossing.outcome).toBe(
        TelemetryIngestionKeyLimitOutcome.RateLimited,
      );
      expect(crossing.isFirstRejectionInWindow).toBe(true);
    });
  });

  describe("fails open when the counter is unavailable", () => {
    test("reports CounterUnavailable when there is no Redis client", async () => {
      getClientMock.mockReturnValue(null);

      const decision: TelemetryIngestionKeyLimitDecision = await consume({
        limitPerMinute: 1,
      });

      expect(decision.outcome).toBe(
        TelemetryIngestionKeyLimitOutcome.CounterUnavailable,
      );
      expect(decision.retryAfterSeconds).toBeUndefined();
    });

    test("reports CounterUnavailable when Redis is not connected", async () => {
      isConnectedMock.mockReturnValue(false);

      const decision: TelemetryIngestionKeyLimitDecision = await consume({
        limitPerMinute: 1,
      });

      expect(decision.outcome).toBe(
        TelemetryIngestionKeyLimitOutcome.CounterUnavailable,
      );
      expect(client.incrKeys).toHaveLength(0);
    });

    test("swallows a failing INCR rather than letting it reach the ingest route", async () => {
      client.failNextIncr = new Error(
        "READONLY You can't write against a read only replica.",
      );

      const decision: TelemetryIngestionKeyLimitDecision = await consume({
        limitPerMinute: 1,
      });

      expect(decision.outcome).toBe(
        TelemetryIngestionKeyLimitOutcome.CounterUnavailable,
      );
      expect(loggerErrorMock).not.toHaveBeenCalled();
    });

    test("counts normally again on the request after a transient INCR failure", async () => {
      client.failNextIncr = new Error("connection reset by peer");

      await consume({ limitPerMinute: 1 });

      const afterRecovery: TelemetryIngestionKeyLimitDecision = await consume({
        limitPerMinute: 1,
      });

      expect(afterRecovery.outcome).toBe(
        TelemetryIngestionKeyLimitOutcome.Allowed,
      );
    });
  });
});
