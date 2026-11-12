import ProductType from "../MeteredPlan/ProductType";
import moment from "moment-timezone";

/*
 * Telemetry ingestion budgets: how many bytes of each signal a project - and
 * each ingestion key in it - may send in a budget day, and how fast.
 *
 *   - The instance admin sets a default for every project (Admin Dashboard >
 *     Settings > Ingestion Budgets, GlobalConfig) and may override it for one
 *     project (Admin Dashboard > Projects > a project > Ingestion Budgets).
 *     A project's own admins see their budget but cannot raise it.
 *   - Whoever edits an ingestion key may give the key a budget of its own. It
 *     only subdivides the project's: a key budget above the project's is
 *     refused when it is saved, and held to the project's when the project's
 *     is lowered later.
 *   - Each level may also set a per-second rate, so one burst cannot spend a
 *     day's budget in minutes.
 *
 * Bytes are counted as telemetry arrives, decompressed, in shared Valkey
 * counters (Server/Utils/Telemetry/TelemetryIngestionBudgetCounter), one per
 * scope, signal and budget day. This module is the vocabulary every side
 * shares - the ingest gate, the worker, the API, the Dashboard and the Admin
 * Dashboard - so it is React-free and import-light.
 */

export type TelemetryIngestionBudgetSignal =
  | ProductType.Logs
  | ProductType.Traces
  | ProductType.Metrics
  | ProductType.Profiles
  | ProductType.SecurityEvents;

/*
 * The signals a budget can be set for, in the order they are shown. Session
 * replay is not one: it has budgets of its own, a daily byte limit per project
 * and a monthly budget per application, which tell its recorders to stop.
 */
export const TELEMETRY_INGESTION_BUDGET_SIGNALS: ReadonlyArray<TelemetryIngestionBudgetSignal> =
  [
    ProductType.Logs,
    ProductType.Traces,
    ProductType.Metrics,
    ProductType.Profiles,
    ProductType.SecurityEvents,
  ];

export const isTelemetryIngestionBudgetSignal: (
  value: unknown,
) => value is TelemetryIngestionBudgetSignal = (
  value: unknown,
): value is TelemetryIngestionBudgetSignal => {
  return TELEMETRY_INGESTION_BUDGET_SIGNALS.includes(
    value as TelemetryIngestionBudgetSignal,
  );
};

/*
 * How a signal is spelled in the counters' keys and in the `signal`
 * attribute of the published budget metrics.
 */
const SIGNAL_SLUGS: Record<TelemetryIngestionBudgetSignal, string> = {
  [ProductType.Logs]: "logs",
  [ProductType.Traces]: "traces",
  [ProductType.Metrics]: "metrics",
  [ProductType.Profiles]: "profiles",
  [ProductType.SecurityEvents]: "security-events",
};

// How a signal reads inside a sentence: "the project's daily logs budget".
const SIGNAL_WORDS: Record<TelemetryIngestionBudgetSignal, string> = {
  [ProductType.Logs]: "logs",
  [ProductType.Traces]: "traces",
  [ProductType.Metrics]: "metrics",
  [ProductType.Profiles]: "profiles",
  [ProductType.SecurityEvents]: "security events",
};

export const getTelemetryIngestionBudgetSignalSlug: (
  signal: TelemetryIngestionBudgetSignal,
) => string = (signal: TelemetryIngestionBudgetSignal): string => {
  return SIGNAL_SLUGS[signal];
};

export const getTelemetryIngestionBudgetSignalFromSlug: (
  slug: string,
) => TelemetryIngestionBudgetSignal | null = (
  slug: string,
): TelemetryIngestionBudgetSignal | null => {
  for (const signal of TELEMETRY_INGESTION_BUDGET_SIGNALS) {
    if (SIGNAL_SLUGS[signal] === slug) {
      return signal;
    }
  }

  return null;
};

export const getTelemetryIngestionBudgetSignalWords: (
  signal: TelemetryIngestionBudgetSignal,
) => string = (signal: TelemetryIngestionBudgetSignal): string => {
  return SIGNAL_WORDS[signal];
};

/*
 * The columns each level stores a signal's limits in. The same names on
 * GlobalConfig (the instance default), Project (one project's override) and
 * TelemetryIngestionKey (one key's own budget), so every reader and writer
 * walks one table.
 */
export interface TelemetryIngestionBudgetColumnNames {
  dailyBudgetInGB: string;
  rateLimitInMBPerSecond: string;
}

export const TELEMETRY_INGESTION_BUDGET_COLUMNS: Record<
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetColumnNames
> = {
  [ProductType.Logs]: {
    dailyBudgetInGB: "logsDailyIngestionBudgetInGB",
    rateLimitInMBPerSecond: "logsIngestionRateLimitInMBPerSecond",
  },
  [ProductType.Traces]: {
    dailyBudgetInGB: "tracesDailyIngestionBudgetInGB",
    rateLimitInMBPerSecond: "tracesIngestionRateLimitInMBPerSecond",
  },
  [ProductType.Metrics]: {
    dailyBudgetInGB: "metricsDailyIngestionBudgetInGB",
    rateLimitInMBPerSecond: "metricsIngestionRateLimitInMBPerSecond",
  },
  [ProductType.Profiles]: {
    dailyBudgetInGB: "profilesDailyIngestionBudgetInGB",
    rateLimitInMBPerSecond: "profilesIngestionRateLimitInMBPerSecond",
  },
  [ProductType.SecurityEvents]: {
    dailyBudgetInGB: "securityEventsDailyIngestionBudgetInGB",
    rateLimitInMBPerSecond: "securityEventsIngestionRateLimitInMBPerSecond",
  },
};

