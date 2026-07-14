import { afterEach, describe, expect, test } from "@jest/globals";
import TraceLatencyRegressionDetector, {
  LATENCY_HIGH_SEVERITY_MULTIPLIER,
  LATENCY_MAX_TRACE_SPANS,
  LATENCY_MIN_OPERATION_SAMPLE_COUNT,
  LATENCY_MIN_PRIOR_SAMPLE_COUNT,
  LATENCY_MIN_RECENT_P99_MS,
  LATENCY_SERVICE_LIMIT,
  LATENCY_TOP_OPERATION_CANDIDATES,
  LatencyRegressionDecision,
  ServiceLatencyWindows,
} from "../../../../../Server/Utils/AI/Sentinel/Insights/Detectors/TraceLatencyRegressionDetector";
import { InsightCandidate } from "../../../../../Server/Utils/AI/Sentinel/Insights/Types";
import TraceAggregationService, {
  ServiceLatencyProfile,
  ServiceLatencyProfileRow,
  TraceAnalyticsTopItem,
} from "../../../../../Server/Services/TraceAggregationService";
import SpanService from "../../../../../Server/Services/SpanService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import Span from "../../../../../Models/AnalyticsModels/Span";
import Service from "../../../../../Models/DatabaseModels/Service";
import { AnalyzableSpan } from "../../../../../Server/Utils/AI/PerfEvidence/SpanTreeAnalyzer";
import SentinelInsightSeverity from "../../../../../Types/AI/SentinelInsightSeverity";
import SentinelInsightType from "../../../../../Types/AI/SentinelInsightType";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * Invariant under test: the TraceLatencyRegression detector fires exactly
 * when a service's recent-hour p99 is >= 1000ms AND >= 2x its own prior-24h
 * p99 AND the prior window has >= 100 spans (High at 4x) — and ONLY then
 * drills into a representative trace (slowest CREDIBLE operation → slowest
 * span → whole trace → deterministic span-tree findings + code locations,
 * with correct ns→ms conversion), storing the drilled evidence on the
 * candidate because span retention is short. No LLM is ever involved.
 *
 * Two properties the whole lane's noise budget rests on, pinned here:
 *   1. Stage 1 reads the PROJECTION-served profile query, never the
 *      full-scan analytics table — and a possibly-partial profile (the
 *      execution cap firing under timeout_overflow_mode='break') files
 *      NOTHING rather than comparing a truncated window to a whole one.
 *   2. The drilled operation — which is part of the dedupe fingerprint —
 *      is chosen deterministically and only from operations with real
 *      traffic behind them, so one ongoing regression stays ONE insight.
 */

const projectId: ObjectID = ObjectID.generate();
const entityId: string = ObjectID.generate().toString();
const now: Date = new Date("2026-07-14T12:00:00.000Z");
const oneHourAgo: Date = new Date("2026-07-14T11:00:00.000Z");
const twentyFiveHoursAgo: Date = new Date("2026-07-13T11:00:00.000Z");

function profileRow(input: {
  entityId: string;
  count: number;
  p99Ms: number;
}): ServiceLatencyProfileRow {
  return {
    primaryEntityId: input.entityId,
    count: input.count,
    p99DurationMs: input.p99Ms,
  };
}

function profile(rows: Array<ServiceLatencyProfileRow>): ServiceLatencyProfile {
  return { rows, isPartial: false };
}

function topItem(input: {
  value: string;
  p99Ms: number;
  count: number;
}): TraceAnalyticsTopItem {
  return {
    value: input.value,
    metricValue: input.p99Ms,
    count: input.count,
  };
}

/*
 * A two-span trace engineered to trip the analyzer's dominant-span rule:
 * the child covers 95% of the 1000ms trace with no children of its own, so
 * its SELF time dominates. Times are NANOSECONDS, as stored on Span rows.
 */
function fakeTraceSpans(): Array<Span> {
  return [
    {
      spanId: "root",
      parentSpanId: "",
      name: "GET /users/42",
      startTimeUnixNano: 0,
      endTimeUnixNano: 1_000_000_000,
      durationUnixNano: 1_000_000_000,
      attributes: {},
    },
    {
      spanId: "slow-child",
      parentSpanId: "root",
      name: "SELECT users",
      startTimeUnixNano: 0,
      endTimeUnixNano: 950_000_000,
      durationUnixNano: 950_000_000,
      attributes: {
        "code.filepath": "src/db.ts",
        "code.function": "loadUsers",
        "code.lineno": "42",
      },
    },
  ] as unknown as Array<Span>;
}

