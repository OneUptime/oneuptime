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
// How many times it asked, from the table of why a check failed, in the reader's language.
import { withAttempts } from "../../../DataSource/HttpFailure";
import {
  REDACTED,
  redactLogString,
  redactLogValue,
} from "../../../LogRedaction";
import { ConnectorTransport } from "../Types";
import { CLOUDFLARE_CUSTOM_RULES_PHASE } from "../../../../../Types/SecurityBlocklist/CloudflareBlocking";

/*
 * Minimal Cloudflare API client for the Cloudflare connection: the one place
 * OneUptime calls Cloudflare's API from. The connection reads with it; when
 * blocking is turned on (#10343) its write calls keep the blocklist's lists,
 * custom rules and IP Access Rules (CloudflareBlocking), and nothing else
 * writes to Cloudflare.
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
 *
 * Blocking's writes (#10343), with Account Filter Lists Edit, Zone WAF Edit
 * and Account Firewall Access Rules Edit:
 *
 *   GET, POST, DELETE /accounts/{id}/rules/lists[/{list}]: OneUptime's two
 *     IP lists;
 *   GET, POST, DELETE /accounts/{id}/rules/lists/{list}/items: a list's
 *     items. A write is asynchronous: it answers an operation_id, read at
 *     GET /accounts/{id}/rules/lists/bulk_operations/{operation} until it is
 *     completed or failed. Cloudflare allows one pending bulk operation per
 *     account and turns another away: that answer is asked again, as a
 *     throttle is. PUT .../items, which replaces the whole list, is never
 *     sent;
 *   GET /zones/{id}/rulesets/phases/http_request_firewall_custom/entrypoint,
 *     POST /zones/{id}/rulesets (a 404 above: no entry point yet), and
 *     POST, PATCH, DELETE /zones/{id}/rulesets/{ruleset}/rules[/{rule}]:
 *     OneUptime's custom rule in a zone, added on its own, first in the
 *     phase. PUT .../entrypoint, which replaces every rule, is never sent;
 *   GET, POST, DELETE /accounts/{id}/firewall/access_rules/rules[/{rule}]:
 *     IP Access Rules, where lists cannot be used.
 *
 * A write is sent once, and asked again only when Cloudflare turned it away
 * before doing it (a 429, a pending bulk operation); a read, a DELETE and a
 * PATCH are safe to send again.
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
  // What the request names is not there: a list, a ruleset, a rule.
  NotFound = "not-found",
  // Another change to the account's lists is still running: one at a time.
  Busy = "busy",
  // The plan holds no more: lists, list items or custom rules.
  LimitReached = "limit-reached",
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

// One of the account's lists (Account Filter Lists).
export interface CloudflareList {
  id: string;
  name: string;
  description: string;
  kind: string;
  numItems: number;
  numReferencingFilters: number;
}

// One item of an IP list.
export interface CloudflareListItem {
  id: string;
  ip: string;
  comment: string;
}

export type CloudflareBulkOperationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface CloudflareBulkOperation {
  id: string;
  status: CloudflareBulkOperationStatus;
  // Why it failed, for a failed one.
  error: string;
}

// One rule of a ruleset, as the Rulesets API answers it.
export interface CloudflareRule {
  id: string;
  ref: string;
  action: string;
  expression: string;
  description: string;
  enabled: boolean;
}

export interface CloudflareRuleset {
  id: string;
  rules: Array<CloudflareRule>;
}

// A rule as OneUptime writes it.
export interface CloudflareRuleInput {
  ref: string;
  action: string;
  expression: string;
  description: string;
  enabled: boolean;
}

export interface CloudflareAccessRule {
  id: string;
  mode: string;
  notes: string;
  target: string;
  value: string;
}

export interface CloudflareAccessRulePage {
  rules: Array<CloudflareAccessRule>;
  totalCount: number;
  totalPages: number;
}

// What a probe of a write permission found.
export enum CloudflareWriteAccess {
  Granted = "granted",
  Missing = "missing",
}

export const CLOUDFLARE_TOKEN_STEP: string = "Cloudflare API token check";
export const CLOUDFLARE_ZONES_STEP: string = "Cloudflare zones request";
export const CLOUDFLARE_ANALYTICS_STEP: string =
  "Cloudflare GraphQL Analytics request";
export const CLOUDFLARE_LISTS_STEP: string = "Cloudflare lists request";
export const CLOUDFLARE_LIST_ITEMS_STEP: string =
  "Cloudflare list items request";
export const CLOUDFLARE_RULES_STEP: string = "Cloudflare custom rules request";
export const CLOUDFLARE_ACCESS_RULES_STEP: string =
  "Cloudflare IP Access Rules request";

// The most items one page of a list reads (the API's own maximum).
export const CLOUDFLARE_LIST_ITEMS_PER_PAGE: number = 500;

// The most IP Access Rules one page reads.
export const CLOUDFLARE_ACCESS_RULES_PER_PAGE: number = 500;

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

// The messages of a REST answer's errors.
function restErrorMessages(body: unknown): Array<string> {
  if (!isJsonObject(body) || !Array.isArray(body["errors"])) {
    return [];
  }

  const messages: Array<string> = [];

  for (const error of body["errors"] as JSONArray) {
    const message: string = isJsonObject(error)
      ? readText(error["message"])
      : "";

    if (message) {
      messages.push(message);
    }
  }

  return messages;
}

/*
 * Cloudflare turned a list write away because another bulk operation of the
 * account is still pending: one at a time per account. It says so in words
 * (the API reference documents the limit, not the code), with a 409 or a 400.
 */
