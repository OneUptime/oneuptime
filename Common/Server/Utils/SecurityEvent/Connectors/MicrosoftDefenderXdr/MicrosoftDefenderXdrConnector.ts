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
import MicrosoftDefenderXdrNormalizer from "../../../../../Utils/SecurityEvent/Connectors/MicrosoftDefenderXdrNormalizer";
import { readString } from "../../../../../Utils/SecurityEvent/NormalizerHelpers";
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
import MicrosoftDefenderXdrClient, {
  MICROSOFT_DEFENDER_XDR_CLOUDS,
  MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE,
  MicrosoftDefenderXdrAlertCount,
  MicrosoftDefenderXdrAlertsPage,
  MicrosoftDefenderXdrCloud,
} from "./MicrosoftDefenderXdrClient";

/*
 * Microsoft Defender XDR connector: alerts_v2 through Microsoft Graph,
 * listed by the time Defender CREATED the alert (createdDateTime), never
 * by the time of the underlying activity. An alert whose
 * firstActivityDateTime is hours old still lands in the poll window that
 * covers its creation, which is the whole point of the framework (see
 * Connectors/Types.ts).
 *
 * Settings come from the catalog's keys: config.tenantId, config.clientId,
 * config.cloud and secrets.clientSecret.
 */

interface ParsedSettings {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  cloud: MicrosoftDefenderXdrCloud;
}

const GUID_REGEX: RegExp =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/*
 * Entra accepts the tenant as its GUID or as a verified domain name
 * (contoso.onmicrosoft.com). Anything else is a typo that would otherwise
 * surface as a 404 from the token endpoint an hour later.
 */
const TENANT_REGEX: RegExp = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

