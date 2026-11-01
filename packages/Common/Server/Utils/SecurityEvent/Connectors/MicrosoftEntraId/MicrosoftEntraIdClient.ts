import APIException from "../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONArray, JSONObject, JSONValue } from "../../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import {
  REDACTED,
  redactLogString,
  redactLogValue,
} from "../../../LogRedaction";
import ConnectorErrorMessage from "../../ConnectorErrorMessage";
import { ConnectorTransport } from "../Types";

/*
 * Microsoft Entra ID's logs through Microsoft Graph, and - for a connection
 * that reads it - the Microsoft 365 audit log through the Office 365
 * Management Activity API. Every endpoint was checked against Microsoft's
 * reference pages:
 *
 *  - Token: the client credentials grant,
 *    POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token, one
 *    token per resource: Graph (https://graph.microsoft.com/.default) and
 *    the Management API (https://manage.office.com/.default).
 *
 *  - Sign-ins: GET {graph}/v1.0/auditLogs/signIns
 *    (learn.microsoft.com/graph/api/signin-list). AuditLog.Read.All; the
 *    tenant needs Microsoft Entra ID P1 or P2. Newest first, at most 1,000
 *    a page; createdDateTime filters with ge and le only.
 *
 *  - Directory audits: GET {graph}/v1.0/auditLogs/directoryAudits
 *    (learn.microsoft.com/graph/api/directoryaudit-list). AuditLog.Read.All;
 *    activityDateTime filters with ge and le.
 *
 *  - Microsoft 365: {manage}/api/v1.0/{tenant GUID}/activity/feed/...
 *    (learn.microsoft.com/office/office-365-management-api/office-365-
 *    management-activity-api-reference). ActivityFeed.Read. A content type
 *    is read only once it has a subscription (subscriptions/start); its
 *    content is listed by when Microsoft made it available (contentCreated,
 *    start inclusive, end exclusive, at most 24 hours, at most 7 days
 *    back), a page at a time through the NextPageUri header, and each
 *    content blob's records are fetched from its contentUri.
 *
 * Every request goes through the injected ConnectorTransport (the
 * SSRF-guarded DataSourceHttpFetch in production) and every status comes
 * back as a response, so each failure is named by the step that failed,
 * with any echoed body run through the log redactor first. A next-page
 * link or a content address must stay on its API's own host: a bearer
 * token is never sent where a response body pointed.
 */

export type MicrosoftEntraIdCloud = "public" | "usgov";

export const MICROSOFT_ENTRA_ID_CLOUDS: Array<MicrosoftEntraIdCloud> = [
  "public",
  "usgov",
];

interface CloudHosts {
  loginHost: string;
  graphHost: string;
  // The Management Activity API: worldwide, and GCC High for usgov.
  manageHost: string;
}

const CLOUD_HOSTS: Record<MicrosoftEntraIdCloud, CloudHosts> = {
  public: {
    loginHost: "https://login.microsoftonline.com",
    graphHost: "https://graph.microsoft.com",
    manageHost: "https://manage.office.com",
  },
  usgov: {
    loginHost: "https://login.microsoftonline.us",
    graphHost: "https://graph.microsoft.us",
    manageHost: "https://manage.office365.us",
  },
};

export type MicrosoftEntraIdResource = "graph" | "manage";

// What a Graph page holds at most, and what a probe asks for.
export const MICROSOFT_ENTRA_ID_PAGE_SIZE: number = 500;

// The Microsoft 365 content types read: Entra ID's own come from Graph.
export const MICROSOFT_365_CONTENT_TYPES: ReadonlyArray<string> = [
  "Audit.Exchange",
  "Audit.SharePoint",
  "Audit.General",
];

// The Management API lists content for at most a day at a time.
export const MICROSOFT_365_MAX_LIST_WINDOW_IN_MS: number = 24 * 60 * 60 * 1000;

