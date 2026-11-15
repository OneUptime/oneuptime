import MeasurementBackfillPage from "../../../../Server/Utils/Measurement/MeasurementBackfillPage";
import {
  MeasurementBackfillCursor,
  MeasurementBackfillService,
  MeasurementBackfillStatement,
} from "../../../../Server/Utils/Measurement/MeasurementBackfillProgress";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * MeasurementBackfillPage is the read of one page of a measurement's
 * backfill: a project's incidents, alerts or scheduled maintenance events
 * after the cursor, in (createdAt, _id) order (#8171). These pin the
 * statement - what it compares, in what order, what it leaves out - and how
 * its rows are read. MeasurementBackfillPagePostgres runs it against
 * Postgres, through the walk that uses it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CURSOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CURSOR_CREATED_AT: Date = new Date("2026-06-01T09:00:00.123Z");

const SELECT: string = `SELECT "_id", "createdAt" FROM "Incident" WHERE "projectId" = $1 AND "deletedAt" IS NULL`;
const ORDER: string = `ORDER BY "createdAt" ASC, "_id" ASC`;

interface CapturedQuery {
  sql: string;
  parameters: Array<unknown> | undefined;
}

// A records service whose connection answers every statement with `answer`.
function fakeService(input: {
  tableName: string | null;
  answer: unknown;
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
            return input.answer;
          },
        },
      };
    },
  };
}

describe("MeasurementBackfillPage.getStatement", () => {
  test("the first page: the project's records from its first, oldest first, ties broken by id", () => {
    expect(
      MeasurementBackfillPage.getStatement({
        tableName: "Incident",
        projectId: PROJECT_ID,
        limit: 500,
      }),
    ).toEqual({
      sql: `${SELECT} ${ORDER} LIMIT $2`,
      parameters: [PROJECT_ID.toString(), 500],
    });
  });

  test("after a cursor: the records after its record, compared as (createdAt, _id) with that record's own createdAt", () => {
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillPage.getStatement({
        tableName: "Incident",
        projectId: PROJECT_ID,
        after: { createdAt: CURSOR_CREATED_AT, id: CURSOR_ID },
        limit: 500,
      });

    expect(statement).toEqual({
      sql:
        `${SELECT} AND "createdAt" >= $2 ` +
        `AND ("createdAt", "_id") > (COALESCE((SELECT "cursor"."createdAt" FROM "Incident" AS "cursor" WHERE "cursor"."_id" = $3), $2), $3) ` +
        `${ORDER} LIMIT $4`,
      parameters: [
        PROJECT_ID.toString(),
        CURSOR_CREATED_AT,
        CURSOR_ID.toString(),
        500,
      ],
    });
  });

  test("after a cursor, a record created at the cursor's moment is read only when its id comes after the cursor's: strictly after, never from", () => {
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillPage.getStatement({
        tableName: "Incident",
        projectId: PROJECT_ID,
        after: { createdAt: CURSOR_CREATED_AT, id: CURSOR_ID },
        limit: 500,
      });

    // A row comparison, strictly greater: the cursor's own record is not read again.
    expect(statement.sql).toContain(`("createdAt", "_id") > (`);
    expect(statement.sql).not.toContain(`("createdAt", "_id") >= (`);
    // Nothing compares the timestamp alone, strictly: that would skip the rest of a run.
    expect(statement.sql).not.toMatch(/"createdAt" > \$/);
  });

  test("compares with the cursor record's createdAt as Postgres keeps it, to the microsecond, and with the stored one only when the record is gone", () => {
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillPage.getStatement({
        tableName: "Alert",
        projectId: PROJECT_ID,
        after: { createdAt: CURSOR_CREATED_AT, id: CURSOR_ID },
        limit: 10,
      });

    /*
     * The stored createdAt is the one node-postgres read, to the
     * millisecond: compared with it, records created within that millisecond
     * after the cursor's would be read again on every page.
     */
    expect(statement.sql).toContain(
      `COALESCE((SELECT "cursor"."createdAt" FROM "Alert" AS "cursor" WHERE "cursor"."_id" = $3), $2)`,
    );
    // The record is looked up by its id alone, deleted or not.
    expect(statement.sql).not.toMatch(/"cursor"\."deletedAt"/);
    expect(statement.sql).not.toMatch(/"cursor"\."projectId"/);
  });

  test("starts at the cursor's createdAt in the index: the range is said apart from the row comparison", () => {
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillPage.getStatement({
        tableName: "Incident",
        projectId: PROJECT_ID,
        after: { createdAt: CURSOR_CREATED_AT, id: CURSOR_ID },
        limit: 500,
      });

    expect(statement.sql).toContain(
      `WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "createdAt" >= $2 AND (`,
    );
    // The stored createdAt is never after the record's own, so this drops nothing the comparison keeps.
    expect(statement.parameters[1]).toBe(CURSOR_CREATED_AT);
  });

  test("after a cursor saved before the walk kept an id: the records from its createdAt on, inclusive, as the walk read them before", () => {
    expect(
      MeasurementBackfillPage.getStatement({
        tableName: "Incident",
        projectId: PROJECT_ID,
        after: { createdAt: CURSOR_CREATED_AT },
        limit: 500,
      }),
    ).toEqual({
      sql: `${SELECT} AND "createdAt" >= $2 ${ORDER} LIMIT $3`,
      parameters: [PROJECT_ID.toString(), CURSOR_CREATED_AT, 500],
    });
  });

  test("orders by the createdAt and then the id, both ascending, whatever the cursor", () => {
    for (const after of [
      undefined,
      { createdAt: CURSOR_CREATED_AT },
      { createdAt: CURSOR_CREATED_AT, id: CURSOR_ID },
    ]) {
      const sql: string = MeasurementBackfillPage.getStatement({
        tableName: "Incident",
        projectId: PROJECT_ID,
        after: after,
        limit: 500,
      }).sql;

      expect(sql).toContain(` ${ORDER} LIMIT $`);
      // One ORDER BY, at the end: the ids break every tie.
      expect(sql.match(/ORDER BY/g)).toHaveLength(1);
    }
  });

  test("leaves out records deleted with a deletedAt, as findBy does, and every other project's", () => {
    const sql: string = MeasurementBackfillPage.getStatement({
      tableName: "Incident",
      projectId: PROJECT_ID,
      after: { createdAt: CURSOR_CREATED_AT, id: CURSOR_ID },
      limit: 500,
    }).sql;

    expect(sql).toContain(`"deletedAt" IS NULL`);
    expect(sql).toContain(`"projectId" = $1`);
  });

  test("binds every value, the ids as text and the createdAt as a Date, never into the SQL", () => {
    const statement: MeasurementBackfillStatement =
      MeasurementBackfillPage.getStatement({
        tableName: "Incident",
        projectId: PROJECT_ID,
        after: { createdAt: CURSOR_CREATED_AT, id: CURSOR_ID },
        limit: 500,
      });

    expect(statement.sql).not.toContain(PROJECT_ID.toString());
    expect(statement.sql).not.toContain(CURSOR_ID.toString());
    expect(statement.sql).not.toContain("2026");
    expect(typeof statement.parameters[0]).toBe("string");
    expect(statement.parameters[1]).toBeInstanceOf(Date);
    expect(typeof statement.parameters[2]).toBe("string");
    expect(statement.parameters[3]).toBe(500);
  });

  test("names the table it is given, for each of the three tables a measurement is worked out over", () => {
    for (const tableName of ["Incident", "Alert", "ScheduledMaintenance"]) {
      const sql: string = MeasurementBackfillPage.getStatement({
        tableName: tableName,
        projectId: PROJECT_ID,
        after: { createdAt: CURSOR_CREATED_AT, id: CURSOR_ID },
        limit: 500,
      }).sql;

      expect(sql).toContain(`FROM "${tableName}" WHERE`);
      expect(sql).toContain(`FROM "${tableName}" AS "cursor"`);
    }
  });

  test("refuses a page of no records, or of part of one", () => {
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      expect(() => {
        return MeasurementBackfillPage.getStatement({
          tableName: "Incident",
          projectId: PROJECT_ID,
          limit: limit,
        });
      }).toThrow("a page needs a limit of at least one record");
    }
  });
});

