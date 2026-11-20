import { isAwsRegion } from "../../../Types/Cloud/AwsRegionCode";
import {
  CloudProvider,
  FaasCloudPlatform,
  normalizeCloudPlatform,
} from "../../../Types/Cloud/CloudPlatform";
import { canCloudResourceHaveStreamedLogs } from "../../../Types/Cloud/CloudLogGroups";
import { getAwsPartitionForRegion } from "../../../Types/Cloud/CloudResourceCatalog";
import {
  AWS_CLOUDWATCH_DIMENSION_PREFIX,
  AWS_CLOUDWATCH_METRIC_NAME_PREFIX,
  AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE,
  CLOUD_ACCOUNT_ID_ATTRIBUTE,
  CLOUD_REGION_ATTRIBUTE,
  CloudMonitoredResource,
  GCP_RESOURCE_TYPE_ATTRIBUTE,
  isCloudProviderOwnResourceId,
  resolveCloudMonitoredResource,
} from "../../../Types/Cloud/CloudMonitoredResource";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import { writeOwnValue } from "../../LookupTable";
import {
  MAX_RESOURCE_ID_LENGTH,
  isCloudResourceIdLike,
  readCloudEndpointHosts,
} from "../../SecurityCase/SecurityConnectionMatch";
import { MAX_EVENT_RESOURCE_IDS } from "../SecurityRecordReading";

/*
 * THE CLOUD RESOURCES AN AUDIT RECORD IS ABOUT (#9779), by the id their
 * Cloud Resource keeps (CloudResource.providerResourceId): an AWS ARN, an
 * Azure resource ID, a Google Cloud full resource name.
 *
 * A cloud's audit log keeps the resource a call was made on, each cloud its
 * own way, and none where a record's scope reads it:
 *
 *   - CloudTrail lists some of it in `resources[].ARN`, and names the rest
 *     in the call's own parameters - a bucket by `bucketName`, an instance
 *     by its id, a function by its name or its ARN - and in what AWS
 *     answered (RunInstances' new instances, CreateFunction's ARN);
 *   - the Azure Activity Log keeps it in `resourceId`, in whatever case the
 *     writer chose (the export writes it in capitals);
 *   - Google Cloud's audit logs keep it in `protoPayload.resourceName`,
 *     relative to the API that wrote it, and file the entry under the
 *     monitored resource it is about (`resource.type` and its labels).
 *
 * Read here into the ids OneUptime keeps, so a parser puts them among the
 * event's observables - what a record's Security card and Security Events
 * page search (Types/SecurityEvent/SecurityEventScope) - and the event
 * reaches the resource's page, its open cases and its risk:
 *
 *   - AWS: an ARN as AWS writes it, and the ARN built from a name or an id
 *     the way the resource's own row got its - by the cloud catalog
 *     (CloudResourceCatalog, through resolveCloudMonitoredResource), or as
 *     the inventory builds a VPC's, a subnet's, a security group's and an
 *     EKS cluster's - so the two can only be equal for the same resource;
 *   - Azure: the resource ID in lower case - Azure's own resource IDs are
 *     case-insensitive, and a record's search reads its own ID in lower
 *     case among its spellings;
 *   - Google Cloud: `//<service>/<resource name>`, and the full resource
 *     name the catalog builds from the monitored resource, as the
 *     resource's own row and its streamed logs got theirs.
 *
 * A record about a part of a resource is also about the resource: an S3
 * object's bucket, a Lambda version's function, a DynamoDB index's table,
 * a container of an Azure storage account, a role assigned on a Key Vault,
 * a BigQuery table's dataset. That resource is named too.
 *
 * Only an exact id is ever named. A bare name - a bucket called "logs", a
 * function called "api" - is never put among the observables: it could be
 * any resource of that name, in any account, or a host or a user of the
 * same name. A name becomes an ARN only with the account and the Region the
 * record was written in, through the catalog's own template.
 *
 * Every value here was written outside OneUptime - a request parameter is
 * whatever the caller typed - so each is read with loops and slices, never
 * a regular expression, and each walk is bounded.
 */

// The most cloud resources one record names among its observables.
export const MAX_CLOUD_AUDIT_RESOURCE_IDS: number = MAX_EVENT_RESOURCE_IDS;

/*
 * The deepest a record's parameters are walked, the most text values read
 * of them and the most objects, lists and values looked at in all.
 */
const MAX_WALK_DEPTH: number = 8;
const MAX_WALK_VALUES: number = 500;
const MAX_WALK_NODES: number = 2000;

function text(value: JSONValue | undefined | null): string {
  if (value === null || value === undefined || typeof value === "object") {
    return "";
  }

  return String(value).trim();
}

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

// The ids collected for one record: each once, in order, at most the cap.
class ResourceIds {
  private readonly ids: Array<string> = [];
  private readonly seen: Set<string> = new Set<string>();

  public add(id: string | null | undefined): void {
    const value: string = (id || "").trim();

    if (
      !value ||
      value.length > MAX_RESOURCE_ID_LENGTH ||
      this.ids.length >= MAX_CLOUD_AUDIT_RESOURCE_IDS ||
      !isCloudResourceIdLike(value) ||
      this.seen.has(value)
    ) {
      return;
    }

    this.seen.add(value);
    this.ids.push(value);
  }

  public isFull(): boolean {
    return this.ids.length >= MAX_CLOUD_AUDIT_RESOURCE_IDS;
  }

  public toArray(): Array<string> {
    return [...this.ids];
  }
}

// ---------- AWS: CloudTrail ----------

// Where a record was written: the account and Region a name is completed with.
export interface CloudTrailPlace {
  accountId: string;
  region: string;
}

/*
 * A field of a call's parameters, or of what AWS answered, that names one
 * of the catalog's resources by its name or id - and the CloudWatch
 * namespace and identity dimension the catalog builds that resource's ARN
 * from.
 */
