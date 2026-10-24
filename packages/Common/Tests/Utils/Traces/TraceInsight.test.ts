/*
 * The gates Traces' AI section files its findings by (Utils/Traces/
 * TraceInsight): which services and operations are read, how a slow
 * request is told apart into a pattern worth fixing or time no span
 * accounts for, how failures are told apart into described, silent or
 * meant, and what each finding is called, how severe it is, and what
 * OneUptime asks the AI for it.
 */

import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../Types/AI/AIInsightType";
import { TraceInsightEvidence } from "../../../Types/AI/AIInsightEvidence";
import {
  PerformanceFinding,
  PerformanceFindingType,
} from "../../../Types/AI/CodeFixTaskContext";
import {
  WORTH_FIXING_MIN_MS,
  WORTH_FIXING_MIN_PERCENT_OF_TRACE,
  isFindingWorthFixing,
} from "../../../Utils/Suggestions/TracePerformanceFixSuggestion";
import { DOMINANT_SPAN_MIN_FRACTION } from "../../../Utils/Traces/SpanTreeAnalyzer";
import {
  FailedSpanSample,
  FailedSpansReading,
  SlowRequestReading,
  TRACE_INSIGHT_FAILED_SAMPLE_SIZE,
  TRACE_INSIGHT_FINGERPRINT_PREFIXES,
  TRACE_INSIGHT_HIGH_FAILED_PERCENT,
  TRACE_INSIGHT_HIGH_FAILED_SPANS,
  TRACE_INSIGHT_HIGH_P99_MS,
  TRACE_INSIGHT_HIGH_PERCENT_OF_REQUEST,
  TRACE_INSIGHT_MAX_FAILING_SERVICES,
  TRACE_INSIGHT_MAX_FINDINGS_PER_SERVICE,
  TRACE_INSIGHT_MAX_NO_CHILD_SPAN_SERVICES,
  TRACE_INSIGHT_MAX_SLOW_SERVICES,
  TRACE_INSIGHT_MIN_FAILED_PERCENT,
  TRACE_INSIGHT_MIN_FAILED_SPANS,
  TRACE_INSIGHT_MIN_NO_CHILD_SPANS,
  TRACE_INSIGHT_MIN_OPERATION_SPANS,
  TRACE_INSIGHT_MIN_SERVICE_SPANS,
  TRACE_INSIGHT_MIN_UNTRACED_MS,
  TRACE_INSIGHT_MIN_UNTRACED_PERCENT,
  TRACE_INSIGHT_OPERATIONS_PER_SERVICE,
  TRACE_INSIGHT_SLOW_P99_MS,
  TRACE_INSIGHT_STACK_TRACE_LINES,
  TRACE_INSIGHT_TYPE_BY_KIND,
  TRACE_INSIGHT_WINDOW_MINUTES,
  TraceFailureVerdict,
  TraceInsightKind,
  TraceInsightSpan,
  TraceOperationReading,
  TraceServiceReading,
  TraceTracingGap,
  buildTraceFixEvidenceNote,
  buildTraceInsightDetail,
  buildTraceFixRequestMessage,
  describeSlowFinding,
  describeSlowFindingCost,
  describeSlowFindingCostAsItem,
  describeTraceError,
  describeTraceProblem,
  formatTraceDuration,
  formatTracePercent,
  getFailedPercent,
  getFailureKey,
  getOperationRequestSpans,
  getTraceFixRequestTitle,
  getTraceInsightFingerprint,
  getTraceInsightSeverity,
  getTraceInsightStackTrace,
  getTraceInsightTitle,
  getTraceInsightWindow,
  isCallSpan,
  isTraceInsightFingerprintOfService,
  isTraceInsightKind,
  isTraceTracingGap,
  pickFailingOperations,
  pickFailingServices,
  pickNoChildSpanServices,
  pickSlowOperations,
  pickSlowServices,
  readFailedSpans,
  readSlowRequest,
} from "../../../Utils/Traces/TraceInsight";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

const SERVICE_A: string = "11111111-1111-4111-8111-111111111111";
const SERVICE_B: string = "22222222-2222-4222-8222-222222222222";
const SERVICE_C: string = "33333333-3333-4333-8333-333333333333";
const SERVICE_D: string = "44444444-4444-4444-8444-444444444444";

function service(
  overrides: Partial<TraceServiceReading> = {},
): TraceServiceReading {
  return {
    serviceId: SERVICE_A,
    spanCount: 1000,
    failedSpanCount: 0,
    rootSpanCount: 100,
    p99Ms: 0,
    ...overrides,
  };
}

function operation(
  overrides: Partial<TraceOperationReading> = {},
): TraceOperationReading {
  return {
    name: "GET /orders",
    spanCount: 200,
    failedSpanCount: 0,
    p50Ms: 120,
    p99Ms: 2400,
    ...overrides,
  };
}

// One span of a request, in milliseconds from the request's start.
function span(data: {
  id: string;
  parent?: string | undefined;
  name: string;
  start: number;
  end: number;
  kind?: string | undefined;
  serviceId?: string | undefined;
  attributes?: Record<string, string> | undefined;
}): TraceInsightSpan {
  return {
    spanId: data.id,
    parentSpanId: data.parent,
    name: data.name,
    startMs: data.start,
    endMs: data.end,
    durationMs: data.end - data.start,
    kind: data.kind,
    serviceId: data.serviceId || SERVICE_A,
    attributes: data.attributes || {},
  };
}

// GET /orders runs the same query once per order: 40 times, 40 ms each.
function nPlusOneRequest(): Array<TraceInsightSpan> {
  const spans: Array<TraceInsightSpan> = [
    span({
      id: "root",
      name: "GET /orders",
      start: 0,
      end: 2000,
      kind: "SPAN_KIND_SERVER",
    }),
  ];

  for (let index: number = 0; index < 40; index++) {
    spans.push(
      span({
        id: `q${index}`,
        parent: "root",
        name: "SELECT orders",
        start: 100 + index * 45,
        end: 140 + index * 45,
        kind: "SPAN_KIND_CLIENT",
        attributes: {
          "db.system": "postgresql",
          "db.statement": `SELECT * FROM orders WHERE id = ${index + 1}`,
          "code.filepath": "src/orders/list.ts",
          "code.function": "listOrders",
          "code.lineno": "42",
        },
      }),
    );
  }

  return spans;
}

// POST /checkout spends a second in one call to the payment provider.
function slowCallRequest(
  withTracedCallee: boolean = false,
): Array<TraceInsightSpan> {
  const spans: Array<TraceInsightSpan> = [
    span({
      id: "root",
      name: "POST /checkout",
      start: 0,
      end: 1200,
      kind: "SPAN_KIND_SERVER",
    }),
    span({
      id: "call",
      parent: "root",
      name: "POST payments.charge",
      start: 100,
      end: 1100,
      kind: "SPAN_KIND_CLIENT",
      attributes: { "url.full": "https://payments.example.com/charge" },
    }),
  ];

  if (withTracedCallee) {
    spans.push(
      span({
        id: "callee",
        parent: "call",
        name: "POST /charge",
        start: 110,
        end: 1090,
        kind: "SPAN_KIND_SERVER",
        serviceId: SERVICE_B,
      }),
    );
  }

  return spans;
}

