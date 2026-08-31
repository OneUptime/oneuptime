import { createPrivateKey } from "crypto";
import jwt from "jsonwebtoken";
import BadDataException from "../../../../Types/Exception/BadDataException";
import APIException from "../../../../Types/Exception/ApiException";
import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";
import logger from "../../Logger";

/*
 * Minimal Google SecOps (Chronicle) API client for the detections poller.
 *
 * Auth is the standard Google service-account JWT-bearer exchange: sign a
 * short-lived RS256 assertion with the account's private key, trade it at
 * the token endpoint for an access token, cache until near expiry. No
 * Google SDK dependency — the exchange is three fields and one POST.
 *
 * The HTTP layer is injectable so unit tests exercise the real request
 * construction and response parsing against fixtures.
 *
 * legacyFetchAlertsView is a server-STREAMING method, so its 200 body is a
 * JSON array of FetchAlertsViewResponse chunks and the alerts sit two
 * levels down at chunk.alerts.alerts[]. Google's REST reference documents
 * the streamed message, never the stream envelope, which is why an earlier
 * version of this file looked for a top-level `alerts` array and therefore
 * returned zero alerts against every well-formed response. The parser
 * below refuses to report "no alerts" for a body it could not recognize —
 * a shape it does not understand throws, because the poller treats an
 * empty result as a healthy poll and advances its cursor past it.
 */

export interface GoogleServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

export interface FetchInitLike {
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
  signal?: AbortSignal | undefined;
}

export type FetchLike = (
  url: string,
  init: FetchInitLike,
) => Promise<FetchResponseLike>;

/*
 * What one alerts fetch learned, not just what it collected. The counts and
 * flags are the only way a caller can tell "the window was quiet" from "the
 * window was truncated" or "the stream ended early", all of which used to
 * arrive as a bare empty array.
 */
export interface FetchAlertsResult {
  alerts: Array<JSONObject>;
  complete: boolean;
  progress: number;
  truncatedByCount: boolean;
  truncatedByBytes: boolean;
  baselineAlertsCount: number;
  filteredAlertsCount: number;
  chunkCount: number;
}

const CHRONICLE_SCOPE: string =
  "https://www.googleapis.com/auth/cloud-platform";
const TOKEN_LIFETIME_IN_SECONDS: number = 3600;
const TOKEN_EXPIRY_SLACK_IN_SECONDS: number = 60;
/*
 * Google rejects an assertion whose iat is in the future, and a host clock
 * a few seconds fast is enough to trigger it — reported back as
 * invalid_grant, which reads exactly like a bad key. Backdate iat instead.
 * exp stays iat + 3600 because 3600 is Google's hard maximum lifetime, so
 * this shortens the token's usable life rather than extending it.
 */
const TOKEN_CLOCK_SKEW_IN_SECONDS: number = 60;
const DEFAULT_MAX_ALERTS: number = 1000;

/*
 * Neither fetch had a deadline before, and Node's global fetch has none of
 * its own. Connections are polled strictly sequentially, so one endpoint
 * that accepts a connection and never answers stalls every other tenant's
 * poll behind it, outliving the cron's own timeout because that timeout
 * does not abort the in-flight socket.
 */
const REQUEST_TIMEOUT_IN_SECONDS: number = 60;
const REQUEST_TIMEOUT_IN_MS: number = REQUEST_TIMEOUT_IN_SECONDS * 1000;

/*
 * How much of a body any diagnostic echoes. One bound for every echo site,
 * because the integration doc and the connections page both quote a single
 * figure — a second bound would make one of them wrong without anything
 * saying so.
 */
const BODY_ECHO_LIMIT: number = 500;

/*
 * The 22 documented {region}-chronicle.googleapis.com prefixes. An
 * allowlist rather than a shape regex because *.googleapis.com is a DNS
 * wildcard: a typo like "us-central1" resolves to a Google frontend and
 * answers with an HTML 404, so a regex that merely looks safe turns a
 * misconfigured region into a parse error instead of "unsupported region".
 */
const SUPPORTED_REGIONS: Array<string> = [
  "us",
  "eu",
  "europe",
  "africa-south1",
  "asia-east1",
  "asia-northeast1",
  "asia-northeast3",
  "asia-south1",
  "asia-southeast1",
  "asia-southeast2",
  "australia-southeast1",
  "europe-central2",
  "europe-west12",
  "europe-west2",
  "europe-west3",
  "europe-west6",
  "europe-west9",
  "me-central1",
  "me-central2",
  "me-west1",
  "northamerica-northeast2",
  "southamerica-east1",
];

/*
 * europe-chronicle.googleapis.com is a documented live host while the
 * migration guide names the same multi-region's location code "eu", so the
 * region/location cross-check has to treat the two as one place. A strict
 * identity check would reject every valid EU tenant.
 */
const EU_REGION_ALIASES: Array<string> = ["eu", "europe"];

/*
 * The token endpoint is customer-supplied, and the first 500 characters of
 * whatever answers it are echoed into lastError and rendered in the
 * dashboard — a blind SSRF plus a read-back channel. Region and instance
 * were always guarded; this one was not, which reads as an oversight
 * rather than a decision.
 */
