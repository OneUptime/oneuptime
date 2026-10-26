import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudRelationshipKind,
  CloudResourceRelationship,
  boundCloudRelationships,
  normalizeCloudEndpoints,
  normalizeCloudTags,
  pickCloudProperties,
  readCloudPath,
} from "../../../../Types/Cloud/CloudInventory";
import {
  AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE,
  AWS_CLOUDWATCH_DIMENSION_PREFIX,
  AWS_CLOUDWATCH_METRIC_NAME_PREFIX,
  CLOUD_ACCOUNT_ID_ATTRIBUTE,
  CLOUD_REGION_ATTRIBUTE,
  CloudMonitoredResource,
  CloudMonitoringSource,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { getAwsPartitionForRegion } from "../../../../Types/Cloud/CloudResourceCatalog";
import { JSONObject } from "../../../../Types/JSON";
import { withoutTrailingRun } from "../../../../Utils/TrailingRuns";
import { CloudInventoryItem } from "../CloudConnectorTypes";
import { AwsListedResource } from "./AwsCloudControl";

/*
 * WHAT AN AWS ACCOUNT'S INVENTORY LISTS, AND HOW EACH RESOURCE BECOMES ONE
 * CLOUD RESOURCE.
 *
 * The inventory lists these CloudFormation types through Cloud Control
 * (AwsCloudControl) in every Region the account uses. Each listed resource
 * is given the identity its CloudWatch metrics give it - the namespace and
 * identity dimensions of CloudResourceCatalog's rule, run through the same
 * resolver ingest uses - so an EC2 instance the inventory lists and the
 * instance whose CPU the metrics read are one row, whichever came first.
 * A type with no CloudWatch metrics (a VPC) gets an identity of the same
 * shape from its id.
 *
 * Each type names the properties it keeps (pickCloudProperties: never a
 * path that can hold a secret - no Lambda environment, no instance user
 * data), its relationships and its endpoints.
 *
 * S3 buckets are not listed here: Cloud Control lists every bucket of the
 * account in every Region without saying where each lives, and a bucket's
 * identity is its Region's. Their daily storage metrics find them.
 */

export interface AwsInventoryContext {
  accountId: string;
  region: string;
}

export interface AwsInventoryType {
  // The CloudFormation type, as Cloud Control and CloudResourceCatalog spell it.
  type: string;
  // Listed once, in us-east-1, rather than in every Region (CloudFront).
  isGlobal?: boolean | undefined;
  /*
   * The CloudWatch namespace whose identity rule the type's resources
   * share, and their identity dimensions read from what was listed. Absent
   * for a type with no metrics, which is identified by inventoryId.
   */
  metrics?:
    | {
        namespace: (listed: AwsListedResource) => string;
        dimensions: (
          listed: AwsListedResource,
          context: AwsInventoryContext,
        ) => Record<string, string> | null;
      }
    | undefined;
  /*
   * A type with no metrics: its id, the identity dimension it is named
   * under ("VpcId") and its ARN.
   */
  inventoryId?:
    | {
        dimension: string;
        arn: (id: string, context: AwsInventoryContext) => string;
      }
    | undefined;
  // What it is called, when not its identity: an instance's Name tag is read first.
  name?: ((listed: AwsListedResource) => string) | undefined;
  // The dotted property paths it keeps (pickCloudProperties).
  properties: ReadonlyArray<string>;
  relationships?:
    | ((
        listed: AwsListedResource,
        context: AwsInventoryContext,
      ) => Array<CloudResourceRelationship>)
    | undefined;
  endpoints?:
    | ((
        listed: AwsListedResource,
        context: AwsInventoryContext,
      ) => Array<unknown>)
    | undefined;
  /*
   * Listed inside each resource of another type: an ECS service inside its
   * cluster. The parent's ResourceModel for Cloud Control.
   */
  parent?:
    | {
        type: string;
        model: (parent: AwsListedResource) => JSONObject | null;
      }
    | undefined;
  /*
   * Listed for the relationships it gives other resources, never a row of
   * its own: a target group joins a load balancer to what it sends to.
   */
  isPlumbing?: boolean | undefined;
}

// Text at a dotted path, "" when it is not text.
export function textAt(source: JSONObject, path: string): string {
  const value: unknown = readCloudPath(source, path);

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}

// Every text value of a list (or a single value) at a dotted path.
export function textsAt(source: JSONObject, path: string): Array<string> {
  const value: unknown = readCloudPath(source, path);
  const values: Array<unknown> = Array.isArray(value) ? value : [value];

  return values
    .map((item: unknown): string => {
      return typeof item === "string" ? item.trim() : "";
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
}

// `arn:aws:ecs:us-east-1:123:cluster/orders` -> `orders`.
export function arnResourceName(arn: string): string {
  const slash: number = arn.lastIndexOf("/");
  const colon: number = arn.lastIndexOf(":");
  const cut: number = Math.max(slash, colon);

  return cut >= 0 && cut < arn.length - 1 ? arn.slice(cut + 1) : arn;
}

function arnOf(
  context: AwsInventoryContext,
  service: string,
  resource: string,
): string {
  return `arn:${getAwsPartitionForRegion(context.region)}:${service}:${context.region}:${context.accountId}:${resource}`;
}

function relations(
  kind: CloudRelationshipKind,
  targets: Array<string>,
  targetType?: string,
): Array<CloudResourceRelationship> {
  return targets.map((target: string): CloudResourceRelationship => {
    return { kind, target, targetType };
  });
}

const SUBNET: string = "AWS::EC2::Subnet";
const VPC: string = "AWS::EC2::VPC";
const SECURITY_GROUP: string = "AWS::EC2::SecurityGroup";

function inSubnets(
  props: JSONObject,
  path: string,
): Array<CloudResourceRelationship> {
  return relations(CloudRelationshipKind.RunsIn, textsAt(props, path), SUBNET);
}

function guardedBy(
  props: JSONObject,
  path: string,
): Array<CloudResourceRelationship> {
  return relations(
    CloudRelationshipKind.ProtectedBy,
    textsAt(props, path),
    SECURITY_GROUP,
  );
}

/*
 * `subnet-a,subnet-b` (an Auto Scaling group's VPCZoneIdentifier as a
 * string) or a list: the subnets either way.
 */
function splitIds(values: Array<string>): Array<string> {
  return values
    .flatMap((value: string): Array<string> => {
      return value.split(",");
    })
    .map((value: string): string => {
      return value.trim();
    })
    .filter((value: string): boolean => {
      return value.length > 0;
    });
}

const SLASH_CODE: number = "/".charCodeAt(0);

// An SQS queue URL's last segment is its name.
function queueNameOf(listed: AwsListedResource): string {
  return (
    textAt(listed.properties, "QueueName") ||
    arnResourceName(
      withoutTrailingRun(listed.identifier, (code: number): boolean => {
        return code === SLASH_CODE;
      }),
    )
  );
}

/*
 * A redrive policy as CloudFormation describes it: an object, or a JSON
 * document in a string.
 */
function deadLetterTargetOf(props: JSONObject): string {
  const raw: unknown = props["RedrivePolicy"];

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return textAt(raw as JSONObject, "deadLetterTargetArn");
  }

  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(raw);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return textAt(parsed as JSONObject, "deadLetterTargetArn");
      }
    } catch {
      return "";
    }
  }

  return "";
}

