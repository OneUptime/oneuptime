import OnCallDutyPolicyScheduleLayer from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import DayOfWeek, { DayOfWeekUtil } from "../Day/DayOfWeek";
import EventInterval from "../Events/EventInterval";
import Recurring from "../Events/Recurring";
import ObjectID from "../ObjectID";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../OnCallDutyPolicy/RestrictionTimes";
import { buildNewScheduleLayer } from "../OnCallDutyPolicy/ScheduleLayerDefaults";
import PositiveNumber from "../PositiveNumber";
import Timezone from "../Timezone";
import TimezoneAlias from "../TimezoneAlias";
import { TOOL_IMPORT_MAX_LAYERS_PER_SCHEDULE } from "./ToolImportLimits";
import {
  ImportedRestriction,
  ImportedRotation,
  ImportedWeeklyWindow,
} from "./ToolImportSnapshot";
import moment from "moment-timezone";

/*
 * HOW A ROTATION OF ANOTHER TOOL BECOMES A ONEUPTIME SCHEDULE LAYER.
 *
 * Shared by the preview (how many schedules and layers a schedule becomes)
 * and the import (the layers it creates), so the two always agree.
 *
 * The one real difference between the tools: in Opsgenie and incident.io
 * every rotation of a schedule is on call at the same time - two rotations
 * whose hours overlap page two people. A OneUptime schedule has one person
 * on call at a time: where its layers overlap, the first layer wins. So the
 * rotations of a schedule are put into as few OneUptime schedules as keeps
 * that true - rotations whose hours never meet (business hours and after
 * hours) share one schedule as its layers; rotations that are on call
 * together go into schedules of their own, and every policy that paged the
 * schedule pages all of them. Nobody who was paged before stops being
 * paged.
 */

export const MINUTES_PER_DAY: number = 24 * 60;
export const MINUTES_PER_WEEK: number = 7 * MINUTES_PER_DAY;

const TIME_OF_DAY_PATTERN: RegExp = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/*
 * Minutes since midnight for "HH:MM" (seconds are ignored). "24:00" is the
 * end of the day. Null for anything else.
 */