describe("TraceLatencyRegressionDetector.evaluateRegression (pure decision matrix)", () => {
  test("all thresholds exactly at their boundaries → regression at Medium", () => {
    const decision: LatencyRegressionDecision =
      TraceLatencyRegressionDetector.evaluateRegression({
        recentP99Ms: LATENCY_MIN_RECENT_P99_MS,
        priorP99Ms: LATENCY_MIN_RECENT_P99_MS / 2,
        priorSampleCount: LATENCY_MIN_PRIOR_SAMPLE_COUNT,
      });
    expect(decision.isRegression).toBe(true);
    expect(decision.multiplier).toBe(2);
    expect(decision.severity).toBe(SentinelInsightSeverity.Medium);
  });

  test("recent p99 just below the absolute floor never regresses", () => {
    const decision: LatencyRegressionDecision =
      TraceLatencyRegressionDetector.evaluateRegression({
        recentP99Ms: LATENCY_MIN_RECENT_P99_MS - 1,
        priorP99Ms: 100,
        priorSampleCount: 10_000,
      });
    expect(decision.isRegression).toBe(false);
  });

  test("multiplier just below 2x does not regress", () => {
    const decision: LatencyRegressionDecision =
      TraceLatencyRegressionDetector.evaluateRegression({
        recentP99Ms: 1000,
        priorP99Ms: 501,
        priorSampleCount: 1000,
      });
    expect(decision.isRegression).toBe(false);
  });

  test("thin prior sample count (one below the gate) does not regress", () => {
    const decision: LatencyRegressionDecision =
      TraceLatencyRegressionDetector.evaluateRegression({
        recentP99Ms: 5000,
        priorP99Ms: 500,
        priorSampleCount: LATENCY_MIN_PRIOR_SAMPLE_COUNT - 1,
      });
    expect(decision.isRegression).toBe(false);
  });

  test("zero prior p99 (no baseline) never regresses and yields multiplier 0", () => {
    const decision: LatencyRegressionDecision =
      TraceLatencyRegressionDetector.evaluateRegression({
        recentP99Ms: 5000,
        priorP99Ms: 0,
        priorSampleCount: 1000,
      });
    expect(decision.isRegression).toBe(false);
    expect(decision.multiplier).toBe(0);
  });

  test("severity boundary: exactly 4x is High, just under stays Medium", () => {
    const high: LatencyRegressionDecision =
      TraceLatencyRegressionDetector.evaluateRegression({
        recentP99Ms: 4000,
        priorP99Ms: 1000,
        priorSampleCount: 1000,
      });
    expect(high.multiplier).toBe(LATENCY_HIGH_SEVERITY_MULTIPLIER);
    expect(high.severity).toBe(SentinelInsightSeverity.High);

    const medium: LatencyRegressionDecision =
      TraceLatencyRegressionDetector.evaluateRegression({
        recentP99Ms: 3999,
        priorP99Ms: 1000,
        priorSampleCount: 1000,
      });
    expect(medium.isRegression).toBe(true);
    expect(medium.severity).toBe(SentinelInsightSeverity.Medium);
  });
});

describe("TraceLatencyRegressionDetector.joinServiceWindows (pure)", () => {
  test("joins recent and prior rows on primaryEntityId", () => {
    const joined: Array<ServiceLatencyWindows> =
      TraceLatencyRegressionDetector.joinServiceWindows(
        [profileRow({ entityId: "e1", count: 500, p99Ms: 2300 })],
        [profileRow({ entityId: "e1", count: 400, p99Ms: 1000 })],
      );
    expect(joined).toEqual([
      {
        primaryEntityId: "e1",
        recentP99Ms: 2300,
        recentSampleCount: 500,
        priorP99Ms: 1000,
        priorSampleCount: 400,
      },
    ]);
  });

  test("a service missing from the prior window joins with a zero baseline", () => {
    const joined: Array<ServiceLatencyWindows> =
      TraceLatencyRegressionDetector.joinServiceWindows(
        [profileRow({ entityId: "e1", count: 500, p99Ms: 2300 })],
        [],
      );
    expect(joined[0]!.priorP99Ms).toBe(0);
    expect(joined[0]!.priorSampleCount).toBe(0);
  });

  test("rows without an entity id are dropped from both sides", () => {
    const joined: Array<ServiceLatencyWindows> =
      TraceLatencyRegressionDetector.joinServiceWindows(
        [profileRow({ entityId: "", count: 500, p99Ms: 2300 })],
        [profileRow({ entityId: "", count: 400, p99Ms: 1000 })],
      );
    expect(joined).toEqual([]);
  });
});

