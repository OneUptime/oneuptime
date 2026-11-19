import { CloudProvider } from "./CloudPlatform";
import {
  AWS_CLOUDWATCH_RESOURCE_RULES,
  AwsCloudWatchResourceRule,
} from "./CloudResourceCatalog";
import {
  CloudKeyMetricGroup,
  getCloudKeyMetricGroupOrder,
} from "./CloudKeyMetricGroup";
import { CloudKeyMetricCondition } from "./CloudKeyMetricCondition";

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
 *     each at its finest grain, one grain finer than an hour a type (one
 *     call a read), but for the few metrics kept at five minutes at their
 *     finest that are marked as earning a call of their own, read every 15
 *     minutes (AzureKeyMetric.grain);
 *   - CloudWatch bills each metric of each resource, so AWS reads fewer:
 *     the ones that say whether it is up, busy, failing, slow or full;
 *   - Cloud Monitoring answers one metric type for every resource of a
 *     project in one call, and a read only asks the types of resources a
 *     project has (GcpCloudConnector) - and an agent's metrics only of the
 *     projects where an agent reports them.
 *
 * A metric its provider deprecates is no key metric: a type that read one
 * reads what replaces it, and still reads the old one as it did before
 * (`retired`), so a monitor someone built on it keeps working until it is
 * moved.
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
const C: typeof CloudKeyMetricCondition = CloudKeyMetricCondition;

/*
 * A key metric only the resources a condition holds for report: a replica's
 * lag, a burstable VM's credits (CloudKeyMetricCondition). A resource's page
 * says so beside one it did not report (CloudUnreportedKeyMetrics).
 */
function when<T extends { onlyWhen?: CloudKeyMetricCondition | undefined }>(
  condition: CloudKeyMetricCondition,
  metric: T,
): T {
  return { ...metric, onlyWhen: condition };
}

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
  /*
   * The first version of the stream template whose key-metric filters
   * carry it (AWS_STREAM_TEMPLATE_VERSION, CloudStreamTemplate): 1 for the
   * key metrics every stack has carried since streams began, 2 for those
   * added since. A stack is made once, from the template of its day, so a
   * stack of an older template does not carry a metric added after it, and
   * the read keeps reading and writing that metric for its account
   * (AwsStreamStack, CloudStreamedMetrics) until the stack is made again
   * from a newer template. Null for a metric no stream writes: S3's daily
   * storage, which a metric stream does not carry, and ACM's DaysToExpiry,
   * published twice a day and read once an hour - a stream would bring it
   * an hour sooner, which is nothing to a count of days. The read always
   * writes those, and a stream of every metric that delivers one leaves it
   * to the read (CloudWatchMetricStream), so nothing is written twice.
   */
  streamedSince: number | null;
  /*
   * Only the series whose named dimensions hold one of these values, or do
   * not carry the dimension at all, are this metric's: a Network
   * Firewall's ReceivedPackets is published once for each engine that saw
   * a packet, and only its Stateless (Classic policy) or System (Next
   * Generation policy) engine's series counts every packet the firewall
   * received - summed with the Firewall engine's, a packet would count
   * twice. The read lists and reads only these (AwsCloudConnector), and a
   * stream's other series of it are left out (CloudWatchMetricStream).
   */
  onlyDimensionValues?: Readonly<Record<string, ReadonlyArray<string>>>;
  /*
   * Only some resources of the namespace report it, and this is the
   * condition, from the service's own CloudWatch page: a metric published
   * only when it is not zero, or only by some resources
   * (CloudKeyMetricsProviderReference.test holds each to it).
   */
  onlyWhen?: CloudKeyMetricCondition | undefined;
  /*
   * Only resources of these types report it, of the several a namespace's
   * series are filed under (CloudResourceCatalog): an ECS cluster's
   * reservations and not its services', a REST API's 5XXError and an HTTP
   * API's 5xx. Unset: every type of the namespace.
   */
  onlyTypes?: ReadonlyArray<string> | undefined;
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
  /*
   * The metrics a sweep asks whether the namespace has resources in a
   * Region (AwsCloudConnector), when its first metric is not one every
   * resource of it reports: an Amazon MQ broker reports CpuUtilization on
   * ActiveMQ and SystemCpuUtilization on RabbitMQ. Default: the first
   * metric alone.
   */
  probeMetricNames?: Array<string> | undefined;
}

export const AWS_DEFAULT_PERIOD_SECONDS: number = 300;
export const HOURLY_PERIOD_SECONDS: number = 3600;
export const DAILY_PERIOD_SECONDS: number = 86400;

/*
 * THE VERSIONS OF THE STREAM TEMPLATE (CloudStreamTemplate).
 *
 * The template a stream's stack is made from says its version to OneUptime
 * with every delivery (CloudStreamStack), and its key-metric filters carry
 * every key metric of a version up to its own (AwsKeyMetric.streamedSince).
 *
 *   - 1: the key metrics every stack has carried since streams began. A
 *     stack that says no version is held to these: one made before stacks
 *     said theirs, or one set up another way, with Terraform or the
 *     console, whose filters OneUptime cannot know.
 *   - 2: every key metric read every five minutes, the ones added since
 *     streams began too.
 *
 * A key metric added to the catalog after a version is written is streamed
 * since the next one, never the current one: stacks of the current version
 * are out there and do not carry it. CloudStreamTemplate.test pins what
 * each version carries.
 */
export const AWS_STREAM_TEMPLATE_UNVERSIONED: number = 1;
export const AWS_STREAM_TEMPLATE_VERSION: number = 2;

// A key metric every key-metric stack carries, since streams began - but a daily or hourly one.
function aws(
  metricName: string,
  statistic: AwsStatistic,
  unit: string,
  group: CloudKeyMetricGroup,
  periodSeconds: number = AWS_DEFAULT_PERIOD_SECONDS,
): AwsKeyMetric {
  return {
    metricName,
    statistic,
    unit,
    group,
    periodSeconds,
    streamedSince:
      periodSeconds <= AWS_DEFAULT_PERIOD_SECONDS
        ? AWS_STREAM_TEMPLATE_UNVERSIONED
        : null,
  };
}

/*
 * A key metric added since streams began, read every five minutes: the
 * stacks of template 2 on carry it, and an older stack's account has it
 * read and written by the read.
 */
function aws2(
  metricName: string,
  statistic: AwsStatistic,
  unit: string,
  group: CloudKeyMetricGroup,
  options: {
    onlyDimensionValues?: Readonly<Record<string, ReadonlyArray<string>>>;
  } = {},
): AwsKeyMetric {
  return {
    metricName,
    statistic,
    unit,
    group,
    periodSeconds: AWS_DEFAULT_PERIOD_SECONDS,
    streamedSince: 2,
    ...(options.onlyDimensionValues
      ? { onlyDimensionValues: options.onlyDimensionValues }
      : {}),
  };
}

// A key metric only resources of these types of its namespace report.
function onlyOf(
  types: ReadonlyArray<string>,
  metric: AwsKeyMetric,
): AwsKeyMetric {
  return { ...metric, onlyTypes: types };
}

const ECS_CLUSTER: ReadonlyArray<string> = ["AWS::ECS::Cluster"];
const REST_API: ReadonlyArray<string> = ["AWS::ApiGateway::RestApi"];
const HTTP_API: ReadonlyArray<string> = ["AWS::ApiGatewayV2::Api"];

