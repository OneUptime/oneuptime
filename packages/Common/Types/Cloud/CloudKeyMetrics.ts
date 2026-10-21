import { CloudProvider } from "./CloudPlatform";
import {
  AWS_CLOUDWATCH_RESOURCE_RULES,
  AwsCloudWatchResourceRule,
} from "./CloudResourceCatalog";

/*
 * THE KEY METRICS A CLOUD CONNECTION READS, PER RESOURCE TYPE.
 *
 * A cloud connection (Cloud > Connect) reads the provider's monitoring API
 * itself, the way an OpenTelemetry Collector's cloud receivers would, and
 * it reads a few metrics per resource - the ones a person looks at first
 * and alerts on: CPU, traffic, errors, latency, queue depth, free space -
 * not every metric the provider publishes. That keeps the calls the
 * customer pays their cloud for (CloudWatch charges per metric read) and
 * the telemetry OneUptime stores small, and every resource page and
 * monitor template starts from the same few charts.
 *
 * The metrics are named and shaped exactly as the collector's receivers
 * write them (CloudMetricPayload), so a resource's pages, its monitors and
 * the docs read them the same whichever way they arrived.
 *
 * The docs page lists these (CloudConnectDocsFacts holds it to this file).
 */

/*
 * ---- AWS: CloudWatch -----------------------------------------------------
 *
 * Per namespace: the metric, the one statistic read (GetMetricData is
 * charged per metric and statistic) and the period. A metric is read for
 * every resource of the namespace that reported it in the last three
 * hours (ListMetrics, RecentlyActive), on exactly the dimensions
 * CloudWatch lists it with - the resource's own aggregate.
 */

export type AwsStatistic = "Average" | "Sum" | "Maximum" | "Minimum";

export interface AwsKeyMetric {
  metricName: string;
  statistic: AwsStatistic;
  // CloudWatch's unit, as written on the stored metric.
  unit: string;
  /*
   * Seconds per datapoint. 300 for most (CloudWatch's basic monitoring),
   * 86400 for the storage metrics CloudWatch publishes once a day.
   */
  periodSeconds: number;
}

export interface AwsNamespaceKeyMetrics {
  namespace: string;
  metrics: Array<AwsKeyMetric>;
  /*
   * Only read in this Region (CloudFront and Route 53 health checks publish
   * to us-east-1 whatever the resource's own Region).
   */
  onlyRegion?: string | undefined;
}

export const AWS_DEFAULT_PERIOD_SECONDS: number = 300;
export const DAILY_PERIOD_SECONDS: number = 86400;

function aws(
  metricName: string,
  statistic: AwsStatistic,
  unit: string,
  periodSeconds: number = AWS_DEFAULT_PERIOD_SECONDS,
): AwsKeyMetric {
  return { metricName, statistic, unit, periodSeconds };
}

