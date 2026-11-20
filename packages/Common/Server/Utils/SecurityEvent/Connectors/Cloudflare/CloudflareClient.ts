import APIException from "../../../../../Types/Exception/ApiException";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONArray, JSONObject, JSONValue } from "../../../../../Types/JSON";
import RetryAfter from "../../../../../Utils/RetryAfter";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import DataSourceHttpRetry, {
  HttpRetryExchange,
  HttpRetryReason,
  HttpRetryVerdict,
} from "../../../DataSource/HttpRetry";
import { REDACTED, redactLogString, redactLogValue } from "../../../LogRedaction";
import { ConnectorTransport } from "../Types";

/*
 * Minimal Cloudflare API client for the Cloudflare connection: it reads,
 * and never writes.
 *
 * Two APIs, one token (an API token sent as `Authorization: Bearer`,
 * https://developers.cloudflare.com/fundamentals/api/get-started/create-token/):
 *
 *  - The REST API at https://api.cloudflare.com/client/v4, for the token
 *    and the zones:
 *      GET /user/tokens/verify, and GET /accounts/{id}/tokens/verify for a
 *        token the account owns: whether the token is active, and when it
 *        expires;
 *      GET /zones?account.id=&page=&per_page=: the zones the token reads,
 *        each with its account and plan (Zone > Zone > Read). The accounts
 *        the connection form offers are the accounts of those zones, so no
 *        account permission is needed to pick one.
 *    Every answer is the v4 envelope { success, errors: [{ code, message }],
 *    result, result_info: { page, total_pages } }.
 *
 *  - The GraphQL Analytics API at POST /client/v4/graphql, for the
 *    firewall events (Zone > Analytics > Read): the zone-scoped
 *    firewallEventsAdaptive dataset, and its settings node, which says what
 *    the zone's plan allows - whether the dataset is there at all, the
 *    widest window and largest page one query may ask for, how far back
 *    it reaches and which fields it has
 *    (https://developers.cloudflare.com/analytics/graphql-api/features/discovery/settings/).
 *    The API has no cursors (features/pagination): a page after the first
 *    is the rows after the last one read, by the sort order. Rows are
 *    sorted by datetime, then Ray ID, then the rule's place in the chain,
 *    which together name one row, so "after" is exact even when hundreds
 *    of rows share a second. A GraphQL answer can be a 200 that holds
 *    errors (graphql-api/errors), so the body is always read for them.
 *
 * Limits (fundamentals/api/reference/limits, analytics/graphql-api/limits):
 * 1,200 REST requests and 300 GraphQL queries in five minutes. A 429 is
 * asked again after its Retry-After when that is a short wait
 * (DataSourceHttpRetry: at most 30 seconds, a minute in all); a longer one,
 * and GraphQL's "rate limiter budget depleted, try again after 5 minutes",
 * is thrown as RateLimited for the connector to stop on and the next poll
 * to pick up. A 503 ("too many queries in progress") is asked again after
 * a short backoff.
 *
 * Every failure is a CloudflareApiError with a kind the connector words its
 * remediation by, and its message never holds the token.
 */

export const CLOUDFLARE_API_BASE_URL: string =
  "https://api.cloudflare.com/client/v4";

// The most zones one REST page lists (the API's own maximum is 50).
export const CLOUDFLARE_ZONES_PER_PAGE: number = 50;

// The most zones one GraphQL query names (analytics/graphql-api/limits).
export const CLOUDFLARE_ZONES_PER_QUERY: number = 10;

// Read when the settings node does not say: the dataset's documented defaults.
export const CLOUDFLARE_DEFAULT_MAX_PAGE_SIZE: number = 10000;
export const CLOUDFLARE_DEFAULT_MAX_FIELDS: number = 30;

/*
 * The most rows one page asks for, whatever the plan allows: a row is about
 * a kilobyte with its user agent, and the transport accepts 20 MB at most.
 */
export const CLOUDFLARE_MAX_ROWS_PER_PAGE: number = 2000;

export const CLOUDFLARE_FIREWALL_EVENTS_DATASET: string =
  "firewallEventsAdaptive";

/*
 * The fields read for each firewall event, most needed first: a plan whose
 * settings allow fewer fields per query, or do not list one of them, gets
 * the first ones it allows. The first group is what a security event cannot
 * do without (when, which request, what acted, what it did, who sent it).
 */
