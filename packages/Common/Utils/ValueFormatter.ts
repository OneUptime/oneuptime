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

/*
 * The compact sibling of readableUnitMap: the symbol a metric tile can afford
 * to draw next to a big number, where the spelled-out name would push the
 * digits off the tile. "Cel" spells out to the 7 characters of "Celsius";
 * "°C" is two.
 *
 * Bit prefixes stay `kbit`/`Mbit`/`Gbit` rather than `kb`/`Mb`: at the suffix
 * font size a case-only distinction from kB/MB/GB is unreadable.
 *
 * Three keys readableUnitMap resolves ambiguously are DELIBERATELY ABSENT and
 * fall through to the verbose name: "a" (UCUM annum vs. ampere — the map
 * already reads it as Amperes, and "5 A" for a metric that meant 5 years is a
 * silent mis-read), "b" (bel vs. bit vs. byte), and "k" ("300 K" for kelvin
 * sits one space away from the "300K" formatLargeNumber emits for 300000).
 * All three are short already, so abbreviating them buys nothing and costs
 * clarity.
 */
const compactUnitMap: Record<string, string> = {
  // Dimensionless
  "1": "",

  // Bytes (decimal)
  by: "B",
  byte: "B",
  bytes: "B",
  kby: "kB",
  mby: "MB",
  gby: "GB",
  tby: "TB",
  pby: "PB",

  // Bytes (binary)
  kiby: "KiB",
  miby: "MiB",
  giby: "GiB",
  tiby: "TiB",
  piby: "PiB",

  // Bits
  bit: "bit",
  bits: "bit",
  kbit: "kbit",
  mbit: "Mbit",
  gbit: "Gbit",

  // Time
  ns: "ns",
  nanosecond: "ns",
  nanoseconds: "ns",
  us: "µs",
  µs: "µs",
  microsecond: "µs",
  microseconds: "µs",
  ms: "ms",
  millisecond: "ms",
  milliseconds: "ms",
  s: "s",
  sec: "s",
  second: "s",
  seconds: "s",
  min: "min",
  minute: "min",
  minutes: "min",
  h: "h",
  hr: "h",
  hour: "h",
  hours: "h",
  d: "d",
  day: "d",
  days: "d",

  // Percent
  "%": "%",
  percent: "%",

  // Frequency
  hz: "Hz",
  khz: "kHz",
  mhz: "MHz",
  ghz: "GHz",

  // Temperature
  cel: "°C",
  "[degf]": "°F",

  // Electrical
  v: "V",
  w: "W",
  kw: "kW",
  j: "J",
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

  if (absValue >= 1) {
    return (Math.round(value * 100) / 100).toString();
  }

  /*
   * Below 1, fixed two-decimal rounding collapses distinct values onto the
   * same label (0.004 and 0.006 both become "0.01"), which renders chart
   * axes with runs of duplicate ticks. Two significant digits keeps
   * neighbouring ticks distinct at any magnitude.
   */
  const rounded: number = parseFloat(value.toPrecision(2));
  const asString: string = rounded.toString();
  if (!asString.includes("e") && !asString.includes("E")) {
    return asString;
  }

  /*
   * Number.prototype.toString switches to exponential notation below 1e-6
   * ("1.2e-7"), which is unreadable on an axis label — expand it back to
   * plain decimals and trim the trailing zeros toFixed pads with.
   */
  return rounded.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
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

/*
 * Whether a formatted value carries the spelled-out unit name ("Milliseconds")
 * or its symbol ("ms"). Readable is what charts, badges and the metric details
 * modal want; compact is for width-constrained surfaces like the dashboard
 * Value tile, where the name competes with the number for horizontal space.
 */
type UnitStyle = "readable" | "compact";

/*
 * The separator rules formatValue has always used: percent joins with no
 * space, an empty unit contributes nothing, everything else gets one space.
 */
function joinValueAndUnit(value: string, unit: string): string {
  if (unit === "") {
    return value;
  }
  if (unit === "%") {
    return `${value}%`;
  }
  return `${value} ${unit}`;
}

/*
 * Compacts the suffixes the threshold tables emit, which are a second source
 * of long unit names that compactUnitMap alone cannot reach: formatValue(3600,
 * "seconds") scales to "1 hours". Suffixes with no compact form ("B", "KB",
 * "MB", …) are already short and pass through untouched.
 */
function compactThresholdUnit(unit: string): string {
  const compact: string | undefined = compactUnitMap[normalizeUnit(unit)];
  return compact === undefined ? unit : compact;
}

/*
 * The shared core behind formatValue and formatValueCompact. Returning the
 * number and the unit SEPARATELY is the point: the Value widget draws them at
 * different font sizes, and splitting the joined string back apart in the
 * widget is guesswork — a lastIndexOf(" ") over "5 requests per Second" puts
 * "requests per" in the big-number span.
 *
 * The "readable" path must stay byte-identical to what formatValue has always
 * emitted; it has 20+ non-test callers (chart axis ticks, threshold
 * annotations, the Gauge, the metric list) and a table test pins every branch.
 */
function formatValueParts(
  value: number,
  unit: string,
  options: { metricName?: string } | undefined,
  unitStyle: UnitStyle,
): FormattedValue {
  const trimmedUnit: string = (unit || "").trim();

  const build: (partValue: string, partUnit: string) => FormattedValue = (
    partValue: string,
    partUnit: string,
  ): FormattedValue => {
    return {
      value: partValue,
      unit: partUnit,
      formatted: joinValueAndUnit(partValue, partUnit),
    };
  };

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
    return build(formatPercent(value * 100), "%");
  }

  // OpenTelemetry uses "1" as the dimensionless marker — render as a bare number.
  if (trimmedUnit === "" || trimmedUnit === "1") {
    return build(formatNumber(value), "");
  }

  /*
   * "%" and its spelled-out / casual variants all render inline with no
   * separating space — `25.00%`, never `25 Percent`.
   */
  if (ValueFormatter.isPercentUnit(trimmedUnit)) {
    return build(formatPercent(value), "%");
  }

  /*
   * UCUM annotation-only units (e.g. "{thread}", "{packets}", "{errors}")
   * are dimensionless — the brace contents are descriptive only and the
   * value itself is the count. Render the bare number so chart y-axis
   * labels stay short and don't wrap into the plot area.
   */
  const annotationOnlyUnitPattern: RegExp = /^\{[^{}]*\}$/;
  if (annotationOnlyUnitPattern.test(trimmedUnit)) {
    return build(formatNumber(value), "");
  }

  const normalizedUnit: string = normalizeUnit(unit);
  const thresholds: Array<UnitThreshold> | undefined =
    unitTableMap[normalizedUnit];

  if (thresholds) {
    const scaled: FormattedValue = formatWithThresholds(value, thresholds);
    return build(
      scaled.value,
      unitStyle === "compact" ? compactThresholdUnit(scaled.unit) : scaled.unit,
    );
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
        const scaledUnit: string =
          unitStyle === "compact"
            ? compactThresholdUnit(scaled.unit)
            : scaled.unit;
        return build(scaled.value, `${scaledUnit}/${denominator}`);
      }
    }
  }

  // Unknown unit — format number and show the readable unit name when we have one.
  return build(
    formatNumber(value),
    unitStyle === "compact"
      ? ValueFormatter.getCompactUnit(unit, options)
      : ValueFormatter.getReadableUnit(unit),
  );
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
    return formatValueParts(value, unit, options, "readable").formatted;
  }

  /*
   * Compact sibling of getReadableUnit: the unit SYMBOL, for surfaces where
   * the spelled-out name competes with the value for horizontal space.
   * e.g. getCompactUnit("Cel") → "°C", getCompactUnit("By") → "B".
   *
   * Deliberately separate from getReadableUnit — the metric details modal, the
   * metric list badge and the chart legend all read better with
   * "Milliseconds" than "ms", and only the dashboard Value tile is
   * width-constrained enough to need the symbol.
   */
  public static getCompactUnit(
    unit: string,
    options?: { metricName?: string },
  ): string {
    const trimmed: string = (unit || "").trim();

    if (
      trimmed === "1" &&
      ValueFormatter.isFractionMetric(options?.metricName)
    ) {
      return "%";
    }
    if (trimmed === "" || trimmed === "1") {
      return "";
    }
    if (ValueFormatter.isPercentUnit(trimmed)) {
      return "%";
    }

    /*
     * Annotation-only units ("{thread}") are descriptive, not dimensional.
     * formatValue already drops them from the number, so the compact unit is
     * empty rather than getReadableUnit's capitalised "Thread".
     */
    const annotationOnlyUnitPattern: RegExp = /^\{[^{}]*\}$/;
    if (annotationOnlyUnitPattern.test(trimmed)) {
      return "";
    }

    const compact: string | undefined = compactUnitMap[normalizeUnit(trimmed)];
    if (compact !== undefined) {
      return compact;
    }

    /*
     * Compound units keep the slash the exporter wrote: "ug/m3" is five
     * characters where getReadableUnit's "ug per m3" is nine.
     */
    if (trimmed.includes("/")) {
      return trimmed
        .split("/")
        .map((part: string): string => {
          const partCompact: string | undefined =
            compactUnitMap[normalizeUnit(part)];
          return partCompact === undefined ? part.trim() : partCompact;
        })
        .join("/");
    }

    return trimmed;
  }

  /*
   * formatValue, but returning the number and the unit separately and with the
   * unit in symbol form. Returning the pair is the point: a widget that draws
   * the two at different font sizes cannot recover them from the joined
   * string — a lastIndexOf(" ") over "5 requests per Second" puts
   * "requests per" in the big-number span.
   */
  public static formatValueCompact(
    value: number,
    unit: string,
    options?: { metricName?: string },
  ): FormattedValue {
    return formatValueParts(value, unit, options, "compact");
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
   *   - OTel `.utilization` (system.cpu.utilization, …)
   *   - OTel `.ratio` and `.fraction` (db.client.connection.usage_ratio, …)
   *   - Prometheus-style `_utilization` / `_ratio` / `_fraction` suffixes
   *   - Plain `_percent` / `.percent` / `_percentage` / `.percentage` names
   *
   * Adding a new suffix is one regex edit — no per-metric allowlist.
   *
   * The two kubeletstats exclusions below are not taste. The receiver
   * emits `k8s.pod.cpu.utilization` and `k8s.node.cpu.utilization` as CPU
   * *cores in use* (UsageNanoCores / 1e9) carrying unit "1", despite the
   * `.utilization` name. Four other places in this repo already say so:
   * the header comment on Pages/Kubernetes/Utils/KubernetesCpuUtils.ts,
   * OtelMetricsIngestService.cpuCoresToPercent (which divides by
   * k8s.node.allocatable_cpu rather than multiplying by 100), the "CPU
   * widgets show cores, not a percent" note in DashboardTemplates.ts, and
   * the highCpuTemplate description in KubernetesAlertTemplates.ts
   * ("the raw k8s.node.cpu.utilization metric is a misnamed cores gauge,
   * not a percent"). Matching them here multiplies cores by 100 — which is
   * what rendered 0.1831 cores as "18.31%" on the same evaluation page
   * that showed the pod at 91.55% of its CPU limit.
   *
   * The exclusion is anchored to those two exact names, so the genuine
   * ratio metrics from the same receiver — k8s.pod.cpu_limit_utilization,
   * k8s.container.cpu_request_utilization and friends — still match and
   * still render as percents.
   *
   * `container.cpu.utilization` is DELIBERATELY not excluded. That exact
   * metric name is emitted both by kubeletstats (cores) and by
   * docker_stats, and this repo does not currently agree with itself on
   * the docker_stats scale — OtelMetricsIngestService.cpuValueToPercent
   * multiplies the raw value by 100 while Pages/Docker/View/Containers.tsx
   * renders the same raw value with a "%" suffix and no scaling.
   * Excluding it here would silently pick a side of that contradiction.
   */
  public static isFractionMetric(metricName: string | undefined): boolean {
    if (!metricName) {
      return false;
    }

    const kubeletstatsCoresGaugeMisnamedAsUtilization: RegExp =
      /^k8s\.(node|pod)\.cpu\.utilization$/i;
    if (kubeletstatsCoresGaugeMisnamedAsUtilization.test(metricName.trim())) {
      return false;
    }

    const fractionMetricSuffixRegex: RegExp =
      /[._](utilization|ratio|fraction|percent|percentage)$/i;
    return fractionMetricSuffixRegex.test(metricName);
  }

  /*
   * Direction-of-goodness heuristic for trend coloring. Returns true when a
   * rising value on this metric should be shown as bad (red ↑) and a falling
   * value as good (green ↓) — the opposite of the default "up = good".
   *
   * Caller is responsible for the inversion; this method only classifies.
   * Conservative by default: when the metric name carries no signal we
   * return `false` so generic counters (request rate, network I/O, span
   * count) keep the up = good colour scheme. Explicit "higher is better"
   * tokens (uptime/availability/online/ready/healthy/available/success/
   * passed) take precedence — without that allowlist `oneuptime.monitor.
   * online` would match nothing and incorrectly fall through; the suffix
   * test then catches incident counts, error rates, MTTR/MTTA, response
   * times, CPU/memory usage, restarts, pressure, queue backlogs, etc.
   *
   * Adding a metric here is a single regex edit. If a dashboard widget
   * really needs to override this for a specific case, callers can set
   * `higherIsBetter` explicitly on the trend display.
   */
  public static isHigherWorseMetric(metricName: string | undefined): boolean {
    if (!metricName) {
      return false;
    }
    const lower: string = metricName.toLowerCase();

    const higherIsBetter: RegExp =
      /\b(uptime|availability|online|ready|healthy|available|success|passed|ok|alive|up)\b/;
    if (higherIsBetter.test(lower)) {
      return false;
    }

    const higherIsWorse: RegExp =
      /(error|fail(?:ure|ed)?|incident|exception|crash|restart|timeout|dropped|aborted?|reject(?:ed)?|mttr|mtta|latenc(?:y|ies)|duration|[._-]time\b|time[._-]to[._-]|usage|utilization|pressure|unresolved|pending|backlog|lag|delay|saturation|throttl|stall|missed?)/;
    return higherIsWorse.test(lower);
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
