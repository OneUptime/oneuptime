import DayOfWeek, { DayOfWeekUtil } from "../Day/DayOfWeek";
import moment from "moment-timezone";

/*
 * WHEN AN OFF-HOURS SCHEDULE'S RESOURCES RUN (#11010).
 *
 * A schedule (CloudOffHoursSchedule) says the days its resources run and
 * the hours on them - "Monday to Friday, 08:00 to 19:00" - in a time zone.
 * Inside those hours its resources run; outside them, they are stopped.
 * The hours are read on the zone's own clock, never by adding minutes, so
 * 08:00 is 08:00 on the morning after the clocks change too. Hours that
 * end before they start run overnight: a night shift's 20:00 to 06:00
 * belongs to the day it starts on.
 *
 * Pure, so the worker that stops and starts (CloudOffHoursScheduler), the
 * server that checks a schedule as it is saved and the Dashboard that says
 * when its resources next stop read it alike.
 */

// The days resources run on, as a new schedule starts.
export const CLOUD_OFF_HOURS_DEFAULT_DAYS: ReadonlyArray<DayOfWeek> = [
  DayOfWeek.Monday,
  DayOfWeek.Tuesday,
  DayOfWeek.Wednesday,
  DayOfWeek.Thursday,
  DayOfWeek.Friday,
];

export const CLOUD_OFF_HOURS_DEFAULT_START: string = "08:00";
export const CLOUD_OFF_HOURS_DEFAULT_STOP: string = "19:00";

// The week in the order a person reads it, Monday first.
export const CLOUD_OFF_HOURS_WEEK: ReadonlyArray<DayOfWeek> = [
  DayOfWeek.Monday,
  DayOfWeek.Tuesday,
  DayOfWeek.Wednesday,
  DayOfWeek.Thursday,
  DayOfWeek.Friday,
  DayOfWeek.Saturday,
  DayOfWeek.Sunday,
];

const CLOCK: RegExp = /^([01]\d|2[0-3]):([0-5]\d)$/;

