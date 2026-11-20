import {
  CLOUD_APP_SIGNAL_COLUMNS,
  CloudAppSignalColumn,
  CloudAppTelemetrySignal,
} from "Common/Types/Cloud/CloudAppTelemetrySignal";
import {
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
  getManagedCloudPlatformDescriptor,
} from "Common/Types/Cloud/CloudPlatform";
import {
  AppServiceSiteActivity,
  AppServiceSiteDeployment,
  AppServiceSiteInstance,
  getAppServiceCurrentDeployment,
  getAppServiceRunningInstances,
} from "Common/Types/Cloud/AppServiceSiteActivity";
import { parseAzureResourceId } from "Common/Types/Cloud/CloudMonitoredResource";
import OneUptimeDate from "Common/Types/Date";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  CloudAppAzureLink,
  CloudAppAzureMonitorState,
  getAzureConnectionReadInterval,
  getAzureMonitorLatestReadingAt,
  getCloudAppAzureMonitorState,
} from "./CloudAppAzureLink";
import {
  CLOUD_APP_STATE_LABELS,
  CloudAppState,
  getCloudAppRevisionNoun,
} from "./CloudApps";
import {
  CLOUD_INSTANCE_LIVE_WINDOW_MINUTES,
  isCloudInstanceLive,
} from "./CloudResourceTelemetryScope";

/*
 * WHAT AN APP PLATFORMS APP SENDS, AND WHAT ITS PAGE CAN SHOW FROM IT
 * (issue #6770).
 *
 * An app's numbers come from different telemetry: its requests, error rate
 * and latency from its traces' entry spans, its instances from the instance
 * its resources name (service.instance.id, a task ARN, a replica), their CPU
 * and memory from container metrics, its revision from service.version or
 * the platform's own attribute. An App Service app that sent only metrics,
 * with no instance and no version in them, read "Running", "0 requests",
 * "0 instances" and "No revision reported yet", with nothing to say that
 * the zeros were never measured.
 *
 * The ingest now marks when each kind last arrived for the app
 * (CloudAppTelemetrySignal), and this file turns that into what the page
 * says: a tile's note in place of a number it cannot have ("No traces
 * received", "Not reported", "Not on Azure App Service"), and the Setup
 * check's rows - each kind and attribute with its state and, for what is
 * missing, what to add. React-free, so every answer is tested without a
 * renderer, in any language.
 */

// What a tile says in place of a number it was never sent.
export const CLOUD_APP_NO_TRACES_NOTE: string =
  translationKey("No traces received");
export const CLOUD_APP_NOT_REPORTED_NOTE: string =
  translationKey("Not reported");
export const CLOUD_APP_NOT_ON_PLATFORM_NOTE: string = translationKey(
  "Not on {{platform}}",
);
// The line under a tile whose read failed: unknown, not zero.
export const CLOUD_APP_LOAD_FAILED_SUBLABEL: string =
  translationKey("could not load");
// What an empty chart says when its read failed.
export const CLOUD_APP_CHART_LOAD_FAILED: string = translationKey(
  "Something went wrong. Try again in a moment.",
);

// The Setup check's words.
export const CLOUD_APP_SETUP_TITLE: string = translationKey("Setup check");
export const CLOUD_APP_SETUP_DESCRIPTION: string = translationKey(
  "What arrives from this app, kind by kind, and what is not set up yet.",
);
export const CLOUD_APP_SETUP_GUIDE: string = translationKey("Setup guide");

// When a row's kind last came, or that it never did.
export const CLOUD_APP_ROW_LATEST: string = translationKey(
  "The latest came in {{time}}.",
);
export const CLOUD_APP_ROW_NONE_SINCE: string = translationKey(
  "None since {{date}}.",
);
export const CLOUD_APP_ROW_NONE_YET: string = translationKey("None yet.");
export const CLOUD_APP_ROW_NONE: string = translationKey("Not set up");
export const CLOUD_APP_ROW_REPORTED: string = translationKey("Reported");
export const CLOUD_APP_ROW_NOT_REPORTED: string =
  translationKey("Not reported");
// An app that is not running, as its state pill says it.
export const CLOUD_APP_ROW_NOT_REPORTING: string =
  CLOUD_APP_STATE_LABELS[CloudAppState.NotReporting];
export const CLOUD_APP_ROW_CHECKING: string = translationKey("Checking…");
export const CLOUD_APP_ROW_CONNECTED: string = translationKey("Connected");
export const CLOUD_APP_ROW_NOT_CONNECTED: string =
  translationKey("Not connected");

// The logs row's latest, and where it came from.
export const CLOUD_APP_LOGS_LATEST_FROM_APP: string = translationKey(
  "The latest came in {{time}}, from the app's OpenTelemetry.",
);
export const CLOUD_APP_LOGS_LATEST_FROM_AZURE: string = translationKey(
  "The latest came in {{time}}, from Azure's diagnostic settings.",
);

export const CLOUD_APP_ROW_LABELS: Readonly<Record<string, string>> = {
  azureMonitor: translationKey("Azure Monitor connection"),
  azureMonitorMetrics: translationKey("Azure Monitor metrics"),
  traces: translationKey("Traces"),
  metrics: translationKey("OpenTelemetry metrics"),
  logs: translationKey("Logs"),
  instances: translationKey("Instances"),
};

// Under a row whose kind or attribute is missing: what it gives, and how.
export const CLOUD_APP_TRACES_HINT: string = translationKey(
  "Requests, error rate and latency come from traces. Send them from the app with an OpenTelemetry SDK or auto-instrumentation.",
);
export const CLOUD_APP_SEND_WITH_OTEL_HINT: string = translationKey(
  "Send them with an OpenTelemetry SDK or the OpenTelemetry Collector.",
);
export const CLOUD_APP_SERVICE_LOGS_HINT: string = translationKey(
  "Send them with an OpenTelemetry SDK, or stream the App Service app's own logs: in Cloud > Connect, choose Stream metrics and logs in its subscription's row.",
);
export const CLOUD_APP_INSTANCES_HINT: string = translationKey(
  "The app's telemetry names no instance, so its instances can't be counted. Turn on its platform's resource detector, or set service.instance.id in its resource attributes.",
);
export const CLOUD_APP_REVISION_HINT: string = translationKey(
  "Set service.version in the app's resource attributes, and each deploy is marked on its charts and listed under Revisions.",
);

