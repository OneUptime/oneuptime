import {
  formatReaderFigure,
  formatUnitAmount,
  getNumberLocale,
  isEnglishDateLanguage,
} from "../Types/DateLanguage";
import {
  NO_BREAK_SPACE,
  withNumbersKeptWithUnits,
} from "../Types/NoBreakSpaces";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  translationKey,
  Translator,
} from "../Types/Translator";

/*
 * A DURATION IN MILLISECONDS, IN THE READER'S LANGUAGE.
 *
 * Every monitor type's summary - the monitor's Summary card, Test Monitor's
 * result, Monitoring Logs' View Summary, the incident and alert pages'
 * evaluation - built its Response Time (and a ping's jitter and round
 * trips, a port's and a request's phases, a script's execution time) as
 * `responseTimeInMs + " ms"`, and the monitor overview's Latest result and
 * its Probes card did the same (issues #7224, #7416). On an Arabic or
 * Persian page the browser lays that English text out from the right, so it
 * read "ms 411", and in Persian its digits stayed Latin (411, not ۴۱۱)
 * beside the card's own Persian date.
 *
 * Each is now one key, "{{value}} ms", which every language words with its
 * own unit, in its own order ("411 ms", "411 мс", "411 毫秒", "۴۱۱
 * میلی‌ثانیه", "411 ملي ث": Intl's short unit, as Locales/ARABIC.md says a
 * duration is written), with the figure as the reader's language writes a
 * number (translator.formatNumber: "1,234" / "1.234" / "۱٬۲۳۴", Latin
 * digits in Arabic). English reads "411 ms" as before; a figure of a
 * thousand or more takes its thousands separator ("1,234 ms"), as the
 * Retry Attempts lines under it already wrote it.
 *
 * It lives in Common, React-free, so a shared helper that writes a page's
 * words with the reader's Translator (MonitorOverviewPresentationUtil, for
 * the overview's hero) writes a duration exactly as the Dashboard's views
 * do. The Dashboard's Utils/Milliseconds re-exports it: one helper, never
 * two copies. Without a translator's own wording (the server, a unit test)
 * it writes English.
 *
 * The rest of the Dashboard wrote its durations by hand too (issue #7418):
 * a trace's p95 as `${ms.toFixed(1)} ms`, a database's latency, a queue's
 * processing time, a cloud metric, a review's p99, a ping's round trip,
 * a breadcrumb's offset - "۱۲٫۴ ms" in Persian at best. Each is this
 * helper now, its precision kept: minimumFractionDigits writes the
 * decimals toFixed wrote ("5.0 ms"), so English reads exactly as it did,
 * a figure of a thousand or more aside.
 *
 * A guard (Common Tests/UI/MillisecondsInReadersLanguageGuard) refuses a
 * duration built as `x + " ms"` anywhere in the Dashboard, and any "ms"
 * written beside a figure in any of the Dashboard's files.
 */
export const MILLISECONDS_TEMPLATE: string = translationKey("{{value}} ms");

export interface MillisecondsOptions {
  /*
   * At most this many decimals, rounded as Math.round rounds: 0 for whole
   * milliseconds, 2 for a phase of a request ("31.27 ms"). Left out, the
   * figure is written as translator.formatNumber writes it (up to three).
   */
  maximumFractionDigits?: number | undefined;
  /*
   * At least this many decimals, as toFixed writes them: 1 for a latency
   * read to a tenth ("5.0 ms", "۵٫۰ میلی‌ثانیه"), so a column of them
   * lines up. Left out, trailing zeros are dropped ("5 ms").
   */
  minimumFractionDigits?: number | undefined;
  /*
   * The figure's sign, a plus too: an offset from a moment, "-880 ms"
   * before it and "+880 ms" after it. The plus is written the way the
   * language writes its minus, marks and all (Persian's and Arabic's come
   * with a left-to-right mark), so on a page read from the right both
   * signs stand on the same side of their digits.
   */
  showsSign?: boolean | undefined;
}

