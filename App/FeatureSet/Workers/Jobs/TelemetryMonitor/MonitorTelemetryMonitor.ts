import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import MonitorService from "CommonServer/Services/MonitorService";
import QueryHelper from "CommonServer/Types/AnalyticsDatabase/QueryHelper";
import logger from "CommonServer/Utils/Logger";
import MonitorResourceUtil from "CommonServer/Utils/Monitor/MonitorResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import CronTab from "CommonServer/Utils/CronTab";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";
import MonitorStepLogMonitor from "Common/Types/Monitor/MonitorStepLogMonitor";
import BadDataException from "Common/Types/Exception/BadDataException";
import LogService from "CommonServer/Services/LogService";
import Query from "CommonServer/Types/AnalyticsDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import Search from "Common/Types/BaseDatabase/Search";
import PositiveNumber from "Common/Types/PositiveNumber";
import JSONFunctions from "Common/Types/JSONFunctions";
import DatabaseQueryHelper from "CommonServer/Types/Database/QueryHelper";
import ObjectID from "Common/Types/ObjectID";

RunCron(
  "LogMonitor:MonitorLogMonitor",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug("Checking LogMonitor:MonitorLogMonitor");

    const telemetryMonitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        disableActiveMonitoring: false,
        disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
        disableActiveMonitoringBecauseOfManualIncident: false,

        monitorType: DatabaseQueryHelper.any([
          MonitorType.Logs,
          MonitorType.Traces,
          MonitorType.Metrics,
        ]),
        telemetryMonitorNextMonitorAt:
          DatabaseQueryHelper.lessThanEqualToOrNull(
            OneUptimeDate.getCurrentDate(),
          ),
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        monitorSteps: true,
        createdAt: true,
        monitoringInterval: true,
        monitorType: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });

    const updatePromises: Array<Promise<void>> = [];

    for (const telemetryMonitor of telemetryMonitors) {
      if (!telemetryMonitor.monitoringInterval) {
        continue;
      }

      let nextPing: Date = OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.getCurrentDate(),
        1,
      );

      try {
        nextPing = CronTab.getNextExecutionTime(
          telemetryMonitor?.monitoringInterval as string,
        );
      } catch (err) {
        logger.error(err);
      }

      updatePromises.push(
        MonitorService.updateOneById({
          id: telemetryMonitor.id!,
          data: {
            telemetryMonitorLastMonitorAt: OneUptimeDate.getCurrentDate(),
            telemetryMonitorNextMonitorAt: nextPing,
          },
          props: {
            isRoot: true,
          },
        }),
      );
    }

    await Promise.all(updatePromises);

    logger.debug(`Found ${telemetryMonitors.length} telemetry monitors`);

    logger.debug(telemetryMonitors);

    const monitorResponses: Array<Promise<LogMonitorResponse>> = [];

    for (const monitor of telemetryMonitors) {
      try {
        if (
          !monitor.monitorSteps ||
          !monitor.monitorSteps.data?.monitorStepsInstanceArray?.length ||
          monitor.monitorSteps.data.monitorStepsInstanceArray.length === 0
        ) {
          logger.debug("Monitor has no steps. Skipping...");
          continue;
        }

        monitorResponses.push(
          monitorTelemetryMonitor({
            monitorStep:
              monitor.monitorSteps.data!.monitorStepsInstanceArray[0]!,
            monitorType: monitor.monitorType!,
            monitorId: monitor.id!,
          }),
        );
      } catch (error) {
        logger.error(
          `Error while processing incoming request monitor: ${monitor.id?.toString()}`,
        );
        logger.error(error);
      }
    }

    const responses: Array<LogMonitorResponse> =
      await Promise.all(monitorResponses);

    for (const response of responses) {
      MonitorResourceUtil.monitorResource(response);
    }
  },
);

type MonitorTelemetryMonitorFunction = (data: {
  monitorStep: MonitorStep;
  monitorType: MonitorType;
  monitorId: ObjectID;
}) => Promise<LogMonitorResponse>;

const monitorTelemetryMonitor: MonitorTelemetryMonitorFunction = async (data: {
  monitorStep: MonitorStep;
  monitorType: MonitorType;
  monitorId: ObjectID;
}): Promise<LogMonitorResponse> => {
  const { monitorStep, monitorType, monitorId } = data;

  if (monitorType === MonitorType.Logs) {
    return monitorLogs({
      monitorStep,
      monitorId,
    });
  }

  throw new BadDataException("Monitor type is not supported");
};

type MonitorLogsFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
}) => Promise<LogMonitorResponse>;

const monitorLogs: MonitorLogsFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
}): Promise<LogMonitorResponse> => {
  // Monitor logs
  const logQuery: MonitorStepLogMonitor | undefined =
    data.monitorStep.data?.logMonitor;

  if (!logQuery) {
    throw new BadDataException("Log query is missing");
  }

  const query: Query<Log> = {};

  if (logQuery.attributes) {
    query.attributes = logQuery.attributes;
  }

  if (logQuery.body) {
    query.body = new Search(logQuery.body);
  }

  if (logQuery.severityTexts && logQuery.severityTexts.length > 0) {
    query.severityText = QueryHelper.any(
      logQuery.severityTexts as Array<string>,
    );
  }

  if (logQuery.telemetryServiceIds && logQuery.telemetryServiceIds.length > 0) {
    query.serviceId = QueryHelper.any(logQuery.telemetryServiceIds);
  }

  if (!logQuery.lastXSecondsOfLogs) {
    throw new BadDataException("Last X seconds of logs is missing");
  }

  const lastXSecondsOfLogs: number = logQuery.lastXSecondsOfLogs;

  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveSeconds(
    endDate,
    lastXSecondsOfLogs * -1,
  );

  query.time = QueryHelper.inBetween(startDate, endDate);

  const countLogs: PositiveNumber = await LogService.countBy({
    query: query,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  return {
    logCount: countLogs.toNumber(),
    logQuery: JSONFunctions.anyObjectToJSONObject(query),
    monitorId: data.monitorId,
  };
};
