import { JSONObject, JSONValue } from "Common/Types/JSON";

/*
 * Pure helpers for the exception Breadcrumbs card: what kind of event a span
 * event is, what one line should say about it, how far it sits from the
 * exception, and how identical neighbours fold together.
 */

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

function truncate(value: string): string {
  return value.length > SUMMARY_MAX_LENGTH
    ? `${value.substring(0, SUMMARY_MAX_LENGTH)}…`
    : value;
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
 * The one line a row shows: the request, the statement, the exception
 * message or the log message — whatever says the most — falling back to the
 * event name.
 */
export function getBreadcrumbSummary(event: BreadcrumbEventInput): string {
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

    return truncate(
      `${method} ${url}${status ? ` → ${status}` : ""}`.trim(),
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

  return event.name || "Event";
}

// A short qualifier under the summary: the exception type or a failed status.
export function getBreadcrumbDetail(event: BreadcrumbEventInput): string | null {
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
 * "-2 m 5 s". Without an exception time there is nothing to be relative to,
 * so the caller's absolute formatter is used instead.
 */
export function formatBreadcrumbOffset(
  eventTime: Date,
  exceptionTime: Date | undefined,
): string | null {
  if (!exceptionTime) {
    return null;
  }

  const diffMs: number = eventTime.getTime() - exceptionTime.getTime();
  const absMs: number = Math.abs(diffMs);
  const sign: string = diffMs < 0 ? "-" : "+";

  if (absMs < 10) {
    return "at exception";
  }

  if (absMs < 1000) {
    return `${sign}${Math.round(absMs)} ms`;
  }

  if (absMs < 10000) {
    return `${sign}${(absMs / 1000).toFixed(1)} s`;
  }

  if (absMs < 60000) {
    return `${sign}${Math.floor(absMs / 1000)} s`;
  }

  const minutes: number = Math.floor(absMs / 60000);
  const seconds: number = Math.floor((absMs % 60000) / 1000);

  return seconds === 0
    ? `${sign}${minutes} m`
    : `${sign}${minutes} m ${seconds} s`;
}

function pad(value: number, length: number = 2): string {
  return String(value).padStart(length, "0");
}

// Local wall-clock time with milliseconds, e.g. "14:03:07.412".
export function formatBreadcrumbClockTime(eventTime: Date): string {
  return `${pad(eventTime.getHours())}:${pad(eventTime.getMinutes())}:${pad(
    eventTime.getSeconds(),
  )}.${pad(eventTime.getMilliseconds(), 3)}`;
}

// "0.9 s", "12 s", "3 m 20 s" — the span of time the breadcrumbs cover.
export function formatBreadcrumbSpan(durationMs: number): string {
  const absMs: number = Math.max(0, durationMs);

  if (absMs < 1000) {
    return `${Math.round(absMs)} ms`;
  }

  if (absMs < 10000) {
    return `${(absMs / 1000).toFixed(1)} s`;
  }

  if (absMs < 60000) {
    return `${Math.floor(absMs / 1000)} s`;
  }

  const minutes: number = Math.floor(absMs / 60000);
  const seconds: number = Math.floor((absMs % 60000) / 1000);

  return seconds === 0 ? `${minutes} m` : `${minutes} m ${seconds} s`;
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

// Consecutive events of the same category and summary fold into one row.
export function groupBreadcrumbEvents<TEvent extends BreadcrumbEventInput>(
  events: ReadonlyArray<TEvent>,
): Array<BreadcrumbGroup<TEvent>> {
  const groups: Array<BreadcrumbGroup<TEvent>> = [];
  let current: BreadcrumbGroup<TEvent> | null = null;

  for (const event of events) {
    const category: BreadcrumbCategory = categorizeBreadcrumb(event);
    const summary: string = getBreadcrumbSummary(event);

    if (current && current.category === category && current.summary === summary) {
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
 * the exception when that is known.
 */
export function describeBreadcrumbWindow(args: {
  shownCount: number;
  totalCount: number;
  filteredCount?: number | undefined;
  firstTime: Date | undefined;
  exceptionTime: Date | undefined;
}): string {
  const plural: (count: number) => string = (count: number): string => {
    return `${count} event${count === 1 ? "" : "s"}`;
  };

  if (args.filteredCount !== undefined && args.filteredCount !== args.shownCount) {
    return `${args.filteredCount} of ${plural(args.shownCount)} match the filters`;
  }

  let text: string = plural(args.shownCount);

  if (args.firstTime && args.exceptionTime) {
    const before: number =
      args.exceptionTime.getTime() - args.firstTime.getTime();

    if (before > 0) {
      text += ` in the ${formatBreadcrumbSpan(before)} before the exception`;
    } else {
      text += " around the exception";
    }
  }

  if (args.totalCount > args.shownCount) {
    text += ` (latest ${args.shownCount} of ${args.totalCount})`;
  }

  return text;
}
