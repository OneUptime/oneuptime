import {
  AttributeGetter,
  MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
  resolveMessagingSpan,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import {
  buildMessageQueueIdentifier,
  MessageQueueIdentity,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import { keyForMessageQueue } from "../../../Utils/Telemetry/EntityKey";
import { describe, expect, test } from "@jest/globals";

/*
 * Messaging telemetry exactly as each instrumentation and each broker-metrics
 * receiver emits it — attribute for attribute, per-message values included so
 * the resolver is proven to ignore them — with the queue OneUptime must find
 * in it. The attribute sets are rebuilt from the instrumentations' and
 * receivers' source and from live captures against real brokers (research:
 * messaging-semconv.md, broker-metrics-selfhosted.md, broker-metrics-azure.md,
 * broker-metrics-aws-gcp.md and the upstream files they cite). Every
 * expectation follows the research's rules, never the resolver's output.
 *
 * Spans carry the exported attribute map and the stored SpanKind string.
 * Datapoints carry the STORED flattened map: datapoint keys bare, resource
 * keys with the `resource.` prefix, a kvlist flattened to `<key>.<nestedKey>`
 * (CloudWatch's `Dimensions.QueueName`).
 *
 * The last block is the point of it all: a span of an application using a
 * queue and a broker metric describing the same queue must land on one
 * identity, one identifier and one entity key — otherwise the broker's health
 * never attaches to the queue its producers and consumers use.
 */

type Attributes = Record<string, unknown>;

interface SpanFixture {
  id: string;
  // The instrumentation, its version or mode, and the operation.
  source: string;
  kind: string | null;
  attributes: Attributes;
  expected: ResolvedMessagingDestination | null;
}

interface DatapointFixture {
  id: string;
  // The receiver or SDK that emits it, and its configuration.
  source: string;
  metricName: string;
  attributes: Attributes;
  expected: ResolvedMessagingDestination | null;
}

interface SameQueuePair {
  queue: string;
  spanId: string;
  datapointId: string;
  identity: MessageQueueIdentity;
}

interface QueueKeys {
  identity: MessageQueueIdentity;
  identifier: string | null;
  entityKey: string;
}

const PRODUCER: string = "SPAN_KIND_PRODUCER";
const CONSUMER: string = "SPAN_KIND_CONSUMER";
const CLIENT: string = "SPAN_KIND_CLIENT";
const INTERNAL: string = "SPAN_KIND_INTERNAL";
const SERVER: string = "SPAN_KIND_SERVER";

const PROJECT_ID: string = "8c2f0d6e-3b1a-4c5d-9e7f-0a1b2c3d4e5f";

// A resolution, with the fields a fixture does not state at their defaults.
function queue(
  partial: Partial<ResolvedMessagingDestination> & {
    system: string;
    destination: string;
  },
): ResolvedMessagingDestination {
  return {
    brokerScope: "",
    brokerAddress: null,
    direction: "unknown",
    consumerGroup: null,
    isDeadLetter: false,
    ...partial,
  };
}

// ---- shared values --------------------------------------------------------

const SERVICE_BUS_HOST: string = "billing-prod.servicebus.windows.net";
const EVENT_HUBS_HOST: string = "telemetry-prod.servicebus.windows.net";
const AZURE_SUBSCRIPTION_ID: string = "0f6a1c2b-3d4e-4f60-8a7b-9c0d1e2f3a4b";
const AZURE_TENANT_ID: string = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const AZURE_SCHEMA_URL: string = "https://opentelemetry.io/schemas/1.23.0";

const SQS_QUEUE_URL: string =
  "https://sqs.eu-west-1.amazonaws.com/123456789012/payment-events";
const SQS_HOST: string = "sqs.eu-west-1.amazonaws.com";
const SNS_TOPIC_ARN: string =
  "arn:aws:sns:eu-west-1:123456789012:payment-notifications";
const SNS_ENDPOINT_RESOURCE: string =
  "endpoint/GCM/billing-app/5e3e9847-3183-3f18-a7e8-671c3a57d4b3";

const UUID_TOPIC: string = "tenant-3f2b9c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d-events";
const UUID_TOPIC_TEMPLATED: string = "tenant-{uuid}-events";

// amqplib's connection attributes (url password censored by the library).
const AMQPLIB_CONNECTION: Attributes = {
  "messaging.protocol_version": "0.9.1",
  "messaging.url": "amqp://billing:***@rabbitmq.internal:5672/billing",
  "messaging.protocol": "AMQP",
  "server.address": "rabbitmq.internal",
  "server.port": 5672,
  "messaging.system": "rabbitmq",
};

// RabbitMQ.Client .NET v7 CreationTags.
const RABBITMQ_DOTNET_CREATION_TAGS: Attributes = {
  "messaging.system": "rabbitmq",
  "network.protocol.name": "amqp",
  "network.protocol.version": "0.9.1",
};

// azure_monitor: resource attributes on by default in the code.
const AZURE_MONITOR_RESOURCE: Attributes = {
  "resource.azuremonitor.subscription_id": AZURE_SUBSCRIPTION_ID,
  "resource.azuremonitor.tenant_id": AZURE_TENANT_ID,
};

const SERVICE_BUS_DATAPOINT: Attributes = {
  ...AZURE_MONITOR_RESOURCE,
  "azuremonitor.resource_id": `/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/billing-rg/providers/Microsoft.ServiceBus/namespaces/billing-prod`,
  location: "westeurope",
  name: "billing-prod",
  resource_group: "billing-rg",
  type: "Microsoft.ServiceBus/namespaces",
};

const EVENT_HUBS_DATAPOINT: Attributes = {
  ...AZURE_MONITOR_RESOURCE,
  "azuremonitor.resource_id": `/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/telemetry-rg/providers/Microsoft.EventHub/namespaces/telemetry-prod`,
  location: "westeurope",
  name: "telemetry-prod",
  resource_group: "telemetry-rg",
  timegrain: "PT1M",
  type: "Microsoft.EventHub/namespaces",
};

// Metric Stream (OpenTelemetry 1.0 format) / aws_cloudwatch resource.
const CLOUDWATCH_OTEL_RESOURCE: Attributes = {
  "resource.cloud.provider": "aws",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "eu-west-1",
  "resource.aws.exporter.arn":
    "arn:aws:cloudwatch:eu-west-1:123456789012:metric-stream/oneuptime",
};

// Metric Stream (JSON format) resource for an AWS/<service> namespace.
function cloudWatchJsonResource(service: string): Attributes {
  return {
    "resource.aws.cloudwatch.metric_stream_name": "oneuptime",
    "resource.cloud.account.id": "123456789012",
    "resource.cloud.provider": "aws",
    "resource.cloud.region": "eu-west-1",
    "resource.service.name": service,
    "resource.service.namespace": "AWS",
  };
}

// The JMX Scraper's SDK resource (captured live, jmx-scraper 1.60.0-alpha).
const JMX_SCRAPER_RESOURCE: Attributes = {
  "resource.service.instance.id": "174b52e6-c976-3dfd-8e52-bfb13115009a",
  "resource.service.name": "activemq-prod",
  "resource.telemetry.sdk.language": "java",
  "resource.telemetry.sdk.name": "opentelemetry",
  "resource.telemetry.sdk.version": "1.65.0",
};

// The prometheus receiver's resource for a scrape target.
function prometheusResource(
  job: string,
  host: string,
  port: string,
): Attributes {
  return {
    "resource.server.address": host,
    "resource.server.port": port,
    "resource.service.instance.id": `${host}:${port}`,
    "resource.service.name": job,
    "resource.url.scheme": "http",
  };
}

const PULSAR_RESOURCE: Attributes = prometheusResource(
  "pulsar-broker",
  "pulsar-broker-0.pulsar-broker",
  "8080",
);
const PULSAR_BROKER_ADDRESS: string = "pulsar-broker-0.pulsar-broker:8080";

const ROCKETMQ_RESOURCE: Attributes = prometheusResource(
  "rocketmq-broker",
  "rocketmq-broker-a",
  "5557",
);
const ROCKETMQ_BROKER_ADDRESS: string = "rocketmq-broker-a:5557";

const RABBITMQ_QUEUE_RESOURCE: (queueName: string) => Attributes = (
  queueName: string,
): Attributes => {
  return {
    "resource.rabbitmq.queue.name": queueName,
    "resource.rabbitmq.vhost.name": "/",
    "resource.rabbitmq.node.name": "rabbit@rabbitmq-0",
  };
};

// ---- spans ----------------------------------------------------------------

const KAFKA_SPANS: ReadonlyArray<SpanFixture> = [
  {
    id: "kafka.java-agent.default.send",
    source: "Java agent 2.x kafka-clients send, default (pre-1.28) conventions",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "payments",
      "messaging.operation": "publish",
      "messaging.client_id": "producer-1",
      "messaging.destination.partition.id": "2",
      "messaging.kafka.message.key": "order-10042",
      "messaging.kafka.message.offset": 4711,
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "publish",
    }),
  },
  {
    id: "kafka.java-agent.default.process",
    source: "Java agent 2.x kafka-clients process, default conventions",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "payments",
      "messaging.operation": "process",
      "messaging.client_id": "consumer-billing-1",
      "messaging.kafka.consumer.group": "billing",
      "messaging.destination.partition.id": "0",
      "messaging.kafka.message.offset": 17,
      "messaging.kafka.message.key": "order-10042",
      "messaging.message.body.size": 512,
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "consume",
      consumerGroup: "billing",
    }),
  },
  {
    id: "kafka.java-agent.opt-in.process",
    source:
      "Java agent kafka-clients process, OTEL_SEMCONV_STABILITY_OPT_IN=messaging",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "payments",
      "messaging.operation.name": "process",
      "messaging.operation.type": "process",
      "messaging.consumer.group.name": "billing",
      "messaging.client.id": "consumer-billing-1",
      "messaging.destination.partition.id": "0",
      "messaging.kafka.offset": 17,
      "messaging.kafka.message.key": "order-10042",
      "messaging.message.body.size": 512,
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "consume",
      consumerGroup: "billing",
    }),
  },
  {
    id: "kafka.java-agent.dup.poll",
    source:
      "Java agent kafka-clients poll, OTEL_SEMCONV_STABILITY_OPT_IN=messaging/dup (old and new keys)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "payments",
      "messaging.operation": "receive",
      "messaging.operation.name": "poll",
      "messaging.operation.type": "receive",
      "messaging.kafka.consumer.group": "billing",
      "messaging.consumer.group.name": "billing",
      "messaging.client_id": "consumer-billing-1",
      "messaging.client.id": "consumer-billing-1",
      "messaging.batch.message_count": 25,
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "consume",
      consumerGroup: "billing",
    }),
  },
  {
    id: "kafka.java-agent.default.send.uuid-topic",
    source: "Java agent kafka-clients send to a per-tenant topic named by UUID",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": UUID_TOPIC,
      "messaging.operation": "publish",
      "messaging.client_id": "producer-3",
      "messaging.destination.partition.id": "5",
    },
    expected: queue({
      system: "kafka",
      destination: UUID_TOPIC_TEMPLATED,
      direction: "publish",
    }),
  },
  {
    id: "kafka.confluent-dotnet.send",
    source: "OpenTelemetry.Instrumentation.ConfluentKafka (.NET) produce",
    kind: PRODUCER,
    attributes: {
      "messaging.destination.name": "payments",
      "messaging.operation.name": "send",
      "messaging.operation.type": "send",
      "messaging.system": "kafka",
      "messaging.destination.partition.id": "1",
      "messaging.client.id": "rdkafka#producer-1",
      "messaging.kafka.message.key": "order-10042",
      "messaging.kafka.cluster.id": "lkc-7yq8z",
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "publish",
    }),
  },
  {
    id: "kafka.confluent-dotnet.poll",
    source: "OpenTelemetry.Instrumentation.ConfluentKafka (.NET) poll",
    kind: CLIENT,
    attributes: {
      "messaging.operation.name": "poll",
      "messaging.operation.type": "receive",
      "messaging.system": "kafka",
      "messaging.consumer.group.name": "billing",
      "messaging.destination.name": "payments",
      "messaging.destination.partition.id": "0",
      "messaging.client.id": "rdkafka#consumer-2",
      "messaging.kafka.offset": 17,
      "messaging.kafka.cluster.id": "lkc-7yq8z",
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "consume",
      consumerGroup: "billing",
    }),
  },
  {
    id: "kafka.kafkajs.process",
    source: "@opentelemetry/instrumentation-kafkajs 0.9+ eachMessage",
    kind: CONSUMER,
    attributes: {
      "messaging.destination.partition.id": "0",
      "messaging.system": "kafka",
      "messaging.destination.name": "payments",
      "messaging.operation.type": "process",
      "messaging.operation.name": "process",
      "messaging.kafka.message.key": "order-10042",
      "messaging.kafka.offset": "17",
      "messaging.kafka.cluster.id": "5L6g3nShT-eMCtK--X86sw",
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "consume",
    }),
  },
  {
    id: "kafka.kafkajs-0.7.receive",
    source:
      "@opentelemetry/instrumentation-kafkajs before 0.9 (pre-1.17 destination key)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination": "payments",
      "messaging.operation": "receive",
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "consume",
    }),
  },
  {
    id: "kafka.confluent-kafka-python.v0.62.produce",
    source:
      "opentelemetry-instrumentation-confluent-kafka up to v0.62b1: operation 'receive' on its PRODUCER span",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination": "payments",
      "messaging.destination_kind": "queue",
      "messaging.operation": "receive",
      "messaging.kafka.partition": 2,
      "server.address": "kafka-0.kafka-headless.data.svc",
      "server.port": 9092,
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "publish",
      brokerAddress: "kafka-0.kafka-headless.data.svc:9092",
    }),
  },
  {
    id: "kafka.confluent-kafka-python.v0.63.produce",
    source:
      "opentelemetry-instrumentation-confluent-kafka v0.63b0+: operation fixed to 'publish'",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination": "payments",
      "messaging.destination_kind": "queue",
      "messaging.operation": "publish",
      "messaging.kafka.partition": 2,
      "server.address": "kafka-0.kafka-headless.data.svc",
      "server.port": 9092,
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "publish",
      brokerAddress: "kafka-0.kafka-headless.data.svc:9092",
    }),
  },
  {
    id: "kafka.aiokafka.getone",
    source:
      "opentelemetry-instrumentation-aiokafka getone (bootstrap servers as a JSON list in server.address)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "payments",
      "messaging.operation.name": "receive",
      "messaging.operation.type": "receive",
      "messaging.consumer.group.name": "billing",
      "messaging.client.id": "aiokafka-1",
      "messaging.destination.partition.id": "0",
      "messaging.kafka.message.offset": 17,
      "messaging.kafka.message.key": "order-10042",
      "server.address": '["kafka-0:9092", "kafka-1:9092", "kafka-2:9092"]',
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "consume",
      consumerGroup: "billing",
      brokerAddress: "kafka-0:9092",
    }),
  },
];

