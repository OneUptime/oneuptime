/*
 * What the remediation policy gate decided when the action was proposed —
 * persisted on the action row so the audit trail shows not just what ran but
 * under which authority it ran.
 */
enum AIRemediationDecisionMode {
  // A human must click Approve before this action can execute.
  RequireApproval = "RequireApproval",
  /*
   * The policy gate cleared it for unattended execution: an Auto
   * Remediation Rule the project authored matches this incident/alert
   * (and, for an AI-drafted command, that rule grants unattended
   * commands), and every agent the action would write through carries a
   * ReadWrite AI access grant.
   */
  AutoApproved = "AutoApproved",
}

export default AIRemediationDecisionMode;
