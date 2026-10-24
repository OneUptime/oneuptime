import {
  BACKUP_PLURALS,
  BACKUP_FREQUENCY_COPY,
  BackupsCopy,
} from "./BackupsCopy";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import { BackupPostgresCounts } from "Common/Types/Backup/BackupManifest";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupStep,
  BackupStepKey,
  BackupStepStatus,
  getCurrentBackupStep,
  readBackupSteps,
} from "Common/Types/Backup/BackupRunTypes";
import {
  BackupFrequency,
  BackupSchedule,
  formatBackupTimeOfDay,
  isBackupFrequency,
  parseBackupTimeOfDay,
  TimeOfDay,
} from "Common/Types/Backup/BackupSchedule";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import {
  FeedClock,
  formatFeedTimeAgo,
  getFeedLocale,
} from "Common/UI/Components/Feed/FeedTime";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * How the Backups page writes what it shows, without React: sizes,
 * durations and times in the reader's language (the browser's Intl data,
 * as the feeds write them), the schedule as a sentence, what a backup
 * holds, how far a run has got. Pinned in ee/Tests/UI/Backups.
 */

/*
 * The parts of Intl the page uses beyond ES2017's library, which ee
 * compiles against; every browser the Admin Dashboard supports has them.
 */
interface UnitNumberFormat {
  format: (value: number) => string;
}

type UnitNumberFormatConstructor = new (
  locale: string,
  options: {
    style: "unit";
    unit: string;
    unitDisplay: "short" | "long";
    maximumFractionDigits?: number;
  },
) => UnitNumberFormat;

interface RelativeTimeFormatter {
  format: (value: number, unit: string) => string;
}

type RelativeTimeFormatConstructor = new (
  locale: string,
  options: { numeric: "always"; style: "long" },
) => RelativeTimeFormatter;

interface ListFormatter {
  format: (items: Array<string>) => string;
}

type ListFormatConstructor = new (
  locale: string,
  options: { style: "long"; type: "conjunction" },
) => ListFormatter;

const BYTE_UNITS: Array<[string, number]> = [
  ["petabyte", 1024 ** 5],
  ["terabyte", 1024 ** 4],
  ["gigabyte", 1024 ** 3],
  ["megabyte", 1024 ** 2],
  ["kilobyte", 1024],
];

const ENGLISH_BYTE_SYMBOLS: Record<string, string> = {
  petabyte: "PB",
  terabyte: "TB",
  gigabyte: "GB",
  megabyte: "MB",
  kilobyte: "kB",
  byte: "B",
};

/*
 * "4.1 MB", "2.2 GB", "980 kB" in the reader's language - one decimal
 * under 10 of a unit, none above.
 */
