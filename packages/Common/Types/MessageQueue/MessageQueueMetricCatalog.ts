import AggregationType from "../BaseDatabase/AggregationType";
import { normalizeMessagingSystem } from "./MessagingSystem";

/*
 * The curated broker health metrics a queue's page charts, per messaging
 * system, from the sources MessagingSystem names: collector-contrib 0.161.0
 * receivers (kafka_metrics, rabbitmq, azure_monitor, aws_cloudwatch /
 * awsfirehose, googlecloudmonitoring), Prometheus scrapes of the Pulsar and
 * RocketMQ brokers, and the OpenTelemetry JMX Scraper for ActiveMQ. Every
 * name and attribute key was read from the receiver's source or seen
 * arriving from a real broker (see the research notes in each system's
 * comment). Names are lowercase, exactly as ingest stores them; attribute
 * keys are the STORED keys — datapoint attributes bare, resource attributes
 * with the `resource.` prefix, a kvlist flattened to `<key>.<nestedKey>`
 * (CloudWatch's `Dimensions.QueueName`).
 *
 * An entry is also how a datapoint FINDS its queue — the broker metrics
 * carry no `messaging.system`, so the name alone says which system reports
 * it (resolveMessagingMetricDatapoint):
 *
 *   - `requiredAttributes` must all match, case-insensitively, before the
 *     entry applies: the same Azure Monitor name (`azure_incomingmessages_total`)
 *     is emitted for Service Bus AND Event Hubs, told apart only by the
 *     resource `type` attribute; a CloudWatch Metric Stream in JSON format
 *     sends bare names (`numberofmessagessent`) whose namespace survives
 *     only as `resource.service.name`;
 *   - `destinationAttributes` hold the destination, first non-empty wins —
 *     spellings of one key (Azure's dimension keys arrive lowercased, but
 *     its docs spell them PascalCase) or of one metric across naming
 *     generations (the JMX Scraper's `messaging.destination.name` and its
 *     legacy `destination`);
 *   - `scopeAttributes` hold the broker scope of a namespace-scoped system:
 *     Azure Monitor's per-resource `name` is the namespace.
 *
 * `kind` decides how a metric is drawn:
 *   - "gauge" — a value at a point in time. That includes the per-period
 *     counts cloud monitoring reports (Azure's `*_total`, CloudWatch's
 *     NumberOfMessagesSent, Pub/Sub's DELTA counts): each point is already
 *     the count for its minute or period, not a running total, so it is
 *     summed within a bucket (aggregation Sum), never turned into a rate.
 *   - "counter" — a cumulative running total (rabbitmq.message.published,
 *     Kafka offsets, Pulsar's `*_total`, which Pulsar declares as a gauge
 *     but whose value only grows). The dashboard charts its per-second
 *     rate, and alert templates never threshold one.
 *
 * Series combine the way DatabaseServerMetricCatalog's do: `aggregation`
 * folds the samples of ONE series inside a bucket, then `seriesCombine`
 * folds the series of that bucket into the one value a tile shows — "sum"
 * for parts of a whole (a RabbitMQ queue's ready and unacknowledged
 * messages, a Pulsar topic's partitions), "max" for the worst one (the
 * consumer group furthest behind; also for a cloud metric whose only extra
 * series are the same queue reported twice, by two collectors), "avg" for
 * ratios. Gauges are grouped by `seriesKeys`; a counter is grouped by its
 * whole attribute set, turned into a rate per series, and the rates summed
 * — so counters always use aggregation Max and seriesCombine "sum", and
 * carry no seriesKeys.
 */

export type MessageQueueSignal =
  | "backlog"
  | "deadLetter"
  | "consumerLag"
  | "published"
  | "consumed"
  | "errors"
  | "throttled"
  | "oldestMessageAge"
  | "consumers";

export type MessageQueueMetricKind = "gauge" | "counter";

export type MessageQueueMetricAggregation =
  | AggregationType.Avg
  | AggregationType.Sum
  | AggregationType.Max
  | AggregationType.Min;

export type MessageQueueMetricSeriesCombine = "sum" | "max" | "avg";

export interface MessageQueueMetricDescriptor {
  // The canonical system this metric belongs to (MESSAGING_SYSTEMS).
  system: string;
  // Lowercase, exactly as stored (ingest lowercases metric names).
  metricName: string;
  // Unique per system.
  title: string;
  // Full sentence(s) ending in ".".
  description: string;
  // Display unit: "messages", "s", "ms", "requests", "consumers".
  unit: string;
  signal: MessageQueueSignal;
  kind: MessageQueueMetricKind;
  // How the samples of ONE series combine inside a time bucket.
  aggregation: MessageQueueMetricAggregation;
  // How the series of a bucket combine into the queue's value.
  seriesCombine: MessageQueueMetricSeriesCombine;
  /*
   * Stored keys holding the destination, first non-empty wins (resource
   * keys WITH the `resource.` prefix).
   */
  destinationAttributes: ReadonlyArray<string>;
  // Stored keys holding the broker scope (Azure: the namespace, `name`).
  scopeAttributes?: ReadonlyArray<string> | undefined;
  /*
   * Stored key → accepted values, compared case-insensitively; every key
   * must be present with one of its values for the entry to apply.
   */
  requiredAttributes?:
    | Readonly<Record<string, ReadonlyArray<string>>>
    | undefined;
  /*
   * Gauges only: attribute keys whose values are separate series (combined
   * by seriesCombine) rather than samples of one — RabbitMQ's `state`, a
   * Kafka consumer `group`.
   */
  seriesKeys?: ReadonlyArray<string> | undefined;
  /*
   * Stored keys that mark a finer-grained REPEAT of the metric: a datapoint
   * carrying any of them (non-blank) belongs to no queue, because a coarser
   * series of the same queue already counts it and adding both would count
   * every message twice. Pulsar writes pulsar_out_messages_total once per
   * subscription and, with exposeConsumerLevelMetricsInPrometheus=true,
   * again per consumer (labels `consumer_name`, `consumer_id`; TopicStats
   * writeConsumerMetric). The resolver drops such a datapoint, so a chart
   * scoped by the queue's entity key sums the coarser series alone.
   */
  excludeSeriesWithAttributes?: ReadonlyArray<string> | undefined;
  /*
   * The component that emits it, as MessagingBrokerMetricsSource names it:
   * a receiver, "prometheus", or the external scraper.
   */
  receiver: string;
  // Whether that component emits it without extra configuration.
  enabledByDefault: boolean;
}

