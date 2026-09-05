import ObjectID from "../../../../Types/ObjectID";
import { SessionReplayRefusalCount } from "../../../../Types/Rum/SessionReplayHealth";

/*
 * The refusal counters are what let the Dashboard say "212 uploads refused:
 * origin-not-allowed" instead of showing an empty session list. These tests
 * pin the key shape the ingest gate and the ingest-status route must agree
 * on, the UTC day bucketing, the 48h TTL, the today+yesterday sum, and the
 * one rule every reader relies on: a counter that could not be read is
 * null, never 0.
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
import SessionReplayHealthCounters, {
  SESSION_REPLAY_HEALTH_COUNTER_TTL_SECONDS,
  SessionReplayDropCount,
} from "../../../../Server/Utils/SessionReplay/SessionReplayHealthCounters";

const getClientMock: jest.Mock = Redis.getClient as unknown as jest.Mock;
const isConnectedMock: jest.Mock = Redis.isConnected as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID("60f7d9b0a1b2c3d4e5f60001");

/* 2026-03-10T01:30:00Z: shortly after a UTC midnight, so "yesterday" matters. */
const NOW_UNIX_MS: number = Date.UTC(2026, 2, 10, 1, 30, 0);

class FakeRedisHashes {
  public hashes: Map<string, Map<string, number>> = new Map<
    string,
    Map<string, number>
  >();
  public expires: Map<string, number> = new Map<string, number>();
  public failNext: Error | null = null;

  public client(): unknown {
    return {
      hincrby: (key: string, field: string, by: number): Promise<number> => {
        if (this.failNext) {
          const error: Error = this.failNext;
          this.failNext = null;
          return Promise.reject(error);
        }

        const hash: Map<string, number> =
          this.hashes.get(key) || new Map<string, number>();
        const next: number = (hash.get(field) || 0) + by;
        hash.set(field, next);
        this.hashes.set(key, hash);
        return Promise.resolve(next);
      },
      expire: (key: string, seconds: number): Promise<number> => {
        this.expires.set(key, seconds);
        return Promise.resolve(1);
      },
      hgetall: (key: string): Promise<Record<string, string>> => {
        if (this.failNext) {
          const error: Error = this.failNext;
          this.failNext = null;
          return Promise.reject(error);
        }

        const hash: Map<string, number> | undefined = this.hashes.get(key);
        const result: Record<string, string> = {};

        for (const [field, value] of hash?.entries() || []) {
          result[field] = String(value);
        }

        return Promise.resolve(result);
      },
    };
  }
}

let fakeRedis: FakeRedisHashes;

function connect(): void {
  fakeRedis = new FakeRedisHashes();
  getClientMock.mockReturnValue(fakeRedis.client());
  isConnectedMock.mockReturnValue(true);
}

function disconnect(): void {
  getClientMock.mockReturnValue(null);
  isConnectedMock.mockReturnValue(false);
}

