import StorageArrayResourceKind, {
  StorageArrayResourceKindUtil,
} from "Common/Types/StorageArray/StorageArrayResourceKind";
import {
  STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES,
  STORAGE_ARRAY_HARDWARE_WIDGET_KINDS,
  STORAGE_ARRAY_WARNING_COMPONENT_STATUSES,
} from "Common/Utils/Dashboard/Components/DashboardStorageArrayResourceListShared";

/*
 * Pure, React-free helpers behind the Storage Array volume and hardware
 * dashboard widgets: how a volume's latency and a component's status are
 * banded and colored, and how Pure's numbers are written. Kept out of the
 * .tsx files so the banding — the part an operator acts on — is unit-tested
 * in the node test environment.
 */

export interface StorageArrayWidgetState {
  // English; the honeycomb translates a tile's status where it draws it.
  text: string;
  color: string;
  textColor: string;
}

const TEXT_COLORS: {
  success: string;
  warning: string;
  danger: string;
  secondary: string;
  muted: string;
} = {
  success: "var(--ou-success-text, #047857)",
  warning: "var(--ou-warning-text, #b45309)",
  danger: "var(--ou-danger-text, #b91c1c)",
  secondary: "var(--ou-text-secondary, #4b5563)",
  muted: "var(--ou-text-muted, #6b7280)",
};

export function toFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const numeric: number = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

/*
 * ---------------------------------------------------------------------------
 * Volumes
 * ---------------------------------------------------------------------------
 */

/*
 * Latency bands for a volume, in microseconds per operation. The upper
 * threshold is the purefa-read-latency-high / purefa-write-latency-high alert
 * templates' (above 5 ms); the band below it starts at 1 ms, where an
 * all-flash volume is noticeably slower than it should be, so a volume
 * heading for an alert stands out before it fires.
 */
export const VOLUME_LATENCY_SLOW_USEC: number = 1000;
export const VOLUME_LATENCY_HIGH_USEC: number = 5000;

export const VOLUME_LATENCY_COLORS: {
  fast: string;
  slow: string;
  high: string;
  noData: string;
} = {
  fast: "#10b981",
  slow: "#f59e0b",
  high: "#ef4444",
  noData: "#9ca3af",
};

/*
 * The slower of a volume's read and write latency — the one the volume's
 * users feel. Undefined when the array reported neither.
 */
export function getVolumeWorstLatencyUsec(
  readLatencyUsec: unknown,
  writeLatencyUsec: unknown,
): number | undefined {
  const candidates: Array<number> = [
    toFiniteNumber(readLatencyUsec),
    toFiniteNumber(writeLatencyUsec),
  ].filter((value: number | undefined): value is number => {
    return value !== undefined;
  });

  if (candidates.length === 0) {
    return undefined;
  }

  return Math.max(...candidates);
}

export function getVolumeLatencyState(
  readLatencyUsec: unknown,
  writeLatencyUsec: unknown,
): StorageArrayWidgetState {
  const worst: number | undefined = getVolumeWorstLatencyUsec(
    readLatencyUsec,
    writeLatencyUsec,
  );

  if (worst === undefined) {
    return {
      text: "No data",
      color: VOLUME_LATENCY_COLORS.noData,
      textColor: TEXT_COLORS.muted,
    };
  }
  if (worst > VOLUME_LATENCY_HIGH_USEC) {
    return {
      text: "Over 5 ms",
      color: VOLUME_LATENCY_COLORS.high,
      textColor: TEXT_COLORS.danger,
    };
  }
  if (worst >= VOLUME_LATENCY_SLOW_USEC) {
    return {
      text: "1–5 ms",
      color: VOLUME_LATENCY_COLORS.slow,
      textColor: TEXT_COLORS.warning,
    };
  }
  return {
    text: "Under 1 ms",
    color: VOLUME_LATENCY_COLORS.fast,
    textColor: TEXT_COLORS.success,
  };
}