// ---- Apache Kafka — collector `kafka_metrics` receiver ------------------
/*
 * Datapoint attributes `group`, `topic` (the topic NAME) and `partition`
 * (an int), from receiver/kafkametricsreceiver generated_metrics.go
 * @v0.161.0 and a live capture against Kafka 4.1.0. Lag and offsets are
 * reported only for partitions a group has committed on.
 */
const KAFKA_RECEIVER: string = "kafka_metrics";
const KAFKA_TOPIC_KEYS: ReadonlyArray<string> = ["topic"];

// ---- RabbitMQ — collector `rabbitmq` receiver ----------------------------
/*
 * One resource per queue: `rabbitmq.queue.name`, `rabbitmq.vhost.name`,
 * `rabbitmq.node.name` (stored with the `resource.` prefix);
 * rabbitmq.message.current splits by the datapoint attribute `state`
 * (ready | unacknowledged). The message_stats counters are ABSENT, not 0,
 * until the activity they count first happens.
 */
const RABBITMQ_RECEIVER: string = "rabbitmq";
const RABBITMQ_QUEUE_KEYS: ReadonlyArray<string> = [
  "resource.rabbitmq.queue.name",
];

// ---- Apache ActiveMQ — the OpenTelemetry JMX Scraper ----------------------
/*
 * Two naming generations of the scraper's bundled `activemq` rules:
 * 1.53.0-alpha and later (and the Java agent from 2.23.0) name the
 * destination `messaging.destination.name`, with `activemq.destination.type`
 * and `activemq.broker.name`; 1.52.0 and earlier (or
 * OTEL_JMX_TARGET_SOURCE=legacy) name it `destination`, with `broker`, and
 * spell two metrics differently (activemq.message.current,
 * activemq.message.wait_time.avg in ms). Both captured live against
 * ActiveMQ Classic 6.2.0. Names shared by both generations list both keys.
 */
const JMX_SCRAPER: string = "OpenTelemetry JMX Scraper";
const ACTIVEMQ_DESTINATION_KEYS: ReadonlyArray<string> = [
  "messaging.destination.name",
];
const ACTIVEMQ_LEGACY_DESTINATION_KEYS: ReadonlyArray<string> = ["destination"];
const ACTIVEMQ_ANY_DESTINATION_KEYS: ReadonlyArray<string> = [
  "messaging.destination.name",
  "destination",
];

// ---- Azure Service Bus / Event Hubs — collector `azure_monitor` receiver --
/*
 * Metric names are `azure_<metric>_<aggregation>`, lowercased; every point
 * is a double Gauge per PT1M bucket (a `_total` is that minute's sum, not a
 * running total). Datapoint attributes: `type` (the resource type, whose
 * casing varies — Microsoft.ServiceBus/Namespaces in ARM responses), `name`
 * (the namespace) and `metadata_<dimension>` per split dimension. Azure
 * returns dimension names lowercased (`metadata_entityname`), but that was
 * inferred rather than captured, so the documented PascalCase spelling is
 * accepted too. The EntityName value `-NamespaceOnlyMetric-` is not a queue
 * (MessagingTelemetryResolver drops it).
 */
const AZURE_MONITOR: string = "azure_monitor";
const AZURE_ENTITY_KEYS: ReadonlyArray<string> = [
  "metadata_entityname",
  "metadata_EntityName",
];
const AZURE_NAMESPACE_KEYS: ReadonlyArray<string> = ["name"];
const SERVICE_BUS_NAMESPACE_TYPE: Readonly<
  Record<string, ReadonlyArray<string>>
> = { type: ["microsoft.servicebus/namespaces"] };
const EVENT_HUBS_NAMESPACE_TYPE: Readonly<
  Record<string, ReadonlyArray<string>>
> = { type: ["microsoft.eventhub/namespaces"] };
const AZURE_OPERATION_RESULT_KEYS: ReadonlyArray<string> = [
  "metadata_operationresult",
  "metadata_OperationResult",
];
const AZURE_THROTTLE_KEYS: ReadonlyArray<string> = [
  ...AZURE_OPERATION_RESULT_KEYS,
  "metadata_messagingerrorsubcode",
  "metadata_MessagingErrorSubCode",
];

// ---- Amazon SQS / SNS — collector `aws_cloudwatch` or `awsfirehose` --------
/*
 * Two shapes of the same CloudWatch metric. The `aws_cloudwatch` receiver
 * and a Metric Stream in OpenTelemetry 1.0 format name it
 * `amazonaws.com/AWS/SQS/<Metric>` with the dimensions in a kvlist
 * (`Dimensions.QueueName` once flattened); a Metric Stream in JSON format
 * sends the bare `<Metric>` with a plain `QueueName` attribute, and says
 * which service it is only through `resource.service.name` ("SQS"). Points
 * are Summaries holding one CloudWatch period: Avg reads CloudWatch's
 * Average, Sum its Sum. Configure the pull receiver without `stats`, which
 * would split each metric into one series per statistic.
 */
const CLOUDWATCH_PULL: string = "aws_cloudwatch";
const CLOUDWATCH_STREAM: string = "awsfirehose";
const SQS_METRIC_PREFIX: string = "amazonaws.com/aws/sqs/";
const SNS_METRIC_PREFIX: string = "amazonaws.com/aws/sns/";
const SQS_JSON_SERVICE: Readonly<Record<string, ReadonlyArray<string>>> = {
  "resource.service.name": ["sqs"],
};
const SNS_JSON_SERVICE: Readonly<Record<string, ReadonlyArray<string>>> = {
  "resource.service.name": ["sns"],
};
const JSON_STREAM_TITLE_SUFFIX: string = " (JSON stream)";

// ---- Google Cloud Pub/Sub — collector `googlecloudmonitoring` receiver ----
/*
 * The name is the Cloud Monitoring metric type verbatim; the monitored
 * resource's labels (`subscription_id` / `topic_id`, `project_id`) are
 * RESOURCE attributes, the metric's labels (`response_code`,
 * `delivery_type`, …) datapoint attributes from collector v0.137.0 (resource
 * attributes in v0.116.0–v0.136.x, hence both spellings as series keys).
 * The receiver only reads the metric types listed in its `metrics_list`.
 */