// GET /report spends 2.5 s of its 2.6 s in its own work, with no span under it.
function untracedRequest(): Array<TraceInsightSpan> {
  return [
    span({
      id: "root",
      name: "GET /report",
      start: 0,
      end: 2600,
      kind: "SPAN_KIND_SERVER",
    }),
    span({
      id: "q",
      parent: "root",
      name: "SELECT reports",
      start: 0,
      end: 100,
      kind: "SPAN_KIND_CLIENT",
      attributes: { "db.system": "postgresql" },
    }),
  ];
}

// GET /prices asks three prices one after another: 900 ms of its 1 s.
function sequentialRequest(): Array<TraceInsightSpan> {
  return [
    span({
      id: "root",
      name: "GET /prices",
      start: 0,
      end: 1000,
      kind: "SPAN_KIND_SERVER",
    }),
    span({
      id: "p1",
      parent: "root",
      name: "GET /price",
      start: 50,
      end: 350,
      kind: "SPAN_KIND_CLIENT",
    }),
    span({
      id: "p2",
      parent: "root",
      name: "GET /price",
      start: 350,
      end: 650,
      kind: "SPAN_KIND_CLIENT",
    }),
    span({
      id: "p3",
      parent: "root",
      name: "GET /price",
      start: 650,
      end: 950,
      kind: "SPAN_KIND_CLIENT",
    }),
  ];
}

function failed(overrides: Partial<FailedSpanSample> = {}): FailedSpanSample {
  return {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    hasException: false,
    hasFaultEvent: false,
    ...overrides,
  };
}

function slowEvidence(
  overrides: Partial<TraceInsightEvidence> = {},
): TraceInsightEvidence {
  const reading: SlowRequestReading = readSlowRequest(nPlusOneRequest());

  return {
    serviceId: SERVICE_A,
    kind: TraceInsightKind.Slow,
    operationName: "GET /orders",
    windowStartTime: "2026-10-24T08:00:00.000Z",
    windowEndTime: "2026-10-24T09:00:00.000Z",
    spanCount: 1234,
    p50Ms: 180,
    p99Ms: 2400,
    sampleTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    sampleSpanId: "root",
    sampleDurationMs: reading.requestMs,
    performanceFindings: reading.fixable,
    ...overrides,
  };
}

function failingEvidence(
  overrides: Partial<TraceInsightEvidence> = {},
): TraceInsightEvidence {
  return {
    serviceId: SERVICE_A,
    kind: TraceInsightKind.Failing,
    operationName: "POST /checkout",
    windowStartTime: "2026-10-24T08:00:00.000Z",
    windowEndTime: "2026-10-24T09:00:00.000Z",
    spanCount: 2800,
    failedSpanCount: 340,
    p50Ms: 90,
    p99Ms: 900,
    sampleTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    error: {
      exceptionType: "TimeoutError",
      exceptionMessage: "payment provider did not answer in <NUMBER> ms",
      statusCode: "503",
      sampleMatches: 4,
      sampleSize: 5,
    },
    ...overrides,
  };
}

describe("the gates", () => {
  test("are the numbers the docs and the settings page say", () => {
    expect(TRACE_INSIGHT_WINDOW_MINUTES).toBe(60);
    expect(TRACE_INSIGHT_MIN_SERVICE_SPANS).toBe(100);
    expect(TRACE_INSIGHT_SLOW_P99_MS).toBe(1000);
    expect(TRACE_INSIGHT_MIN_OPERATION_SPANS).toBe(20);
    expect(TRACE_INSIGHT_MIN_FAILED_SPANS).toBe(20);
    expect(TRACE_INSIGHT_MIN_FAILED_PERCENT).toBe(5);
    expect(TRACE_INSIGHT_MIN_NO_CHILD_SPANS).toBe(500);
    expect(TRACE_INSIGHT_MIN_UNTRACED_MS).toBe(500);
    expect(TRACE_INSIGHT_MAX_SLOW_SERVICES).toBe(3);
    expect(TRACE_INSIGHT_MAX_FAILING_SERVICES).toBe(3);
    expect(TRACE_INSIGHT_MAX_NO_CHILD_SPAN_SERVICES).toBe(3);
    expect(TRACE_INSIGHT_OPERATIONS_PER_SERVICE).toBe(2);
    expect(TRACE_INSIGHT_MAX_FINDINGS_PER_SERVICE).toBe(2);
    expect(TRACE_INSIGHT_FAILED_SAMPLE_SIZE).toBe(5);
  });

  test("untraced time is the span-tree analysis' dominant span, and as costly as a slow call worth fixing", () => {
    expect(TRACE_INSIGHT_MIN_UNTRACED_PERCENT).toBe(
      DOMINANT_SPAN_MIN_FRACTION * 100,
    );
    expect(TRACE_INSIGHT_MIN_UNTRACED_MS).toBe(
      WORTH_FIXING_MIN_MS[PerformanceFindingType.DominantSpan],
    );
  });

  test("a finding is never less than the trace page's Fix performance with AI would offer", () => {
    for (const finding of readSlowRequest(nPlusOneRequest()).fixable) {
      expect(isFindingWorthFixing(finding)).toBe(true);
      expect(finding.percentOfTrace).toBeGreaterThanOrEqual(
        WORTH_FIXING_MIN_PERCENT_OF_TRACE,
      );
    }
  });

  test("each kind is filed as its own insight type", () => {
    expect(TRACE_INSIGHT_TYPE_BY_KIND).toEqual({
      [TraceInsightKind.Slow]: AIInsightType.TraceSlowOperation,
      [TraceInsightKind.Failing]: AIInsightType.TraceFailingOperation,
      [TraceInsightKind.MissingTracing]: AIInsightType.TraceMissingTracing,
    });
    expect(isTraceInsightKind("Slow")).toBe(true);
    expect(isTraceInsightKind("slow")).toBe(false);
    expect(isTraceInsightKind(undefined)).toBe(false);
    expect(isTraceTracingGap("UntracedTime")).toBe(true);
    expect(isTraceTracingGap("Slow")).toBe(false);
  });

  test("a look reads the last hour, up to now", () => {
    const now: Date = new Date("2026-10-24T09:00:00.000Z");

    expect(getTraceInsightWindow(now)).toEqual({
      startTime: new Date("2026-10-24T08:00:00.000Z"),
      endTime: now,
    });
  });
});

