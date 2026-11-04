import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  ENTRA_BACKGROUND_SIGN_INS_KEY,
  MICROSOFT_365_AUDIT_KEY,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  EntraLog,
  isEntraDirectoryAudit,
  isEntraRiskDetection,
  isEntraSignIn,
  readEntraBackgroundSignIn,
  readEntraDirectoryAudit,
  readEntraRisk,
  readEntraSignIn,
} from "../../../../../Utils/SecurityEvent/Connectors/EntraIdNormalizer";
import { readMicrosoft365Record } from "../../../../../Utils/SecurityEvent/Connectors/Microsoft365AuditNormalizer";
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
import MicrosoftEntraIdClient, {
  ENTRA_PREMIUM_REQUIRED_CODE,
  MICROSOFT_365_CONTENT_TYPES,
  MICROSOFT_365_MAX_AGE_IN_MS,
  MICROSOFT_365_MAX_LIST_WINDOW_IN_MS,
  MICROSOFT_ENTRA_ID_CLOUDS,
  MICROSOFT_ENTRA_ID_PAGE_SIZE,
  Microsoft365Content,
  Microsoft365ContentPage,
  Microsoft365Subscription,
  MicrosoftEntraIdCloud,
  MicrosoftEntraIdHttpError,
  MicrosoftEntraIdLog,
  MicrosoftEntraIdPage,
} from "./MicrosoftEntraIdClient";

/*
 * Microsoft Entra ID connector: the tenant's sign-ins, directory changes
 * and Identity Protection's risk detections from Microsoft Graph; when the
 * connection's Background and app sign-ins option is on, the sign-ins apps
 * make for people in the background and apps' own that failed; and when its
 * Microsoft 365 audit log option is on, the Exchange, SharePoint, OneDrive
 * and Teams records a security team acts on, from the Office 365
 * Management Activity API.
 *
 * A fetch reads its window in passes, each with a budget of its own so a
 * busy one cannot starve the others: directory changes first (few, and the
 * ones that matter most), then sign-ins, risk detections, background and
 * app sign-ins, and last the Microsoft 365 audit log.
 *
 *  - Graph lists its logs newest first and documents no oldest-first
 *    order, so a pass a bound stops names no resume point; the poller then
 *    narrows the next window from the same start (see Connectors/Types.ts).
 *  - A tenant without Microsoft Entra ID P1 or P2 cannot read its sign-ins
 *    or risk detections through Graph. That is a warning on every run, not
 *    a failure: its directory changes are still imported.
 *  - Directory changes and sign-ins are the connection's own: a failure to
 *    read either fails the run. Every later pass is an addition, and its
 *    failures never stop the others: a permission or licence problem is a
 *    warning (re-reading the window would not fix it), a transient one
 *    leaves the window to be read again. Risk detections need a permission
 *    of their own (IdentityRiskEvent.Read.All) that connections made before
 *    it was read may lack; background and app sign-ins come from Graph's
 *    beta list.
 *  - The Microsoft 365 audit log is listed by when Microsoft made each
 *    content blob available - the time this framework polls by. Its
 *    content types are subscribed to on the first poll; a backfill can read
 *    the last 7 days once a problem with it is fixed.
 *
 * Settings come from the catalog's keys: config.tenantId, config.clientId,
 * config.cloud, config.includeBackgroundSignIns,
 * config.includeMicrosoft365Audit and secrets.clientSecret.
 */

interface ParsedSettings {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  cloud: MicrosoftEntraIdCloud;
  includeBackgroundSignIns: boolean;
  includeMicrosoft365: boolean;
}

const GUID_REGEX: RegExp =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/*
 * Entra accepts the tenant as its GUID or as a verified domain name
 * (contoso.onmicrosoft.com). Anything else is a typo that would otherwise
 * surface as a 400 from the token endpoint on the first poll.
 */
const TENANT_REGEX: RegExp = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/;

// Pages of directory changes one fetch reads at most (500 a page).
export const ENTRA_DIRECTORY_AUDIT_PAGE_BUDGET: number = 10;
// Pages of sign-ins one fetch reads at most (500 a page).
export const ENTRA_SIGN_IN_PAGE_BUDGET: number = 20;
// Pages of risk detections one fetch reads at most (500 a page).
export const ENTRA_RISK_DETECTION_PAGE_BUDGET: number = 4;
/*
 * Pages of each background sign-in kind one fetch reads at most (500 a
 * page): apps sign in for people far more often than people sign in, and
 * only the failures are kept.
 */
export const ENTRA_BACKGROUND_SIGN_IN_PAGE_BUDGET: number = 10;
/*
 * Requests the Microsoft 365 pass makes at most: its subscriptions, the
 * content listings and every content blob.
 */
export const MICROSOFT_365_REQUEST_BUDGET: number = 120;
// Microsoft 365 records one fetch imports at most.
export const MICROSOFT_365_RECORD_BUDGET: number = 10000;
// The worker job times out at ten minutes; importing follows the fetch.
export const MICROSOFT_ENTRA_ID_FETCH_DURATION_MS: number = 4 * 60 * 1000;

/*
 * The Management API refuses a start time more than 7 days back; a few
 * minutes' margin keeps a window that starts right at the edge readable.
 */
const MICROSOFT_365_AGE_MARGIN_IN_MS: number = 5 * 60 * 1000;
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
// Normalization failures quoted into warnings before the rest are counted only.
const MAX_NORMALIZATION_WARNINGS: number = 5;

const UNORDERED_READ_NOTE: string =
  "Microsoft Graph lists them newest first, so this run cannot name a point to resume from.";

const MICROSOFT_365_FIRST_CONTENT_NOTE: string =
  "Microsoft makes the first records of a new subscription available within 12 hours.";

type PassStop = "end" | "requests" | "records" | "time";

interface PassBudget {
  maxRequests: number;
  maxRecords: number;
}

// Everything one fetch accumulates across its passes.
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
  checks: Array<SecurityConnectorCheck>;
  details: JSONObject;
}

interface GraphPassOutcome {
  returned: number;
  pages: number;
  stoppedBy: PassStop;
}

interface Microsoft365PassOutcome {
  contentBlobs: number;
  recordsRead: number;
  recordsImported: number;
  stoppedBy: PassStop;
  subscriptionsStarted: Array<string>;
  // Content types that could not be read, with why.
  unreadable: Array<string>;
  // A request failed in a way reading the window again may fix.
  transientFailure: boolean;
}

const GRAPH_LOGS: Record<
  MicrosoftEntraIdLog,
  { key: string; name: string; noun: string }
> = {
  directoryAudits: {
    key: "read-directory-audits",
    name: "Read directory changes",
    noun: "directory changes",
  },
  signIns: {
    key: "read-sign-ins",
    name: "Read sign-ins",
    noun: "sign-ins",
  },
  riskDetections: {
    key: "read-risk-detections",
    name: "Read risk detections",
    noun: "risk detections",
  },
  nonInteractiveSignIns: {
    key: "read-background-sign-ins",
    name: "Read background sign-ins",
    noun: "background sign-ins",
  },
  servicePrincipalSignIns: {
    key: "read-app-sign-ins",
    name: "Read app sign-ins",
    noun: "app sign-ins",
  },
};

