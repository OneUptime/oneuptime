import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import UUID from "../../../../Utils/UUID";
import { JSONArray } from "../../../../Types/JSON";
import AIRemediationActionType from "../../../../Types/AI/AIRemediationActionType";
import AIRemediationActionStatus from "../../../../Types/AI/AIRemediationActionStatus";
import AIRemediationDecisionMode from "../../../../Types/AI/AIRemediationDecisionMode";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import { RunbookStep } from "../../../../Types/Runbook/RunbookStep";
import AIRemediationAction from "../../../../Models/DatabaseModels/AIRemediationAction";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import AIRemediationActionService from "../../../Services/AIRemediationActionService";
import RunbookService from "../../../Services/RunbookService";
import RunbookExecutionService from "../../../Services/RunbookExecutionService";
import RunbookRuleEngineService from "../../../Services/RunbookRuleEngineService";
import RemediationStatusSync from "./RemediationStatusSync";
import RemediationPolicy, {
  PER_SUBJECT_EXECUTION_CAP,
  RemediationBudgetDecision,
} from "./RemediationPolicy";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — the remediation executor.
 *
 * THE single path from "this action may run" to "a RunbookExecution is in
 * flight". Both entry points — a human clicking Approve and the proposer's
 * unattended auto-execution — funnel into one private execute path, so the
 * safety checks can never diverge between them:
 *
 *   1. Lane re-check (RemediationPolicy.isLaneEnabledForProject): the flags
 *      may have been switched off between proposal and decision.
 *   2. Expiry: a stale proposal is worse than none — expired rows are CAS'd
 *      to Expired and refused, never executed.
 *   3. CAS Proposed→Approved (AIRemediationActionService's conditional
 *      UPDATE): under concurrency exactly one caller wins; the loser is
 *      refused and does NOTHING — double execution is structurally
 *      impossible. The human path stamps approvedByUserId; the auto path
 *      only approvedAt (nobody approved it — the policy gate did).
 *   4. Budgets AFTER Approved: the daily execution cap and the per-subject
 *      cap. A refusal REVERTS the action to Proposed with errorMessage set,
 *      so the timeline shows exactly why nothing ran and the Approve button
 *      simply works again once the budget clears — no stranded state. (The
 *      budget checks are check-then-act by design: concurrent approvals of
 *      DIFFERENT actions can overshoot the daily cap by at most one each,
 *      bounded and accepted; same-action double-execution is impossible via
 *      the CAS, and the proposer auto-executes sequentially.)
 *   5. CAS Approved→Executing with executedAt (the timestamp the daily
 *      budget counts), then dispatch onto the audited runbook substrate —
 *      never a bespoke execution channel. Command actions are materialized
 *      as a single-step AI-authored runbook (Runbook.isCreatedByAi) first,
 *      carrying EXACTLY the script the approver saw.
 *
 * Every execution is attributed: triggeredByAiRemediationActionId on the
 * RunbookExecution, and the action row itself carries aiRunId back to the
 * investigation's glass-box event trail.
 */

// The one Bash step of a materialized Command runbook gets this timeout.
const COMMAND_STEP_TIMEOUT_MS: number = 120000;

// Runbook.name is ShortText (100 chars) — the materialized name must fit.
const MAX_RUNBOOK_NAME_CHARS: number = 100;

// Runbook.description is LongText (500 chars).
const MAX_RUNBOOK_DESCRIPTION_CHARS: number = 500;

export interface RemediationExecutionResult {
  ok: boolean;
  // Human-readable reason when ok is false — safe to surface to the user.
  refusalReason?: string | undefined;
}

export default class RemediationExecutor {
  /*
   * Human path: the approve endpoint. Never throws — unexpected failures
   * come back as a refusal so the API can surface them without a 500
   * masking what already happened to the action row.
   */
  @CaptureSpan()
  public static async approveAndExecute(data: {
    actionId: ObjectID;
    byUserId: ObjectID;
  }): Promise<RemediationExecutionResult> {
    try {
      return await this.execute({
        actionId: data.actionId,
        byUserId: data.byUserId,
        isAutoExecution: false,
      });
    } catch (error) {
      logger.error(
        `AI remediation: unexpected error executing action ${data.actionId.toString()}: ${error}`,
      );
      return {
        ok: false,
        refusalReason:
          "An unexpected error occurred while executing this action. Check its status — it may need attention.",
      };
    }
  }