export const TELEMETRY_INGESTION_BUDGET_DAILY_COLUMN_NAMES: ReadonlyArray<string> =
  TELEMETRY_INGESTION_BUDGET_SIGNALS.map(
    (signal: TelemetryIngestionBudgetSignal): string => {
      return TELEMETRY_INGESTION_BUDGET_COLUMNS[signal].dailyBudgetInGB;
    },
  );

export const TELEMETRY_INGESTION_BUDGET_RATE_COLUMN_NAMES: ReadonlyArray<string> =
  TELEMETRY_INGESTION_BUDGET_SIGNALS.map(
    (signal: TelemetryIngestionBudgetSignal): string => {
      return TELEMETRY_INGESTION_BUDGET_COLUMNS[signal].rateLimitInMBPerSecond;
    },
  );

export const TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES: ReadonlyArray<string> = [
  ...TELEMETRY_INGESTION_BUDGET_DAILY_COLUMN_NAMES,
  ...TELEMETRY_INGESTION_BUDGET_RATE_COLUMN_NAMES,
];

/*
 * The instance-wide settings beside the default budgets: when the budget day
 * starts again, in which time zone, and at what share of a budget the
 * project is warned. GlobalConfig only.
 */
export const TELEMETRY_INGESTION_BUDGET_WARNING_PERCENT_COLUMN: string =
  "telemetryIngestionBudgetWarningPercent";
export const TELEMETRY_INGESTION_BUDGET_RESET_TIME_COLUMN: string =
  "telemetryIngestionBudgetResetTime";
export const TELEMETRY_INGESTION_BUDGET_RESET_TIMEZONE_COLUMN: string =
  "telemetryIngestionBudgetResetTimezone";

/*
 * "GB" is GiB, as on the Usage page and in session replay's budgets: a usage
 * figure and the budget it is measured against are in the same unit. "MB"
 * likewise is MiB.
 */
export const TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB: number =
  1024 * 1024 * 1024;
export const TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB: number = 1024 * 1024;

/*
 * The largest values a budget or a rate may be saved with: a petabyte a day,
 * a terabyte a second. Far past anything one project sends; they only keep a
 * typo from turning into a number that is not one.
 */
export const TELEMETRY_INGESTION_BUDGET_MAX_DAILY_GB: number = 1_000_000;
export const TELEMETRY_INGESTION_BUDGET_MAX_RATE_MB_PER_SECOND: number = 1_000_000;

export const telemetryIngestionBudgetGBToBytes: (
  gigabytes: number,
) => number = (gigabytes: number): number => {
  return Math.floor(gigabytes * TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB);
};

export const telemetryIngestionBudgetMBToBytes: (
  megabytes: number,
) => number = (megabytes: number): number => {
  return Math.floor(megabytes * TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB);
};

/*
 * One signal's limits as a row stores them. null is "not set": the instance
 * default for a project, no budget of its own for a key, none at all for
 * the instance. On a project, 0 is "no limit for this project", which is how
 * an instance admin exempts one project from the default.
 */
export interface TelemetryIngestionBudgetStoredLimits {
  dailyBudgetInGB: number | null;
  rateLimitInMBPerSecond: number | null;
}

export type TelemetryIngestionBudgetStoredSettings = Record<
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetStoredLimits
>;

export const getEmptyTelemetryIngestionBudgetStoredSettings: () => TelemetryIngestionBudgetStoredSettings =
  (): TelemetryIngestionBudgetStoredSettings => {
    const settings: Partial<TelemetryIngestionBudgetStoredSettings> = {};

    for (const signal of TELEMETRY_INGESTION_BUDGET_SIGNALS) {
      settings[signal] = {
        dailyBudgetInGB: null,
        rateLimitInMBPerSecond: null,
      };
    }

    return settings as TelemetryIngestionBudgetStoredSettings;
  };

/*
 * A stored value as a number, or null. Lenient, as a read must be: a decimal
 * column arrives as a string from some drivers, and anything negative, not a
 * number or not finite is read as not set - the direction in which a bad row
 * changes nothing, rather than blocking a signal.
 */
export const readTelemetryIngestionBudgetStoredValue: (
  value: unknown,
) => number | null = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  let parsed: number = NaN;

  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    parsed = value.trim() === "" ? NaN : Number(value.trim());
  } else if (
    typeof value === "object" &&
    "value" in (value as Record<string, unknown>)
  ) {
    // A Decimal, as the model layer wraps a decimal column.
    parsed = Number((value as Record<string, unknown>)["value"]);
  }

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
};

