import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
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
import { formatDurationMs } from "../../../Components/TelemetryResource/telemetryFormat";

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
 *   2. else the site named as the app is: an App Service app's name is its
 *      service.name, which the detectors read from WEBSITE_SITE_NAME, and a
 *      site's name is unique across Azure (it is its azurewebsites.net
 *      host name).
 *
 * An app kept apart by a deployment slot other than production (its group,
 * from WEBSITE_SLOT_NAME) has none: Azure Monitor measures each slot as a
 * resource of its own (Microsoft.Web/sites/slots), whose metrics a
 * connection does not read, and the site's are the production slot's alone
 * - never another slot's, though the detectors write the site's id for
 * every slot.
 *
 * Read with a name prefix (a stored name may carry a qualifier: "checkout
 * (Web App)" beside its plan "checkout"), then confirmed from each row's
 * ARM id. React-free apart from the read, so the matching is tested alone.
 */

export const APP_SERVICE_SITE_TYPE: string = "Microsoft.Web/sites";
// The slot every site has, which IS the site.
export const APP_SERVICE_PRODUCTION_SLOT: string = "production";

// The most rows one look-up reads: far more sites than share a name prefix.
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
}

/*
 * Whether the app has a resource to look up: an App Service app's site, for
 * its production slot (see the top of this file). App Service only, for now.
 */
export function hasCloudAppPlatformResource(
  app: CloudAppPlatformResourceSource,
): boolean {
  return (
    app.cloudPlatform === ManagedCloudPlatform.AzureAppService &&
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
 * The app's site among `candidates`: its id's, else the site's by name
 * (see the top of this file). When two rows name it - a listing and a
 * metrics row of one site in two spellings - the one seen last wins. Null
 * when none does, and for an app of another slot than production.
 */
export function matchCloudAppPlatformResource<
  T extends CloudPlatformResourceCandidate,
>(data: {
  app: CloudAppPlatformResourceSource;
  candidates: ReadonlyArray<T>;
}): T | null {
  const site: string = getCloudAppSiteName(data.app).toLowerCase();

  if (!site || getCloudAppSlotName(data.app) !== null) {
    return null;
  }

  const parsedCandidates: Array<{ row: T; parsed: ParsedAzureResourceId }> = [];

  for (const row of data.candidates) {
    const parsed: ParsedAzureResourceId | null = row.providerResourceId
      ? parseAzureResourceId(row.providerResourceId)
      : null;

    if (parsed) {
      parsedCandidates.push({ row, parsed });
    }
  }

  const latest: (rows: Array<T>) => T | null = (rows: Array<T>): T | null => {
    const sorted: Array<T> = [...rows].sort((a: T, b: T): number => {
      return timeOf(b.lastSeenAt) - timeOf(a.lastSeenAt);
    });

    return sorted[0] || null;
  };

  const ownId: string = (data.app.providerResourceId || "")
    .trim()
    .toLowerCase();

  if (ownId) {
    const byId: T | null = latest(
      parsedCandidates
        .filter((candidate: { row: T; parsed: ParsedAzureResourceId }) => {
          return (
            (candidate.row.providerResourceId || "").trim().toLowerCase() ===
            ownId
          );
        })
        .map((candidate: { row: T; parsed: ParsedAzureResourceId }): T => {
          return candidate.row;
        }),
    );

    if (byId) {
      return byId;
    }
  }

  return latest(
    parsedCandidates
      .filter((candidate: { row: T; parsed: ParsedAzureResourceId }) => {
        return (
          candidate.parsed.type.toLowerCase() ===
            APP_SERVICE_SITE_TYPE.toLowerCase() &&
          candidate.parsed.name.toLowerCase() === site
        );
      })
      .map((candidate: { row: T; parsed: ParsedAzureResourceId }): T => {
        return candidate.row;
      }),
  );
}

function timeOf(value: Date | string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const time: number = new Date(value).getTime();

  return Number.isFinite(time) ? time : 0;
}

/*
 * Read the app's resource: the Azure site rows whose name starts with the
 * site's, matched as above. Null when the app has none to look up, or none
 * is found. Rejects when the read fails, so the page can tell "not found"
 * from "could not check".
 */
export async function fetchCloudAppPlatformResource(
  app: CloudAppPlatformResourceSource,
): Promise<CloudResource | null> {
  if (!hasCloudAppPlatformResource(app)) {
    return null;
  }

  const result: { data: Array<CloudResource> } =
    await ModelAPI.getList<CloudResource>({
      modelType: CloudResource,
      query: {
        cloudResourceKind: CloudResourceKind.Resource,
        cloudProvider: CloudProvider.Azure,
        cloudResourceType: APP_SERVICE_SITE_TYPE,
        name: new StartsWith(getCloudAppSiteName(app)),
      },
      select: {
        _id: true,
        name: true,
        cloudResourceKind: true,
        cloudResourceType: true,
        cloudProvider: true,
        providerResourceId: true,
        telemetryAttributes: true,
        cloudReadings: true,
        lastSeenAt: true,
      },
      sort: { lastSeenAt: SortOrder.Descending },
      skip: 0,
      limit: CLOUD_APP_PLATFORM_RESOURCE_READ_LIMIT,
    });

  return matchCloudAppPlatformResource({ app, candidates: result.data });
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
): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 60) {
    return formatDurationMs(seconds === null ? null : seconds * 1000);
  }

  return formatDurationCompactInLanguage(seconds, language);
}
