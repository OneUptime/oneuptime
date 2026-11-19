import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  CloudAddedMetric,
  CloudAddedMetricDimension,
  CloudAddedMetricScope,
  addCloudAddedMetric,
  getCloudAddedMetricsOfResource,
  readCloudAddedMetrics,
  removeCloudAddedMetric,
  toStoredCloudAddedMetrics,
  AWS_ADDED_METRIC_STATISTICS,
  AZURE_ADDED_METRIC_AGGREGATIONS,
  AZURE_ADDED_METRIC_GRAINS,
  CLOUD_ADDED_METRIC_REFUSALS,
} from "../../../Types/Cloud/CloudAddedMetrics";
import {
  AzureTypeKeyMetrics,
  GCP_KEY_METRICS,
  GcpReadMetric,
  GcpTypeKeyMetrics,
  getAwsKeyMetric,
  getAwsNamespaceOfType,
  getAzureKeyMetrics,
  getAzureReadMetricNames,
  getGcpReadMetrics,
  isAzureStreamedKeyMetric,
} from "../../../Types/Cloud/CloudKeyMetrics";
import {
  AWS_CLOUDWATCH_DIMENSION_PREFIX,
  AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE,
  AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE,
  CLOUD_ACCOUNT_ID_ATTRIBUTE,
  CLOUD_REGION_ATTRIBUTE,
  GCP_RESOURCE_TYPE_ATTRIBUTE,
} from "../../../Types/Cloud/CloudMonitoredResource";
import { getAwsDocumentedMetricUnit } from "../../../Types/Cloud/AwsMetricUnits";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudPublishedMetric,
  CloudPublishedMetricBlock,
  CloudPublishedMetricStatus,
  CloudPublishedMetricsListing,
  sortCloudPublishedMetrics,
} from "../../../Types/Cloud/CloudPublishedMetrics";
import {
  CLOUD_UNREPORTED_LOOK_BACK_DAYS,
  CloudResourceKeyMetric,
  CloudUnreportedConnectionState,
  CloudUnreportedKeyMetricReport,
  explainCloudUnreportedKeyMetric,
  getCloudKeyMetricsOfResource,
} from "../../../Types/Cloud/CloudUnreportedKeyMetrics";
import {
  CloudStreamSummary,
  getStreamedMetricKey,
  getStreamedMetricKeys,
  readCloudStreamSummary,
} from "../../../Types/CloudConnection/CloudStream";
import {
  getAwsStreamCoverage,
  isAwsKeyMetricLeftToStream,
} from "../../../Types/CloudConnection/CloudStreamStack";
import {
  CloudConnectionReadSummary,
  readCloudConnectionReadSummary,
} from "../../../Types/CloudConnection/CloudConnectionTest";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudConnectionService from "../../Services/CloudConnectionService";
import CloudResourceService from "../../Services/CloudResourceService";
import MetricService from "../../Services/MetricService";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import { AwsCredentials } from "./Aws/AwsApi";
import AwsCloudConnector from "./Aws/AwsCloudConnector";
import {
  AwsListedMetric,
  findAwsMetricUnit,
  listMetrics,
} from "./Aws/AwsCloudWatch";
import AzureCloudConnector, {
  AZURE_FIVE_MINUTE_CURSOR,
  SelectedMetric,
  getAzureReadGroupKey,
  pickAzureGrain,
  selectAzureMetrics,
} from "./Azure/AzureCloudConnector";
import { AzureMetricDefinition } from "./Azure/AzureArm";
import CloudConnectionPullRunner from "./CloudConnectionPullRunner";
import CloudConnectionScheduler from "./CloudConnectionScheduler";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnectorCallOptions,
  CloudConnectorTransport,
  CloudReadBudget,
} from "./CloudConnectorTypes";
import GcpCloudConnector from "./Gcp/GcpCloudConnector";
import { GcpMetricDescriptor } from "./Gcp/GcpMonitoring";
import CloudLiveReadRateLimit from "./LiveRead/CloudLiveReadRateLimit";
import logger from "../Logger";

/*
 * A CLOUD RESOURCE'S METRICS, BEYOND THE KEY METRICS ITS CONNECTION READS.
 *
 *   - listPublished (#9563): what the resource publishes, asked of its
 *     cloud now, through its connection: an Azure resource's metric
 *     definitions, the CloudWatch metrics on an AWS resource's own
 *     dimensions (ListMetrics), the Cloud Monitoring metric descriptors a
 *     Google Cloud resource's type can report. All three are free. At most
 *     CLOUD_LIVE_READS_PER_MINUTE listings a minute per connection
 *     (CloudLiveReadRateLimit), each within a small budget of calls.
 *   - add and remove: a metric the listing found, read from then on for
 *     the resource or every resource of its type (CloudAddedMetrics, kept
 *     on the connection), within the caps.
 *   - explainUnreported (#9569): for the key metrics the resource did not
 *     report in the range its page shows, when it last did - or that it
 *     never did - and the likely reasons, from the catalog and from what
 *     OneUptime knows of its connection: its Azure metric definitions, its
 *     stream, its last read.
 *
 * The resource is the caller's to read (CloudResourceService with their
 * props); its connection is read as root once it is the resource's own.
 */

// One listing's budget: requests, and how long it may take.
export const CLOUD_PUBLISHED_METRICS_MAX_REQUESTS: number = 25;
/*
 * AWS: the additions with no unit yet a listing asks CloudWatch the unit
 * of, at most (#9809): a call each.
 */
export const CLOUD_PUBLISHED_METRICS_UNIT_PROBES: number = 2;
export const CLOUD_PUBLISHED_METRICS_MAX_DURATION_MS: number = 25 * 1000;
const REQUEST_TIMEOUT_MS: number = 15 * 1000;
const DAY_MS: number = 24 * 60 * 60 * 1000;

const LAST_REPORTED_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 20,
  timeoutOverflowMode: "throw",
});

/*
 * AWS: CloudWatch says nothing of a metric's statistic, so its name says
 * which is read by default (the page lets the person pick another). A
 * level, a share or a rate - "HealthyHostCount", "BucketSizeBytes",
 * "ReadIOPS", "CPUUtilization" - is read as its average; a count of what
 * happened in a period - "RequestCount", "5XXError", "NetworkIn",
 * "NumberOfMessagesSent" - as its sum; anything else as its average.
 */
