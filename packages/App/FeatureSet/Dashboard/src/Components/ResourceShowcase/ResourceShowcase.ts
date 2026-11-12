import IconProp from "Common/Types/Icon/IconProp";
import {
  getNumberLocale,
  isEnglishDateLanguage,
} from "Common/Types/DateLanguage";
import { translationKey, Translator } from "Common/Types/Translator";
import { formatSloBurnRate } from "Common/Utils/Slo/SloWidgetFormat";

/*
 * What a resource list shows under its empty table while the project has
 * none of that resource: what the product gives once one is connected - a
 * pitch, an example of a connected one, and what comes with it - and the
 * list's Add button. The setup guide itself opens from Add (the list's Add
 * dialog), so an empty list no longer shows every step up front.
 *
 *   ┌ eyebrow · title · description      ┐ ┌ example: a connected one ┐
 *   │ [ Add … ]                          │ │ stats, a chart, rows      │
 *   └ three short facts about setup      ┘ └ (and the alert it raised) ┘
 *   ─ what you get: a grid of features ───────────────────────────────
 *
 * Each resource describes its own in a ResourceShowcase (Kubernetes
 * clusters, hosts, Docker and Podman hosts, Docker Swarm, Proxmox, VMware,
 * Ceph, storage arrays, IoT fleets, databases, queues, serverless
 * functions, cloud environments and RUM applications), and
 * ResourceShowcaseCard draws it. React-free, so App tests can read every
 * resource's words.
 *
 * Words are English translation keys (translationKey), looked up when they
 * are drawn. The example's own data - a name, a term the software itself
 * shows ("CrashLoopBackOff"), a code ("SEV 1") - is drawn as written in every
 * language. Its numbers are figures (ShowcaseFigure), written the way the
 * reader's language writes numbers, as the rest of the Dashboard writes
 * them: "1,284" in English is "1.284" in German and "۱٬۲۸۴" in Persian.
 */

/*
 * A number the example shows, written when it is drawn the way the reader's
 * language writes it (formatShowcaseFigure). Never English text: "1,284"
 * reads as one point two eight four to a German, Spanish or French reader,
 * whose languages write the decimal sign as a comma (issue #6535).
 *
 *   1284                          "1,284"   "1.284" (de)   "۱٬۲۸۴" (fa)
 *   { percent: 99.98 }            "99.98%"  "99,98 %"      "۹۹٫۹۸٪"
 *   { milliseconds: 184 }         "184 ms"  "184 ms"       "۱۸۴ میلی‌ثانیه"
 *   { seconds: 1.24 }             "1.24 s"  "1,24 Sek."
 *   { megabytes: 412 }            "412 MB"
 *   { gigabytes: 6.4 }            "6.4 GB"  "6,4 GB"
 *   { gigabitsPerSecond: 1.2 }    "1.2 Gbps" "1,2 Gb/s"
 *   { dBm: -67 }                  "-67 dBm"
 *   { abbreviated: 1820000 }      "1.82M"   "1,82 Mio."    "۱٫۸۲ میلیون"
 *   { usDollars: 4120 }           "$4,120"  "4.120 $"
 *   { burnRate: 0.4 }             "0.4×"    "0,4×"         as the SLO pages
 *   { toOne: 4.3 }                "4.3:1"   "4,3:1"
 *   { count: 11, outOf: 12 }      "11/12"                  "۱۱/۱۲"
 *   { percentUsed: 71 }           "71% used" "71 % belegt"
 *
 * English reads as the product's own English always has: its units are
 * the short symbols the rest of the product writes ("1.24 s", not Intl's
 * "1.24 sec"); every other language takes Intl's words for the unit, as a
 * duration on any other page does (formatDurationCompactInLanguage).
 */
export type ShowcaseFigure =
  // A count, or a reading with no unit (a load average: 2.14).
  | number
  | { percent: number }
  | { milliseconds: number }
  | { seconds: number }
  | { megabytes: number }
  | { gigabytes: number }
  | { gigabitsPerSecond: number }
  // Signal strength, which has no unit of Intl's: its symbol as written.
  | { dBm: number }
  // A count too large to read whole: a million and more, or thousands.
  | { abbreviated: number }
  | { usDollars: number }
  // An SLO's burn rate, written as the SLO pages write it (formatSloBurnRate).
  | { burnRate: number }
  // A ratio to one: a storage array's data reduction.
  | { toOne: number }
  // So many of so many: nodes ready, services up.
  | { count: number; outOf: number }
  /*
   * A share of a disk or a pool in use: "71% used", in the words the
   * Dashboard's own pages say it in (SHOWCASE_PERCENT_USED).
   */
  | { percentUsed: number };

