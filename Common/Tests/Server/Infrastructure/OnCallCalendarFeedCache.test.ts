import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The caches behind the on-call calendar feeds.
 *
 * What matters here is not that a value comes back after being put in -- it
 * is the invalidation rules (a purge for one user must not reach another
 * user's feed, a purge for one schedule must reach every feed rendered from
 * it), the stale-while-error tier surviving the purges that the fresh tiers do
 * not, the behaviour when Redis is gone (everything keeps working, nothing
 * throws, purges still take effect locally), and the per-process render cap.
 */

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
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

import Redis from "../../../Server/Infrastructure/Redis";
import logger from "../../../Server/Utils/Logger";
import OnCallCalendarFeedCache, {
  CachedCalendarBody,
  DEFAULT_RENDER_CONCURRENCY,
  LAST_GOOD_TTL_SECONDS,
  MAX_CACHED_BODY_BYTES,
  MAX_CACHED_LAST_GOOD_BYTES,
  MAX_CACHED_SEGMENT_BYTES,
  MEMORY_MAX_BYTES,
  ON_CALL_CALENDAR_FEED_CACHE_NAMESPACE,
  OnCallCalendarFeedCacheScope,
} from "../../../Server/Infrastructure/OnCallCalendarFeedCache";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const loggerWarnMock: MockedFn = logger.warn as unknown as MockedFn;
const loggerErrorMock: MockedFn = logger.error as unknown as MockedFn;

/*
 * A fake ioredis client that stores strings with a TTL, the only surface
 * GlobalCache.getString / setString use. `failWrites` / `failReads` simulate a
 * half-broken connection (client present, commands throwing), which is a
 * different failure from "not connected" and must be handled the same way.
 */
class FakeRedis {
  public store: Map<string, { value: string; ttl: number }> = new Map();
  public failReads: boolean = false;
  public failWrites: boolean = false;
  public getCalls: number = 0;
  public setCalls: number = 0;

  public async get(key: string): Promise<string | null> {
    this.getCalls++;

    if (this.failReads) {
      throw new Error("read failed");
    }

    return this.store.get(key)?.value ?? null;
  }

  public async set(
    key: string,
    value: string,
    _mode: string,
    ttl: number,
  ): Promise<string> {
    this.setCalls++;

    if (this.failWrites) {
      throw new Error("write failed");
    }

    this.store.set(key, { value, ttl });

    return "OK";
  }

  public keys(): Array<string> {
    return Array.from(this.store.keys());
  }

  public keysWithPrefix(prefix: string): Array<string> {
    return this.keys().filter((key: string) => {
      return key.startsWith(
        `${ON_CALL_CALENDAR_FEED_CACHE_NAMESPACE}-${prefix}`,
      );
    });
  }
}

const PROJECT_A: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_B: string = "22222222-2222-4222-8222-222222222222";
const USER_1: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_2: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SCHEDULE_X: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SCHEDULE_Y: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function body(text: string): CachedCalendarBody {
  return {
    body: `BEGIN:VCALENDAR\r\n${text}\r\nEND:VCALENDAR\r\n`,
    etag: `"${text}"`,
    lastModified: new Date("2026-08-30T10:11:12.000Z"),
  };
}