const AWS_LEVEL_NAME: RegExp = new RegExp(
  "(iops|persecond|bps$|throughput$|utilization$|percent|ratio$|rate$|latency$|time$|duration$|age$|lag$|depth$|length$|size|usage$|used$|balance$|available|^free|remaining$|healthy|^active|current|concurrent|inservice|desired|pending|terminating|capacity$|^provisioned|memory|space$|state$|status$|health$|reservation$|credit)",
  "i",
);
const AWS_SUM_NAME: RegExp = new RegExp(
  "(\\dxx|count$|errors?$|requests$|invocations$|throttles$|throttled$|bytes$|packets$|ops$|operations$|calls$|failures$|hits$|misses$|drops$|dropped$|events$|records$|messages$|sent$|received$|deleted$|started$|failed$|succeeded$|timedout$|aborted$|successes$|evictions$|published$|delivered$|exceeded$|rules$|units$|responses$|in$|out$|downloaded$|uploaded$|destination$|blackhole$|noroute$|allocation$)",
  "i",
);

export interface CloudResourceMetricsDependencies {
  transport?: CloudConnectorTransport | undefined;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  // When each stored name last reported for the resource; ClickHouse when absent.
  findLastReported?:
    | ((data: {
        projectId: ObjectID;
        attributes: Record<string, string>;
        names: Array<string>;
        since: Date;
        until: Date;
      }) => Promise<Map<string, Date>>)
    | undefined;
  // Whether the per-connection limit is taken: tests turn it off.
  isRateLimited?: boolean | undefined;
}

// A resource and its connection, as the caller may read them.
interface CloudResourceTarget {
  resource: CloudResource;
  provider: CloudProvider;
  type: string;
  attributes: Record<string, string>;
  connection: CloudConnection | null;
}

const RESOURCE_SELECT: JSONObject = {
  _id: true,
  projectId: true,
  name: true,
  cloudProvider: true,
  cloudResourceType: true,
  cloudAccountId: true,
  cloudRegion: true,
  providerResourceId: true,
  telemetryAttributes: true,
  cloudConnectionId: true,
  createdAt: true,
};

const CONNECTION_SELECT: JSONObject = {
  _id: true,
  projectId: true,
  provider: true,
  config: true,
  secrets: true,
  isEnabled: true,
  pullState: true,
  addedMetrics: true,
  lastPullResult: true,
  streamKeyCreatedAt: true,
  streamSummary: true,
};

function readAttributes(value: unknown): Record<string, string> {
  const attributes: Record<string, string> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return attributes;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key && typeof item === "string" && item.trim()) {
      attributes[key] = item;
    }
  }

  return attributes;
}