// ...and none older than 7 days.
export const MICROSOFT_365_MAX_AGE_IN_MS: number = 7 * 24 * 60 * 60 * 1000;

// The Graph error code of a sign-in read in a tenant without Entra ID P1 or P2.
export const ENTRA_PREMIUM_REQUIRED_CODE: string =
  "Authentication_RequestFromNonPremiumTenantOrB2CTenant";

// The Management API's error code for a content type with no subscription yet.
export const MICROSOFT_365_NO_SUBSCRIPTION_CODE: string = "AF20022";

const TOKEN_EXPIRY_SAFETY_MARGIN_IN_MS: number = 60 * 1000;

const ERROR_PREFIX: string = "Microsoft Entra ID";

/*
 * Graph and the Management API name an error with an identifier (an
 * enumeration name, an AFxxxxx code): letters, digits and underscores.
 */
const ERROR_CODE_REGEX: RegExp = /^[A-Za-z][A-Za-z0-9_]{1,79}$/;

/*
 * An error the API answered with: its HTTP status and, when the body named
 * one, the API's own error code - what the connector's remediation and its
 * license and subscription handling read.
 */
export class MicrosoftEntraIdHttpError extends APIException {
  public statusCode: number;
  public apiCode: string;

  public constructor(message: string, statusCode: number, apiCode: string) {
    super(message);
    this.statusCode = statusCode;
    this.apiCode = apiCode;
  }
}

export interface MicrosoftEntraIdClientOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  cloud: MicrosoftEntraIdCloud;
  transport: ConnectorTransport;
  requestTimeoutInMs: number;
}

export interface MicrosoftEntraIdPage {
  records: Array<JSONObject>;
  // The @odata.nextLink of the page, or null on the last page.
  nextLink: string | null;
}

export interface Microsoft365Content {
  contentType: string;
  contentId: string;
  contentUri: string;
  contentCreated: string;
}

export interface Microsoft365ContentPage {
  contents: Array<Microsoft365Content>;
  // The NextPageUri header, or null on the last page.
  nextPageUri: string | null;
}

export interface Microsoft365Subscription {
  contentType: string;
  status: string;
}

export type MicrosoftEntraIdLog = "signIns" | "directoryAudits";

const LOG_PATHS: Record<MicrosoftEntraIdLog, string> = {
  signIns: "auditLogs/signIns",
  directoryAudits: "auditLogs/directoryAudits",
};

const LOG_TIME_FIELDS: Record<MicrosoftEntraIdLog, string> = {
  signIns: "createdDateTime",
  directoryAudits: "activityDateTime",
};

const LOG_STEPS: Record<MicrosoftEntraIdLog, string> = {
  signIns: "sign-ins request",
  directoryAudits: "audit logs request",
};

function isJsonObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export default class MicrosoftEntraIdClient {
  private tenantId: string;
  private clientId: string;
  private clientSecret: string;
  private cloud: MicrosoftEntraIdCloud;
  private transport: ConnectorTransport;
  private requestTimeoutInMs: number;
  private tokens: Map<
    MicrosoftEntraIdResource,
    { token: string; expiresAtMs: number }
  > = new Map();
  private requestCount: number = 0;

  public constructor(options: MicrosoftEntraIdClientOptions) {
    if (!MicrosoftEntraIdClient.isCloud(options.cloud)) {
      throw new BadDataException(
        `Cloud must be one of: ${MICROSOFT_ENTRA_ID_CLOUDS.join(", ")}.`,
      );
    }

    this.tenantId = options.tenantId;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.cloud = options.cloud;
    this.transport = options.transport;
    this.requestTimeoutInMs = options.requestTimeoutInMs;
  }

  public static isCloud(value: unknown): value is MicrosoftEntraIdCloud {
    return (
      typeof value === "string" &&
      (MICROSOFT_ENTRA_ID_CLOUDS as Array<string>).includes(value)
    );
  }

  public static hostsFor(cloud: MicrosoftEntraIdCloud): CloudHosts {
    return CLOUD_HOSTS[cloud];
  }

  // Every request that left this instance, token requests included.
  public getRequestCount(): number {
    return this.requestCount;
  }

  public buildTokenUrl(): string {
    return `${CLOUD_HOSTS[this.cloud].loginHost}/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`;
  }

  private resourceHost(resource: MicrosoftEntraIdResource): string {
    return resource === "graph"
      ? CLOUD_HOSTS[this.cloud].graphHost
      : CLOUD_HOSTS[this.cloud].manageHost;
  }

  /*
   * One page of a log over [startTime, endTime): Graph filters with ge and
   * le only, so the end is the last millisecond before it.
   */
  public buildLogUrl(data: {
    log: MicrosoftEntraIdLog;
    startTime: Date;
    endTime: Date;
    pageSize?: number | undefined;
  }): string {
    const field: string = LOG_TIME_FIELDS[data.log];
    const lastIncluded: Date = new Date(data.endTime.getTime() - 1);
    const url: URL = new URL(
      `${CLOUD_HOSTS[this.cloud].graphHost}/v1.0/${LOG_PATHS[data.log]}`,
    );

    url.searchParams.set(
      "$filter",
      `${field} ge ${data.startTime.toISOString()} and ${field} le ${lastIncluded.toISOString()}`,
    );
    url.searchParams.set(
      "$top",
      String(
        Math.max(
          1,
          Math.min(
            MICROSOFT_ENTRA_ID_PAGE_SIZE,
            Math.floor(data.pageSize || MICROSOFT_ENTRA_ID_PAGE_SIZE),
          ),
        ),
      ),
    );

    return url.toString();
  }

  public buildManagementUrl(path: string, query: Dictionary<string>): string {
    const url: URL = new URL(
      `${CLOUD_HOSTS[this.cloud].manageHost}/api/v1.0/${encodeURIComponent(this.tenantId)}/activity/feed/${path}`,
    );

    for (const key of Object.keys(query)) {
      url.searchParams.set(key, query[key]!);
    }

    /*
     * Requests that name a publisher share a throttling quota of their own
     * instead of the one every unnamed caller shares. The tenant's own id
     * gives each connected tenant its own.
     */
    url.searchParams.set("PublisherIdentifier", this.tenantId);

    return url.toString();
  }

  // The client credentials grant, a token per resource, cached for its life.
  public async getAccessToken(
    resource: MicrosoftEntraIdResource,
  ): Promise<string> {
    const cached: { token: string; expiresAtMs: number } | undefined =
      this.tokens.get(resource);

    if (cached && Date.now() < cached.expiresAtMs) {
      return cached.token;
    }

    const response: DataSourceHttpResponse = await this.send("token request", {
      method: "POST",
      url: this.buildTokenUrl(),
      headers: { Accept: "application/json" },
      body: {
        client_id: this.clientId,
        scope: `${this.resourceHost(resource)}/.default`,
        client_secret: this.clientSecret,
        grant_type: "client_credentials",
      },
      formUrlEncoded: true,
      timeoutInMs: this.requestTimeoutInMs,
      egressOptions: { targetLabel: "Microsoft Entra ID" },
      acceptAnyStatus: true,
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new MicrosoftEntraIdHttpError(
        `${ERROR_PREFIX} token request failed (HTTP ${response.statusCode}): ${this.redactErrorBody(response.bodyText)}${MicrosoftEntraIdClient.describeTokenFailure(response.statusCode, response.bodyJson)}`,
        response.statusCode,
        "",
      );
    }

    const json: JSONValue = MicrosoftEntraIdClient.parseJsonBody(response);
    const accessToken: unknown = isJsonObject(json)
      ? json["access_token"]
      : undefined;

    if (typeof accessToken !== "string" || !accessToken) {
      throw new APIException(
        `${ERROR_PREFIX} token request returned no access_token.`,
      );
    }

    const expiresIn: number = isJsonObject(json)
      ? Number(json["expires_in"])
      : NaN;
    const lifetimeMs: number =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? expiresIn * 1000
        : 5 * 60 * 1000;

    this.tokens.set(resource, {
      token: accessToken,
      expiresAtMs:
        Date.now() + Math.max(0, lifetimeMs - TOKEN_EXPIRY_SAFETY_MARGIN_IN_MS),
    });

    return accessToken;
  }

  public async listLog(data: {
    log: MicrosoftEntraIdLog;
    startTime: Date;
    endTime: Date;
    pageSize?: number | undefined;
  }): Promise<MicrosoftEntraIdPage> {
    return this.fetchGraphPage(data.log, this.buildLogUrl(data));
  }

  /*
   * Follow an @odata.nextLink: Graph hands back an absolute URL, which must
   * stay on the Graph host of the configured cloud.
   */
  public async listLogByNextLink(
    log: MicrosoftEntraIdLog,
    nextLink: string,
  ): Promise<MicrosoftEntraIdPage> {
    return this.fetchGraphPage(
      log,
      this.checkedUrl(nextLink, "graph", LOG_STEPS[log]),
    );
  }

  // The Microsoft 365 content types this app has subscribed to.
  public async listSubscriptions(): Promise<Array<Microsoft365Subscription>> {
    const json: JSONValue = await this.managementRequest(
      "subscriptions request",
      "GET",
      this.buildManagementUrl("subscriptions/list", {}),
    );

    if (!Array.isArray(json)) {
      return [];
    }

    return (json as JSONArray)
      .filter((item: JSONValue): boolean => {
        return isJsonObject(item);
      })
      .map((item: JSONValue): Microsoft365Subscription => {
        const subscription: JSONObject = item as JSONObject;

        return {
          contentType: String(subscription["contentType"] || ""),
          status: String(subscription["status"] || ""),
        };
      });
  }

  // Start reading a content type (the Management API's subscriptions/start).
  public async startSubscription(contentType: string): Promise<void> {
    await this.managementRequest(
      "subscription start",
      "POST",
      this.buildManagementUrl("subscriptions/start", { contentType }),
    );
  }

  // The content Microsoft made available in [startTime, endTime), at most a day.
  public async listContent(data: {
    contentType: string;
    startTime: Date;
    endTime: Date;
  }): Promise<Microsoft365ContentPage> {
    return this.fetchContentPage(
      this.buildManagementUrl("subscriptions/content", {
        contentType: data.contentType,
        startTime: MicrosoftEntraIdClient.managementTime(data.startTime),
        endTime: MicrosoftEntraIdClient.managementTime(data.endTime),
      }),
    );
  }

  public async listContentByNextPage(
    nextPageUri: string,
  ): Promise<Microsoft365ContentPage> {
    return this.fetchContentPage(
      this.checkedUrl(nextPageUri, "manage", "content request"),
    );
  }

  // The audit records of one content blob.
  public async fetchContent(contentUri: string): Promise<Array<JSONObject>> {
    const json: JSONValue = await this.managementRequest(
      "content blob request",
      "GET",
      this.checkedUrl(contentUri, "manage", "content blob request"),
    );

    if (!Array.isArray(json)) {
      throw new APIException(
        `${ERROR_PREFIX} content blob request returned an unrecognized response shape.`,
      );
    }

    return (json as JSONArray).filter((item: JSONValue): boolean => {
      return isJsonObject(item);
    }) as Array<JSONObject>;
  }

  // "2026-10-30T10:00:00" - the Management API's time, to the second, in UTC.
  public static managementTime(date: Date): string {
    return date.toISOString().slice(0, 19);
  }

  private checkedUrl(
    address: string,
    resource: MicrosoftEntraIdResource,
    step: string,
  ): string {
    let parsed: URL;

    try {
      parsed = new URL(address);
    } catch {
      throw new APIException(
        `${ERROR_PREFIX} ${step} returned an unusable link.`,
      );
    }

    const expectedHost: string = new URL(this.resourceHost(resource)).host;

    if (parsed.protocol !== "https:" || parsed.host !== expectedHost) {
      throw new APIException(
        `${ERROR_PREFIX} ${step} returned a link on an unexpected host: ${redactLogString(parsed.host)}`,
      );
    }

    return parsed.toString();
  }

  private async fetchGraphPage(
    log: MicrosoftEntraIdLog,
    url: string,
  ): Promise<MicrosoftEntraIdPage> {
    const json: JSONValue = await this.authorizedRequest(
      "graph",
      LOG_STEPS[log],
      "GET",
      url,
    );

    if (!isJsonObject(json) || !Array.isArray(json["value"])) {
      throw new APIException(
        `${ERROR_PREFIX} ${LOG_STEPS[log]} returned an unrecognized response shape.`,
      );
    }

    const nextLink: unknown = json["@odata.nextLink"];

    return {
      records: (json["value"] as JSONArray).filter(
        (item: JSONValue): boolean => {
          return isJsonObject(item);
        },
      ) as Array<JSONObject>,
      nextLink: typeof nextLink === "string" && nextLink ? nextLink : null,
    };
  }

  private async fetchContentPage(
    url: string,
  ): Promise<Microsoft365ContentPage> {
    const response: DataSourceHttpResponse = await this.authorizedResponse(
      "manage",
      "content request",
      "GET",
      url,
    );
    const json: JSONValue = MicrosoftEntraIdClient.parseJsonBody(response);

    if (!Array.isArray(json)) {
      throw new APIException(
        `${ERROR_PREFIX} content request returned an unrecognized response shape.`,
      );
    }

    const contents: Array<Microsoft365Content> = [];

    for (const item of json as JSONArray) {
      if (!isJsonObject(item)) {
        continue;
      }

      const contentUri: string = String(item["contentUri"] || "");

      if (!contentUri) {
        continue;
      }

      contents.push({
        contentType: String(item["contentType"] || ""),
        contentId: String(item["contentId"] || ""),
        contentUri,
        contentCreated: String(item["contentCreated"] || ""),
      });
    }

    const nextPageUri: string = (response.headers || {})["nextpageuri"] || "";

    return { contents, nextPageUri: nextPageUri || null };
  }

  private async managementRequest(
    step: string,
    method: "GET" | "POST",
    url: string,
  ): Promise<JSONValue> {
    const response: DataSourceHttpResponse = await this.authorizedResponse(
      "manage",
      step,
      method,
      url,
    );

    return MicrosoftEntraIdClient.parseJsonBody(response);
  }

  private async authorizedRequest(
    resource: MicrosoftEntraIdResource,
    step: string,
    method: "GET" | "POST",
    url: string,
  ): Promise<JSONValue> {
    return MicrosoftEntraIdClient.parseJsonBody(
      await this.authorizedResponse(resource, step, method, url),
    );
  }

  /*
   * One authorized request, answered with a 2xx response or thrown as a
   * MicrosoftEntraIdHttpError. A 401 retries once with a fresh token: a
   * token can be revoked or expire between pages.
   */
  private async authorizedResponse(
    resource: MicrosoftEntraIdResource,
    step: string,
    method: "GET" | "POST",
    url: string,
  ): Promise<DataSourceHttpResponse> {
    const request: () => Promise<DataSourceHttpResponse> =
      async (): Promise<DataSourceHttpResponse> => {
        const token: string = await this.getAccessToken(resource);

        return this.send(step, {
          method,
          url,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          // A subscription started with no webhook: an empty JSON object.
          ...(method === "POST" ? { body: {} } : {}),
          timeoutInMs: this.requestTimeoutInMs,
          egressOptions: {
            targetLabel:
              resource === "graph"
                ? "Microsoft Graph"
                : "Office 365 Management API",
          },
          acceptAnyStatus: true,
        });
      };

    let response: DataSourceHttpResponse = await request();

    if (response.statusCode === 401 && this.tokens.has(resource)) {
      this.tokens.delete(resource);
      response = await request();
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const apiCode: string = MicrosoftEntraIdClient.readApiErrorCode(
        response.bodyJson,
      );

      throw new MicrosoftEntraIdHttpError(
        `${ERROR_PREFIX} ${step} failed (HTTP ${response.statusCode}): ${this.redactErrorBody(response.bodyText)}${apiCode ? ` — error code ${apiCode}` : ""}`,
        response.statusCode,
        apiCode,
      );
    }

    return response;
  }

  // Every request leaves through here, counted; a transport failure is named.
  private async send(
    step: string,
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> {
    this.requestCount++;

    try {
      return await this.transport(request);
    } catch (error) {
      throw new APIException(
        `${ERROR_PREFIX} ${step} did not complete: ${redactLogString(
          ConnectorErrorMessage.toMessage(error, { truncate: false }),
        )}`,
      );
    }
  }

  private static parseJsonBody(response: DataSourceHttpResponse): JSONValue {
    if (response.bodyJson !== undefined) {
      return response.bodyJson as JSONValue;
    }

    try {
      return JSON.parse(response.bodyText || "") as JSONValue;
    } catch {
      return null;
    }
  }

  /*
   * Decoded before redacting, so an escaped secret cannot slip past the
   * redactor; the client secret and the tokens held are blanked by value
   * as well, wherever in the text a response echoed them.
   */
  private redactErrorBody(body: string): string {
    if (!body) {
      return "";
    }

    let text: string;

    try {
      text = JSON.stringify(redactLogValue(JSON.parse(body) as JSONValue));
    } catch {
      text = redactLogString(body);
    }

    const secrets: Array<string> = [
      this.clientSecret,
      ...Array.from(this.tokens.values()).map(
        (cached: { token: string }): string => {
          return cached.token;
        },
      ),
    ];

    for (const secret of secrets) {
      if (secret) {
        text = text.split(secret).join(REDACTED);
      }
    }

    return text.slice(0, 1000);
  }

  /*
   * The error code an API answered with: Graph's and the Management API's
   * { error: { code, message } }. The log redactor blanks every member
   * named "code" in the echoed body, so the code is read here, and kept
   * only when it is identifier-shaped - never a credential.
   */
  public static readApiErrorCode(body: unknown): string {
    if (!isJsonObject(body) || !isJsonObject(body["error"])) {
      return "";
    }

    const code: unknown = body["error"]["code"];

    return typeof code === "string" && ERROR_CODE_REGEX.test(code) ? code : "";
  }

  // What Entra's token error means, by its stable `error` and AADSTS codes.
  private static describeTokenFailure(status: number, body: unknown): string {
    const error: string = isJsonObject(body) ? String(body["error"] || "") : "";
    const codes: Array<number> =
      isJsonObject(body) && Array.isArray(body["error_codes"])
        ? (body["error_codes"] as JSONArray).map((code: JSONValue): number => {
            return Number(code);
          })
        : [];

    let hint: string = "";

    if (error === "invalid_client" || codes.includes(7000215)) {
      hint =
        "Microsoft Entra rejected the client secret. It is wrong, expired, or belongs to another app registration.";
    } else if (error === "unauthorized_client" || codes.includes(700016)) {
      hint =
        "Microsoft Entra did not find the Application (client) ID in this tenant.";
    } else if (codes.includes(90002) || error === "invalid_tenant") {
      hint = "Microsoft Entra did not find the tenant.";
    } else if (error === "invalid_scope") {
      hint = "Microsoft Entra refused the token scope for this cloud.";
    } else if (status === 429) {
      hint = "Microsoft Entra throttled the token request.";
    } else if (status >= 500) {
      hint = "Microsoft Entra reported a server-side error.";
    }

    return hint ? ` — ${hint}` : "";
  }
}
