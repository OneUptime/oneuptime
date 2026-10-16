import MarketplaceSubscription from "../../../Models/DatabaseModels/MarketplaceSubscription";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import MarketplaceSubscriptionStatus from "../../../Types/Marketplace/MarketplaceSubscriptionStatus";
import Sleep from "../../../Types/Sleep";
import MarketplaceSubscriptionService from "../../Services/MarketplaceSubscriptionService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import MarketplaceAdapter, { MarketplaceStatus } from "./MarketplaceAdapter";
import MarketplaceAdapters from "./MarketplaceAdapters";
import MarketplaceUsageReporter from "./MarketplaceUsageReporter";

/*
 * Reads every purchase that has not ended back from its marketplace and
 * records where it stands (Workers: Marketplace:SyncPurchases, daily).
 *
 * Webhooks, events and Pub/Sub deliveries are how a marketplace normally
 * tells OneUptime a purchase changed, and each of them is retried for hours.
 * This is for the one that still never arrived - an endpoint down for longer
 * than the retries, an EventBridge rule misconfigured - so a cancelled
 * purchase stops being served, and a reinstated one starts again, within a
 * day at the latest.
 */
export default class MarketplacePurchaseSync {
  public static async syncAll(): Promise<void> {
    const purchases: Array<MarketplaceSubscription> =
      await MarketplaceSubscriptionService.findBy({
        query: {
          status: QueryHelper.any([
            MarketplaceSubscriptionStatus.Pending,
            MarketplaceSubscriptionStatus.Active,
            MarketplaceSubscriptionStatus.Suspended,
          ]),
        },
        select: MarketplaceSubscriptionService.getPurchaseSelect(),
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    for (const purchase of purchases) {
      try {
        await MarketplacePurchaseSync.syncPurchase(purchase);
      } catch (err) {
        logger.error(
          `Could not read marketplace purchase ${purchase.id?.toString()} (${purchase.marketplace}) back from the marketplace.`,
        );
        logger.error(err);
      }

      // Every marketplace API rate-limits; a daily sweep has no hurry.
      await Sleep.sleep(250);
    }
  }

  public static async syncPurchase(
    purchase: MarketplaceSubscription,
  ): Promise<void> {
    const adapter: MarketplaceAdapter = MarketplaceAdapters.get(
      purchase.marketplace!,
    );

    if (!adapter.isConfigured()) {
      return;
    }

    const status: MarketplaceStatus | null =
      await adapter.fetchStatus(purchase);

    if (!status) {
      return;
    }

    if (
      status.status === MarketplaceSubscriptionStatus.Cancelled &&
      purchase.status === MarketplaceSubscriptionStatus.Active
    ) {
      await MarketplaceUsageReporter.reportFinalUsage(purchase);
    }

    await MarketplaceSubscriptionService.updatePurchase(purchase, status);
  }
}