describe("which services a look reads", () => {
  test("slow: a p99 of a second or more over 100 or more spans, slowest first, three at most", () => {
    const readings: Array<TraceServiceReading> = [
      service({ serviceId: SERVICE_A, p99Ms: 1000 }),
      service({ serviceId: SERVICE_B, p99Ms: 4000 }),
      service({ serviceId: SERVICE_C, p99Ms: 999 }),
      service({ serviceId: SERVICE_D, p99Ms: 9000, spanCount: 99 }),
      service({
        serviceId: "55555555-5555-4555-8555-555555555555",
        p99Ms: 2000,
      }),
      service({
        serviceId: "66666666-6666-4666-8666-666666666666",
        p99Ms: 1500,
      }),
    ];

    expect(pickSlowServices(readings)).toEqual([
      SERVICE_B,
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    ]);
  });

  test("failing: 20 or more failed spans, the most first", () => {
    expect(
      pickFailingServices([
        service({ serviceId: SERVICE_A, failedSpanCount: 19 }),
        service({ serviceId: SERVICE_B, failedSpanCount: 20 }),
        service({ serviceId: SERVICE_C, failedSpanCount: 500 }),
        service({ serviceId: SERVICE_D, failedSpanCount: 50, spanCount: 50 }),
      ]),
    ).toEqual([SERVICE_C, SERVICE_B]);
  });

  test("no child spans: 500 or more spans, every one a root", () => {
    expect(
      pickNoChildSpanServices([
        service({ serviceId: SERVICE_A, spanCount: 600, rootSpanCount: 600 }),
        service({ serviceId: SERVICE_B, spanCount: 600, rootSpanCount: 599 }),
        service({ serviceId: SERVICE_C, spanCount: 499, rootSpanCount: 499 }),
        service({ serviceId: SERVICE_D, spanCount: 900, rootSpanCount: 900 }),
      ]),
    ).toEqual([SERVICE_D, SERVICE_A]);
  });

  test("a company AI tool's service is never read, whatever it shows", () => {
    const excluded: Set<string> = new Set<string>([SERVICE_B]);
    const readings: Array<TraceServiceReading> = [
      service({
        serviceId: SERVICE_B.toUpperCase(),
        p99Ms: 9000,
        failedSpanCount: 900,
        spanCount: 900,
        rootSpanCount: 900,
      }),
    ];

    expect(pickSlowServices(readings, excluded)).toEqual([]);
    expect(pickFailingServices(readings, excluded)).toEqual([]);
    expect(pickNoChildSpanServices(readings, excluded)).toEqual([]);
  });

  test("ids come back lower-cased, as Postgres renders a uuid", () => {
    expect(
      pickSlowServices([
        service({ serviceId: SERVICE_A.toUpperCase(), p99Ms: 2000 }),
      ]),
    ).toEqual([SERVICE_A]);
  });

  test("ties fall to volume, then to the id: the same order every look", () => {
    expect(
      pickSlowServices([
        service({ serviceId: SERVICE_C, p99Ms: 2000, spanCount: 500 }),
        service({ serviceId: SERVICE_B, p99Ms: 2000, spanCount: 900 }),
        service({ serviceId: SERVICE_A, p99Ms: 2000, spanCount: 500 }),
      ]),
    ).toEqual([SERVICE_B, SERVICE_A, SERVICE_C]);
  });

  test("whatever the readings, the picks hold to the gates (seeded)", () => {
    const random: SeededRandom = seededRandom(5_201);

    for (let round: number = 0; round < 200; round++) {
      const readings: Array<TraceServiceReading> = [];
      const count: number = random(12);

      for (let index: number = 0; index < count; index++) {
        const spanCount: number = random(2000);
        readings.push({
          serviceId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          spanCount,
          failedSpanCount: random(spanCount + 1),
          rootSpanCount: random(2) === 0 ? spanCount : random(spanCount + 1),
          p99Ms: random(6000),
        });
      }

      const slow: Array<string> = pickSlowServices(readings);
      const failing: Array<string> = pickFailingServices(readings);
      const noChild: Array<string> = pickNoChildSpanServices(readings);

      expect(slow.length).toBeLessThanOrEqual(TRACE_INSIGHT_MAX_SLOW_SERVICES);
      expect(failing.length).toBeLessThanOrEqual(
        TRACE_INSIGHT_MAX_FAILING_SERVICES,
      );
      expect(noChild.length).toBeLessThanOrEqual(
        TRACE_INSIGHT_MAX_NO_CHILD_SPAN_SERVICES,
      );

      const byId: Map<string, TraceServiceReading> = new Map(
        readings.map((reading: TraceServiceReading) => {
          return [reading.serviceId, reading];
        }),
      );

      let lastP99: number = Infinity;

      for (const id of slow) {
        const reading: TraceServiceReading = byId.get(id)!;
        expect(reading.p99Ms).toBeGreaterThanOrEqual(TRACE_INSIGHT_SLOW_P99_MS);
        expect(reading.spanCount).toBeGreaterThanOrEqual(
          TRACE_INSIGHT_MIN_SERVICE_SPANS,
        );
        expect(reading.p99Ms).toBeLessThanOrEqual(lastP99);
        lastP99 = reading.p99Ms;
      }

      for (const id of failing) {
        expect(byId.get(id)!.failedSpanCount).toBeGreaterThanOrEqual(
          TRACE_INSIGHT_MIN_FAILED_SPANS,
        );
      }

      for (const id of noChild) {
        const reading: TraceServiceReading = byId.get(id)!;
        expect(reading.rootSpanCount).toBe(reading.spanCount);
        expect(reading.spanCount).toBeGreaterThanOrEqual(
          TRACE_INSIGHT_MIN_NO_CHILD_SPANS,
        );
      }
    }
  });
});

describe("which operations of a service are read closely", () => {
  test("slow: 20 or more spans with a p99 of a second or more, slowest first, two at most", () => {
    expect(
      pickSlowOperations([
        operation({ name: "GET /a", p99Ms: 1200 }),
        operation({ name: "GET /b", p99Ms: 9000, spanCount: 19 }),
        operation({ name: "GET /c", p99Ms: 999 }),
        operation({ name: "GET /d", p99Ms: 3000 }),
        operation({ name: "GET /e", p99Ms: 2000 }),
        operation({ name: "", p99Ms: 9000 }),
      ]).map((reading: TraceOperationReading): string => {
        return reading.name;
      }),
    ).toEqual(["GET /d", "GET /e"]);
  });

  test("failing: 20 or more failed spans and 5% or more of them, the most first", () => {
    expect(
      pickFailingOperations([
        operation({ name: "A", spanCount: 1000, failedSpanCount: 49 }),
        operation({ name: "B", spanCount: 1000, failedSpanCount: 50 }),
        operation({ name: "C", spanCount: 100, failedSpanCount: 19 }),
        operation({ name: "D", spanCount: 100, failedSpanCount: 90 }),
        operation({ name: "E", spanCount: 400, failedSpanCount: 60 }),
      ]).map((reading: TraceOperationReading): string => {
        return reading.name;
      }),
    ).toEqual(["D", "E"]);
  });

  test("the failed share is of the operation's own spans", () => {
    expect(getFailedPercent({ spanCount: 2800, failedSpanCount: 340 })).toBe(
      (340 / 2800) * 100,
    );
    expect(getFailedPercent({ spanCount: 0, failedSpanCount: 10 })).toBe(0);
    expect(getFailedPercent({ spanCount: 10, failedSpanCount: -3 })).toBe(0);
  });

  test("ties fall to volume, then to the name", () => {
    expect(
      pickSlowOperations([
        operation({ name: "b", p99Ms: 2000, spanCount: 50 }),
        operation({ name: "a", p99Ms: 2000, spanCount: 50 }),
        operation({ name: "c", p99Ms: 2000, spanCount: 90 }),
      ]).map((reading: TraceOperationReading): string => {
        return reading.name;
      }),
    ).toEqual(["c", "a"]);
  });
});

