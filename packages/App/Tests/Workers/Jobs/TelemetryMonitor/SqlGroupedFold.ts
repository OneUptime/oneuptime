import { JSONObject } from "Common/Types/JSON";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";

/*
 * Stored metric rows as MetricService.aggregateBy returns them to a
 * monitor's read, for the suites that mock MetricService with rows: a row
 * per time bucket (a minute: their windows are short) - and, grouped by
 * attribute keys, per series too, with an `attributes` map of the grouped
 * keys, each '' where a row lacks it, as ClickHouse GROUPs BY
 * `attributes['k']` on a Map(String, String). Asked for sample attributes
 * (includeSampleAttributes, as every infrastructure monitor's read asks),
 * every row of a series carries one map: its newest row's in the window,
 * with the grouped keys laid over it - as MetricService's whole-window
 * read gives it (`mapUpdate(argMax(attributes, time), map(...))`). Every
 * grouped read of a monitor is this SQL read (#5281); the suites' raw rows
 * feed the breakdown scans (findBy) as before.
 *
 * GroupedReadInSqlClickhouse.test.ts holds the real ClickHouse to the same
 * folds.
 */

export interface StoredMetricRow {
  time: Date;
  value: number;
  attributes: JSONObject;
}

export interface FoldedReadArgs {
  aggregationType: MetricsAggregationType;
  groupByAttributeKeys?: Array<string> | undefined;
  includeSampleAttributes?: boolean | undefined;
}

interface FoldedBucket {
  timestamp: Date;
  // The grouped keys' values, which name the bucket's series.
  attributes: JSONObject;
  seriesKey: string;
  values: Array<number>;
}

const MINUTE_MS: number = 60_000;

function foldValues(
  aggregationType: MetricsAggregationType,
  values: Array<number>,
): number {
  switch (aggregationType) {
    case MetricsAggregationType.Min:
      return Math.min(...values);
    case MetricsAggregationType.Max:
      return Math.max(...values);
    case MetricsAggregationType.Sum:
      return values.reduce((total: number, value: number) => {
        return total + value;
      }, 0);
    case MetricsAggregationType.Count:
      return values.length;
    case MetricsAggregationType.Avg:
      return (
        values.reduce((total: number, value: number) => {
          return total + value;
        }, 0) / values.length
      );
    default:
      throw new Error(`SqlGroupedFold does not fold ${aggregationType}`);
  }
}

export function foldRowsAsSqlRead(
  rows: Array<StoredMetricRow>,
  args: FoldedReadArgs,
): { data: Array<JSONObject> } {
  const keys: Array<string> = args.groupByAttributeKeys || [];
  const withSample: boolean =
    args.includeSampleAttributes === true && keys.length > 0;
  const buckets: Map<string, FoldedBucket> = new Map();
  // Each series' newest row in the window, whose map a sample read returns.
  const newestBySeries: Map<string, StoredMetricRow> = new Map();

  for (const stored of rows) {
    const minuteMs: number =
      Math.floor(stored.time.getTime() / MINUTE_MS) * MINUTE_MS;
    const attributes: JSONObject = {};

    for (const key of keys) {
      const value: unknown = stored.attributes[key];
      attributes[key] =
        value === undefined || value === null ? "" : String(value);
    }

    const seriesKey: string = JSON.stringify(attributes);
    const bucketKey: string = `${minuteMs}|${seriesKey}`;
    const bucket: FoldedBucket | undefined = buckets.get(bucketKey);

    if (bucket) {
      bucket.values.push(stored.value);
    } else {
      buckets.set(bucketKey, {
        timestamp: new Date(minuteMs),
        attributes: attributes,
        seriesKey: seriesKey,
        values: [stored.value],
      });
    }

    const newest: StoredMetricRow | undefined = newestBySeries.get(seriesKey);

    if (!newest || stored.time.getTime() > newest.time.getTime()) {
      newestBySeries.set(seriesKey, stored);
    }
  }

  // One map a series, shared by its rows, as MetricService hands it out.
  const sampleBySeries: Map<string, JSONObject> = new Map();

  if (withSample) {
    for (const bucket of buckets.values()) {
      if (!sampleBySeries.has(bucket.seriesKey)) {
        sampleBySeries.set(bucket.seriesKey, {
          ...newestBySeries.get(bucket.seriesKey)!.attributes,
          ...bucket.attributes,
        });
      }
    }
  }

  // Newest first, as AnalyticsDatabaseService sorts an aggregate.
  return {
    data: Array.from(buckets.values())
      .sort((a: FoldedBucket, b: FoldedBucket): number => {
        return b.timestamp.getTime() - a.timestamp.getTime();
      })
      .map((bucket: FoldedBucket): JSONObject => {
        const attributes: JSONObject =
          sampleBySeries.get(bucket.seriesKey) || bucket.attributes;

        return {
          timestamp: bucket.timestamp,
          value: foldValues(args.aggregationType, bucket.values),
          ...(keys.length > 0 ? { attributes: attributes } : {}),
        };
      }),
  };
}
