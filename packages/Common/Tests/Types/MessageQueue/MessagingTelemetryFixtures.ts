import { ResolvedMessagingDestination } from "../../../Types/MessageQueue/MessagingTelemetryResolver";

/*
 * Real-world messaging telemetry, as each instrumentation emits it, with the
 * destination OneUptime must resolve from it. Spans are shaped after the
 * instrumentations' source (research: messaging-semconv.md) across the five
 * semconv generations; datapoints after the collector receivers' source and
 * live captures against real brokers (broker-metrics-*.md), in the STORED
 * flattened shape: datapoint attributes bare, resource attributes with the
 * `resource.` prefix. Shared by the resolver, metric-catalog and entity-key
 * suites, and by the input-attribute completeness and storage round-trip
 * checks, which run over every fixture here.
 */

export type FixtureAttributes = Record<string, unknown>;

export const PRODUCER: string = "SPAN_KIND_PRODUCER";
export const CONSUMER: string = "SPAN_KIND_CONSUMER";
export const CLIENT: string = "SPAN_KIND_CLIENT";
export const INTERNAL: string = "SPAN_KIND_INTERNAL";
export const SERVER: string = "SPAN_KIND_SERVER";

/*
 * Span kinds as a trace pipeline's Span Kind Remapper can store them. The
 * ingest service stores the SpanKind string, but the remapper writes its
 * mapping's kind as it is, and a configuration saved through the API is any
 * JSON — a NUMBER included. The stamper sees that value; ClickHouse keeps
 * its JSON text in the kind column (toStoredKind: 2 → "2"), which is what
 * the discovery cron reads back. OTLP numbers the kinds 1 INTERNAL,
 * 2 SERVER, 3 CLIENT, 4 PRODUCER and 5 CONSUMER. `reads` is the SpanKind
 * the value must read as — the value itself at ingest, and its stored text
 * in discovery, alike — or null for no kind at all.
 */
export interface NumericSpanKindCase {
  kind: number | string;
  reads: string | null;
}

export const NUMERIC_SPAN_KIND_CASES: ReadonlyArray<NumericSpanKindCase> = [
  // OTLP's numbers, as a number and as its text.
  { kind: 1, reads: INTERNAL },
  { kind: "1", reads: INTERNAL },
  { kind: 2, reads: SERVER },
  { kind: "2", reads: SERVER },
  { kind: 3, reads: CLIENT },
  { kind: "3", reads: CLIENT },
  { kind: 4, reads: PRODUCER },
  { kind: "4", reads: PRODUCER },
  { kind: 5, reads: CONSUMER },
  { kind: "5", reads: CONSUMER },
  /*
   * Digits read as Number() reads them: leading zeros and surrounding
   * whitespace count for nothing, so "02" is SERVER.
   */
  { kind: "02", reads: SERVER },
  { kind: " 2 ", reads: SERVER },
  { kind: "0005", reads: CONSUMER },
  // Numbers OTLP gives no kind (0 is SPAN_KIND_UNSPECIFIED).
  { kind: 0, reads: null },
  { kind: "0", reads: null },
  { kind: "00", reads: null },
  { kind: 6, reads: null },
  { kind: 9, reads: null },
  { kind: "9", reads: null },
  { kind: "12", reads: null },
  // Numeric, but not a plain run of digits: a name, and no kind's.
  { kind: -2, reads: null },
  { kind: "-2", reads: null },
  { kind: "+2", reads: null },
  { kind: 2.5, reads: null },
  { kind: "2.0", reads: null },
  { kind: "2e0", reads: null },
  { kind: 1e21, reads: null },
];

export interface SpanFixture {
  name: string;
  kind: string | null;
  attributes: FixtureAttributes;
  expected: ResolvedMessagingDestination | null;
}

export interface MetricFixture {
  name: string;
  metricName: string;
  attributes: FixtureAttributes;
  expected: ResolvedMessagingDestination | null;
}

