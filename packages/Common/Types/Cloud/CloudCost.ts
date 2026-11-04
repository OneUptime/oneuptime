import { translationKey } from "../Translator";

/*
 * WHAT A CLOUD ACCOUNT COSTS, AND HOW TO SPEND LESS.
 *
 * A cloud connection reads what its accounts cost from each cloud's own
 * billing - AWS Cost Explorer, Azure Cost Management, a Google Cloud
 * billing export in BigQuery - one figure per day, service, Region and,
 * where the cloud says it, resource (CloudCost, a table of their own). It
 * reads the ways to spend less from each cloud's own recommender - AWS
 * Cost Optimization Hub, Azure Advisor, Google Cloud's Recommender - as
 * CloudCostRecommendation rows. Costs are before credits and refunds: what
 * the resources cost, not what a promotion paid for.
 *
 * Shared by the server (the lanes that read them, the budgets that watch
 * them) and the Dashboard (the Cloud Overview, Costs and Savings, an
 * account's Costs, a resource's cost). React-free and server-safe.
 */

// How long a day's cost is kept: thirteen months and more, for a year back.
export const CLOUD_COST_HISTORY_DAYS: number = 400;

// How often a connection reads its accounts' costs: billing updates a few times a day.
export const CLOUD_COSTS_INTERVAL_MS: number = 12 * 60 * 60 * 1000;

// How often it reads the ways to spend less: the recommenders refresh daily.
export const CLOUD_SAVINGS_INTERVAL_MS: number = 24 * 60 * 60 * 1000;

/*
 * The days a projection takes its pace from: the last full week, so a
 * weekend counts once and a quiet Sunday does not halve the month.
 */
export const CLOUD_COST_PACE_DAYS: number = 7;

// The currency a figure is in when its cloud names none.
export const CLOUD_COST_DEFAULT_CURRENCY: string = "USD";

/*
 * Whether a connection could read an account's costs:
 *
 *   - reading: it did;
 *   - not-allowed: its access may not read them yet - running the setup
 *     command again gives it the permission;
 *   - not-set-up: the cloud has nothing to read until someone sets it up
 *     (Cost Explorer turned on, a billing export to BigQuery chosen);
 *   - failed: the cloud answered with an error; the next read tries again.
 */
export enum CloudCostState {
  Reading = "reading",
  NotAllowed = "not-allowed",
  NotSetUp = "not-set-up",
  Failed = "failed",
}

/*
 * One account's costs at a glance (CloudAccount.costSummary): written by
 * the server after every read of its costs, read by the Cloud Overview,
 * Costs, Budgets and the account's own pages without a query over the
 * costs themselves.
 */
export interface CloudAccountCostSummary {
  state: CloudCostState;
  // Why it could not read them, in the cloud's words, when it could not.
  message?: string | undefined;
  currency: string;
  // The calendar month so far (UTC), through the newest day read.
  monthToDate: number;
  // Last calendar month, in full.
  lastMonth: number;
  /*
   * This month over its full days - the days before the newest one read,
   * which a cloud reports late and in part - and no more of them than last
   * month had: what "how this month compares, so far" compares.
   */
  monthFullDays: number;
  // Last month over the same days of the month as monthFullDays.
  lastMonthToDate: number;
  // This month's total at the pace of the last full week.
  projectedMonth: number;
  // The last 30 days, through the newest day read.
  last30Days: number;
  // The services that cost the most this month, most first.
  topServices: Array<{ service: string; amount: number }>;
  // The newest day the cloud has reported a cost for, "2026-11-02".
  latestDay?: string | undefined;
  // When the costs were last read.
  readAt: string;
}

// At most this many services are kept on an account's summary.
export const CLOUD_COST_SUMMARY_TOP_SERVICES: number = 5;