const RABBITMQ_SPANS: ReadonlyArray<SpanFixture> = [
  {
    id: "rabbitmq.java-agent.default.publish.named-exchange",
    source:
      "Java agent rabbitmq-2.7 basic.publish, default mode (the destination is the EXCHANGE)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "orders.topic",
      "messaging.operation": "publish",
      "messaging.rabbitmq.destination.routing_key": "orders.eu.created",
      "messaging.message.body.size": 512,
      "network.peer.address": "10.0.3.17",
      "network.peer.port": 5672,
      "network.type": "ipv4",
    },
    expected: queue({
      system: "rabbitmq",
      destination: "orders.topic",
      direction: "publish",
      brokerAddress: "10.0.3.17:5672",
    }),
  },
  {
    id: "rabbitmq.java-agent.default.process.default-exchange",
    source:
      "Java agent rabbitmq-2.7 delivery, default mode, through the default exchange ('<default>' + routing key = queue)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "<default>",
      "messaging.operation": "process",
      "messaging.rabbitmq.destination.routing_key": "invoices",
      "messaging.message.body.size": 128,
      "network.peer.address": "10.0.3.17",
      "network.peer.port": 5672,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "invoices",
      direction: "consume",
      brokerAddress: "10.0.3.17:5672",
    }),
  },
  {
    id: "rabbitmq.java-agent.default.receive.server-named-queue",
    source:
      "Java agent rabbitmq-2.7 basic.get from a server-named queue (amq.gen-), default mode",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "<default>",
      "messaging.operation": "receive",
      "messaging.rabbitmq.destination.routing_key":
        "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
      "network.peer.address": "10.0.3.17",
      "network.peer.port": 5672,
    },
    expected: null,
  },
  {
    /*
     * semconv rabbitmq.yaml (consumer spans): '{exchange}:{routing key}:{queue}',
     * empty parts omitted, and "when {routing key} and {queue} are equal, only
     * one of them SHOULD be used, e.g. {exchange}:{routing key}" — the Java
     * agent's consumerDestinationName does exactly that. So on a consumer,
     * `direct_logs:warning` is exchange direct_logs, queue warning.
     */
    id: "rabbitmq.java-agent.opt-in.process.routing-key-is-queue",
    source:
      "Java agent rabbitmq-2.7 delivery, opt-in: 'direct_logs:warning' (routing key == queue, so the queue part is omitted)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "direct_logs:warning",
      "messaging.operation.name": "process",
      "messaging.operation.type": "process",
      "messaging.rabbitmq.destination.routing_key": "warning",
      "messaging.rabbitmq.message.delivery_tag": 7,
      "messaging.message.body.size": 64,
      "network.peer.address": "10.0.3.17",
      "network.peer.port": 5672,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "warning",
      direction: "consume",
      brokerAddress: "10.0.3.17:5672",
    }),
  },
  {
    /*
     * A fanout exchange has an empty routing key: the Java agent omits it
     * from the name and does not set the routing-key attribute, leaving
     * '{exchange}:{queue}'.
     */
    id: "rabbitmq.java-agent.opt-in.process.fanout-empty-routing-key",
    source:
      "Java agent rabbitmq-2.7 delivery, opt-in, from a fanout exchange: 'logs:logs-audit' (empty routing key omitted)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "logs:logs-audit",
      "messaging.operation.name": "process",
      "messaging.operation.type": "process",
      "messaging.rabbitmq.message.delivery_tag": 3,
      "messaging.message.body.size": 256,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "logs-audit",
      direction: "consume",
    }),
  },
  {
    id: "rabbitmq.java-agent.opt-in.settle.three-parts",
    source:
      "Java agent rabbitmq-2.7 basic.ack, opt-in: '{exchange}:{routing key}:{queue}'",
    kind: CLIENT,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "orders.topic:orders.eu.created:orders-eu",
      "messaging.operation.name": "ack",
      "messaging.operation.type": "settle",
      "messaging.rabbitmq.message.delivery_tag": 9,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "orders-eu",
      direction: "settle",
    }),
  },
  {
    id: "rabbitmq.java-agent.opt-in.publish.exchange-and-routing-key",
    source:
      "Java agent rabbitmq-2.7 basic.publish, opt-in: '{exchange}:{routing key}' (a publisher names no queue)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "orders.topic:orders.eu.created",
      "messaging.operation.name": "publish",
      "messaging.operation.type": "send",
      "messaging.rabbitmq.destination.routing_key": "orders.eu.created",
      "messaging.message.body.size": 512,
      "server.address": "rabbitmq.internal",
      "server.port": 5672,
      "network.peer.address": "10.0.3.17",
      "network.peer.port": 5672,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "orders.topic",
      direction: "publish",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
  {
    id: "rabbitmq.java-agent.opt-in.publish.default-exchange",
    source:
      "Java agent rabbitmq-2.7 basic.publish, opt-in, through the default exchange (exchange omitted: the routing key alone)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "invoices",
      "messaging.operation.name": "publish",
      "messaging.operation.type": "send",
      "messaging.rabbitmq.destination.routing_key": "invoices",
      "server.address": "rabbitmq.internal",
      "server.port": 5672,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "invoices",
      direction: "publish",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
  {
    id: "rabbitmq.dotnet-v7.deliver.default-exchange",
    source:
      "RabbitMQ.Client .NET v7 native tracing: deliver through the default exchange (amq.default + routing key)",
    kind: CONSUMER,
    attributes: {
      ...RABBITMQ_DOTNET_CREATION_TAGS,
      "messaging.operation.type": "process",
      "messaging.operation.name": "deliver",
      "messaging.destination.name": "amq.default",
      "messaging.rabbitmq.destination.routing_key": "invoices",
      "messaging.message.body.size": 342,
      "messaging.rabbitmq.delivery_tag": 12,
      "messaging.message.id": "inv-2026-0042",
      "messaging.message.conversation_id": "corr-77",
    },
    expected: queue({
      system: "rabbitmq",
      destination: "invoices",
      direction: "consume",
    }),
  },
  {
    id: "rabbitmq.dotnet-v7.publish.topic-exchange",
    source:
      "RabbitMQ.Client .NET v7 native tracing: publish to a topic exchange (network tags from the frame handler)",
    kind: PRODUCER,
    attributes: {
      ...RABBITMQ_DOTNET_CREATION_TAGS,
      "messaging.operation.type": "send",
      "messaging.operation.name": "publish",
      "messaging.destination.name": "orders.topic",
      "messaging.rabbitmq.destination.routing_key": "orders.eu.created",
      "messaging.message.body.size": 512,
      "network.type": "ipv4",
      "server.address": "rabbitmq.internal",
      "server.port": 5672,
      "network.peer.address": "10.0.3.17",
      "network.peer.port": 5672,
      "client.address": "10.0.9.4",
      "client.port": 51234,
      "network.local.address": "10.0.9.4",
    },
    expected: queue({
      system: "rabbitmq",
      destination: "orders.topic",
      direction: "publish",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
  {
    id: "rabbitmq.dotnet-v7.fetch-empty",
    source:
      "RabbitMQ.Client .NET v7 basic.get that found nothing ('fetch (empty) {queue}': the queue is only in the span name)",
    kind: CONSUMER,
    attributes: {
      ...RABBITMQ_DOTNET_CREATION_TAGS,
      "messaging.operation.type": "receive",
      "messaging.operation.name": "fetch (empty)",
      "messaging.destination.name": "amq.default",
    },
    expected: null,
  },
  {
    id: "rabbitmq.dotnet-v7.publish.direct-reply-to",
    source:
      "RabbitMQ.Client .NET v7 RPC reply through direct reply-to (default exchange, amq.rabbitmq.reply-to.<opaque>)",
    kind: PRODUCER,
    attributes: {
      ...RABBITMQ_DOTNET_CREATION_TAGS,
      "messaging.operation.type": "send",
      "messaging.operation.name": "publish",
      "messaging.destination.name": "amq.default",
      "messaging.rabbitmq.destination.routing_key":
        "amq.rabbitmq.reply-to.g1h2AA5yZXBseUAxMjM0NTY3OAAAB2EAAAAAZvhZzA==",
      "messaging.message.body.size": 96,
    },
    expected: null,
  },
  {
    /*
     * MassTransit names each message type's exchange '<Namespace>:<Type>' and
     * publishes with an EMPTY routing key. The .NET client puts the exchange
     * alone in messaging.destination.name, and semconv's producer rule says
     * '{exchange}:{routing key}' only "when both values are present and
     * non-empty" — so a producer name with ':' and no routing key is one
     * exchange name.
     */
    id: "rabbitmq.dotnet-v7.publish.masstransit-exchange",
    source:
      "RabbitMQ.Client .NET v7 publish from MassTransit to a message-type exchange ('Namespace:Type', empty routing key)",
    kind: PRODUCER,
    attributes: {
      ...RABBITMQ_DOTNET_CREATION_TAGS,
      "messaging.operation.type": "send",
      "messaging.operation.name": "publish",
      "messaging.destination.name": "Contoso.Billing.Contracts:InvoiceIssued",
      "messaging.rabbitmq.destination.routing_key": "",
      "messaging.message.body.size": 1024,
      "server.address": "rabbitmq.internal",
      "server.port": 5672,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "Contoso.Billing.Contracts:InvoiceIssued",
      direction: "publish",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
  {
    /*
     * The consuming side of the same exchange: the .NET client's deliver span
     * names the exchange the message was published to (never the joined
     * '{exchange}:{routing key}:{queue}' form), so the ':' is still part of
     * the exchange name here — unlike the Java agent's opt-in consumer names.
     */
    id: "rabbitmq.dotnet-v7.deliver.masstransit-exchange",
    source:
      "RabbitMQ.Client .NET v7 deliver of a message published to a MassTransit message-type exchange ('Namespace:Type', empty routing key)",
    kind: CONSUMER,
    attributes: {
      ...RABBITMQ_DOTNET_CREATION_TAGS,
      "messaging.operation.type": "process",
      "messaging.operation.name": "deliver",
      "messaging.destination.name": "Contoso.Billing.Contracts:InvoiceIssued",
      "messaging.rabbitmq.destination.routing_key": "",
      "messaging.message.body.size": 1024,
      "messaging.rabbitmq.delivery_tag": 5,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "Contoso.Billing.Contracts:InvoiceIssued",
      direction: "consume",
    }),
  },
  {
    /*
     * RabbitMqMessageNameFormatter ("::", "--", ":", "-") writes a generic
     * type's argument after "--" in its own `Namespace:Type`, so the
     * Fault<T> MassTransit publishes on every consumer fault goes to an
     * exchange with TWO colons — still one exchange, published to with an
     * empty routing key. Semconv joins three parts on a consumer only.
     */
    id: "rabbitmq.dotnet-v7.publish.masstransit-fault-exchange",
    source:
      "RabbitMQ.Client .NET v7 publish from MassTransit of a Fault<T> ('MassTransit:Fault--Namespace:Type--', empty routing key)",
    kind: PRODUCER,
    attributes: {
      ...RABBITMQ_DOTNET_CREATION_TAGS,
      "messaging.operation.type": "send",
      "messaging.operation.name": "publish",
      "messaging.destination.name":
        "MassTransit:Fault--Contoso.Billing.Contracts:InvoiceIssued--",
      "messaging.rabbitmq.destination.routing_key": "",
      "messaging.message.body.size": 2048,
      "server.address": "rabbitmq.internal",
      "server.port": 5672,
    },
    expected: queue({
      system: "rabbitmq",
      destination:
        "MassTransit:Fault--Contoso.Billing.Contracts:InvoiceIssued--",
      direction: "publish",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
  {
    /*
     * The Java agent's opt-in consumer of a MassTransit exchange: the
     * exchange's own colon, the empty routing key left out (and no
     * routing-key attribute), then the queue.
     */
    id: "rabbitmq.java-agent.opt-in.process.masstransit-exchange",
    source:
      "Java agent rabbitmq-2.7 delivery, opt-in, from a MassTransit exchange: 'Namespace:Type:{queue}' (empty routing key omitted)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name":
        "Contoso.Billing.Contracts:InvoiceIssued:invoice-issued",
      "messaging.operation.name": "process",
      "messaging.operation.type": "process",
      "messaging.rabbitmq.message.delivery_tag": 4,
      "messaging.message.body.size": 1024,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "invoice-issued",
      direction: "consume",
    }),
  },
  {
    id: "rabbitmq.amqplib.publish.default-exchange",
    source:
      "@opentelemetry/instrumentation-amqplib publish to the default exchange ('' exchange, routing key = queue)",
    kind: PRODUCER,
    attributes: {
      ...AMQPLIB_CONNECTION,
      "messaging.destination": "",
      "messaging.destination_kind": "topic",
      "messaging.rabbitmq.routing_key": "invoices",
      "messaging.message_id": "inv-2026-0042",
      "messaging.conversation_id": "corr-77",
    },
    expected: queue({
      system: "rabbitmq",
      destination: "invoices",
      direction: "publish",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
  {
    id: "rabbitmq.amqplib.consume.named-exchange",
    source:
      "@opentelemetry/instrumentation-amqplib consume of a message routed by a named exchange",
    kind: CONSUMER,
    attributes: {
      ...AMQPLIB_CONNECTION,
      "messaging.destination": "orders.topic",
      "messaging.destination_kind": "topic",
      "messaging.rabbitmq.routing_key": "orders.eu.created",
      "messaging.operation": "process",
      "messaging.message_id": "ord-1",
    },
    expected: queue({
      system: "rabbitmq",
      destination: "orders.topic",
      direction: "consume",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
  {
    id: "rabbitmq.amqplib.consume.server-named-queue",
    source:
      "@opentelemetry/instrumentation-amqplib consume from a server-named queue via the default exchange",
    kind: CONSUMER,
    attributes: {
      ...AMQPLIB_CONNECTION,
      "messaging.destination": "",
      "messaging.destination_kind": "topic",
      "messaging.rabbitmq.routing_key": "amq.gen-Xa2bE9nqT0y5Pq1wR7uVcA",
      "messaging.operation": "process",
    },
    expected: null,
  },
  {
    id: "rabbitmq.pika.publish.default-exchange",
    source:
      "opentelemetry-instrumentation-pika basic_publish (sets messaging.temp_destination on every publish)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.temp_destination": true,
      "messaging.destination": "invoices",
      "messaging.message.id": "inv-2026-0042",
      "messaging.conversation_id": "corr-77",
      "net.peer.name": "rabbitmq.internal",
      "net.peer.port": 5672,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "invoices",
      direction: "publish",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
  {
    id: "rabbitmq.pika.consume.named-exchange",
    source: "opentelemetry-instrumentation-pika consumer callback",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.operation": "receive",
      "messaging.destination": "orders.topic",
      "net.peer.name": "rabbitmq.internal",
      "net.peer.port": 5672,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "orders.topic",
      direction: "consume",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
  {
    id: "rabbitmq.aio-pika.publish.named-exchange",
    source:
      "opentelemetry-instrumentation-aio-pika publish ('{exchange},{routing key}', comma-joined)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination": "orders.topic,orders.eu.created",
      "net.peer.name": "rabbitmq.internal",
      "net.peer.port": 5672,
      "messaging.message.id": "ord-1",
      "messaging.temp_destination": true,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "orders.topic",
      direction: "publish",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
  {
    id: "rabbitmq.aio-pika.publish.default-exchange",
    source:
      "opentelemetry-instrumentation-aio-pika publish on the default exchange (',{routing key}')",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination": ",invoices",
      "net.peer.name": "rabbitmq.internal",
      "net.peer.port": 5672,
      "messaging.temp_destination": true,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "invoices",
      direction: "publish",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
  {
    id: "rabbitmq.aio-pika.consume.default-exchange",
    source:
      "opentelemetry-instrumentation-aio-pika consume (exchange or routing key)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.operation": "receive",
      "messaging.destination": "invoices",
      "net.peer.name": "rabbitmq.internal",
      "net.peer.port": 5672,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "invoices",
      direction: "consume",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
];

const JMS_SPANS: ReadonlyArray<SpanFixture> = [
  {
    id: "jms.java-agent.default.send",
    source: "Java agent jms-1.1 send to an ActiveMQ queue, default conventions",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "jms",
      "messaging.destination.name": "orders",
      "messaging.operation": "publish",
      "messaging.message.id": "ID:app-1-38493-1727690000000-1:1:1:1:1",
      "messaging.message.conversation_id": "corr-77",
    },
    expected: queue({
      system: "jms",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    id: "jms.java-agent.default.process.dead-letter",
    source:
      "Java agent jms-1.1 listener on ActiveMQ's shared dead-letter queue",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "jms",
      "messaging.destination.name": "ActiveMQ.DLQ",
      "messaging.operation": "process",
      "messaging.message.id": "ID:app-1-38493-1727690000000-1:1:1:1:9",
    },
    expected: queue({
      system: "jms",
      destination: "ActiveMQ.DLQ",
      direction: "consume",
      isDeadLetter: true,
    }),
  },
  {
    id: "jms.java-agent.opt-in.receive.temporary",
    source: "Java agent jms-1.1 receive on a TemporaryQueue, opt-in",
    kind: CLIENT,
    attributes: {
      "messaging.system": "jms",
      "messaging.destination.name": "(temporary)",
      "messaging.destination.temporary": true,
      "messaging.operation.name": "receive",
      "messaging.operation.type": "receive",
    },
    expected: null,
  },
  {
    id: "activemq.manual.send",
    source:
      "A hand-instrumented ActiveMQ client using the semconv system value (destination printed with its queue:// prefix)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "activemq",
      "messaging.destination.name": "queue://orders",
      "messaging.operation.type": "send",
      "messaging.operation.name": "send",
      "server.address": "activemq.internal",
      "server.port": 61616,
    },
    expected: queue({
      system: "activemq",
      destination: "orders",
      direction: "publish",
      brokerAddress: "activemq.internal:61616",
    }),
  },
];

const SQS_SPANS: ReadonlyArray<SpanFixture> = [
  {
    id: "sqs.java-agent.default.send",
    source: "Java agent aws-sdk-2.2 SQS SendMessage (agent 2.4+, aws_sqs)",
    kind: PRODUCER,
    attributes: {
      "rpc.system": "aws-api",
      "rpc.service": "Sqs",
      "rpc.method": "SendMessage",
      "http.request.method": "POST",
      "http.response.status_code": 200,
      "server.address": SQS_HOST,
      "server.port": 443,
      "url.full": `https://${SQS_HOST}`,
      "aws.agent": "java-aws-sdk",
      "aws.request_id": "7a62c49f-347e-4fc4-9331-6e8e7a96aa73",
      "aws.sqs.queue.url": SQS_QUEUE_URL,
      "messaging.destination.name": "payment-events",
      "messaging.message.id": "5fea7756-0ea4-451a-a703-a558b933e274",
      "messaging.system": "aws_sqs",
      "messaging.operation": "publish",
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
      direction: "publish",
      brokerAddress: `${SQS_HOST}:443`,
    }),
  },
  {
    id: "sqs.java-agent.2.3.receive",
    source: "Java agent aws-sdk-2.2 SQS ReceiveMessage up to 2.3.0 (AmazonSQS)",
    kind: CONSUMER,
    attributes: {
      "rpc.system": "aws-api",
      "rpc.service": "Sqs",
      "rpc.method": "ReceiveMessage",
      "http.request.method": "POST",
      "http.response.status_code": 200,
      "server.address": SQS_HOST,
      "server.port": 443,
      "aws.sqs.queue.url": SQS_QUEUE_URL,
      "messaging.destination.name": "payment-events",
      "messaging.system": "AmazonSQS",
      "messaging.operation": "receive",
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
      direction: "consume",
      brokerAddress: `${SQS_HOST}:443`,
    }),
  },
  {
    id: "sqs.java-agent.opt-in.lambda-event",
    source:
      "Java agent aws-lambda SQS event, opt-in (queue name derived from the event source ARN)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "aws_sqs",
      "messaging.destination.name": "payment-events",
      "messaging.operation.name": "process",
      "messaging.operation.type": "process",
      "messaging.message.id": "059f36b4-87a3-44ab-83d2-661975830a7d",
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
      direction: "consume",
    }),
  },
  {
    id: "sqs.aws-sdk-js.0.58.receive",
    source:
      "@opentelemetry/instrumentation-aws-sdk 0.58+ SQS ReceiveMessage (aws_sqs, queue URL in url.full)",
    kind: CONSUMER,
    attributes: {
      "rpc.system": "aws-api",
      "rpc.method": "ReceiveMessage",
      "rpc.service": "SQS",
      "cloud.region": "eu-west-1",
      "messaging.system": "aws_sqs",
      "messaging.destination.name": "payment-events",
      "url.full": SQS_QUEUE_URL,
      "messaging.operation.type": "receive",
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
      direction: "consume",
    }),
  },
  {
    id: "sqs.boto3sqs.process",
    source:
      "opentelemetry-instrumentation-boto3sqs processing span (aws.sqs, queue URL in messaging.url)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "aws.sqs",
      "messaging.destination": "payment-events",
      "messaging.destination_kind": "queue",
      "messaging.url": SQS_QUEUE_URL,
      "messaging.operation": "process",
      "messaging.message.id": "5fea7756-0ea4-451a-a703-a558b933e274",
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
      direction: "consume",
      brokerAddress: SQS_HOST,
    }),
  },
  {
    id: "sqs.botocore.send-message",
    source:
      "opentelemetry-instrumentation-botocore SQS SendMessage (a CLIENT span: the operation is in rpc.method)",
    kind: CLIENT,
    attributes: {
      "rpc.system": "aws-api",
      "rpc.service": "SQS",
      "rpc.method": "SendMessage",
      "aws.region": "eu-west-1",
      "cloud.region": "eu-west-1",
      retry_attempts: 0,
      "aws.request_id": "b8c2d4e6-1a3b-4c5d-8e7f-9a0b1c2d3e4f",
      "http.status_code": 200,
      "aws.queue_url": SQS_QUEUE_URL,
      "messaging.system": "aws.sqs",
      "messaging.url": SQS_QUEUE_URL,
      "messaging.destination": "payment-events",
      "messaging.message.id": "5fea7756-0ea4-451a-a703-a558b933e274",
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
      direction: "publish",
      brokerAddress: SQS_HOST,
    }),
  },
  {
    id: "sqs.go-otelaws.send-message",
    source:
      "Go otelaws v0.62+ SQS SendMessage (the full queue URL in server.address, no destination key)",
    kind: CLIENT,
    attributes: {
      "rpc.system.name": "aws-api",
      "rpc.method": "SQS/SendMessage",
      "aws.region": "eu-west-1",
      "messaging.system": "aws_sqs",
      "server.address": SQS_QUEUE_URL,
      "aws.request_id": "0c7d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f",
      "http.response.status_code": 200,
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
      direction: "publish",
      brokerAddress: SQS_HOST,
    }),
  },
  {
    id: "sqs.go-otelaws.get-queue-attributes",
    source:
      "Go otelaws v0.62+ SQS GetQueueAttributes (same attributes, no direction)",
    kind: CLIENT,
    attributes: {
      "rpc.system.name": "aws-api",
      "rpc.method": "SQS/GetQueueAttributes",
      "aws.region": "eu-west-1",
      "messaging.system": "aws_sqs",
      "server.address": SQS_QUEUE_URL,
      "http.response.status_code": 200,
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
      brokerAddress: SQS_HOST,
    }),
  },
  {
    id: "sqs.go-otelaws-0.61.receive",
    source:
      "Go otelaws up to v0.61 SQS ReceiveMessage (AmazonSQS, queue URL in net.peer.name)",
    kind: CLIENT,
    attributes: {
      "rpc.system": "aws-api",
      "rpc.service": "SQS",
      "rpc.method": "ReceiveMessage",
      "aws.region": "eu-west-1",
      "messaging.system": "AmazonSQS",
      "net.peer.name": SQS_QUEUE_URL,
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
      direction: "consume",
      brokerAddress: SQS_HOST,
    }),
  },
  {
    id: "sqs.dotnet-aws.semconv-1.40.send",
    source:
      "OpenTelemetry.Instrumentation.AWS (.NET), semconv 1.40 mode, SendMessage",
    kind: CLIENT,
    attributes: {
      "rpc.system.name": "aws-api",
      "messaging.system": "aws_sqs",
      "aws.sqs.queue.url": SQS_QUEUE_URL,
      "server.address": SQS_HOST,
      "messaging.destination.name": "payment-events",
      "messaging.operation.name": "SendMessage",
      "messaging.operation.type": "send",
      "cloud.region": "eu-west-1",
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
      direction: "publish",
      brokerAddress: SQS_HOST,
    }),
  },
  {
    id: "sqs.dotnet-aws.legacy.receive",
    source:
      "OpenTelemetry.Instrumentation.AWS (.NET), legacy mode (no messaging.system, aws.queue_url)",
    kind: CLIENT,
    attributes: {
      "rpc.system": "aws-api",
      "aws.queue_url": SQS_QUEUE_URL,
      "cloud.region": "eu-west-1",
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
    }),
  },
];

const SNS_SPANS: ReadonlyArray<SpanFixture> = [
  {
    id: "sns.java-agent.publish",
    source:
      "Java agent aws-sdk-2.2 SNS Publish (an RPC span: no messaging.system, the topic ARN as destination)",
    kind: CLIENT,
    attributes: {
      "rpc.system": "aws-api",
      "rpc.service": "Sns",
      "rpc.method": "Publish",
      "http.request.method": "POST",
      "http.response.status_code": 200,
      "server.address": "sns.eu-west-1.amazonaws.com",
      "server.port": 443,
      "url.full": "https://sns.eu-west-1.amazonaws.com",
      "aws.agent": "java-aws-sdk",
      "aws.request_id": "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b",
      "messaging.destination.name": SNS_TOPIC_ARN,
      "aws.sns.topic.arn": SNS_TOPIC_ARN,
    },
    expected: queue({
      system: "aws.sns",
      destination: "payment-notifications",
      direction: "publish",
      brokerAddress: "sns.eu-west-1.amazonaws.com:443",
    }),
  },
  {
    id: "sns.java-agent.publish.platform-endpoint",
    source:
      "Java agent aws-sdk-2.2 SNS Publish to a mobile push endpoint (TargetArn: one per device, not a topic)",
    kind: CLIENT,
    attributes: {
      "rpc.system": "aws-api",
      "rpc.service": "Sns",
      "rpc.method": "Publish",
      "server.address": "sns.eu-west-1.amazonaws.com",
      "server.port": 443,
      "messaging.destination.name": `arn:aws:sns:eu-west-1:123456789012:${SNS_ENDPOINT_RESOURCE}`,
    },
    expected: null,
  },
  {
    id: "sns.go-otelaws.publish.topic",
    source:
      "Go otelaws v0.62+ SNS Publish (aws_sns, short topic name, operation name publish_input)",
    kind: CLIENT,
    attributes: {
      "rpc.system.name": "aws-api",
      "rpc.method": "SNS/Publish",
      "aws.region": "eu-west-1",
      "messaging.system": "aws_sns",
      "messaging.destination.name": "payment-notifications",
      "messaging.operation.type": "send",
      "messaging.operation.name": "publish_input",
      "aws.request_id": "d4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f7a",
      "http.response.status_code": 200,
    },
    expected: queue({
      system: "aws.sns",
      destination: "payment-notifications",
      direction: "publish",
    }),
  },
  {
    /*
     * Go otelaws's extractDestinationName keeps the text after the last ':'
     * of TopicArn OR TargetArn — for a mobile push endpoint that is
     * 'endpoint/<platform>/<app>/<device id>'. SNS topic names cannot contain
     * '/', and a device endpoint is never a topic (the same endpoint as a
     * full ARN resolves to no queue).
     */
    id: "sns.go-otelaws.publish.platform-endpoint",
    source:
      "Go otelaws v0.62+ SNS Publish to a mobile push endpoint (TargetArn cut after its last ':')",
    kind: CLIENT,
    attributes: {
      "rpc.system.name": "aws-api",
      "rpc.method": "SNS/Publish",
      "aws.region": "eu-west-1",
      "messaging.system": "aws_sns",
      "messaging.destination.name": SNS_ENDPOINT_RESOURCE,
      "messaging.operation.type": "send",
      "messaging.operation.name": "publish_input",
    },
    expected: null,
  },
  {
    id: "sns.go-otelaws.publish-batch",
    source: "Go otelaws v0.62+ SNS PublishBatch",
    kind: CLIENT,
    attributes: {
      "rpc.system.name": "aws-api",
      "rpc.method": "SNS/PublishBatch",
      "aws.region": "eu-west-1",
      "messaging.system": "aws_sns",
      "messaging.destination.name": "payment-notifications",
      "messaging.operation.type": "send",
      "messaging.operation.name": "publish_batch_input",
      "messaging.batch.message_count": 10,
    },
    expected: queue({
      system: "aws.sns",
      destination: "payment-notifications",
      direction: "publish",
    }),
  },
  {
    id: "sns.aws-sdk-js.publish",
    source:
      "@opentelemetry/instrumentation-aws-sdk SNS Publish (short name in messaging.destination, ARN in messaging.destination.name)",
    kind: PRODUCER,
    attributes: {
      "rpc.system": "aws-api",
      "rpc.method": "Publish",
      "rpc.service": "SNS",
      "cloud.region": "eu-west-1",
      "messaging.system": "aws.sns",
      "messaging.destination_kind": "topic",
      "messaging.destination": "payment-notifications",
      "messaging.destination.name": SNS_TOPIC_ARN,
      "aws.sns.topic.arn": SNS_TOPIC_ARN,
    },
    expected: queue({
      system: "aws.sns",
      destination: "payment-notifications",
      direction: "publish",
    }),
  },
  {
    id: "sns.aws-sdk-js.publish.platform-endpoint",
    source:
      "@opentelemetry/instrumentation-aws-sdk SNS Publish to a mobile push endpoint (TargetArn)",
    kind: PRODUCER,
    attributes: {
      "rpc.system": "aws-api",
      "rpc.method": "Publish",
      "rpc.service": "SNS",
      "messaging.system": "aws.sns",
      "messaging.destination_kind": "topic",
      "messaging.destination": SNS_ENDPOINT_RESOURCE,
      "messaging.destination.name": `arn:aws:sns:eu-west-1:123456789012:${SNS_ENDPOINT_RESOURCE}`,
    },
    expected: null,
  },
  {
    id: "sns.botocore.publish-batch",
    source:
      "opentelemetry-instrumentation-botocore SNS PublishBatch (full ARN in both destination keys)",
    kind: PRODUCER,
    attributes: {
      "rpc.system": "aws-api",
      "rpc.service": "SNS",
      "rpc.method": "PublishBatch",
      "aws.region": "eu-west-1",
      "messaging.system": "aws.sns",
      "messaging.destination_kind": "topic",
      "messaging.destination": SNS_TOPIC_ARN,
      "messaging.destination.name": SNS_TOPIC_ARN,
      "aws.sns.topic.arn": SNS_TOPIC_ARN,
    },
    expected: queue({
      system: "aws.sns",
      destination: "payment-notifications",
      direction: "publish",
    }),
  },
  {
    id: "sns.botocore.publish.sms",
    source:
      "opentelemetry-instrumentation-botocore SNS Publish of an SMS (phone number censored)",
    kind: PRODUCER,
    attributes: {
      "rpc.system": "aws-api",
      "rpc.service": "SNS",
      "rpc.method": "Publish",
      "messaging.system": "aws.sns",
      "messaging.destination_kind": "topic",
      "messaging.destination": "phone_number:**",
      "messaging.destination.name": "phone_number:**",
    },
    expected: null,
  },
];

const PUBSUB_SPANS: ReadonlyArray<SpanFixture> = [
  {
    id: "pubsub.node.create",
    source: "@google-cloud/pubsub (Node) '{topicId} create' span",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "orders",
      "gcp.project_id": "shop-prod",
      "code.function": "Topic.publishMessage",
      "messaging.message.envelope.size": 184,
      "messaging.operation": "create",
    },
    expected: queue({
      system: "gcp_pubsub",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    id: "pubsub.node.publish-rpc",
    source:
      "@google-cloud/pubsub (Node) publish RPC span ('{projects/p/topics/t} send': the short id in the attribute)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "orders",
      "gcp.project_id": "shop-prod",
      "code.function": "Publisher.publish",
      "messaging.batch.message_count": 12,
    },
    expected: queue({
      system: "gcp_pubsub",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    id: "pubsub.node.subscribe",
    source:
      "@google-cloud/pubsub (Node) '{subId} subscribe' span: the destination is the SUBSCRIPTION",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "orders-billing",
      "gcp.project_id": "shop-prod",
      "code.function": "Subscription.emit",
      "messaging.message.envelope.size": 184,
      "messaging.gcp_pubsub.message.ack_id":
        "RkhRNxkIaFEOT14jPzUgKEUXAggUBXx9dEFBX1pnHwxQ",
      "messaging.operation": "receive",
    },
    expected: queue({
      system: "gcp_pubsub",
      destination: "orders-billing",
      direction: "consume",
      consumerGroup: "orders-billing",
    }),
  },
  {
    id: "pubsub.node.ack-rpc",
    source:
      "@google-cloud/pubsub (Node) '{subId} ack' RPC span (no operation attribute: nothing but the span name says ack)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "orders-billing",
      "gcp.project_id": "shop-prod",
      "code.function": "AckQueue.flush",
      "messaging.batch.message_count": 3,
    },
    expected: queue({
      system: "gcp_pubsub",
      destination: "orders-billing",
    }),
  },
  {
    /*
     * The Java client writes the RPC's operation NAME ("ack", "modack",
     * "nack") into the legacy messaging.operation key; messaging-semconv.md
     * lists ack / nack / modack as settlement.
     */
    id: "pubsub.java.ack-rpc",
    source:
      "google-cloud-pubsub (Java) '{sub} ack' RPC span (messaging.operation 'ack')",
    kind: CLIENT,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "orders-billing",
      "gcp.project_id": "shop-prod",
      "code.function": "sendAckOperations",
      "messaging.operation": "ack",
      "messaging.batch.message_count": 3,
    },
    expected: queue({
      system: "gcp_pubsub",
      destination: "orders-billing",
      direction: "settle",
      consumerGroup: "orders-billing",
    }),
  },
  {
    id: "pubsub.java.publish-rpc",
    source: "google-cloud-pubsub (Java) '{topic} publish' RPC span",
    kind: CLIENT,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "orders",
      "gcp.project_id": "shop-prod",
      "code.function": "publishOutstandingBatch",
      "messaging.operation": "publish",
      "messaging.batch.message_count": 12,
    },
    expected: queue({
      system: "gcp_pubsub",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    id: "pubsub.go-v2.process",
    source:
      "cloud.google.com/go/pubsub/v2 '{sub} process' span (gcp.resource.name holds the full resource name)",
    kind: CONSUMER,
    attributes: {
      "gcp.project_id": "shop-prod",
      "gcp.resource.name": "projects/shop-prod/subscriptions/orders-billing",
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "orders-billing",
      "messaging.message.id": "12345678901234567",
      "messaging.message.body.size": 184,
      "messaging.gcp_pubsub.message.ordering_key": "",
      "messaging.gcp_pubsub.message.delivery_attempt": 1,
      "messaging.operation.type": "process",
    },
    expected: queue({
      system: "gcp_pubsub",
      destination: "orders-billing",
      direction: "consume",
      consumerGroup: "orders-billing",
    }),
  },
  {
    id: "pubsub.python.modack",
    source: "google-cloud-pubsub (Python) '{sub} modack' span",
    kind: CLIENT,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.batch.message_count": 3,
      "messaging.gcp_pubsub.message.ack_deadline": 60,
      "messaging.destination.name": "orders-billing",
      "gcp.project_id": "shop-prod",
      "messaging.operation.name": "modack",
      "code.function": "modify_ack_deadline",
    },
    expected: queue({
      system: "gcp_pubsub",
      destination: "orders-billing",
      direction: "settle",
      consumerGroup: "orders-billing",
    }),
  },
  {
    id: "pubsub.python.publish",
    source: "google-cloud-pubsub (Python) '{topic} publish' batch commit span",
    kind: CLIENT,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "orders",
      "gcp.project_id": "shop-prod",
      "messaging.batch.message_count": 5,
      "messaging.operation": "publish",
      "code.function": "_commit",
    },
    expected: queue({
      system: "gcp_pubsub",
      destination: "orders",
      direction: "publish",
    }),
  },
];

const SERVICE_BUS_SPANS: ReadonlyArray<SpanFixture> = [
  {
    id: "servicebus.dotnet.activity-source.send",
    source:
      "Azure.Messaging.ServiceBus (.NET) ServiceBusSender.Send, ActivitySource switch on",
    kind: CLIENT,
    attributes: {
      "az.namespace": "Microsoft.ServiceBus",
      "az.schema_url": AZURE_SCHEMA_URL,
      "messaging.system": "servicebus",
      "messaging.operation": "publish",
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "invoices",
      "messaging.batch.message_count": 2,
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      direction: "publish",
      brokerAddress: SERVICE_BUS_HOST,
    }),
  },
  {
    id: "servicebus.dotnet.activity-source.message",
    source:
      "Azure.Messaging.ServiceBus (.NET) per-message 'Message' PRODUCER span, ActivitySource switch on",
    kind: PRODUCER,
    attributes: {
      "az.namespace": "Microsoft.ServiceBus",
      "az.schema_url": AZURE_SCHEMA_URL,
      "messaging.system": "servicebus",
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "invoices",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      direction: "publish",
      brokerAddress: SERVICE_BUS_HOST,
    }),
  },
  {
    id: "servicebus.dotnet.activity-source.process.subscription",
    source:
      "Azure.Messaging.ServiceBus (.NET) ServiceBusProcessor.ProcessMessage on a topic subscription ('{topic}/Subscriptions/{sub}')",
    kind: CONSUMER,
    attributes: {
      "az.namespace": "Microsoft.ServiceBus",
      "az.schema_url": AZURE_SCHEMA_URL,
      "messaging.system": "servicebus",
      "messaging.operation": "process",
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "invoice-events/Subscriptions/ledger",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoice-events",
      brokerScope: "billing-prod",
      direction: "consume",
      consumerGroup: "ledger",
      brokerAddress: SERVICE_BUS_HOST,
    }),
  },
  {
    id: "servicebus.dotnet.activity-source.complete",
    source: "Azure.Messaging.ServiceBus (.NET) ServiceBusReceiver.Complete",
    kind: CLIENT,
    attributes: {
      "az.namespace": "Microsoft.ServiceBus",
      "az.schema_url": AZURE_SCHEMA_URL,
      "messaging.system": "servicebus",
      "messaging.operation": "settle",
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "invoices",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      direction: "settle",
      brokerAddress: SERVICE_BUS_HOST,
    }),
  },
  {
    id: "servicebus.dotnet.activity-source.renew-lock",
    source:
      "Azure.Messaging.ServiceBus (.NET) ServiceBusReceiver.RenewMessageLock (no operation)",
    kind: CLIENT,
    attributes: {
      "az.namespace": "Microsoft.ServiceBus",
      "az.schema_url": AZURE_SCHEMA_URL,
      "messaging.system": "servicebus",
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "invoices",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      brokerAddress: SERVICE_BUS_HOST,
    }),
  },
  {
    id: "servicebus.dotnet.activity-source.send.mixed-case-namespace",
    source:
      "Azure.Messaging.ServiceBus (.NET) send, connection string spelling the namespace and entity in mixed case",
    kind: CLIENT,
    attributes: {
      "az.namespace": "Microsoft.ServiceBus",
      "az.schema_url": AZURE_SCHEMA_URL,
      "messaging.system": "servicebus",
      "messaging.operation": "publish",
      "server.address": "Billing-Prod.servicebus.windows.net",
      "messaging.destination.name": "Invoices",
    },
    expected: queue({
      system: "servicebus",
      destination: "Invoices",
      brokerScope: "billing-prod",
      direction: "publish",
      brokerAddress: "Billing-Prod.servicebus.windows.net",
    }),
  },
  {
    id: "servicebus.dotnet.diagnostic-source.send",
    source:
      "Azure.Messaging.ServiceBus (.NET) send WITHOUT the ActivitySource switch (legacy DiagnosticSource: component, peer.address, message_bus.destination; kind only as a tag)",
    kind: INTERNAL,
    attributes: {
      "az.namespace": "Microsoft.ServiceBus",
      kind: "client",
      component: "servicebus",
      "peer.address": SERVICE_BUS_HOST,
      "message_bus.destination": "invoices",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      brokerAddress: SERVICE_BUS_HOST,
    }),
  },
  {
    id: "servicebus.dotnet.diagnostic-source.receive.dead-letter",
    source:
      "Azure.Messaging.ServiceBus (.NET) legacy DiagnosticSource receive from the dead-letter sub-queue",
    kind: INTERNAL,
    attributes: {
      "az.namespace": "Microsoft.ServiceBus",
      kind: "client",
      component: "servicebus",
      "peer.address": SERVICE_BUS_HOST,
      "message_bus.destination": "invoices/$DeadLetterQueue",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      brokerAddress: SERVICE_BUS_HOST,
      isDeadLetter: true,
    }),
  },
  {
    id: "servicebus.dotnet.diagnostic-source.process.subscription-dead-letter",
    source:
      "Azure.Messaging.ServiceBus (.NET) legacy DiagnosticSource processor on a subscription's dead-letter queue",
    kind: INTERNAL,
    attributes: {
      "az.namespace": "Microsoft.ServiceBus",
      kind: "consumer",
      component: "servicebus",
      "peer.address": SERVICE_BUS_HOST,
      "message_bus.destination":
        "invoice-events/Subscriptions/ledger/$DeadLetterQueue",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoice-events",
      brokerScope: "billing-prod",
      consumerGroup: "ledger",
      brokerAddress: SERVICE_BUS_HOST,
      isDeadLetter: true,
    }),
  },
  {
    id: "servicebus.java.process.subscription",
    source:
      "azure-messaging-servicebus (Java) ServiceBus.process ('{topic}/subscriptions/{sub}', both namespace keys)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.destination.name": "invoice-events/subscriptions/ledger",
      "server.address": SERVICE_BUS_HOST,
      "messaging.operation": "process",
      "az.namespace": "Microsoft.ServiceBus",
      "azure.resource_provider.namespace": "Microsoft.ServiceBus",
      "messaging.servicebus.message.enqueued_time": 1727690000,
    },
    expected: queue({
      system: "servicebus",
      destination: "invoice-events",
      brokerScope: "billing-prod",
      direction: "consume",
      consumerGroup: "ledger",
      brokerAddress: SERVICE_BUS_HOST,
    }),
  },
  {
    id: "servicebus.java.receive.transfer-dead-letter",
    source:
      "azure-messaging-servicebus (Java) ServiceBus.receive from the transfer dead-letter queue ('/$Transfer/$deadletterqueue')",
    kind: CLIENT,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.destination.name": "invoices/$Transfer/$deadletterqueue",
      "server.address": SERVICE_BUS_HOST,
      "messaging.operation": "receive",
      "messaging.batch.message_count": 4,
      "az.namespace": "Microsoft.ServiceBus",
      "azure.resource_provider.namespace": "Microsoft.ServiceBus",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      direction: "consume",
      brokerAddress: SERVICE_BUS_HOST,
      isDeadLetter: true,
    }),
  },
  {
    id: "servicebus.js.receive.subscription",
    source:
      "@azure/service-bus (JS) receive (messaging.source.name, net.peer.name)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.source.name": "invoice-events/Subscriptions/ledger",
      "messaging.operation": "receive",
      "net.peer.name": SERVICE_BUS_HOST,
      "az.namespace": "Microsoft.ServiceBus",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoice-events",
      brokerScope: "billing-prod",
      direction: "consume",
      consumerGroup: "ledger",
      brokerAddress: SERVICE_BUS_HOST,
    }),
  },
  {
    id: "servicebus.js.complete",
    source: "@azure/service-bus (JS) ServicebusReceiver.complete",
    kind: CLIENT,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.destination.name": "invoices",
      "messaging.operation": "settle",
      "net.peer.name": SERVICE_BUS_HOST,
      "az.namespace": "Microsoft.ServiceBus",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      direction: "settle",
      brokerAddress: SERVICE_BUS_HOST,
    }),
  },
  {
    id: "servicebus.python.send",
    source:
      "azure-servicebus (Python) ServiceBus.send (legacy message_bus.destination + peer.address only)",
    kind: CLIENT,
    attributes: {
      "az.namespace": "Microsoft.ServiceBus",
      "messaging.system": "servicebus",
      "messaging.operation": "publish",
      "messaging.batch.message_count": 3,
      "message_bus.destination": "invoices",
      "peer.address": SERVICE_BUS_HOST,
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      direction: "publish",
      brokerAddress: SERVICE_BUS_HOST,
    }),
  },
  {
    id: "servicebus.python.complete",
    source:
      "azure-servicebus (Python) settle span (messaging.destination.name + net.peer.name)",
    kind: CLIENT,
    attributes: {
      "az.namespace": "Microsoft.ServiceBus",
      "messaging.system": "servicebus",
      "messaging.operation": "settle",
      "net.peer.name": SERVICE_BUS_HOST,
      "messaging.destination.name": "invoices",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      direction: "settle",
      brokerAddress: SERVICE_BUS_HOST,
    }),
  },
];

