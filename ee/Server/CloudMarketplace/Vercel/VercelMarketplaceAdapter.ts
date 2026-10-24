import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import MarketplaceAdapter, {
  MarketplaceStatus,
  MarketplaceUsageRecord,
  MarketplaceUsageResult,
} from "../MarketplaceAdapter";
import MarketplaceConfig from "../MarketplaceConfig";

/*
 * Vercel Marketplace in the marketplace framework. A Vercel resource is a
 * purchase like any other: the hourly usage report prices its project's
 * seats, active monitors and telemetry exactly as for AWS, Microsoft and
 * Google Cloud (MarketplaceUsageReporter), and writes each hour down as a
 * MarketplaceUsageReport.
 *
 * What differs is how Vercel is told. It takes no usage record per hour: it
 * takes the running totals of the billing period, shown to the team, and an
 * invoice at its end, which it charges. Both are made from the reports, for
 * all of an installation's resources at once, by VercelMarketplaceBilling. So
 * a report is accepted here as soon as it is written: the report itself is
 * what the next totals and invoice are made from.
 *
 * Nor is there a purchase on Vercel's side to activate or read back: a
 * resource is active from the moment Vercel provisions it, and everything
 * that changes it - a new plan, a deletion, an unpaid invoice - reaches
 * OneUptime as a call to the provider API or a webhook.
 */
export default class VercelMarketplaceAdapter implements MarketplaceAdapter {
  public readonly marketplace: CloudMarketplace = CloudMarketplace.Vercel;

  // Totals are sent per period, not per hour: any number of reports may end in one hour.
  public readonly keepsOneReportPerHour: boolean = false;

  public isConfigured(): boolean {
    return MarketplaceConfig.isVercelConfigured();
  }

  public async activate(
    _subscription: MarketplaceSubscription,
  ): Promise<MarketplaceStatus> {
    return { status: MarketplaceSubscriptionStatus.Active };
  }

  public async fetchStatus(
    _subscription: MarketplaceSubscription,
  ): Promise<MarketplaceStatus | null> {
    return null;
  }

  public async reportUsage(
    _subscription: MarketplaceSubscription,
    record: MarketplaceUsageRecord,
  ): Promise<MarketplaceUsageResult> {
    return { outcome: "accepted", externalReportId: record.reportId };
  }
}
