import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import MonitorService from "Common/Server/Services/MonitorService";
import HostService from "Common/Server/Services/HostService";
import {
  HOST_ABSENCE_EXPECTED_WINDOW_MINUTES,
  buildAbsentHostSeries,
  getHostAbsenceGroupByKey,
  monitorStepOptsIntoNoDataDetection,
  queriesScopeHostSubset,
} from "Common/Server/Utils/Monitor/HostAbsenceSeries";
import {
  buildAbsentIoTDeviceSeries,
  getIoTDeviceAbsenceGroupByKey,
} from "Common/Server/Utils/Monitor/IoTDeviceAbsenceSeries";
import IoTDeviceCredentialService from "Common/Server/Services/IoTDeviceCredentialService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import ReceivingCoverage, {
  TelemetryEvaluationPlan,
} from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import TelemetryMonitorWindow from "Common/Utils/Monitor/TelemetryMonitorWindow";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorPauseState, {
  MONITOR_PAUSE_FLAGS_SELECT,
} from "Common/Utils/Monitor/MonitorPauseState";
import { Service as MonitorProbeService } from "Common/Server/Services/MonitorProbeService";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";
import SecurityEventsMonitorResponse from "Common/Types/Monitor/SecurityEventsMonitor/SecurityEventsMonitorResponse";
import MonitorStepSecurityEventsMonitor, {
  MonitorStepSecurityEventsMonitorUtil,
} from "Common/Types/Monitor/MonitorStepSecurityEventsMonitor";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";
import BadDataException from "Common/Types/Exception/BadDataException";
import LogService, {
  LogAttributeGroupCountResult,
  LogAttributeGroupCount,
  LogUnresolvedAttributeGroupResult,
} from "Common/Server/Services/LogService";
import LogMonitorGroupResult from "Common/Types/Monitor/LogMonitor/LogMonitorGroupResult";
import { MaxEntitiesPerCriteria } from "Common/Server/Utils/Monitor/PerEntityCriteriaFanOut";
import Query from "Common/Server/Types/AnalyticsDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import PositiveNumber from "Common/Types/PositiveNumber";
import JSONFunctions from "Common/Types/JSONFunctions";
import DatabaseQueryHelper from "Common/Server/Types/Database/QueryHelper";
import ObjectID from "Common/Types/ObjectID";
import TraceMonitorResponse from "Common/Types/Monitor/TraceMonitor/TraceMonitorResponse";
import LlmMonitorResponse, {
  LlmMonitorResponseUtil,
} from "Common/Types/Monitor/LlmMonitor/LlmMonitorResponse";
import MonitorStepLlmMonitor, {
  LlmBadAnswerRule,
  MonitorStepLlmMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLlmMonitor";
import LlmConversationService, {
  LlmAnswerCounts,
} from "Common/Server/Services/LlmConversationService";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "Common/Types/Monitor/MonitorStepTraceMonitor";
import SpanService from "Common/Server/Services/SpanService";
import MetricMonitorResponse, {
  KubernetesResourceBreakdown,
  KubernetesAffectedResource,
  ProxmoxResourceBreakdown,
  ProxmoxAffectedResource,
  VMwareResourceBreakdown,
  VMwareAffectedResource,
  CephResourceBreakdown,
  CephAffectedResource,
  StorageArrayResourceBreakdown,
  StorageArrayAffectedResource,
  DockerSwarmResourceBreakdown,
  DockerSwarmAffectedResource,
  PlatformResourceBreakdownSource,
} from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import PlatformResourceIdentity from "Common/Utils/Monitor/PlatformResourceIdentity";
import PlatformMetricUnitUtil from "Common/Utils/Monitor/PlatformMetricUnitUtil";
import MonitorStepMetricMonitor from "Common/Types/Monitor/MonitorStepMetricMonitor";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import Dictionary from "Common/Types/Dictionary";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricFormulaEvaluator from "Common/Utils/Metrics/MetricFormulaEvaluator";
import MetricResultUnitConverter from "Common/Utils/Metrics/MetricResultUnitConverter";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import MetricSeriesResult from "Common/Types/Monitor/MetricMonitor/MetricSeriesResult";
import MetricSeriesFingerprint from "Common/Utils/Metrics/MetricSeriesFingerprint";
import ExceptionMonitorResponse from "Common/Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import Includes from "Common/Types/BaseDatabase/Includes";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import ProfileMonitorResponse, {
  ProfileFunctionShareReading,
} from "Common/Types/Monitor/ProfileMonitor/ProfileMonitorResponse";
import ProfileMonitorShare from "Common/Server/Utils/Profile/ProfileMonitorShare";
import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
} from "Common/Types/Monitor/MonitorStepProfileMonitor";
import ProfileService from "Common/Server/Services/ProfileService";
import Profile from "Common/Models/AnalyticsModels/Profile";
import MonitorStepKubernetesMonitor, {
  KubernetesResourceFilters,
  MonitorStepKubernetesMonitorUtil,
} from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import MonitorStepDockerMonitor, {
  DockerContainerFilters,
} from "Common/Types/Monitor/MonitorStepDockerMonitor";
import MonitorStepHostMonitor from "Common/Types/Monitor/MonitorStepHostMonitor";
import MonitorStepPodmanMonitor, {
  PodmanContainerFilters,
} from "Common/Types/Monitor/MonitorStepPodmanMonitor";
import MonitorStepProxmoxMonitor, {
  ProxmoxResourceFilters,
  ProxmoxResourceScope,
} from "Common/Types/Monitor/MonitorStepProxmoxMonitor";
import MonitorStepVMwareMonitor, {
  VMwareResourceFilters,
} from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import MonitorStepCephMonitor, {
  CephResourceFilters,
} from "Common/Types/Monitor/MonitorStepCephMonitor";
import MonitorStepStorageArrayMonitor, {
  StorageArrayResourceFilters,
  StorageArrayResourceScope,
} from "Common/Types/Monitor/MonitorStepStorageArrayMonitor";
import MonitorStepDockerSwarmMonitor, {
  DockerSwarmResourceFilters,
  MonitorStepDockerSwarmMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDockerSwarmMonitor";
import MonitorStepIoTMonitor, {
  IoTDeviceFilters,
} from "Common/Types/Monitor/MonitorStepIoTMonitor";
import { getKubernetesMetricByMetricName } from "Common/Types/Monitor/KubernetesMetricCatalog";
import { getProxmoxMetricByMetricName } from "Common/Types/Monitor/ProxmoxMetricCatalog";
import { getVMwareMetricByMetricName } from "Common/Types/Monitor/VMwareMetricCatalog";
import { getCephMetricByMetricName } from "Common/Types/Monitor/CephMetricCatalog";
import {
  getStorageArrayMetric,
  getStorageArrayObjectLabel,
} from "Common/Types/Monitor/StorageArrayMetricCatalog";
import { getDockerSwarmMetricByMetricName } from "Common/Types/Monitor/DockerSwarmMetricCatalog";
import { JSONObject } from "Common/Types/JSON";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import TelemetryQueueService, {
  TelemetryMonitorEvaluationJobData,
} from "../../../Telemetry/Services/Queue/TelemetryQueueService";

type TelemetryMonitorResponse =
  | LogMonitorResponse
  | SecurityEventsMonitorResponse
  | LlmMonitorResponse
  | TraceMonitorResponse
  | MetricMonitorResponse
  | ExceptionMonitorResponse
  | ProfileMonitorResponse;

export const enqueueDueTelemetryMonitorEvaluationJobs: () => Promise<void> =
  async (): Promise<void> => {
    logger.debug("Checking TelemetryMonitor:MonitorTelemetryMonitor", {
      service: "workers",
    });

    const telemetryMonitors: Array<Monitor> = await MonitorService.findAllBy({
      query: {
        ...MonitorService.getEnabledMonitorQuery(),

        monitorType: DatabaseQueryHelper.any(
          MonitorTypeHelper.getTelemetryMonitorTypes(),
        ),
        telemetryMonitorNextMonitorAt:
          DatabaseQueryHelper.lessThanEqualToOrNull(
            OneUptimeDate.getCurrentDate(),
          ),
        /*
         * Not a project a master admin blocked: its monitors wait, due, until
         * it is unblocked (MonitorResource refuses any that slip through).
         */
        project: {
          isBlocked: false,
        },
      },
      props: {
        isRoot: true,
      },
      /*
       * What scheduling needs, and not the monitor's steps. The sweep used to
       * read every due monitor's monitorSteps - its whole JSON from Postgres,
       * and 25 to 35 microseconds to turn into a MonitorSteps each - every
       * minute, only to leave a monitor without steps unqueued, and the
       * evaluation job reads the same steps again and skips such a monitor
       * itself (processTelemetryMonitorEvaluationFromQueue). So every due
       * monitor is queued, and a monitor without steps (made through the API
       * without any, as the Dashboard never makes one) costs one job a minute
       * that ends at its first check.
       */
      select: {
        _id: true,
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

      /*
       * Same reading of the column as the probe scheduler uses, so a
       * telemetry monitor storing a human cadence ("5m") is not quietly
       * pinned to a 1-minute poll the way probe monitors were.
       */
      if (telemetryMonitor.monitoringInterval) {
        nextPing = MonitorProbeService.resolveNextPingAt({
          monitoringInterval: telemetryMonitor.monitoringInterval as string,
          fallback: nextPing,
          onUnreadable: () => {
            logger.error(
              `MonitorTelemetryMonitor: monitoringInterval "${telemetryMonitor.monitoringInterval}" cannot be read as a schedule; falling back to a 1-minute cadence.`,
              {
                service: "workers",
                projectId: telemetryMonitor.projectId?.toString(),
              },
            );
          },
        });
      }

      /*
       * Scheduler bookkeeping stamp, written for every due telemetry/infra
       * monitor every minute. The full updateOneById pipeline costs ~4
       * statements and — because Monitor has @EnableWorkflow +
       * @EnableAuditLog — fires an on-update workflow HTTP trigger and an
       * audit entry per monitor per tick. A scheduling timestamp should do
       * none of that; single-statement UPDATE, same pattern as the heartbeat
       * writes in MonitorResource.ts.
       */
      updatePromises.push(
        MonitorService.updateColumnsByIdWithoutHooks({
          id: telemetryMonitor.id!,
          data: {
            telemetryMonitorLastMonitorAt: OneUptimeDate.getCurrentDate(),
            telemetryMonitorNextMonitorAt: nextPing,
          },
        }),
      );
    }

    await Promise.all(updatePromises);

    logger.debug(`Found ${telemetryMonitors.length} telemetry monitors`, {
      service: "workers",
    });

    logger.debug(telemetryMonitors, { service: "workers" });

    const enqueueTasks: Array<{
      monitor: Monitor;
      run: () => Promise<void>;
    }> = [];

    // The evaluation job skips a monitor without steps (see the select above).
    for (const monitor of telemetryMonitors) {
      enqueueTasks.push({
        monitor,
        run: () => {
          return TelemetryQueueService.addTelemetryMonitorEvaluationJob({
            monitorId: monitor.id!,
            projectId: monitor.projectId!,
          });
        },
      });
    }

    const settledEnqueues: Array<PromiseSettledResult<void>> =
      await Promise.allSettled(
        enqueueTasks.map(
          (task: { monitor: Monitor; run: () => Promise<void> }) => {
            return task.run();
          },
        ),
      );

    for (const [index, settledEnqueue] of settledEnqueues.entries()) {
      if (settledEnqueue.status === "rejected") {
        const monitor: Monitor | undefined = enqueueTasks[index]?.monitor;
        const attrs: LogAttributes = {
          projectId: monitor?.projectId?.toString(),
        };
        logger.error(
          `Error while enqueueing telemetry monitor evaluation: ${monitor?.id?.toString()}`,
          attrs,
        );
        logger.error(settledEnqueue.reason, attrs);
      }
    }
  };

export const processTelemetryMonitorEvaluationFromQueue: (
  data: TelemetryMonitorEvaluationJobData,
) => Promise<void> = async (
  data: TelemetryMonitorEvaluationJobData,
): Promise<void> => {
  const monitorId: ObjectID = new ObjectID(data.monitorId);
  const monitor: Monitor | null = await MonitorService.findOneById({
    id: monitorId,
    select: {
      _id: true,
      monitorSteps: true,
      monitorType: true,
      projectId: true,
      ...MONITOR_PAUSE_FLAGS_SELECT,
    },
    props: {
      isRoot: true,
    },
  });

  if (!monitor || !monitor.id) {
    logger.debug(`Telemetry monitor ${data.monitorId} not found. Skipping.`);
    return;
  }

  // Archived or disabled since the job was queued.
  if (MonitorPauseState.isPaused(monitor)) {
    logger.debug(
      `Telemetry monitor ${data.monitorId} is archived or disabled. Skipping evaluation.`,
    );
    return;
  }

  if (
    !monitor.monitorSteps ||
    !monitor.monitorSteps.data?.monitorStepsInstanceArray?.length ||
    monitor.monitorSteps.data.monitorStepsInstanceArray.length === 0
  ) {
    logger.debug(`Telemetry monitor ${data.monitorId} has no steps. Skipping.`);
    return;
  }

  const monitorStep: MonitorStep =
    monitor.monitorSteps.data.monitorStepsInstanceArray[0]!;

  /*
   * OneUptime's own downtime is never a resource's silence (issue #2825).
   * While the window this check judges holds time OneUptime was not
   * receiving - it was restarting, upgrading or its datastores were
   * unreachable, or it had only just come back - the check waits: no status
   * change, nothing opened, nothing resolved. While the ingest queue is
   * behind, the window ends where the queue is, so the check judges data
   * that has been read rather than data still waiting to be.
   */
  const plan: TelemetryEvaluationPlan =
    await ReceivingCoverage.planTelemetryEvaluation({
      windowInMs: TelemetryMonitorWindow.getWindowInMs({
        monitorType: monitor.monitorType!,
        monitorStep,
      }),
    });

  if (!plan.evaluate) {
    logger.debug(
      `Telemetry monitor ${data.monitorId} waits: its window holds time this instance was not receiving data (${plan.deferredBecause}).`,
      {
        service: "workers",
        projectId: monitor.projectId?.toString(),
      },
    );
    return;
  }

  const response: TelemetryMonitorResponse = await monitorTelemetryMonitor({
    monitorStep,
    monitorType: monitor.monitorType!,
    monitorId: monitor.id,
    projectId: monitor.projectId!,
    evaluateUntil: plan.isIngestBehind ? plan.evaluateUntil : undefined,
  });

  await MonitorResourceUtil.monitorResource(response);
};

type MonitorTelemetryMonitorFunction = (data: {
  monitorStep: MonitorStep;
  monitorType: MonitorType;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<TelemetryMonitorResponse>;

/**
 * The metric name each query config reads, in query order. Queries
 * without one are skipped.
 */
const getQueryMetricNames: (
  queryConfigs: Array<MetricQueryConfigData>,
) => Array<string> = (
  queryConfigs: Array<MetricQueryConfigData>,
): Array<string> => {
  const names: Array<string> = [];

  for (const queryConfig of queryConfigs) {
    const name: string | undefined =
      queryConfig.metricQueryData?.filterData?.metricName?.toString();

    if (name) {
      names.push(name);
    }
  }

  return names;
};

/**
 * Fetch the native unit (as reported by OpenTelemetry and stored in
 * MetricType) for each metric name a query config references. Returned
 * as a lowercase-keyed map so lookups are case-insensitive.
 */
const loadNativeUnitsByMetricName: (input: {
  queryConfigs: Array<MetricQueryConfigData>;
  projectId: ObjectID;
}) => Promise<Map<string, string>> = async (input: {
  queryConfigs: Array<MetricQueryConfigData>;
  projectId: ObjectID;
}): Promise<Map<string, string>> => {
  const names: Set<string> = new Set<string>(
    getQueryMetricNames(input.queryConfigs),
  );

  if (names.size === 0) {
    return new Map<string, string>();
  }

  const metricTypes: Array<MetricType> = await MetricTypeService.findBy({
    query: {
      projectId: input.projectId,
      name: DatabaseQueryHelper.any(Array.from(names)),
    },
    select: {
      name: true,
      unit: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  const unitsByName: Map<string, string> = new Map<string, string>();
  for (const metricType of metricTypes) {
    if (metricType.name && metricType.unit) {
      unitsByName.set(metricType.name.toLowerCase(), metricType.unit);
    }
  }
  return unitsByName;
};

/**
 * The unit map a monitor hands the criteria evaluator as
 * `nativeUnitsByMetricName`: the unit each query's stored values are in,
 * keyed by lowercased metric name.
 *
 * Kept apart from `declaredUnitsByMetricName` on purpose. The declared
 * (MetricType) map is what MetricResultUnitConverter converts query
 * results FROM when a query sets a legendUnit, and must stay exactly that.
 * This map only answers "what unit is a query WITHOUT a legendUnit in",
 * and for a platform monitor its catalog answers that better than the
 * exporter does: docker_stats declares container.cpu.utilization as "1"
 * but sends 0–100, and kubeletstats declares k8s.node.cpu.utilization as
 * "1" but sends cores. A generic Metrics monitor has no catalog
 * (platform null) and gets the declared units back unchanged.
 *
 * A plain dictionary rather than the Map, so it survives the JSON
 * boundaries the response crosses (queue payloads, persisted evaluation
 * data).
 */
const buildNativeUnitsByMetricName: (input: {
  monitorType: MonitorType;
  queryConfigs: Array<MetricQueryConfigData>;
  declaredUnitsByMetricName: Map<string, string>;
}) => Dictionary<string> = (input: {
  monitorType: MonitorType;
  queryConfigs: Array<MetricQueryConfigData>;
  declaredUnitsByMetricName: Map<string, string>;
}): Dictionary<string> => {
  return PlatformMetricUnitUtil.buildUnitsByMetricName({
    platform: PlatformMetricUnitUtil.getPlatformForMonitorType(
      input.monitorType,
    ),
    metricNames: getQueryMetricNames(input.queryConfigs),
    declaredUnitsByMetricName: input.declaredUnitsByMetricName,
    attributesByMetricName: getQueryAttributesByMetricName(input.queryConfigs),
  });
};

/**
 * Each queried metric's attribute filters, keyed by lowercased metric name
 * (the first query wins when two filter one name). The storage array
 * catalog needs them to name a unit: Pure puts several quantities on one
 * metric name and tells them apart by a label. Every other catalog ignores
 * them.
 */
const getQueryAttributesByMetricName: (
  queryConfigs: Array<MetricQueryConfigData>,
) => Map<string, Dictionary<unknown>> = (
  queryConfigs: Array<MetricQueryConfigData>,
): Map<string, Dictionary<unknown>> => {
  const attributesByMetricName: Map<string, Dictionary<unknown>> = new Map<
    string,
    Dictionary<unknown>
  >();

  for (const queryConfig of queryConfigs) {
    const name: string | undefined =
      queryConfig.metricQueryData?.filterData?.metricName?.toString();
    const attributes: unknown =
      queryConfig.metricQueryData?.filterData?.attributes;

    if (
      !name ||
      attributesByMetricName.has(name.toLowerCase()) ||
      !attributes ||
      typeof attributes !== "object"
    ) {
      continue;
    }

    attributesByMetricName.set(
      name.toLowerCase(),
      attributes as Dictionary<unknown>,
    );
  }

  return attributesByMetricName;
};

/*
 * A platform resource as the raw scan saw it: its identity plus the
 * highest and lowest sample it reported in the window.
 */
type ScannedAffectedResource<TIdentity> = TIdentity & {
  metricValue: number;
  lowestMetricValue: number;
};

/**
 * Name the platform resources behind one query's datapoints, for the
 * "Affected Resources" list on the incident.
 *
 * Scans the query's most recent raw rows (limit 100), maps each row's
 * attributes to a resource identity, and keeps one entry per identity
 * key with both the highest (`metricValue`) and lowest
 * (`lowestMetricValue`) sample seen. The evaluator reads whichever one
 * the matched criteria breached on: the highest for "> N" criteria, the
 * lowest for criteria that fire when the metric falls. Keeping only the
 * highest hid a node that was NotReady (0) at any sample behind its
 * Ready (1) samples.
 *
 * Returns undefined when the scan found no rows. Best effort: a failure
 * is logged and also returns undefined, because the breakdown only
 * decorates the notification and must never fail the evaluation — nor,
 * on a multi-query monitor, cost the other queries their breakdowns.
 */
const scanAffectedResources: <TIdentity>(input: {
  query: Query<Metric>;
  projectId: ObjectID;
  platformName: string;
  getIdentity: (attributes: JSONObject) => TIdentity;
  getIdentityKey: (identity: TIdentity) => string;
}) => Promise<Array<ScannedAffectedResource<TIdentity>> | undefined> = async <
  TIdentity,
>(input: {
  query: Query<Metric>;
  projectId: ObjectID;
  platformName: string;
  getIdentity: (attributes: JSONObject) => TIdentity;
  getIdentityKey: (identity: TIdentity) => string;
}): Promise<Array<ScannedAffectedResource<TIdentity>> | undefined> => {
  try {
    const rawMetrics: Array<Metric> = await MetricService.findBy({
      query: input.query,
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

    if (rawMetrics.length === 0) {
      return undefined;
    }

    const resourcesByKey: Map<
      string,
      ScannedAffectedResource<TIdentity>
    > = new Map();

    for (const metric of rawMetrics) {
      const identity: TIdentity = input.getIdentity(
        (metric.attributes as JSONObject) || {},
      );
      const resourceKey: string = input.getIdentityKey(identity);

      const metricValue: number =
        typeof metric.value === "number"
          ? metric.value
          : Number(metric.value) || 0;

      const existing: ScannedAffectedResource<TIdentity> | undefined =
        resourcesByKey.get(resourceKey);

      if (!existing) {
        resourcesByKey.set(resourceKey, {
          ...identity,
          metricValue: metricValue,
          lowestMetricValue: metricValue,
        });
        continue;
      }

      existing.lowestMetricValue = Math.min(
        existing.lowestMetricValue,
        metricValue,
      );
      existing.metricValue = Math.max(existing.metricValue, metricValue);
    }

    return Array.from(resourcesByKey.values());
  } catch (err) {
    logger.error(`Failed to fetch ${input.platformName} resource breakdown`, {
      service: "workers",
      projectId: input.projectId.toString(),
    });
    logger.error(err, {
      service: "workers",
      projectId: input.projectId.toString(),
    });
    return undefined;
  }
};

/**
 * Tag each breakdown with the unit its scanned values are in, once the
 * monitor's units are known (they are loaded after the query loop).
 *
 * Read from the very map the monitor returns as `nativeUnitsByMetricName`
 * so a breakdown and the criteria sentence above it can never disagree
 * about a metric's unit. The raw scan never passes through
 * MetricResultUnitConverter, so this is the metric's own unit even when
 * its query sets a legendUnit.
 */
const tagBreakdownsWithMetricUnit: (input: {
  breakdowns: Array<PlatformResourceBreakdownSource & { metricName: string }>;
  unitsByMetricName: Dictionary<string>;
}) => void = (input: {
  breakdowns: Array<PlatformResourceBreakdownSource & { metricName: string }>;
  unitsByMetricName: Dictionary<string>;
}): void => {
  for (const breakdown of input.breakdowns) {
    breakdown.metricUnit =
      input.unitsByMetricName[breakdown.metricName.toLowerCase()];
  }
};

/**
 * Collect the union of attribute keys the user asked to group by
 * across every queryConfig on the monitor step.
 *
 * Delegates to MonitorStep so that "is this monitor grouped?" has
 * exactly one answer. The criteria evaluator asks the same question to
 * decide whether a criteria must fan out per series, and the two
 * answers disagreeing is what let a grouped monitor quietly open a
 * single whole-monitor alert that then blocked every other host.
 */
const collectGroupByAttributeKeys: (
  queryConfigs: Array<MetricQueryConfigData>,
) => Array<string> = (
  queryConfigs: Array<MetricQueryConfigData>,
): Array<string> => {
  return MonitorStep.getGroupByAttributeKeysFromQueryConfigs(queryConfigs);
};

/**
 * Bucket a single query's aggregated rows by the fingerprint derived
 * from the requested attribute keys. Returns a map from fingerprint to
 * an AggregatedResult containing only the rows that belong to that
 * series (preserving the original row shape so downstream unit
 * conversion and criteria evaluation keep working unchanged).
 */
const bucketAggregatedResultBySeries: (input: {
  aggregatedResult: AggregatedResult;
  attributeKeys: Array<string>;
}) => Map<
  string,
  { labels: JSONObject; aggregatedResult: AggregatedResult }
> = (input: {
  aggregatedResult: AggregatedResult;
  attributeKeys: Array<string>;
}): Map<string, { labels: JSONObject; aggregatedResult: AggregatedResult }> => {
  const buckets: Map<
    string,
    { labels: JSONObject; aggregatedResult: AggregatedResult }
  > = new Map();

  for (const row of input.aggregatedResult.data) {
    const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
      sample: row,
      attributeKeys: input.attributeKeys,
    });

    const fingerprint: string =
      MetricSeriesFingerprint.computeFingerprint(labels);

    const existing:
      | { labels: JSONObject; aggregatedResult: AggregatedResult }
      | undefined = buckets.get(fingerprint);

    if (existing) {
      existing.aggregatedResult.data.push(row);
    } else {
      buckets.set(fingerprint, {
        labels,
        aggregatedResult: { data: [row] },
      });
    }
  }

  return buckets;
};

/*
 * The most rows one grouped read of a monitor returns: a row per series and
 * time bucket (a minute over any window up to three hours), aggregated by
 * ClickHouse. Five times LIMIT_PER_PROJECT, which the reads of a single
 * series keep: a grouped read used to fetch LIMIT_PER_PROJECT RAW rows and
 * aggregate them in code, so a Kubernetes monitor grouped by pod, over a
 * cluster of a few hundred pods reporting every 30 seconds, read only the
 * newest few minutes of its window - and "All Values" over the window
 * waited for data it would never read (follow-up of #4912). A row is a
 * series' bucket now, never a raw data point, so this many rows cover
 * 3,333 series over a 15-minute window, at whatever rate they report.
 */
export const GROUPED_READ_ROW_LIMIT: number = 5 * LIMIT_PER_PROJECT;

/**
 * Where a read cut at its row limit becomes complete, or null when the read
 * was whole.
 *
 * A monitor's reads return their newest rows first, up to their limit
 * (LIMIT_PER_PROJECT, or GROUPED_READ_ROW_LIMIT for a grouped read). A read
 * that returns that many was cut, and holds only the newest
 * rows: every series in it seems to begin at its oldest row, whatever it
 * did before. That is where the data becomes complete, and "All Values"
 * judges a series' coverage from there (MetricWindowCoverage) - otherwise a
 * grouped monitor over enough series would see every one of them begin part
 * way through the window and never fire again.
 */
export const getCutReadCompleteFrom: (input: {
  times: Array<Date | string | undefined>;
  limit: number;
}) => Date | null = (input: {
  times: Array<Date | string | undefined>;
  limit: number;
}): Date | null => {
  if (input.times.length < input.limit) {
    return null;
  }

  let oldestMs: number | null = null;

  for (const time of input.times) {
    if (!time) {
      continue;
    }

    const timeMs: number = OneUptimeDate.fromString(time).getTime();

    if (Number.isFinite(timeMs) && (oldestMs === null || timeMs < oldestMs)) {
      oldestMs = timeMs;
    }
  }

  return oldestMs === null ? null : new Date(oldestMs);
};

// The later of two dates, either of which may be absent.
const getLaterDate: (
  current: Date | undefined,
  candidate: Date | null,
) => Date | undefined = (
  current: Date | undefined,
  candidate: Date | null,
): Date | undefined => {
  if (!candidate) {
    return current;
  }

  if (!current || candidate.getTime() > current.getTime()) {
    return candidate;
  }

  return current;
};

/*
 * One query's data points over a monitor's window, and where the read was
 * cut at its row limit, if it was.
 */
export interface QueryDataPoints {
  aggregatedResult: AggregatedResult;
  completeFrom: Date | null;
}

/**
 * Read one query of an infrastructure monitor (Kubernetes, Docker, Host,
 * Podman, Proxmox, VMware, IoT, Docker Swarm, Ceph, storage arrays) over its
 * window, aggregated by ClickHouse per time bucket - and, for a grouped
 * query, per series: GROUP BY the query's attribute keys, which returns one
 * row per series and bucket with an `attributes` map holding exactly those
 * keys, the shape buildSeriesBreakdown reads. It is the Metrics monitor's
 * read, so a series' buckets are the ones its chart draws.
 *
 * A grouped query used to read raw rows - up to LIMIT_PER_PROJECT of them,
 * newest first - and aggregate them per series and minute in code, because
 * a GROUP BY on the whole `attributes` Map returned no rows through the
 * client's parameter binding. Grouping by each key's value
 * (MetricService's groupByAttributeKeys) never touches the Map as a whole.
 * Moving the grouping into SQL also reads histograms by their
 * distribution and percentiles as ClickHouse computes them, as the Metrics
 * monitor and the charts do.
 */
export const readQueryDataPoints: (input: {
  query: Query<Metric>;
  aggregationType: MetricsAggregationType;
  groupByAttributeKeys: Array<string>;
  groupBy: MetricQueryConfigData["metricQueryData"]["groupBy"];
  startAndEndDate: InBetween<Date>;
}) => Promise<QueryDataPoints> = async (input: {
  query: Query<Metric>;
  aggregationType: MetricsAggregationType;
  groupByAttributeKeys: Array<string>;
  groupBy: MetricQueryConfigData["metricQueryData"]["groupBy"];
  startAndEndDate: InBetween<Date>;
}): Promise<QueryDataPoints> => {
  const isGrouped: boolean = input.groupByAttributeKeys.length > 0;
  const limit: number = isGrouped ? GROUPED_READ_ROW_LIMIT : LIMIT_PER_PROJECT;

  const aggregatedResult: AggregatedResult = await MetricService.aggregateBy({
    query: input.query,
    aggregationType: input.aggregationType,
    aggregateColumnName: "value",
    aggregationTimestampColumnName: "time",
    startTimestamp:
      (input.startAndEndDate?.startValue as Date) ||
      OneUptimeDate.getCurrentDate(),
    endTimestamp:
      (input.startAndEndDate?.endValue as Date) ||
      OneUptimeDate.getCurrentDate(),
    limit: limit,
    skip: 0,
    groupBy: input.groupBy,
    groupByAttributeKeys: isGrouped ? input.groupByAttributeKeys : undefined,
    // Alerting path: fail loud on timeout, never score partial buckets.
    timeoutOverflowMode: "throw",
    props: {
      isRoot: true,
    },
  });

  return {
    aggregatedResult: aggregatedResult,
    completeFrom: getCutReadCompleteFrom({
      times: aggregatedResult.data.map((row: AggregatedModel): Date => {
        return row.timestamp;
      }),
      limit: limit,
    }),
  };
};

/**
 * Build the per-series breakdown for a monitor step. Each entry in the
 * returned array has `aggregatedResults` aligned with the provided
 * `queryConfigs.length + formulaConfigs.length` so formula evaluation
 * can reuse the same index scheme (queryIndex, queryCount+formulaIndex)
 * that the ungrouped path uses.
 *
 * When a series has no rows for a given query (because that series
 * didn't appear in that query's results), the aggregated result for
 * that slot is empty — the criteria evaluator already treats an empty
 * series as "no data" per the configured NoDataPolicy.
 */
const buildSeriesBreakdown: (input: {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  perQueryResults: Array<AggregatedResult>;
  attributeKeys: Array<string>;
  projectId: ObjectID;
}) => Array<MetricSeriesResult> = (input: {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  perQueryResults: Array<AggregatedResult>;
  attributeKeys: Array<string>;
  projectId: ObjectID;
}): Array<MetricSeriesResult> => {
  /*
   * Bucket every query's results by fingerprint first. Each query
   * produces its own fingerprint → rows map; we then take the union of
   * fingerprints seen across queries so a formula like `a + b` still
   * yields a row even if one side has no samples for that series.
   */
  const perQueryBuckets: Array<
    Map<string, { labels: JSONObject; aggregatedResult: AggregatedResult }>
  > = input.perQueryResults.map((aggregatedResult: AggregatedResult) => {
    return bucketAggregatedResultBySeries({
      aggregatedResult,
      attributeKeys: input.attributeKeys,
    });
  });

  const fingerprintToLabels: Map<string, JSONObject> = new Map();
  for (const buckets of perQueryBuckets) {
    for (const [fingerprint, entry] of buckets) {
      if (!fingerprintToLabels.has(fingerprint)) {
        fingerprintToLabels.set(fingerprint, entry.labels);
      }
    }
  }

  const breakdown: Array<MetricSeriesResult> = [];

  for (const [fingerprint, labels] of fingerprintToLabels) {
    const perQueryForSeries: Array<AggregatedResult> = perQueryBuckets.map(
      (
        bucket: Map<
          string,
          { labels: JSONObject; aggregatedResult: AggregatedResult }
        >,
      ) => {
        return bucket.get(fingerprint)?.aggregatedResult || { data: [] };
      },
    );

    const seriesWithFormulas: Array<AggregatedResult> = appendFormulaResults({
      queryConfigs: input.queryConfigs,
      formulaConfigs: input.formulaConfigs,
      aggregatedResults: perQueryForSeries,
      projectId: input.projectId,
    });

    breakdown.push({
      fingerprint,
      labels,
      aggregatedResults: seriesWithFormulas,
    });
  }

  return breakdown;
};

/**
 * Reconstruct the "expected" host set and seed an empty "no data" series
 * for every expected host missing from the current window's breakdown, so
 * the criteria evaluator's per-series NoDataPolicy fires one correctly-
 * labeled alert per host that has gone silent.
 *
 * A group-by-host query only returns series for hosts that reported, so an
 * absent host is otherwise never evaluated and the no-data trigger fires
 * only on a total fleet blackout (via the single monitor-level synthetic
 * series). Injection is intentionally skipped when the current window is
 * empty: a totally silent window is ambiguous (whole pipeline down vs.
 * every host down) and is already covered by that monitor-level trigger. A
 * non-empty window proves the pipeline is live, so a host missing from it
 * is genuinely silent. Self-gates (via HostAbsenceSeries) to a pure
 * single-key host group-by, a criteria that opts into no-data detection,
 * and queries without host-scoping attribute filters — otherwise returns
 * the breakdown unchanged.
 */
const injectExpectedAbsentHostSeries: (input: {
  monitorStep: MonitorStep;
  seriesBreakdown: Array<MetricSeriesResult> | undefined;
  groupByAttributeKeys: Array<string>;
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  projectId: ObjectID;
}) => Promise<Array<MetricSeriesResult> | undefined> = async (input: {
  monitorStep: MonitorStep;
  seriesBreakdown: Array<MetricSeriesResult> | undefined;
  groupByAttributeKeys: Array<string>;
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  projectId: ObjectID;
}): Promise<Array<MetricSeriesResult> | undefined> => {
  const seriesBreakdown: Array<MetricSeriesResult> | undefined =
    input.seriesBreakdown;

  if (!seriesBreakdown || seriesBreakdown.length === 0) {
    return seriesBreakdown;
  }

  const hostKey: string | null = getHostAbsenceGroupByKey(
    input.groupByAttributeKeys,
  );
  if (!hostKey) {
    return seriesBreakdown;
  }

  if (!monitorStepOptsIntoNoDataDetection(input.monitorStep)) {
    return seriesBreakdown;
  }

  if (queriesScopeHostSubset(input.queryConfigs)) {
    return seriesBreakdown;
  }

  const expectedHostIdentifiers: Array<string> =
    await HostService.getExpectedHostIdentifiers({
      projectId: input.projectId,
      seenWithinMinutes: HOST_ABSENCE_EXPECTED_WINDOW_MINUTES,
    });

  if (expectedHostIdentifiers.length === 0) {
    return seriesBreakdown;
  }

  const absentSeries: Array<MetricSeriesResult> = buildAbsentHostSeries({
    presentSeries: seriesBreakdown,
    expectedHostIdentifiers,
    hostKey,
    slotCount: input.queryConfigs.length + input.formulaConfigs.length,
  });

  if (absentSeries.length === 0) {
    return seriesBreakdown;
  }

  logger.debug(
    `Seeded ${absentSeries.length} absent-host no-data series (expected ${expectedHostIdentifiers.length}, present ${seriesBreakdown.length})`,
    {
      service: "workers",
      projectId: input.projectId.toString(),
    },
  );

  return [...seriesBreakdown, ...absentSeries];
};

/*
 * IoT analogue of injectExpectedAbsentHostSeries: seed synthetic
 * "no data" series for REGISTERED devices (IoTDeviceCredential rows,
 * the explicit expected-list) that are silent in the current window,
 * so a per-device-grouped IoT monitor detects an individual device
 * going dark. Same gates as the host path: non-empty breakdown (an
 * entirely silent window is ambiguous — pipeline down vs everything
 * down — and is handled by the whole-monitor no-data path), group-by
 * exactly device.id, a criteria filter opting into no-data detection,
 * and no query-level attribute subset scoping. The expected set is
 * FLEET-scoped: the fleet name is resolved to its id case-insensitively
 * (matching fleet find-or-create), best-effort — an unresolvable fleet
 * returns the breakdown unchanged.
 */
const injectExpectedAbsentIoTDeviceSeries: (input: {
  monitorStep: MonitorStep;
  seriesBreakdown: Array<MetricSeriesResult> | undefined;
  groupByAttributeKeys: Array<string>;
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  projectId: ObjectID;
  fleetIdentifier: string;
}) => Promise<Array<MetricSeriesResult> | undefined> = async (input: {
  monitorStep: MonitorStep;
  seriesBreakdown: Array<MetricSeriesResult> | undefined;
  groupByAttributeKeys: Array<string>;
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  projectId: ObjectID;
  fleetIdentifier: string;
}): Promise<Array<MetricSeriesResult> | undefined> => {
  const seriesBreakdown: Array<MetricSeriesResult> | undefined =
    input.seriesBreakdown;

  if (!seriesBreakdown || seriesBreakdown.length === 0) {
    return seriesBreakdown;
  }

  const deviceKey: string | null = getIoTDeviceAbsenceGroupByKey(
    input.groupByAttributeKeys,
  );
  if (!deviceKey) {
    return seriesBreakdown;
  }

  if (!monitorStepOptsIntoNoDataDetection(input.monitorStep)) {
    return seriesBreakdown;
  }

  if (queriesScopeHostSubset(input.queryConfigs)) {
    return seriesBreakdown;
  }

  const fleetIdentifier: string = input.fleetIdentifier?.trim() || "";
  if (!fleetIdentifier) {
    return seriesBreakdown;
  }

  let expectedDeviceExternalIds: Array<string> = [];
  try {
    const fleet: IoTFleet | null = await IoTFleetService.findOneBy({
      query: {
        projectId: input.projectId,
        name: DatabaseQueryHelper.findWithSameText(fleetIdentifier),
      },
      select: {
        _id: true,
      },
      props: { isRoot: true },
    });

    if (!fleet?._id) {
      return seriesBreakdown;
    }

    expectedDeviceExternalIds =
      await IoTDeviceCredentialService.getExpectedDeviceExternalIds({
        projectId: input.projectId,
        iotFleetId: new ObjectID(fleet._id.toString()),
      });
  } catch (err) {
    // Best-effort: never fail an evaluation over the expected-set lookup.
    logger.error(
      `Failed to resolve expected IoT devices for fleet "${fleetIdentifier}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return seriesBreakdown;
  }

  if (expectedDeviceExternalIds.length === 0) {
    return seriesBreakdown;
  }

  const absentSeries: Array<MetricSeriesResult> = buildAbsentIoTDeviceSeries({
    presentSeries: seriesBreakdown,
    expectedDeviceExternalIds,
    deviceKey,
    slotCount: input.queryConfigs.length + input.formulaConfigs.length,
  });

  if (absentSeries.length === 0) {
    return seriesBreakdown;
  }

  logger.debug(
    `Seeded ${absentSeries.length} absent-device no-data series for fleet "${fleetIdentifier}" (registered ${expectedDeviceExternalIds.length}, present ${seriesBreakdown.length})`,
    {
      service: "workers",
      projectId: input.projectId.toString(),
    },
  );

  return [...seriesBreakdown, ...absentSeries];
};

/**
 * Evaluate all formulas and append their results to the aggregated
 * results array, in the order they appear in formulaConfigs. Criteria
 * evaluation (MetricMonitorCriteria) resolves formulas via
 * `aliasIndex = queryConfigs.length + formulaIndex`, so preserving order
 * is load-bearing.
 */
const appendFormulaResults: (input: {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  aggregatedResults: Array<AggregatedResult>;
  projectId: ObjectID;
}) => Array<AggregatedResult> = (input: {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  aggregatedResults: Array<AggregatedResult>;
  projectId: ObjectID;
}): Array<AggregatedResult> => {
  const results: Array<AggregatedResult> = [...input.aggregatedResults];

  for (
    let index: number = 0;
    index < (input.formulaConfigs || []).length;
    index++
  ) {
    const formulaConfig: MetricFormulaConfigData = input.formulaConfigs[index]!;
    const formula: string =
      formulaConfig.metricFormulaData?.metricFormula || "";

    if (!formula.trim()) {
      results.push({ data: [] });
      continue;
    }

    try {
      const formulaResult: AggregatedResult =
        MetricFormulaEvaluator.evaluateFormula({
          formula,
          queryConfigs: input.queryConfigs,
          formulaConfigs: input.formulaConfigs.slice(0, index),
          results,
        });
      results.push(formulaResult);
    } catch (err) {
      logger.error("Failed to evaluate metric formula", {
        service: "workers",
        projectId: input.projectId.toString(),
      });
      logger.error(err, {
        service: "workers",
        projectId: input.projectId.toString(),
      });
      results.push({ data: [] });
    }
  }

  return results;
};

const monitorTelemetryMonitor: MonitorTelemetryMonitorFunction = async (data: {
  monitorStep: MonitorStep;
  monitorType: MonitorType;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<TelemetryMonitorResponse> => {
  const { monitorStep, monitorType, monitorId, projectId, evaluateUntil } =
    data;

  if (monitorType === MonitorType.Logs) {
    return monitorLogs({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.SecurityEvents) {
    return monitorSecurityEvents({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.Llm) {
    return monitorLlm({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.Traces) {
    return monitorTrace({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.Metrics) {
    return monitorMetric({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.Exceptions) {
    return monitorException({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.Profiles) {
    return monitorProfile({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.Kubernetes) {
    return monitorKubernetes({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.Docker) {
    return monitorDocker({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.Host) {
    return monitorHost({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.Podman) {
    return monitorPodman({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.Proxmox) {
    return monitorProxmox({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.VMware) {
    return monitorVMware({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.DockerSwarm) {
    return monitorDockerSwarm({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.Ceph) {
    return monitorCeph({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.StorageArray) {
    return monitorStorageArray({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  if (monitorType === MonitorType.IoTDevice) {
    return monitorIoT({
      monitorStep,
      monitorId,
      projectId,
      evaluateUntil,
    });
  }

  throw new BadDataException("Monitor type is not supported");
};

type MonitorLlmFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<LlmMonitorResponse>;

/*
 * One check of an AI / LLM monitor: the answers the project's AI gave in
 * the step's window, in the apps it watches, and how many were bad.
 * Counted in one ClickHouse read (LlmConversationService.countAnswers) as
 * root - the monitor's own scope is the step's apps, not a member's.
 */
export const monitorLlm: MonitorLlmFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<LlmMonitorResponse> => {
  /*
   * A step saved without its config still runs, on the defaults (every
   * problem counts, the last 15 minutes, every app), rather than throwing
   * every cycle and leaving the monitor inert.
   */
  const config: MonitorStepLlmMonitor = MonitorStepLlmMonitorUtil.fromJSON(
    (data.monitorStep.data?.llmMonitor ||
      MonitorStepLlmMonitorUtil.getDefault()) as unknown as JSONObject,
  );

  const rule: LlmBadAnswerRule =
    MonitorStepLlmMonitorUtil.getBadAnswerRule(config);
  const window: InBetween<Date> = MonitorStepLlmMonitorUtil.getWindow(
    config,
    data.evaluateUntil,
  );

  const counts: LlmAnswerCounts = await LlmConversationService.countAnswers({
    projectId: data.projectId,
    startTime: window.startValue,
    endTime: window.endValue,
    serviceIds:
      config.telemetryServiceIds.length > 0
        ? config.telemetryServiceIds
        : undefined,
    issues: rule.issues,
    slowAnswerMs: rule.slowAnswerMs,
    model: config.model || undefined,
  });

  return {
    projectId: data.projectId,
    llmAnswerCount: counts.answerCount,
    llmBadAnswerCount: counts.badAnswerCount,
    llmBadAnswerPercent: LlmMonitorResponseUtil.getBadAnswerPercent(counts),
    /*
     * Kept as a query object, like the trace monitor's spanQuery: the
     * incident or alert it is saved with serializes it.
     */
    llmSpanQuery: MonitorStepLlmMonitorUtil.toSpanQuery(
      config,
      data.evaluateUntil,
    ),
    monitorId: data.monitorId,
  };
};

type MonitorTraceFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<TraceMonitorResponse>;

export const monitorTrace: MonitorTraceFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<TraceMonitorResponse> => {
  /*
   * Fall back to the default config when the step was saved without a
   * traceMonitor sub-config (see the equivalent note in monitorLogs). A
   * missing config previously threw every cycle and left the monitor inert.
   */
  const traceQuery: MonitorStepTraceMonitor =
    data.monitorStep.data?.traceMonitor ||
    MonitorStepTraceMonitorUtil.getDefault();

  const query: Query<Log> = MonitorStepTraceMonitorUtil.toQuery(
    traceQuery,
    data.evaluateUntil,
  );

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
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

export const monitorMetric: MonitorMetricFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
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
      data.evaluateUntil,
    );

  const finalResult: Array<AggregatedResult> = [];

  // Where a read was cut at its row limit - see getCutReadCompleteFrom.
  let dataCompleteFrom: Date | undefined = undefined;

  const groupByAttributeKeys: Array<string> = collectGroupByAttributeKeys(
    metricMonitorConfig.metricViewConfig.queryConfigs,
  );

  for (const queryConfig of metricMonitorConfig.metricViewConfig.queryConfigs) {
    const query: Query<Metric> = {
      projectId: data.projectId,
      time: startAndEndDate,
      name: queryConfig.metricQueryData.filterData.metricName,
    };

    if (
      metricMonitorConfig.telemetryServiceIds &&
      metricMonitorConfig.telemetryServiceIds.length > 0
    ) {
      query.primaryEntityId = new Includes(
        metricMonitorConfig.telemetryServiceIds,
      );
    }

    if (
      queryConfig.metricQueryData &&
      queryConfig.metricQueryData.filterData &&
      queryConfig.metricQueryData.filterData.attributes &&
      Object.keys(queryConfig.metricQueryData.filterData.attributes).length > 0
    ) {
      query.attributes = queryConfig.metricQueryData.filterData
        .attributes as Dictionary<string>;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    /*
     * Grouped and ungrouped monitors share the SQL aggregation path.
     * Per-series grouping goes through `groupByAttributeKeys`, which
     * MetricService compiles to `GROUP BY attributes['<key>']` — the
     * previous raw-row JS fallback aggregated the `value` column
     * directly, which for histogram metrics holds the datapoint SUM
     * (so an "Avg of http.client.request.duration" monitor evaluated
     * ~110s instead of ~0.6s and false-alerted), silently computed
     * percentile aggregations as Avg, and truncated high-cardinality
     * metrics at the 10k raw-row limit. The SQL path is histogram-
     * aware for both scalar and percentile aggregations, and returns
     * one row per (bucket, selected-key values) with an `attributes`
     * map carrying exactly the grouped keys — the shape
     * buildSeriesBreakdown already consumes.
     */
    const readRowLimit: number =
      groupByAttributeKeys.length > 0
        ? GROUPED_READ_ROW_LIMIT
        : LIMIT_PER_PROJECT;

    const aggregatedResults: AggregatedResult = await MetricService.aggregateBy(
      {
        query: query,
        aggregationType,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        startTimestamp:
          (startAndEndDate?.startValue as Date) ||
          OneUptimeDate.getCurrentDate(),
        endTimestamp:
          (startAndEndDate?.endValue as Date) || OneUptimeDate.getCurrentDate(),
        // A row per series and bucket when grouped (GROUPED_READ_ROW_LIMIT).
        limit: readRowLimit,
        skip: 0,
        groupBy: queryConfig.metricQueryData.groupBy,
        groupByAttributeKeys:
          groupByAttributeKeys.length > 0 ? groupByAttributeKeys : undefined,
        /*
         * Alerting must fail loud on a query timeout: the default
         * 'break' overflow mode returns silently-partial buckets, which
         * a no-data policy would score as missing data (false "no data"
         * incident) and threshold checks would score against wrong
         * numbers. 'throw' fails the queue job and leaves monitor state
         * unchanged — same abort semantics the uncapped query had.
         */
        timeoutOverflowMode: "throw",
        props: {
          isRoot: true,
        },
      },
    );

    dataCompleteFrom = getLaterDate(
      dataCompleteFrom,
      getCutReadCompleteFrom({
        times: aggregatedResults.data.map((row: AggregatedModel): Date => {
          return row.timestamp;
        }),
        limit: readRowLimit,
      }),
    );

    logger.debug("Aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });
    logger.debug(aggregatedResults, {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);
  }

  /*
   * Convert each query's raw values from the metric's native unit
   * (reported by OpenTelemetry) into the unit the user picked on the
   * query's alias. This means formulas operate on values the user
   * actually sees in the UI — e.g. "memory in GB + disk in GB" rather
   * than silently summing bytes with kilobytes.
   */
  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: metricMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
    });

  const resultsInDisplayUnit: Array<AggregatedResult> =
    MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
      queryConfigs: metricMonitorConfig.metricViewConfig.queryConfigs,
      results: finalResult,
      nativeUnitByMetricName: nativeUnitsByMetricName,
    });

  const resultsWithFormulas: Array<AggregatedResult> = appendFormulaResults({
    queryConfigs: metricMonitorConfig.metricViewConfig.queryConfigs,
    formulaConfigs: metricMonitorConfig.metricViewConfig.formulaConfigs || [],
    aggregatedResults: resultsInDisplayUnit,
    projectId: data.projectId,
  });

  let seriesBreakdown: Array<MetricSeriesResult> | undefined =
    groupByAttributeKeys.length > 0
      ? buildSeriesBreakdown({
          queryConfigs: metricMonitorConfig.metricViewConfig.queryConfigs,
          formulaConfigs:
            metricMonitorConfig.metricViewConfig.formulaConfigs || [],
          perQueryResults: resultsInDisplayUnit,
          attributeKeys: groupByAttributeKeys,
          projectId: data.projectId,
        })
      : undefined;

  /*
   * Seed synthetic "no data" series for hosts that are expected to be
   * reporting but produced no row this window, so per-host down-detection
   * fires instead of only catching a total fleet blackout. No-op unless the
   * monitor is a single-key host group-by whose criteria opts into no-data
   * detection (see injectExpectedAbsentHostSeries).
   */
  seriesBreakdown = await injectExpectedAbsentHostSeries({
    monitorStep: data.monitorStep,
    seriesBreakdown,
    groupByAttributeKeys,
    queryConfigs: metricMonitorConfig.metricViewConfig.queryConfigs,
    formulaConfigs: metricMonitorConfig.metricViewConfig.formulaConfigs || [],
    projectId: data.projectId,
  });

  /*
   * The criteria evaluator uses this as a fallback when the user didn't
   * pick an explicit `legendUnit` — without it, a metric whose native
   * unit is the OTel dimensionless "1" can't be compared against a "%"
   * threshold. A generic Metrics monitor has no catalog, so this is the
   * declared (MetricType) unit of every query's metric.
   */
  return {
    projectId: data.projectId,
    metricViewConfig: metricMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    dataCompleteFrom: dataCompleteFrom,
    metricResult: resultsWithFormulas,
    monitorId: data.monitorId,
    seriesBreakdown: seriesBreakdown,
    nativeUnitsByMetricName: buildNativeUnitsByMetricName({
      monitorType: MonitorType.Metrics,
      queryConfigs: metricMonitorConfig.metricViewConfig.queryConfigs,
      declaredUnitsByMetricName: nativeUnitsByMetricName,
    }),
  };
};

type MonitorExceptionFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<ExceptionMonitorResponse>;

export const monitorException: MonitorExceptionFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<ExceptionMonitorResponse> => {
  /*
   * Fall back to the default config when the step was saved without an
   * exceptionMonitor sub-config (see the equivalent note in monitorLogs). A
   * missing config previously threw every cycle and left the monitor inert.
   */
  const exceptionMonitorConfig: MonitorStepExceptionMonitor =
    data.monitorStep.data?.exceptionMonitor ||
    MonitorStepExceptionMonitorUtil.getDefault();

  const analyticsQuery: Query<ExceptionInstance> =
    MonitorStepExceptionMonitorUtil.toAnalyticsQuery(
      exceptionMonitorConfig,
      data.evaluateUntil,
    );

  analyticsQuery.projectId = data.projectId;

  /*
   * Unless the monitor opts in via includeResolved / includeArchived,
   * occurrences belonging to exception groups marked resolved/archived
   * must not count toward the threshold — resolving an exception should
   * close (or never open) the incident. Group state lives in Postgres
   * (TelemetryException); occurrences live in ClickHouse — fingerprints
   * are the join key, so the count query excludes the resolved/archived
   * ones. Ingestion un-resolves a group on any new occurrence, so a
   * recurring exception is counted again automatically. (If that
   * best-effort ingest upsert fails, a recurring-but-still-flagged group
   * stays excluded until the next successful occurrence upsert — accepted:
   * ingest failures are logged loudly and the next occurrence heals it.)
   */
  const countQuery: Query<ExceptionInstance> = { ...analyticsQuery };

  const excludeResolved: boolean = !exceptionMonitorConfig.includeResolved;
  const excludeArchived: boolean = !exceptionMonitorConfig.includeArchived;

  if (excludeResolved || excludeArchived) {
    const excludedFingerprints: Array<string> =
      await TelemetryExceptionService.getResolvedOrArchivedFingerprints({
        projectId: data.projectId,
        telemetryServiceIds: exceptionMonitorConfig.telemetryServiceIds,
        resolved: excludeResolved,
        archived: excludeArchived,
      });

    if (excludedFingerprints.length > 0) {
      countQuery.fingerprint = new IncludesNone(excludedFingerprints);
    }
  }

  const exceptionCount: PositiveNumber = await ExceptionInstanceService.countBy(
    {
      query: countQuery,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    },
  );

  /*
   * exceptionQuery intentionally stays the base query (no fingerprint
   * exclusion list) — it is persisted with the status timeline for the
   * "view exceptions" link, and a NOT IN list of thousands of hashes
   * would bloat every timeline entry.
   */
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
  evaluateUntil?: Date | undefined;
}) => Promise<ProfileMonitorResponse>;

const monitorProfile: MonitorProfileFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<ProfileMonitorResponse> => {
  const profileMonitorConfig: MonitorStepProfileMonitor | undefined =
    data.monitorStep.data?.profileMonitor;

  if (!profileMonitorConfig) {
    throw new BadDataException("Profile monitor config is missing");
  }

  const analyticsQuery: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery(
    profileMonitorConfig,
    data.evaluateUntil,
  );

  analyticsQuery.projectId = data.projectId;

  const [profileCount, functionShare]: [
    PositiveNumber,
    ProfileFunctionShareReading | null,
  ] = await Promise.all([
    ProfileService.countBy({
      query: analyticsQuery,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    }),
    /*
     * The "Function Share" criteria's reading: only for a monitor that
     * names a function, over the same profiles the count reads.
     */
    ProfileMonitorShare.measure({
      projectId: data.projectId,
      monitorStepProfileMonitor: profileMonitorConfig,
      evaluateUntil: data.evaluateUntil,
    }),
  ]);

  const response: ProfileMonitorResponse = {
    projectId: data.projectId,
    profileCount: profileCount.toNumber(),
    profileQuery: JSONFunctions.anyObjectToJSONObject(
      analyticsQuery,
    ) as Query<Profile>,
    monitorId: data.monitorId,
  };

  if (functionShare) {
    response.functionShare = functionShare;
  }

  return response;
};

type MonitorKubernetesFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

export const monitorKubernetes: MonitorKubernetesFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<MetricMonitorResponse> => {
  const kubernetesMonitorConfig: MonitorStepKubernetesMonitor | undefined =
    data.monitorStep.data?.kubernetesMonitor;

  if (!kubernetesMonitorConfig) {
    throw new BadDataException("Kubernetes monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      kubernetesMonitorConfig.rollingTime || RollingTime.Past1Minute,
      data.evaluateUntil,
    );

  const finalResult: Array<AggregatedResult> = [];

  // Where a read was cut at its row limit - see getCutReadCompleteFrom.
  let dataCompleteFrom: Date | undefined = undefined;

  /*
   * One breakdown per query, in query order. A ratio template has two
   * queries (used ÷ allocatable) and a formula; keeping a single
   * breakdown that each query overwrote left the DENOMINATOR's scan in
   * the email — every node's allocatable bytes under a "> 85%" criteria.
   */
  const kubernetesResourceBreakdowns: Array<KubernetesResourceBreakdown> = [];

  const groupByAttributeKeys: Array<string> = collectGroupByAttributeKeys(
    kubernetesMonitorConfig.metricViewConfig.queryConfigs,
  );

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

      const workloadNameAttributeKey: string | null =
        MonitorStepKubernetesMonitorUtil.getWorkloadNameAttributeKey(
          resourceFilters,
        );

      if (workloadNameAttributeKey && resourceFilters.workloadName) {
        attributes[workloadNameAttributeKey] =
          resourceFilters.workloadName.trim();
      }
    }

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    const dataPoints: QueryDataPoints = await readQueryDataPoints({
      query: query,
      aggregationType: aggregationType,
      groupByAttributeKeys: groupByAttributeKeys,
      groupBy: queryConfig.metricQueryData.groupBy,
      startAndEndDate: startAndEndDate,
    });

    const aggregatedResults: AggregatedResult = dataPoints.aggregatedResult;

    dataCompleteFrom = getLaterDate(dataCompleteFrom, dataPoints.completeFrom);

    logger.debug("Kubernetes monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });
    logger.debug(aggregatedResults, {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);

    // Fetch raw metrics to extract per-resource Kubernetes context
    const affectedResources: Array<KubernetesAffectedResource> | undefined =
      await scanAffectedResources({
        query: query,
        projectId: data.projectId,
        platformName: "Kubernetes",
        getIdentity: PlatformResourceIdentity.kubernetes,
        getIdentityKey: PlatformResourceIdentity.kubernetesKey,
      });

    if (affectedResources) {
      kubernetesResourceBreakdowns.push({
        clusterName: kubernetesMonitorConfig.clusterIdentifier,
        metricName: metricName,
        metricFriendlyName:
          getKubernetesMetricByMetricName(metricName)?.friendlyName ||
          metricName,
        affectedResources: affectedResources,
        attributes: attributes,
        metricAlias: queryConfig.metricAliasData?.metricVariable,
      });
    }
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: kubernetesMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
    });

  const unitsByMetricName: Dictionary<string> = buildNativeUnitsByMetricName({
    monitorType: MonitorType.Kubernetes,
    queryConfigs: kubernetesMonitorConfig.metricViewConfig.queryConfigs,
    declaredUnitsByMetricName: nativeUnitsByMetricName,
  });

  tagBreakdownsWithMetricUnit({
    breakdowns: kubernetesResourceBreakdowns,
    unitsByMetricName: unitsByMetricName,
  });

  const resultsInDisplayUnit: Array<AggregatedResult> =
    MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
      queryConfigs: kubernetesMonitorConfig.metricViewConfig.queryConfigs,
      results: finalResult,
      nativeUnitByMetricName: nativeUnitsByMetricName,
    });

  const resultsWithFormulas: Array<AggregatedResult> = appendFormulaResults({
    queryConfigs: kubernetesMonitorConfig.metricViewConfig.queryConfigs,
    formulaConfigs:
      kubernetesMonitorConfig.metricViewConfig.formulaConfigs || [],
    aggregatedResults: resultsInDisplayUnit,
    projectId: data.projectId,
  });

  const seriesBreakdown: Array<MetricSeriesResult> | undefined =
    groupByAttributeKeys.length > 0
      ? buildSeriesBreakdown({
          queryConfigs: kubernetesMonitorConfig.metricViewConfig.queryConfigs,
          formulaConfigs:
            kubernetesMonitorConfig.metricViewConfig.formulaConfigs || [],
          perQueryResults: resultsInDisplayUnit,
          attributeKeys: groupByAttributeKeys,
          projectId: data.projectId,
        })
      : undefined;

  return {
    projectId: data.projectId,
    metricViewConfig: kubernetesMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    dataCompleteFrom: dataCompleteFrom,
    metricResult: resultsWithFormulas,
    monitorId: data.monitorId,
    kubernetesResourceBreakdowns:
      kubernetesResourceBreakdowns.length > 0
        ? kubernetesResourceBreakdowns
        : undefined,
    seriesBreakdown: seriesBreakdown,
    nativeUnitsByMetricName: unitsByMetricName,
  };
};

type MonitorDockerFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

export const monitorDocker: MonitorDockerFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<MetricMonitorResponse> => {
  const dockerMonitorConfig: MonitorStepDockerMonitor | undefined =
    data.monitorStep.data?.dockerMonitor;

  if (!dockerMonitorConfig) {
    throw new BadDataException("Docker monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      dockerMonitorConfig.rollingTime || RollingTime.Past1Minute,
      data.evaluateUntil,
    );

  const finalResult: Array<AggregatedResult> = [];

  // Where a read was cut at its row limit - see getCutReadCompleteFrom.
  let dataCompleteFrom: Date | undefined = undefined;

  const groupByAttributeKeys: Array<string> = collectGroupByAttributeKeys(
    dockerMonitorConfig.metricViewConfig.queryConfigs,
  );

  for (const queryConfig of dockerMonitorConfig.metricViewConfig.queryConfigs) {
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

    // Add Docker-specific attribute filters
    if (dockerMonitorConfig.hostIdentifier) {
      attributes["resource.host.name"] = dockerMonitorConfig.hostIdentifier;
    }

    // Always filter by Docker runtime
    attributes["resource.container.runtime"] = "docker";

    if (dockerMonitorConfig.containerFilters) {
      const containerFilters: DockerContainerFilters =
        dockerMonitorConfig.containerFilters;

      if (containerFilters.containerName) {
        attributes["resource.container.name"] = containerFilters.containerName;
      }

      if (containerFilters.containerImage) {
        attributes["resource.container.image.name"] =
          containerFilters.containerImage;
      }
    }

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    const dataPoints: QueryDataPoints = await readQueryDataPoints({
      query: query,
      aggregationType: aggregationType,
      groupByAttributeKeys: groupByAttributeKeys,
      groupBy: queryConfig.metricQueryData.groupBy,
      startAndEndDate: startAndEndDate,
    });

    const aggregatedResults: AggregatedResult = dataPoints.aggregatedResult;

    dataCompleteFrom = getLaterDate(dataCompleteFrom, dataPoints.completeFrom);

    logger.debug("Docker monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: dockerMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
    });

  const resultsInDisplayUnit: Array<AggregatedResult> =
    MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
      queryConfigs: dockerMonitorConfig.metricViewConfig.queryConfigs,
      results: finalResult,
      nativeUnitByMetricName: nativeUnitsByMetricName,
    });

  const resultsWithFormulas: Array<AggregatedResult> = appendFormulaResults({
    queryConfigs: dockerMonitorConfig.metricViewConfig.queryConfigs,
    formulaConfigs: dockerMonitorConfig.metricViewConfig.formulaConfigs || [],
    aggregatedResults: resultsInDisplayUnit,
    projectId: data.projectId,
  });

  const seriesBreakdown: Array<MetricSeriesResult> | undefined =
    groupByAttributeKeys.length > 0
      ? buildSeriesBreakdown({
          queryConfigs: dockerMonitorConfig.metricViewConfig.queryConfigs,
          formulaConfigs:
            dockerMonitorConfig.metricViewConfig.formulaConfigs || [],
          perQueryResults: resultsInDisplayUnit,
          attributeKeys: groupByAttributeKeys,
          projectId: data.projectId,
        })
      : undefined;

  return {
    projectId: data.projectId,
    metricViewConfig: dockerMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    dataCompleteFrom: dataCompleteFrom,
    metricResult: resultsWithFormulas,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    nativeUnitsByMetricName: buildNativeUnitsByMetricName({
      monitorType: MonitorType.Docker,
      queryConfigs: dockerMonitorConfig.metricViewConfig.queryConfigs,
      declaredUnitsByMetricName: nativeUnitsByMetricName,
    }),
  };
};

type MonitorHostFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

export const monitorHost: MonitorHostFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<MetricMonitorResponse> => {
  const hostMonitorConfig: MonitorStepHostMonitor | undefined =
    data.monitorStep.data?.hostMonitor;

  if (!hostMonitorConfig) {
    throw new BadDataException("Host monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      hostMonitorConfig.rollingTime || RollingTime.Past1Minute,
      data.evaluateUntil,
    );

  const finalResult: Array<AggregatedResult> = [];

  // Where a read was cut at its row limit - see getCutReadCompleteFrom.
  let dataCompleteFrom: Date | undefined = undefined;

  const groupByAttributeKeys: Array<string> = collectGroupByAttributeKeys(
    hostMonitorConfig.metricViewConfig.queryConfigs,
  );

  for (const queryConfig of hostMonitorConfig.metricViewConfig.queryConfigs) {
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

    /*
     * Scope by host only. Host system.* metrics are host-level, so there is
     * no container.runtime / container.name / container.image filter — unlike
     * the Docker monitor which scopes containers on the host.
     */
    if (hostMonitorConfig.hostIdentifier) {
      attributes["resource.host.name"] = hostMonitorConfig.hostIdentifier;
    }

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    const dataPoints: QueryDataPoints = await readQueryDataPoints({
      query: query,
      aggregationType: aggregationType,
      groupByAttributeKeys: groupByAttributeKeys,
      groupBy: queryConfig.metricQueryData.groupBy,
      startAndEndDate: startAndEndDate,
    });

    const aggregatedResults: AggregatedResult = dataPoints.aggregatedResult;

    dataCompleteFrom = getLaterDate(dataCompleteFrom, dataPoints.completeFrom);

    logger.debug("Host monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: hostMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
    });

  const resultsInDisplayUnit: Array<AggregatedResult> =
    MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
      queryConfigs: hostMonitorConfig.metricViewConfig.queryConfigs,
      results: finalResult,
      nativeUnitByMetricName: nativeUnitsByMetricName,
    });

  const resultsWithFormulas: Array<AggregatedResult> = appendFormulaResults({
    queryConfigs: hostMonitorConfig.metricViewConfig.queryConfigs,
    formulaConfigs: hostMonitorConfig.metricViewConfig.formulaConfigs || [],
    aggregatedResults: resultsInDisplayUnit,
    projectId: data.projectId,
  });

  let seriesBreakdown: Array<MetricSeriesResult> | undefined =
    groupByAttributeKeys.length > 0
      ? buildSeriesBreakdown({
          queryConfigs: hostMonitorConfig.metricViewConfig.queryConfigs,
          formulaConfigs:
            hostMonitorConfig.metricViewConfig.formulaConfigs || [],
          perQueryResults: resultsInDisplayUnit,
          attributeKeys: groupByAttributeKeys,
          projectId: data.projectId,
        })
      : undefined;

  /*
   * Seed synthetic "no data" series for expected hosts that went silent, so
   * a fleet-wide host-grouped monitor detects an individual host going down
   * (see injectExpectedAbsentHostSeries). Skipped when the monitor is scoped
   * to a single host via hostIdentifier: that scoping lives on the local
   * query attributes (not queryConfig.filterData), so the generic subset
   * guard can't see it, and a single-host monitor already down-detects its
   * one host via the empty-window monitor-level no-data trigger.
   */
  if (!hostMonitorConfig.hostIdentifier) {
    seriesBreakdown = await injectExpectedAbsentHostSeries({
      monitorStep: data.monitorStep,
      seriesBreakdown,
      groupByAttributeKeys,
      queryConfigs: hostMonitorConfig.metricViewConfig.queryConfigs,
      formulaConfigs: hostMonitorConfig.metricViewConfig.formulaConfigs || [],
      projectId: data.projectId,
    });
  }

  return {
    projectId: data.projectId,
    metricViewConfig: hostMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    dataCompleteFrom: dataCompleteFrom,
    metricResult: resultsWithFormulas,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    nativeUnitsByMetricName: buildNativeUnitsByMetricName({
      monitorType: MonitorType.Host,
      queryConfigs: hostMonitorConfig.metricViewConfig.queryConfigs,
      declaredUnitsByMetricName: nativeUnitsByMetricName,
    }),
  };
};

type MonitorPodmanFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

export const monitorPodman: MonitorPodmanFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<MetricMonitorResponse> => {
  const podmanMonitorConfig: MonitorStepPodmanMonitor | undefined =
    data.monitorStep.data?.podmanMonitor;

  if (!podmanMonitorConfig) {
    throw new BadDataException("Podman monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      podmanMonitorConfig.rollingTime || RollingTime.Past1Minute,
      data.evaluateUntil,
    );

  const finalResult: Array<AggregatedResult> = [];

  // Where a read was cut at its row limit - see getCutReadCompleteFrom.
  let dataCompleteFrom: Date | undefined = undefined;

  const groupByAttributeKeys: Array<string> = collectGroupByAttributeKeys(
    podmanMonitorConfig.metricViewConfig.queryConfigs,
  );

  for (const queryConfig of podmanMonitorConfig.metricViewConfig.queryConfigs) {
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

    // Add Podman-specific attribute filters
    if (podmanMonitorConfig.hostIdentifier) {
      attributes["resource.host.name"] = podmanMonitorConfig.hostIdentifier;
    }

    // Always filter by Podman runtime
    attributes["resource.container.runtime"] = "podman";

    if (podmanMonitorConfig.containerFilters) {
      const containerFilters: PodmanContainerFilters =
        podmanMonitorConfig.containerFilters;

      if (containerFilters.containerName) {
        attributes["resource.container.name"] = containerFilters.containerName;
      }

      if (containerFilters.containerImage) {
        attributes["resource.container.image.name"] =
          containerFilters.containerImage;
      }
    }

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    const dataPoints: QueryDataPoints = await readQueryDataPoints({
      query: query,
      aggregationType: aggregationType,
      groupByAttributeKeys: groupByAttributeKeys,
      groupBy: queryConfig.metricQueryData.groupBy,
      startAndEndDate: startAndEndDate,
    });

    const aggregatedResults: AggregatedResult = dataPoints.aggregatedResult;

    dataCompleteFrom = getLaterDate(dataCompleteFrom, dataPoints.completeFrom);

    logger.debug("Podman monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: podmanMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
    });

  const resultsInDisplayUnit: Array<AggregatedResult> =
    MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
      queryConfigs: podmanMonitorConfig.metricViewConfig.queryConfigs,
      results: finalResult,
      nativeUnitByMetricName: nativeUnitsByMetricName,
    });

  const resultsWithFormulas: Array<AggregatedResult> = appendFormulaResults({
    queryConfigs: podmanMonitorConfig.metricViewConfig.queryConfigs,
    formulaConfigs: podmanMonitorConfig.metricViewConfig.formulaConfigs || [],
    aggregatedResults: resultsInDisplayUnit,
    projectId: data.projectId,
  });

  const seriesBreakdown: Array<MetricSeriesResult> | undefined =
    groupByAttributeKeys.length > 0
      ? buildSeriesBreakdown({
          queryConfigs: podmanMonitorConfig.metricViewConfig.queryConfigs,
          formulaConfigs:
            podmanMonitorConfig.metricViewConfig.formulaConfigs || [],
          perQueryResults: resultsInDisplayUnit,
          attributeKeys: groupByAttributeKeys,
          projectId: data.projectId,
        })
      : undefined;

  return {
    projectId: data.projectId,
    metricViewConfig: podmanMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    dataCompleteFrom: dataCompleteFrom,
    metricResult: resultsWithFormulas,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    nativeUnitsByMetricName: buildNativeUnitsByMetricName({
      monitorType: MonitorType.Podman,
      queryConfigs: podmanMonitorConfig.metricViewConfig.queryConfigs,
      declaredUnitsByMetricName: nativeUnitsByMetricName,
    }),
  };
};

type MonitorProxmoxFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

export const monitorProxmox: MonitorProxmoxFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<MetricMonitorResponse> => {
  const proxmoxMonitorConfig: MonitorStepProxmoxMonitor | undefined =
    data.monitorStep.data?.proxmoxMonitor;

  if (!proxmoxMonitorConfig) {
    throw new BadDataException("Proxmox monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      proxmoxMonitorConfig.rollingTime || RollingTime.Past1Minute,
      data.evaluateUntil,
    );

  const finalResult: Array<AggregatedResult> = [];

  // Where a read was cut at its row limit - see getCutReadCompleteFrom.
  let dataCompleteFrom: Date | undefined = undefined;

  // One breakdown per query, in query order — see monitorKubernetes.
  const proxmoxResourceBreakdowns: Array<ProxmoxResourceBreakdown> = [];

  const groupByAttributeKeys: Array<string> = collectGroupByAttributeKeys(
    proxmoxMonitorConfig.metricViewConfig.queryConfigs,
  );

  for (const queryConfig of proxmoxMonitorConfig.metricViewConfig
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

    /*
     * Always scope to the cluster via the `proxmox.cluster.name`
     * resource attribute the Proxmox Agent stamps on every batch.
     */
    if (proxmoxMonitorConfig.clusterIdentifier) {
      attributes["resource.proxmox.cluster.name"] =
        proxmoxMonitorConfig.clusterIdentifier;
    }

    /*
     * Proxmox-specific resource filters. pve-exporter keeps resource
     * identity in datapoint labels (stored unprefixed): every metric
     * carries an `id` label (`node/pve1`, `qemu/100`, `lxc/101`,
     * `storage/local`) which the agent's OTTL transform splits into the
     * `pve.scope` / `pve.type` / `pve.id` datapoint attributes. The
     * `name` label only exists on the pve_*_info metadata series, so
     * filters never target it. guestId (an exact raw `id` value) wins
     * over the other filters; nodeName scopes to the node's OWN series
     * via pve.scope + pve.id equality (for nodes, pve.id IS the node
     * name).
     */
    if (proxmoxMonitorConfig.resourceFilters) {
      const resourceFilters: ProxmoxResourceFilters =
        proxmoxMonitorConfig.resourceFilters;

      if (resourceFilters.guestId) {
        attributes["id"] = resourceFilters.guestId;
      } else if (resourceFilters.nodeName) {
        attributes["pve.scope"] = ProxmoxResourceScope.Node;
        attributes["pve.id"] = resourceFilters.nodeName;
      } else {
        if (resourceFilters.scope) {
          attributes["pve.scope"] = resourceFilters.scope;
        }

        if (resourceFilters.pveId) {
          attributes["pve.id"] = resourceFilters.pveId;
        }
      }
    }

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    const dataPoints: QueryDataPoints = await readQueryDataPoints({
      query: query,
      aggregationType: aggregationType,
      groupByAttributeKeys: groupByAttributeKeys,
      groupBy: queryConfig.metricQueryData.groupBy,
      startAndEndDate: startAndEndDate,
    });

    const aggregatedResults: AggregatedResult = dataPoints.aggregatedResult;

    dataCompleteFrom = getLaterDate(dataCompleteFrom, dataPoints.completeFrom);

    logger.debug("Proxmox monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);

    // Fetch raw metrics to extract per-resource Proxmox context
    const affectedResources: Array<ProxmoxAffectedResource> | undefined =
      await scanAffectedResources({
        query: query,
        projectId: data.projectId,
        platformName: "Proxmox",
        getIdentity: PlatformResourceIdentity.proxmox,
        getIdentityKey: PlatformResourceIdentity.proxmoxKey,
      });

    if (affectedResources) {
      proxmoxResourceBreakdowns.push({
        clusterName: proxmoxMonitorConfig.clusterIdentifier,
        metricName: metricName,
        metricFriendlyName:
          getProxmoxMetricByMetricName(metricName)?.friendlyName || metricName,
        affectedResources: affectedResources,
        attributes: attributes,
        metricAlias: queryConfig.metricAliasData?.metricVariable,
      });
    }
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: proxmoxMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
    });

  const unitsByMetricName: Dictionary<string> = buildNativeUnitsByMetricName({
    monitorType: MonitorType.Proxmox,
    queryConfigs: proxmoxMonitorConfig.metricViewConfig.queryConfigs,
    declaredUnitsByMetricName: nativeUnitsByMetricName,
  });

  tagBreakdownsWithMetricUnit({
    breakdowns: proxmoxResourceBreakdowns,
    unitsByMetricName: unitsByMetricName,
  });

  const resultsInDisplayUnit: Array<AggregatedResult> =
    MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
      queryConfigs: proxmoxMonitorConfig.metricViewConfig.queryConfigs,
      results: finalResult,
      nativeUnitByMetricName: nativeUnitsByMetricName,
    });

  const resultsWithFormulas: Array<AggregatedResult> = appendFormulaResults({
    queryConfigs: proxmoxMonitorConfig.metricViewConfig.queryConfigs,
    formulaConfigs: proxmoxMonitorConfig.metricViewConfig.formulaConfigs || [],
    aggregatedResults: resultsInDisplayUnit,
    projectId: data.projectId,
  });

  const seriesBreakdown: Array<MetricSeriesResult> | undefined =
    groupByAttributeKeys.length > 0
      ? buildSeriesBreakdown({
          queryConfigs: proxmoxMonitorConfig.metricViewConfig.queryConfigs,
          formulaConfigs:
            proxmoxMonitorConfig.metricViewConfig.formulaConfigs || [],
          perQueryResults: resultsInDisplayUnit,
          attributeKeys: groupByAttributeKeys,
          projectId: data.projectId,
        })
      : undefined;

  return {
    projectId: data.projectId,
    metricViewConfig: proxmoxMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    dataCompleteFrom: dataCompleteFrom,
    metricResult: resultsWithFormulas,
    proxmoxResourceBreakdowns:
      proxmoxResourceBreakdowns.length > 0
        ? proxmoxResourceBreakdowns
        : undefined,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    nativeUnitsByMetricName: unitsByMetricName,
  };
};

type MonitorVMwareFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

/*
 * Map a VMware monitor step's resource filters onto the ClickHouse
 * attribute equalities the query runs with. The OpenTelemetry Collector
 * `vcenter` receiver stamps a vSphere object's identity as OTel RESOURCE
 * attributes (one OTLP resource per datacenter / cluster / host / VM /
 * datastore / resource pool), which OtelMetricsIngestService stores
 * `resource.`-prefixed — so, unlike pve-exporter's bare datapoint
 * labels, every key here carries the `resource.` prefix. The filters are
 * independent equalities (a host filter narrows to that ESXi host's own
 * series AND to the series of every VM it runs, because the receiver
 * stamps the parent host on VM resources; add `vmName` to target one VM).
 *
 * Exported for the worker test; the step-config identity path
 * (MonitorStepResourceIdentity) and the root-cause renderer
 * (MonitorCriteriaEvaluator.buildVMwareRootCauseContext) surface the
 * same fields, so the three cannot drift apart.
 */
export const VMwareResourceFilterAttributeKeys: Record<
  keyof VMwareResourceFilters,
  string
> = {
  datacenterName: "resource.vcenter.datacenter.name",
  clusterName: "resource.vcenter.cluster.name",
  hostName: "resource.vcenter.host.name",
  vmName: "resource.vcenter.vm.name",
  datastoreName: "resource.vcenter.datastore.name",
  resourcePoolPath: "resource.vcenter.resource_pool.inventory_path",
};

export const applyVMwareResourceFilters: (input: {
  attributes: Dictionary<string>;
  resourceFilters: VMwareResourceFilters | undefined;
}) => void = (input: {
  attributes: Dictionary<string>;
  resourceFilters: VMwareResourceFilters | undefined;
}): void => {
  if (!input.resourceFilters) {
    return;
  }

  for (const filterKey of Object.keys(
    VMwareResourceFilterAttributeKeys,
  ) as Array<keyof VMwareResourceFilters>) {
    const filterValue: unknown = input.resourceFilters[filterKey];

    /*
     * `typeof` rather than truthiness: step JSON is not schema-checked,
     * so a filter written by the API or an import can be a number or an
     * object, and neither is an attribute equality ClickHouse can run.
     */
    if (typeof filterValue !== "string") {
      continue;
    }

    const trimmed: string = filterValue.trim();

    if (trimmed.length === 0) {
      continue;
    }

    input.attributes[VMwareResourceFilterAttributeKeys[filterKey]] = trimmed;
  }
};

export const monitorVMware: MonitorVMwareFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<MetricMonitorResponse> => {
  const vmwareMonitorConfig: MonitorStepVMwareMonitor | undefined =
    data.monitorStep.data?.vmwareMonitor;

  if (!vmwareMonitorConfig) {
    throw new BadDataException("VMware monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      vmwareMonitorConfig.rollingTime || RollingTime.Past1Minute,
      data.evaluateUntil,
    );

  const finalResult: Array<AggregatedResult> = [];

  // Where a read was cut at its row limit - see getCutReadCompleteFrom.
  let dataCompleteFrom: Date | undefined = undefined;

  // One breakdown per query, in query order — see monitorKubernetes.
  const vmwareResourceBreakdowns: Array<VMwareResourceBreakdown> = [];

  const groupByAttributeKeys: Array<string> = collectGroupByAttributeKeys(
    vmwareMonitorConfig.metricViewConfig.queryConfigs,
  );

  for (const queryConfig of vmwareMonitorConfig.metricViewConfig.queryConfigs) {
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

    /*
     * Always scope to the vCenter via the `vmware.vcenter.name` resource
     * attribute the VMware Agent stamps on every batch (one value per
     * vCenter Server or standalone ESXi host the agent connects to).
     * This is what keeps two vCenters that both have a host called
     * `esx-01` from bleeding into each other's monitors.
     */
    if (vmwareMonitorConfig.vcenterIdentifier) {
      attributes["resource.vmware.vcenter.name"] =
        vmwareMonitorConfig.vcenterIdentifier;
    }

    applyVMwareResourceFilters({
      attributes: attributes,
      resourceFilters: vmwareMonitorConfig.resourceFilters,
    });

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    const dataPoints: QueryDataPoints = await readQueryDataPoints({
      query: query,
      aggregationType: aggregationType,
      groupByAttributeKeys: groupByAttributeKeys,
      groupBy: queryConfig.metricQueryData.groupBy,
      startAndEndDate: startAndEndDate,
    });

    const aggregatedResults: AggregatedResult = dataPoints.aggregatedResult;

    dataCompleteFrom = getLaterDate(dataCompleteFrom, dataPoints.completeFrom);

    logger.debug("VMware monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);

    /*
     * Fetch raw metrics to extract per-object vSphere context. Best
     * effort: a failure here is logged and the evaluation carries on
     * without the Affected Resources list — it must never fail the monitor.
     */
    const affectedResources: Array<VMwareAffectedResource> | undefined =
      await scanAffectedResources({
        query: query,
        projectId: data.projectId,
        platformName: "VMware",
        getIdentity: PlatformResourceIdentity.vmware,
        getIdentityKey: PlatformResourceIdentity.vmwareKey,
      });

    if (affectedResources) {
      vmwareResourceBreakdowns.push({
        vcenterName: vmwareMonitorConfig.vcenterIdentifier,
        metricName: metricName,
        metricFriendlyName:
          getVMwareMetricByMetricName(metricName)?.friendlyName || metricName,
        affectedResources: affectedResources,
        attributes: attributes,
        metricAlias: queryConfig.metricAliasData?.metricVariable,
      });
    }
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: vmwareMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
    });

  const unitsByMetricName: Dictionary<string> = buildNativeUnitsByMetricName({
    monitorType: MonitorType.VMware,
    queryConfigs: vmwareMonitorConfig.metricViewConfig.queryConfigs,
    declaredUnitsByMetricName: nativeUnitsByMetricName,
  });

  tagBreakdownsWithMetricUnit({
    breakdowns: vmwareResourceBreakdowns,
    unitsByMetricName: unitsByMetricName,
  });

  const resultsInDisplayUnit: Array<AggregatedResult> =
    MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
      queryConfigs: vmwareMonitorConfig.metricViewConfig.queryConfigs,
      results: finalResult,
      nativeUnitByMetricName: nativeUnitsByMetricName,
    });

  const resultsWithFormulas: Array<AggregatedResult> = appendFormulaResults({
    queryConfigs: vmwareMonitorConfig.metricViewConfig.queryConfigs,
    formulaConfigs: vmwareMonitorConfig.metricViewConfig.formulaConfigs || [],
    aggregatedResults: resultsInDisplayUnit,
    projectId: data.projectId,
  });

  const seriesBreakdown: Array<MetricSeriesResult> | undefined =
    groupByAttributeKeys.length > 0
      ? buildSeriesBreakdown({
          queryConfigs: vmwareMonitorConfig.metricViewConfig.queryConfigs,
          formulaConfigs:
            vmwareMonitorConfig.metricViewConfig.formulaConfigs || [],
          perQueryResults: resultsInDisplayUnit,
          attributeKeys: groupByAttributeKeys,
          projectId: data.projectId,
        })
      : undefined;

  return {
    projectId: data.projectId,
    metricViewConfig: vmwareMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    dataCompleteFrom: dataCompleteFrom,
    metricResult: resultsWithFormulas,
    vmwareResourceBreakdowns:
      vmwareResourceBreakdowns.length > 0
        ? vmwareResourceBreakdowns
        : undefined,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    nativeUnitsByMetricName: unitsByMetricName,
  };
};

type MonitorIoTFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

export const monitorIoT: MonitorIoTFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<MetricMonitorResponse> => {
  const iotMonitorConfig: MonitorStepIoTMonitor | undefined =
    data.monitorStep.data?.iotMonitor;

  if (!iotMonitorConfig) {
    throw new BadDataException("IoT monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      iotMonitorConfig.rollingTime || RollingTime.Past1Minute,
      data.evaluateUntil,
    );

  const finalResult: Array<AggregatedResult> = [];

  // Where a read was cut at its row limit - see getCutReadCompleteFrom.
  let dataCompleteFrom: Date | undefined = undefined;

  const groupByAttributeKeys: Array<string> = collectGroupByAttributeKeys(
    iotMonitorConfig.metricViewConfig.queryConfigs,
  );

  for (const queryConfig of iotMonitorConfig.metricViewConfig.queryConfigs) {
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

    /*
     * Always scope to the fleet via the `iot.fleet.name` resource
     * attribute the IoT agent / gateway stamps on every batch.
     */
    if (iotMonitorConfig.fleetIdentifier) {
      attributes["resource.iot.fleet.name"] = iotMonitorConfig.fleetIdentifier;
    }

    /*
     * IoT-specific resource filters. Device-level data metrics carry a
     * `device.id` datapoint label and, when the device sends it, an
     * `iot.device.type` datapoint attribute (stored unprefixed). The
     * deviceId filter pins an exact device; deviceType narrows to a class
     * of devices.
     *
     * A saved Resource Scope is read and ignored: it matched an `iot.scope`
     * attribute nothing stamps (MQTT and OTLP ingest add `device.id` and
     * the device's own attributes only), and the form set it to Device on
     * every metric picked - so every such monitor read no data at all.
     */
    if (iotMonitorConfig.resourceFilters) {
      const resourceFilters: IoTDeviceFilters =
        iotMonitorConfig.resourceFilters;

      if (resourceFilters.deviceId) {
        attributes["device.id"] = resourceFilters.deviceId;
      }

      if (resourceFilters.deviceType) {
        attributes["iot.device.type"] = resourceFilters.deviceType;
      }
    }

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    const dataPoints: QueryDataPoints = await readQueryDataPoints({
      query: query,
      aggregationType: aggregationType,
      groupByAttributeKeys: groupByAttributeKeys,
      groupBy: queryConfig.metricQueryData.groupBy,
      startAndEndDate: startAndEndDate,
    });

    const aggregatedResults: AggregatedResult = dataPoints.aggregatedResult;

    dataCompleteFrom = getLaterDate(dataCompleteFrom, dataPoints.completeFrom);

    logger.debug("IoT monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: iotMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
    });

  const resultsInDisplayUnit: Array<AggregatedResult> =
    MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
      queryConfigs: iotMonitorConfig.metricViewConfig.queryConfigs,
      results: finalResult,
      nativeUnitByMetricName: nativeUnitsByMetricName,
    });

  const resultsWithFormulas: Array<AggregatedResult> = appendFormulaResults({
    queryConfigs: iotMonitorConfig.metricViewConfig.queryConfigs,
    formulaConfigs: iotMonitorConfig.metricViewConfig.formulaConfigs || [],
    aggregatedResults: resultsInDisplayUnit,
    projectId: data.projectId,
  });

  let seriesBreakdown: Array<MetricSeriesResult> | undefined =
    groupByAttributeKeys.length > 0
      ? buildSeriesBreakdown({
          queryConfigs: iotMonitorConfig.metricViewConfig.queryConfigs,
          formulaConfigs:
            iotMonitorConfig.metricViewConfig.formulaConfigs || [],
          perQueryResults: resultsInDisplayUnit,
          attributeKeys: groupByAttributeKeys,
          projectId: data.projectId,
        })
      : undefined;

  /*
   * Seed synthetic "no data" series for REGISTERED devices that went
   * silent, so a per-device-grouped IoT monitor detects an individual
   * device going dark (see injectExpectedAbsentIoTDeviceSeries).
   * Skipped when resourceFilters scope the query to a device subset:
   * those filters live on the local query attributes (not
   * queryConfig.filterData), so the generic subset guard can't see
   * them, and injecting the full registry would over-report absences
   * for out-of-scope devices.
   */
  if (
    iotMonitorConfig.fleetIdentifier &&
    !iotMonitorConfig.resourceFilters?.deviceId &&
    !iotMonitorConfig.resourceFilters?.deviceType
  ) {
    seriesBreakdown = await injectExpectedAbsentIoTDeviceSeries({
      monitorStep: data.monitorStep,
      seriesBreakdown,
      groupByAttributeKeys,
      queryConfigs: iotMonitorConfig.metricViewConfig.queryConfigs,
      formulaConfigs: iotMonitorConfig.metricViewConfig.formulaConfigs || [],
      projectId: data.projectId,
      fleetIdentifier: iotMonitorConfig.fleetIdentifier,
    });
  }

  return {
    projectId: data.projectId,
    metricViewConfig: iotMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    dataCompleteFrom: dataCompleteFrom,
    metricResult: resultsWithFormulas,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    nativeUnitsByMetricName: buildNativeUnitsByMetricName({
      monitorType: MonitorType.IoTDevice,
      queryConfigs: iotMonitorConfig.metricViewConfig.queryConfigs,
      declaredUnitsByMetricName: nativeUnitsByMetricName,
    }),
  };
};

type MonitorDockerSwarmFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

export const monitorDockerSwarm: MonitorDockerSwarmFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<MetricMonitorResponse> => {
  const dockerSwarmMonitorConfig: MonitorStepDockerSwarmMonitor | undefined =
    data.monitorStep.data?.dockerSwarmMonitor;

  if (!dockerSwarmMonitorConfig) {
    throw new BadDataException("Docker Swarm monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      dockerSwarmMonitorConfig.rollingTime || RollingTime.Past1Minute,
      data.evaluateUntil,
    );

  const finalResult: Array<AggregatedResult> = [];

  // Where a read was cut at its row limit - see getCutReadCompleteFrom.
  let dataCompleteFrom: Date | undefined = undefined;

  // One breakdown per query, in query order — see monitorKubernetes.
  const dockerSwarmResourceBreakdowns: Array<DockerSwarmResourceBreakdown> = [];

  const groupByAttributeKeys: Array<string> = collectGroupByAttributeKeys(
    dockerSwarmMonitorConfig.metricViewConfig.queryConfigs,
  );

  for (const queryConfig of dockerSwarmMonitorConfig.metricViewConfig
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

    /*
     * Always scope to the cluster via the `docker.swarm.cluster.name`
     * RESOURCE attribute the OneUptime Docker Swarm Agent stamps on every
     * batch (stored `resource.`-prefixed in ClickHouse). There is
     * deliberately no `container.runtime` or `host.name` filter: the
     * docker_stats receiver stamps `container.runtime=docker` on a Swarm
     * task's metrics just as on a Docker host's, and the agent never stamps
     * `host.name`, so the cluster name is what tells a Swarm's containers
     * apart.
     */
    if (dockerSwarmMonitorConfig.clusterIdentifier) {
      attributes["resource.docker.swarm.cluster.name"] =
        dockerSwarmMonitorConfig.clusterIdentifier;
    }

    /*
     * Docker Swarm resource filters, all on RESOURCE attributes, which
     * ClickHouse stores `resource.`-prefixed (MonitorStepDockerSwarmMonitor
     * has the whole contract):
     *  - `resource.container.name` (a Swarm task's container is
     *    `<service>.<slot>.<taskid>`) and `resource.container.image.name`,
     *    the container identity the docker_stats receiver carries -- the
     *    same spelling the Docker and Podman paths above use for the same
     *    receiver, the one the templates group by, and the one
     *    OtelMetricsIngestService reads back in bufferDockerSwarmTaskMetric;
     *  - `resource.docker.swarm.service.name`, Swarm's service label on the
     *    task's container, which the agent copies onto its metrics;
     *  - `resource.docker.swarm.node.name`, the node's name the agent stamps.
     * The image matches with or without the digest Swarm pins a task's
     * image to, so it is a Wildcard on the query and stays the typed text
     * in `attributes`, which the breakdown below reports as the filters.
     */
    let containerImageGlobs: Array<string> = [];

    if (dockerSwarmMonitorConfig.resourceFilters) {
      const resourceFilters: DockerSwarmResourceFilters =
        dockerSwarmMonitorConfig.resourceFilters;

      if (resourceFilters.containerName) {
        attributes["resource.container.name"] = resourceFilters.containerName;
      }

      if (resourceFilters.containerImage) {
        containerImageGlobs =
          MonitorStepDockerSwarmMonitorUtil.getContainerImageGlobs(
            resourceFilters.containerImage,
          );

        if (containerImageGlobs.length > 0) {
          attributes["resource.container.image.name"] =
            resourceFilters.containerImage;
        }
      }

      if (resourceFilters.nodeName) {
        attributes["resource.docker.swarm.node.name"] =
          resourceFilters.nodeName;
      }

      if (resourceFilters.serviceName) {
        attributes["resource.docker.swarm.service.name"] =
          resourceFilters.serviceName;
      }
    }

    if (Object.keys(attributes).length > 0) {
      query.attributes =
        containerImageGlobs.length > 0
          ? {
              ...attributes,
              "resource.container.image.name": new Wildcard<string>(
                containerImageGlobs,
              ),
            }
          : attributes;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    const dataPoints: QueryDataPoints = await readQueryDataPoints({
      query: query,
      aggregationType: aggregationType,
      groupByAttributeKeys: groupByAttributeKeys,
      groupBy: queryConfig.metricQueryData.groupBy,
      startAndEndDate: startAndEndDate,
    });

    const aggregatedResults: AggregatedResult = dataPoints.aggregatedResult;

    dataCompleteFrom = getLaterDate(dataCompleteFrom, dataPoints.completeFrom);

    logger.debug("Docker Swarm monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);

    /*
     * Fetch raw metrics to extract per-resource Docker Swarm context.
     * PlatformResourceIdentity.dockerSwarm reads the container identity
     * `resource.`-prefixed, for the same reason as the filter above.
     * Reading the bare key returned undefined for every row, which
     * collapsed the whole "Affected Tasks" breakdown into one anonymous
     * entry keyed "|||" and made MonitorCriteriaEvaluator suppress the
     * Affected Tasks list entirely (hasIdentity was false).
     */
    const affectedResources: Array<DockerSwarmAffectedResource> | undefined =
      await scanAffectedResources({
        query: query,
        projectId: data.projectId,
        platformName: "Docker Swarm",
        getIdentity: PlatformResourceIdentity.dockerSwarm,
        getIdentityKey: PlatformResourceIdentity.dockerSwarmKey,
      });

    if (affectedResources) {
      dockerSwarmResourceBreakdowns.push({
        clusterName: dockerSwarmMonitorConfig.clusterIdentifier,
        metricName: metricName,
        metricFriendlyName:
          getDockerSwarmMetricByMetricName(metricName)?.friendlyName ||
          metricName,
        affectedResources: affectedResources,
        attributes: attributes,
        metricAlias: queryConfig.metricAliasData?.metricVariable,
      });
    }
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: dockerSwarmMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
    });

  const unitsByMetricName: Dictionary<string> = buildNativeUnitsByMetricName({
    monitorType: MonitorType.DockerSwarm,
    queryConfigs: dockerSwarmMonitorConfig.metricViewConfig.queryConfigs,
    declaredUnitsByMetricName: nativeUnitsByMetricName,
  });

  tagBreakdownsWithMetricUnit({
    breakdowns: dockerSwarmResourceBreakdowns,
    unitsByMetricName: unitsByMetricName,
  });

  const resultsInDisplayUnit: Array<AggregatedResult> =
    MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
      queryConfigs: dockerSwarmMonitorConfig.metricViewConfig.queryConfigs,
      results: finalResult,
      nativeUnitByMetricName: nativeUnitsByMetricName,
    });

  const resultsWithFormulas: Array<AggregatedResult> = appendFormulaResults({
    queryConfigs: dockerSwarmMonitorConfig.metricViewConfig.queryConfigs,
    formulaConfigs:
      dockerSwarmMonitorConfig.metricViewConfig.formulaConfigs || [],
    aggregatedResults: resultsInDisplayUnit,
    projectId: data.projectId,
  });

  const seriesBreakdown: Array<MetricSeriesResult> | undefined =
    groupByAttributeKeys.length > 0
      ? buildSeriesBreakdown({
          queryConfigs: dockerSwarmMonitorConfig.metricViewConfig.queryConfigs,
          formulaConfigs:
            dockerSwarmMonitorConfig.metricViewConfig.formulaConfigs || [],
          perQueryResults: resultsInDisplayUnit,
          attributeKeys: groupByAttributeKeys,
          projectId: data.projectId,
        })
      : undefined;

  return {
    projectId: data.projectId,
    metricViewConfig: dockerSwarmMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    dataCompleteFrom: dataCompleteFrom,
    metricResult: resultsWithFormulas,
    dockerSwarmResourceBreakdowns:
      dockerSwarmResourceBreakdowns.length > 0
        ? dockerSwarmResourceBreakdowns
        : undefined,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    nativeUnitsByMetricName: unitsByMetricName,
  };
};

type MonitorCephFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

export const monitorCeph: MonitorCephFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<MetricMonitorResponse> => {
  const cephMonitorConfig: MonitorStepCephMonitor | undefined =
    data.monitorStep.data?.cephMonitor;

  if (!cephMonitorConfig) {
    throw new BadDataException("Ceph monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      cephMonitorConfig.rollingTime || RollingTime.Past1Minute,
      data.evaluateUntil,
    );

  const finalResult: Array<AggregatedResult> = [];

  // Where a read was cut at its row limit - see getCutReadCompleteFrom.
  let dataCompleteFrom: Date | undefined = undefined;

  // One breakdown per query, in query order — see monitorKubernetes.
  const cephResourceBreakdowns: Array<CephResourceBreakdown> = [];

  const groupByAttributeKeys: Array<string> = collectGroupByAttributeKeys(
    cephMonitorConfig.metricViewConfig.queryConfigs,
  );

  for (const queryConfig of cephMonitorConfig.metricViewConfig.queryConfigs) {
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

    /*
     * Always scope to the cluster via the `ceph.cluster.name`
     * resource attribute the Ceph Agent stamps on every batch.
     */
    if (cephMonitorConfig.clusterIdentifier) {
      attributes["resource.ceph.cluster.name"] =
        cephMonitorConfig.clusterIdentifier;
    }

    /*
     * Ceph-specific resource filters. The mgr prometheus module keeps
     * daemon / pool identity in datapoint labels (stored unprefixed):
     * `ceph_daemon` (e.g. "osd.3", "mon.a") on daemon metrics and
     * `pool_id` on pool data series. The pool name exists only on the
     * ceph_pool_metadata series, so it is never an equality filter
     * here — filter by pool_id and join the metadata series when a
     * display name is needed.
     */
    if (cephMonitorConfig.resourceFilters) {
      const resourceFilters: CephResourceFilters =
        cephMonitorConfig.resourceFilters;

      if (resourceFilters.osdId) {
        attributes["ceph_daemon"] = resourceFilters.osdId;
      }

      if (resourceFilters.poolId) {
        attributes["pool_id"] = resourceFilters.poolId;
      }
    }

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    const dataPoints: QueryDataPoints = await readQueryDataPoints({
      query: query,
      aggregationType: aggregationType,
      groupByAttributeKeys: groupByAttributeKeys,
      groupBy: queryConfig.metricQueryData.groupBy,
      startAndEndDate: startAndEndDate,
    });

    const aggregatedResults: AggregatedResult = dataPoints.aggregatedResult;

    dataCompleteFrom = getLaterDate(dataCompleteFrom, dataPoints.completeFrom);

    logger.debug("Ceph monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);

    // Fetch raw metrics to extract per-resource Ceph context
    const affectedResources: Array<CephAffectedResource> | undefined =
      await scanAffectedResources({
        query: query,
        projectId: data.projectId,
        platformName: "Ceph",
        getIdentity: PlatformResourceIdentity.ceph,
        getIdentityKey: PlatformResourceIdentity.cephKey,
      });

    if (affectedResources) {
      cephResourceBreakdowns.push({
        clusterName: cephMonitorConfig.clusterIdentifier,
        metricName: metricName,
        metricFriendlyName:
          getCephMetricByMetricName(metricName)?.friendlyName || metricName,
        affectedResources: affectedResources,
        attributes: attributes,
        metricAlias: queryConfig.metricAliasData?.metricVariable,
      });
    }
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: cephMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
    });

  const unitsByMetricName: Dictionary<string> = buildNativeUnitsByMetricName({
    monitorType: MonitorType.Ceph,
    queryConfigs: cephMonitorConfig.metricViewConfig.queryConfigs,
    declaredUnitsByMetricName: nativeUnitsByMetricName,
  });

  tagBreakdownsWithMetricUnit({
    breakdowns: cephResourceBreakdowns,
    unitsByMetricName: unitsByMetricName,
  });

  const resultsInDisplayUnit: Array<AggregatedResult> =
    MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
      queryConfigs: cephMonitorConfig.metricViewConfig.queryConfigs,
      results: finalResult,
      nativeUnitByMetricName: nativeUnitsByMetricName,
    });

  const resultsWithFormulas: Array<AggregatedResult> = appendFormulaResults({
    queryConfigs: cephMonitorConfig.metricViewConfig.queryConfigs,
    formulaConfigs: cephMonitorConfig.metricViewConfig.formulaConfigs || [],
    aggregatedResults: resultsInDisplayUnit,
    projectId: data.projectId,
  });

  const seriesBreakdown: Array<MetricSeriesResult> | undefined =
    groupByAttributeKeys.length > 0
      ? buildSeriesBreakdown({
          queryConfigs: cephMonitorConfig.metricViewConfig.queryConfigs,
          formulaConfigs:
            cephMonitorConfig.metricViewConfig.formulaConfigs || [],
          perQueryResults: resultsInDisplayUnit,
          attributeKeys: groupByAttributeKeys,
          projectId: data.projectId,
        })
      : undefined;

  return {
    projectId: data.projectId,
    metricViewConfig: cephMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    dataCompleteFrom: dataCompleteFrom,
    metricResult: resultsWithFormulas,
    cephResourceBreakdowns:
      cephResourceBreakdowns.length > 0 ? cephResourceBreakdowns : undefined,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    nativeUnitsByMetricName: unitsByMetricName,
  };
};

type MonitorStorageArrayFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

/*
 * Map a Storage Array monitor step's resource filters onto the ClickHouse
 * attribute equalities the query runs with. Like ceph-mgr, Pure Storage
 * keeps object identity in DATAPOINT labels (stored unprefixed), and the
 * label differs per object and platform — a FlashArray volume or pod is
 * `name`, a host `host`, a hardware component `component_name`; every
 * FlashBlade object is `name` — so each filter resolves its label through
 * the catalog (getStorageArrayObjectLabel), with the query's metric name
 * for the few series that name their object differently (replica links
 * carry the pod as `local_pod`). Two filters that resolve to the same
 * label on one query cannot both hold; the later one in this map wins.
 *
 * Exported for the worker test; the root-cause renderer
 * (MonitorCriteriaEvaluator.buildStorageArrayRootCauseContext) surfaces the
 * same filters.
 */
export const StorageArrayResourceFilterScopes: Record<
  keyof StorageArrayResourceFilters,
  StorageArrayResourceScope
> = {
  volumeName: StorageArrayResourceScope.Volume,
  hostName: StorageArrayResourceScope.Host,
  podName: StorageArrayResourceScope.Pod,
  componentName: StorageArrayResourceScope.Hardware,
  fileSystemName: StorageArrayResourceScope.FileSystem,
  bucketName: StorageArrayResourceScope.Bucket,
};

export const applyStorageArrayResourceFilters: (input: {
  attributes: Dictionary<string>;
  resourceFilters: StorageArrayResourceFilters | undefined;
  storageSystem: string | undefined;
  metricName: string;
}) => void = (input: {
  attributes: Dictionary<string>;
  resourceFilters: StorageArrayResourceFilters | undefined;
  storageSystem: string | undefined;
  metricName: string;
}): void => {
  if (!input.resourceFilters || typeof input.resourceFilters !== "object") {
    return;
  }

  for (const filterKey of Object.keys(
    StorageArrayResourceFilterScopes,
  ) as Array<keyof StorageArrayResourceFilters>) {
    const filterValue: unknown = input.resourceFilters[filterKey];

    /*
     * `typeof` rather than truthiness: step JSON is not schema-checked,
     * so a filter written by the API or an import can be a number or an
     * object, and neither is an attribute equality ClickHouse can run.
     */
    if (typeof filterValue !== "string") {
      continue;
    }

    const trimmed: string = filterValue.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const label: string | null = getStorageArrayObjectLabel(
      StorageArrayResourceFilterScopes[filterKey],
      input.storageSystem,
      input.metricName || undefined,
    );

    if (label) {
      input.attributes[label] = trimmed;
    }
  }
};

export const monitorStorageArray: MonitorStorageArrayFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<MetricMonitorResponse> => {
  const storageArrayMonitorConfig: MonitorStepStorageArrayMonitor | undefined =
    data.monitorStep.data?.storageArrayMonitor;

  if (!storageArrayMonitorConfig) {
    throw new BadDataException("Storage Array monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      storageArrayMonitorConfig.rollingTime || RollingTime.Past1Minute,
      data.evaluateUntil,
    );

  const finalResult: Array<AggregatedResult> = [];

  // Where a read was cut at its row limit - see getCutReadCompleteFrom.
  let dataCompleteFrom: Date | undefined = undefined;

  // One breakdown per query, in query order — see monitorKubernetes.
  const storageArrayResourceBreakdowns: Array<StorageArrayResourceBreakdown> =
    [];

  const groupByAttributeKeys: Array<string> = collectGroupByAttributeKeys(
    storageArrayMonitorConfig.metricViewConfig.queryConfigs,
  );

  for (const queryConfig of storageArrayMonitorConfig.metricViewConfig
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

    /*
     * Always scope to the array via the `storage.array.name` resource
     * attribute the Storage Array Agent stamps on every batch. This is
     * what keeps two arrays that both have a volume called `vol-01` from
     * bleeding into each other's monitors.
     */
    if (storageArrayMonitorConfig.arrayIdentifier) {
      attributes["resource.storage.array.name"] =
        storageArrayMonitorConfig.arrayIdentifier;
    }

    applyStorageArrayResourceFilters({
      attributes: attributes,
      resourceFilters: storageArrayMonitorConfig.resourceFilters,
      storageSystem: storageArrayMonitorConfig.storageSystem,
      metricName: metricName,
    });

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    const dataPoints: QueryDataPoints = await readQueryDataPoints({
      query: query,
      aggregationType: aggregationType,
      groupByAttributeKeys: groupByAttributeKeys,
      groupBy: queryConfig.metricQueryData.groupBy,
      startAndEndDate: startAndEndDate,
    });

    const aggregatedResults: AggregatedResult = dataPoints.aggregatedResult;

    dataCompleteFrom = getLaterDate(dataCompleteFrom, dataPoints.completeFrom);

    logger.debug("Storage Array monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);

    // Fetch raw metrics to extract per-object storage array context
    const affectedResources: Array<StorageArrayAffectedResource> | undefined =
      await scanAffectedResources({
        query: query,
        projectId: data.projectId,
        platformName: "Storage Array",
        getIdentity: PlatformResourceIdentity.storageArray,
        getIdentityKey: PlatformResourceIdentity.storageArrayKey,
      });

    if (affectedResources) {
      storageArrayResourceBreakdowns.push({
        arrayName: storageArrayMonitorConfig.arrayIdentifier,
        metricName: metricName,
        /*
         * Pure puts read and write latency (and a dozen other figures) on
         * one metric name, told apart by the `dimension` label, so the
         * friendly name is looked up with the query's filters.
         */
        metricFriendlyName:
          getStorageArrayMetric(metricName, attributes)?.friendlyName ||
          metricName,
        affectedResources: affectedResources,
        attributes: attributes,
        metricAlias: queryConfig.metricAliasData?.metricVariable,
      });
    }
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: storageArrayMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
    });

  const unitsByMetricName: Dictionary<string> = buildNativeUnitsByMetricName({
    monitorType: MonitorType.StorageArray,
    queryConfigs: storageArrayMonitorConfig.metricViewConfig.queryConfigs,
    declaredUnitsByMetricName: nativeUnitsByMetricName,
  });

  tagBreakdownsWithMetricUnit({
    breakdowns: storageArrayResourceBreakdowns,
    unitsByMetricName: unitsByMetricName,
  });

  const resultsInDisplayUnit: Array<AggregatedResult> =
    MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
      queryConfigs: storageArrayMonitorConfig.metricViewConfig.queryConfigs,
      results: finalResult,
      nativeUnitByMetricName: nativeUnitsByMetricName,
    });

  const resultsWithFormulas: Array<AggregatedResult> = appendFormulaResults({
    queryConfigs: storageArrayMonitorConfig.metricViewConfig.queryConfigs,
    formulaConfigs:
      storageArrayMonitorConfig.metricViewConfig.formulaConfigs || [],
    aggregatedResults: resultsInDisplayUnit,
    projectId: data.projectId,
  });

  const seriesBreakdown: Array<MetricSeriesResult> | undefined =
    groupByAttributeKeys.length > 0
      ? buildSeriesBreakdown({
          queryConfigs: storageArrayMonitorConfig.metricViewConfig.queryConfigs,
          formulaConfigs:
            storageArrayMonitorConfig.metricViewConfig.formulaConfigs || [],
          perQueryResults: resultsInDisplayUnit,
          attributeKeys: groupByAttributeKeys,
          projectId: data.projectId,
        })
      : undefined;

  return {
    projectId: data.projectId,
    metricViewConfig: storageArrayMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    dataCompleteFrom: dataCompleteFrom,
    metricResult: resultsWithFormulas,
    storageArrayResourceBreakdowns:
      storageArrayResourceBreakdowns.length > 0
        ? storageArrayResourceBreakdowns
        : undefined,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    nativeUnitsByMetricName: unitsByMetricName,
  };
};

type MonitorLogsFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<LogMonitorResponse>;

export const monitorLogs: MonitorLogsFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}): Promise<LogMonitorResponse> => {
  /*
   * A telemetry monitor step created on defaults can persist its sub-config
   * as undefined: the create form only writes `logMonitor` once the user
   * edits the log-filter sub-form (the Formik onChange never fires on
   * mount). Throwing here made the queue job fail on every cycle, so
   * MonitorResourceUtil.monitorResource() never ran and the monitor's
   * status/criteria never updated — i.e. "log monitors do not work". Fall
   * back to the default config (the same last-60s, all-services query the
   * UI already previews via `logMonitor || getDefault()`) so the LogCount
   * criteria evaluates instead of erroring. This also revives monitors that
   * were already saved with an empty config, without a data migration.
   */
  const logQuery: MonitorStepLogMonitor =
    data.monitorStep.data?.logMonitor || MonitorStepLogMonitorUtil.getDefault();

  const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(
    logQuery,
    data.evaluateUntil,
  );
  query.projectId = data.projectId;

  const groupByAttributes: Array<string> =
    MonitorStepLogMonitorUtil.getGroupByAttributes(logQuery);

  if (groupByAttributes.length > 0) {
    /*
     * A monitor that names the log which resolves a group is judged on the
     * groups still open, and told which ones a log has closed.
     */
    if (MonitorStepLogMonitorUtil.isResolvedByLog(logQuery)) {
      const resolvedByQuery: Query<Log> =
        MonitorStepLogMonitorUtil.toResolvedByQuery(
          logQuery,
          data.evaluateUntil,
        );
      resolvedByQuery.projectId = data.projectId;

      return monitorUnresolvedLogGroups({
        query: query,
        resolvedByQuery: resolvedByQuery,
        groupByAttributes: groupByAttributes,
        monitorId: data.monitorId,
        projectId: data.projectId,
      });
    }

    return monitorLogGroups({
      query: query,
      groupByAttributes: groupByAttributes,
      monitorId: data.monitorId,
      projectId: data.projectId,
    });
  }

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

/*
 * The grouped half of monitorLogs: one log count per combination of the
 * step's group-by attributes' values, so the criteria can raise one alert
 * per group (per IPsec tunnel, per user, ...) instead of one per monitor.
 *
 * The busiest MaxEntitiesPerCriteria groups are kept - the same ceiling
 * the disk and interface fan-out applies, for the same reason: every
 * group is a criteria evaluation and potentially an alert. A cut is
 * logged rather than silent, because a monitor quietly covering part of
 * its groups reads exactly like one covering all of them.
 */
const monitorLogGroups: (data: {
  query: Query<Log>;
  groupByAttributes: Array<string>;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<LogMonitorResponse> = async (data: {
  query: Query<Log>;
  groupByAttributes: Array<string>;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<LogMonitorResponse> => {
  const counted: LogAttributeGroupCountResult =
    await LogService.countByAttributeGroups({
      query: data.query,
      groupByAttributes: data.groupByAttributes,
      limit: MaxEntitiesPerCriteria,
      props: {
        isRoot: true,
      },
    });

  if (counted.totalGroupCount > counted.groups.length) {
    logger.warn(
      `${data.monitorId.toString()} - Logs monitor grouped by ${data.groupByAttributes.join(
        ", ",
      )} matched ${counted.totalGroupCount} groups, which is above the ${MaxEntitiesPerCriteria} per-evaluation cap. Only the ${counted.groups.length} groups with the most logs are evaluated; narrow the monitor's filters to cover the rest.`,
      {
        service: "workers",
        projectId: data.projectId.toString(),
      },
    );
  }

  const groupBreakdown: Array<LogMonitorGroupResult> = counted.groups.map(
    (group: LogAttributeGroupCount): LogMonitorGroupResult => {
      const labels: JSONObject = {};

      data.groupByAttributes.forEach((key: string, index: number) => {
        labels[key] = group.values[index] ?? "";
      });

      return {
        fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
        labels: labels,
        logCount: group.count,
      };
    },
  );

  return {
    projectId: data.projectId,
    logCount: counted.totalCount,
    logQuery: JSONFunctions.anyObjectToJSONObject(data.query),
    monitorId: data.monitorId,
    groupByAttributes: data.groupByAttributes,
    groupBreakdown: groupBreakdown,
    totalGroupCount: counted.totalGroupCount,
  };
};

/*
 * How many resolved groups one evaluation acts on. Each is an open alert
 * or incident to close at most, never one to open, so the ceiling is far
 * above the one on breaching groups: a switch coming back brings every one
 * of its ports up in the same minute, and all of them must be resolved.
 */
export const MaxResolvedLogGroupsPerEvaluation: number = 5000;

/*
 * The grouped evaluation of a monitor whose groups are resolved by a log
 * (MonitorStepLogMonitor.resolvedByAttributes): "interface.down" per
 * interface, resolved by "interface.up".
 *
 * The breakdown holds only the groups still open - a matching log, and no
 * resolving log after it - so the criteria never alerts on a link that
 * has already come back, however recently it went down. The groups a
 * resolving log has arrived for are handed over beside it: their alerts
 * and incidents are resolved by fingerprint, and a group that is merely
 * quiet is left open (see MonitorResource).
 */
const monitorUnresolvedLogGroups: (data: {
  query: Query<Log>;
  resolvedByQuery: Query<Log>;
  groupByAttributes: Array<string>;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<LogMonitorResponse> = async (data: {
  query: Query<Log>;
  resolvedByQuery: Query<Log>;
  groupByAttributes: Array<string>;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<LogMonitorResponse> => {
  const counted: LogUnresolvedAttributeGroupResult =
    await LogService.countUnresolvedAttributeGroups({
      query: data.query,
      resolvedByQuery: data.resolvedByQuery,
      groupByAttributes: data.groupByAttributes,
      limit: MaxEntitiesPerCriteria,
      resolvedLimit: MaxResolvedLogGroupsPerEvaluation,
      props: {
        isRoot: true,
      },
    });

  if (counted.totalGroupCount > counted.groups.length) {
    logger.warn(
      `${data.monitorId.toString()} - Logs monitor grouped by ${data.groupByAttributes.join(
        ", ",
      )} matched ${counted.totalGroupCount} groups, which is above the ${MaxEntitiesPerCriteria} per-evaluation cap. Only the ${counted.groups.length} groups with the most logs are evaluated; narrow the monitor's filters to cover the rest.`,
      {
        service: "workers",
        projectId: data.projectId.toString(),
      },
    );
  }

  const toGroupResult: (
    values: Array<string>,
    logCount: number,
  ) => LogMonitorGroupResult = (
    values: Array<string>,
    logCount: number,
  ): LogMonitorGroupResult => {
    const labels: JSONObject = {};

    data.groupByAttributes.forEach((key: string, index: number) => {
      labels[key] = values[index] ?? "";
    });

    return {
      fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
      labels: labels,
      logCount: logCount,
    };
  };

  return {
    projectId: data.projectId,
    logCount: counted.totalCount,
    logQuery: JSONFunctions.anyObjectToJSONObject(data.query),
    monitorId: data.monitorId,
    groupByAttributes: data.groupByAttributes,
    groupBreakdown: counted.groups.map(
      (group: LogAttributeGroupCount): LogMonitorGroupResult => {
        return toGroupResult(group.values, group.count);
      },
    ),
    totalGroupCount: counted.totalGroupCount,
    resolvedGroups: counted.resolvedGroups.map(
      (values: Array<string>): LogMonitorGroupResult => {
        return toGroupResult(values, 0);
      },
    ),
  };
};

type MonitorSecurityEventsFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<SecurityEventsMonitorResponse>;

export const monitorSecurityEvents: MonitorSecurityEventsFunction =
  async (data: {
    monitorStep: MonitorStep;
    monitorId: ObjectID;
    projectId: ObjectID;
    evaluateUntil?: Date | undefined;
  }): Promise<SecurityEventsMonitorResponse> => {
    /*
     * Same fallback rationale as monitorLogs above: a step saved on
     * defaults can persist its sub-config as undefined, and throwing here
     * would wedge the monitor instead of evaluating the default query.
     */
    const securityEventsQueryConfig: MonitorStepSecurityEventsMonitor =
      data.monitorStep.data?.securityEventsMonitor ||
      MonitorStepSecurityEventsMonitorUtil.getDefault();

    const query: Query<SecurityEvent> =
      MonitorStepSecurityEventsMonitorUtil.toQuery(
        securityEventsQueryConfig,
        data.evaluateUntil,
      );
    query.projectId = data.projectId;

    const countEvents: PositiveNumber = await SecurityEventService.countBy({
      query: query,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return {
      projectId: data.projectId,
      securityEventCount: countEvents.toNumber(),
      securityEventQuery: JSONFunctions.anyObjectToJSONObject(query),
      monitorId: data.monitorId,
    };
  };
