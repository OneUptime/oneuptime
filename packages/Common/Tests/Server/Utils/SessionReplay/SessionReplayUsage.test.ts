import ObjectID from "../../../../Types/ObjectID";

/*
 * SessionReplayUsage owns the Redis key names and byte-budget read path shared
 * by the ingest gate (which writes the counters) and the dashboard (which
 * reads them). These tests pin two things that silently break the budget if
 * they drift: the exact key format the two sides must agree on, and the
 * read-path contract that "Redis unavailable" is reported as null (unknown)
 * while "key absent" is reported as 0.
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
import logger from "../../../../Server/Utils/Logger";
import SessionReplayUsage, {
  BYTE_COUNTER_MGET_CHUNK_SIZE,
} from "../../../../Server/Utils/SessionReplay/SessionReplayUsage";

const getClientMock: jest.Mock = Redis.getClient as unknown as jest.Mock;
const isConnectedMock: jest.Mock = Redis.isConnected as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID("60f7d9b0a1b2c3d4e5f60001");
const RUM_APP_ID: ObjectID = new ObjectID("60f7d9b0a1b2c3d4e5f60099");

function mockConnectedClient(get: jest.Mock): void {
  getClientMock.mockReturnValue({ get });
  isConnectedMock.mockReturnValue(true);
}

describe("SessionReplayUsage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("UTC bucket helpers", () => {
    test("getUtcDayBucket is a YYYY-MM-DD string", () => {
      const bucket: string = SessionReplayUsage.getUtcDayBucket();
      expect(bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Same derivation the implementation promises: the UTC calendar day.
      expect(bucket).toBe(new Date().toISOString().substring(0, 10));
    });

    test("getUtcMonthBucket is a YYYY-MM string and prefixes the day bucket", () => {
      const month: string = SessionReplayUsage.getUtcMonthBucket();
      expect(month).toMatch(/^\d{4}-\d{2}$/);
      expect(month).toBe(new Date().toISOString().substring(0, 7));
      // The day bucket always starts with the month bucket.
      expect(SessionReplayUsage.getUtcDayBucket().startsWith(month)).toBe(true);
    });
  });

  describe("key builders", () => {
    test("daily project key embeds prefix, project id and today's UTC day", () => {
      const key: string = SessionReplayUsage.getDailyProjectByteKey(PROJECT_ID);

      expect(key).toBe(
        `replay:rate:bytes:${PROJECT_ID.toString()}:${SessionReplayUsage.getUtcDayBucket()}`,
      );
    });

    test("monthly application key embeds project id, rum app id and month", () => {
      const key: string = SessionReplayUsage.getMonthlyApplicationByteKey({
        projectId: PROJECT_ID,
        rumApplicationId: RUM_APP_ID,
      });

      expect(key).toBe(
        `replay:rate:bytes-month:${PROJECT_ID.toString()}:${RUM_APP_ID.toString()}:${SessionReplayUsage.getUtcMonthBucket()}`,
      );
    });

    test("daily and monthly keys use distinct prefixes so they never collide", () => {
      const daily: string =
        SessionReplayUsage.getDailyProjectByteKey(PROJECT_ID);
      const monthly: string = SessionReplayUsage.getMonthlyApplicationByteKey({
        projectId: PROJECT_ID,
        rumApplicationId: RUM_APP_ID,
      });

      expect(daily.startsWith("replay:rate:bytes:")).toBe(true);
      expect(monthly.startsWith("replay:rate:bytes-month:")).toBe(true);
      expect(daily).not.toEqual(monthly);
    });

    test("keys are project-scoped", () => {
      const otherProject: ObjectID = new ObjectID("60f7d9b0a1b2c3d4e5f60002");
      expect(SessionReplayUsage.getDailyProjectByteKey(PROJECT_ID)).not.toEqual(
        SessionReplayUsage.getDailyProjectByteKey(otherProject),
      );
    });
  });

  describe("getProjectBytesUsedToday", () => {
    test("returns null (unknown) when there is no Redis client", async () => {
      getClientMock.mockReturnValue(null);
      isConnectedMock.mockReturnValue(false);

      await expect(
        SessionReplayUsage.getProjectBytesUsedToday(PROJECT_ID),
      ).resolves.toBeNull();
    });

    test("returns null (unknown) when Redis is not connected", async () => {
      getClientMock.mockReturnValue({ get: jest.fn() });
      isConnectedMock.mockReturnValue(false);

      await expect(
        SessionReplayUsage.getProjectBytesUsedToday(PROJECT_ID),
      ).resolves.toBeNull();
    });

    test("returns 0 when the counter key is absent", async () => {
      const get: jest.Mock = jest.fn().mockResolvedValue(null);
      mockConnectedClient(get);

      await expect(
        SessionReplayUsage.getProjectBytesUsedToday(PROJECT_ID),
      ).resolves.toBe(0);

      expect(get).toHaveBeenCalledWith(
        SessionReplayUsage.getDailyProjectByteKey(PROJECT_ID),
      );
    });

    test("parses the stored decimal string into a number", async () => {
      const get: jest.Mock = jest.fn().mockResolvedValue("2048");
      mockConnectedClient(get);

      await expect(
        SessionReplayUsage.getProjectBytesUsedToday(PROJECT_ID),
      ).resolves.toBe(2048);
    });

    test("treats a non-numeric stored value as 0 rather than NaN", async () => {
      const get: jest.Mock = jest.fn().mockResolvedValue("not-a-number");
      mockConnectedClient(get);

      await expect(
        SessionReplayUsage.getProjectBytesUsedToday(PROJECT_ID),
      ).resolves.toBe(0);
    });

    test("returns null (unknown) when the Redis read throws", async () => {
      const get: jest.Mock = jest
        .fn()
        .mockRejectedValue(new Error("connection reset"));
      mockConnectedClient(get);

      await expect(
        SessionReplayUsage.getProjectBytesUsedToday(PROJECT_ID),
      ).resolves.toBeNull();
    });
  });

  describe("getApplicationBytesUsedThisMonth", () => {
    test("reads the monthly application key", async () => {
      const get: jest.Mock = jest.fn().mockResolvedValue("500");
      mockConnectedClient(get);

      const used: number | null =
        await SessionReplayUsage.getApplicationBytesUsedThisMonth({
          projectId: PROJECT_ID,
          rumApplicationId: RUM_APP_ID,
        });

      expect(used).toBe(500);
      expect(get).toHaveBeenCalledWith(
        SessionReplayUsage.getMonthlyApplicationByteKey({
          projectId: PROJECT_ID,
          rumApplicationId: RUM_APP_ID,
        }),
      );
    });

    test("returns null (unknown) when Redis is unavailable", async () => {
      getClientMock.mockReturnValue(null);
      isConnectedMock.mockReturnValue(false);

      await expect(
        SessionReplayUsage.getApplicationBytesUsedThisMonth({
          projectId: PROJECT_ID,
          rumApplicationId: RUM_APP_ID,
        }),
      ).resolves.toBeNull();
    });
  });

  /*
   * The batch read behind the budget-metrics sweep. Its contract is the
   * single-key readers' contract applied per key, plus one rule of its own:
   * all or nothing, because a sweep that published the half it could read
   * would publish the other half as missing rather than as unknown.
   */
  describe("readByteCounters", () => {
    function mockMget(mget: jest.Mock): void {
      getClientMock.mockReturnValue({ mget });
      isConnectedMock.mockReturnValue(true);
    }

    function keysFor(count: number): Array<string> {
      return Array.from({ length: count }, (_: unknown, index: number) => {
        return `replay:rate:bytes:project-${index}:2026-09-29`;
      });
    }

    test("an empty key list answers [] without touching Redis", async () => {
      await expect(SessionReplayUsage.readByteCounters([])).resolves.toEqual(
        [],
      );

      expect(getClientMock).not.toHaveBeenCalled();
    });

    test("returns null (unknown) when there is no Redis client", async () => {
      getClientMock.mockReturnValue(null);
      isConnectedMock.mockReturnValue(false);

      await expect(
        SessionReplayUsage.readByteCounters(["replay:rate:bytes:a:2026-09-29"]),
      ).resolves.toBeNull();
    });

    test("returns null (unknown) when Redis is not connected", async () => {
      const mget: jest.Mock = jest.fn();
      getClientMock.mockReturnValue({ mget });
      isConnectedMock.mockReturnValue(false);

      await expect(
        SessionReplayUsage.readByteCounters(["replay:rate:bytes:a:2026-09-29"]),
      ).resolves.toBeNull();
      expect(mget).not.toHaveBeenCalled();
    });

    test("answers positionally, with the single-key parsing rules per key", async () => {
      const mget: jest.Mock = jest
        .fn()
        .mockResolvedValue(["2048", null, "not-a-number", "0"]);
      mockMget(mget);

      const keys: Array<string> = [
        SessionReplayUsage.getDailyProjectByteKey(PROJECT_ID),
        SessionReplayUsage.getMonthlyApplicationByteKey({
          projectId: PROJECT_ID,
          rumApplicationId: RUM_APP_ID,
        }),
        "replay:rate:bytes:garbage:2026-09-29",
        "replay:rate:bytes:zero:2026-09-29",
      ];

      await expect(SessionReplayUsage.readByteCounters(keys)).resolves.toEqual([
        2048, 0, 0, 0,
      ]);
      expect(mget).toHaveBeenCalledTimes(1);
      expect(mget).toHaveBeenCalledWith(keys);
    });

    test("does not clamp: a negative counter is returned as stored", async () => {
      // A refund that straddles 00:00 UTC can leave the new day's key below 0.
      mockMget(jest.fn().mockResolvedValue(["-4096"]));

      await expect(
        SessionReplayUsage.readByteCounters(["replay:rate:bytes:a:2026-09-29"]),
      ).resolves.toEqual([-4096]);
    });

    test("chunks large reads and keeps the order across chunks", async () => {
      const keys: Array<string> = keysFor(BYTE_COUNTER_MGET_CHUNK_SIZE * 2 + 3);

      const mget: jest.Mock = jest
        .fn()
        .mockImplementation(async (chunk: Array<string>) => {
          // Echo each key's index so the order is checkable end to end.
          return chunk.map((key: string) => {
            return key.split(":")[3]!.replace("project-", "");
          });
        });
      mockMget(mget);

      const values: Array<number> | null =
        await SessionReplayUsage.readByteCounters(keys);

      expect(mget).toHaveBeenCalledTimes(3);
      expect((mget.mock.calls[0]![0] as Array<string>).length).toBe(
        BYTE_COUNTER_MGET_CHUNK_SIZE,
      );
      expect((mget.mock.calls[1]![0] as Array<string>).length).toBe(
        BYTE_COUNTER_MGET_CHUNK_SIZE,
      );
      expect((mget.mock.calls[2]![0] as Array<string>).length).toBe(3);
      expect(values).toEqual(
        keys.map((_: string, index: number) => {
          return index;
        }),
      );
    });

    test("is all or nothing: one failing chunk makes the whole answer unknown", async () => {
      const keys: Array<string> = keysFor(BYTE_COUNTER_MGET_CHUNK_SIZE + 1);
      const mget: jest.Mock = jest
        .fn()
        .mockResolvedValueOnce(
          keys.slice(0, BYTE_COUNTER_MGET_CHUNK_SIZE).map(() => {
            return "1";
          }),
        )
        .mockRejectedValueOnce(new Error("connection reset"));
      mockMget(mget);

      await expect(SessionReplayUsage.readByteCounters(keys)).resolves.toBe(
        null,
      );
      expect(logger.warn).toHaveBeenCalled();
    });

    test("an answer of the wrong length is unknown, never misaligned", async () => {
      mockMget(jest.fn().mockResolvedValue(["1"]));

      await expect(
        SessionReplayUsage.readByteCounters([
          "replay:rate:bytes:a:2026-09-29",
          "replay:rate:bytes:b:2026-09-29",
        ]),
      ).resolves.toBeNull();
    });
  });
});