/*
 * The operation name goes into the fingerprint, so this picker IS the
 * dedupe key. A rule that lets a one-off slow span win produces a new
 * fingerprint — and therefore a new insight row and a new triage LLM run —
 * every 15 minutes for a single ongoing regression.
 */
describe("TraceLatencyRegressionDetector.pickSlowestOperation (pure decision matrix)", () => {
  test("a freak-slow op with no traffic loses to the slowest op that has traffic", () => {
    expect(
      TraceLatencyRegressionDetector.pickSlowestOperation([
        topItem({ value: "POST /admin/export", p99Ms: 8000, count: 1 }),
        topItem({ value: "GET /orders", p99Ms: 1200, count: 10_000 }),
      ]),
    ).toBe("GET /orders");
  });

  test("floor boundary: exactly at the constant qualifies, one below does not", () => {
    expect(
      TraceLatencyRegressionDetector.pickSlowestOperation([
        topItem({
          value: "at-floor",
          p99Ms: 5000,
          count: LATENCY_MIN_OPERATION_SAMPLE_COUNT,
        }),
        topItem({ value: "busy", p99Ms: 1200, count: 10_000 }),
      ]),
    ).toBe("at-floor");

    expect(
      TraceLatencyRegressionDetector.pickSlowestOperation([
        topItem({
          value: "below-floor",
          p99Ms: 5000,
          count: LATENCY_MIN_OPERATION_SAMPLE_COUNT - 1,
        }),
        topItem({ value: "busy", p99Ms: 1200, count: 10_000 }),
      ]),
    ).toBe("busy");
  });

  test("every candidate below the floor → undefined (service-level fallback)", () => {
    expect(
      TraceLatencyRegressionDetector.pickSlowestOperation([
        topItem({ value: "rare-a", p99Ms: 9000, count: 1 }),
        topItem({ value: "rare-b", p99Ms: 8000, count: 3 }),
      ]),
    ).toBeUndefined();
    expect(
      TraceLatencyRegressionDetector.pickSlowestOperation([]),
    ).toBeUndefined();
  });

  test("empty dimension values never win, whatever their p99", () => {
    expect(
      TraceLatencyRegressionDetector.pickSlowestOperation([
        topItem({ value: "", p99Ms: 9000, count: 10_000 }),
        topItem({ value: "GET /orders", p99Ms: 1200, count: 10_000 }),
      ]),
    ).toBe("GET /orders");
  });

  test("tie-break is deterministic and independent of the row order the query returned", () => {
    const items: Array<TraceAnalyticsTopItem> = [
      topItem({ value: "b-op", p99Ms: 3000, count: 50 }),
      topItem({ value: "a-op", p99Ms: 3000, count: 50 }),
      // Same p99, more traffic — volume breaks the tie before the name does.
      topItem({ value: "z-op", p99Ms: 3000, count: 900 }),
    ];

    expect(TraceLatencyRegressionDetector.pickSlowestOperation(items)).toBe(
      "z-op",
    );
    expect(
      TraceLatencyRegressionDetector.pickSlowestOperation([...items].reverse()),
    ).toBe("z-op");

    // p99 AND volume tied: the name is the last, total tie-break.
    const namesOnly: Array<TraceAnalyticsTopItem> = [
      topItem({ value: "b-op", p99Ms: 3000, count: 50 }),
      topItem({ value: "a-op", p99Ms: 3000, count: 50 }),
    ];
    expect(TraceLatencyRegressionDetector.pickSlowestOperation(namesOnly)).toBe(
      "a-op",
    );
    expect(
      TraceLatencyRegressionDetector.pickSlowestOperation(
        [...namesOnly].reverse(),
      ),
    ).toBe("a-op");
  });

  test("the picker does not mutate the caller's array", () => {
    const items: Array<TraceAnalyticsTopItem> = [
      topItem({ value: "slow", p99Ms: 9000, count: 1 }),
      topItem({ value: "busy", p99Ms: 1200, count: 10_000 }),
    ];
    TraceLatencyRegressionDetector.pickSlowestOperation(items);
    expect(items[0]!.value).toBe("slow");
  });

  /*
   * Fingerprint stability across ticks: the rare ops churn from scan to
   * scan while the regressing endpoint stays put. The fingerprint must not
   * move with them, or the operator's dismissal (keyed on fingerprint)
   * never suppresses anything.
   */
  test("fingerprint is stable across ticks as the rare-op set churns", () => {
    const tickOne: Array<TraceAnalyticsTopItem> = [
      topItem({ value: "POST /admin/export", p99Ms: 8000, count: 1 }),
      topItem({ value: "GET /orders/42", p99Ms: 1200, count: 10_000 }),
    ];
    const tickTwo: Array<TraceAnalyticsTopItem> = [
      topItem({ value: "GET /debug/dump", p99Ms: 7000, count: 2 }),
      topItem({ value: "GET /orders/97", p99Ms: 1300, count: 9_000 }),
    ];

    const fingerprintOne: string =
      TraceLatencyRegressionDetector.buildFingerprint(
        "svc",
        TraceLatencyRegressionDetector.pickSlowestOperation(tickOne),
      );
    const fingerprintTwo: string =
      TraceLatencyRegressionDetector.buildFingerprint(
        "svc",
        TraceLatencyRegressionDetector.pickSlowestOperation(tickTwo),
      );

    expect(fingerprintOne).toBe("latency:svc:GET /orders/{n}");
    expect(fingerprintTwo).toBe(fingerprintOne);
  });
});

