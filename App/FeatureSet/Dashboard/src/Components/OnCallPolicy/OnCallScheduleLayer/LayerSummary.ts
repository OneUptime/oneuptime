import OneUptimeDate from "Common/Types/Date";
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
): string {
  if (!restrictionTimes) {
    return "On call 24/7";
  }

  const restrictionType: RestrictionType =
    restrictionTimes.restictionType || RestrictionType.None;

  if (restrictionType === RestrictionType.None) {
    return "On call 24/7";
  }

  if (restrictionType === RestrictionType.Daily) {
    const day: { startTime: Date; endTime: Date } | null =
      restrictionTimes.dayRestrictionTimes;
    if (day && day.startTime && day.endTime) {
      return `Daily ${OneUptimeDate.getLocalHourAndMinuteFromDate(
        day.startTime,
      )} – ${OneUptimeDate.getLocalHourAndMinuteFromDate(day.endTime)}`;
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
    return `${w.startDay} ${OneUptimeDate.getLocalHourAndMinuteFromDate(
      w.startTime,
    )} – ${w.endDay} ${OneUptimeDate.getLocalHourAndMinuteFromDate(w.endTime)}`;
  }

  return `${weekly.length} weekly time windows`;
}

export function summarizeStartsAt(startsAt: Date | undefined): string {
  if (!startsAt) {
    return "Start time not set";
  }

  return `Starts ${OneUptimeDate.getDateAsLocalFormattedString(startsAt, false)}`;
}
