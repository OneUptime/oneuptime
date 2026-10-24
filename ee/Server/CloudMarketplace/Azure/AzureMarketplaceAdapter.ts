import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import { MARKETPLACE_USAGE_DIMENSION } from "Common/Types/Marketplace/MarketplacePurchase";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import {
  AzureMarketplaceClientId,
  AzureMarketplaceClientSecret,
  AzureMarketplaceTenantId,
} from "Common/Server/EnvironmentConfig";
import MarketplaceAdapter, {
  MarketplaceActivationError,
  MarketplacePurchaseFacts,
  MarketplaceStatus,
  MarketplaceUsageHour,
  MarketplaceUsageRecord,
  MarketplaceUsageResult,
} from "../MarketplaceAdapter";
import MarketplaceApiError from "../MarketplaceApiError";
import MarketplaceConfig from "../MarketplaceConfig";
import AzureMarketplaceAPI, {
  AzureAcceptedUsageEvent,
  AzureSaasSubscription,
  AzureUsageEventResult,
} from "./AzureMarketplaceAPI";

/*
 * Microsoft Marketplace (Azure), SaaS sold through Microsoft.
 *
 * A purchase is a SaaS SUBSCRIPTION, identified by its GUID
 * (MarketplaceSubscription.externalSubscriptionId), on a plan of the offer.
 * Microsoft starts billing when the subscription is activated - by OneUptime
 * once the buyer has linked a project, or by Microsoft at purchase for a plan
 * with auto activation - and usage is reported against it with metered
 * billing events, one per hour at most for each dimension.
 *
 * https://learn.microsoft.com/partner-center/marketplace-offers/pc-saas-fulfillment-life-cycle
 */

export class AzureSubscriptionStatus {
  public static toStatus(status: string): MarketplaceSubscriptionStatus | null {
    switch (status.trim()) {
      case "PendingFulfillmentStart":
        return MarketplaceSubscriptionStatus.Pending;
      case "Subscribed":
        return MarketplaceSubscriptionStatus.Active;
      case "Suspended":
        return MarketplaceSubscriptionStatus.Suspended;
      case "Unsubscribed":
        return MarketplaceSubscriptionStatus.Cancelled;
      default:
        return null;
    }
  }

  public static toFacts(
    subscription: AzureSaasSubscription,
  ): MarketplacePurchaseFacts {
    return {
      externalCustomerId:
        subscription.beneficiary.tenantId ||
        subscription.purchaser.tenantId ||
        undefined,
      externalOfferId: subscription.offerId || undefined,
      externalPlanId: subscription.planId || undefined,
      ...(subscription.quantity ? { quantity: subscription.quantity } : {}),
      purchaserEmail:
        subscription.purchaser.emailId ||
        subscription.beneficiary.emailId ||
        undefined,
      isFreeTrial: subscription.isFreeTrial,
      externalState: subscription.status,
      details: {
        name: subscription.name,
        offerId: subscription.offerId,
        planId: subscription.planId,
        quantity: subscription.quantity,
        status: subscription.status,
        beneficiaryEmail: subscription.beneficiary.emailId,
        beneficiaryTenantId: subscription.beneficiary.tenantId,
        purchaserEmail: subscription.purchaser.emailId,
        purchaserTenantId: subscription.purchaser.tenantId,
        isFreeTrial: subscription.isFreeTrial,
        isTest: subscription.isTest,
        termStartDate: subscription.termStartDate,
        termEndDate: subscription.termEndDate,
        termUnit: subscription.termUnit,
        autoRenew: subscription.autoRenew,
      },
    };
  }
}

export default class AzureMarketplaceAdapter implements MarketplaceAdapter {
  public readonly marketplace: CloudMarketplace = CloudMarketplace.Azure;
  // Microsoft takes one usage event per subscription, dimension and hour.
  public readonly keepsOneReportPerHour: boolean = true;
  private api: AzureMarketplaceAPI | null;

  public constructor(api?: AzureMarketplaceAPI | undefined) {
    this.api = api || null;
  }

  public isConfigured(): boolean {
    return Boolean(this.api) || MarketplaceConfig.isAzureConfigured();
  }

  public getApi(): AzureMarketplaceAPI {
    if (this.api) {
      return this.api;
    }

    if (!MarketplaceConfig.isAzureConfigured()) {
      throw new MarketplaceApiError({
        message: "Microsoft Marketplace is not configured on this server.",
        status: null,
        isRetryable: false,
      });
    }

    this.api = new AzureMarketplaceAPI({
      tenantId: AzureMarketplaceTenantId!,
      clientId: AzureMarketplaceClientId!,
      clientSecret: AzureMarketplaceClientSecret!,
    });

    return this.api;
  }