export interface CloudTrailResourceField {
  // The service whose calls hold it, as CloudTrail's eventSource says.
  eventSource: string;
  // The field's name, at any depth of the parameters, in any case.
  field: string;
  namespace: string;
  dimension: string;
  // The catalog's type of the resource it names.
  type: string;
  // Only on the calls whose name holds this: CloudFront's "id" is a distribution's on its distribution calls.
  eventNameIncludes?: string | undefined;
  // The value as the ARN writes it: RDS, ElastiCache and Redshift keep their identifiers in lower case.
  isLowerCase?: boolean | undefined;
  /*
   * Other dimensions the ARN is built from, the field of the same
   * parameters each is read from, and whether the ARN needs it: an ECS
   * service's cluster (no ARN without it), an EventBridge rule's event bus
   * (the default bus without it). A value that is an ARN gives its last
   * part.
   */
  companions?:
    | Readonly<Record<string, { field: string; isRequired: boolean }>>
    | undefined;
  // Dimensions the catalog's rule wants as they are: a Glue job's own series is its JobRunId ALL.
  fixedDimensions?: Readonly<Record<string, string>> | undefined;
  /*
   * Whether a value is this resource's id at all, where the field holds
   * other things too: a KMS key's id, never its alias; a CloudFront
   * distribution's id, never an origin's.
   */
  accepts?: ((value: string) => boolean) | undefined;
}

// A KMS key's own id: a UUID, or a multi-Region key's mrk- and 32 hex digits.
export function isKmsKeyId(value: string): boolean {
  if (value.startsWith("mrk-")) {
    return value.length === 36 && isLowerHex(value.slice(4));
  }

  if (value.length !== 36) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const isDash: boolean = value.charCodeAt(index) === 45;
    const shouldBeDash: boolean =
      index === 8 || index === 13 || index === 18 || index === 23;

    if (isDash !== shouldBeDash) {
      return false;
    }
  }

  return isLowerHex(value.split("-").join(""));
}

// A CloudFront distribution's id: E and 12 to 13 capital letters and digits.
export function isCloudFrontDistributionId(value: string): boolean {
  if (!value.startsWith("E") || value.length < 13 || value.length > 14) {
    return false;
  }

  for (let index: number = 1; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (!((code >= 48 && code <= 57) || (code >= 65 && code <= 90))) {
      return false;
    }
  }

  return true;
}

/*
 * The names and ids CloudTrail records for the resources OneUptime's cloud
 * catalog lists. A resource whose calls always carry its ARN - an SNS
 * topic, an ELBv2 load balancer, a Step Functions state machine, a
 * certificate, an accelerator, an App Runner service, an MSK cluster - is
 * read from that ARN (readCloudTrailArns), and needs no field here.
 */
export const CLOUDTRAIL_RESOURCE_FIELDS: ReadonlyArray<CloudTrailResourceField> =
  [
    {
      eventSource: "s3.amazonaws.com",
      field: "bucketName",
      namespace: "AWS/S3",
      dimension: "BucketName",
      type: "AWS::S3::Bucket",
    },
    {
      eventSource: "rds.amazonaws.com",
      field: "dBInstanceIdentifier",
      namespace: "AWS/RDS",
      dimension: "DBInstanceIdentifier",
      type: "AWS::RDS::DBInstance",
      isLowerCase: true,
    },
    {
      eventSource: "rds.amazonaws.com",
      field: "dBClusterIdentifier",
      namespace: "AWS/RDS",
      dimension: "DBClusterIdentifier",
      type: "AWS::RDS::DBCluster",
      isLowerCase: true,
    },
    {
      eventSource: "dynamodb.amazonaws.com",
      field: "tableName",
      namespace: "AWS/DynamoDB",
      dimension: "TableName",
      type: "AWS::DynamoDB::Table",
    },
    {
      eventSource: "sqs.amazonaws.com",
      field: "queueName",
      namespace: "AWS/SQS",
      dimension: "QueueName",
      type: "AWS::SQS::Queue",
    },
    {
      eventSource: "elasticloadbalancing.amazonaws.com",
      field: "loadBalancerName",
      namespace: "AWS/ELB",
      dimension: "LoadBalancerName",
      type: "AWS::ElasticLoadBalancing::LoadBalancer",
    },
    {
      eventSource: "kinesis.amazonaws.com",
      field: "streamName",
      namespace: "AWS/Kinesis",
      dimension: "StreamName",
      type: "AWS::Kinesis::Stream",
    },
    {
      eventSource: "firehose.amazonaws.com",
      field: "deliveryStreamName",
      namespace: "AWS/Firehose",
      dimension: "DeliveryStreamName",
      type: "AWS::KinesisFirehose::DeliveryStream",
    },
    {
      eventSource: "elasticache.amazonaws.com",
      field: "cacheClusterId",
      namespace: "AWS/ElastiCache",
      dimension: "CacheClusterId",
      type: "AWS::ElastiCache::CacheCluster",
      isLowerCase: true,
    },
    {
      eventSource: "elasticache.amazonaws.com",
      field: "replicationGroupId",
      namespace: "AWS/ElastiCache",
      dimension: "ReplicationGroupId",
      type: "AWS::ElastiCache::ReplicationGroup",
      isLowerCase: true,
    },
    {
      eventSource: "elasticache.amazonaws.com",
      field: "serverlessCacheName",
      namespace: "AWS/ElastiCache",
      dimension: "clusterId",
      type: "AWS::ElastiCache::ServerlessCache",
      isLowerCase: true,
    },
    {
      eventSource: "memorydb.amazonaws.com",
      field: "clusterName",
      namespace: "AWS/MemoryDB",
      dimension: "ClusterName",
      type: "AWS::MemoryDB::Cluster",
    },
    {
      eventSource: "redshift.amazonaws.com",
      field: "clusterIdentifier",
      namespace: "AWS/Redshift",
      dimension: "ClusterIdentifier",
      type: "AWS::Redshift::Cluster",
      isLowerCase: true,
    },
    {
      eventSource: "es.amazonaws.com",
      field: "domainName",
      namespace: "AWS/ES",
      dimension: "DomainName",
      type: "AWS::OpenSearchService::Domain",
    },
    {
      eventSource: "ecs.amazonaws.com",
      field: "cluster",
      namespace: "AWS/ECS",
      dimension: "ClusterName",
      type: "AWS::ECS::Cluster",
    },
    {
      eventSource: "ecs.amazonaws.com",
      field: "clusterName",
      namespace: "AWS/ECS",
      dimension: "ClusterName",
      type: "AWS::ECS::Cluster",
    },
    {
      eventSource: "ecs.amazonaws.com",
      field: "service",
      namespace: "AWS/ECS",
      dimension: "ServiceName",
      type: "AWS::ECS::Service",
      companions: { ClusterName: { field: "cluster", isRequired: true } },
    },
    {
      eventSource: "cloudfront.amazonaws.com",
      field: "distributionId",
      namespace: "AWS/CloudFront",
      dimension: "DistributionId",
      type: "AWS::CloudFront::Distribution",
      accepts: isCloudFrontDistributionId,
    },
    {
      eventSource: "cloudfront.amazonaws.com",
      field: "id",
      namespace: "AWS/CloudFront",
      dimension: "DistributionId",
      type: "AWS::CloudFront::Distribution",
      eventNameIncludes: "Distribution",
      accepts: isCloudFrontDistributionId,
    },
    {
      eventSource: "elasticfilesystem.amazonaws.com",
      field: "fileSystemId",
      namespace: "AWS/EFS",
      dimension: "FileSystemId",
      type: "AWS::EFS::FileSystem",
    },
    {
      eventSource: "fsx.amazonaws.com",
      field: "fileSystemId",
      namespace: "AWS/FSx",
      dimension: "FileSystemId",
      type: "AWS::FSx::FileSystem",
    },
    {
      eventSource: "route53.amazonaws.com",
      field: "healthCheckId",
      namespace: "AWS/Route53",
      dimension: "HealthCheckId",
      type: "AWS::Route53::HealthCheck",
    },
    {
      eventSource: "network-firewall.amazonaws.com",
      field: "firewallName",
      namespace: "AWS/NetworkFirewall",
      dimension: "FirewallName",
      type: "AWS::NetworkFirewall::Firewall",
    },
    {
      eventSource: "glue.amazonaws.com",
      field: "jobName",
      namespace: "Glue",
      dimension: "JobName",
      type: "AWS::Glue::Job",
      fixedDimensions: { JobRunId: "ALL" },
    },
    {
      eventSource: "athena.amazonaws.com",
      field: "workGroup",
      namespace: "AWS/Athena",
      dimension: "WorkGroup",
      type: "AWS::Athena::WorkGroup",
    },
    {
      eventSource: "apigateway.amazonaws.com",
      field: "apiId",
      namespace: "AWS/ApiGateway",
      dimension: "ApiId",
      type: "AWS::ApiGatewayV2::Api",
    },
    {
      eventSource: "appsync.amazonaws.com",
      field: "apiId",
      namespace: "AWS/AppSync",
      dimension: "GraphQLAPIId",
      type: "AWS::AppSync::GraphQLApi",
    },
    {
      eventSource: "kms.amazonaws.com",
      field: "keyId",
      namespace: "AWS/KMS",
      dimension: "KeyId",
      type: "AWS::KMS::Key",
      accepts: isKmsKeyId,
    },
    {
      eventSource: "cognito-idp.amazonaws.com",
      field: "userPoolId",
      namespace: "AWS/Cognito",
      dimension: "UserPool",
      type: "AWS::Cognito::UserPool",
    },
    {
      eventSource: "sagemaker.amazonaws.com",
      field: "endpointName",
      namespace: "AWS/SageMaker",
      dimension: "EndpointName",
      type: "AWS::SageMaker::Endpoint",
    },
    {
      eventSource: "events.amazonaws.com",
      field: "name",
      namespace: "AWS/Events",
      dimension: "RuleName",
      type: "AWS::Events::Rule",
      eventNameIncludes: "Rule",
      companions: {
        EventBusName: { field: "eventBusName", isRequired: false },
      },
    },
    {
      eventSource: "events.amazonaws.com",
      field: "rule",
      namespace: "AWS/Events",
      dimension: "RuleName",
      type: "AWS::Events::Rule",
      companions: {
        EventBusName: { field: "eventBusName", isRequired: false },
      },
    },
    {
      eventSource: "logs.amazonaws.com",
      field: "logGroupName",
      namespace: "AWS/Logs",
      dimension: "LogGroupName",
      type: "AWS::Logs::LogGroup",
    },
    {
      eventSource: "directconnect.amazonaws.com",
      field: "connectionId",
      namespace: "AWS/DX",
      dimension: "ConnectionId",
      type: "AWS::DirectConnect::Connection",
    },
  ];

