import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  TimeseriesRow,
  TraceChartArguments,
  buildTraceAnalyticsRequest,
  computeBucketSizeInMinutes,
  formatCount,
  formatDurationMs,
  formatTickTime,
  isDurationMetric,
  parseAttributeFilters,
  pivotTimeseries,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/TraceChartData";

/*
 * Validates the data path a trace-chart widget walks when its Query options
 * are set: stored arguments -> POST /telemetry/traces/analytics body, and the
 * returned rows -> the series the chart draws. The backend's own consumption
 * of these fields is covered by TraceAggregationService.test.ts.
 */

const START: Date = new Date("2026-06-01T00:00:00.000Z");
// 60 minutes later -> bucket size 1 (the smallest tier).
const END_1H: Date = new Date("2026-06-01T01:00:00.000Z");

type BuildArgs = (overrides?: Partial<TraceChartArguments>) => JSONObject;

const buildRequest: BuildArgs = (
  overrides: Partial<TraceChartArguments> = {},
): JSONObject => {
  return buildTraceAnalyticsRequest({
    arguments: { metric: "count", topLimit: 10, ...overrides },
    startTime: START,
    endTime: END_1H,
  });
};

describe("TraceChartData.parseAttributeFilters", () => {
  test("structured record passes through as string values", () => {
    expect(
      parseAttributeFilters({ "url.host": "torginol.starship.online" }),
    ).toEqual({ "url.host": "torginol.starship.online" });
  });

  test("multiple structured filters are all kept", () => {
    expect(
      parseAttributeFilters({
        "url.host": "torginol.starship.online",
        "http.method": "POST",
      }),
    ).toEqual({
      "url.host": "torginol.starship.online",
      "http.method": "POST",
    });
  });

  test("legacy semicolon string is parsed (backward compatible)", () => {
    expect(
      parseAttributeFilters(
        "url.host=torginol.starship.online; http.method=POST",
      ),
    ).toEqual({
      "url.host": "torginol.starship.online",
      "http.method": "POST",
    });
  });

  test("legacy string trims whitespace around keys and values", () => {
    expect(parseAttributeFilters("  a = b ;  c = d ")).toEqual({
      a: "b",
      c: "d",
    });
  });

  test("numeric and boolean scalar values are stringified", () => {
    expect(
      parseAttributeFilters({ "http.status": 500, "flag.enabled": true }),
    ).toEqual({ "http.status": "500", "flag.enabled": "true" });
  });

  test("empty key, empty value, null and undefined are dropped", () => {
    expect(
      parseAttributeFilters({
        "": "ignored",
        "a.key": "",
        "b.key": null as unknown as string,
        "c.key": undefined as unknown as string,
        "d.key": "kept",
      }),
    ).toEqual({ "d.key": "kept" });
  });

  test("operator-wrapped object value is defensively unwrapped", () => {
    expect(
      parseAttributeFilters({
        "url.host": { value: "torginol.starship.online" } as unknown as string,
      }),
    ).toEqual({ "url.host": "torginol.starship.online" });
  });

  test("undefined / empty inputs yield an empty record", () => {
    expect(parseAttributeFilters(undefined)).toEqual({});
    expect(parseAttributeFilters("")).toEqual({});
    expect(parseAttributeFilters({})).toEqual({});
  });
});