// The budget columns of a GlobalConfig, Project or TelemetryIngestionKey row.
export const readTelemetryIngestionBudgetStoredSettings: (
  row: unknown,
) => TelemetryIngestionBudgetStoredSettings = (
  row: unknown,
): TelemetryIngestionBudgetStoredSettings => {
  const settings: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();

  if (!row || typeof row !== "object") {
    return settings;
  }

  const record: Record<string, unknown> = row as Record<string, unknown>;

  for (const signal of TELEMETRY_INGESTION_BUDGET_SIGNALS) {
    const columns: TelemetryIngestionBudgetColumnNames =
      TELEMETRY_INGESTION_BUDGET_COLUMNS[signal];

    settings[signal] = {
      dailyBudgetInGB: readTelemetryIngestionBudgetStoredValue(
        record[columns.dailyBudgetInGB],
      ),
      rateLimitInMBPerSecond: readTelemetryIngestionBudgetStoredValue(
        record[columns.rateLimitInMBPerSecond],
      ),
    };
  }

  return settings;
};

// Whether any signal of these settings has a limit set (0 counts as set).
export const hasAnyTelemetryIngestionBudgetSetting: (
  settings: TelemetryIngestionBudgetStoredSettings | null,
) => boolean = (
  settings: TelemetryIngestionBudgetStoredSettings | null,
): boolean => {
  if (!settings) {
    return false;
  }

  return TELEMETRY_INGESTION_BUDGET_SIGNALS.some(
    (signal: TelemetryIngestionBudgetSignal): boolean => {
      return (
        settings[signal].dailyBudgetInGB !== null ||
        settings[signal].rateLimitInMBPerSecond !== null
      );
    },
  );
};

export enum TelemetryIngestionBudgetScope {
  Project = "project",
  IngestionKey = "ingestion-key",
}

// Where a limit in force comes from.
export enum TelemetryIngestionBudgetLimitSource {
  Instance = "instance",
  Project = "project",
  IngestionKey = "ingestion-key",
}

/*
 * A limit in force: bytes (a day's budget) or bytes per second (a rate), and
 * where it was set. bytes null is "no limit"; source is null then too, except
 * when a project's override of 0 lifted the instance default (source
 * Project, bytes null).
 */
export interface TelemetryIngestionBudgetLimit {
  bytes: number | null;
  source: TelemetryIngestionBudgetLimitSource | null;
}

export interface TelemetryIngestionBudgetResolvedScope {
  dailyBudget: TelemetryIngestionBudgetLimit;
  rateLimit: TelemetryIngestionBudgetLimit;
}

export interface TelemetryIngestionBudgetResolved {
  project: TelemetryIngestionBudgetResolvedScope;
  // null when the request came with no ingestion key, or the key sets nothing.
  ingestionKey: TelemetryIngestionBudgetResolvedScope | null;
}

const NO_LIMIT: TelemetryIngestionBudgetLimit = { bytes: null, source: null };

/*
 * A project's limit for one signal and kind: its own override when the
 * instance admin set one (0 lifts the default), else the instance default,
 * else none.
 */
const resolveProjectLimit: (data: {
  override: number | null;
  instanceDefault: number | null;
  toBytes: (value: number) => number;
}) => TelemetryIngestionBudgetLimit = (data: {
  override: number | null;
  instanceDefault: number | null;
  toBytes: (value: number) => number;
}): TelemetryIngestionBudgetLimit => {
  if (data.override !== null) {
    const bytes: number = data.toBytes(data.override);

    return {
      bytes: bytes > 0 ? bytes : null,
      source: TelemetryIngestionBudgetLimitSource.Project,
    };
  }

  if (data.instanceDefault !== null) {
    const bytes: number = data.toBytes(data.instanceDefault);

    if (bytes > 0) {
      return {
        bytes: bytes,
        source: TelemetryIngestionBudgetLimitSource.Instance,
      };
    }
  }

  return NO_LIMIT;
};

/*
 * A key's limit: its own, held to the project's. A key budget saved above the
 * project's is refused when it is saved, but the project's can be lowered
 * afterwards, so it is held here too: a key can only ever subdivide its
 * project's budget.
 */
const resolveKeyLimit: (data: {
  own: number | null;
  projectLimit: TelemetryIngestionBudgetLimit;
  toBytes: (value: number) => number;
}) => TelemetryIngestionBudgetLimit = (data: {
  own: number | null;
  projectLimit: TelemetryIngestionBudgetLimit;
  toBytes: (value: number) => number;
}): TelemetryIngestionBudgetLimit => {
  if (data.own === null) {
    return NO_LIMIT;
  }

  const bytes: number = data.toBytes(data.own);

  if (bytes <= 0) {
    return NO_LIMIT;
  }

  if (data.projectLimit.bytes !== null && data.projectLimit.bytes < bytes) {
    return data.projectLimit;
  }

  return {
    bytes: bytes,
    source: TelemetryIngestionBudgetLimitSource.IngestionKey,
  };
};

