import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import MicrosoftSentinelNormalizer from "../../../../../Utils/SecurityEvent/Connectors/MicrosoftSentinelNormalizer";
import {
  parseEventTime,
  readValue,
} from "../../../../../Utils/SecurityEvent/NormalizerHelpers";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
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
import MicrosoftSentinelClient, {
  MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE,
  MicrosoftSentinelCloud,
  MicrosoftSentinelIncidentCount,
  MicrosoftSentinelIncidentsPage,
} from "./MicrosoftSentinelClient";

/*
 * Microsoft Sentinel connector: imports incidents from one Log Analytics
 * workspace as OCSF Incident Findings.
 *
 * Polling is by the incident's createdTimeUtc (see Connectors/Types.ts for
 * why creation time is the only safe cursor basis). Sentinel creates an
 * incident when its analytics rule fires, which for scheduled rules is
 * long after the activity the incident describes — a cursor over activity
 * time would miss most of them.
 */

const PROVIDER_TITLE: string = "Microsoft Sentinel";
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

/*
 * One incident as it was read, in the order the incidents API returned it:
 * enough to work out where the next poll can resume.
 */
interface ReadIncident {
  // properties.createdTimeUtc, or null when absent or unparseable.
  createdAt: Date | null;
  // True when the normalizer threw for this incident.
  failed: boolean;
}

interface ResumePoint {
  resumeAfter: Date | undefined;
  // True when the API returned incidents out of creation-time order.
  outOfOrder: boolean;
}

interface ResolvedSettings {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
  resourceGroup: string;
  workspaceName: string;
  cloud: MicrosoftSentinelCloud;
}

