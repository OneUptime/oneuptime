import APIException from "../../../../../Types/Exception/ApiException";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import Dictionary from "../../../../../Types/Dictionary";
import { DataSourceHttpResponse } from "../../../DataSource/HttpFetch";
import { redactLogString, redactLogValue } from "../../../LogRedaction";
import { ConnectorTransport } from "../Types";

/*
 * Minimal CrowdStrike Falcon API client for the alerts connector.
 *
 * Contract, verified against the public reference at
 * https://developer.crowdstrike.com/api-reference/collections/oauth2/ and
 * https://developer.crowdstrike.com/api-reference/collections/alerts/
 * (the falconpy.io Service-Collections pages redirect there):
 *
 *  - Auth: POST {base}/oauth2/token with form fields client_id and
 *    client_secret ("The API client ID/secret to authenticate your API
 *    requests"). Success is HTTP 201 ("Successfully issued token") with
 *    access_token, token_type and expires_in. The token is cached for its
 *    expires_in minus a safety margin.
 *  - GetQueriesAlertsV2: GET {base}/alerts/queries/alerts/v2 with query
 *    parameters filter (FQL), sort, limit ("default: 100; max: 10000") and
 *    offset ("Use with the offset parameter to manage pagination"), scope
 *    "Alerts: READ". Answers { resources: [composite_id...], meta: {
 *    pagination: { limit, offset, total } } }. The query index refuses
 *    limit + offset beyond 10,000 ("limit + offset must be less than
 *    10000" — CrowdStrike/falconpy discussions #536, #1146 and #1153).
 *  - PostEntitiesAlertsV2: POST {base}/alerts/entities/alerts/v2 with
 *    body { composite_ids: [...] } ("CompositeIDs represent the slice of
 *    Alert CompositeIDs that would be looked up"), scope "Alerts: READ",
 *    answers { resources: [alert...] }. falconpy documents 1000 ids per
 *    request as the maximum (github.com/CrowdStrike/falconpy/wiki/Alerts).
 *  - The Alerts reference lists created_timestamp among the "filter
 *    fields that supports range comparisons (>, <, >=, <=)" and advises
 *    to "sort only on the fields that do not change over time (Examples:
 *    created_timestamp, composite_id)" for consistent pagination.
 *  - A 429 carries X-RateLimit-RetryAfter (with X-RateLimit-Limit and
 *    X-RateLimit-Remaining) per the Falcon API rate limiting guidance;
 *    it is named in the error so the operator knows what Falcon asked.
 *
 * Every request goes through the injected ConnectorTransport, which is the
 * SSRF-guarded DataSourceHttpFetch in production and a fixture in tests.
 * That transport THROWS on non-2xx statuses ("Data source responded with
 * HTTP <status>: <body>") rather than returning them, so this client
 * normalizes both shapes back into a status + body before deciding what
 * to report.
 *
 * Error messages name the failing step in their prefix and are the
 * contract the integration doc's troubleshooting section is written
 * against; bodies are redacted before they enter a message and the
 * configured secret and any issued token are scrubbed on top of that.
 */

export type CrowdStrikeFalconCloud = "us-1" | "us-2" | "eu-1" | "us-gov-1";

/*
 * API hostnames per Falcon cloud. A mismatched cloud answers 403, which
 * reads like a permissions problem, so the connector names the cloud in
 * that remediation.
 */
export const CROWDSTRIKE_FALCON_CLOUD_BASE_URLS: Record<
  CrowdStrikeFalconCloud,
  string
> = {
  "us-1": "https://api.crowdstrike.com",
  "us-2": "https://api.us-2.crowdstrike.com",
  "eu-1": "https://api.eu-1.crowdstrike.com",
  "us-gov-1": "https://api.laggar.gcw.crowdstrike.com",
};

export function getCrowdStrikeFalconBaseUrl(cloud: string): string | null {
  const key: string = (cloud || "").trim().toLowerCase();

  if (
    Object.prototype.hasOwnProperty.call(
      CROWDSTRIKE_FALCON_CLOUD_BASE_URLS,
      key,
    )
  ) {
    return CROWDSTRIKE_FALCON_CLOUD_BASE_URLS[key as CrowdStrikeFalconCloud];
  }

  return null;
}

export const CROWDSTRIKE_FALCON_CLOUDS: Array<CrowdStrikeFalconCloud> = [
  "us-1",
  "us-2",
  "eu-1",
  "us-gov-1",
];

