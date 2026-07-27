/*
 * Which class of environment a Runbook Agent lives in. This is the anchor for
 * graduated AI autonomy: AI-proposed remediations may only auto-execute on
 * agents explicitly tagged as non-production (and only when the project opted
 * in). An untagged or unknown agent is treated as Production — the fail-safe
 * direction — so nothing auto-runs anywhere until a human has deliberately
 * said "this agent is a test box".
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
