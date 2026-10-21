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

// What a duration under a minute is called (translated by the Dashboard).
export const LESS_THAN_A_MINUTE: string = "less than a minute";

export type EventDurationUnit = "day" | "hour" | "minute";

// One unit of a duration: "23 hours" is { count: 23, unit: "hour" }.
export interface EventDurationPart {
  count: number;
  unit: EventDurationUnit;
}

function formatDurationUnit(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/*
 * How many units a table's Duration column says: the two largest ("10 days,
 * 23 hours"). "10 days, 23 hours, 31 minutes" made the column the widest in
 * the Incidents list, and the minutes of a ten-day incident say nothing a
 * reader scanning a list needs. The whole duration is the cell's tooltip.
 */
export const TABLE_DURATION_MAX_UNITS: number = 2;

export interface EventDurationTextOptions {
  /*
   * At most this many units, the largest first: "10 days, 23 hours" for a
   * duration of 10 days, 23 hours and 31 minutes. Every unit when absent.
   */
  maxUnits?: number | undefined;
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
 *
 * With maxUnits, only the largest units are said, and a smaller one is
 * dropped rather than rounded ("1 day, 23 hours" for a day, 23 hours and 59
 * minutes): a duration is never said to be longer than it was.
 */
export function getEventDurationText(
  startDate: Date,
  endDate: Date,
  options?: EventDurationTextOptions | undefined,
): string {
  const parts: Array<EventDurationPart> = getEventDurationParts(
    startDate,
    endDate,
    options,
  );

  if (parts.length === 0) {
    return LESS_THAN_A_MINUTE;
  }

  return parts
    .map((part: EventDurationPart): string => {
      return formatDurationUnit(part.count, part.unit);
    })
    .join(", ");
}

/*
 * The units getEventDurationText says, largest first: none for less than a
 * minute, and with maxUnits only the largest ones. For a caller that says
 * them in the reader's own words (formatEventDurationParts).
 */
export function getEventDurationParts(
  startDate: Date,
  endDate: Date,
  options?: EventDurationTextOptions | undefined,
): Array<EventDurationPart> {
  const minutes: number = OneUptimeDate.getDifferenceInMinutes(
    endDate,
    startDate,
  );

  if (minutes < 1) {
    return [];
  }

  const days: number = Math.floor(minutes / MINUTES_PER_DAY);
  const hours: number = Math.floor(
    (minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR,
  );
  const remainingMinutes: number = minutes % MINUTES_PER_HOUR;
  const parts: Array<EventDurationPart> = [];

  if (days > 0) {
    parts.push({ count: days, unit: "day" });
  }

  if (hours > 0) {
    parts.push({ count: hours, unit: "hour" });
  }

  if (remainingMinutes > 0) {
    parts.push({ count: remainingMinutes, unit: "minute" });
  }

  const maxUnits: number | undefined = options?.maxUnits;

  if (maxUnits !== undefined && maxUnits >= 1 && parts.length > maxUnits) {
    return parts.slice(0, Math.floor(maxUnits));
  }

  return parts;
}

/*
 * Intl's unit style and list, typed by the parts used here: the Dashboard
 * compiles against an ES2017 library, which has neither.
 */
interface DurationUnitFormatter {
  format: (value: number) => string;
}

interface DurationListFormatter {
  format: (items: Array<string>) => string;
}

type DurationListFormatConstructor = new (
  locale: string,
  options: { type: "unit"; style: "long" },
) => DurationListFormatter;

/*
 * A duration's units in the reader's language, with the language's own unit
 * names, plurals and list: "10 Tage, 23 Stunden", "10 jours et 23 heures",
 * "10 дней 23 часа", "10 日 23 時間". English, an empty list, or an engine
 * without Intl's unit style: the English text getEventDurationText writes,
 * word for word. Less than a minute (no parts) is the caller's to say: it is
 * a phrase to translate, not a unit.
 */
export function formatEventDurationParts(
  parts: Array<EventDurationPart>,
  language: string | undefined,
): string {
  const english: string = parts
    .map((part: EventDurationPart): string => {
      return formatDurationUnit(part.count, part.unit);
    })
    .join(", ");

  if (!language || language === "en" || language.startsWith("en-")) {
    return english;
  }

  try {
    const words: Array<string> = [];

    for (const part of parts) {
      const formatter: DurationUnitFormatter = new Intl.NumberFormat(language, {
        style: "unit",
        unit: part.unit,
        unitDisplay: "long",
      } as Intl.NumberFormatOptions);
      const word: string = formatter.format(part.count);

      // An engine without the unit style writes the bare number.
      if (word === part.count.toLocaleString(language)) {
        return english;
      }

      words.push(word);
    }

    const ListFormat: DurationListFormatConstructor | undefined = (
      Intl as unknown as {
        ListFormat?: DurationListFormatConstructor | undefined;
      }
    ).ListFormat;

    if (!ListFormat || words.length < 2) {
      return words.join(", ");
    }

    return new ListFormat(language, { type: "unit", style: "long" }).format(
      words,
    );
  } catch {
    return english;
  }
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
  const timelinesByEventId: Map<
    string,
    Array<EventStateTimelineDate>
  > = new Map();

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
