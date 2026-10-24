import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import OneUptimeDate from "Common/Types/Date";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import {
  GoogleCloudMarketplacePubSubServiceAccountEmail,
  GoogleCloudMarketplaceProviderId,
  GoogleCloudMarketplaceServiceName,
  GoogleCloudMarketplaceUsageMetric,
} from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";
import MarketplaceAdapter, {
  MarketplaceActivationError,
  MarketplacePurchaseFacts,
  MarketplaceStatus,
  MarketplaceUsageRecord,
  MarketplaceUsageResult,
} from "../MarketplaceAdapter";
import MarketplaceApiError from "../MarketplaceApiError";
import MarketplaceConfig from "../MarketplaceConfig";
import GoogleCloudMarketplaceAPI, {
  GoogleCloudAccount,
  GoogleCloudEntitlement,
  GoogleCloudServiceControlError,
  GoogleServiceAccountKey,
} from "./GoogleCloudMarketplaceAPI";

/*
 * Google Cloud Marketplace.
 *
 * A purchase here is a procurement ACCOUNT (one per buyer, made the first
 * time they buy any of OneUptime's products) with one or more ENTITLEMENTS -
 * the orders, each on a plan. The buyer signs up with OneUptime once per
 * account, so the account is what a OneUptime project is linked to
 * (MarketplaceSubscription.externalSubscriptionId), and the entitlement in
 * force is what is billed (externalEntitlementId, usageReportingId).
 *
 * https://docs.cloud.google.com/marketplace/docs/partners/integrated-saas/manage-entitlements
 */

// Service Control's refusals that mean the buyer can no longer be billed.
const INACTIVE_CONSUMER_CODES: Array<string> = [
  "SERVICE_NOT_ACTIVATED",
  "BILLING_DISABLED",
  "PROJECT_DELETED",
  "PROJECT_INVALID",
  "CONSUMER_INVALID",
];

export class GoogleCloudEntitlementState {
  /*
   * An entitlement waiting for approval is not billed yet; one pending a
   * cancellation or a plan change is still in force until the change lands.
   */
  public static toStatus(state: string): MarketplaceSubscriptionStatus | null {
    switch (state) {
      case "ENTITLEMENT_ACTIVATION_REQUESTED":
        return MarketplaceSubscriptionStatus.Pending;
      case "ENTITLEMENT_ACTIVE":
      case "ENTITLEMENT_PENDING_CANCELLATION":
      case "ENTITLEMENT_PENDING_PLAN_CHANGE":
      case "ENTITLEMENT_PENDING_PLAN_CHANGE_APPROVAL":
        return MarketplaceSubscriptionStatus.Active;
      case "ENTITLEMENT_SUSPENDED":
        return MarketplaceSubscriptionStatus.Suspended;
      case "ENTITLEMENT_CANCELLED":
        return MarketplaceSubscriptionStatus.Cancelled;
      default:
        return null;
    }
  }

  public static isInForce(state: string): boolean {
    return (
      GoogleCloudEntitlementState.toStatus(state) ===
      MarketplaceSubscriptionStatus.Active
    );
  }

  /*
   * The entitlement that bills an account: the newest one in force; failing
   * that, the newest waiting for approval; failing that, the newest of all.
   * One account normally has one at a time; a buyer who cancels and buys
   * again has an old, cancelled one beside the new one.
   */
  public static pickCurrent(
    entitlements: Array<GoogleCloudEntitlement>,
  ): GoogleCloudEntitlement | null {
    const newestFirst: Array<GoogleCloudEntitlement> = [...entitlements].sort(
      (a: GoogleCloudEntitlement, b: GoogleCloudEntitlement): number => {
        return (b.createTime || "").localeCompare(a.createTime || "");
      },
    );

    return (
      newestFirst.find((entitlement: GoogleCloudEntitlement): boolean => {
        return GoogleCloudEntitlementState.isInForce(entitlement.state);
      }) ||
      newestFirst.find((entitlement: GoogleCloudEntitlement): boolean => {
        return entitlement.state === "ENTITLEMENT_ACTIVATION_REQUESTED";
      }) ||
      newestFirst[0] ||
      null
    );
  }

