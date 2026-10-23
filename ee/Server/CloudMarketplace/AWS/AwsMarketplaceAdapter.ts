import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import { MARKETPLACE_USAGE_DIMENSION } from "Common/Types/Marketplace/MarketplacePurchase";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import {
  AwsMarketplaceAccessKeyId,
  AwsMarketplaceSecretAccessKey,
} from "Common/Server/EnvironmentConfig";
import MarketplaceAdapter, {
  MarketplaceActivationError,
  MarketplaceStatus,
  MarketplaceUsageHour,
  MarketplaceUsageRecord,
  MarketplaceUsageResult,
} from "../MarketplaceAdapter";
import MarketplaceApiError from "../MarketplaceApiError";
import MarketplaceConfig from "../MarketplaceConfig";
import AwsMarketplaceAPI, {
  AwsAgreement,
  AwsUsageRecordResult,
} from "./AwsMarketplaceAPI";

/*
 * AWS Marketplace, SaaS with pay-as-you-go pricing.
 *
 * A purchase is a LICENSE: with concurrent agreements a buyer's AWS account
 * can hold several, one per offer accepted, so the license ARN is what a
 * OneUptime project is linked to (MarketplaceSubscription.
 * externalSubscriptionId), next to the buyer's AWS account ID and the
 * agreement the license was granted under (externalEntitlementId). Usage is
 * metered against the license with BatchMeterUsage.
 *
 * https://docs.aws.amazon.com/marketplace/latest/userguide/saas-product-customer-setup.html
 */

export class AwsAgreementStatus {
  /*
   * An agreement renewed, replaced or superseded continues under its
   * successor - the events for the successor say where the purchase stands,
   * so these answer nothing (null). Every other end is the end.
   */
  public static toStatus(status: string): MarketplaceSubscriptionStatus | null {
    switch (status) {
      case "ACTIVE":
        return MarketplaceSubscriptionStatus.Active;
      case "CANCELLED":
      case "EXPIRED":
      case "TERMINATED":
      case "ARCHIVED":
      case "ROLLED_BACK":
        return MarketplaceSubscriptionStatus.Cancelled;
      default:
        return null;
    }
  }
}

export default class AwsMarketplaceAdapter implements MarketplaceAdapter {
  public readonly marketplace: CloudMarketplace = CloudMarketplace.AWS;
  // AWS deduplicates metering records per license, dimension and hour.
  public readonly keepsOneReportPerHour: boolean = true;
  private api: AwsMarketplaceAPI | null;

  public constructor(api?: AwsMarketplaceAPI | undefined) {
    this.api = api || null;
  }

  public isConfigured(): boolean {
    return Boolean(this.api) || MarketplaceConfig.isAwsConfigured();
  }

  public getApi(): AwsMarketplaceAPI {
    if (this.api) {
      return this.api;
    }

    if (!MarketplaceConfig.isAwsConfigured()) {
      throw new MarketplaceApiError({
        message: "AWS Marketplace is not configured on this server.",
        status: null,
        isRetryable: false,
      });
    }

    this.api = new AwsMarketplaceAPI({
      accessKeyId: AwsMarketplaceAccessKeyId!,
      secretAccessKey: AwsMarketplaceSecretAccessKey!,
    });

    return this.api;
  }

  /*
   * AWS bills from the moment the buyer subscribes; there is nothing to
   * activate. What OneUptime checks is that the agreement behind the license
   * is active - "do not activate a product subscription" until AWS says the
   * license is live - so a project is never billed through an agreement that
   * is still being set up, or has already ended.
   */
  public async activate(
    subscription: MarketplaceSubscription,
  ): Promise<MarketplaceStatus> {
    const agreementId: string | undefined =
      subscription.externalEntitlementId || undefined;

    if (!agreementId) {
      throw new MarketplaceActivationError(
        "AWS is still setting up your subscription. Wait a minute, then reload this page.",
      );
    }

    const agreement: AwsAgreement | null =
      await this.getApi().describeAgreement(agreementId);

    if (!agreement) {
      throw new MarketplaceActivationError(
        "AWS is still setting up your subscription. Wait a minute, then reload this page.",
      );
    }

    const status: MarketplaceSubscriptionStatus | null =
      AwsAgreementStatus.toStatus(agreement.status);

    if (status !== MarketplaceSubscriptionStatus.Active) {
      throw new MarketplaceActivationError(
        "This AWS Marketplace subscription is no longer active. Subscribe to OneUptime on AWS Marketplace again to continue.",
      );
    }

    return {
      status: status,
      ...AwsMarketplaceAdapter.toFacts(agreement),
    };
  }

  public async fetchStatus(
    subscription: MarketplaceSubscription,
  ): Promise<MarketplaceStatus | null> {
    if (!subscription.externalEntitlementId) {
      return null;
    }

    const agreement: AwsAgreement | null =
      await this.getApi().describeAgreement(subscription.externalEntitlementId);

    if (!agreement) {
      return null;
    }

    const status: MarketplaceSubscriptionStatus | null =
      AwsAgreementStatus.toStatus(agreement.status);

    if (!status) {
      return null;
    }

    return {
      status: status,
      ...AwsMarketplaceAdapter.toFacts(agreement),
    };
  }

  public static toFacts(agreement: AwsAgreement): {
    externalState: string;
    externalOfferId?: string | undefined;
  } {
    return {
      externalState: agreement.status,
      ...(agreement.offerId ? { externalOfferId: agreement.offerId } : {}),
    };
  }

  /*
   * One record per report, stamped where the report is filed
   * (MarketplaceUsageHour). AWS bills the first record of a license and
   * dimension in each hour and refuses any other as a DuplicateRecord, so
   * each report needs an hour of its own: stamped with its period's end, a
   * final report would land in the hour of the hourly report before it,
   * stamped at the top of that hour. The stamp never changes, so a retry is
   * the identical record, and AWS keeps only one.
   */
  public async reportUsage(
    subscription: MarketplaceSubscription,
    record: MarketplaceUsageRecord,
  ): Promise<MarketplaceUsageResult> {
    if (!subscription.externalCustomerId) {
      return {
        outcome: "rejected",
        error: "The buyer's AWS account ID is not known.",
      };
    }

    let results: Array<AwsUsageRecordResult>;

    try {
      results = await this.getApi().batchMeterUsage([
        {
          customerAwsAccountId: subscription.externalCustomerId,
          licenseArn: subscription.externalSubscriptionId!,
          dimension: MARKETPLACE_USAGE_DIMENSION,
          quantity: record.quantity,
          timestamp: MarketplaceUsageHour.getFilingTime(record.periodEnd),
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

    const result: AwsUsageRecordResult | undefined = results[0];

    if (!result || result.status === "Unprocessed") {
      return { outcome: "retry", error: "AWS did not process the record." };
    }

    if (result.status === "Success") {
      return {
        outcome: "accepted",
        externalReportId: result.meteringRecordId || undefined,
      };
    }

    /*
     * The same record sent again is answered as it was the first time
     * (Success). DuplicateRecord is a different record AWS has already
     * metered for this license and dimension in this hour: AWS bills that
     * one, and this one is lost.
     */
    if (result.status === "DuplicateRecord") {
      return {
        outcome: "rejected",
        error:
          "AWS already billed another record for this license in this hour (DuplicateRecord).",
      };
    }

    if (result.status === "CustomerNotSubscribed") {
      return {
        outcome: "rejected",
        error: "AWS says the buyer is not subscribed any more.",
        isPurchaseInactive: true,
      };
    }

    return {
      outcome: "rejected",
      error: `AWS refused the record: ${result.status}`,
    };
  }
}
