import {
  CRON_MONTH_NAMES,
  getNextCronRuns,
  isValidCronExpression,
} from "./cronSchedule";

/*
 * A MONITOR NOTHING HAS CHECKED YET (issues #8899, #8961) - the web's rule,
 * kept here because the app is built without Common's runtime code.
 *
 * Every monitor is created in the project's operational status, so until
 * its first probe result, heartbeat, email, agent report or evaluation
 * comes back it reads Operational - and for good when none ever does (a
 * self-hosted probe that never connected). No check stands behind that
 * Operational. The server stamps Monitor.firstMeasuredAt the first time
 * something measures a monitor, and the web reads it by one rule
 * (Common/Utils/Monitor/MonitorFirstCheck); this is that rule:
 *
 *   - Never measured: firstMeasuredAt was read and is empty. A monitor read
 *     without it - from a server older than the column - counts as
 *     measured, and shows its status as the app always did. A manual
 *     monitor is never "never measured": its status is a person's word.
 *   - Its status unmeasured: never measured, and still in the status it
 *     started in (operational, and not offline as well). A status an
 *     incident, a person or the server set before the first check was
 *     recorded, and is shown as it is.
 *   - Its first result overdue: a probe check, a telemetry or an
 *     infrastructure monitor whose first scheduled run after it was
 *     created is further back than the grace - two runs, and never less
 *     than five minutes (Common/Utils/Monitor/MonitorCheckScheduleUtil).
 *     A heartbeat, an agent, a network device or a Probe Status monitor
 *     has no time its first signal is due by, so it waits.
 *
 * One reading differs from MonitoringIntervalUtil's, on purpose: the
 * interval is read as cron only. The server stores it as cron
 * (MonitoringIntervalValidator) and the upgrade rewrote older rows
 * (NormalizeMonitoringInterval), so a label such as "5m" is never what a
 * monitor holds, and a value that is no cron is one the web cannot read
 * either: both then judge by the scheduler's one minute.
 *
 * Common's suite runs this file next to those rules
 * (MonitorHealthMobileParity), so the two cannot drift apart. Its only
 * import is the app's copy of CronTab (./cronSchedule): that suite runs
 * both as they are, outside the app.
 */

// The families of Common/Utils/Monitor/MonitorOverviewFamily.
export type MonitorFamily =
  | "ProbeCheck"
  | "Heartbeat"
  | "Agent"
  | "TelemetrySignal"
  | "Infrastructure"
  | "NetworkDevice"
  | "ProbeStatus"
  | "Manual";

// Each monitor type as the server stores it, by its family.
const MONITOR_FAMILIES: ReadonlyMap<string, MonitorFamily> = new Map<
  string,
  MonitorFamily
>([
  ["API", "ProbeCheck"],
  ["Website", "ProbeCheck"],
  ["IP", "ProbeCheck"],
  ["Ping", "ProbeCheck"],
  ["Port", "ProbeCheck"],
  ["SSL Certificate", "ProbeCheck"],
  ["Synthetic Monitor", "ProbeCheck"],
  ["Custom JavaScript Code", "ProbeCheck"],
  ["DNS", "ProbeCheck"],
  ["DNSSEC", "ProbeCheck"],
  ["NTP", "ProbeCheck"],
  ["Domain", "ProbeCheck"],
  ["SQL Query", "ProbeCheck"],
  ["Database", "ProbeCheck"],
  ["External Status Page", "ProbeCheck"],
  ["Incoming Request", "Heartbeat"],
  ["Incoming Email", "Heartbeat"],
  ["Server", "Agent"],
  ["Logs", "TelemetrySignal"],
  ["Metrics", "TelemetrySignal"],
  ["Traces", "TelemetrySignal"],
  ["Exceptions", "TelemetrySignal"],
  ["Profiles", "TelemetrySignal"],
  ["Security Events", "TelemetrySignal"],
  ["AI / LLM", "TelemetrySignal"],
  ["Kubernetes", "Infrastructure"],
  ["Docker", "Infrastructure"],
  ["Host", "Infrastructure"],
  ["Podman", "Infrastructure"],
  ["Docker Swarm", "Infrastructure"],
  ["Proxmox", "Infrastructure"],
  ["OpenStack", "Infrastructure"],
  ["VMware", "Infrastructure"],
  ["XCP-ng", "Infrastructure"],
  ["Ceph", "Infrastructure"],
  ["Storage Array", "Infrastructure"],
  ["IoT Device", "Infrastructure"],
  ["Network Device", "NetworkDevice"],
  ["Probe Status", "ProbeStatus"],
  ["Manual", "Manual"],
]);

