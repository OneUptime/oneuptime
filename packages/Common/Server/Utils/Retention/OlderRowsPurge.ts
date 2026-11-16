import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OneUptimeDate from "../../../Types/Date";
import DatabaseService from "../../Services/DatabaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import JobDeadline from "../JobDeadline";
import logger from "../Logger";
import TablePurgeWalk, {
  TablePurgeOfTable,
  TablePurgeSummary,
  getPurgedTableName,
  readPurgedCount,
} from "./TablePurgeWalk";

/*
 * DELETING THE ROWS OLDER THAN THEIR TABLE KEEPS THEM (OneUptime issue
 * #8894), for the daily Workers job HardDelete:HardDeleteOlderItemsInDatabase.
 *
 * A service says how long its table keeps a row, and by which of its
 * columns (DatabaseService.hardDeleteItemsOlderThanInDays): the email, SMS,
 * call and chat logs for a few days, the feeds and rules for three years, a
 * session for 30 days after its refresh token expired, and so on. Most say
 * so only where billing is on (OneUptime Cloud); some on every installation
 * - sessions, monitor tests, OAuth grants, scans. A row whose column is
 * older than that is deleted for good by its service's hardDeleteBy, as
 * OneUptime: the database's ON DELETE rules take what the row carries, the
 * service lets go of what it showed (status page caches, published images,
 * attached and custom field files), a table that keeps some rows from a
 * delete by query keeps them (a state timeline's current row), and nobody
 * is notified. The windows are the services' own; nothing here changes one.
 *
 * WHICH TABLES
 *
 * Every database service that names a column and a window of more than 0
 * days, in the order of the job's service list. One with no window, or one
 * that cannot be read as a number of days, is never read: a negative window
 * would put the cut-off in the future, and take every row.
 *
 * HOW MUCH, HOW OFTEN
 *
 * Daily, with the walk the purge of soft-deleted rows uses (TablePurgeWalk):
 * a table's rows due go OLDER_ROWS_PURGE_BATCH_SIZE a statement, the next
 * batch once one is done, until a batch removes nothing. This used to be up
 * to 10,000 rows a statement (LIMIT_MAX), with no time budget: on a big
 * table one such DELETE, with its cascades, held locks for long, and a
 * backlog could outlive the job's time limit, so the tables after it were
 * never reached. Now a run spends at most OLDER_ROWS_PURGE_TIME_BUDGET_MS
 * draining backlogs; once that is spent each table left still gets one
 * batch, and what is left goes the next day. The job's deadline - its time
 * limit, or a lost lock - stops the run before its next batch. A table whose
 * purge fails is logged and tried again the next day; the others go on.
 */

// Rows one statement deletes, at most.
export const OLDER_ROWS_PURGE_BATCH_SIZE: number = 1000;

/*
 * What a run may spend draining backlogs. Once it is spent, each table left
 * gets one batch; the job's own timeout is longer, so those batches, and the
 * one in flight, finish.
 */
export const OLDER_ROWS_PURGE_TIME_BUDGET_MS: number = 20 * 60 * 1000;

// What one table's purge did in a run.
export type OlderRowsPurgeOfTable = TablePurgeOfTable;

// What a run did; `tables` counts the tables with a window it worked on.
export type OlderRowsPurgeSummary = TablePurgeSummary;

export default class OlderRowsPurge {
  // The clock, a seam for tests.
  public static now: () => Date = (): Date => {
    return new Date();
  };

  /*
   * Whether the service's table has rows to delete by age: a database
   * service that names a column and keeps its rows a number of days greater
   * than 0. Anything in the service list that is not a database service has
   * no rows.
   */
  public static isPurged(
    service: unknown,
  ): service is DatabaseService<BaseModel> {
    if (!(service instanceof DatabaseService)) {
      return false;
    }

    const days: unknown = service.hardDeleteItemsOlderThanDays;

    return (
      Boolean(service.hardDeleteItemByColumnName) &&
      typeof days === "number" &&
      Number.isFinite(days) &&
      days > 0
    );
  }

  // When a row's column must be before, for the row to be due.
  public static getCutoff(service: DatabaseService<BaseModel>): Date {
    return OneUptimeDate.getSomeDaysAgoFromDate(
      this.now(),
      service.hardDeleteItemsOlderThanDays,
    );
  }

  /*
   * One batch of a table: up to OLDER_ROWS_PURGE_BATCH_SIZE of its rows whose
   * column is older than its window, deleted for good as OneUptime, from the
   * first row due. How many went.
   */
  public static async purgeBatch(
    service: DatabaseService<BaseModel>,
  ): Promise<number> {
    return readPurgedCount(
      await service.hardDeleteBy({
        query: {
          [service.hardDeleteItemByColumnName]: QueryHelper.lessThan(
            this.getCutoff(service),
          ),
        },
        props: {
          isRoot: true,
        },
        limit: OLDER_ROWS_PURGE_BATCH_SIZE,
        skip: 0,
      }),
    );
  }

  /*
   * A table's rows due, a batch at a time, until a batch removes nothing or
   * - after a batch, so every table gets one - isOutOfTime says the run is
   * to stop draining. A failed batch is thrown to the caller.
   */
  public static async purgeTable(data: {
    service: DatabaseService<BaseModel>;
    isOutOfTime: () => boolean;
  }): Promise<OlderRowsPurgeOfTable> {
    return await TablePurgeWalk.purgeTable({
      purgeBatch: (): Promise<number> => {
        return this.purgeBatch(data.service);
      },
      isOutOfTime: data.isOutOfTime,
    });
  }

  /*
   * Every table with a window, in the order of `services`, as far as the
   * time budget and the deadline go (see the header). One table's failure is
   * logged and the rest go on: it is tried again next run.
   */
  public static async run(data: {
    services: ReadonlyArray<unknown>;
    deadline?: JobDeadline | undefined;
    timeBudgetMs?: number | undefined;
  }): Promise<OlderRowsPurgeSummary> {
    return await TablePurgeWalk.run({
      services: data.services.filter(
        (service: unknown): service is DatabaseService<BaseModel> => {
          return this.isPurged(service);
        },
      ),
      purgeTable: (
        service: DatabaseService<BaseModel>,
        isOutOfTime: () => boolean,
      ): Promise<OlderRowsPurgeOfTable> => {
        return this.purgeTable({ service: service, isOutOfTime: isOutOfTime });
      },
      onTableFailed: (
        service: DatabaseService<BaseModel>,
        error: unknown,
      ): void => {
        logger.error(
          `Retention: deleting the ${getPurgedTableName(service)} rows older than ${service.hardDeleteItemsOlderThanDays} days failed. They are tried again next run.`,
        );
        logger.error(error);
      },
      now: (): Date => {
        return this.now();
      },
      deadline: data.deadline,
      timeBudgetMs: data.timeBudgetMs ?? OLDER_ROWS_PURGE_TIME_BUDGET_MS,
    });
  }
}
