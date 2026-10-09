import Dictionary from "../Dictionary";
import { MAX_MONITOR_REQUEST_TIMEOUT_IN_MS } from "../Monitor/MonitorStep";
import { ImportedStatusCodeRange } from "./ToolImportSnapshot";

/*
 * HOW AN UPTIME TOOL'S CHECK BECOMES A ONEUPTIME MONITOR - THE RULES EVERY
 * ADAPTER SHARES.
 *
 * Each uptime tool spells the same few ideas its own way: the status codes
 * that count as up ("2xx", "200-299", [200, 201]), how often it checks (in
 * seconds, minutes or a fixed list), the headers it sends. These read each
 * spelling into one shape, so every adapter makes the same decisions, and
 * the monitor the import creates checks what the tool checked.
 *
 * Isomorphic and pure: the adapters read with them, and the tests and the
 * page can too.
 */

// What an HTTP status code can be.
export const LOWEST_STATUS_CODE: number = 100;
export const HIGHEST_STATUS_CODE: number = 599;

/*
 * OneUptime's own rule for a new Website or API monitor: every 2xx and 3xx
 * is up (MonitorCriteriaInstance.DEFAULT_HEALTHY_STATUS_CODE_FROM/BELOW).
 * A check whose codes are exactly these gets the very criteria the Create
 * Monitor form gives.
 */
export const DEFAULT_ACCEPTED_STATUS_CODES: ReadonlyArray<ImportedStatusCodeRange> =
  [{ from: 200, to: 399 }];

const STATUS_CODE_CLASS: RegExp = /^([1-5])xx$/i;
const STATUS_CODE_RANGE: RegExp = /^(\d{3})\s*-\s*(\d{3})$/;
const STATUS_CODE: RegExp = /^\d{3}$/;

/*
 * The status codes a tool counts as up, as merged, sorted ranges: "2xx",
 * "200-299", "201" and 418 all read. Anything else - a code outside 100 to
 * 599, a range back to front, a word - is ignored. An empty answer means
 * the tool named nothing readable, and the caller keeps OneUptime's
 * default.
 */
export function readStatusCodeRanges(
  values: ReadonlyArray<unknown>,
): Array<ImportedStatusCodeRange> {
  const ranges: Array<ImportedStatusCodeRange> = [];

  for (const value of values) {
    const range: ImportedStatusCodeRange | null = readStatusCodeRange(value);

    if (range) {
      ranges.push(range);
    }
  }

  return mergeStatusCodeRanges(ranges);
}

function readStatusCodeRange(value: unknown): ImportedStatusCodeRange | null {
  if (typeof value === "number") {
    return isStatusCode(value) ? { from: value, to: value } : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();
  const statusClass: RegExpMatchArray | null = text.match(STATUS_CODE_CLASS);

  if (statusClass) {
    const hundred: number = Number(statusClass[1]) * 100;
    return { from: hundred, to: hundred + 99 };
  }

  const range: RegExpMatchArray | null = text.match(STATUS_CODE_RANGE);

  if (range) {
    const from: number = Number(range[1]);
    const to: number = Number(range[2]);

    return isStatusCode(from) && isStatusCode(to) && from <= to
      ? { from: from, to: to }
      : null;
  }

  if (STATUS_CODE.test(text)) {
    const code: number = Number(text);
    return isStatusCode(code) ? { from: code, to: code } : null;
  }

  return null;
}

function isStatusCode(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= LOWEST_STATUS_CODE &&
    value <= HIGHEST_STATUS_CODE
  );
}

