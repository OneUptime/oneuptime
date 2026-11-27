import { translationKey } from "../Translator";
import {
  CloudCostAnomaly,
  addUtcDays,
  addUtcMonths,
  daysInUtcMonth,
  fromCloudCostDay,
  projectCloudMonthCost,
  roundCost,
  startOfUtcMonth,
  toCloudBudgetMonth,
  toCloudCostDay,
} from "./CloudCost";
import {
  CLOUD_COST_ANOMALY_BASELINE_DAYS,
  CLOUD_COST_ANOMALY_DAYS_JUDGED,
  CLOUD_COST_ANOMALY_MIN_HISTORY_DAYS,
  getCloudCostAnomalyDay,
  getCloudCostMedian,
} from "./CloudCostAnomaly";

/*
 * WHAT A CLOUD BUDGET COVERS, AND FOR HOW LONG (#11008).
 *
 * A budget (CloudBudget) says what some of a project's cloud spend may
 * cost in a period:
 *
 *   - its SCOPE: every account (as every budget was before), one account,
 *     a cost group (#11006) - the group as its rules sort the spend now -
 *     or a filter written as a cost group's rules are, for a budget that
 *     needs no group ("Service is Amazon EC2 and Region is eu-west-1");
 *   - its PERIOD: a calendar month, a quarter or a year, the quarters and
 *     the year starting in the fiscal year's first month (UTC, as the
 *     clouds bill);
 *   - its AMOUNT for the period (CloudBudget.monthlyAmount, named from when
 *     every budget was monthly), or for a yearly budget a PLAN: the year
 *     split into twelve equal months, or one amount typed for each month,
 *     so a seasonal team's quiet months are held to a small share and its
 *     busy ones to a large one.
 *
 * A budget is checked against a WINDOW: its period, or - split by month -
 * the month the period is in, against that month's share. Its thresholds,
 * its projection and the alerts it raises are the window's, and a new
 * window starts again from nothing (CloudBudgetEvaluator).
 *
 * React-free and server-safe: the evaluator, the API and the Dashboard
 * share every rule here.
 */

export enum CloudBudgetScope {
  AllAccounts = "allAccounts",
  Account = "account",
  CostGroup = "costGroup",
  Filter = "filter",
}

export enum CloudBudgetPeriod {
  Month = "month",
  Quarter = "quarter",
  Year = "year",
}

/*
 * How a yearly budget's amount is spread over its months. Stored, so a
 * value is never renamed.
 */
export enum CloudBudgetPlanSplit {
  // The amount is the whole period's, checked against the period so far.
  None = "none",
  // Twelve equal months.
  Equal = "equal",
  // An amount typed for each month, or saved from a forecast.
  ByMonth = "byMonth",
}

// How far above usual a budget's own unusual day is: an amount or a percent.
export enum CloudBudgetUnusualDayUnit {
  Amount = "amount",
  Percent = "percent",
}

export const CLOUD_BUDGET_SCOPES: ReadonlyArray<CloudBudgetScope> = [
  CloudBudgetScope.AllAccounts,
  CloudBudgetScope.Account,
  CloudBudgetScope.CostGroup,
  CloudBudgetScope.Filter,
];

export const CLOUD_BUDGET_PERIODS: ReadonlyArray<CloudBudgetPeriod> = [
  CloudBudgetPeriod.Month,
  CloudBudgetPeriod.Quarter,
  CloudBudgetPeriod.Year,
];

export const CLOUD_BUDGET_PLAN_SPLITS: ReadonlyArray<CloudBudgetPlanSplit> = [
  CloudBudgetPlanSplit.None,
  CloudBudgetPlanSplit.Equal,
  CloudBudgetPlanSplit.ByMonth,
];

export const CLOUD_BUDGET_UNUSUAL_DAY_UNITS: ReadonlyArray<CloudBudgetUnusualDayUnit> =
  [CloudBudgetUnusualDayUnit.Amount, CloudBudgetUnusualDayUnit.Percent];

// The months a period holds.
export const CLOUD_BUDGET_PERIOD_MONTHS: Readonly<
  Record<CloudBudgetPeriod, number>
