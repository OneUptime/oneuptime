import { describe, expect, test } from "@jest/globals";
import AIInsightEvidence, {
  DeployRegressionInsightEvidence,
  ExceptionInsightEvidence,
  ExceptionStackTraceInsightEvidence,
  LatencyInsightEvidence,
  LogSpikeInsightEvidence,
  MetricDriftInsightEvidence,
  ProfileInsightEvidence,
  TraceInsightEvidence,
} from "../../../Types/AI/AIInsightEvidence";
import AIInsightType from "../../../Types/AI/AIInsightType";
import { PerformanceFindingType } from "../../../Types/AI/CodeFixTaskContext";

/*
 * AIInsightEvidence is the JSON persisted verbatim on AIInsight.evidence and
 * rendered long after the raw ClickHouse signals have expired. It is a pure
 * type module, so these tests pin the wire contract in the two ways that
 * matter: every AIInsightType maps to exactly one evidence section (checked
 * exhaustively by the compiler via Record<AIInsightType, ...>), and each
 * section survives a JSON round trip with its real numbers intact.
 */

type EvidenceSection = keyof AIInsightEvidence;

/*
 * The compiler rejects this map if an AIInsightType is added without deciding
 * which evidence section carries it, or if a section key is renamed.
 */
const SECTION_FOR_TYPE: Record<AIInsightType, EvidenceSection> = {
  [AIInsightType.NewException]: "exception",
  [AIInsightType.ExceptionSpike]: "exception",
  [AIInsightType.ErrorLogSpike]: "logSpike",
  [AIInsightType.TraceLatencyRegression]: "latency",
  [AIInsightType.MetricDrift]: "metricDrift",
  [AIInsightType.DeployRegression]: "deployRegression",
  [AIInsightType.ProfileHotspot]: "profile",
  [AIInsightType.TraceSlowOperation]: "trace",
  [AIInsightType.TraceFailingOperation]: "trace",
  [AIInsightType.TraceMissingTracing]: "trace",
  [AIInsightType.ExceptionMissingStackTrace]: "exceptionStackTrace",
};

const ALL_SECTIONS: Array<EvidenceSection> = [
  "exception",
  "logSpike",
  "latency",
  "metricDrift",
  "deployRegression",
  "profile",
  "trace",
  "exceptionStackTrace",
];

const setSections: (evidence: AIInsightEvidence) => Array<string> = (
  evidence: AIInsightEvidence,
): Array<string> => {
  return Object.keys(evidence).filter((key: string) => {
    return evidence[key as EvidenceSection] !== undefined;
  });
};

const roundTrip: (evidence: AIInsightEvidence) => AIInsightEvidence = (
  evidence: AIInsightEvidence,
): AIInsightEvidence => {
  return JSON.parse(JSON.stringify(evidence)) as AIInsightEvidence;
};

const exceptionEvidence: ExceptionInsightEvidence = {
  exceptionMessage: "Cannot read properties of undefined (reading 'id')",
  exceptionType: "TypeError",
  recentOccurrenceCount: 42,
  baselineHourlyAverage: 1.5,
  spikeMultiplier: 28,
  totalOccurrenceCount: 1200,
  distinctExceptionGroupCount: 3,
  firstSeenAt: "2026-09-18T10:00:00.000Z",
  // Read by the Exceptions AI section: where the application's own code is.
  serviceId: "7e6a3c1a-1111-4222-8333-944455556666",
  stackFrameCount: 12,
  ownCodeFrames: [
    { functionName: "getOrder", fileName: "src/orders.ts", lineNumber: 42 },
    { functionName: "", fileName: "src/routes.ts", lineNumber: 0 },
  ],
};

const exceptionStackTraceEvidence: ExceptionStackTraceInsightEvidence = {
  serviceId: "7e6a3c1a-1111-4222-8333-944455556666",
  windowStartTime: "2026-10-23T09:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
  exceptions: [
    {
      telemetryExceptionId: "8f0e1d2c-3b4a-4596-8877-665544332211",
      exceptionType: "TimeoutError",
      exceptionMessage: "context deadline exceeded",
      occurrenceCount: 900,
      lastSeenAt: "2026-10-24T08:55:00.000Z",
    },
  ],
  exceptionCount: 3,
  occurrenceCount: 1240,
  withStackTraceCount: 0,
};

