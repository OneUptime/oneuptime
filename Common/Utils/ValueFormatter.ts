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

/*
 * Maps UCUM / OpenTelemetry unit codes to human-readable unit names.
 * Used for labelling (e.g. badges) where the raw code "By" is hard to read.
 */
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

  /*
   * 0 is a tricky edge case for descending-threshold tables: the table
   * always has a `threshold: 0` entry at the bottom (the smallest sub-
   * unit — ns for seconds, B for bytes), and `0 >= 0` short-circuits the
   * loop on that entry. The result is that a 0-value `seconds` metric
   * renders as "0 ns" instead of "0 sec". Use the natural unit
   * (divisor === 1) when the value is exactly 0 so the suffix matches
   * the input scale.
   */
  if (absValue === 0) {
    const natural: UnitThreshold =
      thresholds.find((t: UnitThreshold) => {
        return t.divisor === 1;
      }) ?? (thresholds[thresholds.length - 1] as UnitThreshold);
    return {
      value: "0",
      unit: natural.unit,
      formatted: `0 ${natural.unit}`,
    };
  }

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

/*
 * Abbreviates large numbers (>= 1000) with K/M/B/T/P suffixes so chart
 * axis labels stay narrow. Counter-style metrics frequently reach into
 * the billions and the raw digit string overflows the y-axis tick width.
 *
 * Always renders 2 decimal places of the scaled value, then trims trailing
 * zeros — so neighbouring ticks like 119.20B / 119.25B remain distinct
 * (the user can see the counter rising) while round values stay clean
 * (5K, not 5.00K).
 */
function formatLargeNumber(value: number): string {
  const absValue: number = Math.abs(value);
  let scaled: number;
  let suffix: string;

  if (absValue >= 1e15) {
    scaled = value / 1e15;
    suffix = "P";
  } else if (absValue >= 1e12) {
    scaled = value / 1e12;
    suffix = "T";
  } else if (absValue >= 1e9) {
    scaled = value / 1e9;
    suffix = "B";
  } else if (absValue >= 1e6) {
    scaled = value / 1e6;
    suffix = "M";
  } else {
    scaled = value / 1e3;
    suffix = "K";
  }

  let formatted: string = scaled.toFixed(2);
  if (formatted.includes(".")) {
    formatted = formatted.replace(/\.?0+$/, "");
  }

  return `${formatted}${suffix}`;
}

function formatNumber(value: number): string {
  if (value === 0) {
    return "0";
  }

  const absValue: number = Math.abs(value);

  if (absValue >= 1e3) {
    return formatLargeNumber(value);
  }

  if (absValue >= 100) {
    return Math.round(value).toString();
  }

  if (absValue >= 10) {
    return (Math.round(value * 10) / 10).toString();
  }

  return (Math.round(value * 100) / 100).toString();
}

/*
 * Percent values always render with two decimal places. Trailing zeros are
 * preserved (so 100 → "100.00", 2 → "2.00") to keep axis ticks and tooltips
 * visually consistent across high- and low-utilization series.
 */
function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  return value.toFixed(2);
}

