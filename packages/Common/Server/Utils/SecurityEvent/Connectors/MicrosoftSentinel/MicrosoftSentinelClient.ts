import APIException from "../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import { redactLogString, redactLogValue } from "../../../LogRedaction";
import { ConnectorTransport } from "../Types";

/*
 * Microsoft Sentinel HTTP client: Microsoft Entra client-credentials token
 * plus the Azure Resource Manager (ARM) incidents list.
 *
 * Contracts this file relies on, verified against Microsoft's reference:
 *  - Token: POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *    with a form body grant_type=client_credentials, client_id,
 *    client_secret, scope=<resource>/.default; success carries
 *    access_token + expires_in, failure carries error + error_description.
 *    https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
 *  - Incidents: GET {arm}/subscriptions/{sub}/resourceGroups/{rg}/providers/
 *    Microsoft.OperationalInsights/workspaces/{ws}/providers/
 *    Microsoft.SecurityInsights/incidents?api-version=2024-03-01 with
 *    optional $filter, $orderby, $top (max 1000) and $skipToken; the
 *    response is { value: Incident[], nextLink?: string } where nextLink
 *    is the absolute URL of the next page (it carries the skip token).
 *    https://learn.microsoft.com/en-us/rest/api/securityinsights/incidents/list?view=rest-securityinsights-2024-03-01
 *  - Azure Government hosts: login.microsoftonline.us for Entra and
 *    management.usgovcloudapi.net for ARM.
 *    https://learn.microsoft.com/en-us/azure/azure-government/compare-azure-government-global-azure
 *
 * Every request goes through the injected ConnectorTransport (the
 * SSRF-guarded DataSourceHttpFetch in production), carries the caller's
 * timeout, and is additionally raced against a local deadline so a
 * transport that never settles cannot pin a poll. Every error is an
 * APIException whose prefix names the step ("token request" or
 * "incidents list") and whose body excerpt has been through redaction, so
 * the message can be stored on the connection row and shown in the UI.
 */

export type MicrosoftSentinelCloud = "public" | "usgov";

export interface MicrosoftSentinelCloudEndpoints {
  // Base of the Entra token endpoint, e.g. https://login.microsoftonline.com
  loginBaseUrl: string;
  // Base of Azure Resource Manager, e.g. https://management.azure.com
  managementBaseUrl: string;
  // Where a person opens the incident; used in remediation text only.
  portalHost: string;
}

export const MICROSOFT_SENTINEL_CLOUD_ENDPOINTS: Record<
  MicrosoftSentinelCloud,
  MicrosoftSentinelCloudEndpoints
> = {
  public: {
    loginBaseUrl: "https://login.microsoftonline.com",
    managementBaseUrl: "https://management.azure.com",
    portalHost: "portal.azure.com",
  },
  usgov: {
    loginBaseUrl: "https://login.microsoftonline.us",
    managementBaseUrl: "https://management.usgovcloudapi.net",
    portalHost: "portal.azure.us",
  },
};

export const MICROSOFT_SENTINEL_API_VERSION: string = "2024-03-01";

/*
 * Page size for polling. The API allows up to 1000, but each incident is a
 * few kilobytes and the transport caps response size; 50 keeps a page
 * comfortably inside that cap while a 20-request budget still covers a
 * thousand incidents per poll.
 */
export const MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE: number = 50;
export const MICROSOFT_SENTINEL_MAX_PAGE_SIZE: number = 1000;

export const MICROSOFT_SENTINEL_DEFAULT_REQUEST_TIMEOUT_IN_MS: number =
  60 * 1000;

// Refresh a cached token this long before Entra says it expires.
const TOKEN_EXPIRY_SKEW_IN_MS: number = 60 * 1000;

const TOKEN_STEP: string = "token request";
const INCIDENTS_STEP: string = "incidents list";

const GUID_REGEX: RegExp =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/*
 * Entra accepts the tenant as a GUID or as a verified domain name
 * (contoso.onmicrosoft.com). Anything with a slash, a space or a query
 * character is refused because the value is interpolated into a URL path.
 */
const TENANT_DOMAIN_REGEX: RegExp =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/*
 * Azure resource group names: 1-90 characters of letters, digits,
 * underscores, hyphens, periods and parentheses, not ending in a period.
 * https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules
 */
const RESOURCE_GROUP_REGEX: RegExp = /^[-\w._()]{1,90}$/;