const logSpikeEvidence: LogSpikeInsightEvidence = {
  recentErrorCount: 900,
  baselineHourlyAverage: 30,
  spikeMultiplier: 30,
  windowMinutes: 60,
  topServices: [
    { serviceName: "checkout", count: 700 },
    { serviceName: "payments", count: 200 },
  ],
};

const latencyEvidence: LatencyInsightEvidence = {
  recentP99Ms: 2400,
  baselineP99Ms: 300,
  regressionMultiplier: 8,
  operationName: "GET /orders",
  sampleTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  performanceFindings: [
    {
      findingType: PerformanceFindingType.NPlusOneQuery,
      headline: 'N+1: 27x "SELECT users" under "GET /orders"',
      evidence: "27 sibling spans, 1900ms combined",
      spanCount: 27,
      combinedDurationMs: 1900,
      traceDurationMs: 2400,
      percentOfTrace: 79.2,
      normalizedSpanName: "SELECT users",
      parentSpanName: "GET /orders",
      normalizedDbStatement: "SELECT * FROM users WHERE id = ?",
      dbSystem: "postgresql",
      implicatedSpans: [
        { spanId: "00f067aa0ba902b7", name: "SELECT users", durationMs: 70 },
      ],
    },
  ],
  codeLocations: [
    {
      filePath: "src/orders/list.ts",
      functionName: "listOrders",
      lineNumber: 88,
    },
  ],
};

const metricDriftEvidence: MetricDriftInsightEvidence = {
  metricName: "http.server.request.duration",
  primaryEntityId: "7e6a3c1a-1111-4222-8333-944455556666",
  recentWeekMean: 150,
  priorWeekMean: 100,
  relativeChangePercent: 50,
  recentSampleCount: 10080,
  priorSampleCount: 10080,
};

const deployRegressionEvidence: DeployRegressionInsightEvidence = {
  changeId: "3f2b8c1d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  changeTime: "2026-10-19T09:30:00.000Z",
  changeTitle: "Deploy 2.3.1",
  changeType: "deployment",
  version: "2.3.1",
  previousVersion: "2.3.0",
  commitSha: "1a2b3c4",
  environment: "production",
  source: "cli",
  reasons: ["p99 latency rose from 300 ms to 2.4 s", "a new exception type"],
  before: {
    durationMinutes: 30,
    spanCount: 12000,
    errorSpanCount: 12,
    p99Ms: 300,
    exceptionCount: 3,
  },
  after: {
    durationMinutes: 30,
    spanCount: 11800,
    errorSpanCount: 240,
    p99Ms: 2400,
    exceptionCount: 95,
  },
  newExceptionTypes: [{ exceptionType: "TypeError", occurrenceCount: 80 }],
};

const profileEvidence: ProfileInsightEvidence = {
  serviceId: "7e6a3c1a-1111-4222-8333-944455556666",
  functionName: "OrderParser.parse",
  fileName: "src/orders/parser.ts",
  lineNumber: 42,
  profileType: "cpu",
  category: "cpu",
  reason: "Grew",
  ownShare: 18.5,
  ownShareBefore: 4.25,
  functionSampleCount: 1840,
  windowSampleCount: 9950,
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
  baselineStartTime: "2026-10-23T08:00:00.000Z",
  baselineEndTime: "2026-10-23T09:00:00.000Z",
  callers: [
    { functionName: "handleOrder", fileName: "src/orders/api.ts", share: 18 },
  ],
  callees: [{ functionName: "JSON.parse", fileName: "", share: 15.75 }],
};