// Sorted, with overlapping and touching ranges joined.
export function mergeStatusCodeRanges(
  ranges: ReadonlyArray<ImportedStatusCodeRange>,
): Array<ImportedStatusCodeRange> {
  const sorted: Array<ImportedStatusCodeRange> = [...ranges]
    .map((range: ImportedStatusCodeRange): ImportedStatusCodeRange => {
      return { from: range.from, to: range.to };
    })
    .sort((a: ImportedStatusCodeRange, b: ImportedStatusCodeRange): number => {
      return a.from - b.from;
    });

  const merged: Array<ImportedStatusCodeRange> = [];

  for (const range of sorted) {
    const last: ImportedStatusCodeRange | undefined =
      merged[merged.length - 1];

    if (last && range.from <= last.to + 1) {
      last.to = Math.max(last.to, range.to);
    } else {
      merged.push(range);
    }
  }

  return merged;
}

/*
 * The codes left over when `alerting` - the codes a tool raises an alert
 * on, as StatusCake lists them - are taken out of every code there is: the
 * codes that count as up.
 */
export function invertStatusCodeRanges(
  alerting: ReadonlyArray<ImportedStatusCodeRange>,
): Array<ImportedStatusCodeRange> {
  const up: Array<ImportedStatusCodeRange> = [];
  let next: number = LOWEST_STATUS_CODE;

  for (const range of mergeStatusCodeRanges(alerting)) {
    if (range.from > next) {
      up.push({ from: next, to: range.from - 1 });
    }

    next = Math.max(next, range.to + 1);
  }

  if (next <= HIGHEST_STATUS_CODE) {
    up.push({ from: next, to: HIGHEST_STATUS_CODE });
  }

  return up;
}

// Whether the ranges say what OneUptime's own default says: 2xx and 3xx.
export function isDefaultStatusCodeRanges(
  ranges: ReadonlyArray<ImportedStatusCodeRange> | undefined,
): boolean {
  if (!ranges || ranges.length === 0) {
    return true;
  }

  const merged: Array<ImportedStatusCodeRange> = mergeStatusCodeRanges(ranges);

  return (
    merged.length === DEFAULT_ACCEPTED_STATUS_CODES.length &&
    merged.every((range: ImportedStatusCodeRange, index: number): boolean => {
      return (
        range.from === DEFAULT_ACCEPTED_STATUS_CODES[index]!.from &&
        range.to === DEFAULT_ACCEPTED_STATUS_CODES[index]!.to
      );
    })
  );
}

/*
 * How often OneUptime can check a monitor: the intervals the Create Monitor
 * form offers (Dashboard Utils/MonitorIntervalDropdownOptions), shortest
 * first.
 */
export interface ToolImportMonitoringInterval {
  cron: string;
  seconds: number;
}

export const TOOL_IMPORT_MONITORING_INTERVALS: ReadonlyArray<ToolImportMonitoringInterval> =
  [
    { cron: "* * * * *", seconds: 60 },
    { cron: "*/2 * * * *", seconds: 2 * 60 },
    { cron: "*/5 * * * *", seconds: 5 * 60 },
    { cron: "*/10 * * * *", seconds: 10 * 60 },
    { cron: "*/15 * * * *", seconds: 15 * 60 },
    { cron: "*/30 * * * *", seconds: 30 * 60 },
    { cron: "0 * * * *", seconds: 60 * 60 },
    { cron: "0 0 * * *", seconds: 24 * 60 * 60 },
    { cron: "0 0 * * 0", seconds: 7 * 24 * 60 * 60 },
  ];

/*
 * What a monitor whose tool does not say how often it checks is checked
 * at: the Create Monitor form's own default (every five minutes).
 */
export const TOOL_IMPORT_DEFAULT_MONITORING_INTERVAL: ToolImportMonitoringInterval =
  TOOL_IMPORT_MONITORING_INTERVALS[2]!;

/*
 * The interval OneUptime offers that is closest to how often the tool
 * checks - and, of two equally close, the shorter one, so the monitor is
 * never slower to notice an outage than it was. Faster than once a minute
 * is once a minute: probes check no more often than that.
 */
