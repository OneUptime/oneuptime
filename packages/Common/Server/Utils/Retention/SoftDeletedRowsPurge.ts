import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OneUptimeDate from "../../../Types/Date";
import DatabaseService from "../../Services/DatabaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import JobDeadline from "../JobDeadline";
import logger from "../Logger";

/*
 * DELETING FOR GOOD THE ROWS SOFT DELETED MORE THAN 30 DAYS AGO (OneUptime
 * issue #6528), for the daily Workers job HardDelete:HardDeleteItemsInDatabase.
 *
 * A person's Delete removes a row at once (DatabaseService.deleteBy ends in a
 * DELETE). A row is soft deleted - "deletedAt" set, so every read leaves it
 * out - only:
 *
 *   - by OneUptime itself, on a schedule: the hourly age-out of the
 *     discovered devices nothing sees any more (DiscoveredDeviceAgeOut, the
 *     NetworkEndpoint table, since issue #6389);
 *   - by a migration that set rows aside: the duplicates
 *     RestoreDroppedUniqueIndexes kept out of the unique indexes it put back,
 *     the SNMP monitors AddNetworkDeviceTables retired;
 *   - by a write from outside the app.
 *
 * Such a row is kept for SOFT_DELETED_ROWS_RETENTION_IN_DAYS, so a removal
 * that went wrong - an Unseen Devices time set too short - can still be
 * undone in the database, and is then deleted for good by its service's
 * hardDeleteBy, as OneUptime: the database's ON DELETE rules take what the
 * row carries, the service lets go of what it showed (status page caches,
 * published images, custom field files), and nobody is notified.
 *
 * WHICH TABLES
 *
 *   - Where billing is on (OneUptime Cloud): every service's, as always.
 *   - Everywhere else (self-hosted): only the services whose rows OneUptime
 *     soft deletes on its own, on a schedule
 *     (DatabaseService.purgesSoftDeletedRowsOnEveryInstall): today the
 *     discovered devices. The whole purge has run only where billing is on
 *     since December 2023 (b483cf1601a, "Add billing check before performing
 *     hard delete", no reason given), when nothing in the app soft deleted
 *     rows any more. Whether a self-hosted install should purge every
 *     table's soft-deleted rows too is the maintainer's call (issue #6528),
 *     so it does not.
 *   - Never a service marked doNotAllowDelete.
 *
 * HOW MUCH, HOW OFTEN
 *
 * Daily. A table's rows due go SOFT_DELETED_ROWS_PURGE_BATCH_SIZE a
 * statement, the next batch once one is done, until a batch removes nothing:
 * a backlog of millions - a guest network's devices, aged out in one go -
 * never takes a long lock or one long statement. A run spends at most
 * SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS draining backlogs. Once that is
 * spent, each table left still gets one batch, so no table waits behind
 * another's backlog, and what is left goes over the next days. The job's
 * deadline - its time limit, or a lost lock - stops the run before its next
 * batch. A table whose purge fails is logged and tried again the next day;
 * the others go on.
 *
 * Each batch asks from the first row due: the rows a batch removes are gone,
 * and a table that removes its rows in an order of its own - network sites
 * and their types, leaves first (NetworkSiteLeafPurge) - finds the next
 * ones itself. So a batch that removes fewer rows than the batch size is no
 * sign the table is done; one that removes none is.
 */

// How long a soft-deleted row is kept before it is deleted for good.
export const SOFT_DELETED_ROWS_RETENTION_IN_DAYS: number = 30;

// Rows one statement deletes, at most.
export const SOFT_DELETED_ROWS_PURGE_BATCH_SIZE: number = 1000;

/*
 * What a run may spend draining backlogs. Once it is spent, each table left
 * gets one batch; the job's own timeout is longer, so those batches, and the
 * one in flight, finish.
 */
export const SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS: number = 20 * 60 * 1000;

// What one table's purge did in a run.
export interface SoftDeletedRowsPurgeOfTable {
  // Rows deleted for good.
  purged: number;
  // Rows due may be left: the run was out of time before a batch removed nothing.
  isCutShort: boolean;
}

// A table rows were deleted from in a run, and how many.
export interface SoftDeletedRowsPurgedTable {
  table: string;
  purged: number;
}