// The Azure Monitor connection's row (App Service), link by link (CloudAppAzureLink).
export const CLOUD_APP_AZURE_MONITOR_HINT: string = translationKey(
  "Connect the Azure subscription this app runs in, and Azure Monitor reports its requests, response time, CPU and memory, with no change to the app.",
);
export const CLOUD_APP_AZURE_MONITOR_CONNECTED_HINT: string = translationKey(
  "Its requests, response time, CPU and memory, as Azure measures them, are below.",
);
export const CLOUD_APP_AZURE_READ_BY: string = translationKey(
  "The connection {{connection}} reads {{site}} in subscription {{subscription}}.",
);
export const CLOUD_APP_AZURE_SITE_READ: string = translationKey(
  "OneUptime reads {{site}} in subscription {{subscription}}.",
);
export const CLOUD_APP_AZURE_NO_CONNECTION: string = translationKey(
  "No Azure subscription is connected yet.",
);
export const CLOUD_APP_AZURE_SUBSCRIPTION_NOT_READ: string = translationKey(
  "No Azure connection reads subscription {{subscription}}.",
);
export const CLOUD_APP_AZURE_SUBSCRIPTION_NOT_READ_HINT: string =
  translationKey(
    "Add it to an Azure connection's subscriptions, or give the connection's app the Monitoring Reader role on it.",
  );
export const CLOUD_APP_AZURE_NO_SUBSCRIPTION: string = translationKey(
  "Its telemetry names no Azure subscription, and no connected App Service app is named {{site}}.",
);
export const CLOUD_APP_AZURE_RESOURCE_ID_HINT: string = translationKey(
  "Add cloud.resource_id to its resource attributes: the App Service resource detector sets it.",
);
export const CLOUD_APP_AZURE_CONNECTION_OFF: string = translationKey(
  "The connection {{connection}} is turned off.",
);
export const CLOUD_APP_AZURE_CONNECTION_FAILING: string = translationKey(
  "The last read of the connection {{connection}} failed.",
);
export const CLOUD_APP_AZURE_FIRST_READ: string = translationKey(
  "The connection {{connection}} has not finished its first read.",
);
// As the connections list says it (CloudConnectionWords).
export const CLOUD_APP_AZURE_FIRST_READ_HINT: string = translationKey(
  "The first read starts within a minute of connecting, and can take a few minutes.",
);
export const CLOUD_APP_AZURE_SITE_NOT_FOUND: string = translationKey(
  "Subscription {{subscription}} is connected, but holds no App Service app named {{site}}.",
);
export const CLOUD_APP_AZURE_NO_SITES: string = translationKey(
  "Subscription {{subscription}} is connected, but OneUptime reads no App Service app in it yet.",
);
export const CLOUD_APP_AZURE_SITE_NAME_HINT: string = translationKey(
  "Name the app as its App Service app with service.name, or add cloud.resource_id to its resource attributes: the App Service resource detector sets both.",
);
export const CLOUD_APP_AZURE_SITE_ELSEWHERE: string = translationKey(
  "{{site}} is in subscription {{other}}, not in {{subscription}}, which its telemetry names.",
);
export const CLOUD_APP_AZURE_SITE_ELSEWHERE_HINT: string = translationKey(
  "Set cloud.account.id to the subscription the app runs in, or add cloud.resource_id: the App Service resource detector sets it.",
);
export const CLOUD_APP_AZURE_SLOT: string = translationKey(
  "It runs in deployment slot {{slot}}, which Azure Monitor reports as a resource of its own that OneUptime does not read yet.",
);

// The Azure Monitor metrics' row.
export const CLOUD_APP_AZURE_METRICS_NEXT_READ: string = translationKey(
  "None yet: they come with the connection's next read.",
);
export const CLOUD_APP_AZURE_METRICS_NEED_CONNECTION: string = translationKey(
  "They arrive once the Azure Monitor connection above works.",
);
export const CLOUD_APP_AZURE_METRICS_NOT_READ: string = translationKey(
  "OneUptime does not read them for this app.",
);

// What Azure says of the app's instances and deployments (AppServiceSiteActivity).
export const CLOUD_APP_AZURE_INSTANCES: PluralTemplate = {
  one: "Azure runs {{count}} instance.",
  other: "Azure runs {{count}} instances.",
};
export const CLOUD_APP_AZURE_INSTANCES_HINT: string = translationKey(
  "Its telemetry names none of them: set service.instance.id in its resource attributes, as the App Service resource detector does, to see each one's own numbers.",
);
export const CLOUD_APP_AZURE_DEPLOYMENT: string = translationKey(
  "Azure's latest deployment, {{deployment}}, finished {{time}}.",
);
export const CLOUD_APP_AZURE_IMAGE: string = translationKey(
  "Azure runs the image {{image}}.",
);

/*
 * What a row's action says. Not "Open connections": that key is a count of
 * a database's open connections, and its languages word it so.
 */
export const CLOUD_APP_OPEN_CONNECTIONS: string = translationKey(
  "See the cloud connections",
);
export const CLOUD_APP_SET_UP_TELEMETRY: string = translationKey(
  "Set up traces and logs",
);

/*
 * The platforms that give an app no CPU or memory of its own: no container
 * stats reach the app or a sidecar, so its CPU and Memory tiles can never
 * fill (each platform's setup guide says so). App Service's are in Azure
 * Monitor, which its page shows when the subscription is connected.
 */
export const CLOUD_APP_PLATFORMS_WITHOUT_USAGE: ReadonlySet<string> =
  new Set<string>([
    ManagedCloudPlatform.AzureAppService,
    ManagedCloudPlatform.GcpAppEngine,
    ManagedCloudPlatform.AwsAppRunner,
  ]);

// Within two days a date reads with its time; older, the day is enough.
const SINCE_WITH_TIME_MS: number = 2 * 24 * 60 * 60 * 1000;

