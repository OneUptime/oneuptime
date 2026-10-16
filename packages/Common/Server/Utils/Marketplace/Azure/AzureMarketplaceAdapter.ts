import MarketplaceSubscription from "../../../../Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "../../../../Types/Marketplace/CloudMarketplace";
import { MARKETPLACE_USAGE_DIMENSION } from "../../../../Types/Marketplace/MarketplacePurchase";
import MarketplaceSubscriptionStatus from "../../../../Types/Marketplace/MarketplaceSubscriptionStatus";
import {
  AzureMarketplaceClientId,
  AzureMarketplaceClientSecret,
  AzureMarketplaceTenantId,
} from "../../../EnvironmentConfig";
import MarketplaceAdapter, {
  MarketplaceActivationError,
  MarketplacePurchaseFacts,
  MarketplaceStatus,
  MarketplaceUsageRecord,
  MarketplaceUsageResult,
} from "../MarketplaceAdapter";
import MarketplaceApiError from "../MarketplaceApiError";
import MarketplaceConfig from "../MarketplaceConfig";
import AzureMarketplaceAPI, {
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
   * One event per report, in the hour the report ends in. Microsoft takes one
   * event per hour per dimension and answers a second with "Duplicate", so a
   * retry is counted once; and an hour that ends a report is never the hour
   * of an earlier one, because reports end on the hour (only a purchase's
   * last report ends mid-hour, and nothing follows it).
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

    const effectiveStartTime: Date = new Date(
      record.periodEnd.getTime() - 60 * 1000,
    );
    effectiveStartTime.setUTCMinutes(0, 0, 0);

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
      case "Duplicate":
        return {
          outcome: "accepted",
          externalReportId: result.usageEventId || undefined,
        };
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
}
