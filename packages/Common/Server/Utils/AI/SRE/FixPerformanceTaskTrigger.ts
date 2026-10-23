import ObjectID from "../../../../Types/ObjectID";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext, {
  PerformanceCodeLocation,
  PerformanceFinding,
} from "../../../../Types/AI/CodeFixTaskContext";
import BadDataException from "../../../../Types/Exception/BadDataException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Service from "../../../../Models/DatabaseModels/Service";
import Span from "../../../../Models/AnalyticsModels/Span";
import SpanTreeAnalyzer, {
  AnalyzableSpan,
} from "../../../../Utils/Traces/SpanTreeAnalyzer";
import {
  getFindingsWorthFixing,
  getTracePerformanceFixOffer,
  NO_TRACE_PERFORMANCE_FIX_SUGGESTION,
  TRACE_NOT_WORTH_FIXING_MESSAGE,
  TracePerformanceFixOffer,
  TracePerformanceFixSuggestion,
} from "../../../../Utils/Suggestions/TracePerformanceFixSuggestion";
import AIService from "../../../Services/AIService";
import ServiceService from "../../../Services/ServiceService";
import SpanService from "../../../Services/SpanService";
import SubjectCodeFixRun from "./SubjectCodeFixRun";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — the FixPerformance trigger: from a slow trace, one click opens
 * a performance-fix pull request grounded in the actual span-tree evidence.
 *
 * The gate that makes this recipe honest is DETERMINISTIC: the
 * SpanTreeAnalyzer must find a mechanical performance pattern (N+1,
 * dominant span, sequential-that-could-be-parallel) in the trace's spans
 * that costs the request real time (TracePerformanceFixSuggestion's
 * getFindingsWorthFixing), or the task is refused — the agent never goes
 * hunting for "something slow" on vibes. Like FixFromIncident (b4) this is
 * human-triggered from a user-facing endpoint (POST /ai-investigation/
 * create-performance-fix-task), so there is no per-feature opt-in — the
 * human in the loop IS the gate, under the project's one AI switch
 * (Project.enableAi) — and every unmet gate FAILS EARLY with a clear
 * message.
 *
 * The trace page asks first (getSuggestionForTrace, POST /ai-investigation/
 * performance-fix-suggestion) and offers the button only when the same
 * gates would let the click through - so the page never offers a fix this
 * class then refuses.
 *
 * The findings (plus best-effort service attribution and code.* locations
 * for repository resolution) are serialized into AIRun.taskContext at
 * enqueue time: ClickHouse span retention is short, so by the time the
 * worker claims the run the spans may be gone. The stored evidence IS the
 * task's context.
 */

// Max code.* locations stored — mirrors the resolver's own candidate cap.
const MAX_CODE_LOCATIONS: number = 10;

/*
 * Spans of one trace the analysis reads. The page and the create route read
 * the same number, so they see the same tree.
 */
export const MAX_ANALYZED_TRACE_SPANS: number = 500;

export interface PerformanceTraceSpans {
  // The spans as the analyzer reads them (milliseconds, string attributes).
  spans: Array<AnalyzableSpan>;
  /*
   * The trace's most frequent primaryEntityId - a Service id when the spans
   * came from an instrumented service. Only feeds the repository name-match
   * fallback.
   */
  dominantEntityId: string | null;
}

