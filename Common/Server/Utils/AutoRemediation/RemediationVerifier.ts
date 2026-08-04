import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationPlanExecutionStatus,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import RunbookExecutionStatus from "../../../Types/Runbook/RunbookExecutionStatus";
import { Green500, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import QueryHelper from "../../Types/Database/QueryHelper";
import AlertFeedService from "../../Services/AlertFeedService";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import AutoRemediationSuggestionService from "../../Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../Services/IncidentFeedService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import MonitorService from "../../Services/MonitorService";
import MonitorStatusService from "../../Services/MonitorStatusService";
import RunbookExecutionService from "../../Services/RunbookExecutionService";
import CommandPlanExecutor from "./CommandPlanExecutor";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * Auto-remediation — the outcome verifier.
 *
 * A remediation is not done when the runbook exits 0 — it is done when the
 * subject's monitors are back to an operational state (or a human resolved
 * the incident/alert) within the verification window. This every-minute
 * sweep closes that loop for every Approved/AutoExecuted suggestion:
 *
 *   runbook failed/cancelled        -> verification Failed
 *   runbook overran the window      -> verification Failed
 *   monitors recovered in time      -> verification Verified
 *                                      (+ optional system auto-resolve)
 *   subject already resolved        -> verification Verified
 *   window elapsed, still unhealthy -> verification Failed
 *   nothing to verify against       -> verification Skipped
 *
 * Verification NEVER touches paging: escalation continues (or stops on
 * ack/resolve) exactly as it always did. Every conclusion goes through a
 * verification-status CAS, so concurrent Workers replicas settle each
 * verification exactly once. The Verified/Failed columns are the
 * measurement layer: per-rule verified-fixed rate is what earns (or
 * revokes) FullAuto trust.
 */

type VerificationOutcome = {
  status: AutoRemediationVerificationStatus;
  note: string;
  pingWorkspace: boolean;
  displayColor: Color;
  // Set only on Verified outcomes where the rule opted into auto-resolve.
  shouldAutoResolve: boolean;
};

export default class RemediationVerifier {
  @CaptureSpan()
  public static async verifyPendingRemediations(): Promise<void> {
    const pending: Array<AutoRemediationSuggestion> =
      await AutoRemediationSuggestionService.findBy({
        query: {
          verificationStatus: AutoRemediationVerificationStatus.Pending,
          /*
           * Only executions-in-flight verify. A rolled-back approval
           * (status back to Suggested) or a dismissal can leave a stale
           * Pending marker behind — re-approving stamps a fresh one.
           */
          status: QueryHelper.any([
            AutoRemediationSuggestionStatus.Approved,
            AutoRemediationSuggestionStatus.AutoExecuted,
          ]),
        },
        select: {
          _id: true,
          projectId: true,
          incidentId: true,
          alertId: true,
          runbookExecutionId: true,
          suggestionType: true,
          commandPlan: true,
          aiRunId: true,
          verificationDeadlineAt: true,
          autoResolveOnRecovery: true,
          ruleNameSnapshot: true,
          runbookNameSnapshot: true,
        },
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      });

    for (const suggestion of pending) {
      try {
        const outcome: VerificationOutcome | null =
          await this.evaluate(suggestion);

        if (!outcome) {
          continue; // Still inside the window — check again next tick.
        }

        const transitioned: number =
          await AutoRemediationSuggestionService.attemptVerificationTransition({
            suggestionId: suggestion.id!,
            fromVerificationStatus: AutoRemediationVerificationStatus.Pending,
            set: {
              verificationStatus: outcome.status,
              verificationCompletedAt: OneUptimeDate.getCurrentDate(),
              verificationNote: outcome.note,
            },
          });

        if (transitioned === 0) {
          continue; // Another sweep settled it first.
        }

        if (outcome.shouldAutoResolve) {
          await this.systemResolveSubject(suggestion);
        }

        if (outcome.status !== AutoRemediationVerificationStatus.Skipped) {
          await this.postFeedItem({
            suggestion,
            outcome,
          });
        }

        /*
         * G2's undo arm: a FAILED command-plan remediation rolls back the
         * commands that ran (the ones carrying a rollbackCommand). Fired
         * only after this sweep WON the verification CAS, so exactly one
         * replica ever rolls back a given suggestion.
         */
        if (
          outcome.status === AutoRemediationVerificationStatus.Failed &&
          suggestion.suggestionType ===
            AutoRemediationSuggestionType.CommandPlan
        ) {
          await CommandPlanExecutor.executeRollback({ suggestion });
        }
      } catch (error) {
        logger.error(
          `RemediationVerifier: failed to verify suggestion ${suggestion.id?.toString()}: ${error}`,
        );
      }
    }
  }

