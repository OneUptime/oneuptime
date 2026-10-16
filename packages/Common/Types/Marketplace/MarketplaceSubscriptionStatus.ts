import SubscriptionStatus from "../Billing/SubscriptionStatus";

/*
 * Where a purchase made on a cloud marketplace stands, in OneUptime's words.
 * Each marketplace has its own vocabulary (Azure's PendingFulfillmentStart /
 * Subscribed / Suspended / Unsubscribed, an AWS agreement's ACTIVE /
 * CANCELLED / EXPIRED..., a Google Cloud entitlement's ENTITLEMENT_*); the
 * adapters in Server/Utils/Marketplace translate theirs into these four.
 */
enum MarketplaceSubscriptionStatus {
  // Bought, and not yet set up: not linked to a project, or not yet active on the marketplace.
  Pending = "Pending",
  // Billing through the marketplace; the project is served.
  Active = "Active",
  // The marketplace stopped billing it for now (a failed payment, an advisory). Service pauses.
  Suspended = "Suspended",
  // Ended. The marketplace no longer bills it.
  Cancelled = "Cancelled",
}

export class MarketplaceSubscriptionStatusUtil {
  /*
   * The status the linked project's subscription columns are given, so every
   * check that already decides whether a project is served
   * (SubscriptionStatusUtil, ProjectService.getCurrentPlan, the monitor
   * claim queries) treats a marketplace project exactly like a card-billed
   * one. A suspended purchase is "unpaid": the project keeps its data and
   * stops being served, as when a card's retries run out.
   */
  public static toProjectSubscriptionStatus(
    status: MarketplaceSubscriptionStatus,
  ): SubscriptionStatus {
    switch (status) {
      case MarketplaceSubscriptionStatus.Active:
        return SubscriptionStatus.Active;
      case MarketplaceSubscriptionStatus.Suspended:
        return SubscriptionStatus.Unpaid;
      case MarketplaceSubscriptionStatus.Cancelled:
        return SubscriptionStatus.Canceled;
      case MarketplaceSubscriptionStatus.Pending:
        return SubscriptionStatus.Incomplete;
    }
  }

  public static isBillable(status: MarketplaceSubscriptionStatus): boolean {
    return status === MarketplaceSubscriptionStatus.Active;
  }
}

export default MarketplaceSubscriptionStatus;
