import { describe, expect, test } from "@jest/globals";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import {
  TraceInsightsSpanInput,
  TraceInsightsTrace,
  TraceInsightsTraces,
  UNKNOWN_TRACE_NAME,
  getSlowestTraces,
  isRootSpan,
  pickRepresentativeSpan,
  summarizeRecentTraces,
  summarizeTrace,
} from "../../FeatureSet/Dashboard/src/Utils/TraceInsightsTraces";

/*
 * The Insights page's "recent error traces" and "slowest traces" lists come
 * from a newest-first sample of spans. Before this, each trace took the name,
 * service, start and duration of the FIRST span seen for it — the newest one,
 * usually a leaf. A checkout request showed up as "set" with a 40µs duration,
 * and the slowest-traces list ranked traces by their fastest leaf.
 */

const BASE: number = Date.UTC(2026, 9, 1, 12, 0, 0);

function span(
  overrides: Partial<TraceInsightsSpanInput> & { spanId: string },
): TraceInsightsSpanInput {
  return {
    traceId: "trace-a",
    parentSpanId: "",
    name: "span",
    primaryEntityId: "svc-api",
    startTime: new Date(BASE),
    durationNano: 1_000,
    statusCode: SpanStatus.Unset,
    ...overrides,
  };
}

/*
 * A request trace the way the newest-first query returns it: the last Redis
 * call first, the root last.
 */
function checkoutTraceNewestFirst(): Array<TraceInsightsSpanInput> {
  return [
    span({
      spanId: "redis-set",
      parentSpanId: "root",
      name: "set",
      primaryEntityId: "svc-api",
      startTime: new Date(BASE + 90),
      durationNano: 40_000,
    }),
    span({
      spanId: "pg-select",
      parentSpanId: "root",
      name: "SELECT orders",
      primaryEntityId: "svc-api",
      startTime: new Date(BASE + 20),
      durationNano: 60_000_000,
    }),
    span({
      spanId: "root",
      parentSpanId: "",
      name: "POST /api/checkout",
      primaryEntityId: "svc-gateway",
      startTime: new Date(BASE),
      durationNano: 95_000_000,
    }),
  ];
}

describe("isRootSpan", () => {
  test("a span with no parent is a root", () => {
    expect(isRootSpan(span({ spanId: "a", parentSpanId: "" }))).toBe(true);
  });

  test("a span with a parent is not a root", () => {
    expect(isRootSpan(span({ spanId: "a", parentSpanId: "p" }))).toBe(false);
  });
});

describe("pickRepresentativeSpan", () => {
  test("returns undefined for no spans", () => {
    expect(pickRepresentativeSpan([])).toBeUndefined();
  });

  test("prefers the root span even when it is the last one seen", () => {
    expect(pickRepresentativeSpan(checkoutTraceNewestFirst())?.spanId).toBe(
      "root",
    );
  });

  test("prefers a root over an earlier-starting child", () => {
    // Clock skew between hosts can put a child before its root.
    const spans: Array<TraceInsightsSpanInput> = [
      span({
        spanId: "child",
        parentSpanId: "root",
        startTime: new Date(BASE - 5),
      }),
      span({ spanId: "root", parentSpanId: "", startTime: new Date(BASE) }),
    ];
    expect(pickRepresentativeSpan(spans)?.spanId).toBe("root");
  });

  test("without a sampled root, falls back to the earliest-starting span", () => {
    const spans: Array<TraceInsightsSpanInput> = [
      span({
        spanId: "late",
        parentSpanId: "x",
        startTime: new Date(BASE + 50),
      }),
      span({ spanId: "early", parentSpanId: "x", startTime: new Date(BASE) }),
      span({
        spanId: "mid",
        parentSpanId: "x",
        startTime: new Date(BASE + 10),
      }),
    ];
    expect(pickRepresentativeSpan(spans)?.spanId).toBe("early");
  });

  test("a span with no start time never beats one that has it", () => {
    const spans: Array<TraceInsightsSpanInput> = [
      span({ spanId: "untimed", parentSpanId: "x", startTime: undefined }),
      span({ spanId: "timed", parentSpanId: "x", startTime: new Date(BASE) }),
    ];
    expect(pickRepresentativeSpan(spans)?.spanId).toBe("timed");
  });

  test("an invalid date is treated as no start time", () => {
    const spans: Array<TraceInsightsSpanInput> = [
      span({
        spanId: "invalid",
        parentSpanId: "x",
        startTime: new Date("not a date"),
      }),
      span({ spanId: "timed", parentSpanId: "x", startTime: new Date(BASE) }),
    ];
    expect(pickRepresentativeSpan(spans)?.spanId).toBe("timed");
  });

  test("equal start times keep the span seen first", () => {
    const spans: Array<TraceInsightsSpanInput> = [
      span({ spanId: "first", parentSpanId: "x" }),
      span({ spanId: "second", parentSpanId: "x" }),
    ];
    expect(pickRepresentativeSpan(spans)?.spanId).toBe("first");
  });

  test("with two roots (a broken trace), the earlier one wins", () => {
    const spans: Array<TraceInsightsSpanInput> = [
      span({ spanId: "root-b", startTime: new Date(BASE + 10) }),
      span({ spanId: "root-a", startTime: new Date(BASE) }),
    ];
    expect(pickRepresentativeSpan(spans)?.spanId).toBe("root-a");
  });
});

