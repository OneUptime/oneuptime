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
import SessionReplayUsage from "../../../../Server/Utils/SessionReplay/SessionReplayUsage";

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
});
