import ObjectID from "../../../../Types/ObjectID";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunService from "../../../Services/AIRunService";
import ProjectService from "../../../Services/ProjectService";
import FixRunBudget, { FixRunBudgetDecision } from "../CodeFix/FixRunBudget";
import SubjectCodeFixRun from "./SubjectCodeFixRun";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — the FixFromIncident trigger (the roadmap's headline `code_fix`
 * capability, vision §4.8), in two forms:
 *
 * HUMAN-TRIGGERED: after an AI investigation posts a root-cause analysis on
 * an incident or alert, the user can click "Open Fix PR from this analysis"
 * on the investigation panel: the agent takes the posted analysis (the
 * RootCause feed item) as its entire context and opens a fix pull request.
 * No project opt-in flag is needed for this form: the human in the loop IS
 * the gate (G11 posture preserved). It runs inside a user-facing endpoint
 * (POST /ai-investigation/create-fix-task) and FAILS EARLY with a clear
 * message when a gate is not met.
 *
 * AUTOMATIC: for projects that opted in (Project.enableAutomaticCodeFixes,
 * default FALSE — G11 posture: autonomous PR creation is opt-in only), an
 * investigation that ends with a POSITIVE confident classification (per the
 * structured G6 confidence signal, never the analysis prose) enqueues the
 * same FixFromIncident task with no human click. Like its
 * InstrumentationTaskTrigger sibling it is fire-and-forget inside the
 * investigation's postAnalysis and never throws. The PR still opens as a
 * DRAFT and is always human-reviewed — the opt-in moves the human gate from
 * PR creation to PR review, never past it.
 */

export interface AutoFixTaskGateInput {
  // The project row with enableAi + enableAutomaticCodeFixes selected.
  project: Project | null;
  // Whether the project has at least one GitHub-App-connected repository.
  hasConnectedRepository: boolean;
  // A non-terminal FixFromIncident run for the same subject, if any.
  existingRun: AIRun | null;
}

export interface AutoFixTaskGateDecision {
  enqueue: boolean;
  // Human-readable reason recorded in the debug log when skipping.
  reason: string;
}

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

  /*
   * The pure trigger decision for the AUTOMATIC form, separated from IO so
   * it can be tested directly: strict opt-in (default FALSE), a repository
   * the agent can actually open a PR against, and the per-subject dedupe
   * guard. The caller has already established the confident-investigation
   * prerequisite (this runs inside the investigation's postAnalysis, gated
   * by AIConfidenceSignal.shouldAutoEnqueueCodeFixTask).
   */
  public static shouldAutoEnqueueFixTask(
    input: AutoFixTaskGateInput,
  ): AutoFixTaskGateDecision {
    if (!input.project) {
      return { enqueue: false, reason: "project not found" };
    }

    if (input.project.enableAi === false) {
      return { enqueue: false, reason: "AI is disabled for the project" };
    }

    /*
     * Strict opt-in — the column defaults to false, so unset/legacy rows
     * never enqueue. Autonomous PR creation must never be default-on.
     */
    if (input.project.enableAutomaticCodeFixes !== true) {
      return {
        enqueue: false,
        reason: "project has not opted in to automatic code fixes",
      };
    }

    if (!input.hasConnectedRepository) {
      return {
        enqueue: false,
        reason: "project has no GitHub-App-connected repository",
      };
    }

    /*
     * Dedupe: at most one non-terminal FixFromIncident run per
     * incident/alert — an automatic trigger racing a human click (or a
     * re-investigation) must not fan out into duplicate PRs.
     */
    if (input.existingRun) {
      return {
        enqueue: false,
        reason:
          "a non-terminal FixFromIncident run already exists for this subject",
      };
    }

    return {
      enqueue: true,
      reason: "passed opt-in, repository and dedupe gates",
    };
  }

  /*
   * The AUTOMATIC form: enqueue a FixFromIncident run for a subject whose
   * investigation just posted a CONFIDENT analysis. Exactly one of
   * incidentId/alertId is expected. NEVER throws — every failure is logged
   * and swallowed, because this runs inside the investigation's
   * postAnalysis and must not fail it. No userId: the run stays
   * system-authored.
   */
  @CaptureSpan()
  public static async autoEnqueueFromConfidentInvestigation(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<void> {
    const { projectId } = data;

    try {
      if (!data.incidentId && !data.alertId) {
        return;
      }

      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          enableAi: true,
          enableAutomaticCodeFixes: true,
        },
        props: { isRoot: true },
      });

      /*
       * Cheapest gate first: skip the repository count for the (default)
       * not-opted-in case.
       */
      const optInDecision: AutoFixTaskGateDecision =
        this.shouldAutoEnqueueFixTask({
          project,
          hasConnectedRepository: true,
          existingRun: null,
        });

      if (!optInDecision.enqueue) {
        logger.debug(
          `AI: not auto-enqueueing fix task for project ${projectId.toString()} — ${optInDecision.reason}.`,
        );
        return;
      }

      /*
       * G11 guardrail: the per-project daily fix-run budget. For this
       * AUTOMATIC trigger, over-budget is a logged skip — never an error
       * thrown into the investigation.
       */
      const budget: FixRunBudgetDecision =
        await FixRunBudget.getBudgetStatus(projectId);

      if (!budget.allowed) {
        logger.debug(
          `AI: not auto-enqueueing fix task for project ${projectId.toString()} — ${FixRunBudget.describeRejection(budget)}`,
        );
        return;
      }

      const hasConnectedRepository: boolean =
        await SubjectCodeFixRun.hasGitHubAppConnectedRepository(projectId);

      const existingRun: AIRun | null =
        await SubjectCodeFixRun.findNonTerminalRunForSubject({
          taskType: CodeFixTaskType.FixFromIncident,
          incidentId: data.incidentId,
          alertId: data.alertId,
        });

      const decision: AutoFixTaskGateDecision = this.shouldAutoEnqueueFixTask({
        project,
        hasConnectedRepository,
        existingRun,
      });

      if (!decision.enqueue) {
        logger.debug(
          `AI: not auto-enqueueing fix task for project ${projectId.toString()} — ${decision.reason}.`,
        );
        return;
      }

      const createdRun: AIRun =
        await SubjectCodeFixRun.enqueueSubjectCodeFixRun({
          projectId,
          taskType: CodeFixTaskType.FixFromIncident,
          incidentId: data.incidentId,
          alertId: data.alertId,
        });

      logger.debug(
        `AI: auto-enqueued FixFromIncident run ${createdRun.id?.toString()} for ${
          data.incidentId
            ? `incident ${data.incidentId.toString()}`
            : `alert ${data.alertId?.toString()}`
        } after a confident investigation.`,
      );
    } catch (error) {
      logger.error(
        `AI: failed to auto-enqueue fix task for project ${projectId.toString()}: ${error}`,
      );
    }
  }
}