const EVENT_HUBS_SPANS: ReadonlyArray<SpanFixture> = [
  {
    id: "eventhubs.dotnet.activity-source.send",
    source:
      "Azure.Messaging.EventHubs (.NET) EventHubProducerClient.Send, ActivitySource switch on",
    kind: CLIENT,
    attributes: {
      "az.namespace": "Microsoft.EventHub",
      "az.schema_url": AZURE_SCHEMA_URL,
      "messaging.system": "eventhubs",
      "messaging.operation": "publish",
      "server.address": EVENT_HUBS_HOST,
      "messaging.destination.name": "device-telemetry",
      "messaging.batch.message_count": 50,
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      direction: "publish",
      brokerAddress: EVENT_HUBS_HOST,
    }),
  },
  {
    id: "eventhubs.dotnet.activity-source.process",
    source: "Azure.Messaging.EventHubs (.NET) EventProcessor.Process",
    kind: CONSUMER,
    attributes: {
      "az.namespace": "Microsoft.EventHub",
      "az.schema_url": AZURE_SCHEMA_URL,
      "messaging.system": "eventhubs",
      "messaging.operation": "process",
      "server.address": EVENT_HUBS_HOST,
      "messaging.destination.name": "device-telemetry",
      "messaging.batch.message_count": 10,
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      direction: "consume",
      brokerAddress: EVENT_HUBS_HOST,
    }),
  },
  {
    id: "eventhubs.dotnet.activity-source.checkpoint",
    source:
      "Azure.Messaging.EventHubs (.NET) EventProcessor.Checkpoint (INTERNAL, no operation)",
    kind: INTERNAL,
    attributes: {
      "az.namespace": "Microsoft.EventHub",
      "az.schema_url": AZURE_SCHEMA_URL,
      "messaging.system": "eventhubs",
      "server.address": EVENT_HUBS_HOST,
      "messaging.destination.name": "device-telemetry",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      brokerAddress: EVENT_HUBS_HOST,
    }),
  },
  {
    id: "eventhubs.dotnet.diagnostic-source.send",
    source:
      "Azure.Messaging.EventHubs (.NET) send WITHOUT the ActivitySource switch (legacy DiagnosticSource keys)",
    kind: INTERNAL,
    attributes: {
      "az.namespace": "Microsoft.EventHub",
      kind: "client",
      component: "eventhubs",
      "peer.address": EVENT_HUBS_HOST,
      "message_bus.destination": "device-telemetry",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      brokerAddress: EVENT_HUBS_HOST,
    }),
  },
  {
    id: "eventhubs.java.process",
    source:
      "azure-messaging-eventhubs (Java) 'process device-telemetry' (operation name + type, consumer group, partition)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "eventhubs",
      "messaging.destination.name": "device-telemetry",
      "server.address": EVENT_HUBS_HOST,
      "messaging.operation.name": "process",
      "messaging.consumer.group.name": "$Default",
      "messaging.destination.partition.id": "3",
      "messaging.operation.type": "process",
      "messaging.eventhubs.message.enqueued_time": 1727690000,
      "az.namespace": "Microsoft.EventHub",
      "azure.resource_provider.namespace": "Microsoft.EventHub",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      direction: "consume",
      consumerGroup: "$Default",
      brokerAddress: EVENT_HUBS_HOST,
    }),
  },
  {
    id: "eventhubs.java.checkpoint",
    source:
      "azure-messaging-eventhubs (Java) 'checkpoint device-telemetry' (settle)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "eventhubs",
      "messaging.destination.name": "device-telemetry",
      "server.address": EVENT_HUBS_HOST,
      "messaging.operation.name": "checkpoint",
      "messaging.consumer.group.name": "$Default",
      "messaging.destination.partition.id": "3",
      "messaging.operation.type": "settle",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      direction: "settle",
      consumerGroup: "$Default",
      brokerAddress: EVENT_HUBS_HOST,
    }),
  },
  {
    id: "eventhubs.python.receive",
    source:
      "azure-eventhub (Python) EventHubs.receive (new keys: messaging.destination.name + net.peer.name)",
    kind: CLIENT,
    attributes: {
      "az.namespace": "Microsoft.EventHub",
      "messaging.system": "eventhubs",
      "messaging.operation": "receive",
      "messaging.batch.message_count": 10,
      "net.peer.name": EVENT_HUBS_HOST,
      "messaging.destination.name": "device-telemetry",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      direction: "consume",
      brokerAddress: EVENT_HUBS_HOST,
    }),
  },
  {
    id: "eventhubs.python.process",
    source:
      "azure-eventhub (Python) EventHubs.process (legacy message_bus.destination + peer.address)",
    kind: CONSUMER,
    attributes: {
      "az.namespace": "Microsoft.EventHub",
      "messaging.system": "eventhubs",
      "messaging.operation": "process",
      "message_bus.destination": "device-telemetry",
      "peer.address": EVENT_HUBS_HOST,
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      direction: "consume",
      brokerAddress: EVENT_HUBS_HOST,
    }),
  },
  {
    id: "eventhubs.js.receive",
    source:
      "@azure/event-hubs (JS) receive (messaging.source.name, net.peer.name)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "eventhubs",
      "messaging.source.name": "device-telemetry",
      "net.peer.name": EVENT_HUBS_HOST,
      "messaging.operation": "receive",
      "az.namespace": "Microsoft.EventHub",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      direction: "consume",
      brokerAddress: EVENT_HUBS_HOST,
    }),
  },
];

