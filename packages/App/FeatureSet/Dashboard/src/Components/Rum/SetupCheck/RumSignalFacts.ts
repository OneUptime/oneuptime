import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Select from "Common/Types/BaseDatabase/Select";
import {
  WebVitalDefinition,
  WebVitalDefinitions,
} from "Common/Types/Rum/WebVitals";
import isReplayOnlyInstrumented from "../../SessionReplay/RumInstrumentation";
import { RumApplicationArrivalFacts } from "./RumSignalDiagnosis";
import { RumClientKind } from "./RumSignalWords";

/*
 * What a RUM application's own record says about what arrives from it
 * (issue #5770), read for RumSignalDiagnosis. Pure, so a node test reads
 * it; the reads that need the API are in RumSignalReads.
 */

// The application columns the diagnosis reads.
export const RUM_SIGNAL_APPLICATION_SELECT: Select<RumApplication> = {
  lastSeenAt: true,
  otelCollectorStatus: true,
  clientType: true,
  sdkLanguage: true,
  agentVersion: true,
  sessionReplayLastChunkReceivedAt: true,
  tracesLastReceivedAt: true,
  logsLastReceivedAt: true,
  metricsLastReceivedAt: true,
  signalArrivalsTrackedSince: true,
  retainTelemetryDataForDays: true,
};

export function toDateOrNull(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date;
}

// What the diagnosis knows of the application as a whole.
export function getRumApplicationArrivalFacts(
  app: RumApplication,
): RumApplicationArrivalFacts {
  return {
    anythingArrived: Boolean(
      toDateOrNull(app.lastSeenAt) ||
        toDateOrNull(app.sessionReplayLastChunkReceivedAt),
    ),
    replayOnly: isReplayOnlyInstrumented(app),
  };
}

// "browser" or "mobile", as ingest records it; browser until it is known.
export function getRumClientKind(app: RumApplication): RumClientKind {
  return String(app.clientType || "")
    .trim()
    .toLowerCase() === "mobile"
    ? "mobile"
    : "browser";
}

// The application's own telemetry retention, when it has one.
export function getRumRetentionInDays(app: RumApplication): number | null {
  const days: unknown = app.retainTelemetryDataForDays;

  return typeof days === "number" && Number.isFinite(days) && days > 0
    ? days
    : null;
}

// Every metric name a Web Vital is read under (WebVitalDefinitions).
export function getWebVitalMetricNames(): Array<string> {
  return WebVitalDefinitions.flatMap(
    (vital: WebVitalDefinition): Array<string> => {
      return vital.names;
    },
  );
}
