import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import MeasurementBackfillProgress, {
  getExactTimestampSql,
  isExactTimestampOf,
  MeasurementBackfillCursor,
  MeasurementBackfillService,
  MeasurementBackfillStatement,
} from "./MeasurementBackfillProgress";

/*
 * ONE PAGE OF A MEASUREMENT'S BACKFILL: THE RECORDS AFTER THE CURSOR, IN AN
 * ORDER WITH NO TIES.
 *
 * The backfill worker (Workers/Jobs/Measurement/BackfillMeasurements) walks
 * every incident, alert or scheduled maintenance event of a project, a page
 * at a time, and saves where each page ended (MeasurementBackfillProgress)
 * so the next page, the next tick or a restarted worker goes on from there.
 *
 * The walk is in (createdAt, _id) order, and the cursor is the last record
 * of a page - its createdAt AND its _id - so every record is visited once,
 * even where many share one createdAt. It used to be createdAt alone, read
 * from it inclusively (#8171): a page that ended inside a run of records
 * created at one moment started again at that moment, and when more than a
 * page of records shared it - every record inserted in one transaction gets
 * the same now(): a bulk import, a migration that copies records - every
 * page was the same page. The walk stopped there for good: the records
 * after it were never worked out, and the measurement never finished.
 *
 * TO THE MICROSECOND. Postgres keeps createdAt in microseconds, and
 * node-postgres reads it to the millisecond, so a createdAt read as a Date
 * can be up to 999 microseconds before the record's own. Compared with that,
 * a run of records created within one millisecond would be read again, page
 * after page, as the run of equal timestamps was. So a page hands back each
 * record's createdAt to the microsecond too, as text (exactCreatedAt), the
 * cursor is saved and compared as that text, and the page after a cursor
 * compares with the cursor record's own createdAt, read in the same
 * statement by its _id (deleted with a deletedAt or not). When that record
 * is gone for good, deleted since, the cursor's createdAt stands in, and to
 * the microsecond it stands in exactly: the page goes on right after the
 * record that was there. It used to stand in cut to the millisecond
 * (#8388), which never passed over a record, but read again every record
 * created in that millisecond before it - for a run one statement inserted,
 * the whole run up to it, a tick's work done twice. A cursor saved before
 * #8388, or read without its microseconds, still stands in so, and reads
 * that millisecond again at most once.
 *
 * Read in the order Incident's and Alert's (projectId, createdAt) index
 * keeps, so a page of them is a short read of the index from the cursor on
 * rather than a sort of every record of the project. (Scheduled maintenance
 * events are read by their projectId index: a project has few.) Records
 * deleted with a deletedAt are left out, as findBy leaves them out.
 */

// Where a page starts: after this record. A cursor saved before #8171 has no id.
export interface MeasurementBackfillPageAfter {
  createdAt: Date;
  // The createdAt to the microsecond, when known (MeasurementBackfillCursor).
  exactCreatedAt?: string | undefined;
  id?: ObjectID | undefined;
}

export default class MeasurementBackfillPage {
  /*
   * The read of one page. With no cursor, the project from its first record;
   * with one, the records after it; with a cursor saved before the walk kept
   * an id, the records from its createdAt on, the boundary moment included:
   * the old walk's inclusive read, once, after which the walk has an id.
   */
  public static getStatement(data: {
    tableName: string;
    projectId: ObjectID;
    after?: MeasurementBackfillPageAfter | undefined;
    limit: number;
  }): MeasurementBackfillStatement {
    if (!Number.isInteger(data.limit) || data.limit < 1) {
      throw new BadDataException(
        "MeasurementBackfillPage: a page needs a limit of at least one record.",
      );
    }

    const table: string = `"${data.tableName}"`;
    const parameters: Array<unknown> = [data.projectId.toString()];
    const conditions: Array<string> = [
      `"projectId" = $1`,
      `"deletedAt" IS NULL`,
    ];

    if (data.after) {
      // To the microsecond when the cursor has it (#8388).
      parameters.push(
        MeasurementBackfillProgress.getCursorCreatedAtParameter(data.after),
      );
      const createdAtParameter: number = parameters.length;

      /*
       * Implied by the comparison below, and said apart so the read starts
       * at the cursor in the (projectId, createdAt) index.
       */
      conditions.push(`"createdAt" >= $${createdAtParameter}`);

      if (data.after.id) {
        parameters.push(data.after.id.toString());
        const idParameter: number = parameters.length;

        conditions.push(
          `("createdAt", "_id") > (COALESCE((SELECT "cursor"."createdAt" FROM ${table} AS "cursor" WHERE "cursor"."_id" = $${idParameter}), $${createdAtParameter}), $${idParameter})`,
        );
      }
    }

    parameters.push(data.limit);

    return {
      sql: `SELECT "_id", "createdAt", ${getExactTimestampSql(`"createdAt"`)} AS "exactCreatedAt" FROM ${table} WHERE ${conditions.join(" AND ")} ORDER BY "createdAt" ASC, "_id" ASC LIMIT $${parameters.length}`,
      parameters: parameters,
    };
  }

  /*
   * Reads the page from the table its service names, on that service's
   * connection: each record's id and createdAt - to the millisecond, and to
   * the microsecond - oldest first. The last of them is where the next page
   * starts.
   */
  public static async read(data: {
    service: MeasurementBackfillService;
    projectId: ObjectID;
    after?: MeasurementBackfillPageAfter | undefined;
    limit: number;
  }): Promise<Array<MeasurementBackfillCursor>> {
    const tableName: string | null = data.service.getModel().tableName;

    if (!tableName) {
      throw new BadDataException(
        "MeasurementBackfillPage: the service names no table.",
      );
    }

    const statement: MeasurementBackfillStatement =
      MeasurementBackfillPage.getStatement({
        tableName: tableName,
        projectId: data.projectId,
        after: data.after,
        limit: data.limit,
      });

    const rows: unknown = await data.service
      .getRepository()
      .manager.query(statement.sql, statement.parameters);

    if (!Array.isArray(rows)) {
      throw new BadDataException(
        `MeasurementBackfillPage: the read of ${tableName} answered no rows.`,
      );
    }

    return rows.map((row: unknown): MeasurementBackfillCursor => {
      const record: {
        _id?: unknown;
        createdAt?: unknown;
        exactCreatedAt?: unknown;
      } = (row || {}) as {
        _id?: unknown;
        createdAt?: unknown;
        exactCreatedAt?: unknown;
      };

      if (
        typeof record._id !== "string" ||
        !(record.createdAt instanceof Date) ||
        Number.isNaN(record.createdAt.getTime())
      ) {
        throw new BadDataException(
          `MeasurementBackfillPage: a record of ${tableName} was read without its id or createdAt.`,
        );
      }

      return {
        id: new ObjectID(record._id),
        createdAt: record.createdAt,
        /*
         * Only text that is this createdAt to the microsecond: without it,
         * the cursor stands in to the millisecond, as it did before #8388.
         */
        exactCreatedAt: isExactTimestampOf(
          record.exactCreatedAt,
          record.createdAt,
        )
          ? record.exactCreatedAt
          : undefined,
      };
    });
  }
}