  /*
   * Unattended path: fired (fire-and-forget) by the proposer for actions
   * the policy gate decided AutoApproved. Swallows and logs everything —
   * it runs inside the investigation's postAnalysis chain and must never
   * fail it.
   */
  @CaptureSpan()
  public static async autoExecute(data: { actionId: ObjectID }): Promise<void> {
    try {
      const result: RemediationExecutionResult = await this.execute({
        actionId: data.actionId,
        isAutoExecution: true,
      });

      if (!result.ok) {
        logger.debug(
          `AI remediation: auto-execution of action ${data.actionId.toString()} refused — ${result.refusalReason}`,
        );
      }
    } catch (error) {
      logger.error(
        `AI remediation: auto-execution of action ${data.actionId.toString()} failed: ${error}`,
      );
    }
  }

  /*
   * The single execute path. Every refusal returns a human-readable reason;
   * a lost CAS returns a refusal and does NOTHING else, because the winner
   * (a concurrent approve, the expiry sweeper) already owns the action's
   * side effects.
   */
  private static async execute(data: {
    actionId: ObjectID;
    byUserId?: ObjectID | undefined;
    isAutoExecution: boolean;
  }): Promise<RemediationExecutionResult> {
    const action: AIRemediationAction | null =
      await AIRemediationActionService.findOneById({
        id: data.actionId,
        select: {
          _id: true,
          projectId: true,
          incidentId: true,
          alertId: true,
          actionType: true,
          title: true,
          rationale: true,
          runbookId: true,
          runbookAgentId: true,
          commandScript: true,
          status: true,
          decisionMode: true,
          expiresAt: true,
        },
        props: { isRoot: true },
      });

    if (!action || !action.projectId) {
      return { ok: false, refusalReason: "Remediation action not found." };
    }

    /*
     * Invariant hardening: the unattended path may only run actions the
     * policy gate cleared at proposal time. A RequireApproval action reaching
     * autoExecute is a bug upstream — refuse, never "helpfully" run it.
     */
    if (
      data.isAutoExecution &&
      action.decisionMode !== AIRemediationDecisionMode.AutoApproved
    ) {
      return {
        ok: false,
        refusalReason:
          "This action requires explicit human approval and can never auto-execute.",
      };
    }

    // Re-check the lane: flags may have flipped since the proposal.
    if (!(await RemediationPolicy.isLaneEnabledForProject(action.projectId))) {
      return {
        ok: false,
        refusalReason:
          "AI remediation is not enabled for this project. Enable it on the Incidents or Alerts AI settings page first.",
      };
    }

    // Expired proposals are swept aside, never executed.
    if (
      action.expiresAt &&
      OneUptimeDate.isBefore(action.expiresAt, OneUptimeDate.getCurrentDate())
    ) {
      await AIRemediationActionService.attemptStatusTransition({
        actionId: data.actionId,
        fromStatus: AIRemediationActionStatus.Proposed,
        set: { status: AIRemediationActionStatus.Expired },
      });

      return {
        ok: false,
        refusalReason:
          "This proposal has expired — remediation drafted for an old incident state should not run. Ask AI to investigate again if the problem persists.",
      };
    }

    /*
     * CAS Proposed→Approved. The human path records who approved; the auto
     * path stamps only approvedAt — the audit trail must never claim a
     * person approved something the policy gate cleared.
     */
    const approvedCount: number =
      await AIRemediationActionService.attemptStatusTransition({
        actionId: data.actionId,
        fromStatus: AIRemediationActionStatus.Proposed,
        set: {
          status: AIRemediationActionStatus.Approved,
          approvedAt: OneUptimeDate.getCurrentDate(),
          ...(data.byUserId && !data.isAutoExecution
            ? { approvedByUserId: data.byUserId.toString() }
            : {}),
        },
      });

    if (approvedCount === 0) {
      return {
        ok: false,
        refusalReason:
          "This action is no longer pending — it was already approved, rejected, or expired by someone else.",
      };
    }

    /*
     * Budgets AFTER Approved: a refusal REVERTS the action to Proposed with
     * the reason on errorMessage — never a stranded Approved dead end. The
     * Approve button works again once the budget clears (the promise the
     * refusal message makes), the 24h expiry sweep still applies, and the
     * approver stamp is cleared because the approval did not result in an
     * execution. Reverting is CAS'd too: losing it means someone else moved
     * the row (e.g. the expiry sweeper), which is fine — the winner owns it.
     */
    const budget: RemediationBudgetDecision =
      await RemediationPolicy.getDailyExecutionBudget(action.projectId);

    if (!budget.allowed) {
      const reason: string =
        RemediationPolicy.describeDailyBudgetRejection(budget);

      await this.revertToProposed(data.actionId, reason);

      return { ok: false, refusalReason: reason };
    }

    const subjectExecutions: number =
      await RemediationPolicy.getSubjectExecutionCount({
        projectId: action.projectId,
        incidentId: action.incidentId,
        alertId: action.alertId,
      });

    if (subjectExecutions >= PER_SUBJECT_EXECUTION_CAP) {
      const reason: string = RemediationPolicy.describeSubjectCapRejection();

      await this.revertToProposed(data.actionId, reason);

      return { ok: false, refusalReason: reason };
    }

    /*
     * CAS Approved→Executing with executedAt — the instant the daily budget
     * counts. Losing THIS transition means another executor thread beat us
     * between the checks; do nothing.
     */
    const executingCount: number =
      await AIRemediationActionService.attemptStatusTransition({
        actionId: data.actionId,
        fromStatus: AIRemediationActionStatus.Approved,
        set: {
          status: AIRemediationActionStatus.Executing,
          executedAt: OneUptimeDate.getCurrentDate(),
        },
      });

    if (executingCount === 0) {
      return {
        ok: false,
        refusalReason:
          "This action is already being executed by another request.",
      };
    }

    // Dispatch. From here on, any failure marks the action Failed.
    try {
      return await this.dispatch({
        actionId: data.actionId,
        action,
        byUserId: data.byUserId,
      });
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      /*
       * The failure may have landed AFTER the runbook actually started
       * (e.g. the linkage write threw). The execution is attributed via
       * triggeredByAiRemediationActionId, so look for it before declaring
       * failure — an execution that is really running must be adopted, not
       * mislabeled as failed.
       */
      const adopted: boolean = await this.tryAdoptOrphanExecution(
        data.actionId,
      );

      if (adopted) {
        return { ok: true };
      }

      await this.markFailed(
        data.actionId,
        action,
        `Dispatch failed: ${message}`,
      );

      return {
        ok: false,
        refusalReason: `Execution could not be dispatched: ${message}`,
      };
    }
  }

