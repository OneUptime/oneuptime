import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import {
  PUBLISHED_MARKDOWN,
  PublishedMarkdown,
} from "../../../../Server/Utils/File/PublishedImages";
import StatusPageOverviewCache, {
  SHOWN_RECORD_SWITCHES,
  SHOWN_RECORD_TABLES,
  STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE,
} from "../../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
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
 * A status page's overview is kept for a few seconds per process - and a
 * record a status page stops showing (made private, hidden, its postmortem
 * taken off, deleted) leaves it at once, in every process: each such write
 * starts a new generation of its project's overviews, kept in Redis, and an
 * overview is kept under the generation its build started in.
 *
 * Redis is a stand-in here: a map every "process" shares, or a cache that
 * cannot be reached.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "70000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "70000000-0000-4000-8000-000000000002",
);
const PAGE_ID: ObjectID = new ObjectID("71000000-0000-4000-8000-000000000001");
const OTHER_PAGE_ID: ObjectID = new ObjectID(
  "71000000-0000-4000-8000-000000000002",
);

// Redis as every process sees it, by key.
let redis: Map<string, string>;

function redisReachable(): void {
  redis = new Map();

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return redis.get(`${namespace}-${key}`) || null;
    });
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        redis.set(`${namespace}-${key}`, value);
      },
    );
}

function redisUnreachable(): void {
  jest.spyOn(GlobalCache, "getString").mockRejectedValue(new Error("down"));
  jest.spyOn(GlobalCache, "setString").mockRejectedValue(new Error("down"));
}

// A build that answers a new object each time, counting its calls.
function counter(): {
  build: Mock<() => Promise<JSONObject>>;
} {
  let built: number = 0;

  return {
    build: jest.fn(async (): Promise<JSONObject> => {
      built++;
      return { build: built };
    }),
  };
}

async function overview(data: {
  statusPageId?: ObjectID;
  projectId?: ObjectID | null;
  build: () => Promise<JSONObject>;
  readProjectId?: () => Promise<ObjectID | null>;
}): Promise<JSONObject> {
  return await StatusPageOverviewCache.getOrBuild({
    statusPageId: data.statusPageId || PAGE_ID,
    readProjectId:
      data.readProjectId ||
      (async (): Promise<ObjectID | null> => {
        return data.projectId === undefined ? PROJECT_ID : data.projectId;
      }),
    build: data.build,
  });
}

beforeEach(() => {
  StatusPageOverviewCache.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  StatusPageOverviewCache.clear();
});

