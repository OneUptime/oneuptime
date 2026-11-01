import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";

/*
 * HOW A LIVE READ READS TO THE MODEL: compact plain text.
 *
 *   Live from AWS at 2026-10-27T10:00:05Z (ECS DescribeServices): ECS service arn:aws:ecs:...
 *   status: ACTIVE
 *   tasks: desired 4, running 3, pending 1
 *   events (newest 5 of 100):
 *   - 2026-10-27T09:58:00Z (service web) has started 1 tasks.
 *
 * The first line says what was read, from where, through which call and
 * when; then one labelled fact a line and lists of "- " items, each list
 * as long as the read's --limit (or a fixed few for describe). Every value
 * comes from the cloud and is read as data: it is put on one line (a line
 * break in a log message reads as " ⏎ ", any other control character as a
 * space) and cut to a length of its own, so no value can make a line of
 * its own or run on for megabytes. The scan is a loop over at most twice
 * the kept length - never a regular expression over the cloud's text.
 */

// The longest fact value kept, and the longest list item.
export const LIVE_READ_MAX_VALUE_LENGTH: number = 500;
export const LIVE_READ_MAX_ITEM_LENGTH: number = 1000;
// A log line is kept longer: its end is often the part that says what broke.
export const LIVE_READ_MAX_LOG_LINE_LENGTH: number = 2000;
const CUT_MARKER: string = "…";
const LINE_BREAK_MARKER: string = " ⏎ ";

/*
 * A value from the cloud as one line of at most maxLength characters: a
 * string as it is, a finite number or a boolean written out, anything else
 * "". Line breaks become " ⏎ " when keepLineBreaks is set (log lines) and
 * a space otherwise; other control characters become a space; runs of
 * spaces become one.
 */
export function liveText(
  value: unknown,
  maxLength: number = LIVE_READ_MAX_VALUE_LENGTH,
  options: { keepLineBreaks?: boolean | undefined } = {},
): string {
  let text: string = "";

  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    text = String(value);
  } else if (typeof value === "boolean") {
    text = value ? "true" : "false";
  }

  // Blank and control characters at either end say nothing.
  let start: number = 0;
  let end: number = text.length;

  while (start < end && isBlankCode(text.charCodeAt(start))) {
    start++;
  }

  while (end > start && isBlankCode(text.charCodeAt(end - 1))) {
    end--;
  }

  if (start >= end) {
    return "";
  }

  // Never scan more than twice what is kept.
  const scanEnd: number = Math.min(end, start + maxLength * 2);
  const scanned: string = text.slice(start, scanEnd);
  const isInputCut: boolean = scanEnd < end;
  const parts: Array<string> = [];
  let lastWasSpace: boolean = true;

  for (let index: number = 0; index < scanned.length; index++) {
    const char: string = scanned.charAt(index);
    const code: number = scanned.charCodeAt(index);

    if (char === "\n" || char === "\r") {
      // "\r\n" is one break.
      if (char === "\r" && scanned.charAt(index + 1) === "\n") {
        index++;
      }

      if (options.keepLineBreaks) {
        parts.push(LINE_BREAK_MARKER);
        lastWasSpace = true;
      } else if (!lastWasSpace) {
        parts.push(" ");
        lastWasSpace = true;
      }

      continue;
    }

    const isControl: boolean =
      code < 32 ||
      code === 127 ||
      (code >= 0x80 && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029;

    if (isControl || char === " ") {
      if (!lastWasSpace) {
        parts.push(" ");
        lastWasSpace = true;
      }

      continue;
    }

    parts.push(char);
    lastWasSpace = false;
  }

  let line: string = parts.join("").trim();

  if (line.length > maxLength || isInputCut) {
    line = `${sliceWhole(
      line,
      Math.max(0, maxLength - CUT_MARKER.length),
    ).trimEnd()}${CUT_MARKER}`;
  }

  return line;
}

// The first `length` characters, never ending on half of a surrogate pair.
export function sliceWhole(text: string, length: number): string {
  if (text.length <= length) {
    return text;
  }

  const code: number = text.charCodeAt(length - 1);

  return text.slice(
    0,
    code >= 0xd800 && code <= 0xdbff ? Math.max(0, length - 1) : length,
  );
}

// A space, a line break or any other control character.
function isBlankCode(code: number): boolean {
  return (
    code <= 32 ||
    code === 127 ||
    (code >= 0x80 && code <= 0xa0) ||
    code === 0x2028 ||
    code === 0x2029
  );
}

/*
 * A time as the reads write it: ISO 8601 in UTC, to the second (or the
 * millisecond, for log lines). Takes epoch milliseconds, a Date or a date
 * string; "" when it is none of those.
 */
export function liveTime(
  value: unknown,
  options: { milliseconds?: boolean | undefined } = {},
): string {
  let time: number = NaN;

  if (value instanceof Date) {
    time = value.getTime();
  } else if (typeof value === "number") {
    time = value;
  } else if (typeof value === "string" && value.trim()) {
    time = Date.parse(value.trim());
  }

  if (!Number.isFinite(time)) {
    return "";
  }

  const iso: string = new Date(time).toISOString();

  return options.milliseconds ? iso : `${iso.slice(0, 19)}Z`;
}

