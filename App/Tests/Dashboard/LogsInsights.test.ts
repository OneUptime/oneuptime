import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import TimeRange from "Common/Types/Time/TimeRange";
import type {
  ErrorPatternCorrelation,
  ErrorPatternTrend,
  LogVolumeSummary,
  LogsInsightsScope,
  ResourceLogBreakdown,
  SharedAttribute,
  TopErrorPatternRow,
} from "../../FeatureSet/Dashboard/src/Utils/LogsInsights";

/*
 * The logic behind the Logs Insights page: what it asks the server, how it
 * reads the answers, the numbers it derives from them, and the deep links
 * it builds out of them.
 *
 * Two themes run through the suite. Every response field arrives as untyped
 * JSON, so each parser is exercised on malformed and absent input as well
 * as its happy path — a dashboard must degrade, never throw out of render.
 * And every request builder is checked for scope fidelity: a panel that
 * quietly widened or narrowed its own window would show the user a
 * correlation that is not real.
 */

type InsightsModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/LogsInsights");

let Insights: InsightsModule;

const NOW: Date = new Date("2026-08-21T12:00:00.000Z");
const SERVICE_ID: string = "0195d6c1-0000-7000-8000-000000000001";

/*
 * Common/UI/Config reads `window` the moment it loads, and this module
 * pulls it in transitively via RouteMap -> ProjectUtil, so the browser stub
 * has to exist before the deferred import runs. Same approach as
 * AIInsightExplorerLinks.test.ts.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  Insights = await import("../../FeatureSet/Dashboard/src/Utils/LogsInsights");
});

const PAST_TWO_DAYS: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_TWO_DAYS,
};

function scope(overrides: Partial<LogsInsightsScope> = {}): LogsInsightsScope {
  return { timeRange: PAST_TWO_DAYS, ...overrides };
}

function queryOf(route: { toString(): string }): URLSearchParams {
  const routeString: string = route.toString();
  const queryIndex: number = routeString.indexOf("?");

  return new URLSearchParams(
    queryIndex >= 0 ? routeString.substring(queryIndex + 1) : "",
  );
}

describe("request builders", () => {
  beforeEach(() => {
    /*
     * Only Date needs faking; the sinon backend jest 28 uses cannot hijack
     * the read-only `performance` global on current Node, so leave the
     * timer/callback APIs alone.
     */
    jest.useFakeTimers({
      doNotFake: [
        "performance",
        "hrtime",
        "queueMicrotask",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
    });
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("resolves a preset range against the current clock on every call", () => {
    const first: JSONObject = Insights.buildTopErrorPatternsRequest(scope());

    expect(first["startTime"]).toBe("2026-08-19T12:00:00.000Z");
    expect(first["endTime"]).toBe("2026-08-21T12:00:00.000Z");

    /*
     * "Past 2 days" means the last 48 hours, not the 48 hours the page
     * happened to load with — a refresh an hour later must slide forward.
     */
    jest.setSystemTime(new Date("2026-08-21T13:00:00.000Z"));

    const second: JSONObject = Insights.buildTopErrorPatternsRequest(scope());

    expect(second["startTime"]).toBe("2026-08-19T13:00:00.000Z");
    expect(second["endTime"]).toBe("2026-08-21T13:00:00.000Z");
  });

  test("a custom range pins both edges verbatim", () => {
    const request: JSONObject = Insights.buildTopErrorPatternsRequest(
      scope({
        timeRange: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2026-08-01T00:00:00.000Z"),
            new Date("2026-08-02T00:00:00.000Z"),
          ),
        },
      }),
    );

    expect(request["startTime"]).toBe("2026-08-01T00:00:00.000Z");
    expect(request["endTime"]).toBe("2026-08-02T00:00:00.000Z");
  });

  test("forwards a service selection and omits it when empty", () => {
    expect(
      Insights.buildTopErrorPatternsRequest(
        scope({ serviceIds: [SERVICE_ID] }),
      )["serviceIds"],
    ).toEqual([SERVICE_ID]);

    /*
     * An empty array is "no filter", not "match no service" — sending it
     * would scope the page to nothing.
     */
    expect(
      Insights.buildTopErrorPatternsRequest(scope({ serviceIds: [] }))[
        "serviceIds"
      ],
    ).toBeUndefined();
  });

  test("forwards resource facet selections and omits an empty map", () => {
    expect(
      Insights.buildTopErrorPatternsRequest(
        scope({ resourceFilters: { hostId: ["host-1"] } }),
      )["resourceFilters"],
    ).toEqual({ hostId: ["host-1"] });

    expect(
      Insights.buildTopErrorPatternsRequest(scope({ resourceFilters: {} }))[
        "resourceFilters"
      ],
    ).toBeUndefined();
  });

  test("forwards a limit only when it is a usable number", () => {
    expect(Insights.buildTopErrorPatternsRequest(scope(), 12)["limit"]).toBe(
      12,
    );
    expect(
      Insights.buildTopErrorPatternsRequest(scope(), Number.NaN)["limit"],
    ).toBeUndefined();
    expect(
      Insights.buildTopErrorPatternsRequest(scope())["limit"],
    ).toBeUndefined();
  });

  test("the histogram request never filters by severity", () => {
    /*
     * The histogram is what draws the severity breakdown. Filtering it to
     * the error severities would leave the page unable to say what share of
     * the volume the errors are — the denominator would equal the
     * numerator.
     */
    const request: JSONObject = Insights.buildInsightsHistogramRequest(
      scope({ severityTexts: [LogSeverity.Error], serviceIds: [SERVICE_ID] }),
    );

    expect(request["severityTexts"]).toBeUndefined();
    // ...but the rest of the scope still applies.
    expect(request["serviceIds"]).toEqual([SERVICE_ID]);
  });

  test("the service breakdown groups by resource and severity, unfiltered by severity", () => {
    const request: JSONObject = Insights.buildServiceBreakdownRequest(
      scope({ severityTexts: [LogSeverity.Error] }),
    );

    expect(request["chartType"]).toBe("table");
    expect(request["aggregation"]).toBe("count");
    expect(request["groupBy"]).toEqual(["primaryEntityId", "severityText"]);
    expect(request["severityTexts"]).toBeUndefined();
    expect(request["limit"]).toBe(500);
  });

  test("the correlation request carries the pattern alongside the page's scope", () => {
    const request: JSONObject = Insights.buildErrorPatternCorrelationRequest(
      scope({ serviceIds: [SERVICE_ID], severityTexts: [LogSeverity.Fatal] }),
      "connection refused to <ip>",
      5,
    );

    expect(request["pattern"]).toBe("connection refused to <ip>");
    expect(request["serviceIds"]).toEqual([SERVICE_ID]);
    expect(request["severityTexts"]).toEqual([LogSeverity.Fatal]);
    expect(request["limit"]).toBe(5);
    expect(request["startTime"]).toBe("2026-08-19T12:00:00.000Z");
  });

  test("the list and its drill-down ask for the same window and scope", () => {
    /*
     * The whole point of the correlation panel is that it describes the
     * same logs the list counted. If the two requests could disagree on
     * window or scope, the panel would be correlating against a different
     * population than the one the user clicked.
     */
    const pageScope: LogsInsightsScope = scope({ serviceIds: [SERVICE_ID] });

    const list: JSONObject = Insights.buildTopErrorPatternsRequest(pageScope);
    const detail: JSONObject = Insights.buildErrorPatternCorrelationRequest(
      pageScope,
      "boom",
    );

    expect(detail["startTime"]).toBe(list["startTime"]);
    expect(detail["endTime"]).toBe(list["endTime"]);
    expect(detail["serviceIds"]).toEqual(list["serviceIds"]);
  });
});

