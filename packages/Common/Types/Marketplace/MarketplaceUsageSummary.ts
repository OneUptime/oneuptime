import CloudMarketplace from "./CloudMarketplace";

/*
 * What a marketplace-billed project's charges came to, month by month - the
 * itemized view of the "usage units" its marketplace bill shows (GET
 * /marketplace/usage, for the project's owners, admins and billing roles).
 *
 * Only what was billed or is about to be: a report the marketplace has
 * accepted, or one written and not confirmed yet. The items are USD before
 * the hour was rounded to whole units, so they add up to the units' total to
 * within a cent.
 */

export const MARKETPLACE_USAGE_ROUTE: string = "/marketplace/usage";

// The current month and the two before it.
export const MARKETPLACE_USAGE_MONTHS: number = 3;

export interface MarketplaceUsageMonth {
  // The UTC month, "2026-10".
  month: string;
  // Usage units the marketplace has accepted.
  billedUnits: number;
  // Usage units written down and not yet confirmed by the marketplace.
  pendingUnits: number;
  usersInUSD: number;
  activeMonitorsInUSD: number;
  telemetryInUSD: number;
  smsOrCallBalanceInUSD: number;
  aiBalanceInUSD: number;
}

export interface MarketplaceUsageSummary {
  // The marketplace that bills the project; null for a project billed otherwise.
  marketplace: CloudMarketplace | null;
  // What one usage unit costs.
  usageUnitInUSD: number;
  // Newest first.
  months: Array<MarketplaceUsageMonth>;
}
