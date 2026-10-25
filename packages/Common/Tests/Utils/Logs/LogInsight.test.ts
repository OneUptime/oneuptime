/*
 * The gates Logs' AI section files its findings by (Utils/Logs/LogInsight):
 * which services are read, which of a service's messages are error logs
 * worth a pull request and which one floods its logs, when a failing
 * operation's requests failed without a log line, when a service's logs
 * carry no trace context - and what each finding is called, how severe it
 * is, what it says on the insight, and what OneUptime asks the AI for it,
 * never copying a log line as it was logged.
 */

import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../Types/AI/AIInsightType";
import { LogInsightEvidence } from "../../../Types/AI/AIInsightEvidence";
import {
  TELEMETRY_AI_LANES,
  TelemetryAiLane,
} from "../../../Types/AI/TelemetryAi";
import LogSeverity from "../../../Types/Log/LogSeverity";
import {
  FailedRequestLogsReading,
  LOG_FIX_PRIVACY_RULE,
  LOG_INSIGHT_ERROR_PATTERNS_PER_SERVICE,
  LOG_INSIGHT_ERROR_SEVERITIES,
  LOG_INSIGHT_FAILED_SAMPLE_SIZE,
  LOG_INSIGHT_FINGERPRINT_PREFIXES,
  LOG_INSIGHT_HIGH_ERROR_PATTERN_COUNT,
  LOG_INSIGHT_HIGH_NOISY_PATTERN_LOGS,
  LOG_INSIGHT_HIGH_NOISY_PERCENT,
  LOG_INSIGHT_INGEST_GRACE_MINUTES,
  LOG_INSIGHT_MASKED_TOKEN,
  LOG_INSIGHT_MAX_ERROR_SERVICES,
  LOG_INSIGHT_MAX_NOISY_SERVICES,
  LOG_INSIGHT_MAX_SILENT_FAILURE_SERVICES,
  LOG_INSIGHT_MAX_TRACE_CONTEXT_PERCENT,
  LOG_INSIGHT_MAX_TRACE_CONTEXT_SERVICES,
  LOG_INSIGHT_MIN_ERROR_LOGS,
  LOG_INSIGHT_MIN_ERROR_PATTERN_COUNT,
  LOG_INSIGHT_MIN_FAILED_SAMPLE_SIZE,
  LOG_INSIGHT_MIN_NOISY_PATTERN_LOGS,
  LOG_INSIGHT_MIN_NOISY_PERCENT,
  LOG_INSIGHT_MIN_NOISY_SERVICE_LOGS,
  LOG_INSIGHT_MIN_PATTERN_WORDS,
  LOG_INSIGHT_MIN_TRACE_CONTEXT_LOGS,
  LOG_INSIGHT_MIN_TRACE_CONTEXT_SPANS,
  LOG_INSIGHT_MIN_TRACED_LOGS,
  LOG_INSIGHT_NOISY_SAMPLE_SIZE,
  LOG_INSIGHT_STACK_TRACE_LINES,
  LOG_INSIGHT_TITLE_PATTERN_LENGTH,
  LOG_INSIGHT_TOKEN_RUN_LENGTH,
  LOG_INSIGHT_TYPE_BY_KIND,
  LOG_INSIGHT_WINDOW_MINUTES,
  LogInsightKind,
  LogLoggingGap,
  LogNoisyPatternFinding,
  LogPatternReading,
  LogServiceReading,
  LogSilenceVerdict,
  buildLogFixEvidenceNote,
  buildLogFixRequestMessage,
  buildLogInsightDetail,
  describeLogProblem,
  describeLogSeverities,
  getLogFixRequestTitle,
  getLogInsightFingerprint,
  getLogInsightSeverity,
  getLogInsightStackTrace,
  getLogInsightTitle,
  getLogInsightWindow,
  getPatternWords,
  getTracedLogPercent,
  hasPatternWords,
  isLogInsightFingerprintOfService,
  isLogInsightKind,
  isLogLoggingGap,
  isMissingTraceContext,
  maskLogPatternTokens,
  pickErrorLogServices,
  pickErrorPatterns,
  pickNoTraceContextServices,
  pickNoisyLogServices,
  pickNoisyPattern,
  pickSilentFailureServices,
  readFailedRequestLogs,
  shortenLogPattern,
  toSilentFailureError,
} from "../../../Utils/Logs/LogInsight";
import {
  TRACE_INSIGHT_MIN_FAILED_SPANS,
  TRACE_INSIGHT_FINGERPRINT_PREFIXES,
} from "../../../Utils/Traces/TraceInsight";
import { describe, expect, test } from "@jest/globals";

const SERVICE_A: string = "5a000000-0000-4000-8000-0000000000a1";
const SERVICE_B: string = "5a000000-0000-4000-8000-0000000000a2";
const SERVICE_C: string = "5a000000-0000-4000-8000-0000000000a3";
const SERVICE_D: string = "5a000000-0000-4000-8000-0000000000a4";

const WINDOW: { windowStartTime: string; windowEndTime: string } = {
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
};

function reading(
  overrides: Partial<LogServiceReading> = {},
): LogServiceReading {
  return {
    serviceId: SERVICE_A,
    logCount: 0,
    errorLogCount: 0,
    tracedLogCount: 0,
    spanCount: 0,
    failedSpanCount: 0,
    ...overrides,
  };
}

function pattern(
  overrides: Partial<LogPatternReading> = {},
): LogPatternReading {
  return {
    pattern: "Payment provider returned <num>",
    count: 100,
    severities: [LogSeverity.Error],
    searchText: "Payment provider returned",
    traceCount: 0,
    sampleTraceIds: [],
    hasException: false,
    ...overrides,
  };
}

function errorEvidence(
  overrides: Partial<LogInsightEvidence> = {},
): LogInsightEvidence {
  return {
    serviceId: SERVICE_A,
    kind: LogInsightKind.Error,
    ...WINDOW,
    logCount: 18400,
    errorLogCount: 2100,
    pattern: "Payment provider returned <num>: card declined for order <uuid>",
    patternCount: 1240,
    severities: [LogSeverity.Error],
    searchText: "Payment provider returned",
    traceCount: 312,
    sampleTraceIds: ["4bf92f3577b34da6a3ce929d0e0e4736"],
    codeLocations: [
      {
        filePath: "src/payments/client.py",
        functionName: "charge",
        lineNumber: 88,
      },
    ],
    ...overrides,
  };
}