/*
 * Workspace name pattern from the incidents API's URI parameter table:
 * ^[A-Za-z0-9][A-Za-z0-9-]+[A-Za-z0-9]$, 1-90 characters.
 */
const WORKSPACE_NAME_REGEX: RegExp = /^[A-Za-z0-9][A-Za-z0-9-]+[A-Za-z0-9]$/;

// The shape DataSourceHttpFetch throws for a non-2xx answer.
const TRANSPORT_HTTP_ERROR_REGEX: RegExp =
  /^Data source responded with HTTP (\d{3}):\s*([\s\S]*)$/;

export interface MicrosoftSentinelClientOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
  resourceGroup: string;
  workspaceName: string;
  cloud: MicrosoftSentinelCloud;
  transport: ConnectorTransport;
  requestTimeoutInMs?: number | undefined;
}

export interface MicrosoftSentinelIncidentsPage {
  incidents: Array<JSONObject>;
  // Absolute URL of the next page, or null when this was the last page.
  nextLink: string | null;
}

export interface MicrosoftSentinelIncidentCount {
  // Incidents on the first page (bounded by the page size asked for).
  count: number;
  // True when the API offered a further page, i.e. the real count is larger.
  hasMore: boolean;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

interface AcquiredToken {
  accessToken: string;
  // True when the token came from the cache rather than a fresh request.
  fromCache: boolean;
}

export default class MicrosoftSentinelClient {
  private options: MicrosoftSentinelClientOptions;
  private endpoints: MicrosoftSentinelCloudEndpoints;
  private requestTimeoutInMs: number;
  private cachedToken: CachedToken | null = null;
  private requestCount: number = 0;

  public constructor(options: MicrosoftSentinelClientOptions) {
    MicrosoftSentinelClient.validateTenantId(options.tenantId);
    MicrosoftSentinelClient.validateGuid(
      options.clientId,
      "Application (client) ID",
    );
    MicrosoftSentinelClient.validateGuid(
      options.subscriptionId,
      "Subscription ID",
    );
    MicrosoftSentinelClient.validateResourceGroup(options.resourceGroup);
    MicrosoftSentinelClient.validateWorkspaceName(options.workspaceName);

    if (!options.clientSecret) {
      throw new BadDataException("Client secret is required.");
    }

    this.options = options;
    this.endpoints = MicrosoftSentinelClient.resolveCloud(options.cloud);
    this.requestTimeoutInMs =
      options.requestTimeoutInMs && options.requestTimeoutInMs > 0
        ? options.requestTimeoutInMs
        : MICROSOFT_SENTINEL_DEFAULT_REQUEST_TIMEOUT_IN_MS;
  }

  // Every outbound request this instance made, token requests included.
  public getRequestCount(): number {
    return this.requestCount;
  }

  /*
   * ---------------------------------------------------------------------
   * Validation (shared with the connector's validateSettings)
   * ---------------------------------------------------------------------
   */

  public static isCloud(value: string): value is MicrosoftSentinelCloud {
    return value === "public" || value === "usgov";
  }

  public static resolveCloud(
    cloud: string | undefined,
  ): MicrosoftSentinelCloudEndpoints {
    const normalized: string = (cloud || "public").trim().toLowerCase();

    if (!MicrosoftSentinelClient.isCloud(normalized)) {
      throw new BadDataException(
        `Cloud must be "public" or "usgov"; received "${normalized}".`,
      );
    }

    return MICROSOFT_SENTINEL_CLOUD_ENDPOINTS[normalized];
  }

  public static validateGuid(value: string, label: string): void {
    if (!value || !GUID_REGEX.test(value.trim())) {
      throw new BadDataException(
        `${label} must be a GUID such as 00000000-0000-0000-0000-000000000000.`,
      );
    }
  }

  public static validateTenantId(value: string): void {
    const trimmed: string = (value || "").trim();

    if (
      !trimmed ||
      (!GUID_REGEX.test(trimmed) && !TENANT_DOMAIN_REGEX.test(trimmed))
    ) {
      throw new BadDataException(
        "Directory (tenant) ID must be the tenant GUID or a verified tenant domain such as contoso.onmicrosoft.com.",
      );
    }
  }

  public static validateResourceGroup(value: string): void {
    const trimmed: string = (value || "").trim();

    if (
      !trimmed ||
      !RESOURCE_GROUP_REGEX.test(trimmed) ||
      trimmed.endsWith(".")
    ) {
      throw new BadDataException(
        "Resource group must be 1-90 characters of letters, digits, underscores, hyphens, periods or parentheses and must not end with a period.",
      );
    }
  }

