/*
 * Duration and shift-clock formatting.
 *
 * On-call is the one part of the app where the reader's question is almost
 * never "when did this happen?" but "how long have I got?". `utils/date`
 * answers the first (it only ever looks backwards, and says "3h ago"); these
 * answer the second, and have to stay correct on both sides of now because a
 * handoff that is one minute late still has to render as something other than
 * a blank.
 *
 * Everything here is pure and takes `now` as an argument so a test can pin it.
 *
 * A shift's date and time of day are the phone's, as every other date in the
 * app is (issue #8232): on its 12- or 24-hour clock, in its language, in its
 * zone, written by utils/date - "Today 9:00 AM" on a 12-hour phone, "Today
 * 09:00" on a 24-hour one, "Tue 9:00 AM", "Di., 09:00". They were written by
 * hand on a 12-hour English clock, so that two handsets' screenshots of one
 * shift would read alike; but the same phone then read "09:00" on an
 * incident's Created row and "9:00 AM" on the shift card beside it, and two
 * handsets in two zones never read alike anyway. The app's own words -
 * "Today", "Tomorrow", "Yesterday", "From", "Until" - stay English, as every
 * other word of the app's does.
 */

import {
  writeDateTime,
  writeTimeOfDay,
  writeWeekdayTime,
  type TimeTextOptions,
} from "./date";

const MILLISECONDS_PER_SECOND: number = 1000;
const MILLISECONDS_PER_MINUTE: number = 60 * MILLISECONDS_PER_SECOND;
const MILLISECONDS_PER_HOUR: number = 60 * MILLISECONDS_PER_MINUTE;
const MILLISECONDS_PER_DAY: number = 24 * MILLISECONDS_PER_HOUR;

/**
 * Parses an ISO timestamp into epoch milliseconds, or null when the value is
 * missing or unparseable.
 *
 * The API hands back nulls for every roster field on a schedule that has no
 * layers yet, and a screen that renders "NaNm" for that is worse than one that
 * renders nothing - so every formatter below funnels through this.
 */
