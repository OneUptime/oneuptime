import BadDataException from "../Exception/BadDataException";
import { CloudProvider } from "./CloudPlatform";
import {
  getAwsStoredMetricName,
  getAzureStoredMetricName,
} from "./CloudKeyMetrics";

/*
 * THE METRICS PEOPLE ADD TO WHAT A CLOUD CONNECTION READS (#9563).
 *
 * A connection reads a curated set of key metrics per resource type
 * (CloudKeyMetrics). A resource publishes more - an App Service's
 * AverageMemoryWorkingSet, an RDS instance's SwapUsage, a Cloud SQL
 * database's postgresql/num_backends - and its Metrics tab lists them, on
 * demand, from its cloud (CloudResourceMetrics: Azure's metric definitions,
 * CloudWatch's ListMetrics on its dimensions, Cloud Monitoring's metric
 * descriptors of its type). A person may add one, and the connection reads
 * it from then on with the key metrics, in the same reads:
 *
 *   - for that resource alone (a resource's own addition), or
 *   - for every resource of its type the connection reads (its type's).
 *
 * The additions are kept on the connection (CloudConnection.addedMetrics)
 * and are bounded: at most CLOUD_MAX_ADDED_METRICS_PER_RESOURCE apply to
 * any one resource, and a connection holds at most
 * CLOUD_MAX_ADDED_METRICS_PER_CONNECTION. Each rides in a read that is made
 * anyway wherever one can carry it: an Azure resource's metrics call (20
 * metrics a call), CloudWatch's GetMetricData (500 queries a call), Cloud
 * Monitoring's timeSeries.list (one metric type a call, narrowed to the
 * resource's own series). An added metric is stored and named as the
 * cloud's receivers name it, so it charts and alerts like a key metric.
 */

export enum CloudAddedMetricScope {
  // This resource alone.
  Resource = "resource",
  // Every resource of its type the connection reads.
  Type = "type",
}

export interface CloudAddedMetricDimension {
  name: string;
  value: string;
}

export interface CloudAddedMetric {
  // Tells it from the connection's other additions (getCloudAddedMetricKey).
  key: string;
  provider: CloudProvider;
  scope: CloudAddedMetricScope;
  /*
   * The resource type it is read for: an ARM type, a CloudFormation type,
   * a Cloud Monitoring monitored resource type.
   */
  resourceType: string;
  /*
   * A resource's own addition: its CloudResource row, and what its cloud
   * knows it by - an Azure resource's ARM id; an AWS resource's account,
   * Region and the series' exact dimensions; a Google Cloud resource's
   * project and identifying labels.
   */
  cloudResourceId?: string | undefined;
  azureResourceId?: string | undefined;
  accountId?: string | undefined;
  region?: string | undefined;
  dimensions?: Array<CloudAddedMetricDimension> | undefined;
  resourceLabels?: Record<string, string> | undefined;
  /*
   * The cloud's own name for the metric: Azure Monitor's ("Average Memory
   * Working Set"), CloudWatch's ("SwapUsage"), or a Cloud Monitoring metric
   * type ("cloudsql.googleapis.com/database/postgresql/num_backends").
   */
  name: string;
  // AWS: the CloudWatch namespace it is published in.
  namespace?: string | undefined;
  /*
   * How it is read: an Azure aggregation (its definition's primary one), a
   * CloudWatch statistic, or a Cloud Monitoring aligner.
   */
  aggregation: string;
  // Azure: the grain it is read at, its finest from a minute up.
  grain?: string | undefined;
  // Its unit, as its cloud gives it (CloudWatch's listing gives none).
  unit: string;
  /*
   * Read split by one of its dimensions (#9808): a series per value of it,
   * at most CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES a resource - an Azure
   * dimension ("ApiName"), a CloudWatch dimension the resource's own series
   * are published under ("AvailabilityZone"), a Cloud Monitoring metric
   * label ("response_code_class").
   */
  splitBy?: string | undefined;
  /*
   * Google Cloud, read split: the labels of the monitored resource a split
   * read keeps (aggregation.groupByFields), so each series is still filed
   * under its resource while the metric's other labels are added up.
   */
  resourceLabelKeys?: Array<string> | undefined;
  // When, and by whom, it was added.
  addedAt: string;
  addedByUserId?: string | undefined;
}