describe("StatusPageOverviewCache.getOrBuild", () => {
  beforeEach(redisReachable);

  test("keeps a page's overview: a repeat request is the same object, built once", async () => {
    const { build } = counter();

    const first: JSONObject = await overview({ build });
    const second: JSONObject = await overview({ build });

    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  test("keeps each page apart", async () => {
    const { build } = counter();

    await overview({ build, statusPageId: PAGE_ID });
    await overview({ build, statusPageId: OTHER_PAGE_ID });
    await overview({ build, statusPageId: PAGE_ID });

    expect(build).toHaveBeenCalledTimes(2);
  });

  test("a record its project stops showing: the next request builds the page again", async () => {
    const { build } = counter();

    const before: JSONObject = await overview({ build });

    await StatusPageOverviewCache.forgetProjects([PROJECT_ID]);

    const after: JSONObject = await overview({ build });

    expect(build).toHaveBeenCalledTimes(2);
    expect(after).not.toBe(before);

    // And keeps the new one.
    expect(await overview({ build })).toBe(after);
    expect(build).toHaveBeenCalledTimes(2);
  });

  test("another project's change keeps the page's overview", async () => {
    const { build } = counter();

    const before: JSONObject = await overview({ build });

    await StatusPageOverviewCache.forgetProjects([OTHER_PROJECT_ID]);

    expect(await overview({ build })).toBe(before);
    expect(build).toHaveBeenCalledTimes(1);
  });

  test("a change made by another process is seen through Redis", async () => {
    const { build } = counter();

    await overview({ build });

    // Another process starts a new generation; this one keeps its entries.
    redis.set(
      `${STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE}-generation-${PROJECT_ID.toString()}`,
      "elsewhere",
    );

    await overview({ build });

    expect(build).toHaveBeenCalledTimes(2);
  });

  test("a build under way when the project changes is not handed to a request after it", async () => {
    let release: () => void = () => {
      return;
    };
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });
    let built: number = 0;
    const build: Mock<() => Promise<JSONObject>> = jest.fn(
      async (): Promise<JSONObject> => {
        built++;
        const mine: number = built;

        if (mine === 1) {
          await gate;
        }

        return { build: mine };
      },
    );

    // Read before the change; still building when it lands.
    const stale: Promise<JSONObject> = overview({ build });
    await Promise.resolve();
    await Promise.resolve();

    await StatusPageOverviewCache.forgetProjects([PROJECT_ID]);

    const fresh: JSONObject = await overview({ build });

    release();
    await stale;

    expect(fresh).toEqual({ build: 2 });
    // The stale build is kept under the old generation nobody asks for.
    expect(await overview({ build })).toEqual({ build: 2 });
    expect(build).toHaveBeenCalledTimes(2);
  });

  test("requests that miss together share one build", async () => {
    const { build } = counter();

    const [a, b] = await Promise.all([
      overview({ build }),
      overview({ build }),
    ]);

    expect(build).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  test("a failed build is never kept", async () => {
    const build: Mock<() => Promise<JSONObject>> = jest.fn(
      async (): Promise<JSONObject> => {
        return { ok: true };
      },
    );
    build.mockRejectedValueOnce(new Error("page gone"));

    await expect(overview({ build })).rejects.toThrow("page gone");
    await expect(overview({ build })).resolves.toEqual({ ok: true });
    expect(build).toHaveBeenCalledTimes(2);
  });

  test("an overview runs out after TTL_MS", async () => {
    const { build } = counter();
    const startedAt: number = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(startedAt);

    await overview({ build });

    jest
      .spyOn(Date, "now")
      .mockReturnValue(startedAt + StatusPageOverviewCache.TTL_MS + 1);

    await overview({ build });

    expect(build).toHaveBeenCalledTimes(2);
  });

  test("a page's project is read once, and kept", async () => {
    const { build } = counter();
    const readProjectId: Mock<() => Promise<ObjectID | null>> = jest.fn(
      async (): Promise<ObjectID | null> => {
        return PROJECT_ID;
      },
    );

    await overview({ build, readProjectId });
    await StatusPageOverviewCache.forgetProjects([PROJECT_ID]);
    await overview({ build, readProjectId });

    expect(readProjectId).toHaveBeenCalledTimes(1);
  });

  test("a page whose project cannot be read is kept for TTL_MS alone", async () => {
    const { build } = counter();

    for (const readProjectId of [
      async (): Promise<ObjectID | null> => {
        return null;
      },
      async (): Promise<ObjectID | null> => {
        throw new Error("db down");
      },
    ]) {
      StatusPageOverviewCache.clear();
      build.mockClear();

      const first: JSONObject = await overview({ build, readProjectId });
      expect(await overview({ build, readProjectId })).toBe(first);
      expect(build).toHaveBeenCalledTimes(1);
    }
  });
});

describe("StatusPageOverviewCache when Redis cannot be reached", () => {
  beforeEach(redisUnreachable);

  test("a change made in this process is still seen here at once", async () => {
    const { build } = counter();

    await overview({ build });
    await StatusPageOverviewCache.forgetProjects([PROJECT_ID]);
    await overview({ build });

    expect(build).toHaveBeenCalledTimes(2);
  });

  test("forgetting never throws", async () => {
    await expect(
      StatusPageOverviewCache.forgetProjects([PROJECT_ID]),
    ).resolves.toBeUndefined();
  });

  test("overviews are still kept", async () => {
    const { build } = counter();

    await overview({ build });
    await overview({ build });

    expect(build).toHaveBeenCalledTimes(1);
  });
});

describe("StatusPageOverviewCache.forgetProjects", () => {
  beforeEach(redisReachable);

  test("starts a new, unpredictable generation per project, in Redis, for a day", async () => {
    await StatusPageOverviewCache.forgetProjects([
      PROJECT_ID,
      PROJECT_ID.toString().toUpperCase(),
      OTHER_PROJECT_ID,
    ]);

    const setString: Mock<typeof GlobalCache.setString> =
      GlobalCache.setString as unknown as Mock<typeof GlobalCache.setString>;

    // Each project once, however it was written.
    expect(setString).toHaveBeenCalledTimes(2);

    for (const call of setString.mock.calls) {
      expect(call[0]).toBe(STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE);
      expect(call[1]).toMatch(/^generation-[0-9a-f-]{36}$/);
      expect(call[2]).toMatch(/^[0-9a-z]+-[0-9a-f]{12}$/);
      expect(call[3]).toEqual({ expiresInSeconds: 24 * 60 * 60 });
    }

    const first: string | undefined = redis.get(
      `${STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE}-generation-${PROJECT_ID.toString()}`,
    );

    await StatusPageOverviewCache.forgetProjects([PROJECT_ID]);

    expect(
      redis.get(
        `${STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE}-generation-${PROJECT_ID.toString()}`,
      ),
    ).not.toBe(first);
  });
});

describe("StatusPageOverviewCache.afterUpdate / afterDelete", () => {
  let forgetProjects: Mock<typeof StatusPageOverviewCache.forgetProjects>;

  beforeEach(() => {
    forgetProjects = jest.fn(async (): Promise<void> => {
      return;
    });

    jest
      .spyOn(StatusPageOverviewCache, "forgetProjects")
      .mockImplementation(forgetProjects as never);
  });

  const ROWS: Array<Record<string, unknown>> = [
    { _id: "1", projectId: PROJECT_ID },
    { _id: "2", projectId: PROJECT_ID.toString() },
    { _id: "3", projectId: OTHER_PROJECT_ID },
    { _id: "4", projectId: "not-a-project" },
    { _id: "5" },
  ];

  test.each([
    ["Incident", "isVisibleOnStatusPage", false],
    ["Incident", "isPrivate", true],
    ["Incident", "showPostmortemOnStatusPage", false],
    ["IncidentEpisode", "isVisibleOnStatusPage", false],
    ["IncidentEpisode", "isPrivate", true],
    ["ScheduledMaintenance", "isVisibleOnStatusPage", false],
  ] as Array<[string, string, boolean]>)(
    "a write of %s.%s forgets the overviews of the rows' projects, each once",
    async (tableName: string, column: string, value: boolean) => {
      await StatusPageOverviewCache.afterUpdate({
        tableName: tableName,
        rows: ROWS,
        written: { [column]: value },
      });

      expect(forgetProjects).toHaveBeenCalledTimes(1);
      expect(forgetProjects.mock.calls[0]![0]).toEqual([
        PROJECT_ID.toString(),
        OTHER_PROJECT_ID.toString(),
      ]);
    },
  );

  test("a write of anything else, of a table no status page decides by, or of no rows, keeps them", async () => {
    await StatusPageOverviewCache.afterUpdate({
      tableName: "Incident",
      rows: ROWS,
      written: { title: "Renamed", isVisibleOnStatusPage: undefined },
    });
    await StatusPageOverviewCache.afterUpdate({
      tableName: "Monitor",
      rows: ROWS,
      written: { isVisibleOnStatusPage: false },
    });
    await StatusPageOverviewCache.afterUpdate({
      tableName: "Incident",
      rows: [],
      written: { isVisibleOnStatusPage: false },
    });
    await StatusPageOverviewCache.afterUpdate({
      tableName: "toString",
      rows: ROWS,
      written: { isVisibleOnStatusPage: false },
    });

    expect(forgetProjects).not.toHaveBeenCalled();
  });

  test.each([
    "Incident",
    "IncidentEpisode",
    "ScheduledMaintenance",
    "IncidentPublicNote",
    "IncidentEpisodePublicNote",
    "ScheduledMaintenancePublicNote",
    "StatusPageAnnouncement",
  ])(
    "a delete of a %s forgets the overviews of the rows' projects, each once",
    async (tableName: string) => {
      await StatusPageOverviewCache.afterDelete({
        tableName: tableName,
        rows: ROWS,
      });

      expect(forgetProjects).toHaveBeenCalledTimes(1);
      expect(forgetProjects.mock.calls[0]![0]).toEqual([
        PROJECT_ID.toString(),
        OTHER_PROJECT_ID.toString(),
      ]);
    },
  );

  test("a delete of anything else, or of no rows, keeps them", async () => {
    for (const tableName of [
      "Monitor",
      "StatusPageResource",
      "toString",
      "constructor",
      undefined,
      null,
    ]) {
      await StatusPageOverviewCache.afterDelete({
        tableName: tableName,
        rows: ROWS,
      });
    }

    await StatusPageOverviewCache.afterDelete({
      tableName: "Incident",
      rows: [],
    });

    expect(forgetProjects).not.toHaveBeenCalled();
  });
});

/*
 * GUARD: the switches that start a new generation are every switch a status
 * page shows an incident, an episode or an event's markdown by
 * (PublishedImages), so a switch added there is noticed here.
 */
describe("GUARD: SHOWN_RECORD_SWITCHES", () => {
  test("names every status page switch of the records it covers", () => {
    for (const [tableName, switches] of Object.entries(SHOWN_RECORD_SWITCHES)) {
      const published: Set<string> = new Set<string>(
        PUBLISHED_MARKDOWN.filter((source: PublishedMarkdown): boolean => {
          return (
            source.tableName === tableName && source.shownOn === "statusPage"
          );
        }).flatMap((source: PublishedMarkdown): Array<string> => {
          return [...source.shownWhen, ...(source.hiddenWhen || [])];
        }),
      );

      expect(published.size).toBeGreaterThan(0);
      expect([...switches].sort()).toEqual(Array.from(published).sort());
    }
  });

  test("covers the incident, the episode and the scheduled maintenance event", () => {
    expect(Object.keys(SHOWN_RECORD_SWITCHES).sort()).toEqual([
      "Incident",
      "IncidentEpisode",
      "ScheduledMaintenance",
    ]);
  });
});

/*
 * GUARD: a delete forgets the overviews of every record of a project's own
 * that a status page shows - each with a switch above, each shown under one
 * (a public note) - and of its announcements. Each is a status page source
 * of PublishedImages, so the delete reads the project of each row.
 */
describe("GUARD: SHOWN_RECORD_TABLES", () => {
  test("names every record with a switch, and every record shown under one", () => {
    const shownUnderARecordWithASwitch: Array<string> =
      PUBLISHED_MARKDOWN.filter((source: PublishedMarkdown): boolean => {
        return (
          source.shownOn === "statusPage" &&
          Boolean(source.shownUnder) &&
          Object.prototype.hasOwnProperty.call(
            SHOWN_RECORD_SWITCHES,
            source.shownUnder!.tableName,
          )
        );
      }).map((source: PublishedMarkdown): string => {
        return source.tableName;
      });

    expect(shownUnderARecordWithASwitch.sort()).toEqual([
      "IncidentEpisodePublicNote",
      "IncidentPublicNote",
      "ScheduledMaintenancePublicNote",
    ]);

    for (const tableName of [
      ...Object.keys(SHOWN_RECORD_SWITCHES),
      ...shownUnderARecordWithASwitch,
      "StatusPageAnnouncement",
    ]) {
      expect(SHOWN_RECORD_TABLES).toContain(tableName);
    }
  });

  test("names only records a status page shows, each once", () => {
    const statusPageSources: Set<string> = new Set<string>(
      PUBLISHED_MARKDOWN.filter((source: PublishedMarkdown): boolean => {
        return source.shownOn === "statusPage";
      }).map((source: PublishedMarkdown): string => {
        return source.tableName;
      }),
    );

    for (const tableName of SHOWN_RECORD_TABLES) {
      expect(statusPageSources.has(tableName)).toBe(true);
    }

    expect(new Set<string>(SHOWN_RECORD_TABLES).size).toBe(
      SHOWN_RECORD_TABLES.length,
    );
  });
});
