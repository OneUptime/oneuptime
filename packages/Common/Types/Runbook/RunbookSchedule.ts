import CronTab, {
  CronExpressionFields,
  CronFieldValues,
} from "../../Utils/CronTab";
import moment from "moment-timezone";

/*
 * WHEN A RUNBOOK RUNS ON ITS OWN.
 *
 * A runbook's schedule is a five-field cron expression read on the wall
 * clock of a time zone (Runbook.scheduleCron, Runbook.scheduleTimezone).
 * The cron is the one thing stored, so the API, Terraform and the scheduler
 * all read the same value, and it is what an expert types.
 *
 * Most people never type one: the schedule dialog offers five plain choices
 * (RunbookScheduleRepeat) - every few minutes, every few hours, every day at
 * a time, on chosen days of the week at a time, or a cron of your own - and
 * turns the choice into the cron (getRunbookScheduleCron). Opening the
 * dialog again turns the cron back into the choice it came from
 * (getRunbookScheduleChoice); a cron no choice writes opens as Cron.
 *
 * The next runs are worked out on the zone's own clock (getNextRunbookRun),
 * so a 09:00 schedule runs at 09:00 there all year, through daylight saving
 * time changes, the way cron itself treats them:
 *
 *   - a time the clocks skip (02:30 in Berlin on the night they go forward)
 *     runs once, as late as the jump made it: 03:30;
 *   - a time the clocks pass twice (02:30 in Berlin on the night they go
 *     back) runs once, the first time;
 *   - a schedule that runs every hour - every few minutes, or every hour at
 *     some minute - keeps running through the repeated hour, each time it
 *     comes round, so a run every 15 minutes does not stop for an hour.
 *
 * Pure and synchronous, in Common/Types so the dialog's preview of the next
 * runs and the Worker that starts them (RunbookScheduler) work them out the
 * same way.
 */

// What the schedule dialog offers, in the order it offers them.
export enum RunbookScheduleRepeat {
  Minutes = "Minutes",
  Hours = "Hours",
  Daily = "Daily",
  Weekly = "Weekly",
  Cron = "Cron",
}

export const RUNBOOK_SCHEDULE_REPEATS: ReadonlyArray<RunbookScheduleRepeat> = [
  RunbookScheduleRepeat.Minutes,
  RunbookScheduleRepeat.Hours,
  RunbookScheduleRepeat.Daily,
  RunbookScheduleRepeat.Weekly,
  RunbookScheduleRepeat.Cron,
];

/*
 * When a scheduled time comes round while a run of the runbook is still
 * going - running, queued, or waiting for someone to complete or approve a
 * step:
 *
 *   - Skip: no run for that time. The next scheduled time is the next
 *     chance. The default: two copies of a remediation working on the same
 *     system at once is rarely wanted, and a run waiting for a person should
 *     not pile up behind it a copy for every time it waited through;
 *   - RunAfter: one run waits, and starts as soon as the run in progress
 *     ends. Never more than one: a schedule that keeps coming round while a
 *     run is still going does not build a queue.
 */
export enum RunbookScheduleOverlapPolicy {
  Skip = "Skip",
  RunAfter = "RunAfter",
}

export const DEFAULT_RUNBOOK_SCHEDULE_OVERLAP_POLICY: RunbookScheduleOverlapPolicy =
  RunbookScheduleOverlapPolicy.Skip;

/*
 * When OneUptime could not start a scheduled run on time - it was down, or
 * being upgraded - and comes back after the time has passed:
 *
 *   - RunOnce: one run as soon as it is back, however many times it missed.
 *     The default: a nightly clean-up still happens, once;
 *   - Skip: nothing for the times it missed. The next scheduled time is
 *     the next chance.
 *
 * A time counts as missed once it is RUNBOOK_SCHEDULE_MISSED_RUN_GRACE_IN_MS
 * old. Times that pass while the runbook or its schedule is turned off are
 * not missed: they are skipped, whatever this says.
 */
export enum RunbookScheduleMissedRunPolicy {
  RunOnce = "RunOnce",
  Skip = "Skip",
}

export const DEFAULT_RUNBOOK_SCHEDULE_MISSED_RUN_POLICY: RunbookScheduleMissedRunPolicy =
  RunbookScheduleMissedRunPolicy.RunOnce;

/*
 * How late a scheduled run may start and still count as on time. The Worker
 * looks for due runs once a minute, so a run normally starts within a minute
 * of its time; a busy queue can make that a few.
 */