const PULSAR_ROCKETMQ_NATS_SPANS: ReadonlyArray<SpanFixture> = [
  {
    id: "pulsar.java-agent.default.send.short-name",
    source:
      "Java agent pulsar-2.8 send, default mode (the topic as the producer was created with: a short name)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "pulsar",
      "messaging.destination.name": "payments",
      "messaging.operation": "publish",
      "messaging.message.id": "12:3:1",
      "messaging.message.body.size": 64,
      "server.address": "pulsar-broker-0.pulsar-broker",
      "server.port": 6650,
    },
    expected: queue({
      system: "pulsar",
      destination: "persistent://public/default/payments",
      direction: "publish",
      brokerAddress: "pulsar-broker-0.pulsar-broker:6650",
    }),
  },
  {
    id: "pulsar.java-agent.default.process.partition",
    source:
      "Java agent pulsar-2.8 process, default mode (a partition of a partitioned topic)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "pulsar",
      "messaging.destination.name":
        "persistent://public/default/payments-partition-1",
      "messaging.operation": "process",
      "messaging.message.id": "12:4:1:0",
      "server.address": "pulsar-broker-0.pulsar-broker",
      "server.port": 6650,
    },
    expected: queue({
      system: "pulsar",
      destination: "persistent://public/default/payments",
      direction: "consume",
      brokerAddress: "pulsar-broker-0.pulsar-broker:6650",
    }),
  },
  {
    id: "pulsar.java-agent.opt-in.receive",
    source:
      "Java agent pulsar-2.8 receive, opt-in (fully-qualified topic, partition id and subscription apart)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "pulsar",
      "messaging.destination.name": "persistent://public/default/payments",
      "messaging.destination.partition.id": "0",
      "messaging.destination.subscription.name": "ledger",
      "messaging.operation.name": "receive",
      "messaging.operation.type": "receive",
      "server.address": "pulsar-broker-0.pulsar-broker",
      "server.port": 6650,
    },
    expected: queue({
      system: "pulsar",
      destination: "persistent://public/default/payments",
      direction: "consume",
      consumerGroup: "ledger",
      brokerAddress: "pulsar-broker-0.pulsar-broker:6650",
    }),
  },
  {
    id: "rocketmq.java-agent.5.process",
    source:
      "Java agent rocketmq-client-5.0 process, default mode (legacy consumer group key; keys as an array)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rocketmq",
      "messaging.destination.name": "order-topic",
      "messaging.operation": "process",
      "messaging.rocketmq.client_group": "order-consumer-group",
      "messaging.rocketmq.message.tag": "TagA",
      "messaging.rocketmq.message.keys": ["order-10042"],
      "messaging.message.id": "01AC1E0A2D4C5D6E7F8090A1B2C3D4E5",
      "messaging.message.body.size": 64,
    },
    expected: queue({
      system: "rocketmq",
      destination: "order-topic",
      direction: "consume",
      consumerGroup: "order-consumer-group",
    }),
  },
  {
    id: "rocketmq.java-agent.4.send",
    source: "Java agent rocketmq-client-4.8 send, default mode",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rocketmq",
      "messaging.destination.name": "order-topic",
      "messaging.operation": "publish",
      "messaging.rocketmq.message.tag": "TagA",
      "messaging.message.id": "0A0004155E8418B4AAC2A1F3B2E10000",
    },
    expected: queue({
      system: "rocketmq",
      destination: "order-topic",
      direction: "publish",
    }),
  },
  {
    id: "nats.java-agent.default.publish",
    source: "Java agent nats-2.17 publish, default mode (the subject)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "nats",
      "messaging.destination.name": "orders.created",
      "messaging.operation": "publish",
      "messaging.client_id": "7",
      "messaging.message.body.size": 48,
    },
    expected: queue({
      system: "nats",
      destination: "orders.created",
      direction: "publish",
    }),
  },
  {
    id: "nats.java-agent.opt-in.process",
    source: "Java agent nats-2.17 subscription dispatch, opt-in",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "nats",
      "messaging.destination.name": "orders.created",
      "messaging.operation.name": "process",
      "messaging.operation.type": "process",
      "messaging.client.id": "7",
      "messaging.message.body.size": 48,
    },
    expected: queue({
      system: "nats",
      destination: "orders.created",
      direction: "consume",
    }),
  },
  {
    id: "nats.java-agent.request-reply-inbox",
    source:
      "Java agent nats-2.17 reply on a request inbox (template = inbox prefix, temporary flag)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "nats",
      "messaging.destination.name": "_INBOX.k2Hw7dP1cPU9fC4tZ8fKDq.1",
      "messaging.destination.template": "_INBOX.",
      "messaging.destination.temporary": true,
      "messaging.operation": "process",
      "messaging.client_id": "7",
    },
    expected: null,
  },
  {
    id: "nats.java-agent.jetstream-ack",
    source:
      "Java agent nats-2.17 JetStream acknowledgement ($JS.ACK subject, templated as $JS.ACK)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "nats",
      "messaging.destination.name":
        "$JS.ACK.ORDERS.billing.1.12.12.1727690000000000000.0",
      "messaging.destination.template": "$JS.ACK",
      "messaging.operation": "publish",
      "messaging.client_id": "7",
    },
    expected: null,
  },
];

const OTHER_SPANS: ReadonlyArray<SpanFixture> = [
  {
    id: "oneuptime.worker-job.root-span",
    source:
      "OneUptime's own BullMQ worker job root span (TelemetryContext keys, no messaging keys)",
    kind: INTERNAL,
    attributes: {
      queueName: "Worker",
      jobName: "ProcessMonitorEvaluation",
      "oneuptime.unit_of_work": "worker-job",
      "oneuptime.component": "worker",
      projectId: "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    },
    expected: null,
  },
  {
    id: "celery.run-task",
    source:
      "opentelemetry-instrumentation-celery 'run/{task}' (no messaging.system: the broker is unknown)",
    kind: CONSUMER,
    attributes: {
      "celery.action": "run",
      "celery.state": "SUCCESS",
      "celery.task_name": "billing.tasks.charge",
      "celery.hostname": "celery@worker-1",
      "messaging.destination": "celery",
      "messaging.destination_kind": "queue",
      "messaging.message.id": "b6c7d8e9-f0a1-4b2c-8d3e-4f5a6b7c8d9e",
      "messaging.conversation_id": "b6c7d8e9-f0a1-4b2c-8d3e-4f5a6b7c8d9e",
    },
    expected: null,
  },
  {
    id: "http.server.pubsub-push-endpoint",
    source:
      "An HTTP SERVER span of a Pub/Sub push endpoint enriched with messaging keys (a messaging operation is never served)",
    kind: SERVER,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "orders-push",
      "http.request.method": "POST",
      "url.path": "/pubsub/push",
      "http.response.status_code": 204,
    },
    expected: null,
  },
];

const SPANS: ReadonlyArray<SpanFixture> = [
  ...KAFKA_SPANS,
  ...RABBITMQ_SPANS,
  ...JMS_SPANS,
  ...SQS_SPANS,
  ...SNS_SPANS,
  ...PUBSUB_SPANS,
  ...SERVICE_BUS_SPANS,
  ...EVENT_HUBS_SPANS,
  ...PULSAR_ROCKETMQ_NATS_SPANS,
  ...OTHER_SPANS,
];

// ---- datapoints (stored shape) --------------------------------------------

