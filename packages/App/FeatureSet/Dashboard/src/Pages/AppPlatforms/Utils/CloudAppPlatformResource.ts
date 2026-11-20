import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import EndsWith from "Common/Types/BaseDatabase/EndsWith";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { getAzureStoredMetricName } from "Common/Types/Cloud/CloudKeyMetrics";
import {
  ParsedAzureResourceId,
  parseAzureResourceId,
} from "Common/Types/Cloud/CloudMonitoredResource";
import {
  CloudProvider,
  ManagedCloudPlatform,
} from "Common/Types/Cloud/CloudPlatform";
import {
  CloudResourceReading,
  CloudResourceReadings,
  readCloudResourceReadings,
} from "Common/Types/Cloud/CloudResourceHealth";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import { formatDurationMsInLanguage } from "../../../Components/TelemetryResource/telemetryFormat";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE CLOUD RESOURCE AN APP RUNS AS, IN ITS PROVIDER'S MONITORING (issue
 * #6770).
 *
 * An Azure App Service app's own telemetry says nothing of its requests
 * unless it sends traces, and nothing of its CPU or memory at all: App
 * Service gives an app no container stats. Azure Monitor measures every
 * site whatever it sends - requests, server errors, response time, CPU
 * time, memory - and once the subscription is connected (Cloud > Connect)
 * each site reaches OneUptime as a Cloud Resource of type
 * Microsoft.Web/sites, its ARM id as providerResourceId. This finds the
 * one an app runs as, so the app's page can show those numbers beside its
 * own.
 *
 * Which site is the app's:
 *
 *   1. the one whose id is the app's cloud.resource_id (providerResourceId),
 *      which the App Service detectors set (the Collector's too) - ARM ids
 *      are matched without regard to case, as ARM does;
 *   2. else a site named as the app is: an App Service app's name is its
 *      service.name, which the detectors read from WEBSITE_SITE_NAME - in
 *      the subscription the app runs in when its telemetry names one (its
 *      cloud.resource_id's, else its environment's cloud.account.id), and
 *      in its environment's region before any other. A site of that name in
 *      another subscription is not the app's (#10294): with unique default
 *      host names, two subscriptions can each hold one.
 *
 * An app kept apart by a deployment slot other than production (its group,
 * from WEBSITE_SLOT_NAME) has none: Azure Monitor measures each slot as a
 * resource of its own (Microsoft.Web/sites/slots), whose metrics a
 * connection does not read, and the site's are the production slot's alone
 * - never another slot's, though the detectors write the site's id for
 * every slot.
 *
 * Read by the end of each row's ARM id (".../providers/Microsoft.Web/sites/
 * <name>", without regard to case), never by the row's name: a person may
 * rename a resource, and a short name such as "api" starts the names of
 * more sites than one read holds (#10294 - both left a connected site
 * "not connected"). React-free apart from the read, so the matching is
 * tested alone.
 */

export const APP_SERVICE_SITE_TYPE: string = "Microsoft.Web/sites";
// The slot every site has, which IS the site.
export const APP_SERVICE_PRODUCTION_SLOT: string = "production";

/*
 * The most rows one look-up reads: far more than name one site - one per
 * subscription that holds a site of that name.
 */
export const CLOUD_APP_PLATFORM_RESOURCE_READ_LIMIT: number = 50;

// The subset of CloudApp the look-up reads.
export interface CloudAppPlatformResourceSource {
  name?: string | null | undefined;
  cloudPlatform?: string | null | undefined;
  groupName?: string | null | undefined;
  providerResourceId?: string | null | undefined;
}

// The subset of CloudResource the matching reads.
export interface CloudPlatformResourceCandidate {
  providerResourceId?: string | null | undefined;
  lastSeenAt?: Date | string | null | undefined;
  // Where the row says the site is: preferred, never required.
  cloudRegion?: string | null | undefined;
}

// What the app's environment says of where it runs.
export interface CloudAppPlatformEnvironment {
  cloudAccountId?: string | null | undefined;
  cloudRegion?: string | null | undefined;
}

// Whether the app runs on Azure App Service, whatever its slot.
export function isAppServiceApp(app: CloudAppPlatformResourceSource): boolean {
  return app.cloudPlatform === ManagedCloudPlatform.AzureAppService;
}

/*
 * Whether the app has a resource to look up: an App Service app's site, for
 * its production slot (see the top of this file). App Service only, for now.
 */
export function hasCloudAppPlatformResource(
  app: CloudAppPlatformResourceSource,
): boolean {
  return (
    isAppServiceApp(app) &&
    Boolean(getCloudAppSiteName(app)) &&
    getCloudAppSlotName(app) === null
  );
}

/*
 * The App Service site the app runs as, by name: from its
 * cloud.resource_id when it reports one (the id names the site), else its
 * own name.
 */
export function getCloudAppSiteName(
  app: CloudAppPlatformResourceSource,
): string {
  const parsed: ParsedAzureResourceId | null = app.providerResourceId
    ? parseAzureResourceId(app.providerResourceId)
    : null;

  if (
    parsed &&
    parsed.type.toLowerCase() === APP_SERVICE_SITE_TYPE.toLowerCase()
  ) {
    return parsed.name.trim();
  }

  return (app.name || "").trim();
}

// The non-production slot the app is kept apart by, if any.
export function getCloudAppSlotName(
  app: CloudAppPlatformResourceSource,
): string | null {
  const slot: string = (app.groupName || "").trim();

  if (!slot || slot.toLowerCase() === APP_SERVICE_PRODUCTION_SLOT) {
    return null;
  }

  return slot;
}

/*
 * An Azure region as Resource Manager writes a location: "northcentralus".
 * App Service's REGION_NAME, which the SDK detectors put in cloud.region,
 * is the display name - "North Central US" - so both are written the same
 * way before they are compared.
 */
export function normalizeAzureRegion(
  region: string | null | undefined,
): string {
  return (region || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// A subscription id as compared: GUIDs are matched without regard to case.
export function normalizeAzureSubscription(
  subscriptionId: string | null | undefined,
): string {
  return (subscriptionId || "").trim().toLowerCase();
}

// Where the subscription an app runs in was read from.
export enum CloudAppSubscriptionSource {
  // The app's own cloud.resource_id names it.
  ResourceId = "resource-id",
  // Its environment's cloud.account.id.
  Environment = "environment",
  // Neither: the site found by the app's name says it.
  Site = "site",
}

export interface CloudAppSubscription {
  // As its source writes it.
  id: string;
  source: CloudAppSubscriptionSource;
}

/*
 * The Azure subscription the app runs in, as its telemetry says it: its
 * cloud.resource_id's - the site's own ARM id, which the App Service
 * detectors write from WEBSITE_OWNER_NAME - else its environment's
 * cloud.account.id, which the SDK detectors do not set (it is added by
 * hand, or by the Collector's azureappservice detector). Null when neither
 * names one.
 */
export function getCloudAppSubscription(data: {
  app: CloudAppPlatformResourceSource;
  environment?: CloudAppPlatformEnvironment | null | undefined;
}): CloudAppSubscription | null {
  const parsed: ParsedAzureResourceId | null = data.app.providerResourceId
    ? parseAzureResourceId(data.app.providerResourceId)
    : null;

  if (parsed && parsed.subscriptionId.trim()) {
    return {
      id: parsed.subscriptionId.trim(),
      source: CloudAppSubscriptionSource.ResourceId,
    };
  }

  const accountId: string = (data.environment?.cloudAccountId || "").trim();

  return accountId
    ? { id: accountId, source: CloudAppSubscriptionSource.Environment }
    : null;
}

// How the app's site was found.
export enum CloudAppSiteMatch {
  // Its cloud.resource_id is the site's id.
  ResourceId = "resource-id",
  // The site is named as the app is, in the app's subscription.
  Name = "name",
}

export interface CloudAppSiteResolution<T> {
  site: T | null;
  matchedBy: CloudAppSiteMatch | null;
  /*
   * Sites named as the app is in another subscription than the one its
   * telemetry names, the one seen last first: not the app's, though one
   * may be what a cloud.account.id typed by hand meant.
   */
  elsewhere: Array<T>;
}

function timeOf(value: Date | string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const time: number = new Date(value).getTime();

  return Number.isFinite(time) ? time : 0;
}

// The rows, the one seen last first.
function byLastSeen<T extends CloudPlatformResourceCandidate>(
  rows: ReadonlyArray<T>,
): Array<T> {
  return [...rows].sort((a: T, b: T): number => {
    return timeOf(b.lastSeenAt) - timeOf(a.lastSeenAt);
  });
}

function latestOf<T extends CloudPlatformResourceCandidate>(
  rows: ReadonlyArray<T>,
): T | null {
  return byLastSeen(rows)[0] || null;
}

interface ParsedCandidate<T> {
  row: T;
  parsed: ParsedAzureResourceId;
}

/*
 * The app's site among `candidates`, and how it was found (see the top of
 * this file): its id's, else one named as the app is - in the app's
 * subscription when its telemetry names one, in its environment's region
 * first - and, when two rows name it (a listing and a metrics row of one
 * site in two spellings), the one seen last. None for an app of another
 * slot than production.
 */
export function resolveCloudAppSite<
  T extends CloudPlatformResourceCandidate,
>(data: {
  app: CloudAppPlatformResourceSource;
  candidates: ReadonlyArray<T>;
  environment?: CloudAppPlatformEnvironment | null | undefined;
}): CloudAppSiteResolution<T> {
  const siteName: string = getCloudAppSiteName(data.app).toLowerCase();

  if (!siteName || getCloudAppSlotName(data.app) !== null) {
    return { site: null, matchedBy: null, elsewhere: [] };
  }

  const parsedCandidates: Array<ParsedCandidate<T>> = [];

  for (const row of data.candidates) {
    const parsed: ParsedAzureResourceId | null = row.providerResourceId
      ? parseAzureResourceId(row.providerResourceId)
      : null;

    if (parsed) {
      parsedCandidates.push({ row, parsed });
    }
  }

  const ownId: string = (data.app.providerResourceId || "")
    .trim()
    .toLowerCase();

  if (ownId) {
    const byId: T | null = latestOf(
      parsedCandidates
        .filter((candidate: ParsedCandidate<T>): boolean => {
          return (
            (candidate.row.providerResourceId || "").trim().toLowerCase() ===
            ownId
          );
        })
        .map((candidate: ParsedCandidate<T>): T => {
          return candidate.row;
        }),
    );

    if (byId) {
      return {
        site: byId,
        matchedBy: CloudAppSiteMatch.ResourceId,
        elsewhere: [],
      };
    }
  }

  const subscription: string = normalizeAzureSubscription(
    getCloudAppSubscription({ app: data.app, environment: data.environment })
      ?.id,
  );
  const inSubscription: Array<T> = [];
  const elsewhere: Array<T> = [];

  for (const candidate of parsedCandidates) {
    if (
      candidate.parsed.type.toLowerCase() !==
        APP_SERVICE_SITE_TYPE.toLowerCase() ||
      candidate.parsed.name.toLowerCase() !== siteName
    ) {
      continue;
    }

    if (
      !subscription ||
      normalizeAzureSubscription(candidate.parsed.subscriptionId) ===
        subscription
    ) {
      inSubscription.push(candidate.row);
    } else {
      elsewhere.push(candidate.row);
    }
  }

  const region: string = normalizeAzureRegion(data.environment?.cloudRegion);
  const inRegion: Array<T> = region
    ? inSubscription.filter((row: T): boolean => {
        return normalizeAzureRegion(row.cloudRegion) === region;
      })
    : [];
  const site: T | null = latestOf(inRegion) || latestOf(inSubscription);

  return {
    site,
    matchedBy: site ? CloudAppSiteMatch.Name : null,
    elsewhere: site ? [] : byLastSeen(elsewhere),
  };
}

/*
 * The app's site among `candidates` (resolveCloudAppSite), or null when
 * none is.
 */
export function matchCloudAppPlatformResource<
  T extends CloudPlatformResourceCandidate,
>(data: {
  app: CloudAppPlatformResourceSource;
  candidates: ReadonlyArray<T>;
  environment?: CloudAppPlatformEnvironment | null | undefined;
}): T | null {
  return resolveCloudAppSite(data).site;
}

/*
 * The end every ARM id of a site named `siteName` has, in lower case:
 * ".../providers/microsoft.web/sites/checkout-api". A slot's id ends in
 * ".../slots/<slot>" and a plan's in ".../serverfarms/<plan>", so neither
 * ends so, and nor does another site's whose name only ends alike: the
 * slash before the name is part of it.
 */
export function getAppServiceSiteIdSuffix(siteName: string): string {
  return `/providers/${APP_SERVICE_SITE_TYPE}/${siteName.trim()}`.toLowerCase();
}

// What the look-up reads of each site row.
export const CLOUD_APP_SITE_SELECT: Readonly<Record<string, true>> = {
  _id: true,
  name: true,
  cloudResourceKind: true,
  cloudResourceType: true,
  cloudProvider: true,
  cloudAccountId: true,
  cloudRegion: true,
  cloudResourceGroup: true,
  cloudConnectionId: true,
  providerResourceId: true,
  telemetryAttributes: true,
  cloudReadings: true,
  cloudReadingsAt: true,
  lastSeenAt: true,
};

/*
 * Read the Azure site rows that could be the app's: those whose ARM id ends
 * with a site of the app's name (getAppServiceSiteIdSuffix), in whichever
 * subscription; resolveCloudAppSite picks among them. Empty when the app
 * has no site to look up. Rejects when the read fails, so the page can tell
 * "not found" from "could not check".
 */
export async function fetchCloudAppSiteCandidates(
  app: CloudAppPlatformResourceSource,
): Promise<Array<CloudResource>> {
  if (!hasCloudAppPlatformResource(app)) {
    return [];
  }

  const result: { data: Array<CloudResource> } =
    await ModelAPI.getList<CloudResource>({
      modelType: CloudResource,
      query: {
        cloudResourceKind: CloudResourceKind.Resource,
        cloudProvider: CloudProvider.Azure,
        cloudResourceType: APP_SERVICE_SITE_TYPE,
        providerResourceId: new EndsWith(
          getAppServiceSiteIdSuffix(getCloudAppSiteName(app)),
        ),
      },
      select: CLOUD_APP_SITE_SELECT,
      sort: { lastSeenAt: SortOrder.Descending },
      skip: 0,
      limit: CLOUD_APP_PLATFORM_RESOURCE_READ_LIMIT,
    });

  return result.data;
}

/*
 * Read the app's site: the row resolveCloudAppSite picks among the
 * candidates. Null when the app has none to look up, or none is found.
 * Rejects when the read fails.
 */
export async function fetchCloudAppPlatformResource(
  app: CloudAppPlatformResourceSource,
  environment?: CloudAppPlatformEnvironment | null | undefined,
): Promise<CloudResource | null> {
  return resolveCloudAppSite({
    app,
    candidates: await fetchCloudAppSiteCandidates(app),
    environment,
  }).site;
}

/* ------------------------------------------------------- Its metrics */

/*
 * The site metrics an App Service app's page shows, each as Azure Monitor
 * names it and with the aggregation it is stored under: the one its
 * definition calls primary (getAzureStoredMetricName). A reading the
 * resource keeps says which one its read stored (CloudResourceReading
 * .metric), and wins: a monitor of the metric reads the same name.
 */
export enum AppServiceMetric {
  Requests = "requests",
  ServerErrors = "http5xx",
  ResponseTime = "httpresponsetime",
  CpuTime = "cputime",
  MemoryWorkingSet = "memoryworkingset",
}

export const APP_SERVICE_METRICS: Readonly<
  Record<AppServiceMetric, { metricName: string; aggregation: string }>
> = {
  [AppServiceMetric.Requests]: { metricName: "Requests", aggregation: "total" },
  [AppServiceMetric.ServerErrors]: {
    metricName: "Http5xx",
    aggregation: "total",
  },
  [AppServiceMetric.ResponseTime]: {
    metricName: "HttpResponseTime",
    aggregation: "average",
  },
  [AppServiceMetric.CpuTime]: { metricName: "CpuTime", aggregation: "total" },
  [AppServiceMetric.MemoryWorkingSet]: {
    metricName: "MemoryWorkingSet",
    aggregation: "average",
  },
};

// The name a site metric is stored under, for this resource.
export function getAppServiceStoredMetricName(data: {
  metric: AppServiceMetric;
  readings?: unknown;
}): string {
  const readings: CloudResourceReadings = readCloudResourceReadings(
    data.readings,
  );
  const reading: CloudResourceReading | undefined = readings[data.metric];
  const stored: string = (reading?.metric || "").trim().toLowerCase();

  if (stored) {
    return stored;
  }

  const definition: { metricName: string; aggregation: string } =
    APP_SERVICE_METRICS[data.metric];

  return getAzureStoredMetricName(
    definition.metricName,
    definition.aggregation,
  );
}

// One series a site metric is read into: a value per time bucket.
export interface AppServiceSeriesPoint {
  x: Date;
  y: number;
}

export interface AppServiceSeries {
  requests: Array<AppServiceSeriesPoint>;
  serverErrors: Array<AppServiceSeriesPoint>;
  // Seconds, as Azure Monitor reports HttpResponseTime.
  responseTimeSeconds: Array<AppServiceSeriesPoint>;
  // Seconds of CPU, as Azure Monitor reports CpuTime.
  cpuTimeSeconds: Array<AppServiceSeriesPoint>;
  memoryBytes: Array<AppServiceSeriesPoint>;
}

/*
 * The site's numbers over the range, for its tiles: totals for what is
 * counted (requests, server errors, CPU time), means for what is measured
 * (response time, memory) - each the mean of the range's intervals, as an
 * app's own p95 tile is. Null where the range holds no point: unknown, not
 * zero.
 */
export interface AppServiceSummary {
  requests: number | null;
  serverErrors: number | null;
  serverErrorRatePercent: number | null;
  responseTimeMs: number | null;
  cpuTimeSeconds: number | null;
  memoryBytes: number | null;
}

// The points' values that are numbers: a bucket that read none is skipped.
function finiteValues(
  points: ReadonlyArray<AppServiceSeriesPoint>,
): Array<number> {
  return points
    .map((point: AppServiceSeriesPoint): number => {
      return point.y;
    })
    .filter((value: number): boolean => {
      return Number.isFinite(value);
    });
}

function sumPoints(
  points: ReadonlyArray<AppServiceSeriesPoint>,
): number | null {
  const values: Array<number> = finiteValues(points);

  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum: number, value: number): number => {
    return sum + value;
  }, 0);
}

function meanPoints(
  points: ReadonlyArray<AppServiceSeriesPoint>,
): number | null {
  const values: Array<number> = finiteValues(points);
  const sum: number | null = sumPoints(points);

  return sum === null ? null : sum / values.length;
}

export function summarizeAppServiceSeries(
  series: AppServiceSeries,
): AppServiceSummary {
  const requests: number | null = sumPoints(series.requests);
  const serverErrors: number | null = sumPoints(series.serverErrors);
  const responseTimeSeconds: number | null = meanPoints(
    series.responseTimeSeconds,
  );

  return {
    requests,
    serverErrors,
    /*
     * Azure Monitor counts a site's 5xx answers as 0 in an interval with
     * none, so a range with requests and no 5xx point at all was not read:
     * its rate is unknown, not 0%.
     */
    serverErrorRatePercent:
      requests !== null && requests > 0 && serverErrors !== null
        ? (serverErrors / requests) * 100
        : null,
    responseTimeMs:
      responseTimeSeconds === null ? null : responseTimeSeconds * 1000,
    cpuTimeSeconds: sumPoints(series.cpuTimeSeconds),
    memoryBytes: meanPoints(series.memoryBytes),
  };
}

/*
 * The site's CPU time over the range, as a reader says a duration: the
 * response time's units under a minute ("450 ms", "12.50 s"), then the
 * two largest whole units in the reader's language ("1m 30s", "2h 5m";
 * "1 Min., 30 Sek." in German) - never "5400.00 s". A busy site spends
 * hours of CPU in a day.
 */
export function formatAppServiceCpuTime(
  seconds: number | null,
  language?: string | undefined,
  translator?: Translator | undefined,
): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 60) {
    const milliseconds: number | null =
      seconds === null ? null : seconds * 1000;

    return formatDurationMsInLanguage(
      milliseconds,
      translator || createTranslator(undefined, DEFAULT_LANGUAGE),
    );
  }

  return formatDurationCompactInLanguage(seconds, language);
}
