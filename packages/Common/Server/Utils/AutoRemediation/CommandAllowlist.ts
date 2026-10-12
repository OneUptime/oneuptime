/*
 * A rule's command allowlist, as everything that acts on it reads it.
 *
 * The column is jsonb, and the dashboard's JSON field can save it as either
 * a real array or a JSON string containing one; an operator who typed one
 * pattern without brackets saved a bare string. The run reads all three
 * (RemediationExecutionRunner), and so must every check that asks whether a
 * rule runs commands without asking (AiRemediationCredentialUse) - or a
 * string would read as no allowlist to the check and as one to the run.
 * Anything that is not a usable pattern list reads as empty: nothing
 * auto-executes, the safe direction.
 *
 * No imports: the runner and the rule service's checks both use it, and the
 * runner reaches the rule service.
 */
export default class CommandAllowlist {
  // The non-empty patterns `value` holds, trimmed, in order.
  public static normalize(value: unknown): Array<string> {
    let raw: unknown = value;

    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        /*
         * Not JSON - a bare string is a single pattern, so an operator who
         * typed one pattern without brackets still gets what they meant.
         */
        raw = [value];
      }
    }

    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .filter((pattern: unknown): pattern is string => {
        return typeof pattern === "string" && pattern.trim().length > 0;
      })
      .map((pattern: string): string => {
        return pattern.trim();
      });
  }
}
