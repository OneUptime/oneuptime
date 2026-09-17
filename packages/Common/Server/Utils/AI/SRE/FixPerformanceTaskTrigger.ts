import ObjectID from "../../../../Types/ObjectID";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext, {
  PerformanceCodeLocation,
  PerformanceFinding,
} from "../../../../Types/AI/CodeFixTaskContext";
import BadDataException from "../../../../Types/Exception/BadDataException";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import SpanTreeAnalyzer, {
  AnalyzableSpan,
} from "../PerfEvidence/SpanTreeAnalyzer";
import SubjectCodeFixRun from "./SubjectCodeFixRun";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — the FixPerformance trigger: from a slow trace, one click opens
 * a performance-fix pull request grounded in the actual span-tree evidence.
 *
 * The gate that makes this recipe honest is DETERMINISTIC: the
 * SpanTreeAnalyzer must find a mechanical performance pattern (N+1,
 * dominant span, sequential-that-could-be-parallel) in the trace's spans,
 * or the task is refused — the agent never goes hunting for "something
 * slow" on vibes. Like FixFromIncident (b4) this is human-triggered from a
 * user-facing endpoint (POST /ai-investigation/create-performance-fix-task),
 * so there is no project opt-in flag — the human in the loop IS the gate —
 * and every unmet gate FAILS EARLY with a clear message.
 *
 * The findings (plus best-effort service attribution and code.* locations
 * for repository resolution) are serialized into AIRun.taskContext at
 * enqueue time: ClickHouse span retention is short, so by the time the
 * worker claims the run the spans may be gone. The stored evidence IS the
 * task's context.
 */

// Max code.* locations stored — mirrors the resolver's own candidate cap.
const MAX_CODE_LOCATIONS: number = 10;

export default class FixPerformanceTaskTrigger {
  /*
   * Collect code.filepath/code.function/code.lineno (and their newer
   * semconv spellings) from the spans a finding implicates, so the
   * task-details endpoint can attempt stack-trace-style repository
   * resolution. Best-effort: most instrumentations do not stamp code
   * attributes on client spans, and an empty result just means the
   * resolver falls back to name-match / only-repository.
   */
  public static collectCodeLocations(
    spans: Array<AnalyzableSpan>,
    findings: Array<PerformanceFinding>,
  ): Array<PerformanceCodeLocation> {
    const implicatedSpanIds: Set<string> = new Set();

    for (const finding of findings) {
      for (const implicated of finding.implicatedSpans) {
        implicatedSpanIds.add(implicated.spanId);
      }
    }

    const locations: Array<PerformanceCodeLocation> = [];
    const seenFilePaths: Set<string> = new Set();

    for (const span of spans) {
      if (!implicatedSpanIds.has(span.spanId) || !span.attributes) {
        continue;
      }

      const filePath: string | undefined =
        span.attributes["code.filepath"] || span.attributes["code.file.path"];

      if (!filePath || seenFilePaths.has(filePath)) {
        continue;
      }

      seenFilePaths.add(filePath);

      const functionName: string | undefined =
        span.attributes["code.function"] ||
        span.attributes["code.function.name"];

      const rawLineNumber: string | undefined =
        span.attributes["code.lineno"] || span.attributes["code.line.number"];
      const lineNumber: number = rawLineNumber
        ? parseInt(rawLineNumber, 10)
        : NaN;

      locations.push({
        filePath,
        functionName,
        lineNumber: Number.isFinite(lineNumber) ? lineNumber : undefined,
      });

      if (locations.length >= MAX_CODE_LOCATIONS) {
        break;
      }
    }

    return locations;
  }

