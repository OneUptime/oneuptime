import ProjectService from "Common/Server/Services/ProjectService";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import PostgresErrorTranslator from "Common/Server/Utils/Database/PostgresErrorTranslator";
import logger from "Common/Server/Utils/Logger";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import QueryDeepPartialEntity from "Common/Types/Database/PartialEntity";
import OneUptimeDate from "Common/Types/Date";
import Decimal from "Common/Types/Decimal";
import BadDataException from "Common/Types/Exception/BadDataException";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "Common/Types/ObjectID";
import { MarketplacePurchaseFacts } from "./MarketplaceAdapter";
import MarketplaceClaimToken from "./MarketplaceClaimToken";

/*
 * What a marketplace purchase goes through on OneUptime Cloud: recorded when
 * a marketplace first tells of it, kept in step with what the marketplace
 * says, claimed by the buyer's browser with a claim token, linked to the
 * project it pays for, and unlinked from a project that is deleted.
 *
 * The purchases are core's MarketplaceSubscription rows, read and written
 * through core's MarketplaceSubscriptionService (and its lookups:
 * findPurchase, findPurchaseById, findPurchaseByEntitlementId,
 * findPurchaseForProject). What changes them is billing, and lives here.
 */

export interface RecordMarketplacePurchase extends MarketplacePurchaseFacts {
  marketplace: CloudMarketplace;
  externalSubscriptionId: string;
  // Where the marketplace says the purchase stands, when it said so.
  status?: MarketplaceSubscriptionStatus | undefined;
}

export default class MarketplacePurchases {
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
  public static async recordPurchase(
    data: RecordMarketplacePurchase,
  ): Promise<MarketplaceSubscription> {
    const existing: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findPurchase({
        marketplace: data.marketplace,
        externalSubscriptionId: data.externalSubscriptionId,
      });

    if (existing) {
      return await MarketplacePurchases.updatePurchase(existing, data);
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
    MarketplacePurchases.copyFacts(purchase, data);

    try {
      await MarketplaceSubscriptionService.create({
        data: purchase,
        props: { isRoot: true },
      });
    } catch (err) {
      if (!PostgresErrorTranslator.isUniqueViolation(err)) {
        throw err;
      }

      const created: MarketplaceSubscription | null =
        await MarketplaceSubscriptionService.findPurchase({
          marketplace: data.marketplace,
          externalSubscriptionId: data.externalSubscriptionId,
        });

      if (!created) {
        throw err;
      }

      return await MarketplacePurchases.updatePurchase(created, data);
    }

    const created: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findPurchase({
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
  public static async updatePurchase(
    purchase: MarketplaceSubscription,
    data: MarketplacePurchaseFacts & {
      status?: MarketplaceSubscriptionStatus | undefined;
    },
  ): Promise<MarketplaceSubscription> {
    const update: MarketplaceSubscription = new MarketplaceSubscription();
    MarketplacePurchases.copyFacts(update, data);
    update.lastSyncedAt = OneUptimeDate.getCurrentDate();

    const newStatus: MarketplaceSubscriptionStatus | null =
      MarketplacePurchases.effectiveStatus({
        current: purchase.status,
        reported: data.status,
        isLinked: Boolean(purchase.projectId),
      });

    if (newStatus) {
      update.status = newStatus;
    }

    await MarketplaceSubscriptionService.updateOneById({
      id: purchase.id!,
      data: MarketplacePurchases.toUpdateData(update),
      props: { isRoot: true },
    });

    if (newStatus && purchase.projectId) {
      await ProjectService.setMarketplaceBillingStatus({
        projectId: purchase.projectId,
        status: newStatus,
      });
    }

    const updated: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findPurchaseById(purchase.id!);

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
  public static async issueClaimToken(purchaseId: ObjectID): Promise<string> {
    const token: string = MarketplaceClaimToken.generate();

    await MarketplaceSubscriptionService.updateOneById({
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
  public static async findPurchaseByClaimToken(
    token: string,
  ): Promise<MarketplaceSubscription | null> {
    if (!MarketplaceClaimToken.isToken(token)) {
      return null;
    }

    const purchase: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findOneBy({
        query: {
          claimTokenHash: MarketplaceClaimToken.hash(token),
        },
        select: MarketplaceSubscriptionService.getPurchaseSelect(),
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
  public static async linkToProject(data: {
    purchase: MarketplaceSubscription;
    projectId: ObjectID;
    userId: ObjectID;
    status: MarketplaceSubscriptionStatus;
    facts?: MarketplacePurchaseFacts | undefined;
  }): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    const update: MarketplaceSubscription = new MarketplaceSubscription();

    if (data.facts) {
      MarketplacePurchases.copyFacts(update, data.facts);
    }

    update.projectId = data.projectId;
    update.linkedByUserId = data.userId;
    update.linkedAt = now;
    update.status = data.status;
    update.lastSyncedAt = now;
    update.usageReportedUntil = now;
    update.unreportedUsageInUSD = new Decimal(0);

    await MarketplaceSubscriptionService.updateOneById({
      id: data.purchase.id!,
      data: {
        ...MarketplacePurchases.toUpdateData(update),
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
  public static async unlinkProject(projectId: ObjectID): Promise<void> {
    await MarketplaceSubscriptionService.updateBy({
      query: { projectId: projectId },
      data: {
        projectId: null,
      } as QueryDeepPartialEntity<MarketplaceSubscription>,
      skip: 0,
      limit: 100,
      props: { isRoot: true },
    });
  }

  private static copyFacts(
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
  private static toUpdateData(
    model: MarketplaceSubscription,
  ): QueryDeepPartialEntity<MarketplaceSubscription> {
    const data: Record<string, unknown> = {};

    for (const key of Object.keys(
      MarketplaceSubscriptionService.getPurchaseSelect(),
    )) {
      const value: unknown = (model as unknown as Record<string, unknown>)[key];

      if (value !== undefined && key !== "_id") {
        data[key] = value;
      }
    }

    return data as QueryDeepPartialEntity<MarketplaceSubscription>;
  }
}
