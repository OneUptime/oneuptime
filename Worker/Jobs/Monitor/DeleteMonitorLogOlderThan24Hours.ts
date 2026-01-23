import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import { EVERY_DAY } from "Common/Utils/CronTime";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import MonitorLogService from "Common/Server/Services/MonitorLogService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";

RunCron(
  "Monitor:DeleteMonitorLogOlderThan24Hours",
  { schedule: EVERY_DAY, runOnStartup: true },
  async () => {
    const DEFAULT_RETENTION_DAYS: number = 1;

    let olderThanDays: number = DEFAULT_RETENTION_DAYS;

    try {
      const globalConfig: GlobalConfig | null =
        await GlobalConfigService.findOneBy({
          query: {
            _id: ObjectID.getZeroObjectID().toString(),
          },
          props: {
            isRoot: true,
          },
          select: {
            monitorLogRetentionInDays: true,
          },
        });

      if (
        globalConfig &&
        globalConfig.monitorLogRetentionInDays !== undefined &&
        globalConfig.monitorLogRetentionInDays !== null &&
        globalConfig.monitorLogRetentionInDays > 0
      ) {
        olderThanDays = globalConfig.monitorLogRetentionInDays;
      }
    } catch (error) {
      logger.error(
        "Error fetching monitor log retention config, using default of 1 day:",
      );
      logger.error(error);
    }

    logger.debug(`Deleting monitor logs older than ${olderThanDays} days`);

    await MonitorLogService.deleteBy({
      query: {
        time: new LessThan(OneUptimeDate.getSomeDaysAgo(olderThanDays)),
      },
      props: {
        isRoot: true,
      },
    });
  },
);
