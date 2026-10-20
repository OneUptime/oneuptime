/*
 * A calendar's text, cut down to what OneUptime reads before a parser sees
 * it.
 *
 * The text comes from wherever a calendar link points, so it is untrusted,
 * and much of a real calendar is never read here: descriptions written as
 * HTML (X-ALT-DESC), attendee lists, attachments carried inline as base64 -
 * megabytes on one line in an Exchange export. ical.js reads some line
 * shapes in time that grows with the square of their length (a line of a
 * hundred thousand parameters took 40 seconds), so the lines it never needs
 * are dropped first, in one pass:
 *
 *   - only the properties in KEPT_PROPERTIES survive, with BEGIN and END so
 *     the components stay whole;
 *   - a kept line longer than EXTERNAL_CALENDAR_MAX_LINE_LENGTH is dropped
 *     too: no title, time or rule is that long;
 *   - EXDATE and RDATE keep at most EXTERNAL_CALENDAR_MAX_DATE_LIST_VALUES
 *     dates between them.
 *
 * Lines are unfolded as RFC 5545 says - a line break followed by one space
 * or tab continues the line - with CRLF or LF line breaks. The pass is a
 * loop over the text with indexOf: no regular expression reads it.
 */

// The properties read from a calendar (components' BEGIN and END included).
export const KEPT_PROPERTIES: ReadonlyArray<string> = [
  "BEGIN",
  "END",
  "VERSION",
  "PRODID",
  "CALSCALE",
  "X-WR-TIMEZONE",
  "UID",
  "SUMMARY",
  "CLASS",
  "STATUS",
  "DTSTART",
  "DTEND",
  "DURATION",
  "RRULE",
  "RDATE",
  "EXDATE",
  "RECURRENCE-ID",
  "TZID",
  "TZOFFSETFROM",
  "TZOFFSETTO",
  "TZNAME",
];

// The longest line kept, in characters, once unfolded.
export const EXTERNAL_CALENDAR_MAX_LINE_LENGTH: number = 16 * 1024;

// The most EXDATE and RDATE dates kept, across the whole calendar.
export const EXTERNAL_CALENDAR_MAX_DATE_LIST_VALUES: number = 20000;

const KEPT_PROPERTY_SET: Set<string> = new Set<string>(KEPT_PROPERTIES);

const DATE_LIST_PROPERTIES: Set<string> = new Set<string>(["EXDATE", "RDATE"]);

const CARRIAGE_RETURN: number = 13;
const SPACE: number = 32;
const TAB: number = 9;
const BYTE_ORDER_MARK: number = 0xfeff;

export interface PreparedExternalCalendarText {
  // The kept lines, unfolded, joined with CRLF.
  text: string;
  keptLineCount: number;
  droppedLineCount: number;
}

// The name of a content line: what comes before its first ";" or ":".
export function getPropertyName(line: string): string {
  let end: number = line.length;

  const semicolon: number = line.indexOf(";");
  const colon: number = line.indexOf(":");

  if (semicolon !== -1 && semicolon < end) {
    end = semicolon;
  }

  if (colon !== -1 && colon < end) {
    end = colon;
  }

  return line.slice(0, end).trim().toUpperCase();
}

// The value of a content line: what comes after the colon that ends its name and parameters.
function getSimpleValue(line: string): string {
  const colon: number = line.indexOf(":");

  return colon === -1 ? "" : line.slice(colon + 1).trim();
}

function countListValues(line: string): number {
  const value: string = getSimpleValue(line);

  if (!value) {
    return 0;
  }

  let count: number = 1;
  let position: number = value.indexOf(",");

  while (position !== -1) {
    count++;
    position = value.indexOf(",", position + 1);
  }

  return count;
}

/*
 * The calendar as ical.js reads it, or null when the text is not a calendar
 * at all: its first line must be BEGIN:VCALENDAR (a sign-in page or an
 * error page an address answers with is not).
 */
export function prepareExternalCalendarText(
  raw: string,
): PreparedExternalCalendarText | null {
  const length: number = raw.length;
  let position: number =
    length > 0 && raw.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0;

  const kept: Array<string> = [];
  let droppedLineCount: number = 0;
  let dateListValues: number = 0;
  let isFirstLine: boolean = true;

  while (position < length) {
    // One logical line: a physical line and those that continue it.
    const pieces: Array<string> = [];
    let lineLength: number = 0;
    let isTooLong: boolean = false;

    for (;;) {
      let lineEnd: number = raw.indexOf("\n", position);

      if (lineEnd === -1) {
        lineEnd = length;
      }

      let contentEnd: number = lineEnd;

      if (
        contentEnd > position &&
        raw.charCodeAt(contentEnd - 1) === CARRIAGE_RETURN
      ) {
        contentEnd--;
      }

      lineLength += contentEnd - position;

      if (!isTooLong) {
        if (lineLength > EXTERNAL_CALENDAR_MAX_LINE_LENGTH) {
          isTooLong = true;
          pieces.length = 0;
        } else {
          pieces.push(raw.slice(position, contentEnd));
        }
      }

      position = lineEnd + 1;

      if (
        lineEnd < length &&
        position < length &&
        (raw.charCodeAt(position) === SPACE || raw.charCodeAt(position) === TAB)
      ) {
        // The folding space or tab is not part of the line.
        position++;
        continue;
      }

      break;
    }

    if (isTooLong) {
      if (isFirstLine) {
        return null;
      }

      droppedLineCount++;
      continue;
    }

    const line: string = pieces.join("");

    if (!line.trim()) {
      continue;
    }

    const name: string = getPropertyName(line);

    if (isFirstLine) {
      isFirstLine = false;

      if (
        name !== "BEGIN" ||
        getSimpleValue(line).toUpperCase() !== "VCALENDAR"
      ) {
        return null;
      }
    }

    if (!KEPT_PROPERTY_SET.has(name)) {
      droppedLineCount++;
      continue;
    }

    if (DATE_LIST_PROPERTIES.has(name)) {
      dateListValues += countListValues(line);

      if (dateListValues > EXTERNAL_CALENDAR_MAX_DATE_LIST_VALUES) {
        droppedLineCount++;
        continue;
      }
    }

    kept.push(line);
  }

  if (isFirstLine) {
    // Nothing but blank lines.
    return null;
  }

  return {
    text: kept.join("\r\n"),
    keptLineCount: kept.length,
    droppedLineCount: droppedLineCount,
  };
}

// Whether a character code is a control character (a line break or a tab among them).
function isControlCharacter(code: number): boolean {
  return code < SPACE || code === 0x7f;
}

/*
 * An event's title as the calendar draws it: on one line, its control
 * characters (an escaped line break in the text) as spaces, runs of spaces
 * as one, and cut to `maxLength` characters.
 */
export function cleanExternalCalendarTitle(
  value: string,
  maxLength: number,
): string {
  let cleaned: string = "";
  let lastWasSpace: boolean = true;

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (isControlCharacter(code) || code === SPACE) {
      if (!lastWasSpace) {
        cleaned += " ";
        lastWasSpace = true;
      }

      continue;
    }

    cleaned += value[index];
    lastWasSpace = false;

    if (cleaned.length >= maxLength) {
      break;
    }
  }

  return cleaned.trim().slice(0, maxLength);
}
