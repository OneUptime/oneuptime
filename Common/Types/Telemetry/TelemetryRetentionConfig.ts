import LogSeverity from "../Log/LogSeverity";
import { SpanStatus } from "../../Models/AnalyticsModels/Span";

/*
 * Per-pillar telemetry retention overrides.
 *
 * Lives on Project (project-wide defaults) and Service (per-service overrides).
 * When a row is ingested, retention falls through, narrowest-first:
 *   1. service[pillar].byX[bucketKey]
 *   2. service[pillar].default
 *   3. service.retainTelemetryDataForDays               (umbrella)
 *   4. project[pillar].byX[bucketKey]
 *   5. project[pillar].default
 *   6. project.defaultTelemetryRetentionInDays           (umbrella)
 *   7. HARDCODED_DEFAULT_TELEMETRY_RETENTION_IN_DAYS
 */
export default interface TelemetryRetentionConfig {
  logs?: {
    default?: number | null;
    bySeverity?: Partial<Record<LogSeverity, number | null>>;
  };
  traces?: {
    default?: number | null;
    byStatus?: Partial<Record<SpanStatus, number | null>>;
  };
  metrics?: {
    default?: number | null;
  };
  profiles?: {
    default?: number | null;
  };
}

export type TelemetryPillar = "logs" | "traces" | "metrics" | "profiles";

export const HARDCODED_DEFAULT_TELEMETRY_RETENTION_IN_DAYS: number = 15;

function pickPositive(value: number | null | undefined): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

function getBucketValue(
  config: TelemetryRetentionConfig | null | undefined,
  pillar: TelemetryPillar,
  bucketKey: LogSeverity | SpanStatus | null | undefined,
): number | null {
  if (!config || bucketKey === undefined || bucketKey === null) {
    return null;
  }
  if (pillar === "logs") {
    const bySeverity: Partial<Record<LogSeverity, number | null>> | undefined =
      config.logs?.bySeverity;
    return pickPositive(bySeverity?.[bucketKey as LogSeverity]);
  }
  if (pillar === "traces") {
    const byStatus: Partial<Record<SpanStatus, number | null>> | undefined =
      config.traces?.byStatus;
    return pickPositive(byStatus?.[bucketKey as SpanStatus]);
  }
  return null;
}

function getPillarDefault(
  config: TelemetryRetentionConfig | null | undefined,
  pillar: TelemetryPillar,
): number | null {
  if (!config) {
    return null;
  }
  return pickPositive(config[pillar]?.default);
}

export function resolveTelemetryRetentionInDays(input: {
  pillar: TelemetryPillar;
  bucketKey?: LogSeverity | SpanStatus | null;
  serviceConfig?: TelemetryRetentionConfig | null;
  serviceUmbrellaInDays?: number | null;
  projectConfig?: TelemetryRetentionConfig | null;
  projectUmbrellaInDays?: number | null;
}): number {
  const {
    pillar,
    bucketKey,
    serviceConfig,
    serviceUmbrellaInDays,
    projectConfig,
    projectUmbrellaInDays,
  } = input;

  const candidates: Array<number | null> = [
    getBucketValue(serviceConfig, pillar, bucketKey),
    getPillarDefault(serviceConfig, pillar),
    pickPositive(serviceUmbrellaInDays),
    getBucketValue(projectConfig, pillar, bucketKey),
    getPillarDefault(projectConfig, pillar),
    pickPositive(projectUmbrellaInDays),
  ];

  for (const value of candidates) {
    if (value !== null) {
      return value;
    }
  }
  return HARDCODED_DEFAULT_TELEMETRY_RETENTION_IN_DAYS;
}
