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

/*
 * What regeneration actually does, stated the way the server behaves: a fetch
 * on the rotated-out token inside its 30-day grace is answered with an EMPTY
 * calendar (spec 2.1), not with the old shifts. Saying the old link "keeps
 * working" would tell a reader who rotated because a colleague left that the
 * leaver still sees the roster for a month - the opposite of the truth - and
 * would contradict the sentence before it.
 */
export const REGENERATE_WARNING_COPY: string =
  "Every app subscribed to the current link stops updating and shows an empty calendar. For 30 days the old link keeps answering with that empty calendar instead of an error, then it stops working - paste the new link into every app you subscribed with.";

/** Placeholder is the date the grace ends. */
export const PERSONAL_PREVIOUS_LINK_COPY: string =
  "Your previous link returns an empty calendar until {{date}}, then stops working.";

export const SHARED_PREVIOUS_LINK_COPY: string =
  "The previous link returns an empty calendar until {{date}}, then stops working.";

export const DISABLED_FEED_COPY: string =
  "This link is disabled. Anyone subscribed sees an empty calendar until it is enabled again.";

export const COVERAGE_GAPS_DESCRIPTION: string =
  "Adds an event for every stretch where the schedule intends coverage but nobody is on call. Off-hours outside every layer's active time are never counted as a gap.";

/*
 * i18n interpolation.
 *
 * `translateString` looks the whole English sentence up as a flat key, which
 * is what lets a translator reorder the words - but it takes no values, and
 * i18next leaves `{{name}}` untouched when none are passed (skipOnVariables).
 * So the placeholders are filled here, after the lookup, from whichever
 * sentence came back. Building a sentence by concatenating translated
 * fragments (`t("Last fetched") + when + t("by") + client`) instead would fix
 * English word order into every language.
 *
 * A placeholder with no value is left as-is rather than blanked, so a broken
 * translation shows `{{when}}` (visible, reportable) instead of a sentence
 * with a hole in it.
 */
const PLACEHOLDER_PATTERN: RegExp = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export type InterpolationValues = Record<string, string | number>;

type InterpolateFunction = (
  template: string,
  values: InterpolationValues,
) => string;

export const interpolate: InterpolateFunction = (
  template: string,
  values: InterpolationValues,
): string => {
  return template.replace(
    PLACEHOLDER_PATTERN,
    (match: string, name: string): string => {
      const value: string | number | undefined = values[name];

      if (value === undefined) {
        return match;
      }

      return String(value);
    },
  );
};

export type TranslateFunction = (
  value: string | undefined,
) => string | undefined;

type TranslateAndInterpolateFunction = (
  translate: TranslateFunction | undefined,
  template: string,
  values: InterpolationValues,
) => string;

/** Look the sentence up, then fill its placeholders. */
export const translateInterpolated: TranslateAndInterpolateFunction = (
  translate: TranslateFunction | undefined,
  template: string,
  values: InterpolationValues,
): string => {
  const translated: string =
    (translate ? translate(template) : undefined) || template;

  return interpolate(translated, values);
};

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

/*
 * Unit sentences for a lead time that is not one of the presets. Whole
 * sentences with a {{count}} placeholder rather than a number glued to a
 * translated unit word, so a language that puts the unit first (or inflects
 * it) can say so - and so the locale validator can check the placeholder.
 *
 * Only the plural forms exist because a count of one is unreachable here:
 * 1 week, 1 day and 1 hour are all presets, and one minute is below the
 * 15-minute floor the service enforces.
 */
export const LEAD_TIME_WEEKS_COPY: string = "{{count}} weeks";
export const LEAD_TIME_DAYS_COPY: string = "{{count}} days";
export const LEAD_TIME_HOURS_COPY: string = "{{count}} hours";
export const LEAD_TIME_MINUTES_COPY: string = "{{count}} minutes";

type FormatLeadTimeFunction = (
  minutes: number,
  translate?: TranslateFunction | undefined,
) => string;

/*
 * Human form of a lead time: exact multiples collapse to the larger unit,
 * anything else stays in minutes so that "90 minutes" is not rendered as
 * "1 hour".
 *
 * `translate` is optional so the function stays pure and testable in English;
 * the chip passes the page's translator so a custom reminder is not the one
 * label on the card left in English.
 */
export const formatLeadTime: FormatLeadTimeFunction = (
  minutes: number,
  translate?: TranslateFunction | undefined,
): string => {
  const preset: ReminderPreset | undefined = REMINDER_PRESETS.find(
    (candidate: ReminderPreset): boolean => {
      return candidate.minutes === minutes;
    },
  );

  if (preset) {
    return (translate ? translate(preset.label) : undefined) || preset.label;
  }

  if (minutes % (7 * 24 * 60) === 0) {
    return translateInterpolated(translate, LEAD_TIME_WEEKS_COPY, {
      count: minutes / (7 * 24 * 60),
    });
  }

  if (minutes % (24 * 60) === 0) {
    return translateInterpolated(translate, LEAD_TIME_DAYS_COPY, {
      count: minutes / (24 * 60),
    });
  }

  if (minutes % 60 === 0) {
    return translateInterpolated(translate, LEAD_TIME_HOURS_COPY, {
      count: minutes / 60,
    });
  }

  return translateInterpolated(translate, LEAD_TIME_MINUTES_COPY, {
    count: minutes,
  });
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