const TOKEN_URI_HOSTS: Array<string> = ["accounts.google.com"];
const TOKEN_URI_HOST_SUFFIX: string = ".googleapis.com";

/*
 * `#` truncates the path and drops the whole query string; `?` injects
 * parameters ahead of the real ones; `%` lets a segment smuggle an encoded
 * separator past this check. The host is fixed by getApiBaseUrl, so this is
 * request shaping rather than URL takeover — still config-controlled
 * injection, and still rejected.
 */
const INSTANCE_REGEX: RegExp =
  /^projects\/[^/\s#?&%]+\/locations\/[^/\s#?&%]+\/instances\/[^/\s#?&%]+$/;
const INSTANCE_LOCATION_REGEX: RegExp =
  /^projects\/[^/]+\/locations\/([^/]+)\//;

/*
 * The two 400s worth telling apart in the operator message: a field we sent
 * that does not exist, versus a field we omitted that is required. Both are
 * OneUptime bugs, but they have different fixes.
 */
const UNKNOWN_FIELD_PATTERN: RegExp =
  /cannot bind query parameter|unknown name/i;
const MISSING_FIELD_PATTERN: RegExp = /required|missing/i;

/*
 * The doc marks snapshotQuery `Required.`, but that is a field_behavior
 * annotation the HTTP transcoder does not enforce; this service validates
 * queries in-band (validSnapshotQuery / queryValidationErrors) rather than
 * rejecting them. Fortinet's shipping connector omits it and gets 200, and
 * the doc defines empty-snapshot-query semantics as "match all baseline".
 * NOT verified against a live tenant.
 *
 * Deliberately NOT Google's SDK default `feedback_summary.status != "CLOSED"`
 * — that drops every CLOSED alert, trading a loud 400 for silent data loss.
 * If it turns out to be enforced, the 400 will name the missing field and
 * this is the one line to change.
 */
const SNAPSHOT_QUERY: string | null = null;

/*
 * Every field a FetchAlertsViewResponse chunk may carry. A body in which no
 * element carries at least one of these is not this endpoint's response,
 * and must never be reported as "no alerts".
 */
const RECOGNIZED_CHUNK_FIELDS: Array<string> = [
  "alerts",
  "fieldAggregations",
  "complete",
  "progress",
  "tooManyAlerts",
  "memoryLimitExceeded",
  "validBaselineQuery",
  "validSnapshotQuery",
  "baselineAlertsCount",
  "filteredAlertsCount",
  "queryValidationErrors",
  "runtimeErrors",
  // Retained so a tenant already served by the legacy top-level shape keeps working.
  "detections",
];

export default class GoogleSecOpsClient {
  private region: string;
  private instanceResourceName: string;
  private credentials: GoogleServiceAccountCredentials;
  private fetchImplementation: FetchLike;

  private cachedAccessToken: string | null = null;
  private cachedAccessTokenExpiresAtInMs: number = 0;

  public constructor(data: {
    region: string;
    instanceResourceName: string;
    serviceAccountJson: string;
    fetchImplementation?: FetchLike | undefined;
  }) {
    GoogleSecOpsClient.validateRegion(data.region);
    GoogleSecOpsClient.validateInstanceResourceName(data.instanceResourceName);
    GoogleSecOpsClient.validateRegionMatchesInstance(
      data.region,
      data.instanceResourceName,
    );

    this.region = data.region;
    this.instanceResourceName = GoogleSecOpsClient.encodeInstanceResourceName(
      data.instanceResourceName,
    );
    this.credentials = GoogleSecOpsClient.parseServiceAccountJson(
      data.serviceAccountJson,
    );
    this.fetchImplementation =
      data.fetchImplementation || (fetch as unknown as FetchLike);
  }

  public static validateRegion(region: string): void {
    if (SUPPORTED_REGIONS.indexOf(region || "") === -1) {
      throw new BadDataException(
        "Region must be a Google SecOps regional prefix like 'us' or 'europe'.",
      );
    }
  }

  public static validateInstanceResourceName(name: string): void {
    if (!INSTANCE_REGEX.test(name || "")) {
      throw new BadDataException(
        "Instance resource name must look like projects/{project}/locations/{location}/instances/{instance}.",
      );
    }
  }

  public static parseServiceAccountJson(
    serviceAccountJson: string,
  ): GoogleServiceAccountCredentials {
    let parsed: JSONObject;

    try {
      parsed = JSON.parse(serviceAccountJson || "") as JSONObject;
    } catch {
      throw new BadDataException("Service account JSON is not valid JSON.");
    }

    /*
     * JSON.parse("null") and JSON.parse("[]") both succeed, and the reads
     * below would then throw a raw TypeError out of a public create/update
     * API — a 500 where the caller's input deserves a 400.
     */
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BadDataException("Service account JSON must be a JSON object.");
    }

    /*
     * Read before coercing: String({}) is "[object Object]", which is
     * non-empty and sails through every check here only to fail an hour
     * later inside jwt.sign, on the cron, where nobody is looking.
     */
    if (
      typeof parsed["client_email"] !== "string" ||
      typeof parsed["private_key"] !== "string"
    ) {
      throw new BadDataException(
        "Service account JSON must contain client_email and private_key as strings.",
      );
    }

    const clientEmail: string = String(parsed["client_email"] || "");
    const privateKey: string = String(parsed["private_key"] || "");
    const tokenUri: string = String(
      parsed["token_uri"] || "https://oauth2.googleapis.com/token",
    );

    if (!clientEmail || !privateKey) {
      throw new BadDataException(
        "Service account JSON must contain client_email and private_key.",
      );
    }

    GoogleSecOpsClient.validateTokenUri(tokenUri);
    GoogleSecOpsClient.validatePrivateKey(privateKey);

    return { clientEmail, privateKey, tokenUri };
  }

  public getApiBaseUrl(): string {
    return `https://${this.region}-chronicle.googleapis.com/v1alpha/${this.instanceResourceName}`;
  }

  private async getAccessToken(): Promise<string> {
    const nowInMs: number = Date.now();

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

    const assertion: string = jwt.sign(
      {
        iss: this.credentials.clientEmail,
        scope: CHRONICLE_SCOPE,
        aud: this.credentials.tokenUri,
        iat: issuedAtInSeconds,
        exp: issuedAtInSeconds + TOKEN_LIFETIME_IN_SECONDS,
      },
      this.credentials.privateKey,
      { algorithm: "RS256" },
    );

    const body: string = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: assertion,
    }).toString();

    const response: FetchResponseLike = await this.fetchWithTimeout(
      this.credentials.tokenUri,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body,
      },
      "token exchange",
    );

    const responseText: string = await response.text();

    if (!response.ok) {
      throw new APIException(
        `Google token exchange failed (HTTP ${response.status}): ${responseText.slice(0, BODY_ECHO_LIMIT)}`,
      );
    }

    /*
     * Symmetrical with the alerts parse below: a proxy answering 200 with
     * an HTML page would otherwise throw a raw SyntaxError, which is
     * neither APIException nor BadDataException and so escapes the
     * failure taxonomy the operator guidance is written against.
     */
    const tokenResponse: JSONObject =
      GoogleSecOpsClient.parseTokenResponse(responseText);
    const accessToken: string = String(tokenResponse["access_token"] || "");
    const expiresInSeconds: number = GoogleSecOpsClient.readExpiresInSeconds(
      tokenResponse["expires_in"],
    );

    if (!accessToken) {
      throw new APIException("Google token exchange returned no access_token.");
    }

    /*
     * A zero, negative or unparseable expires_in used to become either an
     * hour of caching a dead token or a NaN that made the cache test
     * permanently false. Neither is worth guessing at: use the token once
     * and mint a fresh one next time.
     */
    if (expiresInSeconds > 0) {
      this.cachedAccessToken = accessToken;
      this.cachedAccessTokenExpiresAtInMs = nowInMs + expiresInSeconds * 1000;
    } else {
      this.cachedAccessToken = null;
      this.cachedAccessTokenExpiresAtInMs = 0;
    }

    return accessToken;
  }

  /*
   * Fetch detection alerts created in a time window, via the Chronicle
   * v1alpha legacy alerts view. The endpoint has no pagination of any
   * kind, so maxReturnedAlerts is a real ceiling rather than a page size —
   * truncation is reported through the result's flags, never swallowed.
   */
  public async fetchDetectionAlerts(data: {
    startTime: Date;
    endTime: Date;
    maxAlerts?: number | undefined;
  }): Promise<FetchAlertsResult> {
    let accessToken: string = await this.getAccessToken();

    const maxReturnedAlerts: number = data.maxAlerts || DEFAULT_MAX_ALERTS;

    /*
     * `alertListOptions.maxReturnedAlerts` is the flattened field path the
     * HTTP transcoder binds AlertListOptions.max_returned_alerts from. No
     * Google page prints this literal for this method — it is derived from
     * google.api.HttpRule transcoding and corroborated by two independent
     * shipping clients (Google's own secops-wrapper SDK and Fortinet's
     * certified FortiSOAR connector), not verified verbatim in the docs.
     * It is safe to send anyway because the parameter is optional and the
     * failure mode is loud: a wrong name 400s with `Unknown name`, exactly
     * like the `pageSize` this replaced, and never fails silently.
     */
    const params: URLSearchParams = new URLSearchParams({
      "timeRange.startTime": data.startTime.toISOString(),
      "timeRange.endTime": data.endTime.toISOString(),
      "alertListOptions.maxReturnedAlerts": String(maxReturnedAlerts),
    });

    if (SNAPSHOT_QUERY) {
      params.set("snapshotQuery", SNAPSHOT_QUERY);
    }

    const url: string = `${this.getApiBaseUrl()}/legacy:legacyFetchAlertsView?${params.toString()}`;

    let response: FetchResponseLike = await this.requestAlerts(
      url,
      accessToken,
    );
    let responseText: string = await response.text();

    /*
     * A key revoked mid-lifetime leaves a cached token Google now refuses,
     * and every poll until its stated expiry fails against it. One retry
     * on a fresh token distinguishes "the token went stale" from "the
     * credential is genuinely rejected", which is what the operator needs
     * to read off lastError.
     */
    if (response.status === 401) {
      this.clearCachedAccessToken();
      accessToken = await this.getAccessToken();
      response = await this.requestAlerts(url, accessToken);
      responseText = await response.text();
    }

    if (!response.ok) {
      throw new APIException(
        `Google SecOps alerts fetch failed (HTTP ${response.status}): ${responseText.slice(0, BODY_ECHO_LIMIT)}` +
          GoogleSecOpsClient.describeHttpFailure(response.status, responseText),
      );
    }

    return GoogleSecOpsClient.parseAlertsBody(responseText, maxReturnedAlerts);
  }

  /*
   * The legacy top-level shapes, kept as a fallback so a tenant already
   * being served by them keeps working. The recognition gate in
   * parseAlertsBody runs ahead of this, so returning [] here means "this
   * recognized chunk carried nothing", never "I did not understand the
   * body".
   */
  public static extractAlerts(payload: JSONValue): Array<JSONObject> {
    if (Array.isArray(payload)) {
      return (payload as JSONArray).filter((item: JSONValue): boolean => {
        return (
          typeof item === "object" && item !== null && !Array.isArray(item)
        );
      }) as Array<JSONObject>;
    }

    if (!payload || typeof payload !== "object") {
      return [];
    }

    const asObject: JSONObject = payload as JSONObject;
    const collected: Array<JSONObject> = [];

    /*
     * Every array-valued key, not the first one found: `{alerts: [],
     * detections: [...]}` used to return [] and drop the detections,
     * because an empty array is still an array.
     */
    for (const key of ["alerts", "detections"]) {
      const nested: JSONValue = asObject[key] as JSONValue;

      if (Array.isArray(nested)) {
        for (const item of GoogleSecOpsClient.extractAlerts(nested)) {
          collected.push(item);
        }
      }
    }

    return collected;
  }

  /*
   * ---------------------------------------------------------------------
   * Helpers. Everything below is deliberately declared after extractAlerts:
   * SecurityEventsConnectorGuidanceAccuracy reads this file's method
   * bodies by slicing between declarations, so a helper placed higher up
   * would be counted as part of fetchDetectionAlerts.
   * ---------------------------------------------------------------------
   */

  private clearCachedAccessToken(): void {
    this.cachedAccessToken = null;
    this.cachedAccessTokenExpiresAtInMs = 0;
  }

  private async requestAlerts(
    url: string,
    accessToken: string,
  ): Promise<FetchResponseLike> {
    /*
     * Accept is not a formality here: leaving content negotiation to the
     * server default is what turns a proxy in the path into the
     * "non-JSON body" failure below.
     */
    return this.fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      "alerts fetch",
    );
  }

  private async fetchWithTimeout(
    url: string,
    init: FetchInitLike,
    stepLabel: string,
  ): Promise<FetchResponseLike> {
    const controller: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      controller.abort();
    }, REQUEST_TIMEOUT_IN_MS);

    try {
      return await this.fetchImplementation(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new APIException(
          `Google SecOps ${stepLabel} timed out after ${REQUEST_TIMEOUT_IN_SECONDS} seconds with no response.`,
        );
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private static validateTokenUri(tokenUri: string): void {
    let parsed: URL;

    try {
      parsed = new URL(tokenUri);
    } catch {
      throw new BadDataException(
        "Service account token_uri must be an absolute https URL.",
      );
    }

    const isGoogleHost: boolean =
      TOKEN_URI_HOSTS.indexOf(parsed.hostname) !== -1 ||
      parsed.hostname.endsWith(TOKEN_URI_HOST_SUFFIX);

    if (parsed.protocol !== "https:" || !isGoogleHost || parsed.username) {
      throw new BadDataException(
        "Service account token_uri must be an https URL on a Google host such as https://oauth2.googleapis.com/token.",
      );
    }
  }

  private static validatePrivateKey(privateKey: string): void {
    /*
     * A double-escaped or truncated key saves cleanly today and fails an
     * hour later inside jwt.sign as an unwrapped OpenSSL decoder error, on
     * the cron — which is the exact class of failure save-time validation
     * exists to prevent.
     */
    try {
      createPrivateKey(privateKey);
    } catch {
      throw new BadDataException(
        "Service account private_key is not a readable PEM private key. Check that newlines are real newlines and the key is not encrypted.",
      );
    }
  }

  private static validateRegionMatchesInstance(
    region: string,
    instanceResourceName: string,
  ): void {
    const match: RegExpMatchArray | null = instanceResourceName.match(
      INSTANCE_LOCATION_REGEX,
    );
    const location: string = match && match[1] ? match[1] : "";

    if (!location || location === region) {
      return;
    }

    if (
      EU_REGION_ALIASES.indexOf(region) !== -1 &&
      EU_REGION_ALIASES.indexOf(location) !== -1
    ) {
      return;
    }

    throw new BadDataException(
      "Region must match the locations segment of the instance resource name.",
    );
  }

  private static encodeInstanceResourceName(name: string): string {
    return name
      .split("/")
      .map((segment: string): string => {
        return encodeURIComponent(segment);
      })
      .join("/");
  }

  private static parseTokenResponse(responseText: string): JSONObject {
    let parsed: JSONValue;

    try {
      parsed = JSON.parse(responseText) as JSONValue;
    } catch {
      throw new APIException("Google token exchange returned a non-JSON body.");
    }

    if (!GoogleSecOpsClient.isJsonObject(parsed)) {
      throw new APIException(
        "Google token exchange returned a body that is not a JSON object.",
      );
    }

    return parsed;
  }

  private static readExpiresInSeconds(value: JSONValue | undefined): number {
    if (value === undefined || value === null || value === "") {
      return TOKEN_LIFETIME_IN_SECONDS;
    }

    const seconds: number = Number(value);

    if (!Number.isFinite(seconds) || seconds <= 0) {
      logger.warn(
        `GoogleSecOpsClient: token endpoint returned an unusable expires_in (${String(value)}); not caching this access token.`,
      );

      return 0;
    }

    return seconds;
  }

  /*
   * The streaming envelope. Returns what the window actually contained, or
   * throws — the one thing it must never do is report zero alerts for a
   * body it did not recognize, because the poller reads that as a healthy
   * quiet window and advances its cursor past whatever it failed to read.
   */
  public static parseAlertsBody(
    bodyText: string,
    maxReturnedAlerts: number = DEFAULT_MAX_ALERTS,
  ): FetchAlertsResult {
    const text: string = (bodyText || "").trim();

    if (!text) {
      throw new APIException(
        "Google SecOps alerts fetch returned an empty body.",
      );
    }

    const root: JSONValue = GoogleSecOpsClient.parseAlertsJson(text);
    const chunks: Array<JSONObject> = GoogleSecOpsClient.toChunkArray(
      root,
      text,
    );

    /*
     * Before anything is accumulated. A terminal google.rpc.Status can
     * legitimately follow good data — [{alerts},{alerts},{error}] is a
     * mid-stream failure — so a scan that stopped at the first element, or
     * trusted the alerts it had already seen, would mask it.
     */
    GoogleSecOpsClient.throwOnStreamError(chunks);
    GoogleSecOpsClient.throwOnUnrecognizedChunks(chunks, text);

    const alerts: Array<JSONObject> =
      GoogleSecOpsClient.accumulateAlerts(chunks);

    const complete: boolean =
      GoogleSecOpsClient.readLastBoolean(chunks, "complete") === true;
    const progress: number =
      GoogleSecOpsClient.readLastNumber(chunks, "progress") ?? 0;
    const truncatedByCount: boolean =
      GoogleSecOpsClient.readLastBoolean(chunks, "tooManyAlerts") === true;
    const truncatedByBytes: boolean =
      GoogleSecOpsClient.readLastBoolean(chunks, "memoryLimitExceeded") ===
      true;
    const baselineAlertsCount: number =
      GoogleSecOpsClient.readLastNumber(chunks, "baselineAlertsCount") ?? 0;
    const filteredAlertsCount: number =
      GoogleSecOpsClient.readLastNumber(chunks, "filteredAlertsCount") ?? 0;

    GoogleSecOpsClient.throwOnInBandValidationErrors(chunks);

    if (truncatedByCount) {
      logger.warn(
        "GoogleSecOpsClient: Chronicle set tooManyAlerts — the window matched more alerts than it will return, and this endpoint has no pagination. Narrow the poll window.",
      );
    }

    if (truncatedByBytes) {
      logger.warn(
        "GoogleSecOpsClient: Chronicle set memoryLimitExceeded — the result was truncated server side. Narrow the poll window.",
      );
    }

    if (!complete) {
      /*
       * Warn rather than re-issue the whole GET in a loop the way Google's
       * SDK does: the poller runs every minute over a 15-minute window
       * with a minute of overlap, so a partial window is re-covered on the
       * next tick, and a blocking retry inside a strictly sequential
       * connection loop would let one slow tenant starve every other one.
       */
      logger.warn(
        "GoogleSecOpsClient: the alerts stream ended without complete=true; this window may be partial and will be re-covered by the next poll.",
      );
    }

    if (alerts.length > maxReturnedAlerts) {
      /*
       * Whether chunk.alerts is cumulative or incremental across chunks is
       * the one part of this contract no Google page states. The union
       * below is correct either way, but more alerts than the ceiling we
       * asked for can only mean we appended across chunks that were
       * restating the same top-N — an observable answer to an otherwise
       * unanswerable doc question.
       */
      logger.error(
        `GoogleSecOpsClient: accumulated ${alerts.length} alerts for a ceiling of ${maxReturnedAlerts}. Chunk alerts are cumulative and the union is over-counting; the dedupe key is not identifying them.`,
      );
    }

    return {
      alerts: alerts,
      complete: complete,
      progress: progress,
      truncatedByCount: truncatedByCount,
      truncatedByBytes: truncatedByBytes,
      baselineAlertsCount: baselineAlertsCount,
      filteredAlertsCount: filteredAlertsCount,
      chunkCount: chunks.length,
    };
  }

  private static parseAlertsJson(text: string): JSONValue {
    try {
      return JSON.parse(text) as JSONValue;
    } catch {
      // Fall through to the repair pass.
    }

    try {
      return JSON.parse(GoogleSecOpsClient.repairJsonBody(text)) as JSONValue;
    } catch {
      throw new APIException(
        "Google SecOps alerts fetch returned a non-JSON body.",
      );
    }
  }

  /*
   * Bounded, and only after a strict parse has already failed. Google's own
   * SDK ships an equivalent fixer, which only makes sense because malformed
   * bodies were observed in the wild; it does not license repairing
   * arbitrary text, so nothing here invents structure that was not there.
   */
  private static repairJsonBody(text: string): string {
    let repaired: string = text.replace(/\}\s*\n\s*\{/g, "},\n{");

    repaired = repaired.replace(/,\s*([\]}])/g, "$1");

    if (repaired.startsWith("{") && repaired.endsWith("}")) {
      repaired = `[${repaired}]`;
    }

    return repaired;
  }

  private static toChunkArray(
    root: JSONValue,
    text: string,
  ): Array<JSONObject> {
    if (Array.isArray(root)) {
      return (root as JSONArray).filter((item: JSONValue): boolean => {
        return GoogleSecOpsClient.isJsonObject(item);
      }) as Array<JSONObject>;
    }

    // A unary body instead of the stream envelope is tolerated.
    if (GoogleSecOpsClient.isJsonObject(root)) {
      return [root];
    }

    throw new APIException(
      `Google SecOps alerts fetch returned an unexpected response root: ${text.slice(0, BODY_ECHO_LIMIT)}`,
    );
  }

  private static throwOnStreamError(chunks: Array<JSONObject>): void {
    for (const chunk of chunks) {
      const error: JSONValue | undefined = chunk["error"];

      if (GoogleSecOpsClient.isJsonObject(error)) {
        throw new APIException(
          `Google SecOps alerts fetch returned an error in the response stream: ${GoogleSecOpsClient.summarizeErrorObject(error)}`,
        );
      }
    }
  }

  private static throwOnUnrecognizedChunks(
    chunks: Array<JSONObject>,
    text: string,
  ): void {
    const recognized: Array<JSONObject> = chunks.filter(
      (chunk: JSONObject): boolean => {
        return RECOGNIZED_CHUNK_FIELDS.some((field: string): boolean => {
          return Object.prototype.hasOwnProperty.call(chunk, field);
        });
      },
    );

    if (recognized.length === 0) {
      throw new APIException(
        `Google SecOps alerts fetch returned an unrecognized response shape: ${text.slice(0, BODY_ECHO_LIMIT)}`,
      );
    }
  }

  /*
   * Dedupe-by-id union, which is correct whether chunk.alerts is cumulative
   * (later chunks refresh earlier entries) or incremental (entries
   * accumulate). A blind push would double-count under the first reading; a
   * blind replace would lose data under the second.
   */
  private static accumulateAlerts(
    chunks: Array<JSONObject>,
  ): Array<JSONObject> {
    const seen: Map<string, JSONObject> = new Map<string, JSONObject>();

    for (let chunkIndex: number = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk: JSONObject = chunks[chunkIndex] as JSONObject;
      const chunkAlerts: Array<JSONObject> =
        GoogleSecOpsClient.alertsInChunk(chunk);

      for (
        let position: number = 0;
        position < chunkAlerts.length;
        position++
      ) {
        const alert: JSONObject = chunkAlerts[position] as JSONObject;
        const id: JSONValue | undefined = alert["id"];
        const key: string =
          typeof id === "string" && id ? id : `__idx:${chunkIndex}:${position}`;

        seen.set(key, alert);
      }
    }

    return Array.from(seen.values());
  }

  private static alertsInChunk(chunk: JSONObject): Array<JSONObject> {
    const collected: Array<JSONObject> = [];
    const alertList: JSONValue | undefined = chunk["alerts"];

    /*
     * FetchAlertsViewResponse.alerts is an AlertList message whose single
     * field is also called `alerts`. Both levels are omitted when empty.
     */
    if (GoogleSecOpsClient.isJsonObject(alertList)) {
      const inner: JSONValue | undefined = alertList["alerts"];

      if (Array.isArray(inner)) {
        for (const item of GoogleSecOpsClient.extractAlerts(
          inner as JSONValue,
        )) {
          collected.push(item);
        }
      }
    }

    for (const item of GoogleSecOpsClient.extractAlerts(chunk)) {
      collected.push(item);
    }

    return collected;
  }

  /*
   * complete, progress and the counts are proto3 scalars: a chunk where
   * complete is false and progress is 0 omits both keys entirely, so
   * "absent" must never be read as "present and false" — hence last chunk
   * that CARRIES the key, not last chunk.
   */
  private static readLastBoolean(
    chunks: Array<JSONObject>,
    field: string,
  ): boolean | null {
    let value: boolean | null = null;

    for (const chunk of chunks) {
      if (typeof chunk[field] === "boolean") {
        value = chunk[field] as boolean;
      }
    }

    return value;
  }

  private static readLastNumber(
    chunks: Array<JSONObject>,
    field: string,
  ): number | null {
    let value: number | null = null;

    for (const chunk of chunks) {
      const read: number | null = GoogleSecOpsClient.readNumber(chunk[field]);

      if (read !== null) {
        value = read;
      }
    }

    return value;
  }

  private static readNumber(value: JSONValue | undefined): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    // proto3 renders int64 as a JSON string, so counts can arrive quoted.
    if (typeof value === "string" && value.trim() !== "") {
      const parsed: number = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  /*
   * A malformed query comes back as HTTP 200 with the complaint in the
   * body, so checking response.ok alone reports it as a successful poll
   * that found nothing.
   */
  private static throwOnInBandValidationErrors(
    chunks: Array<JSONObject>,
  ): void {
    const queryErrors: Array<string> = GoogleSecOpsClient.collectErrorTexts(
      chunks,
      "queryValidationErrors",
    );
    const runtimeErrors: Array<string> = GoogleSecOpsClient.collectErrorTexts(
      chunks,
      "runtimeErrors",
    );
    const invalidSnapshotQuery: boolean =
      GoogleSecOpsClient.readLastBoolean(chunks, "validSnapshotQuery") ===
      false;
    const invalidBaselineQuery: boolean =
      GoogleSecOpsClient.readLastBoolean(chunks, "validBaselineQuery") ===
      false;

    if (
      !invalidSnapshotQuery &&
      !invalidBaselineQuery &&
      queryErrors.length === 0 &&
      runtimeErrors.length === 0
    ) {
      return;
    }

    const reasons: Array<string> = [];

    if (invalidSnapshotQuery) {
      reasons.push("validSnapshotQuery=false");
    }

    if (invalidBaselineQuery) {
      reasons.push("validBaselineQuery=false");
    }

    for (const text of queryErrors) {
      reasons.push(text);
    }

    for (const text of runtimeErrors) {
      reasons.push(text);
    }

    throw new APIException(
      `Google SecOps alerts query was rejected by Chronicle on an HTTP 200: ${reasons.join("; ").slice(0, BODY_ECHO_LIMIT)}`,
    );
  }

  private static collectErrorTexts(
    chunks: Array<JSONObject>,
    field: string,
  ): Array<string> {
    /*
     * Deduped rather than concatenated, for the same reason the alerts are:
     * a cumulative chunk restates the whole list every time.
     */
    const seen: Map<string, string> = new Map<string, string>();

    for (const chunk of chunks) {
      const entries: JSONValue | undefined = chunk[field];

      if (!Array.isArray(entries)) {
        continue;
      }

      for (const entry of entries as Array<JSONValue>) {
        const text: string = GoogleSecOpsClient.errorTextOf(entry);

        if (text) {
          seen.set(text, text);
        }
      }
    }

    return Array.from(seen.values());
  }

  private static errorTextOf(entry: JSONValue): string {
    if (typeof entry === "string") {
      return entry;
    }

    if (GoogleSecOpsClient.isJsonObject(entry)) {
      /*
       * The reference page does not print ValidationError's field names, so
       * the candidates below are a best effort; the JSON fallback keeps the
       * operator-visible text honest when none of them match.
       */
      for (const key of ["errorText", "message", "error", "description"]) {
        const value: JSONValue | undefined = entry[key];

        if (typeof value === "string" && value) {
          return value;
        }
      }

      return JSON.stringify(entry);
    }

    return String(entry);
  }

  /*
   * Actionable operator guidance appended behind the echoed body. The
   * prefix, the status and the body slice ahead of it are the contract the
   * integration doc and the in-product help are written against, so this
   * only ever adds to the tail.
   */
  public static describeHttpFailure(status: number, bodyText: string): string {
    const error: JSONObject | null =
      GoogleSecOpsClient.findErrorObject(bodyText);
    const reason: string = GoogleSecOpsClient.errorInfoReason(error);
    const message: string = error
      ? String(error["message"] || "")
      : bodyText.slice(0, BODY_ECHO_LIMIT);

    const hint: string = reason
      ? GoogleSecOpsClient.hintForReason(reason, error)
      : GoogleSecOpsClient.hintForStatus(status, message, error);

    if (!hint) {
      return "";
    }

    return ` — ${hint}`;
  }

  private static hintForReason(
    reason: string,
    error: JSONObject | null,
  ): string {
    if (reason === "CREDENTIALS_MISSING") {
      return "No credential reached Google. The Authorization header was absent or unreadable.";
    }

    if (reason === "ACCESS_TOKEN_EXPIRED") {
      return "The access token had expired; OneUptime mints a fresh one and retries once, so a repeat means the clock or the key is wrong.";
    }

    if (reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") {
      return "The token was minted without the Chronicle scope. Grant the service account https://www.googleapis.com/auth/cloud-platform or .../auth/chronicle.";
    }

    if (reason === "IAM_PERMISSION_DENIED") {
      // ErrorInfo.metadata names the exact resource and permission; render both.
      const metadata: JSONObject | null =
        GoogleSecOpsClient.errorInfoMetadata(error);
      const resource: string = String(metadata?.["resource"] || "");
      const permission: string = String(metadata?.["permission"] || "");

      return `The service account lacks ${permission || "chronicle.legacies.legacyFetchAlertsView"} on ${resource || "the instance"}. Grant roles/chronicle.viewer (roles/chronicle.admin if Viewer is not enough on this tenant).`;
    }

    if (reason === "SERVICE_DISABLED") {
      return "The Chronicle API is not enabled on the project the instance is bound to. Enable it in the Google Cloud console.";
    }

    if (reason === "RATE_LIMIT_EXCEEDED") {
      const metadata: JSONObject | null =
        GoogleSecOpsClient.errorInfoMetadata(error);
      const quotaMetric: string = String(metadata?.["quota_metric"] || "");
      const quotaLimit: string = String(metadata?.["quota_limit"] || "");

      return `Google is rate limiting this service account${quotaMetric ? ` on ${quotaMetric}` : ""}${quotaLimit ? ` (limit ${quotaLimit})` : ""}. Chronicle quota is per user per hour, so one service account shared across connections collides with itself.`;
    }

    return `Google reported ${reason}.`;
  }

  private static hintForStatus(
    status: number,
    message: string,
    error: JSONObject | null,
  ): string {
    if (status === 400) {
      /*
       * AIP-193 requires a service-generated error to carry ErrorInfo, so a
       * 400 that carries only BadRequest came from the HTTP transcoder —
       * which means OneUptime's request shape is wrong, never the
       * customer's credentials.
       */
      if (UNKNOWN_FIELD_PATTERN.test(message)) {
        return "OneUptime sent a query parameter this endpoint does not accept. This is a OneUptime bug, not a credential or permission problem.";
      }

      if (MISSING_FIELD_PATTERN.test(message)) {
        return "Chronicle rejected the request for a missing required field. This is a OneUptime bug, not a credential or permission problem.";
      }

      if (!error) {
        return "Chronicle rejected the request shape before it reached the service. This is a OneUptime bug, not a credential or permission problem.";
      }

      return "";
    }

    if (status === 401) {
      return "Google refused the access token. The service-account key may be revoked, or this host's clock may be skewed.";
    }

    if (status === 403) {
      return "Either the instance resource name is wrong, or the service account lacks access to it. Grant roles/chronicle.viewer (roles/chronicle.admin if Viewer is not enough on this tenant) — permission is checked before existence, so a wrong instance name usually reads as 403 rather than 404.";
    }

    if (status === 404) {
      return "The route did not resolve. Check the region prefix: googleapis.com is a DNS wildcard, so a mistyped region answers with a generic 404 rather than an API error.";
    }

    if (status === 429) {
      return "RESOURCE_EXHAUSTED. Back off before the next poll; Chronicle quota is per user per hour, so one service account shared across connections collides with itself.";
    }

    return "";
  }

  /*
   * us-chronicle.googleapis.com wraps its errors in the stream's array
   * envelope, while an error rejected at the edge — bad auth, unknown route
   * — comes back bare. Both shapes are read, and every element is scanned:
   * the terminal google.rpc.Status is appended last, so body[0] is exactly
   * the wrong place to look.
   */
  private static findErrorObject(bodyText: string): JSONObject | null {
    const text: string = (bodyText || "").trim();

    if (!text) {
      return null;
    }

    let root: JSONValue;

    try {
      root = JSON.parse(text) as JSONValue;
    } catch {
      return null;
    }

    const elements: Array<JSONValue> = Array.isArray(root)
      ? (root as Array<JSONValue>)
      : [root];

    for (const element of elements) {
      if (!GoogleSecOpsClient.isJsonObject(element)) {
        continue;
      }

      const error: JSONValue | undefined = element["error"];

      if (GoogleSecOpsClient.isJsonObject(error)) {
        return error;
      }
    }

    return null;
  }

  private static errorInfoDetail(error: JSONObject | null): JSONObject | null {
    if (!error) {
      return null;
    }

    const details: JSONValue | undefined = error["details"];

    if (!Array.isArray(details)) {
      return null;
    }

    for (const detail of details as Array<JSONValue>) {
      if (!GoogleSecOpsClient.isJsonObject(detail)) {
        continue;
      }

      if (
        String(detail["@type"] || "").endsWith("google.rpc.ErrorInfo") &&
        detail["reason"]
      ) {
        return detail;
      }
    }

    return null;
  }

  private static errorInfoReason(error: JSONObject | null): string {
    const detail: JSONObject | null = GoogleSecOpsClient.errorInfoDetail(error);

    return detail ? String(detail["reason"] || "") : "";
  }

  private static errorInfoMetadata(
    error: JSONObject | null,
  ): JSONObject | null {
    const detail: JSONObject | null = GoogleSecOpsClient.errorInfoDetail(error);

    if (!detail) {
      return null;
    }

    const metadata: JSONValue | undefined = detail["metadata"];

    return GoogleSecOpsClient.isJsonObject(metadata) ? metadata : null;
  }

  private static summarizeErrorObject(error: JSONObject): string {
    const code: string = String(error["code"] || "");
    const status: string = String(error["status"] || "");
    const message: string = String(error["message"] || "");

    return `${code ? `code ${code} ` : ""}${status ? `${status} ` : ""}${message}`
      .trim()
      .slice(0, BODY_ECHO_LIMIT);
  }

  private static isJsonObject(
    value: JSONValue | undefined,
  ): value is JSONObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