// The limits in force for one signal, from the three levels' stored values.
export const resolveTelemetryIngestionBudget: (data: {
  signal: TelemetryIngestionBudgetSignal;
  instance: TelemetryIngestionBudgetStoredSettings | null;
  project: TelemetryIngestionBudgetStoredSettings | null;
  ingestionKey: TelemetryIngestionBudgetStoredSettings | null;
}) => TelemetryIngestionBudgetResolved = (data: {
  signal: TelemetryIngestionBudgetSignal;
  instance: TelemetryIngestionBudgetStoredSettings | null;
  project: TelemetryIngestionBudgetStoredSettings | null;
  ingestionKey: TelemetryIngestionBudgetStoredSettings | null;
}): TelemetryIngestionBudgetResolved => {
  const instance: TelemetryIngestionBudgetStoredLimits | null = data.instance
    ? data.instance[data.signal]
    : null;
  const project: TelemetryIngestionBudgetStoredLimits | null = data.project
    ? data.project[data.signal]
    : null;
  const key: TelemetryIngestionBudgetStoredLimits | null = data.ingestionKey
    ? data.ingestionKey[data.signal]
    : null;

  const projectScope: TelemetryIngestionBudgetResolvedScope = {
    dailyBudget: resolveProjectLimit({
      override: project?.dailyBudgetInGB ?? null,
      instanceDefault: instance?.dailyBudgetInGB ?? null,
      toBytes: telemetryIngestionBudgetGBToBytes,
    }),
    rateLimit: resolveProjectLimit({
      override: project?.rateLimitInMBPerSecond ?? null,
      instanceDefault: instance?.rateLimitInMBPerSecond ?? null,
      toBytes: telemetryIngestionBudgetMBToBytes,
    }),
  };

  if (!key) {
    return { project: projectScope, ingestionKey: null };
  }

  const keyScope: TelemetryIngestionBudgetResolvedScope = {
    dailyBudget: resolveKeyLimit({
      own: key.dailyBudgetInGB,
      projectLimit: projectScope.dailyBudget,
      toBytes: telemetryIngestionBudgetGBToBytes,
    }),
    rateLimit: resolveKeyLimit({
      own: key.rateLimitInMBPerSecond,
      projectLimit: projectScope.rateLimit,
      toBytes: telemetryIngestionBudgetMBToBytes,
    }),
  };

  const keySetsAnything: boolean =
    keyScope.dailyBudget.bytes !== null || keyScope.rateLimit.bytes !== null;

  return {
    project: projectScope,
    ingestionKey: keySetsAnything ? keyScope : null,
  };
};

// Whether anything is limited at all: no limit means no counting either.
export const isTelemetryIngestionBudgetLimited: (
  resolved: TelemetryIngestionBudgetResolved,
) => boolean = (resolved: TelemetryIngestionBudgetResolved): boolean => {
  return (
    resolved.project.dailyBudget.bytes !== null ||
    resolved.project.rateLimit.bytes !== null ||
    resolved.ingestionKey !== null
  );
};

export enum TelemetryIngestionBudgetValueKind {
  DailyBudget = "daily-budget",
  RateLimit = "rate-limit",
}

/*
 * What is wrong with a value someone is saving as a budget or a rate, or null
 * when it may be saved. Empty is always allowed (not set). 0 only where it
 * means something: on a project, "no limit for this project".
 */
export const getTelemetryIngestionBudgetValueProblem: (data: {
  value: unknown;
  kind: TelemetryIngestionBudgetValueKind;
  allowZero: boolean;
}) => string | null = (data: {
  value: unknown;
  kind: TelemetryIngestionBudgetValueKind;
  allowZero: boolean;
}): string | null => {
  if (data.value === null || data.value === undefined || data.value === "") {
    return null;
  }

  const isDaily: boolean =
    data.kind === TelemetryIngestionBudgetValueKind.DailyBudget;
  const unit: string = isDaily ? "GB per day" : "MB per second";
  const max: number = isDaily
    ? TELEMETRY_INGESTION_BUDGET_MAX_DAILY_GB
    : TELEMETRY_INGESTION_BUDGET_MAX_RATE_MB_PER_SECOND;
  const what: string = isDaily ? "A daily budget" : "A rate limit";

  let value: number = NaN;

  if (typeof data.value === "number") {
    value = data.value;
  } else if (typeof data.value === "string" && data.value.trim() !== "") {
    value = Number(data.value.trim());
  }

  if (!Number.isFinite(value)) {
    return `${what} must be a number of ${unit}.`;
  }

  if (value < 0 || (value === 0 && !data.allowZero)) {
    return data.allowZero
      ? `${what} must be 0 or more ${unit}. Use 0 for no limit, or leave it empty for the instance default.`
      : `${what} must be more than 0 ${unit}. Leave it empty for no limit.`;
  }

  if (value > max) {
    return `${what} can be at most ${max.toLocaleString("en-US")} ${unit}.`;
  }

  const bytes: number = isDaily
    ? telemetryIngestionBudgetGBToBytes(value)
    : telemetryIngestionBudgetMBToBytes(value);

  if (value > 0 && bytes < 1) {
    return `${what} must be at least one byte.`;
  }

  return null;
};

// A value that passed getTelemetryIngestionBudgetValueProblem, as stored.
export const normalizeTelemetryIngestionBudgetValue: (
  value: unknown,
) => number | null = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return typeof value === "number" ? value : Number(String(value).trim());
};

/*
 * When the budget day starts again, and where. A reset time is a local time
 * of day, HH:MM on the 24-hour clock, in an IANA time zone: the default is
 * midnight UTC.
 */