  /*
   * Decide the verification outcome, or null while the window is still
   * open and nothing has concluded yet.
   */
  private static async evaluate(
    suggestion: AutoRemediationSuggestion,
  ): Promise<VerificationOutcome | null> {
    /*
     * Command-plan suggestions have no runbook execution — their execution
     * record IS the plan persisted on the suggestion.
     */
    if (
      suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan
    ) {
      return this.evaluateCommandPlan(suggestion);
    }

    const runbookName: string = suggestion.runbookNameSnapshot || "Runbook";

    if (!suggestion.runbookExecutionId) {
      return {
        status: AutoRemediationVerificationStatus.Skipped,
        note: "No runbook execution was recorded for this suggestion.",
        pingWorkspace: false,
        displayColor: Red500,
        shouldAutoResolve: false,
      };
    }

    const execution: RunbookExecution | null =
      await RunbookExecutionService.findOneById({
        id: suggestion.runbookExecutionId,
        select: {
          _id: true,
          status: true,
        },
        props: { isRoot: true },
      });

    if (!execution) {
      return {
        status: AutoRemediationVerificationStatus.Skipped,
        note: "The runbook execution no longer exists.",
        pingWorkspace: false,
        displayColor: Red500,
        shouldAutoResolve: false,
      };
    }

    const deadlinePassed: boolean = suggestion.verificationDeadlineAt
      ? suggestion.verificationDeadlineAt.getTime() <
        OneUptimeDate.getCurrentDate().getTime()
      : false;

    if (execution.status === RunbookExecutionStatus.Failed) {
      return {
        status: AutoRemediationVerificationStatus.Failed,
        note: `Runbook "${runbookName}" failed — remediation was not verified.`,
        pingWorkspace: true,
        displayColor: Red500,
        shouldAutoResolve: false,
      };
    }

    if (execution.status === RunbookExecutionStatus.Cancelled) {
      return {
        status: AutoRemediationVerificationStatus.Failed,
        note: `Runbook "${runbookName}" was cancelled — remediation was not verified.`,
        pingWorkspace: false,
        displayColor: Red500,
        shouldAutoResolve: false,
      };
    }

    if (execution.status !== RunbookExecutionStatus.Completed) {
      // Scheduled / Running / WaitingForManualStep.
      if (deadlinePassed) {
        return {
          status: AutoRemediationVerificationStatus.Failed,
          note: `Runbook "${runbookName}" did not complete within the verification window.`,
          pingWorkspace: true,
          displayColor: Red500,
          shouldAutoResolve: false,
        };
      }
      return null;
    }

    // The runbook completed — did the subject actually recover?
    if (await this.isSubjectResolved(suggestion)) {
      return {
        status: AutoRemediationVerificationStatus.Verified,
        note: `The ${suggestion.incidentId ? "incident" : "alert"} was resolved within the verification window.`,
        pingWorkspace: false,
        displayColor: Green500,
        shouldAutoResolve: false,
      };
    }

    const monitorsOperational: boolean | null =
      await this.areSubjectMonitorsOperational(suggestion);

    if (monitorsOperational === null) {
      return {
        status: AutoRemediationVerificationStatus.Skipped,
        note: "There are no monitors to verify recovery against.",
        pingWorkspace: false,
        displayColor: Green500,
        shouldAutoResolve: false,
      };
    }

    if (monitorsOperational) {
      return {
        status: AutoRemediationVerificationStatus.Verified,
        note: `Runbook "${runbookName}" completed and the monitor(s) returned to an operational state within the verification window.`,
        pingWorkspace: true,
        displayColor: Green500,
        shouldAutoResolve: suggestion.autoResolveOnRecovery === true,
      };
    }

    if (deadlinePassed) {
      return {
        status: AutoRemediationVerificationStatus.Failed,
        note: `Runbook "${runbookName}" completed but the service did not recover within the verification window — escalation continues as normal.`,
        pingWorkspace: true,
        displayColor: Red500,
        shouldAutoResolve: false,
      };
    }

    return null;
  }