  public static validateWorkspaceName(value: string): void {
    const trimmed: string = (value || "").trim();

    if (
      !trimmed ||
      trimmed.length > 90 ||
      !WORKSPACE_NAME_REGEX.test(trimmed)
    ) {
      throw new BadDataException(
        "Workspace name must be 3-90 letters, digits or hyphens, starting and ending with a letter or digit.",
      );
    }
  }

  /*
   * ---------------------------------------------------------------------
   * URLs
   * ---------------------------------------------------------------------
   */

  public getTokenUrl(): string {
    return `${this.endpoints.loginBaseUrl}/${encodeURIComponent(
      this.options.tenantId.trim(),
    )}/oauth2/v2.0/token`;
  }

  /*
   * The ARM resource for the token: the management host with the ".default"
   * suffix, so the same client works in Azure Government where ARM is a
   * different resource (https://management.usgovcloudapi.net/.default).
   */
  public getTokenScope(): string {
    return `${this.endpoints.managementBaseUrl}/.default`;
  }

  public getIncidentsBaseUrl(): string {
    return (
      `${this.endpoints.managementBaseUrl}/subscriptions/${encodeURIComponent(
        this.options.subscriptionId.trim(),
      )}` +
      `/resourceGroups/${encodeURIComponent(this.options.resourceGroup.trim())}` +
      `/providers/Microsoft.OperationalInsights/workspaces/${encodeURIComponent(
        this.options.workspaceName.trim(),
      )}` +
      `/providers/Microsoft.SecurityInsights/incidents`
    );
  }

  /*
   * First-page URL for incidents CREATED in [startTime, endTime), oldest
   * first. Creation time is the poll basis (see Connectors/Types.ts): a
   * cursor over createdTimeUtc never skips an incident whose alerts
   * describe activity from hours earlier.
   */
  public buildIncidentsUrl(data: {
    startTime: Date;
    endTime: Date;
    top: number;
  }): string {
    const top: number = MicrosoftSentinelClient.clampPageSize(data.top);
    const url: URL = new URL(this.getIncidentsBaseUrl());
    url.searchParams.set("api-version", MICROSOFT_SENTINEL_API_VERSION);
    url.searchParams.set(
      "$filter",
      `(properties/createdTimeUtc ge ${data.startTime.toISOString()}) and (properties/createdTimeUtc lt ${data.endTime.toISOString()})`,
    );
    url.searchParams.set("$orderby", "properties/createdTimeUtc asc");
    url.searchParams.set("$top", String(top));

    return url.toString();
  }

  public static clampPageSize(value: number | undefined): number {
    if (!value || !Number.isFinite(value)) {
      return MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE;
    }

    return Math.min(
      MICROSOFT_SENTINEL_MAX_PAGE_SIZE,
      Math.max(1, Math.floor(value)),
    );
  }

  /*
   * ---------------------------------------------------------------------
   * Token
   * ---------------------------------------------------------------------
   */

  public async getAccessToken(): Promise<string> {
    return (await this.acquireToken()).accessToken;
  }

  private async acquireToken(): Promise<AcquiredToken> {
    if (
      this.cachedToken &&
      this.cachedToken.expiresAtMs - TOKEN_EXPIRY_SKEW_IN_MS > Date.now()
    ) {
      return { accessToken: this.cachedToken.accessToken, fromCache: true };
    }

    const response: DataSourceHttpResponse = await this.send(
      {
        method: "POST",
        url: this.getTokenUrl(),
        headers: { Accept: "application/json" },
        formUrlEncoded: true,
        body: {
          grant_type: "client_credentials",
          client_id: this.options.clientId.trim(),
          client_secret: this.options.clientSecret,
          scope: this.getTokenScope(),
        },
      },
      TOKEN_STEP,
    );

    const body: JSONObject = this.requireJsonObject(response, TOKEN_STEP);
    const accessToken: unknown = body["access_token"];

    if (typeof accessToken !== "string" || !accessToken) {
      throw new APIException(
        `Microsoft Sentinel ${TOKEN_STEP} returned no access_token: ${MicrosoftSentinelClient.describeBody(
          response,
        )}`,
      );
    }

    const expiresInRaw: unknown = body["expires_in"];
    const expiresInSeconds: number =
      typeof expiresInRaw === "number"
        ? expiresInRaw
        : Number(expiresInRaw || 0);

    this.cachedToken = {
      accessToken,
      expiresAtMs:
        Date.now() +
        (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
          ? expiresInSeconds * 1000
          : 5 * 60 * 1000),
    };

    return { accessToken, fromCache: false };
  }

