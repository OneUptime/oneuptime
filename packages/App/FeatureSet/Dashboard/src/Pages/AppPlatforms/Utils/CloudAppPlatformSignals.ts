import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  APP_SERVICE_SITE_TYPE,
  APP_SERVICE_SLOT_TYPE,
  getCloudAppPlatformResourceType,
  hasCloudAppPlatformResource,
} from "Common/Types/Cloud/CloudAppPlatformResourceMatch";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { getCloudMonitoredResourceAttributeFilters } from "../../Cloud/Utils/CloudMonitoredResourceScope";
import {
  AZURE_MONITOR,
  CloudAppPlatformErrorLabel,
  CloudAppPlatformFigure,
  CloudAppPlatformMetricRead,
  CloudAppPlatformProfile,
  getCloudAppPlatformListReads,
  getCloudAppPlatformProfile,
} from "./CloudAppPlatformMetrics";
import { CLOUD_APP_SIGNAL_WINDOW_MINUTES } from "./CloudAppReads";
import {
  CloudAppArrivalSource,
  hasCloudAppSentTraces,
} from "./CloudAppTelemetrySetup";

/*
 * AN APP'S PLATFORM NUMBERS, IN A LIST OF APPS (#10406, #6793, #6794).
 *
 * All Apps, an environment's Apps tab and its Overview's Apps card show
 * each app's requests, error rate and p95 over the last hour, from its
 * traces. An app that sends no traces said "No traces" there, though its
 * provider's monitoring counts the requests of the resource it runs as
 * whatever the app sends - the numbers its own page draws in its platform
 * section. Now such an app shows them: the requests counted, the share
 * answered with a 5xx status and the response time, marked with the
 * service that measured them (Azure Monitor, Google Cloud Monitoring,
 * Amazon CloudWatch), never mistaken for traced requests:
 *
 *   - an App Service site or slot: Requests, Http5xx and the mean
 *     HttpResponseTime;
 *   - a Container App: Requests and the mean ResponseTime - Azure Monitor's
 *     Requests are read whole, so its 5xx share is unknown, never 0;
 *   - a Cloud Run or App Engine service: its request count, read once by
 *     its response code (response_code_class, response_code), whose 5xx
 *     groups are its server errors, and its latency's 95th percentile;
 *   - an App Runner service: Requests, 5xxStatusResponses and the mean
 *     RequestLatency;
 *   - an ECS service: nothing. ECS publishes no requests of its own
 *     (CloudAppPlatformMetrics), so its list says what its traces say.
 *
 * The resource is the one the server keeps on the app
 * (CloudApp.platformCloudResourceId, #10407): no look-up per row. The
 * resources are read with the reader's own permissions, so one they may
 * not read - a label they are not given - shows no numbers, and only the
 * resources read are asked for their metrics. Those come in a few reads for
 * the whole list, not a few per row: one per metric and stored name and
 * set of attributes that name a resource (getCloudMonitoredResourceAttribute
 * Filters: Azure's azuremonitor.resource_id, a Cloud Monitoring type's
 * labels, a CloudWatch namespace's dimensions), grouped by those
 * attributes, each a total of the hour.
 */

// The window a list's platform numbers are over: the same hour as its traces'.
export const CLOUD_APP_PLATFORM_SIGNAL_WINDOW_MINUTES: number =
  CLOUD_APP_SIGNAL_WINDOW_MINUTES;

// The most groups one read answers: far more resources than a page lists.
const PLATFORM_SIGNAL_ROW_LIMIT: number = 1000;

// The subset of CloudApp a list reads to tell whether it shows its platform's numbers.
export interface CloudAppPlatformSignalSource extends CloudAppArrivalSource {
  _id?: unknown;
  id?: unknown;
  name?: string | null | undefined;
  cloudPlatform?: string | null | undefined;
  groupName?: string | null | undefined;
  providerResourceId?: string | null | undefined;
  platformCloudResourceId?: unknown;
}

// What a list's latency is: a mean, or a 95th percentile.
export type CloudAppPlatformLatencyKind = "average" | "p95";

// The resource's numbers over the hour; null where none was measured.
export interface CloudAppPlatformSignals {
  requests: number | null;
  serverErrors: number | null;
  serverErrorRatePercent: number | null;
  // Its mean response time, or its 95th percentile (latency).
  responseTimeMs: number | null;
  latency: CloudAppPlatformLatencyKind;
  // The provider's monitoring the numbers are from: "Azure Monitor".
  service: string;
  // An App Service site's or slot's, which a list says as a site's.
  isAppService: boolean;
}

