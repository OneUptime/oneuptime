import { CloudProvider } from "./CloudPlatform";
import {
  AwsArnContext,
  AwsCloudWatchResourceRule,
  GcpMonitoredResourceRule,
  getAwsCloudWatchRulesForNamespace,
  getAwsPartitionForRegion,
  getCanonicalCloudResourceType,
  getCloudResourceTypeLabel,
  getGcpMonitoredResourceRule,
} from "./CloudResourceCatalog";
import Crypto from "../../Utils/Crypto";

/*
 * Which cloud resource a metric datapoint is about, read from what the
 * OpenTelemetry Collector's cloud-monitoring receivers put on it.
 *
 * A cloud provider measures the resources it runs for you - virtual
 * machines, load balancers, buckets, managed databases, queues - and
 * publishes the numbers through its monitoring API. An OpenTelemetry
 * Collector reads that API and exports the numbers to OneUptime like any
 * other metric. Every such datapoint is about ONE resource, and says which
 * in its own attributes, each receiver in its own way:
 *
 *   - Azure Monitor (`azure_monitor` receiver): the resource's ARM id on the
 *     datapoint (`azuremonitor.resource_id`), with its `name`, `type`,
 *     `resource_group` and `location`; the subscription on the resource
 *     (`azuremonitor.subscription_id`).
 *   - CloudWatch, OpenTelemetry 1.0 shape - a Metric Stream through the
 *     `awsfirehose` receiver, and the `aws_cloudwatch` receiver's pull:
 *     the namespace and dimensions on the datapoint (`Namespace`,
 *     `Dimensions.<name>`), the metric named `amazonaws.com/<namespace>/<metric>`,
 *     the account and region on the resource (`cloud.account.id`,
 *     `cloud.region`).
 *   - CloudWatch, JSON shape - a Metric Stream in JSON: the namespace split
 *     onto the resource (`service.namespace` "AWS", `service.name` "EC2"),
 *     marked by `aws.cloudwatch.metric_stream_name`; each dimension a
 *     datapoint attribute of its own, `InstanceId` renamed to
 *     `service.instance.id`.
 *   - Google Cloud Monitoring (`googlecloudmonitoring` receiver): the
 *     monitored resource's type and labels on the resource
 *     (`gcp.resource_type`, `project_id`, `zone`, `instance_id`, ...).
 *
 * resolveCloudMonitoredResource reads a STORED metric row - datapoint keys
 * bare, resource keys `resource.`-prefixed, kvlists flattened to
 * `<key>.<nested key>` - and returns the resource, or null when the
 * datapoint is not from a cloud-monitoring receiver or names no single
 * resource (an account-wide total, a CloudWatch namespace or Cloud
 * Monitoring type the catalog has no identity rule for).
 *
 * What a resource IS - which dimensions or labels identify one, what its
 * type is called - lives in CloudResourceCatalog. This module only reads
 * the receivers' shapes, and builds from them:
 *
 *   - `identityKey`: the canonical (trimmed, lowercased) identity, so a
 *     resource reported in two spellings is one row;
 *   - `telemetryAttributes`: the exact stored attributes, values as sent,
 *     that select this resource's metrics - what the resource's pages and
 *     its monitors filter on;
 *   - `providerResourceId`: the provider's own id for it, where the
 *     datapoint names it completely (an ARM id, an ARN, a full resource
 *     name), so it can be pasted into the provider's console.
 */

export enum CloudMonitoringSource {
  AzureMonitor = "azure_monitor",
  AwsCloudWatch = "aws_cloudwatch",
  AwsCloudWatchJson = "aws_cloudwatch_json",
  GoogleCloudMonitoring = "googlecloudmonitoring",
}

// What each source is called, for the docs and the dashboard.
export const CLOUD_MONITORING_SOURCE_LABELS: Readonly<
  Record<CloudMonitoringSource, string>