const CLOUD_MONITORING: string = "googlecloudmonitoring";
const PUBSUB_SUBSCRIPTION_KEYS: ReadonlyArray<string> = [
  "resource.subscription_id",
];
const PUBSUB_TOPIC_KEYS: ReadonlyArray<string> = ["resource.topic_id"];

// ---- Apache Pulsar / Apache RocketMQ — collector `prometheus` receiver ----
/*
 * Prometheus labels arrive as datapoint attributes. Pulsar labels topic
 * series `cluster`, `namespace`, `topic` (the full
 * persistent://tenant/namespace/topic, `-partition-N` per partition) and
 * subscription series add `subscription` — captured live from Pulsar 4.2.4.
 * RocketMQ 5 brokers (metricsExporterType=PROM) label lag series `topic`,
 * `consumer_group`, `is_retry`, `is_system`.
 */
const PROMETHEUS: string = "prometheus";
const PULSAR_TOPIC_KEYS: ReadonlyArray<string> = ["topic"];
const PULSAR_TOPIC_SERIES_KEYS: ReadonlyArray<string> = [
  "cluster",
  "topic",
  "partition",
];
// The labels only Pulsar's consumer-level series carry.
const PULSAR_CONSUMER_KEYS: ReadonlyArray<string> = [
  "consumer_name",
  "consumer_id",
];
const ROCKETMQ_TOPIC_KEYS: ReadonlyArray<string> = ["topic"];

function sqsMetric(data: {
  cloudWatchName: string;
  title: string;
  description: string;
  unit: string;
  signal: MessageQueueSignal;
  aggregation: MessageQueueMetricAggregation;
}): Array<MessageQueueMetricDescriptor> {
  return awsMetricPair({
    ...data,
    system: "aws_sqs",
    prefix: SQS_METRIC_PREFIX,
    dimension: "QueueName",
    jsonService: SQS_JSON_SERVICE,
  });
}

function snsMetric(data: {
  cloudWatchName: string;
  title: string;
  description: string;
  unit: string;
  signal: MessageQueueSignal;
  aggregation: MessageQueueMetricAggregation;
}): Array<MessageQueueMetricDescriptor> {
  return awsMetricPair({
    ...data,
    system: "aws.sns",
    prefix: SNS_METRIC_PREFIX,
    dimension: "TopicName",
    jsonService: SNS_JSON_SERVICE,
  });
}

// The same CloudWatch metric in both shapes (see CLOUDWATCH_PULL above).
function awsMetricPair(data: {
  system: string;
  prefix: string;
  dimension: string;
  jsonService: Readonly<Record<string, ReadonlyArray<string>>>;
  cloudWatchName: string;
  title: string;
  description: string;
  unit: string;
  signal: MessageQueueSignal;
  aggregation: MessageQueueMetricAggregation;
}): Array<MessageQueueMetricDescriptor> {
  const name: string = data.cloudWatchName.toLowerCase();
  const common: {
    system: string;
    description: string;
    unit: string;
    signal: MessageQueueSignal;
    kind: MessageQueueMetricKind;
    aggregation: MessageQueueMetricAggregation;
    seriesCombine: MessageQueueMetricSeriesCombine;
    enabledByDefault: boolean;
  } = {
    system: data.system,
    description: data.description,
    unit: data.unit,
    signal: data.signal,
    kind: "gauge",
    aggregation: data.aggregation,
    // One series per queue; a second one is the same queue reported twice.
    seriesCombine: "max",
    enabledByDefault: true,
  };
  return [
    {
      ...common,
      metricName: `${data.prefix}${name}`,
      title: data.title,
      destinationAttributes: [`Dimensions.${data.dimension}`],
      receiver: CLOUDWATCH_PULL,
    },
    {
      ...common,
      metricName: name,
      title: `${data.title}${JSON_STREAM_TITLE_SUFFIX}`,
      destinationAttributes: [data.dimension],
      requiredAttributes: data.jsonService,
      receiver: CLOUDWATCH_STREAM,
    },
  ];
}

