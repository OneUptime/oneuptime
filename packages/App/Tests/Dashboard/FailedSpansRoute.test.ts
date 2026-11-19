import { describe, expect, test } from "@jest/globals";
import { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  TRACE_SPAN_TYPE_URL_PARAM,
  TraceSpanType,
  parseTraceSpanType,
} from "Common/Types/Telemetry/TraceSpanType";
import {
  getCountedSpansRoute,
  getFailedSpanFilters,
  getFailedSpansRoute,
  getSpanFilters,
} from "../../FeatureSet/Dashboard/src/Components/TelemetryResource/FailedSpansRoute";
import {
  toSpanKind,
  toSpanStatusCode,
} from "../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile";

/*
 * AN ERROR RATE OPENS THE REQUESTS THAT FAILED (#9593).
 *
 * The link an Overview's Error rate opens is the traces explorer's own
 * address for exactly the spans the tile counted: its `filters` chips (the
 * failed status, a kind), its window (`range`, and `start`/`end` for a
 * Custom one) and its span type. Each part is read back here the way the
 * explorer reads it (TracesViewer's readInitialUrlState, TracesSearchCompile),
 * so a link the explorer would misread fails here first.
 */

const TRACES: Route = new Route(
  "/dashboard/11111111-1111-4111-8111-111111111111/service/22222222-2222-4222-8222-222222222222/traces",
);

const PAST_HOUR: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };

// A route's query, read as every explorer reads it: URLSearchParams.
function paramsOf(route: Route): URLSearchParams {
  const text: string = route.toString();
  const index: number = text.indexOf("?");

  expect(index).toBeGreaterThan(-1);

  return new URLSearchParams(text.slice(index + 1));
}

function filtersOf(route: Route): Array<[string, string]> {
  return JSON.parse(paramsOf(route).get("filters") || "[]") as Array<
    [string, string]
  >;
}

describe("the failed spans' chips", () => {
  test("are the explorer's status facet at Error, as its sidebar writes it", () => {
    expect(getFailedSpanFilters()).toEqual([
      ["statusCode", String(SpanStatus.Error)],
    ]);
    // The explorer reads the value back to the enum it filters on.
    expect(toSpanStatusCode(getFailedSpanFilters()[0]![1])).toBe(
      SpanStatus.Error,
    );
  });

  test("add a kind as the explorer's kind facet", () => {
    const filters: Array<[string, string]> = getFailedSpanFilters(
      SpanKind.Client,
    );

    expect(filters).toEqual([
      ["statusCode", "2"],
      ["kind", SpanKind.Client],
    ]);
    expect(toSpanKind(filters[1]![1])).toBe(SpanKind.Client);
  });

  test("add a span's name as the explorer's name facet", () => {
    expect(
      getSpanFilters({ isFailedOnly: true, spanName: "documentLoad" }),
    ).toEqual([
      ["statusCode", "2"],
      ["name", "documentLoad"],
    ]);
  });

  test("a count of requests narrows nothing but the kind", () => {
    expect(getSpanFilters({ isFailedOnly: false })).toEqual([]);
    expect(
      getSpanFilters({ isFailedOnly: false, kind: SpanKind.Client }),
    ).toEqual([["kind", SpanKind.Client]]);
  });
});

describe("the failed requests' link", () => {
  test("keeps the resource's Traces page and adds the chips", () => {
    const route: Route = getFailedSpansRoute({
      tracesRoute: TRACES,
      timeRange: PAST_HOUR,
      spanType: TraceSpanType.All,
    });

    expect(route.toString().startsWith(`${TRACES.toString()}?`)).toBe(true);
    expect(filtersOf(route)).toEqual([["statusCode", "2"]]);
  });

  test("never changes the route it was handed", () => {
    getFailedSpansRoute({
      tracesRoute: TRACES,
      timeRange: PAST_HOUR,
      spanType: TraceSpanType.All,
    });

    expect(TRACES.toString()).not.toContain("?");
  });

  test("carries a preset window by its name", () => {
    const params: URLSearchParams = paramsOf(
      getFailedSpansRoute({
        tracesRoute: TRACES,
        timeRange: { range: TimeRange.PAST_ONE_DAY },
        spanType: TraceSpanType.All,
      }),
    );

    expect(params.get("range")).toBe(TimeRange.PAST_ONE_DAY);
    expect(params.has("start")).toBe(false);
    expect(params.has("end")).toBe(false);
  });

  test("carries a Custom window with its start and end", () => {
    const start: Date = new Date("2026-11-18T09:00:00.000Z");
    const end: Date = new Date("2026-11-18T10:30:00.000Z");
    const params: URLSearchParams = paramsOf(
      getFailedSpansRoute({
        tracesRoute: TRACES,
        timeRange: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(start, end),
        },
        spanType: TraceSpanType.All,
      }),
    );

    expect(params.get("range")).toBe(TimeRange.CUSTOM);
    expect(new Date(params.get("start") as string).getTime()).toBe(
      start.getTime(),
    );
    expect(new Date(params.get("end") as string).getTime()).toBe(end.getTime());
  });

  test("names the span type the tile counted, the explorer's default included", () => {
    for (const spanType of [
      TraceSpanType.All,
      TraceSpanType.Entry,
      TraceSpanType.Root,
    ]) {
      const params: URLSearchParams = paramsOf(
        getFailedSpansRoute({
          tracesRoute: TRACES,
          timeRange: PAST_HOUR,
          spanType: spanType,
        }),
      );

      expect(parseTraceSpanType(params.get(TRACE_SPAN_TYPE_URL_PARAM))).toBe(
        spanType,
      );
    }
  });

  test("carries what else the page needs, such as its tab", () => {
    const params: URLSearchParams = paramsOf(
      getFailedSpansRoute({
        tracesRoute: TRACES,
        timeRange: PAST_HOUR,
        spanType: TraceSpanType.Entry,
        params: { tab: "Traces" },
      }),
    );

    expect(params.get("tab")).toBe("Traces");
    expect(params.get("filters")).toBe('[["statusCode","2"]]');
  });

  test("encodes each value once, so the explorer decodes it once", () => {
    const route: Route = getFailedSpansRoute({
      tracesRoute: TRACES,
      timeRange: PAST_HOUR,
      spanType: TraceSpanType.All,
      kind: SpanKind.Client,
    });

    expect(route.toString()).not.toContain('"');
    expect(route.toString()).not.toContain("[[");
    expect(filtersOf(route)).toEqual([
      ["statusCode", "2"],
      ["kind", SpanKind.Client],
    ]);
  });
});

describe("a count of requests' link", () => {
  test("opens the same spans, failed or not, over the same window", () => {
    const params: URLSearchParams = paramsOf(
      getCountedSpansRoute({
        tracesRoute: TRACES,
        timeRange: PAST_HOUR,
        spanType: TraceSpanType.All,
      }),
    );

    expect(params.has("filters")).toBe(false);
    expect(params.get("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(params.get(TRACE_SPAN_TYPE_URL_PARAM)).toBe(TraceSpanType.All);
  });

  test("a database's queries are its client calls", () => {
    expect(
      filtersOf(
        getCountedSpansRoute({
          tracesRoute: TRACES,
          timeRange: PAST_HOUR,
          spanType: TraceSpanType.All,
          kind: SpanKind.Client,
        }),
      ),
    ).toEqual([["kind", SpanKind.Client]]);
  });
});
