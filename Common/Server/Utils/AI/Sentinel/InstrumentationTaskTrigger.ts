import ObjectID from "../../../../Types/ObjectID";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunService from "../../../Services/AIRunService";
import ProjectService from "../../../Services/ProjectService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Sentinel — the ImproveInstrumentation trigger.
 *
 * When an investigation finishes INCONCLUSIVE ("insufficient signal"), the
 * telemetry itself is the bug: the code paths involved were not observable
 * enough to diagnose. For projects that opted in
 * (Project.enableInstrumentationFixTasks, default FALSE — G11 posture:
 * autonomous PR creation is opt-in only), the inconclusive analysis becomes
 * the input to a CodeFix AIRun (codeFixTaskType: ImproveInstrumentation)
 * that the agent worker turns into a pull request adding the missing
 * observability — so the NEXT investigation of a similar signal can reach a
 * conclusion.
 *
 * Called from the investigation runners' postAnalysis, strictly AFTER the
 * analysis is posted; this trigger never throws, so a failed enqueue can
 * never fail (or duplicate) the investigation itself.
 */

export interface InstrumentationTaskGateInput {
  // The project row with enableAi + enableInstrumentationFixTasks selected.
  project: Project | null;
  // Whether the project has at least one GitHub-App-connected repository.
  hasConnectedRepository: boolean;
  // A non-terminal ImproveInstrumentation run for the same subject, if any.
  existingRun: AIRun | null;
}

export interface InstrumentationTaskGateDecision {
  enqueue: boolean;
  // Human-readable reason recorded in the debug log when skipping.
  reason: string;
}

export default class InstrumentationTaskTrigger {
  /*
   * The pure trigger decision, separated from IO so it can be tested
   * directly: opt-in (default FALSE), a repository the agent can actually
   * open a PR against, and the per-subject dedupe guard.
   */
  public static shouldEnqueueInstrumentationTask(
    input: InstrumentationTaskGateInput,
  ): InstrumentationTaskGateDecision {
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
    if (input.project.enableInstrumentationFixTasks !== true) {
      return {
        enqueue: false,
        reason: "project has not opted in to instrumentation fix tasks",
      };
    }

    if (!input.hasConnectedRepository) {
      return {
        enqueue: false,
        reason: "project has no GitHub-App-connected repository",
      };
    }

    /*
     * Dedupe: at most one non-terminal ImproveInstrumentation run per
     * incident/alert — repeated inconclusive attempts on the same subject
     * must not fan out into duplicate PRs.
     */
    if (input.existingRun) {
      return {
        enqueue: false,
        reason:
          "a non-terminal ImproveInstrumentation run already exists for this subject",
      };
    }

    return {
      enqueue: true,
      reason: "passed opt-in, repository and dedupe gates",
    };
  }

  /*
   * Record the durable intent as a Queued CodeFix AIRun that the external
   * agent worker claims via /ai-agent-task/get-pending-task. Exactly one of
   * incidentId/alertId is expected (the investigation's subject). NEVER
   * throws — every failure is logged and swallowed, because this runs
   * inside the investigation's postAnalysis and must not fail it.
   */
  @CaptureSpan()
  public static async enqueueForInconclusiveInvestigation(data: {
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
          enableInstrumentationFixTasks: true,
        },
        props: { isRoot: true },
      });

      /*
       * Cheapest gate first: skip the repository count for the (default)
       * not-opted-in case.
       */
      const optInDecision: InstrumentationTaskGateDecision =
        this.shouldEnqueueInstrumentationTask({
          project,
          hasConnectedRepository: true,
          existingRun: null,
        });

      if (!optInDecision.enqueue) {
        logger.debug(
          `Sentinel: not enqueueing instrumentation task for project ${projectId.toString()} — ${optInDecision.reason}.`,
        );
        return;
      }

      /*
       * Only GitHub-App-connected repositories can be cloned and pushed by
       * the agent (mirrors CodeRepositoryService.resolveRepositoryForException).
       */
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

      /*
       * Per-subject dedupe (mirrors the per-(exception, taskType) guard in
       * TelemetryExceptionService): one non-terminal ImproveInstrumentation
       * run per incident/alert.
       */
      const existingRun: AIRun | null = await AIRunService.findOneBy({
        query: {
          runType: AIRunType.CodeFix,
          codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
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

      const decision: InstrumentationTaskGateDecision =
        this.shouldEnqueueInstrumentationTask({
          project,
          hasConnectedRepository: connectedRepositoryCount > 0,
          existingRun,
        });

      if (!decision.enqueue) {
        logger.debug(
          `Sentinel: not enqueueing instrumentation task for project ${projectId.toString()} — ${decision.reason}.`,
        );
        return;
      }

      const run: AIRun = new AIRun();
      run.projectId = projectId;
      run.runType = AIRunType.CodeFix;
      run.codeFixTaskType = CodeFixTaskType.ImproveInstrumentation;
      run.status = AIRunStatus.Queued;

      if (data.incidentId) {
        run.triggeredByIncidentId = data.incidentId;
      } else if (data.alertId) {
        run.triggeredByAlertId = data.alertId;
      }

      const createdRun: AIRun = await AIRunService.create({
        data: run,
        props: { isRoot: true },
      });

      logger.debug(
        `Sentinel: enqueued ImproveInstrumentation run ${createdRun.id?.toString()} for ${
          data.incidentId
            ? `incident ${data.incidentId.toString()}`
            : `alert ${data.alertId?.toString()}`
        } after an inconclusive investigation.`,
      );
    } catch (error) {
      logger.error(
        `Sentinel: failed to enqueue instrumentation task for project ${projectId.toString()}: ${error}`,
      );
    }
  }
}