export const MESSAGE_QUEUE_METRICS: ReadonlyArray<MessageQueueMetricDescriptor> =
  [
    // Apache Kafka.
    {
      system: "kafka",
      metricName: "kafka.consumer_group.lag_sum",
      title: "Consumer lag",
      description:
        "Messages a consumer group has not yet committed on this topic, added up across its partitions. With several consumer groups, the one furthest behind is shown; a group appears only once it has committed an offset on the topic.",
      unit: "messages",
      signal: "consumerLag",
      kind: "gauge",
      aggregation: AggregationType.Max,
      seriesCombine: "max",
      destinationAttributes: KAFKA_TOPIC_KEYS,
      seriesKeys: ["group"],
      receiver: KAFKA_RECEIVER,
      enabledByDefault: true,
    },
    {
      system: "kafka",
      metricName: "kafka.consumer_group.lag",
      title: "Partition lag",
      description:
        "Messages not yet committed on the single partition furthest behind, across every consumer group reading this topic. A high value next to a low consumer lag points at one stuck partition.",
      unit: "messages",
      signal: "consumerLag",
      kind: "gauge",
      aggregation: AggregationType.Max,
      seriesCombine: "max",
      destinationAttributes: KAFKA_TOPIC_KEYS,
      seriesKeys: ["group", "partition"],
      receiver: KAFKA_RECEIVER,
      enabledByDefault: true,
    },
    {
      system: "kafka",
      metricName: "kafka.consumer_group.offset_sum",
      title: "Consumed",
      description:
        "Messages consumed per second: the growth of the offsets consumer groups commit on this topic, added up across partitions and consumer groups.",
      unit: "messages",
      signal: "consumed",
      kind: "counter",
      aggregation: AggregationType.Max,
      seriesCombine: "sum",
      destinationAttributes: KAFKA_TOPIC_KEYS,
      receiver: KAFKA_RECEIVER,
      enabledByDefault: true,
    },
    {
      system: "kafka",
      metricName: "kafka.partition.current_offset",
      title: "Produced",
      description:
        "Messages produced per second: the growth of each partition's log-end offset, added up across the topic's partitions.",
      unit: "messages",
      signal: "published",
      kind: "counter",
      aggregation: AggregationType.Max,
      seriesCombine: "sum",
      destinationAttributes: KAFKA_TOPIC_KEYS,
      receiver: KAFKA_RECEIVER,
      enabledByDefault: true,
    },

    // RabbitMQ.
    {
      system: "rabbitmq",
      metricName: "rabbitmq.message.current",
      title: "Queue depth",
      description:
        "Messages in the queue: those ready for delivery plus those delivered but not yet acknowledged (the receiver's two `state` series, added up).",
      unit: "messages",
      signal: "backlog",
      kind: "gauge",
      aggregation: AggregationType.Avg,
      seriesCombine: "sum",
      destinationAttributes: RABBITMQ_QUEUE_KEYS,
      seriesKeys: ["state"],
      receiver: RABBITMQ_RECEIVER,
      enabledByDefault: true,
    },
    {
      system: "rabbitmq",
      metricName: "rabbitmq.message.published",
      title: "Published",
      description:
        "Messages published to the queue per second. The receiver reports it once the queue has seen its first publish.",
      unit: "messages",
      signal: "published",
      kind: "counter",
      aggregation: AggregationType.Max,
      seriesCombine: "sum",
      destinationAttributes: RABBITMQ_QUEUE_KEYS,
      receiver: RABBITMQ_RECEIVER,
      enabledByDefault: true,
    },
    {
      system: "rabbitmq",
      metricName: "rabbitmq.message.delivered",
      title: "Delivered",
      description:
        "Messages the broker pushed to consumers per second; messages fetched with `basic.get` are not counted.",
      unit: "messages",
      signal: "consumed",
      kind: "counter",
      aggregation: AggregationType.Max,
      seriesCombine: "sum",
      destinationAttributes: RABBITMQ_QUEUE_KEYS,
      receiver: RABBITMQ_RECEIVER,
      enabledByDefault: true,
    },
    {
      system: "rabbitmq",
      metricName: "rabbitmq.message.acknowledged",
      title: "Acknowledged",
      description: "Messages consumers acknowledged per second.",
      unit: "messages",
      signal: "consumed",
      kind: "counter",
      aggregation: AggregationType.Max,
      seriesCombine: "sum",
      destinationAttributes: RABBITMQ_QUEUE_KEYS,
      receiver: RABBITMQ_RECEIVER,
      enabledByDefault: true,
    },
    {
      system: "rabbitmq",
      metricName: "rabbitmq.message.dropped",
      title: "Dropped",
      description:
        "Messages the broker dropped as unroutable, per second (the queue's `drop_unroutable` statistic).",
      unit: "messages",
      signal: "errors",
      kind: "counter",
      aggregation: AggregationType.Max,
      seriesCombine: "sum",
      destinationAttributes: RABBITMQ_QUEUE_KEYS,
      receiver: RABBITMQ_RECEIVER,
      enabledByDefault: true,
    },
    {
      system: "rabbitmq",
      metricName: "rabbitmq.consumer.count",
      title: "Consumers",
      description:
        "Consumers attached to the queue; with none, nothing is draining it.",
      unit: "consumers",
      signal: "consumers",
      kind: "gauge",
      aggregation: AggregationType.Min,
      seriesCombine: "sum",
      destinationAttributes: RABBITMQ_QUEUE_KEYS,
      receiver: RABBITMQ_RECEIVER,
      enabledByDefault: true,
    },

    // Apache ActiveMQ.
    {
      system: "activemq",
      metricName: "activemq.message.queue.size",
      title: "Queue size",
      description:
        "Messages waiting on the destination to be consumed, added up across brokers.",
      unit: "messages",
      signal: "backlog",
      kind: "gauge",
      aggregation: AggregationType.Avg,
      seriesCombine: "sum",
      destinationAttributes: ACTIVEMQ_DESTINATION_KEYS,
      seriesKeys: ["activemq.broker.name", "activemq.destination.type"],
      receiver: JMX_SCRAPER,
      enabledByDefault: true,
    },
    {
      system: "activemq",
      metricName: "activemq.message.current",
      title: "Queue size (legacy names)",
      description:
        "Messages waiting on the destination to be consumed, added up across brokers, as the JMX Scraper names it in its legacy rules (version 1.52 and older, or OTEL_JMX_TARGET_SOURCE=legacy).",
      unit: "messages",
      signal: "backlog",
      kind: "gauge",
      aggregation: AggregationType.Avg,
      seriesCombine: "sum",
      destinationAttributes: ACTIVEMQ_LEGACY_DESTINATION_KEYS,
      seriesKeys: ["broker"],
      receiver: JMX_SCRAPER,
      enabledByDefault: true,
    },
    {
      system: "activemq",
      metricName: "activemq.message.enqueued",
      title: "Enqueued",
      description: "Messages sent to the destination per second.",
      unit: "messages",
      signal: "published",
      kind: "counter",
      aggregation: AggregationType.Max,
      seriesCombine: "sum",
      destinationAttributes: ACTIVEMQ_ANY_DESTINATION_KEYS,
      receiver: JMX_SCRAPER,
      enabledByDefault: true,
    },
    {
      system: "activemq",
      metricName: "activemq.message.dequeued",
      title: "Dequeued",
      description:
        "Messages acknowledged and removed from the destination per second.",
      unit: "messages",
      signal: "consumed",
      kind: "counter",
      aggregation: AggregationType.Max,
      seriesCombine: "sum",
      destinationAttributes: ACTIVEMQ_ANY_DESTINATION_KEYS,
      receiver: JMX_SCRAPER,
      enabledByDefault: true,
    },
    {
      system: "activemq",
      metricName: "activemq.message.expired",
      title: "Expired",
      description:
        "Messages that expired before they were delivered, per second.",
      unit: "messages",
      signal: "errors",
      kind: "counter",
      aggregation: AggregationType.Max,
      seriesCombine: "sum",
      destinationAttributes: ACTIVEMQ_ANY_DESTINATION_KEYS,
      receiver: JMX_SCRAPER,
      enabledByDefault: true,
    },
    {
      system: "activemq",
      metricName: "activemq.consumer.count",
      title: "Consumers",
      description:
        "Consumers subscribed to the destination, added up across brokers; with none, nothing is draining it.",
      unit: "consumers",
      signal: "consumers",
      kind: "gauge",
      aggregation: AggregationType.Min,
      seriesCombine: "sum",
      destinationAttributes: ACTIVEMQ_ANY_DESTINATION_KEYS,
      seriesKeys: [
        "activemq.broker.name",
        "activemq.destination.type",
        "broker",
      ],
      receiver: JMX_SCRAPER,
      enabledByDefault: true,
    },
    {
      system: "activemq",
      metricName: "activemq.message.enqueue.average_duration",
      title: "Average time in queue",
      description:
        "The average time a message waited on the destination before it was consumed, a running average the broker keeps (AverageEnqueueTime). It is an average, not the age of the oldest waiting message.",
      unit: "s",
      signal: "oldestMessageAge",
      kind: "gauge",
      aggregation: AggregationType.Max,
      seriesCombine: "max",
      destinationAttributes: ACTIVEMQ_DESTINATION_KEYS,
      receiver: JMX_SCRAPER,
      enabledByDefault: true,
    },
    {
      system: "activemq",
      metricName: "activemq.message.wait_time.avg",
      title: "Average time in queue (legacy names)",
      description:
        "The average time a message waited on the destination before it was consumed (AverageEnqueueTime), in milliseconds, as the JMX Scraper names it in its legacy rules. It is an average, not the age of the oldest waiting message.",
      unit: "ms",
      signal: "oldestMessageAge",
      kind: "gauge",
      aggregation: AggregationType.Max,
      seriesCombine: "max",
      destinationAttributes: ACTIVEMQ_LEGACY_DESTINATION_KEYS,
      receiver: JMX_SCRAPER,
      enabledByDefault: true,
    },

    // Azure Service Bus.
    {
      system: "servicebus",
      metricName: "azure_activemessages_average",
      title: "Active messages",
      description:
        "Messages ready for delivery in the queue or topic (Azure Monitor's ActiveMessages, averaged over each minute). A topic's count covers all of its subscriptions.",
      unit: "messages",
      signal: "backlog",
      kind: "gauge",
      aggregation: AggregationType.Max,
      seriesCombine: "max",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: SERVICE_BUS_NAMESPACE_TYPE,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },
    {
      system: "servicebus",
      metricName: "azure_deadletteredmessages_average",
      title: "Dead-lettered messages",
      description:
        "Messages in the dead-letter sub-queue (Azure Monitor's DeadletteredMessages, averaged over each minute).",
      unit: "messages",
      signal: "deadLetter",
      kind: "gauge",
      aggregation: AggregationType.Max,
      seriesCombine: "max",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: SERVICE_BUS_NAMESPACE_TYPE,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },
    {
      system: "servicebus",
      metricName: "azure_incomingmessages_total",
      title: "Incoming messages",
      description:
        "Messages sent to the queue or topic, counted per minute by Azure Monitor (IncomingMessages), including messages auto-forwarded into it.",
      unit: "messages",
      signal: "published",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: SERVICE_BUS_NAMESPACE_TYPE,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },
    {
      system: "servicebus",
      metricName: "azure_outgoingmessages_total",
      title: "Outgoing messages",
      description:
        "Messages received from the queue or topic, counted per minute by Azure Monitor (OutgoingMessages).",
      unit: "messages",
      signal: "consumed",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: SERVICE_BUS_NAMESPACE_TYPE,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },
    {
      system: "servicebus",
      metricName: "azure_completemessage_total",
      title: "Completed messages",
      description:
        "Messages consumers completed (settled), counted per minute by Azure Monitor (CompleteMessage).",
      unit: "messages",
      signal: "consumed",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: SERVICE_BUS_NAMESPACE_TYPE,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },
    {
      system: "servicebus",
      metricName: "azure_abandonmessage_total",
      title: "Abandoned messages",
      description:
        "Messages consumers abandoned, counted per minute by Azure Monitor (AbandonMessage). Each one goes back to the queue to be retried, usually after its processing failed.",
      unit: "messages",
      signal: "errors",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: SERVICE_BUS_NAMESPACE_TYPE,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },
    {
      system: "servicebus",
      metricName: "azure_servererrors_total",
      title: "Server errors",
      description:
        "Requests that failed because of a Service Bus error, counted per minute by Azure Monitor (ServerErrors) and added up across operation results.",
      unit: "requests",
      signal: "errors",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: SERVICE_BUS_NAMESPACE_TYPE,
      seriesKeys: AZURE_OPERATION_RESULT_KEYS,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },
    {
      system: "servicebus",
      metricName: "azure_usererrors_total",
      title: "User errors",
      description:
        "Requests that failed because of the client, such as a lost message lock or a bad request, counted per minute by Azure Monitor (UserErrors) and added up across operation results.",
      unit: "requests",
      signal: "errors",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: SERVICE_BUS_NAMESPACE_TYPE,
      seriesKeys: AZURE_OPERATION_RESULT_KEYS,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },
    {
      system: "servicebus",
      metricName: "azure_throttledrequests_total",
      title: "Throttled requests",
      description:
        "Requests Service Bus rejected because the namespace ran out of capacity, counted per minute by Azure Monitor (ThrottledRequests).",
      unit: "requests",
      signal: "throttled",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: SERVICE_BUS_NAMESPACE_TYPE,
      seriesKeys: AZURE_THROTTLE_KEYS,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },

    // Azure Event Hubs.
    {
      system: "eventhubs",
      metricName: "azure_incomingmessages_total",
      title: "Incoming messages",
      description:
        "Events sent to the event hub, counted per minute by Azure Monitor (IncomingMessages).",
      unit: "messages",
      signal: "published",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: EVENT_HUBS_NAMESPACE_TYPE,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },
    {
      system: "eventhubs",
      metricName: "azure_outgoingmessages_total",
      title: "Outgoing messages",
      description:
        "Events read from the event hub, counted per minute by Azure Monitor (OutgoingMessages) across every consumer group.",
      unit: "messages",
      signal: "consumed",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: EVENT_HUBS_NAMESPACE_TYPE,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },
    {
      system: "eventhubs",
      metricName: "azure_servererrors_total",
      title: "Server errors",
      description:
        "Requests that failed because of an Event Hubs error, counted per minute by Azure Monitor (ServerErrors) and added up across operation results.",
      unit: "requests",
      signal: "errors",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: EVENT_HUBS_NAMESPACE_TYPE,
      seriesKeys: AZURE_OPERATION_RESULT_KEYS,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },
    {
      system: "eventhubs",
      metricName: "azure_usererrors_total",
      title: "User errors",
      description:
        "Requests that failed because of the client, counted per minute by Azure Monitor (UserErrors) and added up across operation results.",
      unit: "requests",
      signal: "errors",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: EVENT_HUBS_NAMESPACE_TYPE,
      seriesKeys: AZURE_OPERATION_RESULT_KEYS,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },
    {
      system: "eventhubs",
      metricName: "azure_quotaexceedederrors_total",
      title: "Quota exceeded errors",
      description:
        "Requests that failed because the namespace hit a quota, counted per minute by Azure Monitor (QuotaExceededErrors) and added up across operation results.",
      unit: "requests",
      signal: "errors",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: EVENT_HUBS_NAMESPACE_TYPE,
      seriesKeys: AZURE_OPERATION_RESULT_KEYS,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },
    {
      system: "eventhubs",
      metricName: "azure_throttledrequests_total",
      title: "Throttled requests",
      description:
        "Requests Event Hubs rejected because the namespace ran out of throughput, counted per minute by Azure Monitor (ThrottledRequests).",
      unit: "requests",
      signal: "throttled",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: AZURE_ENTITY_KEYS,
      scopeAttributes: AZURE_NAMESPACE_KEYS,
      requiredAttributes: EVENT_HUBS_NAMESPACE_TYPE,
      seriesKeys: AZURE_OPERATION_RESULT_KEYS,
      receiver: AZURE_MONITOR,
      enabledByDefault: true,
    },

    // Amazon SQS.
    ...sqsMetric({
      cloudWatchName: "ApproximateNumberOfMessagesVisible",
      title: "Messages visible",
      description:
        "Messages available for retrieval from the queue (ApproximateNumberOfMessagesVisible, CloudWatch's Average for each period).",
      unit: "messages",
      signal: "backlog",
      aggregation: AggregationType.Avg,
    }),
    ...sqsMetric({
      cloudWatchName: "ApproximateAgeOfOldestMessage",
      title: "Oldest message age",
      description:
        "Age of the oldest message in the queue (ApproximateAgeOfOldestMessage). CloudWatch reports it only while the queue holds a message.",
      unit: "s",
      signal: "oldestMessageAge",
      aggregation: AggregationType.Max,
    }),
    ...sqsMetric({
      cloudWatchName: "ApproximateNumberOfMessagesNotVisible",
      title: "Messages in flight",
      description:
        "Messages a consumer has received but not yet deleted or returned to the queue (ApproximateNumberOfMessagesNotVisible).",
      unit: "messages",
      signal: "backlog",
      aggregation: AggregationType.Avg,
    }),
    ...sqsMetric({
      cloudWatchName: "NumberOfMessagesSent",
      title: "Messages sent",
      description:
        "Messages sent to the queue in each CloudWatch period (NumberOfMessagesSent, its Sum).",
      unit: "messages",
      signal: "published",
      aggregation: AggregationType.Sum,
    }),
    ...sqsMetric({
      cloudWatchName: "NumberOfMessagesReceived",
      title: "Messages received",
      description:
        "Messages ReceiveMessage calls returned in each CloudWatch period (NumberOfMessagesReceived); a redelivered message counts again.",
      unit: "messages",
      signal: "consumed",
      aggregation: AggregationType.Sum,
    }),
    ...sqsMetric({
      cloudWatchName: "NumberOfMessagesDeleted",
      title: "Messages deleted",
      description:
        "Messages deleted from the queue — that is, processed — in each CloudWatch period (NumberOfMessagesDeleted).",
      unit: "messages",
      signal: "consumed",
      aggregation: AggregationType.Sum,
    }),

    // Amazon SNS.
    ...snsMetric({
      cloudWatchName: "NumberOfMessagesPublished",
      title: "Messages published",
      description:
        "Messages published to the topic in each CloudWatch period (NumberOfMessagesPublished).",
      unit: "messages",
      signal: "published",
      aggregation: AggregationType.Sum,
    }),
    ...snsMetric({
      cloudWatchName: "NumberOfNotificationsDelivered",
      title: "Notifications delivered",
      description:
        "Notifications the topic delivered to its subscriptions in each CloudWatch period (NumberOfNotificationsDelivered).",
      unit: "messages",
      signal: "consumed",
      aggregation: AggregationType.Sum,
    }),
    ...snsMetric({
      cloudWatchName: "NumberOfNotificationsFailed",
      title: "Notifications failed",
      description:
        "Deliveries to subscriptions that failed in each CloudWatch period (NumberOfNotificationsFailed); for HTTP/S endpoints every failed attempt, retries included, counts.",
      unit: "messages",
      signal: "errors",
      aggregation: AggregationType.Sum,
    }),
    ...snsMetric({
      cloudWatchName: "NumberOfNotificationsRedrivenToDlq",
      title: "Redriven to dead-letter queue",
      description:
        "Notifications moved to a subscription's dead-letter queue in each CloudWatch period (NumberOfNotificationsRedrivenToDlq).",
      unit: "messages",
      signal: "deadLetter",
      aggregation: AggregationType.Sum,
    }),

    // Google Cloud Pub/Sub.
    {
      system: "gcp_pubsub",
      metricName: "pubsub.googleapis.com/subscription/num_undelivered_messages",
      title: "Undelivered messages",
      description:
        "Messages the subscription has not yet acknowledged (num_undelivered_messages), sampled every minute by Cloud Monitoring.",
      unit: "messages",
      signal: "backlog",
      kind: "gauge",
      aggregation: AggregationType.Max,
      seriesCombine: "max",
      destinationAttributes: PUBSUB_SUBSCRIPTION_KEYS,
      receiver: CLOUD_MONITORING,
      enabledByDefault: false,
    },
    {
      system: "gcp_pubsub",
      metricName:
        "pubsub.googleapis.com/subscription/oldest_unacked_message_age",
      title: "Oldest unacked message age",
      description:
        "Age of the oldest message the subscription has not yet acknowledged (oldest_unacked_message_age).",
      unit: "s",
      signal: "oldestMessageAge",
      kind: "gauge",
      aggregation: AggregationType.Max,
      seriesCombine: "max",
      destinationAttributes: PUBSUB_SUBSCRIPTION_KEYS,
      receiver: CLOUD_MONITORING,
      enabledByDefault: false,
    },
    {
      system: "gcp_pubsub",
      metricName:
        "pubsub.googleapis.com/subscription/dead_letter_message_count",
      title: "Dead-lettered messages",
      description:
        "Messages the subscription forwarded to its dead-letter topic in each sample period (dead_letter_message_count).",
      unit: "messages",
      signal: "deadLetter",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: PUBSUB_SUBSCRIPTION_KEYS,
      seriesKeys: ["response_code", "resource.response_code"],
      receiver: CLOUD_MONITORING,
      enabledByDefault: false,
    },
    {
      system: "gcp_pubsub",
      metricName: "pubsub.googleapis.com/subscription/ack_message_count",
      title: "Acknowledged messages",
      description:
        "Messages acknowledged on the subscription in each sample period (ack_message_count), added up across delivery types.",
      unit: "messages",
      signal: "consumed",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: PUBSUB_SUBSCRIPTION_KEYS,
      seriesKeys: ["delivery_type", "resource.delivery_type"],
      receiver: CLOUD_MONITORING,
      enabledByDefault: false,
    },
    {
      system: "gcp_pubsub",
      metricName: "pubsub.googleapis.com/topic/send_request_count",
      title: "Publish requests",
      description:
        "Publish requests sent to the topic in each sample period (send_request_count). A request can carry several messages, so this counts requests, not messages.",
      unit: "requests",
      signal: "published",
      kind: "gauge",
      aggregation: AggregationType.Sum,
      seriesCombine: "sum",
      destinationAttributes: PUBSUB_TOPIC_KEYS,
      seriesKeys: [
        "response_class",
        "response_code",
        "resource.response_class",
        "resource.response_code",
      ],
      receiver: CLOUD_MONITORING,
      enabledByDefault: false,
    },

    // Apache Pulsar.
    {
      system: "pulsar",
      metricName: "pulsar_msg_backlog",
      title: "Backlog",
      description:
        "Entries backlogged on the topic across its subscriptions, added up across the topic's partitions. Pulsar counts a batch of messages as one entry.",
      unit: "messages",
      signal: "backlog",
      kind: "gauge",
      aggregation: AggregationType.Avg,
      seriesCombine: "sum",
      destinationAttributes: PULSAR_TOPIC_KEYS,
      seriesKeys: PULSAR_TOPIC_SERIES_KEYS,
      receiver: PROMETHEUS,
      enabledByDefault: true,
    },
    {
      system: "pulsar",
      metricName: "pulsar_subscription_back_log",
      title: "Subscription backlog",
      description:
        "Entries not yet acknowledged on the subscription furthest behind, for its busiest partition. Pulsar counts a batch of messages as one entry.",
      unit: "messages",
      signal: "consumerLag",
      kind: "gauge",
      aggregation: AggregationType.Max,
      seriesCombine: "max",
      destinationAttributes: PULSAR_TOPIC_KEYS,
      seriesKeys: [...PULSAR_TOPIC_SERIES_KEYS, "subscription"],
      receiver: PROMETHEUS,
      enabledByDefault: true,
    },
    {
      system: "pulsar",
      metricName: "pulsar_storage_backlog_age_seconds",
      title: "Backlog age",
      description:
        "Age of the oldest unacknowledged entry in the topic's backlog, for the partition furthest behind; -1 while the broker cannot tell.",
      unit: "s",
      signal: "oldestMessageAge",
      kind: "gauge",
      aggregation: AggregationType.Max,
      seriesCombine: "max",
      destinationAttributes: PULSAR_TOPIC_KEYS,
      seriesKeys: PULSAR_TOPIC_SERIES_KEYS,
      receiver: PROMETHEUS,
      enabledByDefault: true,
    },
    {
      system: "pulsar",
      metricName: "pulsar_in_messages_total",
      title: "Messages in",
      description:
        "Messages published to the topic per second, added up across its partitions. Pulsar exposes the running total as a gauge; the chart shows its rate.",
      unit: "messages",
      signal: "published",
      kind: "counter",
      aggregation: AggregationType.Max,
      seriesCombine: "sum",
      destinationAttributes: PULSAR_TOPIC_KEYS,
      receiver: PROMETHEUS,
      enabledByDefault: true,
    },
    {
      system: "pulsar",
      metricName: "pulsar_out_messages_total",
      title: "Messages out",
      description:
        "Messages dispatched to the topic's subscriptions per second, added up across partitions and subscriptions. The per-consumer copies Pulsar adds when consumer-level metrics are on are left out, so no message is counted twice.",
      unit: "messages",
      signal: "consumed",
      kind: "counter",
      aggregation: AggregationType.Max,
      seriesCombine: "sum",
      destinationAttributes: PULSAR_TOPIC_KEYS,
      excludeSeriesWithAttributes: PULSAR_CONSUMER_KEYS,
      receiver: PROMETHEUS,
      enabledByDefault: true,
    },

    // Apache RocketMQ.
    {
      system: "rocketmq",
      metricName: "rocketmq_consumer_lag_messages",
      title: "Consumer lag",
      description:
        "Messages a consumer group has not yet consumed on this topic. With several consumer groups or brokers, the largest value is shown.",
      unit: "messages",
      signal: "consumerLag",
      kind: "gauge",
      aggregation: AggregationType.Max,
      seriesCombine: "max",
      destinationAttributes: ROCKETMQ_TOPIC_KEYS,
      seriesKeys: ["consumer_group", "is_retry"],
      receiver: PROMETHEUS,
      enabledByDefault: true,
    },
    {
      system: "rocketmq",
      metricName: "rocketmq_consumer_ready_messages",
      title: "Ready messages",
      description:
        "Messages ready for a consumer group to pull from this topic. With several consumer groups or brokers, the largest value is shown.",
      unit: "messages",
      signal: "backlog",
      kind: "gauge",
      aggregation: AggregationType.Max,
      seriesCombine: "max",
      destinationAttributes: ROCKETMQ_TOPIC_KEYS,
      seriesKeys: ["consumer_group", "is_retry"],
      receiver: PROMETHEUS,
      enabledByDefault: true,
    },
    {
      system: "rocketmq",
      metricName: "rocketmq_send_to_dlq_messages_total",
      title: "Sent to dead-letter queue",
      description:
        "Messages moved to a consumer group's dead-letter queue after running out of retries, per second, counted under the topic they came from.",
      unit: "messages",
      signal: "deadLetter",
      kind: "counter",
      aggregation: AggregationType.Max,
      seriesCombine: "sum",
      destinationAttributes: ROCKETMQ_TOPIC_KEYS,
      receiver: PROMETHEUS,
      enabledByDefault: true,
    },
    {
      system: "rocketmq",
      metricName: "rocketmq_messages_in_total",
      title: "Messages in",
      description: "Messages produced to the topic per second.",
      unit: "messages",
      signal: "published",
      kind: "counter",
      aggregation: AggregationType.Max,
      seriesCombine: "sum",
      destinationAttributes: ROCKETMQ_TOPIC_KEYS,
      receiver: PROMETHEUS,
      enabledByDefault: true,
    },
  ];

