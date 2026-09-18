import { EventStateTimelineDate, getEventDurationText } from "./EventDuration";

/*
 * Pure helpers shared by the incident and alert overview pages: the response
 * times in the stat bar and the small bits of text the header facts need.
 * Kept free of React and of API calls so they can be unit tested in the App
 * suite, which has no renderer.
 */

export interface EventResponseTimesInput {
  timelines: Array<EventStateTimelineDate>;
  // declaredAt for an incident, createdAt for an alert.
  startedAt?: Date | undefined;
  acknowledgedStateId?: string | undefined;
  resolvedStateId?: string | undefined;
}

export interface EventResponseTimes {
  // The explicit start, or the earliest timeline entry when there is none.
  startedAt?: Date | undefined;
  /*
   * When somebody first responded: the first acknowledgement, or the first
   * resolution if that came earlier (resolving an event answers it too).
   */
  acknowledgedAt?: Date | undefined;
  // The first resolution. A later reopen does not move it.
  resolvedAt?: Date | undefined;
  // True when acknowledgedAt comes from a resolution, not an acknowledgement.
  isAcknowledgedByResolution: boolean;
}

type GetDateFunction = (
  timelines: Array<EventStateTimelineDate>,
  stateId?: string | undefined,
) => Date | undefined;

/*
 * The earliest entry for a state. Timelines are usually sorted by startsAt,
 * but nothing here relies on it: a list that arrives unsorted (or with an
 * undated row) must still give the same answer.
 */
export const getFirstTimelineDateForState: GetDateFunction = (
  timelines: Array<EventStateTimelineDate>,
  stateId?: string | undefined,
): Date | undefined => {
  if (!stateId) {
    return undefined;
  }

  let firstDate: Date | undefined = undefined;

  for (const timeline of timelines) {
    if (timeline.stateId !== stateId || !timeline.startsAt) {
      continue;
    }

    if (!firstDate || timeline.startsAt.getTime() < firstDate.getTime()) {
      firstDate = timeline.startsAt;
    }
  }

  return firstDate;
};

export const getEarliestTimelineDate: GetDateFunction = (
  timelines: Array<EventStateTimelineDate>,
): Date | undefined => {
  let earliestDate: Date | undefined = undefined;

  for (const timeline of timelines) {
    if (!timeline.startsAt) {
      continue;
    }

    if (!earliestDate || timeline.startsAt.getTime() < earliestDate.getTime()) {
      earliestDate = timeline.startsAt;
    }
  }

  return earliestDate;
};

export const getEventResponseTimes: (
  input: EventResponseTimesInput,
) => EventResponseTimes = (
  input: EventResponseTimesInput,
): EventResponseTimes => {
  const startedAt: Date | undefined =
    input.startedAt || getEarliestTimelineDate(input.timelines);

  const firstAcknowledgedAt: Date | undefined = getFirstTimelineDateForState(
    input.timelines,
    input.acknowledgedStateId,
  );

  const resolvedAt: Date | undefined = getFirstTimelineDateForState(
    input.timelines,
    input.resolvedStateId,
  );

  const isAcknowledgedByResolution: boolean = Boolean(
    resolvedAt &&
      (!firstAcknowledgedAt ||
        resolvedAt.getTime() < firstAcknowledgedAt.getTime()),
  );

  return {
    startedAt: startedAt,
    acknowledgedAt: isAcknowledgedByResolution
      ? resolvedAt
      : firstAcknowledgedAt,
    resolvedAt: resolvedAt,
    isAcknowledgedByResolution: isAcknowledgedByResolution,
  };
};

export interface TimeToStateTextInput {
  startedAt?: Date | undefined;
  reachedAt?: Date | undefined;
  // The project's own name for the state, e.g. "Mitigated".
  stateName?: string | undefined;
  // Used when the project has no such state, e.g. "acknowledged".
  fallbackStateName: string;
}

/*
 * "12 minutes" once the state was reached, "Not yet acknowledged" before.
 * A state entry stamped before the start (a backdated declaredAt) reads as
 * "less than a minute" rather than as the absolute gap, which would claim a
 * response time that never happened.
 */
export const getTimeToStateText: (input: TimeToStateTextInput) => string = (
  input: TimeToStateTextInput,
): string => {
  if (!input.reachedAt) {
    const stateName: string = (
      input.stateName?.trim() || input.fallbackStateName
    ).toLowerCase();

    return `Not yet ${stateName}`;
  }

  if (!input.startedAt) {
    return "-";
  }

  const endDate: Date =
    input.reachedAt.getTime() < input.startedAt.getTime()
      ? input.startedAt
      : input.reachedAt;

  return getEventDurationText(input.startedAt, endDate);
};

export interface EventCreatorInput {
  probe?: { name?: string | undefined } | undefined | null;
  user?:
    | {
        name?: { toString: () => string } | string | undefined | null;
        email?: { toString: () => string } | string | undefined | null;
      }
    | undefined
    | null;
}

/*
 * Who opened an event, as plain text for the header: the probe that raised
 * it, else the user (by name, then email), else "Unknown".
 */
export const getEventCreatorName: (input: EventCreatorInput) => string = (
  input: EventCreatorInput,
): string => {
  const probeName: string = input.probe?.name?.trim() || "";

  if (probeName) {
    return probeName;
  }

  const userName: string = input.user?.name?.toString().trim() || "";

  if (userName) {
    return userName;
  }

  const userEmail: string = input.user?.email?.toString().trim() || "";

  if (userEmail) {
    return userEmail;
  }

  return "Unknown";
};

export interface VisibleItems<T> {
  visible: Array<T>;
  hiddenCount: number;
}

/*
 * The first `maxVisible` items and how many were left out, for a "a, b +3
 * more" style summary. maxVisible below 1 still shows one item.
 */
export const splitVisibleItems: <T>(
  items: Array<T>,
  maxVisible: number,
) => VisibleItems<T> = <T>(
  items: Array<T>,
  maxVisible: number,
): VisibleItems<T> => {
  const limit: number = Math.max(1, Math.floor(maxVisible));
  const visible: Array<T> = items.slice(0, limit);

  return {
    visible: visible,
    hiddenCount: Math.max(0, items.length - visible.length),
  };
};
