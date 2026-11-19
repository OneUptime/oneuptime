import { isCloudResourceKindResource } from "Common/Types/Cloud/CloudResourceKind";
import {
  getCloudResourceMetricAggregation,
  hasCloudResourceSummedMetrics,
} from "Common/Types/Cloud/CloudResourceMetricAggregation";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { CLOUD_ALERT_WINDOWS } from "Common/Types/Monitor/CloudAlertTemplates";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import {
  AWS_CLOUDWATCH_DIMENSION_PREFIX,
  AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE,
  AWS_JSON_INSTANCE_ID_ATTRIBUTE,
  AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE,
  CLOUD_ACCOUNT_ID_ATTRIBUTE,
  CLOUD_REGION_ATTRIBUTE,
  GCP_RESOURCE_TYPE_ATTRIBUTE,
  SERVICE_NAMESPACE_ATTRIBUTE,
  SERVICE_NAME_ATTRIBUTE,
} from "Common/Types/Cloud/CloudMonitoredResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  CloudKeyMetricReference,
  getCloudKeyMetricOfStoredName,
  hasAzureFiveMinuteKeyMetrics,
} from "Common/Types/Cloud/CloudKeyMetrics";
import {
  CLOUD_KEY_METRIC_GROUP_LABELS,
  CLOUD_KEY_METRIC_GROUP_ORDER,
  getCloudKeyMetricGroupOrder,
} from "Common/Types/Cloud/CloudKeyMetricGroup";
import {
  CloudAddedMetric,
  getCloudAddedMetricSplitAttribute,
  getCloudAddedMetricStoredName,
  getCloudAddedMetricsOfResource,
  readCloudAddedMetrics,
} from "Common/Types/Cloud/CloudAddedMetrics";
import {
  getCloudKeyMetricsOfResource,
  getCloudUnreportedKeyMetrics,
} from "Common/Types/Cloud/CloudUnreportedKeyMetrics";
import {
  GetMetricRowAggregation,
  GetMetricRowGroup,
  GetMetricRowGroupGaps,
  MetricRowAggregation,
  MetricRowGroup,
  MetricRowGroupGap,
} from "../../../Components/Metrics/Utils/MetricRowScope";

/*
 * How a Cloud Resource - one IaaS or PaaS resource discovered from Azure
 * Monitor, CloudWatch or Cloud Monitoring - is scoped onto its metrics.
 *
 * An environment's telemetry is everything carrying its three cloud.*
 * resource attributes (CloudResourceTelemetryScope). A resource's is not:
 * every resource of an Azure subscription or an AWS account arrives under
 * the same OTel resource, and says which resource it is about on each
 * datapoint. Ingest records, on the row, the exact stored attributes that
 * select one resource's datapoints (CloudResource.telemetryAttributes:
 * `azuremonitor.resource_id`; the CloudWatch namespace, identifying
 * dimensions, account and region; the Cloud Monitoring resource type and
 * identifying labels), and this module is the one place that turns that
 * column into the filter the Metrics viewer, the explorer and the monitors
 * created from it use - and decides when there is no filter at all.
 *
 * Pages must not query metrics for an unscoped resource: an empty filter is
 * "every metric in the project".
 */

export interface CloudMonitoredResourceScopeSource {
  cloudResourceKind?: string | undefined;
  telemetryAttributes?: unknown;
}

/*
 * The attribute filter for a resource's metrics: the recorded attributes
 * whose values are non-empty strings, nothing else. Empty for an
 * environment, and for a resource whose row carries no usable attributes.
 */
export function getCloudMonitoredResourceAttributeFilters(
  source: CloudMonitoredResourceScopeSource | null | undefined,
): Record<string, string> {
  const filters: Record<string, string> = {};

  if (!source || !isCloudResourceKindResource(source.cloudResourceKind)) {
    return filters;
  }

  const attributes: unknown = source.telemetryAttributes;

  if (
    !attributes ||
    typeof attributes !== "object" ||
    Array.isArray(attributes)
  ) {
    return filters;
  }

  for (const [key, value] of Object.entries(
    attributes as Record<string, unknown>,
  )) {
    if (key && typeof value === "string" && value.trim()) {
      filters[key] = value;
    }
  }

  return filters;
}

// True only when the resource's metrics can be selected without selecting others.
export function isCloudMonitoredResourceScoped(
  source: CloudMonitoredResourceScopeSource | null | undefined,
): boolean {
  return (
    Object.keys(getCloudMonitoredResourceAttributeFilters(source)).length > 0
  );
}

