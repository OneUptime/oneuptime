import OneUptimeDate from "../Date";
import { JSONObject } from "../JSON";

/*
 * When a new scheduled maintenance event starts and ends, before anyone says.
 *
 * Scheduling maintenance asked for both times with nothing filled in, so the
 * first thing the form did was make people open two date pickers. The
 * maintainer: "reduce decision / choice paralysis as much as possible ...
 * and have sane defaults". So a new event starts at the next full hour of
 * the reader's clock and lasts an hour - what a calendar offers for a new
 * meeting - and the times are changed only when they are wrong.
 *
 * Moving the start keeps the window as long as it was: the end moves with
 * it, the way a calendar moves a meeting, so pushing the event to tomorrow
 * does not leave it ending today. And the end has to come after the start.
 *
 * React-free: the dashboard's forms and their tests read it, and anything
 * else that asks for a maintenance window can.
 */

// How long a new event lasts unless someone says otherwise.
export const DEFAULT_MAINTENANCE_DURATION_IN_MINUTES: number = 60;

export interface MaintenanceWindow {
  startsAt: Date;
  endsAt: Date;
}

/*
 * A form holds a date as a Date, as the ISO string the date input writes, or
 * as nothing at all (a cleared input writes ""). Anything that is not a
 * real instant is null.
 */
export const toMaintenanceDate: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (
    !(value instanceof Date) &&
    typeof value !== "string" &&
    typeof value !== "object"
  ) {
    return null;
  }

  let date: Date;

  try {
    date = OneUptimeDate.fromString(value as string | JSONObject | Date);
  } catch {
    return null;
  }

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
};

/*
 * The first full hour after `now` on the reader's clock: 10:00 at 09:20, and
 * 11:00 at exactly 10:00. Worked out in their timezone, so it is a full hour
 * there too - in India (UTC+5:30) the next full hour is not the next full
 * hour in UTC.
 */
export const getNextFullHour: (
  now: Date,
  timezone?: string | undefined,
) => Date = (now: Date, timezone?: string | undefined): Date => {
  const startOfThisHour: Date = OneUptimeDate.getStartOfCalendarUnit(
    now,
    "hour",
    timezone,
  );

  return OneUptimeDate.addRemoveHours(startOfThisHour, 1);
};

// A new event's end: an hour after it starts.
export const getDefaultMaintenanceEnd: (startsAt: Date) => Date = (
  startsAt: Date,
): Date => {
  return OneUptimeDate.addRemoveMinutes(
    startsAt,
    DEFAULT_MAINTENANCE_DURATION_IN_MINUTES,
  );
};

// The window a new event starts with: the next full hour, for an hour.
export const getDefaultMaintenanceWindow: (data: {
  now: Date;
  timezone?: string | undefined;
}) => MaintenanceWindow = (data: {
  now: Date;
  timezone?: string | undefined;
}): MaintenanceWindow => {
  const startsAt: Date = getNextFullHour(data.now, data.timezone);

  return {
    startsAt: startsAt,
    endsAt: getDefaultMaintenanceEnd(startsAt),
  };
};

/*
 * Where the end goes when the start moves: as far after the new start as it
 * was after the old one. Null - leave the end where it is - when any of the
 * three is not a real time yet (the input is half typed, or was cleared),
 * when the start did not move, and when the window was not in order to
 * begin with: there is no length to keep, and the form says what is wrong.
 */
export const getMaintenanceEndAfterStartMoved: (data: {
  previousStartsAt: unknown;
  previousEndsAt: unknown;
  nextStartsAt: unknown;
}) => Date | null = (data: {
  previousStartsAt: unknown;
  previousEndsAt: unknown;
  nextStartsAt: unknown;
}): Date | null => {
  const previousStartsAt: Date | null = toMaintenanceDate(
    data.previousStartsAt,
  );
  const previousEndsAt: Date | null = toMaintenanceDate(data.previousEndsAt);
  const nextStartsAt: Date | null = toMaintenanceDate(data.nextStartsAt);

  if (!previousStartsAt || !previousEndsAt || !nextStartsAt) {
    return null;
  }

  const lengthInMs: number = previousEndsAt.getTime() - previousStartsAt.getTime();

  if (lengthInMs <= 0) {
    return null;
  }

  if (nextStartsAt.getTime() === previousStartsAt.getTime()) {
    return null;
  }

  return new Date(nextStartsAt.getTime() + lengthInMs);
};

/*
 * Whether the event ends after it starts. A time that is not filled in yet
 * is not this check's business (the field is required on its own), so a
 * window with a missing end or start is not called out of order.
 */
export const isMaintenanceWindowInOrder: (data: {
  startsAt: unknown;
  endsAt: unknown;
}) => boolean = (data: { startsAt: unknown; endsAt: unknown }): boolean => {
  const startsAt: Date | null = toMaintenanceDate(data.startsAt);
  const endsAt: Date | null = toMaintenanceDate(data.endsAt);

  if (!startsAt || !endsAt) {
    return true;
  }

  return endsAt.getTime() > startsAt.getTime();
};
