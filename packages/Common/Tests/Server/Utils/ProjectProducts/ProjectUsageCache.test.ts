import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Redis as every server sees it: one map every copy of the cache shares
 * (each copy, loaded on its own, is one server's memory), which can be made
 * to fail. GlobalCache is replaced by it for every copy.
 */
const mockRedis: Map<string, string> = new Map<string, string>();
const mockRedisState: { isUp: boolean } = { isUp: true };

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: async (
        namespace: string,
        key: string,
      ): Promise<string | null> => {
        if (!mockRedisState.isUp) {
          throw new Error("Cache is not connected");
        }

        return mockRedis.get(`${namespace}-${key}`) || null;
      },
      setString: async (
        namespace: string,
        key: string,
        value: string,
      ): Promise<void> => {
        if (!mockRedisState.isUp) {
          throw new Error("Cache is not connected");
        }

        mockRedis.set(`${namespace}-${key}`, value);
      },
    },
  };
});

jest.mock("../../../../Server/Utils/Logger");

import CacheGenerations from "../../../../Server/Infrastructure/CacheGenerations";
import ProjectUsageCache, {
  ProjectUsage,
} from "../../../../Server/Utils/ProjectProducts/ProjectUsageCache";
import ActivationMilestone from "../../../../Types/Analytics/ActivationMilestone";
import ObjectID from "../../../../Types/ObjectID";
import ProductKey from "../../../../Types/Product/ProductKey";
import { PRODUCT_OF_TABLE } from "../../../../Types/Product/ProductOfTable";
import {
  PRODUCT_USAGE_MILESTONES,
  PRODUCT_USAGE_TABLES,
} from "../../../../Types/Product/ProductUsage";

/*
 * WHAT EACH PROJECT USES, KEPT A FEW MINUTES PER SERVER, AND A CHANGE TO IT
 * SEEN AT ONCE (#7465).
 *
 * The products menu said "Not set up" on Monitors, On-Call Duty and Logs
 * for minutes after each was set up, through a reload: each server kept a
 * project's usage for five minutes, and nothing that set a product up told
 * it. Here: usage that does not change is read once however often it is
 * asked for; a product's first record, its records deleted and a telemetry
 * product's first data each have it read again, here at once and on every
 * other server within a second - and a busy create path does not have it
 * read again for every record.
 */

type Cache = typeof ProjectUsageCache;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000002",
);

// What the database says the project uses, as the read finds it now.
let stored: ProjectUsage;
let reads: number;
let now: number;

const read: () => Promise<ProjectUsage> = async (): Promise<ProjectUsage> => {
  reads++;
  return { ...stored };
};

async function usageOf(
  cache: Cache = ProjectUsageCache,
  projectId: ObjectID | string = PROJECT_ID,
): Promise<ProjectUsage> {
  return await cache.getUsage({ projectId: projectId, read: read });
}

// A record of a table, in the project.
function rowOf(projectId: ObjectID | string = PROJECT_ID): {
  projectId: ObjectID | string;
} {
  return { projectId: projectId };
}

// Another server: a copy of the cache with its own memory, sharing Redis.
function anotherServer(): Cache {
  let other: Cache | undefined = undefined;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    other =
      require("../../../../Server/Utils/ProjectProducts/ProjectUsageCache")
        .default as Cache;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

  return other!;
}

// Lets the time another server's change takes to be seen here go by.
function afterSharedRead(): void {
  now += CacheGenerations.SHARED_READ_TTL_MS + 1;
}

beforeEach(() => {
  mockRedis.clear();
  mockRedisState.isUp = true;
  stored = { [ProductKey.Monitors]: false, [ProductKey.OnCall]: false };
  reads = 0;
  now = Date.UTC(2026, 10, 15, 21, 14, 0);

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });

  ProjectUsageCache.clear();
});

afterEach(() => {
  ProjectUsageCache.clear();
  jest.restoreAllMocks();
});