export const AWS_KEY_METRICS: ReadonlyArray<AwsNamespaceKeyMetrics> = [
  {
    namespace: "AWS/EC2",
    metrics: [
      aws("CPUUtilization", "Average", "Percent", G.Compute),
      aws("NetworkIn", "Sum", "Bytes", G.Network),
      aws("NetworkOut", "Sum", "Bytes", G.Network),
      aws("StatusCheckFailed", "Maximum", "Count", G.Availability),
      // A burstable (T) instance's credits; a Nitro instance's EBS throughput.
      when(
        C.Burstable,
        aws2("CPUCreditBalance", "Average", "Count", G.Compute),
      ),
      when(C.Kind, aws2("EBSReadBytes", "Sum", "Bytes", G.Storage)),
      when(C.Kind, aws2("EBSWriteBytes", "Sum", "Bytes", G.Storage)),
    ],
  },
  {
    namespace: "AWS/EBS",
    metrics: [
      aws("VolumeReadOps", "Sum", "Count", G.Storage),
      aws("VolumeWriteOps", "Sum", "Count", G.Storage),
      aws("VolumeQueueLength", "Average", "Count", G.Storage),
      aws2("VolumeReadBytes", "Sum", "Bytes", G.Storage),
      aws2("VolumeWriteBytes", "Sum", "Bytes", G.Storage),
      // gp2, st1 and sc1 volumes only.
      when(C.Tier, aws2("BurstBalance", "Average", "Percent", G.Storage)),
    ],
  },
  {
    namespace: "AWS/ELB",
    metrics: [
      when(C.NonZero, aws("RequestCount", "Sum", "Count", G.Traffic)),
      when(C.NonZero, aws("Latency", "Average", "Seconds", G.Latency)),
      when(C.NonZero, aws("HTTPCode_Backend_5XX", "Sum", "Count", G.Errors)),
      aws("UnHealthyHostCount", "Maximum", "Count", G.Availability),
      aws2("HealthyHostCount", "Average", "Count", G.Availability),
      when(C.NonZero, aws2("HTTPCode_ELB_5XX", "Sum", "Count", G.Errors)),
      when(C.NonZero, aws2("SurgeQueueLength", "Maximum", "Count", G.Backlog)),
      when(C.NonZero, aws2("SpilloverCount", "Sum", "Count", G.Errors)),
    ],
  },
  {
    namespace: "AWS/ApplicationELB",
    metrics: [
      aws("RequestCount", "Sum", "Count", G.Traffic),
      when(
        C.NonZero,
        aws("TargetResponseTime", "Average", "Seconds", G.Latency),
      ),
      aws("HTTPCode_Target_5XX_Count", "Sum", "Count", G.Errors),
      when(C.NonZero, aws("HTTPCode_ELB_5XX_Count", "Sum", "Count", G.Errors)),
      aws2("HTTPCode_Target_4XX_Count", "Sum", "Count", G.Errors),
      when(
        C.NonZero,
        aws2("RejectedConnectionCount", "Sum", "Count", G.Errors),
      ),
      when(
        C.NonZero,
        aws2("TargetConnectionErrorCount", "Sum", "Count", G.Errors),
      ),
      when(
        C.NonZero,
        aws2("ActiveConnectionCount", "Sum", "Count", G.Connections),
      ),
      when(C.NonZero, aws2("ProcessedBytes", "Sum", "Bytes", G.Traffic)),
    ],
  },
  {
    namespace: "AWS/NetworkELB",
    metrics: [
      aws("ActiveFlowCount", "Average", "Count", G.Connections),
      aws("NewFlowCount", "Sum", "Count", G.Connections),
      aws("ProcessedBytes", "Sum", "Bytes", G.Traffic),
      aws2("TCP_Client_Reset_Count", "Sum", "Count", G.Errors),
      aws2("TCP_Target_Reset_Count", "Sum", "Count", G.Errors),
      aws2("TCP_ELB_Reset_Count", "Sum", "Count", G.Errors),
      aws2("PortAllocationErrorCount", "Sum", "Count", G.Errors),
    ],
  },
  {
    namespace: "AWS/NATGateway",
    metrics: [
      aws("ActiveConnectionCount", "Maximum", "Count", G.Connections),
      aws("BytesOutToDestination", "Sum", "Bytes", G.Network),
      aws("ErrorPortAllocation", "Sum", "Count", G.Errors),
      aws2("PacketsDropCount", "Sum", "Count", G.Errors),
      aws2("BytesInFromDestination", "Sum", "Bytes", G.Network),
      aws2("ConnectionAttemptCount", "Sum", "Count", G.Connections),
      aws2("IdleTimeoutCount", "Sum", "Count", G.Connections),
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
    namespace: "AWS/TransitGateway",
    metrics: [
      aws2("BytesIn", "Sum", "Bytes", G.Network),
      aws2("BytesOut", "Sum", "Bytes", G.Network),
      aws2("PacketDropCountBlackhole", "Sum", "Count", G.Errors),
      aws2("PacketDropCountNoRoute", "Sum", "Count", G.Errors),
    ],
  },
  {
    namespace: "AWS/DX",
    metrics: [
      aws2("ConnectionState", "Minimum", "None", G.Availability),
      when(
        C.Kind,
        aws2("ConnectionBpsEgress", "Average", "Bits/Second", G.Network),
      ),
      when(
        C.Kind,
        aws2("ConnectionBpsIngress", "Average", "Bits/Second", G.Network),
      ),
      when(C.Kind, aws2("ConnectionErrorCount", "Sum", "Count", G.Errors)),
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
      aws2("TotalErrorRate", "Average", "Percent", G.Errors),
      aws2("BytesUploaded", "Sum", "None", G.Network),
    ],
  },
  {
    namespace: "AWS/Route53",
    onlyRegion: "us-east-1",
    metrics: [
      aws("HealthCheckStatus", "Minimum", "None", G.Availability),
      when(
        C.Kind,
        aws(
          "HealthCheckPercentageHealthy",
          "Average",
          "Percent",
          G.Availability,
        ),
      ),
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
      when(C.Tier, aws("PercentIOLimit", "Average", "Percent", G.Storage)),
      aws2("BurstCreditBalance", "Average", "Bytes", G.Storage),
      aws2("DataReadIOBytes", "Sum", "Bytes", G.Storage),
      aws2("DataWriteIOBytes", "Sum", "Bytes", G.Storage),
    ],
  },
  {
    namespace: "AWS/FSx",
    metrics: [
      aws2("DataReadBytes", "Sum", "Bytes", G.Storage),
      aws2("DataWriteBytes", "Sum", "Bytes", G.Storage),
      aws2("DataReadOperations", "Sum", "Count", G.Storage),
      aws2("DataWriteOperations", "Sum", "Count", G.Storage),
      // FSx for Windows File Server only.
      when(C.Kind, aws2("FreeStorageCapacity", "Average", "Bytes", G.Storage)),
    ],
  },
  {
    namespace: "AWS/ECS",
    metrics: [
      aws("CPUUtilization", "Average", "Percent", G.Compute),
      aws("MemoryUtilization", "Average", "Percent", G.Memory),
      /*
       * A cluster's own: what its tasks reserve of its instances. A cluster
       * with only Fargate tasks reserves none.
       */
      onlyOf(
        ECS_CLUSTER,
        when(C.Kind, aws2("CPUReservation", "Average", "Percent", G.Compute)),
      ),
      onlyOf(
        ECS_CLUSTER,
        when(C.Kind, aws2("MemoryReservation", "Average", "Percent", G.Memory)),
      ),
    ],
  },
  {
    namespace: "AWS/Lambda",
    metrics: [
      aws("Invocations", "Sum", "Count", G.Traffic),
      aws("Errors", "Sum", "Count", G.Errors),
      aws("Duration", "Average", "Milliseconds", G.Latency),
      aws("Throttles", "Sum", "Count", G.Errors),
      aws2("ConcurrentExecutions", "Maximum", "Count", G.Compute),
      // Stream and asynchronous event sources only.
      when(C.Setup, aws2("IteratorAge", "Maximum", "Milliseconds", G.Backlog)),
      when(C.Setup, aws2("DeadLetterErrors", "Sum", "Count", G.Errors)),
    ],
  },
  {
    namespace: "AWS/States",
    metrics: [
      aws("ExecutionsStarted", "Sum", "Count", G.Traffic),
      aws("ExecutionsFailed", "Sum", "Count", G.Errors),
      aws("ExecutionTime", "Average", "Milliseconds", G.Latency),
      aws2("ExecutionsSucceeded", "Sum", "Count", G.Traffic),
      aws2("ExecutionsTimedOut", "Sum", "Count", G.Errors),
      aws2("ExecutionsAborted", "Sum", "Count", G.Errors),
      when(C.NonZero, aws2("ExecutionThrottled", "Sum", "Count", G.Errors)),
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
      aws2("ReadIOPS", "Average", "Count/Second", G.Storage),
      aws2("WriteIOPS", "Average", "Count/Second", G.Storage),
      aws2("DiskQueueDepth", "Average", "Count", G.Storage),
      aws2("NetworkReceiveThroughput", "Average", "Bytes/Second", G.Network),
      aws2("NetworkTransmitThroughput", "Average", "Bytes/Second", G.Network),
      // A read replica's own.
      when(C.Replica, aws2("ReplicaLag", "Maximum", "Seconds", G.Replication)),
    ],
  },
  {
    namespace: "AWS/DocDB",
    metrics: [
      aws("CPUUtilization", "Average", "Percent", G.Compute),
      aws("DatabaseConnections", "Average", "Count", G.Connections),
      aws("FreeableMemory", "Average", "Bytes", G.Memory),
      aws2("ReadLatency", "Average", "Milliseconds", G.Latency),
      aws2("WriteLatency", "Average", "Milliseconds", G.Latency),
      when(
        C.Replica,
        aws2("DBInstanceReplicaLag", "Maximum", "Milliseconds", G.Replication),
      ),
    ],
  },
  {
    namespace: "AWS/Neptune",
    metrics: [
      when(C.NonZero, aws2("CPUUtilization", "Average", "Percent", G.Compute)),
      when(C.NonZero, aws2("FreeableMemory", "Average", "Bytes", G.Memory)),
      when(
        C.NonZero,
        aws2("MainRequestQueuePendingRequests", "Sum", "Count", G.Backlog),
      ),
      when(
        C.NonZero,
        aws2("TotalServerErrorsPerSec", "Average", "Count/Second", G.Errors),
      ),
      when(
        C.NonZero,
        aws2("TotalClientErrorsPerSec", "Average", "Count/Second", G.Errors),
      ),
      when(
        C.NonZero,
        aws2("ClusterReplicaLag", "Average", "Milliseconds", G.Replication),
      ),
    ],
  },
  {
    namespace: "AWS/DynamoDB",
    metrics: [
      aws("ConsumedReadCapacityUnits", "Sum", "Count", G.Traffic),
      aws("ConsumedWriteCapacityUnits", "Sum", "Count", G.Traffic),
      aws("ReadThrottleEvents", "Sum", "Count", G.Errors),
      aws("WriteThrottleEvents", "Sum", "Count", G.Errors),
      // A provisioned table's own.
      aws2("ProvisionedReadCapacityUnits", "Average", "Count", G.Compute),
      aws2("ProvisionedWriteCapacityUnits", "Average", "Count", G.Compute),
    ],
  },
  {
    namespace: "AWS/ElastiCache",
    metrics: [
      aws("CPUUtilization", "Average", "Percent", G.Compute),
      aws("CurrConnections", "Average", "Count", G.Connections),
      aws("Evictions", "Sum", "Count", G.Cache),
      when(
        C.Kind,
        aws("DatabaseMemoryUsagePercentage", "Average", "Percent", G.Memory),
      ),
      // Valkey and Redis OSS nodes'.
      when(
        C.Kind,
        aws2("EngineCPUUtilization", "Average", "Percent", G.Compute),
      ),
      when(C.Kind, aws2("CacheHits", "Sum", "Count", G.Cache)),
      when(C.Kind, aws2("CacheMisses", "Sum", "Count", G.Cache)),
      // A read replica's own.
      when(
        C.Replica,
        aws2("ReplicationLag", "Maximum", "Seconds", G.Replication),
      ),
    ],
  },
  {
    namespace: "AWS/MemoryDB",
    metrics: [
      aws2("CPUUtilization", "Average", "Percent", G.Compute),
      aws2("EngineCPUUtilization", "Average", "Percent", G.Compute),
      aws2("DatabaseMemoryUsagePercentage", "Average", "Percent", G.Memory),
      aws2("CurrConnections", "Average", "Count", G.Connections),
      aws2("Evictions", "Sum", "Count", G.Cache),
    ],
  },
  {
    namespace: "AWS/Redshift",
    metrics: [
      aws("CPUUtilization", "Average", "Percent", G.Compute),
      aws("PercentageDiskSpaceUsed", "Average", "Percent", G.Storage),
      aws("DatabaseConnections", "Average", "Count", G.Connections),
      aws2("HealthStatus", "Minimum", "Count", G.Availability),
      aws2("ReadLatency", "Average", "Seconds", G.Latency),
      aws2("WriteLatency", "Average", "Seconds", G.Latency),
    ],
  },
  {
    namespace: "AWS/ES",
    metrics: [
      aws("CPUUtilization", "Average", "Percent", G.Compute),
      aws("FreeStorageSpace", "Minimum", "Megabytes", G.Storage),
      aws("ClusterStatus.red", "Maximum", "Count", G.Availability),
      aws2("ClusterStatus.yellow", "Maximum", "Count", G.Availability),
      aws2("ClusterIndexWritesBlocked", "Maximum", "Count", G.Errors),
      aws2("5xx", "Sum", "Count", G.Errors),
      aws2("SearchLatency", "Average", "Milliseconds", G.Latency),
      aws2("IndexingLatency", "Average", "Milliseconds", G.Latency),
      aws2("JVMMemoryPressure", "Maximum", "Percent", G.Memory),
    ],
  },
  {
    namespace: "AWS/SQS",
    metrics: [
      aws("ApproximateNumberOfMessagesVisible", "Maximum", "Count", G.Backlog),
      when(
        C.NonZero,
        aws("ApproximateAgeOfOldestMessage", "Maximum", "Seconds", G.Backlog),
      ),
      aws("NumberOfMessagesSent", "Sum", "Count", G.Traffic),
      when(
        C.NonZero,
        aws2(
          "ApproximateNumberOfMessagesNotVisible",
          "Maximum",
          "Count",
          G.Backlog,
        ),
      ),
      aws2("NumberOfMessagesDeleted", "Sum", "Count", G.Traffic),
    ],
  },
  {
    namespace: "AWS/SNS",
    metrics: [
      aws("NumberOfMessagesPublished", "Sum", "Count", G.Traffic),
      aws("NumberOfNotificationsFailed", "Sum", "Count", G.Errors),
      aws2("NumberOfNotificationsDelivered", "Sum", "Count", G.Traffic),
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
      aws2("IncomingBytes", "Sum", "Bytes", G.Traffic),
      aws2("WriteProvisionedThroughputExceeded", "Sum", "Count", G.Errors),
      aws2("ReadProvisionedThroughputExceeded", "Sum", "Count", G.Errors),
    ],
  },
  {
    // A Direct PUT stream's incoming records, and an S3 destination's deliveries.
    namespace: "AWS/Firehose",
    metrics: [
      when(C.Kind, aws("IncomingRecords", "Sum", "Count", G.Traffic)),
      when(
        C.Kind,
        aws("DeliveryToS3.Success", "Average", "Count", G.Availability),
      ),
      when(C.Kind, aws2("IncomingBytes", "Sum", "Bytes", G.Traffic)),
      when(C.Kind, aws2("ThrottledRecords", "Sum", "Count", G.Errors)),
      when(
        C.Kind,
        aws2("DeliveryToS3.DataFreshness", "Maximum", "Seconds", G.Backlog),
      ),
    ],
  },
  {
    namespace: "AWS/ApiGateway",
    metrics: [
      aws("Count", "Sum", "Count", G.Traffic),
      onlyOf(REST_API, aws("5XXError", "Sum", "Count", G.Errors)),
      aws("Latency", "Average", "Milliseconds", G.Latency),
      onlyOf(REST_API, aws2("4XXError", "Sum", "Count", G.Errors)),
      aws2("IntegrationLatency", "Average", "Milliseconds", G.Latency),
      /*
       * An HTTP API's errors: it publishes 5xx and 4xx, a REST API 5XXError
       * and 4XXError, so each is listed only for the APIs that publish it.
       */
      onlyOf(HTTP_API, when(C.Kind, aws2("5xx", "Sum", "Count", G.Errors))),
      onlyOf(HTTP_API, when(C.Kind, aws2("4xx", "Sum", "Count", G.Errors))),
    ],
  },
  {
    namespace: "AWS/Events",
    metrics: [
      when(C.NonZero, aws("Invocations", "Sum", "Count", G.Traffic)),
      when(C.NonZero, aws("FailedInvocations", "Sum", "Count", G.Errors)),
      aws2("TriggeredRules", "Sum", "Count", G.Traffic),
      aws2("ThrottledRules", "Sum", "Count", G.Errors),
      aws2("DeadLetterInvocations", "Sum", "Count", G.Errors),
    ],
  },
  {
    /*
     * ActiveMQ and RabbitMQ brokers publish different metrics, CPU
     * included: a sweep asks for either broker's.
     */
    namespace: "AWS/AmazonMQ",
    probeMetricNames: ["CpuUtilization", "SystemCpuUtilization"],
    metrics: [
      when(C.Kind, aws("CpuUtilization", "Average", "Percent", G.Compute)),
      // RabbitMQ.
      when(
        C.Kind,
        aws2("SystemCpuUtilization", "Average", "Percent", G.Compute),
      ),
      when(C.Kind, aws2("MessageCount", "Maximum", "Count", G.Backlog)),
      when(C.Kind, aws2("ConnectionCount", "Maximum", "Count", G.Connections)),
      // ActiveMQ.
      when(C.Kind, aws2("HeapUsage", "Maximum", "Percent", G.Memory)),
      when(C.Kind, aws2("StorePercentUsage", "Maximum", "Percent", G.Storage)),
      when(
        C.Kind,
        aws2("CurrentConnectionsCount", "Maximum", "Count", G.Connections),
      ),
    ],
  },
  {
    namespace: "AWS/Kafka",
    metrics: [
      aws("ActiveControllerCount", "Maximum", "Count", G.Availability),
      aws2("OfflinePartitionsCount", "Maximum", "Count", G.Availability),
      // Each broker's own (Broker ID): a series per broker of the cluster.
      aws2("UnderReplicatedPartitions", "Maximum", "Count", G.Replication),
      aws2("KafkaDataLogsDiskUsed", "Maximum", "Percent", G.Storage),
      aws2("CpuUser", "Average", "Percent", G.Compute),
    ],
  },
  {
    /*
     * A web ACL's requests, by what its rules did with them: its own total
     * is the series whose Rule is ALL (CloudResourceCatalog's rule), each
     * published only when it is not zero. A CloudFront distribution's web
     * ACL publishes in us-east-1, a Region's own in its Region.
     */
    namespace: "AWS/WAFV2",
    probeMetricNames: ["AllowedRequests", "BlockedRequests"],
    metrics: [
      when(C.NonZero, aws2("AllowedRequests", "Sum", "Count", G.Traffic)),
      when(C.NonZero, aws2("BlockedRequests", "Sum", "Count", G.Traffic)),
      when(C.NonZero, aws2("CountedRequests", "Sum", "Count", G.Traffic)),
      when(C.NonZero, aws2("CaptchaRequests", "Sum", "Count", G.Traffic)),
      when(C.NonZero, aws2("ChallengeRequests", "Sum", "Count", G.Traffic)),
    ],
  },
  {
    /*
     * A firewall's packets, per Availability Zone and inspection engine.
     * The packets it received are the Stateless engine's (a Classic
     * policy) or the System engine's (a Next Generation policy), which each
     * count every packet - never also the Firewall engine's, which would
     * count some again. A packet is dropped by one engine, so its drops
     * are every engine's.
     */
    namespace: "AWS/NetworkFirewall",
    metrics: [
      when(
        C.NonZero,
        aws2("ReceivedPackets", "Sum", "Count", G.Traffic, {
          onlyDimensionValues: { Engine: ["Stateless", "System"] },
        }),
      ),
      when(C.NonZero, aws2("DroppedPackets", "Sum", "Count", G.Errors)),
      // Throttled by bursting traffic, among others.
      when(C.NonZero, aws2("OtherDroppedPackets", "Sum", "Count", G.Errors)),
      when(C.NonZero, aws2("InvalidDroppedPackets", "Sum", "Count", G.Errors)),
    ],
  },
  {
    // A service's own, without its instances' (Instance).
    namespace: "AWS/AppRunner",
    metrics: [
      aws2("CPUUtilization", "Average", "Percent", G.Compute),
      aws2("Requests", "Sum", "Count", G.Traffic),
      aws2("5xxStatusResponses", "Sum", "Count", G.Errors),
      aws2("4xxStatusResponses", "Sum", "Count", G.Errors),
      aws2("RequestLatency", "Average", "Milliseconds", G.Latency),
      aws2("MemoryUtilization", "Average", "Percent", G.Memory),
      aws2("ActiveInstances", "Average", "Count", G.Compute),
    ],
  },
  {
    /*
     * An Auto Scaling group's size, once its group metrics collection is
     * on: free, at a minute's grain. A group without it publishes none, so
     * it is never listed and costs nothing to read.
     */
    namespace: "AWS/AutoScaling",
    metrics: [
      when(
        C.Setup,
        aws2("GroupInServiceInstances", "Average", "Count", G.Availability),
      ),
      when(
        C.Setup,
        aws2("GroupDesiredCapacity", "Average", "Count", G.Compute),
      ),
      when(
        C.Setup,
        aws2("GroupPendingInstances", "Maximum", "Count", G.Compute),
      ),
      when(
        C.Setup,
        aws2("GroupTerminatingInstances", "Maximum", "Count", G.Compute),
      ),
    ],
  },
  {
    /*
     * An accelerator's endpoints and traffic, on the accelerator's own
     * series (Accelerator alone). Global Accelerator publishes to US West
     * (Oregon) whatever the endpoints' Regions.
     */
    namespace: "AWS/GlobalAccelerator",
    onlyRegion: "us-west-2",
    metrics: [
      aws2("HealthyEndpointCount", "Minimum", "Count", G.Availability),
      aws2("UnhealthyEndpointCount", "Maximum", "Count", G.Availability),
      when(C.NonZero, aws2("NewFlowCount", "Sum", "Count", G.Connections)),
      when(C.NonZero, aws2("ProcessedBytesIn", "Sum", "Bytes", G.Network)),
      when(C.NonZero, aws2("ProcessedBytesOut", "Sum", "Bytes", G.Network)),
    ],
  },
  {
    /*
     * A user pool's sign-ins, token refreshes and sign-ups, and those
     * throttled. Cognito publishes them for each app client of the pool
     * (UserPool, UserPoolClient), never for the pool alone: a series per
     * client, which add up to the pool's. A pool may only refresh tokens
     * for hours, so a sweep asks for any of the three.
     */
    namespace: "AWS/Cognito",
    probeMetricNames: [
      "SignInSuccesses",
      "TokenRefreshSuccesses",
      "SignUpSuccesses",
    ],
    metrics: [
      aws2("SignInSuccesses", "Sum", "Count", G.Traffic),
      aws2("SignInThrottles", "Sum", "Count", G.Errors),
      aws2("TokenRefreshSuccesses", "Sum", "Count", G.Traffic),
      aws2("TokenRefreshThrottles", "Sum", "Count", G.Errors),
      aws2("SignUpSuccesses", "Sum", "Count", G.Traffic),
      aws2("SignUpThrottles", "Sum", "Count", G.Errors),
    ],
  },
  {
    /*
     * An environment's health, the one metric enhanced health reporting
     * publishes for free: 0 OK, 1 Info, 5 Unknown, 10 No data, 15
     * Warning, 20 Degraded, 25 Severe. Its Maximum is the period's worst.
     * The others are custom metrics CloudWatch charges for, published only
     * when the environment is set to.
     */
    namespace: "AWS/ElasticBeanstalk",
    metrics: [
      when(
        C.Setup,
        aws2("EnvironmentHealth", "Maximum", "None", G.Availability),
      ),
    ],
  },
  {
    // A GraphQL API's own (GraphQLAPIId); its requests are the Region's, not an API's.
    namespace: "AWS/AppSync",
    metrics: [
      aws2("Latency", "Average", "Milliseconds", G.Latency),
      aws2("5XXError", "Sum", "Count", G.Errors),
      aws2("4XXError", "Sum", "Count", G.Errors),
    ],
  },
  {
    /*
     * An endpoint's invocations, published for each production variant of
     * it (EndpointName, VariantName): a series per variant, which add up
     * to the endpoint's. A model's latency is in microseconds.
     */
    namespace: "AWS/SageMaker",
    metrics: [
      aws2("Invocations", "Sum", "None", G.Traffic),
      aws2("Invocation5XXErrors", "Sum", "None", G.Errors),
      aws2("Invocation4XXErrors", "Sum", "None", G.Errors),
      aws2("ModelLatency", "Average", "Microseconds", G.Latency),
    ],
  },
  {
    /*
     * The days a certificate has left. ACM publishes it twice a day for
     * every certificate until it expires, then stops: read once an hour,
     * and listed whatever its last point's age (isListedWhenQuiet). Its
     * Minimum is the period's one point. No stream writes it
     * (streamedSince null): an hour sooner is nothing to a count of days.
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

/*
 * The metrics a sweep asks for, in order, whether the namespace has
 * resources in a Region: its probeMetricNames, else its first metric.
 */
export function getAwsProbeMetricNames(
  entry: AwsNamespaceKeyMetrics,
): Array<string> {
  return entry.probeMetricNames && entry.probeMetricNames.length > 0
    ? [...entry.probeMetricNames]
    : [entry.metrics[0]!.metricName];
}

// The stored name of a CloudWatch metric, as the receivers write it.
export function getAwsStoredMetricName(
  namespace: string,
  metricName: string,
): string {
  return `amazonaws.com/${namespace}/${metricName}`;
}

// A namespace's key metric by its name, whatever its case.
export function getAwsKeyMetric(
  namespace: string,
  metricName: string,
): AwsKeyMetric | undefined {
  const wanted: string = metricName.trim().toLowerCase();

  return getAwsKeyMetrics(namespace)?.metrics.find(
    (metric: AwsKeyMetric): boolean => {
      return metric.metricName.toLowerCase() === wanted;
    },
  );
}

/*
 * The key metric a stored CloudWatch name is ("amazonaws.com/AWS/EC2/
 * CPUUtilization"), with its namespace as the catalog spells it, whatever
 * the case it was stored in - or null for a name no connection reads.
 */
export function getAwsKeyMetricOfStoredName(storedMetricName: string): {
  namespace: string;
  metric: AwsKeyMetric;
} | null {
  const parsed: { namespace: string; metricName: string } | null =
    parseAwsStoredMetricName(storedMetricName);
  const entry: AwsNamespaceKeyMetrics | undefined = parsed
    ? getAwsKeyMetrics(parsed.namespace)
    : undefined;
  const metric: AwsKeyMetric | undefined =
    parsed && entry
      ? getAwsKeyMetric(entry.namespace, parsed.metricName)
      : undefined;

  return entry && metric ? { namespace: entry.namespace, metric } : null;
}

/*
 * Whether a series of the metric, on these dimensions, is one it is read
 * from (AwsKeyMetric.onlyDimensionValues): every series of a metric that
 * names none, and of one that does, each whose named dimensions are
 * missing or hold one of their values.
 */
export function isAwsKeyMetricSeries(
  metric: AwsKeyMetric,
  dimensions: Readonly<Record<string, string>>,
): boolean {
  for (const [name, values] of Object.entries(
    metric.onlyDimensionValues || {},
  )) {
    const value: string | undefined = dimensions[name];

    if (value !== undefined && value !== "" && !values.includes(value)) {
      return false;
    }
  }

  return true;
}

// Whether any stream writes the metric: none writes a daily or hourly one.
export function isAwsKeyMetricStreamable(metric: AwsKeyMetric): boolean {
  return metric.streamedSince !== null;
}

/*
 * Whether the key-metric filters of a template version carry the metric:
 * a stack made from that version streams it.
 */
export function isAwsKeyMetricInTemplate(
  metric: AwsKeyMetric,
  templateVersion: number,
): boolean {
  return (
    metric.streamedSince !== null && metric.streamedSince <= templateVersion
  );
}

/*
 * How many key metrics the current template's filters carry that a
 * stack of an older version does not: what running the command again
 * streams in place of the read.
 */
export function countAwsKeyMetricsAddedSince(templateVersion: number): number {
  let count: number = 0;

  for (const entry of AWS_KEY_METRICS) {
    for (const metric of entry.metrics) {
      if (
        isAwsKeyMetricInTemplate(metric, AWS_STREAM_TEMPLATE_VERSION) &&
        !isAwsKeyMetricInTemplate(metric, templateVersion)
      ) {
        count++;
      }
    }
  }

  return count;
}

/*
 * ---- Azure: Azure Monitor ------------------------------------------------
 *
 * Per resource type: the metrics read, by Azure Monitor's own name, in
 * order. A metric the resource does not publish (its metric definitions
 * do not list it - a vCore database has no DTU) is left out; each is read
 * with the aggregation its definition calls primary, at the finest time
 * grain it offers from a minute up.
 *
 * One Azure Monitor call reads one grain, so each grain finer than an hour
 * is a call of its own for every resource, each read. A type's metrics are
 * read at one such grain - a minute for almost every type - and a metric
 * whose finest grain is five minutes is read only where it is marked as
 * earning the call it takes (AzureKeyMetric.grain): every 15 minutes, three
 * points a call, a third of a call a resource for each five minutes.
 */

/*
 * The grain a key metric is marked with when Azure Monitor keeps it at five
 * minutes at its finest, and how often it is read: the read asks for the
 * last 15 minutes of it once they are all there, so each call brings three
 * points (AzureCloudConnector).
 */
export const AZURE_FIVE_MINUTE_GRAIN: string = "PT5M";
export const AZURE_FIVE_MINUTE_READ_MINUTES: number = 15;

export interface AzureKeyMetric {
  // Azure Monitor's name for it, "Name in REST API" in Microsoft's tables.
  name: string;
  // What it is about, for the resource's Metrics card.
  group: CloudKeyMetricGroup;
  /*
   * AZURE_FIVE_MINUTE_GRAIN: Azure Monitor keeps it at five minutes at its
   * finest (an App Service app's health check, a Cosmos DB account's data
   * usage), and it earns the call of its own that grain takes beside its
   * type's minute metrics: read in a five-minute call every
   * AZURE_FIVE_MINUTE_READ_MINUTES, with the type's other five-minute
   * metrics. Where its definition offers a minute, it is read with the
   * minute metrics, at no cost. Unset for every other metric, which is read
   * at its type's one grain finer than an hour.
   */
  grain?: string | undefined;
  /*
   * Only some resources of the type report it, and this is the condition:
   * a B-series VM's credits, a DTU database's DTUs, a function app's
   * executions. A resource's definitions say for certain which it
   * publishes; this says why.
   */
  onlyWhen?: CloudKeyMetricCondition | undefined;
}

/*
 * A metric a type no longer reads as a key metric because its provider
 * deprecates it, still read - in the same call as the type's others, at no
 * cost - so a monitor someone built on it keeps reading until it is moved
 * to what replaces it. It is no key metric: its resource's page lists it
 * with the other metrics, never in a section or a headline.
 */
export interface AzureRetiredKeyMetric {
  name: string;
  // The key metrics of its type that replace it.
  replacedBy: Array<string>;
}

export interface AzureTypeKeyMetrics {
  // The ARM type, as CloudResourceCatalog spells it.
  type: string;
  metrics: Array<AzureKeyMetric>;
  // Deprecated metrics still read for the monitors built on them.
  retired?: Array<AzureRetiredKeyMetric> | undefined;
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

// A metric Azure Monitor keeps at five minutes at its finest, read every 15 minutes.
function azure5(name: string, group: CloudKeyMetricGroup): AzureKeyMetric {
  return { name, group, grain: AZURE_FIVE_MINUTE_GRAIN };
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
      // A burstable (B-series) VM's own.
      when(C.Burstable, azure("CPU Credits Remaining", G.Compute)),
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
      // A burstable (B-series) VM's own.
      when(C.Burstable, azure("CPU Credits Remaining", G.Compute)),
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
      /*
       * Its Health check, where one is set: its instances' status, which
       * reads a failure once an instance is deemed unhealthy. Kept at five
       * minutes at its finest.
       */
      when(C.Setup, azure5("HealthCheckStatus", G.Availability)),
      azure("CpuTime", G.Compute),
      azure("MemoryWorkingSet", G.Memory),
      // A function app's own.
      when(C.Kind, azure("FunctionExecutionCount", G.Traffic)),
      azure("Http2xx", G.Traffic),
      azure("RequestsInApplicationQueue", G.Backlog),
      azure("PrivateBytes", G.Memory),
      azure("Threads", G.Compute),
      azure("Handles", G.Compute),
      azure("AppConnections", G.Connections),
      azure("BytesReceived", G.Network),
      azure("BytesSent", G.Network),
      when(C.Kind, azure("FunctionExecutionUnits", G.Compute)),
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
      // A database or pool on the DTU purchasing model's own.
      when(C.Tier, azure("dtu_consumption_percent", G.Compute)),
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
      when(C.Tier, azure("eDTU_used", G.Compute)),
      azure("storage_percent", G.Storage),
      // A database or pool on the DTU purchasing model's own.
      when(C.Tier, azure("dtu_consumption_percent", G.Compute)),
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
      // A burstable server's own.
      when(C.Burstable, azure("cpu_credits_remaining", G.Compute)),
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
      when(
        C.Replica,
        azure("physical_replication_delay_in_seconds", G.Replication),
      ),
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
      when(C.Replica, azure("replication_lag", G.Replication)),
    ],
  },
  {
    type: "Microsoft.DocumentDB/databaseAccounts",
    metrics: [
      azure("TotalRequests", G.Traffic),
      azure("TotalRequestUnits", G.Traffic),
      azure("NormalizedRUConsumption", G.Compute),
      /*
       * The server's latency, by how a client connects: direct (the API
       * for NoSQL's and Table's SDKs in direct mode), else through the
       * gateway (every API, MongoDB, Cassandra and Gremlin's always).
       */
      when(C.Kind, azure("ServerSideLatencyDirect", G.Latency)),
      when(C.Kind, azure("ServerSideLatencyGateway", G.Latency)),
      azure("ThrottledRequestPercentage", G.Errors),
      // An account replicated to more than one region's own.
      when(C.Setup, azure("ReplicationLatency", G.Replication)),
      azure("ServiceAvailability", G.Availability),
      /*
       * What the account stores, kept at five minutes at its finest: its
       * data, its indexes and its documents, every container's together.
       * DataUsage, IndexUsage and DocumentCount are deprecated for these.
       */
      azure5("DataUsageV2", G.Storage),
      azure5("IndexUsageV2", G.Storage),
      azure5("DocumentCountV2", G.Storage),
    ],
    retired: [
      /*
       * Microsoft's table: "will be removed from Azure Monitor at the end
       * of August 2025. Please use Server Side Latency Direct and Server
       * Side Latency Gateway to monitor the latency instead."
       */
      {
        name: "ServerSideLatency",
        replacedBy: ["ServerSideLatencyDirect", "ServerSideLatencyGateway"],
      },
    ],
    notExportedByDiagnosticSettings: [
      "TotalRequests",
      "TotalRequestUnits",
      "NormalizedRUConsumption",
      "ServerSideLatencyDirect",
      "ServerSideLatencyGateway",
      "ThrottledRequestPercentage",
      "ReplicationLatency",
      "ServiceAvailability",
      "DataUsageV2",
      "IndexUsageV2",
      "DocumentCountV2",
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
      when(C.Setup, azure("GeoReplicationHealthy", G.Replication)),
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
      when(C.Setup, azure("geoReplicationHealthy", G.Replication)),
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
    // A Standard load balancer's: a Basic one publishes none.
    metrics: [
      when(C.Tier, azure("VipAvailability", G.Availability)),
      when(C.Tier, azure("DipAvailability", G.Availability)),
      when(C.Tier, azure("ByteCount", G.Traffic)),
      when(C.Tier, azure("PacketCount", G.Traffic)),
      when(C.Tier, azure("SYNCount", G.Connections)),
      when(C.Tier, azure("SnatConnectionCount", G.Connections)),
      when(C.Tier, azure("UsedSnatPorts", G.Connections)),
      when(C.Tier, azure("AllocatedSnatPorts", G.Connections)),
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
      // A v2 gateway's own.
      when(C.Tier, azure("CapacityUnits", G.Compute)),
      when(C.Tier, azure("ComputeUnits", G.Compute)),
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
      // A gateway with BGP, or with point-to-site connections, set up.
      when(C.Setup, azure("BgpPeerStatus", G.Availability)),
      when(C.Setup, azure("P2SConnectionCount", G.Connections)),
      when(C.Setup, azure("P2SBandwidth", G.Network)),
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
      // An Azure OpenAI account's own.
      when(C.Kind, azure("AzureOpenAIRequests", G.Traffic)),
      when(C.Kind, azure("AzureOpenAIAvailabilityRate", G.Availability)),
      when(C.Kind, azure("AzureOpenAITimeToResponse", G.Latency)),
      when(C.Kind, azure("ProcessedPromptTokens", G.Traffic)),
      when(C.Kind, azure("GeneratedTokens", G.Traffic)),
      when(C.Kind, azure("TokenTransaction", G.Traffic)),
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
      // An availability test's, and the browser SDK's page views.
      when(
        C.Setup,
        azure("availabilityResults/availabilityPercentage", G.Availability),
      ),
      when(C.Setup, azure("pageViews/count", G.Traffic)),
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
 * Every metric a read asks of a resource of the type, in order: its key
 * metrics, then the deprecated ones it still reads for the monitors built
 * on them (AzureTypeKeyMetrics.retired).
 */
export function getAzureReadMetricNames(
  keyMetrics: AzureTypeKeyMetrics,
): Array<string> {
  return [
    ...keyMetrics.metrics.map((metric: AzureKeyMetric): string => {
      return metric.name;
    }),
    ...(keyMetrics.retired || []).map(
      (metric: AzureRetiredKeyMetric): string => {
        return metric.name;
      },
    ),
  ];
}

/*
 * Whether a key metric of the type is marked as read at five minutes
 * (AzureKeyMetric.grain), whatever the case of its name.
 */
export function isAzureFiveMinuteKeyMetric(
  type: string,
  metricName: string,
): boolean {
  const wanted: string = (metricName || "").trim().toLowerCase();

  return Boolean(
    getAzureKeyMetrics(type || "")?.metrics.some(
      (metric: AzureKeyMetric): boolean => {
        return (
          metric.grain === AZURE_FIVE_MINUTE_GRAIN &&
          metric.name.toLowerCase() === wanted
        );
      },
    ),
  );
}

// Whether a type has a key metric read at five minutes: a call of its own.
export function hasAzureFiveMinuteKeyMetrics(type: string): boolean {
  return Boolean(
    getAzureKeyMetrics(type || "")?.metrics.some(
      (metric: AzureKeyMetric): boolean => {
        return metric.grain === AZURE_FIVE_MINUTE_GRAIN;
      },
    ),
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
 *
 * A distribution is read as one of its percentiles, or as how many values
 * it holds (GcpKeyMetric.readAs: a topic's messages are the count of its
 * message sizes), which is stored under a name of its own
 * (getGcpStoredMetricName). A VM's memory and disk use come from the Ops
 * Agent running on it, not from Google Cloud: those are asked of a project
 * only while one of its VMs reports them (GcpKeyMetric.reportedBy).
 */

export type GcpAligner =
  | "ALIGN_MEAN"
  | "ALIGN_MAX"
  | "ALIGN_RATE"
  | "ALIGN_SUM"
  | "ALIGN_PERCENTILE_95";

/*
 * Who reports a metric when Google Cloud does not itself: the Ops Agent,
 * installed on a Compute Engine VM, which publishes what the hypervisor
 * cannot see - how full the VM's memory and disks are - under
 * agent.googleapis.com.
 */
export const GCP_OPS_AGENT: string = "ops-agent";

// Google's instructions for installing the Ops Agent on a VM.
export const GCP_OPS_AGENT_INSTALL_URL: string =
  "https://docs.cloud.google.com/stackdriver/docs/solutions/agents/ops-agent/installation";

export interface GcpKeyMetric {
  metricType: string;
  aligner: GcpAligner;
  // The unit of the aligned value.
  unit: string;
  // What it is about, for the resource's Metrics card.
  group: CloudKeyMetricGroup;
  /*
   * "count": a distribution read for how many values each period of it
   * holds - its count, of the period's distribution its aligner (ALIGN_SUM)
   * gives - stored as `<metric type>_count`, the way Cloud Monitoring's
   * PromQL names a distribution's count. Unset: the aligned value itself.
   */
  readAs?: "count" | undefined;
  /*
   * Only the series whose metric labels hold these values: an Ops Agent's
   * memory and disks in their "used" state, not their free, cached or
   * reserved ones. Asked in the call's filter (metric.labels.<name>).
   */
  metricLabels?: Readonly<Record<string, string>> | undefined;
  /*
   * GCP_OPS_AGENT: reported by the Ops Agent on a VM, not by Google Cloud.
   * A read asks a project for these only while one of its VMs reported one
   * lately, and once an hour to find out whether one does now
   * (GcpCloudConnector), so VMs without the agent cost no call a read.
   */
  reportedBy?: string | undefined;
  // Only some resources of the type report it, and this is the condition.
  onlyWhen?: CloudKeyMetricCondition | undefined;
}

/*
 * A metric a type no longer reads as a key metric because Google
 * deprecates it, still read - as the type's other metrics are, of the
 * projects that have the type - so a monitor someone built on it keeps
 * reading until it is moved to what replaces it. It is no key metric: its
 * resource's page lists it with the other metrics, never in a section or
 * a headline.
 */
export interface GcpRetiredKeyMetric {
  metric: GcpKeyMetric;
  // The stored name of the key metric that replaces it.
  replacedBy: string;
}

export interface GcpTypeKeyMetrics {
  // The monitored resource type, as CloudResourceCatalog spells it.
  resourceType: string;
  metrics: Array<GcpKeyMetric>;
  // Deprecated metrics still read for the monitors built on them.
  retired?: Array<GcpRetiredKeyMetric> | undefined;
}

export const GCP_ALIGNMENT_PERIOD_SECONDS: number = 60;

function gcp(
  metricType: string,
  aligner: GcpAligner,
  unit: string,
  group: CloudKeyMetricGroup,
  options: {
    readAs?: "count";
    metricLabels?: Readonly<Record<string, string>>;
    reportedBy?: string;
  } = {},
): GcpKeyMetric {
  return {
    metricType,
    aligner,
    unit,
    group,
    ...(options.readAs ? { readAs: options.readAs } : {}),
    ...(options.metricLabels ? { metricLabels: options.metricLabels } : {}),
    ...(options.reportedBy ? { reportedBy: options.reportedBy } : {}),
  };
}

// Reported by the Ops Agent: a VM's own memory or disks, in their "used" state.
function opsAgent(
  metricType: string,
  group: CloudKeyMetricGroup,
): GcpKeyMetric {
  return gcp(metricType, "ALIGN_MEAN", "%", group, {
    metricLabels: { state: "used" },
    reportedBy: GCP_OPS_AGENT,
  });
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
      /*
       * How full the VM's memory is, and each of its disks (a series per
       * device): only the Ops Agent on the VM sees it.
       */
      opsAgent("agent.googleapis.com/memory/percent_used", G.Memory),
      opsAgent("agent.googleapis.com/disk/percent_used", G.Storage),
      // Only an E2 instance reports it.
      when(
        C.Kind,
        gcp(
          "compute.googleapis.com/instance/memory/balloon/ram_used",
          "ALIGN_MEAN",
          "By",
          G.Memory,
        ),
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
      when(
        C.Replica,
        gcp(
          "cloudsql.googleapis.com/database/replication/replica_lag",
          "ALIGN_MAX",
          "s",
          G.Replication,
        ),
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
      // A subscription with a dead-letter topic's own.
      when(
        C.Setup,
        gcp(
          "pubsub.googleapis.com/subscription/dead_letter_message_count",
          "ALIGN_RATE",
          "1/s",
          G.Errors,
        ),
      ),
    ],
  },
  {
    resourceType: "pubsub_topic",
    metrics: [
      /*
       * The messages published each minute: how many sizes the topic's
       * message size distribution holds, as Google says to count them
       * ("Apply a count aggregator on topic/message_sizes").
       */
      gcp(
        "pubsub.googleapis.com/topic/message_sizes",
        "ALIGN_SUM",
        "1",
        G.Traffic,
        { readAs: "count" },
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
    retired: [
      /*
       * Google's list: "This metric is deprecated. Apply a count aggregator
       * on topic/message_sizes instead."
       */
      {
        metric: gcp(
          "pubsub.googleapis.com/topic/send_message_operation_count",
          "ALIGN_RATE",
          "1/s",
          G.Traffic,
        ),
        replacedBy: "pubsub.googleapis.com/topic/message_sizes_count",
      },
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
      // A Standard Tier instance's, with its read replicas.
      when(
        C.Tier,
        gcp(
          "redis.googleapis.com/replication/master/slaves/lag",
          "ALIGN_MAX",
          "s",
          G.Replication,
        ),
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
 * The name a Google Cloud metric is stored under, as its readings, its
 * monitors and its resource's page know it: its metric type - or, for a
 * distribution read for its count (GcpKeyMetric.readAs), the type and
 * "_count": "pubsub.googleapis.com/topic/message_sizes_count", the way
 * Cloud Monitoring's PromQL names a distribution's count.
 */
export function getGcpStoredMetricName(
  metric: Pick<GcpKeyMetric, "metricType" | "readAs">,
): string {
  return metric.readAs === "count"
    ? `${metric.metricType}_count`
    : metric.metricType;
}

// A metric a read asks for, with what it is read for.
export interface GcpReadMetric extends GcpKeyMetric {
  // The first resource type it is listed under.
  resourceType: string;
  // Every resource type it is listed under, in the catalog's order.
  resourceTypes: Array<string>;
  // What it is stored under (getGcpStoredMetricName): one call each.
  storedName: string;
  // A deprecated metric read for the monitors built on it (retired).
  isRetired: boolean;
}

/*
 * Every metric a read may ask a project for, once by the name it is stored
 * under - a metric type two resource types report is one call, and a
 * distribution read both for a percentile and for its count is two - with
 * the resource types it is listed under: the key metrics in the catalog's
 * order, then the deprecated ones still read (GcpTypeKeyMetrics.retired).
 */
export function getGcpReadMetrics(): Array<GcpReadMetric> {
  const byName: Map<string, GcpReadMetric> = new Map();
  const add: (
    metric: GcpKeyMetric,
    resourceType: string,
    isRetired: boolean,
  ) => void = (
    metric: GcpKeyMetric,
    resourceType: string,
    isRetired: boolean,
  ): void => {
    const storedName: string = getGcpStoredMetricName(metric);
    const known: GcpReadMetric | undefined = byName.get(storedName);

    if (known) {
      if (!known.resourceTypes.includes(resourceType)) {
        known.resourceTypes.push(resourceType);
      }

      return;
    }

    byName.set(storedName, {
      ...metric,
      resourceType,
      resourceTypes: [resourceType],
      storedName,
      isRetired,
    });
  };

  for (const entry of GCP_KEY_METRICS) {
    for (const metric of entry.metrics) {
      add(metric, entry.resourceType, false);
    }
  }

  for (const entry of GCP_KEY_METRICS) {
    for (const retired of entry.retired || []) {
      add(retired.metric, entry.resourceType, true);
    }
  }

  return Array.from(byName.values());
}

/*
 * Every key metric read, once by the name it is stored under, with the
 * first resource type it is listed under: a type two resource types report
 * is one call.
 */
export function getGcpKeyMetricTypes(): Array<
  GcpKeyMetric & { resourceType: string }
> {
  const metrics: Array<GcpKeyMetric & { resourceType: string }> = [];
  const seen: Set<string> = new Set<string>();

  for (const entry of GCP_KEY_METRICS) {
    for (const metric of entry.metrics) {
      const storedName: string = getGcpStoredMetricName(metric);

      if (seen.has(storedName)) {
        continue;
      }

      seen.add(storedName);
      metrics.push({ ...metric, resourceType: entry.resourceType });
    }
  }

  return metrics;
}

/*
 * How many deprecated metrics a Google Cloud type is still read for, beside
 * its key metrics (GcpTypeKeyMetrics.retired): each a time series a
 * resource a read, which the cost estimate counts.
 */
export function getGcpRetiredMetricCount(resourceType: string): number {
  return (
    GCP_KEY_METRICS.find((entry: GcpTypeKeyMetrics): boolean => {
      return entry.resourceType === resourceType;
    })?.retired?.length || 0
  );
}

/*
 * The resource types a metric is listed under, by the name it is stored
 * under (a metric type, for all but a distribution's count), in the
 * catalog's order - a deprecated one still read among them.
 */
export function getGcpResourceTypesOfMetric(storedName: string): Array<string> {
  return (
    getGcpReadMetrics().find((metric: GcpReadMetric): boolean => {
      return metric.storedName === storedName;
    })?.resourceTypes || []
  );
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
 * estimate. AWS takes a CloudFormation type or a namespace. A Google Cloud
 * type's Ops Agent metrics are not counted: they are read only from a VM
 * that runs the agent, and cost nothing where none does.
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
    })?.metrics.filter((metric: GcpKeyMetric): boolean => {
      return !metric.reportedBy;
    }).length || 0
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
   * CloudWatch's ("CPUUtilization"), or the Cloud Monitoring metric type it
   * is stored under (getGcpStoredMetricName).
   */
  name: string;
  group: CloudKeyMetricGroup;
  // Its place among its type's (or namespace's) key metrics, most telling first.
  rank: number;
  /*
   * The seconds between two of its points where they are further apart
   * than the minute its cloud's other key metrics are read at: an Azure
   * metric read at five minutes (AzureKeyMetric.grain), 300. Its resource's
   * page says how often it comes. Unset for every other key metric.
   */
  intervalSeconds?: number | undefined;
}

// Azure Monitor's five-minute grain, as seconds between two points.
const AZURE_FIVE_MINUTE_GRAIN_SECONDS: number = 300;

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

  const metric: AzureKeyMetric = metrics[rank]!;

  return {
    name: metric.name,
    group: metric.group,
    rank,
    ...(metric.grain === AZURE_FIVE_MINUTE_GRAIN
      ? { intervalSeconds: AZURE_FIVE_MINUTE_GRAIN_SECONDS }
      : {}),
  };
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
        return getGcpStoredMetricName(metric).toLowerCase() === wanted;
      },
    );

    if (rank < 0) {
      continue;
    }

    const reference: CloudKeyMetricReference = {
      name: getGcpStoredMetricName(entry.metrics[rank]!),
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
