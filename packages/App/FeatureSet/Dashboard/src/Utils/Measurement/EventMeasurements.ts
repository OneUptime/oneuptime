import AlertMeasurement from "Common/Models/DatabaseModels/AlertMeasurement";
import AlertMeasurementValue from "Common/Models/DatabaseModels/AlertMeasurementValue";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentMeasurement from "Common/Models/DatabaseModels/IncidentMeasurement";
import IncidentMeasurementValue from "Common/Models/DatabaseModels/IncidentMeasurementValue";
import ScheduledMaintenanceMeasurement from "Common/Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import ScheduledMaintenanceMeasurementValue from "Common/Models/DatabaseModels/ScheduledMaintenanceMeasurementValue";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IncidentMeasurementAnchorType from "Common/Types/Incident/IncidentMeasurementAnchorType";
import MeasurementStatus from "Common/Types/Measurement/MeasurementStatus";
import MeasurementUnit, {
  SECONDS_PER_MEASUREMENT_UNIT,
  getMeasurementUnit,
} from "Common/Types/Measurement/MeasurementUnit";
import ObjectID from "Common/Types/ObjectID";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import { MeasurementDomain } from "Common/Utils/Measurement/MeasurementMoments";
import {
  ALERT_MEASUREMENT_FORM,
  INCIDENT_MEASUREMENT_FORM,
  MEASUREMENT_VALUE_COPY,
  MeasurementForm,
  MeasurementValues,
  SCHEDULED_MAINTENANCE_MEASUREMENT_FORM,
} from "./MeasurementSetup";

/*
 * An incident's, an alert's or a maintenance event's own measurements, on
 * its own page.
 *
 * The workers work every measurement out for every event and store one
 * value per event (IncidentMeasurementValue and its two twins): when the
 * clock started and stopped, the duration, and a status. Until this, the
 * values only reached View Chart, so a team that set up "Time to mitigate"
 * opened an incident and found it nowhere. The Measurements card
 * (Components/Measurement/EventMeasurementsCard) lists the measurements the
 * project shows on event pages, in their order, each as a number in its own
 * unit or as one short state in plain words.
 *
 * React-free, like MeasurementSetup: what is asked for and how a stored
 * value reads are pinned by tests that import them from here.
 */

/*
 * Where one kind of event keeps its measurements: the definitions, the
 * values, and the columns that tie them together.
 */
export interface EventMeasurementSource {
  domain: MeasurementDomain;
  // The definition's columns for each end (start/end anchor, role, state).
  form: MeasurementForm;
  measurementModel: DatabaseBaseModelType;
  valueModel: DatabaseBaseModelType;
  // The definition's "Show on ... pages" switch.
  showOnViewColumn: string;
  // The value's event and definition.
  eventIdColumn: string;
  measurementIdColumn: string;
}

export const INCIDENT_EVENT_MEASUREMENTS: EventMeasurementSource = {
  domain: MeasurementDomain.Incident,
  form: INCIDENT_MEASUREMENT_FORM,
  measurementModel: IncidentMeasurement,
  valueModel: IncidentMeasurementValue,
  showOnViewColumn: "showOnIncidentView",
  eventIdColumn: "incidentId",
  measurementIdColumn: "incidentMeasurementId",
};

export const ALERT_EVENT_MEASUREMENTS: EventMeasurementSource = {
  domain: MeasurementDomain.Alert,
  form: ALERT_MEASUREMENT_FORM,
  measurementModel: AlertMeasurement,
  valueModel: AlertMeasurementValue,
  showOnViewColumn: "showOnAlertView",
  eventIdColumn: "alertId",
  measurementIdColumn: "alertMeasurementId",
};

export const SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS: EventMeasurementSource =
  {
    domain: MeasurementDomain.ScheduledMaintenance,
    form: SCHEDULED_MAINTENANCE_MEASUREMENT_FORM,
    measurementModel: ScheduledMaintenanceMeasurement,
    valueModel: ScheduledMaintenanceMeasurementValue,
    showOnViewColumn: "showOnScheduledMaintenanceView",
    eventIdColumn: "scheduledMaintenanceId",
    measurementIdColumn: "scheduledMaintenanceMeasurementId",
  };

export const EVENT_MEASUREMENT_SOURCES: Record<
  MeasurementDomain,
  EventMeasurementSource
