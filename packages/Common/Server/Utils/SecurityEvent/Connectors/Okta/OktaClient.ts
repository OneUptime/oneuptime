import APIException from "../../../../../Types/Exception/ApiException";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import {
  REDACTED,
  redactLogString,
  redactLogValue,
} from "../../../LogRedaction";
import { ConnectorTransport } from "../Types";

/*
 * Minimal Okta client for the System Log connector.
 *
 * One endpoint, checked against the Okta management OpenAPI specification
 * (operation listLogEvents,
 * https://developer.okta.com/docs/api/openapi/okta-management/management/tag/SystemLog/)
 * and its companion guide
 * (https://developer.okta.com/docs/reference/system-log-query/):
 *
 *   GET {orgUrl}/api/v1/logs?since=&until=&sortOrder=ASCENDING&limit=&filter=
 *
 *  - `since` / `until` are ISO 8601 bounds on the events' `published`
 *    time. A request with both is a "bounded request": results are
 *    filtered and ordered by `published`, the page count is finite, and
 *    the last page carries no `next` link. The guide also warns that for
 *    a bounded request "Not all events for the specified time range may
 *    be present. Some events may be delayed." The poller therefore starts
 *    each Okta window 15 minutes before its cursor (the catalog's
 *    cursorOverlapInMinutes) and the connector's uuid dedupe drops what
 *    the overlap re-reads. A polling request (no `until`) returns every
 *    event but in persistence order, out of order by `published`, with an
 *    endless next link, so it cannot report a resume point per window.
 *  - `limit` is 0..1000 (default 100). `sortOrder` is ASCENDING or
 *    DESCENDING. `filter` is a SCIM-style expression (eq, ne, co, sw, ew,
 *    pr, gt, ge, lt, le with and/or); an invalid one answers HTTP 400.
 *  - Pagination is the RFC 8288 `Link` response header with rel="next".
 *    The guide is explicit that clients must follow the link rather than
 *    craft `after` cursors themselves, so this client hands the next URL
 *    back verbatim and re-requests it — after checking it stays on the
 *    configured org, because the Authorization header travels with it.
 *  - The body is a JSON array of LogEvent objects; Okta's error envelope
 *    is a JSON object ({ errorCode, errorSummary, errorId, errorCauses }).
 *
 * Auth is `Authorization: SSWS {apiToken}`
 * (https://developer.okta.com/docs/guides/create-an-api-token/main/).
 *
 * Every request goes through the injected transport (the SSRF-guarded
 * DataSourceHttpFetch in production). That transport throws on non-2xx
 * statuses with a "Data source responded with HTTP <n>: <body>" message,
 * while a test fixture may hand back the status directly; both paths are
 * folded into OktaHttpError so callers see one taxonomy.
 */

export interface OktaClientOptions {
  orgUrl: string;
  apiToken: string;
  transport: ConnectorTransport;
  requestTimeoutInMs: number;
}

export interface OktaLogEventsPage {
  events: Array<JSONObject>;
  // The rel="next" URL from the Link header, or null on the last page.
  nextUrl: string | null;
}

export interface OktaLogEventCount {
  count: number;
  // True when Okta offered a next page beyond the single page counted.
  hasMore: boolean;
}

export interface ListLogEventsRequest {
  // Inclusive lower bound on `published`.
  startTime: Date | string;
  // Upper bound on `published`.
  endTime: Date | string;
  limit: number;
  // SCIM filter expression; omitted from the request when empty.
  filter?: string | undefined;
}

// The documented maximum for `limit`.
export const OKTA_MAX_PAGE_SIZE: number = 1000;

export const OKTA_LOGS_STEP: string = "Okta System Log events request";

/*
 * What the connector reads when the connection's Event filter is empty:
 * the event families that matter to a security team, by `eventType`
 * prefix (sign-ins and sessions, MFA, account and lifecycle changes,
 * Okta's own security detections, policy evaluations, API token
 * lifecycle, application and group membership). Everything else in the
 * System Log — app lifecycle, profile mapping, rate-limit chatter — is
 * left out unless the tenant asks for it with its own filter.
 */
