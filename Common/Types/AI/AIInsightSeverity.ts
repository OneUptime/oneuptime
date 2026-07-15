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
