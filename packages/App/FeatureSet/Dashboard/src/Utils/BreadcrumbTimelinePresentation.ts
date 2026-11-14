import OneUptimeDate from "Common/Types/Date";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { getArrowOn, joinWithArrowsOn } from "Common/Types/DirectionArrow";
import {
  composedValue,
  createTranslator,
  PluralTemplate,
  TemplateValues,
  translationKey,
  Translator,
} from "Common/Types/Translator";

/*
 * Pure helpers for the exception Breadcrumbs card: what kind of event a span
 * event is, what one line should say about it, how far it sits from the
 * exception, and how identical neighbours fold together.
 *
 * The card's times and its description are in the reader's language
 * (#7726). They were English built in code - "at exception", "-1.2 s",
 * "-2 m 5 s", "8 events in the 12 s before the exception" - so every
 * language read English words and units, a Persian page Latin digits and a
 * German one an English decimal point. Each is now a key the reader's
 * language words, with its figures in the reader's digits and decimal sign
 * (formatReaderFigure). Seconds are the Dashboard's own "{{value}} s",
 * minutes each language's short unit, and the description whole sentences
 * in the language's plural. Handed no translator - a unit test, a caller
 * with no reader - each reads in English exactly as before. The
 * milliseconds ("-880 ms") are #7418's, with the Dashboard's other
 * hand-built milliseconds.
 */

// What a helper below writes in when it is handed no reader's translator.
const ENGLISH: Translator = createTranslator(undefined);

// The exception's own row, in the Relative format.
export const AT_EXCEPTION_TEXT: string = translationKey("at exception");

// "1.2 s", "12 s": seconds, as the Dashboard writes them elsewhere too.
export const SECONDS_TEMPLATE: string = translationKey("{{value}} s");

// "2 m" and "2 m 5 s": minutes, in each language's short unit.
export const MINUTES_TEMPLATE: string = translationKey("{{minutes}} m");

export const MINUTES_AND_SECONDS_TEMPLATE: string = translationKey(
  "{{minutes}} m {{seconds}} s",
);

// The card's description: how many events, and over how long.
export const EVENTS_TEMPLATE: PluralTemplate = {
  one: "{{count}} event",
  other: "{{count}} events",
};

export const EVENTS_BEFORE_THE_EXCEPTION_TEMPLATE: PluralTemplate = {
  one: "{{count}} event in the {{span}} before the exception",
  other: "{{count}} events in the {{span}} before the exception",
};

export const EVENTS_AROUND_THE_EXCEPTION_TEMPLATE: PluralTemplate = {
  one: "{{count}} event around the exception",
  other: "{{count}} events around the exception",
};

export const EVENTS_MATCHING_THE_FILTERS_TEMPLATE: PluralTemplate = {
  one: "{{filtered}} of {{count}} event match the filters",
  other: "{{filtered}} of {{count}} events match the filters",
};

// A description whose events are only the latest of more.
export const LATEST_OF_TOTAL_TEMPLATE: string = translationKey(
  "{{description}} (latest {{shown}} of {{total}})",
);

/*
 * A figure as the reader's language writes it, with exactly `decimals`
 * decimals, as toFixed writes them: "1.2" in English, "1,2" in German,
 * "۱٫۲" in Persian. English reads exactly as before, "1234" with no
 * thousands separator.
 */
const formatFigure: (
  translator: Translator,
  value: number,
  decimals: number,
) => string = (
  translator: Translator,
  value: number,
  decimals: number,
): string => {
  return formatReaderFigure(value, {
    decimals: decimals,
    language: translator.language,
  });
};

// The minus a language writes: "-" in most, U+2212 in Persian and Swedish.
const MINUS_SIGN: RegExp = /[-\u{2212}]/u;

/*
 * "-1.2" before the exception, "+3" after it. The figure before it takes
 * the language's own minus, and one after it a plus written the same way,
 * marks and all: Intl writes Persian's and Arabic's minus with a
 * left-to-right mark before it, and the plus takes the same mark, so on a
 * page read from the right both signs stand on the same side of their
 * digits.
 */
