import APIException from "../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONArray, JSONObject, JSONValue } from "../../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import { redactLogString, redactLogValue } from "../../../LogRedaction";
import ConnectorErrorMessage from "../../ConnectorErrorMessage";
import { ConnectorTransport } from "../Types";

/*
 * Microsoft Graph security API client for Microsoft Defender XDR alerts.
 *
 * Two endpoints, both verified against Microsoft's reference pages:
 *
 *  - Token: Entra ID client credentials grant,
 *    POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token with
 *    a form body of client_id / scope / client_secret / grant_type
 *    (https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow).
 *    The scope for Graph is `https://graph.microsoft.com/.default`
 *    (`https://graph.microsoft.us/.default` in Azure US Government, per
 *    https://learn.microsoft.com/en-us/graph/deployments).
 *
 *  - Alerts: GET {graph}/v1.0/security/alerts_v2
 *    (https://learn.microsoft.com/en-us/graph/api/security-list-alerts_v2).
 *    The reference documents `$count`, `$filter`, `$skip`, `$top` and
 *    `@odata.nextLink` for paging, and names createdDateTime among the
 *    filterable properties. It does NOT document `$orderby`, so this
 *    client never sends one: the poller reads the whole window across
 *    pages and holds its cursor when a bound stops it, so record order
 *    within the window is irrelevant to correctness.
 *
 * Every request goes through the injected ConnectorTransport (the
 * SSRF-guarded DataSourceHttpFetch in production). Errors are thrown as
 * APIException with a prefix naming the step, and any echoed body is run
 * through the log redactor first so a credential can never ride an error
 * message into lastError or a log sink.
 */

export type MicrosoftDefenderXdrCloud = "public" | "usgov";

export const MICROSOFT_DEFENDER_XDR_CLOUDS: Array<MicrosoftDefenderXdrCloud> = [
  "public",
  "usgov",
];

interface CloudHosts {
  loginHost: string;
  graphHost: string;
}

/*
 * Host pairs per national cloud. GCC High tenants use graph.microsoft.us
 * with login.microsoftonline.us; GCC (moderate) tenants stay on the
 * worldwide endpoints, so they select "public".
 */
const CLOUD_HOSTS: Record<MicrosoftDefenderXdrCloud, CloudHosts> = {
  public: {
    loginHost: "https://login.microsoftonline.com",
    graphHost: "https://graph.microsoft.com",
  },
  usgov: {
    loginHost: "https://login.microsoftonline.us",
    graphHost: "https://graph.microsoft.us",
  },
};

/*
 * Microsoft's own List alerts_v2 example pages with `$top=100`; a larger
 * page is not documented, so requests never exceed it. The tester asks
 * for a single record.
 */
export const MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE: number = 100;

/*
 * Tokens carry expires_in (seconds). A token that expires mid-page is
 * refreshed a minute early rather than risking a 401 halfway through a
 * window read.
 */
const TOKEN_EXPIRY_SAFETY_MARGIN_IN_MS: number = 60 * 1000;

const ERROR_PREFIX: string = "Microsoft Defender XDR";

/*
 * Graph error codes are identifier-shaped enumeration names
 * (Authorization_RequestDenied, InvalidAuthenticationToken, ...). Anything
 * else under that key — digits, punctuation, length — is not one.
 */
const GRAPH_ERROR_CODE_REGEX: RegExp = /^[A-Za-z][A-Za-z_]{1,79}$/;

export interface MicrosoftDefenderXdrClientOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  cloud: MicrosoftDefenderXdrCloud;
  transport: ConnectorTransport;
  requestTimeoutInMs: number;
}

export interface MicrosoftDefenderXdrAlertsPage {
  alerts: Array<JSONObject>;
  // The @odata.nextLink of the page, or null when this was the last page.
  nextLink: string | null;
}

