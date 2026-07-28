/*
 * What the AI remediation lane may dispatch to a Runbook Agent. This is the
 * per-agent capability grant: give production agents ReadOnly (AI may run
 * diagnostics there but never remediations) and test/staging agents
 * ReadWrite. The default is ReadOnly — the fail-safe direction — so no agent
 * accepts AI-dispatched writes until a project admin deliberately grants it.
 *
 * HONESTY NOTE (mirrored in the docs): OneUptime cannot verify what a script
 * actually does — the grant is enforced at the declared-intent level
 * (Diagnostic vs Remediation actions). The hard backstop is how the agent
 * process itself is permissioned on the host: run a ReadOnly agent as an OS
 * user that genuinely cannot mutate anything, and the grant is enforced by
 * the operating system, not by trust.
 */
enum RunbookAgentAccessLevel {
  ReadOnly = "ReadOnly",
  ReadWrite = "ReadWrite",
}

export default RunbookAgentAccessLevel;

export class RunbookAgentAccessLevelHelper {
  /*
   * The fail-safe read: anything unset, unknown, or unparseable counts as
   * ReadOnly. Every dispatch decision must route through this helper so the
   * default direction can never drift per-callsite.
   */
  public static canWrite(accessLevel: string | undefined | null): boolean {
    return accessLevel === RunbookAgentAccessLevel.ReadWrite;
  }
}