> = {
  [CloudBudgetPeriod.Month]: 1,
  [CloudBudgetPeriod.Quarter]: 3,
  [CloudBudgetPeriod.Year]: 12,
};

// The fiscal year starts in January unless a budget says otherwise.
export const CLOUD_BUDGET_DEFAULT_FISCAL_YEAR_START_MONTH: number = 1;

/*
 * The threshold, in percent, from which a budget with people to notify
 * raises an alert: below it, they are told and nobody is paged.
 */
export const CLOUD_BUDGET_ALERT_FROM_PERCENT: number = 100;

/*
 * The least a percentage rule's unusual day must be above its usual, in the
 * budget's currency, as the project-wide rule asks
 * (CLOUD_COST_ANOMALY_MIN_INCREASE): a few cents are never a spike.
 */
export const CLOUD_BUDGET_UNUSUAL_DAY_MIN_INCREASE: number = 10;

// The most a percentage rule may ask: ten times the usual day.
export const CLOUD_BUDGET_UNUSUAL_DAY_MAX_PERCENT: number = 1000;

export function isCloudBudgetScope(value: unknown): value is CloudBudgetScope {
  return (
    typeof value === "string" &&
    (CLOUD_BUDGET_SCOPES as ReadonlyArray<string>).includes(value)
  );
}

export function isCloudBudgetPeriod(
  value: unknown,
): value is CloudBudgetPeriod {
  return (
    typeof value === "string" &&
    (CLOUD_BUDGET_PERIODS as ReadonlyArray<string>).includes(value)
  );
}

export function isCloudBudgetPlanSplit(
  value: unknown,
): value is CloudBudgetPlanSplit {
  return (
    typeof value === "string" &&
    (CLOUD_BUDGET_PLAN_SPLITS as ReadonlyArray<string>).includes(value)
  );
}

export function isCloudBudgetUnusualDayUnit(
  value: unknown,
): value is CloudBudgetUnusualDayUnit {
  return (
    typeof value === "string" &&
    (CLOUD_BUDGET_UNUSUAL_DAY_UNITS as ReadonlyArray<string>).includes(value)
  );
}

/*
 * A budget's scope as stored, read back: its own, else what its columns say
 * - a budget written before scopes existed (or by a script that names only
 * an account) is one account's when it names one, every account's when not.
 * A budget that names an account and says every account is that account's
 * too: the release before scopes, still running while a new one rolls out,
 * writes an account's budget with the column's default.
 */
export function readCloudBudgetScope(data: {
  scope: unknown;
  cloudAccountId?: unknown;
}): CloudBudgetScope {
  if (
    isCloudBudgetScope(data.scope) &&
    !(data.scope === CloudBudgetScope.AllAccounts && data.cloudAccountId)
  ) {
    return data.scope;
  }

  return data.cloudAccountId
    ? CloudBudgetScope.Account
    : CloudBudgetScope.AllAccounts;
}

// A period as stored, read back: a month for anything else.
export function readCloudBudgetPeriod(value: unknown): CloudBudgetPeriod {
  return isCloudBudgetPeriod(value) ? value : CloudBudgetPeriod.Month;
}

// The fiscal year's first month as stored, 1 to 12: January for anything else.
export function readCloudBudgetFiscalYearStartMonth(value: unknown): number {
  const month: number =
    typeof value === "string" && value.trim() !== ""
      ? Number(value.trim())
      : typeof value === "number"
        ? value
        : Number.NaN;

  return Number.isInteger(month) && month >= 1 && month <= 12
    ? month
    : CLOUD_BUDGET_DEFAULT_FISCAL_YEAR_START_MONTH;
}

// A plan split as stored, read back: none for anything else.
export function readCloudBudgetPlanSplit(value: unknown): CloudBudgetPlanSplit {
  return isCloudBudgetPlanSplit(value) ? value : CloudBudgetPlanSplit.None;
}

// An amount to the cent.
export function roundCloudBudgetAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/*
 * ---------------------------------------------------------------------------
 * Periods and windows
 * ---------------------------------------------------------------------------
 */