// The namespace of a load balancer's metrics, by its type.
function elbV2Namespace(listed: AwsListedResource): string {
  const type: string = textAt(listed.properties, "Type").toLowerCase();

  if (type === "network") {
    return "AWS/NetworkELB";
  }

  if (type === "gateway") {
    return "AWS/GatewayELB";
  }

  return "AWS/ApplicationELB";
}

// `arn:...:loadbalancer/app/checkout/50dc...` -> `app/checkout/50dc...`.
export function elbV2Dimension(arn: string): string {
  const marker: string = ":loadbalancer/";
  const index: number = arn.indexOf(marker);

  return index >= 0 ? arn.slice(index + marker.length) : "";
}

export const AWS_INVENTORY_TYPES: ReadonlyArray<AwsInventoryType> = [
  {
    type: "AWS::EC2::Instance",
    metrics: {
      namespace: () => {
        return "AWS/EC2";
      },
      dimensions: (listed: AwsListedResource) => {
        return { InstanceId: listed.identifier };
      },
    },
    properties: [
      "InstanceType",
      "State.Name",
      "AvailabilityZone",
      "ImageId",
      "Platform",
      "VpcId",
      "SubnetId",
      "PrivateIpAddress",
      "PublicIp",
      "PrivateDnsName",
      "PublicDnsName",
      "Monitoring",
      "SecurityGroupIds",
    ],
    relationships: (listed: AwsListedResource) => {
      return [
        ...inSubnets(listed.properties, "SubnetId"),
        ...relations(
          CloudRelationshipKind.RunsIn,
          textsAt(listed.properties, "VpcId"),
          VPC,
        ),
        ...guardedBy(listed.properties, "SecurityGroupIds"),
      ];
    },
    endpoints: (listed: AwsListedResource) => {
      return [
        listed.properties["PublicDnsName"],
        listed.properties["PublicIp"],
        listed.properties["PrivateDnsName"],
        listed.properties["PrivateIpAddress"],
      ];
    },
  },
  {
    type: "AWS::EC2::Volume",
    metrics: {
      namespace: () => {
        return "AWS/EBS";
      },
      dimensions: (listed: AwsListedResource) => {
        return { VolumeId: listed.identifier };
      },
    },
    properties: [
      "Size",
      "VolumeType",
      "Iops",
      "Throughput",
      "AvailabilityZone",
      "Encrypted",
    ],
  },
  {
    type: "AWS::EC2::VPC",
    inventoryId: {
      dimension: "VpcId",
      arn: (id: string, context: AwsInventoryContext) => {
        return arnOf(context, "ec2", `vpc/${id}`);
      },
    },
    properties: ["CidrBlock", "InstanceTenancy", "EnableDnsSupport"],
  },
  {
    type: "AWS::EC2::NatGateway",
    metrics: {
      namespace: () => {
        return "AWS/NATGateway";
      },
      dimensions: (listed: AwsListedResource) => {
        return { NatGatewayId: listed.identifier };
      },
    },
    properties: ["ConnectivityType", "SubnetId", "VpcId"],
    relationships: (listed: AwsListedResource) => {
      return inSubnets(listed.properties, "SubnetId");
    },
  },
  {
    type: "AWS::AutoScaling::AutoScalingGroup",
    metrics: {
      namespace: () => {
        return "AWS/AutoScaling";
      },
      dimensions: (listed: AwsListedResource) => {
        return { AutoScalingGroupName: listed.identifier };
      },
    },
    properties: [
      "MinSize",
      "MaxSize",
      "DesiredCapacity",
      "HealthCheckType",
      "HealthCheckGracePeriod",
      "AvailabilityZones",
      "LaunchTemplate.LaunchTemplateName",
      "LaunchTemplate.Version",
      "TargetGroupARNs",
    ],
    relationships: (listed: AwsListedResource) => {
      return relations(
        CloudRelationshipKind.RunsIn,
        splitIds(textsAt(listed.properties, "VPCZoneIdentifier")),
        SUBNET,
      );
    },
  },
  {
    type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
    metrics: {
      namespace: elbV2Namespace,
      dimensions: (listed: AwsListedResource) => {
        const dimension: string = elbV2Dimension(listed.identifier);
        return dimension ? { LoadBalancer: dimension } : null;
      },
    },
    name: (listed: AwsListedResource) => {
      return textAt(listed.properties, "LoadBalancerName");
    },
    properties: [
      "Type",
      "Scheme",
      "DNSName",
      "IpAddressType",
      "LoadBalancerName",
      "SecurityGroups",
      "Subnets",
    ],
    relationships: (listed: AwsListedResource) => {
      return [
        ...inSubnets(listed.properties, "Subnets"),
        ...guardedBy(listed.properties, "SecurityGroups"),
      ];
    },
    endpoints: (listed: AwsListedResource) => {
      return [listed.properties["DNSName"]];
    },
  },
  {
    type: "AWS::ElasticLoadBalancingV2::TargetGroup",
    isPlumbing: true,
    properties: [],
  },
  {
    type: "AWS::ECS::Cluster",
    metrics: {
      namespace: () => {
        return "AWS/ECS";
      },
      dimensions: (listed: AwsListedResource) => {
        const name: string =
          textAt(listed.properties, "ClusterName") ||
          arnResourceName(listed.identifier);
        return name ? { ClusterName: name } : null;
      },
    },
    properties: ["ClusterName", "Arn", "CapacityProviders"],
  },
  {
    type: "AWS::ECS::Service",
    parent: {
      type: "AWS::ECS::Cluster",
      model: (parent: AwsListedResource) => {
        const arn: string = textAt(parent.properties, "Arn");
        return arn ? { Cluster: arn } : null;
      },
    },
    metrics: {
      namespace: () => {
        return "AWS/ECS";
      },
      dimensions: (listed: AwsListedResource) => {
        const cluster: string = arnResourceName(
          textAt(listed.properties, "Cluster"),
        );
        const service: string =
          textAt(listed.properties, "ServiceName") ||
          arnResourceName(textAt(listed.properties, "ServiceArn"));
        return cluster && service
          ? { ClusterName: cluster, ServiceName: service }
          : null;
      },
    },
    name: (listed: AwsListedResource) => {
      return textAt(listed.properties, "ServiceName");
    },
    properties: [
      "ServiceName",
      "ServiceArn",
      "Cluster",
      "DesiredCount",
      "LaunchType",
      "SchedulingStrategy",
      "TaskDefinition",
      "PlatformVersion",
      "DeploymentConfiguration.MinimumHealthyPercent",
      "DeploymentConfiguration.MaximumPercent",
    ],
    relationships: (listed: AwsListedResource) => {
      return [
        ...relations(
          CloudRelationshipKind.PartOf,
          textsAt(listed.properties, "Cluster"),
          "AWS::ECS::Cluster",
        ),
        ...inSubnets(
          listed.properties,
          "NetworkConfiguration.AwsvpcConfiguration.Subnets",
        ),
        ...guardedBy(
          listed.properties,
          "NetworkConfiguration.AwsvpcConfiguration.SecurityGroups",
        ),
      ];
    },
  },
  {
    type: "AWS::Lambda::Function",
    metrics: {
      namespace: () => {
        return "AWS/Lambda";
      },
      dimensions: (listed: AwsListedResource) => {
        return { FunctionName: listed.identifier };
      },
    },
    // Never Environment or Code: either can hold a secret.
    properties: [
      "Arn",
      "Runtime",
      "MemorySize",
      "Timeout",
      "Handler",
      "Architectures",
      "PackageType",
      "EphemeralStorage.Size",
      "VpcConfig.SubnetIds",
      "VpcConfig.SecurityGroupIds",
    ],
    relationships: (listed: AwsListedResource) => {
      return [
        ...inSubnets(listed.properties, "VpcConfig.SubnetIds"),
        ...guardedBy(listed.properties, "VpcConfig.SecurityGroupIds"),
      ];
    },
  },
  {
    type: "AWS::RDS::DBInstance",
    metrics: {
      namespace: () => {
        return "AWS/RDS";
      },
      dimensions: (listed: AwsListedResource) => {
        return { DBInstanceIdentifier: listed.identifier };
      },
    },
    // Never MasterUserPassword or a connection string.
    properties: [
      "DBInstanceClass",
      "Engine",
      "EngineVersion",
      "MultiAZ",
      "AllocatedStorage",
      "StorageType",
      "Iops",
      "StorageEncrypted",
      "Endpoint.Address",
      "Endpoint.Port",
      "DBClusterIdentifier",
      "DBSubnetGroupName",
      "AvailabilityZone",
      "PubliclyAccessible",
      "DeletionProtection",
      "BackupRetentionPeriod",
      "DBInstanceArn",
    ],
    relationships: (
      listed: AwsListedResource,
      context: AwsInventoryContext,
    ) => {
      const cluster: string = textAt(listed.properties, "DBClusterIdentifier");

      return [
        ...(cluster
          ? relations(
              CloudRelationshipKind.PartOf,
              [arnOf(context, "rds", `cluster:${cluster}`)],
              "AWS::RDS::DBCluster",
            )
          : []),
        ...relations(
          CloudRelationshipKind.ProtectedBy,
          textsAt(listed.properties, "VPCSecurityGroups"),
          SECURITY_GROUP,
        ),
      ];
    },
    endpoints: (listed: AwsListedResource) => {
      return [readCloudPath(listed.properties, "Endpoint.Address")];
    },
  },
  {
    type: "AWS::RDS::DBCluster",
    metrics: {
      namespace: () => {
        return "AWS/RDS";
      },
      dimensions: (listed: AwsListedResource) => {
        return { DBClusterIdentifier: listed.identifier };
      },
    },
    properties: [
      "Engine",
      "EngineVersion",
      "EngineMode",
      "Endpoint.Address",
      "Endpoint.Port",
      "ReadEndpoint.Address",
      "DBSubnetGroupName",
      "StorageEncrypted",
      "DeletionProtection",
      "ServerlessV2ScalingConfiguration.MinCapacity",
      "ServerlessV2ScalingConfiguration.MaxCapacity",
      "DBClusterArn",
    ],
    relationships: (listed: AwsListedResource) => {
      return guardedBy(listed.properties, "VpcSecurityGroupIds");
    },
    endpoints: (listed: AwsListedResource) => {
      return [
        readCloudPath(listed.properties, "Endpoint.Address"),
        readCloudPath(listed.properties, "ReadEndpoint.Address"),
      ];
    },
  },
  {
    type: "AWS::ElastiCache::ReplicationGroup",
    metrics: {
      namespace: () => {
        return "AWS/ElastiCache";
      },
      dimensions: (listed: AwsListedResource) => {
        return { ReplicationGroupId: listed.identifier };
      },
    },
    // Never AuthToken.
    properties: [
      "CacheNodeType",
      "Engine",
      "EngineVersion",
      "NumCacheClusters",
      "NumNodeGroups",
      "AutomaticFailoverEnabled",
      "MultiAZEnabled",
      "TransitEncryptionEnabled",
      "AtRestEncryptionEnabled",
      "PrimaryEndPoint.Address",
      "ConfigurationEndPoint.Address",
      "ReaderEndPoint.Address",
    ],
    relationships: (listed: AwsListedResource) => {
      return guardedBy(listed.properties, "SecurityGroupIds");
    },
    endpoints: (listed: AwsListedResource) => {
      return [
        readCloudPath(listed.properties, "PrimaryEndPoint.Address"),
        readCloudPath(listed.properties, "ConfigurationEndPoint.Address"),
        readCloudPath(listed.properties, "ReaderEndPoint.Address"),
      ];
    },
  },
  {
    type: "AWS::SQS::Queue",
    metrics: {
      namespace: () => {
        return "AWS/SQS";
      },
      dimensions: (listed: AwsListedResource) => {
        const name: string = queueNameOf(listed);
        return name ? { QueueName: name } : null;
      },
    },
    name: queueNameOf,
    properties: [
      "Arn",
      "FifoQueue",
      "VisibilityTimeout",
      "MessageRetentionPeriod",
      "DelaySeconds",
      "MaximumMessageSize",
      "SqsManagedSseEnabled",
    ],
    relationships: (listed: AwsListedResource) => {
      const target: string = deadLetterTargetOf(listed.properties);

      return target
        ? relations(
            CloudRelationshipKind.DeadLettersTo,
            [target],
            "AWS::SQS::Queue",
          )
        : [];
    },
  },
  {
    type: "AWS::SNS::Topic",
    metrics: {
      namespace: () => {
        return "AWS/SNS";
      },
      dimensions: (listed: AwsListedResource) => {
        const name: string =
          textAt(listed.properties, "TopicName") ||
          arnResourceName(listed.identifier);
        return name ? { TopicName: name } : null;
      },
    },
    properties: ["TopicName", "TopicArn", "FifoTopic"],
    relationships: (listed: AwsListedResource) => {
      const subscriptions: unknown = listed.properties["Subscription"];

      if (!Array.isArray(subscriptions)) {
        return [];
      }

      // Only subscribers that are AWS resources: a queue, a function.
      return relations(
        CloudRelationshipKind.RoutesTo,
        subscriptions
          .map((subscription: unknown): string => {
            return subscription &&
              typeof subscription === "object" &&
              !Array.isArray(subscription)
              ? textAt(subscription as JSONObject, "Endpoint")
              : "";
          })
          .filter((endpoint: string): boolean => {
            return endpoint.startsWith("arn:");
          }),
      );
    },
  },
  {
    type: "AWS::DynamoDB::Table",
    metrics: {
      namespace: () => {
        return "AWS/DynamoDB";
      },
      dimensions: (listed: AwsListedResource) => {
        return { TableName: listed.identifier };
      },
    },
    properties: [
      "Arn",
      "BillingMode",
      "TableClass",
      "ProvisionedThroughput.ReadCapacityUnits",
      "ProvisionedThroughput.WriteCapacityUnits",
      "StreamSpecification.StreamViewType",
      "PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled",
      "DeletionProtectionEnabled",
    ],
  },
  {
    type: "AWS::Kinesis::Stream",
    metrics: {
      namespace: () => {
        return "AWS/Kinesis";
      },
      dimensions: (listed: AwsListedResource) => {
        return { StreamName: listed.identifier };
      },
    },
    properties: [
      "Arn",
      "ShardCount",
      "RetentionPeriodHours",
      "StreamModeDetails.StreamMode",
    ],
  },
  {
    type: "AWS::StepFunctions::StateMachine",
    metrics: {
      namespace: () => {
        return "AWS/States";
      },
      dimensions: (listed: AwsListedResource) => {
        return { StateMachineArn: listed.identifier };
      },
    },
    name: (listed: AwsListedResource) => {
      return (
        textAt(listed.properties, "StateMachineName") ||
        arnResourceName(listed.identifier)
      );
    },
    properties: ["StateMachineName", "StateMachineType"],
  },
  {
    type: "AWS::ApiGateway::RestApi",
    metrics: {
      namespace: () => {
        return "AWS/ApiGateway";
      },
      // REST APIs report their metrics under their name, not their id.
      dimensions: (listed: AwsListedResource) => {
        const name: string = textAt(listed.properties, "Name");
        return name ? { ApiName: name } : null;
      },
    },
    properties: ["Name", "RestApiId", "EndpointConfiguration.Types"],
    endpoints: (listed: AwsListedResource, context: AwsInventoryContext) => {
      return [
        `${listed.identifier}.execute-api.${context.region}.amazonaws.com`,
      ];
    },
  },
  {
    type: "AWS::ApiGatewayV2::Api",
    metrics: {
      namespace: () => {
        return "AWS/ApiGateway";
      },
      dimensions: (listed: AwsListedResource) => {
        return { ApiId: listed.identifier };
      },
    },
    name: (listed: AwsListedResource) => {
      return textAt(listed.properties, "Name");
    },
    properties: ["Name", "ProtocolType", "ApiEndpoint"],
    endpoints: (listed: AwsListedResource) => {
      return [listed.properties["ApiEndpoint"]];
    },
  },
  {
    type: "AWS::CloudFront::Distribution",
    isGlobal: true,
    metrics: {
      namespace: () => {
        return "AWS/CloudFront";
      },
      dimensions: (listed: AwsListedResource) => {
        return { DistributionId: listed.identifier };
      },
    },
    properties: [
      "DomainName",
      "DistributionConfig.Aliases",
      "DistributionConfig.Enabled",
      "DistributionConfig.PriceClass",
      "DistributionConfig.HttpVersion",
    ],
    relationships: (listed: AwsListedResource) => {
      const origins: unknown = readCloudPath(
        listed.properties,
        "DistributionConfig.Origins",
      );
      const originHosts: Array<string> = Array.isArray(origins)
        ? origins
            .map((origin: unknown): string => {
              return origin && typeof origin === "object"
                ? textAt(origin as JSONObject, "DomainName")
                : "";
            })
            .filter((host: string): boolean => {
              return host.length > 0;
            })
        : [];

      return [
        ...relations(CloudRelationshipKind.RoutesTo, originHosts),
        ...relations(
          CloudRelationshipKind.ProtectedBy,
          textsAt(listed.properties, "DistributionConfig.WebACLId"),
          "AWS::WAFv2::WebACL",
        ),
      ];
    },
    endpoints: (listed: AwsListedResource) => {
      return [
        listed.properties["DomainName"],
        ...textsAt(listed.properties, "DistributionConfig.Aliases"),
      ];
    },
  },
  {
    type: "AWS::EFS::FileSystem",
    metrics: {
      namespace: () => {
        return "AWS/EFS";
      },
      dimensions: (listed: AwsListedResource) => {
        return { FileSystemId: listed.identifier };
      },
    },
    properties: ["PerformanceMode", "ThroughputMode", "Encrypted", "Arn"],
  },
  {
    type: "AWS::OpenSearchService::Domain",
    metrics: {
      namespace: () => {
        return "AWS/ES";
      },
      dimensions: (listed: AwsListedResource) => {
        return { DomainName: listed.identifier };
      },
    },
    properties: [
      "EngineVersion",
      "ClusterConfig.InstanceType",
      "ClusterConfig.InstanceCount",
      "DomainEndpoint",
      "Arn",
    ],
    endpoints: (listed: AwsListedResource) => {
      return [listed.properties["DomainEndpoint"]];
    },
  },
  {
    type: "AWS::AppRunner::Service",
    metrics: {
      namespace: () => {
        return "AWS/AppRunner";
      },
      dimensions: (listed: AwsListedResource) => {
        const name: string = textAt(listed.properties, "ServiceName");
        return name ? { ServiceName: name } : null;
      },
    },
    name: (listed: AwsListedResource) => {
      return textAt(listed.properties, "ServiceName");
    },
    properties: ["ServiceName", "ServiceUrl", "Status"],
    endpoints: (listed: AwsListedResource) => {
      return [listed.properties["ServiceUrl"]];
    },
  },
];

