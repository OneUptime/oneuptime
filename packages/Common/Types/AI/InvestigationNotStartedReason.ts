export type InvestigationNotStartedCode =
  | "ai_disabled"
  | "automatic_investigation_disabled"
  | "provider_missing"
  /*
   * The project runs on OneUptime's own (billed) LLM provider and has no AI
   * credits left, with auto-recharge off — every model call would be
   * refused because the project's AI credits are used up, so no run is
   * started.
   */
  | "insufficient_ai_balance"
  /*
   * The project had reached one of its own daily AI limits (Project
   * Settings → AI Features → More settings) - the token limit, or the
   * spend limit on billed AI - so no run is started until midnight UTC.
   */
  | "project_daily_limit_reached"
  | "severity_below_threshold"
  | "monitor_cooldown"
  /*
   * Investigation rules are set up for this kind of signal, and the record
   * matched none of them: with rules, only the records that match one are
   * investigated automatically.
   */
  | "no_investigation_rule_matched"
  /*
   * The incident or alert was created already resolved (its Initial State,
   * a template's, the API...): it was over before it was recorded, so there
   * was nothing to investigate (Common/Utils/StartingStage). Only ever
   * recorded at creation.
   */
  | "created_resolved"
  | "daily_budget_exhausted"
  | "budget_check_failed"
  | "enqueue_failed"
  | "eligibility_check_failed"
  | "no_run_recorded";

/**
 * A recorded decision is evidence from the creation hook. Current settings
 * explain eligibility now, and must never be presented as a historical fact.
 */
export default interface InvestigationNotStartedReason {
  code: InvestigationNotStartedCode;
  title: string;
  description: string;
  nextStep: string;
  source: "recorded" | "current_configuration" | "unknown";
  evaluatedAt: string;
}

export interface InvestigationGateDetails {
  severityName?: string | undefined;
  minimumSeverityName?: string | undefined;
  cooldownWindowMinutes?: number | undefined;
  // no_investigation_rule_matched: how many enabled rules were checked.
  rulesChecked?: number | undefined;
}