// A day as the costs keep it: "2026-11-02", in UTC.
export function toCloudCostDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// The start of a "2026-11-02" day, in UTC.
export function fromCloudCostDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addUtcMonths(date: Date, months: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function daysInUtcMonth(date: Date): number {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

/*
 * The days a read of costs covers. A first read goes back to the start of
 * the month before last, so this month, last month and the one before are
 * there to compare from the start. After that it reads the last week - a
 * cloud corrects recent days for a while - and, in the first days of a
 * month, the whole of last month, which is still being finalised.
 */
export function getCloudCostWindow(data: { now: Date; isFirstRead: boolean }): {
  start: Date;
  end: Date;
} {
  const today: Date = startOfUtcDay(data.now);
  const end: Date = addUtcDays(today, 1);

  if (data.isFirstRead) {
    return { start: addUtcMonths(startOfUtcMonth(today), -2), end };
  }

  const weekBack: Date = addUtcDays(today, -7);
  const lastMonth: Date = addUtcMonths(startOfUtcMonth(today), -1);
  const start: Date =
    today.getUTCDate() <= 5 && lastMonth < weekBack ? lastMonth : weekBack;

  return { start, end };
}

/*
 * The month's total at the pace of the last full week: what it cost so far,
 * and every day still to come at the average of the seven days before the
 * newest one read (a cloud reports today's cost late and in part, so today
 * is never the pace). With less than a week read, the days there are.
 */
export function projectCloudMonthCost(data: {
  // Each day's total, "2026-11-02" -> amount.
  dailyTotals: Map<string, number>;
  now: Date;
}): { monthToDate: number; projectedMonth: number; latestDay?: string } {
  const monthStart: Date = startOfUtcMonth(data.now);
  const monthStartDay: string = toCloudCostDay(monthStart);
  const days: Array<string> = Array.from(data.dailyTotals.keys()).sort();
  const latestDay: string | undefined = days[days.length - 1];

  let monthToDate: number = 0;

  for (const day of days) {
    if (day >= monthStartDay && day <= toCloudCostDay(data.now)) {
      monthToDate += data.dailyTotals.get(day) || 0;
    }
  }

  if (!latestDay) {
    return { monthToDate: 0, projectedMonth: 0 };
  }

  // The pace: the full days before the newest one read.
  const paceDays: Array<string> = days
    .filter((day: string): boolean => {
      return day < latestDay;
    })
    .slice(-CLOUD_COST_PACE_DAYS);

  const paceSource: Array<string> =
    paceDays.length > 0 ? paceDays : [latestDay];
  let paceTotal: number = 0;

  for (const day of paceSource) {
    paceTotal += data.dailyTotals.get(day) || 0;
  }

  const pace: number = paceTotal / paceSource.length;
  const lastDayOfMonth: number = daysInUtcMonth(data.now);
  const latest: Date = fromCloudCostDay(latestDay);
  const reportedThrough: number =
    latest >= monthStart ? latest.getUTCDate() : 0;
  const daysLeft: number = Math.max(0, lastDayOfMonth - reportedThrough);

  return {
    monthToDate,
    projectedMonth: monthToDate + pace * daysLeft,
    latestDay,
  };
}

/*
 * An account's summary from its costs, by day and by service (what the
 * cost store holds for the window the summary needs: last month and this
 * one, and the 30 days back).
 */
export function summarizeCloudAccountCosts(data: {
  dailyTotals: Map<string, number>;
  // This month's cost by service.
  monthServices: Map<string, number>;
  currency: string;
  now: Date;
}): CloudAccountCostSummary {
  const monthStart: Date = startOfUtcMonth(data.now);
  const lastMonthStart: Date = addUtcMonths(monthStart, -1);
  const lastMonthStartDay: string = toCloudCostDay(lastMonthStart);
  const monthStartDay: string = toCloudCostDay(monthStart);
  const thirtyDaysBack: string = toCloudCostDay(addUtcDays(data.now, -29));
  const today: string = toCloudCostDay(data.now);

  const projection: {
    monthToDate: number;
    projectedMonth: number;
    latestDay?: string;
  } = projectCloudMonthCost({ dailyTotals: data.dailyTotals, now: data.now });

  /*
   * The days the month is compared with last month by: its full days, the
   * ones before the newest day read - which a cloud reports late and in
   * part, so it would read as a fall every morning - and no more of them
   * than last month had. None in a month's first day or two.
   */
  const latest: Date | null = projection.latestDay
    ? fromCloudCostDay(projection.latestDay)
    : null;
  const comparedDays: number = Math.min(
    latest && latest >= monthStart ? latest.getUTCDate() - 1 : 0,
    daysInUtcMonth(lastMonthStart),
  );

  let lastMonth: number = 0;
  let lastMonthToDate: number = 0;
  let monthFullDays: number = 0;
  let last30Days: number = 0;

  for (const [day, amount] of data.dailyTotals) {
    const dayOfMonth: number = fromCloudCostDay(day).getUTCDate();

    if (day >= lastMonthStartDay && day < monthStartDay) {
      lastMonth += amount;

      if (dayOfMonth <= comparedDays) {
        lastMonthToDate += amount;
      }
    }

    if (day >= monthStartDay && day <= today && dayOfMonth <= comparedDays) {
      monthFullDays += amount;
    }

    if (day >= thirtyDaysBack && day <= today) {
      last30Days += amount;
    }
  }

  const topServices: Array<{ service: string; amount: number }> = Array.from(
    data.monthServices.entries(),
  )
    .map(([service, amount]: [string, number]) => {
      return { service, amount };
    })
    .filter((entry: { amount: number }): boolean => {
      return entry.amount > 0;
    })
    .sort(
      (
        a: { service: string; amount: number },
        b: { service: string; amount: number },
      ): number => {
        return b.amount - a.amount || a.service.localeCompare(b.service);
      },
    )
    .slice(0, CLOUD_COST_SUMMARY_TOP_SERVICES);

  return {
    state: CloudCostState.Reading,
    currency: data.currency || CLOUD_COST_DEFAULT_CURRENCY,
    monthToDate: roundCost(projection.monthToDate),
    lastMonth: roundCost(lastMonth),
    monthFullDays: roundCost(monthFullDays),
    lastMonthToDate: roundCost(lastMonthToDate),
    projectedMonth: roundCost(projection.projectedMonth),
    last30Days: roundCost(last30Days),
    topServices: topServices.map(
      (entry: { service: string; amount: number }) => {
        return { service: entry.service, amount: roundCost(entry.amount) };
      },
    ),
    latestDay: projection.latestDay,
    readAt: data.now.toISOString(),
  };
}

/*
 * How a resource's costs are kept apart, from its id in its cloud: an
 * Azure ARM id in lower case (Cost Management writes ids in lower case and
 * Resource Graph does not - ARM ids are not case sensitive), any other id
 * as its cloud writes it. The writer and a resource's page both use it.
 */
export function getCloudCostResourceKey(
  provider: string,
  providerResourceId: string,
): string {
  const id: string = (providerResourceId || "").trim();
  return (provider || "").toLowerCase() === "azure" ? id.toLowerCase() : id;
}

// A cost to the hundredth of a cent: what any figure shown or summed needs.
export function roundCost(amount: number): number {
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.round(amount * 10000) / 10000;
}

function readNumber(value: unknown): number {
  const number: number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// A stored summary, read back: null when there is none or it is malformed.
export function readCloudAccountCostSummary(
  value: unknown,
): CloudAccountCostSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const state: unknown = record["state"];

  if (!Object.values(CloudCostState).includes(state as CloudCostState)) {
    return null;
  }

  const topServices: Array<{ service: string; amount: number }> = Array.isArray(
    record["topServices"],
  )
    ? (record["topServices"] as Array<unknown>)
        .map((entry: unknown): { service: string; amount: number } | null => {
          const item: Record<string, unknown> =
            entry && typeof entry === "object"
              ? (entry as Record<string, unknown>)
              : {};
          return typeof item["service"] === "string"
            ? { service: item["service"], amount: readNumber(item["amount"]) }
            : null;
        })
        .filter((entry: { service: string } | null): boolean => {
          return entry !== null;
        })
        .map((entry: { service: string; amount: number } | null) => {
          return entry as { service: string; amount: number };
        })
    : [];

  return {
    state: state as CloudCostState,
    message:
      typeof record["message"] === "string" && record["message"]
        ? record["message"]
        : undefined,
    currency:
      typeof record["currency"] === "string" && record["currency"]
        ? record["currency"]
        : CLOUD_COST_DEFAULT_CURRENCY,
    monthToDate: readNumber(record["monthToDate"]),
    lastMonth: readNumber(record["lastMonth"]),
    monthFullDays: readNumber(record["monthFullDays"]),
    lastMonthToDate: readNumber(record["lastMonthToDate"]),
    projectedMonth: readNumber(record["projectedMonth"]),
    last30Days: readNumber(record["last30Days"]),
    topServices,
    latestDay:
      typeof record["latestDay"] === "string" && record["latestDay"]
        ? record["latestDay"]
        : undefined,
    readAt: typeof record["readAt"] === "string" ? record["readAt"] : "",
  };
}

/*
 * The currency most of a set of figures are in, from how many are in each:
 * the alphabetically first of a tie, and the default with none.
 */
export function getMostCommonCloudCurrency(
  counts: Map<string, number>,
): string {
  return (
    Array.from(counts.entries()).sort(
      (a: [string, number], b: [string, number]): number => {
        return b[1] - a[1] || a[0].localeCompare(b[0]);
      },
    )[0]?.[0] || CLOUD_COST_DEFAULT_CURRENCY
  );
}

/*
 * Several accounts' summaries as one, for the Cloud Overview and a budget
 * over every account: only the accounts read, and only in one currency -
 * the one most of them report (a company's accounts are billed in one).
 */
export interface CloudCostTotals {
  currency: string;
  monthToDate: number;
  lastMonth: number;
  // This month and last month over the same full days (see the summary's).
  monthFullDays: number;
  lastMonthToDate: number;
  projectedMonth: number;
  last30Days: number;
  // Accounts whose costs are read, and those in another currency, left out.
  accountsRead: number;
  accountsInOtherCurrencies: number;
  // Accounts whose costs could not be read, by why.
  accountsNotAllowed: number;
  accountsNotSetUp: number;
  accountsFailed: number;
}

export function totalCloudCosts(
  summaries: Array<CloudAccountCostSummary | null>,
): CloudCostTotals {
  const read: Array<CloudAccountCostSummary> = [];
  let accountsNotAllowed: number = 0;
  let accountsNotSetUp: number = 0;
  let accountsFailed: number = 0;

  for (const summary of summaries) {
    if (!summary) {
      continue;
    }

    if (summary.state === CloudCostState.Reading) {
      read.push(summary);
    } else if (summary.state === CloudCostState.NotAllowed) {
      accountsNotAllowed++;
    } else if (summary.state === CloudCostState.NotSetUp) {
      accountsNotSetUp++;
    } else {
      accountsFailed++;
    }
  }

  const byCurrency: Map<string, number> = new Map();

  for (const summary of read) {
    byCurrency.set(
      summary.currency,
      (byCurrency.get(summary.currency) || 0) + 1,
    );
  }

  const currency: string = getMostCommonCloudCurrency(byCurrency);

  const totals: CloudCostTotals = {
    currency,
    monthToDate: 0,
    lastMonth: 0,
    monthFullDays: 0,
    lastMonthToDate: 0,
    projectedMonth: 0,
    last30Days: 0,
    accountsRead: 0,
    accountsInOtherCurrencies: 0,
    accountsNotAllowed,
    accountsNotSetUp,
    accountsFailed,
  };

  for (const summary of read) {
    if (summary.currency !== currency) {
      totals.accountsInOtherCurrencies++;
      continue;
    }

    totals.accountsRead++;
    totals.monthToDate += summary.monthToDate;
    totals.lastMonth += summary.lastMonth;
    totals.monthFullDays += summary.monthFullDays;
    totals.lastMonthToDate += summary.lastMonthToDate;
    totals.projectedMonth += summary.projectedMonth;
    totals.last30Days += summary.last30Days;
  }

  totals.monthToDate = roundCost(totals.monthToDate);
  totals.lastMonth = roundCost(totals.lastMonth);
  totals.monthFullDays = roundCost(totals.monthFullDays);
  totals.lastMonthToDate = roundCost(totals.lastMonthToDate);
  totals.projectedMonth = roundCost(totals.projectedMonth);
  totals.last30Days = roundCost(totals.last30Days);

  return totals;
}

/*
 * How this month compares with last month at the same point, as a percent
 * (+12 is 12% more): null with nothing to compare with.
 */
export function getCloudCostChangePercent(data: {
  current: number;
  previous: number;
}): number | null {
  if (!Number.isFinite(data.previous) || data.previous <= 0) {
    return null;
  }
  return ((data.current - data.previous) / data.previous) * 100;
}

/*
 * ---------------------------------------------------------------------------
 * Ways to spend less
 * ---------------------------------------------------------------------------
 */

/*
 * What a recommendation asks: the clouds' own words for it, as one kind
 * each of their recommenders' actions falls in.
 */
export enum CloudSavingKind {
  // A smaller or cheaper size, type or tier.
  Rightsize = "rightsize",
  // Stop or delete something idle or unused.
  Idle = "idle",
  // Move to a newer or cheaper generation (Graviton, a newer family).
  Upgrade = "upgrade",
  // Commit to use: Savings Plans, Reserved Instances, committed use.
  Commitment = "commitment",
  Other = "other",
}

export const CLOUD_SAVING_KIND_LABELS: Readonly<
  Record<CloudSavingKind, string>
> = {
  [CloudSavingKind.Rightsize]: translationKey("Rightsize"),
  [CloudSavingKind.Idle]: translationKey("Stop or delete"),
  [CloudSavingKind.Upgrade]: translationKey("Upgrade"),
  [CloudSavingKind.Commitment]: translationKey("Commit to use"),
  [CloudSavingKind.Other]: translationKey("Other"),
};

/*
 * What to do, as OneUptime words it for the recommenders that answer with a
 * code: AWS Cost Optimization Hub's action types (describeAwsSavingAction)
 * and Google Cloud's recommendation subtypes (describeGcpSavingAction), and
 * "Review" when a recommender said nothing. They are stored in English and
 * drawn in the reader's language (getCloudSavingActionText), old rows too.
 * Azure Advisor says what to do in a sentence of its own, drawn as written.
 */
export const CLOUD_SAVING_ACTION_WORDS: ReadonlyArray<string> = [
  translationKey("Rightsize"),
  translationKey("Scale in"),
  translationKey("Stop"),
  translationKey("Delete"),
  translationKey("Upgrade"),
  translationKey("Migrate to Graviton"),
  translationKey("Purchase Savings Plans"),
  translationKey("Purchase Reserved Instances"),
  translationKey("Change machine type"),
  translationKey("Stop VM"),
  translationKey("Snapshot and delete disk"),
  translationKey("Delete disk"),
  translationKey("Delete address"),
  translationKey("Delete image"),
  translationKey("Review"),
];

const CLOUD_SAVING_ACTION_WORD_SET: ReadonlySet<string> = new Set<string>(
  CLOUD_SAVING_ACTION_WORDS,
);

/*
 * A recommendation's action in the reader's language: OneUptime's own words
 * translated, a recommender's sentence as it wrote it, and the kind's label
 * when there is no action at all.
 */
export function getCloudSavingActionText(data: {
  action: string | null | undefined;
  kind: CloudSavingKind | null | undefined;
  translateText: (text: string) => string | undefined;
}): string {
  const action: string = (data.action || "").trim();

  if (!action) {
    const label: string =
      CLOUD_SAVING_KIND_LABELS[data.kind || CloudSavingKind.Other] ||
      CLOUD_SAVING_KIND_LABELS[CloudSavingKind.Other];
    return data.translateText(label) || label;
  }

  if (CLOUD_SAVING_ACTION_WORD_SET.has(action)) {
    return data.translateText(action) || action;
  }

  return action;
}

// The recommenders a cloud's ways to spend less come from, by their names.
export const CLOUD_SAVINGS_SOURCE_AWS: string = "AWS Cost Optimization Hub";
export const CLOUD_SAVINGS_SOURCE_AZURE: string = "Azure Advisor";
export const CLOUD_SAVINGS_SOURCE_GCP: string = "Google Cloud Recommender";

/*
 * One account's ways to spend less at a glance (CloudAccount.savingsSummary),
 * written after every read of its cloud's recommender: how many there are
 * and what they save a month together - or why none could be read (the
 * recommender is not turned on, the access may not read it yet). The
 * Overview and Savings read it without reading every recommendation.
 */
export interface CloudAccountSavingsSummary {
  state: CloudCostState;
  // Why they could not be read, in the cloud's words, when they could not.
  message?: string | undefined;
  count: number;
  // What they save a month together, in `currency`.
  monthlySavings: number;
  // The same by what they ask: rightsize, stop or delete, commit...
  byKind: Partial<Record<CloudSavingKind, CloudSavingsKindTotal>>;
  currency: string;
  // When they were last read.
  readAt: string;
}

export interface CloudSavingsKindTotal {
  count: number;
  monthlySavings: number;
}

/*
 * An account's summary from the recommendations kept for it: how many,
 * and what those in the currency most of them are in save together.
 */
export function summarizeCloudAccountSavings(data: {
  savings: Array<{
    monthlySavings: number;
    currency: string;
    kind: CloudSavingKind;
  }>;
  now: Date;
}): CloudAccountSavingsSummary {
  const byCurrency: Map<string, number> = new Map();

  for (const saving of data.savings) {
    const currency: string = (
      saving.currency || CLOUD_COST_DEFAULT_CURRENCY
    ).toUpperCase();
    byCurrency.set(currency, (byCurrency.get(currency) || 0) + 1);
  }

  const currency: string = getMostCommonCloudCurrency(byCurrency);
  const byKind: Partial<Record<CloudSavingKind, CloudSavingsKindTotal>> = {};
  let monthlySavings: number = 0;

  for (const saving of data.savings) {
    const kind: CloudSavingKind = isCloudSavingKind(saving.kind)
      ? saving.kind
      : CloudSavingKind.Other;
    const entry: CloudSavingsKindTotal = byKind[kind] || {
      count: 0,
      monthlySavings: 0,
    };
    const amount: number =
      (saving.currency || CLOUD_COST_DEFAULT_CURRENCY).toUpperCase() ===
      currency
        ? Math.max(0, Number(saving.monthlySavings) || 0)
        : 0;

    entry.count++;
    entry.monthlySavings = roundCost(entry.monthlySavings + amount);
    byKind[kind] = entry;
    monthlySavings += amount;
  }

  return {
    state: CloudCostState.Reading,
    count: data.savings.length,
    monthlySavings: roundCost(monthlySavings),
    byKind,
    currency,
    readAt: data.now.toISOString(),
  };
}

export function isCloudSavingKind(value: unknown): value is CloudSavingKind {
  return Object.values(CloudSavingKind).includes(value as CloudSavingKind);
}

function readSavingsByKind(
  value: unknown,
): Partial<Record<CloudSavingKind, CloudSavingsKindTotal>> {
  const byKind: Partial<Record<CloudSavingKind, CloudSavingsKindTotal>> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return byKind;
  }

  for (const [kind, entry] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!isCloudSavingKind(kind) || !entry || typeof entry !== "object") {
      continue;
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    byKind[kind] = {
      count: Math.max(0, Math.round(readNumber(record["count"]))),
      monthlySavings: Math.max(0, readNumber(record["monthlySavings"])),
    };
  }

  return byKind;
}

// A stored savings summary, read back: null when there is none or it is malformed.
export function readCloudAccountSavingsSummary(
  value: unknown,
): CloudAccountSavingsSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const state: unknown = record["state"];

  if (!Object.values(CloudCostState).includes(state as CloudCostState)) {
    return null;
  }

  return {
    state: state as CloudCostState,
    message:
      typeof record["message"] === "string" && record["message"]
        ? record["message"]
        : undefined,
    count: Math.max(0, Math.round(readNumber(record["count"]))),
    monthlySavings: Math.max(0, readNumber(record["monthlySavings"])),
    byKind: readSavingsByKind(record["byKind"]),
    currency:
      typeof record["currency"] === "string" && record["currency"]
        ? record["currency"]
        : CLOUD_COST_DEFAULT_CURRENCY,
    readAt: typeof record["readAt"] === "string" ? record["readAt"] : "",
  };
}