describe("what counts as a call", () => {
  test("a client or producer span is a call, a server or consumer span never is", () => {
    expect(
      isCallSpan(
        span({
          id: "1",
          name: "x",
          start: 0,
          end: 1,
          kind: "SPAN_KIND_CLIENT",
        }),
      ),
    ).toBe(true);
    expect(
      isCallSpan(
        span({
          id: "1",
          name: "x",
          start: 0,
          end: 1,
          kind: "SPAN_KIND_PRODUCER",
        }),
      ),
    ).toBe(true);
    expect(
      isCallSpan(
        span({
          id: "1",
          name: "x",
          start: 0,
          end: 1,
          kind: "SPAN_KIND_SERVER",
          attributes: { "http.url": "https://example.com/" },
        }),
      ),
    ).toBe(false);
    expect(
      isCallSpan(
        span({
          id: "1",
          name: "x",
          start: 0,
          end: 1,
          kind: "SPAN_KIND_CONSUMER",
        }),
      ),
    ).toBe(false);
  });

  test("an internal span is a call when it carries a call's attributes", () => {
    for (const key of [
      "db.system",
      "db.system.name",
      "db.statement",
      "db.query.text",
      "rpc.system",
      "messaging.system",
      "peer.service",
      "http.url",
      "url.full",
    ]) {
      expect(
        isCallSpan(
          span({
            id: "1",
            name: "x",
            start: 0,
            end: 1,
            kind: "SPAN_KIND_INTERNAL",
            attributes: { [key]: "value" },
          }),
        ),
      ).toBe(true);
    }

    expect(
      isCallSpan(
        span({
          id: "1",
          name: "x",
          start: 0,
          end: 1,
          kind: "SPAN_KIND_INTERNAL",
        }),
      ),
    ).toBe(false);
    expect(isCallSpan(span({ id: "1", name: "x", start: 0, end: 1 }))).toBe(
      false,
    );
  });
});

describe("the request one operation's span stands for", () => {
  test("is that span and every span under it the service recorded", () => {
    const spans: Array<TraceInsightSpan> = [
      span({ id: "up", name: "GET /", start: 0, end: 3000 }),
      ...nPlusOneRequest().map((item: TraceInsightSpan): TraceInsightSpan => {
        return item.spanId === "root" ? { ...item, parentSpanId: "up" } : item;
      }),
      span({
        id: "beside",
        parent: "up",
        name: "GET /other",
        start: 0,
        end: 10,
      }),
    ];

    const request: Array<TraceInsightSpan> = getOperationRequestSpans({
      spans,
      operationSpanId: "root",
      serviceId: SERVICE_A,
    });

    expect(
      request.map((item: TraceInsightSpan) => {
        return item.spanId;
      }),
    ).toHaveLength(41);
    expect(
      request.some((item: TraceInsightSpan) => {
        return item.spanId === "up" || item.spanId === "beside";
      }),
    ).toBe(false);
  });

  test("leaves a callee's spans to the callee, and marks the call whose callee traces itself", () => {
    const request: Array<TraceInsightSpan> = getOperationRequestSpans({
      spans: slowCallRequest(true),
      operationSpanId: "root",
      serviceId: SERVICE_A.toUpperCase(),
    });

    expect(
      request.map((item: TraceInsightSpan) => {
        return item.spanId;
      }),
    ).toEqual(["root", "call"]);
    expect(
      request.find((item: TraceInsightSpan) => {
        return item.spanId === "call";
      })?.hasTracedCallee,
    ).toBe(true);
    expect(
      request.find((item: TraceInsightSpan) => {
        return item.spanId === "root";
      })?.hasTracedCallee,
    ).toBe(false);
  });

  test("is nothing when the operation's span is not in the trace", () => {
    expect(
      getOperationRequestSpans({
        spans: nPlusOneRequest(),
        operationSpanId: "missing",
        serviceId: SERVICE_A,
      }),
    ).toEqual([]);
  });

  test("reads each span once, whatever loops the parents make", () => {
    const looped: Array<TraceInsightSpan> = [
      span({ id: "a", parent: "b", name: "A", start: 0, end: 10 }),
      span({ id: "b", parent: "a", name: "B", start: 0, end: 10 }),
    ];

    expect(
      getOperationRequestSpans({
        spans: looped,
        operationSpanId: "a",
        serviceId: SERVICE_A,
      }),
    ).toHaveLength(2);
  });
});

describe("what a slow request says", () => {
  test("the same query once per item: a pattern worth fixing", () => {
    const reading: SlowRequestReading = readSlowRequest(nPlusOneRequest());

    expect(reading.untraced).toBeNull();
    expect(reading.fixable).toHaveLength(1);
    expect(reading.fixable[0]!.findingType).toBe(
      PerformanceFindingType.NPlusOneQuery,
    );
    expect(reading.fixable[0]!.spanCount).toBe(40);
    expect(reading.requestMs).toBe(2000);
  });

  test("calls made one after another that could run together: a pattern worth fixing", () => {
    const reading: SlowRequestReading = readSlowRequest(sequentialRequest());

    expect(
      reading.fixable.map((finding: PerformanceFinding) => {
        return finding.findingType;
      }),
    ).toContain(PerformanceFindingType.SequentialSiblings);
  });

  test("one slow call to a third party: a pattern worth fixing", () => {
    const reading: SlowRequestReading = readSlowRequest(slowCallRequest());

    expect(reading.fixable).toHaveLength(1);
    expect(reading.fixable[0]!.findingType).toBe(
      PerformanceFindingType.DominantSpan,
    );
    expect(reading.fixable[0]!.implicatedSpans[0]!.name).toBe(
      "POST payments.charge",
    );
  });

  test("one slow call to a service that traces itself: the callee's finding, not this one", () => {
    const request: Array<TraceInsightSpan> = getOperationRequestSpans({
      spans: slowCallRequest(true),
      operationSpanId: "root",
      serviceId: SERVICE_A,
    });

    expect(readSlowRequest(request)).toEqual({
      fixable: [],
      untraced: null,
      requestMs: 1200,
    });
  });

  test("time in the service's own work with no span under it: untraced time", () => {
    const reading: SlowRequestReading = readSlowRequest(untracedRequest());

    expect(reading.fixable).toEqual([]);
    expect(reading.untraced).toEqual({
      spanName: "GET /report",
      untracedMs: 2500,
      requestMs: 2600,
    });
  });

  test("a pattern worth fixing wins over untraced time in the same request", () => {
    const spans: Array<TraceInsightSpan> = [
      ...nPlusOneRequest(),
      span({
        id: "worker",
        parent: "root",
        name: "render",
        start: 1900,
        end: 1999,
        kind: "SPAN_KIND_INTERNAL",
      }),
    ];

    const reading: SlowRequestReading = readSlowRequest(spans);

    expect(reading.fixable.length).toBeGreaterThan(0);
    expect(reading.untraced).toBeNull();
  });

  test("a fast request says nothing", () => {
    expect(
      readSlowRequest([
        span({
          id: "root",
          name: "GET /health",
          start: 0,
          end: 300,
          kind: "SPAN_KIND_SERVER",
        }),
        span({
          id: "q",
          parent: "root",
          name: "SELECT 1",
          start: 0,
          end: 250,
          kind: "SPAN_KIND_CLIENT",
          attributes: { "db.system": "postgresql" },
        }),
      ]),
    ).toEqual({ fixable: [], untraced: null, requestMs: 300 });
  });

  test("an empty request says nothing", () => {
    expect(readSlowRequest([])).toEqual({
      fixable: [],
      untraced: null,
      requestMs: 0,
    });
  });
});

