import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * Redis as every server sees it: one map every copy of the cache shares
 * (each copy, loaded on its own, is one server's memory). A write can be
 * held back, to see who waits for it.
 */
const mockRedis: Map<string, string> = new Map<string, string>();
const mockRedisWrites: { gate: Promise<void> | null } = { gate: null };

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: async (
        namespace: string,
        key: string,
      ): Promise<string | null> => {
        return mockRedis.get(`${namespace}-${key}`) || null;
      },
      setString: async (
        namespace: string,
        key: string,
        value: string,
      ): Promise<void> => {
        if (mockRedisWrites.gate) {
          await mockRedisWrites.gate;
        }

        mockRedis.set(`${namespace}-${key}`, value);
      },
    },
  };
});

jest.mock("../../../../Server/Utils/Logger");

import CacheGenerations from "../../../../Server/Infrastructure/CacheGenerations";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import ProjectMilestoneService from "../../../../Server/Services/ProjectMilestoneService";
import TelemetryMilestones, {
  PendingTelemetryMilestones,
} from "../../../../Server/Utils/Activation/TelemetryMilestones";
import ProductAnalytics from "../../../../Server/Utils/ProductAnalytics";
import ProjectUsageCache, {
  ProjectUsage,
} from "../../../../Server/Utils/ProjectProducts/ProjectUsageCache";
import { readFanInWriterOptionsFromEnv } from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import ActivationMilestone from "../../../../Types/Analytics/ActivationMilestone";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import ObjectID from "../../../../Types/ObjectID";
import ProductKey from "../../../../Types/Product/ProductKey";
import {
  CREATE_SETTLE_MS,
  DELETE_SETTLE_MS,
  EXPECT_CHANGE_EVERY_MS,
  EXPECT_CHANGE_FOR_MS,
} from "../../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";

/*
 * THE SERVER'S SIDE OF THE PRODUCTS MENU CATCHING UP AT ONCE (#8204).
 *
 * The Dashboard's products store (ProjectProductsStore) asks again by
 * itself after a delete on the page (DELETE_SETTLE_MS later) and while a
 * setup guide's products are about to be in use (every
 * EXPECT_CHANGE_EVERY_MS, for EXPECT_CHANGE_FOR_MS). Those asks are only
 * worth making if the server's answer has changed by then, on whichever
 * server answers them:
 *
 *   - a delete starts a new generation of the project's usage before the
 *     DELETE returns, and every other server sees it within
 *     CacheGenerations.SHARED_READ_TTL_MS - less than DELETE_SETTLE_MS;
 *   - a create the same, within CREATE_SETTLE_MS;
 *   - a telemetry product's first data, sent by an agent: the telemetry
 *     writer keeps its milestone once ClickHouse took the batch (within
 *     its maxWaitMs), which has the usage read again - here at once and
 *     everywhere within SHARED_READ_TTL_MS, well inside the guide's wait.
 *
 * The Dashboard's side is ProductsMenuCatchesUp.test.tsx; how usage is
 * kept and read again in general, ProjectUsageCache.test.ts and
 * ProductRecordWritesForgetUsage.test.ts.
 */

type Cache = typeof ProjectUsageCache;

const PROJECT_ID: string = "9a000000-0000-4000-8000-00000000e001";

// What the database says the project uses, as a read finds it now.
let stored: ProjectUsage;
let reads: number;
let now: number;

async function usageOn(cache: Cache): Promise<ProjectUsage> {
  return await cache.getUsage({
    projectId: PROJECT_ID,
    read: async (): Promise<ProjectUsage> => {
      reads++;
      return { ...stored };
    },
  });
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

async function flush(): Promise<void> {
  for (let tick: number = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  mockRedis.clear();
  mockRedisWrites.gate = null;
  reads = 0;
  now = Date.UTC(2026, 10, 15, 22, 0, 0);
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });
  ProjectUsageCache.clear();
});

afterEach(() => {
  ProjectUsageCache.clear();
  jest.restoreAllMocks();
});

describe("the store's timings cover the server's", () => {
  test("every server sees a delete or a create before the store asks again after it", () => {
    expect(DELETE_SETTLE_MS).toBeGreaterThan(
      CacheGenerations.SHARED_READ_TTL_MS,
    );
    expect(CREATE_SETTLE_MS).toBeGreaterThan(
      CacheGenerations.SHARED_READ_TTL_MS,
    );
  });

  test("a guide's wait outlasts the telemetry writer's batch, every server seeing it, and one more ask", () => {
    const maxWaitMs: number = readFanInWriterOptionsFromEnv().maxWaitMs;

    expect(maxWaitMs).toBe(5_000);
    expect(EXPECT_CHANGE_FOR_MS).toBeGreaterThanOrEqual(
      maxWaitMs + CacheGenerations.SHARED_READ_TTL_MS + EXPECT_CHANGE_EVERY_MS,
    );
  });

  test("the wait asks a few times, not once a second", () => {
    expect(EXPECT_CHANGE_EVERY_MS).toBeGreaterThan(
      CacheGenerations.SHARED_READ_TTL_MS,
    );
    expect(
      Math.ceil(EXPECT_CHANGE_FOR_MS / EXPECT_CHANGE_EVERY_MS),
    ).toBeLessThanOrEqual(8);
  });
});