describe("summarizeTrace", () => {
  test("names, attributes and times the trace by its root span", () => {
    const summary: TraceInsightsTrace | undefined = summarizeTrace(
      "trace-a",
      checkoutTraceNewestFirst(),
    );
    expect(summary).toEqual({
      traceId: "trace-a",
      name: "POST /api/checkout",
      primaryEntityId: "svc-gateway",
      startTime: new Date(BASE),
      statusCode: SpanStatus.Unset,
      durationNano: 95_000_000,
      hasRootSpan: true,
    });
  });

  test("uses the root's duration even when a child looks longer (async work)", () => {
    // A fire-and-forget child can outlive the request that started it.
    const summary: TraceInsightsTrace | undefined = summarizeTrace("t", [
      span({ spanId: "root", durationNano: 5_000 }),
      span({ spanId: "async", parentSpanId: "root", durationNano: 9_000_000 }),
    ]);
    expect(summary?.durationNano).toBe(5_000);
  });

  test("without a root, the duration is the longest sampled span (a lower bound)", () => {
    const summary: TraceInsightsTrace | undefined = summarizeTrace("t", [
      span({
        spanId: "leaf",
        parentSpanId: "gone",
        startTime: new Date(BASE),
        durationNano: 1_000,
      }),
      span({
        spanId: "inner",
        parentSpanId: "gone",
        startTime: new Date(BASE + 1),
        durationNano: 7_000_000,
      }),
    ]);
    expect(summary?.name).toBe("span");
    expect(summary?.hasRootSpan).toBe(false);
    expect(summary?.durationNano).toBe(7_000_000);
  });

  test("an error on any span marks the trace as errored", () => {
    const spans: Array<TraceInsightsSpanInput> = checkoutTraceNewestFirst();
    spans[0]!.statusCode = SpanStatus.Error;
    expect(summarizeTrace("trace-a", spans)?.statusCode).toBe(SpanStatus.Error);
  });

  test("an OK root keeps its own status when nothing failed", () => {
    const summary: TraceInsightsTrace | undefined = summarizeTrace("t", [
      span({ spanId: "root", statusCode: SpanStatus.Ok }),
    ]);
    expect(summary?.statusCode).toBe(SpanStatus.Ok);
  });

  test("an unnamed root still gets a label", () => {
    expect(summarizeTrace("t", [span({ spanId: "r", name: "" })])?.name).toBe(
      UNKNOWN_TRACE_NAME,
    );
  });

  test("a missing duration counts as zero, not NaN", () => {
    const summary: TraceInsightsTrace | undefined = summarizeTrace("t", [
      span({ spanId: "r", durationNano: undefined as unknown as number }),
    ]);
    expect(summary?.durationNano).toBe(0);
  });

  test("a root with no start time gets the epoch rather than 'now'", () => {
    /*
     * The old code used new Date() here, which made an untimed trace look
     * like the most recent one.
     */
    const summary: TraceInsightsTrace | undefined = summarizeTrace("t", [
      span({ spanId: "r", startTime: undefined }),
    ]);
    expect(summary?.startTime.getTime()).toBe(0);
  });

  test("returns undefined for an empty trace", () => {
    expect(summarizeTrace("t", [])).toBeUndefined();
  });
});

