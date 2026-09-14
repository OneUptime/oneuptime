import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import GoogleSecOpsConnectionRun from "../../../../Models/DatabaseModels/GoogleSecOpsConnectionRun";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  ConnectorPlatformStatus,
  SecurityConnectorCheck,
  SecurityConnectorSample,
  SecurityConnectorTestReport,
  summarizeCheckStatuses,
} from "../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import GoogleSecOpsAlertNormalizer from "../../../../Utils/SecurityEvent/GoogleSecOpsAlertNormalizer";
import {
  parseEventTime,
  readValue,
} from "../../../../Utils/SecurityEvent/NormalizerHelpers";
import GoogleSecOpsConnectionRunService from "../../../Services/GoogleSecOpsConnectionRunService";
import logger from "../../Logger";
import { redactLogString } from "../../LogRedaction";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import ConnectorPlatformHealth from "../Connectors/ConnectorPlatformHealth";
import { makeCheck } from "../Connectors/Types";
import SecurityEventDedupe from "../SecurityEventDedupe";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  SearchDetectionsResult,
} from "./GoogleSecOpsClient";

export const GOOGLE_SECOPS_PROVIDER: string = "google-secops";
/*
 * Shorter than the poller's 60 seconds: the person is waiting on a modal,
 * and eight probes at a minute each would outlive the HTTP request.
 */
export const GOOGLE_SECOPS_CONNECTION_TEST_TIMEOUT_IN_MS: number = 20 * 1000;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const WEEK_IN_MS: number = 7 * DAY_IN_MS;
const AVAILABILITY_PAGE_SIZE: number = 1000;
// Same rule as the poller: these statuses mean "no curated rule access", not "broken".
const CURATED_OPTIONAL_STATUSES: Array<number> = [400, 403, 404];
/*
 * Names the form control as it ships: a "Data to import" group where Alerts
 * is fixed and a Detections checkbox widens the import. The earlier
 * "switch the scope to Alerts and detections" named a control that no
 * longer exists.
 */
const SCOPE_MISMATCH_REMEDIATION: string =
  "Your rules create detections but alerting is not enabled on them. Edit the connection and select Detections under Data to import, or enable alerting on the rules in Google SecOps.";
const NO_DETECTIONS_MESSAGE: string =
  "No detections were created in the last 7 days. Polling will import new detections as Google creates them.";

type ScopeLabel = "alerts-only" | "alerts-and-detections";

/*
 * What one scope has to offer, bounded: the alerts view reports its
 * matched count without returning records (maxReturnedAlerts=1), and the
 * created-time search reads one page of up to 1000, reported as "1000+"
 * when a further page exists.
 */
interface ScopeAvailability {
  scope: ScopeLabel;
  alertsViewLast24h: number;
  alertsViewLast7d: number;
  ruleDetectionsCreatedLast24h: string;
  ruleDetectionsCreatedLast7d: string;
  hasMoreLast7d: boolean;
  totalLast7d: number;
}

interface ReadProbeOutcome {
  ok: boolean;
  record: JSONObject | null;
}

/*
 * The synchronous "Test connection" for a Google SecOps connection.
 *
 * Runs in the API process, deliberately NOT through the Worker queue: the
 * most common reason a connection never ingests is that no worker consumes
 * the queue, and a test that itself needs a worker hangs in exactly that
 * situation. Running here lets the report SAY "no worker is consuming the
 * queue" instead of spinning in "queued".
 *
 * The provider checks mirror the poller's three read passes, then count
 * what is available to import with AND without Detections selected under
 * Data to import, because "connected but nothing ingests" is very often
 * "the rules create detections, none of them alert, and only Alerts are
 * imported". Platform and schedule checks are shared with every other
 * connector. The tester never writes to ClickHouse and never moves the
 * cursor.
 */
