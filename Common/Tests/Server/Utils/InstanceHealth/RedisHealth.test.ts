import Redis from "../../../../Server/Infrastructure/Redis";
import {
  buildRedisInfoSnapshot,
  COUNTER_WINDOW_IN_SECONDS,
  getCounterDelta,
  getRedisHealthSnapshot,
  getRedisInfoSnapshot,
  parseRedisInfo,
  RedisHealthSnapshot,
  RedisInfoSnapshot,
  RedisCounterSample,
  shouldRollCounterSamples,
} from "../../../../Server/Utils/InstanceHealth/RedisHealth";
import Dictionary from "../../../../Types/Dictionary";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

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

  describe("parseRedisInfo", () => {
    test("flattens every section into one field map", () => {
      const parsed: Dictionary<string> = parseRedisInfo(INFO_FIXTURE);

      expect(parsed["redis_version"]).toBe("7.2.4");
      expect(parsed["connected_clients"]).toBe("42");
      expect(parsed["maxmemory_policy"]).toBe("allkeys-lru");
      expect(parsed["evicted_keys"]).toBe("17");
    });

    test("drops section headers and blank lines", () => {
      const parsed: Dictionary<string> = parseRedisInfo(INFO_FIXTURE);

      expect(parsed["# Server"]).toBeUndefined();
      expect(Object.keys(parsed)).not.toContain("");
    });

    test("keeps colons that appear inside a value", () => {
      const parsed: Dictionary<string> = parseRedisInfo(
        "db0:keys=1,expires=0\r\nmaster_host:10.0.0.1:6379",
      );

      expect(parsed["db0"]).toBe("keys=1,expires=0");
      expect(parsed["master_host"]).toBe("10.0.0.1:6379");
    });

    test("handles LF-only output and an empty document", () => {
      expect(parseRedisInfo("a:1\nb:2")).toEqual({ a: "1", b: "2" });
      expect(parseRedisInfo("")).toEqual({});
    });

    test("ignores lines with no field name", () => {
      expect(parseRedisInfo(":orphan\nvalid:1")).toEqual({ valid: "1" });
    });
  });

  describe("buildRedisInfoSnapshot", () => {
    test("derives utilization percentages from the raw counters", () => {
      const snapshot: RedisInfoSnapshot = buildRedisInfoSnapshot({
        info: parseRedisInfo(INFO_FIXTURE),
        maxClients: 10000,
      });

      expect(snapshot.usedMemoryInBytes).toBe(1073741824);
      expect(snapshot.maxMemoryInBytes).toBe(2147483648);
      expect(snapshot.memoryUtilizationPercent).toBe(50);
      expect(snapshot.connectedClients).toBe(42);
      expect(snapshot.clientUtilizationPercent).toBeCloseTo(0.42, 5);
      expect(snapshot.blockedClients).toBe(3);
      expect(snapshot.evictedKeys).toBe(17);
      expect(snapshot.rejectedConnections).toBe(5);
      expect(snapshot.uptimeInSeconds).toBe(86400);
      expect(snapshot.isAofEnabled).toBe(false);
    });

    /*
     * An unset maxmemory is not "0% used" — there is simply no ceiling, so the
     * ratio must be absent rather than a number a threshold could compare to.
     */
    test("reports no memory ratio when maxmemory is unset", () => {
      const snapshot: RedisInfoSnapshot = buildRedisInfoSnapshot({
        info: parseRedisInfo("used_memory:100\r\nmaxmemory:0"),
        maxClients: 100,
      });

      expect(snapshot.maxMemoryInBytes).toBe(0);
      expect(snapshot.memoryUtilizationPercent).toBeNull();
    });

    test("reports no connection ratio when maxclients is unknown", () => {
      const snapshot: RedisInfoSnapshot = buildRedisInfoSnapshot({
        info: parseRedisInfo("connected_clients:10"),
        maxClients: null,
      });

      expect(snapshot.maxClients).toBeNull();
      expect(snapshot.clientUtilizationPercent).toBeNull();
    });

    test("recognises AOF being enabled", () => {
      expect(
        buildRedisInfoSnapshot({
          info: parseRedisInfo("aof_enabled:1"),
          maxClients: null,
        }).isAofEnabled,
      ).toBe(true);
    });

    test("falls back to unknown for missing status fields", () => {
      const snapshot: RedisInfoSnapshot = buildRedisInfoSnapshot({
        info: {},
        maxClients: null,
      });

      expect(snapshot.rdbLastBgsaveStatus).toBe("unknown");
      expect(snapshot.aofLastWriteStatus).toBe("unknown");
      expect(snapshot.aofLastBgrewriteStatus).toBe("unknown");
      expect(snapshot.maxMemoryPolicy).toBe("unknown");
      expect(snapshot.usedMemoryInBytes).toBe(0);
    });

    test("treats unparseable numbers as zero", () => {
      expect(
        buildRedisInfoSnapshot({
          info: parseRedisInfo("used_memory:not-a-number"),
          maxClients: null,
        }).usedMemoryInBytes,
      ).toBe(0);
    });
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

  describe("getRedisInfoSnapshot", () => {
    test("returns null when Redis is not connected", async () => {
      jest.spyOn(Redis, "getClient").mockReturnValue(makeClient() as never);
      jest.spyOn(Redis, "isConnected").mockReturnValue(false);

      expect(await getRedisInfoSnapshot()).toBeNull();
    });

    test("returns null when there is no client at all", async () => {
      jest.spyOn(Redis, "getClient").mockReturnValue(null);

      expect(await getRedisInfoSnapshot()).toBeNull();
    });

    /*
     * The admin health page calls this on every refresh. Advancing the stored
     * baseline here would consume the delta the notification worker depends on.
     */
    test("never reads or writes the counter sample", async () => {
      const client: FakeRedisClient = makeClient();
      connectClient(client);

      const snapshot: RedisInfoSnapshot | null = await getRedisInfoSnapshot();

      expect(snapshot?.memoryUtilizationPercent).toBe(50);
      expect(client.get).not.toHaveBeenCalled();
      expect(client.set).not.toHaveBeenCalled();
    });

    test("falls back to CONFIG GET when INFO omits maxclients", async () => {
      const client: FakeRedisClient = makeClient({
        info: jest.fn().mockResolvedValue("connected_clients:50"),
        call: jest.fn().mockResolvedValue(["maxclients", "200"]),
      });
      connectClient(client);

      const snapshot: RedisInfoSnapshot | null = await getRedisInfoSnapshot();

      expect(client.call).toHaveBeenCalledWith("CONFIG", "GET", "maxclients");
      expect(snapshot?.maxClients).toBe(200);
      expect(snapshot?.clientUtilizationPercent).toBe(25);
    });

    // Managed Redis offerings often disable CONFIG; that must not throw.
    test("reports an unknown maxclients when CONFIG is unavailable", async () => {
      const client: FakeRedisClient = makeClient({
        info: jest.fn().mockResolvedValue("connected_clients:50"),
        call: jest.fn().mockRejectedValue(new Error("unknown command CONFIG")),
      });
      connectClient(client);

      const snapshot: RedisInfoSnapshot | null = await getRedisInfoSnapshot();

      expect(snapshot?.maxClients).toBeNull();
      expect(snapshot?.clientUtilizationPercent).toBeNull();
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
