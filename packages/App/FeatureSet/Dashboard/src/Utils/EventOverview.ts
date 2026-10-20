import {
  EventDurationPart,
  EventStateTimelineDate,
  LESS_THAN_A_MINUTE,
  TABLE_DURATION_MAX_UNITS,
  formatEventDurationParts,
  getEventDurationParts,
  getEventDurationText,
} from "./EventDuration";
import {
  Translator,
  composedValue,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

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
  /*
   * The project's states a record is acknowledged but not yet resolved in:
   * its acknowledged state and any state placed after it, up to the resolved
   * one (AcknowledgedStateUtil.getAcknowledgedUnresolvedStateIds) - moving
   * straight into "Investigating" is an acknowledgement too.
   */
  acknowledgedStateIds?: Array<string> | undefined;
  /*
   * The project's states that count as resolved: its resolved state and any
   * state placed after it (Common/Utils/ResolvedState).
   */
  resolvedStateIds?: Array<string> | undefined;
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

/*
 * The earliest entry for any of the states: when the record first reached
 * one of them. Undefined when it never did.
 */
export const getFirstTimelineDateForStates: (
  timelines: Array<EventStateTimelineDate>,
  stateIds: Array<string> | undefined,
) => Date | undefined = (
  timelines: Array<EventStateTimelineDate>,
  stateIds: Array<string> | undefined,
): Date | undefined => {
  let firstDate: Date | undefined = undefined;

  for (const stateId of stateIds || []) {
    const reachedAt: Date | undefined = getFirstTimelineDateForState(
      timelines,
      stateId,
    );

    if (
      reachedAt &&
      (!firstDate || reachedAt.getTime() < firstDate.getTime())
    ) {
      firstDate = reachedAt;
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

  /*
   * The first move into a state that counts as acknowledged - the
   * acknowledged state or one placed after it - and the first into one that
   * counts as resolved.
   */
  const firstAcknowledgedAt: Date | undefined = getFirstTimelineDateForStates(
    input.timelines,
    input.acknowledgedStateIds,
  );

  const resolvedAt: Date | undefined = getFirstTimelineDateForStates(
    input.timelines,
    input.resolvedStateIds,
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

export interface AcknowledgedAfterPagingInput {
  /*
   * When somebody was first paged about the record (firstPagedAt), or
   * undefined when nobody was.
   */
  firstPagedAt?: Date | undefined;
  /*
   * When it was first acknowledged - or resolved, which answers it too
   * (getEventResponseTimes).
   */
  acknowledgedAt?: Date | undefined;
}

/*
 * How long after the first page a record was acknowledged, as the units of
 * the duration (getEventDurationParts): none under a minute, and at most the
 * two largest ("1 day, 2 hours"), so the line stays one short line under the
 * tile's value. Null when there is nothing to say: nobody was paged, nobody
 * has acknowledged it yet, or it was acknowledged before anybody was paged.
 *
 * "Acknowledged in" counts from when the record started, so an alert raised
 * at night and paged in the morning reads as hours; this is the part of it
 * that the people paged took.
 */
export const getAcknowledgedAfterPagingParts: (
  input: AcknowledgedAfterPagingInput,
) => Array<EventDurationPart> | null = (
  input: AcknowledgedAfterPagingInput,
): Array<EventDurationPart> | null => {
  if (!input.firstPagedAt || !input.acknowledgedAt) {
    return null;
  }

  if (input.acknowledgedAt.getTime() < input.firstPagedAt.getTime()) {
    return null;
  }

  return getEventDurationParts(input.firstPagedAt, input.acknowledgedAt, {
    maxUnits: TABLE_DURATION_MAX_UNITS,
  });
};

// The line the "Acknowledged in" tile adds for a record somebody was paged about.
export const ACKNOWLEDGED_AFTER_PAGING_TEMPLATE: string = translationKey(
  "{{duration}} after paging",
);

/*
 * "4 minutes after paging", in the reader's language, or undefined when
 * there is nothing to say (getAcknowledgedAfterPagingParts).
 */
export const getAcknowledgedAfterPagingText: (
  input: AcknowledgedAfterPagingInput,
  translator: Translator,
) => string | undefined = (
  input: AcknowledgedAfterPagingInput,
  translator: Translator,
): string | undefined => {
  const parts: Array<EventDurationPart> | null =
    getAcknowledgedAfterPagingParts(input);

  if (!parts) {
    return undefined;
  }

  return translator.translateTemplate(ACKNOWLEDGED_AFTER_PAGING_TEMPLATE, {
    // The duration in the sentence's own language, as LiveDuration says it.
    duration: composedValue((sentence: Translator): string => {
      if (parts.length === 0) {
        return sentence.translateText(LESS_THAN_A_MINUTE) || LESS_THAN_A_MINUTE;
      }

      return formatEventDurationParts(parts, sentence.language);
    }),
  });
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