export const CLOUDFLARE_REQUIRED_EVENT_FIELDS: ReadonlyArray<string> = [
  "datetime",
  "rayName",
  "matchIndex",
  "action",
  "source",
  "ruleId",
  "clientIP",
  "clientRequestHTTPHost",
  "clientRequestHTTPMethodName",
  "clientRequestPath",
  "clientRequestQuery",
  "userAgent",
  "sampleInterval",
];

export const CLOUDFLARE_OPTIONAL_EVENT_FIELDS: ReadonlyArray<string> = [
  "clientCountryName",
  "clientAsn",
  "description",
  "edgeResponseStatus",
  "originResponseStatus",
  "rulesetId",
  "clientRequestScheme",
  "clientASNDescription",
  "originatorRayName",
  "ref",
  "edgeColoName",
  "clientRequestHTTPProtocol",
  "wafAttackScoreClass",
  "botScore",
];

export enum CloudflareFailureKind {
  // Cloudflare did not accept the token at all: wrong, revoked, expired or not a token.
  InvalidToken = "invalid-token",
  // The token is accepted but lacks a permission the request needs.
  MissingPermission = "missing-permission",
  // Cloudflare's rate limit: asked to wait longer than a run waits.
  RateLimited = "rate-limited",
  // Cloudflare failed for now: a 5xx, a query it could not run.
  Unavailable = "unavailable",
  // Cloudflare refused the request as asked: a window, a field, a page size.
  BadRequest = "bad-request",
  // A 2xx whose body is not what the API answers.
  Unrecognized = "unrecognized",
  // No answer at all: a timeout, a refused connection, the egress guard.
  Unreachable = "unreachable",
}

export class CloudflareApiError extends APIException {
  public kind: CloudflareFailureKind;
  // The HTTP status, or 0 when nothing answered.
  public statusCode: number;
  // Cloudflare's own error codes (10000 Authentication error, 9109 ...).
  public codes: Array<number>;
  // How long Cloudflare asked to wait, for a rate limit that said.
  public waitInMs: number | undefined;
  // The zones a GraphQL answer said the token may not read.
  public unauthorizedZoneTags: Array<string>;

  public constructor(data: {
    message: string;
    kind: CloudflareFailureKind;
    statusCode?: number | undefined;
    codes?: Array<number> | undefined;
    waitInMs?: number | undefined;
    unauthorizedZoneTags?: Array<string> | undefined;
  }) {
    super(data.message);
    this.kind = data.kind;
    this.statusCode = data.statusCode || 0;
    this.codes = data.codes || [];
    this.waitInMs = data.waitInMs;
    this.unauthorizedZoneTags = data.unauthorizedZoneTags || [];
  }
}

