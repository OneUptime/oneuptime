import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  GOOGLE_WORKSPACE_DRIVE_KEY,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  GOOGLE_DRIVE_EVENTS,
  GOOGLE_WORKSPACE_DEFAULT_APPLICATIONS,
  GoogleWorkspaceApplication,
  isGoogleWorkspaceActivity,
  readGoogleWorkspaceActivity,
} from "../../../../../Utils/SecurityEvent/Connectors/GoogleWorkspaceNormalizer";
import {
  SecurityRecordReading,
  toNormalizedSecurityEvent,
} from "../../../../../Utils/SecurityEvent/SecurityRecordReading";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import { redactLogString } from "../../../LogRedaction";
import ConnectorErrorMessage from "../../ConnectorErrorMessage";
import GoogleSecOpsClient from "../GoogleSecOps/GoogleSecOpsClient";
import {
  ConnectorFetchBudget,
  ConnectorFetchOptions,
  ConnectorFetchResult,
  ConnectorFetchWindow,
  ConnectorTestOptions,
  ConnectorTestResult,
  ConnectorTransport,
  SecurityConnectorSettings,
  SecurityEventConnector,
  attachConnectorChecks,
  attachConnectorFetchSummary,
  makeCheck,
  readSettingBoolean,
  readSettingString,
} from "../Types";
import GoogleWorkspaceClient, {
  GOOGLE_WORKSPACE_PAGE_SIZE,
  GoogleWorkspaceActivityPage,
  GoogleWorkspaceHttpError,
} from "./GoogleWorkspaceClient";

/*
 * Google Workspace connector: sign-ins and what Google flagged about them,
 * administrators' changes, apps given access to data, single sign-on and
 * accounts' own security settings - and, when the connection's Drive
 * option is on, files shared outside the organization or downloaded - from
 * the Admin SDK Reports API.
 *
 * The Reports API lists activities by WHEN THEY HAPPENED, newest first:
 * there is no time Google made an activity readable to list by, and it
 * documents its logs arriving minutes to hours late. So the catalog gives
 * the connection a two hour cursor overlap - each poll reads the two hours
 * before its last window again and the id dedupe drops what it has - and
 * a bound that stops a read names no resume point (the poller narrows the
 * next window from the same start instead).
 *
 * Each application is read with a page budget of its own, so a busy one
 * (sign-ins, Drive) cannot starve the others. Drive is read only for the
 * events the normalizer keeps, one listing per event name: Drive records
 * every file anyone opens.
 *
 * Settings come from the catalog's keys: config.adminEmail,
 * config.includeDrive and secrets.serviceAccountJson.
 */

interface ParsedSettings {
  adminEmail: string;
  serviceAccountJson: string;
  includeDrive: boolean;
}

// One listing a fetch makes: an application, or one event of it.
interface PlannedRead {
  application: GoogleWorkspaceApplication;
  eventName?: string | undefined;
}

/*
 * Pages one fetch reads at most, per listing (1,000 activities a page).
 * Sign-ins are the busiest log; each Drive event is a listing of its own.
 */
export const GOOGLE_WORKSPACE_PAGE_BUDGETS: Record<
  GoogleWorkspaceApplication,
  number
> = {
  [GoogleWorkspaceApplication.Login]: 10,
  [GoogleWorkspaceApplication.Admin]: 5,
  [GoogleWorkspaceApplication.Token]: 5,
  [GoogleWorkspaceApplication.Saml]: 5,
  [GoogleWorkspaceApplication.UserAccounts]: 3,
  [GoogleWorkspaceApplication.Drive]: 4,
};

// The worker job times out at ten minutes; importing follows the fetch.
export const GOOGLE_WORKSPACE_FETCH_DURATION_MS: number = 4 * 60 * 1000;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
// Normalization failures quoted into warnings before the rest are counted only.
const MAX_NORMALIZATION_WARNINGS: number = 5;
const MAX_ADMIN_EMAIL_LENGTH: number = 254;

// The Drive event a test reads to see whether Drive's log can be read.
const DRIVE_PROBE_EVENT: string = "change_document_visibility";

