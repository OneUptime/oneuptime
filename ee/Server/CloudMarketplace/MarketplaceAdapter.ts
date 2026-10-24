import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import { JSONObject } from "Common/Types/JSON";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";

/*
 * What one cloud marketplace has to do for OneUptime, whatever its API looks
 * like. Each marketplace has an adapter (AWS/, Azure/, GoogleCloud/) and the
 * rest of the marketplace code - the purchase page, the hourly usage report,
 * the daily reconciliation - talks only to this.
 *
 * Each marketplace's own inbound traffic - the landing page, webhooks, event
 * deliveries - is handled by its own module, because what arrives and how it
 * is authenticated has nothing in common across the three.
 */

// What a marketplace says about a purchase, to be written onto its record.
export interface MarketplacePurchaseFacts {
  externalCustomerId?: string | undefined;
  externalEntitlementId?: string | undefined;
  externalOfferId?: string | undefined;
  externalPlanId?: string | undefined;
  quantity?: number | undefined;
  usageReportingId?: string | undefined;
  purchaserEmail?: string | undefined;
  isFreeTrial?: boolean | undefined;
  externalState?: string | undefined;
  details?: JSONObject | undefined;
}

export interface MarketplaceStatus extends MarketplacePurchaseFacts {
  status: MarketplaceSubscriptionStatus;
}

/*
 * A refusal the buyer can act on - shown on the purchase page as written, so
 * it is worded for them ("finish setting up ... in the AWS console") and
 * carries nothing secret.
 */
export class MarketplaceActivationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MarketplaceActivationError";
  }
}

/*
 * Where a report is filed in time: a minute before its period ends, so in the
 * hour its usage ends in - an hourly report, which ends on the hour, in the
 * hour it covers; a final one, which ends part way through an hour, in that
 * hour. It is read off the report's own period, so a report sent again is
 * filed exactly where it was the first time.
 */
export class MarketplaceUsageHour {
  public static getFilingTime(periodEnd: Date): Date {
    return new Date(periodEnd.getTime() - 60 * 1000);
  }

  // The start (UTC) of the hour a report ending at periodEnd is filed in.
  public static getHour(periodEnd: Date): Date {
    const hour: Date = MarketplaceUsageHour.getFilingTime(periodEnd);
    hour.setUTCMinutes(0, 0, 0);
    return hour;
  }
}

// One report of usage, as written down before it is sent.
export interface MarketplaceUsageRecord {
  // The MarketplaceUsageReport's own ID. Google Cloud uses it as the operation ID.
  reportId: string;
  // Whole usage units (one cent each). Always above zero.
  quantity: number;
  periodStart: Date;
  periodEnd: Date;
  projectId: string;
}

export interface MarketplaceUsageResult {
  /*
   * accepted: the marketplace has it (or had the same record already).
   * retry: it could not answer now - send the same record again later.
   * rejected: it refused the record for good.
   */
  outcome: "accepted" | "retry" | "rejected";
  externalReportId?: string | undefined;
  error?: string | undefined;
  /*
   * The marketplace refused because the purchase is no longer billable (AWS
   * CustomerNotSubscribed, Azure ResourceNotActive, Google
   * SERVICE_NOT_ACTIVATED). The reporter then reads the purchase's status
   * again rather than keep billing it.
   */
  isPurchaseInactive?: boolean | undefined;
}

export default interface MarketplaceAdapter {
  readonly marketplace: CloudMarketplace;

  /*
   * Whether the marketplace keeps one usage record per purchase and hour -
   * the first it is sent - and refuses any other in that hour as a
   * duplicate, unbilled (AWS, Microsoft). Reports are filed by
   * MarketplaceUsageHour, and the reporter never files two of a purchase's
   * reports in one hour of such a marketplace. Google Cloud counts each
   * report by its own ID, whatever its hour.
   */
  readonly keepsOneReportPerHour: boolean;

  // Whether this server has every setting the marketplace needs.
  isConfigured(): boolean;

  /*
   * The buyer has chosen the project the purchase pays for: make the
   * purchase active on the marketplace (Azure: activate the subscription;
   * Google Cloud: approve the account and its entitlements; AWS: confirm the
   * agreement is active). Throws MarketplaceActivationError with words for
   * the buyer when the marketplace will not have it yet.
   */
  activate(subscription: MarketplaceSubscription): Promise<MarketplaceStatus>;

  /*
   * The purchase's state as the marketplace has it now, for the daily
   * reconciliation that catches a notification that never arrived. Null when
   * there is nothing to read it by yet.
   */
  fetchStatus(
    subscription: MarketplaceSubscription,
  ): Promise<MarketplaceStatus | null>;

  // Send one usage record. Never throws for a refusal: it says so in the result.
  reportUsage(
    subscription: MarketplaceSubscription,
    record: MarketplaceUsageRecord,
  ): Promise<MarketplaceUsageResult>;
}