> = {
  [CloudMonitoringSource.AzureMonitor]: "Azure Monitor",
  [CloudMonitoringSource.AwsCloudWatch]: "Amazon CloudWatch",
  [CloudMonitoringSource.AwsCloudWatchJson]: "Amazon CloudWatch (JSON stream)",
  [CloudMonitoringSource.GoogleCloudMonitoring]: "Google Cloud Monitoring",
};

export interface CloudMonitoredResource {
  provider: CloudProvider;
  source: CloudMonitoringSource;
  // The provider's type, as CloudResourceCatalog spells it.
  resourceType: string;
  // What the provider calls the resource: "vm-prod-01", "checkout", "orders".
  name: string;
  /*
   * The provider's id for the resource: its ARM id, its ARN or its full
   * resource name - or, where the datapoint does not name it completely, a
   * readable composite of what does ("AWS/AmazonMQ Broker=orders").
   */
  providerResourceId: string;
  // Subscription id, account id or project id; empty when not reported.
  accountId: string;
  // Location, region or a zone's region; empty when not reported.
  region: string;
  // The Azure resource group; empty for every other provider.
  resourceGroup: string;
  // Canonical identity: the same resource always has the same key.
  identityKey: string;
  // Exact stored-attribute filter selecting this resource's metrics.
  telemetryAttributes: Record<string, string>;
}

// Stored attribute keys the receivers write.
export const AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE: string =
  "azuremonitor.resource_id";
export const AZURE_MONITOR_SUBSCRIPTION_ID_ATTRIBUTE: string =
  "resource.azuremonitor.subscription_id";
export const AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE: string = "Namespace";
export const AWS_CLOUDWATCH_DIMENSION_PREFIX: string = "Dimensions.";
export const AWS_CLOUDWATCH_METRIC_NAME_PREFIX: string = "amazonaws.com/";
export const AWS_METRIC_STREAM_NAME_ATTRIBUTE: string =
  "resource.aws.cloudwatch.metric_stream_name";
export const GCP_RESOURCE_TYPE_ATTRIBUTE: string = "resource.gcp.resource_type";

export const CLOUD_ACCOUNT_ID_ATTRIBUTE: string = "resource.cloud.account.id";
export const CLOUD_REGION_ATTRIBUTE: string = "resource.cloud.region";
export const SERVICE_NAMESPACE_ATTRIBUTE: string = "resource.service.namespace";
export const SERVICE_NAME_ATTRIBUTE: string = "resource.service.name";
/*
 * The JSON stream writes the `InstanceId` dimension as this key
 * (awscloudwatchmetricstreams_encoding's setDataPointAttributes).
 */
export const AWS_JSON_INSTANCE_ID_ATTRIBUTE: string = "service.instance.id";

const RESOURCE_PREFIX: string = "resource.";
const SCOPE_PREFIX: string = "scope.";

/*
 * The longest value read as part of an identity. ARM ids, CloudWatch
 * dimension values (1,024 at most) and Cloud Monitoring labels all fit; a
 * longer one is not a real identity and the datapoint is skipped.
 */
export const CLOUD_MONITORED_RESOURCE_MAX_VALUE_LENGTH: number = 1024;

// A stored attribute value as text: strings trimmed, numbers and booleans as written.
function readText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function isUsable(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= CLOUD_MONITORED_RESOURCE_MAX_VALUE_LENGTH
  );
}

type Attributes = Readonly<Record<string, unknown>>;

/*
 * Which receiver shape a stored metric row is in - or null for every other
 * datapoint. This is the hot-path gate: a few property reads and one
 * prefix check, no allocation.
 */
