import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import AwsSecurityHubNormalizer from "../../../../../Utils/SecurityEvent/Connectors/AwsSecurityHubNormalizer";
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
import AwsSecurityHubClient, {
  AWS_SECURITY_HUB_DEFAULT_PAGE_SIZE,
  AwsSecurityHubFindingCount,
  AwsSecurityHubFindingsPage,
} from "./AwsSecurityHubClient";

/*
 * AWS Security Hub connector: imports findings from one Region of one
 * account (ideally the delegated administrator's home Region, where
 * cross-Region aggregation collects every member account's findings) as
 * OCSF Detection Findings, or Compliance Findings for control checks.
 *
 * Polling is by the finding's CreatedAt (see Connectors/Types.ts for why
 * creation time is the only safe cursor basis). A GuardDuty finding is
 * created when GuardDuty has evaluated enough activity to raise it, and a
 * control finding when Security Hub first evaluates the resource — both
 * can be long after FirstObservedAt, so a cursor over observation time
 * would skip them.
 *
 * Security Hub has no notion of "alerting" findings, so the connection's
 * alertingOnly flag is not consulted (the catalog marks the toggle as
 * unsupported).
 */

const PROVIDER_TITLE: string = "AWS Security Hub";
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

/*
 * Wording of a request that never got an HTTP status: the client's own
 * deadline, or the production transport's "Could not reach data source"
 * wrapper around a DNS, connection, TLS or timeout failure.
 */
const CONNECTIVITY_FAILURE_REGEX: RegExp =
  /timed out|timeout|could not reach data source|econnrefused|econnreset|enotfound|etimedout|eai_again/i;

interface ResolvedSettings {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

export default class AwsSecurityHubConnector implements SecurityEventConnector {
  public provider: SecurityEventConnectorProvider =
    SecurityEventConnectorProvider.AwsSecurityHub;

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

    return {
      region: readSettingString(config, "region").toLowerCase(),
      accessKeyId: readSettingString(config, "accessKeyId"),
      secretAccessKey: readSettingString(secrets, "secretAccessKey"),
      sessionToken: readSettingString(secrets, "sessionToken"),
    };
  }

  public validateSettings(settings: SecurityConnectorSettings): void {
    if (settings.provider !== this.provider) {
      throw new BadDataException(
        `Settings are for provider "${String(settings.provider)}", not ${PROVIDER_TITLE}.`,
      );
    }

    const resolved: ResolvedSettings =
      AwsSecurityHubConnector.resolveSettings(settings);

    AwsSecurityHubClient.validateRegion(resolved.region);
    AwsSecurityHubClient.validateAccessKeyId(resolved.accessKeyId);

    if (!resolved.secretAccessKey) {
      throw new BadDataException("Secret access key is required.");
    }

    /*
     * Temporary credentials (ASIA... ids) only work with their session
     * token; a missing token fails every request with
     * UnrecognizedClientException, which reads like a wrong key. Catch it
     * here where the message can name the field.
     */
    if (resolved.accessKeyId.startsWith("ASIA") && !resolved.sessionToken) {
      throw new BadDataException(
        "Session token is required for a temporary access key (an Access key ID starting with ASIA).",
      );
    }
  }

  private createClient(
    settings: SecurityConnectorSettings,
    requestTimeoutInMs: number,
  ): AwsSecurityHubClient {
    const resolved: ResolvedSettings =
      AwsSecurityHubConnector.resolveSettings(settings);

    return new AwsSecurityHubClient({
      region: resolved.region,
      accessKeyId: resolved.accessKeyId,
      secretAccessKey: resolved.secretAccessKey,
      sessionToken: resolved.sessionToken || undefined,
      transport: this.transport,
      requestTimeoutInMs,
    });
  }

  /*
   * ---------------------------------------------------------------------
   * Test connection
   * ---------------------------------------------------------------------
   */