export const TELEMETRY_INGESTION_BUDGET_DEFAULT_RESET_TIME: string = "00:00";
export const TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE: string = "UTC";

// A project is warned when this share of a budget is used: 80% by default.
export const TELEMETRY_INGESTION_BUDGET_DEFAULT_WARNING_PERCENT: number = 80;
export const TELEMETRY_INGESTION_BUDGET_MIN_WARNING_PERCENT: number = 1;
export const TELEMETRY_INGESTION_BUDGET_MAX_WARNING_PERCENT: number = 99;

const RESET_TIME_PATTERN: RegExp = /^([01]?\d|2[0-3]):([0-5]\d)$/;

interface ParsedResetTime {
  hour: number;
  minute: number;
}

const parseResetTime: (value: unknown) => ParsedResetTime | null = (
  value: unknown,
): ParsedResetTime | null => {
  if (typeof value !== "string") {
    return null;
  }

  const match: RegExpExecArray | null = RESET_TIME_PATTERN.exec(value.trim());

  if (!match) {
    return null;
  }

  return { hour: Number(match[1]), minute: Number(match[2]) };
};

const isKnownTimezone: (value: string) => boolean = (
  value: string,
): boolean => {
  return moment.tz.zone(value) !== null;
};

export const getTelemetryIngestionBudgetResetTimeProblem: (
  value: unknown,
) => string | null = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (!parseResetTime(value)) {
    return "The reset time must be a time of day on the 24-hour clock, written HH:MM, for example 00:00 or 18:30.";
  }

  return null;
};

export const getTelemetryIngestionBudgetTimezoneProblem: (
  value: unknown,
) => string | null = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string" || !isKnownTimezone(value.trim())) {
    return "The reset time zone must be an IANA time zone, for example UTC, Europe/Berlin or America/New_York.";
  }

  return null;
};

export const getTelemetryIngestionBudgetWarningPercentProblem: (
  value: unknown,
) => string | null = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  let percent: number = NaN;

  if (typeof value === "number") {
    percent = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    percent = Number(value.trim());
  }

  if (
    !Number.isInteger(percent) ||
    percent < TELEMETRY_INGESTION_BUDGET_MIN_WARNING_PERCENT ||
    percent > TELEMETRY_INGESTION_BUDGET_MAX_WARNING_PERCENT
  ) {
    return `The warning threshold must be a whole percent from ${TELEMETRY_INGESTION_BUDGET_MIN_WARNING_PERCENT} to ${TELEMETRY_INGESTION_BUDGET_MAX_WARNING_PERCENT}.`;
  }

  return null;
};

// The reset time in force: the saved one, or 00:00 for anything else.
export const getTelemetryIngestionBudgetResetTime: (
  configured: unknown,
) => string = (configured: unknown): string => {
  const parsed: ParsedResetTime | null = parseResetTime(configured);

  if (!parsed) {
    return TELEMETRY_INGESTION_BUDGET_DEFAULT_RESET_TIME;
  }

  return `${String(parsed.hour).padStart(2, "0")}:${String(
    parsed.minute,
  ).padStart(2, "0")}`;
};

// The reset time zone in force: the saved one, or UTC for anything else.
export const getTelemetryIngestionBudgetTimezone: (
  configured: unknown,
) => string = (configured: unknown): string => {
  if (typeof configured !== "string") {
    return TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE;
  }

  const trimmed: string = configured.trim();

  if (!trimmed || !isKnownTimezone(trimmed)) {
    return TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE;
  }

  return trimmed;
};

// The warning threshold in force: the saved one, or 80 for anything else.
export const getTelemetryIngestionBudgetWarningPercent: (
  configured: unknown,
) => number = (configured: unknown): number => {
  if (
    configured === null ||
    configured === undefined ||
    configured === "" ||
    getTelemetryIngestionBudgetWarningPercentProblem(configured) !== null
  ) {
    return TELEMETRY_INGESTION_BUDGET_DEFAULT_WARNING_PERCENT;
  }

  return Number(configured);
};

/*
 * One budget day: when it started, when it resets, and the id its counters
 * are kept under.
 *
 * The id is the UTC instant the day started, so it changes whenever the
 * period does: a reset time or time zone changed in the middle of a day
 * starts a new day (with counters at zero) rather than resuming another
 * day's counters that happen to share a calendar date.
 */
export interface TelemetryIngestionBudgetDay {
  id: string;
  startsAt: Date;
  resetsAt: Date;
}

/*
 * The budget day `now` is in. The reset follows the local clock of the time
 * zone: on the day daylight saving time starts the budget day is an hour
 * shorter, on the day it ends an hour longer. A reset time the clock skips
 * that day (02:30 when 02:00 jumps to 03:00) happens as long after the jump
 * as it was after the hour (03:30); one the clock passes twice happens the
 * first time.
 */