const FIXED_DISPLAY_KEYS: Readonly<Record<string, string>> = {
  [AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE]: translationKey("Azure resource"),
  [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: translationKey("CloudWatch namespace"),
  [SERVICE_NAME_ATTRIBUTE]: translationKey("CloudWatch service"),
  [SERVICE_NAMESPACE_ATTRIBUTE]: translationKey("CloudWatch namespace"),
  [AWS_JSON_INSTANCE_ID_ATTRIBUTE]: "InstanceId",
  [CLOUD_ACCOUNT_ID_ATTRIBUTE]: translationKey("Account"),
  [CLOUD_REGION_ATTRIBUTE]: translationKey("Region"),
  [GCP_RESOURCE_TYPE_ATTRIBUTE]: translationKey("Resource type"),
  "resource.project_id": translationKey("Project"),
};

/*
 * How the locked filter chips above the Metrics viewer read, keyed like
 * the filter: "Azure resource", "Region", or a CloudWatch dimension or a
 * Cloud Monitoring label by its own name ("InstanceId", "zone") - never a
 * raw stored key such as `Dimensions.InstanceId`.
 */
export function getCloudMonitoredResourceAttributeDisplayKeys(
  filters: Record<string, string>,
): Record<string, string> {
  const displayKeys: Record<string, string> = {};

  for (const key of Object.keys(filters)) {
    const fixed: string | undefined = FIXED_DISPLAY_KEYS[key];

    if (fixed) {
      displayKeys[key] = fixed;
    } else if (key.startsWith(AWS_CLOUDWATCH_DIMENSION_PREFIX)) {
      displayKeys[key] = key.slice(AWS_CLOUDWATCH_DIMENSION_PREFIX.length);
    } else if (key.startsWith("resource.")) {
      displayKeys[key] = key.slice("resource.".length);
    } else {
      displayKeys[key] = key;
    }
  }

  return displayKeys;
}

/*
 * How a resource's metric rows read (MetricsViewer's getRowAggregation and
 * defaultRowValueCaption), for a resource whose metrics arrive once per part
 * of it: a Service Bus or Event Hubs namespace's, once per queue, topic and
 * event hub (CloudResourceMetricAggregation). Each metric whose parts add up
 * reads as their total, its row saying "total of series", and opens the
 * explorer - and a monitor created from it - with Sum: a count over any
 * range, an amount held (messages waiting) over a range read by the minute,
 * up to 3 hours. A summed row shows the intervals its cloud has delivered
 * whole (getSummedRowSettleMs). Each other row says it is the "average of
 * series". A key metric whose points come five minutes apart - an Azure
 * metric kept at five minutes at its finest, an App Service app's health
 * check (CloudKeyMetricReference.intervalSeconds) - says so, "every 5
 * minutes", so its line is never read as a minute's. Undefined for every
 * other resource, whose rows read and caption exactly as they did.
 */
export interface CloudMonitoredResourceRowAggregation {
  getRowAggregation: GetMetricRowAggregation;
  // The caption of every other row; unset: none.
  defaultRowValueCaption?: string | undefined;
}

export const CLOUD_RESOURCE_SUMMED_ROW_CAPTION: string =
  translationKey("total of series");
export const CLOUD_RESOURCE_AVERAGED_ROW_CAPTION: string =
  translationKey("average of series");
export const CLOUD_RESOURCE_FIVE_MINUTE_ROW_CAPTION: string =
  translationKey("every 5 minutes");

// Seconds between two points of a key metric read at five minutes.
const FIVE_MINUTES_IN_SECONDS: number = 300;

// Whether a type has a key metric whose points come five minutes apart.
function hasFiveMinuteKeyMetrics(provider: string, type: string): boolean {
  return (
    provider.trim().toLowerCase() === CloudProvider.Azure &&
    hasAzureFiveMinuteKeyMetrics(type)
  );
}

export interface CloudMonitoredResourceAggregationSource {
  cloudProvider?: unknown;
  cloudResourceType?: unknown;
}

/*
 * How long after an interval of a summed row ends its cloud may still be
 * delivering its points (MetricRowAggregation.settleMs). Azure's arrive
 * minutes late - a connection reads them every five minutes, four minutes
 * behind - and the window its monitors read (CLOUD_ALERT_WINDOWS, 15
 * minutes) always holds them, so an interval of several minutes is whole
 * that long after it ends. Read sooner, a namespace's messages over a day
 * read the newest quarter hour's first few minutes as its count. None while
 * an interval is a minute: a minute holds one point of each queue, all read
 * together, whole once it is there at all.
 */
function getSummedRowSettleMs(data: {
  provider: string;
  aggregationInterval: AggregationInterval;
}): number {
  if (data.aggregationInterval === AggregationInterval.Minute) {
    return 0;
  }

  const window: RollingTime | undefined =
    CLOUD_ALERT_WINDOWS[data.provider.trim().toLowerCase() as CloudProvider];

  return window ? RollingTimeUtil.getWindowInMs(window) : 0;
}

export function getCloudMonitoredResourceRowAggregation(
  source: CloudMonitoredResourceAggregationSource | null | undefined,
): CloudMonitoredResourceRowAggregation | undefined {
  const provider: string =
    typeof source?.cloudProvider === "string" ? source.cloudProvider : "";
  const type: string =
    typeof source?.cloudResourceType === "string"
      ? source.cloudResourceType
      : "";

  const hasSummedMetrics: boolean = hasCloudResourceSummedMetrics({
    provider,
    type,
  });

  if (!hasSummedMetrics && !hasFiveMinuteKeyMetrics(provider, type)) {
    return undefined;
  }

  return {
    getRowAggregation: (
      metricName: string,
      startAndEndDate: InBetween<Date>,
    ): MetricRowAggregation | undefined => {
      // The intervals the aggregate API reads this range in.
      const aggregationInterval: AggregationInterval =
        AggregationIntervalUtil.getAggregationIntervalForWindow({
          startDate: startAndEndDate.startValue,
          endDate: startAndEndDate.endValue,
        });
      const aggregationType: AggregationType | undefined = hasSummedMetrics
        ? getCloudResourceMetricAggregation({
            provider,
            type,
            metricName,
            aggregationInterval,
          })
        : undefined;

      if (aggregationType) {
        const settleMs: number = getSummedRowSettleMs({
          provider,
          aggregationInterval,
        });

        return {
          aggregationType: aggregationType,
          caption: CLOUD_RESOURCE_SUMMED_ROW_CAPTION,
          ...(settleMs > 0 ? { settleMs } : {}),
        };
      }

      // Read as every row is, saying its points come five minutes apart.
      if (
        getCloudKeyMetricOfStoredName({ provider, type, metricName })
          ?.intervalSeconds === FIVE_MINUTES_IN_SECONDS
      ) {
        return {
          aggregationType: AggregationType.Avg,
          caption: CLOUD_RESOURCE_FIVE_MINUTE_ROW_CAPTION,
        };
      }

      return undefined;
    },
    ...(hasSummedMetrics
      ? { defaultRowValueCaption: CLOUD_RESOURCE_AVERAGED_ROW_CAPTION }
      : {}),
  };
}

// The section of the metrics someone added to what the connection reads (#9563).
export const CLOUD_ADDED_METRICS_GROUP_KEY: string = "added";
export const CLOUD_ADDED_METRICS_GROUP_TITLE: string =
  translationKey("Added metrics");

/*
 * The sections a resource's metric rows read in (MetricsViewer's
 * getRowGroup): each key metric its cloud connection reads for the
 * resource's type (CloudKeyMetrics) in its group - Availability, Traffic,
 * Errors, Latency, Compute, Memory, Storage, Network, Connections, Cache,
 * Backlog, Replication, in that order - the type's most telling first in
 * each; then the metrics someone added to what the connection reads for it
 * (`addedStoredNames`, getCloudResourceAddedStoredNames), under "Added
 * metrics", in the order they were added; any other metric (a collector's,
 * an app's) after them, under "Other". Undefined without a provider: the
 * list reads as one, as before.
 */
export function getCloudMonitoredResourceRowGroup(
  source: CloudMonitoredResourceAggregationSource | null | undefined,
  addedStoredNames: ReadonlyArray<string> = [],
): GetMetricRowGroup | undefined {
  const provider: string =
    typeof source?.cloudProvider === "string" ? source.cloudProvider : "";
  const type: string =
    typeof source?.cloudResourceType === "string"
      ? source.cloudResourceType
      : "";

  if (!provider.trim()) {
    return undefined;
  }

  const added: Map<string, number> = new Map();

  addedStoredNames.forEach((name: string, rank: number) => {
    const key: string = name.trim().toLowerCase();

    if (key && !added.has(key)) {
      added.set(key, rank);
    }
  });

  return (metricName: string): MetricRowGroup | undefined => {
    const reference: CloudKeyMetricReference | null =
      getCloudKeyMetricOfStoredName({ provider, type, metricName });

    if (!reference) {
      const rank: number | undefined = added.get(
        metricName.trim().toLowerCase(),
      );

      return rank === undefined
        ? undefined
        : {
            key: CLOUD_ADDED_METRICS_GROUP_KEY,
            title: CLOUD_ADDED_METRICS_GROUP_TITLE,
            order: CLOUD_KEY_METRIC_GROUP_ORDER.length,
            rank,
          };
    }

    return {
      key: reference.group,
      title: CLOUD_KEY_METRIC_GROUP_LABELS[reference.group],
      order: getCloudKeyMetricGroupOrder(reference.group),
      rank: reference.rank,
    };
  };
}

export interface CloudMonitoredResourceAddedSource {
  _id?: unknown;
  cloudResourceType?: unknown;
  cloudConnection?: { addedMetrics?: unknown } | null | undefined;
}

/*
 * The names the metrics someone added for this resource are stored under -
 * its type's additions and its own (CloudAddedMetrics), in the order they
 * were added - from its connection's additions.
 */
export function getCloudResourceAddedMetrics(
  source: CloudMonitoredResourceAddedSource | null | undefined,
): Array<CloudAddedMetric> {
  return getCloudAddedMetricsOfResource({
    added: readCloudAddedMetrics(source?.cloudConnection?.addedMetrics),
    resourceType:
      typeof source?.cloudResourceType === "string"
        ? source.cloudResourceType
        : "",
    cloudResourceId: source?._id ? String(source._id) : undefined,
  });
}

export function getCloudResourceAddedStoredNames(
  source: CloudMonitoredResourceAddedSource | null | undefined,
): Array<string> {
  return getCloudResourceAddedMetrics(source).map(
    (metric: CloudAddedMetric): string => {
      return getCloudAddedMetricStoredName(metric);
    },
  );
}

/*
 * The additions split by a dimension (#9808): the name each is stored
 * under, in lower case, and the attribute its series carry their value in
 * (getCloudAddedMetricSplitAttribute).
 */
export function getCloudResourceAddedSplitAttributes(
  source: CloudMonitoredResourceAddedSource | null | undefined,
): Map<string, string> {
  const attributes: Map<string, string> = new Map<string, string>();

  for (const metric of getCloudResourceAddedMetrics(source)) {
    const attribute: string = getCloudAddedMetricSplitAttribute(metric);

    if (attribute) {
      attributes.set(
        getCloudAddedMetricStoredName(metric).trim().toLowerCase(),
        attribute,
      );
    }
  }

  return attributes;
}

export interface CloudMonitoredResourceGapSource
  extends CloudMonitoredResourceAggregationSource {
  telemetryAttributes?: unknown;
}

/*
 * The key metrics of each section the resource did not report in the
 * list's range (MetricsViewer's getRowGroupGaps, #9569): its type's key
 * metrics (CloudUnreportedKeyMetrics) - an AWS resource's of its own
 * namespace, which its attributes name - none of the reported names is,
 * each section's in its order. Undefined for a resource of a type with no
 * key metrics.
 */
export function getCloudMonitoredResourceRowGroupGaps(
  source: CloudMonitoredResourceGapSource | null | undefined,
): GetMetricRowGroupGaps | undefined {
  const provider: string =
    typeof source?.cloudProvider === "string" ? source.cloudProvider : "";
  const type: string =
    typeof source?.cloudResourceType === "string"
      ? source.cloudResourceType
      : "";
  const attributes: unknown = source?.telemetryAttributes;
  const namespace: string =
    attributes && typeof attributes === "object" && !Array.isArray(attributes)
      ? String(
          (attributes as Record<string, unknown>)[
            AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE
          ] || "",
        )
      : "";

  if (
    getCloudKeyMetricsOfResource({ provider, type, namespace }).length === 0
  ) {
    return undefined;
  }

  return (reportedNames: ReadonlyArray<string>): Array<MetricRowGroupGap> => {
    const gaps: Map<string, MetricRowGroupGap> = new Map();

    for (const metric of getCloudUnreportedKeyMetrics({
      provider,
      type,
      namespace,
      reportedMetricNames: reportedNames,
    })) {
      let gap: MetricRowGroupGap | undefined = gaps.get(metric.group);

      if (!gap) {
        gap = {
          group: {
            key: metric.group,
            title: CLOUD_KEY_METRIC_GROUP_LABELS[metric.group],
            order: getCloudKeyMetricGroupOrder(metric.group),
            rank: 0,
          },
          keys: [],
        };
        gaps.set(metric.group, gap);
      }

      gap.keys.push(metric.key);
    }

    return Array.from(gaps.values());
  };
}
