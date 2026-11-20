import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudMonitoredResource";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { getCloudMonitoredResourceAttributeFilters } from "../../Cloud/Utils/CloudMonitoredResourceScope";
import {
  APP_SERVICE_SITE_TYPE,
  AppServiceMetric,
  AppServiceSeriesPoint,
  AppServiceSummary,
  getAppServiceStoredMetricName,
  hasCloudAppPlatformResource,
  summarizeAppServiceSeries,
} from "./CloudAppPlatformResource";
import { CLOUD_APP_SIGNAL_WINDOW_MINUTES } from "./CloudAppReads";
import {
  CloudAppArrivalSource,
  hasCloudAppSentTraces,
} from "./CloudAppTelemetrySetup";

/*
 * AN APP SERVICE APP'S SITE NUMBERS, IN A LIST OF APPS (#10406).
 *
 * All Apps, an environment's Apps tab and its Overview's Apps card show
 * each app's requests, error rate and p95 over the last hour, from its
 * traces. An App Service app that sends no traces said "No traces" there,
 * though Azure Monitor counts its site's requests whatever the app sends -
 * the numbers its own page draws in its Azure Monitor section. Now such an
 * app shows its site's: the requests Azure Monitor counted, the share
 * answered with a 5xx status and the average response time, marked as
 * Azure Monitor's, never mistaken for traced requests.
 *
 * The site is the one the server keeps on the app
 * (CloudApp.platformCloudResourceId, #10407): no look-up per row. The
 * sites are read with the reader's own permissions, so a site they may not
 * read - a label they are not given - shows no numbers, and only the sites
 * read are asked for their metrics. Those come in three reads for the whole
 * list, not three per row: one per metric, grouped by the stored attribute
 * that names each site (azuremonitor.resource_id), each a total of the
 * hour.
 */

// The window a list's site numbers are over: the same hour as its traces'.
export const CLOUD_APP_PLATFORM_SIGNAL_WINDOW_MINUTES: number =
  CLOUD_APP_SIGNAL_WINDOW_MINUTES;

// The most groups one read answers: far more sites than a page lists.
const PLATFORM_SIGNAL_ROW_LIMIT: number = 1000;

// The subset of CloudApp a list reads to tell whether it shows its site's numbers.
export interface CloudAppPlatformSignalSource extends CloudAppArrivalSource {
  _id?: unknown;
  id?: unknown;
  name?: string | null | undefined;
  cloudPlatform?: string | null | undefined;
  groupName?: string | null | undefined;
  providerResourceId?: string | null | undefined;
  platformCloudResourceId?: unknown;
}

// The site's numbers over the hour; null where none was measured.
export type CloudAppPlatformSignals = Pick<
  AppServiceSummary,
  "requests" | "serverErrors" | "serverErrorRatePercent" | "responseTimeMs"
>;

export interface CloudAppPlatformSignalResult {
  // By app id: the apps whose site's numbers were read.
  signals: Map<string, CloudAppPlatformSignals>;
  // A read failed: those apps say only what their traces say.
  failed: boolean;
}