describe("SessionReplayHealthCounters", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    connect();
  });

  describe("key shape", () => {
    test("refusal keys are replay:refusals:<projectId>:<appIdentifierLower>:<utcDay>", () => {
      expect(
        SessionReplayHealthCounters.getRefusalCounterKey({
          projectId: PROJECT_ID,
          appIdentifier: "Checkout-Web",
          utcDay: "2026-03-10",
        }),
      ).toBe(
        `replay:refusals:${PROJECT_ID.toString()}:checkout-web:2026-03-10`,
      );
    });

    test("drop keys live under their own prefix so a refusal is never mistaken for a drop", () => {
      expect(
        SessionReplayHealthCounters.getDropCounterKey({
          projectId: PROJECT_ID.toString(),
          appIdentifier: " checkout-web ",
          utcDay: "2026-03-10",
        }),
      ).toBe(`replay:drops:${PROJECT_ID.toString()}:checkout-web:2026-03-10`);
    });

    test("the day bucket is the UTC calendar day", () => {
      expect(SessionReplayHealthCounters.getUtcDayBucket(NOW_UNIX_MS)).toBe(
        "2026-03-10",
      );
      /* One hour before the same UTC midnight is the previous day. */
      expect(
        SessionReplayHealthCounters.getUtcDayBucket(
          NOW_UNIX_MS - 2 * 60 * 60 * 1000,
        ),
      ).toBe("2026-03-09");
    });
  });

  describe("recordRefusal", () => {
    test("increments the reason field of today's bucket and sets the 48h TTL", async () => {
      await SessionReplayHealthCounters.recordRefusal({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
        reason: "origin-not-allowed",
        nowUnixMs: NOW_UNIX_MS,
      });
      await SessionReplayHealthCounters.recordRefusal({
        projectId: PROJECT_ID,
        appIdentifier: "CHECKOUT-WEB",
        reason: "origin-not-allowed",
        nowUnixMs: NOW_UNIX_MS,
      });

      const key: string = SessionReplayHealthCounters.getRefusalCounterKey({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
        utcDay: "2026-03-10",
      });

      expect(fakeRedis.hashes.get(key)?.get("origin-not-allowed")).toBe(2);
      expect(fakeRedis.expires.get(key)).toBe(
        SESSION_REPLAY_HEALTH_COUNTER_TTL_SECONDS,
      );
      expect(SESSION_REPLAY_HEALTH_COUNTER_TTL_SECONDS).toBe(48 * 60 * 60);
    });

    test("an empty reason writes nothing", async () => {
      await SessionReplayHealthCounters.recordRefusal({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
        reason: "   ",
        nowUnixMs: NOW_UNIX_MS,
      });

      expect(fakeRedis.hashes.size).toBe(0);
    });

    test("never throws when Redis is disconnected or the write fails", async () => {
      disconnect();

      await expect(
        SessionReplayHealthCounters.recordRefusal({
          projectId: PROJECT_ID,
          appIdentifier: "checkout-web",
          reason: "not-sampled",
        }),
      ).resolves.toBeUndefined();

      connect();
      fakeRedis.failNext = new Error("READONLY");

      await expect(
        SessionReplayHealthCounters.recordRefusal({
          projectId: PROJECT_ID,
          appIdentifier: "checkout-web",
          reason: "not-sampled",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("readRefusalsLast24h", () => {
    test("sums today's and yesterday's buckets and sorts by count", async () => {
      const today: string = "2026-03-10";
      const yesterday: string = "2026-03-09";

      for (const [day, reason, count] of [
        [today, "origin-not-allowed", 5],
        [yesterday, "origin-not-allowed", 7],
        [today, "not-sampled", 20],
        [yesterday, "budget-exhausted", 1],
      ] as Array<[string, string, number]>) {
        for (let i: number = 0; i < count; i++) {
          await SessionReplayHealthCounters.recordRefusal({
            projectId: PROJECT_ID,
            appIdentifier: "checkout-web",
            reason: reason,
            nowUnixMs: day === today ? NOW_UNIX_MS : NOW_UNIX_MS - 86_400_000,
          });
        }
      }

      const refusals: Array<SessionReplayRefusalCount> | null =
        await SessionReplayHealthCounters.readRefusalsLast24h({
          projectId: PROJECT_ID,
          appIdentifier: "checkout-web",
          nowUnixMs: NOW_UNIX_MS,
        });

      expect(refusals).toEqual([
        { reason: "not-sampled", count: 20 },
        { reason: "origin-not-allowed", count: 12 },
        { reason: "budget-exhausted", count: 1 },
      ]);
    });

    test("a bucket from two days ago is outside the window", async () => {
      await SessionReplayHealthCounters.recordRefusal({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
        reason: "rate-limited",
        nowUnixMs: NOW_UNIX_MS - 2 * 86_400_000,
      });

      const refusals: Array<SessionReplayRefusalCount> | null =
        await SessionReplayHealthCounters.readRefusalsLast24h({
          projectId: PROJECT_ID,
          appIdentifier: "checkout-web",
          nowUnixMs: NOW_UNIX_MS,
        });

      expect(refusals).toEqual([]);
    });

    test("fields outside the gate's closed vocabulary are dropped, not rendered", async () => {
      await SessionReplayHealthCounters.recordRefusal({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
        reason: "some-future-reason",
        nowUnixMs: NOW_UNIX_MS,
      });
      await SessionReplayHealthCounters.recordRefusal({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
        reason: "session-chunk-cap",
        nowUnixMs: NOW_UNIX_MS,
      });

      const refusals: Array<SessionReplayRefusalCount> | null =
        await SessionReplayHealthCounters.readRefusalsLast24h({
          projectId: PROJECT_ID,
          appIdentifier: "checkout-web",
          nowUnixMs: NOW_UNIX_MS,
        });

      expect(refusals).toEqual([{ reason: "session-chunk-cap", count: 1 }]);
    });

    test("nothing refused is an empty array, which is not the same as unknown", async () => {
      const refusals: Array<SessionReplayRefusalCount> | null =
        await SessionReplayHealthCounters.readRefusalsLast24h({
          projectId: PROJECT_ID,
          appIdentifier: "checkout-web",
          nowUnixMs: NOW_UNIX_MS,
        });

      expect(refusals).toEqual([]);
    });

    test("Redis unavailable is null, never 0 or []", async () => {
      disconnect();

      expect(
        await SessionReplayHealthCounters.readRefusalsLast24h({
          projectId: PROJECT_ID,
          appIdentifier: "checkout-web",
        }),
      ).toBeNull();

      connect();
      fakeRedis.failNext = new Error("connection reset");

      expect(
        await SessionReplayHealthCounters.readRefusalsLast24h({
          projectId: PROJECT_ID,
          appIdentifier: "checkout-web",
        }),
      ).toBeNull();
    });
  });

  describe("worker drops", () => {
    test("drops are counted apart from refusals and read back with their open vocabulary", async () => {
      await SessionReplayHealthCounters.recordDrop({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
        reason: "scrub-incomplete",
        nowUnixMs: NOW_UNIX_MS,
      });
      await SessionReplayHealthCounters.recordDrop({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
        reason: "consent-unknown",
        nowUnixMs: NOW_UNIX_MS - 86_400_000,
      });
      await SessionReplayHealthCounters.recordDrop({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
        reason: "consent-unknown",
        nowUnixMs: NOW_UNIX_MS,
      });

      const drops: Array<SessionReplayDropCount> | null =
        await SessionReplayHealthCounters.readDropsLast24h({
          projectId: PROJECT_ID,
          appIdentifier: "checkout-web",
          nowUnixMs: NOW_UNIX_MS,
        });

      expect(drops).toEqual([
        { reason: "consent-unknown", count: 2 },
        { reason: "scrub-incomplete", count: 1 },
      ]);

      /* A drop is not a refusal. */
      expect(
        await SessionReplayHealthCounters.readRefusalsLast24h({
          projectId: PROJECT_ID,
          appIdentifier: "checkout-web",
          nowUnixMs: NOW_UNIX_MS,
        }),
      ).toEqual([]);
    });

    test("drops are also null when Redis is down", async () => {
      disconnect();

      expect(
        await SessionReplayHealthCounters.readDropsLast24h({
          projectId: PROJECT_ID,
          appIdentifier: "checkout-web",
        }),
      ).toBeNull();
    });
  });
});
