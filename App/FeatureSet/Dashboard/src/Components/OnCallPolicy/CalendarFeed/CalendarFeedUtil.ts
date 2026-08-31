import { FeedStatus, FeedUrls } from "./CalendarFeedTypes";
import OneUptimeDate from "Common/Types/Date";
import { MaterializedShiftJson } from "Common/Types/OnCallDutyPolicy/MaterializedShift";
import {
  MAX_MINUTES_BEFORE_SHIFT,
  MIN_MINUTES_BEFORE_SHIFT,
} from "Common/Models/DatabaseModels/UserOnCallShiftReminder";

/*
 * Pure helpers for the calendar-feed surfaces. Nothing here touches React, the
 * network or the clock (callers pass `now` in), which is what lets the
 * interesting decisions - which URL a button opens, what the status line says,
 * whether the "nothing has fetched this yet" hint applies - be tested without
 * mounting a page.
 */

/** Custom-route prefix, mounted like OnCallReadinessAPI (spec §2). */
export const ON_CALL_CALENDAR_API_PATH: string = "/on-call-calendar";

export const PERSONAL_FEED_CURRENT_PATH: string = `${ON_CALL_CALENDAR_API_PATH}/feed/current`;
export const PERSONAL_FEED_ROTATE_PATH: string = `${ON_CALL_CALENDAR_API_PATH}/feed/rotate`;
export const PROJECT_FEED_CURRENT_PATH: string = `${ON_CALL_CALENDAR_API_PATH}/project-feed/current`;
export const PROJECT_FEED_PUBLISH_PATH: string = `${ON_CALL_CALENDAR_API_PATH}/project-feed/publish`;
export const PROJECT_FEED_ROTATE_PATH: string = `${ON_CALL_CALENDAR_API_PATH}/project-feed/rotate`;
export const MY_SHIFTS_PATH: string = `${ON_CALL_CALENDAR_API_PATH}/my-shifts`;

type SchedulePathFunction = (scheduleId: string) => string;

export const getScheduleFeedCurrentPath: SchedulePathFunction = (
  scheduleId: string,
): string => {
  return `${ON_CALL_CALENDAR_API_PATH}/schedule-feed/${scheduleId}/current`;
};

export const getScheduleFeedPublishPath: SchedulePathFunction = (
  scheduleId: string,
): string => {
  return `${ON_CALL_CALENDAR_API_PATH}/schedule-feed/${scheduleId}/publish`;
};

export const getScheduleFeedRotatePath: SchedulePathFunction = (
  scheduleId: string,
): string => {
  return `${ON_CALL_CALENDAR_API_PATH}/schedule-feed/${scheduleId}/rotate`;
};

/** Google Calendar's "add by URL" entry point (recommendation §3.5). */
export const GOOGLE_CALENDAR_ADD_URL_PREFIX: string =
  "https://calendar.google.com/calendar/r?cid=";

/** Docs page describing per-client subscribe steps and troubleshooting. */
export const CALENDAR_FEED_DOCS_PATH: string = "/on-call/calendar-feeds";

/** How many days of upcoming shifts the personal page shows. */
export const UPCOMING_SHIFTS_DAYS: number = 30;

/*
 * Static rather than composed from UPCOMING_SHIFTS_DAYS so that the whole
 * sentence is one translation key; a test pins the number to the constant.
 */
export const UPCOMING_SHIFTS_CARD_TITLE: string =
  "Upcoming shifts (next 30 days)";

/**
 * A link nobody has fetched for this long after it was minted is probably
 * unreachable from where the calendar client runs.
 */
export const NOTHING_FETCHED_HINT_AFTER_HOURS: number = 48;

/*
 * Copy that the UI and the docs must state identically, taken verbatim from
 * the design. Kept as constants so the shared component, the schedule card
 * and the tests all read the same sentence.
 */
export const REFRESH_CADENCE_COPY: string =
  "Calendar apps refresh subscribed calendars on their own schedule: Google Calendar every 8-24 hours, Outlook on the web every 3-6 hours, Apple Calendar as often as every 5 minutes (hourly by default), Thunderbird every 1-60 minutes. Same-day changes may not reach every calendar before the shift starts - shift reminders and pager notifications still come from OneUptime.";

export const REACHABILITY_COPY: string =
  "Google Calendar and Outlook on the web fetch this link from their servers; it must be reachable from the internet. Apple Calendar, Thunderbird and Outlook desktop fetch from your computer.";

export const STANDING_ASSIGNMENTS_COPY: string =
  "Direct and team assignments on escalation policies are standing and are not shown.";

export const SHARED_LINK_OWNERSHIP_COPY: string =
  "The shared link belongs to the project, not to whoever copied it - treat it like a password and regenerate it when someone leaves.";