/*
 * The families whose first result has a time it is due by: run on a
 * schedule. A pushed or event-driven monitor waits however long it takes.
 */
const FAMILIES_WITH_A_FIRST_CHECK_DUE: ReadonlyArray<MonitorFamily> = [
  "ProbeCheck",
  "TelemetrySignal",
  "Infrastructure",
];

// The scheduler's fallback for an interval it cannot read: every minute.
const DEFAULT_CADENCE_SECONDS: number = 60;

export interface MonitorFirstCheckFields {
  monitorType?: string | null | undefined;
  /*
   * NULL as read when nothing has measured the monitor; undefined when the
   * column was not read.
   */
  firstMeasuredAt?: string | Date | null | undefined;
}

export interface StartingStatusFlags {
  isOperationalState?: boolean | null | undefined;
  isOfflineState?: boolean | null | undefined;
}

export interface MonitorWithStatusFirstCheckFields
  extends MonitorFirstCheckFields {
  currentMonitorStatus?: StartingStatusFlags | null | undefined;
}

export interface FirstCheckScheduleFields {
  monitorType?: string | null | undefined;
  createdAt?: string | Date | null | undefined;
  monitoringInterval?: string | null | undefined;
}

/*
 * The family of a monitor type as the server stores it ("SSL Certificate",
 * "Incoming Request"), or null for a type this build does not know.
 */
export function getMonitorFamily(
  monitorType: string | null | undefined,
): MonitorFamily | null {
  if (typeof monitorType !== "string") {
    return null;
  }

  return MONITOR_FAMILIES.get(monitorType) ?? null;
}

/*
 * Whether nothing has measured the monitor: firstMeasuredAt read and empty,
 * on a monitor something checks. False for a manual monitor, for one read
 * without the column, and for one read without its type.
 */
export function isNeverMeasured(
  monitor: MonitorFirstCheckFields | null | undefined,
): boolean {
  if (!monitor || monitor.firstMeasuredAt !== null) {
    return false;
  }

  if (!monitor.monitorType) {
    return false;
  }

  return monitor.monitorType !== "Manual";
}

/*
 * Whether a status is the one a monitor starts in: operational, and not
 * offline as well. A status read without the flags is not.
 */
export function isStartingStatus(
  status: StartingStatusFlags | null | undefined,
): boolean {
  return status?.isOperationalState === true && status.isOfflineState !== true;
}

/*
 * Whether the status the monitor holds is only the one it was created in:
 * nothing has measured it, and nothing else has moved it either.
 */
export function isStatusUnmeasured(
  monitor: MonitorWithStatusFirstCheckFields | null | undefined,
): boolean {
  return (
    isNeverMeasured(monitor) && isStartingStatus(monitor?.currentMonitorStatus)
  );
}

/*
 * The cron a stored monitoring interval holds, with its whitespace
 * collapsed as the web reads it, or null for none or one that is no cron.
 */
export function readMonitoringInterval(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const collapsed: string = value.replace(/[\s\u00a0]+/g, " ").trim();

  if (collapsed === "") {
    return null;
  }

  return isValidCronExpression(collapsed) ? collapsed : null;
}

/*
 * A time as the API hands one over (ISO text; a Date or epoch milliseconds
 * from a caller), or undefined for none or one that cannot be read. A Date
 * is told by its tag, not instanceof, so one made elsewhere still reads.
 */
export function parseMonitorDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  let parsed: Date | undefined = undefined;

  if (Object.prototype.toString.call(value) === "[object Date]") {
    parsed = new Date((value as Date).getTime());
  } else if (typeof value === "string") {
    parsed = new Date(value.trim());
  } else if (typeof value === "number") {
    parsed = new Date(value);
  } else if (typeof value === "object") {
    const typed: { _type?: unknown; value?: unknown } = value as {
      _type?: unknown;
      value?: unknown;
    };

    if (
      (typed._type === "Date" || typed._type === "DateTime") &&
      typeof typed.value === "string" &&
      typed.value
    ) {
      parsed = new Date(typed.value.trim());
    }
  }

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

const CRON_FIELD_SEPARATOR: RegExp = /\s+/;
const DIGITS_ONLY: RegExp = /^\d+$/;