export interface CloudBudgetMonthsWindow {
  // The first day, at its start (UTC).
  start: Date;
  // The last day, at its start (UTC).
  lastDay: Date;
  // Each month it holds, in order: "2026-04" ... "2027-03".
  months: Array<string>;
  /*
   * What its alerts are kept apart by (CloudBudgetEvaluator's state and
   * fingerprints): "2026-11" for a monthly budget's month, as every budget's
   * month was before periods existed, and the first month with the number
   * of months for any other window - "2026-10/3" a quarter, "2026-04/12" a
   * year, "2026-11/1" a month of a yearly plan.
   */
  key: string;
}

export interface CloudBudgetPeriodWindow extends CloudBudgetMonthsWindow {
  period: CloudBudgetPeriod;
}

// The window of `count` months from a month's first day.
function monthsWindowFrom(start: Date, count: number): CloudBudgetMonthsWindow {
  const months: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    months.push(toCloudBudgetMonth(addUtcMonths(start, index)));
  }

  return {
    start,
    lastDay: addUtcDays(addUtcMonths(start, count), -1),
    months,
    key: `${months[0]}/${count}`,
  };
}

/*
 * The period a budget is in at `now`: the calendar month, or the quarter
 * or the year of its fiscal year that holds `now` - a year from April is
 * April to March, its quarters April to June, July to September, and on.
 */
export function getCloudBudgetPeriodWindow(data: {
  period: unknown;
  fiscalYearStartMonth: unknown;
  now: Date;
}): CloudBudgetPeriodWindow {
  const period: CloudBudgetPeriod = readCloudBudgetPeriod(data.period);
  const thisMonth: Date = startOfUtcMonth(data.now);

  if (period === CloudBudgetPeriod.Month) {
    return {
      period,
      start: thisMonth,
      lastDay: addUtcDays(addUtcMonths(thisMonth, 1), -1),
      months: [toCloudBudgetMonth(thisMonth)],
      key: toCloudBudgetMonth(thisMonth),
    };
  }

  const fiscalStart: number = readCloudBudgetFiscalYearStartMonth(
    data.fiscalYearStartMonth,
  );
  const monthsIntoYear: number =
    (thisMonth.getUTCMonth() + 1 - fiscalStart + 12) % 12;
  const count: number = CLOUD_BUDGET_PERIOD_MONTHS[period];
  const monthsIntoPeriod: number = monthsIntoYear % count;

  return {
    period,
    ...monthsWindowFrom(addUtcMonths(thisMonth, -monthsIntoPeriod), count),
  };
}

// The period before a budget's period at `now`: what a new period resolves.
export function getPreviousCloudBudgetPeriodWindow(data: {
  period: unknown;
  fiscalYearStartMonth: unknown;
  now: Date;
}): CloudBudgetPeriodWindow {
  const current: CloudBudgetPeriodWindow = getCloudBudgetPeriodWindow(data);

  return getCloudBudgetPeriodWindow({
    period: data.period,
    fiscalYearStartMonth: data.fiscalYearStartMonth,
    now: addUtcDays(current.start, -1),
  });
}

/*
 * ---------------------------------------------------------------------------
 * Plans
 * ---------------------------------------------------------------------------
 */

/*
 * A plan's months as stored, read back: twelve amounts of zero or more, in
 * the fiscal year's order (the first is its first month's), to the cent -
 * or null when the value is not twelve such amounts.
 */
export function readCloudBudgetMonthlyPlan(
  value: unknown,
): Array<number> | null {
  if (!Array.isArray(value) || value.length !== 12) {
    return null;
  }

  const plan: Array<number> = [];

  for (const entry of value as Array<unknown>) {
    const amount: number =
      typeof entry === "string" && entry.trim() !== ""
        ? Number(entry.trim())
        : typeof entry === "number"
          ? entry
          : Number.NaN;

    if (!Number.isFinite(amount) || amount < 0) {
      return null;
    }

    plan.push(roundCloudBudgetAmount(amount));
  }

  return plan;
}