function noisyEvidence(
  overrides: Partial<LogInsightEvidence> = {},
): LogInsightEvidence {
  return {
    serviceId: SERVICE_A,
    kind: LogInsightKind.Noisy,
    ...WINDOW,
    logCount: 48000,
    errorLogCount: 12,
    pattern: "cache hit for key <uuid>",
    patternCount: 29760,
    patternPercent: 62,
    sampledLogCount: 48000,
    severities: [LogSeverity.Debug, LogSeverity.Information],
    searchText: "cache hit for key",
    ...overrides,
  };
}

function silentEvidence(
  overrides: Partial<LogInsightEvidence> = {},
): LogInsightEvidence {
  return {
    serviceId: SERVICE_A,
    kind: LogInsightKind.MissingLogging,
    gap: LogLoggingGap.SilentFailures,
    ...WINDOW,
    logCount: 18400,
    tracedLogCount: 17000,
    operationName: "POST /checkout",
    operationSpanCount: 2600,
    failedSpanCount: 312,
    failedSampleSize: 20,
    sampleTraceId: "5bf92f3577b34da6a3ce929d0e0e4737",
    error: {
      exceptionType: "TimeoutError",
      exceptionMessage: "payment provider did not answer",
      sampleMatches: 18,
      sampleSize: 20,
    },
    ...overrides,
  };
}

function noTraceEvidence(
  overrides: Partial<LogInsightEvidence> = {},
): LogInsightEvidence {
  return {
    serviceId: SERVICE_A,
    kind: LogInsightKind.MissingLogging,
    gap: LogLoggingGap.NoTraceContext,
    ...WINDOW,
    logCount: 18400,
    tracedLogCount: 12,
    serviceSpanCount: 9200,
    ...overrides,
  };
}

describe("the gates, as the docs state them", () => {
  test("one hour is read, as the Logs viewer opens on", () => {
    expect(LOG_INSIGHT_WINDOW_MINUTES).toBe(60);

    const now: Date = new Date("2026-10-24T09:00:00.000Z");

    expect(getLogInsightWindow(now)).toEqual({
      startTime: new Date("2026-10-24T08:00:00.000Z"),
      endTime: now,
    });
  });

  test("error logs: 20 lines of one message, of a service with 20 errors, Error or Fatal", () => {
    expect(LOG_INSIGHT_MIN_ERROR_LOGS).toBe(20);
    expect(LOG_INSIGHT_MIN_ERROR_PATTERN_COUNT).toBe(20);
    expect([...LOG_INSIGHT_ERROR_SEVERITIES]).toEqual([
      LogSeverity.Error,
      LogSeverity.Fatal,
    ]);
    expect(LOG_INSIGHT_MAX_ERROR_SERVICES).toBe(3);
    expect(LOG_INSIGHT_ERROR_PATTERNS_PER_SERVICE).toBe(2);
    expect(LOG_INSIGHT_MIN_PATTERN_WORDS).toBe(2);
  });

  test("silent failures: the Traces lane's failing gate, linked logs, 20 failed requests read", () => {
    expect(TRACE_INSIGHT_MIN_FAILED_SPANS).toBe(20);
    expect(LOG_INSIGHT_MIN_TRACED_LOGS).toBe(100);
    expect(LOG_INSIGHT_FAILED_SAMPLE_SIZE).toBe(20);
    expect(LOG_INSIGHT_MIN_FAILED_SAMPLE_SIZE).toBe(5);
    expect(LOG_INSIGHT_INGEST_GRACE_MINUTES).toBe(5);
    expect(LOG_INSIGHT_MAX_SILENT_FAILURE_SERVICES).toBe(3);
  });

  test("no trace context: 500 logs, 100 spans, under 1% with a trace id", () => {
    expect(LOG_INSIGHT_MIN_TRACE_CONTEXT_LOGS).toBe(500);
    expect(LOG_INSIGHT_MIN_TRACE_CONTEXT_SPANS).toBe(100);
    expect(LOG_INSIGHT_MAX_TRACE_CONTEXT_PERCENT).toBe(1);
    expect(LOG_INSIGHT_MAX_TRACE_CONTEXT_SERVICES).toBe(3);
  });

  test("noisy logs: 25% of a service's 10,000 lines, read off 100,000", () => {
    expect(LOG_INSIGHT_MIN_NOISY_SERVICE_LOGS).toBe(10000);
    expect(LOG_INSIGHT_MIN_NOISY_PATTERN_LOGS).toBe(10000);
    expect(LOG_INSIGHT_MIN_NOISY_PERCENT).toBe(25);
    expect(LOG_INSIGHT_NOISY_SAMPLE_SIZE).toBe(100000);
    expect(LOG_INSIGHT_MAX_NOISY_SERVICES).toBe(3);
  });

  test("each kind is the lane's insight type, in the lane's order", () => {
    expect([
      LOG_INSIGHT_TYPE_BY_KIND[LogInsightKind.Error],
      LOG_INSIGHT_TYPE_BY_KIND[LogInsightKind.MissingLogging],
      LOG_INSIGHT_TYPE_BY_KIND[LogInsightKind.Noisy],
    ]).toEqual([...TELEMETRY_AI_LANES[TelemetryAiLane.Log].insightTypes]);
    expect(LOG_INSIGHT_TYPE_BY_KIND[LogInsightKind.Error]).toBe(
      AIInsightType.LogErrorPattern,
    );
  });

  test("kinds and gaps are read exactly", () => {
    expect(isLogInsightKind("Error")).toBe(true);
    expect(isLogInsightKind("MissingLogging")).toBe(true);
    expect(isLogInsightKind("Noisy")).toBe(true);
    expect(isLogInsightKind("error")).toBe(false);
    expect(isLogInsightKind("Slow")).toBe(false);
    expect(isLogInsightKind(undefined)).toBe(false);
    expect(isLogLoggingGap("SilentFailures")).toBe(true);
    expect(isLogLoggingGap("NoTraceContext")).toBe(true);
    expect(isLogLoggingGap("NoChildSpans")).toBe(false);
    expect(isLogLoggingGap(7)).toBe(false);
  });
});

