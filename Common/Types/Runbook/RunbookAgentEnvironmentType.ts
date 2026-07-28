/*
 * Which class of environment a Runbook Agent lives in — INFORMATIONAL
 * context for humans, shown as a badge wherever the agent appears (notably
 * on AI remediation proposals, so an approver sees at a glance that a
 * command targets production).
 *
 * It does NOT gate AI autonomy. Two other things do: Auto Remediation Rules
 * decide whether unattended execution is authorized for a given
 * incident/alert, and RunbookAgent.accessLevel decides whether AI may WRITE
 * through a given agent. The isProduction helper below exists only so the
 * badge renders an untagged agent conservatively.
 */
enum RunbookAgentEnvironmentType {
  Production = "Production",
  Staging = "Staging",
  Testing = "Testing",
  Development = "Development",
}

export default RunbookAgentEnvironmentType;

export class RunbookAgentEnvironmentTypeHelper {
  /*
   * The fail-safe read: anything unset, unknown, or unparseable counts as
   * Production. Every autonomy decision must route through this helper so the
   * default direction can never drift per-callsite.
   */
  public static isProduction(
    environmentType: string | undefined | null,
  ): boolean {
    if (!environmentType) {
      return true;
    }

    return (
      environmentType !== RunbookAgentEnvironmentType.Staging &&
      environmentType !== RunbookAgentEnvironmentType.Testing &&
      environmentType !== RunbookAgentEnvironmentType.Development
    );
  }
}