// An amount split into equal parts to the cent, the last taking what is left.
export function splitCloudBudgetAmountEqually(
  amount: number,
  parts: number,
): Array<number> {
  const cents: number = Math.round(amount * 100);
  const each: number = Math.floor(cents / parts);
  const split: Array<number> = new Array(parts).fill(each / 100);

  split[parts - 1] = (cents - each * (parts - 1)) / 100;

  return split;
}

/*
 * A yearly budget's months, each with its share, in the fiscal year's order:
 * twelve equal months, or the typed ones. Null for a budget the period's
 * amount is checked for as a whole: any but a yearly one, one not split, or
 * one whose typed months do not read.
 */
export function getCloudBudgetMonthlyPlan(data: {
  period: unknown;
  amount: number;
  planSplit: unknown;
  monthlyPlan: unknown;
}): Array<number> | null {
  if (readCloudBudgetPeriod(data.period) !== CloudBudgetPeriod.Year) {
    return null;
  }

  const split: CloudBudgetPlanSplit = readCloudBudgetPlanSplit(data.planSplit);

  if (split === CloudBudgetPlanSplit.Equal) {
    return splitCloudBudgetAmountEqually(Number(data.amount) || 0, 12);
  }

  if (split === CloudBudgetPlanSplit.ByMonth) {
    return readCloudBudgetMonthlyPlan(data.monthlyPlan);
  }

  return null;
}

// What a plan's months add up to: a split budget's amount for the year.
export function sumCloudBudgetPlan(plan: Array<number>): number {
  return roundCloudBudgetAmount(
    plan.reduce((sum: number, amount: number): number => {
      return sum + amount;
    }, 0),
  );
}

/*
 * The window a budget is checked against at `now`, and what it may cost:
 * its period and amount, or - split by month - the month it is in and that
 * month's share.
 */
export interface CloudBudgetCheckWindow extends CloudBudgetMonthsWindow {
  period: CloudBudgetPeriodWindow;
  // What the window may cost, in the budget's currency.
  amount: number;
  // The window is one month of a yearly plan.
  isPlanMonth: boolean;
  // The period's months with their shares, when split.
  plan: Array<number> | null;
}

export function getCloudBudgetCheckWindow(data: {
  period: unknown;
  fiscalYearStartMonth: unknown;
  amount: number;
  planSplit: unknown;
  monthlyPlan: unknown;
  now: Date;
}): CloudBudgetCheckWindow {
  const period: CloudBudgetPeriodWindow = getCloudBudgetPeriodWindow(data);
  const amount: number = Number(data.amount) || 0;
  const plan: Array<number> | null = getCloudBudgetMonthlyPlan({
    period: period.period,
    amount,
    planSplit: data.planSplit,
    monthlyPlan: data.monthlyPlan,
  });

  if (!plan) {
    return {
      start: period.start,
      lastDay: period.lastDay,
      months: period.months,
      key: period.key,
      period,
      amount,
      isPlanMonth: false,
      plan: null,
    };
  }

  const thisMonth: Date = startOfUtcMonth(data.now);
  const index: number = Math.max(
    0,
    period.months.indexOf(toCloudBudgetMonth(thisMonth)),
  );

  return {
    ...monthsWindowFrom(thisMonth, 1),
    period,
    amount: plan[index] || 0,
    isPlanMonth: true,
    plan,
  };
}

/*
 * What a split budget planned for its period up to `now`: the shares of
 * the months before this one, and this month's share for the days of it
 * the spend has been reported through (latestDay), as the spend so far is.
 */
export function getCloudBudgetPlannedToDate(data: {
  window: CloudBudgetCheckWindow;
  now: Date;
  latestDay?: string | undefined;
}): number | null {
  const plan: Array<number> | null = data.window.plan;

  if (!plan) {
    return null;
  }

  const thisMonth: string = toCloudBudgetMonth(data.now);
  let planned: number = 0;

  data.window.period.months.forEach((month: string, index: number): void => {
    if (month < thisMonth) {
      planned += plan[index] || 0;
    }

    if (month === thisMonth) {
      const days: number = daysInUtcMonth(data.now);
      const latest: Date | null = data.latestDay
        ? fromCloudCostDay(data.latestDay)
        : null;
      const reportedThrough: number =
        latest && toCloudBudgetMonth(latest) === thisMonth
          ? latest.getUTCDate()
          : 0;

      planned += ((plan[index] || 0) * reportedThrough) / days;
    }
  });

  return roundCloudBudgetAmount(planned);
}

