import DatabaseService from "../../../Server/Services/DatabaseService";
import Service from "../../../Models/DatabaseModels/Service";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Pins `updateColumnsByIdIfUnlockedWithoutHooks` at the SQL level.
 *
 * This primitive is the structural backstop under every ingest-path throttle,
 * and the thing that makes it a backstop is one clause: FOR UPDATE SKIP
 * LOCKED. A single-statement UPDATE holds its row lock briefly, but "briefly"
 * stops mattering once the arrival rate on ONE row exceeds the service rate —
 * Postgres queues lock waiters strictly, so every waiter pins a backend for
 * the sum of everyone ahead of it. That is what produced 1,017 active
 * connections with 892 parked on row locks and a 3.7-hour tail, on a database
 * that was never short of capacity.
 *
 * SKIP LOCKED caps the number of backends blocked on any single row at one,
 * and it does so unconditionally — it keeps holding when Redis is down, when a
 * fence has a bug, when someone flushes the cache. None of the throttles
 * upstream can make that guarantee, so nothing else in the codebase can
 * substitute for it.
 *
 * Every assertion here is therefore about the generated statement, not about
 * behaviour observable from a call site. Mocking this method out (as the
 * service-level suites do) mocks the guarantee out with it, so it has to be
 * checked here or nowhere. If an assertion below starts failing, the fix is
 * almost certainly in the code, not in the assertion.
 *
 * No Postgres, no Redis — the repository is faked and the emitted SQL and
 * bound parameters are captured.
 */

const SERVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

