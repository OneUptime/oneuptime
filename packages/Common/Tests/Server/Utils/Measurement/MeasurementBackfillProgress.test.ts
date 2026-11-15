import MeasurementBackfillProgress, {
  EXACT_TIMESTAMP_TEXT,
  getExactTimestampSql,
  isExactTimestampOf,
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
 * #8388. The cursor's createdAt is written to the microsecond, as the
 * record has it, and read back so: cut to the millisecond, it stood for the
 * record badly once the record was deleted for good, and the next page read
 * again every record created in that millisecond before it.
 */
describe("a cursor to the microsecond", () => {
  const EXACT_CURSOR: MeasurementBackfillCursor = {
    createdAt: new Date("2026-06-01T09:00:00.123Z"),
    exactCreatedAt: "2026-06-01T09:00:00.123456Z",
    id: new ObjectID("33333333-3333-4333-8333-333333333333"),
  };

  test("is written as its text to the microsecond, which Postgres reads as the timestamp it names", () => {
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: "IncidentMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursor: EXACT_CURSOR,
        },
      });

    // The same statement: only what the createdAt is bound as changes.
    expect(statement).toEqual({
      sql: `WITH "saved" AS (UPDATE "IncidentMeasurement" SET "backfillCursorCreatedAt" = $1, "backfillCursorId" = $2 WHERE "_id" = $3 AND date_trunc('milliseconds', "backfillRequestedAt") = $4 RETURNING "_id") SELECT "_id" FROM "saved"`,
      parameters: [
        "2026-06-01T09:00:00.123456Z",
        EXACT_CURSOR.id.toString(),
        MEASUREMENT_ID.toString(),
        REQUESTED_AT,
      ],
    });
  });

  test("is written as its Date when it has no microseconds: a cursor read through TypeORM", () => {
    expect(
      MeasurementBackfillProgress.getStatement({
        tableName: "IncidentMeasurement",
        write: {
          measurementId: MEASUREMENT_ID,
          requestedAt: REQUESTED_AT,
          cursor: { ...EXACT_CURSOR, exactCreatedAt: undefined },
        },
      }).parameters[0],
    ).toBe(EXACT_CURSOR.createdAt);
  });

  test("is refused when its text is not of the millisecond its createdAt was read at: one record's time with another's", () => {
    for (const exactCreatedAt of [
      "2026-06-01T09:00:00.124456Z",
      "2026-06-01T09:00:01.123456Z",
      "2026-06-01T09:00:00.123Z",
      "not a time",
    ]) {
      expect(() => {
        return MeasurementBackfillProgress.getStatement({
          tableName: "IncidentMeasurement",
          write: {
            measurementId: MEASUREMENT_ID,
            requestedAt: REQUESTED_AT,
            cursor: { ...EXACT_CURSOR, exactCreatedAt: exactCreatedAt },
          },
        });
      }).toThrow("is not one of the millisecond it was read at");
    }
  });

  test("the read of the cursors held: both columns, the createdAt as UTC text to the microsecond, one statement for every measurement", () => {
    const other: ObjectID = new ObjectID(
      "44444444-4444-4444-8444-444444444444",
    );

    expect(
      MeasurementBackfillProgress.getExactCursorsStatement({
        tableName: "AlertMeasurement",
        measurementIds: [MEASUREMENT_ID, other],
      }),
    ).toEqual({
      sql: `SELECT "_id", "backfillCursorId" AS "cursorId", to_char("backfillCursorCreatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "exactCreatedAt" FROM "AlertMeasurement" WHERE "_id" = ANY($1) AND "backfillCursorCreatedAt" IS NOT NULL AND "backfillCursorId" IS NOT NULL`,
      parameters: [[MEASUREMENT_ID.toString(), other.toString()]],
    });
  });

  test("reads each measurement's cursor back to the microsecond, by measurement id, on its service's connection", async () => {
    const captured: Array<CapturedQuery> = [];

    const cursors: Map<string, { id: string; exactCreatedAt: string }> =
      await MeasurementBackfillProgress.readExactCursors({
        service: fakeService({
          tableName: "ScheduledMaintenanceMeasurement",
          answer: [
            {
              _id: MEASUREMENT_ID.toString().toUpperCase(),
              cursorId: EXACT_CURSOR.id.toString().toUpperCase(),
              exactCreatedAt: "2026-06-01T09:00:00.123456Z",
            },
          ],
          captured,
        }),
        measurementIds: [MEASUREMENT_ID],
      });

    expect(captured).toEqual(
      [
        MeasurementBackfillProgress.getExactCursorsStatement({
          tableName: "ScheduledMaintenanceMeasurement",
          measurementIds: [MEASUREMENT_ID],
        }),
      ].map((statement: MeasurementBackfillStatement): CapturedQuery => {
        return { sql: statement.sql, parameters: statement.parameters };
      }),
    );
    // uuids compared as Postgres writes them: lowercase.
    expect([...cursors.entries()]).toEqual([
      [
        MEASUREMENT_ID.toString(),
        {
          id: EXACT_CURSOR.id.toString(),
          exactCreatedAt: "2026-06-01T09:00:00.123456Z",
        },
      ],
    ]);
  });

  test("leaves out a row it cannot read whole, and answers no cursors for an answer that is no list", async () => {
    const cursors: Map<string, { id: string; exactCreatedAt: string }> =
      await MeasurementBackfillProgress.readExactCursors({
        service: fakeService({
          tableName: "IncidentMeasurement",
          answer: [
            {
              _id: MEASUREMENT_ID.toString(),
              cursorId: null,
              exactCreatedAt: "2026-06-01T09:00:00.123456Z",
            },
            {
              _id: MEASUREMENT_ID.toString(),
              cursorId: EXACT_CURSOR.id.toString(),
              exactCreatedAt: "2026-06-01T09:00:00.123Z",
            },
            {
              cursorId: EXACT_CURSOR.id.toString(),
              exactCreatedAt: "2026-06-01T09:00:00.123456Z",
            },
            null,
            7,
          ],
          captured: [],
        }),
        measurementIds: [MEASUREMENT_ID],
      });

    expect(cursors.size).toBe(0);

    for (const answer of [undefined, null, "SELECT 0", {}]) {
      await expect(
        MeasurementBackfillProgress.readExactCursors({
          service: fakeService({
            tableName: "IncidentMeasurement",
            answer: answer,
            captured: [],
          }),
          measurementIds: [MEASUREMENT_ID],
        }),
      ).resolves.toEqual(new Map());
    }
  });

  test("asks nothing for no measurements, and refuses a service that names no table", async () => {
    const captured: Array<CapturedQuery> = [];

    await expect(
      MeasurementBackfillProgress.readExactCursors({
        service: fakeService({ tableName: "IncidentMeasurement", captured }),
        measurementIds: [],
      }),
    ).resolves.toEqual(new Map());
    expect(captured).toEqual([]);

    await expect(
      MeasurementBackfillProgress.readExactCursors({
        service: fakeService({ tableName: null, captured }),
        measurementIds: [MEASUREMENT_ID],
      }),
    ).rejects.toThrow("the measurement service names no table");
    expect(captured).toEqual([]);
  });

  test("passes a failing read's error on, for the job to fall back on the cursor to the millisecond", async () => {
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
      MeasurementBackfillProgress.readExactCursors({
        service: service,
        measurementIds: [MEASUREMENT_ID],
      }),
    ).rejects.toThrow("connection reset");
  });
});

