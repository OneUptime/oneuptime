import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import { EVERY_DAY } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import MetricService from "Common/Server/Services/MetricService";
import { ServiceType } from "Common/Models/AnalyticsModels/Metric";
import LessThan from "Common/Types/BaseDatabase/LessThan";

RunCron(
  "Metric:DeleteMonitorMetricsOlderThanXDays",
  { schedule: EVERY_DAY, runOnStartup: true },
  async () => {
    const olderThanDays: number = 30;

    logger.debug("Checking Metric:DeleteMonitorMetricsOlderThanXDays");

    logger.debug(`Deleting Monitor Metrics older than ${olderThanDays} days`);

    await MetricService.deleteBy({
      query: {
        createdAt: new LessThan(OneUptimeDate.getSomeDaysAgo(olderThanDays)),
        serviceType: ServiceType.Monitor,
      },
      props: {
        isRoot: true,
      },
    });
  },
);
