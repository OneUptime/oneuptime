import MeasurementBackfillProgress, {
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
 * written over (#8105). These pin the statement, what it is given, and how
 * its answer is read. The Postgres suite next to this one
 * (MeasurementBackfillProgressPostgres) runs it against the real table.
 */

const MEASUREMENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const REQUESTED_AT: Date = new Date("2026-07-01T00:00:00.123Z");
const CURSOR: Date = new Date("2026-06-01T09:00:00.000Z");
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
  test("a page's cursor is one statement: the UPDATE, held to the request, SELECTed from a CTE", () => {
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: "IncidentMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursorCreatedAt: CURSOR,
        },
      });

    expect(statement).toEqual({
      sql:
        `WITH "saved" AS (UPDATE "IncidentMeasurement" SET ` +
        `"backfillCursorCreatedAt" = $1 ` +
        `WHERE "_id" = $2 ` +
        `AND date_trunc('milliseconds', "backfillRequestedAt") = $3 ` +
        `RETURNING "_id") SELECT "_id" FROM "saved"`,
      parameters: [CURSOR, MEASUREMENT_ID.toString(), REQUESTED_AT],
    });
  });

  test("a completion stamps when the walk finished and where it ended, under the same guard", () => {
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: "IncidentMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursorCreatedAt: CURSOR,
          completedAt: COMPLETED_AT,
        },
      });

    expect(statement).toEqual({
      sql:
        `WITH "saved" AS (UPDATE "IncidentMeasurement" SET ` +
        `"backfillCursorCreatedAt" = $1, "backfillCompletedAt" = $2 ` +
        `WHERE "_id" = $3 ` +
        `AND date_trunc('milliseconds', "backfillRequestedAt") = $4 ` +
        `RETURNING "_id") SELECT "_id" FROM "saved"`,
      parameters: [
        CURSOR,
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
          cursorCreatedAt: undefined,
          completedAt: COMPLETED_AT,
        },
      });

    expect(statement.sql).not.toContain("backfillCursorCreatedAt");
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
          cursorCreatedAt: CURSOR,
        },
      });

    expect(statement.sql).toMatch(
      /WHERE "_id" = \$\d+ AND date_trunc\('milliseconds', "backfillRequestedAt"\) = \$3 /,
    );
    expect(statement.sql).not.toMatch(/IS NOT DISTINCT FROM/);
    // The very stamp the walk read: not now, not the completion time.
    expect(statement.parameters[2]).toBe(REQUESTED_AT);
  });

  test("never writes the request itself, the version or updatedAt: nobody edited the measurement", () => {
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: "IncidentMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursorCreatedAt: CURSOR,
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

  test("carries the measurement id as the row's id and only Dates into the timestamp columns", () => {
    /*
     * All three backfill columns are TIMESTAMPs: an ObjectID bound into one
     * is a write error that stops the whole backfill of the project.
     */
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: "IncidentMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursorCreatedAt: CURSOR,
          completedAt: COMPLETED_AT,
        },
      });

    const [cursor, completedAt, id, requestedAt] = statement.parameters;

    expect(cursor).toBeInstanceOf(Date);
    expect(completedAt).toBeInstanceOf(Date);
    expect(requestedAt).toBeInstanceOf(Date);
    expect(id).toBe(MEASUREMENT_ID.toString());
    expect(typeof id).toBe("string");
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
            cursorCreatedAt: CURSOR,
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
        cursorCreatedAt: CURSOR,
      },
    });

    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: "AlertMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursorCreatedAt: CURSOR,
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
          cursorCreatedAt: CURSOR,
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
            cursorCreatedAt: CURSOR,
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
          cursorCreatedAt: CURSOR,
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
          cursorCreatedAt: CURSOR,
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
});