describe("MeasurementBackfillPage.read", () => {
  test("runs the statement on its service's connection and hands each record back as a cursor: its id and createdAt", async () => {
    const captured: Array<CapturedQuery> = [];
    const first: Date = new Date("2026-06-01T09:00:00.123Z");

    const page: Array<MeasurementBackfillCursor> =
      await MeasurementBackfillPage.read({
        service: fakeService({
          tableName: "ScheduledMaintenance",
          answer: [
            { _id: CURSOR_ID.toString(), createdAt: first },
            {
              _id: "44444444-4444-4444-8444-444444444444",
              createdAt: first,
            },
          ],
          captured,
        }),
        projectId: PROJECT_ID,
        after: { createdAt: CURSOR_CREATED_AT, id: CURSOR_ID },
        limit: 2,
      });

    const statement: MeasurementBackfillStatement =
      MeasurementBackfillPage.getStatement({
        tableName: "ScheduledMaintenance",
        projectId: PROJECT_ID,
        after: { createdAt: CURSOR_CREATED_AT, id: CURSOR_ID },
        limit: 2,
      });

    expect(captured).toEqual([
      { sql: statement.sql, parameters: statement.parameters },
    ]);
    expect(page).toHaveLength(2);
    expect(page[0]!.id).toBeInstanceOf(ObjectID);
    expect(page[0]!.id.toString()).toBe(CURSOR_ID.toString());
    expect(page[0]!.createdAt).toBe(first);
    expect(page[1]!.id.toString()).toBe("44444444-4444-4444-8444-444444444444");
  });

  test("answers an empty page with no records", async () => {
    await expect(
      MeasurementBackfillPage.read({
        service: fakeService({
          tableName: "Incident",
          answer: [],
          captured: [],
        }),
        projectId: PROJECT_ID,
        limit: 500,
      }),
    ).resolves.toEqual([]);
  });

  test("refuses a service that names no table, before any SQL", async () => {
    const captured: Array<CapturedQuery> = [];

    await expect(
      MeasurementBackfillPage.read({
        service: fakeService({ tableName: null, answer: [], captured }),
        projectId: PROJECT_ID,
        limit: 500,
      }),
    ).rejects.toThrow("the service names no table");

    expect(captured).toEqual([]);
  });

  test("fails a read that answers no list of rows, rather than ending the walk as if the project were done", async () => {
    for (const answer of [undefined, null, "SELECT 0", {}]) {
      await expect(
        MeasurementBackfillPage.read({
          service: fakeService({
            tableName: "Incident",
            answer: answer,
            captured: [],
          }),
          projectId: PROJECT_ID,
          limit: 500,
        }),
      ).rejects.toThrow("the read of Incident answered no rows");
    }
  });

  test("fails a row without its id or its createdAt: the cursor could not be saved from it", async () => {
    for (const row of [
      { createdAt: CURSOR_CREATED_AT },
      { _id: CURSOR_ID.toString() },
      { _id: CURSOR_ID.toString(), createdAt: "2026-06-01" },
      { _id: CURSOR_ID.toString(), createdAt: new Date("not a date") },
      { _id: 7, createdAt: CURSOR_CREATED_AT },
      null,
    ]) {
      await expect(
        MeasurementBackfillPage.read({
          service: fakeService({
            tableName: "Incident",
            answer: [row],
            captured: [],
          }),
          projectId: PROJECT_ID,
          limit: 500,
        }),
      ).rejects.toThrow("was read without its id or createdAt");
    }
  });

  test("passes a failing statement's error on, so the tick logs it", async () => {
    const service: MeasurementBackfillService = {
      getModel: (): { tableName: string | null } => {
        return { tableName: "Incident" };
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
      MeasurementBackfillPage.read({
        service: service,
        projectId: PROJECT_ID,
        limit: 500,
      }),
    ).rejects.toThrow("connection reset");
  });
});

/*
 * The statement names its columns itself, outside TypeORM's metadata, so
 * these hold the names to the three models it reads: a column renamed in a
 * model fails here, not in production. And it relies on an index to read
 * one project's records: Incident's and Alert's (projectId, createdAt),
 * which also starts a page at the cursor, and ScheduledMaintenance's
 * projectId (a project has few events). An index dropped fails here, not as
 * a slow walk.
 */
describe("the tables the page reads", () => {
  interface RecordTable {
    model: { new (): BaseModel };
    tableName: string;
    index: Array<string>;
  }

  const TABLES: Array<RecordTable> = [
    {
      model: Incident,
      tableName: "Incident",
      index: ["projectId", "createdAt"],
    },
    { model: Alert, tableName: "Alert", index: ["projectId", "createdAt"] },
    {
      model: ScheduledMaintenance,
      tableName: "ScheduledMaintenance",
      index: ["projectId"],
    },
  ];

  function columnOf(
    model: { new (): BaseModel },
    propertyName: string,
  ): ColumnMetadataArgs | undefined {
    return getMetadataArgsStorage().columns.find(
      (candidate: ColumnMetadataArgs) => {
        return (
          (candidate.target === model ||
            (typeof candidate.target === "function" &&
              model.prototype instanceof candidate.target)) &&
          candidate.propertyName === propertyName
        );
      },
    );
  }

  test.each(TABLES)(
    "$tableName is the table, with the columns the statement names under their own names",
    (table: RecordTable) => {
      expect(new table.model().tableName).toBe(table.tableName);

      for (const column of ["_id", "createdAt", "deletedAt", "projectId"]) {
        const typeormColumn: ColumnMetadataArgs | undefined = columnOf(
          table.model,
          column,
        );

        expect(typeormColumn).toBeDefined();
        expect(typeormColumn?.options.name).toBeUndefined();
      }

      // createdAt keeps microseconds: why the page compares with the record's own.
      expect(columnOf(table.model, "createdAt")?.options.type).toBe(
        "timestamptz",
      );
      expect(columnOf(table.model, "createdAt")?.mode).toBe("createDate");
      expect(columnOf(table.model, "deletedAt")?.mode).toBe("deleteDate");
    },
  );

  test.each(TABLES)(
    "$tableName has the index ($index) a page reads one project's records by",
    (table: RecordTable) => {
      const index: IndexMetadataArgs | undefined =
        getMetadataArgsStorage().indices.find(
          (candidate: IndexMetadataArgs) => {
            return (
              candidate.target === table.model &&
              Array.isArray(candidate.columns) &&
              JSON.stringify(candidate.columns) === JSON.stringify(table.index)
            );
          },
        );

      expect(index).toBeDefined();
      // Not a partial index: it holds every record of the project.
      expect(index?.where).toBeUndefined();
    },
  );
});