  /*
   * ---------------------------------------------------------------------
   * Incidents
   * ---------------------------------------------------------------------
   */

  /*
   * One page of incidents. Pass `nextLink` from the previous page to
   * continue; the window parameters are ignored then because ARM encodes
   * the whole query (filter, order, skip token) inside the link.
   */
  public async listIncidents(data: {
    startTime: Date;
    endTime: Date;
    top?: number | undefined;
    nextLink?: string | null | undefined;
  }): Promise<MicrosoftSentinelIncidentsPage> {
    const url: string = data.nextLink
      ? this.assertNextLink(data.nextLink)
      : this.buildIncidentsUrl({
          startTime: data.startTime,
          endTime: data.endTime,
          top: data.top || MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE,
        });

    let token: AcquiredToken = await this.acquireToken();
    let response: DataSourceHttpResponse = await this.sendRaw(
      MicrosoftSentinelClient.incidentsRequest(url, token.accessToken),
      INCIDENTS_STEP,
    );

    /*
     * A cached token can be revoked (secret rotated, app registration
     * removed) or expire between pages of one run. One retry with a
     * freshly minted token separates "the token went stale" from "ARM does
     * not accept tokens from this app" without ever looping: a fresh
     * token that is refused fails below like any other 401.
     */
    if (response.statusCode === 401 && token.fromCache) {
      this.cachedToken = null;
      token = await this.acquireToken();
      response = await this.sendRaw(
        MicrosoftSentinelClient.incidentsRequest(url, token.accessToken),
        INCIDENTS_STEP,
      );
    }

    this.assertOk(response, INCIDENTS_STEP);

    const body: JSONObject = this.requireJsonObject(response, INCIDENTS_STEP);
    const value: unknown = body["value"];

    if (!Array.isArray(value)) {
      throw new APIException(
        `Microsoft Sentinel ${INCIDENTS_STEP} returned an unrecognized response shape: expected a "value" array, received keys ${MicrosoftSentinelClient.describeKeys(
          body,
        )}.`,
      );
    }

    const incidents: Array<JSONObject> = (value as Array<JSONValue>).filter(
      (item: JSONValue): boolean => {
        return Boolean(
          item && typeof item === "object" && !Array.isArray(item),
        );
      },
    ) as Array<JSONObject>;

    const nextLinkRaw: unknown = body["nextLink"];
    const nextLink: string | null =
      typeof nextLinkRaw === "string" && nextLinkRaw.trim()
        ? nextLinkRaw.trim()
        : null;

    return { incidents, nextLink };
  }

  /*
   * Bounded availability count: one page of `top` incidents created in the
   * window plus whether a further page exists. Never walks the pages — a
   * count is for the test checklist, not for import.
   */
  public async countIncidentsCreated(data: {
    startTime: Date;
    endTime: Date;
    top?: number | undefined;
  }): Promise<MicrosoftSentinelIncidentCount> {
    const page: MicrosoftSentinelIncidentsPage = await this.listIncidents({
      startTime: data.startTime,
      endTime: data.endTime,
      top: data.top || MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE,
    });

    return {
      count: page.incidents.length,
      hasMore: page.nextLink !== null,
    };
  }

  /*
   * ---------------------------------------------------------------------
   * Transport plumbing
   * ---------------------------------------------------------------------
   */

  private static incidentsRequest(
    url: string,
    accessToken: string,
  ): DataSourceHttpRequest {
    return {
      method: "GET",
      url,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    };
  }

  /*
   * nextLink is server-supplied. It is followed only when it stays on the
   * configured ARM host over https: a link elsewhere would let a
   * compromised or misconfigured endpoint steer the bearer token to a
   * host of its choosing. The egress guard would still vet the host, but
   * the token must not leave ARM regardless.
   */
  private assertNextLink(nextLink: string): string {
    let parsed: URL;

    try {
      parsed = new URL(nextLink);
    } catch {
      throw new APIException(
        `Microsoft Sentinel ${INCIDENTS_STEP} returned an unusable nextLink: ${redactLogString(
          nextLink.substring(0, 200),
        )}`,
      );
    }

    const expected: URL = new URL(this.endpoints.managementBaseUrl);

    if (parsed.protocol !== "https:" || parsed.host !== expected.host) {
      throw new APIException(
        `Microsoft Sentinel ${INCIDENTS_STEP} returned a nextLink on an unexpected host: ${redactLogString(
          parsed.host,
        )} (expected ${expected.host}).`,
      );
    }

    return parsed.toString();
  }