export const RUNBOOK_SCHEDULE_MISSED_RUN_GRACE_IN_MS: number = 5 * 60 * 1000;

/*
 * "Every N minutes" offers the steps that divide an hour evenly, and "every
 * N hours" the ones that divide a day: a cron step that does not ("every 7
 * minutes") restarts at the top of each hour, so the last gap is short. A
 * cron of your own can still say it.
 */
export const RUNBOOK_SCHEDULE_MINUTE_INTERVALS: ReadonlyArray<number> = [
  1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30,
];

export const RUNBOOK_SCHEDULE_HOUR_INTERVALS: ReadonlyArray<number> = [
  1, 2, 3, 4, 6, 8, 12,
];

// Monday to Friday, and Saturday and Sunday, as cron numbers them.
export const RUNBOOK_SCHEDULE_WEEKDAYS: ReadonlyArray<number> = [1, 2, 3, 4, 5];
export const RUNBOOK_SCHEDULE_WEEKEND_DAYS: ReadonlyArray<number> = [0, 6];

// The order the dialog lists the days in: the week starting on Monday.
export const RUNBOOK_SCHEDULE_DAY_ORDER: ReadonlyArray<number> = [
  1, 2, 3, 4, 5, 6, 0,
];

// A schedule saved with no time zone is read in UTC (an API caller, say).
export const DEFAULT_RUNBOOK_SCHEDULE_TIMEZONE: string = "UTC";

// Longer than any expression a person writes; refuses a pasted essay.
export const RUNBOOK_SCHEDULE_MAX_CRON_LENGTH: number = 100;

/*
 * How far ahead a next run is looked for. A schedule that only matches the
 * 29th of February runs at least once in any eight years (1900 and 2100 are
 * not leap years, so seven is not always enough); one that has no run in
 * that window never runs at all (the 31st of February) and is refused.
 */
const MAX_DAYS_SEARCHED: number = 366 * 8 + 2;

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

// Kiribati's Line Islands, UTC+14, are the furthest ahead any zone is.
const MAX_HOURS_AHEAD_OF_UTC: number = 14;

const WHITESPACE: RegExp = /\s+/;

/*
 * A schedule as the dialog holds it. Every field is kept whatever the
 * choice, so switching from "every day" to "on these days" and back keeps
 * the time.
 */
export interface RunbookScheduleChoice {
  repeat: RunbookScheduleRepeat;
  // Minutes: how many minutes apart. Hours: how many hours apart.
  every: number;
  // Hours: the minute past the hour. Daily and Weekly: the time's minute.
  minute: number;
  // Daily and Weekly: the time's hour, 0 - 23.
  hour: number;
  // Weekly: the days, 0 (Sunday) - 6 (Saturday).
  days: Array<number>;
  // Cron: the expression as typed.
  cron: string;
}

// What a new schedule starts as: every weekday at 09:00.
export const DEFAULT_RUNBOOK_SCHEDULE_CHOICE: RunbookScheduleChoice = {
  repeat: RunbookScheduleRepeat.Weekly,
  every: 15,
  minute: 0,
  hour: 9,
  days: [...RUNBOOK_SCHEDULE_WEEKDAYS],
  cron: "0 9 * * 1,2,3,4,5",
};

export const DEFAULT_RUNBOOK_SCHEDULE_CRON: string =
  DEFAULT_RUNBOOK_SCHEDULE_CHOICE.cron;

// The expression with its fields separated by single spaces.
export function normalizeRunbookScheduleCron(cron: string): string {
  if (typeof cron !== "string") {
    return "";
  }

  return cron
    .trim()
    .split(WHITESPACE)
    .filter((field: string) => {
      return field.length > 0;
    })
    .join(" ");
}

function sortedDays(days: ReadonlyArray<number>): Array<number> {
  return Array.from(new Set(days))
    .filter((day: number) => {
      return Number.isInteger(day) && day >= 0 && day <= 6;
    })
    .sort((a: number, b: number) => {
      return a - b;
    });
}

// The cron a choice stands for.
export function getRunbookScheduleCron(choice: RunbookScheduleChoice): string {
  switch (choice.repeat) {
    case RunbookScheduleRepeat.Minutes:
      return choice.every === 1 ? "* * * * *" : `*/${choice.every} * * * *`;
    case RunbookScheduleRepeat.Hours:
      return choice.every === 1
        ? `${choice.minute} * * * *`
        : `${choice.minute} */${choice.every} * * *`;
    case RunbookScheduleRepeat.Daily:
      return `${choice.minute} ${choice.hour} * * *`;
    case RunbookScheduleRepeat.Weekly:
      return `${choice.minute} ${choice.hour} * * ${sortedDays(choice.days).join(",")}`;
    case RunbookScheduleRepeat.Cron:
    default:
      return normalizeRunbookScheduleCron(choice.cron);
  }
}