export default class MicrosoftDefenderXdrConnector
  implements SecurityEventConnector
{
  public provider: SecurityEventConnectorProvider =
    SecurityEventConnectorProvider.MicrosoftDefenderXdr;

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
        SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      );

    if (!definition) {
      throw new BadDataException(
        "Microsoft Defender XDR is missing from the connector catalog.",
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

  private static parseSettings(
    settings: SecurityConnectorSettings,
  ): ParsedSettings {
    const tenantId: string = readSettingString(settings.config, "tenantId");
    const clientId: string = readSettingString(settings.config, "clientId");
    const cloud: string =
      readSettingString(settings.config, "cloud") || "public";
    const clientSecret: string = readSettingString(
      settings.secrets,
      "clientSecret",
    );

    if (!tenantId || !TENANT_REGEX.test(tenantId)) {
      throw new BadDataException(
        `${this.fieldTitle("tenantId")} must be the tenant GUID or its verified domain name (for example contoso.onmicrosoft.com).`,
      );
    }

    if (!clientId || !GUID_REGEX.test(clientId)) {
      throw new BadDataException(
        `${this.fieldTitle("clientId")} must be the app registration's GUID.`,
      );
    }

    if (!MicrosoftDefenderXdrClient.isCloud(cloud)) {
      throw new BadDataException(
        `${this.fieldTitle("cloud")} must be one of: ${MICROSOFT_DEFENDER_XDR_CLOUDS.join(", ")}.`,
      );
    }

    if (!clientSecret) {
      throw new BadDataException(
        `${this.fieldTitle("clientSecret")} is required.`,
      );
    }

    return { tenantId, clientId, clientSecret, cloud };
  }

  public validateSettings(settings: SecurityConnectorSettings): void {
    if (settings.provider !== this.provider) {
      throw new BadDataException(
        `Settings are for provider "${String(settings.provider)}", not ${MicrosoftDefenderXdrConnector.getDefinition().title}.`,
      );
    }

    MicrosoftDefenderXdrConnector.parseSettings(settings);
  }

  private buildClient(
    parsed: ParsedSettings,
    requestTimeoutInMs: number,
  ): MicrosoftDefenderXdrClient {
    return new MicrosoftDefenderXdrClient({
      tenantId: parsed.tenantId,
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      cloud: parsed.cloud,
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
      parsed = MicrosoftDefenderXdrConnector.parseSettings(settings);
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Microsoft Entra",
          status: "fail",
          startedAtMs,
          message: redactLogString(ConnectorErrorMessage.toMessage(error)),
          remediation:
            "Correct the highlighted setting and test again. Nothing was contacted.",
        }),
      );
      checks.push(
        MicrosoftDefenderXdrConnector.skipped(
          "read-permission",
          "Read alerts from Microsoft Graph",
          "Skipped because the configuration is not usable.",
        ),
      );
      checks.push(
        MicrosoftDefenderXdrConnector.skipped(
          "detections-available",
          "Alerts available to import",
          "Skipped because the configuration is not usable.",
        ),
      );
      return checks;
    }

    const client: MicrosoftDefenderXdrClient = this.buildClient(
      parsed,
      options.requestTimeoutInMs,
    );

    try {
      await client.getAccessToken();
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Microsoft Entra",
          status: "pass",
          startedAtMs,
          message: `Microsoft Entra issued an access token for Microsoft Graph in the ${parsed.cloud === "usgov" ? "Azure Government" : "Azure public"} cloud.`,
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Microsoft Entra",
          status: "fail",
          startedAtMs,
          message: redactLogString(
            ConnectorErrorMessage.toMessage(error, { truncate: false }),
          ),
          remediation:
            "Check the Directory (tenant) ID, Application (client) ID and Cloud against the app registration's Overview page, and that the Client secret has not expired (Certificates & secrets). Rotate the secret with Update credentials if needed.",
        }),
      );
      checks.push(
        MicrosoftDefenderXdrConnector.skipped(
          "read-permission",
          "Read alerts from Microsoft Graph",
          "Skipped because authentication failed.",
        ),
      );
      checks.push(
        MicrosoftDefenderXdrConnector.skipped(
          "detections-available",
          "Alerts available to import",
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
      const page: MicrosoftDefenderXdrAlertsPage = await client.listAlerts({
        startTime: dayAgo,
        endTime: now,
        pageSize: 1,
      });
      checks.push(
        makeCheck({
          key: "read-permission",
          name: "Read alerts from Microsoft Graph",
          status: "pass",
          startedAtMs,
          message: `Microsoft Graph accepted a read of security alerts (${page.alerts.length} record${page.alerts.length === 1 ? "" : "s"} returned for a one-record probe over the last 24 hours).`,
        }),
      );
    } catch (error) {
      const message: string = redactLogString(
        ConnectorErrorMessage.toMessage(error, { truncate: false }),
      );
      checks.push(
        makeCheck({
          key: "read-permission",
          name: "Read alerts from Microsoft Graph",
          status: "fail",
          startedAtMs,
          message,
          remediation: MicrosoftDefenderXdrConnector.readRemediation(message),
        }),
      );
      checks.push(
        MicrosoftDefenderXdrConnector.skipped(
          "detections-available",
          "Alerts available to import",
          "Skipped because the read check failed.",
        ),
      );
      return checks;
    }

    startedAtMs = Date.now();

    try {
      const last24h: MicrosoftDefenderXdrAlertCount = await client.countAlerts({
        startTime: dayAgo,
        endTime: now,
      });
      const last7d: MicrosoftDefenderXdrAlertCount = await client.countAlerts({
        startTime: weekAgo,
        endTime: now,
      });

      const label24h: string =
        MicrosoftDefenderXdrConnector.countLabel(last24h);
      const label7d: string = MicrosoftDefenderXdrConnector.countLabel(last7d);
      const nothing: boolean =
        last24h.count === 0 &&
        !last24h.hasMore &&
        last7d.count === 0 &&
        !last7d.hasMore;

      checks.push(
        makeCheck({
          key: "detections-available",
          name: "Alerts available to import",
          status: nothing ? "warn" : "pass",
          startedAtMs,
          message: nothing
            ? "No alerts were created in the last 7 days. Polling will import new alerts as Microsoft Defender XDR creates them."
            : `${label24h} alert${label24h === "1" ? "" : "s"} created in the last 24 hours and ${label7d} in the last 7 days.`,
          ...(nothing
            ? {
                remediation:
                  "Confirm that alerts exist for this tenant in the Microsoft Defender portal (Incidents & alerts). A tenant with no onboarded Defender workloads produces none.",
              }
            : {}),
          details: {
            createdLast24h: label24h,
            createdLast7d: label7d,
            hasMoreLast24h: last24h.hasMore,
            hasMoreLast7d: last7d.hasMore,
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
          name: "Alerts available to import",
          status: "fail",
          startedAtMs,
          message,
          remediation: MicrosoftDefenderXdrConnector.readRemediation(message),
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

  private static countLabel(count: MicrosoftDefenderXdrAlertCount): string {
    return count.hasMore
      ? `${MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE}+`
      : String(count.count);
  }

  /*
   * Remediation keyed off the HTTP status the client put in the message,
   * so the check tells the reader what to change instead of quoting Graph.
   */
  private static readRemediation(message: string): string {
    if (message.includes("(HTTP 403)")) {
      return "In the app registration, add the Microsoft Graph application permission SecurityAlert.Read.All and select Grant admin consent. The tenant also needs Microsoft Defender XDR licensing. Consent changes take a few minutes to apply.";
    }

    if (message.includes("(HTTP 401)")) {
      return "The token was minted but Microsoft Graph refused it. Check that the Cloud setting matches the tenant's cloud and that the app registration is enabled.";
    }

    if (message.includes("(HTTP 429)")) {
      return "Microsoft Graph is throttling this app. Wait for the Retry-After period and test again; scheduled polls retry automatically.";
    }

    if (message.includes("did not complete")) {
      return "Microsoft Graph did not answer in time. Check outbound connectivity from the OneUptime API and worker processes to graph.microsoft.com (or graph.microsoft.us).";
    }

    return "Read the message prefix to see which step failed, then follow the troubleshooting section of the Microsoft Defender XDR integration docs.";
  }

  /*
   * Read every alert created in the window, page by page, within the
   * request and event budgets. A budget hit returns complete=false with a
   * warning so the poller holds its cursor and the next poll re-reads the
   * same window; nothing is silently dropped.
   */
  public async fetchEvents(
    settings: SecurityConnectorSettings,
    window: ConnectorFetchWindow,
    options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult> {
    const parsed: ParsedSettings =
      MicrosoftDefenderXdrConnector.parseSettings(settings);
    const client: MicrosoftDefenderXdrClient = this.buildClient(
      parsed,
      options.requestTimeoutInMs,
    );

    const warnings: Array<string> = [];
    const rawAlerts: Array<JSONObject> = [];
    let complete: boolean = true;

    const maxRequests: number = Math.max(1, Math.floor(options.maxRequests));
    const maxEvents: number = Math.max(1, Math.floor(options.maxEvents));

    /*
     * The request budget counts alert pages, as the Sentinel connector
     * does: a token request is a fixed cost (one, or two after a 401
     * retry) that would otherwise silently shrink the page budget. The
     * reported requestCount still counts everything that left the process.
     */
    let pageRequests: number = 0;
    let nextLink: string | null = null;

    for (;;) {
      if (pageRequests >= maxRequests) {
        complete = false;
        warnings.push(
          `Stopped after ${pageRequests} alerts requests (the per-run request limit). The window is not fully read; the poll cursor is held so the next poll continues from the same window.`,
        );
        break;
      }

      const page: MicrosoftDefenderXdrAlertsPage = nextLink
        ? await client.listAlertsByNextLink(nextLink)
        : await client.listAlerts({
            startTime: window.startTime,
            endTime: window.endTime,
            pageSize: MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE,
          });
      pageRequests++;

      const remaining: number = maxEvents - rawAlerts.length;
      const eventBoundHit: boolean = page.alerts.length > remaining;

      rawAlerts.push(...page.alerts.slice(0, Math.max(0, remaining)));

      if (eventBoundHit || (page.nextLink && rawAlerts.length >= maxEvents)) {
        complete = false;
        warnings.push(
          `Stopped after ${rawAlerts.length} alerts (the per-run record limit). The window is not fully read; the poll cursor is held so the next poll continues from the same window.`,
        );
        break;
      }

      if (!page.nextLink) {
        break;
      }

      nextLink = page.nextLink;
    }

    const events: Array<NormalizedSecurityEvent> = [];
    const samples: Array<SecurityConnectorSample> = [];
    let rejectedCount: number = 0;
    let failedCount: number = 0;

    for (const raw of rawAlerts) {
      if (!MicrosoftDefenderXdrNormalizer.isRecognized(raw)) {
        rejectedCount++;
        continue;
      }

      try {
        const normalized: NormalizedSecurityEvent =
          MicrosoftDefenderXdrNormalizer.normalize(raw);
        events.push(normalized);

        if (samples.length < options.sampleLimit) {
          samples.push({
            id: normalized.eventUid,
            title: normalized.message,
            severity: normalized.severityName,
            createdTime: readString(raw, "createdDateTime") || undefined,
            eventTime: normalized.time.toISOString(),
          });
        }
      } catch {
        failedCount++;
      }
    }

    return {
      events,
      fetchedCount: rawAlerts.length,
      rejectedCount,
      failedCount,
      complete,
      requestCount: client.getRequestCount(),
      warnings,
      samples,
    };
  }
}
