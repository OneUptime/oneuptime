import DatabaseService from "../../../Server/Services/DatabaseService";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Pins `updateColumnsByIdWithoutHooks`' updatedAt behaviour at the SQL
 * level, because the two sides of it protect different consumers:
 *
 *  - By DEFAULT the raw path must refresh updatedAt, preserving the
 *    behaviour of the normal update pipeline it replaces — anything
 *    watching row freshness (the RUM "connected" pill via lastSeenAt
 *    heartbeats) relies on it.
 *  - With `skipUpdateDateColumn` it must NOT: the session replay
 *    configEpoch is DERIVED from RumApplication.updatedAt
 *    (SessionReplayGateCache.getConfigEpoch), so a passive health
 *    heartbeat that refreshed updatedAt would broadcast "configuration
 *    changed" to every live recorder once a minute.
 *
 * Inverting either branch is invisible to every other suite — the health
 * markers are mocked at their call sites — so the generated SQL is pinned
 * here directly.
 */

const APPLICATION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

describe("DatabaseService.updateColumnsByIdWithoutHooks", () => {
  let service: DatabaseService<RumApplication>;
  let captured: Array<CapturedQuery>;

  beforeEach(() => {
    jest.restoreAllMocks();
    captured = [];

    service = new DatabaseService<RumApplication>(RumApplication);

    const columns: Record<string, string> = {
      sessionReplayLastChunkReceivedAt: "sessionReplayLastChunkReceivedAt",
      sessionReplayBudgetExceededAt: "sessionReplayBudgetExceededAt",
      lastSeenAt: "lastSeenAt",
      _id: "_id",
      updatedAt: "updatedAt",
    };

    getJestSpyOn(service, "getRepository").mockReturnValue({
      metadata: {
        tableName: "RumApplication",
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
        ): Promise<Array<unknown>> => {
          captured.push({ sql, params });
          return [];
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  it("refreshes updatedAt by default, preserving the normal pipeline's behaviour", async () => {
    await service.updateColumnsByIdWithoutHooks({
      id: APPLICATION_ID,
      data: { lastSeenAt: new Date() },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.sql).toContain(`"updatedAt" = CURRENT_TIMESTAMP`);
  });

  it("leaves updatedAt untouched when skipUpdateDateColumn is set", async () => {
    await service.updateColumnsByIdWithoutHooks({
      id: APPLICATION_ID,
      data: { sessionReplayLastChunkReceivedAt: new Date() },
      skipUpdateDateColumn: true,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.sql).not.toContain("updatedAt");
  });

  it("never bumps the optimistic-lock version column in either mode", async () => {
    await service.updateColumnsByIdWithoutHooks({
      id: APPLICATION_ID,
      data: { sessionReplayBudgetExceededAt: new Date() },
      skipUpdateDateColumn: true,
    });

    expect(captured[0]!.sql).not.toContain("version");
  });

  it("scopes the update to the one row by primary key", async () => {
    await service.updateColumnsByIdWithoutHooks({
      id: APPLICATION_ID,
      data: { lastSeenAt: new Date() },
    });

    expect(captured[0]!.sql).toMatch(/WHERE "_id" = \$\d+$/);
    expect(captured[0]!.params[captured[0]!.params.length - 1]).toBe(
      APPLICATION_ID.toString(),
    );
  });

  it("adds null-safe compare-and-set guards for expected values", async () => {
    const newValue: Date = new Date("2026-08-07T10:00:00.000Z");
    const oldValue: Date = new Date("2026-08-07T09:00:00.000Z");

    await service.updateColumnsByIdWithoutHooks({
      id: APPLICATION_ID,
      data: { lastSeenAt: newValue },
      expectedData: {
        sessionReplayLastChunkReceivedAt: oldValue,
        sessionReplayBudgetExceededAt: null,
      },
      skipUpdateDateColumn: true,
    });

    expect(captured).toEqual([
      {
        sql:
          `UPDATE "RumApplication" SET "lastSeenAt" = $1 ` +
          `WHERE "_id" = $2 ` +
          `AND "sessionReplayLastChunkReceivedAt" IS NOT DISTINCT FROM $3 ` +
          `AND "sessionReplayBudgetExceededAt" IS NOT DISTINCT FROM $4`,
        params: [newValue, APPLICATION_ID.toString(), oldValue, null],
      },
    ]);
  });

  it("rejects unknown compare-and-set columns before issuing SQL", async () => {
    await expect(
      service.updateColumnsByIdWithoutHooks({
        id: APPLICATION_ID,
        data: { lastSeenAt: new Date() },
        expectedData: { notAColumn: "value" } as never,
      }),
    ).rejects.toThrow('unknown expected column "notAColumn"');

    expect(captured).toHaveLength(0);
  });

  it("rejects SQL expressions in compare-and-set values", async () => {
    await expect(
      service.updateColumnsByIdWithoutHooks({
        id: APPLICATION_ID,
        data: { lastSeenAt: new Date() },
        expectedData: {
          sessionReplayLastChunkReceivedAt: (() => {
            return "NOW()";
          }) as never,
        },
      }),
    ).rejects.toThrow("SQL-expression expected values are not supported");

    expect(captured).toHaveLength(0);
  });
});
