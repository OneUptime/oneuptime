import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import { getNumberLocale } from "Common/Types/DateLanguage";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import {
  DEFAULT_PRODUCT_ANALYTICS_TIME_ZONE,
  ProductAnalyticsDimension,
  ProductAnalyticsPeopleFilter,
  ProductAnalyticsPersonDto,
  ProductAnalyticsTrendDayDto,
  toProductAnalyticsTimeZone,
} from "Common/Types/Rum/ProductAnalytics";

/*
 * The words and numbers of the product analytics pages (issue #6444), kept
 * apart from React so each rule is tested on its own. Every label is
 * English the extractor finds (translationKey) and the page looks up where
 * it draws it.
 */

/*
 * The people list's filters, named as the tiles above name the same
 * people, so a chip and a tile read alike in every language.
 */

export const PRODUCT_ANALYTICS_FILTER_LABELS: Record<
  ProductAnalyticsPeopleFilter,
  string
> = {
  [ProductAnalyticsPeopleFilter.Active]: translationKey("Active users"),
  [ProductAnalyticsPeopleFilter.New]: translationKey("New users"),
  [ProductAnalyticsPeopleFilter.Returning]: translationKey("Returning users"),
  [ProductAnalyticsPeopleFilter.SignedIn]: translationKey("Signed-in users"),
  [ProductAnalyticsPeopleFilter.Anonymous]:
    translationKey("Anonymous visitors"),
  [ProductAnalyticsPeopleFilter.Dormant]: translationKey("Dormant users"),
  [ProductAnalyticsPeopleFilter.All]: translationKey("Everyone"),
};

/* ---- What sessions can be broken down by. ---- */

export const PRODUCT_ANALYTICS_DIMENSION_LABELS: Record<
  ProductAnalyticsDimension,
  string
> = {
  [ProductAnalyticsDimension.DeviceType]: translationKey("Device type"),
  [ProductAnalyticsDimension.Browser]: translationKey("Browser"),
  [ProductAnalyticsDimension.OperatingSystem]:
    translationKey("Operating system"),
  [ProductAnalyticsDimension.Country]: translationKey("Country"),
  [ProductAnalyticsDimension.AppVersion]: translationKey("App version"),
  [ProductAnalyticsDimension.EntryPage]: translationKey("Entry page"),
  [ProductAnalyticsDimension.Page]: translationKey("Page"),
};

/* ---- Session length buckets, by PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS key. ---- */

export const PRODUCT_ANALYTICS_SESSION_LENGTH_LABELS: Record<string, string> = {
  "under-10s": translationKey("Under 10 seconds"),
  "10s-30s": translationKey("10 to 30 seconds"),
  "30s-1m": translationKey("30 seconds to 1 minute"),
  "1m-3m": translationKey("1 to 3 minutes"),
  "3m-10m": translationKey("3 to 10 minutes"),
  "10m-30m": translationKey("10 to 30 minutes"),
  "30m-plus": translationKey("30 minutes or more"),
};

/* ---- Device types, as the recorders report them. ---- */

const DEVICE_LABELS: Record<string, string> = {
  desktop: translationKey("Desktop"),
  mobile: translationKey("Mobile"),
  tablet: translationKey("Tablet"),
};

export const NOT_REPORTED: string = translationKey("Not reported");

/*
 * A breakdown value as the reader reads it: a device type in their
 * language, a country by its name in their language (Intl), anything else -
 * a browser, a version, a page - as the recorder wrote it. A session that
 * reported nothing reads "Not reported", never a blank row.
 */
export function describeProductAnalyticsValue(data: {
  dimension: ProductAnalyticsDimension;
  value: string;
  translator: Translator;
}): string {
  const value: string = data.value.trim();

  if (!value) {
    return data.translator.translateText(NOT_REPORTED) || NOT_REPORTED;
  }

  if (data.dimension === ProductAnalyticsDimension.DeviceType) {
    return describeProductAnalyticsDevice(value, data.translator);
  }

  if (data.dimension === ProductAnalyticsDimension.Country) {
    return describeProductAnalyticsCountry(value, data.translator.language);
  }

  return value;
}