/*
 * The values of its dimension a split addition is read for, at most, per
 * resource each read (#9808): Azure Monitor's own default for a split read
 * (`top`), the busiest first; on AWS each value is a metric read, and on
 * Google Cloud a time series, so this bounds what a split costs and stores.
 */
export const CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES: number = 10;

/*
 * Google Cloud bills every series a call returns, and timeSeries.list has
 * no top-N, so a split is read for each resource's busiest values alone
 * (#10076): learned over the last hour, once an hour, by a PromQL topk that
 * returns those alone. What it costs counts them (CloudConnectionCost).
 */
export const GCP_SPLIT_LEARN_EVERY_MINUTES: number = 60;

// Google Cloud: the aligners a split read can add a metric's other labels up with.
export const GCP_SPLIT_ALIGNERS: ReadonlyArray<string> = [
  "ALIGN_RATE",
  "ALIGN_MEAN",
];

/*
 * At most this many additions apply to one resource - its type's and its
 * own - and a connection holds at most this many: what bounds the reads
 * they add.
 */
export const CLOUD_MAX_ADDED_METRICS_PER_RESOURCE: number = 10;
export const CLOUD_MAX_ADDED_METRICS_PER_CONNECTION: number = 50;

// How each cloud's addition may be read.
export const AZURE_ADDED_METRIC_AGGREGATIONS: ReadonlyArray<string> = [
  "Average",
  "Total",
  "Maximum",
  "Minimum",
  "Count",
];
export const AWS_ADDED_METRIC_STATISTICS: ReadonlyArray<string> = [
  "Average",
  "Sum",
  "Maximum",
  "Minimum",
];
export const GCP_ADDED_METRIC_ALIGNERS: ReadonlyArray<string> = [
  "ALIGN_MEAN",
  "ALIGN_MAX",
  "ALIGN_RATE",
  "ALIGN_PERCENTILE_95",
  "ALIGN_FRACTION_TRUE",
];
// Azure grains an addition may be read at: a minute up to an hour.
export const AZURE_ADDED_METRIC_GRAINS: ReadonlyArray<string> = [
  "PT1M",
  "PT5M",
  "PT15M",
  "PT30M",
  "PT1H",
];

const MAX_NAME_LENGTH: number = 256;
const MAX_FIELD_LENGTH: number = 512;
// A Cloud Monitoring metric type, as the filter of a call quotes it.
const GCP_METRIC_TYPE_PATTERN: RegExp = /^[a-z0-9][a-z0-9._/-]*$/i;
// A Cloud Monitoring monitored resource type, as the filter of a call quotes it.
const GCP_RESOURCE_TYPE_PATTERN: RegExp = /^[a-z][a-z0-9_.]*$/i;
// A Cloud Monitoring label's key and value, as the filter of a call quotes them.
const GCP_LABEL_KEY_PATTERN: RegExp = /^[a-z][a-z0-9_]*$/i;
// An Azure Monitor dimension a split call's $filter names: letters and digits.
const AZURE_DIMENSION_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
// A CloudWatch dimension's name: up to 255 characters, none of them a control character.
function isAwsDimensionName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    name.trim() === name &&
    Array.from(name).every((character: string): boolean => {
      return character.charCodeAt(0) >= 32;
    })
  );
}

/*
 * Whether a dimension can be what an addition is split by, on its cloud:
 * one a split read can name safely.
 */