  /*
   * The command-plan twin of the runbook evaluation. Same decision shape:
   * the plan's execution state plays the role of the runbook execution
   * status, and recovery is judged by the same subject-resolved /
   * monitors-operational checks. A Failed outcome triggers the rollback
   * arm in the caller.
   */
  private static async evaluateCommandPlan(
    suggestion: AutoRemediationSuggestion,
  ): Promise<VerificationOutcome | null> {
    const plan: AiRemediationCommandPlan | null =
      AiRemediationCommandPlanUtil.parse(suggestion.commandPlan);

    if (!plan) {
      return {
        status: AutoRemediationVerificationStatus.Skipped,
        note: "No command plan was recorded for this suggestion.",
        pingWorkspace: false,
        displayColor: Red500,
        shouldAutoResolve: false,
      };
    }

    const deadlinePassed: boolean = suggestion.verificationDeadlineAt
      ? suggestion.verificationDeadlineAt.getTime() <
        OneUptimeDate.getCurrentDate().getTime()
      : false;

    if (plan.executionStatus === AiRemediationPlanExecutionStatus.Failed) {
      return {
        status: AutoRemediationVerificationStatus.Failed,
        note: "The AI command plan did not complete — a command failed. Executed commands with a rollback are being rolled back.",
        pingWorkspace: true,
        displayColor: Red500,
        shouldAutoResolve: false,
      };
    }

    if (plan.executionStatus !== AiRemediationPlanExecutionStatus.Completed) {
      // NotStarted / Running — the executor may have died mid-plan.
      if (deadlinePassed) {
        return {
          status: AutoRemediationVerificationStatus.Failed,
          note: "The AI command plan did not complete within the verification window.",
          pingWorkspace: true,
          displayColor: Red500,
          shouldAutoResolve: false,
        };
      }
      return null;
    }

    // The plan completed — did the subject actually recover?
    if (await this.isSubjectResolved(suggestion)) {
      return {
        status: AutoRemediationVerificationStatus.Verified,
        note: `The ${suggestion.incidentId ? "incident" : "alert"} was resolved within the verification window.`,
        pingWorkspace: false,
        displayColor: Green500,
        shouldAutoResolve: false,
      };
    }

    const monitorsOperational: boolean | null =
      await this.areSubjectMonitorsOperational(suggestion);

    if (monitorsOperational === null) {
      return {
        status: AutoRemediationVerificationStatus.Skipped,
        note: "There are no monitors to verify recovery against.",
        pingWorkspace: false,
        displayColor: Green500,
        shouldAutoResolve: false,
      };
    }

    if (monitorsOperational) {
      return {
        status: AutoRemediationVerificationStatus.Verified,
        note: "The AI command remediation completed and the monitor(s) returned to an operational state within the verification window.",
        pingWorkspace: true,
        displayColor: Green500,
        shouldAutoResolve: suggestion.autoResolveOnRecovery === true,
      };
    }

    if (deadlinePassed) {
      return {
        status: AutoRemediationVerificationStatus.Failed,
        note: "The AI command remediation completed but the service did not recover within the verification window — executed commands with a rollback are being rolled back, and escalation continues as normal.",
        pingWorkspace: true,
        displayColor: Red500,
        shouldAutoResolve: false,
      };
    }

    return null;
  }

