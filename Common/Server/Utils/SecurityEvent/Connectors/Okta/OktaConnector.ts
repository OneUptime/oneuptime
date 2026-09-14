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
import OktaNormalizer from "../../../../../Utils/SecurityEvent/Connectors/OktaNormalizer";
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
import OktaClient, {
  OKTA_DEFAULT_EVENT_FILTER,
  OKTA_MAX_PAGE_SIZE,
  OktaHttpError,
  OktaLogEventCount,
  OktaLogEventsPage,
} from "./OktaClient";

/*
 * Okta System Log connector.
 *
 * Polls log events by their `published` time — the time Okta wrote the
 * event to the System Log, which for this source is the event itself —
 * using the bounded form of GET /api/v1/logs (`since` and `until` both
 * set, `sortOrder=ASCENDING`) and following the Link rel="next" header
 * page by page until the last page (which carries no next link) or an
 * empty page; see OktaClient.
 *
 * Settings come from the catalog's keys: config.orgUrl, config.filter
 * (optional; the default filter selects the security-relevant event
 * families) and secrets.apiToken.
 */

interface ParsedSettings {
  orgUrl: string;
  filter: string;
  apiToken: string;
}

/*
 * The Admin Console is served from a `-admin` host; the API is not. A
 * pasted admin URL answers with a redirect (refused) or a 404, neither of
 * which says why.
 */
const ADMIN_HOST_REGEX: RegExp = /-admin\.[^.]+\.[^.]+$/i;
// The header scheme pasted along with the token.
const TOKEN_SCHEME_PREFIX_REGEX: RegExp = /^ssws\s/i;
const WHITESPACE_REGEX: RegExp = /\s/;
// Okta rejects filters on `published`; it would only surface as a 400 later.
const PUBLISHED_ATTRIBUTE_REGEX: RegExp =
  /(^|[^A-Za-z0-9_.])published\s*[A-Za-z]{2}\s/i;
/*
 * A filter is one line of printable text. Control characters (newlines,
 * tabs, NUL, DEL) can only come from a paste gone wrong, and Okta would
 * answer 400 to them anyway. Checked by code point because the lint rule
 * no-control-regex forbids spelling the range in a regular expression.
 */
function hasControlCharacter(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}

const MAX_FILTER_LENGTH: number = 2000;
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
// Normalization failures quoted into warnings before the rest are counted only.
const MAX_NORMALIZATION_WARNINGS: number = 5;

type ProviderCheckStep =
  | "authentication"
  | "read-permission"
  | "detections-available";

