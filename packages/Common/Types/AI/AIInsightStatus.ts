/*
 * Lifecycle of a AIInsight. Stored on AIInsight.status and
 * filtered on in the dashboard, so these strings are a wire contract — do
 * not rename them.
 *
 * Detected is the defensive initial state — the scanner routes every newly
 * created insight to ActionRequired or FixOpened in the same tick, so a row
 * only stays Detected if routing crashed mid-scan. Resolved and Dismissed
 * are human actions (the terminal states).
 */
enum AIInsightStatus {
  // Just created by a detector; routed onward in the same scanner tick.
  Detected = "Detected",
  // Waiting on a human: no automatic fix was opened for this insight.
  ActionRequired = "ActionRequired",
  // An AI fix task was queued for this insight (see fixAiRunId).
  FixOpened = "FixOpened",
  // A human marked the insight as handled. Terminal.
  Resolved = "Resolved",
  // A human dismissed the insight as noise/not actionable. Terminal.
  Dismissed = "Dismissed",
}

export default AIInsightStatus;

export class AIInsightStatusHelper {
  /*
   * Terminal = Resolved | Dismissed — the two human end states. The scanner
   * only refreshes (dedupes into) NON-terminal insights; a terminal insight
   * is never reopened by a detector.
   */
  public static isTerminalStatus(status: AIInsightStatus): boolean {
    return (
      status === AIInsightStatus.Resolved ||
      status === AIInsightStatus.Dismissed
    );
  }
}