// A resolution, with the fields a fixture does not state at their defaults.
export function destinationOf(
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

const SQS_QUEUE_URL: string =
  "https://sqs.us-east-1.amazonaws.com/123456789012/orders";
const SNS_TOPIC_ARN: string = "arn:aws:sns:us-east-1:123456789012:order-events";
const SERVICE_BUS_HOST: string = "orders-prod.servicebus.windows.net";
const EVENT_HUBS_HOST: string = "ingest-prod.servicebus.windows.net";

export const SPAN_FIXTURES: ReadonlyArray<SpanFixture> = [
  // ---- Apache Kafka ----------------------------------------------------------
  {
    name: "Java agent Kafka send (default mode, legacy semconv)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "orders",
      "messaging.operation": "publish",
      "messaging.destination.partition.id": "3",
      "messaging.client_id": "producer-1",
      "messaging.kafka.message.offset": 1042,
      "messaging.kafka.bootstrap.servers": ["kafka-1:9092", "kafka-2:9092"],
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    name: "Java agent Kafka process (default mode)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "orders",
      "messaging.operation": "process",
      "messaging.kafka.consumer.group": "billing",
      "messaging.kafka.message.offset": 1042,
      "messaging.destination.partition.id": "0",
      "messaging.client_id": "consumer-billing-1",
      "messaging.message.body.size": 128,
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "consume",
      consumerGroup: "billing",
    }),
  },
  {
    name: "Java agent Kafka receive of a batch spanning several topics (no destination)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.operation": "receive",
      "messaging.batch.message_count": 12,
      "messaging.kafka.consumer.group": "billing",
    },
    expected: null,
  },
  {
    name: "Java agent Kafka poll (messaging semconv opt-in)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "orders",
      "messaging.operation.type": "receive",
      "messaging.operation.name": "poll",
      "messaging.consumer.group.name": "billing",
      "messaging.client.id": "consumer-billing-1",
      "messaging.batch.message_count": 5,
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "consume",
      consumerGroup: "billing",
    }),
  },
  {
    name: "Java agent Kafka process (messaging semconv opt-in)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "orders",
      "messaging.operation.type": "process",
      "messaging.operation.name": "process",
      "messaging.consumer.group.name": "billing",
      "messaging.kafka.offset": 17,
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "consume",
      consumerGroup: "billing",
    }),
  },
  {
    name: "Confluent.Kafka .NET send (semconv 1.44)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "orders",
      "messaging.operation.type": "send",
      "messaging.operation.name": "send",
      "messaging.kafka.cluster.id": "lkc-7yq8z",
      "messaging.destination.partition.id": "1",
      "messaging.client.id": "rdkafka#producer-1",
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    name: "kafkajs 0.9+ process",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "orders",
      "messaging.operation.type": "process",
      "messaging.operation.name": "process",
      "messaging.kafka.cluster.id": "5L6g3nShT-eMCtK--X86sw",
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "consume",
    }),
  },
  {
    name: "kafkajs before 0.9 send (pre-1.17 key, no operation on producers)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination": "orders",
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    name: "kafka-python send (bootstrap servers as a JSON list in messaging.url)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination": "orders",
      "messaging.kafka.partition": 0,
      "messaging.url": '["kafka-1:9092", "kafka-2:9092"]',
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "publish",
      brokerAddress: "kafka-1:9092",
    }),
  },
  {
    name: "confluent-kafka (Python) produce up to v0.62b1: operation 'receive' on a PRODUCER span",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination": "orders",
      "messaging.destination_kind": "queue",
      "messaging.operation": "receive",
      "messaging.kafka.partition": 2,
      "server.address": "kafka-1",
      "server.port": 9092,
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "publish",
      brokerAddress: "kafka-1:9092",
    }),
  },
  {
    name: "confluent-kafka (Python) process",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination": "orders",
      "messaging.operation": "process",
      "messaging.message.id": "orders.2.1042",
      "server.address": "kafka-1",
      "server.port": "9092",
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "consume",
      brokerAddress: "kafka-1:9092",
    }),
  },
  {
    name: "aiokafka send (bootstrap servers as a JSON list in server.address)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "orders",
      "messaging.operation.name": "send",
      "messaging.operation.type": "publish",
      "server.address": '["broker-1:9092", "broker-2:9092"]',
      "messaging.client.id": "aiokafka-1",
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "publish",
      brokerAddress: "broker-1:9092",
    }),
  },
  {
    name: "otelsarama (Go, semconv 1.17) publish",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "orders",
      "messaging.destination.kind": "topic",
      "messaging.operation": "publish",
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "publish",
    }),
  },

  // ---- RabbitMQ --------------------------------------------------------------
  {
    name: "Java agent RabbitMQ publish to a named exchange (default mode names the exchange)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "orders-exchange",
      "messaging.rabbitmq.destination.routing_key": "order.created",
      "messaging.operation": "publish",
      "network.peer.address": "10.0.0.7",
      "network.peer.port": 5672,
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "orders-exchange",
      direction: "publish",
      brokerAddress: "10.0.0.7:5672",
    }),
  },
  {
    name: "Java agent RabbitMQ publish to the default exchange (<default> + routing key)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "<default>",
      "messaging.rabbitmq.destination.routing_key": "work-queue",
      "messaging.operation": "publish",
      "network.peer.address": "10.0.0.7",
      "network.peer.port": 5672,
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "work-queue",
      direction: "publish",
      brokerAddress: "10.0.0.7:5672",
    }),
  },
  {
    name: "Java agent RabbitMQ process from a default-exchange queue",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "<default>",
      "messaging.rabbitmq.destination.routing_key": "work-queue",
      "messaging.operation": "process",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "work-queue",
      direction: "consume",
    }),
  },
  {
    name: "Java agent RabbitMQ receive from a server-named queue (amq.gen-)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "<default>",
      "messaging.rabbitmq.destination.routing_key":
        "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
      "messaging.operation": "receive",
    },
    expected: null,
  },
  {
    name: "Java agent RabbitMQ queue.declare (a method span carrying only the system)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "rabbitmq",
      "network.peer.address": "10.0.0.7",
      "network.peer.port": 5672,
    },
    expected: null,
  },
  {
    name: "Java agent RabbitMQ publish (opt-in): {exchange}:{routing key}",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "direct_logs:warning",
      "messaging.rabbitmq.destination.routing_key": "warning",
      "messaging.operation.type": "send",
      "messaging.operation.name": "publish",
      "server.address": "rabbit.prod",
      "server.port": 5672,
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "direct_logs",
      direction: "publish",
      brokerAddress: "rabbit.prod:5672",
    }),
  },
  {
    name: "Java agent RabbitMQ process (opt-in): {exchange}:{routing key}:{queue}",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "direct_logs:warning:warning_queue",
      "messaging.rabbitmq.destination.routing_key": "warning",
      "messaging.operation.type": "process",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "warning_queue",
      direction: "consume",
    }),
  },
  {
    name: "RabbitMQ publish to the default exchange with no routing key (amq.default alone)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "amq.default",
      "messaging.operation.type": "send",
    },
    expected: null,
  },
  {
    name: "Java agent RabbitMQ anonymous queue (opt-in flag)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "logs:info:amq.gen-8c2dWmkGJZ4-vS3a5oSaGQ",
      "messaging.rabbitmq.destination.routing_key": "info",
      "messaging.destination.anonymous": true,
    },
    expected: null,
  },
  {
    name: "JS amqplib publish to the default exchange ('' exchange, routing key is the queue)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination": "",
      "messaging.destination_kind": "topic",
      "messaging.rabbitmq.routing_key": "task_queue",
      "messaging.protocol": "AMQP",
      "messaging.protocol_version": "0.9.1",
      "messaging.url": "amqp://guest:***@localhost:5672",
      "server.address": "localhost",
      "server.port": 5672,
      "messaging.message_id": "b7e6f1c2",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "task_queue",
      direction: "publish",
      brokerAddress: "localhost:5672",
    }),
  },
  {
    name: "JS amqplib consume from a named exchange (address from the censored URL)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination": "logs",
      "messaging.rabbitmq.routing_key": "info",
      "messaging.operation": "process",
      "messaging.url": "amqp://user:***@rabbit.internal:5672/prod",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "logs",
      direction: "consume",
      brokerAddress: "rabbit.internal:5672",
    }),
  },
  {
    name: "JS amqplib up to 0.55 (net.peer.* keys)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination": "events",
      "messaging.rabbitmq.routing_key": "user.signup",
      "net.peer.name": "rabbit.internal",
      "net.peer.port": 5672,
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "events",
      direction: "publish",
      brokerAddress: "rabbit.internal:5672",
    }),
  },
  {
    name: "Python pika publish (messaging.temp_destination is set on EVERY publish: not trusted)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.temp_destination": true,
      "messaging.destination": "orders",
      "net.peer.name": "rabbit.prod",
      "net.peer.port": 5672,
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "orders",
      direction: "publish",
      brokerAddress: "rabbit.prod:5672",
    }),
  },
  {
    name: "Python pika consume",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination": "orders",
      "messaging.operation": "receive",
      "messaging.message_id": "7f3c",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "orders",
      direction: "consume",
    }),
  },
  {
    name: "aio-pika publish ({exchange},{routing key}, comma-joined)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination": "orders,order.created",
      "messaging.temp_destination": true,
      "net.peer.name": "rabbit.prod",
      "net.peer.port": 5672,
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "orders",
      direction: "publish",
      brokerAddress: "rabbit.prod:5672",
    }),
  },
  {
    name: "aio-pika publish to the default exchange (',{routing key}')",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination": ",task_queue",
      "messaging.temp_destination": true,
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "task_queue",
      direction: "publish",
    }),
  },
  {
    name: ".NET RabbitMQ.Client v7 publish through the default exchange (amq.default)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "amq.default",
      "messaging.rabbitmq.destination.routing_key": "orders",
      "messaging.operation.type": "send",
      "server.address": "rabbit.prod",
      "server.port": 5672,
      "network.protocol.name": "amqp",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "orders",
      direction: "publish",
      brokerAddress: "rabbit.prod:5672",
    }),
  },
  {
    name: ".NET RabbitMQ.Client direct reply-to",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "amq.default",
      "messaging.rabbitmq.destination.routing_key":
        "amq.rabbitmq.reply-to.g1h2AA5yZXBseS10bw==",
      "messaging.operation.type": "send",
    },
    expected: null,
  },
  {
    name: "Spring Cloud Stream anonymous group queue (opt-in)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name":
        "orders:#:orders.anonymous.X8o1yfRBQXSp5Bdd09ls7w",
      "messaging.rabbitmq.destination.routing_key": "#",
      "messaging.operation.type": "process",
    },
    expected: null,
  },
  {
    name: "Spring AMQP UUID-named queue on the default exchange",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "<default>",
      "messaging.rabbitmq.destination.routing_key":
        "3f6a5b2c-1d4e-4f5a-8b6c-7d8e9f0a1b2c",
    },
    expected: null,
  },
  {
    name: "Spring Rabbit (default mode) names the routing key",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "order.created",
      "messaging.operation": "process",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "order.created",
      direction: "consume",
    }),
  },
  {
    name: "An exchange named with a colon (MassTransit style), which the routing key contradicts",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "Contracts:OrderSubmitted",
      "messaging.rabbitmq.destination.routing_key": "order.submitted",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "Contracts:OrderSubmitted",
      direction: "publish",
    }),
  },
  {
    /*
     * Semconv 1.30 consumer name: the queue equals the routing key, so it
     * is left out (RabbitInstrumenterHelper.consumerDestinationName).
     */
    name: "Java agent RabbitMQ process (opt-in): {exchange}:{routing key} when the routing key is the queue",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "direct_logs:warning",
      "messaging.rabbitmq.destination.routing_key": "warning",
      "messaging.operation.type": "process",
      "messaging.operation.name": "process",
      "messaging.rabbitmq.message.delivery_tag": 7,
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "warning",
      direction: "consume",
    }),
  },
  {
    /*
     * A fanout exchange's routing key is empty: left out of the name, and
     * no routing-key attribute (RabbitDeliveryExtraAttributesExtractor sets
     * it only when non-empty).
     */
    name: "Java agent RabbitMQ process (opt-in) from a fanout exchange: {exchange}:{queue}",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "logs:logs-audit",
      "messaging.operation.type": "process",
      "messaging.operation.name": "process",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "logs-audit",
      direction: "consume",
    }),
  },
  {
    name: "Java agent RabbitMQ basic.ack (opt-in): the consumer's {exchange}:{routing key}",
    kind: CLIENT,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "direct_logs:warning",
      "messaging.rabbitmq.destination.routing_key": "warning",
      "messaging.operation.type": "settle",
      "messaging.operation.name": "ack",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "warning",
      direction: "settle",
    }),
  },
  {
    /*
     * MassTransit's own send span (LogContextActivityExtensions
     * .StartSendActivity): the exchange of the message type
     * (`Namespace:Type`, RabbitMqMessageNameFormatter) and the legacy
     * operation key; a publish's routing key is empty, so it is not tagged.
     */
    name: "MassTransit publish to a message-type exchange (Namespace:Type, no routing key)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.operation": "send",
      "messaging.destination.name": "MyApp.Contracts:OrderSubmitted",
      "messaging.message.id": "0b3a0000-5d3e-0015-5c5b-08dd4f1e6b1c",
      "messaging.masstransit.message_types":
        "urn:message:MyApp.Contracts:OrderSubmitted",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "MyApp.Contracts:OrderSubmitted",
      direction: "publish",
    }),
  },
  {
    name: "MassTransit publish of another message type from the same namespace (its own exchange)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.operation": "send",
      "messaging.destination.name": "MyApp.Contracts:OrderCancelled",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "MyApp.Contracts:OrderCancelled",
      direction: "publish",
    }),
  },
  {
    /*
     * MassTransit's receive span (StartReceiveActivity) names its endpoint's
     * queue but no messaging.system: nothing says which broker it is.
     */
    name: "MassTransit receive span (the endpoint queue, but no messaging.system)",
    kind: CONSUMER,
    attributes: {
      "messaging.operation": "receive",
      "messaging.destination.name": "submit-order",
      "messaging.masstransit.input_address":
        "rabbitmq://rabbit.prod/submit-order",
    },
    expected: null,
  },
  {
    /*
     * RabbitMQ.Client for .NET v7 (PopulateMessagingTags) names the exchange
     * alone and always tags the routing key, here empty.
     */
    name: ".NET RabbitMQ.Client v7 publish to a MassTransit exchange (the exchange alone, empty routing key)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "network.protocol.name": "amqp",
      "network.protocol.version": "0.9.1",
      "messaging.operation.type": "send",
      "messaging.operation.name": "publish",
      "messaging.destination.name": "MyApp.Contracts:OrderSubmitted",
      "messaging.rabbitmq.destination.routing_key": "",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "MyApp.Contracts:OrderSubmitted",
      direction: "publish",
    }),
  },
  {
    name: ".NET RabbitMQ.Client v7 deliver from a MassTransit exchange (the exchange alone, not {exchange}:{queue})",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "network.protocol.name": "amqp",
      "network.protocol.version": "0.9.1",
      "messaging.operation.type": "process",
      "messaging.operation.name": "deliver",
      "messaging.destination.name": "MyApp.Contracts:OrderSubmitted",
      "messaging.rabbitmq.destination.routing_key": "",
      "messaging.rabbitmq.delivery_tag": 5,
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "MyApp.Contracts:OrderSubmitted",
      direction: "consume",
    }),
  },
  {
    // The Java agent's default mode names the exchange alone, colon and all.
    name: "Java agent RabbitMQ process (default mode) from a MassTransit exchange (no routing key)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.operation": "process",
      "messaging.destination.name": "MyApp.Contracts:OrderSubmitted",
      "network.peer.address": "10.0.0.7",
      "network.peer.port": 5672,
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "MyApp.Contracts:OrderSubmitted",
      direction: "consume",
      brokerAddress: "10.0.0.7:5672",
    }),
  },
  {
    /*
     * RabbitMqMessageNameFormatter writes a generic type's argument after
     * "--" in its own `Namespace:Type`: the Fault<T> MassTransit publishes on
     * a consumer fault goes to an exchange with two colons, still one name.
     */
    name: "MassTransit publish of a Fault<T> (a generic type's exchange: two colons, no routing key)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.operation": "send",
      "messaging.destination.name":
        "MassTransit:Fault--MyApp.Contracts:OrderSubmitted--",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "MassTransit:Fault--MyApp.Contracts:OrderSubmitted--",
      direction: "publish",
    }),
  },
  {
    name: ".NET RabbitMQ.Client v7 deliver from a MassTransit Fault<T> exchange (the exchange alone)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "network.protocol.name": "amqp",
      "network.protocol.version": "0.9.1",
      "messaging.operation.type": "process",
      "messaging.operation.name": "deliver",
      "messaging.destination.name":
        "MassTransit:Fault--MyApp.Contracts:OrderSubmitted--",
      "messaging.rabbitmq.destination.routing_key": "",
      "messaging.rabbitmq.delivery_tag": 11,
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "MassTransit:Fault--MyApp.Contracts:OrderSubmitted--",
      direction: "consume",
    }),
  },
  {
    /*
     * Semconv 1.30 on a consumer of an exchange named with a colon: the
     * empty routing key is left out, and no routing-key attribute is set.
     */
    name: "Java agent RabbitMQ process (opt-in) from a MassTransit exchange: Namespace:Type:{queue}",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name":
        "MyApp.Contracts:OrderSubmitted:billing-order-submitted",
      "messaging.operation.type": "process",
      "messaging.operation.name": "process",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "billing-order-submitted",
      direction: "consume",
    }),
  },
  {
    /*
     * A responder answering a MassTransit request client: the response goes
     * to the requester's bus endpoint, one per process
     * (`{machine}_{process}_bus_{NewId}`).
     */
    name: ".NET RabbitMQ.Client v7 publish of a response to a MassTransit bus endpoint (one per process)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "rabbitmq",
      "network.protocol.name": "amqp",
      "network.protocol.version": "0.9.1",
      "messaging.operation.type": "send",
      "messaging.operation.name": "publish",
      "messaging.destination.name":
        "ordersapi7d9f8c6b5xk2lq_OrdersApi_bus_kd4oyqbeynuojexybdxt7414fx",
      "messaging.rabbitmq.destination.routing_key": "",
    },
    expected: null,
  },

  // ---- JMS / Apache ActiveMQ -------------------------------------------------
  {
    name: "Java agent JMS send to a queue",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "jms",
      "messaging.destination.name": "orders.queue",
      "messaging.operation": "publish",
      "messaging.message.id": "ID:app-1-38221-1727698123456-1:1:1:1:1",
      "messaging.message.conversation_id": "c-17",
    },
    expected: destinationOf({
      system: "jms",
      destination: "orders.queue",
      direction: "publish",
    }),
  },
  {
    name: "Java agent JMS temporary queue ((temporary) + flag)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "jms",
      "messaging.destination.name": "(temporary)",
      "messaging.destination.temporary": true,
      "messaging.operation": "receive",
    },
    expected: null,
  },
  {
    name: "TIBCO temporary destination ($TMP$ prefix)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "jms",
      "messaging.destination.name": "$TMP$.EMS-SERVER.1F2C5E7A.1",
    },
    expected: null,
  },
  {
    name: "ActiveMQ advisory topic",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "jms",
      "messaging.destination.name": "ActiveMQ.Advisory.Connection",
    },
    expected: null,
  },
  {
    name: "ActiveMQ destination printed with its queue:// prefix",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "activemq",
      "messaging.destination.name": "queue://orders",
    },
    expected: destinationOf({
      system: "activemq",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    name: "ActiveMQ destination printed with its topic:// prefix",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "activemq",
      "messaging.destination.name": "TOPIC://prices",
    },
    expected: destinationOf({
      system: "activemq",
      destination: "prices",
      direction: "consume",
    }),
  },
  {
    name: "ActiveMQ shared dead-letter queue",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "activemq",
      "messaging.destination.name": "ActiveMQ.DLQ",
      "messaging.operation": "receive",
    },
    expected: destinationOf({
      system: "activemq",
      destination: "ActiveMQ.DLQ",
      direction: "consume",
      isDeadLetter: true,
    }),
  },
  {
    name: "ActiveMQ individual dead-letter queue (DLQ. prefix) over JMS",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "jms",
      "messaging.destination.name": "DLQ.orders",
    },
    expected: destinationOf({
      system: "jms",
      destination: "DLQ.orders",
      direction: "consume",
      isDeadLetter: true,
    }),
  },
  {
    name: "JMS temporary queue as ActiveMQ prints it (temp-queue://)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "jms",
      "messaging.destination.name":
        "temp-queue://ID:app-1-38221-1727698123456-1:1:1",
    },
    expected: null,
  },
  {
    name: "ActiveMQ Artemis spelling",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "artemis",
      "messaging.destination.name": "orders",
    },
    expected: destinationOf({
      system: "activemq",
      destination: "orders",
      direction: "publish",
    }),
  },

  // ---- Amazon SQS ------------------------------------------------------------
  {
    name: "Java agent SQS send up to 2.3.0 (AmazonSQS)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "AmazonSQS",
      "messaging.destination.name": "orders",
      "aws.sqs.queue.url": SQS_QUEUE_URL,
      "messaging.operation": "publish",
      "rpc.system": "aws-api",
      "rpc.service": "Sqs",
      "rpc.method": "SendMessage",
      "server.address": "sqs.us-east-1.amazonaws.com",
      "server.port": 443,
      "messaging.message.id": "5fea7756-0ea4-451a-a703-a558b933e274",
    },
    expected: destinationOf({
      system: "aws_sqs",
      destination: "orders",
      direction: "publish",
      brokerAddress: "sqs.us-east-1.amazonaws.com:443",
    }),
  },
  {
    name: "Java agent SQS receive from 2.4.0 (aws_sqs)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "aws_sqs",
      "messaging.destination.name": "orders",
      "aws.sqs.queue.url": SQS_QUEUE_URL,
      "messaging.operation": "receive",
      "rpc.system": "aws-api",
      "rpc.service": "Sqs",
      "rpc.method": "ReceiveMessage",
    },
    expected: destinationOf({
      system: "aws_sqs",
      destination: "orders",
      direction: "consume",
    }),
  },
  {
    name: "Java agent Lambda SQS event, legacy mode (destination aws:sqs)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "aws_sqs",
      "messaging.destination.name": "aws:sqs",
      "messaging.operation": "process",
    },
    expected: null,
  },
  {
    name: "JS aws-sdk SQS send up to 0.57.0 (aws.sqs)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "aws.sqs",
      "messaging.destination.name": "orders",
      "url.full": SQS_QUEUE_URL,
      "rpc.system": "aws-api",
      "rpc.service": "SQS",
      "rpc.method": "SendMessage",
    },
    expected: destinationOf({
      system: "aws_sqs",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    name: "Python boto3sqs receive (queue URL in messaging.url)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "aws.sqs",
      "messaging.destination": "orders",
      "messaging.destination_kind": "queue",
      "messaging.url":
        "https://sqs.eu-west-1.amazonaws.com/123456789012/orders",
      "messaging.operation": "receive",
    },
    expected: destinationOf({
      system: "aws_sqs",
      destination: "orders",
      direction: "consume",
      brokerAddress: "sqs.eu-west-1.amazonaws.com",
    }),
  },
  {
    name: "Python botocore SQS SendMessage (a CLIENT span: direction from rpc.method)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "aws.sqs",
      "messaging.url": SQS_QUEUE_URL,
      "messaging.destination": "orders",
      "aws.queue_url": SQS_QUEUE_URL,
      "rpc.system": "aws-api",
      "rpc.service": "SQS",
      "rpc.method": "SendMessage",
    },
    expected: destinationOf({
      system: "aws_sqs",
      destination: "orders",
      direction: "publish",
      brokerAddress: "sqs.us-east-1.amazonaws.com",
    }),
  },
  {
    name: "Go otelaws v0.62+ SendMessage (queue URL in server.address, no destination key)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "aws_sqs",
      "server.address":
        "https://sqs.us-west-2.amazonaws.com/123456789012/payments",
      "rpc.system": "aws-api",
      "rpc.service": "SQS",
      "rpc.method": "SQS/SendMessage",
    },
    expected: destinationOf({
      system: "aws_sqs",
      destination: "payments",
      direction: "publish",
      brokerAddress: "sqs.us-west-2.amazonaws.com",
    }),
  },
  {
    name: "Go otelaws up to v0.61 ReceiveMessage (AmazonSQS, queue URL in net.peer.name)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "AmazonSQS",
      "net.peer.name":
        "https://sqs.us-west-2.amazonaws.com/123456789012/payments",
      "rpc.system": "aws-api",
      "rpc.service": "SQS",
      "rpc.method": "SQS/ReceiveMessage",
    },
    expected: destinationOf({
      system: "aws_sqs",
      destination: "payments",
      direction: "consume",
      brokerAddress: "sqs.us-west-2.amazonaws.com",
    }),
  },
  {
    name: "Go otelaws DeleteMessage settles",
    kind: CLIENT,
    attributes: {
      "messaging.system": "aws_sqs",
      "server.address":
        "https://sqs.us-west-2.amazonaws.com/123456789012/payments",
      "rpc.system": "aws-api",
      "rpc.service": "SQS",
      "rpc.method": "SQS/DeleteMessage",
    },
    expected: destinationOf({
      system: "aws_sqs",
      destination: "payments",
      direction: "settle",
      brokerAddress: "sqs.us-west-2.amazonaws.com",
    }),
  },
  {
    name: "Go otelaws ListQueues (a URL without a queue)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "aws_sqs",
      "server.address": "https://sqs.us-west-2.amazonaws.com",
      "rpc.system": "aws-api",
      "rpc.service": "SQS",
      "rpc.method": "SQS/ListQueues",
    },
    expected: null,
  },
  {
    name: ".NET AWS instrumentation, legacy mode (no messaging.system, aws.queue_url)",
    kind: CLIENT,
    attributes: {
      "aws.queue_url": SQS_QUEUE_URL,
      "rpc.system": "aws-api",
      "rpc.service": "SQS",
      "rpc.method": "ReceiveMessage",
    },
    expected: destinationOf({
      system: "aws_sqs",
      destination: "orders",
      direction: "consume",
    }),
  },
  {
    name: ".NET AWS instrumentation, semconv 1.40 mode",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "aws_sqs",
      "messaging.destination.name": "orders",
      "messaging.operation.type": "send",
    },
    expected: destinationOf({
      system: "aws_sqs",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    name: "SQS FIFO queue",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "aws_sqs",
      "messaging.destination.name": "orders.fifo",
    },
    expected: destinationOf({
      system: "aws_sqs",
      destination: "orders.fifo",
      direction: "publish",
    }),
  },
  {
    name: "SQS queue ARN as the destination",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "aws_sqs",
      "messaging.destination.name":
        "arn:aws:sqs:us-east-2:123456789012:my-queue",
    },
    expected: destinationOf({
      system: "aws_sqs",
      destination: "my-queue",
      direction: "consume",
    }),
  },

  // ---- Amazon SNS ------------------------------------------------------------
  {
    name: "Java agent SNS Publish (an RPC span with no messaging.system)",
    kind: CLIENT,
    attributes: {
      "rpc.system": "aws-api",
      "rpc.service": "Sns",
      "rpc.method": "Publish",
      "messaging.destination.name": SNS_TOPIC_ARN,
      "aws.sns.topic.arn": SNS_TOPIC_ARN,
    },
    expected: destinationOf({
      system: "aws.sns",
      destination: "order-events",
      direction: "publish",
    }),
  },
  {
    name: "Java agent SNS with only the topic ARN key",
    kind: CLIENT,
    attributes: {
      "rpc.system": "aws-api",
      "rpc.service": "Sns",
      "rpc.method": "Publish",
      "aws.sns.topic.arn": "arn:aws:sns:eu-west-1:123456789012:alerts",
    },
    expected: destinationOf({
      system: "aws.sns",
      destination: "alerts",
      direction: "publish",
    }),
  },
  {
    name: "JS aws-sdk SNS Publish (full ARN in messaging.destination.name)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "aws.sns",
      "messaging.destination": "order-events",
      "messaging.destination.name": SNS_TOPIC_ARN,
      "aws.sns.topic.arn": SNS_TOPIC_ARN,
    },
    expected: destinationOf({
      system: "aws.sns",
      destination: "order-events",
      direction: "publish",
    }),
  },
  {
    name: "JS aws-sdk SNS Publish without a topic ARN ('unknown')",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "aws.sns",
      "messaging.destination": "unknown",
      "messaging.destination.name": "unknown",
    },
    expected: null,
  },
  {
    name: "SNS SMS publish to a phone number",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "aws.sns",
      "messaging.destination.name": "+15555550100",
    },
    expected: null,
  },
  {
    name: "Python botocore SNS SMS publish (phone_number:**)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "aws.sns",
      "messaging.destination": "phone_number:**",
      "messaging.destination.name": "phone_number:**",
    },
    expected: null,
  },
  {
    name: "Go otelaws SNS Publish (aws_sns, short topic name)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "aws_sns",
      "messaging.destination.name": "order-events",
      "messaging.operation.type": "send",
      "messaging.operation.name": "publish_input",
      "rpc.method": "SNS/Publish",
    },
    expected: destinationOf({
      system: "aws.sns",
      destination: "order-events",
      direction: "publish",
    }),
  },
  {
    name: "SNS mobile push to a platform endpoint (one per device, not a topic)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "aws.sns",
      "messaging.destination.name":
        "arn:aws:sns:us-east-1:123456789012:endpoint/APNS/my-app/5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d",
    },
    expected: null,
  },

  // ---- Google Cloud Pub/Sub ----------------------------------------------------
  {
    name: "Pub/Sub Node publisher create span",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "orders",
      "gcp.project_id": "acme-prod",
      "messaging.operation": "create",
    },
    expected: destinationOf({
      system: "gcp_pubsub",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    name: "Pub/Sub Java publish (a CLIENT span)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "orders",
      "messaging.operation": "publish",
    },
    expected: destinationOf({
      system: "gcp_pubsub",
      destination: "orders",
      direction: "publish",
    }),
  },
  {
    name: "Pub/Sub Node subscriber: the destination is the subscription",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "billing-sub",
      "messaging.operation": "subscribe",
      "gcp.project_id": "acme-prod",
    },
    expected: destinationOf({
      system: "gcp_pubsub",
      destination: "billing-sub",
      direction: "consume",
      consumerGroup: "billing-sub",
    }),
  },
  {
    name: "Pub/Sub ack (a CLIENT settle span on the subscription)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "billing-sub",
      "messaging.operation.name": "ack",
    },
    expected: destinationOf({
      system: "gcp_pubsub",
      destination: "billing-sub",
      direction: "settle",
      consumerGroup: "billing-sub",
    }),
  },
  {
    name: "Pub/Sub Go subscribe (an INTERNAL span)",
    kind: INTERNAL,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "billing-sub",
      "messaging.operation.name": "subscribe",
      "gcp.resource.name":
        "//pubsub.googleapis.com/projects/acme-prod/subscriptions/billing-sub",
    },
    expected: destinationOf({
      system: "gcp_pubsub",
      destination: "billing-sub",
      direction: "consume",
      consumerGroup: "billing-sub",
    }),
  },
  {
    name: "Pub/Sub full resource name as the destination",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "projects/acme-prod/topics/orders",
    },
    expected: destinationOf({
      system: "gcp_pubsub",
      destination: "orders",
      direction: "publish",
    }),
  },

  // ---- Azure Service Bus -------------------------------------------------------
  {
    name: ".NET Service Bus send (ActivitySource mode)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.operation": "publish",
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "orders",
      "az.namespace": "Microsoft.ServiceBus",
      "messaging.batch.message_count": 3,
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "publish",
    }),
  },
  {
    name: ".NET Service Bus per-message PRODUCER span",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "servicebus",
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "orders",
      "az.namespace": "Microsoft.ServiceBus",
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "publish",
    }),
  },
  {
    name: ".NET Service Bus receive from a topic subscription (entity path)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.operation": "receive",
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "order-events/Subscriptions/billing",
      "az.namespace": "Microsoft.ServiceBus",
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "order-events",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "consume",
      consumerGroup: "billing",
    }),
  },
  {
    name: ".NET Service Bus dead-letter receive (/$DeadLetterQueue)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.operation": "receive",
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "orders/$DeadLetterQueue",
      "az.namespace": "Microsoft.ServiceBus",
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "consume",
      isDeadLetter: true,
    }),
  },
  {
    name: ".NET Service Bus subscription dead-letter queue",
    kind: CLIENT,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.operation": "receive",
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name":
        "order-events/Subscriptions/billing/$DeadLetterQueue",
      "az.namespace": "Microsoft.ServiceBus",
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "order-events",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "consume",
      consumerGroup: "billing",
      isDeadLetter: true,
    }),
  },
  {
    name: ".NET Service Bus transfer dead-letter queue",
    kind: CLIENT,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.operation": "receive",
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "orders/$Transfer/$DeadLetterQueue",
      "az.namespace": "Microsoft.ServiceBus",
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "consume",
      isDeadLetter: true,
    }),
  },
  {
    name: ".NET ServiceBusProcessor.ProcessMessage",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.operation": "process",
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "orders",
      "az.namespace": "Microsoft.ServiceBus",
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "consume",
    }),
  },
  {
    name: ".NET ServiceBusReceiver.Complete (settle)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.operation": "settle",
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "orders",
      "az.namespace": "Microsoft.ServiceBus",
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "settle",
    }),
  },
  {
    name: ".NET Service Bus, legacy DiagnosticSource mode (component, peer.address, message_bus.destination)",
    kind: CLIENT,
    attributes: {
      component: "servicebus",
      "peer.address": `sb://${SERVICE_BUS_HOST}/`,
      "message_bus.destination": "orders",
      "az.namespace": "Microsoft.ServiceBus",
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
    }),
  },
  {
    name: "Azure legacy mode with only the component as the system",
    kind: PRODUCER,
    attributes: {
      component: "eventhubs",
      "message_bus.destination": "telemetry",
      "peer.address": `sb://${EVENT_HUBS_HOST}/`,
    },
    expected: destinationOf({
      system: "eventhubs",
      destination: "telemetry",
      brokerScope: "ingest-prod",
      brokerAddress: EVENT_HUBS_HOST,
      direction: "publish",
    }),
  },
  {
    name: "Azure component without its legacy companions is no evidence",
    kind: CLIENT,
    attributes: {
      component: "servicebus",
      "messaging.destination.name": "orders",
    },
    expected: null,
  },
  {
    name: "Java Service Bus receive (lowercase subscriptions, both namespace keys)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.operation": "receive",
      "messaging.destination.name": "order-events/subscriptions/billing",
      "server.address": SERVICE_BUS_HOST,
      "az.namespace": "Microsoft.ServiceBus",
      "azure.resource_provider.namespace": "Microsoft.ServiceBus",
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "order-events",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "consume",
      consumerGroup: "billing",
    }),
  },
  {
    name: "Java Service Bus dead-letter queue (/$deadletterqueue)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.operation": "receive",
      "messaging.destination.name": "orders/$deadletterqueue",
      "server.address": SERVICE_BUS_HOST,
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "consume",
      isDeadLetter: true,
    }),
  },
  {
    name: "JS Service Bus receive (messaging.source.name, net.peer.name)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.operation": "receive",
      "messaging.source.name": "order-events/Subscriptions/billing",
      "net.peer.name": SERVICE_BUS_HOST,
      "az.namespace": "Microsoft.ServiceBus",
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "order-events",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "consume",
      consumerGroup: "billing",
    }),
  },
  {
    name: "Python Service Bus publish (legacy keys only)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "servicebus",
      "az.namespace": "Microsoft.ServiceBus",
      "messaging.operation": "publish",
      "message_bus.destination": "orders",
      "peer.address": SERVICE_BUS_HOST,
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "publish",
    }),
  },
  {
    name: "Service Bus in the US Government cloud",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.destination.name": "orders",
      "server.address": "orders-gov.servicebus.usgovcloudapi.net",
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-gov",
      brokerAddress: "orders-gov.servicebus.usgovcloudapi.net",
      direction: "publish",
    }),
  },
  {
    name: "Service Bus in the China cloud",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.destination.name": "orders",
      "server.address": "orders-cn.servicebus.chinacloudapi.cn",
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-cn",
      brokerAddress: "orders-cn.servicebus.chinacloudapi.cn",
      direction: "publish",
    }),
  },
  {
    name: "Service Bus emulator (no namespace host)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.destination.name": "orders",
      "server.address": "localhost",
      "server.port": 5672,
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerAddress: "localhost:5672",
      direction: "publish",
    }),
  },
  {
    name: "Semconv 1.24 azure_servicebus spelling",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "azure_servicebus",
      "messaging.destination.name": "orders",
      "server.address": SERVICE_BUS_HOST,
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "publish",
    }),
  },
  {
    name: "A malformed messaging.system falls through to the Azure namespace",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "Azure Service Bus",
      "az.namespace": "Microsoft.ServiceBus",
      "messaging.destination.name": "orders",
      "server.address": SERVICE_BUS_HOST,
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "publish",
    }),
  },
  {
    name: "Azure Storage SDK span (az.namespace, but not messaging)",
    kind: CLIENT,
    attributes: {
      "az.namespace": "Microsoft.Storage",
      "http.request.method": "PUT",
      "url.full": "https://acct.blob.core.windows.net/c/b?sig=abc",
      "server.address": "acct.blob.core.windows.net",
    },
    expected: null,
  },

  // ---- Azure Event Hubs / Event Grid -------------------------------------------
  {
    name: ".NET Event Hubs send",
    kind: CLIENT,
    attributes: {
      "messaging.system": "eventhubs",
      "messaging.operation": "publish",
      "messaging.destination.name": "telemetry",
      "server.address": EVENT_HUBS_HOST,
      "az.namespace": "Microsoft.EventHub",
    },
    expected: destinationOf({
      system: "eventhubs",
      destination: "telemetry",
      brokerScope: "ingest-prod",
      brokerAddress: EVENT_HUBS_HOST,
      direction: "publish",
    }),
  },
  {
    name: "Java Event Hubs process with a consumer group",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "eventhubs",
      "messaging.operation.type": "process",
      "messaging.operation.name": "process",
      "messaging.destination.name": "telemetry",
      "messaging.consumer.group.name": "$Default",
      "messaging.destination.partition.id": "3",
      "server.address": EVENT_HUBS_HOST,
    },
    expected: destinationOf({
      system: "eventhubs",
      destination: "telemetry",
      brokerScope: "ingest-prod",
      brokerAddress: EVENT_HUBS_HOST,
      direction: "consume",
      consumerGroup: "$Default",
    }),
  },
  {
    name: "Java Event Hubs send with the deprecated 'publish' operation type",
    kind: CLIENT,
    attributes: {
      "messaging.system": "eventhubs",
      "messaging.operation.type": "publish",
      "messaging.operation.name": "send",
      "messaging.destination.name": "telemetry",
      "server.address": EVENT_HUBS_HOST,
    },
    expected: destinationOf({
      system: "eventhubs",
      destination: "telemetry",
      brokerScope: "ingest-prod",
      brokerAddress: EVENT_HUBS_HOST,
      direction: "publish",
    }),
  },
  {
    name: "Java Event Hubs checkpoint (settle)",
    kind: CLIENT,
    attributes: {
      "messaging.system": "eventhubs",
      "messaging.operation.type": "settle",
      "messaging.operation.name": "checkpoint",
      "messaging.destination.name": "telemetry",
      "messaging.consumer.group.name": "$Default",
      "server.address": EVENT_HUBS_HOST,
    },
    expected: destinationOf({
      system: "eventhubs",
      destination: "telemetry",
      brokerScope: "ingest-prod",
      brokerAddress: EVENT_HUBS_HOST,
      direction: "settle",
      consumerGroup: "$Default",
    }),
  },
  {
    name: "Event Hubs receiver entity path with a consumer group and partition",
    kind: CLIENT,
    attributes: {
      "messaging.system": "eventhubs",
      "messaging.operation": "receive",
      "messaging.destination.name":
        "telemetry/ConsumerGroups/$Default/Partitions/0",
      "server.address": EVENT_HUBS_HOST,
    },
    expected: destinationOf({
      system: "eventhubs",
      destination: "telemetry",
      brokerScope: "ingest-prod",
      brokerAddress: EVENT_HUBS_HOST,
      direction: "consume",
      consumerGroup: "$Default",
    }),
  },
  {
    name: "Kafka clients talking to Event Hubs report kafka (no namespace scope)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "telemetry",
      "server.address": EVENT_HUBS_HOST,
      "server.port": 9093,
    },
    expected: destinationOf({
      system: "kafka",
      destination: "telemetry",
      brokerAddress: `${EVENT_HUBS_HOST}:9093`,
      direction: "publish",
    }),
  },
  {
    name: "Event Grid publish (no namespace in its identity)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "eventgrid",
      "messaging.destination.name": "orders-topic",
      "server.address": "orders-topic.westeurope-1.eventgrid.azure.net",
    },
    expected: destinationOf({
      system: "eventgrid",
      destination: "orders-topic",
      brokerAddress: "orders-topic.westeurope-1.eventgrid.azure.net",
      direction: "publish",
    }),
  },

  // ---- Apache Pulsar -----------------------------------------------------------
  {
    name: "Java agent Pulsar send to a partition (default mode)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "pulsar",
      "messaging.destination.name":
        "persistent://public/default/payments-partition-1",
      "messaging.operation": "publish",
      "server.address": "pulsar-broker-0",
      "server.port": 6650,
    },
    expected: destinationOf({
      system: "pulsar",
      destination: "persistent://public/default/payments",
      direction: "publish",
      brokerAddress: "pulsar-broker-0:6650",
    }),
  },
  {
    name: "Pulsar short topic name (the default tenant and namespace)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "pulsar",
      "messaging.destination.name": "orders",
      "messaging.operation": "process",
    },
    expected: destinationOf({
      system: "pulsar",
      destination: "persistent://public/default/orders",
      direction: "consume",
    }),
  },
  {
    name: "Pulsar tenant/namespace/topic without a domain",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "pulsar",
      "messaging.destination.name": "acme/billing/invoices",
    },
    expected: destinationOf({
      system: "pulsar",
      destination: "persistent://acme/billing/invoices",
      direction: "publish",
    }),
  },
  {
    name: "Java agent Pulsar receive (opt-in) with a subscription",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "pulsar",
      "messaging.destination.name": "persistent://acme/billing/invoices",
      "messaging.destination.subscription.name": "ledger",
      "messaging.destination.partition.id": "2",
      "messaging.operation.type": "process",
    },
    expected: destinationOf({
      system: "pulsar",
      destination: "persistent://acme/billing/invoices",
      direction: "consume",
      consumerGroup: "ledger",
    }),
  },
  {
    name: "Pulsar non-persistent partition",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "pulsar",
      "messaging.destination.name":
        "non-persistent://public/default/ticks-partition-0",
    },
    expected: destinationOf({
      system: "pulsar",
      destination: "non-persistent://public/default/ticks",
      direction: "publish",
    }),
  },
  {
    name: "Pulsar system topic (__change_events)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "pulsar",
      "messaging.destination.name":
        "persistent://public/default/__change_events",
    },
    expected: null,
  },
  {
    name: "Pulsar transaction system topic (short name)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "pulsar",
      "messaging.destination.name": "__transaction_buffer_snapshot",
    },
    expected: null,
  },

  // ---- Apache RocketMQ ---------------------------------------------------------
  {
    name: "Java agent RocketMQ process (legacy consumer group key)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rocketmq",
      "messaging.destination.name": "orders",
      "messaging.rocketmq.client_group": "billing-group",
      "messaging.operation": "process",
      "messaging.rocketmq.broker_address": "10.0.0.9:10911",
      "messaging.rocketmq.queue_id": 3,
      "messaging.rocketmq.queue_offset": 77,
    },
    expected: destinationOf({
      system: "rocketmq",
      destination: "orders",
      direction: "consume",
      consumerGroup: "billing-group",
    }),
  },
  {
    name: "RocketMQ opt-in consumer group",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rocketmq",
      "messaging.destination.name": "orders",
      "messaging.consumer.group.name": "billing-group",
      "messaging.operation.type": "process",
    },
    expected: destinationOf({
      system: "rocketmq",
      destination: "orders",
      direction: "consume",
      consumerGroup: "billing-group",
    }),
  },
  {
    name: "RocketMQ dead-letter topic (%DLQ%<group>)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "rocketmq",
      "messaging.destination.name": "%DLQ%billing-group",
    },
    expected: destinationOf({
      system: "rocketmq",
      destination: "%DLQ%billing-group",
      direction: "consume",
      isDeadLetter: true,
    }),
  },

  // ---- NATS --------------------------------------------------------------------
  {
    name: "Java agent NATS publish",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "nats",
      "messaging.destination.name": "orders.created",
      "messaging.operation": "publish",
    },
    expected: destinationOf({
      system: "nats",
      destination: "orders.created",
      direction: "publish",
    }),
  },
  {
    name: "NATS request inbox (template, name and temporary flag)",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "nats",
      "messaging.destination.template": "_INBOX.",
      "messaging.destination.name": "_INBOX.k3qTbUQ4AkVZe9L1u8A1rd",
      "messaging.destination.temporary": true,
    },
    expected: null,
  },
  {
    name: "NATS inbox template without the flag",
    kind: CONSUMER,
    attributes: {
      "messaging.system": "nats",
      "messaging.destination.template": "_INBOX.",
    },
    expected: null,
  },
  {
    name: "JetStream acknowledgement subject",
    kind: CLIENT,
    attributes: {
      "messaging.system": "nats",
      "messaging.destination.template": "$JS.ACK",
      "messaging.destination.name":
        "$JS.ACK.ORDERS.billing.1.42.42.1727698123456789012.0",
    },
    expected: null,
  },
  {
    name: "NATS subject template wins over the concrete subject",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "nats",
      "messaging.destination.template": "orders.{id}",
      "messaging.destination.name": "orders.42",
    },
    expected: destinationOf({
      system: "nats",
      destination: "orders.{id}",
      direction: "publish",
    }),
  },
  {
    name: "JetStream spelling",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "jetstream",
      "messaging.destination.name": "ORDERS.new",
    },
    expected: destinationOf({
      system: "nats",
      destination: "ORDERS.new",
      direction: "publish",
    }),
  },

  // ---- BullMQ and the long tail ------------------------------------------------
  {
    name: "OneUptime's own BullMQ worker job span",
    kind: INTERNAL,
    attributes: {
      "messaging.system": "bullmq",
      "messaging.destination.name": "Workers",
      "messaging.operation.name": "ProcessMonitorEvaluation",
    },
    expected: destinationOf({
      system: "bullmq",
      destination: "Workers",
    }),
  },
  {
    name: "A long-tail broker the catalog does not know (IBM MQ)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "ibmmq",
      "messaging.destination.name": "DEV.QUEUE.1",
      "server.address": "mq.prod",
      "server.port": 1414,
    },
    expected: destinationOf({
      system: "ibmmq",
      destination: "DEV.QUEUE.1",
      direction: "publish",
      brokerAddress: "mq.prod:1414",
    }),
  },

  // ---- never a queue -------------------------------------------------------------
  {
    name: "Celery sets no messaging.system (its broker is unknown)",
    kind: PRODUCER,
    attributes: {
      "messaging.destination": "celery",
      "celery.action": "apply_async",
      "celery.task_name": "tasks.add",
      "messaging.message.id": "e3b0c442-98fc-4c14-9afb-f4c8996fb924",
    },
    expected: null,
  },
  {
    name: "Spring Integration channel (in-process, opt-in)",
    kind: PRODUCER,
    attributes: {
      "messaging.system": "spring_integration",
      "messaging.destination.name": "inputChannel",
    },
    expected: null,
  },
  {
    name: "An HTTP client span",
    kind: CLIENT,
    attributes: {
      "http.request.method": "GET",
      "server.address": "api.example.com",
      "server.port": 443,
    },
    expected: null,
  },
];