describe("stage one: which services are read", () => {
  test("the share of logs with a trace id, never above all of them", () => {
    expect(getTracedLogPercent({ logCount: 0, tracedLogCount: 0 })).toBe(0);
    expect(getTracedLogPercent({ logCount: 200, tracedLogCount: 50 })).toBe(25);
    expect(getTracedLogPercent({ logCount: 100, tracedLogCount: 500 })).toBe(
      100,
    );
    expect(getTracedLogPercent({ logCount: 100, tracedLogCount: -4 })).toBe(0);
    expect(getTracedLogPercent({ logCount: NaN, tracedLogCount: 4 })).toBe(0);
  });

  test("error services: from 20 errors, the most errors first, three at most", () => {
    const readings: Array<LogServiceReading> = [
      reading({ serviceId: SERVICE_A, errorLogCount: 19, logCount: 9000 }),
      reading({ serviceId: SERVICE_B, errorLogCount: 20, logCount: 100 }),
      reading({ serviceId: SERVICE_C, errorLogCount: 900, logCount: 1000 }),
      reading({ serviceId: SERVICE_D, errorLogCount: 300, logCount: 1000 }),
      reading({
        serviceId: "5a000000-0000-4000-8000-0000000000a5",
        errorLogCount: 25,
      }),
    ];

    expect(pickErrorLogServices(readings)).toEqual([
      SERVICE_C,
      SERVICE_D,
      "5a000000-0000-4000-8000-0000000000a5",
    ]);
    expect(pickErrorLogServices(readings).includes(SERVICE_A)).toBe(false);
  });

  test("ties fall to volume, then to the id; ids are read lower-case", () => {
    const readings: Array<LogServiceReading> = [
      reading({
        serviceId: SERVICE_B.toUpperCase(),
        errorLogCount: 50,
        logCount: 10,
      }),
      reading({ serviceId: SERVICE_A, errorLogCount: 50, logCount: 10 }),
      reading({ serviceId: SERVICE_C, errorLogCount: 50, logCount: 20 }),
    ];

    expect(pickErrorLogServices(readings)).toEqual([
      SERVICE_C,
      SERVICE_A,
      SERVICE_B,
    ]);
  });

  test("a service whose logs hold a company AI tool's chats is never read", () => {
    const readings: Array<LogServiceReading> = [
      reading({ serviceId: SERVICE_A, errorLogCount: 500, logCount: 20000 }),
      reading({ serviceId: SERVICE_B, errorLogCount: 50, logCount: 20000 }),
    ];
    const excluded: Set<string> = new Set<string>([SERVICE_A]);

    expect(pickErrorLogServices(readings, excluded)).toEqual([SERVICE_B]);
    expect(pickNoisyLogServices(readings, excluded)).toEqual([SERVICE_B]);
  });

  test("a reading with no service id is never read", () => {
    expect(
      pickErrorLogServices([reading({ serviceId: "  ", errorLogCount: 500 })]),
    ).toEqual([]);
  });

  test("no trace context: busy, traced, and under 1% of logs with a trace id", () => {
    const busy: LogServiceReading = reading({
      logCount: 500,
      spanCount: 100,
      tracedLogCount: 4,
    });

    expect(isMissingTraceContext(busy)).toBe(true);
    expect(isMissingTraceContext({ ...busy, logCount: 499 })).toBe(false);
    expect(isMissingTraceContext({ ...busy, spanCount: 99 })).toBe(false);
    // Exactly 1% is linked enough.
    expect(isMissingTraceContext({ ...busy, tracedLogCount: 5 })).toBe(false);
    expect(
      isMissingTraceContext({ ...busy, logCount: 1000, tracedLogCount: 9 }),
    ).toBe(true);
  });

  test("no trace context services: the busiest first, three at most", () => {
    const readings: Array<LogServiceReading> = [
      reading({ serviceId: SERVICE_A, logCount: 600, spanCount: 500 }),
      reading({ serviceId: SERVICE_B, logCount: 9000, spanCount: 500 }),
      reading({ serviceId: SERVICE_C, logCount: 700, spanCount: 500 }),
      reading({ serviceId: SERVICE_D, logCount: 800, spanCount: 500 }),
      // Its logs are linked: not one of them.
      reading({
        serviceId: "5a000000-0000-4000-8000-0000000000a5",
        logCount: 100000,
        spanCount: 500,
        tracedLogCount: 90000,
      }),
    ];

    expect(pickNoTraceContextServices(readings)).toEqual([
      SERVICE_B,
      SERVICE_D,
      SERVICE_C,
    ]);
  });

  test("silent failures: failing, with linked logs, never a service whose logs carry no trace context", () => {
    const readings: Array<LogServiceReading> = [
      reading({
        serviceId: SERVICE_A,
        logCount: 5000,
        tracedLogCount: 4000,
        spanCount: 3000,
        failedSpanCount: 20,
      }),
      // Too few failures.
      reading({
        serviceId: SERVICE_B,
        logCount: 5000,
        tracedLogCount: 4000,
        spanCount: 3000,
        failedSpanCount: 19,
      }),
      // Too few linked logs to tell a silent request from an unlinked one.
      reading({
        serviceId: SERVICE_C,
        logCount: 5000,
        tracedLogCount: 99,
        spanCount: 3000,
        failedSpanCount: 900,
      }),
      /*
       * 100 linked logs, but under 1% of 20,000: its logs carry no trace
       * context, which is the finding instead.
       */
      reading({
        serviceId: SERVICE_D,
        logCount: 20000,
        tracedLogCount: 150,
        spanCount: 3000,
        failedSpanCount: 900,
      }),
    ];

    expect(pickSilentFailureServices(readings)).toEqual([SERVICE_A]);
    expect(pickNoTraceContextServices(readings)).toEqual([SERVICE_D]);
  });

  test("silent failure services: the most failures first, three at most", () => {
    const linked: Partial<LogServiceReading> = {
      logCount: 5000,
      tracedLogCount: 4000,
      spanCount: 9000,
    };
    const readings: Array<LogServiceReading> = [
      reading({ ...linked, serviceId: SERVICE_A, failedSpanCount: 30 }),
      reading({ ...linked, serviceId: SERVICE_B, failedSpanCount: 300 }),
      reading({ ...linked, serviceId: SERVICE_C, failedSpanCount: 40 }),
      reading({ ...linked, serviceId: SERVICE_D, failedSpanCount: 50 }),
    ];

    expect(pickSilentFailureServices(readings)).toEqual([
      SERVICE_B,
      SERVICE_D,
      SERVICE_C,
    ]);
  });

  test("noisy services: from 10,000 lines, the busiest first, three at most", () => {
    const readings: Array<LogServiceReading> = [
      reading({ serviceId: SERVICE_A, logCount: 9999 }),
      reading({ serviceId: SERVICE_B, logCount: 10000 }),
      reading({ serviceId: SERVICE_C, logCount: 400000 }),
      reading({ serviceId: SERVICE_D, logCount: 20000 }),
      reading({
        serviceId: "5a000000-0000-4000-8000-0000000000a5",
        logCount: 15000,
      }),
    ];

    expect(pickNoisyLogServices(readings)).toEqual([
      SERVICE_C,
      SERVICE_D,
      "5a000000-0000-4000-8000-0000000000a5",
    ]);
  });
});

