import { XcpNgBackupSchedule } from "../../../Types/XcpNg/XcpNgPoolEvents";

/*
 * ------------------------------------------------------------------
 * How late a VM's backup may be - from its jobs' schedules
 * ------------------------------------------------------------------
 *
 * A VM "has not had a successful backup in its interval" (#10997) when the
 * last one it had is older than the longest gap between two runs of the
 * jobs that back it up, plus some grace: a job that runs every night has
 * missed one once a VM's last good backup is more than a day and a quarter
 * old.
 *
 * The gap is read from the job's enabled schedules (Xen Orchestra's cron,
 * five fields, in the schedule's zone), so a job that runs on weekdays
 * only allows three days over a weekend, not one, and daylight saving's
 * 25-hour night counts as it falls. Several schedules of one job are read
 * together: the gaps are those of every run any of them makes.
 *
 * The runs are worked out here rather than with cron-parser, which takes a
 * millisecond or more a run (five in a zone with daylight saving): a
 * year of a nightly job was seconds of the server's event loop, every
 * collection. Here it is plain arithmetic over the year's days, a zone's
 * offset read with Intl, and the answer kept for the hour.
 * ------------------------------------------------------------------
 */

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

// How far ahead a schedule's runs are read, and how many at most.
const HORIZON_MS: number = 400 * DAY_MS;
const MAX_RUNS_PER_SCHEDULE: number = 500;

// The least grace a VM's backup is given, and the share of its interval.
export const XCP_NG_BACKUP_MIN_GRACE_SECONDS: number = 60 * 60;
export const XCP_NG_BACKUP_GRACE_SHARE: number = 0.25;

const MONTH_NAMES: ReadonlyArray<string> = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const DAY_NAMES: ReadonlyArray<string> = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

const DIGITS: RegExp = /^\d+$/;
const FIELD_SEPARATOR: RegExp = /\s+/;

// A five-field cron, each field the values it allows.
export interface XcpNgCronSpec {
  minutes: Array<number>;
  hours: Array<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  // A field that allows every value does not restrict the day.
  anyDayOfMonth: boolean;
  anyDayOfWeek: boolean;
}

function readFieldValue(
  text: string | undefined,
  names: ReadonlyArray<string> | undefined,
  nameBase: number,
): number | null {
  if (!text) {
    return null;
  }
  if (DIGITS.test(text)) {
    return Number(text);
  }
  const index: number = names ? names.indexOf(text.toLowerCase()) : -1;
  return index >= 0 ? index + nameBase : null;
}