// How each application's activities are named in checks and warnings.
const APPLICATION_NOUNS: Record<GoogleWorkspaceApplication, string> = {
  [GoogleWorkspaceApplication.Login]: "sign-in activity",
  [GoogleWorkspaceApplication.Admin]: "admin activity",
  [GoogleWorkspaceApplication.Token]: "OAuth token activity",
  [GoogleWorkspaceApplication.Saml]: "SAML sign-in activity",
  [GoogleWorkspaceApplication.UserAccounts]: "account security activity",
  [GoogleWorkspaceApplication.Drive]: "Drive activity",
};

// How each application is named in a list of counts.
const APPLICATION_LABELS: Record<GoogleWorkspaceApplication, string> = {
  [GoogleWorkspaceApplication.Login]: "sign-ins",
  [GoogleWorkspaceApplication.Admin]: "admin",
  [GoogleWorkspaceApplication.Token]: "OAuth tokens",
  [GoogleWorkspaceApplication.Saml]: "SAML",
  [GoogleWorkspaceApplication.UserAccounts]: "account security",
  [GoogleWorkspaceApplication.Drive]: "Drive",
};

const READ_CHECK: { key: string; name: string } = {
  key: "read-audit-logs",
  name: "Read the audit logs",
};

const DRIVE_CHECK: { key: string; name: string } = {
  key: "read-drive",
  name: "Read Drive activity",
};

const AVAILABILITY_CHECK: { key: string; name: string } = {
  key: "detections-available",
  name: "Activities available to import",
};

const UNORDERED_READ_NOTE: string =
  "Google lists activities newest first, so this run cannot name a point to resume from.";

type PassStop = "end" | "requests" | "records" | "time";

// Everything one fetch accumulates across its listings.
interface FetchRun {
  startedMs: number;
  maxDurationMs: number;
  vendorName: string;
  productName: string;
  events: Array<NormalizedSecurityEvent>;
  seen: Set<string>;
  fetchedCount: number;
  rejectedCount: number;
  failedCount: number;
  complete: boolean;
  warnings: Array<string>;
  samples: Array<SecurityConnectorSample>;
  sampleLimit: number;
  // Activities read, per application, whether or not they became events.
  activitiesRead: Record<string, number>;
  // Events imported, per application.
  imported: Record<string, number>;
  // Listings a bound stopped, in words.
  stopped: Array<string>;
}

