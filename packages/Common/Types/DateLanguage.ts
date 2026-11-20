/*
 * DATES, TIMES AND DURATIONS IN THE READER'S LANGUAGE.
 *
 * OneUptimeDate wrote every date with moment's English - "Oct 16 2026,
 * 10:12 AM BST", "5 hours ago", "2 days, 3 hours" - under a German or a
 * Japanese page. Each frontend now tells this module the language its reader
 * reads (setDateDisplayLanguage, from its i18n set-up), and OneUptimeDate
 * writes the words of a date in it: month and weekday names, "vor 5
 * Stunden", "2 Tage, 3 Stunden", a decimal comma. The words come from the
 * browser's Intl data, so no locale is shipped for them. The calendar is
 * always the Gregorian one, the one every timestamp, log and export is
 * written in; the digits are the language's own, so a Persian reader's
 * dates, times and durations ("۲۶ اکتبر، ۱۵:۰۷") are written in the same
 * digits as the counts and sentences around them.
 *
 * English is what nothing has set - the server, a worker, an email, a test -
 * and every function writes it exactly as it always has.
 *
 * A date often goes into a sentence ("Checked {{time}}"). A sentence is
 * wholly in the reader's language or wholly in English, never a German date
 * inside an English sentence: a language that has not worded the sentence
 * yet reads the English one. So every date written in another language is
 * remembered with its English (rememberEnglishOf), and the translation layer
 * puts the English back when it fills an English sentence (getEnglishOf), as
 * a component inside a sentence draws its date in the sentence's language
 * (withDateDisplayLanguage).
 *
 * A number Intl writes beside its unit stays on the line of its unit, in
 * every language: "vor 5 Minuten", "5 Min.", "2 Tage, 3 Stunden" (#8456,
 * A NUMBER KEEPS ITS UNIT ON ITS LINE below).
 *
 * React-free and free of the rest of OneUptime, so OneUptimeDate, the
 * translation layer and any frontend can use it.
 */

import moment from "moment-timezone";
import OldestKeyMap from "../Utils/OldestKeyMap";
import { NO_BREAK_SPACE } from "./NoBreakSpaces";

export const ENGLISH_DATE_LANGUAGE: string = "en";

let displayLanguage: string = ENGLISH_DATE_LANGUAGE;

// "en", "en-GB", "EN": English, written the way OneUptimeDate always has.
export const isEnglishDateLanguage: (
  language: string | null | undefined,
) => boolean = (language: string | null | undefined): boolean => {
  if (!language) {
    return true;
  }

  const lower: string = language.trim().toLowerCase();

  return lower === "" || lower === "en" || lower.startsWith("en-");
};

const normalizeLanguage: (language: string | null | undefined) => string = (
  language: string | null | undefined,
): string => {
  const trimmed: string = (language || "").trim();

  return isEnglishDateLanguage(trimmed) ? ENGLISH_DATE_LANGUAGE : trimmed;
};

// The language dates are written in right now: "en" unless a frontend set one.
export const getDateDisplayLanguage: () => string = (): string => {
  return displayLanguage;
};

/*
 * Set by each frontend from its i18n language, at start-up and on every
 * switch. Anything that is not a language Intl knows is written in English.
 */
export const setDateDisplayLanguage: (
  language: string | null | undefined,
) => void = (language: string | null | undefined): void => {
  displayLanguage = normalizeLanguage(language);
};

/*
 * `work`'s dates written in `language`: a date drawn inside a sentence takes
 * the sentence's language, which is English while the reader's language has
 * not worded the sentence.
 */
export function withDateDisplayLanguage<T>(
  language: string | null | undefined,
  work: () => T,
): T {
  const previous: string = displayLanguage;

  displayLanguage = normalizeLanguage(language);

  try {
    return work();
  } finally {
    displayLanguage = previous;
  }
}

/*
 * `work`'s dates written in English: for text that stays English whatever
 * the reader's language - an export, a prompt handed to OneUptime AI, a
 * message not translated yet - so it never holds a German date.
 */
export function inEnglishDates<T>(work: () => T): T {
  return withDateDisplayLanguage(ENGLISH_DATE_LANGUAGE, work);
}

/*
 * THE DIGITS A LANGUAGE WRITES.
 *
 * A language writes its counts, dates, times and durations in one set of
 * digits everywhere in the product. Persian writes its own, ۰ to ۹, and
 * every other language Latin ones, 0 to 9 - Arabic among them, though
 * Arabic also has digits of its own (٠ to ٩): what an Arabic reader of
 * OneUptime reads beside the product's numbers is in Latin digits - a
 * response time, a status code, an address, a version, an id, a log line -
 * and so is what most products in Arabic write. Left to the browser,
 * Arabic's digits are not even one choice: Chrome and Firefox write "ar" in
 * Latin digits, Safari in Arabic ones ("٥" for "5"), so one status page
 * would read differently on a phone and on a laptop. A language listed here
 * is written in Latin digits by every engine (Intl's "-u-nu-latn").
 */
export const LATIN_DIGIT_LANGUAGES: ReadonlyArray<string> = ["ar"];

const LANGUAGE_SUBTAG_SEPARATOR: RegExp = /[-_]/;

// Whether `language` ("ar", "ar-EG") writes Latin digits whatever its default is.
export const writesLatinDigits: (
  language: string | null | undefined,
) => boolean = (language: string | null | undefined): boolean => {
  const base: string =
    (language || "").trim().toLowerCase().split(LANGUAGE_SUBTAG_SEPARATOR)[0] ||
    "";

  return LATIN_DIGIT_LANGUAGES.includes(base);
};

/*
 * The Intl locale a number is written in for `language`: the language as
 * it is, or with Latin digits asked for ("ar-u-nu-latn") in a language that
 * writes them though its default does not (LATIN_DIGIT_LANGUAGES). Hand it
 * to Intl.NumberFormat, toLocaleString and the other Intl formatters in
 * place of a bare language code. No language gives no locale - the
 * runtime's own default, as before.
 */
export const getNumberLocale: (
  language: string | null | undefined,
) => string | undefined = (
  language: string | null | undefined,
): string | undefined => {
  const trimmed: string = (language || "").trim();

  if (!trimmed) {
    return undefined;
  }

  // A tag that already names its extensions ("ar-u-nu-arab") is kept.
  if (!writesLatinDigits(trimmed) || trimmed.toLowerCase().includes("-u-")) {
    return trimmed;
  }

  // "ar_EG", as some code writes a tag, is "ar-EG" to Intl.
  return `${trimmed.replace(/_/g, "-")}-u-nu-latn`;
};

const localeCache: Map<string, string> = new Map<string, string>();

/*
 * The Intl locale a language writes dates in: its own words, order and
 * digits, on the Gregorian calendar ("fa" alone would give the Solar Hijri
 * calendar). Persian writes its own digits - "۲۶ اکتبر، ۱۵:۰۷", as its counts
 * are written (TranslateTemplate's formatNumber) - every other language of
 * the product Latin ones, Arabic too (LATIN_DIGIT_LANGUAGES): "26 أكتوبر
 * 2026", where "ar-SA" alone writes "٢٦ أكتوبر ٢٠٢٦" and some engines Hijri
 * dates. A language Intl does not know reads English, never the browser's
 * own default, so a page never mixes two languages.
 */
export const getDateLocale: (language: string | null | undefined) => string = (
  language: string | null | undefined,
): string => {
  const requested: string = normalizeLanguage(language);
  const cached: string | undefined = localeCache.get(requested);

  if (cached) {
    return cached;
  }

  let locale: string = `${ENGLISH_DATE_LANGUAGE}-u-ca-gregory`;

  try {
    const supported: Array<string> = Intl.DateTimeFormat.supportedLocalesOf([
      requested,
    ]);

    if (supported.length > 0 && supported[0]) {
      locale = writesLatinDigits(supported[0])
        ? `${supported[0]}-u-ca-gregory-nu-latn`
        : `${supported[0]}-u-ca-gregory`;
      // Throws on a tag Intl cannot take an extension on.
      new Intl.DateTimeFormat(locale);
    }
  } catch {
    locale = `${ENGLISH_DATE_LANGUAGE}-u-ca-gregory`;
  }

  localeCache.set(requested, locale);

  return locale;
};

