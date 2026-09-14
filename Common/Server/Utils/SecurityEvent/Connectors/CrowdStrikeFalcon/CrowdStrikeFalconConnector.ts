import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  ConnectorField,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import CrowdStrikeFalconNormalizer from "../../../../../Utils/SecurityEvent/Connectors/CrowdStrikeFalconNormalizer";
import {
  parseEventTime,
  readString,
  readValue,
} from "../../../../../Utils/SecurityEvent/NormalizerHelpers";
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
import CrowdStrikeFalconClient, {
  CROWDSTRIKE_ALERTS_OFFSET_CEILING,
  CROWDSTRIKE_ALERTS_PAGE_SIZE,
  CROWDSTRIKE_FALCON_CLOUDS,
  CrowdStrikeAlertCount,
  CrowdStrikeAlertIdsPage,
  CrowdStrikeFalconCloud,
  getCrowdStrikeFalconBaseUrl,
} from "./CrowdStrikeFalconClient";

/*
 * CrowdStrike Falcon connector: alerts through the Alerts API, listed by
 * the time Falcon CREATED the alert (created_timestamp), never by the
 * time of the underlying activity (`timestamp`). An alert Falcon raises
 * an hour after the behaviour it describes still lands in the poll
 * window that covers its creation, which is the whole point of the
 * framework (see Connectors/Types.ts).
 *
 * Each page of the window costs two requests: an ids query
 * (GET /alerts/queries/alerts/v2, sorted created_timestamp ascending)
 * and one entity fetch (POST /alerts/entities/alerts/v2) for exactly that
 * page's ids. The page size equals the entity batch size so the two
 * never drift apart.
 *
 * Settings come from the catalog's keys: config.clientId, config.cloud
 * and secrets.clientSecret.
 */

interface ResumePoint {
  resumeAfter: Date | undefined;
  // True when the alerts read were not in created_timestamp order.
  outOfOrder: boolean;
}

interface ParsedSettings {
  clientId: string;
  clientSecret: string;
  cloud: CrowdStrikeFalconCloud;
}

/*
 * Falcon API client ids are opaque hex strings today, but the format is
 * not documented as a contract, so validation only rejects what can never
 * be an id: whitespace, quotes and anything unreasonably long. A wrong id
 * is caught by the authentication check instead.
 */
const CLIENT_ID_REGEX: RegExp = /^[A-Za-z0-9_.:-]{8,128}$/;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const CHECK_NAME_AUTHENTICATION: string =
  "Authenticate with CrowdStrike Falcon";
const CHECK_NAME_READ: string = "Read alerts from the Falcon Alerts API";
const CHECK_NAME_AVAILABLE: string = "Alerts available to import";

/*
 * The production transport drops response headers on error statuses, so
 * the X-RateLimit-RetryAfter value is only in the message when a transport
 * kept it; the advice must not depend on it being there.
 */
const RATE_LIMIT_REMEDIATION: string =
  "Falcon is rate limiting this API client. Wait a few minutes (at least the X-RateLimit-RetryAfter period when the message names one) and test again; scheduled polls retry automatically.";