describe("OnCallCalendarFeedCache", () => {
  let redis: FakeRedis;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = new FakeRedis();
    getClientMock.mockReturnValue(redis);
    isConnectedMock.mockReturnValue(true);
    OnCallCalendarFeedCache.clearInProcessState();
  });

  afterEach(() => {
    OnCallCalendarFeedCache.clearInProcessState();
  });

  // -- Schedule segments -------------------------------------------------

  describe("getOrRenderScheduleSegments", () => {
    const render: () => Promise<
      Array<{ start: string; user: string }>
    > = async () => {
      return [{ start: "2026-09-01T00:00:00.000Z", user: USER_1 }];
    };

    it("renders on a miss and returns the rendered value", async () => {
      const renderFn: MockedFn = jest.fn(render);

      const result: unknown =
        await OnCallCalendarFeedCache.getOrRenderScheduleSegments({
          scheduleId: SCHEDULE_X,
          key: "v1:day1:2:90",
          ttlSeconds: 3600,
          render: renderFn as unknown as () => Promise<unknown>,
        });

      expect(result).toEqual(await render());
      expect(renderFn).toHaveBeenCalledTimes(1);
    });

    it("serves the second read from Redis without rendering again", async () => {
      const renderFn: MockedFn = jest.fn(render);

      const read: () => Promise<unknown> = () => {
        return OnCallCalendarFeedCache.getOrRenderScheduleSegments({
          scheduleId: SCHEDULE_X,
          key: "v1:day1:2:90",
          ttlSeconds: 3600,
          render: renderFn as unknown as () => Promise<unknown>,
        });
      };

      const first: unknown = await read();
      const second: unknown = await read();

      expect(second).toEqual(first);
      expect(renderFn).toHaveBeenCalledTimes(1);
    });

    it("stores the segments under the namespace with the requested TTL", async () => {
      await OnCallCalendarFeedCache.getOrRenderScheduleSegments({
        scheduleId: SCHEDULE_X,
        key: "v1",
        ttlSeconds: 3600,
        render,
      });

      const keys: Array<string> = redis.keysWithPrefix("seg:");

      expect(keys).toHaveLength(1);
      expect(redis.store.get(keys[0]!)?.ttl).toBe(3600);
    });

    it("keys on the caller's key, so a different window is a different entry", async () => {
      const renderFn: MockedFn = jest.fn(render);

      for (const key of ["v1:day1", "v1:day2", "v2:day1"]) {
        await OnCallCalendarFeedCache.getOrRenderScheduleSegments({
          scheduleId: SCHEDULE_X,
          key,
          ttlSeconds: 3600,
          render: renderFn as unknown as () => Promise<unknown>,
        });
      }

      expect(renderFn).toHaveBeenCalledTimes(3);
      expect(redis.keysWithPrefix("seg:")).toHaveLength(3);
    });

    it("keys on the schedule, so two schedules with the same key do not collide", async () => {
      const first: unknown =
        await OnCallCalendarFeedCache.getOrRenderScheduleSegments({
          scheduleId: SCHEDULE_X,
          key: "same",
          ttlSeconds: 3600,
          render: async () => {
            return "x";
          },
        });
      const second: unknown =
        await OnCallCalendarFeedCache.getOrRenderScheduleSegments({
          scheduleId: SCHEDULE_Y,
          key: "same",
          ttlSeconds: 3600,
          render: async () => {
            return "y";
          },
        });

      expect(first).toBe("x");
      expect(second).toBe("y");
    });

    it("never puts the raw key or schedule id into the Redis key", async () => {
      await OnCallCalendarFeedCache.getOrRenderScheduleSegments({
        scheduleId: SCHEDULE_X,
        key: "secret-ish:v1",
        ttlSeconds: 3600,
        render,
      });

      for (const key of redis.keysWithPrefix("seg:")) {
        expect(key).not.toContain("secret-ish");
        expect(key).not.toContain(SCHEDULE_X);
      }
    });

    it("re-renders after purgeForSchedule for that schedule", async () => {
      const renderFn: MockedFn = jest.fn(render);

      const read: () => Promise<unknown> = () => {
        return OnCallCalendarFeedCache.getOrRenderScheduleSegments({
          scheduleId: SCHEDULE_X,
          key: "v1",
          ttlSeconds: 3600,
          render: renderFn as unknown as () => Promise<unknown>,
        });
      };

      await read();
      await OnCallCalendarFeedCache.purgeForSchedule(SCHEDULE_X);
      await read();

      expect(renderFn).toHaveBeenCalledTimes(2);
    });

    it("is not purged by purgeForSchedule on a different schedule", async () => {
      const renderFn: MockedFn = jest.fn(render);

      const read: () => Promise<unknown> = () => {
        return OnCallCalendarFeedCache.getOrRenderScheduleSegments({
          scheduleId: SCHEDULE_X,
          key: "v1",
          ttlSeconds: 3600,
          render: renderFn as unknown as () => Promise<unknown>,
        });
      };

      await read();
      await OnCallCalendarFeedCache.purgeForSchedule(SCHEDULE_Y);
      await read();

      expect(renderFn).toHaveBeenCalledTimes(1);
    });

    it("does not cache and propagates the error when the render throws", async () => {
      const failing: () => Promise<unknown> = async () => {
        throw new Error("iteration cap");
      };

      await expect(
        OnCallCalendarFeedCache.getOrRenderScheduleSegments({
          scheduleId: SCHEDULE_X,
          key: "v1",
          ttlSeconds: 3600,
          render: failing,
        }),
      ).rejects.toThrow("iteration cap");

      expect(redis.keysWithPrefix("seg:")).toHaveLength(0);

      /* And a later successful render is not blocked by the failed one. */
      const renderFn: MockedFn = jest.fn(render);

      await OnCallCalendarFeedCache.getOrRenderScheduleSegments({
        scheduleId: SCHEDULE_X,
        key: "v1",
        ttlSeconds: 3600,
        render: renderFn as unknown as () => Promise<unknown>,
      });

      expect(renderFn).toHaveBeenCalledTimes(1);
    });

    it("treats a corrupt cached entry as a miss and re-renders", async () => {
      await OnCallCalendarFeedCache.getOrRenderScheduleSegments({
        scheduleId: SCHEDULE_X,
        key: "v1",
        ttlSeconds: 3600,
        render,
      });

      const [key] = redis.keysWithPrefix("seg:");
      redis.store.set(key!, { value: "{not json", ttl: 3600 });

      const renderFn: MockedFn = jest.fn(render);

      const result: unknown =
        await OnCallCalendarFeedCache.getOrRenderScheduleSegments({
          scheduleId: SCHEDULE_X,
          key: "v1",
          ttlSeconds: 3600,
          render: renderFn as unknown as () => Promise<unknown>,
        });

      expect(result).toEqual(await render());
      expect(renderFn).toHaveBeenCalledTimes(1);
    });

    it("shares one in-flight render between concurrent misses for the same key", async () => {
      let resolveRender: (value: unknown) => void = () => {};
      let renderCalls: number = 0;

      const slowRender: () => Promise<unknown> = () => {
        renderCalls++;
        return new Promise<unknown>((resolve: (value: unknown) => void) => {
          resolveRender = resolve;
        });
      };

      const read: () => Promise<unknown> = () => {
        return OnCallCalendarFeedCache.getOrRenderScheduleSegments({
          scheduleId: SCHEDULE_X,
          key: "v1",
          ttlSeconds: 3600,
          render: slowRender,
        });
      };

      const first: Promise<unknown> = read();
      const second: Promise<unknown> = read();
      const third: Promise<unknown> = read();

      /* Let both reads get past their cache miss and register the in-flight. */
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      resolveRender(["shared"]);

      expect(await first).toEqual(["shared"]);
      expect(await second).toEqual(["shared"]);
      expect(await third).toEqual(["shared"]);
      expect(renderCalls).toBe(1);
    });

    it("hands back plain JSON, so a Date in the rendered value comes back as a string", async () => {
      const withDate: () => Promise<{ at: Date }> = async () => {
        return { at: new Date("2026-09-01T00:00:00.000Z") };
      };

      await OnCallCalendarFeedCache.getOrRenderScheduleSegments({
        scheduleId: SCHEDULE_X,
        key: "v1",
        ttlSeconds: 3600,
        render: withDate,
      });

      const cached: { at: unknown } =
        await OnCallCalendarFeedCache.getOrRenderScheduleSegments({
          scheduleId: SCHEDULE_X,
          key: "v1",
          ttlSeconds: 3600,
          render: withDate,
        });

      expect(cached.at).toBe("2026-09-01T00:00:00.000Z");
    });
  });

  // -- Batched schedule segments -----------------------------------------

  /*
   * A feed render reads EVERY schedule it depends on. Reading them one at a
   * time meant one resolver call per schedule -- seven queries each, the same
   * user and project rows re-read every time -- so the batch exists to make
   * one call for every schedule that missed.
   */
  describe("getOrRenderScheduleSegmentsBatch", () => {
    function segmentsFor(ids: Array<string>): Map<string, { id: string }> {
      const out: Map<string, { id: string }> = new Map();

      for (const id of ids) {
        out.set(id, { id });
      }

      return out;
    }

    it("renders every miss in ONE call and caches each under its own key", async () => {
      const renderMissing: MockedFn = jest.fn(
        async (missing: Array<{ scheduleId: string; key: string }>) => {
          return segmentsFor(
            missing.map((entry: { scheduleId: string }) => {
              return entry.scheduleId;
            }),
          );
        },
      );

      const first: Map<string, { id: string }> =
        (await OnCallCalendarFeedCache.getOrRenderScheduleSegmentsBatch({
          entries: [
            { scheduleId: SCHEDULE_X, key: "v1" },
            { scheduleId: SCHEDULE_Y, key: "v1" },
          ],
          ttlSeconds: 3600,
          renderMissing: renderMissing as never,
        })) as Map<string, { id: string }>;

      expect(renderMissing).toHaveBeenCalledTimes(1);
      expect(
        (renderMissing.mock.calls[0]?.[0] as Array<{ scheduleId: string }>).map(
          (entry: { scheduleId: string }) => {
            return entry.scheduleId;
          },
        ),
      ).toEqual([SCHEDULE_X, SCHEDULE_Y]);
      expect(first.get(SCHEDULE_X)).toEqual({ id: SCHEDULE_X });
      expect(first.get(SCHEDULE_Y)).toEqual({ id: SCHEDULE_Y });
      expect(redis.keysWithPrefix("seg:")).toHaveLength(2);

      /* Both are hits now, so renderMissing is not called again at all. */
      const second: Map<string, { id: string }> =
        (await OnCallCalendarFeedCache.getOrRenderScheduleSegmentsBatch({
          entries: [
            { scheduleId: SCHEDULE_X, key: "v1" },
            { scheduleId: SCHEDULE_Y, key: "v1" },
          ],
          ttlSeconds: 3600,
          renderMissing: renderMissing as never,
        })) as Map<string, { id: string }>;

      expect(renderMissing).toHaveBeenCalledTimes(1);
      expect(second.get(SCHEDULE_Y)).toEqual({ id: SCHEDULE_Y });
    });

    it("asks only for the schedules that missed", async () => {
      const renderMissing: MockedFn = jest.fn(
        async (missing: Array<{ scheduleId: string; key: string }>) => {
          return segmentsFor(
            missing.map((entry: { scheduleId: string }) => {
              return entry.scheduleId;
            }),
          );
        },
      );

      await OnCallCalendarFeedCache.getOrRenderScheduleSegmentsBatch({
        entries: [{ scheduleId: SCHEDULE_X, key: "v1" }],
        ttlSeconds: 3600,
        renderMissing: renderMissing as never,
      });

      await OnCallCalendarFeedCache.getOrRenderScheduleSegmentsBatch({
        entries: [
          { scheduleId: SCHEDULE_X, key: "v1" },
          { scheduleId: SCHEDULE_Y, key: "v1" },
        ],
        ttlSeconds: 3600,
        renderMissing: renderMissing as never,
      });

      expect(
        (renderMissing.mock.calls[1]?.[0] as Array<{ scheduleId: string }>).map(
          (entry: { scheduleId: string }) => {
            return entry.scheduleId;
          },
        ),
      ).toEqual([SCHEDULE_Y]);
    });

    it("a repeated schedule id is one read and one render", async () => {
      const renderMissing: MockedFn = jest.fn(
        async (missing: Array<{ scheduleId: string }>) => {
          return segmentsFor(
            missing.map((entry: { scheduleId: string }) => {
              return entry.scheduleId;
            }),
          );
        },
      );

      await OnCallCalendarFeedCache.getOrRenderScheduleSegmentsBatch({
        entries: [
          { scheduleId: SCHEDULE_X, key: "v1" },
          { scheduleId: SCHEDULE_X, key: "v1" },
        ],
        ttlSeconds: 3600,
        renderMissing: renderMissing as never,
      });

      expect(renderMissing.mock.calls[0]?.[0] as Array<unknown>).toHaveLength(
        1,
      );
    });

    it("joins a render another caller already has in flight", async () => {
      let release: (value: unknown) => void = () => {};
      let calls: number = 0;

      const slow: MockedFn = jest.fn(
        async (missing: Array<{ scheduleId: string }>) => {
          calls++;

          await new Promise<unknown>((resolve: (value: unknown) => void) => {
            release = resolve;
          });

          return segmentsFor(
            missing.map((entry: { scheduleId: string }) => {
              return entry.scheduleId;
            }),
          );
        },
      );

      const read: () => Promise<unknown> = () => {
        return OnCallCalendarFeedCache.getOrRenderScheduleSegmentsBatch({
          entries: [{ scheduleId: SCHEDULE_X, key: "v1" }],
          ttlSeconds: 3600,
          renderMissing: slow as never,
        });
      };

      const a: Promise<unknown> = read();
      const b: Promise<unknown> = read();

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      release(undefined);

      expect(
        ((await a) as Map<string, { id: string }>).get(SCHEDULE_X),
      ).toEqual({ id: SCHEDULE_X });
      expect(
        ((await b) as Map<string, { id: string }>).get(SCHEDULE_X),
      ).toEqual({ id: SCHEDULE_X });
      expect(calls).toBe(1);
    });

    it("propagates a failure to every caller and caches nothing", async () => {
      const failing: MockedFn = jest.fn(async () => {
        throw new Error("resolver exploded");
      });

      await expect(
        OnCallCalendarFeedCache.getOrRenderScheduleSegmentsBatch({
          entries: [
            { scheduleId: SCHEDULE_X, key: "v1" },
            { scheduleId: SCHEDULE_Y, key: "v1" },
          ],
          ttlSeconds: 3600,
          renderMissing: failing as never,
        }),
      ).rejects.toThrow("resolver exploded");

      expect(redis.keysWithPrefix("seg:")).toHaveLength(0);
    });

    /*
     * A schedule's segments carry every user's shifts over the window. An
     * hourly rotation over the widest window is megabytes, and the compose
     * Redis has no maxmemory: the value is returned to the caller, it is just
     * not stored.
     */
    it("returns but does not store a segment over the size cap", async () => {
      const huge: MockedFn = jest.fn(async () => {
        return new Map<string, { blob: string }>([
          [SCHEDULE_X, { blob: "x".repeat(MAX_CACHED_SEGMENT_BYTES + 1) }],
        ]);
      });

      const result: Map<string, { blob: string }> =
        (await OnCallCalendarFeedCache.getOrRenderScheduleSegmentsBatch({
          entries: [{ scheduleId: SCHEDULE_X, key: "v1" }],
          ttlSeconds: 3600,
          renderMissing: huge as never,
        })) as Map<string, { blob: string }>;

      expect(result.get(SCHEDULE_X)?.blob).toHaveLength(
        MAX_CACHED_SEGMENT_BYTES + 1,
      );
      expect(redis.keysWithPrefix("seg:")).toHaveLength(0);
    });
  });

  // -- Body cache ---------------------------------------------------------

  describe("body cache", () => {
    const scope: OnCallCalendarFeedCacheScope = {
      projectId: PROJECT_A,
      userId: USER_1,
      scheduleIds: [SCHEDULE_X, SCHEDULE_Y],
    };

    it("returns null on a miss", async () => {
      expect(
        await OnCallCalendarFeedCache.getBody({ key: "tokenhash:day1", scope }),
      ).toBeNull();
    });

    it("round-trips a body with its ETag and Last-Modified as a Date", async () => {
      const stored: boolean = await OnCallCalendarFeedCache.setBody({
        key: "tokenhash:day1",
        scope,
        value: body("personal"),
        ttlSeconds: 300,
      });

      expect(stored).toBe(true);

      const cached: CachedCalendarBody | null =
        await OnCallCalendarFeedCache.getBody({ key: "tokenhash:day1", scope });

      expect(cached).not.toBeNull();
      expect(cached?.body).toBe(body("personal").body);
      expect(cached?.etag).toBe('"personal"');
      expect(cached?.lastModified).toBeInstanceOf(Date);
      expect(cached?.lastModified.toISOString()).toBe(
        "2026-08-30T10:11:12.000Z",
      );
    });

    it("stores the body with the requested TTL", async () => {
      await OnCallCalendarFeedCache.setBody({
        key: "k",
        scope,
        value: body("x"),
        ttlSeconds: 300,
      });

      const keys: Array<string> = redis.keysWithPrefix("body:");

      expect(keys).toHaveLength(1);
      expect(redis.store.get(keys[0]!)?.ttl).toBe(300);
    });

    it("never puts the caller's key (which carries the token hash) into the Redis key", async () => {
      await OnCallCalendarFeedCache.setBody({
        key: "deadbeefcafe:day1",
        scope,
        value: body("x"),
        ttlSeconds: 300,
      });

      for (const key of redis.keysWithPrefix("body:")) {
        expect(key).not.toContain("deadbeefcafe");
      }
    });

    it("keeps different keys apart", async () => {
      await OnCallCalendarFeedCache.setBody({
        key: "one",
        scope,
        value: body("one"),
        ttlSeconds: 300,
      });
      await OnCallCalendarFeedCache.setBody({
        key: "two",
        scope,
        value: body("two"),
        ttlSeconds: 300,
      });

      expect(
        (await OnCallCalendarFeedCache.getBody({ key: "one", scope }))?.etag,
      ).toBe('"one"');
      expect(
        (await OnCallCalendarFeedCache.getBody({ key: "two", scope }))?.etag,
      ).toBe('"two"');
    });

    it("refuses to cache a body over the size cap, without throwing", async () => {
      const huge: CachedCalendarBody = {
        ...body("huge"),
        body: "x".repeat(MAX_CACHED_BODY_BYTES + 1),
      };

      const stored: boolean = await OnCallCalendarFeedCache.setBody({
        key: "k",
        scope,
        value: huge,
        ttlSeconds: 300,
      });

      expect(stored).toBe(false);
      expect(redis.keysWithPrefix("body:")).toHaveLength(0);
      expect(await OnCallCalendarFeedCache.getBody({ key: "k", scope })).toBe(
        null,
      );
    });

    it("measures the cap in bytes, not characters", async () => {
      /* Two-byte characters: half the cap in characters is over it in bytes. */
      const twoByte: CachedCalendarBody = {
        ...body("bytes"),
        body: "Å".repeat(MAX_CACHED_BODY_BYTES / 2 + 1),
      };

      expect(
        await OnCallCalendarFeedCache.setBody({
          key: "k",
          scope,
          value: twoByte,
          ttlSeconds: 300,
        }),
      ).toBe(false);
    });

    it("caches a body exactly at the cap", async () => {
      const atCap: CachedCalendarBody = {
        ...body("cap"),
        body: "x".repeat(MAX_CACHED_BODY_BYTES),
      };

      expect(
        await OnCallCalendarFeedCache.setBody({
          key: "k",
          scope,
          value: atCap,
          ttlSeconds: 300,
        }),
      ).toBe(true);
    });

    it("treats a corrupt cached body as a miss", async () => {
      await OnCallCalendarFeedCache.setBody({
        key: "k",
        scope,
        value: body("x"),
        ttlSeconds: 300,
      });

      const [key] = redis.keysWithPrefix("body:");

      for (const corrupt of [
        "{not json",
        JSON.stringify({ body: "x" }),
        JSON.stringify({ body: "x", etag: 1, lastModified: "2026-01-01" }),
        JSON.stringify({ body: "x", etag: "e", lastModified: "not a date" }),
        JSON.stringify([]),
        "null",
      ]) {
        redis.store.set(key!, { value: corrupt, ttl: 300 });

        expect(
          await OnCallCalendarFeedCache.getBody({ key: "k", scope }),
        ).toBeNull();
      }
    });

    it("orders schedule ids canonically, so the same set in a different order is one entry", async () => {
      await OnCallCalendarFeedCache.setBody({
        key: "k",
        scope: {
          projectId: PROJECT_A,
          userId: USER_1,
          scheduleIds: [SCHEDULE_X, SCHEDULE_Y, SCHEDULE_X],
        },
        value: body("x"),
        ttlSeconds: 300,
      });

      const cached: CachedCalendarBody | null =
        await OnCallCalendarFeedCache.getBody({
          key: "k",
          scope: {
            projectId: PROJECT_A,
            userId: USER_1,
            scheduleIds: [SCHEDULE_Y, SCHEDULE_X],
          },
        });

      expect(cached?.etag).toBe('"x"');
    });
  });

  // -- Purges -------------------------------------------------------------

  describe("purges", () => {
    const personalFeedOfUser1: OnCallCalendarFeedCacheScope = {
      projectId: PROJECT_A,
      userId: USER_1,
      scheduleIds: [SCHEDULE_X],
    };
    const personalFeedOfUser2: OnCallCalendarFeedCacheScope = {
      projectId: PROJECT_A,
      userId: USER_2,
      scheduleIds: [SCHEDULE_X, SCHEDULE_Y],
    };
    const scheduleFeedY: OnCallCalendarFeedCacheScope = {
      projectId: PROJECT_A,
      scheduleIds: [SCHEDULE_Y],
    };
    const projectFeedA: OnCallCalendarFeedCacheScope = {
      projectId: PROJECT_A,
      scheduleIds: [SCHEDULE_X, SCHEDULE_Y],
    };
    const projectFeedB: OnCallCalendarFeedCacheScope = {
      projectId: PROJECT_B,
      scheduleIds: [],
    };

    const allFeeds: Array<{
      name: string;
      key: string;
      scope: OnCallCalendarFeedCacheScope;
    }> = [
      { name: "user1", key: "user1-token", scope: personalFeedOfUser1 },
      { name: "user2", key: "user2-token", scope: personalFeedOfUser2 },
      { name: "scheduleY", key: "scheduleY-token", scope: scheduleFeedY },
      { name: "projectA", key: "projectA-token", scope: projectFeedA },
      { name: "projectB", key: "projectB-token", scope: projectFeedB },
    ];

    async function fillAll(): Promise<void> {
      for (const feed of allFeeds) {
        await OnCallCalendarFeedCache.setBody({
          key: feed.key,
          scope: feed.scope,
          value: body(feed.name),
          ttlSeconds: 300,
        });
      }
    }

    async function survivors(): Promise<Array<string>> {
      const alive: Array<string> = [];

      for (const feed of allFeeds) {
        const cached: CachedCalendarBody | null =
          await OnCallCalendarFeedCache.getBody({
            key: feed.key,
            scope: feed.scope,
          });

        if (cached) {
          alive.push(feed.name);
        }
      }

      return alive;
    }

    it("purgeForUser drops that user's feed in that project and nothing else", async () => {
      await fillAll();

      await OnCallCalendarFeedCache.purgeForUser(PROJECT_A, USER_1);

      expect(await survivors()).toEqual([
        "user2",
        "scheduleY",
        "projectA",
        "projectB",
      ]);
    });

    it("purgeForUser is scoped to the project", async () => {
      await fillAll();

      await OnCallCalendarFeedCache.purgeForUser(PROJECT_B, USER_1);

      expect(await survivors()).toEqual([
        "user1",
        "user2",
        "scheduleY",
        "projectA",
        "projectB",
      ]);
    });

    it("purgeForSchedule drops every feed rendered from that schedule", async () => {
      await fillAll();

      await OnCallCalendarFeedCache.purgeForSchedule(SCHEDULE_Y);

      /* user1 does not depend on Y; projectB is another project. */
      expect(await survivors()).toEqual(["user1", "projectB"]);
    });

    it("purgeForSchedule on a schedule nobody depends on drops nothing", async () => {
      await fillAll();

      await OnCallCalendarFeedCache.purgeForSchedule(
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      );

      expect(await survivors()).toHaveLength(allFeeds.length);
    });

    it("purgeForProject drops every feed in the project and no other project's", async () => {
      await fillAll();

      await OnCallCalendarFeedCache.purgeForProject(PROJECT_A);

      expect(await survivors()).toEqual(["projectB"]);
    });

    it("a purged feed can be re-cached and read again", async () => {
      await fillAll();
      await OnCallCalendarFeedCache.purgeForUser(PROJECT_A, USER_1);

      await OnCallCalendarFeedCache.setBody({
        key: "user1-token",
        scope: personalFeedOfUser1,
        value: body("user1-v2"),
        ttlSeconds: 300,
      });

      expect(
        (
          await OnCallCalendarFeedCache.getBody({
            key: "user1-token",
            scope: personalFeedOfUser1,
          })
        )?.etag,
      ).toBe('"user1-v2"');
    });

    it("two purges in a row do not resurrect the first generation", async () => {
      await fillAll();

      await OnCallCalendarFeedCache.purgeForUser(PROJECT_A, USER_1);
      await OnCallCalendarFeedCache.purgeForUser(PROJECT_A, USER_1);

      expect(await survivors()).not.toContain("user1");
    });

    it("writes the generation with a TTL, so a deleted scope does not leak a key forever", async () => {
      await OnCallCalendarFeedCache.purgeForSchedule(SCHEDULE_X);

      const keys: Array<string> = redis.keysWithPrefix("gen:schedule:");

      expect(keys).toHaveLength(1);
      expect(redis.store.get(keys[0]!)?.ttl).toBeGreaterThan(
        LAST_GOOD_TTL_SECONDS,
      );
    });

    it("purges are visible to another process reading the same Redis", async () => {
      /*
       * The in-process generation memo must never mask a purge another
       * process made: simulate that by writing the generation straight into
       * Redis, bypassing this process's memory.
       */
      await fillAll();

      const [genKey] = redis.keysWithPrefix("gen:");
      expect(genKey).toBeUndefined();

      await OnCallCalendarFeedCache.setBody({
        key: "user1-token",
        scope: personalFeedOfUser1,
        value: body("user1"),
        ttlSeconds: 300,
      });

      redis.store.set(
        `${ON_CALL_CALENDAR_FEED_CACHE_NAMESPACE}-gen:user:${PROJECT_A}:${USER_1}`,
        { value: "other-process-bump", ttl: 100 },
      );

      expect(
        await OnCallCalendarFeedCache.getBody({
          key: "user1-token",
          scope: personalFeedOfUser1,
        }),
      ).toBeNull();
    });
  });

  // -- Last-good ----------------------------------------------------------

  describe("last-good", () => {
    it("returns null when nothing was ever stored", async () => {
      expect(await OnCallCalendarFeedCache.getLastGood("k")).toBeNull();
    });

    it("round-trips a body", async () => {
      expect(await OnCallCalendarFeedCache.setLastGood("k", body("good"))).toBe(
        true,
      );

      const cached: CachedCalendarBody | null =
        await OnCallCalendarFeedCache.getLastGood("k");

      expect(cached?.etag).toBe('"good"');
      expect(cached?.lastModified.toISOString()).toBe(
        "2026-08-30T10:11:12.000Z",
      );
    });

    it("is kept for a day", async () => {
      await OnCallCalendarFeedCache.setLastGood("k", body("good"));

      const keys: Array<string> = redis.keysWithPrefix("lastgood:");

      expect(keys).toHaveLength(1);
      expect(redis.store.get(keys[0]!)?.ttl).toBe(LAST_GOOD_TTL_SECONDS);
      expect(LAST_GOOD_TTL_SECONDS).toBe(24 * 60 * 60);
    });

    it("is stored apart from the fresh body under the same key", async () => {
      const scope: OnCallCalendarFeedCacheScope = { projectId: PROJECT_A };

      await OnCallCalendarFeedCache.setBody({
        key: "k",
        scope,
        value: body("fresh"),
        ttlSeconds: 300,
      });
      await OnCallCalendarFeedCache.setLastGood("k", body("good"));

      expect(
        (await OnCallCalendarFeedCache.getBody({ key: "k", scope }))?.etag,
      ).toBe('"fresh"');
      expect((await OnCallCalendarFeedCache.getLastGood("k"))?.etag).toBe(
        '"good"',
      );
    });

    /*
     * The stale-while-error tier exists for the moment a render FAILS, and a
     * hook purge is one of the things that precedes a render. Its key embeds
     * the feed's own key (token hash + candidate set), so nothing a purge
     * protects against can reach it.
     */
    it("survives every kind of purge", async () => {
      await OnCallCalendarFeedCache.setLastGood("k", body("good"));

      await OnCallCalendarFeedCache.purgeForUser(PROJECT_A, USER_1);
      await OnCallCalendarFeedCache.purgeForSchedule(SCHEDULE_X);
      await OnCallCalendarFeedCache.purgeForProject(PROJECT_A);

      expect((await OnCallCalendarFeedCache.getLastGood("k"))?.etag).toBe(
        '"good"',
      );
    });

    it("refuses a body over its own, larger size cap", async () => {
      expect(
        await OnCallCalendarFeedCache.setLastGood("k", {
          ...body("huge"),
          body: "x".repeat(MAX_CACHED_LAST_GOOD_BYTES + 1),
        }),
      ).toBe(false);
      expect(await OnCallCalendarFeedCache.getLastGood("k")).toBeNull();
    });

    /*
     * Regression: the last-good tier used to share the body cache's 2 MiB
     * cap. A VEVENT is roughly 0.9 KB, so that cap is crossed at about 2,200
     * events -- less than half of MAX_EVENTS -- and the feeds that cross it
     * are the expensive ones, the ones most likely to trip the render cap and
     * need a stale body. Refusing to keep one meant those feeds answered 503
     * instead, which is exactly what this tier exists to prevent.
     */
    it("keeps a body that the body cache is too small for", async () => {
      const big: string = "x".repeat(MAX_CACHED_BODY_BYTES + 1);

      expect(MAX_CACHED_LAST_GOOD_BYTES).toBeGreaterThan(MAX_CACHED_BODY_BYTES);

      expect(
        await OnCallCalendarFeedCache.setBody({
          key: "k",
          scope: { projectId: PROJECT_A },
          value: { ...body("big"), body: big },
          ttlSeconds: 300,
        }),
      ).toBe(false);

      expect(
        await OnCallCalendarFeedCache.setLastGood("k", {
          ...body("big"),
          body: big,
        }),
      ).toBe(true);

      expect((await OnCallCalendarFeedCache.getLastGood("k"))?.body).toBe(big);
    });

    it("never puts the caller's key into the Redis key", async () => {
      await OnCallCalendarFeedCache.setLastGood("deadbeefcafe", body("x"));

      for (const key of redis.keysWithPrefix("lastgood:")) {
        expect(key).not.toContain("deadbeefcafe");
      }
    });
  });

  // -- Redis down ---------------------------------------------------------

  describe("when Redis is unavailable", () => {
    const scope: OnCallCalendarFeedCacheScope = {
      projectId: PROJECT_A,
      userId: USER_1,
      scheduleIds: [SCHEDULE_X],
    };

    const scenarios: Array<{ name: string; arrange: () => void }> = [
      {
        name: "not connected",
        arrange: (): void => {
          isConnectedMock.mockReturnValue(false);
        },
      },
      {
        name: "no client",
        arrange: (): void => {
          getClientMock.mockReturnValue(null);
        },
      },
      {
        name: "commands throwing",
        arrange: (): void => {
          redis.failReads = true;
          redis.failWrites = true;
        },
      },
    ];

    for (const scenario of scenarios) {
      describe(scenario.name, () => {
        beforeEach(() => {
          scenario.arrange();
        });

        it("still renders and caches segments in process", async () => {
          const renderFn: MockedFn = jest.fn(async () => {
            return ["seg"];
          });

          const read: () => Promise<unknown> = () => {
            return OnCallCalendarFeedCache.getOrRenderScheduleSegments({
              scheduleId: SCHEDULE_X,
              key: "v1",
              ttlSeconds: 3600,
              render: renderFn as unknown as () => Promise<unknown>,
            });
          };

          expect(await read()).toEqual(["seg"]);
          expect(await read()).toEqual(["seg"]);
          expect(renderFn).toHaveBeenCalledTimes(1);
        });

        it("still stores and reads bodies in process", async () => {
          expect(
            await OnCallCalendarFeedCache.setBody({
              key: "k",
              scope,
              value: body("x"),
              ttlSeconds: 300,
            }),
          ).toBe(true);

          expect(
            (await OnCallCalendarFeedCache.getBody({ key: "k", scope }))?.etag,
          ).toBe('"x"');
        });

        it("still stores and reads last-good in process", async () => {
          await OnCallCalendarFeedCache.setLastGood("k", body("good"));

          expect((await OnCallCalendarFeedCache.getLastGood("k"))?.etag).toBe(
            '"good"',
          );
        });

        it("purges still take effect in this process", async () => {
          await OnCallCalendarFeedCache.setBody({
            key: "k",
            scope,
            value: body("x"),
            ttlSeconds: 300,
          });

          await OnCallCalendarFeedCache.purgeForUser(PROJECT_A, USER_1);

          expect(
            await OnCallCalendarFeedCache.getBody({ key: "k", scope }),
          ).toBeNull();
        });

        it("segment purges still take effect in this process", async () => {
          const renderFn: MockedFn = jest.fn(async () => {
            return ["seg"];
          });

          const read: () => Promise<unknown> = () => {
            return OnCallCalendarFeedCache.getOrRenderScheduleSegments({
              scheduleId: SCHEDULE_X,
              key: "v1",
              ttlSeconds: 3600,
              render: renderFn as unknown as () => Promise<unknown>,
            });
          };

          await read();
          await OnCallCalendarFeedCache.purgeForSchedule(SCHEDULE_X);
          await read();

          expect(renderFn).toHaveBeenCalledTimes(2);
        });

        it("never throws from any operation", async () => {
          await expect(
            OnCallCalendarFeedCache.getBody({ key: "k", scope }),
          ).resolves.toBeNull();
          await expect(
            OnCallCalendarFeedCache.setBody({
              key: "k",
              scope,
              value: body("x"),
              ttlSeconds: 300,
            }),
          ).resolves.toBe(true);
          await expect(
            OnCallCalendarFeedCache.getLastGood("k"),
          ).resolves.toBeDefined();
          await expect(
            OnCallCalendarFeedCache.setLastGood("k", body("x")),
          ).resolves.toBe(true);
          await expect(
            OnCallCalendarFeedCache.purgeForUser(PROJECT_A, USER_1),
          ).resolves.toBeUndefined();
          await expect(
            OnCallCalendarFeedCache.purgeForSchedule(SCHEDULE_X),
          ).resolves.toBeUndefined();
          await expect(
            OnCallCalendarFeedCache.purgeForProject(PROJECT_A),
          ).resolves.toBeUndefined();
        });

        it("logs at debug only, never warn or error, so an outage does not flood the log", async () => {
          for (let i: number = 0; i < 20; i++) {
            await OnCallCalendarFeedCache.getBody({ key: `k${i}`, scope });
          }

          expect(loggerWarnMock).not.toHaveBeenCalled();
          expect(loggerErrorMock).not.toHaveBeenCalled();
        });
      });
    }

    /*
     * Regression: the in-process tiers were bounded by entry count only (500).
     * What they hold during an outage is whole calendar bodies and whole
     * schedule expansions -- megabytes each -- so 500 entries was hundreds of
     * megabytes of retained strings on the API tier. Nothing reads a fallback
     * tier once Redis is healthy again, so expired entries were never swept
     * either: they stayed resident until 500 newer writes pushed them out.
     */
    it("bounds the in-process fallback by bytes, not just by entry count", async () => {
      isConnectedMock.mockReturnValue(false);

      const chunk: string = "x".repeat(4 * 1024 * 1024);

      for (let i: number = 0; i < 12; i++) {
        await OnCallCalendarFeedCache.setLastGood(`big-${i}`, {
          ...body("x"),
          body: chunk,
        });
      }

      expect(OnCallCalendarFeedCache.getInProcessBytes()).toBeLessThanOrEqual(
        MEMORY_MAX_BYTES,
      );

      /* The newest write survived; the oldest were evicted to make room. */
      expect(
        (await OnCallCalendarFeedCache.getLastGood("big-11"))?.body.length,
      ).toBe(chunk.length);
      expect(await OnCallCalendarFeedCache.getLastGood("big-0")).toBeNull();
    });

    it("drops an entry whose TTL has passed instead of holding it for 500 writes", async () => {
      isConnectedMock.mockReturnValue(false);

      await OnCallCalendarFeedCache.setBody({
        key: "short",
        scope,
        value: body("short"),
        ttlSeconds: 1,
      });

      expect(OnCallCalendarFeedCache.getInProcessBytes()).toBeGreaterThan(0);

      const realNow: () => number = Date.now;

      try {
        Date.now = (): number => {
          return realNow() + 5000;
        };

        /* Any write is enough to make the store reclaim what has expired. */
        await OnCallCalendarFeedCache.setBody({
          key: "next",
          scope,
          value: body("next"),
          ttlSeconds: 300,
        });

        expect(
          await OnCallCalendarFeedCache.getBody({ key: "short", scope }),
        ).toBeNull();
      } finally {
        Date.now = realNow;
      }
    });

    it("a render that throws still propagates while Redis is down", async () => {
      isConnectedMock.mockReturnValue(false);

      await expect(
        OnCallCalendarFeedCache.getOrRenderScheduleSegments({
          scheduleId: SCHEDULE_X,
          key: "v1",
          ttlSeconds: 3600,
          render: async () => {
            throw new Error("boom");
          },
        }),
      ).rejects.toThrow("boom");
    });

    it("does not serve the in-process copy while Redis is healthy", async () => {
      /*
       * Fill the in-process tier during an outage, then bring Redis back
       * empty: the read must miss, because another process may have purged
       * in the meantime and this process's copy is not authoritative.
       */
      isConnectedMock.mockReturnValue(false);

      await OnCallCalendarFeedCache.setBody({
        key: "k",
        scope,
        value: body("during-outage"),
        ttlSeconds: 300,
      });

      isConnectedMock.mockReturnValue(true);

      expect(
        await OnCallCalendarFeedCache.getBody({ key: "k", scope }),
      ).toBeNull();
    });

    it("a write that fails after a successful read falls back without losing the value", async () => {
      redis.failWrites = true;

      await OnCallCalendarFeedCache.setBody({
        key: "k",
        scope,
        value: body("x"),
        ttlSeconds: 300,
      });

      /* Redis has it not; memory does; reads go to Redis first and miss. */
      expect(redis.keysWithPrefix("body:")).toHaveLength(0);

      redis.failReads = true;

      expect(
        (await OnCallCalendarFeedCache.getBody({ key: "k", scope }))?.etag,
      ).toBe('"x"');
    });
  });

  // -- Render slots -------------------------------------------------------

  describe("render slots", () => {
    it("defaults to four concurrent renders per process", () => {
      expect(DEFAULT_RENDER_CONCURRENCY).toBe(4);
      expect(OnCallCalendarFeedCache.getRenderConcurrency()).toBe(4);
    });

    it("grants slots up to the cap and refuses the next", () => {
      for (let i: number = 0; i < DEFAULT_RENDER_CONCURRENCY; i++) {
        expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(true);
      }

      expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(false);
      expect(OnCallCalendarFeedCache.getActiveRenderSlots()).toBe(
        DEFAULT_RENDER_CONCURRENCY,
      );
    });

    it("a release frees a slot", () => {
      for (let i: number = 0; i < DEFAULT_RENDER_CONCURRENCY; i++) {
        OnCallCalendarFeedCache.tryAcquireRenderSlot();
      }

      OnCallCalendarFeedCache.releaseRenderSlot();

      expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(true);
      expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(false);
    });

    it("a refused acquire does not consume a slot", () => {
      for (let i: number = 0; i < DEFAULT_RENDER_CONCURRENCY + 5; i++) {
        OnCallCalendarFeedCache.tryAcquireRenderSlot();
      }

      expect(OnCallCalendarFeedCache.getActiveRenderSlots()).toBe(
        DEFAULT_RENDER_CONCURRENCY,
      );
    });

    it("never goes below zero on an unbalanced release", () => {
      OnCallCalendarFeedCache.releaseRenderSlot();
      OnCallCalendarFeedCache.releaseRenderSlot();

      expect(OnCallCalendarFeedCache.getActiveRenderSlots()).toBe(0);

      for (let i: number = 0; i < DEFAULT_RENDER_CONCURRENCY; i++) {
        expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(true);
      }

      expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(false);
    });

    it("honours a configured concurrency", () => {
      OnCallCalendarFeedCache.configure({ renderConcurrency: 2 });

      expect(OnCallCalendarFeedCache.getRenderConcurrency()).toBe(2);
      expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(true);
      expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(true);
      expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(false);
    });

    it("ignores a concurrency that is not a positive integer", () => {
      for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        OnCallCalendarFeedCache.configure({ renderConcurrency: bad });

        expect(OnCallCalendarFeedCache.getRenderConcurrency()).toBe(
          DEFAULT_RENDER_CONCURRENCY,
        );
      }
    });

    it("is not Redis-backed, so the cap holds while Redis is down", () => {
      isConnectedMock.mockReturnValue(false);

      for (let i: number = 0; i < DEFAULT_RENDER_CONCURRENCY; i++) {
        expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(true);
      }

      expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(false);
      expect(redis.setCalls).toBe(0);
    });

    /*
     * Regression: /my-shifts (a session route whose caller can retry and
     * whose mobile client falls back to its roster list) used to be able to
     * take every slot, leaving the public feed routes -- whose callers are
     * calendar clients that answer a 503 by showing a stale or empty calendar
     * -- with none.
     */
    it("leaveFreeSlots keeps a caller out of the last slots", () => {
      expect(
        OnCallCalendarFeedCache.tryAcquireRenderSlot({ leaveFreeSlots: 2 }),
      ).toBe(true);
      expect(
        OnCallCalendarFeedCache.tryAcquireRenderSlot({ leaveFreeSlots: 2 }),
      ).toBe(true);
      expect(
        OnCallCalendarFeedCache.tryAcquireRenderSlot({ leaveFreeSlots: 2 }),
      ).toBe(false);

      /* The reserved slots are still there for a caller that reserves none. */
      expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(true);
      expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(true);
      expect(OnCallCalendarFeedCache.tryAcquireRenderSlot()).toBe(false);
    });

    it("leaveFreeSlots can never reserve every slot", () => {
      OnCallCalendarFeedCache.configure({ renderConcurrency: 1 });

      expect(
        OnCallCalendarFeedCache.tryAcquireRenderSlot({ leaveFreeSlots: 9 }),
      ).toBe(true);
      expect(
        OnCallCalendarFeedCache.tryAcquireRenderSlot({ leaveFreeSlots: 9 }),
      ).toBe(false);
    });

    it("ignores a negative or fractional reserve", () => {
      expect(
        OnCallCalendarFeedCache.tryAcquireRenderSlot({ leaveFreeSlots: -3 }),
      ).toBe(true);
      expect(
        OnCallCalendarFeedCache.tryAcquireRenderSlot({ leaveFreeSlots: 1.9 }),
      ).toBe(true);
      expect(
        OnCallCalendarFeedCache.tryAcquireRenderSlot({ leaveFreeSlots: 1.9 }),
      ).toBe(true);
      expect(
        OnCallCalendarFeedCache.tryAcquireRenderSlot({ leaveFreeSlots: 1.9 }),
      ).toBe(false);
    });

    it("clearInProcessState releases every slot and restores the default cap", () => {
      OnCallCalendarFeedCache.configure({ renderConcurrency: 1 });
      OnCallCalendarFeedCache.tryAcquireRenderSlot();

      OnCallCalendarFeedCache.clearInProcessState();

      expect(OnCallCalendarFeedCache.getActiveRenderSlots()).toBe(0);
      expect(OnCallCalendarFeedCache.getRenderConcurrency()).toBe(
        DEFAULT_RENDER_CONCURRENCY,
      );
    });
  });

  // -- Namespace ---------------------------------------------------------

  describe("namespace", () => {
    it("keeps every key under its own namespace", async () => {
      await OnCallCalendarFeedCache.setBody({
        key: "k",
        scope: { projectId: PROJECT_A },
        value: body("x"),
        ttlSeconds: 300,
      });
      await OnCallCalendarFeedCache.setLastGood("k", body("x"));
      await OnCallCalendarFeedCache.purgeForProject(PROJECT_A);
      await OnCallCalendarFeedCache.getOrRenderScheduleSegments({
        scheduleId: SCHEDULE_X,
        key: "v1",
        ttlSeconds: 60,
        render: async () => {
          return [];
        },
      });

      expect(redis.keys().length).toBeGreaterThan(0);

      for (const key of redis.keys()) {
        expect(
          key.startsWith(`${ON_CALL_CALENDAR_FEED_CACHE_NAMESPACE}-`),
        ).toBe(true);
      }
    });
  });
});