/*
 * THE LOCALE A NUMBER OR A DATE THE READER SEES IS WRITTEN IN.
 *
 * A toLocaleString() with no locale follows the browser, not the page: an
 * Arabic page read in Safari wrote "١٬٢٣٤" where the product promises Latin
 * digits, a German page read in an English browser wrote "1,234" beside
 * "1.234" from the translator, and an English page on a Persian system
 * wrote Persian digits. These follow the page's language instead
 * (setDateDisplayLanguage, which every frontend sets from its i18n), in the
 * digits and calendar it writes (getNumberLocale, getDateLocale).
 *
 * An English page keeps the browser's own English - "14/09/2026" in
 * en-GB, "9/14/2026" in en-US - as it always has, and reads "en" when the
 * browser's own locale is another language's. Where nothing set a language
 * (the server, emails, workers) that is the process's English, as before.
 */

let runtimeLocale: string | null = null;

// The runtime's own default locale ("en-GB", "de-DE"), read once.
const getRuntimeLocale: () => string = (): string => {
  if (runtimeLocale === null) {
    try {
      runtimeLocale = new Intl.NumberFormat().resolvedOptions().locale || "";
    } catch {
      runtimeLocale = "";
    }
  }

  return runtimeLocale;
};

// The locale an English page writes in: the browser's English, else "en".
const getEnglishReaderLocale: () => string = (): string => {
  const runtime: string = getRuntimeLocale();

  return runtime && isEnglishDateLanguage(runtime)
    ? runtime
    : ENGLISH_DATE_LANGUAGE;
};

// For Intl.NumberFormat and a number's toLocaleString.
export const getReaderNumberLocale: () => string = (): string => {
  const language: string = getDateDisplayLanguage();

  if (isEnglishDateLanguage(language)) {
    return getEnglishReaderLocale();
  }

  return getNumberLocale(language) || ENGLISH_DATE_LANGUAGE;
};

// For Intl.DateTimeFormat and a date's toLocale(Date|Time)String.
export const getReaderDateLocale: () => string = (): string => {
  const language: string = getDateDisplayLanguage();

  if (isEnglishDateLanguage(language)) {
    return getEnglishReaderLocale();
  }

  return getDateLocale(language);
};

// A number as the reader's language writes it: "1,234", "1.234", "۱٬۲۳۴".
export const formatReaderNumber: (
  value: number,
  options?: Intl.NumberFormatOptions,
) => string = (value: number, options?: Intl.NumberFormatOptions): string => {
  try {
    return value.toLocaleString(getReaderNumberLocale(), options);
  } catch {
    return value.toLocaleString("en", options);
  }
};

/*
 * A FIGURE ON ITS OWN, IN THE READER'S LANGUAGE.
 *
 * A tile's "97.5%", a cell's "16.0 GiB", a legend's "99.81%" were written
 * with toFixed and a "%" of their own: Latin digits, a point and an ASCII
 * percent sign whatever the page's language, so a Persian card put "97.5%"
 * beside sentences that read "۳۹ از ۴۰", and a German one "97.5%" where
 * German writes "97,5 %". A figure written here keeps the decimals it was
 * written with - exactly `decimals` of them as toFixed writes them, or up
 * to `decimals` with the trailing zeros dropped - in the reader's digits,
 * decimal sign and percent sign: "97,5 %" in German, "۹۷٫۵٪" in Persian,
 * Latin digits in Arabic (LATIN_DIGIT_LANGUAGES), with Intl's percent sign.
 * A negative figure takes the language's own minus: in Persian a
 * left-to-right mark and a minus sign (U+2212) before its digits, drawn
 * before its number on a page read from the right.
 *
 * English reads exactly as toFixed wrote it: "97.5%", "1023.0", no
 * thousands separator - what every English page, export and test has
 * always read.
 */
export interface ReaderFigureOptions {
  // The decimals the figure is written with, as toFixed's argument.
  decimals: number;
  // Up to `decimals`, trailing zeros dropped: 50 -> "50", 12.30 -> "12.3".
  dropTrailingZeros?: boolean | undefined;
  // The value is a percent, 97.5 for 97.5%: written with the percent sign.
  isPercent?: boolean | undefined;
  // The language to write it in: the page's (getDateDisplayLanguage) when left out.
  language?: string | undefined;
}

const figureFormatCache: Map<string, Intl.NumberFormat | null> = new Map<
  string,
  Intl.NumberFormat | null
>();

const getFigureFormat: (
  language: string,
  options: ReaderFigureOptions,
) => Intl.NumberFormat | null = (
  language: string,
  options: ReaderFigureOptions,
): Intl.NumberFormat | null => {
  const key: string = [
    language,
    options.decimals,
    options.dropTrailingZeros ? "drop" : "keep",
    options.isPercent ? "percent" : "decimal",
  ].join("|");

  if (!figureFormatCache.has(key)) {
    let format: Intl.NumberFormat | null = null;

    try {
      format = new Intl.NumberFormat(getNumberLocale(language), {
        style: options.isPercent ? "percent" : "decimal",
        minimumFractionDigits: options.dropTrailingZeros ? 0 : options.decimals,
        maximumFractionDigits: options.decimals,
      });
    } catch {
      format = null;
    }

    figureFormatCache.set(key, format);
  }

  return figureFormatCache.get(key) || null;
};

export const formatReaderFigure: (
  value: number,
  options: ReaderFigureOptions,
) => string = (value: number, options: ReaderFigureOptions): string => {
  const decimals: number = Math.max(
    0,
    Math.min(20, Math.floor(options.decimals)),
  );
  const fixed: string = value.toFixed(decimals);
  const english: string = `${
    options.dropTrailingZeros ? Number(fixed).toString() : fixed
  }${options.isPercent ? "%" : ""}`;
  const language: string = normalizeLanguage(
    options.language === undefined
      ? getDateDisplayLanguage()
      : options.language,
  );

  if (isEnglishDateLanguage(language) || !Number.isFinite(value)) {
    return english;
  }

  const format: Intl.NumberFormat | null = getFigureFormat(language, {
    ...options,
    decimals: decimals,
  });

  if (!format) {
    return english;
  }

  // Rounded once, as toFixed rounds it, so every language says the same figure.
  const rounded: number = Number(fixed);

  return format.format(options.isPercent ? rounded / 100 : rounded);
};

/*
 * A FIGURE A FORMATTER WROTE IN ENGLISH, IN THE READER'S LANGUAGE.
 *
 * Many of the product's formatters write a figure with toFixed and a unit
 * of their own - "0.025", "2.5k", "1.2K/s", "12%", "3.5 TiB", "4.0 ms" -
 * and a chart's value axis, its tooltip and the tiles beside it drew them
 * so on every page: "3.5 TiB" on a Persian page whose dashboard widget
 * said "۳٫۵ TiB". Written here, the number is in the reader's digits,
 * decimal sign, minus and percent sign, with exactly the decimals it was
 * written with ("0,025", "12 %", "3,5 TiB" in German; "۰٫۰۲۵", "۱۲٪",
 * "۳٫۵ TiB" in Persian; Latin digits in Arabic), and everything after it -
 * a count's "k" or "K", a size's unit, a rate's "/s" - stays as written:
 * the symbols a chart writes alike in every language (#8060, #8349).
 *
 * Only a figure as an English formatter writes one: ASCII digits, a point
 * for its decimals and no thousands separator. Anything else - "—", "1e-7",
 * a figure already in the reader's language, a name - comes back as it
 * came, and so does every figure in English or with no language.
 */
const ENGLISH_FIGURE: RegExp =
  /^(-?\d{1,15}(?:\.(\d{1,10}))?)([kKMBT]?)(%|\/\S.*|\s+\S.*)?$/;

export const writeFigureInLanguage: (
  english: string,
  language: string | null | undefined,
) => string = (
  english: string,
  language: string | null | undefined,
): string => {
  if (!language || isEnglishDateLanguage(language)) {
    return english;
  }

  const figure: RegExpMatchArray | null = english.match(ENGLISH_FIGURE);

  if (!figure) {
    return english;
  }

  const scale: string = figure[3] || "";
  const unit: string = figure[4] || "";
  // A percent of thousands ("2.5k%") keeps its sign as written.
  const isPercent: boolean = unit === "%" && !scale;
  const number: string = formatReaderFigure(Number(figure[1]), {
    decimals: (figure[2] || "").length,
    isPercent: isPercent,
    language: language,
  });

  return isPercent ? number : `${number}${scale}${unit}`;
};

