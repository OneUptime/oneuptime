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
import logger from "Common/Server/Utils/Logger";

RunCron(
  "HardDelete:HardDeleteItemsInDatabase",
  { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY, runOnStartup: false },
  async () => {
    if (!IsBillingEnabled) {
      logger.debug(
        "HardDelete:HardDeleteItemsInDatabase: Billing is not enabled. Skipping hard delete.",
      );
      return;
    }

    for (const service of Services) {
      if (service instanceof DatabaseService) {
        if (service.doNotAllowDelete) {
          // marked as do not delete. skip.
          continue;
        }

        try {
          // Retain data for 30 days for accidental deletion, and then hard delete.
          let deletedCount: number = 0;

          do {
            deletedCount = await service.hardDeleteBy({
              query: {
                deletedAt: QueryHelper.lessThan(
                  OneUptimeDate.getSomeDaysAgo(30),
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