/*
 * The step of a field written as "*\/step" (or every value), counted from
 * its first value: null when its values are not evenly spaced from `min` to
 * the end of the range.
 */
function getFieldStep(
  field: CronFieldValues,
  min: number,
  max: number,
): number | null {
  if (field.isWildcard) {
    return 1;
  }

  const values: ReadonlyArray<number> = field.values;

  if (values.length < 2 || values[0] !== min) {
    return null;
  }

  const step: number = values[1]! - values[0]!;

  for (let i: number = 1; i < values.length; i++) {
    if (values[i]! - values[i - 1]! !== step) {
      return null;
    }
  }

  return values[values.length - 1]! + step > max ? step : null;
}

function getSingleValue(field: CronFieldValues): number | null {
  return !field.isWildcard && field.values.length === 1
    ? field.values[0]!
    : null;
}

/*
 * The choice a cron came from: the plain choice that writes the same
 * schedule, or Cron when none does. Never throws; a cron that is not valid
 * opens as Cron too, as typed, so the dialog can say what is wrong with it.
 */
export function getRunbookScheduleChoice(cron: string): RunbookScheduleChoice {
  const expression: string = normalizeRunbookScheduleCron(cron);

  const asCron: RunbookScheduleChoice = {
    ...DEFAULT_RUNBOOK_SCHEDULE_CHOICE,
    days: [...DEFAULT_RUNBOOK_SCHEDULE_CHOICE.days],
    repeat: RunbookScheduleRepeat.Cron,
    cron: expression,
  };

  let fields: CronExpressionFields;

  try {
    fields = CronTab.parseFields(expression);
  } catch {
    return asCron;
  }

  if (
    fields.hasSeconds ||
    !fields.dayOfMonth.isWildcard ||
    !fields.month.isWildcard
  ) {
    return asCron;
  }

  const minute: number | null = getSingleValue(fields.minute);
  const hour: number | null = getSingleValue(fields.hour);

  if (fields.dayOfWeek.isWildcard) {
    if (minute === null) {
      const step: number | null = getFieldStep(fields.minute, 0, 59);

      if (
        fields.hour.isWildcard &&
        step !== null &&
        RUNBOOK_SCHEDULE_MINUTE_INTERVALS.includes(step)
      ) {
        return {
          ...asCron,
          repeat: RunbookScheduleRepeat.Minutes,
          every: step,
        };
      }

      return asCron;
    }

    if (hour !== null) {
      return {
        ...asCron,
        repeat: RunbookScheduleRepeat.Daily,
        minute: minute,
        hour: hour,
      };
    }

    const hourStep: number | null = getFieldStep(fields.hour, 0, 23);

    if (
      hourStep !== null &&
      RUNBOOK_SCHEDULE_HOUR_INTERVALS.includes(hourStep)
    ) {
      return {
        ...asCron,
        repeat: RunbookScheduleRepeat.Hours,
        every: hourStep,
        minute: minute,
      };
    }

    return asCron;
  }

  if (minute !== null && hour !== null) {
    return {
      ...asCron,
      repeat: RunbookScheduleRepeat.Weekly,
      minute: minute,
      hour: hour,
      days: sortedDays(fields.dayOfWeek.values),
    };
  }

  return asCron;
}

export function isValidRunbookScheduleTimezone(timezone: unknown): boolean {
  return (
    typeof timezone === "string" &&
    timezone.trim().length > 0 &&
    Boolean(moment.tz.zone(timezone.trim()))
  );
}

/*
 * What is wrong with a cron as a runbook schedule, in a sentence, or null
 * when nothing is. The server refuses a save with it and the dialog shows it
 * under the field, so both say the same.
 */