/*
 * Several accounts' savings as one: what the accounts read could save a
 * month, in the currency the costs are totalled in (or, with no costs, the
 * one most of the savings are in). An account in another currency is
 * counted apart, as the costs' totals count it.
 */
export interface CloudSavingsTotals {
  currency: string;
  monthlySavings: number;
  count: number;
  byKind: Partial<Record<CloudSavingKind, CloudSavingsKindTotal>>;
  accountsRead: number;
  accountsInOtherCurrencies: number;
  accountsNotAllowed: number;
  accountsNotSetUp: number;
  accountsFailed: number;
}

export function totalCloudSavings(data: {
  summaries: Array<CloudAccountSavingsSummary | null>;
  // The currency the costs are totalled in, when they are.
  currency?: string | undefined;
}): CloudSavingsTotals {
  const read: Array<CloudAccountSavingsSummary> = [];
  const byCurrency: Map<string, number> = new Map();
  const totals: CloudSavingsTotals = {
    currency: CLOUD_COST_DEFAULT_CURRENCY,
    monthlySavings: 0,
    count: 0,
    byKind: {},
    accountsRead: 0,
    accountsInOtherCurrencies: 0,
    accountsNotAllowed: 0,
    accountsNotSetUp: 0,
    accountsFailed: 0,
  };

  for (const summary of data.summaries) {
    if (!summary) {
      continue;
    }

    if (summary.state === CloudCostState.NotAllowed) {
      totals.accountsNotAllowed++;
    } else if (summary.state === CloudCostState.NotSetUp) {
      totals.accountsNotSetUp++;
    } else if (summary.state === CloudCostState.Failed) {
      totals.accountsFailed++;
    }

    // What an account had before a read that failed still holds.
    if (summary.state === CloudCostState.Reading || summary.count > 0) {
      read.push(summary);

      if (summary.count > 0) {
        const currency: string = summary.currency.toUpperCase();
        byCurrency.set(currency, (byCurrency.get(currency) || 0) + 1);
      }
    }
  }

  totals.currency = (
    data.currency || getMostCommonCloudCurrency(byCurrency)
  ).toUpperCase();

  for (const summary of read) {
    // An account with nothing to save is in every currency.
    if (
      summary.count > 0 &&
      summary.currency.toUpperCase() !== totals.currency
    ) {
      totals.accountsInOtherCurrencies++;
      continue;
    }

    if (summary.state === CloudCostState.Reading) {
      totals.accountsRead++;
    }

    totals.count += summary.count;
    totals.monthlySavings += summary.monthlySavings;

    for (const [kind, entry] of Object.entries(summary.byKind)) {
      const total: CloudSavingsKindTotal = totals.byKind[
        kind as CloudSavingKind
      ] || { count: 0, monthlySavings: 0 };
      total.count += entry.count;
      total.monthlySavings = roundCost(
        total.monthlySavings + entry.monthlySavings,
      );
      totals.byKind[kind as CloudSavingKind] = total;
    }
  }

  totals.monthlySavings = roundCost(totals.monthlySavings);

  return totals;
}