describe("TraceLatencyRegressionDetector.toAnalyzableSpans (pure ns→ms)", () => {
  test("converts nanosecond timestamps and durations to milliseconds", () => {
    const converted: Array<AnalyzableSpan> =
      TraceLatencyRegressionDetector.toAnalyzableSpans([
        {
          spanId: "s1",
          parentSpanId: "p1",
          name: "op",
          startTimeUnixNano: 1_500_000,
          endTimeUnixNano: 4_500_000,
          durationUnixNano: 3_000_000,
          attributes: { "db.system": "postgres", numeric: 7 },
        },
      ] as unknown as Array<Span>);

    expect(converted).toEqual([
      {
        spanId: "s1",
        parentSpanId: "p1",
        name: "op",
        startMs: 1.5,
        endMs: 4.5,
        durationMs: 3,
        attributes: { "db.system": "postgres", numeric: "7" },
      },
    ]);
  });

  test("missing parent and empty attributes stay well-formed", () => {
    const converted: Array<AnalyzableSpan> =
      TraceLatencyRegressionDetector.toAnalyzableSpans([
        {
          spanId: "s1",
          name: "op",
          startTimeUnixNano: 0,
          endTimeUnixNano: 1_000_000,
          durationUnixNano: 1_000_000,
        },
      ] as unknown as Array<Span>);
    expect(converted[0]!.parentSpanId).toBeUndefined();
    expect(converted[0]!.attributes).toEqual({});
  });
});

describe("TraceLatencyRegressionDetector.buildFingerprint (pure)", () => {
  test("normalizes ids/digits in the operation name for a stable key", () => {
    expect(
      TraceLatencyRegressionDetector.buildFingerprint("svc", "GET /users/42"),
    ).toBe("latency:svc:GET /users/{n}");
    expect(
      TraceLatencyRegressionDetector.buildFingerprint("svc", "GET /users/97"),
    ).toBe("latency:svc:GET /users/{n}");
  });

  test("missing operation yields a stable service-scoped key", () => {
    expect(
      TraceLatencyRegressionDetector.buildFingerprint("svc", undefined),
    ).toBe("latency:svc:");
  });
});

