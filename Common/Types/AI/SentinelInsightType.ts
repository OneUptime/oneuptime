/*
 * Which deterministic Sentinel detector produced an insight. Detectors are
 * statistical sensors over the project's telemetry — no LLM is involved in
 * detection. These strings are stored on SentinelInsight.insightType and
 * rendered/filtered in the dashboard, so they are a wire contract — do not
 * rename them.
 */
enum SentinelInsightType {
  /*
   * A telemetry exception first seen within the last 24 hours that is
   * already recurring (not resolved, not archived) — a brand-new failure
   * mode in the code.
   */
  NewException = "NewException",
  /*
   * An established telemetry exception whose recent hourly occurrence rate
   * spiked well above its own 24-hour baseline (including dormant
   * exceptions suddenly waking up).
   */
  ExceptionSpike = "ExceptionSpike",
  /*
   * The project's Error/Fatal log volume in the last hour spiked well above
   * its average hourly rate over the prior 24 hours, attributed to the top
   * contributing services.
   */
  ErrorLogSpike = "ErrorLogSpike",
  /*
   * A service's recent p99 span latency regressed to a multiple of its own
   * 24-hour baseline, with span-tree findings drilled from a representative
   * slow trace.
   */
  TraceLatencyRegression = "TraceLatencyRegression",
  /*
   * A metric's mean over the last 7 days drifted substantially from its
   * mean over the prior 7 days (week-over-week comparison per metric name
   * and entity).
   */
  MetricDrift = "MetricDrift",
}

export default SentinelInsightType;