export const AWS_KEY_METRICS: ReadonlyArray<AwsNamespaceKeyMetrics> = [
  {
    namespace: "AWS/EC2",
    metrics: [
      aws("CPUUtilization", "Average", "Percent"),
      aws("NetworkIn", "Sum", "Bytes"),
      aws("NetworkOut", "Sum", "Bytes"),
      aws("StatusCheckFailed", "Maximum", "Count"),
    ],
  },
  {
    namespace: "AWS/EBS",
    metrics: [
      aws("VolumeReadOps", "Sum", "Count"),
      aws("VolumeWriteOps", "Sum", "Count"),
      aws("VolumeQueueLength", "Average", "Count"),
    ],
  },
  {
    namespace: "AWS/ELB",
    metrics: [
      aws("RequestCount", "Sum", "Count"),
      aws("Latency", "Average", "Seconds"),
      aws("HTTPCode_Backend_5XX", "Sum", "Count"),
      aws("UnHealthyHostCount", "Maximum", "Count"),
    ],
  },
  {
    namespace: "AWS/ApplicationELB",
    metrics: [
      aws("RequestCount", "Sum", "Count"),
      aws("TargetResponseTime", "Average", "Seconds"),
      aws("HTTPCode_Target_5XX_Count", "Sum", "Count"),
      aws("HTTPCode_ELB_5XX_Count", "Sum", "Count"),
    ],
  },
  {
    namespace: "AWS/NetworkELB",
    metrics: [
      aws("ActiveFlowCount", "Average", "Count"),
      aws("NewFlowCount", "Sum", "Count"),
      aws("ProcessedBytes", "Sum", "Bytes"),
    ],
  },
  {
    namespace: "AWS/NATGateway",
    metrics: [
      aws("ActiveConnectionCount", "Maximum", "Count"),
      aws("BytesOutToDestination", "Sum", "Bytes"),
      aws("ErrorPortAllocation", "Sum", "Count"),
    ],
  },
  {
    namespace: "AWS/VPN",
    metrics: [
      aws("TunnelState", "Maximum", "None"),
      aws("TunnelDataIn", "Sum", "Bytes"),
      aws("TunnelDataOut", "Sum", "Bytes"),
    ],
  },
  {
    namespace: "AWS/CloudFront",
    onlyRegion: "us-east-1",
    metrics: [
      aws("Requests", "Sum", "None"),
      aws("4xxErrorRate", "Average", "Percent"),
      aws("5xxErrorRate", "Average", "Percent"),
      aws("BytesDownloaded", "Sum", "None"),
    ],
  },
  {
    namespace: "AWS/Route53",
    onlyRegion: "us-east-1",
    metrics: [
      aws("HealthCheckStatus", "Minimum", "None"),
      aws("HealthCheckPercentageHealthy", "Average", "Percent"),
    ],
  },
  {
    namespace: "AWS/S3",
    metrics: [
      aws("BucketSizeBytes", "Average", "Bytes", DAILY_PERIOD_SECONDS),
      aws("NumberOfObjects", "Average", "Count", DAILY_PERIOD_SECONDS),
    ],
  },
  {
    namespace: "AWS/EFS",
    metrics: [
      aws("ClientConnections", "Sum", "Count"),
      aws("PercentIOLimit", "Average", "Percent"),
    ],
  },
  {
    namespace: "AWS/ECS",
    metrics: [
      aws("CPUUtilization", "Average", "Percent"),
      aws("MemoryUtilization", "Average", "Percent"),
    ],
  },
  {
    namespace: "AWS/Lambda",
    metrics: [
      aws("Invocations", "Sum", "Count"),
      aws("Errors", "Sum", "Count"),
      aws("Duration", "Average", "Milliseconds"),
      aws("Throttles", "Sum", "Count"),
    ],
  },
  {
    namespace: "AWS/States",
    metrics: [
      aws("ExecutionsStarted", "Sum", "Count"),
      aws("ExecutionsFailed", "Sum", "Count"),
      aws("ExecutionTime", "Average", "Milliseconds"),
    ],
  },
  {
    namespace: "AWS/RDS",
    metrics: [
      aws("CPUUtilization", "Average", "Percent"),
      aws("DatabaseConnections", "Average", "Count"),
      aws("FreeStorageSpace", "Average", "Bytes"),
      aws("FreeableMemory", "Average", "Bytes"),
      aws("ReadLatency", "Average", "Seconds"),
      aws("WriteLatency", "Average", "Seconds"),
    ],
  },
  {
    namespace: "AWS/DocDB",
    metrics: [
      aws("CPUUtilization", "Average", "Percent"),
      aws("DatabaseConnections", "Average", "Count"),
      aws("FreeableMemory", "Average", "Bytes"),
    ],
  },
  {
    namespace: "AWS/DynamoDB",
    metrics: [
      aws("ConsumedReadCapacityUnits", "Sum", "Count"),
      aws("ConsumedWriteCapacityUnits", "Sum", "Count"),
      aws("ReadThrottleEvents", "Sum", "Count"),
      aws("WriteThrottleEvents", "Sum", "Count"),
    ],
  },
  {
    namespace: "AWS/ElastiCache",
    metrics: [
      aws("CPUUtilization", "Average", "Percent"),
      aws("CurrConnections", "Average", "Count"),
      aws("Evictions", "Sum", "Count"),
      aws("DatabaseMemoryUsagePercentage", "Average", "Percent"),
    ],
  },
  {
    namespace: "AWS/Redshift",
    metrics: [
      aws("CPUUtilization", "Average", "Percent"),
      aws("PercentageDiskSpaceUsed", "Average", "Percent"),
      aws("DatabaseConnections", "Average", "Count"),
    ],
  },
  {
    namespace: "AWS/ES",
    metrics: [
      aws("CPUUtilization", "Average", "Percent"),
      aws("FreeStorageSpace", "Minimum", "Megabytes"),
      aws("ClusterStatus.red", "Maximum", "Count"),
    ],
  },
  {
    namespace: "AWS/SQS",
    metrics: [
      aws("ApproximateNumberOfMessagesVisible", "Maximum", "Count"),
      aws("ApproximateAgeOfOldestMessage", "Maximum", "Seconds"),
      aws("NumberOfMessagesSent", "Sum", "Count"),
    ],
  },
  {
    namespace: "AWS/SNS",
    metrics: [
      aws("NumberOfMessagesPublished", "Sum", "Count"),
      aws("NumberOfNotificationsFailed", "Sum", "Count"),
    ],
  },
  {
    namespace: "AWS/Kinesis",
    metrics: [
      aws("IncomingRecords", "Sum", "Count"),
      aws("GetRecords.IteratorAgeMilliseconds", "Maximum", "Milliseconds"),
    ],
  },
  {
    namespace: "AWS/Firehose",
    metrics: [
      aws("IncomingRecords", "Sum", "Count"),
      aws("DeliveryToS3.Success", "Average", "Count"),
    ],
  },
  {
    namespace: "AWS/ApiGateway",
    metrics: [
      aws("Count", "Sum", "Count"),
      aws("5XXError", "Sum", "Count"),
      aws("Latency", "Average", "Milliseconds"),
    ],
  },
  {
    namespace: "AWS/Events",
    metrics: [
      aws("Invocations", "Sum", "Count"),
      aws("FailedInvocations", "Sum", "Count"),
    ],
  },
  {
    namespace: "AWS/AmazonMQ",
    metrics: [aws("CpuUtilization", "Average", "Percent")],
  },
  {
    namespace: "AWS/Kafka",
    metrics: [aws("ActiveControllerCount", "Maximum", "Count")],
  },
];

