import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import MarketplaceApiError from "../MarketplaceApiError";
import {
  MarketplaceHttp,
  MarketplaceHttpClient,
  MarketplaceHttpMethod,
  MarketplaceHttpResponse,
  defaultMarketplaceHttpClient,
} from "Common/Server/Utils/Marketplace/MarketplaceHttp";

/*
 * The Google Cloud APIs a Google Cloud Marketplace SaaS product calls:
 *
 *   - the Partner Procurement API, to approve a buyer's account once they
 *     have signed up, approve their orders (entitlements) and plan changes,
 *     and read where an entitlement stands;
 *   - Service Control, to report usage against an entitlement.
 *
 * https://docs.cloud.google.com/marketplace/docs/partners/commerce-procurement-api/reference/rest
 * https://docs.cloud.google.com/marketplace/docs/partners/integrated-saas/configure-usage-reports
 *
 * Both authenticate with the service account linked to the product in
 * Producer Portal, through the standard JWT-bearer exchange: an RS256
 * assertion signed with the account's private key, traded for an access
 * token, cached until shortly before it expires. No Google SDK - the
 * exchange is one POST.
 */

const PROCUREMENT_API_BASE_URL: string =
  "https://cloudcommerceprocurement.googleapis.com/v1";
const SERVICE_CONTROL_API_BASE_URL: string =
  "https://servicecontrol.googleapis.com/v1";
const CLOUD_PLATFORM_SCOPE: string =
  "https://www.googleapis.com/auth/cloud-platform";

/*
 * A provider, account or entitlement ID as it may stand in a Procurement API
 * path or filter: letters, digits, "-" and "_", the way Google writes them.
 */
const GOOGLE_RESOURCE_ID: RegExp = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DEFAULT_TOKEN_URI: string = "https://oauth2.googleapis.com/token";
const TOKEN_LIFETIME_IN_SECONDS: number = 3600;
const TOKEN_EXPIRY_SLACK_IN_SECONDS: number = 120;
/*
 * Google refuses an assertion issued in its future, and reports it as
 * invalid_grant - which reads exactly like a bad key. Backdating iat by a
 * minute absorbs a host clock that runs slightly fast.
 */
const TOKEN_CLOCK_SKEW_IN_SECONDS: number = 60;

export interface GoogleServiceAccountKey {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

// One entitlement, as the Procurement API returns it (only what OneUptime reads).
export interface GoogleCloudEntitlement {
  name: string;
  id: string;
  accountId: string;
  state: string;
  plan: string | null;
  newPendingPlan: string | null;
  product: string | null;
  usageReportingId: string | null;
  createTime: string | null;
  updateTime: string | null;
}

export interface GoogleCloudAccount {
  id: string;
  state: string | null;
  // Approval name -> state (PENDING, APPROVED, REJECTED).
  approvals: Record<string, string>;
}

export interface GoogleCloudUsageOperation {
  operationId: string;
  operationName: string;
  consumerId: string;
  startTime: string;
  endTime: string;
  metricName: string;
  quantity: number;
  labels?: Record<string, string> | undefined;
}

export interface GoogleCloudServiceControlError {
  code: string;
  detail: string;
}

export default class GoogleCloudMarketplaceAPI {
  private providerId: string;
  private serviceAccountKey: GoogleServiceAccountKey;
  private serviceName: string | null;
  private httpClient: MarketplaceHttpClient;
  private now: () => number;
  private cachedAccessToken: string | null = null;
  private cachedAccessTokenExpiresAtInMs: number = 0;

  public constructor(options: {
    providerId: string;
    serviceAccountKey: GoogleServiceAccountKey;
    serviceName?: string | null | undefined;
    httpClient?: MarketplaceHttpClient | undefined;
    now?: (() => number) | undefined;
  }) {
    this.providerId = options.providerId;
    this.serviceAccountKey = options.serviceAccountKey;
    this.serviceName = options.serviceName || null;
    this.httpClient = options.httpClient || defaultMarketplaceHttpClient;
    this.now =
      options.now ||
      ((): number => {
        return Date.now();
      });
  }