export function isCloudAddedMetricSplit(
  provider: CloudProvider | string,
  splitBy: string,
): boolean {
  switch (provider) {
    case CloudProvider.Azure:
      return AZURE_DIMENSION_PATTERN.test(splitBy);
    case CloudProvider.AWS:
      return isAwsDimensionName(splitBy);
    case CloudProvider.GCP:
      return GCP_LABEL_KEY_PATTERN.test(splitBy);
    default:
      return false;
  }
}
const GCP_LABEL_VALUE_PATTERN: RegExp = /^[^"\\]*$/;

/*
 * Whether a Cloud Monitoring label can be named in a call's filter as it
 * is: a key of letters, digits and "_", a value with no quote or backslash
 * to end its string early. A read narrows a call only by labels that can.
 */
export function isGcpFilterLabel(key: string, value: string): boolean {
  return GCP_LABEL_KEY_PATTERN.test(key) && GCP_LABEL_VALUE_PATTERN.test(value);
}

// What tells two additions apart: the same metric, read for the same resources.
export function getCloudAddedMetricKey(data: {
  scope: CloudAddedMetricScope;
  resourceType: string;
  cloudResourceId?: string | undefined;
  namespace?: string | undefined;
  name: string;
}): string {
  return [
    data.scope,
    data.resourceType.trim().toLowerCase(),
    data.scope === CloudAddedMetricScope.Resource
      ? (data.cloudResourceId || "").trim().toLowerCase()
      : "",
    (data.namespace || "").trim().toLowerCase(),
    data.name.trim().toLowerCase(),
  ].join("|");
}

/*
 * The name the metric is stored under, in lower case, as ingest stores
 * it: Azure's "azure_<name>_<aggregation>", CloudWatch's
 * "amazonaws.com/<namespace>/<name>", a Cloud Monitoring metric type as it
 * is - so an addition reads, charts and alerts as a key metric does.
 */
export function getCloudAddedMetricStoredName(
  metric: Pick<CloudAddedMetric, "provider" | "name" | "namespace"> & {
    aggregation: string;
  },
): string {
  switch (metric.provider) {
    case CloudProvider.Azure:
      return getAzureStoredMetricName(metric.name, metric.aggregation);
    case CloudProvider.AWS:
      return getAwsStoredMetricName(
        metric.namespace || "",
        metric.name,
      ).toLowerCase();
    default:
      return metric.name.toLowerCase();
  }
}

/*
 * The datapoint attribute a split addition's series carry their value in
 * (#9808), as each cloud's receivers write it - Azure's
 * "metadata_<dimension>" in lower case, CloudWatch's
 * "Dimensions.<dimension>", a Cloud Monitoring label by its key - so a
 * chart or a monitor groups by it to draw or judge each value. "" for an
 * addition read whole.
 */
export function getCloudAddedMetricSplitAttribute(
  metric: Pick<CloudAddedMetric, "provider" | "splitBy">,
): string {
  if (!metric.splitBy) {
    return "";
  }

  switch (metric.provider) {
    case CloudProvider.Azure:
      return `metadata_${metric.splitBy.toLowerCase()}`;
    case CloudProvider.AWS:
      return `Dimensions.${metric.splitBy}`;
    default:
      return metric.splitBy;
  }
}

/*
 * The additions that apply to one resource, in the order they were
 * added: its type's, and its own.
 */
export function getCloudAddedMetricsOfResource(data: {
  added: ReadonlyArray<CloudAddedMetric>;
  resourceType: string;
  cloudResourceId?: string | undefined;
}): Array<CloudAddedMetric> {
  const type: string = (data.resourceType || "").trim().toLowerCase();
  const resourceId: string = (data.cloudResourceId || "").trim().toLowerCase();

  return data.added.filter((metric: CloudAddedMetric): boolean => {
    if (metric.resourceType.trim().toLowerCase() !== type) {
      return false;
    }

    return (
      metric.scope === CloudAddedMetricScope.Type ||
      (Boolean(resourceId) &&
        (metric.cloudResourceId || "").trim().toLowerCase() === resourceId)
    );
  });
}

// The type-wide additions of one type, in the order they were added.
export function getCloudAddedMetricsOfType(data: {
  added: ReadonlyArray<CloudAddedMetric>;
  resourceType: string;
}): Array<CloudAddedMetric> {
  const type: string = (data.resourceType || "").trim().toLowerCase();

  return data.added.filter((metric: CloudAddedMetric): boolean => {
    return (
      metric.scope === CloudAddedMetricScope.Type &&
      metric.resourceType.trim().toLowerCase() === type
    );
  });
}

function readText(value: unknown, max: number = MAX_FIELD_LENGTH): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function readDimensions(
  value: unknown,
): Array<CloudAddedMetricDimension> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const dimensions: Array<CloudAddedMetricDimension> = [];

  for (const item of value.slice(0, 30)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const name: string = readText((item as Record<string, unknown>)["name"]);
    const dimensionValue: string = readText(
      (item as Record<string, unknown>)["value"],
    );

    if (name) {
      dimensions.push({ name, value: dimensionValue });
    }
  }

  return dimensions;
}