export function toTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed: number = new Date(value).getTime();

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A span of time as a responder would say it out loud: "3h 12m", "2d 4h",
 * "45m". Never more than two units, because the third one has never changed
 * anybody's decision.
 *
 * Sub-minute spans are "<1m" rather than "0m": at a handoff boundary the
 * difference between "you have no time left" and "you are already off" is the
 * whole point of the countdown.
 */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return "0m";
  }

  if (milliseconds < MILLISECONDS_PER_MINUTE) {
    return "<1m";
  }

  if (milliseconds < MILLISECONDS_PER_HOUR) {
    return `${Math.floor(milliseconds / MILLISECONDS_PER_MINUTE)}m`;
  }

  if (milliseconds < MILLISECONDS_PER_DAY) {
    const hours: number = Math.floor(milliseconds / MILLISECONDS_PER_HOUR);
    const minutes: number = Math.floor(
      (milliseconds % MILLISECONDS_PER_HOUR) / MILLISECONDS_PER_MINUTE,
    );

    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days: number = Math.floor(milliseconds / MILLISECONDS_PER_DAY);
  const hours: number = Math.floor(
    (milliseconds % MILLISECONDS_PER_DAY) / MILLISECONDS_PER_HOUR,
  );

  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

/**
 * How long something has lasted, down to the second: "54s", "2m 54s",
 * "1h 2m 54s" - and from a day on "2d 4h 12m", where the seconds have stopped
 * meaning anything.
 *
 * formatDuration's two coarse units suit a countdown. A status that is in
 * effect right now counts UP, live, on screen, and a count that only moves
 * once a minute reads as frozen; the finished ones beside it use the same
 * wording so the two can be compared at a glance.
 *
 * Anything under a second - including a negative span, which is a start a
 * little ahead of the handset's clock - is "0s", never a blank or a minus.
 */
export function formatElapsed(milliseconds: number): string {
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds < MILLISECONDS_PER_SECOND
  ) {
    return "0s";
  }

  const days: number = Math.floor(milliseconds / MILLISECONDS_PER_DAY);
  const hours: number = Math.floor(
    (milliseconds % MILLISECONDS_PER_DAY) / MILLISECONDS_PER_HOUR,
  );
  const minutes: number = Math.floor(
    (milliseconds % MILLISECONDS_PER_HOUR) / MILLISECONDS_PER_MINUTE,
  );
  const seconds: number = Math.floor(
    (milliseconds % MILLISECONDS_PER_MINUTE) / MILLISECONDS_PER_SECOND,
  );

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

/**
 * The same span, phrased relative to now: "in 3h 12m", "3h 12m ago", or "now"
 * for anything inside the current minute.
 *
 * Returns null - not a placeholder string - for a missing timestamp, so the
 * caller decides whether to hide the row or say something of its own.
 */
export function formatTimeUntil(
  value: string | null | undefined,
  now: number = Date.now(),
): string | null {
  const timestamp: number | null = toTimestamp(value);

  if (timestamp === null) {
    return null;
  }

  const difference: number = timestamp - now;

  if (Math.abs(difference) < MILLISECONDS_PER_MINUTE) {
    return "now";
  }

  return difference > 0
    ? `in ${formatDuration(difference)}`
    : `${formatDuration(-difference)} ago`;
}

/**
 * Milliseconds from now until `value`, clamped at zero. A shift whose handoff
 * has passed but whose roster has not been recomputed yet reads as "0m left"
 * rather than as a negative countdown running the wrong way.
 */
export function millisecondsUntil(
  value: string | null | undefined,
  now: number = Date.now(),
): number | null {
  const timestamp: number | null = toTimestamp(value);

  if (timestamp === null) {
    return null;
  }

  return Math.max(0, timestamp - now);
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * A wall-clock stamp anchored to the reader's day: "Today 9:00 AM",
 * "Tomorrow 9:00 AM", "Tue 9:00 AM" inside the coming week, and
 * "Mar 12, 9:00 AM" beyond it - on a 24-hour phone "Today 09:00", "Tue
 * 09:00" and "Mar 12, 09:00", and the weekday, the date and the time of day
 * in the phone's language ("Di., 09:00", "12. März, 09:00").
 *
 * The relative day names are what make a handoff readable at a glance - a bare
 * date makes the reader do the arithmetic that the screen exists to do for
 * them - and they stop at a week because "Tue" a fortnight out is a trap.
 *
 * `options.locale` is the phone's own when undefined; tests name one.
 */
export function formatShiftTime(
  value: string | null | undefined,
  now: number = Date.now(),
  options: TimeTextOptions = {},
): string | null {
  const timestamp: number | null = toTimestamp(value);

  if (timestamp === null) {
    return null;
  }

  const date: Date = new Date(timestamp);
  const today: Date = new Date(now);
  // The locale only: the day words below are decided on the phone's own calendar.
  const clock: string = writeTimeOfDay(date, { locale: options.locale });

  if (isSameCalendarDay(date, today)) {
    return `Today ${clock}`;
  }

  const tomorrow: Date = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isSameCalendarDay(date, tomorrow)) {
    return `Tomorrow ${clock}`;
  }

  const yesterday: Date = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameCalendarDay(date, yesterday)) {
    return `Yesterday ${clock}`;
  }

  const differenceInDays: number = (timestamp - now) / MILLISECONDS_PER_DAY;

  if (differenceInDays > 0 && differenceInDays < 7) {
    return writeWeekdayTime(date, { locale: options.locale });
  }

  return writeDateTime(date, { showYear: false, locale: options.locale });
}

/**
 * A shift window as one line: "Today 9:00 AM → Tomorrow 9:00 AM", or on a
 * 24-hour phone "Today 09:00 → Tomorrow 09:00".
 *
 * An open-ended half (a schedule with a start but no computed handoff, which
 * is what a never-ending rotation looks like) renders the half that exists
 * rather than collapsing the whole row.
 */
export function formatShiftWindow(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  now: number = Date.now(),
  options: TimeTextOptions = {},
): string | null {
  const start: string | null = formatShiftTime(startsAt, now, options);
  const end: string | null = formatShiftTime(endsAt, now, options);

  if (start && end) {
    return `${start} → ${end}`;
  }

  if (start) {
    return `From ${start}`;
  }

  if (end) {
    return `Until ${end}`;
  }

  return null;
}
