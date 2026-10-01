import { MetricService } from "../../../Server/Services/MetricService";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";

/*
 * The metric engine's folds, modelled: what one one-minute bucket of stored
 * Metric rows aggregates to, for each scalar aggregation a metric monitor
 * query can ask for.
 *
 * MessageQueueAlertTemplates.test evaluates the queue alert templates over
 * broker-shaped rows through engineFold, and pins the SQL it ports
 * (engineExpression) verbatim. Whether that SQL computes what engineFold
 * says is a question only a real ClickHouse server answers, so the App
 * suite Tests/Workers/Jobs/TelemetryMonitor/MetricEngineFoldClickhouse.test
 * runs it there: the App Test workflow provides the server (Common's does
 * not) and fails the run if it ever goes missing.
 */

/*
 * One stored Metric row, as far as a fold reads it: `value`, and for a
 * distribution point (a histogram or a summary: `count` set) its count,
 * sum, min and max. A CloudWatch point is a Summary — count = SampleCount,
 * sum = Sum (mirrored into value) — with no min or max column, because a
 * Summary proto carries none (OtelMetricsIngestService reads the point's
 * `min` / `max`, which only a histogram has).
 */
export interface StoredPoint {
  value: number | null;
  count?: number | null | undefined;
  sum?: number | null | undefined;
  min?: number | null | undefined;
  max?: number | null | undefined;
}

export function isPresent(value: number | null | undefined): value is number {
  return value !== null && value !== undefined;
}

/*
 * How the metric engine folds one bucket of rows for a scalar aggregation:
 * a port of MetricService.getDistributionAwareAggregationExpression, which
 * every template query compiles to (its attribute filter keeps it off the
 * rollups).
 */
export function engineFold(
  points: Array<StoredPoint>,
  aggregationType: MetricsAggregationType,
): number | null {
  const observationTotal: (point: StoredPoint) => number | null = (
    point: StoredPoint,
  ): number | null => {
    return isPresent(point.sum) ? point.sum : point.value;
  };
  const isDistribution: (point: StoredPoint) => boolean = (
    point: StoredPoint,
  ): boolean => {
    return isPresent(point.count) && isPresent(observationTotal(point));
  };
  const bound: (
    point: StoredPoint,
    stored: number | null | undefined,
  ) => number | null = (
    point: StoredPoint,
    stored: number | null | undefined,
  ): number | null => {
    if (isPresent(stored)) {
      return stored;
    }
    if (isDistribution(point) && point.count! > 0) {
      return observationTotal(point)! / point.count!;
    }
    return isPresent(point.value) ? point.value : null;
  };

  let total: number = 0;
  let observations: number = 0;

  for (const point of points) {
    if (isDistribution(point)) {
      total += observationTotal(point)!;
      observations += point.count!;
    } else if (isPresent(point.value)) {
      total += point.value;
      observations += 1;
    }
  }

  const bounds: (
    pick: (point: StoredPoint) => number | null,
  ) => Array<number> = (
    pick: (point: StoredPoint) => number | null,
  ): Array<number> => {
    return points
      .map((point: StoredPoint): number | null => {
        return pick(point);
      })
      .filter((value: number | null): value is number => {
        return value !== null;
      });
  };

  switch (aggregationType) {
    case MetricsAggregationType.Sum:
      return total;
    case MetricsAggregationType.Count:
      return observations;
    case MetricsAggregationType.Avg:
      return observations === 0 ? 0 : total / observations;
    case MetricsAggregationType.Min: {
      const values: Array<number> = bounds(
        (point: StoredPoint): number | null => {
          return bound(point, point.min);
        },
      );
      return values.length > 0 ? Math.min(...values) : null;
    }
    case MetricsAggregationType.Max: {
      const values: Array<number> = bounds(
        (point: StoredPoint): number | null => {
          return bound(point, point.max);
        },
      );
      return values.length > 0 ? Math.max(...values) : null;
    }
    default:
      throw new Error(`No engine fold for ${aggregationType}`);
  }
}

// Every aggregation engineFold ports.
export const ENGINE_FOLD_AGGREGATIONS: ReadonlyArray<MetricsAggregationType> = [
  MetricsAggregationType.Sum,
  MetricsAggregationType.Count,
  MetricsAggregationType.Avg,
  MetricsAggregationType.Min,
  MetricsAggregationType.Max,
];

// The engine the telemetry worker asks for a metric monitor's aggregates.
export const METRIC_ENGINE: MetricService = new MetricService();

// The SQL fold the engine compiles a scalar aggregation over `value` to.
export function engineExpression(
  aggregationType: MetricsAggregationType,
): string {
  return (
    METRIC_ENGINE as unknown as {
      getDistributionAwareAggregationExpression: (
        aggregationType: AggregationType,
        column: string,
      ) => string;
    }
  ).getDistributionAwareAggregationExpression(aggregationType, "value");
}