/*
 * THE ENGLISH OF A DATE WRITTEN IN ANOTHER LANGUAGE.
 *
 * Kept for the most recent texts only: a page writes its dates again on
 * every render, so an old one that is no longer on screen is never asked
 * for. The English is worked out only when a sentence asks for it.
 */
export const MAX_REMEMBERED_DATE_TEXTS: number = 5000;

const englishOfText: OldestKeyMap<string, () => string> = new OldestKeyMap<
  string,
  () => string
>();

export const rememberEnglishOf: (
  localized: string,
  english: () => string,
) => void = (localized: string, english: () => string): void => {
  if (!localized) {
    return;
  }

  // The newest last, so the oldest is the first to go.
  englishOfText.delete(localized);
  englishOfText.set(localized, english);

  if (englishOfText.size > MAX_REMEMBERED_DATE_TEXTS) {
    const oldest: string | undefined = englishOfText.oldestKey();

    if (oldest !== undefined) {
      englishOfText.delete(oldest);
    }
  }
};

/*
 * The English of `text` when it is a date, a time or a duration this module
 * wrote in another language; undefined for anything else.
 */
export const getEnglishOf: (text: string) => string | undefined = (
  text: string,
): string | undefined => {
  const english: (() => string) | undefined = englishOfText.get(text);

  if (!english) {
    return undefined;
  }

  try {
    return english();
  } catch {
    return undefined;
  }
};

// For tests: forget every remembered text.
export const forgetRememberedDateTexts: () => void = (): void => {
  englishOfText.clear();
};

/*
 * A date's text in the display language: `english()` while that is English,
 * `localized(language, locale)` otherwise - remembered with its English -
 * and the English again when the language's text cannot be written.
 */
export const writeInDateDisplayLanguage: (
  english: () => string,
  localized: (language: string, locale: string) => string | null | undefined,
) => string = (
  english: () => string,
  localized: (language: string, locale: string) => string | null | undefined,
): string => {
  const language: string = getDateDisplayLanguage();
  const locale: string = getDateLocale(language);

  // English, or a language Intl does not know: moment's English, exactly.
  if (
    isEnglishDateLanguage(language) ||
    locale.startsWith(`${ENGLISH_DATE_LANGUAGE}-`)
  ) {
    return english();
  }

  let text: string | null | undefined = null;

  try {
    text = localized(language, locale);
  } catch {
    text = null;
  }

  if (!text) {
    return english();
  }

  /*
   * Worked out in English when asked for, whatever the display language is
   * then: the English of "06. Okt." names October as "Oct".
   */
  rememberEnglishOf(text, (): string => {
    return withDateDisplayLanguage(ENGLISH_DATE_LANGUAGE, english);
  });

  return text;
};

/*
 * DATE AND TIME OF DAY, ON ONEUPTIME'S OWN CLOCK (#10038).
 *
 * Intl reads a zone with its runtime's own tz data - the browser's on a
 * page, Node.js's ICU on the server - while OneUptime works out every wall
 * clock with moment-timezone, the copy of the IANA database it ships and
 * checks every week (.github/workflows/time-zone-data.yml). The two part
 * whenever a zone changes its rules: from 1 November 2026 British Columbia
 * stays on UTC-7, and a browser whose data is older than tzdata 2026b put
 * every date of a German or French reader in Vancouver an hour early, while
 * the same page in English, written by moment, read the right time. Intl
 * also names a zone from CLDR, which still files British Columbia under
 * Pacific time: "PDT" where every other date on the page says "MST".
 *
 * So a formatter made here never hands Intl a zone. It works the wall
 * clock out with moment-timezone, in the first of the zones asked for that
 * moment knows (a zone and its legacy spellings), and has Intl write that
 * wall clock in UTC: Intl gives only the words, their order and the
 * digits. A zone's name, where the options ask for one, is moment's
 * abbreviation (getZoneAbbreviation) in the language's digits. No zone at
 * all is the runtime's own clock, read as a Date reads it
 * (getTimezoneOffset): the clock a widget that lays its dates out on the
 * browser's own wall clock drew them at (react-big-calendar). A zone
 * moment does not know is Intl's to read, as before, and null when Intl
 * does not know it either: the caller writes moment's English.
 *
 * Built once per locale, zone and shape: a table writes hundreds of dates.
 */
export interface ReaderDateTimeFormat {
  format: (date: Date) => string;
  formatToParts: (date: Date) => Array<Intl.DateTimeFormatPart>;
  /*
   * Two days as one range, what they share said once: "14.–20. Sept.
   * 2026", "2026年9月14日～20日". Null where the engine has no
   * formatRange. For days only: Intl writes a range of times in shapes of
   * its own (OneUptimeDate.getLocalDateTimeRangeEnds writes those).
   */
  formatRange: (start: Date, end: Date) => string | null;
  // Intl's own, with the zone the wall clock is read in.
  resolvedOptions: () => Intl.ResolvedDateTimeFormatOptions;
}

/*
 * Intl.DateTimeFormat's formatRange, typed structurally: Common compiles
 * against a library older than ES2021, which declares it, while every
 * browser OneUptime supports has it.
 */
interface IntlRangeFormat {
  formatRange?: ((start: Date, end: Date) => string) | undefined;
}

// `format`'s formatRange of two dates, or null where the engine has none.
const formatRangeWith: (
  format: Intl.DateTimeFormat,
  start: Date,
  end: Date,
) => string | null = (
  format: Intl.DateTimeFormat,
  start: Date,
  end: Date,
): string | null => {
  const ranged: IntlRangeFormat = format as unknown as IntlRangeFormat;

  if (typeof ranged.formatRange !== "function") {
    return null;
  }

  try {
    return ranged.formatRange.call(format, start, end);
  } catch {
    return null;
  }
};

const MILLISECONDS_IN_MINUTE: number = 60 * 1000;

/*
 * A zone's name at `date`, as every date OneUptime writes names it:
 * moment's abbreviation - "EST" in winter and "EDT" in summer, "MST" in
 * Vancouver from November 2026 - or its offset where the zone has no
 * abbreviation ("GMT+08" for moment's "+08").
 */
export const getZoneAbbreviation: (zone: string, date: Date) => string = (
  zone: string,
  date: Date,
): string => {
  const abbreviation: string = moment(date).tz(zone).zoneAbbr();

  return abbreviation.startsWith("+") || abbreviation.startsWith("-")
    ? `GMT${abbreviation}`
    : abbreviation;
};

/*
 * The wall clock `date` reads in `zone` (moment's data), or on the
 * runtime's own clock without one, as the same digits at UTC.
 */
const getWallClockAtUtc: (
  date: Date,
  zone: moment.MomentZone | null,
) => Date = (date: Date, zone: moment.MomentZone | null): Date => {
  const time: number = date.getTime();

  // Both count minutes west of UTC: New York's winter is 300.
  const minutesWest: number = zone
    ? zone.utcOffset(time)
    : date.getTimezoneOffset();

  return new Date(time - minutesWest * MILLISECONDS_IN_MINUTE);
};

// The first of `timezones` moment's data knows, in the spelling asked for.
const findMomentZone: (timezones: ReadonlyArray<string>) => string | null = (
  timezones: ReadonlyArray<string>,
): string | null => {
  for (const name of timezones) {
    if (name && moment.tz.zone(name)) {
      return name;
    }
  }

  return null;
};

const utcFormatCache: Map<string, Intl.DateTimeFormat | null> = new Map<
  string,
  Intl.DateTimeFormat | null
>();