/*
 * Messaging SDK metrics that name a destination but no `messaging.system`,
 * so only their name says which system reports them. The Azure SDK for
 * Java's Service Bus meter (ServiceBusMeter) stamps the namespace host, the
 * entity and the subscription alone — azure-core-metrics-opentelemetry
 * renames hostName, entityName and subscriptionName to `server.address`,
 * `messaging.destination.name` and `messaging.servicebus.subscription_name`
 * — plus an outcome. (Its Event Hubs sibling does set `messaging.system`.)
 */
export const MESSAGING_SDK_METRIC_SYSTEMS: ReadonlyMap<string, string> =
  new Map<string, string>([
    ["messaging.servicebus.messages.sent", "servicebus"],
    ["messaging.servicebus.receiver.lag", "servicebus"],
    ["messaging.servicebus.settlement.request.duration", "servicebus"],
    ["messaging.servicebus.settlement.sequence_number", "servicebus"],
  ]);

/*
 * The messaging CLIENT metrics — what instrumented applications report
 * about their own sends and receives: the OpenTelemetry semantic-convention
 * ones, current (1.28 and later) and deprecated, and the SDK metrics above.
 * They are not curated per system: each datapoint names its own destination
 * (and, but for the SDK metrics above, its own `messaging.system`), so it
 * resolves like a span (resolveMessagingMetricDatapoint). The deprecated
 * names are still what the Java agent's default mode and the Azure SDK for
 * Java emit. Ingest and the discovery cron select datapoints by this set.
 */
