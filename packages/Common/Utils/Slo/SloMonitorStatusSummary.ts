import Color from "../../Types/Color";

/**
 * The "how are this SLO's monitors doing right now?" rollup behind the
 * overview's monitors card: one distribution for the stacked bar, and the
 * monitors ordered so the ones that need attention come first.
 *
 * Monitor statuses are project-defined — names, colours and priorities
 * vary — so the bar groups by each status's semantic flags
 * (isOperationalState / isOfflineState) rather than by a hardcoded name,
 * while the rows keep each status's own name and colour.
 *
 * A monitor with active monitoring disabled (by hand, by a manual incident
 * or by scheduled maintenance) is Paused whatever its last status says: the
 * SLO worker ignores it, and a stale "Offline" on it would send someone to
 * investigate a monitor nobody is measuring.
 *
 * React-free and structural (no database model import) so every ordering
 * rule is unit-testable with plain objects.
 */

export enum SloMonitorStatusTone {
  Operational = "Operational",
  Degraded = "Degraded",
  Offline = "Offline",
  Unknown = "Unknown",
  Paused = "Paused",
}

export interface SloMonitorStatusInput {
  id: string;
  name: string;
  statusName?: string | undefined | null;
  statusColor?: Color | undefined | null;
  isOperationalState?: boolean | undefined | null;
  isOfflineState?: boolean | undefined | null;
  statusPriority?: number | undefined | null;
  isMonitoringPaused?: boolean | undefined | null;
}

export interface SloMonitorStatusRow extends SloMonitorStatusInput {
  tone: SloMonitorStatusTone;
  /** The status name to show — "Paused" / "Unknown" when that is the truth. */
  statusLabel: string;
}

export interface SloMonitorStatusSegment {
  key: string;
  label: string;
  tone: SloMonitorStatusTone;
  count: number;
}

export interface SloMonitorStatusSummary {
  total: number;
  /** Measured monitors in a non-operational or unknown status. */
  needsAttentionCount: number;
  pausedCount: number;
  /** Bar segments, healthy first, then by severity. */
  segments: Array<SloMonitorStatusSegment>;
  /** Every monitor, most urgent first. */
  rows: Array<SloMonitorStatusRow>;
}

/** Left-to-right order of the bar: healthy first, then worsening, then unmeasured. */
const SEGMENT_ORDER: Record<SloMonitorStatusTone, number> = {
  [SloMonitorStatusTone.Operational]: 0,
  [SloMonitorStatusTone.Degraded]: 1,
  [SloMonitorStatusTone.Offline]: 2,
  [SloMonitorStatusTone.Unknown]: 3,
  [SloMonitorStatusTone.Paused]: 4,
};

/** Top-to-bottom order of the rows: what someone should look at first. */
const ROW_ORDER: Record<SloMonitorStatusTone, number> = {
  [SloMonitorStatusTone.Offline]: 0,
  [SloMonitorStatusTone.Degraded]: 1,
  [SloMonitorStatusTone.Unknown]: 2,
  [SloMonitorStatusTone.Paused]: 3,
  [SloMonitorStatusTone.Operational]: 4,
};

const PAUSED_LABEL: string = "Paused";
const UNKNOWN_LABEL: string = "Unknown";

type GetToneFunction = (monitor: SloMonitorStatusInput) => SloMonitorStatusTone;

const getTone: GetToneFunction = (
  monitor: SloMonitorStatusInput,
): SloMonitorStatusTone => {
  if (monitor.isMonitoringPaused) {
    return SloMonitorStatusTone.Paused;
  }

  if (!monitor.statusName) {
    return SloMonitorStatusTone.Unknown;
  }

  if (monitor.isOperationalState) {
    return SloMonitorStatusTone.Operational;
  }

  if (monitor.isOfflineState) {
    return SloMonitorStatusTone.Offline;
  }

  return SloMonitorStatusTone.Degraded;
};

type GetPriorityFunction = (monitor: SloMonitorStatusInput) => number;

// A status without a priority sorts after every status that has one.
const getPriority: GetPriorityFunction = (
  monitor: SloMonitorStatusInput,
): number => {
  return typeof monitor.statusPriority === "number" &&
    isFinite(monitor.statusPriority)
    ? monitor.statusPriority
    : Number.MAX_SAFE_INTEGER;
};

export type GetSloMonitorStatusSummaryFunction = (
  monitors: Array<SloMonitorStatusInput>,
) => SloMonitorStatusSummary;

export const getSloMonitorStatusSummary: GetSloMonitorStatusSummaryFunction = (
  monitors: Array<SloMonitorStatusInput>,
): SloMonitorStatusSummary => {
  const rows: Array<SloMonitorStatusRow> = monitors.map(
    (monitor: SloMonitorStatusInput): SloMonitorStatusRow => {
      const tone: SloMonitorStatusTone = getTone(monitor);

      let statusLabel: string = monitor.statusName || UNKNOWN_LABEL;

      if (tone === SloMonitorStatusTone.Paused) {
        statusLabel = PAUSED_LABEL;
      }

      return { ...monitor, tone: tone, statusLabel: statusLabel };
    },
  );

  const segmentsByKey: Map<string, SloMonitorStatusSegment> = new Map();
  const segmentPriority: Map<string, number> = new Map();

  for (const row of rows) {
    /*
     * Paused and Unknown are one segment each, however many different stale
     * statuses sit underneath them; real statuses get a segment per name.
     */
    const key: string =
      row.tone === SloMonitorStatusTone.Paused ||
      row.tone === SloMonitorStatusTone.Unknown
        ? `tone:${row.tone}`
        : `status:${row.tone}:${row.statusLabel}`;

    const existing: SloMonitorStatusSegment | undefined =
      segmentsByKey.get(key);

    if (existing) {
      existing.count += 1;
      continue;
    }

    segmentsByKey.set(key, {
      key: key,
      label: row.statusLabel,
      tone: row.tone,
      count: 1,
    });
    segmentPriority.set(key, getPriority(row));
  }

  const segments: Array<SloMonitorStatusSegment> = Array.from(
    segmentsByKey.values(),
  ).sort((a: SloMonitorStatusSegment, b: SloMonitorStatusSegment) => {
    return (
      SEGMENT_ORDER[a.tone] - SEGMENT_ORDER[b.tone] ||
      (segmentPriority.get(a.key) ?? 0) - (segmentPriority.get(b.key) ?? 0) ||
      a.label.localeCompare(b.label)
    );
  });

  rows.sort((a: SloMonitorStatusRow, b: SloMonitorStatusRow) => {
    return (
      ROW_ORDER[a.tone] - ROW_ORDER[b.tone] ||
      getPriority(a) - getPriority(b) ||
      a.name.localeCompare(b.name)
    );
  });

  let pausedCount: number = 0;
  let needsAttentionCount: number = 0;

  for (const row of rows) {
    if (row.tone === SloMonitorStatusTone.Paused) {
      pausedCount += 1;
    } else if (row.tone !== SloMonitorStatusTone.Operational) {
      needsAttentionCount += 1;
    }
  }

  return {
    total: rows.length,
    needsAttentionCount: needsAttentionCount,
    pausedCount: pausedCount,
    segments: segments,
    rows: rows,
  };
};