  /*
   * The service account's JSON key, as downloaded from Google Cloud - or the
   * same, base64-encoded, which is easier to keep in an environment variable.
   * Null when it is neither, or lacks the email or private key.
   */
  public static parseServiceAccountKey(
    raw: string | null | undefined,
  ): GoogleServiceAccountKey | null {
    if (!raw || !raw.trim()) {
      return null;
    }

    const candidates: Array<string> = [raw.trim()];

    if (!raw.trim().startsWith("{")) {
      try {
        candidates.push(Buffer.from(raw.trim(), "base64").toString("utf8"));
      } catch {
        // Not base64 either.
      }
    }

    for (const candidate of candidates) {
      const parsed: Record<string, unknown> | null =
        MarketplaceHttp.parseJsonObject(candidate);

      if (!parsed) {
        continue;
      }

      const clientEmail: unknown = parsed["client_email"];
      const privateKey: unknown = parsed["private_key"];
      const tokenUri: unknown = parsed["token_uri"];

      if (
        typeof clientEmail !== "string" ||
        !clientEmail ||
        typeof privateKey !== "string" ||
        !privateKey.includes("PRIVATE KEY")
      ) {
        return null;
      }

      return {
        clientEmail: clientEmail,
        privateKey: privateKey,
        /*
         * Only Google's own token endpoint. The assertion is signed with the
         * service account's key, and a key file pointing it anywhere else
         * would hand that assertion to whoever runs the other endpoint.
         */
        tokenUri:
          typeof tokenUri === "string" && tokenUri === DEFAULT_TOKEN_URI
            ? tokenUri
            : DEFAULT_TOKEN_URI,
      };
    }

    return null;
  }

  /*
   * An ID put into a Procurement API path or filter, checked first. The IDs
   * come from Google - a signed Pub/Sub push, the buyer's signed token, the
   * API's own answers - and are still held to the shape of Google's IDs
   * here, so no value can send a request to another path of the API than the
   * resource it names. Not retryable: a redelivered message carries the same
   * ID.
   */
  public static pathId(kind: string, id: string): string {
    if (!GOOGLE_RESOURCE_ID.test(id)) {
      throw new MarketplaceApiError({
        message: `Not a Google Cloud Marketplace ${kind} ID.`,
        status: null,
        isRetryable: false,
      });
    }

    return encodeURIComponent(id);
  }

  public static getAccountName(providerId: string, accountId: string): string {
    return `providers/${GoogleCloudMarketplaceAPI.pathId("provider", providerId)}/accounts/${GoogleCloudMarketplaceAPI.pathId("account", accountId)}`;
  }

  public static getEntitlementName(
    providerId: string,
    entitlementId: string,
  ): string {
    return `providers/${GoogleCloudMarketplaceAPI.pathId("provider", providerId)}/entitlements/${GoogleCloudMarketplaceAPI.pathId("entitlement", entitlementId)}`;
  }

  // The last segment of a resource name ("providers/x/accounts/ID" -> "ID").
  public static lastSegment(name: string): string {
    const parts: Array<string> = name.split("/");
    return parts[parts.length - 1] || "";
  }

  public static parseEntitlement(
    raw: Record<string, unknown>,
  ): GoogleCloudEntitlement | null {
    const name: unknown = raw["name"];
    const account: unknown = raw["account"];

    if (typeof name !== "string" || typeof account !== "string") {
      return null;
    }

    const readString: (key: string) => string | null = (
      key: string,
    ): string | null => {
      const value: unknown = raw[key];
      return typeof value === "string" && value ? value : null;
    };

    return {
      name: name,
      id: GoogleCloudMarketplaceAPI.lastSegment(name),
      accountId: GoogleCloudMarketplaceAPI.lastSegment(account),
      state: readString("state") || "ENTITLEMENT_STATE_UNSPECIFIED",
      plan: readString("plan"),
      newPendingPlan: readString("newPendingPlan"),
      product: readString("productExternalName") || readString("product"),
      usageReportingId: readString("usageReportingId"),
      createTime: readString("createTime"),
      updateTime: readString("updateTime"),
    };
  }

  public async getAccount(
    accountId: string,
  ): Promise<GoogleCloudAccount | null> {
    const body: Record<string, unknown> | null = await this.callOrNullIfMissing(
      "GET",
      `${PROCUREMENT_API_BASE_URL}/${GoogleCloudMarketplaceAPI.getAccountName(this.providerId, accountId)}`,
    );

    if (!body) {
      return null;
    }

    const approvals: Record<string, string> = {};
    const rawApprovals: unknown = body["approvals"];

    if (Array.isArray(rawApprovals)) {
      for (const approval of rawApprovals) {
        if (approval && typeof approval === "object") {
          const approvalName: unknown = (approval as Record<string, unknown>)[
            "name"
          ];
          const approvalState: unknown = (approval as Record<string, unknown>)[
            "state"
          ];

          if (
            typeof approvalName === "string" &&
            typeof approvalState === "string"
          ) {
            approvals[approvalName] = approvalState;
          }
        }
      }
    }

    return {
      id: accountId,
      state: typeof body["state"] === "string" ? body["state"] : null,
      approvals: approvals,
    };
  }