export const MESSAGING_CLIENT_METRIC_NAMES: ReadonlySet<string> =
  new Set<string>([
    "messaging.client.sent.messages",
    "messaging.client.consumed.messages",
    "messaging.client.operation.duration",
    "messaging.process.duration",
    "messaging.publish.duration",
    "messaging.receive.duration",
    "messaging.publish.messages",
    "messaging.receive.messages",
    "messaging.process.messages",
    "messaging.client.published.messages",
    ...Array.from(MESSAGING_SDK_METRIC_SYSTEMS.keys()),
  ]);

// metric name → its entries (one per system that emits the name).
const DESCRIPTORS_BY_NAME: ReadonlyMap<
  string,
  ReadonlyArray<MessageQueueMetricDescriptor>
> = ((): Map<string, Array<MessageQueueMetricDescriptor>> => {
  const map: Map<string, Array<MessageQueueMetricDescriptor>> = new Map<
    string,
    Array<MessageQueueMetricDescriptor>
  >();
  for (const descriptor of MESSAGE_QUEUE_METRICS) {
    const existing: Array<MessageQueueMetricDescriptor> | undefined = map.get(
      descriptor.metricName,
    );
    if (existing) {
      existing.push(descriptor);
    } else {
      map.set(descriptor.metricName, [descriptor]);
    }
  }
  return map;
})();