export default class CrowdStrikeFalconConnector
  implements SecurityEventConnector
{
  public provider: SecurityEventConnectorProvider =
    SecurityEventConnectorProvider.CrowdStrikeFalcon;

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
        SecurityEventConnectorProvider.CrowdStrikeFalcon,
      );

    if (!definition) {
      throw new BadDataException(
        "CrowdStrike Falcon is missing from the connector catalog.",
      );
    }

    return definition;
  }

  /*
   * Validation messages name the field the way the form does, read from
   * the catalog so a retitled field cannot leave a stale name here.
   */
  private static fieldTitle(key: string): string {
    const definition: SecurityEventConnectorDefinition = this.getDefinition();
    const field: ConnectorField | undefined = [
      ...definition.configFields,
      ...definition.secretFields,
    ].find((candidate: ConnectorField): boolean => {
      return candidate.key === key;
    });

    return field?.title || key;
  }

  private static parseSettings(
    settings: SecurityConnectorSettings,
  ): ParsedSettings {
    const clientId: string = readSettingString(settings.config, "clientId");
    const cloud: string = (
      readSettingString(settings.config, "cloud") || "us-1"
    ).toLowerCase();
    const clientSecret: string = readSettingString(
      settings.secrets,
      "clientSecret",
    );

    if (!clientId || !CLIENT_ID_REGEX.test(clientId)) {
      throw new BadDataException(
        `${this.fieldTitle("clientId")} must be the Falcon API client ID shown under API clients and keys in the Falcon console.`,
      );
    }

    if (!getCrowdStrikeFalconBaseUrl(cloud)) {
      throw new BadDataException(
        `${this.fieldTitle("cloud")} must be one of: ${CROWDSTRIKE_FALCON_CLOUDS.join(", ")}.`,
      );
    }

    if (!clientSecret) {
      throw new BadDataException(
        `${this.fieldTitle("clientSecret")} is required.`,
      );
    }

    return { clientId, clientSecret, cloud: cloud as CrowdStrikeFalconCloud };
  }

  public validateSettings(settings: SecurityConnectorSettings): void {
    CrowdStrikeFalconConnector.parseSettings(settings);
  }

  private buildClient(
    parsed: ParsedSettings,
    requestTimeoutInMs: number,
  ): CrowdStrikeFalconClient {
    return new CrowdStrikeFalconClient({
      cloud: parsed.cloud,
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
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
      parsed = CrowdStrikeFalconConnector.parseSettings(settings);
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: CHECK_NAME_AUTHENTICATION,
          status: "fail",
          startedAtMs,
          message: redactLogString(ConnectorErrorMessage.toMessage(error)),
          remediation:
            "Correct the highlighted setting and test again. Nothing was contacted.",
        }),
      );
      return checks;
    }

    const client: CrowdStrikeFalconClient = this.buildClient(
      parsed,
      options.requestTimeoutInMs,
    );

    try {
      await client.getAccessToken();
      checks.push(
        makeCheck({
          key: "authentication",
          name: CHECK_NAME_AUTHENTICATION,
          status: "pass",
          startedAtMs,
          message: `Falcon issued an OAuth2 access token for the ${parsed.cloud.toUpperCase()} cloud (${new URL(client.getBaseUrl()).host}).`,
        }),
      );
    } catch (error) {
      const message: string = redactLogString(
        ConnectorErrorMessage.toMessage(error, { truncate: false }),
      );
      checks.push(
        makeCheck({
          key: "authentication",
          name: CHECK_NAME_AUTHENTICATION,
          status: "fail",
          startedAtMs,
          message,
          remediation: CrowdStrikeFalconConnector.authenticationRemediation(
            message,
            parsed.cloud,
          ),
        }),
      );
      checks.push(
        CrowdStrikeFalconConnector.skipped(
          "read-permission",
          CHECK_NAME_READ,
          "Skipped because authentication failed.",
        ),
      );
      checks.push(
        CrowdStrikeFalconConnector.skipped(
          "detections-available",
          CHECK_NAME_AVAILABLE,
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
      const page: CrowdStrikeAlertIdsPage = await client.queryAlertIds({
        filter: CrowdStrikeFalconClient.buildCreatedTimestampFilter(
          dayAgo,
          now,
        ),
        limit: 1,
        offset: 0,
      });
      checks.push(
        makeCheck({
          key: "read-permission",
          name: CHECK_NAME_READ,
          status: "pass",
          startedAtMs,
          message: `The Alerts API accepted a query with the Alerts: Read scope (${page.compositeIds.length} alert id${page.compositeIds.length === 1 ? "" : "s"} returned for a one-record probe over the last 24 hours).`,
        }),
      );
    } catch (error) {
      const message: string = redactLogString(
        ConnectorErrorMessage.toMessage(error, { truncate: false }),
      );
      checks.push(
        makeCheck({
          key: "read-permission",
          name: CHECK_NAME_READ,
          status: "fail",
          startedAtMs,
          message,
          remediation: CrowdStrikeFalconConnector.readRemediation(
            message,
            parsed.cloud,
          ),
        }),
      );
      checks.push(
        CrowdStrikeFalconConnector.skipped(
          "detections-available",
          CHECK_NAME_AVAILABLE,
          "Skipped because the read check failed.",
        ),
      );
      return checks;
    }

    startedAtMs = Date.now();

    try {
      const last24h: CrowdStrikeAlertCount =
        await client.countAlertsCreatedBetween({
          startTime: dayAgo,
          endTime: now,
        });
      const last7d: CrowdStrikeAlertCount =
        await client.countAlertsCreatedBetween({
          startTime: weekAgo,
          endTime: now,
        });

      const label24h: string = CrowdStrikeFalconConnector.countLabel(last24h);
      const label7d: string = CrowdStrikeFalconConnector.countLabel(last7d);
      const nothing: boolean = last24h.count === 0 && last7d.count === 0;

      checks.push(
        makeCheck({
          key: "detections-available",
          name: CHECK_NAME_AVAILABLE,
          status: nothing ? "warn" : "pass",
          startedAtMs,
          message: nothing
            ? "No alerts were created in the last 7 days. Polling will import new alerts as Falcon creates them."
            : `${label24h} alert${label24h === "1" ? "" : "s"} created in the last 24 hours and ${label7d} in the last 7 days.`,
          ...(nothing
            ? {
                remediation:
                  "Confirm that alerts exist for this CID in the Falcon console (Endpoint security > Endpoint detections, or Next-Gen SIEM > Alerts). A CID with no sensors deployed produces none.",
              }
            : {}),
          details: {
            createdLast24h: label24h,
            createdLast7d: label7d,
            hasMoreLast24h: !last24h.exact,
            hasMoreLast7d: !last7d.exact,
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
          name: CHECK_NAME_AVAILABLE,
          status: "fail",
          startedAtMs,
          message,
          remediation: CrowdStrikeFalconConnector.readRemediation(
            message,
            parsed.cloud,
          ),
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

  private static countLabel(count: CrowdStrikeAlertCount): string {
    return count.exact ? String(count.count) : `${count.count}+`;
  }

  /*
   * Remediation keyed off the HTTP status the client put in the message,
   * so the check tells the reader what to change instead of quoting
   * Falcon. Falcon answers a client from another cloud with 401/403 at
   * the token endpoint, which reads like a bad secret, so the cloud is
   * named first.
   */
  private static authenticationRemediation(
    message: string,
    cloud: CrowdStrikeFalconCloud,
  ): string {
    if (message.includes("(HTTP 401)") || message.includes("(HTTP 403)")) {
      return `Falcon rejected the client credentials. Check that the Falcon cloud (${cloud}) is the cloud your CID is hosted in (Support and resources > API clients and keys shows the cloud next to the client), that the Client ID matches that API client, and that the Client secret is the one issued with it. Secrets are shown once; if it was lost, reset it in the Falcon console and use Update credentials here.`;
    }

    if (message.includes("(HTTP 429)")) {
      return RATE_LIMIT_REMEDIATION;
    }

    if (message.includes("could not be completed")) {
      return `Falcon did not answer in time. Check outbound connectivity from the OneUptime API and worker processes to ${new URL(getCrowdStrikeFalconBaseUrl(cloud) || "https://api.crowdstrike.com").host}.`;
    }

    return "Read the message prefix to see which step failed, then follow the troubleshooting section of the CrowdStrike Falcon integration docs.";
  }

  private static readRemediation(
    message: string,
    cloud: CrowdStrikeFalconCloud,
  ): string {
    if (message.includes("(HTTP 403)")) {
      return "The token was accepted but the Alerts API refused the query. In the Falcon console, open Support and resources > API clients and keys, edit this API client and enable the Alerts: Read scope, then save. Scope changes apply to the next token, so test again after a minute.";
    }

    if (message.includes("(HTTP 401)")) {
      return `The token was minted but the Alerts API refused it. Check that the Falcon cloud (${cloud}) matches the cloud of the CID that issued the API client.`;
    }

    if (message.includes("(HTTP 429)")) {
      return RATE_LIMIT_REMEDIATION;
    }

    if (message.includes("(HTTP 400)")) {
      return "Falcon rejected the alerts query. The connector sends a fixed FQL filter on created_timestamp; copy the report and contact OneUptime support with it.";
    }

    if (message.includes("could not be completed")) {
      return `Falcon did not answer in time. Check outbound connectivity from the OneUptime API and worker processes to ${new URL(getCrowdStrikeFalconBaseUrl(cloud) || "https://api.crowdstrike.com").host}.`;
    }

    return "Read the message prefix to see which step failed, then follow the troubleshooting section of the CrowdStrike Falcon integration docs.";
  }

  /*
   * Read every alert created in the window, oldest first, page by page,
   * within the request and event budgets and Falcon's 10,000 offset
   * ceiling. When any of the three stops the read, the result is
   * complete=false with resumeAfter set to the created_timestamp of the
   * last alert read: the ids query sorts created_timestamp ascending, so
   * every alert created before that point has been read, and the poller
   * moves its cursor there and starts the next query again at offset 0.
   * Without it the poller re-read the same first 9,000 alerts forever
   * (review finding connector-bound-hit-permanent-stall).
   */
  public async fetchEvents(
    settings: SecurityConnectorSettings,
    window: ConnectorFetchWindow,
    options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult> {
    const parsed: ParsedSettings =
      CrowdStrikeFalconConnector.parseSettings(settings);
    const client: CrowdStrikeFalconClient = this.buildClient(
      parsed,
      options.requestTimeoutInMs,
    );

    const filter: string = CrowdStrikeFalconClient.buildCreatedTimestampFilter(
      window.startTime,
      window.endTime,
    );
    const warnings: Array<string> = [];
    // Alerts in the order the ids query listed them, i.e. creation order.
    const rawAlerts: Array<JSONObject> = [];
    /*
     * Offset paging runs over live data: an alert created between two
     * pages shifts every later page by one, so an id can repeat. Repeats
     * are dropped here rather than counted twice downstream.
     */
    const seenCompositeIds: Set<string> = new Set<string>();
    let boundWarning: string | null = null;
    let offset: number = 0;

    for (;;) {
      /*
       * Every page costs an ids query and an entity fetch (plus the token
       * request on the first page). The budget is checked before the pair
       * so a page is never half-read.
       */
      const requestsNeeded: number = client.getRequestCount() === 0 ? 3 : 2;

      if (client.getRequestCount() + requestsNeeded > options.maxRequests) {
        boundWarning = `Stopped after ${client.getRequestCount()} requests before reading the whole window.`;
        break;
      }

      /*
       * Falcon's query index cannot page past 10,000 results. The window's
       * remaining alerts are still reachable: the resume point lets the
       * next poll query them from offset 0.
       */
      if (
        offset + CROWDSTRIKE_ALERTS_PAGE_SIZE >
        CROWDSTRIKE_ALERTS_OFFSET_CEILING
      ) {
        boundWarning = `Falcon's alerts query cannot page past ${CROWDSTRIKE_ALERTS_OFFSET_CEILING} results and this window holds more.`;
        break;
      }

      const page: CrowdStrikeAlertIdsPage = await client.queryAlertIds({
        filter,
        limit: CROWDSTRIKE_ALERTS_PAGE_SIZE,
        offset,
      });

      const newIds: Array<string> = page.compositeIds.filter(
        (compositeId: string): boolean => {
          if (seenCompositeIds.has(compositeId)) {
            return false;
          }

          seenCompositeIds.add(compositeId);
          return true;
        },
      );

      const remaining: number = options.maxEvents - rawAlerts.length;
      let idsToFetch: Array<string> = newIds;
      let eventBoundHit: boolean = false;

      if (newIds.length > remaining) {
        idsToFetch = newIds.slice(0, Math.max(0, remaining));
        eventBoundHit = true;
      }

      if (idsToFetch.length > 0) {
        rawAlerts.push(
          ...CrowdStrikeFalconConnector.inQueryOrder(
            idsToFetch,
            await client.getAlerts(idsToFetch),
          ),
        );
      }

      if (eventBoundHit) {
        boundWarning = `Stopped after collecting ${options.maxEvents} alerts; the window holds more.`;
        break;
      }

      offset += page.compositeIds.length;

      /*
       * The window is fully read when Falcon says so (offset reached the
       * reported total) or when it returned a short page. Both are
       * checked because `total` is occasionally absent.
       */
      const reachedTotal: boolean = page.total !== null && offset >= page.total;
      const shortPage: boolean =
        page.compositeIds.length < CROWDSTRIKE_ALERTS_PAGE_SIZE;

      if (reachedTotal || shortPage || page.compositeIds.length === 0) {
        break;
      }

      if (rawAlerts.length >= options.maxEvents) {
        boundWarning = `Stopped after collecting ${options.maxEvents} alerts; the window holds more.`;
        break;
      }
    }

    const events: Array<NormalizedSecurityEvent> = [];
    const samples: Array<SecurityConnectorSample> = [];
    const failedAlerts: Set<JSONObject> = new Set<JSONObject>();
    let rejectedCount: number = 0;
    let failedCount: number = 0;

    for (const raw of rawAlerts) {
      if (!CrowdStrikeFalconNormalizer.isRecognized(raw)) {
        rejectedCount++;
        continue;
      }

      try {
        const normalized: NormalizedSecurityEvent =
          CrowdStrikeFalconNormalizer.normalize(raw);
        events.push(normalized);

        if (samples.length < options.sampleLimit) {
          samples.push({
            id: normalized.eventUid,
            title: normalized.message,
            severity: normalized.severityName,
            createdTime: readString(raw, "created_timestamp") || undefined,
            eventTime:
              readString(raw, "timestamp") || normalized.time.toISOString(),
          });
        }
      } catch {
        failedCount++;
        failedAlerts.add(raw);
      }
    }

    let resumeAfter: Date | undefined = undefined;

    if (boundWarning !== null) {
      const resume: ResumePoint = CrowdStrikeFalconConnector.findResumePoint(
        rawAlerts,
        failedAlerts,
        window,
      );
      resumeAfter = resume.resumeAfter;

      warnings.push(
        resumeAfter
          ? `${boundWarning} Alerts are read oldest first; every alert created before ${resumeAfter.toISOString()} was read.`
          : boundWarning,
      );

      if (resume.outOfOrder) {
        warnings.push(
          "Falcon returned alerts out of created_timestamp order, so this run cannot name a point to resume from.",
        );
      }
    }

    return {
      events,
      fetchedCount: rawAlerts.length,
      rejectedCount,
      failedCount,
      complete: boundWarning === null,
      requestCount: client.getRequestCount(),
      warnings,
      samples,
      resumeAfter,
    };
  }

  /*
   * The entity fetch does not promise to answer in the order the ids were
   * asked for, and the resume point depends on reading alerts in the ids
   * query's created_timestamp order. Entities are put back in that order;
   * one whose composite_id was not asked for keeps its response position
   * after the rest, where it can only make the resume point more cautious.
   */
  private static inQueryOrder(
    compositeIds: Array<string>,
    entities: Array<JSONObject>,
  ): Array<JSONObject> {
    const positions: Map<string, number> = new Map<string, number>();

    compositeIds.forEach((compositeId: string, index: number): void => {
      if (!positions.has(compositeId)) {
        positions.set(compositeId, index);
      }
    });

    return entities
      .map(
        (
          entity: JSONObject,
          index: number,
        ): { entity: JSONObject; index: number; rank: number } => {
          const rank: number | undefined = positions.get(
            readString(entity, "composite_id"),
          );

          return {
            entity,
            index,
            rank: rank === undefined ? compositeIds.length : rank,
          };
        },
      )
      .sort(
        (
          left: { index: number; rank: number },
          right: { index: number; rank: number },
        ): number => {
          return left.rank - right.rank || left.index - right.index;
        },
      )
      .map((item: { entity: JSONObject }): JSONObject => {
        return item.entity;
      });
  }

  /*
   * Where the next poll can resume after a bounded read: the
   * created_timestamp of the last alert read. Two cases name no point, so
   * the poller narrows its window instead of skipping anything:
   *  - an alert created earlier than one read before it means Falcon did
   *    not honour sort=created_timestamp.asc, and "everything before the
   *    last one was read" no longer holds;
   *  - an alert that failed normalization is never resumed past, since the
   *    poller retries normalization failures; the point stops at that
   *    alert's creation time (or is absent when it has none).
   * Creation times outside the window are ignored: the FQL filter excludes
   * them, so such a value cannot say anything about this window.
   */
  private static findResumePoint(
    rawAlerts: Array<JSONObject>,
    failedAlerts: Set<JSONObject>,
    window: ConnectorFetchWindow,
  ): ResumePoint {
    const createdAtInWindow: (raw: JSONObject) => Date | null = (
      raw: JSONObject,
    ): Date | null => {
      const createdAt: Date | null = parseEventTime(
        readValue(raw, "created_timestamp"),
      );

      if (
        createdAt &&
        createdAt.getTime() >= window.startTime.getTime() &&
        createdAt.getTime() < window.endTime.getTime()
      ) {
        return createdAt;
      }

      return null;
    };

    let latest: Date | null = null;

    for (const raw of rawAlerts) {
      const createdAt: Date | null = createdAtInWindow(raw);

      if (createdAt && latest && createdAt.getTime() < latest.getTime()) {
        return { resumeAfter: undefined, outOfOrder: true };
      }

      if (createdAt) {
        latest = createdAt;
      }
    }

    for (const raw of rawAlerts) {
      if (failedAlerts.has(raw)) {
        return {
          resumeAfter: createdAtInWindow(raw) || undefined,
          outOfOrder: false,
        };
      }
    }

    return { resumeAfter: latest || undefined, outOfOrder: false };
  }
}
