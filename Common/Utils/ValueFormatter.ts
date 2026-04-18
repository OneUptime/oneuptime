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
  { threshold: 86400, unit: "days", divisor: 86400 },
  { threshold: 3600, unit: "hours", divisor: 3600 },
  { threshold: 60, unit: "min", divisor: 60 },
  { threshold: 1, unit: "sec", divisor: 1 },
  { threshold: 0.001, unit: "ms", divisor: 0.001 },
  { threshold: 0.000001, unit: "µs", divisor: 0.000001 },
  { threshold: 0, unit: "ns", divisor: 0.000000001 },
];

const millisecondUnits: Array<UnitThreshold> = [
  { threshold: 86400000, unit: "days", divisor: 86400000 },
  { threshold: 3600000, unit: "hours", divisor: 3600000 },
  { threshold: 60000, unit: "min", divisor: 60000 },
  { threshold: 1000, unit: "sec", divisor: 1000 },
  { threshold: 1, unit: "ms", divisor: 1 },
  { threshold: 0.001, unit: "µs", divisor: 0.001 },
  { threshold: 0, unit: "ns", divisor: 0.000001 },
];

const microsecondUnits: Array<UnitThreshold> = [
  { threshold: 1e6, unit: "sec", divisor: 1e6 },
  { threshold: 1e3, unit: "ms", divisor: 1e3 },
  { threshold: 1, unit: "µs", divisor: 1 },
  { threshold: 0, unit: "ns", divisor: 0.001 },
];

const nanosecondUnits: Array<UnitThreshold> = [
  { threshold: 1e9, unit: "sec", divisor: 1e9 },
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

// Maps UCUM / OpenTelemetry unit codes to human-readable unit names.
// Used for labelling (e.g. badges) where the raw code "By" is hard to read.
const readableUnitMap: Record<string, string> = {
  // Dimensionless — OpenTelemetry uses "1" for unitless counts
  "1": "",

  // Bytes (decimal)
  by: "Bytes",
  byte: "Bytes",
  bytes: "Bytes",
  b: "Bytes",
  kby: "Kilobytes",
  mby: "Megabytes",
  gby: "Gigabytes",
  tby: "Terabytes",
  pby: "Petabytes",

  // Bytes (binary)
  kiby: "Kibibytes",
  miby: "Mebibytes",
  giby: "Gibibytes",
  tiby: "Tebibytes",
  piby: "Pebibytes",

  // Bits
  bit: "Bits",
  bits: "Bits",
  kbit: "Kilobits",
  mbit: "Megabits",
  gbit: "Gigabits",

  // Time
  ns: "Nanoseconds",
  nanosecond: "Nanoseconds",
  nanoseconds: "Nanoseconds",
  us: "Microseconds",
  µs: "Microseconds",
  microsecond: "Microseconds",
  microseconds: "Microseconds",
  ms: "Milliseconds",
  millisecond: "Milliseconds",
  milliseconds: "Milliseconds",
  s: "Seconds",
  sec: "Seconds",
  second: "Seconds",
  seconds: "Seconds",
  min: "Minutes",
  minute: "Minutes",
  minutes: "Minutes",
  h: "Hours",
  hr: "Hours",
  hour: "Hours",
  hours: "Hours",
  d: "Days",
  day: "Days",
  days: "Days",

  // Percent
  "%": "Percent",
  percent: "Percent",

  // Frequency
  hz: "Hertz",
  khz: "Kilohertz",
  mhz: "Megahertz",
  ghz: "Gigahertz",

  // Temperature
  cel: "Celsius",
  "[degf]": "Fahrenheit",
  k: "Kelvin",

  // Electrical
  v: "Volts",
  a: "Amperes",
  w: "Watts",
  kw: "Kilowatts",
  j: "Joules",
};

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase();
}

function getReadableUnitPart(unit: string): string {
  const normalized: string = normalizeUnit(unit);
  if (readableUnitMap[normalized] !== undefined) {
    return readableUnitMap[normalized]!;
  }
  return unit;
}

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
    // OpenTelemetry uses "1" as the dimensionless marker — render as a bare number.
    if (!unit || unit.trim() === "" || unit.trim() === "1") {
      return formatNumber(value);
    }

    const normalizedUnit: string = normalizeUnit(unit);
    const thresholds: Array<UnitThreshold> | undefined =
      unitTableMap[normalizedUnit];

    if (thresholds) {
      return formatWithThresholds(value, thresholds).formatted;
    }

    // Unknown unit — format number and show the readable unit name when we have one.
    return `${formatNumber(value)} ${ValueFormatter.getReadableUnit(unit)}`;
  }

  // Check if a unit is one we can auto-scale (bytes, seconds, etc.)
  public static isScalableUnit(unit: string): boolean {
    if (!unit || unit.trim() === "") {
      return false;
    }
    return unitTableMap[normalizeUnit(unit)] !== undefined;
  }

  /*
   * Convert a UCUM / OpenTelemetry unit code into a human-readable name.
   * e.g. "By" → "Bytes", "s" → "Seconds", "By/s" → "Bytes per Second",
   * "1" → "" (dimensionless). Falls back to the original string when unknown.
   */
  public static getReadableUnit(unit: string): string {
    if (!unit || unit.trim() === "" || unit.trim() === "1") {
      return "";
    }

    // Handle compound rate units like "By/s" → "Bytes per Second"
    if (unit.includes("/")) {
      const parts: Array<string> = unit.split("/");
      const readableParts: Array<string> = parts.map((part: string): string => {
        return getReadableUnitPart(part);
      });
      // Singularize the denominator ("Seconds" → "Second") for nicer rate reading.
      const [numerator, ...denominators] = readableParts;
      const denominator: string = denominators
        .map((d: string): string => {
          return d.endsWith("s") ? d.slice(0, -1) : d;
        })
        .join(" per ");
      return `${numerator} per ${denominator}`;
    }

    return getReadableUnitPart(unit);
  }
}
