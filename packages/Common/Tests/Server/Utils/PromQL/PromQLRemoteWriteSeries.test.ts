import PromQLMetricSeriesSource from "../../../../Server/Utils/PromQL/PromQLMetricSeriesSource";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PromQLEngine from "../../../../Utils/PromQL/PromQLEngine";
import {
  PromQLQueryResult,
  PromQLResultType,
  PromQLSeries,
  PromQLVectorResultSample,
} from "../../../../Utils/PromQL/PromQLEngineTypes";
import { formatPromQLLabels } from "../../../../Utils/PromQL/PromQLLabels";
import { PromQLMatchType } from "../../../../Utils/PromQL/PromQLAst";
import { describe, expect, test } from "@jest/globals";

/*
 * A Prometheus server's series, as remote write stores them (#7714, #7701),
 * read back with PromQL: a counter is a cumulative sum under its own name,
 * a classic histogram is its `_bucket` sums with an `le` attribute, a
 * summary its gauges with a `quantile` attribute, and job and instance are
 * attributes and the resource's service. What Prometheus answers for each
 * query - worked out by hand from promql/functions.go - is what OneUptime
 * must answer.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a1f0c2e-0000-4000-8000-000000000081",
);

// One stored row, as ClickHouse answers it (64-bit numbers as strings).
const row: (data: {
  name: string;
  pointType: "Sum" | "Gauge";
  attributes: Record<string, string>;
  timestampMs: number;
  value: number;
}) => JSONObject = (data: {
  name: string;
  pointType: "Sum" | "Gauge";
  attributes: Record<string, string>;
  timestampMs: number;
  value: number;
}): JSONObject => {
  return {
    name: data.name,
    metricPointType: data.pointType,
    aggregationTemporality: data.pointType === "Sum" ? "Cumulative" : null,
    attributes: {
      ...data.attributes,
      "resource.service.name": data.attributes["job"] || "",
      "resource.service.instance.id": data.attributes["instance"] || "",
    },
    timestampMs: String(data.timestampMs),
    value: data.value,
    count: null,
    sum: null,
    bucketCounts: [],
    explicitBounds: [],
    summaryQuantiles: [],
    summaryValues: [],
  };
};

const SERIES: Record<string, string> = { job: "api", instance: "10.0.0.7:9090" };

// latency_seconds_bucket at 0s (all zero) and 60s: 10, 50, 90, 100 observations.
const BUCKETS: Array<[string, number]> = [
  ["0.1", 10],
  ["0.5", 50],
  ["1", 90],
  ["+Inf", 100],
];

const ROWS: Array<JSONObject> = [
  row({
    name: "http_requests_total",
    pointType: "Sum",
    attributes: { ...SERIES, code: "200" },
    timestampMs: 0,
    value: 100,
  }),
  row({
    name: "http_requests_total",
    pointType: "Sum",
    attributes: { ...SERIES, code: "200" },
    timestampMs: 60000,
    value: 160,
  }),
  ...BUCKETS.flatMap(([le, count]: [string, number]): Array<JSONObject> => {
    return [
      row({
        name: "latency_seconds_bucket",
        pointType: "Sum",
        attributes: { ...SERIES, le: le },
        timestampMs: 0,
        value: 0,
      }),
      row({
        name: "latency_seconds_bucket",
        pointType: "Sum",
        attributes: { ...SERIES, le: le },
        timestampMs: 60000,
        value: count,
      }),
    ];
  }),
  ...[
    ["0.5", 0.12],
    ["0.99", 0.48],
  ].map(([quantile, value]: Array<string | number>): JSONObject => {
    return row({
      name: "rpc_duration_seconds",
      pointType: "Gauge",
      attributes: { ...SERIES, quantile: String(quantile) },
      timestampMs: 60000,
      value: Number(value),
    });
  }),
];

const engine: () => PromQLEngine = (): PromQLEngine => {
  return new PromQLEngine(
    new PromQLMetricSeriesSource({
      projectId: PROJECT_ID,
      serviceFilter: {},
      listStoredNames: async (): Promise<Array<string>> => {
        return [
          "http_requests_total",
          "latency_seconds_bucket",
          "rpc_duration_seconds",
        ];
      },
      readRows: async (_statement: Statement): Promise<Array<JSONObject>> => {
        return ROWS;
      },
    }),
  );
};

const vectorAt: (
  query: string,
  timeMs: number,
) => Promise<Array<PromQLVectorResultSample>> = async (
  query: string,
  timeMs: number,
): Promise<Array<PromQLVectorResultSample>> => {
  const result: PromQLQueryResult = await engine().instantQuery(query, timeMs);

  expect(result.resultType).toBe(PromQLResultType.Vector);

  return result.resultType === PromQLResultType.Vector ? result.samples : [];
};

describe("a remote-written counter", () => {
  test("rate() answers what Prometheus answers", async () => {
    /*
     * 100 then 160 a minute later, read at 60s over 5m: 60 more, the
     * window's start extrapolated by half the 60s interval (the series
     * starts inside the window), so 60 * (60 + 30) / 60 / 300 = 0.3.
     */
    const samples: Array<PromQLVectorResultSample> = await vectorAt(
      "rate(http_requests_total[5m])",
      60000,
    );

    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBeCloseTo(0.3, 10);
    expect(samples[0]!.labels["job"]).toBe("api");
    expect(samples[0]!.labels["instance"]).toBe("10.0.0.7:9090");
    expect(samples[0]!.labels["code"]).toBe("200");
  });
});

