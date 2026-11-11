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
import OneUptimeDate from "Common/Types/Date";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { getCloudAppRevisionNoun } from "./CloudApps";
import { isCloudInstanceLive } from "./CloudResourceTelemetryScope";

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

export const CLOUD_APP_ROW_ARRIVING: string = translationKey(
  "Arriving. The latest came in {{time}}.",
);
export const CLOUD_APP_ROW_QUIET: string = translationKey(
  "Quiet. The latest came in {{time}}.",
);
export const CLOUD_APP_ROW_NONE_SINCE: string = translationKey(
  "None since {{date}}.",
);
export const CLOUD_APP_ROW_NONE: string = translationKey("Not set up");
export const CLOUD_APP_ROW_REPORTED: string = translationKey("Reported");
export const CLOUD_APP_ROW_NOT_REPORTED: string =
  translationKey("Not reported");
export const CLOUD_APP_ROW_CHECKING: string = translationKey("Checking…");
export const CLOUD_APP_ROW_CONNECTED: string = translationKey("Connected");
export const CLOUD_APP_ROW_NOT_CONNECTED: string =
  translationKey("Not connected");

export const CLOUD_APP_ROW_LABELS: Readonly<Record<string, string>> = {
  traces: translationKey("Traces"),
  metrics: translationKey("Metrics"),
  logs: translationKey("Logs"),
  instances: translationKey("Instances"),
  azureMonitor: translationKey("Azure Monitor"),
};

