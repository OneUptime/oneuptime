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
 * The calendar day at the start of an ISO-8601 value - "2026-09-27" of
 * "2026-09-27T00:00:00.000Z".
 */
const ISO_DATE_PREFIX: RegExp = /^(\d{4}-\d{2}-\d{2})/;

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
 * picked, "2026-09-27". It is read from the stored ISO string rather than
 * converted to a time zone, which would show a reader west of UTC the day
 * before. A value that is no date reads as it is.
 */
export const formatCustomFieldCalendarDate: FormatCustomFieldCalendarDateFunction =
  (value: unknown): string => {
    const match: RegExpMatchArray | null =
      typeof value === "string" ? value.trim().match(ISO_DATE_PREFIX) : null;

    if (match) {
      return match[1]!;
    }

    const date: Date | null = customFieldValueToDate(value);

    return date
      ? date.toISOString().slice(0, 10)
      : customFieldValueToText(value);
  };
