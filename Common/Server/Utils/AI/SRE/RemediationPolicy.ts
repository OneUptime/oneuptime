import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import AIRemediationActionType from "../../../../Types/AI/AIRemediationActionType";
import AIRemediationActionStatus from "../../../../Types/AI/AIRemediationActionStatus";
import AIRemediationDecisionMode from "../../../../Types/AI/AIRemediationDecisionMode";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import { RunbookAgentEnvironmentTypeHelper } from "../../../../Types/Runbook/RunbookAgentEnvironmentType";
import {
  BashStepConfig,
  JavaScriptStepConfig,
  RunbookStep,
} from "../../../../Types/Runbook/RunbookStep";
import Project from "../../../../Models/DatabaseModels/Project";
import ProjectService from "../../../Services/ProjectService";
import AIRemediationActionService from "../../../Services/AIRemediationActionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — the remediation policy gate.
 *
 * THE single place that decides what an AI-proposed remediation action may
 * do: whether the lane is enabled at all, whether a specific action may
 * execute unattended or must wait for a human, and whether execution budgets
 * still allow it to run. Every path — the proposer's auto-execution, the
 * approve endpoint, the executor — routes through this module so the rules
 * below hold everywhere at once, not per-callsite (the C1 lesson from the
 * scattered-flag audit; this is the G1 policy-gateway seed for the
 * environment-execution lane).
 *
 * The rules, in the fail-safe direction:
 *   1. Nothing happens unless Project.enableAiRemediation is true AND the
 *      master switch Project.enableAi is not false. Both default off/safe.
 *   2. Command actions (free-form scripts AI drafted) ALWAYS require human
 *      approval. No flag relaxes this, in any environment, deliberately:
 *      a drafted command has never been reviewed by anyone.
 *   3. Runbook actions may auto-execute ONLY when the project additionally
 *      opted into enableAiAutoRemediationOnNonProduction AND every step of
 *      that runbook is provably non-production: agent-bound steps (Bash /
 *      JavaScript) must target agents explicitly tagged Staging, Testing or
 *      Development — an untagged or unknown agent counts as Production —
 *      and HttpRequest steps disqualify auto-execution outright, because a
 *      URL has no environment tag to check. Manual and AI steps are neutral
 *      (a Manual step parks the execution for a human anyway; an AI step
 *      only produces text).
 *   4. Executions are budgeted: a per-UTC-day cap (default 10 — unset is
 *      NOT unlimited, unlike token budgets, because these actions run on
 *      customer infrastructure; 0 pauses the lane) and a per-subject cap so
 *      one incident can never eat the whole day's budget.
 */

// Executions allowed per project per UTC day when no explicit limit is set.
export const DEFAULT_DAILY_REMEDIATION_EXECUTION_LIMIT: number = 10;

// Max actions ever executed for one incident/alert subject.
export const PER_SUBJECT_EXECUTION_CAP: number = 3;

// Max actions one investigation may propose.
export const MAX_ACTIONS_PER_RUN: number = 3;

// Proposals not decided within this window are swept to Expired.
export const PROPOSAL_TTL_HOURS: number = 24;

// Hard cap on a drafted command script, in characters.
export const MAX_COMMAND_SCRIPT_CHARS: number = 2000;

// Title cap — the column is ShortText (100); keep headroom.
export const MAX_TITLE_CHARS: number = 90;

// Rationale cap keeps rows and feed items skimmable.
export const MAX_RATIONALE_CHARS: number = 1500;

// Statuses that mean "this action spent (or is spending) an execution".
const EXECUTED_STATUSES: Array<AIRemediationActionStatus> = [
  AIRemediationActionStatus.Executing,
  AIRemediationActionStatus.Succeeded,
  AIRemediationActionStatus.Failed,
];

export interface RemediationBudgetDecision {
  allowed: boolean;
  // The effective limit after defaulting (<= 0 means paused).
  limit: number;
  // True when the configured limit pauses execution outright (0 or less).
  paused: boolean;
  // Executions dispatched since UTC midnight.
  executionsToday: number;
}

/*
 * The autonomy-relevant shape of a runbook's steps: which agents its
 * agent-bound steps target, and whether any step is an HTTP request (which
 * has no environment to verify and therefore disqualifies auto-execution).
 */
export interface RunbookAutonomyProfile {
  agentIds: Array<string>;
  hasHttpSteps: boolean;
}

