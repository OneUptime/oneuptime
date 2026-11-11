import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "../../Types/BaseDatabase/AggregationType";
import InBetween from "../../Types/BaseDatabase/InBetween";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import {
  AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE,
  ParsedAzureResourceId,
  parseAzureResourceId,
} from "../../Types/Cloud/CloudMonitoredResource";
import { getCanonicalCloudResourceType } from "../../Types/Cloud/CloudResourceCatalog";
import { getCloudResourceMetricAggregation } from "../../Types/Cloud/CloudResourceMetricAggregation";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";
import RollingTime from "../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../Types/RollingTime/RollingTimeUtil";

/*
 * WHAT A METRIC QUERY OF A CLOUD RESOURCE ADDS UP TO, for every reader of
 * one that is not the resource's Metrics tab.
 *
 * A Service Bus or Event Hubs namespace's metrics arrive once per queue,
 * topic and event hub, and the namespace's number is their Sum: a count's
 * over any interval, an amount held's while an interval is a minute
 * (CloudResourceMetricAggregation, the catalog). The namespace's Metrics tab
 * reads its rows so (CloudMonitoredResourceScope). This module asks the same
 * catalog from a query alone, for the metric monitors that read such a
 * query, the explorer and the monitor form that write one, the API that
 * stores one, and OneUptime AI's metric tools:
 *
 *   - the resource a query reads is the one its attribute filter names by
 *     its own id - `azuremonitor.resource_id`, an exact value - as the
 *     Metrics tab, the explorer it opens and every monitor created from
 *     either filter it (getCloudResource);
 *   - the interval a query is read in is its reader's: a chart's, from its
 *     range; a Metrics monitor's, a minute at a time while its window is up
 *     to 3 hours, in longer intervals past that, and the whole window as one
 *     for a step that reads it whole (getMetricMonitorReadInterval), as the
 *     worker reads it (MonitorTelemetryMonitor.monitorMetric).
 *
 * A query that names no such resource, and a metric the catalog does not
 * sum, read as they always did: with their own aggregation, or the average.
 *
 * Pure and isomorphic: the Dashboard, the server, the worker's data
 * migration and the tests read it.
 */

// What a metric query reads, and the intervals it is read in.
export interface MetricQueryRead {
  metricName: unknown;
  attributes: unknown;
  aggregationInterval: AggregationInterval;
}

// The cloud resource a query's attribute filter names by its own id.
export interface MetricQueryCloudResource {
  provider: CloudProvider;
  // The type, as the catalog spells it: "Microsoft.ServiceBus/namespaces".
  type: string;
  // The resource's name, from its id: "shop".
  name: string;
}

/*
 * A query the data migration moved to the catalog's aggregation
 * (restoreResourceTotals), for what it says it did.
 */
export interface MetricQueryAggregationRestore {
  // The query's variable on its monitor ("a"), when it has one.
  metricVariable: string | undefined;
  metricName: string;
  resource: MetricQueryCloudResource;
  // What it was stored with: the average, or nothing, which reads the same.
  from: AggregationType | undefined;
  to: AggregationType;
}

/*
 * A monitor's steps, as a write hands them over (MonitorSteps): only the
 * part read here, so this module needs no monitor step classes.
 */