export default class FixPerformanceTaskTrigger {
  /*
   * Load one trace's spans under the CALLER's permissions: the analytics
   * permission layer pins the query to the caller's tenant and telemetry
   * read permission (the Span model's read ACL, the same enforcement the
   * trace explorer's list API applies). No spans back means the trace does
   * not exist or the caller may not see it.
   */
  @CaptureSpan()
  public static async loadTraceSpans(data: {
    traceId: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<PerformanceTraceSpans> {
    const spans: Array<Span> = await SpanService.findBy({
      query: {
        traceId: data.traceId,
      } as never,
      select: {
        spanId: true,
        parentSpanId: true,
        name: true,
        startTimeUnixNano: true,
        endTimeUnixNano: true,
        durationUnixNano: true,
        attributes: true,
        primaryEntityId: true,
      } as never,
      sort: {
        startTimeUnixNano: SortOrder.Ascending,
      } as never,
      limit: MAX_ANALYZED_TRACE_SPANS,
      skip: 0,
      props: data.props,
    });

    const entityIdCounts: Map<string, number> = new Map();
    for (const span of spans) {
      const entityId: string | undefined = span.primaryEntityId?.toString();
      if (entityId) {
        entityIdCounts.set(entityId, (entityIdCounts.get(entityId) || 0) + 1);
      }
    }

    let dominantEntityId: string | null = null;
    let dominantEntityCount: number = 0;
    for (const [entityId, count] of entityIdCounts) {
      if (count > dominantEntityCount) {
        dominantEntityId = entityId;
        dominantEntityCount = count;
      }
    }

    return {
      spans: FixPerformanceTaskTrigger.toAnalyzableSpans(spans),
      dominantEntityId,
    };
  }

  // Nanoseconds -> milliseconds, attributes -> strings, for the analyzer.
  public static toAnalyzableSpans(spans: Array<Span>): Array<AnalyzableSpan> {
    return spans.map((span: Span): AnalyzableSpan => {
      const attributes: Record<string, string> = {};

      for (const [key, value] of Object.entries(span.attributes || {})) {
        if (value !== null && value !== undefined) {
          attributes[key] = String(value);
        }
      }

      return {
        spanId: span.spanId?.toString() || "",
        parentSpanId: span.parentSpanId?.toString() || undefined,
        name: span.name || "",
        startMs: Number(span.startTimeUnixNano) / 1_000_000,
        endMs: Number(span.endTimeUnixNano) / 1_000_000,
        durationMs: Number(span.durationUnixNano) / 1_000_000,
        attributes,
      };
    });
  }

  /*
   * Best-effort service attribution: the trace's dominant entity resolved
   * to a Service name when it IS a Service (findOneById returns null for
   * hosts, clusters and unattributed ids). Null is fine.
   */
  @CaptureSpan()
  public static async getServiceName(
    dominantEntityId: string | null,
  ): Promise<string | undefined> {
    if (!dominantEntityId) {
      return undefined;
    }

    const service: Service | null = await ServiceService.findOneById({
      id: new ObjectID(dominantEntityId),
      select: { name: true },
      props: { isRoot: true },
    });

    return service?.name || undefined;
  }

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
   * What the trace page offers for this trace, decided by the same gates the
   * create path enforces, in the same order: AI on for the project, a
   * finding worth fixing in the trace's spans, then an existing fix for this
   * trace (InProgress) or a repository to open the pull request in (Act, or
   * SetUp when none is connected). Never throws for an unknown trace or a
   * trace the caller may not read - there is simply nothing to suggest.
   *
   * `loadTrace` loads the spans under the caller's permissions; it runs only
   * when AI is on, so a project with AI off pays for no span read.
   */
  @CaptureSpan()
  public static async getSuggestionForTrace(data: {
    projectId: ObjectID;
    traceId: string;
    loadTrace: () => Promise<PerformanceTraceSpans>;
  }): Promise<TracePerformanceFixSuggestion> {
    if (!data.traceId) {
      return NO_TRACE_PERFORMANCE_FIX_SUGGESTION;
    }

    const isAiEnabled: boolean = await AIService.isProjectAIEnabled(
      data.projectId,
    );

    if (!isAiEnabled) {
      return NO_TRACE_PERFORMANCE_FIX_SUGGESTION;
    }

    const trace: PerformanceTraceSpans = await data.loadTrace();
    const findings: Array<PerformanceFinding> = SpanTreeAnalyzer.analyzeTrace(
      trace.spans,
    );

    // Nothing worth fixing: skip the repository and run reads entirely.
    if (getFindingsWorthFixing(findings).length === 0) {
      return NO_TRACE_PERFORMANCE_FIX_SUGGESTION;
    }

    const activeRun: AIRun | null =
      await SubjectCodeFixRun.findNonTerminalPerformanceFixRunForTrace({
        projectId: data.projectId,
        traceId: data.traceId,
      });

    /*
     * A run in flight was created with a repository; whether one is still
     * connected does not change what the page should link to.
     */
    const hasConnectedRepository: boolean = activeRun
      ? true
      : await SubjectCodeFixRun.hasConnectedRepository(data.projectId);

    const offer: TracePerformanceFixOffer = getTracePerformanceFixOffer({
      findings,
      isAiEnabled: true,
      hasActiveFix: Boolean(activeRun),
      hasConnectedRepository,
    });

    return {
      ...offer,
      aiRunId: activeRun?.id?.toString() || null,
    };
  }

  /*
   * Gate and enqueue a FixPerformance CodeFix run for a trace. The caller
   * must already have loaded the spans under the USER's telemetry-read
   * permissions (the access check) — this method reads and writes as root.
   *
   * Throws naming the failed gate: AI switched off for the project, no
   * finding worth fixing, no GitHub-App repository, or a duplicate active
   * run for the same trace.
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

    // The project's one AI switch, before any analysis is paid for.
    await AIService.assertProjectAIEnabled(data.projectId);

    /*
     * The deterministic evidence gate, and the recipe's whole point: no
     * finding worth fixing in the span tree means no fix task. Only the
     * findings worth fixing ground the pull request.
     */
    const findings: Array<PerformanceFinding> = getFindingsWorthFixing(
      SpanTreeAnalyzer.analyzeTrace(data.spans),
    );

    if (findings.length === 0) {
      throw new BadDataException(TRACE_NOT_WORTH_FIXING_MESSAGE);
    }

    return this.enqueuePerformanceFix({
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
   * for ALREADY-COMPUTED deterministic findings (AI insight fix routing,
   * whose findings were drilled — and stored as evidence — at detect time,
   * because the spans are likely gone by now). The same rule applies: only
   * findings worth fixing ground a run. `userId` is attribution for
   * human-triggered callers; automatic triggers pass none and the run stays
   * system-authored.
   *
   * Throws naming the failed gate: AI switched off, no finding worth
   * fixing, no GitHub-App repository, a duplicate active run for the same
   * trace, or (via enqueueSubjectCodeFixRun) the daily fix-run budget.
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

    await AIService.assertProjectAIEnabled(data.projectId);

    const findings: Array<PerformanceFinding> = getFindingsWorthFixing(
      data.findings,
    );

    if (findings.length === 0) {
      throw new BadDataException(TRACE_NOT_WORTH_FIXING_MESSAGE);
    }

    return this.enqueuePerformanceFix({
      projectId: data.projectId,
      traceId: data.traceId,
      serviceName: data.serviceName,
      findings,
      codeLocations: data.codeLocations,
      userId: data.userId,
    });
  }

  /*
   * The gates both entry points share once the findings are known to be
   * worth fixing: a repository to open the pull request in, and at most one
   * run per trace.
   */
  private static async enqueuePerformanceFix(data: {
    projectId: ObjectID;
    traceId: string;
    serviceName?: string | undefined;
    findings: Array<PerformanceFinding>;
    codeLocations: Array<PerformanceCodeLocation>;
    userId?: ObjectID | undefined;
  }): Promise<AIRun> {
    // Gate — a repository the agent can actually open a PR against.
    const hasConnectedRepository: boolean =
      await SubjectCodeFixRun.hasConnectedRepository(data.projectId);

    if (!hasConnectedRepository) {
      throw new BadDataException(
        "No GitHub-App-connected repository exists for this project, so the agent has nowhere to open the performance-fix pull request. Connect one in Code.",
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
        "A performance fix task is already queued or running for this trace. Track its progress in Code.",
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
