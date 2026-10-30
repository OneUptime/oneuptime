import { JSONObject } from "Common/Types/JSON";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";

/*
 * Stored metric rows as MetricService.aggregateBy returns them to a
 * monitor's read, for the suites that mock MetricService with rows: a row
 * per time bucket (a minute: their windows are short) - and, grouped by
 * attribute keys, per series too, with an `attributes` map of exactly the
 * grouped keys, each '' where a row lacks it, as ClickHouse GROUPs BY
 * `attributes['k']` on a Map(String, String). Every grouped read of a
 * monitor is this SQL read (#5281); the suites' raw rows feed the
 * breakdown scans (findBy) as before.
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
  const buckets: Map<
    string,
    { timestamp: Date; attributes: JSONObject; values: Array<number> }
  > = new Map();

  for (const stored of rows) {
    const minuteMs: number =
      Math.floor(stored.time.getTime() / MINUTE_MS) * MINUTE_MS;
    const attributes: JSONObject = {};

    for (const key of keys) {
      const value: unknown = stored.attributes[key];
      attributes[key] =
        value === undefined || value === null ? "" : String(value);
    }

    const bucketKey: string = `${minuteMs}|${JSON.stringify(attributes)}`;
    const bucket:
      | { timestamp: Date; attributes: JSONObject; values: Array<number> }
      | undefined = buckets.get(bucketKey);

    if (bucket) {
      bucket.values.push(stored.value);
    } else {
      buckets.set(bucketKey, {
        timestamp: new Date(minuteMs),
        attributes: attributes,
        values: [stored.value],
      });
    }
  }

  // Newest first, as AnalyticsDatabaseService sorts an aggregate.
  return {
    data: Array.from(buckets.values())
      .sort(
        (
          a: { timestamp: Date },
          b: { timestamp: Date },
        ): number => {
          return b.timestamp.getTime() - a.timestamp.getTime();
        },
      )
      .map(
        (bucket: {
          timestamp: Date;
          attributes: JSONObject;
          values: Array<number>;
        }): JSONObject => {
          return {
            timestamp: bucket.timestamp,
            value: foldValues(args.aggregationType, bucket.values),
            ...(keys.length > 0 ? { attributes: bucket.attributes } : {}),
          };
        },
      ),
  };
}
