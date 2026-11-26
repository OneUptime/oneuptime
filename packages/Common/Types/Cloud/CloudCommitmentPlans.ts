import {
  CloudCommitmentFigures,
  CloudCommitmentPaymentOption,
  readCloudCommitmentPaymentOption,
  readCloudCommitmentTermMonths,
} from "./CloudCommitmentInventory";

/*
 * WHAT TO BUY, AND WHAT IT SAVES (#11011): a plan for renewing a
 * commitment that ends soon, and one for each "commit to use"
 * recommendation - what to buy (term, payment option, amount), what it
 * costs and saves a month, when it breaks even, and how the account's
 * coverage changes. OneUptime plans; a person buys, in the cloud's console
 * (getCloudCommitmentPurchaseUrl). Pure and server-safe: the Commitments
 * page and the expiry alerts draw them.
 *
 * Two ways to say when a commitment pays:
 *
 *   - break-even month: when the money paid up front is made back by
 *     paying the commitment's monthly fee instead of on-demand prices - the
 *     first month for one paid as it runs;
 *   - break-even utilization: the least share of it that has to be used
 *     for it to cost less than on demand - what it costs over what the
 *     usage it covers costs on demand.
 */

// A month, in days: what a figure over a window is scaled to.
export const CLOUD_PLAN_DAYS_PER_MONTH: number = 365.25 / 12;

// Hours in a month: an hourly commitment's month.
export const CLOUD_PLAN_HOURS_PER_MONTH: number =
  24 * CLOUD_PLAN_DAYS_PER_MONTH;

// The share of a commitment's whole cost a payment option pays up front.
export const CLOUD_PLAN_UPFRONT_SHARE: Readonly<
  Record<CloudCommitmentPaymentOption, number>
> = {
  [CloudCommitmentPaymentOption.AllUpfront]: 1,
  [CloudCommitmentPaymentOption.PartialUpfront]: 0.5,
  [CloudCommitmentPaymentOption.NoUpfront]: 0,
};

export interface CloudCommitmentPlan {
  // A renewal of a commitment, or a purchase a recommender suggests.
  kind: "renewal" | "purchase";
  termMonths: number | null;
  paymentOption: CloudCommitmentPaymentOption | null;
  // What it commits to: an hourly amount (a savings plan), or a count (reservations).
  hourlyCommitment: number | null;
  quantity: number | null;
  // What it is paid up front, and costs a month all in (its upfront spread over its term).
  upfrontCost: number | null;
  monthlyCost: number | null;
  // What the usage it covers costs a month on demand.
  monthlyOnDemandCost: number | null;
  monthlySavings: number | null;
  // When the money paid up front is made back, in months: 0 from the first.
  breakEvenMonths: number | null;
  // The least use, in percent, at which it costs less than on demand.
  breakEvenUtilizationPercent: number | null;
  /*
   * The account's coverage by the commitment's kind now, and after: for a
   * renewal, if it lapses instead; for a purchase, once it is bought.
   */
  coverageNowPercent: number | null;
  coverageAfterPercent: number | null;
  currency: string;
}

// A share as a percent of a whole, kept between nothing and all.
function percentOf(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) {
    return null;
  }

  return Math.min(100, Math.max(0, (part / whole) * 100));
}

function round(amount: number, places: number): number {
  const factor: number = Math.pow(10, places);
  return Math.round(amount * factor) / factor;
}

/*
 * When the money paid up front is made back: what was paid up front over
 * what the commitment saves in cash each month - the usage's on-demand
 * price less the commitment's own monthly fee. 0 for one with nothing paid
 * up front that saves from its first month; null when it never pays back.
 */
export function getCloudCommitmentBreakEvenMonths(data: {
  upfrontCost: number | null;
  monthlyOnDemandCost: number | null;
  // What it costs a month besides its upfront payment.
  monthlyRecurringCost: number | null;
}): number | null {
  const onDemand: number | null = data.monthlyOnDemandCost;

  if (onDemand === null || !Number.isFinite(onDemand) || onDemand <= 0) {
    return null;
  }

  const recurring: number = Math.max(0, data.monthlyRecurringCost || 0);
  const upfront: number = Math.max(0, data.upfrontCost || 0);
  const cashSaving: number = onDemand - recurring;

  if (cashSaving <= 0) {
    return null;
  }

  if (upfront <= 0) {
    return 0;
  }

  return round(upfront / cashSaving, 1);
}

// The least use at which a commitment costs less than on demand, in percent.
export function getCloudCommitmentBreakEvenUtilization(data: {
  monthlyCost: number | null;
  monthlyOnDemandCost: number | null;
}): number | null {
  if (data.monthlyCost === null || data.monthlyOnDemandCost === null) {
    return null;
  }

  const percent: number | null = percentOf(
    data.monthlyCost,
    data.monthlyOnDemandCost,
  );

  return percent === null ? null : round(percent, 1);
}