describe("usage that does not change", () => {
  test("is read once, however many pages ask for it", async () => {
    for (let page: number = 0; page < 5; page++) {
      expect(await usageOf()).toEqual(stored);
      now += 30_000;
    }

    expect(reads).toBe(1);
  });

  test("asks that arrive together share one read", async () => {
    const answers: Array<ProjectUsage> = await Promise.all([
      usageOf(),
      usageOf(),
      usageOf(),
    ]);

    expect(reads).toBe(1);
    expect(answers).toEqual([stored, stored, stored]);
  });

  test("is read again once TTL_MS has passed", async () => {
    await usageOf();

    now += ProjectUsageCache.TTL_MS - 1;
    await usageOf();
    expect(reads).toBe(1);

    now += 2;
    await usageOf();
    expect(reads).toBe(2);
  });

  test("each project is kept on its own, whatever case its id is written in", async () => {
    await usageOf(ProjectUsageCache, PROJECT_ID);
    await usageOf(ProjectUsageCache, PROJECT_ID.toString().toUpperCase());
    expect(reads).toBe(1);

    await usageOf(ProjectUsageCache, OTHER_PROJECT_ID);
    expect(reads).toBe(2);
  });

  test("a read that fails is not kept: it throws, and the next ask reads again", async () => {
    await expect(
      ProjectUsageCache.getUsage({
        projectId: PROJECT_ID,
        read: async (): Promise<ProjectUsage> => {
          throw new Error("database is down");
        },
      }),
    ).rejects.toThrow("database is down");

    expect(await usageOf()).toEqual(stored);
    expect(reads).toBe(1);
  });

  test("each caller gets its own copy: one that changes it changes nothing kept", async () => {
    const first: ProjectUsage = await usageOf();
    first[ProductKey.Monitors] = true;

    expect((await usageOf())[ProductKey.Monitors]).toBe(false);
  });
});