export interface MicrosoftDefenderXdrAlertCount {
  // Records on the first page of the range (at most one page is read).
  count: number;
  // True when the response carried a nextLink, i.e. the count is a floor.
  hasMore: boolean;
}

export default class MicrosoftDefenderXdrClient {
  private tenantId: string;
  private clientId: string;
  private clientSecret: string;
  private cloud: MicrosoftDefenderXdrCloud;
  private transport: ConnectorTransport;
  private requestTimeoutInMs: number;

  private cachedToken: string | null = null;
  private cachedTokenExpiresAtMs: number = 0;
  private requestCount: number = 0;

  public constructor(options: MicrosoftDefenderXdrClientOptions) {
    if (!MicrosoftDefenderXdrClient.isCloud(options.cloud)) {
      throw new BadDataException(
        `Cloud must be one of: ${MICROSOFT_DEFENDER_XDR_CLOUDS.join(", ")}.`,
      );
    }

    this.tenantId = options.tenantId;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.cloud = options.cloud;
    this.transport = options.transport;
    this.requestTimeoutInMs = options.requestTimeoutInMs;
  }

  public static isCloud(value: unknown): value is MicrosoftDefenderXdrCloud {
    return (
      typeof value === "string" &&
      (MICROSOFT_DEFENDER_XDR_CLOUDS as Array<string>).includes(value)
    );
  }

  public static loginHostForCloud(cloud: MicrosoftDefenderXdrCloud): string {
    return CLOUD_HOSTS[cloud].loginHost;
  }

  public static graphHostForCloud(cloud: MicrosoftDefenderXdrCloud): string {
    return CLOUD_HOSTS[cloud].graphHost;
  }

  /*
   * Outbound requests made so far by this instance, token requests
   * included: the poller's request budget counts every call that leaves
   * the process.
   */
  public getRequestCount(): number {
    return this.requestCount;
  }

  public buildTokenUrl(): string {
    return `${MicrosoftDefenderXdrClient.loginHostForCloud(this.cloud)}/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`;
  }

  public buildScope(): string {
    return `${MicrosoftDefenderXdrClient.graphHostForCloud(this.cloud)}/.default`;
  }

  /*
   * Creation-time window on createdDateTime: inclusive lower bound,
   * exclusive upper bound, matching ConnectorFetchWindow. OData datetime
   * literals are unquoted ISO 8601; URLSearchParams encodes the spaces as
   * "+", which Graph's own reference examples use between filter tokens.
   */
  public buildAlertsUrl(data: {
    startTime: Date;
    endTime: Date;
    pageSize?: number | undefined;
  }): string {
    const url: URL = new URL(
      `${MicrosoftDefenderXdrClient.graphHostForCloud(this.cloud)}/v1.0/security/alerts_v2`,
    );

    url.searchParams.set(
      "$filter",
      `createdDateTime ge ${data.startTime.toISOString()} and createdDateTime lt ${data.endTime.toISOString()}`,
    );
    url.searchParams.set(
      "$top",
      String(MicrosoftDefenderXdrClient.clampPageSize(data.pageSize)),
    );

    return url.toString();
  }

  public static clampPageSize(pageSize: number | undefined): number {
    if (pageSize === undefined || !Number.isFinite(pageSize) || pageSize < 1) {
      return MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE;
    }

    return Math.min(
      Math.floor(pageSize),
      MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE,
    );
  }

