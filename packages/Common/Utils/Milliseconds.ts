import {
  formatReaderFigure,
  getNumberLocale,
  isEnglishDateLanguage,
  rememberEnglishOf,
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

// English, as the server and a translator without wording write it.
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

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

const durationUnitFormats: Map<string, Intl.NumberFormat | null> = new Map<
  string,
  Intl.NumberFormat | null
>();

const getDurationUnitFormat: (
  language: string,
  unit: DurationInUnit,
  decimals: number,
  dropTrailingZeros: boolean,
) => Intl.NumberFormat | null = (
  language: string,
  unit: DurationInUnit,
  decimals: number,
  dropTrailingZeros: boolean,
): Intl.NumberFormat | null => {
  const key: string = [language, unit, decimals, dropTrailingZeros].join("|");

  if (!durationUnitFormats.has(key)) {
    let format: Intl.NumberFormat | null = null;

    try {
      format = new Intl.NumberFormat(getNumberLocale(language), {
        style: "unit",
        unit: unit,
        unitDisplay: "short",
        minimumFractionDigits: dropTrailingZeros ? 0 : decimals,
        maximumFractionDigits: decimals,
      } as Intl.NumberFormatOptions);

      // An engine without the unit style writes the bare number.
      const writesUnit: boolean = format
        .formatToParts(2)
        .some((part: Intl.NumberFormatPart): boolean => {
          return (part.type as string) === "unit";
        });

      if (!writesUnit) {
        format = null;
      }
    } catch {
      format = null;
    }

    durationUnitFormats.set(key, format);
  }

  return durationUnitFormats.get(key) || null;
};

// A space a line breaks at, between a figure and its unit.
const BREAKING_SPACES: RegExp = /[ \u2000-\u2006\u2008-\u200A\u205F]+/g;

/*
 * What Intl writes, the space between the figure and its unit held, and
 * any space inside a unit of two words too (Hindi's "नैनो से॰", #8304).
 */
const writeHeld: (format: Intl.NumberFormat, value: number) => string = (
  format: Intl.NumberFormat,
  value: number,
): string => {
  const parts: Array<Intl.NumberFormatPart> = format.formatToParts(value);

  return parts
    .map((part: Intl.NumberFormatPart, index: number): string => {
      const before: string | undefined = parts[index - 1]?.type;
      const after: string | undefined = parts[index + 1]?.type;
      const isUnit: boolean = (part.type as string) === "unit";
      const isBesideAUnit: boolean =
        part.type === "literal" &&
        ((before as string) === "unit" || (after as string) === "unit");

      return isUnit || isBesideAUnit
        ? part.value.replace(BREAKING_SPACES, NO_BREAK_SPACE)
        : part.value;
    })
    .join("");
};

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

  const format: Intl.NumberFormat | null = getDurationUnitFormat(
    translator.language,
    unit,
    decimals,
    Boolean(options.dropTrailingZeros),
  );

  if (!format) {
    return `${formatReaderFigure(Number(fixed), {
      decimals: decimals,
      dropTrailingZeros: options.dropTrailingZeros,
      language: translator.language,
    })}${NO_BREAK_SPACE}${DURATION_UNIT_SYMBOLS[unit]}`;
  }

  // Rounded once, as toFixed rounds it, so every language says the same figure.
  return writeHeld(format, Number(fixed));
};

/*
 * A COMPACT DURATION, IN THE READER'S LANGUAGE.
 *
 * Beside its spaced units the Dashboard wrote its short durations by hand,
 * with no space (#8455): a Kubernetes object's age `${diffSec}s`, a task's
 * `${minutes}m ${rest}s`, a host's uptime `${days}d ${hours}h`, a session's
 * length, an SLA's countdown, a discovery scan's run time. English letters
 * and Latin digits in every language: "4m 05s" on a Persian page, beside
 * its Persian dates.
 *
 * Each is written here now, with the Dashboard's compact keys, which every
 * language words with its own short units ("{{count}}s" is "{{count}} Sek."
 * in German, "{{count}} ثانیه" in Persian, "{{count}} ث" in Arabic), and
 * each figure as the reader's language writes a number (formatReaderFigure:
 * Persian digits, Latin ones in Arabic, a decimal comma in German). A pair
 * of units next to each other is one key ("{{minutes}}m {{seconds}}s"), so
 * a language words the pair as it says it; any other set of units is each
 * unit's own key, one after another ("1h 2m 3s"). A field a clock writes in
 * two digits ("4m 05s") is the reader's zero, then the reader's digit.
 *
 * English reads exactly as the hand-written text did: "12s", "4m 05s",
 * "1h 02m", "1234d 5h", "1.5s". The text is remembered with its English
 * (rememberEnglishOf), so a sentence the reader's language has not worded
 * yet - read in English - puts "4m 05s" back, never "4 Min. 05 s" among
 * English words.
 *
 * A guard (Common Tests/UI/MillisecondsInReadersLanguageGuard) refuses a
 * compact duration written by hand in the Dashboard and the shared UI.
 */