const traceEvidence: TraceInsightEvidence = {
  serviceId: "7e6a3c1a-1111-4222-8333-944455556666",
  kind: "Failing",
  operationName: "POST /checkout",
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
  spanCount: 2800,
  failedSpanCount: 340,
  p50Ms: 90.5,
  p99Ms: 912.25,
  sampleTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  sampleSpanId: "00f067aa0ba902b7",
  sampleDurationMs: 5012.5,
  error: {
    exceptionType: "TimeoutError",
    exceptionMessage: "payment provider did not answer in <NUMBER> ms",
    stackTrace: "TimeoutError: x\n    at charge (src/pay.ts:9)",
    statusCode: "503",
    sampleMatches: 4,
    sampleSize: 5,
  },
  codeLocations: [
    { filePath: "src/pay.ts", functionName: "charge", lineNumber: 9 },
  ],
};

describe("AIInsightEvidence", () => {
  test("every insight type maps to a known evidence section", () => {
    for (const type of Object.values(AIInsightType)) {
      expect(ALL_SECTIONS).toContain(SECTION_FOR_TYPE[type]);
    }
  });

  test("every evidence section is used by at least one insight type", () => {
    const used: Set<EvidenceSection> = new Set(Object.values(SECTION_FOR_TYPE));
    expect([...used].sort()).toEqual([...ALL_SECTIONS].sort());
  });

  test("an empty evidence object is valid (all sections optional)", () => {
    const evidence: AIInsightEvidence = {};
    expect(setSections(evidence)).toEqual([]);
    expect(roundTrip(evidence)).toEqual({});
  });

  test.each([
    ["exception", { exception: exceptionEvidence }],
    ["logSpike", { logSpike: logSpikeEvidence }],
    ["latency", { latency: latencyEvidence }],
    ["metricDrift", { metricDrift: metricDriftEvidence }],
    ["deployRegression", { deployRegression: deployRegressionEvidence }],
    ["profile", { profile: profileEvidence }],
    ["trace", { trace: traceEvidence }],
    [
      "exceptionStackTrace",
      { exceptionStackTrace: exceptionStackTraceEvidence },
    ],
  ] as Array<[EvidenceSection, AIInsightEvidence]>)(
    "%s evidence survives a JSON round trip with exactly one section set",
    (section: EvidenceSection, evidence: AIInsightEvidence) => {
      expect(setSections(evidence)).toEqual([section]);
      const restored: AIInsightEvidence = roundTrip(evidence);
      expect(restored).toEqual(evidence);
      expect(setSections(restored)).toEqual([section]);
    },
  );

  test("exception evidence fields are all optional", () => {
    const minimal: ExceptionInsightEvidence = {};
    expect(roundTrip({ exception: minimal })).toEqual({ exception: {} });
  });

  /*
   * A finding filed before the Exceptions AI section read its stack trace
   * has neither field: absent says "not read", which an empty list (a stack
   * of library frames only) must stay told apart from.
   */
  test("an exception's own code frames: absent, empty and read stay three answers", () => {
    const legacy: AIInsightEvidence = roundTrip({
      exception: { exceptionType: "TypeError" },
    });
    const libraryOnly: AIInsightEvidence = roundTrip({
      exception: { stackFrameCount: 8, ownCodeFrames: [] },
    });
    const ownCode: AIInsightEvidence = roundTrip({
      exception: exceptionEvidence,
    });

    expect(legacy.exception?.ownCodeFrames).toBeUndefined();
    expect(libraryOnly.exception?.ownCodeFrames).toEqual([]);
    expect(libraryOnly.exception?.stackFrameCount).toBe(8);
    expect(ownCode.exception?.ownCodeFrames?.[0]).toEqual({
      functionName: "getOrder",
      fileName: "src/orders.ts",
      lineNumber: 42,
    });
  });

  test("missing stack trace evidence keeps its counts and exceptions exactly", () => {
    const restored: AIInsightEvidence = roundTrip({
      exceptionStackTrace: exceptionStackTraceEvidence,
    });

    expect(restored.exceptionStackTrace?.occurrenceCount).toBe(1240);
    expect(restored.exceptionStackTrace?.withStackTraceCount).toBe(0);
    expect(restored.exceptionStackTrace?.exceptions[0]?.occurrenceCount).toBe(
      900,
    );
    expect(restored.exceptionStackTrace?.exceptions[0]?.lastSeenAt).toBe(
      "2026-10-24T08:55:00.000Z",
    );
  });

  test("undefined optional fields are dropped by serialisation", () => {
    const evidence: AIInsightEvidence = {
      latency: {
        recentP99Ms: 500,
        baselineP99Ms: 100,
        regressionMultiplier: 5,
        operationName: undefined,
        sampleTraceId: undefined,
      },
      exception: undefined,
    };
    const restored: AIInsightEvidence = roundTrip(evidence);
    expect(Object.keys(restored)).toEqual(["latency"]);
    expect(Object.keys(restored.latency!).sort()).toEqual([
      "baselineP99Ms",
      "recentP99Ms",
      "regressionMultiplier",
    ]);
  });

  test("the numeric fields keep their exact values through storage", () => {
    const restored: AIInsightEvidence = roundTrip({
      metricDrift: { ...metricDriftEvidence, relativeChangePercent: -12.345 },
    });
    expect(restored.metricDrift?.relativeChangePercent).toBe(-12.345);
    expect(restored.metricDrift?.recentSampleCount).toBe(10080);
  });

  test("performance findings keep their enum discriminator as a string", () => {
    const restored: AIInsightEvidence = roundTrip({ latency: latencyEvidence });
    expect(restored.latency?.performanceFindings?.[0]?.findingType).toBe(
      "NPlusOneQuery",
    );
    expect(restored.latency?.codeLocations?.[0]?.lineNumber).toBe(88);
  });

  test("profile evidence keeps its shares, windows and neighbours exactly", () => {
    const restored: AIInsightEvidence = roundTrip({ profile: profileEvidence });

    expect(restored.profile?.ownShare).toBe(18.5);
    expect(restored.profile?.ownShareBefore).toBe(4.25);
    expect(restored.profile?.windowStartTime).toBe("2026-10-24T08:00:00.000Z");
    expect(restored.profile?.callees[0]?.share).toBe(15.75);
    expect(restored.profile?.callers[0]?.functionName).toBe("handleOrder");
  });

  test("a Hot profile finding needs no baseline", () => {
    const hot: ProfileInsightEvidence = { ...profileEvidence, reason: "Hot" };
    delete hot.ownShareBefore;
    delete hot.baselineStartTime;
    delete hot.baselineEndTime;

    expect(Object.keys(roundTrip({ profile: hot }).profile!)).not.toContain(
      "ownShareBefore",
    );
  });

  test("trace evidence keeps its counts, its error and its code exactly", () => {
    const restored: AIInsightEvidence = roundTrip({ trace: traceEvidence });

    expect(restored.trace?.p99Ms).toBe(912.25);
    expect(restored.trace?.failedSpanCount).toBe(340);
    expect(restored.trace?.error?.sampleMatches).toBe(4);
    expect(restored.trace?.error?.stackTrace).toContain("src/pay.ts:9");
    expect(restored.trace?.codeLocations?.[0]?.lineNumber).toBe(9);
  });

  test("a trace finding of the service as a whole needs no operation", () => {
    const service: TraceInsightEvidence = {
      serviceId: "7e6a3c1a-1111-4222-8333-944455556666",
      kind: "MissingTracing",
      gap: "NoChildSpans",
      windowStartTime: "2026-10-24T08:00:00.000Z",
      windowEndTime: "2026-10-24T09:00:00.000Z",
      spanCount: 2400,
      topOperations: [{ name: "GET /", spanCount: 2000 }],
    };

    expect(Object.keys(roundTrip({ trace: service }).trace!)).not.toContain(
      "operationName",
    );
  });

  test("log spike topServices preserves order", () => {
    const restored: AIInsightEvidence = roundTrip({
      logSpike: logSpikeEvidence,
    });
    expect(
      restored.logSpike?.topServices.map(
        (service: { serviceName: string; count: number }) => {
          return service.serviceName;
        },
      ),
    ).toEqual(["checkout", "payments"]);
  });
});
