import ProductType from "../MeteredPlan/ProductType";
import ServiceType from "./ServiceType";

/*
 * Telemetry usage: how many GB of each signal each resource of a project sent
 * on each UTC day, as the daily metering counts it into TelemetryUsageBilling
 * (TelemetryUsageBillingService). Billing reads the same rows to charge for
 * telemetry; a server without billing counts them too, at no cost, so every
 * install can see what each project and service sends.
 *
 * React-free and import-light: the server, the worker, the Dashboard, the
 * Admin Dashboard and plain node tests all read it.
 */

/*
 * The usage reads, under the API's own path (/api): one project's usage
 * (the caller's project, its tenantid header), and, for the instance admin,
 * every project's (TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE) and any one
 * project's (that route, then /<projectId>). Each takes ?startDay=&endDay=
 * (YYYY-MM-DD, UTC, both included).
 */
export const TELEMETRY_USAGE_PROJECT_ROUTE: string = "/telemetry-usage/project";
export const TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE: string =
  "/telemetry-usage/admin/projects";

/*
 * The products usage is counted for: each is one product of the usage rows,
 * staged and - where billing is on - billed on its own. Traces count the
 * exceptions recorded with them, and Profiles their samples, as billing
 * counts them.
 */
export const TELEMETRY_USAGE_PRODUCT_TYPES: ReadonlyArray<ProductType> = [
  ProductType.Logs,
  ProductType.Metrics,
  ProductType.Traces,
  ProductType.Profiles,
  ProductType.SessionReplay,
  ProductType.SecurityEvents,
];

export const isTelemetryUsageProductType: (
  value: unknown,
) => value is ProductType = (value: unknown): value is ProductType => {
  return TELEMETRY_USAGE_PRODUCT_TYPES.includes(value as ProductType);
};

/*
 * Exceptions: a signal the usage pages and the API show on their own, but
 * never a product. They are billed inside Traces, one product that sums the
 * span rows and the exception rows, so a Traces usage row keeps that sum -
 * the bytes it is billed for - and says how much of it was exceptions
 * (TelemetryUsageBilling.exceptionDataIngestedInGB). The reads show that part
 * as Exceptions and the rest as Traces. A Traces row counted before the
 * exceptions were counted apart has no such part: its exceptions stay inside
 * Traces, as they were shown when it was counted.
 *
 * Not a ProductType on purpose: every product type is metered and has a
 * price of its own, and exceptions have neither.
 */
export type TelemetryUsageExceptionsSignal = "Exceptions";

export const TELEMETRY_USAGE_EXCEPTIONS_SIGNAL: TelemetryUsageExceptionsSignal =
  "Exceptions";

export type TelemetryUsageSignal = ProductType | TelemetryUsageExceptionsSignal;

/*
 * The signals the usage pages and the API show, in the order they are shown:
 * every product, and the exceptions after the traces they are billed with.
 */
export const TELEMETRY_USAGE_SIGNALS: ReadonlyArray<TelemetryUsageSignal> = [
  ProductType.Logs,
  ProductType.Metrics,
  ProductType.Traces,
  TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
  ProductType.Profiles,
  ProductType.SessionReplay,
  ProductType.SecurityEvents,
];

export const isTelemetryUsageSignal: (
  value: unknown,
) => value is TelemetryUsageSignal = (
  value: unknown,
): value is TelemetryUsageSignal => {
  return TELEMETRY_USAGE_SIGNALS.includes(value as TelemetryUsageSignal);
};

/*
 * How long usage rows are kept: an instance-wide setting (Admin Dashboard >
 * Settings > Data Retention, GlobalConfig.telemetryUsageRetentionInDays),
 * 120 days when it is left empty.
 *
 * Never fewer than TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS, whatever is saved.
 * Metering counts every complete day of the last week that has no usage rows
 * yet (TELEMETRY_USAGE_STAGING_LOOKBACK_IN_DAYS), so a day deleted while
 * still in that week would be counted - and, with billing on, charged - a
 * second time.
 */
export const TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS: number = 120;
export const TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS: number = 30;
export const TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS: number = 3 * 365;

// The days usage rows are kept for a saved setting (null or 0: the default).
export const getTelemetryUsageRetentionInDays: (
  configured: number | null | undefined,
) => number = (configured: number | null | undefined): number => {
  const days: number = Number(configured);

  if (!Number.isFinite(days) || days <= 0) {
    return TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS;
  }

  return Math.min(
    TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS,
    Math.max(TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS, Math.floor(days)),
  );
};

