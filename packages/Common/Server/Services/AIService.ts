import { getAllEnvVars, IsBillingEnabled } from "../EnvironmentConfig";
import BaseService from "./BaseService";
import LlmProviderService from "./LlmProviderService";
import LlmLogService from "./LlmLogService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import Project from "../../Models/DatabaseModels/Project";
import AIBillingService from "./AIBillingService";
import LLMService, {
  LLMProviderConfig,
  LLMCompletionResponse,
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
  LLMUsage,
} from "../Utils/LLM/LLMService";
import LlmType from "../../Types/LLM/LlmType";
import { Span, trace } from "@opentelemetry/api";
import LlmProvider from "../../Models/DatabaseModels/LlmProvider";
import LlmLog from "../../Models/DatabaseModels/LlmLog";
import LlmLogStatus from "../../Types/LlmLogStatus";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import SubscriptionPlan, {
  PlanType,
} from "../../Types/Billing/SubscriptionPlan";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

/*
 * ============================ LlmLog feature labels ==========================
 *
 * EVERY constant below is a PERSISTED VALUE, not just a display string. Each
 * one is written verbatim into LlmLog.feature by the call site that owns it,
 * and the G4 daily autonomous token budget reads it back by matching those
 * PERSISTED STRINGS against AUTONOMOUS_AI_FEATURES:
 *
 *   SELECT SUM("totalTokens") FROM "LlmLog"
 *    WHERE "projectId" = $1 AND "createdAt" >= $2 AND "feature" = ANY($3)
 *   -- LlmLogService.getTotalTokensUsedSince, $3 = AUTONOMOUS_AI_FEATURES
 *
 * So a label is a piece of the budget's ledger. Renaming one rewrites history:
 * rows written under the old label stop matching, usedTokensToday collapses
 * toward zero, and a project that had already exhausted its daily budget
 * silently gets a fresh full one — unbounded overspend, with no error anywhere.
 *
 * RENAMING A LABEL THEREFORE REQUIRES BOTH:
 *   1. a backfill migration rewriting LlmLog.feature on existing rows, and
 *   2. an entry in LEGACY_AUTONOMOUS_AI_FEATURES (below), so rows written
 *      under the old label during the deploy window still count.
 * Changing a value on its own is never safe.
 *
 * Every autonomous write site imports its label from here — no call site may
 * hardcode the literal. The list and the writers cannot drift apart, which
 * would otherwise leave a feature permanently outside the budget.
 */

/*
 * The LlmLog feature name for incident investigations (AIInvestigationEngine,
 * driven by IncidentInvestigationRunner) — fired automatically when an incident
 * is declared, so a monitor storm is a run storm.
 */
export const AI_INCIDENT_INVESTIGATION_FEATURE: string =
  "AI Incident Investigation";

/*
 * The LlmLog feature name for alert investigations (AlertInvestigationRunner).
 * Same engine as incidents, fired on alert creation.
 */
export const AI_ALERT_INVESTIGATION_FEATURE: string = "AI Alert Investigation";

/*
 * The LlmLog feature name for on-resolve investigation grading
 * (InvestigationGrader) — one constrained call per resolved incident, but
 * autonomous, so the budget covers it.
 */
export const AI_INVESTIGATION_GRADING_FEATURE: string =
  "AI Investigation Grading";

/*
 * The LlmLog feature name for the G6 structured confidence signal
 * (ConfidenceSignal) — one constrained call per completed investigation,
 * outside the per-run caps but inside this daily budget. A budget rejection
 * degrades the signal to "classification-failed" (per-consumer fail
 * directions), never a run failure.
 */
export const AI_CONFIDENCE_CLASSIFICATION_FEATURE: string =
  "AI Confidence Classification";

/*
 * The LlmLog feature name for the investigation TL;DR (InvestigationTldr) —
 * one constrained call per completed investigation that has an analysis,
 * outside the per-run caps but inside this daily budget. A budget rejection
 * (or any other failure) simply leaves the run without a TL;DR; the report
 * is still published and the panel omits the block.
 */
export const AI_INVESTIGATION_TLDR_FEATURE: string = "AI Investigation TLDR";

/*
 * The LlmLog feature name for server-mediated code-fix agent completions
 * (B4 Tier 0) — the in-house coding agent's tool loop routes every LLM call
 * through /ai-agent-data/llm-completion, which executes under this feature.
 */
export const AI_CODE_FIX_FEATURE: string = "AI Code Fix";

/** Metering and autonomous-budget feature name for workflow AI components. */
export const WORKFLOW_AI_FEATURE: string = "Workflow AI";