// "08:00" as minutes after midnight, or null when it is not one.
export function readCloudOffHoursClock(value: unknown): number | null {
  const match: RegExpMatchArray | null =
    typeof value === "string" ? value.trim().match(CLOCK) : null;

  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function isCloudOffHoursDay(value: unknown): value is DayOfWeek {
  return (
    typeof value === "string" &&
    (CLOUD_OFF_HOURS_WEEK as ReadonlyArray<string>).includes(value)
  );
}

// The days a schedule's resources run on: the ones it names, else the default.
export function readCloudOffHoursDays(value: unknown): Array<DayOfWeek> {
  const days: Array<DayOfWeek> = Array.isArray(value)
    ? value.filter(isCloudOffHoursDay)
    : [];

  return days.length > 0 ? days : [...CLOUD_OFF_HOURS_DEFAULT_DAYS];
}

export function isKnownCloudOffHoursTimezone(value: unknown): boolean {
  return typeof value === "string" && Boolean(moment.tz.zone(value.trim()));
}

export interface CloudOffHoursHours {
  timezone: string;
  workingDays: Array<DayOfWeek> | Array<string> | undefined | null;
  startTime: string;
  stopTime: string;
}

/*
 * Whether resources run at a moment: inside the hours of a working day,
 * on the zone's clock. A window that runs overnight belongs to the day it
 * starts, so 02:00 on a Saturday is inside Friday's 20:00 to 06:00.
 */
export function isWithinCloudWorkingHours(
  hours: CloudOffHoursHours,
  now: Date,
): boolean {
  const start: number | null = readCloudOffHoursClock(hours.startTime);
  const stop: number | null = readCloudOffHoursClock(hours.stopTime);

  // Hours that do not read run all the time: a schedule never stops on a typo.
  if (
    start === null ||
    stop === null ||
    start === stop ||
    !isKnownCloudOffHoursTimezone(hours.timezone)
  ) {
    return true;
  }

  const clock: moment.Moment = moment.tz(now, hours.timezone.trim());
  const minute: number = clock.hours() * 60 + clock.minutes();
  const days: Array<number> = readCloudOffHoursDays(hours.workingDays).map(
    (day: DayOfWeek): number => {
      return DayOfWeekUtil.getNumberOfDayOfWeek(day);
    },
  );
  const today: number = clock.day();
  const yesterday: number = (today + 6) % 7;

  if (start < stop) {
    return days.includes(today) && minute >= start && minute < stop;
  }

  // Overnight: today's evening, or the morning after yesterday's start.
  return (
    (days.includes(today) && minute >= start) ||
    (days.includes(yesterday) && minute < stop)
  );
}

/*
 * When the resources next change, from a moment: the next stop while they
 * run, the next start while they are stopped. A change can only come at a
 * start or a stop time, so those of the next eight days are tried in
 * order, each on the zone's clock. Null for hours that never change.
 */
export function getNextCloudOffHoursChange(
  hours: CloudOffHoursHours,
  now: Date,
): { at: Date; running: boolean } | null {
  const start: number | null = readCloudOffHoursClock(hours.startTime);
  const stop: number | null = readCloudOffHoursClock(hours.stopTime);

  if (
    start === null ||
    stop === null ||
    start === stop ||
    !isKnownCloudOffHoursTimezone(hours.timezone)
  ) {
    return null;
  }

  const timezone: string = hours.timezone.trim();
  const running: boolean = isWithinCloudWorkingHours(hours, now);
  const today: moment.Moment = moment.tz(now, timezone).startOf("day");
  const candidates: Array<Date> = [];

  for (let day: number = 0; day <= 8; day++) {
    const date: moment.Moment = today.clone().add(day, "days");

    for (const minuteOfDay of [start, stop]) {
      const at: Date = moment
        .tz(
          {
            year: date.year(),
            month: date.month(),
            date: date.date(),
            hour: Math.floor(minuteOfDay / 60),
            minute: minuteOfDay % 60,
          },
          timezone,
        )
        .toDate();

      if (at.getTime() > now.getTime()) {
        candidates.push(at);
      }
    }
  }

  candidates.sort((a: Date, b: Date): number => {
    return a.getTime() - b.getTime();
  });

  for (const at of candidates) {
    if (isWithinCloudWorkingHours(hours, at) !== running) {
      return { at, running: !running };
    }
  }

  return null;
}

// Why a schedule cannot be saved like this, or null when it can.
export function getCloudOffHoursScheduleProblem(values: {
  timezone?: unknown;
  workingDays?: unknown;
  startTime?: unknown;
  stopTime?: unknown;
  tagKey?: unknown;
  tagValue?: unknown;
}): string | null {
  if (
    values.timezone !== undefined &&
    !isKnownCloudOffHoursTimezone(values.timezone)
  ) {
    return "Choose the time zone the working hours are in, such as Europe/Berlin.";
  }

  for (const [value, what] of [
    [values.startTime, "start"],
    [values.stopTime, "stop"],
  ] as Array<[unknown, string]>) {
    if (value !== undefined && readCloudOffHoursClock(value) === null) {
      return `Write the ${what} time on a 24-hour clock, such as ${
        what === "start" ? "08:00" : "19:00"
      }.`;
    }
  }

  if (
    values.startTime !== undefined &&
    values.stopTime !== undefined &&
    readCloudOffHoursClock(values.startTime) ===
      readCloudOffHoursClock(values.stopTime)
  ) {
    return "Resources must stop at a different time than they start.";
  }

  if (values.workingDays !== undefined && values.workingDays !== null) {
    if (
      !Array.isArray(values.workingDays) ||
      values.workingDays.length === 0 ||
      values.workingDays.length > 7 ||
      !values.workingDays.every(isCloudOffHoursDay)
    ) {
      return "Pick the days resources run, from Monday to Sunday.";
    }
  }

  for (const [value, what, max] of [
    [values.tagKey, "tag key", 128],
    [values.tagValue, "tag value", 256],
  ] as Array<[unknown, string, number]>) {
    if (value === undefined) {
      continue;
    }

    if (typeof value !== "string" || !value.trim() || value.length > max) {
      return `Write the ${what} that picks the resources, at most ${max} characters.`;
    }
  }

  return null;
}