describe("what an operation's recent failures say", () => {
  test("none read: nothing is known, so nothing is filed", () => {
    expect(readFailedSpans([])).toEqual({
      verdict: TraceFailureVerdict.Unread,
      error: null,
      sample: null,
    });
  });

  test("only faults the code meant: expected, never filed", () => {
    const reading: FailedSpansReading = readFailedSpans([
      failed({ hasFaultEvent: true, statusMessage: "Invalid API key" }),
      failed({ hasFaultEvent: true }),
    ]);

    expect(reading.verdict).toBe(TraceFailureVerdict.Expected);
  });

  test("a fault beside a recorded exception is not expected", () => {
    expect(
      readFailedSpans([
        failed({ hasFaultEvent: true }),
        failed({
          hasException: true,
          exceptionType: "TypeError",
          exceptionMessage: "x is undefined",
        }),
      ]).verdict,
    ).toBe(TraceFailureVerdict.Described);
  });

  test("no message and no exception: silent", () => {
    const reading: FailedSpansReading = readFailedSpans([
      failed({ spanId: "1" }),
      failed({ spanId: "2", statusMessage: "   " }),
    ]);

    expect(reading.verdict).toBe(TraceFailureVerdict.Silent);
    expect(reading.error).toBeNull();
    expect(reading.sample?.spanId).toBe("1");
  });

  test("described: the error most of them failed with, its stack trace cut", () => {
    const stackTrace: string = Array.from(
      { length: 50 },
      (_unused: unknown, index: number): string => {
        return `    at frame${index} (src/pay.ts:${index + 1})`;
      },
    ).join("\n");

    const reading: FailedSpansReading = readFailedSpans([
      failed({ spanId: "1", statusMessage: "upstream connect error" }),
      failed({
        spanId: "2",
        hasException: true,
        exceptionType: "TimeoutError",
        exceptionMessage: "payment provider did not answer",
        stackTrace,
        statusCode: "503",
      }),
      failed({
        spanId: "3",
        hasException: true,
        exceptionType: "TimeoutError",
        exceptionMessage: "payment provider did not answer",
      }),
    ]);

    expect(reading.verdict).toBe(TraceFailureVerdict.Described);
    expect(reading.sample?.spanId).toBe("2");
    expect(reading.error).toEqual({
      exceptionType: "TimeoutError",
      exceptionMessage: "payment provider did not answer",
      stackTrace: stackTrace
        .split("\n")
        .slice(0, TRACE_INSIGHT_STACK_TRACE_LINES)
        .join("\n"),
      statusCode: "503",
      sampleMatches: 2,
      sampleSize: 3,
    });
  });

  test("on a tie, the newest error wins", () => {
    const reading: FailedSpansReading = readFailedSpans([
      failed({ spanId: "new", statusMessage: "Connection refused" }),
      failed({ spanId: "old", statusMessage: "Deadline exceeded" }),
    ]);

    expect(reading.error?.statusMessage).toBe("Connection refused");
    expect(reading.sample?.spanId).toBe("new");
  });

  test("an exception and a status message are different errors", () => {
    expect(
      getFailureKey(failed({ exceptionType: "E", statusMessage: "E" })),
    ).not.toBe(getFailureKey(failed({ statusMessage: "E" })));
  });
});

describe("a finding's identity", () => {
  test("is its kind, its service and its operation with ids collapsed", () => {
    expect(
      getTraceInsightFingerprint({
        kind: TraceInsightKind.Slow,
        serviceId: SERVICE_A.toUpperCase(),
        operationName: "GET /users/42",
      }),
    ).toBe(`trace-slow:${SERVICE_A}:GET /users/{n}`);

    expect(
      getTraceInsightFingerprint({
        kind: TraceInsightKind.Failing,
        serviceId: SERVICE_A,
        operationName: "GET /users/97",
      }),
    ).toBe(`trace-failing:${SERVICE_A}:GET /users/{n}`);

    expect(
      getTraceInsightFingerprint({
        kind: TraceInsightKind.MissingTracing,
        serviceId: SERVICE_A,
        gap: TraceTracingGap.UntracedTime,
        operationName: "GET /report",
      }),
    ).toBe(`trace-missing-tracing:${SERVICE_A}:UntracedTime:GET /report`);

    expect(
      getTraceInsightFingerprint({
        kind: TraceInsightKind.MissingTracing,
        serviceId: SERVICE_A,
        gap: TraceTracingGap.NoChildSpans,
      }),
    ).toBe(`trace-missing-tracing:${SERVICE_A}:NoChildSpans:`);
  });

  test("tells a service's findings from another's", () => {
    for (const prefix of Object.values(TRACE_INSIGHT_FINGERPRINT_PREFIXES)) {
      expect(
        isTraceInsightFingerprintOfService(
          `${prefix}:${SERVICE_A}:GET /x`,
          SERVICE_A.toUpperCase(),
        ),
      ).toBe(true);
      expect(
        isTraceInsightFingerprintOfService(
          `${prefix}:${SERVICE_A}:GET /x`,
          SERVICE_B,
        ),
      ).toBe(false);
    }

    expect(
      isTraceInsightFingerprintOfService(`latency:${SERVICE_A}:x`, SERVICE_A),
    ).toBe(false);
    expect(isTraceInsightFingerprintOfService("trace-slow::x", "")).toBe(false);
  });
});

describe("how findings say numbers", () => {
  test("shares", () => {
    expect(formatTracePercent(12.14)).toBe("12%");
    expect(formatTracePercent(5.44)).toBe("5.4%");
    expect(formatTracePercent(0.75)).toBe("0.8%");
    expect(formatTracePercent(Number.NaN)).toBe("0%");
  });

  test("durations", () => {
    expect(formatTraceDuration(840)).toBe("840 ms");
    expect(formatTraceDuration(2400)).toBe("2.4 s");
    expect(formatTraceDuration(12_400)).toBe("12 s");
    expect(formatTraceDuration(-1)).toBe("0 ms");
    expect(formatTraceDuration(Number.POSITIVE_INFINITY)).toBe("0 ms");
  });
});

