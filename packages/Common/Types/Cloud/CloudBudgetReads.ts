import BadDataException from "../Exception/BadDataException";
import ObjectID from "../ObjectID";
import {
  CloudBudgetCheckWindow,
  CloudBudgetPeriod,
  CloudBudgetScope,
  isCloudBudgetScope,
} from "./CloudBudget";
import { toCloudBudgetMonth, toCloudCostDay } from "./CloudCost";
import { CloudCostBasis, isCloudCostBasis } from "./CloudCostBasis";
import {
  CLOUD_COST_FORECAST_MAX_MONTHS_AHEAD,
  CLOUD_COST_FORECAST_MONTHS_AHEAD,
  CloudCostForecast,
  CloudCostForecastGrowth,
  CloudCostForecastMonth,
  CloudCostForecastMonthKind,
  readCloudCostForecastGrowth,
} from "./CloudCostForecast";
import { CloudCostRule, readCloudCostRules } from "./CloudCostRules";

/*
 * WHAT A BUDGET'S PAGE AND THE FORECAST PAGE READ (#11008):
 *
 *   POST /cloud-budget/:budgetId/spend - a budget's period month by month
 *     (what each cost, or is on course to, against its share of a split
 *     year), this month's days, the full months before it, its forecast and
 *     what cost the most (CloudBudgetPageResult);
 *   POST /cloud-budget/forecast - a scope's forecast: every account, one
 *     account, a cost group or a filter, the months ahead with a what-if
 *     (CloudCostForecastResult).
 *
 * React-free: the API answers in these shapes and the Dashboard reads them.
 */

// One month of a budget's period, as its page lists it.
export interface CloudBudgetPageMonth {
  // "2026-04".
  month: string;
  kind: CloudCostForecastMonthKind;
  // A split year's share for the month.
  planned?: number | undefined;
  /*
   * What it cost (a month before this one), is on course to cost (this
   * month), or is forecast to (a month after it).
   */
  amount: number;
  // This month so far.
  spent?: number | undefined;
  // A forecast month's likely range.
  low?: number | undefined;
  high?: number | undefined;
}

export interface CloudBudgetPageResult {
  budgetId: string;
  currency: string;
  basis: CloudCostBasis;
  period: {
    period: CloudBudgetPeriod;
    // Its first and last day: "2026-04-01", "2027-03-31".
    start: string;
    lastDay: string;
    key: string;
    months: Array<string>;
  };
  // What the budget is checked against now: its period, or a split year's month.
  window: {
    start: string;
    lastDay: string;
    key: string;
    isPlanMonth: boolean;
    amount: number;
  };
  // The period's amount.
  amount: number;
  spentThisPeriod: number;
  projectedThisPeriod: number;
  // A split year's plan up to the day reported; null when not split.
  plannedToDate: number | null;
  spentThisMonth: number;
  projectedThisMonth: number;
  months: Array<CloudBudgetPageMonth>;
  // The full months read, oldest first.
  history: Array<{ month: string; amount: number }>;
  // This month's days through today: "2026-11-01" -> amount.
  days: Array<{ day: string; amount: number }>;
  forecast: CloudCostForecast;
  topServices: Array<{ service: string; amount: number }>;
  latestDay?: string | undefined;
  readAt: string;
}

export interface CloudCostForecastRequest {
  scope: CloudBudgetScope;
  cloudAccountId?: ObjectID | undefined;
  cloudCostGroupId?: ObjectID | undefined;
  filterRules?: Array<CloudCostRule> | undefined;
  currency?: string | undefined;
  basis?: CloudCostBasis | undefined;
  monthsAhead: number;
  growth: CloudCostForecastGrowth | null;
}

export interface CloudCostForecastResult {
  scope: CloudBudgetScope;
  currency: string;
  basis: CloudCostBasis;
  forecast: CloudCostForecast;
  latestDay?: string | undefined;
  readAt: string;
}

// A currency as ISO 4217 writes one: three letters.
const CURRENCY_CODE: RegExp = /^[A-Z]{3}$/;

function readId(value: unknown, what: string): ObjectID {
  const text: string = typeof value === "string" ? value.trim() : "";

  if (!ObjectID.isValidUUID(text)) {
    throw new BadDataException(`Choose the ${what} to forecast.`);
  }

  return new ObjectID(text);
}

/*
 * A forecast's request, read and checked: a scope with what it needs, an
 * optional three-letter currency and basis, the months ahead (1 to 24,
 * twelve unless asked), and an optional what-if.
 */
