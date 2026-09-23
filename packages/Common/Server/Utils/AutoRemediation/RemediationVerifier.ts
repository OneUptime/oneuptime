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
  AiRemediationRollbackStatus,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Text from "../../../Types/Text";
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
import CommandPlanExecutor, {
  CommandPlanRollbackOutcome,
} from "./CommandPlanExecutor";
import AutoRemediationRuleEngineService from "../../Services/AutoRemediationRuleEngineService";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { FindOperator, Raw } from "typeorm";

/*
 * A rollback refreshes its heartbeat before every step, and no single step
 * (a claim wait plus the longest command timeout) takes this long — so a
 * heartbeat older than this means the rollback is no longer running.
 */
const ROLLBACK_HEARTBEAT_STALE_MINUTES: number = 10;

// How far back the recovery sweep looks for an interrupted rollback.
const ROLLBACK_RESUME_LOOKBACK_HOURS: number = 24;

const ROLLBACK_RESUME_LOCK_NAMESPACE: string = "AutoRemediationRollbackResume";

// How many interrupted-rollback candidates one sweep reads.
const ROLLBACK_RESUME_BATCH_SIZE: number = 50;

/*
 * The resume sweep's candidates are only plans whose rollback has NOT
 * settled: commandPlan->>'rollbackStatus' absent, null or NotAttempted.
 * Filtering settled rollbacks in the query — not after it — is what keeps
 * the batch for rows that may still need resuming: every failed command
 * plan stays a Failed verification for the whole lookback window, and
 * without this a day's worth of settled ones would fill every batch ahead
 * of an interrupted rollback. Key and value go in as parameters.
 */
