import { translationKey } from "../Translator";
import { CloudProvider } from "./CloudPlatform";

/*
 * HOW MUCH OF THE SPEND COMMITMENTS COVER, AND HOW MUCH OF THEM IS USED.
 *
 * A commitment - AWS Savings Plans and Reserved Instances, Azure savings
 * plans and reservations, Google Cloud's committed use discounts - is paid
 * for whether it is used or not, and pays for the usage it covers at a
 * lower rate. Two figures say whether an account has the right ones:
 *
 *   - coverage: of the spend a commitment could pay for, the share one
 *     did - the rest ran at on-demand rates, which a commitment (Savings'
 *     "Commit to use" ways) would make cheaper;
 *   - utilisation: of what the commitments cost, the share that paid for
 *     usage - the rest was bought and not used.
 *
 * Each cloud's own billing says both, over the last 30 full days, in money:
 *
 *   - AWS Cost Explorer: Savings Plans' coverage (spend covered and spend
 *     on demand, at on-demand rates) and utilisation (the commitment and
 *     what of it went unused); Reserved Instances' for Amazon EC2 and
 *     Amazon RDS - the hours used at their on-demand cost, the hours on
 *     demand at theirs, and the reservations' amortized fee and what of it
 *     paid for hours nobody ran. An organization's management account
 *     says it for every account at once.
 *   - Azure Cost Management, in amortized cost: each kind's usage against
 *     the pay-as-you-go usage of the same services, and what the unused
 *     reservation or savings plan hours cost (UnusedReservation,
 *     UnusedSavingsPlan). The covered usage is counted at what it cost,
 *     after its discount.
 *   - Google Cloud's billing export: the committed use discounts' credits
 *     against the usage of the services they apply to, and the commitment
 *     fees. The export does not say how much of a commitment went unused,
 *     so Google Cloud's utilisation is not said.
 *
 * Kept on each account's savings summary (CloudAccountSavingsSummary,
 * commitments), written by the savings lane once a day. React-free and
 * server-safe: the server writes it, Cloud > Savings and an account's
 * Costs read it.
 */

// The days the figures are over: the last 30 full days.
export const CLOUD_COMMITMENT_WINDOW_DAYS: number = 30;

const DAY_MS: number = 24 * 60 * 60 * 1000;

/*
 * The window the figures are over: the 30 full UTC days before today
 * (Azure, Google Cloud). AWS's ends a day earlier: Cost Explorer takes an
 * end before today only.
 */
export function getCloudCommitmentWindow(now: Date): {
  start: Date;
  end: Date;
} {
  const end: Date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  return {
    start: new Date(end.getTime() - CLOUD_COMMITMENT_WINDOW_DAYS * DAY_MS),
    end,
  };
}

/*
 * At or above this share of what could be covered, the spend is all
 * covered: a fraction of a percent left is rounding and a day's late usage,
 * not spend to commit to.
 */
export const CLOUD_COMMITMENT_ALL_COVERED_PERCENT: number = 99.5;

// The same for what is used of a commitment.
export const CLOUD_COMMITMENT_ALL_USED_PERCENT: number = 99.5;

export enum CloudCommitmentKind {
  // AWS Savings Plans; Azure savings plans.
  SavingsPlans = "savings-plans",
  // AWS Reserved Instances; Azure reservations.
  Reservations = "reservations",
  // Google Cloud's committed use discounts.
  CommittedUseDiscounts = "committed-use-discounts",
}

/*
 * One kind of commitment's figures over the window, in the summary's
 * currency. A kind an account has no commitment of still says what its
 * eligible spend cost on demand: what one would cover.
 */
export interface CloudCommitmentKindFigures {
  kind: CloudCommitmentKind;
  // Spend the commitments paid for (at on-demand rates where the cloud says).
  coveredSpend: number;
  // Spend they could have paid for that ran at on-demand rates.
  onDemandSpend: number;
  // What the commitments cost over the window; null when the cloud does not say.
  commitmentSpend: number | null;
  // Of that, what paid for nothing; null when the cloud does not say.
  unusedSpend: number | null;
}

export interface CloudCommitmentSummary {
  /*
   * Whether they could be read: reading (CloudCostState's values), or why
   * not. Kept as text so this module stands alone; CloudCost's states.
   */
  state: string;
  message?: string | undefined;
  currency: string;
  // The days the figures are over.
  days: number;
  /*
   * An AWS organization's management account: the figures are every
   * account's of the organization, as Cost Explorer reads them from it.
   */
  isOrganization?: boolean | undefined;
  kinds: Array<CloudCommitmentKindFigures>;
  // When they were read.
  readAt: string;
}

/*
 * What each cloud calls each kind, as its own console does: drawn in the
 * reader's language (the product names stay as they are).
 */
