/*
 * What an AI-proposed action is FOR — the dimension the per-agent access
 * grant (RunbookAgentAccessLevel) is enforced against:
 *
 *   - Diagnostic actions gather information (kubectl get/describe, log
 *     collection, df, process lists). They may dispatch to ReadOnly and
 *     ReadWrite agents alike, and their captured output feeds a bounded
 *     follow-up investigation — the closed loop.
 *   - Remediation actions change things (restarts, rollbacks, scaling).
 *     They may only dispatch to agents explicitly granted ReadWrite.
 *
 * The intent is DECLARED by the proposer and shown to approvers; OneUptime
 * cannot verify what a script truly does. The honest enforcement story is
 * the agent's own OS-level permissions (see RunbookAgentAccessLevel).
 */
enum AIRemediationIntent {
  Diagnostic = "Diagnostic",
  Remediation = "Remediation",
}

export default AIRemediationIntent;
