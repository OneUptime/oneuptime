import AIInsightSeverity from "../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../Types/AI/AIInsightType";
import {
  TraceInsightErrorEvidence,
  TraceInsightEvidence,
} from "../../Types/AI/AIInsightEvidence";
import {
  PerformanceCodeLocation,
  PerformanceFinding,
  PerformanceFindingType,
} from "../../Types/AI/CodeFixTaskContext";
import {
  getFindingOperationName,
  getFindingsWorthFixing,
  isDatabaseFinding,
} from "../Suggestions/TracePerformanceFixSuggestion";
import SpanTreeAnalyzer, {
  AnalyzableSpan,
  DOMINANT_SPAN_MIN_FRACTION,
} from "./SpanTreeAnalyzer";

/*
 * PROBLEMS IN A SERVICE'S TRACES WORTH TELLING SOMEONE ABOUT - the gates the
 * Traces product's detector files its AI insights by (Server/Utils/AI/SRE/
 * Insights/Detectors/TraceProblemDetector), and that OneUptime AI then looks
 * into and opens a pull request for, as the project's trace AI rules say
 * (Types/AI/TelemetryAi). "Fix traces that are slow, error out, or need
 * more observability" - the maintainer. Three kinds:
 *
 *   - Slow operation (TraceSlowOperation): an operation of a service - its
 *     spans of one name - whose requests over the last hour are slow (a p99
 *     of a second or more, over 20 or more spans), and whose slowest request
 *     repeats a known pattern that costs it real time: the same call made
 *     again and again, calls made one after another that could run
 *     together, or one call that takes most of the request. "Costs real
 *     time" is the rule the trace page's "Fix performance with AI" follows
 *     (TracePerformanceFixSuggestion), so the finding names exactly what the
 *     button would offer to fix. Only patterns in the service's own spans
 *     count: a slow callee is the callee's finding, read in its own look;
 *
 *   - Failing operation (TraceFailingOperation): an operation 20 or more of
 *     whose spans failed (an error status) over the last hour, 5% or more of
 *     them, and whose failures say why - the exception or the error message
 *     the most recent ones recorded. Failures that only record OneUptime's
 *     own "fault" events are expected (a refused sign-in) and are not
 *     filed;
 *
 *   - Missing tracing (TraceMissingTracing): what a trace lacks to say why -
 *       NoChildSpans: a service whose 500 or more spans of the hour were each
 *         the only span of its trace, so nothing records what a request did
 *         inside it;
 *       UntracedTime: a slow operation whose slowest request spent 60% or
 *         more of its time (and half a second or more) in one span's own
 *         work, with no span under it to say where - when no known pattern
 *         explains the time;
 *       SilentFailures: a failing operation whose most recent failures
 *         recorded neither an error message nor an exception.
 *
 * One operation is one finding: failing first (a failure costs a user more
 * than a wait), then slow. Each service is read at most once an hour - its
 * slowest three, its three with the most failures and three with only root
 * spans - at most two operations each, and two findings each. A finding's
 * fingerprint is its kind, service and operation (its name with ids and
 * numbers collapsed, SpanTreeAnalyzer.normalizeSpanName), so the same problem
 * is one insight, refreshed while it lasts, and one pull request.
 *
 * Pure: the detector, the Dashboard, the tests and the docs suites read it
 * alike.
 */

// The window each look reads: the last hour, as the Traces explorer opens on.
export const TRACE_INSIGHT_WINDOW_MINUTES: number = 60;

// The fewest spans of a service in the hour for it to be read at all.
export const TRACE_INSIGHT_MIN_SERVICE_SPANS: number = 100;

/*
 * Slow: a p99 of at least a second, for the service and for the operation.
 * Below it, a "slow" request is dominated by noise nobody acts on.
 */
export const TRACE_INSIGHT_SLOW_P99_MS: number = 1000;

/*
 * The fewest spans an operation needs in the hour for its p99 or its
 * failure share to mean something: with a handful, the p99 is one request.
 */
export const TRACE_INSIGHT_MIN_OPERATION_SPANS: number = 20;

// Failing: at least this many failed spans in the hour, and this share.
export const TRACE_INSIGHT_MIN_FAILED_SPANS: number = 20;
export const TRACE_INSIGHT_MIN_FAILED_PERCENT: number = 5;

/*
 * Missing tracing, NoChildSpans: the fewest spans of the hour, each its
 * trace's only one, before a service is said to record nothing inside its
 * requests.
 */
export const TRACE_INSIGHT_MIN_NO_CHILD_SPANS: number = 500;

/*
 * Missing tracing, UntracedTime: the least time one span's own work must
 * take in a slow request, and its least share of the request - the
 * dominant-span rule of the span-tree analysis.
 */
export const TRACE_INSIGHT_MIN_UNTRACED_MS: number = 500;
export const TRACE_INSIGHT_MIN_UNTRACED_PERCENT: number =
  DOMINANT_SPAN_MIN_FRACTION * 100;

// The services read on each look, of each kind.
export const TRACE_INSIGHT_MAX_SLOW_SERVICES: number = 3;
export const TRACE_INSIGHT_MAX_FAILING_SERVICES: number = 3;
export const TRACE_INSIGHT_MAX_NO_CHILD_SPAN_SERVICES: number = 3;

/*
 * The operations of a service read closely on each look, of each kind, and
 * the findings kept of each service.
 */
export const TRACE_INSIGHT_OPERATIONS_PER_SERVICE: number = 2;
export const TRACE_INSIGHT_MAX_FINDINGS_PER_SERVICE: number = 2;