export function getAwsInventoryType(type: string): AwsInventoryType | null {
  return (
    AWS_INVENTORY_TYPES.find((candidate: AwsInventoryType): boolean => {
      return candidate.type === type;
    }) || null
  );
}

// The types an inventory makes rows of: every listed type but plumbing.
export function getAwsInventoryRowTypes(): Array<string> {
  return AWS_INVENTORY_TYPES.filter((candidate: AwsInventoryType): boolean => {
    return !candidate.isPlumbing;
  }).map((candidate: AwsInventoryType): string => {
    return candidate.type;
  });
}

/*
 * The identity of a listed resource: the one its metrics would give it, by
 * running the stored attributes a CloudWatch datapoint about it would carry
 * through ingest's resolver; or, for a type with no metrics, one of the same
 * shape from its id. Null when what was listed names no resource.
 */
export function getAwsInventoryIdentity(
  inventoryType: AwsInventoryType,
  listed: AwsListedResource,
  context: AwsInventoryContext,
): CloudMonitoredResource | null {
  if (inventoryType.metrics) {
    const dimensions: Record<string, string> | null =
      inventoryType.metrics.dimensions(listed, context);

    if (!dimensions) {
      return null;
    }

    const namespace: string = inventoryType.metrics.namespace(listed);
    const attributes: Record<string, string> = {
      [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: namespace,
      [CLOUD_ACCOUNT_ID_ATTRIBUTE]: context.accountId,
      [CLOUD_REGION_ATTRIBUTE]: context.region,
    };

    for (const name of Object.keys(dimensions)) {
      attributes[`${AWS_CLOUDWATCH_DIMENSION_PREFIX}${name}`] =
        dimensions[name]!;
    }

    const resolved: CloudMonitoredResource | null =
      resolveCloudMonitoredResource({
        metricName: `${AWS_CLOUDWATCH_METRIC_NAME_PREFIX}${namespace}/Inventory`,
        attributes,
      });

    // A rule of another type answering (EC2's group aggregate) is not this resource.
    return resolved && resolved.resourceType === inventoryType.type
      ? resolved
      : null;
  }

  if (inventoryType.inventoryId) {
    const id: string = listed.identifier.trim();

    if (!id) {
      return null;
    }

    const pair: string = `${inventoryType.inventoryId.dimension}=${id}`;

    return {
      provider: CloudProvider.AWS,
      source: CloudMonitoringSource.AwsCloudWatch,
      resourceType: inventoryType.type,
      name: id,
      providerResourceId: inventoryType.inventoryId.arn(id, context),
      accountId: context.accountId,
      region: context.region,
      resourceGroup: "",
      identityKey: [
        CloudProvider.AWS,
        context.accountId,
        context.region,
        inventoryType.type,
        pair,
      ]
        .join("|")
        .toLowerCase(),
      telemetryAttributes: {},
    };
  }

  return null;
}

/*
 * One listed resource as an inventory item, or null when it names no
 * resource. Its name is its Name tag, else its type's own name for it,
 * else what its identity calls it.
 */
export function buildAwsInventoryItem(
  inventoryType: AwsInventoryType,
  listed: AwsListedResource,
  context: AwsInventoryContext,
): CloudInventoryItem | null {
  if (inventoryType.isPlumbing) {
    return null;
  }

  const resource: CloudMonitoredResource | null = getAwsInventoryIdentity(
    inventoryType,
    listed,
    context,
  );

  if (!resource) {
    return null;
  }

  const tags: Record<string, string> = normalizeCloudTags(
    listed.properties["Tags"],
  );
  const displayName: string =
    tags["Name"] ||
    (inventoryType.name ? inventoryType.name(listed).trim() : "") ||
    "";

  return {
    resource,
    displayName: displayName || undefined,
    tags,
    properties: pickCloudProperties(
      listed.properties,
      inventoryType.properties,
    ),
    relationships: boundCloudRelationships(
      inventoryType.relationships
        ? inventoryType.relationships(listed, context)
        : [],
    ),
    endpoints: normalizeCloudEndpoints(
      inventoryType.endpoints ? inventoryType.endpoints(listed, context) : [],
    ),
  };
}

/*
 * What a load balancer sends to, from its target groups: a target group
 * names its load balancers and, for instance and Lambda targets, the
 * targets themselves; an ECS service and an Auto Scaling group name the
 * target groups they are registered in. The edges are written on the load
 * balancer: traffic goes from it to them.
 */
export function addAwsLoadBalancerEdges(data: {
  items: Array<CloudInventoryItem>;
  targetGroups: Array<AwsListedResource>;
  // Every listed resource by item, to read the target groups each names.
  listedByItem: Map<CloudInventoryItem, AwsListedResource>;
  context: AwsInventoryContext;
}): void {
  const loadBalancersByTargetGroup: Map<string, Array<string>> = new Map();
  const targetsByTargetGroup: Map<string, Array<string>> = new Map();

  for (const group of data.targetGroups) {
    const arn: string = (
      textAt(group.properties, "TargetGroupArn") || group.identifier
    ).toLowerCase();

    loadBalancersByTargetGroup.set(
      arn,
      textsAt(group.properties, "LoadBalancerArns"),
    );

    const targets: unknown = group.properties["Targets"];
    const type: string = textAt(group.properties, "TargetType").toLowerCase();

    if (Array.isArray(targets) && (type === "instance" || type === "lambda")) {
      targetsByTargetGroup.set(
        arn,
        targets
          .map((target: unknown): string => {
            const id: string =
              target && typeof target === "object"
                ? textAt(target as JSONObject, "Id")
                : "";

            if (!id) {
              return "";
            }

            return id.startsWith("arn:")
              ? id
              : arnOf(data.context, "ec2", `instance/${id}`);
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          }),
      );
    }
  }

  const loadBalancerItems: Map<string, CloudInventoryItem> = new Map();

  for (const item of data.items) {
    if (
      item.resource.resourceType === "AWS::ElasticLoadBalancingV2::LoadBalancer"
    ) {
      loadBalancerItems.set(
        item.resource.providerResourceId.toLowerCase(),
        item,
      );
    }
  }

  const addEdge: (loadBalancerArn: string, target: string) => void = (
    loadBalancerArn: string,
    target: string,
  ): void => {
    const loadBalancer: CloudInventoryItem | undefined = loadBalancerItems.get(
      loadBalancerArn.toLowerCase(),
    );

    if (loadBalancer && target) {
      loadBalancer.relationships = boundCloudRelationships([
        ...loadBalancer.relationships,
        { kind: CloudRelationshipKind.RoutesTo, target },
      ]);
    }
  };

  // Instance and Lambda targets.
  for (const [group, targets] of targetsByTargetGroup) {
    for (const loadBalancerArn of loadBalancersByTargetGroup.get(group) || []) {
      for (const target of targets) {
        addEdge(loadBalancerArn, target);
      }
    }
  }

  // ECS services and Auto Scaling groups registered in a target group.
  for (const item of data.items) {
    const listed: AwsListedResource | undefined = data.listedByItem.get(item);

    if (!listed) {
      continue;
    }

    const groups: Array<string> =
      item.resource.resourceType === "AWS::ECS::Service"
        ? (Array.isArray(listed.properties["LoadBalancers"])
            ? (listed.properties["LoadBalancers"] as Array<unknown>)
            : []
          ).map((entry: unknown): string => {
            return entry && typeof entry === "object"
              ? textAt(entry as JSONObject, "TargetGroupArn")
              : "";
          })
        : item.resource.resourceType === "AWS::AutoScaling::AutoScalingGroup"
          ? textsAt(listed.properties, "TargetGroupARNs")
          : [];

    for (const group of groups) {
      for (const loadBalancerArn of loadBalancersByTargetGroup.get(
        group.toLowerCase(),
      ) || []) {
        addEdge(loadBalancerArn, item.resource.providerResourceId);
      }
    }
  }
}