> = {
  [MeasurementDomain.Incident]: INCIDENT_EVENT_MEASUREMENTS,
  [MeasurementDomain.Alert]: ALERT_EVENT_MEASUREMENTS,
  [MeasurementDomain.ScheduledMaintenance]:
    SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS,
};

// One list request, as plain data: the card hands it to ModelAPI.getList.
export interface EventMeasurementListRequest {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, SortOrder>;
}

/**
 * The measurements an event's page shows: the enabled ones whose "Show on
 * ... pages" switch is on, in the order the project dragged them into, with
 * what the card needs to describe them ("Declared → Acknowledged") and to
 * tell a value worked out before the measurement last changed.
 */
export const getEventMeasurementDefinitionsRequest: (
  source: EventMeasurementSource,
) => EventMeasurementListRequest = (
  source: EventMeasurementSource,
): EventMeasurementListRequest => {
  const form: MeasurementForm = source.form;

  return {
    query: {
      isEnabled: true,
      [source.showOnViewColumn]: true,
    },
    select: {
      _id: true,
      name: true,
      unit: true,
      order: true,
      backfillRequestedAt: true,
      [form.start.anchorType]: true,
      [form.end.anchorType]: true,
      [form.start.stateRole]: true,
      [form.end.stateRole]: true,
      [form.start.occurrence]: true,
      [form.end.occurrence]: true,
      [form.start.state]: { name: true },
      [form.end.state]: { name: true },
    },
    sort: { order: SortOrder.Ascending },
  };
};

/**
 * This event's worked-out values, one per measurement.
 */
export const getEventMeasurementValuesRequest: (data: {
  source: EventMeasurementSource;
  eventId: ObjectID;
}) => EventMeasurementListRequest = (data: {
  source: EventMeasurementSource;
  eventId: ObjectID;
}): EventMeasurementListRequest => {
  return {
    query: {
      [data.source.eventIdColumn]: data.eventId,
    },
    select: {
      _id: true,
      [data.source.measurementIdColumn]: true,
      status: true,
      statusMessage: true,
      startedAt: true,
      endedAt: true,
      valueInSeconds: true,
      computedAt: true,
    },
    sort: {},
  };
};

/*
 * What one measurement reads as on the page. Each names what is true of
 * this event, in the event's terms - the API's Pending covers three of them.
 */
export enum EventMeasurementState {
  // Both moments happened: the duration.
  Recorded = "recorded",
  // The clock started and is still going: "Running for 12 minutes".
  Running = "running",
  // The start has not happened, or is still ahead (a scheduled start).
  NotStarted = "not-started",
  // The event is over, and a state it waited for was never reached.
  NotReached = "not-reached",
  // Not Applicable: a moment can never happen (skipped, never recorded).
  NotMeasured = "not-measured",
  // Invalid: the recorded end is before the start.
  EndsBeforeStart = "ends-before-start",
  // No value yet, or one worked out before the measurement last changed.
  NotWorkedOut = "not-worked-out",
}

export interface EventMeasurementReading {
  measurementId: string;
  // The project's own name for it, shown as it was typed.
  name: string;
  // The definition as read, for its "Declared → Acknowledged" summary.
  measurement: MeasurementValues;
  unit: MeasurementUnit;
  state: EventMeasurementState;
  // Recorded: the duration.
  valueInSeconds?: number | undefined;
  /*
   * Running: when the clock started. Not started yet: when it will, for a
   * start that is a time still ahead (a scheduled start).
   */
  startedAt?: Date | undefined;
  /*
   * Why there is no number, in the server's words ("Mitigated was
   * skipped"), when it has a reason to give.
   */
  reason?: string | undefined;
}

type ReadDateFunction = (value: unknown) => Date | undefined;

const readDate: ReadDateFunction = (value: unknown): Date | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    const date: Date = OneUptimeDate.fromString(value as Date);

    return isNaN(date.getTime()) ? undefined : date;
  } catch {
    return undefined;
  }
};

type ReadStringFunction = (value: unknown) => string | undefined;

const readString: ReadStringFunction = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

type ReadIdFunction = (value: unknown) => string | undefined;

// An id as the API hands it: a string, or an ObjectID.
const readId: ReadIdFunction = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const id: string = String(value).trim();

  return id ? id : undefined;
};