export function getCloudMonitoringSource(
  metricName: unknown,
  attributes: unknown,
): CloudMonitoringSource | null {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }

  const record: Attributes = attributes as Attributes;

  if (readText(record[AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE])) {
    return CloudMonitoringSource.AzureMonitor;
  }

  if (readText(record[GCP_RESOURCE_TYPE_ATTRIBUTE])) {
    return CloudMonitoringSource.GoogleCloudMonitoring;
  }

  if (
    readText(record[AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]) &&
    typeof metricName === "string" &&
    metricName.toLowerCase().startsWith(AWS_CLOUDWATCH_METRIC_NAME_PREFIX)
  ) {
    return CloudMonitoringSource.AwsCloudWatch;
  }

  if (readText(record[AWS_METRIC_STREAM_NAME_ATTRIBUTE])) {
    return CloudMonitoringSource.AwsCloudWatchJson;
  }

  return null;
}

/*
 * The cloud resource a stored metric row is about, or null. Never throws
 * on any input shape.
 */
export function resolveCloudMonitoredResource(data: {
  metricName: unknown;
  attributes: unknown;
}): CloudMonitoredResource | null {
  const source: CloudMonitoringSource | null = getCloudMonitoringSource(
    data.metricName,
    data.attributes,
  );

  if (!source) {
    return null;
  }

  const attributes: Attributes = data.attributes as Attributes;

  switch (source) {
    case CloudMonitoringSource.AzureMonitor:
      return resolveAzureMonitorResource(attributes);
    case CloudMonitoringSource.AwsCloudWatch:
      return resolveAwsCloudWatchResource(attributes);
    case CloudMonitoringSource.AwsCloudWatchJson:
      return resolveAwsCloudWatchJsonResource(attributes);
    case CloudMonitoringSource.GoogleCloudMonitoring:
      return resolveGcpMonitoredResource(attributes);
  }

  return null;
}

/*
 * ---- Azure ---------------------------------------------------------------
 */

export interface ParsedAzureResourceId {
  subscriptionId: string;
  resourceGroup: string;
  // "Microsoft.Sql/servers/databases", as the id spells it.
  type: string;
  // "sql-prod/orders": every name after the provider namespace.
  name: string;
}

/*
 * `/subscriptions/{sub}/resourceGroups/{rg}/providers/{namespace}/{type}/{name}[/{type}/{name}...]`
 * → its parts. A child resource's type and name carry every level
 * (`Microsoft.Sql/servers/databases`, `sql-prod/orders`), as the ARM API
 * lists them. Segment names are matched without regard to case, as ARM
 * does. Null for anything that is not a resource id.
 */
export function parseAzureResourceId(
  resourceId: string,
): ParsedAzureResourceId | null {
  const segments: Array<string> = resourceId
    .trim()
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });

  if (
    segments.length < 2 ||
    segments[0]!.toLowerCase() !== "subscriptions" ||
    !segments[1]
  ) {
    return null;
  }

  // The last `providers` segment: an extension resource's own provider.
  let providersIndex: number = -1;
  for (let index: number = 2; index < segments.length; index++) {
    if (segments[index]!.toLowerCase() === "providers") {
      providersIndex = index;
    }
  }

  if (providersIndex < 0) {
    return null;
  }

  const namespace: string = segments[providersIndex + 1] || "";
  const typeAndNames: Array<string> = segments.slice(providersIndex + 2);

  // At least one type/name pair, and every type has its name.
  if (!namespace || typeAndNames.length < 2 || typeAndNames.length % 2 !== 0) {
    return null;
  }

  const types: Array<string> = [];
  const names: Array<string> = [];
  for (let index: number = 0; index < typeAndNames.length; index += 2) {
    types.push(typeAndNames[index]!);
    names.push(typeAndNames[index + 1]!);
  }

  let resourceGroup: string = "";
  if (
    segments.length > 3 &&
    segments[2]!.toLowerCase() === "resourcegroups" &&
    providersIndex > 3
  ) {
    resourceGroup = segments[3]!;
  }

  return {
    subscriptionId: segments[1]!,
    resourceGroup: resourceGroup,
    type: `${namespace}/${types.join("/")}`,
    name: names.join("/"),
  };
}

