import { CloudProvider } from "./CloudPlatform";

/*
 * The IaaS and PaaS resource types OneUptime recognises in the metrics a
 * cloud provider's monitoring API publishes - Azure Monitor, Amazon
 * CloudWatch and Google Cloud Monitoring - when an OpenTelemetry Collector
 * reads them (the `azure_monitor`, `aws_cloudwatch` / `awsfirehose` and
 * `googlecloudmonitoring` receivers) and exports them to OneUptime.
 *
 * Each of those metrics is about one resource the provider runs for you:
 * a virtual machine, a load balancer, a bucket, a database, a queue. This
 * catalog is how ingest tells which one (CloudMonitoredResource), and how
 * the dashboard and the docs name it. It is the single source of truth
 * for:
 *
 *   - which CloudWatch namespaces and Cloud Monitoring resource types can
 *     become a Cloud Resource at all, and which dimensions or labels
 *     identify one (Azure needs no rule: every Azure Monitor datapoint
 *     carries the resource's own ARM id);
 *   - the label, the service model (IaaS or PaaS) and the category a
 *     resource type is shown with;
 *   - the supported-resource table on the docs page, which a test holds
 *     equal to this file.
 *
 * Types are spelled the way the provider spells them, so they read the
 * same here as in the provider's own console and API:
 *
 *   - Azure: the Azure Resource Manager type, `Microsoft.Compute/virtualMachines`;
 *   - AWS: the CloudFormation resource type, `AWS::EC2::Instance`;
 *   - Google Cloud: the Cloud Monitoring monitored-resource type, `gce_instance`.
 *
 * The service model follows the usual split: compute, networking and
 * storage infrastructure you manage is IaaS; a managed runtime, database,
 * cache, queue or other service the provider runs is PaaS.
 */

export enum CloudServiceModel {
  IaaS = "iaas",
  PaaS = "paas",
}

export enum CloudResourceCategory {
  Compute = "compute",
  Containers = "containers",
  Serverless = "serverless",
  Web = "web",
  Networking = "networking",
  Storage = "storage",
  Database = "database",
  Messaging = "messaging",
  Integration = "integration",
  Analytics = "analytics",
  AI = "ai",
  Security = "security",
  Monitoring = "monitoring",
  Management = "management",
  IoT = "iot",
}

export const CLOUD_SERVICE_MODEL_LABELS: Readonly<
  Record<CloudServiceModel, string>
> = {
  [CloudServiceModel.IaaS]: "IaaS",
  [CloudServiceModel.PaaS]: "PaaS",
};

export const CLOUD_RESOURCE_CATEGORY_LABELS: Readonly<
  Record<CloudResourceCategory, string>
> = {
  [CloudResourceCategory.Compute]: "Compute",
  [CloudResourceCategory.Containers]: "Containers",
  [CloudResourceCategory.Serverless]: "Serverless",
  [CloudResourceCategory.Web]: "Web and API hosting",
  [CloudResourceCategory.Networking]: "Networking",
  [CloudResourceCategory.Storage]: "Storage",
  [CloudResourceCategory.Database]: "Databases and caches",
  [CloudResourceCategory.Messaging]: "Messaging and streaming",
  [CloudResourceCategory.Integration]: "Integration",
  [CloudResourceCategory.Analytics]: "Analytics",
  [CloudResourceCategory.AI]: "AI and machine learning",
  [CloudResourceCategory.Security]: "Security and identity",
  [CloudResourceCategory.Monitoring]: "Monitoring",
  [CloudResourceCategory.Management]: "Management",
  [CloudResourceCategory.IoT]: "IoT",
};

export interface CloudResourceTypeDescriptor {
  provider: CloudProvider;
  /*
   * The provider's own name for the type (see the header). This is what
   * CloudResource.cloudResourceType stores; lookups ignore case, because
   * Azure Monitor reports the same type as `Microsoft.ServiceBus/Namespaces`
   * on one receiver version and `Microsoft.ServiceBus/namespaces` on
   * another.
   */
  type: string;
  // What one resource of this type is called: "Virtual Machine".
  label: string;
  serviceModel: CloudServiceModel;
  category: CloudResourceCategory;
}

function descriptorOf(
  provider: CloudProvider,
  type: string,
  label: string,
  serviceModel: CloudServiceModel,
  category: CloudResourceCategory,
): CloudResourceTypeDescriptor {
  return { provider, type, label, serviceModel, category };
}

const IAAS: CloudServiceModel = CloudServiceModel.IaaS;
const PAAS: CloudServiceModel = CloudServiceModel.PaaS;
const C: typeof CloudResourceCategory = CloudResourceCategory;

/*
 * ---- Azure ---------------------------------------------------------------
 *
 * Azure needs no identity rule: the receiver stamps every datapoint with
 * the resource's ARM id (`azuremonitor.resource_id`), so EVERY resource it
 * reports is discovered, listed or not. This list only names the common
 * types; any other one is shown under its ARM type.
 */
function azure(
  type: string,
  label: string,
  serviceModel: CloudServiceModel,
  category: CloudResourceCategory,
): CloudResourceTypeDescriptor {
  return descriptorOf(CloudProvider.Azure, type, label, serviceModel, category);
}