describe("TraceChartData.buildTraceAnalyticsRequest", () => {
  test("defaults: count, limit 10, rootOnly true, no optional filters", () => {
    const request: JSONObject = buildRequest();

    expect(request["chartType"]).toBe("timeseries");
    expect(request["metric"]).toBe("count");
    expect(request["limit"]).toBe(10);
    expect(request["rootOnly"]).toBe(true);
    expect(request["bucketSizeInMinutes"]).toBe(1);
    expect(request["startTime"]).toBe("2026-06-01T00:00:00.000Z");
    expect(request["endTime"]).toBe("2026-06-01T01:00:00.000Z");
    // Optional filters must be absent, not empty objects/arrays.
    expect(request["attributes"]).toBeUndefined();
    expect(request["groupBy"]).toBeUndefined();
    expect(request["spanNameSearches"]).toBeUndefined();
  });

  test("structured attribute filter becomes request.attributes", () => {
    const request: JSONObject = buildRequest({
      attributeFilters: { "url.host": "torginol.starship.online" },
    });
    expect(request["attributes"]).toEqual({
      "url.host": "torginol.starship.online",
    });
  });

  test("legacy attribute-filter string still becomes request.attributes", () => {
    const request: JSONObject = buildRequest({
      attributeFilters: "url.host=torginol.starship.online; http.method=POST",
    });
    expect(request["attributes"]).toEqual({
      "url.host": "torginol.starship.online",
      "http.method": "POST",
    });
  });

  test("split by a span attribute becomes request.groupBy", () => {
    const request: JSONObject = buildRequest({ groupByAttribute: "url.host" });
    expect(request["groupBy"]).toEqual(["url.host"]);
  });

  test("split by a special dimension passes the column name through", () => {
    for (const dimension of ["name", "statusCode", "kind"]) {
      const request: JSONObject = buildRequest({
        groupByAttribute: dimension,
      });
      expect(request["groupBy"]).toEqual([dimension]);
    }
  });

  test("blank split value is omitted", () => {
    const request: JSONObject = buildRequest({ groupByAttribute: "   " });
    expect(request["groupBy"]).toBeUndefined();
  });

  test("max series sets request.limit", () => {
    expect(buildRequest({ topLimit: 3 })["limit"]).toBe(3);
  });

  test("missing max series falls back to 10", () => {
    const request: JSONObject = buildTraceAnalyticsRequest({
      arguments: { metric: "count" },
      startTime: START,
      endTime: END_1H,
    });
    expect(request["limit"]).toBe(10);
  });

  test("zero max series falls back to 10 (server then clamps)", () => {
    expect(buildRequest({ topLimit: 0 })["limit"]).toBe(10);
  });

  test("error-count metric still composes a grouped request", () => {
    const request: JSONObject = buildRequest({
      metric: "errorCount",
      groupByAttribute: "url.host",
    });
    expect(request["metric"]).toBe("errorCount");
    expect(request["groupBy"]).toEqual(["url.host"]);
  });

  test("string max series is coerced to a number", () => {
    const request: JSONObject = buildRequest({
      topLimit: "5" as unknown as number,
    });
    expect(request["limit"]).toBe(5);
  });

  test("include child spans flips rootOnly off", () => {
    expect(buildRequest({ includeChildSpans: true })["rootOnly"]).toBe(false);
    expect(buildRequest({ includeChildSpans: false })["rootOnly"]).toBe(true);
  });

  test("span name contains becomes request.spanNameSearches", () => {
    const request: JSONObject = buildRequest({
      spanNameContains: "/Shipment/ShipShipment",
    });
    expect(request["spanNameSearches"]).toEqual(["/Shipment/ShipShipment"]);
  });

  test("whitespace-only span name is omitted", () => {
    expect(buildRequest({ spanNameContains: "   " })["spanNameSearches"]).toBe(
      undefined,
    );
  });

  test("all options together compose into one coherent request", () => {
    const request: JSONObject = buildRequest({
      metric: "p90Duration",
      attributeFilters: { "url.host": "x" },
      groupByAttribute: "url.host",
      topLimit: 5,
      includeChildSpans: true,
      spanNameContains: "Ship",
    });
    expect(request["metric"]).toBe("p90Duration");
    expect(request["attributes"]).toEqual({ "url.host": "x" });
    expect(request["groupBy"]).toEqual(["url.host"]);
    expect(request["limit"]).toBe(5);
    expect(request["rootOnly"]).toBe(false);
    expect(request["spanNameSearches"]).toEqual(["Ship"]);
  });
});

