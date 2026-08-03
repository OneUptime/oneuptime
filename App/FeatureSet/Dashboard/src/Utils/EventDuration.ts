import OneUptimeDate from "Common/Types/Date";

export interface EventTimelineDate {
  eventId: string;
  startsAt?: Date | undefined;
}

export interface EventStateTimelineDate {
  stateId?: string | undefined;
  startsAt?: Date | undefined;
}

/**
 * Format an event duration consistently anywhere it is shown in Dashboard.
 * The caller supplies `endDate` for completed events and the current time for
 * live events, which keeps this helper deterministic and straightforward to
 * test.
 */
export function getEventDurationText(startDate: Date, endDate: Date): string {
  const minutes: number = OneUptimeDate.getDifferenceInMinutes(
    endDate,
    startDate,
  );

  if (minutes < 1) {
    return "less than a minute";
  }

  return OneUptimeDate.convertMinutesToDaysHoursAndMinutes(minutes);
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