const AWS_KEY_METRICS_BY_NAMESPACE: ReadonlyMap<string, AwsNamespaceKeyMetrics> =
  new Map(
    AWS_KEY_METRICS.map(
      (entry: AwsNamespaceKeyMetrics): [string, AwsNamespaceKeyMetrics] => {
        return [entry.namespace.toLowerCase(), entry];
      },
    ),
  );

export function getAwsKeyMetrics(
  namespace: string,
): AwsNamespaceKeyMetrics | undefined {
  return AWS_KEY_METRICS_BY_NAMESPACE.get(namespace.trim().toLowerCase());
}

// The stored name of a CloudWatch metric, as the receivers write it.
export function getAwsStoredMetricName(
  namespace: string,
  metricName: string,
): string {
  return `amazonaws.com/${namespace}/${metricName}`;
}

/*
 * ---- Azure: Azure Monitor ------------------------------------------------
 *
 * Per resource type: the metrics read, by Azure Monitor's own name, in
 * order. A metric the resource does not publish (its metric definitions
 * do not list it - a vCore database has no DTU) is left out; each is read
 * with the aggregation its definition calls primary, at the finest time
 * grain it offers from a minute up.
 */

export interface AzureTypeKeyMetrics {
  // The ARM type, as CloudResourceCatalog spells it.
  type: string;
  metrics: Array<string>;
}

// At most this many metrics are read per resource (one Azure Monitor call).
export const AZURE_MAX_METRICS_PER_RESOURCE: number = 8;