/*
 * The passes every fetch makes and fails without (the connection's own
 * records), then the ones it adds to them, which never stop the others.
 */
const CORE_LOGS: ReadonlyArray<MicrosoftEntraIdLog> = [
  "directoryAudits",
  "signIns",
];

const BACKGROUND_SIGN_IN_LOGS: ReadonlyArray<MicrosoftEntraIdLog> = [
  "nonInteractiveSignIns",
  "servicePrincipalSignIns",
];

// The passes a fetch reads, by its settings, in order, each with a budget.
type EntraPass = MicrosoftEntraIdLog | "microsoft365";

// Pages each Graph log is read for at most.
const GRAPH_PAGE_BUDGETS: Record<MicrosoftEntraIdLog, number> = {
  directoryAudits: ENTRA_DIRECTORY_AUDIT_PAGE_BUDGET,
  signIns: ENTRA_SIGN_IN_PAGE_BUDGET,
  riskDetections: ENTRA_RISK_DETECTION_PAGE_BUDGET,
  nonInteractiveSignIns: ENTRA_BACKGROUND_SIGN_IN_PAGE_BUDGET,
  servicePrincipalSignIns: ENTRA_BACKGROUND_SIGN_IN_PAGE_BUDGET,
};

// What a Graph log's records are created at: the time it is listed by.
const GRAPH_CREATED_FIELDS: Record<MicrosoftEntraIdLog, string> = {
  directoryAudits: "activityDateTime",
  signIns: "createdDateTime",
  riskDetections: "detectedDateTime",
  nonInteractiveSignIns: "createdDateTime",
  servicePrincipalSignIns: "createdDateTime",
};

const MICROSOFT_365_CHECK: { key: string; name: string } = {
  key: "read-microsoft-365",
  name: "Read the Microsoft 365 audit log",
};

// A test reads both background kinds under one check.
const BACKGROUND_SIGN_INS_CHECK: { key: string; name: string } = {
  key: "read-background-and-app-sign-ins",
  name: "Read background and app sign-ins",
};

const AVAILABILITY_CHECK: { key: string; name: string } = {
  key: "detections-available",
  name: "Records available to import",
};

