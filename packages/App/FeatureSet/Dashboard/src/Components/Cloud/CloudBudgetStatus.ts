import {
  CloudBudgetCheckWindow,
  CloudBudgetPeriod,
  getCloudBudgetCheckWindow,
} from "Common/Types/Cloud/CloudBudget";
import { readCloudBudgetThresholds } from "Common/Types/Cloud/CloudCost";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * HOW A CLOUD BUDGET IS DOING THIS MONTH, as its row on Cloud > Budgets
 * says it: over, past one of its alert thresholds, on course to be
 * passed, within it, or not checked yet - from what the server last
 * worked out (CloudBudget.spentThisMonth and projectedThisMonth, written
 * by the budget's checks). React-free, so App tests read it.
 */

export type CloudBudgetTone = "danger" | "warning" | "positive" | "neutral";

export interface CloudBudgetStatus {
  // English, or a template with {{percent}}: the threshold passed.
  label: string;
  threshold?: number | undefined;
  tone: CloudBudgetTone;
  // How much of the budget is spent, 0 and up (over 100 when over).
  percentSpent: number;
}

export const BUDGET_NOT_CHECKED: string = translationKey("Not checked yet");
export const BUDGET_OVER: string = translationKey("Over budget");
export const BUDGET_PASSED_THRESHOLD: string =
  translationKey("Passed {{percent}}");
export const BUDGET_ON_COURSE_TO_PASS: string =
  translationKey("On course to pass");
export const BUDGET_WITHIN: string = translationKey("Within budget");
export const BUDGET_PAUSED: string = translationKey("Paused");

export function getCloudBudgetStatus(data: {
  isEnabled: boolean;
  amount: number;
  spent: number | null | undefined;
  projected: number | null | undefined;
  thresholds: unknown;
  lastCheckedAt: Date | string | null | undefined;
}): CloudBudgetStatus {
  const amount: number = Number(data.amount) || 0;
  const spent: number = Number(data.spent) || 0;
  const projected: number = Number(data.projected) || 0;
  const percentSpent: number = amount > 0 ? (spent / amount) * 100 : 0;

  if (!data.isEnabled) {
    return { label: BUDGET_PAUSED, tone: "neutral", percentSpent };
  }

  if (!data.lastCheckedAt || amount <= 0) {
    return { label: BUDGET_NOT_CHECKED, tone: "neutral", percentSpent };
  }

  if (spent >= amount) {
    return { label: BUDGET_OVER, tone: "danger", percentSpent };
  }

  const passed: Array<number> = readCloudBudgetThresholds(
    data.thresholds,
  ).filter((threshold: number): boolean => {
    return threshold < 100 && percentSpent >= threshold;
  });
  const highest: number | undefined = passed[passed.length - 1];

  if (highest !== undefined) {
    return {
      label: BUDGET_PASSED_THRESHOLD,
      threshold: highest,
      tone: "warning",
      percentSpent,
    };
  }

  if (projected >= amount) {
    return { label: BUDGET_ON_COURSE_TO_PASS, tone: "warning", percentSpent };
  }

  return { label: BUDGET_WITHIN, tone: "positive", percentSpent };
}

/*
 * WHAT A BUDGET'S ROW IS OF (#11008): the figures its bar and its status
 * are worked out from - its period so far against its amount, or, a
 * yearly budget split by month, this month against its share - and its
 * period's, for the line a split year's row adds under them. From what the
 * server last worked out: this month's and the period's figures.
 */
export interface CloudBudgetRowFigures {
  amount: number;
  spent: number;
  projected: number;
  isPlanMonth: boolean;
  period: CloudBudgetPeriod;
  periodAmount: number;
  periodSpent: number;
  periodProjected: number;
}

export function getCloudBudgetRowFigures(data: {
  period: unknown;
  fiscalYearStartMonth: unknown;
  monthlyAmount: unknown;
  planSplit: unknown;
  monthlyPlan: unknown;
  spentThisMonth: unknown;
  projectedThisMonth: unknown;
  spentThisPeriod: unknown;
  projectedThisPeriod: unknown;
  now: Date;
}): CloudBudgetRowFigures {
  const window: CloudBudgetCheckWindow = getCloudBudgetCheckWindow({
    period: data.period,
    fiscalYearStartMonth: data.fiscalYearStartMonth,
    amount: Number(data.monthlyAmount) || 0,
    planSplit: data.planSplit,
    monthlyPlan: data.monthlyPlan,
    now: data.now,
  });
  const isMonthly: boolean = window.period.period === CloudBudgetPeriod.Month;
  const monthSpent: number = Number(data.spentThisMonth) || 0;
  const monthProjected: number = Number(data.projectedThisMonth) || 0;
  // A monthly budget checked before periods were kept only its month's.
  const periodSpent: number = isMonthly
    ? monthSpent
    : Number(data.spentThisPeriod) || 0;
  const periodProjected: number = isMonthly
    ? monthProjected
    : Number(data.projectedThisPeriod) || 0;

  return {
    amount: window.amount,
    spent: window.isPlanMonth ? monthSpent : periodSpent,
    projected: window.isPlanMonth ? monthProjected : periodProjected,
    isPlanMonth: window.isPlanMonth,
    period: window.period.period,
    periodAmount: Number(data.monthlyAmount) || 0,
    periodSpent,
    periodProjected,
  };
}