function readLabels(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const labels: Record<string, string> = {};

  for (const [key, labelValue] of Object.entries(
    value as Record<string, unknown>,
  ).slice(0, 30)) {
    if (key && typeof labelValue === "string") {
      labels[key] = labelValue.slice(0, MAX_FIELD_LENGTH);
    }
  }

  return labels;
}

// One stored addition, or null when it is not one.
function readCloudAddedMetric(value: unknown): CloudAddedMetric | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const provider: string = readText(raw["provider"]);
  const scope: string = readText(raw["scope"]);
  const resourceType: string = readText(raw["resourceType"]);
  const name: string = readText(raw["name"], MAX_NAME_LENGTH);
  const aggregation: string = readText(raw["aggregation"]);

  if (
    !(Object.values(CloudProvider) as Array<string>).includes(provider) ||
    !(Object.values(CloudAddedMetricScope) as Array<string>).includes(scope) ||
    !resourceType ||
    !name ||
    !aggregation
  ) {
    return null;
  }

  const metric: CloudAddedMetric = {
    key: "",
    provider: provider as CloudProvider,
    scope: scope as CloudAddedMetricScope,
    resourceType,
    name,
    aggregation,
    unit: readText(raw["unit"]),
    addedAt: readText(raw["addedAt"]) || new Date(0).toISOString(),
  };

  const splitBy: string = readText(raw["splitBy"], MAX_NAME_LENGTH);

  // A split no read could name is dropped, and the addition read whole.
  if (splitBy && isCloudAddedMetricSplit(provider, splitBy)) {
    metric.splitBy = splitBy;
  }

  if (Array.isArray(raw["resourceLabelKeys"])) {
    const keys: Array<string> = (raw["resourceLabelKeys"] as Array<unknown>)
      .slice(0, 30)
      .filter((key: unknown): key is string => {
        return typeof key === "string" && GCP_LABEL_KEY_PATTERN.test(key);
      });

    if (keys.length > 0) {
      metric.resourceLabelKeys = keys;
    }
  }

  for (const field of [
    "cloudResourceId",
    "azureResourceId",
    "accountId",
    "region",
    "namespace",
    "grain",
    "addedByUserId",
  ] as const) {
    const text: string = readText(raw[field]);

    if (text) {
      metric[field] = text;
    }
  }

  const dimensions: Array<CloudAddedMetricDimension> | undefined =
    readDimensions(raw["dimensions"]);

  if (dimensions) {
    metric.dimensions = dimensions;
  }

  const labels: Record<string, string> | undefined = readLabels(
    raw["resourceLabels"],
  );

  if (labels) {
    metric.resourceLabels = labels;
  }

  if (
    metric.scope === CloudAddedMetricScope.Resource &&
    !metric.cloudResourceId
  ) {
    return null;
  }

  metric.key = getCloudAddedMetricKey(metric);

  return metric;
}

/*
 * A connection's additions as stored (CloudConnection.addedMetrics), read
 * defensively: what is not an addition is dropped, and so is a second of
 * the same key.
 */
