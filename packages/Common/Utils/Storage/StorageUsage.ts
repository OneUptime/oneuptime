import { formatReaderFigure } from "../../Types/DateLanguage";

/*
 * HOW FULL A STORE IS: A VOLUME, A DISK, A POOL, A DATASTORE.
 *
 * Every storage page answers the same three questions - how much is used,
 * how much is free, how big it is - and the one that matters most: is it
 * about to fill up? A Kubernetes claim's page said only "50Gi", the size
 * it was given (#9539), and the pages that did show a percent each worked
 * it out, coloured it and wrote it their own way, in English digits. This
 * is the one reading they share: the page hands it what the store
 * reports, and draws it with the shared StorageUsageBar.
 *
 * A store reports its capacity and either what is still available to
 * write (a filesystem, the kubelet's volume stats) or what is used (a
 * Proxmox storage, a pool). Given what is available, used is everything
 * else: capacity - available, as `df`'s Avail and the kubernetes-mixin's
 * volume dashboards read it, so "full" means nothing more can be written.
 */

export enum StorageUsageLevel {
  // Plenty of room.
  Normal = "normal",
  // Nearly full: worth a look soon.
  Warning = "warning",
  // Almost out of space: writes will start to fail.
  Critical = "critical",
}

export interface StorageUsageThresholds {
  // The used percent at and above which a store reads as nearly full.
  warningPercent: number;
  // The used percent at and above which it reads as almost out of space.
  criticalPercent: number;
}

/*
 * Nearly full at 80% used, almost out of space at 90%: where storage
 * arrays raise their own capacity alerts, and where the PVC Almost Full
 * monitor template fires (above 90%).
 */
export const DEFAULT_STORAGE_USAGE_THRESHOLDS: StorageUsageThresholds = {
  warningPercent: 80,
  criticalPercent: 90,
};

// A reading as it arrives: a number, a bigint column's string, or nothing.
export type StorageReadingValue = number | string | null | undefined;

export interface StorageUsageInput {
  capacity: StorageReadingValue;
  // What can still be written. Wins over `used` when both are given.
  available?: StorageReadingValue;
  used?: StorageReadingValue;
}

export interface StorageUsage {
  capacity: number;
  used: number;
  free: number;
  // How much of the capacity is used, 0 to 100.
  usedPercent: number;
  level: StorageUsageLevel;
}

export function readStorageNumber(value: StorageReadingValue): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

export function getStorageUsageLevel(
  usedPercent: number,
  thresholds: StorageUsageThresholds = DEFAULT_STORAGE_USAGE_THRESHOLDS,
): StorageUsageLevel {
  if (usedPercent >= thresholds.criticalPercent) {
    return StorageUsageLevel.Critical;
  }

  if (usedPercent >= thresholds.warningPercent) {
    return StorageUsageLevel.Warning;
  }

  return StorageUsageLevel.Normal;
}

/*
 * The reading, or null when the store reported no capacity (or none above
 * zero) or neither what is available nor what is used: a page then says no
 * usage was reported, never 0%.
 */
export function getStorageUsage(
  input: StorageUsageInput,
  thresholds: StorageUsageThresholds = DEFAULT_STORAGE_USAGE_THRESHOLDS,
): StorageUsage | null {
  const capacity: number | null = readStorageNumber(input.capacity);

  if (capacity === null || capacity <= 0) {
    return null;
  }

  const available: number | null = readStorageNumber(input.available);
  const reportedUsed: number | null = readStorageNumber(input.used);

  let free: number;

  if (available !== null) {
    free = Math.min(Math.max(available, 0), capacity);
  } else if (reportedUsed !== null) {
    // Thin-provisioned stores can report more used than they hold.
    free = capacity - Math.min(Math.max(reportedUsed, 0), capacity);
  } else {
    return null;
  }

  const used: number = capacity - free;
  const usedPercent: number = (used / capacity) * 100;

  return {
    capacity: capacity,
    used: used,
    free: free,
    usedPercent: usedPercent,
    level: getStorageUsageLevel(usedPercent, thresholds),
  };
}

/*
 * The percent a page writes: whole, and rounded down, so 100% means
 * nothing at all is left and 89.9% never reads as a full 90% - the level
 * changes at exactly the figure that is written.
 */
export function getStorageUsedPercentFigure(usage: StorageUsage): number {
  return Math.floor(usage.usedPercent);
}

export function formatStorageUsedPercent(
  usage: StorageUsage,
  language?: string | undefined,
): string {
  return formatReaderFigure(getStorageUsedPercentFigure(usage), {
    decimals: 0,
    isPercent: true,
    language: language,
  });
}

const BINARY_UNITS: ReadonlyArray<string> = [
  "KiB",
  "MiB",
  "GiB",
  "TiB",
  "PiB",
  "EiB",
];

/*
 * An amount of storage in binary units, as Kubernetes sizes a volume (50Gi
 * is 50 GiB) and as `df -h` writes it: "36.2 GiB", "512 GiB", "1.5 TiB".
 * The number is in the reader's digits ("۳۶٫۲ GiB", "36,2 GiB"), held to its
 * unit by a no-break space. One decimal below 100, none from there.
 */
export function formatStorageBytes(
  bytes: number,
  language?: string | undefined,
): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    const whole: number = Number.isFinite(bytes)
      ? Math.max(0, Math.round(bytes))
      : 0;

    return `${formatReaderFigure(whole, { decimals: 0, language: language })}\u00A0B`;
  }

  let value: number = bytes / 1024;
  let unitIndex: number = 0;

  while (value >= 1024 && unitIndex < BINARY_UNITS.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  // 1023.96 KiB written with one decimal reads 1024.0: it is the next unit.
  if (Number(value.toFixed(1)) >= 1024 && unitIndex < BINARY_UNITS.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  const unit: string = BINARY_UNITS[unitIndex] || "EiB";

  return `${formatReaderFigure(value, {
    decimals: value >= 100 ? 0 : 1,
    dropTrailingZeros: true,
    language: language,
  })}\u00A0${unit}`;
}

/*
 * A count of inodes, compact: "1.2M", "830K", "512". The reader's digits,
 * the scale letter kept, as a chart writes a count.
 */
export function formatStorageCount(
  count: number,
  language?: string | undefined,
): string {
  const whole: number = Number.isFinite(count) ? Math.max(0, count) : 0;
  const scales: ReadonlyArray<{ divisor: number; letter: string }> = [
    { divisor: 1e12, letter: "T" },
    { divisor: 1e9, letter: "B" },
    { divisor: 1e6, letter: "M" },
    { divisor: 1e3, letter: "K" },
  ];

  for (const scale of scales) {
    if (whole >= scale.divisor) {
      const value: number = whole / scale.divisor;

      return `${formatReaderFigure(value, {
        decimals: value >= 100 ? 0 : 1,
        dropTrailingZeros: true,
        language: language,
      })}${scale.letter}`;
    }
  }

  return formatReaderFigure(Math.round(whole), {
    decimals: 0,
    language: language,
  });
}
