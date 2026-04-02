import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
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
import MetricMonitorResponse, {
  KubernetesResourceBreakdown,
  KubernetesAffectedResource,
} from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStepMetricMonitor from "Common/Types/Monitor/MonitorStepMetricMonitor";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricService from "Common/Server/Services/MetricService";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import Dictionary from "Common/Types/Dictionary";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ExceptionMonitorResponse from "Common/Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import ProfileMonitorResponse from "Common/Types/Monitor/ProfileMonitor/ProfileMonitorResponse";
import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
} from "Common/Types/Monitor/MonitorStepProfileMonitor";
import ProfileService from "Common/Server/Services/ProfileService";
import Profile from "Common/Models/AnalyticsModels/Profile";
import MonitorStepKubernetesMonitor, {
  KubernetesResourceFilters,
} from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import {
  getKubernetesMetricByMetricName,
  KubernetesMetricDefinition,
} from "Common/Types/Monitor/KubernetesMetricCatalog";
import { JSONObject } from "Common/Types/JSON";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

RunCron(
  "TelemetryMonitor:MonitorTelemetryMonitor",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug("Checking TelemetryMonitor:MonitorTelemetryMonitor");

    const telemetryMonitors: Array<Monitor> = await MonitorService.findAllBy({
      query: {
        disableActiveMonitoring: false,
        disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
        disableActiveMonitoringBecauseOfManualIncident: false,

        monitorType: DatabaseQueryHelper.any([
          MonitorType.Logs,
          MonitorType.Traces,
          MonitorType.Metrics,
          MonitorType.Exceptions,
          MonitorType.Profiles,
          MonitorType.Kubernetes,
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
        projectId: true,
      },
    });

    const updatePromises: Array<Promise<void>> = [];

    for (const telemetryMonitor of telemetryMonitors) {
      let nextPing: Date = OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.getCurrentDate(),
        1,
      );

      if (telemetryMonitor.monitoringInterval) {
        try {
          nextPing = CronTab.getNextExecutionTime(
            telemetryMonitor.monitoringInterval as string,
          );
        } catch (err) {
          logger.error(err);
        }
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
      Promise<
        | LogMonitorResponse
        | TraceMonitorResponse
        | MetricMonitorResponse
        | ExceptionMonitorResponse
        | ProfileMonitorResponse
      >
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
            projectId: monitor.projectId!,
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
      | LogMonitorResponse
      | TraceMonitorResponse
      | MetricMonitorResponse
      | ExceptionMonitorResponse
      | ProfileMonitorResponse
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
  projectId: ObjectID;
}) => Promise<
  | LogMonitorResponse
  | TraceMonitorResponse
  | MetricMonitorResponse
  | ExceptionMonitorResponse
  | ProfileMonitorResponse
>;

const monitorTelemetryMonitor: MonitorTelemetryMonitorFunction = async (data: {
  monitorStep: MonitorStep;
  monitorType: MonitorType;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<
  | LogMonitorResponse
  | TraceMonitorResponse
  | MetricMonitorResponse
  | ExceptionMonitorResponse
  | ProfileMonitorResponse
> => {
  const { monitorStep, monitorType, monitorId, projectId } = data;

  if (monitorType === MonitorType.Logs) {
    return monitorLogs({
      monitorStep,
      monitorId,
      projectId,
    });
  }

  if (monitorType === MonitorType.Traces) {
    return monitorTrace({
      monitorStep,
      monitorId,
      projectId,
    });
  }

  if (monitorType === MonitorType.Metrics) {
    return monitorMetric({
      monitorStep,
      monitorId,
      projectId,
    });
  }

  if (monitorType === MonitorType.Exceptions) {
    return monitorException({
      monitorStep,
      monitorId,
      projectId,
    });
  }

  if (monitorType === MonitorType.Profiles) {
    return monitorProfile({
      monitorStep,
      monitorId,
      projectId,
    });
  }

  if (monitorType === MonitorType.Kubernetes) {
    return monitorKubernetes({
      monitorStep,
      monitorId,
      projectId,
    });
  }

  throw new BadDataException("Monitor type is not supported");
};

type MonitorTraceFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<TraceMonitorResponse>;

const monitorTrace: MonitorTraceFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<TraceMonitorResponse> => {
  // Monitor traces
  const traceQuery: MonitorStepTraceMonitor | undefined =
    data.monitorStep.data?.traceMonitor;

  if (!traceQuery) {
    throw new BadDataException("Trace query is missing");
  }

  const query: Query<Log> = MonitorStepTraceMonitorUtil.toQuery(traceQuery);

  query.projectId = data.projectId;

  const countTraces: PositiveNumber = await SpanService.countBy({
    query: query,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  return {
    projectId: data.projectId,
    spanCount: countTraces.toNumber(),
    spanQuery: query,
    monitorId: data.monitorId,
  };
};

type MonitorMetricFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

const monitorMetric: MonitorMetricFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
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
    const query: Query<Metric> = {
      projectId: data.projectId,
      time: startAndEndDate,
      name: queryConfig.metricQueryData.filterData.metricName,
    };

    if (
      queryConfig.metricQueryData &&
      queryConfig.metricQueryData.filterData &&
      queryConfig.metricQueryData.filterData.attributes &&
      Object.keys(queryConfig.metricQueryData.filterData.attributes).length > 0
    ) {
      query.attributes = queryConfig.metricQueryData.filterData
        .attributes as Dictionary<string>;
    }

    const aggregatedResults: AggregatedResult = await MetricService.aggregateBy(
      {
        query: query,
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

    logger.debug("Aggregated results");
    logger.debug(aggregatedResults);

    finalResult.push(aggregatedResults);
  }

  return {
    projectId: data.projectId,
    metricViewConfig: metricMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: finalResult,
    monitorId: data.monitorId,
  };
};

type MonitorExceptionFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<ExceptionMonitorResponse>;

const monitorException: MonitorExceptionFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<ExceptionMonitorResponse> => {
  const exceptionMonitorConfig: MonitorStepExceptionMonitor | undefined =
    data.monitorStep.data?.exceptionMonitor;

  if (!exceptionMonitorConfig) {
    throw new BadDataException("Exception monitor config is missing");
  }

  const analyticsQuery: Query<ExceptionInstance> =
    MonitorStepExceptionMonitorUtil.toAnalyticsQuery(exceptionMonitorConfig);

  analyticsQuery.projectId = data.projectId;

  const exceptionCount: PositiveNumber = await ExceptionInstanceService.countBy(
    {
      query: analyticsQuery,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    },
  );

  return {
    projectId: data.projectId,
    exceptionCount: exceptionCount.toNumber(),
    exceptionQuery: JSONFunctions.anyObjectToJSONObject(
      analyticsQuery,
    ) as Query<ExceptionInstance>,
    monitorId: data.monitorId,
  };
};

type MonitorProfileFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<ProfileMonitorResponse>;

const monitorProfile: MonitorProfileFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<ProfileMonitorResponse> => {
  const profileMonitorConfig: MonitorStepProfileMonitor | undefined =
    data.monitorStep.data?.profileMonitor;

  if (!profileMonitorConfig) {
    throw new BadDataException("Profile monitor config is missing");
  }

  const analyticsQuery: Query<Profile> =
    MonitorStepProfileMonitorUtil.toQuery(profileMonitorConfig);

  analyticsQuery.projectId = data.projectId;

  const profileCount: PositiveNumber = await ProfileService.countBy({
    query: analyticsQuery,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  return {
    projectId: data.projectId,
    profileCount: profileCount.toNumber(),
    profileQuery: JSONFunctions.anyObjectToJSONObject(
      analyticsQuery,
    ) as Query<Profile>,
    monitorId: data.monitorId,
  };
};

type MonitorKubernetesFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

const monitorKubernetes: MonitorKubernetesFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<MetricMonitorResponse> => {
  const kubernetesMonitorConfig: MonitorStepKubernetesMonitor | undefined =
    data.monitorStep.data?.kubernetesMonitor;

  if (!kubernetesMonitorConfig) {
    throw new BadDataException("Kubernetes monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      kubernetesMonitorConfig.rollingTime || RollingTime.Past1Minute,
    );

  const finalResult: Array<AggregatedResult> = [];
  let kubernetesResourceBreakdown: KubernetesResourceBreakdown | undefined =
    undefined;

  for (const queryConfig of kubernetesMonitorConfig.metricViewConfig
    .queryConfigs) {
    const metricName: string =
      (queryConfig.metricQueryData.filterData.metricName as string) || "";

    const query: Query<Metric> = {
      projectId: data.projectId,
      time: startAndEndDate,
      name: metricName,
    };

    // Start with any user-defined attribute filters
    const attributes: Dictionary<string> = {};

    if (
      queryConfig.metricQueryData &&
      queryConfig.metricQueryData.filterData &&
      queryConfig.metricQueryData.filterData.attributes &&
      Object.keys(queryConfig.metricQueryData.filterData.attributes).length > 0
    ) {
      Object.assign(
        attributes,
        queryConfig.metricQueryData.filterData.attributes,
      );
    }

    // Add Kubernetes-specific attribute filters (ClickHouse stores these with "resource." prefix)
    if (kubernetesMonitorConfig.clusterIdentifier) {
      attributes["resource.k8s.cluster.name"] =
        kubernetesMonitorConfig.clusterIdentifier;
    }

    if (kubernetesMonitorConfig.resourceFilters) {
      const resourceFilters: KubernetesResourceFilters =
        kubernetesMonitorConfig.resourceFilters;

      if (resourceFilters.namespace) {
        attributes["resource.k8s.namespace.name"] = resourceFilters.namespace;
      }

      if (resourceFilters.nodeName) {
        attributes["resource.k8s.node.name"] = resourceFilters.nodeName;
      }

      if (resourceFilters.podName) {
        attributes["resource.k8s.pod.name"] = resourceFilters.podName;
      }

      if (resourceFilters.workloadName && resourceFilters.workloadType) {
        const workloadType: string = resourceFilters.workloadType.toLowerCase();
        attributes[`resource.k8s.${workloadType}.name`] =
          resourceFilters.workloadName;
      }
    }

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }

    const aggregatedResults: AggregatedResult = await MetricService.aggregateBy(
      {
        query: query,
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

    logger.debug("Kubernetes monitor aggregated results");
    logger.debug(aggregatedResults);

    finalResult.push(aggregatedResults);

    // Fetch raw metrics to extract per-resource Kubernetes context
    try {
      const rawMetrics: Array<Metric> = await MetricService.findBy({
        query: query,
        select: {
          attributes: true,
          value: true,
          time: true,
        },
        sort: {
          time: SortOrder.Descending,
        },
        limit: 100,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      if (rawMetrics.length > 0) {
        const affectedResourcesMap: Map<string, KubernetesAffectedResource> =
          new Map();

        for (const metric of rawMetrics) {
          const metricAttrs: JSONObject =
            (metric.attributes as JSONObject) || {};
          const podName: string | undefined = metricAttrs[
            "resource.k8s.pod.name"
          ] as string | undefined;
          const namespace: string | undefined = metricAttrs[
            "resource.k8s.namespace.name"
          ] as string | undefined;
          const nodeName: string | undefined = metricAttrs[
            "resource.k8s.node.name"
          ] as string | undefined;
          const containerName: string | undefined = metricAttrs[
            "resource.k8s.container.name"
          ] as string | undefined;

          // Detect workload type and name from attributes
          let workloadType: string | undefined = undefined;
          let workloadName: string | undefined = undefined;

          if (metricAttrs["resource.k8s.deployment.name"]) {
            workloadType = "Deployment";
            workloadName = metricAttrs[
              "resource.k8s.deployment.name"
            ] as string;
          } else if (metricAttrs["resource.k8s.statefulset.name"]) {
            workloadType = "StatefulSet";
            workloadName = metricAttrs[
              "resource.k8s.statefulset.name"
            ] as string;
          } else if (metricAttrs["resource.k8s.daemonset.name"]) {
            workloadType = "DaemonSet";
            workloadName = metricAttrs["resource.k8s.daemonset.name"] as string;
          } else if (metricAttrs["resource.k8s.job.name"]) {
            workloadType = "Job";
            workloadName = metricAttrs["resource.k8s.job.name"] as string;
          } else if (metricAttrs["resource.k8s.cronjob.name"]) {
            workloadType = "CronJob";
            workloadName = metricAttrs["resource.k8s.cronjob.name"] as string;
          } else if (metricAttrs["resource.k8s.replicaset.name"]) {
            workloadType = "ReplicaSet";
            workloadName = metricAttrs[
              "resource.k8s.replicaset.name"
            ] as string;
          }

          // Build unique key for deduplication
          const resourceKey: string = [
            podName || "",
            namespace || "",
            nodeName || "",
            containerName || "",
            workloadName || "",
          ].join("|");

          const metricValue: number =
            typeof metric.value === "number"
              ? metric.value
              : Number(metric.value) || 0;

          // Keep the highest value per resource
          const existing: KubernetesAffectedResource | undefined =
            affectedResourcesMap.get(resourceKey);
          if (!existing || metricValue > existing.metricValue) {
            affectedResourcesMap.set(resourceKey, {
              podName: podName || undefined,
              namespace: namespace || undefined,
              nodeName: nodeName || undefined,
              containerName: containerName || undefined,
              workloadType: workloadType || undefined,
              workloadName: workloadName || undefined,
              metricValue: metricValue,
            });
          }
        }

        const metricDef: KubernetesMetricDefinition | undefined =
          getKubernetesMetricByMetricName(metricName);

        kubernetesResourceBreakdown = {
          clusterName: kubernetesMonitorConfig.clusterIdentifier,
          metricName: metricName,
          metricFriendlyName: metricDef?.friendlyName || metricName,
          affectedResources: Array.from(affectedResourcesMap.values()),
          attributes: attributes,
        };
      }
    } catch (err) {
      logger.error("Failed to fetch Kubernetes resource breakdown");
      logger.error(err);
    }
  }

  return {
    projectId: data.projectId,
    metricViewConfig: kubernetesMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: finalResult,
    monitorId: data.monitorId,
    kubernetesResourceBreakdown: kubernetesResourceBreakdown,
  };
};

type MonitorLogsFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<LogMonitorResponse>;

const monitorLogs: MonitorLogsFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<LogMonitorResponse> => {
  // Monitor logs
  const logQuery: MonitorStepLogMonitor | undefined =
    data.monitorStep.data?.logMonitor;

  if (!logQuery) {
    throw new BadDataException("Log query is missing");
  }

  const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(logQuery);
  query.projectId = data.projectId;

  const countLogs: PositiveNumber = await LogService.countBy({
    query: query,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  return {
    projectId: data.projectId,
    logCount: countLogs.toNumber(),
    logQuery: JSONFunctions.anyObjectToJSONObject(query),
    monitorId: data.monitorId,
  };
};