export type CloudAppArrivalSignal =
  | CloudAppTelemetrySignal.Traces
  | CloudAppTelemetrySignal.Logs
  | CloudAppTelemetrySignal.Metrics;

// The subset of CloudApp this file reads.
export interface CloudAppArrivalSource {
  tracesLastReceivedAt?: Date | string | null | undefined;
  logsLastReceivedAt?: Date | string | null | undefined;
  metricsLastReceivedAt?: Date | string | null | undefined;
  signalArrivalsTrackedSince?: Date | string | null | undefined;
  createdAt?: Date | string | null | undefined;
}

export enum CloudAppArrivalState {
  // Arrived inside the live window an app counts as Running in.
  Arriving = "arriving",
  // Arrived once, not lately.
  Quiet = "quiet",
  // Nothing of the kind since the app's arrivals are kept.
  None = "none",
}

export interface CloudAppArrival {
  state: CloudAppArrivalState;
  // When the latest arrived; null when none has.
  latestAt: Date | null;
  /*
   * For None: since when nothing of the kind arrived - when this install
   * started keeping arrivals for the app, else when the app appeared. An
   * app that sent traces only before the upgrade is never said to have
   * sent none ever.
   */
  since: Date | null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function getCloudAppArrival(data: {
  app: CloudAppArrivalSource;
  signal: CloudAppArrivalSignal;
  now: Date;
}): CloudAppArrival {
  const column: CloudAppSignalColumn = CLOUD_APP_SIGNAL_COLUMNS[
    data.signal
  ] as CloudAppSignalColumn;
  const latestAt: Date | null = toDate(data.app[column]);

  if (!latestAt) {
    return {
      state: CloudAppArrivalState.None,
      latestAt: null,
      since:
        toDate(data.app.signalArrivalsTrackedSince) ||
        toDate(data.app.createdAt),
    };
  }

  return {
    state: isCloudInstanceLive(latestAt, data.now)
      ? CloudAppArrivalState.Arriving
      : CloudAppArrivalState.Quiet,
    latestAt,
    since: null,
  };
}

// Whether any trace has arrived from the app since its arrivals are kept.
export function hasCloudAppSentTraces(app: CloudAppArrivalSource): boolean {
  return toDate(app.tracesLastReceivedAt) !== null;
}

/*
 * What a trace tile - requests, error rate, p95 - says in place of its
 * number: nothing while its read is out or it has a number to show, and
 * "No traces received" when the range holds no request AND no trace has
 * arrived from the app at all - a zero it never measured. An app whose
 * traces arrive and that served nothing in the range reads 0, as before.
 * A failed read is not a note: the tile reads "—" over "could not load"
 * (CLOUD_APP_LOAD_FAILED_SUBLABEL), as a RUM application's do.
 */
export function getCloudAppTraceTileNote(data: {
  app: CloudAppArrivalSource;
  metrics: { total: number; failed?: boolean | undefined } | null;
}): string | undefined {
  if (!data.metrics || data.metrics.failed) {
    return undefined;
  }

  if (data.metrics.total <= 0 && !hasCloudAppSentTraces(data.app)) {
    return CLOUD_APP_NO_TRACES_NOTE;
  }

  return undefined;
}

/*
 * The same for an environment's trace tiles: "No traces received" when its
 * range holds no request and none of its apps has sent a trace
 * (`appsWithTraces` counts the apps whose tracesLastReceivedAt is set; null
 * while it is read, or when it could not be - then nothing is said).
 */
export function getCloudEnvironmentTraceTileNote(data: {
  appsWithTraces: number | null;
  metrics: { total: number; failed?: boolean | undefined } | null;
}): string | undefined {
  if (!data.metrics || data.metrics.failed || data.appsWithTraces === null) {
    return undefined;
  }

  if (data.metrics.total <= 0 && data.appsWithTraces <= 0) {
    return CLOUD_APP_NO_TRACES_NOTE;
  }

  return undefined;
}

/*
 * The app's platform, by the name its console uses ("Azure App Service"),
 * for a sentence that names it; the raw value for a platform OneUptime does
 * not know.
 */
export function getCloudAppPlatformName(
  cloudPlatform: string | null | undefined,
): string {
  const descriptor: ManagedCloudPlatformDescriptor | null =
    getManagedCloudPlatformDescriptor(cloudPlatform || "");

  return descriptor ? descriptor.productName : cloudPlatform || "";
}

/*
 * What the CPU and Memory tiles say in place of their number:
 *
 *   - nothing when a live instance reports one: the number, whatever the
 *     platform;
 *   - "Not on Azure App Service" on a platform that gives an app no CPU or
 *     memory of its own (CLOUD_APP_PLATFORMS_WITHOUT_USAGE);
 *   - "Not reported" for an app that runs but whose live instances report
 *     none - or that names no instance at all;
 *   - nothing otherwise: a dash, for an app not running.
 */
export function getCloudAppUsageTileNote(data: {
  cloudPlatform: string | null | undefined;
  isRunning: boolean;
  hasReading: boolean;
  translator: Pick<Translator, "translateTemplate">;
}): string | undefined {
  if (data.hasReading) {
    return undefined;
  }

  if (
    data.cloudPlatform &&
    CLOUD_APP_PLATFORMS_WITHOUT_USAGE.has(data.cloudPlatform)
  ) {
    return data.translator.translateTemplate(CLOUD_APP_NOT_ON_PLATFORM_NOTE, {
      platform: getCloudAppPlatformName(data.cloudPlatform),
    });
  }

  if (data.isRunning) {
    return CLOUD_APP_NOT_REPORTED_NOTE;
  }

  return undefined;
}

/*
 * Whether the app's CPU and Memory tiles are shown. They give way only on a
 * platform that gives an app no CPU or memory of its own
 * (CLOUD_APP_PLATFORMS_WITHOUT_USAGE), once the platform's own section -
 * Azure Monitor's, for an App Service site - shows the site's CPU time and
 * memory below them: tiles that would only say "Not on Azure App Service"
 * above those numbers read as a contradiction. A tile with a number is
 * always shown.
 */
export function showsCloudAppUsageTiles(data: {
  cloudPlatform: string | null | undefined;
  hasCpuReading: boolean;
  hasMemoryReading: boolean;
  hasPlatformSection: boolean;
}): boolean {
  if (!data.hasPlatformSection || data.hasCpuReading || data.hasMemoryReading) {
    return true;
  }

  return !(
    data.cloudPlatform &&
    CLOUD_APP_PLATFORMS_WITHOUT_USAGE.has(data.cloudPlatform)
  );
}

/*
 * What the Instances tile says in place of its count: "Not reported" for an
 * app that runs and has never named an instance - its zero would read as
 * none running. An app not running reads 0.
 */
export function getCloudAppInstancesTileNote(data: {
  isRunning: boolean;
  hasReportedInstances: boolean;
}): string | undefined {
  return data.isRunning && !data.hasReportedInstances
    ? CLOUD_APP_NOT_REPORTED_NOTE
    : undefined;
}

/* ------------------------------------------------------------ Setup check */

/*
 * THE SETUP CHECK (#6770, #10294): one row per signal, so an app never
 * looks observable just because it runs. Before #10294 one Metrics row
 * stood for the app's own OpenTelemetry metrics and Azure Monitor's alike,
 * an App Service app's logs counted only when they came over OpenTelemetry,
 * and the card went away once traces, an instance and a version arrived,
 * however much else was missing. Now each signal has its row, in the order
 * the page reads them:
 *
 *   - Azure Monitor connection and Azure Monitor metrics (App Service): the
 *     chain from the app to its site's platform metrics (CloudAppAzureLink),
 *     and whether those metrics arrive;
 *   - Traces, OpenTelemetry metrics and Logs: what the app sends - its logs
 *     also when Azure's diagnostic settings stream its site's;
 *   - Instances and Revision: what its telemetry names, and else what Azure
 *     says (AppServiceSiteActivity).
 *
 * Each row is Received, Not received (it came, and stopped), Needs setup
 * (it never came, and a number on the page waits for it), Not set up (it
 * never came, and nothing waits for it), Checking or Not available - and,
 * for what is missing, what to do. The card shows while any row needs
 * something done (isCloudAppSetupIncomplete).
 */

export enum CloudAppSetupRowKey {
  AzureMonitor = "azure-monitor",
  AzureMonitorMetrics = "azure-monitor-metrics",
  Traces = "traces",
  Metrics = "metrics",
  Logs = "logs",
  Instances = "instances",
  Revision = "revision",
}

export enum CloudAppSetupStatus {
  Received = "received",
  // It came once, and not lately.
  NotReceived = "not-received",
  // It never came, and a number on the page waits for it.
  NeedsSetup = "needs-setup",
  // It never came, and nothing on the page waits for it.
  NotSetUp = "not-set-up",
  Checking = "checking",
  // OneUptime cannot say, or does not read it for this app.
  NotAvailable = "not-available",
}

export const CLOUD_APP_SETUP_STATUS_LABELS: Readonly<
  Record<CloudAppSetupStatus, string>
> = {
  [CloudAppSetupStatus.Received]: translationKey("Received"),
  [CloudAppSetupStatus.NotReceived]: translationKey("Not received"),
  [CloudAppSetupStatus.NeedsSetup]: translationKey("Needs setup"),
  [CloudAppSetupStatus.NotSetUp]: CLOUD_APP_ROW_NONE,
  [CloudAppSetupStatus.Checking]: CLOUD_APP_ROW_CHECKING,
  [CloudAppSetupStatus.NotAvailable]: translationKey("Not available"),
};

// The connection's row says its state as a connection is said.
export const CLOUD_APP_ROW_WAITING_FOR_FIRST_READ: string = translationKey(
  "Waiting for the first read",
);
export const CLOUD_APP_ROW_NOT_CHECKED: string = translationKey(
  "Could not be checked.",
);

/*
 * A row's icon and colour, as the RUM Setup check draws them: ok (a green
 * check), warning (an amber mark: what came stopped), setup (an amber
 * wrench: what a number on the page waits for), off (a grey dash: not set
 * up, nothing on the page needs it), waiting (a grey clock: being checked).
 */
export type CloudAppSetupTone = "ok" | "warning" | "setup" | "off" | "waiting";

export const CLOUD_APP_SETUP_STATUS_TONES: Readonly<
  Record<CloudAppSetupStatus, CloudAppSetupTone>
> = {
  [CloudAppSetupStatus.Received]: "ok",
  [CloudAppSetupStatus.NotReceived]: "warning",
  [CloudAppSetupStatus.NeedsSetup]: "setup",
  [CloudAppSetupStatus.NotSetUp]: "off",
  [CloudAppSetupStatus.Checking]: "waiting",
  [CloudAppSetupStatus.NotAvailable]: "off",
};

// What a row's link does; the page decides where it goes.
export enum CloudAppSetupAction {
  // Cloud > Connect, to connect a subscription.
  ConnectCloud = "connect-cloud",
  // Cloud > Connect, to see a connection's state.
  OpenConnections = "open-connections",
  // The steps that send the app's traces, metrics and logs.
  SetUpTelemetry = "set-up-telemetry",
}

export const CLOUD_APP_SETUP_ACTION_LABELS: Readonly<
  Record<CloudAppSetupAction, string>
> = {
  [CloudAppSetupAction.ConnectCloud]: translationKey("Connect a cloud account"),
  [CloudAppSetupAction.OpenConnections]: CLOUD_APP_OPEN_CONNECTIONS,
  [CloudAppSetupAction.SetUpTelemetry]: CLOUD_APP_SET_UP_TELEMETRY,
};

export interface CloudAppSetupRow {
  key: CloudAppSetupRowKey;
  // In the reader's language.
  label: string;
  status: CloudAppSetupStatus;
  // The status as the row says it, in the reader's language.
  statusLabel: string;
  tone: CloudAppSetupTone;
  // In the reader's language.
  text: string;
  // What it gives and how to send it, in the reader's language.
  hint?: string | undefined;
  action?: CloudAppSetupAction | undefined;
}

// How the app's way to Azure Monitor was read (App Service only).
export type CloudAppAzureMonitorLookup =
  | { status: "checking" }
  // The sites could not be read: nothing can be said.
  | { status: "failed" }
  | { status: "read"; link: CloudAppAzureLink };

export interface CloudAppSetupInput {
  app: CloudAppArrivalSource & {
    cloudPlatform?: string | null | undefined;
    currentRevision?: string | null | undefined;
  };
  // Whether the app runs now (seen in the live window).
  isRunning: boolean;
  // Whether any instance of the app was ever recorded.
  hasReportedInstances: boolean;
  /*
   * An App Service app's way to Azure Monitor, as read. Undefined on the
   * other platforms: no Azure Monitor rows.
   */
  azureMonitor?: CloudAppAzureMonitorLookup | undefined;
  /*
   * When the latest log Azure's diagnostic settings streamed of the app's
   * site arrived; null when none did. Undefined when it was not read.
   */
  diagnosticLogsLastReceivedAt?: Date | null | undefined;
  // What Azure says of the app's instances and deployments, when read.
  azureActivity?: AppServiceSiteActivity | null | undefined;
  now: Date;
  translator: Translator;
}

/*
 * How long a kind that comes with traffic - traces, logs - counts as
 * received after its latest: a day, so a quiet night is not a stopped
 * app. Metrics come on a clock, so theirs is the live window.
 */
export const CLOUD_APP_TRAFFIC_SIGNAL_RECEIVED_MS: number = 24 * 60 * 60 * 1000;
const LIVE_WINDOW_MS: number = CLOUD_INSTANCE_LIVE_WINDOW_MINUTES * 60 * 1000;
/*
 * Azure Monitor's readings come with each read of the connection, a few
 * minutes after Azure measured them: two reads and a quarter of an hour.
 */
const AZURE_READING_SLACK_MS: number = 15 * 60 * 1000;

export function getAzureMonitorReceivedWindowMs(
  readIntervalInMinutes: number,
): number {
  return 2 * readIntervalInMinutes * 60 * 1000 + AZURE_READING_SLACK_MS;
}

function translate(translator: Translator, text: string): string {
  return translator.translateText(text) || text;
}

export function formatCloudAppSinceDate(date: Date, now: Date): string {
  const isRecent: boolean =
    Math.abs(now.getTime() - date.getTime()) < SINCE_WITH_TIME_MS;

  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
    date,
    !isRecent,
  );
}

