import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../Server/Utils/Logger";
import MaintenanceCalendarFeedCache, {
  MAINTENANCE_CALENDAR_CACHE_NAMESPACE,
  MAINTENANCE_CALENDAR_CACHE_TTL_SECONDS,
  MAX_CACHED_MAINTENANCE_CALENDAR_BYTES,
  MaintenanceCalendarCacheResult,
  RenderedMaintenanceCalendar,
} from "../../../../Server/Utils/ScheduledMaintenance/MaintenanceCalendarFeedCache";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * The rendered maintenance calendars are kept in Redis for as long as a
 * calendar app is told it may keep one (300 s): a burst of polls costs one
 * render, a failed render is never kept, and Redis being away only means
 * every request renders.
 */

const KEY: string = "status-page:73000000-0000-4000-8000-000000000001:g1";

let redis: Map<string, string>;
let writes: Array<{ namespace: string; key: string; ttl: unknown }>;

function calendar(body: string): RenderedMaintenanceCalendar {
  return {
    body: body,
    etag: `"${body.length}"`,
    lastModified: new Date("2026-10-15T10:20:00.000Z"),
    eventCount: 1,
  };
}

function redisReachable(): void {
  redis = new Map();
  writes = [];

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return redis.get(`${namespace}|${key}`) || null;
    });
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: unknown,
      ) => {
        writes.push({ namespace, key, ttl: options });
        redis.set(`${namespace}|${key}`, value);
      },
    );
}

function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

beforeEach(() => {
  MaintenanceCalendarFeedCache.clearInFlight();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  MaintenanceCalendarFeedCache.clearInFlight();
});

