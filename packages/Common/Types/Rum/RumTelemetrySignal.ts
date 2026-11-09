/*
 * The kinds of OpenTelemetry data a RUM application sends, each with the
 * RumApplication column that says when it last arrived (issue #5770).
 *
 * The OpenTelemetry browser SDK sends traces - page loads, requests - on its
 * own. Logs need a log pipeline and code that writes log records; metrics,
 * Core Web Vitals among them, need a metric pipeline. So an application
 * that reports page loads may well never have sent a log, and the column
 * for that signal, still empty, is what lets its Overview and its Logs page
 * say "logs are not set up" instead of "no data in this time range".
 *
 * Written by the OpenTelemetry ingest path (OtelIngestBaseService, through
 * RumApplicationService.markTelemetrySignalReceived) and read by the
 * Dashboard's RUM setup check. Exceptions have no column: they are rows of
 * their own (TelemetryException), each with its lastSeenAt.
 */

export enum RumTelemetrySignal {
  Traces = "traces",
  Logs = "logs",
  Metrics = "metrics",
}

export type RumTelemetrySignalColumn =
  | "tracesLastReceivedAt"
  | "logsLastReceivedAt"
  | "metricsLastReceivedAt";

export const RUM_TELEMETRY_SIGNAL_COLUMNS: Readonly<
  Record<RumTelemetrySignal, RumTelemetrySignalColumn>
> = {
  [RumTelemetrySignal.Traces]: "tracesLastReceivedAt",
  [RumTelemetrySignal.Logs]: "logsLastReceivedAt",
  [RumTelemetrySignal.Metrics]: "metricsLastReceivedAt",
};
