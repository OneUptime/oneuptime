import DatabaseService from "./DatabaseService";
import MarketplaceSubscriptionService from "./MarketplaceSubscriptionService";
import MarketplaceCharge from "../../Models/DatabaseModels/MarketplaceCharge";
import MarketplaceSubscription from "../../Models/DatabaseModels/MarketplaceSubscription";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import ProjectBalanceType from "../../Types/Billing/ProjectBalanceType";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Decimal from "../../Types/Decimal";
import BadDataException from "../../Types/Exception/BadDataException";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "../../Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "../../Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Top-ups of a marketplace-billed project's balances (SMS, calls, WhatsApp
 * and Telegram; AI credits), which a card pays for everywhere else.
 *
 * The balance services (NotificationService, AIBillingService) record one
 * here instead of charging a card, and credit the balance as they always
 * do. The next hourly usage report bills it (MarketplaceUsageReporter).
 */
export class Service extends DatabaseService<MarketplaceCharge> {
  public constructor() {
    super(MarketplaceCharge);
  }

  /*
   * Record a top-up, to be billed through the marketplace - only while the
   * purchase that pays for the project is active there. Otherwise nothing is
   * recorded, and the refusal says where to put it right.
   */
  @CaptureSpan()
  public async recordBalanceRecharge(data: {
    projectId: ObjectID;
    balanceType: ProjectBalanceType;
    amountInUSD: number;
    isAutomatic: boolean;
  }): Promise<MarketplaceCharge> {
    if (!Number.isFinite(data.amountInUSD) || data.amountInUSD <= 0) {
      throw new BadDataException("Invalid amount");
    }

    const purchase: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findPurchaseForProject(
        data.projectId,
      );

    if (
      !purchase ||
      !purchase.projectId ||
      purchase.status !== MarketplaceSubscriptionStatus.Active
    ) {
      throw new BadDataException(
        Service.getInactivePurchaseMessage(purchase?.marketplace),
      );
    }

    const charge: MarketplaceCharge = new MarketplaceCharge();
    charge.marketplaceSubscriptionId = purchase.id!;
    charge.projectId = data.projectId;
    charge.marketplace = purchase.marketplace!;
    charge.balanceType = data.balanceType;
    charge.amountInUSD = new Decimal(data.amountInUSD);
    charge.isAutomatic = data.isAutomatic;

    return await this.create({
      data: charge,
      props: { isRoot: true },
    });
  }

  // Why a marketplace-billed project cannot be charged right now.
  public static getInactivePurchaseMessage(
    marketplace: CloudMarketplace | undefined,
  ): string {
    const name: string = marketplace
      ? CloudMarketplaceUtil.getDisplayName(marketplace)
      : "its cloud marketplace";

    return `This project is billed through ${name}, and its subscription there is not active. Resolve it on ${name}, then try again.`;
  }

  // The purchase's charges no usage report has billed yet, oldest first.
  @CaptureSpan()
  public async findUnbilled(
    marketplaceSubscriptionId: ObjectID,
  ): Promise<Array<MarketplaceCharge>> {
    return await this.findBy({
      query: {
        marketplaceSubscriptionId: marketplaceSubscriptionId,
        marketplaceUsageReportId: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        balanceType: true,
        amountInUSD: true,
        isAutomatic: true,
      },
      sort: { createdAt: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
  }
}

export default new Service();