// Under a row whose kind or attribute is missing: what it gives, and how.
export const CLOUD_APP_TRACES_HINT: string = translationKey(
  "Requests, error rate and latency come from traces. Send them from the app with an OpenTelemetry SDK or auto-instrumentation.",
);
export const CLOUD_APP_INSTANCES_HINT: string = translationKey(
  "The app's telemetry names no instance, so its instances can't be counted. Turn on its platform's resource detector, or set service.instance.id in its resource attributes.",
);
export const CLOUD_APP_REVISION_HINT: string = translationKey(
  "Set service.version in the app's resource attributes, and each deploy is marked on its charts and listed under Revisions.",
);
export const CLOUD_APP_AZURE_MONITOR_HINT: string = translationKey(
  "Connect the Azure subscription this app runs in, and Azure Monitor reports its requests, response time, CPU and memory, with no change to the app.",
);
export const CLOUD_APP_AZURE_MONITOR_CONNECTED_HINT: string = translationKey(
  "Its requests, response time, CPU and memory, as Azure measures them, are below.",
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

export enum CloudAppSetupRowKey {
  Traces = "traces",
  Metrics = "metrics",
  Logs = "logs",
  Instances = "instances",
  Revision = "revision",
  AzureMonitor = "azure-monitor",
}

/*
 * A row's icon and colour, as the RUM Setup check draws them: ok (a green
 * check), warning (an amber mark: what a number on the page waits for),
 * off (a grey dash: not set up, nothing on the page needs it), waiting (a
 * grey clock: being checked).
 */
export type CloudAppSetupTone = "ok" | "warning" | "off" | "waiting";

export interface CloudAppSetupRow {
  key: CloudAppSetupRowKey;
  // In the reader's language.
  label: string;
  tone: CloudAppSetupTone;
  // In the reader's language.
  text: string;
  // What it gives and how to send it, in the reader's language.
  hint?: string | undefined;
}

// How the app's Azure Monitor resource was looked up (App Service only).
export enum CloudAppPlatformResourceState {
  Checking = "checking",
  Found = "found",
  NotFound = "not-found",
}

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
   * The Cloud Resource Azure Monitor reports an App Service app as: looked
   * up, found or not. Undefined on the other platforms: no row.
   */
  platformResource?: CloudAppPlatformResourceState | undefined;
  now: Date;
  translator: Translator;
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

function arrivalRow(data: {
  key: CloudAppSetupRowKey;
  label: string;
  arrival: CloudAppArrival;
  // What a number on the page waits for: amber, with the hint.
  needed: boolean;
  hint?: string | undefined;
  now: Date;
  translator: Translator;
}): CloudAppSetupRow {
  const label: string = translate(data.translator, data.label);

  if (data.arrival.state === CloudAppArrivalState.Arriving) {
    return {
      key: data.key,
      label,
      tone: "ok",
      text: data.translator.translateTemplate(CLOUD_APP_ROW_ARRIVING, {
        time: OneUptimeDate.fromNow(data.arrival.latestAt as Date, data.now),
      }),
    };
  }

  if (data.arrival.state === CloudAppArrivalState.Quiet) {
    return {
      key: data.key,
      label,
      tone: "ok",
      text: data.translator.translateTemplate(CLOUD_APP_ROW_QUIET, {
        time: OneUptimeDate.fromNow(data.arrival.latestAt as Date, data.now),
      }),
    };
  }

  return {
    key: data.key,
    label,
    tone: data.needed ? "warning" : "off",
    text: data.arrival.since
      ? data.translator.translateTemplate(CLOUD_APP_ROW_NONE_SINCE, {
          date: formatCloudAppSinceDate(data.arrival.since, data.now),
        })
      : translate(data.translator, CLOUD_APP_ROW_NONE),
    hint: data.hint ? translate(data.translator, data.hint) : undefined,
  };
}

/*
 * Whether the app's page leads with its Setup check: some number on it
 * waits for something the app does not send - traces (its requests, error
 * rate and latency), an instance it names (its instances) or a version
 * (its deploys). Once all three arrive the card goes, and the page is its
 * numbers alone.
 */
export function isCloudAppSetupIncomplete(
  input: Pick<CloudAppSetupInput, "app" | "isRunning" | "hasReportedInstances">,
): boolean {
  return (
    !hasCloudAppSentTraces(input.app) ||
    (input.isRunning && !input.hasReportedInstances) ||
    !(input.app.currentRevision || "").trim()
  );
}

/*
 * The Setup check's rows, in the order the page reads them: traces (the
 * numbers at its top), metrics, logs, the instances it names, its version
 * - and, for an App Service app, Azure Monitor, which measures the site
 * whatever the app sends.
 */
export function getCloudAppSetupRows(
  input: CloudAppSetupInput,
): Array<CloudAppSetupRow> {
  const { app, now, translator } = input;
  const rows: Array<CloudAppSetupRow> = [
    arrivalRow({
      key: CloudAppSetupRowKey.Traces,
      label: CLOUD_APP_ROW_LABELS["traces"] as string,
      arrival: getCloudAppArrival({
        app,
        signal: CloudAppTelemetrySignal.Traces,
        now,
      }),
      needed: true,
      hint: CLOUD_APP_TRACES_HINT,
      now,
      translator,
    }),
    arrivalRow({
      key: CloudAppSetupRowKey.Metrics,
      label: CLOUD_APP_ROW_LABELS["metrics"] as string,
      arrival: getCloudAppArrival({
        app,
        signal: CloudAppTelemetrySignal.Metrics,
        now,
      }),
      needed: false,
      now,
      translator,
    }),
    arrivalRow({
      key: CloudAppSetupRowKey.Logs,
      label: CLOUD_APP_ROW_LABELS["logs"] as string,
      arrival: getCloudAppArrival({
        app,
        signal: CloudAppTelemetrySignal.Logs,
        now,
      }),
      needed: false,
      now,
      translator,
    }),
  ];

  // An app that is not running names no instance now, and is not asked to.
  const instancesMissing: boolean =
    input.isRunning && !input.hasReportedInstances;

  rows.push({
    key: CloudAppSetupRowKey.Instances,
    label: translate(translator, CLOUD_APP_ROW_LABELS["instances"] as string),
    tone: instancesMissing ? "warning" : "ok",
    text: translate(
      translator,
      instancesMissing ? CLOUD_APP_ROW_NOT_REPORTED : CLOUD_APP_ROW_REPORTED,
    ),
    hint: instancesMissing
      ? translate(translator, CLOUD_APP_INSTANCES_HINT)
      : undefined,
  });

  const hasRevision: boolean = Boolean((app.currentRevision || "").trim());

  rows.push({
    key: CloudAppSetupRowKey.Revision,
    label: translate(translator, getCloudAppRevisionNoun(app.cloudPlatform)),
    tone: hasRevision ? "ok" : "warning",
    text: translate(
      translator,
      hasRevision ? CLOUD_APP_ROW_REPORTED : CLOUD_APP_ROW_NOT_REPORTED,
    ),
    hint: hasRevision
      ? undefined
      : translate(translator, CLOUD_APP_REVISION_HINT),
  });

  if (input.platformResource) {
    const found: boolean =
      input.platformResource === CloudAppPlatformResourceState.Found;
    const checking: boolean =
      input.platformResource === CloudAppPlatformResourceState.Checking;

    rows.push({
      key: CloudAppSetupRowKey.AzureMonitor,
      label: translate(
        translator,
        CLOUD_APP_ROW_LABELS["azureMonitor"] as string,
      ),
      tone: checking ? "waiting" : found ? "ok" : "off",
      text: translate(
        translator,
        checking
          ? CLOUD_APP_ROW_CHECKING
          : found
            ? CLOUD_APP_ROW_CONNECTED
            : CLOUD_APP_ROW_NOT_CONNECTED,
      ),
      hint: checking
        ? undefined
        : translate(
            translator,
            found
              ? CLOUD_APP_AZURE_MONITOR_CONNECTED_HINT
              : CLOUD_APP_AZURE_MONITOR_HINT,
          ),
    });
  }

  return rows;
}