const KAFKA_DATAPOINTS: ReadonlyArray<DatapointFixture> = [
  {
    id: "kafka_metrics.lag_sum",
    source:
      "kafka_metrics consumers scraper, cluster alias and id enabled as resource attributes (live capture, Kafka 4.1)",
    metricName: "kafka.consumer_group.lag_sum",
    attributes: {
      group: "billing",
      topic: "payments",
      "resource.kafka.cluster.alias": "prod-kafka",
      "resource.kafka.cluster.id": "5L6g3nShT-eMCtK--X86sw",
    },
    expected: queue({ system: "kafka", destination: "payments" }),
  },
  {
    id: "kafka_metrics.lag_sum.no-resource",
    source:
      "kafka_metrics on 0.161.0 with only cluster_alias set: no resource attributes at all (live capture)",
    metricName: "kafka.consumer_group.lag_sum",
    attributes: {
      group: "billing",
      topic: "payments",
    },
    expected: queue({ system: "kafka", destination: "payments" }),
  },
  {
    id: "kafka_metrics.lag",
    source: "kafka_metrics per-partition lag (partition is an int)",
    metricName: "kafka.consumer_group.lag",
    attributes: {
      group: "billing",
      topic: "payments",
      partition: 0,
    },
    expected: queue({ system: "kafka", destination: "payments" }),
  },
  {
    id: "kafka_metrics.offset_sum",
    source: "kafka_metrics committed offsets summed over partitions",
    metricName: "kafka.consumer_group.offset_sum",
    attributes: {
      group: "billing",
      topic: "payments",
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "consume",
    }),
  },
  {
    id: "kafka_metrics.current_offset",
    source: "kafka_metrics topics scraper log-end offset",
    metricName: "kafka.partition.current_offset",
    attributes: {
      topic: "payments",
      partition: 2,
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "publish",
    }),
  },
  {
    id: "kafka_metrics.members",
    source: "kafka_metrics group members (names a group, not a topic)",
    metricName: "kafka.consumer_group.members",
    attributes: {
      group: "billing",
    },
    expected: null,
  },
  {
    id: "kafka_metrics.lag_sum.uuid-topic",
    source: "kafka_metrics lag on a per-tenant topic named by UUID",
    metricName: "kafka.consumer_group.lag_sum",
    attributes: {
      group: "tenant-worker",
      topic: UUID_TOPIC,
    },
    expected: queue({ system: "kafka", destination: UUID_TOPIC_TEMPLATED }),
  },
];

const RABBITMQ_DATAPOINTS: ReadonlyArray<DatapointFixture> = [
  {
    id: "rabbitmq.message.current.ready",
    source:
      "rabbitmq receiver queue depth, ready series (one resource per queue; live capture, RabbitMQ 4.3)",
    metricName: "rabbitmq.message.current",
    attributes: {
      state: "ready",
      ...RABBITMQ_QUEUE_RESOURCE("invoices"),
    },
    expected: queue({ system: "rabbitmq", destination: "invoices" }),
  },
  {
    id: "rabbitmq.message.current.unacknowledged",
    source: "rabbitmq receiver queue depth, unacknowledged series",
    metricName: "rabbitmq.message.current",
    attributes: {
      state: "unacknowledged",
      ...RABBITMQ_QUEUE_RESOURCE("invoices"),
    },
    expected: queue({ system: "rabbitmq", destination: "invoices" }),
  },
  {
    id: "rabbitmq.message.published",
    source: "rabbitmq receiver message_stats.publish",
    metricName: "rabbitmq.message.published",
    attributes: {
      ...RABBITMQ_QUEUE_RESOURCE("invoices"),
    },
    expected: queue({
      system: "rabbitmq",
      destination: "invoices",
      direction: "publish",
    }),
  },
  {
    id: "rabbitmq.message.delivered",
    source: "rabbitmq receiver message_stats.deliver",
    metricName: "rabbitmq.message.delivered",
    attributes: {
      ...RABBITMQ_QUEUE_RESOURCE("invoices"),
    },
    expected: queue({
      system: "rabbitmq",
      destination: "invoices",
      direction: "consume",
    }),
  },
  {
    id: "rabbitmq.message.acknowledged",
    source: "rabbitmq receiver message_stats.ack",
    metricName: "rabbitmq.message.acknowledged",
    attributes: {
      ...RABBITMQ_QUEUE_RESOURCE("invoices"),
    },
    expected: queue({
      system: "rabbitmq",
      destination: "invoices",
      direction: "consume",
    }),
  },
  {
    id: "rabbitmq.message.dropped",
    source: "rabbitmq receiver message_stats.drop_unroutable",
    metricName: "rabbitmq.message.dropped",
    attributes: {
      ...RABBITMQ_QUEUE_RESOURCE("invoices"),
    },
    expected: queue({ system: "rabbitmq", destination: "invoices" }),
  },
  {
    id: "rabbitmq.consumer.count",
    source: "rabbitmq receiver consumers (live capture: value 0)",
    metricName: "rabbitmq.consumer.count",
    attributes: {
      ...RABBITMQ_QUEUE_RESOURCE("invoices"),
    },
    expected: queue({ system: "rabbitmq", destination: "invoices" }),
  },
  {
    id: "rabbitmq.message.current.warning",
    source: "rabbitmq receiver queue depth of the 'warning' queue",
    metricName: "rabbitmq.message.current",
    attributes: {
      state: "ready",
      ...RABBITMQ_QUEUE_RESOURCE("warning"),
    },
    expected: queue({ system: "rabbitmq", destination: "warning" }),
  },
  {
    id: "rabbitmq.message.current.logs-audit",
    source: "rabbitmq receiver queue depth of the 'logs-audit' queue",
    metricName: "rabbitmq.message.current",
    attributes: {
      state: "ready",
      ...RABBITMQ_QUEUE_RESOURCE("logs-audit"),
    },
    expected: queue({ system: "rabbitmq", destination: "logs-audit" }),
  },
  {
    id: "rabbitmq.message.current.server-named",
    source: "rabbitmq receiver queue depth of a server-named queue",
    metricName: "rabbitmq.message.current",
    attributes: {
      state: "ready",
      ...RABBITMQ_QUEUE_RESOURCE("amq.gen-JzTY20BRgKO-HjmUJj0wLg"),
    },
    expected: null,
  },
  {
    id: "rabbitmq.message.current.invoice-issued",
    source: "rabbitmq receiver queue depth of the 'invoice-issued' queue",
    metricName: "rabbitmq.message.current",
    attributes: {
      state: "ready",
      ...RABBITMQ_QUEUE_RESOURCE("invoice-issued"),
    },
    expected: queue({ system: "rabbitmq", destination: "invoice-issued" }),
  },
  {
    /*
     * MassTransit's bus endpoint (DefaultEndpointNameFormatter
     * .GetTemporaryQueueName("bus")): `{machine}_{process}_bus_{NewId}`, a
     * new one for every process; the receiver lists it like any queue.
     */
    id: "rabbitmq.message.current.masstransit-bus-endpoint",
    source:
      "rabbitmq receiver queue depth of a MassTransit bus endpoint (one per process)",
    metricName: "rabbitmq.message.current",
    attributes: {
      state: "ready",
      ...RABBITMQ_QUEUE_RESOURCE(
        "billingapi5f7c9d8b6q2wzt_BillingApi_bus_3ibyyjnrydpynkcybdxt6fndr7",
      ),
    },
    expected: null,
  },
  {
    id: "rabbitmq.node.mem_alarm",
    source: "rabbitmq receiver node metric (node resource only, opt-in)",
    metricName: "rabbitmq.node.mem_alarm",
    attributes: {
      "resource.rabbitmq.node.name": "rabbit@rabbitmq-0",
    },
    expected: null,
  },
];

const ACTIVEMQ_DATAPOINTS: ReadonlyArray<DatapointFixture> = [
  {
    id: "jmx.activemq.message.queue.size",
    source:
      "OpenTelemetry JMX Scraper 1.53+ (instrumentation rules) queue size (live capture, ActiveMQ Classic 6.2)",
    metricName: "activemq.message.queue.size",
    attributes: {
      "activemq.broker.name": "localhost",
      "activemq.destination.type": "queue",
      "messaging.destination.name": "orders",
      ...JMX_SCRAPER_RESOURCE,
    },
    expected: queue({ system: "activemq", destination: "orders" }),
  },
  {
    id: "jmx.activemq.message.current.legacy",
    source:
      "OpenTelemetry JMX Scraper legacy rules (1.52 and older, or OTEL_JMX_TARGET_SOURCE=legacy) queue size",
    metricName: "activemq.message.current",
    attributes: {
      broker: "localhost",
      destination: "orders",
      ...JMX_SCRAPER_RESOURCE,
    },
    expected: queue({ system: "activemq", destination: "orders" }),
  },
  {
    id: "jmx.activemq.message.enqueued",
    source: "OpenTelemetry JMX Scraper 1.53+ enqueued",
    metricName: "activemq.message.enqueued",
    attributes: {
      "activemq.broker.name": "localhost",
      "activemq.destination.type": "queue",
      "messaging.destination.name": "orders",
      ...JMX_SCRAPER_RESOURCE,
    },
    expected: queue({
      system: "activemq",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    id: "jmx.activemq.message.enqueued.legacy",
    source: "OpenTelemetry JMX Scraper legacy enqueued",
    metricName: "activemq.message.enqueued",
    attributes: {
      broker: "localhost",
      destination: "orders",
      ...JMX_SCRAPER_RESOURCE,
    },
    expected: queue({
      system: "activemq",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    id: "jmx.activemq.message.dequeued",
    source: "OpenTelemetry JMX Scraper 1.53+ dequeued",
    metricName: "activemq.message.dequeued",
    attributes: {
      "activemq.broker.name": "localhost",
      "activemq.destination.type": "queue",
      "messaging.destination.name": "orders",
      ...JMX_SCRAPER_RESOURCE,
    },
    expected: queue({
      system: "activemq",
      destination: "orders",
      direction: "consume",
    }),
  },
  {
    id: "jmx.activemq.message.dequeued.legacy",
    source: "OpenTelemetry JMX Scraper legacy dequeued",
    metricName: "activemq.message.dequeued",
    attributes: {
      broker: "localhost",
      destination: "orders",
      ...JMX_SCRAPER_RESOURCE,
    },
    expected: queue({
      system: "activemq",
      destination: "orders",
      direction: "consume",
    }),
  },
  {
    id: "jmx.activemq.message.expired",
    source: "OpenTelemetry JMX Scraper 1.53+ expired",
    metricName: "activemq.message.expired",
    attributes: {
      "activemq.broker.name": "localhost",
      "activemq.destination.type": "queue",
      "messaging.destination.name": "orders",
      ...JMX_SCRAPER_RESOURCE,
    },
    expected: queue({ system: "activemq", destination: "orders" }),
  },
  {
    id: "jmx.activemq.consumer.count",
    source: "OpenTelemetry JMX Scraper 1.53+ consumer count",
    metricName: "activemq.consumer.count",
    attributes: {
      "activemq.broker.name": "localhost",
      "activemq.destination.type": "queue",
      "messaging.destination.name": "orders",
      ...JMX_SCRAPER_RESOURCE,
    },
    expected: queue({ system: "activemq", destination: "orders" }),
  },
  {
    id: "jmx.activemq.message.enqueue.average_duration",
    source: "OpenTelemetry JMX Scraper 1.53+ average time in queue (seconds)",
    metricName: "activemq.message.enqueue.average_duration",
    attributes: {
      "activemq.broker.name": "localhost",
      "activemq.destination.type": "queue",
      "messaging.destination.name": "orders",
      ...JMX_SCRAPER_RESOURCE,
    },
    expected: queue({ system: "activemq", destination: "orders" }),
  },
  {
    id: "jmx.activemq.message.wait_time.avg.legacy",
    source: "OpenTelemetry JMX Scraper legacy average wait time (ms)",
    metricName: "activemq.message.wait_time.avg",
    attributes: {
      broker: "localhost",
      destination: "orders",
      ...JMX_SCRAPER_RESOURCE,
    },
    expected: queue({ system: "activemq", destination: "orders" }),
  },
  {
    id: "jmx.activemq.message.queue.size.dead-letter",
    source: "OpenTelemetry JMX Scraper 1.53+ depth of the shared ActiveMQ.DLQ",
    metricName: "activemq.message.queue.size",
    attributes: {
      "activemq.broker.name": "localhost",
      "activemq.destination.type": "queue",
      "messaging.destination.name": "ActiveMQ.DLQ",
      ...JMX_SCRAPER_RESOURCE,
    },
    expected: queue({
      system: "activemq",
      destination: "ActiveMQ.DLQ",
      isDeadLetter: true,
    }),
  },
  {
    id: "jmx.activemq.message.queue.size.advisory",
    source:
      "OpenTelemetry JMX Scraper 1.53+ advisory topic (captured live next to the real queue)",
    metricName: "activemq.message.queue.size",
    attributes: {
      "activemq.broker.name": "localhost",
      "activemq.destination.type": "topic",
      "messaging.destination.name": "ActiveMQ.Advisory.Connection",
      ...JMX_SCRAPER_RESOURCE,
    },
    expected: null,
  },
  {
    id: "jmx.activemq.consumer.count.legacy-advisory",
    source:
      "OpenTelemetry JMX Scraper legacy consumer count of a producer advisory topic (live capture)",
    metricName: "activemq.consumer.count",
    attributes: {
      broker: "localhost",
      destination: "ActiveMQ.Advisory.Producer.Queue.orders",
      ...JMX_SCRAPER_RESOURCE,
    },
    expected: null,
  },
];

const SERVICE_BUS_DATAPOINTS: ReadonlyArray<DatapointFixture> = [
  {
    id: "azure_monitor.servicebus.activemessages",
    source:
      "azure_monitor ActiveMessages (Average), dimension key as Azure returns it (lowercase)",
    metricName: "azure_activemessages_average",
    attributes: {
      ...SERVICE_BUS_DATAPOINT,
      metadata_entityname: "invoices",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
    }),
  },
  {
    id: "azure_monitor.servicebus.deadletteredmessages",
    source:
      "azure_monitor DeadletteredMessages (Average), dimension key as the docs spell it and the ARM resource type casing",
    metricName: "azure_deadletteredmessages_average",
    attributes: {
      ...SERVICE_BUS_DATAPOINT,
      type: "Microsoft.ServiceBus/Namespaces",
      metadata_EntityName: "invoices",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
    }),
  },
  {
    id: "azure_monitor.servicebus.incomingmessages",
    source:
      "azure_monitor IncomingMessages (Total) on a Service Bus namespace (v0.162 adds timegrain)",
    metricName: "azure_incomingmessages_total",
    attributes: {
      ...SERVICE_BUS_DATAPOINT,
      timegrain: "PT1M",
      metadata_entityname: "invoices",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      direction: "publish",
    }),
  },
  {
    id: "azure_monitor.servicebus.outgoingmessages",
    source: "azure_monitor OutgoingMessages (Total) on a Service Bus namespace",
    metricName: "azure_outgoingmessages_total",
    attributes: {
      ...SERVICE_BUS_DATAPOINT,
      metadata_entityname: "invoices",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      direction: "consume",
    }),
  },
  {
    id: "azure_monitor.servicebus.completemessage",
    source: "azure_monitor CompleteMessage (Total)",
    metricName: "azure_completemessage_total",
    attributes: {
      ...SERVICE_BUS_DATAPOINT,
      metadata_entityname: "invoices",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      direction: "consume",
    }),
  },
  {
    id: "azure_monitor.servicebus.abandonmessage",
    source: "azure_monitor AbandonMessage (Total)",
    metricName: "azure_abandonmessage_total",
    attributes: {
      ...SERVICE_BUS_DATAPOINT,
      metadata_entityname: "invoices",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
    }),
  },
  {
    id: "azure_monitor.servicebus.servererrors",
    source:
      "azure_monitor ServerErrors (Total) split by EntityName and OperationResult",
    metricName: "azure_servererrors_total",
    attributes: {
      ...SERVICE_BUS_DATAPOINT,
      metadata_entityname: "invoice-events",
      metadata_operationresult: "serverbusy",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoice-events",
      brokerScope: "billing-prod",
    }),
  },
  {
    id: "azure_monitor.servicebus.throttledrequests",
    source:
      "azure_monitor ThrottledRequests (Total) split by EntityName, OperationResult and MessagingErrorSubCode",
    metricName: "azure_throttledrequests_total",
    attributes: {
      ...SERVICE_BUS_DATAPOINT,
      metadata_entityname: "invoices",
      metadata_operationresult: "serverbusy",
      metadata_messagingerrorsubcode: "CPU",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
    }),
  },
  {
    id: "azure_monitor.servicebus.activemessages.namespace-only",
    source:
      "azure_monitor ActiveMessages for the namespace itself (EntityName '-NamespaceOnlyMetric-')",
    metricName: "azure_activemessages_average",
    attributes: {
      ...SERVICE_BUS_DATAPOINT,
      metadata_entityname: "-NamespaceOnlyMetric-",
    },
    expected: null,
  },
  {
    id: "azure_monitor.servicebus.activemessages.mixed-case",
    source:
      "azure_monitor ActiveMessages of a namespace and entity created in mixed case",
    metricName: "azure_activemessages_average",
    attributes: {
      ...SERVICE_BUS_DATAPOINT,
      name: "Billing-Prod",
      metadata_entityname: "Invoices",
    },
    expected: queue({
      system: "servicebus",
      destination: "Invoices",
      brokerScope: "billing-prod",
    }),
  },
  {
    /*
     * azure-messaging-servicebus's own meter (research brokerMetrics): its
     * attributes are renamed by azure-core-metrics-opentelemetry —
     * hostName → server.address, entityName → messaging.destination.name —
     * and it sets no messaging.system; the metric name says Service Bus.
     */
    id: "azure-sdk-java.servicebus.messages.sent",
    source:
      "azure-messaging-servicebus (Java) messaging.servicebus.messages.sent (entity name + namespace host, no messaging.system)",
    metricName: "messaging.servicebus.messages.sent",
    attributes: {
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "invoices",
      "resource.service.name": "billing-worker",
      "resource.telemetry.sdk.language": "java",
    },
    expected: queue({
      system: "servicebus",
      destination: "invoices",
      brokerScope: "billing-prod",
      direction: "publish",
      brokerAddress: SERVICE_BUS_HOST,
    }),
  },
];

