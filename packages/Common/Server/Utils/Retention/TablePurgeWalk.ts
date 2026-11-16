import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../Services/DatabaseService";
import JobDeadline from "../JobDeadline";

/*
 * THE WALK THE DAILY PURGES SHARE: SoftDeletedRowsPurge (the rows soft
 * deleted more than 30 days ago, issue #6528) and OlderRowsPurge (the rows
 * older than their table keeps them, issue #8894), for the Workers jobs
 * HardDelete:HardDeleteItemsInDatabase and
 * HardDelete:HardDeleteOlderItemsInDatabase.
 *
 * A purge hands the walk its tables, in order, and how one batch of a table
 * goes: one statement's worth of rows, deleted for good. The walk takes the
 * tables in turn, each a batch at a time - the next batch once one is done -
 * until a batch removes nothing: a backlog of millions never takes a long
 * lock or one long statement. A run spends at most its time budget draining
 * backlogs; once that is spent, each table left still gets one batch, so no
 * table waits behind another's backlog, and what is left goes on the next
 * run. The job's deadline - its time limit, or a lost lock - stops the walk
 * before its next batch. A table whose purge fails is handed back to the
 * purge, which logs it, and is tried again the next run; the others go on.
 *
 * A batch removes rows from the first one due, so the rows a batch removes
 * are gone, and a table that removes its rows in an order of its own -
 * network sites and their types, leaves first (NetworkSiteLeafPurge) - finds
 * the next ones itself. So a batch that removes fewer rows than a statement
 * may is no sign the table is done; one that removes none is.
 */

// What one table's purge did in a run.
export interface TablePurgeOfTable {
  // Rows deleted for good.
  purged: number;
  // Rows due may be left: the run was out of time before a batch removed nothing.
  isCutShort: boolean;
}

// A table rows were deleted from in a run, and how many.
export interface TablePurgedTable {
  table: string;
  purged: number;
}

export interface TablePurgeSummary {
  // Tables the run worked on.
  tables: number;
  // Rows deleted for good.
  purged: number;
  // The tables rows were deleted from, in the order they were worked on.
  purgedTables: Array<TablePurgedTable>;
  // Tables whose purge failed: logged, and tried again next run.
  failedTables: number;
  // Rows due were left for the next run: out of time, or past the deadline.
  isCutShort: boolean;
}

// What a batch says it removed, as a count: never negative, never NaN.
export function readPurgedCount(value: unknown): number {
  const count: number = Number(value);

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

// The table a service writes, for the log.
export function getPurgedTableName(
  service: DatabaseService<BaseModel>,
): string {
  return (
    service.getModel()?.tableName || service.modelType?.name || "unknown table"
  );
}

export default class TablePurgeWalk {
  /*
   * A table's rows due, a batch at a time, until a batch removes nothing or
   * - after a batch, so every table gets one - isOutOfTime says the run is
   * to stop draining. A failed batch is thrown to the caller.
   */
  public static async purgeTable(data: {
    purgeBatch: () => Promise<number>;
    isOutOfTime: () => boolean;
  }): Promise<TablePurgeOfTable> {
    let purged: number = 0;

    for (;;) {
      const removed: number = readPurgedCount(await data.purgeBatch());

      purged += removed;

      if (removed === 0) {
        return { purged: purged, isCutShort: false };
      }

      if (data.isOutOfTime()) {
        return { purged: purged, isCutShort: true };
      }
    }
  }

  /*
   * Every table of `services`, in their order, as far as the time budget and
   * the deadline go (see the header). One table's failure is handed to
   * onTableFailed and the rest go on.
   */
  public static async run(data: {
    // The tables the purge takes, already chosen, in the order to take them.
    services: ReadonlyArray<DatabaseService<BaseModel>>;
    // One table's rows due, as far as isOutOfTime lets it go.
    purgeTable: (
      service: DatabaseService<BaseModel>,
      isOutOfTime: () => boolean,
    ) => Promise<TablePurgeOfTable>;
    // A table whose purge threw: the purge logs it.
    onTableFailed: (
      service: DatabaseService<BaseModel>,
      error: unknown,
    ) => void;
    // The purge's clock.
    now: () => Date;
    deadline?: JobDeadline | undefined;
    timeBudgetMs: number;
  }): Promise<TablePurgeSummary> {
    const startedAt: number = data.now().getTime();

    const summary: TablePurgeSummary = {
      tables: 0,
      purged: 0,
      purgedTables: [],
      failedTables: 0,
      isCutShort: false,
    };

    const isPastDeadline: () => boolean = (): boolean => {
      return Boolean(data.deadline?.hasPassed());
    };

    const isOutOfTime: () => boolean = (): boolean => {
      return (
        isPastDeadline() ||
        data.now().getTime() - startedAt >= data.timeBudgetMs
      );
    };

    for (const service of data.services) {
      // Past the deadline, the tables left wait for the next run.
      if (isPastDeadline()) {
        summary.isCutShort = true;
        return summary;
      }

      summary.tables += 1;

      try {
        const result: TablePurgeOfTable = await data.purgeTable(
          service,
          isOutOfTime,
        );

        summary.purged += result.purged;

        if (result.purged > 0) {
          summary.purgedTables.push({
            table: getPurgedTableName(service),
            purged: result.purged,
          });
        }

        if (result.isCutShort) {
          summary.isCutShort = true;
        }
      } catch (error) {
        summary.failedTables += 1;
        data.onTableFailed(service, error);
      }
    }

    return summary;
  }
}
