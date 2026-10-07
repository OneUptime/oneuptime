import {
  AWS_CLOUDWATCH_DIMENSION_PREFIX,
  AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE,
  AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE,
  AZURE_MONITOR_SUBSCRIPTION_ID_ATTRIBUTE,
  CLOUD_ACCOUNT_ID_ATTRIBUTE,
  CLOUD_REGION_ATTRIBUTE,
  CloudMonitoredResource,
  CloudMonitoringSource,
  SERVICE_NAMESPACE_ATTRIBUTE,
  SERVICE_NAME_ATTRIBUTE,
  getCloudMonitoringSource,
  resolveCloudMonitoredResource,
} from "Common/Types/Cloud/CloudMonitoredResource";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

/*
 * The per-REQUEST half of cloud resource discovery: which cloud resources
 * the metric rows of one ingest request are about.
 *
 * A cloud-monitoring receiver (azure_monitor, aws_cloudwatch / awsfirehose,
 * googlecloudmonitoring) sends each poll as one request carrying the
 * datapoints of many resources - an Azure subscription's every VM, disk and
 * storage account under one OTel resource. Which resource a datapoint is
 * about is on the datapoint itself, so it is read per ROW: every row goes
 * through observeMetricRow, and the request ends with the distinct
 * resources it named (getResources), which OtelIngestBaseService
 * .autoDiscoverCloudMonitoredResources turns into Cloud Resources.
 *
 * The resource is read by the ONE pure resolver (Common/Types/Cloud/
 * CloudMonitoredResource); this module adds no cloud rule of its own. Like
 * MessagingEntityKeys, it is built for the ingest hot path:
 *
 *   1. It reads the FINAL row - after the drop filter, scrub rules and
 *      pipeline - so a datapoint the user drops never creates a resource,
 *      and a redacted identity never becomes one.
 *   2. It costs next to nothing for rows that are not cloud monitoring:
 *      getCloudMonitoringSource turns them away with four property reads,
 *      before anything is allocated.
 *   3. It memoizes per request: a poll repeats each resource's identity on
 *      every one of its datapoints (one per metric, aggregation and
 *      dimension combination), so the resolver runs once per resource, not
 *      once per row.
 *   4. It never throws. A resolver bug costs the row its resource, never the
 *      row: the failure is logged once per request and ingest goes on.
 *   5. It is bounded: past MAX_MEMO_ENTRIES rows resolve without memoizing,
 *      and past MAX_RESOURCES_PER_REQUEST distinct resources the rest wait
 *      for a later request (every resource is reported again on the next
 *      poll).
 */

type RowAttributes = Record<string, unknown>;

export const CLOUD_MONITORED_RESOURCE_MAX_MEMO_ENTRIES: number = 10_000;
export const CLOUD_MONITORED_RESOURCE_MAX_RESOURCES_PER_REQUEST: number = 5_000;
// A memo key longer than this (outsized attribute values) is not memoized.
export const CLOUD_MONITORED_RESOURCE_MAX_MEMO_KEY_LENGTH: number = 4_096;

// What the Azure Monitor resolver reads, in a fixed order.
const AZURE_MEMO_ATTRIBUTES: ReadonlyArray<string> = [
  AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE,
  "name",
  "location",
  "resource_group",
  AZURE_MONITOR_SUBSCRIPTION_ID_ATTRIBUTE,
];

const RESOURCE_PREFIX: string = "resource.";
const SCOPE_PREFIX: string = "scope.";

/*
 * Whether the resolver reads a stored key for this source - so the memo key
 * holds exactly the inputs that can change its answer.
 */
function isResolverInput(source: CloudMonitoringSource, key: string): boolean {
  switch (source) {
    case CloudMonitoringSource.AwsCloudWatch:
      return (
        key === AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE ||
        key.startsWith(AWS_CLOUDWATCH_DIMENSION_PREFIX) ||
        key === CLOUD_ACCOUNT_ID_ATTRIBUTE ||
        key === CLOUD_REGION_ATTRIBUTE
      );
    case CloudMonitoringSource.AwsCloudWatchJson:
      if (key.startsWith(SCOPE_PREFIX)) {
        return false;
      }
      if (key.startsWith(RESOURCE_PREFIX)) {
        return (
          key === SERVICE_NAMESPACE_ATTRIBUTE ||
          key === SERVICE_NAME_ATTRIBUTE ||
          key === CLOUD_ACCOUNT_ID_ATTRIBUTE ||
          key === CLOUD_REGION_ATTRIBUTE
        );
      }
      // Every datapoint attribute of a JSON stream is a dimension.
      return true;
    case CloudMonitoringSource.GoogleCloudMonitoring:
      return key.startsWith(RESOURCE_PREFIX);
    default:
      return false;
  }
}

