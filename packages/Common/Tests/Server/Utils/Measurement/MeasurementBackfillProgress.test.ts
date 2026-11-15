import MeasurementBackfillProgress, {
  MeasurementBackfillCursor,
  MeasurementBackfillService,
  MeasurementBackfillStatement,
} from "../../../../Server/Utils/Measurement/MeasurementBackfillProgress";
import AlertMeasurement from "../../../../Models/DatabaseModels/AlertMeasurement";
import IncidentMeasurement from "../../../../Models/DatabaseModels/IncidentMeasurement";
import ScheduledMaintenanceMeasurement from "../../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * MeasurementBackfillProgress is how the measurement backfill worker writes
 * how far a walk got: each page's cursor, and the completion stamp at the
 * end. Each write is a compare-and-set held to the request the walk began
 * from, so an edit of the measurement made while it is walked - a new
 * backfillRequestedAt, the cursor and the completion cleared - is never
 * written over (#8105). The cursor is the last record a page worked out,
 * its createdAt and its id, written together (#8171). These pin the
 * statement, what it is given, and how its answer is read. The Postgres
 * suite next to this one (MeasurementBackfillProgressPostgres) runs it
 * against the real table.
 */

const MEASUREMENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const REQUESTED_AT: Date = new Date("2026-07-01T00:00:00.123Z");
const CURSOR: MeasurementBackfillCursor = {
  createdAt: new Date("2026-06-01T09:00:00.000Z"),
  id: new ObjectID("33333333-3333-4333-8333-333333333333"),
};
const COMPLETED_AT: Date = new Date("2026-07-01T00:05:00.000Z");

interface CapturedQuery {
  sql: string;
  parameters: Array<unknown> | undefined;
}

// A measurement service whose connection answers every statement with `answer`.
function fakeService(input: {
  tableName: string | null;
  answer?: unknown;
  captured: Array<CapturedQuery>;
}): MeasurementBackfillService {
  return {
    getModel: (): { tableName: string | null } => {
      return { tableName: input.tableName };
    },
    getRepository: () => {
      return {
        manager: {
          query: async (
            sql: string,
            parameters?: Array<unknown>,
          ): Promise<unknown> => {
            input.captured.push({ sql: sql, parameters: parameters });
            return "answer" in input
              ? input.answer
              : [{ _id: MEASUREMENT_ID.toString() }];
          },
        },
      };
    },
  };
}

describe("MeasurementBackfillProgress.getStatement", () => {
  test("a page's cursor is one statement: both its columns, the UPDATE held to the request, SELECTed from a CTE", () => {
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: "IncidentMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursor: CURSOR,
        },
      });

    expect(statement).toEqual({
      sql:
        `WITH "saved" AS (UPDATE "IncidentMeasurement" SET ` +
        `"backfillCursorCreatedAt" = $1, "backfillCursorId" = $2 ` +
        `WHERE "_id" = $3 ` +
        `AND date_trunc('milliseconds', "backfillRequestedAt") = $4 ` +
        `RETURNING "_id") SELECT "_id" FROM "saved"`,
      parameters: [
        CURSOR.createdAt,
        CURSOR.id.toString(),
        MEASUREMENT_ID.toString(),
        REQUESTED_AT,
      ],
    });
  });

  test("a completion stamps when the walk finished and where it ended, under the same guard", () => {
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: "IncidentMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursor: CURSOR,
          completedAt: COMPLETED_AT,
        },
      });

    expect(statement).toEqual({
      sql:
        `WITH "saved" AS (UPDATE "IncidentMeasurement" SET ` +
        `"backfillCursorCreatedAt" = $1, "backfillCursorId" = $2, ` +
        `"backfillCompletedAt" = $3 ` +
        `WHERE "_id" = $4 ` +
        `AND date_trunc('milliseconds', "backfillRequestedAt") = $5 ` +
        `RETURNING "_id") SELECT "_id" FROM "saved"`,
      parameters: [
        CURSOR.createdAt,
        CURSOR.id.toString(),
        COMPLETED_AT,
        MEASUREMENT_ID.toString(),
        REQUESTED_AT,
      ],
    });
  });

  test("a completion with no cursor - a project with nothing in it - leaves the cursor alone, since null would clear it", () => {
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: "IncidentMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursor: undefined,
          completedAt: COMPLETED_AT,
        },
      });

    expect(statement.sql).not.toContain("backfillCursorCreatedAt");
    expect(statement.sql).not.toContain("backfillCursorId");
    expect(statement.sql).toContain(`SET "backfillCompletedAt" = $1 WHERE`);
    expect(statement.parameters).toEqual([
      COMPLETED_AT,
      MEASUREMENT_ID.toString(),
      REQUESTED_AT,
    ]);
    expect(statement.parameters).not.toContain(null);
  });

  test("compares the stored request to the millisecond, against the stamp the walk read", () => {
    /*
     * node-postgres reads a timestamp to the millisecond, and FirstPagedAt
     * stamps the request with now(), which keeps microseconds: an exact
     * comparison would refuse every write of a walk of such a request.
     */
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: "IncidentMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursor: CURSOR,
        },
      });

    expect(statement.sql).toMatch(
      /WHERE "_id" = \$\d+ AND date_trunc\('milliseconds', "backfillRequestedAt"\) = \$4 /,
    );
    expect(statement.sql).not.toMatch(/IS NOT DISTINCT FROM/);
    // The very stamp the walk read: not now, not the completion time.
    expect(statement.parameters[3]).toBe(REQUESTED_AT);
  });

  test("never writes the request itself, the version or updatedAt: nobody edited the measurement", () => {
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: "IncidentMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursor: CURSOR,
          completedAt: COMPLETED_AT,
        },
      });

    const assignments: string = statement.sql.slice(
      statement.sql.indexOf(" SET "),
      statement.sql.indexOf(" WHERE "),
    );

    expect(assignments).not.toContain("backfillRequestedAt");
    expect(statement.sql).not.toContain("version");
    expect(statement.sql).not.toContain("updatedAt");
  });

  test("carries the measurement id as the row's id, the cursor's id into its id column and only Dates into the timestamp columns", () => {
    /*
     * The three backfill timestamps are TIMESTAMPs: an ObjectID bound into
     * one is a write error that stops the whole backfill of the project.
     */
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: "IncidentMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursor: CURSOR,
          completedAt: COMPLETED_AT,
        },
      });

    const [cursorCreatedAt, cursorId, completedAt, id, requestedAt] =
      statement.parameters;

    expect(cursorCreatedAt).toBeInstanceOf(Date);
    expect(completedAt).toBeInstanceOf(Date);
    expect(requestedAt).toBeInstanceOf(Date);
    // The record the page ended on, as text, never the measurement.
    expect(cursorId).toBe(CURSOR.id.toString());
    expect(typeof cursorId).toBe("string");
    expect(id).toBe(MEASUREMENT_ID.toString());
    expect(typeof id).toBe("string");
  });

  test("writes the cursor's createdAt and id together, from the one record the page ended on", () => {
    const other: MeasurementBackfillCursor = {
      createdAt: new Date("2026-06-01T09:00:00.000Z"),
      id: new ObjectID("44444444-4444-4444-8444-444444444444"),
    };

    for (const cursor of [CURSOR, other]) {
      const statement: MeasurementBackfillStatement =
        MeasurementBackfillProgress.getStatement({
          tableName: "IncidentMeasurement",
          write: {
            measurementId: MEASUREMENT_ID,
            requestedAt: REQUESTED_AT,
            cursor: cursor,
          },
        });

      expect(statement.sql).toContain(
        `SET "backfillCursorCreatedAt" = $1, "backfillCursorId" = $2 WHERE`,
      );
      expect(statement.parameters.slice(0, 2)).toEqual([
        cursor.createdAt,
        cursor.id.toString(),
      ]);
    }
  });

  test("names the table it is given, for each of the three measurement tables", () => {
    for (const tableName of [
      "IncidentMeasurement",
      "AlertMeasurement",
      "ScheduledMaintenanceMeasurement",
    ]) {
      expect(
        MeasurementBackfillProgress.getStatement({
          tableName: tableName,
          write: {
            measurementId: MEASUREMENT_ID,
            requestedAt: REQUESTED_AT,
            cursor: CURSOR,
          },
        }).sql,
      ).toContain(`UPDATE "${tableName}" SET `);
    }
  });

  test("refuses a write with nothing to write", () => {
    expect(() => {
      return MeasurementBackfillProgress.getStatement({
        tableName: "IncidentMeasurement",
        write: { measurementId: MEASUREMENT_ID, requestedAt: REQUESTED_AT },
      });
    }).toThrow("a write needs a cursor or a completion to write");
  });
});

