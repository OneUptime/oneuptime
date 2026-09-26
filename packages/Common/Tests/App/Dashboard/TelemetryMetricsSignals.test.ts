import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The data behind the telemetry overview tiles (Components/TelemetryResource
 * /telemetryMetrics.ts): the log and exception summaries, the whole-range
 * statistics for one span name (the RUM overview's page-load tiles), the
 * span RED metrics, and the web vitals.
 *
 * The network is replaced at the API client, so what is asserted is the
 * request each function really sends and how it folds the answer - in
 * particular that a failed lookup comes back marked as failed (the tile says
 * "could not load") rather than as a confident zero.
 */

const postMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const projectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { "x-test-header": "1" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>): unknown => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        return projectIdMock();
      },
    },
  };
});

import {
  fetchLogAndExceptionSignals,
  fetchSpanMetrics,
  fetchSpanNameStats,
  fetchWebVitalByRoute,
  fetchWebVitals,
  formatBytes as reexportedFormatBytes,
  formatCompact as reexportedFormatCompact,
  formatDurationMs as reexportedFormatDurationMs,
  formatPercent as reexportedFormatPercent,
  LogAndExceptionSignals,
  RawHistogramBucket,
  SpanMetrics,
  SpanNameStats,
  spanNameStatsFromTableRows,
  summarizeLogAndExceptionBuckets,
  TimePoint,
  WEB_VITAL_ROUTE_LIMIT,
  WebVital,
  WebVitalByRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics";
import {
  formatBytes,
  formatCompact,
  formatDurationMs,
  formatPercent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import {
  WebVitalDefinition,
  WebVitalDefinitions,
  WebVitalRouteAttributeKeys,
} from "../../../Types/Rum/WebVitals";
import { APP_API_URL } from "../../../UI/Config";

const ENTITY_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const START: Date = new Date("2026-09-24T10:00:00.000Z");
const END: Date = new Date("2026-09-24T11:00:00.000Z");

const T0: string = "2026-09-24T10:00:00.000Z";
const T1: string = "2026-09-24T10:05:00.000Z";
const T2: string = "2026-09-24T10:10:00.000Z";

interface PostRequest {
  url: URL;
  data: JSONObject;
  headers: Record<string, string>;
}

interface AggregateRequest {
  modelType: unknown;
  aggregateBy: {
    query: Record<string, unknown>;
    aggregationType: AggregationType;
    aggregationInterval?: AggregationInterval;
    aggregateColumnName: string;
    aggregationTimestampColumnName: string;
    startTimestamp: Date;
    endTimestamp: Date;
    groupByAttributeKeys?: Array<string>;
    topK?: { count: number; rankBy: string };
  };
}

function ok(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function httpError(status: number): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message: "denied" }, {});
}

function series(points: Array<TimePoint>): Array<[string, number]> {
  return points.map((p: TimePoint): [string, number] => {
    return [p.x.toISOString(), p.y];
  });
}

function postedTo(request: PostRequest): string {
  return request.url.toString();
}

function postRequests(): Array<PostRequest> {
  return postMock.mock.calls.map((call: Array<unknown>): PostRequest => {
    return call[0] as PostRequest;
  });
}

function aggregateRequests(): Array<AggregateRequest> {
  return aggregateMock.mock.calls.map(
    (call: Array<unknown>): AggregateRequest => {
      return call[0] as AggregateRequest;
    },
  );
}