/*
 * ---------------------------------------------------------------------------
 * Budgets
 * ---------------------------------------------------------------------------
 */

// The share of a budget an alert is raised at, by default: before it is all spent, and when it is.
export const CLOUD_BUDGET_DEFAULT_THRESHOLDS: Array<number> = [80, 100];

// A budget's month, as its alerts are kept apart by it: "2026-11".
export function toCloudBudgetMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/*
 * The thresholds a budget's spend has passed this month, the highest last:
 * each one an alert, once a month.
 */
export function getPassedCloudBudgetThresholds(data: {
  spent: number;
  amount: number;
  thresholds: Array<number>;
}): Array<number> {
  if (!Number.isFinite(data.amount) || data.amount <= 0) {
    return [];
  }

  const percent: number = (data.spent / data.amount) * 100;

  return Array.from(
    new Set(
      data.thresholds.filter((threshold: number): boolean => {
        return Number.isFinite(threshold) && threshold > 0;
      }),
    ),
  )
    .sort((a: number, b: number): number => {
      return a - b;
    })
    .filter((threshold: number): boolean => {
      return percent >= threshold;
    });
}

/*
 * A budget's thresholds as stored, read back: whole percents from 1 to 1000.
 * The lowest and highest share of a budget an alert may be raised at.
 */