describe("MeasurementBackfillProgress.save", () => {
  test("runs the statement on its service's connection, for the table its service names", async () => {
    const captured: Array<CapturedQuery> = [];

    await MeasurementBackfillProgress.save({
      service: fakeService({ tableName: "AlertMeasurement", captured }),
      write: {
        measurementId: MEASUREMENT_ID,
        requestedAt: REQUESTED_AT,
        cursor: CURSOR,
      },
    });

    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: "AlertMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursor: CURSOR,
        },
      });

    expect(captured).toEqual([
      { sql: statement.sql, parameters: statement.parameters },
    ]);
    expect(captured[0]!.sql).toContain(`UPDATE "AlertMeasurement" SET `);
  });

  test("answers true when the row came back written", async () => {
    await expect(
      MeasurementBackfillProgress.save({
        service: fakeService({
          tableName: "IncidentMeasurement",
          answer: [{ _id: MEASUREMENT_ID.toString() }],
          captured: [],
        }),
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursor: CURSOR,
        },
      }),
    ).resolves.toBe(true);
  });

  test("answers false when the measurement was asked for again, or is gone: no row came back", async () => {
    await expect(
      MeasurementBackfillProgress.save({
        service: fakeService({
          tableName: "IncidentMeasurement",
          answer: [],
          captured: [],
        }),
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          completedAt: COMPLETED_AT,
        },
      }),
    ).resolves.toBe(false);
  });

  test("answers false for anything that is not a list of written rows", async () => {
    for (const answer of [undefined, null, 1, "UPDATE 1", {}]) {
      await expect(
        MeasurementBackfillProgress.save({
          service: fakeService({
            tableName: "IncidentMeasurement",
            answer: answer,
            captured: [],
          }),
          write: {
            measurementId: MEASUREMENT_ID,
            requestedAt: REQUESTED_AT,
            cursor: CURSOR,
          },
        }),
      ).resolves.toBe(false);
    }
  });

  test("passes a failing statement's error on, so the tick logs it", async () => {
    const service: MeasurementBackfillService = {
      getModel: (): { tableName: string | null } => {
        return { tableName: "IncidentMeasurement" };
      },
      getRepository: () => {
        return {
          manager: {
            query: async (): Promise<unknown> => {
              throw new Error("connection reset");
            },
          },
        };
      },
    };

    await expect(
      MeasurementBackfillProgress.save({
        service: service,
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursor: CURSOR,
        },
      }),
    ).rejects.toThrow("connection reset");
  });

  test("refuses a service that names no table, before any SQL", async () => {
    const captured: Array<CapturedQuery> = [];

    await expect(
      MeasurementBackfillProgress.save({
        service: fakeService({ tableName: null, captured }),
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursor: CURSOR,
        },
      }),
    ).rejects.toThrow("the measurement service names no table");

    expect(captured).toEqual([]);
  });

  test("refuses a write with nothing to write, before any SQL", async () => {
    const captured: Array<CapturedQuery> = [];

    await expect(
      MeasurementBackfillProgress.save({
        service: fakeService({ tableName: "IncidentMeasurement", captured }),
        write: { measurementId: MEASUREMENT_ID, requestedAt: REQUESTED_AT },
      }),
    ).rejects.toThrow("a write needs a cursor or a completion to write");

    expect(captured).toEqual([]);
  });
});