describe("TraceChartData.pivotTimeseries", () => {
  test("no rows yields no series", () => {
    expect(pivotTimeseries([], "count")).toEqual({
      pivotedData: [],
      seriesKeys: [],
    });
  });

  test("unsplit rows form a single series keyed by the metric", () => {
    const rows: Array<TimeseriesRow> = [
      { time: "t1", value: 5, groupValues: {} },
      { time: "t2", value: 7, groupValues: {} },
    ];
    const { pivotedData, seriesKeys } = pivotTimeseries(rows, "count");

    expect(seriesKeys).toEqual(["count"]);
    expect(pivotedData).toEqual([
      { time: "t1", count: 5 },
      { time: "t2", count: 7 },
    ]);
  });

  test("split rows form one column per group value", () => {
    const rows: Array<TimeseriesRow> = [
      { time: "t1", value: 5, groupValues: { "url.host": "a" } },
      { time: "t1", value: 9, groupValues: { "url.host": "b" } },
      { time: "t2", value: 6, groupValues: { "url.host": "a" } },
    ];
    const { pivotedData, seriesKeys } = pivotTimeseries(rows, "count");

    expect(seriesKeys).toEqual(["a", "b"]);
    expect(pivotedData).toEqual([
      { time: "t1", a: 5, b: 9 },
      { time: "t2", a: 6 },
    ]);
  });

  test("multi-dimension group values join with ' / '", () => {
    const rows: Array<TimeseriesRow> = [
      { time: "t1", value: 1, groupValues: { svc: "checkout", code: "200" } },
    ];
    expect(pivotTimeseries(rows, "count").seriesKeys).toEqual([
      "checkout / 200",
    ]);
  });

  test("duration metric, single series, is keyed by the metric name", () => {
    const rows: Array<TimeseriesRow> = [
      { time: "t1", value: 12.5, groupValues: {} },
    ];
    expect(pivotTimeseries(rows, "p90Duration").seriesKeys).toEqual([
      "p90Duration",
    ]);
  });
});

describe("TraceChartData.isDurationMetric", () => {
  test("count-style metrics are not durations (render as bars)", () => {
    expect(isDurationMetric("count")).toBe(false);
    expect(isDurationMetric("errorCount")).toBe(false);
  });

  test("everything else is a duration (render as area/line)", () => {
    for (const metric of [
      "avgDuration",
      "p50Duration",
      "p90Duration",
      "p95Duration",
      "p99Duration",
      "minDuration",
      "maxDuration",
    ]) {
      expect(isDurationMetric(metric)).toBe(true);
    }
  });
});

describe("TraceChartData.computeBucketSizeInMinutes", () => {
  const minutesApart: (minutes: number) => number = (
    minutes: number,
  ): number => {
    return computeBucketSizeInMinutes(
      START,
      new Date(START.getTime() + minutes * 60 * 1000),
    );
  };

  test("scales bucket size with the selected range", () => {
    expect(minutesApart(60)).toBe(1);
    expect(minutesApart(61)).toBe(5);
    expect(minutesApart(360)).toBe(5);
    expect(minutesApart(361)).toBe(15);
    expect(minutesApart(1440)).toBe(15);
    expect(minutesApart(1441)).toBe(60);
    expect(minutesApart(10080)).toBe(60);
    expect(minutesApart(10081)).toBe(360);
  });
});

describe("TraceChartData formatters", () => {
  test("formatCount abbreviates thousands and millions", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(1500)).toBe("1.5K");
    expect(formatCount(2_000_000)).toBe("2.0M");
  });

  test("formatDurationMs picks a sensible unit", () => {
    expect(formatDurationMs(0.5)).toBe("500 µs");
    expect(formatDurationMs(5)).toBe("5.0 ms");
    expect(formatDurationMs(1500)).toBe("1.50 s");
    expect(formatDurationMs(90000)).toBe("1.5 min");
    expect(formatDurationMs(Infinity)).toBe("-");
  });

  test("formatTickTime returns the input when it is not a date", () => {
    expect(formatTickTime("not-a-date")).toBe("not-a-date");
  });
});