export default class MicrosoftEntraIdConnector
  implements SecurityEventConnector
{
  public provider: SecurityEventConnectorProvider =
    SecurityEventConnectorProvider.MicrosoftEntraId;

  /*
   * The poller's single-list defaults (20 requests, 10000 records) would
   * collapse the passes' budgets into one. The total is every pass's
   * budget, with room for the two tokens and a 401 retry.
   */
  public fetchBudget: ConnectorFetchBudget = {
    maxRequests:
      MicrosoftEntraIdConnector.plannedRequests(
        MicrosoftEntraIdConnector.plannedPasses({
          includeBackgroundSignIns: true,
          includeMicrosoft365: true,
        }),
      ) + 4,
    maxEvents: MicrosoftEntraIdConnector.plannedRecords(
      MicrosoftEntraIdConnector.plannedPasses({
        includeBackgroundSignIns: true,
        includeMicrosoft365: true,
      }),
    ),
    maxDurationMs: MICROSOFT_ENTRA_ID_FETCH_DURATION_MS,
  };

  // Every pass a fetch with these options makes, in the order it makes them.
  public static plannedPasses(options: {
    includeBackgroundSignIns: boolean;
    includeMicrosoft365: boolean;
  }): Array<EntraPass> {
    return [
      ...CORE_LOGS,
      "riskDetections",
      ...(options.includeBackgroundSignIns ? BACKGROUND_SIGN_IN_LOGS : []),
      ...(options.includeMicrosoft365 ? ["microsoft365" as EntraPass] : []),
    ];
  }

  private static plannedRequests(passes: Array<EntraPass>): number {
    return passes.reduce((total: number, pass: EntraPass): number => {
      return (
        total +
        (pass === "microsoft365"
          ? MICROSOFT_365_REQUEST_BUDGET
          : GRAPH_PAGE_BUDGETS[pass])
      );
    }, 0);
  }

  private static plannedRecords(passes: Array<EntraPass>): number {
    return passes.reduce((total: number, pass: EntraPass): number => {
      return (
        total +
        (pass === "microsoft365"
          ? MICROSOFT_365_RECORD_BUDGET
          : GRAPH_PAGE_BUDGETS[pass] * MICROSOFT_ENTRA_ID_PAGE_SIZE)
      );
    }, 0);
  }

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
        SecurityEventConnectorProvider.MicrosoftEntraId,
      );

    if (!definition) {
      throw new BadDataException(
        "Microsoft Entra ID is missing from the connector catalog.",
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

  public static readsMicrosoft365(
    settings: SecurityConnectorSettings,
  ): boolean {
    return readSettingBoolean(settings.config, MICROSOFT_365_AUDIT_KEY, false);
  }

  public static readsBackgroundSignIns(
    settings: SecurityConnectorSettings,
  ): boolean {
    return readSettingBoolean(
      settings.config,
      ENTRA_BACKGROUND_SIGN_INS_KEY,
      false,
    );
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
    const includeMicrosoft365: boolean =
      MicrosoftEntraIdConnector.readsMicrosoft365(settings);

    if (!tenantId || !TENANT_REGEX.test(tenantId)) {
      throw new BadDataException(
        `${this.fieldTitle("tenantId")} must be the tenant GUID or its verified domain name (for example contoso.onmicrosoft.com).`,
      );
    }

    /*
     * The Management Activity API names a tenant by its GUID in every
     * address; a domain name there is answered with AF20013.
     */
    if (includeMicrosoft365 && !GUID_REGEX.test(tenantId)) {
      throw new BadDataException(
        `${this.fieldTitle("tenantId")} must be the tenant GUID to read the ${this.fieldTitle(MICROSOFT_365_AUDIT_KEY)}: the Office 365 Management API names a tenant only by its GUID.`,
      );
    }

    if (!clientId || !GUID_REGEX.test(clientId)) {
      throw new BadDataException(
        `${this.fieldTitle("clientId")} must be the app registration's GUID.`,
      );
    }

    if (!MicrosoftEntraIdClient.isCloud(cloud)) {
      throw new BadDataException(
        `${this.fieldTitle("cloud")} must be one of: ${MICROSOFT_ENTRA_ID_CLOUDS.join(", ")}.`,
      );
    }

    if (!clientSecret) {
      throw new BadDataException(
        `${this.fieldTitle("clientSecret")} is required.`,
      );
    }

    return {
      tenantId,
      clientId,
      clientSecret,
      cloud,
      includeBackgroundSignIns:
        MicrosoftEntraIdConnector.readsBackgroundSignIns(settings),
      includeMicrosoft365,
    };
  }

  public validateSettings(settings: SecurityConnectorSettings): void {
    if (settings.provider !== this.provider) {
      throw new BadDataException(
        `Settings are for provider "${String(settings.provider)}", not ${MicrosoftEntraIdConnector.getDefinition().title}.`,
      );
    }

    MicrosoftEntraIdConnector.parseSettings(settings);
  }

  private buildClient(
    parsed: ParsedSettings,
    requestTimeoutInMs: number,
  ): MicrosoftEntraIdClient {
    return new MicrosoftEntraIdClient({
      tenantId: parsed.tenantId,
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      cloud: parsed.cloud,
      transport: this.transport,
      requestTimeoutInMs,
    });
  }

  /*
   * Provider checks in dependency order: authentication, a read of each
   * log over the last 24 hours, the Microsoft 365 audit log when the
   * connection reads it, and what there is to import. A later check is
   * skipped rather than failed when one it depends on fails, so the report
   * names one root cause.
   */
  public async testConnection(
    settings: SecurityConnectorSettings,
    options: ConnectorTestOptions,
  ): Promise<ConnectorTestResult> {
    const checks: Array<SecurityConnectorCheck> = [];
    const samples: Array<SecurityConnectorSample> = [];
    const readsMicrosoft365: boolean =
      MicrosoftEntraIdConnector.readsMicrosoft365(settings);
    const readsBackgroundSignIns: boolean =
      MicrosoftEntraIdConnector.readsBackgroundSignIns(settings);
    let parsed: ParsedSettings;
    let startedAtMs: number = Date.now();

    const skipRest: (message: string, from: number) => void = (
      message: string,
      from: number,
    ): void => {
      const remaining: Array<{ key: string; name: string }> = [
        GRAPH_LOGS.signIns,
        GRAPH_LOGS.directoryAudits,
        GRAPH_LOGS.riskDetections,
        ...(readsBackgroundSignIns ? [BACKGROUND_SIGN_INS_CHECK] : []),
        ...(readsMicrosoft365 ? [MICROSOFT_365_CHECK] : []),
        AVAILABILITY_CHECK,
      ].slice(from);

      for (const check of remaining) {
        checks.push(
          MicrosoftEntraIdConnector.skipped(check.key, check.name, message),
        );
      }
    };

    try {
      parsed = MicrosoftEntraIdConnector.parseSettings(settings);
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
      skipRest("Skipped because the configuration is not usable.", 0);
      return { checks };
    }

    const client: MicrosoftEntraIdClient = this.buildClient(
      parsed,
      options.requestTimeoutInMs,
    );

    try {
      await client.getAccessToken("graph");
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Microsoft Entra",
          status: "pass",
          startedAtMs,
          message: `Microsoft Entra issued an access token for Microsoft Graph in the ${MicrosoftEntraIdConnector.cloudLabel(parsed.cloud)} cloud.`,
        }),
      );
    } catch (error) {
      checks.push(
        makeCheck({
          key: "authentication",
          name: "Authenticate with Microsoft Entra",
          status: "fail",
          startedAtMs,
          message: MicrosoftEntraIdConnector.errorMessage(error),
          remediation: MicrosoftEntraIdConnector.tokenRemediation(),
        }),
      );
      skipRest("Skipped because authentication failed.", 0);
      return { checks };
    }

    const now: Date = new Date();
    const dayAgo: Date = new Date(now.getTime() - DAY_IN_MS);
    // A queued test only needs to know whether access works.
    const probeSize: number = options.skipAvailability
      ? 1
      : MICROSOFT_ENTRA_ID_PAGE_SIZE;
    const counts: Partial<Record<MicrosoftEntraIdLog, string>> = {};
    let premiumMissing: boolean = false;
    let readable: boolean = true;

    for (const log of [
      "signIns",
      "directoryAudits",
    ] as Array<MicrosoftEntraIdLog>) {
      const check: { key: string; name: string; noun: string } =
        GRAPH_LOGS[log];
      startedAtMs = Date.now();

      try {
        const page: MicrosoftEntraIdPage = await client.listLog({
          log,
          startTime: dayAgo,
          endTime: now,
          pageSize: probeSize,
        });
        const first: JSONObject | undefined = page.records[0];

        counts[log] = page.nextLink
          ? `${page.records.length}+`
          : String(page.records.length);

        if (first) {
          const sample: SecurityConnectorSample | null =
            MicrosoftEntraIdConnector.toTestSample(log, first);

          if (sample) {
            samples.push(sample);
          }
        }

        checks.push(
          makeCheck({
            key: check.key,
            name: check.name,
            status: "pass",
            startedAtMs,
            message: first
              ? `Microsoft Graph returned the tenant's ${check.noun}; the latest in the last 24 hours: ${MicrosoftEntraIdConnector.describe(log, first)}.`
              : `Microsoft Graph accepted a read of the tenant's ${check.noun}. There were none in the last 24 hours.`,
          }),
        );
      } catch (error) {
        if (
          log === "signIns" &&
          MicrosoftEntraIdConnector.isPremiumRequired(error)
        ) {
          premiumMissing = true;
          checks.push(
            makeCheck({
              key: check.key,
              name: check.name,
              status: "warn",
              startedAtMs,
              message:
                "This tenant has no Microsoft Entra ID P1 or P2 license, and Microsoft Graph gives out sign-ins only to tenants that do. Directory changes are still imported.",
              remediation:
                "Sign-ins need Microsoft Entra ID P1 or P2 (included in Microsoft 365 E3 and E5, and Business Premium). Once the tenant has it, sign-ins are imported from the next poll.",
            }),
          );
          continue;
        }

        readable = false;
        checks.push(
          makeCheck({
            key: check.key,
            name: check.name,
            status: "fail",
            startedAtMs,
            message: MicrosoftEntraIdConnector.errorMessage(error),
            remediation: MicrosoftEntraIdConnector.graphRemediation(
              error,
              log,
              parsed.cloud,
            ),
          }),
        );
      }
    }

    checks.push(
      await MicrosoftEntraIdConnector.riskDetectionsCheck({
        client,
        cloud: parsed.cloud,
        startTime: dayAgo,
        endTime: now,
        probeSize,
        counts,
      }),
    );

    if (readsBackgroundSignIns) {
      checks.push(
        await MicrosoftEntraIdConnector.backgroundSignInsCheck({
          client,
          cloud: parsed.cloud,
          startTime: dayAgo,
          endTime: now,
        }),
      );
    }

    if (readsMicrosoft365) {
      checks.push(
        await MicrosoftEntraIdConnector.microsoft365Check(client, parsed.cloud),
      );
    }

    if (!readable) {
      checks.push(
        MicrosoftEntraIdConnector.skipped(
          AVAILABILITY_CHECK.key,
          AVAILABILITY_CHECK.name,
          "Skipped because a read check failed; fix that first and test again.",
        ),
      );
    } else if (options.skipAvailability) {
      checks.push(
        MicrosoftEntraIdConnector.skipped(
          AVAILABILITY_CHECK.key,
          AVAILABILITY_CHECK.name,
          "Skipped in a queued test run: availability is only counted by the synchronous Test connection.",
        ),
      );
    } else {
      checks.push(
        MicrosoftEntraIdConnector.availabilityCheck(counts, premiumMissing),
      );
    }

    return { checks, ...(samples.length > 0 ? { samples } : {}) };
  }

  private static availabilityCheck(
    counts: Partial<Record<MicrosoftEntraIdLog, string>>,
    premiumMissing: boolean,
  ): SecurityConnectorCheck {
    const signIns: string = counts.signIns || "0";
    const audits: string = counts.directoryAudits || "0";
    const risks: string = counts.riskDetections || "0";
    const nothing: boolean = signIns === "0" && audits === "0";
    const parts: Array<string> = [
      ...(premiumMissing
        ? []
        : [`${signIns} sign-in${signIns === "1" ? "" : "s"}`]),
      `${audits} directory change${audits === "1" ? "" : "s"}`,
      ...(risks !== "0"
        ? [`${risks} risk detection${risks === "1" ? "" : "s"}`]
        : []),
    ];

    return makeCheck({
      key: AVAILABILITY_CHECK.key,
      name: AVAILABILITY_CHECK.name,
      status: nothing ? "warn" : "pass",
      startedAtMs: Date.now(),
      message: nothing
        ? "No sign-ins or directory changes in the last 24 hours. Polling imports new ones as Microsoft Entra ID records them."
        : `${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]} in the last 24 hours.`,
      ...(nothing
        ? {
            remediation:
              "A tenant people sign in to every day has sign-ins every day, so an empty day usually means the Directory (tenant) ID names a test tenant. Check it against the tenant's Overview page in the Microsoft Entra admin center.",
          }
        : {}),
      details: {
        signInsLast24h: signIns,
        directoryChangesLast24h: audits,
        ...(counts.riskDetections !== undefined
          ? { riskDetectionsLast24h: risks }
          : {}),
      },
    });
  }

  /*
   * Identity Protection's risk detections over the last day: a warning, not
   * a failure, when they cannot be read - the sign-ins and directory
   * changes still are - saying what the app or the tenant lacks.
   */
  private static async riskDetectionsCheck(data: {
    client: MicrosoftEntraIdClient;
    cloud: MicrosoftEntraIdCloud;
    startTime: Date;
    endTime: Date;
    probeSize: number;
    counts: Partial<Record<MicrosoftEntraIdLog, string>>;
  }): Promise<SecurityConnectorCheck> {
    const check: { key: string; name: string; noun: string } =
      GRAPH_LOGS.riskDetections;
    const startedAtMs: number = Date.now();

    try {
      const page: MicrosoftEntraIdPage = await data.client.listLog({
        log: "riskDetections",
        startTime: data.startTime,
        endTime: data.endTime,
        pageSize: data.probeSize,
      });

      data.counts.riskDetections = page.nextLink
        ? `${page.records.length}+`
        : String(page.records.length);

      return makeCheck({
        key: check.key,
        name: check.name,
        status: "pass",
        startedAtMs,
        message:
          page.records.length > 0
            ? `Microsoft Graph returned Identity Protection's risk detections: ${data.counts.riskDetections} in the last 24 hours.`
            : "Microsoft Graph accepted a read of Identity Protection's risk detections. There were none in the last 24 hours.",
      });
    } catch (error) {
      return makeCheck({
        key: check.key,
        name: check.name,
        status: "warn",
        startedAtMs,
        message: `${MicrosoftEntraIdConnector.errorMessage(error)} Sign-ins and directory changes are still imported.`,
        remediation: MicrosoftEntraIdConnector.graphRemediation(
          error,
          "riskDetections",
          data.cloud,
        ),
      });
    }
  }

  /*
   * One read of each background kind over the last day, under one check: a
   * warning when either cannot be read (Graph's beta list), naming which.
   */
  private static async backgroundSignInsCheck(data: {
    client: MicrosoftEntraIdClient;
    cloud: MicrosoftEntraIdCloud;
    startTime: Date;
    endTime: Date;
  }): Promise<SecurityConnectorCheck> {
    const startedAtMs: number = Date.now();
    const unread: Array<string> = [];
    let remediation: string = "";

    for (const log of BACKGROUND_SIGN_IN_LOGS) {
      try {
        await data.client.listLog({
          log,
          startTime: data.startTime,
          endTime: data.endTime,
          pageSize: 1,
        });
      } catch (error) {
        unread.push(
          `${GRAPH_LOGS[log].noun}: ${MicrosoftEntraIdConnector.errorMessage(error)}`,
        );
        remediation =
          remediation ||
          MicrosoftEntraIdConnector.graphRemediation(error, log, data.cloud);
      }
    }

    if (unread.length === 0) {
      return makeCheck({
        key: BACKGROUND_SIGN_INS_CHECK.key,
        name: BACKGROUND_SIGN_INS_CHECK.name,
        status: "pass",
        startedAtMs,
        message:
          "Microsoft Graph accepted a read of the sign-ins apps make for people in the background and of apps' own. The ones that fail are imported.",
      });
    }

    return makeCheck({
      key: BACKGROUND_SIGN_INS_CHECK.key,
      name: BACKGROUND_SIGN_INS_CHECK.name,
      status: "warn",
      startedAtMs,
      message: `Not read: ${unread.join("; ")}`,
      remediation,
    });
  }

  // The Microsoft 365 audit log's own check: its token and subscriptions.
  private static async microsoft365Check(
    client: MicrosoftEntraIdClient,
    cloud: MicrosoftEntraIdCloud,
  ): Promise<SecurityConnectorCheck> {
    const startedAtMs: number = Date.now();

    try {
      const subscriptions: Array<Microsoft365Subscription> =
        await client.listSubscriptions();
      const enabled: Array<string> = MICROSOFT_365_CONTENT_TYPES.filter(
        (contentType: string): boolean => {
          return MicrosoftEntraIdConnector.isEnabled(
            subscriptions,
            contentType,
          );
        },
      );
      const notYet: Array<string> = MICROSOFT_365_CONTENT_TYPES.filter(
        (contentType: string): boolean => {
          return !enabled.includes(contentType);
        },
      );

      return makeCheck({
        key: MICROSOFT_365_CHECK.key,
        name: MICROSOFT_365_CHECK.name,
        status: "pass",
        startedAtMs,
        message:
          notYet.length === 0
            ? `The Office 365 Management API answered, and this app reads ${enabled.join(", ")}.`
            : `The Office 365 Management API answered. The first poll subscribes this app to ${notYet.join(", ")}; ${MICROSOFT_365_FIRST_CONTENT_NOTE}`,
        details: { subscribed: enabled.join(", ") },
      });
    } catch (error) {
      return makeCheck({
        key: MICROSOFT_365_CHECK.key,
        name: MICROSOFT_365_CHECK.name,
        status: "fail",
        startedAtMs,
        message: MicrosoftEntraIdConnector.errorMessage(error),
        remediation: MicrosoftEntraIdConnector.microsoft365Remediation(
          error,
          cloud,
        ),
      });
    }
  }

  /*
   * Read every record created in the window, pass by pass, within each
   * pass's budget. A pass over the connection's own records (directory
   * changes, sign-ins) that fails for any reason but a missing sign-in
   * license throws, with the checks of the passes that ran; the passes that
   * add to them never do.
   */
  public async fetchEvents(
    settings: SecurityConnectorSettings,
    window: ConnectorFetchWindow,
    options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult> {
    const parsed: ParsedSettings =
      MicrosoftEntraIdConnector.parseSettings(settings);
    const definition: SecurityEventConnectorDefinition =
      MicrosoftEntraIdConnector.getDefinition();
    const client: MicrosoftEntraIdClient = this.buildClient(
      parsed,
      options.requestTimeoutInMs,
    );
    const run: FetchRun = {
      startedMs: Date.now(),
      maxDurationMs: MicrosoftEntraIdConnector.readBound(
        options.maxDurationMs,
        MICROSOFT_ENTRA_ID_FETCH_DURATION_MS,
      ),
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
      checks: [],
      details: {},
    };
    const budgets: Partial<Record<EntraPass, PassBudget>> =
      MicrosoftEntraIdConnector.splitBudget(options, {
        includeBackgroundSignIns: parsed.includeBackgroundSignIns,
        includeMicrosoft365: parsed.includeMicrosoft365,
      });

    let phaseKey: string = GRAPH_LOGS.directoryAudits.key;
    let phaseName: string = GRAPH_LOGS.directoryAudits.name;
    let phaseStartedMs: number = Date.now();

    try {
      for (const log of CORE_LOGS) {
        phaseKey = GRAPH_LOGS[log].key;
        phaseName = GRAPH_LOGS[log].name;
        phaseStartedMs = Date.now();
        await MicrosoftEntraIdConnector.graphPass({
          client,
          run,
          log,
          window,
          budget: budgets[log]!,
        });
      }
    } catch (error) {
      run.checks.push(
        makeCheck({
          key: phaseKey,
          name: phaseName,
          status: "fail",
          startedAtMs: phaseStartedMs,
          message: MicrosoftEntraIdConnector.errorMessage(error),
        }),
      );

      throw attachConnectorFetchSummary(
        attachConnectorChecks(error, [...run.checks]),
        {
          warnings: [...run.warnings],
          requestCount: client.getRequestCount(),
          fetchedCount: run.fetchedCount,
          details: { ...run.details },
        },
      );
    }

    // The passes that add to the connection's own records, which never throw.
    await MicrosoftEntraIdConnector.additionalGraphPass({
      client,
      run,
      log: "riskDetections",
      cloud: parsed.cloud,
      window,
      budget: budgets.riskDetections!,
    });

    if (parsed.includeBackgroundSignIns) {
      for (const log of BACKGROUND_SIGN_IN_LOGS) {
        await MicrosoftEntraIdConnector.additionalGraphPass({
          client,
          run,
          log,
          cloud: parsed.cloud,
          window,
          budget: budgets[log]!,
        });
      }
    }

    if (parsed.includeMicrosoft365) {
      await MicrosoftEntraIdConnector.microsoft365Pass({
        client,
        run,
        cloud: parsed.cloud,
        window,
        budget: budgets.microsoft365!,
      });
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
      checks: run.checks,
      details: run.details,
    };
  }

  /*
   * Each pass's share of the fetch's bounds, for the passes these options
   * make. The fetch budget is the sum of the passes' own; a smaller bound (a
   * test's) shrinks every pass alike.
   */
  public static splitBudget(
    options: ConnectorFetchOptions,
    flags: {
      includeBackgroundSignIns: boolean;
      includeMicrosoft365: boolean;
    },
  ): Partial<Record<EntraPass, PassBudget>> {
    const passes: Array<EntraPass> =
      MicrosoftEntraIdConnector.plannedPasses(flags);
    const plannedRequests: number =
      MicrosoftEntraIdConnector.plannedRequests(passes);
    const plannedRecords: number =
      MicrosoftEntraIdConnector.plannedRecords(passes);
    const requestScale: number = Math.min(
      1,
      Math.max(0, Math.floor(options.maxRequests)) / plannedRequests,
    );
    const recordScale: number = Math.min(
      1,
      Math.max(0, Math.floor(options.maxEvents)) / plannedRecords,
    );
    const share: (planned: number, scale: number) => number = (
      planned: number,
      scale: number,
    ): number => {
      return Math.max(1, Math.floor(planned * scale));
    };
    const budgets: Partial<Record<EntraPass, PassBudget>> = {};

    for (const pass of passes) {
      budgets[pass] =
        pass === "microsoft365"
          ? {
              maxRequests: share(MICROSOFT_365_REQUEST_BUDGET, requestScale),
              maxRecords: share(MICROSOFT_365_RECORD_BUDGET, recordScale),
            }
          : {
              maxRequests: share(GRAPH_PAGE_BUDGETS[pass], requestScale),
              maxRecords: share(
                GRAPH_PAGE_BUDGETS[pass] * MICROSOFT_ENTRA_ID_PAGE_SIZE,
                recordScale,
              ),
            };
    }

    return budgets;
  }

  /*
   * A Graph pass that adds to the connection's own records - risk
   * detections, background and app sign-ins. It never throws: a failure the
   * same window would answer again (throttling, Graph's own errors, no
   * answer) leaves the window to be read again; any other (a permission or a
   * licence the tenant lacks, the beta list refusing a filter) is a warning,
   * under the pass's own name, with what to change.
   */
  private static async additionalGraphPass(data: {
    client: MicrosoftEntraIdClient;
    run: FetchRun;
    log: MicrosoftEntraIdLog;
    cloud: MicrosoftEntraIdCloud;
    window: ConnectorFetchWindow;
    budget: PassBudget;
  }): Promise<void> {
    const startedAtMs: number = Date.now();
    const check: { key: string; name: string; noun: string } =
      GRAPH_LOGS[data.log];

    try {
      await MicrosoftEntraIdConnector.graphPass(data);
    } catch (error) {
      const transient: boolean = MicrosoftEntraIdConnector.isTransient(error);
      const message: string = MicrosoftEntraIdConnector.errorMessage(error);

      if (transient) {
        data.run.complete = false;
      }

      data.run.details[`${data.log}Unavailable`] = transient
        ? "transient-failure"
        : MicrosoftEntraIdConnector.isPremiumRequired(error)
          ? "premium-license-required"
          : "refused";
      data.run.warnings.push(
        `${check.noun.charAt(0).toUpperCase()}${check.noun.slice(1)} were not read: ${message}${transient ? " The window is read again on the next poll." : " The connection's other records were still read."}`,
      );
      data.run.checks.push(
        makeCheck({
          key: check.key,
          name: check.name,
          status: "warn",
          startedAtMs,
          message,
          remediation: MicrosoftEntraIdConnector.graphRemediation(
            error,
            data.log,
            data.cloud,
          ),
        }),
      );
    }
  }

  // One Graph log over the window, page by page, within its budget.
  private static async graphPass(data: {
    client: MicrosoftEntraIdClient;
    run: FetchRun;
    log: MicrosoftEntraIdLog;
    window: ConnectorFetchWindow;
    budget: PassBudget;
  }): Promise<void> {
    const { client, run, log, window, budget } = data;
    const check: { key: string; name: string; noun: string } = GRAPH_LOGS[log];
    const startedAtMs: number = Date.now();
    const outcome: GraphPassOutcome = {
      returned: 0,
      pages: 0,
      stoppedBy: "end",
    };
    let nextLink: string | null = null;

    for (;;) {
      if (outcome.pages >= budget.maxRequests) {
        outcome.stoppedBy = "requests";
        break;
      }

      if (MicrosoftEntraIdConnector.outOfTime(run)) {
        outcome.stoppedBy = "time";
        break;
      }

      let page: MicrosoftEntraIdPage;

      try {
        page = nextLink
          ? await client.listLogByNextLink(log, nextLink)
          : await client.listLog({
              log,
              startTime: window.startTime,
              endTime: window.endTime,
              pageSize: Math.min(
                MICROSOFT_ENTRA_ID_PAGE_SIZE,
                budget.maxRecords,
              ),
            });
      } catch (error) {
        if (
          log === "signIns" &&
          outcome.pages === 0 &&
          MicrosoftEntraIdConnector.isPremiumRequired(error)
        ) {
          run.details["signInsUnavailable"] = "premium-license-required";
          run.warnings.push(
            "Sign-ins were not read: this tenant has no Microsoft Entra ID P1 or P2 license, and Microsoft Graph gives out sign-ins only to tenants that do. Directory changes were still read.",
          );
          run.checks.push(
            makeCheck({
              key: check.key,
              name: check.name,
              status: "warn",
              startedAtMs,
              message:
                "Sign-ins need Microsoft Entra ID P1 or P2, which this tenant does not have.",
              remediation:
                "Sign-ins are imported from the first poll after the tenant has Microsoft Entra ID P1 or P2 (included in Microsoft 365 E3 and E5, and Business Premium).",
            }),
          );
          return;
        }

        throw error;
      }

      outcome.pages++;

      let reachedRecordBound: boolean = false;

      for (const record of page.records) {
        if (outcome.returned >= budget.maxRecords) {
          reachedRecordBound = true;
          break;
        }

        outcome.returned++;
        MicrosoftEntraIdConnector.collectGraphRecord(run, log, record);
      }

      if (reachedRecordBound) {
        outcome.stoppedBy = "records";
        break;
      }

      if (!page.nextLink || page.records.length === 0) {
        break;
      }

      nextLink = page.nextLink;
    }

    run.details[log] = outcome.returned;

    if (outcome.stoppedBy !== "end") {
      run.complete = false;
      run.warnings.push(
        `Stopped reading ${check.noun} after ${outcome.returned} records in ${outcome.pages} page${outcome.pages === 1 ? "" : "s"} (${MicrosoftEntraIdConnector.stopReason(outcome.stoppedBy)}) before reading the whole window. ${UNORDERED_READ_NOTE}`,
      );
    }

    run.checks.push(
      makeCheck({
        key: check.key,
        name: check.name,
        status: outcome.stoppedBy === "end" ? "pass" : "warn",
        startedAtMs,
        message: `${outcome.returned} ${check.noun} returned for the window${outcome.stoppedBy === "end" ? "" : `; the read stopped at ${MicrosoftEntraIdConnector.stopReason(outcome.stoppedBy)}`}.`,
      }),
    );
  }

  // Whether a record is one the log lists.
  public static isGraphRecord(
    log: MicrosoftEntraIdLog,
    record: JSONObject,
  ): boolean {
    switch (log) {
      case "directoryAudits":
        return isEntraDirectoryAudit(record);
      case "riskDetections":
        return isEntraRiskDetection(record);
      default:
        return isEntraSignIn(record);
    }
  }

  /*
   * A log's record as a reading, or null for one the connection reads but
   * does not keep: a risk dismissed or remediated already, a background or
   * an app sign-in that worked.
   */
  public static readGraphRecord(
    log: MicrosoftEntraIdLog,
    record: JSONObject,
  ): SecurityRecordReading | null {
    switch (log) {
      case "signIns":
        return readEntraSignIn(record, EntraLog.SignInLogs);
      case "directoryAudits":
        return readEntraDirectoryAudit(record);
      case "riskDetections":
        return readEntraRisk(record, EntraLog.UserRiskEvents);
      case "nonInteractiveSignIns":
        return readEntraBackgroundSignIn(
          record,
          EntraLog.NonInteractiveUserSignInLogs,
        );
      case "servicePrincipalSignIns":
        return readEntraBackgroundSignIn(
          record,
          EntraLog.ServicePrincipalSignInLogs,
        );
    }
  }

  private static collectGraphRecord(
    run: FetchRun,
    log: MicrosoftEntraIdLog,
    record: JSONObject,
  ): void {
    if (!MicrosoftEntraIdConnector.isGraphRecord(log, record)) {
      run.fetchedCount++;
      run.rejectedCount++;
      return;
    }

    let reading: SecurityRecordReading | null;

    try {
      reading = MicrosoftEntraIdConnector.readGraphRecord(log, record);
    } catch (error) {
      run.fetchedCount++;
      MicrosoftEntraIdConnector.recordFailure(run, record, error);
      return;
    }

    // Read, and left out on purpose: counted nowhere, as a sign-out is.
    if (!reading) {
      return;
    }

    MicrosoftEntraIdConnector.addReading(run, reading, record, {
      createdTime: String(record[GRAPH_CREATED_FIELDS[log]] || ""),
    });
  }

  /*
   * A reading as an event, unless this fetch already has it: Graph pages
   * newest first, so a record created mid-read can shift one onto the next
   * page.
   */
  private static addReading(
    run: FetchRun,
    reading: SecurityRecordReading,
    raw: JSONObject,
    sample: { createdTime: string },
  ): boolean {
    let event: NormalizedSecurityEvent;

    try {
      event = toNormalizedSecurityEvent({
        reading,
        vendorName: run.vendorName,
        productName: run.productName,
        raw,
      });
    } catch (error) {
      run.fetchedCount++;
      MicrosoftEntraIdConnector.recordFailure(run, raw, error);
      return false;
    }

    if (run.seen.has(event.eventUid)) {
      return false;
    }

    run.seen.add(event.eventUid);
    run.fetchedCount++;
    run.events.push(event);

    if (run.samples.length < run.sampleLimit) {
      run.samples.push({
        id: event.eventUid,
        title: event.message,
        severity: event.severityName,
        ...(sample.createdTime ? { createdTime: sample.createdTime } : {}),
        eventTime: event.time.toISOString(),
      });
    }

    return true;
  }

  private static recordFailure(
    run: FetchRun,
    raw: JSONObject,
    error: unknown,
  ): void {
    run.failedCount++;

    if (run.failedCount <= MAX_NORMALIZATION_WARNINGS) {
      run.warnings.push(
        `Record ${redactLogString(String(raw["id"] || raw["Id"] || "(no id)"))} could not be normalized: ${redactLogString(ConnectorErrorMessage.toMessage(error))}`,
      );
    }
  }

  /*
   * The Microsoft 365 audit log over the window: its subscriptions, then
   * every content blob Microsoft made available in it, a day at a time.
   */
  private static async microsoft365Pass(data: {
    client: MicrosoftEntraIdClient;
    run: FetchRun;
    cloud: MicrosoftEntraIdCloud;
    window: ConnectorFetchWindow;
    budget: PassBudget;
  }): Promise<void> {
    const { client, run, window, budget } = data;
    const startedAtMs: number = Date.now();
    const outcome: Microsoft365PassOutcome = {
      contentBlobs: 0,
      recordsRead: 0,
      recordsImported: 0,
      stoppedBy: "end",
      subscriptionsStarted: [],
      unreadable: [],
      transientFailure: false,
    };
    let requests: number = 0;
    let failure: unknown = null;

    const spend: () => PassStop | null = (): PassStop | null => {
      if (requests >= budget.maxRequests) {
        return "requests";
      }

      if (MicrosoftEntraIdConnector.outOfTime(run)) {
        return "time";
      }

      requests++;
      return null;
    };

    const now: number = Date.now();
    const oldest: number =
      now - MICROSOFT_365_MAX_AGE_IN_MS + MICROSOFT_365_AGE_MARGIN_IN_MS;
    const start: number = Math.max(window.startTime.getTime(), oldest);
    const end: number = Math.min(window.endTime.getTime(), now);

    if (window.startTime.getTime() < oldest) {
      run.warnings.push(
        `The Microsoft 365 audit log keeps content for 7 days, so the part of the window before ${new Date(oldest).toISOString()} was not read from it.`,
      );
    }

    try {
      let stop: PassStop | null = spend();

      if (stop) {
        outcome.stoppedBy = stop;
      } else {
        const subscriptions: Array<Microsoft365Subscription> =
          await client.listSubscriptions();
        const readable: Array<string> = [];

        for (const contentType of MICROSOFT_365_CONTENT_TYPES) {
          if (MicrosoftEntraIdConnector.isEnabled(subscriptions, contentType)) {
            readable.push(contentType);
            continue;
          }

          stop = spend();

          if (stop) {
            outcome.stoppedBy = stop;
            break;
          }

          try {
            await client.startSubscription(contentType);
            outcome.subscriptionsStarted.push(contentType);
            readable.push(contentType);
          } catch (error) {
            if (MicrosoftEntraIdConnector.isTransient(error)) {
              throw error;
            }

            outcome.unreadable.push(
              `${contentType}: ${MicrosoftEntraIdConnector.errorMessage(error)}`,
            );
          }
        }

        for (const contentType of readable) {
          if (outcome.stoppedBy !== "end" || start >= end) {
            break;
          }

          for (
            let chunkStart: number = start;
            chunkStart < end && outcome.stoppedBy === "end";
            chunkStart += MICROSOFT_365_MAX_LIST_WINDOW_IN_MS
          ) {
            const chunkEnd: number = Math.min(
              end,
              chunkStart + MICROSOFT_365_MAX_LIST_WINDOW_IN_MS,
            );
            let nextPageUri: string | null = null;
            let first: boolean = true;

            while (first || nextPageUri) {
              stop = spend();

              if (stop) {
                outcome.stoppedBy = stop;
                break;
              }

              const page: Microsoft365ContentPage = first
                ? await client.listContent({
                    contentType,
                    startTime: new Date(chunkStart),
                    endTime: new Date(chunkEnd),
                  })
                : await client.listContentByNextPage(nextPageUri!);
              first = false;
              nextPageUri = page.nextPageUri;

              for (const content of page.contents) {
                stop = spend();

                if (stop) {
                  outcome.stoppedBy = stop;
                  break;
                }

                const records: Array<JSONObject> = await client.fetchContent(
                  content.contentUri,
                );
                outcome.contentBlobs++;

                if (
                  !MicrosoftEntraIdConnector.collectMicrosoft365Records({
                    run,
                    outcome,
                    content,
                    records,
                    maxRecords: budget.maxRecords,
                  })
                ) {
                  outcome.stoppedBy = "records";
                  break;
                }
              }

              if (outcome.stoppedBy !== "end") {
                break;
              }
            }
          }
        }
      }
    } catch (error) {
      failure = error;
      outcome.transientFailure = MicrosoftEntraIdConnector.isTransient(error);
    }

    run.details["microsoft365"] = {
      contentBlobs: outcome.contentBlobs,
      recordsRead: outcome.recordsRead,
      recordsImported: outcome.recordsImported,
      requests,
      ...(outcome.subscriptionsStarted.length > 0
        ? { subscriptionsStarted: outcome.subscriptionsStarted.join(", ") }
        : {}),
    };

    const notes: Array<string> = [];

    if (outcome.subscriptionsStarted.length > 0) {
      notes.push(
        `Subscribed to ${outcome.subscriptionsStarted.join(", ")} on this run. ${MICROSOFT_365_FIRST_CONTENT_NOTE}`,
      );
    }

    for (const unreadable of outcome.unreadable) {
      run.warnings.push(
        `A Microsoft 365 content type could not be subscribed to and was not read. ${unreadable}`,
      );
    }

    if (failure) {
      const message: string = MicrosoftEntraIdConnector.errorMessage(failure);

      if (outcome.transientFailure) {
        run.complete = false;
      }

      run.warnings.push(
        `The Microsoft 365 audit log was not read to the end of the window: ${message}${outcome.transientFailure ? " The window is read again on the next poll." : ""}`,
      );
      run.checks.push(
        makeCheck({
          key: MICROSOFT_365_CHECK.key,
          name: MICROSOFT_365_CHECK.name,
          status: "warn",
          startedAtMs,
          message,
          remediation: MicrosoftEntraIdConnector.microsoft365Remediation(
            failure,
            data.cloud,
          ),
        }),
      );
      return;
    }

    if (outcome.stoppedBy !== "end") {
      run.complete = false;
      run.warnings.push(
        `Stopped reading the Microsoft 365 audit log after ${outcome.contentBlobs} content blob${outcome.contentBlobs === 1 ? "" : "s"} (${MicrosoftEntraIdConnector.stopReason(outcome.stoppedBy)}) before reading the whole window.`,
      );
    }

    run.checks.push(
      makeCheck({
        key: MICROSOFT_365_CHECK.key,
        name: MICROSOFT_365_CHECK.name,
        status:
          outcome.stoppedBy !== "end" || outcome.unreadable.length > 0
            ? "warn"
            : "pass",
        startedAtMs,
        message: `${outcome.recordsImported} of ${outcome.recordsRead} audit records in ${outcome.contentBlobs} content blob${outcome.contentBlobs === 1 ? "" : "s"} are activity a security team acts on.${notes.length > 0 ? ` ${notes.join(" ")}` : ""}`,
        ...(outcome.unreadable.length > 0
          ? {
              remediation: MicrosoftEntraIdConnector.microsoft365Remediation(
                null,
                data.cloud,
              ),
            }
          : {}),
      }),
    );
  }

  /*
   * One content blob's records: the kinds a security team acts on become
   * events, the rest are only counted. False once the record bound is hit.
   */
  private static collectMicrosoft365Records(data: {
    run: FetchRun;
    outcome: Microsoft365PassOutcome;
    content: Microsoft365Content;
    records: Array<JSONObject>;
    maxRecords: number;
  }): boolean {
    const { run, outcome, content, records, maxRecords } = data;

    for (const record of records) {
      outcome.recordsRead++;

      let reading: SecurityRecordReading | null;

      try {
        reading = readMicrosoft365Record(record, content.contentType);
      } catch (error) {
        run.fetchedCount++;
        MicrosoftEntraIdConnector.recordFailure(run, record, error);
        continue;
      }

      if (!reading) {
        continue;
      }

      if (outcome.recordsImported >= maxRecords) {
        return false;
      }

      if (
        MicrosoftEntraIdConnector.addReading(run, reading, record, {
          createdTime: content.contentCreated,
        })
      ) {
        outcome.recordsImported++;
      }
    }

    return true;
  }

  private static isEnabled(
    subscriptions: Array<Microsoft365Subscription>,
    contentType: string,
  ): boolean {
    return subscriptions.some(
      (subscription: Microsoft365Subscription): boolean => {
        return (
          subscription.contentType.toLowerCase() ===
            contentType.toLowerCase() &&
          subscription.status.toLowerCase() === "enabled"
        );
      },
    );
  }

  /*
   * A failure that reading the window again may not repeat: throttling,
   * Microsoft's own errors, a request that never completed.
   */
  public static isTransient(error: unknown): boolean {
    if (error instanceof MicrosoftEntraIdHttpError) {
      return (
        error.statusCode === 429 ||
        error.statusCode >= 500 ||
        error.apiCode === "AF50000" ||
        error.apiCode === "AF429"
      );
    }

    return true;
  }

  public static isPremiumRequired(error: unknown): boolean {
    return (
      error instanceof MicrosoftEntraIdHttpError &&
      error.statusCode === 403 &&
      error.apiCode === ENTRA_PREMIUM_REQUIRED_CODE
    );
  }

  private static outOfTime(run: FetchRun): boolean {
    return Date.now() - run.startedMs >= run.maxDurationMs;
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

  private static readBound(
    value: number | undefined,
    fallback: number,
  ): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : fallback;
  }

  private static toTestSample(
    log: MicrosoftEntraIdLog,
    record: JSONObject,
  ): SecurityConnectorSample | null {
    try {
      const reading: SecurityRecordReading | null =
        MicrosoftEntraIdConnector.readGraphRecord(log, record);

      if (!reading) {
        return null;
      }

      const definition: SecurityEventConnectorDefinition =
        MicrosoftEntraIdConnector.getDefinition();
      const event: NormalizedSecurityEvent = toNormalizedSecurityEvent({
        reading,
        vendorName: definition.vendorName,
        productName: definition.productName,
        raw: record,
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
   * The record a read check quotes. A record the normalizer cannot read
   * must not turn a successful read into a failed check, so this never
   * throws.
   */
  private static describe(
    log: MicrosoftEntraIdLog,
    record: JSONObject,
  ): string {
    try {
      const reading: SecurityRecordReading | null =
        MicrosoftEntraIdConnector.readGraphRecord(log, record);

      return reading
        ? redactLogString(reading.message).slice(0, 300)
        : "a record the connection reads but does not import";
    } catch {
      return "a record the connector could not read";
    }
  }

  // The cloud as a test's message names it.
  public static cloudLabel(cloud: MicrosoftEntraIdCloud): string {
    switch (cloud) {
      case "gcc":
        return "Azure public (Microsoft 365 GCC)";
      case "usgov":
        return "Azure Government (GCC High)";
      case "dod":
        return "Azure Government (DoD)";
      default:
        return "Azure public";
    }
  }

  // The host part of an address: "https://graph.microsoft.us" -> "graph.microsoft.us".
  private static hostOf(address: string): string {
    return new URL(address).host;
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

  private static tokenRemediation(): string {
    return "Check the Directory (tenant) ID, Application (client) ID and Cloud against the app registration's Overview page, and that the Client secret has not expired (Certificates & secrets). Rotate the secret with Update credentials if needed.";
  }

  public static graphRemediation(
    error: unknown,
    log: MicrosoftEntraIdLog,
    cloud: MicrosoftEntraIdCloud,
  ): string {
    const status: number | null =
      error instanceof MicrosoftEntraIdHttpError ? error.statusCode : null;

    if (MicrosoftEntraIdConnector.isPremiumRequired(error)) {
      return log === "riskDetections"
        ? "Identity Protection's risk detections need Microsoft Entra ID P1 or P2 (included in Microsoft 365 E3 and E5, and Business Premium); P2 gives every detection's details. They are imported from the first poll after the tenant has it."
        : "Sign-ins need Microsoft Entra ID P1 or P2 (included in Microsoft 365 E3 and E5, and Business Premium). They are imported from the first poll after the tenant has it.";
    }

    if (status === 403) {
      if (log === "riskDetections") {
        return "In the app registration, add the Microsoft Graph application permission IdentityRiskEvent.Read.All and select Grant admin consent. Identity Protection's risk detections also need Microsoft Entra ID P1 or P2. Consent takes a few minutes to apply.";
      }

      return log === "directoryAudits"
        ? "In the app registration, add the Microsoft Graph application permission AuditLog.Read.All and select Grant admin consent. Consent takes a few minutes to apply."
        : "In the app registration, add the Microsoft Graph application permission AuditLog.Read.All and select Grant admin consent. If it is granted and sign-ins still answer 403, also grant Directory.Read.All: Microsoft documents that its sign-in list can ask for both. Consent takes a few minutes to apply.";
    }

    // Graph's beta list refusing what it was asked (a filter it changed).
    if (
      status === 400 &&
      (log === "nonInteractiveSignIns" || log === "servicePrincipalSignIns")
    ) {
      return "Microsoft Graph's beta sign-in list refused the request. Turn the Background and app sign-ins option off until it accepts it again; the connection's other records are still read.";
    }

    if (status === 401) {
      return "Microsoft Graph refused the token. Check that the Cloud setting matches the tenant's cloud and that the app registration is enabled.";
    }

    if (status === 429) {
      return "Microsoft Graph is throttling this app. Wait a few minutes and test again; scheduled polls retry on their own.";
    }

    if (status !== null && status >= 500) {
      return "Microsoft Graph failed on its side. Test again in a few minutes; if it persists, check the Microsoft 365 service health page.";
    }

    return `OneUptime could not get an answer from Microsoft Graph. Check that the OneUptime API and worker processes can reach ${MicrosoftEntraIdConnector.hostOf(MicrosoftEntraIdClient.hostsFor(cloud).graphHost)}.`;
  }

  public static microsoft365Remediation(
    error: unknown,
    cloud: MicrosoftEntraIdCloud,
  ): string {
    const status: number | null =
      error instanceof MicrosoftEntraIdHttpError ? error.statusCode : null;
    const apiCode: string =
      error instanceof MicrosoftEntraIdHttpError ? error.apiCode : "";

    if (
      apiCode === "AF20010" ||
      apiCode === "AF20011" ||
      apiCode === "AF20012" ||
      apiCode === "AF20013"
    ) {
      return "The Office 365 Management API does not know this tenant by the Directory (tenant) ID given. Copy the tenant's GUID from the Overview page in the Microsoft Entra admin center.";
    }

    if (status === 401 || status === 403 || apiCode === "AF10001") {
      return "In the app registration, add the Office 365 Management APIs application permission ActivityFeed.Read (API permissions > Add a permission > Office 365 Management APIs) and select Grant admin consent.";
    }

    if (status === 429 || apiCode === "AF429") {
      return "The Office 365 Management API is throttling this app. Polls read the window again on their own.";
    }

    if (status !== null && status >= 500) {
      return "The Office 365 Management API failed on its side. Polls read the window again on their own; if it persists, check the Microsoft 365 service health page.";
    }

    return `Check that auditing is on for the tenant (Microsoft Purview portal > Audit: Start recording user and admin activity), that no administrator turned off this app's subscription, that the Cloud setting is the tenant's Microsoft 365 plan, and that the OneUptime worker processes can reach ${MicrosoftEntraIdConnector.hostOf(MicrosoftEntraIdClient.hostsFor(cloud).manageHost)}.`;
  }
}
