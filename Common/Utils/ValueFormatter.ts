/*
 * Human-friendly value formatting for metric units.
 * Converts raw values like 1048576 bytes → "1 MB", 3661 seconds → "1.02 hr", etc.
 */

export interface FormattedValue {
  value: string; // e.g. "1.5"
  unit: string; // e.g. "MB"
  formatted: string; // e.g. "1.5 MB"
}

type UnitThreshold = {
  threshold: number;
  unit: string;
  divisor: number;
};

const byteUnits: Array<UnitThreshold> = [
  { threshold: 1e15, unit: "PB", divisor: 1e15 },
  { threshold: 1e12, unit: "TB", divisor: 1e12 },
  { threshold: 1e9, unit: "GB", divisor: 1e9 },
  { threshold: 1e6, unit: "MB", divisor: 1e6 },
  { threshold: 1e3, unit: "KB", divisor: 1e3 },
  { threshold: 0, unit: "B", divisor: 1 },
];

const secondUnits: Array<UnitThreshold> = [
  { threshold: 86400, unit: "d", divisor: 86400 },
  { threshold: 3600, unit: "hr", divisor: 3600 },
  { threshold: 60, unit: "min", divisor: 60 },
  { threshold: 1, unit: "s", divisor: 1 },
  { threshold: 0.001, unit: "ms", divisor: 0.001 },
  { threshold: 0.000001, unit: "µs", divisor: 0.000001 },
  { threshold: 0, unit: "ns", divisor: 0.000000001 },
];

const millisecondUnits: Array<UnitThreshold> = [
  { threshold: 86400000, unit: "d", divisor: 86400000 },
  { threshold: 3600000, unit: "hr", divisor: 3600000 },
  { threshold: 60000, unit: "min", divisor: 60000 },
  { threshold: 1000, unit: "s", divisor: 1000 },
  { threshold: 1, unit: "ms", divisor: 1 },
  { threshold: 0.001, unit: "µs", divisor: 0.001 },
  { threshold: 0, unit: "ns", divisor: 0.000001 },
];

const microsecondUnits: Array<UnitThreshold> = [
  { threshold: 1e6, unit: "s", divisor: 1e6 },
  { threshold: 1e3, unit: "ms", divisor: 1e3 },
  { threshold: 1, unit: "µs", divisor: 1 },
  { threshold: 0, unit: "ns", divisor: 0.001 },
];

const nanosecondUnits: Array<UnitThreshold> = [
  { threshold: 1e9, unit: "s", divisor: 1e9 },
  { threshold: 1e6, unit: "ms", divisor: 1e6 },
  { threshold: 1e3, unit: "µs", divisor: 1e3 },
  { threshold: 0, unit: "ns", divisor: 1 },
];

// Maps common metric unit strings to their scaling table
const unitTableMap: Record<string, Array<UnitThreshold>> = {
  // Byte variants
  bytes: byteUnits,
  byte: byteUnits,
  by: byteUnits,
  b: byteUnits,

  // Second variants
  seconds: secondUnits,
  second: secondUnits,
  sec: secondUnits,
  s: secondUnits,

  // Millisecond variants
  milliseconds: millisecondUnits,
  millisecond: millisecondUnits,
  ms: millisecondUnits,

  // Microsecond variants
  microseconds: microsecondUnits,
  microsecond: microsecondUnits,
  us: microsecondUnits,
  µs: microsecondUnits,

  // Nanosecond variants
  nanoseconds: nanosecondUnits,
  nanosecond: nanosecondUnits,
  ns: nanosecondUnits,
};

function formatWithThresholds(
  value: number,
  thresholds: Array<UnitThreshold>,
): FormattedValue {
  const absValue: number = Math.abs(value);

  for (const t of thresholds) {
    if (absValue >= t.threshold) {
      const scaled: number = value / t.divisor;
      const formatted: string = formatNumber(scaled);
      return {
        value: formatted,
        unit: t.unit,
        formatted: `${formatted} ${t.unit}`,
      };
    }
  }

  // Fallback: use last threshold
  const last: UnitThreshold = thresholds[thresholds.length - 1]!;
  const scaled: number = value / last.divisor;
  const formatted: string = formatNumber(scaled);
  return {
    value: formatted,
    unit: last.unit,
    formatted: `${formatted} ${last.unit}`,
  };
}

function formatNumber(value: number): string {
  if (value === 0) {
    return "0";
  }

  const absValue: number = Math.abs(value);

  if (absValue >= 100) {
    return Math.round(value).toString();
  }

  if (absValue >= 10) {
    return (Math.round(value * 10) / 10).toString();
  }

  return (Math.round(value * 100) / 100).toString();
}

export default class ValueFormatter {
  /*
   * Format a value with a unit into a human-friendly string.
   * e.g. formatValue(1048576, "bytes") → "1 MB"
   * e.g. formatValue(3661, "seconds") → "1.02 hr"
   * e.g. formatValue(42, "%") → "42 %"  (passthrough for unknown units)
   */
  public static formatValue(value: number, unit: string): string {
    if (!unit || unit.trim() === "") {
      return formatNumber(value);
    }

    const normalizedUnit: string = unit.trim().toLowerCase();
    const thresholds: Array<UnitThreshold> | undefined =
      unitTableMap[normalizedUnit];

    if (thresholds) {
      return formatWithThresholds(value, thresholds).formatted;
    }

    // Unknown unit — just format the number and append the unit as-is
    return `${formatNumber(value)} ${unit}`;
  }

  // Check if a unit is one we can auto-scale (bytes, seconds, etc.)
  public static isScalableUnit(unit: string): boolean {
    if (!unit || unit.trim() === "") {
      return false;
    }
    return unitTableMap[unit.trim().toLowerCase()] !== undefined;
  }
}