export interface CloudflareClientOptions {
  apiToken: string;
  transport: ConnectorTransport;
  requestTimeoutInMs: number;
  // Test seam: where the API is served from.
  baseUrl?: string | undefined;
  now?: (() => number) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export interface CloudflareTokenStatus {
  id: string;
  // active, disabled or expired.
  status: string;
  expiresOn: string | null;
  // Which verify endpoint accepted it: a user's token, or one an account owns.
  owner: "user" | "account";
}

export interface CloudflareZone {
  id: string;
  name: string;
  // active, pending, initializing, moved, deleted, deactivated.
  status: string;
  accountId: string;
  accountName: string;
  // The plan as Cloudflare names it ("Free Website", "Pro Website") and its short id (free, pro).
  planName: string;
  planLegacyId: string;
}

export interface CloudflareZoneList {
  zones: Array<CloudflareZone>;
  // More zones than the pages read hold.
  isTruncated: boolean;
}

// What a zone's plan allows of the firewall events dataset (its settings node).
export interface CloudflareDatasetSettings {
  zoneTag: string;
  enabled: boolean;
  maxDurationSeconds: number | null;
  maxPageSize: number | null;
  notOlderThanSeconds: number | null;
  maxNumberOfFields: number | null;
  // Null when the settings node did not list them: every field is assumed.
  availableFields: Array<string> | null;
}

export interface CloudflareSettingsReading {
  settings: Array<CloudflareDatasetSettings>;
  // The zones the answer said the token may not read.
  unauthorizedZoneTags: Array<string>;
}

// Where a page of firewall events resumes: the last row read, by the sort order.
export interface CloudflareEventKey {
  datetime: string;
  rayName: string;
  matchIndex: number;
}

export interface ListFirewallEventsRequest {
  zoneTag: string;
  // Inclusive.
  startTime: Date;
  // Exclusive.
  endTime: Date;
  limit: number;
  fields: ReadonlyArray<string>;
  after?: CloudflareEventKey | undefined;
}

export interface CloudflareEventCount {
  zoneTag: string;
  // The sum of the rows' sample intervals: an estimate of the requests.
  count: number;
}

export const CLOUDFLARE_TOKEN_STEP: string = "Cloudflare API token check";
export const CLOUDFLARE_ZONES_STEP: string = "Cloudflare zones request";
export const CLOUDFLARE_ANALYTICS_STEP: string =
  "Cloudflare GraphQL Analytics request";

const MINUTE_IN_MS: number = 60 * 1000;

// What GraphQL's "try again after 5 minutes" asks for.
const GRAPHQL_BUDGET_WAIT_IN_MS: number = 5 * MINUTE_IN_MS;

// Cloudflare's codes for a token in the wrong form (6003, 6111) or not a token (6100, 1000).
const INVALID_TOKEN_CODES: ReadonlyArray<number> = [1000, 6003, 6100, 6111];

const ZONE_TAG_REGEX: RegExp = /\b[0-9a-f]{32}\b/gi;

function isJsonObject(value: unknown): value is JSONObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string {
  if (value === null || value === undefined || typeof value === "object") {
    return "";
  }

  return String(value).trim();
}

function readCount(value: unknown): number | null {
  const number: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) && number >= 0 ? number : null;
}

// The messages of a GraphQL answer's errors, lowercased for matching beside as written.
function graphQlErrorMessages(body: unknown): Array<string> {
  if (!isJsonObject(body) || !Array.isArray(body["errors"])) {
    return [];
  }

  const messages: Array<string> = [];

  for (const error of body["errors"] as JSONArray) {
    const message: string = isJsonObject(error)
      ? readText(error["message"])
      : readText(error);

    if (message) {
      messages.push(message);
    }
  }

  return messages;
}

function isRateLimitMessage(message: string): boolean {
  const lower: string = message.toLowerCase();

  return (
    lower.includes("rate limiter budget depleted") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("too many nodes, zones and accounts")
  );
}

function isBusyMessage(message: string): boolean {
  const lower: string = message.toLowerCase();

  return (
    lower.includes("too many queries in progress") ||
    lower.includes("unable to execute query") ||
    lower.includes("please try again later")
  );
}

function isAuthorizationMessage(message: string): boolean {
  const lower: string = message.toLowerCase();

  return (
    lower.includes("not authorized") ||
    lower.includes("does not have access") ||
    lower.includes("access denied") ||
    lower.includes("forbidden")
  );
}

function isAuthenticationMessage(message: string): boolean {
  const lower: string = message.toLowerCase();

  return lower === "unauthorized" || lower.includes("authentication");
}

/*
 * Whether an answer may pass, for DataSourceHttpRetry. A 429 is a throttle,
 * and so is a GraphQL answer whose errors say the query budget is spent
 * (asked to wait five minutes, which no run waits out). A 503, a 502 and a
 * 504, and a GraphQL "too many queries in progress", failed for now. Every
 * request the client sends is a read, so each is safe to send again.
 */
export function classifyCloudflareAnswer(
  response: DataSourceHttpResponse,
): HttpRetryVerdict | null {
  if (response.statusCode === 429) {
    return { reason: HttpRetryReason.Throttled };
  }

  if ([502, 503, 504].includes(response.statusCode)) {
    return { reason: HttpRetryReason.Unavailable };
  }

  const messages: Array<string> = graphQlErrorMessages(response.bodyJson);

  if (messages.some(isRateLimitMessage)) {
    return {
      reason: HttpRetryReason.Throttled,
      waitInMs: GRAPHQL_BUDGET_WAIT_IN_MS,
    };
  }

  if (messages.some(isBusyMessage)) {
    return { reason: HttpRetryReason.Unavailable };
  }

  return null;
}

export default class CloudflareClient {
  private options: CloudflareClientOptions;
  private baseUrl: string;
  private retry: DataSourceHttpRetry;
  private requestCount: number = 0;
  private now: () => number;