export const AZURE_RESOURCE_TYPES: ReadonlyArray<CloudResourceTypeDescriptor> =
  [
    // Compute
    azure(
      "Microsoft.Compute/virtualMachines",
      "Virtual Machine",
      IAAS,
      C.Compute,
    ),
    azure(
      "Microsoft.Compute/virtualMachineScaleSets",
      "Virtual Machine Scale Set",
      IAAS,
      C.Compute,
    ),
    azure("Microsoft.Compute/disks", "Managed Disk", IAAS, C.Storage),
    // Networking
    azure(
      "Microsoft.Network/loadBalancers",
      "Load Balancer",
      IAAS,
      C.Networking,
    ),
    azure(
      "Microsoft.Network/applicationGateways",
      "Application Gateway",
      IAAS,
      C.Networking,
    ),
    azure(
      "Microsoft.Network/publicIPAddresses",
      "Public IP Address",
      IAAS,
      C.Networking,
    ),
    azure("Microsoft.Network/natGateways", "NAT Gateway", IAAS, C.Networking),
    azure(
      "Microsoft.Network/virtualNetworkGateways",
      "Virtual Network Gateway",
      IAAS,
      C.Networking,
    ),
    azure(
      "Microsoft.Network/expressRouteCircuits",
      "ExpressRoute Circuit",
      IAAS,
      C.Networking,
    ),
    azure(
      "Microsoft.Network/azureFirewalls",
      "Azure Firewall",
      IAAS,
      C.Networking,
    ),
    azure(
      "Microsoft.Network/frontdoors",
      "Front Door (classic)",
      IAAS,
      C.Networking,
    ),
    azure(
      "Microsoft.Cdn/profiles",
      "Front Door and CDN Profile",
      IAAS,
      C.Networking,
    ),
    azure(
      "Microsoft.Network/trafficmanagerprofiles",
      "Traffic Manager Profile",
      IAAS,
      C.Networking,
    ),
    azure(
      "Microsoft.Network/networkInterfaces",
      "Network Interface",
      IAAS,
      C.Networking,
    ),
    azure(
      "Microsoft.Network/virtualNetworks",
      "Virtual Network",
      IAAS,
      C.Networking,
    ),
    azure(
      "Microsoft.Network/privateEndpoints",
      "Private Endpoint",
      IAAS,
      C.Networking,
    ),
    azure("Microsoft.Network/dnszones", "DNS Zone", IAAS, C.Networking),
    azure("Microsoft.Network/bastionHosts", "Bastion", IAAS, C.Networking),
    // Storage
    azure(
      "Microsoft.Storage/storageAccounts",
      "Storage Account",
      IAAS,
      C.Storage,
    ),
    azure(
      "Microsoft.RecoveryServices/vaults",
      "Recovery Services Vault",
      PAAS,
      C.Storage,
    ),
    // App hosting and containers
    azure("Microsoft.Web/sites", "App Service or Function App", PAAS, C.Web),
    azure("Microsoft.Web/serverfarms", "App Service Plan", PAAS, C.Web),
    azure("Microsoft.Web/staticSites", "Static Web App", PAAS, C.Web),
    azure("Microsoft.App/containerApps", "Container App", PAAS, C.Containers),
    azure(
      "Microsoft.App/managedEnvironments",
      "Container Apps Environment",
      PAAS,
      C.Containers,
    ),
    azure(
      "Microsoft.ContainerInstance/containerGroups",
      "Container Instance",
      PAAS,
      C.Containers,
    ),
    azure(
      "Microsoft.ContainerService/managedClusters",
      "AKS Cluster",
      PAAS,
      C.Containers,
    ),
    azure(
      "Microsoft.ContainerRegistry/registries",
      "Container Registry",
      PAAS,
      C.Containers,
    ),
    azure("Microsoft.SignalRService/SignalR", "SignalR Service", PAAS, C.Web),
    // Databases and caches
    azure("Microsoft.Sql/servers/databases", "SQL Database", PAAS, C.Database),
    azure(
      "Microsoft.Sql/servers/elasticpools",
      "SQL Elastic Pool",
      PAAS,
      C.Database,
    ),
    azure(
      "Microsoft.Sql/managedInstances",
      "SQL Managed Instance",
      PAAS,
      C.Database,
    ),
    azure(
      "Microsoft.DBforPostgreSQL/flexibleServers",
      "PostgreSQL Flexible Server",
      PAAS,
      C.Database,
    ),
    azure(
      "Microsoft.DBforMySQL/flexibleServers",
      "MySQL Flexible Server",
      PAAS,
      C.Database,
    ),
    azure(
      "Microsoft.DocumentDB/databaseAccounts",
      "Cosmos DB Account",
      PAAS,
      C.Database,
    ),
    azure("Microsoft.Cache/redis", "Azure Cache for Redis", PAAS, C.Database),
    azure(
      "Microsoft.Cache/redisEnterprise",
      "Azure Managed Redis",
      PAAS,
      C.Database,
    ),
    // Messaging
    azure(
      "Microsoft.ServiceBus/namespaces",
      "Service Bus Namespace",
      PAAS,
      C.Messaging,
    ),
    azure(
      "Microsoft.EventHub/namespaces",
      "Event Hubs Namespace",
      PAAS,
      C.Messaging,
    ),
    azure("Microsoft.EventGrid/topics", "Event Grid Topic", PAAS, C.Messaging),
    azure(
      "Microsoft.EventGrid/systemTopics",
      "Event Grid System Topic",
      PAAS,
      C.Messaging,
    ),
    azure(
      "Microsoft.EventGrid/namespaces",
      "Event Grid Namespace",
      PAAS,
      C.Messaging,
    ),
    // Integration
    azure(
      "Microsoft.ApiManagement/service",
      "API Management",
      PAAS,
      C.Integration,
    ),
    azure("Microsoft.Logic/workflows", "Logic App", PAAS, C.Integration),
    azure(
      "Microsoft.DataFactory/factories",
      "Data Factory",
      PAAS,
      C.Integration,
    ),
    // Analytics
    azure(
      "Microsoft.Synapse/workspaces",
      "Synapse Workspace",
      PAAS,
      C.Analytics,
    ),
    azure(
      "Microsoft.Kusto/clusters",
      "Data Explorer Cluster",
      PAAS,
      C.Analytics,
    ),
    azure(
      "Microsoft.StreamAnalytics/streamingjobs",
      "Stream Analytics Job",
      PAAS,
      C.Analytics,
    ),
    // AI
    azure(
      "Microsoft.CognitiveServices/accounts",
      "Azure AI Services or OpenAI",
      PAAS,
      C.AI,
    ),
    azure("Microsoft.Search/searchServices", "AI Search Service", PAAS, C.AI),
    azure(
      "Microsoft.MachineLearningServices/workspaces",
      "Machine Learning Workspace",
      PAAS,
      C.AI,
    ),
    // Security, monitoring, management, IoT
    azure("Microsoft.KeyVault/vaults", "Key Vault", PAAS, C.Security),
    azure(
      "Microsoft.Insights/components",
      "Application Insights",
      PAAS,
      C.Monitoring,
    ),
    azure(
      "Microsoft.OperationalInsights/workspaces",
      "Log Analytics Workspace",
      PAAS,
      C.Monitoring,
    ),
    azure(
      "Microsoft.Automation/automationAccounts",
      "Automation Account",
      PAAS,
      C.Management,
    ),
    azure("Microsoft.Devices/IotHubs", "IoT Hub", PAAS, C.IoT),
  ];

/*
 * ---- AWS -----------------------------------------------------------------
 *
 * A CloudWatch metric names its resource in its dimensions, and which
 * dimension that is depends on the namespace (`InstanceId` in AWS/EC2,
 * `LoadBalancer` in AWS/ApplicationELB, `BucketName` in AWS/S3). A rule
 * below says which dimensions identify one resource of a namespace; a
 * datapoint is that resource's when it carries ALL of them (and none of
 * the rule's excluded ones). Extra dimensions narrow the series, not the
 * resource: an Application Load Balancer's per-target-group and per-zone
 * series are still that load balancer's.
 *
 * A datapoint that matches no rule names no resource of its own - an
 * account-wide total, or one aggregated over a dimension such as
 * `InstanceType` - and is not discovered. Neither is a namespace without a
 * rule: there is no reliable way to tell an identifying dimension from an
 * aggregating one without knowing the namespace.
 */
function aws(
  type: string,
  label: string,
  serviceModel: CloudServiceModel,
  category: CloudResourceCategory,
): CloudResourceTypeDescriptor {
  return descriptorOf(CloudProvider.AWS, type, label, serviceModel, category);
}

