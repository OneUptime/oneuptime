import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import ElasticSecurityNormalizer from "../../../../../Utils/SecurityEvent/Connectors/ElasticSecurityNormalizer";
import { parseEventTime } from "../../../../../Utils/SecurityEvent/NormalizerHelpers";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import { redactLogString } from "../../../LogRedaction";
import ConnectorErrorMessage from "../../ConnectorErrorMessage";
import {
  ConnectorFetchOptions,
  ConnectorFetchResult,
  ConnectorFetchWindow,
  ConnectorTestOptions,
  ConnectorTransport,
  SecurityConnectorSettings,
  SecurityEventConnector,
  makeCheck,
  readSettingString,
} from "../Types";
import ElasticSecurityClient, {
  ELASTIC_SECURITY_MAX_EXCLUDED_ID_BYTES,
  ELASTIC_SECURITY_MAX_PAGE_SIZE,
  ElasticAlertCount,
  ElasticAlertHit,
  ElasticKibanaStatus,
  ElasticSearchAlertsResult,
  ElasticSecurityHttpError,
} from "./ElasticSecurityClient";

/*
 * Elastic Security (Kibana detection engine) connector.
 *
 * Polls detection alerts by the alert's own @timestamp — the time the
 * rule execution CREATED the alert — never by the matched event's time
 * (kibana.alert.original_time). A rule scheduled hourly writes alerts about
 * events that happened up to an hour earlier, so a cursor on event time
 * would skip every one of them; see Connectors/Types.ts.
 *
 * Paging: the documented signals search body accepts size and sort but
 * neither search_after nor from (see ElasticSecurityClient), so cursor
 * paging is done by advancing the range's lower bound to the last hit's
 * @timestamp. `gte` would re-read alerts sharing that exact timestamp —
 * common, since one rule execution stamps every alert it writes with the
 * same time — so the next request excludes the ids already read at that
 * instant. Each page is then the oldest alerts not yet read: every alert
 * created before the page's last timestamp has been read, a tie group
 * larger than a page is read page by page instead of being cut off at the
 * first one, and nothing is re-read (ids are still remembered, in case a
 * proxy or an older Kibana ignores the exclusion).
 *
 * When a bound stops the fetch, resumeAfter is the @timestamp of the last
 * alert read, so the poller moves its cursor there instead of re-reading
 * the same oldest alerts on every poll (review finding
 * bound-hit-window-never-advances).
 *
 * Settings come from the catalog's keys: config.kibanaUrl, config.space
 * and secrets.apiKey.
 */

interface ParsedSettings {
  kibanaUrl: string;
  space: string;
  apiKey: string;
}

// Kibana space ids: lowercase letters, digits, hyphens and underscores.
const SPACE_ID_REGEX: RegExp = /^[a-z0-9_-]+$/i;
// A pasted Kibana URL that already carries the /s/<space> prefix or an API path.
const SPACE_PREFIX_REGEX: RegExp = /\/s\/[^/]+/;
const API_PATH_REGEX: RegExp = /\/api(\/|$)/;
// The header scheme pasted along with the key, and anything that is not one base64 token.
const API_KEY_PREFIX_REGEX: RegExp = /^apikey\s/i;
const WHITESPACE_REGEX: RegExp = /\s/;
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
// Normalization failures quoted into warnings before the rest are counted only.
const MAX_NORMALIZATION_WARNINGS: number = 5;

type ProviderCheckStep =
  | "authentication"
  | "read-permission"
  | "detections-available";

