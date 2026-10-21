import {
  getMessageQueueMetricDescriptorsByName,
  getMessageQueueMetricId,
  getMessageQueueMetricsForSystem,
  MESSAGE_QUEUE_BROKER_METRIC_NAMES,
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
  MESSAGING_CLIENT_METRIC_NAMES,
  MESSAGING_SDK_METRIC_SYSTEMS,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  getMessagingBrokerMetricsReceivers,
  getMessagingBrokerScope,
  getMessagingSystemDescriptor,
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
  normalizeMessagingSystem,
} from "../../../Types/MessageQueue/MessagingSystem";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { METRIC_FIXTURES, MetricFixture } from "./MessagingTelemetryFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * Every curated metric, exactly: what its tile and chart compute. A wrong
 * aggregation, series combine or unit still draws a plausible chart — the
 * lag of every consumer group added up instead of the worst one, a CloudWatch
 * average summed, a Pub/Sub backlog in the wrong unit — so each is pinned
 * here, checked against the descriptor's description when it was written.
 * The design's minimum set (DESIGN.md §2.4) is part of it.
 */
interface ExpectedMetricRow {
  system: string;
  metricName: string;
  signal: MessageQueueMetricDescriptor["signal"];
  kind: MessageQueueMetricDescriptor["kind"];
  unit: string;
  aggregation: AggregationType;
  seriesCombine: MessageQueueMetricDescriptor["seriesCombine"];
  seriesKeys: ReadonlyArray<string> | null;
  excludeSeriesWithAttributes: ReadonlyArray<string> | null;
}

function row(
  system: string,
  metricName: string,
  signal: MessageQueueMetricDescriptor["signal"],
  kind: MessageQueueMetricDescriptor["kind"],
  unit: string,
  aggregation: AggregationType,
  seriesCombine: MessageQueueMetricDescriptor["seriesCombine"],
  seriesKeys: ReadonlyArray<string> | null = null,
  excludeSeriesWithAttributes: ReadonlyArray<string> | null = null,
): ExpectedMetricRow {
  return {
    system,
    metricName,
    signal,
    kind,
    unit,
    aggregation,
    seriesCombine,
    seriesKeys,
    excludeSeriesWithAttributes,
  };
}

function rowOf(descriptor: MessageQueueMetricDescriptor): ExpectedMetricRow {
  return row(
    descriptor.system,
    descriptor.metricName,
    descriptor.signal,
    descriptor.kind,
    descriptor.unit,
    descriptor.aggregation,
    descriptor.seriesCombine,
    descriptor.seriesKeys || null,
    descriptor.excludeSeriesWithAttributes || null,
  );
}

const AZURE_RESULT: ReadonlyArray<string> = [
  "metadata_operationresult",
  "metadata_OperationResult",
];