function statusRow(data: {
  key: CloudAppSetupRowKey;
  label: string;
  status: CloudAppSetupStatus;
  // The status's own words, when the row says it its way.
  statusLabel?: string | undefined;
  text: string;
  hint?: string | undefined;
  action?: CloudAppSetupAction | undefined;
  translator: Translator;
}): CloudAppSetupRow {
  return {
    key: data.key,
    label: translate(data.translator, data.label),
    status: data.status,
    statusLabel: translate(
      data.translator,
      data.statusLabel || CLOUD_APP_SETUP_STATUS_LABELS[data.status],
    ),
    tone: CLOUD_APP_SETUP_STATUS_TONES[data.status],
    text: data.text,
    hint: data.hint ? translate(data.translator, data.hint) : undefined,
    action: data.action,
  };
}

/*
 * A row of a kind that arrives: Received while its latest is within
 * `receivedForMs`, Not received after; never arrived, Needs setup when a
 * number on the page waits for it (`needed`), Not set up otherwise.
 */
function arrivalRow(data: {
  key: CloudAppSetupRowKey;
  label: string;
  latestAt: Date | null;
  // Since when nothing arrived, for a kind that never did.
  since: Date | null;
  receivedForMs: number;
  needed: boolean;
  // The sentence the latest is said in: CLOUD_APP_ROW_LATEST by default.
  latestText?: string | undefined;
  hint?: string | undefined;
  action?: CloudAppSetupAction | undefined;
  now: Date;
  translator: Translator;
}): CloudAppSetupRow {
  if (data.latestAt) {
    const received: boolean =
      data.now.getTime() - data.latestAt.getTime() <= data.receivedForMs;

    return statusRow({
      key: data.key,
      label: data.label,
      status: received
        ? CloudAppSetupStatus.Received
        : CloudAppSetupStatus.NotReceived,
      text: data.translator.translateTemplate(
        data.latestText || CLOUD_APP_ROW_LATEST,
        { time: OneUptimeDate.fromNow(data.latestAt, data.now) },
      ),
      translator: data.translator,
    });
  }

  return statusRow({
    key: data.key,
    label: data.label,
    status: data.needed
      ? CloudAppSetupStatus.NeedsSetup
      : CloudAppSetupStatus.NotSetUp,
    text: data.since
      ? data.translator.translateTemplate(CLOUD_APP_ROW_NONE_SINCE, {
          date: formatCloudAppSinceDate(data.since, data.now),
        })
      : translate(data.translator, CLOUD_APP_ROW_NONE_YET),
    hint: data.hint,
    action: data.action,
    translator: data.translator,
  });
}

