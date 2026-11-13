/*
 * THE KINDS OF TELEMETRY AN APP PLATFORMS APP SENDS.
 *
 * An App Platforms app (CloudApp) is made from whatever telemetry its
 * instances send - traces, logs, metrics or profiles - and its page draws
 * different numbers from each: requests, error rate and latency from its
 * traces, its instances' CPU and memory from their metrics. So the ingest of
 * each kind marks when it last received that kind for the app, one column
 * each (CLOUD_APP_SIGNAL_COLUMNS, named as a RUM application's are:
 * RumTelemetrySignal), and the page can say "No traces received" where it
 * would otherwise show a zero it never measured (issue #6770: an App Service
 * app that sent only metrics read "Running", "0 requests", "0 instances",
 * with nothing to say why).
 *
 * Shared by the ingest (OtelIngestBaseService, CloudAppService) and the
 * dashboard (CloudAppTelemetrySetup), so the two name the kinds alike.
 */

export enum CloudAppTelemetrySignal {
  Traces = "traces",
  Logs = "logs",
  Metrics = "metrics",
  // Profiles keep the app seen, and have no column of their own on it.
  Profiles = "profiles",
}

export type CloudAppSignalColumn =
  | "tracesLastReceivedAt"
  | "logsLastReceivedAt"
  | "metricsLastReceivedAt";

// The CloudApp column each kind is marked on. Profiles mark none.
export const CLOUD_APP_SIGNAL_COLUMNS: Readonly<
  Partial<Record<CloudAppTelemetrySignal, CloudAppSignalColumn>>
> = {
  [CloudAppTelemetrySignal.Traces]: "tracesLastReceivedAt",
  [CloudAppTelemetrySignal.Logs]: "logsLastReceivedAt",
  [CloudAppTelemetrySignal.Metrics]: "metricsLastReceivedAt",
};

export function getCloudAppSignalColumn(
  signal: CloudAppTelemetrySignal | null | undefined,
): CloudAppSignalColumn | null {
  if (!signal) {
    return null;
  }

  return CLOUD_APP_SIGNAL_COLUMNS[signal] || null;
}