  /*
   * Activate the subscription - which is when Microsoft starts billing it -
   * unless Microsoft already has (auto activation, or a second visit).
   */
  public async activate(
    subscription: MarketplaceSubscription,
  ): Promise<MarketplaceStatus> {
    const api: AzureMarketplaceAPI = this.getApi();
    const current: AzureSaasSubscription | null = await api.getSubscription(
      subscription.externalSubscriptionId!,
    );

    if (!current) {
      throw new MarketplaceActivationError(
        "Microsoft no longer has this purchase. Open OneUptime from the Azure portal and select Configure account again.",
      );
    }

    const status: MarketplaceSubscriptionStatus | null =
      AzureSubscriptionStatus.toStatus(current.status);

    if (status === MarketplaceSubscriptionStatus.Suspended) {
      throw new MarketplaceActivationError(
        "Microsoft has suspended this subscription, usually because a payment did not go through. Resolve it in the Azure portal, then try again.",
      );
    }

    if (status === MarketplaceSubscriptionStatus.Cancelled) {
      throw new MarketplaceActivationError(
        "This subscription has been cancelled. Buy OneUptime again on Microsoft Marketplace to continue.",
      );
    }

    if (status === MarketplaceSubscriptionStatus.Pending) {
      await api.activate({
        subscriptionId: current.id,
        planId: current.planId,
        quantity: current.quantity,
      });
    }

    return {
      ...AzureSubscriptionStatus.toFacts(current),
      status: MarketplaceSubscriptionStatus.Active,
      externalState: "Subscribed",
    };
  }

  public async fetchStatus(
    subscription: MarketplaceSubscription,
  ): Promise<MarketplaceStatus | null> {
    const current: AzureSaasSubscription | null =
      await this.getApi().getSubscription(subscription.externalSubscriptionId!);

    if (!current) {
      return null;
    }

    const status: MarketplaceSubscriptionStatus | null =
      AzureSubscriptionStatus.toStatus(current.status);

    if (!status) {
      return null;
    }

    return { status: status, ...AzureSubscriptionStatus.toFacts(current) };
  }

  /*
   * One event per report, in the hour the report is filed in
   * (MarketplaceUsageHour). Microsoft takes one event per hour per dimension
   * and answers a second with "Duplicate", so a retry is counted once; and
   * the reporter never files two reports of a purchase in the same hour.
   */
  public async reportUsage(
    subscription: MarketplaceSubscription,
    record: MarketplaceUsageRecord,
  ): Promise<MarketplaceUsageResult> {
    if (!subscription.externalPlanId) {
      return {
        outcome: "retry",
        error: "The subscription's plan is not known yet.",
      };
    }

    const effectiveStartTime: Date = MarketplaceUsageHour.getHour(
      record.periodEnd,
    );

    let results: Array<AzureUsageEventResult>;

    try {
      results = await this.getApi().reportUsageEvents([
        {
          resourceId: subscription.externalSubscriptionId!,
          quantity: record.quantity,
          dimension: MARKETPLACE_USAGE_DIMENSION,
          effectiveStartTime: effectiveStartTime,
          planId: subscription.externalPlanId,
        },
      ]);
    } catch (err) {
      if (err instanceof MarketplaceApiError) {
        return {
          outcome: err.isRetryable ? "retry" : "rejected",
          error: err.message,
        };
      }

      return { outcome: "retry", error: (err as Error).message };
    }

    const result: AzureUsageEventResult | undefined = results[0];

    if (!result) {
      return { outcome: "retry", error: "Microsoft returned no result." };
    }

    switch (result.status) {
      case "Accepted":
        return {
          outcome: "accepted",
          externalReportId: result.usageEventId || undefined,
        };
      case "Duplicate":
        return AzureMarketplaceAdapter.readDuplicate(result, record);
      case "ResourceNotActive":
        return {
          outcome: "rejected",
          error: "Microsoft says the subscription is not active.",
          isPurchaseInactive: true,
        };
      case "Error":
        return {
          outcome: "retry",
          error: `Microsoft could not record the event${result.errorCode ? ` (${result.errorCode})` : ""}.`,
        };
      default:
        return {
          outcome: "rejected",
          error: `Microsoft refused the event: ${result.status}${result.errorCode ? ` (${result.errorCode})` : ""}`,
        };
    }
  }

  /*
   * Microsoft keeps one event per subscription, dimension and hour, and
   * answers any other for that hour "Duplicate", with the event it kept. The
   * same quantity is this report sent again after an answer that was lost:
   * Microsoft has it. Another quantity is another report filed in the same
   * hour: Microsoft bills that one, and this one is lost. When Microsoft
   * leaves out the event it kept, the report is taken as sent again, as it
   * almost always is.
   */
  private static readDuplicate(
    result: AzureUsageEventResult,
    record: MarketplaceUsageRecord,
  ): MarketplaceUsageResult {
    const kept: AzureAcceptedUsageEvent | undefined = result.acceptedEvent;

    if (
      kept &&
      kept.quantity !== null &&
      Math.abs(kept.quantity - record.quantity) > 1e-6
    ) {
      return {
        outcome: "rejected",
        error: `Microsoft already has another usage event for this hour (${kept.quantity} units${kept.usageEventId ? `, event ${kept.usageEventId}` : ""}).`,
      };
    }

    return {
      outcome: "accepted",
      externalReportId: kept?.usageEventId || result.usageEventId || undefined,
    };
  }
}