// The newer of two dates; null when neither is one.
function newestOf(a: Date | null, b: Date | null): Date | null {
  if (!a) {
    return b;
  }

  if (!b) {
    return a;
  }

  return a.getTime() >= b.getTime() ? a : b;
}

// A Git commit's id, and a GUID's start: how Kudu names its deployments.
const COMMIT_ID_PATTERN: RegExp = /^[0-9a-f]{40}$/i;
const GUID_START_PATTERN: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/*
 * A deployment's id as a row says it: a commit's first seven characters, a
 * GUID's first group, anything else its first twelve.
 */
export function getShortAppServiceDeploymentId(id: string): string {
  const trimmed: string = id.trim();

  if (COMMIT_ID_PATTERN.test(trimmed)) {
    return trimmed.slice(0, 7);
  }

  if (GUID_START_PATTERN.test(trimmed)) {
    return trimmed.slice(0, 8);
  }

  return trimmed.slice(0, 12);
}

// The site's name as Azure names it: its ARM id's, else the name looked for.
function siteNameOf(link: CloudAppAzureLink): string {
  const fromId: string = link.site?.providerResourceId
    ? parseAzureResourceId(link.site.providerResourceId)?.name || ""
    : "";

  return fromId || link.siteName;
}

function subscriptionOf(link: CloudAppAzureLink): string {
  const fromSite: string = link.site?.providerResourceId
    ? parseAzureResourceId(link.site.providerResourceId)?.subscriptionId || ""
    : "";

  return link.subscription?.id || fromSite;
}

