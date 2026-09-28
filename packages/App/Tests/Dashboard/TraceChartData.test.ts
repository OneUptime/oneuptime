import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";
import {
  TRACE_CHART_PALETTE,
  TimeseriesRow,
  TraceChartArguments,
  TraceSeriesColorOptions,
  buildTraceAnalyticsRequest,
  computeBucketSizeInMinutes,
  formatCount,
  formatDurationMs,
  formatTickTime,
  formatTraceSeriesLabel,
  hexToRgba,
  isDurationMetric,
  parseAttributeFilters,
  pivotTimeseries,
  resolveTraceAttributeFilters,
  resolveTraceSeriesColor,
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

describe("TraceChartData.resolveTraceAttributeFilters", () => {
  const telemetryVariable: (
    overrides: Partial<DashboardVariable>,
  ) => DashboardVariable = (
    overrides: Partial<DashboardVariable>,
  ): DashboardVariable => {
    return {
      id: "v1",
      name: "cluster",
      type: DashboardVariableType.TelemetryAttribute,
      attributeKey: "k8s.cluster.name",
      ...overrides,
    };
  };

  test("no variables leaves the widget's own filters untouched", () => {
    expect(
      resolveTraceAttributeFilters({
        attributeFilters: { "url.host": "torginol.starship.online" },
      }),
    ).toEqual({ "url.host": "torginol.starship.online" });
  });

  test("single-select variable adds an exact predicate", () => {
    expect(
      resolveTraceAttributeFilters({
        attributeFilters: { "url.host": "torginol.starship.online" },
        variables: [telemetryVariable({ selectedValue: "prod-eu" })],
      }),
    ).toEqual({
      "url.host": "torginol.starship.online",
      "k8s.cluster.name": "prod-eu",
    });
  });

  /*
   * The regression this whole change exists for: a multi-select resolves to
   * an Includes operator, which must reach the wire as a plain array. Sending
   * the operator object instead is what the server used to silently drop.
   */
  test("multi-select variable becomes a plain array of values", () => {
    expect(
      resolveTraceAttributeFilters({
        variables: [
          telemetryVariable({
            isMultiSelect: true,
            selectedValues: ["prod-eu", "prod-us"],
          }),
        ],
      }),
    ).toEqual({ "k8s.cluster.name": ["prod-eu", "prod-us"] });
  });

  test('variable set to "All" removes the widget filter on that key', () => {
    expect(
      resolveTraceAttributeFilters({
        attributeFilters: { "k8s.cluster.name": "prod-eu", "url.host": "x" },
        variables: [telemetryVariable({ selectedValue: "" })],
      }),
    ).toEqual({ "url.host": "x" });
  });

  test("empty multi-select selection means All, not an empty IN list", () => {
    expect(
      resolveTraceAttributeFilters({
        variables: [
          telemetryVariable({ isMultiSelect: true, selectedValues: [] }),
        ],
      }),
    ).toEqual({});
  });

  test("variable value overrides a widget filter on the same key", () => {
    expect(
      resolveTraceAttributeFilters({
        attributeFilters: { "k8s.cluster.name": "prod-eu" },
        variables: [telemetryVariable({ selectedValue: "prod-us" })],
      }),
    ).toEqual({ "k8s.cluster.name": "prod-us" });
  });

  test("non-telemetry-attribute variables are ignored", () => {
    expect(
      resolveTraceAttributeFilters({
        attributeFilters: { "url.host": "x" },
        variables: [
          {
            id: "v2",
            name: "env",
            type: DashboardVariableType.TextInput,
            selectedValue: "prod",
          },
        ],
      }),
    ).toEqual({ "url.host": "x" });
  });

  test("legacy semicolon filters still interpolate", () => {
    expect(
      resolveTraceAttributeFilters({
        attributeFilters: "url.host=torginol.starship.online",
        variables: [telemetryVariable({ selectedValue: "prod-eu" })],
      }),
    ).toEqual({
      "url.host": "torginol.starship.online",
      "k8s.cluster.name": "prod-eu",
    });
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

  test("dashboard variable selections reach request.attributes", () => {
    const request: JSONObject = buildTraceAnalyticsRequest({
      arguments: { metric: "count", attributeFilters: { "url.host": "x" } },
      startTime: START,
      endTime: END_1H,
      variables: [
        {
          id: "v1",
          name: "cluster",
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: "k8s.cluster.name",
          isMultiSelect: true,
          selectedValues: ["prod-eu", "prod-us"],
        },
      ],
    });

    expect(request["attributes"]).toEqual({
      "url.host": "x",
      "k8s.cluster.name": ["prod-eu", "prod-us"],
    });
  });

  test("a variable alone is enough to emit request.attributes", () => {
    const request: JSONObject = buildTraceAnalyticsRequest({
      arguments: { metric: "count" },
      startTime: START,
      endTime: END_1H,
      variables: [
        {
          id: "v1",
          name: "cluster",
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: "k8s.cluster.name",
          selectedValue: "prod-eu",
        },
      ],
    });

    expect(request["attributes"]).toEqual({ "k8s.cluster.name": "prod-eu" });
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

describe("TraceChartData.resolveTraceSeriesColor", () => {
  test("no overrides: colors follow the default palette by index", () => {
    expect(resolveTraceSeriesColor("count", 0, {})).toBe(
      TRACE_CHART_PALETTE[0],
    );
    expect(resolveTraceSeriesColor("b", 1, {})).toBe(TRACE_CHART_PALETTE[1]);
    // Wraps around when there are more series than palette entries.
    expect(resolveTraceSeriesColor("k", TRACE_CHART_PALETTE.length, {})).toBe(
      TRACE_CHART_PALETTE[0],
    );
  });

  test("lead color heads the palette (single series renders exactly it)", () => {
    expect(resolveTraceSeriesColor("count", 0, { color: "#123456" })).toBe(
      "#123456",
    );
    // The rest of the palette shifts down by one.
    expect(resolveTraceSeriesColor("b", 1, { color: "#123456" })).toBe(
      TRACE_CHART_PALETTE[0],
    );
  });

  test("per-series pin wins over lead color and palette", () => {
    const options: Parameters<typeof resolveTraceSeriesColor>[2] = {
      color: "#123456",
      groupByAttribute: "url.host",
      colorsByGroup: { "url.host=api.example.com": "#10b981" },
    };
    expect(resolveTraceSeriesColor("api.example.com", 0, options)).toBe(
      "#10b981",
    );
    // Unpinned series fall back to lead color / palette by position.
    expect(resolveTraceSeriesColor("other.example.com", 1, options)).toBe(
      TRACE_CHART_PALETTE[0],
    );
  });

  test("pins keyed under a different split attribute do not match", () => {
    expect(
      resolveTraceSeriesColor("api.example.com", 0, {
        groupByAttribute: "name",
        colorsByGroup: { "url.host=api.example.com": "#10b981" },
      }),
    ).toBe(TRACE_CHART_PALETTE[0]);
  });

  test("pins are ignored when the chart is not split", () => {
    expect(
      resolveTraceSeriesColor("api.example.com", 0, {
        colorsByGroup: { "url.host=api.example.com": "#10b981" },
      }),
    ).toBe(TRACE_CHART_PALETTE[0]);
  });
});

/*
 * A widget split by span status gets one series per stored value, "0" / "1" /
 * "2" (the server's toString(statusCode)). Each status keeps its own color
 * wherever it lands in the series order, the same colors the Traces explorer
 * uses (#4118). Every other split still goes by palette position.
 */
describe("TraceChartData.resolveTraceSeriesColor for a status split", () => {
  const UNSET_COLOR: string = "#10b981";
  const OK_COLOR: string = "#047857";
  const ERROR_COLOR: string = "#ef4444";
  const LEAD_COLOR: string = "#123456";

  const STATUS_SPLIT: TraceSeriesColorOptions = {
    groupByAttribute: "statusCode",
  };

  test("Unset is green, Ok a deeper green and Error red", () => {
    expect(resolveTraceSeriesColor("0", 0, STATUS_SPLIT)).toBe(UNSET_COLOR);
    expect(resolveTraceSeriesColor("1", 1, STATUS_SPLIT)).toBe(OK_COLOR);
    expect(resolveTraceSeriesColor("2", 2, STATUS_SPLIT)).toBe(ERROR_COLOR);
  });

  /*
   * By position alone, Error got whatever the palette held at its index, and
   * index 2 is green (#10b981): a chart whose third series was Error drew its
   * failures in the success color.
   */
  test("REGRESSION: Error is red at every series position (#4118)", () => {
    for (let index: number = 0; index <= 12; index++) {
      expect(resolveTraceSeriesColor("2", index, STATUS_SPLIT)).toBe(
        ERROR_COLOR,
      );
    }
  });

  test("Unset and Ok keep their colors at every series position", () => {
    for (let index: number = 0; index <= 12; index++) {
      expect(resolveTraceSeriesColor("0", index, STATUS_SPLIT)).toBe(
        UNSET_COLOR,
      );
      expect(resolveTraceSeriesColor("1", index, STATUS_SPLIT)).toBe(OK_COLOR);
    }
  });

  test("a lead color neither shifts nor replaces the status colors", () => {
    const options: TraceSeriesColorOptions = {
      ...STATUS_SPLIT,
      color: LEAD_COLOR,
    };
    for (let index: number = 0; index <= 12; index++) {
      expect(resolveTraceSeriesColor("0", index, options)).toBe(UNSET_COLOR);
      expect(resolveTraceSeriesColor("1", index, options)).toBe(OK_COLOR);
      expect(resolveTraceSeriesColor("2", index, options)).toBe(ERROR_COLOR);
    }
  });

  test("whitespace around the split attribute is ignored", () => {
    const options: TraceSeriesColorOptions = {
      groupByAttribute: " statusCode ",
    };
    expect(resolveTraceSeriesColor("0", 2, options)).toBe(UNSET_COLOR);
    expect(resolveTraceSeriesColor("1", 0, options)).toBe(OK_COLOR);
    expect(resolveTraceSeriesColor("2", 2, options)).toBe(ERROR_COLOR);
  });

  test("a per-series pin still wins over the status color", () => {
    const options: TraceSeriesColorOptions = {
      ...STATUS_SPLIT,
      color: LEAD_COLOR,
      colorsByGroup: { "statusCode=2": "#f59e0b" },
    };
    expect(resolveTraceSeriesColor("2", 0, options)).toBe("#f59e0b");
    // The unpinned statuses keep their own colors, not the palette's.
    expect(resolveTraceSeriesColor("0", 1, options)).toBe(UNSET_COLOR);
    expect(resolveTraceSeriesColor("1", 2, options)).toBe(OK_COLOR);
    // Pins are keyed by the trimmed attribute, like every other split.
    expect(
      resolveTraceSeriesColor("2", 0, {
        groupByAttribute: " statusCode ",
        colorsByGroup: { "statusCode=2": "#f59e0b" },
      }),
    ).toBe("#f59e0b");
  });

  test("a pin under another split attribute does not recolor a status", () => {
    expect(
      resolveTraceSeriesColor("2", 2, {
        ...STATUS_SPLIT,
        colorsByGroup: { "kind=2": "#f59e0b" },
      }),
    ).toBe(ERROR_COLOR);
  });

  test("keys that are not a stored status go by palette position as before", () => {
    for (const seriesKey of ["7", "", "0 / api"]) {
      expect(resolveTraceSeriesColor(seriesKey, 0, STATUS_SPLIT)).toBe(
        TRACE_CHART_PALETTE[0],
      );
      expect(resolveTraceSeriesColor(seriesKey, 3, STATUS_SPLIT)).toBe(
        TRACE_CHART_PALETTE[3],
      );
      // The lead color still heads the palette for them.
      expect(
        resolveTraceSeriesColor(seriesKey, 0, {
          ...STATUS_SPLIT,
          color: LEAD_COLOR,
        }),
      ).toBe(LEAD_COLOR);
      expect(
        resolveTraceSeriesColor(seriesKey, 1, {
          ...STATUS_SPLIT,
          color: LEAD_COLOR,
        }),
      ).toBe(TRACE_CHART_PALETTE[0]);
    }
  });

  test("other splits go by palette position, even for status-like keys", () => {
    for (const groupByAttribute of ["kind", "name", "statusMessage"]) {
      for (let index: number = 0; index <= 12; index++) {
        expect(resolveTraceSeriesColor("2", index, { groupByAttribute })).toBe(
          TRACE_CHART_PALETTE[index % TRACE_CHART_PALETTE.length],
        );
      }
      expect(
        resolveTraceSeriesColor("2", 0, {
          groupByAttribute,
          color: LEAD_COLOR,
        }),
      ).toBe(LEAD_COLOR);
    }
  });

  test("an unsplit chart is not a status split", () => {
    expect(resolveTraceSeriesColor("2", 1, {})).toBe(TRACE_CHART_PALETTE[1]);
    expect(resolveTraceSeriesColor("0", 1, { groupByAttribute: "  " })).toBe(
      TRACE_CHART_PALETTE[1],
    );
  });
});

describe("TraceChartData.formatTraceSeriesLabel", () => {
  // The legend used to print the raw stored value: "0", "1", "2".
  test("REGRESSION: a status split names each status instead of 0 / 1 / 2 (#4118)", () => {
    expect(formatTraceSeriesLabel("0", "statusCode")).toBe("Unset (no error)");
    expect(formatTraceSeriesLabel("1", "statusCode")).toBe("Ok");
    expect(formatTraceSeriesLabel("2", "statusCode")).toBe("Error");
  });

  test("whitespace around the split attribute is ignored", () => {
    expect(formatTraceSeriesLabel("0", " statusCode ")).toBe(
      "Unset (no error)",
    );
    expect(formatTraceSeriesLabel("2", " statusCode ")).toBe("Error");
  });

  test("keys that are not a stored status are shown verbatim", () => {
    for (const seriesKey of ["7", "", "0 / api"]) {
      expect(formatTraceSeriesLabel(seriesKey, "statusCode")).toBe(seriesKey);
    }
  });

  test("other splits show the key verbatim, even status-like ones", () => {
    expect(formatTraceSeriesLabel("2", "kind")).toBe("2");
    expect(formatTraceSeriesLabel("0", "name")).toBe("0");
    expect(formatTraceSeriesLabel("api.example.com", "url.host")).toBe(
      "api.example.com",
    );
  });

  test("an unsplit chart shows the key verbatim", () => {
    expect(formatTraceSeriesLabel("count", undefined)).toBe("count");
    expect(formatTraceSeriesLabel("2", undefined)).toBe("2");
    expect(formatTraceSeriesLabel("0", "")).toBe("0");
  });
});

describe("TraceChartData.hexToRgba", () => {
  test("expands 6-digit and 3-digit hex", () => {
    expect(hexToRgba("#6366f1", 0.08)).toBe("rgba(99,102,241,0.08)");
    expect(hexToRgba("#fff", 0.5)).toBe("rgba(255,255,255,0.5)");
  });

  test("malformed input falls back to the default indigo", () => {
    expect(hexToRgba("not-a-color", 0.08)).toBe("rgba(99,102,241,0.08)");
    expect(hexToRgba("", 0.08)).toBe("rgba(99,102,241,0.08)");
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
