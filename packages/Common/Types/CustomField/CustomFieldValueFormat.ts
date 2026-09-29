import { isCustomFieldValueEmpty } from "./CustomFieldValueMapping";

/*
 * How a stored custom field value reads as words, for everything that puts a
 * value in front of a person outside the Custom Fields card: an incident
 * note's {{customFields.<key>}} placeholder (Common/Utils/Incident/
 * IncidentNoteTemplateVariables) and the status page subscriber messages
 * (Common/Server/Utils/StatusPage/IncidentTemplateVariableBuilder).
 *
 * Only the reading is shared here. Where the words then go decides the rest:
 * a note escapes them as Markdown, an email as HTML, an SMS takes them as
 * they are. A date and time reads in the note author's time zone in a note,
 * and in the status page's subscriber time zones in its emails, so that is
 * left to the caller too.
 *
 * Pure, with no database or React imports, so the server and the dashboard
 * share it and it is tested directly.
 */

/*
 * A day with no time zone: "2026-09-27", or a wall-clock time on it with no
 * offset ("2026-09-27T00:00:00"). Its day is the one it names, wherever it is
 * read.
 */
const DAY_WITHOUT_TIME_ZONE_PATTERN: RegExp =
  /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

/*
 * What a Date value's instant is moved by before its UTC day is read; see
 * formatCustomFieldCalendarDate.
 */
const PICKED_DAY_SHIFT_MS: number = 13 * 60 * 60 * 1000;

export type CustomFieldValueToTextFunction = (value: unknown) => string;

/**
 * Plain text for a value of no particular type: a list joined with commas
 * (its empty entries left out), a Date as its ISO string, an object as JSON,
 * anything else as String() gives it. null and undefined are "".
 */
export const customFieldValueToText: CustomFieldValueToTextFunction = (
  value: unknown,
): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .filter((entry: unknown): boolean => {
        return !isCustomFieldValueEmpty(entry);
      })
      .map((entry: unknown): string => {
        return customFieldValueToText(entry);
      })
      .join(", ");
  }

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? "" : value.toISOString();
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
};

export type CustomFieldValueToDateFunction = (value: unknown) => Date | null;

/**
 * The instant a Date or DateTime value holds, or null when it holds none
 * (an empty string, text that is not a date).
 */
export const customFieldValueToDate: CustomFieldValueToDateFunction = (
  value: unknown,
): Date | null => {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const date: Date = new Date(value.trim());
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
};

export type FormatCustomFieldBooleanFunction = (value: unknown) => string;

/**
 * Yes or No for a Boolean value, which is stored as true or false (or, from
 * an older form, as "true" or "false"). Anything else reads as it is.
 */
export const formatCustomFieldBoolean: FormatCustomFieldBooleanFunction = (
  value: unknown,
): string => {
  if (value === true || value === "true") {
    return "Yes";
  }

  if (value === false || value === "false") {
    return "No";
  }

  return customFieldValueToText(value);
};

export type FormatCustomFieldCalendarDateFunction = (value: unknown) => string;

/**
 * A Date value - a calendar day with no time of day - as the day that was
 * picked, "2026-09-27". A value that is no date reads as it is.
 *
 * The dashboard does not store the day itself. Its date input stores the
 * picked day's midnight in the author's time zone, as a UTC instant: 27 Sep
 * picked in Berlin (UTC+2) is "2026-09-26T22:00:00.000Z", in New York
 * (UTC-4) "2026-09-27T04:00:00.000Z". So neither the UTC day of the instant
 * (26 Sep for Berlin: every author east of UTC would get the day before) nor
 * the reader's day (a reader in another zone than the author's) is the day
 * that was picked, and who picked it, and where, is not stored.
 *
 * The instant is read as the nearest plausible local midnight instead: moved
 * 13 hours on, its UTC day is the picked day for an author anywhere from
 * UTC-10:59 to UTC+13:00 - Hawaii to New Zealand in summer - and for a value
 * an API client stored as UTC midnight. Only an author in UTC-11 or UTC-12,
 * or past UTC+13, gets the day after or the day before. It is the same day
 * whoever reads it, so a note and an email about one incident agree.
 *
 * A bare day ("2026-09-27"), or a time with no offset, is the day it names.
 */
export const formatCustomFieldCalendarDate: FormatCustomFieldCalendarDateFunction =
  (value: unknown): string => {
    const match: RegExpMatchArray | null =
      typeof value === "string"
        ? value.trim().match(DAY_WITHOUT_TIME_ZONE_PATTERN)
        : null;

    if (match) {
      return match[1]!;
    }

    const date: Date | null = customFieldValueToDate(value);

    const pickedDay: Date | null = date
      ? new Date(date.getTime() + PICKED_DAY_SHIFT_MS)
      : null;

    // Invalid only at the very end of the range a Date can hold.
    if (!pickedDay || isNaN(pickedDay.getTime())) {
      return customFieldValueToText(value);
    }

    return pickedDay.toISOString().slice(0, 10);
  };
