import {
  PromQLMetricRow,
  parsePromQLMetricRow,
  promQLSeriesFromRows,
} from "../../../../Server/Utils/PromQL/PromQLMetricRows";
import {
  PromQLLabelMatcher,
  PromQLMatchType,
} from "../../../../Utils/PromQL/PromQLAst";
import { PromQLSeries } from "../../../../Utils/PromQL/PromQLEngineTypes";
import { formatPromQLLabels } from "../../../../Utils/PromQL/PromQLLabels";
import {
  PromQLMetricRequest,
  PromQLSeriesKind,
} from "../../../../Utils/PromQL/PromQLMetricNames";
import * as PatternCache from "../../../../Utils/LinearRegExp/PatternCache";
import { describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * OneUptime's OpenTelemetry points as PromQL series (issue #6796): a
 * histogram becomes cumulative buckets with `le`, a summary its quantiles,
 * and a delta counter a running total that rate() reads like any counter.
 */

const row: (overrides: Partial<PromQLMetricRow>) => PromQLMetricRow = (
  overrides: Partial<PromQLMetricRow>,
): PromQLMetricRow => {
  return {
    name: "metric",
    metricPointType: "Gauge",
    aggregationTemporality: undefined,
    attributes: { host: "a" },
    timestampMs: 60000,
    value: 1,
    count: undefined,
    sum: undefined,
    bucketCounts: [],
    explicitBounds: [],
    summaryQuantiles: [],
    summaryValues: [],
    ...overrides,
  };
};

const request: (
  storedName: string,
  kind: PromQLSeriesKind,
  seriesName: string,
) => PromQLMetricRequest = (
  storedName: string,
  kind: PromQLSeriesKind,
  seriesName: string,
): PromQLMetricRequest => {
  return { storedName, kind, seriesName };
};

// Series as { 'labels': [[seconds, value], ...] }.
const seriesOf: (data: {
  rows: Array<PromQLMetricRow>;
  requests: Array<PromQLMetricRequest>;
  matchers?: Array<PromQLLabelMatcher>;
  startTimeMs?: number;
  endTimeMs?: number;
}) => Record<string, Array<[number, number]>> = (data: {
  rows: Array<PromQLMetricRow>;
  requests: Array<PromQLMetricRequest>;
  matchers?: Array<PromQLLabelMatcher>;
  startTimeMs?: number;
  endTimeMs?: number;
}): Record<string, Array<[number, number]>> => {
  const series: Array<PromQLSeries> = promQLSeriesFromRows({
    rows: data.rows,
    requests: data.requests,
    matchers: data.matchers || [],
    startTimeMs: data.startTimeMs ?? 0,
    endTimeMs: data.endTimeMs ?? 10000000,
  });
  const result: Record<string, Array<[number, number]>> = {};

  for (const item of series) {
    const points: Array<[number, number]> = [];

    for (let index: number = 0; index < item.values.length; index++) {
      points.push([item.timestampsMs[index]! / 1000, item.values[index]!]);
    }

    result[formatPromQLLabels(item.labels)] = points;
  }

  return result;
};

describe("gauges and sums", () => {
  test("a gauge's points are its samples", () => {
    expect(
      seriesOf({
        rows: [
          row({ timestampMs: 60000, value: 5 }),
          row({ timestampMs: 120000, value: 7 }),
        ],
        requests: [request("metric", PromQLSeriesKind.Value, "metric")],
      }),
    ).toEqual({
      'metric{host="a"}': [
        [60, 5],
        [120, 7],
      ],
    });
  });

  test("rows are put in time order whatever order they arrive in", () => {
    expect(
      seriesOf({
        rows: [
          row({ timestampMs: 120000, value: 7 }),
          row({ timestampMs: 60000, value: 5 }),
        ],
        requests: [request("metric", PromQLSeriesKind.Value, "metric")],
      }),
    ).toEqual({
      'metric{host="a"}': [
        [60, 5],
        [120, 7],
      ],
    });
  });

  test("a cumulative sum is read as it is", () => {
    expect(
      seriesOf({
        rows: [
          row({
            metricPointType: "Sum",
            aggregationTemporality: "Cumulative",
            timestampMs: 60000,
            value: 10,
          }),
          row({
            metricPointType: "Sum",
            aggregationTemporality: "Cumulative",
            timestampMs: 120000,
            value: 25,
          }),
        ],
        requests: [request("metric", PromQLSeriesKind.Value, "metric_total")],
      }),
    ).toEqual({
      'metric_total{host="a"}': [
        [60, 10],
        [120, 25],
      ],
    });
  });

  test("a delta sum becomes a running total", () => {
    expect(
      seriesOf({
        rows: [3, 4, 5].map((value: number, index: number): PromQLMetricRow => {
          return row({
            metricPointType: "Sum",
            aggregationTemporality: "Delta",
            timestampMs: (index + 1) * 60000,
            value,
          });
        }),
        requests: [request("metric", PromQLSeriesKind.Value, "metric")],
      }),
    ).toEqual({
      'metric{host="a"}': [
        [60, 3],
        [120, 7],
        [180, 12],
      ],
    });
  });

  test("two points at one time are one sample, the later row winning", () => {
    expect(
      seriesOf({
        rows: [
          row({ timestampMs: 60000, value: 5 }),
          row({ timestampMs: 60000, value: 6 }),
        ],
        requests: [request("metric", PromQLSeriesKind.Value, "metric")],
      }),
    ).toEqual({ 'metric{host="a"}': [[60, 6]] });
  });

  test("a gauge has no _bucket, _count or _sum series", () => {
    expect(
      seriesOf({
        rows: [row({})],
        requests: [
          request("metric", PromQLSeriesKind.Bucket, "metric_bucket"),
          request("metric", PromQLSeriesKind.Count, "metric_count"),
          request("metric", PromQLSeriesKind.Sum, "metric_sum"),
        ],
      }),
    ).toEqual({});
  });
});

describe("histograms", () => {
  const histogram: (overrides: Partial<PromQLMetricRow>) => PromQLMetricRow = (
    overrides: Partial<PromQLMetricRow>,
  ): PromQLMetricRow => {
    return row({
      name: "latency",
      metricPointType: "Histogram",
      aggregationTemporality: "Cumulative",
      explicitBounds: [0.1, 0.5, 1],
      bucketCounts: [2, 3, 4, 1],
      count: 10,
      sum: 4.2,
      value: 4.2,
      ...overrides,
    });
  };

  test("buckets count up to each bound, ending at +Inf", () => {
    expect(
      seriesOf({
        rows: [histogram({})],
        requests: [
          request("latency", PromQLSeriesKind.Bucket, "latency_bucket"),
        ],
      }),
    ).toEqual({
      'latency_bucket{host="a", le="0.1"}': [[60, 2]],
      'latency_bucket{host="a", le="0.5"}': [[60, 5]],
      'latency_bucket{host="a", le="1"}': [[60, 9]],
      'latency_bucket{host="a", le="+Inf"}': [[60, 10]],
    });
  });

  test("_count and _sum are the histogram's count and sum", () => {
    expect(
      seriesOf({
        rows: [histogram({})],
        requests: [
          request("latency", PromQLSeriesKind.Count, "latency_count"),
          request("latency", PromQLSeriesKind.Sum, "latency_sum"),
        ],
      }),
    ).toEqual({
      'latency_count{host="a"}': [[60, 10]],
      'latency_sum{host="a"}': [[60, 4.2]],
    });
  });

  test("a delta histogram's buckets, count and sum add up over time", () => {
    const series: Record<string, Array<[number, number]>> = seriesOf({
      rows: [
        histogram({ aggregationTemporality: "Delta", timestampMs: 60000 }),
        histogram({
          aggregationTemporality: "Delta",
          timestampMs: 120000,
          bucketCounts: [1, 0, 0, 0],
          count: 1,
          sum: 0.05,
        }),
      ],
      requests: [
        request("latency", PromQLSeriesKind.Bucket, "latency_bucket"),
        request("latency", PromQLSeriesKind.Count, "latency_count"),
      ],
    });

    expect(series['latency_bucket{host="a", le="0.1"}']).toEqual([
      [60, 2],
      [120, 3],
    ]);
    expect(series['latency_bucket{host="a", le="+Inf"}']).toEqual([
      [60, 10],
      [120, 11],
    ]);
    expect(series['latency_count{host="a"}']).toEqual([
      [60, 10],
      [120, 11],
    ]);
  });

  test("buckets that stop short of +Inf still end at the count", () => {
    expect(
      seriesOf({
        rows: [histogram({ bucketCounts: [2, 3, 4], count: 12 })],
        requests: [
          request("latency", PromQLSeriesKind.Bucket, "latency_bucket"),
        ],
      })['latency_bucket{host="a", le="+Inf"}'],
    ).toEqual([[60, 12]]);
  });

  test("an exponential histogram has a count and a sum, and no buckets", () => {
    expect(
      seriesOf({
        rows: [
          histogram({
            metricPointType: "ExponentialHistogram",
            explicitBounds: [],
            bucketCounts: [],
          }),
        ],
        requests: [
          request("latency", PromQLSeriesKind.Bucket, "latency_bucket"),
          request("latency", PromQLSeriesKind.Count, "latency_count"),
          request("latency", PromQLSeriesKind.Sum, "latency_sum"),
        ],
      }),
    ).toEqual({
      'latency_count{host="a"}': [[60, 10]],
      'latency_sum{host="a"}': [[60, 4.2]],
    });
  });
});

describe("summaries", () => {
  test("a summary's quantiles carry a quantile label", () => {
    expect(
      seriesOf({
        rows: [
          row({
            name: "rpc",
            metricPointType: "Summary",
            summaryQuantiles: [0.5, 0.99],
            summaryValues: [12, 80],
            count: 100,
            sum: 1500,
          }),
        ],
        requests: [
          request("rpc", PromQLSeriesKind.Value, "rpc"),
          request("rpc", PromQLSeriesKind.Count, "rpc_count"),
        ],
      }),
    ).toEqual({
      'rpc{host="a", quantile="0.5"}': [[60, 12]],
      'rpc{host="a", quantile="0.99"}': [[60, 80]],
      'rpc_count{host="a"}': [[60, 100]],
    });
  });
});

describe("matchers and the window", () => {
  test("only series whose labels satisfy every matcher are kept", () => {
    expect(
      Object.keys(
        seriesOf({
          rows: [
            row({ attributes: { host: "a", "http.method": "GET" } }),
            row({ attributes: { host: "b", "http.method": "POST" } }),
          ],
          requests: [request("metric", PromQLSeriesKind.Value, "metric")],
          matchers: [
            {
              name: "http_method",
              type: PromQLMatchType.RegexMatch,
              value: "G.*",
            },
          ],
        }),
      ),
    ).toEqual(['metric{host="a", http_method="GET"}']);
  });

  test("a matcher's pattern is compiled once for a read's rows, not once per series", () => {
    const compiles: SpyInstance<typeof PatternCache.getLinearRegExp> =
      jest.spyOn(PatternCache, "getLinearRegExp");

    try {
      expect(
        Object.keys(
          seriesOf({
            rows: ["a", "b", "c", "d", "e"].map(
              (host: string): PromQLMetricRow => {
                return row({ attributes: { host } });
              },
            ),
            requests: [request("metric", PromQLSeriesKind.Value, "metric")],
            matchers: [
              {
                name: "host",
                type: PromQLMatchType.RegexMatch,
                value: "[a-c]",
              },
            ],
          }),
        ),
      ).toEqual(['metric{host="a"}', 'metric{host="b"}', 'metric{host="c"}']);
      expect(compiles).toHaveBeenCalledTimes(1);
    } finally {
      compiles.mockRestore();
    }
  });

  test("a matcher on le picks one bucket", () => {
    expect(
      Object.keys(
        seriesOf({
          rows: [
            row({
              metricPointType: "Histogram",
              explicitBounds: [1],
              bucketCounts: [1, 1],
              count: 2,
            }),
          ],
          requests: [
            request("metric", PromQLSeriesKind.Bucket, "metric_bucket"),
          ],
          matchers: [
            { name: "le", type: PromQLMatchType.Equal, value: "+Inf" },
          ],
        }),
      ),
    ).toEqual(['metric_bucket{host="a", le="+Inf"}']);
  });

  test("samples outside the window are left out, after a delta total adds them", () => {
    expect(
      seriesOf({
        rows: [1, 2, 3].map((value: number, index: number): PromQLMetricRow => {
          return row({
            metricPointType: "Sum",
            aggregationTemporality: "Delta",
            timestampMs: (index + 1) * 60000,
            value,
          });
        }),
        requests: [request("metric", PromQLSeriesKind.Value, "metric")],
        startTimeMs: 60000,
        endTimeMs: 180000,
      }),
    ).toEqual({
      'metric{host="a"}': [
        [120, 3],
        [180, 6],
      ],
    });
  });

  test("rows of a metric nobody asked for are ignored", () => {
    expect(
      seriesOf({
        rows: [row({ name: "other" })],
        requests: [request("metric", PromQLSeriesKind.Value, "metric")],
      }),
    ).toEqual({});
  });
});

describe("reading ClickHouse's JSON", () => {
  test("64-bit numbers sent as strings are read as numbers", () => {
    expect(
      parsePromQLMetricRow({
        name: "latency",
        metricPointType: "Histogram",
        aggregationTemporality: "Delta",
        attributes: { host: "a" },
        timestampMs: "1700000000123",
        value: 4.2,
        count: "10",
        sum: 4.2,
        bucketCounts: ["2", "8"],
        explicitBounds: [0.5],
        summaryQuantiles: [],
        summaryValues: [],
      }),
    ).toEqual({
      name: "latency",
      metricPointType: "Histogram",
      aggregationTemporality: "Delta",
      attributes: { host: "a" },
      timestampMs: 1700000000123,
      value: 4.2,
      count: 10,
      sum: 4.2,
      bucketCounts: [2, 8],
      explicitBounds: [0.5],
      summaryQuantiles: [],
      summaryValues: [],
    });
  });

  test("missing columns read as nothing, not as zero", () => {
    const parsed: PromQLMetricRow = parsePromQLMetricRow({
      name: "x",
      timestampMs: 1,
      value: null,
    });

    expect(parsed.value).toBeUndefined();
    expect(parsed.count).toBeUndefined();
    expect(parsed.bucketCounts).toEqual([]);
    expect(parsed.attributes).toEqual({});
  });
});