function idOf(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

/*
 * Whether a list shows the app's site's numbers: an App Service app the
 * server tied to its site, that has sent no trace - whose requests, errors
 * and latency the list could otherwise only say are unknown.
 */
export function showsCloudAppPlatformSignals(
  app: CloudAppPlatformSignalSource,
): boolean {
  return (
    Boolean(idOf(app.platformCloudResourceId)) &&
    hasCloudAppPlatformResource(app) &&
    !hasCloudAppSentTraces(app)
  );
}

// The site each such app keeps, by app id.
export function getCloudAppPlatformSiteIds(
  apps: ReadonlyArray<CloudAppPlatformSignalSource>,
): Map<string, string> {
  const siteIds: Map<string, string> = new Map<string, string>();

  for (const app of apps) {
    const appId: string = idOf(app._id) || idOf(app.id);

    if (appId && showsCloudAppPlatformSignals(app)) {
      siteIds.set(appId, idOf(app.platformCloudResourceId));
    }
  }

  return siteIds;
}

/*
 * The attribute value a site's metrics are filed under, when that is all
 * that names them - as for every Azure resource. Null for a row whose
 * metrics are named otherwise: it is left out rather than read unscoped.
 */
export function getPlatformSiteMetricKey(
  site: Pick<CloudResource, "cloudResourceKind" | "telemetryAttributes"> | null,
): string | null {
  const filters: Record<string, string> =
    getCloudMonitoredResourceAttributeFilters(site);
  const keys: Array<string> = Object.keys(filters);

  if (keys.length !== 1 || keys[0] !== AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE) {
    return null;
  }

  return filters[AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE] || null;
}

// What the list reads of each site, and how each metric sums over the hour.
const PLATFORM_SIGNAL_METRICS: ReadonlyArray<{
  metric: AppServiceMetric;
  aggregationType: AggregationType;
}> = [
  { metric: AppServiceMetric.Requests, aggregationType: AggregationType.Sum },
  {
    metric: AppServiceMetric.ServerErrors,
    aggregationType: AggregationType.Sum,
  },
  {
    metric: AppServiceMetric.ResponseTime,
    aggregationType: AggregationType.Avg,
  },
];

// One grouped read: one metric, under one stored name, of these sites.
export interface CloudAppPlatformMetricRead {
  metric: AppServiceMetric;
  storedName: string;
  aggregationType: AggregationType;
  // The sites' azuremonitor.resource_id values.
  resourceIds: Array<string>;
}

/*
 * The grouped reads a list's sites take: per metric, one for each stored
 * name the sites keep it under (getAppServiceStoredMetricName - one, as a
 * rule). Exported for tests.
 */
export function getCloudAppPlatformMetricReads(
  sites: ReadonlyArray<
    Pick<
      CloudResource,
      "cloudResourceKind" | "telemetryAttributes" | "cloudReadings"
    >
  >,
): Array<CloudAppPlatformMetricRead> {
  const reads: Map<string, CloudAppPlatformMetricRead> = new Map<
    string,
    CloudAppPlatformMetricRead
  >();

  for (const site of sites) {
    const resourceId: string | null = getPlatformSiteMetricKey(site);

    if (!resourceId) {
      continue;
    }

    for (const entry of PLATFORM_SIGNAL_METRICS) {
      const storedName: string = getAppServiceStoredMetricName({
        metric: entry.metric,
        readings: site.cloudReadings,
      });
      const key: string = `${entry.metric}|${storedName}`;
      let read: CloudAppPlatformMetricRead | undefined = reads.get(key);

      if (!read) {
        read = {
          metric: entry.metric,
          storedName,
          aggregationType: entry.aggregationType,
          resourceIds: [],
        };
        reads.set(key, read);
      }

      if (!read.resourceIds.includes(resourceId)) {
        read.resourceIds.push(resourceId);
      }
    }
  }

  return Array.from(reads.values());
}

/*
 * One grouped read's values, by azuremonitor.resource_id: each group's
 * value over the hour. A site with no group sent nothing of the metric -
 * unknown, never 0. Exported for tests.
 */
export function readPlatformMetricGroups(
  rows: ReadonlyArray<AggregatedModel>,
): Map<string, number> {
  const values: Map<string, number> = new Map<string, number>();

  for (const row of rows) {
    const attributes: unknown = row["attributes"];
    const resourceId: unknown =
      attributes && typeof attributes === "object"
        ? (attributes as Record<string, unknown>)[
            AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE
          ]
        : undefined;
    const value: number = Number(row["value"]);

    if (
      typeof resourceId === "string" &&
      resourceId &&
      Number.isFinite(value)
    ) {
      // Two buckets of one site (a split answer) add up, as a total does.
      values.set(resourceId, (values.get(resourceId) || 0) + value);
    }
  }

  return values;
}

// A metric's value for a site: as named, else whatever its id's case.
function valueOf(
  values: ReadonlyMap<string, number> | undefined,
  resourceId: string,
): number | null {
  if (!values) {
    return null;
  }

  const exact: number | undefined = values.get(resourceId);

  if (exact !== undefined) {
    return exact;
  }

  for (const [key, value] of values) {
    if (key.toLowerCase() === resourceId.toLowerCase()) {
      return value;
    }
  }

  return null;
}

/*
 * A site's numbers from the reads' values: the hour's total requests and
 * 5xx answers, their share, and the mean response time (Azure Monitor
 * reports it in seconds), summed as the app's page sums its Azure Monitor
 * section (summarizeAppServiceSeries). Exported for tests.
 */
export function summarizePlatformSite(data: {
  resourceId: string;
  readings: unknown;
  values: ReadonlyMap<string, ReadonlyMap<string, number>>;
  at: Date;
}): CloudAppPlatformSignals {
  const pointOf: (metric: AppServiceMetric) => Array<AppServiceSeriesPoint> = (
    metric: AppServiceMetric,
  ): Array<AppServiceSeriesPoint> => {
    const storedName: string = getAppServiceStoredMetricName({
      metric,
      readings: data.readings,
    });
    const value: number | null = valueOf(
      data.values.get(`${metric}|${storedName}`),
      data.resourceId,
    );

    return value === null ? [] : [{ x: data.at, y: value }];
  };

  const summary: AppServiceSummary = summarizeAppServiceSeries({
    requests: pointOf(AppServiceMetric.Requests),
    serverErrors: pointOf(AppServiceMetric.ServerErrors),
    responseTimeSeconds: pointOf(AppServiceMetric.ResponseTime),
    cpuTimeSeconds: [],
    memoryBytes: [],
  });

  return {
    requests: summary.requests,
    serverErrors: summary.serverErrors,
    serverErrorRatePercent: summary.serverErrorRatePercent,
    responseTimeMs: summary.responseTimeMs,
  };
}

async function readGroupedMetric(data: {
  read: CloudAppPlatformMetricRead;
  start: Date;
  end: Date;
}): Promise<Map<string, number>> {
  const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
    modelType: Metric,
    aggregateBy: {
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
        time: new InBetween<Date>(data.start, data.end),
        name: data.read.storedName,
        attributes: {
          [AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE]: new Includes(
            data.read.resourceIds,
          ),
        },
      } as unknown as Query<Metric>,
      aggregationType: data.read.aggregationType,
      aggregationInterval: AggregationInterval.Total,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: data.start,
      endTimestamp: data.end,
      limit: PLATFORM_SIGNAL_ROW_LIMIT,
      skip: 0,
      sort: { time: SortOrder.Descending },
      groupByAttributeKeys: [AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE],
    },
  });

  return readPlatformMetricGroups(
    (result.data || []) as Array<AggregatedModel>,
  );
}