export type CompactDurationUnit =
  | "years"
  | "months"
  | "days"
  | "hours"
  | "minutes"
  | "seconds";

// The units, largest first: the order a compact duration names them in.
const COMPACT_DURATION_UNITS: ReadonlyArray<CompactDurationUnit> = [
  "years",
  "months",
  "days",
  "hours",
  "minutes",
  "seconds",
];

// A count of each unit it names: { minutes: 4, seconds: 5 } is "4m 05s".
export type CompactDuration = Partial<Record<CompactDurationUnit, number>>;

// "12s", "5m", "3h", "2d", "4mo", "2y": one unit on its own.
export const COMPACT_DURATION_TEMPLATES: Readonly<
  Record<CompactDurationUnit, string>
> = {
  years: translationKey("{{count}}y"),
  months: translationKey("{{count}}mo"),
  days: translationKey("{{count}}d"),
  hours: translationKey("{{count}}h"),
  minutes: translationKey("{{count}}m"),
  seconds: translationKey("{{count}}s"),
};

// "12s ago", "5m ago": one unit, as an age.
export const COMPACT_DURATION_AGO_TEMPLATES: Readonly<
  Record<CompactDurationUnit, string>
> = {
  years: translationKey("{{count}}y ago"),
  months: translationKey("{{count}}mo ago"),
  days: translationKey("{{count}}d ago"),
  hours: translationKey("{{count}}h ago"),
  minutes: translationKey("{{count}}m ago"),
  seconds: translationKey("{{count}}s ago"),
};

interface CompactDurationPair {
  larger: CompactDurationUnit;
  smaller: CompactDurationUnit;
  template: string;
}

// Two units next to each other, worded as a pair: "4m 05s", "1h 02m", "2d 5h".
const COMPACT_DURATION_PAIRS: ReadonlyArray<CompactDurationPair> = [
  {
    larger: "minutes",
    smaller: "seconds",
    template: translationKey("{{minutes}}m {{seconds}}s"),
  },
  {
    larger: "hours",
    smaller: "minutes",
    template: translationKey("{{hours}}h {{minutes}}m"),
  },
  {
    larger: "days",
    smaller: "hours",
    template: translationKey("{{days}}d {{hours}}h"),
  },
];

export interface CompactDurationOptions {
  /*
   * The smallest unit's decimals, as toFixed's argument: 1 for a step's
   * "1.5s". The other units are whole. Left out, every unit is whole.
   */
  decimals?: number | undefined;
  // Up to `decimals`, trailing zeros dropped: 2.50 -> "2.5s", 30.0 -> "30s".
  dropTrailingZeros?: boolean | undefined;
  /*
   * Every unit after the first in two digits, as a clock writes it: "4m
   * 05s", "1h 02m" - in Persian "۴ دقیقه ۰۵ ثانیه", the reader's zero
   * before the reader's digit.
   */
  padsAfterTheFirst?: boolean | undefined;
}

// A unit's count, as the reader's language writes it ("05" padded).
const writeCompactFigure: (
  translator: Translator,
  value: number,
  data: { decimals: number; dropTrailingZeros: boolean; isPadded: boolean },
) => string = (
  translator: Translator,
  value: number,
  data: { decimals: number; dropTrailingZeros: boolean; isPadded: boolean },
): string => {
  const figure: string = formatReaderFigure(value, {
    decimals: data.decimals,
    dropTrailingZeros: data.dropTrailingZeros,
    language: translator.language,
  });
  const rounded: number = Number(value.toFixed(data.decimals));

  if (!data.isPadded || rounded < 0 || rounded >= 10) {
    return figure;
  }

  return `${formatReaderFigure(0, {
    decimals: 0,
    language: translator.language,
  })}${figure}`;
};

