import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorType from "Common/Types/Monitor/MonitorType";
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
import MetricService from "Common/Server/Services/MetricService";
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
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
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
 * Per-series aggregation path: fetch raw metric rows and bucket them
 * by (series fingerprint, minute bucket) in code. Returns an
 * AggregatedResult shaped identically to what `MetricService.aggregateBy`
 * would have produced with `GROUP BY time, attributes`.
 *
 * Why in-code instead of SQL GROUP BY: ClickHouse's parameterized
 * query returns 0 rows when the GROUP BY clause includes the nested
 * `attributes` Map column, even though running the exact same SQL
 * directly returns rows. This is a quirk of the @clickhouse/client
 * parameter binding for Map columns. Rather than work around the
 * library bug we fetch raw rows (just like the Kubernetes monitor
 * already does for its per-resource breakdown) and aggregate in JS.
 * For the realistic monitor shape — hundreds of hosts × ~60 samples
 * per minute — the extra work is negligible compared to a cron tick.
 */
const aggregatePerSeriesFromRawMetrics: (input: {
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
      case MetricsAggregationType.P50:
      case MetricsAggregationType.P90:
      case MetricsAggregationType.P95:
      case MetricsAggregationType.P99: {
        /*
         * Nearest-rank percentile over the bucket's raw values. This
         * path serves the infra monitors' gauge metrics, where every
         * row is a single observation — histogram metrics go through
         * the SQL bucket fanout instead. Previously these fell into
         * the default branch and were silently computed as Avg.
         */
        const sorted: Array<number> = [...vs].sort((a: number, b: number) => {
          return a - b;
        });
        const level: number = getPercentileLevel(input.aggregationType) || 0.5;
        const rankIndex: number = Math.min(
          sorted.length - 1,
          Math.max(0, Math.ceil(level * sorted.length) - 1),
        );
        aggregated = sorted[rankIndex]!;
        break;
      }
      case MetricsAggregationType.Avg:
      default:
        aggregated =
          vs.reduce((a: number, b: number) => {
            return a + b;
          }, 0) / vs.length;
        break;
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

/*
 * Guard against an unreliable ClickHouse `count()` silently disabling a
 * telemetry monitor.
 *
 * count() over the large telemetry tables (Log / Span) can come back 0 even
 * while rows plainly exist — e.g. when count() is answered from an aggregate
 * projection that was ADDed but never MATERIALIZEd on existing parts, or when
 * a partial 'break' result is returned under load. A raw 0 makes the criteria
 * "<metric> Count >= 1" evaluate false, so the monitor silently never fires
 * with nothing logged anywhere — the worst failure mode for an alerting path.
 *
 * Before trusting a 0, confirm with existsBy() — a cheap `SELECT 1 ... LIMIT 1`
 * base-table scan that does NOT go through the count/projection path (see the
 * existsBy docs, which already recommend it over `countBy(...) === 0` for
 * existence checks). If rows actually exist, the count is unreliable: log it
 * (so the failure is observable) and treat the match count as >=1 so
 * existence-based criteria still fire. Threshold criteria (`> N`) can still
 * under-evaluate until the underlying count is repaired — that is inherent and
 * now at least surfaced in the logs. The extra scan only runs on the
 * zero-count path, so the healthy (count > 0) path is unchanged.
 */
const resolveReliableTelemetryMatchCount: (data: {
  rawCount: number;
  existsBy: () => Promise<boolean>;
  telemetryType: string;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<number> = async (data: {
  rawCount: number;
  existsBy: () => Promise<boolean>;
  telemetryType: string;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<number> => {
  if (data.rawCount > 0) {
    return data.rawCount;
  }

  const hasMatches: boolean = await data.existsBy();

  if (!hasMatches) {
    return 0;
  }

  logger.warn(
    `Telemetry ${data.telemetryType} monitor ${data.monitorId.toString()} (project ${data.projectId.toString()}): count() returned 0 but matching ${data.telemetryType}s exist — the count is unreliable (e.g. an unmaterialized ClickHouse aggregate projection or a partial 'break' result). Treating the match count as >=1 so existence criteria still fire; threshold criteria may under-evaluate until the underlying count is fixed.`,
  );

  return 1;
};

type MonitorTraceFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<TraceMonitorResponse>;

export const monitorTrace: MonitorTraceFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}): Promise<TraceMonitorResponse> => {
  /*
   * Fall back to the default config when the step was saved without a
   * traceMonitor sub-config (see the equivalent note in monitorLogs). A
   * missing config previously threw every cycle and left the monitor inert.
   */
  const traceQuery: MonitorStepTraceMonitor =
    data.monitorStep.data?.traceMonitor ||
    MonitorStepTraceMonitorUtil.getDefault();

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

  const spanCount: number = await resolveReliableTelemetryMatchCount({
    rawCount: countTraces.toNumber(),
    existsBy: () => {
      return SpanService.existsBy({
        query: query,
        props: {
          isRoot: true,
        },
      });
    },
    telemetryType: "span",
    monitorId: data.monitorId,
    projectId: data.projectId,
  });

  return {
    projectId: data.projectId,
    spanCount: spanCount,
    spanQuery: query,
    monitorId: data.monitorId,
  };
};

type MonitorMetricFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

export const monitorMetric: MonitorMetricFunction = async (data: {
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
        limit: LIMIT_PER_PROJECT,
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

export const monitorException: MonitorExceptionFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
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
    MonitorStepExceptionMonitorUtil.toAnalyticsQuery(exceptionMonitorConfig);

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
      const rawMetricsForAgg: Array<Metric> = await MetricService.findBy({
        query: query,
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

      aggregatedResults = aggregatePerSeriesFromRawMetrics({
        rawMetrics: rawMetricsForAgg,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
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
        // Alerting path: fail loud on timeout, never score partial buckets.
        timeoutOverflowMode: "throw",
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

  return {
    projectId: data.projectId,
    metricViewConfig: kubernetesMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    monitorId: data.monitorId,
    kubernetesResourceBreakdown: kubernetesResourceBreakdown,
    seriesBreakdown: seriesBreakdown,
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
      const rawMetricsForAgg: Array<Metric> = await MetricService.findBy({
        query: query,
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

      aggregatedResults = aggregatePerSeriesFromRawMetrics({
        rawMetrics: rawMetricsForAgg,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
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
        // Alerting path: fail loud on timeout, never score partial buckets.
        timeoutOverflowMode: "throw",
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

  return {
    projectId: data.projectId,
    metricViewConfig: dockerMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
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
      const rawMetricsForAgg: Array<Metric> = await MetricService.findBy({
        query: query,
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

      aggregatedResults = aggregatePerSeriesFromRawMetrics({
        rawMetrics: rawMetricsForAgg,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
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
        // Alerting path: fail loud on timeout, never score partial buckets.
        timeoutOverflowMode: "throw",
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
    metricResult: resultsWithFormulas,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
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
      const rawMetricsForAgg: Array<Metric> = await MetricService.findBy({
        query: query,
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

      aggregatedResults = aggregatePerSeriesFromRawMetrics({
        rawMetrics: rawMetricsForAgg,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
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
        // Alerting path: fail loud on timeout, never score partial buckets.
        timeoutOverflowMode: "throw",
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

  return {
    projectId: data.projectId,
    metricViewConfig: podmanMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
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
      const rawMetricsForAgg: Array<Metric> = await MetricService.findBy({
        query: query,
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

      aggregatedResults = aggregatePerSeriesFromRawMetrics({
        rawMetrics: rawMetricsForAgg,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
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
        // Alerting path: fail loud on timeout, never score partial buckets.
        timeoutOverflowMode: "throw",
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

  return {
    projectId: data.projectId,
    metricViewConfig: proxmoxMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    proxmoxResourceBreakdown: proxmoxResourceBreakdown,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
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
      const rawMetricsForAgg: Array<Metric> = await MetricService.findBy({
        query: query,
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

      aggregatedResults = aggregatePerSeriesFromRawMetrics({
        rawMetrics: rawMetricsForAgg,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
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
        // Alerting path: fail loud on timeout, never score partial buckets.
        timeoutOverflowMode: "throw",
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
    !iotMonitorConfig.resourceFilters?.deviceType &&
    !iotMonitorConfig.resourceFilters?.scope
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
    metricResult: resultsWithFormulas,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
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
      const rawMetricsForAgg: Array<Metric> = await MetricService.findBy({
        query: query,
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

      aggregatedResults = aggregatePerSeriesFromRawMetrics({
        rawMetrics: rawMetricsForAgg,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
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
        // Alerting path: fail loud on timeout, never score partial buckets.
        timeoutOverflowMode: "throw",
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

  return {
    projectId: data.projectId,
    metricViewConfig: dockerSwarmMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    dockerSwarmResourceBreakdown: dockerSwarmResourceBreakdown,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
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
      const rawMetricsForAgg: Array<Metric> = await MetricService.findBy({
        query: query,
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

      aggregatedResults = aggregatePerSeriesFromRawMetrics({
        rawMetrics: rawMetricsForAgg,
        attributeKeys: groupByAttributeKeys,
        aggregationType,
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
        // Alerting path: fail loud on timeout, never score partial buckets.
        timeoutOverflowMode: "throw",
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

  return {
    projectId: data.projectId,
    metricViewConfig: cephMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    cephResourceBreakdown: cephResourceBreakdown,
    seriesBreakdown: seriesBreakdown,
    monitorId: data.monitorId,
  };
};

type MonitorLogsFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<LogMonitorResponse>;

export const monitorLogs: MonitorLogsFunction = async (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
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

  const logCount: number = await resolveReliableTelemetryMatchCount({
    rawCount: countLogs.toNumber(),
    existsBy: () => {
      return LogService.existsBy({
        query: query,
        props: {
          isRoot: true,
        },
      });
    },
    telemetryType: "log",
    monitorId: data.monitorId,
    projectId: data.projectId,
  });

  return {
    projectId: data.projectId,
    logCount: logCount,
    logQuery: JSONFunctions.anyObjectToJSONObject(query),
    monitorId: data.monitorId,
  };
};