/*
 * The largest page the alerts query allows. Also used as the entity batch
 * size so one ids page maps to one entity request.
 */
export const CROWDSTRIKE_ALERTS_QUERY_MAX_LIMIT: number = 10000;
export const CROWDSTRIKE_ALERTS_PAGE_SIZE: number = 1000;
export const CROWDSTRIKE_ALERTS_ENTITY_BATCH_SIZE: number = 1000;
/*
 * limit + offset must not exceed this on the alerts query index. A window
 * with more alerts than this cannot be read completely by offset paging.
 */
export const CROWDSTRIKE_ALERTS_OFFSET_CEILING: number = 10000;
export const CROWDSTRIKE_ALERTS_DEFAULT_SORT: string = "created_timestamp.asc";

/*
 * Falcon tokens last 30 minutes; refresh a minute early so a token that
 * expires mid-page does not turn into a spurious 401.
 */
const TOKEN_EXPIRY_SLACK_IN_SECONDS: number = 60;
const DEFAULT_TOKEN_LIFETIME_IN_SECONDS: number = 1799;

/*
 * Error bodies are echoed for diagnosis but bounded: a WAF or gateway can
 * answer with a multi-megabyte HTML page.
 */
const MAX_ERROR_BODY_LENGTH: number = 2000;
const TRUNCATION_MARKER: string = "... (truncated)";

const RATE_LIMIT_RETRY_AFTER_HEADER: string = "x-ratelimit-retryafter";

/*
 * What DataSourceHttpFetch throws for a non-2xx status. The status and the
 * body are recovered from it so the caller sees one shape either way.
 */
const TRANSPORT_STATUS_ERROR_PATTERN: RegExp =
  /Data source responded with HTTP (\d{3})(?::\s?([\s\S]*))?$/;

const HTTP_STATUS_IN_MESSAGE_PATTERN: RegExp = /\(HTTP (\d{3})\)/;

export type CrowdStrikeFalconRequestStep =
  | "token request"
  | "alerts query"
  | "alerts fetch";

export interface CrowdStrikeFalconClientOptions {
  cloud: string;
  clientId: string;
  clientSecret: string;
  transport: ConnectorTransport;
  requestTimeoutInMs: number;
}

export interface CrowdStrikeAlertIdsPage {
  compositeIds: Array<string>;
  // meta.pagination.total, or null when Falcon did not report it.
  total: number | null;
  offset: number;
  limit: number;
}

export interface CrowdStrikeAlertCount {
  /*
   * meta.pagination.total for the filter when Falcon reported it, else the
   * number of ids the one-record probe page held (0 or 1).
   */
  count: number;
  // False when Falcon omitted the total and count is only the probe page.
  exact: boolean;
}

interface NormalizedResponse {
  statusCode: number;
  bodyText: string;
  bodyJson: unknown;
  headers: Dictionary<string>;
}

export default class CrowdStrikeFalconClient {
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private transport: ConnectorTransport;
  private requestTimeoutInMs: number;

  private cachedAccessToken: string | null = null;
  private cachedAccessTokenExpiresAtInMs: number = 0;
  private requestCount: number = 0;

