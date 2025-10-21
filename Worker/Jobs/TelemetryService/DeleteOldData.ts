import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_HOUR, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import SpanService from "Common/Server/Services/SpanService";
import TelemetryServiceService from "Common/Server/Services/TelemetryServiceService";
import QueryHelper from "Common/Server/Types/AnalyticsDatabase/QueryHelper";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import { ServiceType } from "Common/Models/AnalyticsModels/Metric";

RunCron(
  "TelemetryService:DeleteOldData",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR,
    runOnStartup: false,
    /*
     * This job iterates over all telemetry services and issues ClickHouse DELETE mutations
     * which can take longer than the default 5 minute job timeout when there is a lot of data.
     * Increase timeout to 25 minutes (just under the hourly schedule) to prevent premature timeouts.
     */
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

      const retentionCutOff: Date = OneUptimeDate.getSomeDaysAgo(
        dataRetentionDays,
      );

      // delete logs using primary key column for efficient pruning

      await LogService.deleteBy({
        query: {
          time: QueryHelper.lessThan(retentionCutOff),
          serviceId: service.id!,
          projectId: service.projectId,
        },
        props: {
          isRoot: true,
        },
      });

      // delete spans using primary key column for efficient pruning

      await SpanService.deleteBy({
        query: {
          startTime: QueryHelper.lessThan(retentionCutOff),
          serviceId: service.id!,
          projectId: service.projectId,
        },
        props: {
          isRoot: true,
        },
      });

      // delete metrics using primary key column for efficient pruning

      await MetricService.deleteBy({
        query: {
          time: QueryHelper.lessThan(retentionCutOff),
          serviceId: service.id!,
          projectId: service.projectId,
          serviceType: ServiceType.OpenTelemetry,
        },
        props: {
          isRoot: true,
        },
      });
    }
  },
);
