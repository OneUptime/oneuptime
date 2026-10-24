import crypto from "crypto";
import MarketplaceApiError from "../../CloudMarketplace/MarketplaceApiError";
import {
  MarketplaceHttp,
  MarketplaceHttpClient,
  MarketplaceHttpResponse,
  defaultMarketplaceHttpClient,
} from "Common/Server/Utils/Marketplace/MarketplaceHttp";

/*
 * The Microsoft Marketplace metering service as a self-hosted OneUptime
 * calls it from the buyer's AKS cluster - the Kubernetes application offer
 * with a custom meter. Microsoft cannot meter users itself (its own Kubernetes
 * meters count cores, nodes, pods or clusters), so the application reports
 * them, as usage events against the ARM resource of its own cluster
 * extension:
 *
 *   - authentication: a token for the metering service's application
 *     (20e940b3-4c77-4b0b-9a53-9e16a1b010a7) from the instance metadata
 *     service on the node, for the managed identity Azure gives the
 *     extension (global.azure.identity.clientId);
 *   - one event per resource, dimension and hour, at most 24 hours old.
 *     Microsoft keeps the first event of an hour and answers any later one
 *     "Duplicate" with the event it kept.
 *
 * Events go through the batch endpoint, one at a time: its answer carries a
 * status for the event (Accepted, Duplicate, Expired, ResourceNotActive...),
 * where the single-event endpoint answers some of the same cases with bare
 * HTTP errors.
 *
 * https://learn.microsoft.com/en-us/partner-center/marketplace-offers/azure-container-metered-billing
 * https://learn.microsoft.com/en-us/partner-center/marketplace-offers/marketplace-metering-service-authentication
 */

export const AZURE_MARKETPLACE_METERING_RESOURCE: string =
  "20e940b3-4c77-4b0b-9a53-9e16a1b010a7";

const IMDS_TOKEN_URL: string =
  "http://169.254.169.254/metadata/identity/oauth2/token";
const IMDS_API_VERSION: string = "2018-02-01";
const BATCH_USAGE_EVENT_URL: string =
  "https://marketplaceapi.microsoft.com/api/batchUsageEvent?api-version=2018-08-31";

// How long before it expires a cached token is replaced.
const TOKEN_REFRESH_BEFORE_EXPIRY_IN_MS: number = 5 * 60 * 1000;

export interface AzureUsageEvent {
  // The ARM resource ID of the Kubernetes application (its cluster extension).
  resourceUri: string;
  planId: string;
  dimension: string;
  // More than 0.
  quantity: number;
  // The hour the usage is for.
  effectiveStartTime: Date;
}

/*
 * What Microsoft made of one event. `status` is Microsoft's own word for it:
 * Accepted, Duplicate, Expired, Error, ResourceNotFound,
 * ResourceNotAuthorized, ResourceNotActive, InvalidDimension,
 * InvalidQuantity or BadArgument.
 */
export interface AzureUsageEventResult {
  status: string;
  usageEventId: string | null;
  // For Duplicate: the quantity of the event Microsoft kept for that hour.
  keptQuantity: number | null;
  message: string;
}

// Statuses that mean the resource cannot be billed: not (or no longer) bought.
export const AZURE_NOT_ENTITLED_STATUSES: ReadonlyArray<string> = [
  "ResourceNotActive",
  "ResourceNotFound",
];

/*
 * Statuses that mean the installation reports something Microsoft cannot
 * take from it - the wrong identity, plan or dimension - which an operator
 * must fix.
 */
export const AZURE_SETUP_STATUSES: ReadonlyArray<string> = [
  "ResourceNotAuthorized",
  "InvalidDimension",
  "InvalidQuantity",
  "BadArgument",
];

export default class AzureKubernetesAppMeteringAPI {
  private clientId: string;
  private httpClient: MarketplaceHttpClient;
  private now: () => Date;
  private newRequestId: () => string;
  private cachedToken: string | null = null;
  private cachedTokenExpiresAtInMs: number = 0;

  public constructor(options: {
    // The client ID of the extension's managed identity.
    clientId: string;
    httpClient?: MarketplaceHttpClient | undefined;
    now?: (() => Date) | undefined;
    newRequestId?: (() => string) | undefined;
  }) {
    this.clientId = options.clientId.trim();
    this.httpClient = options.httpClient || defaultMarketplaceHttpClient;
    this.now =
      options.now ||
      ((): Date => {
        return new Date();
      });
    this.newRequestId =
      options.newRequestId ||
      ((): string => {
        return crypto.randomUUID();
      });
  }

