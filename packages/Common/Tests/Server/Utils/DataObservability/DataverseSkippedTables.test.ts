import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DataverseApi from "../../../../Server/Utils/DataObservability/DataverseApi";
import SkippedTableMemory, {
  fingerprintOf,
} from "../../../../Server/Utils/DataObservability/SkippedTableMemory";
import {
  collectTableHealth,
  CollectedTable,
  describeWaitingDataverseTables,
  TableHealthCollectOptions,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import DataSourceHttpFetch, {
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  getSkippedTableWaitInMinutes,
  MAX_SKIPPED_TABLES,
  readSkippedTables,
  SKIPPED_TABLE_LONGEST_WAIT_IN_MINUTES,
  SkippedTable,
  SkippedTableRead,
  SkippedTables,
} from "../../../../Types/DataObservability/SkippedTables";
import { JSONObject } from "../../../../Types/JSON";
import FakeDataverse, {
  FAKE_TABLES,
  FakeRequest,
  FakeTable,
  fakeConnectionString,
  fakeError,
} from "./FakeDataverse";

/*
 * ISSUE #9541: A TABLE DATAVERSE ALWAYS REFUSES WAS FOUND AGAIN EVERY FIVE
 * MINUTES.
 *
 * Since #9506 a read Dataverse fails for a group of tables is asked again
 * in smaller parts, so one table it cannot read leaves out only itself -
 * at a cost: a count of fifty tables is halved until the table at fault is
 * left, about 13 requests, and twenty tables' columns are read one by one.
 * Nothing was remembered, so a table Dataverse always refuses cost that at
 * every collection. Now a collection keeps what it was refused (SkippedTables,
 * on the store) and the next ones skip it:
 *
 *  - a remembered table is left out of the groups, so a healthy group is
 *    never split for it again, and is skipped until its next try;
 *  - its next try comes after an hour, then two, four, up to a day, and it
 *    is asked on its own; one that reads again is forgotten;
 *  - a change to the environment's table list, or to the app reading it,
 *    starts every table over;
 *  - a read that failed for every table is an outage, and nothing is
 *    remembered for it.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const BAD: string = "cr123_bad";
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");

function minutesFrom(time: Date, minutes: number): string {
  return new Date(time.getTime() + minutes * 60_000).toISOString();
}

// An environment of fifty counted tables of its own, one of which Dataverse cannot count.
function fiftyTables(): Array<FakeTable> {
  return [
    { logicalName: BAD, isCustomEntity: true, rows: 1, changedSecondsAgo: 60 },
    ...Array.from({ length: 49 }, (_: unknown, index: number): FakeTable => {
      return {
        logicalName: `cr123_t${String(index).padStart(2, "0")}`,
        isCustomEntity: true,
        rows: index,
        changedSecondsAgo: 60,
      };
    }),
  ];
}

function isCount(request: FakeRequest): boolean {
  return request.path === "/RetrieveTotalRecordCount(EntityNames=@p1)";
}

function namesCounted(request: FakeRequest): Array<string> {
  return JSON.parse(request.query.get("@p1") || "[]") as Array<string>;
}

function isColumnRead(request: FakeRequest): boolean {
  return request.path === "/EntityDefinitions" && request.query.has("$expand");
}

// Dataverse's answer to a count that names the table it cannot count.
function refuseToCount(
  table: string,
): (request: FakeRequest) => DataSourceHttpResponse | null {
  return (request: FakeRequest): DataSourceHttpResponse | null => {
    return isCount(request) && namesCounted(request).includes(table)
      ? fakeError(
          400,
          "0x80040217",
          `The entity with a name = '${table}' was not found in the MetadataCache.`,
        )
      : null;
  };
}

function useFake(fake: FakeDataverse): void {
  jest.spyOn(DataSourceHttpFetch, "fetch").mockImplementation(fake.transport);
  jest.spyOn(DataverseApi, "sleep").mockResolvedValue(undefined);
}

async function collect(
  options: Partial<TableHealthCollectOptions> = {},
  connection: JSONObject = {},
): Promise<TableHealthSnapshot> {
  return await collectTableHealth(
    { engine: "dataverse", connectionString: fakeConnectionString(connection) },
    { maxTables: 100, maxColumns: 10_000, exclusions: [], ...options },
  );
}

function tableOf(snapshot: TableHealthSnapshot, name: string): CollectedTable {
  const found: CollectedTable | undefined = snapshot.tables.find(
    (table: CollectedTable): boolean => {
      return table.name === name;
    },
  );

  if (!found) {
    throw new Error(`No table ${name}`);
  }

  return found;
}

// The skipped tables of a snapshot, as the next collection is handed them: their next try come.
function dueNow(skipped: SkippedTables | null | undefined): SkippedTables {
  if (!skipped) {
    throw new Error("Nothing was skipped.");
  }

  return {
    ...skipped,
    tables: skipped.tables.map((table: SkippedTable): SkippedTable => {
      return {
        ...table,
        nextTryAt: new Date(Date.now() - 1_000).toISOString(),
      };
    }),
  };
}

describe("how long a refused table waits", () => {
  test("an hour, then twice as long at each refusal in a row, a day at most", () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7, 50].map((refusals: number): number => {
        return getSkippedTableWaitInMinutes(refusals);
      }),
    ).toEqual([60, 120, 240, 480, 960, 1440, 1440, 1440]);
    expect(getSkippedTableWaitInMinutes(0)).toBe(60);
    expect(getSkippedTableWaitInMinutes(Number.NaN)).toBe(60);
  });
});

describe("what the store remembers, read strictly", () => {
  const ENTRY: JSONObject = {
    table: "cr123_secret",
    read: SkippedTableRead.RowCount,
    reason: "Dataverse refused the app (403, 0x80040220): no read privilege.",
    since: NOW.toISOString(),
    refusals: 2,
    nextTryAt: minutesFrom(NOW, 120),
  };

  test("a table, a read OneUptime knows, and times that parse", () => {
    expect(
      readSkippedTables({ fingerprint: "abc", tables: [ENTRY] }, NOW),
    ).toEqual({ fingerprint: "abc", tables: [ENTRY] });
  });

  test("anything else is left out, and nothing left is none", () => {
    expect(readSkippedTables(null, NOW)).toBe(null);
    expect(readSkippedTables([], NOW)).toBe(null);
    expect(readSkippedTables({ tables: "x" }, NOW)).toBe(null);
    expect(
      readSkippedTables(
        {
          fingerprint: "abc",
          tables: [
            { ...ENTRY, read: "Rows" },
            { ...ENTRY, table: "" },
            { ...ENTRY, since: "yesterday" },
            { ...ENTRY, nextTryAt: 5 },
            "cr123_secret",
          ],
        },
        NOW,
      ),
    ).toBe(null);
  });

  test("a table and read named twice is kept once; refusals are a whole number of one or more", () => {
    const read: SkippedTables | null = readSkippedTables(
      {
        fingerprint: "abc",
        tables: [
          { ...ENTRY, refusals: 0 },
          { ...ENTRY, reason: "again" },
          { ...ENTRY, read: SkippedTableRead.Columns, refusals: 2.7 },
        ],
      },
      NOW,
    );

    expect(
      read!.tables.map((table: SkippedTable): string => {
        return `${table.read}:${table.refusals}:${table.reason.slice(0, 8)}`;
      }),
    ).toEqual(["RowCount:1:Datavers", "Columns:2:Datavers"]);
  });

  test("a next try further ahead than a day is read as the longest wait, so no table is left out for longer", () => {
    const read: SkippedTables | null = readSkippedTables(
      {
        fingerprint: "abc",
        tables: [{ ...ENTRY, nextTryAt: "2030-01-01T00:00:00.000Z" }],
      },
      NOW,
    );

    expect(Date.parse(read!.tables[0]!.nextTryAt)).toBeLessThanOrEqual(
      NOW.getTime() + (SKIPPED_TABLE_LONGEST_WAIT_IN_MINUTES + 60) * 60_000,
    );
  });

  test("a store remembers a bounded number of tables, and bounded words", () => {
    const read: SkippedTables | null = readSkippedTables(
      {
        fingerprint: "f".repeat(1_000),
        tables: Array.from(
          { length: MAX_SKIPPED_TABLES + 50 },
          (_: unknown, index: number): JSONObject => {
            return { ...ENTRY, table: `t${index}`, reason: "x".repeat(5_000) };
          },
        ),
      },
      NOW,
    );

    expect(read!.tables).toHaveLength(MAX_SKIPPED_TABLES);
    expect(read!.fingerprint.length).toBeLessThanOrEqual(128);
    expect(read!.tables[0]!.reason.length).toBeLessThanOrEqual(300);
  });
});

describe("one collection's memory", () => {
  const PREVIOUS: SkippedTables = {
    fingerprint: "env-1",
    tables: [
      {
        table: "cr123_secret",
        read: SkippedTableRead.RowCount,
        reason: "refused",
        since: minutesFrom(NOW, -300),
        refusals: 3,
        nextTryAt: minutesFrom(NOW, 30),
      },
      {
        table: "cr123_old",
        read: SkippedTableRead.Columns,
        reason: "refused",
        since: minutesFrom(NOW, -90),
        refusals: 1,
        nextTryAt: minutesFrom(NOW, -30),
      },
    ],
  };

  test("a table whose next try has not come waits; one whose has is due", () => {
    const memory: SkippedTableMemory = new SkippedTableMemory({
      previous: PREVIOUS,
      fingerprint: "env-1",
      now: NOW,
    });

    expect(memory.isWaiting("cr123_secret", SkippedTableRead.RowCount)).toBe(
      true,
    );
    expect(memory.isDue("cr123_secret", SkippedTableRead.RowCount)).toBe(false);
    expect(memory.isDue("cr123_old", SkippedTableRead.Columns)).toBe(true);
    expect(memory.isRemembered("cr123_old", SkippedTableRead.RowCount)).toBe(
      false,
    );
    expect(memory.isStartedOver).toBe(false);
  });

  test("refused again, a table waits twice as long, and keeps when it was first refused", () => {
    const memory: SkippedTableMemory = new SkippedTableMemory({
      previous: PREVIOUS,
      fingerprint: "env-1",
      now: NOW,
    });

    memory.refused("cr123_old", SkippedTableRead.Columns, "refused again");

    const entry: SkippedTable = memory
      .toSkippedTables()!
      .tables.find((table: SkippedTable): boolean => {
        return table.table === "cr123_old";
      })!;

    expect(entry).toEqual({
      table: "cr123_old",
      read: SkippedTableRead.Columns,
      reason: "refused again",
      since: minutesFrom(NOW, -90),
      refusals: 2,
      nextTryAt: minutesFrom(NOW, 120),
    });
  });

  test("a table that answers is forgotten; when none is left, nothing is kept", () => {
    const memory: SkippedTableMemory = new SkippedTableMemory({
      previous: PREVIOUS,
      fingerprint: "env-1",
      now: NOW,
    });

    memory.answered("cr123_old", SkippedTableRead.Columns);
    expect(memory.toSkippedTables()!.tables).toHaveLength(1);

    memory.answered("cr123_secret", SkippedTableRead.RowCount);
    expect(memory.toSkippedTables()).toBe(null);
  });

  test("another table list or app starts every table over; a partial list changes nothing", () => {
    expect(
      new SkippedTableMemory({
        previous: PREVIOUS,
        fingerprint: "env-2",
        now: NOW,
      }),
    ).toMatchObject({ isStartedOver: true });
    expect(
      new SkippedTableMemory({
        previous: PREVIOUS,
        fingerprint: "env-2",
        now: NOW,
      }).toSkippedTables(),
    ).toBe(null);

    const partial: SkippedTableMemory = new SkippedTableMemory({
      previous: PREVIOUS,
      fingerprint: null,
      now: NOW,
    });

    expect(partial.isStartedOver).toBe(false);
    // As it was, in table order.
    expect(partial.toSkippedTables()).toEqual({
      ...PREVIOUS,
      tables: [PREVIOUS.tables[1], PREVIOUS.tables[0]],
    });
  });

  test("a table no longer watched, or no longer read so, is dropped from that read only", () => {
    const memory: SkippedTableMemory = new SkippedTableMemory({
      previous: PREVIOUS,
      fingerprint: "env-1",
      now: NOW,
    });

    memory.keepOnly(SkippedTableRead.RowCount, ["account"]);

    expect(
      memory.toSkippedTables()!.tables.map((table: SkippedTable): string => {
        return table.table;
      }),
    ).toEqual(["cr123_old"]);
  });

  test("the tables skipped this time are those still waiting, in table order", () => {
    const memory: SkippedTableMemory = new SkippedTableMemory({
      previous: PREVIOUS,
      fingerprint: "env-1",
      now: NOW,
    });

    expect(
      memory.waiting().map((table: SkippedTable): string => {
        return table.table;
      }),
    ).toEqual(["cr123_secret"]);
    expect(memory.waiting(SkippedTableRead.Columns)).toEqual([]);
  });

  test("a fingerprint changes with any of its parts and their order", () => {
    expect(fingerprintOf(["a", "b"])).toBe(fingerprintOf(["a", "b"]));
    expect(fingerprintOf(["a", "b"])).not.toBe(fingerprintOf(["b", "a"]));
    expect(fingerprintOf(["a", "b"])).not.toBe(fingerprintOf(["a", "b", "c"]));
  });
});

describe("issue #9541: a table Dataverse cannot count is found once, then skipped", () => {
  test("the first collection halves the count to find it; the second makes no halving request", async () => {
    const fake: FakeDataverse = new FakeDataverse(fiftyTables()).answer(
      refuseToCount(BAD),
    );

    useFake(fake);

    const first: TableHealthSnapshot = await collect();
    const firstCounts: number = fake.requests.filter(isCount).length;

    // The group, then two halves at each of six levels.
    expect(firstCounts).toBe(13);
    expect(tableOf(first, BAD).estimatedRows).toBe(null);
    expect(first.skippedTables!.tables).toEqual([
      {
        table: BAD,
        read: SkippedTableRead.RowCount,
        reason: `Dataverse answered 400 (0x80040217): The entity with a name = '${BAD}' was not found in the MetadataCache.`,
        since: expect.any(String),
        refusals: 1,
        nextTryAt: expect.any(String),
      },
    ]);
    // An hour from now.
    expect(
      Date.parse(first.skippedTables!.tables[0]!.nextTryAt) -
        Date.parse(first.skippedTables!.tables[0]!.since),
    ).toBe(60 * 60_000);

    const second: TableHealthSnapshot = await collect({
      skippedTables: first.skippedTables,
    });
    const secondCounts: Array<FakeRequest> = fake.requests
      .filter(isCount)
      .slice(firstCounts);

    // One count of the 49 others, and nothing of the table refused before.
    expect(secondCounts).toHaveLength(1);
    expect(namesCounted(secondCounts[0]!)).toHaveLength(49);
    expect(namesCounted(secondCounts[0]!)).not.toContain(BAD);
    expect(tableOf(second, "cr123_t07").estimatedRows).toBe(7);
    expect(tableOf(second, BAD).estimatedRows).toBe(null);
    // It is still remembered, its wait unchanged.
    expect(second.skippedTables).toEqual(first.skippedTables);
    expect(second.warnings).toEqual([
      `1 table Dataverse refused before is skipped until its next try (${BAD}). Collect Now asks it again at once.`,
    ]);
  });

  test("when its next try comes, it is counted on its own: refused again, it waits twice as long", async () => {
    const fake: FakeDataverse = new FakeDataverse(fiftyTables()).answer(
      refuseToCount(BAD),
    );

    useFake(fake);

    const first: TableHealthSnapshot = await collect();
    const before: number = fake.requests.filter(isCount).length;
    const again: TableHealthSnapshot = await collect({
      skippedTables: dueNow(first.skippedTables),
    });
    const counts: Array<FakeRequest> = fake.requests
      .filter(isCount)
      .slice(before);

    // The 49 together, then the table refused before on its own: never halving the group again.
    expect(counts.map(namesCounted)).toEqual([
      expect.not.arrayContaining([BAD]),
      [BAD],
    ]);
    expect(again.skippedTables!.tables[0]!.refusals).toBe(2);
    expect(
      Date.parse(again.skippedTables!.tables[0]!.nextTryAt) - Date.now(),
    ).toBeGreaterThan(119 * 60_000);
    expect(again.skippedTables!.tables[0]!.since).toBe(
      first.skippedTables!.tables[0]!.since,
    );
  });

  test("a table that reads again is forgotten at once", async () => {
    let isRefused: boolean = true;
    const fake: FakeDataverse = new FakeDataverse(fiftyTables()).answer(
      (request: FakeRequest): DataSourceHttpResponse | null => {
        return isRefused ? refuseToCount(BAD)(request) : null;
      },
    );

    useFake(fake);

    const first: TableHealthSnapshot = await collect();

    isRefused = false;

    const fixed: TableHealthSnapshot = await collect({
      skippedTables: dueNow(first.skippedTables),
    });

    expect(tableOf(fixed, BAD).estimatedRows).toBe(1);
    expect(fixed.skippedTables).toBe(null);
    expect(fixed.warnings).toEqual([]);
  });

  test("a change to the environment's table list starts every table over", async () => {
    const fake: FakeDataverse = new FakeDataverse(fiftyTables()).answer(
      refuseToCount(BAD),
    );

    useFake(fake);

    const first: TableHealthSnapshot = await collect();

    fake.tables.push({
      logicalName: "cr123_new",
      isCustomEntity: true,
      rows: 3,
      changedSecondsAgo: 60,
    });

    const before: number = fake.requests.filter(isCount).length;
    const after: TableHealthSnapshot = await collect({
      skippedTables: first.skippedTables,
    });

    // The table refused before is in the groups again, found again, and remembered afresh.
    expect(
      fake.requests
        .filter(isCount)
        .slice(before)
        .some((request: FakeRequest): boolean => {
          return (
            namesCounted(request).length > 2 &&
            namesCounted(request).includes(BAD)
          );
        }),
    ).toBe(true);
    expect(after.skippedTables!.tables[0]!.refusals).toBe(1);
    expect(after.skippedTables!.fingerprint).not.toBe(
      first.skippedTables!.fingerprint,
    );
  });

  test("another app reading the environment starts every table over", async () => {
    const fake: FakeDataverse = new FakeDataverse(fiftyTables()).answer(
      refuseToCount(BAD),
    );

    useFake(fake);

    const first: TableHealthSnapshot = await collect();
    const other: TableHealthSnapshot = await collect(
      { skippedTables: first.skippedTables },
      { clientId: "99999999-8888-7777-6666-555555555555" },
    );

    expect(other.skippedTables!.fingerprint).not.toBe(
      first.skippedTables!.fingerprint,
    );
    expect(other.skippedTables!.tables[0]!.refusals).toBe(1);
  });

  test("a count Dataverse fails for every table is an outage of the count: nothing is remembered", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest): DataSourceHttpResponse | null => {
        return isCount(request)
          ? fakeError(500, "0x80040216", "Snapshot unavailable.")
          : null;
      },
    );

    useFake(fake);

    const snapshot: TableHealthSnapshot = await collect();

    expect(tableOf(snapshot, "account").estimatedRows).toBe(null);
    expect(snapshot.skippedTables).toBe(null);
  });

  test("a table no longer watched is forgotten", async () => {
    const fake: FakeDataverse = new FakeDataverse(fiftyTables()).answer(
      refuseToCount(BAD),
    );

    useFake(fake);

    const first: TableHealthSnapshot = await collect();
    const excluded: TableHealthSnapshot = await collect({
      skippedTables: first.skippedTables,
      exclusions: [BAD],
    });

    expect(excluded.skippedTables).toBe(null);
  });

  test("a table list read in smaller requests changes nothing remembered", async () => {
    const remembered: SkippedTables = {
      fingerprint: "the-whole-list",
      tables: [
        {
          table: "account",
          read: SkippedTableRead.RowCount,
          reason: "refused",
          since: minutesFrom(new Date(), -10),
          refusals: 1,
          nextTryAt: minutesFrom(new Date(), 50),
        },
      ],
    };
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest): DataSourceHttpResponse | null => {
        return request.path === "/EntityDefinitions" &&
          !request.query.has("$filter") &&
          !request.query.has("$expand")
          ? fakeError(500, "0x80040216", "An unexpected error occurred.")
          : null;
      },
    );

    useFake(fake);

    const snapshot: TableHealthSnapshot = await collect({
      skippedTables: remembered,
    });

    expect(snapshot.isComplete).toBe(false);
    expect(snapshot.skippedTables).toEqual(remembered);
    expect(
      fake.requests.filter(isCount).some((request: FakeRequest): boolean => {
        return namesCounted(request).includes("account");
      }),
    ).toBe(false);
  });
});

describe("the columns and the last change remember their refusals too", () => {
  test("a table whose columns Dataverse fails keeps the columns it had until its next try, then is read on its own", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest): DataSourceHttpResponse | null => {
        return isColumnRead(request) &&
          (request.query.get("$filter") || "").includes("'email'")
          ? fakeError(500, "0x80040216", "An unexpected error occurred.")
          : null;
      },
    );

    useFake(fake);

    const first: TableHealthSnapshot = await collect({
      queryHistoryLookbackInSeconds: 3600,
    });

    expect(first.skippedTables!.tables).toEqual([
      expect.objectContaining({
        table: "email",
        read: SkippedTableRead.Columns,
        refusals: 1,
      }),
    ]);

    const before: number = fake.requests.filter(isColumnRead).length;
    const second: TableHealthSnapshot = await collect({
      queryHistoryLookbackInSeconds: 3600,
      skippedTables: first.skippedTables,
    });
    const reads: Array<FakeRequest> = fake.requests
      .filter(isColumnRead)
      .slice(before);

    // One read of the other tables' columns, never split, and nothing of email.
    expect(reads).toHaveLength(1);
    expect(reads[0]!.query.get("$filter")).not.toContain("'email'");
    expect(tableOf(second, "email").columns).toBe(null);
    expect(tableOf(second, "email").columnsNotRead).toBe(true);
    expect(tableOf(second, "account").columns).toHaveLength(2);

    const due: TableHealthSnapshot = await collect({
      queryHistoryLookbackInSeconds: 3600,
      skippedTables: dueNow(second.skippedTables),
    });
    const dueReads: Array<FakeRequest> = fake.requests
      .filter(isColumnRead)
      .slice(before + reads.length);

    // The others' columns, then email on its own: asked three times, as any read that fails for a moment.
    expect(dueReads).toHaveLength(1 + 3);
    expect(
      dueReads.slice(1).map((request: FakeRequest): string | null => {
        return request.query.get("$filter");
      }),
    ).toEqual([
      "LogicalName eq 'email'",
      "LogicalName eq 'email'",
      "LogicalName eq 'email'",
    ]);
    expect(due.skippedTables!.tables[0]!.refusals).toBe(2);
  });

  test("a collection that reads no columns leaves their refusals as they were, and says nothing of them", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest): DataSourceHttpResponse | null => {
        return isColumnRead(request) &&
          (request.query.get("$filter") || "").includes("'email'")
          ? fakeError(500, "0x80040216", "An unexpected error occurred.")
          : null;
      },
    );

    useFake(fake);

    const hourly: TableHealthSnapshot = await collect({
      queryHistoryLookbackInSeconds: 3600,
    });
    const before: number = fake.requests.length;
    // The four collections of each hour after its first read no columns.
    const between: TableHealthSnapshot = await collect({
      skippedTables: hourly.skippedTables,
    });

    expect(between.skippedTables).toEqual(hourly.skippedTables);
    expect(between.warnings).toEqual([]);
    expect(fake.requests.slice(before).filter(isColumnRead)).toEqual([]);
  });

  test("a table whose newest row the app may not read is skipped until its next try", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest): DataSourceHttpResponse | null => {
        return request.path === "/contacts"
          ? fakeError(
              403,
              "0x80040220",
              "Principal user is missing prvReadContact privilege.",
            )
          : null;
      },
    );

    useFake(fake);

    const first: TableHealthSnapshot = await collect();

    expect(first.skippedTables!.tables).toEqual([
      expect.objectContaining({
        table: "contact",
        read: SkippedTableRead.LastChange,
        reason:
          "Dataverse refused the app (403, 0x80040220): Principal user is missing prvReadContact privilege.",
      }),
    ]);

    const before: number = fake.requests.length;

    await collect({ skippedTables: first.skippedTables });

    expect(
      fake.requests.slice(before).some((request: FakeRequest): boolean => {
        return request.path === "/contacts";
      }),
    ).toBe(false);
  });
});

describe("what a collection says of the tables it skipped", () => {
  test("how many, which, and that Collect Now asks again at once", () => {
    const entry: SkippedTable = {
      table: "cr123_a",
      read: SkippedTableRead.RowCount,
      reason: "refused",
      since: NOW.toISOString(),
      refusals: 1,
      nextTryAt: minutesFrom(NOW, 60),
    };

    expect(describeWaitingDataverseTables([])).toBe(null);
    expect(
      describeWaitingDataverseTables([
        entry,
        { ...entry, read: SkippedTableRead.Columns },
      ]),
    ).toBe(
      "1 table Dataverse refused before is skipped until its next try (cr123_a). Collect Now asks it again at once.",
    );
    expect(
      describeWaitingDataverseTables(
        ["cr123_a", "cr123_b", "cr123_c", "cr123_d", "cr123_e", "cr123_f"].map(
          (table: string): SkippedTable => {
            return { ...entry, table };
          },
        ),
      ),
    ).toBe(
      "6 tables Dataverse refused before are skipped until their next try (cr123_a, cr123_b, cr123_c, cr123_d, cr123_e, ...). Collect Now asks them again at once.",
    );
  });

  test("the default tables, all read, skip nothing", async () => {
    useFake(new FakeDataverse(FAKE_TABLES));

    const snapshot: TableHealthSnapshot = await collect();

    expect(snapshot.skippedTables).toBe(null);
    expect(snapshot.warnings).toEqual([]);
  });
});