/*
 * The LlmLog feature name for AI runbook steps. Runbooks are triggered by
 * incident/alert/maintenance rules, so these calls are storm-shaped: one
 * flapping monitor can start many executions.
 */
export const RUNBOOK_AI_STEP_FEATURE: string = "Runbook AI Step";

/*
 * The LlmLog feature name for per-insight triage: the budgeted, read-only
 * Investigation AIRun a newly filed AIInsight enqueues. Insights are filed by
 * deterministic detectors on a scheduled scan, so these runs are storm-shaped
 * by construction and fully autonomous.
 */
export const AI_INSIGHT_TRIAGE_FEATURE: string = "AI Insight Triage";

/*
 * The LlmLog feature name for auto-remediation planning: the read-only
 * RemediationPlan AIRun that picks the most applicable runbook for a matched
 * AI auto-remediation rule. Rules fire on incident/alert creation, so these
 * calls are storm-shaped — one flapping monitor can queue many plans.
 */
export const AI_REMEDIATION_PLANNING_FEATURE: string =
  "AI Remediation Planning";

/*
 * RemediationExecution AIRun for a rule with aiComposesCommands: the run
 * that investigates and composes (and, under a FullAuto allowlist, executes)
 * remediation commands. Fired by incident/alert creation with no human in
 * the loop — storm-shaped like planning, and budget-gated like it.
 */
export const AI_REMEDIATION_EXECUTION_FEATURE: string =
  "AI Remediation Execution";

/*
 * The pre-rename values of the six labels that carried the "Sentinel" codename.
 * These are NOT written by anything any more — they exist only so the daily
 * budget keeps counting rows that ALREADY carry them:
 *
 *   - rows written by the old code during the deploy window (old and new pods
 *     serve traffic side by side, and the budget is a UTC-day sum, so the same
 *     day contains both labels); and
 *   - any row the backfill migration missed (it runs once, and rows can be
 *     written between the migration and the last old pod draining).
 *
 * Without them, the first deploy day hands every project a second full budget.
 *
 * SAFE TO DELETE once no LlmLog row carries an old label. Retention is the
 * clock: LlmLogService hard-deletes rows older than 3 days by createdAt — but
 * ONLY when billing is enabled. So on OneUptime cloud these entries are dead
 * weight 3 days after the deploy; on a self-hosted instance (no billing, no
 * retention sweep) LlmLog rows live forever, so they must stay until the
 * backfill migration has demonstrably rewritten every row.
 *
 * Carrying them costs nothing: AUTONOMOUS_AI_FEATURES is a pure match-list
 * (SQL `= ANY`, and an `.includes()` gate on the write path that no writer can
 * trip because no writer emits these strings any more).
 */
const LEGACY_SENTINEL_INCIDENT_INVESTIGATION_FEATURE: string =
  "Sentinel Incident Investigation";
const LEGACY_SENTINEL_ALERT_INVESTIGATION_FEATURE: string =
  "Sentinel Alert Investigation";
const LEGACY_SENTINEL_INVESTIGATION_GRADING_FEATURE: string =
  "Sentinel Investigation Grading";
const LEGACY_SENTINEL_CONFIDENCE_CLASSIFICATION_FEATURE: string =
  "Sentinel Confidence Classification";
const LEGACY_SENTINEL_CODE_FIX_FEATURE: string = "Sentinel Code Fix";
const LEGACY_SENTINEL_INSIGHT_TRIAGE_FEATURE: string =
  "Sentinel Insight Triage";

export const LEGACY_AUTONOMOUS_AI_FEATURES: Array<string> = [
  LEGACY_SENTINEL_INCIDENT_INVESTIGATION_FEATURE,
  LEGACY_SENTINEL_ALERT_INVESTIGATION_FEATURE,
  LEGACY_SENTINEL_INVESTIGATION_GRADING_FEATURE,
  LEGACY_SENTINEL_CONFIDENCE_CLASSIFICATION_FEATURE,
  LEGACY_SENTINEL_CODE_FIX_FEATURE,
  LEGACY_SENTINEL_INSIGHT_TRIAGE_FEATURE,
];

/*
 * Features that run WITHOUT a human in the loop. Incident-linked and
 * alert-linked calls use their respective daily token limits; subjectless
 * calls use Project.aiDailyAutonomousTokenLimit. Interactive chat and
 * explicitly user-triggered AI are never budget-blocked.
 * Auto-postmortem is deliberately excluded for now: it is one call per
 * resolved incident, not storm-shaped; include it when it moves to the queue.
 *
 * THE ENTRIES ARE PERSISTED STRINGS — see the header comment above before
 * touching any of them. Built from the constants (never raw literals) so the
 * budget list and the write sites cannot drift.
 */