export const getTelemetryIngestionBudgetDay: (data: {
  now: Date;
  resetTime?: string | null | undefined;
  timezone?: string | null | undefined;
}) => TelemetryIngestionBudgetDay = (data: {
  now: Date;
  resetTime?: string | null | undefined;
  timezone?: string | null | undefined;
}): TelemetryIngestionBudgetDay => {
  const timezone: string = getTelemetryIngestionBudgetTimezone(data.timezone);
  const resetTime: ParsedResetTime = parseResetTime(
    getTelemetryIngestionBudgetResetTime(data.resetTime),
  ) || { hour: 0, minute: 0 };
  const nowMs: number = data.now.getTime();

  // The reset on the local calendar day `localDay` is in.
  const resetOn: (localDay: moment.Moment) => moment.Moment = (
    localDay: moment.Moment,
  ): moment.Moment => {
    return moment.tz(
      {
        year: localDay.year(),
        month: localDay.month(),
        date: localDay.date(),
        hour: resetTime.hour,
        minute: resetTime.minute,
        second: 0,
        millisecond: 0,
      },
      timezone,
    );
  };

  const today: moment.Moment = moment.tz(nowMs, timezone);

  let start: moment.Moment = resetOn(today);

  if (start.valueOf() > nowMs) {
    start = resetOn(today.clone().subtract(1, "day"));
  }

  let resetsAt: moment.Moment = resetOn(
    moment.tz(start.valueOf(), timezone).add(1, "day"),
  );

  /*
   * Both bounds are on a local clock that can jump, so step until now is
   * inside them: a reset the clock skips can land after now, and the next
   * day's on or before it.
   */
  while (start.valueOf() > nowMs) {
    start = resetOn(moment.tz(start.valueOf(), timezone).subtract(1, "day"));
  }

  while (resetsAt.valueOf() <= nowMs) {
    start = resetsAt;
    resetsAt = resetOn(moment.tz(resetsAt.valueOf(), timezone).add(1, "day"));
  }

  return {
    id: moment.utc(start.valueOf()).format("YYYYMMDD[T]HHmm[Z]"),
    startsAt: new Date(start.valueOf()),
    resetsAt: new Date(resetsAt.valueOf()),
  };
};

// The used bytes at which a daily budget's warning is crossed.
export const getTelemetryIngestionBudgetWarningBytes: (data: {
  dailyBudgetBytes: number;
  warningPercent: number;
}) => number = (data: {
  dailyBudgetBytes: number;
  warningPercent: number;
}): number => {
  return Math.max(
    1,
    Math.ceil((data.dailyBudgetBytes * data.warningPercent) / 100),
  );
};

export enum TelemetryIngestionBudgetState {
  // No daily budget is in force for the signal.
  NoBudget = "no-budget",
  Ok = "ok",
  // At or past the warning threshold, still accepted.
  Warning = "warning",
  // Used up: refused (or dropped) until the reset.
  Exhausted = "exhausted",
  // The counters could not be read.
  Unknown = "unknown",
}

/*
 * Percent of a daily budget used, rounded DOWN to 0.01, so ">= 100" holds
 * exactly when the gate refuses (used >= budget). Not capped at 100: the
 * request that crosses the line is stored, and a budget lowered below the
 * day's usage is honestly over it.
 */
export const computeTelemetryIngestionBudgetPercentUsed: (data: {
  usedBytes: number | null;
  dailyBudgetBytes: number | null;
}) => number | null = (data: {
  usedBytes: number | null;
  dailyBudgetBytes: number | null;
}): number | null => {
  if (
    data.usedBytes === null ||
    data.dailyBudgetBytes === null ||
    !Number.isFinite(data.usedBytes) ||
    !Number.isFinite(data.dailyBudgetBytes) ||
    data.dailyBudgetBytes <= 0
  ) {
    return null;
  }

  const used: number = Math.max(0, data.usedBytes);

  return Math.floor((used / data.dailyBudgetBytes) * 10000) / 100;
};

export const getTelemetryIngestionBudgetState: (data: {
  usedBytes: number | null;
  dailyBudgetBytes: number | null;
  warningPercent: number;
}) => TelemetryIngestionBudgetState = (data: {
  usedBytes: number | null;
  dailyBudgetBytes: number | null;
  warningPercent: number;
}): TelemetryIngestionBudgetState => {
  if (data.dailyBudgetBytes === null) {
    return TelemetryIngestionBudgetState.NoBudget;
  }

  if (data.usedBytes === null) {
    return TelemetryIngestionBudgetState.Unknown;
  }

  if (data.usedBytes >= data.dailyBudgetBytes) {
    return TelemetryIngestionBudgetState.Exhausted;
  }

  if (
    data.usedBytes >=
    getTelemetryIngestionBudgetWarningBytes({
      dailyBudgetBytes: data.dailyBudgetBytes,
      warningPercent: data.warningPercent,
    })
  ) {
    return TelemetryIngestionBudgetState.Warning;
  }

  return TelemetryIngestionBudgetState.Ok;
};

const formatAmount: (value: number) => string = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  if (Number.isInteger(value)) {
    return value.toLocaleString("en-US");
  }

  if (value >= 1) {
    return (Math.round(value * 1000) / 1000).toLocaleString("en-US", {
      maximumFractionDigits: 3,
    });
  }

  return String(Number(value.toPrecision(3)));
};

/*
 * A number of GB for a sentence: whole when it is, else at most three
 * decimals ("10 GB", "1.5 GB"), or three significant digits below one
 * ("0.5 GB", "0.00195 GB").
 */
export const formatTelemetryIngestionBudgetGB: (bytes: number) => string = (
  bytes: number,
): string => {
  return `${formatAmount(bytes / TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB)} GB`;
};