const EXPECTED_METRICS: ReadonlyArray<ExpectedMetricRow> = [
  // Kafka: the group (or partition) furthest behind, never the total.
  row(
    "kafka",
    "kafka.consumer_group.lag_sum",
    "consumerLag",
    "gauge",
    "messages",
    AggregationType.Max,
    "max",
    ["group"],
  ),
  row(
    "kafka",
    "kafka.consumer_group.lag",
    "consumerLag",
    "gauge",
    "messages",
    AggregationType.Max,
    "max",
    ["group", "partition"],
  ),
  row(
    "kafka",
    "kafka.consumer_group.offset_sum",
    "consumed",
    "counter",
    "messages",
    AggregationType.Max,
    "sum",
  ),
  row(
    "kafka",
    "kafka.partition.current_offset",
    "published",
    "counter",
    "messages",
    AggregationType.Max,
    "sum",
  ),
  // RabbitMQ: ready + unacknowledged; the fewest consumers seen in a bucket.
  row(
    "rabbitmq",
    "rabbitmq.message.current",
    "backlog",
    "gauge",
    "messages",
    AggregationType.Avg,
    "sum",
    ["state"],
  ),
  row(
    "rabbitmq",
    "rabbitmq.message.published",
    "published",
    "counter",
    "messages",
    AggregationType.Max,
    "sum",
  ),
  row(
    "rabbitmq",
    "rabbitmq.message.delivered",
    "consumed",
    "counter",
    "messages",
    AggregationType.Max,
    "sum",
  ),
  row(
    "rabbitmq",
    "rabbitmq.message.acknowledged",
    "consumed",
    "counter",
    "messages",
    AggregationType.Max,
    "sum",
  ),
  row(
    "rabbitmq",
    "rabbitmq.message.dropped",
    "errors",
    "counter",
    "messages",
    AggregationType.Max,
    "sum",
  ),
  row(
    "rabbitmq",
    "rabbitmq.consumer.count",
    "consumers",
    "gauge",
    "consumers",
    AggregationType.Min,
    "sum",
  ),
  // ActiveMQ: added up across brokers; AverageEnqueueTime in s, legacy in ms.
  row(
    "activemq",
    "activemq.message.queue.size",
    "backlog",
    "gauge",
    "messages",
    AggregationType.Avg,
    "sum",
    ["activemq.broker.name", "activemq.destination.type"],
  ),
  row(
    "activemq",
    "activemq.message.current",
    "backlog",
    "gauge",
    "messages",
    AggregationType.Avg,
    "sum",
    ["broker"],
  ),
  row(
    "activemq",
    "activemq.message.enqueued",
    "published",
    "counter",
    "messages",
    AggregationType.Max,
    "sum",
  ),
  row(
    "activemq",
    "activemq.message.dequeued",
    "consumed",
    "counter",
    "messages",
    AggregationType.Max,
    "sum",
  ),
  row(
    "activemq",
    "activemq.message.expired",
    "errors",
    "counter",
    "messages",
    AggregationType.Max,
    "sum",
  ),
  row(
    "activemq",
    "activemq.consumer.count",
    "consumers",
    "gauge",
    "consumers",
    AggregationType.Min,
    "sum",
    ["activemq.broker.name", "activemq.destination.type", "broker"],
  ),
  row(
    "activemq",
    "activemq.message.enqueue.average_duration",
    "oldestMessageAge",
    "gauge",
    "s",
    AggregationType.Max,
    "max",
  ),
  row(
    "activemq",
    "activemq.message.wait_time.avg",
    "oldestMessageAge",
    "gauge",
    "ms",
    AggregationType.Max,
    "max",
  ),
  // Service Bus: levels at their worst, per-minute counts summed.
  row(
    "servicebus",
    "azure_activemessages_average",
    "backlog",
    "gauge",
    "messages",
    AggregationType.Max,
    "max",
  ),
  row(
    "servicebus",
    "azure_deadletteredmessages_average",
    "deadLetter",
    "gauge",
    "messages",
    AggregationType.Max,
    "max",
  ),
  row(
    "servicebus",
    "azure_incomingmessages_total",
    "published",
    "gauge",
    "messages",
    AggregationType.Sum,
    "sum",
  ),
  row(
    "servicebus",
    "azure_outgoingmessages_total",
    "consumed",
    "gauge",
    "messages",
    AggregationType.Sum,
    "sum",
  ),
  row(
    "servicebus",
    "azure_completemessage_total",
    "consumed",
    "gauge",
    "messages",
    AggregationType.Sum,
    "sum",
  ),
  row(
    "servicebus",
    "azure_abandonmessage_total",
    "errors",
    "gauge",
    "messages",
    AggregationType.Sum,
    "sum",
  ),
  row(
    "servicebus",
    "azure_servererrors_total",
    "errors",
    "gauge",
    "requests",
    AggregationType.Sum,
    "sum",
    AZURE_RESULT,
  ),
  row(
    "servicebus",
    "azure_usererrors_total",
    "errors",
    "gauge",
    "requests",
    AggregationType.Sum,
    "sum",
    AZURE_RESULT,
  ),
  row(
    "servicebus",
    "azure_throttledrequests_total",
    "throttled",
    "gauge",
    "requests",
    AggregationType.Sum,
    "sum",
    [
      ...AZURE_RESULT,
      "metadata_messagingerrorsubcode",
      "metadata_MessagingErrorSubCode",
    ],
  ),
  // Event Hubs.
  row(
    "eventhubs",
    "azure_incomingmessages_total",
    "published",
    "gauge",
    "messages",
    AggregationType.Sum,
    "sum",
  ),
  row(
    "eventhubs",
    "azure_outgoingmessages_total",
    "consumed",
    "gauge",
    "messages",
    AggregationType.Sum,
    "sum",
  ),
  row(
    "eventhubs",
    "azure_servererrors_total",
    "errors",
    "gauge",
    "requests",
    AggregationType.Sum,
    "sum",
    AZURE_RESULT,
  ),
  row(
    "eventhubs",
    "azure_usererrors_total",
    "errors",
    "gauge",
    "requests",
    AggregationType.Sum,
    "sum",
    AZURE_RESULT,
  ),
  row(
    "eventhubs",
    "azure_quotaexceedederrors_total",
    "errors",
    "gauge",
    "requests",
    AggregationType.Sum,
    "sum",
    AZURE_RESULT,
  ),
  row(
    "eventhubs",
    "azure_throttledrequests_total",
    "throttled",
    "gauge",
    "requests",
    AggregationType.Sum,
    "sum",
    AZURE_RESULT,
  ),
  // Amazon SQS: CloudWatch's Average of a level, its Sum of a count; one series per queue.
  row(
    "aws_sqs",
    "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
    "backlog",
    "gauge",
    "messages",
    AggregationType.Avg,
    "max",
  ),
  row(
    "aws_sqs",
    "approximatenumberofmessagesvisible",
    "backlog",
    "gauge",
    "messages",
    AggregationType.Avg,
    "max",
  ),
  row(
    "aws_sqs",
    "amazonaws.com/aws/sqs/approximateageofoldestmessage",
    "oldestMessageAge",
    "gauge",
    "s",
    AggregationType.Max,
    "max",
  ),
  row(
    "aws_sqs",
    "approximateageofoldestmessage",
    "oldestMessageAge",
    "gauge",
    "s",
    AggregationType.Max,
    "max",
  ),
  row(
    "aws_sqs",
    "amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible",
    "backlog",
    "gauge",
    "messages",
    AggregationType.Avg,
    "max",
  ),
  row(
    "aws_sqs",
    "approximatenumberofmessagesnotvisible",
    "backlog",
    "gauge",
    "messages",
    AggregationType.Avg,
    "max",
  ),
  row(
    "aws_sqs",
    "amazonaws.com/aws/sqs/numberofmessagessent",
    "published",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  row(
    "aws_sqs",
    "numberofmessagessent",
    "published",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  row(
    "aws_sqs",
    "amazonaws.com/aws/sqs/numberofmessagesreceived",
    "consumed",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  row(
    "aws_sqs",
    "numberofmessagesreceived",
    "consumed",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  row(
    "aws_sqs",
    "amazonaws.com/aws/sqs/numberofmessagesdeleted",
    "consumed",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  row(
    "aws_sqs",
    "numberofmessagesdeleted",
    "consumed",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  // Amazon SNS.
  row(
    "aws.sns",
    "amazonaws.com/aws/sns/numberofmessagespublished",
    "published",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  row(
    "aws.sns",
    "numberofmessagespublished",
    "published",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  row(
    "aws.sns",
    "amazonaws.com/aws/sns/numberofnotificationsdelivered",
    "consumed",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  row(
    "aws.sns",
    "numberofnotificationsdelivered",
    "consumed",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  row(
    "aws.sns",
    "amazonaws.com/aws/sns/numberofnotificationsfailed",
    "errors",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  row(
    "aws.sns",
    "numberofnotificationsfailed",
    "errors",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  row(
    "aws.sns",
    "amazonaws.com/aws/sns/numberofnotificationsredriventodlq",
    "deadLetter",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  row(
    "aws.sns",
    "numberofnotificationsredriventodlq",
    "deadLetter",
    "gauge",
    "messages",
    AggregationType.Sum,
    "max",
  ),
  // Google Cloud Pub/Sub: levels at their worst, DELTA counts summed.
  row(
    "gcp_pubsub",
    "pubsub.googleapis.com/subscription/num_undelivered_messages",
    "backlog",
    "gauge",
    "messages",
    AggregationType.Max,
    "max",
  ),
  row(
    "gcp_pubsub",
    "pubsub.googleapis.com/subscription/oldest_unacked_message_age",
    "oldestMessageAge",
    "gauge",
    "s",
    AggregationType.Max,
    "max",
  ),
  row(
    "gcp_pubsub",
    "pubsub.googleapis.com/subscription/dead_letter_message_count",
    "deadLetter",
    "gauge",
    "messages",
    AggregationType.Sum,
    "sum",
    ["response_code", "resource.response_code"],
  ),
  row(
    "gcp_pubsub",
    "pubsub.googleapis.com/subscription/ack_message_count",
    "consumed",
    "gauge",
    "messages",
    AggregationType.Sum,
    "sum",
    ["delivery_type", "resource.delivery_type"],
  ),
  row(
    "gcp_pubsub",
    "pubsub.googleapis.com/topic/send_request_count",
    "published",
    "gauge",
    "requests",
    AggregationType.Sum,
    "sum",
    [
      "response_class",
      "response_code",
      "resource.response_class",
      "resource.response_code",
    ],
  ),
  // Apache Pulsar: a topic's partitions add up; lag and age at their worst.
  row(
    "pulsar",
    "pulsar_msg_backlog",
    "backlog",
    "gauge",
    "messages",
    AggregationType.Avg,
    "sum",
    ["cluster", "topic", "partition"],
  ),
  row(
    "pulsar",
    "pulsar_subscription_back_log",
    "consumerLag",
    "gauge",
    "messages",
    AggregationType.Max,
    "max",
    ["cluster", "topic", "partition", "subscription"],
  ),
  row(
    "pulsar",
    "pulsar_storage_backlog_age_seconds",
    "oldestMessageAge",
    "gauge",
    "s",
    AggregationType.Max,
    "max",
    ["cluster", "topic", "partition"],
  ),
  row(
    "pulsar",
    "pulsar_in_messages_total",
    "published",
    "counter",
    "messages",
    AggregationType.Max,
    "sum",
  ),
  row(
    "pulsar",
    "pulsar_out_messages_total",
    "consumed",
    "counter",
    "messages",
    AggregationType.Max,
    "sum",
    null,
    ["consumer_name", "consumer_id"],
  ),
  // Apache RocketMQ: the group furthest behind.
  row(
    "rocketmq",
    "rocketmq_consumer_lag_messages",
    "consumerLag",
    "gauge",
    "messages",
    AggregationType.Max,
    "max",
    ["consumer_group", "is_retry"],
  ),
  row(
    "rocketmq",
    "rocketmq_consumer_ready_messages",
    "backlog",
    "gauge",
    "messages",
    AggregationType.Max,
    "max",
    ["consumer_group", "is_retry"],
  ),
  row(
    "rocketmq",
    "rocketmq_send_to_dlq_messages_total",
    "deadLetter",
    "counter",
    "messages",
    AggregationType.Max,
    "sum",
  ),
  row(
    "rocketmq",
    "rocketmq_messages_in_total",
    "published",
    "counter",
    "messages",
    AggregationType.Max,
    "sum",
  ),
];

/*
 * Running totals — each MUST be a counter (charting the raw value would
 * draw an ever-rising line): monotonic cumulative Sums per the receivers'
 * metadata.yaml, offsets that only grow, and Pulsar's `*_total` gauges that
 * hold running totals (live: `# TYPE pulsar_in_messages_total gauge`).
 */
const KNOWN_RUNNING_TOTALS: ReadonlyArray<string> = [
  "kafka.consumer_group.offset_sum",
  "kafka.partition.current_offset",
  "rabbitmq.message.published",
  "rabbitmq.message.delivered",
  "rabbitmq.message.acknowledged",
  "rabbitmq.message.dropped",
  "activemq.message.enqueued",
  "activemq.message.dequeued",
  "activemq.message.expired",
  "pulsar_in_messages_total",
  "pulsar_out_messages_total",
  "rocketmq_send_to_dlq_messages_total",
  "rocketmq_messages_in_total",
];

/*
 * Never counters: levels, and the per-period counts cloud monitoring
 * reports (Azure's `_total` is one minute's sum, a CloudWatch point one
 * period's, a Pub/Sub DELTA one sample's) — their rate would be meaningless.
 */
const KNOWN_LEVELS_AND_PERIOD_COUNTS: ReadonlyArray<string> = [
  "kafka.consumer_group.lag_sum",
  "kafka.consumer_group.lag",
  "rabbitmq.message.current",
  "rabbitmq.consumer.count",
  "activemq.message.queue.size",
  "activemq.message.current",
  "activemq.consumer.count",
  "activemq.message.enqueue.average_duration",
  "activemq.message.wait_time.avg",
  "azure_activemessages_average",
  "azure_deadletteredmessages_average",
  "azure_incomingmessages_total",
  "azure_outgoingmessages_total",
  "azure_completemessage_total",
  "azure_abandonmessage_total",
  "azure_servererrors_total",
  "azure_usererrors_total",
  "azure_throttledrequests_total",
  "azure_quotaexceedederrors_total",
  "amazonaws.com/aws/sqs/numberofmessagessent",
  "numberofmessagessent",
  "amazonaws.com/aws/sns/numberofmessagespublished",
  "pubsub.googleapis.com/subscription/num_undelivered_messages",
  "pubsub.googleapis.com/subscription/dead_letter_message_count",
  "pubsub.googleapis.com/subscription/ack_message_count",
  "pubsub.googleapis.com/topic/send_request_count",
  "pulsar_msg_backlog",
  "pulsar_subscription_back_log",
  "pulsar_storage_backlog_age_seconds",
  "rocketmq_consumer_lag_messages",
  "rocketmq_consumer_ready_messages",
];

/*
 * The datapoint attributes that split each curated GAUGE into several
 * series, from the receivers' source and live captures (stored keys). Each
 * must be handled: a destination or scope key, a required key, a series key
 * (added up or maxed) — or listed in CONSTANT_PER_DESTINATION (the same
 * value for every series of one destination, so pooling it is harmless).
 */
const GAUGE_SPLITTING_ATTRIBUTES: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  "kafka.consumer_group.lag_sum": ["group", "topic"],
  "kafka.consumer_group.lag": ["group", "topic", "partition"],
  "rabbitmq.message.current": ["state", "resource.rabbitmq.queue.name"],
  "rabbitmq.consumer.count": ["resource.rabbitmq.queue.name"],
  "activemq.message.queue.size": [
    "messaging.destination.name",
    "activemq.destination.type",
    "activemq.broker.name",
  ],
  "activemq.message.current": ["destination", "broker"],
  "activemq.consumer.count": [
    "messaging.destination.name",
    "activemq.destination.type",
    "activemq.broker.name",
    "destination",
    "broker",
  ],
  azure_servererrors_total: ["metadata_entityname", "metadata_operationresult"],
  azure_usererrors_total: ["metadata_entityname", "metadata_operationresult"],
  azure_throttledrequests_total: [
    "metadata_entityname",
    "metadata_operationresult",
  ],
  "pubsub.googleapis.com/subscription/dead_letter_message_count": [
    "response_code",
  ],
  "pubsub.googleapis.com/subscription/ack_message_count": ["delivery_type"],
  "pubsub.googleapis.com/topic/send_request_count": [
    "response_class",
    "response_code",
  ],
  pulsar_msg_backlog: ["cluster", "namespace", "topic"],
  pulsar_subscription_back_log: [
    "cluster",
    "namespace",
    "topic",
    "subscription",
  ],
  pulsar_storage_backlog_age_seconds: ["cluster", "namespace", "topic"],
  rocketmq_consumer_lag_messages: [
    "topic",
    "consumer_group",
    "is_retry",
    "is_system",
  ],
  rocketmq_consumer_ready_messages: [
    "topic",
    "consumer_group",
    "is_retry",
    "is_system",
  ],
};

/*
 * Attributes that never differ between the series of one destination: a
 * Pulsar topic lives in exactly one namespace; a RocketMQ topic is a system
 * topic or not.
 */
const CONSTANT_PER_DESTINATION: ReadonlyArray<string> = [
  "namespace",
  "is_system",
];

/*
 * Resource attributes the curated sources emit, by their bare OTel name. A
 * catalog key naming one without the `resource.` prefix would never match
 * a stored datapoint.
 */
const KNOWN_RESOURCE_ATTRIBUTES: ReadonlyArray<string> = [
  "rabbitmq.queue.name",
  "rabbitmq.vhost.name",
  "rabbitmq.node.name",
  "kafka.cluster.alias",
  "kafka.cluster.id",
  "subscription_id",
  "topic_id",
  "project_id",
  "gcp.resource_type",
  "service.name",
  "service.namespace",
  "service.instance.id",
  "server.address",
  "server.port",
  "cloud.provider",
  "cloud.account.id",
  "cloud.region",
  "azuremonitor.subscription_id",
  "azuremonitor.tenant_id",
];

const ALLOWED_UNITS: ReadonlyArray<string> = [
  "messages",
  "s",
  "ms",
  "requests",
  "consumers",
];

const ALLOWED_AGGREGATIONS: ReadonlyArray<AggregationType> = [
  AggregationType.Avg,
  AggregationType.Sum,
  AggregationType.Max,
  AggregationType.Min,
];

function keysOf(descriptor: MessageQueueMetricDescriptor): Array<string> {
  return [
    ...descriptor.destinationAttributes,
    ...(descriptor.scopeAttributes || []),
    ...Object.keys(descriptor.requiredAttributes || {}),
    ...(descriptor.seriesKeys || []),
  ];
}

function descriptorsNamed(
  metricName: string,
): Array<MessageQueueMetricDescriptor> {
  return MESSAGE_QUEUE_METRICS.filter(
    (descriptor: MessageQueueMetricDescriptor): boolean => {
      return descriptor.metricName === metricName;
    },
  );
}

describe("MESSAGE_QUEUE_METRICS catalog", () => {
  test.each(
    EXPECTED_METRICS.map(
      (expected: ExpectedMetricRow): [string, ExpectedMetricRow] => {
        return [`${expected.system} ${expected.metricName}`, expected];
      },
    ),
  )(
    "%s is curated exactly as expected",
    (_name: string, expected: ExpectedMetricRow) => {
      const match: MessageQueueMetricDescriptor | undefined =
        MESSAGE_QUEUE_METRICS.find(
          (descriptor: MessageQueueMetricDescriptor): boolean => {
            return (
              descriptor.system === expected.system &&
              descriptor.metricName === expected.metricName
            );
          },
        );
      expect(match).toBeDefined();
      expect(rowOf(match!)).toEqual(expected);
    },
  );

  test("every curated metric is pinned above, and nothing more", () => {
    expect(MESSAGE_QUEUE_METRICS.map(rowOf)).toEqual(EXPECTED_METRICS);
  });

  test("consumer lag always shows the consumer furthest behind, never a total", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      if (descriptor.signal !== "consumerLag") {
        continue;
      }
      expect({
        metric: descriptor.metricName,
        kind: descriptor.kind,
        aggregation: descriptor.aggregation,
        seriesCombine: descriptor.seriesCombine,
      }).toEqual({
        metric: descriptor.metricName,
        kind: "gauge",
        aggregation: AggregationType.Max,
        seriesCombine: "max",
      });
    }
  });

  test("a cloud provider's per-period count is summed within a bucket; its levels never are", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      const bare: string = descriptor.metricName.substring(
        descriptor.metricName.lastIndexOf("/") + 1,
      );
      const isPeriodCount: boolean =
        (descriptor.receiver === "azure_monitor" && bare.endsWith("_total")) ||
        (["aws_cloudwatch", "awsfirehose"].includes(descriptor.receiver) &&
          bare.startsWith("numberof")) ||
        (descriptor.receiver === "googlecloudmonitoring" &&
          bare.endsWith("_count"));
      const isCloudLevel: boolean =
        (descriptor.receiver === "azure_monitor" &&
          bare.endsWith("_average")) ||
        (["aws_cloudwatch", "awsfirehose"].includes(descriptor.receiver) &&
          bare.startsWith("approximate")) ||
        (descriptor.receiver === "googlecloudmonitoring" &&
          !bare.endsWith("_count"));
      if (isPeriodCount) {
        expect({
          metric: descriptor.metricName,
          aggregation: descriptor.aggregation,
        }).toEqual({
          metric: descriptor.metricName,
          aggregation: AggregationType.Sum,
        });
      }
      if (isCloudLevel) {
        expect({
          metric: descriptor.metricName,
          summed: descriptor.aggregation === AggregationType.Sum,
        }).toEqual({ metric: descriptor.metricName, summed: false });
      }
    }
  });

  test("a message's age is in seconds everywhere but the JMX Scraper's legacy name", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      if (descriptor.signal !== "oldestMessageAge") {
        continue;
      }
      expect({ metric: descriptor.metricName, unit: descriptor.unit }).toEqual({
        metric: descriptor.metricName,
        unit:
          descriptor.metricName === "activemq.message.wait_time.avg"
            ? "ms"
            : "s",
      });
    }
  });

  test("a backlog made of parts adds them up: RabbitMQ's states, Pulsar's partitions, ActiveMQ's brokers", () => {
    for (const metricName of [
      "rabbitmq.message.current",
      "pulsar_msg_backlog",
      "activemq.message.queue.size",
      "activemq.message.current",
    ]) {
      for (const descriptor of descriptorsNamed(metricName)) {
        expect(descriptor.signal).toBe("backlog");
        expect(descriptor.seriesCombine).toBe("sum");
        expect((descriptor.seriesKeys || []).length).toBeGreaterThan(0);
      }
    }
  });

  test("a consumer count shows the fewest consumers a bucket saw", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      if (descriptor.signal === "consumers") {
        expect(descriptor.aggregation).toBe(AggregationType.Min);
      }
    }
  });

  test("repeat markers are datapoint keys no other role of the entry uses", () => {
    let marked: number = 0;
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      const markers: ReadonlyArray<string> =
        descriptor.excludeSeriesWithAttributes || [];
      if (markers.length === 0) {
        expect(descriptor.excludeSeriesWithAttributes).toBeUndefined();
        continue;
      }
      marked++;
      const used: Set<string> = new Set<string>(keysOf(descriptor));
      for (const key of markers) {
        expect(key).toBe(key.trim());
        expect(key.startsWith("resource.")).toBe(false);
        expect({ key, alsoUsed: used.has(key) }).toEqual({
          key,
          alsoUsed: false,
        });
      }
    }
    expect(marked).toBe(1);
  });

  test("names are lowercase and trimmed, exactly as ingest stores them", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      expect(descriptor.metricName).toBe(
        descriptor.metricName.trim().toLowerCase(),
      );
      expect(descriptor.metricName).not.toMatch(/\s/);
      expect(descriptor.metricName.length).toBeGreaterThan(0);
    }
  });

  test("every system is a canonical catalog system", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      expect(normalizeMessagingSystem(descriptor.system)).toBe(
        descriptor.system,
      );
      expect(getMessagingSystemDescriptor(descriptor.system)).not.toBeNull();
    }
  });

  test("a system has a name at most once", () => {
    const ids: Array<string> = MESSAGE_QUEUE_METRICS.map(
      (descriptor: MessageQueueMetricDescriptor): string => {
        return `${descriptor.system}|${descriptor.metricName}`;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("titles are non-empty, trimmed and unique per system", () => {
    const seen: Map<string, Set<string>> = new Map<string, Set<string>>();
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      expect(descriptor.title.length).toBeGreaterThan(0);
      expect(descriptor.title).toBe(descriptor.title.trim());
      const titles: Set<string> =
        seen.get(descriptor.system) || new Set<string>();
      expect({
        system: descriptor.system,
        title: descriptor.title,
        duplicate: titles.has(descriptor.title.toLowerCase()),
      }).toEqual({
        system: descriptor.system,
        title: descriptor.title,
        duplicate: false,
      });
      titles.add(descriptor.title.toLowerCase());
      seen.set(descriptor.system, titles);
    }
  });

  test("descriptions are full sentences", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      const text: string = descriptor.description;
      expect({ metric: descriptor.metricName, text: text.trim() }).toEqual({
        metric: descriptor.metricName,
        text,
      });
      expect(text.length).toBeGreaterThan(20);
      expect(text).toMatch(/^[A-Z]/);
      expect(text.endsWith(".")).toBe(true);
    }
  });

  test("units, signals, aggregations and combines come from the allowed sets", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      expect(ALLOWED_UNITS).toContain(descriptor.unit);
      expect([
        "backlog",
        "deadLetter",
        "consumerLag",
        "published",
        "consumed",
        "errors",
        "throttled",
        "oldestMessageAge",
        "consumers",
      ]).toContain(descriptor.signal);
      expect(["gauge", "counter"]).toContain(descriptor.kind);
      expect(ALLOWED_AGGREGATIONS).toContain(descriptor.aggregation);
      expect(["sum", "max", "avg"]).toContain(descriptor.seriesCombine);
    }
  });

  test("a time signal is in seconds or milliseconds, and only a time signal is", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      const isTime: boolean =
        descriptor.unit === "s" || descriptor.unit === "ms";
      expect({
        metric: descriptor.metricName,
        isTime,
      }).toEqual({
        metric: descriptor.metricName,
        isTime: descriptor.signal === "oldestMessageAge",
      });
    }
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      if (descriptor.signal === "consumers") {
        expect(descriptor.unit).toBe("consumers");
      }
    }
  });

  test("counters use aggregation Max and seriesCombine sum, and carry no series keys", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      if (descriptor.kind !== "counter") {
        continue;
      }
      expect({
        metric: descriptor.metricName,
        aggregation: descriptor.aggregation,
        seriesCombine: descriptor.seriesCombine,
        seriesKeys: descriptor.seriesKeys,
      }).toEqual({
        metric: descriptor.metricName,
        aggregation: AggregationType.Max,
        seriesCombine: "sum",
        seriesKeys: undefined,
      });
    }
  });

  test.each(
    KNOWN_RUNNING_TOTALS.map((name: string): [string] => {
      return [name];
    }),
  )("%s is a counter", (metricName: string) => {
    const matches: Array<MessageQueueMetricDescriptor> =
      descriptorsNamed(metricName);
    expect(matches.length).toBeGreaterThan(0);
    for (const descriptor of matches) {
      expect(descriptor.kind).toBe("counter");
    }
  });

  test.each(
    KNOWN_LEVELS_AND_PERIOD_COUNTS.map((name: string): [string] => {
      return [name];
    }),
  )("%s is a gauge", (metricName: string) => {
    const matches: Array<MessageQueueMetricDescriptor> =
      descriptorsNamed(metricName);
    expect(matches.length).toBeGreaterThan(0);
    for (const descriptor of matches) {
      expect(descriptor.kind).toBe("gauge");
    }
  });

  test("every cloud-monitoring metric is a gauge: providers report per-period values, never running totals", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      if (
        [
          "azure_monitor",
          "aws_cloudwatch",
          "awsfirehose",
          "googlecloudmonitoring",
        ].includes(descriptor.receiver)
      ) {
        expect({
          metric: descriptor.metricName,
          kind: descriptor.kind,
        }).toEqual({ metric: descriptor.metricName, kind: "gauge" });
      }
    }
  });

  test("destination keys are non-empty, unique and trimmed", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      expect(descriptor.destinationAttributes.length).toBeGreaterThan(0);
      expect(new Set(descriptor.destinationAttributes).size).toBe(
        descriptor.destinationAttributes.length,
      );
      for (const key of keysOf(descriptor)) {
        expect(key).toBe(key.trim());
        expect(key.length).toBeGreaterThan(0);
      }
    }
  });

  test("resource keys carry the stored `resource.` prefix", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      for (const key of keysOf(descriptor)) {
        expect({
          metric: descriptor.metricName,
          key,
          unprefixedResourceKey: KNOWN_RESOURCE_ATTRIBUTES.includes(key),
        }).toEqual({
          metric: descriptor.metricName,
          key,
          unprefixedResourceKey: false,
        });
        if (key.startsWith("resource.")) {
          expect(key.length).toBeGreaterThan("resource.".length);
        }
      }
    }
  });

  test("every receiver is named by its system's broker-metrics source", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      const system: MessagingSystemDescriptor | null =
        getMessagingSystemDescriptor(descriptor.system);
      expect({
        metric: descriptor.metricName,
        receiver: descriptor.receiver,
        named: getMessagingBrokerMetricsReceivers(
          system!.brokerMetrics,
        ).includes(descriptor.receiver),
      }).toEqual({
        metric: descriptor.metricName,
        receiver: descriptor.receiver,
        named: true,
      });
    }
  });

  test("only a namespace-scoped system reads a scope, and it always does", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      const scoped: boolean =
        getMessagingBrokerScope(descriptor.system) === "azure-namespace";
      expect({
        metric: descriptor.metricName,
        system: descriptor.system,
        hasScope: Boolean(
          descriptor.scopeAttributes && descriptor.scopeAttributes.length > 0,
        ),
      }).toEqual({
        metric: descriptor.metricName,
        system: descriptor.system,
        hasScope: scoped,
      });
    }
  });

  test("required values are lowercase and non-empty", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      for (const [key, values] of Object.entries(
        descriptor.requiredAttributes || {},
      )) {
        expect(key.length).toBeGreaterThan(0);
        expect(values.length).toBeGreaterThan(0);
        for (const value of values) {
          expect(value).toBe(value.trim().toLowerCase());
          expect(value.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("a name several systems share is told apart by disjoint required values", () => {
    const byName: Map<string, Array<MessageQueueMetricDescriptor>> = new Map<
      string,
      Array<MessageQueueMetricDescriptor>
    >();
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      byName.set(descriptor.metricName, [
        ...(byName.get(descriptor.metricName) || []),
        descriptor,
      ]);
    }
    let shared: number = 0;
    for (const [name, descriptors] of byName) {
      if (descriptors.length < 2) {
        continue;
      }
      shared++;
      const claimed: Set<string> = new Set<string>();
      for (const descriptor of descriptors) {
        expect({
          name,
          required: Boolean(descriptor.requiredAttributes),
        }).toEqual({ name, required: true });
        for (const [key, values] of Object.entries(
          descriptor.requiredAttributes || {},
        )) {
          for (const value of values) {
            const claim: string = `${key}=${value}`;
            expect({ name, claim, taken: claimed.has(claim) }).toEqual({
              name,
              claim,
              taken: false,
            });
            claimed.add(claim);
          }
        }
      }
    }
    // Service Bus and Event Hubs share Azure Monitor's names.
    expect(shared).toBeGreaterThanOrEqual(5);
  });

  test("every Azure metric requires its namespace type and reads both EntityName spellings", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      if (descriptor.receiver !== "azure_monitor") {
        continue;
      }
      expect(descriptor.metricName.startsWith("azure_")).toBe(true);
      expect(descriptor.destinationAttributes).toEqual([
        "metadata_entityname",
        "metadata_EntityName",
      ]);
      expect(descriptor.scopeAttributes).toEqual(["name"]);
      expect(descriptor.requiredAttributes).toEqual({
        type: [
          descriptor.system === "servicebus"
            ? "microsoft.servicebus/namespaces"
            : "microsoft.eventhub/namespaces",
        ],
      });
      // A breakdown dimension is read under both spellings too.
      for (const key of descriptor.seriesKeys || []) {
        expect(key.startsWith("metadata_")).toBe(true);
        const lower: string = key.toLowerCase();
        expect(
          (descriptor.seriesKeys || []).filter((other: string): boolean => {
            return other.toLowerCase() === lower;
          }).length,
        ).toBe(2);
      }
    }
  });

  test("every CloudWatch metric exists in both shapes, alike but for the name, key and title", () => {
    const aws: Array<MessageQueueMetricDescriptor> =
      MESSAGE_QUEUE_METRICS.filter(
        (descriptor: MessageQueueMetricDescriptor): boolean => {
          return (
            descriptor.system === "aws_sqs" || descriptor.system === "aws.sns"
          );
        },
      );
    const pulled: Array<MessageQueueMetricDescriptor> = aws.filter(
      (descriptor: MessageQueueMetricDescriptor): boolean => {
        return descriptor.receiver === "aws_cloudwatch";
      },
    );
    expect(pulled.length * 2).toBe(aws.length);
    for (const namespaced of pulled) {
      const prefix: string =
        namespaced.system === "aws_sqs"
          ? "amazonaws.com/aws/sqs/"
          : "amazonaws.com/aws/sns/";
      expect(namespaced.metricName.startsWith(prefix)).toBe(true);
      const bare: string = namespaced.metricName.substring(prefix.length);
      const json: MessageQueueMetricDescriptor | undefined = aws.find(
        (descriptor: MessageQueueMetricDescriptor): boolean => {
          return (
            descriptor.system === namespaced.system &&
            descriptor.metricName === bare
          );
        },
      );
      expect(json).toBeDefined();
      const dimension: string =
        namespaced.system === "aws_sqs" ? "QueueName" : "TopicName";
      expect(namespaced.destinationAttributes).toEqual([
        `Dimensions.${dimension}`,
      ]);
      expect(namespaced.requiredAttributes).toBeUndefined();
      expect(json!.destinationAttributes).toEqual([dimension]);
      expect(json!.requiredAttributes).toEqual({
        "resource.service.name": [
          namespaced.system === "aws_sqs" ? "sqs" : "sns",
        ],
      });
      expect(json!.receiver).toBe("awsfirehose");
      expect(json!.title).toBe(`${namespaced.title} (JSON stream)`);
      expect({
        signal: json!.signal,
        kind: json!.kind,
        unit: json!.unit,
        aggregation: json!.aggregation,
        seriesCombine: json!.seriesCombine,
        description: json!.description,
      }).toEqual({
        signal: namespaced.signal,
        kind: namespaced.kind,
        unit: namespaced.unit,
        aggregation: namespaced.aggregation,
        seriesCombine: namespaced.seriesCombine,
        description: namespaced.description,
      });
    }
  });

  test("every splitting attribute of a curated gauge is handled", () => {
    for (const [metricName, attributes] of Object.entries(
      GAUGE_SPLITTING_ATTRIBUTES,
    )) {
      const matches: Array<MessageQueueMetricDescriptor> =
        descriptorsNamed(metricName);
      expect({ metricName, curated: matches.length > 0 }).toEqual({
        metricName,
        curated: true,
      });
      for (const descriptor of matches) {
        expect(descriptor.kind).toBe("gauge");
        const handled: Set<string> = new Set<string>(keysOf(descriptor));
        for (const attribute of attributes) {
          expect({
            metricName,
            system: descriptor.system,
            attribute,
            handled:
              handled.has(attribute) ||
              CONSTANT_PER_DESTINATION.includes(attribute),
          }).toEqual({
            metricName,
            system: descriptor.system,
            attribute,
            handled: true,
          });
        }
      }
    }
  });

  test("the RabbitMQ queue depth adds its ready and unacknowledged series", () => {
    expect(descriptorsNamed("rabbitmq.message.current")[0]).toMatchObject({
      seriesKeys: ["state"],
      seriesCombine: "sum",
    });
  });

  test("only Pub/Sub is off by default: the receiver reads only listed metric types", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      expect({
        metric: descriptor.metricName,
        enabledByDefault: descriptor.enabledByDefault,
      }).toEqual({
        metric: descriptor.metricName,
        enabledByDefault: descriptor.receiver !== "googlecloudmonitoring",
      });
    }
  });

  test("every curated system has 4 to 12 entries; the others have none", () => {
    for (const system of MESSAGING_SYSTEMS) {
      const count: number = getMessageQueueMetricsForSystem(
        system.system,
      ).length;
      if (["jms", "nats", "bullmq", "eventgrid"].includes(system.system)) {
        expect({ system: system.system, count }).toEqual({
          system: system.system,
          count: 0,
        });
      } else {
        expect(count).toBeGreaterThanOrEqual(4);
        expect(count).toBeLessThanOrEqual(12);
      }
    }
  });

  test("every curated metric has a realistic datapoint fixture that resolves to a queue", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      const fixture: MetricFixture | undefined = METRIC_FIXTURES.find(
        (candidate: MetricFixture): boolean => {
          return (
            candidate.metricName === descriptor.metricName &&
            candidate.expected !== null &&
            candidate.expected.system === descriptor.system
          );
        },
      );
      expect({
        system: descriptor.system,
        metric: descriptor.metricName,
        covered: fixture !== undefined,
      }).toEqual({
        system: descriptor.system,
        metric: descriptor.metricName,
        covered: true,
      });
    }
  });
});

