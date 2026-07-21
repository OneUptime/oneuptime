/*
 * The JSON persisted on AIRun.taskContext for CodeFix recipes whose entire
 * working context is captured at trigger time rather than referenced by a
 * subject id (incident/alert) or a telemetry exception.
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

export interface CodeFixTaskContext {
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

export default CodeFixTaskContext;