/*
 * The ARN of a resource the AWS inventory lists without metrics - a VPC, a
 * subnet, a security group, an EKS cluster - built as the inventory builds
 * it (AwsInventoryCatalog), in the record's account and Region. Null when
 * either is not known.
 */
export function buildInventoryAwsArn(data: {
  service: string;
  resource: string;
  place: CloudTrailPlace;
}): string | null {
  const region: string = data.place.region;
  const accountId: string = data.place.accountId;

  if (!isAwsRegion(region) || accountId.length !== 12 || !isDigits(accountId)) {
    return null;
  }

  return `arn:${getAwsPartitionForRegion(region)}:${data.service}:${region}:${accountId}:${data.resource}`;
}

// A resource an EC2 id names: its type, and how its ARN is built.
export interface Ec2ResourceIdKind {
  prefix: string;
  type: string;
  arn: (id: string, place: CloudTrailPlace) => string | null;
}

function catalogEc2Kind(data: {
  prefix: string;
  namespace: string;
  dimension: string;
  type: string;
}): Ec2ResourceIdKind {
  return {
    prefix: data.prefix,
    type: data.type,
    arn: (id: string, place: CloudTrailPlace): string | null => {
      return buildCatalogAwsArn({
        namespace: data.namespace,
        dimensions: { [data.dimension]: id },
        place,
        type: data.type,
      });
    },
  };
}

function inventoryEc2Kind(data: {
  prefix: string;
  type: string;
  // What the ARN's resource part says before the id: "security-group".
  resource: string;
}): Ec2ResourceIdKind {
  return {
    prefix: data.prefix,
    type: data.type,
    arn: (id: string, place: CloudTrailPlace): string | null => {
      return buildInventoryAwsArn({
        service: "ec2",
        resource: `${data.resource}/${id}`,
        place,
      });
    },
  };
}

/*
 * The EC2 ids a record names, in any service's call - an instance a
 * Systems Manager command ran on is named by its id there too, and a
 * security group an RDS database was moved into by its id: the id's
 * prefix says what it is, and its ARN is built as its Cloud Resource's
 * was, by the cloud catalog or the inventory.
 */
