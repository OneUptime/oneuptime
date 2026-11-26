import ObjectID from "../../../../Types/ObjectID";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../../Types/AI/CodeTask";
import CodeFixTaskContext, {
  PerformanceCodeLocation,
  PerformanceFinding,
} from "../../../../Types/AI/CodeFixTaskContext";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Exception from "../../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import Service from "../../../../Models/DatabaseModels/Service";
import Span from "../../../../Models/AnalyticsModels/Span";
import SpanTreeAnalyzer, {
  AnalyzableSpan,
} from "../../../../Utils/Traces/SpanTreeAnalyzer";
import {
  getFindingsWorthFixing,
  getTracePerformanceFixOffer,
  MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES,
  NO_REPOSITORY_YOU_MAY_USE_MESSAGE,
  NO_TRACE_PERFORMANCE_FIX_SUGGESTION,
  PICK_A_REPOSITORY_FOR_THE_FIX_MESSAGE,
  PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
  PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE,
  PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
  TRACE_NOT_WORTH_FIXING_MESSAGE,
  TracePerformanceFixOffer,
  TracePerformanceFixRepository,
  TracePerformanceFixSuggestion,
} from "../../../../Utils/Suggestions/TracePerformanceFixSuggestion";
import {
  FinishedFixOutcome,
  getFinishedFixOutcome,
} from "../../../../Utils/Suggestions/CodeFixSuggestion";
import {
  SuggestionBlocker,
  toSuggestionBlocker,
} from "../../../../Utils/Suggestions/SuggestionBlocker";
import SuggestionOffer from "../../../../Utils/Suggestions/SuggestionOffer";
import AIService from "../../../Services/AIService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import ServiceService from "../../../Services/ServiceService";
import { ResolvableRepository } from "../../CodeRepository/StackTraceRepoResolver";
import SpanService from "../../../Services/SpanService";
import SubjectCodeFixRun from "./SubjectCodeFixRun";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeFixStartGate, { CodeFixStart } from "../CodeFix/CodeFixStartGate";
import CodeTaskAccess from "../CodeTask/CodeTaskAccess";
import CodeTaskGate from "../CodeTask/CodeTaskGate";
import CodeTaskRuns from "../CodeTask/CodeTaskRuns";
import CodeTaskThread from "../CodeTask/CodeTaskThread";

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
 * class then refuses. Those gates include a fix for the trace that already
 * did its work (the page links to it rather than offering a second one)
 * and, for a person's click, what Code's own gate says about the
 * repository the run will be queued on (CodeFixStartGate: the plan, AI
 * credits or an LLM provider, the daily AI limit, a Runner online).
 *
 * The findings (plus best-effort service attribution and code.* locations
 * for repository resolution) are serialized into AIRun.taskContext at
 * enqueue time: ClickHouse span retention is short, so by the time the
 * worker claims the run the spans may be gone. The stored evidence IS the
 * task's context.
 *
 * WHO MAY START ONE, AND IN WHICH REPOSITORY (#11075): the rule every other
 * Fix with AI holds to. The person reads the trace (its spans, under their
 * own permissions), and may use the repository the fix works in, in Code:
 * read it, and ask OneUptime AI to work in it (CodeTaskAccess - what
 * changing the repository takes). The create route checked a pick only for
 * being connected, as root, so a request could name any connected
 * repository of the project - one the person may not read, or may not ask
 * AI in - and the page's picker, which offered only the readable ones, was
 * all that held it back. Now:
 *
 *   - a pick is refused, in a sentence that says which of the two is
 *     missing (or that it is not connected), whatever the page offered;
 *   - without a pick, the trace's facts are resolved among the connected
 *     repositories the person may use, never another;
 *   - and either way the run is held to that one repository, when it is
 *     queued and again when it starts (CodeFixTaskContext
 *     .pickedCodeRepositoryId), so it never lands in one the person may
 *     not use.
 *
 * The page offers the button by the same rule: a person who may use none
 * of the connected repositories is offered nothing, and the picker searches
 * only the ones they may use.
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

/*
 * The fix for a trace that already did its work, as the page links to it:
 * its task, and how it came out - or that its task is working again, when
 * someone replied to it in Code.
 */
export interface FinishedPerformanceFix {
  // The run the fix was asked as: its task in Code.
  aiRunId: string;
  // How it came out; null while a reply in Code is under way.
  outcome: FinishedFixOutcome | null;
}

/*
 * The server's refusal of a second fix for a trace whose fix already did
 * its work. The trace page never offers one then, so people only meet this
 * through the API.
 */
export const PERFORMANCE_FIX_ALREADY_DONE_MESSAGE: string =
  "OneUptime AI already worked on a fix for this trace. Open its task in Code to see how it came out, or to take it further.";

// No repository the agent could open the pull request in.
export const NO_CONNECTED_REPOSITORY_FOR_PERFORMANCE_FIX_MESSAGE: string =
  "No connected repository exists for this project, so the agent has nowhere to open the performance-fix pull request. Connect one in Code.";

/*
 * The connected repositories a person may have a trace's fix made in
 * (getUsableRepositories, #11075), and what the run's repository is
 * resolved among for them.
 */
export interface TracePerformanceFixRepositoryUse {
  /*
   * How many connected repositories OneUptime AI can work in the project
   * has (getResolvableRepositories), whoever may use them.
   */
  connectedCount: number;
  /*
   * Of those, the ones the person may read and ask OneUptime AI to work in
   * - in that list's order.
   */
  usable: Array<ResolvableRepository>;
  /*
   * Every connected repository, when the person may use each one; those,
   * when only some; none, when none.
   */
  allowance: CodeRepositoryAllowance;
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
   * The fix for this trace that already did its work, or null when none
   * did (getFinishedFixOutcome): its task, and how it came out - read from
   * the task's latest turn, so a reply someone sent in Code reads as work
   * under way, and a question as waiting for an answer.
   */
  @CaptureSpan()
  public static async findFinishedFix(data: {
    projectId: ObjectID;
    traceId: string;
  }): Promise<FinishedPerformanceFix | null> {
    const fix: AIRun | null =
      await SubjectCodeFixRun.findFinishedPerformanceFixRunForTrace(data);
    const taskId: ObjectID | null = SubjectCodeFixRun.taskIdOf(fix);

    if (!fix || !fix.id || !taskId) {
      return null;
    }

    // The task's latest turn: a fix asked again (#6509) is a later turn of it.
    let task: AIRun = fix;

    if (fix.codeTaskId) {
      task = new AIRun();
      task.id = fix.codeTaskId;
    }

    const latestTurn: AIRun = await CodeTaskRuns.getLatestTurn({
      projectId: data.projectId,
      task,
    });

    return {
      aiRunId: taskId.toString(),
      outcome: getFinishedFixOutcome({ fix, latestTurn }),
    };
  }

  /*
   * The connected repositories a person may have a trace's fix made in
   * (#11075): of every one OneUptime AI can work in
   * (CodeRepositoryService.getResolvableRepositories, the candidates the
   * run's own resolution reads - every one of them, #11076), those the
   * person may read and ask OneUptime AI to work in, under their own
   * permissions: Code's rule (CodeTaskAccess), the one every other Fix with
   * AI holds its repository to. Read by the candidates' ids, in a read a
   * batch, however many the project has - never one repository at a time.
   */
  @CaptureSpan()
  public static async getUsableRepositories(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<TracePerformanceFixRepositoryUse> {
    const resolvable: Array<ResolvableRepository> =
      await CodeRepositoryService.getResolvableRepositories(data.projectId);

    if (resolvable.length === 0) {
      return { connectedCount: 0, usable: [], allowance: NO_CODE_REPOSITORY };
    }

    const readable: Array<CodeRepository> =
      await CodeTaskAccess.listReadableRepositoriesByIds({
        props: data.props,
        projectId: data.projectId,
        repositoryIds: resolvable.map(
          (repository: ResolvableRepository): string => {
            return repository.id;
          },
        ),
        select: { _id: true },
      });

    const readableIds: Set<string> = new Set<string>(
      readable
        .map((repository: CodeRepository): string => {
          return repository.id?.toString().toLowerCase() || "";
        })
        .filter(Boolean),
    );

    const usable: Array<ResolvableRepository> =
      await CodeTaskAccess.keepAskableRepositories<ResolvableRepository>({
        props: data.props,
        projectId: data.projectId,
        repositories: resolvable.filter(
          (repository: ResolvableRepository): boolean => {
            return readableIds.has(repository.id.toLowerCase());
          },
        ),
        getId: (repository: ResolvableRepository): string => {
          return repository.id;
        },
      });

    let allowance: CodeRepositoryAllowance = EVERY_CODE_REPOSITORY;

    if (usable.length === 0) {
      allowance = NO_CODE_REPOSITORY;
    } else if (usable.length < resolvable.length) {
      allowance = {
        isEveryRepository: false,
        repositoryIds: usable.map((repository: ResolvableRepository) => {
          return repository.id.toLowerCase();
        }),
      };
    }

    return { connectedCount: resolvable.length, usable, allowance };
  }

  /*
   * What Code's gate says that stops everyone in the project - the bill and
   * the plan - and so is said before why one person may not use a
   * repository, as Code says it (CodeTaskGate): a plan below the
   * repositories' own also reads as "may not edit the repository", which
   * would send people to an admin who cannot help either.
   */
  public static isEveryonesBlocker(
    blocker: CodeTaskBlocker | null | undefined,
  ): boolean {
    return (
      blocker?.type === CodeTaskBlockerType.SubscriptionUnpaid ||
      blocker?.type === CodeTaskBlockerType.PlanRequired
    );
  }

  /*
   * The repositories a person may pick for a fix no repository was found to
   * hold for certain: the connected ones they may use (getUsableRepositories),
   * by name - the first MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES of them. The
   * suggestion lists them to say a pick is asked for (more than one); the
   * trace page's picker searches the server for the pick, held to the same
   * repositories (#10921, #11075), and a pick is checked by itself
   * (checkRepositoryPick), so one past them is never refused.
   */
  public static getRepositoryChoices(
    use: TracePerformanceFixRepositoryUse,
  ): Array<TracePerformanceFixRepository> {
    return use.usable
      .map(
        (repository: ResolvableRepository): TracePerformanceFixRepository => {
          const name: string =
            repository.name.trim() ||
            [repository.organizationName, repository.repositoryName]
              .filter(Boolean)
              .join("/") ||
            repository.id;

          return { id: repository.id, name };
        },
      )
      .sort(
        (
          a: TracePerformanceFixRepository,
          b: TracePerformanceFixRepository,
        ): number => {
          return (
            a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
            a.id.localeCompare(b.id)
          );
        },
      )
      .slice(0, MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES);
  }

  /*
   * Why the person may not have the fix made in the repository they picked,
   * or null when they may (#11075): one of the project's they may read
   * (else "not found, or no access" - never whether it exists), may ask
   * OneUptime AI to work in (what changing it takes), and that is connected
   * so AI can work in it (getResolvableRepositories' rule). Asked of that
   * one repository, under the person's own permissions - never looked for
   * among a first page of them (#10921) - and as an error of its kind.
   */
  @CaptureSpan()
  public static async checkRepositoryPick(data: {
    projectId: ObjectID;
    pickedRepositoryId?: ObjectID | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<Exception | null> {
    const pickedId: string = data.pickedRepositoryId
      ? data.pickedRepositoryId.toString().trim().toLowerCase()
      : "";

    if (!ObjectID.isValidUUID(pickedId)) {
      return new BadDataException(PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE);
    }

    // Keyed as the database writes an id: lower-cased.
    const repositoryId: ObjectID = new ObjectID(pickedId);

    const readable: CodeRepository | null =
      await CodeTaskAccess.findReadableRepository({
        props: data.props,
        projectId: data.projectId,
        repositoryId,
      });

    if (!readable) {
      return new NotFoundException(PICKED_REPOSITORY_NOT_FOUND_MESSAGE);
    }

    if (
      !(await CodeTaskAccess.canAskInRepository({
        props: data.props,
        projectId: data.projectId,
        repositoryId,
      }))
    ) {
      return new NotAuthorizedException(PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE);
    }

    if (
      !(await CodeTaskGate.isRepositoryReachable({
        projectId: data.projectId,
        repositoryId,
      }))
    ) {
      return new BadDataException(PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE);
    }

    return null;
  }

  // Whether the person may have the fix made in that repository (checkRepositoryPick).
  public static async isRepositoryChoice(data: {
    projectId: ObjectID;
    pickedRepositoryId?: ObjectID | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    return (await FixPerformanceTaskTrigger.checkRepositoryPick(data)) === null;
  }

  // The context a FixPerformance run carries: the trace's evidence.
  public static buildTaskContext(data: {
    traceId: string;
    serviceName?: string | undefined;
    findings: Array<PerformanceFinding>;
    codeLocations: Array<PerformanceCodeLocation>;
  }): CodeFixTaskContext {
    return {
      traceId: data.traceId,
      serviceName: data.serviceName,
      performanceFindings: data.findings,
      codeLocations: data.codeLocations,
    };
  }

  /*
   * What the trace page offers for this trace, decided by the same gates the
   * create path enforces, in the same order: AI on for the project, a
   * finding worth fixing in the trace's spans, then a fix for this trace
   * already on its way (InProgress) or already done (Done), a repository to
   * open the pull request in (SetUp when none is connected), and what
   * Code's gate says about the run the click would queue (SetUp, in Code's
   * words) - Act when nothing stands in the way. Never throws for an
   * unknown trace or a trace the caller may not read - there is simply
   * nothing to suggest.
   *
   * `loadTrace` loads the spans under the caller's permissions; it runs only
   * when AI is on, so a project with AI off pays for no span read.
   *
   * The fix on its way or done is read as its task's own page reads it, for
   * `reader`: one a reply carried a private incident or alert into, which
   * they do not see, is there - Done, Hidden: no second one is offered -
   * and nothing of how it stands, nor where it is.
   */
  @CaptureSpan()
  public static async getSuggestionForTrace(data: {
    projectId: ObjectID;
    traceId: string;
    loadTrace: () => Promise<PerformanceTraceSpans>;
    reader: DatabaseCommonInteractionProps;
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

    const worthFixing: Array<PerformanceFinding> =
      getFindingsWorthFixing(findings);

    // Nothing worth fixing: skip the repository and run reads entirely.
    if (worthFixing.length === 0) {
      return NO_TRACE_PERFORMANCE_FIX_SUGGESTION;
    }

    const activeRun: AIRun | null =
      await SubjectCodeFixRun.findNonTerminalPerformanceFixRunForTrace({
        projectId: data.projectId,
        traceId: data.traceId,
      });

    const finishedFix: FinishedPerformanceFix | null = activeRun
      ? null
      : await FixPerformanceTaskTrigger.findFinishedFix({
          projectId: data.projectId,
          traceId: data.traceId,
        });

    /*
     * The fix, read as its task's own page reads it for this reader - by
     * its task, also when the fix on its way was asked again from Code.
     */
    const activeTaskId: string | null =
      SubjectCodeFixRun.taskIdOf(activeRun)?.toString() || null;
    const fixTaskId: string | null =
      activeTaskId || finishedFix?.aiRunId || null;

    if (
      fixTaskId &&
      (
        await CodeTaskThread.findTasksHiddenFrom({
          projectId: data.projectId,
          taskIds: [fixTaskId],
          reader: data.reader,
        })
      ).size > 0
    ) {
      return {
        ...getTracePerformanceFixOffer({
          findings,
          isAiEnabled: true,
          hasActiveFix: false,
          finishedFix: FinishedFixOutcome.Hidden,
          hasConnectedRepository: true,
          blocker: null,
        }),
        aiRunId: null,
        repositories: [],
      };
    }

    // A reply to the finished fix is under way: work in progress.
    const isWorkingAgain: boolean = Boolean(
      finishedFix && finishedFix.outcome === null,
    );

    /*
     * A fix in flight or done was created with a repository; whether one is
     * still connected does not change what the page should link to.
     */
    let hasConnectedRepository: boolean =
      activeRun || finishedFix
        ? true
        : await SubjectCodeFixRun.hasConnectedRepository(data.projectId);

    /*
     * The connected repositories the reader may use in Code (#11075),
     * weighed only where they decide the answer: no fix yet, and a
     * repository to work in. None OneUptime AI can work in after all (a
     * GitHub installation that is no longer the project's) is a repository
     * to connect, as no repository at all is.
     */
    let use: TracePerformanceFixRepositoryUse | null = null;

    if (!activeRun && !finishedFix && hasConnectedRepository) {
      use = await FixPerformanceTaskTrigger.getUsableRepositories({
        projectId: data.projectId,
        props: data.reader,
      });
      hasConnectedRepository = use.connectedCount > 0;
    }

    /*
     * Code's gate, asked only where it decides the answer: no fix yet, and
     * a repository to work in.
     */
    let blocker: SuggestionBlocker | null = null;
    // Whether the trace's facts resolve the repository the run would work in.
    let isRepositoryResolved: boolean = false;

    if (use && hasConnectedRepository) {
      const start: CodeFixStart = await CodeFixStartGate.check({
        projectId: data.projectId,
        taskType: CodeFixTaskType.FixPerformance,
        taskContext: FixPerformanceTaskTrigger.buildTaskContext({
          traceId: data.traceId,
          serviceName: await FixPerformanceTaskTrigger.getServiceName(
            trace.dominantEntityId,
          ),
          findings: worthFixing,
          codeLocations: FixPerformanceTaskTrigger.collectCodeLocations(
            trace.spans,
            worthFixing,
          ),
        }),
        // Resolved among the repositories the reader may use, as a click is.
        allowance: use.allowance,
      });

      /*
       * Repositories are connected, but none the reader may use in Code:
       * nothing they could do here would start the fix - unless what stops
       * everyone in the project comes first (the bill, the plan), which the
       * page says as Code would.
       */
      if (
        use.usable.length === 0 &&
        !FixPerformanceTaskTrigger.isEveryonesBlocker(start.blocker)
      ) {
        return NO_TRACE_PERFORMANCE_FIX_SUGGESTION;
      }

      blocker = start.blocker
        ? toSuggestionBlocker(
            start.blocker,
            start.codeRepositoryId?.toString() || null,
          )
        : null;
      isRepositoryResolved = Boolean(start.codeRepositoryId);
    }

    const offer: TracePerformanceFixOffer = getTracePerformanceFixOffer({
      findings,
      isAiEnabled: true,
      hasActiveFix: Boolean(activeRun) || isWorkingAgain,
      finishedFix: finishedFix?.outcome || null,
      hasConnectedRepository,
      blocker,
    });

    const linkedRunId: string | null = fixTaskId;

    /*
     * The fix is offered, but the trace's facts found no repository to hold
     * its code for certain: the person picks one, from the connected
     * repositories they may use - or the run would find none when it
     * starts. One repository is no choice (the fix works in it), so a pick
     * is asked for only between two or more.
     */
    const repositories: Array<TracePerformanceFixRepository> =
      offer.offer === SuggestionOffer.Act && !isRepositoryResolved && use
        ? FixPerformanceTaskTrigger.getRepositoryChoices(use)
        : [];

    return {
      ...offer,
      aiRunId:
        offer.offer === SuggestionOffer.InProgress ||
        offer.offer === SuggestionOffer.Done
          ? linkedRunId
          : null,
      repositories: repositories.length > 1 ? repositories : [],
    };
  }

  /*
   * Gate and enqueue a FixPerformance CodeFix run for a trace. The caller
   * must already have loaded the spans under the USER's telemetry-read
   * permissions (the access check). The repository the run works in is
   * held to the ones the person may use in Code, under `props` (#11075);
   * everything else is read and written as root.
   *
   * Throws naming the failed gate: AI switched off for the project, no
   * finding worth fixing, no GitHub-App repository, a duplicate active
   * run for the same trace, a fix for it that already did its work, a
   * repository the person may not use (a pick they may not read or ask AI
   * in, or none of the connected ones theirs to ask in), or what Code's
   * gate says about the run (CodeFixStartGate, as an error of its kind:
   * the plan and the bill as payment required).
   */
  @CaptureSpan()
  public static async createPerformanceFixTaskFromTrace(data: {
    projectId: ObjectID;
    traceId: string;
    spans: Array<AnalyzableSpan>;
    serviceName?: string | undefined;
    userId: ObjectID;
    // Who clicked, as their request reads: whose repositories the fix may use.
    props: DatabaseCommonInteractionProps;
    /*
     * The repository the person picked, when the page asked for a pick: no
     * connected repository was found to hold the trace's code for certain.
     */
    repositoryId?: ObjectID | undefined;
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
      person: data.props,
      pickedRepositoryId: data.repositoryId,
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
   * trace, a fix for it that already did its work, or (via
   * enqueueSubjectCodeFixRun) the daily fix-run budget. Code's gate is not
   * asked here: the automatic routing queues the run as it always has, to
   * wait for a Runner that is restarting.
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
   * worth fixing: a repository to open the pull request in, at most one
   * run per trace in flight, and no second fix for a trace whose fix did
   * its work. A person's click is held to the repositories they may use in
   * Code, and asked what Code's gate says too.
   */
  private static async enqueuePerformanceFix(data: {
    projectId: ObjectID;
    traceId: string;
    serviceName?: string | undefined;
    findings: Array<PerformanceFinding>;
    codeLocations: Array<PerformanceCodeLocation>;
    userId?: ObjectID | undefined;
    /*
     * A person clicked Fix performance with AI, as their request reads:
     * the repository is held to the ones they may use, and Code's gate is
     * asked.
     */
    person?: DatabaseCommonInteractionProps | undefined;
    // The repository the person picked (createPerformanceFixTaskFromTrace).
    pickedRepositoryId?: ObjectID | undefined;
  }): Promise<AIRun> {
    // Gate — a repository the agent can actually open a PR against.
    const hasConnectedRepository: boolean =
      await SubjectCodeFixRun.hasConnectedRepository(data.projectId);

    if (!hasConnectedRepository) {
      throw new BadDataException(
        NO_CONNECTED_REPOSITORY_FOR_PERFORMANCE_FIX_MESSAGE,
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

    // Gate — a fix for this trace that already did its work.
    const finishedRun: AIRun | null =
      await SubjectCodeFixRun.findFinishedPerformanceFixRunForTrace({
        projectId: data.projectId,
        traceId: data.traceId,
      });

    if (finishedRun) {
      throw new BadDataException(PERFORMANCE_FIX_ALREADY_DONE_MESSAGE);
    }

    const taskContext: CodeFixTaskContext =
      FixPerformanceTaskTrigger.buildTaskContext({
        traceId: data.traceId,
        serviceName: data.serviceName,
        findings: data.findings,
        codeLocations: data.codeLocations,
      });

    /*
     * Gate — what Code's gate says about the repository the run will be
     * queued on; the run is queued on that very repository. Only a
     * person's click asks it: the automatic routing queues the run as it
     * always has.
     */
    let codeRepositoryId: ObjectID | null | undefined = undefined;

    if (data.person) {
      codeRepositoryId =
        await FixPerformanceTaskTrigger.decideRepositoryForPerson({
          projectId: data.projectId,
          taskContext,
          person: data.person,
          pickedRepositoryId: data.pickedRepositoryId,
        });
    }

    return SubjectCodeFixRun.enqueueSubjectCodeFixRun({
      projectId: data.projectId,
      taskType: CodeFixTaskType.FixPerformance,
      userId: data.userId,
      taskContext,
      ...(codeRepositoryId !== undefined ? { codeRepositoryId } : {}),
    });
  }

  /*
   * The repository a person's click has the run made in, and queued on
   * (#11075): the one they picked, when they may use it - else the one the
   * trace's facts resolve to among the connected repositories they may
   * use, or the only one of those. The run is held to it when it is queued
   * and again when it starts (pickedCodeRepositoryId,
   * getRunRepositoryAllowance), so it is never made in a repository the
   * person may not use, however the repositories change before it starts.
   *
   * Refused, in Code's order: what stops everyone in the project (the bill,
   * the plan); then why this person may not use the repository - a pick
   * they may not read, may not ask AI in, or that is not connected, or none
   * of the connected repositories theirs to ask in; then whatever else
   * Code's gate says about the repository; then a pick to make, when
   * several could hold the code and the trace's facts match none.
   */
  private static async decideRepositoryForPerson(data: {
    projectId: ObjectID;
    taskContext: CodeFixTaskContext;
    person: DatabaseCommonInteractionProps;
    pickedRepositoryId?: ObjectID | undefined;
  }): Promise<ObjectID> {
    let allowance: CodeRepositoryAllowance = NO_CODE_REPOSITORY;
    let refusal: Exception | null = null;
    let usable: Array<ResolvableRepository> = [];

    if (data.pickedRepositoryId) {
      refusal = await FixPerformanceTaskTrigger.checkRepositoryPick({
        projectId: data.projectId,
        pickedRepositoryId: data.pickedRepositoryId,
        props: data.person,
      });

      if (!refusal) {
        // Keyed as the database writes an id: lower-cased.
        const pickedId: string = data.pickedRepositoryId
          .toString()
          .trim()
          .toLowerCase();

        data.taskContext.pickedCodeRepositoryId = pickedId;
        allowance = { isEveryRepository: false, repositoryIds: [pickedId] };
      }
    } else {
      const use: TracePerformanceFixRepositoryUse =
        await FixPerformanceTaskTrigger.getUsableRepositories({
          projectId: data.projectId,
          props: data.person,
        });

      usable = use.usable;
      allowance = use.allowance;

      if (use.connectedCount === 0) {
        refusal = new BadDataException(
          NO_CONNECTED_REPOSITORY_FOR_PERFORMANCE_FIX_MESSAGE,
        );
      } else if (use.usable.length === 0) {
        refusal = new NotAuthorizedException(NO_REPOSITORY_YOU_MAY_USE_MESSAGE);
      }
    }

    const start: CodeFixStart = await CodeFixStartGate.check({
      projectId: data.projectId,
      taskType: CodeFixTaskType.FixPerformance,
      taskContext: data.taskContext,
      allowance,
    });

    if (
      start.blocker &&
      (!refusal || FixPerformanceTaskTrigger.isEveryonesBlocker(start.blocker))
    ) {
      throw CodeTaskGate.toException(start.blocker);
    }

    if (refusal) {
      throw refusal;
    }

    /*
     * Somewhere to work: the pick, the repository the trace's facts resolve
     * to, or the only one the person may use. Several they may use, and the
     * trace's facts match none: the page asks for the pick first - a run
     * queued without one would find no repository when it starts.
     */
    const repositoryId: string | null =
      data.taskContext.pickedCodeRepositoryId ||
      start.codeRepositoryId?.toString().toLowerCase() ||
      (usable.length === 1 ? usable[0]!.id.toLowerCase() : null);

    if (!repositoryId) {
      throw new BadDataException(PICK_A_REPOSITORY_FOR_THE_FIX_MESSAGE);
    }

    data.taskContext.pickedCodeRepositoryId = repositoryId;

    return start.codeRepositoryId || new ObjectID(repositoryId);
  }
}
