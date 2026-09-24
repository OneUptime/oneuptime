import DatabaseService from "../../../Server/Services/DatabaseService";
import Service from "../../../Models/DatabaseModels/Service";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { PostgresDriver } from "typeorm/driver/postgres/PostgresDriver";
import { PostgresQueryRunner } from "typeorm/driver/postgres/PostgresQueryRunner";

/*
 * Whether `updateColumnsByIdIfUnlockedWithoutHooks` can tell a skipped write
 * from an applied one, through TypeORM's REAL postgres query runner.
 *
 * The neighbouring SQL suite fakes `manager.query` and hands back a plain
 * rows array - which is not what TypeORM does. Its postgres runner answers a
 * statement whose top-level command is UPDATE (or DELETE) with
 * `[rows, rowCount]`: an array of length two whether or not a row was
 * written. The primitive used to issue a bare `UPDATE ... RETURNING` and test
 * `result.length > 0`, so every write that SKIP LOCKED skipped - or that hit
 * a row that no longer exists - read as applied, and no caller's retry path
 * (ResourceHeartbeat, ServiceService, EntityRegistry) could ever run.
 *
 * Here the runner is TypeORM's own; only the pg client under it is faked,
 * and it answers the way Postgres does: `command` is the statement's
 * top-level tag (a data-modifying CTE read by a SELECT is a SELECT), `rows`
 * the RETURNING rows, `rowCount` their number. No Postgres, no Redis - the
 * real-Postgres counterpart is DatabaseServiceUpdateColumnsIfUnlockedPostgres.
 */

const SERVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

interface PgReply {
  command: string;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

// Postgres' command tag: the first keyword of the statement.
function commandOf(sql: string): string {
  const keyword: string = (sql.trim().split(/\s+/)[0] || "").toUpperCase();
  return keyword === "WITH" ? "SELECT" : keyword;
}

describe("updateColumnsByIdIfUnlockedWithoutHooks through TypeORM's postgres runner", () => {
  let service: DatabaseService<Service>;
  let runner: PostgresQueryRunner;
  let statements: Array<string>;
  // What the UPDATE's RETURNING yields: the row, or nothing (locked / gone).
  let rowWritten: boolean;

  beforeEach(() => {
    jest.restoreAllMocks();
    statements = [];
    rowWritten = true;

    const fakeDriver: unknown = {
      options: {},
      isReplicated: false,
      connection: {
        subscribers: [],
        logger: {
          logQuery: (): void => {},
          logQuerySlow: (): void => {},
          logQueryError: (): void => {},
        },
      },
    };

    runner = new PostgresQueryRunner(fakeDriver as PostgresDriver, "master");

    const fakeClient: unknown = {
      on: (): void => {},
      removeListener: (): void => {},
      query: async (sql: string): Promise<PgReply> => {
        statements.push(sql);
        const rows: Array<Record<string, unknown>> = rowWritten
          ? [{ _id: SERVICE_ID.toString() }]
          : [];
        return { command: commandOf(sql), rows: rows, rowCount: rows.length };
      },
    };

    // The runner's connection, as connect() would have set it from the pool.
    (runner as unknown as { databaseConnection: unknown }).databaseConnection =
      fakeClient;

    service = new DatabaseService<Service>(Service);

    const columns: Record<string, string> = {
      lastSeenAt: "lastSeenAt",
      serviceVersion: "serviceVersion",
    };

    getJestSpyOn(service, "getRepository").mockReturnValue({
      metadata: {
        tableName: "Service",
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
        query: (sql: string, params: Array<unknown>): Promise<unknown> => {
          return runner.query(sql, params);
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  /*
   * The premise, pinned so a TypeORM upgrade that changes it is noticed: a
   * top-level UPDATE comes back as [rows, rowCount] even when nothing was
   * written - a non-empty array.
   */
  it("TypeORM answers a bare UPDATE with [rows, rowCount], even when nothing was written", async () => {
    rowWritten = false;

    const reply: unknown = await runner.query(
      `UPDATE "Service" SET "lastSeenAt" = $1 WHERE "_id" = $2 RETURNING "_id"`,
      [new Date(), SERVICE_ID.toString()],
    );

    expect(reply).toEqual([[], 0]);
    expect(Array.isArray(reply) && reply.length > 0).toBe(true);
  });

  it("a write SKIP LOCKED skipped reports false", async () => {
    rowWritten = false;

    await expect(
      service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: SERVICE_ID,
        data: { lastSeenAt: new Date() },
      }),
    ).resolves.toBe(false);
  });

  it("a write to a row that no longer exists reports false", async () => {
    rowWritten = false;

    await expect(
      service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: SERVICE_ID,
        data: { lastSeenAt: new Date(), serviceVersion: "1.2.3" },
      }),
    ).resolves.toBe(false);
  });

  it("a write that landed reports true", async () => {
    rowWritten = true;

    await expect(
      service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: SERVICE_ID,
        data: { lastSeenAt: new Date() },
      }),
    ).resolves.toBe(true);
  });

  /*
   * How it stays observable: the statement is a SELECT over a
   * data-modifying CTE, so TypeORM hands back the written rows themselves.
   */
  it("reads the written rows back through a SELECT over the UPDATE", async () => {
    await service.updateColumnsByIdIfUnlockedWithoutHooks({
      id: SERVICE_ID,
      data: { lastSeenAt: new Date() },
    });

    expect(statements).toHaveLength(1);
    expect(commandOf(statements[0]!)).toBe("SELECT");
    expect(statements[0]).toMatch(
      /^WITH "updated" AS \(UPDATE "Service" SET .+ RETURNING "_id"\) SELECT "_id" FROM "updated"$/,
    );
    // Still one statement, still driven from the SKIP LOCKED sub-SELECT.
    expect(statements[0]).toContain(
      `WHERE "_id" IN (SELECT "_id" FROM "Service" WHERE "_id" = $2 FOR UPDATE SKIP LOCKED)`,
    );
  });

  it("answers each write for itself: skipped, then applied, then skipped", async () => {
    const outcomes: Array<boolean> = [];

    for (const written of [false, true, false]) {
      rowWritten = written;
      outcomes.push(
        await service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: SERVICE_ID,
          data: { lastSeenAt: new Date() },
        }),
      );
    }

    expect(outcomes).toEqual([false, true, false]);
  });
});
