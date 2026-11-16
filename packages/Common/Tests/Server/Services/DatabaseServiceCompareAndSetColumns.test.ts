import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/*
 * compareAndSetColumnsByIdWithoutHooks is updateColumnsByIdWithoutHooks'
 * compare-and-set that says whether it wrote. The subscriber jobs claim a
 * Pending notification with it, and the sweeper fails an interrupted one;
 * both rely on the answer being right, so the SQL and the reading of its
 * result are pinned here.
 *
 * The UPDATE sits in a CTE the statement SELECTs from: TypeORM's postgres
 * query() answers a top-level UPDATE with [rows, rowCount], an array of two
 * whether or not anything matched, so the result length could not tell a
 * write from a miss.
 */

const NOTE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

describe("DatabaseService.compareAndSetColumnsByIdWithoutHooks", () => {
  let service: DatabaseService<IncidentPublicNote>;
  let captured: Array<CapturedQuery>;
  // What the database answers the statement with.
  let answer: unknown;

  beforeEach(() => {
    jest.restoreAllMocks();
    captured = [];
    answer = [{ _id: NOTE_ID.toString() }];

    service = new DatabaseService<IncidentPublicNote>(IncidentPublicNote);

    const columns: Record<string, string> = {
      subscriberNotificationStatusOnNoteCreated:
        "subscriberNotificationStatusOnNoteCreated",
      subscriberNotificationStatusMessage:
        "subscriberNotificationStatusMessage",
      version: "version",
      _id: "_id",
      updatedAt: "updatedAt",
    };

    getJestSpyOn(service, "getRepository").mockReturnValue({
      metadata: {
        tableName: "IncidentPublicNote",
        findColumnWithPropertyName: (
          propertyName: string,
        ): { databaseName: string } | undefined => {
          return columns[propertyName]
            ? { databaseName: columns[propertyName]! }
            : undefined;
        },
        updateDateColumn: { databaseName: "updatedAt" },
        primaryColumns: [{ databaseName: "_id" }],
      },
      manager: {
        connection: {
          driver: {
            preparePersistentValue: (value: unknown): unknown => {
              return value;
            },
          },
        },
        query: async (
          sql: string,
          params: Array<unknown>,
        ): Promise<unknown> => {
          captured.push({ sql, params });
          return answer;
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  function claim(): Promise<boolean> {
    return service.compareAndSetColumnsByIdWithoutHooks({
      id: NOTE_ID,
      data: { subscriberNotificationStatusOnNoteCreated: "InProgress" },
      expectedData: {
        subscriberNotificationStatusOnNoteCreated: "Pending",
        version: 4,
      },
    } as never);
  }

  it("is one statement: the guarded UPDATE, SELECTed from a CTE", async () => {
    await claim();

    expect(captured).toEqual([
      {
        sql:
          `WITH "updated" AS (UPDATE "IncidentPublicNote" SET ` +
          `"subscriberNotificationStatusOnNoteCreated" = $1, "updatedAt" = CURRENT_TIMESTAMP ` +
          `WHERE "_id" = $2 ` +
          `AND "subscriberNotificationStatusOnNoteCreated" IS NOT DISTINCT FROM $3 ` +
          `AND "version" IS NOT DISTINCT FROM $4 ` +
          `RETURNING "_id") SELECT "_id" FROM "updated"`,
        params: ["InProgress", NOTE_ID.toString(), "Pending", 4],
      },
    ]);
  });

  it("never bumps the version it guards on", async () => {
    await claim();

    expect(captured[0]!.sql).not.toMatch(/"version" = /);
  });

  it("answers true when the row matched and was written", async () => {
    await expect(claim()).resolves.toBe(true);
  });

  it("answers false when another writer changed the row first", async () => {
    answer = [];

    await expect(claim()).resolves.toBe(false);
  });

  it("answers false for anything that is not a list of written rows", async () => {
    answer = undefined;

    await expect(claim()).resolves.toBe(false);
  });

  it("leaves updatedAt alone when asked", async () => {
    await service.compareAndSetColumnsByIdWithoutHooks({
      id: NOTE_ID,
      data: { subscriberNotificationStatusOnNoteCreated: "Failed" },
      expectedData: { subscriberNotificationStatusOnNoteCreated: "InProgress" },
      skipUpdateDateColumn: true,
    } as never);

    expect(captured[0]!.sql).not.toContain("updatedAt");
  });

  it("with nothing to set, writes nothing and answers false", async () => {
    await expect(
      service.compareAndSetColumnsByIdWithoutHooks({
        id: NOTE_ID,
        data: {},
        expectedData: { version: 4 },
      } as never),
    ).resolves.toBe(false);

    expect(captured).toEqual([]);
  });

  it("rejects unknown columns, under its own name, before issuing SQL", async () => {
    await expect(
      service.compareAndSetColumnsByIdWithoutHooks({
        id: NOTE_ID,
        data: { notAColumn: "x" },
        expectedData: {},
      } as never),
    ).rejects.toThrow(
      'compareAndSetColumnsByIdWithoutHooks: unknown column "notAColumn"',
    );

    await expect(
      service.compareAndSetColumnsByIdWithoutHooks({
        id: NOTE_ID,
        data: { subscriberNotificationStatusOnNoteCreated: "InProgress" },
        expectedData: { notAColumn: "x" },
      } as never),
    ).rejects.toThrow(
      'compareAndSetColumnsByIdWithoutHooks: unknown expected column "notAColumn"',
    );

    expect(captured).toEqual([]);
  });

  it("the plain write it shares a builder with is unchanged: a bare UPDATE", async () => {
    await service.updateColumnsByIdWithoutHooks({
      id: NOTE_ID,
      data: { subscriberNotificationStatusOnNoteCreated: "InProgress" },
      expectedData: { version: 4 },
    } as never);

    expect(captured[0]!.sql).toBe(
      `UPDATE "IncidentPublicNote" SET "subscriberNotificationStatusOnNoteCreated" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "_id" = $2 AND "version" IS NOT DISTINCT FROM $3`,
    );
  });
});

/*
 * A GUARD ON A TIMESTAMP IS COMPARED TO THE MILLISECOND A READ GIVES (#8173).
 *
 * node-postgres reads a timestamptz to the millisecond and drops the
 * microseconds Postgres keeps. A value a statement stamps with now() or
 * CURRENT_TIMESTAMP keeps them, so compared exactly - "column" IS NOT
 * DISTINCT FROM the Date the caller read - such a guard never matched, and
 * the write was refused on every attempt, with no error. A Date on a
 * timestamp column is now compared with the column cut to the millisecond;
 * everything else exactly, as before.
 * DatabaseServiceTimestampGuardPostgres.test.ts runs the statements on
 * Postgres.
 */
describe("a compare-and-set guard on a timestamp column", () => {
  const STAMPED_AT: Date = new Date("2026-11-15T10:00:00.123Z");

  let service: DatabaseService<IncidentPublicNote>;
  let captured: Array<CapturedQuery>;

  // The columns of the table, by property, with the type TypeORM keeps for each.
  const COLUMNS: Record<string, { databaseName: string; type: unknown }> = {
    // ColumnType.Date, as every date column of a model is declared.
    postedAt: { databaseName: "postedAt", type: "timestamptz" },
    sentAt: { databaseName: "sentAt", type: "timestamp with time zone" },
    seenAt: { databaseName: "seenAt", type: "TIMESTAMPTZ" },
    localAt: { databaseName: "localAt", type: "timestamp" },
    wallAt: { databaseName: "wallAt", type: "timestamp without time zone" },
    // A Date property declared with no type.
    plainAt: { databaseName: "plainAt", type: Date },
    // A day, with no time: not a timestamp.
    onDay: { databaseName: "onDay", type: "date" },
    note: { databaseName: "note", type: "text" },
    version: { databaseName: "version", type: "integer" },
    subscriberNotificationStatusOnNoteCreated: {
      databaseName: "subscriberNotificationStatusOnNoteCreated",
      type: "varchar",
    },
    _id: { databaseName: "_id", type: "uuid" },
    updatedAt: { databaseName: "updatedAt", type: "timestamptz" },
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    captured = [];

    service = new DatabaseService<IncidentPublicNote>(IncidentPublicNote);

    getJestSpyOn(service, "getRepository").mockReturnValue({
      metadata: {
        tableName: "IncidentPublicNote",
        findColumnWithPropertyName: (
          propertyName: string,
        ): { databaseName: string; type: unknown } | undefined => {
          return COLUMNS[propertyName];
        },
        updateDateColumn: { databaseName: "updatedAt" },
        primaryColumns: [{ databaseName: "_id" }],
      },
      manager: {
        connection: {
          driver: {
            // As TypeORM's Postgres driver prepares a timestamptz: as it is.
            preparePersistentValue: (value: unknown): unknown => {
              return value;
            },
          },
        },
        query: async (
          sql: string,
          params: Array<unknown>,
        ): Promise<unknown> => {
          captured.push({ sql, params });
          return [{ _id: NOTE_ID.toString() }];
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  // The WHERE of the statement a compare-and-set guarded by `expectedData` runs.
  async function whereOf(
    expectedData: Record<string, unknown>,
  ): Promise<string> {
    await service.compareAndSetColumnsByIdWithoutHooks({
      id: NOTE_ID,
      data: { note: "claimed" },
      expectedData: expectedData,
      skipUpdateDateColumn: true,
    } as never);

    const sql: string = captured[captured.length - 1]!.sql;

    return sql.slice(sql.indexOf(" WHERE ") + 7, sql.indexOf(" RETURNING "));
  }

  it("compares a Date with the column cut to the millisecond, binding the Date as it is", async () => {
    expect(await whereOf({ postedAt: STAMPED_AT })).toBe(
      `"_id" = $2 AND date_trunc('milliseconds', "postedAt") IS NOT DISTINCT FROM $3`,
    );

    // The instant itself, never text cut to the day or a string of it.
    expect(captured[0]!.params).toEqual([
      "claimed",
      NOTE_ID.toString(),
      STAMPED_AT,
    ]);
    expect(captured[0]!.params[2]).toBe(STAMPED_AT);
  });

  it.each(["postedAt", "sentAt", "seenAt", "localAt", "wallAt", "plainAt"])(
    "takes %s, a timestamp however its type is spelled, for one",
    async (column: string) => {
      expect(await whereOf({ [column]: STAMPED_AT })).toBe(
        `"_id" = $2 AND date_trunc('milliseconds', "${column}") IS NOT DISTINCT FROM $3`,
      );
    },
  );

  it("compares a null guard on a timestamp exactly: only a row with no value matches", async () => {
    expect(await whereOf({ postedAt: null })).toBe(
      `"_id" = $2 AND "postedAt" IS NOT DISTINCT FROM $3`,
    );
    expect(captured[0]!.params[2]).toBeNull();
  });

  it("compares text the caller chose for a timestamp exactly, as it was written", async () => {
    // To the microsecond, say: cutting the column would never match it.
    const text: string = "2026-11-15T10:00:00.123456Z";

    expect(await whereOf({ postedAt: text })).toBe(
      `"_id" = $2 AND "postedAt" IS NOT DISTINCT FROM $3`,
    );
    expect(captured[0]!.params[2]).toBe(text);
  });

  it("compares a Date on a column that is not a timestamp exactly", async () => {
    expect(await whereOf({ onDay: STAMPED_AT })).toBe(
      `"_id" = $2 AND "onDay" IS NOT DISTINCT FROM $3`,
    );
    expect(await whereOf({ note: STAMPED_AT })).toBe(
      `"_id" = $2 AND "note" IS NOT DISTINCT FROM $3`,
    );
  });

  it("leaves every other guard as it was: a number, a text, beside a cut timestamp", async () => {
    expect(
      await whereOf({
        subscriberNotificationStatusOnNoteCreated: "Pending",
        postedAt: STAMPED_AT,
        version: 4,
        sentAt: null,
      }),
    ).toBe(
      `"_id" = $2` +
        ` AND "subscriberNotificationStatusOnNoteCreated" IS NOT DISTINCT FROM $3` +
        ` AND date_trunc('milliseconds', "postedAt") IS NOT DISTINCT FROM $4` +
        ` AND "version" IS NOT DISTINCT FROM $5` +
        ` AND "sentAt" IS NOT DISTINCT FROM $6`,
    );
    expect(captured[0]!.params).toEqual([
      "claimed",
      NOTE_ID.toString(),
      "Pending",
      STAMPED_AT,
      4,
      null,
    ]);
  });

  it("judges the value the driver prepares, not the one given: a Date the driver writes as text is compared exactly", async () => {
    const repository: {
      manager: {
        connection: {
          driver: { preparePersistentValue: (value: unknown) => unknown };
        };
      };
    } = service.getRepository() as never;
    repository.manager.connection.driver.preparePersistentValue = (
      value: unknown,
    ): unknown => {
      return value instanceof Date ? value.toISOString() : value;
    };

    expect(await whereOf({ postedAt: STAMPED_AT })).toBe(
      `"_id" = $2 AND "postedAt" IS NOT DISTINCT FROM $3`,
    );
    expect(captured[0]!.params[2]).toBe(STAMPED_AT.toISOString());
  });

  it("writes a Date it sets as it is: only the guard is cut", async () => {
    await service.compareAndSetColumnsByIdWithoutHooks({
      id: NOTE_ID,
      data: { postedAt: STAMPED_AT },
      expectedData: { postedAt: null },
    } as never);

    expect(captured[0]!.sql).toBe(
      `WITH "updated" AS (UPDATE "IncidentPublicNote" SET "postedAt" = $1, "updatedAt" = CURRENT_TIMESTAMP ` +
        `WHERE "_id" = $2 AND "postedAt" IS NOT DISTINCT FROM $3 ` +
        `RETURNING "_id") SELECT "_id" FROM "updated"`,
    );
    expect(captured[0]!.params).toEqual([STAMPED_AT, NOTE_ID.toString(), null]);
  });

  it("guards the plain write the same way", async () => {
    await service.updateColumnsByIdWithoutHooks({
      id: NOTE_ID,
      data: { note: "claimed" },
      expectedData: { postedAt: STAMPED_AT },
      skipUpdateDateColumn: true,
    } as never);

    expect(captured[0]!.sql).toBe(
      `UPDATE "IncidentPublicNote" SET "note" = $1 WHERE "_id" = $2 AND date_trunc('milliseconds', "postedAt") IS NOT DISTINCT FROM $3`,
    );
  });

  it("guards the write that yields to a lock the same way, inside its locking read", async () => {
    await service.updateColumnsByIdIfUnlockedWithoutHooks({
      id: NOTE_ID,
      data: { note: "claimed" },
      expectedData: { postedAt: STAMPED_AT },
      skipUpdateDateColumn: true,
    } as never);

    expect(captured[0]!.sql).toBe(
      `WITH "updated" AS (UPDATE "IncidentPublicNote" SET "note" = $1 WHERE "_id" IN ` +
        `(SELECT "_id" FROM "IncidentPublicNote" WHERE "_id" = $2 AND date_trunc('milliseconds', "postedAt") IS NOT DISTINCT FROM $3 FOR UPDATE SKIP LOCKED) ` +
        `RETURNING "_id") SELECT "_id" FROM "updated"`,
    );
  });
});
