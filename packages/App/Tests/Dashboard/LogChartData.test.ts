import { describe, expect, test } from "@jest/globals";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";
import { JSONObject } from "Common/Types/JSON";
import DashboardChartType from "Common/Types/Dashboard/Chart/ChartType";
import {
  LogChartArguments,
  LogChartPivotResult,
  LogHistogramBucket,
  buildLogHistogramRequest,
  computeBucketSizeInMinutes,
  formatLogChartTickTime,
  formatLogCount,
  getExactAttributeFilters,
  pivotLogHistogramBuckets,
  resolveLogChartType,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/LogChartData";

const START: Date = new Date("2026-06-01T00:00:00.000Z");
const END_1H: Date = new Date("2026-06-01T01:00:00.000Z");

function buildRequest(
  overrides: Partial<LogChartArguments> = {},
  variables?: Array<DashboardVariable>,
): JSONObject {
  return buildLogHistogramRequest({
    arguments: overrides,
    startTime: START,
    endTime: END_1H,
    variables,
  });
}

describe("LogChartData.buildLogHistogramRequest", () => {
  test("uses the dashboard range and omits empty filters", () => {
    const request: JSONObject = buildRequest();

    expect(request).toEqual({
      startTime: "2026-06-01T00:00:00.000Z",
      endTime: "2026-06-01T01:00:00.000Z",
      bucketSizeInMinutes: 1,
    });
  });

  test("composes severity, body and structured attribute filters", () => {
    const request: JSONObject = buildRequest({
      severityFilters: ["Error", "Warning"],
      bodyContains: "  timeout  ",
      attributeFilters: {
        "deployment.environment": "production",
        region: "eu-west-1",
        attempts: 3,
        healthy: true,
      },
    });

    expect(request["severityTexts"]).toEqual(["Error", "Warning"]);
    expect(request["bodySearchText"]).toBe("timeout");
    expect(request["attributes"]).toEqual({
      "deployment.environment": "production",
      region: "eu-west-1",
      attempts: "3",
      healthy: "true",
    });
  });

  test("ignores service ids left on a legacy saved widget", () => {
    const request: JSONObject = buildRequest({
      serviceIds: ["service-a"],
    } as unknown as Partial<LogChartArguments>);

    expect(request["serviceIds"]).toBeUndefined();
  });

  test("dashboard attribute variables are applied to the request", () => {
    const variables: Array<DashboardVariable> = [
      {
        id: "environment",
        name: "environment",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "deployment.environment",
        selectedValue: "staging",
      },
      {
        id: "regions",
        name: "regions",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "region",
        isMultiSelect: true,
        selectedValues: ["eu-west-1", "us-east-1"],
      },
    ];

    expect(
      buildRequest(
        {
          attributeFilters: {
            "deployment.environment": "production",
          },
        },
        variables,
      )["attributes"],
    ).toEqual({
      "deployment.environment": "staging",
      region: ["eu-west-1", "us-east-1"],
    });
  });
});

describe("LogChartData.getExactAttributeFilters", () => {
  test("keeps structured equality filters", () => {
    expect(
      getExactAttributeFilters({
        attributeFilters: {
          "http.status_code": 500,
          method: "POST /shipments:retry",
        },
      }),
    ).toEqual({
      "http.status_code": "500",
      method: "POST /shipments:retry",
    });
  });

  test("reads the legacy query when structured filters are absent", () => {
    expect(
      getExactAttributeFilters({
        attributeFilterQuery: "@http.status_code:500 @method:POST",
      }),
    ).toEqual({
      "http.status_code": "500",
      method: "POST",
    });
  });

  test("an explicitly cleared structured filter does not resurrect legacy input", () => {
    expect(
      getExactAttributeFilters({
        attributeFilters: {},
        attributeFilterQuery: "@deployment.environment:production",
      }),
    ).toEqual({});
  });

  test("returns an empty record for empty input", () => {
    expect(getExactAttributeFilters({})).toEqual({});
    expect(getExactAttributeFilters({ attributeFilterQuery: "   " })).toEqual(
      {},
    );
  });
});

describe("LogChartData.pivotLogHistogramBuckets", () => {
  test("pivots severities into stacked series and sums duplicate rows", () => {
    const buckets: Array<LogHistogramBucket> = [
      { time: "t1", severity: "Information", count: 3 },
      { time: "t1", severity: "Error", count: 2 },
      { time: "t1", severity: "Error", count: 4 },
      { time: "t2", severity: "Warning", count: 1 },
    ];

    expect(pivotLogHistogramBuckets(buckets)).toEqual({
      pivotedData: [
        { time: "t1", Information: 3, Error: 6, Warning: 0 },
        { time: "t2", Warning: 1, Error: 0, Information: 0 },
      ],
      severities: ["Error", "Warning", "Information"],
    });
  });

  test("fills quiet buckets so time gaps are not visually collapsed", () => {
    const result: LogChartPivotResult = pivotLogHistogramBuckets(
      [
        {
          time: "2026-06-01T00:00:00.000Z",
          severity: "Error",
          count: 2,
        },
        {
          time: "2026-06-01T03:00:00.000Z",
          severity: "Error",
          count: 1,
        },
      ],
      {
        startTime: new Date("2026-06-01T00:00:00.000Z"),
        endTime: new Date("2026-06-01T03:00:00.000Z"),
        bucketSizeInMinutes: 60,
      },
    );

    expect(result.pivotedData).toEqual([
      { time: "2026-06-01T00:00:00.000Z", Error: 2 },
      { time: "2026-06-01T01:00:00.000Z", Error: 0 },
      { time: "2026-06-01T02:00:00.000Z", Error: 0 },
      { time: "2026-06-01T03:00:00.000Z", Error: 1 },
    ]);
  });

  test("preserves unknown severity series after the known severity order", () => {
    const result: LogChartPivotResult = pivotLogHistogramBuckets([
      { time: "t1", severity: "Custom", count: 1 },
      { time: "t1", severity: "Fatal", count: 2 },
    ]);

    expect(result.severities).toEqual(["Fatal", "Custom"]);
  });

  test("empty rows produce an empty chart", () => {
    expect(pivotLogHistogramBuckets([])).toEqual({
      pivotedData: [],
      severities: [],
    });
  });
});

describe("LogChartData bucket sizing and formatters", () => {
  const minutesApart: (minutes: number) => number = (
    minutes: number,
  ): number => {
    return computeBucketSizeInMinutes(
      START,
      new Date(START.getTime() + minutes * 60 * 1000),
    );
  };

  test("scales buckets with the selected dashboard range", () => {
    expect(minutesApart(60)).toBe(1);
    expect(minutesApart(61)).toBe(5);
    expect(minutesApart(361)).toBe(15);
    expect(minutesApart(1441)).toBe(60);
    expect(minutesApart(10081)).toBe(360);
    expect(minutesApart(43201)).toBe(1440);
  });

  test("resolves supported chart types and safely defaults to bars", () => {
    expect(resolveLogChartType(DashboardChartType.Line)).toBe(
      DashboardChartType.Line,
    );
    expect(resolveLogChartType(DashboardChartType.Area)).toBe(
      DashboardChartType.Area,
    );
    expect(resolveLogChartType(DashboardChartType.Bar)).toBe(
      DashboardChartType.Bar,
    );
    expect(resolveLogChartType(DashboardChartType.Pie)).toBe(
      DashboardChartType.Bar,
    );
    expect(resolveLogChartType(undefined)).toBe(DashboardChartType.Bar);
  });

  test("formats counts and invalid timestamps", () => {
    expect(formatLogCount(950)).toBe("950");
    expect(formatLogCount(1500)).toBe("1.5K");
    expect(formatLogCount(2_000_000)).toBe("2.0M");
    expect(formatLogChartTickTime("not-a-date")).toBe("not-a-date");
    expect(formatLogChartTickTime("2026-06-01T00:00:00.000Z", true)).toContain(
      ",",
    );
  });
});