const EVENT_HUBS_DATAPOINTS: ReadonlyArray<DatapointFixture> = [
  {
    id: "azure_monitor.eventhubs.incomingmessages",
    source:
      "azure_monitor IncomingMessages (Total) on an Event Hubs namespace (the same name as Service Bus's)",
    metricName: "azure_incomingmessages_total",
    attributes: {
      ...EVENT_HUBS_DATAPOINT,
      metadata_entityname: "device-telemetry",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      direction: "publish",
    }),
  },
  {
    id: "azure_monitor.eventhubs.outgoingmessages",
    source:
      "azure_monitor OutgoingMessages (Total), PascalCase dimension key and ARM type casing",
    metricName: "azure_outgoingmessages_total",
    attributes: {
      ...EVENT_HUBS_DATAPOINT,
      type: "Microsoft.EventHub/Namespaces",
      metadata_EntityName: "device-telemetry",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      direction: "consume",
    }),
  },
  {
    id: "azure_monitor.eventhubs.throttledrequests",
    source:
      "azure_monitor ThrottledRequests (Total) on an Event Hubs namespace",
    metricName: "azure_throttledrequests_total",
    attributes: {
      ...EVENT_HUBS_DATAPOINT,
      metadata_entityname: "device-telemetry",
      metadata_operationresult: "serverbusy",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
    }),
  },
  {
    id: "azure_monitor.eventhubs.quotaexceedederrors",
    source: "azure_monitor QuotaExceededErrors (Total)",
    metricName: "azure_quotaexceedederrors_total",
    attributes: {
      ...EVENT_HUBS_DATAPOINT,
      metadata_entityname: "device-telemetry",
      metadata_operationresult: "quotaexceeded",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
    }),
  },
  {
    id: "azure_monitor.eventhubs.usererrors",
    source: "azure_monitor UserErrors (Total) on an Event Hubs namespace",
    metricName: "azure_usererrors_total",
    attributes: {
      ...EVENT_HUBS_DATAPOINT,
      metadata_entityname: "device-telemetry",
      metadata_operationresult: "clienterror",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
    }),
  },
  {
    id: "azure-sdk-java.eventhubs.consumer.lag",
    source:
      "azure-messaging-eventhubs (Java) messaging.eventhubs.consumer.lag histogram (carries messaging.system)",
    metricName: "messaging.eventhubs.consumer.lag",
    attributes: {
      "messaging.system": "eventhubs",
      "server.address": EVENT_HUBS_HOST,
      "messaging.destination.name": "device-telemetry",
      "messaging.consumer.group.name": "$Default",
      "messaging.destination.partition.id": "3",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      consumerGroup: "$Default",
      brokerAddress: EVENT_HUBS_HOST,
    }),
  },
  {
    id: "azure-sdk-java.eventhubs.client.published.messages",
    source:
      "azure-messaging-eventhubs (Java) messaging.client.published.messages (the pre-1.28 metric name)",
    metricName: "messaging.client.published.messages",
    attributes: {
      "messaging.system": "eventhubs",
      "server.address": EVENT_HUBS_HOST,
      "messaging.destination.name": "device-telemetry",
      "messaging.operation.type": "publish",
      "messaging.operation.name": "send",
      "messaging.destination.partition.id": "3",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      direction: "publish",
      brokerAddress: EVENT_HUBS_HOST,
    }),
  },
  {
    id: "azure-sdk-java.eventhubs.client.consumed.messages",
    source:
      "azure-messaging-eventhubs (Java) messaging.client.consumed.messages from a processor",
    metricName: "messaging.client.consumed.messages",
    attributes: {
      "messaging.system": "eventhubs",
      "server.address": EVENT_HUBS_HOST,
      "messaging.destination.name": "device-telemetry",
      "messaging.consumer.group.name": "$Default",
      "messaging.operation.type": "receive",
      "messaging.operation.name": "receive",
      "messaging.destination.partition.id": "3",
    },
    expected: queue({
      system: "eventhubs",
      destination: "device-telemetry",
      brokerScope: "telemetry-prod",
      direction: "consume",
      consumerGroup: "$Default",
      brokerAddress: EVENT_HUBS_HOST,
    }),
  },
];

const AWS_DATAPOINTS: ReadonlyArray<DatapointFixture> = [
  {
    id: "cloudwatch-otel1.sqs.messages-visible",
    source:
      "awsfirehose + awscloudwatchmetricstreams_encoding (opentelemetry1.0): Dimensions kvlist flattened",
    metricName: "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
    attributes: {
      Namespace: "AWS/SQS",
      MetricName: "ApproximateNumberOfMessagesVisible",
      "Dimensions.QueueName": "payment-events",
      ...CLOUDWATCH_OTEL_RESOURCE,
    },
    expected: queue({ system: "aws_sqs", destination: "payment-events" }),
  },
  {
    id: "aws_cloudwatch.sqs.age-of-oldest-message.stat",
    source:
      "aws_cloudwatch pull receiver with `stats` configured (a Gauge per statistic, tagged with `stat`)",
    metricName: "amazonaws.com/aws/sqs/approximateageofoldestmessage",
    attributes: {
      Namespace: "AWS/SQS",
      MetricName: "ApproximateAgeOfOldestMessage",
      "Dimensions.QueueName": "payment-events",
      stat: "Maximum",
      "resource.cloud.provider": "aws",
      "resource.cloud.region": "eu-west-1",
    },
    expected: queue({ system: "aws_sqs", destination: "payment-events" }),
  },
  {
    id: "cloudwatch-otel1.sqs.messages-sent",
    source: "Metric Stream (opentelemetry1.0) NumberOfMessagesSent",
    metricName: "amazonaws.com/aws/sqs/numberofmessagessent",
    attributes: {
      Namespace: "AWS/SQS",
      MetricName: "NumberOfMessagesSent",
      "Dimensions.QueueName": "payment-events",
      ...CLOUDWATCH_OTEL_RESOURCE,
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
      direction: "publish",
    }),
  },
  {
    id: "cloudwatch-otel1.sqs.messages-deleted",
    source: "Metric Stream (opentelemetry1.0) NumberOfMessagesDeleted",
    metricName: "amazonaws.com/aws/sqs/numberofmessagesdeleted",
    attributes: {
      Namespace: "AWS/SQS",
      MetricName: "NumberOfMessagesDeleted",
      "Dimensions.QueueName": "payment-events",
      ...CLOUDWATCH_OTEL_RESOURCE,
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
      direction: "consume",
    }),
  },
  {
    id: "cloudwatch-json.sqs.messages-visible",
    source:
      "awsfirehose + encoding (json): the bare CloudWatch name, plain QueueName, service.name=SQS on the resource",
    metricName: "approximatenumberofmessagesvisible",
    attributes: {
      QueueName: "payment-events",
      ...cloudWatchJsonResource("SQS"),
    },
    expected: queue({ system: "aws_sqs", destination: "payment-events" }),
  },
  {
    id: "cloudwatch-json.sqs.messages-received",
    source: "Metric Stream (json) NumberOfMessagesReceived",
    metricName: "numberofmessagesreceived",
    attributes: {
      QueueName: "payment-events",
      ...cloudWatchJsonResource("SQS"),
    },
    expected: queue({
      system: "aws_sqs",
      destination: "payment-events",
      direction: "consume",
    }),
  },
  {
    id: "cloudwatch-json.sqs.messages-not-visible",
    source: "Metric Stream (json) ApproximateNumberOfMessagesNotVisible",
    metricName: "approximatenumberofmessagesnotvisible",
    attributes: {
      QueueName: "payment-events",
      ...cloudWatchJsonResource("SQS"),
    },
    expected: queue({ system: "aws_sqs", destination: "payment-events" }),
  },
  {
    id: "cloudwatch-json.sqs.dead-letter-queue",
    source:
      "Metric Stream (json) ApproximateNumberOfMessagesVisible of a DLQ (an ordinary queue: no DLQ dimension)",
    metricName: "approximatenumberofmessagesvisible",
    attributes: {
      QueueName: "payment-events-dlq",
      ...cloudWatchJsonResource("SQS"),
    },
    expected: queue({ system: "aws_sqs", destination: "payment-events-dlq" }),
  },
  {
    id: "cloudwatch-otel1.sns.messages-published",
    source: "Metric Stream (opentelemetry1.0) SNS NumberOfMessagesPublished",
    metricName: "amazonaws.com/aws/sns/numberofmessagespublished",
    attributes: {
      Namespace: "AWS/SNS",
      MetricName: "NumberOfMessagesPublished",
      "Dimensions.TopicName": "payment-notifications",
      ...CLOUDWATCH_OTEL_RESOURCE,
    },
    expected: queue({
      system: "aws.sns",
      destination: "payment-notifications",
      direction: "publish",
    }),
  },
  {
    id: "cloudwatch-otel1.sns.notifications-failed",
    source: "Metric Stream (opentelemetry1.0) SNS NumberOfNotificationsFailed",
    metricName: "amazonaws.com/aws/sns/numberofnotificationsfailed",
    attributes: {
      Namespace: "AWS/SNS",
      MetricName: "NumberOfNotificationsFailed",
      "Dimensions.TopicName": "payment-notifications",
      ...CLOUDWATCH_OTEL_RESOURCE,
    },
    expected: queue({
      system: "aws.sns",
      destination: "payment-notifications",
    }),
  },
  {
    id: "cloudwatch-json.sns.notifications-delivered",
    source:
      "Metric Stream (json) SNS NumberOfNotificationsDelivered (service.name=SNS)",
    metricName: "numberofnotificationsdelivered",
    attributes: {
      TopicName: "payment-notifications",
      ...cloudWatchJsonResource("SNS"),
    },
    expected: queue({
      system: "aws.sns",
      destination: "payment-notifications",
      direction: "consume",
    }),
  },
  {
    id: "cloudwatch-json.sns.redriven-to-dlq",
    source: "Metric Stream (json) SNS NumberOfNotificationsRedrivenToDlq",
    metricName: "numberofnotificationsredriventodlq",
    attributes: {
      TopicName: "payment-notifications",
      ...cloudWatchJsonResource("SNS"),
    },
    expected: queue({
      system: "aws.sns",
      destination: "payment-notifications",
    }),
  },
  {
    id: "cloudwatch-otel1.sns.mobile-push-dimensions",
    source:
      "Metric Stream (opentelemetry1.0) SNS NumberOfNotificationsDelivered for a push application (Application/Platform dimensions, no TopicName)",
    metricName: "amazonaws.com/aws/sns/numberofnotificationsdelivered",
    attributes: {
      Namespace: "AWS/SNS",
      MetricName: "NumberOfNotificationsDelivered",
      "Dimensions.Application": "billing-app",
      "Dimensions.Platform": "GCM",
      ...CLOUDWATCH_OTEL_RESOURCE,
    },
    expected: null,
  },
];

const PUBSUB_DATAPOINTS: ReadonlyArray<DatapointFixture> = [
  {
    id: "googlecloudmonitoring.subscription.num-undelivered",
    source:
      "googlecloudmonitoring num_undelivered_messages (monitored-resource labels on the resource)",
    metricName: "pubsub.googleapis.com/subscription/num_undelivered_messages",
    attributes: {
      "resource.gcp.resource_type": "pubsub_subscription",
      "resource.project_id": "shop-prod",
      "resource.subscription_id": "orders-billing",
    },
    expected: queue({ system: "gcp_pubsub", destination: "orders-billing" }),
  },
  {
    id: "googlecloudmonitoring.subscription.oldest-unacked-age",
    source: "googlecloudmonitoring oldest_unacked_message_age",
    metricName: "pubsub.googleapis.com/subscription/oldest_unacked_message_age",
    attributes: {
      "resource.gcp.resource_type": "pubsub_subscription",
      "resource.project_id": "shop-prod",
      "resource.subscription_id": "orders-billing",
    },
    expected: queue({ system: "gcp_pubsub", destination: "orders-billing" }),
  },
  {
    id: "googlecloudmonitoring.subscription.dead-letter-count",
    source:
      "googlecloudmonitoring dead_letter_message_count (collector 0.137+: response_code on the datapoint)",
    metricName: "pubsub.googleapis.com/subscription/dead_letter_message_count",
    attributes: {
      response_code: "success",
      "resource.gcp.resource_type": "pubsub_subscription",
      "resource.project_id": "shop-prod",
      "resource.subscription_id": "orders-billing",
    },
    expected: queue({ system: "gcp_pubsub", destination: "orders-billing" }),
  },
  {
    id: "googlecloudmonitoring.subscription.ack-count.resource-labels",
    source:
      "googlecloudmonitoring ack_message_count from collector 0.116-0.136 (metric label on the RESOURCE)",
    metricName: "pubsub.googleapis.com/subscription/ack_message_count",
    attributes: {
      "resource.delivery_type": "pull",
      "resource.gcp.resource_type": "pubsub_subscription",
      "resource.project_id": "shop-prod",
      "resource.subscription_id": "orders-billing",
    },
    expected: queue({
      system: "gcp_pubsub",
      destination: "orders-billing",
      direction: "consume",
    }),
  },
  {
    id: "googlecloudmonitoring.topic.send-request-count",
    source:
      "googlecloudmonitoring topic send_request_count (pubsub_topic resource)",
    metricName: "pubsub.googleapis.com/topic/send_request_count",
    attributes: {
      response_class: "success",
      response_code: "OK",
      "resource.gcp.resource_type": "pubsub_topic",
      "resource.project_id": "shop-prod",
      "resource.topic_id": "orders",
    },
    expected: queue({
      system: "gcp_pubsub",
      destination: "orders",
      direction: "publish",
    }),
  },
];

const PULSAR_ROCKETMQ_NATS_DATAPOINTS: ReadonlyArray<DatapointFixture> = [
  {
    id: "prometheus.pulsar_msg_backlog",
    source:
      "prometheus receiver scraping a Pulsar broker's /metrics/ (a partition of a partitioned topic; live capture, Pulsar 4.2)",
    metricName: "pulsar_msg_backlog",
    attributes: {
      cluster: "pulsar-prod",
      namespace: "public/default",
      topic: "persistent://public/default/payments-partition-1",
      ...PULSAR_RESOURCE,
    },
    expected: queue({
      system: "pulsar",
      destination: "persistent://public/default/payments",
      brokerAddress: PULSAR_BROKER_ADDRESS,
    }),
  },
  {
    id: "prometheus.pulsar_msg_backlog.split-partition-label",
    source:
      "Pulsar with splitTopicAndPartitionLabelInPrometheus=true (partition in its own label)",
    metricName: "pulsar_msg_backlog",
    attributes: {
      cluster: "pulsar-prod",
      namespace: "public/default",
      topic: "persistent://public/default/payments",
      partition: "1",
      ...PULSAR_RESOURCE,
    },
    expected: queue({
      system: "pulsar",
      destination: "persistent://public/default/payments",
      brokerAddress: PULSAR_BROKER_ADDRESS,
    }),
  },
  {
    id: "prometheus.pulsar_subscription_back_log",
    source: "Pulsar subscription backlog (topic + subscription labels)",
    metricName: "pulsar_subscription_back_log",
    attributes: {
      cluster: "pulsar-prod",
      namespace: "public/default",
      subscription: "ledger",
      topic: "persistent://public/default/payments-partition-0",
      ...PULSAR_RESOURCE,
    },
    expected: queue({
      system: "pulsar",
      destination: "persistent://public/default/payments",
      brokerAddress: PULSAR_BROKER_ADDRESS,
    }),
  },
  {
    id: "prometheus.pulsar_storage_backlog_age_seconds",
    source: "Pulsar backlog age (-1 while unknown)",
    metricName: "pulsar_storage_backlog_age_seconds",
    attributes: {
      cluster: "pulsar-prod",
      namespace: "public/default",
      topic: "persistent://public/default/orders",
      ...PULSAR_RESOURCE,
    },
    expected: queue({
      system: "pulsar",
      destination: "persistent://public/default/orders",
      brokerAddress: PULSAR_BROKER_ADDRESS,
    }),
  },
  {
    id: "prometheus.pulsar_in_messages_total",
    source:
      "Pulsar messages in (declared `# TYPE gauge`, holds a running total)",
    metricName: "pulsar_in_messages_total",
    attributes: {
      cluster: "pulsar-prod",
      namespace: "public/default",
      topic: "persistent://public/default/orders",
      ...PULSAR_RESOURCE,
    },
    expected: queue({
      system: "pulsar",
      destination: "persistent://public/default/orders",
      direction: "publish",
      brokerAddress: PULSAR_BROKER_ADDRESS,
    }),
  },
  {
    id: "prometheus.pulsar_out_messages_total",
    source: "Pulsar messages out, per subscription",
    metricName: "pulsar_out_messages_total",
    attributes: {
      cluster: "pulsar-prod",
      namespace: "public/default",
      subscription: "billing",
      topic: "persistent://public/default/orders",
      ...PULSAR_RESOURCE,
    },
    expected: queue({
      system: "pulsar",
      destination: "persistent://public/default/orders",
      direction: "consume",
      brokerAddress: PULSAR_BROKER_ADDRESS,
    }),
  },
  {
    id: "prometheus.pulsar_subscription_back_log.system-topic",
    source:
      "Pulsar compaction subscription on the __change_events system topic (live capture)",
    metricName: "pulsar_subscription_back_log",
    attributes: {
      cluster: "pulsar-prod",
      namespace: "public/default",
      subscription: "__compaction",
      topic: "persistent://public/default/__change_events",
      ...PULSAR_RESOURCE,
    },
    expected: null,
  },
  {
    id: "prometheus.rocketmq_consumer_lag_messages",
    source:
      "prometheus receiver scraping a RocketMQ 5 broker (metricsExporterType=PROM, :5557)",
    metricName: "rocketmq_consumer_lag_messages",
    attributes: {
      topic: "order-topic",
      consumer_group: "order-consumer-group",
      is_retry: "false",
      is_system: "false",
      cluster: "DefaultCluster",
      node_type: "broker",
      node_id: "broker-a",
      ...ROCKETMQ_RESOURCE,
    },
    expected: queue({
      system: "rocketmq",
      destination: "order-topic",
      brokerAddress: ROCKETMQ_BROKER_ADDRESS,
    }),
  },
  {
    id: "prometheus.rocketmq_consumer_ready_messages",
    source: "RocketMQ 5 broker ready messages",
    metricName: "rocketmq_consumer_ready_messages",
    attributes: {
      topic: "order-topic",
      consumer_group: "order-consumer-group",
      is_retry: "false",
      is_system: "false",
      cluster: "DefaultCluster",
      node_type: "broker",
      node_id: "broker-a",
      ...ROCKETMQ_RESOURCE,
    },
    expected: queue({
      system: "rocketmq",
      destination: "order-topic",
      brokerAddress: ROCKETMQ_BROKER_ADDRESS,
    }),
  },
  {
    id: "prometheus.rocketmq_send_to_dlq_messages_total",
    source:
      "RocketMQ 5 broker messages sent to a group's DLQ, counted under the ORIGIN topic",
    metricName: "rocketmq_send_to_dlq_messages_total",
    attributes: {
      topic: "order-topic",
      consumer_group: "order-consumer-group",
      is_system: "false",
      cluster: "DefaultCluster",
      node_type: "broker",
      node_id: "broker-a",
      ...ROCKETMQ_RESOURCE,
    },
    expected: queue({
      system: "rocketmq",
      destination: "order-topic",
      brokerAddress: ROCKETMQ_BROKER_ADDRESS,
    }),
  },
  {
    id: "prometheus.rocketmq_messages_in_total",
    source: "RocketMQ 5 broker messages in",
    metricName: "rocketmq_messages_in_total",
    attributes: {
      topic: "order-topic",
      message_type: "Normal",
      is_system: "false",
      cluster: "DefaultCluster",
      node_type: "broker",
      node_id: "broker-a",
      ...ROCKETMQ_RESOURCE,
    },
    expected: queue({
      system: "rocketmq",
      destination: "order-topic",
      direction: "publish",
      brokerAddress: ROCKETMQ_BROKER_ADDRESS,
    }),
  },
  {
    id: "prometheus.rocketmq_consumer_lag_messages.dead-letter-topic",
    source:
      "RocketMQ 5 broker lag on a consumer group's dead-letter topic (%DLQ%<group>)",
    metricName: "rocketmq_consumer_lag_messages",
    attributes: {
      topic: "%DLQ%order-consumer-group",
      consumer_group: "order-dlq-drainer",
      is_retry: "false",
      is_system: "false",
      cluster: "DefaultCluster",
      node_type: "broker",
      node_id: "broker-a",
      ...ROCKETMQ_RESOURCE,
    },
    expected: queue({
      system: "rocketmq",
      destination: "%DLQ%order-consumer-group",
      brokerAddress: ROCKETMQ_BROKER_ADDRESS,
      isDeadLetter: true,
    }),
  },
  {
    id: "prometheus.jetstream_consumer_num_pending",
    source:
      "prometheus-nats-exporter JetStream consumer pending (per stream and consumer, not per subject; live capture)",
    metricName: "jetstream_consumer_num_pending",
    attributes: {
      account: "$G",
      account_id: "$G",
      account_name: "$G",
      consumer_name: "billing",
      is_consumer_leader: "true",
      is_meta_leader: "true",
      is_stream_leader: "true",
      server_id: "http://nats-0.nats:8222",
      server_name: "NBGQRQA4BN5NA7ADQLKR3AS5EEBBLIMUPAXQ3SIHW7UH3DQPJX5OMAR4",
      stream_leader: "NBGQRQA4BN5NA7ADQLKR3AS5EEBBLIMUPAXQ3SIHW7UH3DQPJX5OMAR4",
      stream_name: "ORDERS",
      ...prometheusResource("nats", "nats-exporter", "7777"),
    },
    expected: null,
  },
];

