import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
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
import SplunkNormalizer from "../../../../../Utils/SecurityEvent/Connectors/SplunkNormalizer";
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
import SplunkClient, {
  SPLUNK_DEFAULT_SEARCH,
  SplunkCount,
  SplunkCurrentContext,
  SplunkExportResult,
} from "./SplunkClient";

/*
 * Splunk Enterprise Security connector: notable events (or whatever the
 * tenant's Search selects) read through the search export API, windowed
 * on `_time`. For a notable, `_time` is when the correlation search
 * CREATED it — a correlation search running hourly over the previous
 * hour stamps its notables with the time it ran, not the time of the
 * activity it matched — so a window on `_time` is a window on creation
 * time, which is what the framework's forward-moving cursor needs (see
 * Connectors/Types.ts).
 *
 * Splunk's export is a single streamed response, not a paged listing, so
 * "pagination" here is the row cap: the client sorts the window by
 * `_time` ascending and asks for the event budget plus one. A hit budget
 * returns complete=false with resumeAfter set to the `_time` of the last
 * row read, so the poller moves its cursor there instead of re-reading
 * the same oldest rows forever (review finding
 * bound-hit-window-never-advances). Without the sort, the export's
 * newest-first order would keep the newest rows and the older ones would
 * never be reachable at all.
 *
 * Settings come from the catalog's keys: config.url, config.searchString,
 * config.username, secrets.apiToken and secrets.password.
 */

interface ParsedSettings {
  url: string;
  searchString: string;
  username: string;
  apiToken: string;
  password: string;
}

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