// An AWS resource's own dimensions, from its telemetry attributes.
export function getAwsDimensionsOfAttributes(
  attributes: Record<string, string>,
): Array<CloudAddedMetricDimension> {
  return Object.entries(attributes)
    .filter(([key]: [string, string]): boolean => {
      return key.startsWith(AWS_CLOUDWATCH_DIMENSION_PREFIX);
    })
    .map(([key, value]: [string, string]): CloudAddedMetricDimension => {
      return { name: key.slice(AWS_CLOUDWATCH_DIMENSION_PREFIX.length), value };
    })
    .sort((a: CloudAddedMetricDimension, b: CloudAddedMetricDimension) => {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
}

// A Google Cloud resource's identifying labels, from its telemetry attributes.
export function getGcpLabelsOfAttributes(
  attributes: Record<string, string>,
): Record<string, string> {
  const labels: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (key === GCP_RESOURCE_TYPE_ATTRIBUTE || !key.startsWith("resource.")) {
      continue;
    }

    const label: string = key.slice("resource.".length);

    // A monitored resource's label: no dot in it (resource.cloud.region is not one).
    if (label && !label.includes(".")) {
      labels[label] = value;
    }
  }

  return labels;
}

/*
 * The statistic an AWS metric is read with when added: CloudWatch says
 * nothing of it, so a count by its name ("RequestCount", "5XXError") is
 * read as its sum, anything else as its average.
 */
export function getAwsDefaultStatistic(metricName: string): string {
  if (AWS_LEVEL_NAME.test(metricName)) {
    return "Average";
  }

  return AWS_SUM_NAME.test(metricName) ? "Sum" : "Average";
}

/*
 * How a Cloud Monitoring metric is read when added, from its descriptor:
 * a gauge's mean, a count's per-second rate, a distribution's 95th
 * percentile, a true-or-false gauge's share of true - and its unit as
 * read. Null when it cannot be aligned to a number (text, money).
 */
export function getGcpReadOfDescriptor(
  descriptor: Pick<GcpMetricDescriptor, "metricKind" | "valueType" | "unit">,
): { aligner: string; unit: string } | null {
  const kind: string = descriptor.metricKind.toUpperCase();
  const valueType: string = descriptor.valueType.toUpperCase();
  const unit: string = descriptor.unit || "1";

  if (valueType === "DISTRIBUTION") {
    return { aligner: "ALIGN_PERCENTILE_95", unit };
  }

  if (valueType === "BOOL") {
    return kind === "GAUGE"
      ? { aligner: "ALIGN_FRACTION_TRUE", unit: "1" }
      : null;
  }

  if (valueType !== "INT64" && valueType !== "DOUBLE") {
    return null;
  }

  if (kind === "DELTA" || kind === "CUMULATIVE") {
    return { aligner: "ALIGN_RATE", unit: `${unit}/s` };
  }

  return kind === "GAUGE" ? { aligner: "ALIGN_MEAN", unit } : null;
}

/*
 * The metric type prefixes a Google Cloud type's metrics are listed by:
 * each service its key metrics come from ("compute.googleapis.com/"),
 * and the Ops Agent's where one reports for it.
 */
export function getGcpMetricPrefixesOfType(
  resourceType: string,
): Array<string> {
  const entry: GcpTypeKeyMetrics | undefined = GCP_KEY_METRICS.find(
    (candidate: GcpTypeKeyMetrics): boolean => {
      return candidate.resourceType === resourceType;
    },
  );
  const prefixes: Array<string> = [];

  for (const metric of entry?.metrics || []) {
    const prefix: string = `${metric.metricType.split("/")[0]}/`;

    if (!prefixes.includes(prefix)) {
      prefixes.push(prefix);
    }
  }

  return prefixes;
}

export default class CloudResourceMetrics {
  // ---- The resource and its connection -------------------------------------

  private static async loadTarget(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<CloudResourceTarget> {
    const resource: CloudResource | null = await CloudResourceService.findOneBy(
      {
        query: { _id: data.cloudResourceId, projectId: data.projectId },
        select: RESOURCE_SELECT as never,
        props: data.props,
      },
    );

    if (!resource) {
      throw new BadDataException(
        "This cloud resource was not found in the project.",
      );
    }

    const provider: CloudProvider = String(
      resource.cloudProvider || "",
    ).toLowerCase() as CloudProvider;
    let connection: CloudConnection | null = null;

    if (resource.cloudConnectionId) {
      connection = await CloudConnectionService.findOneBy({
        query: {
          _id: resource.cloudConnectionId,
          projectId: data.projectId,
        },
        select: CONNECTION_SELECT as never,
        props: { isRoot: true },
      });
    }

    return {
      resource,
      provider,
      type: String(resource.cloudResourceType || ""),
      attributes: readAttributes(resource.telemetryAttributes),
      connection:
        connection && String(connection.provider || "") === provider
          ? connection
          : null,
    };
  }

  // The connection a listing or a change reads through: refused with why when none can.
  private static assertConnection(
    target: CloudResourceTarget,
  ): CloudConnection {
    if (!target.connection) {
      throw new BadDataException(
        "No cloud connection reads this resource, so OneUptime cannot ask its cloud what it publishes. Connect its account under Cloud > Connect.",
      );
    }

    if (!target.connection.isEnabled) {
      throw new BadDataException(
        "This resource's cloud connection is turned off. Turn it on under Cloud > Connect to list or add its metrics.",
      );
    }

    return target.connection;
  }

  // The resources of the type the connection reads, by their row ids.
  private static async getResourceIdsOfType(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    type: string;
  }): Promise<Array<string>> {
    const rows: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId: data.projectId,
        cloudConnectionId: data.connectionId,
        cloudResourceType: data.type,
        isArchived: false,
      },
      select: { _id: true },
      limit: 10000,
      skip: 0,
      props: { isRoot: true },
    });

    return rows
      .map((row: CloudResource): string => {
        return row.id?.toString() || "";
      })
      .filter((id: string): boolean => {
        return Boolean(id);
      });
  }

  // ---- What the resource publishes ------------------------------------------

  public static async listPublished(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    props: DatabaseCommonInteractionProps;
    canEdit: boolean;
    dependencies?: CloudResourceMetricsDependencies | undefined;
  }): Promise<CloudPublishedMetricsListing> {
    const target: CloudResourceTarget =
      await CloudResourceMetrics.loadTarget(data);
    const connection: CloudConnection =
      CloudResourceMetrics.assertConnection(target);
    const dependencies: CloudResourceMetricsDependencies =
      data.dependencies || {};
    const now: Date = dependencies.now ? dependencies.now() : new Date();

    if (
      dependencies.isRateLimited !== false &&
      !(await CloudLiveReadRateLimit.take({
        cloudAccountId: `published-metrics:${connection.id!.toString()}`,
        now,
      }))
    ) {
      throw new BadDataException(
        "This cloud connection was asked for resources' metrics many times in the last minute. Try again in a minute.",
      );
    }

    const added: Array<CloudAddedMetric> = readCloudAddedMetrics(
      connection.addedMetrics,
    );
    const applying: Array<CloudAddedMetric> = getCloudAddedMetricsOfResource({
      added,
      resourceType: target.type,
      cloudResourceId: target.resource.id!.toString(),
    });

    const learnedUnits: Map<string, string> = new Map<string, string>();
    const read: {
      metrics: Array<CloudPublishedMetric>;
      azureMetricsInCall?: number | undefined;
      azureHasFiveMinuteCall?: boolean | undefined;
    } = await CloudResourceMetrics.readPublished({
      target,
      connection,
      applying,
      dependencies,
      learnedUnits,
    });

    if (learnedUnits.size > 0) {
      await CloudResourceMetrics.keepLearnedUnits({
        connectionId: connection.id!,
        learnedUnits,
      });
    }

    return {
      provider: target.provider,
      resourceType: target.type,
      metrics: sortCloudPublishedMetrics(read.metrics),
      resourcesOfType: (
        await CloudResourceMetrics.getResourceIdsOfType({
          projectId: data.projectId,
          connectionId: connection.id!,
          type: target.type,
        })
      ).length,
      readIntervalInMinutes: CloudConnectionScheduler.intervalOf(connection),
      ...(read.azureMetricsInCall !== undefined
        ? { azureMetricsInCall: read.azureMetricsInCall }
        : {}),
      ...(read.azureHasFiveMinuteCall ? { azureHasFiveMinuteCall: true } : {}),
      addedForResource: applying.length,
      canEdit: data.canEdit,
    };
  }

  private static callOptions(
    dependencies: CloudResourceMetricsDependencies,
  ): CloudConnectorCallOptions {
    return {
      transport:
        dependencies.transport ||
        DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
      now: dependencies.now,
      sleep: dependencies.sleep,
      requestTimeoutInMs: REQUEST_TIMEOUT_MS,
    };
  }

  private static budget(): CloudReadBudget {
    return new CloudReadBudget({
      maxRequests: CLOUD_PUBLISHED_METRICS_MAX_REQUESTS,
      maxDurationMs: CLOUD_PUBLISHED_METRICS_MAX_DURATION_MS,
    });
  }

  // How an addition applying to the resource is said in a listing.
  private static statusOf(data: {
    applying: ReadonlyArray<CloudAddedMetric>;
    namespace?: string | undefined;
    name: string;
    isKey: boolean;
  }): Pick<CloudPublishedMetric, "status" | "addedKey" | "addedScope"> {
    if (data.isKey) {
      return { status: CloudPublishedMetricStatus.Key };
    }

    const addition: CloudAddedMetric | undefined = data.applying.find(
      (metric: CloudAddedMetric): boolean => {
        return (
          metric.name.toLowerCase() === data.name.toLowerCase() &&
          (metric.namespace || "").toLowerCase() ===
            (data.namespace || "").toLowerCase()
        );
      },
    );

    return addition
      ? {
          status: CloudPublishedMetricStatus.Added,
          addedKey: addition.key,
          addedScope: addition.scope,
        }
      : { status: CloudPublishedMetricStatus.Available };
  }

  private static async readPublished(data: {
    target: CloudResourceTarget;
    connection: CloudConnection;
    applying: Array<CloudAddedMetric>;
    dependencies: CloudResourceMetricsDependencies;
    // AWS: the units the listing learned of additions that had none, by key.
    learnedUnits?: Map<string, string> | undefined;
  }): Promise<{
    metrics: Array<CloudPublishedMetric>;
    azureMetricsInCall?: number | undefined;
    azureHasFiveMinuteCall?: boolean | undefined;
  }> {
    const settings: CloudConnectionSettings =
      await CloudConnectionService.getConnectorSettings(data.connection);
    const options: CloudConnectorCallOptions = CloudResourceMetrics.callOptions(
      data.dependencies,
    );
    const budget: CloudReadBudget = CloudResourceMetrics.budget();

    switch (data.target.provider) {
      case CloudProvider.Azure:
        return await CloudResourceMetrics.readAzure({
          ...data,
          settings,
          options,
          budget,
        });
      case CloudProvider.AWS:
        return {
          metrics: await CloudResourceMetrics.readAws({
            ...data,
            settings,
            options,
            budget,
          }),
        };
      case CloudProvider.GCP:
        return {
          metrics: await CloudResourceMetrics.readGcp({
            ...data,
            settings,
            options,
            budget,
          }),
        };
      default:
        throw new BadDataException(
          "OneUptime cannot list the metrics of a resource of this cloud.",
        );
    }
  }

  // The resource's ARM id: as its metrics name it, else its provider id.
  private static azureResourceIdOf(target: CloudResourceTarget): string {
    return (
      target.attributes[AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE] ||
      String(target.resource.providerResourceId || "")
    );
  }

  private static async readAzure(data: {
    target: CloudResourceTarget;
    applying: Array<CloudAddedMetric>;
    settings: CloudConnectionSettings;
    options: CloudConnectorCallOptions;
    budget: CloudReadBudget;
  }): Promise<{
    metrics: Array<CloudPublishedMetric>;
    azureMetricsInCall: number;
    azureHasFiveMinuteCall: boolean;
  }> {
    const armId: string = CloudResourceMetrics.azureResourceIdOf(data.target);

    if (!armId.startsWith("/subscriptions/")) {
      throw new BadDataException(
        "This resource's Azure resource ID is not known yet, so its metrics cannot be listed.",
      );
    }

    const definitions: Array<AzureMetricDefinition> =
      await new AzureCloudConnector()
        .arm(data.settings, data.options, data.budget)
        .getMetricDefinitions(armId);
    const keyMetrics: AzureTypeKeyMetrics | undefined = getAzureKeyMetrics(
      data.target.type,
    );
    const keyNames: Set<string> = new Set<string>(
      (keyMetrics ? getAzureReadMetricNames(keyMetrics) : []).map(
        (name: string): string => {
          return name.toLowerCase();
        },
      ),
    );

    const metrics: Array<CloudPublishedMetric> = definitions.map(
      (definition: AzureMetricDefinition): CloudPublishedMetric => {
        const grain: string | undefined = pickAzureGrain(definition.timeGrains);
        const isReadable: boolean = Boolean(
          grain && AZURE_ADDED_METRIC_GRAINS.includes(grain),
        );
        const block: CloudPublishedMetricBlock | undefined =
          definition.isDimensionRequired
            ? CloudPublishedMetricBlock.NeedsDimension
            : !isReadable ||
                !AZURE_ADDED_METRIC_AGGREGATIONS.includes(
                  definition.primaryAggregationType,
                )
              ? CloudPublishedMetricBlock.CoarseGrain
              : definition.name.includes(",")
                ? CloudPublishedMetricBlock.Unreadable
                : undefined;

        return {
          name: definition.name,
          ...(definition.displayName &&
          definition.displayName !== definition.name
            ? { displayName: definition.displayName }
            : {}),
          ...(definition.description
            ? { description: definition.description }
            : {}),
          unit: definition.unit,
          aggregation: definition.primaryAggregationType,
          ...(grain ? { grain } : {}),
          ...CloudResourceMetrics.statusOf({
            applying: data.applying,
            name: definition.name,
            isKey: keyNames.has(definition.name.toLowerCase()),
          }),
          ...(block ? { block } : {}),
        };
      },
    );

    /*
     * What the resource's calls carry now - its key metrics and its
     * additions, as its definitions allow - for whether one more rides in.
     */
    const selected: Array<SelectedMetric> = keyMetrics
      ? selectAzureMetrics(keyMetrics, definitions, data.applying)
      : [];
    const minuteCall: number = selected.filter(
      (metric: SelectedMetric): boolean => {
        return getAzureReadGroupKey(data.target.type, metric) === "PT1M";
      },
    ).length;
    const hasFiveMinuteCall: boolean = selected.some(
      (metric: SelectedMetric): boolean => {
        return (
          getAzureReadGroupKey(data.target.type, metric) ===
          AZURE_FIVE_MINUTE_CURSOR
        );
      },
    );

    return {
      metrics,
      azureMetricsInCall: minuteCall,
      azureHasFiveMinuteCall: hasFiveMinuteCall,
    };
  }

  // An AWS resource's account, Region, namespace and own dimensions.
  private static awsPlaceOf(target: CloudResourceTarget): {
    accountId: string;
    region: string;
    namespace: string;
    dimensions: Array<CloudAddedMetricDimension>;
  } {
    return {
      accountId:
        String(target.resource.cloudAccountId || "") ||
        target.attributes[CLOUD_ACCOUNT_ID_ATTRIBUTE] ||
        "",
      region:
        String(target.resource.cloudRegion || "") ||
        target.attributes[CLOUD_REGION_ATTRIBUTE] ||
        "",
      namespace:
        target.attributes[AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE] ||
        getAwsNamespaceOfType(target.type) ||
        "",
      dimensions: getAwsDimensionsOfAttributes(target.attributes),
    };
  }

  private static async readAws(data: {
    target: CloudResourceTarget;
    connection: CloudConnection;
    applying: Array<CloudAddedMetric>;
    settings: CloudConnectionSettings;
    options: CloudConnectorCallOptions;
    budget: CloudReadBudget;
    learnedUnits?: Map<string, string> | undefined;
  }): Promise<Array<CloudPublishedMetric>> {
    const place: {
      accountId: string;
      region: string;
      namespace: string;
      dimensions: Array<CloudAddedMetricDimension>;
    } = CloudResourceMetrics.awsPlaceOf(data.target);

    if (!place.region || !place.namespace || place.dimensions.length === 0) {
      throw new BadDataException(
        "This resource's CloudWatch namespace and dimensions are not known yet, so its metrics cannot be listed. They are recorded with its next metrics.",
      );
    }

    const credentials: AwsCredentials =
      await CloudResourceMetrics.awsCredentialsOf({
        connection: data.connection,
        accountId: place.accountId,
        settings: data.settings,
        options: data.options,
        budget: data.budget,
      });
    const listed: Array<AwsListedMetric> = await listMetrics(
      {
        transport: data.options.transport,
        credentials,
        region: place.region,
        now: data.options.now,
        timeoutInMs: data.options.requestTimeoutInMs,
        sleep: data.options.sleep,
        budget: data.budget,
      },
      {
        namespace: place.namespace,
        dimensions: place.dimensions,
        includeQuiet: true,
      },
    );
    const own: string = place.dimensions
      .map((dimension: CloudAddedMetricDimension): string => {
        return `${dimension.name}=${dimension.value}`;
      })
      .join("|");
    const byName: Map<string, CloudPublishedMetric> = new Map();

    for (const metric of listed) {
      // The resource's own series: its dimensions, no split of them.
      const dimensions: Array<CloudAddedMetricDimension> = [
        ...metric.dimensions,
      ].sort((a: CloudAddedMetricDimension, b: CloudAddedMetricDimension) => {
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      const key: string = dimensions
        .map((dimension: CloudAddedMetricDimension): string => {
          return `${dimension.name}=${dimension.value}`;
        })
        .join("|");

      if (key !== own || byName.has(metric.metricName.toLowerCase())) {
        continue;
      }

      const status: Pick<
        CloudPublishedMetric,
        "status" | "addedKey" | "addedScope"
      > = CloudResourceMetrics.statusOf({
        applying: data.applying,
        namespace: place.namespace,
        name: metric.metricName,
        isKey: Boolean(getAwsKeyMetric(place.namespace, metric.metricName)),
      });

      byName.set(metric.metricName.toLowerCase(), {
        name: metric.metricName,
        namespace: place.namespace,
        // As its datapoints said when it was added, else as AWS documents it (#9809).
        unit:
          CloudResourceMetrics.addedUnitOf(data.applying, status.addedKey) ||
          getAwsDocumentedMetricUnit(place.namespace, metric.metricName),
        aggregation: getAwsDefaultStatistic(metric.metricName),
        dimensions: metric.dimensions.map(
          (dimension: CloudAddedMetricDimension) => {
            return { name: dimension.name, value: dimension.value };
          },
        ),
        ...status,
      });
    }

    const metrics: Array<CloudPublishedMetric> = Array.from(byName.values());

    /*
     * An addition whose datapoints said no unit when it was added - none
     * published lately, or the probe could not run - is asked again while
     * it is listed, a few at a time (#9809): once it has data, its unit is
     * kept with it. Only by a listing, which keeps what it learns.
     */
    for (const metric of metrics
      .filter((candidate: CloudPublishedMetric): boolean => {
        return (
          Boolean(data.learnedUnits) &&
          candidate.status === CloudPublishedMetricStatus.Added &&
          Boolean(candidate.addedKey) &&
          !CloudResourceMetrics.addedUnitOf(data.applying, candidate.addedKey)
        );
      })
      .slice(0, CLOUD_PUBLISHED_METRICS_UNIT_PROBES)) {
      const unit: string = await CloudResourceMetrics.probeAwsUnit({
        credentials,
        region: place.region,
        options: data.options,
        budget: data.budget,
        namespace: place.namespace,
        metricName: metric.name,
        dimensions: metric.dimensions || [],
      });

      if (unit) {
        metric.unit = unit;
        data.learnedUnits?.set(metric.addedKey!, unit);
      }
    }

    return metrics;
  }

  // The credentials an AWS resource's account is read with: its own, in an organization.
  private static async awsCredentialsOf(data: {
    connection: CloudConnection;
    accountId: string;
    settings: CloudConnectionSettings;
    options: CloudConnectorCallOptions;
    budget: CloudReadBudget;
  }): Promise<AwsCredentials> {
    const connector: AwsCloudConnector = new AwsCloudConnector();
    const settings: CloudConnectionSettings =
      connector.isOrganization(data.settings) && data.accountId
        ? connector.settingsForAccount(data.settings, data.accountId)
        : data.settings;

    return await connector.getCredentials(settings, {
      ...data.options,
      connectionId: data.connection.id!.toString(),
      budget: data.budget,
    });
  }

  /*
   * The unit an AWS metric being added is kept with (#9809): what its
   * datapoints carry, asked of CloudWatch on the series the listing found;
   * else as AWS documents it (the listing's).
   */
  private static async learnAwsUnit(data: {
    target: CloudResourceTarget;
    connection: CloudConnection;
    dependencies: CloudResourceMetricsDependencies;
    listed: CloudPublishedMetric;
  }): Promise<string> {
    const place: { accountId: string; region: string } =
      CloudResourceMetrics.awsPlaceOf(data.target);
    const options: CloudConnectorCallOptions = CloudResourceMetrics.callOptions(
      data.dependencies,
    );
    const budget: CloudReadBudget = CloudResourceMetrics.budget();
    let unit: string = "";

    try {
      unit = await CloudResourceMetrics.probeAwsUnit({
        credentials: await CloudResourceMetrics.awsCredentialsOf({
          connection: data.connection,
          accountId: place.accountId,
          settings: await CloudConnectionService.getConnectorSettings(
            data.connection,
          ),
          options,
          budget,
        }),
        region: place.region,
        options,
        budget,
        namespace: data.listed.namespace || "",
        metricName: data.listed.name,
        dimensions: data.listed.dimensions || [],
      });
    } catch (error) {
      logger.debug(
        `CloudResourceMetrics: the unit of ${data.listed.name} could not be read:`,
      );
      logger.debug(error);
    }

    return unit || data.listed.unit;
  }

  // The unit an addition was kept with: "" for none.
  private static addedUnitOf(
    applying: ReadonlyArray<CloudAddedMetric>,
    addedKey: string | undefined,
  ): string {
    if (!addedKey) {
      return "";
    }

    return (
      applying.find((metric: CloudAddedMetric): boolean => {
        return metric.key === addedKey;
      })?.unit || ""
    );
  }

  /*
   * The unit an AWS metric's datapoints carry (findAwsMetricUnit), or ""
   * when they say none or it cannot be asked now: an addition is never
   * refused for want of its unit.
   */
  private static async probeAwsUnit(data: {
    credentials: AwsCredentials;
    region: string;
    options: CloudConnectorCallOptions;
    budget: CloudReadBudget;
    namespace: string;
    metricName: string;
    dimensions: Array<CloudAddedMetricDimension>;
  }): Promise<string> {
    if (data.dimensions.length === 0 || data.budget.isSpent()) {
      return "";
    }

    try {
      return await findAwsMetricUnit(
        {
          transport: data.options.transport,
          credentials: data.credentials,
          region: data.region,
          now: data.options.now,
          timeoutInMs: data.options.requestTimeoutInMs,
          sleep: data.options.sleep,
          budget: data.budget,
        },
        {
          namespace: data.namespace,
          metricName: data.metricName,
          dimensions: data.dimensions,
          now: data.options.now ? data.options.now() : new Date(),
        },
      );
    } catch (error) {
      logger.debug(
        `CloudResourceMetrics: the unit of ${data.namespace} ${data.metricName} could not be read:`,
      );
      logger.debug(error);
      return "";
    }
  }

  private static async readGcp(data: {
    target: CloudResourceTarget;
    applying: Array<CloudAddedMetric>;
    settings: CloudConnectionSettings;
    options: CloudConnectorCallOptions;
    budget: CloudReadBudget;
  }): Promise<Array<CloudPublishedMetric>> {
    const projectId: string =
      String(data.target.resource.cloudAccountId || "") ||
      data.target.attributes["resource.project_id"] ||
      "";
    const prefixes: Array<string> = getGcpMetricPrefixesOfType(
      data.target.type,
    );

    if (!projectId || prefixes.length === 0) {
      throw new BadDataException(
        "This resource's project or type is not known, so its metrics cannot be listed.",
      );
    }

    const descriptors: Array<GcpMetricDescriptor> =
      await new GcpCloudConnector()
        .monitoring(data.settings, data.options, data.budget)
        .listMetricDescriptors({
          projectId,
          prefixes,
          resourceType: data.target.type,
        });
    const keyNames: Set<string> = new Set<string>(
      getGcpReadMetrics().map((metric: GcpReadMetric): string => {
        return metric.metricType.toLowerCase();
      }),
    );
    const byName: Map<string, CloudPublishedMetric> = new Map();

    for (const descriptor of descriptors) {
      const read: { aligner: string; unit: string } | null =
        getGcpReadOfDescriptor(descriptor);
      const block: CloudPublishedMetricBlock | undefined = !read
        ? CloudPublishedMetricBlock.Unreadable
        : descriptor.launchStage.toUpperCase() === "DEPRECATED"
          ? CloudPublishedMetricBlock.Deprecated
          : undefined;

      if (byName.has(descriptor.type.toLowerCase())) {
        continue;
      }

      byName.set(descriptor.type.toLowerCase(), {
        name: descriptor.type,
        ...(descriptor.displayName
          ? { displayName: descriptor.displayName }
          : {}),
        ...(descriptor.description
          ? { description: descriptor.description }
          : {}),
        unit: read ? read.unit : descriptor.unit,
        aggregation: read ? read.aligner : "",
        ...CloudResourceMetrics.statusOf({
          applying: data.applying,
          name: descriptor.type,
          isKey: keyNames.has(descriptor.type.toLowerCase()),
        }),
        ...(block ? { block } : {}),
      });
    }

    return Array.from(byName.values());
  }

  // ---- Adding and removing ---------------------------------------------------

  /*
   * Adds a metric the resource's listing finds to what its connection
   * reads - for the resource, or every resource of its type - and keeps
   * the connection's additions. Refused, with why, when the listing does
   * not find it, it cannot be read, it is read already, or a cap is met.
   */
  public static async add(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    props: DatabaseCommonInteractionProps;
    name: string;
    namespace?: string | undefined;
    scope: CloudAddedMetricScope;
    aggregation?: string | undefined;
    userId?: ObjectID | undefined;
    dependencies?: CloudResourceMetricsDependencies | undefined;
  }): Promise<{
    added: CloudAddedMetric;
    addedMetrics: Array<CloudAddedMetric>;
  }> {
    const target: CloudResourceTarget =
      await CloudResourceMetrics.loadTarget(data);
    const connection: CloudConnection =
      CloudResourceMetrics.assertConnection(target);
    const dependencies: CloudResourceMetricsDependencies =
      data.dependencies || {};
    const now: Date = dependencies.now ? dependencies.now() : new Date();
    const existing: Array<CloudAddedMetric> = readCloudAddedMetrics(
      connection.addedMetrics,
    );
    const applying: Array<CloudAddedMetric> = getCloudAddedMetricsOfResource({
      added: existing,
      resourceType: target.type,
      cloudResourceId: target.resource.id!.toString(),
    });
    const listed: Array<CloudPublishedMetric> = (
      await CloudResourceMetrics.readPublished({
        target,
        connection,
        applying,
        dependencies,
      })
    ).metrics;
    const wanted: string = data.name.trim().toLowerCase();
    const found: CloudPublishedMetric | undefined = listed.find(
      (metric: CloudPublishedMetric): boolean => {
        return (
          metric.name.toLowerCase() === wanted &&
          (!data.namespace ||
            (metric.namespace || "").toLowerCase() ===
              data.namespace.trim().toLowerCase())
        );
      },
    );

    if (!found || found.block) {
      throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["invalid"]!);
    }

    if (found.status === CloudPublishedMetricStatus.Key) {
      throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["alreadyRead"]!);
    }

    const isOwn: boolean = data.scope === CloudAddedMetricScope.Resource;
    const metric: CloudAddedMetric = {
      key: "",
      provider: target.provider,
      scope: data.scope,
      resourceType: target.type,
      name: found.name,
      aggregation: CloudResourceMetrics.aggregationOf({
        provider: target.provider,
        listed: found,
        wanted: data.aggregation,
      }),
      unit:
        target.provider === CloudProvider.AWS
          ? await CloudResourceMetrics.learnAwsUnit({
              target,
              connection,
              dependencies,
              listed: found,
            })
          : found.unit,
      addedAt: now.toISOString(),
      ...(found.namespace ? { namespace: found.namespace } : {}),
      ...(found.grain ? { grain: found.grain } : {}),
      ...(data.userId ? { addedByUserId: data.userId.toString() } : {}),
      ...(isOwn
        ? CloudResourceMetrics.resourceIdentityOf({ target, listed: found })
        : {}),
    };

    const next: Array<CloudAddedMetric> = addCloudAddedMetric({
      added: existing,
      metric,
      cloudResourceIds: isOwn
        ? []
        : await CloudResourceMetrics.getResourceIdsOfType({
            projectId: data.projectId,
            connectionId: connection.id!,
            type: target.type,
          }),
    });

    await CloudResourceMetrics.saveAddedMetrics(connection, next);

    return { added: next[next.length - 1]!, addedMetrics: next };
  }

  // The aggregation an addition is read with: the one asked for when the cloud takes it.
  private static aggregationOf(data: {
    provider: CloudProvider;
    listed: CloudPublishedMetric;
    wanted?: string | undefined;
  }): string {
    const wanted: string = (data.wanted || "").trim();

    if (
      wanted &&
      ((data.provider === CloudProvider.AWS &&
        AWS_ADDED_METRIC_STATISTICS.includes(wanted)) ||
        (data.provider === CloudProvider.Azure &&
          AZURE_ADDED_METRIC_AGGREGATIONS.includes(wanted)))
    ) {
      return wanted;
    }

    return data.listed.aggregation;
  }

  // What a resource's own addition is read by, from what its cloud knows it as.
  private static resourceIdentityOf(data: {
    target: CloudResourceTarget;
    listed: CloudPublishedMetric;
  }): Partial<CloudAddedMetric> {
    const identity: Partial<CloudAddedMetric> = {
      cloudResourceId: data.target.resource.id!.toString(),
    };

    if (data.target.provider === CloudProvider.Azure) {
      identity.azureResourceId = CloudResourceMetrics.azureResourceIdOf(
        data.target,
      );
    } else if (data.target.provider === CloudProvider.AWS) {
      const place: { accountId: string; region: string } =
        CloudResourceMetrics.awsPlaceOf(data.target);

      identity.accountId = place.accountId;
      identity.region = place.region;
      identity.dimensions = data.listed.dimensions || [];
    } else if (data.target.provider === CloudProvider.GCP) {
      identity.accountId =
        String(data.target.resource.cloudAccountId || "") ||
        data.target.attributes["resource.project_id"] ||
        "";
      identity.resourceLabels = getGcpLabelsOfAttributes(
        data.target.attributes,
      );
    }

    return identity;
  }

  /*
   * Keeps the units a listing learned (#9809) with the additions they are
   * of, on the connection's additions as they are now: one added or
   * removed meanwhile stays added or removed.
   */
  private static async keepLearnedUnits(data: {
    connectionId: ObjectID;
    learnedUnits: Map<string, string>;
  }): Promise<void> {
    const connection: CloudConnection | null =
      await CloudConnectionService.findOneById({
        id: data.connectionId,
        select: { _id: true, addedMetrics: true },
        props: { isRoot: true },
      });

    if (!connection) {
      return;
    }

    let changed: boolean = false;
    const next: Array<CloudAddedMetric> = readCloudAddedMetrics(
      connection.addedMetrics,
    ).map((metric: CloudAddedMetric): CloudAddedMetric => {
      const unit: string | undefined = data.learnedUnits.get(metric.key);

      if (!unit || metric.unit) {
        return metric;
      }

      changed = true;
      return { ...metric, unit };
    });

    if (changed) {
      await CloudResourceMetrics.saveAddedMetrics(connection, next);
    }
  }

  private static async saveAddedMetrics(
    connection: CloudConnection,
    added: Array<CloudAddedMetric>,
  ): Promise<void> {
    await CloudConnectionService.updateOneById({
      id: connection.id!,
      data: {
        addedMetrics: toStoredCloudAddedMetrics(added) as unknown as JSONObject,
      } as never,
      props: { isRoot: true },
    });
  }

  // Removes one of the additions that apply to the resource, by its key.
  public static async remove(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    props: DatabaseCommonInteractionProps;
    key: string;
  }): Promise<{ addedMetrics: Array<CloudAddedMetric> }> {
    const target: CloudResourceTarget =
      await CloudResourceMetrics.loadTarget(data);

    if (!target.connection) {
      throw new BadDataException(
        "No cloud connection reads this resource, so it has no added metrics.",
      );
    }

    const existing: Array<CloudAddedMetric> = readCloudAddedMetrics(
      target.connection.addedMetrics,
    );
    const isApplying: boolean = getCloudAddedMetricsOfResource({
      added: existing,
      resourceType: target.type,
      cloudResourceId: target.resource.id!.toString(),
    }).some((metric: CloudAddedMetric): boolean => {
      return metric.key === data.key;
    });

    if (!isApplying) {
      throw new BadDataException(
        "This metric is not added to what this resource's cloud connection reads.",
      );
    }

    const next: Array<CloudAddedMetric> = removeCloudAddedMetric({
      added: existing,
      key: data.key,
    });

    await CloudResourceMetrics.saveAddedMetrics(target.connection, next);

    return { addedMetrics: next };
  }

  // ---- Why a key metric did not report ---------------------------------------

  /*
   * For each of `keys` (CloudResourceKeyMetric.key: the key metrics the
   * resource's page found no data of in its range), when the resource last
   * reported it within CLOUD_UNREPORTED_LOOK_BACK_DAYS, whether it never
   * did, and why it likely did not. Keys that are none of its type's key
   * metrics are left out.
   */
  public static async explainUnreported(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    props: DatabaseCommonInteractionProps;
    keys: Array<string>;
    dependencies?: CloudResourceMetricsDependencies | undefined;
  }): Promise<Array<CloudUnreportedKeyMetricReport>> {
    const target: CloudResourceTarget =
      await CloudResourceMetrics.loadTarget(data);
    const dependencies: CloudResourceMetricsDependencies =
      data.dependencies || {};
    const now: Date = dependencies.now ? dependencies.now() : new Date();
    const wanted: Set<string> = new Set<string>(
      data.keys.slice(0, 200).map((key: string): string => {
        return String(key).toLowerCase();
      }),
    );
    const metrics: Array<CloudResourceKeyMetric> = getCloudKeyMetricsOfResource(
      {
        provider: target.provider,
        type: target.type,
        namespace: target.attributes[AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE],
      },
    ).filter((metric: CloudResourceKeyMetric): boolean => {
      return wanted.has(metric.key);
    });

    if (metrics.length === 0) {
      return [];
    }

    const since: Date = new Date(
      now.getTime() - CLOUD_UNREPORTED_LOOK_BACK_DAYS * DAY_MS,
    );
    const findLastReported: NonNullable<
      CloudResourceMetricsDependencies["findLastReported"]
    > = dependencies.findLastReported || CloudResourceMetrics.findLastReported;
    const lastReported: Map<string, Date> =
      Object.keys(target.attributes).length > 0
        ? await findLastReported({
            projectId: data.projectId,
            attributes: target.attributes,
            names: metrics.flatMap((metric: CloudResourceKeyMetric) => {
              return metric.storedNames;
            }),
            since,
            until: now,
          })
        : new Map<string, Date>();
    const createdAt: number = target.resource.createdAt
      ? new Date(target.resource.createdAt).getTime()
      : 0;
    const knowsWholeLife: boolean = createdAt >= since.getTime();
    const connectionState: CloudUnreportedConnectionState | null =
      CloudResourceMetrics.connectionStateOf(target.connection);

    return metrics.map(
      (metric: CloudResourceKeyMetric): CloudUnreportedKeyMetricReport => {
        let last: Date | null = null;

        for (const name of metric.storedNames) {
          const at: Date | undefined = lastReported.get(name.toLowerCase());

          if (at && (!last || at.getTime() > last.getTime())) {
            last = at;
          }
        }

        return {
          key: metric.key,
          name: metric.name,
          lastReportedAt: last ? last.toISOString() : null,
          isNeverReported: !last && knowsWholeLife,
          reasons: explainCloudUnreportedKeyMetric({
            metric,
            type: target.type,
            connection: connectionState,
            ...CloudResourceMetrics.publicationOf({ target, metric }),
            isLeftToStream: CloudResourceMetrics.isLeftToStream({
              target,
              metric,
              now,
            }),
          }),
        };
      },
    );
  }

  // What the reasons need of the connection: none when no connection reads the resource.
  private static connectionStateOf(
    connection: CloudConnection | null,
  ): CloudUnreportedConnectionState | null {
    if (!connection) {
      return null;
    }

    const summary: CloudConnectionReadSummary | undefined =
      readCloudConnectionReadSummary(connection.lastPullResult);

    return {
      isEnabled: Boolean(connection.isEnabled),
      ...(summary
        ? {
            lastReadStatus: summary.status,
            lastReadFailureKind: summary.failureKind,
            lastReadWarnings: summary.warnings,
          }
        : {}),
    };
  }

  /*
   * Azure: whether the resource's own metric definitions list the metric
   * (kept on the connection once Azure refused the type's selection for
   * it), and whether those its type was read with do. Null where OneUptime
   * does not know.
   */
  private static publicationOf(data: {
    target: CloudResourceTarget;
    metric: CloudResourceKeyMetric;
  }): { isPublished: boolean | null; isPublishedByType: boolean | null } {
    if (
      data.target.provider !== CloudProvider.Azure ||
      !data.target.connection
    ) {
      return { isPublished: null, isPublishedByType: null };
    }

    const state: CloudConnectionPullState =
      CloudConnectionPullRunner.readPullState(data.target.connection.pullState);
    const lists: (cached: unknown) => boolean | null = (
      cached: unknown,
    ): boolean | null => {
      if (!cached || typeof cached !== "object" || Array.isArray(cached)) {
        return null;
      }

      const selected: unknown = (cached as JSONObject)["metrics"];

      if (!Array.isArray(selected)) {
        return null;
      }

      return selected.some((item: unknown): boolean => {
        return (
          String((item as JSONObject)?.["name"] || "").toLowerCase() ===
          data.metric.key
        );
      });
    };
    const armId: string = CloudResourceMetrics.azureResourceIdOf(
      data.target,
    ).toLowerCase();

    return {
      isPublished: lists(
        (state.azureResourceMetricDefinitions as JSONObject | undefined)?.[
          armId
        ],
      ),
      isPublishedByType: lists(
        (state.azureMetricDefinitions as JSONObject | undefined)?.[
          data.target.type.toLowerCase()
        ],
      ),
    };
  }

  // Whether the connection's stream writes the metric in place of the read.
  private static isLeftToStream(data: {
    target: CloudResourceTarget;
    metric: CloudResourceKeyMetric;
    now: Date;
  }): boolean {
    const connection: CloudConnection | null = data.target.connection;

    if (!connection?.streamKeyCreatedAt && !connection?.streamSummary) {
      return false;
    }

    const summary: CloudStreamSummary = readCloudStreamSummary(
      connection.streamSummary,
    );

    if (data.target.provider === CloudProvider.AWS) {
      const keyMetric: ReturnType<typeof getAwsKeyMetric> = getAwsKeyMetric(
        data.metric.namespace || "",
        data.metric.name,
      );

      return Boolean(
        keyMetric &&
          isAwsKeyMetricLeftToStream({
            coverage: getAwsStreamCoverage({ summary, now: data.now }),
            accountId: String(data.target.resource.cloudAccountId || ""),
            region: String(data.target.resource.cloudRegion || ""),
            namespace: data.metric.namespace || "",
            metric: keyMetric,
          }),
      );
    }

    if (data.target.provider === CloudProvider.Azure) {
      return (
        !data.metric.intervalSeconds &&
        isAzureStreamedKeyMetric(data.target.type, data.metric.name) &&
        getStreamedMetricKeys({ summary, now: data.now }).has(
          getStreamedMetricKey({
            accountId: String(data.target.resource.cloudAccountId || ""),
            region: String(data.target.resource.cloudRegion || ""),
            namespace: data.target.type,
          }),
        )
      );
    }

    return false;
  }

  /*
   * When each of `names` last reported for the resource (its telemetry
   * attributes, matched exactly as its Metrics list matches them), within
   * [since, until]: one ClickHouse read, grouped by name.
   */
  public static async findLastReported(data: {
    projectId: ObjectID;
    attributes: Record<string, string>;
    names: Array<string>;
    since: Date;
    until: Date;
  }): Promise<Map<string, Date>> {
    const found: Map<string, Date> = new Map<string, Date>();

    if (data.names.length === 0) {
      return found;
    }

    const result: Awaited<ReturnType<typeof MetricService.executeQuery>> =
      await MetricService.executeQuery(
        CloudResourceMetrics.buildLastReportedStatement(data),
      );
    const response: { data?: Array<JSONObject> } = (await result.json()) as {
      data?: Array<JSONObject>;
    };

    for (const row of response.data || []) {
      const name: string = String(row["name"] || "").toLowerCase();
      const at: number = Number(row["lastAtMs"]);

      if (name && Number.isFinite(at) && at > 0) {
        found.set(name, new Date(at));
      }
    }

    return found;
  }

  public static buildLastReportedStatement(data: {
    projectId: ObjectID;
    attributes: Record<string, string>;
    names: Array<string>;
    since: Date;
    until: Date;
  }): Statement {
    return CloudResourceMetrics.buildReportedStatement({
      ...data,
      select: "toUnixTimestamp64Milli(max(time)) AS lastAtMs",
    });
  }

  /*
   * How many points each of `names` reported for what the attributes
   * match (as findLastReported matches them), within [since, until]: one
   * ClickHouse read, grouped by name. A Cosmos DB monitor of the
   * ServerSideLatency Microsoft retires moves to the latency its account
   * reported most (MoveMonitorsOffRetiredCloudMetrics, #9739).
   */
  public static async findReportedPoints(data: {
    projectId: ObjectID;
    attributes: Record<string, string>;
    names: Array<string>;
    since: Date;
    until: Date;
  }): Promise<Map<string, number>> {
    const found: Map<string, number> = new Map<string, number>();

    if (data.names.length === 0) {
      return found;
    }

    const result: Awaited<ReturnType<typeof MetricService.executeQuery>> =
      await MetricService.executeQuery(
        CloudResourceMetrics.buildReportedPointsStatement(data),
      );
    const response: { data?: Array<JSONObject> } = (await result.json()) as {
      data?: Array<JSONObject>;
    };

    for (const row of response.data || []) {
      const name: string = String(row["name"] || "").toLowerCase();
      const points: number = Number(row["points"]);

      if (name && Number.isFinite(points) && points > 0) {
        found.set(name, points);
      }
    }

    return found;
  }

  public static buildReportedPointsStatement(data: {
    projectId: ObjectID;
    attributes: Record<string, string>;
    names: Array<string>;
    since: Date;
    until: Date;
  }): Statement {
    return CloudResourceMetrics.buildReportedStatement({
      ...data,
      select: "count() AS points",
    });
  }

  // Each of `names`, its `select` over the points the attributes match in the range.
  private static buildReportedStatement(data: {
    projectId: ObjectID;
    attributes: Record<string, string>;
    names: Array<string>;
    since: Date;
    until: Date;
    // What is read of each name's points: a column named after what it is.
    select: string;
  }): Statement {
    const statement: Statement = new Statement();

    statement.append(
      `SELECT name, ${data.select} FROM ${AnalyticsTableName.Metric}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: data.since,
      }} AND time <= ${{
        type: TableColumnType.DateTime64,
        value: data.until,
      }} AND retentionDate >= now() AND name IN (`,
    );
    statement.append(
      SQL`${{
        type: TableColumnType.Text,
        value: new Includes(
          data.names.map((name: string): string => {
            return name.toLowerCase();
          }),
        ),
      }})`,
    );

    for (const [key, value] of Object.entries(data.attributes).sort()) {
      statement.append(
        SQL` AND attributes[${{
          type: TableColumnType.Text,
          value: key,
        }}] = ${{
          type: TableColumnType.Text,
          value,
        }}`,
      );
    }

    statement.append(" GROUP BY name LIMIT 500");
    statement.append(LAST_REPORTED_SETTINGS);

    return statement;
  }
}