export function isCloudflareBusyAnswer(
  response: DataSourceHttpResponse,
): boolean {
  if (response.statusCode !== 409 && response.statusCode !== 400) {
    return false;
  }

  return restErrorMessages(response.bodyJson).some(
    (message: string): boolean => {
      const lower: string = message.toLowerCase();

      return (
        (lower.includes("pending") ||
          lower.includes("outstanding") ||
          lower.includes("in progress")) &&
        (lower.includes("operation") || lower.includes("bulk"))
      );
    },
  );
}

// The plan holds no more: a list, an item or a custom rule past its limit.
function isLimitMessage(message: string): boolean {
  const lower: string = message.toLowerCase();

  return (
    !lower.includes("rate limit") &&
    (lower.includes("exceed") ||
      lower.includes("maximum number") ||
      lower.includes("quota") ||
      lower.includes("limit reached") ||
      lower.includes("too many lists") ||
      lower.includes("too many items") ||
      lower.includes("too many rules"))
  );
}

/*
 * Whether an answer may pass, for DataSourceHttpRetry. A 429 is a throttle,
 * and so is a GraphQL answer whose errors say the query budget is spent
 * (asked to wait five minutes, which no run waits out). A 503, a 502 and a
 * 504, and a GraphQL "too many queries in progress", failed for now: a read
 * is sent again, a write is not (DataSourceHttpRetry). A list write turned
 * away while another bulk operation of the account is pending did nothing,
 * so it is a throttle too, sent again after a short wait.
 */