  /*
   * Approve the buyer's account once they have signed up with OneUptime: it
   * is what tells Google the sign-up is complete. The approval is named
   * "signup".
   */
  public async approveAccount(accountId: string): Promise<void> {
    await this.call(
      "POST",
      `${PROCUREMENT_API_BASE_URL}/${GoogleCloudMarketplaceAPI.getAccountName(this.providerId, accountId)}:approve`,
      { approvalName: "signup" },
    );
  }

  public async getEntitlement(
    entitlementId: string,
  ): Promise<GoogleCloudEntitlement | null> {
    const body: Record<string, unknown> | null = await this.callOrNullIfMissing(
      "GET",
      `${PROCUREMENT_API_BASE_URL}/${GoogleCloudMarketplaceAPI.getEntitlementName(this.providerId, entitlementId)}`,
    );

    return body ? GoogleCloudMarketplaceAPI.parseEntitlement(body) : null;
  }

  // Every entitlement (order) of one account, across pages.
  public async listEntitlements(
    accountId: string,
  ): Promise<Array<GoogleCloudEntitlement>> {
    const entitlements: Array<GoogleCloudEntitlement> = [];
    let pageToken: string | null = null;

    // A buyer has a handful of orders; the page bound only stops a runaway loop.
    for (let page: number = 0; page < 20; page++) {
      const params: URLSearchParams = new URLSearchParams({
        filter: `account=${GoogleCloudMarketplaceAPI.pathId("account", accountId)}`,
      });

      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const body: Record<string, unknown> = await this.call(
        "GET",
        `${PROCUREMENT_API_BASE_URL}/providers/${GoogleCloudMarketplaceAPI.pathId("provider", this.providerId)}/entitlements?${params.toString()}`,
      );

      const rawEntitlements: unknown = body["entitlements"];

      if (Array.isArray(rawEntitlements)) {
        for (const raw of rawEntitlements) {
          if (raw && typeof raw === "object") {
            const entitlement: GoogleCloudEntitlement | null =
              GoogleCloudMarketplaceAPI.parseEntitlement(
                raw as Record<string, unknown>,
              );

            if (entitlement && entitlement.accountId === accountId) {
              entitlements.push(entitlement);
            }
          }
        }
      }

      pageToken =
        typeof body["nextPageToken"] === "string" && body["nextPageToken"]
          ? body["nextPageToken"]
          : null;

      if (!pageToken) {
        break;
      }
    }

    return entitlements;
  }

  public async approveEntitlement(entitlementId: string): Promise<void> {
    await this.call(
      "POST",
      `${PROCUREMENT_API_BASE_URL}/${GoogleCloudMarketplaceAPI.getEntitlementName(this.providerId, entitlementId)}:approve`,
      {},
    );
  }

  public async approvePlanChange(
    entitlementId: string,
    pendingPlanName: string,
  ): Promise<void> {
    await this.call(
      "POST",
      `${PROCUREMENT_API_BASE_URL}/${GoogleCloudMarketplaceAPI.getEntitlementName(this.providerId, entitlementId)}:approvePlanChange`,
      { pendingPlanName: pendingPlanName },
    );
  }

  /*
   * Service Control: check, then report, one usage operation. Check comes
   * first, with the same operation ID, because it is what says the
   * consumer can no longer be billed (SERVICE_NOT_ACTIVATED,
   * BILLING_DISABLED, PROJECT_DELETED); a report is only sent when the check
   * has no errors.
   */
  public async checkUsage(
    operation: GoogleCloudUsageOperation,
  ): Promise<Array<GoogleCloudServiceControlError>> {
    const body: Record<string, unknown> = await this.call(
      "POST",
      `${SERVICE_CONTROL_API_BASE_URL}/services/${this.getServiceName()}:check`,
      { operation: this.toServiceControlOperation(operation) },
    );

    return GoogleCloudMarketplaceAPI.readServiceControlErrors(
      body["checkErrors"],
    );
  }

  public async reportUsage(
    operation: GoogleCloudUsageOperation,
  ): Promise<Array<GoogleCloudServiceControlError>> {
    const body: Record<string, unknown> = await this.call(
      "POST",
      `${SERVICE_CONTROL_API_BASE_URL}/services/${this.getServiceName()}:report`,
      { operations: [this.toServiceControlOperation(operation)] },
    );

    return GoogleCloudMarketplaceAPI.readServiceControlErrors(
      body["reportErrors"],
    );
  }

