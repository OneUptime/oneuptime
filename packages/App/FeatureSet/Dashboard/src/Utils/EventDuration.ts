import OneUptimeDate from "Common/Types/Date";

export interface EventTimelineDate {
  eventId: string;
  stateId?: string | undefined;
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
 * For each event, when it was resolved this time (getEventEndDateForCurrentState):
 * an event whose latest state is not resolved has none.
 */
export function getResolvedAtByEventId(
  timelines: Array<EventTimelineDate>,
  resolvedStateIds: Array<string>,
): Record<string, Date> {
  const timelinesByEventId: Map<string, Array<EventStateTimelineDate>> =
    new Map();

  for (const timeline of timelines) {
    if (!timeline.eventId) {
      continue;
    }

    const eventTimelines: Array<EventStateTimelineDate> =
      timelinesByEventId.get(timeline.eventId) || [];

    eventTimelines.push({
      stateId: timeline.stateId,
      startsAt: timeline.startsAt,
    });

    timelinesByEventId.set(timeline.eventId, eventTimelines);
  }

  const resolvedAtByEventId: Record<string, Date> = {};

  for (const [eventId, eventTimelines] of timelinesByEventId) {
    const resolvedAt: Date | undefined = getEventEndDateForCurrentState(
      eventTimelines,
      resolvedStateIds,
    );

    if (resolvedAt) {
      resolvedAtByEventId[eventId] = resolvedAt;
    }
  }

  return resolvedAtByEventId;
}

/**
 * Return an event's completion date only when its latest state is resolved:
 * the moment it became resolved this time. `resolvedStateIds` are the
 * project's states that count as resolved - its resolved state and any
 * state placed after it (Common/Utils/ResolvedState) - so moving on from
 * "Resolved" to "Closed" does not move the end. An event that was resolved
 * and subsequently reopened must keep counting.
 */
export function getEventEndDateForCurrentState(
  timelines: Array<EventStateTimelineDate>,
  resolvedStateIds: Array<string>,
): Date | undefined {
  if (resolvedStateIds.length === 0) {
    return undefined;
  }

  const resolved: Set<string> = new Set(resolvedStateIds);

  // Dated entries oldest first; a later entry in the list wins a tie.
  const dated: Array<EventStateTimelineDate> = timelines
    .map((timeline: EventStateTimelineDate, index: number) => {
      return { timeline, index };
    })
    .filter((entry: { timeline: EventStateTimelineDate }) => {
      return Boolean(entry.timeline.startsAt);
    })
    .sort(
      (
        a: { timeline: EventStateTimelineDate; index: number },
        b: { timeline: EventStateTimelineDate; index: number },
      ) => {
        return (
          a.timeline.startsAt!.getTime() - b.timeline.startsAt!.getTime() ||
          a.index - b.index
        );
      },
    )
    .map((entry: { timeline: EventStateTimelineDate }) => {
      return entry.timeline;
    });

  let endDate: Date | undefined = undefined;

  // Back from the latest entry, through the resolved states it is in now.
  for (let index: number = dated.length - 1; index >= 0; index--) {
    const timeline: EventStateTimelineDate = dated[index]!;

    if (!timeline.stateId || !resolved.has(timeline.stateId)) {
      break;
    }

    endDate = timeline.startsAt;
  }

  return endDate;
}
