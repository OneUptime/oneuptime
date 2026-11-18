import { CloudProvider } from "./CloudPlatform";
import {
  AWS_CLOUDWATCH_RESOURCE_RULES,
  AwsCloudWatchResourceRule,
} from "./CloudResourceCatalog";
import {
  CloudKeyMetricGroup,
  getCloudKeyMetricGroupOrder,
} from "./CloudKeyMetricGroup";

/*
 * THE KEY METRICS A CLOUD CONNECTION READS, PER RESOURCE TYPE.
 *
 * A cloud connection (Cloud > Connect) reads the provider's monitoring API
 * itself, the way an OpenTelemetry Collector's cloud receivers would, and
 * it reads a curated set of metrics per resource type - the ones an
 * operator looks at and alerts on for that kind of resource: a virtual
 * machine's CPU, memory, disks, network and availability; an app's
 * requests, errors, response time, CPU and memory; a database's CPU,
 * storage, IO, connections and replication lag - not every metric the
 * provider publishes. Each comes from the provider's own reference (Azure
 * Monitor's supported metrics, the CloudWatch user guides, Google Cloud's
 * metrics list), and the tests hold every entry to it
 * (CloudKeyMetricsProviderReference.test).
 *
 * Why a curated set and not everything: what the customer's cloud bills
 * (CloudWatch charges per metric read; Cloud Monitoring per time series),
 * the calls a read may make in its budget, and the telemetry OneUptime
 * stores - a resource type publishes up to two hundred metrics, most of
 * them a per-shard or per-feature variant nobody charts. Each cloud's set
 * is sized to what a read costs there:
 *
 *   - Azure Monitor answers up to 20 metrics of a resource in one call,
 *     and bills per call, so each type reads up to 20 at no extra cost -
 *     each at its finest grain, never two sub-hourly grains (two calls) for
 *     one type;
 *   - CloudWatch bills each metric of each resource, so AWS reads fewer:
 *     the ones that say whether it is up, busy, failing, slow or full;
 *   - Cloud Monitoring answers one metric type for every resource of a
 *     project in one call, and a read only asks the types of resources a
 *     project has (GcpCloudConnector).
 *
 * Each metric is filed under a CloudKeyMetricGroup, and a type's metrics
 * come most telling first within it: a resource's Metrics card shows them
 * in those groups (CloudKeyMetricGroup's order), its other metrics after.
 *
 * The metrics are named and shaped exactly as the collector's receivers
 * write them (CloudMetricPayload), so a resource's pages, its monitors and
 * the docs read them the same whichever way they arrived.
 *
 * The docs page lists these (CloudConnectDocsFacts holds it to this file).
 */

const G: typeof CloudKeyMetricGroup = CloudKeyMetricGroup;

/*
 * ---- AWS: CloudWatch -----------------------------------------------------
 *
 * Per namespace: the metric, the one statistic read (GetMetricData is
 * charged per metric and statistic) and the period. A metric is read for
 * every resource of the namespace that reported it in the last three
 * hours (ListMetrics, RecentlyActive), on exactly the dimensions
 * CloudWatch lists it with - the resource's own aggregate. A namespace
 * whose metrics are published a few times a day is listed whatever its
 * last point's age instead (isListedWhenQuiet): three hours after one,
 * the listing would not know it most of the day.
 *
 * A namespace's first metric is the one a sweep asks whether the
 * namespace has resources in a Region (AwsCloudConnector): one every
 * resource of it reports.
 */

export type AwsStatistic = "Average" | "Sum" | "Maximum" | "Minimum";

export interface AwsKeyMetric {
  metricName: string;
  statistic: AwsStatistic;
  // CloudWatch's unit, as written on the stored metric.
  unit: string;
  // What it is about, for the resource's Metrics card.
  group: CloudKeyMetricGroup;
  /*
   * Seconds per datapoint, and how often the read asks for it
   * (CloudMetricWindows: each period has a cursor of its own). 300 for most
   * (CloudWatch's basic monitoring); 3600 for a metric published a few
   * times a day, read once an hour (ACM's DaysToExpiry, twice a day); 86400
   * for the storage metrics CloudWatch publishes once a day.
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
  /*
   * Listed without RecentlyActive: every series that reported in the last
   * two weeks, as ListMetrics lists by default, not only the last three
   * hours'. For a namespace whose metrics a service publishes a few times a
   * day (ACM's DaysToExpiry, twice), which the last three hours' listing
   * would hold for a few hours after each point and lose for the rest of
   * the day - and with them the resource's readings, on the read's own
   * hourly cadence. A series that stops (a certificate that expired) stays
   * listed for those two weeks, and reads as no data.
   */
  isListedWhenQuiet?: boolean | undefined;
}

export const AWS_DEFAULT_PERIOD_SECONDS: number = 300;
export const HOURLY_PERIOD_SECONDS: number = 3600;
export const DAILY_PERIOD_SECONDS: number = 86400;

function aws(
  metricName: string,
  statistic: AwsStatistic,
  unit: string,
  group: CloudKeyMetricGroup,
  periodSeconds: number = AWS_DEFAULT_PERIOD_SECONDS,
): AwsKeyMetric {
  return { metricName, statistic, unit, group, periodSeconds };
}

