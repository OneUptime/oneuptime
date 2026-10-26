import OneUptimeDate from "Common/Types/Date";
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
  getGlobalTranslator,
  translatableTerm,
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
  // Used when the project has no such state, e.g. "Acknowledged".
  fallbackStateName: string;
}

/*
 * "Not yet acknowledged": one sentence, looked up whole. The state goes in
 * as a term, so one of OneUptime's own names ("Acknowledged") reads in the
 * reader's words, as the state's badge reads it, and a name the project
 * gave its state reads as written.
 */
export const NOT_YET_IN_STATE_TEMPLATE: string = translationKey(
  "Not yet {{stateName}}",
);

export const getNotYetInStateText: (
  stateName: string,
  translator?: Translator,
) => string = (
  stateName: string,
  translator: Translator = getGlobalTranslator(),
): string => {
  return translator.translateTemplate(NOT_YET_IN_STATE_TEMPLATE, {
    stateName: translatableTerm(stateName.trim(), { inSentence: true }),
  });
};

/*
 * "12 minutes" once the state was reached, "Not yet acknowledged" before.
 * A state entry stamped before the start (a backdated declaredAt) reads as
 * "less than a minute" rather than as the absolute gap, which would claim a
 * response time that never happened.
 */
export const getTimeToStateText: (
  input: TimeToStateTextInput,
  translator?: Translator,
) => string = (
  input: TimeToStateTextInput,
  translator: Translator = getGlobalTranslator(),
): string => {
  if (!input.reachedAt) {
    return getNotYetInStateText(
      input.stateName?.trim() || input.fallbackStateName,
      translator,
    );
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
 * Who opened an event: the probe that raised it, else the user (by name,
 * then email), else undefined when nobody is recorded.
 */
export const getKnownEventCreatorName: (
  input: EventCreatorInput,
) => string | undefined = (input: EventCreatorInput): string | undefined => {
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

  return undefined;
};

/*
 * Who opened an event, as plain text: the probe that raised it, else the
 * user (by name, then email), else "Unknown".
 */
export const getEventCreatorName: (input: EventCreatorInput) => string = (
  input: EventCreatorInput,
): string => {
  return getKnownEventCreatorName(input) || "Unknown";
};

// Keeps the words on either side of it on one line.
export const NON_BREAKING_SPACE: string = "\u00a0";

export interface EventStartTileParts {
  // "Sep 14, 06:01 PM": the date and the time, each held together.
  dateTime: string;
  // "GMT": the reader's time zone at that moment, or "" when it has none.
  zone: string;
}

/*
 * When a record started, as the first tile of its stat bar says it: "Sep 14,
 * 06:01 PM" and "GMT", in the reader's time zone and clock, with the year
 * only when it was not this year. The tile's neighbours say how long after
 * it the record was acknowledged and resolved, so this is the headline of
 * the three; the full stamp ("Sep 14 2026, 06:01 PM GMT", as their own dates
 * read) did not fit a tile of the episode's four-tile bar on one line.
 *
 * Where a tile is too narrow even for this (three tiles at 640px, four
 * beside the side menu at 1024px), it breaks after the date's comma - "Sep
 * 14," over "06:01 PM" - and then before the zone, never inside the date,
 * the time or the zone: each holds together with no-break spaces.
 */
export const getEventStartTileParts: (
  startedAt: Date,
  now?: Date | undefined,
) => EventStartTileParts = (
  startedAt: Date,
  now?: Date | undefined,
): EventStartTileParts => {
  const format: (date: Date, pattern: string) => string = (
    date: Date,
    pattern: string,
  ): string => {
    return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
      date: date,
      format: pattern,
    });
  };

  const isThisYear: boolean =
    format(startedAt, "YYYY") ===
    format(now || OneUptimeDate.getCurrentDate(), "YYYY");

  const datePart: string = format(
    startedAt,
    isThisYear ? "MMM DD" : "MMM DD YYYY",
  );
  const timePart: string = format(
    startedAt,
    OneUptimeDate.getUserPrefers12HourFormat() ? "hh:mm A" : "HH:mm",
  );
  const zone: string = OneUptimeDate.getZoneAbbrByTimezone(
    OneUptimeDate.getCurrentTimezone(),
    startedAt,
  );

  const keepTogether: (text: string) => string = (text: string): string => {
    return text.split(" ").join(NON_BREAKING_SPACE);
  };

  return {
    dateTime: `${keepTogether(datePart)}, ${keepTogether(timePart)}`,
    zone: keepTogether(zone || ""),
  };
};

