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
  DurationTextUnit,
  ReaderDateTimeFormat,
  formatDurationUnit,
  formatRelativeAmount,
  formatUnitAmount,
  getDateTimeFormat,
  getHourOption,
  RelativeDateUnit,
  writeStandAloneDayName,
} from "Common/Types/DateLanguage";
import {
  FeedClock,
  formatFeedTimeAgo,
  getFeedLocale,
} from "Common/UI/Components/Feed/FeedTime";
import { NO_BREAK_SPACE } from "Common/Types/NoBreakSpaces";
import { composedValue, Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * How the Backups page writes what it shows, without React: sizes,
 * durations and times in the reader's language (the browser's Intl data,
 * as the feeds write them), the schedule as a sentence, what a backup
 * holds, how far a run has got. Pinned in ee/Tests/UI/Backups.
 */

/*
 * The parts of Intl the page uses beyond ES2017's library, which ee
 * compiles against; every browser the Admin Dashboard supports has them.
 * A size, a duration and a time to come are DateLanguage's, each number
 * held to its unit by a no-break space (#8456).
 */
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

  return (
    formatUnitAmount({
      value: amount,
      unit: unit,
      locale: getFeedLocale(language),
      unitDisplay: "short",
      maximumFractionDigits: digits,
    }) || `${amount.toFixed(digits)} ${ENGLISH_BYTE_SYMBOLS[unit] || "B"}`
  );
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
  let unit: DurationTextUnit = "second";
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

  const written: string | null = formatDurationUnit({
    part: { count: count, unit: unit },
    locale: getFeedLocale(language),
    unitDisplay: "long",
  });

  if (written) {
    return written;
  }

  const names: [string, string] = ENGLISH_DURATION_UNITS[unit]!;
  return `${count}${NO_BREAK_SPACE}${count === 1 ? names[0] : names[1]}`;
}

/*
 * "Oct 24, 2026, 2:00 AM" in the reader's zone and language; "24. Okt.
 * 2026, 02:00" on a 24-hour clock, its zero kept as every other date on
 * the page keeps it (getHourOption, issue #7649).
 */
export function formatBackupDateTime(date: Date, clock: FeedClock): string {
  const value: Date = new Date(date);

  if (Number.isNaN(value.getTime())) {
    return "";
  }

  // The wall clock from OneUptime's own zone data, as every date (#10038).
  const format: ReaderDateTimeFormat | null = getDateTimeFormat({
    locale: getFeedLocale(clock.language),
    timezones: [clock.timezone],
    options: {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: getHourOption(clock.use12HourClock),
      minute: "2-digit",
      hour12: clock.use12HourClock,
    },
  });

  return format
    ? format.format(value)
    : value.toISOString().slice(0, 16).replace("T", " ");
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

  let unit: RelativeDateUnit = "minute";
  let count: number = Math.max(1, Math.round(seconds / 60));

  if (seconds >= 86400 * 1.5) {
    unit = "day";
    count = Math.round(seconds / 86400);
  } else if (seconds >= 3600 * 0.75) {
    unit = "hour";
    count = Math.max(1, Math.round(seconds / 3600));
  }

  const until: string | null = formatRelativeAmount({
    count: count,
    unit: unit,
    isFuture: true,
    locale: getFeedLocale(clock.language),
  });

  if (until) {
    return until;
  }

  const names: [string, string] = ENGLISH_DURATION_UNITS[unit]!;
  return `in ${count}${NO_BREAK_SPACE}${count === 1 ? names[0] : names[1]}`;
}

/*
 * Sunday (0) to Saturday (6), in the reader's language, as an item of the
 * schedule's day menu: "Domingo" in Spanish, "søndag" in Danish, as CLDR
 * has each language write a day in a menu (#7660).
 */
export function getWeekdayName(dayOfWeek: number, language: string): string {
  // 2023-01-01 was a Sunday.
  const date: Date = new Date(Date.UTC(2023, 0, 1 + (dayOfWeek % 7), 12));
  const format: ReaderDateTimeFormat | null = getDateTimeFormat({
    locale: getFeedLocale(language),
    timezones: ["UTC"],
    options: { weekday: "long" },
  });

  if (!format) {
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

  return writeStandAloneDayName({
    name: format.format(date),
    language: language,
    context: "menu",
  });
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

  const format: ReaderDateTimeFormat | null = getDateTimeFormat({
    locale: getFeedLocale(data.clock.language),
    timezones: [data.clock.timezone],
    options: {
      hour: getHourOption(data.clock.use12HourClock),
      minute: "2-digit",
      hour12: data.clock.use12HourClock,
    },
  });

  return format
    ? format.format(date)
    : formatBackupTimeOfDay({ hours: data.hour, minutes: 0 });
}

/*
 * Whether the reader's clock reads as UTC's now (London in winter, a server
 * in UTC), from OneUptime's own zone data (#10038).
 */
export function isClockOnUtc(clock: FeedClock): boolean {
  const read: (timeZone: string) => string | null = (
    timeZone: string,
  ): string | null => {
    const format: ReaderDateTimeFormat | null = getDateTimeFormat({
      locale: "en-GB",
      timezones: [timeZone],
      options: {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      },
    });

    return format ? format.format(clock.now) : null;
  };

  try {
    const local: string | null = read(clock.timezone);

    return local !== null && local === read("UTC");
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
 * 02:00 UTC", "Every 6 hours at 02:00 UTC", "Every hour". The weekday and
 * the frequency are written in the sentence's language, so a sentence a
 * locale lacks reads wholly in English.
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
    const dayOfWeek: number = data.schedule.dayOfWeek ?? 0;

    return data.translator.translateTemplate(BackupsCopy.scheduleWeekly, {
      day: composedValue((sentence: Translator): string => {
        return getWeekdayName(dayOfWeek, sentence.language);
      }),
      time: timeText,
    });
  }

  return data.translator.translateTemplate(BackupsCopy.scheduleAt, {
    frequency: composedValue((sentence: Translator): string => {
      return (
        sentence.translateText(BACKUP_FREQUENCY_COPY[frequency]) ||
        BACKUP_FREQUENCY_COPY[frequency]
      );
    }),
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