  public static readServiceControlErrors(
    raw: unknown,
  ): Array<GoogleCloudServiceControlError> {
    if (!Array.isArray(raw)) {
      return [];
    }

    const errors: Array<GoogleCloudServiceControlError> = [];

    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const record: Record<string, unknown> = entry as Record<string, unknown>;
      // A check error carries code/detail; a report error carries status {code, message}.
      const status: Record<string, unknown> | null =
        record["status"] && typeof record["status"] === "object"
          ? (record["status"] as Record<string, unknown>)
          : null;

      errors.push({
        code: String(record["code"] ?? status?.["code"] ?? "UNKNOWN"),
        detail: String(record["detail"] ?? status?.["message"] ?? ""),
      });
    }

    return errors;
  }

  private getServiceName(): string {
    if (!this.serviceName) {
      throw new MarketplaceApiError({
        message:
          "Google Cloud Marketplace usage reporting is not set up: GOOGLE_CLOUD_MARKETPLACE_SERVICE_NAME is empty.",
        status: null,
        isRetryable: false,
      });
    }

    return encodeURIComponent(this.serviceName);
  }

  private toServiceControlOperation(
    operation: GoogleCloudUsageOperation,
  ): Record<string, unknown> {
    return {
      operationId: operation.operationId,
      operationName: operation.operationName,
      consumerId: operation.consumerId,
      startTime: operation.startTime,
      endTime: operation.endTime,
      metricValueSets: [
        {
          metricName: operation.metricName,
          metricValues: [{ int64Value: String(operation.quantity) }],
        },
      ],
      ...(operation.labels ? { userLabels: operation.labels } : {}),
    };
  }

  private async callOrNullIfMissing(
    method: MarketplaceHttpMethod,
    url: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      return await this.call(method, url);
    } catch (err) {
      if (err instanceof MarketplaceApiError && err.isNotFound()) {
        return null;
      }

      throw err;
    }
  }

  private async call(
    method: MarketplaceHttpMethod,
    url: string,
    body?: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown>> {
    const accessToken: string = await this.getAccessToken();

    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: method,
        url: url,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new MarketplaceApiError({
        message: `Google Cloud API request failed (${method} ${GoogleCloudMarketplaceAPI.describeUrl(url)}): ${(err as Error).message}`,
        status: null,
        isRetryable: true,
      });
    }

    if (!MarketplaceHttp.isSuccess(response.status)) {
      throw new MarketplaceApiError({
        message: `Google Cloud API request failed (${method} ${GoogleCloudMarketplaceAPI.describeUrl(url)}, HTTP ${response.status}): ${MarketplaceHttp.summarize(response.body)}`,
        status: response.status,
        isRetryable: MarketplaceHttp.isRetryable(response.status),
        body: response.body,
      });
    }

    return MarketplaceHttp.parseJsonObject(response.body) || {};
  }

  // The URL without its query string, for messages.
  private static describeUrl(url: string): string {
    const queryStart: number = url.indexOf("?");
    return queryStart === -1 ? url : url.substring(0, queryStart);
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

    const issuedAtInSeconds: number =
      Math.floor(nowInMs / 1000) - TOKEN_CLOCK_SKEW_IN_SECONDS;

    // RS256, with the service account's own private key.
    const assertion: string = JSONWebToken.signWithPrivateKey(
      {
        iss: this.serviceAccountKey.clientEmail,
        scope: CLOUD_PLATFORM_SCOPE,
        aud: this.serviceAccountKey.tokenUri,
        iat: issuedAtInSeconds,
        exp: issuedAtInSeconds + TOKEN_LIFETIME_IN_SECONDS,
      },
      this.serviceAccountKey.privateKey,
    );

    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: "POST",
        url: this.serviceAccountKey.tokenUri,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: assertion,
        }).toString(),
      });
    } catch (err) {
      throw new MarketplaceApiError({
        message: `Could not get a Google access token: ${(err as Error).message}`,
        status: null,
        isRetryable: true,
      });
    }

    const body: Record<string, unknown> | null =
      MarketplaceHttp.parseJsonObject(response.body);
    const accessToken: unknown = body?.["access_token"];

    if (!MarketplaceHttp.isSuccess(response.status) || !accessToken) {
      throw new MarketplaceApiError({
        // The token endpoint's error names the problem (invalid_grant...) without echoing the key.
        message: `Could not get a Google access token (HTTP ${response.status}): ${MarketplaceHttp.summarize(response.body)}`,
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