  /*
   * Client credentials grant. The token is cached on the instance for its
   * lifetime minus a safety margin; connectors build one client per
   * fetch or test, so the cache never outlives the settings it was
   * minted from.
   */
  public async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedTokenExpiresAtMs) {
      return this.cachedToken;
    }

    const body: Dictionary<string> = {
      client_id: this.clientId,
      scope: this.buildScope(),
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
    };

    const response: DataSourceHttpResponse = await this.send("token request", {
      method: "POST",
      url: this.buildTokenUrl(),
      headers: { Accept: "application/json" },
      body,
      formUrlEncoded: true,
      timeoutInMs: this.requestTimeoutInMs,
      egressOptions: { targetLabel: "Microsoft Entra ID" },
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new APIException(
        `${ERROR_PREFIX} token request failed (HTTP ${response.statusCode}): ${MicrosoftDefenderXdrClient.redactErrorBody(response.bodyText)}` +
          MicrosoftDefenderXdrClient.describeTokenFailure(
            response.statusCode,
            response.bodyJson,
          ),
      );
    }

    const json: JSONValue = MicrosoftDefenderXdrClient.parseJsonBody(response);

    if (!MicrosoftDefenderXdrClient.isJsonObject(json)) {
      throw new APIException(
        `${ERROR_PREFIX} token request returned a non-JSON body.`,
      );
    }

    const accessToken: JSONValue = json["access_token"] as JSONValue;

    if (typeof accessToken !== "string" || !accessToken) {
      throw new APIException(
        `${ERROR_PREFIX} token request returned no access_token.`,
      );
    }

    const expiresIn: number = Number(json["expires_in"]);
    const lifetimeMs: number =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? expiresIn * 1000
        : 5 * 60 * 1000;

    this.cachedToken = accessToken;
    this.cachedTokenExpiresAtMs =
      Date.now() + Math.max(0, lifetimeMs - TOKEN_EXPIRY_SAFETY_MARGIN_IN_MS);

    return accessToken;
  }

  /*
   * First page of alerts created in [startTime, endTime).
   */
  public async listAlerts(data: {
    startTime: Date;
    endTime: Date;
    pageSize?: number | undefined;
  }): Promise<MicrosoftDefenderXdrAlertsPage> {
    return this.fetchAlertsPage(this.buildAlertsUrl(data));
  }

  /*
   * Follow an @odata.nextLink. Graph hands back an absolute URL; it must
   * stay on the Graph host of the configured cloud, otherwise a bearer
   * token for Graph would be sent wherever the body pointed.
   */
  public async listAlertsByNextLink(
    nextLink: string,
  ): Promise<MicrosoftDefenderXdrAlertsPage> {
    let parsed: URL;

    try {
      parsed = new URL(nextLink);
    } catch {
      throw new APIException(
        `${ERROR_PREFIX} alerts request returned an unusable next page link.`,
      );
    }

    const expectedHost: string = new URL(
      MicrosoftDefenderXdrClient.graphHostForCloud(this.cloud),
    ).host;

    if (parsed.protocol !== "https:" || parsed.host !== expectedHost) {
      throw new APIException(
        `${ERROR_PREFIX} alerts request returned a next page link on an unexpected host: ${redactLogString(parsed.host)}`,
      );
    }

    return this.fetchAlertsPage(parsed.toString());
  }

  /*
   * How many alerts were created in the range, bounded to one page:
   * `hasMore` says the count is a floor ("100+"), never a total.
   */
  public async countAlerts(data: {
    startTime: Date;
    endTime: Date;
  }): Promise<MicrosoftDefenderXdrAlertCount> {
    const page: MicrosoftDefenderXdrAlertsPage = await this.listAlerts({
      startTime: data.startTime,
      endTime: data.endTime,
      pageSize: MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE,
    });

    return { count: page.alerts.length, hasMore: page.nextLink !== null };
  }

  private async fetchAlertsPage(
    url: string,
  ): Promise<MicrosoftDefenderXdrAlertsPage> {
    let response: DataSourceHttpResponse = await this.sendAuthorized(url);

    /*
     * A cached token can be revoked or expire between pages. One retry
     * with a fresh token separates "the token went stale" from "this app
     * is not accepted", the way GoogleSecOpsClient does.
     */
    if (response.statusCode === 401 && this.cachedToken) {
      this.cachedToken = null;
      this.cachedTokenExpiresAtMs = 0;
      response = await this.sendAuthorized(url);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new APIException(
        `${ERROR_PREFIX} alerts request failed (HTTP ${response.statusCode}): ${MicrosoftDefenderXdrClient.redactErrorBody(response.bodyText)}` +
          MicrosoftDefenderXdrClient.describeAlertsFailure(
            response.statusCode,
            response,
          ),
      );
    }

    const json: JSONValue = MicrosoftDefenderXdrClient.parseJsonBody(response);

    if (!MicrosoftDefenderXdrClient.isJsonObject(json)) {
      throw new APIException(
        `${ERROR_PREFIX} alerts request returned a non-JSON body.`,
      );
    }

    const value: JSONValue = json["value"] as JSONValue;

    if (!Array.isArray(value)) {
      throw new APIException(
        `${ERROR_PREFIX} alerts request returned an unrecognized response shape: ${MicrosoftDefenderXdrClient.redactErrorBody(response.bodyText)}`,
      );
    }

    const alerts: Array<JSONObject> = (value as JSONArray).filter(
      (item: JSONValue): boolean => {
        return MicrosoftDefenderXdrClient.isJsonObject(item);
      },
    ) as Array<JSONObject>;

    const nextLink: JSONValue = json["@odata.nextLink"] as JSONValue;

    return {
      alerts,
      nextLink: typeof nextLink === "string" && nextLink ? nextLink : null,
    };
  }

  private async sendAuthorized(url: string): Promise<DataSourceHttpResponse> {
    const token: string = await this.getAccessToken();

    return this.send("alerts request", {
      method: "GET",
      url,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      timeoutInMs: this.requestTimeoutInMs,
      egressOptions: { targetLabel: "Microsoft Graph" },
    });
  }

  /*
   * One place every request leaves through. DataSourceHttpFetch throws
   * BadDataException("Data source responded with HTTP <status>: <body>")
   * for any non-2xx answer, so that shape is folded back into a response
   * here and the status-specific messages above stay the only ones an
   * operator sees. Anything else (timeout, DNS, refused egress) is a
   * transport failure named as such.
   */
  private async send(
    step: string,
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> {
    this.requestCount++;

    try {
      return await this.transport(request);
    } catch (error) {
      const message: string = ConnectorErrorMessage.toMessage(error, {
        truncate: false,
      });
      const match: RegExpMatchArray | null = message.match(
        /^Data source responded with HTTP (\d{3}): ?([\s\S]*)$/,
      );

      if (match) {
        const bodyText: string = match[2] || "";
        let bodyJson: unknown = undefined;

        try {
          bodyJson = JSON.parse(bodyText);
        } catch {
          bodyJson = undefined;
        }

        return {
          statusCode: Number(match[1]),
          bodyText,
          bodyJson,
          headers: {},
        };
      }

      throw new APIException(
        `${ERROR_PREFIX} ${step} did not complete: ${redactLogString(message)}`,
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

  private static isJsonObject(value: unknown): value is JSONObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /*
   * Decode the outer JSON before redacting so a credential-bearing string
   * nested inside a message cannot slip past the textual redactor via
   * escaped quotes.
   */
  private static redactErrorBody(body: string): string {
    if (!body) {
      return "";
    }

    try {
      return JSON.stringify(redactLogValue(JSON.parse(body) as JSONValue));
    } catch {
      return redactLogString(body);
    }
  }

  /*
   * Entra's error body is { error, error_description, error_codes }. The
   * `error` code is the stable field, so hints key off it; the AADSTS
   * text is dynamic and only echoed (redacted) above.
   */
  private static describeTokenFailure(status: number, body: unknown): string {
    const error: string = MicrosoftDefenderXdrClient.isJsonObject(body)
      ? String(body["error"] || "")
      : "";
    const codes: Array<number> =
      MicrosoftDefenderXdrClient.isJsonObject(body) &&
      Array.isArray(body["error_codes"])
        ? (body["error_codes"] as JSONArray).map((code: JSONValue): number => {
            return Number(code);
          })
        : [];

    let hint: string = "";

    if (error === "invalid_client" || codes.includes(7000215)) {
      hint =
        "Microsoft Entra rejected the client secret. It is wrong, expired, or belongs to a different app registration; create a new secret under Certificates & secrets and update the connection's credentials.";
    } else if (error === "unauthorized_client" || codes.includes(700016)) {
      hint =
        "Microsoft Entra did not find the Application (client) ID in this tenant. Check the Directory (tenant) ID and Application (client) ID, and that the Cloud matches where the tenant lives.";
    } else if (error === "invalid_request" && codes.includes(90002)) {
      hint =
        "Microsoft Entra did not find the tenant. Check the Directory (tenant) ID and the Cloud setting.";
    } else if (error === "invalid_scope") {
      hint =
        "Microsoft Entra rejected the token scope for Microsoft Graph in this cloud. Check the Cloud setting.";
    } else if (status === 429) {
      hint =
        "Microsoft Entra throttled the token request. The next poll retries automatically.";
    } else if (status >= 500) {
      hint =
        "Microsoft Entra reported a server-side error. The next poll retries the same window.";
    } else if (status === 404) {
      hint =
        "The token endpoint was not found. The Directory (tenant) ID is usually malformed.";
    }

    return hint ? ` — ${hint}` : "";
  }

  /*
   * Graph's error body is { error: { code, message } }
   * (https://learn.microsoft.com/en-us/graph/errors); a 403 with any code
   * is nearly always the missing application permission or a tenant
   * without Defender XDR, and that is the case the docs troubleshoot.
   *
   * The redactor blanks every JSON member named "code" (an OAuth
   * authorization code or an OTP lives under that key elsewhere), which
   * also blanks Graph's error code in the echoed body. That code is a
   * documented enumeration name such as Authorization_RequestDenied or
   * InvalidAuthenticationToken — letters and underscores, never a
   * credential — so it is restated in the hint when, and only when, it
   * has that shape.
   */
  private static describeAlertsFailure(
    status: number,
    response: DataSourceHttpResponse,
  ): string {
    let hint: string = "";
    const graphCode: string = MicrosoftDefenderXdrClient.readGraphErrorCode(
      response.bodyJson,
    );

    if (graphCode) {
      hint = `Microsoft Graph error code ${graphCode}. `;
    }

    if (status === 401) {
      hint +=
        "Microsoft Graph did not accept the access token. Check that the Cloud setting matches the tenant and that the app registration has not been disabled.";
    } else if (status === 403) {
      hint +=
        "The app registration lacks the SecurityAlert.Read.All application permission for Microsoft Graph with admin consent, or the tenant has no Microsoft Defender XDR license.";
    } else if (status === 404) {
      hint +=
        "Microsoft Graph did not find the security alerts endpoint. Check the Cloud setting.";
    } else if (status === 429) {
      const retryAfter: string = (response.headers || {})["retry-after"] || "";
      hint += retryAfter
        ? `Microsoft Graph throttled the request; it asked to retry after ${redactLogString(retryAfter)} seconds. The next poll retries the same window.`
        : "Microsoft Graph throttled the request. The next poll retries the same window.";
    } else if (status >= 500) {
      hint +=
        "Microsoft Graph reported a server-side error. The next poll retries the same window.";
    } else if (status === 400) {
      hint +=
        "Microsoft Graph rejected the query. Copy the message for support; the request is built by OneUptime, not from your settings.";
    }

    hint = hint.trim();

    return hint ? ` — ${hint}` : "";
  }

  private static readGraphErrorCode(body: unknown): string {
    if (!MicrosoftDefenderXdrClient.isJsonObject(body)) {
      return "";
    }

    const error: unknown = body["error"];

    if (!MicrosoftDefenderXdrClient.isJsonObject(error)) {
      return "";
    }

    const code: unknown = error["code"];

    if (typeof code !== "string" || !GRAPH_ERROR_CODE_REGEX.test(code)) {
      return "";
    }

    return code;
  }
}
