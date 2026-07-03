import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import { IOT_FLEET_ROLLUP_METRIC_NAME_LIST } from "Common/Server/Utils/Telemetry/IoTSnapshotScan";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorService from "Common/Server/Services/MonitorService";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
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
  ProxmoxResourceBreakdown,
  ProxmoxAffectedResource,
  CephResourceBreakdown,
  CephAffectedResource,
  DockerSwarmResourceBreakdown,
  DockerSwarmAffectedResource,
} from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStepMetricMonitor from "Common/Types/Monitor/MonitorStepMetricMonitor";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricService, {
  MetricPerSeriesAggregationResult,
  PER_SERIES_AGGREGATION_MAX_ROWS,
} from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import { getPercentileLevel } from "Common/Types/BaseDatabase/AggregationType";
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
import ProfileMonitorResponse from "Common/Types/Monitor/ProfileMonitor/ProfileMonitorResponse";
import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
} from "Common/Types/Monitor/MonitorStepProfileMonitor";
import ProfileService from "Common/Server/Services/ProfileService";
import Profile from "Common/Models/AnalyticsModels/Profile";
import MonitorStepKubernetesMonitor, {
  KubernetesResourceFilters,
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
import MonitorStepCephMonitor, {
  CephResourceFilters,
} from "Common/Types/Monitor/MonitorStepCephMonitor";
import MonitorStepDockerSwarmMonitor, {
  DockerSwarmResourceFilters,
} from "Common/Types/Monitor/MonitorStepDockerSwarmMonitor";
import MonitorStepIoTMonitor, {
  IoTDeviceFilters,
} from "Common/Types/Monitor/MonitorStepIoTMonitor";
import {
  getKubernetesMetricByMetricName,
  KubernetesMetricDefinition,
} from "Common/Types/Monitor/KubernetesMetricCatalog";
import {
  getProxmoxMetricByMetricName,
  ProxmoxMetricDefinition,
} from "Common/Types/Monitor/ProxmoxMetricCatalog";
import {
  getCephMetricByMetricName,
  CephMetricDefinition,
} from "Common/Types/Monitor/CephMetricCatalog";
import {
  getDockerSwarmMetricByMetricName,
  DockerSwarmMetricDefinition,
} from "Common/Types/Monitor/DockerSwarmMetricCatalog";
import { JSONObject } from "Common/Types/JSON";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import TelemetryQueueService, {
  TelemetryMonitorEvaluationJobData,
} from "../../../Telemetry/Services/Queue/TelemetryQueueService";

type TelemetryMonitorResponse =
  | LogMonitorResponse
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
          MonitorType.Docker,
          MonitorType.Host,
          MonitorType.Podman,
          MonitorType.DockerSwarm,
          MonitorType.Proxmox,
          MonitorType.Ceph,
          MonitorType.IoTDevice,
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
          logger.error(err, {
            service: "workers",
            projectId: telemetryMonitor.projectId?.toString(),
          });
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

    logger.debug(`Found ${telemetryMonitors.length} telemetry monitors`, {
      service: "workers",
    });

    logger.debug(telemetryMonitors, { service: "workers" });

    const enqueueTasks: Array<{
      monitor: Monitor;
      run: () => Promise<void>;
    }> = [];

    for (const monitor of telemetryMonitors) {
      try {
        if (
          !monitor.monitorSteps ||
          !monitor.monitorSteps.data?.monitorStepsInstanceArray?.length ||
          monitor.monitorSteps.data.monitorStepsInstanceArray.length === 0
        ) {
          logger.debug("Monitor has no steps. Skipping...", {
            service: "workers",
            projectId: monitor.projectId?.toString(),
          });
          continue;
        }

        enqueueTasks.push({
          monitor,
          run: () => {
            return TelemetryQueueService.addTelemetryMonitorEvaluationJob({
              monitorId: monitor.id!,
              projectId: monitor.projectId!,
            });
          },
        });
      } catch (error) {
        const attrs: LogAttributes = {
          projectId: monitor.projectId?.toString(),
        };
        logger.error(
          `Error while processing incoming request monitor: ${monitor.id?.toString()}`,
          attrs,
        );
        logger.error(error, attrs);
      }
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
      disableActiveMonitoring: true,
      disableActiveMonitoringBecauseOfManualIncident: true,
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
    },
    props: {
      isRoot: true,
    },
  });

  if (!monitor || !monitor.id) {
    logger.debug(`Telemetry monitor ${data.monitorId} not found. Skipping.`);
    return;
  }

  if (
    monitor.disableActiveMonitoring ||
    monitor.disableActiveMonitoringBecauseOfManualIncident ||
    monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent
  ) {
    logger.debug(
      `Telemetry monitor ${data.monitorId} is disabled. Skipping evaluation.`,
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

  const response: TelemetryMonitorResponse = await monitorTelemetryMonitor({
    monitorStep: monitor.monitorSteps.data.monitorStepsInstanceArray[0]!,
    monitorType: monitor.monitorType!,
    monitorId: monitor.id,
    projectId: monitor.projectId!,
  });

  await MonitorResourceUtil.monitorResource(response);
};

type MonitorTelemetryMonitorFunction = (data: {
  monitorStep: MonitorStep;
  monitorType: MonitorType;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<TelemetryMonitorResponse>;

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
  const names: Set<string> = new Set<string>();
  for (const queryConfig of input.queryConfigs) {
    const name: string | undefined =
      queryConfig.metricQueryData?.filterData?.metricName?.toString();
    if (name) {
      names.add(name);
    }
  }

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
 * Telemetry-source liveness probe for cluster/host-scoped monitors.
 *
 * Health-check-style series (e.g. ceph_health_detail) exist only while
 * a problem is active, so a step whose queries all came back empty is
 * ambiguous: either the source is healthy-and-quiet, or the agent/mgr
 * died and NOTHING is being reported. Only in that ambiguous case does
 * this run one limit-1 lookup for ANY metric carrying the source's
 * scoping resource attribute inside the same evaluation window:
 *
 *   - any step query returned data     → true (no extra query),
 *   - probe finds any row              → true (quiet but alive),
 *   - probe finds nothing              → false (total blackout),
 *   - no scoping attribute to probe by → undefined (unknown; legacy
 *     behavior downstream).
 *
 * `false` makes MetricMonitorCriteria refuse to TreatAsZero and makes
 * MonitorResource hold status/incidents instead of reverting to the
 * default status — a dead agent must never auto-resolve incidents.
 */
const checkTelemetrySourceReporting: (input: {
  projectId: ObjectID;
  startAndEndDate: InBetween<Date>;
  sourceAttributes: Dictionary<string>;
  stepResults: Array<AggregatedResult>;
  excludeMetricNames?: ReadonlyArray<string> | undefined;
}) => Promise<boolean | undefined> = async (input: {
  projectId: ObjectID;
  startAndEndDate: InBetween<Date>;
  sourceAttributes: Dictionary<string>;
  stepResults: Array<AggregatedResult>;
  excludeMetricNames?: ReadonlyArray<string> | undefined;
}): Promise<boolean | undefined> => {
  const hasAnyData: boolean = input.stepResults.some(
    (result: AggregatedResult) => {
      return Boolean(result.data && result.data.length > 0);
    },
  );

  if (hasAnyData) {
    return true;
  }

  if (Object.keys(input.sourceAttributes).length === 0) {
    return undefined;
  }

  try {
    /*
     * excludeMetricNames makes the probe blind to server-synthesized
     * series that keep flowing while the source itself is dark — the
     * IoT fleet rollups carry the fleet's scoping attribute every
     * minute regardless of collector health, and counting them as
     * "reporting" would defeat the blackout hold this probe exists
     * to provide.
     */
    const anyMetricFromSource: Array<Metric> = await MetricService.findBy({
      query: {
        projectId: input.projectId,
        time: input.startAndEndDate,
        attributes: input.sourceAttributes,
        ...(input.excludeMetricNames && input.excludeMetricNames.length > 0
          ? { name: new IncludesNone([...input.excludeMetricNames]) }
          : {}),
      } as Query<Metric>,
      select: {
        time: true,
      },
      limit: 1,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return anyMetricFromSource.length > 0;
  } catch (err) {
    logger.error("Telemetry source liveness probe failed", {
      service: "workers",
      projectId: input.projectId.toString(),
    });
    logger.error(err, {
      service: "workers",
      projectId: input.projectId.toString(),
    });
    // Probe failure must not freeze the monitor — fall back to legacy.
    return undefined;
  }
};

/**
 * Collect the union of attribute keys the user asked to group by
 * across every queryConfig on the monitor step. Per-series
 * alerting needs a consistent key set across queries so formula
 * series line up (otherwise `a + b` would split differently for a
 * and b and the per-series formula evaluation wouldn't align).
 */
const collectGroupByAttributeKeys: (
  queryConfigs: Array<MetricQueryConfigData>,
) => Array<string> = (
  queryConfigs: Array<MetricQueryConfigData>,
): Array<string> => {
  const keys: Set<string> = new Set<string>();
  for (const queryConfig of queryConfigs) {
    const groupKeys: Array<string> | undefined =
      queryConfig.metricQueryData?.groupByAttributeKeys;
    if (groupKeys) {
      for (const key of groupKeys) {
        if (key) {
          keys.add(key);
        }
      }
    }
  }
  return Array.from(keys);
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

/**
 * LEGACY FALLBACK — per-series aggregation in code: bucket raw metric
 * rows by (series fingerprint, minute bucket) in JS. Returns an
 * AggregatedResult shaped identically to what `MetricService.aggregateBy`
 * would have produced with `GROUP BY time, attributes`.
 *
 * The primary path is now `MetricService.aggregateByAttributeSeries`,
 * which pushes the GROUP BY into ClickHouse by extracting each group-by
 * attribute key as a scalar column (sidestepping the @clickhouse/client
 * quirk where a parameterized GROUP BY over the nested `attributes` Map
 * column returns 0 rows — the original reason this JS path existed).
 * This function only runs when the server-side path fails, via
 * `fetchPerSeriesAggregatedResult`, which caps the raw fetch at
 * LIMIT_PER_PROJECT rows and loudly reports any truncation. Do not call
 * this with an uncapped row set.
 *
 * Exported for tests only (PerSeriesAggregationFallback.test.ts).
 */
export const aggregatePerSeriesFromRawMetrics: (input: {
  rawMetrics: Array<Metric>;
  attributeKeys: Array<string>;
  aggregationType: MetricsAggregationType;
}) => AggregatedResult = (input: {
  rawMetrics: Array<Metric>;
  attributeKeys: Array<string>;
  aggregationType: MetricsAggregationType;
}): AggregatedResult => {
  const buckets: Map<
    string,
    {
      labels: JSONObject;
      timestamp: Date;
      values: Array<number>;
      attributes: JSONObject;
    }
  > = new Map();

  for (const metric of input.rawMetrics) {
    const attrs: JSONObject = (metric.attributes as JSONObject) || {};
    const labels: JSONObject = {};
    for (const key of input.attributeKeys) {
      const value: unknown = attrs[key];
      labels[key] =
        value === undefined || value === null ? "" : (value as string);
    }
    const fingerprint: string =
      MetricSeriesFingerprint.computeFingerprint(labels);

    const metricTime: Date = metric.time ? new Date(metric.time) : new Date();
    const bucketDate: Date = new Date(
      Date.UTC(
        metricTime.getUTCFullYear(),
        metricTime.getUTCMonth(),
        metricTime.getUTCDate(),
        metricTime.getUTCHours(),
        metricTime.getUTCMinutes(),
        0,
        0,
      ),
    );

    const bucketKey: string = `${fingerprint}|${bucketDate.toISOString()}`;

    const value: number =
      typeof metric.value === "number" ? metric.value : Number(metric.value);

    if (!Number.isFinite(value)) {
      continue;
    }

    const existing:
      | {
          labels: JSONObject;
          timestamp: Date;
          values: Array<number>;
          attributes: JSONObject;
        }
      | undefined = buckets.get(bucketKey);

    if (existing) {
      existing.values.push(value);
    } else {
      buckets.set(bucketKey, {
        labels,
        timestamp: bucketDate,
        values: [value],
        attributes: attrs,
      });
    }
  }

  const rows: Array<AggregatedModel> = [];

  for (const bucket of buckets.values()) {
    const vs: Array<number> = bucket.values;
    if (vs.length === 0) {
      continue;
    }

    let aggregated: number;
    switch (input.aggregationType) {
      case MetricsAggregationType.Sum:
        aggregated = vs.reduce((a: number, b: number) => {
          return a + b;
        }, 0);
        break;
      case MetricsAggregationType.Count:
        aggregated = vs.length;
        break;
      case MetricsAggregationType.Max:
        aggregated = Math.max(...vs);
        break;
      case MetricsAggregationType.Min:
        aggregated = Math.min(...vs);
        break;
      case MetricsAggregationType.Avg:
        aggregated =
          vs.reduce((a: number, b: number) => {
            return a + b;
          }, 0) / vs.length;
        break;
      default: {
        /*
         * Percentiles (P50–P99) via nearest-rank — an acceptable
         * in-process approximation of ClickHouse's quantile(), so a
         * fallback evaluation keeps percentile semantics instead of
         * silently degrading to Avg (which sits far below P95/P99 on
         * latency-shaped distributions and would mask breaches exactly
         * when ClickHouse is degraded).
         */
        const percentileLevel: number | null = getPercentileLevel(
          input.aggregationType,
        );
        if (percentileLevel !== null) {
          const sorted: Array<number> = [...vs].sort((a: number, b: number) => {
            return a - b;
          });
          const rankIndex: number = Math.min(
            sorted.length - 1,
            Math.max(0, Math.ceil(percentileLevel * sorted.length) - 1),
          );
          aggregated = sorted[rankIndex]!;
          break;
        }

        // Unknown aggregation types fall back to Avg (legacy behavior).
        aggregated =
          vs.reduce((a: number, b: number) => {
            return a + b;
          }, 0) / vs.length;
        break;
      }
    }

    rows.push({
      timestamp: bucket.timestamp,
      value: aggregated,
      attributes: bucket.attributes as AggregatedModel[string],
    });
  }

  return { data: rows };
};

/**
 * Per-series aggregation for a group-by telemetry monitor query.
 *
 * Primary path: `MetricService.aggregateByAttributeSeries` — ClickHouse
 * GROUP BYs minute buckets × the requested attribute keys server-side,
 * so the row volume scales with `series × minutes` instead of
 * `series × raw samples`. This removes the old LIMIT_PER_PROJECT raw-row
 * cap that silently dropped later-sorted series (i.e. whole devices /
 * pods / OSDs) from evaluation at fleet scale.
 *
 * Fallback path: if the server-side aggregation fails for any reason,
 * fall back to the legacy capped raw fetch + in-process aggregation so
 * the monitor still evaluates. Every truncation on either path emits a
 * logger.warn carrying the monitorId and the dropped row count —
 * truncation is never silent.
 */
const fetchPerSeriesAggregatedResult: (input: {
  query: Query<Metric>;
  attributeKeys: Array<string>;
  aggregationType: MetricsAggregationType;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<AggregatedResult> = async (input: {
  query: Query<Metric>;
  attributeKeys: Array<string>;
  aggregationType: MetricsAggregationType;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<AggregatedResult> => {
  const logAttributes: LogAttributes = {
    service: "workers",
    monitorId: input.monitorId.toString(),
    projectId: input.projectId.toString(),
  };

  try {
    const serverSide: MetricPerSeriesAggregationResult =
      await MetricService.aggregateByAttributeSeries({
        query: input.query,
        aggregationType: input.aggregationType,
        groupByAttributeKeys: input.attributeKeys,
        props: {
          isRoot: true,
        },
      });

    if (serverSide.truncated) {
      logger.warn(
        `Per-series metric aggregation truncated for monitor ${input.monitorId.toString()}: ${serverSide.droppedRowCount} aggregated series-time rows beyond the ${PER_SERIES_AGGREGATION_MAX_ROWS}-row cap were dropped. Some series (devices/pods/hosts) are missing from this evaluation — shorten the rolling window or narrow the monitor's filters.`,
        logAttributes,
      );
    }

    return serverSide.result;
  } catch (err) {
    logger.error(
      `Server-side per-series aggregation failed for monitor ${input.monitorId.toString()} (aggregation: ${input.aggregationType}); falling back to capped raw-row aggregation with in-process ${input.aggregationType}.`,
      logAttributes,
    );
    logger.error(err, logAttributes);
  }

  /*
   * Legacy fallback: capped raw fetch + in-process aggregation. The cap
   * means series can be dropped at fleet scale, so when it is hit we
   * quantify the loss (count query, only paid on the truncated path)
   * and warn loudly.
   */
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
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  if (rawMetrics.length >= LIMIT_PER_PROJECT) {
    let droppedRowCount: number | undefined = undefined;

    try {
      const totalRows: PositiveNumber = await MetricService.countBy({
        query: input.query,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
      droppedRowCount = Math.max(0, totalRows.toNumber() - rawMetrics.length);
    } catch (countErr) {
      logger.error(countErr, logAttributes);
    }

    logger.warn(
      `Per-series raw metric fetch hit the ${LIMIT_PER_PROJECT}-row cap for monitor ${input.monitorId.toString()}: ${
        droppedRowCount !== undefined
          ? `${droppedRowCount} raw rows`
          : "an unknown number of raw rows"
      } in the evaluation window were dropped. Later-sorted series (devices/pods/hosts) are missing from this evaluation.`,
      logAttributes,
    );
  }

  return aggregatePerSeriesFromRawMetrics({
    rawMetrics,
    attributeKeys: input.attributeKeys,
    aggregationType: input.aggregationType,
  });
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

  if (monitorType === MonitorType.Docker) {
    return monitorDocker({
      monitorStep,
      monitorId,
      projectId,
    });
  }

  if (monitorType === MonitorType.Host) {
    return monitorHost({
      monitorStep,
      monitorId,
      projectId,
    });
  }

  if (monitorType === MonitorType.Podman) {
    return monitorPodman({
      monitorStep,
      monitorId,
      projectId,
    });
  }

  if (monitorType === MonitorType.Proxmox) {
    return monitorProxmox({
      monitorStep,
      monitorId,
      projectId,
    });
  }

  if (monitorType === MonitorType.DockerSwarm) {
    return monitorDockerSwarm({
      monitorStep,
      monitorId,
      projectId,
    });
  }

  if (monitorType === MonitorType.Ceph) {
    return monitorCeph({
      monitorStep,
      monitorId,
      projectId,
    });
  }

  if (monitorType === MonitorType.IoTDevice) {
    return monitorIoT({
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

    let aggregatedResults: AggregatedResult;

    if (groupByAttributeKeys.length > 0) {
      /*
       * Per-series path: aggregate server-side in ClickHouse (GROUP BY
       * minute bucket × scalar-extracted attribute keys) so evaluation
       * sees every series regardless of fleet size. See
       * fetchPerSeriesAggregatedResult for the fallback + truncation
       * telemetry.
       */
      aggregatedResults = await fetchPerSeriesAggregatedResult({
        query: query,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
        monitorId: data.monitorId,
        projectId: data.projectId,
      });
    } else {
      aggregatedResults = await MetricService.aggregateBy({
        query: query,
        aggregationType,
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
      });
    }

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

  const seriesBreakdown: Array<MetricSeriesResult> | undefined =
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
   * Re-serialise the native-units Map to a plain dictionary so it
   * survives any cross-process boundary the response may cross (queue
   * payloads, JSON serialization, etc). The criteria evaluator uses
   * this as a fallback when the user didn't pick an explicit
   * `legendUnit` — without it, a metric whose native unit is the OTel
   * dimensionless "1" can't be compared against a "%" threshold.
   */
  const nativeUnitsByMetricNameDict: { [key: string]: string } = {};
  for (const [name, unit] of nativeUnitsByMetricName.entries()) {
    nativeUnitsByMetricNameDict[name] = unit;
  }

  return {
    projectId: data.projectId,
    metricViewConfig: metricMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    monitorId: data.monitorId,
    seriesBreakdown: seriesBreakdown,
    nativeUnitsByMetricName: nativeUnitsByMetricNameDict,
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

      if (resourceFilters.workloadName && resourceFilters.workloadType) {
        const workloadType: string = resourceFilters.workloadType.toLowerCase();
        attributes[`resource.k8s.${workloadType}.name`] =
          resourceFilters.workloadName;
      }
    }

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    let aggregatedResults: AggregatedResult;

    if (groupByAttributeKeys.length > 0) {
      aggregatedResults = await fetchPerSeriesAggregatedResult({
        query: query,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
        monitorId: data.monitorId,
        projectId: data.projectId,
      });
    } else {
      aggregatedResults = await MetricService.aggregateBy({
        query: query,
        aggregationType,
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
      });
    }

    logger.debug("Kubernetes monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });
    logger.debug(aggregatedResults, {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);

    /*
     * Build the per-resource breakdown from the FIRST query that returns
     * rows. For multi-query ratio/difference configs the first query is
     * the numerator/minuend — the diagnostic metric incidents should rank
     * resources by; later denominator queries (capacity/allocatable) must
     * not overwrite it, otherwise the root-cause table sorts nodes by
     * disk size instead of fullness. Skipping also saves a redundant
     * MetricService.findBy per extra query.
     */
    if (kubernetesResourceBreakdown) {
      continue;
    }

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
      logger.error("Failed to fetch Kubernetes resource breakdown", {
        service: "workers",
        projectId: data.projectId.toString(),
      });
      logger.error(err, {
        service: "workers",
        projectId: data.projectId.toString(),
      });
    }
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: kubernetesMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
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

  /*
   * All-empty step results are ambiguous (quiet cluster vs dead agent);
   * probe the cluster's scoping attribute so a collection blackout
   * holds monitor state instead of auto-resolving via default status.
   */
  const isTelemetrySourceReporting: boolean | undefined =
    await checkTelemetrySourceReporting({
      projectId: data.projectId,
      startAndEndDate: startAndEndDate,
      sourceAttributes: kubernetesMonitorConfig.clusterIdentifier
        ? {
            "resource.k8s.cluster.name":
              kubernetesMonitorConfig.clusterIdentifier,
          }
        : {},
      stepResults: finalResult,
    });

  return {
    projectId: data.projectId,
    metricViewConfig: kubernetesMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    monitorId: data.monitorId,
    kubernetesResourceBreakdown: kubernetesResourceBreakdown,
    seriesBreakdown: seriesBreakdown,
    isTelemetrySourceReporting: isTelemetrySourceReporting,
  };
};

type MonitorDockerFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

const monitorDocker: MonitorDockerFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<MetricMonitorResponse> => {
  const dockerMonitorConfig: MonitorStepDockerMonitor | undefined =
    data.monitorStep.data?.dockerMonitor;

  if (!dockerMonitorConfig) {
    throw new BadDataException("Docker monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      dockerMonitorConfig.rollingTime || RollingTime.Past1Minute,
    );

  const finalResult: Array<AggregatedResult> = [];

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

    let aggregatedResults: AggregatedResult;

    if (groupByAttributeKeys.length > 0) {
      aggregatedResults = await fetchPerSeriesAggregatedResult({
        query: query,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
        monitorId: data.monitorId,
        projectId: data.projectId,
      });
    } else {
      aggregatedResults = await MetricService.aggregateBy({
        query: query,
        aggregationType,
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
      });
    }

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

  /*
   * All-empty step results are ambiguous (quiet containers vs dead
   * agent); probe the monitor's own scoping attributes so a collection
   * blackout holds monitor state instead of auto-resolving via default
   * status. Runtime is always stamped on Docker batches, so scope by it
   * plus the host when one is configured.
   */
  const dockerSourceAttributes: Dictionary<string> = {
    "resource.container.runtime": "docker",
  };

  if (dockerMonitorConfig.hostIdentifier) {
    dockerSourceAttributes["resource.host.name"] =
      dockerMonitorConfig.hostIdentifier;
  }

  const isTelemetrySourceReporting: boolean | undefined =
    await checkTelemetrySourceReporting({
      projectId: data.projectId,
      startAndEndDate: startAndEndDate,
      sourceAttributes: dockerSourceAttributes,
      stepResults: finalResult,
    });

  return {
    projectId: data.projectId,
    metricViewConfig: dockerMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    isTelemetrySourceReporting: isTelemetrySourceReporting,
  };
};

type MonitorHostFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

const monitorHost: MonitorHostFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<MetricMonitorResponse> => {
  const hostMonitorConfig: MonitorStepHostMonitor | undefined =
    data.monitorStep.data?.hostMonitor;

  if (!hostMonitorConfig) {
    throw new BadDataException("Host monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      hostMonitorConfig.rollingTime || RollingTime.Past1Minute,
    );

  const finalResult: Array<AggregatedResult> = [];

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

    let aggregatedResults: AggregatedResult;

    if (groupByAttributeKeys.length > 0) {
      aggregatedResults = await fetchPerSeriesAggregatedResult({
        query: query,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
        monitorId: data.monitorId,
        projectId: data.projectId,
      });
    } else {
      aggregatedResults = await MetricService.aggregateBy({
        query: query,
        aggregationType,
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
      });
    }

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

  const seriesBreakdown: Array<MetricSeriesResult> | undefined =
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
   * All-empty step results are ambiguous (quiet host vs dead agent);
   * probe the host's scoping attribute so a collection blackout holds
   * monitor state instead of auto-resolving via default status.
   */
  const isTelemetrySourceReporting: boolean | undefined =
    await checkTelemetrySourceReporting({
      projectId: data.projectId,
      startAndEndDate: startAndEndDate,
      sourceAttributes: hostMonitorConfig.hostIdentifier
        ? {
            "resource.host.name": hostMonitorConfig.hostIdentifier,
          }
        : {},
      stepResults: finalResult,
    });

  return {
    projectId: data.projectId,
    metricViewConfig: hostMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    isTelemetrySourceReporting: isTelemetrySourceReporting,
  };
};

type MonitorPodmanFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

const monitorPodman: MonitorPodmanFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<MetricMonitorResponse> => {
  const podmanMonitorConfig: MonitorStepPodmanMonitor | undefined =
    data.monitorStep.data?.podmanMonitor;

  if (!podmanMonitorConfig) {
    throw new BadDataException("Podman monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      podmanMonitorConfig.rollingTime || RollingTime.Past1Minute,
    );

  const finalResult: Array<AggregatedResult> = [];

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

    let aggregatedResults: AggregatedResult;

    if (groupByAttributeKeys.length > 0) {
      aggregatedResults = await fetchPerSeriesAggregatedResult({
        query: query,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
        monitorId: data.monitorId,
        projectId: data.projectId,
      });
    } else {
      aggregatedResults = await MetricService.aggregateBy({
        query: query,
        aggregationType,
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
      });
    }

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

  /*
   * All-empty step results are ambiguous (quiet containers vs dead
   * agent); probe the monitor's own scoping attributes so a collection
   * blackout holds monitor state instead of auto-resolving via default
   * status. Runtime is always stamped on Podman batches, so scope by it
   * plus the host when one is configured.
   */
  const podmanSourceAttributes: Dictionary<string> = {
    "resource.container.runtime": "podman",
  };

  if (podmanMonitorConfig.hostIdentifier) {
    podmanSourceAttributes["resource.host.name"] =
      podmanMonitorConfig.hostIdentifier;
  }

  const isTelemetrySourceReporting: boolean | undefined =
    await checkTelemetrySourceReporting({
      projectId: data.projectId,
      startAndEndDate: startAndEndDate,
      sourceAttributes: podmanSourceAttributes,
      stepResults: finalResult,
    });

  return {
    projectId: data.projectId,
    metricViewConfig: podmanMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    isTelemetrySourceReporting: isTelemetrySourceReporting,
  };
};

type MonitorProxmoxFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

const monitorProxmox: MonitorProxmoxFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<MetricMonitorResponse> => {
  const proxmoxMonitorConfig: MonitorStepProxmoxMonitor | undefined =
    data.monitorStep.data?.proxmoxMonitor;

  if (!proxmoxMonitorConfig) {
    throw new BadDataException("Proxmox monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      proxmoxMonitorConfig.rollingTime || RollingTime.Past1Minute,
    );

  const finalResult: Array<AggregatedResult> = [];
  let proxmoxResourceBreakdown: ProxmoxResourceBreakdown | undefined =
    undefined;

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

    let aggregatedResults: AggregatedResult;

    if (groupByAttributeKeys.length > 0) {
      aggregatedResults = await fetchPerSeriesAggregatedResult({
        query: query,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
        monitorId: data.monitorId,
        projectId: data.projectId,
      });
    } else {
      aggregatedResults = await MetricService.aggregateBy({
        query: query,
        aggregationType,
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
      });
    }

    logger.debug("Proxmox monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);

    // Fetch raw metrics to extract per-resource Proxmox context
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
        const affectedResourcesMap: Map<string, ProxmoxAffectedResource> =
          new Map();

        for (const metric of rawMetrics) {
          const metricAttrs: JSONObject =
            (metric.attributes as JSONObject) || {};
          const resourceId: string | undefined = metricAttrs["id"] as
            | string
            | undefined;
          const resourceName: string | undefined = metricAttrs["name"] as
            | string
            | undefined;
          const nodeName: string | undefined = metricAttrs["node"] as
            | string
            | undefined;
          const scope: string | undefined = metricAttrs["pve.scope"] as
            | string
            | undefined;
          const resourceType: string | undefined = metricAttrs["pve.type"] as
            | string
            | undefined;

          // Build unique key for deduplication
          const resourceKey: string = [
            resourceId || "",
            resourceName || "",
            nodeName || "",
          ].join("|");

          const metricValue: number =
            typeof metric.value === "number"
              ? metric.value
              : Number(metric.value) || 0;

          // Keep the highest value per resource
          const existing: ProxmoxAffectedResource | undefined =
            affectedResourcesMap.get(resourceKey);
          if (!existing || metricValue > existing.metricValue) {
            affectedResourcesMap.set(resourceKey, {
              resourceId: resourceId || undefined,
              resourceName: resourceName || undefined,
              resourceType: resourceType || undefined,
              scope: scope || undefined,
              nodeName: nodeName || undefined,
              metricValue: metricValue,
            });
          }
        }

        const metricDef: ProxmoxMetricDefinition | undefined =
          getProxmoxMetricByMetricName(metricName);

        proxmoxResourceBreakdown = {
          clusterName: proxmoxMonitorConfig.clusterIdentifier,
          metricName: metricName,
          metricFriendlyName: metricDef?.friendlyName || metricName,
          affectedResources: Array.from(affectedResourcesMap.values()),
          attributes: attributes,
        };
      }
    } catch (err) {
      logger.error("Failed to fetch Proxmox resource breakdown", {
        service: "workers",
        projectId: data.projectId.toString(),
      });
      logger.error(err, {
        service: "workers",
        projectId: data.projectId.toString(),
      });
    }
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: proxmoxMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
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

  /*
   * All-empty step results are ambiguous (quiet cluster vs dead agent);
   * probe the cluster's scoping attribute so a collection blackout
   * holds monitor state instead of auto-resolving via default status.
   */
  const isTelemetrySourceReporting: boolean | undefined =
    await checkTelemetrySourceReporting({
      projectId: data.projectId,
      startAndEndDate: startAndEndDate,
      sourceAttributes: proxmoxMonitorConfig.clusterIdentifier
        ? {
            "resource.proxmox.cluster.name":
              proxmoxMonitorConfig.clusterIdentifier,
          }
        : {},
      stepResults: finalResult,
    });

  return {
    projectId: data.projectId,
    metricViewConfig: proxmoxMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    proxmoxResourceBreakdown: proxmoxResourceBreakdown,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    isTelemetrySourceReporting: isTelemetrySourceReporting,
  };
};

type MonitorIoTFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

const monitorIoT: MonitorIoTFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<MetricMonitorResponse> => {
  const iotMonitorConfig: MonitorStepIoTMonitor | undefined =
    data.monitorStep.data?.iotMonitor;

  if (!iotMonitorConfig) {
    throw new BadDataException("IoT monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      iotMonitorConfig.rollingTime || RollingTime.Past1Minute,
    );

  const finalResult: Array<AggregatedResult> = [];

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
     * `device.id` datapoint label and the agent-stamped `iot.scope` /
     * `iot.device.type` datapoint attributes (stored unprefixed). The
     * deviceId filter pins an exact device; deviceType / scope narrow to
     * a class of devices.
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

      if (resourceFilters.scope) {
        attributes["iot.scope"] = resourceFilters.scope;
      }
    }

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    let aggregatedResults: AggregatedResult;

    if (groupByAttributeKeys.length > 0) {
      aggregatedResults = await fetchPerSeriesAggregatedResult({
        query: query,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
        monitorId: data.monitorId,
        projectId: data.projectId,
      });
    } else {
      aggregatedResults = await MetricService.aggregateBy({
        query: query,
        aggregationType,
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
      });
    }

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

  const seriesBreakdown: Array<MetricSeriesResult> | undefined =
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
   * All-empty step results are ambiguous (quiet fleet vs dead gateway);
   * probe the fleet's scoping attribute so a collection blackout holds
   * monitor state instead of auto-resolving via default status. The
   * probe excludes the server-computed iot_fleet_* rollup series: the
   * ComputeFleetRollups worker keeps emitting those every minute even
   * while the fleet's collector is dark (that is how the fleet-level
   * blackout alert fires), so counting them as "reporting" would
   * auto-resolve per-device incidents mid-blackout.
   */
  const isTelemetrySourceReporting: boolean | undefined =
    await checkTelemetrySourceReporting({
      projectId: data.projectId,
      startAndEndDate: startAndEndDate,
      sourceAttributes: iotMonitorConfig.fleetIdentifier
        ? {
            "resource.iot.fleet.name": iotMonitorConfig.fleetIdentifier,
          }
        : {},
      stepResults: finalResult,
      excludeMetricNames: IOT_FLEET_ROLLUP_METRIC_NAME_LIST,
    });

  return {
    projectId: data.projectId,
    metricViewConfig: iotMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    isTelemetrySourceReporting: isTelemetrySourceReporting,
  };
};

type MonitorDockerSwarmFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

const monitorDockerSwarm: MonitorDockerSwarmFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<MetricMonitorResponse> => {
  const dockerSwarmMonitorConfig: MonitorStepDockerSwarmMonitor | undefined =
    data.monitorStep.data?.dockerSwarmMonitor;

  if (!dockerSwarmMonitorConfig) {
    throw new BadDataException("Docker Swarm monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      dockerSwarmMonitorConfig.rollingTime || RollingTime.Past1Minute,
    );

  const finalResult: Array<AggregatedResult> = [];
  let dockerSwarmResourceBreakdown: DockerSwarmResourceBreakdown | undefined =
    undefined;

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
     * batch (stored `resource.`-prefixed in ClickHouse). This is the ONLY
     * resource attribute the agent stamps — there is intentionally no
     * `container.runtime` filter here (the Docker Swarm agent does not
     * stamp it; adding one would match zero rows).
     */
    if (dockerSwarmMonitorConfig.clusterIdentifier) {
      attributes["resource.docker.swarm.cluster.name"] =
        dockerSwarmMonitorConfig.clusterIdentifier;
    }

    /*
     * Docker Swarm resource filters. The docker_stats receiver keeps
     * container identity in datapoint labels (stored unprefixed):
     * `container.name` (a Swarm task's container is
     * `<service>.<slot>.<taskid>`) and `container.image.name`. The
     * node/service hints map to the `docker.swarm.node.name` /
     * `docker.swarm.service.name` datapoint attributes when the agent
     * stamps them.
     */
    if (dockerSwarmMonitorConfig.resourceFilters) {
      const resourceFilters: DockerSwarmResourceFilters =
        dockerSwarmMonitorConfig.resourceFilters;

      if (resourceFilters.containerName) {
        attributes["container.name"] = resourceFilters.containerName;
      }

      if (resourceFilters.containerImage) {
        attributes["container.image.name"] = resourceFilters.containerImage;
      }

      if (resourceFilters.nodeName) {
        attributes["docker.swarm.node.name"] = resourceFilters.nodeName;
      }

      if (resourceFilters.serviceName) {
        attributes["docker.swarm.service.name"] = resourceFilters.serviceName;
      }
    }

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }

    const aggregationType: MetricsAggregationType =
      (queryConfig.metricQueryData.filterData
        .aggegationType as MetricsAggregationType) ||
      MetricsAggregationType.Avg;

    let aggregatedResults: AggregatedResult;

    if (groupByAttributeKeys.length > 0) {
      aggregatedResults = await fetchPerSeriesAggregatedResult({
        query: query,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
        monitorId: data.monitorId,
        projectId: data.projectId,
      });
    } else {
      aggregatedResults = await MetricService.aggregateBy({
        query: query,
        aggregationType,
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
      });
    }

    logger.debug("Docker Swarm monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);

    // Fetch raw metrics to extract per-resource Docker Swarm context
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
        const affectedResourcesMap: Map<string, DockerSwarmAffectedResource> =
          new Map();

        for (const metric of rawMetrics) {
          const metricAttrs: JSONObject =
            (metric.attributes as JSONObject) || {};
          const containerName: string | undefined = metricAttrs[
            "container.name"
          ] as string | undefined;
          const containerImage: string | undefined = metricAttrs[
            "container.image.name"
          ] as string | undefined;
          const nodeName: string | undefined = metricAttrs[
            "docker.swarm.node.name"
          ] as string | undefined;
          const serviceName: string | undefined = metricAttrs[
            "docker.swarm.service.name"
          ] as string | undefined;

          // Build unique key for deduplication
          const resourceKey: string = [
            containerName || "",
            containerImage || "",
            nodeName || "",
            serviceName || "",
          ].join("|");

          const metricValue: number =
            typeof metric.value === "number"
              ? metric.value
              : Number(metric.value) || 0;

          // Keep the highest value per resource
          const existing: DockerSwarmAffectedResource | undefined =
            affectedResourcesMap.get(resourceKey);
          if (!existing || metricValue > existing.metricValue) {
            affectedResourcesMap.set(resourceKey, {
              containerName: containerName || undefined,
              containerImage: containerImage || undefined,
              nodeName: nodeName || undefined,
              serviceName: serviceName || undefined,
              metricValue: metricValue,
            });
          }
        }

        const metricDef: DockerSwarmMetricDefinition | undefined =
          getDockerSwarmMetricByMetricName(metricName);

        dockerSwarmResourceBreakdown = {
          clusterName: dockerSwarmMonitorConfig.clusterIdentifier,
          metricName: metricName,
          metricFriendlyName: metricDef?.friendlyName || metricName,
          affectedResources: Array.from(affectedResourcesMap.values()),
          attributes: attributes,
        };
      }
    } catch (err) {
      logger.error("Failed to fetch Docker Swarm resource breakdown", {
        service: "workers",
        projectId: data.projectId.toString(),
      });
      logger.error(err, {
        service: "workers",
        projectId: data.projectId.toString(),
      });
    }
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: dockerSwarmMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
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

  /*
   * All-empty step results are ambiguous (quiet cluster vs dead agent);
   * probe the cluster's scoping attribute so a collection blackout
   * holds monitor state instead of auto-resolving via default status.
   */
  const isTelemetrySourceReporting: boolean | undefined =
    await checkTelemetrySourceReporting({
      projectId: data.projectId,
      startAndEndDate: startAndEndDate,
      sourceAttributes: dockerSwarmMonitorConfig.clusterIdentifier
        ? {
            "resource.docker.swarm.cluster.name":
              dockerSwarmMonitorConfig.clusterIdentifier,
          }
        : {},
      stepResults: finalResult,
    });

  return {
    projectId: data.projectId,
    metricViewConfig: dockerSwarmMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    dockerSwarmResourceBreakdown: dockerSwarmResourceBreakdown,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    isTelemetrySourceReporting: isTelemetrySourceReporting,
  };
};

type MonitorCephFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

const monitorCeph: MonitorCephFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<MetricMonitorResponse> => {
  const cephMonitorConfig: MonitorStepCephMonitor | undefined =
    data.monitorStep.data?.cephMonitor;

  if (!cephMonitorConfig) {
    throw new BadDataException("Ceph monitor config is missing");
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      cephMonitorConfig.rollingTime || RollingTime.Past1Minute,
    );

  const finalResult: Array<AggregatedResult> = [];
  let cephResourceBreakdown: CephResourceBreakdown | undefined = undefined;

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

    let aggregatedResults: AggregatedResult;

    if (groupByAttributeKeys.length > 0) {
      aggregatedResults = await fetchPerSeriesAggregatedResult({
        query: query,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
        monitorId: data.monitorId,
        projectId: data.projectId,
      });
    } else {
      aggregatedResults = await MetricService.aggregateBy({
        query: query,
        aggregationType,
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
      });
    }

    logger.debug("Ceph monitor aggregated results", {
      service: "workers",
      projectId: data.projectId.toString(),
    });

    finalResult.push(aggregatedResults);

    // Fetch raw metrics to extract per-resource Ceph context
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
        const affectedResourcesMap: Map<string, CephAffectedResource> =
          new Map();

        for (const metric of rawMetrics) {
          const metricAttrs: JSONObject =
            (metric.attributes as JSONObject) || {};
          const daemon: string | undefined = metricAttrs["ceph_daemon"] as
            | string
            | undefined;
          const poolIdRaw: unknown = metricAttrs["pool_id"];
          const poolId: string | undefined =
            poolIdRaw !== undefined && poolIdRaw !== null
              ? String(poolIdRaw)
              : undefined;
          const poolName: string | undefined = metricAttrs["name"] as
            | string
            | undefined;
          const hostname: string | undefined = metricAttrs["hostname"] as
            | string
            | undefined;

          // Build unique key for deduplication
          const resourceKey: string = [
            daemon || "",
            poolId || "",
            poolName || "",
            hostname || "",
          ].join("|");

          const metricValue: number =
            typeof metric.value === "number"
              ? metric.value
              : Number(metric.value) || 0;

          // Keep the highest value per resource
          const existing: CephAffectedResource | undefined =
            affectedResourcesMap.get(resourceKey);
          if (!existing || metricValue > existing.metricValue) {
            affectedResourcesMap.set(resourceKey, {
              daemon: daemon || undefined,
              poolId: poolId || undefined,
              poolName: poolName || undefined,
              hostname: hostname || undefined,
              metricValue: metricValue,
            });
          }
        }

        const metricDef: CephMetricDefinition | undefined =
          getCephMetricByMetricName(metricName);

        cephResourceBreakdown = {
          clusterName: cephMonitorConfig.clusterIdentifier,
          metricName: metricName,
          metricFriendlyName: metricDef?.friendlyName || metricName,
          affectedResources: Array.from(affectedResourcesMap.values()),
          attributes: attributes,
        };
      }
    } catch (err) {
      logger.error("Failed to fetch Ceph resource breakdown", {
        service: "workers",
        projectId: data.projectId.toString(),
      });
      logger.error(err, {
        service: "workers",
        projectId: data.projectId.toString(),
      });
    }
  }

  const nativeUnitsByMetricName: Map<string, string> =
    await loadNativeUnitsByMetricName({
      queryConfigs: cephMonitorConfig.metricViewConfig.queryConfigs,
      projectId: data.projectId,
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

  /*
   * ceph_health_detail series vanish when their check clears, so empty
   * step results alone cannot distinguish "healthy" from "mgr/agent
   * dead". Probe the cluster's own scoping attribute; false blocks the
   * TreatAsZero recover filters and the default-status revert from
   * auto-resolving incidents during a blackout.
   */
  const isTelemetrySourceReporting: boolean | undefined =
    await checkTelemetrySourceReporting({
      projectId: data.projectId,
      startAndEndDate: startAndEndDate,
      sourceAttributes: cephMonitorConfig.clusterIdentifier
        ? {
            "resource.ceph.cluster.name": cephMonitorConfig.clusterIdentifier,
          }
        : {},
      stepResults: finalResult,
    });

  return {
    projectId: data.projectId,
    metricViewConfig: cephMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    cephResourceBreakdown: cephResourceBreakdown,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
    isTelemetrySourceReporting: isTelemetrySourceReporting,
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