/*
 * The site numbers of a list's apps (see the top of this file): the sites
 * the server keeps for the App Service apps that send no traces, read as
 * the reader may, and their requests, 5xx answers and response time over
 * the last hour. An app whose site the reader may not read, or whose site
 * reported nothing of a metric, has nothing for it. Never rejects: a read
 * that fails is said in `failed`.
 */
export async function fetchCloudAppPlatformSignals(data: {
  apps: ReadonlyArray<CloudAppPlatformSignalSource>;
  now?: Date | undefined;
}): Promise<CloudAppPlatformSignalResult> {
  const siteIdsByApp: Map<string, string> = getCloudAppPlatformSiteIds(
    data.apps,
  );
  const signals: Map<string, CloudAppPlatformSignals> = new Map<
    string,
    CloudAppPlatformSignals
  >();

  if (siteIdsByApp.size === 0 || !ProjectUtil.getCurrentProjectId()) {
    return { signals, failed: false };
  }

  const siteIds: Array<string> = Array.from(new Set(siteIdsByApp.values()));
  const end: Date = data.now || OneUptimeDate.getCurrentDate();
  const start: Date = OneUptimeDate.addRemoveMinutes(
    end,
    -CLOUD_APP_PLATFORM_SIGNAL_WINDOW_MINUTES,
  );

  try {
    // As the reader may read them: a site they may not is not answered.
    const sites: Array<CloudResource> = (
      await ModelAPI.getList<CloudResource>({
        modelType: CloudResource,
        query: {
          _id: new Includes(
            siteIds.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
          cloudResourceKind: CloudResourceKind.Resource,
          cloudResourceType: APP_SERVICE_SITE_TYPE,
        },
        select: {
          _id: true,
          cloudResourceKind: true,
          telemetryAttributes: true,
          cloudReadings: true,
        },
        sort: {},
        skip: 0,
        limit: siteIds.length,
      })
    ).data;

    const reads: Array<CloudAppPlatformMetricRead> =
      getCloudAppPlatformMetricReads(sites);
    const values: Map<string, Map<string, number>> = new Map<
      string,
      Map<string, number>
    >();

    await Promise.all(
      reads.map(async (read: CloudAppPlatformMetricRead): Promise<void> => {
        values.set(
          `${read.metric}|${read.storedName}`,
          await readGroupedMetric({ read, start, end }),
        );
      }),
    );

    const bySite: Map<string, CloudAppPlatformSignals> = new Map<
      string,
      CloudAppPlatformSignals
    >();

    for (const site of sites) {
      const resourceId: string | null = getPlatformSiteMetricKey(site);

      if (resourceId && site._id) {
        bySite.set(
          idOf(site._id),
          summarizePlatformSite({
            resourceId,
            readings: site.cloudReadings,
            values,
            at: end,
          }),
        );
      }
    }

    for (const [appId, siteId] of siteIdsByApp) {
      const site: CloudAppPlatformSignals | undefined = bySite.get(siteId);

      if (site) {
        signals.set(appId, site);
      }
    }

    return { signals, failed: false };
  } catch {
    return { signals, failed: true };
  }
}
