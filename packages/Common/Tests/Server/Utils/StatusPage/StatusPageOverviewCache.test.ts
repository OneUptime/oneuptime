import Entities from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import {
  PUBLISHED_MARKDOWN,
  PublishedMarkdown,
} from "../../../../Server/Utils/File/PublishedImages";
import StatusPageOverviewCache, {
  HIDING_WRITES,
  HidingWrite,
  SHOWN_RECORD_TABLES,
  STATUS_PAGE_CONFIGURATION_TABLES,
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
 * A status page's overview is kept for a few seconds per process - and
 * something a status page stops showing (a record made private, hidden,
 * limited to other pages or deleted; the page's own resources changed)
 * leaves it at once: each write that can take something off starts a new
 * generation of its project's overviews - shared through Redis, and this
 * process's own - and an overview is kept under the generation its build
 * started in. A write that can only show more starts none.
 *
 * Redis is a stand-in here: a map every "process" shares, or a cache that
 * cannot be reached.
 */

const GENERATION_KEY: string = `${STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE}-generation-70000000-0000-4000-8000-000000000001`;

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

  test("a change made by another process is seen through Redis, within SHARED_GENERATION_READ_TTL_MS", async () => {
    const { build } = counter();
    const startedAt: number = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(startedAt);

    await overview({ build });

    // Another process starts a new generation; this one keeps its entries.
    redis.set(GENERATION_KEY, "elsewhere");

    jest
      .spyOn(Date, "now")
      .mockReturnValue(
        startedAt + StatusPageOverviewCache.SHARED_GENERATION_READ_TTL_MS + 1,
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

    while (build.mock.calls.length === 0) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }

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

describe("StatusPageOverviewCache generations", () => {
  beforeEach(redisReachable);

  test("Redis is asked once per project for SHARED_GENERATION_READ_TTL_MS, not on every request", async () => {
    const { build } = counter();
    const startedAt: number = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(startedAt);

    await overview({ build, statusPageId: PAGE_ID });
    await overview({ build, statusPageId: PAGE_ID });
    await overview({ build, statusPageId: OTHER_PAGE_ID });

    expect(GlobalCache.getString).toHaveBeenCalledTimes(1);

    jest
      .spyOn(Date, "now")
      .mockReturnValue(
        startedAt + StatusPageOverviewCache.SHARED_GENERATION_READ_TTL_MS + 1,
      );

    await overview({ build, statusPageId: PAGE_ID });

    expect(GlobalCache.getString).toHaveBeenCalledTimes(2);
  });

  test("requests that ask together share one read of Redis", async () => {
    const { build } = counter();

    await Promise.all([
      overview({ build, statusPageId: PAGE_ID }),
      overview({ build, statusPageId: OTHER_PAGE_ID }),
      overview({ build, statusPageId: PAGE_ID }),
    ]);

    expect(GlobalCache.getString).toHaveBeenCalledTimes(1);
  });

  test("a change Redis did not take still counts in this process once Redis answers again", async () => {
    const { build } = counter();
    const startedAt: number = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(startedAt);

    const before: JSONObject = await overview({ build });

    // The write of the new shared generation fails; Redis keeps the old one.
    (
      GlobalCache.setString as unknown as Mock<typeof GlobalCache.setString>
    ).mockRejectedValueOnce(new Error("blip"));

    await StatusPageOverviewCache.forgetProjects([PROJECT_ID]);

    const after: JSONObject = await overview({ build });
    expect(after).not.toBe(before);

    // Redis is read again, and still answers the generation from before.
    jest
      .spyOn(Date, "now")
      .mockReturnValue(
        startedAt + StatusPageOverviewCache.SHARED_GENERATION_READ_TTL_MS + 1,
      );

    const later: JSONObject = await overview({ build });

    expect(later).not.toBe(before);
    expect(later).toEqual(after);
  });

  test("a change made here is seen here at once, before Redis is read again", async () => {
    const { build } = counter();
    const startedAt: number = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(startedAt);

    const before: JSONObject = await overview({ build });

    await StatusPageOverviewCache.forgetProjects([PROJECT_ID]);

    expect(await overview({ build })).not.toBe(before);
    expect(build).toHaveBeenCalledTimes(2);
  });
});

describe("StatusPageOverviewCache when Redis cannot be reached", () => {
  beforeEach(redisUnreachable);

  test("an overview built meanwhile is not served once Redis can be reached, and Redis is asked again", async () => {
    const { build } = counter();

    const meanwhile: JSONObject = await overview({ build });

    // Reached again: an overview built before is never taken for the shared one.
    jest.restoreAllMocks();
    redisReachable();
    redis.set(GENERATION_KEY, "while-unreachable");

    const reached: JSONObject = await overview({ build });

    expect(reached).not.toBe(meanwhile);
    expect(build).toHaveBeenCalledTimes(2);
  });

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
    ["Incident", "isVisibleOnStatusPage", null],
    ["Incident", "isPrivate", true],
    ["Incident", "isPrivate", "true"],
    ["Incident", "showPostmortemOnStatusPage", false],
    ["Incident", "isScopedToStatusPages", true],
    ["Incident", "statusPages", []],
    ["Incident", "monitors", [{ _id: "monitor" }]],
    ["IncidentEpisode", "isVisibleOnStatusPage", false],
    ["IncidentEpisode", "isPrivate", true],
    ["ScheduledMaintenance", "isVisibleOnStatusPage", false],
    ["ScheduledMaintenance", "statusPages", [{ _id: "page" }]],
    ["ScheduledMaintenance", "monitors", []],
    ["StatusPageAnnouncement", "showAnnouncementAt", new Date()],
    ["StatusPageAnnouncement", "endAnnouncementAt", new Date()],
    ["StatusPageAnnouncement", "statusPages", []],
    ["StatusPageAnnouncement", "monitors", []],
    ["StatusPage", "showIncidentLabelsOnStatusPage", false],
    ["StatusPageGroup", "name", "Region"],
    ["StatusPageResource", "displayName", "API"],
  ] as Array<[string, string, unknown]>)(
    "a write of %s.%s as %p, which may take something off a page, forgets the rows' projects, each once",
    async (tableName: string, column: string, value: unknown) => {
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

  test.each([
    ["Incident", { isVisibleOnStatusPage: true }],
    ["Incident", { isPrivate: false }],
    ["Incident", { isPrivate: null }],
    ["Incident", { showPostmortemOnStatusPage: true }],
    ["Incident", { isScopedToStatusPages: false }],
    // What the incident's Settings form sends with every save, shown.
    [
      "Incident",
      {
        isVisibleOnStatusPage: true,
        isPrivate: false,
        showPostmortemOnStatusPage: true,
        title: "Renamed",
      },
    ],
    ["IncidentEpisode", { isVisibleOnStatusPage: true, isPrivate: false }],
    ["ScheduledMaintenance", { isVisibleOnStatusPage: true }],
  ] as Array<[string, Record<string, unknown>]>)(
    "a write to %s that can only show more keeps them: %p",
    async (tableName: string, written: Record<string, unknown>) => {
      await StatusPageOverviewCache.afterUpdate({
        tableName: tableName,
        rows: ROWS,
        written: written,
      });

      expect(forgetProjects).not.toHaveBeenCalled();
    },
  );

  test("a write of anything else, of a table no status page decides by, or of no rows, keeps them", async () => {
    await StatusPageOverviewCache.afterUpdate({
      tableName: "Incident",
      rows: ROWS,
      written: { title: "Renamed", isVisibleOnStatusPage: undefined },
    });
    await StatusPageOverviewCache.afterUpdate({
      tableName: "StatusPageAnnouncement",
      rows: ROWS,
      written: { title: "Maintenance window", description: "Updated" },
    });
    await StatusPageOverviewCache.afterUpdate({
      tableName: "IncidentPublicNote",
      rows: ROWS,
      written: { note: "Edited" },
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
      tableName: "StatusPage",
      rows: [],
      written: { name: "Status" },
    });

    for (const tableName of ["toString", "constructor", undefined, null]) {
      await StatusPageOverviewCache.afterUpdate({
        tableName: tableName,
        rows: ROWS,
        written: { isVisibleOnStatusPage: false },
      });
    }

    expect(forgetProjects).not.toHaveBeenCalled();
  });

  test.each([
    "Incident",
    "IncidentEpisode",
    "ScheduledMaintenance",
    "StatusPageAnnouncement",
    "IncidentPublicNote",
    "IncidentEpisodePublicNote",
    "ScheduledMaintenancePublicNote",
    "IncidentEpisodeMember",
    "StatusPage",
    "StatusPageGroup",
    "StatusPageResource",
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
      "IncidentInternalNote",
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

// The model of a table, as the database models name it.
function modelOf(tableName: string): BaseModel {
  const model: BaseModel | undefined = Entities.map(
    (entity: { new (): BaseModel }): BaseModel => {
      return new entity();
    },
  ).find((candidate: BaseModel): boolean => {
    return candidate.tableName === tableName;
  });

  expect({ tableName, found: Boolean(model) }).toEqual({
    tableName,
    found: true,
  });

  return model!;
}

/*
 * GUARD: the writes that can take a record off a page name every switch a
 * status page shows an incident, an episode or an event's markdown by
 * (PublishedImages) - one that shows it as "off", one that hides it as "on" -
 * so a switch added there is noticed here; and every column named is one of
 * its model's.
 */
describe("GUARD: HIDING_WRITES", () => {
  test("names every status page switch of the records it covers, by how it hides them", () => {
    for (const tableName of Object.keys(HIDING_WRITES)) {
      const sources: Array<PublishedMarkdown> = PUBLISHED_MARKDOWN.filter(
        (source: PublishedMarkdown): boolean => {
          return (
            source.tableName === tableName && source.shownOn === "statusPage"
          );
        },
      );

      expect(sources.length).toBeGreaterThan(0);

      for (const source of sources) {
        for (const column of source.shownWhen) {
          expect({
            tableName,
            column,
            hidingWrite: HIDING_WRITES[tableName]![column],
          }).toEqual({
            tableName,
            column,
            hidingWrite: "off" as HidingWrite,
          });
        }

        for (const column of source.hiddenWhen || []) {
          expect({
            tableName,
            column,
            hidingWrite: HIDING_WRITES[tableName]![column],
          }).toEqual({
            tableName,
            column,
            hidingWrite: "on" as HidingWrite,
          });
        }
      }
    }
  });

  test("covers the incident, the episode, the scheduled maintenance event and the announcement", () => {
    expect(Object.keys(HIDING_WRITES).sort()).toEqual([
      "Incident",
      "IncidentEpisode",
      "ScheduledMaintenance",
      "StatusPageAnnouncement",
    ]);
  });

  test("names only columns of its models", () => {
    for (const [tableName, columns] of Object.entries(HIDING_WRITES)) {
      const model: BaseModel = modelOf(tableName);

      for (const column of Object.keys(columns)) {
        expect({
          tableName,
          column,
          isColumn: model.hasColumn(column),
        }).toEqual({
          tableName,
          column,
          isColumn: true,
        });
      }
    }
  });
});

/*
 * GUARD: a delete forgets the overviews of everything a status page shows of
 * a project - every status page source of PublishedImages (its records, the
 * notes shown with them, its announcements, the page's own configuration) -
 * and of an incident's place in an episode. Each has a project, which the
 * delete reads.
 */
describe("GUARD: SHOWN_RECORD_TABLES", () => {
  test("names every record a status page shows, and every record with a write that can hide one", () => {
    for (const tableName of [
      ...PUBLISHED_MARKDOWN.filter((source: PublishedMarkdown): boolean => {
        return source.shownOn === "statusPage";
      }).map((source: PublishedMarkdown): string => {
        return source.tableName;
      }),
      ...Object.keys(HIDING_WRITES),
      ...STATUS_PAGE_CONFIGURATION_TABLES,
      "IncidentEpisodeMember",
    ]) {
      expect(SHOWN_RECORD_TABLES).toContain(tableName);
    }
  });

  test("names each once, every one a model with a project", () => {
    expect(new Set<string>(SHOWN_RECORD_TABLES).size).toBe(
      SHOWN_RECORD_TABLES.length,
    );

    for (const tableName of SHOWN_RECORD_TABLES) {
      expect({
        tableName,
        tenant: modelOf(tableName).getTenantColumn(),
      }).toEqual({
        tableName,
        tenant: "projectId",
      });
    }
  });
});