/*
 * The two anchors a state timeline resolves. They can never be reached
 * once the event is over, unless it is reopened; the timestamps that come
 * after the end (a postmortem, an impact start recorded later) still can.
 * The same values in all three anchor type enums.
 */
const STATE_ANCHOR_TYPES: Array<string> = [
  IncidentMeasurementAnchorType.StateEntered,
  IncidentMeasurementAnchorType.StateRoleEntered,
];

type IsStateAnchorFunction = (anchorType: string | undefined) => boolean;

const isStateAnchor: IsStateAnchorFunction = (
  anchorType: string | undefined,
): boolean => {
  return Boolean(anchorType && STATE_ANCHOR_TYPES.includes(anchorType));
};

/**
 * Whether a stored value still describes the measurement: one worked out
 * before the measurement's start, end or unit last changed (which asks for
 * every event to be worked out again) is for a measurement that no longer
 * exists in that form.
 */
export const isEventMeasurementValueCurrent: (data: {
  measurement: MeasurementValues;
  value: MeasurementValues;
}) => boolean = (data: {
  measurement: MeasurementValues;
  value: MeasurementValues;
}): boolean => {
  const changedAt: Date | undefined = readDate(
    data.measurement["backfillRequestedAt"],
  );

  if (!changedAt) {
    return true;
  }

  const computedAt: Date | undefined = readDate(data.value["computedAt"]);

  if (!computedAt) {
    return false;
  }

  return computedAt.getTime() >= changedAt.getTime();
};

type GetReadingFunction = (data: {
  source: EventMeasurementSource;
  measurement: MeasurementValues;
  value: MeasurementValues | undefined;
  isEventOver: boolean;
  now: Date;
}) => EventMeasurementReading | null;

const getReading: GetReadingFunction = (data: {
  source: EventMeasurementSource;
  measurement: MeasurementValues;
  value: MeasurementValues | undefined;
  isEventOver: boolean;
  now: Date;
}): EventMeasurementReading | null => {
  const measurementId: string | undefined = readId(data.measurement["_id"]);

  if (!measurementId) {
    return null;
  }

  const reading: EventMeasurementReading = {
    measurementId: measurementId,
    name: readString(data.measurement["name"]) || "",
    measurement: data.measurement,
    unit: getMeasurementUnit(data.measurement["unit"]),
    state: EventMeasurementState.NotWorkedOut,
  };

  const value: MeasurementValues | undefined = data.value;

  if (
    !value ||
    !isEventMeasurementValueCurrent({
      measurement: data.measurement,
      value: value,
    })
  ) {
    return reading;
  }

  const reason: string | undefined = readString(value["statusMessage"]);

  switch (value["status"]) {
    case MeasurementStatus.Recorded: {
      const seconds: unknown = value["valueInSeconds"];

      if (typeof seconds !== "number" || !isFinite(seconds)) {
        // Recorded with no number: nothing honest to show yet.
        return reading;
      }

      reading.state = EventMeasurementState.Recorded;
      reading.valueInSeconds = Math.max(0, seconds);
      return reading;
    }

    case MeasurementStatus.NotApplicable:
      reading.state = EventMeasurementState.NotMeasured;
      reading.reason = reason;
      return reading;

    case MeasurementStatus.Invalid:
      reading.state = EventMeasurementState.EndsBeforeStart;
      reading.reason = reason;
      return reading;

    default:
      break;
  }

  // Pending: a moment has not happened yet.
  const form: MeasurementForm = data.source.form;
  const startedAt: Date | undefined = readDate(value["startedAt"]);
  const endedAt: Date | undefined = readDate(value["endedAt"]);

  const unresolvedAnchorTypes: Array<string | undefined> = [];

  if (!startedAt) {
    unresolvedAnchorTypes.push(
      readString(data.measurement[form.start.anchorType]),
    );
  }

  if (!endedAt) {
    unresolvedAnchorTypes.push(
      readString(data.measurement[form.end.anchorType]),
    );
  }

  /*
   * The server leaves a state that was never reached Pending - a resolved
   * incident can be reopened and acknowledged after all. On a page that
   * says the event is over, a clock still "running" since it was declared
   * would read as days and counting, so it says what happened instead.
   */
  if (
    data.isEventOver &&
    unresolvedAnchorTypes.length > 0 &&
    unresolvedAnchorTypes.every((anchorType: string | undefined): boolean => {
      return isStateAnchor(anchorType);
    })
  ) {
    reading.state = EventMeasurementState.NotReached;
    return reading;
  }

  if (startedAt) {
    reading.startedAt = startedAt;
    // A clock that starts later (a scheduled start) has not started yet.
    reading.state =
      startedAt.getTime() <= data.now.getTime()
        ? EventMeasurementState.Running
        : EventMeasurementState.NotStarted;
    return reading;
  }

  reading.state = EventMeasurementState.NotStarted;

  /*
   * The end has happened and the start has not: its time was never
   * recorded ("Impact Started At has not been recorded yet"), which the
   * server's reason says and "Not started yet" alone would not.
   */
  if (endedAt) {
    reading.reason = reason;
  }

  return reading;
};