  public static toFacts(
    entitlement: GoogleCloudEntitlement,
  ): MarketplacePurchaseFacts {
    return {
      externalCustomerId: entitlement.accountId,
      externalEntitlementId: entitlement.id,
      externalPlanId: entitlement.plan || undefined,
      externalOfferId: entitlement.product || undefined,
      usageReportingId: entitlement.usageReportingId || undefined,
      externalState: entitlement.state,
      details: {
        entitlement: entitlement.name,
        plan: entitlement.plan,
        newPendingPlan: entitlement.newPendingPlan,
        product: entitlement.product,
        state: entitlement.state,
        updateTime: entitlement.updateTime,
      },
    };
  }
}

export default class GoogleCloudMarketplaceAdapter
  implements MarketplaceAdapter
{
  public readonly marketplace: CloudMarketplace = CloudMarketplace.GoogleCloud;
  // Service Control counts each report by its operation ID, whatever its hour.
  public readonly keepsOneReportPerHour: boolean = false;
  private api: GoogleCloudMarketplaceAPI | null;

  public constructor(api?: GoogleCloudMarketplaceAPI | undefined) {
    this.api = api || null;
  }

  public isConfigured(): boolean {
    return Boolean(this.api) || MarketplaceConfig.isGoogleCloudConfigured();
  }

  public getApi(): GoogleCloudMarketplaceAPI {
    if (this.api) {
      return this.api;
    }

    const serviceAccountKey: GoogleServiceAccountKey | null =
      MarketplaceConfig.getGoogleCloudServiceAccountKey();

    if (!MarketplaceConfig.isGoogleCloudConfigured() || !serviceAccountKey) {
      throw new MarketplaceApiError({
        message: "Google Cloud Marketplace is not configured on this server.",
        status: null,
        isRetryable: false,
      });
    }

    this.api = new GoogleCloudMarketplaceAPI({
      providerId: GoogleCloudMarketplaceProviderId!,
      serviceAccountKey: serviceAccountKey,
      serviceName: GoogleCloudMarketplaceServiceName,
    });

    return this.api;
  }

  // The service account Pub/Sub signs push deliveries as.
  public static getPubSubServiceAccountEmail(): string | null {
    return GoogleCloudMarketplacePubSubServiceAccountEmail;
  }

  /*
   * The buyer signed up: approve their account (the "signup" approval), then
   * every order still waiting for approval, and bill the one in force.
   * Approving what is already approved is skipped, so a second visit - or a
   * Pub/Sub delivery that approved an order a moment earlier - changes
   * nothing.
   */
  public async activate(
    subscription: MarketplaceSubscription,
  ): Promise<MarketplaceStatus> {
    const api: GoogleCloudMarketplaceAPI = this.getApi();
    const accountId: string = subscription.externalSubscriptionId!;

    const account: GoogleCloudAccount | null = await api.getAccount(accountId);

    if (!account) {
      throw new MarketplaceActivationError(
        "Google Cloud no longer has this purchase. Open OneUptime from Google Cloud Marketplace again.",
      );
    }

    if (account.approvals["signup"] !== "APPROVED") {
      await api.approveAccount(accountId);
    }

    const entitlements: Array<GoogleCloudEntitlement> =
      await api.listEntitlements(accountId);

    for (const entitlement of entitlements) {
      if (entitlement.state !== "ENTITLEMENT_ACTIVATION_REQUESTED") {
        continue;
      }

      await this.approveEntitlement(entitlement.id);
      // Approval is what activates it; Google confirms with ENTITLEMENT_ACTIVE.
      entitlement.state = "ENTITLEMENT_ACTIVE";
    }

    const current: GoogleCloudEntitlement | null =
      GoogleCloudEntitlementState.pickCurrent(entitlements);

    if (!current) {
      throw new MarketplaceActivationError(
        "Google Cloud has not finished creating your order yet. Wait a minute, then reload this page.",
      );
    }

    const status: MarketplaceSubscriptionStatus | null =
      GoogleCloudEntitlementState.toStatus(current.state);

    if (status !== MarketplaceSubscriptionStatus.Active) {
      throw new MarketplaceActivationError(
        "This Google Cloud Marketplace order is no longer active. Buy OneUptime again on Google Cloud Marketplace to continue.",
      );
    }

    return {
      status: status,
      ...GoogleCloudEntitlementState.toFacts(current),
    };
  }

  /*
   * Approve one order, tolerating the race with another approval of the same
   * order: Google refuses the second one, and what matters is only that the
   * order is no longer waiting.
   */
  public async approveEntitlement(entitlementId: string): Promise<void> {
    const api: GoogleCloudMarketplaceAPI = this.getApi();

    try {
      await api.approveEntitlement(entitlementId);
    } catch (err) {
      if (!(err instanceof MarketplaceApiError) || err.status !== 400) {
        throw err;
      }

      const entitlement: GoogleCloudEntitlement | null =
        await api.getEntitlement(entitlementId);

      if (
        !entitlement ||
        entitlement.state === "ENTITLEMENT_ACTIVATION_REQUESTED"
      ) {
        throw err;
      }
    }
  }

  public async fetchStatus(
    subscription: MarketplaceSubscription,
  ): Promise<MarketplaceStatus | null> {
    const entitlements: Array<GoogleCloudEntitlement> =
      await this.getApi().listEntitlements(
        subscription.externalSubscriptionId!,
      );

    const current: GoogleCloudEntitlement | null =
      GoogleCloudEntitlementState.pickCurrent(entitlements);

    if (!current) {
      return null;
    }

    const status: MarketplaceSubscriptionStatus | null =
      GoogleCloudEntitlementState.toStatus(current.state);

    if (!status) {
      return null;
    }

    return {
      status: status,
      ...GoogleCloudEntitlementState.toFacts(current),
    };
  }

  public async reportUsage(
    subscription: MarketplaceSubscription,
    record: MarketplaceUsageRecord,
  ): Promise<MarketplaceUsageResult> {
    if (!subscription.usageReportingId) {
      // Filled in from the entitlement by the next event or reconciliation.
      return {
        outcome: "retry",
        error: "The entitlement's usage reporting ID is not known yet.",
      };
    }

    const api: GoogleCloudMarketplaceAPI = this.getApi();

    const operation: Parameters<GoogleCloudMarketplaceAPI["checkUsage"]>[0] = {
      // Our report's own ID: the same on every retry, so Service Control counts it once.
      operationId: record.reportId,
      operationName: "OneUptime usage",
      consumerId: subscription.usageReportingId,
      startTime: OneUptimeDate.toString(record.periodStart),
      endTime: OneUptimeDate.toString(record.periodEnd),
      metricName: GoogleCloudMarketplaceUsageMetric || "",
      quantity: record.quantity,
      labels: {
        "cloudmarketplace.googleapis.com/resource_name": record.projectId,
      },
    };

    try {
      const checkErrors: Array<GoogleCloudServiceControlError> =
        await api.checkUsage(operation);

      if (checkErrors.length > 0) {
        return {
          outcome: "rejected",
          error: GoogleCloudMarketplaceAdapter.describeErrors(checkErrors),
          isPurchaseInactive: checkErrors.some(
            (error: GoogleCloudServiceControlError): boolean => {
              return INACTIVE_CONSUMER_CODES.includes(error.code);
            },
          ),
        };
      }

      const reportErrors: Array<GoogleCloudServiceControlError> =
        await api.reportUsage(operation);

      if (reportErrors.length > 0) {
        return {
          outcome: "rejected",
          error: GoogleCloudMarketplaceAdapter.describeErrors(reportErrors),
        };
      }

      return { outcome: "accepted", externalReportId: record.reportId };
    } catch (err) {
      if (err instanceof MarketplaceApiError) {
        return {
          outcome: err.isRetryable ? "retry" : "rejected",
          error: err.message,
        };
      }

      logger.error(err);

      return { outcome: "retry", error: (err as Error).message };
    }
  }

  private static describeErrors(
    errors: Array<GoogleCloudServiceControlError>,
  ): string {
    return errors
      .map((error: GoogleCloudServiceControlError): string => {
        return error.detail ? `${error.code}: ${error.detail}` : error.code;
      })
      .join("; ");
  }
}
