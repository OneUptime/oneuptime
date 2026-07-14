import ObjectID from "../../../../../Types/ObjectID";
import SentinelInsightType from "../../../../../Types/AI/SentinelInsightType";
import SentinelInsightSeverity from "../../../../../Types/AI/SentinelInsightSeverity";
import SentinelInsightEvidence from "../../../../../Types/AI/SentinelInsightEvidence";

/*
 * Sentinel Insights — detector contracts.
 *
 * THE RULE: no LLM in the watch loop. Detectors are deterministic
 * statistical sensors — they compare counts, percentiles and means against
 * the project's own baselines and emit candidates with the evidence already
 * computed. The LLM only engages per-finding AFTERWARDS (budgeted, read-only
 * triage), and the decision to open a fix task is deterministic too
 * (readiness/evidence-based, never LLM-decided).
 */

// What the scanner hands every detector for one project's scan tick.
export interface InsightScanContext {
  projectId: ObjectID;
  // The scan tick's single clock — all windows are computed from this.
  now: Date;
}

/*
 * One deterministic finding a detector emits. The scanner turns candidates
 * into SentinelInsight rows (or refreshes the existing non-terminal insight
 * with the same fingerprint).
 */
export interface InsightCandidate {
  insightType: SentinelInsightType;
  // Stable dedupe key, e.g. "new-exception:<telemetryExceptionId>".
  fingerprint: string;
  title: string;
  // The evidence rendered as markdown — real numbers, no LLM output.
  detailMarkdown: string;
  severity: SentinelInsightSeverity;
  serviceName?: string | undefined;
  telemetryServiceId?: ObjectID | undefined;
  telemetryExceptionId?: ObjectID | undefined;
  traceId?: string | undefined;
  metricName?: string | undefined;
  evidence: SentinelInsightEvidence;
}

// One deterministic sensor. Implementations live in ./Detectors/.
export interface InsightDetector {
  insightType: SentinelInsightType;
  detect(context: InsightScanContext): Promise<Array<InsightCandidate>>;
}