export const CLOUD_BUDGET_THRESHOLD_MIN: number = 1;
export const CLOUD_BUDGET_THRESHOLD_MAX: number = 1000;

/*
 * What a person may write between the shares, in any language: a comma
 * (Persian's and Japanese's too), a semicolon or a space. A percent sign
 * after a share is how many write one, and is dropped.
 */
const THRESHOLD_SEPARATORS: ReadonlySet<string> = new Set<string>([
  ",",
  "\u060C",
  "\u3001",
  "\uFF0C",
  ";",
  "\u061B",
  " ",
  "\t",
  "\n",
  "\r",
]);
const PERCENT_SIGNS: ReadonlySet<string> = new Set<string>([
  "%",
  "\u066A",
  "\uFF05",
]);

// A digit as Latin: Persian, Arabic-Indic and full-width digits are read too.
function toLatinDigit(character: string): string {
  const code: number = character.codePointAt(0) || 0;

  for (const zero of [0x06f0, 0x0660, 0xff10]) {
    if (code >= zero && code <= zero + 9) {
      return String(code - zero);
    }
  }

  return character;
}

/*
 * The shares written in a budget's Alert At, as text, one per entry:
 * "50%, 90 ,100" is ["50", "90", "100"], and Persian "۵۰٪، ۹۰٪" the same.
 * One pass over the text, a character at a time.
 */
