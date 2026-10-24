import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import {
  AzureMarketplaceClientId,
  AzureMarketplaceTenantId,
} from "Common/Server/EnvironmentConfig";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import logger from "Common/Server/Utils/Logger";
import MarketplaceUsageReporter from "../MarketplaceUsageReporter";
import RemoteJwtVerifier from "Common/Server/Utils/Marketplace/RemoteJwtVerifier";
import AzureMarketplaceAdapter, {
  AzureSubscriptionStatus,
} from "./AzureMarketplaceAdapter";
import AzureMarketplaceAPI, {
  AZURE_MARKETPLACE_API_RESOURCE_ID,
  AzureOperation,
  AzureSaasSubscription,
} from "./AzureMarketplaceAPI";
import MarketplacePurchases from "../MarketplacePurchases";

/*
 * What Microsoft Marketplace sends OneUptime:
 *
 *   - the buyer, sent by their browser to the landing page with a purchase
 *     token in the query string (?token=), after buying and whenever they
 *     choose Configure account / Manage account later;
 *   - webhook calls (the offer's Connection webhook) for every change to a
 *     subscription - Subscribe (auto activation), ChangePlan, ChangeQuantity,
 *     Renew, Suspend, Unsubscribe, Reinstate - each with a Microsoft Entra
 *     bearer token.
 *
 * A webhook is acted on only after its bearer token checks out - issued for
 * the offer's Entra app, in the offer's tenant, to the marketplace API's own
 * app - and after reading the operation and the subscription back from the
 * fulfillment API, as Microsoft requires: what OneUptime records is what
 * Microsoft's API says, never what the payload says.
 *
 * https://learn.microsoft.com/partner-center/marketplace-offers/pc-saas-fulfillment-webhook
 */

// Actions Microsoft waits for the publisher to accept (or refuse) through the operations API.
const ACTIONS_NEEDING_ACKNOWLEDGEMENT: Array<string> = [
  "ChangePlan",
  "ChangeQuantity",
  "Reinstate",
];

export interface AzureWebhookCall {
  operationId: string;
  subscriptionId: string;
  action: string;
  status: string;
}

export class AzureInboundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AzureInboundError";
  }
}

export default class AzureMarketplaceInbound {
  private verifier: RemoteJwtVerifier;
  private adapter: AzureMarketplaceAdapter;

  public constructor(options?: {
    verifier?: RemoteJwtVerifier | undefined;
    adapter?: AzureMarketplaceAdapter | undefined;
  }) {
    this.verifier = options?.verifier || new RemoteJwtVerifier();
    this.adapter = options?.adapter || new AzureMarketplaceAdapter();
  }

  /*
   * The landing page's purchase token, resolved to the subscription it
   * identifies, which is recorded (Pending, unless Microsoft has activated it
   * already). The token is good for 24 hours; Microsoft's API says when it is
   * not, and the landing page then tells the buyer what Microsoft says to.
   */
  public async resolveLandingToken(
    token: string,
  ): Promise<MarketplaceSubscription> {
    const subscription: AzureSaasSubscription = await this.adapter
      .getApi()
      .resolve(token);

    return await MarketplacePurchases.recordPurchase({
      marketplace: CloudMarketplace.Azure,
      externalSubscriptionId: subscription.id,
      status:
        AzureSubscriptionStatus.toStatus(subscription.status) || undefined,
      ...AzureSubscriptionStatus.toFacts(subscription),
    });
  }