const KIND_LABELS: Readonly<
  Record<CloudProvider, Partial<Record<CloudCommitmentKind, string>>>
> = {
  [CloudProvider.AWS]: {
    [CloudCommitmentKind.SavingsPlans]: translationKey("Savings Plans"),
    [CloudCommitmentKind.Reservations]: translationKey("Reserved Instances"),
  },
  [CloudProvider.Azure]: {
    [CloudCommitmentKind.SavingsPlans]: translationKey("Savings plans"),
    [CloudCommitmentKind.Reservations]: translationKey("Reservations"),
  },
  [CloudProvider.GCP]: {
    [CloudCommitmentKind.CommittedUseDiscounts]: translationKey(
      "Committed use discounts",
    ),
  },
};

// The kinds each cloud has, in the order its figures are listed.
export const CLOUD_COMMITMENT_KINDS: Readonly<
  Record<CloudProvider, ReadonlyArray<CloudCommitmentKind>>
> = {
  [CloudProvider.AWS]: [
    CloudCommitmentKind.SavingsPlans,
    CloudCommitmentKind.Reservations,
  ],
  [CloudProvider.Azure]: [
    CloudCommitmentKind.SavingsPlans,
    CloudCommitmentKind.Reservations,
  ],
  [CloudProvider.GCP]: [CloudCommitmentKind.CommittedUseDiscounts],
};

export function getCloudCommitmentKindLabel(data: {
  provider: string;
  kind: CloudCommitmentKind;
}): string {
  const labels: Partial<Record<CloudCommitmentKind, string>> =
    KIND_LABELS[data.provider as CloudProvider] || {};

  return (
    labels[data.kind] ||
    KIND_LABELS[CloudProvider.AWS][data.kind] ||
    KIND_LABELS[CloudProvider.GCP][data.kind] ||
    data.kind
  );
}

export function isCloudCommitmentKind(
  value: unknown,
): value is CloudCommitmentKind {
  return Object.values(CloudCommitmentKind).includes(
    value as CloudCommitmentKind,
  );
}

// A share as a percent, or null with nothing to take it of.
function percentOf(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) {
    return null;
  }

  return Math.min(100, Math.max(0, (part / whole) * 100));
}

/*
 * How much of the spend a commitment could pay for one did, as a percent:
 * null when nothing ran that one could pay for.
 */
export function getCloudCommitmentCoveragePercent(figures: {
  coveredSpend: number;
  onDemandSpend: number;
}): number | null {
  const covered: number = Math.max(0, figures.coveredSpend || 0);
  const onDemand: number = Math.max(0, figures.onDemandSpend || 0);

  return percentOf(covered, covered + onDemand);
}

/*
 * How much of what the commitments cost paid for usage, as a percent: null
 * when the cloud does not say, or there is no commitment.
 */
export function getCloudCommitmentUtilizationPercent(figures: {
  commitmentSpend: number | null;
  unusedSpend: number | null;
}): number | null {
  if (figures.commitmentSpend === null || figures.unusedSpend === null) {
    return null;
  }

  const commitment: number = Math.max(0, figures.commitmentSpend);
  const unused: number = Math.min(commitment, Math.max(0, figures.unusedSpend));

  return percentOf(commitment - unused, commitment);
}

// Whether an account has a commitment of a kind: it paid for usage, or it costs.
export function hasCloudCommitment(figures: {
  coveredSpend: number;
  commitmentSpend: number | null;
}): boolean {
  return figures.coveredSpend > 0 || (figures.commitmentSpend || 0) > 0;
}

/*
 * How much of what a commitment could cover is covered: none of it, some,
 * or all - and nothing to cover at all.
 */
export enum CloudCommitmentCoverageLevel {
  NothingToCover = "nothing-to-cover",
  None = "none",
  Some = "some",
  All = "all",
}

export function getCloudCommitmentCoverageLevel(figures: {
  coveredSpend: number;
  onDemandSpend: number;
}): CloudCommitmentCoverageLevel {
  const percent: number | null = getCloudCommitmentCoveragePercent(figures);

  if (percent === null) {
    return CloudCommitmentCoverageLevel.NothingToCover;
  }

  if (figures.coveredSpend <= 0) {
    return CloudCommitmentCoverageLevel.None;
  }

  return percent >= CLOUD_COMMITMENT_ALL_COVERED_PERCENT
    ? CloudCommitmentCoverageLevel.All
    : CloudCommitmentCoverageLevel.Some;
}

