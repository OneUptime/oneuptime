import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import ServiceService from "../../../../../Server/Services/ServiceService";
import SpanService from "../../../../../Server/Services/SpanService";
import TraceAggregationService, {
  ServiceLatencyProfile,
  ServiceSpanHealthRow,
  TraceAnalyticsRequest,
  TraceAnalyticsTableRow,
} from "../../../../../Server/Services/TraceAggregationService";
import InsightDetectors from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/Index";
import TraceProblemDetector, {
  TraceFailingOperationDetector,
  TraceMissingTracingDetector,
  TraceSlowOperationDetector,
} from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/TraceProblemDetector";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import LlmConversationPrivacy from "../../../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import Span, {
  SpanEventType,
  SpanKind,
  SpanStatus,
} from "../../../../../Models/AnalyticsModels/Span";
import Service from "../../../../../Models/DatabaseModels/Service";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import { TraceInsightEvidence } from "../../../../../Types/AI/AIInsightEvidence";
import { PerformanceFindingType } from "../../../../../Types/AI/CodeFixTaskContext";
import { TelemetryAiLane } from "../../../../../Types/AI/TelemetryAi";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  TraceInsightKind,
  TraceTracingGap,
} from "../../../../../Utils/Traces/TraceInsight";

/*
 * Traces' look (TraceProblemDetector): once an hour, every service's span
 * counts and p99 from the span table's aggregates, then - for the few that
 * pass the gates - one service's operations, its recent failed spans or its
 * slowest request's trace, sorted into the kind of finding that fits:
 * a slow operation, a failing one, or missing tracing. One look per scan,
 * shared by the lane's three detectors.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5229aaaa-0000-4000-8000-000000000001",
);
const CHECKOUT: string = "5229aaaa-0000-4000-8000-000000000002";
const REPORTING: string = "5229aaaa-0000-4000-8000-000000000003";
const EDGE: string = "5229aaaa-0000-4000-8000-000000000004";
const PAYMENTS: string = "5229aaaa-0000-4000-8000-000000000005";
const HOST: string = "5229aaaa-0000-4000-8000-000000000006";
const NOW: Date = new Date("2026-10-24T09:00:04.000Z");
const MS: number = 1_000_000;

function health(
  overrides: Partial<ServiceSpanHealthRow> = {},
): ServiceSpanHealthRow {
  return {
    primaryEntityId: CHECKOUT,
    spanCount: 3000,
    failedSpanCount: 0,
    rootSpanCount: 400,
    ...overrides,
  };
}

function tableRow(
  name: string,
  overrides: Partial<TraceAnalyticsTableRow> = {},
): TraceAnalyticsTableRow {
  return {
    groupValues: { name },
    count: 2800,
    errorCount: 0,
    avgDurationMs: 300,
    p50DurationMs: 90,
    p90DurationMs: 600,
    p95DurationMs: 800,
    p99DurationMs: 900,
    minDurationMs: 1,
    maxDurationMs: 2000,
    ...overrides,
  };
}

function makeSpan(data: {
  id: string;
  parent?: string | undefined;
  name: string;
  startMs: number;
  endMs: number;
  kind?: SpanKind | undefined;
  serviceId?: string | undefined;
  attributes?: JSONObject | undefined;
}): Span {
  const span: Span = new Span();
  span.traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  span.spanId = data.id;
  span.parentSpanId = data.parent || "";
  span.name = data.name;
  span.startTimeUnixNano = data.startMs * MS;
  span.endTimeUnixNano = data.endMs * MS;
  span.durationUnixNano = (data.endMs - data.startMs) * MS;
  span.kind = data.kind || SpanKind.Internal;
  span.primaryEntityId = new ObjectID(data.serviceId || CHECKOUT);
  span.attributes = data.attributes || {};
  return span;
}

// GET /orders in checkout: the same query once per order, 40 times.
function nPlusOneTrace(): Array<Span> {
  const spans: Array<Span> = [
    makeSpan({
      id: "root",
      name: "GET /orders",
      startMs: 0,
      endMs: 2000,
      kind: SpanKind.Server,
    }),
  ];

  for (let index: number = 0; index < 40; index++) {
    spans.push(
      makeSpan({
        id: `q${index}`,
        parent: "root",
        name: "SELECT orders",
        startMs: 100 + index * 45,
        endMs: 140 + index * 45,
        kind: SpanKind.Client,
        attributes: {
          "db.system": "postgresql",
          "db.statement": `SELECT * FROM orders WHERE id = ${index}`,
          "code.filepath": "src/orders/list.ts",
          "code.function": "listOrders",
          "code.lineno": "42",
        },
      }),
    );
  }

  return spans;
}

// GET /report in reporting: 2.5 s of its own work, nothing under it.
function untracedTrace(): Array<Span> {
  return [
    makeSpan({
      id: "report",
      name: "GET /report",
      startMs: 0,
      endMs: 2600,
      kind: SpanKind.Server,
      serviceId: REPORTING,
    }),
    makeSpan({
      id: "reports-query",
      parent: "report",
      name: "SELECT reports",
      startMs: 0,
      endMs: 100,
      kind: SpanKind.Client,
      serviceId: REPORTING,
      attributes: { "db.system": "postgresql" },
    }),
  ];
}

function failedSpan(overrides: {
  spanId: string;
  statusMessage?: string;
  exceptionType?: string;
  exceptionMessage?: string;
  stackTrace?: string;
  fault?: boolean;
  attributes?: JSONObject;
}): Span {
  const span: Span = new Span();
  span.traceId = `trace-${overrides.spanId}`;
  span.spanId = overrides.spanId;
  span.statusCode = SpanStatus.Error;
  span.statusMessage = overrides.statusMessage || "";
  span.durationUnixNano = 5000 * MS;
  span.attributes = overrides.attributes || {};
  span.events = [];

  if (overrides.exceptionType || overrides.exceptionMessage) {
    span.hasException = true;
    span.events.push({
      name: SpanEventType.Exception,
      time: NOW,
      timeUnixNano: NOW.getTime() * MS,
      attributes: {
        "exception.type": overrides.exceptionType || "",
        "exception.message": overrides.exceptionMessage || "",
        "exception.stacktrace": overrides.stackTrace || "",
      },
    });
  }

  if (overrides.fault) {
    span.events.push({
      name: SpanEventType.Fault,
      time: NOW,
      timeUnixNano: NOW.getTime() * MS,
      attributes: { "error.type": "InvalidApiKey" },
    });
  }

  return span;
}

function service(id: string, name: string): Service {
  const row: Service = new Service();
  row.id = new ObjectID(id);
  row.name = name;
  return row;
}

describe("TraceProblemDetector", () => {
  let healthRows: Array<ServiceSpanHealthRow>;
  let latency: ServiceLatencyProfile;
  let tables: Map<string, Array<TraceAnalyticsTableRow>>;
  let failedSpans: Map<string, Array<Span>>;
  let traces: Map<string, Array<Span>>;
  let restricted: Array<string>;
  let services: Array<Service>;
  let readHealth: SpyInstance<
    typeof TraceAggregationService.getServiceSpanHealth
  >;
  let readTable: SpyInstance<typeof TraceAggregationService.getAnalyticsTable>;
  let readSpans: SpyInstance<typeof SpanService.findBy>;

  function context(): InsightScanContext {
    return { projectId: PROJECT_ID, now: NOW };
  }

  beforeEach(() => {
    healthRows = [];
    latency = { rows: [], isPartial: false };
    tables = new Map();
    failedSpans = new Map();
    traces = new Map();
    restricted = [];
    services = [
      service(CHECKOUT, "checkout"),
      service(REPORTING, "reporting"),
      service(EDGE, "edge"),
      service(PAYMENTS, "payments"),
    ];

    jest
      .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
      .mockImplementation(async () => {
        return restricted;
      });
    readHealth = jest
      .spyOn(TraceAggregationService, "getServiceSpanHealth")
      .mockImplementation(async () => {
        return healthRows;
      });
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockImplementation(async () => {
        return latency;
      });
    readTable = jest
      .spyOn(TraceAggregationService, "getAnalyticsTable")
      .mockImplementation(async (request: TraceAnalyticsRequest) => {
        const serviceId: string =
          request.serviceIds?.[0]?.toString().toLowerCase() || "";

        return (
          tables.get(`${serviceId}:${request.tableSort?.column || ""}`) ||
          tables.get(serviceId) ||
          []
        );
      });
    jest.spyOn(ServiceService, "findBy").mockImplementation(async () => {
      return services;
    });
    readSpans = jest
      .spyOn(SpanService, "findBy")
      .mockImplementation(async (data: { query: unknown; sort?: unknown }) => {
        const query: JSONObject = data.query as JSONObject;

        if (query["traceId"]) {
          return traces.get(String(query["traceId"])) || [];
        }

        const key: string = `${String(query["primaryEntityId"]).toLowerCase()}:${String(query["name"])}`;

        if (query["statusCode"] === SpanStatus.Error) {
          return failedSpans.get(key) || [];
        }

        // The slowest span of an operation: its trace's root.
        const trace: Array<Span> | undefined = traces.get(key);

        return trace ? [trace[0]!] : [];
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function slowCheckout(): void {
    healthRows = [health({ primaryEntityId: CHECKOUT })];
    latency = {
      rows: [{ primaryEntityId: CHECKOUT, count: 3000, p99DurationMs: 2400 }],
      isPartial: false,
    };
    tables.set(`${CHECKOUT}:p99`, [
      tableRow("GET /orders", { count: 1234, p99DurationMs: 2400 }),
    ]);

    const trace: Array<Span> = nPlusOneTrace();
    traces.set(`${CHECKOUT}:GET /orders`, trace);
    traces.set("4bf92f3577b34da6a3ce929d0e0e4736", trace);
  }

  function failingCheckout(spans: Array<Span>): void {
    healthRows = [health({ primaryEntityId: CHECKOUT, failedSpanCount: 340 })];
    tables.set(`${CHECKOUT}:errorCount`, [
      tableRow("POST /checkout", { count: 2800, errorCount: 340 }),
    ]);
    failedSpans.set(`${CHECKOUT}:POST /checkout`, spans);
  }

  test("a slow operation whose slowest request runs the same query 40 times", async () => {
    slowCheckout();

    const found: Array<InsightCandidate> =
      await TraceProblemDetector.look(context());

    expect(found).toHaveLength(1);

    const candidate: InsightCandidate = found[0]!;
    const evidence: TraceInsightEvidence = candidate.evidence.trace!;

    expect(candidate.insightType).toBe(AIInsightType.TraceSlowOperation);
    expect(candidate.title).toBe(
      "GET /orders in checkout runs the same database query 40 times",
    );
    expect(candidate.fingerprint).toBe(`trace-slow:${CHECKOUT}:GET /orders`);
    expect(candidate.severity).toBe(AIInsightSeverity.High);
    expect(candidate.serviceName).toBe("checkout");
    expect(candidate.telemetryServiceId?.toString()).toBe(CHECKOUT);
    expect(candidate.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(evidence).toMatchObject({
      serviceId: CHECKOUT,
      kind: TraceInsightKind.Slow,
      operationName: "GET /orders",
      spanCount: 1234,
      p99Ms: 2400,
      sampleSpanId: "root",
      sampleDurationMs: 2000,
      windowStartTime: "2026-10-24T08:00:04.000Z",
      windowEndTime: "2026-10-24T09:00:04.000Z",
    });
    expect(evidence.performanceFindings?.[0]?.findingType).toBe(
      PerformanceFindingType.NPlusOneQuery,
    );
    expect(evidence.codeLocations).toEqual([
      {
        filePath: "src/orders/list.ts",
        functionName: "listOrders",
        lineNumber: 42,
      },
    ]);
    expect(candidate.detailMarkdown).toContain(
      "**Slow operation in checkout**",
    );
    expect(candidate.detailMarkdown).toContain(
      "- The same database query ran 40 times under GET /orders",
    );
  });

  test("the window and the services are read from the aggregates, as root and scoped to the project", async () => {
    slowCheckout();

    await TraceProblemDetector.look(context());

    const request: JSONObject = readHealth.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(String(request["projectId"])).toBe(PROJECT_ID.toString());
    expect((request["startTime"] as Date).toISOString()).toBe(
      "2026-10-24T08:00:04.000Z",
    );
    expect((request["endTime"] as Date).toISOString()).toBe(NOW.toISOString());

    for (const call of readSpans.mock.calls) {
      const read: JSONObject = call[0] as unknown as JSONObject;
      expect(read["props"]).toEqual({ isRoot: true });
      expect(String((read["query"] as JSONObject)["projectId"])).toBe(
        PROJECT_ID.toString(),
      );
    }
  });

  test("slow with no known pattern, but the time in its own work: missing tracing", async () => {
    healthRows = [health({ primaryEntityId: REPORTING })];
    latency = {
      rows: [{ primaryEntityId: REPORTING, count: 3000, p99DurationMs: 2600 }],
      isPartial: false,
    };
    tables.set(`${REPORTING}:p99`, [
      tableRow("GET /report", { count: 300, p99DurationMs: 2600 }),
    ]);
    traces.set(`${REPORTING}:GET /report`, untracedTrace());
    traces.set("4bf92f3577b34da6a3ce929d0e0e4736", untracedTrace());

    const found: Array<InsightCandidate> =
      await TraceProblemDetector.look(context());

    expect(found).toHaveLength(1);
    expect(found[0]!.insightType).toBe(AIInsightType.TraceMissingTracing);
    expect(found[0]!.title).toBe(
      "GET /report in reporting spends 96% of its time untraced",
    );
    expect(found[0]!.severity).toBe(AIInsightSeverity.Low);
    expect(found[0]!.evidence.trace).toMatchObject({
      kind: TraceInsightKind.MissingTracing,
      gap: TraceTracingGap.UntracedTime,
      untracedSpanName: "GET /report",
      untracedMs: 2500,
      sampleDurationMs: 2600,
    });
    expect(found[0]!.fingerprint).toBe(
      `trace-missing-tracing:${REPORTING}:UntracedTime:GET /report`,
    );
  });

  test("a failing operation that says why: its error is the evidence", async () => {
    failingCheckout([
      failedSpan({
        spanId: "f1",
        exceptionType: "TimeoutError",
        exceptionMessage: "payment provider did not answer for ada@example.com",
        stackTrace: "TimeoutError: x\n    at charge (src/pay.ts:9)",
        attributes: { "http.response.status_code": 503 },
      }),
      failedSpan({
        spanId: "f2",
        exceptionType: "TimeoutError",
        exceptionMessage: "payment provider did not answer for ada@example.com",
      }),
      failedSpan({ spanId: "f3", statusMessage: "upstream reset" }),
    ]);

    const found: Array<InsightCandidate> =
      await TraceProblemDetector.look(context());

    expect(found).toHaveLength(1);
    expect(found[0]!.insightType).toBe(AIInsightType.TraceFailingOperation);
    expect(found[0]!.title).toBe(
      "POST /checkout in checkout fails 12% of the time",
    );
    expect(found[0]!.traceId).toBe("trace-f1");
    expect(found[0]!.evidence.trace?.error).toMatchObject({
      exceptionType: "TimeoutError",
      exceptionMessage: expect.stringContaining(
        "payment provider did not answer",
      ),
      statusCode: "503",
      sampleMatches: 2,
      sampleSize: 3,
    });
    // Sanitized: a person's address is not kept.
    expect(found[0]!.evidence.trace?.error?.exceptionMessage).not.toContain(
      "ada@example.com",
    );
    expect(found[0]!.evidence.trace?.failedSpanCount).toBe(340);
  });

  test("failures that say nothing about why: missing tracing", async () => {
    failingCheckout([
      failedSpan({ spanId: "f1" }),
      failedSpan({ spanId: "f2" }),
    ]);

    const found: Array<InsightCandidate> =
      await TraceProblemDetector.look(context());

    expect(found).toHaveLength(1);
    expect(found[0]!.insightType).toBe(AIInsightType.TraceMissingTracing);
    expect(found[0]!.title).toBe(
      "POST /checkout in checkout fails without saying why",
    );
    expect(found[0]!.severity).toBe(AIInsightSeverity.Medium);
    expect(found[0]!.evidence.trace?.gap).toBe(TraceTracingGap.SilentFailures);
  });

  test("failures the code meant (only faults recorded): nothing filed", async () => {
    failingCheckout([
      failedSpan({ spanId: "f1", fault: true, statusMessage: "Invalid key" }),
      failedSpan({ spanId: "f2", fault: true }),
    ]);

    expect(await TraceProblemDetector.look(context())).toEqual([]);
  });

  test("an operation that is both slow and failing is one finding: the failure", async () => {
    slowCheckout();
    healthRows = [health({ primaryEntityId: CHECKOUT, failedSpanCount: 340 })];
    tables.set(`${CHECKOUT}:errorCount`, [
      tableRow("GET /orders", { count: 1234, errorCount: 300 }),
    ]);
    failedSpans.set(`${CHECKOUT}:GET /orders`, [
      failedSpan({ spanId: "f1", statusMessage: "statement timeout" }),
    ]);

    const found: Array<InsightCandidate> =
      await TraceProblemDetector.look(context());

    expect(
      found.map((candidate: InsightCandidate) => {
        return candidate.insightType;
      }),
    ).toEqual([AIInsightType.TraceFailingOperation]);
  });

  test("a service whose every span is its trace's only one: its requests have no spans inside them", async () => {
    healthRows = [
      health({ primaryEntityId: EDGE, spanCount: 2400, rootSpanCount: 2400 }),
    ];
    latency = {
      rows: [{ primaryEntityId: EDGE, count: 2400, p99DurationMs: 3000 }],
      isPartial: false,
    };
    tables.set(`${EDGE}:count`, [
      tableRow("GET /", { count: 2000 }),
      tableRow("POST /login", { count: 400 }),
    ]);

    const found: Array<InsightCandidate> =
      await TraceProblemDetector.look(context());

    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe("edge's requests have no spans inside them");
    expect(found[0]!.evidence.trace).toMatchObject({
      gap: TraceTracingGap.NoChildSpans,
      spanCount: 2400,
      topOperations: [
        { name: "GET /", spanCount: 2000 },
        { name: "POST /login", spanCount: 400 },
      ],
    });
    // The slow drill is not run for it: the finding says it all.
    expect(
      readTable.mock.calls.some((call: Array<unknown>) => {
        return (call[0] as TraceAnalyticsRequest).tableSort?.column === "p99";
      }),
    ).toBe(false);
  });

  test("a latency profile that may be partial reads no service as slow", async () => {
    slowCheckout();
    latency = { ...latency, isPartial: true };

    expect(await TraceProblemDetector.look(context())).toEqual([]);
  });

  test("a company AI tool's service is never read", async () => {
    slowCheckout();
    restricted = [CHECKOUT.toUpperCase()];

    expect(await TraceProblemDetector.look(context())).toEqual([]);
    expect(readTable).not.toHaveBeenCalled();
  });

  test("an entity that is not one of the project's services is never read", async () => {
    healthRows = [health({ primaryEntityId: HOST, failedSpanCount: 900 })];
    tables.set(`${HOST}:errorCount`, [tableRow("GET /", { errorCount: 900 })]);

    expect(await TraceProblemDetector.look(context())).toEqual([]);
    expect(readTable).not.toHaveBeenCalled();
  });

  test("nothing over the gates: nothing is read past the aggregates", async () => {
    healthRows = [health({ primaryEntityId: CHECKOUT, failedSpanCount: 3 })];
    latency = {
      rows: [{ primaryEntityId: CHECKOUT, count: 3000, p99DurationMs: 400 }],
      isPartial: false,
    };

    expect(await TraceProblemDetector.look(context())).toEqual([]);
    expect(readTable).not.toHaveBeenCalled();
    expect(readSpans).not.toHaveBeenCalled();
  });

  test("one service failing to read does not stop the others", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    slowCheckout();
    healthRows.push(
      health({ primaryEntityId: PAYMENTS, failedSpanCount: 500 }),
    );
    readTable.mockImplementation(async (request: TraceAnalyticsRequest) => {
      const serviceId: string =
        request.serviceIds?.[0]?.toString().toLowerCase() || "";

      if (serviceId === PAYMENTS) {
        throw new Error("too slow");
      }

      return (
        tables.get(`${serviceId}:${request.tableSort?.column || ""}`) || []
      );
    });

    const found: Array<InsightCandidate> =
      await TraceProblemDetector.look(context());

    expect(
      found.map((candidate: InsightCandidate) => {
        return candidate.serviceName;
      }),
    ).toEqual(["checkout"]);
  });

  test("a look that fails finds nothing, and never throws", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    readHealth.mockRejectedValue(new Error("ClickHouse is down"));

    await expect(TraceProblemDetector.look(context())).resolves.toEqual([]);
  });

  test("the lane's three detectors share one look per scan, each with its own kind", async () => {
    slowCheckout();
    healthRows.push(
      health({ primaryEntityId: EDGE, spanCount: 2400, rootSpanCount: 2400 }),
    );

    const scan: InsightScanContext = context();
    const detectors: Array<InsightDetector> =
      InsightDetectors.getTelemetryAiDetectors(TelemetryAiLane.Trace);

    expect(
      detectors.map((detector: InsightDetector) => {
        return detector.insightType;
      }),
    ).toEqual([
      AIInsightType.TraceFailingOperation,
      AIInsightType.TraceSlowOperation,
      AIInsightType.TraceMissingTracing,
    ]);

    const failing: Array<InsightCandidate> =
      await new TraceFailingOperationDetector().detect(scan);
    const slow: Array<InsightCandidate> =
      await new TraceSlowOperationDetector().detect(scan);
    const missing: Array<InsightCandidate> =
      await new TraceMissingTracingDetector().detect(scan);

    expect(failing).toEqual([]);
    expect(
      slow.map((candidate: InsightCandidate) => {
        return candidate.insightType;
      }),
    ).toEqual([AIInsightType.TraceSlowOperation]);
    expect(
      missing.map((candidate: InsightCandidate) => {
        return candidate.insightType;
      }),
    ).toEqual([AIInsightType.TraceMissingTracing]);

    // One look for the three: the aggregates were read once.
    expect(readHealth).toHaveBeenCalledTimes(1);

    // A new scan looks again.
    await new TraceSlowOperationDetector().detect(context());
    expect(readHealth).toHaveBeenCalledTimes(2);
  });

  test("an operation's or an error's text is written into the evidence escaped", () => {
    const detail: string = TraceProblemDetector.buildDetail({
      serviceName: "check*out",
      evidence: {
        serviceId: CHECKOUT,
        kind: TraceInsightKind.Failing,
        operationName: "GET /`x`",
        windowStartTime: "2026-10-24T08:00:04.000Z",
        windowEndTime: "2026-10-24T09:00:04.000Z",
        spanCount: 100,
        failedSpanCount: 30,
        error: {
          statusMessage: "![x](https://example.com/p.png)",
          sampleMatches: 1,
          sampleSize: 1,
        },
      },
    }).toString();

    expect(detail).toContain("**Failing operation in check\\*out**");
    expect(detail).not.toContain("![x](https://example.com/p.png)");
  });
});

describe("TraceProblemDetector - reading what spans say", () => {
  test("a failed span's exception, fault, status and code, sanitized and cut", () => {
    const span: Span = failedSpan({
      spanId: "f1",
      statusMessage: "user 123e4567-e89b-42d3-a456-426614174000 failed",
      exceptionType: "TypeError",
      exceptionMessage: "x".repeat(5000),
      stackTrace: Array.from(
        { length: 80 },
        (_unused: unknown, index: number): string => {
          return `    at f${index} (src/a.ts:${index})`;
        },
      ).join("\n"),
      fault: true,
      attributes: {
        "rpc.grpc.status_code": 14,
        "code.filepath": "src/pay.ts",
        "code.function": "charge",
        "code.lineno": "9",
      },
    });

    const sample: ReturnType<typeof TraceProblemDetector.toFailedSpanSample> =
      TraceProblemDetector.toFailedSpanSample(span);

    expect(sample.hasException).toBe(true);
    expect(sample.hasFaultEvent).toBe(true);
    expect(sample.statusMessage).not.toContain(
      "123e4567-e89b-42d3-a456-426614174000",
    );
    expect(sample.exceptionType).toBe("TypeError");
    expect((sample.exceptionMessage || "").length).toBeLessThanOrEqual(2000);
    expect((sample.stackTrace || "").split("\n").length).toBeLessThanOrEqual(
      20,
    );
    expect(sample.statusCode).toBe("14");
    expect(sample.codeLocation).toEqual({
      filePath: "src/pay.ts",
      functionName: "charge",
      lineNumber: 9,
    });
  });

  test("a span that recorded nothing reads as nothing", () => {
    const span: Span = new Span();
    span.traceId = "t";
    span.spanId = "s";

    expect(TraceProblemDetector.toFailedSpanSample(span)).toEqual({
      traceId: "t",
      spanId: "s",
      hasException: false,
      hasFaultEvent: false,
    });
  });

  test("the two aggregates join on the service, ids lower-cased", () => {
    expect(
      TraceProblemDetector.toServiceReadings({
        health: [health({ primaryEntityId: CHECKOUT.toUpperCase() })],
        latency: [
          {
            primaryEntityId: CHECKOUT.toUpperCase(),
            count: 3000,
            p99DurationMs: 1200,
          },
        ],
      }),
    ).toEqual([
      {
        serviceId: CHECKOUT,
        spanCount: 3000,
        failedSpanCount: 0,
        rootSpanCount: 400,
        p99Ms: 1200,
      },
    ]);

    expect(
      TraceProblemDetector.toServiceReadings({
        health: [health()],
        latency: null,
      })[0]!.p99Ms,
    ).toBe(0);
  });

  test("a trace's spans keep their kind and their service", () => {
    const spans: ReturnType<typeof TraceProblemDetector.toTraceInsightSpans> =
      TraceProblemDetector.toTraceInsightSpans(nPlusOneTrace().slice(0, 2));

    expect(spans[0]).toMatchObject({
      spanId: "root",
      kind: SpanKind.Server,
      serviceId: CHECKOUT,
      durationMs: 2000,
    });
    expect(spans[1]).toMatchObject({
      parentSpanId: "root",
      kind: SpanKind.Client,
    });
  });
});
