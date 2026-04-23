import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
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
          logger.debug("Monitor has no steps. Skipping...", {
            service: "workers",
            projectId: monitor.projectId?.toString(),
          });
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
       * Per-series path: fetch raw rows including the full
       * attributes map, then bucket + aggregate in code. We can't
       * push this through aggregateBy+SQL because the @clickhouse/client
       * parameterized query returns 0 rows when GROUP BY includes the
       * Map column. See aggregatePerSeriesFromRawMetrics for details.
       */
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
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      aggregatedResults = aggregatePerSeriesFromRawMetrics({
        rawMetrics,
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

  return {
    projectId: data.projectId,
    metricViewConfig: metricMonitorConfig.metricViewConfig,
    startAndEndDate: startAndEndDate,
    metricResult: resultsWithFormulas,
    monitorId: data.monitorId,
    seriesBreakdown: seriesBreakdown,
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
