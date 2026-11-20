/*
 * Human-friendly value formatting for metric units.
 * Converts raw values like 1048576 bytes → "1 MB", 3661 seconds → "1.02 hr", etc.
 *
 * A unit's symbol is held to its figure with a no-break space ("1 MB" is
 * "1\u00A0MB"), so a chart's tooltip, a table's cell or a Gauge's caption
 * never ends a line with the figure and starts the next with its unit
 * (#8457). So is a unit it names in words ("2 hours", "300 Kelvin"), as
 * DateLanguage holds every amount Intl writes ("6,91 Stunden", #8456): all
 * this formatter writes is a measurement.
 */

import {
  getNumberLocale,
  getUnitAmountParts,
  IntlTextPart,
  isEnglishDateLanguage,
} from "../Types/DateLanguage";
import { NO_BREAK_SPACE } from "../Types/NoBreakSpaces";

export interface FormattedValue {
  value: string; // e.g. "1.5"
  unit: string; // e.g. "MB"
  formatted: string; // e.g. "1.5\u00A0MB"
}

export interface ValueFormatterOptions {
  metricName?: string;
  /*
   * The reader's language ("de", "fa"): the number is written the way it
   * writes numbers (writeNumberInLanguage), a big one in the language's own
   * scale ("1,2 Mio.", "۱٫۲ هزار"), and a span of time in its own words
   * ("6,91 Stunden", "۶٫۹۱ ساعت"). None, or English, writes it exactly as
   * it always was.
   */
  language?: string | undefined;
  /*
   * The unit's name where the formatter names it in words a language has
   * to translate (getReadableUnit's "Hertz", "Volts", "Celsius"):
   * the reader's, as the charts' getUnitNameInLanguage gives it. The
   * formatter has no translations of its own; English when left out.
   */
  unitName?: ((unit: string) => string) | undefined;
  /*
   * The step between the ticks of the value axis the value is written on,
   * in the value's unit (issues #10079, #10117). Given, the value is
   * written with as many figures after the point as that step needs in the
   * unit it is written in, and keeps them all: "17.205 GB" on an axis
   * stepping 5 MB at a time, "17.200 GB" beside it, "25%" on one stepping
   * a quarter. A span of time is written in the units of time the step
   * needs: "1 h 30 min" on an axis stepping a quarter of an hour, never
   * "1.5000 hours" (issue #10118). A chart hands it to every value axis it
   * steps, and to the tooltip of one whose ticks its own figures cannot
   * tell apart. Left out, a value is written as it always was.
   */
  step?: number | undefined;
  /*
   * The size of the largest tick of the axis the value is written on, in
   * the value's unit (ValueAxisPrecision's largestTick): a span of time is
   * written in the units that tick needs, so every tick of an axis reads
   * alike - "0:59:59" beside "1:00:00". Read only with a step.
   */
  largestTick?: number | undefined;
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

/*
 * The seconds one value of a unit of time stands for: the units a duration
 * axis steps and writes in natural units of time (issue #10118). A rate
 * ("ms/s") is no span of time.
 */
const durationUnitInSecondsMap: Record<string, number> = {
  d: 86400,
  day: 86400,
  days: 86400,
  h: 3600,
  hr: 3600,
  hour: 3600,
  hours: 3600,
  min: 60,
  minute: 60,
  minutes: 60,
  s: 1,
  sec: 1,
  second: 1,
  seconds: 1,
  ms: 0.001,
  millisecond: 0.001,
  milliseconds: 0.001,
  us: 0.000001,
  µs: 0.000001,
  microsecond: 0.000001,
  microseconds: 0.000001,
  ns: 0.000000001,
  nanosecond: 0.000000001,
  nanoseconds: 0.000000001,
};

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
  /*
   * The clouds' own words for "no unit": CloudWatch's "None" (a metric
   * published without one, #9809) and Azure Monitor's "Unspecified". Drawn
   * as nothing, never as "5 None".
   */
  none: "",
  unspecified: "",

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
  none: "",
  unspecified: "",

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

// A value scaled by a threshold table: its figure, and the unit it is in.
interface ScaledValue {
  value: string; // e.g. "1.5"
  unit: string; // e.g. "MB", "hours"
}

/*
 * THE FIGURES AFTER THE POINT AN AXIS'S STEP NEEDS (issue #10079).
 *
 * A value axis over a range small beside its values wrote the same label on
 * every tick: a filesystem holding 17.2 GB, give or take a few megabytes,
 * read "17.2 GB" five times, as the formatter keeps about three figures. A
 * chart that knows its axis's step hands it over (options.step), and each
 * value is written with the figures that step needs in the unit the value
 * is written in: the fewest at which two neighbouring ticks differ, and one
 * more for a step such as 2.5 that is written exactly with it. A step that
 * no number of figures writes exactly (a second, in hours) gets the fewest
 * that keep neighbours apart. Each tick keeps them all, trailing zeros too,
 * so an axis's ticks line up: "17.200 GB", "17.205 GB", "17.210 GB".
 */
const MOST_STEP_DECIMALS: number = 12;

// How many figures after the point `value` is written with: 0.0025 has 4.
function countWrittenDecimals(value: number): number {
  const [mantissa, exponent] = value.toExponential().split("e");
  const mantissaDecimals: number = ((mantissa || "").split(".")[1] || "")
    .length;

  return Math.max(0, mantissaDecimals - Number(exponent || 0));
}

/*
 * The figures after the point a value written in a unit `divisor` times the
 * axis's own takes, for ticks `step` apart; undefined with no step, as
 * before.
 */
function getDecimalsForStep(
  step: number | undefined,
  divisor: number = 1,
): number | undefined {
  if (
    typeof step !== "number" ||
    !Number.isFinite(step) ||
    step === 0 ||
    !Number.isFinite(divisor) ||
    divisor === 0
  ) {
    return undefined;
  }

  // Rounded to twelve figures: 0.1 + 0.2 is a step of 0.3, not 0.30000000000000004.
  const scaledStep: number = Number(Math.abs(step / divisor).toPrecision(12));

  if (!(scaledStep > 0) || !Number.isFinite(scaledStep)) {
    return undefined;
  }

  // The fewest figures at which values a step apart round apart.
  const apart: number = Math.max(0, Math.ceil(-Math.log10(scaledStep) - 1e-9));
  const exact: number = countWrittenDecimals(scaledStep);

  return Math.min(
    MOST_STEP_DECIMALS,
    exact <= apart + 1 ? Math.max(apart, exact) : apart,
  );
}

// A figure toFixed wrote for a value that rounds to zero from below: "-0.000".
const NEGATIVE_ZERO: RegExp = /^-0(\.0+)?$/;

// toFixed, without the minus of a value that rounds to zero: "0.000", not "-0.000".
function toFixedFigures(value: number, decimals: number): string {
  const written: string = value.toFixed(decimals);

  return NEGATIVE_ZERO.test(written) ? written.slice(1) : written;
}

// The step in a unit `divisor` times the value's own, or none.
function stepIn(step: number | undefined, divisor: number): number | undefined {
  return typeof step === "number" ? step / divisor : undefined;
}

function formatWithThresholds(
  value: number,
  thresholds: Array<UnitThreshold>,
  step?: number,
): ScaledValue {
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
      value: formatNumber(0, stepIn(step, natural.divisor)),
      unit: natural.unit,
    };
  }

  for (const t of thresholds) {
    if (absValue >= t.threshold) {
      return {
        value: formatNumber(value / t.divisor, stepIn(step, t.divisor)),
        unit: t.unit,
      };
    }
  }

  // Fallback: use last threshold
  const last: UnitThreshold = thresholds[thresholds.length - 1]!;
  return {
    value: formatNumber(value / last.divisor, stepIn(step, last.divisor)),
    unit: last.unit,
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
 * (5K, not 5.00K). On an axis that hands its step over, the figures are the
 * step's, every one kept: "119.200B", "119.201B" (issue #10079).
 */
function formatLargeNumber(value: number, step?: number): string {
  const absValue: number = Math.abs(value);
  let divisor: number;
  let suffix: string;

  if (absValue >= 1e15) {
    divisor = 1e15;
    suffix = "P";
  } else if (absValue >= 1e12) {
    divisor = 1e12;
    suffix = "T";
  } else if (absValue >= 1e9) {
    divisor = 1e9;
    suffix = "B";
  } else if (absValue >= 1e6) {
    divisor = 1e6;
    suffix = "M";
  } else {
    divisor = 1e3;
    suffix = "K";
  }

  const scaled: number = value / divisor;
  const stepDecimals: number | undefined = getDecimalsForStep(step, divisor);

  if (stepDecimals !== undefined) {
    return `${toFixedFigures(scaled, stepDecimals)}${suffix}`;
  }

  let formatted: string = scaled.toFixed(2);
  if (formatted.includes(".")) {
    formatted = formatted.replace(/\.?0+$/, "");
  }

  return `${formatted}${suffix}`;
}

function formatNumber(value: number, step?: number): string {
  const stepDecimals: number | undefined = getDecimalsForStep(step);

  if (value === 0) {
    return stepDecimals === undefined ? "0" : toFixedFigures(0, stepDecimals);
  }

  const absValue: number = Math.abs(value);

  if (absValue >= 1e3) {
    return formatLargeNumber(value, step);
  }

  // On an axis that hands its step over, the step's figures (issue #10079).
  if (stepDecimals !== undefined) {
    return toFixedFigures(value, stepDecimals);
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
 * visually consistent across high- and low-utilization series. On an axis
 * that hands its step over, with the step's figures: "99.995%" beside
 * "99.990%" (issue #10079).
 */
function formatPercent(value: number, step?: number): string {
  if (!Number.isFinite(value)) {
    return "0.00";
  }

  const stepDecimals: number | undefined = getDecimalsForStep(step);

  if (stepDecimals !== undefined) {
    return toFixedFigures(value, stepDecimals);
  }

  return value.toFixed(2);
}

/*
 * THE NUMBER IN THE READER'S LANGUAGE (#7094).
 *
 * The formatter writes its numbers the way English does - "73.40", "1.5K" -
 * and a Gauge or a Value widget drew them so on every board: Latin digits
 * and a point on a Persian one, beside an SLO tile that wrote "۹۹٫۹٪", and
 * "73.4" where German writes "73,4". Given the reader's language, a number
 * keeps exactly the decimals and the scale letter (K, M, B, T, P) it was
 * written with, in that language's digits, decimal sign and minus: "73,40"
 * in German, "۷۳٫۴۰" in Persian, Latin digits in Arabic (getNumberLocale).
 * A percentage takes the language's own percent sign and spacing, as the
 * SLO tiles write theirs: "73,40 %", "۷۳٫۴۰٪". No language, or English,
 * writes every number exactly as before.
 */

// A number as formatNumber and formatPercent write it: "73.40", "-1.5", "119.25B".
const WRITTEN_NUMBER: RegExp = /^(-?\d+)(?:\.(\d+))?([KMBTP]?)$/;

// What follows a number that sets its unit apart: a space, or a no-break one.
const STARTS_WITH_SPACE: RegExp = /^\s/;

// One Intl format per language, decimals and style: a board writes many numbers.
const languageNumberFormats: Map<string, Intl.NumberFormat | null> = new Map<
  string,
  Intl.NumberFormat | null
>();

function getLanguageNumberFormat(
  language: string,
  decimals: number,
  isPercent: boolean,
): Intl.NumberFormat | null {
  const key: string = [
    language,
    decimals,
    isPercent ? "percent" : "decimal",
  ].join("|");

  if (!languageNumberFormats.has(key)) {
    let format: Intl.NumberFormat | null = null;

    try {
      format = new Intl.NumberFormat(getNumberLocale(language), {
        style: isPercent ? "percent" : "decimal",
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    } catch {
      format = null;
    }

    languageNumberFormats.set(key, format);
  }

  return languageNumberFormats.get(key) || null;
}

/*
 * THE SCALE AND THE TIME WORDS IN THE READER'S LANGUAGE (#7518).
 *
 * A big number kept English's scale letter in every language - "1,2K" on a
 * German board, "۱٫۲K" on a Persian one - where German writes "1200" and
 * "1,2 Mio.", Persian "۱٫۲ هزار" and Japanese "120万". Given a language, a
 * scaled number is written in its own compact notation (Intl's), to the
 * two decimals English keeps. And a span of time the formatter names in
 * words ("6.91 hours", "2 min") is named in the language's words, in the
 * form its number takes: "6,91 Stunden", "1 Stunde", "۶٫۹۱ ساعت". The
 * symbols every language writes alike - ms, MB/s, %, °C - stay as they
 * are. English, and no language, read exactly as before.
 */

// What each scale letter formatLargeNumber writes stands for.
const SCALE_EXPONENTS: Record<string, number> = {
  K: 3,
  M: 6,
  B: 9,
  T: 12,
  P: 15,
};

// The options Common's ES2017 library does not declare, that Intl reads.
type IntlFormatOptions = Intl.NumberFormatOptions & {
  notation?: "standard" | "compact";
  compactDisplay?: "short" | "long";
};

const languageCompactFormats: Map<string, Intl.NumberFormat | null> = new Map<
  string,
  Intl.NumberFormat | null
>();

/*
 * The language's compact notation: to the two decimals English keeps, or,
 * for a value on an axis that hands its step over (issue #10079), to
 * exactly `significantDigits` figures, so every tick keeps the axis's
 * resolution whichever scale the language writes it in ("119,201 Mrd.",
 * "1192.01億").
 */
function getLanguageCompactFormat(
  language: string,
  significantDigits?: number,
): Intl.NumberFormat | null {
  const key: string = [language, significantDigits ?? ""].join("|");

  if (!languageCompactFormats.has(key)) {
    let format: Intl.NumberFormat | null = null;

    try {
      const options: IntlFormatOptions =
        significantDigits === undefined
          ? {
              notation: "compact",
              compactDisplay: "short",
              maximumFractionDigits: 2,
            }
          : {
              notation: "compact",
              compactDisplay: "short",
              minimumSignificantDigits: significantDigits,
              maximumSignificantDigits: significantDigits,
            };

      format = new Intl.NumberFormat(getNumberLocale(language), options);
    } catch {
      format = null;
    }

    languageCompactFormats.set(key, format);
  }

  return languageCompactFormats.get(key) || null;
}

/*
 * The significant figures that write `number` to the resolution of a figure
 * English wrote with `decimals` after the point at `exponent`'s scale:
 * 119.201B (three decimals of a billion) is to the million, six figures.
 */
function getSignificantDigitsFor(
  number: number,
  exponent: number,
  decimals: number,
): number {
  const magnitude: number = Math.floor(Math.log10(Math.abs(number)));

  return Math.min(21, Math.max(1, magnitude - (exponent - decimals) + 1));
}

/*
 * The words the threshold tables name a span of time with, and the Intl
 * unit each is: in full for a day and an hour, as English writes "days"
 * and "hours", and as the language shortens them for a minute and a
 * second, as English writes "min" and "sec".
 */
const TIME_UNIT_WORDS: Record<
  string,
  { unit: string; display: "long" | "short" }
> = {
  days: { unit: "day", display: "long" },
  hours: { unit: "hour", display: "long" },
  min: { unit: "minute", display: "short" },
  sec: { unit: "second", display: "short" },
};

// A number this formatter wrote ("6.91", "1.5K"), as the number it is.
function readWrittenNumber(text: string): {
  number: number;
  decimals: number;
  isScaled: boolean;
} | null {
  const match: RegExpExecArray | null = WRITTEN_NUMBER.exec(text);

  if (!match) {
    return null;
  }

  const fraction: string = match[2] || "";
  const scaleLetter: string = match[3] || "";
  const exponent: number = SCALE_EXPONENTS[scaleLetter] || 0;
  const number: number = Number(
    `${match[1]}${fraction ? `.${fraction}` : ""}e${exponent}`,
  );

  return Number.isFinite(number)
    ? { number: number, decimals: fraction.length, isScaled: exponent > 0 }
    : null;
}

/*
 * The words `language` names a span of `timeWord` ("hours") with after
 * `written`, a number this formatter wrote, and what it puts between the
 * two: "Stunden" and a space after "6.91" in German, "ساعت" in Persian,
 * "時間" after a space in Japanese, "小时" with none in Chinese. The space
 * is one no line breaks at: DateLanguage asks Intl for the amount and
 * holds its unit to its number (getUnitAmountParts, #8456). Null where
 * there is nothing to rewrite - English, a word that is not a span of time,
 * a number it cannot read - and the English stands. `display` names the
 * unit as the language shortens it ("Std.") where the word would be too
 * long, as on a duration axis's tick (issue #10118).
 */
function writeTimeWordInLanguage(
  written: string,
  timeWord: string,
  language: string | undefined,
  display?: "long" | "short",
): { word: string; gap: string; isBefore: boolean } | null {
  const timeWordUnit: { unit: string; display: "long" | "short" } | undefined =
    TIME_UNIT_WORDS[timeWord];

  if (!timeWordUnit || isEnglishDateLanguage(language)) {
    return null;
  }

  const timeUnit: { unit: string; display: "long" | "short" } = {
    unit: timeWordUnit.unit,
    display: display || timeWordUnit.display,
  };

  const read: { number: number; decimals: number; isScaled: boolean } | null =
    readWrittenNumber(written);

  if (!read) {
    return null;
  }

  const partsOf: (number: number) => Array<IntlTextPart> | null = (
    number: number,
  ): Array<IntlTextPart> | null => {
    return getUnitAmountParts({
      value: number,
      unit: timeUnit.unit,
      locale: (language || "").trim(),
      unitDisplay: timeUnit.display,
      ...(read.isScaled
        ? { notation: "compact", maximumFractionDigits: 2 }
        : {
            minimumFractionDigits: read.decimals,
            maximumFractionDigits: read.decimals,
          }),
    });
  };

  let parts: Array<IntlTextPart> | null = partsOf(read.number);

  /*
   * Arabic names one hour or two in a word with no number in it ("ساعة",
   * "ساعتان"): the number is drawn on its own, so the unit is the word a
   * number that is neither takes - as a hundred and one does ("101
   * ساعة"), the form Arabic writes after a figure.
   */
  if (
    parts &&
    !parts.some((part: IntlTextPart): boolean => {
      return part.type === "integer";
    })
  ) {
    parts = partsOf(read.number + 100);
  }

  if (!parts) {
    return null;
  }

  const unitAt: number = parts.findIndex((part: IntlTextPart): boolean => {
    return part.type === "unit";
  });
  const numberAt: number = parts.findIndex((part: IntlTextPart): boolean => {
    return part.type === "integer";
  });

  if (unitAt < 0 || numberAt < 0) {
    return null;
  }

  const word: string = parts
    .filter((part: IntlTextPart): boolean => {
      return part.type === "unit";
    })
    .map((part: IntlTextPart): string => {
      return part.value;
    })
    .join(NO_BREAK_SPACE);
  const isBefore: boolean = unitAt < numberAt;
  // The space a language sets between the number and its unit, or none.
  const between: IntlTextPart | undefined =
    parts[isBefore ? unitAt + 1 : unitAt - 1];
  const gap: string =
    between &&
    between.type === "literal" &&
    STARTS_WITH_SPACE.test(between.value)
      ? between.value
      : "";

  return { word: word, gap: gap, isBefore: isBefore };
}

/*
 * `text`, a number this formatter wrote in English, written in `language`:
 * the number (with its scale letter), the percent sign when it is a
 * percentage ("" otherwise), and the two as the language joins them. Null
 * where there is nothing to rewrite - English, or a text that is not a
 * number - and the English stands. `keepsFigures` is set for a value on an
 * axis that handed its step over (issue #10079): a scaled number then keeps
 * every figure English wrote, in the language's own scale.
 */
function writeNumberInLanguage(
  text: string,
  isPercent: boolean,
  language: string | undefined,
  keepsFigures: boolean = false,
): { value: string; percentSign: string; formatted: string } | null {
  if (isEnglishDateLanguage(language)) {
    return null;
  }

  const match: RegExpExecArray | null = WRITTEN_NUMBER.exec(text);

  if (!match) {
    return null;
  }

  const fraction: string = match[2] || "";
  const scaleLetter: string = match[3] || "";
  const format: Intl.NumberFormat | null = getLanguageNumberFormat(
    (language || "").trim(),
    fraction.length,
    isPercent,
  );

  if (!format) {
    return null;
  }

  const number: number = Number(
    fraction ? `${match[1]}.${fraction}` : match[1],
  );

  /*
   * A scaled number in the language's own compact notation: "1,2 Mio.",
   * "۱٫۲ هزار", "120万" - not English's letter after the language's digits.
   */
  if (scaleLetter && !isPercent) {
    const read: { number: number } | null = readWrittenNumber(text);
    const compact: Intl.NumberFormat | null = getLanguageCompactFormat(
      (language || "").trim(),
      keepsFigures && read && read.number !== 0
        ? getSignificantDigitsFor(
            read.number,
            SCALE_EXPONENTS[scaleLetter] || 0,
            fraction.length,
          )
        : undefined,
    );

    if (compact && read) {
      const written: string = compact.format(read.number);

      return { value: written, percentSign: "", formatted: written };
    }
  }

  const parts: Array<Intl.NumberFormatPart> = format.formatToParts(
    isPercent ? number / 100 : number,
  );

  /*
   * Everything but the percent sign is the number - a negative's minus and
   * the mark that keeps it before its digits on a page read from the right
   * too - except the space or the marks set beside the sign (German's
   * space, Arabic's marks), which go with the sign.
   */
  const value: string = parts
    .filter((part: Intl.NumberFormatPart, index: number): boolean => {
      if (part.type === "percentSign") {
        return false;
      }

      return (
        part.type !== "literal" ||
        (parts[index - 1]?.type !== "percentSign" &&
          parts[index + 1]?.type !== "percentSign")
      );
    })
    .map((part: Intl.NumberFormatPart): string => {
      return part.value;
    })
    .join("");
  const percentSign: string =
    parts.find((part: Intl.NumberFormatPart): boolean => {
      return part.type === "percentSign";
    })?.value || "";

  return {
    value: `${value}${scaleLetter}`,
    percentSign: percentSign,
    formatted: isPercent
      ? parts
          .map((part: Intl.NumberFormatPart): string => {
            return part.value;
          })
          .join("")
      : `${value}${scaleLetter}`,
  };
}

/*
 * A SPAN OF TIME ON AN AXIS THAT HANDS ITS STEP OVER (issue #10118).
 *
 * A duration axis steps in natural units of time (ValueAxisTicks'
 * DURATION_STEPS_IN_SECONDS), and each of its ticks is written in them,
 * never in a decimal fraction of the unit its size picks: an axis stepping
 * a second near an hour and a half read "1.5000 hours", "1.5003 hours",
 * "1.5006 hours", which nobody reads an hour as.
 *
 *   - Under a minute, a value is scaled as the formatter always scales one:
 *     "45 sec", "1.25 sec", "250 ms", with the figures the step needs.
 *   - From a minute, it is written in the units from its largest down to
 *     the step's, each by the language's short name, a unit that is zero
 *     left out: "1 h 30 min", "45 min", "2 d 12 h", "1 min 30 sec".
 *     English writes "d", "h", "min" and "sec", as its compact durations
 *     ("4 h 24 min") and this formatter's seconds do.
 *   - Where that takes three units or more - a second's step near an
 *     hour, a minute's near a day - as a clock: "1:30:02", "12 d 05:30".
 *     Its figures, its separator and its decimal sign are the language's:
 *     "۱:۳۰:۰۲" in Persian, "1.30.02" in Danish.
 *
 * Every tick of an axis is written in the units its largest tick needs
 * (largestTick), so no axis mixes "59 min 59 sec" with "1:00:00". Every
 * space in a tick is a no-break one: a tick never breaks over two lines.
 */

interface DurationAxisUnit {
  // Its name in the threshold tables and TIME_UNIT_WORDS: "hours", "min".
  timeWord: string;
  seconds: number;
  // How English writes it on an axis.
  english: string;
}

const DURATION_AXIS_UNITS: ReadonlyArray<DurationAxisUnit> = [
  { timeWord: "days", seconds: 86400, english: "d" },
  { timeWord: "hours", seconds: 3600, english: "h" },
  { timeWord: "min", seconds: 60, english: "min" },
  { timeWord: "sec", seconds: 1, english: "sec" },
];

const SECOND_UNIT_INDEX: number = DURATION_AXIS_UNITS.length - 1;

// A clock's seconds are written to at most this many figures after the point.
const MOST_CLOCK_DECIMALS: number = 9;

/*
 * `count` of `unit`, with `decimals` figures after the point, as the
 * language writes it on an axis: "30 min" and "1.5 sec" in English, "30
 * Min." in German, "۳۰ دقیقه" in Persian, "30 د" in Arabic. A language
 * Intl cannot write the unit in keeps English's symbol, beside its own
 * figure.
 */
function writeDurationPart(
  count: number,
  decimals: number,
  unit: DurationAxisUnit,
  language: string | undefined,
): string {
  const written: string = toFixedFigures(count, decimals);

  if (isEnglishDateLanguage(language)) {
    return `${written}${NO_BREAK_SPACE}${unit.english}`;
  }

  const figure: string =
    writeNumberInLanguage(written, false, language)?.value || written;
  const timeWord: { word: string; gap: string; isBefore: boolean } | null =
    writeTimeWordInLanguage(written, unit.timeWord, language, "short");

  if (!timeWord) {
    return `${figure}${NO_BREAK_SPACE}${unit.english}`;
  }

  const gap: string = timeWord.gap ? NO_BREAK_SPACE : "";

  return timeWord.isBefore
    ? `${timeWord.word}${gap}${figure}`
    : `${figure}${gap}${timeWord.word}`;
}

// One Intl format per language, figures and decimals: a clock's figures.
const clockFigureFormats: Map<string, Intl.NumberFormat | null> = new Map<
  string,
  Intl.NumberFormat | null
>();

/*
 * A clock's figure: `value` with at least `integerDigits` digits before
 * the point and `decimals` after it, in the language's digits and decimal
 * sign - "05", "02.5", "۰۵", "02,5".
 */
function writeClockFigure(
  value: number,
  integerDigits: number,
  decimals: number,
  language: string | undefined,
): string {
  if (!isEnglishDateLanguage(language)) {
    const key: string = [(language || "").trim(), integerDigits, decimals].join(
      "|",
    );

    if (!clockFigureFormats.has(key)) {
      let format: Intl.NumberFormat | null = null;

      try {
        format = new Intl.NumberFormat(getNumberLocale(language), {
          minimumIntegerDigits: integerDigits,
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: false,
        });
      } catch {
        format = null;
      }

      clockFigureFormats.set(key, format);
    }

    const format: Intl.NumberFormat | null =
      clockFigureFormats.get(key) || null;

    if (format) {
      return format.format(value);
    }
  }

  const [whole, fraction] = value.toFixed(decimals).split(".");

  return `${(whole || "0").padStart(integerDigits, "0")}${fraction ? `.${fraction}` : ""}`;
}

const clockSeparators: Map<string, string> = new Map<string, string>();

/*
 * What the language sets between a clock's hours and minutes: ":" in
 * English and Persian, "." in Danish, as its times of day are written.
 */
function getClockSeparator(language: string | undefined): string {
  const key: string = (language || "").trim();

  if (isEnglishDateLanguage(key)) {
    return ":";
  }

  if (!clockSeparators.has(key)) {
    let separator: string = ":";

    try {
      const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
        getNumberLocale(key),
        {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "UTC",
        },
      ).formatToParts(new Date(Date.UTC(2000, 0, 1, 13, 30)));
      const hourAt: number = parts.findIndex(
        (part: Intl.DateTimeFormatPart): boolean => {
          return part.type === "hour";
        },
      );
      const between: Intl.DateTimeFormatPart | undefined = parts[hourAt + 1];

      if (
        hourAt >= 0 &&
        between &&
        between.type === "literal" &&
        between.value.trim()
      ) {
        separator = between.value.trim();
      }
    } catch {
      separator = ":";
    }

    clockSeparators.set(key, separator);
  }

  return clockSeparators.get(key) || ":";
}

// What the language writes before a negative figure: "-", or Persian's marked minus.
function getMinusSign(language: string | undefined): string {
  const minusOne: string | undefined = writeNumberInLanguage(
    "-1",
    false,
    language,
  )?.value;
  const one: string | undefined = writeNumberInLanguage(
    "1",
    false,
    language,
  )?.value;

  if (minusOne && one && minusOne.endsWith(one)) {
    return minusOne.slice(0, minusOne.length - one.length) || "-";
  }

  return "-";
}

/*
 * A span of `seconds` on an axis stepping `stepInSeconds` at a time whose
 * largest tick is `largestInSeconds`, a minute or more: in units, or as a
 * clock where that takes three units or more. Null for a step no clock
 * writes, and the value is scaled as it always was.
 */
function writeDurationInUnits(input: {
  seconds: number;
  stepInSeconds: number;
  largestInSeconds: number;
  language: string | undefined;
}): string | null {
  const step: number = Math.abs(input.stepInSeconds);

  // The step's unit: the largest unit of time it is a whole number of.
  let stepUnitIndex: number = SECOND_UNIT_INDEX;

  for (let index: number = 0; index < DURATION_AXIS_UNITS.length; index++) {
    const ratio: number =
      step / (DURATION_AXIS_UNITS[index] as DurationAxisUnit).seconds;

    if (ratio >= 1 - 1e-9 && Math.abs(ratio - Math.round(ratio)) < 1e-6) {
      stepUnitIndex = index;
      break;
    }
  }

  const decimals: number =
    stepUnitIndex === SECOND_UNIT_INDEX ? getDecimalsForStep(step) ?? 0 : 0;

  if (decimals > MOST_CLOCK_DECIMALS) {
    return null;
  }

  // What one of the value's last figure stands for, in seconds.
  const resolution: number =
    stepUnitIndex === SECOND_UNIT_INDEX
      ? Math.pow(10, -decimals)
      : (DURATION_AXIS_UNITS[stepUnitIndex] as DurationAxisUnit).seconds;
  const count: number = Math.round(Math.abs(input.seconds) / resolution);

  if (!Number.isSafeInteger(count)) {
    return null;
  }

  // The value in each unit, from days down to the step's.
  const amounts: Array<number> = [];
  let rest: number = count;

  for (let index: number = 0; index <= stepUnitIndex; index++) {
    if (index === stepUnitIndex) {
      amounts.push(
        index === SECOND_UNIT_INDEX
          ? Number((rest * resolution).toFixed(decimals))
          : rest,
      );
      break;
    }

    const size: number = Math.round(
      (DURATION_AXIS_UNITS[index] as DurationAxisUnit).seconds / resolution,
    );
    const amount: number = Math.floor(rest / size);

    amounts.push(amount);
    rest -= amount * size;
  }

  const topUnitIndex: number =
    input.largestInSeconds >= 86400
      ? 0
      : input.largestInSeconds >= 3600
        ? 1
        : 2;
  const minus: string =
    input.seconds < 0 && count > 0 ? getMinusSign(input.language) : "";

  // Three units or more: a clock, its days in front ("12 d 05:30").
  if (stepUnitIndex - topUnitIndex + 1 >= 3) {
    const figures: Array<string> = [];
    const hasDays: boolean = topUnitIndex === 0;

    for (let index: number = 1; index <= stepUnitIndex; index++) {
      figures.push(
        writeClockFigure(
          amounts[index] || 0,
          index === 1 && !hasDays ? 1 : 2,
          index === SECOND_UNIT_INDEX ? decimals : 0,
          input.language,
        ),
      );
    }

    const clock: string = figures.join(getClockSeparator(input.language));

    return hasDays
      ? `${minus}${writeDurationPart(
          amounts[0] || 0,
          0,
          DURATION_AXIS_UNITS[0] as DurationAxisUnit,
          input.language,
        )}${NO_BREAK_SPACE}${clock}`
      : `${minus}${clock}`;
  }

  // In units, those that are zero left out: "1 h 30 min", "45 min".
  const parts: Array<string> = [];

  amounts.forEach((amount: number, index: number): void => {
    if (amount !== 0) {
      parts.push(
        writeDurationPart(
          amount,
          index === SECOND_UNIT_INDEX ? decimals : 0,
          DURATION_AXIS_UNITS[index] as DurationAxisUnit,
          input.language,
        ),
      );
    }
  });

  if (parts.length === 0) {
    parts.push(
      writeDurationPart(
        0,
        stepUnitIndex === SECOND_UNIT_INDEX ? decimals : 0,
        DURATION_AXIS_UNITS[stepUnitIndex] as DurationAxisUnit,
        input.language,
      ),
    );
  }

  return `${minus}${parts.join(NO_BREAK_SPACE)}`;
}

/*
 * A span of time under a minute, scaled as the seconds table scales it,
 * with the figures the step needs: "45 sec", "1.25 sec", "250 ms". A zero
 * is written in the unit the step is: "0 ms" beside "250 ms", not "0.00
 * sec".
 */
function scaleDurationUnderAMinute(
  seconds: number,
  stepInSeconds: number,
): ScaledValue {
  if (seconds === 0) {
    const stepUnit: UnitThreshold =
      secondUnits.find((threshold: UnitThreshold): boolean => {
        return Math.abs(stepInSeconds) >= threshold.threshold;
      }) || (secondUnits[secondUnits.length - 1] as UnitThreshold);

    return {
      value: formatNumber(0, stepIn(stepInSeconds, stepUnit.divisor)),
      unit: stepUnit.unit,
    };
  }

  return formatWithThresholds(seconds, secondUnits, stepInSeconds);
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
 * space, an empty unit contributes nothing, and everything else is set
 * apart by one space - a no-break one, so the figure and its unit share a
 * line (#8457): "1.5 MB", "2 hours", "300 Kelvin".
 */
function joinValueAndUnit(value: string, unit: string): string {
  if (unit === "") {
    return value;
  }
  if (unit === "%") {
    return `${value}%`;
  }
  // A count per second ("1/s" reads "/s"): "5/s", as a chart writes it.
  if (unit.startsWith("/")) {
    return `${value}${unit}`;
  }
  return `${value}${NO_BREAK_SPACE}${unit}`;
}

/*
 * A RATE AS A CHART WRITES IT: "req/s", "KiB/s", "ug/m3".
 *
 * A compound unit whose numerator the threshold tables do not scale (a
 * page's own "req/s" or "resp/s", an exporter's "{request}/s") was written
 * out in words, "100 req per Second": too wide for a chart's 64px y-axis,
 * so every tick wrapped over two lines and the top one was cut at the
 * card's edge, and "Second" was English, capitalised mid-phrase, in every
 * language (#8049). It keeps its slash now, as "1.5 MB/s" always has: each
 * part as its symbol where one is known ("s", "KiB"), an annotation as its
 * word ("{request}" reads "request"), a dimensionless "1" as nothing
 * ("1/s" reads "/s", drawn "5/s"), anything else as written. The words stay
 * where there is room for them, in the reader's language: the unit chip
 * and the metric's details (getReadableUnit, UnitNames).
 */
function getRateSymbol(unit: string): string {
  return unit
    .split("/")
    .map((part: string): string => {
      const trimmed: string = part.trim();
      const annotation: RegExpMatchArray | null =
        trimmed.match(/^\{([^{}]+)\}$/);

      if (annotation) {
        return (annotation[1] as string).trim();
      }

      const compact: string | undefined =
        compactUnitMap[normalizeUnit(trimmed)];
      return compact === undefined ? trimmed : compact;
    })
    .join("/");
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
 * One branch changed on purpose: a rate it cannot scale reads "100 req/s",
 * not "100 req per Second", which no chart axis had room for (#8049). And
 * the space before a unit is a no-break one (#8457): "1.5\u00A0MB".
 */
function formatValueParts(
  value: number,
  unit: string,
  options: ValueFormatterOptions | undefined,
  unitStyle: UnitStyle,
): FormattedValue {
  const trimmedUnit: string = (unit || "").trim();
  // The step of the axis the value is written on, when it handed one over (#10079).
  const step: number | undefined =
    typeof options?.step === "number" &&
    Number.isFinite(options.step) &&
    options.step !== 0
      ? Math.abs(options.step)
      : undefined;

  const build: (partValue: string, partUnit: string) => FormattedValue = (
    partValue: string,
    partUnit: string,
  ): FormattedValue => {
    // In the reader's language, when one is given (#7094).
    const inLanguage: {
      value: string;
      percentSign: string;
      formatted: string;
    } | null = writeNumberInLanguage(
      partValue,
      partUnit === "%",
      options?.language,
      step !== undefined,
    );

    if (inLanguage) {
      if (partUnit === "%") {
        return {
          value: inLanguage.value,
          unit: inLanguage.percentSign || partUnit,
          formatted: inLanguage.formatted,
        };
      }

      /*
       * A span of time named in words, in the language's words (#7518).
       * The compact style names it by its symbol ("h", "min"), as every
       * language may.
       */
      const timeWord: {
        word: string;
        gap: string;
        isBefore: boolean;
      } | null =
        unitStyle === "readable"
          ? writeTimeWordInLanguage(partValue, partUnit, options?.language)
          : null;

      if (timeWord) {
        return {
          value: inLanguage.value,
          unit: timeWord.word,
          formatted: timeWord.isBefore
            ? `${timeWord.word}${timeWord.gap}${inLanguage.value}`
            : `${inLanguage.value}${timeWord.gap}${timeWord.word}`,
        };
      }

      return {
        value: inLanguage.value,
        unit: partUnit,
        formatted: joinValueAndUnit(inLanguage.value, partUnit),
      };
    }

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
    return build(formatPercent(value * 100, stepIn(step, 0.01)), "%");
  }

  // OpenTelemetry uses "1" as the dimensionless marker — render as a bare number.
  if (trimmedUnit === "" || trimmedUnit === "1") {
    return build(formatNumber(value, step), "");
  }

  /*
   * "%" and its spelled-out / casual variants all render inline with no
   * separating space — `25.00%`, never `25 Percent`.
   */
  if (ValueFormatter.isPercentUnit(trimmedUnit)) {
    return build(formatPercent(value, step), "%");
  }

  /*
   * UCUM annotation-only units (e.g. "{thread}", "{packets}", "{errors}")
   * are dimensionless — the brace contents are descriptive only and the
   * value itself is the count. Render the bare number so chart y-axis
   * labels stay short and don't wrap into the plot area.
   */
  const annotationOnlyUnitPattern: RegExp = /^\{[^{}]*\}$/;
  if (annotationOnlyUnitPattern.test(trimmedUnit)) {
    return build(formatNumber(value, step), "");
  }

  const normalizedUnit: string = normalizeUnit(unit);

  /*
   * A span of time on an axis that hands its step over: in the natural
   * units of time the step needs, "1 h 30 min", never "1.5000 hours"
   * (issue #10118).
   */
  const durationUnitInSeconds: number | undefined =
    durationUnitInSecondsMap[normalizedUnit];

  if (step !== undefined && durationUnitInSeconds !== undefined) {
    const seconds: number = value * durationUnitInSeconds;
    const stepInSeconds: number = step * durationUnitInSeconds;
    const largestTick: number | undefined = options?.largestTick;
    const largestInSeconds: number = Math.max(
      Math.abs(seconds),
      typeof largestTick === "number" && Number.isFinite(largestTick)
        ? Math.abs(largestTick) * durationUnitInSeconds
        : 0,
    );

    if (largestInSeconds >= 60) {
      const written: string | null = writeDurationInUnits({
        seconds: seconds,
        stepInSeconds: stepInSeconds,
        largestInSeconds: largestInSeconds,
        language: options?.language,
      });

      if (written !== null) {
        return { value: written, unit: "", formatted: written };
      }
    }

    const scaled: ScaledValue = scaleDurationUnderAMinute(
      seconds,
      stepInSeconds,
    );

    return build(
      scaled.value,
      unitStyle === "compact" ? compactThresholdUnit(scaled.unit) : scaled.unit,
    );
  }

  const thresholds: Array<UnitThreshold> | undefined =
    unitTableMap[normalizedUnit];

  if (thresholds) {
    const scaled: ScaledValue = formatWithThresholds(value, thresholds, step);

    return build(
      scaled.value,
      unitStyle === "compact" ? compactThresholdUnit(scaled.unit) : scaled.unit,
    );
  }

  /*
   * Compound rate units like "By/s" or "ms/s". Scale the numerator with
   * its threshold table when we know one (so 1500000 By/s renders as
   * "1.5 MB/s" rather than "1500000 Bytes per Second"), and keep a
   * compact denominator. Any other compound unit keeps its slash too
   * ("100 req/s", getRateSymbol), never the words.
   */
  if (trimmedUnit.includes("/")) {
    const [numeratorRaw, ...denominatorParts] = trimmedUnit.split("/");
    const denominator: string = denominatorParts.join("/").trim();
    if (numeratorRaw && denominator) {
      const numeratorThresholds: Array<UnitThreshold> | undefined =
        unitTableMap[normalizeUnit(numeratorRaw)];
      if (numeratorThresholds) {
        const scaled: ScaledValue = formatWithThresholds(
          value,
          numeratorThresholds,
          step,
        );
        const scaledUnit: string =
          unitStyle === "compact"
            ? compactThresholdUnit(scaled.unit)
            : scaled.unit;
        return build(scaled.value, `${scaledUnit}/${denominator}`);
      }
    }

    return build(formatNumber(value, step), getRateSymbol(trimmedUnit));
  }

  /*
   * A unit no threshold table scales, written beside its value by its
   * symbol where it has one: "23.5 °C", "50 Hz", "230 V", "12 kW" - on a
   * chart's value axis, in its legend and tooltip, on a threshold line, in
   * a metric's row and on a Gauge alike. Its English name in words - "23.5
   * Celsius", "98.6 Fahrenheit" - was English on every tick of every
   * language's chart ("23,5 Celsius" in German, "۲۳٫۵ Celsius" in Persian)
   * and the widest tick on the axis (#8284); a symbol reads alike in every
   * language, as "ms", "MB/s" and "%" always have (units are kept in Latin
   * letters, Locales/ARABIC.md), and as Intl writes "°C" in Persian. The
   * words stay where there is room for a name, in the reader's language:
   * the unit chip and the metric's details (getReadableUnit, UnitNames). A
   * unit with no symbol ("Kelvin", "widgets") keeps its name: the reader's,
   * when the caller can name it (unitName, #7518), English otherwise.
   *
   */
  return build(
    formatNumber(value, step),
    unitStyle === "compact"
      ? ValueFormatter.getCompactUnit(unit, options)
      : getValueSymbol(trimmedUnit) ??
          (options?.unitName
            ? options.unitName(unit)
            : ValueFormatter.getReadableUnit(unit)),
  );
}

/*
 * The symbol a value is written with for a unit no threshold table scales:
 * compactUnitMap's ("°C", "Hz", "kW", "MiB"), and UCUM's ampere, "A",
 * which is case-sensitive - "a" is a year (an annum), so only the capital
 * is read as amperes. A span of time in minutes, hours or days reads as
 * the seconds table writes one ("2 hours", "5 min"), so the reader's
 * language words it as it words every span ("2 Stunden", "۲ ساعت").
 * Undefined for a unit with no symbol of its own.
 */
const TIME_UNIT_SYMBOLS: Record<string, string> = {
  min: "min",
  h: "hours",
  d: "days",
};

function getValueSymbol(unit: string): string | undefined {
  if (unit === "A") {
    return "A";
  }

  const symbol: string | undefined = compactUnitMap[normalizeUnit(unit)];

  if (symbol === undefined || symbol === "") {
    return undefined;
  }

  return TIME_UNIT_SYMBOLS[symbol] ?? symbol;
}

export default class ValueFormatter {
  /*
   * Format a value with a unit into a human-friendly string.
   * e.g. formatValue(1048576, "bytes") → "1 MB"
   * e.g. formatValue(3661, "seconds") → "1.02 hr"
   * e.g. formatValue(42, "%") → "42%"
   * e.g. formatValue(0.25, "1", { metricName: "system.cpu.utilization" }) → "25%"
   * e.g. formatValue(73.4, "%", { language: "de" }) → "73,40 %"
   */
  public static formatValue(
    value: number,
    unit: string,
    options?: ValueFormatterOptions,
  ): string {
    return formatValueParts(value, unit, options, "readable").formatted;
  }

  /*
   * formatValue, but returning the number and the unit separately, the unit
   * named as formatValue names it ("hours", "req/s"). For a
   * widget that draws the two at different sizes, as formatValueCompact is
   * for one that draws the unit's symbol: the Gauge split the joined string
   * at its last space, which put "requests per" in the big-number span and
   * cannot find the number in "73,40 %" or "۷۳٫۴۰٪".
   */
  public static formatValueInParts(
    value: number,
    unit: string,
    options?: ValueFormatterOptions,
  ): FormattedValue {
    return formatValueParts(value, unit, options, "readable");
  }

  /*
   * The figures after the point a value on an axis stepping `step` at a
   * time is written with (issue #10079): what the `step` option writes, for
   * a chart's own formatter that writes its figures itself ("99.95%" on an
   * SLO's axis stepping 0.05 at a time). Undefined for no usable step.
   */
  public static getDecimalsForStep(
    step: number | undefined,
  ): number | undefined {
    return getDecimalsForStep(step);
  }

  /*
   * The seconds one value of `unit` stands for, when it is a span of time
   * ("s" is 1, "ms" 0.001, "min" 60): what a chart hands a value axis in
   * that unit, so it steps in natural units of time (YAxisOptions'
   * durationUnitInSeconds, issue #10118). Undefined for any other unit, a
   * rate of time ("ms/s") among them.
   */
  public static getDurationUnitInSeconds(
    unit: string | undefined,
  ): number | undefined {
    return durationUnitInSecondsMap[normalizeUnit(unit || "")];
  }

  /*
   * Whether `parts` set their unit apart from the number - "1.5 MB", and
   * "73,40 %" in German - or write it right after it: "73.40%", "۷۳٫۴۰٪".
   * What a widget that draws the number and the unit in spans of their own
   * leaves between them.
   */
  public static isUnitSetApart(parts: FormattedValue): boolean {
    if (!parts.unit) {
      return false;
    }

    const valueStart: number = parts.formatted.indexOf(parts.value);

    if (valueStart < 0) {
      return parts.unit !== "%";
    }

    return STARTS_WITH_SPACE.test(
      parts.formatted.slice(valueStart + parts.value.length),
    );
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
      return getRateSymbol(trimmed);
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
    options?: ValueFormatterOptions,
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
   * `container.cpu.utilization` and `container.memory.percent` are not
   * excluded either, and need not be. OneUptime's Kubernetes agent sends
   * container.cpu.utilization as cores declared "1", and times 100 is a
   * percent of one core, which is right. The docker_stats receiver sends
   * both as a percent already (0-100) but declares "1"; ingest records
   * their unit as "%" (ContainerStatsPercentUnit) and the Docker, Podman and
   * Swarm agents now send "%" themselves, so they never reach this branch -
   * which multiplied a container's 4.36% of its memory limit to 436.64%.
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

    /*
     * A memory fragmentation ratio (the redis receiver's
     * `redis.memory.fragmentation_ratio`, redis_exporter's
     * `redis_mem_fragmentation_ratio`) is resident over allocated memory —
     * about 1.0 when healthy, 1.5 and up when fragmented, below 1 when the
     * host swaps — not a [0, 1] share, so it is shown as the ratio (1.62,
     * never "162.00%"). Anchored at the end like the suffix rule below, so
     * every other `_ratio` still renders as a percent. Also what a Value or
     * Gauge widget on it compares its thresholds against: the ratio's own
     * scale.
     */
    const memoryFragmentationRatio: RegExp = /fragmentation_ratio$/i;
    if (memoryFragmentationRatio.test(metricName.trim())) {
      return false;
    }

    /*
     * Same for a storage array's data reduction ratio (Pure's
     * `purefa_array_space_data_reduction_ratio`,
     * `purefb_file_systems_space_data_reduction_ratio`, ...): logical over
     * physical space, so 4.2 means 4.2:1 — never "420.00%".
     */
    const dataReductionRatio: RegExp = /data_reduction_ratio$/i;
    if (dataReductionRatio.test(metricName.trim())) {
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
   * Every name getReadableUnit gives a unit it knows ("Bytes",
   * "Milliseconds", "Percent"), once each: the charts draw them in the
   * reader's language (Common/UI/Components/Charts/Utils/UnitNames), and a
   * test holds that list to this one.
   */
  public static getReadableUnitNames(): Array<string> {
    return Array.from(
      new Set<string>(
        Object.values(readableUnitMap).filter((name: string): boolean => {
          return name.length > 0;
        }),
      ),
    );
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
      /*
       * A rate of a dimensionless count ("1/s", OpenTelemetry's "per
       * second") has no numerator to name: "per Second", where it read
       * " per Second", a space before its words in a unit chip.
       */
      if (!numerator) {
        return `per ${denominator}`;
      }
      return `${numerator} per ${denominator}`;
    }

    return getReadableUnitPart(unit);
  }
}
