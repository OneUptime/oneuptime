import ObjectID from "../../../../Types/ObjectID";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext from "../../../../Types/AI/CodeFixTaskContext";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunService from "../../../Services/AIRunService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";

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
    return AIRunService.findOneBy({
      query: {
        runType: AIRunType.CodeFix,
        codeFixTaskType: data.taskType,
        ...(data.incidentId
          ? { triggeredByIncidentId: data.incidentId }
          : { triggeredByAlertId: data.alertId! }),
        status: QueryHelper.notIn([
          AIRunStatus.Completed,
          AIRunStatus.Error,
          AIRunStatus.Cancelled,
          AIRunStatus.Stale,
        ]),
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
        status: QueryHelper.notIn([
          AIRunStatus.Completed,
          AIRunStatus.Error,
          AIRunStatus.Cancelled,
          AIRunStatus.Stale,
        ]),
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
   * Record the durable intent as a Queued CodeFix AIRun that the external
   * agent worker claims via /ai-agent-task/get-pending-task. `userId` is
   * attribution for human-triggered recipes (who clicked the button);
   * automatic triggers pass none and stay system-authored. Subject-less
   * recipes (FixPerformance) pass neither incidentId nor alertId and carry
   * their trigger-time evidence in `taskContext` instead.
   *
   * Created as root: AIRun rows are server-written only (empty create ACL);
   * callers must have gated access before enqueueing.
   */
  @CaptureSpan()
  public static async enqueueSubjectCodeFixRun(data: {
    projectId: ObjectID;
    taskType: CodeFixTaskType;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    userId?: ObjectID | undefined;
    taskContext?: CodeFixTaskContext | undefined;
  }): Promise<AIRun> {
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

    return AIRunService.create({
      data: run,
      props: { isRoot: true },
    });
  }
}
