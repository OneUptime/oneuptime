import AIInsightSeverity from "../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../Types/AI/AIInsightType";
import {
  LogInsightEvidence,
  TraceInsightErrorEvidence,
} from "../../Types/AI/AIInsightEvidence";
import { PerformanceCodeLocation } from "../../Types/AI/CodeFixTaskContext";
import LogSeverity, { LogSeverityNumber } from "../../Types/Log/LogSeverity";
import FeedMarkdown, { mdText, MarkdownText } from "../Markdown/FeedMarkdown";
import { truncateErrorPattern } from "../Telemetry/LogErrorPattern";
import SpanTreeAnalyzer from "../Traces/SpanTreeAnalyzer";
import {
  TRACE_INSIGHT_MIN_FAILED_SPANS,
  describeTraceError,
  formatTracePercent,
  getFailedPercent,
} from "../Traces/TraceInsight";

/*
 * PROBLEMS IN A SERVICE'S LOGS WORTH TELLING SOMEONE ABOUT - the gates the
 * Logs product's detector files its AI insights by (Server/Utils/AI/SRE/
 * Insights/Detectors/LogProblemDetector), and that OneUptime AI then looks
 * into and opens a pull request for, as the project's log AI rules say
 * (Types/AI/TelemetryAi). "Fix error logs, log things that are not logged
 * currently, improve logs" - the maintainer. Three kinds:
 *
 *   - Error log (LogErrorPattern): one message a service logged 20 or more
 *     times over the last hour at Error or Fatal severity, with words of its
 *     own (a bare "error" says nothing to fix). A message is its pattern -
 *     every value that changes from line to line masked, as Logs Insights'
 *     Top errors groups them (Utils/Telemetry/LogErrorPattern). An error that
 *     carries an exception (exception.* attributes, or a stack trace in the
 *     line) is left out: the Exceptions product groups it, and fixes it, as
 *     an exception. The pull request fixes what makes the code log it - or,
 *     when it logs at Error something that is not one, its level;
 *
 *   - Missing logging (LogMissingLogging): what a service's logs do not say -
 *       SilentFailures: an operation 20 or more of whose spans failed over
 *         the hour, 5% or more of them (the Traces lane's failing gate), when
 *         none of its 20 most recent failed requests wrote a single log line
 *         - while the service's other logs do carry trace ids, so their
 *         silence is real, not an unlinked log;
 *       NoTraceContext: a service that sent 500 or more logs and 100 or more
 *         spans in the hour, fewer than 1% of whose logs carried a trace id:
 *         its logs cannot be read beside the requests that wrote them;
 *
 *   - Noisy log (LogNoisyPattern): one message below Error severity that
 *     made up 25% or more of a busy service's logs (10,000 or more lines in
 *     the hour), read off a sample of up to 100,000 of its lines: it costs
 *     storage, and buries the lines that matter.
 *
 * Each service is read at most once an hour - the three with the most
 * errors, the three with failures and linked logs, the three busiest -
 * and keeps at most two error logs, one missing-logging finding and one
 * noisy log. A finding's fingerprint is its kind, its service and its
 * message (or its gap and operation), so the same problem is one insight,
 * refreshed while it lasts, and one pull request.
 *
 * A log line holds whatever the code put in it, so no line is ever kept as
 * it was logged: only a message's pattern, sanitized by the detector, and a
 * run of its own words found in a line (what the Logs viewer and a monitor
 * search for). Pure: the detector, the Dashboard, the tests and the docs
 * suites read it alike.
 */

// The window each look reads: the last hour, as the Logs viewer opens on.
export const LOG_INSIGHT_WINDOW_MINUTES: number = 60;

// The services the stage-one read lists, busiest first.
export const LOG_INSIGHT_MAX_SERVICES_READ: number = 200;

// The severities an error log is logged at.
export const LOG_INSIGHT_ERROR_SEVERITIES: ReadonlyArray<LogSeverity> = [
  LogSeverity.Error,
  LogSeverity.Fatal,
];

/*
 * Error log: the fewest Error or Fatal lines of a service in the hour for
 * its messages to be read, and of one message for it to be filed. Below it
 * an error is a blip nobody would open a pull request for.
 */
export const LOG_INSIGHT_MIN_ERROR_LOGS: number = 20;
export const LOG_INSIGHT_MIN_ERROR_PATTERN_COUNT: number = 20;

// The services read for error logs on each look, the most errors first.
export const LOG_INSIGHT_MAX_ERROR_SERVICES: number = 3;

// A service's messages read on each look, and the error logs it keeps.
export const LOG_INSIGHT_ERROR_PATTERN_ROWS: number = 10;
export const LOG_INSIGHT_ERROR_PATTERNS_PER_SERVICE: number = 2;

// An error logged this often in an hour is High; and one at Fatal.
export const LOG_INSIGHT_HIGH_ERROR_PATTERN_COUNT: number = 1000;

// The traces an error log keeps a few of, to open its requests from.
export const LOG_INSIGHT_SAMPLE_TRACE_IDS: number = 3;

/*
 * Missing logging, SilentFailures: the fewest of a service's logs that
 * carried a trace id in the hour for its failed requests' silence to mean
 * something - with none, no request's logs could ever be found by trace.
 */
export const LOG_INSIGHT_MIN_TRACED_LOGS: number = 100;

/*
 * The most recent failed requests of an operation read for a log line, and
 * the fewest of them - distinct requests - for their silence to be told.
 */
export const LOG_INSIGHT_FAILED_SAMPLE_SIZE: number = 20;
export const LOG_INSIGHT_MIN_FAILED_SAMPLE_SIZE: number = 5;

