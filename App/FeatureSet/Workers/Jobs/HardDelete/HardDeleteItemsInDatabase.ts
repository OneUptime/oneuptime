import RunCron from ../../Utils/Cron;
import LIMIT_MAX from Common/Types/Database/LimitMax;
import OneUptimeDate from Common/Types/Date;
import { EVERY_DAY, EVERY_MINUTE } from Common/Utils/CronTime;
import {
  IsBillingEnabled,
  IsDevelopment,
} from CommonServer/EnvironmentConfig;
import DatabaseService from CommonServer/Services/DatabaseService;
import Services from CommonServer/Services/Index;
import QueryHelper from CommonServer/Types/Database/QueryHelper;
import logger from CommonServer/Utils/Logger;

const hardDeleteItems = async (service: DatabaseService) => {
  if (service.doNotAllowDelete) {
    return;
  }

  try {
    await service.hardDeleteBy({
      query: {
        deletedAt: QueryHelper.lessThan(OneUptimeDate.getSomeDaysAgo(30)),
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });
  } catch (err) {
    logger.error(err);
  }
};

RunCron(
  HardDelete:HardDeleteItemsInDatabase,
  { schedule: IsDevelopment? EVERY_MINUTE : EVERY_DAY, runOnStartup: false },
  async () => {
    if (!IsBillingEnabled) {
      logger.debug(
        HardDelete:HardDeleteItemsInDatabase: Billing is not enabled. Skipping hard delete.,
      );
      return;
    }

    for (const service of Services) {
      if (service instanceof DatabaseService) {
        await hardDeleteItems(service);
      }
    }
  },
);

const hardDeleteOlderItems = async (service: DatabaseService) => {
  if (
   !service.hardDeleteItemByColumnName ||
   !service.hardDeleteItemsOlderThanDays
  ) {
    return;
  }

  try {
    await service.hardDeleteBy({
      query: {
        [service.hardDeleteItemByColumnName]: QueryHelper.lessThan(
          OneUptimeDate.getSomeDaysAgo(service.hardDeleteItemsOlderThanDays),
        ),
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });
  } catch (err) {
    logger.error(err);
  }
};

RunCron(
  HardDelete:HardDeleteOlderItemsInDatabase,
  { schedule: IsDevelopment? EVERY_MINUTE : EVERY_DAY, runOnStartup: false },
  async () => {
    for (const service of Services) {
      if (service instanceof DatabaseService) {
        await hardDeleteOlderItems(service);
      }
    }
  },
);