export const OKTA_DEFAULT_EVENT_FILTER: string = [
  "user.session",
  "user.authentication",
  "user.mfa",
  "user.account",
  "user.lifecycle",
  "security.",
  "policy.",
  "system.api_token",
  "application.user_membership",
  "group.user_membership",
]
  .map((prefix: string): string => {
    return `eventType sw "${prefix}"`;
  })
  .join(" or ");

/*
 * Thrown for every failure that carries an HTTP status, so the connector
 * can pick remediation text per status without parsing the message.
 */
export class OktaHttpError extends APIException {
  public statusCode: number;

  public constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

const TRANSPORT_HTTP_FAILURE_REGEX: RegExp =
  /Data source responded with HTTP (\d{3}):\s*([\s\S]*)$/;

export default class OktaClient {
  private options: OktaClientOptions;
  private baseUrl: string;
  private requestCount: number = 0;

  public constructor(options: OktaClientOptions) {
    this.options = options;
    this.baseUrl = OktaClient.buildBaseUrl(options.orgUrl);
  }

  /*
   * {orgUrl} with trailing slashes removed, so a URL pasted as
   * "https://acme.okta.com/" does not produce "//api/v1/logs".
   */
  public static buildBaseUrl(orgUrl: string): string {
    return orgUrl.trim().replace(/\/+$/, "");
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getRequestCount(): number {
    return this.requestCount;
  }

  /*
   * Parse an RFC 8288 Link header into rel -> URL. Node joins repeated
   * `link` headers with ", ", so the value may hold several
   * `<url>; rel="x"` members; commas inside the angle brackets belong to
   * the URL and must not split it.
   */
  public static parseLinkHeader(value: string): Dictionary<string> {
    const links: Dictionary<string> = {};
    const memberRegex: RegExp = /<([^>]*)>\s*((?:;[^,<]*)*)/g;
    let match: RegExpExecArray | null = memberRegex.exec(value);

    while (match) {
      const url: string = (match[1] || "").trim();
      const params: string = match[2] || "";
      const relMatch: RegExpMatchArray | null = params.match(
        /;\s*rel\s*=\s*"?([^";]+)"?/i,
      );

      if (url && relMatch && relMatch[1]) {
        /*
         * rel may carry several space-separated relation types; each of
         * them points at the same URL.
         */
        for (const rel of relMatch[1].trim().split(/\s+/)) {
          links[rel.toLowerCase()] = url;
        }
      }

      match = memberRegex.exec(value);
    }

    return links;
  }

  /*
   * The cheapest authenticated call: one event, no bounds. Answers the
   * question "does Okta accept this token for the System Log at all"
   * before any window or filter is involved.
   */
  public async probe(): Promise<OktaLogEventsPage> {
    const url: URL = new URL(`${this.baseUrl}/api/v1/logs`);
    url.searchParams.set("limit", "1");

    return this.fetchPage(url.toString());
  }

  /*
   * The first page of events published in [startTime, endTime], oldest
   * first. Follow `nextUrl` with listNextPage until it is null or a page
   * comes back empty.
   */
  public async listLogEvents(
    request: ListLogEventsRequest,
  ): Promise<OktaLogEventsPage> {
    const limit: number = Math.max(
      0,
      Math.min(OKTA_MAX_PAGE_SIZE, Math.trunc(request.limit)),
    );

    const url: URL = new URL(`${this.baseUrl}/api/v1/logs`);
    url.searchParams.set("since", OktaClient.toIso(request.startTime));
    url.searchParams.set("until", OktaClient.toIso(request.endTime));
    url.searchParams.set("sortOrder", "ASCENDING");
    url.searchParams.set("limit", String(limit));

    const filter: string = (request.filter || "").trim();

    if (filter) {
      url.searchParams.set("filter", filter);
    }

    return this.fetchPage(url.toString());
  }