export default class OktaConnector implements SecurityEventConnector {
  public provider: SecurityEventConnectorProvider =
    SecurityEventConnectorProvider.OktaSystemLog;

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
        SecurityEventConnectorProvider.OktaSystemLog,
      );

    if (!definition) {
      throw new BadDataException(
        "Okta System Log is missing from the connector catalog.",
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
    const orgUrl: string = readSettingString(settings.config, "orgUrl");
    const filter: string = readSettingString(settings.config, "filter");
    const apiToken: string = readSettingString(settings.secrets, "apiToken");

    if (!orgUrl) {
      throw new BadDataException(`${this.fieldTitle("orgUrl")} is required.`);
    }

    let parsed: URL;

    try {
      parsed = new URL(orgUrl);
    } catch {
      throw new BadDataException(
        `${this.fieldTitle("orgUrl")} must be an absolute URL such as https://acme.okta.com.`,
      );
    }

    /*
     * Okta orgs are only ever served over TLS; an http URL means the
     * token would be sent in clear text to whatever answers there.
     */
    if (parsed.protocol !== "https:") {
      throw new BadDataException(
        `${this.fieldTitle("orgUrl")} must use https.`,
      );
    }

    if (parsed.search || parsed.hash) {
      throw new BadDataException(
        `${this.fieldTitle("orgUrl")} must not contain a query string or fragment.`,
      );
    }

    if (parsed.pathname !== "/" && parsed.pathname !== "") {
      throw new BadDataException(
        `${this.fieldTitle("orgUrl")} must be the org's base URL without a path (for example https://acme.okta.com, not https://acme.okta.com/api/v1/logs).`,
      );
    }

    if (ADMIN_HOST_REGEX.test(parsed.hostname)) {
      throw new BadDataException(
        `${this.fieldTitle("orgUrl")} must be the org URL users sign in to (for example https://acme.okta.com), not the Admin Console's -admin URL.`,
      );
    }

    if (filter.length > MAX_FILTER_LENGTH) {
      throw new BadDataException(
        `${this.fieldTitle("filter")} must be at most ${MAX_FILTER_LENGTH} characters.`,
      );
    }

    if (hasControlCharacter(filter)) {
      throw new BadDataException(
        `${this.fieldTitle("filter")} must be a single-line filter expression.`,
      );
    }

    if (PUBLISHED_ATTRIBUTE_REGEX.test(filter)) {
      throw new BadDataException(
        `${this.fieldTitle("filter")} must not filter on the published attribute; the connector sets the time range itself.`,
      );
    }

    if (!apiToken) {
      throw new BadDataException(`${this.fieldTitle("apiToken")} is required.`);
    }

    if (TOKEN_SCHEME_PREFIX_REGEX.test(apiToken)) {
      throw new BadDataException(
        `${this.fieldTitle("apiToken")} must be pasted without the 'SSWS' prefix.`,
      );
    }

    if (WHITESPACE_REGEX.test(apiToken)) {
      throw new BadDataException(
        `${this.fieldTitle("apiToken")} must be the token value alone, without spaces.`,
      );
    }

    return { orgUrl: parsed.origin, filter, apiToken };
  }

  public validateSettings(settings: SecurityConnectorSettings): void {
    OktaConnector.parseSettings(settings);
  }

  private buildClient(
    parsed: ParsedSettings,
    requestTimeoutInMs: number,
  ): OktaClient {
    return new OktaClient({
      orgUrl: parsed.orgUrl,
      apiToken: parsed.apiToken,
      transport: this.transport,
      requestTimeoutInMs,
    });
  }

  /*
   * The filter sent with every listing: the tenant's own expression when
   * it set one, otherwise the connector's default event families.
   */
  public static effectiveFilter(filter: string): string {
    return filter.trim() || OKTA_DEFAULT_EVENT_FILTER;
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
      parsed = OktaConnector.parseSettings(settings);
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Okta",
          status: "fail",
          startedAtMs,
          message: redactLogString(ConnectorErrorMessage.toMessage(error)),
          remediation:
            "Correct the highlighted setting and test again. Nothing was contacted.",
        }),
      );
      checks.push(
        OktaConnector.skipped(
          "read-permission",
          "Read System Log events",
          "Skipped because the configuration is invalid.",
        ),
      );
      checks.push(
        OktaConnector.skipped(
          "detections-available",
          "Events available to import",
          "Skipped because the configuration is invalid.",
        ),
      );
      return checks;
    }

    const client: OktaClient = this.buildClient(
      parsed,
      options.requestTimeoutInMs,
    );
    const hostLabel: string = new URL(parsed.orgUrl).host;
    const filter: string = OktaConnector.effectiveFilter(parsed.filter);
    const usingDefaultFilter: boolean = !parsed.filter.trim();

    // 1. Authentication: one event, no bounds, no filter.
    let authenticated: boolean = false;

    try {
      const page: OktaLogEventsPage = await client.probe();
      authenticated = true;

      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Okta",
          status: "pass",
          startedAtMs,
          message: `Okta at ${hostLabel} accepted the API token for the System Log.`,
          details: { probeReturnedEvents: page.events.length },
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Okta",
          status: "fail",
          startedAtMs,
          message: OktaConnector.errorMessage(error),
          remediation: OktaConnector.remediationFor(error, "authentication"),
        }),
      );
    }

    if (!authenticated) {
      checks.push(
        OktaConnector.skipped(
          "read-permission",
          "Read System Log events",
          "Skipped because authentication did not succeed.",
        ),
      );
      checks.push(
        OktaConnector.skipped(
          "detections-available",
          "Events available to import",
          "Skipped because authentication did not succeed.",
        ),
      );
      return checks;
    }

    const now: Date = new Date();
    const dayAgo: Date = new Date(now.getTime() - DAY_IN_MS);
    const weekAgo: Date = new Date(now.getTime() - 7 * DAY_IN_MS);

    /*
     * 2. Read permission: one event from the last 24 hours through the
     * filter polling will use, so an invalid custom filter fails here
     * (HTTP 400) with its own remediation instead of on the first poll.
     */
    startedAtMs = Date.now();
    let readable: boolean = false;

    try {
      const page: OktaLogEventsPage = await client.listLogEvents({
        startTime: dayAgo,
        endTime: now,
        limit: 1,
        filter,
      });
      readable = true;

      const first: JSONObject | undefined = page.events[0];
      const filterLabel: string = usingDefaultFilter
        ? "the default event filter"
        : "the connection's Event filter";

      checks.push(
        makeCheck({
          key: "read-permission",
          name: "Read System Log events",
          status: "pass",
          startedAtMs,
          message: first
            ? `The System Log is readable through ${filterLabel}; the one-record probe over the last 24 hours returned a "${OktaConnector.describeEvent(first)}" event.`
            : `The System Log is readable through ${filterLabel}. No matching event was published in the last 24 hours.`,
          details: { usingDefaultFilter },
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "read-permission",
          name: "Read System Log events",
          status: "fail",
          startedAtMs,
          message: OktaConnector.errorMessage(error),
          remediation: OktaConnector.remediationFor(error, "read-permission"),
        }),
      );
    }

    if (!readable) {
      checks.push(
        OktaConnector.skipped(
          "detections-available",
          "Events available to import",
          "Skipped because System Log events could not be read.",
        ),
      );
      return checks;
    }

    // 3. Availability: counts over the last 24 hours and 7 days.
    startedAtMs = Date.now();

    try {
      const last24h: OktaLogEventCount = await client.countLogEvents({
        startTime: dayAgo,
        endTime: now,
        filter,
      });
      const last7d: OktaLogEventCount = await client.countLogEvents({
        startTime: weekAgo,
        endTime: now,
        filter,
      });

      const label24h: string = OktaConnector.countLabel(last24h);
      const label7d: string = OktaConnector.countLabel(last7d);
      const nothing: boolean = last24h.count === 0 && last7d.count === 0;

      const details: JSONObject = {
        createdLast24h: last24h.count,
        createdLast7d: last7d.count,
        hasMoreLast24h: last24h.hasMore,
        hasMoreLast7d: last7d.hasMore,
        usingDefaultFilter,
      };

      checks.push(
        makeCheck({
          key: "detections-available",
          name: "Events available to import",
          status: nothing ? "warn" : "pass",
          startedAtMs,
          message: nothing
            ? "No matching events were published in the last 7 days. Polling will import new events as Okta publishes them."
            : `${label24h} event${label24h === "1" ? "" : "s"} published in the last 24 hours and ${label7d} in the last 7 days.`,
          ...(nothing
            ? {
                remediation: usingDefaultFilter
                  ? "An active Okta org publishes sign-in events constantly, so an empty week usually means the org URL points at a sandbox or an unused org. Check the Okta organization URL."
                  : "The connection's Event filter matched nothing in seven days. Check the expression against the event types in Okta's System Log, or clear it to use the default event families.",
              }
            : {}),
          details,
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "detections-available",
          name: "Events available to import",
          status: "fail",
          startedAtMs,
          message: OktaConnector.errorMessage(error),
          remediation: OktaConnector.remediationFor(
            error,
            "detections-available",
          ),
        }),
      );
    }

    return checks;
  }

  /*
   * Read every event published in the window, page by page, within the
   * request and event budgets. A budget hit returns complete=false with a
   * warning so the poller holds its cursor and the next poll re-reads the
   * same window; nothing is silently dropped.
   */
  public async fetchEvents(
    settings: SecurityConnectorSettings,
    window: ConnectorFetchWindow,
    options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult> {
    const parsed: ParsedSettings = OktaConnector.parseSettings(settings);
    const client: OktaClient = this.buildClient(
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
      Math.min(OKTA_MAX_PAGE_SIZE, Math.trunc(options.maxEvents)),
    );
    const startIso: string = window.startTime.toISOString();
    const endIso: string = window.endTime.toISOString();
    const seenIds: Set<string> = new Set<string>();
    let nextUrl: string | null = null;

    for (;;) {
      if (result.requestCount >= options.maxRequests) {
        result.complete = false;
        result.warnings.push(
          `Stopped after ${options.maxRequests} requests with events still unread in the window ${startIso} to ${endIso}. The poll cursor is held so the next poll continues from the same window.`,
        );
        break;
      }

      const page: OktaLogEventsPage = nextUrl
        ? await client.listNextPage(nextUrl)
        : await client.listLogEvents({
            startTime: startIso,
            endTime: endIso,
            limit: pageSize,
            filter: OktaConnector.effectiveFilter(parsed.filter),
          });
      result.requestCount += 1;

      let reachedEventBound: boolean = false;

      for (const event of page.events) {
        /*
         * `uuid` is the event's own identifier. An event without one is
         * keyed by its content, so an identical copy on a later page is
         * still recognized as the same event.
         */
        const key: string =
          OktaConnector.readText(event["uuid"]) || JSON.stringify(event);

        if (seenIds.has(key)) {
          continue;
        }

        if (result.fetchedCount >= options.maxEvents) {
          reachedEventBound = true;
          break;
        }

        seenIds.add(key);
        result.fetchedCount += 1;
        this.collect(event, result, options.sampleLimit);
      }

      if (reachedEventBound) {
        result.complete = false;
        result.warnings.push(
          `Stopped after collecting ${options.maxEvents} events; the window holds more. The poll cursor is held so the next poll continues from the same window.`,
        );
        break;
      }

      /*
       * A bounded request's last page carries no next link; an empty page
       * is also the end (Okta's own guidance for consumers). Both stop
       * the loop cleanly.
       */
      if (!page.nextUrl || page.events.length === 0) {
        break;
      }

      nextUrl = page.nextUrl;
    }

    return result;
  }

  private collect(
    raw: JSONObject,
    result: ConnectorFetchResult,
    sampleLimit: number,
  ): void {
    if (!OktaNormalizer.isRecognized(raw)) {
      result.rejectedCount += 1;
      return;
    }

    let normalized: NormalizedSecurityEvent;

    try {
      normalized = OktaNormalizer.normalize(raw);
    } catch (error) {
      result.failedCount += 1;

      if (result.warnings.length < MAX_NORMALIZATION_WARNINGS) {
        result.warnings.push(
          `Event ${OktaConnector.readText(raw["uuid"]) || "(no uuid)"} could not be normalized: ${redactLogString(ConnectorErrorMessage.toMessage(error))}`,
        );
      }

      return;
    }

    result.events.push(normalized);

    if (result.samples.length < sampleLimit) {
      const published: string = OktaConnector.readText(raw["published"]);
      const sample: SecurityConnectorSample = {
        id: normalized.eventUid,
        title: normalized.message,
        severity: normalized.severityName,
        ...(published ? { createdTime: published } : {}),
        eventTime: normalized.time.toISOString(),
      };
      result.samples.push(sample);
    }
  }

  /*
   * The event type for the read-permission message. A record the
   * normalizer cannot read must not turn a successful read into a failed
   * check, so this never throws.
   */
  private static describeEvent(raw: JSONObject): string {
    try {
      if (!OktaNormalizer.isRecognized(raw)) {
        return "unrecognized record";
      }

      return redactLogString(
        OktaConnector.readText(raw["eventType"]) || "unnamed",
      );
    } catch {
      return "unreadable record";
    }
  }

  private static readText(value: unknown): string {
    if (value === null || value === undefined || typeof value === "object") {
      return "";
    }

    return String(value);
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

  private static countLabel(count: OktaLogEventCount): string {
    return count.hasMore ? `${count.count}+` : String(count.count);
  }

  private static errorMessage(error: unknown): string {
    return redactLogString(
      ConnectorErrorMessage.toMessage(error, { truncate: false }),
    );
  }

  /*
   * Remediation is chosen by HTTP status when the failure carried one,
   * and by the step otherwise (a timeout or a non-JSON body means the URL
   * is not reaching Okta at all).
   */
  private static remediationFor(
    error: unknown,
    step: ProviderCheckStep,
  ): string {
    const status: number | null =
      error instanceof OktaHttpError ? error.statusCode : null;

    if (status === 400) {
      if (step === "authentication") {
        return "Okta rejected the probe request. Check the Okta organization URL points at an Okta org and test again.";
      }

      return "Okta rejected the request parameters, which after a successful authentication almost always means the Event filter is not a valid System Log filter expression. Compare it with the examples in the Okta System Log documentation (operators eq, ne, co, sw, ew, pr, gt, ge, lt, le joined with and/or, string values in double quotes, no published attribute), or clear it to use the default event families.";
    }

    if (status === 401) {
      return "Create a new API token in the Okta Admin Console (Security > API > Tokens) as a Read-only Administrator and paste it with Update credentials. SSWS tokens expire after 30 days without use and are deprovisioned when their creator is deactivated.";
    }

    if (status === 403) {
      return "The token's admin cannot read the System Log. Create the token as a Read-only Administrator or Super Administrator (API tokens inherit the privileges of the admin who created them), and if the token has a network zone restriction, allow the addresses OneUptime calls from.";
    }

    if (status === 404) {
      return "Check the Okta organization URL. It must be the org's base URL such as https://acme.okta.com or https://acme.oktapreview.com, without a path, and not the -admin URL of the Admin Console.";
    }

    if (status === 429) {
      return "Okta is rate limiting this token. Wait for the limit to reset and test again; raise the token's rate limit percentage in the Admin Console (Security > API > Tokens) or use a longer poll interval.";
    }

    if (status !== null && status >= 500) {
      return "Okta failed internally or the query timed out on Okta's side. Test again; if it persists, check status.okta.com.";
    }

    if (step === "authentication") {
      return "OneUptime could not get an answer from Okta. Check that the Okta organization URL is reachable from the OneUptime API and worker processes, uses https, and is not behind a proxy that rewrites responses.";
    }

    if (step === "read-permission") {
      return "Okta answered the probe but not the filtered read over the last 24 hours. Test again; if it persists, simplify the Event filter.";
    }

    return "The event count request failed after a successful read. Test again; if it persists, the org may be rate limiting the token.";
  }
}
