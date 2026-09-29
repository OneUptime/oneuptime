import Redis from "../../../../Server/Infrastructure/Redis";
import {
  buildRedisInfoSnapshot,
  getRedisInfoSnapshot,
  parseRedisInfo,
  readInfoSnapshot,
  RedisInfoSnapshot,
} from "../../../../Server/Utils/InstanceHealth/RedisHealth";
import Dictionary from "../../../../Types/Dictionary";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The INFO half of Redis/Valkey health, which the admin health API reads. The
 * counter-delta half (getRedisHealthSnapshot and the stored samples) belongs
 * to the Enterprise instance-health worker, and its tests live with it in
 * ee/Tests/Server/Workers/InstanceHealth/RedisHealth.test.ts.
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

  /*
   * The Enterprise worker's snapshot builds on this read, so it must use only
   * the client it is handed and must never touch the counter sample itself.
   */
  describe("readInfoSnapshot", () => {
    test("reads INFO from the client it is given", async () => {
      const client: FakeRedisClient = makeClient();
      const getClient: jest.SpyInstance = jest.spyOn(Redis, "getClient");

      const snapshot: RedisInfoSnapshot = await readInfoSnapshot(
        client as never,
      );

      expect(client.info).toHaveBeenCalledTimes(1);
      expect(getClient).not.toHaveBeenCalled();
      expect(snapshot.memoryUtilizationPercent).toBe(50);
      expect(snapshot.evictedKeys).toBe(17);
      expect(snapshot.rejectedConnections).toBe(5);
      expect(snapshot.uptimeInSeconds).toBe(86400);
      // maxclients is in INFO, so there is no CONFIG round trip.
      expect(snapshot.maxClients).toBe(10000);
      expect(client.call).not.toHaveBeenCalled();
    });

    test("never reads, writes or refreshes the counter sample", async () => {
      const client: FakeRedisClient = makeClient();

      await readInfoSnapshot(client as never);

      expect(client.get).not.toHaveBeenCalled();
      expect(client.set).not.toHaveBeenCalled();
      expect(client.expire).not.toHaveBeenCalled();
    });

    test("falls back to CONFIG GET when INFO omits maxclients", async () => {
      const client: FakeRedisClient = makeClient({
        info: jest.fn().mockResolvedValue("connected_clients:50"),
        call: jest.fn().mockResolvedValue(["maxclients", "200"]),
      });

      const snapshot: RedisInfoSnapshot = await readInfoSnapshot(
        client as never,
      );

      expect(client.call).toHaveBeenCalledWith("CONFIG", "GET", "maxclients");
      expect(snapshot.clientUtilizationPercent).toBe(25);
    });
  });
});