/*
 * The newest minutes of the hour a failed request is not read from: a line
 * it logged a moment ago may not be read in yet.
 */
export const LOG_INSIGHT_INGEST_GRACE_MINUTES: number = 5;

// The services read for silent failures, the most failures first.
export const LOG_INSIGHT_MAX_SILENT_FAILURE_SERVICES: number = 3;

// The failing operations of a service read for silent failures.
export const LOG_INSIGHT_SILENT_OPERATIONS_PER_SERVICE: number = 2;

/*
 * Missing logging, NoTraceContext: a service's logs and spans in the hour,
 * and the largest share of its logs that may carry a trace id.
 */
export const LOG_INSIGHT_MIN_TRACE_CONTEXT_LOGS: number = 500;
export const LOG_INSIGHT_MIN_TRACE_CONTEXT_SPANS: number = 100;
export const LOG_INSIGHT_MAX_TRACE_CONTEXT_PERCENT: number = 1;
export const LOG_INSIGHT_MAX_TRACE_CONTEXT_SERVICES: number = 3;

/*
 * Noisy log: a service's lines in the hour, one message's estimated lines
 * and its least share of them; read off at most this many of its lines.
 */
export const LOG_INSIGHT_MIN_NOISY_SERVICE_LOGS: number = 10000;
export const LOG_INSIGHT_MIN_NOISY_PATTERN_LOGS: number = 10000;
export const LOG_INSIGHT_MIN_NOISY_PERCENT: number = 25;
export const LOG_INSIGHT_NOISY_SAMPLE_SIZE: number = 100000;
export const LOG_INSIGHT_NOISY_PATTERN_ROWS: number = 5;
export const LOG_INSIGHT_MAX_NOISY_SERVICES: number = 3;

// A noisy log this large is Medium; the rest Low.
export const LOG_INSIGHT_HIGH_NOISY_PERCENT: number = 50;
export const LOG_INSIGHT_HIGH_NOISY_PATTERN_LOGS: number = 100000;

// How much of a message a title names, in characters.
export const LOG_INSIGHT_TITLE_PATTERN_LENGTH: number = 80;

/*
 * The fewest words of its own a message needs - words of two or more
 * letters outside the masked values - for it to be filed: "error" or
 * "<num>" alone could be any line of any service.
 */
export const LOG_INSIGHT_MIN_PATTERN_WORDS: number = 2;

// How much of a stack trace a silent failure's error keeps, in lines.
export const LOG_INSIGHT_STACK_TRACE_LINES: number = 20;

export const LOG_INSIGHT_FINGERPRINT_PREFIXES: {
  error: string;
  missingLogging: string;
  noisy: string;
} = {
  error: "log-error",
  missingLogging: "log-missing-logging",
  noisy: "log-noisy",
};

export enum LogInsightKind {
  Error = "Error",
  MissingLogging = "MissingLogging",
  Noisy = "Noisy",
}

// What a service's logs lack, for a MissingLogging finding.
export enum LogLoggingGap {
  SilentFailures = "SilentFailures",
  NoTraceContext = "NoTraceContext",
}

export const LOG_INSIGHT_TYPE_BY_KIND: Readonly<
  Record<LogInsightKind, AIInsightType>
> = {
  [LogInsightKind.Error]: AIInsightType.LogErrorPattern,
  [LogInsightKind.MissingLogging]: AIInsightType.LogMissingLogging,
  [LogInsightKind.Noisy]: AIInsightType.LogNoisyPattern,
};

export function isLogInsightKind(value: unknown): value is LogInsightKind {
  return (
    typeof value === "string" &&
    (Object.values(LogInsightKind) as Array<string>).includes(value)
  );
}