describe("summarizeRecentTraces", () => {
  test("regression: a trace is not named after its newest span", () => {
    const result: TraceInsightsTraces = summarizeRecentTraces(
      checkoutTraceNewestFirst(),
    );
    expect(result.allTraces).toHaveLength(1);
    expect(result.allTraces[0]!.name).toBe("POST /api/checkout");
    expect(result.allTraces[0]!.name).not.toBe("set");
    expect(result.allTraces[0]!.durationNano).toBe(95_000_000);
  });

  test("groups interleaved spans of several traces", () => {
    const spans: Array<TraceInsightsSpanInput> = [
      span({
        traceId: "t1",
        spanId: "t1-child",
        parentSpanId: "t1-root",
        name: "get",
      }),
      span({ traceId: "t2", spanId: "t2-root", name: "GET /health" }),
      span({ traceId: "t1", spanId: "t1-root", name: "GET /orders" }),
    ];
    const result: TraceInsightsTraces = summarizeRecentTraces(spans);
    expect(
      result.allTraces.map((t: TraceInsightsTrace) => {
        return [t.traceId, t.name];
      }),
    ).toEqual([
      ["t1", "GET /orders"],
      ["t2", "GET /health"],
    ]);
  });

  test("keeps traces in the order their newest span appeared", () => {
    const spans: Array<TraceInsightsSpanInput> = [
      span({ traceId: "newest", spanId: "a" }),
      span({ traceId: "older", spanId: "b" }),
      span({ traceId: "newest", spanId: "c", parentSpanId: "a" }),
    ];
    expect(
      summarizeRecentTraces(spans).allTraces.map((t: TraceInsightsTrace) => {
        return t.traceId;
      }),
    ).toEqual(["newest", "older"]);
  });

  test("skips spans without a trace id", () => {
    const result: TraceInsightsTraces = summarizeRecentTraces([
      span({ traceId: "", spanId: "orphan" }),
    ]);
    expect(result.allTraces).toEqual([]);
    expect(result.errorTraces).toEqual([]);
  });

  test("an error trace is named after its root, not after the failing leaf", () => {
    const spans: Array<TraceInsightsSpanInput> = checkoutTraceNewestFirst();
    spans[0]!.statusCode = SpanStatus.Error;
    const result: TraceInsightsTraces = summarizeRecentTraces(spans);
    expect(result.errorTraces).toHaveLength(1);
    expect(result.errorTraces[0]!.name).toBe("POST /api/checkout");
    expect(result.errorTraces[0]!.statusCode).toBe(SpanStatus.Error);
  });

  test("error traces are ordered by their newest error and listed once", () => {
    const spans: Array<TraceInsightsSpanInput> = [
      span({ traceId: "t2", spanId: "t2-a", statusCode: SpanStatus.Error }),
      span({ traceId: "t1", spanId: "t1-a", statusCode: SpanStatus.Error }),
      span({
        traceId: "t2",
        spanId: "t2-b",
        parentSpanId: "t2-a",
        statusCode: SpanStatus.Error,
      }),
      span({ traceId: "t3", spanId: "t3-a", statusCode: SpanStatus.Ok }),
    ];
    expect(
      summarizeRecentTraces(spans).errorTraces.map((t: TraceInsightsTrace) => {
        return t.traceId;
      }),
    ).toEqual(["t2", "t1"]);
  });

  test("an empty sample yields nothing", () => {
    expect(summarizeRecentTraces([])).toEqual({
      allTraces: [],
      errorTraces: [],
    });
  });
});

describe("getSlowestTraces", () => {
  function trace(traceId: string, durationNano: number): TraceInsightsTrace {
    return {
      traceId,
      name: traceId,
      primaryEntityId: "svc",
      startTime: new Date(BASE),
      statusCode: SpanStatus.Unset,
      durationNano,
      hasRootSpan: true,
    };
  }

  test("sorts slowest first and caps the list", () => {
    const traces: Array<TraceInsightsTrace> = [
      trace("a", 10),
      trace("b", 30),
      trace("c", 20),
    ];
    expect(
      getSlowestTraces(traces, 2).map((t: TraceInsightsTrace) => {
        return t.traceId;
      }),
    ).toEqual(["b", "c"]);
  });

  test("equal durations keep their sample order", () => {
    const traces: Array<TraceInsightsTrace> = [
      trace("first", 5),
      trace("second", 5),
      trace("third", 5),
    ];
    expect(
      getSlowestTraces(traces, 3).map((t: TraceInsightsTrace) => {
        return t.traceId;
      }),
    ).toEqual(["first", "second", "third"]);
  });

  test("does not reorder the input", () => {
    const traces: Array<TraceInsightsTrace> = [trace("a", 1), trace("b", 2)];
    getSlowestTraces(traces, 2);
    expect(
      traces.map((t: TraceInsightsTrace) => {
        return t.traceId;
      }),
    ).toEqual(["a", "b"]);
  });

  test("a zero or negative limit returns nothing", () => {
    expect(getSlowestTraces([trace("a", 1)], 0)).toEqual([]);
    expect(getSlowestTraces([trace("a", 1)], -3)).toEqual([]);
  });

  test("regression: ranks by the trace's root duration, not its newest leaf", () => {
    const sample: Array<TraceInsightsSpanInput> = [
      // Trace "slow": 2s request whose newest span is a 10µs cache read.
      span({
        traceId: "slow",
        spanId: "s-leaf",
        parentSpanId: "s-root",
        durationNano: 10_000,
      }),
      // Trace "fast": 5ms request whose newest span is its root.
      span({ traceId: "fast", spanId: "f-root", durationNano: 5_000_000 }),
      span({ traceId: "slow", spanId: "s-root", durationNano: 2_000_000_000 }),
    ];
    const slowest: Array<TraceInsightsTrace> = getSlowestTraces(
      summarizeRecentTraces(sample).allTraces,
      8,
    );
    expect(
      slowest.map((t: TraceInsightsTrace) => {
        return t.traceId;
      }),
    ).toEqual(["slow", "fast"]);
  });
});
