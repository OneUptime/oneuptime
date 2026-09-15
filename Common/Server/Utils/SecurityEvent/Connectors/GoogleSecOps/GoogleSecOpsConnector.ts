import OneUptimeDate from "../../../../../Types/Date";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SecurityConnectorCheck,
  SecurityConnectorCheckStatus,
  SecurityConnectorSample,
} from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import GoogleSecOpsAlertNormalizer from "../../../../../Utils/SecurityEvent/GoogleSecOpsAlertNormalizer";
import {
  contentHashEventUid,
  parseEventTime,
  readString,
  readValue,
} from "../../../../../Utils/SecurityEvent/NormalizerHelpers";
import { redactLogString } from "../../../LogRedaction";
import ConnectorErrorMessage from "../../ConnectorErrorMessage";
import {
  ConnectorFetchBudget,
  ConnectorFetchOptions,
  ConnectorFetchResult,
  ConnectorFetchWindow,
  ConnectorTestOptions,
  ConnectorTestResult,
  SecurityConnectorSettings,
  SecurityEventConnector,
  attachConnectorChecks,
  makeCheck,
  readSettingString,
} from "../Types";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  FetchLike,
  GoogleSecOpsListBasis,
  SearchDetectionsResult,
} from "./GoogleSecOpsClient";

/*
 * Google SecOps (Chronicle) connector: imports rule detections and alerts
 * as OCSF Detection Findings.
 *
 * One window is read in three passes and unioned by Collection.id:
 *   1. rule detections by CREATED time (legacySearchDetections),
 *   2. curated rule detections by created time (legacySearchCuratedDetections),
 *   3. the alerts view by DETECTION time (legacyFetchAlertsView).
 * The alerts view alone filters on detection time, and a rule that runs
 * hourly creates detections whose detection time is already behind a
 * forward-only cursor, so it can never be the primary read (see
 * Connectors/Types.ts for why creation time is the cursor basis).
 *
 * Settings come from the catalog's keys: config.region,
 * config.instanceResourceName and secrets.serviceAccountJson, the pasted
 * service-account key as TEXT. The transport is GoogleSecOpsClient's own
 * injectable FetchLike rather than DataSourceHttpFetch: that fetch throws
 * on every status >= 300 (which breaks the client's 401 re-mint and cuts
 * the google.rpc details its operator hints read) and caps responses at
 * 20 MB, which a full page of detections can exceed, failing every poll
 * of that window for good. The hosts are fixed googleapis.com names
 * behind the region allowlist and the token_uri host rule.
 */

const PROVIDER_TITLE: string = "Google SecOps";

/*
 * Separate request budgets per kind of read. The created-time search
 * passes are the authoritative read of rule detections and share one page
 * budget (both bases, on a preview or backfill); the alerts view splits
 * truncated windows and gets its own, so a burst that the alerts view has
 * to split can no longer starve the searches (or the other way round).
 */
export const GOOGLE_SECOPS_SEARCH_PAGE_BUDGET: number = 20;
export const GOOGLE_SECOPS_ALERTS_VIEW_REQUEST_BUDGET: number = 16;
// The worker job times out at ten minutes; importing follows the fetch.
export const GOOGLE_SECOPS_FETCH_DURATION_MS: number = 4 * 60 * 1000;
const MAX_ALERTS_PER_REQUEST: number = 1000;
const MAX_SEARCH_PAGE_SIZE: number = 1000;
const DEFAULT_POLL_INTERVAL_IN_MINUTES: number = 5;
/*
 * A detection created within one poll interval plus this grace of its
 * detection time would still have been caught by a detection-time cursor;
 * anything later is exactly the record that basis lost.
 */
const CREATION_LAG_GRACE_IN_MINUTES: number = 1;
/*
 * The alerts view has no pagination, so a truncated window is split at its
 * midpoint until it is no longer than this and then reported as unread.
 */
const MIN_SPLIT_WINDOW_IN_MS: number = 1000;
/*
 * Curated (Google-authored) rule detections are optional: tenants without
 * that entitlement answer 403 (and some 400/404) on the curated route. Those
 * statuses degrade the pass to a warning; 401, 429, 5xx, timeouts and parse
 * failures still fail the fetch like any other pass.
 */
const CURATED_OPTIONAL_STATUSES: Array<number> = [400, 403, 404];
const CURATED_OPTIONAL_REMEDIATION: string =
  "Curated (Google-authored) rule detections need that entitlement on the tenant. Nothing to fix unless you expect curated detections to be imported.";

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const WEEK_IN_MS: number = 7 * DAY_IN_MS;
const AVAILABILITY_PAGE_SIZE: number = 1000;
/*
 * Names the form control as it ships: a "Data to import" group where Alerts
 * is fixed and a Detections checkbox widens the import.
 */