// One field: `*`, `5`, `1-5`, `*/15`, `10-50/10`, `5/10`, lists of them, names.
function parseCronField(data: {
  text: string;
  min: number;
  max: number;
  names?: ReadonlyArray<string> | undefined;
  nameBase?: number | undefined;
}): Set<number> | null {
  const values: Set<number> = new Set<number>();

  for (const item of data.text.split(",")) {
    const parts: Array<string> = item.split("/");
    if (!item || parts.length > 2) {
      return null;
    }

    const rangeText: string = parts[0] as string;
    const stepText: string | undefined = parts[1];
    let step: number = 1;
    if (stepText !== undefined) {
      if (!DIGITS.test(stepText) || Number(stepText) < 1) {
        return null;
      }
      step = Number(stepText);
    }

    let start: number;
    let end: number;
    if (rangeText === "*") {
      start = data.min;
      end = data.max;
    } else {
      const bounds: Array<string> = rangeText.split("-");
      if (bounds.length > 2) {
        return null;
      }
      const first: number | null = readFieldValue(
        bounds[0],
        data.names,
        data.nameBase ?? 0,
      );
      if (first === null) {
        return null;
      }
      start = first;
      if (bounds.length === 2) {
        const last: number | null = readFieldValue(
          bounds[1],
          data.names,
          data.nameBase ?? 0,
        );
        if (last === null) {
          return null;
        }
        end = last;
      } else {
        // `5/10` is "from 5, every 10".
        end = stepText === undefined ? first : data.max;
      }
    }

    if (start < data.min || end > data.max || start > end) {
      return null;
    }

    for (let value: number = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return values.size > 0 ? values : null;
}

function sortedValues(values: Set<number>): Array<number> {
  return Array.from(values).sort((left: number, right: number): number => {
    return left - right;
  });
}

/*
 * A five-field cron as Xen Orchestra's schedules hold it, or null when it
 * is not one: minute, hour, day of the month, month, day of the week
 * (0 or 7 Sunday), with ranges, steps, lists and English names.
 */
export function parseXcpNgCron(cron: string): XcpNgCronSpec | null {
  const fields: Array<string> = cron.trim().split(FIELD_SEPARATOR);
  if (fields.length !== 5) {
    return null;
  }

  const minutes: Set<number> | null = parseCronField({
    text: fields[0] as string,
    min: 0,
    max: 59,
  });
  const hours: Set<number> | null = parseCronField({
    text: fields[1] as string,
    min: 0,
    max: 23,
  });
  const daysOfMonth: Set<number> | null = parseCronField({
    text: fields[2] as string,
    min: 1,
    max: 31,
  });
  const months: Set<number> | null = parseCronField({
    text: fields[3] as string,
    min: 1,
    max: 12,
    names: MONTH_NAMES,
    nameBase: 1,
  });
  const weekDays: Set<number> | null = parseCronField({
    text: fields[4] as string,
    min: 0,
    max: 7,
    names: DAY_NAMES,
    nameBase: 0,
  });

  if (!minutes || !hours || !daysOfMonth || !months || !weekDays) {
    return null;
  }

  const daysOfWeek: Set<number> = new Set<number>(
    Array.from(weekDays).map((day: number): number => {
      return day === 7 ? 0 : day;
    }),
  );

  return {
    minutes: sortedValues(minutes),
    hours: sortedValues(hours),
    daysOfMonth: daysOfMonth,
    months: months,
    daysOfWeek: daysOfWeek,
    anyDayOfMonth: daysOfMonth.size === 31,
    anyDayOfWeek: daysOfWeek.size === 7,
  };
}

/*
 * Whether a cron runs on a day: with both days restricted, either one
 * (cron's own rule, and cron-parser's); with one, that one.
 */
function runsOnDay(spec: XcpNgCronSpec, day: Date): boolean {
  if (!spec.months.has(day.getUTCMonth() + 1)) {
    return false;
  }
  const dayOfMonth: boolean = spec.daysOfMonth.has(day.getUTCDate());
  const dayOfWeek: boolean = spec.daysOfWeek.has(day.getUTCDay());

  if (!spec.anyDayOfMonth && !spec.anyDayOfWeek) {
    return dayOfMonth || dayOfWeek;
  }
  if (!spec.anyDayOfMonth) {
    return dayOfMonth;
  }
  if (!spec.anyDayOfWeek) {
    return dayOfWeek;
  }
  return true;
}

const UTC_ZONES: ReadonlySet<string> = new Set<string>([
  "utc",
  "etc/utc",
  "gmt",
  "etc/gmt",
  "z",
]);

/*
 * A zone's offset from UTC at an instant, in milliseconds, read with Intl;
 * null when Intl does not know the zone.
 */
function makeOffsetReader(
  timezone: string | undefined,
): ((instantMs: number) => number) | null {
  if (!timezone || UTC_ZONES.has(timezone.toLowerCase())) {
    return (): number => {
      return 0;
    };
  }

  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  } catch {
    return null;
  }

  return (instantMs: number): number => {
    const parts: Record<string, number> = {};
    for (const part of format.formatToParts(new Date(instantMs))) {
      parts[part.type] = Number(part.value);
    }
    const wall: number = Date.UTC(
      parts["year"] as number,
      (parts["month"] as number) - 1,
      parts["day"] as number,
      parts["hour"] as number,
      parts["minute"] as number,
    );
    const offset: number = wall - Math.floor(instantMs / MINUTE_MS) * MINUTE_MS;
    return Number.isFinite(offset) ? offset : 0;
  };
}

/*
 * A schedule's runs after `nowMs`, as instants, at most `max` of them and
 * none past the horizon; `reachedEnd` when the horizon, not `max`, ended
 * them. Null when the cron or the zone is not one.
 */
export function listXcpNgScheduleRuns(data: {
  cron: string;
  timezone?: string | undefined;
  nowMs: number;
  horizonMs?: number | undefined;
  max?: number | undefined;
}): { runs: Array<number>; reachedEnd: boolean } | null {
  const spec: XcpNgCronSpec | null = parseXcpNgCron(data.cron);
  const offsetAt: ((instantMs: number) => number) | null = makeOffsetReader(
    data.timezone,
  );
  if (!spec || !offsetAt) {
    return null;
  }

  const max: number = data.max ?? MAX_RUNS_PER_SCHEDULE;
  const horizonMs: number = data.horizonMs ?? HORIZON_MS;

  // The schedule's wall clock, written as if it were UTC.
  const wallNow: number = data.nowMs + offsetAt(data.nowMs);
  const wallEnd: number = wallNow + horizonMs;
  const runs: Array<number> = [];

  // A wall-clock time's instant: the offset there, read twice to settle.
  const toInstant: (wall: number) => number = (wall: number): number => {
    const guess: number = wall - offsetAt(wall);
    return wall - offsetAt(guess);
  };

  for (
    let dayStart: number = Math.floor(wallNow / DAY_MS) * DAY_MS;
    dayStart <= wallEnd;
    dayStart += DAY_MS
  ) {
    if (!runsOnDay(spec, new Date(dayStart))) {
      continue;
    }
    for (const hour of spec.hours) {
      for (const minute of spec.minutes) {
        const wall: number = dayStart + hour * HOUR_MS + minute * MINUTE_MS;
        if (wall <= wallNow) {
          continue;
        }
        if (wall > wallEnd) {
          return { runs: runs, reachedEnd: true };
        }
        runs.push(toInstant(wall));
        if (runs.length >= max) {
          return { runs: runs, reachedEnd: false };
        }
      }
    }
  }

  return { runs: runs, reachedEnd: true };
}

// Each job's interval, for the hour: its schedules seldom change.
const INTERVAL_CACHE: Map<string, number | null> = new Map();
const MAX_CACHED_INTERVALS: number = 2000;

/*
 * The longest gap, in seconds, between two runs of these schedules, the
 * enabled ones, from `now` on. Null when none is enabled or parses, or
 * they run less than twice in the horizon.
 */
export function getXcpNgBackupJobIntervalSeconds(data: {
  schedules: Array<XcpNgBackupSchedule>;
  now: Date;
}): number | null {
  const nowMs: number = data.now.getTime();
  const enabled: Array<XcpNgBackupSchedule> = data.schedules.filter(
    (schedule: XcpNgBackupSchedule): boolean => {
      return schedule.enabled && Boolean(schedule.cron);
    },
  );

  const key: string = JSON.stringify([
    Math.floor(nowMs / HOUR_MS),
    enabled.map((schedule: XcpNgBackupSchedule): Array<string> => {
      return [schedule.cron, schedule.timezone || ""];
    }),
  ]);
  if (INTERVAL_CACHE.has(key)) {
    return INTERVAL_CACHE.get(key) as number | null;
  }

  const interval: number | null = computeInterval(enabled, nowMs);

  if (INTERVAL_CACHE.size >= MAX_CACHED_INTERVALS) {
    const oldest: string | undefined = INTERVAL_CACHE.keys().next().value;
    if (oldest !== undefined) {
      INTERVAL_CACHE.delete(oldest);
    }
  }
  INTERVAL_CACHE.set(key, interval);
  return interval;
}

function computeInterval(
  schedules: Array<XcpNgBackupSchedule>,
  nowMs: number,
): number | null {
  const runsBySchedule: Array<Array<number>> = [];
  let windowEnd: number = nowMs + HORIZON_MS;

  for (const schedule of schedules) {
    const listed: { runs: Array<number>; reachedEnd: boolean } | null =
      listXcpNgScheduleRuns({
        cron: schedule.cron,
        timezone: schedule.timezone,
        nowMs: nowMs,
      });

    // A cron or a zone that is not one tells nothing of the gap.
    if (!listed || listed.runs.length === 0) {
      continue;
    }

    /*
     * A schedule cut at MAX_RUNS_PER_SCHEDULE (every minute, say) was read
     * only so far ahead: the gaps of the others are read no further, or a
     * daily job beside it would seem to leave a day between runs.
     */
    if (!listed.reachedEnd) {
      windowEnd = Math.min(
        windowEnd,
        listed.runs[listed.runs.length - 1] as number,
      );
    }

    runsBySchedule.push(listed.runs);
  }

  const runs: Array<number> = Array.from(
    new Set(
      runsBySchedule.flat().filter((time: number): boolean => {
        return time <= windowEnd;
      }),
    ),
  ).sort((left: number, right: number): number => {
    return left - right;
  });

  if (runs.length < 2) {
    return null;
  }

  let longest: number = 0;
  for (let index: number = 1; index < runs.length; index++) {
    longest = Math.max(
      longest,
      (runs[index] as number) - (runs[index - 1] as number),
    );
  }

  return longest > 0 ? Math.round(longest / 1000) : null;
}

// The grace a VM's backup is given past its interval.
export function getXcpNgBackupGraceSeconds(intervalSeconds: number): number {
  return Math.max(
    XCP_NG_BACKUP_MIN_GRACE_SECONDS,
    Math.round(intervalSeconds * XCP_NG_BACKUP_GRACE_SHARE),
  );
}

/*
 * Whether a VM's backup is overdue. With no successful backup on record,
 * it is counted from when OneUptime started reading the pool's backups
 * (`watchedSince`): a VM whose last good backup is older than what the
 * first read looked back over is caught once its interval has passed
 * since then, never on the first minute.
 */
export function isXcpNgVmBackupOverdue(data: {
  intervalSeconds: number | null | undefined;
  lastSuccessfulBackupAt: Date | null | undefined;
  watchedSince: Date | null | undefined;
  now: Date;
}): boolean {
  if (
    data.intervalSeconds === null ||
    data.intervalSeconds === undefined ||
    !Number.isFinite(data.intervalSeconds) ||
    data.intervalSeconds <= 0
  ) {
    return false;
  }

  const reference: Date | null | undefined =
    data.lastSuccessfulBackupAt || data.watchedSince;

  if (!reference || isNaN(reference.getTime())) {
    return false;
  }

  const allowedMs: number =
    (data.intervalSeconds + getXcpNgBackupGraceSeconds(data.intervalSeconds)) *
    1000;

  return data.now.getTime() - reference.getTime() > allowedMs;
}