function resolveAzureMonitorResource(
  attributes: Attributes,
): CloudMonitoredResource | null {
  const resourceId: string = readText(
    attributes[AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE],
  );

  if (!isUsable(resourceId)) {
    return null;
  }

  const parsed: ParsedAzureResourceId | null = parseAzureResourceId(resourceId);

  if (!parsed) {
    return null;
  }

  /*
   * The type and name come from the id - the identity itself - with the
   * catalog's spelling of the type, so Azure Monitor's
   * `Microsoft.ServiceBus/Namespaces` and `.../namespaces` are one type.
   * The receiver's own `name` is preferred for display: the ARM API lists
   * a child resource as `server/database` either way.
   */
  const resourceType: string = getCanonicalCloudResourceType(
    CloudProvider.Azure,
    parsed.type,
  );
  const name: string = readText(attributes["name"]) || parsed.name;

  return {
    provider: CloudProvider.Azure,
    source: CloudMonitoringSource.AzureMonitor,
    resourceType: resourceType,
    name: name,
    providerResourceId: resourceId,
    accountId:
      parsed.subscriptionId ||
      readText(attributes[AZURE_MONITOR_SUBSCRIPTION_ID_ATTRIBUTE]),
    region: readText(attributes["location"]),
    resourceGroup:
      parsed.resourceGroup || readText(attributes["resource_group"]),
    // ARM ids are case-insensitive.
    identityKey: `${CloudProvider.Azure}|${resourceId.toLowerCase()}`,
    telemetryAttributes: {
      [AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE]: resourceId,
    },
  };
}

/*
 * ---- AWS -----------------------------------------------------------------
 */

interface AwsDatapoint {
  namespace: string;
  accountId: string;
  region: string;
  // Every dimension, by its CloudWatch name, as text.
  dimensions: Record<string, string>;
  // The stored key each dimension was read from.
  dimensionKeys: Record<string, string>;
  // The stored keys and values that select the namespace.
  namespaceAttributes: Record<string, string>;
}