/**
 * Every measurement the page shows, in the order they came, each read
 * from this event's value for it.
 */
export const getEventMeasurementReadings: (data: {
  source: EventMeasurementSource;
  measurements: Array<MeasurementValues>;
  values: Array<MeasurementValues>;
  // Resolved, or completed for maintenance: no state it waits for comes.
  isEventOver: boolean;
  now: Date;
}) => Array<EventMeasurementReading> = (data: {
  source: EventMeasurementSource;
  measurements: Array<MeasurementValues>;
  values: Array<MeasurementValues>;
  isEventOver: boolean;
  now: Date;
}): Array<EventMeasurementReading> => {
  const valuesByMeasurementId: Map<string, MeasurementValues> = new Map<
    string,
    MeasurementValues
  >();

  for (const value of data.values) {
    const measurementId: string | undefined = readId(
      value[data.source.measurementIdColumn],
    );

    if (measurementId && !valuesByMeasurementId.has(measurementId)) {
      valuesByMeasurementId.set(measurementId, value);
    }
  }

  const readings: Array<EventMeasurementReading> = [];

  for (const measurement of data.measurements) {
    const measurementId: string | undefined = readId(measurement["_id"]);

    const reading: EventMeasurementReading | null = getReading({
      source: data.source,
      measurement: measurement,
      value: measurementId
        ? valuesByMeasurementId.get(measurementId)
        : undefined,
      isEventOver: data.isEventOver,
      now: data.now,
    });

    if (reading) {
      readings.push(reading);
    }
  }

  return readings;
};

/*
 * A duration in each unit, through the Dashboard's shared plural keys.
 */
export const MEASUREMENT_UNIT_PLURALS: Record<MeasurementUnit, PluralTemplate> =
  {
    [MeasurementUnit.Seconds]: {
      one: "{{count}} second",
      other: "{{count}} seconds",
    },
    [MeasurementUnit.Minutes]: {
      one: "{{count}} minute",
      other: "{{count}} minutes",
    },
    [MeasurementUnit.Hours]: {
      one: "{{count}} hour",
      other: "{{count}} hours",
    },
    [MeasurementUnit.Days]: {
      one: "{{count}} day",
      other: "{{count}} days",
    },
  };

const SECONDS_PER_MINUTE: number = 60;
const MINUTES_PER_HOUR: number = 60;
const MINUTES_PER_DAY: number = 24 * MINUTES_PER_HOUR;

/**
 * A duration in a unit someone pinned (minutes, hours or days), as the
 * page writes it: one decimal place - 1.5 hours, 4.2 minutes - and two
 * significant figures for an amount too small for that, so a short
 * duration in days still reads as more than nothing.
 */
export const roundMeasurementAmount: (amount: number) => number = (
  amount: number,
): number => {
  if (!isFinite(amount) || amount <= 0) {
    return 0;
  }

  const oneDecimal: number = Math.round(amount * 10) / 10;

  if (oneDecimal > 0) {
    return oneDecimal;
  }

  return Number(amount.toPrecision(2));
};

type FormatMeasurementAmountFunction = (
  amount: number,
  language: string,
) => string;

/*
 * The rounded amount, written the reader's way ("1,5" in German) with the
 * digits roundMeasurementAmount kept: the plural's own number formatting
 * stops at three decimals, which would write 0.00035 days as 0.
 */