export const AUTONOMOUS_AI_FEATURES: Array<string> = [
  // Investigations: fired by incident/alert creation, fully unattended.
  AI_INCIDENT_INVESTIGATION_FEATURE,
  AI_ALERT_INVESTIGATION_FEATURE,
  // One constrained call per resolved incident (InvestigationGrader).
  AI_INVESTIGATION_GRADING_FEATURE,
  // One constrained call per completed investigation (ConfidenceSignal).
  AI_CONFIDENCE_CLASSIFICATION_FEATURE,
  /*
   * One constrained call per completed investigation that produced an
   * analysis (InvestigationTldr) — same storm shape as the classification
   * above, so the same daily budget must cover it.
   */
  AI_INVESTIGATION_TLDR_FEATURE,
  /*
   * Server-mediated code-fix agent completions (B4 Tier 0). Fix runs are
   * user-triggered, but the tool loop then runs unattended for up to ~40
   * calls — storm-shaped enough that the daily budget must cover it. The
   * per-run loop budgets (CodeFixAgentCompletion) cap a single run; this
   * daily subject lane caps all of them together.
   */
  AI_CODE_FIX_FEATURE,
  /*
   * AI runbook steps run unattended once the runbook starts, and rule
   * triggers make them storm-shaped (see the constant above) — even
   * manually started runs proceed without a human approving each LLM call.
   */
  RUNBOOK_AI_STEP_FEATURE,
  // Workflow components also execute without per-request human approval.
  WORKFLOW_AI_FEATURE,
  /*
   * Per-insight preventive triage (InsightTriageRunner). One read-only
   * Investigation run per new AIInsight, with no human in the loop —
   * a noisy scan tick can file several insights at once, so the daily
   * budget must cover these runs too.
   */
  AI_INSIGHT_TRIAGE_FEATURE,
  /*
   * Auto-remediation planning (RemediationPlanRunner). One read-only,
   * constrained call per AI-rule match, fired by incident/alert creation
   * with no human in the loop — storm-shaped by construction.
   */
  AI_REMEDIATION_PLANNING_FEATURE,
  /*
   * Auto-remediation command composition/execution
   * (RemediationExecutionRunner). Same trigger shape as planning, with a
   * larger per-run tool budget — the daily subject lane must cover it.
   */
  AI_REMEDIATION_EXECUTION_FEATURE,
  /*
   * Pre-rename labels. Keeps the budget honest for rows already persisted
   * under the old names — read the LEGACY_AUTONOMOUS_AI_FEATURES comment
   * before removing.
   */
  ...LEGACY_AUTONOMOUS_AI_FEATURES,
];

/*
 * Before subject-lane accounting shipped, the main investigation calls did
 * not persist incidentId/alertId (or aiRunId). Their feature label is the only
 * durable lane signal left on those rows. Keep these lists so a deployment
 * does not reset today's incident/alert spend or charge it to background work.
 */
const LEGACY_INCIDENT_LANE_FEATURES: Array<string> = [
  AI_INCIDENT_INVESTIGATION_FEATURE,
  AI_INVESTIGATION_GRADING_FEATURE,
  LEGACY_SENTINEL_INCIDENT_INVESTIGATION_FEATURE,
  LEGACY_SENTINEL_INVESTIGATION_GRADING_FEATURE,
];
const LEGACY_ALERT_LANE_FEATURES: Array<string> = [
  AI_ALERT_INVESTIGATION_FEATURE,
  LEGACY_SENTINEL_ALERT_INVESTIGATION_FEATURE,
];

export interface AutonomousBudgetStatus {
  exhausted: boolean;
  // null when the project has no limit configured.
  limitInTokens: number | null;
  usedTokensToday: number;
}

