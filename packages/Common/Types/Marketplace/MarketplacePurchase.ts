import { AccountsRoute } from "../../ServiceRoute";
import CloudMarketplace from "./CloudMarketplace";
import MarketplaceSubscriptionStatus from "./MarketplaceSubscriptionStatus";

/*
 * What the server and the purchase page share about setting up a marketplace
 * purchase: where the page is, the cookie that brings a buyer back to it
 * after signing in, and the shape of what the page is told.
 *
 * The flow, end to end:
 *
 *   1. The buyer subscribes on the marketplace and is sent to OneUptime with
 *      the marketplace's token: Azure as a GET to the landing page, AWS and
 *      Google Cloud as a form POST. The server resolves the token with the
 *      marketplace at once, records the purchase (MarketplaceSubscription),
 *      and hands the browser a one-use claim token in an HttpOnly cookie -
 *      never in a URL, where an analytics tag would report it.
 *   2. The browser lands on the purchase page (/accounts/marketplace). If
 *      nobody is signed in, the page's first request sends it to sign in;
 *      every sign-in ends on the dashboard, which sees the pending cookie
 *      below and sends the browser back here.
 *   3. The buyer picks one of their projects, or names a new one, and the
 *      server activates the purchase on the marketplace and moves the
 *      project's billing to it.
 */

export const MARKETPLACE_PURCHASE_PAGE_ROUTE: string = `${AccountsRoute.toString()}/marketplace`;

/*
 * A non-secret marker, scoped to /dashboard: "a marketplace purchase is
 * waiting to be set up in this browser". It is what the dashboard reads after
 * a sign-in to send the buyer back to the purchase page (see
 * Common/UI/Utils/MarketplacePendingPurchase for why a /dashboard cookie
 * survives a sign-in). The claim token itself is in a separate HttpOnly
 * cookie that only the marketplace API sees.
 */
export const MARKETPLACE_PURCHASE_PENDING_COOKIE_NAME: string =
  "oneuptime-marketplace-purchase-pending";

// How long a buyer has to finish setting up a purchase in the browser they bought from.
export const MARKETPLACE_PURCHASE_TTL_IN_HOURS: number = 24;

/*
 * Marketplace-billed projects are charged in usage units of one US cent: the
 * plan's per-user price, active monitors and telemetry, at the prices on
 * oneuptime.com/pricing, reported every hour. Each marketplace listing has
 * one dimension (AWS, Azure) or metric (Google Cloud) priced at $0.01 per
 * unit, with this ID.
 */
export const MARKETPLACE_USAGE_UNIT_IN_USD: number = 0.01;
export const MARKETPLACE_USAGE_DIMENSION: string = "usage_units";

// Why one of the buyer's projects cannot take the purchase.
export enum MarketplacePurchaseProjectRefusal {
  // Only a project owner, or someone who manages its billing, may change who bills it.
  NotBillingManager = "not_billing_manager",
  // Already billed by a marketplace purchase.
  AlreadyBilledByMarketplace = "already_billed_by_marketplace",
  // Bought from a OneUptime reseller, which bills it.
  BoughtFromReseller = "bought_from_reseller",
}

export interface MarketplacePurchaseProject {
  id: string;
  name: string;
  isEligible: boolean;
  refusal?: MarketplacePurchaseProjectRefusal | undefined;
}

export interface MarketplacePurchasePlan {
  // The plan ID a project is created on (SUBSCRIPTION_PLAN_*'s monthly price ID).
  planId: string;
  name: string;
  monthlyPricePerUserInUSD: number;
  isCustomPricing: boolean;
}

export interface MarketplacePurchaseDetails {
  marketplace: CloudMarketplace;
  marketplaceName: string;
  status: MarketplaceSubscriptionStatus;
  // Who bought it, as the marketplace names them (AWS account ID, tenant ID, account ID).
  buyerId: string | null;
  buyerEmail: string | null;
  marketplacePlan: string | null;
  isFreeTrial: boolean;
  // Set when the purchase already pays for a project the buyer can open.
  linkedProjectId: string | null;
  signedInEmail: string;
  projects: Array<MarketplacePurchaseProject>;
  plans: Array<MarketplacePurchasePlan>;
  canCreateProject: boolean;
}