export function describeProductAnalyticsDevice(
  value: string,
  translator: Translator,
): string {
  const label: string | undefined = DEVICE_LABELS[value.trim().toLowerCase()];

  if (!value.trim()) {
    return translator.translateText(NOT_REPORTED) || NOT_REPORTED;
  }

  return label ? translator.translateText(label) || label : value;
}

// A country as the sessions carry it: ISO 3166-1 alpha-2, "DE".
const COUNTRY_CODE: RegExp = /^[A-Z]{2}$/;

/* A two-letter country code by its name in the reader's language, else the code. */
export function describeProductAnalyticsCountry(
  code: string,
  language: string,
): string {
  const region: string = code.trim().toUpperCase();

  if (!COUNTRY_CODE.test(region)) {
    return code.trim();
  }

  try {
    const name: string | undefined = new Intl.DisplayNames([language, "en"], {
      type: "region",
    }).of(region);

    return name && name !== region ? name : region;
  } catch {
    return region;
  }
}

/* ---- Numbers. ---- */

export function formatProductAnalyticsCount(
  value: number,
  translator: Translator,
): string {
  return translator.formatNumber(Math.round(value));
}

/*
 * A share of a whole as a whole percent ("42%"), "0%" of nothing. Numbers
 * take getNumberLocale's locale, never the bare language: Arabic writes
 * Latin digits in OneUptime, which a bare "ar" does not ask for.
 */
export function formatProductAnalyticsShare(data: {
  part: number;
  whole: number;
  language: string;
}): string {
  const share: number = data.whole > 0 ? data.part / data.whole : 0;

  try {
    return new Intl.NumberFormat(getNumberLocale(data.language), {
      style: "percent",
      maximumFractionDigits: share > 0 && share < 0.01 ? 1 : 0,
    }).format(share);
  } catch {
    return `${Math.round(share * 100)}%`;
  }
}

/* A session's length in the reader's language: "2m 15s", "2 Min., 15 Sek.". */
export function formatProductAnalyticsDuration(
  ms: number,
  language: string,
): string {
  return formatDurationCompactInLanguage(
    Math.max(0, Math.round(ms / 1000)),
    language,
  );
}