// Intl's formatter for `options` in `locale`, in UTC; null when Intl refuses.
const getUtcFormat: (
  locale: string,
  options: Intl.DateTimeFormatOptions,
) => Intl.DateTimeFormat | null = (
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat | null => {
  const key: string = `${locale}|${JSON.stringify(options)}`;

  if (!utcFormatCache.has(key)) {
    let format: Intl.DateTimeFormat | null = null;

    try {
      format = new Intl.DateTimeFormat(getNumberLocale(locale), {
        ...options,
        timeZone: "UTC",
      });
    } catch {
      format = null;
    }

    utcFormatCache.set(key, format);
  }

  return utcFormatCache.get(key) || null;
};

// The options with no zone of their own: the zone is `timezones`'.
const withoutZone: (
  options: Intl.DateTimeFormatOptions,
) => Intl.DateTimeFormatOptions = (
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions => {
  const copy: Intl.DateTimeFormatOptions = { ...options };

  delete copy.timeZone;

  return copy;
};

const readerFormatCache: Map<string, ReaderDateTimeFormat | null> = new Map<
  string,
  ReaderDateTimeFormat | null
>();

// A formatter Intl reads its own zone in: for a zone moment does not know.
const fromIntlFormat: (format: Intl.DateTimeFormat) => ReaderDateTimeFormat = (
  format: Intl.DateTimeFormat,
): ReaderDateTimeFormat => {
  return {
    format: (date: Date): string => {
      return format.format(date);
    },
    formatToParts: (date: Date): Array<Intl.DateTimeFormatPart> => {
      return format.formatToParts(date);
    },
    formatRange: (start: Date, end: Date): string | null => {
      return formatRangeWith(format, start, end);
    },
    resolvedOptions: (): Intl.ResolvedDateTimeFormatOptions => {
      return format.resolvedOptions();
    },
  };
};

// The old way, for zones moment's data does not hold: Intl reads the zone.
const getIntlZoneFormat: (data: {
  locale: string;
  timezones: ReadonlyArray<string>;
  options: Intl.DateTimeFormatOptions;
}) => ReaderDateTimeFormat | null = (data: {
  locale: string;
  timezones: ReadonlyArray<string>;
  options: Intl.DateTimeFormatOptions;
}): ReaderDateTimeFormat | null => {
  for (const zone of data.timezones) {
    try {
      return fromIntlFormat(
        new Intl.DateTimeFormat(getNumberLocale(data.locale), {
          ...data.options,
          timeZone: zone,
        }),
      );
    } catch {
      // Unknown to this engine too: the next spelling.
    }
  }

  return null;
};

/*
 * A formatter for `options` in `locale`, its wall clock read in the first
 * of `timezones` OneUptime's data knows; none means the runtime's own
 * clock. Null when nothing can write it, so the caller writes the English
 * moment knows how to write.
 */
export const getDateTimeFormat: (data: {
  locale: string;
  timezones: Array<string>;
  options: Intl.DateTimeFormatOptions;
}) => ReaderDateTimeFormat | null = (data: {
  locale: string;
  timezones: Array<string>;
  options: Intl.DateTimeFormatOptions;
}): ReaderDateTimeFormat | null => {
  const options: Intl.DateTimeFormatOptions = withoutZone(data.options);
  // An empty name is no zone: the runtime's own clock, as before.
  const timezones: Array<string> = data.timezones.filter(
    (name: string): boolean => {
      return Boolean(name);
    },
  );
  const zoneName: string | null = findMomentZone(timezones);

  if (timezones.length > 0 && !zoneName) {
    return getIntlZoneFormat({
      locale: data.locale,
      timezones: timezones,
      options: options,
    });
  }

  const key: string = `${data.locale}|${zoneName || ""}|${JSON.stringify(options)}`;

  if (readerFormatCache.has(key)) {
    return readerFormatCache.get(key) || null;
  }

  const utcFormat: Intl.DateTimeFormat | null = getUtcFormat(
    data.locale,
    options,
  );

  if (!utcFormat) {
    readerFormatCache.set(key, null);

    return null;
  }

  const zone: moment.MomentZone | null = zoneName
    ? moment.tz.zone(zoneName)
    : null;
  const namesItsZone: boolean = Boolean(options.timeZoneName);
  const locale: string = data.locale;

  const formatToParts: (date: Date) => Array<Intl.DateTimeFormatPart> = (
    date: Date,
  ): Array<Intl.DateTimeFormatPart> => {
    const parts: Array<Intl.DateTimeFormatPart> = utcFormat.formatToParts(
      getWallClockAtUtc(date, zone),
    );

    if (!namesItsZone) {
      return parts;
    }

    // Moment's name for the zone at that instant, never Intl's "UTC".
    const name: string = writeDigitsInLocale(
      getZoneAbbreviation(zoneName || moment.tz.guess(), date),
      locale,
    );

    return parts.map(
      (part: Intl.DateTimeFormatPart): Intl.DateTimeFormatPart => {
        return part.type === "timeZoneName"
          ? { type: part.type, value: name }
          : part;
      },
    );
  };

  const format: ReaderDateTimeFormat = {
    format: (date: Date): string => {
      return namesItsZone
        ? joinIntlParts(formatToParts(date))
        : utcFormat.format(getWallClockAtUtc(date, zone));
    },
    formatToParts: formatToParts,
    formatRange: (start: Date, end: Date): string | null => {
      return formatRangeWith(
        utcFormat,
        getWallClockAtUtc(start, zone),
        getWallClockAtUtc(end, zone),
      );
    },
    resolvedOptions: (): Intl.ResolvedDateTimeFormatOptions => {
      return {
        ...utcFormat.resolvedOptions(),
        timeZone: zoneName || moment.tz.guess(),
      };
    },
  };

  readerFormatCache.set(key, format);

  return format;
};

export interface DateTextShape {
  // The day, the month and the year (no time of day).
  onlyShowDate?: boolean | undefined;
  showSeconds?: boolean | undefined;
  use12HourFormat?: boolean | undefined;
  showWeekday?: boolean | undefined;
  // Leave the year out: "6. Okt., 10:05".
  hideYear?: boolean | undefined;
  // The day as two digits: "06. Okt." (OneUptimeDate's "DD").
  twoDigitDay?: boolean | undefined;
}

/*
 * How Intl writes the hour of a time of day on the reader's clock.
 *
 * A 12-hour time's hour has no leading zero in any language: "5:14 AM",
 * "오전 5:14", "上午5:14", "5:14 am", "5:14 ص", "۵:۱۴ ق.ظ.". Asked for two
 * digits there, Intl wrote "오전 05:14" and "05:14 ص" in every language but
 * English, which moment writes "5:14 AM" (issue #7279). A 24-hour time keeps
 * its zero: "05:14" - "numeric" would drop it in German, French, Japanese
 * and most others ("5:14") while Korean, Hindi and Arabic keep it.
 */
export const getHourOption: (
  use12HourFormat: boolean | undefined,
) => "numeric" | "2-digit" = (
  use12HourFormat: boolean | undefined,
): "numeric" | "2-digit" => {
  return use12HourFormat ? "numeric" : "2-digit";
};

/*
 * Every time of day follows the reader's clock (getHourOption with
 * OneUptimeDate.getUserPrefers12HourFormat). A calendar's grid, an AI
 * chat's PDF axis and a security connection's local time followed their
 * language's own clock until #7651 (getLocaleClockHourOption): a German
 * reader on a 12-hour clock read "17:14" down a calendar beside every
 * table's "5:14 PM".
 */

// The Intl options a shape of OneUptimeDate's dates asks for.
export const getDateTimeOptions: (
  shape: DateTextShape,
) => Intl.DateTimeFormatOptions = (
  shape: DateTextShape,
): Intl.DateTimeFormatOptions => {
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: shape.twoDigitDay ? "2-digit" : "numeric",
  };

  if (!shape.hideYear) {
    options.year = "numeric";
  }

  if (shape.showWeekday) {
    options.weekday = "short";
  }

  if (!shape.onlyShowDate) {
    options.hour = getHourOption(shape.use12HourFormat);
    options.minute = "2-digit";
    options.hour12 = Boolean(shape.use12HourFormat);

    if (shape.showSeconds) {
      options.second = "2-digit";
    }
  }

  return options;
};

/*
 * `date` in `locale`, read in the first zone of `timezones` Intl knows, in
 * the shape asked for; null when Intl cannot write it.
 */
export const formatDateText: (data: {
  date: Date;
  locale: string;
  timezones: Array<string>;
  shape: DateTextShape;
}) => string | null = (data: {
  date: Date;
  locale: string;
  timezones: Array<string>;
  shape: DateTextShape;
}): string | null => {
  if (Number.isNaN(data.date.getTime())) {
    return null;
  }

  const format: Intl.DateTimeFormat | null = getDateTimeFormat({
    locale: data.locale,
    timezones: data.timezones,
    options: getDateTimeOptions(data.shape),
  });

  return format ? format.format(data.date) : null;
};

/*
 * A NUMBER KEEPS ITS UNIT ON ITS LINE.
 *
 * A line may break at any plain space, and Intl writes one between a
 * number and its unit in most languages - "5 Min.", "vor 5 Minuten", "2
 * Tage, 3 Stunden", Arabic's "5 ملي ث" with two - so a narrow cell could
 * end a line with "5" and start the next with "Min." (#8456). The
 * Translator holds a number to its unit in every sentence (#8043, #8302)
 * and code that joins them itself writes a no-break space (#8303); this
 * holds what Intl writes. Every amount of a unit and every relative time
 * written here is read from Intl's parts (formatToParts), and the space
 * between the number and its unit is a no-break space (U+00A0), and so is
 * a space inside a unit of two words (Arabic's "ملي ث", Hindi's "नैनो से॰",
 * Persian's "Gb در ثانیه"). A space no line breaks at is left as Intl wrote
 * it: French's narrow U+202F and its U+00A0. English is held as well, for
 * the same reason its sentences are (#8302): "in 5\u00A0minutes".
 *
 * Only the space beside the number is set. A line may still break between
 * two units of a duration ("2\u00A0Tage, 3\u00A0Stunden") and before or
 * after the words of a relative time ("vor 5\u00A0Minuten",
 * "5\u00A0minutes ago"). A relative time has no part of its own for its
 * unit: the unit's name is the word beside the number on the side the
 * language writes a unit on (after it in every language the Dashboard
 * ships, "dakika 5 zilizopita" in Swahili).
 */

// A run of the spaces a line may break at: not the figure space (U+2007).
const BREAKING_SPACES: RegExp = /[ \u2000-\u2006\u2008-\u200A\u205F]+/g;

const LEADING_BREAKING_SPACES: RegExp = /^[ \u2000-\u2006\u2008-\u200A\u205F]+/;

const TRAILING_BREAKING_SPACES: RegExp =
  /[ \u2000-\u2006\u2008-\u200A\u205F]+$/;

// One part of what Intl writes, as formatToParts hands it.
export interface IntlTextPart {
  type: string;
  value: string;
}

// The parts Intl writes a number in: its digits, its signs and its marks.
const NUMBER_PART_TYPES: ReadonlyArray<string> = [
  "integer",
  "group",
  "decimal",
  "fraction",
  "minusSign",
  "plusSign",
  "percentSign",
  "compact",
  "exponentSeparator",
  "exponentMinusSign",
  "exponentInteger",
  "infinity",
  "nan",
];

const isNumberPart: (part: IntlTextPart | undefined) => boolean = (
  part: IntlTextPart | undefined,
): boolean => {
  return part !== undefined && NUMBER_PART_TYPES.includes(part.type);
};

const withSpacesHeld: (text: string, spaces: RegExp) => string = (
  text: string,
  spaces: RegExp,
): string => {
  return text.replace(spaces, NO_BREAK_SPACE);
};

// The nearest part on one side of `index` that is not a literal.
const nearestNonLiteral: (
  parts: ReadonlyArray<IntlTextPart>,
  index: number,
  step: 1 | -1,
) => IntlTextPart | undefined = (
  parts: ReadonlyArray<IntlTextPart>,
  index: number,
  step: 1 | -1,
): IntlTextPart | undefined => {
  for (
    let at: number = index + step;
    at >= 0 && at < parts.length;
    at += step
  ) {
    if (parts[at]!.type !== "literal") {
      return parts[at];
    }
  }

  return undefined;
};

/*
 * The parts of an amount of a unit (Intl.NumberFormat's unit style) with
 * the unit held to its number: the literal between the two, and any space
 * inside the unit, written with no-break spaces. Every other part as Intl
 * wrote it.
 */
export const holdUnitToNumber: (
  parts: ReadonlyArray<IntlTextPart>,
) => Array<IntlTextPart> = (
  parts: ReadonlyArray<IntlTextPart>,
): Array<IntlTextPart> => {
  return parts.map((part: IntlTextPart, index: number): IntlTextPart => {
    if (part.type === "unit") {
      return {
        type: part.type,
        value: withSpacesHeld(part.value, BREAKING_SPACES),
      };
    }

    if (part.type !== "literal") {
      return { type: part.type, value: part.value };
    }

    const before: IntlTextPart | undefined = nearestNonLiteral(
      parts,
      index,
      -1,
    );
    const after: IntlTextPart | undefined = nearestNonLiteral(parts, index, 1);
    const isBetweenNumberAndUnit: boolean =
      (isNumberPart(before) && after?.type === "unit") ||
      (before?.type === "unit" && isNumberPart(after));

    return {
      type: part.type,
      value: isBetweenNumberAndUnit
        ? withSpacesHeld(part.value, BREAKING_SPACES)
        : part.value,
    };
  });
};

/*
 * The parts of a relative time (Intl.RelativeTimeFormat) with its number
 * held to the unit's name: the spaces between the number and the word on
 * the unit's side, after the number unless `unitBeforeNumber`. A text
 * with no number ("gestern", "now") is as Intl wrote it.
 */
export const holdRelativeUnitToNumber: (
  parts: ReadonlyArray<IntlTextPart>,
  unitBeforeNumber: boolean,
) => string = (
  parts: ReadonlyArray<IntlTextPart>,
  unitBeforeNumber: boolean,
): string => {
  const numberIndexes: Array<number> = [];

  parts.forEach((part: IntlTextPart, index: number): void => {
    if (part.type !== "literal") {
      numberIndexes.push(index);
    }
  });

  const unitSide: number | undefined =
    numberIndexes.length === 0
      ? undefined
      : unitBeforeNumber
        ? numberIndexes[0]! - 1
        : numberIndexes[numberIndexes.length - 1]! + 1;

  return parts
    .map((part: IntlTextPart, index: number): string => {
      if (index !== unitSide || part.type !== "literal") {
        return part.value;
      }

      return withSpacesHeld(
        part.value,
        unitBeforeNumber ? TRAILING_BREAKING_SPACES : LEADING_BREAKING_SPACES,
      );
    })
    .join("");
};

// The text of `parts`, joined.
export const joinIntlParts: (parts: ReadonlyArray<IntlTextPart>) => string = (
  parts: ReadonlyArray<IntlTextPart>,
): string => {
  return parts
    .map((part: IntlTextPart): string => {
      return part.value;
    })
    .join("");
};

/*
 * AN AMOUNT OF A UNIT.
 *
 * "5 Min.", "4,2 MB", "1,2 Gb/s", "۱۸۴ میلی‌ثانیه": Intl's unit style, the
 * unit held to its number. The one place OneUptime asks Intl for a unit
 * (NumbersKeepTheirUnitsInCodeGuard refuses another): a duration's unit
 * goes through formatDurationUnit, any other unit Intl knows (a byte, a
 * megabyte, a gigabit per second) through formatUnitAmount.
 */
export interface UnitAmount {
  value: number;
  // Intl's name for the unit: "minute", "megabyte", "gigabit-per-second".
  unit: string;
  /*
   * The language or locale the amount is read in ("de", "ar", a feed's
   * "fa-u-ca-gregory"), its digits as getNumberLocale writes them. None
   * is the runtime's own.
   */
  locale: string | undefined;
  unitDisplay: "long" | "short" | "narrow";
  minimumFractionDigits?: number | undefined;
  maximumFractionDigits?: number | undefined;
  /*
   * "compact" writes a big amount in the language's own short scale ("1,5
   * Tsd. Min.", "۱٫۵ هزار دقیقه"), as a chart's scaled figure is written
   * (ValueFormatter). The standard notation when left out.
   */
  notation?: "standard" | "compact" | undefined;
}

const unitFormatCache: Map<string, Intl.NumberFormat | null> = new Map<
  string,
  Intl.NumberFormat | null
>();

// The Intl.NumberFormat the cache was built with: another one starts afresh.
let unitFormatCacheOwner: unknown = null;

/*
 * Intl's format for an amount of `unit`, or null when this engine cannot
 * write the unit: an unknown unit or locale, or an older engine that
 * ignores the unit style and writes the bare number.
 */
const getUnitFormat: (amount: UnitAmount) => Intl.NumberFormat | null = (
  amount: UnitAmount,
): Intl.NumberFormat | null => {
  const key: string = [
    amount.locale || "",
    amount.unit,
    amount.unitDisplay,
    amount.minimumFractionDigits ?? "",
    amount.maximumFractionDigits ?? "",
    amount.notation || "standard",
  ].join("|");

  if (unitFormatCacheOwner !== Intl.NumberFormat) {
    unitFormatCache.clear();
    unitFormatCacheOwner = Intl.NumberFormat;
  }

  if (unitFormatCache.has(key)) {
    return unitFormatCache.get(key) || null;
  }

  let format: Intl.NumberFormat | null = null;

  try {
    const options: Record<string, unknown> = {
      style: "unit",
      unit: amount.unit,
      unitDisplay: amount.unitDisplay,
    };

    if (amount.minimumFractionDigits !== undefined) {
      options["minimumFractionDigits"] = amount.minimumFractionDigits;
    }

    if (amount.maximumFractionDigits !== undefined) {
      options["maximumFractionDigits"] = amount.maximumFractionDigits;
    }

    if (amount.notation === "compact") {
      options["notation"] = "compact";
      options["compactDisplay"] = "short";
    }

    const candidate: Intl.NumberFormat = new Intl.NumberFormat(
      getNumberLocale(amount.locale),
      options as Intl.NumberFormatOptions,
    );

    // An engine without the unit style writes the bare number.
    const writesUnit: boolean = candidate
      .formatToParts(2)
      .some((part: Intl.NumberFormatPart): boolean => {
        return (part.type as string) === "unit";
      });

    format = writesUnit ? candidate : null;
  } catch {
    format = null;
  }

  unitFormatCache.set(key, format);

  return format;
};

/*
 * An amount of a unit in its parts, the unit held to its number: for a
 * caller that draws the number and the unit apart (a stat tile's figure).
 * Null when this engine cannot write the unit.
 */
export const getUnitAmountParts: (
  amount: UnitAmount,
) => Array<IntlTextPart> | null = (
  amount: UnitAmount,
): Array<IntlTextPart> | null => {
  const format: Intl.NumberFormat | null = getUnitFormat(amount);

  if (!format) {
    return null;
  }

  return holdUnitToNumber(format.formatToParts(amount.value));
};

// "5\u00A0Min.", "4,2\u00A0MB": an amount of a unit; null when Intl cannot write it.
export const formatUnitAmount: (amount: UnitAmount) => string | null = (
  amount: UnitAmount,
): string | null => {
  const parts: Array<IntlTextPart> | null = getUnitAmountParts(amount);

  return parts ? joinIntlParts(parts) : null;
};

const unitBeforeNumberCache: Map<string, boolean> = new Map<string, boolean>();

/*
 * Whether `locale` writes `unit`'s name before an amount of it ("dakika 5"
 * in Swahili), as its unit style does; after it ("5 Minuten") when Intl
 * cannot say.
 */
const writesUnitBeforeNumber: (
  locale: string | undefined,
  unit: string,
) => boolean = (locale: string | undefined, unit: string): boolean => {
  const key: string = `${locale || ""}|${unit}`;
  const cached: boolean | undefined = unitBeforeNumberCache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const parts: Array<IntlTextPart> | null = getUnitAmountParts({
    value: 5,
    unit: unit,
    locale: locale,
    unitDisplay: "long",
  });
  const unitAt: number = parts
    ? parts.findIndex((part: IntlTextPart): boolean => {
        return part.type === "unit";
      })
    : -1;
  const numberAt: number = parts ? parts.findIndex(isNumberPart) : -1;
  const before: boolean = unitAt >= 0 && numberAt >= 0 && unitAt < numberAt;

  unitBeforeNumberCache.set(key, before);

  return before;
};

/*
 * HOW LONG AGO, OR HOW LONG UNTIL.
 */

/*
 * The parts of Intl.RelativeTimeFormat and Intl.ListFormat used here, typed
 * structurally: Common compiles against the ES2017 library, which declares
 * neither, while every browser OneUptime supports has both.
 */
export type RelativeDateUnit =
  | "second"
  | "minute"
  | "hour"
  | "day"
  // For a caller that counts weeks (formatRelativeAmount): "vor 3 Wochen".
  | "week"
  | "month"
  | "year";

interface RelativeTimeFormatter {
  format: (value: number, unit: RelativeDateUnit) => string;
}

interface IntlRelativeTimeFormat extends RelativeTimeFormatter {
  // Every engine with Intl.RelativeTimeFormat has it; optional all the same.
  formatToParts?:
    | ((value: number, unit: RelativeDateUnit) => Array<IntlTextPart>)
    | undefined;
}

type RelativeTimeFormatConstructor = new (
  locale: string | undefined,
  options: { numeric: "auto" | "always"; style: "long" | "short" | "narrow" },
) => IntlRelativeTimeFormat;

interface ListFormatter {
  format: (items: Array<string>) => string;
}

type ListFormatConstructor = new (
  locale: string,
  options: {
    type: "conjunction" | "disjunction" | "unit";
    style: "long" | "short" | "narrow";
  },
) => ListFormatter;

const relativeTimeFormatCache: Map<string, RelativeTimeFormatter | null> =
  new Map<string, RelativeTimeFormatter | null>();

// The Intl.RelativeTimeFormat the cache was built with: another one starts afresh.
let relativeTimeFormatCacheOwner: unknown = null;

// How much of a unit's name Intl writes: "5 minutes ago", or "5 min. ago".
export type RelativeDateStyle = "long" | "short" | "narrow";

/*
 * Intl's relative times in `locale`, each number held to its unit ("vor
 * 5 Minuten" with a no-break space after the 5, A NUMBER KEEPS ITS UNIT ON
 * ITS LINE); null when this engine has no Intl.RelativeTimeFormat or
 * cannot write `locale`. No locale is the runtime's own.
 */
const getRelativeTimeFormatter: (
  locale: string | undefined,
  numeric: "auto" | "always",
  style?: RelativeDateStyle,
) => RelativeTimeFormatter | null = (
  locale: string | undefined,
  numeric: "auto" | "always",
  style: RelativeDateStyle = "long",
): RelativeTimeFormatter | null => {
  const RelativeTimeFormat: RelativeTimeFormatConstructor | undefined = (
    Intl as unknown as {
      RelativeTimeFormat?: RelativeTimeFormatConstructor | undefined;
    }
  ).RelativeTimeFormat;

  if (relativeTimeFormatCacheOwner !== RelativeTimeFormat) {
    relativeTimeFormatCache.clear();
    relativeTimeFormatCacheOwner = RelativeTimeFormat;
  }

  const key: string = `${locale || ""}|${numeric}|${style}`;

  if (relativeTimeFormatCache.has(key)) {
    return relativeTimeFormatCache.get(key) || null;
  }

  let formatter: RelativeTimeFormatter | null = null;

  try {
    if (RelativeTimeFormat) {
      const numberLocale: string | undefined = getNumberLocale(locale);
      const format: IntlRelativeTimeFormat = new RelativeTimeFormat(
        numberLocale,
        { numeric: numeric, style: style },
      );

      formatter = {
        format: (value: number, unit: RelativeDateUnit): string => {
          if (typeof format.formatToParts !== "function") {
            return format.format(value, unit);
          }

          return holdRelativeUnitToNumber(
            format.formatToParts(value, unit),
            writesUnitBeforeNumber(numberLocale, unit),
          );
        },
      };
    }
  } catch {
    formatter = null;
  }

  relativeTimeFormatCache.set(key, formatter);

  return formatter;
};

export interface RelativeDistance {
  // Under 45 seconds: "now", whichever way.
  isNow: boolean;
  count: number;
  unit: RelativeDateUnit;
  isFuture: boolean;
}

/*
 * How far `date` is from `now`, counted and rounded the way moment's fromNow
 * counts and rounds - the same calendar months and the same thresholds - so
 * a status that read "a day ago" in English reads "vor 1 Tag" in German,
 * never "vor 2 Tagen": up to 44 seconds is "a few seconds"; then minutes up
 * to 44, hours up to 21, days up to 25, months up to 10, then years.
 */
export const getRelativeDistance: (
  date: Date,
  now: Date,
) => RelativeDistance = (date: Date, now: Date): RelativeDistance => {
  const isFuture: boolean = date.getTime() - now.getTime() > 0;
  // The calendar distance fromNow reads (whole months, then the rest).
  const duration: moment.Duration = moment
    .duration({ from: now, to: date } as moment.DurationInputArg1)
    .abs();
  const seconds: number = Math.round(duration.as("s"));
  const minutes: number = Math.round(duration.as("m"));
  const hours: number = Math.round(duration.as("h"));
  const days: number = Math.round(duration.as("d"));
  const months: number = Math.round(duration.as("M"));
  const years: number = Math.round(duration.as("y"));

  const distance: (
    count: number,
    unit: RelativeDateUnit,
  ) => RelativeDistance = (
    count: number,
    unit: RelativeDateUnit,
  ): RelativeDistance => {
    return { isNow: false, count, unit, isFuture };
  };

  if (seconds <= 44) {
    return { isNow: true, count: 0, unit: "second", isFuture };
  }

  if (minutes <= 1) {
    return distance(1, "minute");
  }

  if (minutes < 45) {
    return distance(minutes, "minute");
  }

  if (hours <= 1) {
    return distance(1, "hour");
  }

  if (hours < 22) {
    return distance(hours, "hour");
  }

  if (days <= 1) {
    return distance(1, "day");
  }

  if (days < 26) {
    return distance(days, "day");
  }

  if (months <= 1) {
    return distance(1, "month");
  }

  if (months < 11) {
    return distance(months, "month");
  }

  if (years <= 1) {
    return distance(1, "year");
  }

  return distance(years, "year");
};

/*
 * "vor 5 Stunden", "in 3 Tagen", "jetzt" - how far `date` is from `now`, in
 * `locale`; null when this engine has no Intl.RelativeTimeFormat.
 */
export const formatRelativeDate: (data: {
  date: Date;
  now: Date;
  locale: string;
}) => string | null = (data: {
  date: Date;
  now: Date;
  locale: string;
}): string | null => {
  if (Number.isNaN(data.date.getTime())) {
    return null;
  }

  const distance: RelativeDistance = getRelativeDistance(data.date, data.now);

  if (distance.isNow) {
    const auto: RelativeTimeFormatter | null = getRelativeTimeFormatter(
      data.locale,
      "auto",
    );

    return auto ? auto.format(0, "second") : null;
  }

  const always: RelativeTimeFormatter | null = getRelativeTimeFormatter(
    data.locale,
    "always",
  );

  if (!always) {
    return null;
  }

  return always.format(
    distance.isFuture ? distance.count : -distance.count,
    distance.unit,
  );
};

/*
 * "in 2 Stunden", "قبل 3 أيام" - `count` `unit`s ahead of now, or behind it
 * when `isFuture` is false, in `locale`: for a caller that counts its own
 * units (a maintenance window's "in 2 hours", its minutes floored). Null
 * when this engine has no Intl.RelativeTimeFormat. `style` "short" writes
 * the unit as its language shortens it, for a narrow column: "vor 5 Min.",
 * "il y a 5 min"; "long" when left out. A count of 0 behind now is the
 * past: "vor 0 Sek.", never "in 0 Sek.". `numeric` "auto" says the words a
 * language has for a count where it has them - "now" for 0 seconds,
 * "gestern" for a day behind, "tomorrow" for one ahead - for a day's
 * heading or a hint; "always" (the default) counts: "vor 1 Tag". The
 * number is held to its unit (A NUMBER KEEPS ITS UNIT ON ITS LINE), in
 * English too. No locale is the runtime's own.
 *
 * The one place OneUptime asks Intl for a relative time, with
 * formatRelativeDate (NumbersKeepTheirUnitsInCodeGuard refuses another).
 */
export const formatRelativeAmount: (data: {
  count: number;
  unit: RelativeDateUnit;
  isFuture: boolean;
  locale: string | undefined;
  style?: RelativeDateStyle | undefined;
  numeric?: "auto" | "always" | undefined;
}) => string | null = (data: {
  count: number;
  unit: RelativeDateUnit;
  isFuture: boolean;
  locale: string | undefined;
  style?: RelativeDateStyle | undefined;
  numeric?: "auto" | "always" | undefined;
}): string | null => {
  const formatter: RelativeTimeFormatter | null = getRelativeTimeFormatter(
    data.locale,
    data.numeric || "always",
    data.style || "long",
  );

  if (!formatter) {
    return null;
  }

  return formatter.format(data.isFuture ? data.count : -data.count, data.unit);
};

/*
 * HOW LONG SOMETHING TOOK.
 */

export type DurationTextUnit =
  | "year"
  | "month"
  | "week"
  | "day"
  | "hour"
  | "minute"
  | "second"
  | "millisecond"
  | "microsecond"
  | "nanosecond";

export interface DurationTextPart {
  count: number;
  unit: DurationTextUnit;
}

/*
 * "2 Stunden", "2 Std.", "2h": one unit of a duration in `locale`, the
 * number held to its unit (A NUMBER KEEPS ITS UNIT ON ITS LINE), in
 * English too. Null when this engine cannot write the unit.
 */
export const formatDurationUnit: (data: {
  part: DurationTextPart;
  locale: string;
  unitDisplay: "long" | "short" | "narrow";
  maximumFractionDigits?: number | undefined;
}) => string | null = (data: {
  part: DurationTextPart;
  locale: string;
  unitDisplay: "long" | "short" | "narrow";
  maximumFractionDigits?: number | undefined;
}): string | null => {
  return formatUnitAmount({
    value: data.part.count,
    unit: data.part.unit,
    locale: data.locale,
    unitDisplay: data.unitDisplay,
    maximumFractionDigits: data.maximumFractionDigits ?? 0,
  });
};

/*
 * A duration's units in `locale`, with the language's own unit names,
 * plurals and list: "10 Tage, 23 Stunden", "10 jours et 23 heures", "10 日
 * 23 時間". `listStyle` "narrow" joins them as a compact reading does ("2 J.
 * 3 Mon."). Null when this engine cannot write one of the units.
 */
export const formatDurationText: (data: {
  parts: Array<DurationTextPart>;
  locale: string;
  unitDisplay: "long" | "short" | "narrow";
  listStyle: "long" | "short" | "narrow";
}) => string | null = (data: {
  parts: Array<DurationTextPart>;
  locale: string;
  unitDisplay: "long" | "short" | "narrow";
  listStyle: "long" | "short" | "narrow";
}): string | null => {
  if (data.parts.length === 0) {
    return null;
  }

  const words: Array<string> = [];

  for (const part of data.parts) {
    const word: string | null = formatDurationUnit({
      part,
      locale: data.locale,
      unitDisplay: data.unitDisplay,
    });

    if (!word) {
      return null;
    }

    words.push(word);
  }

  if (words.length === 1) {
    return words[0]!;
  }

  try {
    const ListFormat: ListFormatConstructor | undefined = (
      Intl as unknown as { ListFormat?: ListFormatConstructor | undefined }
    ).ListFormat;

    if (!ListFormat) {
      return words.join(data.listStyle === "narrow" ? " " : ", ");
    }

    return new ListFormat(data.locale, {
      type: "unit",
      style: data.listStyle,
    }).format(words);
  } catch {
    return words.join(data.listStyle === "narrow" ? " " : ", ");
  }
};

const numberFormatCache: Map<string, Intl.NumberFormat | null> = new Map<
  string,
  Intl.NumberFormat | null
>();

/*
 * A number as `locale` writes it - "1,72" in German - with at most
 * `maximumFractionDigits` decimals and no thousands separator, as a
 * duration's figure is read. Null when Intl cannot.
 */
export const formatDecimal: (data: {
  value: number;
  locale: string;
  maximumFractionDigits: number;
}) => string | null = (data: {
  value: number;
  locale: string;
  maximumFractionDigits: number;
}): string | null => {
  const key: string = `${data.locale}|${data.maximumFractionDigits}`;

  if (!numberFormatCache.has(key)) {
    try {
      numberFormatCache.set(
        key,
        new Intl.NumberFormat(getNumberLocale(data.locale), {
          maximumFractionDigits: data.maximumFractionDigits,
          useGrouping: false,
        }),
      );
    } catch {
      numberFormatCache.set(key, null);
    }
  }

  const format: Intl.NumberFormat | null = numberFormatCache.get(key) || null;

  return format ? format.format(data.value) : null;
};

const ASCII_DIGIT_REGEX: RegExp = /[0-9]/g;

const digitsCache: Map<string, Array<string>> = new Map<
  string,
  Array<string>
>();

// The ten digits `locale` writes, 0 to 9: Persian's ۰ to ۹, Latin elsewhere.
export const getDigitsOf: (locale: string) => Array<string> = (
  locale: string,
): Array<string> => {
  const cached: Array<string> | undefined = digitsCache.get(locale);

  if (cached) {
    return cached;
  }

  let digits: Array<string> = [
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
  ];

  try {
    const format: Intl.NumberFormat = new Intl.NumberFormat(
      getNumberLocale(locale),
      {
        useGrouping: false,
      },
    );

    digits = digits.map((digit: string): string => {
      return format.format(Number(digit));
    });
  } catch {
    // Latin, as written.
  }

  digitsCache.set(locale, digits);

  return digits;
};

/*
 * A figure OneUptime wrote itself - a time of day "09:00", a minute "05" -
 * in the digits `locale` writes: "۰۹:۰۰" in Persian, unchanged in every
 * language that writes Latin digits. Only for text that is all figures and
 * their marks; never for a name, an address or anything someone typed,
 * whose digits are theirs.
 */
export const writeDigitsInLocale: (text: string, locale: string) => string = (
  text: string,
  locale: string,
): string => {
  const digits: Array<string> = getDigitsOf(locale);

  if (digits[0] === "0") {
    return text;
  }

  return text.replace(ASCII_DIGIT_REGEX, (digit: string): string => {
    return digits[Number(digit)] || digit;
  });
};

/*
 * A TIME OF DAY'S MARKS ARE ITS LANGUAGE'S (#7914).
 *
 * Intl writes a time with the mark its language puts between the hours
 * and the minutes, as CLDR records it: a colon in every language the
 * Dashboard speaks but Danish, which writes a point - "kl. 10.05", as
 * Danish orthography writes it, CLDR's "HH.mm", and the clock a Danish
 * reader's own phone and computer show. Moment, and the times OneUptime
 * writes by hand ("09:00" working hours), always wrote a colon, so one
 * Danish page read "10.05" beside "10:05". A time OneUptime wrote itself
 * is written here with its language's mark and digits: "10.05" in Danish,
 * "۱۰:۰۵" in Persian, "10:05" in every other language.
 *
 * Milliseconds keep the point before them, as moment writes them, where
 * the language's mark is the colon ("11:55:59.120", one shape in every
 * such language, #7912). Where the language's mark is the point itself,
 * a point before them would read as one more part of the time
 * ("11.55.59.120"), so they take the language's decimal sign, as CLDR
 * writes a fraction of a second: "11.55.59,120" in Danish.
 */

// "09:30", "9:30", "14:30:12", "11:55:59.120": a clock OneUptime wrote.
const CLOCK_TEXT: RegExp = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;

// A mark between two figures: one character that is no letter, digit or space.
const CLOCK_MARK: RegExp = /^[^\p{L}\p{N}\s]$/u;

const timeSeparatorCache: Map<string, string> = new Map<string, string>();

/*
 * The mark `locale` writes between the hours and the minutes of a time of
 * day, read from Intl (CLDR's data): "." in Danish, ":" in every other
 * language of the product. A language that writes a word there ("10 h 05")
 * reads the colon.
 */
export const getTimeSeparator: (locale: string) => string = (
  locale: string,
): string => {
  const cached: string | undefined = timeSeparatorCache.get(locale);

  if (cached !== undefined) {
    return cached;
  }

  let separator: string = ":";

  try {
    const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
      getNumberLocale(locale),
      {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: "UTC",
      } as Intl.DateTimeFormatOptions,
    ).formatToParts(new Date(Date.UTC(2026, 0, 5, 10, 5)));
    const hourAt: number = parts.findIndex(
      (part: Intl.DateTimeFormatPart): boolean => {
        return part.type === "hour";
      },
    );
    const mark: Intl.DateTimeFormatPart | undefined = parts[hourAt + 1];

    if (
      hourAt >= 0 &&
      mark &&
      mark.type === "literal" &&
      parts[hourAt + 2]?.type === "minute" &&
      CLOCK_MARK.test(mark.value)
    ) {
      separator = mark.value;
    }
  } catch {
    // A locale Intl refuses: the colon, as moment writes it.
  }

  timeSeparatorCache.set(locale, separator);

  return separator;
};

