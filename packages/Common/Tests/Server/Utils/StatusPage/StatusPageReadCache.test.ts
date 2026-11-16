import StatusPageOverviewCache, {
  STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE,
} from "../../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import StatusPageReadCache from "../../../../Server/Utils/StatusPage/StatusPageReadCache";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import FakeGlobalCacheStrings from "../../TestingUtils/Redis/FakeGlobalCacheStrings";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

jest.mock("../../../../Server/Utils/Logger");

/*
 * What a status page reads for every visitor - its rules of who may read
 * it, its SEO row, its settings, its lists - kept per process under the page
 * and its project's generation (StatusPageOverviewCache.getPageKey): hits,
 * misses, what takes a copy away here and in another pod, each page and
 * variant apart, never a page that does not exist, and the rules kept only
 * while Redis answers.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "74000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "74000000-0000-4000-8000-000000000002",
);
const PAGE_ID: ObjectID = new ObjectID("75000000-0000-4000-8000-000000000001");
const OTHER_PAGE_ID: ObjectID = new ObjectID(
  "75000000-0000-4000-8000-000000000002",
);

const TTL_MS: number = 15_000;

let redis: FakeGlobalCacheStrings;
let cacheNumber: number = 0;

function newCache(options?: {
  keepOnlyWhileShared?: boolean;
  shared?: boolean;
  maxBytes?: number;
  maxValueBytes?: number;
}): StatusPageReadCache<JSONObject | null> {
  cacheNumber++;

  return new StatusPageReadCache<JSONObject | null>({
    kind: `test-${cacheNumber}`,
    ttlMs: TTL_MS,
    maxEntries: 100,
    maxBytes: options?.maxBytes,
    maxValueBytes: options?.maxValueBytes,
    sizeOf: (value: JSONObject | null): number => {
      return JSON.stringify(value).length;
    },
    keepOnlyWhileShared: options?.keepOnlyWhileShared,
    shared: options?.shared
      ? {
          toJSON: (value: JSONObject | null): unknown => {
            return value;
          },
          fromJSON: (json: unknown): JSONObject | null => {
            return json as JSONObject | null;
          },
        }
      : undefined,
  });
}

// A read that answers a new value each time, counting its calls.
function counter(): Mock<() => Promise<JSONObject>> {
  let read: number = 0;

  return jest.fn(async (): Promise<JSONObject> => {
    read++;
    return { read: read };
  });
}

async function readFrom(
  cache: StatusPageReadCache<JSONObject | null>,
  read: () => Promise<JSONObject | null>,
  options?: {
    statusPageId?: ObjectID;
    projectId?: ObjectID | null;
    variant?: string;
  },
): Promise<JSONObject | null> {
  return await cache.getOrRead({
    statusPageId: options?.statusPageId || PAGE_ID,
    variant: options?.variant,
    readProjectId: async (): Promise<ObjectID | null> => {
      return options?.projectId === undefined ? PROJECT_ID : options.projectId;
    },
    read: read,
  });
}

function moveClock(ms: number): void {
  const now: number = Date.now() + ms;
  jest.spyOn(Date, "now").mockReturnValue(now);
}

// Another pod: its own memory, the same Redis.
function becomeAnotherPod(): void {
  StatusPageOverviewCache.clear();
  StatusPageReadCache.clearAll();
}

beforeEach(() => {
  StatusPageOverviewCache.clear();
  StatusPageReadCache.clearAll();
  redis = new FakeGlobalCacheStrings().install();
});

afterEach(() => {
  jest.restoreAllMocks();
  StatusPageOverviewCache.clear();
  StatusPageReadCache.clearAll();
});

describe("StatusPageReadCache.getOrRead", () => {
  test("keeps a page's read: a repeat request is the same object, read once", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache();
    const read: Mock<() => Promise<JSONObject>> = counter();

    const first: JSONObject | null = await readFrom(cache, read);
    const second: JSONObject | null = await readFrom(cache, read);

    expect(read).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  test("keeps a page that has no such thing (null) too", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache();
    const read: Mock<() => Promise<null>> = jest.fn(async () => {
      return null;
    });

    expect(await readFrom(cache, read)).toBeNull();
    expect(await readFrom(cache, read)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("keeps each page apart", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache();
    const read: Mock<() => Promise<JSONObject>> = counter();

    const page: JSONObject | null = await readFrom(cache, read);
    const otherPage: JSONObject | null = await readFrom(cache, read, {
      statusPageId: OTHER_PAGE_ID,
    });

    expect(page).toEqual({ read: 1 });
    expect(otherPage).toEqual({ read: 2 });
    expect(await readFrom(cache, read)).toBe(page);
    expect(await readFrom(cache, read, { statusPageId: OTHER_PAGE_ID })).toBe(
      otherPage,
    );
  });

  test("keeps each variant of a page apart: one is never served for the other", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache();
    const read: Mock<() => Promise<JSONObject>> = counter();

    const withCode: JSONObject | null = await readFrom(cache, read, {
      variant: "with-custom-code",
    });
    const withoutCode: JSONObject | null = await readFrom(cache, read, {
      variant: "without-custom-code",
    });

    expect(withCode).not.toBe(withoutCode);
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("keeps each cache apart: two kinds of read of one page", async () => {
    const seo: StatusPageReadCache<JSONObject | null> = newCache();
    const settings: StatusPageReadCache<JSONObject | null> = newCache();

    await readFrom(seo, async () => {
      return { kind: "seo" };
    });

    expect(
      await readFrom(settings, async () => {
        return { kind: "settings" };
      }),
    ).toEqual({ kind: "settings" });
  });

  test("a write that takes something off the page's project, or changes its settings, reads again at once", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache();
    const read: Mock<() => Promise<JSONObject>> = counter();

    await readFrom(cache, read);

    await StatusPageOverviewCache.afterUpdate({
      tableName: "StatusPage",
      rows: [{ projectId: PROJECT_ID.toString() }],
      written: { isPublicStatusPage: false },
    });

    expect(await readFrom(cache, read)).toEqual({ read: 2 });
  });

  test("a write to another project keeps the page's read", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache();
    const read: Mock<() => Promise<JSONObject>> = counter();

    await readFrom(cache, read);
    await StatusPageOverviewCache.forgetProjects([OTHER_PROJECT_ID]);

    expect(await readFrom(cache, read)).toEqual({ read: 1 });
  });

  test("a write that can only show more keeps it until it runs out", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache();
    const read: Mock<() => Promise<JSONObject>> = counter();

    await readFrom(cache, read);

    await StatusPageOverviewCache.afterUpdate({
      tableName: "Incident",
      rows: [{ projectId: PROJECT_ID.toString() }],
      written: { title: "A new title" },
    });

    expect(await readFrom(cache, read)).toEqual({ read: 1 });
  });

  test("a change made in another pod is seen here within SHARED_GENERATION_READ_TTL_MS", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache();
    const read: Mock<() => Promise<JSONObject>> = counter();

    await readFrom(cache, read);

    redis.setRaw(
      `${STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE}-generation-${PROJECT_ID.toString()}`,
      "changed-in-another-pod",
    );

    // Until this pod reads Redis again, it goes by the generation it read...
    expect(await readFrom(cache, read)).toEqual({ read: 1 });

    // ...which is within a second.
    moveClock(StatusPageOverviewCache.SHARED_GENERATION_READ_TTL_MS + 1);
    expect(await readFrom(cache, read)).toEqual({ read: 2 });
  });

  test("runs out after ttlMs from when the read started", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache();
    const read: Mock<() => Promise<JSONObject>> = counter();

    await readFrom(cache, read);

    moveClock(TTL_MS - 100);
    expect(await readFrom(cache, read)).toEqual({ read: 1 });

    moveClock(200);
    expect(await readFrom(cache, read)).toEqual({ read: 2 });
  });

  test("requests that miss together share one read", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache();
    const read: Mock<() => Promise<JSONObject>> = counter();

    const answers: Array<JSONObject | null> = await Promise.all([
      readFrom(cache, read),
      readFrom(cache, read),
      readFrom(cache, read),
    ]);

    expect(read).toHaveBeenCalledTimes(1);
    expect(answers[1]).toBe(answers[0]);
    expect(answers[2]).toBe(answers[0]);
  });

  test("a failed read is never kept: the next request reads again", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache();
    let calls: number = 0;
    const read: () => Promise<JSONObject> = async (): Promise<JSONObject> => {
      calls++;

      if (calls === 1) {
        throw new Error("Postgres is down");
      }

      return { calls: calls };
    };

    await expect(readFrom(cache, read)).rejects.toThrow("Postgres is down");
    expect(await readFrom(cache, read)).toEqual({ calls: 2 });
  });

  test("a page that does not exist is read on every request and never kept: ids nobody has cannot fill it", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache();
    const read: Mock<() => Promise<null>> = jest.fn(async () => {
      return null;
    });

    for (let i: number = 0; i < 3; i++) {
      await readFrom(cache, read, {
        statusPageId: ObjectID.generate(),
        projectId: null,
      });
      await readFrom(cache, read, { projectId: null });
    }

    expect(read).toHaveBeenCalledTimes(6);
  });

  test("keepOnlyWhileShared: kept while the page's generation is read from Redis", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache({
      keepOnlyWhileShared: true,
    });
    const read: Mock<() => Promise<JSONObject>> = counter();

    await readFrom(cache, read);
    await readFrom(cache, read);

    expect(read).toHaveBeenCalledTimes(1);
  });

  test("keepOnlyWhileShared: while Redis cannot be reached, every request reads again - a change made in another pod is seen at once", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache({
      keepOnlyWhileShared: true,
    });
    const read: Mock<() => Promise<JSONObject>> = counter();

    redis.isReachable = false;

    expect(await readFrom(cache, read)).toEqual({ read: 1 });
    expect(await readFrom(cache, read)).toEqual({ read: 2 });
  });

  test("without keepOnlyWhileShared, a read is kept while Redis cannot be reached too: for its ttlMs", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache();
    const read: Mock<() => Promise<JSONObject>> = counter();

    redis.isReachable = false;

    await readFrom(cache, read);
    expect(await readFrom(cache, read)).toEqual({ read: 1 });

    moveClock(TTL_MS + 1);
    expect(await readFrom(cache, read)).toEqual({ read: 2 });
  });

  test("shared: a read made in one pod is served in another, not read again", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache({
      shared: true,
    });
    const read: Mock<() => Promise<JSONObject>> = counter();

    const here: JSONObject | null = await readFrom(cache, read);
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    becomeAnotherPod();

    const there: JSONObject | null = await readFrom(cache, read);

    expect(read).toHaveBeenCalledTimes(1);
    expect(there).toEqual(here);
  });

  test("shared: a pod keeps what it read from Redis no longer than the read's own ttlMs", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache({
      shared: true,
    });
    const read: Mock<() => Promise<JSONObject>> = counter();

    await readFrom(cache, read);
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    moveClock(10_000);
    becomeAnotherPod();
    expect(await readFrom(cache, read)).toEqual({ read: 1 });

    moveClock(5_001);
    expect(await readFrom(cache, read)).toEqual({ read: 2 });
  });

  test("shared, while Redis cannot be reached: each pod reads its own", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache({
      shared: true,
    });
    const read: Mock<() => Promise<JSONObject>> = counter();

    redis.isReachable = false;

    await readFrom(cache, read);
    becomeAnotherPod();
    await readFrom(cache, read);

    expect(read).toHaveBeenCalledTimes(2);
  });

  test("a read bigger than maxValueBytes is served as it was read, and read again every time", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache({
      maxValueBytes: 16,
    });
    const big: Mock<() => Promise<JSONObject>> = jest.fn(async () => {
      return { text: "a page's settings, with its images" };
    });

    expect(await readFrom(cache, big)).toEqual({
      text: "a page's settings, with its images",
    });
    await readFrom(cache, big);

    expect(big).toHaveBeenCalledTimes(2);
  });

  test("keeps at most maxBytes of every page's reads: the least recently used page goes first", async () => {
    const cache: StatusPageReadCache<JSONObject | null> = newCache({
      maxBytes: 30,
    });
    const firstPage: Mock<() => Promise<JSONObject>> = jest.fn(async () => {
      return { page: "first page" };
    });
    const secondPage: Mock<() => Promise<JSONObject>> = jest.fn(async () => {
      return { page: "second page" };
    });

    await readFrom(cache, firstPage);
    await readFrom(cache, secondPage, { statusPageId: OTHER_PAGE_ID });
    await readFrom(cache, firstPage);

    // Each read is 20 bytes or more: the two never fit together.
    expect(firstPage).toHaveBeenCalledTimes(2);
    expect(secondPage).toHaveBeenCalledTimes(1);
  });
});