export const AZURE_KEY_METRICS: ReadonlyArray<AzureTypeKeyMetrics> = [
  {
    type: "Microsoft.Compute/virtualMachines",
    metrics: [
      "Percentage CPU",
      "Available Memory Bytes",
      "Network In Total",
      "Network Out Total",
      "Disk Read Bytes",
      "Disk Write Bytes",
      "VmAvailabilityMetric",
    ],
  },
  {
    type: "Microsoft.Compute/virtualMachineScaleSets",
    metrics: [
      "Percentage CPU",
      "Available Memory Bytes",
      "Network In Total",
      "Network Out Total",
    ],
  },
  {
    type: "Microsoft.Compute/disks",
    metrics: [
      "Composite Disk Read Bytes/sec",
      "Composite Disk Write Bytes/sec",
      "Composite Disk Read Operations/sec",
      "Composite Disk Write Operations/sec",
    ],
  },
  {
    type: "Microsoft.Web/sites",
    metrics: [
      "Requests",
      "Http5xx",
      "Http4xx",
      "HttpResponseTime",
      "CpuTime",
      "MemoryWorkingSet",
      "FunctionExecutionCount",
    ],
  },
  {
    type: "Microsoft.Web/serverfarms",
    metrics: ["CpuPercentage", "MemoryPercentage", "HttpQueueLength"],
  },
  {
    type: "Microsoft.Sql/servers/databases",
    metrics: [
      "cpu_percent",
      "dtu_consumption_percent",
      "storage_percent",
      "connection_failed",
      "deadlock",
      "sessions_percent",
    ],
  },
  {
    type: "Microsoft.Sql/servers/elasticpools",
    metrics: ["cpu_percent", "eDTU_used", "storage_percent"],
  },
  {
    type: "Microsoft.Sql/managedInstances",
    metrics: ["avg_cpu_percent", "storage_space_used_mb"],
  },
  {
    type: "Microsoft.DBforPostgreSQL/flexibleServers",
    metrics: [
      "cpu_percent",
      "memory_percent",
      "storage_percent",
      "active_connections",
      "connections_failed",
    ],
  },
  {
    type: "Microsoft.DBforMySQL/flexibleServers",
    metrics: [
      "cpu_percent",
      "memory_percent",
      "storage_percent",
      "active_connections",
      "aborted_connections",
    ],
  },
  {
    type: "Microsoft.DocumentDB/databaseAccounts",
    metrics: [
      "TotalRequests",
      "TotalRequestUnits",
      "NormalizedRUConsumption",
      "ServerSideLatency",
    ],
  },
  {
    type: "Microsoft.Cache/redis",
    metrics: [
      "percentProcessorTime",
      "usedmemorypercentage",
      "connectedclients",
      "serverLoad",
      "errors",
    ],
  },
  {
    type: "Microsoft.Storage/storageAccounts",
    metrics: ["Transactions", "Availability", "SuccessE2ELatency", "UsedCapacity"],
  },
  {
    type: "Microsoft.KeyVault/vaults",
    metrics: ["ServiceApiHit", "ServiceApiLatency", "Availability"],
  },
  {
    type: "Microsoft.ServiceBus/namespaces",
    metrics: [
      "IncomingMessages",
      "OutgoingMessages",
      "ActiveMessages",
      "DeadletteredMessages",
      "ServerErrors",
      "ThrottledRequests",
    ],
  },
  {
    type: "Microsoft.EventHub/namespaces",
    metrics: [
      "IncomingMessages",
      "OutgoingMessages",
      "ThrottledRequests",
      "ServerErrors",
    ],
  },
  {
    type: "Microsoft.ContainerService/managedClusters",
    metrics: [
      "node_cpu_usage_percentage",
      "node_memory_working_set_percentage",
      "kube_pod_status_ready",
    ],
  },
  {
    type: "Microsoft.App/containerApps",
    metrics: ["Requests", "UsageNanoCores", "WorkingSetBytes", "RestartCount"],
  },
  {
    type: "Microsoft.Network/loadBalancers",
    metrics: ["VipAvailability", "DipAvailability", "ByteCount"],
  },
  {
    type: "Microsoft.Network/applicationGateways",
    metrics: [
      "TotalRequests",
      "FailedRequests",
      "UnhealthyHostCount",
      "ApplicationGatewayTotalTime",
      "Throughput",
    ],
  },
  {
    type: "Microsoft.Network/publicIPAddresses",
    metrics: ["VipAvailability", "ByteCount", "IfUnderDDoSAttack"],
  },
  {
    type: "Microsoft.Network/azureFirewalls",
    metrics: ["FirewallHealth", "Throughput", "SNATPortUtilization"],
  },
  {
    type: "Microsoft.Network/natGateways",
    metrics: ["ByteCount", "SNATConnectionCount", "DatapathAvailability"],
  },
  {
    type: "Microsoft.Cdn/profiles",
    metrics: ["RequestCount", "Percentage5XX", "TotalLatency"],
  },
  {
    type: "Microsoft.ApiManagement/service",
    metrics: ["Requests", "Duration", "Capacity"],
  },
  {
    type: "Microsoft.CognitiveServices/accounts",
    metrics: ["TotalCalls", "TotalErrors", "Latency"],
  },
  {
    type: "Microsoft.ContainerRegistry/registries",
    metrics: ["TotalPullCount", "TotalPushCount", "StorageUsed"],
  },
  {
    type: "Microsoft.Logic/workflows",
    metrics: ["RunsStarted", "RunsFailed", "RunLatency"],
  },
  {
    type: "Microsoft.DataFactory/factories",
    metrics: ["PipelineSucceededRuns", "PipelineFailedRuns"],
  },
  {
    type: "Microsoft.Search/searchServices",
    metrics: ["SearchLatency", "SearchQueriesPerSecond"],
  },
  {
    type: "Microsoft.SignalRService/SignalR",
    metrics: ["ConnectionCount", "MessageCount"],
  },
];

