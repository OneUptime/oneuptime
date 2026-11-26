import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
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

import StorageArrayService, {
  MERGE_COUNTS_BY_KIND_SQL,
} from "../../../Server/Services/StorageArrayService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import ObjectID from "../../../Types/ObjectID";

/*
 * StorageArrayService.mergeCountsByKind (#11000) - what a batch's inventory
 * counts write to StorageArray.countsByKind: each kind the batch listed in
 * full, merged into the row's counts so a kind another scrape counts keeps
 * its count. It keeps only well-formed kinds and whole, non-negative
 * counts; issues no statement when a minute-long cache says the same
 * counts were just written; and answers whether the row changed. The SQL
 * itself runs against Postgres in StorageArrayCountsByKindPostgres.test.ts.
 */

const ARRAY_ID: ObjectID = new ObjectID("0193c0de-7777-4aaa-8bbb-000000000001");

let statements: Array<{ sql: string; parameters: Array<unknown> }> = [];
let rowsReturned: Array<unknown> = [{ _id: ARRAY_ID.toString() }];
let cache: Map<string, string> = new Map();
let cacheFails: boolean = false;
let expiries: Array<number> = [];

beforeEach(() => {
  statements = [];
  rowsReturned = [{ _id: ARRAY_ID.toString() }];
  cache = new Map();
  cacheFails = false;
  expiries = [];
  jest.spyOn(StorageArrayService, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string, parameters: Array<unknown>) => {
        statements.push({ sql, parameters });
        return rowsReturned;
      },
    },
  } as never);
  jest
    .spyOn(GlobalCache, "setStringIfChanged")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds?: number | undefined },
      ): Promise<boolean> => {
        if (cacheFails) {
          throw new Error("Redis is not reachable");
        }
        expiries.push(options?.expiresInSeconds || 0);
        const full: string = `${namespace}:${key}`;
        if (cache.get(full) === value) {
          return false;
        }
        cache.set(full, value);
        return true;
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function merge(countsByKind: Record<string, unknown>): Promise<boolean> {
  return StorageArrayService.mergeCountsByKind({
    storageArrayId: ARRAY_ID,
    countsByKind: countsByKind as Record<string, number>,
  });
}

describe("StorageArrayService.mergeCountsByKind", () => {
  test("merges the counts into the row in one statement, keyed in order", async () => {
    expect(await merge({ Volume: 3, Aggregate: 2, Host: 0 })).toBe(true);

    expect(statements).toEqual([
      {
        sql: MERGE_COUNTS_BY_KIND_SQL,
        parameters: [
          ARRAY_ID.toString(),
          JSON.stringify({ Aggregate: 2, Host: 0, Volume: 3 }),
        ],
      },
    ]);
  });

  test("the statement merges, skips a row it would not change, a deleted row, and a locked one", () => {
    expect(MERGE_COUNTS_BY_KIND_SQL).toContain(
      `SET "countsByKind" = COALESCE("countsByKind", '{}'::jsonb) || $2::jsonb`,
    );
    expect(MERGE_COUNTS_BY_KIND_SQL).toContain(
      `AND NOT (COALESCE("countsByKind", '{}'::jsonb) @> $2::jsonb)`,
    );
    expect(MERGE_COUNTS_BY_KIND_SQL).toContain(`AND "deletedAt" IS NULL`);
    expect(MERGE_COUNTS_BY_KIND_SQL).toContain("FOR UPDATE SKIP LOCKED");
    expect(MERGE_COUNTS_BY_KIND_SQL).toContain(`RETURNING "_id"`);
  });

  test("the same counts again within the minute issue no statement", async () => {
    expect(await merge({ Volume: 3 })).toBe(true);
    expect(await merge({ Volume: 3 })).toBe(false);
    expect(statements).toHaveLength(1);

    // A change goes through at once.
    expect(await merge({ Volume: 4 })).toBe(true);
    expect(statements).toHaveLength(2);
    // The gate holds a write for about a minute.
    for (const seconds of expiries) {
      expect(seconds).toBeGreaterThanOrEqual(60);
      expect(seconds).toBeLessThan(120);
    }
  });

  test("the same counts in another order are the same write", async () => {
    await merge({ Volume: 3, Host: 2 });
    expect(await merge({ Host: 2, Volume: 3 })).toBe(false);
    expect(statements).toHaveLength(1);
  });

  test("answers false when the row did not change: already counted, deleted or busy", async () => {
    rowsReturned = [];
    expect(await merge({ Volume: 3 })).toBe(false);
    expect(statements).toHaveLength(1);
  });

  test("writes anyway when the cache cannot be read", async () => {
    cacheFails = true;
    expect(await merge({ Volume: 3 })).toBe(true);
    expect(await merge({ Volume: 3 })).toBe(true);
    expect(statements).toHaveLength(2);
  });

  test.each([
    ["a kind with a dash", { "storage-vm": 2 }],
    ["a kind with a space", { "Storage VM": 2 }],
    ["a kind starting with a digit", { "3par": 2 }],
    ["an empty kind", { "": 2 }],
    ["a kind of 65 characters", { [`A${"a".repeat(64)}`]: 2 }],
    ["a negative count", { Volume: -1 }],
    ["a fraction", { Volume: 1.5 }],
    ["a count as text", { Volume: "3" }],
    ["no count", { Volume: null }],
    ["an unsafe integer", { Volume: Number.MAX_SAFE_INTEGER + 1 }],
    ["not a number", { Volume: Number.NaN }],
    ["infinity", { Volume: Number.POSITIVE_INFINITY }],
  ] as Array<[string, Record<string, unknown>]>)(
    "%s is never written",
    async (_case: string, countsByKind: Record<string, unknown>) => {
      expect(await merge(countsByKind)).toBe(false);
      expect(statements).toEqual([]);
      // Beside a good count, only the good one is.
      expect(await merge({ ...countsByKind, Volume: 7 })).toBe(true);
      expect(statements[0]!.parameters[1]).toBe(JSON.stringify({ Volume: 7 }));
    },
  );

  test("no counts at all writes nothing and reads no cache", async () => {
    expect(await merge({})).toBe(false);
    expect(statements).toEqual([]);
    expect(expiries).toEqual([]);
  });

  test("a kind named like an Object property is a kind like any other", async () => {
    expect(await merge({ constructor: 1, toString: 2 })).toBe(true);
    expect(JSON.parse(statements[0]!.parameters[1] as string)).toEqual({
      constructor: 1,
      toString: 2,
    });
  });
});
