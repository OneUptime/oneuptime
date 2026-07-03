import { describe, expect, jest, test } from "@jest/globals";

/*
 * The MonitorTelemetryMonitor module imports TelemetryQueueService,
 * which pulls in BullMQ / Redis wiring at import time. The unit under
 * test (aggregatePerSeriesFromRawMetrics) is pure, so the queue module
 * is replaced entirely — mirroring TelemetryQueueService.test.ts.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
      getQueue: jest.fn(),
    },
    QueueJob: {},
    QueueName: {},
  };
});

import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import Metric from "Common/Models/AnalyticsModels/Metric";
import { JSONObject } from "Common/Types/JSON";
import { aggregatePerSeriesFromRawMetrics } from "../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

type RawMetricShape = {
  attributes: JSONObject;
  time: Date;
  value: number;
};

const makeRawMetrics: (values: Array<number>) => Array<Metric> = (
  values: Array<number>,
): Array<Metric> => {
  // All samples in the same minute bucket and the same series so the
  // aggregation runs over exactly one bucket.
  return values.map((value: number, index: number): Metric => {
    const raw: RawMetricShape = {
      attributes: { "device.id": "device-a" },
      time: new Date(Date.UTC(2026, 6, 3, 10, 0, Math.min(index, 59))),
      value: value,
    };
    return raw as unknown as Metric;
  });
};

const aggregateSingleBucket: (
  values: Array<number>,
  aggregationType: MetricsAggregationType,
) => number = (
  values: Array<number>,
  aggregationType: MetricsAggregationType,
): number => {
  const result: AggregatedResult = aggregatePerSeriesFromRawMetrics({
    rawMetrics: makeRawMetrics(values),
    attributeKeys: ["device.id"],
    aggregationType: aggregationType,
  });
  expect(result.data).toHaveLength(1);
  return result.data[0]!.value;
};

/*
 * Regression for the fallback path silently degrading P50–P99 to Avg:
 * when ClickHouse-side aggregation fails and the capped raw-row
 * fallback runs, percentile monitors must still evaluate percentiles
 * (nearest-rank approximation of ClickHouse quantile()), not the mean —
 * Avg sits far below P95/P99 on latency-shaped distributions and would
 * mask breaches exactly while ClickHouse is degraded.
 */
describe("aggregatePerSeriesFromRawMetrics (per-series fallback path)", () => {
  test("P95 uses nearest-rank percentile, not the mean", () => {
    const values: Array<number> = [];
    for (let i: number = 1; i <= 40; i++) {
      values.push(i); // 1..40, mean = 20.5
    }

    const aggregated: number = aggregateSingleBucket(
      values,
      MetricsAggregationType.P95,
    );

    // Nearest-rank: ceil(0.95 * 40) - 1 = index 37 -> value 38.
    expect(aggregated).toBe(38);
    expect(aggregated).not.toBe(20.5);
  });

  test("P50 nearest-rank on an even-sized sample picks the lower middle", () => {
    // Nearest-rank: ceil(0.5 * 4) - 1 = index 1 -> 2 (not the interpolated 2.5).
    expect(
      aggregateSingleBucket([4, 1, 3, 2], MetricsAggregationType.P50),
    ).toBe(2);
  });

  test("P99 of a single sample returns that sample", () => {
    expect(aggregateSingleBucket([123], MetricsAggregationType.P99)).toBe(123);
  });

  test("P90 sorts before ranking (input order must not matter)", () => {
    // Sorted: 1..10; nearest-rank: ceil(0.9 * 10) - 1 = index 8 -> 9.
    expect(
      aggregateSingleBucket(
        [10, 1, 9, 2, 8, 3, 7, 4, 6, 5],
        MetricsAggregationType.P90,
      ),
    ).toBe(9);
  });

  test.each([
    [MetricsAggregationType.Sum, 10],
    [MetricsAggregationType.Count, 4],
    [MetricsAggregationType.Min, 1],
    [MetricsAggregationType.Max, 4],
    [MetricsAggregationType.Avg, 2.5],
  ])(
    "non-percentile aggregation %s stays unchanged (expected %d)",
    (aggregationType: MetricsAggregationType, expected: number) => {
      expect(aggregateSingleBucket([1, 2, 3, 4], aggregationType)).toBe(
        expected,
      );
    },
  );

  test("unknown aggregation types still fall back to Avg (legacy behavior)", () => {
    expect(
      aggregateSingleBucket(
        [1, 2, 3, 4],
        "SomethingNew" as MetricsAggregationType,
      ),
    ).toBe(2.5);
  });
});