describe("a remote-written classic histogram", () => {
  test("each bucket is its own series, with its le", async () => {
    const samples: Array<PromQLVectorResultSample> = await vectorAt(
      "latency_seconds_bucket",
      60000,
    );

    expect(
      samples
        .map((sample: PromQLVectorResultSample): string => {
          return `${sample.labels["le"]}=${sample.value}`;
        })
        .sort(),
    ).toEqual(["+Inf=100", "0.1=10", "0.5=50", "1=90"]);
  });

  test("histogram_quantile reads its buckets, as it reads Prometheus' own", async () => {
    /*
     * 75% of 100 is the 75th observation: in (0.5, 1], 25 of its 40 in,
     * so 0.5 + 0.5 * 25 / 40 = 0.8125.
     */
    const raw: Array<PromQLVectorResultSample> = await vectorAt(
      "histogram_quantile(0.75, latency_seconds_bucket)",
      60000,
    );

    expect(raw).toHaveLength(1);
    expect(raw[0]!.value).toBeCloseTo(0.8125, 10);
    expect(formatPromQLLabels(raw[0]!.labels)).not.toContain("le=");

    // Over rate(), as a dashboard asks: the same quantile.
    const rated: Array<PromQLVectorResultSample> = await vectorAt(
      "histogram_quantile(0.75, sum by (le) (rate(latency_seconds_bucket[5m])))",
      60000,
    );

    expect(rated).toHaveLength(1);
    expect(rated[0]!.value).toBeCloseTo(0.8125, 10);
  });

  test("a matcher on le picks one bucket", async () => {
    const samples: Array<PromQLVectorResultSample> = await vectorAt(
      'latency_seconds_bucket{le="0.5"}',
      60000,
    );

    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(50);
  });
});

describe("a remote-written summary", () => {
  test("each quantile is its own series, with its quantile", async () => {
    const samples: Array<PromQLVectorResultSample> = await vectorAt(
      'rpc_duration_seconds{quantile="0.99"}',
      60000,
    );

    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(0.48);
  });
});

describe("the source's series", () => {
  test("keep le and quantile only where the stored point carries them", async () => {
    const source: PromQLMetricSeriesSource = new PromQLMetricSeriesSource({
      projectId: PROJECT_ID,
      serviceFilter: {},
      listStoredNames: async (): Promise<Array<string>> => {
        return ["http_requests_total"];
      },
      readRows: async (): Promise<Array<JSONObject>> => {
        return ROWS;
      },
    });

    const series: Array<PromQLSeries> = await source.select({
      metricName: "http_requests_total",
      matchers: [
        {
          name: "__name__",
          type: PromQLMatchType.Equal,
          value: "http_requests_total",
        },
      ],
      startTimeMs: -1,
      endTimeMs: 120000,
    });

    expect(series).toHaveLength(1);
    expect(series[0]!.labels["le"]).toBeUndefined();
    expect(series[0]!.labels["quantile"]).toBeUndefined();
  });
});
