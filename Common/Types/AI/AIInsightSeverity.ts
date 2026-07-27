/*
 * How urgent a AIInsight is, assigned deterministically by the
 * detector that produced it (e.g. by spike/regression multiplier). Stored
 * on AIInsight.severity and rendered/filtered in the dashboard, so
 * these strings are a wire contract — do not rename them.
 */
enum AIInsightSeverity {
  High = "High",
  Medium = "Medium",
  Low = "Low",
}

export default AIInsightSeverity;

export class AIInsightSeverityHelper {
  /*
   * Explicit urgency order — higher rank = more urgent. Kept as an explicit
   * table (never string comparison or enum declaration order) because these
   * ranks gate paging decisions: "High" < "Low" alphabetically, so a lexical
   * compare would invert the escalation floor.
   */
  private static readonly severityRank: Record<AIInsightSeverity, number> = {
    [AIInsightSeverity.Low]: 1,
    [AIInsightSeverity.Medium]: 2,
    [AIInsightSeverity.High]: 3,
  };

  public static getRank(severity: AIInsightSeverity): number {
    return this.severityRank[severity];
  }

  /*
   * Parse a stored severity string (e.g. the free-text ShortText column
   * Project.aiInsightEscalationMinimumSeverity). Unknown or unset values
   * return undefined so the caller applies its own fail-safe default.
   */
  public static fromString(
    value: string | undefined | null,
  ): AIInsightSeverity | undefined {
    if (Object.values(AIInsightSeverity).includes(value as AIInsightSeverity)) {
      return value as AIInsightSeverity;
    }
    return undefined;
  }

  // True when `severity` is at least as urgent as `minimum`.
  public static isAtLeast(
    severity: AIInsightSeverity,
    minimum: AIInsightSeverity,
  ): boolean {
    return this.getRank(severity) >= this.getRank(minimum);
  }
}