describe("a message's own words", () => {
  test("words of two or more letters, outside the masked values", () => {
    expect(getPatternWords("Payment provider returned <num>")).toBe(3);
    expect(getPatternWords("<num> <uuid> <url>")).toBe(0);
    expect(getPatternWords("error")).toBe(1);
    expect(getPatternWords("Error <num>")).toBe(1);
    expect(getPatternWords("a b c")).toBe(0);
    expect(getPatternWords("")).toBe(0);
    expect(getPatternWords(undefined)).toBe(0);
  });

  test("the sanitizer's placeholders and masked tokens are not words", () => {
    expect(getPatternWords("<SERVICE_ID> <UUID> <token>")).toBe(0);
    expect(getPatternWords("token <token> expired")).toBe(2);
  });

  test("letters of any language count", () => {
    expect(getPatternWords("Zahlung fehlgeschlagen")).toBe(2);
    expect(getPatternWords("Ошибка подключения")).toBe(2);
    // Written without spaces: a word in every two characters.
    expect(getPatternWords("決済に失敗しました")).toBeGreaterThanOrEqual(2);
    expect(getPatternWords("失敗")).toBe(1);
  });

  test("a message needs two words of its own to be filed", () => {
    expect(hasPatternWords("Connection refused")).toBe(true);
    expect(hasPatternWords("決済に失敗しました")).toBe(true);
    expect(hasPatternWords("error")).toBe(false);
    expect(hasPatternWords("<num>")).toBe(false);
    expect(hasPatternWords("失敗")).toBe(false);
  });
});

describe("what is left of a token is masked", () => {
  test("a long run with digits or masked values inside it", () => {
    expect(
      maskLogPatternTokens(
        "auth failed for eyJhbGciOiJIUzI<num>NiIsInR<num>cCI<num>IkpXVCJ<num> at login",
      ),
    ).toBe(`auth failed for ${LOG_INSIGHT_MASKED_TOKEN} at login`);
    expect(
      maskLogPatternTokens("key AKIAIOSFODNN7EXAMPLEAKIAIOSFODNN7 rejected"),
    ).toBe(`key ${LOG_INSIGHT_MASKED_TOKEN} rejected`);
  });

  test("code identifiers and ordinary words stay", () => {
    const message: string =
      "OrderProcessingServiceImplementation.process failed for <uuid>";

    expect(maskLogPatternTokens(message)).toBe(message);
    expect(maskLogPatternTokens("short a1b2 token")).toBe("short a1b2 token");
  });

  test("a run just short of the length stays", () => {
    const run: string = `${"a".repeat(LOG_INSIGHT_TOKEN_RUN_LENGTH - 2)}1`;

    expect(maskLogPatternTokens(`x ${run} y`)).toBe(`x ${run} y`);
    expect(maskLogPatternTokens(`x ${run}23 y`)).toBe(
      `x ${LOG_INSIGHT_MASKED_TOKEN} y`,
    );
  });

  test("nothing in, nothing out", () => {
    expect(maskLogPatternTokens("")).toBe("");
  });

  /*
   * A log line is whatever the code wrote: the mask must take time in line
   * with the length of the worst text, never with its square.
   */
  test("reads 400,000 characters of its worst text in under 2 seconds", () => {
    const worst: Array<string> = [
      "a".repeat(400_000),
      "a1".repeat(200_000),
      `${"a".repeat(23)} `.repeat(16_000),
      "<".repeat(400_000),
    ];

    for (const text of worst) {
      const started: number = Date.now();

      maskLogPatternTokens(text);
      getPatternWords(text);

      expect(Date.now() - started).toBeLessThan(2000);
    }
  });
});

describe("stage two: a service's error logs", () => {
  test("filed from 20 lines of one message, the most lines first, two at most", () => {
    const picked: Array<LogPatternReading> = pickErrorPatterns([
      pattern({ pattern: "Payment provider returned <num>", count: 19 }),
      pattern({ pattern: "Order sync failed for <uuid>", count: 20 }),
      pattern({ pattern: "Database connection reset by peer", count: 900 }),
      pattern({ pattern: "Cache write rejected by redis", count: 300 }),
    ]);

    expect(
      picked.map((row: LogPatternReading): string => {
        return row.pattern;
      }),
    ).toEqual([
      "Database connection reset by peer",
      "Cache write rejected by redis",
    ]);
  });

  test("an error with an exception is the Exceptions product's, not an error log", () => {
    expect(
      pickErrorPatterns([
        pattern({
          pattern: "TypeError: x is undefined at y",
          hasException: true,
        }),
      ]),
    ).toEqual([]);
  });

  test("a message with no words of its own is not filed", () => {
    expect(
      pickErrorPatterns([
        pattern({ pattern: "error", count: 5000 }),
        pattern({ pattern: "<num> <uuid>", count: 5000 }),
        pattern({ pattern: "", count: 5000 }),
      ]),
    ).toEqual([]);
  });

  test("ties fall to the message, so a look is deterministic", () => {
    const picked: Array<LogPatternReading> = pickErrorPatterns([
      pattern({ pattern: "zeta write failed", count: 50 }),
      pattern({ pattern: "alpha write failed", count: 50 }),
    ]);

    expect(picked[0]!.pattern).toBe("alpha write failed");
  });
});