const formatMeasurementAmount: FormatMeasurementAmountFunction = (
  amount: number,
  language: string,
): string => {
  const options: Intl.NumberFormatOptions =
    amount > 0 && amount < 0.05
      ? { maximumSignificantDigits: 2 }
      : { maximumFractionDigits: 1 };

  try {
    return amount.toLocaleString(language, options);
  } catch {
    return amount.toLocaleString(undefined, options);
  }
};

interface ListFormatter {
  format: (items: Array<string>) => string;
}

type ListFormatConstructor = new (
  locales: string,
  options: { style: string; type: string },
) => ListFormatter;

type JoinDurationPartsFunction = (
  parts: Array<string>,
  language: string,
) => string;

/*
 * "1 hour, 5 minutes" in English, the reader's own way in theirs. Falls
 * back to a comma where the browser has no list formatting.
 */
const joinDurationParts: JoinDurationPartsFunction = (
  parts: Array<string>,
  language: string,
): string => {
  const ListFormat: ListFormatConstructor | undefined = (
    Intl as unknown as { ListFormat?: ListFormatConstructor }
  ).ListFormat;

  if (ListFormat) {
    try {
      return new ListFormat(language, {
        style: "long",
        type: "unit",
      }).format(parts);
    } catch {
      // An unknown language code: the comma below.
    }
  }

  return parts.join(", ");
};

/**
 * A measurement's duration in its own unit. Automatic (seconds, the
 * default) reads the way the page's other timings do - "1 hour, 5
 * minutes", "2 days, 3 hours" - with seconds only for a duration under a
 * minute, and a running clock under a minute is "less than a minute": it
 * moves every 30 seconds. A pinned unit reads in that unit: "1.5 hours".
 */