export function isLogLoggingGap(value: unknown): value is LogLoggingGap {
  return (
    typeof value === "string" &&
    (Object.values(LogLoggingGap) as Array<string>).includes(value)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readId(id: string): string {
  return (id || "").trim().toLowerCase();
}

function hasText(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface LogInsightWindow {
  startTime: Date;
  endTime: Date;
}

// The hour a look reads.
export function getLogInsightWindow(now: Date): LogInsightWindow {
  return {
    startTime: new Date(now.getTime() - LOG_INSIGHT_WINDOW_MINUTES * 60_000),
    endTime: new Date(now.getTime()),
  };
}

/*
 * STAGE ONE: every service at once - its logs over the hour (every one,
 * the Error and Fatal ones, the ones that carried a trace id) and, from its
 * traces, its spans and failed spans: which services are read closely.
 */
export interface LogServiceReading {
  serviceId: string;
  logCount: number;
  errorLogCount: number;
  tracedLogCount: number;
  // 0 when the service sent no spans in the hour.
  spanCount: number;
  failedSpanCount: number;
}

// The share of a service's logs that carried a trace id, in percent.
export function getTracedLogPercent(reading: {
  logCount: number;
  tracedLogCount: number;
}): number {
  if (!isFiniteNumber(reading.logCount) || reading.logCount <= 0) {
    return 0;
  }

  return (
    (Math.min(reading.logCount, Math.max(0, reading.tracedLogCount || 0)) /
      reading.logCount) *
    100
  );
}

function byWeightThenId(
  weight: (reading: LogServiceReading) => number,
): (a: LogServiceReading, b: LogServiceReading) => number {
  return (a: LogServiceReading, b: LogServiceReading): number => {
    return (
      weight(b) - weight(a) ||
      b.logCount - a.logCount ||
      readId(a.serviceId).localeCompare(readId(b.serviceId))
    );
  };
}

function toIds(readings: Array<LogServiceReading>): Array<string> {
  return readings.map((reading: LogServiceReading): string => {
    return readId(reading.serviceId);
  });
}

function withoutExcluded(
  readings: ReadonlyArray<LogServiceReading>,
  excludedServiceIds: ReadonlySet<string>,
): Array<LogServiceReading> {
  return readings.filter((reading: LogServiceReading): boolean => {
    return (
      Boolean(readId(reading.serviceId)) &&
      !excludedServiceIds.has(readId(reading.serviceId))
    );
  });
}

// The services with the most Error and Fatal lines, enough to hold a finding.
export function pickErrorLogServices(
  readings: ReadonlyArray<LogServiceReading>,
  excludedServiceIds: ReadonlySet<string> = new Set<string>(),
): Array<string> {
  return toIds(
    withoutExcluded(readings, excludedServiceIds)
      .filter((reading: LogServiceReading): boolean => {
        return reading.errorLogCount >= LOG_INSIGHT_MIN_ERROR_LOGS;
      })
      .sort(
        byWeightThenId((reading: LogServiceReading): number => {
          return reading.errorLogCount;
        }),
      )
      .slice(0, LOG_INSIGHT_MAX_ERROR_SERVICES),
  );
}

/*
 * Whether a traced service's logs carry no trace context: busy enough to
 * tell, and fewer than 1% of its logs with a trace id.
 */
export function isMissingTraceContext(reading: LogServiceReading): boolean {
  return (
    reading.logCount >= LOG_INSIGHT_MIN_TRACE_CONTEXT_LOGS &&
    reading.spanCount >= LOG_INSIGHT_MIN_TRACE_CONTEXT_SPANS &&
    getTracedLogPercent(reading) < LOG_INSIGHT_MAX_TRACE_CONTEXT_PERCENT
  );
}

// The traced services whose logs carry no trace context, busiest first.
export function pickNoTraceContextServices(
  readings: ReadonlyArray<LogServiceReading>,
  excludedServiceIds: ReadonlySet<string> = new Set<string>(),
): Array<string> {
  return toIds(
    withoutExcluded(readings, excludedServiceIds)
      .filter(isMissingTraceContext)
      .sort(
        byWeightThenId((reading: LogServiceReading): number => {
          return reading.logCount;
        }),
      )
      .slice(0, LOG_INSIGHT_MAX_TRACE_CONTEXT_SERVICES),
  );
}

/*
 * The services whose requests fail - enough of them to hold a failing
 * operation - and whose logs carry trace ids, so a failed request's missing
 * log line can be told apart from an unlinked one. The most failures first.
 */
export function pickSilentFailureServices(
  readings: ReadonlyArray<LogServiceReading>,
  excludedServiceIds: ReadonlySet<string> = new Set<string>(),
): Array<string> {
  return toIds(
    withoutExcluded(readings, excludedServiceIds)
      .filter((reading: LogServiceReading): boolean => {
        return (
          reading.failedSpanCount >= TRACE_INSIGHT_MIN_FAILED_SPANS &&
          reading.tracedLogCount >= LOG_INSIGHT_MIN_TRACED_LOGS &&
          !isMissingTraceContext(reading)
        );
      })
      .sort(
        byWeightThenId((reading: LogServiceReading): number => {
          return reading.failedSpanCount;
        }),
      )
      .slice(0, LOG_INSIGHT_MAX_SILENT_FAILURE_SERVICES),
  );
}

// The busiest services, busy enough for one message to flood them.
export function pickNoisyLogServices(
  readings: ReadonlyArray<LogServiceReading>,
  excludedServiceIds: ReadonlySet<string> = new Set<string>(),
): Array<string> {
  return toIds(
    withoutExcluded(readings, excludedServiceIds)
      .filter((reading: LogServiceReading): boolean => {
        return reading.logCount >= LOG_INSIGHT_MIN_NOISY_SERVICE_LOGS;
      })
      .sort(
        byWeightThenId((reading: LogServiceReading): number => {
          return reading.logCount;
        }),
      )
      .slice(0, LOG_INSIGHT_MAX_NOISY_SERVICES),
  );
}

/*
 * The words of a message's pattern that are its own: runs of two or more
 * letters outside the values the pattern and the sanitizer mask ("<num>",
 * "<uuid>", "<SERVICE_ID>", "<token>", ...). Chinese and Japanese are
 * written without spaces between words, so their runs are counted a word
 * in every two characters - "決済に失敗しました" says more than "失敗" does.
 */
const LETTER_RUN: RegExp = /\p{L}{2,}/gu;
const MASKED_VALUE: RegExp = /<[A-Za-z_]{1,32}>/g;
const UNSPACED_PAIR: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2}/gu;

export function getPatternWords(pattern: string | undefined | null): number {
  if (typeof pattern !== "string" || pattern.length === 0) {
    return 0;
  }

  return (
    pattern
      .replace(MASKED_VALUE, " ")
      .replace(UNSPACED_PAIR, (pair: string): string => {
        return `${pair} `;
      })
      .match(LETTER_RUN) || []
  ).length;
}

// Whether a message says enough of its own to be filed.
export function hasPatternWords(pattern: string | undefined | null): boolean {
  return getPatternWords(pattern) >= LOG_INSIGHT_MIN_PATTERN_WORDS;
}

/*
 * The least length of a token-like run a message keeps no part of: a run of
 * key characters with digits or masked values inside it - what is left of a
 * token, a key or an encoded blob once the pattern masked its numbers
 * ("eyJhbGciOiJIUzI<num>NiIs..."). A code identifier ("OrderService.load")
 * has neither and stays.
 */
export const LOG_INSIGHT_TOKEN_RUN_LENGTH: number = 24;

// One run of token characters: a single class, read in time with its length.
const TOKEN_RUN: RegExp = /[A-Za-z0-9_\-+/=.<>]{24,}/g;
const DIGIT_OR_PLACEHOLDER: RegExp = /[0-9<]/;

export const LOG_INSIGHT_MASKED_TOKEN: string = "<token>";

/*
 * A message with what is left of tokens masked: every token-like run of
 * LOG_INSIGHT_TOKEN_RUN_LENGTH or more characters that holds a digit or a
 * masked value becomes "<token>". The server's secret redaction runs first;
 * this catches the secrets whose shape it no longer knows once the
 * pattern's own masking split them.
 */
export function maskLogPatternTokens(pattern: string): string {
  if (typeof pattern !== "string" || pattern.length === 0) {
    return "";
  }

  return pattern.replace(TOKEN_RUN, (run: string): string => {
    return DIGIT_OR_PLACEHOLDER.test(run) ? LOG_INSIGHT_MASKED_TOKEN : run;
  });
}

/*
 * STAGE TWO: one service's messages over the hour, grouped by pattern, for
 * the services stage one picked. Every text already sanitized by the server.
 */
export interface LogPatternReading {
  // The message's pattern: values masked, then sanitized.
  pattern: string;
  // Its lines in the window (in the sample, for a noisy log).
  count: number;
  severities: Array<string>;
  // A run of its own words found as written in a line; "" when none.
  searchText: string;
  // The traces its lines were logged in, and a few of them.
  traceCount: number;
  sampleTraceIds: Array<string>;
  /*
   * Its newest line holds an exception - a stack trace in the line: the
   * Exceptions product groups it and fixes it as one.
   */
  hasException: boolean;
}

function isErrorSeverity(severity: string): boolean {
  return (LOG_INSIGHT_ERROR_SEVERITIES as ReadonlyArray<string>).includes(
    severity,
  );
}

// Ties fall to the pattern: a total, deterministic order.
function byCountThenPattern(
  a: LogPatternReading,
  b: LogPatternReading,
): number {
  return b.count - a.count || a.pattern.localeCompare(b.pattern);
}

/*
 * A service's error logs worth filing, the most lines first: often enough,
 * with words of their own, and no exception.
 */
export function pickErrorPatterns(
  readings: ReadonlyArray<LogPatternReading>,
): Array<LogPatternReading> {
  return readings
    .filter((reading: LogPatternReading): boolean => {
      return (
        hasText(reading.pattern) &&
        !reading.hasException &&
        isFiniteNumber(reading.count) &&
        reading.count >= LOG_INSIGHT_MIN_ERROR_PATTERN_COUNT &&
        hasPatternWords(reading.pattern)
      );
    })
    .sort(byCountThenPattern)
    .slice(0, LOG_INSIGHT_ERROR_PATTERNS_PER_SERVICE);
}

export interface LogNoisyPatternFinding {
  reading: LogPatternReading;
  // Its share of the lines read, in percent.
  percent: number;
  // Its lines in the hour, estimated from that share of the service's.
  estimatedCount: number;
}

/*
 * A busy service's noisy log, if it has one: the message with the most of
 * the lines read, below Error severity, with words of its own, that is 25%
 * or more of them and some 10,000 lines of the hour or more.
 */
export function pickNoisyPattern(data: {
  readings: ReadonlyArray<LogPatternReading>;
  // The lines the sample read, and the service's in the hour.
  sampledLogCount: number;
  logCount: number;
}): LogNoisyPatternFinding | null {
  if (
    !isFiniteNumber(data.sampledLogCount) ||
    data.sampledLogCount <= 0 ||
    !isFiniteNumber(data.logCount) ||
    data.logCount < LOG_INSIGHT_MIN_NOISY_SERVICE_LOGS
  ) {
    return null;
  }

  const candidates: Array<LogPatternReading> = data.readings
    .filter((reading: LogPatternReading): boolean => {
      return (
        hasText(reading.pattern) &&
        isFiniteNumber(reading.count) &&
        reading.count > 0 &&
        reading.severities.length > 0 &&
        !reading.severities.some(isErrorSeverity) &&
        hasPatternWords(reading.pattern)
      );
    })
    .sort(byCountThenPattern);

  const top: LogPatternReading | undefined = candidates[0];

  if (!top) {
    return null;
  }

  const percent: number =
    (Math.min(top.count, data.sampledLogCount) / data.sampledLogCount) * 100;
  const estimatedCount: number = Math.round((percent / 100) * data.logCount);

  if (
    percent < LOG_INSIGHT_MIN_NOISY_PERCENT ||
    estimatedCount < LOG_INSIGHT_MIN_NOISY_PATTERN_LOGS
  ) {
    return null;
  }

  return { reading: top, percent, estimatedCount };
}

export enum LogSilenceVerdict {
  /*
   * Too few failed requests could be read (they aged out between the two
   * reads, or were all one request): nothing is known, so nothing is filed.
   */
  Unread = "Unread",
  // At least one of them wrote a log line.
  Logged = "Logged",
  // None of them did.
  Silent = "Silent",
}

export interface FailedRequestLogsReading {
  verdict: LogSilenceVerdict;
  // The failed requests read: their distinct traces.
  sampleSize: number;
  // Silent: a failed request to start from.
  sampleTraceId: string | null;
}

/*
 * Whether an operation's most recent failed requests wrote a log line: the
 * service's log lines in each of their traces, read once for all of them.
 */
export function readFailedRequestLogs(data: {
  failedTraceIds: ReadonlyArray<string>;
  logCountsByTraceId: ReadonlyMap<string, number>;
}): FailedRequestLogsReading {
  const traceIds: Array<string> = Array.from(
    new Set(
      data.failedTraceIds
        .map((traceId: string): string => {
          return readId(traceId);
        })
        .filter((traceId: string): boolean => {
          return traceId.length > 0;
        }),
    ),
  ).slice(0, LOG_INSIGHT_FAILED_SAMPLE_SIZE);

  if (traceIds.length < LOG_INSIGHT_MIN_FAILED_SAMPLE_SIZE) {
    return {
      verdict: LogSilenceVerdict.Unread,
      sampleSize: traceIds.length,
      sampleTraceId: null,
    };
  }

  const counts: Map<string, number> = new Map<string, number>();

  for (const [traceId, count] of data.logCountsByTraceId) {
    counts.set(readId(traceId), (counts.get(readId(traceId)) || 0) + count);
  }

  const logged: boolean = traceIds.some((traceId: string): boolean => {
    return (counts.get(traceId) || 0) > 0;
  });

  return {
    verdict: logged ? LogSilenceVerdict.Logged : LogSilenceVerdict.Silent,
    sampleSize: traceIds.length,
    sampleTraceId: logged ? null : traceIds[0] || null,
  };
}

/*
 * The finding's identity: its kind, its service and its message - or, for
 * missing logging, what is missing and the operation (its name with the
 * parts that change from request to request collapsed).
 */
export function getLogInsightFingerprint(data: {
  kind: LogInsightKind;
  serviceId: string;
  pattern?: string | undefined;
  gap?: LogLoggingGap | undefined;
  operationName?: string | undefined;
}): string {
  const serviceId: string = readId(data.serviceId);

  switch (data.kind) {
    case LogInsightKind.Error:
      return [
        LOG_INSIGHT_FINGERPRINT_PREFIXES.error,
        serviceId,
        data.pattern || "",
      ].join(":");
    case LogInsightKind.Noisy:
      return [
        LOG_INSIGHT_FINGERPRINT_PREFIXES.noisy,
        serviceId,
        data.pattern || "",
      ].join(":");
    case LogInsightKind.MissingLogging:
    default:
      return [
        LOG_INSIGHT_FINGERPRINT_PREFIXES.missingLogging,
        serviceId,
        data.gap || LogLoggingGap.NoTraceContext,
        SpanTreeAnalyzer.normalizeSpanName(data.operationName || ""),
      ].join(":");
  }
}

// Whether a fingerprint is one of a service's log findings.
export function isLogInsightFingerprintOfService(
  fingerprint: string,
  serviceId: string,
): boolean {
  const lowered: string = (fingerprint || "").toLowerCase();
  const id: string = readId(serviceId);

  if (!id) {
    return false;
  }

  return Object.values(LOG_INSIGHT_FINGERPRINT_PREFIXES).some(
    (prefix: string): boolean => {
      return lowered.startsWith(`${prefix}:${id}:`);
    },
  );
}

function formatCount(count: number): string {
  return Math.round(isFiniteNumber(count) ? count : 0).toLocaleString("en-US");
}

function plural(count: number, one: string, other: string): string {
  return `${formatCount(count)} ${Math.round(count) === 1 ? one : other}`;
}

// A message as a title names it: on one line, cut with "...".
export function shortenLogPattern(pattern: string | undefined): string {
  return truncateErrorPattern(pattern || "", LOG_INSIGHT_TITLE_PATTERN_LENGTH);
}

/*
 * The severities a message was logged at, as prose names them, lowest
 * first: "Error", "Error and Fatal", "Debug, Information and Warning".
 * Values that are not a log severity are left out.
 */
export function describeLogSeverities(
  severities: ReadonlyArray<string> | undefined,
): string {
  const known: Array<LogSeverity> = Array.from(
    new Set(
      (severities || []).filter((severity: string): boolean => {
        return (Object.values(LogSeverity) as Array<string>).includes(severity);
      }) as Array<LogSeverity>,
    ),
  ).sort((a: LogSeverity, b: LogSeverity): number => {
    return LogSeverityNumber[a] - LogSeverityNumber[b];
  });

  if (known.length === 0) {
    return "";
  }

  if (known.length === 1) {
    return known[0]!;
  }

  return `${known.slice(0, -1).join(", ")} and ${known[known.length - 1]!}`;
}

function withService(operation: string, serviceName: string): string {
  return serviceName ? `${operation} in ${serviceName}` : operation;
}

function getServiceName(serviceName: string): string {
  return serviceName || "A service";
}

function getNoisyPercent(evidence: LogInsightEvidence): number {
  return isFiniteNumber(evidence.patternPercent) ? evidence.patternPercent : 0;
}

// The insight's title: what was found, in a sentence.
export function getLogInsightTitle(data: {
  evidence: LogInsightEvidence;
  serviceName: string;
}): string {
  const evidence: LogInsightEvidence = data.evidence;
  const service: string = getServiceName(data.serviceName);
  const message: string = shortenLogPattern(evidence.pattern);

  switch (evidence.kind) {
    case LogInsightKind.Error:
      return `${service} logged "${message}" ${plural(evidence.patternCount || 0, "time", "times")} in an hour`;
    case LogInsightKind.Noisy:
      return `"${message}" is ${formatTracePercent(getNoisyPercent(evidence))} of ${data.serviceName || "a service"}'s logs`;
    case LogInsightKind.MissingLogging:
    default:
      return evidence.gap === LogLoggingGap.SilentFailures
        ? `${withService(evidence.operationName || "An operation", data.serviceName)} fails without logging`
        : `${service}'s logs carry no trace context`;
  }
}

export function getLogInsightSeverity(
  evidence: LogInsightEvidence,
): AIInsightSeverity {
  switch (evidence.kind) {
    case LogInsightKind.Error:
      return (evidence.patternCount || 0) >=
        LOG_INSIGHT_HIGH_ERROR_PATTERN_COUNT ||
        (evidence.severities || []).includes(LogSeverity.Fatal)
        ? AIInsightSeverity.High
        : AIInsightSeverity.Medium;
    case LogInsightKind.Noisy:
      return getNoisyPercent(evidence) >= LOG_INSIGHT_HIGH_NOISY_PERCENT &&
        (evidence.patternCount || 0) >= LOG_INSIGHT_HIGH_NOISY_PATTERN_LOGS
        ? AIInsightSeverity.Medium
        : AIInsightSeverity.Low;
    case LogInsightKind.MissingLogging:
    default:
      // A failure nobody can read about costs users; the rest, visibility.
      return evidence.gap === LogLoggingGap.SilentFailures
        ? AIInsightSeverity.Medium
        : AIInsightSeverity.Low;
  }
}

function describeAt(severities: ReadonlyArray<string> | undefined): string {
  const words: string = describeLogSeverities(severities);

  return words ? ` at ${words}` : "";
}

function describeFailedShare(evidence: LogInsightEvidence): string {
  return formatTracePercent(
    getFailedPercent({
      spanCount: evidence.operationSpanCount || 0,
      failedSpanCount: evidence.failedSpanCount || 0,
    }),
  );
}

/*
 * What the problem is, in sentences: the opening of the request OneUptime
 * writes, and of the person's.
 */
export function describeLogProblem(evidence: LogInsightEvidence): string {
  switch (evidence.kind) {
    case LogInsightKind.Error: {
      const traces: string = evidence.traceCount
        ? ` It was logged in ${plural(evidence.traceCount, "trace", "traces")}.`
        : "";

      return `Over the last hour it logged this error ${plural(evidence.patternCount || 0, "time", "times")}${describeAt(evidence.severities)}: "${evidence.pattern || ""}".${traces}`;
    }
    case LogInsightKind.Noisy:
      return `Over the last hour it logged ${plural(evidence.logCount, "line", "lines")}, and "${evidence.pattern || ""}" was ${formatTracePercent(getNoisyPercent(evidence))} of them (about ${plural(evidence.patternCount || 0, "line", "lines")})${describeAt(evidence.severities)}.`;
    case LogInsightKind.MissingLogging:
    default: {
      if (evidence.gap === LogLoggingGap.SilentFailures) {
        const recorded: string = evidence.error
          ? ` The failed spans recorded: ${describeTraceError(evidence.error)}.`
          : "";

        return `Over the last hour ${formatCount(evidence.failedSpanCount || 0)} of its ${plural(evidence.operationSpanCount || 0, "request", "requests")} to ${evidence.operationName || "the operation"} failed (${describeFailedShare(evidence)}), and none of the ${plural(evidence.failedSampleSize || 0, "most recent failed request", "most recent failed requests")} wrote a log line, so nobody reading the logs can see them fail.${recorded}`;
      }

      const traced: number = evidence.tracedLogCount || 0;
      const carried: string =
        traced > 0
          ? `only ${formatCount(traced)} of its logs (${formatTracePercent(getTracedLogPercent({ logCount: evidence.logCount, tracedLogCount: traced }))}) carried a trace id`
          : "none of its logs carried a trace id";

      return `Over the last hour it wrote ${plural(evidence.logCount, "log", "logs")} and ${plural(evidence.serviceSpanCount || 0, "span", "spans")}, but ${carried}, so a request's logs cannot be read beside its trace.`;
    }
  }
}

/*
 * The evidence as a person reads it on the insight (its detailMarkdown):
 * real numbers only, the facts first. Pure, so the detector writes it and
 * the browser suite draws exactly what the detector wrote. Every name is
 * written into Markdown escaped (mdText): a message, an operation or an
 * error is the service's, not ours.
 */
export function buildLogInsightDetail(data: {
  serviceName: string;
  evidence: LogInsightEvidence;
}): MarkdownText {
  const evidence: LogInsightEvidence = data.evidence;
  const lines: Array<MarkdownText> = [];
  const service: string = data.serviceName || "this service";

  switch (evidence.kind) {
    case LogInsightKind.Error:
      lines.push(mdText`**Error log in ${service}**`);
      break;
    case LogInsightKind.Noisy:
      lines.push(mdText`**Noisy log in ${service}**`);
      break;
    default:
      lines.push(mdText`**Missing logging in ${service}**`);
  }

  lines.push(FeedMarkdown.empty());

  if (evidence.kind === LogInsightKind.Error) {
    lines.push(mdText`- Message: \`${evidence.pattern || ""}\``);

    const at: string = describeLogSeverities(evidence.severities);

    lines.push(
      at
        ? mdText`- In the last hour: ${plural(evidence.patternCount || 0, "time", "times")}, at ${at}`
        : mdText`- In the last hour: ${plural(evidence.patternCount || 0, "time", "times")}`,
    );

    if (isFiniteNumber(evidence.errorLogCount)) {
      lines.push(
        mdText`- The service's Error and Fatal logs in that hour: ${formatCount(evidence.errorLogCount)}`,
      );
    }

    if (evidence.traceCount) {
      lines.push(
        mdText`- Logged in ${plural(evidence.traceCount, "trace", "traces")}`,
      );
    }

    if (evidence.sampleTraceIds && evidence.sampleTraceIds[0]) {
      lines.push(
        mdText`- A request that logged it: trace \`${evidence.sampleTraceIds[0]}\``,
      );
    }
  }

  if (evidence.kind === LogInsightKind.Noisy) {
    lines.push(mdText`- Message: \`${evidence.pattern || ""}\``);
    lines.push(
      mdText`- Share: ${formatTracePercent(getNoisyPercent(evidence))} of the ${plural(evidence.sampledLogCount || 0, "line", "lines")} read from the last hour`,
    );
    lines.push(
      mdText`- In the last hour: about ${plural(evidence.patternCount || 0, "line", "lines")} of the service's ${formatCount(evidence.logCount)}`,
    );

    const at: string = describeLogSeverities(evidence.severities);

    if (at) {
      lines.push(mdText`- Logged at ${at}`);
    }
  }

  if (
    evidence.kind === LogInsightKind.MissingLogging &&
    evidence.gap === LogLoggingGap.SilentFailures
  ) {
    if (evidence.operationName) {
      lines.push(mdText`- Operation: \`${evidence.operationName}\``);
    }

    lines.push(
      mdText`- In the last hour: ${plural(evidence.operationSpanCount || 0, "request", "requests")}, ${formatCount(evidence.failedSpanCount || 0)} failed (${describeFailedShare(evidence)})`,
    );
    lines.push(
      mdText`- None of the ${plural(evidence.failedSampleSize || 0, "most recent failed request", "most recent failed requests")} wrote a log line`,
    );

    if (evidence.error) {
      lines.push(
        mdText`- The failed spans recorded: ${describeTraceError(evidence.error)}`,
      );
    }

    if (evidence.sampleTraceId) {
      lines.push(
        mdText`- A failed request: trace \`${evidence.sampleTraceId}\``,
      );
    }
  }

  if (
    evidence.kind === LogInsightKind.MissingLogging &&
    evidence.gap !== LogLoggingGap.SilentFailures
  ) {
    lines.push(
      mdText`- In the last hour: ${plural(evidence.logCount, "log", "logs")} and ${plural(evidence.serviceSpanCount || 0, "span", "spans")}`,
    );
    lines.push(
      mdText`- Logs with a trace id: ${formatCount(evidence.tracedLogCount || 0)} (${formatTracePercent(getTracedLogPercent({ logCount: evidence.logCount, tracedLogCount: evidence.tracedLogCount || 0 }))})`,
    );
    lines.push(
      mdText`- Without one, a request's logs cannot be read beside its trace`,
    );
  }

  for (const location of evidence.codeLocations || []) {
    lines.push(
      mdText`- Code: \`${location.filePath}${location.lineNumber ? `:${location.lineNumber}` : ""}\``,
    );
  }

  return FeedMarkdown.join(lines, "\n");
}

/*
 * The request's first line: what to do, and where - the task's title in
 * Code.
 */
export function getLogFixRequestTitle(data: {
  evidence: LogInsightEvidence;
  serviceName: string;
}): string {
  const evidence: LogInsightEvidence = data.evidence;
  const service: string = data.serviceName || "this service";
  const message: string = shortenLogPattern(evidence.pattern);

  switch (evidence.kind) {
    case LogInsightKind.Error:
      return `Fix why ${service} logs "${message}"`;
    case LogInsightKind.Noisy:
      return `Log "${message}" less in ${service}`;
    case LogInsightKind.MissingLogging:
    default:
      return evidence.gap === LogLoggingGap.SilentFailures
        ? `Log why ${withService(evidence.operationName || "this operation", data.serviceName)} fails`
        : `Add trace context to ${service}'s logs`;
  }
}

/*
 * What the AI is never to do with what a log line says: true of every
 * request, so said in each.
 */
export const LOG_FIX_PRIVACY_RULE: string =
  "Never log secrets or personal data, and never copy log lines into the pull request.";

// What the AI is asked to do, by kind - and what it must not.
function getLogFixAsk(evidence: LogInsightEvidence): string {
  const operation: string = evidence.operationName || "the operation";

  switch (evidence.kind) {
    case LogInsightKind.Error:
      return `Find the code that writes this log line: search the repository for the message's own words (the parts between the <...> placeholders). Find why it logs this error, change the code so it no longer fails this way, and add a test that reproduces it. If it logs at Error something that is not an error - an expected condition, input it refuses correctly - log it at the level it deserves instead, and keep what the line says. ${LOG_FIX_PRIVACY_RULE}`;
    case LogInsightKind.Noisy:
      return `Find the code that writes this log line: search the repository for the message's own words (the parts between the <...> placeholders). Make it log less without losing what someone reading the logs needs: log it at Debug, once for a batch or at an interval with a count, or not at all when it says nothing useful. Do not change what the code does otherwise. ${LOG_FIX_PRIVACY_RULE}`;
    case LogInsightKind.MissingLogging:
    default:
      return evidence.gap === LogLoggingGap.SilentFailures
        ? `Where ${operation} fails, log the failure: one record at Error severity that says what failed and why, with the ids that identify the request, written through the service's logger so it carries the request's trace context. Do not change what the code does. ${LOG_FIX_PRIVACY_RULE}`
        : `Make every log the service writes inside a request carry that request's trace and span ids, so its logs can be read beside its traces: route its logger through OpenTelemetry - its logging library's OpenTelemetry appender, handler or bridge, or the language's logging instrumentation - the way its traces are already sent. Do not change what it logs or what the code does. ${LOG_FIX_PRIVACY_RULE}`;
  }
}

// The leave OneUptime gives the AI on a task nobody waits on.
function getLogFixLeave(evidence: LogInsightEvidence): string {
  switch (evidence.kind) {
    case LogInsightKind.Error:
      return "If the cause is not in this repository's code - a dependency that is down, the environment, its configuration - say why and change nothing.";
    case LogInsightKind.Noisy:
      return "If the line is written by a library, a framework or the platform rather than this repository's code, say how to turn it down there and change nothing.";
    case LogInsightKind.MissingLogging:
    default:
      return evidence.gap === LogLoggingGap.SilentFailures
        ? "If these failures are logged somewhere other than this service - a gateway, a proxy, a worker - say where and change nothing."
        : "If the logs reach OneUptime through a collector or an agent that drops their trace context, say where and change nothing.";
  }
}

/*
 * What OneUptime asks the AI, for a finding: the title, what was found, and
 * what to do - said as OneUptime's own, with leave to change nothing, when
 * OneUptime starts the task itself (nobody waits on it to say otherwise).
 */
export function buildLogFixRequestMessage(data: {
  evidence: LogInsightEvidence;
  serviceName: string;
  isStartedByOneUptime: boolean;
}): string {
  const problem: string = describeLogProblem(data.evidence);

  return [
    getLogFixRequestTitle(data),
    "",
    data.isStartedByOneUptime
      ? `OneUptime found this in the service's logs on its own. ${problem}`
      : problem,
    "",
    data.isStartedByOneUptime
      ? `${getLogFixAsk(data.evidence)} ${getLogFixLeave(data.evidence)}`
      : getLogFixAsk(data.evidence),
  ].join("\n");
}

/*
 * What the task is told OneUptime found, in plain text: the deterministic
 * evidence - the message's pattern, never a line as it was logged.
 */
export function buildLogFixEvidenceNote(evidence: LogInsightEvidence): string {
  const lines: Array<string> = [];

  if (evidence.pattern) {
    lines.push(`Message pattern: ${evidence.pattern}`);
  }

  if (evidence.searchText) {
    lines.push(`Words to search the code for: ${evidence.searchText}`);
  }

  if (evidence.operationName) {
    lines.push(`Operation: ${evidence.operationName}`);
  }

  lines.push(
    `Window: ${evidence.windowStartTime} to ${evidence.windowEndTime}`,
  );
  lines.push(
    `Logs of the service in the window: ${formatCount(evidence.logCount)}`,
  );

  if (isFiniteNumber(evidence.errorLogCount)) {
    lines.push(
      `Error and Fatal logs of the service: ${formatCount(evidence.errorLogCount)}`,
    );
  }

  if (isFiniteNumber(evidence.patternCount)) {
    lines.push(
      evidence.kind === LogInsightKind.Noisy
        ? `Lines of this message (estimated): ${formatCount(evidence.patternCount)}`
        : `Lines of this message: ${formatCount(evidence.patternCount)}`,
    );
  }

  if (isFiniteNumber(evidence.patternPercent)) {
    lines.push(
      `Share of the lines read: ${formatTracePercent(evidence.patternPercent)} of ${formatCount(evidence.sampledLogCount || 0)}`,
    );
  }

  const at: string = describeLogSeverities(evidence.severities);

  if (at) {
    lines.push(`Severities: ${at}`);
  }

  if (isFiniteNumber(evidence.tracedLogCount)) {
    lines.push(`Logs with a trace id: ${formatCount(evidence.tracedLogCount)}`);
  }

  if (isFiniteNumber(evidence.serviceSpanCount)) {
    lines.push(
      `Spans of the service: ${formatCount(evidence.serviceSpanCount)}`,
    );
  }

  if (isFiniteNumber(evidence.operationSpanCount)) {
    lines.push(
      `Requests to the operation: ${formatCount(evidence.operationSpanCount)}, failed: ${formatCount(evidence.failedSpanCount || 0)}`,
    );
  }

  if (isFiniteNumber(evidence.failedSampleSize)) {
    lines.push(
      `Most recent failed requests read, none of which logged: ${formatCount(evidence.failedSampleSize)}`,
    );
  }

  const traceId: string | undefined =
    evidence.sampleTraceId || evidence.sampleTraceIds?.[0];

  if (traceId) {
    lines.push(`Sample trace: ${traceId}`);
  }

  if (evidence.error) {
    lines.push(
      "",
      `What the failed spans recorded: ${describeTraceError(evidence.error)}`,
    );

    if (evidence.error.stackTrace) {
      lines.push("Stack trace:", evidence.error.stackTrace);
    }
  }

  for (const location of evidence.codeLocations || []) {
    lines.push(
      `Code: ${location.filePath}${location.lineNumber ? `:${location.lineNumber}` : ""}${location.functionName ? ` (${location.functionName})` : ""}`,
    );
  }

  return lines.join("\n");
}

/*
 * The code locations the finding's evidence names, as a stack trace the
 * repository resolver reads ("    at fn (path:line)"), with a silent
 * failure's own stack trace after them.
 */
export function getLogInsightStackTrace(
  evidence: LogInsightEvidence | undefined | null,
): string | null {
  if (!evidence) {
    return null;
  }

  const lines: Array<string> = (evidence.codeLocations || []).map(
    (location: PerformanceCodeLocation): string => {
      return `    at ${location.functionName ? `${location.functionName} ` : ""}(${location.filePath}:${location.lineNumber ?? 1})`;
    },
  );

  if (evidence.error?.stackTrace) {
    lines.push(evidence.error.stackTrace);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/*
 * What the failed spans of a silent failure recorded, as its evidence keeps
 * it: the error the Traces reading found, its stack trace cut.
 */
export function toSilentFailureError(
  error: TraceInsightErrorEvidence | null | undefined,
): TraceInsightErrorEvidence | undefined {
  if (!error) {
    return undefined;
  }

  const kept: TraceInsightErrorEvidence = { ...error };

  if (kept.stackTrace) {
    kept.stackTrace = kept.stackTrace
      .split("\n")
      .slice(0, LOG_INSIGHT_STACK_TRACE_LINES)
      .join("\n");
  }

  return kept;
}