const SCOPE_MISMATCH_REMEDIATION: string =
  "Your rules create detections but alerting is not enabled on them. Edit the connection and select Detections under Data to import, or enable alerting on the rules in Google SecOps.";
const NO_DETECTIONS_MESSAGE: string =
  "No detections were created in the last 7 days. Polling will import new detections as Google creates them.";
const CONFIGURATION_REMEDIATION: string =
  "Correct the highlighted setting and test again. Nothing was contacted.";
const READ_REMEDIATION: string =
  "Grant roles/chronicle.viewer on the instance to the service account (it includes chronicle.legacies.legacySearchDetections and legacySearchCuratedDetections), and confirm the instance resource name and region.";

type ScopeLabel = "alerts-only" | "alerts-and-detections";

/*
 * What one Data to import selection has to offer, bounded: the alerts view
 * reports its matched count without returning records (maxReturnedAlerts=1),
 * and the created-time search reads one page of up to 1000, reported as
 * "1000+" when a further page exists.
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

interface ResolvedSettings {
  region: string;
  instanceResourceName: string;
  serviceAccountJson: string;
}

/*
 * Builds the client for one call. The default constructs a real
 * GoogleSecOpsClient over the connector's FetchLike; tests inject one that
 * returns a scripted client.
 */
export type GoogleSecOpsClientFactory = (data: {
  region: string;
  instanceResourceName: string;
  serviceAccountJson: string;
  requestTimeoutInMs: number;
}) => GoogleSecOpsClient;

/*
 * Why a read pass stopped before it had read everything it was asked for:
 * its own request budget, the fetch's total request or record bound, or
 * the wall clock.
 */
type PassStop = "requests" | "total" | "events" | "time" | null;

interface PassOutcome {
  // Records Google returned across every request of the pass.
  returned: number;
  requests: number;
  stoppedBy: PassStop;
  // Google itself left part of the window unread (truncation, unfinished stream).
  leftUnread: boolean;
}

// Everything one fetch accumulates across its passes.
interface FetchRun {
  startedMs: number;
  maxDurationMs: number;
  maxRequests: number;
  maxEvents: number;
  alertingOnly: boolean;
  searchRequests: number;
  alertsViewRequests: number;
  requestCount: number;
  complete: boolean;
  // A record was dropped because the record bound was reached.
  eventLimitHit: boolean;
  seen: Map<string, JSONObject>;
  warnings: Array<string>;
  checks: Array<SecurityConnectorCheck>;
}

interface CreationLag {
  measured: number;
  lateCount: number;
  maxLagMinutes: number;
}

export default class GoogleSecOpsConnector implements SecurityEventConnector {
  public provider: SecurityEventConnectorProvider =
    SecurityEventConnectorProvider.GoogleSecOps;

  /*
   * The poller's single-list defaults (20 requests, 10000 records) would
   * collapse the split budgets below into one and let the alerts view
   * starve the searches. The total is both budgets together, the record
   * bound is what those requests can return (the retired poller had no
   * record cap, so it never binds in normal operation), and the wall clock
   * leaves the ten-minute worker job room to import.
   */
  public fetchBudget: ConnectorFetchBudget = {
    maxRequests:
      GOOGLE_SECOPS_SEARCH_PAGE_BUDGET +
      GOOGLE_SECOPS_ALERTS_VIEW_REQUEST_BUDGET,
    maxEvents:
      GOOGLE_SECOPS_SEARCH_PAGE_BUDGET * MAX_SEARCH_PAGE_SIZE +
      GOOGLE_SECOPS_ALERTS_VIEW_REQUEST_BUDGET * MAX_ALERTS_PER_REQUEST,
    maxDurationMs: GOOGLE_SECOPS_FETCH_DURATION_MS,
  };

  private fetchImplementation: FetchLike | undefined;
  private clientFactory: GoogleSecOpsClientFactory | undefined;

  public constructor(
    fetchImplementation?: FetchLike | undefined,
    clientFactory?: GoogleSecOpsClientFactory | undefined,
  ) {
    this.fetchImplementation = fetchImplementation;
    this.clientFactory = clientFactory;
  }