function resolveAwsCloudWatchResource(
  attributes: Attributes,
): CloudMonitoredResource | null {
  const namespace: string = readText(
    attributes[AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE],
  );

  if (!isUsable(namespace)) {
    return null;
  }

  const dimensions: Record<string, string> = {};
  const dimensionKeys: Record<string, string> = {};

  for (const key of Object.keys(attributes)) {
    if (!key.startsWith(AWS_CLOUDWATCH_DIMENSION_PREFIX)) {
      continue;
    }
    const value: string = readText(attributes[key]);
    if (value) {
      const dimensionName: string = key.slice(
        AWS_CLOUDWATCH_DIMENSION_PREFIX.length,
      );
      dimensions[dimensionName] = value;
      dimensionKeys[dimensionName] = key;
    }
  }

  return resolveAwsDatapoint(
    {
      namespace: namespace,
      accountId: readText(attributes[CLOUD_ACCOUNT_ID_ATTRIBUTE]),
      region: readText(attributes[CLOUD_REGION_ATTRIBUTE]),
      dimensions: dimensions,
      dimensionKeys: dimensionKeys,
      namespaceAttributes: {
        [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: namespace,
      },
    },
    CloudMonitoringSource.AwsCloudWatch,
  );
}

function resolveAwsCloudWatchJsonResource(
  attributes: Attributes,
): CloudMonitoredResource | null {
  /*
   * The JSON stream splits an `AWS/` namespace into `service.namespace`
   * ("AWS") and `service.name` ("EC2"), and writes any other namespace
   * whole into `service.name`.
   */
  const serviceNamespace: string = readText(
    attributes[SERVICE_NAMESPACE_ATTRIBUTE],
  );
  const serviceName: string = readText(attributes[SERVICE_NAME_ATTRIBUTE]);

  if (!isUsable(serviceName)) {
    return null;
  }

  const namespace: string = serviceNamespace
    ? `${serviceNamespace}/${serviceName}`
    : serviceName;

  const dimensions: Record<string, string> = {};
  const dimensionKeys: Record<string, string> = {};

  for (const key of Object.keys(attributes)) {
    if (key.startsWith(RESOURCE_PREFIX) || key.startsWith(SCOPE_PREFIX)) {
      continue;
    }
    const value: string = readText(attributes[key]);
    if (!value) {
      continue;
    }
    const dimensionName: string =
      key === AWS_JSON_INSTANCE_ID_ATTRIBUTE ? "InstanceId" : key;
    dimensions[dimensionName] = value;
    dimensionKeys[dimensionName] = key;
  }

  const namespaceAttributes: Record<string, string> = {
    [SERVICE_NAME_ATTRIBUTE]: serviceName,
  };
  if (serviceNamespace) {
    namespaceAttributes[SERVICE_NAMESPACE_ATTRIBUTE] = serviceNamespace;
  }

  return resolveAwsDatapoint(
    {
      namespace: namespace,
      accountId: readText(attributes[CLOUD_ACCOUNT_ID_ATTRIBUTE]),
      region: readText(attributes[CLOUD_REGION_ATTRIBUTE]),
      dimensions: dimensions,
      dimensionKeys: dimensionKeys,
      namespaceAttributes: namespaceAttributes,
    },
    CloudMonitoringSource.AwsCloudWatchJson,
  );
}

/*
 * The first rule of the namespace whose identity dimensions are all on the
 * datapoint and whose excluded ones are not - or null.
 */
export function findAwsCloudWatchRule(
  namespace: string,
  dimensions: Readonly<Record<string, string>>,
): AwsCloudWatchResourceRule | null {
  for (const rule of getAwsCloudWatchRulesForNamespace(namespace)) {
    const hasIdentity: boolean = rule.identityDimensions.every(
      (name: string): boolean => {
        return isUsable(dimensions[name] || "");
      },
    );
    const isExcluded: boolean = (rule.excludedDimensions || []).some(
      (name: string): boolean => {
        return Boolean(dimensions[name]);
      },
    );
    if (hasIdentity && !isExcluded) {
      return rule;
    }
  }
  return null;
}

function getAwsArn(
  rule: AwsCloudWatchResourceRule,
  datapoint: AwsDatapoint,
): string | null {
  if (!rule.getArn) {
    return null;
  }

  const scope: string = rule.arnScope || "account-regional";
  const needsRegion: boolean =
    scope === "account-regional" || scope === "regional";
  const needsAccount: boolean =
    scope === "account-regional" || scope === "account-global";

  if (
    (needsRegion && !datapoint.region) ||
    (needsAccount && !datapoint.accountId)
  ) {
    return null;
  }

  const context: AwsArnContext = {
    partition: getAwsPartitionForRegion(datapoint.region),
    region: datapoint.region,
    accountId: datapoint.accountId,
    dimensions: datapoint.dimensions,
  };

  const value: string | null = rule.getArn(context);
  return value && value.startsWith("arn:") ? value : null;
}

function resolveAwsDatapoint(
  datapoint: AwsDatapoint,
  source: CloudMonitoringSource,
): CloudMonitoredResource | null {
  const rule: AwsCloudWatchResourceRule | null = findAwsCloudWatchRule(
    datapoint.namespace,
    datapoint.dimensions,
  );

  if (!rule) {
    return null;
  }

  const identityPairs: Array<string> = rule.identityDimensions.map(
    (name: string): string => {
      return `${name}=${datapoint.dimensions[name]}`;
    },
  );

  const telemetryAttributes: Record<string, string> = {
    ...datapoint.namespaceAttributes,
  };
  for (const name of rule.identityDimensions) {
    telemetryAttributes[datapoint.dimensionKeys[name]!] =
      datapoint.dimensions[name]!;
  }
  if (datapoint.accountId) {
    telemetryAttributes[CLOUD_ACCOUNT_ID_ATTRIBUTE] = datapoint.accountId;
  }
  if (datapoint.region) {
    telemetryAttributes[CLOUD_REGION_ATTRIBUTE] = datapoint.region;
  }

  const name: string = (
    rule.getName
      ? rule.getName(datapoint.dimensions)
      : datapoint.dimensions[rule.identityDimensions[0]!] || ""
  ).trim();

  return {
    provider: CloudProvider.AWS,
    source: source,
    resourceType: rule.type,
    name: name || identityPairs.join(" "),
    providerResourceId:
      getAwsArn(rule, datapoint) ||
      `${rule.namespace} ${identityPairs.join(" ")}`,
    accountId: datapoint.accountId,
    region: datapoint.region,
    resourceGroup: "",
    identityKey: [
      CloudProvider.AWS,
      datapoint.accountId,
      datapoint.region,
      rule.type,
      ...identityPairs,
    ]
      .join("|")
      .toLowerCase(),
    telemetryAttributes: telemetryAttributes,
  };
}

/*
 * ---- Google Cloud --------------------------------------------------------
 */

/*
 * A Cloud Monitoring label as the receiver stored it. Its metadata system
 * labels go through protobuf's `Value.String()`, which writes
 * `string_value:"my-vm"` rather than `my-vm`; that wrapping is undone.
 */
function readGcpLabel(attributes: Attributes, key: string): string {
  const value: string = readText(attributes[`${RESOURCE_PREFIX}${key}`]);
  const match: RegExpMatchArray | null = value.match(
    /^string_value:\s*"((?:[^"\\]|\\.)*)"$/,
  );
  return match ? match[1]!.replace(/\\(.)/g, "$1") : value;
}

