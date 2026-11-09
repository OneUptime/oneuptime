import TelemetryIngestionKeyRefusal from "Common/Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import Select from "Common/Types/BaseDatabase/Select";
import {
  TelemetryIngestRefusalReason,
  isTelemetryIngestRefusalReason,
} from "Common/Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";

/*
 * A refusal of telemetry as the Dashboard reads it (issue #6378): one row of
 * TelemetryIngestionKeyRefusal - a key, a reason and the surface that
 * refused it, how many and when - with the key's name and type. Read by the
 * RUM setup check (RumIngestRefusals) and the key's own page.
 */

export interface IngestRefusalFact {
  keyId: string;
  // The key's name; null when the key could not be read.
  keyName: string | null;
  keyType: TelemetryIngestionKeyType | null;
  pinnedServiceName: string | null;
  reason: TelemetryIngestRefusalReason;
  surface: string;
  count: number;
  firstRefusedAt: Date;
  lastRefusedAt: Date;
}

// What a refusal read asks for, its key's name and type included.
export const INGEST_REFUSAL_SELECT: Select<TelemetryIngestionKeyRefusal> = {
  reason: true,
  surface: true,
  refusedCount: true,
  firstRefusedAt: true,
  lastRefusedAt: true,
  telemetryIngestionKeyId: true,
  telemetryIngestionKey: {
    name: true,
    keyType: true,
    pinnedServiceName: true,
  },
};

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date;
}

// A row as the Dashboard reads it, or null for one it cannot read.
export function toIngestRefusalFact(
  row: TelemetryIngestionKeyRefusal,
): IngestRefusalFact | null {
  const reason: unknown = row.reason;
  const firstRefusedAt: Date | null = toDate(row.firstRefusedAt);
  const lastRefusedAt: Date | null = toDate(row.lastRefusedAt);
  const keyId: string = row.telemetryIngestionKeyId?.toString() || "";

  if (!isTelemetryIngestRefusalReason(reason) || !lastRefusedAt || !keyId) {
    return null;
  }

  const keyType: unknown = row.telemetryIngestionKey?.keyType;
  const count: number = Number(row.refusedCount);

  return {
    keyId,
    keyName: row.telemetryIngestionKey?.name || null,
    keyType:
      keyType === TelemetryIngestionKeyType.Browser ||
      keyType === TelemetryIngestionKeyType.Server
        ? keyType
        : null,
    pinnedServiceName: row.telemetryIngestionKey?.pinnedServiceName || null,
    reason,
    surface: String(row.surface || ""),
    count: Number.isFinite(count) && count > 0 ? count : 1,
    firstRefusedAt: firstRefusedAt || lastRefusedAt,
    lastRefusedAt,
  };
}

// Every row a read returned that the Dashboard can read.
export function toIngestRefusalFacts(
  rows: ReadonlyArray<TelemetryIngestionKeyRefusal>,
): Array<IngestRefusalFact> {
  return rows
    .map(toIngestRefusalFact)
    .filter((fact: IngestRefusalFact | null): fact is IngestRefusalFact => {
      return fact !== null;
    });
}