const decimalSeparatorCache: Map<string, string> = new Map<string, string>();

// The decimal sign `locale` writes: "," in Danish and German, "." in English.
export const getDecimalSeparator: (locale: string) => string = (
  locale: string,
): string => {
  const cached: string | undefined = decimalSeparatorCache.get(locale);

  if (cached !== undefined) {
    return cached;
  }

  let decimal: string = ".";

  try {
    const part: Intl.NumberFormatPart | undefined = new Intl.NumberFormat(
      getNumberLocale(locale),
    )
      .formatToParts(1.5)
      .find((item: Intl.NumberFormatPart): boolean => {
        return item.type === "decimal";
      });

    if (part && part.value) {
      decimal = part.value;
    }
  } catch {
    // A locale Intl refuses: the point.
  }

  decimalSeparatorCache.set(locale, decimal);

  return decimal;
};

/*
 * A clock OneUptime wrote itself - "09:30", "14:30:12", "11:55:59.120" -
 * with `locale`'s mark between its parts and in its digits: "09.30" in
 * Danish, "۰۹:۳۰" in Persian. Any other text only takes the digits
 * (writeDigitsInLocale): never a name or anything someone typed.
 */
export const writeClockInLocale: (text: string, locale: string) => string = (
  text: string,
  locale: string,
): string => {
  const clock: RegExpMatchArray | null = text.match(CLOCK_TEXT);

  if (!clock) {
    return writeDigitsInLocale(text, locale);
  }

  const separator: string = getTimeSeparator(locale);
  let written: string = `${clock[1]}${separator}${clock[2]}`;

  if (clock[3] !== undefined) {
    written += `${separator}${clock[3]}`;
  }

  if (clock[4] !== undefined) {
    const fractionMark: string =
      separator === "." ? getDecimalSeparator(locale) : ".";

    written += `${fractionMark}${clock[4]}`;
  }

  return writeDigitsInLocale(written, locale);
};