  public constructor(options: CloudflareClientOptions) {
    this.options = options;
    this.baseUrl = (options.baseUrl || CLOUDFLARE_API_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.now =
      options.now ||
      ((): number => {
        return Date.now();
      });
    this.retry = new DataSourceHttpRetry({
      transport: options.transport,
      classify: classifyCloudflareAnswer,
      provider: "Cloudflare",
      now: this.now,
      ...(options.sleep ? { sleep: options.sleep } : {}),
    });
  }

  // Requests sent, a request asked again counted each time it was sent.
  public getRequestCount(): number {
    return this.requestCount;
  }

  /*
   * Whether the token is live. A user's token answers on
   * /user/tokens/verify; a token an account owns answers only on that
   * account's /accounts/{id}/tokens/verify, so that is asked when the first
   * one refuses and an account is known.
   */
  public async verifyToken(
    accountId?: string | undefined,
  ): Promise<CloudflareTokenStatus> {
    try {
      return await this.readTokenStatus(`/user/tokens/verify`, "user");
    } catch (error) {
      const refused: boolean =
        error instanceof CloudflareApiError &&
        (error.kind === CloudflareFailureKind.InvalidToken ||
          error.kind === CloudflareFailureKind.MissingPermission);

      if (!refused || !accountId) {
        throw error;
      }

      try {
        return await this.readTokenStatus(
          `/accounts/${encodeURIComponent(accountId)}/tokens/verify`,
          "account",
        );
      } catch {
        // The user endpoint's refusal is the one that names the token.
        throw error;
      }
    }
  }

  /*
   * The zones the token reads, in one account or in every account it
   * reaches, page by page, up to maxPages pages.
   */
  public async listZones(data: {
    accountId?: string | undefined;
    maxPages: number;
  }): Promise<CloudflareZoneList> {
    const zones: Array<CloudflareZone> = [];
    let page: number = 1;
    let totalPages: number = 1;

    while (page <= totalPages && page <= data.maxPages) {
      const url: URL = new URL(`${this.baseUrl}/zones`);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(CLOUDFLARE_ZONES_PER_PAGE));
      url.searchParams.set("order", "name");
      url.searchParams.set("direction", "asc");

      if (data.accountId) {
        url.searchParams.set("account.id", data.accountId);
      }

      const body: JSONObject = await this.restGet(
        url.toString(),
        CLOUDFLARE_ZONES_STEP,
      );
      const result: JSONValue | undefined = body["result"];

      if (!Array.isArray(result)) {
        throw this.unrecognized(CLOUDFLARE_ZONES_STEP, body);
      }

      for (const item of result as JSONArray) {
        const zone: CloudflareZone | null = CloudflareClient.readZone(item);

        if (zone) {
          zones.push(zone);
        }
      }

      const info: JSONValue | undefined = body["result_info"];
      totalPages = isJsonObject(info)
        ? Math.max(1, readCount(info["total_pages"]) || 1)
        : 1;
      page += 1;
    }

    return { zones, isTruncated: page <= totalPages };
  }

  /*
   * What each zone's plan allows of the firewall events dataset, read from
   * the settings node, up to ten zones a query. A zone the answer says the
   * token may not read is named in unauthorizedZoneTags, and the rest are
   * still read: one zone without Analytics Read must not hide the others.
   */
  public async readDatasetSettings(
    zoneTags: ReadonlyArray<string>,
  ): Promise<CloudflareSettingsReading> {
    const reading: CloudflareSettingsReading = {
      settings: [],
      unauthorizedZoneTags: [],
    };

    for (
      let index: number = 0;
      index < zoneTags.length;
      index += CLOUDFLARE_ZONES_PER_QUERY
    ) {
      const batch: Array<string> = zoneTags.slice(
        index,
        index + CLOUDFLARE_ZONES_PER_QUERY,
      );
      await this.readSettingsBatch(batch, reading);
    }

    return reading;
  }