// What an account's commitments of a kind cover, over the last 30 days.
export interface CloudCoverageFigures {
  coveredSpend: number;
  onDemandSpend: number;
}

/*
 * The renewal of a commitment that ends: the same kind, term and payment
 * option, at what it actually used over the last 30 days - an hourly
 * commitment cut to its used share, a count of reservations to the ones
 * used - so a commitment half used is not bought twice. Its month is what
 * the usage it covered cost on demand against what the renewal costs; its
 * coverage, what the account's would fall to if it lapsed instead. Null
 * when its cloud says too little of what it cost (Azure's reservations,
 * Google Cloud's commitments).
 */
export function getCloudCommitmentRenewalPlan(data: {
  termMonths: number | null;
  paymentOption: CloudCommitmentPaymentOption | null;
  hourlyCommitment: number | null;
  quantity: number | null;
  upfrontCost: number | null;
  utilizationPercent: number | null;
  figures: CloudCommitmentFigures | null;
  currency: string;
  // The account's coverage by the commitment's kind, when read.
  coverage?: CloudCoverageFigures | null | undefined;
}): CloudCommitmentPlan | null {
  const figures: CloudCommitmentFigures | null = data.figures;

  if (
    !figures ||
    figures.commitmentCost === null ||
    figures.coveredOnDemandCost === null ||
    figures.commitmentCost <= 0
  ) {
    return null;
  }

  const toMonth: number = CLOUD_PLAN_DAYS_PER_MONTH / Math.max(1, figures.days);
  const usedShare: number =
    data.utilizationPercent !== null
      ? Math.min(1, Math.max(0, data.utilizationPercent / 100))
      : figures.usedCost !== null
        ? Math.min(1, Math.max(0, figures.usedCost / figures.commitmentCost))
        : 1;

  if (usedShare <= 0) {
    return null;
  }

  // Its amount at what was used: never more than it is, and never nothing.
  let share: number = usedShare;
  let hourlyCommitment: number | null = null;
  let quantity: number | null = null;

  if (data.hourlyCommitment !== null && data.hourlyCommitment > 0) {
    hourlyCommitment = Math.max(
      0.001,
      round(data.hourlyCommitment * usedShare, 3),
    );
    share = Math.min(1, hourlyCommitment / data.hourlyCommitment);
  } else if (data.quantity !== null && data.quantity > 0) {
    quantity = Math.max(1, Math.floor(data.quantity * usedShare + 0.0001));
    share = Math.min(1, quantity / data.quantity);
  }

  const monthlyCost: number = figures.commitmentCost * share * toMonth;
  const monthlyOnDemandCost: number = figures.coveredOnDemandCost * toMonth;
  const upfrontCost: number | null =
    data.upfrontCost !== null && data.upfrontCost > 0
      ? data.upfrontCost * share
      : data.paymentOption === CloudCommitmentPaymentOption.NoUpfront
        ? 0
        : null;
  const months: number | null = data.termMonths;
  const recurring: number | null =
    upfrontCost !== null && months
      ? Math.max(0, monthlyCost - upfrontCost / months)
      : upfrontCost === 0
        ? monthlyCost
        : null;

  let coverageNowPercent: number | null = null;
  let coverageAfterPercent: number | null = null;

  if (data.coverage) {
    const eligible: number =
      data.coverage.coveredSpend + data.coverage.onDemandSpend;
    coverageNowPercent = percentOf(data.coverage.coveredSpend, eligible);
    coverageAfterPercent = percentOf(
      Math.max(0, data.coverage.coveredSpend - figures.coveredOnDemandCost),
      eligible,
    );
  }

  return {
    kind: "renewal",
    termMonths: data.termMonths,
    paymentOption: data.paymentOption,
    hourlyCommitment,
    quantity,
    upfrontCost: upfrontCost === null ? null : round(upfrontCost, 2),
    monthlyCost: round(monthlyCost, 2),
    monthlyOnDemandCost: round(monthlyOnDemandCost, 2),
    monthlySavings: round(monthlyOnDemandCost - monthlyCost, 2),
    breakEvenMonths: getCloudCommitmentBreakEvenMonths({
      upfrontCost,
      monthlyOnDemandCost,
      monthlyRecurringCost: recurring,
    }),
    breakEvenUtilizationPercent: getCloudCommitmentBreakEvenUtilization({
      monthlyCost,
      monthlyOnDemandCost,
    }),
    coverageNowPercent,
    coverageAfterPercent,
    currency: data.currency,
  };
}

/*
 * What a recommender says a commitment it suggests is, beyond what it
 * saves (CloudCostRecommendation.commitmentDetails): AWS Cost Optimization
 * Hub's purchase recommendation's configuration and cost.
 */