export const EC2_RESOURCE_ID_KINDS: ReadonlyArray<Ec2ResourceIdKind> = [
  catalogEc2Kind({
    prefix: "i-",
    namespace: "AWS/EC2",
    dimension: "InstanceId",
    type: "AWS::EC2::Instance",
  }),
  catalogEc2Kind({
    prefix: "vol-",
    namespace: "AWS/EBS",
    dimension: "VolumeId",
    type: "AWS::EC2::Volume",
  }),
  catalogEc2Kind({
    prefix: "nat-",
    namespace: "AWS/NATGateway",
    dimension: "NatGatewayId",
    type: "AWS::EC2::NatGateway",
  }),
  catalogEc2Kind({
    prefix: "tgw-",
    namespace: "AWS/TransitGateway",
    dimension: "TransitGateway",
    type: "AWS::EC2::TransitGateway",
  }),
  catalogEc2Kind({
    prefix: "vpn-",
    namespace: "AWS/VPN",
    dimension: "VpnId",
    type: "AWS::EC2::VPNConnection",
  }),
  inventoryEc2Kind({
    prefix: "sg-",
    type: "AWS::EC2::SecurityGroup",
    resource: "security-group",
  }),
  inventoryEc2Kind({ prefix: "vpc-", type: "AWS::EC2::VPC", resource: "vpc" }),
  inventoryEc2Kind({
    prefix: "subnet-",
    type: "AWS::EC2::Subnet",
    resource: "subnet",
  }),
];

/*
 * The EKS cluster a call names (#9375 lists them): by `name` on the
 * cluster's own calls - UpdateClusterConfig opening its API to the
 * internet - and by `clusterName` on everything inside it - an access
 * entry, a node group, an identity provider.
 */
export const CLOUDTRAIL_EKS_CLUSTER_FIELDS: ReadonlyArray<{
  field: string;
  eventNameIncludes?: string | undefined;
}> = [
  { field: "name", eventNameIncludes: "Cluster" },
  { field: "clusterName" },
];

// An EKS cluster's name: 1 to 100 letters, digits, hyphens and underscores, a letter or digit first.
function isEksClusterName(value: string): boolean {
  if (value.length < 1 || value.length > 100) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);
    const isLetterOrDigit: boolean =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122);

    if (!isLetterOrDigit && (index === 0 || (code !== 45 && code !== 95))) {
      return false;
    }
  }

  return true;
}

function isLowerHex(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) {
      return false;
    }
  }

  return true;
}

/*
 * Whether a value is an EC2 id with this prefix: the prefix, then 8 or 17
 * lowercase hex digits, and nothing else - "tgw-attach-..." is an
 * attachment, not a transit gateway.
 */
export function isEc2ResourceId(value: string, prefix: string): boolean {
  if (!value.startsWith(prefix)) {
    return false;
  }

  const rest: string = value.slice(prefix.length);

  return (rest.length === 8 || rest.length === 17) && isLowerHex(rest);
}

/*
 * The ARN the cloud catalog builds for a resource of this namespace and
 * these dimensions, in this account and Region - the one its Cloud
 * Resource keeps - or null when the catalog builds none (a resource whose
 * ARN carries an id no call names) or it is not of the type expected.
 */
export function buildCatalogAwsArn(data: {
  namespace: string;
  dimensions: Readonly<Record<string, string>>;
  place: CloudTrailPlace;
  type: string;
}): string | null {
  const attributes: Record<string, string> = {
    [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: data.namespace,
  };

  if (data.place.accountId) {
    attributes[CLOUD_ACCOUNT_ID_ATTRIBUTE] = data.place.accountId;
  }

  if (data.place.region) {
    attributes[CLOUD_REGION_ATTRIBUTE] = data.place.region;
  }

  for (const name of Object.keys(data.dimensions)) {
    const value: string = (data.dimensions[name] || "").trim();

    if (!value) {
      return null;
    }

    attributes[`${AWS_CLOUDWATCH_DIMENSION_PREFIX}${name}`] = value;
  }

  const resource: CloudMonitoredResource | null = resolveCloudMonitoredResource(
    {
      metricName: `${AWS_CLOUDWATCH_METRIC_NAME_PREFIX}${data.namespace}/CloudTrail`,
      attributes,
    },
  );

  if (
    !resource ||
    resource.resourceType !== data.type ||
    !isCloudProviderOwnResourceId(
      CloudProvider.AWS,
      resource.providerResourceId,
    )
  ) {
    return null;
  }

  return resource.providerResourceId;
}

// The ARN's parts: arn, partition, service, region, account and the resource, which may hold colons.
function splitArn(arn: string): Array<string> | null {
  const parts: Array<string> = [];
  let start: number = 0;

  for (let index: number = 0; index < arn.length && parts.length < 5; index++) {
    if (arn.charCodeAt(index) === 58) {
      parts.push(arn.slice(start, index));
      start = index + 1;
    }
  }

  if (parts.length < 5 || parts[0] !== "arn") {
    return null;
  }

  parts.push(arn.slice(start));

  return parts[5] ? parts : null;
}

function joinArn(parts: Array<string>, resource: string): string {
  return `${parts.slice(0, 5).join(":")}:${resource}`;
}

// The resource part cut at the first `separator` after `from`, or as it is.
function cutAt(value: string, separator: string, from: number = 0): string {
  const at: number = value.indexOf(separator, from);

  return at === -1 ? value : value.slice(0, at);
}

/*
 * An ARN a record names, as the resource OneUptime keeps it: a part of a
 * resource as the resource itself (an S3 object as its bucket, a Lambda
 * version as its function, a DynamoDB index or stream as its table, a
 * Kinesis consumer as its stream, an SNS subscription as its topic, a
 * load balancer's listener or rule as the load balancer, a log group's
 * stream as the log group), any other ARN as it is. Null for an ARN that
 * names no resource - a signed-in session (sts) - or is no ARN.
 */
export function normalizeAwsArn(value: string): string | null {
  const arn: string = value.trim();

  if (!isCloudResourceIdLike(arn) || !arn.toLowerCase().startsWith("arn:")) {
    return null;
  }

  const parts: Array<string> | null = splitArn(arn);

  if (!parts) {
    return null;
  }

  const service: string = parts[2] || "";
  const resource: string = parts[5] || "";

  switch (service) {
    case "sts":
      return null;
    case "s3": {
      // An object, or a bucket's own path: the bucket. An access point keeps its Region.
      if (parts[3] || parts[4]) {
        return arn;
      }

      const bucket: string = cutAt(resource, "/");

      return bucket ? joinArn(parts, bucket) : null;
    }
    case "lambda": {
      // function:<name>[:<version or alias>]
      if (resource.startsWith("function:")) {
        return joinArn(parts, cutAt(resource, ":", "function:".length));
      }

      return arn;
    }
    case "dynamodb": {
      // table/<name>[/index/... | /stream/... | /backup/... | /export/...]
      if (resource.startsWith("table/")) {
        return joinArn(parts, cutAt(resource, "/", "table/".length));
      }

      return arn;
    }
    case "kinesis": {
      if (resource.startsWith("stream/")) {
        return joinArn(parts, cutAt(resource, "/", "stream/".length));
      }

      return arn;
    }
    case "sns": {
      // <topic>[:<subscription id>]
      return joinArn(parts, cutAt(resource, ":"));
    }
    case "logs": {
      // log-group:<name>[:*][:log-stream:<name>]
      if (resource.startsWith("log-group:")) {
        return joinArn(parts, cutAt(resource, ":", "log-group:".length));
      }

      return arn;
    }
    case "elasticloadbalancing": {
      // listener/<type>/<name>/<id>/<listener id>, listener-rule/.../<rule id>
      for (const child of ["listener/", "listener-rule/"]) {
        if (resource.startsWith(child)) {
          const pieces: Array<string> = resource.slice(child.length).split("/");

          return pieces.length >= 3 && pieces[0] && pieces[1] && pieces[2]
            ? joinArn(
                parts,
                `loadbalancer/${pieces[0]}/${pieces[1]}/${pieces[2]}`,
              )
            : null;
        }
      }

      return arn;
    }
    default:
      return arn;
  }
}

/*
 * A Lambda function's name, from what a call gives in `functionName`: the
 * name, the name with a version or alias, the partial ARN
 * (<account>:function:<name>) or the full ARN. With the account the partial
 * ARN names, when it names one. Null for anything that is not a function's
 * name: 1 to 64 letters, digits, hyphens and underscores.
 */
export function readLambdaFunctionName(
  value: string,
): { name: string; accountId: string } | null {
  let rest: string = value.trim();
  let accountId: string = "";

  if (rest.startsWith("arn:")) {
    return null;
  }

  const marker: string = ":function:";
  const at: number = rest.indexOf(marker);

  if (at !== -1) {
    accountId = rest.slice(0, at);
    rest = rest.slice(at + marker.length);

    if (accountId.length !== 12 || !isDigits(accountId)) {
      return null;
    }
  }

  const name: string = cutAt(rest, ":");

  if (name.length < 1 || name.length > 64) {
    return null;
  }

  for (let index: number = 0; index < name.length; index++) {
    const code: number = name.charCodeAt(index);
    const isAllowed: boolean =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 45 ||
      code === 95;

    if (!isAllowed) {
      return null;
    }
  }

  return { name, accountId };
}

function isDigits(value: string): boolean {
  if (!value) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

/*
 * An SQS queue's URL as its name, account and Region:
 * https://sqs.<region>.amazonaws.com/<account>/<name>, the legacy
 * https://<region>.queue.amazonaws.com/... and https://queue.amazonaws.com/...
 * (us-east-1). Null for anything else.
 */
export function readSqsQueueUrl(
  value: string,
): { name: string; accountId: string; region: string } | null {
  const url: string = value.trim();
  const scheme: string = "https://";

  if (!url.toLowerCase().startsWith(scheme) || url.length > 512) {
    return null;
  }

  const rest: string = url.slice(scheme.length);
  const slash: number = rest.indexOf("/");

  if (slash === -1) {
    return null;
  }

  const host: string = rest.slice(0, slash).toLowerCase();
  const path: Array<string> = rest
    .slice(slash + 1)
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });

  if (path.length !== 2 || !isDigits(path[0]!) || path[0]!.length !== 12) {
    return null;
  }

  let region: string = "";

  if (host.startsWith("sqs.")) {
    region = cutAt(host.slice("sqs.".length), ".");
  } else if (host === "queue.amazonaws.com") {
    region = "us-east-1";
  } else if (host.endsWith(".queue.amazonaws.com")) {
    region = host.slice(0, host.length - ".queue.amazonaws.com".length);
  } else {
    return null;
  }

  return region ? { name: path[1]!, accountId: path[0]!, region } : null;
}