// ---- datapoints --------------------------------------------------------------------

const KAFKA_RESOURCE: FixtureAttributes = {
  "resource.kafka.cluster.alias": "prod-kafka",
  "resource.kafka.cluster.id": "5L6g3nShT-eMCtK--X86sw",
};

const RABBITMQ_RESOURCE: FixtureAttributes = {
  "resource.rabbitmq.node.name": "rabbit@16c76f2d8aa2",
  "resource.rabbitmq.queue.name": "orders",
  "resource.rabbitmq.vhost.name": "/",
};

const JMX_SCRAPER_RESOURCE: FixtureAttributes = {
  "resource.service.name": "activemq-prod",
  "resource.service.instance.id": "174b52e6-c976-3dfd-8e52-bfb13115009a",
  "resource.telemetry.sdk.language": "java",
};

const ACTIVEMQ_DESTINATION: FixtureAttributes = {
  ...JMX_SCRAPER_RESOURCE,
  "activemq.broker.name": "localhost",
  "activemq.destination.type": "queue",
  "messaging.destination.name": "orders",
};

const ACTIVEMQ_LEGACY_DESTINATION: FixtureAttributes = {
  ...JMX_SCRAPER_RESOURCE,
  broker: "localhost",
  destination: "orders",
};

const AZURE_SUBSCRIPTION_RESOURCE: FixtureAttributes = {
  "resource.azuremonitor.subscription_id":
    "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b",
  "resource.azuremonitor.tenant_id": "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b",
};