  /*
   * One page of a zone's firewall events in [startTime, endTime), oldest
   * first, after the row `after` names when it is given.
   */
  public async listFirewallEvents(
    request: ListFirewallEventsRequest,
  ): Promise<Array<JSONObject>> {
    const filter: JSONObject = {
      datetime_geq: request.startTime.toISOString(),
      datetime_lt: request.endTime.toISOString(),
    };

    if (request.after) {
      filter["OR"] = [
        { datetime_gt: request.after.datetime },
        { datetime: request.after.datetime, rayName_gt: request.after.rayName },
        {
          datetime: request.after.datetime,
          rayName: request.after.rayName,
          matchIndex_gt: request.after.matchIndex,
        },
      ];
    }

    const fields: string = request.fields.join("\n          ");
    const query: string = `query OneUptimeFirewallEvents($zoneTag: string!, $filter: ZoneFirewallEventsAdaptiveFilter_InputObject!, $limit: uint64!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      firewallEventsAdaptive(filter: $filter, limit: $limit, orderBy: [datetime_ASC, rayName_ASC, matchIndex_ASC]) {
          ${fields}
      }
    }
  }
}`;

    const data: JSONObject = await this.graphQl({
      query,
      variables: {
        zoneTag: request.zoneTag,
        filter,
        limit: Math.max(1, Math.trunc(request.limit)),
      },
    });

    const zone: JSONObject | undefined = CloudflareClient.readZones(data)[0];

    if (!zone) {
      throw new CloudflareApiError({
        message: `${CLOUDFLARE_ANALYTICS_STEP} did not return zone ${request.zoneTag}; the token cannot read its analytics.`,
        kind: CloudflareFailureKind.MissingPermission,
        statusCode: 200,
        unauthorizedZoneTags: [request.zoneTag],
      });
    }

    const rows: JSONValue | undefined = zone[CLOUDFLARE_FIREWALL_EVENTS_DATASET];

    if (!Array.isArray(rows)) {
      throw this.unrecognized(CLOUDFLARE_ANALYTICS_STEP, data);
    }

    return (rows as JSONArray).filter(isJsonObject);
  }

  /*
   * About how many requests the firewall acted on in each zone over a
   * window: the sum of the sample intervals of the aggregated dataset, up
   * to ten zones a query.
   */
  public async countFirewallEvents(data: {
    zoneTags: ReadonlyArray<string>;
    startTime: Date;
    endTime: Date;
  }): Promise<Array<CloudflareEventCount>> {
    const counts: Array<CloudflareEventCount> = [];

    for (
      let index: number = 0;
      index < data.zoneTags.length;
      index += CLOUDFLARE_ZONES_PER_QUERY
    ) {
      const batch: Array<string> = data.zoneTags.slice(
        index,
        index + CLOUDFLARE_ZONES_PER_QUERY,
      );
      const query: string = `query OneUptimeFirewallEventCounts($zoneTags: [string!], $filter: ZoneFirewallEventsAdaptiveGroupsFilter_InputObject!) {
  viewer {
    zones(filter: { zoneTag_in: $zoneTags }) {
      zoneTag
      firewallEventsAdaptiveGroups(filter: $filter, limit: 1) {
        count
      }
    }
  }
}`;
      const answer: JSONObject = await this.graphQl({
        query,
        variables: {
          zoneTags: batch,
          filter: {
            datetime_geq: data.startTime.toISOString(),
            datetime_lt: data.endTime.toISOString(),
          },
        },
      });

      for (const zone of CloudflareClient.readZones(answer)) {
        const zoneTag: string = readText(zone["zoneTag"]);
        const groups: JSONValue | undefined =
          zone["firewallEventsAdaptiveGroups"];
        let count: number = 0;

        if (Array.isArray(groups)) {
          for (const group of groups as JSONArray) {
            count += isJsonObject(group) ? readCount(group["count"]) || 0 : 0;
          }
        }

        if (zoneTag) {
          counts.push({ zoneTag, count });
        }
      }
    }

    return counts;
  }

  private async readTokenStatus(
    path: string,
    owner: "user" | "account",
  ): Promise<CloudflareTokenStatus> {
    const body: JSONObject = await this.restGet(
      `${this.baseUrl}${path}`,
      CLOUDFLARE_TOKEN_STEP,
    );
    const result: JSONValue | undefined = body["result"];

    if (!isJsonObject(result) || !readText(result["status"])) {
      throw this.unrecognized(CLOUDFLARE_TOKEN_STEP, body);
    }

    return {
      id: readText(result["id"]),
      status: readText(result["status"]).toLowerCase(),
      expiresOn: readText(result["expires_on"]) || null,
      owner,
    };
  }