const writeSignedFigure: (
  translator: Translator,
  value: number,
  decimals: number,
  isBefore: boolean,
) => string = (
  translator: Translator,
  value: number,
  decimals: number,
  isBefore: boolean,
): string => {
  const asBefore: string = formatFigure(translator, -value, decimals);

  if (isBefore) {
    return asBefore;
  }

  return MINUS_SIGN.test(asBefore)
    ? asBefore.replace(MINUS_SIGN, "+")
    : `+${asBefore}`;
};

/*
 * A second or more: "1.2 s" under ten seconds, "12 s" under a minute, then
 * "2 m 5 s" or "2 m", in the reader's units and digits. With `isBefore`,
 * the leading figure says which side of the exception it is on: "-1.2 s",
 * "+3 s", "-2 m 5 s".
 */
const writeSecondsAndMinutes: (
  translator: Translator,
  absMs: number,
  isBefore?: boolean | undefined,
) => string = (
  translator: Translator,
  absMs: number,
  isBefore?: boolean | undefined,
): string => {
  const leading: (value: number, decimals: number) => string = (
    value: number,
    decimals: number,
  ): string => {
    return isBefore === undefined
      ? formatFigure(translator, value, decimals)
      : writeSignedFigure(translator, value, decimals, isBefore);
  };

  if (absMs < 10000) {
    return translator.translateTemplate(SECONDS_TEMPLATE, {
      value: leading(absMs / 1000, 1),
    });
  }

  if (absMs < 60000) {
    return translator.translateTemplate(SECONDS_TEMPLATE, {
      value: leading(Math.floor(absMs / 1000), 0),
    });
  }

  const minutes: number = Math.floor(absMs / 60000);
  const seconds: number = Math.floor((absMs % 60000) / 1000);

  return seconds === 0
    ? translator.translateTemplate(MINUTES_TEMPLATE, {
        minutes: leading(minutes, 0),
      })
    : translator.translateTemplate(MINUTES_AND_SECONDS_TEMPLATE, {
        minutes: leading(minutes, 0),
        seconds: formatFigure(translator, seconds, 0),
      });
};

export interface BreadcrumbEventInput {
  name: string;
  time: Date;
  timeUnixNano: number;
  attributes: JSONObject;
}

export enum BreadcrumbCategory {
  HTTP = "HTTP",
  DB = "DB",
  Log = "LOG",
  Error = "ERROR",
  Warning = "WARN",
  Event = "EVENT",
  Exception = "EXCEPTION",
}

// Filter chips and legends list categories in this order.
export const BREADCRUMB_CATEGORY_ORDER: ReadonlyArray<BreadcrumbCategory> = [
  BreadcrumbCategory.Exception,
  BreadcrumbCategory.Error,
  BreadcrumbCategory.Warning,
  BreadcrumbCategory.HTTP,
  BreadcrumbCategory.DB,
  BreadcrumbCategory.Log,
  BreadcrumbCategory.Event,
];

export const BREADCRUMB_CATEGORY_LABELS: Record<BreadcrumbCategory, string> = {
  [BreadcrumbCategory.Exception]: "Exception",
  [BreadcrumbCategory.Error]: "Error",
  [BreadcrumbCategory.Warning]: "Warning",
  [BreadcrumbCategory.HTTP]: "HTTP",
  [BreadcrumbCategory.DB]: "Database",
  [BreadcrumbCategory.Log]: "Log",
  [BreadcrumbCategory.Event]: "Event",
};

const SUMMARY_MAX_LENGTH: number = 160;