export const AWS_RESOURCE_TYPES: ReadonlyArray<CloudResourceTypeDescriptor> = [
  // Compute
  aws("AWS::EC2::Instance", "EC2 Instance", IAAS, C.Compute),
  aws(
    "AWS::AutoScaling::AutoScalingGroup",
    "Auto Scaling Group",
    IAAS,
    C.Compute,
  ),
  aws("AWS::EC2::Volume", "EBS Volume", IAAS, C.Storage),
  // Networking
  aws(
    "AWS::ElasticLoadBalancing::LoadBalancer",
    "Classic Load Balancer",
    IAAS,
    C.Networking,
  ),
  aws(
    "AWS::ElasticLoadBalancingV2::LoadBalancer",
    "Elastic Load Balancer (ALB, NLB, GWLB)",
    IAAS,
    C.Networking,
  ),
  aws("AWS::EC2::NatGateway", "NAT Gateway", IAAS, C.Networking),
  aws("AWS::EC2::TransitGateway", "Transit Gateway", IAAS, C.Networking),
  aws(
    "AWS::EC2::VPNConnection",
    "Site-to-Site VPN Connection",
    IAAS,
    C.Networking,
  ),
  aws(
    "AWS::DirectConnect::Connection",
    "Direct Connect Connection",
    IAAS,
    C.Networking,
  ),
  aws(
    "AWS::CloudFront::Distribution",
    "CloudFront Distribution",
    IAAS,
    C.Networking,
  ),
  aws(
    "AWS::GlobalAccelerator::Accelerator",
    "Global Accelerator",
    IAAS,
    C.Networking,
  ),
  aws("AWS::Route53::HealthCheck", "Route 53 Health Check", IAAS, C.Networking),
  aws("AWS::NetworkFirewall::Firewall", "Network Firewall", IAAS, C.Networking),
  // Storage
  aws("AWS::S3::Bucket", "S3 Bucket", IAAS, C.Storage),
  aws("AWS::EFS::FileSystem", "EFS File System", IAAS, C.Storage),
  aws("AWS::FSx::FileSystem", "FSx File System", IAAS, C.Storage),
  // Containers and app hosting
  aws("AWS::ECS::Cluster", "ECS Cluster", PAAS, C.Containers),
  aws("AWS::ECS::Service", "ECS Service", PAAS, C.Containers),
  aws("AWS::AppRunner::Service", "App Runner Service", PAAS, C.Web),
  aws(
    "AWS::ElasticBeanstalk::Environment",
    "Elastic Beanstalk Environment",
    PAAS,
    C.Web,
  ),
  // Serverless
  aws("AWS::Lambda::Function", "Lambda Function", PAAS, C.Serverless),
  aws(
    "AWS::StepFunctions::StateMachine",
    "Step Functions State Machine",
    PAAS,
    C.Integration,
  ),
  // Databases and caches
  aws("AWS::RDS::DBInstance", "RDS DB Instance", PAAS, C.Database),
  aws("AWS::RDS::DBCluster", "Aurora / RDS DB Cluster", PAAS, C.Database),
  aws("AWS::DocDB::DBInstance", "DocumentDB Instance", PAAS, C.Database),
  aws("AWS::DocDB::DBCluster", "DocumentDB Cluster", PAAS, C.Database),
  aws("AWS::Neptune::DBInstance", "Neptune Instance", PAAS, C.Database),
  aws("AWS::Neptune::DBCluster", "Neptune Cluster", PAAS, C.Database),
  aws("AWS::DynamoDB::Table", "DynamoDB Table", PAAS, C.Database),
  aws(
    "AWS::ElastiCache::CacheCluster",
    "ElastiCache Cluster",
    PAAS,
    C.Database,
  ),
  aws(
    "AWS::ElastiCache::ReplicationGroup",
    "ElastiCache Replication Group",
    PAAS,
    C.Database,
  ),
  aws(
    "AWS::ElastiCache::ServerlessCache",
    "ElastiCache Serverless Cache",
    PAAS,
    C.Database,
  ),
  aws("AWS::MemoryDB::Cluster", "MemoryDB Cluster", PAAS, C.Database),
  aws("AWS::Redshift::Cluster", "Redshift Cluster", PAAS, C.Analytics),
  aws("AWS::OpenSearchService::Domain", "OpenSearch Domain", PAAS, C.Analytics),
  // Messaging and streaming
  aws("AWS::SQS::Queue", "SQS Queue", PAAS, C.Messaging),
  aws("AWS::SNS::Topic", "SNS Topic", PAAS, C.Messaging),
  aws("AWS::Kinesis::Stream", "Kinesis Data Stream", PAAS, C.Messaging),
  aws(
    "AWS::KinesisFirehose::DeliveryStream",
    "Data Firehose Stream",
    PAAS,
    C.Messaging,
  ),
  aws("AWS::AmazonMQ::Broker", "Amazon MQ Broker", PAAS, C.Messaging),
  aws("AWS::MSK::Cluster", "MSK Cluster", PAAS, C.Messaging),
  aws("AWS::Events::Rule", "EventBridge Rule", PAAS, C.Integration),
  // Integration
  aws("AWS::ApiGateway::RestApi", "API Gateway REST API", PAAS, C.Integration),
  aws(
    "AWS::ApiGatewayV2::Api",
    "API Gateway HTTP or WebSocket API",
    PAAS,
    C.Integration,
  ),
  aws("AWS::AppSync::GraphQLApi", "AppSync GraphQL API", PAAS, C.Integration),
  // Security, AI, monitoring
  aws("AWS::WAFv2::WebACL", "WAF Web ACL", PAAS, C.Security),
  aws(
    "AWS::CertificateManager::Certificate",
    "ACM Certificate",
    PAAS,
    C.Security,
  ),
  aws("AWS::KMS::Key", "KMS Key", PAAS, C.Security),
  aws("AWS::Cognito::UserPool", "Cognito User Pool", PAAS, C.Security),
  aws("AWS::SageMaker::Endpoint", "SageMaker Endpoint", PAAS, C.AI),
  aws("AWS::Logs::LogGroup", "CloudWatch Log Group", PAAS, C.Monitoring),
];

// What an ARN is built from. Every part as the datapoint reported it.
export interface AwsArnContext {
  partition: string;
  region: string;
  accountId: string;
  dimensions: Readonly<Record<string, string>>;
}

export interface AwsCloudWatchResourceRule {
  // The CloudWatch namespace, as CloudWatch spells it: "AWS/EC2".
  namespace: string;
  // The resource type the rule discovers - one of AWS_RESOURCE_TYPES.
  type: string;
  // Every one must be on the datapoint for it to be this resource's.
  identityDimensions: ReadonlyArray<string>;
  // The rule does not apply to a datapoint carrying any of these.
  excludedDimensions?: ReadonlyArray<string>;
  /*
   * The resource's name, from its identity dimensions. Default: the first
   * identity dimension's value.
   */
  getName?: (dimensions: Readonly<Record<string, string>>) => string;
  /*
   * The resource's ARN, when its identity dimensions name it completely -
   * or null, when they do not (an App Runner service's ARN carries an id
   * only some of its metrics report). A rule without it has no ARN at all
   * (an Auto Scaling group's ARN carries a UUID no metric reports).
   */
  getArn?: (context: AwsArnContext) => string | null;
  /*
   * What getArn needs besides the dimensions: the region and the account
   * id (the default), the region only ("regional": an HTTP API's ARN has
   * no account), the account only ("account-global": CloudFront, Global
   * Accelerator) or neither ("global": an S3 bucket, or a dimension that
   * already is the ARN). The account id is missing whenever the pull
   * receiver may not call sts:GetCallerIdentity; getArn is only asked when
   * every part it needs is known.
   */
  arnScope?: "regional" | "global" | "account-global";
}