  /*
   * Budget/cap refusal path: CAS Approved→Proposed, clearing the approver
   * stamp (the approval produced no execution) and recording the refusal on
   * errorMessage so the panel shows why nothing ran.
   */
  private static async revertToProposed(
    actionId: ObjectID,
    reason: string,
  ): Promise<void> {
    await AIRemediationActionService.attemptStatusTransition({
      actionId,
      fromStatus: AIRemediationActionStatus.Approved,
      set: {
        status: AIRemediationActionStatus.Proposed,
        approvedAt: null,
        approvedByUserId: null,
        errorMessage: reason,
      },
    });
  }

  /*
   * Find a RunbookExecution attributed to this action (the dispatcher may
   * have crashed between starting it and storing the linkage) and re-attach
   * it. Returns true when an execution was found and adopted — the action
   * stays Executing and the status sweeper finalizes it normally.
   */
  private static async tryAdoptOrphanExecution(
    actionId: ObjectID,
  ): Promise<boolean> {
    try {
      const execution: RunbookExecution | null =
        await RunbookExecutionService.findOneBy({
          query: { triggeredByAiRemediationActionId: actionId },
          select: { _id: true, runbookId: true },
          props: { isRoot: true },
        });

      if (!execution || !execution._id) {
        return false;
      }

      await AIRemediationActionService.updateOneById({
        id: actionId,
        data: {
          runbookExecutionId: new ObjectID(execution._id),
          ...(execution.runbookId ? { runbookId: execution.runbookId } : {}),
        },
        props: { isRoot: true },
      });

      logger.warn(
        `AI remediation: adopted orphan execution ${execution._id.toString()} for action ${actionId.toString()} after a dispatch-path error.`,
      );

      return true;
    } catch (error) {
      logger.error(
        `AI remediation: orphan-execution adoption failed for action ${actionId.toString()}: ${error}`,
      );
      return false;
    }
  }