describe("a product's first record", () => {
  test("a monitor created has the usage read again at once (#7465)", async () => {
    expect((await usageOf())[ProductKey.Monitors]).toBe(false);

    stored = { ...stored, [ProductKey.Monitors]: true };
    await ProjectUsageCache.afterCreate({
      tableName: "Monitor",
      row: rowOf(),
    });

    expect((await usageOf())[ProductKey.Monitors]).toBe(true);
    expect(reads).toBe(2);
  });

  test("an on-call policy created has the usage read again at once (#7465)", async () => {
    await usageOf();

    stored = { ...stored, [ProductKey.OnCall]: true };
    await ProjectUsageCache.afterCreate({
      tableName: "OnCallDutyPolicy",
      row: rowOf(),
    });

    expect((await usageOf())[ProductKey.OnCall]).toBe(true);
  });

  test.each(Object.keys(PRODUCT_OF_TABLE))(
    "a %s created has the usage read again",
    async (tableName: string) => {
      await usageOf();

      await ProjectUsageCache.afterCreate({
        tableName: tableName,
        row: rowOf(),
      });
      await usageOf();

      expect(reads).toBe(2);
    },
  );

  /*
   * #7325: the products counted by some records of a table (an inventory
   * item, a data store, a cloud resource, a security source) are read again
   * too when the first of those records is made.
   */
  test.each(Object.keys(PRODUCT_USAGE_TABLES))(
    "a %s created has the usage of the products it counts read again",
    async (tableName: string) => {
      expect(ProjectUsageCache.getProductsOfTable(tableName)).toEqual(
        PRODUCT_USAGE_TABLES[tableName],
      );

      await usageOf();

      await ProjectUsageCache.afterCreate({
        tableName: tableName,
        row: rowOf(),
      });
      await usageOf();

      expect(reads).toBe(2);
    },
  );

  test("a data store counts for Data Observability and Data Security: either not yet in use has it read again", async () => {
    stored = {
      [ProductKey.DataObservability]: false,
      [ProductKey.DataSecurity]: true,
    };
    await usageOf();

    stored = {
      [ProductKey.DataObservability]: true,
      [ProductKey.DataSecurity]: true,
    };
    await ProjectUsageCache.afterCreate({
      tableName: "DataStore",
      row: rowOf(),
    });

    expect((await usageOf())[ProductKey.DataObservability]).toBe(true);
    expect(reads).toBe(2);

    // Both known in use: a second data store costs no read.
    ProjectUsageCache.clear();
    reads = 0;
    await usageOf();
    await ProjectUsageCache.afterCreate({
      tableName: "DataStore",
      row: rowOf(),
    });
    await usageOf();
    expect(reads).toBe(1);
  });

  test("the last data store deleted has both its products read again", async () => {
    stored = {
      [ProductKey.DataObservability]: true,
      [ProductKey.DataSecurity]: true,
    };
    await usageOf();

    stored = {
      [ProductKey.DataObservability]: false,
      [ProductKey.DataSecurity]: false,
    };
    await ProjectUsageCache.afterDelete({
      tableName: "DataStore",
      rows: [rowOf()],
    });

    const usage: ProjectUsage = await usageOf();
    expect(usage[ProductKey.DataObservability]).toBe(false);
    expect(usage[ProductKey.DataSecurity]).toBe(false);
    expect(reads).toBe(2);
  });

  test("only its own project's usage is read again", async () => {
    await usageOf(ProjectUsageCache, PROJECT_ID);
    await usageOf(ProjectUsageCache, OTHER_PROJECT_ID);

    await ProjectUsageCache.afterCreate({
      tableName: "Monitor",
      row: rowOf(OTHER_PROJECT_ID),
    });

    await usageOf(ProjectUsageCache, PROJECT_ID);
    expect(reads).toBe(2);

    await usageOf(ProjectUsageCache, OTHER_PROJECT_ID);
    expect(reads).toBe(3);
  });

  test("a record of no product (a label, a note) changes nothing", async () => {
    await usageOf();

    for (const tableName of ["Label", "IncidentInternalNote", "Project", ""]) {
      await ProjectUsageCache.afterCreate({
        tableName: tableName,
        row: rowOf(),
      });
    }
    await ProjectUsageCache.afterCreate({ tableName: null, row: rowOf() });
    await ProjectUsageCache.afterCreate({ tableName: undefined, row: rowOf() });

    await usageOf();
    expect(reads).toBe(1);
    expect(mockRedis.size).toBe(0);
  });

  test("a record with no project it can name changes nothing, and never throws", async () => {
    await usageOf();

    for (const row of [
      null,
      undefined,
      "Monitor",
      42,
      {},
      { projectId: null },
      { projectId: "not-a-project" },
    ]) {
      await expect(
        ProjectUsageCache.afterCreate({ tableName: "Monitor", row: row }),
      ).resolves.toBeUndefined();
    }

    await usageOf();
    expect(reads).toBe(1);
  });

  test("a busy create path has the usage read again once, not once a record", async () => {
    await usageOf();

    for (let incident: number = 0; incident < 50; incident++) {
      await ProjectUsageCache.afterCreate({
        tableName: "Incident",
        row: rowOf(),
      });
      await usageOf();
    }

    expect(reads).toBe(2);
  });

  test("a product the kept usage says is in use already has nothing read again", async () => {
    stored = { [ProductKey.Monitors]: true };
    await usageOf();

    await ProjectUsageCache.afterCreate({
      tableName: "Monitor",
      row: rowOf(),
    });
    await usageOf();

    expect(reads).toBe(1);
    expect(mockRedis.size).toBe(0);
  });

  test("another product's first record still has it read again", async () => {
    await usageOf();

    await ProjectUsageCache.afterCreate({
      tableName: "Monitor",
      row: rowOf(),
    });
    await usageOf();
    await ProjectUsageCache.afterCreate({
      tableName: "OnCallDutyPolicy",
      row: rowOf(),
    });
    await usageOf();

    expect(reads).toBe(3);
  });

  test("after NOTED_TTL_MS a record of the product has it read again", async () => {
    await usageOf();

    await ProjectUsageCache.afterCreate({
      tableName: "Incident",
      row: rowOf(),
    });
    await usageOf();
    expect(reads).toBe(2);

    now += ProjectUsageCache.NOTED_TTL_MS + 1;
    // Read again for the time that passed, and kept anew.
    await usageOf();
    expect(reads).toBe(3);

    await ProjectUsageCache.afterCreate({
      tableName: "Incident",
      row: rowOf(),
    });
    await usageOf();

    expect(reads).toBe(4);
  });

  test("a record created before anything was kept: the first read finds it", async () => {
    stored = { [ProductKey.Monitors]: true };

    await ProjectUsageCache.afterCreate({
      tableName: "Monitor",
      row: rowOf(),
    });

    expect((await usageOf())[ProductKey.Monitors]).toBe(true);
    expect(reads).toBe(1);
  });

  test("a read that was under way when the record was created is never served after it", async () => {
    let releaseRead: () => void = (): void => {};
    let readStarted: () => void = (): void => {};
    const started: Promise<void> = new Promise<void>((resolve: () => void) => {
      readStarted = resolve;
    });

    const slowRead: Promise<ProjectUsage> = ProjectUsageCache.getUsage({
      projectId: PROJECT_ID,
      read: async (): Promise<ProjectUsage> => {
        reads++;
        const before: ProjectUsage = { ...stored };
        readStarted();
        await new Promise<void>((resolve: () => void) => {
          releaseRead = resolve;
        });
        return before;
      },
    });

    // The slow read has its project's generation, and has read the database.
    await started;

    stored = { ...stored, [ProductKey.Monitors]: true };
    await ProjectUsageCache.afterCreate({
      tableName: "Monitor",
      row: rowOf(),
    });

    releaseRead();
    expect((await slowRead)[ProductKey.Monitors]).toBe(false);

    expect((await usageOf())[ProductKey.Monitors]).toBe(true);
  });
});