export const formatTelemetryIngestionBudgetMBPerSecond: (
  bytesPerSecond: number,
) => string = (bytesPerSecond: number): string => {
  return `${formatAmount(
    bytesPerSecond / TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB,
  )} MB per second`;
};

/*
 * One signal's budget in one scope today, as the status API answers it and
 * the Dashboard and the Admin Dashboard draw it. A figure that could not be
 * read is null, never 0: "nothing used" would be a lie while the gate may be
 * refusing.
 */
export interface TelemetryIngestionBudgetSignalStatus {
  signal: TelemetryIngestionBudgetSignal;
  dailyBudgetBytes: number | null;
  dailyBudgetSource: TelemetryIngestionBudgetLimitSource | null;
  rateLimitBytesPerSecond: number | null;
  rateLimitSource: TelemetryIngestionBudgetLimitSource | null;
  usedBytes: number | null;
  droppedBytes: number | null;
  droppedRequests: number | null;
  throttledRequests: number | null;
  percentUsed: number | null;
  state: TelemetryIngestionBudgetState;
  // When the warning was crossed and the budget used up today (ISO), if so.
  warningCrossedAt: string | null;
  exhaustedAt: string | null;
}

export interface TelemetryIngestionBudgetScopeStatus {
  scope: TelemetryIngestionBudgetScope;
  ingestionKeyId?: string | undefined;
  ingestionKeyName?: string | undefined;
  signals: Array<TelemetryIngestionBudgetSignalStatus>;
}

export interface TelemetryIngestionBudgetStatus {
  // The budget day the figures are for (ISO instants).
  dayStartsAt: string;
  resetsAt: string;
  resetTime: string;
  timezone: string;
  warningPercent: number;
  // false when the counters could not be read: every figure is then null.
  countersAvailable: boolean;
  project: TelemetryIngestionBudgetScopeStatus;
  // Each ingestion key of the project that has a budget or a rate of its own.
  ingestionKeys: Array<TelemetryIngestionBudgetScopeStatus>;
}

const isStatusRecord: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

// A figure the API sends as a number; anything else is not known (null).
const readStatusFigure: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

// An ISO instant that reads as a date, else null.
const readStatusInstant: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  return Number.isFinite(Date.parse(value)) ? value : null;
};

const readStatusOneOf: <T extends string>(
  value: unknown,
  values: ReadonlyArray<T>,
) => T | null = <T extends string>(
  value: unknown,
  values: ReadonlyArray<T>,
): T | null => {
  return values.includes(value as T) ? (value as T) : null;
};

const STATUS_STATES: ReadonlyArray<TelemetryIngestionBudgetState> =
  Object.values(TelemetryIngestionBudgetState);
const STATUS_SOURCES: ReadonlyArray<TelemetryIngestionBudgetLimitSource> =
  Object.values(TelemetryIngestionBudgetLimitSource);

/*
 * One signal of a scope, or null when it is not one: not an object, or a
 * signal no budget is set for. A state the reader does not know is Unknown,
 * which nothing alarms anyone about.
 */
const readSignalStatus: (
  value: unknown,
) => TelemetryIngestionBudgetSignalStatus | null = (
  value: unknown,
): TelemetryIngestionBudgetSignalStatus | null => {
  if (
    !isStatusRecord(value) ||
    !isTelemetryIngestionBudgetSignal(value["signal"])
  ) {
    return null;
  }

  return {
    signal: value["signal"],
    dailyBudgetBytes: readStatusFigure(value["dailyBudgetBytes"]),
    dailyBudgetSource: readStatusOneOf(
      value["dailyBudgetSource"],
      STATUS_SOURCES,
    ),
    rateLimitBytesPerSecond: readStatusFigure(value["rateLimitBytesPerSecond"]),
    rateLimitSource: readStatusOneOf(value["rateLimitSource"], STATUS_SOURCES),
    usedBytes: readStatusFigure(value["usedBytes"]),
    droppedBytes: readStatusFigure(value["droppedBytes"]),
    droppedRequests: readStatusFigure(value["droppedRequests"]),
    throttledRequests: readStatusFigure(value["throttledRequests"]),
    percentUsed: readStatusFigure(value["percentUsed"]),
    state:
      readStatusOneOf(value["state"], STATUS_STATES) ||
      TelemetryIngestionBudgetState.Unknown,
    warningCrossedAt: readStatusInstant(value["warningCrossedAt"]),
    exhaustedAt: readStatusInstant(value["exhaustedAt"]),
  };
};

/*
 * A scope with its signals, or null when it has no list of signals, or is a
 * key with no id to tell it by. Where it sits says which scope it is: the
 * project's own, or one of the keys. Each signal once, the first kept, as
 * the server sends them: the budget card draws a row per key and signal,
 * keyed by both, so a second row of either would be drawn over the first.
 */