export function classifyCloudflareAnswer(
  response: DataSourceHttpResponse,
): HttpRetryVerdict | null {
  if (response.statusCode === 429) {
    return { reason: HttpRetryReason.Throttled };
  }

  if (isCloudflareBusyAnswer(response)) {
    return { reason: HttpRetryReason.Throttled, isUndone: true };
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

    const rows: JSONValue | undefined =
      zone[CLOUDFLARE_FIREWALL_EVENTS_DATASET];

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
    return await this.rest({ method: "GET", url, step });
  }

  /*
   * One REST request, answered by the v4 envelope. A GET, a DELETE and a
   * PATCH are safe to send again; a POST is sent again only when Cloudflare
   * turned it away before doing it.
   */
  private async rest(data: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    url: string;
    step: string;
    body?: JSONValue | undefined;
  }): Promise<JSONObject> {
    const exchange: HttpRetryExchange = await this.send(
      {
        method: data.method,
        url: data.url,
        headers:
          data.body === undefined
            ? this.headers()
            : { ...this.headers(), "Content-Type": "application/json" },
        ...(data.body === undefined ? {} : { body: JSON.stringify(data.body) }),
        timeoutInMs: this.options.requestTimeoutInMs,
      },
      data.step,
      data.method !== "POST",
    );
    const response: DataSourceHttpResponse = exchange.response;
    const body: unknown = response.bodyJson;

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (!isJsonObject(body)) {
        throw this.unrecognized(data.step, body);
      }

      if (body["success"] === false) {
        throw this.restFailure(data.step, response, exchange.attempts);
      }

      return body;
    }

    throw this.restFailure(data.step, response, exchange.attempts);
  }

  private accountUrl(accountId: string, path: string): string {
    return `${this.baseUrl}/accounts/${encodeURIComponent(accountId)}${path}`;
  }

  private zoneUrl(zoneId: string, path: string): string {
    return `${this.baseUrl}/zones/${encodeURIComponent(zoneId)}${path}`;
  }

  // ---------- Blocking's lists (#10343) ----------

  // The account's lists, of every kind (Account Filter Lists Read or Edit).
  public async listLists(accountId: string): Promise<Array<CloudflareList>> {
    const body: JSONObject = await this.rest({
      method: "GET",
      url: this.accountUrl(accountId, "/rules/lists"),
      step: CLOUDFLARE_LISTS_STEP,
    });
    const result: JSONValue | undefined = body["result"];

    if (!Array.isArray(result)) {
      throw this.unrecognized(CLOUDFLARE_LISTS_STEP, body);
    }

    return (result as JSONArray)
      .map(CloudflareClient.readList)
      .filter((list: CloudflareList | null): list is CloudflareList => {
        return list !== null;
      });
  }

  public async createList(
    accountId: string,
    list: { name: string; description: string },
  ): Promise<CloudflareList> {
    const body: JSONObject = await this.rest({
      method: "POST",
      url: this.accountUrl(accountId, "/rules/lists"),
      step: CLOUDFLARE_LISTS_STEP,
      body: { name: list.name, kind: "ip", description: list.description },
    });
    const created: CloudflareList | null = CloudflareClient.readList(
      body["result"] as JSONValue,
    );

    if (!created) {
      throw this.unrecognized(CLOUDFLARE_LISTS_STEP, body);
    }

    return created;
  }

  // A list no rule refers to any more: Cloudflare keeps one a rule refers to.
  public async deleteList(accountId: string, listId: string): Promise<void> {
    await this.rest({
      method: "DELETE",
      url: this.accountUrl(
        accountId,
        `/rules/lists/${encodeURIComponent(listId)}`,
      ),
      step: CLOUDFLARE_LISTS_STEP,
    });
  }

  /*
   * A list's items, page by page after the cursor each answer gives, up to
   * maxItems: more than that and isTruncated says so.
   */
  public async listListItems(data: {
    accountId: string;
    listId: string;
    maxItems: number;
  }): Promise<{ items: Array<CloudflareListItem>; isTruncated: boolean }> {
    const items: Array<CloudflareListItem> = [];
    let cursor: string = "";

    for (;;) {
      const url: URL = new URL(
        this.accountUrl(
          data.accountId,
          `/rules/lists/${encodeURIComponent(data.listId)}/items`,
        ),
      );
      url.searchParams.set("per_page", String(CLOUDFLARE_LIST_ITEMS_PER_PAGE));

      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }

      const body: JSONObject = await this.rest({
        method: "GET",
        url: url.toString(),
        step: CLOUDFLARE_LIST_ITEMS_STEP,
      });
      const result: JSONValue | undefined = body["result"];

      if (!Array.isArray(result)) {
        throw this.unrecognized(CLOUDFLARE_LIST_ITEMS_STEP, body);
      }

      for (const value of result as JSONArray) {
        const item: CloudflareListItem | null =
          CloudflareClient.readListItem(value);

        if (item) {
          items.push(item);
        }
      }

      const info: JSONValue | undefined = body["result_info"];
      const cursors: JSONValue | undefined = isJsonObject(info)
        ? info["cursors"]
        : undefined;
      const after: string = isJsonObject(cursors)
        ? readText(cursors["after"])
        : "";

      if (items.length >= data.maxItems) {
        return { items: items.slice(0, data.maxItems), isTruncated: true };
      }

      if (!after || after === cursor || (result as JSONArray).length === 0) {
        return { items, isTruncated: false };
      }

      cursor = after;
    }
  }

  // Appends items to a list: asynchronous, answered by its operation's id.
  public async addListItems(data: {
    accountId: string;
    listId: string;
    items: Array<{ ip: string; comment: string }>;
  }): Promise<string> {
    const body: JSONObject = await this.rest({
      method: "POST",
      url: this.accountUrl(
        data.accountId,
        `/rules/lists/${encodeURIComponent(data.listId)}/items`,
      ),
      step: CLOUDFLARE_LIST_ITEMS_STEP,
      body: data.items.map((item: { ip: string; comment: string }) => {
        return { ip: item.ip, comment: item.comment };
      }),
    });

    return this.readOperationId(body, CLOUDFLARE_LIST_ITEMS_STEP);
  }

  // Removes a list's items by their ids: asynchronous, answered by its operation's id.
  public async deleteListItems(data: {
    accountId: string;
    listId: string;
    itemIds: Array<string>;
  }): Promise<string> {
    const body: JSONObject = await this.rest({
      method: "DELETE",
      url: this.accountUrl(
        data.accountId,
        `/rules/lists/${encodeURIComponent(data.listId)}/items`,
      ),
      step: CLOUDFLARE_LIST_ITEMS_STEP,
      body: {
        items: data.itemIds.map((id: string): JSONObject => {
          return { id };
        }),
      },
    });

    return this.readOperationId(body, CLOUDFLARE_LIST_ITEMS_STEP);
  }

  public async getBulkOperation(
    accountId: string,
    operationId: string,
  ): Promise<CloudflareBulkOperation> {
    const body: JSONObject = await this.rest({
      method: "GET",
      url: this.accountUrl(
        accountId,
        `/rules/lists/bulk_operations/${encodeURIComponent(operationId)}`,
      ),
      step: CLOUDFLARE_LIST_ITEMS_STEP,
    });
    const result: JSONValue | undefined = body["result"];
    const status: string = isJsonObject(result)
      ? readText(result["status"]).toLowerCase()
      : "";

    if (
      !isJsonObject(result) ||
      !["pending", "running", "completed", "failed"].includes(status)
    ) {
      throw this.unrecognized(CLOUDFLARE_LIST_ITEMS_STEP, body);
    }

    return {
      id: readText(result["id"]) || operationId,
      status: status as CloudflareBulkOperationStatus,
      error: this.scrub(redactLogString(readText(result["error"]))),
    };
  }

  private readOperationId(body: JSONObject, step: string): string {
    const result: JSONValue | undefined = body["result"];
    const operationId: string = isJsonObject(result)
      ? readText(result["operation_id"])
      : "";

    if (!operationId) {
      throw this.unrecognized(step, body);
    }

    return operationId;
  }

  // ---------- Blocking's custom rules ----------

  /*
   * The zone's entry point of the custom rules phase, with its rules (Zone
   * WAF Read or Edit), or null when the zone has none yet: a 404.
   */
  public async getCustomRulesEntrypoint(
    zoneId: string,
  ): Promise<CloudflareRuleset | null> {
    try {
      const body: JSONObject = await this.rest({
        method: "GET",
        url: this.zoneUrl(
          zoneId,
          `/rulesets/phases/${CLOUDFLARE_CUSTOM_RULES_PHASE}/entrypoint`,
        ),
        step: CLOUDFLARE_RULES_STEP,
      });

      return this.readRuleset(body);
    } catch (error) {
      if (
        error instanceof CloudflareApiError &&
        error.kind === CloudflareFailureKind.NotFound
      ) {
        return null;
      }

      throw error;
    }
  }

  // The zone's entry point, made with OneUptime's rules: only where there is none.
  public async createCustomRulesEntrypoint(
    zoneId: string,
    rules: Array<CloudflareRuleInput>,
  ): Promise<CloudflareRuleset> {
    const body: JSONObject = await this.rest({
      method: "POST",
      url: this.zoneUrl(zoneId, "/rulesets"),
      step: CLOUDFLARE_RULES_STEP,
      body: {
        name: "default",
        kind: "zone",
        phase: CLOUDFLARE_CUSTOM_RULES_PHASE,
        rules: rules.map((rule: CloudflareRuleInput): JSONObject => {
          return { ...rule };
        }),
      },
    });

    return this.readRuleset(body);
  }

  // One rule added on its own, first in the phase: the rest stay as they are.
  public async addCustomRule(data: {
    zoneId: string;
    rulesetId: string;
    rule: CloudflareRuleInput;
  }): Promise<CloudflareRuleset> {
    const body: JSONObject = await this.rest({
      method: "POST",
      url: this.zoneUrl(
        data.zoneId,
        `/rulesets/${encodeURIComponent(data.rulesetId)}/rules`,
      ),
      step: CLOUDFLARE_RULES_STEP,
      body: { ...data.rule, position: { index: 1 } },
    });

    return this.readRuleset(body);
  }

  // One rule written again whole, as the API asks: its action, expression, description, ref and whether it is on.
  public async updateCustomRule(data: {
    zoneId: string;
    rulesetId: string;
    ruleId: string;
    rule: CloudflareRuleInput;
  }): Promise<CloudflareRuleset> {
    const body: JSONObject = await this.rest({
      method: "PATCH",
      url: this.zoneUrl(
        data.zoneId,
        `/rulesets/${encodeURIComponent(data.rulesetId)}/rules/${encodeURIComponent(data.ruleId)}`,
      ),
      step: CLOUDFLARE_RULES_STEP,
      body: { ...data.rule },
    });

    return this.readRuleset(body);
  }

  public async deleteCustomRule(data: {
    zoneId: string;
    rulesetId: string;
    ruleId: string;
  }): Promise<void> {
    await this.rest({
      method: "DELETE",
      url: this.zoneUrl(
        data.zoneId,
        `/rulesets/${encodeURIComponent(data.rulesetId)}/rules/${encodeURIComponent(data.ruleId)}`,
      ),
      step: CLOUDFLARE_RULES_STEP,
    });
  }

  private readRuleset(body: JSONObject): CloudflareRuleset {
    const result: JSONValue | undefined = body["result"];
    const id: string = isJsonObject(result) ? readText(result["id"]) : "";

    if (!isJsonObject(result) || !id) {
      throw this.unrecognized(CLOUDFLARE_RULES_STEP, body);
    }

    const rules: Array<CloudflareRule> = [];
    const values: JSONValue | undefined = result["rules"];

    for (const value of Array.isArray(values) ? (values as JSONArray) : []) {
      if (!isJsonObject(value)) {
        continue;
      }

      rules.push({
        id: readText(value["id"]),
        ref: readText(value["ref"]),
        action: readText(value["action"]),
        expression: readText(value["expression"]),
        description: readText(value["description"]),
        // A rule is on unless it says it is not.
        enabled: value["enabled"] !== false,
      });
    }

    return { id, rules };
  }

  // ---------- Blocking's IP Access Rules ----------

  /*
   * One page of the account's IP Access Rules: those whose notes hold
   * `notes` (case-insensitive) when it is given, of one mode when given.
   */
  public async listAccessRules(data: {
    accountId: string;
    page: number;
    perPage: number;
    notes?: string | undefined;
    mode?: string | undefined;
  }): Promise<CloudflareAccessRulePage> {
    const url: URL = new URL(
      this.accountUrl(data.accountId, "/firewall/access_rules/rules"),
    );
    url.searchParams.set("page", String(Math.max(1, data.page)));
    url.searchParams.set("per_page", String(data.perPage));

    if (data.notes) {
      url.searchParams.set("notes", data.notes);
    }

    if (data.mode) {
      url.searchParams.set("mode", data.mode);
    }

    const body: JSONObject = await this.rest({
      method: "GET",
      url: url.toString(),
      step: CLOUDFLARE_ACCESS_RULES_STEP,
    });
    const result: JSONValue | undefined = body["result"];

    if (!Array.isArray(result)) {
      throw this.unrecognized(CLOUDFLARE_ACCESS_RULES_STEP, body);
    }

    const rules: Array<CloudflareAccessRule> = [];

    for (const value of result as JSONArray) {
      const rule: CloudflareAccessRule | null =
        CloudflareClient.readAccessRule(value);

      if (rule) {
        rules.push(rule);
      }
    }

    const info: JSONValue | undefined = body["result_info"];
    const totalCount: number = isJsonObject(info)
      ? readCount(info["total_count"]) ?? rules.length
      : rules.length;
    const totalPages: number = isJsonObject(info)
      ? readCount(info["total_pages"]) ??
        Math.max(1, Math.ceil(totalCount / Math.max(1, data.perPage)))
      : 1;

    return { rules, totalCount, totalPages };
  }

  public async createAccessRule(data: {
    accountId: string;
    mode: string;
    target: string;
    value: string;
    notes: string;
  }): Promise<CloudflareAccessRule> {
    const body: JSONObject = await this.rest({
      method: "POST",
      url: this.accountUrl(data.accountId, "/firewall/access_rules/rules"),
      step: CLOUDFLARE_ACCESS_RULES_STEP,
      body: {
        mode: data.mode,
        configuration: { target: data.target, value: data.value },
        notes: data.notes,
      },
    });
    const rule: CloudflareAccessRule | null = CloudflareClient.readAccessRule(
      body["result"] as JSONValue,
    );

    if (!rule) {
      throw this.unrecognized(CLOUDFLARE_ACCESS_RULES_STEP, body);
    }

    return rule;
  }

  public async deleteAccessRule(
    accountId: string,
    ruleId: string,
  ): Promise<void> {
    await this.rest({
      method: "DELETE",
      url: this.accountUrl(
        accountId,
        `/firewall/access_rules/rules/${encodeURIComponent(ruleId)}`,
      ),
      step: CLOUDFLARE_ACCESS_RULES_STEP,
    });
  }

  // ---------- Whether the token may write ----------

  /*
   * Whether the token holds a write permission, asked without writing:
   * Cloudflare refuses a request the token may not make (403) before it
   * reads what the request asks, and refuses a request it may make, but
   * that asks for nothing it can do, as malformed (400). So each probe asks
   * for something no write can come of - a list with no name, a rule with
   * no expression, an access rule with no address - and reads which of the
   * two answers. Anything else (a 429, a 5xx, no answer) is thrown: it says
   * nothing either way, and the caller says it could not tell.
   */
  public async probeWriteAccess(
    probe:
      | { kind: "lists"; accountId: string }
      | { kind: "rules"; zoneId: string; rulesetId: string | null }
      | { kind: "access-rules"; accountId: string },
  ): Promise<CloudflareWriteAccess> {
    let url: string;
    let body: JSONObject;
    let step: string;

    switch (probe.kind) {
      case "lists":
        url = this.accountUrl(probe.accountId, "/rules/lists");
        body = { name: "", kind: "ip", description: "" };
        step = CLOUDFLARE_LISTS_STEP;
        break;
      case "rules":
        url = probe.rulesetId
          ? this.zoneUrl(
              probe.zoneId,
              `/rulesets/${encodeURIComponent(probe.rulesetId)}/rules`,
            )
          : this.zoneUrl(probe.zoneId, "/rulesets");
        body = probe.rulesetId
          ? { action: "block", expression: "", position: { index: 1 } }
          : {
              name: "",
              kind: "zone",
              phase: CLOUDFLARE_CUSTOM_RULES_PHASE,
              rules: [{ action: "block", expression: "" }],
            };
        step = CLOUDFLARE_RULES_STEP;
        break;
      case "access-rules":
        url = this.accountUrl(probe.accountId, "/firewall/access_rules/rules");
        body = {
          mode: "block",
          configuration: { target: "ip", value: "" },
          notes: "",
        };
        step = CLOUDFLARE_ACCESS_RULES_STEP;
        break;
    }

    try {
      await this.rest({ method: "POST", url, step, body });
      // Cloudflare took it: the token may write, whatever it made of the request.
      return CloudflareWriteAccess.Granted;
    } catch (error) {
      if (!(error instanceof CloudflareApiError)) {
        throw error;
      }

      if (
        error.kind === CloudflareFailureKind.MissingPermission ||
        (error.statusCode === 401 && error.codes.includes(10000))
      ) {
        return CloudflareWriteAccess.Missing;
      }

      if (
        error.kind === CloudflareFailureKind.BadRequest ||
        error.kind === CloudflareFailureKind.NotFound ||
        error.kind === CloudflareFailureKind.LimitReached
      ) {
        return CloudflareWriteAccess.Granted;
      }

      throw error;
    }
  }

  public static readList(value: JSONValue): CloudflareList | null {
    if (!isJsonObject(value)) {
      return null;
    }

    const id: string = readText(value["id"]);
    const name: string = readText(value["name"]);

    if (!id || !name) {
      return null;
    }

    return {
      id,
      name,
      description: readText(value["description"]),
      kind: readText(value["kind"]),
      numItems: readCount(value["num_items"]) ?? 0,
      numReferencingFilters: readCount(value["num_referencing_filters"]) ?? 0,
    };
  }

  public static readListItem(value: JSONValue): CloudflareListItem | null {
    if (!isJsonObject(value)) {
      return null;
    }

    const id: string = readText(value["id"]);
    const ip: string = readText(value["ip"]);

    if (!id || !ip) {
      return null;
    }

    return { id, ip, comment: readText(value["comment"]) };
  }

  public static readAccessRule(value: JSONValue): CloudflareAccessRule | null {
    if (!isJsonObject(value)) {
      return null;
    }

    const id: string = readText(value["id"]);
    const configuration: JSONValue | undefined = value["configuration"];

    if (!id || !isJsonObject(configuration)) {
      return null;
    }

    return {
      id,
      mode: readText(value["mode"]),
      notes: readText(value["notes"]),
      target: readText(configuration["target"]),
      value: readText(configuration["value"]),
    };
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
    isSafeToRepeat: boolean = true,
  ): Promise<HttpRetryExchange> {
    try {
      const exchange: HttpRetryExchange = await this.retry.exchange({
        build: (): DataSourceHttpRequest => {
          this.requestCount += 1;
          return { ...request, acceptAnyStatus: true };
        },
        isSafeToRepeat,
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
    let kind: CloudflareFailureKind = CloudflareFailureKind.BadRequest;

    if (status === 429) {
      kind = CloudflareFailureKind.RateLimited;
    } else if (status >= 500) {
      kind = CloudflareFailureKind.Unavailable;
    } else if (isCloudflareBusyAnswer(response)) {
      kind = CloudflareFailureKind.Busy;
    } else if (
      status === 401 ||
      codes.some((code: number): boolean => {
        return INVALID_TOKEN_CODES.includes(code);
      })
    ) {
      kind = CloudflareFailureKind.InvalidToken;
    } else if (status === 403 && !messages.some(isLimitMessage)) {
      kind = CloudflareFailureKind.MissingPermission;
    } else if (status === 404) {
      kind = CloudflareFailureKind.NotFound;
    } else if (messages.some(isLimitMessage)) {
      kind = CloudflareFailureKind.LimitReached;
    }

    return new CloudflareApiError({
      message: withAttempts(
        `${step} failed (HTTP ${status}): ${this.scrub(redactLogString(said))}.`,
        attempts,
      ),
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
      message: withAttempts(
        `${CLOUDFLARE_ANALYTICS_STEP} failed${status ? ` (HTTP ${status})` : ""}: ${this.scrub(redactLogString(said)).substring(0, 500)}.`,
        attempts,
      ),
      kind,
      statusCode: status,
      waitInMs:
        kind === CloudflareFailureKind.RateLimited
          ? this.readWait(response) ??
            (messages.some(isRateLimitMessage)
              ? GRAPHQL_BUDGET_WAIT_IN_MS
              : undefined)
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

    return Array.isArray(zones)
      ? (zones as JSONArray).filter(isJsonObject)
      : [];
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