const AZURE_KEY_METRICS_BY_TYPE: ReadonlyMap<string, AzureTypeKeyMetrics> =
  new Map(
    AZURE_KEY_METRICS.map(
      (entry: AzureTypeKeyMetrics): [string, AzureTypeKeyMetrics] => {
        return [entry.type.toLowerCase(), entry];
      },
    ),
  );

export function getAzureKeyMetrics(
  type: string,
): AzureTypeKeyMetrics | undefined {
  return AZURE_KEY_METRICS_BY_TYPE.get(type.trim().toLowerCase());
}

/*
 * The stored name of an Azure Monitor metric, as the azure_monitor
 * receiver writes it: "azure_" + the name with spaces as underscores + "_"
 * + the aggregation, lowercased ("Percentage CPU", Average ->
 * azure_percentage_cpu_average).
 */
export function getAzureStoredMetricName(
  metricName: string,
  aggregation: string,
): string {
  return `azure_${metricName.split(" ").join("_")}_${aggregation}`.toLowerCase();
}

/*
 * ---- Google Cloud: Cloud Monitoring --------------------------------------
 *
 * Per monitored resource type: the metric types read and how each is
 * aligned to a minute - the mean of a gauge, the per-second rate of a
 * count, the 95th percentile of a distribution. One call per metric type
 * returns it for every resource of the project, so a resource type is
 * found the moment it reports any of these.
 */

export type GcpAligner =
  | "ALIGN_MEAN"
  | "ALIGN_MAX"
  | "ALIGN_RATE"
  | "ALIGN_PERCENTILE_95";

export interface GcpKeyMetric {
  metricType: string;
  aligner: GcpAligner;
  // The unit of the aligned value.
  unit: string;
}

export interface GcpTypeKeyMetrics {
  // The monitored resource type, as CloudResourceCatalog spells it.
  resourceType: string;
  metrics: Array<GcpKeyMetric>;
}

export const GCP_ALIGNMENT_PERIOD_SECONDS: number = 60;

function gcp(
  metricType: string,
  aligner: GcpAligner,
  unit: string,
): GcpKeyMetric {
  return { metricType, aligner, unit };
}