describe("what a finding is called", () => {
  test("a slow operation, by the pattern its slowest request repeats", () => {
    expect(
      getTraceInsightTitle({
        evidence: slowEvidence(),
        serviceName: "checkout",
      }),
    ).toBe("GET /orders in checkout runs the same database query 40 times");
  });

  test("every pattern has its own words", () => {
    const base: PerformanceFinding =
      readSlowRequest(nPlusOneRequest()).fixable[0]!;

    expect(describeSlowFinding(base)).toBe(
      "runs the same database query 40 times",
    );
    expect(
      describeSlowFinding({
        ...base,
        normalizedDbStatement: undefined,
        dbSystem: undefined,
        implicatedSpans: [{ spanId: "1", name: "GET /stock", durationMs: 4 }],
      }),
    ).toBe("calls GET /stock 40 times");
    expect(
      describeSlowFinding({
        ...base,
        findingType: PerformanceFindingType.SequentialSiblings,
        spanCount: 6,
      }),
    ).toBe("runs 6 database calls one after another");
    expect(
      describeSlowFinding({
        ...base,
        findingType: PerformanceFindingType.SequentialSiblings,
        spanCount: 6,
        normalizedDbStatement: undefined,
        dbSystem: undefined,
        implicatedSpans: [{ spanId: "1", name: "GET /price", durationMs: 4 }],
      }),
    ).toBe("makes 6 calls to GET /price one after another");
    expect(
      describeSlowFinding({
        ...base,
        findingType: PerformanceFindingType.DominantSpan,
      }),
    ).toBe("spends most of its time in one database query");
    expect(
      describeSlowFinding({
        ...base,
        findingType: PerformanceFindingType.DominantSpan,
        normalizedDbStatement: undefined,
        dbSystem: undefined,
        implicatedSpans: [
          { spanId: "1", name: "POST payments.charge", durationMs: 1000 },
        ],
      }),
    ).toBe("spends most of its time in POST payments.charge");
  });

  test("a failing operation, by how often it fails", () => {
    expect(
      getTraceInsightTitle({
        evidence: failingEvidence(),
        serviceName: "checkout",
      }),
    ).toBe("POST /checkout in checkout fails 12% of the time");
  });

  test("missing tracing, by what the traces lack", () => {
    expect(
      getTraceInsightTitle({
        evidence: {
          ...failingEvidence({ error: undefined }),
          kind: TraceInsightKind.MissingTracing,
          gap: TraceTracingGap.SilentFailures,
        },
        serviceName: "checkout",
      }),
    ).toBe("POST /checkout in checkout fails without saying why");

    expect(
      getTraceInsightTitle({
        evidence: {
          ...slowEvidence({ performanceFindings: undefined }),
          kind: TraceInsightKind.MissingTracing,
          gap: TraceTracingGap.UntracedTime,
          operationName: "GET /report",
          untracedSpanName: "GET /report",
          untracedMs: 2100,
          sampleDurationMs: 2600,
        },
        serviceName: "reporting",
      }),
    ).toBe("GET /report in reporting spends 81% of its time untraced");

    expect(
      getTraceInsightTitle({
        evidence: {
          serviceId: SERVICE_A,
          kind: TraceInsightKind.MissingTracing,
          gap: TraceTracingGap.NoChildSpans,
          windowStartTime: "2026-10-24T08:00:00.000Z",
          windowEndTime: "2026-10-24T09:00:00.000Z",
          spanCount: 2400,
        },
        serviceName: "edge",
      }),
    ).toBe("edge's requests have no spans inside them");
  });

  test("a service with no name still reads as a sentence", () => {
    expect(
      getTraceInsightTitle({
        evidence: slowEvidence({ operationName: undefined }),
        serviceName: "",
      }),
    ).toBe("An operation runs the same database query 40 times");
  });
});

describe("how severe a finding is", () => {
  test("slow: High when the pattern costs half the request or the p99 is five seconds", () => {
    expect(getTraceInsightSeverity(slowEvidence())).toBe(
      AIInsightSeverity.High,
    );

    const finding: PerformanceFinding =
      readSlowRequest(nPlusOneRequest()).fixable[0]!;
    const small: TraceInsightEvidence = slowEvidence({
      p99Ms: TRACE_INSIGHT_HIGH_P99_MS - 1,
      performanceFindings: [
        {
          ...finding,
          percentOfTrace: TRACE_INSIGHT_HIGH_PERCENT_OF_REQUEST - 1,
        },
      ],
    });

    expect(getTraceInsightSeverity(small)).toBe(AIInsightSeverity.Medium);
    expect(
      getTraceInsightSeverity({ ...small, p99Ms: TRACE_INSIGHT_HIGH_P99_MS }),
    ).toBe(AIInsightSeverity.High);
  });

  test("failing: High at a quarter of the spans or a thousand failures", () => {
    expect(getTraceInsightSeverity(failingEvidence())).toBe(
      AIInsightSeverity.Medium,
    );
    expect(
      getTraceInsightSeverity(
        failingEvidence({
          spanCount: 100,
          failedSpanCount: TRACE_INSIGHT_HIGH_FAILED_PERCENT,
        }),
      ),
    ).toBe(AIInsightSeverity.High);
    expect(
      getTraceInsightSeverity(
        failingEvidence({
          spanCount: 1_000_000,
          failedSpanCount: TRACE_INSIGHT_HIGH_FAILED_SPANS,
        }),
      ),
    ).toBe(AIInsightSeverity.High);
  });

  test("missing tracing: Low, but Medium while it hides failures", () => {
    expect(
      getTraceInsightSeverity({
        ...slowEvidence(),
        kind: TraceInsightKind.MissingTracing,
        gap: TraceTracingGap.UntracedTime,
      }),
    ).toBe(AIInsightSeverity.Low);
    expect(
      getTraceInsightSeverity({
        ...failingEvidence(),
        kind: TraceInsightKind.MissingTracing,
        gap: TraceTracingGap.SilentFailures,
      }),
    ).toBe(AIInsightSeverity.Medium);
  });
});

