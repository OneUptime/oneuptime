import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import CronTab from "Common/Server/Utils/CronTab";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";
import BadDataException from "Common/Types/Exception/BadDataException";
import LogService from "Common/Server/Services/LogService";
import Query from "Common/Server/Types/AnalyticsDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import PositiveNumber from "Common/Types/PositiveNumber";
import JSONFunctions from "Common/Types/JSONFunctions";
import DatabaseQueryHelper from "Common/Server/Types/Database/QueryHelper";
import ObjectID from "Common/Types/ObjectID";
import TraceMonitorResponse from "Common/Types/Monitor/TraceMonitor/TraceMonitorResponse";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "Common/Types/Monitor/MonitorStepTraceMonitor";
import SpanService from "Common/Server/Services/SpanService";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStepMetricMonitor from "Common/Types/Monitor/MonitorStepMetricMonitor";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricService from "Common/Server/Services/MetricService";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import Dictionary from "Common/Types/Dictionary";

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

    const monitorResponses: Array<
      Promise<LogMonitorResponse | TraceMonitorResponse | MetricMonitorResponse>
    > = [];

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

    const responses: Array<
      LogMonitorResponse | TraceMonitorResponse | MetricMonitorResponse
    > = await Promise.all(monitorResponses);

    for (const response of responses) {
      MonitorResourceUtil.monitorResource(response);
    }
  },
);

type MonitorTelemetryMonitorFunction = (data: {
  monitorStep: MonitorStep;
  monitorType: MonitorType;
  monitorId: ObjectID;
}) => Promise<
  LogMonitorResponse | TraceMonitorResponse | MetricMonitorResponse
>;

const monitorTelemetryMonitor: MonitorTelemetryMonitorFunction = async (data: {
  monitorStep: MonitorStep;
  monitorType: MonitorType;
  monitorId: ObjectID;
}): Promise<
  LogMonitorResponse | TraceMonitorResponse | MetricMonitorResponse
> => {
  const { monitorStep, monitorType, monitorId } = data;

  if (monitorType === MonitorType.Logs) {
    return monitorLogs({
      monitorStep,
      monitorId,
    });
  }

  if (monitorType === MonitorType.Traces) {
    return monitorTrace({
      monitorStep,
      monitorId,
    });
  }

  if (monitorType === MonitorType.Metrics) {
    return monitorMetric({
      monitorStep,
      monitorId,
    });
  }

  throw new BadDataException("Monitor type is not supported");
};

type MonitorTraceFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
}) => Promise<TraceMonitorResponse>;

const monitorTrace: MonitorTraceFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
}): Promise<TraceMonitorResponse> => {
  // Monitor traces
  const traceQuery: MonitorStepTraceMonitor | undefined =
    data.monitorStep.data?.traceMonitor;

  if (!traceQuery) {
    throw new BadDataException("Trace query is missing");
  }

  const query: Query<Log> = MonitorStepTraceMonitorUtil.toQuery(traceQuery);

  const countTraces: PositiveNumber = await SpanService.countBy({
    query: query,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  return {
    spanCount: countTraces.toNumber(),
    spanQuery: query,
    monitorId: data.monitorId,
  };
};

type MonitorMetricFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
}) => Promise<MetricMonitorResponse>;

const monitorMetric: MonitorMetricFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
}): Promise<MetricMonitorResponse> => {
  // Monitor traces
  const metricMonitorConfig: MonitorStepMetricMonitor | undefined =
    data.monitorStep.data?.metricMonitor;

  if (!metricMonitorConfig) {
    throw new BadDataException("Metric config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      metricMonitorConfig.rollingTime || RollingTime.Past1Minute,
    );

  const finalResult: Array<AggregatedResult> = [];

  for (const queryConfig of metricMonitorConfig.metricViewConfig.queryConfigs) {
    const aggregatedResults: AggregatedResult = await MetricService.aggregateBy(
      {
        query: {
          time: startAndEndDate,
          name: queryConfig.metricQueryData.filterData.metricName,
          attributes: queryConfig.metricQueryData.filterData
            .attributes as Dictionary<string | number | boolean>,
        },
        aggregationType:
          (queryConfig.metricQueryData.filterData
            .aggegationType as MetricsAggregationType) ||
          MetricsAggregationType.Avg,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        startTimestamp:
          (startAndEndDate?.startValue as Date) ||
          OneUptimeDate.getCurrentDate(),
        endTimestamp:
          (startAndEndDate?.endValue as Date) || OneUptimeDate.getCurrentDate(),
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        groupBy: queryConfig.metricQueryData.groupBy,
        props: {
          isRoot: true,
        },
      },
    );

    finalResult.push(aggregatedResults);
  }

  return {
    metricViewConfig: metricMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: finalResult,
    monitorId: data.monitorId,
  };
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

  const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(logQuery);

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