export function readCloudAddedMetrics(value: unknown): Array<CloudAddedMetric> {
  const list: unknown =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)["metrics"]
      : value;

  if (!Array.isArray(list)) {
    return [];
  }

  const metrics: Array<CloudAddedMetric> = [];
  const keys: Set<string> = new Set<string>();

  for (const item of list.slice(0, CLOUD_MAX_ADDED_METRICS_PER_CONNECTION)) {
    const metric: CloudAddedMetric | null = readCloudAddedMetric(item);

    if (metric && !keys.has(metric.key)) {
      keys.add(metric.key);
      metrics.push(metric);
    }
  }

  return metrics;
}

// The additions as the connection keeps them.
export function toStoredCloudAddedMetrics(
  metrics: ReadonlyArray<CloudAddedMetric>,
): { metrics: Array<CloudAddedMetric> } {
  return {
    metrics: metrics.map((metric: CloudAddedMetric) => {
      return { ...metric };
    }),
  };
}

/*
 * What refuses an addition, in words a person can act on: the server's
 * answer to Add, which the dialog shows as its error.
 */
export const CLOUD_ADDED_METRIC_REFUSALS: Readonly<Record<string, string>> = {
  resourceFull: `This resource already has ${CLOUD_MAX_ADDED_METRICS_PER_RESOURCE} added metrics read for it. Remove one to add another.`,
  connectionFull: `This cloud connection already reads ${CLOUD_MAX_ADDED_METRICS_PER_CONNECTION} added metrics. Remove one to add another.`,
  alreadyRead:
    "Its cloud connection already reads this metric for this resource.",
  invalid:
    "This metric cannot be added: its cloud did not list it for this resource.",
  invalidSplit:
    "This metric cannot be split that way: its cloud did not list that dimension for it. Pick one of the dimensions listed.",
  splitRequired:
    "Its cloud reads this metric only split by one of its dimensions. Pick one to split it by.",
};

/*
 * Checks an addition's fields before it is kept: its name and how it is
 * read are ones its cloud's read can send, as they will be quoted into a
 * call. Throws a BadDataException saying what is wrong.
 */
export function validateCloudAddedMetric(metric: CloudAddedMetric): void {
  const name: string = metric.name;

  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["invalid"]!);
  }

  if (
    metric.splitBy !== undefined &&
    !isCloudAddedMetricSplit(metric.provider, metric.splitBy)
  ) {
    throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["invalidSplit"]!);
  }

  // Google Cloud adds the other labels up: a rate or a level, by the resource's labels.
  if (
    metric.provider === CloudProvider.GCP &&
    metric.splitBy &&
    (!GCP_SPLIT_ALIGNERS.includes(metric.aggregation) ||
      !metric.resourceLabelKeys ||
      metric.resourceLabelKeys.length === 0)
  ) {
    throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["invalidSplit"]!);
  }

  switch (metric.provider) {
    case CloudProvider.Azure:
      // Azure takes a call's metric names separated by commas.
      if (
        name.includes(",") ||
        !AZURE_ADDED_METRIC_AGGREGATIONS.includes(metric.aggregation) ||
        !AZURE_ADDED_METRIC_GRAINS.includes((metric.grain || "").toUpperCase())
      ) {
        throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["invalid"]!);
      }

      if (
        metric.scope === CloudAddedMetricScope.Resource &&
        !metric.azureResourceId
      ) {
        throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["invalid"]!);
      }

      return;
    case CloudProvider.AWS:
      if (
        !metric.namespace ||
        !AWS_ADDED_METRIC_STATISTICS.includes(metric.aggregation)
      ) {
        throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["invalid"]!);
      }

      if (
        metric.scope === CloudAddedMetricScope.Resource &&
        (!metric.region ||
          !metric.accountId ||
          !metric.dimensions ||
          metric.dimensions.length === 0)
      ) {
        throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["invalid"]!);
      }

      return;
    case CloudProvider.GCP:
      if (
        !GCP_METRIC_TYPE_PATTERN.test(name) ||
        !GCP_RESOURCE_TYPE_PATTERN.test(metric.resourceType) ||
        !GCP_ADDED_METRIC_ALIGNERS.includes(metric.aggregation)
      ) {
        throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["invalid"]!);
      }

      if (metric.scope === CloudAddedMetricScope.Resource) {
        const labels: Record<string, string> = metric.resourceLabels || {};

        if (
          !metric.accountId ||
          Object.keys(labels).length === 0 ||
          !Object.entries(labels).every(([key, value]: [string, string]) => {
            return isGcpFilterLabel(key, value);
          })
        ) {
          throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["invalid"]!);
        }
      }

      return;
    default:
      throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["invalid"]!);
  }
}