  // Send and require a 2xx answer.
  private async send(
    request: DataSourceHttpRequest,
    stepLabel: string,
  ): Promise<DataSourceHttpResponse> {
    const response: DataSourceHttpResponse = await this.sendRaw(
      request,
      stepLabel,
    );

    this.assertOk(response, stepLabel);

    return response;
  }

  /*
   * Send and return whatever status came back, so a caller can react to a
   * 401 before the status is turned into an error. Transport failures
   * that carry an HTTP status are folded into a response; everything else
   * (connection refused, the transport's own timeout, the local deadline)
   * throws with the step in the prefix.
   */
  private async sendRaw(
    request: DataSourceHttpRequest,
    stepLabel: string,
  ): Promise<DataSourceHttpResponse> {
    this.requestCount++;

    const timeoutSeconds: number = Math.max(
      1,
      Math.round(this.requestTimeoutInMs / 1000),
    );
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const deadline: Promise<never> = new Promise(
      (
        _resolve: (value: never | PromiseLike<never>) => void,
        reject: (reason?: unknown) => void,
      ): void => {
        timer = setTimeout((): void => {
          reject(
            new APIException(
              `Microsoft Sentinel ${stepLabel} timed out after ${timeoutSeconds} seconds with no response.`,
            ),
          );
        }, this.requestTimeoutInMs);
      },
    );

    try {
      return await Promise.race([
        this.options.transport({
          ...request,
          timeoutInMs: this.requestTimeoutInMs,
        }),
        deadline,
      ]);
    } catch (error) {
      return this.recoverResponse(error, stepLabel);
    } finally {
      clearTimeout(timer);
    }
  }

  private assertOk(response: DataSourceHttpResponse, stepLabel: string): void {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return;
    }

    throw new APIException(
      `Microsoft Sentinel ${stepLabel} failed (HTTP ${response.statusCode}): ${MicrosoftSentinelClient.describeBody(
        response,
      )}${MicrosoftSentinelClient.hintForFailure(
        stepLabel,
        response.statusCode,
        response.bodyJson,
      )}`,
    );
  }

  /*
   * The production transport does not return error statuses — it throws
   * `Data source responded with HTTP <status>: <body>`. Recover the status
   * so the operator sees the same "(HTTP 403)" prefix whichever transport
   * is behind the client, and the docs' troubleshooting keys stay true.
   */
  private recoverResponse(
    error: unknown,
    stepLabel: string,
  ): DataSourceHttpResponse {
    if (error instanceof APIException) {
      throw error;
    }

    const message: string =
      error instanceof Error ? error.message : String(error || "");
    const match: RegExpMatchArray | null = message.match(
      TRANSPORT_HTTP_ERROR_REGEX,
    );

    if (match) {
      const bodyText: string = match[2] || "";
      let bodyJson: unknown = undefined;

      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        bodyJson = undefined;
      }

      return { statusCode: Number(match[1]), bodyText, bodyJson };
    }

