import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import URL from "../../../../Types/API/URL";
import { Green500, Red500 } from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import AIRemediationActionStatus from "../../../../Types/AI/AIRemediationActionStatus";
import RunbookExecutionStatus from "../../../../Types/Runbook/RunbookExecutionStatus";
import AIRemediationAction from "../../../../Models/DatabaseModels/AIRemediationAction";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import AIRemediationActionService from "../../../Services/AIRemediationActionService";
import RunbookExecutionService from "../../../Services/RunbookExecutionService";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import AlertFeedService from "../../../Services/AlertFeedService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import DatabaseConfig from "../../../DatabaseConfig";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — the remediation status sweeper (invoked every minute by the
 * Workers cron AIRemediation:SyncExecutionStatus).
 *
 * Two duties:
 *   (a) Finalize Executing actions by reading their linked RunbookExecution:
 *       Completed → Succeeded, Failed/Cancelled → Failed (carrying the
 *       execution's failureReason). Every finalization posts an outcome
 *       feed item to the subject WITH a workspace notification — an
 *       execution on customer infrastructure is always news, success or
 *       failure. Transitions are CAS'd, so this sweeper racing anything
 *       else is safe by construction.
 *   (b) Sweep Proposed actions past their expiresAt to Expired — quietly.
 *       Nobody acted; there is nothing to announce.
 */

// Per-tick caps keep one sweep bounded; the next tick picks up the rest.
const MAX_ACTIONS_PER_SWEEP: number = 100;

/*
 * An Executing action with no linked execution means the dispatcher crashed
 * between the Executing CAS and storing the execution id. Give the store a
 * generous window, then fail the action so it cannot sit Executing forever.
 */
const MISSING_EXECUTION_GRACE_MINUTES: number = 60;

export default class RemediationStatusSync {
  @CaptureSpan()
  public static async sync(): Promise<void> {
    await this.syncExecutingActions();
    await this.sweepExpiredProposals();
  }

  /*
   * (a) Finalize Executing actions from their RunbookExecution status.
   * Each action is handled in its own try/catch so one bad row can never
   * stall the sweep.
   */
  @CaptureSpan()
  public static async syncExecutingActions(): Promise<void> {
    const executingActions: Array<AIRemediationAction> =
      await AIRemediationActionService.findBy({
        query: { status: AIRemediationActionStatus.Executing },
        select: {
          _id: true,
          projectId: true,
          incidentId: true,
          alertId: true,
          title: true,
          runbookId: true,
          runbookExecutionId: true,
          executedAt: true,
        },
        limit: MAX_ACTIONS_PER_SWEEP,
        skip: 0,
        props: { isRoot: true },
      });

    for (const action of executingActions) {
      try {
        await this.syncOneExecutingAction(action);
      } catch (error) {
        logger.error(
          `AI remediation: failed to sync action ${action._id?.toString()}: ${error}`,
        );
      }
    }
  }

  private static async syncOneExecutingAction(
    action: AIRemediationAction,
  ): Promise<void> {
    const actionId: ObjectID = new ObjectID(action._id!);

    if (!action.runbookExecutionId) {
      /*
       * Dispatch crashed before the execution id was stored. Only fail the
       * action once the grace window has clearly passed.
       */
      if (
        action.executedAt &&
        OneUptimeDate.getDifferenceInMinutes(
          action.executedAt,
          OneUptimeDate.getCurrentDate(),
        ) >= MISSING_EXECUTION_GRACE_MINUTES
      ) {
        const won: number =
          await AIRemediationActionService.attemptStatusTransition({
            actionId,
            fromStatus: AIRemediationActionStatus.Executing,
            set: {
              status: AIRemediationActionStatus.Failed,
              errorMessage:
                "Execution dispatch never completed — no runbook execution was linked to this action.",
            },
          });

        if (won > 0) {
          await this.postOutcomeFeedItem({
            action,
            succeeded: false,
            detail:
              "Execution dispatch never completed — no runbook execution was linked to this action.",
          });
        }
      }
      return;
    }

    const execution: RunbookExecution | null =
      await RunbookExecutionService.findOneById({
        id: action.runbookExecutionId,
        select: {
          status: true,
          failureReason: true,
        },
        props: { isRoot: true },
      });

    if (!execution) {
      const won: number =
        await AIRemediationActionService.attemptStatusTransition({
          actionId,
          fromStatus: AIRemediationActionStatus.Executing,
          set: {
            status: AIRemediationActionStatus.Failed,
            errorMessage: "The linked runbook execution no longer exists.",
          },
        });

      if (won > 0) {
        await this.postOutcomeFeedItem({
          action,
          succeeded: false,
          detail: "The linked runbook execution no longer exists.",
        });
      }
      return;
    }

    if (execution.status === RunbookExecutionStatus.Completed) {
      const won: number =
        await AIRemediationActionService.attemptStatusTransition({
          actionId,
          fromStatus: AIRemediationActionStatus.Executing,
          set: { status: AIRemediationActionStatus.Succeeded },
        });

      if (won > 0) {
        await this.postOutcomeFeedItem({
          action,
          succeeded: true,
          detail: "The runbook execution completed.",
        });
      }
      return;
    }

    if (
      execution.status === RunbookExecutionStatus.Failed ||
      execution.status === RunbookExecutionStatus.Cancelled
    ) {
      const detail: string =
        execution.failureReason ||
        `The runbook execution was ${execution.status?.toLowerCase()}.`;

      const won: number =
        await AIRemediationActionService.attemptStatusTransition({
          actionId,
          fromStatus: AIRemediationActionStatus.Executing,
          set: {
            status: AIRemediationActionStatus.Failed,
            errorMessage: detail,
          },
        });

      if (won > 0) {
        await this.postOutcomeFeedItem({
          action,
          succeeded: false,
          detail,
        });
      }
      return;
    }

    // Scheduled / Running / WaitingForManualStep: still in flight — skip.
  }

  /*
   * (b) Sweep stale proposals to Expired. Quiet by design: nobody acted, so
   * there is nothing to announce. CAS-guarded like every other transition.
   */
  @CaptureSpan()
  public static async sweepExpiredProposals(): Promise<void> {
    const expiredProposals: Array<AIRemediationAction> =
      await AIRemediationActionService.findBy({
        query: {
          status: AIRemediationActionStatus.Proposed,
          expiresAt: QueryHelper.lessThan(OneUptimeDate.getCurrentDate()),
        },
        select: { _id: true },
        limit: MAX_ACTIONS_PER_SWEEP,
        skip: 0,
        props: { isRoot: true },
      });

    for (const proposal of expiredProposals) {
      try {
        await AIRemediationActionService.attemptStatusTransition({
          actionId: new ObjectID(proposal._id!),
          fromStatus: AIRemediationActionStatus.Proposed,
          set: { status: AIRemediationActionStatus.Expired },
        });
      } catch (error) {
        logger.error(
          `AI remediation: failed to expire proposal ${proposal._id?.toString()}: ${error}`,
        );
      }
    }
  }

  /*
   * The outcome feed item, posted WITH a workspace notification on both
   * outcomes — something just ran (or failed to run) on the customer's
   * infrastructure, and that is always news. Links to the runbook execution
   * page where the step-by-step outputs live. Best-effort: a feed failure
   * is logged, never thrown — the action row already holds the outcome.
   */
  private static async postOutcomeFeedItem(data: {
    action: AIRemediationAction;
    succeeded: boolean;
    detail: string;
  }): Promise<void> {
    const { action } = data;

    if (!action.projectId || (!action.incidentId && !action.alertId)) {
      return;
    }

    try {
      const lines: Array<string> = [];
      lines.push(
        data.succeeded
          ? "## ✅ AI Remediation Succeeded"
          : "## ❌ AI Remediation Failed",
      );
      lines.push("");
      lines.push(
        `**${action.title || "Remediation action"}** — ${data.detail}`,
      );

      // Link to the execution page when the linkage survived.
      if (action.runbookId && action.runbookExecutionId) {
        const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();
        const executionLink: URL = URL.fromString(
          dashboardUrl.toString(),
        ).addRoute(
          `/${action.projectId.toString()}/runbooks/${action.runbookId.toString()}/executions/${action.runbookExecutionId.toString()}`,
        );
        lines.push("");
        lines.push(
          `[View the runbook execution](${executionLink.toString()}) for step-by-step outputs.`,
        );
      }

      const feedInfoInMarkdown: string = lines.join("\n");
      const displayColor: Color = data.succeeded ? Green500 : Red500;

      if (action.incidentId) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: action.incidentId,
          projectId: action.projectId,
          incidentFeedEventType: IncidentFeedEventType.RemediationNotes,
          displayColor,
          feedInfoInMarkdown,
          workspaceNotification: {
            sendWorkspaceNotification: true,
          },
        });
      } else if (action.alertId) {
        await AlertFeedService.createAlertFeedItem({
          alertId: action.alertId,
          projectId: action.projectId,
          alertFeedEventType: AlertFeedEventType.RemediationNotes,
          displayColor,
          feedInfoInMarkdown,
          workspaceNotification: {
            sendWorkspaceNotification: true,
          },
        });
      }
    } catch (error) {
      logger.error(
        `AI remediation: failed to post outcome feed item for action ${action._id?.toString()}: ${error}`,
      );
    }
  }
}