  public constructor(options: CrowdStrikeFalconClientOptions) {
    const baseUrl: string | null = getCrowdStrikeFalconBaseUrl(options.cloud);

    if (!baseUrl) {
      throw new APIException(
        `CrowdStrike Falcon cloud "${redactLogString(String(options.cloud || ""))}" is not one of ${CROWDSTRIKE_FALCON_CLOUDS.join(", ")}.`,
      );
    }

    this.baseUrl = baseUrl;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.transport = options.transport;
    this.requestTimeoutInMs = options.requestTimeoutInMs;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  // Outbound requests issued so far, token requests included.
  public getRequestCount(): number {
    return this.requestCount;
  }

  /*
   * FQL for "created in [start, end)". Quoted RFC3339 timestamps and `+`
   * as the conjunction, per Falcon Query Language. The filter is passed
   * through URLSearchParams, which percent-encodes the `+` so Falcon does
   * not read it as a space.
   */
  public static buildCreatedTimestampFilter(start: Date, end: Date): string {
    return `created_timestamp:>='${start.toISOString()}'+created_timestamp:<'${end.toISOString()}'`;
  }

  public static parseHttpStatusFromMessage(message: string): number | null {
    const match: RegExpMatchArray | null = (message || "").match(
      HTTP_STATUS_IN_MESSAGE_PATTERN,
    );

    if (!match || !match[1]) {
      return null;
    }

    return Number(match[1]);
  }

  public async getAccessToken(): Promise<string> {
    if (
      this.cachedAccessToken &&
      Date.now() < this.cachedAccessTokenExpiresAtInMs
    ) {
      return this.cachedAccessToken;
    }

    const response: NormalizedResponse = await this.send("token request", {
      method: "POST",
      url: `${this.baseUrl}/oauth2/token`,
      headers: { Accept: "application/json" },
      body: { client_id: this.clientId, client_secret: this.clientSecret },
      formUrlEncoded: true,
    });

    // Falcon answers the token request with 201, not 200.
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new APIException(
        `CrowdStrike Falcon token request failed (HTTP ${response.statusCode}): ${this.describeErrorBody(response)}`,
      );
    }

    if (!this.isJsonObject(response.bodyJson)) {
      throw new APIException(
        "CrowdStrike Falcon token request returned a non-JSON body.",
      );
    }

    const accessToken: unknown = response.bodyJson["access_token"];

    if (typeof accessToken !== "string" || !accessToken) {
      throw new APIException(
        "CrowdStrike Falcon token request returned no access_token.",
      );
    }

    const expiresIn: unknown = response.bodyJson["expires_in"];
    const lifetimeInSeconds: number =
      typeof expiresIn === "number" &&
      Number.isFinite(expiresIn) &&
      expiresIn > 0
        ? expiresIn
        : DEFAULT_TOKEN_LIFETIME_IN_SECONDS;

    this.cachedAccessToken = accessToken;
    this.cachedAccessTokenExpiresAtInMs =
      Date.now() +
      Math.max(1, lifetimeInSeconds - TOKEN_EXPIRY_SLACK_IN_SECONDS) * 1000;

    return accessToken;
  }

  /*
   * GET /alerts/queries/alerts/v2 — one page of composite ids matching the
   * filter, sorted by creation time ascending so offset paging is stable.
   */
  public async queryAlertIds(data: {
    filter: string;
    limit: number;
    offset: number;
    sort?: string | undefined;
  }): Promise<CrowdStrikeAlertIdsPage> {
    if (data.limit < 1 || data.limit > CROWDSTRIKE_ALERTS_QUERY_MAX_LIMIT) {
      throw new APIException(
        `CrowdStrike Falcon alerts query limit must be between 1 and ${CROWDSTRIKE_ALERTS_QUERY_MAX_LIMIT}.`,
      );
    }

    if (data.offset < 0) {
      throw new APIException(
        "CrowdStrike Falcon alerts query offset must not be negative.",
      );
    }

    const params: URLSearchParams = new URLSearchParams();
    params.set("filter", data.filter);
    params.set("sort", data.sort || CROWDSTRIKE_ALERTS_DEFAULT_SORT);
    params.set("limit", String(data.limit));
    params.set("offset", String(data.offset));

    const response: NormalizedResponse = await this.sendAuthenticated(
      "alerts query",
      {
        method: "GET",
        url: `${this.baseUrl}/alerts/queries/alerts/v2?${params.toString()}`,
      },
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new APIException(
        `CrowdStrike Falcon alerts query failed (HTTP ${response.statusCode}): ${this.describeErrorBody(response)}`,
      );
    }

    if (!this.isJsonObject(response.bodyJson)) {
      throw new APIException(
        "CrowdStrike Falcon alerts query returned a non-JSON body.",
      );
    }

    const resources: unknown = response.bodyJson["resources"];

    /*
     * `resources` may be null on an empty result in some Falcon responses;
     * anything that is neither null nor an array is not this endpoint.
     */
    if (
      resources !== null &&
      resources !== undefined &&
      !Array.isArray(resources)
    ) {
      throw new APIException(
        `CrowdStrike Falcon alerts query returned an unrecognized response shape: ${this.summarizeBody(response.bodyJson)}`,
      );
    }

    const compositeIds: Array<string> = (
      Array.isArray(resources) ? resources : []
    )
      .filter((item: unknown): boolean => {
        return typeof item === "string" && item.length > 0;
      })
      .map((item: unknown): string => {
        return String(item);
      });

    const pagination: JSONObject | null = this.readPagination(
      response.bodyJson,
    );

    return {
      compositeIds,
      total: this.readCount(pagination, "total"),
      offset: this.readCount(pagination, "offset") ?? data.offset,
      limit: this.readCount(pagination, "limit") ?? data.limit,
    };
  }

