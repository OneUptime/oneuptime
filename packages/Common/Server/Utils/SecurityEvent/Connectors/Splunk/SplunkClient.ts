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
 * Splunk REST client for the Splunk Enterprise Security connector.
 *
 * Three calls, all verified against Splunk's reference pages:
 *
 *  - Who am I: GET {url}/services/authentication/current-context
 *    (https://help.splunk.com/en/splunk-enterprise/leverage-rest-apis/rest-api-reference/10.4/access-endpoints/access-endpoint-descriptions
 *    — "Get the authenticated session owner username", response keys
 *    `username`, `roles`, `capabilities`). It is the cheapest request
 *    that proves a credential is accepted without running a search.
 *
 *  - Export search: POST {url}/services/search/v2/jobs/export
 *    (https://help.splunk.com/en/splunk-enterprise/leverage-rest-apis/rest-api-reference/10.4/search-endpoints/search-endpoint-descriptions).
 *    "Stream search results as they become available. The POST operation
 *    on this endpoint performs a search identical to a POST to
 *    search/jobs" — parameters `search` (must start with a command,
 *    "search ..."), `earliest_time` ("Sets the earliest (inclusive)
 *    ... time bounds", a UTC epoch value is accepted), `latest_time`
 *    ("Sets the latest (exclusive) ...") and `output_mode` (json). The
 *    GET operation "is not available in the v2 iteration"; the v1
 *    endpoint search/jobs/export "is deprecated as of Splunk Enterprise
 *    9.0.1", so v2 is tried first and v1 only when v2 answers 404 (a
 *    pre-9.0 search head).
 *
 *    With output_mode=json the export body is newline-delimited JSON,
 *    one object per line shaped `{"preview":false,"offset":0,"result":
 *    {...}}` (the final line also carries `"lastrow":true`); preview
 *    lines are interim results of a non-streaming search and must be
 *    ignored
 *    (https://community.splunk.com/t5/Getting-Data-In/REST-API-JSON-output-only-with-quot-result-quot-field-without/td-p/482318).
 *
 *    An event search streams newest first, so a plain `| head N` keeps
 *    the NEWEST rows of a window that holds more than N and the older
 *    ones can never be reached. A window read therefore sorts first:
 *    `sort 0 _time` ("If 0 is specified, all results are returned";
 *    without a count sort stops at 10,000) orders the window ascending,
 *    the default direction, so `head` keeps the OLDEST rows and the
 *    connector can report where the next read resumes
 *    (https://help.splunk.com/en/splunk-enterprise/search/spl-search-reference/10.0/search-commands/sort).
 *
 *  - Authentication: `Authorization: Bearer <token>` for a Splunk
 *    authentication token
 *    (https://help.splunk.com/en/splunk-enterprise/administer/manage-users-and-security/10.4/authenticate-into-the-splunk-platform-with-tokens/use-authentication-tokens),
 *    else HTTP basic with username and password, which every management
 *    port endpoint accepts.
 *
 * The search head URL is chosen by the tenant, so every request goes
 * through the injected ConnectorTransport (the SSRF-guarded
 * DataSourceHttpFetch in production). Errors are thrown as APIException
 * with a prefix naming the step, and any echoed body is run through the
 * log redactor first so a credential can never ride an error message
 * into lastError or a log sink.
 */

const ERROR_PREFIX: string = "Splunk Enterprise Security";

/*
 * Ceiling on rows one export may return. The poller's per-run event bound
 * is at most this, and the tester asks for one, so a runaway search
 * string cannot stream an unbounded body into the process.
 */
export const SPLUNK_MAX_EXPORT_ROWS: number = 10000;

// Every notable carries this when read through the notable index.
export const SPLUNK_DEFAULT_SEARCH: string = "index=notable";

/*
 * Module-level so the regexes need no inline parentheses: eslint's
 * wrap-regex and prettier disagree about those and never converge.
 */
const TIME_MODIFIER_REGEX: RegExp =
  /\b(earliest|latest|index_earliest|index_latest)\s*=/i;
const HTML_BODY_REGEX: RegExp = /<html|<!doctype/i;

export interface SplunkClientOptions {
  // Management URL, e.g. https://splunk.example.com:8089 (no trailing slash).
  url: string;
  apiToken?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
  // The tenant's SPL selector, without the leading "search" command.
  searchString: string;
  transport: ConnectorTransport;
  requestTimeoutInMs: number;
}

export interface SplunkExportRequest {
  startTime: Date;
  endTime: Date;
  maxResults: number;
  /*
   * Sort the window by `_time` ascending before the row cap, so a capped
   * read keeps the oldest rows. Defaults to true because a window read
   * that keeps the newest rows can never make progress; only a probe
   * that does not care which row comes back turns it off, to avoid
   * sorting a whole day on the search head for one row.
   */
  oldestFirst?: boolean | undefined;
}

export interface SplunkCurrentContext {
  username: string;
  roles: Array<string>;
  capabilities: Array<string>;
}

export interface SplunkExportResult {
  results: Array<JSONObject>;
  /*
   * True when Splunk had more rows than `maxResults`: the client asks for
   * one row beyond the cap, so this is an observation, not a guess.
   */
  truncated: boolean;
  // Which endpoint served the export ("v2" or the deprecated "v1").
  apiVersion: "v1" | "v2";
}

export interface SplunkCount {
  count: number;
}

export default class SplunkClient {
  private url: string;
  private apiToken: string;
  private username: string;
  private password: string;
  private searchString: string;
  private transport: ConnectorTransport;
  private requestTimeoutInMs: number;

  private requestCount: number = 0;

  /*
   * Remembered after a v2 404 so a fetch that falls back to v1 does not
   * pay the failed v2 request again for its count probes.
   */
  private useLegacyExport: boolean = false;

  public constructor(options: SplunkClientOptions) {
    this.url = SplunkClient.normalizeBaseUrl(options.url);
    this.apiToken = (options.apiToken || "").trim();
    this.username = (options.username || "").trim();
    this.password = options.password || "";
    this.searchString = SplunkClient.normalizeSearchString(
      options.searchString,
    );
    this.transport = options.transport;
    this.requestTimeoutInMs = options.requestTimeoutInMs;

    if (!this.apiToken && !(this.username && this.password)) {
      throw new BadDataException(
        "Splunk needs an authentication token, or a username and password.",
      );
    }
  }

  /*
   * Accept the URL the way people paste it (trailing slash, mixed case
   * host) and refuse what would silently break: a query string or
   * fragment would be glued onto every endpoint path.
   */
  public static normalizeBaseUrl(raw: string): string {
    let parsed: URL;

    try {
      parsed = new URL((raw || "").trim());
    } catch {
      throw new BadDataException(
        "Splunk management URL must be a URL such as https://splunk.example.com:8089.",
      );
    }

    if (parsed.protocol !== "https:") {
      throw new BadDataException(
        "Splunk management URL must use https (the management port serves TLS by default).",
      );
    }

    if (parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new BadDataException(
        "Splunk management URL must not contain a query string, fragment or credentials.",
      );
    }

    const path: string = parsed.pathname.replace(/\/+$/, "");

    return `${parsed.origin}${path}`;
  }

  /*
   * The connector prefixes the SPL with the `search` command itself, so a
   * pasted "search index=notable" would otherwise become "search search
   * index=notable" and fail. A generating command ("| tstats ...") can
   * never follow `search`, and a time modifier inside the string would
   * silently override the window the poller computed — both are refused
   * rather than guessed at.
   */
  public static normalizeSearchString(raw: string): string {
    let search: string = (raw || "").trim();

    if (!search) {
      search = SPLUNK_DEFAULT_SEARCH;
    }

    search = search.replace(/^search\s+/i, "").trim();

    if (!search || search.startsWith("|")) {
      throw new BadDataException(
        "Search must be a filter such as index=notable; it cannot start with a pipe or a generating command.",
      );
    }

    if (TIME_MODIFIER_REGEX.test(search)) {
      throw new BadDataException(
        "Search must not contain earliest or latest; the connector sets the time range itself.",
      );
    }

    return search;
  }

  /*
   * Outbound requests made so far by this instance: the poller's request
   * budget counts every call that leaves the process, a v1 fallback
   * included.
   */
  public getRequestCount(): number {
    return this.requestCount;
  }

  public buildCurrentContextUrl(): string {
    const url: URL = new URL(
      `${this.url}/services/authentication/current-context`,
    );
    url.searchParams.set("output_mode", "json");
    return url.toString();
  }

  public buildExportUrl(version: "v1" | "v2"): string {
    return version === "v2"
      ? `${this.url}/services/search/v2/jobs/export`
      : `${this.url}/services/search/jobs/export`;
  }

  /*
   * The SPL sent for a window read: the tenant's selector, every field
   * (the export of a plain `search` otherwise omits fields the search
   * did not reference), an ascending `_time` sort when the read must
   * keep the oldest rows, and a hard row cap so the body is bounded.
   */
  public buildExportSearch(maxRows: number, oldestFirst: boolean): string {
    /*
     * The row cap may be the ceiling plus the one probe row exportSearch
     * adds to observe "there was more"; anything beyond that is refused.
     */
    const rows: number =
      !Number.isFinite(maxRows) || maxRows < 1
        ? 1
        : Math.min(Math.floor(maxRows), SPLUNK_MAX_EXPORT_ROWS + 1);

    /*
     * `sort 0`, not `sort`: without a count sort returns at most 10,000
     * rows, which would silently cap the read below the probe row.
     */
    const order: string = oldestFirst ? " | sort 0 _time" : "";

    return `search ${this.searchString} | fields *${order} | head ${rows}`;
  }

  public buildCountSearch(): string {
    return `search ${this.searchString} | stats count`;
  }

  public static clampRows(rows: number): number {
    if (!Number.isFinite(rows) || rows < 1) {
      return 1;
    }

    return Math.min(Math.floor(rows), SPLUNK_MAX_EXPORT_ROWS);
  }

  /*
   * Window bounds as epoch seconds. earliest_time is inclusive and
   * latest_time exclusive on Splunk's side, matching ConnectorFetchWindow;
   * the start is floored and the end ceiled so a sub-second boundary can
   * only widen the window, never lose a row — duplicates are removed by
   * the poller's dedupe, a missed row is gone.
   */
  public static toEpochSeconds(date: Date, roundUp: boolean): string {
    const seconds: number = date.getTime() / 1000;
    return String(roundUp ? Math.ceil(seconds) : Math.floor(seconds));
  }

  public buildAuthorizationHeader(): string {
    if (this.apiToken) {
      return `Bearer ${this.apiToken}`;
    }

    return `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
  }

  /*
   * Proves the credential is accepted and reports who Splunk thinks the
   * caller is, so the test report can name the user and roles the tenant
   * should compare against the role they meant to grant.
   */
  public async getCurrentContext(): Promise<SplunkCurrentContext> {
    const response: DataSourceHttpResponse = await this.send(
      "authentication request",
      {
        method: "GET",
        url: this.buildCurrentContextUrl(),
        headers: this.buildHeaders(),
        timeoutInMs: this.requestTimeoutInMs,
        egressOptions: { targetLabel: "Splunk" },
      },
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new APIException(
        `${ERROR_PREFIX} authentication request failed (HTTP ${response.statusCode}): ${SplunkClient.redactErrorBody(response.bodyText)}` +
          SplunkClient.describeFailure(response.statusCode, response),
      );
    }

    const json: JSONValue = SplunkClient.parseJsonBody(response);

    if (!SplunkClient.isJsonObject(json)) {
      throw new APIException(
        `${ERROR_PREFIX} authentication request returned a non-JSON body.` +
          SplunkClient.describeNonJsonBody(response.bodyText),
      );
    }

    const entries: JSONValue = json["entry"] as JSONValue;
    const first: JSONValue | undefined = Array.isArray(entries)
      ? (entries as JSONArray)[0]
      : undefined;
    const content: JSONValue | undefined = SplunkClient.isJsonObject(first)
      ? (first["content"] as JSONValue)
      : undefined;

    if (!SplunkClient.isJsonObject(content)) {
      throw new APIException(
        `${ERROR_PREFIX} authentication request returned an unrecognized response shape: ${SplunkClient.redactErrorBody(response.bodyText)}`,
      );
    }

    return {
      username: String(content["username"] || ""),
      roles: SplunkClient.stringArray(content["roles"] as JSONValue),
      capabilities: SplunkClient.stringArray(
        content["capabilities"] as JSONValue,
      ),
    };
  }

  /*
   * Rows the search returns in [startTime, endTime), at most maxResults,
   * oldest first unless the caller opts out. One extra row is requested
   * so "there was more" is observed rather than inferred from a full
   * page.
   */
  public async exportSearch(
    data: SplunkExportRequest,
  ): Promise<SplunkExportResult> {
    const cap: number = SplunkClient.clampRows(data.maxResults);
    const probe: number = Math.min(cap + 1, SPLUNK_MAX_EXPORT_ROWS + 1);
    const oldestFirst: boolean = data.oldestFirst !== false;

    const { rows, apiVersion } = await this.runExport(
      "search export",
      this.buildExportSearch(probe, oldestFirst),
      data.startTime,
      data.endTime,
    );

    return {
      results: rows.slice(0, cap),
      truncated: rows.length > cap,
      apiVersion,
    };
  }

  /*
   * How many rows the search matches in the range. `stats count` is a
   * single-row transforming search, so the answer is bounded by
   * construction; Splunk does the counting.
   */
  public async countSearch(data: {
    startTime: Date;
    endTime: Date;
  }): Promise<SplunkCount> {
    const { rows } = await this.runExport(
      "count search",
      this.buildCountSearch(),
      data.startTime,
      data.endTime,
    );

    const first: JSONObject | undefined = rows[0];
    const count: number = first ? Number(first["count"]) : 0;

    if (!Number.isFinite(count) || count < 0) {
      throw new APIException(
        `${ERROR_PREFIX} count search returned an unrecognized response shape: ${redactLogString(JSON.stringify(rows.slice(0, 3)))}`,
      );
    }

    return { count };
  }

  private async runExport(
    step: string,
    search: string,
    startTime: Date,
    endTime: Date,
  ): Promise<{ rows: Array<JSONObject>; apiVersion: "v1" | "v2" }> {
    const body: Dictionary<string> = {
      search,
      earliest_time: SplunkClient.toEpochSeconds(startTime, false),
      latest_time: SplunkClient.toEpochSeconds(endTime, true),
      output_mode: "json",
    };

    let apiVersion: "v1" | "v2" = this.useLegacyExport ? "v1" : "v2";
    let response: DataSourceHttpResponse = await this.sendExport(
      step,
      apiVersion,
      body,
    );

    /*
     * A 404 on the v2 path is a search head older than 9.0, where only
     * the original endpoint exists. Anything else on v2 is a real answer
     * and is reported as such.
     */
    if (response.statusCode === 404 && apiVersion === "v2") {
      this.useLegacyExport = true;
      apiVersion = "v1";
      response = await this.sendExport(step, apiVersion, body);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new APIException(
        `${ERROR_PREFIX} ${step} failed (HTTP ${response.statusCode}): ${SplunkClient.redactErrorBody(response.bodyText)}` +
          SplunkClient.describeFailure(response.statusCode, response),
      );
    }

    return { rows: this.parseExportBody(step, response.bodyText), apiVersion };
  }

  private async sendExport(
    step: string,
    apiVersion: "v1" | "v2",
    body: Dictionary<string>,
  ): Promise<DataSourceHttpResponse> {
    return this.send(step, {
      method: "POST",
      url: this.buildExportUrl(apiVersion),
      headers: this.buildHeaders(),
      body,
      formUrlEncoded: true,
      timeoutInMs: this.requestTimeoutInMs,
      egressOptions: { targetLabel: "Splunk" },
    });
  }

  /*
   * Newline-delimited JSON, one object per line. An empty body is a
   * legitimate "no rows" answer for an export. A line that is not JSON
   * means the URL points at something other than the management port
   * (Splunk Web on 8000 answers HTML) and is reported, not skipped —
   * treating an unreadable body as an empty window would move the
   * cursor past whatever it held.
   */
  private parseExportBody(step: string, bodyText: string): Array<JSONObject> {
    const rows: Array<JSONObject> = [];
    const lines: Array<string> = (bodyText || "").split(/\r?\n/);

    for (const line of lines) {
      const trimmed: string = line.trim();

      if (!trimmed) {
        continue;
      }

      let parsed: JSONValue;

      try {
        parsed = JSON.parse(trimmed) as JSONValue;
      } catch {
        throw new APIException(
          `${ERROR_PREFIX} ${step} returned a body that is not newline-delimited JSON.` +
            SplunkClient.describeNonJsonBody(bodyText),
        );
      }

      if (!SplunkClient.isJsonObject(parsed)) {
        continue;
      }

      /*
       * Splunk can answer 200 and put the search failure inside the
       * stream as a message line; that is a rejection, not an empty
       * window.
       */
      const fatal: string = SplunkClient.findFatalMessage(parsed);

      if (fatal) {
        throw new APIException(
          `${ERROR_PREFIX} ${step} was rejected by Splunk on an HTTP 200: ${redactLogString(fatal)}`,
        );
      }

      if (parsed["preview"] === true) {
        continue;
      }

      const result: JSONValue = parsed["result"] as JSONValue;

      if (SplunkClient.isJsonObject(result)) {
        rows.push(result);
      }
    }

    return rows;
  }

  private static findFatalMessage(row: JSONObject): string {
    const messages: JSONValue = row["messages"] as JSONValue;

    if (!Array.isArray(messages)) {
      return "";
    }

    for (const message of messages as JSONArray) {
      if (!SplunkClient.isJsonObject(message)) {
        continue;
      }

      const type: string = String(message["type"] || "").toUpperCase();

      if (type === "FATAL" || type === "ERROR") {
        return String(message["text"] || type);
      }
    }

    return "";
  }

  private buildHeaders(): Dictionary<string> {
    return {
      Authorization: this.buildAuthorizationHeader(),
      Accept: "application/json",
    };
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

  private static stringArray(value: JSONValue): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    return (value as JSONArray)
      .filter((item: JSONValue): boolean => {
        return typeof item === "string" || typeof item === "number";
      })
      .map((item: JSONValue): string => {
        return String(item);
      });
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

  private static describeNonJsonBody(body: string): string {
    if (HTML_BODY_REGEX.test(body || "")) {
      return " Splunk answered with HTML, which is what Splunk Web (port 8000) returns; the Splunk management URL must point at the management port, usually 8089.";
    }

    return "";
  }

  /*
   * Splunk's error body is { messages: [{ type, text }] }; the text is
   * echoed (redacted) above, the status decides the hint.
   */
  private static describeFailure(
    status: number,
    response: DataSourceHttpResponse,
  ): string {
    let hint: string = "";

    if (status === 401) {
      hint =
        "Splunk did not accept the credentials. The authentication token is wrong, expired or revoked, or the username and password are wrong. Token authentication must also be enabled on the search head (Settings > Tokens).";
    } else if (status === 403) {
      hint =
        "Splunk accepted the credentials but the user's role lacks what this needs: the search capability and access to the searched index (index=notable for Splunk Enterprise Security).";
    } else if (status === 404) {
      hint =
        "Splunk did not find the endpoint. The Splunk management URL must be the search head's management port (usually 8089) with no extra path; Splunk Web on port 8000 does not serve the REST API.";
    } else if (status === 429) {
      const retryAfter: string = (response.headers || {})["retry-after"] || "";
      hint = retryAfter
        ? `Splunk throttled the request; it asked to retry after ${redactLogString(retryAfter)} seconds. The next poll retries the same window.`
        : "Splunk throttled the request. The next poll retries the same window.";
    } else if (status >= 500) {
      hint =
        "Splunk reported a server-side error (a search head under load, or a search that hit a limit). The next poll retries the same window.";
    } else if (status === 400) {
      hint =
        "Splunk rejected the search. Check the Search setting for a syntax error; the connector only adds the time range, `| fields *`, `| sort 0 _time` and `| head`.";
    }

    return hint ? ` — ${hint}` : "";
  }
}
