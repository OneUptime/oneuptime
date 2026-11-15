import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

/*
 * HOW FAR A MEASUREMENT'S BACKFILL HAS GOT, WRITTEN ONLY FOR THE REQUEST IT
 * BELONGS TO.
 *
 * A measurement's history is asked to be worked out again by stamping
 * backfillRequestedAt and clearing the cursor (backfillCursorCreatedAt and
 * backfillCursorId) and backfillCompletedAt: when the measurement is made and when what it means
 * changes (the measurement services' onBeforeCreate and onUpdatePermitted),
 * when First Paged At is filled for records paged before the upgrade
 * (FirstPagedAt), and when its points are rewritten in their unit
 * (RewriteMeasurementPointsInTheirUnit). The backfill worker
 * (Workers/Jobs/Measurement/BackfillMeasurements) then walks the project,
 * saving its cursor page by page and stamping backfillCompletedAt at the end.
 *
 * A request made while a walk is under way has to win: the walk read the
 * request before it, and what it has worked out so far was worked out by the
 * old definition. So every write of a walk is a compare-and-set - one
 * statement that writes only while backfillRequestedAt still holds the stamp
 * the walk began from - and answers whether it wrote. As plain updates
 * (#8105), a walk that finished after an edit stamped completion over the new
 * request, and the history was never worked out by the new definition; one
 * that saved its cursor after an edit wrote it over the cleared one, and the
 * walk for the new definition resumed part way instead of from the start.
 *
 * The stamp is compared to the millisecond. node-postgres reads a timestamp
 * to the millisecond and drops the rest, and FirstPagedAt stamps the request
 * with the database's now(), which keeps microseconds. Compared exactly, as
 * compareAndSetColumnsByIdWithoutHooks compared until #8173, the stamp a walk
 * read would never match the stored one: every write of the walk would be
 * refused, and that measurement would never finish its backfill.
 *
 * The cursor's createdAt is written to the microsecond, as the record has it
 * (#8388): as text no Date can cut, which is also why the write is a
 * statement of its own rather than compareAndSetColumnsByIdWithoutHooks,
 * whose values go through a Date. Cut to the millisecond, it stood for the
 * record's own createdAt badly once that record was deleted for good: the
 * next page read again every record created in that millisecond before it
 * (MeasurementBackfillPage). readExactCursors reads it back the same way.
 *
 * Written past the services' hooks, leaving the version and updatedAt alone,
 * as FirstPagedAt writes: nobody edited the measurement. Through
 * updateOneById every page of a walk also started the project's workflows
 * that run when a measurement is updated.
 */

/*
 * A timestamp as Postgres keeps it, to the microsecond, as text: ISO 8601 in
 * UTC with six digits of the second ("2026-11-15T10:00:00.123456Z"). A Date
 * keeps three, and node-postgres reads a timestamp to the millisecond.
 */
export const EXACT_TIMESTAMP_TEXT: RegExp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

// The SQL that reads a timestamp column as that text, whatever the session's zone.
export const getExactTimestampSql: (column: string) => string = (
  column: string,
): string => {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
};

/*
 * Whether `text` is a timestamp to the microsecond of the millisecond
 * `createdAt` is: the exact createdAt of the record a Date read to the
 * millisecond.
 */
export const isExactTimestampOf: (
  text: unknown,
  createdAt: Date,
) => text is string = (text: unknown, createdAt: Date): text is string => {
  return (
    typeof text === "string" &&
    EXACT_TIMESTAMP_TEXT.test(text) &&
    !Number.isNaN(createdAt.getTime()) &&
    text.slice(0, 23) === createdAt.toISOString().slice(0, 23)
  );
};

/*
 * How far a walk has got: the last record it worked out, by the two columns
 * the walk is ordered by (MeasurementBackfillPage). The createdAt alone left
 * the walk no way past a page of records created at one moment (#8171).
 */
export interface MeasurementBackfillCursor {
  // The record's createdAt, to the millisecond, as node-postgres reads it.
  createdAt: Date;
  /*
   * The same createdAt to the microsecond, as Postgres keeps it
   * (EXACT_TIMESTAMP_TEXT): what the cursor is written and compared as when
   * it is known (#8388). A cursor read through TypeORM, or saved before, has
   * none: its createdAt stands in, cut to the millisecond.
   */
  exactCreatedAt?: string | undefined;
  id: ObjectID;
}