/*
 * Pure reports latency in microseconds. Below a millisecond the µs figure is
 * the readable one ("420 µs"); from a millisecond up, milliseconds are
 * ("2.35 ms").
 */
export function formatLatencyUsec(value: unknown): string {
  const numeric: number | undefined = toFiniteNumber(value);
  if (numeric === undefined) {
    return "—";
  }
  if (numeric < 1000) {
    return `${Math.round(numeric)} µs`;
  }
  return `${(numeric / 1000).toFixed(2)} ms`;
}

// Read plus write operations per second; undefined when neither is known.
export function getTotalIops(
  readIops: unknown,
  writeIops: unknown,
): number | undefined {
  const read: number | undefined = toFiniteNumber(readIops);
  const write: number | undefined = toFiniteNumber(writeIops);
  if (read === undefined && write === undefined) {
    return undefined;
  }
  return (read || 0) + (write || 0);
}

export function formatIops(value: unknown): string {
  const numeric: number | undefined = toFiniteNumber(value);
  if (numeric === undefined) {
    return "—";
  }
  if (numeric >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(1)}M`;
  }
  if (numeric >= 1_000) {
    return `${(numeric / 1_000).toFixed(1)}K`;
  }
  return String(Math.round(numeric));
}

/*
 * Bytes in binary units, up to PiB: array volumes and drives run to tens of
 * terabytes, past where the generic memory formatter stops at GB.
 */
export function formatStorageBytes(value: unknown): string {
  const numeric: number | undefined = toFiniteNumber(value);
  if (numeric === undefined) {
    return "—";
  }
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let scaled: number = numeric;
  let unitIndex: number = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled = scaled / 1024;
    unitIndex++;
  }
  return `${scaled.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/*
 * ---------------------------------------------------------------------------
 * Hardware components, drives and controllers
 * ---------------------------------------------------------------------------
 */

/*
 * Statuses that read as healthy — hardware `ok`, drives `healthy`,
 * controllers `ready` — the same list the Storage Arrays pages color green
 * (StorageArrayResourceUtils.HEALTHY_RESOURCE_STATUSES), so a component is
 * the same color on a dashboard as on its array's Hardware page.
 */
export const STORAGE_ARRAY_HEALTHY_COMPONENT_STATUSES: ReadonlyArray<string> = [
  "ok",
  "healthy",
  "ready",
  "enabled",
  "online",
  "replicating",
];

export const HARDWARE_STATUS_COLORS: {
  healthy: string;
  warning: string;
  critical: string;
  other: string;
  noStatus: string;
} = {
  healthy: "#10b981",
  warning: "#f59e0b",
  critical: "#ef4444",
  other: "#6b7280",
  noStatus: "#d1d5db",
};

export function normalizeComponentStatus(status: unknown): string | null {
  if (typeof status !== "string") {
    return null;
  }
  const normalized: string = status.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/*
 * The band a component's status falls in, by the same split the array's own
 * health is derived with: a critical status makes the array Critical, a
 * warning status makes it Warning. The expected states in between — not
 * installed, switched off, an empty bay, unused, a locator light on — need
 * nobody, and are gray rather than green so they do not read as working
 * parts.
 */
export function getHardwareStatusState(
  status: unknown,
): StorageArrayWidgetState {
  const normalized: string | null = normalizeComponentStatus(status);

  if (normalized === null) {
    return {
      text: "No status",
      color: HARDWARE_STATUS_COLORS.noStatus,
      textColor: TEXT_COLORS.muted,
    };
  }
  if (STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES.includes(normalized)) {
    return {
      text: "Critical",
      color: HARDWARE_STATUS_COLORS.critical,
      textColor: TEXT_COLORS.danger,
    };
  }
  if (STORAGE_ARRAY_WARNING_COMPONENT_STATUSES.includes(normalized)) {
    return {
      text: "Warning",
      color: HARDWARE_STATUS_COLORS.warning,
      textColor: TEXT_COLORS.warning,
    };
  }
  if (STORAGE_ARRAY_HEALTHY_COMPONENT_STATUSES.includes(normalized)) {
    return {
      text: "Healthy",
      color: HARDWARE_STATUS_COLORS.healthy,
      textColor: TEXT_COLORS.success,
    };
  }
  return {
    text: "Other",
    color: HARDWARE_STATUS_COLORS.other,
    textColor: TEXT_COLORS.secondary,
  };
}

/*
 * A status or component type as the array writes it ("not_installed",
 * "power_supply", "not ready", "SSD") made readable the way the Storage
 * Arrays pages write it ("Not Installed", "Power Supply", "Not Ready",
 * "SSD"): each word capitalized, a word already in capitals kept, "ok" as
 * "OK". The value is the array's own vocabulary, shown as data rather than
 * translated.
 */
export function humanizeArrayValue(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "—";
  }
  const trimmed: string = value.trim();
  if (trimmed.toLowerCase() === "ok") {
    return "OK";
  }
  return trimmed
    .split(/[\s_]+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .map((word: string): string => {
      if (word !== word.toLowerCase()) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/*
 * The singular name of an inventory kind ("Hardware Component", "Drive",
 * "Controller"); a kind the widget does not list falls back to the raw value.
 */
export function getHardwareKindLabel(kind: unknown): string {
  if (
    typeof kind === "string" &&
    STORAGE_ARRAY_HARDWARE_WIDGET_KINDS.includes(
      kind as StorageArrayResourceKind,
    )
  ) {
    return StorageArrayResourceKindUtil.getSingularLabel(
      kind as StorageArrayResourceKind,
    );
  }
  return typeof kind === "string" && kind.length > 0 ? kind : "—";
}

/*
 * What a component is. A hardware component is named by its own type
 * ("Power supply", "Temp sensor"), which says more than "Hardware
 * Component"; a drive or controller keeps its kind in front of its type
 * ("Drive · SSD").
 */
export function getHardwareTypeText(input: {
  kind?: unknown;
  componentType?: unknown;
}): string {
  const kindLabel: string = getHardwareKindLabel(input.kind);
  const hasType: boolean =
    typeof input.componentType === "string" &&
    input.componentType.trim().length > 0;

  if (!hasType) {
    return kindLabel;
  }

  const typeText: string = humanizeArrayValue(input.componentType);

  if (input.kind === StorageArrayResourceKind.Hardware) {
    return typeText;
  }

  return `${kindLabel} · ${typeText}`;
}

export interface HardwareDetailInput {
  kind?: unknown;
  componentType?: unknown;
  statusDetail?: unknown;
  model?: unknown;
  capacityBytes?: unknown;
  temperatureCelsius?: unknown;
}

/*
 * The one figure worth a column for each kind: a drive's size, a
 * controller's mode and model, a hardware component's temperature. Values
 * the array did not report are left out rather than shown as dashes.
 */
export function getHardwareDetail(input: HardwareDetailInput): string {
  const parts: Array<string> = [];

  if (input.kind === StorageArrayResourceKind.Drive) {
    const capacity: number | undefined = toFiniteNumber(input.capacityBytes);
    if (capacity !== undefined) {
      parts.push(formatStorageBytes(capacity));
    }
  } else if (input.kind === StorageArrayResourceKind.Controller) {
    if (typeof input.statusDetail === "string" && input.statusDetail) {
      parts.push(input.statusDetail);
    }
    if (typeof input.model === "string" && input.model) {
      parts.push(input.model);
    }
  } else {
    const temperature: number | undefined = toFiniteNumber(
      input.temperatureCelsius,
    );
    if (temperature !== undefined) {
      parts.push(`${Math.round(temperature)} °C`);
    }
  }

  return parts.length > 0 ? parts.join(" · ") : "—";
}