describe("TraceLatencyRegressionDetector.detect (IO wiring)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("regression → drill to slowest op, representative trace, findings and code locations", async () => {
    const profileSpy: jest.SpyInstance = jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockResolvedValueOnce(
        profile([profileRow({ entityId, count: 500, p99Ms: 2300 })]),
      )
      .mockResolvedValueOnce(
        profile([profileRow({ entityId, count: 400, p99Ms: 1000 })]),
      );
    const topListSpy: jest.SpyInstance = jest
      .spyOn(TraceAggregationService, "getAnalyticsTopList")
      .mockResolvedValue([
        { value: "GET /users/42", metricValue: 2300, count: 40 },
      ]);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValueOnce([{ traceId: "trace-1" } as unknown as Span])
      .mockResolvedValueOnce(fakeTraceSpans());
    jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue({ name: "checkout" } as unknown as Service);

    const detector: TraceLatencyRegressionDetector =
      new TraceLatencyRegressionDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    /*
     * Stage 1: recent-hour and prior-24h per-service latency profiles, via
     * the projection-served method — NOT getAnalyticsTable, whose stat set
     * and raw-startTime predicate force a 25h full span scan per tick.
     */
    expect(profileSpy).toHaveBeenCalledTimes(2);
    expect(profileSpy).toHaveBeenNthCalledWith(1, {
      projectId: projectId,
      startTime: oneHourAgo,
      endTime: now,
      limit: LATENCY_SERVICE_LIMIT,
    });
    expect(profileSpy).toHaveBeenNthCalledWith(2, {
      projectId: projectId,
      startTime: twentyFiveHoursAgo,
      endTime: oneHourAgo,
      limit: LATENCY_SERVICE_LIMIT,
    });

    // Drill 1: candidate operations ranked by p99, pinned to the service.
    expect(topListSpy).toHaveBeenCalledTimes(1);
    const topListRequest: Record<string, unknown> = topListSpy.mock
      .calls[0]![0] as unknown as Record<string, unknown>;
    expect(topListRequest["groupBy"]).toEqual(["name"]);
    expect(topListRequest["metric"]).toBe("p99Duration");
    expect(topListRequest["limit"]).toBe(LATENCY_TOP_OPERATION_CANDIDATES);
    expect(
      (topListRequest["serviceIds"] as Array<ObjectID>)[0]!.toString(),
    ).toBe(entityId);

    // Drill 2: slowest span of that op in the spike window, root query.
    expect(findBySpy).toHaveBeenCalledTimes(2);
    const slowestSpanFind: Record<string, unknown> = findBySpy.mock
      .calls[0]![0] as unknown as Record<string, unknown>;
    const slowestSpanQuery: Record<string, unknown> = slowestSpanFind[
      "query"
    ] as Record<string, unknown>;
    expect(slowestSpanQuery["projectId"]).toBe(projectId);
    expect(slowestSpanQuery["name"]).toBe("GET /users/42");
    expect((slowestSpanQuery["primaryEntityId"] as ObjectID).toString()).toBe(
      entityId,
    );
    const spanWindow: InBetween<Date> = slowestSpanQuery[
      "startTime"
    ] as InBetween<Date>;
    expect(spanWindow).toBeInstanceOf(InBetween);
    expect(spanWindow.startValue).toEqual(oneHourAgo);
    expect(spanWindow.endValue).toEqual(now);
    expect(slowestSpanFind["limit"]).toBe(1);
    expect(slowestSpanFind["sort"]).toEqual({
      durationUnixNano: SortOrder.Descending,
    });
    expect(slowestSpanFind["props"]).toEqual(
      expect.objectContaining({ isRoot: true }),
    );

    // Drill 3: the whole trace, explicitly project-scoped, capped spans.
    const traceFind: Record<string, unknown> = findBySpy.mock
      .calls[1]![0] as unknown as Record<string, unknown>;
    expect(traceFind["query"]).toEqual(
      expect.objectContaining({ projectId: projectId, traceId: "trace-1" }),
    );
    expect(traceFind["limit"]).toBe(LATENCY_MAX_TRACE_SPANS);
    expect(traceFind["props"]).toEqual(
      expect.objectContaining({ isRoot: true }),
    );

    // The candidate carries the full drilled evidence.
    expect(candidates).toHaveLength(1);
    const candidate: InsightCandidate = candidates[0]!;
    expect(candidate.insightType).toBe(
      SentinelInsightType.TraceLatencyRegression,
    );
    expect(candidate.fingerprint).toBe(`latency:${entityId}:GET /users/{n}`);
    expect(candidate.title).toBe(
      "Latency regression: p99 2.3x on GET /users/42 in checkout",
    );
    expect(candidate.severity).toBe(SentinelInsightSeverity.Medium);
    expect(candidate.serviceName).toBe("checkout");
    expect(candidate.telemetryServiceId?.toString()).toBe(entityId);
    expect(candidate.traceId).toBe("trace-1");
    expect(candidate.evidence.latency).toEqual(
      expect.objectContaining({
        recentP99Ms: 2300,
        baselineP99Ms: 1000,
        regressionMultiplier: 2.3,
        operationName: "GET /users/42",
        sampleTraceId: "trace-1",
      }),
    );
    expect(
      candidate.evidence.latency!.performanceFindings!.length,
    ).toBeGreaterThan(0);
    expect(candidate.evidence.latency!.codeLocations).toEqual([
      { filePath: "src/db.ts", functionName: "loadUsers", lineNumber: 42 },
    ]);
    expect(candidate.detailMarkdown).toContain("Span-tree findings");
    expect(candidate.detailMarkdown).toContain("Regression multiplier: 2.3x");
  });

  test("no regression → no drill queries at all", async () => {
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockResolvedValueOnce(
        profile([profileRow({ entityId, count: 500, p99Ms: 1200 })]),
      )
      .mockResolvedValueOnce(
        profile([profileRow({ entityId, count: 400, p99Ms: 900 })]),
      );
    const topListSpy: jest.SpyInstance = jest.spyOn(
      TraceAggregationService,
      "getAnalyticsTopList",
    );
    const findBySpy: jest.SpyInstance = jest.spyOn(SpanService, "findBy");

    const detector: TraceLatencyRegressionDetector =
      new TraceLatencyRegressionDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(candidates).toEqual([]);
    expect(topListSpy).not.toHaveBeenCalled();
    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("regression with no drillable operation still produces evidence-bearing insight", async () => {
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockResolvedValueOnce(
        profile([profileRow({ entityId, count: 500, p99Ms: 5000 })]),
      )
      .mockResolvedValueOnce(
        profile([profileRow({ entityId, count: 400, p99Ms: 1000 })]),
      );
    jest
      .spyOn(TraceAggregationService, "getAnalyticsTopList")
      .mockResolvedValue([]);
    const findBySpy: jest.SpyInstance = jest.spyOn(SpanService, "findBy");
    jest.spyOn(ServiceService, "findOneById").mockResolvedValue(null);

    const detector: TraceLatencyRegressionDetector =
      new TraceLatencyRegressionDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(findBySpy).not.toHaveBeenCalled();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.fingerprint).toBe(`latency:${entityId}:`);
    expect(candidates[0]!.severity).toBe(SentinelInsightSeverity.High);
    expect(candidates[0]!.traceId).toBeUndefined();
    expect(
      candidates[0]!.evidence.latency!.performanceFindings,
    ).toBeUndefined();
  });

  /*
   * The regression is real, but every operation in the spike hour is a
   * one-off. Naming one of them would be a guess AND would move the dedupe
   * key next tick — so the insight stays at service level: no drill
   * queries, no operation in the title, stable service-scoped fingerprint.
   */
  test("no operation clears the sample floor → service-level insight, no drill, stable fingerprint", async () => {
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockResolvedValueOnce(
        profile([profileRow({ entityId, count: 500, p99Ms: 5000 })]),
      )
      .mockResolvedValueOnce(
        profile([profileRow({ entityId, count: 400, p99Ms: 1000 })]),
      );
    jest
      .spyOn(TraceAggregationService, "getAnalyticsTopList")
      .mockResolvedValue([
        topItem({ value: "POST /admin/export", p99Ms: 9000, count: 1 }),
        topItem({
          value: "GET /rare",
          p99Ms: 8000,
          count: LATENCY_MIN_OPERATION_SAMPLE_COUNT - 1,
        }),
      ]);
    const findBySpy: jest.SpyInstance = jest.spyOn(SpanService, "findBy");
    jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue({ name: "checkout" } as unknown as Service);

    const detector: TraceLatencyRegressionDetector =
      new TraceLatencyRegressionDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(findBySpy).not.toHaveBeenCalled();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.fingerprint).toBe(`latency:${entityId}:`);
    expect(candidates[0]!.title).toBe(
      "Latency regression: p99 5.0x in checkout",
    );
    expect(candidates[0]!.evidence.latency!.operationName).toBeUndefined();
    expect(candidates[0]!.detailMarkdown).not.toContain("Slowest operation");
  });

  /*
   * The drill must follow the CREDIBLE operation, not the freak one — the
   * representative trace, the code locations and the fingerprint all hang
   * off this choice.
   */
  test("a one-off slow op does not win the drill over the operation with real traffic", async () => {
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockResolvedValueOnce(
        profile([profileRow({ entityId, count: 500, p99Ms: 2300 })]),
      )
      .mockResolvedValueOnce(
        profile([profileRow({ entityId, count: 400, p99Ms: 1000 })]),
      );
    jest
      .spyOn(TraceAggregationService, "getAnalyticsTopList")
      .mockResolvedValue([
        topItem({ value: "POST /admin/export", p99Ms: 9000, count: 1 }),
        topItem({ value: "GET /users/42", p99Ms: 2300, count: 10_000 }),
      ]);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValueOnce([{ traceId: "trace-1" } as unknown as Span])
      .mockResolvedValueOnce(fakeTraceSpans());
    jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue({ name: "checkout" } as unknown as Service);

    const detector: TraceLatencyRegressionDetector =
      new TraceLatencyRegressionDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    const slowestSpanQuery: Record<string, unknown> = (
      findBySpy.mock.calls[0]![0] as unknown as Record<string, unknown>
    )["query"] as Record<string, unknown>;
    expect(slowestSpanQuery["name"]).toBe("GET /users/42");
    expect(candidates[0]!.fingerprint).toBe(
      `latency:${entityId}:GET /users/{n}`,
    );
    expect(candidates[0]!.evidence.latency!.operationName).toBe(
      "GET /users/42",
    );
  });

  /*
   * timeout_overflow_mode='break' returns partial aggregates with no
   * error. A p99 over a fraction of the window compared against a whole
   * one fabricates regressions — so a possibly-partial profile files
   * NOTHING and waits for the next tick. Asserted on BOTH windows: the
   * prior one is where a truncated scan does its worst damage.
   */
  test("a possibly-partial recent profile files nothing and never drills", async () => {
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockResolvedValueOnce({
        rows: [profileRow({ entityId, count: 500, p99Ms: 5000 })],
        isPartial: true,
      })
      .mockResolvedValueOnce(
        profile([profileRow({ entityId, count: 400, p99Ms: 1000 })]),
      );
    const topListSpy: jest.SpyInstance = jest.spyOn(
      TraceAggregationService,
      "getAnalyticsTopList",
    );
    const findBySpy: jest.SpyInstance = jest.spyOn(SpanService, "findBy");

    const detector: TraceLatencyRegressionDetector =
      new TraceLatencyRegressionDetector();

    await expect(detector.detect({ projectId, now })).resolves.toEqual([]);
    expect(topListSpy).not.toHaveBeenCalled();
    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("a possibly-partial prior (baseline) profile files nothing", async () => {
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockResolvedValueOnce(
        profile([profileRow({ entityId, count: 500, p99Ms: 5000 })]),
      )
      .mockResolvedValueOnce({
        rows: [profileRow({ entityId, count: 400, p99Ms: 1000 })],
        isPartial: true,
      });
    const topListSpy: jest.SpyInstance = jest.spyOn(
      TraceAggregationService,
      "getAnalyticsTopList",
    );

    const detector: TraceLatencyRegressionDetector =
      new TraceLatencyRegressionDetector();

    await expect(detector.detect({ projectId, now })).resolves.toEqual([]);
    expect(topListSpy).not.toHaveBeenCalled();
  });

  test("detect propagates aggregation errors — the scanner isolates detectors", async () => {
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockRejectedValue(new Error("clickhouse down"));

    const detector: TraceLatencyRegressionDetector =
      new TraceLatencyRegressionDetector();
    await expect(detector.detect({ projectId, now })).rejects.toThrow(
      "clickhouse down",
    );
  });
});
