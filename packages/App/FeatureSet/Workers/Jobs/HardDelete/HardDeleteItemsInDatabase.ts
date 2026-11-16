import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_DAY, EVERY_MINUTE } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import DatabaseService from "Common/Server/Services/DatabaseService";
import Services from "Common/Server/Services/Index";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import SoftDeletedRowsPurge, {
  SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS,
  SOFT_DELETED_ROWS_RETENTION_IN_DAYS,
  SoftDeletedRowsPurgeSummary,
  SoftDeletedRowsPurgedTable,
} from "Common/Server/Utils/Retention/SoftDeletedRowsPurge";

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
        const tables: string = summary.purgedTables
          .map((table: SoftDeletedRowsPurgedTable): string => {
            return `${table.table}: ${table.purged}`;
          })
          .join(", ");

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

RunCron(
  "HardDelete:HardDeleteOlderItemsInDatabase",
  { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY, runOnStartup: false },
  async () => {
    for (const service of Services) {
      if (service instanceof DatabaseService) {
        if (
          !service.hardDeleteItemByColumnName ||
          !service.hardDeleteItemsOlderThanDays
        ) {
          continue;
        }

        try {
          // Retain data for 30 days for accidental deletion, and then hard delete.
          let deletedCount: number = 0;

          do {
            deletedCount = await service.hardDeleteBy({
              query: {
                [service.hardDeleteItemByColumnName]: QueryHelper.lessThan(
                  OneUptimeDate.getSomeDaysAgo(
                    service.hardDeleteItemsOlderThanDays,
                  ),
                ),
              },
              props: {
                isRoot: true,
              },
              limit: LIMIT_MAX,
              skip: 0,
            });
          } while (deletedCount > 0);
        } catch (err) {
          logger.error(err);
        }
      }
    }
  },
);
