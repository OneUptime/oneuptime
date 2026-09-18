import ObjectID from "../../../../Types/ObjectID";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus, {
  AIRunStatusHelper,
} from "../../../../Types/AI/AIRunStatus";
import AIRunCodeFixRecommendation from "../../../../Types/AI/AIRunCodeFixRecommendation";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext, {
  getInvestigationCodeFixTaskSnapshot,
  InvestigationCodeFixTaskSnapshot,
} from "../../../../Types/AI/CodeFixTaskContext";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunService from "../../../Services/AIRunService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import FixRunBudget from "../CodeFix/FixRunBudget";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import InvestigationSubjectLock from "./InvestigationSubjectLock";

interface SubjectCodeFixRunInput {
  projectId: ObjectID;
  taskType: CodeFixTaskType;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  userId?: ObjectID | undefined;
  taskContext?: CodeFixTaskContext | undefined;
}

/*
 * Shared plumbing for the non-exception CodeFix recipes: the incident/alert
 * subject recipes (ImproveInstrumentation, FixFromIncident) and the
 * trace-evidence recipe (FixPerformance). All enqueue AIRun(CodeFix) rows
 * keyed to something other than a telemetry exception, all need a
 * GitHub-App-connected repository the agent can actually clone and push,
 * and all dedupe to at most one non-terminal run per (context, recipe).
 * The triggers differ (automatic-after-inconclusive vs. user button) — the
 * enqueue idiom must not.
 */