export function getRunbookScheduleCronError(cron: unknown): string | null {
  if (typeof cron !== "string" || cron.trim().length === 0) {
    return 'Enter a cron expression, such as "0 9 * * 1-5" (09:00 on weekdays).';
  }

  if (cron.length > RUNBOOK_SCHEDULE_MAX_CRON_LENGTH) {
    return `A cron expression is at most ${RUNBOOK_SCHEDULE_MAX_CRON_LENGTH} characters long.`;
  }

  const expression: string = normalizeRunbookScheduleCron(cron);
  const fieldCount: number = expression.split(" ").length;

  if (fieldCount !== 5) {
    return `A runbook schedule has five fields - minute, hour, day of month, month and day of week - and this one has ${fieldCount}. Runbooks run at most once a minute, so there is no seconds field.`;
  }

  const error: string | null = CronTab.getValidationError(expression);

  if (error) {
    return error;
  }

  if (
    getNextRunbookRun({
      cron: expression,
      timezone: DEFAULT_RUNBOOK_SCHEDULE_TIMEZONE,
      after: new Date(Date.UTC(2000, 0, 1)),
    }) === null
  ) {
    return "This schedule never runs: no date matches it, such as the 31st of February.";
  }

  return null;
}

// What is wrong with a dialog choice, or null when nothing is.
export function getRunbookScheduleChoiceError(
  choice: RunbookScheduleChoice,
): string | null {
  switch (choice.repeat) {
    case RunbookScheduleRepeat.Minutes:
      return RUNBOOK_SCHEDULE_MINUTE_INTERVALS.includes(choice.every)
        ? null
        : `Pick how many minutes apart the runs are: ${RUNBOOK_SCHEDULE_MINUTE_INTERVALS.join(", ")}.`;
    case RunbookScheduleRepeat.Hours:
      if (!RUNBOOK_SCHEDULE_HOUR_INTERVALS.includes(choice.every)) {
        return `Pick how many hours apart the runs are: ${RUNBOOK_SCHEDULE_HOUR_INTERVALS.join(", ")}.`;
      }

      return isMinute(choice.minute)
        ? null
        : "Pick the minute past the hour, from 0 to 59.";
    case RunbookScheduleRepeat.Daily:
      return isMinute(choice.minute) && isHour(choice.hour)
        ? null
        : "Pick the time of day the runbook runs at.";
    case RunbookScheduleRepeat.Weekly:
      if (!(isMinute(choice.minute) && isHour(choice.hour))) {
        return "Pick the time of day the runbook runs at.";
      }

      return sortedDays(choice.days).length > 0
        ? null
        : "Pick at least one day.";
    case RunbookScheduleRepeat.Cron:
      return getRunbookScheduleCronError(choice.cron);
    default:
      return "Pick how often the runbook runs.";
  }
}

function isMinute(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 59;
}

function isHour(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 23;
}

/*
 * The zone, as moment-timezone holds it. utcOffset(instant) is the minutes
 * the zone's wall clock is BEHIND UTC at that instant - 300 in New York's
 * winter, -60 in Berlin's - so the wall clock reads instant minus that many
 * minutes.
 */
function getZone(timezone: string): moment.MomentZone {
  const zone: moment.MomentZone | null = moment.tz.zone(timezone.trim());

  if (!zone) {
    throw new Error(`"${timezone}" is not a time zone.`);
  }

  return zone;
}

// The wall clock at `instant`, as milliseconds of a UTC date that reads the same.
function getWallClock(zone: moment.MomentZone, instant: number): number {
  return instant - zone.utcOffset(instant) * MINUTE_IN_MS;
}

/*
 * The instants at which the zone's wall clock reads `wallClock`: one, two
 * when the clocks go back through it (both, earlier first), or - when the
 * clocks skip it - the instant just after the jump that reads as late as the
 * jump made it (02:30 read with the old offset is 03:30 on the new one).
 * Time zones change their offset at most once in any two days, so the
 * offsets a day either side are the only two that can apply.
 */
function getInstantsForWallClock(
  zone: moment.MomentZone,
  wallClock: number,
): Array<number> {
  const offsetBefore: number = zone.utcOffset(wallClock - DAY_IN_MS);
  const offsetAfter: number = zone.utcOffset(wallClock + DAY_IN_MS);

  const candidates: Array<number> = Array.from(
    new Set<number>([
      wallClock + offsetBefore * MINUTE_IN_MS,
      wallClock + offsetAfter * MINUTE_IN_MS,
    ]),
  ).sort((a: number, b: number) => {
    return a - b;
  });

  const instants: Array<number> = candidates.filter((instant: number) => {
    return getWallClock(zone, instant) === wallClock;
  });

  if (instants.length > 0) {
    return instants;
  }

  // Skipped by the clocks: read with the offset from before the jump.
  return [wallClock + offsetBefore * MINUTE_IN_MS];
}

