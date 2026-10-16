import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import MarketplaceSubscription from "../../Models/DatabaseModels/MarketplaceSubscription";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import OneUptimeDate from "../../Types/Date";
import Decimal from "../../Types/Decimal";
import BadDataException from "../../Types/Exception/BadDataException";
import CloudMarketplace from "../../Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "../../Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import logger from "../Utils/Logger";
import { MarketplacePurchaseFacts } from "../Utils/Marketplace/MarketplaceAdapter";
import MarketplaceClaimToken from "../Utils/Marketplace/MarketplaceClaimToken";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface RecordMarketplacePurchase extends MarketplacePurchaseFacts {
  marketplace: CloudMarketplace;
  externalSubscriptionId: string;
  // Where the marketplace says the purchase stands, when it said so.
  status?: MarketplaceSubscriptionStatus | undefined;
}

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

  /*
   * Write down what a marketplace said about a purchase - from the landing
   * page, a webhook, an event, or the daily reconciliation - creating the
   * record the first time the purchase is heard of. A status change reaches
   * the linked project at once (applyStatusToProject).
   *
   * The landing page and the marketplace's own notification for the same
   * purchase routinely arrive within a second of each other, so two callers
   * can both find nothing and both create. The unique index on (marketplace,
   * externalSubscriptionId) lets exactly one create succeed; the other sees
   * the duplicate, and updates the row the first one wrote.
   */
  @CaptureSpan()
  public async recordPurchase(
    data: RecordMarketplacePurchase,
  ): Promise<MarketplaceSubscription> {
    const existing: MarketplaceSubscription | null = await this.findPurchase({
      marketplace: data.marketplace,
      externalSubscriptionId: data.externalSubscriptionId,
    });

    if (existing) {
      return await this.updatePurchase(existing, data);
    }

    const purchase: MarketplaceSubscription = new MarketplaceSubscription();
    purchase.marketplace = data.marketplace;
    purchase.externalSubscriptionId = data.externalSubscriptionId;
    // New, so not linked to a project yet: never Active (see effectiveStatus).
    purchase.status =
      data.status === MarketplaceSubscriptionStatus.Suspended ||
      data.status === MarketplaceSubscriptionStatus.Cancelled
        ? data.status
        : MarketplaceSubscriptionStatus.Pending;
    purchase.isUsageMetered = true;
    purchase.isFreeTrial = Boolean(data.isFreeTrial);
    purchase.lastSyncedAt = OneUptimeDate.getCurrentDate();
    this.copyFacts(purchase, data);

    try {
      await this.create({
        data: purchase,
        props: { isRoot: true },
      });
    } catch (err) {
      if (!PostgresErrorTranslator.isUniqueViolation(err)) {
        throw err;
      }

      const created: MarketplaceSubscription | null = await this.findPurchase({
        marketplace: data.marketplace,
        externalSubscriptionId: data.externalSubscriptionId,
      });

      if (!created) {
        throw err;
      }

      return await this.updatePurchase(created, data);
    }

    const created: MarketplaceSubscription | null = await this.findPurchase({
      marketplace: data.marketplace,
      externalSubscriptionId: data.externalSubscriptionId,
    });

    if (!created) {
      throw new BadDataException("Marketplace purchase could not be recorded.");
    }

    return created;
  }

  /*
   * The status a purchase takes when a marketplace reports `reported`.
   *
   * Active, in OneUptime's words, means billing a project: a purchase the
   * marketplace has active but nobody has linked to a project yet is still
   * Pending here. And a purchase that is billing a project is never taken
   * back to Pending - a marketplace that still says "pending" about it is
   * behind, not right. Null when nothing changes.
   */
  public static effectiveStatus(data: {
    current: MarketplaceSubscriptionStatus | undefined;
    reported: MarketplaceSubscriptionStatus | undefined;
    isLinked: boolean;
  }): MarketplaceSubscriptionStatus | null {
    if (!data.reported) {
      return null;
    }

    const status: MarketplaceSubscriptionStatus =
      data.reported === MarketplaceSubscriptionStatus.Active && !data.isLinked
        ? MarketplaceSubscriptionStatus.Pending
        : data.reported;

    if (status === data.current) {
      return null;
    }

    if (
      status === MarketplaceSubscriptionStatus.Pending &&
      data.current === MarketplaceSubscriptionStatus.Active
    ) {
      return null;
    }

    return status;
  }

  // A new status and facts for a purchase already on record, from whatever read it.
  @CaptureSpan()
  public async updatePurchase(
    purchase: MarketplaceSubscription,
    data: MarketplacePurchaseFacts & {
      status?: MarketplaceSubscriptionStatus | undefined;
    },
  ): Promise<MarketplaceSubscription> {
    const update: MarketplaceSubscription = new MarketplaceSubscription();
    this.copyFacts(update, data);
    update.lastSyncedAt = OneUptimeDate.getCurrentDate();

    const newStatus: MarketplaceSubscriptionStatus | null =
      Service.effectiveStatus({
        current: purchase.status,
        reported: data.status,
        isLinked: Boolean(purchase.projectId),
      });

    if (newStatus) {
      update.status = newStatus;
    }

    await this.updateOneById({
      id: purchase.id!,
      data: this.toUpdateData(update),
      props: { isRoot: true },
    });

    if (newStatus && purchase.projectId) {
      await ProjectService.setMarketplaceBillingStatus({
        projectId: purchase.projectId,
        status: newStatus,
      });
    }

    const updated: MarketplaceSubscription | null =
      await this.findPurchaseById(purchase.id!);

    if (!updated) {
      throw new BadDataException("Marketplace purchase not found.");
    }

    return updated;
  }

  /*
   * A new claim token for the buyer's browser: the raw token, to go in its
   * cookie. Only the hash is stored, and a later claim replaces an earlier
   * one, so a token from a stale tab stops working once a newer one is
   * issued.
   */
  @CaptureSpan()
  public async issueClaimToken(purchaseId: ObjectID): Promise<string> {
    const token: string = MarketplaceClaimToken.generate();

    await this.updateOneById({
      id: purchaseId,
      data: {
        claimTokenHash: MarketplaceClaimToken.hash(token),
        claimTokenExpiresAt: MarketplaceClaimToken.getExpiryDate(),
      },
      props: { isRoot: true },
    });

    return token;
  }

  // The purchase a claim token was issued for, while it is still valid.
  @CaptureSpan()
  public async findPurchaseByClaimToken(
    token: string,
  ): Promise<MarketplaceSubscription | null> {
    if (!MarketplaceClaimToken.isToken(token)) {
      return null;
    }

    const purchase: MarketplaceSubscription | null = await this.findOneBy({
      query: {
        claimTokenHash: MarketplaceClaimToken.hash(token),
      },
      select: this.getPurchaseSelect(),
      props: { isRoot: true },
    });

    if (
      !purchase ||
      !purchase.claimTokenExpiresAt ||
      !OneUptimeDate.isInTheFuture(purchase.claimTokenExpiresAt)
    ) {
      return null;
    }

    return purchase;
  }

  /*
   * The purchase now pays for the project: record the link, spend the claim
   * token, start the usage clock, and move the project's billing over
   * (ProjectService.moveBillingToMarketplace) with the status the
   * marketplace just confirmed.
   */
  @CaptureSpan()
  public async linkToProject(data: {
    purchase: MarketplaceSubscription;
    projectId: ObjectID;
    userId: ObjectID;
    status: MarketplaceSubscriptionStatus;
    facts?: MarketplacePurchaseFacts | undefined;
  }): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    const update: MarketplaceSubscription = new MarketplaceSubscription();

    if (data.facts) {
      this.copyFacts(update, data.facts);
    }

    update.projectId = data.projectId;
    update.linkedByUserId = data.userId;
    update.linkedAt = now;
    update.status = data.status;
    update.lastSyncedAt = now;
    update.usageReportedUntil = now;
    update.unreportedUsageInUSD = new Decimal(0);

    await this.updateOneById({
      id: data.purchase.id!,
      data: {
        ...this.toUpdateData(update),
        claimTokenHash: null,
        claimTokenExpiresAt: null,
      } as QueryDeepPartialEntity<MarketplaceSubscription>,
      props: { isRoot: true },
    });

    await ProjectService.moveBillingToMarketplace({
      projectId: data.projectId,
      marketplace: data.purchase.marketplace!,
      status: data.status,
    });

    logger.info(
      `Marketplace purchase ${data.purchase.id?.toString()} (${data.purchase.marketplace}) now bills project ${data.projectId.toString()}.`,
    );
  }

  /*
   * A deleted project's purchases stop being billed against it. They stay on
   * record, still active on the marketplace, so the buyer can link the same
   * purchase to another project from the marketplace's "manage" link, or
   * cancel it there.
   */
  @CaptureSpan()
  public async unlinkProject(projectId: ObjectID): Promise<void> {
    await this.updateBy({
      query: { projectId: projectId },
      data: { projectId: null } as QueryDeepPartialEntity<MarketplaceSubscription>,
      skip: 0,
      limit: 100,
      props: { isRoot: true },
    });
  }

  private copyFacts(
    target: MarketplaceSubscription,
    facts: MarketplacePurchaseFacts,
  ): void {
    if (facts.externalCustomerId !== undefined) {
      target.externalCustomerId = facts.externalCustomerId;
    }
    if (facts.externalEntitlementId !== undefined) {
      target.externalEntitlementId = facts.externalEntitlementId;
    }
    if (facts.externalOfferId !== undefined) {
      target.externalOfferId = facts.externalOfferId;
    }
    if (facts.externalPlanId !== undefined) {
      target.externalPlanId = facts.externalPlanId;
    }
    if (facts.quantity !== undefined) {
      target.quantity = facts.quantity;
    }
    if (facts.usageReportingId !== undefined) {
      target.usageReportingId = facts.usageReportingId;
    }
    if (facts.purchaserEmail !== undefined) {
      target.purchaserEmail = facts.purchaserEmail;
    }
    if (facts.isFreeTrial !== undefined) {
      target.isFreeTrial = facts.isFreeTrial;
    }
    if (facts.externalState !== undefined) {
      target.externalState = facts.externalState;
    }
    if (facts.details !== undefined) {
      target.details = facts.details;
    }
  }

  // Only the columns a caller set: an update never blanks what it did not mention.
  private toUpdateData(
    model: MarketplaceSubscription,
  ): QueryDeepPartialEntity<MarketplaceSubscription> {
    const data: Record<string, unknown> = {};

    for (const key of Object.keys(PURCHASE_SELECT)) {
      const value: unknown = (model as unknown as Record<string, unknown>)[key];

      if (value !== undefined && key !== "_id") {
        data[key] = value;
      }
    }

    return data as QueryDeepPartialEntity<MarketplaceSubscription>;
  }
}

export default new Service();
