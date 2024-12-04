import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import { EVERY_DAY } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import MetricService from "Common/Server/Services/MetricService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { ServiceType } from "Common/Models/AnalyticsModels/Metric";

RunCron(
  "Metric:DeleteIncidentMetricsOlderThanXDays",
  { schedule: EVERY_DAY, runOnStartup: true },
  async () => {
    const olderThanDays: number = 180; // store for 6 months.

    logger.debug("Checking Metric:DeleteIncidentMetricsOlderThanXDays");

    logger.debug(`Deleting Incident Metrics older than ${olderThanDays} days`);

    await MetricService.deleteBy({
      query: {
        createdAt: QueryHelper.lessThan(
          OneUptimeDate.getSomeDaysAgo(olderThanDays),
        ),
        serviceType: ServiceType.Incident,
      },
      props: {
        isRoot: true,
      },
    });
  },
);
