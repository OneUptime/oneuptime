import Redis from "Common/Server/Infrastructure/Redis";
import {
  COUNTER_WINDOW_IN_SECONDS,
  getCounterDelta,
  getRedisHealthSnapshot,
  RedisHealthSnapshot,
  RedisCounterSample,
  shouldRollCounterSamples,
} from "../../../../Server/Workers/InstanceHealth/RedisHealth";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The counter-delta half of Redis/Valkey health, which only the Enterprise
 * instance-health job (EvaluateRedisHealth.ts) reads. Moved here from core
 * with every assertion it had there. The INFO half it builds on stays in core
 * with its tests (packages/Common/Tests/Server/Utils/InstanceHealth/RedisHealth.test.ts).
 */

const INFO_FIXTURE: string = [
  "# Server",
  "redis_version:7.2.4",
  "uptime_in_seconds:86400",
  "",
  "# Clients",
  "connected_clients:42",
  "maxclients:10000",
  "blocked_clients:3",
  "",
  "# Memory",
  "used_memory:1073741824",
  "maxmemory:2147483648",
  "maxmemory_policy:allkeys-lru",
  "",
  "# Persistence",
  "aof_enabled:0",
  "rdb_last_bgsave_status:ok",
  "aof_last_write_status:ok",
  "aof_last_bgrewrite_status:ok",
  "",
  "# Stats",
  "evicted_keys:17",
  "rejected_connections:5",
].join("\r\n");

interface FakeRedisClient {
  info: jest.Mock;
  call: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  expire: jest.Mock;
}

function makeClient(overrides: Partial<FakeRedisClient> = {}): FakeRedisClient {
  return {
    info: jest.fn().mockResolvedValue(INFO_FIXTURE),
    call: jest.fn().mockResolvedValue(["maxclients", "10000"]),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    expire: jest.fn().mockResolvedValue(1),
    ...overrides,
  };
}

/*
 * The INFO fixture reports uptime_in_seconds:86400. Deltas are measured against
 * the OLDER of the two retained samples, so `olderAgeInSeconds` is what controls
 * the reported window; `newerAgeInSeconds` controls when the pair next rolls.
 */
function storedSamples(data: {
  evictedKeys: number;
  rejectedConnections: number;
  olderAgeInSeconds: number;
  newerAgeInSeconds?: number;
}): string {
  const newerAge: number = data.newerAgeInSeconds ?? data.olderAgeInSeconds;

  return JSON.stringify({
    older: {
      evictedKeys: data.evictedKeys,
      rejectedConnections: data.rejectedConnections,
      uptimeInSeconds: 86400 - data.olderAgeInSeconds,
    },
    newer: {
      evictedKeys: data.evictedKeys,
      rejectedConnections: data.rejectedConnections,
      uptimeInSeconds: 86400 - newerAge,
    },
  });
}

function sample(uptimeInSeconds: number): RedisCounterSample {
  return { evictedKeys: 1, rejectedConnections: 1, uptimeInSeconds };
}

function connectClient(client: FakeRedisClient): void {
  jest.spyOn(Redis, "getClient").mockReturnValue(client as never);
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
}

