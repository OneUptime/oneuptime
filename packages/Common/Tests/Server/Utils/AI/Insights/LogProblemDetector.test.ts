import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import LogAggregationService, {
  ErrorPatternCodeLocation,
  ErrorPatternDetailRequest,
  ServiceLogHealthRow,
  ServiceLogPatterns,
  ServiceLogPatternsRequest,
  TopErrorPattern,
  TopErrorPatternsRequest,
  TraceLogCountsRequest,
} from "../../../../../Server/Services/LogAggregationService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import SpanService from "../../../../../Server/Services/SpanService";
import TraceAggregationService, {
  ServiceSpanHealthRow,
  TraceAnalyticsRequest,
  TraceAnalyticsTableRow,
} from "../../../../../Server/Services/TraceAggregationService";
import InsightDetectors from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/Index";
import LogProblemDetector, {
  LogErrorPatternDetector,
  LogMissingLoggingDetector,
  LogNoisyPatternDetector,
} from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/LogProblemDetector";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import LlmConversationPrivacy from "../../../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import Span, {
  SpanEventType,
  SpanStatus,
} from "../../../../../Models/AnalyticsModels/Span";
import Service from "../../../../../Models/DatabaseModels/Service";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import { LogInsightEvidence } from "../../../../../Types/AI/AIInsightEvidence";
import { TelemetryAiLane } from "../../../../../Types/AI/TelemetryAi";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../../../Types/JSON";
import LogSeverity from "../../../../../Types/Log/LogSeverity";
import ObjectID from "../../../../../Types/ObjectID";
import {
  LOG_INSIGHT_ERROR_PATTERN_ROWS,
  LOG_INSIGHT_INGEST_GRACE_MINUTES,
  LOG_INSIGHT_MASKED_TOKEN,
  LOG_INSIGHT_NOISY_SAMPLE_SIZE,
  LogInsightKind,
  LogLoggingGap,
} from "../../../../../Utils/Logs/LogInsight";