function rollbackNotSettled(): FindOperator<unknown> {
  const keyParameter: string = `rollbackKey_${Text.generateRandomText(10)}`;
  const valueParameter: string = `rollbackOpen_${Text.generateRandomText(10)}`;

  return Raw(
    (alias: string): string => {
      return `((${alias} ->> CAST(:${keyParameter} AS text)) IS NULL OR (${alias} ->> CAST(:${keyParameter} AS text)) = CAST(:${valueParameter} AS text))`;
    },
    {
      [keyParameter]: "rollbackStatus",
      [valueParameter]: AiRemediationRollbackStatus.NotAttempted,
    },
  );
}

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
 * A failed command plan is rolled back, and a cluster round may get a
 * follow-up round — only once the rollback has settled, and asking first
 * when it did not complete. The same sweep resumes a rollback that a
 * Worker restart cut short.
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
          kubernetesClusterId: true,
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
          await this.rollBackAndFollowUp({
            suggestion,
            verificationNote: outcome.note,
          });
        }
      } catch (error) {
        logger.error(
          `RemediationVerifier: failed to verify suggestion ${suggestion.id?.toString()}: ${error}`,
        );
      }
    }

    /*
     * Rollbacks a Worker restart cut short. Never lets the sweep fail — the
     * verifications above have already been settled either way.
     */
    try {
      await this.resumeInterruptedRollbacks();
    } catch (error) {
      logger.error(
        `RemediationVerifier: failed to resume interrupted rollbacks: ${error}`,
      );
    }
  }

  /*
   * Roll a failed command plan back, record what the rollback actually did
   * on the verification note, and only THEN decide on the follow-up round.
   *
   * A cluster whose AI page enabled remediation gets another try: after the
   * rollback, OneUptime AI composes a NEW plan unless the round cap is
   * spent. The follow-up round is Suggest (a human approves it) — except on
   * a BypassApproval cluster, where it runs unattended again (see
   * startFollowUpClusterRemediation). But it may only start from a known
   * baseline:
   *   - rollback completed, or nothing to roll back: as above;
   *   - rollback settled Failed (a rollback failed, or was left for a human
   *     to undo by hand): the follow-up asks first even on a Bypass cluster
   *     — round 1's change may still be applied, and an unattended round on
   *     top of a state humans were just told to fix by hand is exactly the
   *     wrong move;
   *   - rollback did not settle at all: no follow-up now. The recovery
   *     sweep resumes the rollback and starts the follow-up once it has.
   * Never blocks verification — a failure here only means no retry.
   */
  private static async rollBackAndFollowUp(data: {
    suggestion: AutoRemediationSuggestion;
    verificationNote?: string | undefined;
  }): Promise<void> {
    const { suggestion } = data;

    const rollback: CommandPlanRollbackOutcome | undefined =
      await CommandPlanExecutor.executeRollback({ suggestion });

    if (!rollback) {
      return;
    }

    /*
     * The note was written before the rollback ran; it now says what the
     * rollback did, so the card — and the next round's context — never
     * read a rollback that did not happen as one that did.
     */
    if (suggestion.id && rollback.rollbackStatus) {
      try {
        await AutoRemediationSuggestionService.updateOneById({
          id: suggestion.id,
          data: {
            verificationNote: [data.verificationNote, rollback.summary]
              .filter((part: string | undefined) => {
                return Boolean(part);
              })
              .join(" "),
          } as never,
          props: { isRoot: true },
        });
      } catch (error) {
        logger.error(
          `RemediationVerifier: could not record the rollback outcome on suggestion ${suggestion.id.toString()}: ${error}`,
        );
      }
    }

    if (!suggestion.kubernetesClusterId || !suggestion.projectId) {
      return;
    }

    if (!rollback.rollbackStatus) {
      logger.warn(
        `RemediationVerifier: the rollback of suggestion ${suggestion.id?.toString()} did not settle; the follow-up round waits for it to be resumed.`,
      );
      return;
    }

    const rollbackIncomplete: boolean =
      rollback.rollbackStatus === AiRemediationRollbackStatus.Failed;

    await AutoRemediationRuleEngineService.startFollowUpClusterRemediation({
      projectId: suggestion.projectId,
      kubernetesClusterId: suggestion.kubernetesClusterId,
      incidentId: suggestion.incidentId,
      alertId: suggestion.alertId,
      forceSuggest: rollbackIncomplete ? true : undefined,
      forceSuggestReason: rollbackIncomplete
        ? "the previous fix's rollback did not complete, so its change may still be applied"
        : undefined,
    });
  }

  /*
   * Resume rollbacks a Worker restart interrupted. The verifier rolls a
   * failed plan back inline, right after winning the verification
   * transition; a pod that dies mid-rollback leaves verification Failed
   * with the plan's rollbackStatus unset, and nothing else ever looks at a
   * Failed verification again. So: a Failed CommandPlan verification of the
   * last day whose rollback never settled, and whose rollback heartbeat
   * (or, before the first beat, verification time) is older than any single
   * rollback step can take, was interrupted. It is claimed under a lock —
   * re-checked there, and re-stamped before the lock is released, so a
   * second replica sees a live heartbeat and leaves it alone — then
   * resumed: executeRollback settles undos already handed to a Runner from
   * their jobs, runs the rest, and the follow-up round follows as usual.
   * Without the lock, nothing is resumed this tick: two replicas rolling
   * back one plan could run an undo twice.
   *
   * The read only returns rollbacks that have not settled, oldest
   * verification first, so neither settled plans nor newer failures can
   * keep an interrupted rollback out of the batch until it ages out of the
   * window. The in-memory check still decides (a heartbeat can be fresh).
   */
  @CaptureSpan()
  public static async resumeInterruptedRollbacks(): Promise<void> {
    const now: number = OneUptimeDate.getCurrentDate().getTime();

    const candidates: Array<AutoRemediationSuggestion> =
      await AutoRemediationSuggestionService.findBy({
        query: {
          suggestionType: AutoRemediationSuggestionType.CommandPlan,
          verificationStatus: AutoRemediationVerificationStatus.Failed,
          status: QueryHelper.any([
            AutoRemediationSuggestionStatus.Approved,
            AutoRemediationSuggestionStatus.AutoExecuted,
          ]),
          verificationCompletedAt: QueryHelper.inBetween(
            OneUptimeDate.getSomeHoursAgo(ROLLBACK_RESUME_LOOKBACK_HOURS),
            OneUptimeDate.getSomeMinutesAgo(ROLLBACK_HEARTBEAT_STALE_MINUTES),
          ),
          commandPlan: rollbackNotSettled() as never,
        },
        select: {
          _id: true,
          projectId: true,
          incidentId: true,
          alertId: true,
          suggestionType: true,
          commandPlan: true,
          aiRunId: true,
          verificationStatus: true,
          verificationCompletedAt: true,
          verificationNote: true,
          ruleNameSnapshot: true,
          kubernetesClusterId: true,
        },
        sort: { verificationCompletedAt: SortOrder.Ascending },
        limit: ROLLBACK_RESUME_BATCH_SIZE,
        skip: 0,
        props: { isRoot: true },
      });

    for (const candidate of candidates) {
      try {
        if (
          candidate.verificationStatus !==
            AutoRemediationVerificationStatus.Failed ||
          !this.isInterruptedRollback(candidate, now)
        ) {
          continue;
        }

        const claimed: AutoRemediationSuggestion | null =
          await this.claimInterruptedRollback(candidate);

        if (!claimed) {
          continue;
        }

        logger.warn(
          `RemediationVerifier: resuming the interrupted rollback of suggestion ${claimed.id?.toString()}.`,
        );

        await this.rollBackAndFollowUp({
          suggestion: claimed,
          verificationNote: claimed.verificationNote,
        });
      } catch (error) {
        logger.error(
          `RemediationVerifier: failed to resume the rollback of suggestion ${candidate.id?.toString()}: ${error}`,
        );
      }
    }
  }

  // A Failed verification whose rollback never settled and went quiet.
  private static isInterruptedRollback(
    suggestion: AutoRemediationSuggestion,
    now: number,
  ): boolean {
    const plan: AiRemediationCommandPlan | null =
      AiRemediationCommandPlanUtil.parse(suggestion.commandPlan);

    if (!plan) {
      return false;
    }

    if (
      plan.rollbackStatus &&
      plan.rollbackStatus !== AiRemediationRollbackStatus.NotAttempted
    ) {
      return false;
    }

    const lastSignOfLife: number | null = plan.rollbackHeartbeatAt
      ? new Date(plan.rollbackHeartbeatAt).getTime()
      : suggestion.verificationCompletedAt
        ? new Date(suggestion.verificationCompletedAt).getTime()
        : null;

    if (lastSignOfLife === null || Number.isNaN(lastSignOfLife)) {
      return false;
    }

    return lastSignOfLife < now - ROLLBACK_HEARTBEAT_STALE_MINUTES * 60 * 1000;
  }

  /*
   * Claim an interrupted rollback for this replica: under a lock, re-read
   * the plan, re-check that it is still interrupted, and stamp a fresh
   * heartbeat before letting go. Null when another replica got there
   * first, or the lock cannot be had.
   */
  private static async claimInterruptedRollback(
    candidate: AutoRemediationSuggestion,
  ): Promise<AutoRemediationSuggestion | null> {
    let mutex: SemaphoreMutex;

    try {
      mutex = await Semaphore.lock({
        key: candidate.id!.toString(),
        namespace: ROLLBACK_RESUME_LOCK_NAMESPACE,
        lockTimeout: 30_000,
        acquireTimeout: 5_000,
      });
    } catch (error) {
      logger.warn(
        `RemediationVerifier: could not take the rollback-resume lock of suggestion ${candidate.id?.toString()}; not resuming it this tick: ${error}`,
      );
      return null;
    }

    try {
      const current: AutoRemediationSuggestion | null =
        await AutoRemediationSuggestionService.findOneById({
          id: candidate.id!,
          select: {
            _id: true,
            projectId: true,
            incidentId: true,
            alertId: true,
            suggestionType: true,
            commandPlan: true,
            aiRunId: true,
            verificationStatus: true,
            verificationCompletedAt: true,
            verificationNote: true,
            ruleNameSnapshot: true,
            kubernetesClusterId: true,
          },
          props: { isRoot: true },
        });

      if (
        !current ||
        current.verificationStatus !==
          AutoRemediationVerificationStatus.Failed ||
        !this.isInterruptedRollback(
          current,
          OneUptimeDate.getCurrentDate().getTime(),
        )
      ) {
        return null;
      }

      const plan: AiRemediationCommandPlan | null =
        AiRemediationCommandPlanUtil.parse(current.commandPlan);

      if (!plan) {
        return null;
      }

      plan.rollbackHeartbeatAt = OneUptimeDate.getCurrentDate().toISOString();

      await AutoRemediationSuggestionService.updateOneById({
        id: current.id!,
        data: {
          commandPlan: AiRemediationCommandPlanUtil.toJSON(plan),
        } as never,
        props: { isRoot: true },
      });

      current.commandPlan = AiRemediationCommandPlanUtil.toJSON(plan);

      return current;
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (error) {
        logger.error(
          `RemediationVerifier: failed to release the rollback-resume lock: ${error}`,
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

    /*
     * The notes below are written BEFORE the rollback runs, so they never
     * claim anything about it: what the rollback actually did is appended
     * once it has settled (rollBackAndFollowUp).
     */
    if (plan.executionStatus === AiRemediationPlanExecutionStatus.Failed) {
      return {
        status: AutoRemediationVerificationStatus.Failed,
        note: "The AI command plan did not complete — a command failed.",
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
        note: "The AI command remediation completed but the service did not recover within the verification window — escalation continues as normal.",
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