describe("getMessageQueueMetricsForSystem", () => {
  test("returns a system's entries in catalog order", () => {
    for (const system of MESSAGING_SYSTEMS) {
      expect(getMessageQueueMetricsForSystem(system.system)).toEqual(
        MESSAGE_QUEUE_METRICS.filter(
          (descriptor: MessageQueueMetricDescriptor): boolean => {
            return descriptor.system === system.system;
          },
        ),
      );
    }
    expect(
      getMessageQueueMetricsForSystem("rabbitmq").map(
        (descriptor: MessageQueueMetricDescriptor): string => {
          return descriptor.metricName;
        },
      ),
    ).toEqual([
      "rabbitmq.message.current",
      "rabbitmq.message.published",
      "rabbitmq.message.delivered",
      "rabbitmq.message.acknowledged",
      "rabbitmq.message.dropped",
      "rabbitmq.consumer.count",
    ]);
  });

  test("accepts aliases and any casing", () => {
    expect(getMessageQueueMetricsForSystem("AmazonSQS")).toEqual(
      getMessageQueueMetricsForSystem("aws_sqs"),
    );
    expect(getMessageQueueMetricsForSystem("azure_servicebus")).toEqual(
      getMessageQueueMetricsForSystem("servicebus"),
    );
    expect(getMessageQueueMetricsForSystem("  KAFKA ")).toEqual(
      getMessageQueueMetricsForSystem("kafka"),
    );
    expect(getMessageQueueMetricsForSystem("artemis").length).toBeGreaterThan(
      0,
    );
  });

  test("an unknown, excluded or empty system has no curated metrics", () => {
    expect(getMessageQueueMetricsForSystem("ibmmq")).toEqual([]);
    expect(getMessageQueueMetricsForSystem("spring_integration")).toEqual([]);
    expect(getMessageQueueMetricsForSystem("")).toEqual([]);
    expect(getMessageQueueMetricsForSystem(null)).toEqual([]);
    expect(getMessageQueueMetricsForSystem(undefined)).toEqual([]);
    expect(getMessageQueueMetricsForSystem("constructor")).toEqual([]);
  });
});