export function readCloudCostForecastRequest(
  body: unknown,
): CloudCostForecastRequest {
  const data: Record<string, unknown> =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const scope: unknown = data["scope"] ?? CloudBudgetScope.AllAccounts;

  if (!isCloudBudgetScope(scope)) {
    throw new BadDataException(
      "Choose what to forecast: allAccounts, account, costGroup or filter.",
    );
  }

  const request: CloudCostForecastRequest = {
    scope,
    monthsAhead: CLOUD_COST_FORECAST_MONTHS_AHEAD,
    growth: null,
  };

  if (scope === CloudBudgetScope.Account) {
    request.cloudAccountId = readId(data["cloudAccountId"], "account");
  }

  if (scope === CloudBudgetScope.CostGroup) {
    request.cloudCostGroupId = readId(data["cloudCostGroupId"], "cost group");
  }

  if (scope === CloudBudgetScope.Filter) {
    const rules: Array<CloudCostRule> = readCloudCostRules(data["filterRules"]);

    if (
      !rules.some((rule: CloudCostRule): boolean => {
        return rule.conditions.length > 0;
      })
    ) {
      throw new BadDataException(
        "Add at least one condition: the services, Regions or tags to forecast.",
      );
    }

    request.filterRules = rules;
  }

  if (data["currency"] !== undefined && data["currency"] !== null) {
    const currency: string = String(data["currency"]).trim().toUpperCase();

    if (!CURRENCY_CODE.test(currency)) {
      throw new BadDataException(
        "The currency must be a three-letter code such as USD or EUR.",
      );
    }

    request.currency = currency;
  }

  if (data["basis"] !== undefined && data["basis"] !== null) {
    if (!isCloudCostBasis(data["basis"])) {
      throw new BadDataException(
        "The cost basis must be billed, amortized or net.",
      );
    }

    request.basis = data["basis"];
  }

  if (data["monthsAhead"] !== undefined && data["monthsAhead"] !== null) {
    const monthsAhead: number = Number(data["monthsAhead"]);

    if (
      !Number.isInteger(monthsAhead) ||
      monthsAhead < 1 ||
      monthsAhead > CLOUD_COST_FORECAST_MAX_MONTHS_AHEAD
    ) {
      throw new BadDataException(
        `A forecast is for 1 to ${CLOUD_COST_FORECAST_MAX_MONTHS_AHEAD} months ahead.`,
      );
    }

    request.monthsAhead = monthsAhead;
  }

  if (data["growth"] !== undefined && data["growth"] !== null) {
    const growth: CloudCostForecastGrowth | null = readCloudCostForecastGrowth(
      data["growth"],
    );

    if (!growth) {
      throw new BadDataException(
        'A what-if is {"percent": a number from -100 to 1000 but 0, "fromMonth": "2027-01"}.',
      );
    }

    request.growth = growth;
  }

  return request;
}

/*
 * A budget's period month by month: the months before this one as they
 * cost, this one so far and at the pace, and the ones after it as
 * forecast - each beside its share of a split year.
 */
export function toCloudBudgetPageMonths(data: {
  window: CloudBudgetCheckWindow;
  now: Date;
  pastMonths: Map<string, number>;
  month: { monthToDate: number; projectedMonth: number };
  forecast?: CloudCostForecast | undefined;
}): Array<CloudBudgetPageMonth> {
  const thisMonth: string = toCloudBudgetMonth(data.now);
  const forecastByMonth: Map<string, CloudCostForecastMonth> = new Map();

  for (const month of data.forecast?.months || []) {
    if (month.kind === CloudCostForecastMonthKind.Forecast) {
      forecastByMonth.set(month.month, month);
    }
  }

  return data.window.period.months.map(
    (month: string, index: number): CloudBudgetPageMonth => {
      const planned: number | undefined = data.window.plan
        ? data.window.plan[index]
        : undefined;

      if (month < thisMonth) {
        return {
          month,
          kind: CloudCostForecastMonthKind.Actual,
          planned,
          amount: Math.round((data.pastMonths.get(month) || 0) * 100) / 100,
        };
      }

      if (month === thisMonth) {
        return {
          month,
          kind: CloudCostForecastMonthKind.Current,
          planned,
          amount: Math.round(data.month.projectedMonth * 100) / 100,
          spent: Math.round(data.month.monthToDate * 100) / 100,
        };
      }

      const forecast: CloudCostForecastMonth | undefined =
        forecastByMonth.get(month);

      return {
        month,
        kind: CloudCostForecastMonthKind.Forecast,
        planned,
        amount: forecast?.amount || 0,
        low: forecast?.low,
        high: forecast?.high,
      };
    },
  );
}

// This month's days through today, each with its cost.
export function toCloudBudgetPageDays(data: {
  dailyTotals: Map<string, number>;
  now: Date;
}): Array<{ day: string; amount: number }> {
  const days: Array<{ day: string; amount: number }> = [];
  const first: Date = new Date(
    Date.UTC(data.now.getUTCFullYear(), data.now.getUTCMonth(), 1),
  );

  for (
    let day: Date = first;
    day.getTime() <=
    Date.UTC(
      data.now.getUTCFullYear(),
      data.now.getUTCMonth(),
      data.now.getUTCDate(),
    );
    day = new Date(day.getTime() + 24 * 60 * 60 * 1000)
  ) {
    const key: string = toCloudCostDay(day);
    days.push({
      day: key,
      amount: Math.round((data.dailyTotals.get(key) || 0) * 100) / 100,
    });
  }

  return days;
}
