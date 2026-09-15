import OneUptimeDate from "Common/Types/Date";

export interface EventTimelineDate {
  eventId: string;
  startsAt?: Date | undefined;
}

export interface EventStateTimelineDate {
  stateId?: string | undefined;
  startsAt?: Date | undefined;
}

const MINUTES_PER_HOUR: number = 60;
const MINUTES_PER_DAY: number = 24 * MINUTES_PER_HOUR;

function formatDurationUnit(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * Format an event duration consistently anywhere it is shown in Dashboard.
 * The caller supplies `endDate` for completed events and the current time for
 * live events, which keeps this helper deterministic and straightforward to
 * test.
 *
 * Reads the way a person would say it: "1 hour", "1 hour, 5 minutes",
 * "2 days, 3 hours". Units are singular for one, and a unit that is zero is
 * left out rather than spelled "0 minutes". Partial minutes never round up.
 * Formatted here rather than with OneUptimeDate's
 * convertMinutesToDaysHoursAndMinutes, whose wording other features pin.
 */
export function getEventDurationText(startDate: Date, endDate: Date): string {
  const minutes: number = OneUptimeDate.getDifferenceInMinutes(
    endDate,
    startDate,
  );

  if (minutes < 1) {
    return "less than a minute";
  }

  const days: number = Math.floor(minutes / MINUTES_PER_DAY);
  const hours: number = Math.floor(
    (minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR,
  );
  const remainingMinutes: number = minutes % MINUTES_PER_HOUR;
  const parts: Array<string> = [];

  if (days > 0) {
    parts.push(formatDurationUnit(days, "day"));
  }

  if (hours > 0) {
    parts.push(formatDurationUnit(hours, "hour"));
  }

  if (remainingMinutes > 0) {
    parts.push(formatDurationUnit(remainingMinutes, "minute"));
  }

  return parts.join(", ");
}

/**
 * Build the completion-date lookup used by event tables. Timelines can arrive
 * in any order, so always retain the latest dated entry for each event.
 */
export function getLatestTimelineDateByEventId(
  timelines: Array<EventTimelineDate>,
): Record<string, Date> {
  const latestDateByEventId: Record<string, Date> = {};

  for (const timeline of timelines) {
    if (!timeline.eventId || !timeline.startsAt) {
      continue;
    }

    const currentLatestDate: Date | undefined =
      latestDateByEventId[timeline.eventId];

    if (
      !currentLatestDate ||
      timeline.startsAt.getTime() > currentLatestDate.getTime()
    ) {
      latestDateByEventId[timeline.eventId] = timeline.startsAt;
    }
  }

  return latestDateByEventId;
}

/**
 * Return an event's completion date only when its latest state is resolved.
 * An event that was resolved and subsequently reopened must keep counting.
 */
export function getEventEndDateForCurrentState(
  timelines: Array<EventStateTimelineDate>,
  resolvedStateId: string | undefined,
): Date | undefined {
  if (!resolvedStateId) {
    return undefined;
  }

  let latestTimeline: EventStateTimelineDate | undefined = undefined;

  for (const timeline of timelines) {
    if (!timeline.startsAt) {
      continue;
    }

    if (
      !latestTimeline?.startsAt ||
      timeline.startsAt.getTime() >= latestTimeline.startsAt.getTime()
    ) {
      latestTimeline = timeline;
    }
  }

  if (latestTimeline?.stateId !== resolvedStateId) {
    return undefined;
  }

  return latestTimeline.startsAt;
}