export const PLANNING_NOT_AUDIT_COPY: string =
  "This calendar is for planning. For hours on call and fairness, use the On-Call Time Log report.";

export const REGENERATE_WARNING_COPY: string =
  "Every app subscribed to the current link stops updating and shows an empty calendar. The old link keeps working for 30 days so you have time to update your subscriptions.";

export const DISABLED_FEED_COPY: string =
  "This link is disabled. Anyone subscribed sees an empty calendar until it is enabled again.";

export const COVERAGE_GAPS_DESCRIPTION: string =
  "Adds an event for every stretch where the schedule intends coverage but nobody is on call. Off-hours outside every layer's active time are never counted as a gap.";

type BuildGoogleAddUrlFunction = (httpsUrl: string) => string;

export const buildGoogleAddUrl: BuildGoogleAddUrlFunction = (
  httpsUrl: string,
): string => {
  return `${GOOGLE_CALENDAR_ADD_URL_PREFIX}${encodeURIComponent(httpsUrl)}`;
};

type AddScheduleFilterFunction = (url: string, scheduleId: string) => string;

/*
 * Appends `?schedule=<id>` to a feed URL, respecting a query string that is
 * already there. Only the personal feed understands the filter (spec §2.1);
 * the shared feeds are per schedule or per project by construction.
 */
export const addScheduleFilter: AddScheduleFilterFunction = (
  url: string,
  scheduleId: string,
): string => {
  const separator: string = url.includes("?") ? "&" : "?";
  return `${url}${separator}schedule=${encodeURIComponent(scheduleId)}`;
};

type ApplyScheduleFilterFunction = (
  urls: FeedUrls,
  scheduleId: string | null | undefined,
) => FeedUrls;

export const applyScheduleFilter: ApplyScheduleFilterFunction = (
  urls: FeedUrls,
  scheduleId: string | null | undefined,
): FeedUrls => {
  if (!scheduleId) {
    return urls;
  }

  const https: string = addScheduleFilter(urls.https, scheduleId);

  return {
    https: https,
    webcal: addScheduleFilter(urls.webcal, scheduleId),
    googleAdd: buildGoogleAddUrl(https),
  };
};

type GetRotatedDaysAgoFunction = (
  rotatedAt: string | null | undefined,
  now: Date,
) => number | null;

export const getRotatedDaysAgo: GetRotatedDaysAgoFunction = (
  rotatedAt: string | null | undefined,
  now: Date,
): number | null => {
  if (!rotatedAt) {
    return null;
  }

  const rotated: Date = OneUptimeDate.fromString(rotatedAt);

  if (Number.isNaN(rotated.getTime())) {
    return null;
  }

  const days: number = Math.floor(
    (now.getTime() - rotated.getTime()) / (24 * 60 * 60 * 1000),
  );

  return days < 0 ? 0 : days;
};

type ShouldShowNothingFetchedHintFunction = (
  status: FeedStatus,
  now: Date,
) => boolean;

/*
 * "Nothing has fetched this link yet" is only worth saying once enough time
 * has passed for the slowest client (Google, up to 24 h) to have tried at
 * least twice. Before that it reads as an accusation about a link the reader
 * pasted five minutes ago.
 */
export const shouldShowNothingFetchedHint: ShouldShowNothingFetchedHintFunction =
  (status: FeedStatus, now: Date): boolean => {
    if (!status.exists || !status.isEnabled || status.fetchCount > 0) {
      return false;
    }

    if (status.lastFetchedAt) {
      return false;
    }

    if (!status.rotatedAt) {
      return false;
    }

    const rotated: Date = OneUptimeDate.fromString(status.rotatedAt);

    if (Number.isNaN(rotated.getTime())) {
      return false;
    }

    const hours: number =
      (now.getTime() - rotated.getTime()) / (60 * 60 * 1000);

    return hours >= NOTHING_FETCHED_HINT_AFTER_HOURS;
  };

export interface ReminderPreset {
  minutes: number;
  label: string;
}

/** The chips on "Remind me before shifts", in display order. */
export const REMINDER_PRESETS: Array<ReminderPreset> = [
  { minutes: 7 * 24 * 60, label: "1 week" },
  { minutes: 24 * 60, label: "1 day" },
  { minutes: 60, label: "1 hour" },
  { minutes: 15, label: "15 min" },
];

type FormatLeadTimeFunction = (minutes: number) => string;

/*
 * Human form of a lead time: exact multiples collapse to the larger unit,
 * anything else stays in minutes so that "90 minutes" is not rendered as
 * "1 hour".
 */