export const AWS_KEY_METRICS: ReadonlyArray<AwsNamespaceKeyMetrics> = [
  {
    namespace: "AWS/EC2",
    metrics: [
      aws("CPUUtilization", "Average", "Percent", G.Compute),
      aws("NetworkIn", "Sum", "Bytes", G.Network),
      aws("NetworkOut", "Sum", "Bytes", G.Network),
      aws("StatusCheckFailed", "Maximum", "Count", G.Availability),
    ],
  },
  {
    namespace: "AWS/EBS",
    metrics: [
      aws("VolumeReadOps", "Sum", "Count", G.Storage),
      aws("VolumeWriteOps", "Sum", "Count", G.Storage),
      aws("VolumeQueueLength", "Average", "Count", G.Storage),
    ],
  },
  {
    namespace: "AWS/ELB",
    metrics: [
      aws("RequestCount", "Sum", "Count", G.Traffic),
      aws("Latency", "Average", "Seconds", G.Latency),
      aws("HTTPCode_Backend_5XX", "Sum", "Count", G.Errors),
      aws("UnHealthyHostCount", "Maximum", "Count", G.Availability),
    ],
  },
  {
    namespace: "AWS/ApplicationELB",
    metrics: [
      aws("RequestCount", "Sum", "Count", G.Traffic),
      aws("TargetResponseTime", "Average", "Seconds", G.Latency),
      aws("HTTPCode_Target_5XX_Count", "Sum", "Count", G.Errors),
      aws("HTTPCode_ELB_5XX_Count", "Sum", "Count", G.Errors),
    ],
  },
  {
    namespace: "AWS/NetworkELB",
    metrics: [
      aws("ActiveFlowCount", "Average", "Count", G.Connections),
      aws("NewFlowCount", "Sum", "Count", G.Connections),
      aws("ProcessedBytes", "Sum", "Bytes", G.Traffic),
    ],
  },
  {
    namespace: "AWS/NATGateway",
    metrics: [
      aws("ActiveConnectionCount", "Maximum", "Count", G.Connections),
      aws("BytesOutToDestination", "Sum", "Bytes", G.Network),
      aws("ErrorPortAllocation", "Sum", "Count", G.Errors),
    ],
  },
  {
    namespace: "AWS/VPN",
    metrics: [
      aws("TunnelState", "Maximum", "None", G.Availability),
      aws("TunnelDataIn", "Sum", "Bytes", G.Network),
      aws("TunnelDataOut", "Sum", "Bytes", G.Network),
    ],
  },
  {
    namespace: "AWS/CloudFront",
    onlyRegion: "us-east-1",
    metrics: [
      aws("Requests", "Sum", "None", G.Traffic),
      aws("4xxErrorRate", "Average", "Percent", G.Errors),
      aws("5xxErrorRate", "Average", "Percent", G.Errors),
      aws("BytesDownloaded", "Sum", "None", G.Network),
    ],
  },
  {
    namespace: "AWS/Route53",
    onlyRegion: "us-east-1",
    metrics: [
      aws("HealthCheckStatus", "Minimum", "None", G.Availability),
      aws("HealthCheckPercentageHealthy", "Average", "Percent", G.Availability),
    ],
  },
  {
    namespace: "AWS/S3",
    metrics: [
      aws(
        "BucketSizeBytes",
        "Average",
        "Bytes",
        G.Storage,
        DAILY_PERIOD_SECONDS,
      ),
      aws(
        "NumberOfObjects",
        "Average",
        "Count",
        G.Storage,
        DAILY_PERIOD_SECONDS,
      ),
    ],
  },
  {
    namespace: "AWS/EFS",
    metrics: [
      aws("ClientConnections", "Sum", "Count", G.Connections),
      aws("PercentIOLimit", "Average", "Percent", G.Storage),
    ],
  },
  {
    namespace: "AWS/ECS",
    metrics: [
      aws("CPUUtilization", "Average", "Percent", G.Compute),
      aws("MemoryUtilization", "Average", "Percent", G.Memory),
    ],
  },
  {
    namespace: "AWS/Lambda",
    metrics: [
      aws("Invocations", "Sum", "Count", G.Traffic),
      aws("Errors", "Sum", "Count", G.Errors),
      aws("Duration", "Average", "Milliseconds", G.Latency),
      aws("Throttles", "Sum", "Count", G.Errors),
    ],
  },
  {
    namespace: "AWS/States",
    metrics: [
      aws("ExecutionsStarted", "Sum", "Count", G.Traffic),
      aws("ExecutionsFailed", "Sum", "Count", G.Errors),
      aws("ExecutionTime", "Average", "Milliseconds", G.Latency),
    ],
  },
  {
    namespace: "AWS/RDS",
    metrics: [
      aws("CPUUtilization", "Average", "Percent", G.Compute),
      aws("DatabaseConnections", "Average", "Count", G.Connections),
      aws("FreeStorageSpace", "Average", "Bytes", G.Storage),
      aws("FreeableMemory", "Average", "Bytes", G.Memory),
      aws("ReadLatency", "Average", "Seconds", G.Latency),
      aws("WriteLatency", "Average", "Seconds", G.Latency),
    ],
  },
  {
    namespace: "AWS/DocDB",
    metrics: [
      aws("CPUUtilization", "Average", "Percent", G.Compute),
      aws("DatabaseConnections", "Average", "Count", G.Connections),
      aws("FreeableMemory", "Average", "Bytes", G.Memory),
    ],
  },
  {
    namespace: "AWS/DynamoDB",
    metrics: [
      aws("ConsumedReadCapacityUnits", "Sum", "Count", G.Traffic),
      aws("ConsumedWriteCapacityUnits", "Sum", "Count", G.Traffic),
      aws("ReadThrottleEvents", "Sum", "Count", G.Errors),
      aws("WriteThrottleEvents", "Sum", "Count", G.Errors),
    ],
  },
  {
    namespace: "AWS/ElastiCache",
    metrics: [
      aws("CPUUtilization", "Average", "Percent", G.Compute),
      aws("CurrConnections", "Average", "Count", G.Connections),
      aws("Evictions", "Sum", "Count", G.Cache),
      aws("DatabaseMemoryUsagePercentage", "Average", "Percent", G.Memory),
    ],
  },
  {
    namespace: "AWS/Redshift",
    metrics: [
      aws("CPUUtilization", "Average", "Percent", G.Compute),
      aws("PercentageDiskSpaceUsed", "Average", "Percent", G.Storage),
      aws("DatabaseConnections", "Average", "Count", G.Connections),
    ],
  },
  {
    namespace: "AWS/ES",
    metrics: [
      aws("CPUUtilization", "Average", "Percent", G.Compute),
      aws("FreeStorageSpace", "Minimum", "Megabytes", G.Storage),
      aws("ClusterStatus.red", "Maximum", "Count", G.Availability),
    ],
  },
  {
    namespace: "AWS/SQS",
    metrics: [
      aws("ApproximateNumberOfMessagesVisible", "Maximum", "Count", G.Backlog),
      aws("ApproximateAgeOfOldestMessage", "Maximum", "Seconds", G.Backlog),
      aws("NumberOfMessagesSent", "Sum", "Count", G.Traffic),
    ],
  },
  {
    namespace: "AWS/SNS",
    metrics: [
      aws("NumberOfMessagesPublished", "Sum", "Count", G.Traffic),
      aws("NumberOfNotificationsFailed", "Sum", "Count", G.Errors),
    ],
  },
  {
    namespace: "AWS/Kinesis",
    metrics: [
      aws("IncomingRecords", "Sum", "Count", G.Traffic),
      aws(
        "GetRecords.IteratorAgeMilliseconds",
        "Maximum",
        "Milliseconds",
        G.Backlog,
      ),
    ],
  },
  {
    namespace: "AWS/Firehose",
    metrics: [
      aws("IncomingRecords", "Sum", "Count", G.Traffic),
      aws("DeliveryToS3.Success", "Average", "Count", G.Availability),
    ],
  },
  {
    namespace: "AWS/ApiGateway",
    metrics: [
      aws("Count", "Sum", "Count", G.Traffic),
      aws("5XXError", "Sum", "Count", G.Errors),
      aws("Latency", "Average", "Milliseconds", G.Latency),
    ],
  },
  {
    namespace: "AWS/Events",
    metrics: [
      aws("Invocations", "Sum", "Count", G.Traffic),
      aws("FailedInvocations", "Sum", "Count", G.Errors),
    ],
  },
  {
    namespace: "AWS/AmazonMQ",
    metrics: [aws("CpuUtilization", "Average", "Percent", G.Compute)],
  },
  {
    namespace: "AWS/Kafka",
    metrics: [aws("ActiveControllerCount", "Maximum", "Count", G.Availability)],
  },
  {
    /*
     * The days a certificate has left. ACM publishes it twice a day for
     * every certificate until it expires, then stops: read once an hour,
     * and listed whatever its last point's age (isListedWhenQuiet). Its
     * Minimum is the period's one point. The key metrics' stream leaves it
     * to this read (CloudStreamTemplate): an hour sooner is nothing to a
     * count of days.
     */
    namespace: "AWS/CertificateManager",
    isListedWhenQuiet: true,
    metrics: [
      aws(
        "DaysToExpiry",
        "Minimum",
        "None",
        G.Availability,
        HOURLY_PERIOD_SECONDS,
      ),
    ],
  },
];

const AWS_KEY_METRICS_BY_NAMESPACE: ReadonlyMap<
  string,
  AwsNamespaceKeyMetrics