/*
 * "71% used": the Dashboard's sentence for a disk's or a datastore's share
 * in use (the VMware and topology pages say it so), its percent written the
 * reader's way. Each language words it around the percent: "Занято 71 %",
 * "已使用 71%".
 */
export const SHOWCASE_PERCENT_USED: string = translationKey("{{percent}} used");

/*
 * A stat's value or a row's state: a figure, or text drawn as written - a
 * code ("SEV 1", "P2", an HTTP status "200") or a clock ("00:21:07"), never
 * a number written as text (ProductOnboardingRegistry's guard).
 */
export type ShowcaseValue = ShowcaseFigure | string;

export function isShowcaseFigure(
  value: ShowcaseValue | undefined,
): value is ShowcaseFigure {
  return value !== undefined && typeof value !== "string";
}

// Figures keep up to two decimals: "99.98%", "2.14", "1.24 s".
const SHOWCASE_FRACTION_DIGITS: number = 2;

// A large count keeps three digits: "1.82M", "42.2K", "482K".
const SHOWCASE_ABBREVIATED_DIGITS: number = 3;

// `value` as `language` writes it, with `options`; English if Intl cannot.
const writeNumber: (
  value: number,
  language: string,
  options: Intl.NumberFormatOptions,
) => string = (
  value: number,
  language: string,
  options: Intl.NumberFormatOptions,
): string => {
  try {
    return new Intl.NumberFormat(getNumberLocale(language), options).format(
      value,
    );
  } catch {
    return new Intl.NumberFormat("en", options).format(value);
  }
};

const writeDecimal: (value: number, language: string) => string = (
  value: number,
  language: string,
): string => {
  return writeNumber(value, language, {
    maximumFractionDigits: SHOWCASE_FRACTION_DIGITS,
  });
};

/*
 * An amount of a unit: the product's own English symbol in English ("1.24
 * s"), Intl's short unit in every other language ("1,24 Sek."). An engine
 * without the unit writes the number the reader's way and the symbol as
 * written.
 */
const writeUnit: (data: {
  amount: number;
  // Intl's unit: "millisecond".
  intlUnit: string;
  // The product's English symbol: "ms".
  englishSymbol: string;
  language: string;
}) => string = (data: {
  amount: number;
  intlUnit: string;
  englishSymbol: string;
  language: string;
}): string => {
  const asWritten: string = `${writeDecimal(data.amount, data.language)} ${
    data.englishSymbol
  }`;

  if (isEnglishDateLanguage(data.language)) {
    return asWritten;
  }

  try {
    return new Intl.NumberFormat(getNumberLocale(data.language), {
      style: "unit",
      unit: data.intlUnit,
      unitDisplay: "short",
      maximumFractionDigits: SHOWCASE_FRACTION_DIGITS,
    }).format(data.amount);
  } catch {
    return asWritten;
  }
};

/*
 * A figure as the reader's language writes it: its digits (Persian's own,
 * Latin in Arabic - getNumberLocale), its grouping and decimal signs, its
 * percent sign and spacing, its unit words and its abbreviations.
 */