describe("a product's records deleted", () => {
  test("have the usage read again: with the last one gone it is not set up", async () => {
    stored = { [ProductKey.Monitors]: true };
    await usageOf();

    stored = { [ProductKey.Monitors]: false };
    await ProjectUsageCache.afterDelete({
      tableName: "Monitor",
      rows: [rowOf()],
    });

    expect((await usageOf())[ProductKey.Monitors]).toBe(false);
    expect(reads).toBe(2);
  });

  test("a product emptied and set up again is seen again", async () => {
    await usageOf();

    stored = { [ProductKey.Monitors]: true };
    await ProjectUsageCache.afterCreate({
      tableName: "Monitor",
      row: rowOf(),
    });
    expect((await usageOf())[ProductKey.Monitors]).toBe(true);

    stored = { [ProductKey.Monitors]: false };
    await ProjectUsageCache.afterDelete({
      tableName: "Monitor",
      rows: [rowOf()],
    });
    expect((await usageOf())[ProductKey.Monitors]).toBe(false);

    stored = { [ProductKey.Monitors]: true };
    await ProjectUsageCache.afterCreate({
      tableName: "Monitor",
      row: rowOf(),
    });
    expect((await usageOf())[ProductKey.Monitors]).toBe(true);
    expect(reads).toBe(4);
  });

  test("rows of several projects have each project's usage read again", async () => {
    await usageOf(ProjectUsageCache, PROJECT_ID);
    await usageOf(ProjectUsageCache, OTHER_PROJECT_ID);

    await ProjectUsageCache.afterDelete({
      tableName: "StatusPage",
      rows: [rowOf(PROJECT_ID), rowOf(OTHER_PROJECT_ID), rowOf(PROJECT_ID)],
    });

    await usageOf(ProjectUsageCache, PROJECT_ID);
    await usageOf(ProjectUsageCache, OTHER_PROJECT_ID);
    expect(reads).toBe(4);
  });

  test("records of no product, or no rows, change nothing", async () => {
    await usageOf();

    await ProjectUsageCache.afterDelete({
      tableName: "Label",
      rows: [rowOf()],
    });
    await ProjectUsageCache.afterDelete({ tableName: "Monitor", rows: [] });
    await ProjectUsageCache.afterDelete({
      tableName: "Monitor",
      rows: [null, {}, { projectId: "nope" }],
    });

    await usageOf();
    expect(reads).toBe(1);
  });
});

describe("a telemetry product's first data", () => {
  test("the first logs have the usage read again at once (#7465)", async () => {
    stored = { [ProductKey.Logs]: false };
    await usageOf();

    stored = { [ProductKey.Logs]: true };
    await ProjectUsageCache.afterMilestoneReached({
      projectId: PROJECT_ID,
      milestone: ActivationMilestone.FirstLogsReceived,
    });

    expect((await usageOf())[ProductKey.Logs]).toBe(true);
  });

  const usageMilestones: Array<ActivationMilestone> = Array.from(
    new Set(
      Object.values(PRODUCT_USAGE_MILESTONES).flatMap(
        (
          milestones: ReadonlyArray<ActivationMilestone> | undefined,
        ): ReadonlyArray<ActivationMilestone> => {
          return milestones || [];
        },
      ),
    ),
  );

  test.each(usageMilestones)(
    "%s has the usage read again",
    async (milestone: ActivationMilestone) => {
      await usageOf();

      expect(ProjectUsageCache.isUsageMilestone(milestone)).toBe(true);
      await ProjectUsageCache.afterMilestoneReached({
        projectId: PROJECT_ID,
        milestone: milestone,
      });
      await usageOf();

      expect(reads).toBe(2);
    },
  );

  test("a milestone that says nothing of what is in use changes nothing", async () => {
    await usageOf();

    for (const milestone of Object.values(ActivationMilestone)) {
      if (usageMilestones.includes(milestone)) {
        continue;
      }

      expect(ProjectUsageCache.isUsageMilestone(milestone)).toBe(false);
      await ProjectUsageCache.afterMilestoneReached({
        projectId: PROJECT_ID,
        milestone: milestone,
      });
    }

    await ProjectUsageCache.afterMilestoneReached({
      projectId: null,
      milestone: ActivationMilestone.FirstLogsReceived,
    });

    await usageOf();
    expect(reads).toBe(1);
  });
});