// The minus a language writes: "-" in most, U+2212 in Persian and Swedish.
const MINUS_SIGN: RegExp = /[-\u{2212}]/u;

// A count of decimals Intl accepts, and the figure is rounded to: 0 to 3.
const toFractionDigits: (digits: number) => number = (
  digits: number,
): number => {
  return Math.max(0, Math.min(3, Math.floor(digits)));
};

/*
 * The figure as the reader's language writes a number, with at least
 * `minimumFractionDigits` decimals: translator.formatNumber's own digits,
 * grouping and decimal sign ("1,234.0", "1.234,0", "۱٬۲۳۴٫۰").
 */
const formatUnsignedFigure: (
  translator: Translator,
  figure: number,
  options: MillisecondsOptions | undefined,
) => string = (
  translator: Translator,
  figure: number,
  options: MillisecondsOptions | undefined,
): string => {
  if (options?.minimumFractionDigits === undefined) {
    return translator.formatNumber(figure);
  }

  const minimum: number = toFractionDigits(options.minimumFractionDigits);
  const maximum: number = Math.max(
    minimum,
    options.maximumFractionDigits === undefined
      ? 3
      : toFractionDigits(options.maximumFractionDigits),
  );
  const format: Intl.NumberFormatOptions = {
    minimumFractionDigits: minimum,
    maximumFractionDigits: maximum,
  };

  try {
    return figure.toLocaleString(getNumberLocale(translator.language), format);
  } catch {
    return figure.toLocaleString(undefined, format);
  }
};

// The figure, signed when the options ask: "-880", "+880", "‎−۸۸۰", "‎+۸۸۰".
const formatFigure: (
  translator: Translator,
  figure: number,
  options: MillisecondsOptions | undefined,
) => string = (
  translator: Translator,
  figure: number,
  options: MillisecondsOptions | undefined,
): string => {
  if (!options?.showsSign) {
    return formatUnsignedFigure(translator, figure, options);
  }

  // Written as a negative figure, so the plus takes the minus's place.
  const negative: string = formatUnsignedFigure(
    translator,
    -Math.abs(figure),
    options,
  );

  if (figure < 0) {
    return negative;
  }

  return MINUS_SIGN.test(negative)
    ? negative.replace(MINUS_SIGN, "+")
    : `+${negative}`;
};

// A duration's figure, rounded to the decimals asked for.
export const roundMilliseconds: (
  milliseconds: number,
  maximumFractionDigits?: number | undefined,
) => number = (
  milliseconds: number,
  maximumFractionDigits?: number | undefined,
): number => {
  if (maximumFractionDigits === undefined) {
    return milliseconds;
  }

  const scale: number = Math.pow(10, toFractionDigits(maximumFractionDigits));

  return Math.round(milliseconds * scale) / scale;
};

/*
 * "411 ms" in the reader's language. A value that is not a number (a
 * reading the probe did not make) reads "-", as every missing fact does.
 */
export const formatMilliseconds: (
  translator: Translator,
  milliseconds: number,
  options?: MillisecondsOptions,
) => string = (
  translator: Translator,
  milliseconds: number,
  options?: MillisecondsOptions,
): string => {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds)) {
    return "-";
  }

  return translator.translateTemplate(MILLISECONDS_TEMPLATE, {
    value: formatFigure(
      translator,
      roundMilliseconds(milliseconds, options?.maximumFractionDigits),
      options,
    ),
  });
};

