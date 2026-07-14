import {
  PerformanceCodeLocation,
  PerformanceFinding,
} from "./CodeFixTaskContext";

/*
 * The JSON persisted on SentinelInsight.evidence.
 *
 * Evidence is computed DETERMINISTICALLY at detect time and stored verbatim
 * because ClickHouse retention is short — the stored evidence must outlive
 * the raw signals it was computed from (the FixPerformance taskContext
 * precedent: by the time anyone looks, the spans/logs may already be gone).
 * It is rendered in the dashboard and embedded in triage prompts, so every
 * field must carry the real numbers and stand on its own.
 *
 * Exactly one of the per-type sections is set, matching the insight's
 * SentinelInsightType. These shapes are a wire contract — do not rename
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

export interface SentinelInsightEvidence {
  exception?: ExceptionInsightEvidence | undefined;
  logSpike?: LogSpikeInsightEvidence | undefined;
  latency?: LatencyInsightEvidence | undefined;
  metricDrift?: MetricDriftInsightEvidence | undefined;
}

export default SentinelInsightEvidence;