const SERVICE_BUS_ENTITY: FixtureAttributes = {
  ...AZURE_SUBSCRIPTION_RESOURCE,
  "azuremonitor.resource_id":
    "/subscriptions/7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.ServiceBus/namespaces/orders-prod",
  name: "orders-prod",
  type: "Microsoft.ServiceBus/Namespaces",
  resource_group: "rg-prod",
  location: "westeurope",
  metadata_entityname: "orders",
};

const EVENT_HUBS_ENTITY: FixtureAttributes = {
  ...AZURE_SUBSCRIPTION_RESOURCE,
  "azuremonitor.resource_id":
    "/subscriptions/7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.EventHub/namespaces/ingest-prod",
  name: "ingest-prod",
  type: "Microsoft.EventHub/namespaces",
  resource_group: "rg-prod",
  location: "westeurope",
  metadata_entityname: "telemetry",
};

const CLOUDWATCH_OTEL_RESOURCE: FixtureAttributes = {
  "resource.cloud.provider": "aws",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "us-east-1",
  "resource.aws.exporter.arn":
    "arn:aws:cloudwatch:us-east-1:123456789012:metric-stream/oneuptime",
};

function cloudWatchJsonResource(service: string): FixtureAttributes {
  return {
    "resource.cloud.provider": "aws",
    "resource.cloud.account.id": "123456789012",
    "resource.cloud.region": "us-east-1",
    "resource.service.namespace": "AWS",
    "resource.service.name": service,
    "resource.aws.cloudwatch.metric_stream_name": "oneuptime",
  };
}

