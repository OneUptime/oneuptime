import {
  PerformanceCodeLocation,
  PerformanceFinding,
} from "./CodeFixTaskContext";

/*
 * The JSON persisted on AIInsight.evidence.
 *
 * Evidence is computed DETERMINISTICALLY at detect time and stored verbatim
 * because ClickHouse retention is short — the stored evidence must outlive
 * the raw signals it was computed from (the FixPerformance taskContext
 * precedent: by the time anyone looks, the spans/logs may already be gone).
 * It is rendered in the dashboard and embedded in triage prompts, so every
 * field must carry the real numbers and stand on its own.
 *
 * Exactly one of the per-type sections is set, matching the insight's
 * AIInsightType. These shapes are a wire contract — do not rename
 * fields.
 */

// Evidence for NewException and ExceptionSpike insights.
export interface ExceptionInsightEvidence {
  exceptionMessage?: string | undefined;
  exceptionType?: string | undefined;
  // Occurrences in the recent (spike) window.
  recentOccurrenceCount?: number | undefined;
  // Average hourly occurrences over the prior baseline window.
  baselineHourlyAverage?: number | undefined;
  // recent rate / baseline rate.
  spikeMultiplier?: number | undefined;
  // Lifetime occurrence count of the exception.
  totalOccurrenceCount?: number | undefined;
  /*
   * How many distinct TelemetryException groups (i.e. stack-trace variants of
   * the same type + normalized message) this finding rolls up. 1 for the
   * ordinary case; higher when one throw site surfaces on several call paths.
   */
  distinctExceptionGroupCount?: number | undefined;
  // ISO-8601 — when the exception was first ever seen.
  firstSeenAt?: string | undefined;
}

// Evidence for ErrorLogSpike insights.
export interface LogSpikeInsightEvidence {
  recentErrorCount: number;
  baselineHourlyAverage: number;
  spikeMultiplier: number;
  windowMinutes: number;
  topServices: Array<{ serviceName: string; count: number }>;
}

// Evidence for TraceLatencyRegression insights.
export interface LatencyInsightEvidence {
  recentP99Ms: number;
  baselineP99Ms: number;
  regressionMultiplier: number;
  operationName?: string | undefined;
  sampleTraceId?: string | undefined;
  // Deterministic span-tree findings drilled from the sample trace.
  performanceFindings?: Array<PerformanceFinding> | undefined;
  // code.* attribute locations for stack-trace-style repo resolution.
  codeLocations?: Array<PerformanceCodeLocation> | undefined;
}

// Evidence for MetricDrift insights (week-over-week mean comparison).
export interface MetricDriftInsightEvidence {
  metricName: string;
  primaryEntityId?: string | undefined;
  recentWeekMean: number;
  priorWeekMean: number;
  relativeChangePercent: number;
  recentSampleCount: number;
  priorSampleCount: number;
}

// One side of a DeployRegression: a service's telemetry over one window.
export interface DeployRegressionWindowEvidence {
  durationMinutes: number;
  spanCount: number;
  errorSpanCount: number;
  p99Ms: number;
  exceptionCount: number;
}

/*
 * Evidence for DeployRegression insights: the recorded change, and the
 * service's telemetry in the window before and after it.
 */
export interface DeployRegressionInsightEvidence {
  // The change event (ChangeEvent) the regression followed.
  changeId: string;
  // ISO-8601.
  changeTime: string;
  changeTitle: string;
  changeType: string;
  version?: string | undefined;
  previousVersion?: string | undefined;
  // Short.
  commitSha?: string | undefined;
  environment?: string | undefined;
  // Where the change was recorded from (oneuptime.change.source).
  source?: string | undefined;
  // What moved, as ChangeImpact words it.
  reasons: Array<string>;
  before: DeployRegressionWindowEvidence;
  after: DeployRegressionWindowEvidence;
  newExceptionTypes: Array<{ exceptionType: string; occurrenceCount: number }>;
}

// One function next to the slow one in its profile: a caller or a callee.
export interface ProfileInsightNeighbourEvidence {
  functionName: string;
  fileName: string;
  // 0-100: its time from or below the slow function, as a share of the window.
  share: number;
}

/*
 * Evidence for ProfileHotspot insights: one function of a service's own
 * code, its own-code share of the service's time over the window (the time
 * in it and in the library, runtime and system code it calls), and - when
 * it grew - the share it took in the baseline window.
 */