export function splitCloudBudgetThresholds(text: string): Array<string> {
  const entries: Array<string> = [];
  let current: string = "";

  for (const character of text) {
    if (THRESHOLD_SEPARATORS.has(character)) {
      if (current) {
        entries.push(current);
      }
      current = "";
      continue;
    }

    if (!PERCENT_SIGNS.has(character)) {
      current += toLatinDigit(character);
    }
  }

  if (current) {
    entries.push(current);
  }

  return entries;
}

// A share as written, as a whole percent - or null when it is not one.
function readCloudBudgetThreshold(entry: unknown): number | null {
  if (typeof entry !== "number" && typeof entry !== "string") {
    return null;
  }

  const text: string = String(entry).trim();
  const value: number = Math.round(Number(text));

  return text !== "" &&
    Number.isFinite(value) &&
    value >= CLOUD_BUDGET_THRESHOLD_MIN &&
    value <= CLOUD_BUDGET_THRESHOLD_MAX
    ? value
    : null;
}

export function readCloudBudgetThresholds(value: unknown): Array<number> {
  const raw: Array<unknown> = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? splitCloudBudgetThresholds(value)
      : [];

  const thresholds: Array<number> = Array.from(
    new Set(
      raw
        .map((entry: unknown): number | null => {
          return readCloudBudgetThreshold(entry);
        })
        .filter((entry: number | null): entry is number => {
          return entry !== null;
        }),
    ),
  ).sort((a: number, b: number): number => {
    return a - b;
  });

  return thresholds.length > 0
    ? thresholds
    : [...CLOUD_BUDGET_DEFAULT_THRESHOLDS];
}

/*
 * Whether every share in a budget's Alert At, as typed, is a percent from 1
 * to 1000 - and there is one. The form says so before it is saved, rather
 * than the budget alerting at the defaults instead.
 */
export function isCloudBudgetThresholdsText(text: string): boolean {
  const entries: Array<string> = splitCloudBudgetThresholds(text);

  return (
    entries.length > 0 &&
    entries.every((entry: string): boolean => {
      return readCloudBudgetThreshold(entry) !== null;
    })
  );
}
