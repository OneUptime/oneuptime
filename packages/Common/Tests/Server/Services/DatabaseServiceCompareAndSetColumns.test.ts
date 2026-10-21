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
