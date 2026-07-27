/*
 * What the remediation policy gate decided when the action was proposed —
 * persisted on the action row so the audit trail shows not just what ran but
 * under which authority it ran.
 */
enum AIRemediationDecisionMode {
  // A human must click Approve before this action can execute.
  RequireApproval = "RequireApproval",
  /*
   * The policy gate cleared it for unattended execution: a runbook action
   * whose every executing step targets a known non-production agent, on a
   * project that opted into enableAiAutoRemediationOnNonProduction.
   */
  AutoApproved = "AutoApproved",
}

export default AIRemediationDecisionMode;