describe("RedisHealth", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getCounterDelta", () => {
    test("returns the increase between two samples", () => {
      expect(
        getCounterDelta({ current: 30, previous: 10, didRestart: false }),
      ).toBe(20);
      expect(
        getCounterDelta({ current: 10, previous: 10, didRestart: false }),
      ).toBe(0);
    });

    /*
     * Redis counters restart at zero, so a decrease or a shorter uptime means
     * the previous sample describes a different server lifetime entirely.
     */
    test("reports no delta across a restart", () => {
      expect(
        getCounterDelta({ current: 5, previous: 900, didRestart: false }),
      ).toBeNull();
      expect(
        getCounterDelta({ current: 900, previous: 5, didRestart: true }),
      ).toBeNull();
    });
  });

  describe("shouldRollCounterSamples", () => {
    test("seeds a pair when there is none", () => {
      expect(
        shouldRollCounterSamples({
          previous: null,
          currentUptimeInSeconds: 100,
          didRestart: false,
        }),
      ).toBe(true);
    });

    test("re-seeds after a restart", () => {
      expect(
        shouldRollCounterSamples({
          previous: { older: sample(999999), newer: sample(999999) },
          currentUptimeInSeconds: 10,
          didRestart: true,
        }),
      ).toBe(true);
    });

    /*
     * The roll is gated on the NEWER sample's age. Rolling on the older one
     * would restart the lookback from a five-minute-old baseline, which is the
     * tumbling-window behaviour the pair exists to avoid.
     */
    test("holds while the newer sample is younger than the window", () => {
      expect(
        shouldRollCounterSamples({
          previous: {
            older: sample(1000 - COUNTER_WINDOW_IN_SECONDS),
            newer: sample(1000),
          },
          currentUptimeInSeconds: 1000 + COUNTER_WINDOW_IN_SECONDS - 1,
          didRestart: false,
        }),
      ).toBe(false);
    });

    test("rolls once the newer sample reaches the window", () => {
      expect(
        shouldRollCounterSamples({
          previous: {
            older: sample(1000 - COUNTER_WINDOW_IN_SECONDS),
            newer: sample(1000),
          },
          currentUptimeInSeconds: 1000 + COUNTER_WINDOW_IN_SECONDS,
          didRestart: false,
        }),
      ).toBe(true);
    });
  });

  describe("getRedisHealthSnapshot", () => {
    beforeEach(() => {
      jest.spyOn(Redis, "isConnected").mockReturnValue(true);
    });

    test("returns null when Redis is unreachable", async () => {
      jest.spyOn(Redis, "getClient").mockReturnValue(null);

      expect(await getRedisHealthSnapshot()).toBeNull();
    });

    test("seeds the pair and reports no delta on the first run", async () => {
      const client: FakeRedisClient = makeClient();
      connectClient(client);

      const snapshot: RedisHealthSnapshot | null =
        await getRedisHealthSnapshot();

      expect(snapshot?.evictedKeysDelta).toBeNull();
      expect(snapshot?.rejectedConnectionsDelta).toBeNull();
      expect(snapshot?.counterWindowInSeconds).toBeNull();

      const seeded: {
        evictedKeys: number;
        rejectedConnections: number;
        uptimeInSeconds: number;
      } = {
        evictedKeys: 17,
        rejectedConnections: 5,
        uptimeInSeconds: 86400,
      };

      expect(client.set).toHaveBeenCalledWith(
        "oneuptime-instance-health-redis-sample",
        JSON.stringify({ older: seeded, newer: seeded }),
        "EX",
        3600,
      );
    });

    /*
     * The previous release stored a single sample. An upgrade must keep using it
     * as a baseline rather than discarding it and going blind for a window.
     */
    test("accepts a single-sample payload written by an older release", async () => {
      const client: FakeRedisClient = makeClient({
        get: jest.fn().mockResolvedValue(
          JSON.stringify({
            evictedKeys: 10,
            rejectedConnections: 1,
            uptimeInSeconds: 80000,
          }),
        ),
      });
      connectClient(client);

      const snapshot: RedisHealthSnapshot | null =
        await getRedisHealthSnapshot();

      expect(snapshot?.evictedKeysDelta).toBe(7);
      expect(snapshot?.counterWindowInSeconds).toBe(6400);
    });

    test("reports the increase over a stored baseline", async () => {
      const client: FakeRedisClient = makeClient({
        get: jest.fn().mockResolvedValue(
          storedSamples({
            evictedKeys: 10,
            rejectedConnections: 1,
            olderAgeInSeconds: 6400,
          }),
        ),
      });
      connectClient(client);

      const snapshot: RedisHealthSnapshot | null =
        await getRedisHealthSnapshot();

      expect(snapshot?.evictedKeysDelta).toBe(7);
      expect(snapshot?.rejectedConnectionsDelta).toBe(4);
    });

    /*
     * Within the window the pair must stay put, so consecutive runs keep
     * reporting the same window's activity instead of resetting to zero the
     * moment one quiet interval passes.
     */
    test("holds the pair inside the window and keeps reporting the window's delta", async () => {
      const client: FakeRedisClient = makeClient({
        get: jest.fn().mockResolvedValue(
          storedSamples({
            evictedKeys: 10,
            rejectedConnections: 1,
            olderAgeInSeconds: COUNTER_WINDOW_IN_SECONDS - 60,
          }),
        ),
      });
      connectClient(client);

      const snapshot: RedisHealthSnapshot | null =
        await getRedisHealthSnapshot();

      expect(snapshot?.evictedKeysDelta).toBe(7);
      expect(client.set).not.toHaveBeenCalled();
      // The held baseline still needs its TTL kept alive.
      expect(client.expire).toHaveBeenCalledWith(
        "oneuptime-instance-health-redis-sample",
        3600,
      );
    });

    test("rolls the pair once the newer sample has aged past the window", async () => {
      const client: FakeRedisClient = makeClient({
        get: jest.fn().mockResolvedValue(
          storedSamples({
            evictedKeys: 10,
            rejectedConnections: 1,
            olderAgeInSeconds: COUNTER_WINDOW_IN_SECONDS * 2,
            newerAgeInSeconds: COUNTER_WINDOW_IN_SECONDS,
          }),
        ),
      });
      connectClient(client);

      await getRedisHealthSnapshot();

      expect(client.set).toHaveBeenCalled();
      expect(client.expire).not.toHaveBeenCalled();
    });

    /*
     * The whole point of keeping two samples: right after a roll the lookback
     * must still span a full window. With a single rolling baseline the tick
     * after a roll would compare against a 5-minute-old sample, so one quiet
     * tick there would resolve the notification and the next burst of the same
     * incident would re-notify every master admin.
     */
    test("still looks back a full window on the tick after a roll", async () => {
      const client: FakeRedisClient = makeClient({
        get: jest.fn().mockResolvedValue(
          storedSamples({
            evictedKeys: 10,
            rejectedConnections: 1,
            olderAgeInSeconds: COUNTER_WINDOW_IN_SECONDS + 300,
            newerAgeInSeconds: 300,
          }),
        ),
      });
      connectClient(client);

      const snapshot: RedisHealthSnapshot | null =
        await getRedisHealthSnapshot();

      expect(snapshot?.counterWindowInSeconds).toBe(
        COUNTER_WINDOW_IN_SECONDS + 300,
      );
      expect(snapshot?.evictedKeysDelta).toBe(7);
      // Not due to roll again yet, so the pair is left alone.
      expect(client.set).not.toHaveBeenCalled();
    });

    /*
     * The window is what the deltas actually span, not a nominal constant, so a
     * held-longer-than-usual baseline is reported honestly rather than being
     * described as "the last 30 minutes".
     */
    test("reports the window actually spanned", async () => {
      const client: FakeRedisClient = makeClient({
        get: jest.fn().mockResolvedValue(
          storedSamples({
            evictedKeys: 10,
            rejectedConnections: 1,
            olderAgeInSeconds: 7200,
          }),
        ),
      });
      connectClient(client);

      expect((await getRedisHealthSnapshot())?.counterWindowInSeconds).toBe(
        7200,
      );
    });

    test("still returns a snapshot when the TTL refresh fails", async () => {
      const client: FakeRedisClient = makeClient({
        get: jest.fn().mockResolvedValue(
          storedSamples({
            evictedKeys: 10,
            rejectedConnections: 1,
            olderAgeInSeconds: 60,
          }),
        ),
        expire: jest.fn().mockRejectedValue(new Error("NOPERM")),
      });
      connectClient(client);

      expect((await getRedisHealthSnapshot())?.evictedKeysDelta).toBe(7);
    });

    /*
     * A baseline that outlived a Redis restart would otherwise subtract a large
     * pre-restart total from a small post-restart one and invent a spike.
     */
    test("suppresses deltas when the samples predate a restart", async () => {
      const client: FakeRedisClient = makeClient({
        get: jest.fn().mockResolvedValue(
          storedSamples({
            evictedKeys: 10,
            rejectedConnections: 1,
            // Longer uptime than Redis now reports, so it must have restarted.
            olderAgeInSeconds: -913599,
          }),
        ),
      });
      connectClient(client);

      const snapshot: RedisHealthSnapshot | null =
        await getRedisHealthSnapshot();

      expect(snapshot?.evictedKeysDelta).toBeNull();
      expect(snapshot?.rejectedConnectionsDelta).toBeNull();
    });

    test("ignores a corrupt stored sample", async () => {
      const client: FakeRedisClient = makeClient({
        get: jest.fn().mockResolvedValue("{not json"),
      });
      connectClient(client);

      const snapshot: RedisHealthSnapshot | null =
        await getRedisHealthSnapshot();

      expect(snapshot?.evictedKeysDelta).toBeNull();
      expect(client.set).toHaveBeenCalled();
    });

    test("ignores stored samples with non-numeric counters", async () => {
      const client: FakeRedisClient = makeClient({
        get: jest.fn().mockResolvedValue(
          JSON.stringify({
            older: {
              evictedKeys: "lots",
              rejectedConnections: 1,
              uptimeInSeconds: 80000,
            },
            newer: {
              evictedKeys: "lots",
              rejectedConnections: 1,
              uptimeInSeconds: 80000,
            },
          }),
        ),
      });
      connectClient(client);

      expect((await getRedisHealthSnapshot())?.evictedKeysDelta).toBeNull();
    });

    // Losing the baseline must never fail the evaluation that produced it.
    test("still returns a snapshot when the baseline cannot be written", async () => {
      const client: FakeRedisClient = makeClient({
        set: jest.fn().mockRejectedValue(new Error("READONLY")),
      });
      connectClient(client);

      expect((await getRedisHealthSnapshot())?.memoryUtilizationPercent).toBe(
        50,
      );
    });

    /*
     * Under the default noeviction policy Redis rejects SET once it is out of
     * memory but still serves EXPIRE. If a failed write also skipped the TTL
     * refresh, the baseline would expire exactly when memory is full and
     * eviction detection would go blind for good — every later write fails the
     * same way, so the key would never come back.
     */
    test("keeps the baseline alive when the roll write is rejected", async () => {
      const client: FakeRedisClient = makeClient({
        get: jest.fn().mockResolvedValue(
          storedSamples({
            evictedKeys: 10,
            rejectedConnections: 1,
            olderAgeInSeconds: COUNTER_WINDOW_IN_SECONDS * 2,
            newerAgeInSeconds: COUNTER_WINDOW_IN_SECONDS,
          }),
        ),
        set: jest
          .fn()
          .mockRejectedValue(
            new Error(
              "OOM command not allowed when used memory > 'maxmemory'.",
            ),
          ),
      });
      connectClient(client);

      const snapshot: RedisHealthSnapshot | null =
        await getRedisHealthSnapshot();

      expect(client.set).toHaveBeenCalled();
      expect(client.expire).toHaveBeenCalledWith(
        "oneuptime-instance-health-redis-sample",
        3600,
      );
      // The old baseline is still usable, so the delta survives.
      expect(snapshot?.evictedKeysDelta).toBe(7);
    });

    test("still returns a snapshot when the baseline cannot be read", async () => {
      const client: FakeRedisClient = makeClient({
        get: jest.fn().mockRejectedValue(new Error("NOPERM")),
      });
      connectClient(client);

      const snapshot: RedisHealthSnapshot | null =
        await getRedisHealthSnapshot();

      expect(snapshot?.evictedKeysDelta).toBeNull();
      expect(snapshot?.usedMemoryInBytes).toBe(1073741824);
    });
  });
});
