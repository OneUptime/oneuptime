/*
 * Which deterministic AI detector produced an insight. Detectors are
 * statistical sensors over the project's telemetry — no LLM is involved in
 * detection. These strings are stored on AIInsight.insightType and
 * rendered/filtered in the dashboard, so they are a wire contract — do not
 * rename them.
 */
enum AIInsightType {
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
  /*
   * A service that got measurably worse in the 30 minutes after a recorded
   * deploy (or another recorded change of it) than in the 30 minutes
   * before: more failing spans, a slower p99, more exceptions, or exception
   * types first seen in the version it shipped (ChangeImpact's thresholds).
   */
  DeployRegression = "DeployRegression",
  /*
   * Slow code: a function of a service's own code that takes a large share
   * of the service's time in its profiles, or whose share grew well beyond
   * what it took at the same time the day before (Utils/Profiles/
   * ProfileInsight's gates). Filed for the Profiles product's AI section
   * (Types/AI/TelemetryAi), with the profile as its evidence.
   */
  ProfileHotspot = "ProfileHotspot",
  /*
   * A slow operation in a service's traces: its slowest requests over the
   * last hour repeat a known pattern that costs them real time - the same
   * call made again and again, calls made one after another that could run
   * together, or one call that takes most of the request - by the rule the
   * trace page's "Fix performance with AI" follows (Utils/Traces/
   * TraceInsight's gates). Filed for the Traces product's AI section
   * (Types/AI/TelemetryAi), with the request's findings as its evidence.
   */
  TraceSlowOperation = "TraceSlowOperation",
  /*
   * A failing operation: many of its spans in a service failed over the
   * last hour (an error status), and they said why - the exception or the
   * error message they recorded is the evidence.
   */
  TraceFailingOperation = "TraceFailingOperation",
  /*
   * Missing tracing: a service or an operation whose traces cannot say why
   * it is slow or why it fails - requests with no spans inside them, slow
   * time no span accounts for, or failures that record neither an error
   * message nor an exception.
   */
  TraceMissingTracing = "TraceMissingTracing",
}

export default AIInsightType;