// A value that may be an ARN: its last part, else the value.
function arnTail(value: string): string {
  if (!value.startsWith("arn:")) {
    return value;
  }

  const slash: number = value.lastIndexOf("/");
  const colon: number = value.lastIndexOf(":");
  const cut: number = Math.max(slash, colon);

  return cut >= 0 ? value.slice(cut + 1) : value;
}

interface WalkedValue {
  // The name of the field that holds it: for an item of a list, the list's.
  field: string;
  value: string;
}

/*
 * Every text value of a record's parameters, with the field it is in,
 * nearest first: at most MAX_WALK_VALUES of them, at most MAX_WALK_DEPTH
 * deep, and no more than MAX_WALK_NODES looked at in all, however the
 * record nests.
 */
function walkValues(root: JSONValue | undefined): Array<WalkedValue> {
  const values: Array<WalkedValue> = [];
  const queue: Array<{ value: JSONValue; field: string; depth: number }> = [];

  if (root !== undefined && root !== null) {
    queue.push({ value: root, field: "", depth: 0 });
  }

  for (
    let next: number = 0;
    next < queue.length && values.length < MAX_WALK_VALUES;
    next++
  ) {
    const { value, field, depth } = queue[next]!;

    if (typeof value === "string") {
      values.push({ field, value });
      continue;
    }

    if (!value || typeof value !== "object" || depth >= MAX_WALK_DEPTH) {
      continue;
    }

    const children: Array<{ value: JSONValue; field: string }> = Array.isArray(
      value,
    )
      ? value
          .slice(0, MAX_WALK_NODES)
          .map((item: JSONValue): { value: JSONValue; field: string } => {
            return { value: item, field };
          })
      : Object.keys(value)
          .slice(0, MAX_WALK_NODES)
          .map((key: string): { value: JSONValue; field: string } => {
            return {
              value: (value as JSONObject)[key] as JSONValue,
              field: key,
            };
          });

    for (const child of children) {
      if (queue.length >= MAX_WALK_NODES) {
        break;
      }

      queue.push({ ...child, depth: depth + 1 });
    }
  }

  return values;
}

// A field's value among a record's walked values: the first, of any case of its name.
function companionValue(
  values: Array<WalkedValue>,
  field: string,
): string | undefined {
  const lower: string = field.toLowerCase();

  for (const walked of values) {
    if (walked.field.toLowerCase() === lower && walked.value.trim()) {
      return arnTail(walked.value.trim());
    }
  }

  return undefined;
}

/*
 * The resources one walked value names, as ARNs: an ARN as the resource it
 * is of, an EC2 id by its prefix, and a field of the table by its name.
 */