export function formatBackupSize(bytes: number, language: string): string {
  const value: number = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let unit: string = "byte";
  let amount: number = value;

  for (const [name, size] of BYTE_UNITS) {
    if (value >= size) {
      unit = name;
      amount = value / size;
      break;
    }
  }

  const digits: number = unit === "byte" || amount >= 10 ? 0 : 1;

  try {
    const NumberFormat: UnitNumberFormatConstructor =
      Intl.NumberFormat as unknown as UnitNumberFormatConstructor;

    return new NumberFormat(getFeedLocale(language), {
      style: "unit",
      unit,
      unitDisplay: "short",
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${ENGLISH_BYTE_SYMBOLS[unit] || "B"}`;
  }
}

const ENGLISH_DURATION_UNITS: Record<string, [string, string]> = {
  second: ["second", "seconds"],
  minute: ["minute", "minutes"],
  hour: ["hour", "hours"],
  day: ["day", "days"],
};

/*
 * How long something took, in the reader's language: "6 seconds", "12
 * minutes", "2 hours" - rounded to the unit that reads best, never "0".
 */
export function formatBackupDuration(ms: number, language: string): string {
  const seconds: number = Math.max(1, Math.round((ms || 0) / 1000));
  let unit: string = "second";
  let count: number = seconds;

  if (seconds >= 86400) {
    unit = "day";
    count = Math.round(seconds / 86400);
  } else if (seconds >= 3600) {
    unit = "hour";
    count = Math.round(seconds / 3600);
  } else if (seconds >= 60) {
    unit = "minute";
    count = Math.round(seconds / 60);
  }

  try {
    const NumberFormat: UnitNumberFormatConstructor =
      Intl.NumberFormat as unknown as UnitNumberFormatConstructor;

    return new NumberFormat(getFeedLocale(language), {
      style: "unit",
      unit,
      unitDisplay: "long",
    }).format(count);
  } catch {
    const names: [string, string] = ENGLISH_DURATION_UNITS[unit]!;
    return `${count} ${count === 1 ? names[0] : names[1]}`;
  }
}

// "Oct 24, 2026, 2:00 AM" in the reader's zone and language.
export function formatBackupDateTime(date: Date, clock: FeedClock): string {
  const value: Date = new Date(date);

  if (Number.isNaN(value.getTime())) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(getFeedLocale(clock.language), {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: clock.use12HourClock,
      timeZone: clock.timezone,
    }).format(value);
  } catch {
    return value.toISOString().slice(0, 16).replace("T", " ");
  }
}

// "3 hours ago".
export function formatBackupTimeAgo(date: Date, clock: FeedClock): string {
  return formatFeedTimeAgo(new Date(date), clock) || "";
}

// "in 14 hours", "in 3 minutes"; "now" once it is due.
export function formatBackupTimeUntil(date: Date, clock: FeedClock): string {
  const seconds: number =
    (new Date(date).getTime() - clock.now.getTime()) / 1000;

  if (Number.isNaN(seconds)) {
    return "";
  }

  let unit: string = "minute";
  let count: number = Math.max(1, Math.round(seconds / 60));

  if (seconds >= 86400 * 1.5) {
    unit = "day";
    count = Math.round(seconds / 86400);
  } else if (seconds >= 3600 * 0.75) {
    unit = "hour";
    count = Math.max(1, Math.round(seconds / 3600));
  }

  try {
    const RelativeTimeFormat: RelativeTimeFormatConstructor | undefined = (
      Intl as unknown as {
        RelativeTimeFormat?: RelativeTimeFormatConstructor | undefined;
      }
    ).RelativeTimeFormat;

    if (RelativeTimeFormat) {
      return new RelativeTimeFormat(getFeedLocale(clock.language), {
        numeric: "always",
        style: "long",
      }).format(count, unit);
    }
  } catch {
    // English below.
  }

  const names: [string, string] = ENGLISH_DURATION_UNITS[unit]!;
  return `in ${count} ${count === 1 ? names[0] : names[1]}`;
}

// Sunday (0) to Saturday (6), in the reader's language.
export function getWeekdayName(dayOfWeek: number, language: string): string {
  // 2023-01-01 was a Sunday.
  const date: Date = new Date(Date.UTC(2023, 0, 1 + (dayOfWeek % 7), 12));

  try {
    return new Intl.DateTimeFormat(getFeedLocale(language), {
      weekday: "long",
      timeZone: "UTC",
    }).format(date);
  } catch {
    return [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ][dayOfWeek % 7]!;
  }
}

/*
 * The local time an hour in UTC is today, for the time dropdown: "04:00"
 * in Berlin for 02:00 UTC in summer. Written the reader's way.
 */
export function getLocalTimeOfUtcHour(data: {
  hour: number;
  clock: FeedClock;
}): string {
  const now: Date = data.clock.now;
  const date: Date = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      data.hour,
    ),
  );

  try {
    return new Intl.DateTimeFormat(getFeedLocale(data.clock.language), {
      hour: "numeric",
      minute: "2-digit",
      hour12: data.clock.use12HourClock,
      timeZone: data.clock.timezone,
    }).format(date);
  } catch {
    return formatBackupTimeOfDay({ hours: data.hour, minutes: 0 });
  }
}

// Whether the reader's clock reads as UTC's now (London in winter, a server in UTC).
export function isClockOnUtc(clock: FeedClock): boolean {
  const read: (timeZone: string) => string = (timeZone: string): string => {
    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(clock.now);
  };

  try {
    return read(clock.timezone) === read("UTC");
  } catch {
    return false;
  }
}

/*
 * A choice of the time dropdown: "02:00 UTC (04:00 your time)" - or "02:00
 * UTC" alone for a reader whose clock is UTC's.
 */
export function describeUtcHourOption(data: {
  hour: number;
  clock: FeedClock;
  translator: Translator;
}): string {
  const utc: string = formatBackupTimeOfDay({ hours: data.hour, minutes: 0 });

  if (isClockOnUtc(data.clock)) {
    return `${utc} UTC`;
  }

  return data.translator.translateTemplate(BackupsCopy.timeOption, {
    utc,
    local: getLocalTimeOfUtcHour({ hour: data.hour, clock: data.clock }),
  });
}

/*
 * The schedule as a sentence: "Every day at 02:00 UTC", "Every Sunday at
 * 02:00 UTC", "Every 6 hours at 02:00 UTC", "Every hour".
 */
export function describeBackupSchedule(data: {
  schedule: {
    frequency?: BackupSchedule["frequency"] | undefined;
    timeOfDay?: string | undefined;
    dayOfWeek?: number | undefined;
  };
  translator: Translator;
}): string {
  const frequency: BackupFrequency = isBackupFrequency(data.schedule.frequency)
    ? data.schedule.frequency
    : BackupFrequency.Daily;
  const time: TimeOfDay = parseBackupTimeOfDay(data.schedule.timeOfDay) || {
    hours: 2,
    minutes: 0,
  };
  const timeText: string = formatBackupTimeOfDay(time);

  if (frequency === BackupFrequency.EveryHour) {
    return (
      data.translator.translateText(BACKUP_FREQUENCY_COPY[frequency]) ||
      BACKUP_FREQUENCY_COPY[frequency]
    );
  }

  if (frequency === BackupFrequency.Weekly) {
    return data.translator.translateTemplate(BackupsCopy.scheduleWeekly, {
      day: getWeekdayName(
        data.schedule.dayOfWeek ?? 0,
        data.translator.language,
      ),
      time: timeText,
    });
  }

  return data.translator.translateTemplate(BackupsCopy.scheduleAt, {
    frequency:
      data.translator.translateText(BACKUP_FREQUENCY_COPY[frequency]) ||
      BACKUP_FREQUENCY_COPY[frequency],
    time: timeText,
  });
}

export function getBackupRunStatusColor(
  status: BackupRunStatus | undefined,
): Color {
  switch (status) {
    case BackupRunStatus.Succeeded:
      return Green;
    case BackupRunStatus.Failed:
      return Red;
    case BackupRunStatus.Running:
    case BackupRunStatus.Queued:
      return Yellow;
    default:
      return Gray500;
  }
}

// How long a finished run took, or a running one has taken so far.
export function getBackupRunDurationInMs(
  run: Pick<BackupRun, "startedAt" | "finishedAt">,
  now: Date,
): number | null {
  if (!run.startedAt) {
    return null;
  }

  const end: Date = run.finishedAt ? new Date(run.finishedAt) : now;

  return Math.max(0, end.getTime() - new Date(run.startedAt).getTime());
}

/*
 * "3 projects, 12 users and 140 monitors": what a PostgreSQL backup holds,
 * as the restore dialog reads it. Empty when nothing is counted.
 */
export function describeBackupCounts(data: {
  counts: BackupPostgresCounts | null | undefined;
  translator: Translator;
}): string {
  const counts: BackupPostgresCounts = data.counts || {};
  const parts: Array<string> = [];
  const add: (
    count: number | undefined,
    key: keyof typeof BACKUP_PLURALS,
  ) => void = (
    count: number | undefined,
    key: keyof typeof BACKUP_PLURALS,
  ): void => {
    if (typeof count === "number") {
      parts.push(data.translator.translatePlural(BACKUP_PLURALS[key], count));
    }
  };

  add(counts.projects, "projects");
  add(counts.users, "users");
  add(counts.monitors, "monitors");
  add(counts.statusPages, "statusPages");

  if (parts.length === 0) {
    return "";
  }

  try {
    const ListFormat: ListFormatConstructor | undefined = (
      Intl as unknown as { ListFormat?: ListFormatConstructor | undefined }
    ).ListFormat;

    if (ListFormat) {
      return new ListFormat(getFeedLocale(data.translator.language), {
        style: "long",
        type: "conjunction",
      }).format(parts);
    }
  } catch {
    // Commas below.
  }

  return parts.join(", ");
}

/*
 * What a backup holds, with sizes: "PostgreSQL 4.1 MB · ClickHouse 2.2 MB".
 */
export function describeBackupContents(data: {
  run: Pick<
    BackupRun,
    | "includesPostgres"
    | "includesClickhouse"
    | "postgresSizeInBytes"
    | "clickhouseSizeInBytes"
  >;
  translator: Translator;
}): Array<{ title: string; size: string }> {
  const parts: Array<{ title: string; size: string }> = [];

  if (data.run.includesPostgres !== false) {
    parts.push({
      title:
        data.translator.translateText(BackupsCopy.databasePostgres) ||
        BackupsCopy.databasePostgres,
      size:
        typeof data.run.postgresSizeInBytes === "number"
          ? formatBackupSize(
              data.run.postgresSizeInBytes,
              data.translator.language,
            )
          : "",
    });
  }

  if (data.run.includesClickhouse) {
    parts.push({
      title:
        data.translator.translateText(BackupsCopy.databaseClickhouse) ||
        BackupsCopy.databaseClickhouse,
      size:
        typeof data.run.clickhouseSizeInBytes === "number"
          ? formatBackupSize(
              data.run.clickhouseSizeInBytes,
              data.translator.language,
            )
          : "",
    });
  }

  return parts;
}

export function getBackupRunTotalSize(
  run: Pick<BackupRun, "postgresSizeInBytes" | "clickhouseSizeInBytes">,
): number {
  return (run.postgresSizeInBytes || 0) + (run.clickhouseSizeInBytes || 0);
}

export interface BackupRunProgress {
  // Steps the run takes (skipped ones left out).
  total: number;
  // 1-based number of the step it is on.
  number: number;
  step: BackupStep | undefined;
  // 0 to 100 within the step, when it is known.
  percent: number | null;
}

// How far a running run has got: "Step 2 of 5", and the step's percent when known.
export function getBackupRunProgress(
  run: Pick<BackupRun, "steps">,
): BackupRunProgress {
  const steps: Array<BackupStep> = readBackupSteps(run.steps).filter(
    (step: BackupStep): boolean => {
      return step.status !== BackupStepStatus.Skipped;
    },
  );
  const current: BackupStep | undefined = getCurrentBackupStep(steps);
  const index: number = current ? steps.indexOf(current) : steps.length - 1;
  let percent: number | null = null;

  if (
    current?.progress?.totalBytes &&
    current.progress.doneBytes !== undefined &&
    // A database's size on disk is only a guess at its dump's size.
    current.key !== BackupStepKey.BackUpPostgres &&
    current.key !== BackupStepKey.BackUpClickhouse
  ) {
    percent = Math.min(
      100,
      Math.round(
        (current.progress.doneBytes * 100) / current.progress.totalBytes,
      ),
    );
  }

  return {
    total: steps.length,
    number: Math.max(1, index + 1),
    step: current,
    percent,
  };
}

// Whether a backup is where the destination is now, so it can be restored or deleted.
export function isBackupAtCurrentDestination(data: {
  run: Pick<BackupRun, "destinationFingerprint">;
  currentFingerprint: string | null | undefined;
}): boolean {
  return Boolean(
    data.currentFingerprint &&
      data.run.destinationFingerprint === data.currentFingerprint,
  );
}

export function canRestoreBackup(data: {
  run: Pick<BackupRun, "kind" | "status" | "destinationFingerprint">;
  currentFingerprint: string | null | undefined;
}): boolean {
  return (
    data.run.kind === BackupRunKind.Backup &&
    data.run.status === BackupRunStatus.Succeeded &&
    isBackupAtCurrentDestination(data)
  );
}

// The newest backup that succeeded, among the rows the page has.
export function getNewestSucceededBackup(
  runs: Array<BackupRun>,
): BackupRun | null {
  let newest: BackupRun | null = null;

  for (const run of runs) {
    if (
      run.kind !== BackupRunKind.Backup ||
      run.status !== BackupRunStatus.Succeeded ||
      !run.startedAt
    ) {
      continue;
    }

    if (
      !newest ||
      new Date(run.startedAt).getTime() > new Date(newest.startedAt!).getTime()
    ) {
      newest = run;
    }
  }

  return newest;
}