  /*
   * Sends one usage event and returns what Microsoft made of it. Throws
   * MarketplaceApiError when there was no answer about the event at all (no
   * token, throttling, an outage, a malformed answer).
   */
  public async emitUsageEvent(
    event: AzureUsageEvent,
  ): Promise<AzureUsageEventResult> {
    AzureKubernetesAppMeteringAPI.validateEvent(event);

    const token: string = await this.getAccessToken();
    const requestId: string = this.newRequestId();

    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: "POST",
        url: BATCH_USAGE_EVENT_URL,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-ms-requestid": requestId,
          "x-ms-correlationid": requestId,
        },
        body: JSON.stringify({
          request: [
            {
              resourceUri: event.resourceUri,
              planId: event.planId,
              dimension: event.dimension,
              quantity: event.quantity,
              effectiveStartTime: event.effectiveStartTime.toISOString(),
            },
          ],
        }),
      });
    } catch (err) {
      throw new MarketplaceApiError({
        message: `Microsoft Marketplace usage event request failed: ${(err as Error).message}`,
        status: null,
        isRetryable: true,
      });
    }

    if (response.status === 401 || response.status === 403) {
      // The cached token is no good; the next attempt asks for a new one.
      this.cachedToken = null;

      throw new MarketplaceApiError({
        message: `Microsoft Marketplace refused the token for the extension's managed identity (HTTP ${response.status}): ${MarketplaceHttp.summarize(response.body)}`,
        status: response.status,
        isRetryable: true,
        code: "Forbidden",
      });
    }

    if (!MarketplaceHttp.isSuccess(response.status)) {
      throw new MarketplaceApiError({
        message: `Microsoft Marketplace usage event failed (HTTP ${response.status}): ${MarketplaceHttp.summarize(response.body)}`,
        status: response.status,
        isRetryable: MarketplaceHttp.isRetryable(response.status),
        body: response.body,
      });
    }

    const result: AzureUsageEventResult | null =
      AzureKubernetesAppMeteringAPI.readBatchResult(response.body);

    if (!result) {
      throw new MarketplaceApiError({
        message: `Microsoft Marketplace answered the usage event without a result: ${MarketplaceHttp.summarize(response.body)}`,
        status: response.status,
        isRetryable: true,
      });
    }

    return result;
  }

  /*
   * A token for the metering service, from the instance metadata service,
   * for the extension's managed identity. Cached until five minutes before it
   * expires.
   */
  public async getAccessToken(): Promise<string> {
    const nowInMs: number = this.now().getTime();

    if (
      this.cachedToken &&
      nowInMs <
        this.cachedTokenExpiresAtInMs - TOKEN_REFRESH_BEFORE_EXPIRY_IN_MS
    ) {
      return this.cachedToken;
    }

    if (!this.clientId) {
      throw new MarketplaceApiError({
        message:
          "The client ID of the extension's managed identity is missing (global.azure.identity.clientId), so OneUptime cannot sign in to the Microsoft Marketplace metering service.",
        status: null,
        isRetryable: false,
      });
    }

    const url: string = `${IMDS_TOKEN_URL}?${new URLSearchParams({
      "api-version": IMDS_API_VERSION,
      client_id: this.clientId,
      resource: AZURE_MARKETPLACE_METERING_RESOURCE,
    }).toString()}`;

    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: "GET",
        url: url,
        headers: { Metadata: "true" },
        timeoutInMs: 10_000,
      });
    } catch (err) {
      throw new MarketplaceApiError({
        message: `The Azure instance metadata service did not answer (is this running on AKS?): ${(err as Error).message}`,
        status: null,
        isRetryable: true,
      });
    }

    const body: Record<string, unknown> | null =
      MarketplaceHttp.parseJsonObject(response.body);

    if (!MarketplaceHttp.isSuccess(response.status)) {
      throw new MarketplaceApiError({
        message: `The Azure instance metadata service gave no token for the extension's managed identity (HTTP ${response.status}): ${MarketplaceHttp.summarize(response.body)}`,
        status: response.status,
        // 400 is IMDS's "no such identity on this node": a setup problem.
        isRetryable: MarketplaceHttp.isRetryable(response.status),
      });
    }

    const accessToken: unknown = body?.["access_token"];

    if (typeof accessToken !== "string" || !accessToken) {
      throw new MarketplaceApiError({
        message:
          "The Azure instance metadata service answered without an access token.",
        status: response.status,
        isRetryable: true,
      });
    }

    this.cachedToken = accessToken;
    this.cachedTokenExpiresAtInMs =
      AzureKubernetesAppMeteringAPI.readTokenExpiry(body, nowInMs);

    return accessToken;
  }

  public static isNotEntitledStatus(status: string): boolean {
    return AZURE_NOT_ENTITLED_STATUSES.includes(status);
  }

  public static isSetupStatus(status: string): boolean {
    return AZURE_SETUP_STATUSES.includes(status);
  }

  public static validateEvent(event: AzureUsageEvent): void {
    const problems: Array<string> = [];

    if (
      !event.resourceUri ||
      !event.resourceUri.startsWith("/subscriptions/")
    ) {
      problems.push(
        "the resource URI must be the ARM ID of the Kubernetes application (global.azure.extension.resourceId)",
      );
    }

    if (!event.planId) {
      problems.push("the plan ID is missing (global.azure.marketplace.planId)");
    }

    if (!event.dimension) {
      problems.push("the dimension is missing");
    }

    if (!Number.isFinite(event.quantity) || event.quantity <= 0) {
      problems.push("the quantity must be more than 0");
    }

    if (
      !(event.effectiveStartTime instanceof Date) ||
      Number.isNaN(event.effectiveStartTime.getTime())
    ) {
      problems.push("the effective start time is not a date");
    }

    if (problems.length > 0) {
      throw new MarketplaceApiError({
        message: `Refusing to send a Microsoft Marketplace usage event: ${problems.join("; ")}.`,
        status: null,
        isRetryable: false,
      });
    }
  }

  // The one result of a batchUsageEvent answer, or null when it has none.
  public static readBatchResult(body: string): AzureUsageEventResult | null {
    const parsed: Record<string, unknown> | null =
      MarketplaceHttp.parseJsonObject(body);
    const results: unknown = parsed?.["result"];

    if (!Array.isArray(results) || results.length === 0) {
      return null;
    }

    const first: unknown = results[0];

    if (!first || typeof first !== "object") {
      return null;
    }

    const record: Record<string, unknown> = first as Record<string, unknown>;
    const status: unknown = record["status"];

    if (typeof status !== "string" || !status) {
      return null;
    }

    const error: Record<string, unknown> | null =
      record["error"] && typeof record["error"] === "object"
        ? (record["error"] as Record<string, unknown>)
        : null;
    const additionalInfo: Record<string, unknown> | null =
      error?.["additionalInfo"] && typeof error["additionalInfo"] === "object"
        ? (error["additionalInfo"] as Record<string, unknown>)
        : null;
    const accepted: Record<string, unknown> | null =
      additionalInfo?.["acceptedMessage"] &&
      typeof additionalInfo["acceptedMessage"] === "object"
        ? (additionalInfo["acceptedMessage"] as Record<string, unknown>)
        : null;

    const usageEventId: unknown =
      record["usageEventId"] ?? accepted?.["usageEventId"];
    const keptQuantity: unknown = accepted?.["quantity"];

    return {
      status: status,
      usageEventId:
        typeof usageEventId === "string" && usageEventId ? usageEventId : null,
      keptQuantity:
        typeof keptQuantity === "number" && Number.isFinite(keptQuantity)
          ? keptQuantity
          : null,
      message:
        typeof error?.["message"] === "string"
          ? (error["message"] as string)
          : "",
    };
  }

  /*
   * When an IMDS token expires: expires_on (seconds since the epoch), else
   * now + expires_in, else an hour from now. IMDS sends both as strings.
   */
  private static readTokenExpiry(
    body: Record<string, unknown> | null,
    nowInMs: number,
  ): number {
    const expiresOn: number = Number(body?.["expires_on"]);

    if (Number.isFinite(expiresOn) && expiresOn > 0) {
      return expiresOn * 1000;
    }

    const expiresIn: number = Number(body?.["expires_in"]);

    if (Number.isFinite(expiresIn) && expiresIn > 0) {
      return nowInMs + expiresIn * 1000;
    }

    return nowInMs + 3600 * 1000;
  }
}
