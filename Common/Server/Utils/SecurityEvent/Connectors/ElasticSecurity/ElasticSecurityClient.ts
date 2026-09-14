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
 * Minimal Kibana client for the Elastic Security connector.
 *
 * Two endpoints, both checked against Elastic's published API reference:
 *
 *  - GET  {base}/api/status — Kibana's own status document, used as the
 *    authentication probe because every Kibana serves it whatever features
 *    are installed. Per the reference
 *    (https://www.elastic.co/docs/api/doc/kibana/operation/operation-get-status)
 *    an UNauthenticated caller receives a redacted body that carries only
 *    the overall status level, so a response without `name`/`version`
 *    means the API key was not applied — not that Kibana is healthy.
 *  - POST {base}/api/detection_engine/signals/search — an Elasticsearch
 *    query DSL request against the space's detection alerts index,
 *    answered with a raw Elasticsearch search response
 *    (https://www.elastic.co/docs/api/doc/kibana/operation/operation-searchalerts).
 *    The documented request body accepts exactly `_source`, `aggs`,
 *    `fields`, `query`, `runtime_mappings`, `size`, `sort` and
 *    `track_total_hits`. Neither `search_after` nor `from` is part of the
 *    contract, so this client exposes range + size only and leaves paging
 *    to the connector, which advances the @timestamp lower bound.
 *
 * Auth is `Authorization: ApiKey <base64 id:api_key>` (the `encoded` value
 * of a created key). Kibana requires `kbn-xsrf` on every non-GET request;
 * the value is arbitrary and `true` is the documented convention.
 *
 * Every request goes through the injected transport (the SSRF-guarded
 * DataSourceHttpFetch in production). That transport throws on non-2xx
 * statuses with a "Data source responded with HTTP <n>: <body>" message,
 * while a test fixture may hand back the status directly; both paths are
 * folded into ElasticSecurityHttpError so callers see one taxonomy.
 */

export interface ElasticSecurityClientOptions {
  kibanaUrl: string;
  // Kibana space id; empty for the default space.
  space: string;
  apiKey: string;
  transport: ConnectorTransport;
  requestTimeoutInMs: number;
}

export interface ElasticAlertHit {
  id: string;
  index: string;
  source: JSONObject;
  // The alert's own @timestamp, i.e. the rule execution that created it.
  timestamp: string;
}

export interface ElasticSearchAlertsResult {
  hits: Array<ElasticAlertHit>;
  /*
   * hits.total.value when Elasticsearch reported one (always, when the
   * request set track_total_hits: true); null otherwise.
   */
  total: number | null;
  // "eq" for an exact total, "gte" for a lower bound.
  totalRelation: "eq" | "gte" | null;
}

export interface ElasticKibanaStatus {
  // Present only when the request was authenticated.
  name: string;
  version: string;
  level: string;
  summary: string;
  authenticated: boolean;
}

export interface ElasticAlertCount {
  count: number;
  // False when Elasticsearch answered with a lower bound ("gte").
  exact: boolean;
}

export interface SearchAlertsRequest {
  // Inclusive lower bound on @timestamp.
  startTime: Date | string;
  // Exclusive upper bound on @timestamp.
  endTime: Date | string;
  size: number;
  /*
   * Ask Elasticsearch for an exact hits.total. Only the availability
   * count sets this; a listing page does not pay for it.
   */
  trackTotalHits?: boolean | undefined;
}

/*
 * One request never asks for more than this many alerts. Elasticsearch
 * caps a plain search at index.max_result_window (10,000 by default) and a
 * page of a thousand full alert documents is already several megabytes,
 * which is where the transport's response-size cap starts to matter.
 */
export const ELASTIC_SECURITY_MAX_PAGE_SIZE: number = 1000;

export const ELASTIC_STATUS_STEP: string = "Elastic Security status request";
export const ELASTIC_SEARCH_STEP: string = "Elastic Security alerts search";

/*
 * Thrown for every failure that carries an HTTP status, so the connector
 * can pick remediation text per status without parsing the message.
 */
export class ElasticSecurityHttpError extends APIException {
  public statusCode: number;

  public constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

const TRANSPORT_HTTP_FAILURE_REGEX: RegExp =
  /Data source responded with HTTP (\d{3}):\s*([\s\S]*)$/;

export default class ElasticSecurityClient {
  private options: ElasticSecurityClientOptions;
  private baseUrl: string;
  private requestCount: number = 0;

  public constructor(options: ElasticSecurityClientOptions) {
    this.options = options;
    this.baseUrl = ElasticSecurityClient.buildBaseUrl(
      options.kibanaUrl,
      options.space,
    );
  }

  /*
   * {kibanaUrl}[/s/{space}] with trailing slashes removed, so a URL pasted
   * as "https://kibana.example.com/" does not produce "//api/status".
   * Kibana scopes every API to a space through this path prefix; the
   * default space has no prefix.
   */
  public static buildBaseUrl(kibanaUrl: string, space: string): string {
    const trimmed: string = kibanaUrl.trim().replace(/\/+$/, "");
    const spaceId: string = space.trim();

    if (!spaceId || spaceId === "default") {
      return trimmed;
    }

    return `${trimmed}/s/${encodeURIComponent(spaceId)}`;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getRequestCount(): number {
    return this.requestCount;
  }

  public async getStatus(): Promise<ElasticKibanaStatus> {
    const response: DataSourceHttpResponse = await this.send(
      ELASTIC_STATUS_STEP,
      {
        method: "GET",
        url: `${this.baseUrl}/api/status`,
        headers: this.headers(),
        timeoutInMs: this.options.requestTimeoutInMs,
      },
    );

    const body: JSONValue | undefined = response.bodyJson as
      | JSONValue
      | undefined;

    if (!ElasticSecurityClient.isJsonObject(body)) {
      throw new APIException(
        `${ELASTIC_STATUS_STEP} returned a non-JSON body.`,
      );
    }

    const status: JSONValue | undefined = body["status"];
    const version: JSONValue | undefined = body["version"];

    /*
     * Both the authenticated and the redacted status document carry a
     * `status` object. A JSON body without one is something else entirely
     * (a proxy's error envelope, a different product on that URL) and is
     * reported as such rather than read as "not authenticated".
     */
    if (!ElasticSecurityClient.isJsonObject(status)) {
      throw new APIException(
        `${ELASTIC_STATUS_STEP} returned an unrecognized response shape: ${this.summarize(body)}`,
      );
    }

    const overall: JSONValue | undefined = status["overall"];
    const name: string = ElasticSecurityClient.readText(body["name"]);
    const versionNumber: string = ElasticSecurityClient.isJsonObject(version)
      ? ElasticSecurityClient.readText(version["number"])
      : "";

    return {
      name,
      version: versionNumber,
      level: ElasticSecurityClient.isJsonObject(overall)
        ? ElasticSecurityClient.readText(overall["level"])
        : "",
      summary: ElasticSecurityClient.isJsonObject(overall)
        ? ElasticSecurityClient.readText(overall["summary"])
        : "",
      authenticated: Boolean(name || versionNumber),
    };
  }

  /*
   * One page of alerts created in [startTime, endTime), oldest first. The
   * query is a single range filter on @timestamp, the field Kibana stamps
   * with the rule execution time — the CREATION basis the poller needs.
   */
  public async searchAlerts(
    request: SearchAlertsRequest,
  ): Promise<ElasticSearchAlertsResult> {
    const size: number = Math.max(
      0,
      Math.min(ELASTIC_SECURITY_MAX_PAGE_SIZE, Math.trunc(request.size)),
    );

    const body: JSONObject = {
      query: {
        range: {
          "@timestamp": {
            gte: ElasticSecurityClient.toIso(request.startTime),
            lt: ElasticSecurityClient.toIso(request.endTime),
          },
        },
      },
      size: size,
    };

    /*
     * Sorting on _id is not allowed in Elasticsearch 8 (fielddata on _id
     * is disabled), so @timestamp alone orders the page; the connector
     * breaks ties by remembering ids across pages.
     */
    if (size > 0) {
      body["sort"] = [{ "@timestamp": "asc" }];
    }

    if (request.trackTotalHits) {
      body["track_total_hits"] = true;
    }

    const response: DataSourceHttpResponse = await this.send(
      ELASTIC_SEARCH_STEP,
      {
        method: "POST",
        url: `${this.baseUrl}/api/detection_engine/signals/search`,
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        timeoutInMs: this.options.requestTimeoutInMs,
      },
    );

    return this.parseSearchBody(response);
  }

  /*
   * Number of alerts created in the window, in one request: size 0 with
   * track_total_hits so Elasticsearch counts past its default 10,000 cap
   * instead of answering "gte 10000".
   */
  public async countAlerts(data: {
    startTime: Date | string;
    endTime: Date | string;
  }): Promise<ElasticAlertCount> {
    const result: ElasticSearchAlertsResult = await this.searchAlerts({
      startTime: data.startTime,
      endTime: data.endTime,
      size: 0,
      trackTotalHits: true,
    });

    if (result.total === null) {
      throw new APIException(
        `${ELASTIC_SEARCH_STEP} returned an unrecognized response shape: hits.total is missing.`,
      );
    }

    return { count: result.total, exact: result.totalRelation !== "gte" };
  }

  private headers(): Dictionary<string> {
    return {
      Authorization: `ApiKey ${this.options.apiKey}`,
      "kbn-xsrf": "true",
      Accept: "application/json",
    };
  }

  /*
   * Send through the transport and normalize the two ways a failure
   * arrives (a thrown transport error, or a fixture's non-2xx status) into
   * one ElasticSecurityHttpError / APIException taxonomy.
   */
  private async send(
    step: string,
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
        throw new ElasticSecurityHttpError(
          `${step} failed (HTTP ${status}): ${this.redactBody(match[2] || "")}${ElasticSecurityClient.describeHttpFailure(status)}`,
          status,
        );
      }

      /*
       * No status at all: a timeout, a refused connection, a DNS failure
       * or the egress guard. Nothing came back, so the message assigns no
       * side; the connector's remediation text talks about reachability.
       */
      throw new APIException(
        `${step} did not complete: ${this.scrub(redactLogString(message))}`,
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new ElasticSecurityHttpError(
        `${step} failed (HTTP ${response.statusCode}): ${this.redactBody(response.bodyText || "")}${ElasticSecurityClient.describeHttpFailure(response.statusCode)}`,
        response.statusCode,
      );
    }

    return response;
  }

  private parseSearchBody(
    response: DataSourceHttpResponse,
  ): ElasticSearchAlertsResult {
    const body: JSONValue | undefined = response.bodyJson as
      | JSONValue
      | undefined;

    if (!ElasticSecurityClient.isJsonObject(body)) {
      throw new APIException(
        `${ELASTIC_SEARCH_STEP} returned a non-JSON body.`,
      );
    }

    const hitsEnvelope: JSONValue | undefined = body["hits"];

    /*
     * A body without `hits` is never "no alerts": Kibana's own error
     * envelope ({ statusCode, error, message } or { message, status_code })
     * arrives as JSON too, and counting it as an empty window would let
     * the poller advance its cursor past whatever it did not read.
     */
    if (!ElasticSecurityClient.isJsonObject(hitsEnvelope)) {
      throw new APIException(
        `${ELASTIC_SEARCH_STEP} returned an unrecognized response shape: ${this.summarize(body)}`,
      );
    }

    const rawHits: JSONValue | undefined = hitsEnvelope["hits"];

    if (!Array.isArray(rawHits)) {
      throw new APIException(
        `${ELASTIC_SEARCH_STEP} returned an unrecognized response shape: hits.hits is not an array.`,
      );
    }

    const hits: Array<ElasticAlertHit> = [];

    for (const rawHit of rawHits as Array<unknown>) {
      if (!ElasticSecurityClient.isJsonObject(rawHit as JSONValue)) {
        continue;
      }

      const hit: JSONObject = rawHit as JSONObject;
      const source: JSONValue | undefined = hit["_source"];

      hits.push({
        id: ElasticSecurityClient.readText(hit["_id"]),
        index: ElasticSecurityClient.readText(hit["_index"]),
        source: ElasticSecurityClient.isJsonObject(source) ? source : {},
        timestamp: ElasticSecurityClient.isJsonObject(source)
          ? ElasticSecurityClient.readText(source["@timestamp"])
          : "",
      });
    }

    /*
     * hits.total is { value, relation } by default and a bare number when
     * the cluster runs with rest_total_hits_as_int.
     */
    const total: JSONValue | undefined = hitsEnvelope["total"];
    let totalValue: number | null = null;
    let totalRelation: "eq" | "gte" | null = null;

    if (typeof total === "number" && Number.isFinite(total)) {
      totalValue = total;
      totalRelation = "eq";
    } else if (ElasticSecurityClient.isJsonObject(total)) {
      const value: JSONValue | undefined = total["value"];

      if (typeof value === "number" && Number.isFinite(value)) {
        totalValue = value;
        totalRelation =
          ElasticSecurityClient.readText(total["relation"]) === "gte"
            ? "gte"
            : "eq";
      }
    }

    return { hits, total: totalValue, totalRelation };
  }

  /*
   * Operator guidance appended behind the echoed body, keyed by status.
   * The prefix, status and body ahead of it are the contract the docs are
   * written against; this only adds to the tail. Privilege names follow
   * https://www.elastic.co/guide/en/security/current/detections-permissions-section.html
   */
  public static describeHttpFailure(status: number): string {
    let hint: string = "";

    if (status === 401) {
      hint =
        "Kibana did not accept the API key. Paste the key's base64 encoded value (shown once as 'encoded' or 'Base64' when the key is created), and check that the key has not expired or been invalidated.";
    } else if (status === 403) {
      hint =
        "The API key authenticated but lacks privileges. It needs the Kibana Security feature privilege that allows viewing alerts in this space, and read plus view_index_metadata on the .alerts-security.alerts-<space-id> index.";
    } else if (status === 404) {
      hint =
        "Kibana answered 404. Check the Kibana URL (the origin Kibana is served from, without a trailing path) and the space id; the detection engine API lives at /api/detection_engine under that base.";
    } else if (status === 429) {
      hint =
        "Kibana or Elasticsearch is rate limiting requests. The poll will be retried on the next interval.";
    } else if (status === 503) {
      hint =
        "Kibana reports itself unavailable, usually because Elasticsearch is unreachable or still starting.";
    } else if (status >= 500) {
      hint =
        "Kibana or Elasticsearch failed internally. Check the Kibana server logs; the poll will be retried.";
    } else if (status >= 300 && status < 400) {
      hint =
        "Kibana redirected the request. Redirects are refused; use the URL Kibana is served from directly.";
    }

    return hint ? ` — ${hint}` : "";
  }

  /*
   * The body of a failed response is quoted into check messages and the
   * connection's lastError, so it is decoded and structurally redacted
   * first (a JSON message can itself contain credential JSON), then the
   * configured key is scrubbed as a literal in case Kibana echoed it.
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

  private summarize(body: JSONObject): string {
    return this.scrub(JSON.stringify(redactLogValue(body)).substring(0, 300));
  }

  /*
   * The textual redaction rules know Bearer/Basic/Token schemes but not
   * "ApiKey", so the configured key is removed as a literal as well.
   */
  private scrub(text: string): string {
    const apiKey: string = this.options.apiKey;

    if (!apiKey || !text) {
      return text;
    }

    return text.split(apiKey).join(REDACTED);
  }

  private static toIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
  }

  private static readText(value: JSONValue | undefined): string {
    if (value === null || value === undefined || typeof value === "object") {
      return "";
    }

    return String(value);
  }

  private static isJsonObject(
    value: JSONValue | undefined | null,
  ): value is JSONObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