// "64 of 128 (50%)", or "64 of 128" when the limit is 0.
export function liveUsage(used: number, limit: number, unit?: string): string {
  const shownUnit: string = unit && unit !== "None" ? ` ${liveText(unit)}` : "";
  const percent: string =
    limit > 0 ? ` (${Math.round((used / limit) * 1000) / 10}%)` : "";

  return `${formatNumber(used)} of ${formatNumber(limit)}${shownUnit}${percent}`;
}

// A number as the reads write it: whole numbers as they are, others to two decimals.
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  return Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 100) / 100);
}

// "Live from AWS at <time> (<calls>): <what>".
export function liveHeader(data: {
  cloud: string;
  at: Date;
  calls: Array<string>;
  subject: string;
}): string {
  return `Live from ${data.cloud} at ${liveTime(data.at)} (${data.calls.join(
    ", ",
  )}): ${liveText(data.subject, LIVE_READ_MAX_ITEM_LENGTH)}`;
}

/*
 * The lines of one read's answer: the header first, then facts, lists and
 * notes in the order they are added.
 */
export class LiveReadText {
  private lines: Array<string> = [];

  public constructor(header: string) {
    this.lines.push(header);
  }

  // "label: value"; nothing when the value is empty.
  public fact(
    label: string,
    value: unknown,
    maxLength: number = LIVE_READ_MAX_VALUE_LENGTH,
  ): void {
    const text: string = liveText(value, maxLength);

    if (text) {
      this.lines.push(`${label}: ${text}`);
    }
  }

  // A line written by the reader itself (already made of safe values).
  public line(text: string): void {
    this.lines.push(text);
  }

  /*
   * "label (N):" and one "- item" a line, or "label: <empty>" when there
   * are none. `total` is how many there were when only some are shown.
   */
  public list(
    label: string,
    items: Array<string>,
    options: {
      total?: number | undefined;
      empty?: string | undefined;
      maxItemLength?: number | undefined;
    } = {},
  ): void {
    const kept: Array<string> = items
      .map((item: string): string => {
        return liveText(
          item,
          options.maxItemLength || LIVE_READ_MAX_ITEM_LENGTH,
          { keepLineBreaks: true },
        );
      })
      .filter((item: string): boolean => {
        return item.length > 0;
      });

    if (kept.length === 0) {
      this.lines.push(`${label}: ${options.empty || "none"}`);
      return;
    }

    const total: number =
      options.total !== undefined && options.total > kept.length
        ? options.total
        : kept.length;

    this.lines.push(
      `${label} (${total > kept.length ? `${kept.length} of ${total}` : kept.length}):`,
    );

    for (const item of kept) {
      this.lines.push(`- ${item}`);
    }
  }

  // "note: ..." for something the reader should know about the read itself.
  public note(text: string): void {
    const kept: string = liveText(text, LIVE_READ_MAX_ITEM_LENGTH);

    if (kept) {
      this.lines.push(`note: ${kept}`);
    }
  }

  public toString(): string {
    return this.lines.join("\n");
  }
}

/*
 * "key: value" items of a flat object (tags, a resource's kept
 * properties), sorted by key, at most `max` of them: numbers, booleans and
 * text as they are, a list of plain values joined with ", ", anything else
 * left out.
 */
export function liveEntries(
  source: JSONObject | Dictionary<string> | null | undefined,
  max: number,
): Array<string> {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return [];
  }

  const entries: Array<string> = [];

  for (const key of Object.keys(source).sort()) {
    if (entries.length >= max) {
      break;
    }

    const value: unknown = (source as Record<string, unknown>)[key];
    let shown: string = "";

    if (Array.isArray(value)) {
      shown = value
        .slice(0, 20)
        .map((item: unknown): string => {
          return liveText(item, 200);
        })
        .filter((item: string): boolean => {
          return item.length > 0;
        })
        .join(", ");
    } else {
      shown = liveText(value);
    }

    const name: string = liveText(key, 200);

    if (name && shown) {
      entries.push(`${name}: ${shown}`);
    }
  }

  return entries;
}

// How many entries an object has (for "N of M"), 0 for anything else.
export function countEntries(source: unknown): number {
  return source && typeof source === "object" && !Array.isArray(source)
    ? Object.keys(source as Record<string, unknown>).length
    : 0;
}

/*
 * Words joined for a sentence: "a", "a and b", "a, b and c" (the last
 * joined by `conjunction`).
 */
export function joinLiveWords(
  words: Array<string>,
  conjunction: string = "and",
): string {
  if (words.length <= 1) {
    return words.join("");
  }

  return `${words.slice(0, -1).join(", ")} ${conjunction} ${
    words[words.length - 1]
  }`;
}