describe("stage two: a busy service's noisy log", () => {
  const debug: Array<string> = [LogSeverity.Debug];

  test("the message with the most lines, at 25% or more and some 10,000 lines", () => {
    const finding: LogNoisyPatternFinding | null = pickNoisyPattern({
      readings: [
        pattern({
          pattern: "cache hit for key <uuid>",
          count: 30000,
          severities: debug,
        }),
        pattern({
          pattern: "request served in <num> ms",
          count: 20000,
          severities: debug,
        }),
      ],
      sampledLogCount: 100000,
      logCount: 400000,
    });

    expect(finding).not.toBeNull();
    expect(finding!.reading.pattern).toBe("cache hit for key <uuid>");
    expect(finding!.percent).toBe(30);
    // 30% of the service's 400,000 lines of the hour.
    expect(finding!.estimatedCount).toBe(120000);
  });

  test("below 25% of the lines read, it is not noisy", () => {
    expect(
      pickNoisyPattern({
        readings: [
          pattern({
            pattern: "cache hit for key",
            count: 24999,
            severities: debug,
          }),
        ],
        sampledLogCount: 100000,
        logCount: 1000000,
      }),
    ).toBeNull();
    expect(
      pickNoisyPattern({
        readings: [
          pattern({
            pattern: "cache hit for key",
            count: 25000,
            severities: debug,
          }),
        ],
        sampledLogCount: 100000,
        logCount: 1000000,
      }),
    ).not.toBeNull();
  });

  test("under some 10,000 lines of the hour, it is not noisy, whatever its share", () => {
    expect(
      pickNoisyPattern({
        readings: [
          pattern({
            pattern: "cache hit for key",
            count: 9000,
            severities: debug,
          }),
        ],
        sampledLogCount: 10000,
        logCount: 10000,
      }),
    ).toBeNull();
    expect(
      pickNoisyPattern({
        readings: [
          pattern({
            pattern: "cache hit for key",
            count: 5000,
            severities: debug,
          }),
        ],
        sampledLogCount: 10000,
        logCount: 20000,
      })!.estimatedCount,
    ).toBe(10000);
  });

  test("an error is an error log, never a noisy one", () => {
    expect(
      pickNoisyPattern({
        readings: [
          pattern({
            pattern: "write failed for key",
            count: 90000,
            severities: [LogSeverity.Warning, LogSeverity.Error],
          }),
        ],
        sampledLogCount: 100000,
        logCount: 100000,
      }),
    ).toBeNull();
    // A Fatal one too; the next message down is read instead.
    expect(
      pickNoisyPattern({
        readings: [
          pattern({
            pattern: "shutting down now",
            count: 60000,
            severities: [LogSeverity.Fatal],
          }),
          pattern({
            pattern: "heartbeat sent to peer",
            count: 30000,
            severities: [LogSeverity.Information],
          }),
        ],
        sampledLogCount: 100000,
        logCount: 100000,
      })!.reading.pattern,
    ).toBe("heartbeat sent to peer");
  });

  test("a message whose severity was not read, or with no words, is not filed", () => {
    expect(
      pickNoisyPattern({
        readings: [
          pattern({
            pattern: "cache hit for key",
            count: 90000,
            severities: [],
          }),
          pattern({ pattern: "<num>", count: 90000, severities: debug }),
        ],
        sampledLogCount: 100000,
        logCount: 100000,
      }),
    ).toBeNull();
  });

  test("a quiet service, or a sample that read nothing, has none", () => {
    const readings: Array<LogPatternReading> = [
      pattern({ pattern: "cache hit for key", count: 9000, severities: debug }),
    ];

    expect(
      pickNoisyPattern({ readings, sampledLogCount: 10000, logCount: 9999 }),
    ).toBeNull();
    expect(
      pickNoisyPattern({ readings, sampledLogCount: 0, logCount: 100000 }),
    ).toBeNull();
  });

  test("a count above the sample is read as all of it", () => {
    expect(
      pickNoisyPattern({
        readings: [
          pattern({
            pattern: "cache hit for key",
            count: 120,
            severities: debug,
          }),
        ],
        sampledLogCount: 100,
        logCount: 20000,
      })!.percent,
    ).toBe(100);
  });
});

describe("whether a failing operation's failed requests wrote a log line", () => {
  const traces: Array<string> = [
    "A1000000000000000000000000000001",
    "a1000000000000000000000000000002",
    "a1000000000000000000000000000003",
    "a1000000000000000000000000000004",
    "a1000000000000000000000000000005",
  ];

  test("silent when none of them did, with the first as the one to start from", () => {
    const silence: FailedRequestLogsReading = readFailedRequestLogs({
      failedTraceIds: traces,
      logCountsByTraceId: new Map<string, number>(),
    });

    expect(silence).toEqual({
      verdict: LogSilenceVerdict.Silent,
      sampleSize: 5,
      sampleTraceId: "a1000000000000000000000000000001",
    });
  });

  test("logged when one of them did - its trace ids read in any case", () => {
    expect(
      readFailedRequestLogs({
        failedTraceIds: traces,
        logCountsByTraceId: new Map<string, number>([
          ["A1000000000000000000000000000005", 2],
        ]),
      }).verdict,
    ).toBe(LogSilenceVerdict.Logged);
  });

  test("a trace another request logged in does not count", () => {
    expect(
      readFailedRequestLogs({
        failedTraceIds: traces,
        logCountsByTraceId: new Map<string, number>([
          ["b1000000000000000000000000000009", 40],
        ]),
      }).verdict,
    ).toBe(LogSilenceVerdict.Silent);
  });

  test("too few requests to tell - four, or one request read four times - is unread", () => {
    expect(
      readFailedRequestLogs({
        failedTraceIds: traces.slice(0, 4),
        logCountsByTraceId: new Map<string, number>(),
      }).verdict,
    ).toBe(LogSilenceVerdict.Unread);
    expect(
      readFailedRequestLogs({
        failedTraceIds: [
          traces[0]!,
          traces[0]!,
          traces[0]!,
          traces[0]!,
          traces[0]!,
          "",
        ],
        logCountsByTraceId: new Map<string, number>(),
      }),
    ).toEqual({
      verdict: LogSilenceVerdict.Unread,
      sampleSize: 1,
      sampleTraceId: null,
    });
  });

  test("at most twenty requests are read", () => {
    const many: Array<string> = Array.from(
      { length: 30 },
      (_value: unknown, index: number): string => {
        return `c${String(index).padStart(31, "0")}`;
      },
    );

    expect(
      readFailedRequestLogs({
        failedTraceIds: many,
        logCountsByTraceId: new Map<string, number>([[many[25]!, 3]]),
      }),
    ).toEqual({
      verdict: LogSilenceVerdict.Silent,
      sampleSize: LOG_INSIGHT_FAILED_SAMPLE_SIZE,
      sampleTraceId: many[0],
    });
  });
});