export default class RemediationPolicy {
  /*
   * Lane gate: the master AI switch (=== false — the column defaults true)
   * and the remediation opt-in (=== true — defaults false). Checked before
   * proposing, before approving, and before executing.
   */
  @CaptureSpan()
  public static async isLaneEnabledForProject(
    projectId: ObjectID,
  ): Promise<boolean> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        enableAi: true,
        enableAiRemediation: true,
      },
      props: { isRoot: true },
    });

    if (!project) {
      return false;
    }

    if (project.enableAi === false) {
      return false;
    }

    return project.enableAiRemediation === true;
  }

  /*
   * Pure step classification (exported for tests): collect the agent ids of
   * every agent-bound step and flag HTTP steps. Unknown step types count as
   * HTTP-like disqualifiers — a step we cannot classify must not auto-run.
   */
  public static getRunbookAutonomyProfile(
    steps: Array<RunbookStep>,
  ): RunbookAutonomyProfile {
    const agentIds: Array<string> = [];
    let hasHttpSteps: boolean = false;

    for (const step of steps) {
      switch (step.type) {
        case RunbookStepType.Bash:
        case RunbookStepType.JavaScript: {
          const config: BashStepConfig | JavaScriptStepConfig = step.config as
            | BashStepConfig
            | JavaScriptStepConfig;
          agentIds.push(config?.agentId || "");
          break;
        }
        case RunbookStepType.HttpRequest:
          hasHttpSteps = true;
          break;
        case RunbookStepType.Manual:
        case RunbookStepType.AI:
          // Neutral: Manual parks for a human; AI only produces text.
          break;
        default:
          // A step type this policy does not know cannot auto-run.
          hasHttpSteps = true;
          break;
      }
    }

    return { agentIds, hasHttpSteps };
  }

  /*
   * The pure decision (exported for tests): RequireApproval unless every
   * rule for unattended execution holds. `agentEnvironmentTypes` carries the
   * environment tag of every agent referenced by the runbook's agent-bound
   * steps — a missing agent must be passed as undefined so it fails safe.
   */
  public static decideDecisionMode(data: {
    actionType: AIRemediationActionType;
    autoRemediationOnNonProductionEnabled: boolean;
    runbookProfile?: RunbookAutonomyProfile | undefined;
    agentEnvironmentTypes?: Array<string | undefined> | undefined;
  }): AIRemediationDecisionMode {
    if (data.actionType === AIRemediationActionType.Command) {
      // Rule 2: drafted commands always need a human. No exceptions.
      return AIRemediationDecisionMode.RequireApproval;
    }

    if (!data.autoRemediationOnNonProductionEnabled) {
      return AIRemediationDecisionMode.RequireApproval;
    }

    if (!data.runbookProfile || data.runbookProfile.hasHttpSteps) {
      return AIRemediationDecisionMode.RequireApproval;
    }

    const environments: Array<string | undefined> =
      data.agentEnvironmentTypes || [];

    /*
     * Every agent-bound step must have resolved to a known agent — a
     * dangling agentId means we cannot verify where it runs.
     */
    if (environments.length !== data.runbookProfile.agentIds.length) {
      return AIRemediationDecisionMode.RequireApproval;
    }

    for (const environmentType of environments) {
      if (RunbookAgentEnvironmentTypeHelper.isProduction(environmentType)) {
        return AIRemediationDecisionMode.RequireApproval;
      }
    }

    return AIRemediationDecisionMode.AutoApproved;
  }

  /*
   * The pure daily-budget decision (exported for tests). Null/undefined
   * means "use the default cap" — never unlimited. 0 (or negative) pauses
   * AI remediation execution entirely.
   */
  public static evaluateDailyBudget(data: {
    configuredLimit: number | null | undefined;
    executionsToday: number;
  }): RemediationBudgetDecision {
    const limit: number =
      data.configuredLimit === null || data.configuredLimit === undefined
        ? DEFAULT_DAILY_REMEDIATION_EXECUTION_LIMIT
        : data.configuredLimit;

    if (limit <= 0) {
      return {
        allowed: false,
        limit,
        paused: true,
        executionsToday: data.executionsToday,
      };
    }

    return {
      allowed: data.executionsToday < limit,
      limit,
      paused: false,
      executionsToday: data.executionsToday,
    };
  }

  /*
   * Read the project's limit and count executions dispatched since UTC
   * midnight — by executedAt, not createdAt: proposals are free, running
   * things on customer infrastructure is what the budget bounds. Every
   * execution counts regardless of how it ended.
   */
  @CaptureSpan()
  public static async getDailyExecutionBudget(
    projectId: ObjectID,
  ): Promise<RemediationBudgetDecision> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { aiDailyRemediationExecutionLimit: true },
      props: { isRoot: true },
    });

    const configuredLimit: number | null =
      project?.aiDailyRemediationExecutionLimit ?? null;

    // Paused short-circuits the count query (the FixRunBudget idiom).
    const pausedCheck: RemediationBudgetDecision = this.evaluateDailyBudget({
      configuredLimit,
      executionsToday: 0,
    });

    if (pausedCheck.paused) {
      return pausedCheck;
    }

    const executionsToday: number = (
      await AIRemediationActionService.countBy({
        query: {
          projectId,
          executedAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.getStartOfDay(OneUptimeDate.getCurrentDate(), "UTC"),
          ),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return this.evaluateDailyBudget({ configuredLimit, executionsToday });
  }

  /*
   * Per-subject cap: how many actions have ever executed (or are executing)
   * for this incident/alert. One flapping subject must not drain the day.
   */
  @CaptureSpan()
  public static async getSubjectExecutionCount(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<number> {
    if (!data.incidentId && !data.alertId) {
      return 0;
    }

    return (
      await AIRemediationActionService.countBy({
        query: {
          projectId: data.projectId,
          ...(data.incidentId
            ? { incidentId: data.incidentId }
            : { alertId: data.alertId }),
          status: QueryHelper.any(EXECUTED_STATUSES),
        },
        props: { isRoot: true },
      })
    ).toNumber();
  }

  // Human-readable refusal naming the cap and the setting that controls it.
  public static describeDailyBudgetRejection(
    decision: RemediationBudgetDecision,
  ): string {
    if (decision.paused) {
      return `AI remediation execution is paused for this project — the "Daily AI Remediation Execution Limit" is set to 0. Raise or unset the limit in Settings > AI to resume.`;
    }

    return `The project's daily AI remediation execution limit has been reached (${decision.executionsToday} of ${decision.limit} executions today, UTC). Approved actions can run tomorrow — or raise the "Daily AI Remediation Execution Limit" in Settings > AI (unset means the default of ${DEFAULT_DAILY_REMEDIATION_EXECUTION_LIMIT}/day).`;
  }

  public static describeSubjectCapRejection(): string {
    return `This incident/alert has already had ${PER_SUBJECT_EXECUTION_CAP} AI remediation actions executed — the per-subject cap. Further remediation here is a human call, not an AI retry loop.`;
  }
}