  /*
   * AWS has no separate token step: a single signed GetFindings for one
   * finding over the last day answers both "are the credentials right"
   * and "may this identity read findings", because AWS verifies the
   * signature before Security Hub evaluates the IAM policy. A signature
   * rejection fails authentication; an AccessDenied after a verified
   * signature passes authentication and fails the read permission.
   */
  public async testConnection(
    settings: SecurityConnectorSettings,
    options: ConnectorTestOptions,
  ): Promise<Array<SecurityConnectorCheck>> {
    const checks: Array<SecurityConnectorCheck> = [];
    const now: Date = new Date();
    const dayAgo: Date = new Date(now.getTime() - DAY_IN_MS);
    const weekAgo: Date = new Date(now.getTime() - 7 * DAY_IN_MS);
    const region: string = readSettingString(settings.config || {}, "region");

    let client: AwsSecurityHubClient;

    try {
      this.validateSettings(settings);
      client = this.createClient(settings, options.requestTimeoutInMs);
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with AWS",
          status: "fail",
          startedAtMs: Date.now(),
          message: redactLogString(ConnectorErrorMessage.toMessage(error)),
          remediation:
            "Correct the highlighted setting and test again. Nothing was contacted.",
        }),
      );
      checks.push(
        AwsSecurityHubConnector.skipped(
          "read-permission",
          "Read findings",
          "Skipped because the configuration is not usable.",
        ),
      );
      checks.push(
        AwsSecurityHubConnector.skipped(
          "detections-available",
          "Findings available to import",
          "Skipped because the configuration is not usable.",
        ),
      );
      return checks;
    }

    // 1 + 2. One signed GetFindings for a single finding created in the last day.
    const probeStartedMs: number = Date.now();

    try {
      const page: AwsSecurityHubFindingsPage = await client.getFindings({
        startTime: dayAgo,
        endTime: now,
        maxResults: 1,
      });
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with AWS",
          status: "pass",
          startedAtMs: probeStartedMs,
          message: `Security Hub in ${region} accepted the Signature Version 4 request signed with the access key.`,
        }),
      );
      checks.push(
        makeCheck({
          key: "read-permission",
          name: "Read findings",
          status: "pass",
          startedAtMs: probeStartedMs,
          message: page.findings.length
            ? "Security Hub answered a GetFindings query; the IAM identity is allowed securityhub:GetFindings."
            : "Security Hub answered a GetFindings query (no finding was created in the last 24 hours); the IAM identity is allowed securityhub:GetFindings.",
          details: {
            region,
            sampleFindingCount: page.findings.length,
          },
        }),
      );
    } catch (error) {
      const message: string = redactLogString(
        ConnectorErrorMessage.toMessage(error),
      );

      if (AwsSecurityHubConnector.isPermissionFailure(message)) {
        checks.push(
          makeCheck({
            key: "authentication",
            name: "Authenticate with AWS",
            status: "pass",
            startedAtMs: probeStartedMs,
            message: `Security Hub in ${region} verified the request signature, so the access key and secret are valid.`,
          }),
        );
        checks.push(
          makeCheck({
            key: "read-permission",
            name: "Read findings",
            status: "fail",
            startedAtMs: probeStartedMs,
            message,
            remediation: AwsSecurityHubConnector.readRemediation(message),
          }),
        );
        checks.push(
          AwsSecurityHubConnector.skipped(
            "detections-available",
            "Findings available to import",
            "Skipped because findings could not be read.",
          ),
        );
        return checks;
      }

      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with AWS",
          status: "fail",
          startedAtMs: probeStartedMs,
          message,
          remediation:
            AwsSecurityHubConnector.authenticationRemediation(message),
        }),
      );
      checks.push(
        AwsSecurityHubConnector.skipped(
          "read-permission",
          "Read findings",
          "Skipped because authentication failed.",
        ),
      );
      checks.push(
        AwsSecurityHubConnector.skipped(
          "detections-available",
          "Findings available to import",
          "Skipped because authentication failed.",
        ),
      );
      return checks;
    }

    // 3. Availability: bounded counts over the last day and the last week.
    const countStartedMs: number = Date.now();

    try {
      const last24h: AwsSecurityHubFindingCount =
        await client.countFindingsCreated({
          startTime: dayAgo,
          endTime: now,
          maxResults: AWS_SECURITY_HUB_DEFAULT_PAGE_SIZE,
        });
      const last7d: AwsSecurityHubFindingCount =
        await client.countFindingsCreated({
          startTime: weekAgo,
          endTime: now,
          maxResults: AWS_SECURITY_HUB_DEFAULT_PAGE_SIZE,
        });

      const label24h: string = AwsSecurityHubConnector.countLabel(last24h);
      const label7d: string = AwsSecurityHubConnector.countLabel(last7d);
      const nothing: boolean =
        last24h.count === 0 &&
        last7d.count === 0 &&
        !last24h.hasMore &&
        !last7d.hasMore;

      checks.push(
        makeCheck({
          key: "detections-available",
          name: "Findings available to import",
          status: nothing ? "warn" : "pass",
          startedAtMs: countStartedMs,
          message: nothing
            ? "No findings were created in the last 7 days. Polling will import new findings as Security Hub creates them."
            : `${label24h} finding${last24h.count === 1 && !last24h.hasMore ? "" : "s"} created in the last 24 hours and ${label7d} in the last 7 days.`,
          ...(nothing
            ? {
                remediation:
                  "Confirm that Security Hub has integrations (GuardDuty, Inspector, Macie, IAM Access Analyzer, partner products) or security standards enabled in this Region, and that this account is the administrator or home Region if you expect other accounts' and Regions' findings here. A quiet account is not a connector fault.",
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
          name: "Findings available to import",
          status: "fail",
          startedAtMs: countStartedMs,
          message,
          remediation: AwsSecurityHubConnector.readRemediation(message),
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

  private static countLabel(count: AwsSecurityHubFindingCount): string {
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

  /*
   * A 403 whose body names AccessDeniedException or InvalidAccessException
   * came from Security Hub's authorization, after AWS verified the
   * signature. Every signature error is also a 403 (or 400) but carries
   * its own code, which the client's hint text names.
   */
  private static isPermissionFailure(message: string): boolean {
    if (AwsSecurityHubConnector.statusFromMessage(message) !== 403) {
      return false;
    }

    return (
      message.includes("AccessDeniedException") ||
      message.includes("InvalidAccessException") ||
      message.includes("securityhub:GetFindings")
    );
  }

  /*
   * A request that never produced an HTTP status: the client's own
   * deadline ("timed out after N seconds"), or the production transport's
   * "Could not reach data source: ..." wrapper around a DNS failure, a
   * refused connection, a TLS problem, its own timeout or the egress
   * guard. None of these say anything about the credentials, so the
   * remediation must point at the network, not at IAM.
   */
  private static isConnectivityFailure(message: string): boolean {
    if (AwsSecurityHubConnector.statusFromMessage(message) !== null) {
      return false;
    }

    return CONNECTIVITY_FAILURE_REGEX.test(message);
  }

  private static connectivityRemediation(): string {
    return "Security Hub could not be reached or did not answer in time. Check outbound HTTPS access (DNS, firewall, proxy) from the OneUptime app and worker processes to securityhub.<region>.amazonaws.com and test again.";
  }

  private static authenticationRemediation(message: string): string {
    const status: number | null =
      AwsSecurityHubConnector.statusFromMessage(message);

    if (AwsSecurityHubConnector.isConnectivityFailure(message)) {
      return AwsSecurityHubConnector.connectivityRemediation();
    }

    if (message.includes("ExpiredToken")) {
      return "The temporary credentials have expired. Issue new credentials with STS and use Update credentials on the connection, or switch to a long-lived access key.";
    }

    if (
      message.includes("RequestExpired") ||
      message.includes("RequestTimeTooSkewed") ||
      message.includes("Signature expired") ||
      message.includes("Signature not yet current")
    ) {
      return "AWS rejected the request time. The OneUptime server clock is more than five minutes off; fix NTP on the app and worker hosts and test again.";
    }

    if (status === 404) {
      return "No Security Hub endpoint answered at this Region. Compare the Region with the AWS console's Region selector (for example us-east-1) and test again.";
    }

    if (status === 429) {
      return "Security Hub is throttling GetFindings for this account. Wait a minute and test again.";
    }

    if (status !== null && status >= 500) {
      return "Security Hub reported a server-side problem. Test again in a few minutes; polling retries on its own.";
    }

    return "Open IAM > Users > the connector user > Security credentials and compare the Access key ID with the connection, then create a new access key and paste its Secret access key. For temporary credentials also paste the Session token, and use the Region where Security Hub is enabled.";
  }

  private static readRemediation(message: string): string {
    const status: number | null =
      AwsSecurityHubConnector.statusFromMessage(message);

    if (AwsSecurityHubConnector.isConnectivityFailure(message)) {
      return AwsSecurityHubConnector.connectivityRemediation();
    }

    if (message.includes("InvalidAccessException")) {
      return "Enable Security Hub in this Region for this account (Security Hub > Get started), or point the connection at the delegated administrator account's home Region where findings are aggregated.";
    }

    if (status === 403) {
      return "Allow securityhub:GetFindings for the IAM identity: attach the AWSSecurityHubReadOnlyAccess managed policy, or an inline policy with Action securityhub:GetFindings on Resource *, to the user or role whose access key the connection uses. To see member accounts' findings, use a key from the Security Hub delegated administrator account in its home (aggregation) Region.";
    }

    if (status === 429) {
      return "Security Hub is throttling GetFindings for this account. Wait a minute and test again.";
    }

    if (status !== null && status >= 500) {
      return "Security Hub reported a server-side problem. Test again in a few minutes; polling retries on its own.";
    }

    return "Read the message: it names the step that failed and the response AWS returned. Correct the setting it points at and test again.";
  }

  /*
   * ---------------------------------------------------------------------
   * Fetch
   * ---------------------------------------------------------------------
   */

  public async fetchEvents(
    settings: SecurityConnectorSettings,
    window: ConnectorFetchWindow,
    options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult> {
    /*
     * The same validation the form and the tester run, so a settings row
     * for another provider or a temporary key saved without its session
     * token is refused here with the field named, before a request that
     * would only fail with an opaque UnrecognizedClientException.
     */
    this.validateSettings(settings);

    const client: AwsSecurityHubClient = this.createClient(
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

    let nextToken: string | null = null;

    while (true) {
      if (result.requestCount >= maxRequests) {
        result.complete = false;
        result.warnings.push(
          `Stopped after ${result.requestCount} findings requests (the per-run request limit). The window is not fully read; the poll cursor is held so the next poll continues from the same window.`,
        );
        break;
      }

      const page: AwsSecurityHubFindingsPage = await client.getFindings({
        startTime: window.startTime,
        endTime: window.endTime,
        maxResults: AWS_SECURITY_HUB_DEFAULT_PAGE_SIZE,
        nextToken,
      });
      result.requestCount++;

      let findings: Array<JSONObject> = page.findings;
      const remaining: number = maxEvents - result.fetchedCount;
      let eventBoundHit: boolean = false;

      if (findings.length > remaining) {
        findings = findings.slice(0, Math.max(0, remaining));
        eventBoundHit = true;
      }

      for (const raw of findings) {
        result.fetchedCount++;

        if (!AwsSecurityHubNormalizer.isRecognized(raw)) {
          result.rejectedCount++;
          continue;
        }

        try {
          const normalized: NormalizedSecurityEvent =
            AwsSecurityHubNormalizer.normalize(raw);
          result.events.push(normalized);

          if (result.samples.length < sampleLimit) {
            result.samples.push(AwsSecurityHubConnector.toSample(normalized));
          }
        } catch {
          result.failedCount++;
        }
      }

      if (
        eventBoundHit ||
        (page.nextToken && result.fetchedCount >= maxEvents)
      ) {
        result.complete = false;
        result.warnings.push(
          `Stopped after ${result.fetchedCount} findings (the per-run record limit). The window is not fully read; the poll cursor is held so the next poll continues from the same window.`,
        );
        break;
      }

      if (!page.nextToken) {
        break;
      }

      nextToken = page.nextToken;
    }

    return result;
  }

  private static toSample(
    event: NormalizedSecurityEvent,
  ): SecurityConnectorSample {
    const createdTime: string = String(event.attributes["CreatedAt"] || "");
    const observedTime: string = String(
      event.attributes["FirstObservedAt"] || "",
    );

    return {
      id: event.eventUid,
      title: event.message,
      severity: event.severityName,
      ...(createdTime ? { createdTime } : {}),
      /*
       * The sample's eventTime is the finding's own first-observed time
       * when the product reported one, so the diagnostics view can show
       * how far behind the activity a finding was created.
       */
      eventTime: observedTime || event.time.toISOString(),
    };
  }
}