function readValueArns(data: {
  walked: WalkedValue;
  all: Array<WalkedValue>;
  eventSource: string;
  eventName: string;
  place: CloudTrailPlace;
}): Array<string> {
  const value: string = data.walked.value.trim();

  if (!value || value.length > MAX_RESOURCE_ID_LENGTH) {
    return [];
  }

  if (value.startsWith("arn:")) {
    const arn: string | null = normalizeAwsArn(value);

    return arn ? [arn] : [];
  }

  const arns: Array<string> = [];

  for (const ec2 of EC2_RESOURCE_ID_KINDS) {
    if (isEc2ResourceId(value, ec2.prefix)) {
      const arn: string | null = ec2.arn(value, data.place);

      if (arn) {
        arns.push(arn);
      }
    }
  }

  const field: string = data.walked.field.toLowerCase();

  if (data.eventSource === "eks.amazonaws.com" && isEksClusterName(value)) {
    for (const eks of CLOUDTRAIL_EKS_CLUSTER_FIELDS) {
      if (
        eks.field.toLowerCase() === field &&
        (!eks.eventNameIncludes ||
          data.eventName.indexOf(eks.eventNameIncludes) !== -1)
      ) {
        const arn: string | null = buildInventoryAwsArn({
          service: "eks",
          resource: `cluster/${value}`,
          place: data.place,
        });

        if (arn) {
          arns.push(arn);
        }
      }
    }
  }

  if (data.eventSource === "lambda.amazonaws.com" && field === "functionname") {
    const named: { name: string; accountId: string } | null =
      readLambdaFunctionName(value);
    const arn: string | null = named
      ? buildCatalogAwsArn({
          namespace: "AWS/Lambda",
          dimensions: { FunctionName: named.name },
          place: {
            accountId: named.accountId || data.place.accountId,
            region: data.place.region,
          },
          type: "AWS::Lambda::Function",
        })
      : null;

    if (arn) {
      arns.push(arn);
    }
  }

  if (data.eventSource === "sqs.amazonaws.com" && field === "queueurl") {
    const queue: { name: string; accountId: string; region: string } | null =
      readSqsQueueUrl(value);
    const arn: string | null = queue
      ? buildCatalogAwsArn({
          namespace: "AWS/SQS",
          dimensions: { QueueName: queue.name },
          place: { accountId: queue.accountId, region: queue.region },
          type: "AWS::SQS::Queue",
        })
      : null;

    if (arn) {
      arns.push(arn);
    }
  }

  for (const entry of CLOUDTRAIL_RESOURCE_FIELDS) {
    if (
      entry.eventSource !== data.eventSource ||
      entry.field.toLowerCase() !== field ||
      (entry.eventNameIncludes &&
        data.eventName.indexOf(entry.eventNameIncludes) === -1) ||
      (entry.accepts && !entry.accepts(value))
    ) {
      continue;
    }

    const dimensions: Record<string, string> = {
      ...(entry.fixedDimensions || {}),
      [entry.dimension]: entry.isLowerCase ? value.toLowerCase() : value,
    };
    let isComplete: boolean = true;

    for (const [dimension, companion] of Object.entries(
      entry.companions || {},
    )) {
      const companionText: string | undefined = companionValue(
        data.all,
        companion.field,
      );

      if (companionText) {
        dimensions[dimension] = companionText;
      } else if (companion.isRequired) {
        isComplete = false;
      }
    }

    const arn: string | null = isComplete
      ? buildCatalogAwsArn({
          namespace: entry.namespace,
          dimensions,
          place: data.place,
          type: entry.type,
        })
      : null;

    if (arn) {
      arns.push(arn);
    }
  }

  return arns;
}

/*
 * The cloud resources a CloudTrail record is about, as ARNs: the ones it
 * lists in `resources`, then the ones its call names - by ARN, by EC2 id,
 * by a name or an id the cloud catalog knows - then the ones in what AWS
 * answered. Each in the account the call was received in
 * (recipientAccountId) and its Region.
 */
export function readCloudTrailResourceIds(record: JSONObject): Array<string> {
  const ids: ResourceIds = new ResourceIds();
  const eventSource: string = text(record["eventSource"]).toLowerCase();
  const eventName: string = text(record["eventName"]);
  const userIdentity: JSONObject | null = asObject(record["userIdentity"]);
  const place: CloudTrailPlace = {
    accountId:
      text(record["recipientAccountId"]) ||
      text(userIdentity ? userIdentity["accountId"] : undefined),
    region: text(record["awsRegion"]).toLowerCase(),
  };

  const resources: JSONValue | undefined = record["resources"];

  if (Array.isArray(resources)) {
    for (const item of resources.slice(0, MAX_WALK_VALUES)) {
      const resource: JSONObject | null = asObject(item);
      const arn: string = resource
        ? text(resource["ARN"]) || text(resource["arn"])
        : "";

      ids.add(arn ? normalizeAwsArn(arn) : null);
    }
  }

  for (const part of ["requestParameters", "responseElements"]) {
    if (ids.isFull()) {
      break;
    }

    const walked: Array<WalkedValue> = walkValues(record[part]);

    for (const value of walked) {
      if (ids.isFull()) {
        break;
      }

      for (const arn of readValueArns({
        walked: value,
        all: walked,
        eventSource,
        eventName,
        place,
      })) {
        ids.add(arn);
      }
    }
  }

  return ids.toArray();
}

// ---------- Azure: the Activity Log ----------

/*
 * An Azure resource ID as OneUptime compares it: trimmed, without a
 * trailing slash, in lower case - Azure's resource IDs are
 * case-insensitive, and the Activity Log's export writes them in capitals.
 * Null for anything that is not a resource ID under a subscription.
 */
export function normalizeAzureResourceId(value: string): string | null {
  let id: string = value.trim();

  while (id.endsWith("/")) {
    id = id.slice(0, -1);
  }

  const lower: string = id.toLowerCase();

  return lower.startsWith("/subscriptions/") && isCloudResourceIdLike(lower)
    ? lower
    : null;
}

/*
 * The resource an Azure resource ID is a part of, or an extension of: the
 * first type and name after its first provider - a storage account for its
 * blob container, a SQL server for its database, a Key Vault for a role
 * assigned on it. Null when the ID is that resource itself, or names none
 * (a subscription, a resource group).
 */
