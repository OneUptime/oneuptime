/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import DatabaseServerService, {
  ENGINE_READINGS_CACHE_NAMESPACE,
} from "../../../Server/Services/DatabaseServerService";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import { DatabaseEngineReadings } from "../../../Types/DatabaseServer/DatabaseEngineReadings";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A database's engine readings reach its record through
 * DatabaseServerService.recordEngineReadings: once per database and
 * reporting agent per minute, merged beside the other agents' readings,
 * judged by the engine's alert template lines, and written hook-free with
 * that verdict. The gates are what keep a fleet of databases from turning
 * every metrics batch into an UPDATE, so they run against an in-memory
 * Redis that behaves like the real one; Postgres is faked at the service's
 * own two calls.
 */

const DATABASE_ID: ObjectID = ObjectID.generate();
const PRIMARY: string = "pg-0.internal:5432";
const REPLICA: string = "pg-1.internal:5432";

type ColumnWrite = Parameters<
  typeof DatabaseServerService.updateColumnsByIdIfUnlockedWithoutHooks
>[0];

let cache: Map<string, string> = new Map<string, string>();
let deletedCacheKeys: Array<string> = [];
let writes: Array<ColumnWrite> = [];
let storedRow: DatabaseServer | null = null;
let cacheIsDown: boolean = false;
let writeFails: boolean = false;

function mockCache(): void {
  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        if (cacheIsDown) {
          throw new Error("Cache is not connected");
        }
        const full: string = `${namespace}:${key}`;
        if (cache.has(full)) {
          return false;
        }
        cache.set(full, value);
        return true;
      },
    );
  jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation(async (namespace: string, key: string) => {
      deletedCacheKeys.push(`${namespace}:${key}`);
      cache.delete(`${namespace}:${key}`);
    });
}

function mockRow(): void {
  jest
    .spyOn(DatabaseServerService, "findOneBy")
    .mockImplementation(async () => {
      return storedRow;
    });
  jest
    .spyOn(DatabaseServerService, "updateColumnsByIdIfUnlockedWithoutHooks")
    .mockImplementation(async (input: ColumnWrite) => {
      if (writeFails) {
        throw new Error("value too long for type character varying(100)");
      }
      writes.push(input);
      // The next read sees what was written, as Postgres would.
      if (storedRow) {
        storedRow.engineReadings = (input.data as Record<string, unknown>)[
          "engineReadings"
        ] as DatabaseServer["engineReadings"];
      }
      return true;
    });
}

function row(dbSystem: string): DatabaseServer {
  const model: DatabaseServer = new DatabaseServer();
  model._id = DATABASE_ID.toString();
  model.dbSystem = dbSystem;
  return model;
}

// A new window, as the gate's TTL and the in-process memo would open it.
function nextWindow(): void {
  cache.clear();
  DatabaseServerService.clearEngineReadingsMemo();
}