/*
 * ---------------------------------------------------------------------------
 * Projections
 * ---------------------------------------------------------------------------
 */

export interface CloudBudgetWindowSpend {
  // What the window cost so far.
  spent: number;
  // What it is on course to cost by its last day.
  projected: number;
  // This month so far, and at the pace of the last full week.
  monthSpent: number;
  monthProjected: number;
  // The pace: the average of the last full week's days.
  dailyPace: number;
  // The newest day with a cost, "2026-11-24".
  latestDay?: string | undefined;
}

/*
 * What a window cost so far and where it is heading:
 *
 *   - the months of it before this one, as they cost;
 *   - this month so far, and the rest of it at the pace of the last full
 *     week (projectCloudMonthCost) - as every budget's month was projected
 *     before periods existed, so a monthly budget's projection is the same;
 *   - the months of it after this one, as forecast (CloudCostForecast) -
 *     or, where no forecast is handed, at the same pace.
 */
export function projectCloudBudgetWindow(data: {
  window: CloudBudgetMonthsWindow;
  now: Date;
  // Each earlier month of the window: "2026-10" -> its cost.
  pastMonths: Map<string, number>;
  // Each day's cost of this month and the week before it: "2026-11-02" -> amount.
  dailyTotals: Map<string, number>;
  // Each later month of the window, as forecast: "2026-12" -> amount.
  laterMonths?: Map<string, number> | undefined;
}): CloudBudgetWindowSpend {
  const thisMonth: string = toCloudBudgetMonth(data.now);
  const month: {
    monthToDate: number;
    projectedMonth: number;
    latestDay?: string;
    dailyPace?: number;
  } = projectCloudMonthCost({ dailyTotals: data.dailyTotals, now: data.now });
  const dailyPace: number = month.dailyPace || 0;
  let spent: number = 0;
  let projected: number = 0;

  for (const windowMonth of data.window.months) {
    if (windowMonth < thisMonth) {
      const amount: number = data.pastMonths.get(windowMonth) || 0;
      spent += amount;
      projected += amount;
      continue;
    }

    if (windowMonth === thisMonth) {
      spent += month.monthToDate;
      projected += month.projectedMonth;
      continue;
    }

    const forecast: number | undefined = data.laterMonths?.get(windowMonth);

    projected +=
      forecast !== undefined
        ? forecast
        : dailyPace * daysInUtcMonth(fromCloudCostDay(`${windowMonth}-01`));
  }

  return {
    spent: roundCloudBudgetAmount(spent),
    projected: roundCloudBudgetAmount(projected),
    monthSpent: roundCloudBudgetAmount(month.monthToDate),
    monthProjected: roundCloudBudgetAmount(month.projectedMonth),
    dailyPace,
    latestDay: month.latestDay,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Who is told, and unusual days
 * ---------------------------------------------------------------------------
 */

/*
 * Whether a threshold passed is told to the budget's people only, with no
 * alert: one below 100%, for a budget with someone to tell. At 100% and
 * above - the budget spent - and for a budget with nobody to tell, it is
 * an alert, which pages its on-call policies.
 */
export function isCloudBudgetNoticeOnly(data: {
  threshold: number;
  hasPeopleToNotify: boolean;
}): boolean {
  return (
    data.hasPeopleToNotify && data.threshold < CLOUD_BUDGET_ALERT_FROM_PERCENT
  );
}

/*
 * A budget's own unusual day: a day of its scope at least this much above
 * its usual - an amount in its currency, or a percentage of the usual day.
 */
export interface CloudBudgetUnusualDayRule {
  unit: CloudBudgetUnusualDayUnit;
  threshold: number;
}

/*
 * A budget's own unusual-day rule as stored, read back - or null for the
 * project-wide rule: no threshold, or none above zero.
 */
export function readCloudBudgetUnusualDayRule(data: {
  threshold: unknown;
  unit: unknown;
}): CloudBudgetUnusualDayRule | null {
  const threshold: number =
    typeof data.threshold === "string" && data.threshold.trim() !== ""
      ? Number(data.threshold.trim())
      : typeof data.threshold === "number"
        ? data.threshold
        : Number.NaN;

  if (!Number.isFinite(threshold) || threshold <= 0) {
    return null;
  }

  const unit: CloudBudgetUnusualDayUnit = isCloudBudgetUnusualDayUnit(data.unit)
    ? data.unit
    : CloudBudgetUnusualDayUnit.Amount;

  return {
    unit,
    threshold:
      unit === CloudBudgetUnusualDayUnit.Percent
        ? Math.min(CLOUD_BUDGET_UNUSUAL_DAY_MAX_PERCENT, threshold)
        : roundCloudBudgetAmount(threshold),
  };
}

/*
 * Whether a day of a budget's scope is unusual by the budget's own rule: at
 * least the rule's amount above its usual, or at least its percentage above
 * it and at least CLOUD_BUDGET_UNUSUAL_DAY_MIN_INCREASE more. A day with no
 * usual (a scope that cost nothing) is unusual by an amount only.
 */
export function isCloudBudgetUnusualDay(data: {
  rule: CloudBudgetUnusualDayRule;
  amount: number;
  usual: number;
}): boolean {
  const increase: number = data.amount - data.usual;

  if (data.rule.unit === CloudBudgetUnusualDayUnit.Amount) {
    return increase >= data.rule.threshold;
  }

  if (data.usual <= 0) {
    return false;
  }

  return (
    increase >= CLOUD_BUDGET_UNUSUAL_DAY_MIN_INCREASE &&
    (increase / data.usual) * 100 >= data.rule.threshold
  );
}

// At most this many of a day's services are named beside its scope's spike.
export const CLOUD_BUDGET_UNUSUAL_DAY_SERVICES: number = 4;

/*
 * The unusual days of a budget's scope by its own rule, newest first: each
 * of the last full days (the days before the newest one read, as the
 * project-wide rule judges them) whose scope as a whole was at least the
 * rule above its usual - the median of the 14 days before it, of the days
 * since its first cost, with 7 of them at least - and beside it the
 * services that rose the most that day, each above its own usual: what an
 * alert names as where it came from.
 */
export function findCloudBudgetUnusualDays(data: {
  // Each day's cost by service: "2026-11-02" -> service -> amount.
  dailyServiceTotals: Map<string, Map<string, number>>;
  latestDay: string | undefined;
  rule: CloudBudgetUnusualDayRule;
}): Array<CloudCostAnomaly> {
  const newest: string | undefined = getCloudCostAnomalyDay(data.latestDay);

  if (!newest) {
    return [];
  }

  const dayTotal: (day: string) => number = (day: string): number => {
    let total: number = 0;

    for (const amount of (
      data.dailyServiceTotals.get(day) || new Map<string, number>()
    ).values()) {
      total += amount;
    }

    return total;
  };

  let firstCostDay: string | undefined = undefined;

  for (const day of data.dailyServiceTotals.keys()) {
    if (dayTotal(day) > 0 && (!firstCostDay || day < firstCostDay)) {
      firstCostDay = day;
    }
  }

  const anomalies: Array<CloudCostAnomaly> = [];
  const newestDate: Date = fromCloudCostDay(newest);

  for (let back: number = 0; back < CLOUD_COST_ANOMALY_DAYS_JUDGED; back++) {
    const judged: Date = addUtcDays(newestDate, -back);
    const day: string = toCloudCostDay(judged);
    const baselineDays: Array<string> = [];

    for (
      let before: number = CLOUD_COST_ANOMALY_BASELINE_DAYS;
      before >= 1;
      before--
    ) {
      const baselineDay: string = toCloudCostDay(addUtcDays(judged, -before));

      if (firstCostDay && baselineDay >= firstCostDay) {
        baselineDays.push(baselineDay);
      }
    }

    if (baselineDays.length < CLOUD_COST_ANOMALY_MIN_HISTORY_DAYS) {
      continue;
    }

    const amount: number = dayTotal(day);
    const usual: number = getCloudCostMedian(baselineDays.map(dayTotal));

    if (!isCloudBudgetUnusualDay({ rule: data.rule, amount, usual })) {
      continue;
    }

    anomalies.push({
      day,
      service: "",
      amount: roundCost(amount),
      usual: roundCost(usual),
    });

    const services: Array<CloudCostAnomaly> = [];

    for (const [service, serviceAmount] of data.dailyServiceTotals.get(day) ||
      new Map<string, number>()) {
      const serviceUsual: number = getCloudCostMedian(
        baselineDays.map((baselineDay: string): number => {
          return data.dailyServiceTotals.get(baselineDay)?.get(service) || 0;
        }),
      );

      if (service && serviceAmount - serviceUsual >= 0.01) {
        services.push({
          day,
          service,
          amount: roundCost(serviceAmount),
          usual: roundCost(serviceUsual),
        });
      }
    }

    services.sort((a: CloudCostAnomaly, b: CloudCostAnomaly): number => {
      return (
        b.amount - b.usual - (a.amount - a.usual) ||
        a.service.localeCompare(b.service)
      );
    });

    anomalies.push(...services.slice(0, CLOUD_BUDGET_UNUSUAL_DAY_SERVICES));
  }

  return anomalies;
}

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */

export const CLOUD_BUDGET_SCOPE_LABELS: Readonly<
  Record<CloudBudgetScope, string>
> = {
  [CloudBudgetScope.AllAccounts]: translationKey("Every account"),
  [CloudBudgetScope.Account]: translationKey("One account"),
  [CloudBudgetScope.CostGroup]: translationKey("A cost group"),
  [CloudBudgetScope.Filter]: translationKey("Services, Regions or tags"),
};

export const CLOUD_BUDGET_PERIOD_LABELS: Readonly<
  Record<CloudBudgetPeriod, string>
> = {
  // Keys of their own: the bare "Monthly" and "Yearly" are a billing cycle's.
  [CloudBudgetPeriod.Month]: translationKey("Monthly (budget period)"),
  [CloudBudgetPeriod.Quarter]: translationKey("Quarterly (budget period)"),
  [CloudBudgetPeriod.Year]: translationKey("Yearly (budget period)"),
};

export const CLOUD_BUDGET_PLAN_SPLIT_LABELS: Readonly<
  Record<CloudBudgetPlanSplit, string>
> = {
  [CloudBudgetPlanSplit.None]: translationKey("For the whole year"),
  [CloudBudgetPlanSplit.Equal]: translationKey("Split equally by month"),
  [CloudBudgetPlanSplit.ByMonth]: translationKey("An amount for each month"),
};

export const CLOUD_BUDGET_UNUSUAL_DAY_UNIT_LABELS: Readonly<
  Record<CloudBudgetUnusualDayUnit, string>
> = {
  [CloudBudgetUnusualDayUnit.Amount]: translationKey("Amount above usual"),
  [CloudBudgetUnusualDayUnit.Percent]: translationKey("Percent above usual"),
};

// The window a projection is to the end of, as alerts and pages say it.
export function getCloudBudgetWindowNoun(window: {
  isPlanMonth: boolean;
  period: { period: CloudBudgetPeriod };
}): "month" | "quarter" | "year" {
  if (window.isPlanMonth) {
    return "month";
  }

  return window.period.period === CloudBudgetPeriod.Quarter
    ? "quarter"
    : window.period.period === CloudBudgetPeriod.Year
      ? "year"
      : "month";
}

// A window's first day and last day as cost days: "2026-04-01", "2027-03-31".
export function getCloudBudgetWindowDays(window: CloudBudgetMonthsWindow): {
  start: string;
  lastDay: string;
} {
  return {
    start: toCloudCostDay(window.start),
    lastDay: toCloudCostDay(window.lastDay),
  };
}