  private static getDefinition(): SecurityEventConnectorDefinition {
    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(
        SecurityEventConnectorProvider.GoogleSecOps,
      );

    if (!definition) {
      throw new BadDataException(
        "Google SecOps is missing from the connector catalog.",
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
   * Runs one of GoogleSecOpsClient's save-time rules and makes sure its
   * rejection opens with the catalog title of the field it is about, the
   * way every connector names its fields. The client's messages already do;
   * the prefix only guards against a future message that does not.
   */
  private static checkField(key: string, validate: () => void): void {
    try {
      validate();
    } catch (error) {
      const title: string = this.fieldTitle(key);
      const message: string = ConnectorErrorMessage.toMessage(error, {
        truncate: false,
      });

      throw new BadDataException(
        message.startsWith(title) ? message : `${title}: ${message}`,
      );
    }
  }

  /*
   * The pasted key is stored as text. Anything else in that slot is a
   * storage bug, named as such rather than surfaced as "not valid JSON" for
   * a value the person never typed.
   */
  private static readServiceAccountJson(secrets: JSONObject): string {
    const value: JSONValue | undefined = secrets["serviceAccountJson"];

    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value !== "string") {
      throw new BadDataException(
        `${this.fieldTitle("serviceAccountJson")} must be the key file's JSON text.`,
      );
    }

    return value.trim();
  }

  /*
   * Every GoogleSecOpsClient constructor rule, without the network: region
   * allowlist, instance resource name shape, region matching the
   * instance's location (eu/europe are one place), and a service-account
   * key with string client_email and private_key, a readable PEM and a
   * token_uri on a Google host.
   */
  private static resolveSettings(
    settings: SecurityConnectorSettings,
  ): ResolvedSettings {
    const config: JSONObject = settings.config || {};
    const secrets: JSONObject = settings.secrets || {};
    const region: string = readSettingString(config, "region");
    const instanceResourceName: string = readSettingString(
      config,
      "instanceResourceName",
    );
    const serviceAccountJson: string = this.readServiceAccountJson(secrets);

    if (!region) {
      throw new BadDataException(`${this.fieldTitle("region")} is required.`);
    }

    this.checkField("region", (): void => {
      GoogleSecOpsClient.validateRegion(region);
    });

    if (!instanceResourceName) {
      throw new BadDataException(
        `${this.fieldTitle("instanceResourceName")} is required.`,
      );
    }

    this.checkField("instanceResourceName", (): void => {
      GoogleSecOpsClient.validateInstanceResourceName(instanceResourceName);
    });
    this.checkField("region", (): void => {
      GoogleSecOpsClient.validateRegionMatchesInstance(
        region,
        instanceResourceName,
      );
    });

    if (!serviceAccountJson) {
      throw new BadDataException(
        `${this.fieldTitle("serviceAccountJson")} is required.`,
      );
    }

    this.checkField("serviceAccountJson", (): void => {
      GoogleSecOpsClient.parseServiceAccountJson(serviceAccountJson);
    });

    return { region, instanceResourceName, serviceAccountJson };
  }

  public validateSettings(settings: SecurityConnectorSettings): void {
    if (settings.provider !== this.provider) {
      throw new BadDataException(
        `Settings are for provider "${String(settings.provider)}", not ${PROVIDER_TITLE}.`,
      );
    }

    GoogleSecOpsConnector.resolveSettings(settings);
  }

  private createClient(
    settings: SecurityConnectorSettings,
    requestTimeoutInMs: number,
  ): GoogleSecOpsClient {
    const resolved: ResolvedSettings =
      GoogleSecOpsConnector.resolveSettings(settings);

    if (this.clientFactory) {
      return this.clientFactory({ ...resolved, requestTimeoutInMs });
    }

    return new GoogleSecOpsClient({
      ...resolved,
      requestTimeoutInMs,
      fetchImplementation: this.fetchImplementation,
    });
  }

  /*
   * ---------------------------------------------------------------------
   * Test connection
   * ---------------------------------------------------------------------
   */

  /*
   * The provider checks mirror the three read passes, then count what is
   * available to import with AND without Detections selected under Data to
   * import, because "connected but nothing ingests" is very often "the
   * rules create detections, none of them alert, and only Alerts are
   * imported". Platform and schedule checks are added by the shared tester.
   * Never throws: every failure is a check.
   */
  public async testConnection(
    settings: SecurityConnectorSettings,
    options: ConnectorTestOptions,
  ): Promise<ConnectorTestResult> {
    const checks: Array<SecurityConnectorCheck> = [];
    const samples: Array<SecurityConnectorSample> = [];
    const now: Date = OneUptimeDate.getCurrentDate();
    const alertingOnly: boolean = settings.alertingOnly !== false;
    let counts: JSONObject | undefined = undefined;
    let client: GoogleSecOpsClient;

    try {
      client = this.createClient(settings, options.requestTimeoutInMs);
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Google",
          status: "fail",
          startedAtMs: Date.now(),
          message: redactLogString(ConnectorErrorMessage.toMessage(error)),
          remediation: CONFIGURATION_REMEDIATION,
        }),
      );
      checks.push(
        GoogleSecOpsConnector.skipped(
          "Skipped because the configuration is not usable.",
        ),
      );
      return { checks };
    }

    const authenticated: boolean =
      await GoogleSecOpsConnector.authenticationCheck(client, checks);