describe("a finding's identity", () => {
  test("its kind, its service and its message", () => {
    expect(
      getLogInsightFingerprint({
        kind: LogInsightKind.Error,
        serviceId: SERVICE_A.toUpperCase(),
        pattern: "Payment provider returned <num>",
      }),
    ).toBe(`log-error:${SERVICE_A}:Payment provider returned <num>`);
    expect(
      getLogInsightFingerprint({
        kind: LogInsightKind.Noisy,
        serviceId: SERVICE_A,
        pattern: "cache hit for key <uuid>",
      }),
    ).toBe(`log-noisy:${SERVICE_A}:cache hit for key <uuid>`);
  });

  test("missing logging: its gap and its operation, with ids collapsed", () => {
    expect(
      getLogInsightFingerprint({
        kind: LogInsightKind.MissingLogging,
        serviceId: SERVICE_A,
        gap: LogLoggingGap.SilentFailures,
        operationName: "GET /orders/42",
      }),
    ).toBe(
      getLogInsightFingerprint({
        kind: LogInsightKind.MissingLogging,
        serviceId: SERVICE_A,
        gap: LogLoggingGap.SilentFailures,
        operationName: "GET /orders/97",
      }),
    );
    expect(
      getLogInsightFingerprint({
        kind: LogInsightKind.MissingLogging,
        serviceId: SERVICE_A,
        gap: LogLoggingGap.NoTraceContext,
      }),
    ).toBe(`log-missing-logging:${SERVICE_A}:NoTraceContext:`);
  });

  test("the same message in two services is two findings", () => {
    expect(
      getLogInsightFingerprint({
        kind: LogInsightKind.Error,
        serviceId: SERVICE_A,
        pattern: "write failed",
      }),
    ).not.toBe(
      getLogInsightFingerprint({
        kind: LogInsightKind.Error,
        serviceId: SERVICE_B,
        pattern: "write failed",
      }),
    );
  });

  test("a fingerprint tells which service it is about, and nothing else's", () => {
    const fingerprint: string = getLogInsightFingerprint({
      kind: LogInsightKind.Noisy,
      serviceId: SERVICE_A,
      pattern: "cache hit",
    });

    expect(isLogInsightFingerprintOfService(fingerprint, SERVICE_A)).toBe(true);
    expect(
      isLogInsightFingerprintOfService(fingerprint, SERVICE_A.toUpperCase()),
    ).toBe(true);
    expect(isLogInsightFingerprintOfService(fingerprint, SERVICE_B)).toBe(
      false,
    );
    // A prefix of the id is another service.
    expect(
      isLogInsightFingerprintOfService(fingerprint, SERVICE_A.slice(0, 10)),
    ).toBe(false);
    expect(isLogInsightFingerprintOfService(fingerprint, "")).toBe(false);
    // A trace finding's fingerprint is not a log finding's.
    expect(
      isLogInsightFingerprintOfService(
        `${TRACE_INSIGHT_FINGERPRINT_PREFIXES.slow}:${SERVICE_A}:GET /`,
        SERVICE_A,
      ),
    ).toBe(false);
    expect(Object.values(LOG_INSIGHT_FINGERPRINT_PREFIXES)).toEqual([
      "log-error",
      "log-missing-logging",
      "log-noisy",
    ]);
  });
});

describe("how a finding reads", () => {
  test("a message is shortened to a line for a title", () => {
    const long: string = `${"word ".repeat(40)}end`;

    expect(shortenLogPattern(long).length).toBeLessThanOrEqual(
      LOG_INSIGHT_TITLE_PATTERN_LENGTH + 3,
    );
    expect(shortenLogPattern(long).endsWith("...")).toBe(true);
    expect(shortenLogPattern("a\n  b")).toBe("a b");
    expect(shortenLogPattern(undefined)).toBe("");
  });

  test("severities read lowest first, and only real ones", () => {
    expect(describeLogSeverities([LogSeverity.Error])).toBe("Error");
    expect(describeLogSeverities([LogSeverity.Fatal, LogSeverity.Error])).toBe(
      "Error and Fatal",
    );
    expect(
      describeLogSeverities([
        LogSeverity.Warning,
        LogSeverity.Debug,
        LogSeverity.Information,
        LogSeverity.Debug,
      ]),
    ).toBe("Debug, Information and Warning");
    expect(describeLogSeverities(["Loud", "error"])).toBe("");
    expect(describeLogSeverities(undefined)).toBe("");
  });

  test("titles say what was found", () => {
    expect(
      getLogInsightTitle({
        evidence: errorEvidence(),
        serviceName: "checkout",
      }),
    ).toBe(
      'checkout logged "Payment provider returned <num>: card declined for order <uuid>" 1,240 times in an hour',
    );
    expect(
      getLogInsightTitle({
        evidence: errorEvidence({ patternCount: 1 }),
        serviceName: "checkout",
      }),
    ).toContain("1 time in an hour");
    expect(
      getLogInsightTitle({
        evidence: noisyEvidence(),
        serviceName: "checkout",
      }),
    ).toBe('"cache hit for key <uuid>" is 62% of checkout\'s logs');
    expect(
      getLogInsightTitle({
        evidence: silentEvidence(),
        serviceName: "checkout",
      }),
    ).toBe("POST /checkout in checkout fails without logging");
    expect(
      getLogInsightTitle({
        evidence: noTraceEvidence(),
        serviceName: "checkout",
      }),
    ).toBe("checkout's logs carry no trace context");
  });

  test("a title with no service name still reads", () => {
    expect(
      getLogInsightTitle({ evidence: noTraceEvidence(), serviceName: "" }),
    ).toBe("A service's logs carry no trace context");
    expect(
      getLogInsightTitle({ evidence: silentEvidence(), serviceName: "" }),
    ).toBe("POST /checkout fails without logging");
    expect(
      getLogInsightTitle({ evidence: noisyEvidence(), serviceName: "" }),
    ).toBe('"cache hit for key <uuid>" is 62% of a service\'s logs');
  });

  test("a long message is shortened in the title", () => {
    const title: string = getLogInsightTitle({
      evidence: errorEvidence({ pattern: `${"x ".repeat(200)}tail` }),
      serviceName: "checkout",
    });

    expect(title).toContain("...");
    expect(title.length).toBeLessThan(160);
  });
});

describe("how severe a finding is", () => {
  test("an error log is Medium; High when frequent, or at Fatal", () => {
    expect(getLogInsightSeverity(errorEvidence({ patternCount: 999 }))).toBe(
      AIInsightSeverity.Medium,
    );
    expect(
      getLogInsightSeverity(
        errorEvidence({ patternCount: LOG_INSIGHT_HIGH_ERROR_PATTERN_COUNT }),
      ),
    ).toBe(AIInsightSeverity.High);
    expect(
      getLogInsightSeverity(
        errorEvidence({
          patternCount: 25,
          severities: [LogSeverity.Error, LogSeverity.Fatal],
        }),
      ),
    ).toBe(AIInsightSeverity.High);
  });

  test("a noisy log is Low; Medium when it is half the logs and a lot of them", () => {
    expect(getLogInsightSeverity(noisyEvidence())).toBe(AIInsightSeverity.Low);
    expect(
      getLogInsightSeverity(
        noisyEvidence({
          patternPercent: LOG_INSIGHT_HIGH_NOISY_PERCENT,
          patternCount: LOG_INSIGHT_HIGH_NOISY_PATTERN_LOGS,
        }),
      ),
    ).toBe(AIInsightSeverity.Medium);
    expect(
      getLogInsightSeverity(
        noisyEvidence({ patternPercent: 90, patternCount: 50000 }),
      ),
    ).toBe(AIInsightSeverity.Low);
  });

  test("a failure nobody can read about is Medium; logs with no trace context Low", () => {
    expect(getLogInsightSeverity(silentEvidence())).toBe(
      AIInsightSeverity.Medium,
    );
    expect(getLogInsightSeverity(noTraceEvidence())).toBe(
      AIInsightSeverity.Low,
    );
  });
});