  private async readSettingsBatch(
    zoneTags: Array<string>,
    reading: CloudflareSettingsReading,
  ): Promise<void> {
    const query: string = `query OneUptimeFirewallEventSettings($zoneTags: [string!]) {
  viewer {
    zones(filter: { zoneTag_in: $zoneTags }) {
      zoneTag
      settings {
        ${CLOUDFLARE_FIREWALL_EVENTS_DATASET} {
          enabled
          maxDuration
          maxNumberOfFields
          maxPageSize
          notOlderThan
          availableFields
        }
      }
    }
  }
}`;

    let data: JSONObject;

    try {
      data = await this.graphQl({ query, variables: { zoneTags } });
    } catch (error) {
      /*
       * A query naming a zone the token may not read is refused whole.
       * Without the zones it names, the rest are asked again, so they are
       * still read; a refusal that names none is asked zone by zone.
       */
      if (
        error instanceof CloudflareApiError &&
        error.kind === CloudflareFailureKind.MissingPermission &&
        zoneTags.length > 1
      ) {
        const refused: Array<string> = error.unauthorizedZoneTags.filter(
          (zoneTag: string): boolean => {
            return zoneTags.includes(zoneTag);
          },
        );

        if (refused.length > 0) {
          reading.unauthorizedZoneTags.push(...refused);
          const rest: Array<string> = zoneTags.filter(
            (zoneTag: string): boolean => {
              return !refused.includes(zoneTag);
            },
          );

          if (rest.length > 0) {
            await this.readSettingsBatch(rest, reading);
          }

          return;
        }

        for (const zoneTag of zoneTags) {
          await this.readSettingsBatch([zoneTag], reading);
        }

        return;
      }

      if (
        error instanceof CloudflareApiError &&
        error.kind === CloudflareFailureKind.MissingPermission
      ) {
        reading.unauthorizedZoneTags.push(...zoneTags);
        return;
      }

      throw error;
    }

    const answered: Set<string> = new Set<string>();

    for (const zone of CloudflareClient.readZones(data)) {
      const zoneTag: string = readText(zone["zoneTag"]);
      const settings: JSONValue | undefined = zone["settings"];
      const dataset: JSONValue | undefined = isJsonObject(settings)
        ? settings[CLOUDFLARE_FIREWALL_EVENTS_DATASET]
        : undefined;

      if (!zoneTag) {
        continue;
      }

      answered.add(zoneTag);

      if (!isJsonObject(dataset)) {
        reading.settings.push({
          zoneTag,
          enabled: false,
          maxDurationSeconds: null,
          maxPageSize: null,
          notOlderThanSeconds: null,
          maxNumberOfFields: null,
          availableFields: null,
        });
        continue;
      }

      const available: JSONValue | undefined = dataset["availableFields"];

      reading.settings.push({
        zoneTag,
        enabled: dataset["enabled"] === true,
        maxDurationSeconds: readCount(dataset["maxDuration"]),
        maxPageSize: readCount(dataset["maxPageSize"]),
        notOlderThanSeconds: readCount(dataset["notOlderThan"]),
        maxNumberOfFields: readCount(dataset["maxNumberOfFields"]),
        availableFields: Array.isArray(available)
          ? (available as JSONArray)
              .map((field: JSONValue): string => {
                return readText(field);
              })
              .filter((field: string): boolean => {
                return Boolean(field);
              })
          : null,
      });
    }

    /*
     * A zone the token may not read is left out of the answer, with or
     * without an error saying so: it is as unreadable as one named.
     */
    for (const zoneTag of zoneTags) {
      if (
        !answered.has(zoneTag) &&
        !reading.unauthorizedZoneTags.includes(zoneTag)
      ) {
        reading.unauthorizedZoneTags.push(zoneTag);
      }
    }
  }

  private headers(): Dictionary<string> {
    return {
      Authorization: `Bearer ${this.options.apiToken}`,
      Accept: "application/json",
    };
  }

