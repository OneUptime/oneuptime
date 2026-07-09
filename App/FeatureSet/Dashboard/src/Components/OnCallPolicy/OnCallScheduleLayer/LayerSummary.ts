import OneUptimeDate from "Common/Types/Date";
import DayOfWeek from "Common/Types/Day/DayOfWeek";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "Common/Types/OnCallDutyPolicy/RestrictionTimes";

/*
 * Small, pure helpers that turn the layer's rotation / restriction / start-time
 * configuration into short, human-readable summaries. These are shown in the
 * collapsed layer header so a user can understand a layer at a glance without
 * expanding it.
 */

type IntervalNoun = {
  singular: string;
  plural: string;
  adjective: string; // e.g. "daily", "weekly"
};

const intervalNouns: Record<EventInterval, IntervalNoun> = {
  [EventInterval.Hour]: {
    singular: "hour",
    plural: "hours",
    adjective: "hourly",
  },
  [EventInterval.Day]: { singular: "day", plural: "days", adjective: "daily" },
  [EventInterval.Week]: {
    singular: "week",
    plural: "weeks",
    adjective: "weekly",
  },
  [EventInterval.Month]: {
    singular: "month",
    plural: "months",
    adjective: "monthly",
  },
  [EventInterval.Year]: {
    singular: "year",
    plural: "years",
    adjective: "yearly",
  },
};

export function summarizeRotation(rotation: Recurring | undefined): string {
  if (!rotation) {
    return "No rotation";
  }

  const intervalType: EventInterval =
    rotation.intervalType || EventInterval.Day;
  const count: number = rotation.intervalCount?.toNumber
    ? rotation.intervalCount.toNumber()
    : 1;

  const noun: IntervalNoun =
    intervalNouns[intervalType] || intervalNouns[EventInterval.Day];

  if (count <= 1) {
    return `Rotates ${noun.adjective}`;
  }

  return `Rotates every ${count} ${noun.plural}`;
}

export function summarizeHandOff(handOffTime: Date | undefined): string | null {
  if (!handOffTime) {
    return null;
  }

  return `Hands off at ${OneUptimeDate.getLocalHourAndMinuteFromDate(
    handOffTime,
  )}`;
}

export function summarizeRestriction(
  restrictionTimes: RestrictionTimes | undefined,
  /*
   * The schedule's timezone. Restriction wall-clock hours are ENFORCED by the
   * engine in this zone, so the summary must render them in it too — otherwise
   * the chip shows the viewer's browser-zone hours and contradicts both the
   * schedule-timezone preview on the same screen and who actually gets paged
   * (audit F10). Omitted => viewer local time (legacy behavior).
   */
  timezone?: string | undefined,
): string {
  if (!restrictionTimes) {
    return "On call 24/7";
  }

  const restrictionType: RestrictionType =
    restrictionTimes.restictionType || RestrictionType.None;

  if (restrictionType === RestrictionType.None) {
    return "On call 24/7";
  }

  // A short "(<tz>)" suffix so it is unambiguous which zone the hours are in.
  const tzSuffix: string = timezone ? ` (${timezone})` : "";

  if (restrictionType === RestrictionType.Daily) {
    const day: { startTime: Date; endTime: Date } | null =
      restrictionTimes.dayRestrictionTimes;
    if (day && day.startTime && day.endTime) {
      return `Daily ${OneUptimeDate.getHourAndMinuteInTimezoneString(
        day.startTime,
        timezone,
      )} – ${OneUptimeDate.getHourAndMinuteInTimezoneString(
        day.endTime,
        timezone,
      )}${tzSuffix}`;
    }
    return "Restricted to specific hours daily";
  }

  // Weekly
  const weekly: Array<WeeklyResctriction> =
    restrictionTimes.weeklyRestrictionTimes || [];

  if (weekly.length === 0) {
    return "Restricted to specific times each week";
  }

  if (weekly.length === 1) {
    const w: WeeklyResctriction = weekly[0]!;
    /*
     * Derive the day-of-week from the stored timestamps (in the schedule
     * timezone), NOT from the startDay/endDay enum. The engine resolves coverage
     * from the timestamp's weekday and ignores the enum, so a raw-API payload
     * whose enum disagrees with its timestamp would otherwise show a day here
     * that contradicts who is actually paged. Using the timestamp keeps the
     * summary consistent with the engine and the preview.
     */
    const startDay: DayOfWeek = OneUptimeDate.getDayOfWeek(
      w.startTime,
      timezone,
    );
    const endDay: DayOfWeek = OneUptimeDate.getDayOfWeek(w.endTime, timezone);
    return `${startDay} ${OneUptimeDate.getHourAndMinuteInTimezoneString(
      w.startTime,
      timezone,
    )} – ${endDay} ${OneUptimeDate.getHourAndMinuteInTimezoneString(
      w.endTime,
      timezone,
    )}${tzSuffix}`;
  }

  return `${weekly.length} weekly time windows`;
}

export function summarizeStartsAt(startsAt: Date | undefined): string {
  if (!startsAt) {
    return "Start time not set";
  }

  return `Starts ${OneUptimeDate.getDateAsLocalFormattedString(startsAt, false)}`;
}

/*
 * The following helpers format the concrete rotation SHIFTS the summaries list
 * ("Alice is on call from Mon 9:00 AM to Tue 9:00 AM"). They format the shift's
 * absolute instants in the schedule's timezone when one is set — the same zone
 * the engine pages people in — so the summary can never disagree with who is
 * actually on call. When no timezone is set they fall back to the viewer's
 * local zone.
 */

// e.g. "Mon, Jul 7, 2025, 9:00 AM EDT"
export function formatShiftInstant(
  date: Date,
  timezone?: string | undefined,
): string {
  return OneUptimeDate.getDateAsFormattedStringInTimezone({
    date,
    timezone,
    showWeekday: true,
  });
}

// Compact human duration from a raw seconds count, e.g. "24h", "8h 30m",
// "5d 12h", "45m".
export function formatDurationFromSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return "0m";
  }

  const days: number = Math.floor(totalSeconds / 86400);
  const hours: number = Math.floor((totalSeconds % 86400) / 3600);
  const minutes: number = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes || 1}m`;
}

// Compact human duration of a shift's wall-clock span (start -> end).
export function formatShiftDuration(start: Date, end: Date): string {
  return formatDurationFromSeconds(
    OneUptimeDate.getDifferenceInSeconds(end, start),
  );
}

/*
 * A short "when does this start relative to now" label for an upcoming shift:
 * "Now" for a shift already in progress, otherwise "in 45 min" / "in 3 hours" /
 * "in 2 days" / "in 3 weeks".
 */
export function formatRelativeStart(start: Date, now: Date): string {
  if (OneUptimeDate.isOnOrBefore(start, now)) {
    return "Now";
  }

  const seconds: number = OneUptimeDate.getDifferenceInSeconds(start, now);
  const minutes: number = Math.round(seconds / 60);

  if (minutes < 60) {
    return `in ${Math.max(1, minutes)} min`;
  }

  const hours: number = Math.round(minutes / 60);
  if (hours < 24) {
    return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  const days: number = Math.round(hours / 24);
  if (days < 7) {
    return `in ${days} ${days === 1 ? "day" : "days"}`;
  }

  const weeks: number = Math.round(days / 7);
  if (weeks < 5) {
    return `in ${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  }

  const months: number = Math.round(days / 30);
  return `in ${months} ${months === 1 ? "month" : "months"}`;
}