  /*
   * Request the page a previous response linked to. Okta's own URL is
   * used as-is (the guide forbids crafting `after` cursors), after
   * checking it belongs to the configured org: the SSWS token is attached
   * to every request, and a Link header must not be able to send it
   * anywhere else.
   */
  public async listNextPage(nextUrl: string): Promise<OktaLogEventsPage> {
    let parsed: URL;

    try {
      parsed = new URL(nextUrl);
    } catch {
      throw new APIException(
        `${OKTA_LOGS_STEP} returned a next link that is not a URL; it was not followed.`,
      );
    }

    if (parsed.origin !== new URL(this.baseUrl).origin) {
      throw new APIException(
        `${OKTA_LOGS_STEP} returned a next link outside the Okta organization URL (${parsed.host}); it was not followed.`,
      );
    }

    return this.fetchPage(parsed.toString());
  }

  /*
   * How many events the window holds, bounded to one page: the count is
   * exact below the page size, and "at least limit" when Okta offered a
   * next page.
   */
  public async countLogEvents(data: {
    startTime: Date | string;
    endTime: Date | string;
    filter?: string | undefined;
  }): Promise<OktaLogEventCount> {
    const page: OktaLogEventsPage = await this.listLogEvents({
      startTime: data.startTime,
      endTime: data.endTime,
      limit: OKTA_MAX_PAGE_SIZE,
      filter: data.filter,
    });

    return {
      count: page.events.length,
      hasMore: page.nextUrl !== null && page.events.length > 0,
    };
  }

  private headers(): Dictionary<string> {
    return {
      Authorization: `SSWS ${this.options.apiToken}`,
      Accept: "application/json",
    };
  }

  private async fetchPage(url: string): Promise<OktaLogEventsPage> {
    const response: DataSourceHttpResponse = await this.send({
      method: "GET",
      url: url,
      headers: this.headers(),
      timeoutInMs: this.options.requestTimeoutInMs,
    });

    return {
      events: this.parseEventsBody(response),
      nextUrl: OktaClient.readNextLink(response),
    };
  }

  /*
   * Send through the transport and normalize the two ways a failure
   * arrives (a thrown transport error, or a fixture's non-2xx status) into
   * one OktaHttpError / APIException taxonomy.
   */
  private async send(
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> {
    let response: DataSourceHttpResponse;
    this.requestCount += 1;

    try {
      response = await this.options.transport(request);
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      const match: RegExpMatchArray | null = message.match(
        TRANSPORT_HTTP_FAILURE_REGEX,
      );

      if (match && match[1]) {
        const status: number = Number(match[1]);
        throw new OktaHttpError(
          `${OKTA_LOGS_STEP} failed (HTTP ${status}): ${this.redactBody(match[2] || "")}${OktaClient.describeHttpFailure(status)}`,
          status,
        );
      }

      /*
       * No status at all: a timeout, a refused connection, a DNS failure
       * or the egress guard. Nothing came back, so the message assigns no
       * side; the connector's remediation text talks about reachability.
       */
      throw new APIException(
        `${OKTA_LOGS_STEP} did not complete: ${this.scrub(redactLogString(message))}`,
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new OktaHttpError(
        `${OKTA_LOGS_STEP} failed (HTTP ${response.statusCode}): ${this.redactBody(response.bodyText || "")}${OktaClient.describeHttpFailure(response.statusCode)}`,
        response.statusCode,
      );
    }

    return response;
  }

  private parseEventsBody(response: DataSourceHttpResponse): Array<JSONObject> {
    const body: JSONValue | undefined = response.bodyJson as
      | JSONValue
      | undefined;

    if (body === undefined) {
      throw new APIException(`${OKTA_LOGS_STEP} returned a non-JSON body.`);
    }

    /*
     * A 200 whose body is not an array is never "no events": Okta's error
     * envelope is a JSON object, and so is whatever a proxy or a login
     * page in front of the org returns. Counting either as an empty
     * window would let the poller advance its cursor past events it
     * never read.
     */
    if (!Array.isArray(body)) {
      throw new APIException(
        `${OKTA_LOGS_STEP} returned an unrecognized response shape: ${this.summarize(body)}`,
      );
    }

    const events: Array<JSONObject> = [];

    for (const item of body as Array<JSONValue>) {
      if (OktaClient.isJsonObject(item)) {
        events.push(item);
      }
    }

    return events;
  }

  private static readNextLink(response: DataSourceHttpResponse): string | null {
    const headers: Dictionary<string> = response.headers || {};
    let value: string = "";

    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "link") {
        value = headers[key] || "";
        break;
      }
    }

    if (!value) {
      return null;
    }

    const links: Dictionary<string> = OktaClient.parseLinkHeader(value);

    return links["next"] || null;
  }