function matchesDay(
  fields: CronExpressionFields,
  dayOfMonth: number,
  dayOfWeek: number,
): boolean {
  const dayOfMonthMatches: boolean =
    fields.dayOfMonth.values.includes(dayOfMonth);
  const dayOfWeekMatches: boolean = fields.dayOfWeek.values.includes(dayOfWeek);

  // Standard cron: either restriction will do when both are restricted.
  if (!fields.dayOfMonth.isWildcard && !fields.dayOfWeek.isWildcard) {
    return dayOfMonthMatches || dayOfWeekMatches;
  }

  return dayOfMonthMatches && dayOfWeekMatches;
}

/*
 * The first time after `after` (strictly) that the schedule runs, or null
 * when it has no run in the next eight years (it never runs). Throws when
 * the cron or the time zone is not valid.
 */
export function getNextRunbookRun(data: {
  cron: string;
  timezone: string;
  after: Date;
}): Date | null {
  const fields: CronExpressionFields = CronTab.parseFields(
    normalizeRunbookScheduleCron(data.cron),
  );

  if (fields.hasSeconds) {
    throw new Error(
      "A runbook schedule has five fields: minute, hour, day of month, month and day of week.",
    );
  }

  const zone: moment.MomentZone = getZone(data.timezone);
  const after: number = data.after.getTime();
  const afterWallClock: number = getWallClock(zone, after);

  /*
   * A schedule that runs every hour runs a time the clocks pass twice both
   * times; one that runs at set hours runs it the first time only.
   */
  const runsEveryHour: boolean = fields.hour.values.length === 24;

  /*
   * Start a day early: when the clocks go back, an instant after `after` can
   * read as the day before on the wall.
   */
  const firstDay: number =
    Math.floor(afterWallClock / DAY_IN_MS) * DAY_IN_MS - DAY_IN_MS;

  let best: number | null = null;

  for (let index: number = 0; index < MAX_DAYS_SEARCHED; index++) {
    const dayStart: number = firstDay + index * DAY_IN_MS;

    // No zone is more than 14 hours ahead of UTC: nothing later can be earlier.
    if (
      best !== null &&
      dayStart - MAX_HOURS_AHEAD_OF_UTC * HOUR_IN_MS > best
    ) {
      break;
    }

    const day: Date = new Date(dayStart);

    if (
      !fields.month.values.includes(day.getUTCMonth() + 1) ||
      !matchesDay(fields, day.getUTCDate(), day.getUTCDay())
    ) {
      continue;
    }

    /*
     * The offsets that can apply to this wall day: one, or the two either
     * side of a clock change. Every instant a time of the day reads at is
     * that time plus one of them, so a time whose instants all come at or
     * before `after` is passed over, and once a time's earliest instant
     * comes after the best run found, no later time can beat it. On a day
     * without a change that is the first time after `after`; on a day with
     * one, the times either side of it are weighed too.
     */
    const offsetEarly: number =
      zone.utcOffset(dayStart - DAY_IN_MS) * MINUTE_IN_MS;
    const offsetLate: number =
      zone.utcOffset(dayStart + 2 * DAY_IN_MS) * MINUTE_IN_MS;
    const smallestOffset: number = Math.min(offsetEarly, offsetLate);
    const largestOffset: number = Math.max(offsetEarly, offsetLate);

    let isDayDone: boolean = false;

    for (const hour of fields.hour.values) {
      for (const minute of fields.minute.values) {
        const wallClock: number =
          dayStart + hour * HOUR_IN_MS + minute * MINUTE_IN_MS;

        if (wallClock + largestOffset <= after) {
          continue;
        }

        if (best !== null && wallClock + smallestOffset >= best) {
          isDayDone = true;
          break;
        }

        const instants: Array<number> = getInstantsForWallClock(
          zone,
          wallClock,
        );

        for (const instant of runsEveryHour ? instants : instants.slice(0, 1)) {
          if (instant > after && (best === null || instant < best)) {
            best = instant;
          }
        }
      }

      if (isDayDone) {
        break;
      }
    }
  }

  return best === null ? null : new Date(best);
}

/*
 * The schedule's next `count` runs after `after`, earliest first. Fewer
 * when it runs fewer times than that in the next eight years.
 */
export function getNextRunbookRuns(data: {
  cron: string;
  timezone: string;
  after: Date;
  count: number;
}): Array<Date> {
  const runs: Array<Date> = [];
  let after: Date = data.after;

  for (let i: number = 0; i < data.count; i++) {
    const next: Date | null = getNextRunbookRun({
      cron: data.cron,
      timezone: data.timezone,
      after: after,
    });

    if (!next) {
      break;
    }

    runs.push(next);
    after = next;
  }

  return runs;
}