const readScopeStatus: (
  value: unknown,
  scope: TelemetryIngestionBudgetScope,
) => TelemetryIngestionBudgetScopeStatus | null = (
  value: unknown,
  scope: TelemetryIngestionBudgetScope,
): TelemetryIngestionBudgetScopeStatus | null => {
  if (!isStatusRecord(value) || !Array.isArray(value["signals"])) {
    return null;
  }

  const isKey: boolean = scope === TelemetryIngestionBudgetScope.IngestionKey;
  const keyId: unknown = value["ingestionKeyId"];

  if (isKey && (typeof keyId !== "string" || keyId.trim() === "")) {
    return null;
  }

  const signals: Array<TelemetryIngestionBudgetSignalStatus> = [];

  for (const entry of value["signals"]) {
    const signal: TelemetryIngestionBudgetSignalStatus | null =
      readSignalStatus(entry);

    if (
      signal &&
      !signals.some((read: TelemetryIngestionBudgetSignalStatus): boolean => {
        return read.signal === signal.signal;
      })
    ) {
      signals.push(signal);
    }
  }

  const read: TelemetryIngestionBudgetScopeStatus = {
    scope: scope,
    signals: signals,
  };

  // Only a key has an id and a name: the project is told by its place.
  if (isKey) {
    read.ingestionKeyId = keyId as string;

    if (typeof value["ingestionKeyName"] === "string") {
      read.ingestionKeyName = value["ingestionKeyName"];
    }
  }

  return read;
};

/*
 * A status as the reading side gets it: off the network, where a proxy, an
 * older server or a test double can answer anything at all. null when the
 * answer is not a status - no project with a list of its signals, or no
 * reset time to tell - so the explorers' banner draws nothing and the
 * budget card says the read failed, instead of a page that throws while it
 * draws. Lenient past that, field by field, as a read must be: a figure that
 * is not a number is not known (null), a state or a source it does not know
 * is Unknown or none, an entry that is not a signal or a key (a key has an
 * id) is left out, as is a second entry for the same signal or key, and a
 * time zone it does not know is UTC (the reset is an instant, written with
 * its zone). A status the API sent reads back as itself.
 */
export const readTelemetryIngestionBudgetStatus: (
  value: unknown,
) => TelemetryIngestionBudgetStatus | null = (
  value: unknown,
): TelemetryIngestionBudgetStatus | null => {
  if (!isStatusRecord(value)) {
    return null;
  }

  const project: TelemetryIngestionBudgetScopeStatus | null = readScopeStatus(
    value["project"],
    TelemetryIngestionBudgetScope.Project,
  );
  const resetsAt: string | null = readStatusInstant(value["resetsAt"]);

  if (!project || !resetsAt) {
    return null;
  }

  const keyEntries: Array<unknown> = Array.isArray(value["ingestionKeys"])
    ? value["ingestionKeys"]
    : [];
  const ingestionKeys: Array<TelemetryIngestionBudgetScopeStatus> = [];
  const keyIdsRead: Set<string> = new Set<string>();

  // Each key once, the first kept, as the server sends them.
  for (const entry of keyEntries) {
    const key: TelemetryIngestionBudgetScopeStatus | null = readScopeStatus(
      entry,
      TelemetryIngestionBudgetScope.IngestionKey,
    );

    if (key && key.ingestionKeyId && !keyIdsRead.has(key.ingestionKeyId)) {
      keyIdsRead.add(key.ingestionKeyId);
      ingestionKeys.push(key);
    }
  }

  return {
    dayStartsAt: readStatusInstant(value["dayStartsAt"]) || "",
    resetsAt: resetsAt,
    resetTime: getTelemetryIngestionBudgetResetTime(value["resetTime"]),
    timezone: getTelemetryIngestionBudgetTimezone(value["timezone"]),
    warningPercent: getTelemetryIngestionBudgetWarningPercent(
      value["warningPercent"],
    ),
    // Only an explicit false: it adds a warning, so nothing else implies it.
    countersAvailable: value["countersAvailable"] !== false,
    project: project,
    ingestionKeys: ingestionKeys,
  };
};

export enum TelemetryIngestionBudgetRefusalKind {
  // The daily budget is used up: not retryable before the reset.
  DailyBudgetExhausted = "daily-budget-exhausted",
  // Over the per-second rate: retryable after retryAfterSeconds.
  RateLimited = "rate-limited",
}

// Why a request was refused, as the ingest surfaces answer it.
export interface TelemetryIngestionBudgetRefusal {
  kind: TelemetryIngestionBudgetRefusalKind;
  scope: TelemetryIngestionBudgetScope;
  signal: TelemetryIngestionBudgetSignal;
  // The sentence the sender is answered with.
  message: string;
  // For a rate refusal: when to come back.
  retryAfterSeconds: number | null;
  // When the budget day resets.
  resetsAt: Date;
}

/*
 * The status reads, under the API's own path (/api): the caller's project
 * (its tenantid header), and for the instance admin any project's
 * (TELEMETRY_INGESTION_BUDGET_ADMIN_PROJECTS_ROUTE, then /<projectId>).
 */
export const TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE: string =
  "/telemetry-ingestion-budget/project";
export const TELEMETRY_INGESTION_BUDGET_ADMIN_PROJECTS_ROUTE: string =
  "/telemetry-ingestion-budget/admin/projects";

// Where a project's members see their budgets, as emails name it.
export const TELEMETRY_INGESTION_BUDGET_PROJECT_LOCATION: string =
  "Project Settings > Telemetry & APM > Usage";
