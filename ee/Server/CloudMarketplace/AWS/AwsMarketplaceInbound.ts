import crypto from "crypto";
import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import OneUptimeDate from "Common/Types/Date";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import {
  AwsMarketplaceEventsSecret,
  AwsMarketplaceProductCode,
} from "Common/Server/EnvironmentConfig";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import logger from "Common/Server/Utils/Logger";
import MarketplaceUsageReporter from "../MarketplaceUsageReporter";
import AwsMarketplaceAdapter, {
  AwsAgreementStatus,
} from "./AwsMarketplaceAdapter";
import { AwsAgreement, AwsResolvedCustomer } from "./AwsMarketplaceAPI";
import MarketplacePurchases from "../MarketplacePurchases";

/*
 * What AWS Marketplace sends OneUptime:
 *
 *   - the buyer, POSTed by their browser to the fulfillment URL with a
 *     registration token (x-amzn-marketplace-token) once they subscribe;
 *   - Amazon EventBridge events from the seller account ("AWS Marketplace
 *     Agreements and Licenses", source aws.agreement-marketplace), forwarded
 *     by an EventBridge API destination to /api/marketplace/aws/events with
 *     a shared secret in a header.
 *
 * Sellers registered after July 15, 2026 receive EventBridge events, not
 * the SNS topics of older integrations, and new SaaS products identify a
 * purchase by AWS account ID and license ARN.
 *
 * Events are acted on only after reading the agreement from AWS
 * (DescribeAgreement): the shared secret proves the call came through the
 * seller's API destination, and the agreement's own status - not the event's
 * words - decides whether a project is billed or stops being served.
 *
 * https://docs.aws.amazon.com/marketplace/latest/userguide/saas-eventbridge-integration.html
 * https://docs.aws.amazon.com/marketplace/latest/userguide/notifications-eventbridge.html
 */

export const AWS_EVENTS_SECRET_HEADER: string =
  "x-oneuptime-marketplace-secret";

export class AwsInboundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AwsInboundError";
  }
}

export interface AwsMarketplaceEvent {
  detailType: string;
  source: string;
  agreementId: string | null;
  previousAgreementId: string | null;
  intent: string | null;
  licenseArn: string | null;
  acceptorAccountId: string | null;
  productCode: string | null;
  offerId: string | null;
}

export default class AwsMarketplaceInbound {
  private adapter: AwsMarketplaceAdapter;

  public constructor(options?: {
    adapter?: AwsMarketplaceAdapter | undefined;
  }) {
    this.adapter = options?.adapter || new AwsMarketplaceAdapter();
  }

  // The secret the API destination sends, compared in constant time.
  public static isEventsSecretValid(
    provided: string | undefined,
    expected: string | null = AwsMarketplaceEventsSecret,
  ): boolean {
    if (!expected || !provided) {
      return false;
    }

    const expectedDigest: Buffer = crypto
      .createHash("sha256")
      .update(expected, "utf8")
      .digest();
    const providedDigest: Buffer = crypto
      .createHash("sha256")
      .update(provided, "utf8")
      .digest();

    return crypto.timingSafeEqual(expectedDigest, providedDigest);
  }

  /*
   * The buyer's registration token, resolved at once - it expires within
   * hours, and resolving it is what proves which AWS account and license the
   * browser was sent for. The purchase is recorded (Pending until the buyer
   * links a project); a token for another seller's product is refused.
   */
  public async registerBuyer(
    registrationToken: string,
  ): Promise<MarketplaceSubscription> {
    const customer: AwsResolvedCustomer = await this.adapter
      .getApi()
      .resolveCustomer(registrationToken);

    if (
      AwsMarketplaceProductCode &&
      customer.productCode &&
      customer.productCode !== AwsMarketplaceProductCode
    ) {
      throw new AwsInboundError(
        "This AWS Marketplace link is for a different product.",
      );
    }

    if (!customer.licenseArn) {
      throw new AwsInboundError(
        "AWS did not say which license this purchase is. Open OneUptime from AWS Marketplace again.",
      );
    }

    return await MarketplacePurchases.recordPurchase({
      marketplace: CloudMarketplace.AWS,
      externalSubscriptionId: customer.licenseArn,
      externalCustomerId: customer.customerAwsAccountId,
      ...(customer.agreementId
        ? { externalEntitlementId: customer.agreementId }
        : {}),
      externalOfferId: customer.productCode || undefined,
    });
  }