export const formatLeadTime: FormatLeadTimeFunction = (
  minutes: number,
): string => {
  const preset: ReminderPreset | undefined = REMINDER_PRESETS.find(
    (candidate: ReminderPreset): boolean => {
      return candidate.minutes === minutes;
    },
  );

  if (preset) {
    return preset.label;
  }

  if (minutes % (7 * 24 * 60) === 0) {
    return `${minutes / (7 * 24 * 60)} weeks`;
  }

  if (minutes % (24 * 60) === 0) {
    return `${minutes / (24 * 60)} days`;
  }

  if (minutes % 60 === 0) {
    return `${minutes / 60} hours`;
  }

  return `${minutes} minutes`;
};

export interface LeadTimeValidation {
  minutes: number | null;
  error: string | null;
}

type ValidateCustomLeadMinutesFunction = (value: string) => LeadTimeValidation;

/*
 * The same bounds the service enforces (15 minutes ... 2 weeks), checked in the
 * browser so the modal can say what is wrong instead of relaying a 400.
 */
export const validateCustomLeadMinutes: ValidateCustomLeadMinutesFunction = (
  value: string,
): LeadTimeValidation => {
  const trimmed: string = value.trim();

  if (trimmed === "") {
    return { minutes: null, error: "Enter how many minutes before the shift." };
  }

  const minutes: number = Number(trimmed);

  if (!Number.isInteger(minutes)) {
    return { minutes: null, error: "Enter a whole number of minutes." };
  }

  if (
    minutes < MIN_MINUTES_BEFORE_SHIFT ||
    minutes > MAX_MINUTES_BEFORE_SHIFT
  ) {
    return {
      minutes: null,
      error: `Reminders can be sent between ${MIN_MINUTES_BEFORE_SHIFT} minutes and ${MAX_MINUTES_BEFORE_SHIFT / (24 * 60)} days before a shift.`,
    };
  }

  return { minutes: minutes, error: null };
};

export interface ShiftDayGroup {
  /** Stable key for React and for tests: the local calendar date. */
  dayKey: string;
  /** The first shift's start, for rendering the heading. */
  day: Date;
  shifts: Array<MaterializedShiftJson>;
}

type GroupShiftsByDayFunction = (
  shifts: Array<MaterializedShiftJson>,
) => Array<ShiftDayGroup>;

type LocalDayKeyFunction = (date: Date) => string;

const localDayKey: LocalDayKeyFunction = (date: Date): string => {
  const month: string = String(date.getMonth() + 1).padStart(2, "0");
  const day: string = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

/*
 * Groups shifts by the LOCAL day they start on, in start order. A shift that
 * runs across midnight is listed once, under the day it begins - the row shows
 * its end time, so nothing is lost, and listing it twice would double-count it
 * in the eye of somebody scanning for how many nights they have.
 */
export const groupShiftsByDay: GroupShiftsByDayFunction = (
  shifts: Array<MaterializedShiftJson>,
): Array<ShiftDayGroup> => {
  const sorted: Array<MaterializedShiftJson> = [...shifts].sort(
    (a: MaterializedShiftJson, b: MaterializedShiftJson): number => {
      const byStart: number =
        OneUptimeDate.fromString(a.start).getTime() -
        OneUptimeDate.fromString(b.start).getTime();

      if (byStart !== 0) {
        return byStart;
      }

      return a.shiftKey.localeCompare(b.shiftKey);
    },
  );

  const groups: Array<ShiftDayGroup> = [];

  for (const shift of sorted) {
    const start: Date = OneUptimeDate.fromString(shift.start);
    const dayKey: string = localDayKey(start);
    const last: ShiftDayGroup | undefined = groups[groups.length - 1];

    if (last && last.dayKey === dayKey) {
      last.shifts.push(shift);
    } else {
      groups.push({ dayKey: dayKey, day: start, shifts: [shift] });
    }
  }

  return groups;
};

type IsCoveringShiftFunction = (shift: MaterializedShiftJson) => boolean;

/** A shift the reader holds because of an override that names them. */
export const isCoveringShift: IsCoveringShiftFunction = (
  shift: MaterializedShiftJson,
): boolean => {
  return Boolean(
    shift.override && shift.override.originalUserId !== shift.userId,
  );
};

export interface UpcomingShiftsWindow {
  from: Date;
  to: Date;
}

type GetUpcomingShiftsWindowFunction = (now: Date) => UpcomingShiftsWindow;

export const getUpcomingShiftsWindow: GetUpcomingShiftsWindowFunction = (
  now: Date,
): UpcomingShiftsWindow => {
  return {
    from: now,
    to: new Date(now.getTime() + UPCOMING_SHIFTS_DAYS * 24 * 60 * 60 * 1000),
  };
};