const PUBSUB_SUBSCRIPTION_RESOURCE: FixtureAttributes = {
  "resource.gcp.resource_type": "pubsub_subscription",
  "resource.project_id": "acme-prod",
  "resource.subscription_id": "billing-sub",
};

const PUBSUB_TOPIC_RESOURCE: FixtureAttributes = {
  "resource.gcp.resource_type": "pubsub_topic",
  "resource.project_id": "acme-prod",
  "resource.topic_id": "orders",
};

const PULSAR_SCRAPE: FixtureAttributes = {
  "resource.server.address": "pulsar-broker-0",
  "resource.server.port": "8080",
  "resource.service.instance.id": "pulsar-broker-0:8080",
  "resource.service.name": "pulsar-broker",
  "resource.url.scheme": "http",
  cluster: "standalone",
  namespace: "public/default",
  topic: "persistent://public/default/payments-partition-1",
};

const ROCKETMQ_SCRAPE: FixtureAttributes = {
  "resource.server.address": "rocketmq-broker-a",
  "resource.server.port": "5557",
  "resource.service.instance.id": "rocketmq-broker-a:5557",
  "resource.service.name": "rocketmq-broker",
  cluster: "DefaultCluster",
  node_type: "broker",
  node_id: "broker-a",
  topic: "orders",
  is_system: "false",
};