  /*
   * Gate and enqueue a FixPerformance CodeFix run for a trace. The caller
   * must already have loaded the spans under the USER's telemetry-read
   * permissions (the access check) — this method reads and writes as root.
   *
   * Throws BadDataException naming the failed gate: no deterministic
   * finding, no GitHub-App repository, or a duplicate active run for the
   * same trace.
   */
  @CaptureSpan()
  public static async createPerformanceFixTaskFromTrace(data: {
    projectId: ObjectID;
    traceId: string;
    spans: Array<AnalyzableSpan>;
    serviceName?: string | undefined;
    userId: ObjectID;
  }): Promise<AIRun> {
    if (!data.traceId) {
      throw new BadDataException(
        "A traceId is required to create a performance fix task.",
      );
    }

    if (data.spans.length === 0) {
      throw new BadDataException(
        "This trace has no spans to analyze (or you do not have access to them).",
      );
    }

    /*
     * Gate 1 — the deterministic evidence gate, and the recipe's whole
     * point: no mechanical pattern in the span tree means no fix task.
     * This gate lives HERE, not in the findings entry point below: callers
     * of that entry point (insight fix routing) hand over findings that
     * were already computed — and gated on — at detect time.
     */
    const findings: Array<PerformanceFinding> = SpanTreeAnalyzer.analyzeTrace(
      data.spans,
    );

    if (findings.length === 0) {
      throw new BadDataException(
        "No deterministic performance pattern was found in this trace. The analyzer looks for N+1 patterns (5+ near-identical sibling spans), a dominant slow span (60%+ of the trace), and sequential same-operation siblings that could run in parallel (3+, 50%+ of their parent) — none matched, so the AI agent has no grounded evidence to fix.",
      );
    }

    return this.createPerformanceFixTaskFromFindings({
      projectId: data.projectId,
      traceId: data.traceId,
      serviceName: data.serviceName,
      findings,
      codeLocations: this.collectCodeLocations(data.spans, findings),
      userId: data.userId,
    });
  }

  /*
   * The findings-based entry point: gate and enqueue a FixPerformance run
   * for ALREADY-COMPUTED deterministic findings (the spans path above after
   * its analyzer gate, and AI insight fix routing whose findings were
   * drilled — and stored as evidence — at detect time, because the spans
   * are likely gone by now). `userId` is attribution for human-triggered
   * callers; automatic triggers pass none and the run stays system-authored.
   *
   * Throws BadDataException naming the failed gate: no GitHub-App
   * repository, a duplicate active run for the same trace, or (via
   * enqueueSubjectCodeFixRun) the daily fix-run budget.
   */
  @CaptureSpan()
  public static async createPerformanceFixTaskFromFindings(data: {
    projectId: ObjectID;
    traceId: string;
    serviceName?: string | undefined;
    findings: Array<PerformanceFinding>;
    codeLocations: Array<PerformanceCodeLocation>;
    userId?: ObjectID | undefined;
  }): Promise<AIRun> {
    if (!data.traceId) {
      throw new BadDataException(
        "A traceId is required to create a performance fix task.",
      );
    }

    // Gate — a repository the agent can actually open a PR against.
    const hasConnectedRepository: boolean =
      await SubjectCodeFixRun.hasGitHubAppConnectedRepository(data.projectId);

    if (!hasConnectedRepository) {
      throw new BadDataException(
        "No GitHub-App-connected repository exists for this project, so the agent has nowhere to open the performance-fix pull request. Connect one under AI > Code Repositories.",
      );
    }

    /*
     * Gate — per-trace dedupe: at most one non-terminal FixPerformance
     * run per trace (repeated clicks must not fan out into duplicate PRs).
     */
    const existingRun: AIRun | null =
      await SubjectCodeFixRun.findNonTerminalPerformanceFixRunForTrace({
        projectId: data.projectId,
        traceId: data.traceId,
      });

    if (existingRun) {
      throw new BadDataException(
        "A performance fix task is already queued or running for this trace. Track its progress on the AI > Tasks page.",
      );
    }

    const taskContext: CodeFixTaskContext = {
      traceId: data.traceId,
      serviceName: data.serviceName,
      performanceFindings: data.findings,
      codeLocations: data.codeLocations,
    };

    return SubjectCodeFixRun.enqueueSubjectCodeFixRun({
      projectId: data.projectId,
      taskType: CodeFixTaskType.FixPerformance,
      userId: data.userId,
      taskContext,
    });
  }
}