// The rows of a service's operations table each drill reads.
export const TRACE_INSIGHT_OPERATION_ROWS: number = 10;

// The most recent failed spans of an operation its failures are read from.
export const TRACE_INSIGHT_FAILED_SAMPLE_SIZE: number = 5;

// The patterns of a slow request kept on the finding, the costliest first.
export const TRACE_INSIGHT_MAX_FINDINGS_KEPT: number = 5;

// The busiest operations a NoChildSpans finding names.
export const TRACE_INSIGHT_TOP_OPERATIONS: number = 5;

// A finding this large is High; the rest Medium (missing tracing: Low).
export const TRACE_INSIGHT_HIGH_PERCENT_OF_REQUEST: number = 50;
export const TRACE_INSIGHT_HIGH_P99_MS: number = 5000;
export const TRACE_INSIGHT_HIGH_FAILED_PERCENT: number = 25;
export const TRACE_INSIGHT_HIGH_FAILED_SPANS: number = 1000;

// How much of a stack trace a failing finding keeps, in lines.
export const TRACE_INSIGHT_STACK_TRACE_LINES: number = 20;

export const TRACE_INSIGHT_FINGERPRINT_PREFIXES: {
  slow: string;
  failing: string;
  missingTracing: string;
} = {
  slow: "trace-slow",
  failing: "trace-failing",
  missingTracing: "trace-missing-tracing",
};

export enum TraceInsightKind {
  Slow = "Slow",
  Failing = "Failing",
  MissingTracing = "MissingTracing",
}

// What a trace lacks, for a MissingTracing finding.
export enum TraceTracingGap {
  NoChildSpans = "NoChildSpans",
  UntracedTime = "UntracedTime",
  SilentFailures = "SilentFailures",
}

export const TRACE_INSIGHT_TYPE_BY_KIND: Readonly<
  Record<TraceInsightKind, AIInsightType>
> = {
  [TraceInsightKind.Slow]: AIInsightType.TraceSlowOperation,
  [TraceInsightKind.Failing]: AIInsightType.TraceFailingOperation,
  [TraceInsightKind.MissingTracing]: AIInsightType.TraceMissingTracing,
};

export function isTraceInsightKind(value: unknown): value is TraceInsightKind {
  return (
    typeof value === "string" &&
    (Object.values(TraceInsightKind) as Array<string>).includes(value)
  );
}

