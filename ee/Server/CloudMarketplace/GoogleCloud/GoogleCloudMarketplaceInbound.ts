import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import { GoogleCloudMarketplaceProviderId } from "Common/Server/EnvironmentConfig";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import logger from "Common/Server/Utils/Logger";
import MarketplaceConfig from "../MarketplaceConfig";
import MarketplaceUsageReporter from "../MarketplaceUsageReporter";
import RemoteJwtVerifier from "Common/Server/Utils/Marketplace/RemoteJwtVerifier";
import GoogleCloudMarketplaceAdapter, {
  GoogleCloudEntitlementState,
} from "./GoogleCloudMarketplaceAdapter";
import GoogleCloudMarketplaceAPI, {
  GoogleCloudEntitlement,
} from "./GoogleCloudMarketplaceAPI";
import MarketplacePurchases from "../MarketplacePurchases";

/*
 * What Google Cloud Marketplace sends OneUptime:
 *
 *   - the buyer, POSTed to the sign-up URL with a JWT signed by Google
 *     (x-gcp-marketplace-token) naming their procurement account;
 *   - Pub/Sub messages about accounts and entitlements, pushed to
 *     /api/marketplace/google-cloud/events by a push subscription that signs
 *     each delivery with an OIDC token for its service account.
 *
 * Messages are only a nudge: each one is acted on by reading the entitlement
 * from the Procurement API, never by trusting the message's own fields - so
 * a replayed or reordered delivery cannot move a purchase anywhere Google
 * does not have it now.
 *
 * https://docs.cloud.google.com/marketplace/docs/partners/integrated-saas/frontend-integration
 * https://docs.cloud.google.com/marketplace/docs/partners/integrated-saas/manage-entitlements
 * https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions
 */

export const GOOGLE_CLOUD_SIGNUP_TOKEN_ISSUER: string =
  "https://www.googleapis.com/robot/v1/metadata/x509/cloud-commerce-partner@system.gserviceaccount.com";
const GOOGLE_OIDC_JWKS_URL: string =
  "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_OIDC_ISSUERS: Array<string> = [
  "https://accounts.google.com",
  "accounts.google.com",
];

export interface GoogleCloudSignup {
  accountId: string;
}

export interface GoogleCloudMarketplaceEvent {
  eventId: string;
  eventType: string;
  providerId: string;
  entitlementId: string | null;
  accountId: string | null;
}

export class GoogleCloudInboundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GoogleCloudInboundError";
  }
}

export default class GoogleCloudMarketplaceInbound {
  private verifier: RemoteJwtVerifier;
  private adapter: GoogleCloudMarketplaceAdapter;

  public constructor(options?: {
    verifier?: RemoteJwtVerifier | undefined;
    adapter?: GoogleCloudMarketplaceAdapter | undefined;
  }) {
    this.verifier = options?.verifier || new RemoteJwtVerifier();
    this.adapter = options?.adapter || new GoogleCloudMarketplaceAdapter();
  }

  /*
   * The buyer's token, checked the way Google says to: signed (RS256) by one
   * of the certificates at the issuer URL, issued by that URL, for this
   * product's domain, unexpired, and naming an account ("sub").
   */
  public async verifySignupToken(
    token: string,
    audience: string = MarketplaceConfig.getGoogleCloudSignupAudience(),
  ): Promise<GoogleCloudSignup> {
    const claims: Record<string, unknown> = await this.verifier.verify(token, {
      keySource: { kind: "x509", url: GOOGLE_CLOUD_SIGNUP_TOKEN_ISSUER },
      issuer: GOOGLE_CLOUD_SIGNUP_TOKEN_ISSUER,
      audience: audience,
    });

    const accountId: unknown = claims["sub"];

    if (typeof accountId !== "string" || !accountId.trim()) {
      throw new GoogleCloudInboundError(
        "The Google Cloud Marketplace token names no account.",
      );
    }

    return { accountId: accountId.trim() };
  }

  /*
   * A push delivery is genuine when its bearer token was signed by Google
   * for this endpoint (the audience), for the service account the push
   * subscription was created with, whose email Google has verified.
   */
  public async verifyPushToken(data: {
    authorizationHeader: string | undefined;
    audience: string;
    serviceAccountEmail: string;
  }): Promise<void> {
    const header: string = data.authorizationHeader || "";

    if (!header.startsWith("Bearer ")) {
      throw new GoogleCloudInboundError("The push delivery is not signed.");
    }

    const claims: Record<string, unknown> = await this.verifier.verify(
      header.substring("Bearer ".length).trim(),
      {
        keySource: { kind: "jwks", url: GOOGLE_OIDC_JWKS_URL },
        issuer: GOOGLE_OIDC_ISSUERS,
        audience: data.audience,
      },
    );

    if (
      claims["email"] !== data.serviceAccountEmail ||
      claims["email_verified"] !== true
    ) {
      throw new GoogleCloudInboundError(
        "The push delivery is signed for another service account.",
      );
    }
  }