/*
 * How long a synchronous "Generate with AI" endpoint may spend inside the
 * provider on a single attempt.
 *
 * These endpoints — incident and episode postmortems, and incident, alert and
 * scheduled-maintenance notes — hold the browser's HTTP connection open across
 * the whole completion and write nothing until it returns. nginx gives the
 * request 300s (`location /api` in Nginx/default.conf.template), so this MUST
 * stay strictly below that: whichever side gives up first decides what the
 * user reads. When the server wins, the browser gets the provider's own
 * explanation ("model not found", "connection refused", a rate limit). When
 * the proxy wins, it synthesizes a gateway error — a 504, or a 502 when the
 * app's hostname resolves to more than one address and nginx's retry also
 * fails — and getFriendlyMessage in Common/UI/Utils/API/API.ts turns BOTH of
 * those, and only those, into the generic "Error connecting to server. Please
 * try again in few minutes." That is exactly the report in GH#3434.
 *
 * The remaining ~60s of headroom pays for building the incident context and
 * writing the response. Callers pair this with `requestRetries: 0`: a second
 * full-length attempt cannot fit inside the proxy budget, and by the time it
 * began the browser would already have been handed a 504. The retry ladder is
 * still the right default for unattended work (LLMService.DEFAULT_REQUEST_
 * ATTEMPTS), which nothing here changes — a person watching a spinner can
 * simply press the button again, and now sees why they need to.
 */
export const INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS: number = 4 * 60 * 1000;

/*
 * The single wording for a refusal by the Project.enableAi kill switch. Every
 * surface that has to tell somebody AI is switched off imports this, so the
 * message a user reads in Slack, in Teams, on a runbook step and on a
 * "Generate with AI" button is the same sentence, and it always names the
 * screen where the switch can be turned back on.
 */
export const AI_DISABLED_MESSAGE: string =
  "AI features are disabled for this project. Enable them in Project Settings > AI Credits.";

export interface AILogRequest {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  feature: string; // e.g., "IncidentPostmortem", "IncidentNote"
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
  aiRunId?: ObjectID | undefined;
  /*
   * When set, use this specific provider (validated against the project) rather
   * than the project default. Powers the in-chat provider/model switcher.
   */
  llmProviderId?: ObjectID | undefined;
  messages: Array<LLMMessage>;
  tools?: Array<LLMToolDefinition> | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
  /** Per-attempt provider request timeout. */
  requestTimeoutInMs?: number | undefined;
  /** Provider retry count. A workflow uses zero to avoid duplicate billing. */
  requestRetries?: number | undefined;
  /**
   * Re-apply caller-owned model inputs and bounds after provider-level
   * additional parameters. This prevents unattended callers from having their
   * messages, tools, choice count, or output cap overridden centrally.
   */
  protectRequestParameters?: boolean | undefined;
  /**
   * When false, errors from the provider-execution phase are replaced with a
   * generic message before they reach application logs, traces, persisted LLM
   * logs, or the caller. Use this when a provider could echo private request
   * content in an error response.
   */
  storeErrorDetails?: boolean | undefined;
  /*
   * When false, prompt/response previews are NOT persisted to LlmLog.
   * Use for features whose content is private to a single user (e.g. AI
   * chat) — LlmLog is readable by all project members.
   */
  storeContentPreviews?: boolean | undefined;
}

export interface AILogResponse {
  content: string;
  toolCalls?: Array<LLMToolCall> | undefined;
  /*
   * Why generation stopped, straight from the provider: "length" means the
   * output hit the token cap, so callers can surface truncation instead of
   * presenting a cut-off answer as complete.
   */
  stopReason?: LLMCompletionResponse["stopReason"];
  llmLog: LlmLog;
}

export class Service extends BaseService {
  public constructor() {
    super();
  }