export function formatProductAnalyticsAverage(
  value: number,
  language: string,
): string {
  try {
    return new Intl.NumberFormat(getNumberLocale(language), {
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(Math.round(value * 10) / 10);
  }
}

/*
 * How a number moved since the range before, as the line under its tile.
 * Whole percents; "None in the previous period" when there was nothing to
 * compare with, and nothing at all when both are zero.
 */
export const CHANGE_UP: string = translationKey(
  "Up {{percent}} on the previous period",
);
export const CHANGE_DOWN: string = translationKey(
  "Down {{percent}} on the previous period",
);
export const CHANGE_SAME: string = translationKey(
  "Same as the previous period",
);
export const CHANGE_NEW: string = translationKey("None in the previous period");
export const CHANGE_NOT_COUNTED: string = translationKey(
  "Previous period not fully counted",
);

/*
 * Whether the range before was counted from its start. Counting starts
 * with the first session recorded once product analytics runs, and the
 * oldest month leaves after 13: a period that began before the first
 * session kept is only partly counted, and a change against it would read
 * as growth that never happened.
 */
export function isProductAnalyticsPreviousPeriodCounted(summary: {
  dataStartedAt: number | null;
  previousStartTime: number;
}): boolean {
  return (
    summary.dataStartedAt === null ||
    summary.dataStartedAt <= summary.previousStartTime
  );
}

export function describeProductAnalyticsChange(data: {
  current: number;
  previous: number;
  translator: Translator;
  // False when the range before was only partly counted: nothing to compare with.
  isPreviousPeriodCounted?: boolean | undefined;
}): string | undefined {
  const current: number = Math.max(0, data.current);
  const previous: number = Math.max(0, data.previous);

  if (current === 0 && previous === 0) {
    return undefined;
  }

  if (data.isPreviousPeriodCounted === false) {
    return (
      data.translator.translateText(CHANGE_NOT_COUNTED) || CHANGE_NOT_COUNTED
    );
  }

  if (previous === 0) {
    return data.translator.translateText(CHANGE_NEW) || CHANGE_NEW;
  }

  const change: number = (current - previous) / previous;

  if (Math.abs(change) < 0.005) {
    return data.translator.translateText(CHANGE_SAME) || CHANGE_SAME;
  }

  const percent: string = formatProductAnalyticsShare({
    part: Math.abs(current - previous),
    whole: previous,
    language: data.translator.language,
  });

  return data.translator.translateTemplate(
    change > 0 ? CHANGE_UP : CHANGE_DOWN,
    { percent: percent },
  );
}

/* ---- People. ---- */

export const SIGNED_IN_USER: string = translationKey("Signed-in user");
export const ANONYMOUS_VISITOR: string = translationKey("Anonymous visitor");

export interface ProductAnalyticsPersonWords {
  // The name a row leads with.
  primary: string;
  // What it is, or the short id that tells two nameless people apart.
  secondary: string;
  // The primary line is the person's own reference, drawn as written.
  isLabel: boolean;
}

/* The first eight characters of an id, for telling two nameless people apart. */
export function shortProductAnalyticsId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/*
 * A person as a row names them: a signed-in user by the reference the
 * application gave identify(), when the reader may see it and a kept
 * recording still has it; otherwise as a signed-in user or an anonymous
 * visitor, with the start of their id.
 */
export function describeProductAnalyticsPerson(
  person: ProductAnalyticsPersonDto,
  translator: Translator,
): ProductAnalyticsPersonWords {
  const signedIn: string =
    translator.translateText(SIGNED_IN_USER) || SIGNED_IN_USER;

  if (person.kind === "identified") {
    const label: string = (person.identifiedUserLabel || "").trim();

    if (label) {
      return { primary: label, secondary: signedIn, isLabel: true };
    }

    return {
      primary: signedIn,
      secondary: shortProductAnalyticsId(person.identifiedUserKey),
      isLabel: false,
    };
  }

  return {
    primary: translator.translateText(ANONYMOUS_VISITOR) || ANONYMOUS_VISITOR,
    secondary: shortProductAnalyticsId(person.visitorId),
    isLabel: false,
  };
}

/* ---- Time zones and days. ---- */

/*
 * The zone the pages count days in: the reader's own (their User Settings
 * zone, else the browser's), as the database spells it - or UTC when the
 * runtime does not know it, so the trend never fails over a zone name.
 */
export function getProductAnalyticsTimeZone(zone: string | undefined): string {
  return (
    toProductAnalyticsTimeZone(zone) || DEFAULT_PRODUCT_ANALYTICS_TIME_ZONE
  );
}

function readZoneOffsetMs(instant: number, timeZone: string): number {
  const parts: Record<string, number> = {};

  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant))) {
    if (part.type !== "literal") {
      parts[part.type] = Number(part.value);
    }
  }

  const wallClock: number = Date.UTC(
    parts["year"] || 1970,
    (parts["month"] || 1) - 1,
    parts["day"] || 1,
    parts["hour"] || 0,
    parts["minute"] || 0,
    parts["second"] || 0,
  );

  return wallClock - Math.floor(instant / 1000) * 1000;
}

/* The day ("2026-03-01") an instant falls on in a zone. */
function readZoneDay(instant: number, timeZone: string): string {
  return new Date(instant + readZoneOffsetMs(instant, timeZone))
    .toISOString()
    .slice(0, 10);
}

// A day as the trend reads it: "2026-03-01".
const DAY: RegExp = /^(\d{4})-(\d{2})-(\d{2})$/;

/*
 * The instant a day ("2026-03-01") starts in a zone: where the trend's
 * points go on the chart's time axis, so each sits on its own day in the
 * reader's zone, whatever its offset or daylight saving. Null for anything
 * that is not a day.
 */
