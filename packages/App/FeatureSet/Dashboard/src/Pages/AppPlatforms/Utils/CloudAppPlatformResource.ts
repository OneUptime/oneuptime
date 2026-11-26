import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import EndsWith from "Common/Types/BaseDatabase/EndsWith";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { getAzureStoredMetricName } from "Common/Types/Cloud/CloudKeyMetrics";
import {
  APP_ENGINE_SERVICE_TYPE,
  APP_RUNNER_SERVICE_TYPE,
  APP_SERVICE_PRODUCTION_SLOT,
  APP_SERVICE_SITE_TYPE,
  APP_SERVICE_SLOT_TYPE,
  CLOUD_RUN_SERVICE_TYPE,
  CONTAINER_APP_TYPE,
  CloudAppPlatformEnvironment,
  CloudAppPlatformResourceKind,
  CloudAppPlatformResourceSource,
  CloudAppSiteMatch,
  CloudAppSiteResolution,
  CloudAppSubscription,
  CloudAppSubscriptionSource,
  CloudPlatformResourceCandidate,
  ECS_SERVICE_TYPE,
  getAppServiceSiteIdSuffix,
  getAppServiceSlotIdSuffix,
  getCloudAppPlatformResourceKind,
  getCloudAppPlatformResourceName,
  getCloudAppPlatformResourceType,
  getCloudAppSiteMatchOf,
  getCloudAppSiteName,
  getCloudAppSlotName,
  getCloudAppSubscription,
  getContainerAppIdSuffix,
  getGcpServiceIdSuffix,
  hasCloudAppPlatformResource,
  isAppServiceApp,
  matchCloudAppPlatformResource,
  normalizeAzureRegion,
  normalizeAzureSubscription,
  resolveCloudAppPlatformResource,
  resolveCloudAppSite,
} from "Common/Types/Cloud/CloudAppPlatformResourceMatch";
import {
  CloudResourceReading,
  CloudResourceReadings,
  readCloudResourceReadings,
} from "Common/Types/Cloud/CloudResourceHealth";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import { formatDurationMsInLanguage } from "../../../Components/TelemetryResource/telemetryFormat";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE CLOUD RESOURCE AN APP RUNS AS, AS THE DASHBOARD READS IT (issues
 * #6770, #6793, #6794): an App Service app's site or slot, a Container App,
 * a Cloud Run, App Engine, App Runner or ECS service, whose numbers - as
 * Azure Monitor, Google Cloud Monitoring or Amazon CloudWatch measure them -
 * its page and its lists show beside its own.
 *
 * Which resource is the app's is decided in one place, for the server and
 * the page alike (Common/Types/Cloud/CloudAppPlatformResourceMatch,
 * re-exported here). The server keeps the answer on the app
 * (CloudApp.platformCloudResourceId, #10407); this file reads the rows -
 * the kept resource, or the candidates while none is kept - with the
 * reader's own permissions, names and sums an App Service site's metrics,
 * and is otherwise React-free, so all of it is tested without a renderer.
 */

export type {
  CloudAppPlatformEnvironment,
  CloudAppPlatformResourceSource,
  CloudAppSiteResolution,
  CloudAppSubscription,
  CloudPlatformResourceCandidate,
};

export {
  APP_SERVICE_PRODUCTION_SLOT,
  APP_SERVICE_SITE_TYPE,
  APP_SERVICE_SLOT_TYPE,
  CloudAppSiteMatch,
  CloudAppSubscriptionSource,
  getAppServiceSiteIdSuffix,
  getAppServiceSlotIdSuffix,
  getCloudAppPlatformResourceType,
  getCloudAppSiteMatchOf,
  getCloudAppSiteName,
  getCloudAppSlotName,
  getCloudAppSubscription,
  hasCloudAppPlatformResource,
  isAppServiceApp,
  matchCloudAppPlatformResource,
  normalizeAzureRegion,
  normalizeAzureSubscription,
  resolveCloudAppPlatformResource,
  resolveCloudAppSite,
};

/*
 * The most rows one look-up reads: far more than name one resource - one
 * per subscription that holds a site of that name, one per App Runner
 * service of an account's Region (30 at most, by default), one per service
 * of an ECS cluster.
 */
export const CLOUD_APP_PLATFORM_RESOURCE_READ_LIMIT: number = 50;

// What the look-up reads of each resource row.
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
  // The task definition an ECS service runs, which ties it to its app.
  cloudProperties: true,
  lastSeenAt: true,
};

/*
 * What narrows the rows that could be the app's resource, beside its type:
 * the end of their id where it names the resource (an ARM id, a Google
 * Cloud full resource name), else the account and Region its environment
 * names, or the cluster in an ECS service's ARN. Null for an app with none
 * to look up.
 */
export function getCloudAppPlatformCandidateQuery(
  app: CloudAppPlatformResourceSource,
  environment?: CloudAppPlatformEnvironment | null | undefined,
): Query<CloudResource> | null {
  const kind: CloudAppPlatformResourceKind | null =
    getCloudAppPlatformResourceKind(app.cloudPlatform);
  const type: string | null = getCloudAppPlatformResourceType(app);

  if (!kind || !type || !hasCloudAppPlatformResource(app)) {
    return null;
  }

  const name: string = getCloudAppPlatformResourceName(app);
  const account: string = (environment?.cloudAccountId || "").trim();
  const region: string = (environment?.cloudRegion || "").trim();
  const query: Query<CloudResource> = {
    cloudResourceKind: CloudResourceKind.Resource,
    cloudProvider: kind.provider,
    cloudResourceType: type,
    isArchived: false,
  } as Query<CloudResource>;

  switch (type) {
    case APP_SERVICE_SITE_TYPE:
      query.providerResourceId = new EndsWith(
        getAppServiceSiteIdSuffix(getCloudAppSiteName(app)),
      );
      break;
    case APP_SERVICE_SLOT_TYPE:
      query.providerResourceId = new EndsWith(
        getAppServiceSlotIdSuffix(
          getCloudAppSiteName(app),
          getCloudAppSlotName(app) || "",
        ),
      );
      break;
    case CONTAINER_APP_TYPE:
      query.providerResourceId = new EndsWith(getContainerAppIdSuffix(name));
      break;
    case CLOUD_RUN_SERVICE_TYPE:
    case APP_ENGINE_SERVICE_TYPE:
      query.providerResourceId = new EndsWith(getGcpServiceIdSuffix(name));
      break;
    case ECS_SERVICE_TYPE:
      // Every service of the app's cluster: the one that runs its family is its.
      query.providerResourceId = new Search(
        `:service/${(app.groupName || "").trim()}/`,
      );
      break;
    case APP_RUNNER_SERVICE_TYPE:
      // An account's Region holds few App Runner services (30, by default).
      if (account) {
        query.cloudAccountId = account;
      }
      if (region) {
        query.cloudRegion = region;
      }
      break;
    default:
      break;
  }

  return query;
}

/*
 * Read the rows that could be the app's resource
 * (getCloudAppPlatformCandidateQuery); resolveCloudAppPlatformResource picks
 * among them. A resource gone from its account (archived) is not one, as
 * the server's link leaves it out too. Empty when the app has none to look
 * up. Rejects when the read fails, so the page can tell "not found" from
 * "could not check".
 */
export async function fetchCloudAppPlatformCandidates(
  app: CloudAppPlatformResourceSource,
  environment?: CloudAppPlatformEnvironment | null | undefined,
): Promise<Array<CloudResource>> {
  const query: Query<CloudResource> | null = getCloudAppPlatformCandidateQuery(
    app,
    environment,
  );

  if (!query) {
    return [];
  }

  const result: { data: Array<CloudResource> } =
    await ModelAPI.getList<CloudResource>({
      modelType: CloudResource,
      query,
      select: CLOUD_APP_SITE_SELECT,
      sort: { lastSeenAt: SortOrder.Descending },
      skip: 0,
      limit: CLOUD_APP_PLATFORM_RESOURCE_READ_LIMIT,
    });

  return result.data;
}

/*
 * An App Service app's candidates: the site rows - or, for an app of another
 * slot than production, the slot rows (#6793) - whose ARM id ends with its
 * name's, in whichever subscription; resolveCloudAppSite picks among them.
 */
export async function fetchCloudAppSiteCandidates(
  app: CloudAppPlatformResourceSource,
): Promise<Array<CloudResource>> {
  return isAppServiceApp(app) ? await fetchCloudAppPlatformCandidates(app) : [];
}

// The subset of CloudApp that names the resource the server kept for it.
export interface CloudAppKeptSiteSource extends CloudAppPlatformResourceSource {
  platformCloudResourceId?: ObjectID | string | null | undefined;
}

/*
 * The resource the server tied the app to (#10407), read with the reader's
 * own permissions: null when none is kept, when it is gone, when it is not
 * of the type the app runs as now (an app moved to another slot), or when
 * the reader may not read it (a label they are not given) - the page then
 * says what it finds itself, and never shows a resource the reader cannot
 * open. Rejects only when the read fails.
 */
export async function fetchKeptCloudAppPlatformResource(
  app: CloudAppKeptSiteSource,
): Promise<CloudResource | null> {
  const resourceId: string = app.platformCloudResourceId
    ? app.platformCloudResourceId.toString()
    : "";
  const type: string | null = getCloudAppPlatformResourceType(app);

  if (!resourceId || !type || !hasCloudAppPlatformResource(app)) {
    return null;
  }

  const result: { data: Array<CloudResource> } =
    await ModelAPI.getList<CloudResource>({
      modelType: CloudResource,
      query: {
        _id: new ObjectID(resourceId),
        cloudResourceKind: CloudResourceKind.Resource,
        cloudResourceType: type,
      },
      select: CLOUD_APP_SITE_SELECT,
      sort: {},
      skip: 0,
      limit: 1,
    });

  return result.data[0] || null;
}

// The site, or slot, the server tied an App Service app to.
export async function fetchKeptCloudAppSite(
  app: CloudAppKeptSiteSource,
): Promise<CloudResource | null> {
  return isAppServiceApp(app)
    ? await fetchKeptCloudAppPlatformResource(app)
    : null;
}

/*
 * Read the app's resource: the row resolveCloudAppPlatformResource picks
 * among the candidates. Null when the app has none to look up, or none is
 * found. Rejects when the read fails.
 */
export async function fetchCloudAppPlatformResource(
  app: CloudAppPlatformResourceSource,
  environment?: CloudAppPlatformEnvironment | null | undefined,
): Promise<CloudResource | null> {
  return resolveCloudAppPlatformResource({
    app,
    candidates: await fetchCloudAppPlatformCandidates(app, environment),
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
  // The 4xx answers (#10294): requests the app refused as the client's fault.
  ClientErrors = "http4xx",
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
  [AppServiceMetric.ClientErrors]: {
    metricName: "Http4xx",
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
  // The 4xx answers, drawn beside the requests and the 5xx ones.
  clientErrors?: Array<AppServiceSeriesPoint> | undefined;
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
