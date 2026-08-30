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
 * Nothing here calls toLocaleString: a responder reading "Tue, 9:00 AM" on one
 * handset and "9:00" on another cannot compare two screenshots of the same
 * shift, and the format is small enough to write out.
 */

const MILLISECONDS_PER_MINUTE: number = 60 * 1000;
const MILLISECONDS_PER_HOUR: number = 60 * MILLISECONDS_PER_MINUTE;
const MILLISECONDS_PER_DAY: number = 24 * MILLISECONDS_PER_HOUR;

const WEEKDAY_NAMES: Array<string> = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

const MONTH_NAMES: Array<string> = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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

function formatClock(date: Date): string {
  const hours24: number = date.getHours();
  const hours12: number = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes: string = String(date.getMinutes()).padStart(2, "0");
  const meridiem: string = hours24 < 12 ? "AM" : "PM";

  return `${hours12}:${minutes} ${meridiem}`;
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
 * "12 Mar, 9:00 AM" beyond it.
 *
 * The relative day names are what make a handoff readable at a glance - a bare
 * date makes the reader do the arithmetic that the screen exists to do for
 * them - and they stop at a week because "Tue" a fortnight out is a trap.
 */
export function formatShiftTime(
  value: string | null | undefined,
  now: number = Date.now(),
): string | null {
  const timestamp: number | null = toTimestamp(value);

  if (timestamp === null) {
    return null;
  }

  const date: Date = new Date(timestamp);
  const today: Date = new Date(now);
  const clock: string = formatClock(date);

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
    return `${WEEKDAY_NAMES[date.getDay()]} ${clock}`;
  }

  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]}, ${clock}`;
}

/**
 * A shift window as one line: "Today 9:00 AM → Tomorrow 9:00 AM".
 *
 * An open-ended half (a schedule with a start but no computed handoff, which
 * is what a never-ending rotation looks like) renders the half that exists
 * rather than collapsing the whole row.
 */
export function formatShiftWindow(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  now: number = Date.now(),
): string | null {
  const start: string | null = formatShiftTime(startsAt, now);
  const end: string | null = formatShiftTime(endsAt, now);

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
