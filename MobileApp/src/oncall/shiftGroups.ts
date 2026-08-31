import type { MyOnCallShift } from "../api/types";
import type { CreateOnCallOverrideParams } from "../navigation/types";
import { MONTH_NAMES, WEEKDAY_NAMES } from "../utils/duration";

/*
 * The "Your shifts" list, as the server materializes it.
 *
 * `/my-shifts` returns every shift in a window, which is a different beast
 * from the roster-derived "current and next per schedule" the tab started
 * with: a fortnight of a daily rotation is fourteen rows, and fourteen rows
 * with a date on each is a wall. Grouping by day is what makes it readable -
 * the reader scans "Today", "Tomorrow", "Thu 12 Sep" and stops at the one
 * they were looking for.
 *
 * All of it is pure and takes `now` as an argument so a test can pin it.
 */

const MILLISECONDS_PER_DAY: number = 24 * 60 * 60 * 1000;

export interface ShiftDayGroup {
  /* Local calendar day, "YYYY-MM-DD"; stable across re-renders. */
  key: string;

  /* "Today", "Tomorrow", or "Thu 12 Sep". */
  label: string;

  shifts: MyOnCallShift[];
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function startOfLocalDay(timestamp: number): Date {
  const date: Date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

/**
 * "Today", "Tomorrow", otherwise "Thu 12 Sep". The weekday is kept even far
 * out because a shift list is read against a week, not against a date.
 */
export function dayLabel(date: Date, now: number): string {
  const day: Date = startOfLocalDay(date.getTime());
  const today: Date = startOfLocalDay(now);

  const differenceInDays: number = Math.round(
    (day.getTime() - today.getTime()) / MILLISECONDS_PER_DAY,
  );

  if (differenceInDays === 0) {
    return "Today";
  }

  if (differenceInDays === 1) {
    return "Tomorrow";
  }

  if (differenceInDays === -1) {
    return "Yesterday";
  }

  return `${WEEKDAY_NAMES[day.getDay()]} ${day.getDate()} ${
    MONTH_NAMES[day.getMonth()]
  }`;
}

export function toTimestamp(value: string): number {
  return new Date(value).getTime();
}

export function isShiftActive(shift: MyOnCallShift, now: number): boolean {
  return toTimestamp(shift.start) <= now && toTimestamp(shift.end) > now;
}

export function hasShiftEnded(shift: MyOnCallShift, now: number): boolean {
  return toTimestamp(shift.end) <= now;
}

/**
 * The day a shift is listed under.
 *
 * A shift that started yesterday and is still running belongs under "Today":
 * the reader wants to know what is on NOW, and filing it under a day that has
 * passed makes an active shift look like history. Ended shifts keep their
 * real day.
 */
export function anchorDay(shift: MyOnCallShift, now: number): Date {
  const start: number = toTimestamp(shift.start);

  if (isShiftActive(shift, now)) {
    return startOfLocalDay(now);
  }

  return startOfLocalDay(start);
}

function compareShifts(a: MyOnCallShift, b: MyOnCallShift): number {
  const byStart: number = toTimestamp(a.start) - toTimestamp(b.start);

  if (byStart !== 0) {
    return byStart;
  }

  const bySchedule: number = a.scheduleName.localeCompare(b.scheduleName);

  if (bySchedule !== 0) {
    return bySchedule;
  }

  return a.shiftKey.localeCompare(b.shiftKey);
}

/**
 * Shifts sorted by start and bucketed by the local day they are listed under,
 * groups in day order. Duplicate keys (the same shift reported twice) are
 * collapsed so a retry that returned overlapping windows cannot double a row.
 */
export function groupShiftsByDay(
  shifts: MyOnCallShift[],
  now: number,
): ShiftDayGroup[] {
  const seen: Set<string> = new Set<string>();
  const groups: Map<string, ShiftDayGroup> = new Map<string, ShiftDayGroup>();

  [...shifts].sort(compareShifts).forEach((shift: MyOnCallShift) => {
    if (seen.has(shift.shiftKey)) {
      return;
    }

    seen.add(shift.shiftKey);

    const day: Date = anchorDay(shift, now);
    const key: string = dayKey(day);

    const existing: ShiftDayGroup | undefined = groups.get(key);

    if (existing) {
      existing.shifts.push(shift);
      return;
    }

    groups.set(key, {
      key,
      label: dayLabel(day, now),
      shifts: [shift],
    });
  });

  return [...groups.values()].sort((a: ShiftDayGroup, b: ShiftDayGroup) => {
    return a.key.localeCompare(b.key);
  });
}

/**
 * True when this shift is one the user holds on somebody else's behalf. The
 * server only attaches `override` to shifts an override produced, and an
 * override never routes a person to themself, so presence is the whole test.
 */
export function isCoveringShift(shift: MyOnCallShift): boolean {
  return Boolean(shift.override);
}

/** "Covering for Priya Rao", or null for the user's own shift. */
export function describeCovering(shift: MyOnCallShift): string | null {
  if (!shift.override) {
    return null;
  }

  return `Covering for ${shift.override.originalUserName}`;
}

/** "Only for Database policy", or null for a shift that applies everywhere. */
export function describePolicyVariant(shift: MyOnCallShift): string | null {
  if (!shift.policyVariantOf) {
    return null;
  }

  return `Only for ${shift.policyVariantOf.policyName}`;
}

/**
 * Whether "Get cover" makes sense for a shift.
 *
 * Not for a shift that has ended, obviously. And not for a shift the user is
 * already covering for somebody else: an override on top of an override is
 * not something the server resolves as a chain, so offering it would create a
 * record that changes nothing and looks like it did.
 */
export function canRequestCover(shift: MyOnCallShift, now: number): boolean {
  if (hasShiftEnded(shift, now)) {
    return false;
  }

  return !isCoveringShift(shift);
}

/**
 * The params handed to the override sheet so it opens already knowing which
 * project, which schedule and which window to cover. A policy-variant shift
 * carries its policy: it only exists inside that policy, so the cover for it
 * has to be scoped the same way or it would not apply.
 */
export function buildCoverParams(
  shift: MyOnCallShift,
): CreateOnCallOverrideParams {
  const params: CreateOnCallOverrideParams = {
    projectId: shift.projectId,
    scheduleId: shift.scheduleId,
    scheduleName: shift.scheduleName,
    startsAt: shift.start,
    endsAt: shift.end,
  };

  if (shift.policyVariantOf) {
    params.policyId = shift.policyVariantOf.policyId;
  }

  return params;
}