const KAFKA_PAYMENTS: ResolvedMessagingDestination = destinationOf({
  system: "kafka",
  destination: "payments",
});

const RABBITMQ_ORDERS: ResolvedMessagingDestination = destinationOf({
  system: "rabbitmq",
  destination: "orders",
});

const ACTIVEMQ_ORDERS: ResolvedMessagingDestination = destinationOf({
  system: "activemq",
  destination: "orders",
});

const SERVICE_BUS_ORDERS: ResolvedMessagingDestination = destinationOf({
  system: "servicebus",
  destination: "orders",
  brokerScope: "orders-prod",
});

const EVENT_HUBS_TELEMETRY: ResolvedMessagingDestination = destinationOf({
  system: "eventhubs",
  destination: "telemetry",
  brokerScope: "ingest-prod",
});

const SQS_ORDERS: ResolvedMessagingDestination = destinationOf({
  system: "aws_sqs",
  destination: "orders",
});

const SNS_ORDER_EVENTS: ResolvedMessagingDestination = destinationOf({
  system: "aws.sns",
  destination: "order-events",
});

const PUBSUB_BILLING_SUB: ResolvedMessagingDestination = destinationOf({
  system: "gcp_pubsub",
  destination: "billing-sub",
});

const PULSAR_PAYMENTS: ResolvedMessagingDestination = destinationOf({
  system: "pulsar",
  destination: "persistent://public/default/payments",
  brokerAddress: "pulsar-broker-0:8080",
});

const ROCKETMQ_ORDERS: ResolvedMessagingDestination = destinationOf({
  system: "rocketmq",
  destination: "orders",
  brokerAddress: "rocketmq-broker-a:5557",
});

function withDirection(
  resolved: ResolvedMessagingDestination,
  direction: ResolvedMessagingDestination["direction"],
): ResolvedMessagingDestination {
  return { ...resolved, direction };
}

function sqsFixtures(data: {
  cloudWatchName: string;
  direction: ResolvedMessagingDestination["direction"];
}): Array<MetricFixture> {
  const lower: string = data.cloudWatchName.toLowerCase();
  return [
    {
      name: `CloudWatch ${data.cloudWatchName} (aws_cloudwatch / Metric Stream OpenTelemetry 1.0)`,
      metricName: `amazonaws.com/aws/sqs/${lower}`,
      attributes: {
        ...CLOUDWATCH_OTEL_RESOURCE,
        Namespace: "AWS/SQS",
        MetricName: data.cloudWatchName,
        "Dimensions.QueueName": "orders",
      },
      expected: withDirection(SQS_ORDERS, data.direction),
    },
    {
      name: `CloudWatch ${data.cloudWatchName} (Metric Stream JSON)`,
      metricName: lower,
      attributes: {
        ...cloudWatchJsonResource("SQS"),
        QueueName: "orders",
      },
      expected: withDirection(SQS_ORDERS, data.direction),
    },
  ];
}

function snsFixtures(data: {
  cloudWatchName: string;
  direction: ResolvedMessagingDestination["direction"];
}): Array<MetricFixture> {
  const lower: string = data.cloudWatchName.toLowerCase();
  return [
    {
      name: `CloudWatch ${data.cloudWatchName} (aws_cloudwatch / Metric Stream OpenTelemetry 1.0)`,
      metricName: `amazonaws.com/aws/sns/${lower}`,
      attributes: {
        ...CLOUDWATCH_OTEL_RESOURCE,
        Namespace: "AWS/SNS",
        MetricName: data.cloudWatchName,
        "Dimensions.TopicName": "order-events",
      },
      expected: withDirection(SNS_ORDER_EVENTS, data.direction),
    },
    {
      name: `CloudWatch ${data.cloudWatchName} (Metric Stream JSON)`,
      metricName: lower,
      attributes: {
        ...cloudWatchJsonResource("SNS"),
        TopicName: "order-events",
      },
      expected: withDirection(SNS_ORDER_EVENTS, data.direction),
    },
  ];
}

/*
 * One realistic stored datapoint for every curated broker metric (the
 * catalog suite checks none is missing), plus the variants each source
 * really produces.
 */
