import DatabaseService from "./DatabaseService";
import MarketplaceSubscription from "../../Models/DatabaseModels/MarketplaceSubscription";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import CloudMarketplace from "../../Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "../../Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * The purchases of OneUptime Cloud on a cloud marketplace (AWS, Microsoft,
 * Google Cloud, Vercel), and the lookups every reader of them shares. What
 * records, claims, links and unlinks a purchase is OneUptime Cloud's billing,
 * in the enterprise module (ee/Server/CloudMarketplace/MarketplacePurchases.ts).
 */

// Everything a caller may need to read off a purchase.
const PURCHASE_SELECT: Record<string, true> = {
  _id: true,
  marketplace: true,
  externalSubscriptionId: true,
  externalCustomerId: true,
  externalEntitlementId: true,
  externalOfferId: true,
  externalPlanId: true,
  quantity: true,
  usageReportingId: true,
  status: true,
  externalState: true,
  projectId: true,
  linkedByUserId: true,
  linkedAt: true,
  purchaserEmail: true,
  isFreeTrial: true,
  isUsageMetered: true,
  claimTokenExpiresAt: true,
  usageReportedUntil: true,
  unreportedUsageInUSD: true,
  lastSyncedAt: true,
  details: true,
};

export class Service extends DatabaseService<MarketplaceSubscription> {
  public constructor() {
    super(MarketplaceSubscription);
  }

  public getPurchaseSelect(): Record<string, true> {
    return { ...PURCHASE_SELECT };
  }

  @CaptureSpan()
  public async findPurchase(data: {
    marketplace: CloudMarketplace;
    externalSubscriptionId: string;
  }): Promise<MarketplaceSubscription | null> {
    return await this.findOneBy({
      query: {
        marketplace: data.marketplace,
        externalSubscriptionId: data.externalSubscriptionId,
      },
      select: this.getPurchaseSelect(),
      props: { isRoot: true },
    });
  }

  @CaptureSpan()
  public async findPurchaseById(
    id: ObjectID,
  ): Promise<MarketplaceSubscription | null> {
    return await this.findOneById({
      id: id,
      select: this.getPurchaseSelect(),
      props: { isRoot: true },
    });
  }

  @CaptureSpan()
  public async findPurchaseByEntitlementId(data: {
    marketplace: CloudMarketplace;
    externalEntitlementId: string;
  }): Promise<MarketplaceSubscription | null> {
    return await this.findOneBy({
      query: {
        marketplace: data.marketplace,
        externalEntitlementId: data.externalEntitlementId,
      },
      select: this.getPurchaseSelect(),
      props: { isRoot: true },
    });
  }

  /*
   * The purchase that bills a project: the one still in force if there is
   * one, else the last one that did.
   */
  @CaptureSpan()
  public async findPurchaseForProject(
    projectId: ObjectID,
  ): Promise<MarketplaceSubscription | null> {
    const inForce: MarketplaceSubscription | null = await this.findOneBy({
      query: {
        projectId: projectId,
        status: QueryHelper.notEquals(MarketplaceSubscriptionStatus.Cancelled),
      },
      select: this.getPurchaseSelect(),
      props: { isRoot: true },
    });

    if (inForce) {
      return inForce;
    }

    return await this.findOneBy({
      query: { projectId: projectId },
      select: this.getPurchaseSelect(),
      sort: { linkedAt: SortOrder.Descending },
      props: { isRoot: true },
    });
  }
}

export default new Service();