describe("parseTopErrorPatterns", () => {
  test("maps a well-formed row, parsing ClickHouse datetimes as UTC", () => {
    const rows: Array<TopErrorPatternRow> = Insights.parseTopErrorPatterns({
      patterns: [
        {
          pattern: "connection refused to <ip>:<num>",
          sampleBody: "connection refused to 10.0.0.4:5432",
          count: 30,
          firstSeenAt: "2026-08-19 03:00:00.000000000",
          lastSeenAt: "2026-08-20 22:14:02.000000000",
          resourceCount: 2,
          resourceIds: ["svc-a", "svc-b"],
          severities: ["Error"],
          traceCount: 4,
          sampleTraceIds: ["t1"],
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(30);
    expect(rows[0]!.firstSeenAt!.toISOString()).toBe(
      "2026-08-19T03:00:00.000Z",
    );
    expect(rows[0]!.lastSeenAt!.toISOString()).toBe("2026-08-20T22:14:02.000Z");
    expect(rows[0]!.resourceIds).toEqual(["svc-a", "svc-b"]);
  });

  test("drops rows with no pattern and coerces malformed fields", () => {
    const rows: Array<TopErrorPatternRow> = Insights.parseTopErrorPatterns({
      patterns: [
        { pattern: "", count: 9 },
        {
          pattern: "boom",
          count: "17",
          firstSeenAt: null,
          /*
           * Datetime-SHAPED but not a real instant. Deliberately not free
           * text: moment's non-ISO fallback logs a deprecation warning,
           * which would make every run of this suite noisy for a branch
           * that is about the result, not the parser's chattiness.
           */
          lastSeenAt: "0000-99-99 99:99:99",
          resourceIds: "nope",
          severities: ["Error", 42, ""],
          traceCount: undefined,
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(17);
    expect(rows[0]!.firstSeenAt).toBeNull();
    expect(rows[0]!.lastSeenAt).toBeNull();
    expect(rows[0]!.resourceIds).toEqual([]);
    expect(rows[0]!.severities).toEqual(["Error"]);
    expect(rows[0]!.traceCount).toBe(0);
  });

  test("degrades to an empty list on absent or non-array payloads", () => {
    expect(Insights.parseTopErrorPatterns(undefined)).toEqual([]);
    expect(Insights.parseTopErrorPatterns({})).toEqual([]);
    expect(Insights.parseTopErrorPatterns({ patterns: "nope" })).toEqual([]);
    expect(Insights.parseTopErrorPatterns({ patterns: [null, 7] })).toEqual([]);
  });
});

describe("parseErrorPatternCorrelation", () => {
  const response: JSONObject = {
    pattern: "boom <num>",
    bucketSizeInMinutes: 15,
    timeline: [
      { time: "2026-08-20 10:00:00.000000000", count: 3 },
      { time: "2026-08-20 10:15:00.000000000", count: 0 },
    ],
    coOccurringPatterns: [
      {
        pattern: "upstream timed out",
        sampleBody: "upstream timed out",
        count: 7,
      },
      { pattern: "", count: 3 },
    ],
    attributes: [
      { key: "host.name", value: "web-3", count: 30 },
      { key: "", value: "orphan", count: 1 },
    ],
    resources: [
      {
        resourceId: "svc-1",
        resourceType: "Host",
        count: 21,
        lastSeenAt: "2026-08-20 22:00:00.000000000",
      },
      { resourceId: "", count: 5 },
    ],
    traces: [
      {
        traceId: "abc",
        count: 3,
        lastSeenAt: "2026-08-20 22:00:00.000000000",
        resourceId: "svc-1",
      },
      { traceId: "", count: 9 },
    ],
    samples: [
      {
        logId: "log-1",
        time: "2026-08-20 22:00:00.000000000",
        body: "boom 42",
        severityText: "Error",
        resourceId: "svc-1",
        traceId: "abc",
        spanId: "def",
      },
    ],
  };

  test("maps every section and drops rows missing their identifying field", () => {
    const parsed: ErrorPatternCorrelation =
      Insights.parseErrorPatternCorrelation(response);

    expect(parsed.pattern).toBe("boom <num>");
    expect(parsed.bucketSizeInMinutes).toBe(15);
    expect(parsed.timeline).toHaveLength(2);
    expect(parsed.timeline[0]!.time!.toISOString()).toBe(
      "2026-08-20T10:00:00.000Z",
    );
    /*
     * An empty bucket is data — "the error stopped" — so a zero count must
     * survive parsing rather than being filtered out as falsy.
     */
    expect(parsed.timeline[1]!.count).toBe(0);

    expect(parsed.coOccurringPatterns).toHaveLength(1);
    expect(parsed.attributes).toEqual([
      { key: "host.name", value: "web-3", count: 30 },
    ]);
    expect(parsed.resources).toHaveLength(1);
    expect(parsed.traces).toHaveLength(1);
    expect(parsed.samples[0]!.body).toBe("boom 42");
  });

  test("returns an empty shape rather than throwing on an absent payload", () => {
    const parsed: ErrorPatternCorrelation =
      Insights.parseErrorPatternCorrelation(undefined);

    expect(parsed.pattern).toBe("");
    expect(parsed.bucketSizeInMinutes).toBe(0);
    expect(parsed.timeline).toEqual([]);
    expect(parsed.coOccurringPatterns).toEqual([]);
    expect(parsed.attributes).toEqual([]);
    expect(parsed.resources).toEqual([]);
    expect(parsed.traces).toEqual([]);
    expect(parsed.samples).toEqual([]);
  });
});

describe("summarizeSeverityBuckets", () => {
  const buckets: Array<JSONObject> = [
    { time: "2026-08-20 10:00:00.000000000", severity: "Error", count: 6 },
    {
      time: "2026-08-20 10:00:00.000000000",
      severity: "Information",
      count: 90,
    },
    { time: "2026-08-20 11:00:00.000000000", severity: "Fatal", count: 2 },
    { time: "2026-08-20 11:00:00.000000000", severity: "Warning", count: 2 },
  ];

  test("totals volume, error count and error rate across the whole window", () => {
    const summary: LogVolumeSummary =
      Insights.summarizeSeverityBuckets(buckets);

    expect(summary.total).toBe(100);
    // Error + Fatal, matching the server's default error severities.
    expect(summary.errorCount).toBe(8);
    expect(summary.warnCount).toBe(2);
    expect(summary.errorRatePercent).toBe(8);
  });

  test("orders the severity breakdown by seriousness, not by volume", () => {
    const summary: LogVolumeSummary =
      Insights.summarizeSeverityBuckets(buckets);

    expect(
      summary.severities.map((share: { severity: string }): string => {
        return share.severity;
      }),
    ).toEqual(["Fatal", "Error", "Warning", "Information"]);
    expect(summary.severities[3]!.percent).toBe(90);
  });

  test("keeps an unknown severity instead of dropping its volume", () => {
    const summary: LogVolumeSummary = Insights.summarizeSeverityBuckets([
      { time: "t1", severity: "Audit", count: 4 },
      { time: "t1", severity: "Error", count: 1 },
    ]);

    expect(summary.total).toBe(5);
    // Unknown severities sort after every known one rather than vanishing.
    expect(summary.severities[1]!.severity).toBe("Audit");
  });

  test("a severity-less bucket is counted under Unspecified", () => {
    const summary: LogVolumeSummary = Insights.summarizeSeverityBuckets([
      { time: "t1", count: 3 },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.severities[0]!.severity).toBe("Unspecified");
  });

  test("sums the per-bucket series and keeps empty buckets as gaps", () => {
    const summary: LogVolumeSummary = Insights.summarizeSeverityBuckets([
      ...buckets,
      { time: "2026-08-20 12:00:00.000000000", severity: "Error", count: 0 },
    ]);

    expect(summary.series).toEqual([
      { time: "2026-08-20 10:00:00.000000000", count: 96 },
      { time: "2026-08-20 11:00:00.000000000", count: 4 },
      { time: "2026-08-20 12:00:00.000000000", count: 0 },
    ]);
  });

  test("an empty window reports zeroes rather than dividing by zero", () => {
    const summary: LogVolumeSummary = Insights.summarizeSeverityBuckets([]);

    expect(summary.total).toBe(0);
    expect(summary.errorRatePercent).toBe(0);
    expect(summary.severities).toEqual([]);
    expect(Insights.summarizeSeverityBuckets(undefined).total).toBe(0);
  });
});

describe("summarizeResourceBreakdown", () => {
  test("folds per-severity rows into one row per resource, busiest first", () => {
    const rows: Array<ResourceLogBreakdown> =
      Insights.summarizeResourceBreakdown({
        data: [
          {
            groupValues: { primaryEntityId: "svc-a", severityText: "Error" },
            count: 5,
          },
          {
            groupValues: {
              primaryEntityId: "svc-a",
              severityText: "Information",
            },
            count: 20,
          },
          {
            groupValues: { primaryEntityId: "svc-b", severityText: "Fatal" },
            count: 2,
          },
          {
            groupValues: { primaryEntityId: "svc-b", severityText: "Warning" },
            count: 40,
          },
        ],
      });

    expect(rows).toEqual([
      { resourceId: "svc-b", total: 42, errorCount: 2, warnCount: 40 },
      { resourceId: "svc-a", total: 25, errorCount: 5, warnCount: 0 },
    ]);
  });

  test("breaks volume ties on id so the order is stable across refreshes", () => {
    const rows: Array<ResourceLogBreakdown> =
      Insights.summarizeResourceBreakdown({
        data: [
          { groupValues: { primaryEntityId: "zeta" }, count: 5 },
          { groupValues: { primaryEntityId: "alpha" }, count: 5 },
        ],
      });

    expect(
      rows.map((row: ResourceLogBreakdown): string => {
        return row.resourceId;
      }),
    ).toEqual(["alpha", "zeta"]);
  });

  test("skips rows with no resource id and degrades on malformed payloads", () => {
    expect(
      Insights.summarizeResourceBreakdown({
        data: [{ groupValues: {}, count: 9 }, { count: 4 }],
      }),
    ).toEqual([]);
    expect(Insights.summarizeResourceBreakdown(undefined)).toEqual([]);
    expect(Insights.summarizeResourceBreakdown({ data: "nope" })).toEqual([]);
  });
});

describe("computeErrorPatternTrend", () => {
  const BUCKET_MS: number = 15 * 60 * 1000;
  const WINDOW_START: Date = new Date("2026-08-20T00:00:00.000Z");
  const WINDOW_END: Date = new Date("2026-08-21T00:00:00.000Z");

  /*
   * Stamped with real, evenly spaced timestamps — which is what the server
   * actually returns. The no-timestamp variant below covers the fallback.
   */
  function timeline(counts: Array<number>): Array<{
    time: Date | null;
    count: number;
  }> {
    return counts.map(
      (count: number, index: number): { time: Date | null; count: number } => {
        return {
          time: new Date(WINDOW_START.getTime() + index * BUCKET_MS),
          count,
        };
      },
    );
  }

  function untimedTimeline(counts: Array<number>): Array<{
    time: Date | null;
    count: number;
  }> {
    return counts.map((count: number): { time: Date | null; count: number } => {
      return { time: null, count };
    });
  }

  test("calls a doubling rising, with the percentage change", () => {
    const trend: ErrorPatternTrend = Insights.computeErrorPatternTrend(
      timeline([1, 1, 2, 2]),
    );

    expect(trend.direction).toBe("rising");
    expect(trend.previousCount).toBe(2);
    expect(trend.recentCount).toBe(4);
    expect(trend.changePercent).toBe(100);
  });

  test("calls a halving falling", () => {
    const trend: ErrorPatternTrend = Insights.computeErrorPatternTrend(
      timeline([10, 10, 5, 5]),
    );

    expect(trend.direction).toBe("falling");
    expect(trend.changePercent).toBe(-50);
  });

  test("a small wobble is steady, not a trend", () => {
    /*
     * 100 -> 105 is five percent. Calling that an escalation would make the
     * badge meaningless on any pattern with normal variance.
     */
    expect(
      Insights.computeErrorPatternTrend(timeline([100, 105])).direction,
    ).toBe("steady");
  });

  test("a pattern that only started in the newer half is rising", () => {
    const trend: ErrorPatternTrend = Insights.computeErrorPatternTrend(
      timeline([0, 0, 4, 6]),
    );

    expect(trend.direction).toBe("rising");
    expect(trend.changePercent).toBe(100);
    expect(trend.recentCount).toBe(10);
  });

  test("reports unknown rather than guessing on too little data", () => {
    expect(Insights.computeErrorPatternTrend([]).direction).toBe("unknown");
    expect(Insights.computeErrorPatternTrend(timeline([5])).direction).toBe(
      "unknown",
    );
    // All-empty buckets are not a falling trend, they are no data.
    expect(Insights.computeErrorPatternTrend(timeline([0, 0])).direction).toBe(
      "unknown",
    );
    expect(
      Insights.computeErrorPatternTrend(untimedTimeline([0, 0])).direction,
    ).toBe("unknown");
  });

  test("splits an odd-length untimed timeline with the extra bucket in the newer half", () => {
    const trend: ErrorPatternTrend = Insights.computeErrorPatternTrend(
      untimedTimeline([2, 1, 1, 1, 1]),
    );

    expect(trend.previousCount).toBe(3);
    expect(trend.recentCount).toBe(3);
  });

  test("an error that stopped hours ago reads as FALLING, not steady", () => {
    /*
     * The regression this function's index split got wrong. The timeline
     * query has no zero-fill, so a pattern that fired during the first two
     * hours of a 24-hour window and then stopped comes back as a handful of
     * buckets all clustered at the start. Splitting by array index sums
     * four against four, calls it "Steady 0%", and tells the user an error
     * that has been silent for 22 hours is ticking along normally.
     */
    const clustered: Array<{ time: Date | null; count: number }> = [
      2, 3, 2, 3, 2, 3, 2, 3,
    ].map((count: number, index: number) => {
      return {
        time: new Date(WINDOW_START.getTime() + index * BUCKET_MS),
        count,
      };
    });

    /*
     * With no window to measure against, the honest answer really is
     * "steady": across the span it was OBSERVED, the rate did not change.
     * That is exactly why the window has to be passed in — and why the
     * caller (ErrorPatternDetail) resolves and passes it.
     */
    expect(Insights.computeErrorPatternTrend(clustered).direction).toBe(
      "steady",
    );

    // Against the window the user actually picked, it has stopped.
    const windowed: ErrorPatternTrend = Insights.computeErrorPatternTrend(
      clustered,
      WINDOW_START,
      WINDOW_END,
    );

    expect(windowed.direction).toBe("falling");
    expect(windowed.recentCount).toBe(0);
    expect(windowed.previousCount).toBe(20);
  });

  test("a pattern that only started late in the window reads as rising", () => {
    const late: Array<{ time: Date | null; count: number }> = [4, 6].map(
      (count: number, index: number) => {
        return {
          time: new Date(WINDOW_END.getTime() - (2 - index) * BUCKET_MS),
          count,
        };
      },
    );

    const trend: ErrorPatternTrend = Insights.computeErrorPatternTrend(
      late,
      WINDOW_START,
      WINDOW_END,
    );

    expect(trend.direction).toBe("rising");
    expect(trend.previousCount).toBe(0);
    expect(trend.recentCount).toBe(10);
  });
});

describe("getCorrelationOccurrenceTotal", () => {
  test("sums the timeline the correlation response itself returned", () => {
    expect(
      Insights.getCorrelationOccurrenceTotal([
        { time: null, count: 4 },
        { time: null, count: 0 },
        { time: null, count: 6 },
      ]),
    ).toBe(10);
  });

  test("degrades to 0 on an empty or unusable timeline", () => {
    /*
     * 0 is the caller's signal to fall back to the list's own count, not a
     * claim that nothing happened.
     */
    expect(Insights.getCorrelationOccurrenceTotal([])).toBe(0);
    expect(
      Insights.getCorrelationOccurrenceTotal(
        undefined as unknown as Array<{ time: Date | null; count: number }>,
      ),
    ).toBe(0);
    expect(
      Insights.getCorrelationOccurrenceTotal([
        { time: null, count: Number.NaN },
      ]),
    ).toBe(0);
  });
});

describe("summarizeSharedAttributes", () => {
  test("ranks by coverage and flags the ones on every occurrence", () => {
    const shared: Array<SharedAttribute> = Insights.summarizeSharedAttributes(
      [
        { key: "http.route", value: "/checkout", count: 12 },
        { key: "host.name", value: "web-3", count: 30 },
      ],
      30,
    );

    expect(shared[0]!.key).toBe("host.name");
    expect(shared[0]!.isUniversal).toBe(true);
    expect(shared[0]!.coveragePercent).toBe(100);
    expect(shared[1]!.isUniversal).toBe(false);
    expect(shared[1]!.coveragePercent).toBe(40);
  });

  test("drops per-occurrence noise like request ids", () => {
    /*
     * A value that appears once in thirty occurrences is what MAKES this a
     * pattern rather than one log line. Listing every such value would bury
     * the attributes that actually localize the error.
     */
    const shared: Array<SharedAttribute> = Insights.summarizeSharedAttributes(
      [
        { key: "request.id", value: "req-1", count: 1 },
        { key: "host.name", value: "web-3", count: 30 },
      ],
      30,
    );

    expect(shared).toHaveLength(1);
    expect(shared[0]!.key).toBe("host.name");
  });

  test("clamps coverage at 100% when a log carries the attribute more than once", () => {
    const shared: Array<SharedAttribute> = Insights.summarizeSharedAttributes(
      [{ key: "k8s.pod.name", value: "checkout-7d9", count: 45 }],
      30,
    );

    expect(shared[0]!.coveragePercent).toBe(100);
    expect(shared[0]!.isUniversal).toBe(true);
  });

  test("breaks count ties on key so the order is stable", () => {
    const shared: Array<SharedAttribute> = Insights.summarizeSharedAttributes(
      [
        { key: "zeta", value: "1", count: 10 },
        { key: "alpha", value: "1", count: 10 },
      ],
      10,
    );

    expect(
      shared.map((attribute: SharedAttribute): string => {
        return attribute.key;
      }),
    ).toEqual(["alpha", "zeta"]);
  });

  test("honours the limit and degrades on unusable inputs", () => {
    const many: Array<{ key: string; value: string; count: number }> =
      Array.from({ length: 20 }, (_unused: unknown, index: number) => {
        return { key: `k${index}`, value: "v", count: 10 };
      });

    expect(Insights.summarizeSharedAttributes(many, 10, 3)).toHaveLength(3);
    expect(Insights.summarizeSharedAttributes(many, 0)).toEqual([]);
    expect(Insights.summarizeSharedAttributes([], 10)).toEqual([]);
  });
});

describe("describeTimeRange / describeOccurrenceCount", () => {
  test("renders the window as a phrase that can follow 'in'", () => {
    expect(Insights.describeTimeRange(PAST_TWO_DAYS)).toBe("the past 2 days");
    expect(Insights.describeTimeRange({ range: TimeRange.PAST_ONE_HOUR })).toBe(
      "the past 1 hour",
    );
  });

  test("a custom window gets a neutral phrase, not an enum value", () => {
    expect(Insights.describeTimeRange({ range: TimeRange.CUSTOM })).toBe(
      "the selected time range",
    );
  });

  test("builds the sentence the issue asked for", () => {
    expect(Insights.describeOccurrenceCount(30, PAST_TWO_DAYS)).toBe(
      "30 times in the past 2 days",
    );
  });

  test("singularizes one occurrence and floors nonsense counts", () => {
    expect(Insights.describeOccurrenceCount(1, PAST_TWO_DAYS)).toBe(
      "1 time in the past 2 days",
    );
    expect(Insights.describeOccurrenceCount(-4, PAST_TWO_DAYS)).toContain(
      "0 times",
    );
    expect(
      Insights.describeOccurrenceCount(Number.NaN, PAST_TWO_DAYS),
    ).toContain("0 times");
  });
});

describe("buildErrorPatternLogsRoute", () => {
  test("filters the viewer on the pattern's literal text, not its placeholders", () => {
    const route: { toString(): string } | null =
      Insights.buildErrorPatternLogsRoute(
        "connection refused to <ip>:<num>",
        scope(),
        "connection refused to 10.0.0.1:5432",
      );

    expect(route).not.toBeNull();

    const filters: Array<[string, Array<string>]> = JSON.parse(
      queryOf(route!).get("filters") as string,
    );

    /*
     * The pattern itself contains <ip>/<num>, which no real body contains —
     * filtering on it would land the user on an empty list. The link
     * carries a literal run instead, and because a sample body was supplied
     * the stronger multi-word run is used.
     */
    expect(filters).toContainEqual(["body", ["connection refused to"]]);
  });

  test("the body filter it emits is always present in the sample body", () => {
    /*
     * The needle goes into `body ILIKE '%needle%'`. A stack trace's pattern
     * has spaces where the body has newlines, so an unverified multi-word
     * run would match nothing and the link would open an empty list — the
     * one outcome worse than no link.
     */
    const bodies: Array<string> = [
      "connection refused to 10.0.0.1:5432 after 30ms",
      'java.lang.NullPointerException: Cannot invoke "x" because "order" is null\n\tat com.example.OrderService.process(OrderService.java:42)',
      '{"level":"error","msg":"connection refused","attempt":3}',
    ];

    for (const body of bodies) {
      const pattern: string = body
        .replace(/\d+\.\d+\.\d+\.\d+/g, "<ip>")
        .replace(/\d+/g, "<num>")
        .replace(/\s+/g, " ");

      const route: { toString(): string } | null =
        Insights.buildErrorPatternLogsRoute(pattern, scope(), body);

      const filters: Array<[string, Array<string>]> = JSON.parse(
        queryOf(route!).get("filters") as string,
      );

      const bodyFilter: [string, Array<string>] | undefined = filters.find(
        ([key]: [string, Array<string>]): boolean => {
          return key === "body";
        },
      );

      if (bodyFilter) {
        expect(body).toContain(bodyFilter[1][0] as string);
      }
    }
  });

  test("carries severity, service scope and the window", () => {
    const route: { toString(): string } | null =
      Insights.buildErrorPatternLogsRoute(
        "connection refused",
        scope({ serviceIds: [SERVICE_ID] }),
      );

    const params: URLSearchParams = queryOf(route!);
    const filters: Array<[string, Array<string>]> = JSON.parse(
      params.get("filters") as string,
    );

    expect(filters).toContainEqual(["severityText", ["Error", "Fatal"]]);
    expect(filters).toContainEqual(["primaryEntityId", [SERVICE_ID]]);
    expect(params.get("range")).toBe(TimeRange.CUSTOM);
    expect(params.get("start")).toBeTruthy();
    expect(params.get("end")).toBeTruthy();
  });

  test("an explicit severity selection overrides the error default", () => {
    const route: { toString(): string } | null =
      Insights.buildErrorPatternLogsRoute(
        "slow query",
        scope({ severityTexts: [LogSeverity.Warning] }),
      );

    const filters: Array<[string, Array<string>]> = JSON.parse(
      queryOf(route!).get("filters") as string,
    );

    expect(filters).toContainEqual(["severityText", ["Warning"]]);
  });

  test("omits the body filter when the pattern has no selective literal run", () => {
    const route: { toString(): string } | null =
      Insights.buildErrorPatternLogsRoute("<timestamp> <uuid>", scope());

    const filters: Array<[string, Array<string>]> = JSON.parse(
      queryOf(route!).get("filters") as string,
    );

    /*
     * An empty body filter would match everything while telling the user
     * their view is filtered — worse than no filter at all.
     */
    for (const [key] of filters) {
      expect(key).not.toBe("body");
    }
  });

  test("survives the characters a real log body can contain", () => {
    /*
     * Log bodies are free-form. encodeURIComponent leaves "~" bare and
     * Route's character whitelist rejects it, which is exactly how a link
     * builder throws out of a row renderer.
     */
    const hostile: Array<string> = [
      "svc~canary refused",
      'quoted "eu west" failed',
      "spaces and 100% failure",
      "{braces}<angle>|pipe error",
      "plus+amp&eq=q?hash# failed",
      "emoji 🚀 café unavailable",
    ];

    for (const pattern of hostile) {
      const route: { toString(): string } | null =
        Insights.buildErrorPatternLogsRoute(pattern, scope());

      expect(route).not.toBeNull();

      // One decode, exactly as LogsViewer.readInitialUrlState applies.
      const filters: Array<[string, Array<string>]> = JSON.parse(
        queryOf(route!).get("filters") as string,
      );

      const bodyFilter: [string, Array<string>] | undefined = filters.find(
        ([key]: [string, Array<string>]): boolean => {
          return key === "body";
        },
      );

      expect(bodyFilter).toBeDefined();
      expect(pattern).toContain(bodyFilter![1][0] as string);
    }
  });
});

describe("buildErrorPatternTraceRoute", () => {
  test("points at the trace detail page for the id", () => {
    const route: { toString(): string } | null =
      Insights.buildErrorPatternTraceRoute("4bf92f3577b34da6a3ce929d0e0e4736");

    expect(route!.toString()).toContain("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  test("returns null for an absent or blank trace id", () => {
    expect(Insights.buildErrorPatternTraceRoute("")).toBeNull();
    expect(Insights.buildErrorPatternTraceRoute("   ")).toBeNull();
    expect(
      Insights.buildErrorPatternTraceRoute(undefined as unknown as string),
    ).toBeNull();
  });
});

/*
 * The scope picker is one flat multi-select over two very different kinds
 * of id. A Service id belongs in `primaryEntityId`; a host or cluster id has
 * to reach the server as its own facet, because OTLP telemetry carrying a
 * `service.name` is primary-keyed on the Service and only records the host
 * it ran on in `entityKeys`. Conflating them is what made an earlier
 * cluster filter match nothing at all.
 */
describe("scope picker", () => {
  test("asks for every resource facet the picker offers", () => {
    const request: JSONObject = Insights.buildScopeFacetsRequest(PAST_TWO_DAYS);

    expect(request["facetKeys"]).toEqual([
      "primaryEntityId",
      "hostId",
      "dockerHostId",
      "podmanHostId",
      "kubernetesClusterId",
    ]);
    expect(request["startTime"]).toBeTruthy();
    expect(request["endTime"]).toBeTruthy();
    expect(request["limit"]).toBe(200);
  });

  test("the facet request carries no selection of its own", () => {
    /*
     * Narrowing the picker by its own output would let a selection erase
     * the way back out of itself — pick one host and the others vanish.
     */
    const request: JSONObject = Insights.buildScopeFacetsRequest(PAST_TWO_DAYS);

    expect(request["serviceIds"]).toBeUndefined();
    expect(request["resourceFilters"]).toBeUndefined();
    expect(request["severityTexts"]).toBeUndefined();
  });

  test("parses each facet's values, preferring the resolved display name", () => {
    const parsed: Record<
      string,
      Array<{ displayName: string }>
    > = Insights.parseScopeFacets({
      facets: {
        primaryEntityId: [
          { value: "svc-1", displayName: "checkout", count: 40 },
        ],
        hostId: [{ value: "host-1", count: 12 }],
      },
    }) as unknown as Record<string, Array<{ displayName: string }>>;

    expect(parsed["primaryEntityId"]![0]!.displayName).toBe("checkout");
    // No resolved name — the raw id still identifies a scopeable resource.
    expect(parsed["hostId"]![0]!.displayName).toBe("host-1");
  });

  test("drops values with no id and degrades on missing payloads", () => {
    const parsed: Record<string, Array<unknown>> = Insights.parseScopeFacets({
      facets: { hostId: [{ value: "", count: 9 }, { count: 4 }] },
    }) as unknown as Record<string, Array<unknown>>;

    expect(parsed["hostId"]).toEqual([]);
    // Every offered facet key is present, even when the response omitted it.
    expect(Object.keys(Insights.parseScopeFacets(undefined)).sort()).toEqual(
      [...Insights.INSIGHTS_SCOPE_FACET_KEYS].sort(),
    );
  });

  test("round-trips a selection through its encoded option value", () => {
    const encoded: string = Insights.encodeScopeSelection(
      "hostId",
      "0195d6c1-0000-7000-8000-0000000000aa",
    );

    expect(encoded).toBe("hostId:0195d6c1-0000-7000-8000-0000000000aa");
    expect(Insights.parseScopeSelections([encoded]).resourceFilters).toEqual({
      hostId: ["0195d6c1-0000-7000-8000-0000000000aa"],
    });
  });

  test("routes services and non-service resources into different scope fields", () => {
    const selections: {
      serviceIds?: Array<string> | undefined;
      resourceFilters?: Record<string, Array<string>> | undefined;
    } = Insights.parseScopeSelections([
      Insights.encodeScopeSelection("primaryEntityId", "svc-1"),
      Insights.encodeScopeSelection("hostId", "host-1"),
      Insights.encodeScopeSelection("kubernetesClusterId", "k8s-1"),
    ]);

    expect(selections.serviceIds).toEqual(["svc-1"]);
    expect(selections.resourceFilters).toEqual({
      hostId: ["host-1"],
      kubernetesClusterId: ["k8s-1"],
    });
  });

  test("groups several ids under one facet and deduplicates them", () => {
    const selections: {
      resourceFilters?: Record<string, Array<string>> | undefined;
    } = Insights.parseScopeSelections([
      "hostId:host-1",
      "hostId:host-2",
      "hostId:host-1",
    ]);

    expect(selections.resourceFilters).toEqual({
      hostId: ["host-1", "host-2"],
    });
  });

  test("an unknown facet key is dropped rather than sent as an unreadable filter", () => {
    const selections: {
      serviceIds?: Array<string> | undefined;
      resourceFilters?: Record<string, Array<string>> | undefined;
    } = Insights.parseScopeSelections(["madeUpFacet:x", "primaryEntityId:ok"]);

    expect(selections.serviceIds).toEqual(["ok"]);
    expect(selections.resourceFilters).toBeUndefined();
  });

  test("malformed entries and an empty selection carry no scope", () => {
    for (const values of [
      [],
      ["no-separator"],
      [":leading-colon"],
      ["hostId:"],
      [undefined as unknown as string],
    ]) {
      const selections: {
        serviceIds?: Array<string> | undefined;
        resourceFilters?: Record<string, Array<string>> | undefined;
      } = Insights.parseScopeSelections(values);

      expect(selections.serviceIds).toBeUndefined();
      expect(selections.resourceFilters).toBeUndefined();
    }
  });

  test("a selection reaches the API request bodies it was decoded for", () => {
    const selections: {
      serviceIds?: Array<string> | undefined;
      resourceFilters?: Record<string, Array<string>> | undefined;
    } = Insights.parseScopeSelections([
      "primaryEntityId:svc-1",
      "hostId:host-1",
    ]);

    const request: JSONObject = Insights.buildTopErrorPatternsRequest({
      timeRange: PAST_TWO_DAYS,
      ...selections,
    } as LogsInsightsScope);

    expect(request["serviceIds"]).toEqual(["svc-1"]);
    expect(request["resourceFilters"]).toEqual({ hostId: ["host-1"] });
  });
});
