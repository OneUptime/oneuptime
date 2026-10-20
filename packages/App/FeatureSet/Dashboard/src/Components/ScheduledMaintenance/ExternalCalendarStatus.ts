import ScheduledMaintenanceExternalCalendar from "Common/Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import {
  EXTERNAL_CALENDAR_MAX_EVENTS,
  EXTERNAL_CALENDAR_REFRESH_INTERVALS_IN_MINUTES,
  ExternalCalendarLinkProblem,
  ExternalCalendarReadError,
  isExternalCalendarReadError,
} from "Common/Types/ScheduledMaintenance/ExternalCalendar";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A calendar from outside the project as Calendar Settings shows it (issue
 * #5084), worked out without React: how it is doing - off, waiting for its
 * first read, working, or not working and why - what its last read kept,
 * and the words for each choice and refusal. Every sentence here is an
 * English translation key; the page translates it.
 */

export interface ExternalCalendarHealth {
  key: "off" | "waiting" | "working" | "failing";
  label: string;
  color: Color;
  // A translation key, with {{status}} for an HTTP status where it has one.
  tooltip: string;
  tooltipValues: Record<string, string>;
}

// Why a read failed, in a sentence that says what to do about it.
export const EXTERNAL_CALENDAR_READ_ERROR_TEXT: Record<
  ExternalCalendarReadError,
  string
> = {
  [ExternalCalendarReadError.NotFound]: translationKey(
    "There is no calendar at this link. Check it, or copy a new one from the calendar.",
  ),
  [ExternalCalendarReadError.AccessDenied]: translationKey(
    "The calendar refused to be read: the link needs a sign-in, or is no longer shared.",
  ),
  [ExternalCalendarReadError.ServerError]: translationKey(
    "The calendar's server answered with an error (HTTP {{status}}).",
  ),
  [ExternalCalendarReadError.Unreachable]: translationKey(
    "The calendar's server could not be reached.",
  ),
  [ExternalCalendarReadError.NotAllowed]: translationKey(
    "OneUptime may not read this address, such as one on a private network.",
  ),
  [ExternalCalendarReadError.Timeout]: translationKey(
    "The calendar did not answer in time.",
  ),
  [ExternalCalendarReadError.TooLarge]: translationKey(
    "The calendar is larger than 5 MB.",
  ),
  [ExternalCalendarReadError.TooManyRedirects]: translationKey(
    "The link redirects too many times.",
  ),
  [ExternalCalendarReadError.NotACalendar]: translationKey(
    "The link did not answer with a calendar. Copy the calendar's iCal (.ics) link, not its web page.",
  ),
  [ExternalCalendarReadError.TooComplex]: translationKey(
    "The calendar took too long to work out: it may repeat events too often.",
  ),
};

// Why a link was refused before it was saved, as the form says it.
export const EXTERNAL_CALENDAR_LINK_PROBLEM_TEXT: Record<
  ExternalCalendarLinkProblem,
  string
> = {
  [ExternalCalendarLinkProblem.Empty]: translationKey(
    "Enter the calendar's link.",
  ),
  [ExternalCalendarLinkProblem.TooLong]: translationKey(
    "This link is too long to be a calendar's.",
  ),
  [ExternalCalendarLinkProblem.NotALink]: translationKey(
    "This is not a link. Copy the calendar's iCal (.ics) link, starting with https:// or webcal://.",
  ),
  [ExternalCalendarLinkProblem.NotHttp]: translationKey(
    "The link must start with https://, http:// or webcal://.",
  ),
};

// The refresh interval choices, in the words the form offers them.
export const EXTERNAL_CALENDAR_REFRESH_INTERVAL_LABELS: Record<number, string> =
  {
    15: translationKey("Every 15 minutes"),
    30: translationKey("Every 30 minutes"),
    60: translationKey("Every hour"),
    360: translationKey("Every 6 hours"),
    1440: translationKey("Every day"),
  };

export function getRefreshIntervalOptions(): Array<{
  label: string;
  value: number;
}> {
  return EXTERNAL_CALENDAR_REFRESH_INTERVALS_IN_MINUTES.map(
    (minutes: number): { label: string; value: number } => {
      return {
        label:
          EXTERNAL_CALENDAR_REFRESH_INTERVAL_LABELS[minutes] || `${minutes}`,
        value: minutes,
      };
    },
  );
}

function toTime(value: Date | string | undefined | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const time: number = OneUptimeDate.fromString(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

export function getExternalCalendarHealth(
  calendar: ScheduledMaintenanceExternalCalendar,
): ExternalCalendarHealth {
  if (calendar.isEnabled === false) {
    return {
      key: "off",
      label: translationKey("Off"),
      color: Gray500,
      tooltip: translationKey(
        "Turned off: it is not read, and its events are not shown.",
      ),
      tooltipValues: {},
    };
  }

  const error: unknown = calendar.lastReadError;

  if (isExternalCalendarReadError(error)) {
    return {
      key: "failing",
      label: translationKey("Not working"),
      color: Red,
      tooltip: EXTERNAL_CALENDAR_READ_ERROR_TEXT[error],
      tooltipValues: {
        status:
          calendar.lastReadHttpStatus !== undefined &&
          calendar.lastReadHttpStatus !== null
            ? String(calendar.lastReadHttpStatus)
            : "",
      },
    };
  }

  if (toTime(calendar.lastReadAt) !== undefined) {
    return {
      key: "working",
      label: translationKey("Working"),
      color: Green,
      tooltip: translationKey("Its last read finished without a problem."),
      tooltipValues: {},
    };
  }

  return {
    key: "waiting",
    label: translationKey("Waiting for the first read"),
    color: Yellow,
    tooltip: translationKey(
      "OneUptime reads it within a minute of it being added.",
    ),
    tooltipValues: {},
  };
}

/*
 * What the last read kept: how many events, and whether the calendar holds
 * more than are kept (the EXTERNAL_CALENDAR_MAX_EVENTS nearest today are).
 * Null before the first read.
 */
export function getExternalCalendarKeptSummary(
  calendar: ScheduledMaintenanceExternalCalendar,
): { count: number; hasMore: boolean; limit: number } | null {
  if (toTime(calendar.lastReadAt) === undefined) {
    return null;
  }

  return {
    count: calendar.eventCount || 0,
    hasMore: calendar.hasMoreEvents === true,
    limit: EXTERNAL_CALENDAR_MAX_EVENTS,
  };
}
