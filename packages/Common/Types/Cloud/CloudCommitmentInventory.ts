import { translationKey } from "../Translator";
import { CloudCommitmentKind } from "./CloudCommitments";
import { CloudProvider } from "./CloudPlatform";

/*
 * EVERY COMMITMENT A CLOUD CONNECTION CAN READ (#11011): each AWS Savings
 * Plan and Reserved Instance, Azure reservation and savings plan, and
 * Google Cloud committed use discount, with its term, when it ends, what it
 * commits to, and what of it was used and what it covered.
 *
 *   - AWS, from Cost Explorer: GetSavingsPlansUtilizationDetails (every
 *     plan of an organization from its management account, with its
 *     account, term, payment option, dates and use) and
 *     GetReservationUtilization grouped by subscription, per service, and
 *     savingsplans:DescribeSavingsPlans for the plans queued to start.
 *   - Azure: the tenant's reservations (Microsoft.Capacity) and savings
 *     plans (Microsoft.BillingBenefits), with their own utilization.
 *   - Google Cloud: each project's Compute Engine commitments.
 *
 * Kept as CloudCommitment rows by the savings lane once a day
 * (CloudCommitmentWriter); Cloud > Spend > Commitments lists them, and
 * CloudCommitmentAlertEvaluator alerts before one ends and while one is
 * under-used. React-free and server-safe.
 */

// Where a commitment is in its life.
export enum CloudCommitmentState {
  // Bought and paying for usage.
  Active = "active",
  // Bought to start later: a renewal queued for when another ends.
  Queued = "queued",
  // Its payment or purchase is still going through.
  Pending = "pending",
  // Its term is over.
  Expired = "expired",
  // Returned, cancelled, exchanged, split or merged away.
  Retired = "retired",
}

export function isCloudCommitmentState(
  value: unknown,
): value is CloudCommitmentState {
  return Object.values(CloudCommitmentState).includes(
    value as CloudCommitmentState,
  );
}

export const CLOUD_COMMITMENT_STATE_LABELS: Readonly<
  Record<CloudCommitmentState, string>
> = {
  [CloudCommitmentState.Active]: translationKey("Active"),
  [CloudCommitmentState.Queued]: translationKey("Queued"),
  [CloudCommitmentState.Pending]: translationKey("Pending"),
  [CloudCommitmentState.Expired]: translationKey("Expired"),
  [CloudCommitmentState.Retired]: translationKey("Retired"),
};

// How a commitment is paid for.
export enum CloudCommitmentPaymentOption {
  AllUpfront = "all-upfront",
  PartialUpfront = "partial-upfront",
  // Paid as it runs: AWS's No Upfront, Azure's monthly billing, Google's monthly fee.
  NoUpfront = "no-upfront",
}

export function isCloudCommitmentPaymentOption(
  value: unknown,
): value is CloudCommitmentPaymentOption {
  return Object.values(CloudCommitmentPaymentOption).includes(
    value as CloudCommitmentPaymentOption,
  );
}

export const CLOUD_COMMITMENT_PAYMENT_LABELS: Readonly<
  Record<CloudCommitmentPaymentOption, string>
> = {
  [CloudCommitmentPaymentOption.AllUpfront]: translationKey("All upfront"),
  [CloudCommitmentPaymentOption.PartialUpfront]:
    translationKey("Partial upfront"),
  [CloudCommitmentPaymentOption.NoUpfront]: translationKey("No upfront"),
};

/*
 * A payment option as a cloud writes it - "All Upfront", "Partial
 * Upfront", "No Upfront", "AllUpfront", Azure's "Upfront" and "Monthly" -
 * as one of OneUptime's; null for anything else.
 */
export function readCloudCommitmentPaymentOption(
  value: unknown,
): CloudCommitmentPaymentOption | null {
  if (isCloudCommitmentPaymentOption(value)) {
    return value;
  }

  const text: string = (typeof value === "string" ? value : "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

  if (text === "allupfront" || text === "upfront") {
    return CloudCommitmentPaymentOption.AllUpfront;
  }

  if (text === "partialupfront") {
    return CloudCommitmentPaymentOption.PartialUpfront;
  }

  if (text === "noupfront" || text === "monthly" || text === "pm") {
    return CloudCommitmentPaymentOption.NoUpfront;
  }

  return null;
}

/*
 * A term as a cloud writes it, in months: "1yr", "3 yr", "P1Y", "P3Y",
 * "TWELVE_MONTH", "THIRTY_SIX_MONTH", "OneYear", "1" (years), or seconds
 * (DescribeSavingsPlans' termDurationInSeconds). Null for anything else.
 */
export function readCloudCommitmentTermMonths(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Seconds: a year is 31,536,000.
    if (value >= 24 * 60 * 60) {
      return Math.round(value / (365 * 24 * 60 * 60)) * 12 || null;
    }

    return value <= 10 ? value * 12 : Math.round(value);
  }

  const text: string = (typeof value === "string" ? value : "")
    .trim()
    .toUpperCase();

  if (!text) {
    return null;
  }

  const words: Record<string, number> = {
    TWELVE_MONTH: 12,
    THIRTY_SIX_MONTH: 36,
    ONEYEAR: 12,
    ONE_YEAR: 12,
    THREEYEARS: 36,
    THREE_YEARS: 36,
    THREEYEAR: 36,
    FIVEYEARS: 60,
    P1Y: 12,
    P3Y: 36,
    P5Y: 60,
    P1M: 1,
  };

  if (words[text.replace(/\s+/g, "")] !== undefined) {
    return words[text.replace(/\s+/g, "")]!;
  }

  const years: RegExpMatchArray | null = text.match(
    /^(\d+(?:\.\d+)?)\s*(?:Y|YR|YRS|YEAR|YEARS)?$/,
  );

  if (years) {
    const amount: number = Number(years[1]);
    return amount > 0 && amount <= 10 ? Math.round(amount * 12) : null;
  }

  return null;
}