// The most days each month ever has: February has 29 in a leap year.
const LONGEST_MONTH_DAYS: Array<number> = [
  31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

/*
 * Schedules found never to run, remembered so the search for a run that
 * does not exist is made once. Only those are kept, so this stays tiny.
 */
const SCHEDULES_WITHOUT_RUNS: Set<string> = new Set<string>();
const MAX_SCHEDULES_WITHOUT_RUNS: number = 64;

function rememberScheduleWithoutRuns(cron: string): void {
  if (SCHEDULES_WITHOUT_RUNS.size >= MAX_SCHEDULES_WITHOUT_RUNS) {
    SCHEDULES_WITHOUT_RUNS.clear();
  }

  SCHEDULES_WITHOUT_RUNS.add(cron);
}

// The values a cron field allows, or null for one this does not read.
function expandCronField(data: {
  field: string;
  min: number;
  max: number;
  names?: ReadonlyArray<string> | undefined;
}): Array<number> | null {
  const readValue: (raw: string) => number | null = (
    raw: string,
  ): number | null => {
    const token: string = raw.trim().toLowerCase();
    let value: number = Number.NaN;

    if (DIGITS_ONLY.test(token)) {
      value = parseInt(token, 10);
    } else if (data.names) {
      const index: number = data.names.indexOf(token.slice(0, 3));

      if (index !== -1) {
        value = index + data.min;
      }
    }

    return value >= data.min && value <= data.max ? value : null;
  };

  const values: Array<number> = [];

  for (const rawTerm of data.field.split(",")) {
    const [rangePart, stepPart, ...extra]: Array<string> = rawTerm
      .trim()
      .split("/");

    if (!rangePart || extra.length > 0) {
      return null;
    }

    let step: number = 1;

    if (stepPart !== undefined) {
      step = DIGITS_ONLY.test(stepPart) ? parseInt(stepPart, 10) : 0;

      if (step <= 0) {
        return null;
      }
    }

    let start: number | null = null;
    let end: number | null = null;

    if (rangePart === "*") {
      start = data.min;
      end = data.max;
    } else if (rangePart.includes("-")) {
      const [startText, endText, ...rangeExtra]: Array<string> =
        rangePart.split("-");

      if (
        startText === undefined ||
        endText === undefined ||
        rangeExtra.length > 0
      ) {
        return null;
      }

      start = readValue(startText);
      end = readValue(endText);
    } else {
      start = readValue(rangePart);
      end = stepPart === undefined ? start : data.max;
    }

    if (start === null || end === null || start > end) {
      return null;
    }

    for (let value: number = start; value <= end; value += step) {
      values.push(value);
    }
  }

  return values.length > 0 ? values : null;
}

/*
 * True for a schedule known never to run, and for one whose day fields show
 * it: a day of the month that no allowed month has ("0 0 30 2 *"). The
 * scheduler (cron-parser) refuses a single month without such a day
 * whatever the day of the week says, and over several months ORs the day of
 * the week in, so only a bare "*" there leaves the day of the month to
 * decide.
 */
function isScheduleWithoutRuns(cron: string): boolean {
  if (SCHEDULES_WITHOUT_RUNS.has(cron)) {
    return true;
  }

  const fields: Array<string> = cron.trim().split(CRON_FIELD_SEPARATOR);

  if (fields.length !== 5 && fields.length !== 6) {
    return false;
  }

  // A sixth field is a leading seconds field.
  const offset: number = fields.length - 5;
  const dayOfMonthField: string = fields[2 + offset]!;
  const monthField: string = fields[3 + offset]!;
  const dayOfWeekField: string = fields[4 + offset]!;

  if (dayOfMonthField === "*") {
    return false;
  }

  const days: Array<number> | null = expandCronField({
    field: dayOfMonthField,
    min: 1,
    max: 31,
  });
  const months: Array<number> | null = expandCronField({
    field: monthField,
    min: 1,
    max: 12,
    names: CRON_MONTH_NAMES,
  });

  if (!days || !months || days.length === 0 || months.length === 0) {
    return false;
  }

  const firstDay: number = Math.min(...days);
  const distinctMonths: Array<number> = Array.from(new Set(months));
  const isSingleMonthWithoutDay: boolean =
    distinctMonths.length === 1 &&
    firstDay > (LONGEST_MONTH_DAYS[distinctMonths[0]! - 1] ?? 31);
  const isEveryMonthWithoutDay: boolean =
    dayOfWeekField === "*" &&
    distinctMonths.every((month: number): boolean => {
      return firstDay > (LONGEST_MONTH_DAYS[month - 1] ?? 31);
    });
  const hasNoDay: boolean = isSingleMonthWithoutDay || isEveryMonthWithoutDay;

  if (hasNoDay) {
    rememberScheduleWithoutRuns(cron);
  }

  return hasNoDay;
}

// The schedule's first two runs after `after`, or null for none in reach.
function getNextTwoRuns(
  monitoringInterval: string | null | undefined,
  after: Date,
): [Date, Date] | null {
  const cron: string | null = readMonitoringInterval(monitoringInterval);

  if (!cron || !Number.isFinite(after.getTime())) {
    return null;
  }

  if (isScheduleWithoutRuns(cron)) {
    return null;
  }

  const runs: Array<Date> = getNextCronRuns(cron, 2, after);

  if (!runs[0] || !runs[1]) {
    // A schedule that runs at all always has two more runs in reach.
    rememberScheduleWithoutRuns(cron);
    return null;
  }

  return [runs[0], runs[1]];
}

function secondsBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 1000;
}