describe("isExactTimestampOf", () => {
  const READ_AT: Date = new Date("2026-06-01T09:00:00.123Z");

  test("holds for the createdAt read to the millisecond, to every microsecond of it", () => {
    for (const microseconds of ["000", "001", "456", "999"]) {
      expect(
        isExactTimestampOf(`2026-06-01T09:00:00.123${microseconds}Z`, READ_AT),
      ).toBe(true);
    }
  });

  test("never for another millisecond, other text, or a Date that is not one", () => {
    expect(isExactTimestampOf("2026-06-01T09:00:00.122999Z", READ_AT)).toBe(
      false,
    );
    expect(isExactTimestampOf("2026-06-01T09:00:00.124000Z", READ_AT)).toBe(
      false,
    );
    expect(isExactTimestampOf("2026-06-01T09:00:00.123Z", READ_AT)).toBe(false);
    expect(isExactTimestampOf(undefined, READ_AT)).toBe(false);
    expect(isExactTimestampOf(123456, READ_AT)).toBe(false);
    expect(
      isExactTimestampOf("2026-06-01T09:00:00.123456Z", new Date("nope")),
    ).toBe(false);
  });

  test("the text is what the SQL writes: UTC, six digits of the second", () => {
    expect(getExactTimestampSql(`"createdAt"`)).toBe(
      `to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    );
    expect(EXACT_TIMESTAMP_TEXT.test("2026-06-01T09:00:00.123456Z")).toBe(true);
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