beforeEach(() => {
  cache = new Map<string, string>();
  deletedCacheKeys = [];
  writes = [];
  storedRow = row("postgresql");
  cacheIsDown = false;
  writeFails = false;
  DatabaseServerService.clearEngineReadingsMemo();
  mockCache();
  mockRow();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const BUSY_PRIMARY: Record<string, number> = {
  "Count|postgresql.connection.max|": 1,
  "Sum|postgresql.backends|": 96,
  "Sum|postgresql.connection.max|": 100,
};

describe("recordEngineReadings: what is written", () => {
  test("the merged readings, when, and the verdict - hook-free, the record's updatedAt left alone", async () => {
    const wrote: boolean = await DatabaseServerService.recordEngineReadings({
      databaseServerId: DATABASE_ID,
      instance: PRIMARY,
      values: BUSY_PRIMARY,
    });

    expect(wrote).toBe(true);
    expect(writes.length).toBe(1);
    const write: ColumnWrite = writes[0]!;
    expect(write.id.toString()).toBe(DATABASE_ID.toString());
    expect(write.skipUpdateDateColumn).toBe(true);

    const data: Record<string, unknown> = write.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual([
      "engineHealth",
      "engineReadings",
      "engineReadingsAt",
    ]);
    const readings: DatabaseEngineReadings =
      data["engineReadings"] as unknown as DatabaseEngineReadings;
    expect(Object.keys(readings.instances)).toEqual([PRIMARY]);
    expect(readings.instances[PRIMARY]!.values).toEqual(BUSY_PRIMARY);
    expect(data["engineReadingsAt"]).toBeInstanceOf(Date);
    // 96% of max_connections crosses PostgreSQL's critical line.
    expect(data["engineHealth"]).toBe("unhealthy");
  });

  test("another agent's readings are kept beside this one's, and judged together", async () => {
    await DatabaseServerService.recordEngineReadings({
      databaseServerId: DATABASE_ID,
      instance: PRIMARY,
      values: BUSY_PRIMARY,
    });
    await DatabaseServerService.recordEngineReadings({
      databaseServerId: DATABASE_ID,
      instance: REPLICA,
      values: {
        "Count|postgresql.connection.max|": 1,
        "Sum|postgresql.backends|": 4,
        "Sum|postgresql.connection.max|": 100,
      },
    });

    expect(writes.length).toBe(2);
    const second: Record<string, unknown> = writes[1]!.data as Record<
      string,
      unknown
    >;
    const readings: DatabaseEngineReadings =
      second["engineReadings"] as unknown as DatabaseEngineReadings;
    expect(Object.keys(readings.instances).sort()).toEqual([
      PRIMARY,
      REPLICA,
    ]);
    // 100 of 200 across both members: the template's own sum, so healthy.
    expect(second["engineHealth"]).toBe("healthy");
  });

  test("an engine with no recommended alerts stores its readings with no verdict", async () => {
    storedRow = row("cockroachdb");
    await DatabaseServerService.recordEngineReadings({
      databaseServerId: DATABASE_ID,
      instance: PRIMARY,
      values: { "Sum|postgresql.backends|": 3 },
    });
    expect((writes[0]!.data as Record<string, unknown>)["engineHealth"]).toBe(
      null,
    );
  });

  test("a batch with no readings writes nothing and claims no window", async () => {
    expect(
      await DatabaseServerService.recordEngineReadings({
        databaseServerId: DATABASE_ID,
        instance: PRIMARY,
        values: {},
      }),
    ).toBe(false);
    expect(writes).toEqual([]);
    expect(cache.size).toBe(0);
  });

  test("a database deleted meanwhile writes nothing", async () => {
    storedRow = null;
    expect(
      await DatabaseServerService.recordEngineReadings({
        databaseServerId: DATABASE_ID,
        instance: PRIMARY,
        values: BUSY_PRIMARY,
      }),
    ).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("recordEngineReadings: at most once a minute per database and agent", () => {
  test("a second batch inside the window writes nothing, a batch in the next one does", async () => {
    for (let batch: number = 0; batch < 5; batch++) {
      await DatabaseServerService.recordEngineReadings({
        databaseServerId: DATABASE_ID,
        instance: PRIMARY,
        values: BUSY_PRIMARY,
      });
    }
    expect(writes.length).toBe(1);

    nextWindow();
    await DatabaseServerService.recordEngineReadings({
      databaseServerId: DATABASE_ID,
      instance: PRIMARY,
      values: BUSY_PRIMARY,
    });
    expect(writes.length).toBe(2);
  });

  test("the window is claimed in Redis under the database and the agent", async () => {
    await DatabaseServerService.recordEngineReadings({
      databaseServerId: DATABASE_ID,
      instance: PRIMARY,
      values: BUSY_PRIMARY,
    });
    expect(Array.from(cache.keys())).toEqual([
      `${ENGINE_READINGS_CACHE_NAMESPACE}:${DATABASE_ID.toString()}:${PRIMARY}`,
    ]);
  });

  test("a window another process claimed holds this one's batch back", async () => {
    cache.set(
      `${ENGINE_READINGS_CACHE_NAMESPACE}:${DATABASE_ID.toString()}:${PRIMARY}`,
      "1",
    );
    expect(
      await DatabaseServerService.recordEngineReadings({
        databaseServerId: DATABASE_ID,
        instance: PRIMARY,
        values: BUSY_PRIMARY,
      }),
    ).toBe(false);
    expect(writes).toEqual([]);
  });

  test("Redis down: the readings are still written, once per process per window", async () => {
    cacheIsDown = true;
    for (let batch: number = 0; batch < 4; batch++) {
      await DatabaseServerService.recordEngineReadings({
        databaseServerId: DATABASE_ID,
        instance: PRIMARY,
        values: BUSY_PRIMARY,
      });
    }
    expect(writes.length).toBe(1);
  });
});

describe("recordEngineReadings: never fails a batch", () => {
  test("a write Postgres refuses is logged, re-opens the window, and does not throw", async () => {
    writeFails = true;
    await expect(
      DatabaseServerService.recordEngineReadings({
        databaseServerId: DATABASE_ID,
        instance: PRIMARY,
        values: BUSY_PRIMARY,
      }),
    ).resolves.toBe(false);
    expect(deletedCacheKeys).toEqual([
      `${ENGINE_READINGS_CACHE_NAMESPACE}:${DATABASE_ID.toString()}:${PRIMARY}`,
    ]);

    // The next batch gets its write.
    writeFails = false;
    expect(
      await DatabaseServerService.recordEngineReadings({
        databaseServerId: DATABASE_ID,
        instance: PRIMARY,
        values: BUSY_PRIMARY,
      }),
    ).toBe(true);
  });

  test("a read that fails does not throw either", async () => {
    jest
      .spyOn(DatabaseServerService, "findOneBy")
      .mockImplementation(async () => {
        throw new Error("connection terminated");
      });
    await expect(
      DatabaseServerService.recordEngineReadings({
        databaseServerId: DATABASE_ID,
        instance: PRIMARY,
        values: BUSY_PRIMARY,
      }),
    ).resolves.toBe(false);
  });
});