function readAmount(value: unknown): number {
  const amount: number = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function readOptionalAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const amount: number = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function readKindFigures(value: unknown): CloudCommitmentKindFigures | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  if (!isCloudCommitmentKind(record["kind"])) {
    return null;
  }

  return {
    kind: record["kind"],
    coveredSpend: Math.max(0, readAmount(record["coveredSpend"])),
    onDemandSpend: Math.max(0, readAmount(record["onDemandSpend"])),
    commitmentSpend: readOptionalAmount(record["commitmentSpend"]),
    unusedSpend: readOptionalAmount(record["unusedSpend"]),
  };
}

// A stored summary, read back: null when there is none or it is malformed.
export function readCloudCommitmentSummary(
  value: unknown,
): CloudCommitmentSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  if (typeof record["state"] !== "string" || !record["state"]) {
    return null;
  }

  const kinds: Array<CloudCommitmentKindFigures> = Array.isArray(
    record["kinds"],
  )
    ? (record["kinds"] as Array<unknown>)
        .map(readKindFigures)
        .filter((entry: CloudCommitmentKindFigures | null): boolean => {
          return entry !== null;
        })
        .map(
          (
            entry: CloudCommitmentKindFigures | null,
          ): CloudCommitmentKindFigures => {
            return entry as CloudCommitmentKindFigures;
          },
        )
    : [];

  const days: number = Math.round(readAmount(record["days"]));

  return {
    state: record["state"],
    message:
      typeof record["message"] === "string" && record["message"]
        ? record["message"]
        : undefined,
    currency:
      typeof record["currency"] === "string" && record["currency"]
        ? record["currency"].toUpperCase()
        : "USD",
    days: days > 0 ? days : CLOUD_COMMITMENT_WINDOW_DAYS,
    isOrganization: record["isOrganization"] === true ? true : undefined,
    kinds,
    readAt: typeof record["readAt"] === "string" ? record["readAt"] : "",
  };
}

/*
 * One kind's figures, the stored ones summed: an account's, or several
 * accounts' together in one currency.
 */
export function addCloudCommitmentFigures(
  into: CloudCommitmentKindFigures,
  figures: CloudCommitmentKindFigures,
): CloudCommitmentKindFigures {
  const sumOptional: (a: number | null, b: number | null) => number | null = (
    a: number | null,
    b: number | null,
  ): number | null => {
    if (a === null && b === null) {
      return null;
    }

    return (a || 0) + (b || 0);
  };

  return {
    kind: into.kind,
    coveredSpend: into.coveredSpend + figures.coveredSpend,
    onDemandSpend: into.onDemandSpend + figures.onDemandSpend,
    commitmentSpend: sumOptional(into.commitmentSpend, figures.commitmentSpend),
    unusedSpend: sumOptional(into.unusedSpend, figures.unusedSpend),
  };
}

/*
 * Several accounts' commitments as one, in one currency: every kind's
 * figures added up across the accounts read in it - so "covers 62%" is of
 * all the spend a commitment could cover, the largest accounts weighing
 * most. An account in another currency is counted apart, as the costs'
 * totals count it.
 */
export interface CloudCommitmentTotals {
  currency: string;
  coveredSpend: number;
  onDemandSpend: number;
  // Of the accounts whose clouds say it: what the commitments cost, and left unused.
  commitmentSpend: number | null;
  unusedSpend: number | null;
  // Accounts whose commitments were read, in the currency, and with one.
  accountsRead: number;
  accountsWithCommitments: number;
  accountsInOtherCurrencies: number;
}

export function totalCloudCommitments(data: {
  summaries: Array<CloudCommitmentSummary | null>;
  currency: string;
  // The state a summary read in full is in (CloudCostState.Reading).
  readingState: string;
}): CloudCommitmentTotals {
  const totals: CloudCommitmentTotals = {
    currency: data.currency.toUpperCase(),
    coveredSpend: 0,
    onDemandSpend: 0,
    commitmentSpend: null,
    unusedSpend: null,
    accountsRead: 0,
    accountsWithCommitments: 0,
    accountsInOtherCurrencies: 0,
  };

  for (const summary of data.summaries) {
    if (!summary || summary.state !== data.readingState) {
      continue;
    }

    if (summary.currency.toUpperCase() !== totals.currency) {
      totals.accountsInOtherCurrencies++;
      continue;
    }

    totals.accountsRead++;

    if (summary.kinds.some(hasCloudCommitment)) {
      totals.accountsWithCommitments++;
    }

    for (const kind of summary.kinds) {
      totals.coveredSpend += kind.coveredSpend;
      totals.onDemandSpend += kind.onDemandSpend;

      if (kind.commitmentSpend !== null && kind.unusedSpend !== null) {
        totals.commitmentSpend =
          (totals.commitmentSpend || 0) + kind.commitmentSpend;
        totals.unusedSpend = (totals.unusedSpend || 0) + kind.unusedSpend;
      }
    }
  }

  return totals;
}