    throw new APIException(
      `Microsoft Sentinel ${stepLabel} failed: ${redactLogString(
        message || "unknown transport error",
      ).substring(0, 500)}`,
    );
  }

  private requireJsonObject(
    response: DataSourceHttpResponse,
    stepLabel: string,
  ): JSONObject {
    const body: unknown = response.bodyJson;

    if (body === undefined || body === null) {
      throw new APIException(
        `Microsoft Sentinel ${stepLabel} returned a non-JSON body: ${redactLogString(
          (response.bodyText || "").substring(0, 200),
        )}`,
      );
    }

    if (typeof body !== "object" || Array.isArray(body)) {
      throw new APIException(
        `Microsoft Sentinel ${stepLabel} returned an unrecognized response shape: expected a JSON object, received ${Array.isArray(body) ? "an array" : typeof body}.`,
      );
    }

    return body as JSONObject;
  }

  /*
   * A body excerpt safe to store: structurally redacted when it parsed as
   * JSON (so any `access_token`/`client_secret` key is masked whatever its
   * value looks like), textually redacted otherwise, and clipped.
   */
  private static describeBody(response: {
    statusCode: number;
    bodyText: string;
    bodyJson: unknown;
  }): string {
    if (response.bodyJson !== undefined && response.bodyJson !== null) {
      const redacted: unknown = redactLogValue(response.bodyJson);
      let serialized: string = "";

      try {
        serialized = JSON.stringify(redacted);
      } catch {
        serialized = "[unserializable body]";
      }

      return serialized.substring(0, 500);
    }

    const text: string = (response.bodyText || "").trim();

    return text
      ? redactLogString(text).substring(0, 500)
      : "(empty response body)";
  }

  private static describeKeys(body: JSONObject): string {
    const keys: Array<string> = Object.keys(body).slice(0, 10);

    return keys.length ? keys.join(", ") : "(none)";
  }

  /*
   * What the status most likely means, in the operator's terms. Entra
   * returns an `error` code with an AADSTS-prefixed description; ARM
   * returns { error: { code, message } }. The hint never repeats the body.
   */
  public static hintForFailure(
    stepLabel: string,
    status: number,
    bodyJson: unknown,
  ): string {
    const hint: string = MicrosoftSentinelClient.hintText(
      stepLabel,
      status,
      bodyJson,
    );

    return hint ? ` — ${hint}` : "";
  }

  private static hintText(
    stepLabel: string,
    status: number,
    bodyJson: unknown,
  ): string {
    const body: JSONObject | null =
      bodyJson && typeof bodyJson === "object" && !Array.isArray(bodyJson)
        ? (bodyJson as JSONObject)
        : null;

    if (stepLabel === TOKEN_STEP) {
      const errorCode: string = body ? String(body["error"] || "") : "";
      const description: string = body
        ? String(body["error_description"] || "")
        : "";

      /*
       * AADSTS7000215 is "invalid client secret provided", AADSTS7000216 is
       * "client secret is required" — both mean the secret, not the ids.
       */
      if (
        errorCode === "invalid_client" ||
        description.includes("AADSTS7000215") ||
        description.includes("AADSTS7000216")
      ) {
        return "Microsoft Entra rejected the client secret. It is wrong, expired, or belongs to a different app registration; create a new secret under Certificates & secrets and update the connection.";
      }

      // AADSTS700016: application with identifier ... was not found in the directory.
      if (
        errorCode === "unauthorized_client" ||
        description.includes("AADSTS700016")
      ) {
        return "The Application (client) ID was not found in this tenant. Check the Directory (tenant) ID and Application (client) ID on the app registration's Overview page.";
      }

      // AADSTS90002: tenant not found.
      if (description.includes("AADSTS90002") || status === 404) {
        return "The Directory (tenant) ID does not name an existing tenant. Copy it from the app registration's Overview page.";
      }

      if (status === 400 || status === 401) {
        return "Microsoft Entra refused the client-credentials request. Check the Directory (tenant) ID, Application (client) ID and client secret.";
      }

      if (status === 429) {
        return "Microsoft Entra is throttling token requests; the next poll retries.";
      }

      if (status >= 500) {
        return "Microsoft Entra reported a server-side problem; the next poll retries.";
      }

      return "";
    }

    const armCode: string = body
      ? String(((body["error"] as JSONObject | undefined) || {})["code"] || "")
      : "";

    if (status === 401) {
      return "Azure Resource Manager rejected the access token. The token was issued for the wrong cloud or the app registration was removed; confirm the Cloud setting matches where the workspace lives.";
    }

    if (status === 403 || armCode === "AuthorizationFailed") {
      return "The app registration is not allowed to read incidents. Assign it the Microsoft Sentinel Reader role on the resource group that contains the workspace (Access control (IAM) > Add role assignment) and wait a few minutes for the assignment to propagate.";
    }

    if (status === 404) {
      return "No workspace matched Subscription ID, Resource group and Workspace name, or Microsoft Sentinel is not enabled on it. Copy the values from the workspace's Overview page in the Azure portal.";
    }

    if (status === 429) {
      return "Azure Resource Manager is throttling requests for this subscription; the next poll retries.";
    }

    if (status >= 500) {
      return "Azure Resource Manager reported a server-side problem; the next poll retries.";
    }

    if (status === 400) {
      return "Azure Resource Manager rejected the query. Report this message to OneUptime support; the incidents request is built by the connector, not from your settings.";
    }

    return "";
  }
}