/*
 * The ranges the usage pages offer, in days, and the one they open on. A
 * range ends with the newest complete UTC day: today is still being sent, so
 * it is never counted yet.
 */
export const TELEMETRY_USAGE_RANGE_OPTIONS_IN_DAYS: ReadonlyArray<number> = [
  7, 30, 90,
];
export const TELEMETRY_USAGE_DEFAULT_RANGE_IN_DAYS: number = 30;

// The longest range a usage read takes: every day a usage row can be kept.
export const TELEMETRY_USAGE_MAX_RANGE_IN_DAYS: number =
  TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS;

// The most projects one page of the instance-wide list holds.
export const TELEMETRY_USAGE_MAX_PROJECTS_PAGE_SIZE: number = 500;
export const TELEMETRY_USAGE_DEFAULT_PROJECTS_PAGE_SIZE: number = 50;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const DAY_PATTERN: RegExp = /^(\d{4})-(\d{2})-(\d{2})$/;

// A UTC day as the usage reads name it: YYYY-MM-DD.
export const toTelemetryUsageDay: (date: Date) => string = (
  date: Date,
): string => {
  return date.toISOString().slice(0, 10);
};

// The UTC midnight a YYYY-MM-DD day starts at, or null for anything else.
export const parseTelemetryUsageDay: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (typeof value !== "string") {
    return null;
  }

  const match: RegExpExecArray | null = DAY_PATTERN.exec(value.trim());

  if (!match) {
    return null;
  }

  const year: number = Number(match[1]);
  const month: number = Number(match[2]);
  const day: number = Number(match[3]);
  const date: Date = new Date(Date.UTC(year, month - 1, day));

  // 2026-02-30 is not a day: Date.UTC would roll it into March.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
};

export interface TelemetryUsageRange {
  // The first and the last UTC day of the range, both included: YYYY-MM-DD.
  startDay: string;
  endDay: string;
}

// The `days` complete UTC days that end yesterday (UTC), as of `now`.
export const getTelemetryUsageRangeOfLastDays: (
  days: number,
  now: Date,
) => TelemetryUsageRange = (days: number, now: Date): TelemetryUsageRange => {
  const count: number = Math.max(1, Math.floor(days));
  const todayStart: number = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  return {
    startDay: toTelemetryUsageDay(new Date(todayStart - count * DAY_IN_MS)),
    endDay: toTelemetryUsageDay(new Date(todayStart - DAY_IN_MS)),
  };
};

export interface TelemetryUsageWindow {
  // UTC midnight of the first day.
  start: Date;
  // UTC midnight of the day after the last: the window is [start, end).
  end: Date;
  days: number;
}

/*
 * The window a range covers, or a sentence saying why it is not one: days
 * written YYYY-MM-DD, the first not after the last, and no more than
 * TELEMETRY_USAGE_MAX_RANGE_IN_DAYS of them.
 */
export const getTelemetryUsageWindow: (
  range: Partial<TelemetryUsageRange>,
) => TelemetryUsageWindow | string = (
  range: Partial<TelemetryUsageRange>,
): TelemetryUsageWindow | string => {
  const start: Date | null = parseTelemetryUsageDay(range.startDay);
  const last: Date | null = parseTelemetryUsageDay(range.endDay);

  if (!start || !last) {
    return "startDay and endDay are required, as days written YYYY-MM-DD.";
  }

  if (start.getTime() > last.getTime()) {
    return "startDay must not be after endDay.";
  }

  const days: number =
    Math.round((last.getTime() - start.getTime()) / DAY_IN_MS) + 1;

  if (days > TELEMETRY_USAGE_MAX_RANGE_IN_DAYS) {
    return `A range can be at most ${TELEMETRY_USAGE_MAX_RANGE_IN_DAYS} days long.`;
  }

  return {
    start: start,
    end: new Date(last.getTime() + DAY_IN_MS),
    days: days,
  };
};

// Every UTC day of a window, oldest first, as YYYY-MM-DD.
export const getTelemetryUsageDays: (
  window: TelemetryUsageWindow,
) => Array<string> = (window: TelemetryUsageWindow): Array<string> => {
  const days: Array<string> = [];

  for (
    let time: number = window.start.getTime();
    time < window.end.getTime();
    time += DAY_IN_MS
  ) {
    days.push(toTelemetryUsageDay(new Date(time)));
  }

  return days;
};