// The start tile's time as one line of text: "Sep 14, 06:01 PM GMT".
export const getEventStartTileText: (
  startedAt: Date,
  now?: Date | undefined,
) => string = (startedAt: Date, now?: Date | undefined): string => {
  const parts: EventStartTileParts = getEventStartTileParts(startedAt, now);

  return parts.zone ? `${parts.dateTime} ${parts.zone}` : parts.dateTime;
};

export interface EventStartedByInput extends EventCreatorInput {
  /*
   * Opened by OneUptime itself - a monitor's criteria, a rule - with no
   * probe or person on record (isCreatedAutomatically).
   */
  isCreatedAutomatically?: boolean | undefined;
}

// The line under the Declared / Created tile's time: who or what opened it.
export const EVENT_STARTED_BY_TEMPLATE: string = translationKey("By {{name}}");
export const EVENT_STARTED_AUTOMATICALLY: string =
  translationKey("Automatically");

/*
 * "By eu-west-1 probe", "By Maya Chen", "Automatically", in the reader's
 * language - or undefined when nothing about it is on record, rather than
 * "By Unknown".
 */
export const getEventStartedByText: (
  input: EventStartedByInput,
  translator: Translator,
) => string | undefined = (
  input: EventStartedByInput,
  translator: Translator,
): string | undefined => {
  const name: string | undefined = getKnownEventCreatorName(input);

  if (name) {
    return translator.translateTemplate(EVENT_STARTED_BY_TEMPLATE, {
      name: name,
    });
  }

  if (input.isCreatedAutomatically) {
    return (
      translator.translateText(EVENT_STARTED_AUTOMATICALLY) ||
      EVENT_STARTED_AUTOMATICALLY
    );
  }

  return undefined;
};

export interface ImpactBeforeStartInput {
  /*
   * When customer impact began, as somebody recorded it (impactStartedAt):
   * never inferred, so usually empty.
   */
  impactStartedAt?: Date | undefined;
  // When the record was declared (incident) or created (alert).
  startedAt?: Date | undefined;
}

/*
 * How long customer impact had been going on when the record was declared -
 * the time to detect - as the units of the duration, at most the two
 * largest. Null when there is nothing to say: no impact start on record, or
 * one that began only once it was declared (nothing went undetected).
 */
export const getImpactBeforeStartParts: (
  input: ImpactBeforeStartInput,
) => Array<EventDurationPart> | null = (
  input: ImpactBeforeStartInput,
): Array<EventDurationPart> | null => {
  if (!input.impactStartedAt || !input.startedAt) {
    return null;
  }

  if (input.impactStartedAt.getTime() >= input.startedAt.getTime()) {
    return null;
  }

  return getEventDurationParts(input.impactStartedAt, input.startedAt, {
    maxUnits: TABLE_DURATION_MAX_UNITS,
  });
};

// The line the Declared tile adds when somebody recorded the impact's start.
export const IMPACT_BEFORE_START_TEMPLATE: string = translationKey(
  "{{duration}} after impact began",
);

/*
 * "3 minutes after impact began", in the reader's language, or undefined
 * when there is nothing to say (getImpactBeforeStartParts).
 */
export const getImpactBeforeStartText: (
  input: ImpactBeforeStartInput,
  translator: Translator,
) => string | undefined = (
  input: ImpactBeforeStartInput,
  translator: Translator,
): string | undefined => {
  const parts: Array<EventDurationPart> | null =
    getImpactBeforeStartParts(input);

  if (!parts) {
    return undefined;
  }

  return translator.translateTemplate(IMPACT_BEFORE_START_TEMPLATE, {
    // The duration in the sentence's own language, as LiveDuration says it.
    duration: composedValue((sentence: Translator): string => {
      if (parts.length === 0) {
        return sentence.translateText(LESS_THAN_A_MINUTE) || LESS_THAN_A_MINUTE;
      }

      return formatEventDurationParts(parts, sentence.language);
    }),
  });
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