// One write of a walk, and the request it belongs to.
export interface MeasurementBackfillProgressWrite {
  measurementId: ObjectID;
  // backfillRequestedAt as the walk read it, before its first page.
  requestedAt: Date;
  /*
   * How far the walk has got, written to backfillCursorCreatedAt and
   * backfillCursorId together. Left alone when absent.
   */
  cursor?: MeasurementBackfillCursor | undefined;
  // When the walk finished. Left alone when absent.
  completedAt?: Date | undefined;
}

// A cursor a measurement holds, read to the microsecond (readExactCursors).
export interface MeasurementBackfillStoredCursor {
  // backfillCursorId, as uuid text.
  id: string;
  // backfillCursorCreatedAt, to the microsecond (EXACT_TIMESTAMP_TEXT).
  exactCreatedAt: string;
}

// The statement a write is, with its parameters in order.
export interface MeasurementBackfillStatement {
  sql: string;
  parameters: Array<unknown>;
}

/*
 * The service of a measurement table (IncidentMeasurementService,
 * AlertMeasurementService or ScheduledMaintenanceMeasurementService): the
 * table the write goes to, and the connection it goes on. A page of the walk
 * (MeasurementBackfillPage) is read the same way from the service of the
 * records walked (IncidentService, AlertService or
 * ScheduledMaintenanceService).
 */
export interface MeasurementBackfillService {
  getModel: () => { tableName: string | null };
  getRepository: () => {
    manager: {
      query: (sql: string, parameters?: Array<unknown>) => Promise<unknown>;
    };
  };
}

export default class MeasurementBackfillProgress {
  /*
   * The compare-and-set a write is. The UPDATE sits in a CTE the statement
   * SELECTs from, as in compareAndSetColumnsByIdWithoutHooks: TypeORM answers
   * a bare UPDATE with [rows, rowCount], an array of two whether or not it
   * wrote, so only the rows it hands back tell a write from a refusal.
   */
  public static getStatement(data: {
    tableName: string;
    write: MeasurementBackfillProgressWrite;
  }): MeasurementBackfillStatement {
    const assignments: Array<string> = [];
    const parameters: Array<unknown> = [];

    /*
     * Only what the walk has. A completion with no cursor - a project with
     * nothing in it - leaves the cursor as it is: null would clear it. The
     * cursor's two columns are written together, always: one record's
     * createdAt with another's id would start the next page in the wrong
     * place.
     */
    if (data.write.cursor) {
      parameters.push(
        MeasurementBackfillProgress.getCursorCreatedAtParameter(
          data.write.cursor,
        ),
      );
      assignments.push(`"backfillCursorCreatedAt" = $${parameters.length}`);
      parameters.push(data.write.cursor.id.toString());
      assignments.push(`"backfillCursorId" = $${parameters.length}`);
    }

    if (data.write.completedAt) {
      parameters.push(data.write.completedAt);
      assignments.push(`"backfillCompletedAt" = $${parameters.length}`);
    }

    if (assignments.length === 0) {
      throw new BadDataException(
        "MeasurementBackfillProgress: a write needs a cursor or a completion to write.",
      );
    }

    parameters.push(data.write.measurementId.toString());
    const idParameter: number = parameters.length;

    parameters.push(data.write.requestedAt);
    const requestedAtParameter: number = parameters.length;

    return {
      sql: `WITH "saved" AS (UPDATE "${data.tableName}" SET ${assignments.join(", ")} WHERE "_id" = $${idParameter} AND date_trunc('milliseconds', "backfillRequestedAt") = $${requestedAtParameter} RETURNING "_id") SELECT "_id" FROM "saved"`,
      parameters: parameters,
    };
  }