export const GCP_KEY_METRICS: ReadonlyArray<GcpTypeKeyMetrics> = [
  {
    resourceType: "gce_instance",
    metrics: [
      gcp("compute.googleapis.com/instance/cpu/utilization", "ALIGN_MEAN", "1"),
      gcp(
        "compute.googleapis.com/instance/network/received_bytes_count",
        "ALIGN_RATE",
        "By/s",
      ),
      gcp(
        "compute.googleapis.com/instance/network/sent_bytes_count",
        "ALIGN_RATE",
        "By/s",
      ),
    ],
  },
  {
    resourceType: "cloudsql_database",
    metrics: [
      gcp("cloudsql.googleapis.com/database/cpu/utilization", "ALIGN_MEAN", "1"),
      gcp(
        "cloudsql.googleapis.com/database/memory/utilization",
        "ALIGN_MEAN",
        "1",
      ),
      gcp(
        "cloudsql.googleapis.com/database/disk/utilization",
        "ALIGN_MEAN",
        "1",
      ),
      gcp(
        "cloudsql.googleapis.com/database/network/connections",
        "ALIGN_MEAN",
        "1",
      ),
    ],
  },
  {
    resourceType: "gcs_bucket",
    metrics: [
      gcp("storage.googleapis.com/api/request_count", "ALIGN_RATE", "1/s"),
      gcp("storage.googleapis.com/storage/total_bytes", "ALIGN_MEAN", "By"),
    ],
  },
  {
    resourceType: "https_lb_rule",
    metrics: [
      gcp(
        "loadbalancing.googleapis.com/https/request_count",
        "ALIGN_RATE",
        "1/s",
      ),
      gcp(
        "loadbalancing.googleapis.com/https/total_latencies",
        "ALIGN_PERCENTILE_95",
        "ms",
      ),
    ],
  },
  {
    resourceType: "internal_http_lb_rule",
    metrics: [
      gcp(
        "loadbalancing.googleapis.com/https/internal/request_count",
        "ALIGN_RATE",
        "1/s",
      ),
    ],
  },
  {
    resourceType: "cloud_run_revision",
    metrics: [
      gcp("run.googleapis.com/request_count", "ALIGN_RATE", "1/s"),
      gcp(
        "run.googleapis.com/request_latencies",
        "ALIGN_PERCENTILE_95",
        "ms",
      ),
      gcp("run.googleapis.com/container/instance_count", "ALIGN_MAX", "1"),
    ],
  },
  {
    resourceType: "cloud_function",
    metrics: [
      gcp(
        "cloudfunctions.googleapis.com/function/execution_count",
        "ALIGN_RATE",
        "1/s",
      ),
      gcp(
        "cloudfunctions.googleapis.com/function/execution_times",
        "ALIGN_PERCENTILE_95",
        "ns",
      ),
    ],
  },
  {
    resourceType: "pubsub_subscription",
    metrics: [
      gcp(
        "pubsub.googleapis.com/subscription/num_undelivered_messages",
        "ALIGN_MAX",
        "1",
      ),
      gcp(
        "pubsub.googleapis.com/subscription/oldest_unacked_message_age",
        "ALIGN_MAX",
        "s",
      ),
    ],
  },
  {
    resourceType: "pubsub_topic",
    metrics: [
      gcp(
        "pubsub.googleapis.com/topic/send_message_operation_count",
        "ALIGN_RATE",
        "1/s",
      ),
    ],
  },
  {
    resourceType: "redis_instance",
    metrics: [
      gcp("redis.googleapis.com/stats/memory/usage_ratio", "ALIGN_MEAN", "1"),
      gcp("redis.googleapis.com/clients/connected", "ALIGN_MEAN", "1"),
    ],
  },
  {
    resourceType: "spanner_instance",
    metrics: [
      gcp("spanner.googleapis.com/instance/cpu/utilization", "ALIGN_MEAN", "1"),
    ],
  },
  {
    resourceType: "cloud_tasks_queue",
    metrics: [gcp("cloudtasks.googleapis.com/queue/depth", "ALIGN_MAX", "1")],
  },
  {
    resourceType: "gae_app",
    metrics: [
      gcp(
        "appengine.googleapis.com/http/server/response_count",
        "ALIGN_RATE",
        "1/s",
      ),
    ],
  },
];

// Every metric type read, with the resource type it is about.
export function getGcpKeyMetricTypes(): Array<
  GcpKeyMetric & { resourceType: string }
> {
  const metrics: Array<GcpKeyMetric & { resourceType: string }> = [];

  for (const entry of GCP_KEY_METRICS) {
    for (const metric of entry.metrics) {
      metrics.push({ ...metric, resourceType: entry.resourceType });
    }
  }

  return metrics;
}

// The CloudWatch namespace an AWS resource type is read from.
export function getAwsNamespaceOfType(type: string): string | undefined {
  const wanted: string = type.trim().toLowerCase();

  return AWS_CLOUDWATCH_RESOURCE_RULES.find(
    (rule: AwsCloudWatchResourceRule): boolean => {
      return (
        rule.type.toLowerCase() === wanted &&
        Boolean(getAwsKeyMetrics(rule.namespace))
      );
    },
  )?.namespace;
}

/*
 * How many key metrics a resource type has, for the docs and the cost
 * estimate. AWS takes a CloudFormation type or a namespace.
 */
export function getKeyMetricCount(
  provider: CloudProvider,
  typeOrNamespace: string,
): number {
  if (provider === CloudProvider.AWS) {
    const namespace: string =
      getAwsNamespaceOfType(typeOrNamespace) || typeOrNamespace;

    return getAwsKeyMetrics(namespace)?.metrics.length || 0;
  }

  if (provider === CloudProvider.Azure) {
    return getAzureKeyMetrics(typeOrNamespace)?.metrics.length || 0;
  }

  return (
    GCP_KEY_METRICS.find((entry: GcpTypeKeyMetrics): boolean => {
      return entry.resourceType === typeOrNamespace;
    })?.metrics.length || 0
  );
}