export interface SoftDeletedRowsPurgeSummary {
  // Tables this installation purges that the run worked on.
  tables: number;
  // Rows deleted for good.
  purged: number;
  // The tables rows were deleted from, in the order they were worked on.
  purgedTables: Array<SoftDeletedRowsPurgedTable>;
  // Tables whose purge failed: logged, and tried again next run.
  failedTables: number;
  // Rows due were left for the next run: out of time, or past the deadline.
  isCutShort: boolean;
}

// What a batch says it removed, as a count: never negative, never NaN.
function countOf(value: unknown): number {
  const count: number = Number(value);

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

// The table a service writes, for the log.
function tableOf(service: DatabaseService<BaseModel>): string {
  return (
    service.getModel()?.tableName || service.modelType?.name || "unknown table"
  );
}

export default class SoftDeletedRowsPurge {
  // The clock, a seam for tests.
  public static now: () => Date = (): Date => {
    return new Date();
  };

  /*
   * Whether this installation purges the service's soft-deleted rows: every
   * service's where billing is on, only those whose rows OneUptime soft
   * deletes on its own elsewhere, and never one marked doNotAllowDelete.
   * Anything in the service list that is not a database service has no rows.
   */
  public static isPurgedOnThisInstall(
    service: unknown,
    isBillingEnabled: boolean,
  ): service is DatabaseService<BaseModel> {
    if (!(service instanceof DatabaseService)) {
      return false;
    }

    if (service.doNotAllowDelete) {
      return false;
    }

    return isBillingEnabled || service.purgesSoftDeletedRowsOnEveryInstall;
  }

  // When a row must have been deleted before, to be due.
  public static getCutoff(): Date {
    return OneUptimeDate.getSomeDaysAgoFromDate(
      this.now(),
      SOFT_DELETED_ROWS_RETENTION_IN_DAYS,
    );
  }

  /*
   * One batch of a table: up to SOFT_DELETED_ROWS_PURGE_BATCH_SIZE of its
   * rows soft deleted more than SOFT_DELETED_ROWS_RETENTION_IN_DAYS ago,
   * deleted for good as OneUptime, from the first row due (see the header).
   * How many went. hardDeleteBy reads and deletes soft-deleted rows too.
   */
  public static async purgeBatch(
    service: DatabaseService<BaseModel>,
  ): Promise<number> {
    return countOf(
      await service.hardDeleteBy({
        query: {
          deletedAt: QueryHelper.lessThan(this.getCutoff()),
        },
        props: {
          isRoot: true,
        },
        limit: SOFT_DELETED_ROWS_PURGE_BATCH_SIZE,
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
  }): Promise<SoftDeletedRowsPurgeOfTable> {
    let purged: number = 0;

    for (;;) {
      const removed: number = await this.purgeBatch(data.service);

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
   * Every table this installation purges, in the order of `services`, as far
   * as the time budget and the deadline go (see the header). One table's
   * failure is logged and the rest go on: it is tried again next run.
   */
  public static async run(data: {
    services: ReadonlyArray<unknown>;
    isBillingEnabled: boolean;
    deadline?: JobDeadline | undefined;
    timeBudgetMs?: number | undefined;
  }): Promise<SoftDeletedRowsPurgeSummary> {
    const budgetMs: number =
      data.timeBudgetMs ?? SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS;
    const startedAt: number = this.now().getTime();

    const summary: SoftDeletedRowsPurgeSummary = {
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
      return isPastDeadline() || this.now().getTime() - startedAt >= budgetMs;
    };

    for (const service of data.services) {
      if (!this.isPurgedOnThisInstall(service, data.isBillingEnabled)) {
        continue;
      }

      // Past the deadline, the tables left wait for the next run.
      if (isPastDeadline()) {
        summary.isCutShort = true;
        return summary;
      }

      summary.tables += 1;

      try {
        const result: SoftDeletedRowsPurgeOfTable = await this.purgeTable({
          service: service,
          isOutOfTime: isOutOfTime,
        });

        summary.purged += result.purged;

        if (result.purged > 0) {
          summary.purgedTables.push({
            table: tableOf(service),
            purged: result.purged,
          });
        }

        if (result.isCutShort) {
          summary.isCutShort = true;
        }
      } catch (error) {
        summary.failedTables += 1;
        logger.error(
          `Soft-deleted rows: deleting the ${tableOf(service)} rows deleted more than ${SOFT_DELETED_ROWS_RETENTION_IN_DAYS} days ago failed. They are tried again next run.`,
        );
        logger.error(error);
      }
    }

    return summary;
  }
}