> = new Map(
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

export interface AzureKeyMetric {
  // Azure Monitor's name for it, "Name in REST API" in Microsoft's tables.
  name: string;
  // What it is about, for the resource's Metrics card.
  group: CloudKeyMetricGroup;
}

export interface AzureTypeKeyMetrics {
  // The ARM type, as CloudResourceCatalog spells it.
  type: string;
  metrics: Array<AzureKeyMetric>;
  /*
   * The dimension every metric of the type is split by, one series per
   * value, in the same one call: a Service Bus or Event Hubs namespace's
   * EntityName, its queues, topics and event hubs - the series a queue's
   * page charts, exactly as the azure_monitor receiver writes them.
   */
  splitByDimension?: string | undefined;
  /*
   * The metrics of `metrics` a diagnostic setting cannot export: those
   * Microsoft's supported metrics of the type mark "DS Export: No" (Azure
   * Monitor documentation, "Supported metrics with Azure Monitor"). A
   * stream never delivers them, so the read keeps writing them while a
   * stream delivers the type's others (isAzureStreamedKeyMetric).
   */
  notExportedByDiagnosticSettings?: Array<string> | undefined;
}

/*
 * At most this many metrics are read per resource: Azure Monitor's own
 * limit for one metrics call, which is billed as one read whatever the
 * number of metrics in it.
 */
export const AZURE_MAX_METRICS_PER_RESOURCE: number = 20;

/*
 * The Azure Monitor dimension that names a Service Bus or Event Hubs
 * namespace's queue, topic or event hub.
 */
export const AZURE_ENTITY_NAME_DIMENSION: string = "EntityName";

/*
 * A split series' datapoint attribute per dimension, as the azure_monitor
 * receiver names it: "metadata_" + the dimension's name as Azure Monitor
 * answers it, lowercased - a queue's or topic's is metadata_entityname.
 */
export const AZURE_DIMENSION_ATTRIBUTE_PREFIX: string = "metadata_";
export const AZURE_ENTITY_NAME_ATTRIBUTE: string = `${AZURE_DIMENSION_ATTRIBUTE_PREFIX}${AZURE_ENTITY_NAME_DIMENSION.toLowerCase()}`;

/*
 * Series of one metric a split read asks Azure Monitor for at most (its
 * `top`, 10 unless asked): the queues, topics and event hubs of one
 * namespace a read reads, as many as the Queues guide asks the
 * azure_monitor receiver to read (maximum_number_of_records_per_resource).
 */
export const AZURE_MAX_SPLIT_SERIES_PER_METRIC: number = 1000;

function azure(name: string, group: CloudKeyMetricGroup): AzureKeyMetric {
  return { name, group };
}

/*
 * Microsoft's tables marked a virtual machine's network totals "DS Export:
 * No" until 2026 and mark them Yes now. They stay marked here: a stream
 * that sends them is left to the read, which writes them as it always has
 * (isAzureStreamedKeyMetric), so nothing is counted twice and nothing is
 * lost whichever the tables say.
 */
const AZURE_VM_NETWORK_TOTALS: Array<string> = [
  "Network In Total",
  "Network Out Total",
];

export const AZURE_KEY_METRICS: ReadonlyArray<AzureTypeKeyMetrics> = [
  {
    type: "Microsoft.Compute/virtualMachines",
    metrics: [
      azure("Percentage CPU", G.Compute),
      azure("Available Memory Bytes", G.Memory),
      azure("Network In Total", G.Network),
      azure("Network Out Total", G.Network),
      azure("Disk Read Bytes", G.Storage),
      azure("Disk Write Bytes", G.Storage),
      azure("VmAvailabilityMetric", G.Availability),
      azure("CPU Credits Remaining", G.Compute),
      azure("Available Memory Percentage", G.Memory),
      azure("Disk Read Operations/Sec", G.Storage),
      azure("Disk Write Operations/Sec", G.Storage),
      azure("OS Disk Queue Depth", G.Storage),
      azure("OS Disk Latency", G.Storage),
      azure("VM Uncached IOPS Consumed Percentage", G.Storage),
      azure("VM Uncached Bandwidth Consumed Percentage", G.Storage),
      azure("Inbound Flows", G.Network),
      azure("Outbound Flows", G.Network),
    ],
    notExportedByDiagnosticSettings: AZURE_VM_NETWORK_TOTALS,
  },
  {
    type: "Microsoft.Compute/virtualMachineScaleSets",
    metrics: [
      azure("Percentage CPU", G.Compute),
      azure("Available Memory Bytes", G.Memory),
      azure("Network In Total", G.Network),
      azure("Network Out Total", G.Network),
      azure("VmAvailabilityMetric", G.Availability),
      azure("CPU Credits Remaining", G.Compute),
      azure("Available Memory Percentage", G.Memory),
      azure("Disk Read Bytes", G.Storage),
      azure("Disk Write Bytes", G.Storage),
      azure("Disk Read Operations/Sec", G.Storage),
      azure("Disk Write Operations/Sec", G.Storage),
      azure("OS Disk Queue Depth", G.Storage),
      azure("VM Uncached IOPS Consumed Percentage", G.Storage),
      azure("Inbound Flows", G.Network),
      azure("Outbound Flows", G.Network),
    ],
    notExportedByDiagnosticSettings: AZURE_VM_NETWORK_TOTALS,
  },
  {
    type: "Microsoft.Compute/disks",
    metrics: [
      azure("Composite Disk Read Bytes/sec", G.Storage),
      azure("Composite Disk Write Bytes/sec", G.Storage),
      azure("Composite Disk Read Operations/sec", G.Storage),
      azure("Composite Disk Write Operations/sec", G.Storage),
      azure("DiskPaidBurstIOPS", G.Storage),
    ],
    notExportedByDiagnosticSettings: [
      "Composite Disk Read Bytes/sec",
      "Composite Disk Write Bytes/sec",
      "Composite Disk Read Operations/sec",
      "Composite Disk Write Operations/sec",
      "DiskPaidBurstIOPS",
    ],
  },
  {
    type: "Microsoft.Web/sites",
    metrics: [
      azure("Requests", G.Traffic),
      azure("Http5xx", G.Errors),
      azure("Http4xx", G.Errors),
      azure("HttpResponseTime", G.Latency),
      azure("CpuTime", G.Compute),
      azure("MemoryWorkingSet", G.Memory),
      azure("FunctionExecutionCount", G.Traffic),
      azure("Http2xx", G.Traffic),
      azure("RequestsInApplicationQueue", G.Backlog),
      azure("PrivateBytes", G.Memory),
      azure("Threads", G.Compute),
      azure("Handles", G.Compute),
      azure("AppConnections", G.Connections),
      azure("BytesReceived", G.Network),
      azure("BytesSent", G.Network),
      azure("FunctionExecutionUnits", G.Compute),
      azure("FileSystemUsage", G.Storage),
    ],
  },
  {
    type: "Microsoft.Web/serverfarms",
    metrics: [
      azure("CpuPercentage", G.Compute),
      azure("MemoryPercentage", G.Memory),
      azure("HttpQueueLength", G.Backlog),
      azure("DiskQueueLength", G.Storage),
      azure("BytesReceived", G.Network),
      azure("BytesSent", G.Network),
      azure("TcpEstablished", G.Connections),
    ],
  },
  {
    type: "Microsoft.Web/staticSites",
    metrics: [
      azure("SiteHits", G.Traffic),
      azure("SiteErrors", G.Errors),
      azure("FunctionHits", G.Traffic),
      azure("FunctionErrors", G.Errors),
      azure("CdnRequestCount", G.Traffic),
      azure("BytesSent", G.Network),
    ],
    notExportedByDiagnosticSettings: [
      "SiteHits",
      "SiteErrors",
      "FunctionHits",
      "FunctionErrors",
      "CdnRequestCount",
      "BytesSent",
    ],
  },
  {
    type: "Microsoft.Sql/servers/databases",
    metrics: [
      azure("cpu_percent", G.Compute),
      azure("dtu_consumption_percent", G.Compute),
      azure("storage_percent", G.Storage),
      azure("connection_failed", G.Connections),
      azure("deadlock", G.Errors),
      azure("sessions_percent", G.Connections),
      azure("availability", G.Availability),
      azure("workers_percent", G.Compute),
      azure("log_write_percent", G.Storage),
      azure("physical_data_read_percent", G.Storage),
      azure("storage", G.Storage),
      azure("connection_successful", G.Connections),
      azure("connection_failed_user_error", G.Connections),
      azure("blocked_by_firewall", G.Connections),
      azure("sessions_count", G.Connections),
    ],
  },
  {
    type: "Microsoft.Sql/servers/elasticpools",
    metrics: [
      azure("cpu_percent", G.Compute),
      azure("eDTU_used", G.Compute),
      azure("storage_percent", G.Storage),
      azure("dtu_consumption_percent", G.Compute),
      azure("workers_percent", G.Compute),
      azure("sessions_percent", G.Connections),
      azure("log_write_percent", G.Storage),
      azure("physical_data_read_percent", G.Storage),
      azure("allocated_data_storage_percent", G.Storage),
      azure("storage_used", G.Storage),
    ],
  },
  {
    type: "Microsoft.Sql/managedInstances",
    metrics: [
      azure("avg_cpu_percent", G.Compute),
      azure("storage_space_used_mb", G.Storage),
      azure("avg_workers_percent", G.Compute),
      azure("reserved_storage_mb", G.Storage),
      azure("io_requests", G.Storage),
      azure("io_bytes_read", G.Storage),
      azure("io_bytes_written", G.Storage),
    ],
  },
  {
    type: "Microsoft.DBforPostgreSQL/flexibleServers",
    metrics: [
      azure("cpu_percent", G.Compute),
      azure("memory_percent", G.Memory),
      azure("storage_percent", G.Storage),
      azure("active_connections", G.Connections),
      azure("connections_failed", G.Connections),
      azure("is_db_alive", G.Availability),
      azure("cpu_credits_remaining", G.Compute),
      azure("storage_used", G.Storage),
      azure("txlogs_storage_used", G.Storage),
      azure("disk_iops_consumed_percentage", G.Storage),
      azure("disk_queue_depth", G.Storage),
      azure("read_iops", G.Storage),
      azure("write_iops", G.Storage),
      azure("connections_succeeded", G.Connections),
      azure("maximum_used_transactionIDs", G.Storage),
      azure("network_bytes_ingress", G.Network),
      azure("network_bytes_egress", G.Network),
      azure("physical_replication_delay_in_seconds", G.Replication),
    ],
  },
  {
    type: "Microsoft.DBforMySQL/flexibleServers",
    metrics: [
      azure("cpu_percent", G.Compute),
      azure("memory_percent", G.Memory),
      azure("storage_percent", G.Storage),
      azure("active_connections", G.Connections),
      azure("aborted_connections", G.Connections),
      azure("io_consumption_percent", G.Storage),
      azure("storage_used", G.Storage),
      azure("total_connections", G.Connections),
      azure("Queries", G.Traffic),
      azure("Slow_queries", G.Latency),
      azure("Threads_running", G.Compute),
      azure("lock_deadlocks", G.Errors),
      azure("network_bytes_ingress", G.Network),
      azure("network_bytes_egress", G.Network),
      azure("replication_lag", G.Replication),
    ],
  },
  {
    type: "Microsoft.DocumentDB/databaseAccounts",
    metrics: [
      azure("TotalRequests", G.Traffic),
      azure("TotalRequestUnits", G.Traffic),
      azure("NormalizedRUConsumption", G.Compute),
      azure("ServerSideLatency", G.Latency),
      azure("ServerSideLatencyGateway", G.Latency),
      azure("ServerSideLatencyDirect", G.Latency),
      azure("ThrottledRequestPercentage", G.Errors),
      azure("ReplicationLatency", G.Replication),
      azure("ServiceAvailability", G.Availability),
    ],
    notExportedByDiagnosticSettings: [
      "TotalRequests",
      "TotalRequestUnits",
      "NormalizedRUConsumption",
      "ServerSideLatency",
      "ServerSideLatencyGateway",
      "ServerSideLatencyDirect",
      "ThrottledRequestPercentage",
      "ReplicationLatency",
      "ServiceAvailability",
    ],
  },
  {
    type: "Microsoft.Cache/redis",
    metrics: [
      azure("percentProcessorTime", G.Compute),
      azure("usedmemorypercentage", G.Memory),
      azure("connectedclients", G.Connections),
      azure("serverLoad", G.Compute),
      azure("errors", G.Errors),
      azure("operationsPerSecond", G.Traffic),
      azure("cacheRead", G.Network),
      azure("cacheWrite", G.Network),
      azure("cachehits", G.Cache),
      azure("cachemisses", G.Cache),
      azure("evictedkeys", G.Cache),
      azure("expiredkeys", G.Cache),
      azure("totalkeys", G.Cache),
      azure("usedmemory", G.Memory),
      azure("LatencyP99", G.Latency),
      azure("GeoReplicationHealthy", G.Replication),
    ],
  },
  {
    type: "Microsoft.Cache/redisEnterprise",
    metrics: [
      azure("serverLoad", G.Compute),
      azure("percentProcessorTime", G.Compute),
      azure("usedmemorypercentage", G.Memory),
      azure("usedmemory", G.Memory),
      azure("connectedclients", G.Connections),
      azure("operationsPerSecond", G.Traffic),
      azure("cacheRead", G.Network),
      azure("cacheWrite", G.Network),
      azure("cachehits", G.Cache),
      azure("cachemisses", G.Cache),
      azure("evictedkeys", G.Cache),
      azure("expiredkeys", G.Cache),
      azure("totalkeys", G.Cache),
      azure("cacheLatency", G.Latency),
      azure("geoReplicationHealthy", G.Replication),
    ],
  },
  {
    type: "Microsoft.Storage/storageAccounts",
    metrics: [
      azure("Transactions", G.Traffic),
      azure("Availability", G.Availability),
      azure("SuccessE2ELatency", G.Latency),
      azure("UsedCapacity", G.Storage),
      azure("SuccessServerLatency", G.Latency),
      azure("Ingress", G.Network),
      azure("Egress", G.Network),
    ],
    notExportedByDiagnosticSettings: ["UsedCapacity"],
  },
  {
    type: "Microsoft.KeyVault/vaults",
    metrics: [
      azure("ServiceApiHit", G.Traffic),
      azure("ServiceApiLatency", G.Latency),
      azure("Availability", G.Availability),
      azure("SaturationShoebox", G.Compute),
    ],
    notExportedByDiagnosticSettings: ["SaturationShoebox"],
  },
  {
    type: "Microsoft.ServiceBus/namespaces",
    metrics: [
      azure("IncomingMessages", G.Traffic),
      azure("OutgoingMessages", G.Traffic),
      azure("ActiveMessages", G.Backlog),
      azure("DeadletteredMessages", G.Backlog),
      azure("ServerErrors", G.Errors),
      azure("ThrottledRequests", G.Errors),
    ],
    splitByDimension: AZURE_ENTITY_NAME_DIMENSION,
    notExportedByDiagnosticSettings: [
      "ActiveMessages",
      "DeadletteredMessages",
      "ServerErrors",
      "ThrottledRequests",
    ],
  },
  {
    type: "Microsoft.EventHub/namespaces",
    metrics: [
      azure("IncomingMessages", G.Traffic),
      azure("OutgoingMessages", G.Traffic),
      azure("ThrottledRequests", G.Errors),
      azure("ServerErrors", G.Errors),
    ],
    splitByDimension: AZURE_ENTITY_NAME_DIMENSION,
    notExportedByDiagnosticSettings: ["ThrottledRequests", "ServerErrors"],
  },
  {
    type: "Microsoft.EventGrid/topics",
    metrics: [
      azure("PublishSuccessCount", G.Traffic),
      azure("PublishFailCount", G.Errors),
      azure("PublishSuccessLatencyInMs", G.Latency),
      azure("MatchedEventCount", G.Traffic),
      azure("DeliverySuccessCount", G.Traffic),
      azure("DeliveryAttemptFailCount", G.Errors),
      azure("DroppedEventCount", G.Errors),
      azure("DeadLetteredCount", G.Backlog),
      azure("DestinationProcessingDurationInMs", G.Latency),
    ],
    notExportedByDiagnosticSettings: [
      "DeliveryAttemptFailCount",
      "DestinationProcessingDurationInMs",
    ],
  },
  {
    type: "Microsoft.EventGrid/systemTopics",
    metrics: [
      azure("PublishSuccessCount", G.Traffic),
      azure("PublishFailCount", G.Errors),
      azure("PublishSuccessLatencyInMs", G.Latency),
      azure("MatchedEventCount", G.Traffic),
      azure("DeliverySuccessCount", G.Traffic),
      azure("DeliveryAttemptFailCount", G.Errors),
      azure("DroppedEventCount", G.Errors),
      azure("DeadLetteredCount", G.Backlog),
      azure("DestinationProcessingDurationInMs", G.Latency),
    ],
    notExportedByDiagnosticSettings: [
      "DeliveryAttemptFailCount",
      "DestinationProcessingDurationInMs",
    ],
  },
  {
    type: "Microsoft.EventGrid/namespaces",
    metrics: [
      azure("SuccessfulPublishedEvents", G.Traffic),
      azure("FailedPublishedEvents", G.Errors),
      azure("PublishLatencyInMilliseconds", G.Latency),
      azure("SuccessfulReceivedEvents", G.Traffic),
      azure("DeadLetteredCount", G.Backlog),
      azure("DroppedEventCount", G.Errors),
      azure("Mqtt.Connections", G.Connections),
      azure("Mqtt.SuccessfulPublishedMessages", G.Traffic),
      azure("Mqtt.FailedPublishedMessages", G.Errors),
      azure("Mqtt.ThrottlingEnforcements", G.Errors),
      azure("Mqtt.Throughput", G.Network),
    ],
    notExportedByDiagnosticSettings: [
      "SuccessfulPublishedEvents",
      "FailedPublishedEvents",
      "PublishLatencyInMilliseconds",
      "SuccessfulReceivedEvents",
      "DeadLetteredCount",
      "DroppedEventCount",
    ],
  },
  {
    type: "Microsoft.ContainerService/managedClusters",
    metrics: [
      azure("node_cpu_usage_percentage", G.Compute),
      azure("node_memory_working_set_percentage", G.Memory),
      azure("kube_pod_status_ready", G.Availability),
      azure("node_disk_usage_percentage", G.Storage),
      azure("node_network_in_bytes", G.Network),
      azure("node_network_out_bytes", G.Network),
      azure("apiserver_cpu_usage_percentage", G.Compute),
      azure("apiserver_memory_usage_percentage", G.Memory),
      azure("etcd_database_usage_percentage", G.Storage),
    ],
    notExportedByDiagnosticSettings: ["kube_pod_status_ready"],
  },
  {
    type: "Microsoft.App/containerApps",
    metrics: [
      azure("Requests", G.Traffic),
      azure("UsageNanoCores", G.Compute),
      azure("WorkingSetBytes", G.Memory),
      azure("RestartCount", G.Availability),
      azure("ResponseTime", G.Latency),
      azure("CpuPercentage", G.Compute),
      azure("MemoryPercentage", G.Memory),
      azure("Replicas", G.Compute),
      azure("RxBytes", G.Network),
      azure("TxBytes", G.Network),
    ],
  },
  {
    type: "Microsoft.ContainerInstance/containerGroups",
    metrics: [
      azure("CpuUsage", G.Compute),
      azure("MemoryUsage", G.Memory),
      azure("NetworkBytesReceivedPerSecond", G.Network),
      azure("NetworkBytesTransmittedPerSecond", G.Network),
    ],
  },
  {
    type: "Microsoft.Network/loadBalancers",
    metrics: [
      azure("VipAvailability", G.Availability),
      azure("DipAvailability", G.Availability),
      azure("ByteCount", G.Traffic),
      azure("PacketCount", G.Traffic),
      azure("SYNCount", G.Connections),
      azure("SnatConnectionCount", G.Connections),
      azure("UsedSnatPorts", G.Connections),
      azure("AllocatedSnatPorts", G.Connections),
    ],
    notExportedByDiagnosticSettings: ["UsedSnatPorts", "AllocatedSnatPorts"],
  },
  {
    type: "Microsoft.Network/applicationGateways",
    metrics: [
      azure("TotalRequests", G.Traffic),
      azure("FailedRequests", G.Errors),
      azure("UnhealthyHostCount", G.Availability),
      azure("ApplicationGatewayTotalTime", G.Latency),
      azure("Throughput", G.Network),
      azure("HealthyHostCount", G.Availability),
      azure("BackendLastByteResponseTime", G.Latency),
      azure("CurrentConnections", G.Connections),
      azure("BytesReceived", G.Network),
      azure("BytesSent", G.Network),
      azure("CapacityUnits", G.Compute),
      azure("ComputeUnits", G.Compute),
    ],
    notExportedByDiagnosticSettings: [
      "ApplicationGatewayTotalTime",
      "Throughput",
      "BackendLastByteResponseTime",
      "CapacityUnits",
      "ComputeUnits",
    ],
  },
  {
    type: "Microsoft.Network/publicIPAddresses",
    metrics: [
      azure("VipAvailability", G.Availability),
      azure("ByteCount", G.Traffic),
      azure("IfUnderDDoSAttack", G.Errors),
      azure("PacketCount", G.Traffic),
      azure("SynCount", G.Connections),
      azure("PacketsDroppedDDoS", G.Errors),
    ],
  },
  {
    type: "Microsoft.Network/networkInterfaces",
    metrics: [
      azure("BytesReceivedRate", G.Network),
      azure("BytesSentRate", G.Network),
      azure("PacketsReceivedRate", G.Network),
      azure("PacketsSentRate", G.Network),
    ],
  },
  {
    type: "Microsoft.Network/azureFirewalls",
    metrics: [
      azure("FirewallHealth", G.Availability),
      azure("Throughput", G.Network),
      azure("SNATPortUtilization", G.Connections),
      azure("DataProcessed", G.Traffic),
      azure("FirewallLatencyPng", G.Latency),
      azure("ApplicationRuleHit", G.Traffic),
      azure("NetworkRuleHit", G.Traffic),
    ],
    notExportedByDiagnosticSettings: ["Throughput"],
  },
  {
    type: "Microsoft.Network/natGateways",
    metrics: [
      azure("ByteCount", G.Traffic),
      azure("SNATConnectionCount", G.Connections),
      azure("DatapathAvailability", G.Availability),
      azure("PacketCount", G.Traffic),
      azure("PacketDropCount", G.Errors),
      azure("TotalConnectionCount", G.Connections),
    ],
    notExportedByDiagnosticSettings: [
      "ByteCount",
      "SNATConnectionCount",
      "DatapathAvailability",
      "PacketCount",
      "PacketDropCount",
      "TotalConnectionCount",
    ],
  },
  {
    type: "Microsoft.Network/virtualNetworkGateways",
    metrics: [
      azure("AverageBandwidth", G.Network),
      azure("TunnelAverageBandwidth", G.Network),
      azure("TunnelIngressBytes", G.Network),
      azure("TunnelEgressBytes", G.Network),
      azure("TunnelIngressPacketDropCount", G.Errors),
      azure("TunnelEgressPacketDropCount", G.Errors),
      azure("BgpPeerStatus", G.Availability),
      azure("P2SConnectionCount", G.Connections),
      azure("P2SBandwidth", G.Network),
    ],
    notExportedByDiagnosticSettings: ["BgpPeerStatus"],
  },
  {
    type: "Microsoft.Network/expressRouteCircuits",
    metrics: [
      azure("BgpAvailability", G.Availability),
      azure("ArpAvailability", G.Availability),
      azure("BitsInPerSecond", G.Network),
      azure("BitsOutPerSecond", G.Network),
      azure("IngressBandwidthUtilization", G.Network),
      azure("EgressBandwidthUtilization", G.Network),
    ],
  },
  {
    type: "Microsoft.Network/frontdoors",
    metrics: [
      azure("RequestCount", G.Traffic),
      azure("BackendHealthPercentage", G.Availability),
      azure("TotalLatency", G.Latency),
      azure("BackendRequestLatency", G.Latency),
      azure("BackendRequestCount", G.Traffic),
      azure("ResponseSize", G.Network),
    ],
  },
  {
    type: "Microsoft.Network/trafficmanagerprofiles",
    metrics: [
      azure(
        "ProbeAgentCurrentEndpointStateByProfileResourceId",
        G.Availability,
      ),
      azure("QpsByEndpoint", G.Traffic),
    ],
  },
  {
    type: "Microsoft.Network/dnszones",
    metrics: [
      azure("QueryVolume", G.Traffic),
      azure("RecordSetCapacityUtilization", G.Storage),
    ],
    notExportedByDiagnosticSettings: [
      "QueryVolume",
      "RecordSetCapacityUtilization",
    ],
  },
  {
    type: "Microsoft.Cdn/profiles",
    metrics: [
      azure("RequestCount", G.Traffic),
      azure("Percentage5XX", G.Errors),
      azure("TotalLatency", G.Latency),
      azure("Percentage4XX", G.Errors),
      azure("OriginLatency", G.Latency),
      azure("OriginHealthPercentage", G.Availability),
      azure("ByteHitRatio", G.Cache),
      azure("OriginRequestCount", G.Traffic),
      azure("ResponseSize", G.Network),
    ],
  },
  {
    type: "Microsoft.ApiManagement/service",
    metrics: [
      azure("Requests", G.Traffic),
      azure("Duration", G.Latency),
      azure("Capacity", G.Compute),
      azure("BackendDuration", G.Latency),
      azure("CpuPercent_Gateway", G.Compute),
      azure("MemoryPercent_Gateway", G.Memory),
    ],
  },
  {
    type: "Microsoft.CognitiveServices/accounts",
    metrics: [
      azure("TotalCalls", G.Traffic),
      azure("TotalErrors", G.Errors),
      azure("Latency", G.Latency),
      azure("SuccessfulCalls", G.Traffic),
      azure("ClientErrors", G.Errors),
      azure("ServerErrors", G.Errors),
      azure("BlockedCalls", G.Errors),
      azure("Ratelimit", G.Errors),
      azure("DataIn", G.Network),
      azure("DataOut", G.Network),
      azure("AzureOpenAIRequests", G.Traffic),
      azure("AzureOpenAIAvailabilityRate", G.Availability),
      azure("AzureOpenAITimeToResponse", G.Latency),
      azure("ProcessedPromptTokens", G.Traffic),
      azure("GeneratedTokens", G.Traffic),
      azure("TokenTransaction", G.Traffic),
    ],
    notExportedByDiagnosticSettings: ["AzureOpenAIAvailabilityRate"],
  },
  {
    type: "Microsoft.ContainerRegistry/registries",
    metrics: [
      azure("TotalPullCount", G.Traffic),
      azure("TotalPushCount", G.Traffic),
      azure("StorageUsed", G.Storage),
      azure("SuccessfulPullCount", G.Traffic),
      azure("SuccessfulPushCount", G.Traffic),
    ],
  },
  {
    type: "Microsoft.Logic/workflows",
    metrics: [
      azure("RunsStarted", G.Traffic),
      azure("RunsFailed", G.Errors),
      azure("RunLatency", G.Latency),
      azure("RunsSucceeded", G.Traffic),
      azure("RunFailurePercentage", G.Errors),
      azure("RunThrottledEvents", G.Errors),
      azure("ActionsFailed", G.Errors),
      azure("ActionThrottledEvents", G.Errors),
      azure("TriggersFailed", G.Errors),
    ],
  },
  {
    type: "Microsoft.DataFactory/factories",
    metrics: [
      azure("PipelineSucceededRuns", G.Traffic),
      azure("PipelineFailedRuns", G.Errors),
      azure("PipelineCancelledRuns", G.Errors),
      azure("ActivitySucceededRuns", G.Traffic),
      azure("ActivityFailedRuns", G.Errors),
      azure("TriggerSucceededRuns", G.Traffic),
      azure("TriggerFailedRuns", G.Errors),
      azure("IntegrationRuntimeCpuPercentage", G.Compute),
      azure("IntegrationRuntimeQueueLength", G.Backlog),
    ],
  },
  {
    type: "Microsoft.Synapse/workspaces",
    metrics: [
      azure("IntegrationPipelineRunsEnded", G.Traffic),
      azure("IntegrationActivityRunsEnded", G.Traffic),
      azure("BuiltinSqlPoolRequestsEnded", G.Traffic),
      azure("BuiltinSqlPoolDataProcessedBytes", G.Traffic),
    ],
    notExportedByDiagnosticSettings: [
      "IntegrationPipelineRunsEnded",
      "IntegrationActivityRunsEnded",
      "BuiltinSqlPoolRequestsEnded",
      "BuiltinSqlPoolDataProcessedBytes",
    ],
  },
  {
    type: "Microsoft.Kusto/clusters",
    metrics: [
      azure("KeepAlive", G.Availability),
      azure("CPU", G.Compute),
      azure("CacheUtilizationFactor", G.Cache),
      azure("IngestionUtilization", G.Compute),
      azure("IngestionLatencyInSeconds", G.Latency),
      azure("QueryDuration", G.Latency),
      azure("TotalNumberOfConcurrentQueries", G.Traffic),
      azure("TotalNumberOfThrottledQueries", G.Errors),
      azure("TotalNumberOfThrottledCommands", G.Errors),
      azure("InstanceCount", G.Compute),
    ],
  },
  {
    type: "Microsoft.StreamAnalytics/streamingjobs",
    metrics: [
      azure("ResourceUtilization", G.Compute),
      azure("ProcessCPUUsagePercentage", G.Compute),
      azure("InputEvents", G.Traffic),
      azure("OutputEvents", G.Traffic),
      azure("Errors", G.Errors),
      azure("DeserializationError", G.Errors),
      azure("DroppedOrAdjustedEvents", G.Errors),
      azure("InputEventsSourcesBacklogged", G.Backlog),
      azure("OutputWatermarkDelaySeconds", G.Backlog),
    ],
  },
  {
    type: "Microsoft.Search/searchServices",
    metrics: [
      azure("SearchLatency", G.Latency),
      azure("SearchQueriesPerSecond", G.Traffic),
      azure("ThrottledSearchQueriesPercentage", G.Errors),
    ],
  },
  {
    type: "Microsoft.SignalRService/SignalR",
    metrics: [
      azure("ConnectionCount", G.Connections),
      azure("MessageCount", G.Traffic),
      azure("ConnectionQuotaUtilization", G.Connections),
      azure("SystemErrors", G.Errors),
      azure("UserErrors", G.Errors),
      azure("ServerLoad", G.Compute),
      azure("ServerConnectionLatency", G.Latency),
      azure("InboundTraffic", G.Network),
      azure("OutboundTraffic", G.Network),
    ],
    notExportedByDiagnosticSettings: ["ServerLoad"],
  },
  {
    type: "Microsoft.Insights/components",
    metrics: [
      azure("requests/count", G.Traffic),
      azure("requests/failed", G.Errors),
      azure("requests/duration", G.Latency),
      azure("exceptions/count", G.Errors),
      azure("dependencies/failed", G.Errors),
      azure("dependencies/duration", G.Latency),
      azure("availabilityResults/availabilityPercentage", G.Availability),
      azure("pageViews/count", G.Traffic),
    ],
    notExportedByDiagnosticSettings: [
      "requests/count",
      "requests/failed",
      "dependencies/failed",
    ],
  },
  {
    type: "Microsoft.Devices/IotHubs",
    metrics: [
      azure("connectedDeviceCount", G.Connections),
      azure("totalDeviceCount", G.Connections),
      azure("d2c.telemetry.ingress.success", G.Traffic),
      azure("d2c.telemetry.ingress.allProtocol", G.Traffic),
      azure("d2c.telemetry.ingress.sendThrottle", G.Errors),
      azure("throttledRequests", G.Errors),
      azure("d2c.telemetry.egress.dropped", G.Errors),
      azure("dailyMessageQuotaUsed", G.Compute),
      azure("d2c.endpoints.latency.builtIn.events", G.Latency),
      azure("c2d.methods.failure", G.Errors),
      azure("jobs.failed", G.Errors),
    ],
    notExportedByDiagnosticSettings: [
      "connectedDeviceCount",
      "totalDeviceCount",
    ],
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

// The Azure Monitor names of a type's key metrics, in order.
export function getAzureKeyMetricNames(type: string): Array<string> {
  return (getAzureKeyMetrics(type || "")?.metrics || []).map(
    (metric: AzureKeyMetric): string => {
      return metric.name;
    },
  );
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

// The aggregations an Azure Monitor metric is read with, as stored.
const AZURE_STORED_AGGREGATIONS: ReadonlyArray<string> = [
  "average",
  "total",
  "maximum",
  "minimum",
  "count",
];

/*
 * Each type's key metrics by every stored name one can be read under
 * (lowercased type -> stored name -> Azure Monitor's name), built once. A
 * read checks every datapoint it writes against it while its subscription
 * streams (CloudStreamedMetrics) - a split namespace's thousand queues
 * included - so a lookup is two map reads, not a stored name built for
 * each metric and aggregation of the type.
 */
const AZURE_KEY_METRICS_BY_STORED_NAME: ReadonlyMap<
  string,
  ReadonlyMap<string, string>
> = new Map(
  AZURE_KEY_METRICS.map(
    (entry: AzureTypeKeyMetrics): [string, ReadonlyMap<string, string>] => {
      const byStoredName: Map<string, string> = new Map<string, string>();

      for (const metric of entry.metrics) {
        for (const aggregation of AZURE_STORED_AGGREGATIONS) {
          const stored: string = getAzureStoredMetricName(
            metric.name,
            aggregation,
          );

          // The type's first metric stored under a name keeps it.
          if (!byStoredName.has(stored)) {
            byStoredName.set(stored, metric.name);
          }
        }
      }

      return [entry.type.toLowerCase(), byStoredName];
    },
  ),
);

/*
 * Whether a cloud connection's read reads this stored metric of the type:
 * one of its key metrics, whatever aggregation its definition calls
 * primary (the read learns that from Azure, so the name is matched with
 * any of them). False for a type with no key metrics.
 */
export function isAzureKeyMetricStoredName(
  type: string,
  storedMetricName: string,
): boolean {
  return getAzureKeyMetricOfStoredName(type, storedMetricName) !== null;
}

/*
 * The key metric of the type a stored metric name is, by Azure Monitor's
 * own name (Network In Total), whatever aggregation it was read with; null
 * for any other name, and for a type with no key metrics.
 */
export function getAzureKeyMetricOfStoredName(
  type: string,
  storedMetricName: string,
): string | null {
  const stored: string = (storedMetricName || "").trim().toLowerCase();

  if (!stored) {
    return null;
  }

  return (
    AZURE_KEY_METRICS_BY_STORED_NAME.get(
      (type || "").trim().toLowerCase(),
    )?.get(stored) || null
  );
}

/*
 * Whether a diagnostic setting exports this key metric of the type (the
 * type's notExportedByDiagnosticSettings does not name it). False for a
 * metric that is no key metric of the type.
 */
export function isAzureKeyMetricExportedByDiagnosticSettings(
  type: string,
  metricName: string,
): boolean {
  const keyMetrics: AzureTypeKeyMetrics | undefined = getAzureKeyMetrics(
    type || "",
  );
  const name: string = (metricName || "").trim().toLowerCase();
  const isNamed: (metrics: Array<string> | undefined) => boolean = (
    metrics: Array<string> | undefined,
  ): boolean => {
    return (metrics || []).some((metric: string): boolean => {
      return metric.toLowerCase() === name;
    });
  };

  return (
    Boolean(keyMetrics && name) &&
    isNamed(getAzureKeyMetricNames(type || "")) &&
    !isNamed(keyMetrics!.notExportedByDiagnosticSettings)
  );
}

/*
 * WHETHER A STREAM WRITES THIS KEY METRIC OF THE TYPE IN PLACE OF THE READ.
 *
 * An Azure stream (diagnostic settings sending to event hubs,
 * CloudStreamAzure) delivers the key metrics a diagnostic setting exports,
 * and while it does, the connection's read leaves them to it
 * (CloudStreamedMetrics) and the stream writes them
 * (AzureDiagnosticRecords). One a diagnostic setting cannot export, the
 * read keeps writing.
 *
 * Never a metric of a type the read splits by a dimension - a Service Bus
 * or Event Hubs namespace: the read writes its queues', topics' and event
 * hubs' own series, which its totals add up (CloudResourceMetricAggregation),
 * while a diagnostic setting exports a metric "flattened ... aggregated
 * across dimension values" (Azure Monitor documentation) - one total for
 * the namespace, which would count each queue's messages a second time
 * beside its own series. So the read writes every metric of such a type,
 * streamed or not, and a stream none.
 *
 * Whether the metric is read a minute at a time - the only grain a stream
 * delivers - is the caller's to check.
 */
export function isAzureStreamedKeyMetric(
  type: string,
  metricName: string,
): boolean {
  return (
    !getAzureKeyMetrics(type || "")?.splitByDimension &&
    isAzureKeyMetricExportedByDiagnosticSettings(type, metricName)
  );
}

// isAzureStreamedKeyMetric of a stored name, as a read's datapoints carry it.
export function isAzureStreamedKeyMetricStoredName(
  type: string,
  storedMetricName: string,
): boolean {
  const metric: string | null = getAzureKeyMetricOfStoredName(
    type,
    storedMetricName,
  );

  return metric !== null && isAzureStreamedKeyMetric(type, metric);
}

/*
 * ---- Google Cloud: Cloud Monitoring --------------------------------------
 *
 * Per monitored resource type: the metric types read and how each is
 * aligned to a minute - the mean of a gauge, the per-second rate of a
 * count, the 95th percentile of a distribution. One call per metric type
 * returns it for every resource of the project. A type's first metric is
 * the one every read asks of every project, to find out whether it has
 * resources of the type (one each of them reports); the type's others are
 * asked only of the projects that have them (GcpCloudConnector).
 *
 * A metric type two resource types report (a Cloud Run container's CPU,
 * for a revision and a job) is listed under each and read once: the one
 * call answers both, and each series is filed on its own resource.
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
  // What it is about, for the resource's Metrics card.
  group: CloudKeyMetricGroup;
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
  group: CloudKeyMetricGroup,
): GcpKeyMetric {
  return { metricType, aligner, unit, group };
}

export const GCP_KEY_METRICS: ReadonlyArray<GcpTypeKeyMetrics> = [
  {
    resourceType: "gce_instance",
    metrics: [
      gcp(
        "compute.googleapis.com/instance/cpu/utilization",
        "ALIGN_MEAN",
        "1",
        G.Compute,
      ),
      gcp(
        "compute.googleapis.com/instance/network/received_bytes_count",
        "ALIGN_RATE",
        "By/s",
        G.Network,
      ),
      gcp(
        "compute.googleapis.com/instance/network/sent_bytes_count",
        "ALIGN_RATE",
        "By/s",
        G.Network,
      ),
      // Only an E2 instance reports it.
      gcp(
        "compute.googleapis.com/instance/memory/balloon/ram_used",
        "ALIGN_MEAN",
        "By",
        G.Memory,
      ),
      gcp(
        "compute.googleapis.com/instance/disk/read_bytes_count",
        "ALIGN_RATE",
        "By/s",
        G.Storage,
      ),
      gcp(
        "compute.googleapis.com/instance/disk/write_bytes_count",
        "ALIGN_RATE",
        "By/s",
        G.Storage,
      ),
      gcp(
        "compute.googleapis.com/instance/disk/read_ops_count",
        "ALIGN_RATE",
        "1/s",
        G.Storage,
      ),
      gcp(
        "compute.googleapis.com/instance/disk/write_ops_count",
        "ALIGN_RATE",
        "1/s",
        G.Storage,
      ),
      gcp(
        "compute.googleapis.com/firewall/dropped_packets_count",
        "ALIGN_RATE",
        "1/s",
        G.Network,
      ),
    ],
  },
  {
    resourceType: "cloudsql_database",
    metrics: [
      gcp(
        "cloudsql.googleapis.com/database/cpu/utilization",
        "ALIGN_MEAN",
        "1",
        G.Compute,
      ),
      gcp(
        "cloudsql.googleapis.com/database/memory/utilization",
        "ALIGN_MEAN",
        "1",
        G.Memory,
      ),
      gcp(
        "cloudsql.googleapis.com/database/disk/utilization",
        "ALIGN_MEAN",
        "1",
        G.Storage,
      ),
      gcp(
        "cloudsql.googleapis.com/database/network/connections",
        "ALIGN_MEAN",
        "1",
        G.Connections,
      ),
      gcp(
        "cloudsql.googleapis.com/database/up",
        "ALIGN_MEAN",
        "1",
        G.Availability,
      ),
      gcp(
        "cloudsql.googleapis.com/database/disk/bytes_used",
        "ALIGN_MEAN",
        "By",
        G.Storage,
      ),
      gcp(
        "cloudsql.googleapis.com/database/disk/read_ops_count",
        "ALIGN_RATE",
        "1/s",
        G.Storage,
      ),
      gcp(
        "cloudsql.googleapis.com/database/disk/write_ops_count",
        "ALIGN_RATE",
        "1/s",
        G.Storage,
      ),
      gcp(
        "cloudsql.googleapis.com/database/network/received_bytes_count",
        "ALIGN_RATE",
        "By/s",
        G.Network,
      ),
      gcp(
        "cloudsql.googleapis.com/database/network/sent_bytes_count",
        "ALIGN_RATE",
        "By/s",
        G.Network,
      ),
      // Only a replica reports it.
      gcp(
        "cloudsql.googleapis.com/database/replication/replica_lag",
        "ALIGN_MAX",
        "s",
        G.Replication,
      ),
    ],
  },
  {
    resourceType: "gcs_bucket",
    metrics: [
      gcp(
        "storage.googleapis.com/api/request_count",
        "ALIGN_RATE",
        "1/s",
        G.Traffic,
      ),
      gcp(
        "storage.googleapis.com/storage/total_bytes",
        "ALIGN_MEAN",
        "By",
        G.Storage,
      ),
      gcp(
        "storage.googleapis.com/storage/object_count",
        "ALIGN_MEAN",
        "1",
        G.Storage,
      ),
    ],
  },
  {
    resourceType: "https_lb_rule",
    metrics: [
      gcp(
        "loadbalancing.googleapis.com/https/request_count",
        "ALIGN_RATE",
        "1/s",
        G.Traffic,
      ),
      gcp(
        "loadbalancing.googleapis.com/https/total_latencies",
        "ALIGN_PERCENTILE_95",
        "ms",
        G.Latency,
      ),
      gcp(
        "loadbalancing.googleapis.com/https/backend_latencies",
        "ALIGN_PERCENTILE_95",
        "ms",
        G.Latency,
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
        G.Traffic,
      ),
      gcp(
        "loadbalancing.googleapis.com/https/internal/total_latencies",
        "ALIGN_PERCENTILE_95",
        "ms",
        G.Latency,
      ),
      gcp(
        "loadbalancing.googleapis.com/https/internal/backend_latencies",
        "ALIGN_PERCENTILE_95",
        "ms",
        G.Latency,
      ),
    ],
  },
  {
    resourceType: "cloud_run_revision",
    metrics: [
      gcp("run.googleapis.com/request_count", "ALIGN_RATE", "1/s", G.Traffic),
      gcp(
        "run.googleapis.com/request_latencies",
        "ALIGN_PERCENTILE_95",
        "ms",
        G.Latency,
      ),
      gcp(
        "run.googleapis.com/container/instance_count",
        "ALIGN_MAX",
        "1",
        G.Compute,
      ),
      gcp(
        "run.googleapis.com/container/cpu/utilizations",
        "ALIGN_PERCENTILE_95",
        "1",
        G.Compute,
      ),
      gcp(
        "run.googleapis.com/container/memory/utilizations",
        "ALIGN_PERCENTILE_95",
        "1",
        G.Memory,
      ),
      gcp(
        "run.googleapis.com/container/max_request_concurrencies",
        "ALIGN_PERCENTILE_95",
        "1",
        G.Traffic,
      ),
      gcp(
        "run.googleapis.com/container/billable_instance_time",
        "ALIGN_RATE",
        "s/s",
        G.Compute,
      ),
    ],
  },
  {
    resourceType: "cloud_run_job",
    metrics: [
      gcp(
        "run.googleapis.com/job/completed_execution_count",
        "ALIGN_RATE",
        "1/s",
        G.Traffic,
      ),
      gcp(
        "run.googleapis.com/job/running_executions",
        "ALIGN_MAX",
        "1",
        G.Traffic,
      ),
      gcp(
        "run.googleapis.com/container/cpu/utilizations",
        "ALIGN_PERCENTILE_95",
        "1",
        G.Compute,
      ),
      gcp(
        "run.googleapis.com/container/memory/utilizations",
        "ALIGN_PERCENTILE_95",
        "1",
        G.Memory,
      ),
    ],
  },
  {
    resourceType: "cloud_function",
    metrics: [
      gcp(
        "cloudfunctions.googleapis.com/function/execution_count",
        "ALIGN_RATE",
        "1/s",
        G.Traffic,
      ),
      gcp(
        "cloudfunctions.googleapis.com/function/execution_times",
        "ALIGN_PERCENTILE_95",
        "ns",
        G.Latency,
      ),
      gcp(
        "cloudfunctions.googleapis.com/function/user_memory_bytes",
        "ALIGN_PERCENTILE_95",
        "By",
        G.Memory,
      ),
      gcp(
        "cloudfunctions.googleapis.com/function/active_instances",
        "ALIGN_MAX",
        "1",
        G.Compute,
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
        G.Backlog,
      ),
      gcp(
        "pubsub.googleapis.com/subscription/oldest_unacked_message_age",
        "ALIGN_MAX",
        "s",
        G.Backlog,
      ),
      gcp(
        "pubsub.googleapis.com/subscription/sent_message_count",
        "ALIGN_RATE",
        "1/s",
        G.Traffic,
      ),
      gcp(
        "pubsub.googleapis.com/subscription/ack_message_count",
        "ALIGN_RATE",
        "1/s",
        G.Traffic,
      ),
      gcp(
        "pubsub.googleapis.com/subscription/expired_ack_deadlines_count",
        "ALIGN_RATE",
        "1/s",
        G.Errors,
      ),
      gcp(
        "pubsub.googleapis.com/subscription/dead_letter_message_count",
        "ALIGN_RATE",
        "1/s",
        G.Errors,
      ),
    ],
  },
  {
    resourceType: "pubsub_topic",
    metrics: [
      /*
       * Deprecated by Google for a count of topic/message_sizes, which a
       * read cannot take yet (it reads a distribution as one percentile):
       * kept while the topic's headline reads it (CloudResourceHealth).
       */
      gcp(
        "pubsub.googleapis.com/topic/send_message_operation_count",
        "ALIGN_RATE",
        "1/s",
        G.Traffic,
      ),
      gcp(
        "pubsub.googleapis.com/topic/send_request_count",
        "ALIGN_RATE",
        "1/s",
        G.Traffic,
      ),
      gcp(
        "pubsub.googleapis.com/topic/message_sizes",
        "ALIGN_PERCENTILE_95",
        "By",
        G.Traffic,
      ),
    ],
  },
  {
    resourceType: "redis_instance",
    metrics: [
      gcp(
        "redis.googleapis.com/stats/memory/usage_ratio",
        "ALIGN_MEAN",
        "1",
        G.Memory,
      ),
      gcp(
        "redis.googleapis.com/clients/connected",
        "ALIGN_MEAN",
        "1",
        G.Connections,
      ),
      gcp(
        "redis.googleapis.com/stats/memory/system_memory_usage_ratio",
        "ALIGN_MEAN",
        "1",
        G.Memory,
      ),
      gcp(
        "redis.googleapis.com/stats/cache_hit_ratio",
        "ALIGN_MEAN",
        "1",
        G.Cache,
      ),
      gcp(
        "redis.googleapis.com/stats/evicted_keys",
        "ALIGN_RATE",
        "1/s",
        G.Cache,
      ),
      gcp("redis.googleapis.com/keyspace/keys", "ALIGN_MEAN", "1", G.Cache),
      gcp(
        "redis.googleapis.com/stats/cpu_utilization",
        "ALIGN_RATE",
        "s{CPU}/s",
        G.Compute,
      ),
      gcp(
        "redis.googleapis.com/stats/reject_connections_count",
        "ALIGN_RATE",
        "1/s",
        G.Errors,
      ),
      gcp(
        "redis.googleapis.com/stats/network_traffic",
        "ALIGN_RATE",
        "By/s",
        G.Network,
      ),
      gcp(
        "redis.googleapis.com/replication/master/slaves/lag",
        "ALIGN_MAX",
        "s",
        G.Replication,
      ),
    ],
  },
  {
    resourceType: "spanner_instance",
    metrics: [
      gcp(
        "spanner.googleapis.com/instance/cpu/utilization",
        "ALIGN_MEAN",
        "1",
        G.Compute,
      ),
      gcp(
        "spanner.googleapis.com/instance/cpu/smoothed_utilization",
        "ALIGN_MEAN",
        "1",
        G.Compute,
      ),
      gcp(
        "spanner.googleapis.com/instance/storage/utilization",
        "ALIGN_MEAN",
        "1",
        G.Storage,
      ),
      gcp(
        "spanner.googleapis.com/instance/storage/used_bytes",
        "ALIGN_MEAN",
        "By",
        G.Storage,
      ),
      gcp(
        "spanner.googleapis.com/api/request_count",
        "ALIGN_MEAN",
        "1/s",
        G.Traffic,
      ),
      gcp(
        "spanner.googleapis.com/api/request_latencies",
        "ALIGN_PERCENTILE_95",
        "s",
        G.Latency,
      ),
    ],
  },
  {
    resourceType: "cloud_tasks_queue",
    metrics: [
      gcp("cloudtasks.googleapis.com/queue/depth", "ALIGN_MAX", "1", G.Backlog),
      gcp(
        "cloudtasks.googleapis.com/queue/task_attempt_count",
        "ALIGN_RATE",
        "1/s",
        G.Traffic,
      ),
      gcp(
        "cloudtasks.googleapis.com/queue/task_attempt_delays",
        "ALIGN_PERCENTILE_95",
        "ms",
        G.Latency,
      ),
    ],
  },
  {
    resourceType: "gae_app",
    metrics: [
      gcp(
        "appengine.googleapis.com/http/server/response_count",
        "ALIGN_RATE",
        "1/s",
        G.Traffic,
      ),
      gcp(
        "appengine.googleapis.com/http/server/response_latencies",
        "ALIGN_PERCENTILE_95",
        "ms",
        G.Latency,
      ),
      gcp(
        "appengine.googleapis.com/system/instance_count",
        "ALIGN_MAX",
        "1",
        G.Compute,
      ),
    ],
  },
  {
    resourceType: "nat_gateway",
    metrics: [
      gcp(
        "router.googleapis.com/nat/sent_bytes_count",
        "ALIGN_RATE",
        "By/s",
        G.Network,
      ),
      gcp(
        "router.googleapis.com/nat/received_bytes_count",
        "ALIGN_RATE",
        "By/s",
        G.Network,
      ),
      gcp(
        "router.googleapis.com/nat/open_connections",
        "ALIGN_MAX",
        "{connection}",
        G.Connections,
      ),
      gcp(
        "router.googleapis.com/nat/new_connections_count",
        "ALIGN_RATE",
        "{connection}/s",
        G.Connections,
      ),
      gcp(
        "router.googleapis.com/nat/port_usage",
        "ALIGN_MAX",
        "{port}",
        G.Connections,
      ),
      gcp(
        "router.googleapis.com/nat/dropped_sent_packets_count",
        "ALIGN_RATE",
        "{packet}/s",
        G.Errors,
      ),
    ],
  },
  {
    resourceType: "vpn_gateway",
    metrics: [
      gcp(
        "vpn.googleapis.com/tunnel_established",
        "ALIGN_MEAN",
        "1",
        G.Availability,
      ),
      gcp(
        "vpn.googleapis.com/network/sent_bytes_count",
        "ALIGN_RATE",
        "By/s",
        G.Network,
      ),
      gcp(
        "vpn.googleapis.com/network/received_bytes_count",
        "ALIGN_RATE",
        "By/s",
        G.Network,
      ),
      gcp(
        "vpn.googleapis.com/network/dropped_sent_packets_count",
        "ALIGN_RATE",
        "1/s",
        G.Errors,
      ),
      gcp(
        "vpn.googleapis.com/network/dropped_received_packets_count",
        "ALIGN_RATE",
        "1/s",
        G.Errors,
      ),
      gcp(
        "vpn.googleapis.com/gateway/connections",
        "ALIGN_MAX",
        "1",
        G.Connections,
      ),
    ],
  },
  {
    resourceType: "filestore_instance",
    metrics: [
      gcp(
        "file.googleapis.com/nfs/server/used_bytes_percent",
        "ALIGN_MEAN",
        "%",
        G.Storage,
      ),
      gcp(
        "file.googleapis.com/nfs/server/used_bytes",
        "ALIGN_MEAN",
        "By",
        G.Storage,
      ),
      gcp(
        "file.googleapis.com/nfs/server/read_ops_count",
        "ALIGN_RATE",
        "{operation}/s",
        G.Storage,
      ),
      gcp(
        "file.googleapis.com/nfs/server/write_ops_count",
        "ALIGN_RATE",
        "{operation}/s",
        G.Storage,
      ),
      gcp(
        "file.googleapis.com/nfs/server/read_bytes_count",
        "ALIGN_RATE",
        "By/s",
        G.Storage,
      ),
      gcp(
        "file.googleapis.com/nfs/server/write_bytes_count",
        "ALIGN_RATE",
        "By/s",
        G.Storage,
      ),
      gcp(
        "file.googleapis.com/nfs/server/average_read_latency",
        "ALIGN_MEAN",
        "ms",
        G.Latency,
      ),
      gcp(
        "file.googleapis.com/nfs/server/average_write_latency",
        "ALIGN_MEAN",
        "ms",
        G.Latency,
      ),
    ],
  },
];

/*
 * Every metric type read, once, with the first resource type it is listed
 * under: a type two resource types report is one call.
 */
export function getGcpKeyMetricTypes(): Array<
  GcpKeyMetric & { resourceType: string }
> {
  const metrics: Array<GcpKeyMetric & { resourceType: string }> = [];
  const seen: Set<string> = new Set<string>();

  for (const entry of GCP_KEY_METRICS) {
    for (const metric of entry.metrics) {
      if (seen.has(metric.metricType)) {
        continue;
      }

      seen.add(metric.metricType);
      metrics.push({ ...metric, resourceType: entry.resourceType });
    }
  }

  return metrics;
}

// The resource types a metric type is listed under, in the catalog's order.
export function getGcpResourceTypesOfMetric(metricType: string): Array<string> {
  return GCP_KEY_METRICS.filter((entry: GcpTypeKeyMetrics): boolean => {
    return entry.metrics.some((metric: GcpKeyMetric): boolean => {
      return metric.metricType === metricType;
    });
  }).map((entry: GcpTypeKeyMetrics): string => {
    return entry.resourceType;
  });
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

/*
 * ---- A key metric, whichever cloud it is from ----------------------------
 *
 * What a resource's Metrics card needs of a metric it lists: whether it is
 * one of the key metrics its connection reads for the resource's type,
 * what it is about, and where it comes among the type's others.
 */

export interface CloudKeyMetricReference {
  /*
   * The cloud's own name for it: Azure Monitor's ("Percentage CPU"),
   * CloudWatch's ("CPUUtilization"), or the Cloud Monitoring metric type.
   */
  name: string;
  group: CloudKeyMetricGroup;
  // Its place among its type's (or namespace's) key metrics, most telling first.
  rank: number;
}

/*
 * The CloudWatch namespace and metric of a stored CloudWatch name
 * ("amazonaws.com/AWS/EC2/CPUUtilization" -> AWS/EC2, CPUUtilization),
 * whatever its case; null for any other name. The namespace is the name's
 * part between the prefix and its last slash: a metric's own name holds
 * none ("GetRecords.IteratorAgeMilliseconds").
 */
export function parseAwsStoredMetricName(
  storedMetricName: string,
): { namespace: string; metricName: string } | null {
  const name: string = (storedMetricName || "").trim();
  const prefix: string = "amazonaws.com/";

  if (!name.toLowerCase().startsWith(prefix)) {
    return null;
  }

  const rest: string = name.slice(prefix.length);
  const slash: number = rest.lastIndexOf("/");

  if (slash <= 0 || slash === rest.length - 1) {
    return null;
  }

  return { namespace: rest.slice(0, slash), metricName: rest.slice(slash + 1) };
}

function findAwsKeyMetric(
  storedMetricName: string,
): CloudKeyMetricReference | null {
  const parsed: { namespace: string; metricName: string } | null =
    parseAwsStoredMetricName(storedMetricName);
  const entry: AwsNamespaceKeyMetrics | undefined = parsed
    ? getAwsKeyMetrics(parsed.namespace)
    : undefined;

  if (!parsed || !entry) {
    return null;
  }

  const wanted: string = parsed.metricName.toLowerCase();
  const rank: number = entry.metrics.findIndex(
    (metric: AwsKeyMetric): boolean => {
      return metric.metricName.toLowerCase() === wanted;
    },
  );

  if (rank < 0) {
    return null;
  }

  const metric: AwsKeyMetric = entry.metrics[rank]!;

  return { name: metric.metricName, group: metric.group, rank };
}

function findAzureKeyMetric(
  type: string,
  storedMetricName: string,
): CloudKeyMetricReference | null {
  const name: string | null = getAzureKeyMetricOfStoredName(
    type,
    storedMetricName,
  );
  const metrics: Array<AzureKeyMetric> =
    getAzureKeyMetrics(type || "")?.metrics || [];
  const rank: number = name
    ? metrics.findIndex((metric: AzureKeyMetric): boolean => {
        return metric.name === name;
      })
    : -1;

  if (rank < 0) {
    return null;
  }

  return { name: metrics[rank]!.name, group: metrics[rank]!.group, rank };
}

function findGcpKeyMetric(
  type: string,
  storedMetricName: string,
): CloudKeyMetricReference | null {
  const wanted: string = (storedMetricName || "").trim().toLowerCase();
  const resourceType: string = (type || "").trim().toLowerCase();
  let found: CloudKeyMetricReference | null = null;

  for (const entry of GCP_KEY_METRICS) {
    const rank: number = entry.metrics.findIndex(
      (metric: GcpKeyMetric): boolean => {
        return metric.metricType.toLowerCase() === wanted;
      },
    );

    if (rank < 0) {
      continue;
    }

    const reference: CloudKeyMetricReference = {
      name: entry.metrics[rank]!.metricType,
      group: entry.metrics[rank]!.group,
      rank,
    };

    // The resource's own type's place for it, else the first type's.
    if (entry.resourceType.toLowerCase() === resourceType) {
      return reference;
    }

    found = found || reference;
  }

  return found;
}

/*
 * The key metric a stored metric name is, for a resource of this provider
 * and type - null for a metric no connection reads as a key metric (one a
 * collector or an app sends), and for a provider OneUptime has no key
 * metrics of. Names are matched without regard to case, as ingest lowers
 * them.
 */
export function getCloudKeyMetricOfStoredName(data: {
  provider: string | null | undefined;
  type: string | null | undefined;
  metricName: string | null | undefined;
}): CloudKeyMetricReference | null {
  const metricName: string = (data.metricName || "").trim();

  if (!metricName) {
    return null;
  }

  switch ((data.provider || "").trim().toLowerCase()) {
    case CloudProvider.AWS:
      return findAwsKeyMetric(metricName);
    case CloudProvider.Azure:
      return findAzureKeyMetric(data.type || "", metricName);
    case CloudProvider.GCP:
      return findGcpKeyMetric(data.type || "", metricName);
    default:
      return null;
  }
}

/*
 * The order two key metrics of one resource are listed in: by their
 * groups' order, then by their place in their type. Negative when `a`
 * comes first.
 */
export function compareCloudKeyMetrics(
  a: CloudKeyMetricReference,
  b: CloudKeyMetricReference,
): number {
  const byGroup: number =
    getCloudKeyMetricGroupOrder(a.group) - getCloudKeyMetricGroupOrder(b.group);

  return byGroup !== 0 ? byGroup : a.rank - b.rank;
}