export interface CloudAppPlatformSignalResult {
  // By app id: the apps whose resource's numbers were read.
  signals: Map<string, CloudAppPlatformSignals>;
  // A read failed: those apps say only what their traces say.
  failed: boolean;
}

// An App Service site's and slot's types, as compared.
const APP_SERVICE_TYPES: ReadonlySet<string> = new Set<string>([
  APP_SERVICE_SITE_TYPE.toLowerCase(),
  APP_SERVICE_SLOT_TYPE.toLowerCase(),
]);

function idOf(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function typeOf(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/*
 * Whether a list shows the app's platform numbers: an app the server tied
 * to the resource it runs as, of a type a list reads numbers of (not an
 * ECS service), that has sent no trace - whose requests, errors and
 * latency the list could otherwise only say are unknown.
 */
export function showsCloudAppPlatformSignals(
  app: CloudAppPlatformSignalSource,
): boolean {
  return (
    Boolean(idOf(app.platformCloudResourceId)) &&
    hasCloudAppPlatformResource(app) &&
    getCloudAppPlatformListReads({
      type: getCloudAppPlatformResourceType(app),
      readings: null,
    }).length > 0 &&
    !hasCloudAppSentTraces(app)
  );
}

// The resource each such app keeps, by app id.
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
 * The attributes a resource's metrics are filed under - its row's own
 * (CloudResource.telemetryAttributes) - by name, or null for a row that
 * names none: it is left out rather than read unscoped.
 */
export function getPlatformResourceFilters(
  site: Pick<CloudResource, "cloudResourceKind" | "telemetryAttributes"> | null,
): Record<string, string> | null {
  const filters: Record<string, string> =
    getCloudMonitoredResourceAttributeFilters(site);

  return Object.keys(filters).length > 0 ? filters : null;
}

// The attribute keys a filter holds, in one order: what its read groups by.
function keysOf(filters: Record<string, string>): Array<string> {
  return Object.keys(filters).sort();
}

// A resource's values of `keys`, as one signature.
function signatureOf(values: ReadonlyArray<string>): string {
  return values.join("\n");
}

// The service whose numbers a resource of `type` has.
export function getCloudAppPlatformServiceOfType(
  type: string | null | undefined,
): string {
  const profile: CloudAppPlatformProfile | null =
    getCloudAppPlatformProfile(type);

  return profile ? profile.service : AZURE_MONITOR;
}

// One grouped read: one metric, under one stored name, of these resources.
export interface CloudAppPlatformGroupRead extends CloudAppPlatformMetricRead {
  // The attributes that name each resource, in order: what the read groups by.
  keys: Array<string>;
  // Each resource's values of `keys`.
  resources: Array<Array<string>>;
}

function readKeyOf(read: {
  figure: CloudAppPlatformFigure;
  storedName: string;
  keys: ReadonlyArray<string>;
}): string {
  return [read.figure, read.storedName, ...read.keys].join("|");
}

type PlatformSite = Pick<
  CloudResource,
  | "cloudResourceKind"
  | "cloudResourceType"
  | "telemetryAttributes"
  | "cloudReadings"
>;

/*
 * The grouped reads a list's resources take: per metric, one for each
 * stored name the resources keep it under and set of attributes that name
 * them (getCloudAppPlatformListReads - one of each, as a rule). Exported
 * for tests.
 */
export function getCloudAppPlatformMetricReads(
  sites: ReadonlyArray<PlatformSite>,
): Array<CloudAppPlatformGroupRead> {
  const reads: Map<string, CloudAppPlatformGroupRead> = new Map<
    string,
    CloudAppPlatformGroupRead
  >();

  for (const site of sites) {
    const filters: Record<string, string> | null =
      getPlatformResourceFilters(site);

    if (!filters) {
      continue;
    }

    const keys: Array<string> = keysOf(filters);
    const values: Array<string> = keys.map((key: string): string => {
      return filters[key]!;
    });

    for (const entry of getCloudAppPlatformListReads({
      type: site.cloudResourceType,
      readings: site.cloudReadings,
    })) {
      const key: string = readKeyOf({ ...entry, keys });
      let read: CloudAppPlatformGroupRead | undefined = reads.get(key);

      if (!read) {
        read = { ...entry, keys, resources: [] };
        reads.set(key, read);
      }

      if (
        !read.resources.some((known: Array<string>): boolean => {
          return signatureOf(known) === signatureOf(values);
        })
      ) {
        read.resources.push(values);
      }
    }
  }

  return Array.from(reads.values());
}

// One resource's value of a read over the hour; its 5xx when the read splits them.
export interface CloudAppPlatformGroupValue {
  value: number;
  serverErrors?: number | undefined;
}

/*
 * One grouped read's values, by the signature of each group's resource
 * (its values of `keys`): each group's value over the hour, scaled, and -
 * for requests read by their response code - its 5xx among them. A
 * resource with no group sent nothing of the metric: unknown, never 0.
 * Exported for tests.
 */
export function readPlatformMetricGroups(data: {
  rows: ReadonlyArray<AggregatedModel>;
  keys: ReadonlyArray<string>;
  scale?: number | undefined;
  errorLabel?: CloudAppPlatformErrorLabel | undefined;
}): Map<string, CloudAppPlatformGroupValue> {
  const values: Map<string, CloudAppPlatformGroupValue> = new Map<
    string,
    CloudAppPlatformGroupValue
  >();
  const scale: number = data.scale ?? 1;

  for (const row of data.rows) {
    const attributes: unknown = row["attributes"];
    const record: Record<string, unknown> =
      attributes && typeof attributes === "object"
        ? (attributes as Record<string, unknown>)
        : {};
    const parts: Array<string> = data.keys.map((key: string): string => {
      const part: unknown = record[key];

      return typeof part === "string" ? part : "";
    });
    const value: number = Number(row["value"]) * scale;

    if (
      parts.some((part: string): boolean => {
        return !part;
      }) ||
      !Number.isFinite(value)
    ) {
      continue;
    }

    const signature: string = signatureOf(parts);
    const group: CloudAppPlatformGroupValue = values.get(signature) || {
      value: 0,
      ...(data.errorLabel ? { serverErrors: 0 } : {}),
    };

    // Two buckets of one resource (a split answer) add up, as a total does.
    group.value += value;

    if (data.errorLabel) {
      const label: unknown = record[data.errorLabel.attribute];

      if (
        (typeof label === "string" || typeof label === "number") &&
        data.errorLabel.isServerError(String(label))
      ) {
        group.serverErrors = (group.serverErrors || 0) + value;
      }
    }

    values.set(signature, group);
  }

  return values;
}

// A figure's read, and its value for one resource.
interface FigureValue {
  read: CloudAppPlatformMetricRead;
  value: CloudAppPlatformGroupValue | null;
}

// A read's value for a resource: as named, else whatever its values' case.
function valueOf(
  values: ReadonlyMap<string, CloudAppPlatformGroupValue> | undefined,
  signature: string,
): CloudAppPlatformGroupValue | null {
  if (!values) {
    return null;
  }

  const exact: CloudAppPlatformGroupValue | undefined = values.get(signature);

  if (exact !== undefined) {
    return exact;
  }

  for (const [key, value] of values) {
    if (key.toLowerCase() === signature.toLowerCase()) {
      return value;
    }
  }

  return null;
}

/*
 * A resource's numbers from the reads' values: the hour's requests and 5xx
 * answers, their share, and its latency, summed as its page's section sums
 * them. Exported for tests.
 */
export function summarizePlatformSite(data: {
  site: PlatformSite;
  values: ReadonlyMap<string, ReadonlyMap<string, CloudAppPlatformGroupValue>>;
}): CloudAppPlatformSignals | null {
  const filters: Record<string, string> | null = getPlatformResourceFilters(
    data.site,
  );
  const reads: Array<CloudAppPlatformMetricRead> = getCloudAppPlatformListReads(
    { type: data.site.cloudResourceType, readings: data.site.cloudReadings },
  );

  if (!filters || reads.length === 0) {
    return null;
  }

  const keys: Array<string> = keysOf(filters);
  const signature: string = signatureOf(
    keys.map((key: string): string => {
      return filters[key]!;
    }),
  );
  const figure: (wanted: CloudAppPlatformFigure) => FigureValue | null = (
    wanted: CloudAppPlatformFigure,
  ): FigureValue | null => {
    const read: CloudAppPlatformMetricRead | undefined = reads.find(
      (entry: CloudAppPlatformMetricRead): boolean => {
        return entry.figure === wanted;
      },
    );

    return read
      ? {
          read,
          value: valueOf(
            data.values.get(readKeyOf({ ...read, keys })),
            signature,
          ),
        }
      : null;
  };

  const requestsRead: FigureValue | null = figure(
    CloudAppPlatformFigure.Requests,
  );
  const requests: number | null = requestsRead?.value
    ? requestsRead.value.value
    : null;
  const errorsRead: FigureValue | null = figure(
    CloudAppPlatformFigure.ServerErrors,
  );
  const serverErrors: number | null = requestsRead?.read.errorLabel
    ? (requestsRead.value?.serverErrors ?? null)
    : errorsRead?.value
      ? errorsRead.value.value
      : null;
  const p95: FigureValue | null = figure(CloudAppPlatformFigure.Latency);
  const latency: FigureValue | null =
    p95 || figure(CloudAppPlatformFigure.ResponseTime);

  return {
    requests,
    serverErrors,
    /*
     * A site's 5xx are counted 0 in an interval with none, and a Cloud
     * Monitoring count's are read with its requests: a site with requests
     * and no 5xx value at all was not read, its rate unknown, not 0%.
     */
    serverErrorRatePercent:
      requests !== null && requests > 0 && serverErrors !== null
        ? (serverErrors / requests) * 100
        : null,
    responseTimeMs: latency?.value ? latency.value.value : null,
    latency: p95 ? "p95" : "average",
    service: getCloudAppPlatformServiceOfType(data.site.cloudResourceType),
    isAppService: APP_SERVICE_TYPES.has(typeOf(data.site.cloudResourceType)),
  };
}

async function readGroupedMetric(data: {
  read: CloudAppPlatformGroupRead;
  start: Date;
  end: Date;
}): Promise<Map<string, CloudAppPlatformGroupValue>> {
  const attributes: Record<string, Includes> = {};

  data.read.keys.forEach((key: string, index: number) => {
    attributes[key] = new Includes(
      Array.from(
        new Set<string>(
          data.read.resources.map((values: Array<string>): string => {
            return values[index]!;
          }),
        ),
      ),
    );
  });

  const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
    modelType: Metric,
    aggregateBy: {
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
        time: new InBetween<Date>(data.start, data.end),
        name: data.read.storedName,
        attributes,
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
      groupByAttributeKeys: [
        ...data.read.keys,
        ...(data.read.errorLabel ? [data.read.errorLabel.attribute] : []),
      ],
    },
  });

  return readPlatformMetricGroups({
    rows: (result.data || []) as Array<AggregatedModel>,
    keys: data.read.keys,
    scale: data.read.scale,
    errorLabel: data.read.errorLabel,
  });
}

