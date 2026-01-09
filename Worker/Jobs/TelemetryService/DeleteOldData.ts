import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_HOUR, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import ProjectService from "Common/Server/Services/ProjectService";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import SpanService from "Common/Server/Services/SpanService";
import ServiceService from "Common/Server/Services/ServiceService";
import logger from "Common/Server/Utils/Logger";
import QueryHelper from "Common/Server/Types/AnalyticsDatabase/QueryHelper";
import Service from "Common/Models/DatabaseModels/Service";
import Project from "Common/Models/DatabaseModels/Project";
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
    try {
      // iterate through active projects and prune telemetry data per service.
      const projects: Array<Project> = await ProjectService.findBy({
        query: {},
        select: {
          _id: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

      for (const project of projects) {
        try {
          if (!project || !project.id) {
            continue;
          }

          const services: Array<Service> = await ServiceService.findBy({
            query: {
              projectId: project.id,
            },
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

          for (const service of services) {
            try {
              if (!service || !service.id) {
                continue;
              }

              let dataRetentionDays: number | undefined =
                service.retainTelemetryDataForDays;

              if (!dataRetentionDays) {
                dataRetentionDays = 15; // default to 15 days.
              }

              const retentionCutOff: Date =
                OneUptimeDate.getSomeDaysAgo(dataRetentionDays);

              // delete logs using primary key column for efficient pruning
              await LogService.deleteBy({
                query: {
                  time: QueryHelper.lessThan(retentionCutOff),
                  serviceId: service.id!,
                  projectId: project.id,
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
                  projectId: project.id,
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
                  projectId: project.id,
                  serviceType: ServiceType.OpenTelemetry,
                },
                props: {
                  isRoot: true,
                },
              });
            } catch (err) {
              logger.error("Error in TelemetryService:DeleteOldData job");
              logger.error(err);
              continue;
            }
          }
        } catch (err) {
          logger.error("Error in TelemetryService:DeleteOldData job");
          logger.error(err);
          continue;
        }
      }
    } catch (err) {
      logger.error("Error in TelemetryService:DeleteOldData job");
      logger.error(err);
    }
  },
);
