import ObjectID from "../../../../Types/ObjectID";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunService from "../../../Services/AIRunService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Shared plumbing for the incident/alert-subject CodeFix recipes
 * (ImproveInstrumentation, FixFromIncident). Both enqueue AIRun(CodeFix)
 * rows keyed to an incident or alert rather than a telemetry exception,
 * both need a GitHub-App-connected repository the agent can actually clone
 * and push, and both dedupe to at most one non-terminal run per
 * (subject, recipe). The triggers differ (automatic-after-inconclusive vs.
 * user button after a completed analysis) — the enqueue idiom must not.
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
   * Record the durable intent as a Queued CodeFix AIRun that the external
   * agent worker claims via /ai-agent-task/get-pending-task. `userId` is
   * attribution for human-triggered recipes (who clicked the button);
   * automatic triggers pass none and stay system-authored.
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

    return AIRunService.create({
      data: run,
      props: { isRoot: true },
    });
  }
}