export interface ProfileInsightEvidence {
  serviceId: string;
  functionName: string;
  // As the profile shows it ("" for a frame with no file).
  fileName: string;
  // The line of its heaviest stack; 0 when the profiler recorded none.
  lineNumber: number;
  /*
   * The kind read, as the Profiler selects it ("cpu", "wall"), and its
   * category (Utils/Profiles/ProfileTypes ProfileCategory).
   */
  profileType: string;
  category: string;
  // Why it was filed: "Hot" (a large share) or "Grew" (ProfileFixReason).
  reason: string;
  // 0-100.
  ownShare: number;
  ownShareBefore?: number | undefined;
  functionSampleCount: number;
  windowSampleCount: number;
  // ISO-8601: the window read, and the one it was compared with.
  windowStartTime: string;
  windowEndTime: string;
  baselineStartTime?: string | undefined;
  baselineEndTime?: string | undefined;
  // Who calls it, and what it spends its time calling, heaviest first.
  callers: Array<ProfileInsightNeighbourEvidence>;
  callees: Array<ProfileInsightNeighbourEvidence>;
}

/*
 * What a failing operation failed with, read off a sample of its failed
 * spans (Utils/Traces/TraceInsight): the most common error of the sample,
 * already sanitized (ExceptionSanitizer) - an error message is written by
 * whatever made the request fail, never by OneUptime.
 */
export interface TraceInsightErrorEvidence {
  // The recorded exception's type and message, when the spans recorded one.
  exceptionType?: string | undefined;
  exceptionMessage?: string | undefined;
  // The top frames of its stack trace, sanitized and cut.
  stackTrace?: string | undefined;
  // The span's own status message, when it set one.
  statusMessage?: string | undefined;
  // The HTTP or RPC status the failed request answered with.
  statusCode?: string | undefined;
  // How many of the sampled failed spans failed with this error.
  sampleMatches: number;
  sampleSize: number;
}

/*
 * Evidence for the Traces product's insights (TraceSlowOperation,
 * TraceFailingOperation, TraceMissingTracing): one service's operation over
 * the window it was read in, and what was found in it. `kind` says which of
 * the three it is; `gap` says, for missing tracing, what the traces lack.
 */
export interface TraceInsightEvidence {
  serviceId: string;
  // "Slow", "Failing" or "MissingTracing" (Utils/Traces/TraceInsight).
  kind: string;
  // MissingTracing only: "NoChildSpans", "UntracedTime" or "SilentFailures".
  gap?: string | undefined;
  // The operation (its span name), absent when the finding is the service's.
  operationName?: string | undefined;
  // ISO-8601: the hour it was read in.
  windowStartTime: string;
  windowEndTime: string;
  // The operation's spans in the window, or the service's.
  spanCount: number;
  failedSpanCount?: number | undefined;
  // The operation's (or the service's) latency over the window.
  p50Ms?: number | undefined;
  p99Ms?: number | undefined;
  // The request the evidence was read from: a slow one, or a failed one.
  sampleTraceId?: string | undefined;
  sampleSpanId?: string | undefined;
  // How long that request took.
  sampleDurationMs?: number | undefined;
  // Slow: the patterns worth fixing in it, the costliest first.
  performanceFindings?: Array<PerformanceFinding> | undefined;
  // UntracedTime: the span whose own work no span under it accounts for.
  untracedSpanName?: string | undefined;
  untracedMs?: number | undefined;
  // Failing: what it failed with.
  error?: TraceInsightErrorEvidence | undefined;
  // NoChildSpans: its busiest operations, to start the tracing from.
  topOperations?: Array<{ name: string; spanCount: number }> | undefined;
  // code.* attribute locations, to find the repository that holds the code.
  codeLocations?: Array<PerformanceCodeLocation> | undefined;
}

export interface AIInsightEvidence {
  exception?: ExceptionInsightEvidence | undefined;
  logSpike?: LogSpikeInsightEvidence | undefined;
  latency?: LatencyInsightEvidence | undefined;
  metricDrift?: MetricDriftInsightEvidence | undefined;
  deployRegression?: DeployRegressionInsightEvidence | undefined;
  profile?: ProfileInsightEvidence | undefined;
  trace?: TraceInsightEvidence | undefined;
}

export default AIInsightEvidence;