function arn(
  context: AwsArnContext,
  service: string,
  resource: string,
): string {
  return `arn:${context.partition}:${service}:${context.region}:${context.accountId}:${resource}`;
}

// `app/checkout/50dc6c495c0c9188` → `checkout`.
function elbV2Name(value: string): string {
  const parts: Array<string> = value.split("/");
  return parts.length === 3 && parts[1] ? parts[1] : value;
}

// `arn:aws:states:us-east-1:123456789012:stateMachine:Orders` → `Orders`.
function arnTail(value: string): string {
  const colon: number = value.lastIndexOf(":");
  const slash: number = value.lastIndexOf("/");
  const cut: number = Math.max(colon, slash);
  return cut >= 0 && cut < value.length - 1 ? value.slice(cut + 1) : value;
}

function dimension(
  dimensions: Readonly<Record<string, string>>,
  key: string,
): string {
  return dimensions[key] || "";
}

export const AWS_CLOUDWATCH_RESOURCE_RULES: ReadonlyArray<AwsCloudWatchResourceRule> =
  [
    {
      namespace: "AWS/EC2",
      type: "AWS::EC2::Instance",
      identityDimensions: ["InstanceId"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "ec2",
          `instance/${dimension(context.dimensions, "InstanceId")}`,
        );
      },
    },
    {
      // EC2's per-group aggregate is the group's, not any one instance's.
      namespace: "AWS/EC2",
      type: "AWS::AutoScaling::AutoScalingGroup",
      identityDimensions: ["AutoScalingGroupName"],
      excludedDimensions: ["InstanceId"],
    },
    {
      namespace: "AWS/AutoScaling",
      type: "AWS::AutoScaling::AutoScalingGroup",
      identityDimensions: ["AutoScalingGroupName"],
    },
    {
      namespace: "AWS/EBS",
      type: "AWS::EC2::Volume",
      identityDimensions: ["VolumeId"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "ec2",
          `volume/${dimension(context.dimensions, "VolumeId")}`,
        );
      },
    },
    {
      namespace: "AWS/ELB",
      type: "AWS::ElasticLoadBalancing::LoadBalancer",
      identityDimensions: ["LoadBalancerName"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "elasticloadbalancing",
          `loadbalancer/${dimension(context.dimensions, "LoadBalancerName")}`,
        );
      },
    },
    ...["AWS/ApplicationELB", "AWS/NetworkELB", "AWS/GatewayELB"].map(
      (namespace: string): AwsCloudWatchResourceRule => {
        return {
          namespace: namespace,
          type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
          identityDimensions: ["LoadBalancer"],
          getName: (dimensions: Readonly<Record<string, string>>): string => {
            return elbV2Name(dimension(dimensions, "LoadBalancer"));
          },
          getArn: (context: AwsArnContext): string => {
            return arn(
              context,
              "elasticloadbalancing",
              `loadbalancer/${dimension(context.dimensions, "LoadBalancer")}`,
            );
          },
        };
      },
    ),
    {
      namespace: "AWS/NATGateway",
      type: "AWS::EC2::NatGateway",
      identityDimensions: ["NatGatewayId"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "ec2",
          `natgateway/${dimension(context.dimensions, "NatGatewayId")}`,
        );
      },
    },
    {
      namespace: "AWS/TransitGateway",
      type: "AWS::EC2::TransitGateway",
      identityDimensions: ["TransitGateway"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "ec2",
          `transit-gateway/${dimension(context.dimensions, "TransitGateway")}`,
        );
      },
    },
    {
      namespace: "AWS/VPN",
      type: "AWS::EC2::VPNConnection",
      identityDimensions: ["VpnId"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "ec2",
          `vpn-connection/${dimension(context.dimensions, "VpnId")}`,
        );
      },
    },
    {
      namespace: "AWS/DX",
      type: "AWS::DirectConnect::Connection",
      identityDimensions: ["ConnectionId"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "directconnect",
          `dxcon/${dimension(context.dimensions, "ConnectionId")}`,
        );
      },
    },
    {
      namespace: "AWS/CloudFront",
      type: "AWS::CloudFront::Distribution",
      identityDimensions: ["DistributionId"],
      arnScope: "account-global",
      getArn: (context: AwsArnContext): string => {
        return `arn:${context.partition}:cloudfront::${context.accountId}:distribution/${dimension(
          context.dimensions,
          "DistributionId",
        )}`;
      },
    },
    {
      namespace: "AWS/GlobalAccelerator",
      type: "AWS::GlobalAccelerator::Accelerator",
      identityDimensions: ["Accelerator"],
      excludedDimensions: ["Listener", "EndpointGroup"],
      arnScope: "account-global",
      getArn: (context: AwsArnContext): string => {
        return `arn:${context.partition}:globalaccelerator::${context.accountId}:accelerator/${dimension(
          context.dimensions,
          "Accelerator",
        )}`;
      },
    },
    {
      namespace: "AWS/Route53",
      type: "AWS::Route53::HealthCheck",
      identityDimensions: ["HealthCheckId"],
      arnScope: "global",
      getArn: (context: AwsArnContext): string => {
        return `arn:${context.partition}:route53:::healthcheck/${dimension(
          context.dimensions,
          "HealthCheckId",
        )}`;
      },
    },
    {
      namespace: "AWS/NetworkFirewall",
      type: "AWS::NetworkFirewall::Firewall",
      identityDimensions: ["FirewallName"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "network-firewall",
          `firewall/${dimension(context.dimensions, "FirewallName")}`,
        );
      },
    },
    {
      // A Web ACL's ARN carries an id no metric reports.
      namespace: "AWS/WAFV2",
      type: "AWS::WAFv2::WebACL",
      identityDimensions: ["WebACL"],
      excludedDimensions: ["Rule", "RuleGroup"],
    },
    {
      namespace: "AWS/S3",
      type: "AWS::S3::Bucket",
      identityDimensions: ["BucketName"],
      arnScope: "global",
      getArn: (context: AwsArnContext): string => {
        return `arn:${context.partition}:s3:::${dimension(
          context.dimensions,
          "BucketName",
        )}`;
      },
    },
    {
      namespace: "AWS/EFS",
      type: "AWS::EFS::FileSystem",
      identityDimensions: ["FileSystemId"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "elasticfilesystem",
          `file-system/${dimension(context.dimensions, "FileSystemId")}`,
        );
      },
    },
    {
      namespace: "AWS/FSx",
      type: "AWS::FSx::FileSystem",
      identityDimensions: ["FileSystemId"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "fsx",
          `file-system/${dimension(context.dimensions, "FileSystemId")}`,
        );
      },
    },
    {
      namespace: "AWS/ECS",
      type: "AWS::ECS::Service",
      identityDimensions: ["ClusterName", "ServiceName"],
      getName: (dimensions: Readonly<Record<string, string>>): string => {
        return `${dimension(dimensions, "ServiceName")} (${dimension(
          dimensions,
          "ClusterName",
        )})`;
      },
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "ecs",
          `service/${dimension(context.dimensions, "ClusterName")}/${dimension(
            context.dimensions,
            "ServiceName",
          )}`,
        );
      },
    },
    {
      namespace: "AWS/ECS",
      type: "AWS::ECS::Cluster",
      identityDimensions: ["ClusterName"],
      excludedDimensions: ["ServiceName"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "ecs",
          `cluster/${dimension(context.dimensions, "ClusterName")}`,
        );
      },
    },
    {
      namespace: "AWS/AppRunner",
      type: "AWS::AppRunner::Service",
      identityDimensions: ["ServiceName"],
      getArn: (context: AwsArnContext): string | null => {
        // The ARN carries the service id, reported only on some metrics.
        const serviceId: string = dimension(context.dimensions, "ServiceID");
        return serviceId
          ? arn(
              context,
              "apprunner",
              `service/${dimension(context.dimensions, "ServiceName")}/${serviceId}`,
            )
          : null;
      },
    },
    {
      namespace: "AWS/ElasticBeanstalk",
      type: "AWS::ElasticBeanstalk::Environment",
      identityDimensions: ["EnvironmentName"],
    },
    {
      namespace: "AWS/Lambda",
      type: "AWS::Lambda::Function",
      identityDimensions: ["FunctionName"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "lambda",
          `function:${dimension(context.dimensions, "FunctionName")}`,
        );
      },
    },
    {
      // The dimension is the state machine's ARN.
      namespace: "AWS/States",
      type: "AWS::StepFunctions::StateMachine",
      identityDimensions: ["StateMachineArn"],
      getName: (dimensions: Readonly<Record<string, string>>): string => {
        return arnTail(dimension(dimensions, "StateMachineArn"));
      },
      arnScope: "global",
      getArn: (context: AwsArnContext): string => {
        return dimension(context.dimensions, "StateMachineArn");
      },
    },
    {
      namespace: "AWS/RDS",
      type: "AWS::RDS::DBInstance",
      identityDimensions: ["DBInstanceIdentifier"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "rds",
          `db:${dimension(context.dimensions, "DBInstanceIdentifier")}`,
        );
      },
    },
    {
      namespace: "AWS/RDS",
      type: "AWS::RDS::DBCluster",
      identityDimensions: ["DBClusterIdentifier"],
      excludedDimensions: ["DBInstanceIdentifier"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "rds",
          `cluster:${dimension(context.dimensions, "DBClusterIdentifier")}`,
        );
      },
    },
    {
      namespace: "AWS/DocDB",
      type: "AWS::DocDB::DBInstance",
      identityDimensions: ["DBInstanceIdentifier"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "rds",
          `db:${dimension(context.dimensions, "DBInstanceIdentifier")}`,
        );
      },
    },
    {
      namespace: "AWS/DocDB",
      type: "AWS::DocDB::DBCluster",
      identityDimensions: ["DBClusterIdentifier"],
      excludedDimensions: ["DBInstanceIdentifier"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "rds",
          `cluster:${dimension(context.dimensions, "DBClusterIdentifier")}`,
        );
      },
    },
    {
      namespace: "AWS/Neptune",
      type: "AWS::Neptune::DBInstance",
      identityDimensions: ["DBInstanceIdentifier"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "rds",
          `db:${dimension(context.dimensions, "DBInstanceIdentifier")}`,
        );
      },
    },
    {
      namespace: "AWS/Neptune",
      type: "AWS::Neptune::DBCluster",
      identityDimensions: ["DBClusterIdentifier"],
      excludedDimensions: ["DBInstanceIdentifier"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "rds",
          `cluster:${dimension(context.dimensions, "DBClusterIdentifier")}`,
        );
      },
    },
    {
      namespace: "AWS/DynamoDB",
      type: "AWS::DynamoDB::Table",
      identityDimensions: ["TableName"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "dynamodb",
          `table/${dimension(context.dimensions, "TableName")}`,
        );
      },
    },
    {
      namespace: "AWS/ElastiCache",
      type: "AWS::ElastiCache::CacheCluster",
      identityDimensions: ["CacheClusterId"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "elasticache",
          `cluster:${dimension(context.dimensions, "CacheClusterId")}`,
        );
      },
    },
    {
      namespace: "AWS/ElastiCache",
      type: "AWS::ElastiCache::ReplicationGroup",
      identityDimensions: ["ReplicationGroupId"],
      excludedDimensions: ["CacheClusterId"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "elasticache",
          `replicationgroup:${dimension(context.dimensions, "ReplicationGroupId")}`,
        );
      },
    },
    {
      // Serverless caches use `clusterId`, node-based clusters `CacheClusterId`.
      namespace: "AWS/ElastiCache",
      type: "AWS::ElastiCache::ServerlessCache",
      identityDimensions: ["clusterId"],
      excludedDimensions: ["CacheClusterId"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "elasticache",
          `serverlesscache:${dimension(context.dimensions, "clusterId")}`,
        );
      },
    },
    {
      namespace: "AWS/MemoryDB",
      type: "AWS::MemoryDB::Cluster",
      identityDimensions: ["ClusterName"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "memorydb",
          `cluster/${dimension(context.dimensions, "ClusterName")}`,
        );
      },
    },
    {
      namespace: "AWS/Redshift",
      type: "AWS::Redshift::Cluster",
      identityDimensions: ["ClusterIdentifier"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "redshift",
          `cluster:${dimension(context.dimensions, "ClusterIdentifier")}`,
        );
      },
    },
    {
      namespace: "AWS/ES",
      type: "AWS::OpenSearchService::Domain",
      identityDimensions: ["DomainName"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "es",
          `domain/${dimension(context.dimensions, "DomainName")}`,
        );
      },
    },
    {
      namespace: "AWS/SQS",
      type: "AWS::SQS::Queue",
      identityDimensions: ["QueueName"],
      getArn: (context: AwsArnContext): string => {
        return arn(context, "sqs", dimension(context.dimensions, "QueueName"));
      },
    },
    {
      namespace: "AWS/SNS",
      type: "AWS::SNS::Topic",
      identityDimensions: ["TopicName"],
      getArn: (context: AwsArnContext): string => {
        return arn(context, "sns", dimension(context.dimensions, "TopicName"));
      },
    },
    {
      namespace: "AWS/Kinesis",
      type: "AWS::Kinesis::Stream",
      identityDimensions: ["StreamName"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "kinesis",
          `stream/${dimension(context.dimensions, "StreamName")}`,
        );
      },
    },
    {
      namespace: "AWS/Firehose",
      type: "AWS::KinesisFirehose::DeliveryStream",
      identityDimensions: ["DeliveryStreamName"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "firehose",
          `deliverystream/${dimension(context.dimensions, "DeliveryStreamName")}`,
        );
      },
    },
    {
      // A broker's ARN carries its id; the metrics name it.
      namespace: "AWS/AmazonMQ",
      type: "AWS::AmazonMQ::Broker",
      identityDimensions: ["Broker"],
    },
    {
      // A cluster's ARN carries a UUID; the metrics name it.
      namespace: "AWS/Kafka",
      type: "AWS::MSK::Cluster",
      identityDimensions: ["Cluster Name"],
    },
    {
      namespace: "AWS/Events",
      type: "AWS::Events::Rule",
      identityDimensions: ["RuleName"],
      getArn: (context: AwsArnContext): string => {
        const bus: string = dimension(context.dimensions, "EventBusName");
        const rule: string = dimension(context.dimensions, "RuleName");
        return arn(
          context,
          "events",
          bus && bus !== "default" ? `rule/${bus}/${rule}` : `rule/${rule}`,
        );
      },
    },
    {
      // REST APIs are named in their metrics; the ARN needs the API id.
      namespace: "AWS/ApiGateway",
      type: "AWS::ApiGateway::RestApi",
      identityDimensions: ["ApiName"],
    },
    {
      namespace: "AWS/ApiGateway",
      type: "AWS::ApiGatewayV2::Api",
      identityDimensions: ["ApiId"],
      excludedDimensions: ["ApiName"],
      arnScope: "regional",
      getArn: (context: AwsArnContext): string => {
        return `arn:${context.partition}:apigateway:${context.region}::/apis/${dimension(
          context.dimensions,
          "ApiId",
        )}`;
      },
    },
    {
      namespace: "AWS/AppSync",
      type: "AWS::AppSync::GraphQLApi",
      identityDimensions: ["GraphQLAPIId"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "appsync",
          `apis/${dimension(context.dimensions, "GraphQLAPIId")}`,
        );
      },
    },
    {
      // The dimension is the certificate's ARN.
      namespace: "AWS/CertificateManager",
      type: "AWS::CertificateManager::Certificate",
      identityDimensions: ["CertificateArn"],
      getName: (dimensions: Readonly<Record<string, string>>): string => {
        return arnTail(dimension(dimensions, "CertificateArn"));
      },
      arnScope: "global",
      getArn: (context: AwsArnContext): string => {
        return dimension(context.dimensions, "CertificateArn");
      },
    },
    {
      namespace: "AWS/KMS",
      type: "AWS::KMS::Key",
      identityDimensions: ["KeyId"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "kms",
          `key/${dimension(context.dimensions, "KeyId")}`,
        );
      },
    },
    {
      namespace: "AWS/Cognito",
      type: "AWS::Cognito::UserPool",
      identityDimensions: ["UserPool"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "cognito-idp",
          `userpool/${dimension(context.dimensions, "UserPool")}`,
        );
      },
    },
    {
      namespace: "AWS/SageMaker",
      type: "AWS::SageMaker::Endpoint",
      identityDimensions: ["EndpointName"],
      getArn: (context: AwsArnContext): string => {
        // SageMaker ARNs spell the endpoint name in lower case.
        return arn(
          context,
          "sagemaker",
          `endpoint/${dimension(context.dimensions, "EndpointName").toLowerCase()}`,
        );
      },
    },
    {
      namespace: "AWS/Logs",
      type: "AWS::Logs::LogGroup",
      identityDimensions: ["LogGroupName"],
      getArn: (context: AwsArnContext): string => {
        return arn(
          context,
          "logs",
          `log-group:${dimension(context.dimensions, "LogGroupName")}`,
        );
      },
    },
  ];