export default class SplunkConnector implements SecurityEventConnector {
  public provider: SecurityEventConnectorProvider =
    SecurityEventConnectorProvider.SplunkEnterpriseSecurity;

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
        SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
      );

    if (!definition) {
      throw new BadDataException(
        "Splunk Enterprise Security is missing from the connector catalog.",
      );
    }

    return definition;
  }

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

  /*
   * Shape checks the form can act on. URL and search syntax are delegated
   * to the client's normalizers so the message here and the request
   * later agree on what is acceptable.
   */
  private static parseSettings(
    settings: SecurityConnectorSettings,
  ): ParsedSettings {
    const rawUrl: string = readSettingString(settings.config, "url");
    const rawSearch: string =
      readSettingString(settings.config, "searchString") ||
      SPLUNK_DEFAULT_SEARCH;
    const username: string = readSettingString(settings.config, "username");
    const apiToken: string = readSettingString(settings.secrets, "apiToken");
    const password: string = readSettingString(settings.secrets, "password");

    if (!rawUrl) {
      throw new BadDataException(`${this.fieldTitle("url")} is required.`);
    }

    const url: string = SplunkClient.normalizeBaseUrl(rawUrl);
    const searchString: string = SplunkClient.normalizeSearchString(rawSearch);

    if (!apiToken) {
      if (!username && !password) {
        throw new BadDataException(
          `Provide an ${this.fieldTitle("apiToken")}, or a ${this.fieldTitle("username")} and ${this.fieldTitle("password")}.`,
        );
      }

      if (!username) {
        throw new BadDataException(
          `${this.fieldTitle("username")} is required when a ${this.fieldTitle("password")} is set.`,
        );
      }

      if (!password) {
        throw new BadDataException(
          `${this.fieldTitle("password")} is required when a ${this.fieldTitle("username")} is set and no ${this.fieldTitle("apiToken")} is given.`,
        );
      }
    }

    return { url, searchString, username, apiToken, password };
  }

  public validateSettings(settings: SecurityConnectorSettings): void {
    SplunkConnector.parseSettings(settings);
  }

  private buildClient(
    parsed: ParsedSettings,
    requestTimeoutInMs: number,
  ): SplunkClient {
    return new SplunkClient({
      url: parsed.url,
      apiToken: parsed.apiToken || undefined,
      username: parsed.apiToken ? undefined : parsed.username,
      password: parsed.apiToken ? undefined : parsed.password,
      searchString: parsed.searchString,
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
      parsed = SplunkConnector.parseSettings(settings);
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Splunk",
          status: "fail",
          startedAtMs,
          message: redactLogString(ConnectorErrorMessage.toMessage(error)),
          remediation:
            "Correct the highlighted setting and test again. Nothing was contacted.",
        }),
      );
      return checks;
    }

    const client: SplunkClient = this.buildClient(
      parsed,
      options.requestTimeoutInMs,
    );

    try {
      const context: SplunkCurrentContext = await client.getCurrentContext();
      const roles: string = context.roles.length
        ? context.roles.join(", ")
        : "no roles reported";
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Splunk",
          status: "pass",
          startedAtMs,
          message: `Splunk accepted the ${parsed.apiToken ? "authentication token" : "username and password"} as user ${context.username || "(unknown)"} with roles: ${roles}.`,
          details: {
            username: context.username,
            roles: context.roles,
            hasSearchCapability: context.capabilities.includes("search"),
          },
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Splunk",
          status: "fail",
          startedAtMs,
          message: redactLogString(
            ConnectorErrorMessage.toMessage(error, { truncate: false }),
          ),
          remediation: SplunkConnector.authenticationRemediation(
            ConnectorErrorMessage.toMessage(error, { truncate: false }),
          ),
        }),
      );
      checks.push(
        SplunkConnector.skipped(
          "read-permission",
          "Run the search on Splunk",
          "Skipped because authentication failed.",
        ),
      );
      checks.push(
        SplunkConnector.skipped(
          "detections-available",
          "Notable events available to import",
          "Skipped because authentication failed.",
        ),
      );
      return checks;
    }

    const now: Date = new Date();
    const dayAgo: Date = new Date(now.getTime() - DAY_IN_MS);
    const weekAgo: Date = new Date(now.getTime() - 7 * DAY_IN_MS);

    startedAtMs = Date.now();

    try {
      /*
       * Any row proves the search runs; sorting a whole day on the search
       * head just to pick which one would make the test slow on a busy
       * index.
       */
      const probe: SplunkExportResult = await client.exportSearch({
        startTime: dayAgo,
        endTime: now,
        maxResults: 1,
        oldestFirst: false,
      });
      checks.push(
        makeCheck({
          key: "read-permission",
          name: "Run the search on Splunk",
          status: "pass",
          startedAtMs,
          message: `Splunk ran "${parsed.searchString}" through the ${probe.apiVersion === "v2" ? "search/v2/jobs/export" : "deprecated search/jobs/export"} endpoint (${probe.results.length} record${probe.results.length === 1 ? "" : "s"} returned for a one-record probe over the last 24 hours).`,
          details: { apiVersion: probe.apiVersion },
        }),
      );
    } catch (error) {
      const message: string = redactLogString(
        ConnectorErrorMessage.toMessage(error, { truncate: false }),
      );
      checks.push(
        makeCheck({
          key: "read-permission",
          name: "Run the search on Splunk",
          status: "fail",
          startedAtMs,
          message,
          remediation: SplunkConnector.readRemediation(message),
        }),
      );
      checks.push(
        SplunkConnector.skipped(
          "detections-available",
          "Notable events available to import",
          "Skipped because the search check failed.",
        ),
      );
      return checks;
    }

    startedAtMs = Date.now();

    try {
      const last24h: SplunkCount = await client.countSearch({
        startTime: dayAgo,
        endTime: now,
      });
      const last7d: SplunkCount = await client.countSearch({
        startTime: weekAgo,
        endTime: now,
      });
      const nothing: boolean = last24h.count === 0 && last7d.count === 0;

      checks.push(
        makeCheck({
          key: "detections-available",
          name: "Notable events available to import",
          status: nothing ? "warn" : "pass",
          startedAtMs,
          message: nothing
            ? `No records matched "${parsed.searchString}" in the last 7 days. Polling will import new notable events as Splunk creates them.`
            : `${last24h.count} record${last24h.count === 1 ? "" : "s"} created in the last 24 hours and ${last7d.count} in the last 7 days.`,
          ...(nothing
            ? {
                remediation:
                  "Confirm in Splunk that the search returns results over the last 7 days (Incident Review for notable events). A search head where Enterprise Security has not created notables produces none; check that the correlation searches are enabled and that the user's role can read the searched index.",
              }
            : {}),
          details: {
            createdLast24h: last24h.count,
            createdLast7d: last7d.count,
            hasMoreLast24h: false,
            hasMoreLast7d: false,
          },
        }),
      );
    } catch (error) {
      const message: string = redactLogString(
        ConnectorErrorMessage.toMessage(error, { truncate: false }),
      );
      checks.push(
        makeCheck({
          key: "detections-available",
          name: "Notable events available to import",
          status: "fail",
          startedAtMs,
          message,
          remediation: SplunkConnector.readRemediation(message),
        }),
      );
    }

    return checks;
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

  /*
   * Remediation keyed off the HTTP status the client put in the message,
   * so the check tells the reader what to change instead of quoting
   * Splunk.
   */
  private static authenticationRemediation(message: string): string {
    if (message.includes("(HTTP 401)")) {
      return "Create a new authentication token in Splunk (Settings > Tokens > New Token) for a user whose role can search the notable index, confirm token authentication is enabled on the search head, and update the connection's credentials. For username and password, check both against Splunk Web.";
    }

    if (
      message.includes("(HTTP 404)") ||
      message.includes("not newline-delimited JSON") ||
      message.includes("non-JSON body")
    ) {
      return "Point the Splunk management URL at the search head's management port (usually https://<host>:8089) with no path. Splunk Web on port 8000 does not serve the REST API.";
    }

    if (message.includes("did not complete")) {
      return "Splunk did not answer in time or could not be reached. Check that the OneUptime API and worker processes can open a connection to the management port, that the certificate is trusted, and — for OneUptime Cloud — that the search head is reachable from the internet (private addresses are refused).";
    }

    return "Read the message prefix to see which step failed, then follow the troubleshooting section of the Splunk Enterprise Security integration docs.";
  }

  private static readRemediation(message: string): string {
    if (message.includes("(HTTP 403)")) {
      return "Give the token's user a role with the search capability and read access to the searched index (srchIndexesAllowed includes notable, or the role inherits ess_analyst / ess_user in Splunk Enterprise Security).";
    }

    if (message.includes("(HTTP 401)")) {
      return "Splunk stopped accepting the credentials between the first request and the search. The token may have just expired; create a new one and update the connection's credentials.";
    }

    if (
      message.includes("(HTTP 400)") ||
      message.includes("rejected by Splunk")
    ) {
      return "Fix the Search setting: it must be a filter such as index=notable without earliest, latest or a leading pipe. Run the same SPL in Splunk Web to see the parser's error.";
    }

    if (message.includes("(HTTP 429)")) {
      return "Splunk is throttling this user. Wait and test again; scheduled polls retry automatically.";
    }

    if (message.includes("did not complete")) {
      return "Splunk did not answer in time. A search over the notable index that takes longer than the request timeout is usually a search head under load or a Search that scans a large index; narrow the Search.";
    }

    return SplunkConnector.authenticationRemediation(message);
  }

  /*
   * Read every record created in the window within the request and
   * event budgets, oldest first. A budget hit returns complete=false with
   * a warning and the resume point; nothing is silently dropped.
   */
  public async fetchEvents(
    settings: SecurityConnectorSettings,
    window: ConnectorFetchWindow,
    options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult> {
    const parsed: ParsedSettings = SplunkConnector.parseSettings(settings);
    const client: SplunkClient = this.buildClient(
      parsed,
      options.requestTimeoutInMs,
    );

    const warnings: Array<string> = [];
    let complete: boolean = true;

    /*
     * One export covers the window; the v1 fallback is the only way it
     * becomes two. A request budget below that cannot read anything, so
     * it is reported rather than exceeded.
     */
    if (options.maxRequests < 1) {
      return {
        events: [],
        fetchedCount: 0,
        rejectedCount: 0,
        failedCount: 0,
        complete: false,
        requestCount: 0,
        warnings: [
          "The request budget for this run is zero, so the window was not read.",
        ],
        samples: [],
      };
    }

    const exported: SplunkExportResult = await client.exportSearch({
      startTime: window.startTime,
      endTime: window.endTime,
      maxResults: options.maxEvents,
      // A capped read must keep the oldest rows, or it can never resume.
      oldestFirst: true,
    });

    let resumeAfter: Date | undefined = undefined;

    if (exported.truncated) {
      complete = false;
      resumeAfter = SplunkConnector.lastReadTime(exported.results, window);
      warnings.push(
        resumeAfter
          ? `Stopped after collecting ${exported.results.length} records; the window holds more. Records are read oldest first, and the last one read was created at ${resumeAfter.toISOString()}, where the next poll can resume.`
          : `Stopped after collecting ${exported.results.length} records; the window holds more, and no record read carried a _time to resume from.`,
      );
    }

    if (exported.apiVersion === "v1") {
      warnings.push(
        "Splunk answered 404 for search/v2/jobs/export, so the deprecated search/jobs/export endpoint was used. Upgrade the search head to Splunk 9.0.1 or later; the v1 endpoint is disabled in current releases.",
      );
    }

    if (client.getRequestCount() > options.maxRequests) {
      warnings.push(
        `The v1 fallback took ${client.getRequestCount()} requests against a budget of ${options.maxRequests}.`,
      );
    }

    const events: Array<NormalizedSecurityEvent> = [];
    const samples: Array<SecurityConnectorSample> = [];
    let rejectedCount: number = 0;
    let failedCount: number = 0;

    for (const raw of exported.results) {
      if (!SplunkNormalizer.isRecognized(raw)) {
        rejectedCount++;
        continue;
      }

      try {
        const normalized: NormalizedSecurityEvent =
          SplunkNormalizer.normalize(raw);
        events.push(normalized);

        if (samples.length < options.sampleLimit) {
          samples.push(SplunkConnector.toSample(raw, normalized));
        }
      } catch {
        failedCount++;
      }
    }

    return {
      events,
      fetchedCount: exported.results.length,
      rejectedCount,
      failedCount,
      complete,
      requestCount: client.getRequestCount(),
      warnings,
      samples,
      resumeAfter,
    };
  }

  /*
   * The `_time` of the last row read. The export is sorted ascending, so
   * every row created strictly before it inside the window has been read.
   * Rows are scanned from the end because sort places a row without a
   * readable `_time` last; a time past the window end means the rows are
   * not ordered the way the resume point assumes, so none is reported and
   * the poller narrows the window instead of trusting it.
   */
  private static lastReadTime(
    rows: Array<JSONObject>,
    window: ConnectorFetchWindow,
  ): Date | undefined {
    for (let index: number = rows.length - 1; index >= 0; index--) {
      const row: JSONObject | undefined = rows[index];
      const time: Date | null = row
        ? parseEventTime(row["_time"] as JSONValue)
        : null;

      if (!time) {
        continue;
      }

      return time.getTime() > window.endTime.getTime() ? undefined : time;
    }

    return undefined;
  }

  /*
   * For a notable, `_time` is its creation time. `orig_time` (when a
   * correlation search carried it over from the matched event) is the
   * closest thing to the activity's own time; the normalized time is
   * used otherwise so the sample always has both stamps.
   */
  private static toSample(
    raw: JSONObject,
    normalized: NormalizedSecurityEvent,
  ): SecurityConnectorSample {
    const activityTime: Date | null = parseEventTime(
      raw["orig_time"] as JSONValue,
    );

    return {
      id: normalized.eventUid,
      title: normalized.message,
      severity: normalized.severityName,
      createdTime: normalized.time.toISOString(),
      eventTime: (activityTime || normalized.time).toISOString(),
    };
  }
}