function connectionNameOf(link: CloudAppAzureLink): string {
  return (link.connection?.name || "").trim();
}

// The Azure Monitor connection's row and its metrics' row (App Service).
function azureMonitorRows(data: {
  lookup: CloudAppAzureMonitorLookup;
  now: Date;
  translator: Translator;
}): Array<CloudAppSetupRow> {
  const { lookup, now, translator } = data;
  const connectionLabel: string = CLOUD_APP_ROW_LABELS[
    "azureMonitor"
  ] as string;
  const metricsLabel: string = CLOUD_APP_ROW_LABELS[
    "azureMonitorMetrics"
  ] as string;

  if (lookup.status === "checking") {
    return [
      statusRow({
        key: CloudAppSetupRowKey.AzureMonitor,
        label: connectionLabel,
        status: CloudAppSetupStatus.Checking,
        text: translate(translator, CLOUD_APP_ROW_CHECKING),
        translator,
      }),
      statusRow({
        key: CloudAppSetupRowKey.AzureMonitorMetrics,
        label: metricsLabel,
        status: CloudAppSetupStatus.Checking,
        text: translate(translator, CLOUD_APP_ROW_CHECKING),
        translator,
      }),
    ];
  }

  const state: CloudAppAzureMonitorState =
    lookup.status === "read"
      ? getCloudAppAzureMonitorState(lookup.link)
      : CloudAppAzureMonitorState.Unknown;
  const link: CloudAppAzureLink | null =
    lookup.status === "read" ? lookup.link : null;
  const values: Record<string, string> = link
    ? {
        site: siteNameOf(link),
        subscription: subscriptionOf(link),
        connection: connectionNameOf(link),
        slot: link.slot || "",
        other: link.elsewhere[0]?.providerResourceId
          ? parseAzureResourceId(link.elsewhere[0].providerResourceId)
              ?.subscriptionId || ""
          : "",
      }
    : {};
  const sentence: (template: string) => string = (template: string): string => {
    return translator.translateTemplate(template, values);
  };

  let connection: CloudAppSetupRow;

  switch (state) {
    case CloudAppAzureMonitorState.Connected:
      connection = statusRow({
        key: CloudAppSetupRowKey.AzureMonitor,
        label: connectionLabel,
        status: CloudAppSetupStatus.Received,
        statusLabel: CLOUD_APP_ROW_CONNECTED,
        text: sentence(
          values["connection"]
            ? CLOUD_APP_AZURE_READ_BY
            : CLOUD_APP_AZURE_SITE_READ,
        ),
        hint: CLOUD_APP_AZURE_MONITOR_CONNECTED_HINT,
        translator,
      });
      break;
    case CloudAppAzureMonitorState.Slot:
      connection = statusRow({
        key: CloudAppSetupRowKey.AzureMonitor,
        label: connectionLabel,
        status: CloudAppSetupStatus.NotAvailable,
        text: sentence(CLOUD_APP_AZURE_SLOT),
        translator,
      });
      break;
    case CloudAppAzureMonitorState.NoConnection:
      connection = statusRow({
        key: CloudAppSetupRowKey.AzureMonitor,
        label: connectionLabel,
        status: CloudAppSetupStatus.NeedsSetup,
        statusLabel: CLOUD_APP_ROW_NOT_CONNECTED,
        text: translate(translator, CLOUD_APP_AZURE_NO_CONNECTION),
        hint: CLOUD_APP_AZURE_MONITOR_HINT,
        action: CloudAppSetupAction.ConnectCloud,
        translator,
      });
      break;
    case CloudAppAzureMonitorState.SubscriptionNotRead:
      connection = statusRow({
        key: CloudAppSetupRowKey.AzureMonitor,
        label: connectionLabel,
        status: CloudAppSetupStatus.NeedsSetup,
        statusLabel: CLOUD_APP_ROW_NOT_CONNECTED,
        text: sentence(CLOUD_APP_AZURE_SUBSCRIPTION_NOT_READ),
        hint: CLOUD_APP_AZURE_SUBSCRIPTION_NOT_READ_HINT,
        action: CloudAppSetupAction.OpenConnections,
        translator,
      });
      break;
    case CloudAppAzureMonitorState.NoSubscription:
      connection = statusRow({
        key: CloudAppSetupRowKey.AzureMonitor,
        label: connectionLabel,
        status: CloudAppSetupStatus.NeedsSetup,
        text: sentence(CLOUD_APP_AZURE_NO_SUBSCRIPTION),
        hint: CLOUD_APP_AZURE_RESOURCE_ID_HINT,
        translator,
      });
      break;
    case CloudAppAzureMonitorState.ConnectionOff:
      connection = statusRow({
        key: CloudAppSetupRowKey.AzureMonitor,
        label: connectionLabel,
        status: CloudAppSetupStatus.NotReceived,
        statusLabel: CLOUD_APP_ROW_NOT_CONNECTED,
        text: sentence(CLOUD_APP_AZURE_CONNECTION_OFF),
        action: CloudAppSetupAction.OpenConnections,
        translator,
      });
      break;
    case CloudAppAzureMonitorState.ConnectionFailing:
      connection = statusRow({
        key: CloudAppSetupRowKey.AzureMonitor,
        label: connectionLabel,
        status: CloudAppSetupStatus.NotReceived,
        statusLabel: CLOUD_APP_ROW_NOT_CONNECTED,
        text: sentence(CLOUD_APP_AZURE_CONNECTION_FAILING),
        action: CloudAppSetupAction.OpenConnections,
        translator,
      });
      break;
    case CloudAppAzureMonitorState.FirstReadPending:
      connection = statusRow({
        key: CloudAppSetupRowKey.AzureMonitor,
        label: connectionLabel,
        status: CloudAppSetupStatus.Checking,
        statusLabel: CLOUD_APP_ROW_WAITING_FOR_FIRST_READ,
        text: sentence(CLOUD_APP_AZURE_FIRST_READ),
        hint: CLOUD_APP_AZURE_FIRST_READ_HINT,
        translator,
      });
      break;
    case CloudAppAzureMonitorState.SiteNotFound:
      connection = statusRow({
        key: CloudAppSetupRowKey.AzureMonitor,
        label: connectionLabel,
        status: CloudAppSetupStatus.NeedsSetup,
        text: sentence(
          link?.sitesInSubscription === 0
            ? CLOUD_APP_AZURE_NO_SITES
            : CLOUD_APP_AZURE_SITE_NOT_FOUND,
        ),
        hint: CLOUD_APP_AZURE_SITE_NAME_HINT,
        translator,
      });
      break;
    case CloudAppAzureMonitorState.SiteInOtherSubscription:
      connection = statusRow({
        key: CloudAppSetupRowKey.AzureMonitor,
        label: connectionLabel,
        status: CloudAppSetupStatus.NeedsSetup,
        text: sentence(CLOUD_APP_AZURE_SITE_ELSEWHERE),
        hint: CLOUD_APP_AZURE_SITE_ELSEWHERE_HINT,
        translator,
      });
      break;
    case CloudAppAzureMonitorState.Unknown:
    default:
      connection = statusRow({
        key: CloudAppSetupRowKey.AzureMonitor,
        label: connectionLabel,
        status: CloudAppSetupStatus.NotAvailable,
        text: translate(translator, CLOUD_APP_ROW_NOT_CHECKED),
        translator,
      });
      break;
  }

  let metrics: CloudAppSetupRow;

  switch (state) {
    case CloudAppAzureMonitorState.Connected:
    case CloudAppAzureMonitorState.ConnectionOff:
    case CloudAppAzureMonitorState.ConnectionFailing: {
      const latestAt: Date | null = getAzureMonitorLatestReadingAt(
        link?.site || null,
      );

      metrics = latestAt
        ? arrivalRow({
            key: CloudAppSetupRowKey.AzureMonitorMetrics,
            label: metricsLabel,
            latestAt,
            since: null,
            receivedForMs: getAzureMonitorReceivedWindowMs(
              getAzureConnectionReadInterval(link?.connection || null),
            ),
            needed: true,
            now,
            translator,
          })
        : statusRow({
            key: CloudAppSetupRowKey.AzureMonitorMetrics,
            label: metricsLabel,
            status: CloudAppSetupStatus.NotReceived,
            text: translate(translator, CLOUD_APP_AZURE_METRICS_NEXT_READ),
            translator,
          });
      break;
    }
    case CloudAppAzureMonitorState.FirstReadPending:
      metrics = statusRow({
        key: CloudAppSetupRowKey.AzureMonitorMetrics,
        label: metricsLabel,
        status: CloudAppSetupStatus.Checking,
        text: translate(translator, CLOUD_APP_AZURE_METRICS_NEXT_READ),
        translator,
      });
      break;
    case CloudAppAzureMonitorState.Slot:
      metrics = statusRow({
        key: CloudAppSetupRowKey.AzureMonitorMetrics,
        label: metricsLabel,
        status: CloudAppSetupStatus.NotAvailable,
        text: translate(translator, CLOUD_APP_AZURE_METRICS_NOT_READ),
        translator,
      });
      break;
    case CloudAppAzureMonitorState.Unknown:
      metrics = statusRow({
        key: CloudAppSetupRowKey.AzureMonitorMetrics,
        label: metricsLabel,
        status: CloudAppSetupStatus.NotAvailable,
        text: translate(translator, CLOUD_APP_ROW_NOT_CHECKED),
        translator,
      });
      break;
    default:
      metrics = statusRow({
        key: CloudAppSetupRowKey.AzureMonitorMetrics,
        label: metricsLabel,
        status: CloudAppSetupStatus.NeedsSetup,
        text: translate(translator, CLOUD_APP_AZURE_METRICS_NEED_CONNECTION),
        translator,
      });
      break;
  }

  return [connection, metrics];
}