export const formatEventMeasurementDuration: (data: {
  seconds: number;
  unit: MeasurementUnit;
  translator: Translator;
  isRunning?: boolean | undefined;
}) => string = (data: {
  seconds: number;
  unit: MeasurementUnit;
  translator: Translator;
  isRunning?: boolean | undefined;
}): string => {
  const translator: Translator = data.translator;
  const seconds: number = isFinite(data.seconds)
    ? Math.max(0, Math.floor(data.seconds))
    : 0;

  if (data.unit !== MeasurementUnit.Seconds) {
    const amount: number = roundMeasurementAmount(
      seconds / SECONDS_PER_MEASUREMENT_UNIT[data.unit],
    );

    return translator.translatePlural(
      MEASUREMENT_UNIT_PLURALS[data.unit],
      amount,
      { count: formatMeasurementAmount(amount, translator.language) },
    );
  }

  if (seconds < SECONDS_PER_MINUTE) {
    if (data.isRunning) {
      return (
        translator.translateText(MEASUREMENT_VALUE_COPY.lessThanAMinute) ||
        MEASUREMENT_VALUE_COPY.lessThanAMinute
      );
    }

    return translator.translatePlural(
      MEASUREMENT_UNIT_PLURALS[MeasurementUnit.Seconds],
      seconds,
    );
  }

  const totalMinutes: number = Math.floor(seconds / SECONDS_PER_MINUTE);
  const days: number = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const hours: number = Math.floor(
    (totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR,
  );
  const minutes: number = totalMinutes % MINUTES_PER_HOUR;
  const parts: Array<string> = [];

  if (days > 0) {
    parts.push(
      translator.translatePlural(
        MEASUREMENT_UNIT_PLURALS[MeasurementUnit.Days],
        days,
      ),
    );
  }

  if (hours > 0) {
    parts.push(
      translator.translatePlural(
        MEASUREMENT_UNIT_PLURALS[MeasurementUnit.Hours],
        hours,
      ),
    );
  }

  if (minutes > 0) {
    parts.push(
      translator.translatePlural(
        MEASUREMENT_UNIT_PLURALS[MeasurementUnit.Minutes],
        minutes,
      ),
    );
  }

  return joinDurationParts(parts, translator.language);
};

/*
 * How a value is drawn: a number stands out, a state is quieter, and a
 * measurement whose end is before its start is the one worth fixing.
 */
export enum EventMeasurementTone {
  Value = "value",
  State = "state",
  Warning = "warning",
}

export interface EventMeasurementDisplay {
  // "4 minutes", "Running for 12 minutes", "Not measured".
  text: string;
  tone: EventMeasurementTone;
  // Why there is no number, when there is a reason to give.
  reason?: string | undefined;
}

/**
 * What one measurement's row says, in the reader's language, at `now`.
 */
export const getEventMeasurementDisplay: (data: {
  reading: EventMeasurementReading;
  translator: Translator;
  now: Date;
}) => EventMeasurementDisplay = (data: {
  reading: EventMeasurementReading;
  translator: Translator;
  now: Date;
}): EventMeasurementDisplay => {
  const translator: Translator = data.translator;
  const reading: EventMeasurementReading = data.reading;

  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  switch (reading.state) {
    case EventMeasurementState.Recorded:
      return {
        text: formatEventMeasurementDuration({
          seconds: reading.valueInSeconds || 0,
          unit: reading.unit,
          translator: translator,
        }),
        tone: EventMeasurementTone.Value,
      };

    case EventMeasurementState.Running: {
      const elapsedSeconds: number = reading.startedAt
        ? (data.now.getTime() - reading.startedAt.getTime()) / 1000
        : 0;

      return {
        text: translator.translateTemplate(MEASUREMENT_VALUE_COPY.running, {
          duration: formatEventMeasurementDuration({
            seconds: elapsedSeconds,
            unit: reading.unit,
            translator: translator,
            isRunning: true,
          }),
        }),
        tone: EventMeasurementTone.Value,
      };
    }

    case EventMeasurementState.NotStarted:
      return {
        text: translate(MEASUREMENT_VALUE_COPY.notStarted),
        tone: EventMeasurementTone.State,
        reason: reading.reason,
      };

    case EventMeasurementState.NotReached:
      return {
        text: translate(MEASUREMENT_VALUE_COPY.notReached),
        tone: EventMeasurementTone.State,
      };

    case EventMeasurementState.NotMeasured:
      return {
        text: translate(MEASUREMENT_VALUE_COPY.notMeasured),
        tone: EventMeasurementTone.State,
        reason: reading.reason,
      };

    case EventMeasurementState.EndsBeforeStart:
      return {
        text: translate(MEASUREMENT_VALUE_COPY.endsBeforeStart),
        tone: EventMeasurementTone.Warning,
        reason: reading.reason,
      };

    case EventMeasurementState.NotWorkedOut:
    default:
      return {
        text: translate(MEASUREMENT_VALUE_COPY.notWorkedOut),
        tone: EventMeasurementTone.State,
        reason: translate(MEASUREMENT_VALUE_COPY.notWorkedOutReason),
      };
  }
};

/**
 * Whether the page has to keep its clock moving: a running measurement
 * counts up, and one whose start is a time still ahead starts running when
 * that time comes.
 */
export const shouldEventMeasurementsTick: (
  readings: Array<EventMeasurementReading>,
) => boolean = (readings: Array<EventMeasurementReading>): boolean => {
  return readings.some((reading: EventMeasurementReading): boolean => {
    return (
      reading.state === EventMeasurementState.Running ||
      (reading.state === EventMeasurementState.NotStarted &&
        Boolean(reading.startedAt))
    );
  });
};

/**
 * A key that changes whenever an event's state timeline does - a state
 * changed from the page's header adds an entry - and only then, so the
 * Measurements card, whose values are worked out from that timeline, reads
 * them again exactly when they can have changed: not when a note is added,
 * a role is assigned or an AI report arrives.
 */
export const getEventMeasurementRefreshKey: (
  timeline: Array<{ _id?: unknown; startsAt?: unknown }>,
) => string = (
  timeline: Array<{ _id?: unknown; startsAt?: unknown }>,
): string => {
  return timeline
    .map((entry: { _id?: unknown; startsAt?: unknown }): string => {
      const startsAt: Date | undefined = readDate(entry.startsAt);

      return `${readId(entry._id) || ""}@${startsAt ? startsAt.getTime() : ""}`;
    })
    .join(",");
};

/*
 * How often a running clock moves: as often as the page's other live
 * durations (LiveDuration), which count in whole minutes too.
 */
export const EVENT_MEASUREMENT_TICK_INTERVAL_IN_MS: number = 30 * 1000;

/*
 * The values are worked out on the server after a state change has been
 * saved, not before, so a read made the moment the page refreshes can still
 * find the old ones. One more read this long after a refresh picks up what
 * the server wrote meanwhile.
 */
export const EVENT_MEASUREMENT_SETTLE_DELAY_IN_MS: number = 3 * 1000;