// Whether two additions are the same metric of the same type, however scoped.
function isSameAddedMetric(a: CloudAddedMetric, b: CloudAddedMetric): boolean {
  return (
    a.resourceType.trim().toLowerCase() ===
      b.resourceType.trim().toLowerCase() &&
    (a.namespace || "").trim().toLowerCase() ===
      (b.namespace || "").trim().toLowerCase() &&
    a.name.trim().toLowerCase() === b.name.trim().toLowerCase()
  );
}

/*
 * The connection's additions with one more, or a BadDataException saying
 * why not: the metric is read for the resource already, the resource it
 * applies to would have more than CLOUD_MAX_ADDED_METRICS_PER_RESOURCE
 * (its type's and its own), or the connection would hold more than
 * CLOUD_MAX_ADDED_METRICS_PER_CONNECTION. A type's addition takes the
 * place of the resources' own additions of the same metric: each is read
 * once.
 */
export function addCloudAddedMetric(data: {
  added: ReadonlyArray<CloudAddedMetric>;
  metric: CloudAddedMetric;
  /*
   * The resources of its type the connection reads, for a type's addition:
   * none of them may end up with more than the most.
   */
  cloudResourceIds: ReadonlyArray<string>;
}): Array<CloudAddedMetric> {
  const metric: CloudAddedMetric = {
    ...data.metric,
    key: getCloudAddedMetricKey(data.metric),
  };

  validateCloudAddedMetric(metric);

  const isTypeWide: boolean = metric.scope === CloudAddedMetricScope.Type;
  const added: Array<CloudAddedMetric> = data.added.filter(
    (existing: CloudAddedMetric): boolean => {
      return !(
        isTypeWide &&
        existing.scope === CloudAddedMetricScope.Resource &&
        isSameAddedMetric(existing, metric)
      );
    },
  );

  if (
    added.some((existing: CloudAddedMetric): boolean => {
      return (
        existing.key === metric.key ||
        (existing.scope === CloudAddedMetricScope.Type &&
          isSameAddedMetric(existing, metric))
      );
    })
  ) {
    throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["alreadyRead"]!);
  }

  if (added.length >= CLOUD_MAX_ADDED_METRICS_PER_CONNECTION) {
    throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["connectionFull"]!);
  }

  const resourceIds: Array<string> = isTypeWide
    ? [...data.cloudResourceIds]
    : [metric.cloudResourceId || ""];

  for (const cloudResourceId of resourceIds) {
    if (
      getCloudAddedMetricsOfResource({
        added,
        resourceType: metric.resourceType,
        cloudResourceId,
      }).length >= CLOUD_MAX_ADDED_METRICS_PER_RESOURCE
    ) {
      throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["resourceFull"]!);
    }
  }

  // A type's addition before any resource of it still counts for the first.
  if (
    isTypeWide &&
    getCloudAddedMetricsOfType({
      added,
      resourceType: metric.resourceType,
    }).length >= CLOUD_MAX_ADDED_METRICS_PER_RESOURCE
  ) {
    throw new BadDataException(CLOUD_ADDED_METRIC_REFUSALS["resourceFull"]!);
  }

  return [...added, metric];
}

// The connection's additions without the one of this key.
export function removeCloudAddedMetric(data: {
  added: ReadonlyArray<CloudAddedMetric>;
  key: string;
}): Array<CloudAddedMetric> {
  return data.added.filter((metric: CloudAddedMetric): boolean => {
    return metric.key !== data.key;
  });
}