// A value as the memo key holds it: its type and its text, unambiguously.
function memoValue(value: unknown): string {
  if (typeof value === "string") {
    return `s${value}`;
  }
  return `j${String(JSON.stringify(value))}`;
}

/*
 * The resolver's inputs for one row, as one string - or null when they are
 * too long to be worth memoizing.
 */
export function buildCloudMonitoredResourceMemoKey(
  source: CloudMonitoringSource,
  attributes: RowAttributes,
): string | null {
  const parts: Array<string> = [source];

  if (source === CloudMonitoringSource.AzureMonitor) {
    for (const key of AZURE_MEMO_ATTRIBUTES) {
      parts.push(key, memoValue(attributes[key]));
    }
  } else {
    for (const key of Object.keys(attributes)) {
      if (isResolverInput(source, key)) {
        parts.push(key, memoValue(attributes[key]));
      }
    }
  }

  const memoKey: string = JSON.stringify(parts);

  return memoKey.length > CLOUD_MONITORED_RESOURCE_MAX_MEMO_KEY_LENGTH
    ? null
    : memoKey;
}

export default class CloudMonitoredResourceCollector {
  private readonly memo: Map<string, CloudMonitoredResource | null> = new Map<
    string,
    CloudMonitoredResource | null
  >();
  private readonly resources: Map<string, CloudMonitoredResource> = new Map<
    string,
    CloudMonitoredResource
  >();
  private hasReportedFailure: boolean = false;

  /*
   * Read one FINAL metric row (name, and attributes as stored). Returns
   * whether the row is about a cloud resource. Never throws.
   */
  public observeMetricRow(row: JSONObject): boolean {
    try {
      if (!row || typeof row !== "object") {
        return false;
      }

      const attributes: unknown = row["attributes"];
      const source: CloudMonitoringSource | null = getCloudMonitoringSource(
        row["name"],
        attributes,
      );

      if (!source) {
        return false;
      }

      const resource: CloudMonitoredResource | null = this.resolve(
        source,
        row["name"],
        attributes as RowAttributes,
      );

      if (!resource) {
        return false;
      }

      if (
        !this.resources.has(resource.identityKey) &&
        this.resources.size < CLOUD_MONITORED_RESOURCE_MAX_RESOURCES_PER_REQUEST
      ) {
        this.resources.set(resource.identityKey, resource);
      }

      return true;
    } catch (error) {
      this.reportFailure(error);
      return false;
    }
  }

  // The distinct resources the request's rows named, in first-seen order.
  public getResources(): Array<CloudMonitoredResource> {
    return Array.from(this.resources.values());
  }

  private resolve(
    source: CloudMonitoringSource,
    metricName: unknown,
    attributes: RowAttributes,
  ): CloudMonitoredResource | null {
    const memoKey: string | null = buildCloudMonitoredResourceMemoKey(
      source,
      attributes,
    );

    if (memoKey !== null) {
      const cached: CloudMonitoredResource | null | undefined =
        this.memo.get(memoKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    let resource: CloudMonitoredResource | null = null;
    try {
      resource = resolveCloudMonitoredResource({
        metricName: metricName,
        attributes: attributes,
      });
    } catch (error) {
      this.reportFailure(error);
      resource = null;
    }

    if (
      memoKey !== null &&
      this.memo.size < CLOUD_MONITORED_RESOURCE_MAX_MEMO_ENTRIES
    ) {
      this.memo.set(memoKey, resource);
    }

    return resource;
  }

  private reportFailure(error: unknown): void {
    if (this.hasReportedFailure) {
      return;
    }
    this.hasReportedFailure = true;
    logger.error(
      `Cloud resource resolution failed for a metric row; the row is kept without its cloud resource: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