describe("what the problem is, in sentences", () => {
  test("an error log: how often, at what, in how many traces", () => {
    expect(describeLogProblem(errorEvidence())).toBe(
      'Over the last hour it logged this error 1,240 times at Error: "Payment provider returned <num>: card declined for order <uuid>". It was logged in 312 traces.',
    );
    expect(
      describeLogProblem(errorEvidence({ traceCount: 0, severities: [] })),
    ).toBe(
      'Over the last hour it logged this error 1,240 times: "Payment provider returned <num>: card declined for order <uuid>".',
    );
  });

  test("a noisy log: its share, and about how many lines", () => {
    expect(describeLogProblem(noisyEvidence())).toBe(
      'Over the last hour it logged 48,000 lines, and "cache hit for key <uuid>" was 62% of them (about 29,760 lines) at Debug and Information.',
    );
  });

  test("a silent failure: the failures, none logged, and what the spans recorded", () => {
    expect(describeLogProblem(silentEvidence())).toBe(
      "Over the last hour 312 of its 2,600 requests to POST /checkout failed (12%), and none of the 20 most recent failed requests wrote a log line, so nobody reading the logs can see them fail. The failed spans recorded: TimeoutError: payment provider did not answer.",
    );
    expect(
      describeLogProblem(silentEvidence({ error: undefined })),
    ).not.toContain("recorded");
  });

  test("no trace context: the logs and spans, and how few logs were linked", () => {
    expect(describeLogProblem(noTraceEvidence())).toBe(
      "Over the last hour it wrote 18,400 logs and 9,200 spans, but only 12 of its logs (0.1%) carried a trace id, so a request's logs cannot be read beside its trace.",
    );
    expect(describeLogProblem(noTraceEvidence({ tracedLogCount: 0 }))).toBe(
      "Over the last hour it wrote 18,400 logs and 9,200 spans, but none of its logs carried a trace id, so a request's logs cannot be read beside its trace.",
    );
  });
});

describe("the evidence on the insight", () => {
  test("an error log: the message as code, the counts, a request, the code", () => {
    const detail: string = buildLogInsightDetail({
      serviceName: "checkout",
      evidence: errorEvidence(),
    }).toString();

    expect(detail.split("\n")[0]).toBe("**Error log in checkout**");
    expect(detail).toContain("- Message: `Payment provider returned <");
    expect(detail).toContain("- In the last hour: 1,240 times, at Error");
    expect(detail).toContain(
      "- The service's Error and Fatal logs in that hour: 2,100",
    );
    // Said as what happened: the message was logged in that many traces.
    expect(detail).toContain("- Logged in 312 traces");
    expect(detail).not.toContain("- In 312 traces");
    expect(detail).toContain(
      "- A request that logged it: trace `4bf92f3577b34da6a3ce929d0e0e4736`",
    );
    expect(detail).toContain("- Code: `src/payments/client.py:88`");
  });

  test("a noisy log: the message, its share of the lines read, about how many", () => {
    const detail: string = buildLogInsightDetail({
      serviceName: "checkout",
      evidence: noisyEvidence(),
    }).toString();

    expect(detail.split("\n")[0]).toBe("**Noisy log in checkout**");
    expect(detail).toContain(
      "- Share: 62% of the 48,000 lines read from the last hour",
    );
    expect(detail).toContain(
      "- In the last hour: about 29,760 lines of the service's 48,000",
    );
    expect(detail).toContain("- Logged at Debug and Information");
  });

  test("a silent failure: the operation, the failures, none logged, what the spans recorded", () => {
    const detail: string = buildLogInsightDetail({
      serviceName: "checkout",
      evidence: silentEvidence(),
    }).toString();

    expect(detail.split("\n")[0]).toBe("**Missing logging in checkout**");
    expect(detail).toContain("- Operation: `POST /checkout`");
    expect(detail).toContain(
      "- In the last hour: 2,600 requests, 312 failed (12%)",
    );
    expect(detail).toContain(
      "- None of the 20 most recent failed requests wrote a log line",
    );
    expect(detail).toContain(
      "- The failed spans recorded: TimeoutError: payment provider did not answer",
    );
    expect(detail).toContain(
      "- A failed request: trace `5bf92f3577b34da6a3ce929d0e0e4737`",
    );
  });

  test("no trace context: the logs and spans, and the linked share", () => {
    const detail: string = buildLogInsightDetail({
      serviceName: "checkout",
      evidence: noTraceEvidence(),
    }).toString();

    expect(detail).toContain("- In the last hour: 18,400 logs and 9,200 spans");
    expect(detail).toContain("- Logs with a trace id: 12 (0.1%)");
    expect(detail).toContain(
      "- Without one, a request's logs cannot be read beside its trace",
    );
    expect(detail).not.toContain("Message:");
  });

  /*
   * A message, an operation and an error are the service's own text: in the
   * evidence they read as written, never as Markdown of ours.
   */
  test("the service's own text is never read as Markdown", () => {
    const detail: string = buildLogInsightDetail({
      serviceName: "**pay** [now](https://evil.example)",
      evidence: errorEvidence({
        pattern: "a `tick` and [a link](https://evil.example) <img src=x>",
      }),
    }).toString();

    expect(detail).not.toContain("[now](https://evil.example)");
    expect(detail).not.toContain("**pay**");
    expect(detail).not.toContain("<img");
  });
});