export const METRIC_FIXTURES: ReadonlyArray<MetricFixture> = [
  // Apache Kafka — kafka_metrics (live capture against Kafka 4.1.0).
  {
    name: "kafka_metrics consumer-group lag, summed over partitions",
    metricName: "kafka.consumer_group.lag_sum",
    attributes: { ...KAFKA_RESOURCE, group: "billing", topic: "payments" },
    expected: KAFKA_PAYMENTS,
  },
  {
    name: "kafka_metrics per-partition lag (partition is an int)",
    metricName: "kafka.consumer_group.lag",
    attributes: { group: "billing", topic: "payments", partition: 0 },
    expected: KAFKA_PAYMENTS,
  },
  {
    name: "kafka_metrics committed offsets, summed over partitions",
    metricName: "kafka.consumer_group.offset_sum",
    attributes: { ...KAFKA_RESOURCE, group: "billing", topic: "payments" },
    expected: withDirection(KAFKA_PAYMENTS, "consume"),
  },
  {
    name: "kafka_metrics log-end offset",
    metricName: "kafka.partition.current_offset",
    attributes: { ...KAFKA_RESOURCE, topic: "payments", partition: 2 },
    expected: withDirection(KAFKA_PAYMENTS, "publish"),
  },

  // RabbitMQ — rabbitmq receiver (live capture against RabbitMQ 4.3.6).
  {
    name: "rabbitmq queue depth, ready series",
    metricName: "rabbitmq.message.current",
    attributes: { ...RABBITMQ_RESOURCE, state: "ready" },
    expected: RABBITMQ_ORDERS,
  },
  {
    name: "rabbitmq queue depth, unacknowledged series",
    metricName: "rabbitmq.message.current",
    attributes: { ...RABBITMQ_RESOURCE, state: "unacknowledged" },
    expected: RABBITMQ_ORDERS,
  },
  {
    name: "rabbitmq published",
    metricName: "rabbitmq.message.published",
    attributes: { ...RABBITMQ_RESOURCE },
    expected: withDirection(RABBITMQ_ORDERS, "publish"),
  },
  {
    name: "rabbitmq delivered",
    metricName: "rabbitmq.message.delivered",
    attributes: { ...RABBITMQ_RESOURCE },
    expected: withDirection(RABBITMQ_ORDERS, "consume"),
  },
  {
    name: "rabbitmq acknowledged",
    metricName: "rabbitmq.message.acknowledged",
    attributes: { ...RABBITMQ_RESOURCE },
    expected: withDirection(RABBITMQ_ORDERS, "consume"),
  },
  {
    name: "rabbitmq dropped",
    metricName: "rabbitmq.message.dropped",
    attributes: { ...RABBITMQ_RESOURCE },
    expected: RABBITMQ_ORDERS,
  },
  {
    name: "rabbitmq consumers",
    metricName: "rabbitmq.consumer.count",
    attributes: { ...RABBITMQ_RESOURCE },
    expected: RABBITMQ_ORDERS,
  },
  {
    // The receiver lists every queue: a bus endpoint per MassTransit process.
    name: "rabbitmq queue depth of a MassTransit bus endpoint (one per process)",
    metricName: "rabbitmq.message.current",
    attributes: {
      ...RABBITMQ_RESOURCE,
      "resource.rabbitmq.queue.name":
        "ordersapi7d9f8c6b5xk2lq_OrdersApi_bus_kd4oyqbeynuojexybdxt7414fx",
      state: "ready",
    },
    expected: null,
  },

  // Apache ActiveMQ — JMX Scraper (live capture against ActiveMQ Classic 6.2.0).
  {
    name: "JMX Scraper queue size (1.53+ names)",
    metricName: "activemq.message.queue.size",
    attributes: { ...ACTIVEMQ_DESTINATION },
    expected: ACTIVEMQ_ORDERS,
  },
  {
    name: "JMX Scraper queue size (legacy names)",
    metricName: "activemq.message.current",
    attributes: { ...ACTIVEMQ_LEGACY_DESTINATION },
    expected: ACTIVEMQ_ORDERS,
  },
  {
    name: "JMX Scraper enqueued (1.53+ names)",
    metricName: "activemq.message.enqueued",
    attributes: { ...ACTIVEMQ_DESTINATION },
    expected: withDirection(ACTIVEMQ_ORDERS, "publish"),
  },
  {
    name: "JMX Scraper enqueued (legacy names)",
    metricName: "activemq.message.enqueued",
    attributes: { ...ACTIVEMQ_LEGACY_DESTINATION },
    expected: withDirection(ACTIVEMQ_ORDERS, "publish"),
  },
  {
    name: "JMX Scraper dequeued (1.53+ names)",
    metricName: "activemq.message.dequeued",
    attributes: { ...ACTIVEMQ_DESTINATION },
    expected: withDirection(ACTIVEMQ_ORDERS, "consume"),
  },
  {
    name: "JMX Scraper dequeued (legacy names)",
    metricName: "activemq.message.dequeued",
    attributes: { ...ACTIVEMQ_LEGACY_DESTINATION },
    expected: withDirection(ACTIVEMQ_ORDERS, "consume"),
  },
  {
    name: "JMX Scraper expired (1.53+ names)",
    metricName: "activemq.message.expired",
    attributes: { ...ACTIVEMQ_DESTINATION },
    expected: ACTIVEMQ_ORDERS,
  },
  {
    name: "JMX Scraper expired (legacy names)",
    metricName: "activemq.message.expired",
    attributes: { ...ACTIVEMQ_LEGACY_DESTINATION },
    expected: ACTIVEMQ_ORDERS,
  },
  {
    name: "JMX Scraper consumers (1.53+ names)",
    metricName: "activemq.consumer.count",
    attributes: { ...ACTIVEMQ_DESTINATION },
    expected: ACTIVEMQ_ORDERS,
  },
  {
    name: "JMX Scraper consumers (legacy names)",
    metricName: "activemq.consumer.count",
    attributes: { ...ACTIVEMQ_LEGACY_DESTINATION },
    expected: ACTIVEMQ_ORDERS,
  },
  {
    name: "JMX Scraper average time in queue (1.53+ names, seconds)",
    metricName: "activemq.message.enqueue.average_duration",
    attributes: { ...ACTIVEMQ_DESTINATION },
    expected: ACTIVEMQ_ORDERS,
  },
  {
    name: "JMX Scraper average time in queue (legacy names, ms)",
    metricName: "activemq.message.wait_time.avg",
    attributes: { ...ACTIVEMQ_LEGACY_DESTINATION },
    expected: ACTIVEMQ_ORDERS,
  },

  // Azure Service Bus — azure_monitor.
  {
    name: "Azure Monitor ActiveMessages",
    metricName: "azure_activemessages_average",
    attributes: { ...SERVICE_BUS_ENTITY },
    expected: SERVICE_BUS_ORDERS,
  },
  {
    name: "Azure Monitor DeadletteredMessages",
    metricName: "azure_deadletteredmessages_average",
    attributes: { ...SERVICE_BUS_ENTITY },
    expected: SERVICE_BUS_ORDERS,
  },
  {
    name: "Azure Monitor IncomingMessages (Service Bus)",
    metricName: "azure_incomingmessages_total",
    attributes: { ...SERVICE_BUS_ENTITY },
    expected: withDirection(SERVICE_BUS_ORDERS, "publish"),
  },
  {
    name: "Azure Monitor OutgoingMessages (Service Bus)",
    metricName: "azure_outgoingmessages_total",
    attributes: { ...SERVICE_BUS_ENTITY },
    expected: withDirection(SERVICE_BUS_ORDERS, "consume"),
  },
  {
    name: "Azure Monitor CompleteMessage",
    metricName: "azure_completemessage_total",
    attributes: { ...SERVICE_BUS_ENTITY },
    expected: withDirection(SERVICE_BUS_ORDERS, "consume"),
  },
  {
    name: "Azure Monitor AbandonMessage",
    metricName: "azure_abandonmessage_total",
    attributes: { ...SERVICE_BUS_ENTITY },
    expected: SERVICE_BUS_ORDERS,
  },
  {
    name: "Azure Monitor ServerErrors (Service Bus)",
    metricName: "azure_servererrors_total",
    attributes: {
      ...SERVICE_BUS_ENTITY,
      metadata_operationresult: "serverbusy",
    },
    expected: SERVICE_BUS_ORDERS,
  },
  {
    name: "Azure Monitor UserErrors (Service Bus)",
    metricName: "azure_usererrors_total",
    attributes: {
      ...SERVICE_BUS_ENTITY,
      metadata_operationresult: "clienterror",
    },
    expected: SERVICE_BUS_ORDERS,
  },
  {
    name: "Azure Monitor ThrottledRequests (Service Bus)",
    metricName: "azure_throttledrequests_total",
    attributes: {
      ...SERVICE_BUS_ENTITY,
      metadata_operationresult: "serverbusy",
      metadata_messagingerrorsubcode: "CPU",
    },
    expected: SERVICE_BUS_ORDERS,
  },
  {
    name: "Azure Monitor ActiveMessages of a MassTransit bus endpoint (one per process)",
    metricName: "azure_activemessages_average",
    attributes: {
      ...SERVICE_BUS_ENTITY,
      metadata_entityname:
        "billingworker02_BillingWorker_bus_7d4yysgeydaos4hybdxt76a6rx",
    },
    expected: null,
  },

  // Azure Event Hubs — azure_monitor.
  {
    name: "Azure Monitor IncomingMessages (Event Hubs)",
    metricName: "azure_incomingmessages_total",
    attributes: { ...EVENT_HUBS_ENTITY },
    expected: withDirection(EVENT_HUBS_TELEMETRY, "publish"),
  },
  {
    name: "Azure Monitor OutgoingMessages (Event Hubs)",
    metricName: "azure_outgoingmessages_total",
    attributes: { ...EVENT_HUBS_ENTITY },
    expected: withDirection(EVENT_HUBS_TELEMETRY, "consume"),
  },
  {
    name: "Azure Monitor ServerErrors (Event Hubs)",
    metricName: "azure_servererrors_total",
    attributes: {
      ...EVENT_HUBS_ENTITY,
      metadata_operationresult: "serverbusy",
    },
    expected: EVENT_HUBS_TELEMETRY,
  },
  {
    name: "Azure Monitor UserErrors (Event Hubs)",
    metricName: "azure_usererrors_total",
    attributes: {
      ...EVENT_HUBS_ENTITY,
      metadata_operationresult: "clienterror",
    },
    expected: EVENT_HUBS_TELEMETRY,
  },
  {
    name: "Azure Monitor QuotaExceededErrors (Event Hubs)",
    metricName: "azure_quotaexceedederrors_total",
    attributes: {
      ...EVENT_HUBS_ENTITY,
      metadata_operationresult: "quotaexceeded",
    },
    expected: EVENT_HUBS_TELEMETRY,
  },
  {
    name: "Azure Monitor ThrottledRequests (Event Hubs)",
    metricName: "azure_throttledrequests_total",
    attributes: {
      ...EVENT_HUBS_ENTITY,
      metadata_operationresult: "serverbusy",
    },
    expected: EVENT_HUBS_TELEMETRY,
  },

  // Amazon SQS — both CloudWatch shapes.
  ...sqsFixtures({
    cloudWatchName: "ApproximateNumberOfMessagesVisible",
    direction: "unknown",
  }),
  ...sqsFixtures({
    cloudWatchName: "ApproximateAgeOfOldestMessage",
    direction: "unknown",
  }),
  ...sqsFixtures({
    cloudWatchName: "ApproximateNumberOfMessagesNotVisible",
    direction: "unknown",
  }),
  ...sqsFixtures({
    cloudWatchName: "NumberOfMessagesSent",
    direction: "publish",
  }),
  ...sqsFixtures({
    cloudWatchName: "NumberOfMessagesReceived",
    direction: "consume",
  }),
  ...sqsFixtures({
    cloudWatchName: "NumberOfMessagesDeleted",
    direction: "consume",
  }),
  {
    name: "CloudWatch ApproximateNumberOfMessagesVisible of a MassTransit bus endpoint (one per process)",
    metricName: "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
    attributes: {
      ...CLOUDWATCH_OTEL_RESOURCE,
      Namespace: "AWS/SQS",
      MetricName: "ApproximateNumberOfMessagesVisible",
      "Dimensions.QueueName":
        "ip10012034euwe_ContosoBillingWorker_bus_68pobtdryda85beybdxt68ffbx",
    },
    expected: null,
  },

  // Amazon SNS — both CloudWatch shapes.
  ...snsFixtures({
    cloudWatchName: "NumberOfMessagesPublished",
    direction: "publish",
  }),
  ...snsFixtures({
    cloudWatchName: "NumberOfNotificationsDelivered",
    direction: "consume",
  }),
  ...snsFixtures({
    cloudWatchName: "NumberOfNotificationsFailed",
    direction: "unknown",
  }),
  ...snsFixtures({
    cloudWatchName: "NumberOfNotificationsRedrivenToDlq",
    direction: "unknown",
  }),

  // Google Cloud Pub/Sub — googlecloudmonitoring.
  {
    name: "Pub/Sub undelivered messages",
    metricName: "pubsub.googleapis.com/subscription/num_undelivered_messages",
    attributes: { ...PUBSUB_SUBSCRIPTION_RESOURCE },
    expected: PUBSUB_BILLING_SUB,
  },
  {
    name: "Pub/Sub oldest unacked message age",
    metricName: "pubsub.googleapis.com/subscription/oldest_unacked_message_age",
    attributes: { ...PUBSUB_SUBSCRIPTION_RESOURCE },
    expected: PUBSUB_BILLING_SUB,
  },
  {
    name: "Pub/Sub dead-lettered messages (collector 0.137+: label on the datapoint)",
    metricName: "pubsub.googleapis.com/subscription/dead_letter_message_count",
    attributes: { ...PUBSUB_SUBSCRIPTION_RESOURCE, response_code: "success" },
    expected: PUBSUB_BILLING_SUB,
  },
  {
    name: "Pub/Sub dead-lettered messages (collector 0.116-0.136: label on the resource)",
    metricName: "pubsub.googleapis.com/subscription/dead_letter_message_count",
    attributes: {
      ...PUBSUB_SUBSCRIPTION_RESOURCE,
      "resource.response_code": "success",
    },
    expected: PUBSUB_BILLING_SUB,
  },
  {
    name: "Pub/Sub acknowledged messages",
    metricName: "pubsub.googleapis.com/subscription/ack_message_count",
    attributes: { ...PUBSUB_SUBSCRIPTION_RESOURCE, delivery_type: "pull" },
    expected: withDirection(PUBSUB_BILLING_SUB, "consume"),
  },
  {
    name: "Pub/Sub publish requests (on the topic)",
    metricName: "pubsub.googleapis.com/topic/send_request_count",
    attributes: {
      ...PUBSUB_TOPIC_RESOURCE,
      response_class: "success",
      response_code: "success",
    },
    expected: destinationOf({
      system: "gcp_pubsub",
      destination: "orders",
      direction: "publish",
    }),
  },

  // Apache Pulsar — prometheus scrape of the broker (live capture, Pulsar 4.2.4).
  {
    name: "Pulsar topic backlog (a partition)",
    metricName: "pulsar_msg_backlog",
    attributes: { ...PULSAR_SCRAPE },
    expected: PULSAR_PAYMENTS,
  },
  {
    name: "Pulsar subscription backlog",
    metricName: "pulsar_subscription_back_log",
    attributes: { ...PULSAR_SCRAPE, subscription: "ledger" },
    expected: PULSAR_PAYMENTS,
  },
  {
    name: "Pulsar backlog age",
    metricName: "pulsar_storage_backlog_age_seconds",
    attributes: { ...PULSAR_SCRAPE },
    expected: PULSAR_PAYMENTS,
  },
  {
    name: "Pulsar messages in",
    metricName: "pulsar_in_messages_total",
    attributes: { ...PULSAR_SCRAPE },
    expected: withDirection(PULSAR_PAYMENTS, "publish"),
  },
  {
    name: "Pulsar messages out",
    metricName: "pulsar_out_messages_total",
    attributes: { ...PULSAR_SCRAPE, subscription: "ledger" },
    expected: withDirection(PULSAR_PAYMENTS, "consume"),
  },

  // Apache RocketMQ — prometheus scrape (metricsExporterType=PROM).
  {
    name: "RocketMQ consumer lag",
    metricName: "rocketmq_consumer_lag_messages",
    attributes: {
      ...ROCKETMQ_SCRAPE,
      consumer_group: "billing-group",
      is_retry: "false",
    },
    expected: ROCKETMQ_ORDERS,
  },
  {
    name: "RocketMQ ready messages",
    metricName: "rocketmq_consumer_ready_messages",
    attributes: {
      ...ROCKETMQ_SCRAPE,
      consumer_group: "billing-group",
      is_retry: "false",
    },
    expected: ROCKETMQ_ORDERS,
  },
  {
    name: "RocketMQ sent to the dead-letter queue",
    metricName: "rocketmq_send_to_dlq_messages_total",
    attributes: { ...ROCKETMQ_SCRAPE, consumer_group: "billing-group" },
    expected: ROCKETMQ_ORDERS,
  },
  {
    name: "RocketMQ messages in",
    metricName: "rocketmq_messages_in_total",
    attributes: { ...ROCKETMQ_SCRAPE, message_type: "Normal" },
    expected: withDirection(ROCKETMQ_ORDERS, "publish"),
  },

  // Messaging CLIENT metrics (semconv) and application gauges.
  {
    name: "semconv messaging.client.sent.messages",
    metricName: "messaging.client.sent.messages",
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "orders",
      "messaging.operation.name": "send",
      "server.address": "kafka-1",
      "server.port": 9092,
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "publish",
      brokerAddress: "kafka-1:9092",
    }),
  },
  {
    name: "semconv messaging.client.consumed.messages",
    metricName: "messaging.client.consumed.messages",
    attributes: {
      "messaging.system": "kafka",
      "messaging.destination.name": "orders",
      "messaging.consumer.group.name": "billing",
      "messaging.destination.partition.id": "1",
    },
    expected: destinationOf({
      system: "kafka",
      destination: "orders",
      direction: "consume",
      consumerGroup: "billing",
    }),
  },
  {
    name: "semconv messaging.client.operation.duration (direction from the operation type)",
    metricName: "messaging.client.operation.duration",
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "amq.default",
      "messaging.rabbitmq.destination.routing_key": "orders",
      "messaging.operation.type": "receive",
      "messaging.operation.name": "fetch",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "orders",
      direction: "consume",
    }),
  },
  {
    name: "semconv messaging.process.duration",
    metricName: "messaging.process.duration",
    attributes: {
      "messaging.system": "servicebus",
      "messaging.destination.name": "orders",
      "server.address": SERVICE_BUS_HOST,
    },
    expected: destinationOf({
      system: "servicebus",
      destination: "orders",
      brokerScope: "orders-prod",
      brokerAddress: SERVICE_BUS_HOST,
      direction: "consume",
    }),
  },
  {
    name: "deprecated messaging.publish.duration (Java agent default mode)",
    metricName: "messaging.publish.duration",
    attributes: {
      "messaging.system": "pulsar",
      "messaging.destination.name":
        "persistent://public/default/orders-partition-0",
    },
    expected: destinationOf({
      system: "pulsar",
      destination: "persistent://public/default/orders",
      direction: "publish",
    }),
  },
  {
    name: "deprecated messaging.receive.duration",
    metricName: "messaging.receive.duration",
    attributes: {
      "messaging.system": "aws_sqs",
      "messaging.destination.name": "orders",
    },
    expected: destinationOf({
      system: "aws_sqs",
      destination: "orders",
      direction: "consume",
    }),
  },
  {
    name: "deprecated messaging.publish.messages",
    metricName: "messaging.publish.messages",
    attributes: {
      "messaging.system": "jms",
      "messaging.destination.name": "orders.queue",
    },
    expected: destinationOf({
      system: "jms",
      destination: "orders.queue",
      direction: "publish",
    }),
  },
  {
    name: "deprecated messaging.receive.messages",
    metricName: "messaging.receive.messages",
    attributes: {
      "messaging.system": "jms",
      "messaging.destination.name": "orders.queue",
    },
    expected: destinationOf({
      system: "jms",
      destination: "orders.queue",
      direction: "consume",
    }),
  },
  {
    name: "deprecated messaging.process.messages",
    metricName: "messaging.process.messages",
    attributes: {
      "messaging.system": "nats",
      "messaging.destination.name": "orders.created",
    },
    expected: destinationOf({
      system: "nats",
      destination: "orders.created",
      direction: "consume",
    }),
  },
  {
    name: "Azure SDK for Java messaging.client.published.messages (pre-1.28 name)",
    metricName: "messaging.client.published.messages",
    attributes: {
      "messaging.system": "eventhubs",
      "messaging.destination.name": "telemetry",
      "messaging.destination.partition.id": "0",
      "server.address": EVENT_HUBS_HOST,
    },
    expected: destinationOf({
      system: "eventhubs",
      destination: "telemetry",
      brokerScope: "ingest-prod",
      brokerAddress: EVENT_HUBS_HOST,
      direction: "publish",
    }),
  },
  /*
   * The Java agent's opt-in RabbitMQ client metrics, as MessagingMetricsAdvice
   * keeps them: the span's joined name and its operation name, never the
   * routing key, and the operation type on messaging.client.operation.duration
   * alone. Each keys the queue of the opt-in span above that it measures.
   */
  {
    name: "Java agent opt-in messaging.client.sent.messages of a RabbitMQ publish ({exchange}:{routing key})",
    metricName: "messaging.client.sent.messages",
    attributes: {
      "messaging.operation.name": "publish",
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "direct_logs:warning",
      "server.address": "rabbit.prod",
      "server.port": 5672,
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "direct_logs",
      direction: "publish",
      brokerAddress: "rabbit.prod:5672",
    }),
  },
  {
    name: "Java agent opt-in messaging.client.operation.duration of a RabbitMQ publish ({exchange}:{routing key})",
    metricName: "messaging.client.operation.duration",
    attributes: {
      "messaging.operation.name": "publish",
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "direct_logs:warning",
      "messaging.operation.type": "send",
      "server.address": "rabbit.prod",
      "server.port": 5672,
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "direct_logs",
      direction: "publish",
      brokerAddress: "rabbit.prod:5672",
    }),
  },
  {
    name: "Java agent opt-in messaging.client.consumed.messages of a RabbitMQ delivery ({exchange}:{routing key}:{queue})",
    metricName: "messaging.client.consumed.messages",
    attributes: {
      "messaging.operation.name": "process",
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "direct_logs:warning:warning_queue",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "warning_queue",
      direction: "consume",
    }),
  },
  {
    name: "Java agent opt-in messaging.process.duration of a RabbitMQ delivery ({exchange}:{routing key}, the routing key the queue)",
    metricName: "messaging.process.duration",
    attributes: {
      "messaging.operation.name": "process",
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "direct_logs:warning",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "warning",
      direction: "consume",
    }),
  },
  {
    name: "Java agent opt-in messaging.client.consumed.messages of a RabbitMQ delivery from a fanout exchange ({exchange}:{queue})",
    metricName: "messaging.client.consumed.messages",
    attributes: {
      "messaging.operation.name": "process",
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "logs:logs-audit",
    },
    expected: destinationOf({
      system: "rabbitmq",
      destination: "logs-audit",
      direction: "consume",
    }),
  },
  {
    name: "OneUptime's own BullMQ queue.size gauge",
    metricName: "queue.size",
    attributes: {
      "messaging.system": "bullmq",
      "messaging.destination.name": "Workers",
      state: "waiting",
      "resource.service.name": "oneuptime-app",
    },
    expected: destinationOf({
      system: "bullmq",
      destination: "Workers",
    }),
  },

  // Never a queue.
  {
    name: "Azure Monitor namespace-level value (-NamespaceOnlyMetric-)",
    metricName: "azure_incomingmessages_total",
    attributes: {
      ...SERVICE_BUS_ENTITY,
      metadata_entityname: "-NamespaceOnlyMetric-",
    },
    expected: null,
  },
  {
    name: "Azure Monitor metric of another resource type (Storage)",
    metricName: "azure_incomingmessages_total",
    attributes: {
      ...SERVICE_BUS_ENTITY,
      type: "Microsoft.Storage/storageAccounts",
    },
    expected: null,
  },
  {
    name: "Pulsar system topic",
    metricName: "pulsar_msg_backlog",
    attributes: {
      ...PULSAR_SCRAPE,
      topic: "persistent://public/default/__change_events",
    },
    expected: null,
  },
  {
    name: "JMX Scraper advisory topic",
    metricName: "activemq.message.queue.size",
    attributes: {
      ...ACTIVEMQ_DESTINATION,
      "activemq.destination.type": "topic",
      "messaging.destination.name": "ActiveMQ.Advisory.Connection",
    },
    expected: null,
  },
  {
    name: "JMX Scraper producer count (not curated; no messaging.system)",
    metricName: "activemq.producer.count",
    attributes: { ...ACTIVEMQ_DESTINATION },
    expected: null,
  },
  {
    name: "NATS JetStream consumer metric (per stream and consumer, not per subject)",
    metricName: "jetstream_consumer_num_pending",
    attributes: {
      "resource.server.address": "nats-exporter",
      "resource.server.port": "7777",
      "resource.service.name": "nats",
      account: "$G",
      stream_name: "ORDERS",
      consumer_name: "billing",
      is_consumer_leader: "true",
    },
    expected: null,
  },
  {
    name: "A host metric",
    metricName: "system.cpu.utilization",
    attributes: { state: "user", "resource.host.name": "web-1" },
    expected: null,
  },
];

/*
 * The values ClickHouse's Map(String, String) keeps for a row: strings as
 * they are, numbers and booleans as String(), arrays as their JSON text, and
 * "" for every requested key the row lacks — the shape the discovery cron
 * reads back with `attributes['<key>']`.
 */
export function toStoredColumns(
  attributes: FixtureAttributes,
  keys: ReadonlyArray<string>,
): Record<string, string> {
  const row: Record<string, string> = {};
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

/*
 * The text the span table's Nullable kind column keeps for the kind a row
 * was inserted with (JSONEachRow, which writes a JSON value's text into a
 * String column): a string as it is, anything else JSON can write as its
 * JSON text (2 → "2", 1e21 → "1e+21", true → "true"), and NULL for no kind
 * — null, undefined, and a number JSON writes as null (NaN, Infinity). The
 * real-ClickHouse discovery suite checks it against the server.
 */
export function toStoredKind(kind: unknown): string | null {
  if (kind === null || kind === undefined) {
    return null;
  }
  if (typeof kind === "string") {
    return kind;
  }
  const text: string | undefined = JSON.stringify(kind);
  return text === undefined || text === "null" ? null : text;
}