/*
 * A SPAN OF TIME IN ANOTHER UNIT, IN THE READER'S LANGUAGE.
 *
 * The formatters that write a span in milliseconds write a shorter one in
 * microseconds and a longer one in seconds or minutes, and wrote those by
 * hand: `${(ms / 1000).toFixed(2)} s`. On a Persian chart a tick read
 * "۴۲ میلی‌ثانیه" and the one above it "1.50 s" (#8349). Written here, the
 * figure keeps the decimals toFixed wrote, in the reader's digits and
 * decimal sign, and the unit is the language's own short one, as Intl
 * writes it and every other duration DateLanguage writes reads (Locales/
 * ARABIC.md): "1,50 Sek.", "۱٫۵۰ ثانیه", "1.50 ث", "2,5 Min.". English
 * reads exactly as the caller wrote it (`english`, "1.50 s" when left
 * out), and so does a language whose engine cannot write the unit, with
 * the figure in its digits. The same formatters' nanoseconds are written
 * here too (#8348).
 *
 * In every language the figure stays on the line of its unit: the space
 * between them, the caller's English one or the one Intl writes (a plain
 * U+0020 in most languages), is a no-break space (#8302, #8303).
 */
export type DurationInUnit =
  | "nanosecond"
  | "microsecond"
  | "second"
  | "minute"
  | "hour"
  | "day";

const DURATION_UNIT_SYMBOLS: Record<DurationInUnit, string> = {
  nanosecond: "ns",
  microsecond: "µs",
  second: "s",
  minute: "min",
  hour: "h",
  day: "d",
};

export interface DurationInUnitOptions {
  // The decimals the figure is written with, as toFixed's argument.
  decimals: number;
  // Up to `decimals`, trailing zeros dropped: 5.0 -> "5", 2.50 -> "2.5".
  dropTrailingZeros?: boolean | undefined;
  // What English reads, exactly: "1.50 s" (`${toFixed} ${symbol}`) when left out.
  english?: string | undefined;
}

export const formatDurationInUnit: (
  translator: Translator,
  value: number,
  unit: DurationInUnit,
  options: DurationInUnitOptions,
) => string = (
  translator: Translator,
  value: number,
  unit: DurationInUnit,
  options: DurationInUnitOptions,
): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  const decimals: number = Math.max(
    0,
    Math.min(3, Math.floor(options.decimals)),
  );
  const fixed: string = value.toFixed(decimals);
  const english: string =
    options.english === undefined
      ? `${options.dropTrailingZeros ? Number(fixed).toString() : fixed}${NO_BREAK_SPACE}${
          DURATION_UNIT_SYMBOLS[unit]
        }`
      : withNumbersKeptWithUnits(options.english, options.english);

  if (isEnglishDateLanguage(translator.language)) {
    return english;
  }

  /*
   * Rounded once, as toFixed rounds it, so every language says the same
   * figure; the unit held to it, and a unit of two words held together
   * (Hindi's "नैनो से॰", #8304), as DateLanguage holds every unit Intl
   * writes (#8456).
   */
  const held: string | null = formatUnitAmount({
    value: Number(fixed),
    unit: unit,
    locale: translator.language,
    unitDisplay: "short",
    minimumFractionDigits: options.dropTrailingZeros ? 0 : decimals,
    maximumFractionDigits: decimals,
  });

  if (held === null) {
    return `${formatReaderFigure(Number(fixed), {
      decimals: decimals,
      dropTrailingZeros: options.dropTrailingZeros,
      language: translator.language,
    })}${NO_BREAK_SPACE}${DURATION_UNIT_SYMBOLS[unit]}`;
  }

  return held;
};

// English, as the server and a translator without wording write it.
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

/*
 * "411 ms" in English, whatever the reader's language: for the AI chat's
 * PDF export alone, which is written in English in Latin-1 and holds no
 * Persian digit. Everything a reader reads on a page takes
 * formatMilliseconds with the reader's translator - a chart's value axis
 * and its tooltip too, as the tiles beside them do (#8349; the rule is
 * Docs/ux/README.md#numbers-dates-and-plurals, and
 * ChartValueAxesInReadersLanguageGuard keeps this one in the PDF).
 */
export const formatMillisecondsInEnglish: (
  milliseconds: number,
  options?: MillisecondsOptions,
) => string = (milliseconds: number, options?: MillisecondsOptions): string => {
  return formatMilliseconds(ENGLISH, milliseconds, options);
};