describe("what OneUptime asks the AI", () => {
  test("the request's first line: what to do, and where", () => {
    expect(
      getLogFixRequestTitle({
        evidence: errorEvidence(),
        serviceName: "checkout",
      }),
    ).toBe(
      'Fix why checkout logs "Payment provider returned <num>: card declined for order <uuid>"',
    );
    expect(
      getLogFixRequestTitle({
        evidence: noisyEvidence(),
        serviceName: "checkout",
      }),
    ).toBe('Log "cache hit for key <uuid>" less in checkout');
    expect(
      getLogFixRequestTitle({
        evidence: silentEvidence(),
        serviceName: "checkout",
      }),
    ).toBe("Log why POST /checkout in checkout fails");
    expect(
      getLogFixRequestTitle({
        evidence: noTraceEvidence(),
        serviceName: "checkout",
      }),
    ).toBe("Add trace context to checkout's logs");
    expect(
      getLogFixRequestTitle({ evidence: noTraceEvidence(), serviceName: "" }),
    ).toBe("Add trace context to this service's logs");
  });

  test("OneUptime's own request says it found it, and leaves the AI free to change nothing", () => {
    for (const evidence of [
      errorEvidence(),
      noisyEvidence(),
      silentEvidence(),
      noTraceEvidence(),
    ]) {
      const own: string = buildLogFixRequestMessage({
        evidence,
        serviceName: "checkout",
        isStartedByOneUptime: true,
      });
      const asked: string = buildLogFixRequestMessage({
        evidence,
        serviceName: "checkout",
        isStartedByOneUptime: false,
      });

      expect(own).toContain(
        "OneUptime found this in the service's logs on its own.",
      );
      expect(own).toContain("change nothing.");
      expect(asked).not.toContain("on its own.");
      expect(asked).not.toContain("change nothing.");
      // Never a line as it was logged, whoever asked.
      expect(own).toContain(LOG_FIX_PRIVACY_RULE);
      expect(asked).toContain(LOG_FIX_PRIVACY_RULE);
      expect(own.split("\n")[0]).toBe(
        getLogFixRequestTitle({ evidence, serviceName: "checkout" }),
      );
    }
  });

  test("an error log: find the line by its own words, fix the cause, or its level", () => {
    const message: string = buildLogFixRequestMessage({
      evidence: errorEvidence(),
      serviceName: "checkout",
      isStartedByOneUptime: true,
    });

    expect(message).toContain("the parts between the <...> placeholders");
    expect(message).toContain("add a test that reproduces it");
    expect(message).toContain("log it at the level it deserves instead");
    expect(message).toContain("If the cause is not in this repository's code");
  });

  test("a noisy log: log it less without losing what someone needs", () => {
    const message: string = buildLogFixRequestMessage({
      evidence: noisyEvidence(),
      serviceName: "checkout",
      isStartedByOneUptime: true,
    });

    expect(message).toContain("Make it log less");
    expect(message).toContain("log it at Debug");
    expect(message).toContain("Do not change what the code does otherwise.");
    expect(message).toContain(
      "written by a library, a framework or the platform",
    );
  });

  test("a silent failure: log the failure through the service's logger, with its trace context", () => {
    const message: string = buildLogFixRequestMessage({
      evidence: silentEvidence(),
      serviceName: "checkout",
      isStartedByOneUptime: false,
    });

    expect(message).toContain("Where POST /checkout fails, log the failure");
    expect(message).toContain("carries the request's trace context");
  });

  test("no trace context: route its logger through OpenTelemetry", () => {
    const message: string = buildLogFixRequestMessage({
      evidence: noTraceEvidence(),
      serviceName: "checkout",
      isStartedByOneUptime: true,
    });

    expect(message).toContain("route its logger through OpenTelemetry");
    expect(message).toContain("Do not change what it logs");
    expect(message).toContain("drops their trace context");
  });
});

describe("the evidence the task is given", () => {
  test("an error log's note: the pattern and the words to search for, never a line", () => {
    const note: string = buildLogFixEvidenceNote(errorEvidence());

    expect(note).toContain(
      "Message pattern: Payment provider returned <num>: card declined for order <uuid>",
    );
    expect(note).toContain(
      "Words to search the code for: Payment provider returned",
    );
    expect(note).toContain("Lines of this message: 1,240");
    expect(note).toContain("Severities: Error");
    expect(note).toContain("Sample trace: 4bf92f3577b34da6a3ce929d0e0e4736");
    expect(note).toContain("Code: src/payments/client.py:88 (charge)");
    expect(note).toContain(
      "Window: 2026-10-24T08:00:00.000Z to 2026-10-24T09:00:00.000Z",
    );
  });

  test("a noisy log's count is said to be estimated", () => {
    const note: string = buildLogFixEvidenceNote(noisyEvidence());

    expect(note).toContain("Lines of this message (estimated): 29,760");
    expect(note).toContain("Share of the lines read: 62% of 48,000");
  });

  test("a silent failure's note: the operation, the requests read, what the spans recorded", () => {
    const note: string = buildLogFixEvidenceNote(
      silentEvidence({
        error: {
          exceptionType: "TimeoutError",
          stackTrace: "TimeoutError\n    at charge (src/pay.ts:9:3)",
          sampleMatches: 5,
          sampleSize: 5,
        },
      }),
    );

    expect(note).toContain("Operation: POST /checkout");
    expect(note).toContain("Requests to the operation: 2,600, failed: 312");
    expect(note).toContain(
      "Most recent failed requests read, none of which logged: 20",
    );
    expect(note).toContain("What the failed spans recorded: TimeoutError");
    expect(note).toContain("Stack trace:");
    expect(note).toContain("at charge (src/pay.ts:9:3)");
  });

  test("no trace context's note: the logs, the linked ones, the spans", () => {
    const note: string = buildLogFixEvidenceNote(noTraceEvidence());

    expect(note).toContain("Logs with a trace id: 12");
    expect(note).toContain("Spans of the service: 9,200");
    expect(note).not.toContain("Message pattern");
  });
});

describe("the code a finding names, for the repository resolver", () => {
  test("its code locations as stack frames, a silent failure's stack after them", () => {
    expect(getLogInsightStackTrace(errorEvidence())).toBe(
      "    at charge (src/payments/client.py:88)",
    );
    expect(
      getLogInsightStackTrace(
        silentEvidence({
          codeLocations: [{ filePath: "src/checkout.ts" }],
          error: {
            stackTrace: "Error: x\n    at y (src/y.ts:3:1)",
            sampleMatches: 1,
            sampleSize: 5,
          },
        }),
      ),
    ).toBe("    at (src/checkout.ts:1)\nError: x\n    at y (src/y.ts:3:1)");
  });

  test("nothing to name, nothing named", () => {
    expect(getLogInsightStackTrace(noTraceEvidence())).toBeNull();
    expect(getLogInsightStackTrace(null)).toBeNull();
    expect(getLogInsightStackTrace(undefined)).toBeNull();
  });

  test("a silent failure keeps the top of its stack trace only", () => {
    const stackTrace: string = Array.from(
      { length: 50 },
      (_value: unknown, index: number): string => {
        return `    at frame${index} (src/f.ts:${index}:1)`;
      },
    ).join("\n");

    const kept: ReturnType<typeof toSilentFailureError> = toSilentFailureError({
      stackTrace,
      sampleMatches: 1,
      sampleSize: 5,
    });

    expect(kept!.stackTrace!.split("\n")).toHaveLength(
      LOG_INSIGHT_STACK_TRACE_LINES,
    );
    expect(toSilentFailureError(null)).toBeUndefined();
  });
});