export default class ValueFormatter {
  /*
   * Format a value with a unit into a human-friendly string.
   * e.g. formatValue(1048576, "bytes") → "1 MB"
   * e.g. formatValue(3661, "seconds") → "1.02 hr"
   * e.g. formatValue(42, "%") → "42%"
   * e.g. formatValue(0.25, "1", { metricName: "system.cpu.utilization" }) → "25%"
   */
  public static formatValue(
    value: number,
    unit: string,
    options?: { metricName?: string },
  ): string {
    const trimmedUnit: string = (unit || "").trim();

    /*
     * OTel/UCUM ratio metrics carry a [0, 1] fraction with unit "1". Render
     * them as a percentage so chart axes / thresholds read 25.00% instead
     * of 0.25. Percent values always render with two decimal places so
     * low-utilization series (e.g. 2.04%) and exact values (e.g. 100.00%)
     * read consistently across axis ticks and tooltips.
     */
    if (
      trimmedUnit === "1" &&
      ValueFormatter.isFractionMetric(options?.metricName)
    ) {
      return `${formatPercent(value * 100)}%`;
    }

    // OpenTelemetry uses "1" as the dimensionless marker — render as a bare number.
    if (trimmedUnit === "" || trimmedUnit === "1") {
      return formatNumber(value);
    }

    /*
     * "%" and its spelled-out / casual variants all render inline with no
     * separating space — `25.00%`, never `25 Percent`.
     */
    if (ValueFormatter.isPercentUnit(trimmedUnit)) {
      return `${formatPercent(value)}%`;
    }

    /*
     * UCUM annotation-only units (e.g. "{thread}", "{packets}", "{errors}")
     * are dimensionless — the brace contents are descriptive only and the
     * value itself is the count. Render the bare number so chart y-axis
     * labels stay short and don't wrap into the plot area.
     */
    const annotationOnlyUnitPattern: RegExp = /^\{[^{}]*\}$/;
    if (annotationOnlyUnitPattern.test(trimmedUnit)) {
      return formatNumber(value);
    }

    const normalizedUnit: string = normalizeUnit(unit);
    const thresholds: Array<UnitThreshold> | undefined =
      unitTableMap[normalizedUnit];

    if (thresholds) {
      return formatWithThresholds(value, thresholds).formatted;
    }

    /*
     * Compound rate units like "By/s" or "ms/s". Scale the numerator with
     * its threshold table when we know one (so 1500000 By/s renders as
     * "1.5 MB/s" rather than "1500000 Bytes per Second"), and keep a
     * compact denominator. Falls back to the verbose readable form for
     * unrecognized compound units.
     */
    if (trimmedUnit.includes("/")) {
      const [numeratorRaw, ...denominatorParts] = trimmedUnit.split("/");
      const denominator: string = denominatorParts.join("/").trim();
      if (numeratorRaw && denominator) {
        const numeratorThresholds: Array<UnitThreshold> | undefined =
          unitTableMap[normalizeUnit(numeratorRaw)];
        if (numeratorThresholds) {
          const scaled: FormattedValue = formatWithThresholds(
            value,
            numeratorThresholds,
          );
          return `${scaled.value} ${scaled.unit}/${denominator}`;
        }
      }
    }

    // Unknown unit — format number and show the readable unit name when we have one.
    return `${formatNumber(value)} ${ValueFormatter.getReadableUnit(unit)}`;
  }

  /*
   * UCUM canonical is "%" but exporters (especially custom ones) often
   * write "percent", "percentage", or "pct". Treat them all the same so a
   * user adding a percent metric never sees the value rendered as
   * "25 Percent" with a stray space.
   */
  public static isPercentUnit(unit: string | undefined): boolean {
    if (!unit) {
      return false;
    }
    const normalized: string = unit.trim().toLowerCase();
    return (
      normalized === "%" ||
      normalized === "percent" ||
      normalized === "percentage" ||
      normalized === "pct"
    );
  }

  /*
   * Returns true when the metric name follows a convention that signals a
   * [0, 1] ratio. Pair with unit "1" to render values as percentages.
   *
   * Conventions covered:
   *   - OTel `.utilization` (system.cpu.utilization, k8s.node.cpu.utilization, …)
   *   - OTel `.ratio` and `.fraction` (db.client.connection.usage_ratio, …)
   *   - Prometheus-style `_utilization` / `_ratio` / `_fraction` suffixes
   *   - Plain `_percent` / `.percent` / `_percentage` / `.percentage` names
   *
   * Adding a new suffix is one regex edit — no per-metric allowlist.
   */
  public static isFractionMetric(metricName: string | undefined): boolean {
    if (!metricName) {
      return false;
    }
    const fractionMetricSuffixRegex: RegExp =
      /[._](utilization|ratio|fraction|percent|percentage)$/i;
    return fractionMetricSuffixRegex.test(metricName);
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
   * When `metricName` ends in `.utilization` and the unit is "1", returns
   * "Percent" so axis legends and badges match the formatted values.
   */
  public static getReadableUnit(
    unit: string,
    options?: { metricName?: string },
  ): string {
    const trimmed: string = (unit || "").trim();
    if (
      trimmed === "1" &&
      ValueFormatter.isFractionMetric(options?.metricName)
    ) {
      return "Percent";
    }
    if (trimmed === "" || trimmed === "1") {
      return "";
    }
    if (ValueFormatter.isPercentUnit(trimmed)) {
      return "Percent";
    }

    /*
     * UCUM annotation-only units (e.g. "{thread}", "{packets}") are
     * dimensionless. Render the inner word with a capital first letter
     * so badges read "Threads" / "Packets" instead of "{thread}".
     */
    const annotationMatch: RegExpMatchArray | null =
      trimmed.match(/^\{([^{}]+)\}$/);
    if (annotationMatch) {
      const inner: string = annotationMatch[1] as string;
      return inner.charAt(0).toUpperCase() + inner.slice(1);
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