    if (!authenticated) {
      checks.push(
        GoogleSecOpsConnector.skipped("Skipped because authentication failed."),
      );
      return { checks };
    }

    const ruleRead: ReadProbeOutcome =
      await GoogleSecOpsConnector.searchReadCheck(client, checks, {
        curated: false,
        now,
        alertingOnly,
      });
    /*
     * The curated read does not gate availability: a tenant without curated
     * rules still has rule detections and alerts to count.
     */
    await GoogleSecOpsConnector.searchReadCheck(client, checks, {
      curated: true,
      now,
      alertingOnly,
    });
    const alertsRead: ReadProbeOutcome =
      await GoogleSecOpsConnector.alertsViewReadCheck(client, checks, {
        now,
        alertingOnly,
      });

    for (const record of [ruleRead.record, alertsRead.record]) {
      const sample: SecurityConnectorSample | null =
        GoogleSecOpsConnector.toTestSample(record);

      if (sample) {
        samples.push(sample);
      }
    }

    if (!ruleRead.ok || !alertsRead.ok) {
      checks.push(
        GoogleSecOpsConnector.skipped(
          "Skipped because a read check failed; fix that first and test again.",
        ),
      );
    } else if (options.skipAvailability) {
      /*
       * A queued test run only needs to know whether access works; eight
       * more probes at the worker's request deadline could outlive its job.
       */
      checks.push(
        GoogleSecOpsConnector.skipped(
          "Skipped in a queued test run: availability is only counted by the synchronous Test connection.",
        ),
      );
    } else {
      counts = await GoogleSecOpsConnector.availabilityCheck(client, checks, {
        now,
        alertingOnly,
      });
    }