/*
 * The partition an AWS region belongs to, for the ARN: China and GovCloud
 * regions have partitions of their own.
 */
export function getAwsPartitionForRegion(region: string): string {
  const value: string = region.trim().toLowerCase();
  if (value.startsWith("cn-")) {
    return "aws-cn";
  }
  if (value.startsWith("us-gov-")) {
    return "aws-us-gov";
  }
  return "aws";
}

/*
 * ---- Google Cloud --------------------------------------------------------
 *
 * The `googlecloudmonitoring` receiver puts the monitored resource's type
 * in `gcp.resource_type` and its labels, as reported, on the resource. A
 * monitored resource is identified by its type and labels together; the
 * rule names which labels identify ONE resource of its type, because the
 * receiver also merges the resource's metadata labels (its system labels
 * and your own) into the same set, and those must not split it.
 *
 * Kubernetes types (`k8s_container`, `k8s_pod`, ...) have no rule: the
 * Kubernetes product owns those.
 */
export interface GcpMonitoredResourceRule extends CloudResourceTypeDescriptor {
  // Every one must be present and non-empty.
  identityLabels: ReadonlyArray<string>;
  // The label holding the project, or project container. Default `project_id`.
  accountLabel?: string;
  /*
   * The label holding the resource's location: a zone (`us-central1-a`,
   * stored as its region), a region, or a multi-region location.
   */
  locationLabel?: string;
  getName: (labels: Readonly<Record<string, string>>) => string;
  // The resource's full resource name, as Cloud Asset Inventory writes it.
  getFullResourceName?: (
    labels: Readonly<Record<string, string>>,
  ) => string | null;
}

