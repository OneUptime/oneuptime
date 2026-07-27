enum AIRemediationActionType {
  /*
   * Start an EXISTING, human-authored runbook whole. The safest action kind:
   * every step (and which agent it runs on) was written and reviewed by a
   * human before AI could ever reference it, so the blast radius is exactly
   * what the runbook author already accepted. The only kind eligible for
   * auto-execution, and only on non-production agents.
   */
  Runbook = "Runbook",
  /*
   * A free-form shell script AI drafted for a specific Runbook Agent. Always
   * requires explicit human approval before it executes — no project flag
   * relaxes this, in any environment. On approval it is materialized as a
   * single-step AI-authored runbook (Runbook.isCreatedByAi) so the execution
   * rides the exact same audited substrate as everything else.
   */
  Command = "Command",
}

export default AIRemediationActionType;