export default class GoogleSecOpsConnectionTester {
  public static async test(data: {
    connection: GoogleSecOpsConnection;
    clientOverride?: GoogleSecOpsClient | undefined;
    platformOverride?: ConnectorPlatformStatus | undefined;
    now?: Date | undefined;
    /*
     * False when the connection carries unsaved edits (the API overlays
     * the edit form's values onto the stored row): a run-history row would
     * then describe settings the connection does not have. A connection
     * without an id is never recorded, whatever this says.
     */
    recordRun?: boolean | undefined;
  }): Promise<SecurityConnectorTestReport> {
    const startedMs: number = Date.now();
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const connection: GoogleSecOpsConnection = data.connection;
    const alertingOnly: boolean =
      connection.includeNonAlertingDetections !== true;
    const checks: Array<SecurityConnectorCheck> = [];
    const samples: Array<SecurityConnectorSample> = [];
    let counts: JSONObject | undefined = undefined;

    const client: GoogleSecOpsClient | null = this.configurationCheck(
      connection,
      data.clientOverride,
      checks,
    );

    if (client) {
      const authenticated: boolean = await this.authenticationCheck(
        client,
        checks,
      );

      if (authenticated) {
        const ruleRead: ReadProbeOutcome = await this.searchReadCheck(
          client,
          checks,
          { curated: false, now, alertingOnly },
        );
        await this.searchReadCheck(client, checks, {
          curated: true,
          now,
          alertingOnly,
        });
        const alertsRead: ReadProbeOutcome = await this.alertsViewReadCheck(
          client,
          checks,
          { now, alertingOnly },
        );

        for (const record of [ruleRead.record, alertsRead.record]) {
          const sample: SecurityConnectorSample | null = this.toSample(record);
          if (sample) {
            samples.push(sample);
          }
        }

        if (ruleRead.ok && alertsRead.ok) {
          counts = await this.availabilityCheck(client, checks, {
            now,
            alertingOnly,
          });
        } else {
          checks.push(
            makeCheck({
              key: "detections-available",
              name: "Detections available to import",
              status: "skip",
              startedAtMs: Date.now(),
              message:
                "Skipped because a read check failed; fix that first and test again.",
            }),
          );
        }
      } else {
        checks.push(
          makeCheck({
            key: "detections-available",
            name: "Detections available to import",
            status: "skip",
            startedAtMs: Date.now(),
            message: "Skipped because authentication failed.",
          }),
        );
      }
    } else {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Google",
          status: "skip",
          startedAtMs: Date.now(),
          message: "Skipped because the configuration check failed.",
        }),
      );
    }

    /*
     * The storage probe runs the same duplicate lookup the poller runs before
     * every insert (clusterAllReplicas over the security event table), so a
     * cluster-name or replica problem that would fail every poll fails the
     * test here, with a name, instead of surfacing as lastError an hour later.
     */
    const platform: ConnectorPlatformStatus =
      data.platformOverride ||
      (await ConnectorPlatformHealth.getPlatformStatus({
        storageProbeOverride: async (): Promise<boolean> => {
          await SecurityEventDedupe.findExistingEventUids({
            projectId:
              connection.projectId ||
              new ObjectID(ObjectID.generate().toString()),
            vendorName: "Google",
            productName: "Google SecOps",
            ids: ["oneuptime-connection-test-probe"],
          });

          return true;
        },
      }));
    checks.push(...ConnectorPlatformHealth.toPlatformChecks(platform));

    if (connection.id) {
      checks.push(await this.scheduleCheck(connection, now));
    }

    const status: SecurityConnectorTestReport["status"] =
      summarizeCheckStatuses(checks);
    const completedMs: number = Date.now();

    const report: SecurityConnectorTestReport = {
      provider: GOOGLE_SECOPS_PROVIDER,
      status,
      startedAt: new Date(startedMs).toISOString(),
      completedAt: new Date(completedMs).toISOString(),
      durationMs: Math.max(0, completedMs - startedMs),
      checks,
      summary: this.summarize(status, checks),
      platform,
      ...(counts ? { counts } : {}),
      ...(samples.length > 0 ? { samples } : {}),
    };

    if (connection.id && connection.projectId && data.recordRun !== false) {
      await this.recordRun(connection, report);
    }

    return report;
  }

  private static configurationCheck(
    connection: GoogleSecOpsConnection,
    clientOverride: GoogleSecOpsClient | undefined,
    checks: Array<SecurityConnectorCheck>,
  ): GoogleSecOpsClient | null {
    const startedAtMs: number = Date.now();

    try {
      const client: GoogleSecOpsClient =
        clientOverride ||
        new GoogleSecOpsClient({
          region: connection.region || "",
          instanceResourceName: connection.instanceResourceName || "",
          serviceAccountJson: connection.serviceAccountJson || "",
          requestTimeoutInMs: GOOGLE_SECOPS_CONNECTION_TEST_TIMEOUT_IN_MS,
        });
      checks.push(
        makeCheck({
          key: "configuration",
          name: "Configuration",
          status: "pass",
          startedAtMs,
          message:
            "The region, instance resource name and service account key are well formed.",
        }),
      );
      return client;
    } catch (error) {
      checks.push(
        makeCheck({
          key: "configuration",
          name: "Configuration",
          status: "fail",
          startedAtMs,
          message: redactLogString(ConnectorErrorMessage.toMessage(error)),
          remediation:
            "Correct the highlighted setting and test again. Nothing was contacted.",
        }),
      );
      return null;
    }
  }

  private static async authenticationCheck(
    client: GoogleSecOpsClient,
    checks: Array<SecurityConnectorCheck>,
  ): Promise<boolean> {
    const startedAtMs: number = Date.now();

    try {
      await client.testAuthentication();
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Google",
          status: "pass",
          startedAtMs,
          message: "Google accepted the service account credentials.",
        }),
      );
      return true;
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Google",
          status: "fail",
          startedAtMs,
          message: redactLogString(
            ConnectorErrorMessage.toMessage(error, { truncate: false }),
          ),
          remediation:
            "The token exchange happens at Google's OAuth endpoint before Chronicle is contacted. Re-download the service account key, confirm it belongs to the project the instance is bound to, and check this host's clock.",
        }),
      );
      return false;
    }
  }

  /*
   * One created-time page of size 1 over the last 24 hours: proves the
   * legacySearchDetections (or curated) permission without reading data.
   */
  private static async searchReadCheck(
    client: GoogleSecOpsClient,
    checks: Array<SecurityConnectorCheck>,
    options: { curated: boolean; now: Date; alertingOnly: boolean },
  ): Promise<ReadProbeOutcome> {
    const startedAtMs: number = Date.now();
    const key: string = options.curated
      ? "curated-detections-read"
      : "rule-detections-read";
    const name: string = options.curated
      ? "Read curated rule detections"
      : "Read rule detections";

    try {
      const page: SearchDetectionsResult = await client.searchDetections({
        startTime: new Date(options.now.getTime() - DAY_IN_MS),
        endTime: options.now,
        listBasis: "CREATED_TIME",
        alertingOnly: options.alertingOnly,
        pageSize: 1,
        curated: options.curated,
      });
      checks.push(
        makeCheck({
          key,
          name,
          status: "pass",
          startedAtMs,
          message: `${options.curated ? "Curated rule" : "Rule"} detections can be read by created time (${page.detections.length} returned for a one-record probe over the last 24 hours).`,
          details: { returned: page.detections.length },
        }),
      );
      return { ok: true, record: page.detections[0] || null };
    } catch (error) {
      const status: number | null = GoogleSecOpsClient.readHttpStatus(error);
      const message: string = redactLogString(
        ConnectorErrorMessage.toMessage(error, { truncate: false }),
      );

      if (
        options.curated &&
        status !== null &&
        CURATED_OPTIONAL_STATUSES.includes(status)
      ) {
        checks.push(
          makeCheck({
            key,
            name,
            status: "warn",
            startedAtMs,
            message: `Curated rule detections are not readable on this tenant (HTTP ${status}). Polling continues with rule detections and the alerts view.`,
            remediation:
              "Curated (Google-authored) rule detections need that entitlement on the tenant. Nothing to fix unless you expect curated detections to be imported.",
            details: { httpStatus: status, error: message },
          }),
        );
        return { ok: true, record: null };
      }

      checks.push(
        makeCheck({
          key,
          name,
          status: "fail",
          startedAtMs,
          message,
          remediation:
            "Grant roles/chronicle.viewer on the instance to the service account (it includes chronicle.legacies.legacySearchDetections and legacySearchCuratedDetections), and confirm the instance resource name and region.",
        }),
      );
      return { ok: false, record: null };
    }
  }

  /*
   * One alerts-view read with maxReturnedAlerts=1 over the last 24 hours:
   * proves the legacyFetchAlertsView permission the third poll pass needs.
   */
  private static async alertsViewReadCheck(
    client: GoogleSecOpsClient,
    checks: Array<SecurityConnectorCheck>,
    options: { now: Date; alertingOnly: boolean },
  ): Promise<ReadProbeOutcome> {
    const startedAtMs: number = Date.now();

    try {
      const fetched: FetchAlertsResult = await client.fetchDetectionAlerts({
        startTime: new Date(options.now.getTime() - DAY_IN_MS),
        endTime: options.now,
        maxAlerts: 1,
        includeNonAlertingDetections: !options.alertingOnly,
      });
      checks.push(
        makeCheck({
          key: "alerts-view-read",
          name: "Read the alerts view",
          status: fetched.complete ? "pass" : "warn",
          startedAtMs,
          message: fetched.complete
            ? `The alerts view can be read by detection time (${fetched.baselineAlertsCount} matched in the last 24 hours).`
            : "The alerts view answered but the stream ended without confirming it was complete. Reads work; a complete read is not confirmed.",
          details: {
            baselineAlertsCount: fetched.baselineAlertsCount,
            complete: fetched.complete,
          },
        }),
      );
      return { ok: true, record: fetched.alerts[0] || null };
    } catch (error) {
      checks.push(
        makeCheck({
          key: "alerts-view-read",
          name: "Read the alerts view",
          status: "fail",
          startedAtMs,
          message: redactLogString(
            ConnectorErrorMessage.toMessage(error, { truncate: false }),
          ),
          remediation:
            "Grant roles/chronicle.viewer on the instance to the service account (it includes chronicle.legacies.legacyFetchAlertsView), and confirm the instance resource name and region.",
        }),
      );
      return { ok: false, record: null };
    }
  }

  /*
   * Counts under the saved Data to import selection AND the other one, over
   * 24 hours and 7 days. The mismatch this exists to catch: rules create
   * detections, none of them alert, Detections is not selected, and every
   * poll is honestly empty.
   */
  private static async availabilityCheck(
    client: GoogleSecOpsClient,
    checks: Array<SecurityConnectorCheck>,
    options: { now: Date; alertingOnly: boolean },
  ): Promise<JSONObject | undefined> {
    const startedAtMs: number = Date.now();

    try {
      const saved: ScopeAvailability = await this.probeScope(
        client,
        options.now,
        options.alertingOnly,
      );
      const other: ScopeAvailability = await this.probeScope(
        client,
        options.now,
        !options.alertingOnly,
      );
      const counts: JSONObject = {
        scope: saved.scope,
        alertsViewLast24h: saved.alertsViewLast24h,
        alertsViewLast7d: saved.alertsViewLast7d,
        ruleDetectionsCreatedLast24h: saved.ruleDetectionsCreatedLast24h,
        ruleDetectionsCreatedLast7d: saved.ruleDetectionsCreatedLast7d,
        hasMoreLast7d: saved.hasMoreLast7d,
        otherScope: {
          scope: other.scope,
          alertsViewLast24h: other.alertsViewLast24h,
          alertsViewLast7d: other.alertsViewLast7d,
          ruleDetectionsCreatedLast24h: other.ruleDetectionsCreatedLast24h,
          ruleDetectionsCreatedLast7d: other.ruleDetectionsCreatedLast7d,
          hasMoreLast7d: other.hasMoreLast7d,
        },
      };

      if (saved.totalLast7d > 0) {
        checks.push(
          makeCheck({
            key: "detections-available",
            name: "Detections available to import",
            status: "pass",
            startedAtMs,
            message: `With the saved Data to import (${this.describeScope(saved.scope)}): last 24 hours ${saved.ruleDetectionsCreatedLast24h} rule detections created and ${saved.alertsViewLast24h} alerts in the alerts view; last 7 days ${saved.ruleDetectionsCreatedLast7d} and ${saved.alertsViewLast7d}.`,
            details: counts,
          }),
        );
      } else if (other.totalLast7d > 0) {
        checks.push(
          makeCheck({
            key: "detections-available",
            name: "Detections available to import",
            status: "warn",
            startedAtMs,
            message: `Nothing is available with the saved Data to import (${this.describeScope(saved.scope)}) in the last 7 days, but ${other.ruleDetectionsCreatedLast7d} rule detections and ${other.alertsViewLast7d} alerts-view records exist with ${this.describeScope(other.scope)}.`,
            remediation:
              saved.scope === "alerts-only"
                ? SCOPE_MISMATCH_REMEDIATION
                : "Reading Alerts only returned records that reading Alerts and Detections did not; re-run the test, and if it persists inspect the tenant's alerting configuration.",
            details: counts,
          }),
        );
      } else {
        checks.push(
          makeCheck({
            key: "detections-available",
            name: "Detections available to import",
            status: "warn",
            startedAtMs,
            message: NO_DETECTIONS_MESSAGE,
            remediation:
              "Check that your rules are enabled and run on a schedule in Google SecOps. A quiet tenant is not a connector fault.",
            details: counts,
          }),
        );
      }

      return counts;
    } catch (error) {
      checks.push(
        makeCheck({
          key: "detections-available",
          name: "Detections available to import",
          status: "warn",
          startedAtMs,
          message: `Could not count the detections available to import: ${redactLogString(ConnectorErrorMessage.toMessage(error, { truncate: false }))}`,
          remediation:
            "Reads work, so polling can proceed; re-run the test to retry the counts.",
        }),
      );
      return undefined;
    }
  }

  private static async probeScope(
    client: GoogleSecOpsClient,
    now: Date,
    alertingOnly: boolean,
  ): Promise<ScopeAvailability> {
    const dayAgo: Date = new Date(now.getTime() - DAY_IN_MS);
    const weekAgo: Date = new Date(now.getTime() - WEEK_IN_MS);

    const alertsLast24h: FetchAlertsResult = await client.fetchDetectionAlerts({
      startTime: dayAgo,
      endTime: now,
      maxAlerts: 1,
      includeNonAlertingDetections: !alertingOnly,
    });
    const alertsLast7d: FetchAlertsResult = await client.fetchDetectionAlerts({
      startTime: weekAgo,
      endTime: now,
      maxAlerts: 1,
      includeNonAlertingDetections: !alertingOnly,
    });
    const rulesLast24h: SearchDetectionsResult = await client.searchDetections({
      startTime: dayAgo,
      endTime: now,
      listBasis: "CREATED_TIME",
      alertingOnly,
      pageSize: AVAILABILITY_PAGE_SIZE,
    });
    const rulesLast7d: SearchDetectionsResult = await client.searchDetections({
      startTime: weekAgo,
      endTime: now,
      listBasis: "CREATED_TIME",
      alertingOnly,
      pageSize: AVAILABILITY_PAGE_SIZE,
    });

    const alertsViewLast24h: number = this.matchedCount(alertsLast24h);
    const alertsViewLast7d: number = this.matchedCount(alertsLast7d);
    const hasMoreLast7d: boolean =
      rulesLast7d.nextPageToken !== null || rulesLast7d.truncated;

    return {
      scope: alertingOnly ? "alerts-only" : "alerts-and-detections",
      alertsViewLast24h,
      alertsViewLast7d,
      ruleDetectionsCreatedLast24h: this.boundedCount(rulesLast24h),
      ruleDetectionsCreatedLast7d: this.boundedCount(rulesLast7d),
      hasMoreLast7d,
      totalLast7d: alertsViewLast7d + rulesLast7d.detections.length,
    };
  }

  /*
   * The alerts view reports how many alerts matched even when only one is
   * returned; a tenant answering without the count still counts the
   * returned record.
   */
  private static matchedCount(fetched: FetchAlertsResult): number {
    return Math.max(
      fetched.baselineAlertsCount,
      fetched.filteredAlertsCount,
      fetched.alerts.length,
    );
  }

  private static boundedCount(page: SearchDetectionsResult): string {
    if (
      page.nextPageToken !== null ||
      page.truncated ||
      page.detections.length >= AVAILABILITY_PAGE_SIZE
    ) {
      return `${AVAILABILITY_PAGE_SIZE}+`;
    }

    return String(page.detections.length);
  }

  /*
   * Read as "with <this>" in the messages above, so it names what the Data
   * to import group has checked rather than a scope label the form no
   * longer shows.
   */
  private static describeScope(scope: ScopeLabel): string {
    return scope === "alerts-only"
      ? "Alerts only"
      : "Alerts and Detections selected";
  }

  private static toSample(
    record: JSONObject | null,
  ): SecurityConnectorSample | null {
    if (!record) {
      return null;
    }

    try {
      if (!GoogleSecOpsAlertNormalizer.isGoogleSecOpsAlert(record)) {
        return null;
      }

      const event: NormalizedSecurityEvent =
        GoogleSecOpsAlertNormalizer.normalize(record);
      const createdTime: Date | null = parseEventTime(
        readValue(record, "createdTime") ?? readValue(record, "created_time"),
      );
      const detectionTime: Date | null = parseEventTime(
        readValue(record, "detectionTime") ??
          readValue(record, "detection_time"),
      );

      return {
        id: redactLogString(event.eventUid),
        title: redactLogString(event.message),
        severity: event.severityName,
        ...(createdTime ? { createdTime: createdTime.toISOString() } : {}),
        ...(detectionTime ? { eventTime: detectionTime.toISOString() } : {}),
      };
    } catch {
      return null;
    }
  }

  private static async scheduleCheck(
    connection: GoogleSecOpsConnection,
    now: Date,
  ): Promise<SecurityConnectorCheck> {
    let pendingRunCreatedAt: Date | undefined = undefined;

    try {
      const pending: GoogleSecOpsConnectionRun | null =
        await GoogleSecOpsConnectionRunService.findOneBy({
          query: {
            googleSecOpsConnectionId: connection.id!,
            status: new Includes(["queued", "running"]),
          },
          select: { _id: true, createdAt: true },
          sort: { createdAt: SortOrder.Ascending },
          props: { isRoot: true },
        });
      pendingRunCreatedAt = pending?.createdAt;
    } catch (error) {
      logger.error(
        "GoogleSecOpsConnectionTester: could not read pending runs.",
      );
      logger.error(error);
    }

    return ConnectorPlatformHealth.toScheduleCheck(
      {
        isEnabled: connection.isEnabled !== false,
        pollIntervalInMinutes: connection.pollIntervalInMinutes || 5,
        createdAt: connection.createdAt,
        lastPolledAt: connection.lastPolledAt,
        lastSuccessfulPollAt: connection.lastSuccessfulPollAt,
        lastEventIngestedAt: connection.lastEventIngestedAt,
        lastError: connection.lastError,
        pendingRunCreatedAt,
      },
      now,
    );
  }

  private static summarize(
    status: SecurityConnectorTestReport["status"],
    checks: Array<SecurityConnectorCheck>,
  ): string {
    const failed: Array<SecurityConnectorCheck> = checks.filter(
      (check: SecurityConnectorCheck): boolean => {
        return check.status === "fail";
      },
    );
    const warned: Array<SecurityConnectorCheck> = checks.filter(
      (check: SecurityConnectorCheck): boolean => {
        return check.status === "warn";
      },
    );

    if (status === "fail") {
      return `${failed.length} check${failed.length === 1 ? "" : "s"} failed: ${failed
        .map((check: SecurityConnectorCheck): string => {
          return check.name;
        })
        .join(", ")}. Follow the remediation under each failed check.`;
    }

    if (status === "warn") {
      return `Google SecOps is reachable and readable. ${warned.length} check${warned.length === 1 ? " needs" : "s need"} attention: ${warned
        .map((check: SecurityConnectorCheck): string => {
          return check.name;
        })
        .join(", ")}.`;
    }

    return "Google SecOps is reachable, credentials are accepted, detections can be read by created time and by detection time, there is something to import, and OneUptime's workers and scheduler are running.";
  }

  private static async recordRun(
    connection: GoogleSecOpsConnection,
    report: SecurityConnectorTestReport,
  ): Promise<void> {
    try {
      const run: GoogleSecOpsConnectionRun = new GoogleSecOpsConnectionRun();
      run.projectId = connection.projectId as ObjectID;
      run.googleSecOpsConnectionId = connection.id as ObjectID;
      run.type = "test";
      run.status = report.status === "fail" ? "failed" : "success";
      run.startedAt = new Date(report.startedAt);
      run.completedAt = new Date(report.completedAt);
      run.request = { type: "test", synchronous: true };
      run.result = report as unknown as JSONObject;
      run.error = report.status === "fail" ? report.summary : "";

      await GoogleSecOpsConnectionRunService.create({
        data: run,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `GoogleSecOpsConnectionTester: could not record the test run for ${connection.id?.toString()}.`,
      );
      logger.error(error);
    }
  }
}