  /*
   * The webhook's bearer token, checked the way Microsoft documents: a token
   * issued by the offer's tenant, for the offer's Entra app (aud), to the
   * marketplace API's app (appid in a v1 token, azp in a v2 one).
   */
  public async verifyWebhookToken(data: {
    authorizationHeader: string | undefined;
    tenantId?: string | null | undefined;
    clientId?: string | null | undefined;
  }): Promise<void> {
    const tenantId: string | null =
      data.tenantId !== undefined ? data.tenantId : AzureMarketplaceTenantId;
    const clientId: string | null =
      data.clientId !== undefined ? data.clientId : AzureMarketplaceClientId;

    if (!tenantId || !clientId) {
      throw new AzureInboundError("Microsoft Marketplace is not configured.");
    }

    const header: string = data.authorizationHeader || "";

    if (!header.startsWith("Bearer ")) {
      throw new AzureInboundError("The webhook call carries no bearer token.");
    }

    const claims: Record<string, unknown> = await this.verifier.verify(
      header.substring("Bearer ".length).trim(),
      {
        keySource: {
          kind: "jwks",
          url: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/discovery/v2.0/keys`,
        },
        audience: [clientId, `api://${clientId}`],
        issuer: [
          `https://sts.windows.net/${tenantId}/`,
          `https://login.microsoftonline.com/${tenantId}/v2.0`,
        ],
      },
    );

    if (claims["tid"] !== tenantId) {
      throw new AzureInboundError("The webhook token is for another tenant.");
    }

    const caller: unknown = claims["appid"] ?? claims["azp"];

    if (caller !== AZURE_MARKETPLACE_API_RESOURCE_ID) {
      throw new AzureInboundError(
        "The webhook token was not issued to Microsoft Marketplace.",
      );
    }
  }

  // The webhook payload, read defensively; Microsoft may add fields at any time.
  public static parseWebhookBody(body: unknown): AzureWebhookCall | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    const payload: Record<string, unknown> = body as Record<string, unknown>;

    const operationId: unknown = payload["id"];
    const subscriptionId: unknown = payload["subscriptionId"];
    const action: unknown = payload["action"];

    if (
      typeof operationId !== "string" ||
      !operationId ||
      typeof subscriptionId !== "string" ||
      !subscriptionId ||
      typeof action !== "string" ||
      !action
    ) {
      return null;
    }

    return {
      operationId: operationId,
      subscriptionId: subscriptionId,
      action: action,
      status: typeof payload["status"] === "string" ? payload["status"] : "",
    };
  }

  /*
   * Act on one webhook call. Plan and quantity changes - and reinstatement
   * after a suspension - are accepted: every plan bills the same usage units
   * at the same prices, so OneUptime has nothing to refuse.
   */
  public async handleWebhook(call: AzureWebhookCall): Promise<void> {
    const api: AzureMarketplaceAPI = this.adapter.getApi();

    // Required by Microsoft: confirm the operation exists as described before acting on it.
    const operation: AzureOperation | null = await api.getOperation(
      call.subscriptionId,
      call.operationId,
    );

    if (operation && operation.action && operation.action !== call.action) {
      throw new AzureInboundError(
        "The webhook describes an operation Microsoft does not have.",
      );
    }

    let acknowledged: boolean = false;

    if (
      ACTIONS_NEEDING_ACKNOWLEDGEMENT.includes(call.action) &&
      operation?.status === "InProgress"
    ) {
      await api.updateOperation({
        subscriptionId: call.subscriptionId,
        operationId: call.operationId,
        status: "Success",
      });
      acknowledged = true;
    }

    const subscription: AzureSaasSubscription | null =
      await api.getSubscription(call.subscriptionId);

    if (!subscription) {
      logger.warn(
        `Microsoft Marketplace ${call.action} for subscription ${call.subscriptionId}, which Microsoft does not have.`,
      );
      return;
    }

    let status: MarketplaceSubscriptionStatus | null =
      AzureSubscriptionStatus.toStatus(subscription.status);

    // Accepting a reinstatement is what reinstates it; the read may not show it yet.
    if (call.action === "Reinstate" && acknowledged) {
      status = MarketplaceSubscriptionStatus.Active;
    }

    if (status === MarketplaceSubscriptionStatus.Cancelled) {
      const purchase: MarketplaceSubscription | null =
        await MarketplaceSubscriptionService.findPurchase({
          marketplace: CloudMarketplace.Azure,
          externalSubscriptionId: subscription.id,
        });

      if (
        purchase &&
        purchase.status !== MarketplaceSubscriptionStatus.Cancelled
      ) {
        // Bill what was used up to the cancellation, before it stops being billable.
        await MarketplaceUsageReporter.reportFinalUsage(purchase);
      }
    }

    /*
     * A subscription Microsoft activated at purchase (auto activation) stays
     * Pending in OneUptime until the buyer has linked a project on the
     * landing page (MarketplacePurchases.effectiveStatus).
     */
    await MarketplacePurchases.recordPurchase({
      marketplace: CloudMarketplace.Azure,
      externalSubscriptionId: subscription.id,
      status: status || undefined,
      ...AzureSubscriptionStatus.toFacts(subscription),
      ...(operation?.planId && call.action === "ChangePlan" && acknowledged
        ? { externalPlanId: operation.planId }
        : {}),
      ...(operation?.quantity &&
      call.action === "ChangeQuantity" &&
      acknowledged
        ? { quantity: operation.quantity }
        : {}),
    });

    logger.info(
      `Microsoft Marketplace ${call.action} (${call.status}) for subscription ${subscription.id}: now ${subscription.status}.`,
    );
  }
}