export default class SubjectCodeFixRun {
  /*
   * Only GitHub-App-connected repositories can be cloned and pushed by the
   * agent (mirrors CodeRepositoryService.resolveRepositoryForException).
   */
  @CaptureSpan()
  public static async hasGitHubAppConnectedRepository(
    projectId: ObjectID,
  ): Promise<boolean> {
    const connectedRepositoryCount: number = (
      await CodeRepositoryService.countBy({
        query: {
          projectId,
          repositoryHostedAt: CodeRepositoryType.GitHub,
          gitHubAppInstallationId: QueryHelper.notNull(),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return connectedRepositoryCount > 0;
  }

  /*
   * Per-(subject, recipe) dedupe guard (mirrors the per-(exception,
   * taskType) guard in TelemetryExceptionService): at most one non-terminal
   * run of a recipe per incident/alert, so repeated triggers on the same
   * subject never fan out into duplicate PRs. Exactly one of
   * incidentId/alertId is expected.
   */
  @CaptureSpan()
  public static async findNonTerminalRunForSubject(data: {
    taskType: CodeFixTaskType;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<AIRun | null> {
    if (Boolean(data.incidentId) === Boolean(data.alertId)) {
      throw new BadDataException(
        "Exactly one incident or alert subject is required to find an existing fix task.",
      );
    }

    return AIRunService.findOneBy({
      query: {
        runType: AIRunType.CodeFix,
        codeFixTaskType: data.taskType,
        ...(data.incidentId
          ? { triggeredByIncidentId: data.incidentId }
          : { triggeredByAlertId: data.alertId! }),
        status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
      },
      select: { _id: true },
      props: { isRoot: true },
    });
  }

  /*
   * Per-trace dedupe for the FixPerformance recipe: at most one
   * non-terminal FixPerformance run per (project, traceId). The traceId
   * lives inside the JSON taskContext, which the Query layer cannot filter
   * on — so this scans the project's non-terminal FixPerformance runs
   * (bounded and rare: they exist only between a user click and the PR)
   * and matches the traceId in memory. Honest per-trace dedupe without a
   * dedicated column.
   */
  @CaptureSpan()
  public static async findNonTerminalPerformanceFixRunForTrace(data: {
    projectId: ObjectID;
    traceId: string;
  }): Promise<AIRun | null> {
    const activeRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeFixTaskType: CodeFixTaskType.FixPerformance,
        status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
      },
      select: { _id: true, taskContext: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    return (
      activeRuns.find((run: AIRun): boolean => {
        return run.taskContext?.traceId === data.traceId;
      }) || null
    );
  }

  /*
   * Per-(service, recipe) dedupe for the service-scoped instrumentation
   * recipes (ImproveLogging / ImproveTracing): at most one non-terminal
   * run of a recipe per (project, telemetryServiceId). Same in-memory
   * taskContext matching as the per-trace guard above — the id lives in
   * JSON the Query layer cannot filter on, and the candidate set is
   * bounded and rare.
   */
  @CaptureSpan()
  public static async findNonTerminalRunForTelemetryService(data: {
    projectId: ObjectID;
    taskType: CodeFixTaskType;
    telemetryServiceId: string;
  }): Promise<AIRun | null> {
    const activeRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeFixTaskType: data.taskType,
        status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
      },
      select: { _id: true, taskContext: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    return (
      activeRuns.find((run: AIRun): boolean => {
        return run.taskContext?.telemetryServiceId === data.telemetryServiceId;
      }) || null
    );
  }

  /*
   * Record the durable intent as a Queued CodeFix AIRun that the external
   * agent worker claims via /ai-agent-task/get-pending-task. `userId` is
   * attribution for human-triggered recipes (who clicked the button);
   * automatic triggers pass none and stay system-authored. Subject-less
   * recipes (FixPerformance) pass neither incidentId nor alertId and carry
   * their trigger-time evidence in `taskContext` instead.
   *
   * Created as root: AIRun rows are server-written only (empty create ACL);
   * callers must have gated access before enqueueing.
   *
   * Throws BadDataException when the project is over its daily fix-run
   * budget (G11 guardrail, enforced here so EVERY subject/perf recipe is
   * covered). User-triggered callers surface the message; the automatic
   * instrumentation trigger pre-checks the budget and skips quietly, with
   * its never-throws wrapper as the backstop.
   */
  @CaptureSpan()
  public static async enqueueSubjectCodeFixRun(
    data: SubjectCodeFixRunInput,
  ): Promise<AIRun> {
    if (data.incidentId && data.alertId) {
      throw new BadDataException(
        "A fix task cannot belong to both an incident and an alert.",
      );
    }

    /*
     * FixFromIncident has both human and automatic writers, and its source
     * authorization depends on which Investigation is latest. Serialize the
     * final dedupe + source revalidation + INSERT with Investigation enqueue
     * for this subject. Redis is a correctness dependency: lock acquisition
     * failure fails closed instead of falling back to a racy write.
     */
    if (data.taskType === CodeFixTaskType.FixFromIncident) {
      return InvestigationSubjectLock.runExclusive(
        {
          projectId: data.projectId,
          incidentId: data.incidentId,
          alertId: data.alertId,
        },
        async (): Promise<AIRun> => {
          const existingRun: AIRun | null =
            await this.findNonTerminalRunForSubject({
              taskType: data.taskType,
              incidentId: data.incidentId,
              alertId: data.alertId,
            });

          if (existingRun) {
            throw new BadDataException(
              "A fix pull request task is already queued or running for this subject.",
            );
          }

          return this.createSubjectCodeFixRun(data, true);
        },
      );
    }

    return this.createSubjectCodeFixRun(data, false);
  }

  private static async createSubjectCodeFixRun(
    data: SubjectCodeFixRunInput,
    revalidateInvestigationSource: boolean,
  ): Promise<AIRun> {
    await FixRunBudget.assertWithinBudget(data.projectId, {
      incidentId: data.incidentId,
      alertId: data.alertId,
    });

    const run: AIRun = new AIRun();
    run.projectId = data.projectId;
    run.runType = AIRunType.CodeFix;
    run.codeFixTaskType = data.taskType;
    run.status = AIRunStatus.Queued;

    if (data.incidentId) {
      run.triggeredByIncidentId = data.incidentId;
    } else if (data.alertId) {
      run.triggeredByAlertId = data.alertId;
    }

    if (data.userId) {
      run.userId = data.userId;
    }

    if (data.taskContext) {
      run.taskContext = data.taskContext;
    }

    if (revalidateInvestigationSource) {
      /* No awaited work may be added between this gate and the INSERT. */
      await this.assertLatestRecommendedInvestigationSource(data);
    }

    return AIRunService.create({
      data: run,
      props: { isRoot: true },
    });
  }

  private static async assertLatestRecommendedInvestigationSource(
    data: SubjectCodeFixRunInput,
  ): Promise<void> {
    const requestedSnapshot: InvestigationCodeFixTaskSnapshot | null =
      getInvestigationCodeFixTaskSnapshot(data.taskContext);

    if (!requestedSnapshot) {
      throw new BadDataException(
        "A complete Recommended investigation snapshot is required to create a fix task.",
      );
    }

    const latestInvestigation: AIRun | null = await AIRunService.findOneBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.Investigation,
        ...(data.incidentId
          ? { triggeredByIncidentId: data.incidentId }
          : { triggeredByAlertId: data.alertId! }),
      },
      select: {
        _id: true,
        status: true,
        codeFixRecommendation: true,
        taskContext: true,
      },
      sort: { createdAt: SortOrder.Descending },
      props: { isRoot: true },
    });
    const persistedSnapshot: InvestigationCodeFixTaskSnapshot | null =
      getInvestigationCodeFixTaskSnapshot(latestInvestigation?.taskContext);

    if (
      !latestInvestigation?.id ||
      latestInvestigation.id.toString() !==
        requestedSnapshot.investigationRunId ||
      latestInvestigation.status !== AIRunStatus.Completed ||
      latestInvestigation.codeFixRecommendation !==
        AIRunCodeFixRecommendation.Recommended ||
      !persistedSnapshot ||
      persistedSnapshot.investigationRunId !==
        requestedSnapshot.investigationRunId ||
      persistedSnapshot.investigationAnalysisMarkdown !==
        requestedSnapshot.investigationAnalysisMarkdown
    ) {
      throw new BadDataException(
        "The source investigation is no longer the latest durably Recommended analysis. Refresh and try again.",
      );
    }
  }
}