function instancesRow(input: CloudAppSetupInput): CloudAppSetupRow {
  const { translator } = input;
  const label: string = CLOUD_APP_ROW_LABELS["instances"] as string;
  const azureInstances: Array<AppServiceSiteInstance> | null = input
    .azureActivity?.instances.items
    ? getAppServiceRunningInstances(input.azureActivity.instances.items)
    : null;
  const azureCount: string | null =
    azureInstances && azureInstances.length > 0
      ? translator.translatePlural(
          CLOUD_APP_AZURE_INSTANCES,
          azureInstances.length,
        )
      : null;

  if (input.hasReportedInstances) {
    return statusRow({
      key: CloudAppSetupRowKey.Instances,
      label,
      status: CloudAppSetupStatus.Received,
      text: azureCount || translate(translator, CLOUD_APP_ROW_REPORTED),
      translator,
    });
  }

  /*
   * One that is not running names none now - its instances are swept once
   * they stop reporting - so it is not reporting, as its state says, and
   * is not asked for anything.
   */
  if (!input.isRunning) {
    return statusRow({
      key: CloudAppSetupRowKey.Instances,
      label,
      status: CloudAppSetupStatus.NotAvailable,
      text: translate(translator, CLOUD_APP_ROW_NOT_REPORTING),
      translator,
    });
  }

  // Azure counts them: they are shown, and naming them is what is left.
  if (azureCount) {
    return statusRow({
      key: CloudAppSetupRowKey.Instances,
      label,
      status: CloudAppSetupStatus.Received,
      text: azureCount,
      hint: CLOUD_APP_AZURE_INSTANCES_HINT,
      translator,
    });
  }

  return statusRow({
    key: CloudAppSetupRowKey.Instances,
    label,
    status: CloudAppSetupStatus.NeedsSetup,
    text: translate(translator, CLOUD_APP_ROW_NOT_REPORTED),
    hint: CLOUD_APP_INSTANCES_HINT,
    translator,
  });
}