describe("MaintenanceCalendarFeedCache.getOrRender", () => {
  test("renders a calendar it does not keep, and keeps it for 300 seconds", async () => {
    redisReachable();
    const render: jest.Mock<() => Promise<RenderedMaintenanceCalendar>> =
      jest.fn(async () => {
        return calendar("BEGIN:VCALENDAR");
      });

    const result: MaintenanceCalendarCacheResult =
      await MaintenanceCalendarFeedCache.getOrRender({ key: KEY, render });
    await flush();

    expect(result.cacheHit).toBe(false);
    expect(result.calendar.body).toBe("BEGIN:VCALENDAR");
    expect(render).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([
      {
        namespace: MAINTENANCE_CALENDAR_CACHE_NAMESPACE,
        key: KEY,
        ttl: { expiresInSeconds: MAINTENANCE_CALENDAR_CACHE_TTL_SECONDS },
      },
    ]);
    expect(MAINTENANCE_CALENDAR_CACHE_TTL_SECONDS).toBe(300);
  });

  test("answers the next request from what it keeps, without rendering", async () => {
    redisReachable();
    const render: jest.Mock<() => Promise<RenderedMaintenanceCalendar>> =
      jest.fn(async () => {
        return calendar("BEGIN:VCALENDAR");
      });

    await MaintenanceCalendarFeedCache.getOrRender({ key: KEY, render });
    await flush();

    const second: MaintenanceCalendarCacheResult =
      await MaintenanceCalendarFeedCache.getOrRender({ key: KEY, render });

    expect(second.cacheHit).toBe(true);
    expect(second.calendar).toEqual(calendar("BEGIN:VCALENDAR"));
    expect(render).toHaveBeenCalledTimes(1);
  });

  test("requests that arrive while a render is under way share it", async () => {
    redisReachable();
    let release: () => void = () => {
      return;
    };
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });
    const render: jest.Mock<() => Promise<RenderedMaintenanceCalendar>> =
      jest.fn(async () => {
        await gate;
        return calendar("shared");
      });

    const all: Promise<Array<MaintenanceCalendarCacheResult>> = Promise.all([
      MaintenanceCalendarFeedCache.getOrRender({ key: KEY, render }),
      MaintenanceCalendarFeedCache.getOrRender({ key: KEY, render }),
      MaintenanceCalendarFeedCache.getOrRender({ key: KEY, render }),
    ]);

    await flush();
    release();

    const results: Array<MaintenanceCalendarCacheResult> = await all;

    expect(render).toHaveBeenCalledTimes(1);
    expect(
      results.map((result: MaintenanceCalendarCacheResult) => {
        return result.calendar.body;
      }),
    ).toEqual(["shared", "shared", "shared"]);
  });

  test("keeps each key apart", async () => {
    redisReachable();
    const render: jest.Mock<() => Promise<RenderedMaintenanceCalendar>> =
      jest.fn(async () => {
        return calendar("x");
      });

    await MaintenanceCalendarFeedCache.getOrRender({ key: "a", render });
    await flush();
    await MaintenanceCalendarFeedCache.getOrRender({ key: "b", render });

    expect(render).toHaveBeenCalledTimes(2);
  });

  test("a render that fails is never kept: every request it reached sees the error, and the next renders again", async () => {
    redisReachable();
    const failing: jest.Mock<() => Promise<RenderedMaintenanceCalendar>> =
      jest.fn(async () => {
        throw new Error("database away");
      });

    await expect(
      MaintenanceCalendarFeedCache.getOrRender({ key: KEY, render: failing }),
    ).rejects.toThrow("database away");
    await flush();

    expect(writes).toHaveLength(0);

    const working: jest.Mock<() => Promise<RenderedMaintenanceCalendar>> =
      jest.fn(async () => {
        return calendar("back");
      });

    const result: MaintenanceCalendarCacheResult =
      await MaintenanceCalendarFeedCache.getOrRender({
        key: KEY,
        render: working,
      });

    expect(result.calendar.body).toBe("back");
    expect(working).toHaveBeenCalledTimes(1);
  });

  test("a body over the limit is rendered every time rather than kept", async () => {
    redisReachable();
    const big: string = "x".repeat(MAX_CACHED_MAINTENANCE_CALENDAR_BYTES + 1);
    const render: jest.Mock<() => Promise<RenderedMaintenanceCalendar>> =
      jest.fn(async () => {
        return calendar(big);
      });

    await MaintenanceCalendarFeedCache.getOrRender({ key: KEY, render });
    await flush();

    expect(writes).toHaveLength(0);
  });

  test("with Redis away every request renders, and the outage is logged once a minute, not once a request", async () => {
    jest.spyOn(GlobalCache, "getString").mockRejectedValue(new Error("down"));
    jest.spyOn(GlobalCache, "setString").mockRejectedValue(new Error("down"));
    const startedAt: number = Date.parse("2026-10-15T10:20:00.000Z");
    jest.spyOn(Date, "now").mockReturnValue(startedAt + 10 * 60 * 1000);

    const render: jest.Mock<() => Promise<RenderedMaintenanceCalendar>> =
      jest.fn(async () => {
        return calendar("rendered");
      });

    for (let request: number = 0; request < 3; request++) {
      const result: MaintenanceCalendarCacheResult =
        await MaintenanceCalendarFeedCache.getOrRender({ key: KEY, render });
      await flush();

      expect(result.calendar.body).toBe("rendered");
      expect(result.cacheHit).toBe(false);
    }

    expect(render).toHaveBeenCalledTimes(3);

    const outageLines: Array<unknown> = (
      logger.warn as unknown as jest.Mock
    ).mock.calls.filter((call: Array<unknown>) => {
      return String(call[0]).includes("the cache is unavailable");
    });

    expect(outageLines).toHaveLength(1);
  });
});

describe("MaintenanceCalendarFeedCache.serialize / deserialize", () => {
  test("a kept calendar reads back as it was", () => {
    const kept: RenderedMaintenanceCalendar = calendar("BEGIN:VCALENDAR");

    expect(
      MaintenanceCalendarFeedCache.deserialize(
        MaintenanceCalendarFeedCache.serialize(kept),
      ),
    ).toEqual(kept);
  });

  test.each([
    null,
    "",
    "not json",
    "[]",
    JSON.stringify({ etag: "x", lastModified: "2026-10-15T10:20:00Z" }),
    JSON.stringify({ body: "x", lastModified: "2026-10-15T10:20:00Z" }),
    JSON.stringify({ body: "x", etag: "x", lastModified: "never" }),
  ])(
    "anything that is not a kept calendar (%j) is null",
    (raw: string | null) => {
      expect(MaintenanceCalendarFeedCache.deserialize(raw)).toBeNull();
    },
  );

  test("a kept calendar without a count reads as zero events", () => {
    expect(
      MaintenanceCalendarFeedCache.deserialize(
        JSON.stringify({
          body: "b",
          etag: "e",
          lastModified: "2026-10-15T10:20:00.000Z",
        }),
      )?.eventCount,
    ).toBe(0);
  });
});