  private async restGet(url: string, step: string): Promise<JSONObject> {
    const exchange: HttpRetryExchange = await this.send(
      {
        method: "GET",
        url,
        headers: this.headers(),
        timeoutInMs: this.options.requestTimeoutInMs,
      },
      step,
    );
    const response: DataSourceHttpResponse = exchange.response;
    const body: unknown = response.bodyJson;

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (!isJsonObject(body)) {
        throw this.unrecognized(step, body);
      }

      if (body["success"] === false) {
        throw this.restFailure(step, response, exchange.attempts);
      }

      return body;
    }

    throw this.restFailure(step, response, exchange.attempts);
  }

  private async graphQl(request: {
    query: string;
    variables: JSONObject;
  }): Promise<JSONObject> {
    const exchange: HttpRetryExchange = await this.send(
      {
        method: "POST",
        url: `${this.baseUrl}/graphql`,
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: request.query,
          variables: request.variables,
        }),
        timeoutInMs: this.options.requestTimeoutInMs,
      },
      CLOUDFLARE_ANALYTICS_STEP,
    );
    const response: DataSourceHttpResponse = exchange.response;
    const body: unknown = response.bodyJson;
    const messages: Array<string> = graphQlErrorMessages(body);

    if (
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      messages.length === 0
    ) {
      if (!isJsonObject(body) || !isJsonObject(body["data"])) {
        throw this.unrecognized(CLOUDFLARE_ANALYTICS_STEP, body);
      }

      return body["data"];
    }

    throw this.graphQlFailure(response, messages, exchange.attempts);
  }

  private async send(
    request: DataSourceHttpRequest,
    step: string,
  ): Promise<HttpRetryExchange> {
    try {
      const exchange: HttpRetryExchange = await this.retry.exchange({
        build: (): DataSourceHttpRequest => {
          this.requestCount += 1;
          return { ...request, acceptAnyStatus: true };
        },
        isSafeToRepeat: true,
      });

      return exchange;
    } catch (error) {
      /*
       * Nothing answered (DataSourceUnreachedError keeps the transport's
       * words): a timeout, a refused connection, the egress guard. The
       * message assigns no side.
       */
      const message: string =
        error instanceof Error ? error.message : String(error);

      throw new CloudflareApiError({
        message: `${step} did not complete: ${this.scrub(redactLogString(message))}`,
        kind: CloudflareFailureKind.Unreachable,
      });
    }
  }

  private restFailure(
    step: string,
    response: DataSourceHttpResponse,
    attempts: number,
  ): CloudflareApiError {
    const body: unknown = response.bodyJson;
    const codes: Array<number> = [];
    const messages: Array<string> = [];

    if (isJsonObject(body) && Array.isArray(body["errors"])) {
      for (const error of body["errors"] as JSONArray) {
        if (!isJsonObject(error)) {
          continue;
        }

        const code: number | null = readCount(error["code"]);

        if (code !== null) {
          codes.push(code);
        }

        const message: string = readText(error["message"]);

        if (message) {
          messages.push(code !== null ? `${message} (${code})` : message);
        }
      }
    }

    const status: number = response.statusCode;
    const said: string =
      messages.join("; ") ||
      this.redactBody(response.bodyText || "") ||
      "no error message";
    const tried: string = attempts > 1 ? ` Tried ${attempts} times.` : "";
    let kind: CloudflareFailureKind = CloudflareFailureKind.BadRequest;

    if (status === 429) {
      kind = CloudflareFailureKind.RateLimited;
    } else if (status >= 500) {
      kind = CloudflareFailureKind.Unavailable;
    } else if (
      status === 401 ||
      codes.some((code: number): boolean => {
        return INVALID_TOKEN_CODES.includes(code);
      })
    ) {
      kind = CloudflareFailureKind.InvalidToken;
    } else if (status === 403) {
      kind = CloudflareFailureKind.MissingPermission;
    }

    return new CloudflareApiError({
      message: `${step} failed (HTTP ${status}): ${this.scrub(redactLogString(said))}.${tried}`,
      kind,
      statusCode: status,
      codes,
      waitInMs: this.readWait(response),
    });
  }

  private graphQlFailure(
    response: DataSourceHttpResponse,
    messages: Array<string>,
    attempts: number,
  ): CloudflareApiError {
    const status: number = response.statusCode;
    const said: string =
      messages.join("; ") ||
      this.redactBody(response.bodyText || "") ||
      "no error message";
    const tried: string = attempts > 1 ? ` Tried ${attempts} times.` : "";
    const unauthorizedZoneTags: Array<string> = [];

    for (const message of messages) {
      if (!isAuthorizationMessage(message)) {
        continue;
      }

      for (const match of message.match(ZONE_TAG_REGEX) || []) {
        const zoneTag: string = match.toLowerCase();

        if (!unauthorizedZoneTags.includes(zoneTag)) {
          unauthorizedZoneTags.push(zoneTag);
        }
      }
    }

    let kind: CloudflareFailureKind = CloudflareFailureKind.BadRequest;

    if (status === 429 || messages.some(isRateLimitMessage)) {
      kind = CloudflareFailureKind.RateLimited;
    } else if (status >= 500 || messages.some(isBusyMessage)) {
      kind = CloudflareFailureKind.Unavailable;
    } else if (status === 403 || messages.some(isAuthorizationMessage)) {
      kind = CloudflareFailureKind.MissingPermission;
    } else if (status === 401 || messages.some(isAuthenticationMessage)) {
      kind = CloudflareFailureKind.InvalidToken;
    }

    return new CloudflareApiError({
      message: `${CLOUDFLARE_ANALYTICS_STEP} failed${status ? ` (HTTP ${status})` : ""}: ${this.scrub(redactLogString(said)).substring(0, 500)}.${tried}`,
      kind,
      statusCode: status,
      waitInMs:
        kind === CloudflareFailureKind.RateLimited
          ? (this.readWait(response) ??
            (messages.some(isRateLimitMessage)
              ? GRAPHQL_BUDGET_WAIT_IN_MS
              : undefined))
          : undefined,
      unauthorizedZoneTags,
    });
  }

  private unrecognized(step: string, body: unknown): CloudflareApiError {
    const summary: string =
      body === undefined
        ? "a body that is not JSON"
        : this.scrub(
            JSON.stringify(redactLogValue(body as JSONValue)).substring(0, 300),
          );

    return new CloudflareApiError({
      message: `${step} returned an unrecognized response: ${summary}`,
      kind: CloudflareFailureKind.Unrecognized,
      statusCode: 200,
    });
  }

  private readWait(response: DataSourceHttpResponse): number | undefined {
    return RetryAfter.msFromHeaders(response.headers, { nowMs: this.now() });
  }

  private redactBody(body: string): string {
    const excerpt: string = body.substring(0, 300).trim();

    try {
      return this.scrub(
        JSON.stringify(redactLogValue(JSON.parse(excerpt) as JSONValue)),
      );
    } catch {
      return this.scrub(redactLogString(excerpt));
    }
  }

  // The token as a literal, in case an answer repeats it.
  private scrub(text: string): string {
    const apiToken: string = this.options.apiToken;

    if (!apiToken || !text) {
      return text;
    }

    return text.split(apiToken).join(REDACTED);
  }

  private static readZones(data: JSONObject): Array<JSONObject> {
    const viewer: JSONValue | undefined = data["viewer"];
    const zones: JSONValue | undefined = isJsonObject(viewer)
      ? viewer["zones"]
      : undefined;

    return Array.isArray(zones) ? (zones as JSONArray).filter(isJsonObject) : [];
  }

  public static readZone(value: JSONValue): CloudflareZone | null {
    if (!isJsonObject(value)) {
      return null;
    }

    const id: string = readText(value["id"]);
    const name: string = readText(value["name"]);

    if (!id || !name) {
      return null;
    }

    const account: JSONValue | undefined = value["account"];
    const plan: JSONValue | undefined = value["plan"];

    return {
      id,
      name,
      status: readText(value["status"]),
      accountId: isJsonObject(account) ? readText(account["id"]) : "",
      accountName: isJsonObject(account) ? readText(account["name"]) : "",
      planName: isJsonObject(plan) ? readText(plan["name"]) : "",
      planLegacyId: isJsonObject(plan) ? readText(plan["legacy_id"]) : "",
    };
  }

  // The key of the last row read, for the next page; null for a row without one.
  public static readEventKey(row: JSONObject): CloudflareEventKey | null {
    const datetime: string = readText(row["datetime"]);
    const rayName: string = readText(row["rayName"]);
    const matchIndex: number | null = readCount(row["matchIndex"]);

    if (!datetime || !rayName) {
      return null;
    }

    return { datetime, rayName, matchIndex: matchIndex ?? 0 };
  }
}