/*
 * What some usage amounts to. The cost is there only where the caller may
 * read what usage cost: billing is on, and they read billing.
 */
export interface TelemetryUsageAmount {
  dataIngestedInGB: number;
  totalCostInUSD?: number | undefined;
}

/*
 * Usage by signal (TELEMETRY_USAGE_SIGNALS): each product's, and the
 * exceptions' under TELEMETRY_USAGE_EXCEPTIONS_SIGNAL, apart from the Traces
 * they are billed with.
 */
export type TelemetryUsageByProduct = Partial<
  Record<TelemetryUsageSignal, TelemetryUsageAmount>
>;

export interface TelemetryUsageDaySummary {
  // YYYY-MM-DD (UTC).
  day: string;
  byProduct: TelemetryUsageByProduct;
  total: TelemetryUsageAmount;
}

export interface TelemetryUsageResourceSummary {
  primaryEntityId: string;
  // The kind of resource the id names; Unknown is the unattributed bucket.
  primaryEntityType: ServiceType | null;
  // Null when the resource is gone, or the caller may not read its kind.
  name: string | null;
  byProduct: TelemetryUsageByProduct;
  total: TelemetryUsageAmount;
  /*
   * The days its telemetry is kept, as counted on the newest day of the
   * range: null when it sent nothing but session replays, which its RUM
   * application keeps for days of their own (sessionReplayRetentionInDays).
   */
  retentionInDays: number | null;
  sessionReplayRetentionInDays: number | null;
}

export interface TelemetryUsageSummary {
  startDay: string;
  endDay: string;
  isCostIncluded: boolean;
  total: TelemetryUsageAmount;
  byProduct: TelemetryUsageByProduct;
  // Every day of the range, oldest first, the days with no usage included.
  days: Array<TelemetryUsageDaySummary>;
  // The resources that sent anything in the range, heaviest first.
  resources: Array<TelemetryUsageResourceSummary>;
  // The newest day counted for the project, in any range: null when none is.
  latestDay: string | null;
}

export interface TelemetryProjectUsageSummary {
  projectId: string;
  projectName: string | null;
  byProduct: TelemetryUsageByProduct;
  total: TelemetryUsageAmount;
}

// What a project list can be sorted by: the total, a signal, or the name.
export type TelemetryProjectUsageSortBy =
  | "total"
  | "name"
  | TelemetryUsageSignal;

export interface TelemetryProjectUsagePage {
  startDay: string;
  endDay: string;
  isCostIncluded: boolean;
  // Every project together.
  total: TelemetryUsageAmount;
  byProduct: TelemetryUsageByProduct;
  // The projects of this page, in the order asked for.
  projects: Array<TelemetryProjectUsageSummary>;
  // How many projects sent anything in the range.
  count: number;
  skip: number;
  limit: number;
}

export const isTelemetryProjectUsageSortBy: (
  value: unknown,
) => value is TelemetryProjectUsageSortBy = (
  value: unknown,
): value is TelemetryProjectUsageSortBy => {
  return value === "total" || value === "name" || isTelemetryUsageSignal(value);
};

// The sum of two amounts; a cost only when both carry one.
export const addTelemetryUsageAmounts: (
  first: TelemetryUsageAmount,
  second: TelemetryUsageAmount,
) => TelemetryUsageAmount = (
  first: TelemetryUsageAmount,
  second: TelemetryUsageAmount,
): TelemetryUsageAmount => {
  const sum: TelemetryUsageAmount = {
    dataIngestedInGB: first.dataIngestedInGB + second.dataIngestedInGB,
  };

  if (
    first.totalCostInUSD !== undefined &&
    second.totalCostInUSD !== undefined
  ) {
    sum.totalCostInUSD = first.totalCostInUSD + second.totalCostInUSD;
  }

  return sum;
};

// Nothing yet: zero GB, and a zero cost where cost is counted.
export const getEmptyTelemetryUsageAmount: (
  isCostIncluded: boolean,
) => TelemetryUsageAmount = (isCostIncluded: boolean): TelemetryUsageAmount => {
  return isCostIncluded
    ? { dataIngestedInGB: 0, totalCostInUSD: 0 }
    : { dataIngestedInGB: 0 };
};