/*
 * The statement names its columns itself, outside TypeORM's metadata, so
 * these hold the names to the three models it writes: a column renamed in a
 * model fails here, not in production.
 */
describe("the columns the statement names", () => {
  interface MeasurementTable {
    model: { new (): BaseModel };
    tableName: string;
  }

  const TABLES: Array<MeasurementTable> = [
    { model: IncidentMeasurement, tableName: "IncidentMeasurement" },
    { model: AlertMeasurement, tableName: "AlertMeasurement" },
    {
      model: ScheduledMaintenanceMeasurement,
      tableName: "ScheduledMaintenanceMeasurement",
    },
  ];

  test.each(TABLES)(
    "are $tableName's timestamp columns, stored under the names the statement uses",
    (table: MeasurementTable) => {
      expect(new table.model().tableName).toBe(table.tableName);

      for (const column of [
        "backfillRequestedAt",
        "backfillCursorCreatedAt",
        "backfillCompletedAt",
      ]) {
        expect(new table.model().getTableColumnMetadata(column)?.type).toBe(
          TableColumnType.Date,
        );

        const typeormColumn: ColumnMetadataArgs | undefined =
          getMetadataArgsStorage().columns.find(
            (candidate: ColumnMetadataArgs) => {
              return (
                candidate.target === table.model &&
                candidate.propertyName === column
              );
            },
          );

        // A timestamp with a time zone, stored under the property's own name.
        expect(typeormColumn?.options.type).toBe("timestamptz");
        expect(typeormColumn?.options.name).toBeUndefined();
      }
    },
  );

  test.each(TABLES)(
    "are $tableName's cursor id column, a uuid stored under the name the statement uses",
    (table: MeasurementTable) => {
      expect(
        new table.model().getTableColumnMetadata("backfillCursorId")?.type,
      ).toBe(TableColumnType.ObjectID);

      const typeormColumn: ColumnMetadataArgs | undefined =
        getMetadataArgsStorage().columns.find(
          (candidate: ColumnMetadataArgs) => {
            return (
              candidate.target === table.model &&
              candidate.propertyName === "backfillCursorId"
            );
          },
        );

      expect(typeormColumn?.options.type).toBe("uuid");
      expect(typeormColumn?.options.nullable).toBe(true);
      expect(typeormColumn?.options.name).toBeUndefined();
    },
  );
});