/*
 * Logs' look (LogProblemDetector): once an hour, every service's logs over
 * the hour - and, for what logs cannot say alone, its spans - then, for the
 * few services that pass the gates, the reads that file each kind of
 * finding: a service's error messages (and where they were logged), a
 * failing operation's most recent failed requests and the service's lines
 * in them, and a sample of a busy service's lines. One look per scan,
 * shared by the lane's three detectors, and no line ever kept as logged.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a220000-0000-4000-8000-000000000001",
);
const CHECKOUT: string = "5a220000-0000-4000-8000-000000000002";
const BILLING: string = "5a220000-0000-4000-8000-000000000003";
const EDGE: string = "5a220000-0000-4000-8000-000000000004";
const HOST: string = "5a220000-0000-4000-8000-000000000005";
const NOW: Date = new Date("2026-10-24T09:00:04.000Z");
const JWT: string =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

function logHealth(
  overrides: Partial<ServiceLogHealthRow> = {},
): ServiceLogHealthRow {
  return {
    primaryEntityId: CHECKOUT,
    logCount: 5000,
    errorLogCount: 0,
    tracedLogCount: 4000,
    ...overrides,
  };
}

function spanHealth(
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

function errorPattern(
  overrides: Partial<TopErrorPattern> = {},
): TopErrorPattern {
  return {
    pattern: "Payment provider returned <num>: card declined",
    sampleBody: "Payment provider returned 402: card declined",
    count: 1240,
    firstSeenAt: "2026-10-24 08:01:00",
    lastSeenAt: "2026-10-24 08:59:00",
    resourceCount: 1,
    resourceIds: [CHECKOUT],
    severities: [LogSeverity.Error],
    traceCount: 312,
    sampleTraceIds: [
      "4bf92f3577b34da6a3ce929d0e0e4736",
      "4bf92f3577b34da6a3ce929d0e0e4737",
      "4bf92f3577b34da6a3ce929d0e0e4738",
      "4bf92f3577b34da6a3ce929d0e0e4739",
    ],
    ...overrides,
  };
}

function tableRow(
  name: string,
  overrides: Partial<TraceAnalyticsTableRow> = {},
): TraceAnalyticsTableRow {
  return {
    groupValues: { name },
    count: 2600,
    errorCount: 312,
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

function failedSpan(
  index: number,
  overrides: { fault?: boolean; exception?: boolean } = {},
): Span {
  const span: Span = new Span();
  span.traceId = `5bf92f3577b34da6a3ce929d0e0e47${String(index).padStart(2, "0")}`;
  span.spanId = `00f067aa0ba902${String(index).padStart(2, "0")}`;
  span.statusCode = SpanStatus.Error;
  span.statusMessage = "";
  span.attributes = {
    "code.filepath": "src/checkout/handler.ts",
    "code.function": "handleCheckout",
    "code.lineno": "77",
  };
  span.events = [];

  if (overrides.exception !== false && !overrides.fault) {
    span.hasException = true;
    span.events.push({
      name: SpanEventType.Exception,
      time: NOW,
      timeUnixNano: NOW.getTime() * 1_000_000,
      attributes: {
        "exception.type": "TimeoutError",
        "exception.message": `payment provider did not answer for user ann${index}@example.com`,
        "exception.stacktrace":
          "TimeoutError: payment provider did not answer\n    at charge (src/checkout/pay.ts:12:3)",
      },
    });
  }

  if (overrides.fault) {
    span.events.push({
      name: SpanEventType.Fault,
      time: NOW,
      timeUnixNano: NOW.getTime() * 1_000_000,
      attributes: { "error.type": "CardDeclined" },
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

describe("LogProblemDetector", () => {
  let logRows: Array<ServiceLogHealthRow>;
  let spanRows: Array<ServiceSpanHealthRow>;
  let errorPatterns: Map<string, Array<TopErrorPattern>>;
  let codeLocations: Array<ErrorPatternCodeLocation>;
  let samples: Map<string, ServiceLogPatterns>;
  let tables: Map<string, Array<TraceAnalyticsTableRow>>;
  let failedSpans: Map<string, Array<Span>>;
  let tracesThatLogged: Map<string, number>;
  let restricted: Array<string>;
  let services: Array<Service>;
  let readLogHealth: SpyInstance<
    typeof LogAggregationService.getServiceLogHealth
  >;
  let readSpanHealth: SpyInstance<
    typeof TraceAggregationService.getServiceSpanHealth
  >;
  let readErrorPatterns: SpyInstance<
    typeof LogAggregationService.getTopErrorPatterns
  >;
  let readCodeLocations: SpyInstance<
    typeof LogAggregationService.getErrorPatternCodeLocations
  >;
  let readSample: SpyInstance<
    typeof LogAggregationService.getServiceLogPatterns
  >;
  let readTraceLogs: SpyInstance<
    typeof LogAggregationService.getServiceLogCountsByTrace
  >;
  let readSpans: SpyInstance<typeof SpanService.findBy>;

  function context(): InsightScanContext {
    return { projectId: PROJECT_ID, now: NOW };
  }

  beforeEach(() => {
    logRows = [];
    spanRows = [];
    errorPatterns = new Map();
    codeLocations = [];
    samples = new Map();
    tables = new Map();
    failedSpans = new Map();
    tracesThatLogged = new Map();
    restricted = [];
    services = [
      service(CHECKOUT, "checkout"),
      service(BILLING, "billing"),
      service(EDGE, "edge"),
    ];

    jest
      .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
      .mockImplementation(async () => {
        return restricted;
      });
    readLogHealth = jest
      .spyOn(LogAggregationService, "getServiceLogHealth")
      .mockImplementation(async () => {
        return logRows;
      });
    readSpanHealth = jest
      .spyOn(TraceAggregationService, "getServiceSpanHealth")
      .mockImplementation(async () => {
        return spanRows;
      });
    readErrorPatterns = jest
      .spyOn(LogAggregationService, "getTopErrorPatterns")
      .mockImplementation(async (request: TopErrorPatternsRequest) => {
        return (
          errorPatterns.get(
            request.serviceIds?.[0]?.toString().toLowerCase() || "",
          ) || []
        );
      });
    readCodeLocations = jest
      .spyOn(LogAggregationService, "getErrorPatternCodeLocations")
      .mockImplementation(async (_request: ErrorPatternDetailRequest) => {
        return codeLocations;
      });
    readSample = jest
      .spyOn(LogAggregationService, "getServiceLogPatterns")
      .mockImplementation(async (request: ServiceLogPatternsRequest) => {
        return (
          samples.get(request.serviceId.toString().toLowerCase()) || {
            sampledLogCount: 0,
            patterns: [],
          }
        );
      });
    readTraceLogs = jest
      .spyOn(LogAggregationService, "getServiceLogCountsByTrace")
      .mockImplementation(async (_request: TraceLogCountsRequest) => {
        return tracesThatLogged;
      });
    jest
      .spyOn(TraceAggregationService, "getAnalyticsTable")
      .mockImplementation(async (request: TraceAnalyticsRequest) => {
        return (
          tables.get(request.serviceIds?.[0]?.toString().toLowerCase() || "") ||
          []
        );
      });
    readSpans = jest
      .spyOn(SpanService, "findBy")
      .mockImplementation(async (data: { query: unknown }) => {
        const query: JSONObject = data.query as JSONObject;

        return (
          failedSpans.get(
            `${String(query["primaryEntityId"]).toLowerCase()}:${String(query["name"])}`,
          ) || []
        );
      });
    jest.spyOn(ServiceService, "findBy").mockImplementation(async () => {
      return services;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function erroringCheckout(patterns: Array<TopErrorPattern>): void {
    logRows = [logHealth({ errorLogCount: 2100, logCount: 18400 })];
    errorPatterns.set(CHECKOUT, patterns);
  }

  function silentCheckout(spans: Array<Span>): void {
    logRows = [logHealth({ logCount: 18400, tracedLogCount: 17000 })];
    spanRows = [spanHealth({ failedSpanCount: 312, spanCount: 3000 })];
    tables.set(CHECKOUT, [tableRow("POST /checkout")]);
    failedSpans.set(`${CHECKOUT}:POST /checkout`, spans);
  }

  function failures(count: number): Array<Span> {
    return Array.from({ length: count }, (_value: unknown, index: number) => {
      return failedSpan(index);
    });
  }

  describe("error logs", () => {
    test("a message logged 1,240 times, with where it was logged", async () => {
      erroringCheckout([errorPattern()]);
      codeLocations = [
        {
          filePath: "src/payments/client.py",
          functionName: "charge",
          lineNumber: "88",
          count: 1240,
        },
      ];

      const found: Array<InsightCandidate> =
        await LogProblemDetector.look(context());

      expect(found).toHaveLength(1);

      const candidate: InsightCandidate = found[0]!;
      const evidence: LogInsightEvidence = candidate.evidence.log!;

      expect(candidate.insightType).toBe(AIInsightType.LogErrorPattern);
      expect(candidate.title).toBe(
        'checkout logged "Payment provider returned <num>: card declined" 1,240 times in an hour',
      );
      expect(candidate.fingerprint).toBe(
        `log-error:${CHECKOUT}:Payment provider returned <num>: card declined`,
      );
      expect(candidate.severity).toBe(AIInsightSeverity.High);
      expect(candidate.serviceName).toBe("checkout");
      expect(candidate.telemetryServiceId?.toString()).toBe(CHECKOUT);
      expect(candidate.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
      expect(evidence).toEqual({
        serviceId: CHECKOUT,
        kind: LogInsightKind.Error,
        windowStartTime: "2026-10-24T08:00:04.000Z",
        windowEndTime: "2026-10-24T09:00:04.000Z",
        logCount: 18400,
        errorLogCount: 2100,
        pattern: "Payment provider returned <num>: card declined",
        patternCount: 1240,
        severities: [LogSeverity.Error],
        searchText: "Payment provider returned",
        traceCount: 312,
        sampleTraceIds: [
          "4bf92f3577b34da6a3ce929d0e0e4736",
          "4bf92f3577b34da6a3ce929d0e0e4737",
          "4bf92f3577b34da6a3ce929d0e0e4738",
        ],
        codeLocations: [
          {
            filePath: "src/payments/client.py",
            functionName: "charge",
            lineNumber: 88,
          },
        ],
      });
      expect(candidate.detailMarkdown).toContain("**Error log in checkout**");
      expect(candidate.detailMarkdown).toContain(
        "- Code: `src/payments/client.py:88`",
      );
    });

    test("the messages are read for the service, the hour, without exceptions; the code for each message", async () => {
      erroringCheckout([errorPattern()]);

      await LogProblemDetector.look(context());

      const request: TopErrorPatternsRequest =
        readErrorPatterns.mock.calls[0]![0];

      expect(request.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(
        request.serviceIds?.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([CHECKOUT]);
      expect(request.excludeExceptionRecords).toBe(true);
      expect(request.limit).toBe(LOG_INSIGHT_ERROR_PATTERN_ROWS);
      expect(request.startTime.toISOString()).toBe("2026-10-24T08:00:04.000Z");
      expect(request.endTime.toISOString()).toBe(NOW.toISOString());
      // The raw pattern, as the grouping wrote it, is what the read matches.
      expect(readCodeLocations.mock.calls[0]![0].pattern).toBe(
        "Payment provider returned <num>: card declined",
      );
      expect(readCodeLocations.mock.calls[0]![0].excludeExceptionRecords).toBe(
        true,
      );
    });

    test("an error with a stack trace in its line is the Exceptions product's", async () => {
      erroringCheckout([
        errorPattern({
          pattern:
            "TypeError: Cannot read properties of undefined (reading '<num>') at applyCoupon (src/coupon.ts:<num>:<num>)",
          sampleBody:
            "TypeError: Cannot read properties of undefined (reading 'id')\n    at applyCoupon (src/coupon.ts:42:19)\n    at handle (src/routes.ts:8:7)",
        }),
      ]);

      expect(await LogProblemDetector.look(context())).toEqual([]);
      expect(readCodeLocations).not.toHaveBeenCalled();
    });

    test("too few lines, or no words of its own, is no finding; two at most a service", async () => {
      erroringCheckout([
        errorPattern({ pattern: "Order sync failed for <uuid>", count: 19 }),
        errorPattern({ pattern: "error", sampleBody: "error", count: 900 }),
        errorPattern({ pattern: "Cache write rejected by redis", count: 300 }),
        errorPattern({
          pattern: "Database connection reset by peer",
          count: 800,
        }),
        errorPattern({ pattern: "Queue publish timed out", count: 200 }),
      ]);

      const found: Array<InsightCandidate> =
        await LogProblemDetector.look(context());

      expect(
        found.map((candidate: InsightCandidate): string => {
          return candidate.evidence.log!.pattern || "";
        }),
      ).toEqual([
        "Database connection reset by peer",
        "Cache write rejected by redis",
      ]);
    });

    /*
     * A log line holds whatever the code put in it: what is left of a token
     * after the grouping masked its digits is masked too, and nothing of the
     * line as it was logged reaches the finding.
     */
    test("no line as logged reaches the finding: tokens masked, words searched only when clean", async () => {
      const rawPattern: string = `Login failed for token ${JWT.replace(/\d+/gu, "<num>")}`;

      erroringCheckout([
        errorPattern({
          pattern: rawPattern,
          sampleBody: `Login failed for token ${JWT}`,
        }),
        errorPattern({
          pattern: "cache miss for user_abcdefghij",
          sampleBody: "cache miss for user_abcdefghij",
          count: 400,
        }),
      ]);

      const found: Array<InsightCandidate> =
        await LogProblemDetector.look(context());

      expect(found).toHaveLength(2);
      expect(found[0]!.evidence.log!.pattern).toBe(
        `Login failed for token ${LOG_INSIGHT_MASKED_TOKEN}`,
      );
      expect(found[0]!.evidence.log!.searchText).toBe("Login failed for token");
      // Only what the sanitizer leaves of the words is searched for.
      expect(found[1]!.evidence.log!.pattern).toBe(
        "cache miss for <SERVICE_ID>",
      );
      expect(found[1]!.evidence.log!.searchText).toBe("cache miss for");

      for (const candidate of found) {
        const written: string = JSON.stringify(candidate);

        expect(written).not.toContain("eyJ");
        expect(written).not.toContain("abcdefghij");
      }
    });

    test("where it was logged cannot be read: the finding goes without it", async () => {
      erroringCheckout([errorPattern()]);
      readCodeLocations.mockRejectedValue(new Error("Too slow"));

      const found: Array<InsightCandidate> =
        await LogProblemDetector.look(context());

      expect(found).toHaveLength(1);
      expect(found[0]!.evidence.log!.codeLocations).toBeUndefined();
    });

    test("fewer than 20 errors in the hour: its messages are not read", async () => {
      logRows = [logHealth({ errorLogCount: 19 })];
      errorPatterns.set(CHECKOUT, [errorPattern()]);

      expect(await LogProblemDetector.look(context())).toEqual([]);
      expect(readErrorPatterns).not.toHaveBeenCalled();
    });
  });

  describe("missing logging: failures that write no log line", () => {
    test("a failing operation none of whose 20 most recent failed requests logged", async () => {
      silentCheckout(failures(20));

      const found: Array<InsightCandidate> =
        await LogProblemDetector.look(context());

      expect(found).toHaveLength(1);

      const candidate: InsightCandidate = found[0]!;
      const evidence: LogInsightEvidence = candidate.evidence.log!;

      expect(candidate.insightType).toBe(AIInsightType.LogMissingLogging);
      expect(candidate.title).toBe(
        "POST /checkout in checkout fails without logging",
      );
      expect(candidate.fingerprint).toBe(
        `log-missing-logging:${CHECKOUT}:SilentFailures:POST /checkout`,
      );
      expect(candidate.severity).toBe(AIInsightSeverity.Medium);
      expect(candidate.traceId).toBe("5bf92f3577b34da6a3ce929d0e0e4700");
      expect(evidence).toMatchObject({
        kind: LogInsightKind.MissingLogging,
        gap: LogLoggingGap.SilentFailures,
        operationName: "POST /checkout",
        operationSpanCount: 2600,
        failedSpanCount: 312,
        failedSampleSize: 20,
        sampleTraceId: "5bf92f3577b34da6a3ce929d0e0e4700",
        tracedLogCount: 17000,
        codeLocations: [
          {
            filePath: "src/checkout/handler.ts",
            functionName: "handleCheckout",
            lineNumber: 77,
          },
        ],
      });
      // What the spans recorded, sanitized: no user's address.
      expect(evidence.error?.exceptionType).toBe("TimeoutError");
      expect(JSON.stringify(evidence)).not.toContain("@example.com");
    });

    test("the newest five minutes are left out, and the service's lines are read for exactly those requests", async () => {
      silentCheckout(failures(20));

      await LogProblemDetector.look(context());

      const query: JSONObject = readSpans.mock.calls[0]![0]
        .query as unknown as JSONObject;
      const between: InBetween<Date> = query[
        "startTime"
      ] as unknown as InBetween<Date>;

      expect(query["statusCode"]).toBe(SpanStatus.Error);
      expect(query["name"]).toBe("POST /checkout");
      expect(String(query["primaryEntityId"])).toBe(CHECKOUT);
      expect(new Date(between.endValue).toISOString()).toBe(
        new Date(
          NOW.getTime() - LOG_INSIGHT_INGEST_GRACE_MINUTES * 60_000,
        ).toISOString(),
      );
      expect(readSpans.mock.calls[0]![0].props).toEqual({ isRoot: true });

      const counted: TraceLogCountsRequest = readTraceLogs.mock.calls[0]![0];

      expect(counted.serviceId.toString()).toBe(CHECKOUT);
      expect(counted.traceIds).toHaveLength(20);
      expect(counted.traceIds[0]).toBe("5bf92f3577b34da6a3ce929d0e0e4700");
    });

    test("one failed request that logged is enough: no finding", async () => {
      silentCheckout(failures(20));
      tracesThatLogged = new Map<string, number>([
        ["5bf92f3577b34da6a3ce929d0e0e4713", 2],
      ]);

      expect(await LogProblemDetector.look(context())).toEqual([]);
    });

    test("failures the code meant - each a fault, no exception - are no finding", async () => {
      silentCheckout(
        Array.from({ length: 20 }, (_value: unknown, index: number) => {
          return failedSpan(index, { fault: true });
        }),
      );

      expect(await LogProblemDetector.look(context())).toEqual([]);
      expect(readTraceLogs).not.toHaveBeenCalled();
    });

    test("too few failed requests to tell: no finding", async () => {
      silentCheckout(failures(4));

      expect(await LogProblemDetector.look(context())).toEqual([]);
    });

    test("a service whose logs carry no trace id is not read for this", async () => {
      silentCheckout(failures(20));
      logRows = [logHealth({ logCount: 18400, tracedLogCount: 40 })];

      const found: Array<InsightCandidate> =
        await LogProblemDetector.look(context());

      expect(readSpans).not.toHaveBeenCalled();
      // Its logs' missing trace context is the finding instead.
      expect(
        found.map((candidate: InsightCandidate): string | undefined => {
          return candidate.evidence.log!.gap;
        }),
      ).toEqual([LogLoggingGap.NoTraceContext]);
    });
  });

  describe("missing logging: logs with no trace context", () => {
    test("a traced service fewer than 1% of whose logs carry a trace id", async () => {
      logRows = [logHealth({ logCount: 8400, tracedLogCount: 12 })];
      spanRows = [spanHealth({ spanCount: 9200 })];

      const found: Array<InsightCandidate> =
        await LogProblemDetector.look(context());

      expect(found).toHaveLength(1);
      expect(found[0]!.title).toBe("checkout's logs carry no trace context");
      expect(found[0]!.severity).toBe(AIInsightSeverity.Low);
      expect(found[0]!.traceId).toBeUndefined();
      expect(found[0]!.evidence.log).toEqual({
        serviceId: CHECKOUT,
        kind: LogInsightKind.MissingLogging,
        gap: LogLoggingGap.NoTraceContext,
        windowStartTime: "2026-10-24T08:00:04.000Z",
        windowEndTime: "2026-10-24T09:00:04.000Z",
        logCount: 8400,
        errorLogCount: 0,
        tracedLogCount: 12,
        serviceSpanCount: 9200,
      });
      // The readings say it all: nothing more is read for it.
      expect(readSpans).not.toHaveBeenCalled();
      expect(readSample).not.toHaveBeenCalled();
    });

    test("a service that sends no spans is not told to link logs to them", async () => {
      logRows = [logHealth({ logCount: 18400, tracedLogCount: 0 })];

      expect(await LogProblemDetector.look(context())).toEqual([]);
    });
  });

  describe("noisy logs", () => {
    function busyCheckout(sample: ServiceLogPatterns): void {
      logRows = [logHealth({ logCount: 48000 })];
      samples.set(CHECKOUT, sample);
    }

    test("one line at 62% of a busy service's lines", async () => {
      busyCheckout({
        sampledLogCount: 48000,
        patterns: [
          {
            pattern: "cache hit for key <uuid>",
            sampleBody:
              "cache hit for key 1f0e9a3c-0000-4000-8000-000000000000",
            count: 29760,
            severities: [LogSeverity.Debug, LogSeverity.Information],
          },
          {
            pattern: "request served in <num> ms",
            sampleBody: "request served in 4 ms",
            count: 9000,
            severities: [LogSeverity.Information],
          },
        ],
      });

      const found: Array<InsightCandidate> =
        await LogProblemDetector.look(context());

      expect(found).toHaveLength(1);
      expect(found[0]!.insightType).toBe(AIInsightType.LogNoisyPattern);
      expect(found[0]!.title).toBe(
        '"cache hit for key <uuid>" is 62% of checkout\'s logs',
      );
      expect(found[0]!.fingerprint).toBe(
        `log-noisy:${CHECKOUT}:cache hit for key <uuid>`,
      );
      expect(found[0]!.severity).toBe(AIInsightSeverity.Low);
      expect(found[0]!.evidence.log).toMatchObject({
        kind: LogInsightKind.Noisy,
        pattern: "cache hit for key <uuid>",
        patternCount: 29760,
        patternPercent: 62,
        sampledLogCount: 48000,
        severities: [LogSeverity.Debug, LogSeverity.Information],
        searchText: "cache hit for key",
      });

      const request: ServiceLogPatternsRequest = readSample.mock.calls[0]![0];

      expect(request.sampleSize).toBe(LOG_INSIGHT_NOISY_SAMPLE_SIZE);
      expect(request.serviceId.toString()).toBe(CHECKOUT);
    });

    test("its share is said to a tenth of a percent", async () => {
      busyCheckout({
        sampledLogCount: 30000,
        patterns: [
          {
            pattern: "heartbeat sent to peer",
            sampleBody: "heartbeat sent to peer",
            count: 10001,
            severities: [LogSeverity.Debug],
          },
        ],
      });

      const found: Array<InsightCandidate> =
        await LogProblemDetector.look(context());

      expect(found[0]!.evidence.log!.patternPercent).toBe(33.3);
    });

    test("the most common line an error: no noisy log", async () => {
      busyCheckout({
        sampledLogCount: 48000,
        patterns: [
          {
            pattern: "write to replica failed",
            sampleBody: "write to replica failed",
            count: 40000,
            severities: [LogSeverity.Error],
          },
        ],
      });

      expect(await LogProblemDetector.look(context())).toEqual([]);
    });
  });

  describe("the look", () => {
    test("one look per scan, shared by the lane's three detectors, each with its own kind", async () => {
      erroringCheckout([errorPattern()]);
      logRows = [
        logHealth({ errorLogCount: 2100, logCount: 48000, tracedLogCount: 0 }),
      ];
      spanRows = [spanHealth({ spanCount: 9200 })];
      samples.set(CHECKOUT, {
        sampledLogCount: 48000,
        patterns: [
          {
            pattern: "cache hit for key <uuid>",
            sampleBody: "cache hit for key 1",
            count: 30000,
            severities: [LogSeverity.Debug],
          },
        ],
      });

      const scan: InsightScanContext = context();
      const detectors: Array<InsightDetector> =
        InsightDetectors.getTelemetryAiDetectors(TelemetryAiLane.Log);

      expect(
        detectors.map((detector: InsightDetector): AIInsightType => {
          return detector.insightType;
        }),
      ).toEqual([
        AIInsightType.LogErrorPattern,
        AIInsightType.LogMissingLogging,
        AIInsightType.LogNoisyPattern,
      ]);
      expect(detectors[0]).toBeInstanceOf(LogErrorPatternDetector);
      expect(detectors[1]).toBeInstanceOf(LogMissingLoggingDetector);
      expect(detectors[2]).toBeInstanceOf(LogNoisyPatternDetector);

      const results: Array<Array<InsightCandidate>> = [];

      for (const detector of detectors) {
        results.push(await detector.detect(scan));
      }

      expect(readLogHealth).toHaveBeenCalledTimes(1);
      expect(readSpanHealth).toHaveBeenCalledTimes(1);
      expect(
        results.map((found: Array<InsightCandidate>): Array<string> => {
          return found.map((candidate: InsightCandidate): string => {
            return candidate.insightType;
          });
        }),
      ).toEqual([
        [AIInsightType.LogErrorPattern],
        [AIInsightType.LogMissingLogging],
        [AIInsightType.LogNoisyPattern],
      ]);

      // A new scan looks again.
      await new LogErrorPatternDetector().detect(context());
      expect(readLogHealth).toHaveBeenCalledTimes(2);
    });

    test("the hour and the project are read as root, scoped to the project", async () => {
      erroringCheckout([errorPattern()]);

      await LogProblemDetector.look(context());

      const logRequest: {
        projectId: ObjectID;
        startTime: Date;
        endTime: Date;
      } = readLogHealth.mock.calls[0]![0];
      const spanRequest: { projectId: ObjectID } =
        readSpanHealth.mock.calls[0]![0];

      expect(logRequest.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(spanRequest.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(logRequest.startTime.toISOString()).toBe(
        "2026-10-24T08:00:04.000Z",
      );
      expect(logRequest.endTime.toISOString()).toBe(NOW.toISOString());
    });

    test("a service whose logs hold a company AI tool's chats is never read", async () => {
      erroringCheckout([errorPattern()]);
      restricted = [CHECKOUT.toUpperCase()];

      expect(await LogProblemDetector.look(context())).toEqual([]);
      expect(readErrorPatterns).not.toHaveBeenCalled();
    });

    test("an id that is not one of the project's services - a host - is never filed", async () => {
      logRows = [logHealth({ primaryEntityId: HOST, errorLogCount: 900 })];
      errorPatterns.set(HOST, [errorPattern()]);

      expect(await LogProblemDetector.look(context())).toEqual([]);
      expect(readErrorPatterns).not.toHaveBeenCalled();
    });

    test("spans that cannot be read cost only what needs them", async () => {
      erroringCheckout([errorPattern()]);
      readSpanHealth.mockRejectedValue(new Error("ClickHouse is restarting"));

      const found: Array<InsightCandidate> =
        await LogProblemDetector.look(context());

      expect(
        found.map((candidate: InsightCandidate): string => {
          return candidate.insightType;
        }),
      ).toEqual([AIInsightType.LogErrorPattern]);
    });

    test("one kind's read failing leaves the others", async () => {
      erroringCheckout([errorPattern()]);
      logRows = [logHealth({ errorLogCount: 2100, logCount: 48000 })];
      samples.set(CHECKOUT, {
        sampledLogCount: 48000,
        patterns: [
          {
            pattern: "cache hit for key <uuid>",
            sampleBody: "cache hit for key 1",
            count: 30000,
            severities: [LogSeverity.Debug],
          },
        ],
      });
      readErrorPatterns.mockRejectedValue(new Error("Too slow"));

      const found: Array<InsightCandidate> =
        await LogProblemDetector.look(context());

      expect(
        found.map((candidate: InsightCandidate): string => {
          return candidate.insightType;
        }),
      ).toEqual([AIInsightType.LogNoisyPattern]);
    });

    test("a look that fails finds nothing, and never throws", async () => {
      readLogHealth.mockRejectedValue(new Error("ClickHouse is down"));

      await expect(LogProblemDetector.look(context())).resolves.toEqual([]);
    });

    test("nothing passes the gates: nothing more is read", async () => {
      logRows = [logHealth({ logCount: 300, errorLogCount: 2 })];

      expect(await LogProblemDetector.look(context())).toEqual([]);
      expect(readErrorPatterns).not.toHaveBeenCalled();
      expect(readSample).not.toHaveBeenCalled();
      expect(readSpans).not.toHaveBeenCalled();
    });
  });

  describe("the pure pieces", () => {
    test("a service's reading joins its spans, none when it sends none", () => {
      expect(
        LogProblemDetector.toServiceReadings({
          logHealth: [
            logHealth({ primaryEntityId: CHECKOUT.toUpperCase() }),
            logHealth({ primaryEntityId: BILLING }),
            logHealth({ primaryEntityId: "" }),
          ],
          spanHealth: [
            spanHealth({ primaryEntityId: CHECKOUT, failedSpanCount: 30 }),
          ],
        }),
      ).toEqual([
        {
          serviceId: CHECKOUT,
          logCount: 5000,
          errorLogCount: 0,
          tracedLogCount: 4000,
          spanCount: 3000,
          failedSpanCount: 30,
        },
        {
          serviceId: BILLING,
          logCount: 5000,
          errorLogCount: 0,
          tracedLogCount: 4000,
          spanCount: 0,
          failedSpanCount: 0,
        },
      ]);
    });

    test("code locations: one each, with real line numbers, never an empty file", () => {
      expect(
        LogProblemDetector.toCodeLocations([
          {
            filePath: "src/a.py",
            functionName: "f",
            lineNumber: "12",
            count: 4,
          },
          {
            filePath: "src/a.py",
            functionName: "f",
            lineNumber: "12",
            count: 2,
          },
          { filePath: "src/b.py", functionName: "", lineNumber: "x", count: 1 },
          { filePath: " ", functionName: "g", lineNumber: "3", count: 1 },
          {
            filePath: "src/c.py",
            functionName: "h",
            lineNumber: "0",
            count: 1,
          },
        ]),
      ).toEqual([
        { filePath: "src/a.py", functionName: "f", lineNumber: 12 },
        { filePath: "src/b.py" },
        { filePath: "src/c.py", functionName: "h" },
      ]);
    });

    test("a pattern is sanitized as an exception message is", () => {
      expect(
        LogProblemDetector.sanitizePattern(
          "Upload failed: Bearer abcdefghijklmnopqrstuvwxyz0123",
        ),
      ).not.toContain("abcdefghijklmnopqrstuvwxyz");
      expect(LogProblemDetector.sanitizePattern("  Disk full on <ip>  ")).toBe(
        "Disk full on <ip>",
      );
    });

    test("search words: the sanitized pattern's longest run the line holds as written", () => {
      expect(
        LogProblemDetector.getSearchText({
          pattern: "Payment provider returned <num>: card declined",
          sampleBody: "Payment provider returned 402: card declined",
        }),
      ).toBe("Payment provider returned");
      // Too short to narrow a search.
      expect(
        LogProblemDetector.getSearchText({
          pattern: "short <num> x",
          sampleBody: "short 4 x",
        }),
      ).toBe("");
      // What the sanitizer masks is never searched for.
      expect(
        LogProblemDetector.getSearchText({
          pattern: "cache miss for user_abcdefghij",
          sampleBody: "cache miss for user_abcdefghij",
        }),
      ).toBe("cache miss for");
      // A run across a collapsed line break is not in the line: one word is.
      expect(
        LogProblemDetector.getSearchText({
          pattern: "upstream connection closed early",
          sampleBody: "upstream connection\n  closed early",
        }),
      ).toBe("connection");
      expect(
        LogProblemDetector.getSearchText({ pattern: "", sampleBody: "" }),
      ).toBe("");
    });
  });
});