export interface CloudCommitmentRecommendationDetails {
  termMonths: number | null;
  paymentOption: CloudCommitmentPaymentOption | null;
  hourlyCommitment: number | null;
  quantity: number | null;
  // What it is - an instance type, a plan's kind - in the recommender's words.
  configuration: string;
  upfrontCost: number | null;
  monthlyRecurringCost: number | null;
  // What it costs a month all in, as the recommender estimates it.
  monthlyCost: number | null;
}

function readNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number: number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Stored recommendation details, read back: null when there are none.
export function readCloudCommitmentRecommendationDetails(
  value: unknown,
): CloudCommitmentRecommendationDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  return {
    termMonths: readCloudCommitmentTermMonths(record["termMonths"]),
    paymentOption: readCloudCommitmentPaymentOption(record["paymentOption"]),
    hourlyCommitment: readNumber(record["hourlyCommitment"]),
    quantity: readNumber(record["quantity"]),
    configuration:
      typeof record["configuration"] === "string"
        ? record["configuration"]
        : "",
    upfrontCost: readNumber(record["upfrontCost"]),
    monthlyRecurringCost: readNumber(record["monthlyRecurringCost"]),
    monthlyCost: readNumber(record["monthlyCost"]),
  };
}

/*
 * The purchase a "commit to use" recommendation suggests: what it costs a
 * month (the recommender's estimate, else its upfront and monthly fees),
 * what it saves (the recommender's), and so what the usage it covers costs
 * on demand; when it breaks even; and the account's coverage once bought.
 */
export function getCloudCommitmentPurchasePlan(data: {
  monthlySavings: number;
  // The recommender's own monthly cost figure, when it gives one.
  monthlyCost: number | null;
  details: CloudCommitmentRecommendationDetails | null;
  currency: string;
  coverage?: CloudCoverageFigures | null | undefined;
}): CloudCommitmentPlan {
  const details: CloudCommitmentRecommendationDetails | null = data.details;
  const termMonths: number | null = details?.termMonths ?? null;
  const upfront: number | null = details?.upfrontCost ?? null;
  const recurring: number | null = details?.monthlyRecurringCost ?? null;
  const fromFees: number | null =
    upfront !== null && recurring !== null && termMonths
      ? upfront / termMonths + recurring
      : details?.hourlyCommitment
        ? details.hourlyCommitment * CLOUD_PLAN_HOURS_PER_MONTH
        : null;
  const monthlyCost: number | null =
    details?.monthlyCost ?? fromFees ?? data.monthlyCost;
  const monthlySavings: number = Math.max(0, data.monthlySavings);
  const monthlyOnDemandCost: number | null =
    monthlyCost !== null ? monthlyCost + monthlySavings : null;
  const paymentOption: CloudCommitmentPaymentOption | null =
    details?.paymentOption ?? null;
  // The upfront payment the recommender names, else the one its payment option makes.
  const upfrontCost: number | null =
    upfront !== null
      ? upfront
      : paymentOption !== null && monthlyCost !== null && termMonths
        ? monthlyCost * termMonths * CLOUD_PLAN_UPFRONT_SHARE[paymentOption]
        : null;
  const monthlyRecurringCost: number | null =
    recurring !== null
      ? recurring
      : upfrontCost !== null && monthlyCost !== null && termMonths
        ? Math.max(0, monthlyCost - upfrontCost / termMonths)
        : null;

  let coverageNowPercent: number | null = null;
  let coverageAfterPercent: number | null = null;

  if (data.coverage && monthlyOnDemandCost !== null) {
    const eligible: number =
      data.coverage.coveredSpend + data.coverage.onDemandSpend;
    // What it would cover over the same 30 days the coverage is over.
    const covers: number =
      (monthlyOnDemandCost * 30) / CLOUD_PLAN_DAYS_PER_MONTH;
    coverageNowPercent = percentOf(data.coverage.coveredSpend, eligible);
    coverageAfterPercent = percentOf(
      Math.min(eligible, data.coverage.coveredSpend + covers),
      eligible,
    );
  }

  return {
    kind: "purchase",
    termMonths,
    paymentOption,
    hourlyCommitment: details?.hourlyCommitment ?? null,
    quantity: details?.quantity ?? null,
    upfrontCost: upfrontCost === null ? null : round(upfrontCost, 2),
    monthlyCost: monthlyCost === null ? null : round(monthlyCost, 2),
    monthlyOnDemandCost:
      monthlyOnDemandCost === null ? null : round(monthlyOnDemandCost, 2),
    monthlySavings: round(monthlySavings, 2),
    breakEvenMonths: getCloudCommitmentBreakEvenMonths({
      upfrontCost,
      monthlyOnDemandCost,
      monthlyRecurringCost,
    }),
    breakEvenUtilizationPercent: getCloudCommitmentBreakEvenUtilization({
      monthlyCost,
      monthlyOnDemandCost,
    }),
    coverageNowPercent,
    coverageAfterPercent,
    currency: data.currency,
  };
}
