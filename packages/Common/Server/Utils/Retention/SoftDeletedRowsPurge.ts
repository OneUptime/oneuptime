import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OneUptimeDate from "../../../Types/Date";
import DatabaseService from "../../Services/DatabaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import JobDeadline from "../JobDeadline";
import logger from "../Logger";
import TablePurgeWalk, {
  TablePurgeOfTable,
  TablePurgeSummary,
  TablePurgedTable,
  getPurgedTableName,
  readPurgedCount,
} from "./TablePurgeWalk";

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
 * the others go on. The walk is the one the purge by age shares
 * (TablePurgeWalk, which says why a short batch is no sign a table is done).
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
export type SoftDeletedRowsPurgeOfTable = TablePurgeOfTable;

// A table rows were deleted from in a run, and how many.
export type SoftDeletedRowsPurgedTable = TablePurgedTable;

// What a run did; `tables` counts the tables this installation purges.
export type SoftDeletedRowsPurgeSummary = TablePurgeSummary;

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
    return readPurgedCount(
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
    return await TablePurgeWalk.purgeTable({
      purgeBatch: (): Promise<number> => {
        return this.purgeBatch(data.service);
      },
      isOutOfTime: data.isOutOfTime,
    });
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
    return await TablePurgeWalk.run({
      services: data.services.filter(
        (service: unknown): service is DatabaseService<BaseModel> => {
          return this.isPurgedOnThisInstall(service, data.isBillingEnabled);
        },
      ),
      purgeTable: (
        service: DatabaseService<BaseModel>,
        isOutOfTime: () => boolean,
      ): Promise<SoftDeletedRowsPurgeOfTable> => {
        return this.purgeTable({ service: service, isOutOfTime: isOutOfTime });
      },
      onTableFailed: (
        service: DatabaseService<BaseModel>,
        error: unknown,
      ): void => {
        logger.error(
          `Soft-deleted rows: deleting the ${getPurgedTableName(service)} rows deleted more than ${SOFT_DELETED_ROWS_RETENTION_IN_DAYS} days ago failed. They are tried again next run.`,
        );
        logger.error(error);
      },
      now: (): Date => {
        return this.now();
      },
      deadline: data.deadline,
      timeBudgetMs: data.timeBudgetMs ?? SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS,
    });
  }
}