describe("DatabaseService.updateColumnsByIdIfUnlockedWithoutHooks", () => {
  let service: DatabaseService<Service>;
  let captured: Array<CapturedQuery>;
  let rowsToReturn: Array<unknown>;

  beforeEach(() => {
    jest.restoreAllMocks();
    captured = [];
    rowsToReturn = [{ _id: SERVICE_ID.toString() }];

    service = new DatabaseService<Service>(Service);

    const columns: Record<string, string> = {
      lastSeenAt: "lastSeenAt",
      serviceVersion: "serviceVersion",
      cloudRegion: "cloudRegion",
      _id: "_id",
      updatedAt: "updatedAt",
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
        query: async (
          sql: string,
          params: Array<unknown>,
        ): Promise<Array<unknown>> => {
          captured.push({ sql, params });
          return rowsToReturn;
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  describe("the non-blocking guarantee", () => {
    /*
     * The whole point. Without SKIP LOCKED this is an ordinary blocking
     * UPDATE and the convoy is back.
     */
    it("locks the target row with FOR UPDATE SKIP LOCKED", async () => {
      const now: Date = new Date();

      await service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: SERVICE_ID,
        data: { lastSeenAt: now },
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]!.sql).toContain("FOR UPDATE SKIP LOCKED");
    });

    /*
     * The lock must be taken by a sub-SELECT on the same table and the UPDATE
     * driven from its result. Reaching the row any other way (a bare WHERE
     * clause) makes the outer UPDATE take its own blocking lock and the SKIP
     * LOCKED is decorative.
     */
    it("drives the UPDATE from the locked sub-SELECT, not a bare predicate", async () => {
      await service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: SERVICE_ID,
        data: { lastSeenAt: new Date() },
      });

      expect(captured[0]!.sql).toContain(
        `WHERE "_id" IN (SELECT "_id" FROM "Service" WHERE "_id" = $2 FOR UPDATE SKIP LOCKED)`,
      );
    });

    it("issues exactly one statement — no BEGIN, no COMMIT, no extra reads", async () => {
      await service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: SERVICE_ID,
        data: { lastSeenAt: new Date(), serviceVersion: "1.2.3" },
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]!.sql.toUpperCase()).not.toContain("BEGIN");
      expect(captured[0]!.sql.toUpperCase()).not.toContain("COMMIT");
    });

    /*
     * `version = version + 1` would drag this write into a fight with the
     * optimistic lock on a row a human may be editing, and is exactly what
     * routing through the ORM's save() path reintroduces.
     */
    it("never bumps the optimistic-lock version column", async () => {
      await service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: SERVICE_ID,
        data: { lastSeenAt: new Date() },
      });

      expect(captured[0]!.sql).not.toContain("version");
    });
  });

  describe("reporting whether the write landed", () => {
    /*
     * A skipped write and an applied write are indistinguishable without
     * RETURNING: a bare UPDATE surfaces no rows through TypeORM's query(). If
     * this regresses, every caller silently believes contended writes
     * succeeded — which is how a "reliable" heartbeat stops beating with
     * nothing in the logs.
     */
    it("asks for the affected row back so the skip is observable", async () => {
      await service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: SERVICE_ID,
        data: { lastSeenAt: new Date() },
      });

      expect(captured[0]!.sql).toContain(`RETURNING "_id"`);
    });

    it("returns true when the row was updated", async () => {
      rowsToReturn = [{ _id: SERVICE_ID.toString() }];

      await expect(
        service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: SERVICE_ID,
          data: { lastSeenAt: new Date() },
        }),
      ).resolves.toBe(true);
    });

    it("returns false when the row was locked by another writer", async () => {
      rowsToReturn = [];

      await expect(
        service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: SERVICE_ID,
          data: { lastSeenAt: new Date() },
        }),
      ).resolves.toBe(false);
    });

    it("returns false when the row no longer exists", async () => {
      rowsToReturn = [];

      await expect(
        service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: SERVICE_ID,
          data: { lastSeenAt: new Date() },
        }),
      ).resolves.toBe(false);
    });

    it("returns false rather than throwing on an unexpected driver reply", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rowsToReturn = undefined as any;

      await expect(
        service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: SERVICE_ID,
          data: { lastSeenAt: new Date() },
        }),
      ).resolves.toBe(false);
    });
  });

  describe("parity with the blocking primitive", () => {
    it("binds every value as a parameter", async () => {
      const now: Date = new Date();

      await service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: SERVICE_ID,
        data: { lastSeenAt: now, serviceVersion: "1.2.3" },
      });

      expect(captured[0]!.params).toEqual([
        now,
        "1.2.3",
        SERVICE_ID.toString(),
      ]);
    });

    it("refreshes updatedAt by default", async () => {
      await service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: SERVICE_ID,
        data: { lastSeenAt: new Date() },
      });

      expect(captured[0]!.sql).toContain(`"updatedAt" = CURRENT_TIMESTAMP`);
    });

    it("leaves updatedAt alone when asked to", async () => {
      await service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: SERVICE_ID,
        data: { lastSeenAt: new Date() },
        skipUpdateDateColumn: true,
      });

      expect(captured[0]!.sql).not.toContain("updatedAt");
    });

    /*
     * The clamp lives at this choke point precisely so no caller can forget
     * it: an over-long collector-supplied attribute would otherwise fail the
     * whole statement and take lastSeenAt down with it (issue #3006).
     */
    it("clamps over-long strings to their column width", async () => {
      const huge: string = "x".repeat(5000);

      await service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: SERVICE_ID,
        data: { lastSeenAt: new Date(), cloudRegion: huge },
      });

      const bound: string = captured[0]!.params[1] as string;
      expect(bound.length).toBeLessThan(huge.length);
    });

    it("does not mutate the caller's payload when clamping", async () => {
      const huge: string = "x".repeat(5000);
      const data: Record<string, unknown> = {
        lastSeenAt: new Date(),
        cloudRegion: huge,
      };

      await service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: SERVICE_ID,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: data as any,
      });

      expect(data["cloudRegion"]).toHaveLength(5000);
    });

    it("rejects an unknown column instead of generating invalid SQL", async () => {
      await expect(
        service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: SERVICE_ID,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { notAColumn: "x" } as any,
        }),
      ).rejects.toThrow(BadDataException);

      expect(captured).toHaveLength(0);
    });

    it("rejects SQL-expression values, which this bind path cannot express", async () => {
      await expect(
        service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: SERVICE_ID,
          data: {
            lastSeenAt: () => {
              return "now()";
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        }),
      ).rejects.toThrow(BadDataException);
    });

    it("requires an id", async () => {
      await expect(
        service.updateColumnsByIdIfUnlockedWithoutHooks({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          id: undefined as any,
          data: { lastSeenAt: new Date() },
        }),
      ).rejects.toThrow(BadDataException);
    });

    /*
     * An empty payload must issue nothing at all. Emitting `SET "updatedAt" =
     * CURRENT_TIMESTAMP` alone would take a row lock to write a value nobody
     * asked for — a pointless contender in exactly the place contention is
     * the problem.
     */
    it("issues no statement, and reports no write, for an empty payload", async () => {
      await expect(
        service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: SERVICE_ID,
          data: {},
        }),
      ).resolves.toBe(false);

      expect(captured).toHaveLength(0);
    });
  });
});