beforeEach(() => {
  postMock.mockReset();
  aggregateMock.mockReset();
  projectIdMock.mockReset();
  projectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("summarizeLogAndExceptionBuckets", () => {
  test("a pillar whose request failed comes back zeroed and marked failed", () => {
    const result: LogAndExceptionSignals = summarizeLogAndExceptionBuckets(
      null,
      null,
    );

    expect(result).toEqual({
      logs: {
        total: 0,
        errorCount: 0,
        countSeries: [],
        errorSeries: [],
        failed: true,
      },
      exceptions: {
        total: 0,
        unhandledCount: 0,
        unhandledSeries: [],
        handledSeries: [],
        failed: true,
      },
    });
  });

  test("empty answers are real zeros, not failures", () => {
    const result: LogAndExceptionSignals = summarizeLogAndExceptionBuckets(
      [],
      [],
    );

    expect(result.logs.failed).toBe(false);
    expect(result.exceptions.failed).toBe(false);
    expect(result.logs.total).toBe(0);
    expect(result.exceptions.total).toBe(0);
  });

  test("one pillar failing leaves the other intact", () => {
    const logsOnly: LogAndExceptionSignals = summarizeLogAndExceptionBuckets(
      [{ time: T0, severity: "Info", count: 4 }],
      null,
    );

    expect(logsOnly.logs.failed).toBe(false);
    expect(logsOnly.logs.total).toBe(4);
    expect(logsOnly.exceptions.failed).toBe(true);

    const exceptionsOnly: LogAndExceptionSignals =
      summarizeLogAndExceptionBuckets(null, [
        { time: T0, series: "unhandled", count: 2 },
      ]);

    expect(exceptionsOnly.logs.failed).toBe(true);
    expect(exceptionsOnly.exceptions.failed).toBe(false);
    expect(exceptionsOnly.exceptions.total).toBe(2);
  });

  test("log totals add every bucket, whatever the severity", () => {
    const result: LogAndExceptionSignals = summarizeLogAndExceptionBuckets(
      [
        { time: T0, severity: "Info", count: 10 },
        { time: T0, severity: "Warning", count: 5 },
        { time: T1, severity: "Error", count: 3 },
        { time: T1, severity: "Fatal", count: 1 },
        { time: T2, severity: "Debug", count: 2 },
      ],
      [],
    );

    expect(result.logs.total).toBe(21);
  });

  test("only Error and Fatal count as errors - exact, case-sensitive severities", () => {
    const result: LogAndExceptionSignals = summarizeLogAndExceptionBuckets(
      [
        { time: T0, severity: "Error", count: 3 },
        { time: T0, severity: "Fatal", count: 1 },
        { time: T0, severity: "error", count: 100 },
        { time: T0, severity: "Warning", count: 100 },
        { time: T0, severity: "Critical", count: 100 },
        { time: T0, count: 100 },
      ],
      [],
    );

    expect(result.logs.errorCount).toBe(4);
    expect(series(result.logs.errorSeries)).toEqual([[T0, 4]]);
  });

  test("the log count series is merged per timestamp across severities and sorted", () => {
    const result: LogAndExceptionSignals = summarizeLogAndExceptionBuckets(
      [
        { time: T2, severity: "Info", count: 1 },
        { time: T0, severity: "Info", count: 10 },
        { time: T0, severity: "Error", count: 2 },
        { time: T1, severity: "Warning", count: 5 },
      ],
      [],
    );

    expect(series(result.logs.countSeries)).toEqual([
      [T0, 12],
      [T1, 5],
      [T2, 1],
    ]);
    expect(series(result.logs.errorSeries)).toEqual([[T0, 2]]);
  });

  test("series points are real Dates", () => {
    const result: LogAndExceptionSignals = summarizeLogAndExceptionBuckets(
      [{ time: T0, severity: "Info", count: 1 }],
      [{ time: T0, series: "handled", count: 1 }],
    );

    expect(result.logs.countSeries[0]!.x).toBeInstanceOf(Date);
    expect(result.exceptions.handledSeries[0]!.x).toBeInstanceOf(Date);
  });

  test("exceptions split unhandled from everything else, and the total counts both", () => {
    const result: LogAndExceptionSignals = summarizeLogAndExceptionBuckets(
      [],
      [
        { time: T0, series: "unhandled", count: 2 },
        { time: T0, series: "handled", count: 4 },
        { time: T1, series: "handled", count: 8 },
        { time: T2, series: "unhandled", count: 3 },
        { time: T2, count: 1 },
        { time: T2, series: "something-else", count: 1 },
      ],
    );

    expect(result.exceptions.total).toBe(19);
    expect(result.exceptions.unhandledCount).toBe(5);
    expect(series(result.exceptions.unhandledSeries)).toEqual([
      [T0, 2],
      [T2, 3],
    ]);
    expect(series(result.exceptions.handledSeries)).toEqual([
      [T0, 4],
      [T1, 8],
      [T2, 2],
    ]);
  });

  test("a bucket with a missing or unparseable time is kept out of the series", () => {
    const buckets: Array<RawHistogramBucket> = [
      { severity: "Error", count: 3 },
      { time: "not a time", severity: "Error", count: 4 },
      { time: T0, severity: "Error", count: 1 },
    ];
    const result: LogAndExceptionSignals = summarizeLogAndExceptionBuckets(
      buckets,
      [
        { series: "unhandled", count: 5 },
        { time: "garbage", series: "handled", count: 6 },
        { time: T1, series: "handled", count: 1 },
      ],
    );

    expect(series(result.logs.countSeries)).toEqual([[T0, 1]]);
    expect(series(result.logs.errorSeries)).toEqual([[T0, 1]]);
    expect(result.exceptions.unhandledSeries).toEqual([]);
    expect(series(result.exceptions.handledSeries)).toEqual([[T1, 1]]);
  });

  test("a bucket whose count is missing or not a number adds nothing", () => {
    const result: LogAndExceptionSignals = summarizeLogAndExceptionBuckets(
      [
        { time: T0, severity: "Error" },
        {
          time: T0,
          severity: "Error",
          count: "7" as unknown as number,
        },
        { time: T0, severity: "Error", count: 2 },
      ],
      [
        { time: T0, series: "unhandled" },
        { time: T0, series: "unhandled", count: 1 },
      ],
    );

    expect(result.logs.total).toBe(2);
    expect(result.logs.errorCount).toBe(2);
    expect(series(result.logs.countSeries)).toEqual([[T0, 2]]);
    expect(result.exceptions.total).toBe(1);
    expect(result.exceptions.unhandledCount).toBe(1);
  });
});

describe("spanNameStatsFromTableRows", () => {
  const ZERO: SpanNameStats = {
    count: 0,
    errorCount: 0,
    avgDurationMs: 0,
    p50DurationMs: 0,
    p95DurationMs: 0,
    p99DurationMs: 0,
  };

  test.each([
    ["an empty array", []],
    ["undefined", undefined],
    ["null", null],
    ["a string", "rows"],
    ["a number", 42],
    ["an object that is not an array", { count: 5 }],
    ["an array whose first row is null", [null]],
    ["an array whose first row is a string", ["row"]],
  ])("%s means no matching spans: zeros", (_: string, rows: unknown) => {
    expect(spanNameStatsFromTableRows(rows)).toEqual(ZERO);
  });

  test("reads every statistic from the first row", () => {
    expect(
      spanNameStatsFromTableRows([
        {
          groupValues: { name: "documentLoad" },
          count: 1234,
          errorCount: 3,
          avgDurationMs: 1000,
          p50DurationMs: 850,
          p90DurationMs: 2000,
          p95DurationMs: 2340,
          p99DurationMs: 4100,
        },
      ]),
    ).toEqual({
      count: 1234,
      errorCount: 3,
      avgDurationMs: 1000,
      p50DurationMs: 850,
      p95DurationMs: 2340,
      p99DurationMs: 4100,
    });
  });

  test("picks the first row and ignores the rest", () => {
    expect(
      spanNameStatsFromTableRows([
        { count: 5, p95DurationMs: 10 },
        { count: 999, p95DurationMs: 999 },
      ]),
    ).toEqual({ ...ZERO, count: 5, p95DurationMs: 10 });
  });

  test("numeric strings are read as numbers", () => {
    expect(
      spanNameStatsFromTableRows([{ count: "12", p50DurationMs: "7.5" }]),
    ).toEqual({ ...ZERO, count: 12, p50DurationMs: 7.5 });
  });

  test.each([
    ["missing", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a word", "slow"],
    ["an object", { value: 3 }],
  ])("a %s statistic reads as 0", (_: string, value: unknown) => {
    expect(
      spanNameStatsFromTableRows([{ count: 4, p95DurationMs: value }]),
    ).toEqual({ ...ZERO, count: 4 });
  });
});

describe("fetchSpanNameStats", () => {
  function request(): PostRequest {
    expect(postMock).toHaveBeenCalledTimes(1);
    return postRequests()[0]!;
  }

  test("asks the trace analytics endpoint for one table row of this span name under this entity", async () => {
    postMock.mockResolvedValue(ok({ data: [] }));

    await fetchSpanNameStats({
      primaryEntityId: new ObjectID(ENTITY_ID),
      spanName: "documentLoad",
      start: START,
      end: END,
    });

    const sent: PostRequest = request();

    expect(postedTo(sent)).toBe(
      `${APP_API_URL.toString()}/telemetry/traces/analytics`,
    );
    expect(sent.data).toEqual({
      startTime: START.toISOString(),
      endTime: END.toISOString(),
      chartType: "table",
      metric: "count",
      groupBy: ["name"],
      spanNames: ["documentLoad"],
      serviceIds: [ENTITY_ID],
      limit: 1,
    });
    expect(sent.headers).toEqual({ "x-test-header": "1" });
  });

  test("the span name is sent exactly as given", async () => {
    postMock.mockResolvedValue(ok({ data: [] }));

    await fetchSpanNameStats({
      primaryEntityId: new ObjectID(ENTITY_ID),
      spanName: "GET /api/checkout",
      start: START,
      end: END,
    });

    expect(request().data["spanNames"]).toEqual(["GET /api/checkout"]);
  });

  test("returns the first row's statistics", async () => {
    postMock.mockResolvedValue(
      ok({
        data: [
          {
            groupValues: { name: "documentLoad" },
            count: 40,
            errorCount: 2,
            avgDurationMs: 900,
            p50DurationMs: 800,
            p95DurationMs: 2100,
            p99DurationMs: 3000,
          },
        ],
      }),
    );

    await expect(
      fetchSpanNameStats({
        primaryEntityId: new ObjectID(ENTITY_ID),
        spanName: "documentLoad",
        start: START,
        end: END,
      }),
    ).resolves.toEqual({
      count: 40,
      errorCount: 2,
      avgDurationMs: 900,
      p50DurationMs: 800,
      p95DurationMs: 2100,
      p99DurationMs: 3000,
    });
  });

  test("no rows is a real zero", async () => {
    postMock.mockResolvedValue(ok({ data: [] }));

    const stats: SpanNameStats = await fetchSpanNameStats({
      primaryEntityId: new ObjectID(ENTITY_ID),
      spanName: "documentLoad",
      start: START,
      end: END,
    });

    expect(stats.count).toBe(0);
  });

  test.each([403, 500])(
    "an HTTP %d rejects, so the tile can say 'could not load'",
    async (status: number) => {
      const error: HTTPErrorResponse = httpError(status);
      postMock.mockResolvedValue(error);

      await expect(
        fetchSpanNameStats({
          primaryEntityId: new ObjectID(ENTITY_ID),
          spanName: "documentLoad",
          start: START,
          end: END,
        }),
      ).rejects.toBe(error);
    },
  );

  test("a network failure rejects too", async () => {
    postMock.mockRejectedValue(new Error("offline"));

    await expect(
      fetchSpanNameStats({
        primaryEntityId: new ObjectID(ENTITY_ID),
        spanName: "documentLoad",
        start: START,
        end: END,
      }),
    ).rejects.toThrow("offline");
  });
});

describe("fetchLogAndExceptionSignals", () => {
  const LOG_BUCKETS: Array<RawHistogramBucket> = [
    { time: T0, severity: "Info", count: 10 },
    { time: T1, severity: "Error", count: 2 },
  ];
  const EXCEPTION_BUCKETS: Array<RawHistogramBucket> = [
    { time: T0, series: "unhandled", count: 1 },
    { time: T1, series: "handled", count: 3 },
  ];

  function respond(handlers: {
    logs: () => Promise<unknown>;
    exceptions: () => Promise<unknown>;
  }): void {
    postMock.mockImplementation((...args: Array<unknown>) => {
      const url: string = postedTo(args[0] as PostRequest);

      if (url.endsWith("/telemetry/logs/histogram")) {
        return handlers.logs();
      }

      if (url.endsWith("/telemetry/exceptions/histogram")) {
        return handlers.exceptions();
      }

      return Promise.reject(new Error(`unexpected ${url}`));
    });
  }

  async function run(): Promise<LogAndExceptionSignals> {
    return fetchLogAndExceptionSignals({
      primaryEntityId: new ObjectID(ENTITY_ID),
      start: START,
      end: END,
    });
  }

  test("asks both histograms for the same entity and window", async () => {
    respond({
      logs: async () => {
        return ok({ buckets: LOG_BUCKETS as unknown as JSONObject });
      },
      exceptions: async () => {
        return ok({ buckets: EXCEPTION_BUCKETS as unknown as JSONObject });
      },
    });

    await run();

    const sent: Array<PostRequest> = postRequests();

    expect(sent.map(postedTo).sort()).toEqual(
      [
        `${APP_API_URL.toString()}/telemetry/exceptions/histogram`,
        `${APP_API_URL.toString()}/telemetry/logs/histogram`,
      ].sort(),
    );

    for (const request of sent) {
      expect(request.data).toEqual({
        startTime: START.toISOString(),
        endTime: END.toISOString(),
        serviceIds: [ENTITY_ID],
      });
      expect(request.headers).toEqual({ "x-test-header": "1" });
    }
  });

  test("both answering: totals and series from each pillar, nothing failed", async () => {
    respond({
      logs: async () => {
        return ok({ buckets: LOG_BUCKETS as unknown as JSONObject });
      },
      exceptions: async () => {
        return ok({ buckets: EXCEPTION_BUCKETS as unknown as JSONObject });
      },
    });

    const result: LogAndExceptionSignals = await run();

    expect(result.logs.failed).toBe(false);
    expect(result.logs.total).toBe(12);
    expect(result.logs.errorCount).toBe(2);
    expect(result.exceptions.failed).toBe(false);
    expect(result.exceptions.total).toBe(4);
    expect(result.exceptions.unhandledCount).toBe(1);
  });

  test("the logs endpoint refusing marks only logs failed", async () => {
    respond({
      logs: async () => {
        return httpError(403);
      },
      exceptions: async () => {
        return ok({ buckets: EXCEPTION_BUCKETS as unknown as JSONObject });
      },
    });

    const result: LogAndExceptionSignals = await run();

    expect(result.logs.failed).toBe(true);
    expect(result.logs.total).toBe(0);
    expect(result.exceptions.failed).toBe(false);
    expect(result.exceptions.total).toBe(4);
  });

  test("the exceptions endpoint throwing marks only exceptions failed", async () => {
    respond({
      logs: async () => {
        return ok({ buckets: LOG_BUCKETS as unknown as JSONObject });
      },
      exceptions: async () => {
        throw new Error("offline");
      },
    });

    const result: LogAndExceptionSignals = await run();

    expect(result.logs.failed).toBe(false);
    expect(result.logs.total).toBe(12);
    expect(result.exceptions.failed).toBe(true);
    expect(result.exceptions.total).toBe(0);
  });

  test("both failing marks both failed, and still resolves - the page never breaks", async () => {
    respond({
      logs: async () => {
        return httpError(500);
      },
      exceptions: async () => {
        throw new Error("offline");
      },
    });

    const result: LogAndExceptionSignals = await run();

    expect(result.logs.failed).toBe(true);
    expect(result.exceptions.failed).toBe(true);
  });

  test("an answer without a bucket array is an empty answer, not a failure", async () => {
    respond({
      logs: async () => {
        return ok({ buckets: "nope" });
      },
      exceptions: async () => {
        return ok({});
      },
    });

    const result: LogAndExceptionSignals = await run();

    expect(result.logs.failed).toBe(false);
    expect(result.logs.total).toBe(0);
    expect(result.exceptions.failed).toBe(false);
    expect(result.exceptions.total).toBe(0);
  });
});

describe("fetchSpanMetrics", () => {
  const NS_PER_MS: number = 1_000_000;

  function answer(byCall: Array<Array<JSONObject>>): void {
    let call: number = 0;
    aggregateMock.mockImplementation(async () => {
      const data: Array<JSONObject> = byCall[call] || [];
      call += 1;
      return { data };
    });
  }

  function queries(): Array<Record<string, unknown>> {
    return aggregateRequests().map(
      (r: AggregateRequest): Record<string, unknown> => {
        return r.aggregateBy.query;
      },
    );
  }

  test("with a span name, all three aggregates are narrowed to that name", async () => {
    answer([]);

    await fetchSpanMetrics({
      primaryEntityId: new ObjectID(ENTITY_ID),
      spanName: "documentLoad",
      start: START,
      end: END,
    });

    expect(aggregateMock).toHaveBeenCalledTimes(3);
    for (const query of queries()) {
      expect(query["name"]).toBe("documentLoad");
    }
  });

  test("without a span name, no aggregate filters on name", async () => {
    answer([]);

    await fetchSpanMetrics({
      primaryEntityId: new ObjectID(ENTITY_ID),
      start: START,
      end: END,
    });

    expect(aggregateMock).toHaveBeenCalledTimes(3);
    for (const query of queries()) {
      expect(Object.keys(query)).not.toContain("name");
    }
  });

  test("an empty span name is treated as no span name", async () => {
    answer([]);

    await fetchSpanMetrics({
      primaryEntityId: new ObjectID(ENTITY_ID),
      spanName: "",
      start: START,
      end: END,
    });

    for (const query of queries()) {
      expect(Object.keys(query)).not.toContain("name");
    }
  });

  test("count, error count and p95, each scoped to the project, entity and window", async () => {
    answer([]);

    await fetchSpanMetrics({
      primaryEntityId: new ObjectID(ENTITY_ID),
      spanName: "documentLoad",
      start: START,
      end: END,
    });

    const requests: Array<AggregateRequest> = aggregateRequests();

    expect(
      requests.map((r: AggregateRequest) => {
        return r.aggregateBy.aggregationType;
      }),
    ).toEqual([
      AggregationType.Count,
      AggregationType.Count,
      AggregationType.P95,
    ]);

    for (const r of requests) {
      const query: Record<string, unknown> = r.aggregateBy.query;

      expect(String(query["projectId"])).toBe(PROJECT_ID);
      expect(String(query["primaryEntityId"])).toBe(ENTITY_ID);
      expect(query["startTime"]).toBeInstanceOf(InBetween);
      expect((query["startTime"] as InBetween<Date>).startValue).toBe(START);
      expect((query["startTime"] as InBetween<Date>).endValue).toBe(END);
      expect(r.aggregateBy.aggregateColumnName).toBe("durationUnixNano");
      expect(r.aggregateBy.aggregationTimestampColumnName).toBe("startTime");
      expect(r.aggregateBy.startTimestamp).toBe(START);
      expect(r.aggregateBy.endTimestamp).toBe(END);
    }

    // Only the second count is narrowed to errors.
    expect(requests[0]!.aggregateBy.query["statusCode"]).toBeUndefined();
    expect(requests[1]!.aggregateBy.query["statusCode"]).toBe(SpanStatus.Error);
    expect(requests[1]!.aggregateBy.query["name"]).toBe("documentLoad");
    expect(requests[2]!.aggregateBy.query["statusCode"]).toBeUndefined();
  });

  test("attributes are passed through when given and left out when empty", async () => {
    answer([]);
    await fetchSpanMetrics({
      attributes: { "cloud.region": "us-east-1" },
      start: START,
      end: END,
    });

    for (const query of queries()) {
      expect(query["attributes"]).toEqual({ "cloud.region": "us-east-1" });
      expect(Object.keys(query)).not.toContain("primaryEntityId");
    }

    aggregateMock.mockReset();
    answer([]);
    await fetchSpanMetrics({ attributes: {}, start: START, end: END });

    for (const query of queries()) {
      expect(Object.keys(query)).not.toContain("attributes");
    }
  });

  test("totals are sums over the intervals, and the error rate is errors over all", async () => {
    answer([
      [
        { timestamp: T1, value: 300 },
        { timestamp: T0, value: 100 },
      ],
      [{ timestamp: T1, value: 8 }],
      [
        { timestamp: T0, value: 120 * NS_PER_MS },
        { timestamp: T1, value: 480 * NS_PER_MS },
      ],
    ]);

    const m: SpanMetrics = await fetchSpanMetrics({
      primaryEntityId: new ObjectID(ENTITY_ID),
      start: START,
      end: END,
    });

    expect(m.total).toBe(400);
    expect(m.errors).toBe(8);
    expect(m.errorRatePercent).toBe(2);
    expect(series(m.countSeries)).toEqual([
      [T0, 100],
      [T1, 300],
    ]);
    expect(series(m.errorSeries)).toEqual([[T1, 8]]);
  });

  test("durations are converted from nanoseconds to milliseconds", async () => {
    answer([[], [], [{ timestamp: T0, value: 2_500_000 }]]);

    const m: SpanMetrics = await fetchSpanMetrics({
      primaryEntityId: new ObjectID(ENTITY_ID),
      start: START,
      end: END,
    });

    expect(series(m.p95Series)).toEqual([[T0, 2.5]]);
  });

  /*
   * The RUM "Event duration (p95)" tooltip says the tile is "worked out for
   * each interval, then averaged over the selected range". This is that.
   */
  test("the headline p95 is the mean of the per-interval p95s, not a p95 over the range", async () => {
    answer([
      [
        { timestamp: T0, value: 1 },
        { timestamp: T1, value: 1000 },
      ],
      [],
      [
        { timestamp: T0, value: 100 * NS_PER_MS },
        { timestamp: T1, value: 300 * NS_PER_MS },
      ],
    ]);

    const m: SpanMetrics = await fetchSpanMetrics({
      primaryEntityId: new ObjectID(ENTITY_ID),
      start: START,
      end: END,
    });

    // Unweighted: the one-span interval counts as much as the busy one.
    expect(m.p95DurationMs).toBe(200);
  });

  test("buckets keyed 'time' are read too, and bad ones are dropped", async () => {
    answer([
      [
        { time: T0, value: 5 },
        { timestamp: "not a time", value: 50 },
        { timestamp: T1, value: "many" },
        { value: 7 },
      ],
      [],
      [],
    ]);

    const m: SpanMetrics = await fetchSpanMetrics({
      primaryEntityId: new ObjectID(ENTITY_ID),
      start: START,
      end: END,
    });

    expect(series(m.countSeries)).toEqual([[T0, 5]]);
    expect(m.total).toBe(5);
  });

  test("no spans: zero total, and no error rate or p95 to show", async () => {
    answer([[], [], []]);

    await expect(
      fetchSpanMetrics({
        primaryEntityId: new ObjectID(ENTITY_ID),
        start: START,
        end: END,
      }),
    ).resolves.toEqual({
      total: 0,
      errors: 0,
      errorRatePercent: null,
      p95DurationMs: null,
      countSeries: [],
      errorSeries: [],
      p95Series: [],
    });
  });

  test("no current project: returns empty without asking", async () => {
    projectIdMock.mockReturnValue(null);

    const m: SpanMetrics = await fetchSpanMetrics({
      primaryEntityId: new ObjectID(ENTITY_ID),
      start: START,
      end: END,
    });

    expect(aggregateMock).not.toHaveBeenCalled();
    expect(m.total).toBe(0);
    expect(m.p95DurationMs).toBeNull();
  });

  test("a failed aggregate resolves empty, marked failed, rather than rejecting", async () => {
    aggregateMock.mockRejectedValue(new Error("500"));

    const m: SpanMetrics = await fetchSpanMetrics({
      primaryEntityId: new ObjectID(ENTITY_ID),
      spanName: "documentLoad",
      start: START,
      end: END,
    });

    expect(m.total).toBe(0);
    expect(m.errorRatePercent).toBeNull();
    /*
     * The zeros are unknown, not none: a tile reads `failed` and says
     * "could not load".
     */
    expect(m.failed).toBe(true);
  });

  test("one of the three aggregates failing fails the whole result", async () => {
    aggregateMock
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(new Error("403"))
      .mockResolvedValueOnce({ data: [] });

    const m: SpanMetrics = await fetchSpanMetrics({
      primaryEntityId: new ObjectID(ENTITY_ID),
      start: START,
      end: END,
    });

    expect(m.failed).toBe(true);
    expect(m.total).toBe(0);
  });

  test("a successful lookup and a missing project are not failures", async () => {
    answer([[], [], []]);

    const ok: SpanMetrics = await fetchSpanMetrics({
      primaryEntityId: new ObjectID(ENTITY_ID),
      start: START,
      end: END,
    });

    expect(ok.failed).toBeUndefined();

    projectIdMock.mockReturnValue(null);

    const noProject: SpanMetrics = await fetchSpanMetrics({
      primaryEntityId: new ObjectID(ENTITY_ID),
      start: START,
      end: END,
    });

    expect(noProject.failed).toBeUndefined();
  });
});

describe("fetchWebVitals", () => {
  const LCP: WebVitalDefinition = WebVitalDefinitions.find(
    (d: WebVitalDefinition): boolean => {
      return d.key === "lcp";
    },
  )!;

  function metricNames(): Array<string> {
    return aggregateRequests().map((r: AggregateRequest): string => {
      return String(r.aggregateBy.query["name"]);
    });
  }

  test("every vital carries the description, label, unit and thresholds of its definition", async () => {
    aggregateMock.mockResolvedValue({ data: [] });

    const vitals: Array<WebVital> = await fetchWebVitals({
      primaryEntityId: new ObjectID(ENTITY_ID),
      start: START,
      end: END,
    });

    expect(vitals).toHaveLength(WebVitalDefinitions.length);
    vitals.forEach((v: WebVital, i: number) => {
      const d: WebVitalDefinition = WebVitalDefinitions[i]!;

      expect(v).toEqual({
        key: d.key,
        label: d.label,
        description: d.description,
        value: null,
        unit: d.unit,
        thresholds: d.thresholds,
        metricName: null,
      });
      expect(v.description.length).toBeGreaterThan(20);
    });
  });

  test("probes each vital's names in order and stops at the first that reports", async () => {
    const second: string = LCP.names[1]!;

    aggregateMock.mockImplementation(async (...args: Array<unknown>) => {
      const name: unknown = (args[0] as AggregateRequest).aggregateBy.query[
        "name"
      ];

      if (name === second) {
        return { data: [{ time: T0, value: 2000 }] };
      }

      return { data: [] };
    });

    const vitals: Array<WebVital> = await fetchWebVitals({
      primaryEntityId: new ObjectID(ENTITY_ID),
      start: START,
      end: END,
    });

    const lcp: WebVital = vitals.find((v: WebVital): boolean => {
      return v.key === "lcp";
    })!;

    // The one whole-range mean, and the name it was found under.
    expect(lcp.value).toBe(2000);
    expect(lcp.metricName).toBe(second);
    expect(lcp.description).toBe(LCP.description);

    const asked: Array<string> = metricNames();
    expect(asked).toContain(LCP.names[0]);
    expect(asked).toContain(second);
    for (const later of LCP.names.slice(2)) {
      expect(asked).not.toContain(later);
    }
  });

  /*
   * A mean of the whole range at once - not a mean of per-interval means,
   * which let a quiet interval count as much as a busy one. A mean rather
   * than a p75 because a histogram's percentile comes from its buckets,
   * and the OpenTelemetry defaults put every CLS value in (0, 5].
   */
  test("asks for one mean over the whole window, scoped to the entity", async () => {
    aggregateMock.mockResolvedValue({ data: [] });

    await fetchWebVitals({
      primaryEntityId: new ObjectID(ENTITY_ID),
      start: START,
      end: END,
    });

    for (const r of aggregateRequests()) {
      expect(r.aggregateBy.aggregationType).toBe(AggregationType.Avg);
      expect(r.aggregateBy.aggregationInterval).toBe(AggregationInterval.Total);
      expect(String(r.aggregateBy.query["primaryEntityId"])).toBe(ENTITY_ID);
      expect(r.aggregateBy.startTimestamp).toBe(START);
      expect(r.aggregateBy.endTimestamp).toBe(END);
    }
  });
});

describe("fetchWebVitalByRoute", () => {
  const INP_NAME: string = "web_vital.inp";

  function ask(): Promise<WebVitalByRoute> {
    return fetchWebVitalByRoute({
      primaryEntityId: new ObjectID(ENTITY_ID),
      metricName: INP_NAME,
      start: START,
      end: END,
    });
  }

  function routeRow(
    key: string,
    route: string | undefined,
    value: number,
  ): Record<string, unknown> {
    return {
      time: T0,
      value: value,
      attributes: route === undefined ? {} : { [key]: route },
    };
  }

  test("asks for the mean of this metric per route over the whole window, top routes only", async () => {
    aggregateMock.mockResolvedValue({ data: [] });

    await ask();

    const [first] = aggregateRequests();

    expect(first?.aggregateBy.query["name"]).toBe(INP_NAME);
    expect(String(first?.aggregateBy.query["primaryEntityId"])).toBe(ENTITY_ID);
    expect(String(first?.aggregateBy.query["projectId"])).toBe(PROJECT_ID);
    expect(first?.aggregateBy.aggregationType).toBe(AggregationType.Avg);
    expect(first?.aggregateBy.aggregationInterval).toBe(
      AggregationInterval.Total,
    );
    expect(first?.aggregateBy.groupByAttributeKeys).toEqual(["app.route"]);
    // One spare slot for the pooled rows that carry no route at all.
    expect(first?.aggregateBy.topK).toEqual({
      count: WEB_VITAL_ROUTE_LIMIT + 1,
      rankBy: "max",
    });
  });

  test("returns the routes slowest first, leaving out rows without a route", async () => {
    aggregateMock.mockResolvedValue({
      data: [
        routeRow("app.route", "/cart", 240),
        routeRow("app.route", undefined, 900),
        routeRow("app.route", "  ", 800),
        routeRow("app.route", "/products/:id", 620),
      ],
      totalGroups: 5,
    });

    const result: WebVitalByRoute = await ask();

    expect(result).toEqual({
      routeAttribute: "app.route",
      routes: [
        { route: "/products/:id", value: 620 },
        { route: "/cart", value: 240 },
      ],
      // Five groups, one of them the blank no-route group.
      totalRoutes: 4,
      failed: false,
    });
  });

  test("falls back to url.template, OpenTelemetry's name for the route", async () => {
    aggregateMock.mockImplementation(async (...args: Array<unknown>) => {
      const keys: Array<string> =
        (args[0] as AggregateRequest).aggregateBy.groupByAttributeKeys || [];

      if (keys[0] === "url.template") {
        return { data: [routeRow("url.template", "/orders/{id}", 310)] };
      }

      return { data: [routeRow("app.route", undefined, 310)] };
    });

    const result: WebVitalByRoute = await ask();

    expect(
      aggregateRequests().map((r: AggregateRequest): unknown => {
        return r.aggregateBy.groupByAttributeKeys;
      }),
    ).toEqual(
      WebVitalRouteAttributeKeys.map((key: string): Array<string> => {
        return [key];
      }),
    );
    expect(result.routeAttribute).toBe("url.template");
    expect(result.routes).toEqual([{ route: "/orders/{id}", value: 310 }]);
    expect(result.totalRoutes).toBeNull();
  });

  test("keeps at most the route limit", async () => {
    aggregateMock.mockResolvedValue({
      data: Array.from(
        { length: WEB_VITAL_ROUTE_LIMIT + 1 },
        (_: unknown, i: number) => {
          return routeRow("app.route", `/r${i}`, 100 + i);
        },
      ),
    });

    const result: WebVitalByRoute = await ask();

    expect(result.routes).toHaveLength(WEB_VITAL_ROUTE_LIMIT);
    expect(result.routes[0]?.value).toBe(100 + WEB_VITAL_ROUTE_LIMIT);
  });

  test("no route under any attribute is an empty answer, not a failure", async () => {
    aggregateMock.mockResolvedValue({ data: [] });

    expect(await ask()).toEqual({
      routeAttribute: null,
      routes: [],
      totalRoutes: null,
      failed: false,
    });
    expect(aggregateMock).toHaveBeenCalledTimes(
      WebVitalRouteAttributeKeys.length,
    );
  });

  test("a failed lookup is marked failed rather than read as no routes", async () => {
    aggregateMock.mockRejectedValue(new Error("403"));

    const result: WebVitalByRoute = await ask();

    expect(result.failed).toBe(true);
    expect(result.routes).toEqual([]);
  });

  test("no current project: returns empty without asking", async () => {
    projectIdMock.mockReturnValue(null);

    const result: WebVitalByRoute = await ask();

    expect(result.failed).toBe(false);
    expect(aggregateMock).not.toHaveBeenCalled();
  });
});

describe("telemetryFormat", () => {
  test.each([
    [null, "—"],
    [Number.NaN, "—"],
    [Number.POSITIVE_INFINITY, "—"],
    [0, "0"],
    [7.4, "7"],
    [999, "999"],
    [1000, "1k"],
    [1234, "1.2k"],
    [45_600, "45.6k"],
    [1_000_000, "1M"],
    [2_450_000, "2.5M"],
  ])("formatCompact(%p) is %p", (n: number | null, text: string) => {
    expect(formatCompact(n)).toBe(text);
  });

  test.each([
    [null, "—"],
    [Number.NaN, "—"],
    [0, "0.0%"],
    [2, "2.0%"],
    [12.345, "12.3%"],
    [100, "100.0%"],
    [250, "250.0%"],
  ])("formatPercent(%p) is %p", (n: number | null, text: string) => {
    expect(formatPercent(n)).toBe(text);
  });

  test.each([
    [null, "—"],
    [Number.NaN, "—"],
    [0.25, "250 µs"],
    [0, "0 µs"],
    [5, "5.0 ms"],
    [9.94, "9.9 ms"],
    [50, "50 ms"],
    [999, "999 ms"],
    [1000, "1.00 s"],
    [2340, "2.34 s"],
    [65_000, "65.00 s"],
  ])("formatDurationMs(%p) is %p", (ms: number | null, text: string) => {
    expect(formatDurationMs(ms)).toBe(text);
  });

  test.each([
    [null, "—"],
    [Number.NaN, "—"],
    [0, "0.0 B"],
    [512, "512 B"],
    [1024, "1.0 KiB"],
    [1536, "1.5 KiB"],
    [10 * 1024, "10 KiB"],
    [1024 * 1024, "1.0 MiB"],
    [5 * 1024 * 1024 * 1024, "5.0 GiB"],
    [3 * 1024 ** 4, "3.0 TiB"],
    [2048 * 1024 ** 4, "2048 TiB"],
  ])("formatBytes(%p) is %p", (bytes: number | null, text: string) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  test("telemetryMetrics re-exports the very same formatter functions", () => {
    expect(reexportedFormatCompact).toBe(formatCompact);
    expect(reexportedFormatPercent).toBe(formatPercent);
    expect(reexportedFormatDurationMs).toBe(formatDurationMs);
    expect(reexportedFormatBytes).toBe(formatBytes);
  });
});