export default class MicrosoftSentinelConnector
  implements SecurityEventConnector
{
  public provider: SecurityEventConnectorProvider =
    SecurityEventConnectorProvider.MicrosoftSentinel;

  private transport: ConnectorTransport;

  public constructor(transport?: ConnectorTransport | undefined) {
    this.transport =
      transport ||
      ((request: DataSourceHttpRequest) => {
        return DataSourceHttpFetch.fetch(request);
      });
  }

  /*
   * Settings are read by the catalog's field keys so the form, the service
   * validation and this connector can never disagree on a key name.
   */
  private static resolveSettings(
    settings: SecurityConnectorSettings,
  ): ResolvedSettings {
    const config: JSONObject = settings.config || {};
    const secrets: JSONObject = settings.secrets || {};

    const cloudRaw: string =
      readSettingString(config, "cloud").toLowerCase() || "public";

    if (!MicrosoftSentinelClient.isCloud(cloudRaw)) {
      throw new BadDataException(
        `Cloud must be "public" or "usgov"; received "${cloudRaw}".`,
      );
    }

    return {
      tenantId: readSettingString(config, "tenantId"),
      clientId: readSettingString(config, "clientId"),
      clientSecret: readSettingString(secrets, "clientSecret"),
      subscriptionId: readSettingString(config, "subscriptionId"),
      resourceGroup: readSettingString(config, "resourceGroup"),
      workspaceName: readSettingString(config, "workspaceName"),
      cloud: cloudRaw,
    };
  }

  public validateSettings(settings: SecurityConnectorSettings): void {
    if (settings.provider !== this.provider) {
      throw new BadDataException(
        `Settings are for provider "${String(settings.provider)}", not ${PROVIDER_TITLE}.`,
      );
    }

    const resolved: ResolvedSettings =
      MicrosoftSentinelConnector.resolveSettings(settings);

    MicrosoftSentinelClient.validateTenantId(resolved.tenantId);
    MicrosoftSentinelClient.validateGuid(
      resolved.clientId,
      "Application (client) ID",
    );
    MicrosoftSentinelClient.validateGuid(
      resolved.subscriptionId,
      "Subscription ID",
    );
    MicrosoftSentinelClient.validateResourceGroup(resolved.resourceGroup);
    MicrosoftSentinelClient.validateWorkspaceName(resolved.workspaceName);

    if (!resolved.clientSecret) {
      throw new BadDataException("Client secret is required.");
    }
  }

  private createClient(
    settings: SecurityConnectorSettings,
    requestTimeoutInMs: number,
  ): MicrosoftSentinelClient {
    const resolved: ResolvedSettings =
      MicrosoftSentinelConnector.resolveSettings(settings);

    return new MicrosoftSentinelClient({
      ...resolved,
      transport: this.transport,
      requestTimeoutInMs,
    });
  }

  /*
   * ---------------------------------------------------------------------
   * Test connection
   * ---------------------------------------------------------------------
   */

  public async testConnection(
    settings: SecurityConnectorSettings,
    options: ConnectorTestOptions,
  ): Promise<Array<SecurityConnectorCheck>> {
    const checks: Array<SecurityConnectorCheck> = [];
    const now: Date = new Date();
    const dayAgo: Date = new Date(now.getTime() - DAY_IN_MS);
    const weekAgo: Date = new Date(now.getTime() - 7 * DAY_IN_MS);

    let client: MicrosoftSentinelClient;

    try {
      client = this.createClient(settings, options.requestTimeoutInMs);
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Microsoft Entra",
          status: "fail",
          startedAtMs: Date.now(),
          message: redactLogString(ConnectorErrorMessage.toMessage(error)),
          remediation:
            "Correct the highlighted setting and test again. Nothing was contacted.",
        }),
      );
      checks.push(
        MicrosoftSentinelConnector.skipped(
          "read-permission",
          "Read incidents",
          "Skipped because the configuration is not usable.",
        ),
      );
      checks.push(
        MicrosoftSentinelConnector.skipped(
          "detections-available",
          "Incidents available to import",
          "Skipped because the configuration is not usable.",
        ),
      );
      return checks;
    }

    // 1. Authentication: a client-credentials token for Azure Resource Manager.
    const authStartedMs: number = Date.now();

    try {
      await client.getAccessToken();
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Microsoft Entra",
          status: "pass",
          startedAtMs: authStartedMs,
          message:
            "Microsoft Entra issued an access token for Azure Resource Manager with the app registration's client secret.",
        }),
      );
    } catch (error) {
      const message: string = redactLogString(
        ConnectorErrorMessage.toMessage(error),
      );
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Microsoft Entra",
          status: "fail",
          startedAtMs: authStartedMs,
          message,
          remediation:
            MicrosoftSentinelConnector.authenticationRemediation(message),
        }),
      );
      checks.push(
        MicrosoftSentinelConnector.skipped(
          "read-permission",
          "Read incidents",
          "Skipped because authentication failed.",
        ),
      );
      checks.push(
        MicrosoftSentinelConnector.skipped(
          "detections-available",
          "Incidents available to import",
          "Skipped because authentication failed.",
        ),
      );
      return checks;
    }

    // 2. Read permission: one incident created in the last day.
    const readStartedMs: number = Date.now();

    try {
      const page: MicrosoftSentinelIncidentsPage = await client.listIncidents({
        startTime: dayAgo,
        endTime: now,
        top: 1,
      });
      checks.push(
        makeCheck({
          key: "read-permission",
          name: "Read incidents",
          status: "pass",
          startedAtMs: readStartedMs,
          message: page.incidents.length
            ? "The workspace answered an incidents query; the app registration can read incidents."
            : "The workspace answered an incidents query (no incident was created in the last 24 hours); the app registration can read incidents.",
          details: {
            workspaceName: readSettingString(
              settings.config || {},
              "workspaceName",
            ),
            sampleIncidentCount: page.incidents.length,
          },
        }),
      );
    } catch (error) {
      const message: string = redactLogString(
        ConnectorErrorMessage.toMessage(error),
      );
      checks.push(
        makeCheck({
          key: "read-permission",
          name: "Read incidents",
          status: "fail",
          startedAtMs: readStartedMs,
          message,
          remediation: MicrosoftSentinelConnector.readRemediation(message),
        }),
      );
      checks.push(
        MicrosoftSentinelConnector.skipped(
          "detections-available",
          "Incidents available to import",
          "Skipped because incidents could not be read.",
        ),
      );
      return checks;
    }

    // 3. Availability: bounded counts over the last day and the last week.
    const countStartedMs: number = Date.now();

    try {
      const last24h: MicrosoftSentinelIncidentCount =
        await client.countIncidentsCreated({
          startTime: dayAgo,
          endTime: now,
          top: MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE,
        });
      const last7d: MicrosoftSentinelIncidentCount =
        await client.countIncidentsCreated({
          startTime: weekAgo,
          endTime: now,
          top: MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE,
        });

      const label24h: string = MicrosoftSentinelConnector.countLabel(last24h);
      const label7d: string = MicrosoftSentinelConnector.countLabel(last7d);
      const nothing: boolean =
        last24h.count === 0 &&
        last7d.count === 0 &&
        !last24h.hasMore &&
        !last7d.hasMore;

      checks.push(
        makeCheck({
          key: "detections-available",
          name: "Incidents available to import",
          status: nothing ? "warn" : "pass",
          startedAtMs: countStartedMs,
          message: nothing
            ? "No incidents were created in the last 7 days. Polling will import new incidents as Microsoft Sentinel creates them."
            : `${label24h} incident${last24h.count === 1 && !last24h.hasMore ? "" : "s"} created in the last 24 hours and ${label7d} in the last 7 days.`,
          ...(nothing
            ? {
                remediation:
                  "Confirm that analytics rules are enabled on this workspace and are producing incidents (Microsoft Sentinel > Incidents). A quiet workspace is not a connector fault.",
              }
            : {}),
          details: {
            createdLast24h: last24h.count,
            hasMoreLast24h: last24h.hasMore,
            createdLast7d: last7d.count,
            hasMoreLast7d: last7d.hasMore,
          },
        }),
      );
    } catch (error) {
      const message: string = redactLogString(
        ConnectorErrorMessage.toMessage(error),
      );
      checks.push(
        makeCheck({
          key: "detections-available",
          name: "Incidents available to import",
          status: "fail",
          startedAtMs: countStartedMs,
          message,
          remediation: MicrosoftSentinelConnector.readRemediation(message),
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

  private static countLabel(count: MicrosoftSentinelIncidentCount): string {
    return count.hasMore ? `${count.count}+` : String(count.count);
  }

  /*
   * The client puts "(HTTP <status>)" in every status-bearing message, so
   * remediation can key off the status without re-parsing vendor bodies.
   */
  private static statusFromMessage(message: string): number | null {
    const match: RegExpMatchArray | null = message.match(/\(HTTP (\d{3})\)/);

    return match ? Number(match[1]) : null;
  }

  private static authenticationRemediation(message: string): string {
    const status: number | null =
      MicrosoftSentinelConnector.statusFromMessage(message);

    if (message.includes("timed out")) {
      return "Microsoft Entra did not answer in time. Check outbound HTTPS access from the OneUptime app and worker processes to login.microsoftonline.com (or login.microsoftonline.us for Azure Government) and test again.";
    }

    if (status === 429) {
      return "Microsoft Entra is throttling this app registration. Wait a minute and test again.";
    }

    if (status !== null && status >= 500) {
      return "Microsoft Entra reported a server-side problem. Test again in a few minutes; polling retries on its own.";
    }

    return "Open the app registration in Microsoft Entra admin center and compare its Directory (tenant) ID and Application (client) ID with the connection, then create a new client secret under Certificates & secrets and paste the secret VALUE (not the secret ID) into the connection. Check that Cloud matches where the tenant lives.";
  }

  private static readRemediation(message: string): string {
    const status: number | null =
      MicrosoftSentinelConnector.statusFromMessage(message);

    if (message.includes("timed out")) {
      return "Azure Resource Manager did not answer in time. Check outbound HTTPS access from the OneUptime app and worker processes to management.azure.com (or management.usgovcloudapi.net for Azure Government) and test again.";
    }

    if (status === 403) {
      return "Grant the app registration the Microsoft Sentinel Reader role on the resource group that contains the Log Analytics workspace: Azure portal > resource group > Access control (IAM) > Add role assignment > Microsoft Sentinel Reader > Members: select the app registration. Role assignments can take a few minutes to apply.";
    }

    if (status === 404) {
      return "Check Subscription ID, Resource group and Workspace name against the workspace's Overview page in the Azure portal, and confirm Microsoft Sentinel is enabled on that workspace.";
    }

    if (status === 401) {
      return "The token was accepted by Microsoft Entra but refused by Azure Resource Manager. Confirm the Cloud setting matches the cloud that hosts the workspace, then test again.";
    }

    if (status === 429) {
      return "Azure Resource Manager is throttling requests for this subscription. Wait a minute and test again.";
    }

    if (status !== null && status >= 500) {
      return "Azure Resource Manager reported a server-side problem. Test again in a few minutes; polling retries on its own.";
    }

    return "Read the message: it names the step that failed and the response Azure returned. Correct the setting it points at and test again.";
  }

  /*
   * ---------------------------------------------------------------------
   * Fetch
   * ---------------------------------------------------------------------
   */

  /*
   * Read every incident created in the window, oldest first, within the
   * request and record budgets. When a budget stops the read, the result
   * is complete=false with resumeAfter set to the creation time of the
   * last incident read: the list is sorted by createdTimeUtc ascending, so
   * everything created before that point has been read, and the poller
   * moves its cursor there instead of re-reading the same first pages
   * forever (review finding connector-bound-hit-permanent-stall).
   */
  public async fetchEvents(
    settings: SecurityConnectorSettings,
    window: ConnectorFetchWindow,
    options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult> {
    const client: MicrosoftSentinelClient = this.createClient(
      settings,
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

    const maxRequests: number = Math.max(1, Math.floor(options.maxRequests));
    const maxEvents: number = Math.max(1, Math.floor(options.maxEvents));
    const sampleLimit: number = Math.max(0, Math.floor(options.sampleLimit));

    const readIncidents: Array<ReadIncident> = [];
    let boundWarning: string | null = null;
    let nextLink: string | null = null;
    let pageIndex: number = 0;

    /*
     * The token request is not counted against maxRequests: the budget
     * bounds how much of the window one run reads, and a token is a fixed
     * cost that would otherwise silently shrink that budget by one page.
     */
    while (true) {
      if (result.requestCount >= maxRequests) {
        boundWarning = `Stopped after ${result.requestCount} incidents requests (the per-run request limit) before reading the whole window.`;
        break;
      }

      const page: MicrosoftSentinelIncidentsPage = await client.listIncidents({
        startTime: window.startTime,
        endTime: window.endTime,
        top: MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE,
        nextLink: pageIndex === 0 ? null : nextLink,
      });
      result.requestCount++;
      pageIndex++;

      let incidents: Array<JSONObject> = page.incidents;
      const remaining: number = maxEvents - result.fetchedCount;
      let eventBoundHit: boolean = false;

      if (incidents.length > remaining) {
        incidents = incidents.slice(0, Math.max(0, remaining));
        eventBoundHit = true;
      }

      for (const raw of incidents) {
        result.fetchedCount++;

        const readIncident: ReadIncident = {
          createdAt: parseEventTime(
            readValue(raw, "properties.createdTimeUtc"),
          ),
          failed: false,
        };
        readIncidents.push(readIncident);

        if (!MicrosoftSentinelNormalizer.isRecognized(raw)) {
          result.rejectedCount++;
          continue;
        }

        try {
          const normalized: NormalizedSecurityEvent =
            MicrosoftSentinelNormalizer.normalize(raw);
          result.events.push(normalized);

          if (result.samples.length < sampleLimit) {
            result.samples.push(
              MicrosoftSentinelConnector.toSample(normalized),
            );
          }
        } catch {
          result.failedCount++;
          readIncident.failed = true;
        }
      }

      if (
        eventBoundHit ||
        (page.nextLink && result.fetchedCount >= maxEvents)
      ) {
        boundWarning = `Stopped after ${result.fetchedCount} incidents (the per-run record limit) before reading the whole window.`;
        break;
      }

      if (!page.nextLink) {
        break;
      }

      nextLink = page.nextLink;
    }

    if (boundWarning === null) {
      return result;
    }

    result.complete = false;

    const resume: ResumePoint = MicrosoftSentinelConnector.findResumePoint(
      readIncidents,
      window,
    );
    result.resumeAfter = resume.resumeAfter;

    result.warnings.push(
      resume.resumeAfter
        ? `${boundWarning} Incidents are read oldest first; every incident created before ${resume.resumeAfter.toISOString()} was read.`
        : boundWarning,
    );

    if (resume.outOfOrder) {
      result.warnings.push(
        "Microsoft Sentinel returned incidents out of creation-time order, so this run cannot name a point to resume from.",
      );
    }

    return result;
  }

  /*
   * Where the next poll can resume after a bounded read: the creation time
   * of the last incident read. Two cases name no point, so the poller
   * narrows its window instead of skipping anything:
   *  - an incident created earlier than one before it means the API did
   *    not honour $orderby, and "everything before the last one was read"
   *    no longer holds;
   *  - an incident that failed normalization is never resumed past, since
   *    the poller retries normalization failures; the point stops at that
   *    incident's creation time (or is absent when it has none).
   * Creation times outside the window are ignored: the $filter excludes
   * them, so such a value cannot say anything about this window.
   */
  private static findResumePoint(
    readIncidents: Array<ReadIncident>,
    window: ConnectorFetchWindow,
  ): ResumePoint {
    const inWindow: (value: Date | null) => Date | null = (
      value: Date | null,
    ): Date | null => {
      if (
        value &&
        value.getTime() >= window.startTime.getTime() &&
        value.getTime() < window.endTime.getTime()
      ) {
        return value;
      }

      return null;
    };

    let latest: Date | null = null;

    for (const readIncident of readIncidents) {
      const createdAt: Date | null = inWindow(readIncident.createdAt);

      if (createdAt && latest && createdAt.getTime() < latest.getTime()) {
        return { resumeAfter: undefined, outOfOrder: true };
      }

      if (createdAt) {
        latest = createdAt;
      }
    }

    for (const readIncident of readIncidents) {
      if (readIncident.failed) {
        return {
          resumeAfter: inWindow(readIncident.createdAt) || undefined,
          outOfOrder: false,
        };
      }
    }

    return { resumeAfter: latest || undefined, outOfOrder: false };
  }

  private static toSample(
    event: NormalizedSecurityEvent,
  ): SecurityConnectorSample {
    const createdTime: string = String(
      event.attributes["properties.createdTimeUtc"] || "",
    );
    const activityTime: string = String(
      event.attributes["properties.firstActivityTimeUtc"] || "",
    );

    return {
      id: event.eventUid,
      title: event.message,
      severity: event.severityName,
      ...(createdTime ? { createdTime } : {}),
      /*
       * The sample's eventTime is the incident's own activity time when
       * Sentinel reported one, so the diagnostics view can show how far
       * behind the activity an incident was created.
       */
      eventTime: activityTime || event.time.toISOString(),
    };
  }
}