export function parseTimeOfDay(text: string): number | null {
  const match: RegExpExecArray | null = TIME_OF_DAY_PATTERN.exec(
    (text || "").trim(),
  );

  if (!match) {
    return null;
  }

  const hours: number = Number(match[1]);
  const minutes: number = Number(match[2]);

  if (hours === 24 && minutes === 0) {
    return MINUTES_PER_DAY;
  }

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

// "HH:MM" for minutes since midnight (0-1440, 1440 is "24:00").
export function formatTimeOfDay(minutesOfDay: number): string {
  const clamped: number = Math.max(
    0,
    Math.min(MINUTES_PER_DAY, Math.round(minutesOfDay)),
  );
  const hours: number = Math.floor(clamped / 60);
  const minutes: number = clamped % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// "HH:MM" from hour and minute numbers, or null when they are not a time.
export function toTimeOfDay(hours: unknown, minutes: unknown): string | null {
  const hour: number = Number(hours);
  const minute: number = Number(minutes ?? 0);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    minute < 0 ||
    minute > 59 ||
    hour > 24 ||
    (hour === 24 && minute !== 0)
  ) {
    return null;
  }

  return formatTimeOfDay(hour * 60 + minute);
}

const DAY_BY_NAME: Record<string, DayOfWeek> = {
  sunday: DayOfWeek.Sunday,
  monday: DayOfWeek.Monday,
  tuesday: DayOfWeek.Tuesday,
  wednesday: DayOfWeek.Wednesday,
  thursday: DayOfWeek.Thursday,
  friday: DayOfWeek.Friday,
  saturday: DayOfWeek.Saturday,
};

// A day of the week by its English name, any case ("monday", "Monday").
export function toDayOfWeek(name: unknown): DayOfWeek | null {
  if (typeof name !== "string") {
    return null;
  }

  return DAY_BY_NAME[name.trim().toLowerCase()] || null;
}

const DAYS_IN_ORDER: Array<DayOfWeek> = [
  DayOfWeek.Sunday,
  DayOfWeek.Monday,
  DayOfWeek.Tuesday,
  DayOfWeek.Wednesday,
  DayOfWeek.Thursday,
  DayOfWeek.Friday,
  DayOfWeek.Saturday,
];

export function getNextDayOfWeek(day: DayOfWeek): DayOfWeek {
  return DAYS_IN_ORDER[(DayOfWeekUtil.getNumberOfDayOfWeek(day) + 1) % 7]!;
}

/*
 * The time zone OneUptime knows a tool's zone as - its current name for a
 * legacy one ("US/Pacific" is America/Los_Angeles) - or null when OneUptime
 * does not know it.
 */
export function resolveImportedTimezone(name: string): Timezone | null {
  if (typeof name !== "string" || !name.trim()) {
    return null;
  }

  const canonical: Timezone = TimezoneAlias.getCanonicalTimezone(name.trim());

  return (Object.values(Timezone) as Array<string>).includes(canonical)
    ? canonical
    : null;
}

/*
 * Every minute of the week (Sunday 00:00 in the schedule's time zone is
 * minute 0) a rotation's restriction keeps it on call. Wall-clock minutes,
 * so a daylight saving change does not move them: both tools keep their
 * restrictions in wall-clock time too.
 */
export function getRestrictionCoverage(
  restriction: ImportedRestriction | null,
): Uint8Array {
  const coverage: Uint8Array = new Uint8Array(MINUTES_PER_WEEK);

  const cover: (from: number, to: number) => void = (
    from: number,
    to: number,
  ): void => {
    for (let minute: number = from; minute < to; minute++) {
      coverage[((minute % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK] =
        1;
    }
  };

  if (!restriction) {
    coverage.fill(1);
    return coverage;
  }

  if (restriction.type === "Daily") {
    const start: number | null = parseTimeOfDay(restriction.startTime);
    const end: number | null = parseTimeOfDay(restriction.endTime);

    if (start === null || end === null || start === end % MINUTES_PER_DAY) {
      coverage.fill(1);
      return coverage;
    }

    for (let day: number = 0; day < 7; day++) {
      const dayStart: number = day * MINUTES_PER_DAY;

      if (start < end) {
        cover(dayStart + start, dayStart + end);
      } else {
        // Overnight: from the start to midnight, and from midnight to the end.
        cover(dayStart + start, dayStart + MINUTES_PER_DAY);
        cover(dayStart, dayStart + end);
      }
    }

    return coverage;
  }

  for (const window of restriction.windows) {
    const start: number | null = getMinuteOfWeek(
      window.startDay,
      window.startTime,
    );
    const end: number | null = getMinuteOfWeek(window.endDay, window.endTime);

    if (start === null || end === null) {
      continue;
    }

    if (end > start) {
      cover(start, end);
    } else if (end < start) {
      // Across the end of the week (Friday evening to Monday morning).
      cover(start, MINUTES_PER_WEEK);
      cover(0, end);
    } else {
      // A window that ends where it starts is the whole week.
      coverage.fill(1);
    }
  }

  return coverage;
}

function getMinuteOfWeek(day: DayOfWeek, time: string): number | null {
  const minutes: number | null = parseTimeOfDay(time);

  if (minutes === null) {
    return null;
  }

  return DayOfWeekUtil.getNumberOfDayOfWeek(day) * MINUTES_PER_DAY + minutes;
}

export function doCoveragesOverlap(
  first: Uint8Array,
  second: Uint8Array,
): boolean {
  for (let minute: number = 0; minute < MINUTES_PER_WEEK; minute++) {
    if (first[minute] && second[minute]) {
      return true;
    }
  }

  return false;
}

/*
 * The OneUptime schedules a schedule's rotations become: each inner list is
 * one schedule's layers, in the rotations' order. A rotation joins the first
 * schedule none of whose layers it is ever on call at the same time as;
 * otherwise it starts a schedule of its own. A schedule holds at most
 * TOOL_IMPORT_MAX_LAYERS_PER_SCHEDULE layers.
 */
export function groupRotationsIntoSchedules(
  rotations: Array<ImportedRotation>,
): Array<Array<ImportedRotation>> {
  const groups: Array<{
    rotations: Array<ImportedRotation>;
    coverage: Uint8Array;
  }> = [];

  for (const rotation of rotations) {
    const coverage: Uint8Array = getRestrictionCoverage(rotation.restriction);

    const group:
      | { rotations: Array<ImportedRotation>; coverage: Uint8Array }
      | undefined = groups.find(
      (candidate: {
        rotations: Array<ImportedRotation>;
        coverage: Uint8Array;
      }): boolean => {
        return (
          candidate.rotations.length < TOOL_IMPORT_MAX_LAYERS_PER_SCHEDULE &&
          !doCoveragesOverlap(candidate.coverage, coverage)
        );
      },
    );

    if (group) {
      group.rotations.push(rotation);

      for (let minute: number = 0; minute < MINUTES_PER_WEEK; minute++) {
        if (coverage[minute]) {
          group.coverage[minute] = 1;
        }
      }
    } else {
      groups.push({ rotations: [rotation], coverage: coverage });
    }
  }

  return groups.map(
    (group: {
      rotations: Array<ImportedRotation>;
      coverage: Uint8Array;
    }): Array<ImportedRotation> => {
      return group.rotations;
    },
  );
}

/*
 * The name of the OneUptime schedule made from one group of a schedule's
 * rotations: the schedule's own name for the first, and the schedule's name
 * with the group's first rotation for each further one, so a person can tell
 * them apart ("Platform (Secondary)").
 */
export function getGroupScheduleName(data: {
  scheduleName: string;
  groupIndex: number;
  group: Array<ImportedRotation>;
  maxLength: number;
}): string {
  if (data.groupIndex === 0) {
    return truncate(data.scheduleName, data.maxLength);
  }

  const rotationName: string =
    data.group[0]?.name?.trim() || `${data.groupIndex + 1}`;
  const suffix: string = ` (${rotationName})`;

  return (
    truncate(
      data.scheduleName,
      Math.max(1, data.maxLength - Math.min(suffix.length, data.maxLength - 1)),
    ) + suffix
  ).slice(0, data.maxLength);
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

/*
 * The source id a OneUptime schedule made from a schedule's group is
 * remembered by: the schedule's own id for the first group, and the id with
 * the group's number for each further one, so a second import finds every
 * schedule the first one made.
 */
export function getGroupSourceId(
  scheduleSourceId: string,
  groupIndex: number,
): string {
  return groupIndex === 0
    ? scheduleSourceId
    : `${scheduleSourceId}#${groupIndex + 1}`;
}

export function isGroupSourceIdOf(
  sourceId: string,
  scheduleSourceId: string,
): boolean {
  return (
    sourceId === scheduleSourceId ||
    sourceId.startsWith(`${scheduleSourceId}#`)
  );
}

// A wall-clock time of day in `timezone`, on `day` of the week of `reference`.
function atWallClock(data: {
  reference: Date;
  timezone: string;
  day?: DayOfWeek | undefined;
  minutesOfDay: number;
}): Date {
  let at: moment.Moment = moment.tz(data.reference, data.timezone).set({
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  });

  if (data.day) {
    at = at.day(DayOfWeekUtil.getNumberOfDayOfWeek(data.day));
  }

  /*
   * Added as minutes from midnight rather than set as hour and minute, so
   * "24:00" lands on the next midnight, which is what a window ending at
   * the end of a day means.
   */
  return at.add(data.minutesOfDay, "minutes").toDate();
}

/*
 * OneUptime's restriction for a rotation's restriction, with every time a
 * wall-clock time in the schedule's time zone - which is how the layer
 * engine reads them (Types/OnCallDutyPolicy/Layer.ts reads each time of day,
 * and each weekly window's day, in the schedule's zone).
 *
 * A daily window that starts and ends at the same time is the whole day, so
 * it is no restriction at all (OneUptime refuses a zero-length daily window,
 * which would page nobody).
 */
export function buildRestrictionTimes(data: {
  restriction: ImportedRestriction | null;
  timezone: string;
  reference: Date;
}): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = RestrictionTimes.getDefault();
  const restriction: ImportedRestriction | null = data.restriction;

  if (!restriction) {
    return restrictionTimes;
  }

  if (restriction.type === "Daily") {
    const start: number | null = parseTimeOfDay(restriction.startTime);
    const end: number | null = parseTimeOfDay(restriction.endTime);

    if (start === null || end === null || start === end % MINUTES_PER_DAY) {
      return restrictionTimes;
    }

    restrictionTimes.restictionType = RestrictionType.Daily;
    restrictionTimes.dayRestrictionTimes = {
      startTime: atWallClock({
        reference: data.reference,
        timezone: data.timezone,
        minutesOfDay: start,
      }),
      endTime: atWallClock({
        reference: data.reference,
        timezone: data.timezone,
        minutesOfDay: end % MINUTES_PER_DAY,
      }),
    };
    restrictionTimes.weeklyRestrictionTimes = [];

    return restrictionTimes;
  }

  const windows: Array<WeeklyResctriction> = [];

  for (const window of restriction.windows) {
    const built: WeeklyResctriction | null = buildWeeklyWindow({
      window: window,
      timezone: data.timezone,
      reference: data.reference,
    });

    if (built) {
      windows.push(built);
    }
  }

  if (windows.length === 0) {
    return restrictionTimes;
  }

  restrictionTimes.restictionType = RestrictionType.Weekly;
  restrictionTimes.dayRestrictionTimes = null;
  restrictionTimes.weeklyRestrictionTimes = windows;

  return restrictionTimes;
}

function buildWeeklyWindow(data: {
  window: ImportedWeeklyWindow;
  timezone: string;
  reference: Date;
}): WeeklyResctriction | null {
  const start: number | null = parseTimeOfDay(data.window.startTime);
  const end: number | null = parseTimeOfDay(data.window.endTime);

  if (start === null || end === null) {
    return null;
  }

  /*
   * A window ending at 24:00 ends at midnight of the next day: the engine
   * reads a window's day from its end time, so it is written as 00:00 of
   * that day.
   */
  const endDay: DayOfWeek =
    end === MINUTES_PER_DAY
      ? getNextDayOfWeek(data.window.endDay)
      : data.window.endDay;
  const endMinutes: number = end % MINUTES_PER_DAY;

  return {
    startDay: data.window.startDay,
    endDay: endDay,
    startTime: atWallClock({
      reference: data.reference,
      timezone: data.timezone,
      day: data.window.startDay,
      minutesOfDay: start,
    }),
    endTime: atWallClock({
      reference: data.reference,
      timezone: data.timezone,
      day: endDay,
      minutesOfDay: endMinutes,
    }),
  };
}

export function buildImportedRotationRecurring(
  rotation: Pick<ImportedRotation, "intervalType" | "intervalCount">,
): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = rotation.intervalType;
  recurring.intervalCount = new PositiveNumber(
    Math.max(1, Math.floor(rotation.intervalCount) || 1),
  );
  return recurring;
}

/*
 * The OneUptime layer a rotation becomes, ready to create: it starts when
 * the rotation started (so the same person is on call now as in the other
 * tool), hands off one turn later in the schedule's time zone, and keeps the
 * rotation's restriction.
 */
export function buildLayerFromImportedRotation(data: {
  rotation: ImportedRotation;
  scheduleId: ObjectID;
  projectId: ObjectID;
  name: string;
  order: number;
  timezone: string;
  reference: Date;
}): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer = buildNewScheduleLayer({
    onCallDutyPolicyScheduleId: data.scheduleId,
    projectId: data.projectId,
    name: data.name,
    order: data.order,
    rotation: buildImportedRotationRecurring(data.rotation),
    startsAt: new Date(data.rotation.startsAt),
    timezone: data.timezone,
  });

  layer.restrictionTimes = buildRestrictionTimes({
    restriction: data.rotation.restriction,
    timezone: data.timezone,
    reference: data.reference,
  });

  return layer;
}

/*
 * The people of one of several people on call at once from one list, in
 * the order they take turns: on turn t, the k-th of n people on call is
 * the person at (t * n + k) in the list, going round it. Each layer comes
 * back as the order it cycles through; a layer that would only repeat an
 * earlier one (more people on call at once than in the list) is empty.
 */
export function getConcurrentLayerOrder(data: {
  people: Array<string>;
  layerCount: number;
  layerIndex: number;
}): Array<string> {
  const people: Array<string> = data.people;
  const count: number = Math.max(1, Math.floor(data.layerCount));

  if (people.length === 0 || data.layerIndex >= people.length) {
    return [];
  }

  const turns: number = people.length / greatestCommonDivisor(people.length, count);
  const order: Array<string> = [];

  for (let turn: number = 0; turn < turns; turn++) {
    order.push(people[(turn * count + data.layerIndex) % people.length]!);
  }

  return order;
}

function greatestCommonDivisor(first: number, second: number): number {
  let a: number = Math.abs(first);
  let b: number = Math.abs(second);

  while (b) {
    const remainder: number = a % b;
    a = b;
    b = remainder;
  }

  return a || 1;
}

/*
 * The interval OneUptime rotates at for a tool's "hourly" / "daily" /
 * "weekly", or null for anything else.
 */
export function toEventInterval(value: unknown): EventInterval | null {
  switch (typeof value === "string" ? value.trim().toLowerCase() : "") {
    case "hourly":
    case "hour":
      return EventInterval.Hour;
    case "daily":
    case "day":
      return EventInterval.Day;
    case "weekly":
    case "week":
      return EventInterval.Week;
    default:
      return null;
  }
}
