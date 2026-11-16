import CacheGenerations from "../../../../Server/Infrastructure/CacheGenerations";
import StatusPageOverviewCache, {
  STATUS_PAGE_OVERVIEW_BASE_FORM,
  StatusPageCacheKey,
  StatusPageOverviewBase,
} from "../../../../Server/Utils/StatusPage/StatusPageOverviewCache";
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
 * A page's overview built once for every pod: kept in Redis for the rest of
 * its TTL_MS with the uptime history of every zone cut for it, read back
 * exactly as built, and never kept by a pod past its build's TTL_MS. While
 * Redis cannot be reached, each pod builds its own, as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "77000000-0000-4000-8000-000000000001",
);
const PAGE_ID: ObjectID = new ObjectID("78000000-0000-4000-8000-000000000001");

let redis: FakeGlobalCacheStrings;

function overviewBase(build: number): StatusPageOverviewBase {
  return {
    response: {
      build: build,
      overallStatus: { name: "Operational", color: "#00ff00" },
      statusPageResources: [{ _id: "resource-1", displayName: "API" }],
    },
    uptimeHistory: {
      monitorIds: [
        new ObjectID("79000000-0000-4000-8000-000000000001"),
        new ObjectID("79000000-0000-4000-8000-000000000002"),
      ],
      monitorGroups: [
        {
          monitorGroupId: new ObjectID("7a000000-0000-4000-8000-000000000001"),
          monitorIds: [new ObjectID("79000000-0000-4000-8000-000000000003")],
        },
      ],
      rankedMonitorStatusIds: ["operational", "degraded", "offline"],
      startDate: new Date("2026-08-18T10:00:00.000Z"),
      endDate: new Date("2026-11-16T10:00:00.000Z"),
    },
  };
}

function builder(): Mock<() => Promise<StatusPageOverviewBase>> {
  let built: number = 0;

  return jest.fn(async (): Promise<StatusPageOverviewBase> => {
    built++;
    return overviewBase(built);
  });
}

async function overviewOf(
  build: () => Promise<StatusPageOverviewBase>,
): Promise<StatusPageOverviewBase> {
  return await StatusPageOverviewCache.getOrBuild<StatusPageOverviewBase>({
    statusPageId: PAGE_ID,
    readProjectId: async (): Promise<ObjectID | null> => {
      return PROJECT_ID;
    },
    build: build,
    shared: STATUS_PAGE_OVERVIEW_BASE_FORM,
  });
}

function historyBuilder(): Mock<
  () => Promise<{ json: JSONObject; cutIn: string }>
> {
  let built: number = 0;

  return jest.fn(async (): Promise<{ json: JSONObject; cutIn: string }> => {
    built++;
    return {
      json: {
        uptimeDailyAggregate: { timezone: "Europe/Berlin", built: built },
      },
      cutIn: "Europe/Berlin",
    };
  });
}

async function inZone(
  overview: StatusPageOverviewBase,
  build: () => Promise<{ json: JSONObject; cutIn: string }>,
): Promise<JSONObject> {
  return await StatusPageOverviewCache.getOrBuildOverviewInZone({
    overview: overview,
    timezone: "Europe/Berlin",
    build: build,
  });
}