describe("on every server", () => {
  test("a monitor created on another server is seen here within a second", async () => {
    const worker: Cache = anotherServer();

    expect((await usageOf())[ProductKey.Monitors]).toBe(false);

    stored = { ...stored, [ProductKey.Monitors]: true };
    await worker.afterCreate({ tableName: "Monitor", row: rowOf() });

    afterSharedRead();
    expect((await usageOf())[ProductKey.Monitors]).toBe(true);
  });

  test("the first logs the telemetry writer kept are seen by the app server", async () => {
    const telemetryWriter: Cache = anotherServer();
    stored = { [ProductKey.Logs]: false };

    expect((await usageOf())[ProductKey.Logs]).toBe(false);

    stored = { [ProductKey.Logs]: true };
    await telemetryWriter.afterMilestoneReached({
      projectId: PROJECT_ID,
      milestone: ActivationMilestone.FirstLogsReceived,
    });

    afterSharedRead();
    expect((await usageOf())[ProductKey.Logs]).toBe(true);
  });

  test("usage that does not change is read once per server, not once per change elsewhere", async () => {
    const other: Cache = anotherServer();

    await usageOf();
    await usageOf(other);
    expect(reads).toBe(2);

    afterSharedRead();
    await usageOf();
    await usageOf(other);
    expect(reads).toBe(2);
  });

  test("while Redis cannot be reached, a change made here still counts here", async () => {
    mockRedisState.isUp = false;
    await usageOf();

    stored = { ...stored, [ProductKey.Monitors]: true };
    await expect(
      ProjectUsageCache.afterCreate({ tableName: "Monitor", row: rowOf() }),
    ).resolves.toBeUndefined();

    expect((await usageOf())[ProductKey.Monitors]).toBe(true);
  });

  test("a forget asked for by hand is seen everywhere too", async () => {
    const other: Cache = anotherServer();

    await usageOf(other);
    await ProjectUsageCache.forgetProjects([PROJECT_ID, null, undefined, ""]);

    afterSharedRead();
    await usageOf(other);
    expect(reads).toBe(2);
  });
});

describe("nothing here throws", () => {
  test("a generation that cannot be started is a log line, not a failed create or delete", async () => {
    const bump: SpyInstance<CacheGenerations["bump"]> = jest
      .spyOn(CacheGenerations.prototype, "bump")
      .mockRejectedValue(new Error("unexpected") as never);

    await expect(
      ProjectUsageCache.afterCreate({ tableName: "Monitor", row: rowOf() }),
    ).resolves.toBeUndefined();
    await expect(
      ProjectUsageCache.afterDelete({
        tableName: "Monitor",
        rows: [rowOf()],
      }),
    ).resolves.toBeUndefined();
    await expect(
      ProjectUsageCache.afterMilestoneReached({
        projectId: PROJECT_ID,
        milestone: ActivationMilestone.FirstLogsReceived,
      }),
    ).resolves.toBeUndefined();

    expect(bump).toHaveBeenCalledTimes(3);
  });

  test("a generation that cannot be read is a log line, not a failed create", async () => {
    jest
      .spyOn(CacheGenerations.prototype, "get")
      .mockRejectedValue(new Error("unexpected") as never);

    await expect(
      ProjectUsageCache.afterCreate({ tableName: "Monitor", row: rowOf() }),
    ).resolves.toBeUndefined();
  });
});
