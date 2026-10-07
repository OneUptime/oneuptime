import DatabaseService from "../../../Server/Services/DatabaseService";
import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test - `atomicAddToColumnsByIdAndGetValuesWithoutHooks`:
 * the same one-statement, hook-free, no-version-bump add as
 * `atomicAddToColumnsByIdWithoutHooks`, which also answers what the added
 * columns became.
 *
 * It exists for balances that must be seen as the write left them: a
 * message's cost taken from a project's balance, a recharge's credit added
 * to it (ProjectService.deductSmsOrCallBalanceInUSDCents /
 * creditSmsOrCallBalanceInUSDCents). A second read, a moment later, would
 * see other writers' changes too; a value computed before the write and
 * written back would lose them. RETURNING makes the add and the answer one
 * operation.
 */

const FILTER_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

describe("DatabaseService.atomicAddToColumnsByIdAndGetValuesWithoutHooks", () => {
  let service: DatabaseService<LogDropFilter>;
  let captured: Array<CapturedQuery>;
  let answer: unknown;

  beforeEach(() => {
    jest.restoreAllMocks();
    captured = [];
    answer = [{ droppedCount: 42 }];

    service = new DatabaseService<LogDropFilter>(LogDropFilter);

    const columns: Record<string, string> = {
      droppedCount: "droppedCount",
      lastDroppedAt: "lastDroppedAt",
      sortOrder: "sortOrder",
      _id: "_id",
      updatedAt: "updatedAt",
    };

    getJestSpyOn(service, "getRepository").mockReturnValue({
      metadata: {
        tableName: "LogDropFilter",
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
    } as any);
  });

  it("adds in one statement and answers what the column became", async () => {
    expect(
      await service.atomicAddToColumnsByIdAndGetValuesWithoutHooks({
        id: FILTER_ID,
        add: { droppedCount: 5 },
      }),
    ).toEqual({ droppedCount: 42 });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.sql).toBe(
      `WITH "updated" AS (UPDATE "LogDropFilter" SET "droppedCount" = COALESCE("droppedCount", 0) + $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "_id" = $2 RETURNING "droppedCount") SELECT "droppedCount" FROM "updated"`,
    );
    expect(captured[0]!.params).toEqual([5, FILTER_ID.toString()]);
  });

  it("never touches version: an add does not fight somebody editing the row", async () => {
    await service.atomicAddToColumnsByIdAndGetValuesWithoutHooks({
      id: FILTER_ID,
      add: { droppedCount: 1 },
    });

    expect(captured[0]!.sql).not.toContain("version");
  });

  it("sets literal columns in the same statement, bound as parameters", async () => {
    const when: Date = new Date("2026-07-29T05:14:03.000Z");

    await service.atomicAddToColumnsByIdAndGetValuesWithoutHooks({
      id: FILTER_ID,
      add: { droppedCount: -3 },
      set: { lastDroppedAt: when },
    });

    expect(captured[0]!.sql).toContain(`"lastDroppedAt" = $2`);
    expect(captured[0]!.params).toEqual([-3, when, FILTER_ID.toString()]);
  });

  it("answers every added column, by property name", async () => {
    answer = [{ droppedCount: 7, sortOrder: 3 }];

    expect(
      await service.atomicAddToColumnsByIdAndGetValuesWithoutHooks({
        id: FILTER_ID,
        add: { droppedCount: 1, sortOrder: 1 },
      }),
    ).toEqual({ droppedCount: 7, sortOrder: 3 });
    expect(captured[0]!.sql).toContain(
      `RETURNING "droppedCount", "sortOrder") SELECT "droppedCount", "sortOrder"`,
    );
  });

  it("a value that comes back as text (a bigint or numeric column) is a number", async () => {
    answer = [{ droppedCount: "9007199254740" }];

    expect(
      await service.atomicAddToColumnsByIdAndGetValuesWithoutHooks({
        id: FILTER_ID,
        add: { droppedCount: 1 },
      }),
    ).toEqual({ droppedCount: 9007199254740 });
  });

  it("no row (deleted underneath, or never there): null, not a zero that reads as a balance", async () => {
    answer = [];

    expect(
      await service.atomicAddToColumnsByIdAndGetValuesWithoutHooks({
        id: FILTER_ID,
        add: { droppedCount: 1 },
      }),
    ).toBeNull();
  });

  it("an answer that is not a list of rows is null", async () => {
    answer = undefined;

    expect(
      await service.atomicAddToColumnsByIdAndGetValuesWithoutHooks({
        id: FILTER_ID,
        add: { droppedCount: 1 },
      }),
    ).toBeNull();
  });

  it("a column that comes back without a number is an error, never a made-up value", async () => {
    answer = [{ droppedCount: null }];

    await expect(
      service.atomicAddToColumnsByIdAndGetValuesWithoutHooks({
        id: FILTER_ID,
        add: { droppedCount: 1 },
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("refuses a call that adds nothing: there is nothing to answer", async () => {
    await expect(
      service.atomicAddToColumnsByIdAndGetValuesWithoutHooks({
        id: FILTER_ID,
        add: {},
        set: { lastDroppedAt: new Date() },
      }),
    ).rejects.toThrow('"add" must name at least one column');
    expect(captured).toHaveLength(0);
  });

  it("refuses a delta that is not a finite number", async () => {
    await expect(
      service.atomicAddToColumnsByIdAndGetValuesWithoutHooks({
        id: FILTER_ID,
        add: { droppedCount: Number.NaN },
      }),
    ).rejects.toThrow("delta must be a finite number");
    expect(captured).toHaveLength(0);
  });

  it("refuses a column the model does not have", async () => {
    await expect(
      service.atomicAddToColumnsByIdAndGetValuesWithoutHooks({
        id: FILTER_ID,
        add: { notAColumn: 1 } as never,
      }),
    ).rejects.toThrow('unknown column "notAColumn"');
  });

  it("refuses an SQL expression in place of a value", async () => {
    await expect(
      service.atomicAddToColumnsByIdAndGetValuesWithoutHooks({
        id: FILTER_ID,
        add: { droppedCount: 1 },
        set: {
          lastDroppedAt: (() => {
            return "NOW()";
          }) as never,
        },
      }),
    ).rejects.toThrow("SQL-expression values are not supported");
  });

  it("the plain add still answers nothing, and still writes one bare UPDATE", async () => {
    await service.atomicAddToColumnsByIdWithoutHooks({
      id: FILTER_ID,
      add: { droppedCount: 2 },
    });

    expect(captured[0]!.sql).toBe(
      `UPDATE "LogDropFilter" SET "droppedCount" = COALESCE("droppedCount", 0) + $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "_id" = $2`,
    );
  });
});