  private static async isSubjectResolved(
    suggestion: AutoRemediationSuggestion,
  ): Promise<boolean> {
    if (suggestion.incidentId) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: suggestion.incidentId,
        select: { _id: true, currentIncidentStateId: true },
        props: { isRoot: true },
      });

      if (!incident?.currentIncidentStateId) {
        return false;
      }

      const state: IncidentState | null =
        await IncidentStateService.findOneById({
          id: incident.currentIncidentStateId,
          select: { _id: true, isResolvedState: true },
          props: { isRoot: true },
        });

      return state?.isResolvedState === true;
    }

    if (suggestion.alertId) {
      const alert: Alert | null = await AlertService.findOneById({
        id: suggestion.alertId,
        select: { _id: true, currentAlertStateId: true },
        props: { isRoot: true },
      });

      if (!alert?.currentAlertStateId) {
        return false;
      }

      const state: AlertState | null = await AlertStateService.findOneById({
        id: alert.currentAlertStateId,
        select: { _id: true, isResolvedState: true },
        props: { isRoot: true },
      });

      return state?.isResolvedState === true;
    }

    return false;
  }

  /*
   * All of the subject's monitors must be in an operational state.
   * Returns null when there are no monitors to check (manual incidents).
   */
  private static async areSubjectMonitorsOperational(
    suggestion: AutoRemediationSuggestion,
  ): Promise<boolean | null> {
    const monitorIds: Array<ObjectID> = [];

    if (suggestion.incidentId) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: suggestion.incidentId,
        select: { _id: true, monitors: { _id: true } },
        props: { isRoot: true },
      });

      for (const monitor of incident?.monitors || []) {
        if (monitor.id) {
          monitorIds.push(monitor.id);
        }
      }
    } else if (suggestion.alertId) {
      const alert: Alert | null = await AlertService.findOneById({
        id: suggestion.alertId,
        select: { _id: true, monitorId: true },
        props: { isRoot: true },
      });

      if (alert?.monitorId) {
        monitorIds.push(alert.monitorId);
      }
    }

    if (monitorIds.length === 0) {
      return null;
    }

    for (const monitorId of monitorIds) {
      const monitor: Monitor | null = await MonitorService.findOneById({
        id: monitorId,
        select: { _id: true, currentMonitorStatusId: true },
        props: { isRoot: true },
      });

      if (!monitor?.currentMonitorStatusId) {
        return false; // Unknown state counts as not recovered.
      }

      const status: MonitorStatus | null =
        await MonitorStatusService.findOneById({
          id: monitor.currentMonitorStatusId,
          select: { _id: true, isOperationalState: true },
          props: { isRoot: true },
        });

      if (status?.isOperationalState !== true) {
        return false;
      }
    }

    return true;
  }

  /*
   * System auto-resolve on verified recovery: write the resolved
   * state-timeline row directly with no user, exactly like monitor-criteria
   * auto-resolve does. The state-dedupe race (someone resolved concurrently)
   * is treated as a no-op.
   */
  private static async systemResolveSubject(
    suggestion: AutoRemediationSuggestion,
  ): Promise<void> {
    const remediationDescription: string =
      suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan
        ? "the AI command remediation"
        : `runbook "${suggestion.runbookNameSnapshot || "Runbook"}"`;

    const rootCause: string = `Auto-resolved by auto-remediation: ${remediationDescription} (rule "${suggestion.ruleNameSnapshot || "Auto Remediation Rule"}") completed and the monitor(s) recovered within the verification window.`;

    try {
      if (suggestion.incidentId && suggestion.projectId) {
        const resolvedStateId: ObjectID =
          await IncidentStateTimelineService.getResolvedStateIdForProject(
            suggestion.projectId,
          );

        const timeline: IncidentStateTimeline = new IncidentStateTimeline();
        timeline.incidentId = suggestion.incidentId;
        timeline.incidentStateId = resolvedStateId;
        timeline.projectId = suggestion.projectId;
        timeline.rootCause = rootCause;

        await IncidentStateTimelineService.create({
          data: timeline,
          props: { isRoot: true },
        });
      } else if (suggestion.alertId && suggestion.projectId) {
        const resolvedStateId: ObjectID =
          await AlertStateTimelineService.getResolvedStateIdForProject(
            suggestion.projectId,
          );

        const timeline: AlertStateTimeline = new AlertStateTimeline();
        timeline.alertId = suggestion.alertId;
        timeline.alertStateId = resolvedStateId;
        timeline.projectId = suggestion.projectId;
        timeline.rootCause = rootCause;

        await AlertStateTimelineService.create({
          data: timeline,
          props: { isRoot: true },
        });
      }
    } catch (err) {
      if (
        err instanceof BadDataException &&
        (err.message === "Incident state cannot be same as previous state." ||
          err.message === "Alert state cannot be same as previous state.")
      ) {
        // Someone resolved it concurrently — exactly the outcome we wanted.
        logger.debug(
          `RemediationVerifier: subject of suggestion ${suggestion.id?.toString()} already resolved; skipping duplicate resolve.`,
        );
      } else {
        logger.error(
          `RemediationVerifier: failed to auto-resolve subject of suggestion ${suggestion.id?.toString()}: ${err}`,
        );
      }
    }
  }

  private static async postFeedItem(data: {
    suggestion: AutoRemediationSuggestion;
    outcome: VerificationOutcome;
  }): Promise<void> {
    const emoji: string =
      data.outcome.status === AutoRemediationVerificationStatus.Verified
        ? "✅"
        : "⚠️";
    const markdown: string = `${emoji} **Auto-remediation verification:** ${data.outcome.note}`;

    try {
      if (data.suggestion.incidentId && data.suggestion.projectId) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: data.suggestion.incidentId,
          projectId: data.suggestion.projectId,
          incidentFeedEventType: IncidentFeedEventType.AutoRemediation,
          displayColor: data.outcome.displayColor,
          feedInfoInMarkdown: markdown,
          workspaceNotification: {
            sendWorkspaceNotification: data.outcome.pingWorkspace,
          },
        });
      } else if (data.suggestion.alertId && data.suggestion.projectId) {
        await AlertFeedService.createAlertFeedItem({
          alertId: data.suggestion.alertId,
          projectId: data.suggestion.projectId,
          alertFeedEventType: AlertFeedEventType.AutoRemediation,
          displayColor: data.outcome.displayColor,
          feedInfoInMarkdown: markdown,
          workspaceNotification: {
            sendWorkspaceNotification: data.outcome.pingWorkspace,
          },
        });
      }
    } catch (error) {
      logger.error(`RemediationVerifier: failed to create feed item: ${error}`);
    }
  }
}