/*
 * A DAY'S NAME STANDING ALONE (#7660).
 *
 * Inside a sentence most European languages write a day's name in lower
 * case ("lunes", "mandag"). Whether it takes a capital standing alone - on
 * a button, above a calendar's column, as an item of a menu - is each
 * language's own rule, which CLDR records in its contextTransforms
 * ("day-format-except-narrow", "day-standalone-except-narrow"). CLDR 48's
 * data, for the languages the Dashboard speaks:
 *   - es, it, nl, pt, ru: "titlecase-firstword" standing alone and in a
 *     list or menu: "Lunes", "Segunda-feira", "Понедельник";
 *   - fr: standing alone only: "Lundi" on a button and over a column,
 *     "lundi" in a menu;
 *   - da, nb and sv: none, so "mandag" and "måndag" everywhere. Their data
 *     does capitalise other words in a menu (a language's name, and in
 *     Swedish a currency's), never a day's;
 *   - de and en write a day with a capital everywhere, and ja, ko, zh, hi,
 *     ar and fa have no capitals.
 * The words are the locale's own; every day button, menu item and calendar
 * header draws its day's name through this - its aria-label and title too,
 * so the three agree.
 */
export type DayNameContext = "standAlone" | "menu";

export const DAY_NAME_TITLECASE_CONTEXTS: Readonly<
  Record<string, ReadonlyArray<DayNameContext>>