/*
 * The first run after `after`, and the seconds to the run after it; null
 * when the interval is none, no cron, or never runs.
 */
function getNextRunAfter(
  monitoringInterval: string | null | undefined,
  after: Date,
): { runAt: Date; spacingSeconds: number } | null {
  try {
    const runs: [Date, Date] | null = getNextTwoRuns(monitoringInterval, after);

    if (!runs) {
      return null;
    }

    const spacingSeconds: number = secondsBetween(runs[1], runs[0]);

    return spacingSeconds > 0
      ? { runAt: runs[0], spacingSeconds: spacingSeconds }
      : null;
  } catch {
    return null;
  }
}

// Seconds between two runs after `from`; the scheduler's minute otherwise.
function resolveCadenceSeconds(
  monitoringInterval: string | null | undefined,
  from: Date,
): number {
  const nextRun: { runAt: Date; spacingSeconds: number } | null =
    getNextRunAfter(monitoringInterval, from);

  return nextRun ? nextRun.spacingSeconds : DEFAULT_CADENCE_SECONDS;
}

/*
 * How late a result may be before it counts as overdue: two runs, and never
 * less than five minutes, as probes claim work in batches.
 */
function getGraceSeconds(cadenceSeconds: number): number {
  if (!Number.isFinite(cadenceSeconds) || cadenceSeconds < 0) {
    return 300;
  }

  return Math.max(300, 2 * cadenceSeconds);
}

/*
 * Whether a monitor that has never been measured is past the time its first
 * result was due: the web's "No results yet". Judged from its first
 * scheduled run after it was created, as a schedule with gaps ("Mondays at
 * 09:00") is not due before then; without a readable interval, one minute
 * after it was created. False for the families that have no due time, for a
 * monitor with no creation time and for a type this build does not know.
 * `now` is a time on the server's clock, as creation is.
 */
export function isFirstCheckOverdue(data: {
  monitor: FirstCheckScheduleFields;
  now: Date;
}): boolean {
  const createdAt: Date | undefined = parseMonitorDate(data.monitor.createdAt);

  if (!createdAt || !data.monitor.monitorType) {
    return false;
  }

  const family: MonitorFamily | null = getMonitorFamily(
    data.monitor.monitorType,
  );

  if (!family || !FAMILIES_WITH_A_FIRST_CHECK_DUE.includes(family)) {
    return false;
  }

  const monitoringInterval: string | undefined =
    data.monitor.monitoringInterval || undefined;
  const nextRun: { runAt: Date; spacingSeconds: number } | null =
    getNextRunAfter(monitoringInterval, createdAt);

  if (nextRun) {
    return (
      secondsBetween(data.now, nextRun.runAt) >
      getGraceSeconds(nextRun.spacingSeconds)
    );
  }

  const cadenceSeconds: number = resolveCadenceSeconds(
    monitoringInterval,
    data.now,
  );
  // A creation time from the future (clock skew) counts as just now.
  const ageSeconds: number = Math.max(0, secondsBetween(data.now, createdAt));

  return ageSeconds - cadenceSeconds > getGraceSeconds(cadenceSeconds);
}