export function getAzureTopLevelResourceId(id: string): string | null {
  // ["", "subscriptions", <id>, ("resourceGroups", <name>,) "providers", ...]
  const segments: Array<string> = id.split("/");
  const providers: number =
    (segments[3] || "").toLowerCase() === "resourcegroups" ? 5 : 3;

  // providers/<namespace>/<type>/<name>
  if (
    (segments[providers] || "").toLowerCase() !== "providers" ||
    !segments[providers + 1] ||
    !segments[providers + 2] ||
    !segments[providers + 3]
  ) {
    return null;
  }

  const top: string = segments.slice(0, providers + 4).join("/");

  return top.length < id.length ? top : null;
}

/*
 * The cloud resources an Activity Log record is about, as Azure resource
 * IDs in lower case: its resourceId, the resource that is a part of, and -
 * for a Defender for Cloud alert - the resource it was raised on, when the
 * alert names it by its ID.
 */
export function readAzureActivityResourceIds(
  record: JSONObject,
): Array<string> {
  const ids: ResourceIds = new ResourceIds();
  const properties: JSONObject | null = asObject(record["properties"]);
  const candidates: Array<string> = [
    text(record["resourceId"]),
    ...(properties
      ? [
          text(properties["resourceId"]),
          text(properties["ResourceId"]),
          text(properties["compromisedEntity"]),
        ]
      : []),
  ];

  for (const candidate of candidates) {
    const id: string | null = candidate
      ? normalizeAzureResourceId(candidate)
      : null;

    if (id) {
      ids.add(id);
      ids.add(getAzureTopLevelResourceId(id));
    }
  }

  return ids.toArray();
}

// ---------- Google Cloud: the audit logs ----------

// Whether a value is an API's service name: letters, digits, dots and hyphens, ending in .googleapis.com.
export function isGoogleApiServiceName(value: string): boolean {
  if (
    !value.endsWith(".googleapis.com") ||
    value.length <= ".googleapis.com".length ||
    value.length > 253
  ) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);
    const isAllowed: boolean =
      (code >= 48 && code <= 57) ||
      (code >= 97 && code <= 122) ||
      code === 45 ||
      code === 46;

    if (!isAllowed) {
      return false;
    }
  }

  return true;
}

/*
 * A resource name as the API's full resource name would write it, from
 * what the audit entry also says of the resource:
 *
 *   - the project by its id, where the API wrote its number
 *     ("projects/123456789012/secrets/x") and the entry's resource names the
 *     project's id;
 *   - a GKE cluster under its location, as Cloud Asset Inventory names it,
 *     where the older API wrote its zone;
 *   - a Cloud Run service by its project and location, where the Knative
 *     API wrote its namespace ("namespaces/<project>/services/<name>").
 *
 * Null for a name that is no single resource's: a project of "-" stands
 * for any project.
 */
export function normalizeGoogleResourceName(data: {
  serviceName: string;
  resourceName: string;
  labels: Readonly<Record<string, string>>;
}): string | null {
  const segments: Array<string> = data.resourceName
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });

  if (segments.length < 2) {
    return null;
  }

  const projectId: string = data.labels["project_id"] || "";

  if (segments[1] === "-") {
    return null;
  }

  // The project by its id, where the API wrote its number.
  if (
    (segments[0] === "projects" || segments[0] === "namespaces") &&
    isDigits(segments[1]!) &&
    projectId &&
    !isDigits(projectId)
  ) {
    segments[1] = projectId;
  }

  if (
    segments[0] === "projects" &&
    data.serviceName === "container.googleapis.com" &&
    segments[2] === "zones"
  ) {
    segments[2] = "locations";
  }

  // Knative's namespace is the project: no other API writes one.
  if (segments[0] === "namespaces") {
    const location: string = data.labels["location"] || "";

    if (data.serviceName !== "run.googleapis.com" || !location) {
      return null;
    }

    return [
      "projects",
      segments[1],
      "locations",
      location,
      ...segments.slice(2),
    ].join("/");
  }

  return segments.join("/");
}

const GOOGLE_LOCATION_COLLECTIONS: ReadonlyArray<string> = [
  "locations",
  "zones",
  "regions",
];

/*
 * The resource a Google Cloud resource name is a part of: its project (or
 * App Engine app), its location, and the first collection and id after
 * them - a BigQuery table's dataset, a Spanner database's instance, a Cloud
 * Storage object's bucket, an App Engine version's service. Null when the
 * name is that resource itself, or names none (a project).
 */
export function getGoogleTopLevelResourceName(name: string): string | null {
  const segments: Array<string> = name.split("/");

  if ((segments[0] !== "projects" && segments[0] !== "apps") || !segments[1]) {
    return null;
  }

  let index: number = 2;

  if (
    GOOGLE_LOCATION_COLLECTIONS.includes(segments[index] || "") &&
    segments[index + 1]
  ) {
    index += 2;
  } else if (segments[index] === "global") {
    index += 1;
  }

  if (!segments[index] || !segments[index + 1]) {
    return null;
  }

  const top: string = segments.slice(0, index + 2).join("/");

  return top.length < name.length ? top : null;
}

// A LogEntry's monitored resource labels, as text, each key the label's own.
function readLabels(value: JSONValue | undefined): Record<string, string> {
  const labels: Record<string, string> = {};
  const object: JSONObject | null = asObject(value);

  if (!object) {
    return labels;
  }

  for (const key of Object.keys(object).slice(0, 50)) {
    const item: string = text(object[key] as JSONValue);

    if (item && key.length <= 256) {
      writeOwnValue(labels, key, item);
    }
  }

  return labels;
}

/*
 * The full resource name the cloud catalog gives the monitored resource an
 * entry is filed under - the one its Cloud Resource and its streamed logs
 * carry - or null for a type the catalog has no full name for.
 */
export function getGoogleMonitoredResourceName(data: {
  type: string;
  labels: Readonly<Record<string, string>>;
}): string | null {
  if (!data.type) {
    return null;
  }

  const attributes: Record<string, string> = {
    [GCP_RESOURCE_TYPE_ATTRIBUTE]: data.type,
  };

  for (const key of Object.keys(data.labels)) {
    attributes[`resource.${key}`] = data.labels[key]!;
  }

  const resource: CloudMonitoredResource | null = resolveCloudMonitoredResource(
    {
      metricName: `logging.googleapis.com/${data.type}`,
      attributes,
    },
  );

  return resource &&
    isCloudProviderOwnResourceId(CloudProvider.GCP, resource.providerResourceId)
    ? resource.providerResourceId
    : null;
}

/*
 * The cloud resources a Google Cloud audit entry is about, as full
 * resource names: its resourceName under its API's service
 * (//<service>/<name>), the resource that is a part of, and the monitored
 * resource the entry is filed under, as the catalog names it.
 */
