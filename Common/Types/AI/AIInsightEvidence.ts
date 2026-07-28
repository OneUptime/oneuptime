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

/*
 * Evidence for ContainerCrashLoop insights.
 *
 * The only evidence shape carrying structured INFRASTRUCTURE identity —
 * AIInsight's own subject columns are all telemetry concepts (serviceName,
 * telemetryServiceId, telemetryExceptionId, traceId, metricName), so this is
 * where a downstream reader learns which pod to go and look at.
 *
 * `classifiedCause` is the CrashLoopClassifier's verdict, computed
 * deterministically at detect time before any LLM sees the finding.
 */
export interface KubernetesCrashLoopEvidence {
  clusterName?: string | undefined;
  namespace: string;
  podName: string;
  containerName: string;
  isInitContainer: boolean;
  controllerKind?: string | undefined;
  controllerName?: string | undefined;
  image?: string | undefined;
  restartCount: number;
  waitingReason?: string | undefined;
  waitingMessage?: string | undefined;
  lastTerminatedReason?: string | undefined;
  lastTerminatedExitCode?: number | null | undefined;
  lastTerminatedFinishedAt?: string | undefined;
  memoryLimitBytes?: number | null | undefined;
  latestMemoryBytes?: number | null | undefined;
  recentEvents: Array<{
    time?: string | undefined;
    type: string;
    reason: string;
    note: string;
  }>;
  previousLogTail: Array<string>;
  /*
   * How many pods share this finding's fingerprint — five crashlooping
   * replicas of one Deployment are ONE insight, not five.
   */
  affectedPodCount: number;
  classifiedCause: string;
  classifierConfidence: string;
}

export interface AIInsightEvidence {
  exception?: ExceptionInsightEvidence | undefined;
  logSpike?: LogSpikeInsightEvidence | undefined;
  latency?: LatencyInsightEvidence | undefined;
  metricDrift?: MetricDriftInsightEvidence | undefined;
  kubernetes?: KubernetesCrashLoopEvidence | undefined;
}

export default AIInsightEvidence;