export function formatShowcaseFigure(
  figure: ShowcaseFigure,
  translator: Translator,
): string {
  const language: string = translator.language;

  if (typeof figure === "number") {
    return writeDecimal(figure, language);
  }

  if ("percent" in figure) {
    return writeNumber(figure.percent / 100, language, {
      style: "percent",
      maximumFractionDigits: SHOWCASE_FRACTION_DIGITS,
    });
  }

  if ("percentUsed" in figure) {
    return translator.translateTemplate(SHOWCASE_PERCENT_USED, {
      percent: formatShowcaseFigure(
        { percent: figure.percentUsed },
        translator,
      ),
    });
  }

  if ("count" in figure) {
    // Two counts joined by a slash read as one number, as written.
    return `${writeDecimal(figure.count, language)}/${writeDecimal(
      figure.outOf,
      language,
    )}`;
  }

  if ("milliseconds" in figure) {
    return writeUnit({
      amount: figure.milliseconds,
      intlUnit: "millisecond",
      englishSymbol: "ms",
      language,
    });
  }

  if ("seconds" in figure) {
    return writeUnit({
      amount: figure.seconds,
      intlUnit: "second",
      englishSymbol: "s",
      language,
    });
  }

  if ("megabytes" in figure) {
    return writeUnit({
      amount: figure.megabytes,
      intlUnit: "megabyte",
      englishSymbol: "MB",
      language,
    });
  }

  if ("gigabytes" in figure) {
    return writeUnit({
      amount: figure.gigabytes,
      intlUnit: "gigabyte",
      englishSymbol: "GB",
      language,
    });
  }

  if ("gigabitsPerSecond" in figure) {
    return writeUnit({
      amount: figure.gigabitsPerSecond,
      intlUnit: "gigabit-per-second",
      englishSymbol: "Gbps",
      language,
    });
  }

  if ("dBm" in figure) {
    return `${writeDecimal(figure.dBm, language)} dBm`;
  }

  if ("abbreviated" in figure) {
    return writeNumber(figure.abbreviated, language, {
      notation: "compact",
      maximumSignificantDigits: SHOWCASE_ABBREVIATED_DIGITS,
    });
  }

  if ("usDollars" in figure) {
    const cents: number = Number.isInteger(figure.usDollars)
      ? 0
      : SHOWCASE_FRACTION_DIGITS;

    return writeNumber(figure.usDollars, language, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: cents,
      maximumFractionDigits: cents,
    });
  }

  if ("burnRate" in figure) {
    return (
      formatSloBurnRate(figure.burnRate, translator) ||
      writeDecimal(figure.burnRate, language)
    );
  }

  // A ratio to one: "4.3:1".
  return `${writeDecimal(figure.toOne, language)}:${writeDecimal(1, language)}`;
}

export enum ShowcaseStatus {
  Healthy = "healthy",
  Warning = "warning",
  Critical = "critical",
}

export interface ShowcaseFeature {
  icon: IconProp;
  // English translation keys: "Every workload, mapped" and a sentence.
  title: string;
  description: string;
}

export interface ShowcaseStat {
  // English translation key: "Pods".
  label: string;
  /*
   * A figure, written the reader's way (248, { percent: 63 }), or a code
   * or a clock drawn as written ("SEV 1", "00:21:07").
   */
  value: ShowcaseValue;
}

export interface ShowcaseRow {
  // The example's name, as drawn in every language: "checkout-7d9f8".
  name: string;
  // English translation key: "Deployment · payments".
  detail: string;
  status: ShowcaseStatus;
  /*
   * English translation key, or a term drawn as written: "CrashLoopBackOff".
   * Or a figure, written the reader's way: { milliseconds: 120 }.
   */
  statusText: ShowcaseValue;
}

// What OneUptime raised about the example: the warning row, as an alert.
export interface ShowcaseAlert {
  // English translation keys: "Incident created" and what happened.
  title: string;
  description: string;
}

export interface ShowcaseChart {
  // English translation key: "CPU usage".
  label: string;
  // The line's shape, left to right; any scale.
  values: Array<number>;
  /*
   * English translation key: the span the line covers, in the chart's
   * corner. "Last hour" when unset, as a metric's; a chart of each day's
   * spend says "Last 30 days".
   */
  range?: string | undefined;
}

// A connected one, as its overview shows it: an example, not the project's.
export interface ShowcasePreview {
  // As drawn in every language: "prod-eu-west".
  name: string;
  // English translation key: "Kubernetes 1.30 · 3 nodes".
  subtitle: string;
  // Four, as the overview's tiles.
  stats: Array<ShowcaseStat>;
  chart: ShowcaseChart;
  // Three or four, one of them in trouble.
  rows: Array<ShowcaseRow>;
  alert?: ShowcaseAlert | undefined;
  /*
   * English translation keys. The pill in the example's header, "Connected"
   * when unset; a product's example says its own ("Live").
   */
  badge?: string | undefined;
  /*
   * The pill's colour: healthy (green) when unset. An example whose header
   * names a state its rows draw in another colour says so (an alert that
   * is only Acknowledged is amber, in its row and its header alike).
   */
  badgeStatus?: ShowcaseStatus | undefined;
  /*
   * What a screen reader hears for the whole example: "An example of what
   * you see once one is connected." when unset.
   */
  description?: string | undefined;
}