function revisionRow(input: CloudAppSetupInput): CloudAppSetupRow {
  const { app, translator, now } = input;
  const label: string = getCloudAppRevisionNoun(app.cloudPlatform);

  if ((app.currentRevision || "").trim()) {
    return statusRow({
      key: CloudAppSetupRowKey.Revision,
      label,
      status: CloudAppSetupStatus.Received,
      text: translate(translator, CLOUD_APP_ROW_REPORTED),
      translator,
    });
  }

  const deployment: AppServiceSiteDeployment | null =
    getAppServiceCurrentDeployment(input.azureActivity?.deployments.items);
  const deployedAt: string | null = deployment
    ? deployment.endTime || deployment.startTime
    : null;

  // Azure names what runs: it is shown, and naming it in telemetry is what is left.
  if (deployment && deployedAt) {
    return statusRow({
      key: CloudAppSetupRowKey.Revision,
      label,
      status: CloudAppSetupStatus.Received,
      text: translator.translateTemplate(CLOUD_APP_AZURE_DEPLOYMENT, {
        deployment: getShortAppServiceDeploymentId(deployment.id),
        time: OneUptimeDate.fromNow(new Date(deployedAt), now),
      }),
      hint: CLOUD_APP_REVISION_HINT,
      translator,
    });
  }

  if (input.azureActivity?.image) {
    return statusRow({
      key: CloudAppSetupRowKey.Revision,
      label,
      status: CloudAppSetupStatus.Received,
      text: translator.translateTemplate(CLOUD_APP_AZURE_IMAGE, {
        image: input.azureActivity.image,
      }),
      hint: CLOUD_APP_REVISION_HINT,
      translator,
    });
  }

  return statusRow({
    key: CloudAppSetupRowKey.Revision,
    label,
    status: CloudAppSetupStatus.NeedsSetup,
    text: translate(translator, CLOUD_APP_ROW_NOT_REPORTED),
    hint: CLOUD_APP_REVISION_HINT,
    translator,
  });
}

/*
 * The Setup check's rows, in the order the page reads them (see the top of
 * this section).
 */
export function getCloudAppSetupRows(
  input: CloudAppSetupInput,
): Array<CloudAppSetupRow> {
  const { app, now, translator } = input;
  const isAppService: boolean =
    app.cloudPlatform === ManagedCloudPlatform.AzureAppService;
  const since: (signal: CloudAppArrivalSignal) => Date | null = (
    signal: CloudAppArrivalSignal,
  ): Date | null => {
    return getCloudAppArrival({ app, signal, now }).since;
  };
  const latest: (signal: CloudAppArrivalSignal) => Date | null = (
    signal: CloudAppArrivalSignal,
  ): Date | null => {
    return getCloudAppArrival({ app, signal, now }).latestAt;
  };

  const rows: Array<CloudAppSetupRow> = input.azureMonitor
    ? azureMonitorRows({ lookup: input.azureMonitor, now, translator })
    : [];

  rows.push(
    arrivalRow({
      key: CloudAppSetupRowKey.Traces,
      label: CLOUD_APP_ROW_LABELS["traces"] as string,
      latestAt: latest(CloudAppTelemetrySignal.Traces),
      since: since(CloudAppTelemetrySignal.Traces),
      receivedForMs: CLOUD_APP_TRAFFIC_SIGNAL_RECEIVED_MS,
      needed: true,
      hint: CLOUD_APP_TRACES_HINT,
      action: CloudAppSetupAction.SetUpTelemetry,
      now,
      translator,
    }),
    arrivalRow({
      key: CloudAppSetupRowKey.Metrics,
      label: CLOUD_APP_ROW_LABELS["metrics"] as string,
      latestAt: latest(CloudAppTelemetrySignal.Metrics),
      since: since(CloudAppTelemetrySignal.Metrics),
      receivedForMs: LIVE_WINDOW_MS,
      needed: false,
      hint: CLOUD_APP_SEND_WITH_OTEL_HINT,
      now,
      translator,
    }),
  );

  // Its logs: the app's own, or its site's that Azure's diagnostic settings stream.
  const appLogsAt: Date | null = latest(CloudAppTelemetrySignal.Logs);
  const azureLogsAt: Date | null = input.diagnosticLogsLastReceivedAt || null;
  const logsAt: Date | null = newestOf(appLogsAt, azureLogsAt);

  rows.push(
    arrivalRow({
      key: CloudAppSetupRowKey.Logs,
      label: CLOUD_APP_ROW_LABELS["logs"] as string,
      latestAt: logsAt,
      since: since(CloudAppTelemetrySignal.Logs),
      receivedForMs: CLOUD_APP_TRAFFIC_SIGNAL_RECEIVED_MS,
      needed: true,
      latestText:
        logsAt && azureLogsAt && logsAt === azureLogsAt
          ? CLOUD_APP_LOGS_LATEST_FROM_AZURE
          : isAppService
            ? CLOUD_APP_LOGS_LATEST_FROM_APP
            : CLOUD_APP_ROW_LATEST,
      hint: isAppService
        ? CLOUD_APP_SERVICE_LOGS_HINT
        : CLOUD_APP_SEND_WITH_OTEL_HINT,
      action: CloudAppSetupAction.SetUpTelemetry,
      now,
      translator,
    }),
    instancesRow(input),
    revisionRow(input),
  );

  return rows;
}

/*
 * Whether the page leads with its Setup check: while any row needs
 * something done - a kind that never came that a number waits for, or one
 * that came and stopped. Once each is received (or not set up and not
 * needed), the card goes, and the page is its numbers alone.
 */
export function isCloudAppSetupIncomplete(
  rows: ReadonlyArray<CloudAppSetupRow>,
): boolean {
  return rows.some((row: CloudAppSetupRow): boolean => {
    return (
      row.status === CloudAppSetupStatus.NeedsSetup ||
      row.status === CloudAppSetupStatus.NotReceived
    );
  });
}
