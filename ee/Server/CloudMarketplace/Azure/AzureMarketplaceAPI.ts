import crypto from "crypto";
import MarketplaceApiError from "../MarketplaceApiError";
import {
  MarketplaceHttp,
  MarketplaceHttpClient,
  MarketplaceHttpMethod,
  MarketplaceHttpResponse,
  defaultMarketplaceHttpClient,
} from "Common/Server/Utils/Marketplace/MarketplaceHttp";

/*
 * Microsoft Marketplace's SaaS fulfillment and metering APIs (version 2,
 * api-version 2018-08-31), called as the single-tenant Microsoft Entra app
 * named in the offer's Technical configuration. The access token is a
 * client-credentials token for the marketplace API's own resource ID.
 *
 * https://learn.microsoft.com/partner-center/marketplace-offers/pc-saas-fulfillment-subscription-api
 * https://learn.microsoft.com/partner-center/marketplace-offers/pc-saas-fulfillment-operations-api
 * https://learn.microsoft.com/partner-center/marketplace-offers/marketplace-metering-service-apis
 */

export const AZURE_MARKETPLACE_API_RESOURCE_ID: string =
  "20e940b3-4c77-4b0b-9a53-9e16a1b010a7";
const API_BASE_URL: string = "https://marketplaceapi.microsoft.com/api";
const API_VERSION: string = "2018-08-31";
const TOKEN_EXPIRY_SLACK_IN_SECONDS: number = 120;

export interface AzureMarketplaceParty {
  emailId: string | null;
  tenantId: string | null;
  objectId: string | null;
}

export interface AzureSaasSubscription {
  id: string;
  name: string | null;
  offerId: string | null;
  planId: string | null;
  quantity: number | null;
  status: string;
  beneficiary: AzureMarketplaceParty;
  purchaser: AzureMarketplaceParty;
  isFreeTrial: boolean;
  isTest: boolean;
  termStartDate: string | null;
  termEndDate: string | null;
  termUnit: string | null;
  autoRenew: boolean | null;
}

export interface AzureOperation {
  id: string;
  subscriptionId: string;
  action: string;
  status: string;
  planId: string | null;
  quantity: number | null;
}

export interface AzureUsageEvent {
  resourceId: string;
  quantity: number;
  dimension: string;
  effectiveStartTime: Date;
  planId: string;
}

// The event Microsoft kept for a subscription, dimension and hour.
export interface AzureAcceptedUsageEvent {
  usageEventId: string | null;
  quantity: number | null;
}

export interface AzureUsageEventResult {
  status: string;
  usageEventId: string | null;
  errorCode: string | null;
  // With Duplicate: the event Microsoft already has for that hour (error.additionalInfo.acceptedMessage).
  acceptedEvent?: AzureAcceptedUsageEvent | undefined;
}

export default class AzureMarketplaceAPI {
  private tenantId: string;
  private clientId: string;
  private clientSecret: string;
  private httpClient: MarketplaceHttpClient;
  private now: () => number;
  private cachedAccessToken: string | null = null;
  private cachedAccessTokenExpiresAtInMs: number = 0;