// "us-central1-a" → "us-central1"; a region or multi-region stays as it is.
export function getRegionFromGcpLocation(location: string): string {
  const match: RegExpMatchArray | null = location.match(
    /^([a-z]+-[a-z]+\d+)-[a-z]$/,
  );
  return match ? match[1]! : location;
}

function resolveGcpMonitoredResource(
  attributes: Attributes,
): CloudMonitoredResource | null {
  const resourceType: string = readText(
    attributes[GCP_RESOURCE_TYPE_ATTRIBUTE],
  );
  const rule: GcpMonitoredResourceRule | null =
    getGcpMonitoredResourceRule(resourceType);

  if (!rule) {
    return null;
  }

  /*
   * Every label the receiver put on the resource - the monitored resource's
   * own, and its metadata's - keyed without the `resource.` prefix, so a
   * rule can name a resource from a metadata label (a VM's `name`).
   */
  const labels: Record<string, string> = {};
  for (const key of Object.keys(attributes)) {
    if (key.startsWith(RESOURCE_PREFIX)) {
      const labelKey: string = key.slice(RESOURCE_PREFIX.length);
      labels[labelKey] = readGcpLabel(attributes, labelKey);
    }
  }

  const hasIdentity: boolean = rule.identityLabels.every(
    (key: string): boolean => {
      return isUsable(labels[key] || "");
    },
  );

  if (!hasIdentity) {
    return null;
  }

  const accountLabel: string = rule.accountLabel || "project_id";
  const accountValue: string = labels[accountLabel] || "";
  const accountId: string =
    accountLabel === "resource_container" &&
    accountValue.startsWith("projects/")
      ? accountValue.slice("projects/".length)
      : accountValue;

  const location: string = rule.locationLabel
    ? labels[rule.locationLabel] || ""
    : "";

  const telemetryAttributes: Record<string, string> = {
    [GCP_RESOURCE_TYPE_ATTRIBUTE]: resourceType,
  };
  for (const key of rule.identityLabels) {
    telemetryAttributes[`${RESOURCE_PREFIX}${key}`] = readText(
      attributes[`${RESOURCE_PREFIX}${key}`],
    );
  }

  const identityPairs: Array<string> = rule.identityLabels.map(
    (key: string): string => {
      return `${key}=${labels[key]}`;
    },
  );

  const fullResourceName: string | null = rule.getFullResourceName
    ? rule.getFullResourceName(labels)
    : null;

  return {
    provider: CloudProvider.GCP,
    source: CloudMonitoringSource.GoogleCloudMonitoring,
    resourceType: rule.type,
    name: rule.getName(labels).trim() || identityPairs.join(" "),
    providerResourceId:
      fullResourceName || `${rule.type} ${identityPairs.join(" ")}`,
    accountId: accountId,
    region: getRegionFromGcpLocation(location),
    resourceGroup: "",
    identityKey: [CloudProvider.GCP, rule.type, ...identityPairs]
      .join("|")
      .toLowerCase(),
    telemetryAttributes: telemetryAttributes,
  };
}