  /*
   * What a cursor's createdAt is bound as: to the microsecond when the
   * cursor has it - text Postgres reads as the timestamp it names, exactly -
   * and the Date otherwise.
   */
  public static getCursorCreatedAtParameter(cursor: {
    createdAt: Date;
    exactCreatedAt?: string | undefined;
  }): Date | string {
    if (cursor.exactCreatedAt === undefined) {
      return cursor.createdAt;
    }

    if (!isExactTimestampOf(cursor.exactCreatedAt, cursor.createdAt)) {
      throw new BadDataException(
        `MeasurementBackfillProgress: the cursor's createdAt to the microsecond, ${JSON.stringify(
          cursor.exactCreatedAt,
        )}, is not one of the millisecond it was read at.`,
      );
    }

    return cursor.exactCreatedAt;
  }

  /*
   * Writes how far the walk got, while the measurement's request is still
   * the one the walk began from. True when it wrote; false when the
   * measurement was asked for again since (or is gone), and nothing was
   * written.
   */
  public static async save(data: {
    service: MeasurementBackfillService;
    write: MeasurementBackfillProgressWrite;
  }): Promise<boolean> {
    const tableName: string = MeasurementBackfillProgress.getTableName(
      data.service,
    );

    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getStatement({
        tableName: tableName,
        write: data.write,
      });

    const result: unknown = await data.service
      .getRepository()
      .manager.query(statement.sql, statement.parameters);

    return Array.isArray(result) && result.length > 0;
  }

  /*
   * The read of the cursors these measurements hold, each createdAt to the
   * microsecond. Only a cursor with both columns: one saved before the walk
   * kept an id (#8171) was written from a Date, whole milliseconds.
   */
  public static getExactCursorsStatement(data: {
    tableName: string;
    measurementIds: Array<ObjectID>;
  }): MeasurementBackfillStatement {
    return {
      sql: `SELECT "_id", "backfillCursorId" AS "cursorId", ${getExactTimestampSql(
        `"backfillCursorCreatedAt"`,
      )} AS "exactCreatedAt" FROM "${data.tableName}" WHERE "_id" = ANY($1) AND "backfillCursorCreatedAt" IS NOT NULL AND "backfillCursorId" IS NOT NULL`,
      parameters: [
        data.measurementIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ],
    };
  }

  /*
   * The cursors these measurements hold, by measurement id, each createdAt
   * to the microsecond: what a read through TypeORM cuts to the millisecond
   * (#8388). A measurement holding no cursor, or one this cannot read whole,
   * is left out, and its walk goes on from the cursor as TypeORM read it.
   */
  public static async readExactCursors(data: {
    service: MeasurementBackfillService;
    measurementIds: Array<ObjectID>;
  }): Promise<Map<string, MeasurementBackfillStoredCursor>> {
    const cursors: Map<string, MeasurementBackfillStoredCursor> = new Map<
      string,
      MeasurementBackfillStoredCursor
    >();

    if (data.measurementIds.length === 0) {
      return cursors;
    }

    const statement: MeasurementBackfillStatement =
      MeasurementBackfillProgress.getExactCursorsStatement({
        tableName: MeasurementBackfillProgress.getTableName(data.service),
        measurementIds: data.measurementIds,
      });

    const rows: unknown = await data.service
      .getRepository()
      .manager.query(statement.sql, statement.parameters);

    if (!Array.isArray(rows)) {
      return cursors;
    }

    for (const row of rows) {
      const stored: {
        _id?: unknown;
        cursorId?: unknown;
        exactCreatedAt?: unknown;
      } = (row || {}) as {
        _id?: unknown;
        cursorId?: unknown;
        exactCreatedAt?: unknown;
      };

      if (
        typeof stored._id !== "string" ||
        typeof stored.cursorId !== "string" ||
        typeof stored.exactCreatedAt !== "string" ||
        !EXACT_TIMESTAMP_TEXT.test(stored.exactCreatedAt)
      ) {
        continue;
      }

      cursors.set(stored._id.toLowerCase(), {
        id: stored.cursorId.toLowerCase(),
        exactCreatedAt: stored.exactCreatedAt,
      });
    }

    return cursors;
  }

  private static getTableName(service: MeasurementBackfillService): string {
    const tableName: string | null = service.getModel().tableName;

    if (!tableName) {
      throw new BadDataException(
        "MeasurementBackfillProgress: the measurement service names no table.",
      );
    }

    return tableName;
  }
}