  /*
   * How many alerts Falcon created in [start, end): one request with
   * limit=1, reading meta.pagination.total. Bounded by construction — the
   * count is Falcon's, not a page walk — which is what the availability
   * check needs for a 7-day window on a busy tenant.
   */
  public async countAlertsCreatedBetween(data: {
    startTime: Date;
    endTime: Date;
  }): Promise<CrowdStrikeAlertCount> {
    const page: CrowdStrikeAlertIdsPage = await this.queryAlertIds({
      filter: CrowdStrikeFalconClient.buildCreatedTimestampFilter(
        data.startTime,
        data.endTime,
      ),
      limit: 1,
      offset: 0,
    });

    if (page.total !== null) {
      return { count: page.total, exact: true };
    }

    return { count: page.compositeIds.length, exact: false };
  }

  /*
   * POST /alerts/entities/alerts/v2 — full alert entities for up to one
   * batch of composite ids. Batching is the caller's job so it can count
   * requests against its budget.
   */
  public async getAlerts(
    compositeIds: Array<string>,
  ): Promise<Array<JSONObject>> {
    if (!compositeIds.length) {
      return [];
    }

    if (compositeIds.length > CROWDSTRIKE_ALERTS_ENTITY_BATCH_SIZE) {
      throw new APIException(
        `CrowdStrike Falcon alerts fetch accepts at most ${CROWDSTRIKE_ALERTS_ENTITY_BATCH_SIZE} composite ids per request.`,
      );
    }

    const response: NormalizedResponse = await this.sendAuthenticated(
      "alerts fetch",
      {
        method: "POST",
        url: `${this.baseUrl}/alerts/entities/alerts/v2`,
        body: JSON.stringify({ composite_ids: compositeIds }),
      },
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new APIException(
        `CrowdStrike Falcon alerts fetch failed (HTTP ${response.statusCode}): ${this.describeErrorBody(response)}`,
      );
    }

    if (!this.isJsonObject(response.bodyJson)) {
      throw new APIException(
        "CrowdStrike Falcon alerts fetch returned a non-JSON body.",
      );
    }

    const resources: unknown = response.bodyJson["resources"];

    if (
      resources !== null &&
      resources !== undefined &&
      !Array.isArray(resources)
    ) {
      throw new APIException(
        `CrowdStrike Falcon alerts fetch returned an unrecognized response shape: ${this.summarizeBody(response.bodyJson)}`,
      );
    }

    return (Array.isArray(resources) ? resources : []).filter(
      (item: unknown): item is JSONObject => {
        return this.isJsonObject(item);
      },
    );
  }