// Lets the writes the builds started (not awaited) land.
async function settle(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

// Another pod: its own memory, the same Redis.
function becomeAnotherPod(): void {
  StatusPageOverviewCache.clear();
}

function moveClock(ms: number): void {
  const now: number = Date.now() + ms;
  jest.spyOn(Date, "now").mockReturnValue(now);
}

beforeEach(() => {
  StatusPageOverviewCache.clear();
  redis = new FakeGlobalCacheStrings().install();
});

afterEach(() => {
  jest.restoreAllMocks();
  StatusPageOverviewCache.clear();
});

describe("STATUS_PAGE_OVERVIEW_BASE_FORM", () => {
  test("reads an overview back exactly as it was built: its response, ids and dates", () => {
    const built: StatusPageOverviewBase = overviewBase(1);

    const readBack: StatusPageOverviewBase =
      STATUS_PAGE_OVERVIEW_BASE_FORM.fromJSON(
        JSON.parse(
          JSON.stringify(STATUS_PAGE_OVERVIEW_BASE_FORM.toJSON(built)),
        ),
      );

    expect(readBack.response).toEqual(built.response);
    expect(
      readBack.uptimeHistory.monitorIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual(
      built.uptimeHistory.monitorIds.map((id: ObjectID) => {
        return id.toString();
      }),
    );
    expect(readBack.uptimeHistory.monitorIds[0]).toBeInstanceOf(ObjectID);
    expect(
      readBack.uptimeHistory.monitorGroups[0]!.monitorGroupId.toString(),
    ).toBe(built.uptimeHistory.monitorGroups[0]!.monitorGroupId.toString());
    expect(
      readBack.uptimeHistory.monitorGroups[0]!.monitorIds[0]!.toString(),
    ).toBe(built.uptimeHistory.monitorGroups[0]!.monitorIds[0]!.toString());
    expect(readBack.uptimeHistory.rankedMonitorStatusIds).toEqual(
      built.uptimeHistory.rankedMonitorStatusIds,
    );
    expect(readBack.uptimeHistory.startDate).toEqual(
      built.uptimeHistory.startDate,
    );
    expect(readBack.uptimeHistory.endDate).toEqual(built.uptimeHistory.endDate);
  });

  test.each([
    ["nothing", null],
    ["a response alone", { response: {} }],
    [
      "a window that is not dates",
      {
        response: {},
        uptimeHistory: {
          monitorIds: [],
          monitorGroups: [],
          rankedMonitorStatusIds: [],
          startDate: "not a date",
          endDate: "not a date",
        },
      },
    ],
  ])("refuses %s: it is not an overview", (_name: string, json: unknown) => {
    expect(() => {
      return STATUS_PAGE_OVERVIEW_BASE_FORM.fromJSON(json);
    }).toThrow();
  });
});

describe("StatusPageOverviewCache, built once for every pod", () => {
  test("another pod serves the overview one pod built, and the uptime history cut for it", async () => {
    const build: Mock<() => Promise<StatusPageOverviewBase>> = builder();
    const buildHistory: Mock<
      () => Promise<{ json: JSONObject; cutIn: string }>
    > = historyBuilder();

    const here: JSONObject = await inZone(
      await overviewOf(build),
      buildHistory,
    );
    await settle();

    becomeAnotherPod();

    const there: JSONObject = await inZone(
      await overviewOf(build),
      buildHistory,
    );

    expect(build).toHaveBeenCalledTimes(1);
    expect(buildHistory).toHaveBeenCalledTimes(1);
    expect(there).toEqual(here);
  });

  test("an overview read from Redis is kept no longer than its build's TTL_MS", async () => {
    const build: Mock<() => Promise<StatusPageOverviewBase>> = builder();

    await overviewOf(build);
    await settle();

    moveClock(StatusPageOverviewCache.TTL_MS - 2_000);
    becomeAnotherPod();
    await overviewOf(build);
    expect(build).toHaveBeenCalledTimes(1);

    moveClock(2_001);
    await overviewOf(build);
    expect(build).toHaveBeenCalledTimes(2);
  });

  test("a record taken off a page is a new overview in every pod: the one in Redis is never served again", async () => {
    const build: Mock<() => Promise<StatusPageOverviewBase>> = builder();

    await overviewOf(build);
    await settle();

    await StatusPageOverviewCache.forgetProjects([PROJECT_ID]);

    becomeAnotherPod();

    expect((await overviewOf(build)).response["build"]).toBe(2);
  });

  test("while Redis cannot be reached, each pod builds its own", async () => {
    const build: Mock<() => Promise<StatusPageOverviewBase>> = builder();

    redis.isReachable = false;

    await overviewOf(build);
    becomeAnotherPod();
    await overviewOf(build);

    expect(build).toHaveBeenCalledTimes(2);
  });

  test("an overview whose shared form is left out is kept by its pod alone, as before", async () => {
    const build: Mock<() => Promise<JSONObject>> = jest.fn(async () => {
      return { kept: "here" };
    });

    await StatusPageOverviewCache.getOrBuild<JSONObject>({
      statusPageId: PAGE_ID,
      readProjectId: async (): Promise<ObjectID | null> => {
        return PROJECT_ID;
      },
      build: build,
    });
    await settle();

    expect(
      redis.keys().some((key: string) => {
        return key.includes("value|overview");
      }),
    ).toBe(false);
  });
});

describe("StatusPageOverviewCache.getPageKey", () => {
  test("is the page and its project's generation, read from Redis", async () => {
    const key: StatusPageCacheKey = await StatusPageOverviewCache.getPageKey({
      statusPageId: PAGE_ID,
      readProjectId: async (): Promise<ObjectID | null> => {
        return PROJECT_ID;
      },
    });

    expect(key.key.startsWith(`${PAGE_ID.toString()}|`)).toBe(true);
    expect(key.hasProject).toBe(true);
    expect(key.isShared).toBe(true);
  });

  test("is not shared while Redis cannot be reached", async () => {
    redis.isReachable = false;

    const key: StatusPageCacheKey = await StatusPageOverviewCache.getPageKey({
      statusPageId: PAGE_ID,
      readProjectId: async (): Promise<ObjectID | null> => {
        return PROJECT_ID;
      },
    });

    expect(key.hasProject).toBe(true);
    expect(key.isShared).toBe(false);
  });

  test("is the page alone, with no project and not shared, for a page that does not exist", async () => {
    const key: StatusPageCacheKey = await StatusPageOverviewCache.getPageKey({
      statusPageId: PAGE_ID,
      readProjectId: async (): Promise<ObjectID | null> => {
        return null;
      },
    });

    expect(key).toEqual({
      key: PAGE_ID.toString(),
      hasProject: false,
      isShared: false,
    });
  });

  test("changes when a write takes something off the project's pages", async () => {
    const readProjectId: () => Promise<ObjectID | null> = async () => {
      return PROJECT_ID;
    };

    const before: StatusPageCacheKey = await StatusPageOverviewCache.getPageKey(
      { statusPageId: PAGE_ID, readProjectId },
    );

    await StatusPageOverviewCache.forgetProjects([PROJECT_ID]);

    const after: StatusPageCacheKey = await StatusPageOverviewCache.getPageKey({
      statusPageId: PAGE_ID,
      readProjectId,
    });

    expect(after.key).not.toBe(before.key);
  });
});

describe("CacheGenerations.isSharedGeneration", () => {
  test("is a generation read from Redis: a token, or the default", () => {
    expect(CacheGenerations.isSharedGeneration("0.0")).toBe(true);
    expect(
      CacheGenerations.isSharedGeneration(
        `${CacheGenerations.newToken()}.${CacheGenerations.newToken()}`,
      ),
    ).toBe(true);
  });

  test("is not one standing in for a Redis that could not be reached", async () => {
    const generations: CacheGenerations = new CacheGenerations({
      namespace: "test-shared-generation",
      ttlSeconds: 60,
      description: "test caches",
    });

    redis.isReachable = false;

    expect(
      CacheGenerations.isSharedGeneration(await generations.get("a-key")),
    ).toBe(false);

    redis.isReachable = true;
    moveClock(CacheGenerations.SHARED_READ_TTL_MS + 1);

    expect(
      CacheGenerations.isSharedGeneration(await generations.get("a-key")),
    ).toBe(true);
  });
});