> = {
  es: ["standAlone", "menu"],
  fr: ["standAlone"],
  it: ["standAlone", "menu"],
  nl: ["standAlone", "menu"],
  pt: ["standAlone", "menu"],
  ru: ["standAlone", "menu"],
};

/*
 * A day's name, or a header that starts with one ("lun 16", "lunes, 16 de
 * noviembre"), as `language` writes it standing alone in `context`: its
 * first letter a capital where CLDR says so, as written everywhere else.
 */
export const writeStandAloneDayName: (data: {
  name: string;
  language: string | null | undefined;
  context: DayNameContext;
}) => string = (data: {
  name: string;
  language: string | null | undefined;
  context: DayNameContext;
}): string => {
  const base: string =
    (data.language || "")
      .trim()
      .toLowerCase()
      .split(LANGUAGE_SUBTAG_SEPARATOR)[0] || "";
  const contexts: ReadonlyArray<DayNameContext> | undefined =
    DAY_NAME_TITLECASE_CONTEXTS[base];

  if (!data.name || !contexts || !contexts.includes(data.context)) {
    return data.name;
  }

  const first: string = data.name.charAt(0);

  try {
    return first.toLocaleUpperCase(base) + data.name.slice(1);
  } catch {
    return first.toUpperCase() + data.name.slice(1);
  }
};