function readString(attributes: JSONObject, keys: Array<string>): string {
  for (const key of keys) {
    const value: JSONValue | undefined = attributes[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

function truncate(
  value: string,
  maxLength: number = SUMMARY_MAX_LENGTH,
): string {
  return value.length > maxLength ? `${value.substring(0, maxLength)}…` : value;
}

function readLevel(attributes: JSONObject): string {
  return readString(attributes, [
    "level",
    "severity",
    "log.level",
    "log.severity",
    "severity_text",
  ]).toLowerCase();
}

export function categorizeBreadcrumb(
  event: BreadcrumbEventInput,
): BreadcrumbCategory {
  const name: string = (event.name || "").toLowerCase();
  const attributes: JSONObject = event.attributes || {};
  const level: string = readLevel(attributes);

  if (name === "exception" || attributes["exception.type"]) {
    return BreadcrumbCategory.Exception;
  }

  if (
    name.includes("http") ||
    attributes["http.method"] ||
    attributes["http.request.method"] ||
    attributes["http.status_code"] ||
    attributes["http.response.status_code"] ||
    attributes["http.url"] ||
    attributes["url.full"]
  ) {
    return BreadcrumbCategory.HTTP;
  }

  if (
    name.includes("db") ||
    name.includes("database") ||
    name.includes("query") ||
    name.includes("sql") ||
    attributes["db.system"] ||
    attributes["db.statement"] ||
    attributes["db.query.text"]
  ) {
    return BreadcrumbCategory.DB;
  }

  if (
    name.includes("error") ||
    level === "error" ||
    level === "fatal" ||
    level === "critical"
  ) {
    return BreadcrumbCategory.Error;
  }

  if (name.includes("warn") || level === "warn" || level === "warning") {
    return BreadcrumbCategory.Warning;
  }

  if (name.includes("log") || name.includes("console") || level) {
    return BreadcrumbCategory.Log;
  }

  return BreadcrumbCategory.Event;
}

/*
 * What a row reads for an event that says nothing about itself - no name,
 * message, request or statement - in the reader's language: "Ereignis",
 * "رویداد" (#7818). Its summary is left empty, so neighbours fold the same
 * way whatever the reader's language, and the card draws this in its place.
 */
export const UNNAMED_EVENT_TEXT: string = translationKey("Event");

/*
 * The one line a row shows: the request, the statement, the exception
 * message or the log message — whatever says the most — falling back to the
 * event name, and to nothing (UNNAMED_EVENT_TEXT) without one. A request's
 * status follows it after an arrow that points the way a line read in
 * `language` reads (joinWithArrowsOn).
 */
export function getBreadcrumbSummary(
  event: BreadcrumbEventInput,
  language?: string | undefined,
): string {
  const attributes: JSONObject = event.attributes || {};

  const method: string = readString(attributes, [
    "http.method",
    "http.request.method",
  ]);
  const url: string = readString(attributes, [
    "http.url",
    "url.full",
    "http.target",
    "http.route",
  ]);

  if (method || url) {
    const status: string = readString(attributes, [
      "http.status_code",
      "http.response.status_code",
    ]);

    const request: string = `${method} ${url}`.trim();

    if (!status) {
      return truncate(request);
    }

    /*
     * A request too long for the line is cut short before its status, so
     * the status stays, and so does each mark that sets the two apart: a
     * line cut inside them would leave an isolate open over what follows.
     */
    return joinWithArrowsOn(
      [
        truncate(
          request,
          SUMMARY_MAX_LENGTH - ` ${getArrowOn(language)} ${status}`.length,
        ),
        status,
      ],
      language,
    );
  }

  const statement: string = readString(attributes, [
    "db.statement",
    "db.query.text",
  ]);

  if (statement) {
    return truncate(statement);
  }

  const exceptionMessage: string = readString(attributes, [
    "exception.message",
  ]);

  if (exceptionMessage) {
    return truncate(exceptionMessage);
  }

  const message: string = readString(attributes, [
    "message",
    "log.message",
    "event.message",
    "body",
  ]);

  if (message) {
    return truncate(message);
  }

  return event.name || "";
}

// A short qualifier under the summary: the exception type or a failed status.
export function getBreadcrumbDetail(
  event: BreadcrumbEventInput,
): string | null {
  const attributes: JSONObject = event.attributes || {};
  const exceptionType: string = readString(attributes, ["exception.type"]);

  if (exceptionType) {
    return exceptionType;
  }

  const status: number = Number(
    readString(attributes, ["http.status_code", "http.response.status_code"]),
  );

  if (Number.isFinite(status) && status >= 400) {
    return `HTTP ${status}`;
  }

  return null;
}

/*
 * Offset from the exception: "at exception", "-880 ms", "-1.2 s", "+3 s",
 * "-2 m 5 s", in the reader's language ("bei der Ausnahme", "-1,2 s",
 * "-2 Min. 5 s"). Without an exception time there is nothing to be
 * relative to, so the caller's absolute formatter is used instead.
 */
export function formatBreadcrumbOffset(
  eventTime: Date,
  exceptionTime: Date | undefined,
  translator: Translator = ENGLISH,
): string | null {
  if (!exceptionTime) {
    return null;
  }

  const diffMs: number = eventTime.getTime() - exceptionTime.getTime();
  const absMs: number = Math.abs(diffMs);
  const sign: string = diffMs < 0 ? "-" : "+";

  if (absMs < 10) {
    return translator.translateText(AT_EXCEPTION_TEXT) || AT_EXCEPTION_TEXT;
  }

  if (absMs < 1000) {
    return `${sign}${Math.round(absMs)} ms`;
  }

  return writeSecondsAndMinutes(translator, absMs, diffMs < 0);
}

/*
 * Wall-clock time with milliseconds, e.g. "14:03:07.412", in the timezone the
 * user picked in User Settings (the browser's zone when they have not), so it
 * agrees with the full timestamp in the row's tooltip. Its digits are the
 * reader's ("۱۴:۰۳:۰۷.۴۱۲" on a Persian page), its marks the same in every
 * language.
 */
export function formatBreadcrumbClockTime(eventTime: Date): string {
  return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
    date: eventTime,
    format: "HH:mm:ss.SSS",
  });
}

/*
 * "880 ms", "1.5 s", "12 s", "3 m 20 s" — the span of time the breadcrumbs
 * cover, in the reader's language.
 */
export function formatBreadcrumbSpan(
  durationMs: number,
  translator: Translator = ENGLISH,
): string {
  const absMs: number = Math.max(0, durationMs);

  if (absMs < 1000) {
    return `${Math.round(absMs)} ms`;
  }

  return writeSecondsAndMinutes(translator, absMs);
}

export interface BreadcrumbAttribute {
  key: string;
  value: string;
}

// Attributes worth showing: noisy and empty ones are dropped.
export function getBreadcrumbAttributes(
  event: BreadcrumbEventInput,
): Array<BreadcrumbAttribute> {
  const attributes: JSONObject = event.attributes || {};
  const skipKeys: Set<string> = new Set([
    "exception.escaped",
    "exception.stacktrace",
  ]);
  const result: Array<BreadcrumbAttribute> = [];

  for (const key of Object.keys(attributes)) {
    if (skipKeys.has(key)) {
      continue;
    }

    const value: JSONValue | undefined = attributes[key];

    if (value === null || value === undefined || value === "") {
      continue;
    }

    result.push({
      key,
      value: typeof value === "object" ? JSON.stringify(value) : String(value),
    });
  }

  return result;
}

export interface BreadcrumbGroup<TEvent extends BreadcrumbEventInput> {
  events: Array<TEvent>;
  category: BreadcrumbCategory;
  // Empty for events that say nothing about themselves (UNNAMED_EVENT_TEXT).
  summary: string;
  detail: string | null;
  firstTime: Date;
  lastTime: Date;
  count: number;
}

export function sortBreadcrumbEvents<TEvent extends BreadcrumbEventInput>(
  events: ReadonlyArray<TEvent>,
  maxEvents: number,
): Array<TEvent> {
  return [...events]
    .sort((a: TEvent, b: TEvent): number => {
      return a.timeUnixNano - b.timeUnixNano;
    })
    .slice(-Math.max(1, maxEvents));
}

/*
 * Consecutive events of the same category and summary fold into one row.
 * Each summary is written for a line read in `language`. Events that say
 * nothing about themselves fold on their empty summary, never on the word
 * the card draws for it, so the rows fold alike in every language.
 */
export function groupBreadcrumbEvents<TEvent extends BreadcrumbEventInput>(
  events: ReadonlyArray<TEvent>,
  language?: string | undefined,
): Array<BreadcrumbGroup<TEvent>> {
  const groups: Array<BreadcrumbGroup<TEvent>> = [];
  let current: BreadcrumbGroup<TEvent> | null = null;

  for (const event of events) {
    const category: BreadcrumbCategory = categorizeBreadcrumb(event);
    const summary: string = getBreadcrumbSummary(event, language);

    if (
      current &&
      current.category === category &&
      current.summary === summary
    ) {
      current.events.push(event);
      current.lastTime = event.time;
      current.count += 1;
      continue;
    }

    current = {
      events: [event],
      category,
      summary,
      detail: getBreadcrumbDetail(event),
      firstTime: event.time,
      lastTime: event.time,
      count: 1,
    };
    groups.push(current);
  }

  return groups;
}

export function countBreadcrumbCategories(
  events: ReadonlyArray<BreadcrumbEventInput>,
): Map<BreadcrumbCategory, number> {
  const counts: Map<BreadcrumbCategory, number> = new Map();

  for (const event of events) {
    const category: BreadcrumbCategory = categorizeBreadcrumb(event);
    counts.set(category, (counts.get(category) || 0) + 1);
  }

  return counts;
}

/*
 * The card's one-line description: how many events, and over how long before
 * the exception when that is known. Each is one sentence in the reader's
 * language, in its plural for the count ("1 Ereignis", "3 Ereignisse").
 */
export function describeBreadcrumbWindow(args: {
  shownCount: number;
  totalCount: number;
  filteredCount?: number | undefined;
  firstTime: Date | undefined;
  exceptionTime: Date | undefined;
  // The reader's; without one, English as before.
  translator?: Translator | undefined;
}): string {
  const translator: Translator = args.translator || ENGLISH;

  if (
    args.filteredCount !== undefined &&
    args.filteredCount !== args.shownCount
  ) {
    return translator.translatePlural(
      EVENTS_MATCHING_THE_FILTERS_TEMPLATE,
      args.shownCount,
      {
        filtered: formatFigure(translator, args.filteredCount, 0),
        count: formatFigure(translator, args.shownCount, 0),
      },
    );
  }

  const before: number | null =
    args.firstTime && args.exceptionTime
      ? args.exceptionTime.getTime() - args.firstTime.getTime()
      : null;

  // Written by the translator of the sentence it goes into.
  const describe: (sentence: Translator) => string = (
    sentence: Translator,
  ): string => {
    const values: TemplateValues = {
      count: formatFigure(sentence, args.shownCount, 0),
    };

    if (before === null) {
      return sentence.translatePlural(EVENTS_TEMPLATE, args.shownCount, values);
    }

    if (before > 0) {
      return sentence.translatePlural(
        EVENTS_BEFORE_THE_EXCEPTION_TEMPLATE,
        args.shownCount,
        { ...values, span: formatBreadcrumbSpan(before, sentence) },
      );
    }

    return sentence.translatePlural(
      EVENTS_AROUND_THE_EXCEPTION_TEMPLATE,
      args.shownCount,
      values,
    );
  };

  if (args.totalCount > args.shownCount) {
    return translator.translateTemplate(LATEST_OF_TOTAL_TEMPLATE, {
      description: composedValue(describe),
      shown: formatFigure(translator, args.shownCount, 0),
      total: formatFigure(translator, args.totalCount, 0),
    });
  }

  return describe(translator);
}