export default class GoogleWorkspaceConnector
  implements SecurityEventConnector
{
  public provider: SecurityEventConnectorProvider =
    SecurityEventConnectorProvider.GoogleWorkspace;

  /*
   * The poller's single-list defaults (20 requests, 10000 records) would
   * collapse the listings' budgets into one. The total is every listing's
   * budget, Drive's included, with room for the token and a 401 retry.
   */
  public fetchBudget: ConnectorFetchBudget = {
    maxRequests: GoogleWorkspaceConnector.plannedPages(true) + 3,
    maxEvents:
      GoogleWorkspaceConnector.plannedPages(true) * GOOGLE_WORKSPACE_PAGE_SIZE,
    maxDurationMs: GOOGLE_WORKSPACE_FETCH_DURATION_MS,
  };

  private transport: ConnectorTransport;

  public constructor(transport?: ConnectorTransport | undefined) {
    this.transport =
      transport ||
      ((request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
        return DataSourceHttpFetch.fetch(request);
      });
  }

  // Every listing a fetch makes, in the order it makes them.
  public static plan(includeDrive: boolean): Array<PlannedRead> {
    const reads: Array<PlannedRead> = [
      GoogleWorkspaceApplication.Admin,
      ...GOOGLE_WORKSPACE_DEFAULT_APPLICATIONS.filter(
        (application: GoogleWorkspaceApplication): boolean => {
          return application !== GoogleWorkspaceApplication.Admin;
        },
      ),
    ].map((application: GoogleWorkspaceApplication): PlannedRead => {
      return { application };
    });

    if (includeDrive) {
      for (const eventName of GOOGLE_DRIVE_EVENTS) {
        reads.push({
          application: GoogleWorkspaceApplication.Drive,
          eventName,
        });
      }
    }

    return reads;
  }

  public static plannedPages(includeDrive: boolean): number {
    return GoogleWorkspaceConnector.plan(includeDrive).reduce(
      (total: number, read: PlannedRead): number => {
        return total + GOOGLE_WORKSPACE_PAGE_BUDGETS[read.application];
      },
      0,
    );
  }

  private static getDefinition(): SecurityEventConnectorDefinition {
    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(
        SecurityEventConnectorProvider.GoogleWorkspace,
      );

    if (!definition) {
      throw new BadDataException(
        "Google Workspace is missing from the connector catalog.",
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

  public static readsDrive(settings: SecurityConnectorSettings): boolean {
    return readSettingBoolean(
      settings.config,
      GOOGLE_WORKSPACE_DRIVE_KEY,
      false,
    );
  }

  /*
   * An address with one @, something on both sides, a dot in the domain
   * and no spaces: what Google takes as a user. Checked by hand, not by a
   * pattern, so a long paste costs a linear scan.
   */
  public static isEmailAddress(value: string): boolean {
    if (!value || value.length > MAX_ADMIN_EMAIL_LENGTH) {
      return false;
    }

    const parts: Array<string> = value.split("@");

    if (parts.length !== 2) {
      return false;
    }

    const local: string = parts[0]!;
    const domain: string = parts[1]!;

    for (let index: number = 0; index < value.length; index++) {
      const code: number = value.charCodeAt(index);

      if (code <= 0x20 || code === 0x7f) {
        return false;
      }
    }

    return (
      local.length > 0 &&
      domain.length > 2 &&
      domain.indexOf(".") > 0 &&
      !domain.endsWith(".")
    );
  }

  private static parseSettings(
    settings: SecurityConnectorSettings,
  ): ParsedSettings {
    const adminEmail: string = readSettingString(settings.config, "adminEmail");
    const serviceAccountJson: string = readSettingString(
      settings.secrets,
      "serviceAccountJson",
    );

    if (!GoogleWorkspaceConnector.isEmailAddress(adminEmail)) {
      throw new BadDataException(
        `${this.fieldTitle("adminEmail")} must be the email address of a Google Workspace administrator, such as admin@example.com.`,
      );
    }

    if (!serviceAccountJson) {
      throw new BadDataException(
        `${this.fieldTitle("serviceAccountJson")} is required.`,
      );
    }

    // Throws BadDataException naming what the pasted key is missing.
    GoogleSecOpsClient.parseServiceAccountJson(serviceAccountJson);

    return {
      adminEmail,
      serviceAccountJson,
      includeDrive: GoogleWorkspaceConnector.readsDrive(settings),
    };
  }

  public validateSettings(settings: SecurityConnectorSettings): void {
    if (settings.provider !== this.provider) {
      throw new BadDataException(
        `Settings are for provider "${String(settings.provider)}", not ${GoogleWorkspaceConnector.getDefinition().title}.`,
      );
    }

    GoogleWorkspaceConnector.parseSettings(settings);
  }

  private buildClient(
    parsed: ParsedSettings,
    requestTimeoutInMs: number,
  ): GoogleWorkspaceClient {
    return new GoogleWorkspaceClient({
      serviceAccountJson: parsed.serviceAccountJson,
      adminEmail: parsed.adminEmail,
      transport: this.transport,
      requestTimeoutInMs,
    });
  }

  /*
   * Provider checks in dependency order: authentication (which is where
   * domain-wide delegation is checked), a read of the sign-in and admin
   * logs over the last 24 hours, Drive's log when the connection reads it,
   * and what there is to import. A later check is skipped rather than
   * failed when one it depends on fails.
   */
  public async testConnection(
    settings: SecurityConnectorSettings,
    options: ConnectorTestOptions,
  ): Promise<ConnectorTestResult> {
    const checks: Array<SecurityConnectorCheck> = [];
    const samples: Array<SecurityConnectorSample> = [];
    const readsDrive: boolean = GoogleWorkspaceConnector.readsDrive(settings);
    let parsed: ParsedSettings;
    let startedAtMs: number = Date.now();

    const skipRest: (message: string) => void = (message: string): void => {
      for (const check of [
        READ_CHECK,
        ...(readsDrive ? [DRIVE_CHECK] : []),
        AVAILABILITY_CHECK,
      ]) {
        checks.push(
          GoogleWorkspaceConnector.skipped(check.key, check.name, message),
        );
      }
    };

    try {
      parsed = GoogleWorkspaceConnector.parseSettings(settings);
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Google",
          status: "fail",
          startedAtMs,
          message: redactLogString(ConnectorErrorMessage.toMessage(error)),
          remediation:
            "Correct the highlighted setting and test again. Nothing was contacted.",
        }),
      );
      skipRest("Skipped because the configuration is not usable.");
      return { checks };
    }

    const client: GoogleWorkspaceClient = this.buildClient(
      parsed,
      options.requestTimeoutInMs,
    );

    try {
      await client.getAccessToken();
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Google",
          status: "pass",
          startedAtMs,
          message: `Google let the service account ${client.getClientEmail()} act as ${parsed.adminEmail} to read the audit logs.`,
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Google",
          status: "fail",
          startedAtMs,
          message: GoogleWorkspaceConnector.errorMessage(error),
          remediation: GoogleWorkspaceConnector.remediationFor(error),
        }),
      );
      skipRest("Skipped because authentication failed.");
      return { checks };
    }

    const now: Date = new Date();
    const dayAgo: Date = new Date(now.getTime() - DAY_IN_MS);
    // A queued test only needs to know whether access works.
    const probeSize: number = options.skipAvailability
      ? 1
      : GOOGLE_WORKSPACE_PAGE_SIZE;
    const counts: Record<string, string> = {};
    let readable: boolean = true;

    startedAtMs = Date.now();

    try {
      const latest: Array<string> = [];

      for (const application of [
        GoogleWorkspaceApplication.Login,
        GoogleWorkspaceApplication.Admin,
      ]) {
        const page: GoogleWorkspaceActivityPage = await client.listActivities({
          application,
          startTime: dayAgo,
          endTime: now,
          pageSize: probeSize,
        });

        counts[application] = page.nextPageToken
          ? `${page.activities.length}+`
          : String(page.activities.length);

        const reading: SecurityRecordReading | null =
          GoogleWorkspaceConnector.firstReading(page.activities);

        if (reading) {
          latest.push(redactLogString(reading.message).slice(0, 200));

          const sample: SecurityConnectorSample | null =
            GoogleWorkspaceConnector.toSample(reading, page.activities[0]!);

          if (sample) {
            samples.push(sample);
          }
        }
      }

      checks.push(
        makeCheck({
          key: READ_CHECK.key,
          name: READ_CHECK.name,
          status: "pass",
          startedAtMs,
          message:
            latest.length > 0
              ? `Google returned the sign-in and admin logs. The latest in the last 24 hours: ${latest.join("; ")}.`
              : "Google accepted a read of the sign-in and admin logs. Neither had activity in the last 24 hours.",
        }),
      );
    } catch (error) {
      readable = false;
      checks.push(
        makeCheck({
          key: READ_CHECK.key,
          name: READ_CHECK.name,
          status: "fail",
          startedAtMs,
          message: GoogleWorkspaceConnector.errorMessage(error),
          remediation: GoogleWorkspaceConnector.remediationFor(error),
        }),
      );
    }

    if (readsDrive) {
      startedAtMs = Date.now();

      if (!readable) {
        checks.push(
          GoogleWorkspaceConnector.skipped(
            DRIVE_CHECK.key,
            DRIVE_CHECK.name,
            "Skipped because the audit logs could not be read.",
          ),
        );
      } else {
        try {
          await client.listActivities({
            application: GoogleWorkspaceApplication.Drive,
            eventName: DRIVE_PROBE_EVENT,
            startTime: dayAgo,
            endTime: now,
            pageSize: 1,
          });
          checks.push(
            makeCheck({
              key: DRIVE_CHECK.key,
              name: DRIVE_CHECK.name,
              status: "pass",
              startedAtMs,
              message:
                "Google returned Drive's audit log: files shared outside the organization, made public or downloaded are imported.",
            }),
          );
        } catch (error) {
          checks.push(
            makeCheck({
              key: DRIVE_CHECK.key,
              name: DRIVE_CHECK.name,
              status: "fail",
              startedAtMs,
              message: GoogleWorkspaceConnector.errorMessage(error),
              remediation: GoogleWorkspaceConnector.driveRemediation(error),
            }),
          );
        }
      }
    }

    if (!readable) {
      checks.push(
        GoogleWorkspaceConnector.skipped(
          AVAILABILITY_CHECK.key,
          AVAILABILITY_CHECK.name,
          "Skipped because a read check failed; fix that first and test again.",
        ),
      );
    } else if (options.skipAvailability) {
      checks.push(
        GoogleWorkspaceConnector.skipped(
          AVAILABILITY_CHECK.key,
          AVAILABILITY_CHECK.name,
          "Skipped in a queued test run: availability is only counted by the synchronous Test connection.",
        ),
      );
    } else {
      const signIns: string = counts[GoogleWorkspaceApplication.Login] || "0";
      const changes: string = counts[GoogleWorkspaceApplication.Admin] || "0";
      const nothing: boolean = signIns === "0" && changes === "0";

      checks.push(
        makeCheck({
          key: AVAILABILITY_CHECK.key,
          name: AVAILABILITY_CHECK.name,
          status: nothing ? "warn" : "pass",
          startedAtMs: Date.now(),
          message: nothing
            ? "No sign-ins or admin changes in the last 24 hours. Polling imports new activity as Google records it."
            : `${signIns} sign-in ${signIns === "1" ? "activity" : "activities"} and ${changes} admin ${changes === "1" ? "change" : "changes"} in the last 24 hours.`,
          ...(nothing
            ? {
                remediation:
                  "A Google Workspace people sign in to every day has sign-ins every day, so an empty day usually means the Administrator email belongs to a different, unused Google Workspace.",
              }
            : {}),
          details: {
            signInsLast24h: signIns,
            adminChangesLast24h: changes,
          },
        }),
      );
    }

    return { checks, ...(samples.length > 0 ? { samples } : {}) };
  }

  /*
   * Read every activity in the window, listing by listing, within each
   * listing's budget. A failed listing throws, with the checks of the
   * listings that ran - except Drive's, whose failure is a warning: Drive
   * is an option, and its audit log needs an edition that has it.
   */
  public async fetchEvents(
    settings: SecurityConnectorSettings,
    window: ConnectorFetchWindow,
    options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult> {
    const parsed: ParsedSettings =
      GoogleWorkspaceConnector.parseSettings(settings);
    const definition: SecurityEventConnectorDefinition =
      GoogleWorkspaceConnector.getDefinition();
    const client: GoogleWorkspaceClient = this.buildClient(
      parsed,
      options.requestTimeoutInMs,
    );
    const plan: Array<PlannedRead> = GoogleWorkspaceConnector.plan(
      parsed.includeDrive,
    );
    const planned: number = GoogleWorkspaceConnector.plannedPages(
      parsed.includeDrive,
    );
    const requestScale: number = Math.min(
      1,
      Math.max(0, Math.floor(options.maxRequests)) / planned,
    );
    const recordScale: number = Math.min(
      1,
      Math.max(0, Math.floor(options.maxEvents)) /
        (planned * GOOGLE_WORKSPACE_PAGE_SIZE),
    );
    const run: FetchRun = {
      startedMs: Date.now(),
      maxDurationMs:
        typeof options.maxDurationMs === "number" &&
        Number.isFinite(options.maxDurationMs) &&
        options.maxDurationMs > 0
          ? options.maxDurationMs
          : GOOGLE_WORKSPACE_FETCH_DURATION_MS,
      vendorName: definition.vendorName,
      productName: definition.productName,
      events: [],
      seen: new Set<string>(),
      fetchedCount: 0,
      rejectedCount: 0,
      failedCount: 0,
      complete: true,
      warnings: [],
      samples: [],
      sampleLimit: options.sampleLimit,
      activitiesRead: {},
      imported: {},
      stopped: [],
    };
    const checks: Array<SecurityConnectorCheck> = [];
    const budgetFor: (read: PlannedRead) => {
      maxPages: number;
      maxActivities: number;
    } = (read: PlannedRead): { maxPages: number; maxActivities: number } => {
      const pages: number = GOOGLE_WORKSPACE_PAGE_BUDGETS[read.application];

      return {
        maxPages: Math.max(1, Math.floor(pages * requestScale)),
        maxActivities: Math.max(
          1,
          Math.floor(pages * GOOGLE_WORKSPACE_PAGE_SIZE * recordScale),
        ),
      };
    };
    const isDrive: (read: PlannedRead) => boolean = (
      read: PlannedRead,
    ): boolean => {
      return read.application === GoogleWorkspaceApplication.Drive;
    };
    let phase: { key: string; name: string } = READ_CHECK;
    let phaseStartedMs: number = Date.now();
    let driveFailure: unknown = null;

    try {
      for (const read of plan.filter((candidate: PlannedRead): boolean => {
        return !isDrive(candidate);
      })) {
        await GoogleWorkspaceConnector.readListing({
          client,
          run,
          read,
          window,
          ...budgetFor(read),
        });
      }

      const auditStopped: Array<string> = run.stopped.slice();

      checks.push(
        makeCheck({
          key: READ_CHECK.key,
          name: READ_CHECK.name,
          status: auditStopped.length > 0 ? "warn" : "pass",
          startedAtMs: phaseStartedMs,
          message: `Activities read in the window: ${plan
            .filter((read: PlannedRead): boolean => {
              return !isDrive(read);
            })
            .map((read: PlannedRead): string => {
              return `${APPLICATION_LABELS[read.application]} ${run.activitiesRead[read.application] || 0}`;
            })
            .join(
              ", ",
            )}.${auditStopped.length > 0 ? ` Stopped early: ${auditStopped.join("; ")}.` : ""}`,
        }),
      );

      phase = DRIVE_CHECK;
      phaseStartedMs = Date.now();

      for (const read of plan.filter(isDrive)) {
        try {
          await GoogleWorkspaceConnector.readListing({
            client,
            run,
            read,
            window,
            ...budgetFor(read),
          });
        } catch (error) {
          // Google failing on its side is worth reading the window again for.
          if (GoogleWorkspaceConnector.isTransient(error)) {
            throw error;
          }

          driveFailure = error;
          break;
        }
      }
    } catch (error) {
      checks.push(
        makeCheck({
          key: phase.key,
          name: phase.name,
          status: "fail",
          startedAtMs: phaseStartedMs,
          message: GoogleWorkspaceConnector.errorMessage(error),
          remediation: GoogleWorkspaceConnector.remediationFor(error),
        }),
      );

      throw attachConnectorFetchSummary(attachConnectorChecks(error, checks), {
        warnings: [...run.warnings],
        requestCount: client.getRequestCount(),
        fetchedCount: run.fetchedCount,
        details: { activitiesRead: { ...run.activitiesRead } },
      });
    }

    if (parsed.includeDrive) {
      if (driveFailure) {
        run.warnings.push(
          `Drive activity was not read: ${GoogleWorkspaceConnector.errorMessage(driveFailure)}`,
        );
        checks.push(
          makeCheck({
            key: DRIVE_CHECK.key,
            name: DRIVE_CHECK.name,
            status: "warn",
            startedAtMs: phaseStartedMs,
            message: GoogleWorkspaceConnector.errorMessage(driveFailure),
            remediation:
              GoogleWorkspaceConnector.driveRemediation(driveFailure),
          }),
        );
      } else {
        const driveNoun: string =
          APPLICATION_NOUNS[GoogleWorkspaceApplication.Drive];
        const driveStopped: Array<string> = run.stopped.filter(
          (stop: string): boolean => {
            return stop.startsWith(driveNoun);
          },
        );
        const imported: number =
          run.imported[GoogleWorkspaceApplication.Drive] || 0;

        checks.push(
          makeCheck({
            key: DRIVE_CHECK.key,
            name: DRIVE_CHECK.name,
            status: driveStopped.length > 0 ? "warn" : "pass",
            startedAtMs: phaseStartedMs,
            message: `${imported} Drive ${imported === 1 ? "event" : "events"} about sharing and downloads in the window.${driveStopped.length > 0 ? ` Stopped early: ${driveStopped.join("; ")}.` : ""}`,
          }),
        );
      }
    }

    return {
      events: run.events,
      fetchedCount: run.fetchedCount,
      rejectedCount: run.rejectedCount,
      failedCount: run.failedCount,
      complete: run.complete,
      requestCount: client.getRequestCount(),
      warnings: run.warnings,
      samples: run.samples,
      checks,
      details: {
        basis: "activity-time",
        activitiesRead: { ...run.activitiesRead },
      },
    };
  }

  // One listing over the window, page by page, within its budget.
  private static async readListing(data: {
    client: GoogleWorkspaceClient;
    run: FetchRun;
    read: PlannedRead;
    window: ConnectorFetchWindow;
    maxPages: number;
    maxActivities: number;
  }): Promise<void> {
    const { client, run, read, window, maxPages, maxActivities } = data;
    let pages: number = 0;
    let returned: number = 0;
    let pageToken: string | null = null;
    let stoppedBy: PassStop = "end";

    for (;;) {
      if (pages >= maxPages) {
        stoppedBy = "requests";
        break;
      }

      if (Date.now() - run.startedMs >= run.maxDurationMs) {
        stoppedBy = "time";
        break;
      }

      const page: GoogleWorkspaceActivityPage = await client.listActivities({
        application: read.application,
        eventName: read.eventName,
        startTime: window.startTime,
        endTime: window.endTime,
        pageSize: Math.min(GOOGLE_WORKSPACE_PAGE_SIZE, maxActivities),
        pageToken: pageToken || undefined,
      });
      pages++;

      let reachedBound: boolean = false;

      for (const activity of page.activities) {
        if (returned >= maxActivities) {
          reachedBound = true;
          break;
        }

        returned++;
        GoogleWorkspaceConnector.collect(run, read, activity);
      }

      if (reachedBound) {
        stoppedBy = "records";
        break;
      }

      if (!page.nextPageToken || page.activities.length === 0) {
        break;
      }

      pageToken = page.nextPageToken;
    }

    run.activitiesRead[read.application] =
      (run.activitiesRead[read.application] || 0) + returned;

    if (stoppedBy !== "end") {
      const what: string = `${APPLICATION_NOUNS[read.application]}${read.eventName ? ` (${read.eventName})` : ""} after ${returned} activities (${GoogleWorkspaceConnector.stopReason(stoppedBy)})`;

      run.complete = false;
      run.stopped.push(what);
      run.warnings.push(
        `Stopped reading ${what} before reading the whole window. ${UNORDERED_READ_NOTE}`,
      );
    }
  }

  private static collect(
    run: FetchRun,
    read: PlannedRead,
    activity: JSONObject,
  ): void {
    if (!isGoogleWorkspaceActivity(activity)) {
      run.fetchedCount++;
      run.rejectedCount++;
      return;
    }

    let readings: Array<SecurityRecordReading>;

    try {
      readings = readGoogleWorkspaceActivity(activity);
    } catch (error) {
      run.fetchedCount++;
      GoogleWorkspaceConnector.recordFailure(run, read, error);
      return;
    }

    let kept: boolean = false;

    for (const reading of readings) {
      let event: NormalizedSecurityEvent;

      try {
        event = toNormalizedSecurityEvent({
          reading,
          vendorName: run.vendorName,
          productName: run.productName,
          raw: activity,
        });
      } catch (error) {
        GoogleWorkspaceConnector.recordFailure(run, read, error);
        continue;
      }

      // The same activity comes back from overlapping listings and pages.
      if (run.seen.has(event.eventUid)) {
        continue;
      }

      run.seen.add(event.eventUid);
      run.events.push(event);
      run.imported[read.application] =
        (run.imported[read.application] || 0) + 1;
      kept = true;

      if (run.samples.length < run.sampleLimit) {
        run.samples.push({
          id: event.eventUid,
          title: event.message,
          severity: event.severityName,
          eventTime: event.time.toISOString(),
        });
      }
    }

    // A sign-out, or a Drive event no one acts on, is read but not kept.
    if (kept) {
      run.fetchedCount++;
    }
  }

  private static recordFailure(
    run: FetchRun,
    read: PlannedRead,
    error: unknown,
  ): void {
    run.failedCount++;

    if (run.failedCount <= MAX_NORMALIZATION_WARNINGS) {
      run.warnings.push(
        `A ${APPLICATION_NOUNS[read.application]} record could not be normalized: ${redactLogString(ConnectorErrorMessage.toMessage(error))}`,
      );
    }
  }

  private static firstReading(
    activities: Array<JSONObject>,
  ): SecurityRecordReading | null {
    for (const activity of activities.slice(0, 50)) {
      try {
        const reading: SecurityRecordReading | undefined =
          readGoogleWorkspaceActivity(activity)[0];

        if (reading) {
          return reading;
        }
      } catch {
        // A record the normalizer cannot read never fails a read check.
      }
    }

    return null;
  }

  private static toSample(
    reading: SecurityRecordReading,
    raw: JSONObject,
  ): SecurityConnectorSample | null {
    try {
      const definition: SecurityEventConnectorDefinition =
        GoogleWorkspaceConnector.getDefinition();
      const event: NormalizedSecurityEvent = toNormalizedSecurityEvent({
        reading,
        vendorName: definition.vendorName,
        productName: definition.productName,
        raw,
      });

      return {
        id: event.eventUid,
        title: event.message,
        severity: event.severityName,
        eventTime: event.time.toISOString(),
      };
    } catch {
      return null;
    }
  }

  /*
   * A failure that reading the window again may not repeat: throttling,
   * Google's own errors, a request that never completed.
   */
  public static isTransient(error: unknown): boolean {
    if (error instanceof GoogleWorkspaceHttpError) {
      return error.statusCode === 429 || error.statusCode >= 500;
    }

    return true;
  }

  private static stopReason(stop: PassStop): string {
    if (stop === "requests") {
      return "the per-run request limit";
    }

    if (stop === "records") {
      return "the per-run record limit";
    }

    if (stop === "time") {
      return "the per-run time limit";
    }

    return "the end of the window";
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

  private static errorMessage(error: unknown): string {
    return redactLogString(
      ConnectorErrorMessage.toMessage(error, { truncate: false }),
    );
  }

  public static remediationFor(error: unknown): string {
    const status: number | null =
      error instanceof GoogleWorkspaceHttpError ? error.statusCode : null;
    const reason: string =
      error instanceof GoogleWorkspaceHttpError ? error.reason : "";
    const message: string = error instanceof Error ? error.message : "";

    if (reason === "unauthorized_client" || reason === "access_denied") {
      return "In the Google Admin console, open Security > Access and data control > API controls > Manage domain-wide delegation and add the service account's client ID (client_id in the key) with the scope https://www.googleapis.com/auth/admin.reports.audit.readonly. Google can take a few minutes to apply it.";
    }

    if (reason === "invalid_grant") {
      return message.toLowerCase().includes("signature")
        ? "Create a new key for the service account in the Google Cloud console (IAM & Admin > Service accounts > Keys) and paste it with Update credentials."
        : "Set Administrator email to a user of this Google Workspace who is an administrator with the Reports privilege, and check the server's clock: Google refuses an assertion signed more than a few minutes off.";
    }

    if (reason === "accessNotConfigured" || reason === "SERVICE_DISABLED") {
      return "Turn on the Admin SDK API in the service account's Google Cloud project (APIs & Services > Library > Admin SDK API), wait a few minutes, and test again.";
    }

    if (status === 403) {
      return "The Administrator email must be an administrator with the Reports privilege - a super administrator has it. Assign it in the Google Admin console under Account > Admin roles, or choose another administrator.";
    }

    if (status === 401) {
      return "Google refused the access token. Test again; if it persists, create a new key for the service account and paste it with Update credentials.";
    }

    if (status === 429) {
      return "Google is limiting this project's Reports API requests. Wait a few minutes and test again; scheduled polls retry on their own.";
    }

    if (status !== null && status >= 500) {
      return "Google failed on its side. Test again in a few minutes; if it persists, check the Google Workspace Status Dashboard.";
    }

    if (status === 400) {
      return "Google refused the request. Check that the service account key is for a project in good standing and that the Administrator email is a user of this Google Workspace.";
    }

    return "OneUptime could not get an answer from Google. Check that the OneUptime API and worker processes can reach oauth2.googleapis.com and admin.googleapis.com.";
  }

  private static driveRemediation(error: unknown): string {
    const status: number | null =
      error instanceof GoogleWorkspaceHttpError ? error.statusCode : null;

    if (status === 400 || status === 403 || status === 404) {
      return "Drive's audit log needs a Google Workspace edition that has it (Business Standard, Business Plus, Enterprise, Education and others), and an administrator with the Reports privilege. Turn the Drive activity option off if this Google Workspace has none.";
    }

    return GoogleWorkspaceConnector.remediationFor(error);
  }
}
