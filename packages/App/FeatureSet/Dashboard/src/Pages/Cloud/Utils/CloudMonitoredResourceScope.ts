import { isCloudResourceKindResource } from "Common/Types/Cloud/CloudResourceKind";
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
