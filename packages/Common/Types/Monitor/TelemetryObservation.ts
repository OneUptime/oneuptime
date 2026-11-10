/*
 * What a telemetry monitor's check saw, for the Observed column of its
 * Monitoring Logs and the row's View Summary (MonitorLogSummaryUtil): the
 * number its criteria counted - logs, spans, exceptions, profiles, security
 * events, bad AI answers - or, for a metric-backed monitor (Metrics,
 * Kubernetes, Host and the rest), how much data its queries read.
 *
 *   MetricSeries      A grouped metric monitor: its series with data.
 *   MetricDataPoints  An ungrouped one: the data points its queries read.
 *   NoMetricData      Its queries read nothing in the window - the reason a
 *                     metric criteria most often does not match, so it is
 *                     said, not left as a 0.
 */
export enum TelemetryObservationKind {
  Logs = "Logs",
  Spans = "Spans",
  Exceptions = "Exceptions",
  Profiles = "Profiles",
  SecurityEvents = "SecurityEvents",
  BadAiAnswers = "BadAiAnswers",
  MetricSeries = "MetricSeries",
  MetricDataPoints = "MetricDataPoints",
  NoMetricData = "NoMetricData",
}

export default interface TelemetryObservation {
  kind: TelemetryObservationKind;
  // 0 for NoMetricData.
  count: number;
}
