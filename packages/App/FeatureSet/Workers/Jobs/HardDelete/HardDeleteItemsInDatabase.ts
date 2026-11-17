import RunCron from "../../Utils/Cron";
import { EVERY_DAY, EVERY_MINUTE } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import Services from "Common/Server/Services/Index";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import OlderRowsPurge, {
  OLDER_ROWS_PURGE_TIME_BUDGET_MS,
  OlderRowsPurgeSummary,
} from "Common/Server/Utils/Retention/OlderRowsPurge";
import SoftDeletedRowsPurge, {
  SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS,
  SOFT_DELETED_ROWS_RETENTION_IN_DAYS,
  SoftDeletedRowsPurgeSummary,
} from "Common/Server/Utils/Retention/SoftDeletedRowsPurge";
import { TablePurgedTable } from "Common/Server/Utils/Retention/TablePurgeWalk";

// The tables a run deleted rows from, and how many, for its log line.
function listPurgedTables(tables: Array<TablePurgedTable>): string {
  return tables
    .map((table: TablePurgedTable): string => {
      return `${table.table}: ${table.purged}`;
    })
    .join(", ");
}

/*
 * Deletes for good the rows soft deleted more than 30 days ago: on every
 * installation those OneUptime soft deletes on its own - the discovered
 * devices the hourly age-out removes - and where billing is on (OneUptime
 * Cloud) every table's. See SoftDeletedRowsPurge for which rows, how, and
 * why (issue #6528).
 *
 * Daily, a bounded amount of work a run: a backlog of millions drains over a
 * few days. The timeout leaves the batch in flight, and one batch of each
 * table left, room to finish after the run's own budget is spent.
 */
RunCron(
  "HardDelete:HardDeleteItemsInDatabase",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY,
    runOnStartup: false,
    timeoutInMS: SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS + 10 * 60 * 1000,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      const summary: SoftDeletedRowsPurgeSummary =
        await SoftDeletedRowsPurge.run({
          services: Services,
          isBillingEnabled: IsBillingEnabled,
          deadline: deadline,
        });

      if (
        summary.purged > 0 ||
        summary.failedTables > 0 ||
        summary.isCutShort
      ) {
        const tables: string = listPurgedTables(summary.purgedTables);

        logger.info(
          `Soft-deleted rows: deleted ${summary.purged} rows for good that were deleted more than ${SOFT_DELETED_ROWS_RETENTION_IN_DAYS} days ago${tables ? ` (${tables})` : ""}${summary.failedTables > 0 ? `; ${summary.failedTables} tables failed and are tried again next run` : ""}${summary.isCutShort ? "; the rest wait for the next run" : ""}.`,
        );
      }
    } catch (error) {
      logger.error(
        `Soft-deleted rows: deleting the rows deleted more than ${SOFT_DELETED_ROWS_RETENTION_IN_DAYS} days ago failed.`,
      );
      logger.error(error);
    }
  },
);

/*
 * Deletes for good the rows older than their table keeps them: each
 * service names the column and the number of days
 * (DatabaseService.hardDeleteItemsOlderThanInDays), most only where billing
 * is on, some on every install. See OlderRowsPurge for which rows, how, and
 * why (issue #8894).
 *
 * Daily, a bounded amount of work a run: 1,000 rows a statement, within a
 * time budget, then one batch for each table left. The timeout leaves the
 * batch in flight, and those batches, room to finish after the run's own
 * budget is spent.
 */
RunCron(
  "HardDelete:HardDeleteOlderItemsInDatabase",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY,
    runOnStartup: false,
    timeoutInMS: OLDER_ROWS_PURGE_TIME_BUDGET_MS + 10 * 60 * 1000,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      const summary: OlderRowsPurgeSummary = await OlderRowsPurge.run({
        services: Services,
        deadline: deadline,
      });

      if (
        summary.purged > 0 ||
        summary.failedTables > 0 ||
        summary.isCutShort
      ) {
        const tables: string = listPurgedTables(summary.purgedTables);

        logger.info(
          `Retention: deleted ${summary.purged} rows for good that were older than their table keeps them${tables ? ` (${tables})` : ""}${summary.failedTables > 0 ? `; ${summary.failedTables} tables failed and are tried again next run` : ""}${summary.isCutShort ? "; the rest wait for the next run" : ""}.`,
        );
      }
    } catch (error) {
      logger.error(
        "Retention: deleting the rows older than their table keeps them failed.",
      );
      logger.error(error);
    }
  },
);