export interface MonitorStepsLike {
  data?:
    | {
        monitorStepsInstanceArray?:
          | Array<{ data?: { metricMonitor?: unknown } | undefined }>
          | undefined;
      }
    | undefined;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

// A query's filterData, the object its metric and aggregation live on.
function getFilterData(query: unknown): UnknownRecord | undefined {
  return asRecord(
    asRecord(asRecord(query)?.["metricQueryData"])?.["filterData"],
  );
}

// The queries of a Metrics step's metricMonitor, stored or in memory.
function getQueries(metricMonitor: unknown): Array<UnknownRecord> {
  const queryConfigs: unknown = asRecord(
    asRecord(metricMonitor)?.["metricViewConfig"],
  )?.["queryConfigs"];

  if (!Array.isArray(queryConfigs)) {
    return [];
  }

  return queryConfigs.filter((query: unknown): boolean => {
    return Boolean(getFilterData(query));
  }) as Array<UnknownRecord>;
}

// Whether a query names no aggregation, and so reads with the average.
function isUnset(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

// A query's own aggregation; nothing when it names none or one we do not know.
function readAggregation(value: unknown): AggregationType | undefined {
  return typeof value === "string" &&
    Object.values(AggregationType).includes(value as AggregationType)
    ? (value as AggregationType)
    : undefined;
}

function sameText(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export default class MetricQueryCloudAggregation {
  /*
   * The cloud resource a metric query reads, when its attribute filter names
   * exactly one by its own id: an Azure resource by `azuremonitor.resource_id`
   * written as one value (a list or a search names none). Undefined for any
   * other filter - a CloudWatch or Cloud Monitoring resource's metrics are
   * one series each, and the catalog sums none of them.
   */
  public static getCloudResource(
    attributes: unknown,
  ): MetricQueryCloudResource | undefined {
    const resourceId: unknown =
      asRecord(attributes)?.[AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE];

    if (typeof resourceId !== "string" || !resourceId.trim()) {
      return undefined;
    }

    const parsed: ParsedAzureResourceId | null =
      parseAzureResourceId(resourceId);

    if (!parsed) {
      return undefined;
    }

    return {
      provider: CloudProvider.Azure,
      type: getCanonicalCloudResourceType(CloudProvider.Azure, parsed.type),
      name: parsed.name,
    };
  }

  /*
   * The catalog's aggregation for this read: Sum where the resource the
   * query names adds this metric up across its parts at this interval;
   * undefined everywhere else.
   */
  public static getCatalogAggregation(
    read: MetricQueryRead,
  ): AggregationType | undefined {
    const resource: MetricQueryCloudResource | undefined =
      MetricQueryCloudAggregation.getCloudResource(read.attributes);

    if (!resource || typeof read.metricName !== "string") {
      return undefined;
    }

    return getCloudResourceMetricAggregation({
      provider: resource.provider,
      type: resource.type,
      metricName: read.metricName,
      aggregationInterval: read.aggregationInterval,
    });
  }

  // The aggregation a query reads with when nobody picked one.
  public static getDefaultAggregation(read: MetricQueryRead): AggregationType {
    return (
      MetricQueryCloudAggregation.getCatalogAggregation(read) ||
      AggregationType.Avg
    );
  }

  // The intervals a chart reads a range in, as the aggregate API picks them.
  public static getRangeReadInterval(range: {
    startDate: Date;
    endDate: Date;
  }): AggregationInterval {
    return AggregationIntervalUtil.getAggregationIntervalForWindow({
      startDate: range.startDate,
      endDate: range.endDate,
    });
  }

  /*
   * The intervals a Metrics step reads each of its queries in, as the worker
   * reads them: the whole window as one for a step that reads it whole
   * (MonitorStepMetricMonitor.aggregatesWholeWindow), and otherwise the
   * intervals the aggregate API picks for its window - a minute up to 3
   * hours, 5 minutes up to 12, and so on.
   */
  public static getMetricMonitorReadInterval(
    metricMonitor: unknown,
  ): AggregationInterval {
    const record: UnknownRecord | undefined = asRecord(metricMonitor);

    if (record?.["aggregatesWholeWindow"] === true) {
      return AggregationInterval.Total;
    }

    // Written another way ("15 minutes") or not at all, as the worker reads it.
    const rollingTime: RollingTime = RollingTimeUtil.fromValueOrDefault(
      record?.["rollingTime"],
    );
    const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
      rollingTime,
      new Date(0),
    );

    return MetricQueryCloudAggregation.getRangeReadInterval({
      startDate: window.startValue,
      endDate: window.endValue,
    });
  }

  /*
   * The aggregation a query takes once what it reads changes - its metric,
   * its filter, or the intervals it is read in. One that was the default for
   * what it read (getDefaultAggregation: the catalog's, else the average)
   * takes the default for what it reads now: a namespace's messages in go
   * from the average to Sum once its filter names the namespace, and back
   * once the metric is its latency. Any other aggregation was picked, and
   * stays: a Max is never undone.
   */
  public static getFollowedAggregation(data: {
    aggregationType: unknown;
    before: MetricQueryRead;
    after: MetricQueryRead;
  }): AggregationType | undefined {
    const current: AggregationType | undefined = isUnset(data.aggregationType)
      ? AggregationType.Avg
      : readAggregation(data.aggregationType);

    if (
      !current ||
      current !== MetricQueryCloudAggregation.getDefaultAggregation(data.before)
    ) {
      return readAggregation(data.aggregationType);
    }

    return MetricQueryCloudAggregation.getDefaultAggregation(data.after);
  }

  /*
   * A query the query editor hands back, with the aggregation it follows
   * to (getFollowedAggregation) when the edit changed its metric or its
   * filter. An edit of the aggregation itself is the reader's pick, and is
   * kept as it is; so is every query that reads no summed metric.
   */
  public static withFollowedAggregation(data: {
    previous: MetricQueryConfigData | undefined;
    next: MetricQueryConfigData;
    aggregationInterval: AggregationInterval | undefined;
  }): MetricQueryConfigData {
    const previousFilter: UnknownRecord | undefined = getFilterData(
      data.previous,
    );
    const nextFilter: UnknownRecord | undefined = getFilterData(data.next);

    if (!previousFilter || !nextFilter || !data.aggregationInterval) {
      return data.next;
    }

    const previousAggregation: unknown = previousFilter["aggegationType"];
    const nextAggregation: unknown = nextFilter["aggegationType"];

    if (
      (readAggregation(previousAggregation) || AggregationType.Avg) !==
      (readAggregation(nextAggregation) || AggregationType.Avg)
    ) {
      return data.next;
    }

    if (
      sameText(previousFilter["metricName"], nextFilter["metricName"]) &&
      sameText(previousFilter["attributes"], nextFilter["attributes"])
    ) {
      return data.next;
    }

    const followed: AggregationType | undefined =
      MetricQueryCloudAggregation.getFollowedAggregation({
        aggregationType: previousAggregation,
        before: {
          metricName: previousFilter["metricName"],
          attributes: previousFilter["attributes"],
          aggregationInterval: data.aggregationInterval,
        },
        after: {
          metricName: nextFilter["metricName"],
          attributes: nextFilter["attributes"],
          aggregationInterval: data.aggregationInterval,
        },
      });

    if (
      !followed ||
      followed === (readAggregation(nextAggregation) || AggregationType.Avg)
    ) {
      return data.next;
    }

    return MetricQueryCloudAggregation.withAggregation(data.next, followed);
  }

  /*
   * Queries moving from one reader's intervals to another's - a monitor's
   * window changed in its form, a view of the explorer becoming a monitor -
   * each with the aggregation it follows to (getFollowedAggregation): a
   * namespace's messages waiting, summed by the minute, go back to the
   * average past a window of 3 hours, and to Sum when it shrinks again.
   */
  public static withQueriesFollowingInterval(data: {
    queryConfigs: Array<MetricQueryConfigData>;
    from: AggregationInterval;
    to: AggregationInterval;
  }): Array<MetricQueryConfigData> {
    if (data.from === data.to) {
      return data.queryConfigs;
    }

    return data.queryConfigs.map(
      (queryConfig: MetricQueryConfigData): MetricQueryConfigData => {
        const filter: UnknownRecord | undefined = getFilterData(queryConfig);

        if (!filter) {
          return queryConfig;
        }

        const followed: AggregationType | undefined =
          MetricQueryCloudAggregation.getFollowedAggregation({
            aggregationType: filter["aggegationType"],
            before: {
              metricName: filter["metricName"],
              attributes: filter["attributes"],
              aggregationInterval: data.from,
            },
            after: {
              metricName: filter["metricName"],
              attributes: filter["attributes"],
              aggregationInterval: data.to,
            },
          });

        if (
          !followed ||
          followed ===
            (readAggregation(filter["aggegationType"]) || AggregationType.Avg)
        ) {
          return queryConfig;
        }

        return MetricQueryCloudAggregation.withAggregation(
          queryConfig,
          followed,
        );
      },
    );
  }

  /*
   * A Metrics step written without an aggregation on a query - by the API,
   * or by Terraform, which sends what its configuration says - reads with
   * the catalog's at the step's intervals: the default a person gets in the
   * monitor form. Writes it on the step's own queries; a query with any
   * aggregation of its own keeps it. Returns how many it wrote.
   */
  public static fillMissingAggregations(metricMonitor: unknown): number {
    const aggregationInterval: AggregationInterval =
      MetricQueryCloudAggregation.getMetricMonitorReadInterval(metricMonitor);
    let filled: number = 0;

    for (const query of getQueries(metricMonitor)) {
      const filter: UnknownRecord = getFilterData(query)!;
      const stored: unknown = filter["aggegationType"];

      if (!isUnset(stored)) {
        continue;
      }

      const catalog: AggregationType | undefined =
        MetricQueryCloudAggregation.getCatalogAggregation({
          metricName: filter["metricName"],
          attributes: filter["attributes"],
          aggregationInterval,
        });

      if (catalog) {
        filter["aggegationType"] = catalog;
        filled++;
      }
    }

    return filled;
  }

  /*
   * fillMissingAggregations on every step of a monitor's steps as a write
   * hands them over (a MonitorSteps), for the steps that read metrics.
   */
  public static fillMissingAggregationsOfSteps(
    monitorSteps: MonitorStepsLike | null | undefined,
  ): number {
    let filled: number = 0;

    for (const step of monitorSteps?.data?.monitorStepsInstanceArray || []) {
      if (step?.data?.metricMonitor) {
        filled += MetricQueryCloudAggregation.fillMissingAggregations(
          step.data.metricMonitor,
        );
      }
    }

    return filled;
  }

  /*
   * A stored Metrics step that reads a namespace's metric with the average,
   * a minute at a time, read the namespace's number while the namespace
   * reported each metric once - and reads the average queue since it
   * reports it once per queue. Each such query moves to the catalog's Sum,
   * which reads that number again, so the thresholds it is judged by mean
   * what they meant. Only by the minute: a step read in longer intervals,
   * or whole, has no aggregation that reads its old number (a Sum would add
   * up every minute of every queue), and is left as it is. A query with any
   * other aggregation of its own (Max, Min, a percentile, Sum already) is
   * left too. Writes on the step's own queries; returns what it moved.
   */
  public static restoreResourceTotals(
    metricMonitor: unknown,
  ): Array<MetricQueryAggregationRestore> {
    const restored: Array<MetricQueryAggregationRestore> = [];

    if (
      MetricQueryCloudAggregation.getMetricMonitorReadInterval(
        metricMonitor,
      ) !== AggregationInterval.Minute
    ) {
      return restored;
    }

    for (const query of getQueries(metricMonitor)) {
      const filter: UnknownRecord = getFilterData(query)!;
      const stored: unknown = filter["aggegationType"];
      const isAverage: boolean =
        isUnset(stored) || stored === AggregationType.Avg;

      if (!isAverage) {
        continue;
      }

      const resource: MetricQueryCloudResource | undefined =
        MetricQueryCloudAggregation.getCloudResource(filter["attributes"]);
      const catalog: AggregationType | undefined =
        MetricQueryCloudAggregation.getCatalogAggregation({
          metricName: filter["metricName"],
          attributes: filter["attributes"],
          aggregationInterval: AggregationInterval.Minute,
        });

      if (!resource || catalog !== AggregationType.Sum) {
        continue;
      }

      filter["aggegationType"] = catalog;

      const metricVariable: unknown = asRecord(query["metricAliasData"])?.[
        "metricVariable"
      ];

      restored.push({
        metricVariable:
          typeof metricVariable === "string" && metricVariable
            ? metricVariable
            : undefined,
        metricName: filter["metricName"] as string,
        resource,
        from: stored === AggregationType.Avg ? AggregationType.Avg : undefined,
        to: catalog,
      });
    }

    return restored;
  }

  /*
   * The metricMonitor of each step of stored monitorSteps JSON
   * ({_type: "MonitorSteps", value: {monitorStepsInstanceArray: [...]}}),
   * as the database holds them: the objects themselves, to write on.
   */
  public static getStoredMetricMonitors(
    monitorStepsJSON: unknown,
  ): Array<UnknownRecord> {
    const steps: unknown = asRecord(asRecord(monitorStepsJSON)?.["value"])?.[
      "monitorStepsInstanceArray"
    ];

    if (!Array.isArray(steps)) {
      return [];
    }

    const metricMonitors: Array<UnknownRecord> = [];

    for (const step of steps) {
      const metricMonitor: UnknownRecord | undefined = asRecord(
        asRecord(asRecord(step)?.["value"])?.["metricMonitor"],
      );

      if (metricMonitor) {
        metricMonitors.push(metricMonitor);
      }
    }

    return metricMonitors;
  }

  private static withAggregation(
    queryConfig: MetricQueryConfigData,
    aggregationType: AggregationType,
  ): MetricQueryConfigData {
    return {
      ...queryConfig,
      metricQueryData: {
        ...queryConfig.metricQueryData,
        filterData: {
          ...queryConfig.metricQueryData.filterData,
          aggegationType: aggregationType,
        },
      },
    };
  }
}