    return {
      checks,
      ...(counts ? { counts } : {}),
      ...(samples.length > 0 ? { samples } : {}),
    };
  }

  private static skipped(message: string): SecurityConnectorCheck {
    return makeCheck({
      key: "detections-available",
      name: "Detections available to import",
      status: "skip",
      startedAtMs: Date.now(),
      message,
    });
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
            remediation: CURATED_OPTIONAL_REMEDIATION,
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
          remediation: READ_REMEDIATION,
        }),
      );
      return { ok: false, record: null };
    }
  }

  /*
   * One alerts-view read with maxReturnedAlerts=1 over the last 24 hours:
   * proves the legacyFetchAlertsView permission the third pass needs.
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

    const alertsViewLast7d: number = this.matchedCount(alertsLast7d);

    return {
      scope: alertingOnly ? "alerts-only" : "alerts-and-detections",
      alertsViewLast24h: this.matchedCount(alertsLast24h),
      alertsViewLast7d,
      ruleDetectionsCreatedLast24h: this.boundedCount(rulesLast24h),
      ruleDetectionsCreatedLast7d: this.boundedCount(rulesLast7d),
      hasMoreLast7d:
        rulesLast7d.nextPageToken !== null || rulesLast7d.truncated,
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
   * to import group has checked.
   */
  private static describeScope(scope: ScopeLabel): string {
    return scope === "alerts-only"
      ? "Alerts only"
      : "Alerts and Detections selected";
  }

  private static toTestSample(
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

  /*
   * ---------------------------------------------------------------------
   * Fetch
   * ---------------------------------------------------------------------
   */

  /*
   * Three passes over one window, unioned by Collection.id. A poll reads
   * the searches by created time only; a preview or backfill takes a range
   * a person picked (which is how the SecOps alerts view frames time) and
   * reads created AND detection time, so an import of "yesterday" also
   * carries detections created yesterday about older events.
   *
   * Google's searches return newest first, so a fetch a bound stopped has
   * no "everything before here was read" point: resumeAfter stays undefined
   * and the poller narrows the next window instead.
   *
   * A pass that throws (authentication, HTTP, an unreadable body, a
   * timeout) rethrows the ORIGINAL error, whose message prefix the docs
   * quote, with the checks of the passes that ran and a failed check named
   * after the failing pass attached to it.
   */
  public async fetchEvents(
    settings: SecurityConnectorSettings,
    window: ConnectorFetchWindow,
    options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult> {
    const client: GoogleSecOpsClient = this.createClient(
      settings,
      options.requestTimeoutInMs,
    );
    const isHistorical: boolean =
      options.purpose === "preview" || options.purpose === "backfill";
    const searchBases: Array<GoogleSecOpsListBasis> = isHistorical
      ? ["CREATED_TIME", "DETECTION_TIME"]
      : ["CREATED_TIME"];
    const basisLabel: string = isHistorical
      ? "created and detection time"
      : "created time";
    const alertingOnly: boolean = settings.alertingOnly !== false;
    const run: FetchRun = {
      startedMs: Date.now(),
      maxDurationMs: GoogleSecOpsConnector.readBound(
        options.maxDurationMs,
        GOOGLE_SECOPS_FETCH_DURATION_MS,
      ),
      maxRequests: GoogleSecOpsConnector.readBound(
        options.maxRequests,
        this.fetchBudget.maxRequests!,
      ),
      maxEvents: GoogleSecOpsConnector.readBound(
        options.maxEvents,
        this.fetchBudget.maxEvents!,
      ),
      alertingOnly,
      searchRequests: 0,
      alertsViewRequests: 0,
      requestCount: 0,
      complete: true,
      eventLimitHit: false,
      seen: new Map<string, JSONObject>(),
      warnings: [],
      checks: [],
    };
    const sourceCounts: {
      ruleDetections: number;
      curatedDetections: number;
      alertsView: number;
    } = { ruleDetections: 0, curatedDetections: 0, alertsView: 0 };

    let phaseKey: string = "read-rule-detections";
    let phaseName: string = `Read rule detections by ${basisLabel}`;
    let phaseStartedMs: number = Date.now();

    try {
      const rulePass: PassOutcome = await GoogleSecOpsConnector.searchPass(
        client,
        window,
        run,
        { curated: false, bases: searchBases },
      );
      sourceCounts.ruleDetections = rulePass.returned;
      GoogleSecOpsConnector.recordPass({
        run,
        key: phaseKey,
        name: phaseName,
        startedMs: phaseStartedMs,
        outcome: rulePass,
        countMessage: `${rulePass.returned} rule detections returned for the window by ${basisLabel}.`,
      });

      phaseKey = "read-curated-detections";
      phaseName = `Read curated rule detections by ${basisLabel}`;
      phaseStartedMs = Date.now();

      try {
        const curatedPass: PassOutcome = await GoogleSecOpsConnector.searchPass(
          client,
          window,
          run,
          { curated: true, bases: searchBases },
        );
        sourceCounts.curatedDetections = curatedPass.returned;
        GoogleSecOpsConnector.recordPass({
          run,
          key: phaseKey,
          name: phaseName,
          startedMs: phaseStartedMs,
          outcome: curatedPass,
          countMessage: `${curatedPass.returned} curated rule detections returned for the window by ${basisLabel}.`,
        });
      } catch (curatedError) {
        const status: number | null =
          GoogleSecOpsClient.readHttpStatus(curatedError);

        if (status === null || !CURATED_OPTIONAL_STATUSES.includes(status)) {
          throw curatedError;
        }

        run.warnings.push(
          `Curated rule detections could not be read (HTTP ${status}); this tenant may not have curated rule access. Rule detections and the alerts view were still read.`,
        );
        run.checks.push(
          makeCheck({
            key: phaseKey,
            name: phaseName,
            status: "warn",
            startedAtMs: phaseStartedMs,
            message: redactLogString(
              ConnectorErrorMessage.toMessage(curatedError),
            ),
            remediation: CURATED_OPTIONAL_REMEDIATION,
            details: { httpStatus: status },
          }),
        );
      }

      phaseKey = "read-alerts-view";
      phaseName = "Read alerts view by detection time";
      phaseStartedMs = Date.now();
      const alertsPass: PassOutcome = await GoogleSecOpsConnector.fetchWindows(
        client,
        window,
        run,
      );
      sourceCounts.alertsView = alertsPass.returned;
      GoogleSecOpsConnector.recordPass({
        run,
        key: phaseKey,
        name: phaseName,
        startedMs: phaseStartedMs,
        outcome: alertsPass,
        countMessage: `${alertsPass.returned} alerts returned by detection time.`,
        successMessage: `${alertsPass.returned} alerts returned by detection time. The configured Google SecOps instance is reachable and allows reading detections.`,
      });
    } catch (error) {
      run.checks.push(
        makeCheck({
          key: phaseKey,
          name: phaseName,
          status: "fail",
          startedAtMs: phaseStartedMs,
          message: redactLogString(
            ConnectorErrorMessage.toMessage(error, { truncate: false }),
          ),
        }),
      );
      throw attachConnectorChecks(error, [...run.checks]);
    }

    const alerts: Array<JSONObject> = Array.from(run.seen.values());
    const creationLag: CreationLag = GoogleSecOpsConnector.measureCreationLag(
      alerts,
      options.pollIntervalInMinutes,
      run.warnings,
    );

    /*
     * Google's raw objects go to the normalizer untouched: a record with no
     * id is identified by a hash of its content, so anything added here
     * would re-import it under a new identifier.
     */
    const events: Array<NormalizedSecurityEvent> = [];
    const samples: Array<SecurityConnectorSample> = [];
    const sampleLimit: number = Math.max(0, Math.floor(options.sampleLimit));
    let rejectedCount: number = 0;
    let failedCount: number = 0;

    for (const alert of alerts) {
      try {
        if (!GoogleSecOpsAlertNormalizer.isGoogleSecOpsAlert(alert)) {
          rejectedCount++;
          continue;
        }

        const event: NormalizedSecurityEvent =
          GoogleSecOpsAlertNormalizer.normalize(alert);
        events.push(event);

        if (samples.length < sampleLimit) {
          samples.push(GoogleSecOpsConnector.toSample(alert, event));
        }
      } catch {
        failedCount++;
      }
    }

    return {
      events,
      fetchedCount: run.seen.size,
      rejectedCount,
      failedCount,
      complete: run.complete,
      requestCount: run.requestCount,
      warnings: run.warnings,
      samples,
      checks: run.checks,
      details: {
        basis: isHistorical ? "detection-time" : "created-time",
        sourceCounts,
        creationLag: { ...creationLag },
        includeNonAlertingDetections: !alertingOnly,
      },
    };
  }

  // A positive finite bound, floored; anything else falls back.
  private static readBound(
    value: number | undefined,
    fallback: number,
  ): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
      return fallback;
    }

    return Math.floor(value);
  }

  /*
   * One check per read pass. A pass a budget stopped part way is a warning
   * naming the budget, never a success: a green step that did not read its
   * window hid which data went unread. A pass a budget never let start is
   * skipped, with the budget in its message and in the run's warnings.
   */
  private static recordPass(data: {
    run: FetchRun;
    key: string;
    name: string;
    startedMs: number;
    outcome: PassOutcome;
    // What the pass returned; the whole message when it read everything.
    countMessage: string;
    // Replaces countMessage when the pass read everything, if given.
    successMessage?: string | undefined;
  }): void {
    const outcome: PassOutcome = data.outcome;
    let status: SecurityConnectorCheckStatus = "pass";
    let message: string = data.successMessage || data.countMessage;

    if (outcome.stoppedBy === "time" && outcome.requests === 0) {
      status = "skip";
      message = "Not run: the poll time budget was spent.";
      this.addWarning(
        data.run,
        `${data.name} was not run: the poll time budget was spent.`,
      );
    } else if (outcome.stoppedBy) {
      const stop: string = `stopped by the ${this.budgetName(outcome.stoppedBy)} after ${outcome.requests} ${outcome.requests === 1 ? "request" : "requests"}`;

      if (outcome.requests === 0) {
        status = "skip";
        message = `Not run: ${stop}. ${this.notRunReason(outcome.stoppedBy)}`;
      } else {
        status = "warn";
        message = `${data.countMessage} The pass was ${stop}.`;
      }

      this.addWarning(data.run, `${data.name} was ${stop}.`);
    } else if (outcome.leftUnread) {
      status = "warn";
      message = `${data.countMessage} Google did not return part of the window.`;
    }

    data.run.checks.push(
      makeCheck({
        key: data.key,
        name: data.name,
        status,
        startedAtMs: data.startedMs,
        message,
      }),
    );
  }

  private static budgetName(stop: Exclude<PassStop, null>): string {
    if (stop === "time") {
      return "poll time budget";
    }

    if (stop === "total") {
      return "per-run request limit";
    }

    if (stop === "events") {
      return "per-run record limit";
    }

    return "request budget";
  }

  private static notRunReason(stop: Exclude<PassStop, null>): string {
    if (stop === "total") {
      return "The earlier passes used every request this run allows.";
    }

    if (stop === "events") {
      return "The earlier passes collected every record this run allows.";
    }

    // Only a search pass can find its own budget spent before it starts.
    return "The search passes share one page budget and it was spent before this pass started.";
  }

  /*
   * The alerts-view pass (legacyFetchAlertsView, detection time). The
   * endpoint has no pagination, so a truncated window is split in half and
   * both halves are re-read until they fit or the alerts-view budget runs
   * out.
   */
  private static async fetchWindows(
    client: GoogleSecOpsClient,
    window: ConnectorFetchWindow,
    run: FetchRun,
  ): Promise<PassOutcome> {
    const outcome: PassOutcome = {
      returned: 0,
      requests: 0,
      stoppedBy: null,
      leftUnread: false,
    };
    const pending: Array<{ startTime: Date; endTime: Date }> = [
      { startTime: window.startTime, endTime: window.endTime },
    ];
    let splits: number = 0;

    while (pending.length > 0) {
      const stop: PassStop = this.budgetStop(
        run,
        run.alertsViewRequests,
        GOOGLE_SECOPS_ALERTS_VIEW_REQUEST_BUDGET,
      );

      if (stop) {
        outcome.stoppedBy = stop;
        run.complete = false;
        break;
      }

      const current: { startTime: Date; endTime: Date } = pending.shift()!;
      run.alertsViewRequests++;
      outcome.requests++;
      run.requestCount++;

      const fetched: FetchAlertsResult = await client.fetchDetectionAlerts({
        startTime: current.startTime,
        endTime: current.endTime,
        maxAlerts: MAX_ALERTS_PER_REQUEST,
        includeNonAlertingDetections: !run.alertingOnly,
      });
      outcome.returned += fetched.alerts.length;

      if (!this.collectAll(run, fetched.alerts)) {
        outcome.stoppedBy = "events";
        break;
      }

      const truncated: boolean =
        fetched.truncatedByCount ||
        fetched.truncatedByBytes ||
        Math.max(fetched.filteredAlertsCount, fetched.baselineAlertsCount) >
          fetched.alerts.length;
      const midpoint: number = Math.floor(
        (current.startTime.getTime() + current.endTime.getTime()) / 2,
      );

      if (
        truncated &&
        current.endTime.getTime() - current.startTime.getTime() >
          MIN_SPLIT_WINDOW_IN_MS
      ) {
        splits++;
        pending.unshift(
          { startTime: current.startTime, endTime: new Date(midpoint) },
          { startTime: new Date(midpoint), endTime: current.endTime },
        );
      } else if (!fetched.complete || truncated) {
        run.complete = false;
        outcome.leftUnread = true;
        this.addWarning(
          run,
          truncated
            ? "Google still truncated a one-second window of the alerts view, so some alerts in it were not read."
            : "Google ended an alerts view response without confirming it was complete.",
        );
      }
    }

    if (splits > 0) {
      // One line rather than one per split: lastError joins every warning.
      run.warnings.push(
        `Google limited the alerts view response for ${window.startTime.toISOString()} to ${window.endTime.toISOString()}, so it was split into smaller windows ${splits} ${splits === 1 ? "time" : "times"}.`,
      );
    }

    return outcome;
  }

  /*
   * A detections-search pass (legacySearchDetections or the curated
   * variant), one basis at a time, following nextPageToken under the page
   * budget the two search passes share.
   */
  private static async searchPass(
    client: GoogleSecOpsClient,
    window: ConnectorFetchWindow,
    run: FetchRun,
    options: { curated: boolean; bases: Array<GoogleSecOpsListBasis> },
  ): Promise<PassOutcome> {
    const label: string = options.curated
      ? "curated rule detections"
      : "rule detections";
    const outcome: PassOutcome = {
      returned: 0,
      requests: 0,
      stoppedBy: null,
      leftUnread: false,
    };

    for (const listBasis of options.bases) {
      let pageToken: string | undefined = undefined;

      do {
        const stop: PassStop = this.budgetStop(
          run,
          run.searchRequests,
          GOOGLE_SECOPS_SEARCH_PAGE_BUDGET,
        );

        if (stop) {
          outcome.stoppedBy = stop;
          run.complete = false;
          return outcome;
        }

        run.searchRequests++;
        outcome.requests++;
        run.requestCount++;

        const page: SearchDetectionsResult = await client.searchDetections({
          startTime: window.startTime,
          endTime: window.endTime,
          listBasis,
          alertingOnly: run.alertingOnly,
          pageSize: MAX_SEARCH_PAGE_SIZE,
          pageToken,
          curated: options.curated,
        });
        outcome.returned += page.detections.length;

        if (!this.collectAll(run, page.detections)) {
          outcome.stoppedBy = "events";
          return outcome;
        }

        if (page.truncated) {
          /*
           * respTooLargeDetectionsTruncated: Google cut the page by byte
           * size and the rest is not reachable through a page token, so the
           * window is not fully read.
           */
          run.complete = false;
          outcome.leftUnread = true;
          this.addWarning(
            run,
            `Google truncated a page of ${label} by size for ${window.startTime.toISOString()} to ${window.endTime.toISOString()}, so part of the window was not read.`,
          );
        }

        pageToken = page.nextPageToken || undefined;
      } while (pageToken);
    }

    return outcome;
  }

  /*
   * Whether a pass may make another request: each kind of read has its own
   * request count, the fetch has a total request and record bound, and all
   * of them share the fetch's wall-clock bound so a slow endpoint cannot
   * run the worker job into its timeout.
   */
  private static budgetStop(
    run: FetchRun,
    used: number,
    limit: number,
  ): PassStop {
    if (used >= limit) {
      return "requests";
    }

    if (run.requestCount >= run.maxRequests) {
      return "total";
    }

    if (run.eventLimitHit || run.seen.size >= run.maxEvents) {
      return "events";
    }

    if (Date.now() - run.startedMs >= run.maxDurationMs) {
      return "time";
    }

    return null;
  }

  // Repeated conditions (every one-second window, every page) are said once.
  private static addWarning(run: FetchRun, warning: string): void {
    if (!run.warnings.includes(warning)) {
      run.warnings.push(warning);
    }
  }

  /*
   * Collects one response's records. False when the record bound dropped
   * at least one new record; records already collected are still refreshed,
   * since they do not grow the union.
   */
  private static collectAll(
    run: FetchRun,
    records: Array<JSONObject>,
  ): boolean {
    let kept: boolean = true;

    for (const record of records) {
      if (!this.collect(run, record)) {
        kept = false;
      }
    }

    return kept;
  }

  /*
   * Union by Collection.id across passes and across the alerts view's
   * chunks; a record with no id falls back to a content hash, and an
   * object that cannot even be inspected is kept under a positional key so
   * it is counted as rejected without hiding the valid records beside it.
   */
  private static collect(run: FetchRun, record: JSONObject): boolean {
    let key: string;

    try {
      key = readString(record, "id") || contentHashEventUid(record);
    } catch {
      key = `malformed:${run.requestCount}:${run.seen.size}`;
    }

    if (!run.seen.has(key) && run.seen.size >= run.maxEvents) {
      run.eventLimitHit = true;
      run.complete = false;
      return false;
    }

    run.seen.set(key, record);
    return true;
  }

  /*
   * createdTime minus detectionTime over what was fetched. A lag beyond one
   * poll interval is the record a detection-time cursor skips, so the
   * warning names the reason polling reads created time.
   */
  private static measureCreationLag(
    alerts: Array<JSONObject>,
    pollIntervalInMinutes: number | undefined,
    warnings: Array<string>,
  ): CreationLag {
    const intervalInMinutes: number = Math.max(
      1,
      pollIntervalInMinutes || DEFAULT_POLL_INTERVAL_IN_MINUTES,
    );
    const thresholdInMinutes: number =
      intervalInMinutes + CREATION_LAG_GRACE_IN_MINUTES;
    let measured: number = 0;
    let lateCount: number = 0;
    let maxLagMs: number = 0;

    for (const alert of alerts) {
      let detectionTime: Date | null = null;
      let createdTime: Date | null = null;

      try {
        detectionTime = parseEventTime(
          readValue(alert, "detectionTime") ??
            readValue(alert, "detection_time"),
        );
        createdTime = parseEventTime(
          readValue(alert, "createdTime") ?? readValue(alert, "created_time"),
        );
      } catch {
        continue;
      }

      if (!detectionTime || !createdTime) {
        continue;
      }

      measured++;
      const lagMs: number = createdTime.getTime() - detectionTime.getTime();

      if (lagMs > maxLagMs) {
        maxLagMs = lagMs;
      }

      if (lagMs > thresholdInMinutes * 60 * 1000) {
        lateCount++;
      }
    }

    const lag: CreationLag = {
      measured,
      lateCount,
      maxLagMinutes: Math.round(maxLagMs / 60000),
    };

    if (lateCount > 0) {
      warnings.push(
        `${lateCount} of ${measured} detections were created more than ${thresholdInMinutes} minutes after their detection time (up to ${lag.maxLagMinutes} minutes). This is why the connector polls by created time: a cursor over detection time would already have moved past them.`,
      );
    }

    return lag;
  }

  /*
   * A run sample: the rule name as the title (the finding's message when a
   * collection has no rule), the detection time as the event time, and
   * whether Google marked it alerting. Identifier and title are redacted:
   * both come from the source.
   */
  private static toSample(
    alert: JSONObject,
    event: NormalizedSecurityEvent,
  ): SecurityConnectorSample {
    const detectionTime: Date | null = parseEventTime(
      readValue(alert, "detectionTime") ?? readValue(alert, "detection_time"),
    );
    const createdTime: Date | null = parseEventTime(
      readValue(alert, "createdTime") ?? readValue(alert, "created_time"),
    );
    const detection: unknown = readValue(alert, "detection");
    const entry: JSONObject | undefined = Array.isArray(detection)
      ? (detection[0] as JSONObject)
      : (detection as JSONObject | undefined);
    const isAlert: unknown = entry
      ? entry["alertState"] ?? entry["alert_state"] ?? entry["alerting"]
      : undefined;

    return {
      id: redactLogString(event.eventUid),
      title: redactLogString(event.ruleName || event.message),
      severity: event.severityName,
      ...(createdTime ? { createdTime: createdTime.toISOString() } : {}),
      ...(detectionTime ? { eventTime: detectionTime.toISOString() } : {}),
      ...(typeof isAlert === "boolean"
        ? { isAlert }
        : isAlert === "ALERTING"
          ? { isAlert: true }
          : isAlert === "NOT_ALERTING" || isAlert === "NON_ALERTING"
            ? { isAlert: false }
            : {}),
    };
  }
}