const CLIENT_AND_APPLICATION_DATAPOINTS: ReadonlyArray<DatapointFixture> = [
  {
    id: "kafkajs.client.sent.messages",
    source:
      "@opentelemetry/instrumentation-kafkajs messaging.client.sent.messages",
    metricName: "messaging.client.sent.messages",
    attributes: {
      "messaging.system": "kafka",
      "messaging.operation.name": "send",
      "messaging.destination.name": "payments",
      "messaging.destination.partition.id": "1",
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "publish",
    }),
  },
  {
    id: "kafkajs.client.consumed.messages",
    source:
      "@opentelemetry/instrumentation-kafkajs messaging.client.consumed.messages",
    metricName: "messaging.client.consumed.messages",
    attributes: {
      "messaging.system": "kafka",
      "messaging.operation.name": "process",
      "messaging.destination.name": "payments",
      "messaging.destination.partition.id": "0",
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "consume",
    }),
  },
  {
    id: "kafkajs.process.duration",
    source: "@opentelemetry/instrumentation-kafkajs messaging.process.duration",
    metricName: "messaging.process.duration",
    attributes: {
      "messaging.system": "kafka",
      "messaging.operation.name": "process",
      "messaging.destination.name": "payments",
      "messaging.destination.partition.id": "0",
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "consume",
    }),
  },
  {
    id: "kafkajs.client.operation.duration.request",
    source:
      "@opentelemetry/instrumentation-kafkajs request duration (broker API name, no topic)",
    metricName: "messaging.client.operation.duration",
    attributes: {
      "messaging.system": "kafka",
      "messaging.operation.name": "Fetch",
      "server.address": "kafka-0.kafka-headless",
      "server.port": 9092,
    },
    expected: null,
  },
  {
    id: "java-agent.default.publish.duration",
    source:
      "Java agent default mode messaging.publish.duration (deprecated name; no address for Kafka)",
    metricName: "messaging.publish.duration",
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "payments",
      "messaging.operation": "publish",
      "messaging.destination.partition.id": "2",
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "publish",
    }),
  },
  {
    id: "java-agent.default.receive.messages",
    source: "Java agent default mode messaging.receive.messages",
    metricName: "messaging.receive.messages",
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "payments",
      "messaging.operation": "receive",
      "messaging.destination.partition.id": "0",
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "consume",
    }),
  },
  /*
   * The Java agent's opt-in client metrics keep what MessagingMetricsAdvice
   * lists for each instrument: the operation NAME on all four, the
   * operation type on messaging.client.operation.duration alone, never a
   * routing key.
   */
  {
    id: "java-agent.opt-in.client.consumed.messages",
    source:
      "Java agent opt-in messaging.client.consumed.messages (consumer group on the datapoint)",
    metricName: "messaging.client.consumed.messages",
    attributes: {
      "messaging.operation.name": "process",
      "messaging.system": "kafka",
      "messaging.consumer.group.name": "billing",
      "messaging.destination.name": "payments",
      "messaging.destination.partition.id": "0",
    },
    expected: queue({
      system: "kafka",
      destination: "payments",
      direction: "consume",
      consumerGroup: "billing",
    }),
  },
  {
    id: "java-agent.opt-in.client.sent.messages.nats-inbox",
    source:
      "Java agent opt-in messaging.client.sent.messages to a NATS inbox (the advice drops the name, keeps the template)",
    metricName: "messaging.client.sent.messages",
    attributes: {
      "messaging.operation.name": "publish",
      "messaging.system": "nats",
      "messaging.destination.template": "_INBOX.",
    },
    expected: null,
  },
  {
    id: "java-agent.opt-in.client.operation.duration.rabbitmq-publish",
    source:
      "Java agent opt-in messaging.client.operation.duration of a RabbitMQ publish (no routing-key key on metrics)",
    metricName: "messaging.client.operation.duration",
    attributes: {
      "messaging.operation.name": "publish",
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "orders.topic:orders.eu.created",
      "messaging.operation.type": "send",
      "server.address": "rabbitmq.internal",
      "server.port": 5672,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "orders.topic",
      direction: "publish",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
  {
    id: "java-agent.opt-in.client.sent.messages.rabbitmq-publish",
    source:
      "Java agent opt-in messaging.client.sent.messages of the same RabbitMQ publish (the operation name, no operation type)",
    metricName: "messaging.client.sent.messages",
    attributes: {
      "messaging.operation.name": "publish",
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "orders.topic:orders.eu.created",
      "server.address": "rabbitmq.internal",
      "server.port": 5672,
    },
    expected: queue({
      system: "rabbitmq",
      destination: "orders.topic",
      direction: "publish",
      brokerAddress: "rabbitmq.internal:5672",
    }),
  },
  {
    id: "java-agent.opt-in.process.duration.rabbitmq-consumer",
    source:
      "Java agent opt-in messaging.process.duration of a RabbitMQ consumer ('direct_logs:warning': routing key == queue; the operation name, no operation type)",
    metricName: "messaging.process.duration",
    attributes: {
      "messaging.operation.name": "process",
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "direct_logs:warning",
    },
    expected: queue({
      system: "rabbitmq",
      destination: "warning",
      direction: "consume",
    }),
  },
  {
    id: "java-agent.opt-in.client.consumed.messages.rabbitmq-fanout",
    source:
      "Java agent opt-in messaging.client.consumed.messages of a RabbitMQ delivery from a fanout exchange ('logs:logs-audit': the empty routing key left out)",
    metricName: "messaging.client.consumed.messages",
    attributes: {
      "messaging.operation.name": "process",
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "logs:logs-audit",
    },
    expected: queue({
      system: "rabbitmq",
      destination: "logs-audit",
      direction: "consume",
    }),
  },
  {
    id: "oneuptime.queue.size.waiting",
    source:
      "OneUptime's own BullMQ queue.size observable gauge (Queue.ts), waiting jobs",
    metricName: "queue.size",
    attributes: {
      "messaging.system": "bullmq",
      "messaging.destination.name": "Worker",
      state: "waiting",
      "resource.service.name": "app",
    },
    expected: queue({ system: "bullmq", destination: "Worker" }),
  },
  {
    id: "oneuptime.queue.size.failed",
    source: "OneUptime's own BullMQ queue.size, failed jobs",
    metricName: "queue.size",
    attributes: {
      "messaging.system": "bullmq",
      "messaging.destination.name": "Worker",
      state: "failed",
      "resource.service.name": "app",
    },
    expected: queue({ system: "bullmq", destination: "Worker" }),
  },
  {
    id: "oneuptime.worker.job.count",
    source:
      "OneUptime's own worker.job.count (QueueWorker.ts: job name in messaging.operation.name, outcome)",
    metricName: "worker.job.count",
    attributes: {
      "messaging.system": "bullmq",
      "messaging.destination.name": "Telemetry",
      "messaging.operation.name": "IngestTelemetryBatch",
      outcome: "success",
      "resource.service.name": "app",
    },
    expected: queue({ system: "bullmq", destination: "Telemetry" }),
  },
  {
    id: "oneuptime.worker.job.duration",
    source: "OneUptime's own worker.job.duration of a failed Workflow job",
    metricName: "worker.job.duration",
    attributes: {
      "messaging.system": "bullmq",
      "messaging.destination.name": "Workflow",
      "messaging.operation.name": "RunWorkflow",
      outcome: "failure",
      "resource.service.name": "app",
    },
    expected: queue({ system: "bullmq", destination: "Workflow" }),
  },
  {
    id: "oneuptime.worker.job.active",
    source: "OneUptime's own worker.job.active up-down counter",
    metricName: "worker.job.active",
    attributes: {
      "messaging.system": "bullmq",
      "messaging.destination.name": "Runbook",
      "messaging.operation.name": "ExecuteRunbook",
      "resource.service.name": "app",
    },
    expected: queue({ system: "bullmq", destination: "Runbook" }),
  },
];

const DATAPOINTS: ReadonlyArray<DatapointFixture> = [
  ...KAFKA_DATAPOINTS,
  ...RABBITMQ_DATAPOINTS,
  ...ACTIVEMQ_DATAPOINTS,
  ...SERVICE_BUS_DATAPOINTS,
  ...EVENT_HUBS_DATAPOINTS,
  ...AWS_DATAPOINTS,
  ...PUBSUB_DATAPOINTS,
  ...PULSAR_ROCKETMQ_NATS_DATAPOINTS,
  ...CLIENT_AND_APPLICATION_DATAPOINTS,
];

// ---- the same queue seen by an application and by its broker -------------

const SAME_QUEUE_PAIRS: ReadonlyArray<SameQueuePair> = [
  {
    queue: "Kafka topic, Java agent consumer vs kafka_metrics lag",
    spanId: "kafka.java-agent.default.process",
    datapointId: "kafka_metrics.lag_sum",
    identity: { system: "kafka", brokerScope: "", destination: "payments" },
  },
  {
    queue:
      "Kafka topic, Confluent .NET poll vs kafka_metrics lag (no resource)",
    spanId: "kafka.confluent-dotnet.poll",
    datapointId: "kafka_metrics.lag_sum.no-resource",
    identity: { system: "kafka", brokerScope: "", destination: "payments" },
  },
  {
    queue: "Kafka topic, Confluent .NET send vs log-end offset",
    spanId: "kafka.confluent-dotnet.send",
    datapointId: "kafka_metrics.current_offset",
    identity: { system: "kafka", brokerScope: "", destination: "payments" },
  },
  {
    queue: "Kafka topic named by UUID, templated on both sides",
    spanId: "kafka.java-agent.default.send.uuid-topic",
    datapointId: "kafka_metrics.lag_sum.uuid-topic",
    identity: {
      system: "kafka",
      brokerScope: "",
      destination: UUID_TOPIC_TEMPLATED,
    },
  },
  {
    queue: "RabbitMQ queue, Java agent default-exchange delivery vs depth",
    spanId: "rabbitmq.java-agent.default.process.default-exchange",
    datapointId: "rabbitmq.message.current.ready",
    identity: { system: "rabbitmq", brokerScope: "", destination: "invoices" },
  },
  {
    queue:
      "RabbitMQ queue, Java agent opt-in default-exchange publish vs depth",
    spanId: "rabbitmq.java-agent.opt-in.publish.default-exchange",
    datapointId: "rabbitmq.message.current.unacknowledged",
    identity: { system: "rabbitmq", brokerScope: "", destination: "invoices" },
  },
  {
    queue: "RabbitMQ queue, .NET v7 deliver vs acknowledged",
    spanId: "rabbitmq.dotnet-v7.deliver.default-exchange",
    datapointId: "rabbitmq.message.acknowledged",
    identity: { system: "rabbitmq", brokerScope: "", destination: "invoices" },
  },
  {
    queue: "RabbitMQ queue, amqplib default-exchange publish vs published",
    spanId: "rabbitmq.amqplib.publish.default-exchange",
    datapointId: "rabbitmq.message.published",
    identity: { system: "rabbitmq", brokerScope: "", destination: "invoices" },
  },
  {
    queue: "RabbitMQ queue, pika publish vs published",
    spanId: "rabbitmq.pika.publish.default-exchange",
    datapointId: "rabbitmq.message.published",
    identity: { system: "rabbitmq", brokerScope: "", destination: "invoices" },
  },
  {
    queue: "RabbitMQ queue, aio-pika consume vs delivered",
    spanId: "rabbitmq.aio-pika.consume.default-exchange",
    datapointId: "rabbitmq.message.delivered",
    identity: { system: "rabbitmq", brokerScope: "", destination: "invoices" },
  },
  {
    queue:
      "RabbitMQ queue, Java agent opt-in consumer 'direct_logs:warning' vs the 'warning' queue's depth",
    spanId: "rabbitmq.java-agent.opt-in.process.routing-key-is-queue",
    datapointId: "rabbitmq.message.current.warning",
    identity: { system: "rabbitmq", brokerScope: "", destination: "warning" },
  },
  {
    queue:
      "RabbitMQ queue, Java agent opt-in fanout consumer 'logs:logs-audit' vs the 'logs-audit' queue's depth",
    spanId: "rabbitmq.java-agent.opt-in.process.fanout-empty-routing-key",
    datapointId: "rabbitmq.message.current.logs-audit",
    identity: {
      system: "rabbitmq",
      brokerScope: "",
      destination: "logs-audit",
    },
  },
  {
    queue:
      "RabbitMQ queue, Java agent opt-in consumer of a MassTransit exchange 'Namespace:Type:invoice-issued' vs the 'invoice-issued' queue's depth",
    spanId: "rabbitmq.java-agent.opt-in.process.masstransit-exchange",
    datapointId: "rabbitmq.message.current.invoice-issued",
    identity: {
      system: "rabbitmq",
      brokerScope: "",
      destination: "invoice-issued",
    },
  },
  {
    /*
     * ActiveMQ is keyed on the JMS family (MessagingSystem identityFamily),
     * so its identity says "jms" whichever side named the queue.
     */
    queue: "ActiveMQ queue vs JMX Scraper (1.53+ names)",
    spanId: "activemq.manual.send",
    datapointId: "jmx.activemq.message.queue.size",
    identity: { system: "jms", brokerScope: "", destination: "orders" },
  },
  {
    queue: "ActiveMQ queue vs JMX Scraper (legacy names)",
    spanId: "activemq.manual.send",
    datapointId: "jmx.activemq.message.current.legacy",
    identity: { system: "jms", brokerScope: "", destination: "orders" },
  },
  {
    // The everyday case: Java agent JMS spans against ActiveMQ's own metrics.
    queue: "JMS client (Java agent) vs ActiveMQ JMX Scraper",
    spanId: "jms.java-agent.default.send",
    datapointId: "jmx.activemq.message.queue.size",
    identity: { system: "jms", brokerScope: "", destination: "orders" },
  },
  {
    queue: "JMS client (Java agent) vs ActiveMQ JMX Scraper (legacy names)",
    spanId: "jms.java-agent.default.send",
    datapointId: "jmx.activemq.message.current.legacy",
    identity: { system: "jms", brokerScope: "", destination: "orders" },
  },
  {
    queue: "SQS queue, Java agent vs Metric Stream (opentelemetry1.0)",
    spanId: "sqs.java-agent.default.send",
    datapointId: "cloudwatch-otel1.sqs.messages-visible",
    identity: {
      system: "aws_sqs",
      brokerScope: "",
      destination: "payment-events",
    },
  },
  {
    queue:
      "SQS queue, Go otelaws (URL in server.address) vs Metric Stream (json)",
    spanId: "sqs.go-otelaws.send-message",
    datapointId: "cloudwatch-json.sqs.messages-visible",
    identity: {
      system: "aws_sqs",
      brokerScope: "",
      destination: "payment-events",
    },
  },
  {
    queue: "SQS queue, boto3sqs vs aws_cloudwatch pull with stats",
    spanId: "sqs.boto3sqs.process",
    datapointId: "aws_cloudwatch.sqs.age-of-oldest-message.stat",
    identity: {
      system: "aws_sqs",
      brokerScope: "",
      destination: "payment-events",
    },
  },
  {
    queue: "SQS queue, .NET AWS legacy mode vs NumberOfMessagesSent",
    spanId: "sqs.dotnet-aws.legacy.receive",
    datapointId: "cloudwatch-otel1.sqs.messages-sent",
    identity: {
      system: "aws_sqs",
      brokerScope: "",
      destination: "payment-events",
    },
  },
  {
    queue:
      "SNS topic, Java agent RPC span (ARN) vs Metric Stream (opentelemetry1.0)",
    spanId: "sns.java-agent.publish",
    datapointId: "cloudwatch-otel1.sns.messages-published",
    identity: {
      system: "aws.sns",
      brokerScope: "",
      destination: "payment-notifications",
    },
  },
  {
    queue:
      "SNS topic, Go otelaws (aws_sns, short name) vs Metric Stream (json)",
    spanId: "sns.go-otelaws.publish.topic",
    datapointId: "cloudwatch-json.sns.notifications-delivered",
    identity: {
      system: "aws.sns",
      brokerScope: "",
      destination: "payment-notifications",
    },
  },
  {
    queue: "SNS topic, JS aws-sdk vs NumberOfNotificationsFailed",
    spanId: "sns.aws-sdk-js.publish",
    datapointId: "cloudwatch-otel1.sns.notifications-failed",
    identity: {
      system: "aws.sns",
      brokerScope: "",
      destination: "payment-notifications",
    },
  },
  {
    queue: "Pub/Sub subscription, Node subscriber vs num_undelivered_messages",
    spanId: "pubsub.node.subscribe",
    datapointId: "googlecloudmonitoring.subscription.num-undelivered",
    identity: {
      system: "gcp_pubsub",
      brokerScope: "",
      destination: "orders-billing",
    },
  },
  {
    queue: "Pub/Sub subscription, Go process vs ack_message_count",
    spanId: "pubsub.go-v2.process",
    datapointId: "googlecloudmonitoring.subscription.ack-count.resource-labels",
    identity: {
      system: "gcp_pubsub",
      brokerScope: "",
      destination: "orders-billing",
    },
  },
  {
    queue: "Pub/Sub topic, Node publisher vs send_request_count",
    spanId: "pubsub.node.create",
    datapointId: "googlecloudmonitoring.topic.send-request-count",
    identity: { system: "gcp_pubsub", brokerScope: "", destination: "orders" },
  },
  {
    queue: "Service Bus queue, .NET (ActivitySource) vs ActiveMessages",
    spanId: "servicebus.dotnet.activity-source.send",
    datapointId: "azure_monitor.servicebus.activemessages",
    identity: {
      system: "servicebus",
      brokerScope: "billing-prod",
      destination: "invoices",
    },
  },
  {
    queue:
      "Service Bus queue, .NET without the ActivitySource switch vs DeadletteredMessages (PascalCase key)",
    spanId: "servicebus.dotnet.diagnostic-source.send",
    datapointId: "azure_monitor.servicebus.deadletteredmessages",
    identity: {
      system: "servicebus",
      brokerScope: "billing-prod",
      destination: "invoices",
    },
  },
  {
    queue:
      "Service Bus queue, a dead-letter sub-queue receive vs DeadletteredMessages",
    spanId: "servicebus.dotnet.diagnostic-source.receive.dead-letter",
    datapointId: "azure_monitor.servicebus.deadletteredmessages",
    identity: {
      system: "servicebus",
      brokerScope: "billing-prod",
      destination: "invoices",
    },
  },
  {
    queue: "Service Bus topic, .NET subscription processor vs ServerErrors",
    spanId: "servicebus.dotnet.activity-source.process.subscription",
    datapointId: "azure_monitor.servicebus.servererrors",
    identity: {
      system: "servicebus",
      brokerScope: "billing-prod",
      destination: "invoice-events",
    },
  },
  {
    queue: "Service Bus topic, Java subscription processor vs ServerErrors",
    spanId: "servicebus.java.process.subscription",
    datapointId: "azure_monitor.servicebus.servererrors",
    identity: {
      system: "servicebus",
      brokerScope: "billing-prod",
      destination: "invoice-events",
    },
  },
  {
    queue:
      "Service Bus topic, JS receiver (messaging.source.name) vs ServerErrors",
    spanId: "servicebus.js.receive.subscription",
    datapointId: "azure_monitor.servicebus.servererrors",
    identity: {
      system: "servicebus",
      brokerScope: "billing-prod",
      destination: "invoice-events",
    },
  },
  {
    queue: "Service Bus queue, Python (legacy keys) vs IncomingMessages",
    spanId: "servicebus.python.send",
    datapointId: "azure_monitor.servicebus.incomingmessages",
    identity: {
      system: "servicebus",
      brokerScope: "billing-prod",
      destination: "invoices",
    },
  },
  {
    queue: "Service Bus queue spelled in mixed case on both sides",
    spanId: "servicebus.dotnet.activity-source.send.mixed-case-namespace",
    datapointId: "azure_monitor.servicebus.activemessages.mixed-case",
    identity: {
      system: "servicebus",
      brokerScope: "billing-prod",
      destination: "invoices",
    },
  },
  {
    queue:
      "Service Bus queue, .NET send vs the Java SDK's own messages.sent metric",
    spanId: "servicebus.dotnet.activity-source.send",
    datapointId: "azure-sdk-java.servicebus.messages.sent",
    identity: {
      system: "servicebus",
      brokerScope: "billing-prod",
      destination: "invoices",
    },
  },
  {
    queue: "Event hub, .NET (ActivitySource) vs IncomingMessages",
    spanId: "eventhubs.dotnet.activity-source.send",
    datapointId: "azure_monitor.eventhubs.incomingmessages",
    identity: {
      system: "eventhubs",
      brokerScope: "telemetry-prod",
      destination: "device-telemetry",
    },
  },
  {
    queue:
      "Event hub, .NET without the ActivitySource switch vs IncomingMessages",
    spanId: "eventhubs.dotnet.diagnostic-source.send",
    datapointId: "azure_monitor.eventhubs.incomingmessages",
    identity: {
      system: "eventhubs",
      brokerScope: "telemetry-prod",
      destination: "device-telemetry",
    },
  },
  {
    queue: "Event hub, Java processor vs OutgoingMessages (PascalCase key)",
    spanId: "eventhubs.java.process",
    datapointId: "azure_monitor.eventhubs.outgoingmessages",
    identity: {
      system: "eventhubs",
      brokerScope: "telemetry-prod",
      destination: "device-telemetry",
    },
  },
  {
    queue: "Event hub, Python receive (net.peer.name) vs ThrottledRequests",
    spanId: "eventhubs.python.receive",
    datapointId: "azure_monitor.eventhubs.throttledrequests",
    identity: {
      system: "eventhubs",
      brokerScope: "telemetry-prod",
      destination: "device-telemetry",
    },
  },
  {
    queue: "Event hub, JS receive (messaging.source.name) vs UserErrors",
    spanId: "eventhubs.js.receive",
    datapointId: "azure_monitor.eventhubs.usererrors",
    identity: {
      system: "eventhubs",
      brokerScope: "telemetry-prod",
      destination: "device-telemetry",
    },
  },
  {
    queue: "Event hub, .NET processor vs the Java SDK's consumer lag metric",
    spanId: "eventhubs.dotnet.activity-source.process",
    datapointId: "azure-sdk-java.eventhubs.consumer.lag",
    identity: {
      system: "eventhubs",
      brokerScope: "telemetry-prod",
      destination: "device-telemetry",
    },
  },
  {
    queue: "Pulsar topic, short-named producer vs a partition's backlog",
    spanId: "pulsar.java-agent.default.send.short-name",
    datapointId: "prometheus.pulsar_msg_backlog",
    identity: {
      system: "pulsar",
      brokerScope: "",
      destination: "persistent://public/default/payments",
    },
  },
  {
    queue: "Pulsar topic, partition consumer vs the split partition label",
    spanId: "pulsar.java-agent.default.process.partition",
    datapointId: "prometheus.pulsar_msg_backlog.split-partition-label",
    identity: {
      system: "pulsar",
      brokerScope: "",
      destination: "persistent://public/default/payments",
    },
  },
  {
    queue: "Pulsar topic, opt-in receive vs subscription backlog",
    spanId: "pulsar.java-agent.opt-in.receive",
    datapointId: "prometheus.pulsar_subscription_back_log",
    identity: {
      system: "pulsar",
      brokerScope: "",
      destination: "persistent://public/default/payments",
    },
  },
  {
    queue: "RocketMQ topic, Java agent consumer vs consumer lag",
    spanId: "rocketmq.java-agent.5.process",
    datapointId: "prometheus.rocketmq_consumer_lag_messages",
    identity: {
      system: "rocketmq",
      brokerScope: "",
      destination: "order-topic",
    },
  },
  {
    queue: "RocketMQ topic, Java agent producer vs messages in",
    spanId: "rocketmq.java-agent.4.send",
    datapointId: "prometheus.rocketmq_messages_in_total",
    identity: {
      system: "rocketmq",
      brokerScope: "",
      destination: "order-topic",
    },
  },
];

// ---- the same queue seen by a span and by its own client metrics ---------

/*
 * The Java agent records RabbitMQ client metrics in its opt-in mode only,
 * with the span's joined name but none of its routing key: each metric of
 * an operation must still key the queue its span does.
 */
const SPAN_AND_CLIENT_METRIC_PAIRS: ReadonlyArray<SameQueuePair> = [
  {
    queue:
      "RabbitMQ exchange, Java agent opt-in publish vs its operation duration",
    spanId: "rabbitmq.java-agent.opt-in.publish.exchange-and-routing-key",
    datapointId: "java-agent.opt-in.client.operation.duration.rabbitmq-publish",
    identity: {
      system: "rabbitmq",
      brokerScope: "",
      destination: "orders.topic",
    },
  },
  {
    queue: "RabbitMQ exchange, Java agent opt-in publish vs its sent messages",
    spanId: "rabbitmq.java-agent.opt-in.publish.exchange-and-routing-key",
    datapointId: "java-agent.opt-in.client.sent.messages.rabbitmq-publish",
    identity: {
      system: "rabbitmq",
      brokerScope: "",
      destination: "orders.topic",
    },
  },
  {
    queue:
      "RabbitMQ queue, Java agent opt-in delivery ('direct_logs:warning') vs its process duration",
    spanId: "rabbitmq.java-agent.opt-in.process.routing-key-is-queue",
    datapointId: "java-agent.opt-in.process.duration.rabbitmq-consumer",
    identity: { system: "rabbitmq", brokerScope: "", destination: "warning" },
  },
  {
    queue:
      "RabbitMQ queue, Java agent opt-in delivery from a fanout exchange vs its consumed messages",
    spanId: "rabbitmq.java-agent.opt-in.process.fanout-empty-routing-key",
    datapointId: "java-agent.opt-in.client.consumed.messages.rabbitmq-fanout",
    identity: {
      system: "rabbitmq",
      brokerScope: "",
      destination: "logs-audit",
    },
  },
];

// ---- helpers --------------------------------------------------------------

function getterOver(attributes: Attributes): AttributeGetter {
  return (key: string): unknown => {
    return Object.prototype.hasOwnProperty.call(attributes, key)
      ? attributes[key]
      : undefined;
  };
}

/*
 * The row the discovery cron reads back from ClickHouse: exactly `keys`,
 * each value as the Map(String, String) column holds it — a number or
 * boolean as its text, an array as its JSON — and a missing key as ''.
 */
function storedRow(
  attributes: Attributes,
  keys: ReadonlyArray<string>,
): Attributes {
  const row: Attributes = {};
  for (const key of keys) {
    const value: unknown = Object.prototype.hasOwnProperty.call(attributes, key)
      ? attributes[key]
      : undefined;
    if (typeof value === "string") {
      row[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      row[key] = String(value);
    } else if (Array.isArray(value)) {
      row[key] = JSON.stringify(value);
    } else {
      row[key] = "";
    }
  }
  return row;
}

function resolveSpanFixture(
  fixture: SpanFixture,
): ResolvedMessagingDestination | null {
  return resolveMessagingSpan({
    getAttribute: getterOver(fixture.attributes),
    kind: fixture.kind,
  });
}

function resolveDatapointFixture(
  fixture: DatapointFixture,
): ResolvedMessagingDestination | null {
  return resolveMessagingMetricDatapoint({
    metricName: fixture.metricName,
    getAttribute: getterOver(fixture.attributes),
  });
}

/*
 * What a resolution keys the queue by: its canonical identity, the row
 * identifier the discovery cron creates it under, and the entity key ingest
 * stamps on the span or datapoint.
 */
function queueKeysOf(
  resolved: ResolvedMessagingDestination | null,
): QueueKeys | null {
  const identity: MessageQueueIdentity | null = resolved
    ? toMessageQueueIdentity(resolved)
    : null;
  if (!identity) {
    return null;
  }
  return {
    identity,
    identifier: buildMessageQueueIdentifier(identity),
    entityKey: keyForMessageQueue(PROJECT_ID, identity),
  };
}

// The same, built from the expected identity by the documented formats.
function expectedQueueKeys(identity: MessageQueueIdentity): QueueKeys {
  return {
    identity,
    identifier: `${identity.system}|${identity.brokerScope}|${identity.destination}`,
    entityKey: keyForMessageQueue(PROJECT_ID, identity),
  };
}

function testName(fixture: { id: string; source: string }): string {
  return `${fixture.id} — ${fixture.source}`;
}

const SPAN_BY_ID: ReadonlyMap<string, SpanFixture> = new Map<
  string,
  SpanFixture
>(
  SPANS.map((fixture: SpanFixture): [string, SpanFixture] => {
    return [fixture.id, fixture];
  }),
);

const DATAPOINT_BY_ID: ReadonlyMap<string, DatapointFixture> = new Map<
  string,
  DatapointFixture
>(
  DATAPOINTS.map((fixture: DatapointFixture): [string, DatapointFixture] => {
    return [fixture.id, fixture];
  }),
);

// ---- tests ----------------------------------------------------------------

describe("the fixture corpus", () => {
  test("covers at least 60 fixtures, with unique ids", () => {
    expect(SPANS.length + DATAPOINTS.length).toBeGreaterThanOrEqual(60);
    expect(SPAN_BY_ID.size).toBe(SPANS.length);
    expect(DATAPOINT_BY_ID.size).toBe(DATAPOINTS.length);
  });

  test("every same-queue pair names a span and a datapoint that exist", () => {
    for (const pair of [...SAME_QUEUE_PAIRS, ...SPAN_AND_CLIENT_METRIC_PAIRS]) {
      expect(SPAN_BY_ID.has(pair.spanId)).toBe(true);
      expect(DATAPOINT_BY_ID.has(pair.datapointId)).toBe(true);
    }
  });

  test("every expected queue is one an identity can be built from", () => {
    const expectations: Array<ResolvedMessagingDestination> = [
      ...SPANS.map(
        (fixture: SpanFixture): ResolvedMessagingDestination | null => {
          return fixture.expected;
        },
      ),
      ...DATAPOINTS.map(
        (fixture: DatapointFixture): ResolvedMessagingDestination | null => {
          return fixture.expected;
        },
      ),
    ].filter(
      (
        expected: ResolvedMessagingDestination | null,
      ): expected is ResolvedMessagingDestination => {
        return expected !== null;
      },
    );
    for (const expected of expectations) {
      expect(toMessageQueueIdentity(expected)).not.toBeNull();
    }
  });
});

describe("messaging spans, attribute for attribute", () => {
  test.each(
    SPANS.map((fixture: SpanFixture): [string, SpanFixture] => {
      return [testName(fixture), fixture];
    }),
  )("%s", (_name: string, fixture: SpanFixture) => {
    expect(resolveSpanFixture(fixture)).toEqual(fixture.expected);
  });

  test.each(
    SPANS.map((fixture: SpanFixture): [string, SpanFixture] => {
      return [testName(fixture), fixture];
    }),
  )(
    "%s — resolves the same read back from ClickHouse",
    (_name: string, fixture: SpanFixture) => {
      /*
       * The discovery cron groups stored spans by exactly
       * MESSAGING_RESOLVER_INPUT_ATTRIBUTES and hands each row back to the
       * resolver: it must land where the ingest-time stamp did.
       */
      const row: Attributes = storedRow(
        fixture.attributes,
        MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
      );
      expect(
        resolveMessagingSpan({
          getAttribute: getterOver(row),
          kind: fixture.kind,
        }),
      ).toEqual(resolveSpanFixture(fixture));
    },
  );
});

describe("broker and client metric datapoints, in the stored shape", () => {
  test.each(
    DATAPOINTS.map((fixture: DatapointFixture): [string, DatapointFixture] => {
      return [testName(fixture), fixture];
    }),
  )("%s", (_name: string, fixture: DatapointFixture) => {
    expect(resolveDatapointFixture(fixture)).toEqual(fixture.expected);
  });

  test.each(
    DATAPOINTS.map((fixture: DatapointFixture): [string, DatapointFixture] => {
      return [testName(fixture), fixture];
    }),
  )(
    "%s — resolves the same read back from ClickHouse",
    (_name: string, fixture: DatapointFixture) => {
      const row: Attributes = storedRow(
        fixture.attributes,
        MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
      );
      expect(
        resolveMessagingMetricDatapoint({
          metricName: fixture.metricName,
          getAttribute: getterOver(row),
        }),
      ).toEqual(resolveDatapointFixture(fixture));
    },
  );
});

function pairCases(
  pairs: ReadonlyArray<SameQueuePair>,
): Array<[string, SameQueuePair]> {
  return pairs.map((pair: SameQueuePair): [string, SameQueuePair] => {
    return [`${pair.queue} (${pair.spanId} ↔ ${pair.datapointId})`, pair];
  });
}

// The pair's span and datapoint key the pair's queue, and so each other's.
function expectOneQueue(pair: SameQueuePair): void {
  const span: SpanFixture | undefined = SPAN_BY_ID.get(pair.spanId);
  const datapoint: DatapointFixture | undefined = DATAPOINT_BY_ID.get(
    pair.datapointId,
  );
  expect(span).toBeDefined();
  expect(datapoint).toBeDefined();
  if (!span || !datapoint) {
    return;
  }

  const fromSpan: QueueKeys | null = queueKeysOf(resolveSpanFixture(span));
  const fromDatapoint: QueueKeys | null = queueKeysOf(
    resolveDatapointFixture(datapoint),
  );
  const expected: QueueKeys = expectedQueueKeys(pair.identity);

  expect(fromSpan).toEqual(expected);
  expect(fromDatapoint).toEqual(expected);
  expect(fromSpan).toEqual(fromDatapoint);
}

describe("a span and a broker metric of the same queue share one identity and one entity key", () => {
  test.each(pairCases(SAME_QUEUE_PAIRS))(
    "%s",
    (_name: string, pair: SameQueuePair) => {
      expectOneQueue(pair);
    },
  );
});

describe("a span and the client metrics of its own operation share one identity and one entity key", () => {
  test.each(pairCases(SPAN_AND_CLIENT_METRIC_PAIRS))(
    "%s",
    (_name: string, pair: SameQueuePair) => {
      expectOneQueue(pair);
    },
  );
});
