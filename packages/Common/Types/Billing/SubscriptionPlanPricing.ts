import SubscriptionPlan from "./SubscriptionPlan";

/*
 * What a plan costs, worked out from the plan itself - so every place that
 * quotes a price, a trial or a saving says what Stripe will actually charge.
 *
 * A plan (SUBSCRIPTION_PLAN_* in the environment) has two Stripe prices per
 * user: a monthly one, billed every month, and a yearly one, quoted per month
 * and billed for the whole year in advance. A plan priced at -1 has custom
 * pricing (Enterprise): the sales team agrees on it. A plan priced at 0 is
 * free. A new project on a plan with a trial period gets that many free days
 * before its first invoice (BillingService.subscribeToPlan, trial: true); a
 * plan change never starts one (ChangePlanBilling).
 *
 * The Create New Project dialog used to say "Yearly Plan (Save 20%)" for every
 * plan, whatever the prices were. On OneUptime Cloud, Growth costs $22 a month
 * or $20 a month billed yearly, which saves 9%, and Scale $99 or $84, which
 * saves 15%. The saving is worked out here instead, and rounded down, so the
 * product never promises more than the prices give.
 */

export enum BillingPeriod {
  Monthly = "Monthly",
  Yearly = "Yearly",
}

// The Stripe price a project on this plan is subscribed to, per period.
export function getPlanIdForPeriod(
  plan: SubscriptionPlan,
  period: BillingPeriod,
): string {
  return period === BillingPeriod.Yearly
    ? plan.getYearlyPlanId()
    : plan.getMonthlyPlanId();
}

/*
 * The period a plan id is billed by, or null when it is not one of the plan's
 * two prices. A plan configured with the same id for both is read as yearly,
 * as SubscriptionPlan.isYearlyPlan reads it.
 */
export function getBillingPeriodOfPlanId(
  plan: SubscriptionPlan,
  planId: string,
): BillingPeriod | null {
  if (!planId) {
    return null;
  }

  if (plan.getYearlyPlanId() === planId) {
    return BillingPeriod.Yearly;
  }

  if (plan.getMonthlyPlanId() === planId) {
    return BillingPeriod.Monthly;
  }

  return null;
}

// The plan one of whose two prices this is.
export function findPlanByPlanId(
  plans: Array<SubscriptionPlan>,
  planId: string | null | undefined,
): SubscriptionPlan | undefined {
  if (!planId) {
    return undefined;
  }

  return plans.find((plan: SubscriptionPlan): boolean => {
    return getBillingPeriodOfPlanId(plan, planId) !== null;
  });
}

/*
 * What one user costs a month on this plan, as the plan is quoted: the
 * monthly price, or the yearly price per month. Null for custom pricing.
 */
export function getMonthlyPricePerUserInUSD(
  plan: SubscriptionPlan,
  period: BillingPeriod,
): number | null {
  if (plan.isCustomPricing()) {
    return null;
  }

  return period === BillingPeriod.Yearly
    ? plan.getYearlySubscriptionAmountInUSD()
    : plan.getMonthlySubscriptionAmountInUSD();
}

/*
 * What one user is charged each time the plan is billed: a month's price
 * every month, or twelve months' price once a year. Null for custom pricing.
 */
export function getChargePerUserInUSD(
  plan: SubscriptionPlan,
  period: BillingPeriod,
): number | null {
  const perMonth: number | null = getMonthlyPricePerUserInUSD(plan, period);

  if (perMonth === null) {
    return null;
  }

  return period === BillingPeriod.Yearly ? perMonth * 12 : perMonth;
}

// A plan that costs nothing on this period. Custom pricing is never free.
export function isPlanFree(
  plan: SubscriptionPlan,
  period: BillingPeriod,
): boolean {
  return getMonthlyPricePerUserInUSD(plan, period) === 0;
}

// The free days a NEW project on this plan starts with (0 for none).
export function getTrialDays(plan: SubscriptionPlan): number {
  const days: number = plan.getTrialPeriod();

  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
}

/*
 * How much cheaper the yearly price is than the monthly one, in whole
 * percent, rounded down: 0 when yearly saves nothing, the plan is free, or
 * its price is custom.
 */
export function getYearlySavingPercent(plan: SubscriptionPlan): number {
  if (plan.isCustomPricing()) {
    return 0;
  }

  const monthly: number = plan.getMonthlySubscriptionAmountInUSD();
  const yearlyPerMonth: number = plan.getYearlySubscriptionAmountInUSD();

  if (
    !Number.isFinite(monthly) ||
    !Number.isFinite(yearlyPerMonth) ||
    monthly <= 0 ||
    yearlyPerMonth < 0 ||
    yearlyPerMonth >= monthly
  ) {
    return 0;
  }

  /*
   * Multiplied before it is divided: (100 - 71) / 100 * 100 is
   * 28.999999999999996 in floating point, which would round down to 28.
   */
  return Math.floor(((monthly - yearlyPerMonth) * 100) / monthly);
}

/*
 * What yearly billing saves across the plans: the most any plan saves, and
 * whether every plan that saves saves that much ("Save 15%") or only some do
 * ("Save up to 15%"). Null when no plan is cheaper yearly.
 */
export interface YearlySaving {
  percent: number;
  isSameForEveryPlan: boolean;
}

export function getYearlySaving(
  plans: Array<SubscriptionPlan>,
): YearlySaving | null {
  const savings: Array<number> = plans
    .filter((plan: SubscriptionPlan): boolean => {
      return (
        !plan.isCustomPricing() && !isPlanFree(plan, BillingPeriod.Monthly)
      );
    })
    .map((plan: SubscriptionPlan): number => {
      return getYearlySavingPercent(plan);
    });

  const best: number = Math.max(0, ...savings);

  if (best <= 0) {
    return null;
  }

  return {
    percent: best,
    isSameForEveryPlan: savings.every((saving: number): boolean => {
      return saving === best;
    }),
  };
}

/*
 * The plan a new project starts on: the first free one, on the period the
 * picker opens on. A default never commits anyone to paying - a paid plan,
 * and its trial, is always picked on purpose. Null when every plan costs
 * money, so the person has to choose.
 */
export function getDefaultPlanIdForNewProject(
  plans: Array<SubscriptionPlan>,
  period: BillingPeriod,
): string | null {
  const free: SubscriptionPlan | undefined = plans.find(
    (plan: SubscriptionPlan): boolean => {
      return isPlanFree(plan, period);
    },
  );

  return free ? getPlanIdForPeriod(free, period) : null;
}

/*
 * A plan price as the pricing page writes it: whole dollars without cents,
 * with a thousands separator ("$1,008"), and cents when there are any.
 */
export function formatPlanPriceInUSD(amountInUSD: number): string {
  const isWhole: boolean = Number.isInteger(amountInUSD);

  return `$${amountInUSD.toLocaleString("en-US", {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: isWhole ? 0 : 2,
  })}`;
}