  /*
   * Start the runbook substrate for an action that already holds Executing.
   * Runbook actions start the referenced (human-authored) runbook; Command
   * actions first materialize a single-step AI-authored runbook carrying
   * exactly the approved script.
   */
  private static async dispatch(data: {
    actionId: ObjectID;
    action: AIRemediationAction;
    byUserId?: ObjectID | undefined;
  }): Promise<RemediationExecutionResult> {
    const { action } = data;

    let runbookId: ObjectID | undefined = action.runbookId;
    let materializedRunbookId: ObjectID | undefined = undefined;

    if (action.actionType === AIRemediationActionType.Command) {
      if (!action.commandScript || !action.runbookAgentId) {
        await this.markFailed(
          data.actionId,
          action,
          "Command action is missing its script or target agent.",
        );
        return {
          ok: false,
          refusalReason:
            "This command action is missing its script or target agent and cannot execute.",
        };
      }

      materializedRunbookId = await this.materializeCommandRunbook({
        actionId: data.actionId,
        action,
      });
      runbookId = materializedRunbookId;
    }

    if (!runbookId) {
      await this.markFailed(
        data.actionId,
        action,
        "Runbook action has no runbook to start.",
      );
      return {
        ok: false,
        refusalReason: "This action has no runbook to start.",
      };
    }

    const execution: RunbookExecution | null =
      await RunbookRuleEngineService.startRunbookFor({
        projectId: action.projectId!,
        runbookId,
        linkage: {
          ...(action.incidentId ? { incidentId: action.incidentId } : {}),
          ...(action.alertId ? { alertId: action.alertId } : {}),
        },
        // Attribution: the approver when known, and always the action id.
        ...(data.byUserId ? { triggeredByUserId: data.byUserId } : {}),
        triggeredByAiRemediationActionId: data.actionId,
      });

    if (!execution || !execution._id) {
      await this.markFailed(
        data.actionId,
        action,
        "Runbook could not be started — it may be disabled, deleted, or have no steps.",
      );
      return {
        ok: false,
        refusalReason:
          "The runbook could not be started — it may be disabled, deleted, or have no steps.",
      };
    }

    /*
     * Store the linkage on the action row: the execution (where step-by-step
     * outputs live) and, for Command actions, the materialized runbook.
     */
    await AIRemediationActionService.updateOneById({
      id: data.actionId,
      data: {
        runbookExecutionId: new ObjectID(execution._id),
        ...(materializedRunbookId ? { runbookId: materializedRunbookId } : {}),
      },
      props: { isRoot: true },
    });

    return { ok: true };
  }

  /*
   * Materialize an approved Command as a single-step AI-authored runbook so
   * the execution rides the exact same audited substrate (agent claim,
   * heartbeats, per-step outputs) as every human-authored runbook. The
   * isCreatedByAi column has an empty create ACL — server-authored only —
   * so it is set on the model object and created with isRoot.
   */
  private static async materializeCommandRunbook(data: {
    actionId: ObjectID;
    action: AIRemediationAction;
  }): Promise<ObjectID> {
    const { action } = data;

    const step: RunbookStep = {
      id: UUID.generate(),
      order: 1,
      type: RunbookStepType.Bash,
      title: action.title || "AI remediation command",
      config: {
        script: action.commandScript!,
        agentId: action.runbookAgentId!.toString(),
        timeoutInMs: COMMAND_STEP_TIMEOUT_MS,
      },
    };

    const provenance: string = `Materialized from AIRemediationAction ${data.actionId.toString()}.`;
    const description: string = `${provenance} ${action.rationale || ""}`
      .trim()
      .substring(0, MAX_RUNBOOK_DESCRIPTION_CHARS);

    /*
     * Runbook names are unique per project, and the same remediation title
     * can legitimately recur (a second incident, a re-proposed fix) — so the
     * name carries a short action-id suffix, sized so truncation of a long
     * title can never eat it.
     */
    const nameSuffix: string = ` (${data.actionId.toString().substring(0, 8)})`;

    const runbook: Runbook = new Runbook();
    runbook.projectId = action.projectId!;
    runbook.name =
      `AI remediation: ${action.title || "command"}`.substring(
        0,
        MAX_RUNBOOK_NAME_CHARS - nameSuffix.length,
      ) + nameSuffix;
    runbook.description = description;
    runbook.isEnabled = true;
    runbook.isCreatedByAi = true;
    runbook.steps = [step] as unknown as JSONArray;

    const created: Runbook = await RunbookService.create({
      data: runbook,
      props: { isRoot: true },
    });

    return new ObjectID(created._id!);
  }

  /*
   * CAS Executing→Failed with the reason, and — when this caller won the
   * transition — post the failure to the subject's timeline. "Outcomes are
   * never quiet": a dispatch-stage failure on the unattended path would
   * otherwise be invisible outside logs. Losing the CAS is fine (the
   * sweeper won and owns the announcement).
   */
  private static async markFailed(
    actionId: ObjectID,
    action: AIRemediationAction,
    errorMessage: string,
  ): Promise<void> {
    const won: number =
      await AIRemediationActionService.attemptStatusTransition({
        actionId,
        fromStatus: AIRemediationActionStatus.Executing,
        set: {
          status: AIRemediationActionStatus.Failed,
          errorMessage,
        },
      });

    if (won > 0) {
      await RemediationStatusSync.postOutcomeFeedItem({
        action,
        succeeded: false,
        detail: errorMessage,
      });
    }
  }
}