describe("getMessageQueueMetricDescriptorsByName", () => {
  test("finds each name's entries, trimmed and case-insensitively", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      expect(
        getMessageQueueMetricDescriptorsByName(descriptor.metricName),
      ).toContain(descriptor);
      expect(
        getMessageQueueMetricDescriptorsByName(
          `  ${descriptor.metricName.toUpperCase()}  `,
        ),
      ).toContain(descriptor);
    }
  });

  test("Azure Monitor's shared names return one entry per service", () => {
    expect(
      getMessageQueueMetricDescriptorsByName(
        "azure_incomingmessages_total",
      ).map((descriptor: MessageQueueMetricDescriptor): string => {
        return descriptor.system;
      }),
    ).toEqual(["servicebus", "eventhubs"]);
    expect(
      getMessageQueueMetricDescriptorsByName(
        "azure_activemessages_average",
      ).map((descriptor: MessageQueueMetricDescriptor): string => {
        return descriptor.system;
      }),
    ).toEqual(["servicebus"]);
  });

  test("an unknown name, an own-property name or a non-string finds nothing", () => {
    for (const name of [
      "",
      "system.cpu.utilization",
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(getMessageQueueMetricDescriptorsByName(name)).toEqual([]);
    }
    expect(
      getMessageQueueMetricDescriptorsByName(null as unknown as string),
    ).toEqual([]);
    expect(
      getMessageQueueMetricDescriptorsByName(42 as unknown as string),
    ).toEqual([]);
  });
});