function label(labels: Readonly<Record<string, string>>, key: string): string {
  return labels[key] || "";
}

// "projects/123" or "123" → "123".
function projectFromContainer(value: string): string {
  return value.startsWith("projects/")
    ? value.slice("projects/".length)
    : value;
}

// The last segment of a slash-separated path.
function lastSegment(value: string): string {
  const slash: number = value.lastIndexOf("/");
  return slash >= 0 && slash < value.length - 1
    ? value.slice(slash + 1)
    : value;
}

function gcp(
  data: Omit<GcpMonitoredResourceRule, "provider">,
): GcpMonitoredResourceRule {
  return { provider: CloudProvider.GCP, ...data };
}

export const GCP_MONITORED_RESOURCE_RULES: ReadonlyArray<GcpMonitoredResourceRule> =
  [
    gcp({
      type: "gce_instance",
      label: "Compute Engine VM Instance",
      serviceModel: IAAS,
      category: C.Compute,
      identityLabels: ["project_id", "zone", "instance_id"],
      locationLabel: "zone",
      // The `name` system label, when the receiver carries the metadata.
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "name") || label(labels, "instance_id");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//compute.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/zones/${label(labels, "zone")}/instances/${
          label(labels, "name") || label(labels, "instance_id")
        }`;
      },
    }),
    gcp({
      type: "instance_group",
      label: "Instance Group",
      serviceModel: IAAS,
      category: C.Compute,
      identityLabels: ["project_id", "location", "instance_group_id"],
      locationLabel: "location",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return (
          label(labels, "instance_group_name") ||
          label(labels, "instance_group_id")
        );
      },
    }),
    gcp({
      type: "gcs_bucket",
      label: "Cloud Storage Bucket",
      serviceModel: IAAS,
      category: C.Storage,
      identityLabels: ["project_id", "bucket_name"],
      locationLabel: "location",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "bucket_name");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//storage.googleapis.com/projects/_/buckets/${label(
          labels,
          "bucket_name",
        )}`;
      },
    }),
    gcp({
      type: "filestore_instance",
      label: "Filestore Instance",
      serviceModel: IAAS,
      category: C.Storage,
      identityLabels: ["project_id", "location", "instance_name"],
      locationLabel: "location",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "instance_name");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//file.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/locations/${label(labels, "location")}/instances/${label(
          labels,
          "instance_name",
        )}`;
      },
    }),
    gcp({
      type: "https_lb_rule",
      label: "External Application Load Balancer",
      serviceModel: IAAS,
      category: C.Networking,
      // One URL map is one load balancer, whichever rule a series is on.
      identityLabels: ["project_id", "url_map_name"],
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "url_map_name");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//compute.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/global/urlMaps/${label(labels, "url_map_name")}`;
      },
    }),
    gcp({
      type: "internal_http_lb_rule",
      label: "Internal Application Load Balancer",
      serviceModel: IAAS,
      category: C.Networking,
      identityLabels: ["project_id", "region", "url_map_name"],
      locationLabel: "region",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "url_map_name");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//compute.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/regions/${label(labels, "region")}/urlMaps/${label(
          labels,
          "url_map_name",
        )}`;
      },
    }),
    gcp({
      type: "vpn_gateway",
      label: "Cloud VPN Gateway",
      serviceModel: IAAS,
      category: C.Networking,
      identityLabels: ["project_id", "region", "gateway_id"],
      locationLabel: "region",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "gateway_id");
      },
    }),
    gcp({
      type: "nat_gateway",
      label: "Cloud NAT Gateway",
      serviceModel: IAAS,
      category: C.Networking,
      identityLabels: ["project_id", "region", "router_id", "gateway_name"],
      locationLabel: "region",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "gateway_name");
      },
    }),
    gcp({
      type: "gce_router",
      label: "Cloud Router",
      serviceModel: IAAS,
      category: C.Networking,
      identityLabels: ["project_id", "region", "router_id"],
      locationLabel: "region",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "router_id");
      },
    }),
    gcp({
      // `database_id` is "project:instance".
      type: "cloudsql_database",
      label: "Cloud SQL Instance",
      serviceModel: PAAS,
      category: C.Database,
      identityLabels: ["project_id", "database_id"],
      locationLabel: "region",
      getName: (labels: Readonly<Record<string, string>>): string => {
        const id: string = label(labels, "database_id");
        const colon: number = id.lastIndexOf(":");
        return colon >= 0 && colon < id.length - 1 ? id.slice(colon + 1) : id;
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string | null => {
        const id: string = label(labels, "database_id");
        const colon: number = id.lastIndexOf(":");
        if (colon <= 0 || colon === id.length - 1) {
          return null;
        }
        return `//cloudsql.googleapis.com/projects/${id.slice(
          0,
          colon,
        )}/instances/${id.slice(colon + 1)}`;
      },
    }),
    gcp({
      type: "alloydb.googleapis.com/Instance",
      label: "AlloyDB Instance",
      serviceModel: PAAS,
      category: C.Database,
      identityLabels: [
        "resource_container",
        "location",
        "cluster_id",
        "instance_id",
      ],
      accountLabel: "resource_container",
      locationLabel: "location",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return `${label(labels, "instance_id")} (${label(labels, "cluster_id")})`;
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//alloydb.googleapis.com/projects/${projectFromContainer(
          label(labels, "resource_container"),
        )}/locations/${label(labels, "location")}/clusters/${label(
          labels,
          "cluster_id",
        )}/instances/${label(labels, "instance_id")}`;
      },
    }),
    gcp({
      // `instance_id` is "projects/P/locations/R/instances/NAME".
      type: "redis_instance",
      label: "Memorystore for Redis Instance",
      serviceModel: PAAS,
      category: C.Database,
      identityLabels: ["project_id", "region", "instance_id"],
      locationLabel: "region",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return lastSegment(label(labels, "instance_id"));
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string | null => {
        const id: string = label(labels, "instance_id");
        return id.startsWith("projects/")
          ? `//redis.googleapis.com/${id}`
          : null;
      },
    }),
    gcp({
      type: "spanner_instance",
      label: "Spanner Instance",
      serviceModel: PAAS,
      category: C.Database,
      identityLabels: ["project_id", "instance_id"],
      locationLabel: "location",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "instance_id");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//spanner.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/instances/${label(labels, "instance_id")}`;
      },
    }),
    gcp({
      // One instance, whichever cluster or table a series is on.
      type: "bigtable_table",
      label: "Bigtable Instance",
      serviceModel: PAAS,
      category: C.Database,
      identityLabels: ["project_id", "instance"],
      locationLabel: "zone",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "instance");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//bigtableadmin.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/instances/${label(labels, "instance")}`;
      },
    }),
    gcp({
      type: "bigquery_dataset",
      label: "BigQuery Dataset",
      serviceModel: PAAS,
      category: C.Analytics,
      identityLabels: ["project_id", "dataset_id"],
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "dataset_id");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//bigquery.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/datasets/${label(labels, "dataset_id")}`;
      },
    }),
    gcp({
      type: "cloud_function",
      label: "Cloud Run Function",
      serviceModel: PAAS,
      category: C.Serverless,
      identityLabels: ["project_id", "region", "function_name"],
      locationLabel: "region",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "function_name");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//cloudfunctions.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/locations/${label(labels, "region")}/functions/${label(
          labels,
          "function_name",
        )}`;
      },
    }),
    gcp({
      // One service, whichever revision a series is on.
      type: "cloud_run_revision",
      label: "Cloud Run Service",
      serviceModel: PAAS,
      category: C.Serverless,
      identityLabels: ["project_id", "location", "service_name"],
      locationLabel: "location",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "service_name");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//run.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/locations/${label(labels, "location")}/services/${label(
          labels,
          "service_name",
        )}`;
      },
    }),
    gcp({
      type: "cloud_run_job",
      label: "Cloud Run Job",
      serviceModel: PAAS,
      category: C.Serverless,
      identityLabels: ["project_id", "location", "job_name"],
      locationLabel: "location",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "job_name");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//run.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/locations/${label(labels, "location")}/jobs/${label(
          labels,
          "job_name",
        )}`;
      },
    }),
    gcp({
      // One service, whichever version a series is on.
      type: "gae_app",
      label: "App Engine Service",
      serviceModel: PAAS,
      category: C.Web,
      identityLabels: ["project_id", "module_id"],
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "module_id");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//appengine.googleapis.com/apps/${label(
          labels,
          "project_id",
        )}/services/${label(labels, "module_id")}`;
      },
    }),
    gcp({
      type: "pubsub_topic",
      label: "Pub/Sub Topic",
      serviceModel: PAAS,
      category: C.Messaging,
      identityLabels: ["project_id", "topic_id"],
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "topic_id");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//pubsub.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/topics/${label(labels, "topic_id")}`;
      },
    }),
    gcp({
      type: "pubsub_subscription",
      label: "Pub/Sub Subscription",
      serviceModel: PAAS,
      category: C.Messaging,
      identityLabels: ["project_id", "subscription_id"],
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "subscription_id");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//pubsub.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/subscriptions/${label(labels, "subscription_id")}`;
      },
    }),
    gcp({
      type: "cloud_tasks_queue",
      label: "Cloud Tasks Queue",
      serviceModel: PAAS,
      category: C.Messaging,
      identityLabels: ["project_id", "location", "queue_id"],
      locationLabel: "location",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "queue_id");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//cloudtasks.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/locations/${label(labels, "location")}/queues/${label(
          labels,
          "queue_id",
        )}`;
      },
    }),
    gcp({
      type: "cloud_composer_environment",
      label: "Cloud Composer Environment",
      serviceModel: PAAS,
      category: C.Integration,
      identityLabels: ["project_id", "location", "environment_name"],
      locationLabel: "location",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "environment_name");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//composer.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/locations/${label(labels, "location")}/environments/${label(
          labels,
          "environment_name",
        )}`;
      },
    }),
    gcp({
      type: "dataproc_cluster",
      label: "Dataproc Cluster",
      serviceModel: PAAS,
      category: C.Analytics,
      identityLabels: ["project_id", "region", "cluster_name"],
      locationLabel: "region",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "cluster_name");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//dataproc.googleapis.com/projects/${label(
          labels,
          "project_id",
        )}/regions/${label(labels, "region")}/clusters/${label(
          labels,
          "cluster_name",
        )}`;
      },
    }),
    gcp({
      type: "aiplatform.googleapis.com/Endpoint",
      label: "Vertex AI Endpoint",
      serviceModel: PAAS,
      category: C.AI,
      identityLabels: ["resource_container", "location", "endpoint_id"],
      accountLabel: "resource_container",
      locationLabel: "location",
      getName: (labels: Readonly<Record<string, string>>): string => {
        return label(labels, "endpoint_id");
      },
      getFullResourceName: (
        labels: Readonly<Record<string, string>>,
      ): string => {
        return `//aiplatform.googleapis.com/projects/${projectFromContainer(
          label(labels, "resource_container"),
        )}/locations/${label(labels, "location")}/endpoints/${label(
          labels,
          "endpoint_id",
        )}`;
      },
    }),
  ];

/*
 * ---- Lookups -------------------------------------------------------------
 */

export const CLOUD_RESOURCE_TYPES: ReadonlyArray<CloudResourceTypeDescriptor> =
  [
    ...AZURE_RESOURCE_TYPES,
    ...AWS_RESOURCE_TYPES,
    ...GCP_MONITORED_RESOURCE_RULES,
  ];

function typeLookupKey(provider: string, type: string): string {
  return `${provider.trim().toLowerCase()}|${type.trim().toLowerCase()}`;
}

const DESCRIPTORS_BY_TYPE: ReadonlyMap<string, CloudResourceTypeDescriptor> =
  new Map(
    CLOUD_RESOURCE_TYPES.map(
      (
        descriptor: CloudResourceTypeDescriptor,
      ): [string, CloudResourceTypeDescriptor] => {
        return [
          typeLookupKey(descriptor.provider, descriptor.type),
          descriptor,
        ];
      },
    ),
  );

/*
 * The descriptor of a resource type, whatever case it is spelled in, or
 * null for a type the catalog does not list (an Azure type it has no
 * label for).
 */
export function getCloudResourceTypeDescriptor(
  provider: string | null | undefined,
  type: string | null | undefined,
): CloudResourceTypeDescriptor | null {
  if (!provider || !type) {
    return null;
  }
  return DESCRIPTORS_BY_TYPE.get(typeLookupKey(provider, type)) || null;
}

/*
 * What to call a resource of this type: the catalog's label, or - for a
 * type the catalog does not list - the type itself, so nothing renders
 * blank.
 */
export function getCloudResourceTypeLabel(
  provider: string | null | undefined,
  type: string | null | undefined,
): string {
  const descriptor: CloudResourceTypeDescriptor | null =
    getCloudResourceTypeDescriptor(provider, type);
  return descriptor ? descriptor.label : (type || "").trim();
}

/*
 * The type spelled the way the catalog spells it - Azure Monitor's
 * `Microsoft.ServiceBus/Namespaces` becomes `Microsoft.ServiceBus/namespaces`
 * - so one resource type is stored and filtered under one spelling. A type
 * the catalog does not list is returned as it came.
 */
export function getCanonicalCloudResourceType(
  provider: string,
  type: string,
): string {
  const descriptor: CloudResourceTypeDescriptor | null =
    getCloudResourceTypeDescriptor(provider, type);
  return descriptor ? descriptor.type : type.trim();
}

const AWS_RULES_BY_NAMESPACE: ReadonlyMap<
  string,
  ReadonlyArray<AwsCloudWatchResourceRule>
> = ((): Map<string, Array<AwsCloudWatchResourceRule>> => {
  const map: Map<string, Array<AwsCloudWatchResourceRule>> = new Map();
  for (const rule of AWS_CLOUDWATCH_RESOURCE_RULES) {
    const key: string = rule.namespace.toLowerCase();
    const rules: Array<AwsCloudWatchResourceRule> = map.get(key) || [];
    rules.push(rule);
    map.set(key, rules);
  }
  return map;
})();

// The rules of a CloudWatch namespace, in the order they are tried.
export function getAwsCloudWatchRulesForNamespace(
  namespace: string,
): ReadonlyArray<AwsCloudWatchResourceRule> {
  return AWS_RULES_BY_NAMESPACE.get(namespace.trim().toLowerCase()) || [];
}

// Every CloudWatch namespace a Cloud Resource can be discovered from.
export const AWS_CLOUDWATCH_DISCOVERY_NAMESPACES: ReadonlyArray<string> =
  Array.from(
    new Set(
      AWS_CLOUDWATCH_RESOURCE_RULES.map(
        (rule: AwsCloudWatchResourceRule): string => {
          return rule.namespace;
        },
      ),
    ),
  );

const GCP_RULES_BY_TYPE: ReadonlyMap<string, GcpMonitoredResourceRule> =
  new Map(
    GCP_MONITORED_RESOURCE_RULES.map(
      (rule: GcpMonitoredResourceRule): [string, GcpMonitoredResourceRule] => {
        return [rule.type.toLowerCase(), rule];
      },
    ),
  );

export function getGcpMonitoredResourceRule(
  type: string,
): GcpMonitoredResourceRule | null {
  return GCP_RULES_BY_TYPE.get(type.trim().toLowerCase()) || null;
}