export function isTraceTracingGap(value: unknown): value is TraceTracingGap {
  return (
    typeof value === "string" &&
    (Object.values(TraceTracingGap) as Array<string>).includes(value)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readId(id: string): string {
  return id.trim().toLowerCase();
}

export interface TraceInsightWindow {
  startTime: Date;
  endTime: Date;
}

// The hour a look reads.
export function getTraceInsightWindow(now: Date): TraceInsightWindow {
  return {
    startTime: new Date(now.getTime() - TRACE_INSIGHT_WINDOW_MINUTES * 60_000),
    endTime: new Date(now.getTime()),
  };
}

/*
 * STAGE ONE: every service at once, from the two per-minute aggregates the
 * span table keeps (its span count, failures and root spans by status, and
 * its p99): which services are read closely.
 */
export interface TraceServiceReading {
  serviceId: string;
  spanCount: number;
  failedSpanCount: number;
  rootSpanCount: number;
  // 0 when the latency aggregate did not list it.
  p99Ms: number;
}

function byWeightThenId(
  weight: (reading: TraceServiceReading) => number,
): (a: TraceServiceReading, b: TraceServiceReading) => number {
  return (a: TraceServiceReading, b: TraceServiceReading): number => {
    return (
      weight(b) - weight(a) ||
      b.spanCount - a.spanCount ||
      readId(a.serviceId).localeCompare(readId(b.serviceId))
    );
  };
}

function toIds(readings: Array<TraceServiceReading>): Array<string> {
  return readings.map((reading: TraceServiceReading): string => {
    return readId(reading.serviceId);
  });
}

function withoutExcluded(
  readings: ReadonlyArray<TraceServiceReading>,
  excludedServiceIds: ReadonlySet<string>,
): Array<TraceServiceReading> {
  return readings.filter((reading: TraceServiceReading): boolean => {
    return (
      Boolean(readId(reading.serviceId)) &&
      !excludedServiceIds.has(readId(reading.serviceId))
    );
  });
}

// The slow services, slowest first.
export function pickSlowServices(
  readings: ReadonlyArray<TraceServiceReading>,
  excludedServiceIds: ReadonlySet<string> = new Set<string>(),
): Array<string> {
  return toIds(
    withoutExcluded(readings, excludedServiceIds)
      .filter((reading: TraceServiceReading): boolean => {
        return (
          reading.spanCount >= TRACE_INSIGHT_MIN_SERVICE_SPANS &&
          isFiniteNumber(reading.p99Ms) &&
          reading.p99Ms >= TRACE_INSIGHT_SLOW_P99_MS
        );
      })
      .sort(
        byWeightThenId((reading: TraceServiceReading): number => {
          return reading.p99Ms;
        }),
      )
      .slice(0, TRACE_INSIGHT_MAX_SLOW_SERVICES),
  );
}

// The services with the most failures, enough of them to hold a finding.
export function pickFailingServices(
  readings: ReadonlyArray<TraceServiceReading>,
  excludedServiceIds: ReadonlySet<string> = new Set<string>(),
): Array<string> {
  return toIds(
    withoutExcluded(readings, excludedServiceIds)
      .filter((reading: TraceServiceReading): boolean => {
        return (
          reading.spanCount >= TRACE_INSIGHT_MIN_SERVICE_SPANS &&
          reading.failedSpanCount >= TRACE_INSIGHT_MIN_FAILED_SPANS
        );
      })
      .sort(
        byWeightThenId((reading: TraceServiceReading): number => {
          return reading.failedSpanCount;
        }),
      )
      .slice(0, TRACE_INSIGHT_MAX_FAILING_SERVICES),
  );
}

/*
 * The services whose every span of the hour was the root of its trace -
 * nothing recorded inside a request - busiest first.
 */
export function pickNoChildSpanServices(
  readings: ReadonlyArray<TraceServiceReading>,
  excludedServiceIds: ReadonlySet<string> = new Set<string>(),
): Array<string> {
  return toIds(
    withoutExcluded(readings, excludedServiceIds)
      .filter((reading: TraceServiceReading): boolean => {
        return (
          reading.spanCount >= TRACE_INSIGHT_MIN_NO_CHILD_SPANS &&
          reading.rootSpanCount >= reading.spanCount
        );
      })
      .sort(
        byWeightThenId((reading: TraceServiceReading): number => {
          return reading.spanCount;
        }),
      )
      .slice(0, TRACE_INSIGHT_MAX_NO_CHILD_SPAN_SERVICES),
  );
}

/*
 * STAGE TWO: one service's operations over the hour (its spans by name),
 * read for the services stage one picked.
 */
export interface TraceOperationReading {
  name: string;
  spanCount: number;
  failedSpanCount: number;
  p50Ms: number;
  p99Ms: number;
}

// The share of an operation's spans that failed, in percent.
export function getFailedPercent(reading: {
  spanCount: number;
  failedSpanCount: number;
}): number {
  if (!isFiniteNumber(reading.spanCount) || reading.spanCount <= 0) {
    return 0;
  }

  return (
    (Math.max(0, reading.failedSpanCount || 0) / reading.spanCount) * 100
  );
}

function hasName(reading: TraceOperationReading): boolean {
  return typeof reading.name === "string" && reading.name.trim().length > 0;
}

// Ties fall to volume, then to the name: a total, deterministic order.
function byThenVolumeThenName(
  weight: (reading: TraceOperationReading) => number,
): (a: TraceOperationReading, b: TraceOperationReading) => number {
  return (a: TraceOperationReading, b: TraceOperationReading): number => {
    return (
      weight(b) - weight(a) ||
      b.spanCount - a.spanCount ||
      a.name.localeCompare(b.name)
    );
  };
}

// The slow operations of a service, slowest first.
export function pickSlowOperations(
  readings: ReadonlyArray<TraceOperationReading>,
): Array<TraceOperationReading> {
  return readings
    .filter((reading: TraceOperationReading): boolean => {
      return (
        hasName(reading) &&
        reading.spanCount >= TRACE_INSIGHT_MIN_OPERATION_SPANS &&
        isFiniteNumber(reading.p99Ms) &&
        reading.p99Ms >= TRACE_INSIGHT_SLOW_P99_MS
      );
    })
    .sort(
      byThenVolumeThenName((reading: TraceOperationReading): number => {
        return reading.p99Ms;
      }),
    )
    .slice(0, TRACE_INSIGHT_OPERATIONS_PER_SERVICE);
}

// The failing operations of a service, the most failures first.
export function pickFailingOperations(
  readings: ReadonlyArray<TraceOperationReading>,
): Array<TraceOperationReading> {
  return readings
    .filter((reading: TraceOperationReading): boolean => {
      return (
        hasName(reading) &&
        reading.failedSpanCount >= TRACE_INSIGHT_MIN_FAILED_SPANS &&
        getFailedPercent(reading) >= TRACE_INSIGHT_MIN_FAILED_PERCENT
      );
    })
    .sort(
      byThenVolumeThenName((reading: TraceOperationReading): number => {
        return reading.failedSpanCount;
      }),
    )
    .slice(0, TRACE_INSIGHT_OPERATIONS_PER_SERVICE);
}

/*
 * A span as the slow-request reading reads it: the span-tree analysis'
 * shape, with its kind and the service that recorded it.
 */
export interface TraceInsightSpan extends AnalyzableSpan {
  // SpanKind as stored ("SPAN_KIND_CLIENT"), or OpenTelemetry's word.
  kind?: string | undefined;
  serviceId?: string | undefined;
  /*
   * A span under it was recorded by another service: a call whose callee
   * traces itself (getOperationRequestSpans sets it).
   */
  hasTracedCallee?: boolean | undefined;
}

// The attributes that say a span is a call to something else.
const CALL_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "db.system",
  "db.system.name",
  "db.statement",
  "db.query.text",
  "rpc.system",
  "messaging.system",
  "peer.service",
  "http.url",
  "url.full",
];

function readKind(kind: string | undefined): string {
  return (kind || "").trim().toUpperCase();
}

/*
 * Whether a span is a call to something else - a database, another service,
 * a queue - rather than the service's own work: a client or producer span,
 * or an internal one that carries a call's attributes. A server or consumer
 * span is the service's own entry point, never a call.
 */
export function isCallSpan(span: TraceInsightSpan): boolean {
  const kind: string = readKind(span.kind);

  if (kind.endsWith("SERVER") || kind.endsWith("CONSUMER")) {
    return false;
  }

  if (kind.endsWith("CLIENT") || kind.endsWith("PRODUCER")) {
    return true;
  }

  const attributes: Record<string, string> = span.attributes || {};

  return CALL_ATTRIBUTE_KEYS.some((key: string): boolean => {
    return Boolean(attributes[key]);
  });
}

/*
 * The request one operation's span stands for: that span and every span
 * under it the service itself recorded - a callee's spans are its own
 * service's (a slow callee is read in its own look), and with them gone a
 * slow call reads as the call it is, from the caller's side. A span whose
 * callee traces itself says so (hasTracedCallee).
 */
export function getOperationRequestSpans(data: {
  spans: ReadonlyArray<TraceInsightSpan>;
  operationSpanId: string;
  serviceId: string;
}): Array<TraceInsightSpan> {
  const serviceId: string = readId(data.serviceId);
  const childrenByParent: Map<string, Array<TraceInsightSpan>> = new Map<
    string,
    Array<TraceInsightSpan>
  >();
  let root: TraceInsightSpan | undefined = undefined;

  for (const span of data.spans) {
    if (span.spanId === data.operationSpanId) {
      root = span;
    }

    if (span.parentSpanId) {
      const children: Array<TraceInsightSpan> =
        childrenByParent.get(span.parentSpanId) || [];
      children.push(span);
      childrenByParent.set(span.parentSpanId, children);
    }
  }

  if (!root) {
    return [];
  }

  const seen: Set<string> = new Set<string>();
  const request: Array<TraceInsightSpan> = [];
  const queue: Array<TraceInsightSpan> = [root];

  while (queue.length > 0) {
    const span: TraceInsightSpan = queue.shift()!;

    if (seen.has(span.spanId)) {
      continue;
    }

    seen.add(span.spanId);

    const isOwn: boolean =
      span === root || readId(span.serviceId || serviceId) === serviceId;
    const children: Array<TraceInsightSpan> =
      childrenByParent.get(span.spanId) || [];

    if (isOwn) {
      request.push({
        ...span,
        hasTracedCallee: children.some((child: TraceInsightSpan): boolean => {
          return readId(child.serviceId || serviceId) !== serviceId;
        }),
      });
    }

    queue.push(...children);
  }

  return request;
}

// A request's own work no span under it accounts for.
export interface TraceUntracedTime {
  spanName: string;
  untracedMs: number;
  requestMs: number;
}

export interface SlowRequestReading {
  // The patterns worth fixing that the service's own code made.
  fixable: Array<PerformanceFinding>;
  // When none: time in one span's own work no span under it explains.
  untraced: TraceUntracedTime | null;
  requestMs: number;
}

function getRequestMs(spans: ReadonlyArray<AnalyzableSpan>): number {
  let start: number | null = null;
  let end: number | null = null;
  let longest: number = 0;

  for (const span of spans) {
    if (isFiniteNumber(span.startMs) && isFiniteNumber(span.endMs)) {
      start = start === null ? span.startMs : Math.min(start, span.startMs);
      end = end === null ? span.endMs : Math.max(end, span.endMs);
    }

    if (isFiniteNumber(span.durationMs)) {
      longest = Math.max(longest, span.durationMs);
    }
  }

  return start !== null && end !== null && end > start ? end - start : longest;
}

/*
 * What the slowest request of a slow operation says: the patterns worth
 * fixing in the service's own spans (the costliest first, as the analysis
 * ranks them), or - with none - time one span spent in its own work that
 * nothing under it accounts for. A span that dominates the request is a
 * pattern worth fixing when it is a call (a slow query, a slow third party:
 * make the call faster), and untraced time when it is the service's own
 * work. A call to a service that traces itself is that service's finding,
 * read in its own look: it is neither.
 */
export function readSlowRequest(
  spans: ReadonlyArray<TraceInsightSpan>,
): SlowRequestReading {
  const requestMs: number = getRequestMs(spans);
  const bySpanId: Map<string, TraceInsightSpan> = new Map<
    string,
    TraceInsightSpan
  >();

  for (const span of spans) {
    bySpanId.set(span.spanId, span);
  }

  const worthFixing: Array<PerformanceFinding> = getFindingsWorthFixing(
    SpanTreeAnalyzer.analyzeTrace([...spans]),
  );

  const fixable: Array<PerformanceFinding> = [];
  let untraced: TraceUntracedTime | null = null;

  for (const finding of worthFixing) {
    if (finding.findingType !== PerformanceFindingType.DominantSpan) {
      fixable.push(finding);
      continue;
    }

    const span: TraceInsightSpan | undefined = bySpanId.get(
      finding.implicatedSpans[0]?.spanId || "",
    );

    /*
     * The time a callee that traces itself spent is the callee's, read in
     * its own look - whether the span is a call or the service's own work.
     */
    if (span?.hasTracedCallee) {
      continue;
    }

    if (span && isCallSpan(span)) {
      fixable.push(finding);
      continue;
    }

    if (
      !untraced &&
      finding.combinedDurationMs >= TRACE_INSIGHT_MIN_UNTRACED_MS &&
      finding.percentOfTrace >= TRACE_INSIGHT_MIN_UNTRACED_PERCENT
    ) {
      untraced = {
        spanName: span?.name || finding.normalizedSpanName,
        untracedMs: finding.combinedDurationMs,
        requestMs: finding.traceDurationMs || requestMs,
      };
    }
  }

  return {
    fixable: fixable.slice(0, TRACE_INSIGHT_MAX_FINDINGS_KEPT),
    untraced: fixable.length > 0 ? null : untraced,
    requestMs,
  };
}

/*
 * One failed span, as the failing reading reads it - every text already
 * sanitized by the server (an error message is whatever made the request
 * fail).
 */
export interface FailedSpanSample {
  traceId: string;
  spanId: string;
  statusMessage?: string | undefined;
  exceptionType?: string | undefined;
  exceptionMessage?: string | undefined;
  stackTrace?: string | undefined;
  // It recorded an "exception" event.
  hasException: boolean;
  /*
   * It recorded only OneUptime's "fault" event: a failure the code meant
   * (SpanEventType.Fault - invalid input refused, a plan limit enforced).
   */
  hasFaultEvent: boolean;
  // The HTTP or RPC status it answered with.
  statusCode?: string | undefined;
  codeLocation?: PerformanceCodeLocation | undefined;
}

export enum TraceFailureVerdict {
  /*
   * No failed span could be read (they aged out between the two reads):
   * nothing is known, so nothing is filed.
   */
  Unread = "Unread",
  // The failures say why: a Failing operation.
  Described = "Described",
  // They say nothing about why: missing tracing (SilentFailures).
  Silent = "Silent",
  // They are failures the code meant: nothing to file.
  Expected = "Expected",
}

export interface FailedSpansReading {
  verdict: TraceFailureVerdict;
  // Described: the most common error of the sample.
  error: TraceInsightErrorEvidence | null;
  // The failed span the evidence is read from.
  sample: FailedSpanSample | null;
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function describesFailure(sample: FailedSpanSample): boolean {
  return (
    hasText(sample.statusMessage) ||
    hasText(sample.exceptionType) ||
    hasText(sample.exceptionMessage)
  );
}

// The error a failed span names: its exception, else its status message.
export function getFailureKey(sample: FailedSpanSample): string {
  if (hasText(sample.exceptionType) || hasText(sample.exceptionMessage)) {
    return `exception\u0000${sample.exceptionType || ""}\u0000${sample.exceptionMessage || ""}`;
  }

  return `status\u0000${sample.statusMessage || ""}`;
}

/*
 * What an operation's most recent failures say, newest first: Unread when
 * there are none to read, Expected when each recorded only a fault (and no
 * exception), Silent when none says why, else Described, with the error the
 * most of them failed with (the newest of those on a tie).
 */
export function readFailedSpans(
  samples: ReadonlyArray<FailedSpanSample>,
): FailedSpansReading {
  if (samples.length === 0) {
    return {
      verdict: TraceFailureVerdict.Unread,
      error: null,
      sample: null,
    };
  }

  if (
    samples.every((sample: FailedSpanSample): boolean => {
      return sample.hasFaultEvent && !sample.hasException;
    })
  ) {
    return {
      verdict: TraceFailureVerdict.Expected,
      error: null,
      sample: samples[0] || null,
    };
  }

  const described: Array<FailedSpanSample> = samples.filter(describesFailure);

  if (described.length === 0) {
    return {
      verdict: TraceFailureVerdict.Silent,
      error: null,
      sample: samples[0] || null,
    };
  }

  const groups: Map<string, Array<FailedSpanSample>> = new Map<
    string,
    Array<FailedSpanSample>
  >();

  for (const sample of described) {
    const key: string = getFailureKey(sample);
    const group: Array<FailedSpanSample> = groups.get(key) || [];
    group.push(sample);
    groups.set(key, group);
  }

  let best: Array<FailedSpanSample> = [];

  // Map keeps insertion order: the newest error first, so a tie keeps it.
  for (const group of groups.values()) {
    if (group.length > best.length) {
      best = group;
    }
  }

  const sample: FailedSpanSample = best[0]!;
  const error: TraceInsightErrorEvidence = {
    sampleMatches: best.length,
    sampleSize: samples.length,
  };

  if (hasText(sample.exceptionType)) {
    error.exceptionType = sample.exceptionType;
  }

  if (hasText(sample.exceptionMessage)) {
    error.exceptionMessage = sample.exceptionMessage;
  }

  if (hasText(sample.stackTrace)) {
    error.stackTrace = sample.stackTrace
      .split("\n")
      .slice(0, TRACE_INSIGHT_STACK_TRACE_LINES)
      .join("\n");
  }

  if (hasText(sample.statusMessage)) {
    error.statusMessage = sample.statusMessage;
  }

  if (hasText(sample.statusCode)) {
    error.statusCode = sample.statusCode;
  }

  return { verdict: TraceFailureVerdict.Described, error, sample };
}

/*
 * The finding's identity: its kind, its service and its operation with the
 * parts that change from request to request collapsed ("GET /users/{n}").
 */
export function getTraceInsightFingerprint(data: {
  kind: TraceInsightKind;
  serviceId: string;
  operationName?: string | undefined;
  gap?: TraceTracingGap | undefined;
}): string {
  const operation: string = SpanTreeAnalyzer.normalizeSpanName(
    data.operationName || "",
  );
  const serviceId: string = readId(data.serviceId);

  switch (data.kind) {
    case TraceInsightKind.Slow:
      return [
        TRACE_INSIGHT_FINGERPRINT_PREFIXES.slow,
        serviceId,
        operation,
      ].join(":");
    case TraceInsightKind.Failing:
      return [
        TRACE_INSIGHT_FINGERPRINT_PREFIXES.failing,
        serviceId,
        operation,
      ].join(":");
    case TraceInsightKind.MissingTracing:
    default:
      return [
        TRACE_INSIGHT_FINGERPRINT_PREFIXES.missingTracing,
        serviceId,
        data.gap || TraceTracingGap.NoChildSpans,
        operation,
      ].join(":");
  }
}

// Whether a fingerprint is one of a service's trace findings.
export function isTraceInsightFingerprintOfService(
  fingerprint: string,
  serviceId: string,
): boolean {
  const lowered: string = (fingerprint || "").toLowerCase();
  const id: string = readId(serviceId);

  if (!id) {
    return false;
  }

  return Object.values(TRACE_INSIGHT_FINGERPRINT_PREFIXES).some(
    (prefix: string): boolean => {
      return lowered.startsWith(`${prefix}:${id}:`);
    },
  );
}

// A share in percent, as the findings say it: "12%", "5.4%", "0.8%".
export function formatTracePercent(percent: number): string {
  if (!isFiniteNumber(percent)) {
    return "0%";
  }

  const rounded: number =
    Math.abs(percent) >= 10
      ? Math.round(percent)
      : Math.round(percent * 10) / 10;

  return `${rounded}%`;
}

// A duration, as the findings say it: "840 ms", "2.4 s", "12 s".
export function formatTraceDuration(ms: number): string {
  if (!isFiniteNumber(ms) || ms < 0) {
    return "0 ms";
  }

  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }

  const seconds: number = ms / 1000;

  return seconds >= 10
    ? `${Math.round(seconds)} s`
    : `${Math.round(seconds * 10) / 10} s`;
}

function formatCount(count: number): string {
  return Math.round(count).toLocaleString("en-US");
}

/*
 * What a finding a slow request repeats does, as a clause: "runs the same
 * database query 40 times", "makes 6 calls to GET /price one after another".
 */
export function describeSlowFinding(finding: PerformanceFinding): string {
  const isDatabase: boolean = isDatabaseFinding(finding);
  const operation: string = getFindingOperationName(finding);

  switch (finding.findingType) {
    case PerformanceFindingType.SequentialSiblings:
      return isDatabase
        ? `runs ${formatCount(finding.spanCount)} database calls one after another`
        : `makes ${formatCount(finding.spanCount)} calls to ${operation} one after another`;
    case PerformanceFindingType.DominantSpan:
      return isDatabase
        ? "spends most of its time in one database query"
        : `spends most of its time in ${operation}`;
    case PerformanceFindingType.NPlusOneQuery:
    default:
      return isDatabase
        ? `runs the same database query ${formatCount(finding.spanCount)} times`
        : `calls ${operation} ${formatCount(finding.spanCount)} times`;
  }
}

/*
 * The same, as the request message and the evidence say it - with what it
 * costs: "the same database query ran 40 times under GET /orders: 1.9 s
 * together, 73% of the request".
 */
export function describeSlowFindingCost(finding: PerformanceFinding): string {
  const isDatabase: boolean = isDatabaseFinding(finding);
  const operation: string = getFindingOperationName(finding);
  const under: string = finding.parentSpanName
    ? ` under ${finding.parentSpanName}`
    : "";
  const cost: string = `${formatTraceDuration(finding.combinedDurationMs)} together, ${formatTracePercent(finding.percentOfTrace)} of the request`;

  switch (finding.findingType) {
    case PerformanceFindingType.SequentialSiblings:
      return isDatabase
        ? `${formatCount(finding.spanCount)} database calls ran one after another${under}: ${cost}, and they could run at the same time`
        : `${formatCount(finding.spanCount)} calls to ${operation} ran one after another${under}: ${cost}, and they could run at the same time`;
    case PerformanceFindingType.DominantSpan:
      return isDatabase
        ? `one database query took ${formatTraceDuration(finding.combinedDurationMs)} of it on its own, ${formatTracePercent(finding.percentOfTrace)} of the request`
        : `${operation} took ${formatTraceDuration(finding.combinedDurationMs)} of it on its own, ${formatTracePercent(finding.percentOfTrace)} of the request`;
    case PerformanceFindingType.NPlusOneQuery:
    default:
      return isDatabase
        ? `the same database query ran ${formatCount(finding.spanCount)} times${under}: ${cost}`
        : `${operation} ran ${formatCount(finding.spanCount)} times${under}: ${cost}`;
  }
}

function withService(operation: string, serviceName: string): string {
  return serviceName ? `${operation} in ${serviceName}` : operation;
}

// The insight's title: what was found, in a sentence.
export function getTraceInsightTitle(data: {
  evidence: TraceInsightEvidence;
  serviceName: string;
}): string {
  const evidence: TraceInsightEvidence = data.evidence;
  const operation: string = evidence.operationName || "An operation";
  const subject: string = withService(operation, data.serviceName);

  switch (evidence.kind) {
    case TraceInsightKind.Slow: {
      const finding: PerformanceFinding | undefined =
        evidence.performanceFindings?.[0];

      return finding
        ? `${subject} ${describeSlowFinding(finding)}`
        : `${subject} is slow`;
    }
    case TraceInsightKind.Failing:
      return `${subject} fails ${formatTracePercent(getFailedPercent({ spanCount: evidence.spanCount, failedSpanCount: evidence.failedSpanCount || 0 }))} of the time`;
    case TraceInsightKind.MissingTracing:
    default:
      switch (evidence.gap) {
        case TraceTracingGap.UntracedTime:
          return `${subject} spends ${formatTracePercent(
            evidence.untracedMs && evidence.sampleDurationMs
              ? (evidence.untracedMs / evidence.sampleDurationMs) * 100
              : 0,
          )} of its time untraced`;
        case TraceTracingGap.SilentFailures:
          return `${subject} fails without saying why`;
        case TraceTracingGap.NoChildSpans:
        default:
          return `${data.serviceName || "A service"}'s requests have no spans inside them`;
      }
  }
}

export function getTraceInsightSeverity(
  evidence: TraceInsightEvidence,
): AIInsightSeverity {
  switch (evidence.kind) {
    case TraceInsightKind.Slow: {
      const top: number = evidence.performanceFindings?.[0]?.percentOfTrace || 0;

      return top >= TRACE_INSIGHT_HIGH_PERCENT_OF_REQUEST ||
        (evidence.p99Ms || 0) >= TRACE_INSIGHT_HIGH_P99_MS
        ? AIInsightSeverity.High
        : AIInsightSeverity.Medium;
    }
    case TraceInsightKind.Failing: {
      const failed: number = evidence.failedSpanCount || 0;

      return getFailedPercent({
        spanCount: evidence.spanCount,
        failedSpanCount: failed,
      }) >= TRACE_INSIGHT_HIGH_FAILED_PERCENT ||
        failed >= TRACE_INSIGHT_HIGH_FAILED_SPANS
        ? AIInsightSeverity.High
        : AIInsightSeverity.Medium;
    }
    case TraceInsightKind.MissingTracing:
    default:
      // Failing without a reason costs users; the rest costs visibility.
      return evidence.gap === TraceTracingGap.SilentFailures
        ? AIInsightSeverity.Medium
        : AIInsightSeverity.Low;
  }
}

/*
 * One line naming the error a failing operation failed with:
 * "TimeoutError: payment provider did not answer (HTTP 503)".
 */
export function describeTraceError(error: TraceInsightErrorEvidence): string {
  const exception: string = [error.exceptionType, error.exceptionMessage]
    .filter(hasText)
    .join(": ");
  const text: string = exception || error.statusMessage || "an error";

  return error.statusCode ? `${text} (status ${error.statusCode})` : text;
}

function describeWindowRequests(evidence: TraceInsightEvidence): string {
  return `${formatCount(evidence.spanCount)} request${evidence.spanCount === 1 ? "" : "s"}`;
}

/*
 * What the problem is, in sentences: the opening of the request OneUptime
 * writes, and of the person's.
 */
export function describeTraceProblem(evidence: TraceInsightEvidence): string {
  switch (evidence.kind) {
    case TraceInsightKind.Slow: {
      const finding: PerformanceFinding | undefined =
        evidence.performanceFindings?.[0];
      const p99: string = evidence.p99Ms
        ? `Over the last hour its slowest requests took ${formatTraceDuration(evidence.p99Ms)} (p99 of ${describeWindowRequests(evidence)}).`
        : "";
      const slowest: string = finding
        ? `In the slowest one${evidence.sampleDurationMs ? ` (${formatTraceDuration(evidence.sampleDurationMs)})` : ""}, ${describeSlowFindingCost(finding)}.`
        : "";

      return [p99, slowest].filter(hasText).join(" ");
    }
    case TraceInsightKind.Failing: {
      const failed: number = evidence.failedSpanCount || 0;
      const share: string = formatTracePercent(
        getFailedPercent({
          spanCount: evidence.spanCount,
          failedSpanCount: failed,
        }),
      );
      const said: string = evidence.error
        ? `${formatCount(evidence.error.sampleMatches)} of the ${formatCount(evidence.error.sampleSize)} most recent failures failed with: ${describeTraceError(evidence.error)}.`
        : "";

      return [
        `Over the last hour ${formatCount(failed)} of its ${describeWindowRequests(evidence)} failed (${share}).`,
        said,
      ]
        .filter(hasText)
        .join(" ");
    }
    case TraceInsightKind.MissingTracing:
    default:
      switch (evidence.gap) {
        case TraceTracingGap.UntracedTime:
          return `In its slowest request over the last hour${evidence.sampleDurationMs ? ` (${formatTraceDuration(evidence.sampleDurationMs)})` : ""}, ${formatTraceDuration(evidence.untracedMs || 0)} was spent in ${evidence.untracedSpanName || "one span"} itself, with no span under it to say where.`;
        case TraceTracingGap.SilentFailures: {
          const failed: number = evidence.failedSpanCount || 0;

          return `Over the last hour ${formatCount(failed)} of its ${describeWindowRequests(evidence)} failed (${formatTracePercent(getFailedPercent({ spanCount: evidence.spanCount, failedSpanCount: failed }))}), and none of the most recent failures recorded an error message or an exception, so nobody can tell why they fail.`;
        }
        case TraceTracingGap.NoChildSpans:
        default: {
          const busiest: string =
            evidence.topOperations && evidence.topOperations.length > 0
              ? ` Its busiest operations: ${evidence.topOperations
                  .map((operation: { name: string; spanCount: number }) => {
                    return `${operation.name} (${formatCount(operation.spanCount)})`;
                  })
                  .join(", ")}.`
              : "";

          return `It sent ${formatCount(evidence.spanCount)} spans over the last hour, and every one was its trace's only span: nothing records what a request did inside it, so when a request is slow or fails, its trace cannot say why.${busiest}`;
        }
      }
  }
}

/*
 * The request's first line: what to do, and where - the task's title in
 * Code.
 */
export function getTraceFixRequestTitle(data: {
  evidence: TraceInsightEvidence;
  serviceName: string;
}): string {
  const evidence: TraceInsightEvidence = data.evidence;
  const operation: string = evidence.operationName || "this operation";
  const subject: string = withService(operation, data.serviceName);

  switch (evidence.kind) {
    case TraceInsightKind.Slow:
      return `Make ${subject} faster`;
    case TraceInsightKind.Failing:
      return `Fix why ${subject} fails`;
    case TraceInsightKind.MissingTracing:
    default:
      switch (evidence.gap) {
        case TraceTracingGap.UntracedTime:
          return `Add tracing inside ${subject}`;
        case TraceTracingGap.SilentFailures:
          return `Record why ${subject} fails`;
        case TraceTracingGap.NoChildSpans:
        default:
          return `Add tracing inside ${data.serviceName || "this service"}'s requests`;
      }
  }
}

// What the AI is asked to do, by kind - and what it must not.
function getTraceFixAsk(evidence: TraceInsightEvidence): string {
  const operation: string = evidence.operationName || "the operation";

  switch (evidence.kind) {
    case TraceInsightKind.Slow:
      return "The trace attached shows every step of that request, and the note what OneUptime found in it. Change the code so it does this work in less time - one query or call for all of them, calls that run at the same time, or a faster call - keep its behaviour the same, and add or update tests that show it still works.";
    case TraceInsightKind.Failing:
      return "The trace attached shows one of these requests, and the note the error and where it was raised. Find why it fails, change the code so it does not, and add a test that reproduces the failure. If it fails on purpose - bad input from its callers, a refused request - make it answer that way without recording an error, rather than hide a real failure.";
    case TraceInsightKind.MissingTracing:
    default:
      switch (evidence.gap) {
        case TraceTracingGap.UntracedTime:
          return `The trace attached shows that request. Add OpenTelemetry spans around the steps ${operation} runs - each database query, call and expensive piece of work - with the attributes that say what each did, so the next slow request shows where its time goes. Do not change what the code does; if you see why it is slow, say so.`;
        case TraceTracingGap.SilentFailures:
          return `Where ${operation} fails, record the exception on its span and set the span's error status with a message that says what went wrong. Do not change what the code does, and record no secrets or personal data. If you find why it fails, say so.`;
        case TraceTracingGap.NoChildSpans:
        default:
          return "Add OpenTelemetry tracing inside its requests: instrument the libraries it uses for HTTP calls, databases and queues (prefer their OpenTelemetry instrumentation packages), and add spans around its own main steps, with the attributes that say what each did. Record exceptions on the spans that fail. Do not change what the code does.";
      }
  }
}

// The leave OneUptime gives the AI on a task nobody waits on.
function getTraceFixLeave(evidence: TraceInsightEvidence): string {
  switch (evidence.kind) {
    case TraceInsightKind.Slow:
      return "If it cannot be made meaningfully faster without changing what it does, or the time is not spent in this repository's code, say why and change nothing.";
    case TraceInsightKind.Failing:
      return "If the cause is not in this repository's code, say why and change nothing.";
    case TraceInsightKind.MissingTracing:
    default:
      return "If this service's tracing is set up somewhere other than this repository, say where and change nothing.";
  }
}

/*
 * What OneUptime asks the AI, for a finding: the title, what was found, and
 * what to do - said as OneUptime's own, with leave to change nothing, when
 * OneUptime starts the task itself (nobody waits on it to say otherwise).
 */
export function buildTraceFixRequestMessage(data: {
  evidence: TraceInsightEvidence;
  serviceName: string;
  isStartedByOneUptime: boolean;
}): string {
  const problem: string = describeTraceProblem(data.evidence);

  return [
    getTraceFixRequestTitle(data),
    "",
    data.isStartedByOneUptime
      ? `OneUptime found this in the service's traces on its own. ${problem}`
      : problem,
    "",
    data.isStartedByOneUptime
      ? `${getTraceFixAsk(data.evidence)} ${getTraceFixLeave(data.evidence)}`
      : getTraceFixAsk(data.evidence),
  ].join("\n");
}

/*
 * What the task is told OneUptime found, beside the trace (whose spans may
 * be gone by the time it runs): the deterministic evidence, in plain text.
 */
export function buildTraceFixEvidenceNote(
  evidence: TraceInsightEvidence,
): string {
  const lines: Array<string> = [];

  if (evidence.operationName) {
    lines.push(`Operation: ${evidence.operationName}`);
  }

  lines.push(
    `Window: ${evidence.windowStartTime} to ${evidence.windowEndTime}`,
  );
  lines.push(`Spans in the window: ${formatCount(evidence.spanCount)}`);

  if (evidence.failedSpanCount !== undefined) {
    lines.push(`Failed spans: ${formatCount(evidence.failedSpanCount)}`);
  }

  if (evidence.p99Ms) {
    lines.push(`p99: ${formatTraceDuration(evidence.p99Ms)}`);
  }

  if (evidence.sampleTraceId) {
    lines.push(`Sample trace: ${evidence.sampleTraceId}`);
  }

  for (const finding of evidence.performanceFindings || []) {
    lines.push("", finding.headline, finding.evidence);

    if (finding.normalizedDbStatement) {
      lines.push(`Statement: ${finding.normalizedDbStatement}`);
    }
  }

  if (evidence.untracedSpanName) {
    lines.push(
      "",
      `Untraced: ${evidence.untracedSpanName}, ${formatTraceDuration(evidence.untracedMs || 0)} of its own work`,
    );
  }

  if (evidence.error) {
    lines.push("", `Error: ${describeTraceError(evidence.error)}`);

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
 * repository resolver reads ("    at fn (path:line)"), with the error's own
 * stack trace after them.
 */
export function getTraceInsightStackTrace(
  evidence: TraceInsightEvidence | undefined | null,
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