export function readGoogleCloudAuditResourceIds(data: {
  // The LogEntry: its monitored resource.
  entry: JSONObject;
  // Its AuditLog payload.
  payload: JSONObject;
}): Array<string> {
  const ids: ResourceIds = new ResourceIds();
  const serviceName: string = text(data.payload["serviceName"]).toLowerCase();
  const resourceName: string = text(data.payload["resourceName"]);
  const monitored: JSONObject | null = asObject(data.entry["resource"]);
  const labels: Record<string, string> = readLabels(
    monitored ? monitored["labels"] : undefined,
  );

  if (resourceName.startsWith("//")) {
    ids.add(resourceName);
  } else if (resourceName && isGoogleApiServiceName(serviceName)) {
    const name: string | null = normalizeGoogleResourceName({
      serviceName,
      resourceName,
      labels,
    });

    if (name) {
      ids.add(`//${serviceName}/${name}`);

      const top: string | null = getGoogleTopLevelResourceName(name);

      if (top) {
        ids.add(`//${serviceName}/${top}`);
      }
    }
  }

  ids.add(
    getGoogleMonitoredResourceName({
      type: text(monitored ? monitored["type"] : undefined),
      labels,
    }),
  );

  return ids.toArray();
}

// ---------- A serverless function's own id ----------

// A Lambda function: by its platform, or an AWS function whose platform was not reported.
function isLambdaFunction(data: {
  cloudProvider?: string | null | undefined;
  cloudPlatform?: string | null | undefined;
}): boolean {
  const platform: string = normalizeCloudPlatform(data.cloudPlatform) || "";
  const provider: string = (data.cloudProvider || "").trim().toLowerCase();

  return (
    platform === FaasCloudPlatform.AwsLambda ||
    (!platform && provider === CloudProvider.AWS)
  );
}

/*
 * Whether a function's cloud's audit log can name it once its telemetry
 * says its account and Region: an AWS Lambda function's or a Google Cloud
 * function's, never an Azure function's (getServerlessFunctionCloudResourceId).
 */
export function canServerlessFunctionBeNamedByAuditLog(data: {
  cloudProvider?: string | null | undefined;
  cloudPlatform?: string | null | undefined;
}): boolean {
  return (
    isLambdaFunction(data) ||
    normalizeCloudPlatform(data.cloudPlatform) ===
      FaasCloudPlatform.GcpCloudFunctions
  );
}

/*
 * A serverless function's id at its cloud, the way an audit record names
 * it (#9780) - or null where its telemetry does not say it in full:
 *
 *   - an AWS Lambda function: its ARN, from its account, its Region and
 *     its name (faas.name), through the cloud catalog's own template, as
 *     its Cloud Resource keeps it. A Lambda layer that reports no account
 *     id leaves it unsaid, and nothing is guessed;
 *   - a Google Cloud function: its full resource name, from its project,
 *     its Region and its name;
 *   - an Azure function: none. Its resource ID holds its resource group,
 *     which no telemetry of a function reports, so the Activity Log's
 *     records about it reach its Function App's own page in Cloud.
 */
export function getServerlessFunctionCloudResourceId(data: {
  functionIdentifier: string | null | undefined;
  cloudProvider?: string | null | undefined;
  cloudPlatform?: string | null | undefined;
  cloudRegion?: string | null | undefined;
  cloudAccountId?: string | null | undefined;
}): string | null {
  const name: string = (data.functionIdentifier || "").trim();
  const platform: string = normalizeCloudPlatform(data.cloudPlatform) || "";
  const region: string = (data.cloudRegion || "").trim().toLowerCase();
  const accountId: string = (data.cloudAccountId || "").trim();

  if (!name || !region || !accountId) {
    return null;
  }

  if (isLambdaFunction(data)) {
    const named: { name: string; accountId: string } | null =
      readLambdaFunctionName(name);

    if (
      !named ||
      named.accountId ||
      named.name !== name ||
      accountId.length !== 12 ||
      !isDigits(accountId) ||
      !isAwsRegion(region)
    ) {
      return null;
    }

    return buildCatalogAwsArn({
      namespace: "AWS/Lambda",
      dimensions: { FunctionName: named.name },
      place: { accountId, region },
      type: "AWS::Lambda::Function",
    });
  }

  if (platform === FaasCloudPlatform.GcpCloudFunctions) {
    return getGoogleMonitoredResourceName({
      type: "cloud_function",
      labels: { project_id: accountId, region, function_name: name },
    });
  }

  return null;
}

// ---------- Which cloud resources have security events of their own ----------

/*
 * Whether a cloud resource can have security events of its own (#9779),
 * and so a Security Events page - by the identities its Security card
 * counts by (ResourceSecurity):
 *
 *   - an ID its cloud's audit log names it by: an ARN, an Azure resource
 *     ID, a Google Cloud full resource name (isCloudResourceNamedByItsId);
 *   - logs of its own, which its connection's stream files under it,
 *     stamped with its ID;
 *   - a name or address it answers on (its endpoints), which any source
 *     can name it by.
 *
 * A resource OneUptime knows only by a readable stand-in its metrics give
 * it ("AWS/AmazonMQ Broker=orders", a Google Cloud VPN gateway's labels),
 * that sends no logs of its own and answers on no name or address of its
 * own, has none of them: no record names the stand-in, and nothing else is
 * its. It has no page, rather than one that would always be empty.
 */
export function canCloudResourceHaveSecurityEvents(data: {
  provider: string | null | undefined;
  type: string | null | undefined;
  providerResourceId: string | null | undefined;
  cloudEndpoints?: unknown;
}): boolean {
  const provider: string = (data.provider || "").toLowerCase();
  const id: string = (data.providerResourceId || "").trim();
  const endpoints: { names: Array<string>; addresses: Array<string> } =
    readCloudEndpointHosts(data.cloudEndpoints);

  if (endpoints.names.length > 0 || endpoints.addresses.length > 0) {
    return true;
  }

  if (!id) {
    return false;
  }

  return (
    isCloudResourceNamedByItsId(id) ||
    canCloudResourceHaveStreamedLogs({ provider, type: data.type })
  );
}

/*
 * Whether a cloud resource's audit log can name it: its row keeps its own
 * ID at its cloud, as ResourceSecurity searches for it, not a readable
 * stand-in no record names.
 */
export function isCloudResourceNamedByItsId(
  providerResourceId: string | null | undefined,
): boolean {
  return isCloudResourceIdLike(providerResourceId);
}