  /*
   * Operator guidance appended behind the echoed body, keyed by status.
   * The prefix, status and body ahead of it are the contract the docs are
   * written against; this only adds to the tail. Error codes are Okta's
   * (E0000011 invalid token, E0000006 access denied, E0000047 rate limit,
   * E0000053 invalid filter / range, E0000009 query timeout).
   */
  public static describeHttpFailure(status: number): string {
    let hint: string = "";

    if (status === 400) {
      hint =
        "Okta rejected the request parameters. Usually the Event filter is not a valid System Log filter expression (operators are eq, ne, co, sw, ew, pr, gt, ge, lt and le joined with and/or; the published attribute cannot be filtered), or the requested range starts more than 180 days ago.";
    } else if (status === 401) {
      hint =
        "Okta did not accept the API token. SSWS tokens expire after 30 days without use and are deprovisioned when the admin who created them is deactivated; create a new token and update the credentials.";
    } else if (status === 403) {
      hint =
        "The token authenticated but is not allowed to read the System Log. API tokens inherit the privileges of the admin who created them: use a token created by a Read-only Administrator or Super Administrator, and check the token's network zone restriction allows requests from OneUptime.";
    } else if (status === 404) {
      hint =
        "Okta answered 404. Check the Okta organization URL: it must be the org's base URL such as https://acme.okta.com, without a path.";
    } else if (status === 429) {
      hint =
        "Okta is rate limiting the token. System Log requests share the org's API rate limit and each token is capped at a percentage of it; the poll will be retried on the next interval.";
    } else if (status >= 500) {
      hint =
        "Okta failed internally or the query took longer than Okta's 30 second limit. The poll will be retried.";
    } else if (status >= 300 && status < 400) {
      hint =
        "Okta redirected the request. Redirects are refused; use the org's own URL (not the -admin URL) directly.";
    }

    return hint ? ` — ${hint}` : "";
  }

  /*
   * The body of a failed response is quoted into check messages and the
   * connection's lastError, so it is decoded and structurally redacted
   * first (a JSON message can itself contain credential JSON), then the
   * configured token is scrubbed as a literal in case Okta echoed it.
   */
  private redactBody(body: string): string {
    const excerpt: string = body.substring(0, 500);

    try {
      return this.scrub(
        JSON.stringify(redactLogValue(JSON.parse(excerpt) as JSONValue)),
      );
    } catch {
      return this.scrub(redactLogString(excerpt));
    }
  }

  private summarize(body: JSONValue): string {
    return this.scrub(JSON.stringify(redactLogValue(body)).substring(0, 300));
  }

  /*
   * The textual redaction rules know Bearer/Basic/Token schemes but not
   * "SSWS", so the configured token is removed as a literal as well.
   */
  private scrub(text: string): string {
    const apiToken: string = this.options.apiToken;

    if (!apiToken || !text) {
      return text;
    }

    return text.split(apiToken).join(REDACTED);
  }

  private static toIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
  }

  private static isJsonObject(
    value: JSONValue | undefined | null,
  ): value is JSONObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