  public constructor(options: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    httpClient?: MarketplaceHttpClient | undefined;
    now?: (() => number) | undefined;
  }) {
    this.tenantId = options.tenantId;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.httpClient = options.httpClient || defaultMarketplaceHttpClient;
    this.now =
      options.now ||
      ((): number => {
        return Date.now();
      });
  }

  public static parseParty(raw: unknown): AzureMarketplaceParty {
    const party: Record<string, unknown> =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

    const read: (key: string) => string | null = (
      key: string,
    ): string | null => {
      const value: unknown = party[key];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };

    return {
      emailId: read("emailId"),
      tenantId: read("tenantId"),
      objectId: read("objectId"),
    };
  }

  public static parseSubscription(
    raw: Record<string, unknown>,
  ): AzureSaasSubscription | null {
    const id: unknown = raw["id"];

    if (typeof id !== "string" || !id) {
      return null;
    }

    const readString: (key: string) => string | null = (
      key: string,
    ): string | null => {
      const value: unknown = raw[key];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };

    const term: Record<string, unknown> =
      raw["term"] && typeof raw["term"] === "object"
        ? (raw["term"] as Record<string, unknown>)
        : {};

    const readTerm: (key: string) => string | null = (
      key: string,
    ): string | null => {
      const value: unknown = term[key];
      return typeof value === "string" && value ? value : null;
    };

    const quantity: number = Number(raw["quantity"]);

    return {
      id: id,
      name: readString("name") || readString("subscriptionName"),
      offerId: readString("offerId"),
      planId: readString("planId"),
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
      // Microsoft's own examples pad this value with spaces.
      status: readString("saasSubscriptionStatus") || "",
      beneficiary: AzureMarketplaceAPI.parseParty(raw["beneficiary"]),
      purchaser: AzureMarketplaceAPI.parseParty(raw["purchaser"]),
      isFreeTrial: raw["isFreeTrial"] === true,
      isTest: raw["isTest"] === true,
      termStartDate: readTerm("startDate"),
      termEndDate: readTerm("endDate"),
      termUnit: readTerm("termUnit"),
      autoRenew:
        typeof raw["autoRenew"] === "boolean" ? raw["autoRenew"] : null,
    };
  }

  /*
   * The purchase token a buyer's browser brings to the landing page, traded
   * for the SaaS subscription it identifies. The token arrives URL-encoded in
   * the landing page's query string; Express has decoded it already.
   */
  public async resolve(
    marketplaceToken: string,
  ): Promise<AzureSaasSubscription> {
    const body: Record<string, unknown> = await this.call(
      "POST",
      `${API_BASE_URL}/saas/subscriptions/resolve`,
      { "x-ms-marketplace-token": marketplaceToken },
    );

    /*
     * Resolve answers with the subscription's ID, offer, plan and quantity at
     * the top and the full subscription inside; the inner one is the same
     * subscription with more detail.
     */
    const inner: Record<string, unknown> =
      body["subscription"] && typeof body["subscription"] === "object"
        ? (body["subscription"] as Record<string, unknown>)
        : {};

    const subscription: AzureSaasSubscription | null =
      AzureMarketplaceAPI.parseSubscription({
        ...inner,
        id: body["id"] ?? inner["id"],
        offerId: body["offerId"] ?? inner["offerId"],
        planId: body["planId"] ?? inner["planId"],
        quantity: body["quantity"] ?? inner["quantity"],
        subscriptionName: body["subscriptionName"],
      });

    if (!subscription) {
      throw new MarketplaceApiError({
        message: "Resolve returned no subscription ID.",
        status: 200,
        isRetryable: false,
      });
    }

    return subscription;
  }

  public async getSubscription(
    subscriptionId: string,
  ): Promise<AzureSaasSubscription | null> {
    let body: Record<string, unknown>;

    try {
      body = await this.call(
        "GET",
        `${API_BASE_URL}/saas/subscriptions/${encodeURIComponent(subscriptionId)}`,
      );
    } catch (err) {
      if (err instanceof MarketplaceApiError && err.isNotFound()) {
        return null;
      }

      throw err;
    }

    return AzureMarketplaceAPI.parseSubscription(body);
  }

  /*
   * Billing starts only when this succeeds: the buyer has an account and the
   * subscription is set up. Microsoft answers 200 with no body.
   */
  public async activate(data: {
    subscriptionId: string;
    planId: string | null;
    quantity: number | null;
  }): Promise<void> {
    await this.call(
      "POST",
      `${API_BASE_URL}/saas/subscriptions/${encodeURIComponent(data.subscriptionId)}/activate`,
      undefined,
      {
        ...(data.planId ? { planId: data.planId } : {}),
        ...(data.quantity ? { quantity: data.quantity } : {}),
      },
    );
  }

  public async getOperation(
    subscriptionId: string,
    operationId: string,
  ): Promise<AzureOperation | null> {
    let body: Record<string, unknown>;

    try {
      body = await this.call(
        "GET",
        `${API_BASE_URL}/saas/subscriptions/${encodeURIComponent(subscriptionId)}/operations/${encodeURIComponent(operationId)}`,
      );
    } catch (err) {
      if (err instanceof MarketplaceApiError && err.isNotFound()) {
        return null;
      }

      throw err;
    }

    // Microsoft's own example has the key as "id  "; read whichever is there.
    const idKey: string | undefined = Object.keys(body).find(
      (key: string): boolean => {
        return key.trim() === "id";
      },
    );
    const quantity: number = Number(body["quantity"]);

    return {
      id: idKey ? String(body[idKey]) : operationId,
      subscriptionId:
        typeof body["subscriptionId"] === "string"
          ? body["subscriptionId"]
          : subscriptionId,
      action: typeof body["action"] === "string" ? body["action"] : "",
      status: typeof body["status"] === "string" ? body["status"] : "",
      planId: typeof body["planId"] === "string" ? body["planId"] : null,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
    };
  }

  // Accept (Success) or refuse (Failure) a plan change, quantity change or reinstatement.
  public async updateOperation(data: {
    subscriptionId: string;
    operationId: string;
    status: "Success" | "Failure";
  }): Promise<void> {
    await this.call(
      "PATCH",
      `${API_BASE_URL}/saas/subscriptions/${encodeURIComponent(data.subscriptionId)}/operations/${encodeURIComponent(data.operationId)}`,
      undefined,
      { status: data.status },
    );
  }

  /*
   * Usage events, at most 25 per call. Each comes back with its own status
   * (Accepted, Duplicate, Expired, ResourceNotActive, ...): a 200 does not
   * mean every event was taken.
   */
  public async reportUsageEvents(
    events: Array<AzureUsageEvent>,
  ): Promise<Array<AzureUsageEventResult>> {
    const body: Record<string, unknown> = await this.call(
      "POST",
      `${API_BASE_URL}/batchUsageEvent`,
      undefined,
      {
        request: events.map((event: AzureUsageEvent) => {
          return {
            resourceId: event.resourceId,
            quantity: event.quantity,
            dimension: event.dimension,
            effectiveStartTime: AzureMarketplaceAPI.toUsageTime(
              event.effectiveStartTime,
            ),
            planId: event.planId,
          };
        }),
      },
    );

    const results: Array<AzureUsageEventResult> = [];
    const rawResults: unknown = body["result"];

    if (Array.isArray(rawResults)) {
      for (const raw of rawResults) {
        if (!raw || typeof raw !== "object") {
          continue;
        }

        const result: Record<string, unknown> = raw as Record<string, unknown>;
        const error: Record<string, unknown> | null =
          result["error"] && typeof result["error"] === "object"
            ? (result["error"] as Record<string, unknown>)
            : null;
        const additionalInfo: unknown = error?.["additionalInfo"];
        const acceptedMessage: unknown =
          additionalInfo && typeof additionalInfo === "object"
            ? (additionalInfo as Record<string, unknown>)["acceptedMessage"]
            : null;

        results.push({
          status: typeof result["status"] === "string" ? result["status"] : "",
          usageEventId:
            typeof result["usageEventId"] === "string"
              ? result["usageEventId"]
              : null,
          errorCode: typeof error?.["code"] === "string" ? error["code"] : null,
          ...(acceptedMessage && typeof acceptedMessage === "object"
            ? {
                acceptedEvent: AzureMarketplaceAPI.readAcceptedEvent(
                  acceptedMessage as Record<string, unknown>,
                ),
              }
            : {}),
        });
      }
    }

    return results;
  }

  private static readAcceptedEvent(
    message: Record<string, unknown>,
  ): AzureAcceptedUsageEvent {
    const quantity: number = Number(message["quantity"]);

    return {
      usageEventId:
        typeof message["usageEventId"] === "string"
          ? message["usageEventId"]
          : null,
      quantity:
        message["quantity"] !== null &&
        message["quantity"] !== undefined &&
        Number.isFinite(quantity)
          ? quantity
          : null,
    };
  }

  // Microsoft's examples write the time without milliseconds: 2018-12-01T08:00:00.
  public static toUsageTime(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  private async call(
    method: MarketplaceHttpMethod,
    url: string,
    extraHeaders?: Record<string, string> | undefined,
    body?: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown>> {
    const accessToken: string = await this.getAccessToken();
    const separator: string = url.includes("?") ? "&" : "?";

    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: method,
        url: `${url}${separator}api-version=${API_VERSION}`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          // Lets Microsoft support find this call in their logs.
          "x-ms-requestid": crypto.randomUUID(),
          ...(extraHeaders || {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new MarketplaceApiError({
        message: `Microsoft Marketplace API request failed (${method} ${url}): ${(err as Error).message}`,
        status: null,
        isRetryable: true,
      });
    }

    if (!MarketplaceHttp.isSuccess(response.status)) {
      throw new MarketplaceApiError({
        message: `Microsoft Marketplace API request failed (${method} ${url}, HTTP ${response.status}): ${MarketplaceHttp.summarize(response.body)}`,
        status: response.status,
        isRetryable: MarketplaceHttp.isRetryable(response.status),
        body: response.body,
      });
    }

    return MarketplaceHttp.parseJsonObject(response.body) || {};
  }

  private async getAccessToken(): Promise<string> {
    const nowInMs: number = this.now();

    if (
      this.cachedAccessToken &&
      nowInMs <
        this.cachedAccessTokenExpiresAtInMs -
          TOKEN_EXPIRY_SLACK_IN_SECONDS * 1000
    ) {
      return this.cachedAccessToken;
    }

    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: "POST",
        url: `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: `${AZURE_MARKETPLACE_API_RESOURCE_ID}/.default`,
        }).toString(),
      });
    } catch (err) {
      throw new MarketplaceApiError({
        message: `Could not get a Microsoft Entra access token: ${(err as Error).message}`,
        status: null,
        isRetryable: true,
      });
    }

    const body: Record<string, unknown> | null =
      MarketplaceHttp.parseJsonObject(response.body);
    const accessToken: unknown = body?.["access_token"];

    if (!MarketplaceHttp.isSuccess(response.status) || !accessToken) {
      throw new MarketplaceApiError({
        message: `Could not get a Microsoft Entra access token (HTTP ${response.status}): ${String(body?.["error"] || "")} ${String(body?.["error_description"] || "").substring(0, 200)}`,
        status: response.status,
        isRetryable: MarketplaceHttp.isRetryable(response.status),
      });
    }

    const expiresIn: number = Number(body?.["expires_in"]) || 3600;

    this.cachedAccessToken = String(accessToken);
    this.cachedAccessTokenExpiresAtInMs = nowInMs + expiresIn * 1000;

    return this.cachedAccessToken;
  }
}
