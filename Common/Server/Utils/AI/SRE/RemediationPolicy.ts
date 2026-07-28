import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import AIRemediationActionType from "../../../../Types/AI/AIRemediationActionType";
import AIRemediationActionStatus from "../../../../Types/AI/AIRemediationActionStatus";
import AIRemediationDecisionMode from "../../../../Types/AI/AIRemediationDecisionMode";
import AIRemediationIntent from "../../../../Types/AI/AIRemediationIntent";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import { RunbookAgentAccessLevelHelper } from "../../../../Types/Runbook/RunbookAgentAccessLevel";
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
 * below hold everywhere at once, not per-callsite (this is the G1
 * policy-gateway seed for the environment-execution lane).
 *
 * The rules, in the fail-safe direction:
 *   1. Nothing happens unless Project.enableAiRemediation is true AND the
 *      master switch Project.enableAi is not false. Both default off/safe.
 *   2. NOTHING auto-executes unless an enabled Auto Remediation Rule that a
 *      project admin authored MATCHES the incident/alert. Rules are the
 *      standing authorization — see AutoRemediationRuleEngineService — and
 *      match in the same shape as On-Call and Owner rules (monitors,
 *      severities, labels, title/description patterns). No matching rule
 *      means every proposal waits for a human. Fail-closed on any error.
 *   3. AI-drafted Command actions additionally require the matching rule's
 *      autoExecuteCommands grant. A drafted command is a script no human has
 *      reviewed, so authorizing it unattended is a separate, explicit choice
 *      made per rule.
 *   4. Writing to a host additionally requires that host's AI access grant.
 *      RunbookAgent.accessLevel is ReadOnly by default: AI may run
 *      Diagnostic actions there unattended (that IS read access) but a
 *      Remediation action targeting a ReadOnly agent always waits for a
 *      human. Grant ReadWrite on the agents where AI may change things —
 *      typically test/staging — and leave production ReadOnly to get
 *      "diagnose everywhere, act only where I said".
 *   5. Executions are budgeted: a per-UTC-day cap (default 10 — unset is
 *      NOT unlimited, unlike token budgets, because these actions run on
 *      customer infrastructure; 0 pauses the lane) and a per-subject cap so
 *      one incident can never eat the whole day's budget.
 *
 * Human approval is ALWAYS available regardless of rules and grants — those
 * govern what happens UNATTENDED. The approve endpoint has its own
 * execute-capable permission gate.
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
 * agent-bound steps target (each one's AI access grant must permit what the
 * action intends), and whether any step is an HTTP request — a URL has no
 * agent and therefore no grant to check, so it can never auto-write.
 */
export interface RunbookAutonomyProfile {
  agentIds: Array<string>;
  hasHttpSteps: boolean;
}

/* What the rule engine decided for the subject this action belongs to. */
export interface SubjectAutoRemediationGrant {
  // Did an enabled Auto Remediation Rule match this incident/alert?
  matched: boolean;
  // Does a matching rule authorize unattended AI-drafted commands?
  commandsAllowed: boolean;
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
   * The pure decision (exported for tests): RequireApproval unless EVERY
   * condition for unattended execution holds — a matching rule, the
   * command grant when the action is a drafted command, and a ReadWrite AI
   * access grant on every agent the action would write through.
   *
   * `agentAccessLevels` carries the AI access grant of every agent this
   * action dispatches to (a Command's single target agent; a Runbook's
   * agent-bound steps). An agent that could not be resolved must be passed
   * as undefined so the fail-safe read denies it.
   */
  public static decideDecisionMode(data: {
    actionType: AIRemediationActionType;
    intent: AIRemediationIntent;
    subjectGrant: SubjectAutoRemediationGrant;
    runbookProfile?: RunbookAutonomyProfile | undefined;
    agentAccessLevels?: Array<string | undefined> | undefined;
  }): AIRemediationDecisionMode {
    /*
     * Rule 2: no standing authorization for this incident/alert means no
     * unattended anything. This is the primary gate.
     */
    if (!data.subjectGrant.matched) {
      return AIRemediationDecisionMode.RequireApproval;
    }

    /*
     * Rule 3: a drafted command is a script nobody reviewed — the matching
     * rule must explicitly authorize unattended commands.
     */
    if (
      data.actionType === AIRemediationActionType.Command &&
      !data.subjectGrant.commandsAllowed
    ) {
      return AIRemediationDecisionMode.RequireApproval;
    }

    const accessLevels: Array<string | undefined> =
      data.agentAccessLevels || [];

    if (data.actionType === AIRemediationActionType.Runbook) {
      /*
       * A runbook we cannot classify, or one containing an HTTP step (no
       * agent, therefore no grant to check, and a URL's effect cannot be
       * classified), never auto-runs.
       */
      if (!data.runbookProfile || data.runbookProfile.hasHttpSteps) {
        return AIRemediationDecisionMode.RequireApproval;
      }

      /*
       * Every agent-bound step must have resolved to a known agent — a
       * dangling agentId means we cannot check where it runs.
       */
      if (accessLevels.length !== data.runbookProfile.agentIds.length) {
        return AIRemediationDecisionMode.RequireApproval;
      }
    }

    /*
     * Rule 4: writing needs the per-host grant. Diagnostic actions only
     * read, which is exactly what the default ReadOnly grant permits, so
     * they may auto-run on any resolved agent; Remediation actions need
     * ReadWrite on EVERY agent they touch.
     */
    if (data.intent === AIRemediationIntent.Remediation) {
      if (
        data.actionType === AIRemediationActionType.Command &&
        accessLevels.length === 0
      ) {
        // A command with no resolvable target agent cannot be verified.
        return AIRemediationDecisionMode.RequireApproval;
      }

      for (const accessLevel of accessLevels) {
        if (!RunbookAgentAccessLevelHelper.canWrite(accessLevel)) {
          return AIRemediationDecisionMode.RequireApproval;
        }
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
      return `AI remediation execution is paused for this project — the "Daily AI Remediation Execution Limit" is set to 0. Raise or unset the limit in the AI settings pages (Settings > Incidents/Alerts > AI) to resume.`;
    }

    return `The project's daily AI remediation execution limit has been reached (${decision.executionsToday} of ${decision.limit} executions today, UTC). Approved actions can run tomorrow — or raise the "Daily AI Remediation Execution Limit" in the AI settings pages (Settings > Incidents/Alerts > AI; unset means the default of ${DEFAULT_DAILY_REMEDIATION_EXECUTION_LIMIT}/day).`;
  }

  public static describeSubjectCapRejection(): string {
    return `This incident/alert has already had ${PER_SUBJECT_EXECUTION_CAP} AI remediation actions executed — the per-subject cap. Further remediation here is a human call, not an AI retry loop.`;
  }
}