describe("what OneUptime asks the AI", () => {
  test("a slow operation: make it faster, with what the slowest request repeats", () => {
    const message: string = buildTraceFixRequestMessage({
      evidence: slowEvidence(),
      serviceName: "checkout",
      isStartedByOneUptime: true,
    });

    expect(message.split("\n")[0]).toBe("Make GET /orders in checkout faster");
    expect(message).toContain(
      "OneUptime found this in the service's traces on its own.",
    );
    expect(message).toContain(
      "Over the last hour its slowest requests took 2.4 s (p99 of 1,234 requests).",
    );
    expect(message).toContain(
      "the same database query ran 40 times under GET /orders",
    );
    expect(message).toContain("say why and change nothing");
  });

  test("a person's request is the same, without OneUptime's leave to change nothing", () => {
    const message: string = buildTraceFixRequestMessage({
      evidence: slowEvidence(),
      serviceName: "checkout",
      isStartedByOneUptime: false,
    });

    expect(message).not.toContain("on its own");
    expect(message).not.toContain("change nothing");
    expect(message).toContain("Make GET /orders in checkout faster");
  });

  test("a failing operation: fix why it fails, with the error it fails with", () => {
    const message: string = buildTraceFixRequestMessage({
      evidence: failingEvidence(),
      serviceName: "checkout",
      isStartedByOneUptime: true,
    });

    expect(message.split("\n")[0]).toBe(
      "Fix why POST /checkout in checkout fails",
    );
    expect(message).toContain(
      "Over the last hour 340 of its 2,800 requests failed (12%).",
    );
    expect(message).toContain(
      "4 of the 5 most recent failures failed with: TimeoutError: payment provider did not answer in <NUMBER> ms (status 503).",
    );
    expect(message).toContain("rather than hide a real failure");
  });

  test("missing tracing: add the tracing it lacks, and change nothing it does", () => {
    for (const gap of Object.values(TraceTracingGap)) {
      const message: string = buildTraceFixRequestMessage({
        evidence: {
          ...failingEvidence({ error: undefined }),
          kind: TraceInsightKind.MissingTracing,
          gap,
          topOperations: [{ name: "GET /", spanCount: 2000 }],
          untracedSpanName: "POST /checkout",
          untracedMs: 900,
          sampleDurationMs: 1000,
        },
        serviceName: "checkout",
        isStartedByOneUptime: true,
      });

      expect(message).toContain("Do not change what the code does");
      expect(message).toContain(
        "tracing is set up somewhere other than this repository",
      );
    }
  });

  test("every request's first line is its title in Code", () => {
    expect(
      getTraceFixRequestTitle({
        evidence: slowEvidence(),
        serviceName: "checkout",
      }),
    ).toBe("Make GET /orders in checkout faster");
    expect(
      getTraceFixRequestTitle({
        evidence: {
          ...slowEvidence(),
          kind: TraceInsightKind.MissingTracing,
          gap: TraceTracingGap.UntracedTime,
        },
        serviceName: "checkout",
      }),
    ).toBe("Add tracing inside GET /orders in checkout");
    expect(
      getTraceFixRequestTitle({
        evidence: {
          ...failingEvidence(),
          kind: TraceInsightKind.MissingTracing,
          gap: TraceTracingGap.SilentFailures,
        },
        serviceName: "checkout",
      }),
    ).toBe("Record why POST /checkout in checkout fails");
    expect(
      getTraceFixRequestTitle({
        evidence: {
          ...failingEvidence(),
          kind: TraceInsightKind.MissingTracing,
          gap: TraceTracingGap.NoChildSpans,
        },
        serviceName: "edge",
      }),
    ).toBe("Add tracing inside edge's requests");
  });

  test("the problem, said for each kind", () => {
    expect(
      describeTraceProblem({
        serviceId: SERVICE_A,
        kind: TraceInsightKind.MissingTracing,
        gap: TraceTracingGap.NoChildSpans,
        windowStartTime: "2026-10-24T08:00:00.000Z",
        windowEndTime: "2026-10-24T09:00:00.000Z",
        spanCount: 2400,
        topOperations: [
          { name: "GET /orders", spanCount: 1200 },
          { name: "POST /checkout", spanCount: 600 },
        ],
      }),
    ).toBe(
      "It sent 2,400 spans over the last hour, and every one was its trace's only span: nothing records what a request did inside it, so when a request is slow or fails, its trace cannot say why. Its busiest operations: GET /orders (1,200), POST /checkout (600).",
    );
    expect(
      describeTraceProblem({
        ...slowEvidence(),
        kind: TraceInsightKind.MissingTracing,
        gap: TraceTracingGap.UntracedTime,
        untracedSpanName: "GET /report",
        untracedMs: 2100,
        sampleDurationMs: 2600,
      }),
    ).toBe(
      "In its slowest request over the last hour (2.6 s), 2.1 s was spent in GET /report itself, with no span under it to say where.",
    );
  });

  test("errors read as one line", () => {
    expect(
      describeTraceError({
        statusMessage: "boom",
        sampleMatches: 1,
        sampleSize: 1,
      }),
    ).toBe("boom");
    expect(
      describeTraceError({
        exceptionType: "E",
        sampleMatches: 1,
        sampleSize: 1,
      }),
    ).toBe("E");
    expect(describeTraceError({ sampleMatches: 1, sampleSize: 1 })).toBe(
      "an error",
    );
  });

  test("the cost of a pattern is said in time and share", () => {
    const finding: PerformanceFinding =
      readSlowRequest(nPlusOneRequest()).fixable[0]!;

    expect(describeSlowFindingCost(finding)).toBe(
      "the same database query ran 40 times under GET /orders: 1.6 s together, 80% of the request",
    );
  });
});

describe("what the task is given beside the trace", () => {
  test("the deterministic evidence, in plain text", () => {
    const note: string = buildTraceFixEvidenceNote(
      slowEvidence({
        codeLocations: [
          {
            filePath: "src/orders/list.ts",
            functionName: "listOrders",
            lineNumber: 42,
          },
        ],
      }),
    );

    expect(note).toContain("Operation: GET /orders");
    expect(note).toContain("Spans in the window: 1,234");
    expect(note).toContain("p99: 2.4 s");
    expect(note).toContain("Sample trace: 4bf92f3577b34da6a3ce929d0e0e4736");
    expect(note).toContain("Statement: SELECT * FROM orders WHERE id = ?");
    expect(note).toContain("Code: src/orders/list.ts:42 (listOrders)");
  });

  test("a failing operation's note names the error and its stack", () => {
    const note: string = buildTraceFixEvidenceNote(
      failingEvidence({
        error: {
          exceptionType: "TimeoutError",
          stackTrace: "    at charge (src/pay.ts:9)",
          sampleMatches: 5,
          sampleSize: 5,
        },
      }),
    );

    expect(note).toContain("Failed spans: 340");
    expect(note).toContain("Error: TimeoutError");
    expect(note).toContain("Stack trace:\n    at charge (src/pay.ts:9)");
  });

  test("the code it names, as a stack trace the repository resolver reads", () => {
    expect(getTraceInsightStackTrace(null)).toBeNull();
    expect(getTraceInsightStackTrace(slowEvidence())).toBeNull();
    expect(
      getTraceInsightStackTrace(
        failingEvidence({
          codeLocations: [
            { filePath: "src/pay.ts", functionName: "charge", lineNumber: 9 },
            { filePath: "src/cart.ts" },
          ],
          error: {
            stackTrace: "Error: x\n    at refund (src/refund.ts:3)",
            sampleMatches: 1,
            sampleSize: 1,
          },
        }),
      ),
    ).toBe(
      "    at charge (src/pay.ts:9)\n    at (src/cart.ts:1)\nError: x\n    at refund (src/refund.ts:3)",
    );
  });
});

/*
 * The evidence a person reads on the finding (its detailMarkdown): written
 * by the detector, drawn by the browser suite from this same function - the
 * facts first, then what the slowest request repeats.
 */