describe("2. a delete on the page, on the server", () => {
  test("the delete's new generation is in Redis before the delete returns", async () => {
    let open: () => void = (): void => {};
    mockRedisWrites.gate = new Promise<void>((resolve: () => void) => {
      open = resolve;
    });

    let returned: boolean = false;
    const deleting: Promise<void> = ProjectUsageCache.afterDelete({
      tableName: "Monitor",
      rows: [{ projectId: PROJECT_ID }],
    }).then((): void => {
      returned = true;
    });

    await flush();
    expect(returned).toBe(false);

    open();
    await deleting;

    expect(returned).toBe(true);
    expect(
      Array.from(mockRedis.keys()).some((key: string): boolean => {
        return key.includes(PROJECT_ID);
      }),
    ).toBe(true);
  });

  test("the project's last monitor deleted on another server: the store's ask DELETE_SETTLE_MS later reads Not set up", async () => {
    const appServer: Cache = anotherServer();
    const deletingServer: Cache = anotherServer();
    stored = { [ProductKey.Monitors]: true };

    expect((await usageOn(appServer))[ProductKey.Monitors]).toBe(true);

    stored = { [ProductKey.Monitors]: false };
    await deletingServer.afterDelete({
      tableName: "Monitor",
      rows: [{ projectId: PROJECT_ID }],
    });

    // Asked at once, this server may still go by what it kept.
    expect((await usageOn(appServer))[ProductKey.Monitors]).toBe(true);

    now += DELETE_SETTLE_MS;
    expect((await usageOn(appServer))[ProductKey.Monitors]).toBe(false);
  });

  test("not the last one: the usage is read again, and still in use", async () => {
    const appServer: Cache = anotherServer();
    stored = { [ProductKey.Monitors]: true };
    await usageOn(appServer);

    await ProjectUsageCache.afterDelete({
      tableName: "Monitor",
      rows: [{ projectId: PROJECT_ID }],
    });
    now += DELETE_SETTLE_MS;

    expect((await usageOn(appServer))[ProductKey.Monitors]).toBe(true);
    expect(reads).toBe(2);
  });

  test("nothing changed: the store's ask reads nothing again", async () => {
    const appServer: Cache = anotherServer();
    stored = { [ProductKey.Monitors]: true };
    await usageOn(appServer);

    now += DELETE_SETTLE_MS;
    await usageOn(appServer);
    now += EXPECT_CHANGE_FOR_MS;
    await usageOn(appServer);

    expect(reads).toBe(1);
  });
});

describe("1. a setup guide's first data, on the server", () => {
  let queries: Mock<
    (sql: string, parameters: Array<unknown>) => Promise<unknown>
  >;

  beforeEach(() => {
    ProjectMilestoneService.forgetKnownMilestones();
    queries = jest.fn<
      (sql: string, parameters: Array<unknown>) => Promise<unknown>
    >(async (sql: string): Promise<unknown> => {
      if (sql.startsWith(`INSERT INTO "ProjectMilestone"`)) {
        return [{ _id: ObjectID.generate().toString() }];
      }

      return [];
    });
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(ProjectMilestoneService, "getRepository").mockReturnValue({
      manager: { query: queries },
    } as never);
    jest.spyOn(ProductAnalytics, "isConfigured").mockReturnValue(false);
  });

  afterEach(() => {
    ProjectMilestoneService.forgetKnownMilestones();
  });

  test("the telemetry writer keeps the first logs: the app server reads Logs in use within the guide's wait", async () => {
    const appServer: Cache = anotherServer();
    stored = { [ProductKey.Logs]: false };

    // The guide's moment: the key was used, the logs are not stored yet.
    expect((await usageOn(appServer))[ProductKey.Logs]).toBe(false);

    // What the writer collects as it takes the batch.
    const pending: PendingTelemetryMilestones | null =
      TelemetryMilestones.collect(AnalyticsTableName.Log, [
        { projectId: PROJECT_ID, body: "hello" },
      ]);
    expect(pending).toEqual({
      milestone: ActivationMilestone.FirstLogsReceived,
      projectIds: [PROJECT_ID],
    });

    // ClickHouse took the batch, within maxWaitMs.
    now += readFanInWriterOptionsFromEnv().maxWaitMs;
    stored = { [ProductKey.Logs]: true };
    TelemetryMilestones.markReached(pending);
    await flush();

    expect(queries).toHaveBeenCalledTimes(1);

    // The store's next ask, EXPECT_CHANGE_EVERY_MS on.
    now += EXPECT_CHANGE_EVERY_MS;
    expect((await usageOn(appServer))[ProductKey.Logs]).toBe(true);
  });

  test("the batch's second milestone write changes nothing: the usage is read once more, not once a batch", async () => {
    const appServer: Cache = anotherServer();
    stored = { [ProductKey.Logs]: false };
    await usageOn(appServer);

    stored = { [ProductKey.Logs]: true };
    for (let batch: number = 0; batch < 5; batch++) {
      TelemetryMilestones.markReached(
        TelemetryMilestones.collect(AnalyticsTableName.Log, [
          { projectId: PROJECT_ID },
        ]),
      );
      await flush();
      now += EXPECT_CHANGE_EVERY_MS;
      await usageOn(appServer);
    }

    expect(queries).toHaveBeenCalledTimes(1);
    expect(reads).toBe(2);
  });

  test("a batch ClickHouse refused keeps nothing: Logs stays not set up", async () => {
    const appServer: Cache = anotherServer();
    stored = { [ProductKey.Logs]: false };
    await usageOn(appServer);

    // Collected, but markReached is never called for a refused batch.
    TelemetryMilestones.collect(AnalyticsTableName.Log, [
      { projectId: PROJECT_ID },
    ]);
    now += EXPECT_CHANGE_FOR_MS;

    expect((await usageOn(appServer))[ProductKey.Logs]).toBe(false);
    expect(queries).not.toHaveBeenCalled();
  });
});