  // An EventBridge event, read defensively. Null for anything that is not one.
  public static parseEvent(body: unknown): AwsMarketplaceEvent | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    const event: Record<string, unknown> = body as Record<string, unknown>;
    const detail: Record<string, unknown> =
      event["detail"] && typeof event["detail"] === "object"
        ? (event["detail"] as Record<string, unknown>)
        : {};

    const read: (objectKey: string, field: string) => string | null = (
      objectKey: string,
      field: string,
    ): string | null => {
      const value: unknown = detail[objectKey];

      if (!value || typeof value !== "object") {
        return null;
      }

      const fieldValue: unknown = (value as Record<string, unknown>)[field];
      return typeof fieldValue === "string" && fieldValue ? fieldValue : null;
    };

    if (typeof event["detail-type"] !== "string") {
      return null;
    }

    return {
      detailType: event["detail-type"],
      source: typeof event["source"] === "string" ? event["source"] : "",
      agreementId: read("agreement", "id"),
      previousAgreementId: read("agreement", "previousAgreementId"),
      intent: read("agreement", "intent"),
      licenseArn: read("license", "arn"),
      acceptorAccountId: read("acceptor", "accountId"),
      productCode: read("product", "code"),
      offerId: read("offer", "id"),
    };
  }

  /*
   * Act on one event. Throws only when AWS could not be asked about the
   * agreement - EventBridge then retries the delivery; anything that needs
   * nothing is acknowledged.
   */
  public async handleEvent(event: AwsMarketplaceEvent): Promise<void> {
    if (event.source !== "aws.agreement-marketplace") {
      return;
    }

    const type: string = event.detailType;

    if (type.startsWith("License Updated")) {
      await this.handleLicenseUpdated(event);
      return;
    }

    if (type.startsWith("License Deprovisioned")) {
      await this.handleEnded(event, { byLicense: true });
      return;
    }

    if (type.startsWith("Purchase Agreement Ended")) {
      await this.handleEnded(event, { byLicense: false });
      return;
    }

    if (type.startsWith("Purchase Agreement Created")) {
      await this.handleAgreementCreated(event);
      return;
    }

    if (type.startsWith("Purchase Agreement Advisory")) {
      /*
       * AWS suspects the buyer's account (closed, compromised, fraud) and asks
       * the seller to look. A person decides; nothing changes on its own.
       */
      logger.warn(
        `AWS Marketplace ${type} for agreement ${event.agreementId || "(unknown)"} (buyer ${event.acceptorAccountId || "(unknown)"}).`,
      );
    }
  }

  /*
   * The buyer's license is live (or changed). The purchase is recorded - a
   * buyer who has not reached the fulfillment page yet will find it there -
   * and, once linked to a project, follows the agreement's status.
   */
  private async handleLicenseUpdated(
    event: AwsMarketplaceEvent,
  ): Promise<void> {
    if (!event.licenseArn || !event.agreementId) {
      return;
    }

    if (
      AwsMarketplaceProductCode &&
      event.productCode &&
      event.productCode !== AwsMarketplaceProductCode
    ) {
      return;
    }

    const agreement: AwsAgreement | null = await this.adapter
      .getApi()
      .describeAgreement(event.agreementId);

    const agreementStatus: MarketplaceSubscriptionStatus | null = agreement
      ? AwsAgreementStatus.toStatus(agreement.status)
      : null;

    const purchase: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findPurchase({
        marketplace: CloudMarketplace.AWS,
        externalSubscriptionId: event.licenseArn,
      });

    /*
     * A renewal or upgrade grants a new license under a new agreement. The
     * purchase the old agreement's successor belongs to carries on under the
     * new license (handleAgreementCreated recorded the new agreement on it).
     */
    if (!purchase) {
      const renewed: MarketplaceSubscription | null =
        await MarketplaceSubscriptionService.findPurchaseByEntitlementId({
          marketplace: CloudMarketplace.AWS,
          externalEntitlementId: event.agreementId,
        });

      if (renewed) {
        await MarketplaceSubscriptionService.updateOneById({
          id: renewed.id!,
          data: { externalSubscriptionId: event.licenseArn },
          props: { isRoot: true },
        });
      }
    }

    /*
     * The agreement's status, as AWS has it. A purchase nobody has linked to
     * a project yet stays Pending (MarketplaceSubscriptionService
     * .effectiveStatus) until the buyer reaches the fulfillment page.
     */
    await MarketplacePurchases.recordPurchase({
      marketplace: CloudMarketplace.AWS,
      externalSubscriptionId: event.licenseArn,
      externalEntitlementId: event.agreementId,
      ...(event.acceptorAccountId
        ? { externalCustomerId: event.acceptorAccountId }
        : {}),
      ...(event.offerId ? { externalOfferId: event.offerId } : {}),
      ...(agreement ? { externalState: agreement.status } : {}),
      status: agreementStatus || undefined,
      details: {
        agreementId: event.agreementId,
        offerId: event.offerId,
        productCode: event.productCode,
        licenseUpdatedAt: OneUptimeDate.toString(
          OneUptimeDate.getCurrentDate(),
        ),
      },
    });
  }

  /*
   * A renewal (or a replacement) makes a new agreement that continues an old
   * one. The purchase billed through the old agreement now follows the new
   * one; its new license arrives with the License Updated event.
   */
  private async handleAgreementCreated(
    event: AwsMarketplaceEvent,
  ): Promise<void> {
    if (!event.previousAgreementId || !event.agreementId) {
      return;
    }

    const purchase: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findPurchaseByEntitlementId({
        marketplace: CloudMarketplace.AWS,
        externalEntitlementId: event.previousAgreementId,
      });

    if (!purchase) {
      return;
    }

    await MarketplacePurchases.updatePurchase(purchase, {
      externalEntitlementId: event.agreementId,
    });
  }

  /*
   * The license was deprovisioned, or the agreement ended. Ended means ended
   * only when AWS says so for the agreement: a superseded or renewed one
   * carries on under its successor.
   */
  private async handleEnded(
    event: AwsMarketplaceEvent,
    options: { byLicense: boolean },
  ): Promise<void> {
    const purchase: MarketplaceSubscription | null = options.byLicense
      ? event.licenseArn
        ? await MarketplaceSubscriptionService.findPurchase({
            marketplace: CloudMarketplace.AWS,
            externalSubscriptionId: event.licenseArn,
          })
        : null
      : event.agreementId
        ? await MarketplaceSubscriptionService.findPurchaseByEntitlementId({
            marketplace: CloudMarketplace.AWS,
            externalEntitlementId: event.agreementId,
          })
        : null;

    if (
      !purchase ||
      purchase.status === MarketplaceSubscriptionStatus.Cancelled
    ) {
      return;
    }

    const agreementId: string | null =
      purchase.externalEntitlementId || event.agreementId;

    if (agreementId) {
      const agreement: AwsAgreement | null = await this.adapter
        .getApi()
        .describeAgreement(agreementId);

      if (
        agreement &&
        AwsAgreementStatus.toStatus(agreement.status) !==
          MarketplaceSubscriptionStatus.Cancelled
      ) {
        logger.info(
          `AWS Marketplace ${event.detailType} for ${purchase.id?.toString()}, but agreement ${agreementId} is ${agreement.status}. Nothing changed.`,
        );
        return;
      }
    }

    // AWS takes the last hour's usage for an hour after it deprovisions a license.
    await MarketplaceUsageReporter.reportFinalUsage(purchase);

    await MarketplacePurchases.updatePurchase(purchase, {
      status: MarketplaceSubscriptionStatus.Cancelled,
      externalState: event.detailType,
    });
  }
}