export function getProductAnalyticsDayStart(
  day: string,
  timeZone: string,
): Date | null {
  const match: RegExpExecArray | null = DAY.exec(day);

  if (!match) {
    return null;
  }

  const midnightUtc: number = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );

  /* "2026-02-30" is no day: Date.UTC would quietly make it 2 March. */
  if (
    !Number.isFinite(midnightUtc) ||
    new Date(midnightUtc).toISOString().slice(0, 10) !== day
  ) {
    return null;
  }

  try {
    const first: number = midnightUtc - readZoneOffsetMs(midnightUtc, timeZone);
    /* Once more at the instant found: the offset may change across the day. */
    const second: number = midnightUtc - readZoneOffsetMs(first, timeZone);
    /*
     * The earlier of the two that is on the day. Where a day has no
     * midnight (Chile's clocks go from 00:00 straight to 01:00), one of them
     * is an hour early, on the day before; the other is the day's first
     * instant.
     */
    const onTheDay: Array<number> = [first, second]
      .filter((instant: number): boolean => {
        return readZoneDay(instant, timeZone) === day;
      })
      .sort((a: number, b: number): number => {
        return a - b;
      });

    return new Date(onTheDay[0] ?? second);
  } catch {
    return new Date(midnightUtc);
  }
}

export interface ProductAnalyticsSeriesSpec {
  // The line's name, as English the chart translates.
  seriesName: string;
  read: (day: ProductAnalyticsTrendDayDto) => number;
}

/* The trend's days as chart lines, one point a day at the day's start in the zone. */
export function toProductAnalyticsSeries(data: {
  days: Array<ProductAnalyticsTrendDayDto>;
  timeZone: string;
  series: Array<ProductAnalyticsSeriesSpec>;
}): Array<SeriesPoint> {
  return data.series.map((spec: ProductAnalyticsSeriesSpec): SeriesPoint => {
    const points: SeriesPoint["data"] = [];

    for (const day of data.days) {
      const start: Date | null = getProductAnalyticsDayStart(
        day.day,
        data.timeZone,
      );

      if (start) {
        points.push({ x: start, y: spec.read(day) });
      }
    }

    return { seriesName: spec.seriesName, data: points };
  });
}

/*
 * The trend from the day counting started, in the zone its days are in. A
 * day before the first session kept was never counted: drawn as zero, it
 * would read as a day nobody came.
 */
export function getProductAnalyticsCountedDays(data: {
  days: Array<ProductAnalyticsTrendDayDto>;
  dataStartedAt: number | null;
  timeZone: string;
}): Array<ProductAnalyticsTrendDayDto> {
  if (data.dataStartedAt === null) {
    return data.days;
  }

  let firstDay: string;

  try {
    firstDay = readZoneDay(data.dataStartedAt, data.timeZone);
  } catch {
    return data.days;
  }

  return data.days.filter((day: ProductAnalyticsTrendDayDto): boolean => {
    return day.day >= firstDay;
  });
}

/* The chart's window: from the first day's start to the last day's. */
export function getProductAnalyticsTrendWindow(data: {
  days: Array<ProductAnalyticsTrendDayDto>;
  timeZone: string;
}): { start: Date; end: Date } | null {
  const first: ProductAnalyticsTrendDayDto | undefined = data.days[0];
  const last: ProductAnalyticsTrendDayDto | undefined =
    data.days[data.days.length - 1];

  if (!first || !last) {
    return null;
  }

  const start: Date | null = getProductAnalyticsDayStart(
    first.day,
    data.timeZone,
  );
  const end: Date | null = getProductAnalyticsDayStart(last.day, data.timeZone);

  if (!start || !end) {
    return null;
  }

  /* A single day still needs a window: it spans that day. */
  return end.getTime() > start.getTime()
    ? { start: start, end: end }
    : { start: start, end: new Date(start.getTime() + 86400000) };
}
