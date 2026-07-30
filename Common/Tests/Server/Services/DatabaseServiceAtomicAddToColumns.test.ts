import DatabaseService from "../../../Server/Services/DatabaseService";
import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test — `atomicAddToColumnsByIdWithoutHooks`, the primitive
 * the drop-filter counter flush is built on.
 *
 * Neither existing helper could express this write:
 *
 *   - `updateColumnsByIdWithoutHooks` sets literals, so a counter bump would
 *     have to be a read-modify-write, which loses concurrent writers'
 *     increments (several ingest replicas flush the same filter row).
 *   - `getRepository().increment()` goes through TypeORM's
 *     UpdateQueryBuilder, which always appends `version = version + 1`. An
 *     ingest-driven bump would then fight the optimistic lock on a row a
 *     human may be editing in the dashboard — and it cannot set a second
 *     column (`lastDroppedAt`) in the same statement anyway.
 *
 * So this issues one raw parameterized UPDATE. The tests below pin the three
 * properties that make it safe to run from the ingest path: it adds rather
 * than assigns, it does not touch `version`, and identifiers come from entity
 * metadata rather than from the caller.
 */

const FILTER_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

describe("DatabaseService.atomicAddToColumnsByIdWithoutHooks", () => {
  let service: DatabaseService<LogDropFilter>;
  let captured: Array<CapturedQuery>;

  beforeEach(() => {
    jest.restoreAllMocks();
    captured = [];

    service = new DatabaseService<LogDropFilter>(LogDropFilter);

    /*
     * `getRepository()` needs a live Postgres connection, so the whole
     * repository is stood in for — the same approach the other
     * DatabaseService unit tests take.
     *
     * The stand-in models the two things this method actually reads from
     * TypeORM: metadata (to resolve property names to real column names, and
     * to find the primary key and updatedAt columns) and the driver's
     * persist-value hook. Column names are deliberately spelled out here
     * rather than derived, so if a model rename ever silently changed the
     * generated SQL, these assertions would still be checking the names the
     * migration actually created.
     */
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
            // Identity persist: these tests are about the SQL, not coercion.
            preparePersistentValue: (value: unknown): unknown => {
              return value;
            },
          },
        },
        query: async (
          sql: string,
          params: Array<unknown>,
        ): Promise<Array<unknown>> => {
          captured.push({ sql, params });
          return [];
        },
      },
    } as any);
  });

  it("adds to the column instead of assigning it", async () => {
    await service.atomicAddToColumnsByIdWithoutHooks({
      id: FILTER_ID,
      add: { droppedCount: 42 },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.sql).toContain(
      `"droppedCount" = COALESCE("droppedCount", 0) +`,
    );
  });

  /*
   * COALESCE matters for rows that predate the column, or any future nullable
   * counter: `NULL + 1` is NULL, so without it a counter could stay null
   * forever no matter how many drops happened.
   */
  it("treats a NULL counter as zero rather than propagating NULL", async () => {
    await service.atomicAddToColumnsByIdWithoutHooks({
      id: FILTER_ID,
      add: { droppedCount: 1 },
    });

    expect(captured[0]!.sql).toContain("COALESCE");
  });

  it("binds the delta as a parameter, not as inline SQL", async () => {
    await service.atomicAddToColumnsByIdWithoutHooks({
      id: FILTER_ID,
      add: { droppedCount: 7 },
    });

    expect(captured[0]!.params).toContain(7);
    expect(captured[0]!.sql).not.toContain("7");
  });

  it("sets literal columns in the same statement as the add", async () => {
    const when: Date = new Date("2026-07-29T05:14:03.000Z");

    await service.atomicAddToColumnsByIdWithoutHooks({
      id: FILTER_ID,
      add: { droppedCount: 3 },
      set: { lastDroppedAt: when } as any,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.sql).toContain(`"droppedCount" = COALESCE(`);
    expect(captured[0]!.sql).toContain(`"lastDroppedAt" =`);
    expect(captured[0]!.params).toContain(when);
  });

  /*
   * The reason this helper exists rather than using increment(). A bumped
   * `version` on an ingest write would make the next dashboard save fail its
   * optimistic-lock check for no reason the user could understand.
   */
  it("never bumps the optimistic-lock version column", async () => {
    await service.atomicAddToColumnsByIdWithoutHooks({
      id: FILTER_ID,
      add: { droppedCount: 1 },
      set: { lastDroppedAt: new Date() } as any,
    });

    expect(captured[0]!.sql).not.toContain("version");
  });

  it("refreshes updatedAt so the row does not look stale", async () => {
    await service.atomicAddToColumnsByIdWithoutHooks({
      id: FILTER_ID,
      add: { droppedCount: 1 },
    });

    expect(captured[0]!.sql).toContain(`"updatedAt" = CURRENT_TIMESTAMP`);
  });

  it("scopes the update to the one row by primary key", async () => {
    await service.atomicAddToColumnsByIdWithoutHooks({
      id: FILTER_ID,
      add: { droppedCount: 1 },
    });

    expect(captured[0]!.sql).toMatch(/WHERE "_id" = \$\d+$/);
    expect(captured[0]!.params[captured[0]!.params.length - 1]).toBe(
      FILTER_ID.toString(),
    );
  });

  it("targets the model's real table", async () => {
    await service.atomicAddToColumnsByIdWithoutHooks({
      id: FILTER_ID,
      add: { droppedCount: 1 },
    });

    expect(captured[0]!.sql).toContain(`UPDATE "LogDropFilter"`);
  });

  it("adds to several columns in one statement", async () => {
    await service.atomicAddToColumnsByIdWithoutHooks({
      id: FILTER_ID,
      add: { droppedCount: 2, sortOrder: 1 } as any,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.sql).toContain(`"droppedCount" = COALESCE(`);
    expect(captured[0]!.sql).toContain(`"sortOrder" = COALESCE(`);
  });

  describe("rejects inputs it cannot execute safely", () => {
    it("requires an id", async () => {
      await expect(
        service.atomicAddToColumnsByIdWithoutHooks({
          id: undefined as unknown as ObjectID,
          add: { droppedCount: 1 },
        }),
      ).rejects.toThrow(BadDataException);
    });

    /*
     * Identifiers come from entity metadata, never from the caller, so an
     * unknown property is a programming error rather than an injection
     * vector — but it must fail loudly instead of silently writing nothing.
     */
    it("rejects a column that does not exist on the model", async () => {
      await expect(
        service.atomicAddToColumnsByIdWithoutHooks({
          id: FILTER_ID,
          add: { notAColumn: 1 } as any,
        }),
      ).rejects.toThrow(/unknown column/);
      expect(captured).toHaveLength(0);
    });

    it("rejects a non-numeric delta", async () => {
      for (const bad of ["5", null, undefined, {}, NaN, Infinity]) {
        await expect(
          service.atomicAddToColumnsByIdWithoutHooks({
            id: FILTER_ID,
            add: { droppedCount: bad } as any,
          }),
        ).rejects.toThrow(/finite number/);
      }
      expect(captured).toHaveLength(0);
    });

    it("rejects a SQL-expression value in the literal set", async () => {
      await expect(
        service.atomicAddToColumnsByIdWithoutHooks({
          id: FILTER_ID,
          add: { droppedCount: 1 },
          set: {
            lastDroppedAt: () => {
              return "NOW()";
            },
          } as any,
        }),
      ).rejects.toThrow(/SQL-expression values are not supported/);
    });

    it("issues no statement at all when there is nothing to write", async () => {
      await service.atomicAddToColumnsByIdWithoutHooks({
        id: FILTER_ID,
        add: {},
      });

      expect(captured).toHaveLength(0);
    });
  });
});
