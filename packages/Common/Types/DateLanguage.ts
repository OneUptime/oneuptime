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
 * React-free and free of the rest of OneUptime, so OneUptimeDate, the
 * translation layer and any frontend can use it.
 */

import moment from "moment-timezone";
import OldestKeyMap from "../Utils/OldestKeyMap";

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
 * DATE AND TIME OF DAY.
 */

const dateTimeFormatCache: Map<string, Intl.DateTimeFormat | null> = new Map<
  string,
  Intl.DateTimeFormat | null
>();

/*
 * A formatter for `options` in `locale`, read in the first of `timezones`
 * this engine's Intl knows (an engine with older tzdata knows "Europe/Kiev"
 * but not "Europe/Kyiv"); none means the runtime's own zone. Null when no
 * zone works, so the caller writes the English moment knows how to write.
 * Built once per locale, zone and shape: a table writes hundreds of dates.
 */
export const getDateTimeFormat: (data: {
  locale: string;
  timezones: Array<string>;
  options: Intl.DateTimeFormatOptions;
}) => Intl.DateTimeFormat | null = (data: {
  locale: string;
  timezones: Array<string>;
  options: Intl.DateTimeFormatOptions;
}): Intl.DateTimeFormat | null => {
  const zones: Array<string | undefined> =
    data.timezones.length > 0 ? data.timezones : [undefined];
  const shape: string = JSON.stringify(data.options);

  for (const zone of zones) {
    const key: string = `${data.locale}|${zone || ""}|${shape}`;

    if (dateTimeFormatCache.has(key)) {
      const cached: Intl.DateTimeFormat | null =
        dateTimeFormatCache.get(key) || null;

      if (cached) {
        return cached;
      }

      continue;
    }

    try {
      const format: Intl.DateTimeFormat = new Intl.DateTimeFormat(
        getNumberLocale(data.locale),
        zone ? { ...data.options, timeZone: zone } : data.options,
      );

      dateTimeFormatCache.set(key, format);

      return format;
    } catch {
      dateTimeFormatCache.set(key, null);
    }
  }

  return null;
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
    options.hour = "2-digit";
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
  | "month"
  | "year";

interface RelativeTimeFormatter {
  format: (value: number, unit: RelativeDateUnit) => string;
}

type RelativeTimeFormatConstructor = new (
  locale: string,
  options: { numeric: "auto" | "always"; style: "long" | "short" | "narrow" },
) => RelativeTimeFormatter;

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

const getRelativeTimeFormatter: (
  locale: string,
  numeric: "auto" | "always",
) => RelativeTimeFormatter | null = (
  locale: string,
  numeric: "auto" | "always",
): RelativeTimeFormatter | null => {
  const key: string = `${locale}|${numeric}`;

  if (relativeTimeFormatCache.has(key)) {
    return relativeTimeFormatCache.get(key) || null;
  }

  let formatter: RelativeTimeFormatter | null = null;

  try {
    const RelativeTimeFormat: RelativeTimeFormatConstructor | undefined = (
      Intl as unknown as {
        RelativeTimeFormat?: RelativeTimeFormatConstructor | undefined;
      }
    ).RelativeTimeFormat;

    if (RelativeTimeFormat) {
      formatter = new RelativeTimeFormat(getNumberLocale(locale) || locale, {
        numeric: numeric,
        style: "long",
      });
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

interface UnitFormatter {
  format: (value: number) => string;
}

const unitFormatCache: Map<string, UnitFormatter | null> = new Map<
  string,
  UnitFormatter | null
>();

// The Intl.NumberFormat the cache was built with: another one starts afresh.
let unitFormatCacheOwner: unknown = null;

const getUnitFormatter: (data: {
  locale: string;
  unit: DurationTextUnit;
  unitDisplay: "long" | "short" | "narrow";
  maximumFractionDigits: number;
}) => UnitFormatter | null = (data: {
  locale: string;
  unit: DurationTextUnit;
  unitDisplay: "long" | "short" | "narrow";
  maximumFractionDigits: number;
}): UnitFormatter | null => {
  const key: string = `${data.locale}|${data.unit}|${data.unitDisplay}|${data.maximumFractionDigits}`;

  if (unitFormatCacheOwner !== Intl.NumberFormat) {
    unitFormatCache.clear();
    unitFormatCacheOwner = Intl.NumberFormat;
  }

  if (unitFormatCache.has(key)) {
    return unitFormatCache.get(key) || null;
  }

  let formatter: UnitFormatter | null = null;

  try {
    const candidate: Intl.NumberFormat = new Intl.NumberFormat(
      getNumberLocale(data.locale),
      {
        style: "unit",
        unit: data.unit,
        unitDisplay: data.unitDisplay,
        maximumFractionDigits: data.maximumFractionDigits,
      } as Intl.NumberFormatOptions,
    );

    // An engine without the unit style writes the bare number.
    const probe: string = candidate.format(2);

    formatter =
      probe === (2).toLocaleString(getNumberLocale(data.locale))
        ? null
        : (candidate as UnitFormatter);
  } catch {
    formatter = null;
  }

  unitFormatCache.set(key, formatter);

  return formatter;
};

// "2 Stunden", "2 Std.", "2h": one unit of a duration in `locale`.
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
  const formatter: UnitFormatter | null = getUnitFormatter({
    locale: data.locale,
    unit: data.part.unit,
    unitDisplay: data.unitDisplay,
    maximumFractionDigits: data.maximumFractionDigits ?? 0,
  });

  return formatter ? formatter.format(data.part.count) : null;
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