describe("metric name sets", () => {
  test("MESSAGE_QUEUE_BROKER_METRIC_NAMES is exactly the catalog's names", () => {
    expect([...MESSAGE_QUEUE_BROKER_METRIC_NAMES].sort()).toEqual(
      [
        ...new Set(
          MESSAGE_QUEUE_METRICS.map(
            (descriptor: MessageQueueMetricDescriptor): string => {
              return descriptor.metricName;
            },
          ),
        ),
      ].sort(),
    );
  });

  test("MESSAGING_CLIENT_METRIC_NAMES is the semconv client metrics, current and deprecated, and the SDK metrics that name no system", () => {
    expect([...MESSAGING_CLIENT_METRIC_NAMES].sort()).toEqual(
      [
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
        // The Azure SDK for Java's ServiceBusMeter.
        "messaging.servicebus.messages.sent",
        "messaging.servicebus.receiver.lag",
        "messaging.servicebus.settlement.request.duration",
        "messaging.servicebus.settlement.sequence_number",
      ].sort(),
    );
    for (const name of MESSAGING_CLIENT_METRIC_NAMES) {
      expect(name).toBe(name.toLowerCase());
      expect(name.startsWith("messaging.")).toBe(true);
    }
  });

  test("an SDK metric's implied system is a canonical catalog system, and ingest selects it", () => {
    expect(MESSAGING_SDK_METRIC_SYSTEMS.size).toBeGreaterThan(0);
    for (const [name, system] of MESSAGING_SDK_METRIC_SYSTEMS) {
      expect(normalizeMessagingSystem(system)).toBe(system);
      expect(getMessagingSystemDescriptor(system)).not.toBeNull();
      expect(MESSAGING_CLIENT_METRIC_NAMES.has(name)).toBe(true);
      expect(name).toBe(name.trim().toLowerCase());
    }
  });

  test("a client metric is never a curated broker metric", () => {
    for (const name of MESSAGING_CLIENT_METRIC_NAMES) {
      expect(MESSAGE_QUEUE_BROKER_METRIC_NAMES.has(name)).toBe(false);
      expect(getMessageQueueMetricDescriptorsByName(name)).toEqual([]);
    }
  });
});

describe("getMessageQueueMetricId", () => {
  test("is `${system}:${metricName}` and unique across the catalog", () => {
    const ids: Array<string> = MESSAGE_QUEUE_METRICS.map(
      (descriptor: MessageQueueMetricDescriptor): string => {
        return getMessageQueueMetricId(descriptor);
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      getMessageQueueMetricId(
        getMessageQueueMetricDescriptorsByName(
          "azure_incomingmessages_total",
        )[1]!,
      ),
    ).toBe("eventhubs:azure_incomingmessages_total");
  });
});