  /*
   * The Pub/Sub push envelope ({ message: { data: base64(JSON) } }) to the
   * marketplace event inside it. Null for anything that is not one.
   */
  public static parsePushBody(
    body: unknown,
  ): GoogleCloudMarketplaceEvent | null {
    if (!body || typeof body !== "object") {
      return null;
    }

    const message: unknown = (body as Record<string, unknown>)["message"];

    if (!message || typeof message !== "object") {
      return null;
    }

    const data: unknown = (message as Record<string, unknown>)["data"];

    if (typeof data !== "string" || !data) {
      return null;
    }

    let event: Record<string, unknown>;

    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(data, "base64").toString("utf8"),
      );

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }

      event = parsed as Record<string, unknown>;
    } catch {
      return null;
    }

    const readId: (key: string) => string | null = (
      key: string,
    ): string | null => {
      const value: unknown = event[key];

      if (!value || typeof value !== "object") {
        return null;
      }

      const id: unknown = (value as Record<string, unknown>)["id"];
      return typeof id === "string" && id ? id : null;
    };

    return {
      eventId: typeof event["eventId"] === "string" ? event["eventId"] : "",
      eventType:
        typeof event["eventType"] === "string" ? event["eventType"] : "",
      providerId:
        typeof event["providerId"] === "string" ? event["providerId"] : "",
      entitlementId: readId("entitlement"),
      accountId: readId("account"),
    };
  }

  /*
   * Act on one event. Throws only for a failure worth Pub/Sub delivering the
   * message again (the Procurement API unreachable); everything it cannot or
   * need not act on is logged and acknowledged.
   */
  public async handleEvent(event: GoogleCloudMarketplaceEvent): Promise<void> {
    if (
      GoogleCloudMarketplaceProviderId &&
      event.providerId &&
      event.providerId !== GoogleCloudMarketplaceProviderId
    ) {
      logger.warn(
        `Google Cloud Marketplace event ${event.eventId} is for provider ${event.providerId}, not this one. Ignored.`,
      );
      return;
    }

    if (event.eventType === "ACCOUNT_DELETED" && event.accountId) {
      await this.handleAccountDeleted(event.accountId);
      return;
    }

    if (!event.eventType.startsWith("ENTITLEMENT_") || !event.entitlementId) {
      // ACCOUNT_ACTIVE and anything newer: nothing to do until an entitlement moves.
      return;
    }

    const api: GoogleCloudMarketplaceAPI = this.adapter.getApi();
    const entitlement: GoogleCloudEntitlement | null = await api.getEntitlement(
      event.entitlementId,
    );

    if (!entitlement) {
      // ENTITLEMENT_DELETED: Google has removed it. The purchase that billed it has ended.
      await this.handleEntitlementGone(event.entitlementId);
      return;
    }

    let purchase: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findPurchase({
        marketplace: CloudMarketplace.GoogleCloud,
        externalSubscriptionId: entitlement.accountId,
      });

    if (
      event.eventType === "ENTITLEMENT_CREATION_REQUESTED" &&
      entitlement.state === "ENTITLEMENT_ACTIVATION_REQUESTED"
    ) {
      /*
       * Approved now only for a buyer who has already signed up and linked a
       * project; anyone else's order waits for the purchase page, which
       * approves it when they finish setting up.
       */
      if (purchase?.projectId) {
        await this.adapter.approveEntitlement(entitlement.id);
        entitlement.state = "ENTITLEMENT_ACTIVE";
      }
    }

    if (
      event.eventType === "ENTITLEMENT_PLAN_CHANGE_REQUESTED" &&
      entitlement.state === "ENTITLEMENT_PENDING_PLAN_CHANGE_APPROVAL" &&
      entitlement.newPendingPlan
    ) {
      /*
       * Every plan bills the same usage units at the same prices, so a plan
       * change needs nothing from OneUptime and is approved as asked.
       */
      await api.approvePlanChange(entitlement.id, entitlement.newPendingPlan);
    }

    // The entitlement this account is billed through, now.
    if (
      purchase?.externalEntitlementId &&
      purchase.externalEntitlementId !== entitlement.id &&
      !GoogleCloudEntitlementState.isInForce(entitlement.state)
    ) {
      // An old order of the account moved; the one in force is unaffected.
      return;
    }

    const status: MarketplaceSubscriptionStatus | null =
      GoogleCloudEntitlementState.toStatus(entitlement.state);

    if (
      purchase &&
      status === MarketplaceSubscriptionStatus.Cancelled &&
      purchase.status !== MarketplaceSubscriptionStatus.Cancelled
    ) {
      // Bill what was used up to the cancellation, before it stops being billable.
      await MarketplaceUsageReporter.reportFinalUsage(purchase);
    }

    purchase = await MarketplacePurchases.recordPurchase({
      marketplace: CloudMarketplace.GoogleCloud,
      externalSubscriptionId: entitlement.accountId,
      status: status || undefined,
      ...GoogleCloudEntitlementState.toFacts(entitlement),
    });

    logger.info(
      `Google Cloud Marketplace ${event.eventType} for account ${entitlement.accountId}: entitlement ${entitlement.id} is ${entitlement.state}.`,
    );
  }

  private async handleEntitlementGone(entitlementId: string): Promise<void> {
    const purchase: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findPurchaseByEntitlementId({
        marketplace: CloudMarketplace.GoogleCloud,
        externalEntitlementId: entitlementId,
      });

    if (!purchase) {
      return;
    }

    await this.endPurchase(purchase, "ENTITLEMENT_DELETED");
  }

  /*
   * Google has deleted the buyer's account. The purchase ends; the project
   * and its data are left alone - deleting a customer's monitoring is never
   * something a marketplace notification does on its own.
   */
  private async handleAccountDeleted(accountId: string): Promise<void> {
    const purchase: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findPurchase({
        marketplace: CloudMarketplace.GoogleCloud,
        externalSubscriptionId: accountId,
      });

    if (!purchase) {
      return;
    }

    await this.endPurchase(purchase, "ACCOUNT_DELETED");
  }

  private async endPurchase(
    purchase: MarketplaceSubscription,
    externalState: string,
  ): Promise<void> {
    if (purchase.status !== MarketplaceSubscriptionStatus.Cancelled) {
      await MarketplaceUsageReporter.reportFinalUsage(purchase);
    }

    await MarketplacePurchases.updatePurchase(purchase, {
      status: MarketplaceSubscriptionStatus.Cancelled,
      externalState: externalState,
    });
  }
}