export default class ElasticSecurityConnector
  implements SecurityEventConnector
{
  public provider: SecurityEventConnectorProvider =
    SecurityEventConnectorProvider.ElasticSecurity;

  private transport: ConnectorTransport;

  public constructor(transport?: ConnectorTransport | undefined) {
    this.transport =
      transport ||
      ((request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
        return DataSourceHttpFetch.fetch(request);
      });
  }

  private static getDefinition(): SecurityEventConnectorDefinition {
    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(
        SecurityEventConnectorProvider.ElasticSecurity,
      );

    if (!definition) {
      throw new BadDataException(
        "Elastic Security is missing from the connector catalog.",
      );
    }

    return definition;
  }

  /*
   * Validation messages name the field by the title the form shows, read
   * from the catalog so a retitled field cannot leave a stale name here.
   */
  private static fieldTitle(key: string): string {
    const definition: SecurityEventConnectorDefinition = this.getDefinition();
    const field: { title: string } | undefined = [
      ...definition.configFields,
      ...definition.secretFields,
    ].find((candidate: { key: string }): boolean => {
      return candidate.key === key;
    });

    return field?.title || key;
  }

  private static parseSettings(
    settings: SecurityConnectorSettings,
  ): ParsedSettings {
    const kibanaUrl: string = readSettingString(settings.config, "kibanaUrl");
    const space: string = readSettingString(settings.config, "space");
    const apiKey: string = readSettingString(settings.secrets, "apiKey");

    if (!kibanaUrl) {
      throw new BadDataException(
        `${this.fieldTitle("kibanaUrl")} is required.`,
      );
    }

    let parsed: URL;

    try {
      parsed = new URL(kibanaUrl);
    } catch {
      throw new BadDataException(
        `${this.fieldTitle("kibanaUrl")} must be an absolute URL such as https://kibana.example.com.`,
      );
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new BadDataException(
        `${this.fieldTitle("kibanaUrl")} must use https (or http).`,
      );
    }

    if (parsed.search || parsed.hash) {
      throw new BadDataException(
        `${this.fieldTitle("kibanaUrl")} must not contain a query string or fragment.`,
      );
    }

    if (SPACE_PREFIX_REGEX.test(parsed.pathname)) {
      throw new BadDataException(
        `${this.fieldTitle("kibanaUrl")} must not include the /s/<space> prefix; put the space id in the ${this.fieldTitle("space")} field instead.`,
      );
    }

    if (API_PATH_REGEX.test(parsed.pathname)) {
      throw new BadDataException(
        `${this.fieldTitle("kibanaUrl")} must be the base URL Kibana is served from, without an /api path.`,
      );
    }

    if (space && !SPACE_ID_REGEX.test(space)) {
      throw new BadDataException(
        `${this.fieldTitle("space")} must be a space id (letters, numbers, hyphens and underscores), not its display name.`,
      );
    }

    if (!apiKey) {
      throw new BadDataException(`${this.fieldTitle("apiKey")} is required.`);
    }

    if (API_KEY_PREFIX_REGEX.test(apiKey)) {
      throw new BadDataException(
        `${this.fieldTitle("apiKey")} must be pasted without the 'ApiKey' prefix.`,
      );
    }

    /*
     * A raw `id:api_key` pair or a value with whitespace is the most
     * common paste mistake; it would only surface as a 401 later, without
     * saying why. The base64 `encoded` value has neither.
     */
    if (WHITESPACE_REGEX.test(apiKey) || apiKey.includes(":")) {
      throw new BadDataException(
        `${this.fieldTitle("apiKey")} must be the base64 encoded value Kibana shows when the key is created (the 'encoded' field), not the raw id:api_key pair.`,
      );
    }

    return { kibanaUrl, space, apiKey };
  }

  public validateSettings(settings: SecurityConnectorSettings): void {
    ElasticSecurityConnector.parseSettings(settings);
  }

  private buildClient(
    parsed: ParsedSettings,
    requestTimeoutInMs: number,
  ): ElasticSecurityClient {
    return new ElasticSecurityClient({
      kibanaUrl: parsed.kibanaUrl,
      space: parsed.space,
      apiKey: parsed.apiKey,
      transport: this.transport,
      requestTimeoutInMs,
    });
  }

  /*
   * Three provider checks, in dependency order. Each later check is
   * skipped rather than failed when an earlier one fails, so the report
   * names one root cause instead of three symptoms of it.
   */
  public async testConnection(
    settings: SecurityConnectorSettings,
    options: ConnectorTestOptions,
  ): Promise<Array<SecurityConnectorCheck>> {
    const checks: Array<SecurityConnectorCheck> = [];
    let parsed: ParsedSettings;
    let startedAtMs: number = Date.now();

    try {
      parsed = ElasticSecurityConnector.parseSettings(settings);
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Kibana",
          status: "fail",
          startedAtMs,
          message: redactLogString(ConnectorErrorMessage.toMessage(error)),
          remediation:
            "Correct the highlighted setting and test again. Nothing was contacted.",
        }),
      );
      checks.push(
        ElasticSecurityConnector.skipped(
          "read-permission",
          "Read detection alerts",
          "Skipped because the configuration is invalid.",
        ),
      );
      checks.push(
        ElasticSecurityConnector.skipped(
          "detections-available",
          "Alerts available to import",
          "Skipped because the configuration is invalid.",
        ),
      );
      return checks;
    }

    const client: ElasticSecurityClient = this.buildClient(
      parsed,
      options.requestTimeoutInMs,
    );

    let hostLabel: string = "Kibana";

    try {
      hostLabel = new URL(client.getBaseUrl()).host;
    } catch {
      hostLabel = "Kibana";
    }

    // 1. Authentication: GET /api/status must come back unredacted.
    let authenticated: boolean = false;

    try {
      const status: ElasticKibanaStatus = await client.getStatus();

      if (!status.authenticated) {
        checks.push(
          makeCheck({
            key: "authentication",
            name: "Authenticate with Kibana",
            status: "fail",
            startedAtMs,
            message: `Kibana at ${hostLabel} answered without authenticating the request: the status document was redacted to the overall level only (${status.level || "unknown"}).`,
            remediation:
              "Kibana ignored the credential, which happens when anonymous access is enabled and the Authorization header was not applied. Confirm the API key was pasted as its base64 encoded value and that no proxy in front of Kibana strips the Authorization header.",
            details: { level: status.level, summary: status.summary },
          }),
        );
      } else {
        authenticated = true;
        checks.push(
          makeCheck({
            key: "authentication",
            name: "Authenticate with Kibana",
            status: "pass",
            startedAtMs,
            message:
              `Kibana ${status.version || ""} at ${hostLabel} accepted the API key. Overall status: ${status.level || "unknown"}.`.replace(
                /\s+/g,
                " ",
              ),
            details: {
              kibanaVersion: status.version,
              level: status.level,
              summary: status.summary,
            },
          }),
        );
      }
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Kibana",
          status: "fail",
          startedAtMs,
          message: ElasticSecurityConnector.errorMessage(error),
          remediation: ElasticSecurityConnector.remediationFor(
            error,
            "authentication",
          ),
        }),
      );
    }

    if (!authenticated) {
      checks.push(
        ElasticSecurityConnector.skipped(
          "read-permission",
          "Read detection alerts",
          "Skipped because authentication did not succeed.",
        ),
      );
      checks.push(
        ElasticSecurityConnector.skipped(
          "detections-available",
          "Alerts available to import",
          "Skipped because authentication did not succeed.",
        ),
      );
      return checks;
    }

    const now: Date = new Date();
    const dayAgo: Date = new Date(now.getTime() - DAY_IN_MS);
    const weekAgo: Date = new Date(now.getTime() - 7 * DAY_IN_MS);

    // 2. Read permission: one alert from the last 24 hours.
    startedAtMs = Date.now();
    let readable: boolean = false;

    try {
      const page: ElasticSearchAlertsResult = await client.searchAlerts({
        startTime: dayAgo,
        endTime: now,
        size: 1,
      });
      readable = true;

      const firstHit: ElasticAlertHit | undefined = page.hits[0];
      const ruleName: string = firstHit
        ? ElasticSecurityConnector.describeHit(firstHit)
        : "";

      checks.push(
        makeCheck({
          key: "read-permission",
          name: "Read detection alerts",
          status: "pass",
          startedAtMs,
          message: firstHit
            ? `The detection alerts index is readable; the one-record probe over the last 24 hours returned an alert from rule "${ruleName}".`
            : "The detection alerts index is readable. No alert was created in the last 24 hours.",
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "read-permission",
          name: "Read detection alerts",
          status: "fail",
          startedAtMs,
          message: ElasticSecurityConnector.errorMessage(error),
          remediation: ElasticSecurityConnector.remediationFor(
            error,
            "read-permission",
          ),
        }),
      );
    }

    if (!readable) {
      checks.push(
        ElasticSecurityConnector.skipped(
          "detections-available",
          "Alerts available to import",
          "Skipped because detection alerts could not be read.",
        ),
      );
      return checks;
    }

    // 3. Availability: counts over the last 24 hours and 7 days.
    startedAtMs = Date.now();

    try {
      const last24h: ElasticAlertCount = await client.countAlerts({
        startTime: dayAgo,
        endTime: now,
      });
      const last7d: ElasticAlertCount = await client.countAlerts({
        startTime: weekAgo,
        endTime: now,
      });

      const label24h: string = ElasticSecurityConnector.countLabel(last24h);
      const label7d: string = ElasticSecurityConnector.countLabel(last7d);
      const nothing: boolean = last24h.count === 0 && last7d.count === 0;

      const details: JSONObject = {
        createdLast24h: last24h.count,
        createdLast7d: last7d.count,
        hasMoreLast24h: !last24h.exact,
        hasMoreLast7d: !last7d.exact,
      };

      checks.push(
        makeCheck({
          key: "detections-available",
          name: "Alerts available to import",
          status: nothing ? "warn" : "pass",
          startedAtMs,
          message: nothing
            ? "No alerts were created in the last 7 days. Polling will import new alerts as Elastic Security creates them."
            : `${label24h} alert${label24h === "1" ? "" : "s"} created in the last 24 hours and ${label7d} in the last 7 days.`,
          ...(nothing
            ? {
                remediation:
                  "If you expect alerts, check that detection rules are enabled in this Kibana space and that the space in the connection matches the one the rules run in (alerts are stored per space).",
              }
            : {}),
          details,
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "detections-available",
          name: "Alerts available to import",
          status: "fail",
          startedAtMs,
          message: ElasticSecurityConnector.errorMessage(error),
          remediation: ElasticSecurityConnector.remediationFor(
            error,
            "detections-available",
          ),
        }),
      );
    }

    return checks;
  }

  /*
   * Read every alert created in the window, page by page and oldest
   * first, within the request and event budgets. A budget hit returns
   * complete=false with a warning and the resume point; nothing is
   * silently dropped.
   */
  public async fetchEvents(
    settings: SecurityConnectorSettings,
    window: ConnectorFetchWindow,
    options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult> {
    const parsed: ParsedSettings =
      ElasticSecurityConnector.parseSettings(settings);
    const client: ElasticSecurityClient = this.buildClient(
      parsed,
      options.requestTimeoutInMs,
    );

    const result: ConnectorFetchResult = {
      events: [],
      fetchedCount: 0,
      rejectedCount: 0,
      failedCount: 0,
      complete: true,
      requestCount: 0,
      warnings: [],
      samples: [],
    };

    const pageSize: number = Math.max(
      1,
      Math.min(ELASTIC_SECURITY_MAX_PAGE_SIZE, Math.trunc(options.maxEvents)),
    );
    const endIso: string = window.endTime.toISOString();
    const seenIds: Set<string> = new Set<string>();
    let lowerBound: string = window.startTime.toISOString();
    /*
     * Ids of the alerts already read whose @timestamp is the lower bound.
     * Every alert read earlier is older than the lower bound (pages are
     * ascending and the bound only moves forward), so these are the only
     * read alerts the next `gte` request could return again.
     */
    let tieIds: Array<string> = [];
    // The newest @timestamp read; pages are ascending, so also the last.
    let lastReadTime: Date | undefined = undefined;

    for (;;) {
      if (result.requestCount >= options.maxRequests) {
        result.complete = false;
        result.warnings.push(
          `Stopped after ${options.maxRequests} requests with alerts still unread from ${lowerBound}.`,
        );
        break;
      }

      if (
        Buffer.byteLength(JSON.stringify(tieIds), "utf8") >
        ELASTIC_SECURITY_MAX_EXCLUDED_ID_BYTES
      ) {
        result.complete = false;
        result.warnings.push(
          `${tieIds.length} alerts read so far share the creation time ${lowerBound}, more than one search request can exclude, so the rest of the alerts created at that instant were not read.`,
        );
        break;
      }

      const page: ElasticSearchAlertsResult = await client.searchAlerts({
        startTime: lowerBound,
        endTime: endIso,
        size: pageSize,
        excludeIds: tieIds,
      });
      result.requestCount += 1;

      let newInPage: number = 0;
      let reachedEventBound: boolean = false;

      for (const hit of page.hits) {
        /*
         * A hit without an _id cannot be deduplicated across the overlap
         * re-read; its content stands in for the id so an identical
         * document is still recognized as the same alert.
         */
        const key: string = hit.id || JSON.stringify(hit.source);

        /*
         * Normally excluded by the query; kept so a Kibana or proxy that
         * drops the exclusion re-reads nothing twice.
         */
        if (seenIds.has(key)) {
          continue;
        }

        if (result.fetchedCount >= options.maxEvents) {
          reachedEventBound = true;
          break;
        }

        seenIds.add(key);
        newInPage += 1;
        result.fetchedCount += 1;

        const hitTime: Date | null = parseEventTime(hit.timestamp);

        if (
          hitTime &&
          (!lastReadTime || hitTime.getTime() > lastReadTime.getTime())
        ) {
          lastReadTime = hitTime;
        }

        this.collect(hit, result, options.sampleLimit);
      }

      if (reachedEventBound) {
        result.complete = false;
        result.warnings.push(
          `Stopped after collecting ${options.maxEvents} alerts; the window holds more.`,
        );
        break;
      }

      // A short page is the last page.
      if (page.hits.length < pageSize) {
        break;
      }

      const lastHit: ElasticAlertHit | undefined =
        page.hits[page.hits.length - 1];
      const lastTimestamp: string = lastHit?.timestamp || "";

      if (!lastTimestamp) {
        result.complete = false;
        result.warnings.push(
          "A full page of alerts ended with a document that has no @timestamp, so the window cannot be paged further.",
        );
        break;
      }

      /*
       * A full page with nothing new means the source ignored the
       * exclusion and the lower bound is not moving the result set;
       * another request would return the same page. Report it rather
       * than loop.
       */
      if (newInPage === 0) {
        result.complete = false;
        result.warnings.push(
          `A full page of alerts from ${lowerBound} contained only alerts already read, so the window cannot be paged further.`,
        );
        break;
      }

      const idsAtLastTimestamp: Array<string> = page.hits
        .filter((hit: ElasticAlertHit): boolean => {
          return (
            Boolean(hit.id) &&
            ElasticSecurityConnector.sameInstant(hit.timestamp, lastTimestamp)
          );
        })
        .map((hit: ElasticAlertHit): string => {
          return hit.id;
        });

      /*
       * A page that did not get past the lower bound (all of it shares
       * that instant) adds to the ids already excluded there; a page that
       * moved the bound starts a new list, because nothing read before it
       * carries the new timestamp.
       */
      tieIds = ElasticSecurityConnector.sameInstant(lastTimestamp, lowerBound)
        ? Array.from(new Set<string>([...tieIds, ...idsAtLastTimestamp]))
        : Array.from(new Set<string>(idsAtLastTimestamp));
      lowerBound = lastTimestamp;
    }

    /*
     * Every alert created strictly before lastReadTime inside the window
     * has been read, which is exactly what the poller needs to move on.
     */
    if (!result.complete && lastReadTime) {
      result.resumeAfter = lastReadTime;
    }

    return result;
  }

  /*
   * Two @timestamp values name the same instant. Compared as times so
   * "…412Z" and "…412+00:00" group together; the raw strings are compared
   * only when one does not parse.
   */
  private static sameInstant(left: string, right: string): boolean {
    const leftTime: Date | null = parseEventTime(left);
    const rightTime: Date | null = parseEventTime(right);

    if (leftTime && rightTime) {
      return leftTime.getTime() === rightTime.getTime();
    }

    return left === right;
  }

  private collect(
    hit: ElasticAlertHit,
    result: ConnectorFetchResult,
    sampleLimit: number,
  ): void {
    const raw: JSONObject = ElasticSecurityConnector.toRaw(hit);

    if (!ElasticSecurityNormalizer.isRecognized(raw)) {
      result.rejectedCount += 1;
      return;
    }

    let normalized: NormalizedSecurityEvent;

    try {
      normalized = ElasticSecurityNormalizer.normalize(raw);
    } catch (error) {
      result.failedCount += 1;

      if (result.warnings.length < MAX_NORMALIZATION_WARNINGS) {
        result.warnings.push(
          `Alert ${hit.id || "(no id)"} could not be normalized: ${redactLogString(ConnectorErrorMessage.toMessage(error))}`,
        );
      }

      return;
    }

    result.events.push(normalized);

    if (result.samples.length < sampleLimit) {
      const sample: SecurityConnectorSample = {
        id: normalized.eventUid,
        title: normalized.ruleName || normalized.message,
        severity: normalized.severityName,
        ...(hit.timestamp ? { createdTime: hit.timestamp } : {}),
        eventTime: normalized.time.toISOString(),
      };
      result.samples.push(sample);
    }
  }

  private static toRaw(hit: ElasticAlertHit): JSONObject {
    return {
      _id: hit.id,
      _index: hit.index,
      _source: hit.source,
    };
  }

  /*
   * The rule name for the read-permission message. A document the
   * normalizer cannot read must not turn a successful read into a failed
   * check, so this never throws.
   */
  private static describeHit(hit: ElasticAlertHit): string {
    try {
      const raw: JSONObject = this.toRaw(hit);

      if (!ElasticSecurityNormalizer.isRecognized(raw)) {
        return "unrecognized document";
      }

      return redactLogString(
        ElasticSecurityNormalizer.normalize(raw).ruleName || "unnamed",
      );
    } catch {
      return "unreadable document";
    }
  }

  private static skipped(
    key: string,
    name: string,
    message: string,
  ): SecurityConnectorCheck {
    return makeCheck({
      key,
      name,
      status: "skip",
      startedAtMs: Date.now(),
      message,
    });
  }

  private static countLabel(count: ElasticAlertCount): string {
    return count.exact ? String(count.count) : `${count.count}+`;
  }

  private static errorMessage(error: unknown): string {
    return redactLogString(
      ConnectorErrorMessage.toMessage(error, { truncate: false }),
    );
  }

  /*
   * Remediation is chosen by HTTP status when the failure carried one,
   * and by the step otherwise (a timeout or a non-JSON body means the URL
   * is not reaching Kibana at all).
   */
  private static remediationFor(
    error: unknown,
    step: ProviderCheckStep,
  ): string {
    const status: number | null =
      error instanceof ElasticSecurityHttpError ? error.statusCode : null;

    if (status === 401) {
      return "Create a new API key in Kibana (Stack Management > API keys) and paste its base64 encoded value with Update credentials. Keys can be given an expiry; an expired or invalidated key answers 401.";
    }

    if (status === 403) {
      return "Grant the API key's user (or its role descriptors) read and view_index_metadata on the .alerts-security.alerts-<space-id> index and the Kibana Security feature privilege that allows viewing alerts in this space, then test again.";
    }

    if (status === 404) {
      return "Check the Kibana URL and Kibana space. The URL must be the origin Kibana is served from (for example https://kibana.example.com or https://<deployment>.kb.<region>.cloud.es.io), and the space must be the space id, not its display name.";
    }

    if (status === 429) {
      return "Kibana or Elasticsearch is rate limiting. Wait and test again; consider a longer poll interval.";
    }

    if (status !== null && status >= 500) {
      return "Kibana or Elasticsearch failed internally. Check the Kibana server logs and Elasticsearch cluster health, then test again.";
    }

    if (step === "authentication") {
      return "OneUptime could not get a readable status document from Kibana. Check that the Kibana URL is reachable from the OneUptime API and worker processes (a private network needs a self-hosted OneUptime or a network path), uses the right scheme and port, and is not behind a login page or proxy that rewrites responses.";
    }

    if (step === "read-permission") {
      return "Kibana answered the status request but not the detection engine search. Confirm Elastic Security is enabled in this space and that the API key can read detection alerts.";
    }

    return "The alert count request failed after a successful read. Test again; if it persists, check the Kibana server logs for the signals search endpoint.";
  }
}