// Every curated broker metric name, as stored.
export const MESSAGE_QUEUE_BROKER_METRIC_NAMES: ReadonlySet<string> =
  new Set<string>(DESCRIPTORS_BY_NAME.keys());

const NO_DESCRIPTORS: ReadonlyArray<MessageQueueMetricDescriptor> = [];

/**
 * The curated metrics for a system, in display order (aliases accepted:
 * "AmazonSQS" gets Amazon SQS's). Empty for a system without a curated set
 * — the queue page then shows where its broker metrics come from instead.
 */
export function getMessageQueueMetricsForSystem(
  system: string | null | undefined,
): ReadonlyArray<MessageQueueMetricDescriptor> {
  const normalized: string | null = normalizeMessagingSystem(system);
  if (!normalized) {
    return NO_DESCRIPTORS;
  }
  return MESSAGE_QUEUE_METRICS.filter(
    (descriptor: MessageQueueMetricDescriptor): boolean => {
      return descriptor.system === normalized;
    },
  );
}

/**
 * Every entry for a metric name — several when systems share it (Azure
 * Monitor names Service Bus's and Event Hubs' metrics alike; their
 * `requiredAttributes` tell them apart). Trimmed and lowercased first, as
 * ingest stores names; empty for a name the catalog does not curate. A Map
 * lookup, so "constructor" finds nothing.
 */
export function getMessageQueueMetricDescriptorsByName(
  metricName: string,
): ReadonlyArray<MessageQueueMetricDescriptor> {
  if (typeof metricName !== "string") {
    return NO_DESCRIPTORS;
  }
  return (
    DESCRIPTORS_BY_NAME.get(metricName.trim().toLowerCase()) || NO_DESCRIPTORS
  );
}

/**
 * A stable id for an entry — `${system}:${metricName}`. A name alone is not
 * unique: Service Bus and Event Hubs share Azure Monitor's.
 */
export function getMessageQueueMetricId(
  descriptor: MessageQueueMetricDescriptor,
): string {
  return `${descriptor.system}:${descriptor.metricName}`;
}