/*
 * ---- Row identity and naming ---------------------------------------------
 */

/*
 * CloudResource.resourceIdentifier for a resource: the provider and a hash
 * of its canonical identity ("azure:3f9a0c..."). The column is 100
 * characters and an ARM id alone can be longer; the full id is kept in
 * providerResourceId. The shape never collides with an environment key,
 * which is three `|`-separated parts led by a managed platform value.
 */
export function buildCloudMonitoredResourceIdentifier(
  resource: Pick<CloudMonitoredResource, "provider" | "identityKey">,
): string {
  return `${resource.provider}:${Crypto.getSha256Hash(resource.identityKey).slice(0, 40)}`;
}

// The CloudResource name column's width.
export const CLOUD_RESOURCE_NAME_MAX_LENGTH: number = 100;

// The fewest characters of the provider's name a qualified candidate keeps.
const MIN_NAME_ROOM: number = 12;

function clampName(value: string, maxLength: number): string {
  const trimmed: string = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/*
 * The names a new resource is given, in the order they are tried: names
 * are unique within a project, and the provider's name is not (two
 * subscriptions each have a "web-01"; an App Service plan and its app are
 * both "checkout"). The first one free is used:
 *
 *   1. the provider's name: "web-01";
 *   2. with its type: "web-01 (Virtual Machine)";
 *   3. with its resource group, or region, too: "web-01 (Virtual Machine, rg-prod)";
 *   4. with its account too;
 *   5. with a short hash of its identity, which is unique.
 *
 * Every candidate fits the name column.
 */
export function getCloudMonitoredResourceNameCandidates(
  resource: CloudMonitoredResource,
): Array<string> {
  const typeLabel: string = getCloudResourceTypeLabel(
    resource.provider,
    resource.resourceType,
  );
  const base: string =
    resource.name.trim() || typeLabel || resource.providerResourceId;
  const place: string = resource.resourceGroup || resource.region;
  const hash: string = Crypto.getSha256Hash(resource.identityKey).slice(0, 8);

  const qualifierSets: Array<Array<string>> = [
    [],
    [typeLabel],
    [typeLabel, place],
    [typeLabel, place, resource.accountId],
    [hash],
  ];

  const candidates: Array<string> = [];

  for (const qualifiers of qualifierSets) {
    const present: Array<string> = qualifiers.filter(
      (qualifier: string): boolean => {
        return qualifier.trim().length > 0;
      },
    );

    if (qualifiers.length > 0 && present.length === 0) {
      continue;
    }

    const suffix: string = present.length > 0 ? ` (${present.join(", ")})` : "";
    const room: number = CLOUD_RESOURCE_NAME_MAX_LENGTH - suffix.length;

    // Qualifiers that leave the name no room are no help; the hash's always fit.
    if (room < MIN_NAME_ROOM) {
      continue;
    }

    const name: string = `${clampName(base, room)}${suffix}`;

    if (name.trim() && !candidates.includes(name)) {
      candidates.push(name);
    }
  }

  return candidates;
}