export function toMonitoringInterval(
  seconds: number | undefined,
): ToolImportMonitoringInterval {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return TOOL_IMPORT_DEFAULT_MONITORING_INTERVAL;
  }

  let best: ToolImportMonitoringInterval = TOOL_IMPORT_MONITORING_INTERVALS[0]!;

  for (const interval of TOOL_IMPORT_MONITORING_INTERVALS) {
    if (Math.abs(interval.seconds - seconds) < Math.abs(best.seconds - seconds)) {
      best = interval;
    }
  }

  return best;
}

// The longest OneUptime waits for one check, in seconds.
export const TOOL_IMPORT_MAX_TIMEOUT_SECONDS: number =
  MAX_MONITOR_REQUEST_TIMEOUT_IN_MS / 1000;

/*
 * Headers that may carry a secret: a token, a password, a session. They
 * are not copied onto the monitor, where every member who may read
 * monitors would see them; the preview names each one, so the person can
 * add it with a monitor secret.
 */
const SECRET_HEADER_NAMES: ReadonlyArray<string> = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
];

const SECRET_HEADER_WORDS: ReadonlyArray<string> = [
  "token",
  "secret",
  "password",
  "passwd",
  "key",
  "auth",
  "session",
  "signature",
  "credential",
];

export function isSecretHeader(name: string): boolean {
  const lower: string = name.trim().toLowerCase();

  return (
    SECRET_HEADER_NAMES.includes(lower) ||
    SECRET_HEADER_WORDS.some((word: string): boolean => {
      return lower.includes(word);
    })
  );
}

// A header name: letters, digits and the punctuation RFC 9110 allows.
const HEADER_NAME: RegExp = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;

/*
 * Names that are an object's own machinery rather than a header: never
 * written as a key, so a header list read from a file can never reach an
 * object's prototype.
 */
export const OBJECT_KEYS: ReadonlyArray<string> = [
  "__proto__",
  "constructor",
  "prototype",
];
const MAX_HEADER_VALUE_LENGTH: number = 4096;

// A line break or another control character: not something a header holds.
function hasControlCharacter(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    // A tab is the one control character a header value may hold.
    if ((code < 32 && code !== 9) || code === 127) {
      return true;
    }
  }

  return false;
}

export interface ToolImportHeaderSplit {
  // The headers the monitor sends.
  kept: Dictionary<string>;
  // The names of the headers left out because they may hold a secret.
  leftOut: Array<string>;
}

/*
 * A tool's request headers, as the monitor will send them: each a valid
 * name with a one-line value, the ones that may hold a secret left out.
 */
export function splitRequestHeaders(
  headers: ReadonlyArray<{ name: string; value: string }>,
): ToolImportHeaderSplit {
  const kept: Dictionary<string> = {};
  const leftOut: Array<string> = [];

  for (const header of headers) {
    const name: string = (header.name || "").trim();
    const value: string = String(header.value ?? "").trim();

    if (
      !HEADER_NAME.test(name) ||
      OBJECT_KEYS.includes(name.toLowerCase()) ||
      value.length > MAX_HEADER_VALUE_LENGTH ||
      hasControlCharacter(value)
    ) {
      continue;
    }

    if (isSecretHeader(name)) {
      if (!leftOut.includes(name)) {
        leftOut.push(name);
      }
      continue;
    }

    kept[name] = value;
  }

  return { kept: kept, leftOut: leftOut };
}

/*
 * A request body as an API monitor sends it: a JSON object, written back
 * compactly. Null for anything else (a form, plain text, a JSON array):
 * OneUptime's API monitors send JSON objects only.
 */
export function readJsonObjectBody(text: unknown): string | null {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(text);

    return value && typeof value === "object" && !Array.isArray(value)
      ? JSON.stringify(value)
      : null;
  } catch {
    return null;
  }
}

/*
 * The minutes a heartbeat may stay silent before its monitor is down: the
 * tool's seconds, rounded up to whole minutes (a check that waited 90
 * seconds waits 2 minutes, never 1).
 */
export function toHeartbeatMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}