/*
 * The platform numbers of a list's apps (see the top of this file): the
 * resources the server keeps for the apps that send no traces, read as the
 * reader may, and their requests, 5xx answers and latency over the last
 * hour. An app whose resource the reader may not read, or is not of the
 * type it runs as now, or reported nothing of a metric, has nothing for
 * it. Never rejects: a read that fails is said in `failed`.
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

  // The type each kept resource must be: the one its app runs as now.
  const typeByApp: Map<string, string> = new Map<string, string>();

  for (const app of data.apps) {
    const appId: string = idOf(app._id) || idOf(app.id);

    if (siteIdsByApp.has(appId)) {
      typeByApp.set(appId, typeOf(getCloudAppPlatformResourceType(app)));
    }
  }

  const siteIds: Array<string> = Array.from(new Set(siteIdsByApp.values()));
  const end: Date = data.now || OneUptimeDate.getCurrentDate();
  const start: Date = OneUptimeDate.addRemoveMinutes(
    end,
    -CLOUD_APP_PLATFORM_SIGNAL_WINDOW_MINUTES,
  );

  try {
    // As the reader may read them: a resource they may not is not answered.
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
        },
        select: {
          _id: true,
          cloudResourceKind: true,
          cloudResourceType: true,
          telemetryAttributes: true,
          cloudReadings: true,
        },
        sort: {},
        skip: 0,
        limit: siteIds.length,
      })
    ).data;

    const reads: Array<CloudAppPlatformGroupRead> =
      getCloudAppPlatformMetricReads(sites);
    const values: Map<string, Map<string, CloudAppPlatformGroupValue>> =
      new Map<string, Map<string, CloudAppPlatformGroupValue>>();

    await Promise.all(
      reads.map(async (read: CloudAppPlatformGroupRead): Promise<void> => {
        values.set(readKeyOf(read), await readGroupedMetric({ read, start, end }));
      }),
    );

    const bySite: Map<string, { type: string; signals: CloudAppPlatformSignals }> =
      new Map<string, { type: string; signals: CloudAppPlatformSignals }>();

    for (const site of sites) {
      const summary: CloudAppPlatformSignals | null = site._id
        ? summarizePlatformSite({ site, values })
        : null;

      if (summary) {
        bySite.set(idOf(site._id), {
          type: typeOf(site.cloudResourceType),
          signals: summary,
        });
      }
    }

    for (const [appId, siteId] of siteIdsByApp) {
      const site: { type: string; signals: CloudAppPlatformSignals } | undefined =
        bySite.get(siteId);

      if (site && site.type === typeByApp.get(appId)) {
        signals.set(appId, site.signals);
      }
    }

    return { signals, failed: false };
  } catch {
    return { signals, failed: true };
  }
}