  /*
   * Authenticated call with one retry on 401 when the token came from the
   * cache: a token revoked mid-run (client secret rotated in Falcon) should
   * cost one extra request, not a failed poll.
   */
  private async sendAuthenticated(
    step: CrowdStrikeFalconRequestStep,
    request: {
      method: "GET" | "POST";
      url: string;
      body?: string | undefined;
    },
  ): Promise<NormalizedResponse> {
    const hadCachedToken: boolean = Boolean(this.cachedAccessToken);
    const token: string = await this.getAccessToken();

    const response: NormalizedResponse = await this.send(step, {
      method: request.method,
      url: request.url,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(request.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: request.body,
    });

    if (response.statusCode !== 401 || !hadCachedToken) {
      return response;
    }

    this.cachedAccessToken = null;
    this.cachedAccessTokenExpiresAtInMs = 0;
    const freshToken: string = await this.getAccessToken();

    return this.send(step, {
      method: request.method,
      url: request.url,
      headers: {
        Authorization: `Bearer ${freshToken}`,
        Accept: "application/json",
        ...(request.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: request.body,
    });
  }

  /*
   * The one place a request leaves this class. Applies the timeout, counts
   * the request, and folds the transport's thrown non-2xx errors back into
   * a response so every caller sees status + body.
   */
  private async send(
    step: CrowdStrikeFalconRequestStep,
    request: {
      method: "GET" | "POST";
      url: string;
      headers?: Dictionary<string> | undefined;
      body?: string | Dictionary<string> | undefined;
      formUrlEncoded?: boolean | undefined;
    },
  ): Promise<NormalizedResponse> {
    this.requestCount++;

    let response: DataSourceHttpResponse;

    try {
      response = await this.transport({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body,
        formUrlEncoded: request.formUrlEncoded,
        timeoutInMs: this.requestTimeoutInMs,
      });
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      const match: RegExpMatchArray | null = message.match(
        TRANSPORT_STATUS_ERROR_PATTERN,
      );

      if (match && match[1]) {
        const bodyText: string = match[2] || "";
        return {
          statusCode: Number(match[1]),
          bodyText,
          bodyJson: this.tryParseJson(bodyText),
          headers: {},
        };
      }

      /*
       * Timeouts, DNS failures, egress-guard refusals: nothing came back,
       * so no status is claimed. The transport's own wording ("timeout of
       * 20000ms exceeded") is kept, redacted.
       */
      throw new APIException(
        `CrowdStrike Falcon ${step} could not be completed: ${this.scrubSecrets(redactLogString(message))}`,
      );
    }

    const headers: Dictionary<string> = {};

    for (const key of Object.keys(response.headers || {})) {
      headers[key.toLowerCase()] = String(
        (response.headers as Dictionary<string>)[key],
      );
    }

    return {
      statusCode: response.statusCode,
      bodyText: response.bodyText || "",
      bodyJson:
        response.bodyJson !== undefined
          ? response.bodyJson
          : this.tryParseJson(response.bodyText || ""),
      headers,
    };
  }

  /*
   * The echoed error body: JSON is redacted structurally (so a
   * `client_secret` member is replaced whatever its value), text is
   * redacted textually, both are bounded, and a 429 names the
   * X-RateLimit-RetryAfter header so the operator knows what Falcon asked.
   */
  private describeErrorBody(response: NormalizedResponse): string {
    let body: string;

    if (response.bodyJson !== undefined) {
      body = JSON.stringify(redactLogValue(response.bodyJson as JSONValue));
    } else {
      body = redactLogString(response.bodyText || "");
    }

    body = this.scrubSecrets(body || "(empty body)");

    if (body.length > MAX_ERROR_BODY_LENGTH) {
      body = `${body.slice(0, MAX_ERROR_BODY_LENGTH - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
    }

    if (response.statusCode === 429) {
      const retryAfter: string | undefined =
        response.headers[RATE_LIMIT_RETRY_AFTER_HEADER];

      return retryAfter
        ? `${body}; Falcon rate limited the request, X-RateLimit-RetryAfter: ${redactLogString(retryAfter)}`
        : `${body}; Falcon rate limited the request and the X-RateLimit-RetryAfter header was not available`;
    }

    return body;
  }

  private summarizeBody(bodyJson: unknown): string {
    let summary: string = "";

    try {
      summary = JSON.stringify(redactLogValue(bodyJson as JSONValue)) || "";
    } catch {
      summary = "(unserializable body)";
    }

    summary = this.scrubSecrets(summary);

    if (summary.length > MAX_ERROR_BODY_LENGTH) {
      summary = `${summary.slice(0, MAX_ERROR_BODY_LENGTH - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
    }

    return summary;
  }

  /*
   * Belt and braces behind the generic redactor: the values this client
   * KNOWS are secrets are removed by literal match wherever they appear.
   */
  private scrubSecrets(text: string): string {
    let scrubbed: string = text;

    for (const secret of [this.clientSecret, this.cachedAccessToken]) {
      if (secret && secret.length >= 4) {
        scrubbed = scrubbed.split(secret).join("[REDACTED]");
      }
    }

    return scrubbed;
  }

  private readPagination(bodyJson: JSONObject): JSONObject | null {
    const meta: unknown = bodyJson["meta"];

    if (!this.isJsonObject(meta)) {
      return null;
    }

    const pagination: unknown = meta["pagination"];

    return this.isJsonObject(pagination) ? pagination : null;
  }

  private readCount(pagination: JSONObject | null, key: string): number | null {
    if (!pagination) {
      return null;
    }

    const value: unknown = pagination[key];

    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }

    if (typeof value === "string" && value.trim() !== "") {
      const parsed: number = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }

    return null;
  }

  private tryParseJson(text: string): unknown {
    if (!text) {
      return undefined;
    }

    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  private isJsonObject(value: unknown): value is JSONObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