/*
 * What a commitment's use came to over a window, in its currency: what it
 * cost, what of that paid for usage and what went unused, what the usage it
 * covered would have cost on demand, and so what it saved. A figure its
 * cloud does not say is null - Azure says how much of a reservation was
 * used, not what it cost; Google Cloud says neither for one commitment.
 */
export interface CloudCommitmentFigures {
  // The days the 30-day figures are over.
  days: number;
  commitmentCost: number | null;
  usedCost: number | null;
  unusedCost: number | null;
  coveredOnDemandCost: number | null;
  netSavings: number | null;
  // What it cost, and left unused, over the last 7 days: what under-use alerts on.
  weekCommitmentCost: number | null;
  weekUnusedCost: number | null;
}

function readOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number: number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Stored figures, read back: null when there are none.
export function readCloudCommitmentFigures(
  value: unknown,
): CloudCommitmentFigures | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const days: number | null = readOptionalNumber(record["days"]);

  return {
    days: days !== null && days > 0 ? Math.round(days) : 30,
    commitmentCost: readOptionalNumber(record["commitmentCost"]),
    usedCost: readOptionalNumber(record["usedCost"]),
    unusedCost: readOptionalNumber(record["unusedCost"]),
    coveredOnDemandCost: readOptionalNumber(record["coveredOnDemandCost"]),
    netSavings: readOptionalNumber(record["netSavings"]),
    weekCommitmentCost: readOptionalNumber(record["weekCommitmentCost"]),
    weekUnusedCost: readOptionalNumber(record["weekUnusedCost"]),
  };
}

/*
 * Who a commitment applies to: the one account it was bought in, every
 * account of the organization or billing scope it was bought for, or a
 * part of one (a management group, a resource group).
 */
export enum CloudCommitmentScope {
  Account = "account",
  Shared = "shared",
  ManagementGroup = "management-group",
  ResourceGroup = "resource-group",
}

export const CLOUD_COMMITMENT_SCOPE_LABELS: Readonly<
  Record<CloudCommitmentScope, string>
> = {
  [CloudCommitmentScope.Account]: translationKey("One account"),
  [CloudCommitmentScope.Shared]: translationKey("Shared"),
  [CloudCommitmentScope.ManagementGroup]: translationKey("Management group"),
  [CloudCommitmentScope.ResourceGroup]: translationKey("Resource group"),
};

export function isCloudCommitmentScope(
  value: unknown,
): value is CloudCommitmentScope {
  return Object.values(CloudCommitmentScope).includes(
    value as CloudCommitmentScope,
  );
}

const DAY_MS: number = 24 * 60 * 60 * 1000;

/*
 * Whole days until a commitment ends, counted as a person does: ending
 * later today is 0, tomorrow 1. Below nothing once it has ended.
 */
export function getCloudCommitmentDaysLeft(data: {
  endsAt: Date;
  now: Date;
}): number {
  return Math.floor((data.endsAt.getTime() - data.now.getTime()) / DAY_MS);
}

/*
 * Where a person buys or renews a commitment of a kind, in its cloud's
 * console: the plan's link. OneUptime never buys - a person does, there.
 */
export function getCloudCommitmentPurchaseUrl(data: {
  provider: string;
  kind: CloudCommitmentKind | string;
  // The AWS service a reservation is for; its Region.
  service?: string | undefined;
  region?: string | undefined;
  // The Google Cloud project.
  accountId?: string | undefined;
}): string {
  const region: string = encodeURIComponent(data.region || "us-east-1");

  if (data.provider === CloudProvider.AWS) {
    if (data.kind === CloudCommitmentKind.SavingsPlans) {
      return "https://console.aws.amazon.com/costmanagement/home#/savings-plans/purchase";
    }

    const service: string = (data.service || "").toLowerCase();

    if (service.includes("relational database")) {
      return `https://console.aws.amazon.com/rds/home?region=${region}#reserved-instances:`;
    }

    if (service.includes("elasticache")) {
      return `https://console.aws.amazon.com/elasticache/home?region=${region}#/reserved-nodes`;
    }

    if (service.includes("opensearch") || service.includes("elasticsearch")) {
      return `https://console.aws.amazon.com/aos/home?region=${region}#opensearch/reserved-instances`;
    }

    if (service.includes("redshift")) {
      return `https://console.aws.amazon.com/redshiftv2/home?region=${region}#reserved-nodes`;
    }

    return `https://console.aws.amazon.com/ec2/home?region=${region}#ReservedInstances:`;
  }

  if (data.provider === CloudProvider.Azure) {
    return data.kind === CloudCommitmentKind.SavingsPlans
      ? "https://portal.azure.com/#browse/Microsoft.BillingBenefits%2FsavingsPlanOrders"
      : "https://portal.azure.com/#view/Microsoft_Azure_Reservations/CreateBlade";
  }

  return `https://console.cloud.google.com/compute/commitments${
    data.accountId ? `?project=${encodeURIComponent(data.accountId)}` : ""
  }`;
}