describe("the evidence a person reads on the finding", () => {
  function lines(evidence: TraceInsightEvidence, serviceName?: string) {
    return buildTraceInsightDetail({
      serviceName: serviceName ?? "checkout",
      evidence: evidence,
    })
      .toString()
      .split("\n");
  }

  test("a slow operation: the facts, the slowest request and its code, then what it repeats", () => {
    const detail: Array<string> = lines(
      slowEvidence({
        codeLocations: [
          {
            filePath: "src/orders/list.ts",
            functionName: "listOrders",
            lineNumber: 42,
          },
        ],
      }),
    );

    expect(detail[0]).toBe("**Slow operation in checkout**");
    expect(detail).toContain("- Operation: `GET /orders`");
    expect(detail).toContain(
      "- In the last hour: 1,234 spans, p50 180 ms, p99 2.4 s",
    );
    expect(detail).toContain(
      "- Slowest request: trace `4bf92f3577b34da6a3ce929d0e0e4736`, 2 s",
    );
    expect(detail).toContain("- Code: `src/orders/list.ts:42`");
    expect(detail).toContain("**What the slowest request repeats**");
    expect(detail).toContain(
      "- The same database query ran 40 times under GET /orders: 1.6 s together, 80% of the request",
    );
    expect(detail).toContain(
      "  - Query: `SELECT * FROM orders WHERE id = ?`",
    );

    // The facts come before the patterns, the code among the facts.
    expect(detail.indexOf("- Code: `src/orders/list.ts:42`")).toBeLessThan(
      detail.indexOf("**What the slowest request repeats**"),
    );
    // A slow operation says nothing about failures it was not read for.
    expect(detail.join("\n")).not.toContain("Failed");
    // "Request read" said nothing a person could act on.
    expect(detail.join("\n")).not.toContain("Request read");
  });

  test("a failing operation: how many failed, with what, in how many of the newest, and a failed request", () => {
    const detail: Array<string> = lines(
      failingEvidence({
        codeLocations: [{ filePath: "src/pay.ts", lineNumber: 9 }],
      }),
    );

    expect(detail[0]).toBe("**Failing operation in checkout**");
    expect(detail).toContain("- Failed: 340 (12%)");
    // The service's "<" is escaped, so the placeholder is not read as HTML.
    expect(detail).toContain(
      "- Failed with: TimeoutError: payment provider did not answer in \\<NUMBER> ms (status 503)",
    );
    expect(detail).toContain("- In 4 of the 5 most recent failures");
    expect(detail).toContain(
      "- A failed request: trace `4bf92f3577b34da6a3ce929d0e0e4736`",
    );
    expect(detail).toContain("- Code: `src/pay.ts:9`");
    expect(detail.join("\n")).not.toContain("Slowest request");
  });

  test("when every one of the newest failures failed the same way, it says each", () => {
    const detail: Array<string> = lines(
      failingEvidence({
        error: {
          exceptionType: "TypeError",
          sampleMatches: 5,
          sampleSize: 5,
        },
      }),
    );

    expect(detail).toContain("- In each of the 5 most recent failures");
    expect(detail).not.toContain("- In 5 of the 5 most recent failures");
  });

  test("a service with no spans inside its requests: its p99 alone, never a p50 of 0 ms", () => {
    const detail: Array<string> = lines(
      {
        serviceId: SERVICE_A,
        kind: TraceInsightKind.MissingTracing,
        gap: TraceTracingGap.NoChildSpans,
        windowStartTime: "2026-10-24T08:00:00.000Z",
        windowEndTime: "2026-10-24T09:00:00.000Z",
        spanCount: 9200,
        p99Ms: 1300,
        topOperations: [
          { name: "GET /", spanCount: 5100 },
          { name: "GET /static/*", spanCount: 2900 },
        ],
      },
      "edge",
    );

    expect(detail[0]).toBe("**Missing tracing in edge**");
    expect(detail).toContain("- In the last hour: 9,200 spans, p99 1.3 s");
    expect(detail.join("\n")).not.toContain("p50");
    expect(detail).toContain(
      "- Every span was its trace's only span: nothing is recorded inside a request",
    );
    expect(detail).toContain(
      "- Busiest operations: `GET /` (5,100), `GET /static/*` (2,900)",
    );
  });

  test("with no latency read at all, the count alone", () => {
    expect(
      lines({
        serviceId: SERVICE_A,
        kind: TraceInsightKind.MissingTracing,
        gap: TraceTracingGap.NoChildSpans,
        windowStartTime: "2026-10-24T08:00:00.000Z",
        windowEndTime: "2026-10-24T09:00:00.000Z",
        spanCount: 600,
      }),
    ).toContain("- In the last hour: 600 spans");
  });

  test("time no span accounts for, and failures that record nothing", () => {
    const untraced: Array<string> = lines(
      slowEvidence({
        kind: TraceInsightKind.MissingTracing,
        gap: TraceTracingGap.UntracedTime,
        performanceFindings: undefined,
        untracedSpanName: "ReportBuilder.build",
        untracedMs: 2200,
        sampleDurationMs: 3000,
      }),
    );

    expect(untraced[0]).toBe("**Missing tracing in checkout**");
    expect(untraced).toContain(
      "- Untraced: 2.2 s in `ReportBuilder.build` itself, with no span under it",
    );
    expect(untraced).toContain(
      "- Slowest request: trace `4bf92f3577b34da6a3ce929d0e0e4736`, 3 s",
    );

    const silent: Array<string> = lines(
      failingEvidence({
        kind: TraceInsightKind.MissingTracing,
        gap: TraceTracingGap.SilentFailures,
        error: undefined,
      }),
    );

    expect(silent).toContain(
      "- The most recent failures recorded no error message and no exception",
    );
    expect(silent).toContain(
      "- A failed request: trace `4bf92f3577b34da6a3ce929d0e0e4736`",
    );
  });

  test("the service's text is written escaped: a name, an operation or an error never turns into Markdown", () => {
    const detail: string = buildTraceInsightDetail({
      serviceName: "check*out",
      evidence: failingEvidence({
        operationName: "GET /`x`",
        error: {
          statusMessage: "![x](https://example.com/p.png)",
          sampleMatches: 1,
          sampleSize: 1,
        },
      }),
    }).toString();

    expect(detail).toContain("**Failing operation in check\\*out**");
    expect(detail).not.toContain("![x](https://example.com/p.png)");
  });

  test("a pattern opens its line with a capital only where the words are OneUptime's", () => {
    const base: PerformanceFinding =
      readSlowRequest(nPlusOneRequest()).fixable[0]!;

    expect(describeSlowFindingCostAsItem(base)).toBe(
      "The same database query ran 40 times under GET /orders: 1.6 s together, 80% of the request",
    );
    // An operation's own name is kept as the service wrote it.
    expect(
      describeSlowFindingCostAsItem({
        ...base,
        findingType: PerformanceFindingType.DominantSpan,
        normalizedDbStatement: undefined,
        dbSystem: undefined,
        implicatedSpans: [
          { spanId: "1", name: "fetchPrice", durationMs: 1000 },
        ],
      }),
    ).toMatch(/^fetchPrice took /u);
    // Mid-sentence, the clause stays as it was.
    expect(describeSlowFindingCost(base)).toMatch(/^the same database query/u);
  });
});
