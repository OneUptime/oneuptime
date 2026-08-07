/*
 * The JSON persisted on AIRun.taskContext for tasks whose exact working
 * context must survive until a worker claims them. Some recipes have no
 * durable subject record; others, such as FixFromIncident, deliberately pin
 * a snapshot instead of re-reading mutable subject state at execution time.
 *
 * First user: the FixPerformance recipe. Its evidence is computed
 * DETERMINISTICALLY from a trace's span tree when the user clicks "Fix
 * performance with AI" (see Common/Server/Utils/AI/PerfEvidence/
 * SpanTreeAnalyzer.ts) and stored here verbatim — ClickHouse span retention
 * is short, so by the time the agent worker claims the run the spans may
 * already be gone. The stored findings ARE the task's context.
 *
 * These shapes are a wire contract with the agent worker
 * (/ai-agent-data/get-instrumentation-task-details serves them back) — do
 * not rename fields.
 */

export enum PerformanceFindingType {
  // >=5 near-identical sibling spans under one parent (classic N+1).
  NPlusOneQuery = "NPlusOneQuery",
  // A single span whose self time is >=60% of the trace's total duration.
  DominantSpan = "DominantSpan",
  /*
   * >=3 same-name siblings executing strictly one-after-another whose
   * combined duration is >=50% of their parent — parallelizable work.
   */
  SequentialSiblings = "SequentialSiblings",
}

// One span a finding implicates — enough to name it in evidence and PRs.
export interface ImplicatedSpan {
  spanId: string;
  name: string;
  durationMs: number;
}

/*
 * One deterministic performance finding. `evidence` is the human-readable
 * proof (real counts, durations, normalized names/statements) — it is
 * embedded verbatim in the agent prompt and the pull request body, so it
 * must stand on its own.
 */
export interface PerformanceFinding {
  findingType: PerformanceFindingType;
  // One-line summary, e.g. 'N+1: 27× "SELECT users" under "GET /orders"'.
  headline: string;
  // Multi-line human-readable proof with the real numbers.
  evidence: string;
  spanCount: number;
  combinedDurationMs: number;
  traceDurationMs: number;
  percentOfTrace: number;
  // Only for SequentialSiblings: combined duration as a share of the parent.
  percentOfParent?: number | undefined;
  normalizedSpanName: string;
  parentSpanName?: string | undefined;
  // Normalized db.statement when the implicated spans carry one.
  normalizedDbStatement?: string | undefined;
  dbSystem?: string | undefined;
  httpUrl?: string | undefined;
  // Capped sample of the implicated spans (name + duration).
  implicatedSpans: Array<ImplicatedSpan>;
}

/*
 * A code location plucked from the implicated spans' code.* attributes
 * (code.filepath / code.function / code.lineno and their newer semconv
 * spellings). Feeds the stack-trace-style repository resolution at
 * task-details time.
 */
export interface PerformanceCodeLocation {
  filePath: string;
  functionName?: string | undefined;
  lineNumber?: number | undefined;
}

/*
 * The immutable investigation snapshot consumed by FixFromIncident. Both
 * fields travel together: the run id proves which Recommended decision was
 * gated, and the markdown is the exact posted analysis that decision covered.
 */
export interface InvestigationCodeFixTaskSnapshot {
  investigationRunId: string;
  investigationAnalysisMarkdown: string;
}

export interface CodeFixTaskContext {
  /*
   * FixFromIncident: the exact investigation whose published RootCause is
   * the task's context. This prevents a later re-investigation from changing
   * the report between the user's click and the worker claiming the task.
   */
  sourceInvestigationRunId?: string | undefined;
  /*
   * Snapshot of that run's published analysis. Fix tasks can wait in the
   * queue, so reading the feed again when the worker claims the task would
   * let a later re-investigation silently change the requested fix.
   */
  sourceInvestigationAnalysisMarkdown?: string | undefined;
  // FixPerformance: the analyzed trace.
  traceId?: string | undefined;
  // Best-effort service attribution resolved from the trace's spans.
  serviceName?: string | undefined;
  // The deterministic span-tree findings — the recipe's entire evidence.
  performanceFindings?: Array<PerformanceFinding> | undefined;
  // code.* attribute locations for stack-trace-style repo resolution.
  codeLocations?: Array<PerformanceCodeLocation> | undefined;
  /*
   * ImproveLogging / ImproveTracing: the telemetry service whose
   * instrumentation the recipe improves (serviceName above carries its
   * name for repository resolution and PR wording).
   */
  telemetryServiceId?: string | undefined;
}

/*
 * Canonical JSON shape persisted for a Recommended investigation. Unlike the
 * normalized snapshot returned below, these names are the established
 * AIRun.taskContext wire contract.
 */
export type InvestigationCodeFixTaskContext = CodeFixTaskContext & {
  sourceInvestigationRunId: string;
  sourceInvestigationAnalysisMarkdown: string;
};

/*
 * Treat partial, empty and malformed JSON as no snapshot. The same validator
 * is shared by the trigger, claim guard and task-details reader so none of
 * those boundaries can silently fall back to a different investigation.
 */
export function getInvestigationCodeFixTaskSnapshot(
  taskContext: CodeFixTaskContext | null | undefined,
): InvestigationCodeFixTaskSnapshot | null {
  const investigationRunId: unknown = taskContext?.sourceInvestigationRunId;
  const investigationAnalysisMarkdown: unknown =
    taskContext?.sourceInvestigationAnalysisMarkdown;

  if (
    typeof investigationRunId !== "string" ||
    investigationRunId.trim().length === 0 ||
    typeof investigationAnalysisMarkdown !== "string" ||
    investigationAnalysisMarkdown.trim().length === 0
  ) {
    return null;
  }

  return {
    investigationRunId,
    investigationAnalysisMarkdown,
  };
}

export default CodeFixTaskContext;
