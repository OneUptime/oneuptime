import ServiceService from "../../../Server/Services/ServiceService";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * DatabaseService.updateColumnsByIdWithoutHooks is the fast heartbeat write
 * path behind ServiceService.updateLastSeen. It exists to keep the single
 * hottest UPDATE in the system (lastSeenAt, bumped on every telemetry batch)
 * out of the full updateOneById pipeline, which holds the row's write lock
 * across several round trips and was observed heading a Postgres lock convoy
 * that starved the connection pool.
 *
 * These tests mock the TypeORM manager (no Postgres) and lock in the two
 * invariants that make the fix work:
 *   - it emits exactly ONE parameterized UPDATE, and
 *   - it NEVER rewrites the optimistic-lock `version` column (a regression
 *     here would re-introduce the contention the fix removed).
 */

type QueryCall = [string, Array<unknown>];

const SERVICE_COLUMNS: Record<string, string> = {
  lastSeenAt: "lastSeenAt",
  serviceVersion: "serviceVersion",
  deploymentEnvironment: "deploymentEnvironment",
};

/*
 * Stand-in for the TypeORM driver's persist path. The real method applies
 * column transformers (ObjectID -> uuid string, JSON.stringify, etc.); we
 * model that here by wrapping a string value in `prepared(...)` so a test
 * can assert the column value was routed through it rather than bound raw.
 */
function fakePreparePersistentValue(value: unknown): unknown {
  return typeof value === "string" ? `prepared(${value})` : value;
}

function mockRepository(result: unknown = []): jest.Mock {
  const query: jest.Mock = jest.fn().mockResolvedValue(result);
  jest.spyOn(ServiceService, "getRepository").mockReturnValue({
    manager: {
      query,
      connection: {
        driver: { preparePersistentValue: fakePreparePersistentValue },
      },
    },
    metadata: {
      tableName: "Service",
      primaryColumns: [{ databaseName: "_id" }],
      updateDateColumn: { databaseName: "updatedAt" },
      findColumnWithPropertyName: (propertyName: string) => {
        return SERVICE_COLUMNS[propertyName]
          ? { databaseName: SERVICE_COLUMNS[propertyName] }
          : undefined;
      },
    },
  } as any);
  return query;
}

describe("DatabaseService.updateColumnsByIdWithoutHooks", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("emits a single UPDATE and never bumps the version column", async () => {
    const query: jest.Mock = mockRepository();
    const id: ObjectID = ObjectID.generate();
    const lastSeenAt: Date = new Date();

    await ServiceService.updateColumnsByIdWithoutHooks({
      id,
      data: { lastSeenAt } as never,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    // The whole point of the fix: no optimistic-lock churn on the hot row.
    expect(sql).not.toContain("version");
    // updatedAt is still refreshed, exactly as the normal update path does.
    expect(sql).toContain(`"updatedAt" = CURRENT_TIMESTAMP`);
    expect(sql).toBe(
      `UPDATE "Service" SET "lastSeenAt" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "_id" = $2`,
    );
    expect(params).toEqual([lastSeenAt, id.toString()]);
  });

  test("maps multiple entity properties to columns in stable param order", async () => {
    const query: jest.Mock = mockRepository();
    const id: ObjectID = ObjectID.generate();
    const lastSeenAt: Date = new Date();

    await ServiceService.updateColumnsByIdWithoutHooks({
      id,
      data: {
        lastSeenAt,
        serviceVersion: "1.2.3",
        deploymentEnvironment: "production",
      } as never,
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;
    expect(sql).toBe(
      `UPDATE "Service" SET "lastSeenAt" = $1, "serviceVersion" = $2, ` +
        `"deploymentEnvironment" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "_id" = $4`,
    );
    /*
     * Column values are routed through the driver's persist path (here the
     * `prepared(...)` stand-in), so transformers/JSON/coercion apply exactly
     * as save() would. The `_id` in the WHERE clause is bound raw.
     */
    expect(params).toEqual([
      lastSeenAt,
      "prepared(1.2.3)",
      "prepared(production)",
      id.toString(),
    ]);
  });

  test("throws on an unknown column instead of silently writing nothing", async () => {
    mockRepository();
    await expect(
      ServiceService.updateColumnsByIdWithoutHooks({
        id: ObjectID.generate(),
        data: { notAColumn: "x" } as never,
      }),
    ).rejects.toThrow(/unknown column "notAColumn"/);
  });

  test("rejects SQL-expression (function) values it cannot bind", async () => {
    const query: jest.Mock = mockRepository();
    await expect(
      ServiceService.updateColumnsByIdWithoutHooks({
        id: ObjectID.generate(),
        data: {
          lastSeenAt: (() => {
            return "NOW()";
          }) as never,
        } as never,
      }),
    ).rejects.toThrow(/SQL-expression values are not supported/);
    expect(query).not.toHaveBeenCalled();
  });

  test("does not issue a query when there are no columns to update", async () => {
    const query: jest.Mock = mockRepository();
    await ServiceService.updateColumnsByIdWithoutHooks({
      id: ObjectID.generate(),
      data: {} as never,
    });
    expect(query).not.toHaveBeenCalled();
  });
});