  /**
   * Assert the project-level `enableAi` kill switch, and nothing else.
   *
   * This is admission control, not the guarantee. The guarantee lives inside
   * executeWithLogging (see assertProjectAIEnabledOnRow), which no caller can
   * route around. What this buys on top is an EARLY refusal: the synchronous
   * "Generate with AI" endpoints call it before their context builders run,
   * so a project with AI off never pays for the expensive reads that only
   * exist to build a prompt nobody is allowed to send.
   *
   * Fails closed: a project row we cannot read is not a project we can
   * confirm has AI enabled, so a missing project is refused rather than
   * waved through.
   */
  @CaptureSpan()
  public async assertProjectAIEnabled(projectId: ObjectID): Promise<void> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { enableAi: true },
      props: { isRoot: true },
    });

    this.assertProjectAIEnabledOnRow(project);
  }

  /**
   * The toggle verdict itself, over an already-loaded row. Split out so the
   * one place that owns the rule is shared by every caller — the throwing
   * assert above, the non-throwing predicate below, and the backstop inside
   * executeWithLogging, which reads the row for its own reasons and must not
   * pay for a second read to ask the same question.
   */
  private assertProjectAIEnabledOnRow(project: Project | null): void {
    if (!project) {
      throw new BadDataException("Project not found.");
    }

    /*
     * Strictly `=== false`. The column is NOT NULL DEFAULT true, so an
     * undefined value here means "not selected", not "disabled", and must
     * keep working — same semantics as every other enableAi read.
     */
    if (project.enableAi === false) {
      throw new BadDataException(AI_DISABLED_MESSAGE);
    }
  }

  /**
   * The same verdict as assertProjectAIEnabled, as a boolean.
   *
   * For the autonomous, fire-and-forget lanes — on-resolve grading and
   * friends — where "this project has AI switched off" is not an error and
   * must not be logged as one. Those callers sit inside a catch that reports
   * failures, so letting the backstop throw would turn a deliberate,
   * correctly-configured setting into recurring error noise. They ask this
   * first and simply skip.
   *
   * Fails closed the same way: an unreadable project row answers false.
   */
  @CaptureSpan()
  public async isProjectAIEnabled(projectId: ObjectID): Promise<boolean> {
    try {
      await this.assertProjectAIEnabled(projectId);
      return true;
    } catch (err) {
      logger.debug(
        `Project AI toggle: ${projectId.toString()} may not use AI — ${err}`,
      );
      return false;
    }
  }

  /**
   * Assert the project-level feature, subscription, and payment gates shared by
   * background AI entry points. Provider availability, balance, and token
   * budgets are checked later by executeWithLogging so those failures are
   * captured in the metered LLM log.
   */
  @CaptureSpan()
  public async assertProjectCanUseAI(projectId: ObjectID): Promise<void> {
    /*
     * The kill switch and the plan read stay in flight together — the plan
     * read does not depend on the toggle's verdict. The ordering that matters
     * is still preserved: the unpaid and plan refusals below run only once
     * this resolves, so a project with AI switched off is refused for being
     * switched off, never for something billing has to say about it.
     */
    const [, planStatus]: [void, CurrentPlan] = await Promise.all([
      this.assertProjectAIEnabled(projectId),
      ProjectService.getCurrentPlan(projectId),
    ]);

    if (planStatus.isSubscriptionUnpaid) {
      throw new PaymentRequiredException(
        "Your subscription is unpaid. Please update your payment method to use AI in workflows.",
      );
    }

    if (
      planStatus.plan &&
      !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
        PlanType.Growth,
        planStatus.plan,
        getAllEnvVars(),
      )
    ) {
      throw new PaymentRequiredException(
        "Please upgrade your plan to Growth to use AI in workflows.",
      );
    }
  }

  /*
   * G4 daily budget: has this project consumed the selected subject lane's
   * daily autonomous-token allowance (UTC day)? Counts only that lane's
   * AUTONOMOUS_AI_FEATURES tokens, so chat usage neither eats the autonomous
   * budget nor is blocked by it.
   */
  @CaptureSpan()
  public async getAutonomousDailyBudgetStatus(
    projectId: ObjectID,
    subject?: {
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
    },
  ): Promise<AutonomousBudgetStatus> {
    this.assertSingleSubject(subject);

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        aiDailyAutonomousTokenLimit: true,
        incidentAiDailyAutonomousTokenLimit: true,
        alertAiDailyAutonomousTokenLimit: true,
      },
      props: { isRoot: true },
    });

    let limitInTokens: number | null =
      project?.aiDailyAutonomousTokenLimit ?? null;

    if (subject?.incidentId) {
      limitInTokens = project?.incidentAiDailyAutonomousTokenLimit ?? null;
    } else if (subject?.alertId) {
      limitInTokens = project?.alertAiDailyAutonomousTokenLimit ?? null;
    }

    if (limitInTokens === null) {
      return { exhausted: false, limitInTokens: null, usedTokensToday: 0 };
    }

    /*
     * A limit of 0 (or negative) pauses autonomous runs entirely — the safe
     * reading of "0 tokens allowed", and doubles as a spend kill-switch.
     */
    if (limitInTokens <= 0) {
      return { exhausted: true, limitInTokens, usedTokensToday: 0 };
    }

    const usedTokensToday: number = await LlmLogService.getTotalTokensUsedSince(
      {
        projectId,
        since: OneUptimeDate.getStartOfDay(
          OneUptimeDate.getCurrentDate(),
          "UTC",
        ),
        features: AUTONOMOUS_AI_FEATURES,
        incidentId: subject?.incidentId,
        alertId: subject?.alertId,
        legacyIncidentFeatures: LEGACY_INCIDENT_LANE_FEATURES,
        legacyAlertFeatures: LEGACY_ALERT_LANE_FEATURES,
      },
    );

    return {
      exhausted: usedTokensToday >= limitInTokens,
      limitInTokens,
      usedTokensToday,
    };
  }

  @CaptureSpan()
  public async executeWithLogging(
    request: AILogRequest,
  ): Promise<AILogResponse> {
    this.assertSingleSubject(request);

    /*
     * ===================== The enableAi kill switch =======================
     *
     * Every AI call in this codebase — user-triggered, autonomous, chat-ops,
     * runbook step, agent loop — comes through here. That makes this the only
     * place the project toggle can be enforced ONCE and be true for callers
     * that do not exist yet. Enforcing it at entry points instead is what
     * this method used to rely on, and it leaked exactly the way per-site
     * admission control always leaks: five endpoints were gated and nine
     * other call sites were not, so a project with AI switched off could
     * still be made to spend provider tokens through any of them.
     *
     * There is deliberately NO per-request opt-out. A `skipAICheck` flag
     * would re-open the hole with a one-word diff, and the caller most likely
     * to reach for it is the one that has not thought about the switch. A
     * lane that must not throw — fire-and-forget autonomous work — asks
     * isProjectAIEnabled() first and skips silently; a lane that owes the
     * user a readable refusal (Slack, Teams) checks first and posts one. Both
     * are about DELIVERY, and both still land here if they forget.
     *
     * The row is read once and carried to the balance check below, so on the
     * billing path this costs no extra query. Off the billing path it adds a
     * single primary-key read per LLM call — set against a provider round
     * trip measured in seconds, and against the alternative of billing a
     * project that told us not to.
     */
    const project: Project | null = await ProjectService.findOneById({
      id: request.projectId,
      select: { enableAi: true, aiCurrentBalanceInUSDCents: true },
      props: { isRoot: true },
    });

    this.assertProjectAIEnabledOnRow(project);

    const startTime: Date = new Date();

    // Get LLM provider for the project (honoring an explicit per-chat choice).
    const llmProvider: LlmProvider | null =
      await LlmProviderService.getProviderForChat({
        projectId: request.projectId,
        llmProviderId: request.llmProviderId,
      });

    if (!llmProvider) {
      throw new BadDataException(
        "No LLM provider configured for this project. Please configure an LLM provider in Settings > AI > LLM Providers.",
      );
    }

    if (!llmProvider.llmType) {
      throw new BadDataException(
        "LLM provider type is not configured properly.",
      );
    }

    // Create log entry (will be updated after completion)
    const logEntry: LlmLog = new LlmLog();
    logEntry.projectId = request.projectId;
    logEntry.isGlobalProvider = llmProvider.isGlobalLlm || false;
    logEntry.feature = request.feature;

    const storeContentPreviews: boolean =
      request.storeContentPreviews !== false;

    logEntry.requestPrompt = storeContentPreviews
      ? request.messages
          .map((m: LLMMessage) => {
            return m.content;
          })
          .join("\n")
          .substring(0, 5000) // Store first 5000 chars
      : "[Redacted — this content is private to the requesting user]";
    logEntry.requestStartedAt = startTime;

    // Set optional fields only if they have values
    if (llmProvider.id) {
      logEntry.llmProviderId = llmProvider.id;
    }
    if (llmProvider.name) {
      logEntry.llmProviderName = llmProvider.name;
    }
    if (llmProvider.llmType) {
      logEntry.llmType = llmProvider.llmType;
    }
    if (llmProvider.modelName) {
      logEntry.modelName = llmProvider.modelName;
    }
    if (request.userId) {
      logEntry.userId = request.userId;
    }
    if (request.incidentId) {
      logEntry.incidentId = request.incidentId;
    }
    if (request.alertId) {
      logEntry.alertId = request.alertId;
    }
    if (request.scheduledMaintenanceId) {
      logEntry.scheduledMaintenanceId = request.scheduledMaintenanceId;
    }
    if (request.aiRunId) {
      logEntry.aiRunId = request.aiRunId;
    }

    /*
     * Check if billing should apply. Only bill for the global (OneUptime-hosted)
     * provider, and only when it actually has a per-token cost. A free global
     * provider (costPerMillionTokensInUSDCents = 0, the default) consumes no
     * balance, so it must not require or block on one either — otherwise a $0
     * provider would still fail with "Insufficient AI balance".
     */
    const shouldBill: boolean =
      IsBillingEnabled &&
      (llmProvider.isGlobalLlm || false) &&
      (llmProvider.costPerMillionTokensInUSDCents || 0) > 0;

    /*
     * Check balance if billing enabled and using global provider. The row was
     * already read for the kill switch above and is non-null past that gate,
     * so this reuses it rather than issuing a second read of the same row.
     */
    if (shouldBill && (project!.aiCurrentBalanceInUSDCents || 0) <= 0) {
      logEntry.status = LlmLogStatus.InsufficientBalance;
      logEntry.statusMessage = "Insufficient AI balance";
      logEntry.requestCompletedAt = new Date();
      logEntry.durationMs = new Date().getTime() - startTime.getTime();

      await LlmLogService.create({
        data: logEntry,
        props: { isRoot: true },
      });

      throw new BadDataException(
        "Insufficient AI balance. Please recharge your AI balance in Project Settings > AI Credits.",
      );
    }

    /*
     * G4 daily budget enforcement — autonomous features only, mirroring the
     * InsufficientBalance path above. Autonomous runs fail closed on budget
     * (G9); interactive features are never blocked here. A run that crosses
     * the limit mid-flight errors on its next LLM call, which marks the AIRun
     * Error with this message — visible in the investigation panel.
     */
    if (AUTONOMOUS_AI_FEATURES.includes(request.feature)) {
      const budget: AutonomousBudgetStatus =
        await this.getAutonomousDailyBudgetStatus(request.projectId, {
          incidentId: request.incidentId,
          alertId: request.alertId,
        });

      if (budget.exhausted) {
        const settingsLocation: string = request.incidentId
          ? "Incidents > AI > Investigation"
          : request.alertId
            ? "Alerts > AI > Investigation"
            : "Project Settings > AI > AI Guardrails";
        const budgetMessage: string = `Daily autonomous AI token budget exhausted (${budget.usedTokensToday.toLocaleString()} of ${budget.limitInTokens?.toLocaleString()} tokens used today). Autonomous AI requests resume tomorrow (UTC) — raise or unset the limit under ${settingsLocation}.`;

        logEntry.status = LlmLogStatus.BudgetExceeded;
        logEntry.statusMessage = budgetMessage.substring(0, 490);
        logEntry.requestCompletedAt = new Date();
        logEntry.durationMs = new Date().getTime() - startTime.getTime();

        await LlmLogService.create({
          data: logEntry,
          props: { isRoot: true },
        });

        throw new BadDataException(budgetMessage);
      }
    }

    try {
      // Build LLM config
      const llmConfig: LLMProviderConfig = {
        llmType: llmProvider.llmType,
      };

      if (llmProvider.apiKey) {
        llmConfig.apiKey = llmProvider.apiKey;
      }

      if (llmProvider.baseUrl) {
        llmConfig.baseUrl = llmProvider.baseUrl.toString();
      }

      if (llmProvider.modelName) {
        llmConfig.modelName = llmProvider.modelName;
      }

      // Execute LLM call
      const response: LLMCompletionResponse = await LLMService.getCompletion({
        llmProviderConfig: llmConfig,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        maxTokens: request.maxTokens,
        tools: request.tools,
        requestTimeoutInMs: request.requestTimeoutInMs,
        requestRetries: request.requestRetries,
        protectRequestParameters: request.protectRequestParameters,
        includeProviderErrorDetails: request.storeErrorDetails !== false,
        ...(llmProvider.additionalParams
          ? { additionalParams: llmProvider.additionalParams }
          : {}),
      });

      const endTime: Date = new Date();

      // Update log with success info
      logEntry.status = LlmLogStatus.Success;
      logEntry.totalTokens = response.usage?.totalTokens || 0;
      logEntry.completionTokens = response.usage?.completionTokens || 0;
      logEntry.cachedInputTokens = response.usage?.cachedInputTokens || 0;
      logEntry.cacheCreationTokens = response.usage?.cacheCreationTokens || 0;
      logEntry.responsePreview = storeContentPreviews
        ? response.content.substring(0, 2000) // Store first 2000 chars
        : "[Redacted — this content is private to the requesting user]";
      logEntry.requestCompletedAt = endTime;
      logEntry.durationMs = endTime.getTime() - startTime.getTime();

      // Calculate and apply costs if using global provider with billing enabled
      if (shouldBill && response.usage) {
        const totalCost: number = Math.ceil(
          (response.usage.totalTokens / 1_000_000) *
            (llmProvider.costPerMillionTokensInUSDCents || 0),
        );

        logEntry.costInUSDCents = totalCost;
        logEntry.wasBilled = true;

        // Deduct from project balance
        if (totalCost > 0) {
          /*
           * Atomic decrement — concurrent LLM calls within and across chat
           * turns must not lose each other's deductions (a read-modify-write
           * here silently forgave overlapping spend).
           */
          await ProjectService.deductAiBalanceInUSDCents({
            projectId: request.projectId,
            amountInUSDCents: totalCost,
          });

          // Check if auto-recharge is needed (do this async, don't wait)
          AIBillingService.rechargeIfBalanceIsLow(request.projectId).catch(
            (err: Error) => {
              logger.error("Error during AI balance auto-recharge check:", {
                projectId: request.projectId?.toString(),
                userId: request.userId?.toString(),
              } as LogAttributes);
              logger.error(err, {
                projectId: request.projectId?.toString(),
                userId: request.userId?.toString(),
              } as LogAttributes);
            },
          );
        }
      }

      /*
       * Emit gen_ai.* semantic-convention attributes on the active span so
       * OneUptime's own AI usage is a first-class LLM span in OneUptime's own
       * telemetry (dogfooding — LlmSpanUtil detects these). Never fails the call.
       */
      this.setGenAiSpanAttributes({
        llmType: llmProvider.llmType,
        modelName: llmConfig.modelName,
        usage: response.usage,
        costInUSDCents: logEntry.costInUSDCents,
      });

      // Save log entry
      const savedLog: LlmLog = await LlmLogService.create({
        data: logEntry,
        props: { isRoot: true },
      });

      return {
        content: response.content,
        toolCalls: response.toolCalls,
        stopReason: response.stopReason,
        llmLog: savedLog,
      };
    } catch (error) {
      const rawErrorMessage: string =
        error instanceof Error ? error.message : String(error);
      const errorMessage: string =
        request.storeErrorDetails === false
          ? "The AI provider request failed. Review the provider configuration and try again."
          : rawErrorMessage;

      /*
       * Log the error without persisting private provider details when asked.
       *
       * statusMessage is varchar(500) (ColumnLength.LongText), and
       * DatabaseService rejects an over-length value BEFORE any SQL runs — so
       * an untruncated provider error does not just fail to be logged, its
       * BadDataException about column length replaces the real failure on the
       * way out and the operator never learns what the provider said. Provider
       * errors are routinely longer than 500 characters (an echoed request
       * body, an HTML error page). Truncate the same way the budget path
       * above does.
       */
      logEntry.status = LlmLogStatus.Error;
      logEntry.statusMessage = errorMessage.substring(0, 490);
      logEntry.requestCompletedAt = new Date();
      logEntry.durationMs = new Date().getTime() - startTime.getTime();

      await LlmLogService.create({
        data: logEntry,
        props: { isRoot: true },
      });

      if (request.storeErrorDetails === false) {
        throw new BadDataException(errorMessage);
      }

      throw error;
    }
  }

  private assertSingleSubject(subject?: {
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): void {
    if (subject?.incidentId && subject.alertId) {
      throw new BadDataException(
        "An AI request cannot belong to both an incident and an alert.",
      );
    }
  }

  /*
   * Set gen_ai.* attributes (OpenTelemetry GenAI semantic conventions) on the
   * currently-active span. The @CaptureSpan()-wrapped caller owns that span, so
   * LlmSpanUtil recognizes these calls as first-class LLM spans.
   */
  private setGenAiSpanAttributes(data: {
    llmType: LlmType;
    modelName?: string | undefined;
    usage?: LLMUsage | undefined;
    costInUSDCents?: number | undefined;
  }): void {
    try {
      const span: Span | undefined = trace.getActiveSpan();
      if (!span) {
        return;
      }

      span.setAttribute("gen_ai.system", data.llmType.toString());
      span.setAttribute("gen_ai.provider.name", data.llmType.toString());
      span.setAttribute("gen_ai.operation.name", "chat");

      if (data.modelName) {
        span.setAttribute("gen_ai.request.model", data.modelName);
        span.setAttribute("gen_ai.response.model", data.modelName);
      }

      if (data.usage) {
        span.setAttribute(
          "gen_ai.usage.input_tokens",
          data.usage.promptTokens || 0,
        );
        span.setAttribute(
          "gen_ai.usage.output_tokens",
          data.usage.completionTokens || 0,
        );
        span.setAttribute(
          "gen_ai.usage.total_tokens",
          data.usage.totalTokens || 0,
        );
      }

      if (data.costInUSDCents) {
        span.setAttribute("gen_ai.usage.cost_usd", data.costInUSDCents / 100);
      }
    } catch {
      // Telemetry must never fail the LLM call.
    }
  }
}

export default new Service();
