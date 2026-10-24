/*
 * When the instance's backups run: how often, and at which time of day in
 * UTC (the servers' clock, and the same for every admin, whichever time
 * zone they read the page in). A pure description - the Enterprise
 * Edition's scheduler asks getNextBackupAt for the next run after each one.
 */

export enum BackupFrequency {
  EveryHour = "every-hour",
  Every6Hours = "every-6-hours",
  Every12Hours = "every-12-hours",
  Daily = "daily",
  Weekly = "weekly",
}

export const AllBackupFrequencies: ReadonlyArray<BackupFrequency> = [
  BackupFrequency.EveryHour,
  BackupFrequency.Every6Hours,
  BackupFrequency.Every12Hours,
  BackupFrequency.Daily,
  BackupFrequency.Weekly,
];

export const DEFAULT_BACKUP_FREQUENCY: BackupFrequency = BackupFrequency.Daily;

// 02:00 UTC: night in Europe and the Americas, when little changes.
export const DEFAULT_BACKUP_TIME_OF_DAY: string = "02:00";

// Sunday, for weekly backups.
export const DEFAULT_BACKUP_DAY_OF_WEEK: number = 0;

export const DEFAULT_BACKUP_RETENTION_IN_DAYS: number = 30;
export const MIN_BACKUP_RETENTION_IN_DAYS: number = 1;
// Ten years: longer than any retention a compliance rule asks for.
export const MAX_BACKUP_RETENTION_IN_DAYS: number = 3650;

export interface BackupSchedule {
  frequency: BackupFrequency;
  // "HH:MM", 24-hour, UTC. For the hourly frequencies only its minutes and its hour as an anchor count.
  timeOfDay: string;
  // 0 (Sunday) to 6 (Saturday), for weekly backups.
  dayOfWeek: number;
}

export interface TimeOfDay {
  hours: number;
  minutes: number;
}

export function isBackupFrequency(value: unknown): value is BackupFrequency {
  return (
    typeof value === "string" &&
    (AllBackupFrequencies as ReadonlyArray<string>).includes(value)
  );
}

function isDigits(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (const char of value) {
    if (char < "0" || char > "9") {
      return false;
    }
  }

  return true;
}

/*
 * "02:00" -> { hours: 2, minutes: 0 }. One or two digits for the hour, two
 * for the minutes; anything else (a second part, 24:00, 7:5) is null.
 */
export function parseBackupTimeOfDay(
  value: string | undefined | null,
): TimeOfDay | null {
  if (typeof value !== "string") {
    return null;
  }

  const parts: Array<string> = value.trim().split(":");

  if (parts.length !== 2) {
    return null;
  }

  const hourText: string = parts[0] || "";
  const minuteText: string = parts[1] || "";

  if (
    !isDigits(hourText) ||
    !isDigits(minuteText) ||
    hourText.length > 2 ||
    minuteText.length !== 2
  ) {
    return null;
  }

  const hours: number = Number(hourText);
  const minutes: number = Number(minuteText);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
}

// { hours: 2, minutes: 5 } -> "02:05".
export function formatBackupTimeOfDay(time: TimeOfDay): string {
  return `${String(time.hours).padStart(2, "0")}:${String(time.minutes).padStart(2, "0")}`;
}

export function isBackupDayOfWeek(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 6
  );
}

// How many hours apart backups of an hourly frequency run, or null for daily and weekly.
export function getBackupIntervalInHours(
  frequency: BackupFrequency,
): number | null {
  switch (frequency) {
    case BackupFrequency.EveryHour:
      return 1;
    case BackupFrequency.Every6Hours:
      return 6;
    case BackupFrequency.Every12Hours:
      return 12;
    default:
      return null;
  }
}

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

/*
 * The first time a backup of this schedule is due strictly after `after`:
 *
 *   Every hour       at the time's minute past every hour
 *   Every 6/12 hours at the time, and every 6 or 12 hours from it (02:00:
 *                    02:00, 08:00, 14:00, 20:00)
 *   Daily            at the time
 *   Weekly           at the time on the day of the week
 *
 * In UTC, to the minute (seconds and milliseconds are zero). A schedule
 * whose time does not parse runs at the default time, so a damaged setting
 * never stops backups.
 */
export function getNextBackupAt(schedule: BackupSchedule, after: Date): Date {
  const time: TimeOfDay = parseBackupTimeOfDay(schedule.timeOfDay) ||
    parseBackupTimeOfDay(DEFAULT_BACKUP_TIME_OF_DAY) || { hours: 2, minutes: 0 };

  const afterMs: number = after.getTime();
  const dayStart: number = Date.UTC(
    after.getUTCFullYear(),
    after.getUTCMonth(),
    after.getUTCDate(),
  );
  const anchor: number =
    dayStart + time.hours * HOUR_IN_MS + time.minutes * MINUTE_IN_MS;

  const intervalInHours: number | null = getBackupIntervalInHours(
    isBackupFrequency(schedule.frequency)
      ? schedule.frequency
      : DEFAULT_BACKUP_FREQUENCY,
  );

  if (intervalInHours !== null) {
    const interval: number = intervalInHours * HOUR_IN_MS;
    // The anchor, moved by whole intervals to the first one after `after`.
    const steps: number = Math.floor((afterMs - anchor) / interval) + 1;

    return new Date(anchor + steps * interval);
  }

  if (schedule.frequency === BackupFrequency.Weekly) {
    const dayOfWeek: number = isBackupDayOfWeek(schedule.dayOfWeek)
      ? schedule.dayOfWeek
      : DEFAULT_BACKUP_DAY_OF_WEEK;
    const daysAhead: number = (dayOfWeek - after.getUTCDay() + 7) % 7;
    let candidate: number = anchor + daysAhead * DAY_IN_MS;

    if (candidate <= afterMs) {
      candidate += 7 * DAY_IN_MS;
    }

    return new Date(candidate);
  }

  // Daily.
  return new Date(anchor <= afterMs ? anchor + DAY_IN_MS : anchor);
}

// How long a schedule waits between two backups, at most.
export function getBackupIntervalInMs(frequency: BackupFrequency): number {
  const hours: number | null = getBackupIntervalInHours(frequency);

  if (hours !== null) {
    return hours * HOUR_IN_MS;
  }

  return frequency === BackupFrequency.Weekly ? 7 * DAY_IN_MS : DAY_IN_MS;
}
