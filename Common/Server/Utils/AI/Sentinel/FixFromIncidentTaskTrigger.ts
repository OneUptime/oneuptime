import ObjectID from "../../../../Types/ObjectID";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunService from "../../../Services/AIRunService";
import SubjectCodeFixRun from "./SubjectCodeFixRun";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Sentinel — the FixFromIncident trigger (the roadmap's headline `code_fix`
 * capability, vision §4.8, in human-triggered form).
 *
 * After a Sentinel investigation posts a root-cause analysis on an incident
 * or alert, the user can click "Open Fix PR from this analysis" on the
 * investigation panel: the agent takes the posted analysis (the RootCause
 * feed item) as its entire context and opens a fix pull request. Unlike the
 * ImproveInstrumentation sibling this is NOT automatic — a human reads the
 * analysis and decides a fix PR is worth opening, so no project opt-in flag
 * is needed: the human in the loop IS the gate (G11 posture preserved).
 *
 * And unlike InstrumentationTaskTrigger (fire-and-forget inside the
 * investigation's postAnalysis, never throws), this runs inside a
 * user-facing endpoint (POST /ai-investigation/create-fix-task) and FAILS
 * EARLY with a clear message when a gate is not met.
 */
export default class FixFromIncidentTaskTrigger {
  /*
   * Gate and enqueue a FixFromIncident CodeFix run for the subject. The
   * caller must already have access-checked the subject under the USER's
   * permissions — this method reads and writes as root. Exactly one of
   * incidentId/alertId is expected; userId is the clicking user
   * (attribution on the run).
   *
   * Throws BadDataException naming the failed gate: no completed
   * investigation, no GitHub-App repository, or a duplicate active run.
   */
  @CaptureSpan()
  public static async createFixTaskFromInvestigation(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    userId: ObjectID;
  }): Promise<AIRun> {
    if (!data.incidentId && !data.alertId) {
      throw new BadDataException(
        "An incident or alert subject is required to create a fix task.",
      );
    }

    const subjectLabel: "incident" | "alert" = data.incidentId
      ? "incident"
      : "alert";

    /*
     * Gate 1: a COMPLETED investigation must exist for the subject — its
     * posted analysis (the RootCause feed item) is the fix task's entire
     * context. Without one the worker would have nothing to work from.
     */
    const completedInvestigation: AIRun | null = await AIRunService.findOneBy({
      query: {
        runType: AIRunType.Investigation,
        status: AIRunStatus.Completed,
        ...(data.incidentId
          ? { triggeredByIncidentId: data.incidentId }
          : { triggeredByAlertId: data.alertId! }),
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (!completedInvestigation) {
      throw new BadDataException(
        `No completed AI investigation exists for this ${subjectLabel} — the fix task uses the investigation's posted analysis as its context. Wait for the investigation to complete, or enable AI investigations in the AI settings.`,
      );
    }

    // Gate 2: a repository the agent can actually open a PR against.
    const hasConnectedRepository: boolean =
      await SubjectCodeFixRun.hasGitHubAppConnectedRepository(data.projectId);

    if (!hasConnectedRepository) {
      throw new BadDataException(
        "No GitHub-App-connected repository exists for this project, so the agent has nowhere to open the fix pull request. Connect one under AI > Code Repositories.",
      );
    }

    /*
     * Gate 3: per-subject dedupe — at most one non-terminal FixFromIncident
     * run per incident/alert (repeated clicks must not fan out into
     * duplicate PRs).
     */
    const existingRun: AIRun | null =
      await SubjectCodeFixRun.findNonTerminalRunForSubject({
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId: data.incidentId,
        alertId: data.alertId,
      });

    if (existingRun) {
      throw new BadDataException(
        `A fix pull request task is already queued or running for this ${subjectLabel}. Track its progress on the AI > Tasks page.`,
      );
    }

    return SubjectCodeFixRun.enqueueSubjectCodeFixRun({
      projectId: data.projectId,
      taskType: CodeFixTaskType.FixFromIncident,
      incidentId: data.incidentId,
      alertId: data.alertId,
      userId: data.userId,
    });
  }
}