const writeCompactDuration: (
  translator: Translator,
  duration: CompactDuration,
  options: CompactDurationOptions | undefined,
) => string = (
  translator: Translator,
  duration: CompactDuration,
  options: CompactDurationOptions | undefined,
): string => {
  const units: Array<CompactDurationUnit> = COMPACT_DURATION_UNITS.filter(
    (unit: CompactDurationUnit): boolean => {
      return duration[unit] !== undefined;
    },
  );

  if (units.length === 0) {
    units.push("seconds");
  }

  const decimals: number = Math.max(
    0,
    Math.min(3, Math.floor(options?.decimals || 0)),
  );
  const figures: Record<string, string> = {};

  units.forEach((unit: CompactDurationUnit, index: number): void => {
    const isSmallest: boolean = index === units.length - 1;

    figures[unit] = writeCompactFigure(translator, duration[unit] ?? 0, {
      decimals: isSmallest ? decimals : 0,
      dropTrailingZeros: isSmallest && Boolean(options?.dropTrailingZeros),
      isPadded: index > 0 && Boolean(options?.padsAfterTheFirst),
    });
  });

  const pair: CompactDurationPair | undefined =
    units.length === 2
      ? COMPACT_DURATION_PAIRS.find((candidate: CompactDurationPair) => {
          return (
            candidate.larger === units[0] && candidate.smaller === units[1]
          );
        })
      : undefined;

  if (pair) {
    return translator.translateTemplate(pair.template, {
      [pair.larger]: figures[pair.larger] as string,
      [pair.smaller]: figures[pair.smaller] as string,
    });
  }

  return units
    .map((unit: CompactDurationUnit): string => {
      return translator.translateTemplate(COMPACT_DURATION_TEMPLATES[unit], {
        count: figures[unit] as string,
      });
    })
    .join(" ");
};

// Whether every count a duration names is a number it can write.
const isWritable: (duration: CompactDuration) => boolean = (
  duration: CompactDuration,
): boolean => {
  return COMPACT_DURATION_UNITS.every((unit: CompactDurationUnit): boolean => {
    const value: number | undefined = duration[unit];

    return (
      value === undefined ||
      (typeof value === "number" && Number.isFinite(value))
    );
  });
};

// The text, remembered with its English for an English sentence that holds it.
const rememberedWithItsEnglish: (
  translator: Translator,
  text: string,
  english: () => string,
) => string = (
  translator: Translator,
  text: string,
  english: () => string,
): string => {
  if (!isEnglishDateLanguage(translator.language)) {
    const englishText: string = english();

    if (englishText !== text) {
      rememberEnglishOf(text, (): string => {
        return englishText;
      });
    }
  }

  return text;
};

/*
 * "12s", "4m 05s", "1h 02m", "2d 5h", "3mo" in the reader's language. The
 * caller works out the counts (its own rounding, the units it shows) and
 * hands in the ones it names, largest first or not: { hours: 1, minutes: 2
 * } is "1h 2m". A count that is not a number reads "-", as every missing
 * fact does.
 */
export const formatCompactDuration: (
  translator: Translator,
  duration: CompactDuration,
  options?: CompactDurationOptions,
) => string = (
  translator: Translator,
  duration: CompactDuration,
  options?: CompactDurationOptions,
): string => {
  if (!isWritable(duration)) {
    return "-";
  }

  return rememberedWithItsEnglish(
    translator,
    writeCompactDuration(translator, duration, options),
    (): string => {
      return writeCompactDuration(ENGLISH, duration, options);
    },
  );
};

/*
 * "12s ago", "5m ago", "3h ago", "2d ago", "4mo ago" in the reader's
 * language: one unit, as an age ("vor 5 Min.", "۵ دقیقه پیش"). The duration
 * names one unit; of several, the largest is said.
 */
export const formatCompactDurationAgo: (
  translator: Translator,
  duration: CompactDuration,
) => string = (translator: Translator, duration: CompactDuration): string => {
  const unit: CompactDurationUnit =
    COMPACT_DURATION_UNITS.find((candidate: CompactDurationUnit): boolean => {
      return duration[candidate] !== undefined;
    }) || "seconds";
  const value: number = duration[unit] ?? 0;

  if (!isWritable({ [unit]: value })) {
    return "-";
  }

  const write: (sentence: Translator) => string = (
    sentence: Translator,
  ): string => {
    return sentence.translateTemplate(COMPACT_DURATION_AGO_TEMPLATES[unit], {
      count: writeCompactFigure(sentence, value, {
        decimals: 0,
        dropTrailingZeros: false,
        isPadded: false,
      }),
    });
  };

  return rememberedWithItsEnglish(translator, write(translator), (): string => {
    return write(ENGLISH);
  });
};

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
