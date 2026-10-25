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
  /*
   * Exceptions without a stack trace: a service whose exceptions over the
   * last day were recorded with no stack trace at all, so nobody - and no
   * AI - can tell which of its code raised them (Utils/Exceptions/
   * ExceptionInsight's gates). Filed for the Exceptions product's AI
   * section (Types/AI/TelemetryAi), whose pull request makes the service
   * record a stack trace with each exception.
   */
  ExceptionMissingStackTrace = "ExceptionMissingStackTrace",
  /*
   * An error log: one message a service logged again and again at Error or
   * Fatal severity over the last hour (Utils/Logs/LogInsight's gates) that
   * carries no exception - an error that does is the Exceptions product's.
   * Filed for the Logs product's AI section (Types/AI/TelemetryAi), with the
   * message's pattern as its evidence.
   */
  LogErrorPattern = "LogErrorPattern",
  /*
   * Missing logging: what a service's logs do not say - requests that fail
   * without writing a single log line, or logs that carry no trace context,
   * so a request's logs cannot be read beside its trace.
   */
  LogMissingLogging = "LogMissingLogging",
  /*
   * A noisy log: one message below Error severity that makes up a large
   * share of a service's logs - it costs storage and buries the lines that
   * matter.
   */
  LogNoisyPattern = "LogNoisyPattern",
  /*
   * A high-cardinality metric: an attribute a service's code puts on one of
   * its metrics took so many values over the last hour (ids, full URLs,
   * timestamps) that every value is a series of its own - or a service's
   * metric names carry an id, so each id is a metric of its own (Utils/
   * Metrics/MetricInsight's gates). Filed for the Metrics product's AI
   * section (Types/AI/TelemetryAi), with the attribute or the name pattern
   * as its evidence.
   */
  MetricHighCardinality = "MetricHighCardinality",
  /*
   * A histogram whose buckets do not fit the values it records: nearly all
   * of them fall in its smallest bucket or above its largest one (or it
   * has no buckets at all), so none of its percentiles can be read.
   */
  MetricHistogramBuckets = "MetricHistogramBuckets",
  /*
   * Missing metrics: a busy service that sends traces but has never sent a
   * metric, so nothing charts or alerts on its request rate, errors or
   * latency over time without reading every span.
   */
  MetricMissingMetrics = "MetricMissingMetrics",
}

export default AIInsightType;
