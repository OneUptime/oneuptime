export type InvestigationNotStartedCode =
  | "ai_disabled"
  | "automatic_investigation_disabled"
  | "provider_missing"
  | "severity_below_threshold"
  | "monitor_cooldown"
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
}
