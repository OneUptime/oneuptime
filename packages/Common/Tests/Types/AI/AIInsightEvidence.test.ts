import { describe, expect, test } from "@jest/globals";
import AIInsightEvidence, {
  ExceptionInsightEvidence,
  LatencyInsightEvidence,
  LogSpikeInsightEvidence,
  MetricDriftInsightEvidence,
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
};

const ALL_SECTIONS: Array<EvidenceSection> = [
  "exception",
  "logSpike",
  "latency",
  "metricDrift",
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
