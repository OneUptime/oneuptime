import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_HOUR, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import TelemetryServiceService from "Common/Server/Services/TelemetryServiceService";
import QueryHelper from "Common/Server/Types/AnalyticsDatabase/QueryHelper";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";

RunCron(
  "TelemetryService:DeleteOldData",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR,
    runOnStartup: false,
    // This job iterates over all telemetry services and issues ClickHouse DELETE mutations
    // which can take longer than the default 5 minute job timeout when there is a lot of data.
    // Increase timeout to 25 minutes (just under the hourly schedule) to prevent premature timeouts.
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  async () => {
    // get a list of all the telemetry services.

    const telemetryService: Array<TelemetryService> =
      await TelemetryServiceService.findBy({
        query: {},
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          retainTelemetryDataForDays: true,
          projectId: true,
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    for (const service of telemetryService) {
      let dataRetentionDays: number | undefined =
        service.retainTelemetryDataForDays;

      if (!dataRetentionDays) {
        dataRetentionDays = 15; // default to 15 days.
      }

      if (!service.id) {
        continue;
      }

      // delete logs

      await LogService.deleteBy({
        query: {
          createdAt: QueryHelper.lessThan(
            OneUptimeDate.getSomeDaysAgo(dataRetentionDays),
          ),
          serviceId: service.id!,
          projectId: service.projectId,
        },
        props: {
          isRoot: true,
        },
      });

      // delete spans

      await SpanService.deleteBy({
        query: {
          createdAt: QueryHelper.lessThan(
            OneUptimeDate.getSomeDaysAgo(dataRetentionDays),
          ),
          serviceId: service.id!,
          projectId: service.projectId,
        },
        props: {
          isRoot: true,
        },
      });

      // TODO: delete metrics.
    }
  },
);