export interface ResourceShowcase {
  // The product's icon, as in the navigation.
  icon: IconProp;
  // English translation keys.
  eyebrow: string;
  title: string;
  description: string;
  // Three short facts about getting started: "One Helm command".
  highlights: Array<string>;
  /*
   * A product's first steps (ProductOnboarding), two to four of them, drawn
   * as a numbered list in place of the highlights: the first is what the
   * showcase's button does ("Create a monitor").
   */
  steps?: Array<string> | undefined;
  // Six, in the order they are read; none leaves out "What you get".
  features: Array<ShowcaseFeature>;
  preview: ShowcasePreview;
}

// ---- the example's chart ---------------------------------------------------

export interface ShowcaseChartPaths {
  // The line itself.
  line: string;
  // The line, closed along the bottom: the area under it.
  area: string;
}

/*
 * How far the line stays from the box's top and bottom, so its stroke is
 * never cut by the edge.
 */
export const SHOWCASE_CHART_INSET: number = 2;

const toCoordinate: (value: number) => string = (value: number): string => {
  return Number(value.toFixed(2)).toString();
};

/**
 * The SVG paths of a chart's values in a width × height box: a smooth line
 * through every value (Catmull-Rom, as cubic Béziers), its highest value
 * near the top of the box and its lowest near the bottom, and the area under
 * it. A flat line - or a single value - runs through the middle; no values
 * draw nothing.
 */
export function getShowcaseChartPaths(data: {
  values: Array<number>;
  width: number;
  height: number;
}): ShowcaseChartPaths {
  const values: Array<number> = data.values.filter((value: number) => {
    return Number.isFinite(value);
  });

  if (values.length === 0) {
    return { line: "", area: "" };
  }

  const series: Array<number> =
    values.length === 1 ? [values[0]!, values[0]!] : values;

  const min: number = Math.min(...series);
  const max: number = Math.max(...series);
  const top: number = SHOWCASE_CHART_INSET;
  const bottom: number = data.height - SHOWCASE_CHART_INSET;
  const step: number = data.width / (series.length - 1);

  const points: Array<{ x: number; y: number }> = series.map(
    (value: number, index: number): { x: number; y: number } => {
      const share: number = max === min ? 0.5 : (value - min) / (max - min);
      return {
        x: index * step,
        y: bottom - share * (bottom - top),
      };
    },
  );

  let line: string = `M${toCoordinate(points[0]!.x)} ${toCoordinate(points[0]!.y)}`;

  for (let index: number = 1; index < points.length; index++) {
    const previous: { x: number; y: number } = points[index - 1]!;
    const current: { x: number; y: number } = points[index]!;
    const before: { x: number; y: number } = points[index - 2] || previous;
    const after: { x: number; y: number } = points[index + 1] || current;

    // Control points a sixth of the way along the neighbours' chord.
    const firstX: number = previous.x + (current.x - before.x) / 6;
    const firstY: number = clamp(
      previous.y + (current.y - before.y) / 6,
      top,
      bottom,
    );
    const secondX: number = current.x - (after.x - previous.x) / 6;
    const secondY: number = clamp(
      current.y - (after.y - previous.y) / 6,
      top,
      bottom,
    );

    line += ` C${toCoordinate(firstX)} ${toCoordinate(firstY)} ${toCoordinate(
      secondX,
    )} ${toCoordinate(secondY)} ${toCoordinate(current.x)} ${toCoordinate(
      current.y,
    )}`;
  }

  const lastX: string = toCoordinate(points[points.length - 1]!.x);
  const firstX: string = toCoordinate(points[0]!.x);
  const area: string = `${line} L${lastX} ${toCoordinate(
    data.height,
  )} L${firstX} ${toCoordinate(data.height)} Z`;

  return { line, area };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
