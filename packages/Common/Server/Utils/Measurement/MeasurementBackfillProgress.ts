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
 * Written past the services' hooks, leaving the version and updatedAt alone,
 * as FirstPagedAt writes: nobody edited the measurement. Through
 * updateOneById every page of a walk also started the project's workflows
 * that run when a measurement is updated.
 */

/*
 * How far a walk has got: the last record it worked out, by the two columns
 * the walk is ordered by (MeasurementBackfillPage). The createdAt alone left
 * the walk no way past a page of records created at one moment (#8171).
 */
export interface MeasurementBackfillCursor {
  createdAt: Date;
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
      parameters.push(data.write.cursor.createdAt);
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
   * Writes how far the walk got, while the measurement's request is still
   * the one the walk began from. True when it wrote; false when the
   * measurement was asked for again since (or is gone), and nothing was
   * written.
   */
  public static async save(data: {
    service: MeasurementBackfillService;
    write: MeasurementBackfillProgressWrite;
  }): Promise<boolean> {
    const tableName: string | null = data.service.getModel().tableName;

    if (!tableName) {
      throw new BadDataException(
        "MeasurementBackfillProgress: the measurement service names no table.",
      );
    }

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
}
