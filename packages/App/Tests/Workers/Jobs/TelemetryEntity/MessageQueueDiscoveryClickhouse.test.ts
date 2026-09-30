import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Span, { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Metric from "Common/Models/AnalyticsModels/Metric";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import {
  DiscoveredMessageQueue,
  MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES,
  MESSAGE_QUEUE_LATE_METRIC_MINUTES,
  MESSAGE_QUEUE_LATE_METRIC_NAMES,
  MessagingMetricDiscoveryRow,
  MessagingSpanDiscoveryRow,
  buildMessagingMetricDiscoverySql,
  buildMessagingMetricProjectsSql,
  buildMessagingSpanDiscoverySql,
  getMessagingDiscoveryColumn,
  mergeDiscoveredMessageQueues,
  resolveMessagingMetricDiscoveryRows,
  resolveMessagingSpanDiscoveryRows,
} from "Common/Server/Utils/Telemetry/MessageQueueDiscovery";
import {
  MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES,
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
} from "Common/Types/MessageQueue/MessagingTelemetryResolver";
import { MESSAGE_QUEUE_BROKER_METRIC_NAMES } from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  parseMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "Common/Types/MessageQueue/MessageQueueIdentity";
import { keyForMessageQueue } from "Common/Utils/Telemetry/EntityKey";
import {
  FixtureAttributes,
  METRIC_FIXTURES,
  SPAN_FIXTURES,
} from "Common/Tests/Types/MessageQueue/MessagingTelemetryFixtures";
import TracePipeline from "Common/Models/DatabaseModels/TracePipeline";
import TracePipelineProcessor from "Common/Models/DatabaseModels/TracePipelineProcessor";
import TracePipelineProcessorType, {
  SpanKindRemapperConfig,
} from "Common/Types/Trace/TracePipelineProcessorType";
import MessagingEntityKeyResolver from "../../../../FeatureSet/Telemetry/Services/MessagingEntityKeys";
import TracePipelineService, {
  LoadedTracePipeline,
} from "../../../../FeatureSet/Telemetry/Services/TracePipelineService";
import { compileFilter } from "../../../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * Message queue discovery against a real ClickHouse server.
 *
 * The unit tests compare the discovery SQL as text and resolve hand-made
 * rows. What they cannot show is that ClickHouse runs it and that the
 * cron lands on EXACTLY the queues ingest keys the telemetry on. So this
 * suite builds the span and metric tables from the real Span and Metric
 * models, runs the REAL ingest stamper (MessagingEntityKeyResolver) over
 * realistic spans and datapoints — hand-written scenarios, plus the core's
 * whole corpus of real instrumentations and broker captures — inserts them
 * the way ingest does (typed values, coerced by ClickHouse into the
 * attribute map), runs the exact queries, resolves their rows, and checks:
 *
 *   1. every queue the cron finds is a queue whose entity key ingest
 *      stamped on those rows, and every stamped queue is found — spans
 *      whose kind a trace pipeline rewrote included (the real
 *      TracePipelineService runs before the stamper, as at ingest);
 *   2. temporary, generated, SERVER and non-messaging telemetry names none;
 *   3. the spans and datapoints counted per queue are the ones stamped with
 *      its key;
 *   4. nothing per instance is grouped on: twelve pods' spans are one row.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryEntity/MessageQueueDiscoveryClickhouse.test.ts
 *
 * The suite creates (and drops) its own database, named from
 * TEST_CLICKHOUSE_DATABASE_PREFIX when that is set. The App Test workflow
 * provides the server; the guard at the bottom fails the run there if it
 * ever goes missing.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike), and TracePipelineService's import graph
 * reaches it through DatabaseService. Nothing here hashes a password.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `${
  process.env["TEST_CLICKHOUSE_DATABASE_PREFIX"] ||
  "message_queue_discovery_test"
}_${process.pid}_${Date.now()}`;

const PROJECT_ID: string = "7a4c5b1e-2b3f-4c1d-9e8f-1a2b3c4d5e6f";
// The core's corpus goes into a project of its own.
const CORPUS_PROJECT_ID: string = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";
const OTHER_PROJECT_ID: string = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f";
const GAUGE_ONLY_PROJECT_ID: string = "1c2d3e4f-5061-4728-9a3b-4c5d6e7f8091";
const LATE_ONLY_PROJECT_ID: string = "2d3e4f50-6172-4839-8a4b-5c6d7e8f9012";

const now: number = Date.now();

const WINDOW_START: Date = new Date(now - 15 * 60 * 1000);
const WINDOW_END: Date = new Date(now + 60 * 1000);

const START_SQL: string = `toDateTime64('${OneUptimeDate.toClickhouseDateTime64(WINDOW_START)}', 9)`;
const END_SQL: string = `toDateTime64('${OneUptimeDate.toClickhouseDateTime64(WINDOW_END)}', 9)`;

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

const SERVICE_BUS_HOST: string = "orders-prod.servicebus.windows.net";
// 255 characters that lowercase to 510 UTF-16 code units.
const OVERLONG_DESTINATION: string = String.fromCharCode(0x130).repeat(255);
/*
 * A provider value padded with a tab and a no-break space: the core's
 * trigger trims both, ClickHouse's trimBoth() neither.
 */
const PADDED_SERVICE_BUS_NAMESPACE: string = `\tMicrosoft.ServiceBus${String.fromCharCode(
  0xa0,
)}`;

/*
 * ---- Scenario spans -------------------------------------------------------
 *
 * `queue` is the identifier of the queue ingest must key the spans on (null
 * for none) — checked against the real stamper, so a wrong expectation here
 * fails loudly; `unread` says why the project's query must not read them.
 */
interface QueueSpanFixture {
  label: string;
  // The kind the span arrives with (what OtelTracesIngestService maps it to).
  kind: SpanKind;
  /*
   * A trace pipeline's Span Kind Remapper rewriting that kind: the spans go
   * through the real TracePipelineService.processSpan with this one
   * mapping before the stamper runs, as OtelTracesIngestService orders
   * them, and are stored with the kind it wrote. `to: undefined` is a
   * mapping saved through the API without a kind: stored NULL.
   */
  remapKind?: { to: string | undefined };
  attributes: FixtureAttributes;
  // Spans to insert; `perCopy` adds what varies between them.
  count?: number;
  // How many of them failed (statusCode Error).
  failed?: number;
  perCopy?: (copy: number) => FixtureAttributes;
  projectId?: string;
  minutesAgo?: number;
  queue: string | null;
  unread?: string;
}

function kafka(
  destination: string,
  extra: FixtureAttributes = {},
): FixtureAttributes {
  return {
    "messaging.system": "kafka",
    "messaging.destination.name": destination,
    ...extra,
  };
}

const SCENARIO_SPANS: Array<QueueSpanFixture> = [
  {
    label: "Java agent Kafka producers on twelve pods",
    kind: SpanKind.Producer,
    attributes: kafka("orders", { "messaging.operation": "publish" }),
    count: 12,
    perCopy: (copy: number): FixtureAttributes => {
      return {
        "resource.k8s.pod.name": `orders-api-${copy}`,
        "resource.service.instance.id": `instance-${copy}`,
        "resource.host.name": `node-${copy % 3}`,
        "messaging.client_id": `producer-${copy}`,
        "messaging.destination.partition.id": String(copy % 6),
        "messaging.kafka.message.offset": 1000 + copy,
        "messaging.message.id": `message-${copy}`,
      };
    },
    queue: "kafka||orders",
  },
  {
    label: "Java agent Kafka consumers (messaging semconv opt-in), two failing",
    kind: SpanKind.Consumer,
    attributes: kafka("orders", {
      "messaging.operation.type": "process",
      "messaging.consumer.group.name": "billing",
    }),
    count: 5,
    failed: 2,
    perCopy: (copy: number): FixtureAttributes => {
      return {
        "resource.k8s.pod.name": `billing-${copy}`,
        "messaging.client.id": `consumer-${copy}`,
        "messaging.kafka.offset": 500 + copy,
      };
    },
    queue: "kafka||orders",
  },
  {
    label: "kafka-python producer (bootstrap servers as a list)",
    kind: SpanKind.Producer,
    attributes: kafka("payments", {
      "messaging.url": ["kafka-1:9092", "kafka-2:9092"],
    }),
    count: 2,
    queue: "kafka||payments",
  },
  {
    label: "Kafka batch receive spanning topics (no destination)",
    kind: SpanKind.Consumer,
    attributes: {
      "messaging.system": "kafka",
      "messaging.operation": "receive",
    },
    count: 3,
    queue: null,
  },
  {
    label: "RabbitMQ publish through the default exchange",
    kind: SpanKind.Producer,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "<default>",
      "messaging.rabbitmq.destination.routing_key": "invoices",
    },
    count: 3,
    queue: "rabbitmq||invoices",
  },
  {
    label: "RabbitMQ consumer's joined exchange:key:queue name (opt-in)",
    kind: SpanKind.Consumer,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "shop:new-invoice:invoices",
      "messaging.rabbitmq.destination.routing_key": "new-invoice",
      "messaging.operation.type": "process",
    },
    count: 2,
    queue: "rabbitmq||invoices",
  },
  {
    label: "RabbitMQ server-named queue",
    kind: SpanKind.Consumer,
    attributes: {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
    },
    count: 4,
    queue: null,
  },
  {
    label: ".NET Service Bus send",
    kind: SpanKind.Producer,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.destination.name": "orders",
      "server.address": SERVICE_BUS_HOST,
      "messaging.operation.type": "send",
    },
    count: 3,
    queue: "servicebus|orders-prod|orders",
  },
  {
    label: ".NET Service Bus subscription receive (entity path)",
    kind: SpanKind.Consumer,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.destination.name": "orders/Subscriptions/billing",
      "server.address": SERVICE_BUS_HOST,
      "messaging.operation.type": "receive",
    },
    count: 2,
    queue: "servicebus|orders-prod|orders",
  },
  {
    label: ".NET Service Bus dead-letter receive",
    kind: SpanKind.Consumer,
    attributes: {
      "messaging.system": "servicebus",
      "messaging.destination.name": "orders/$DeadLetterQueue",
      "server.address": SERVICE_BUS_HOST,
    },
    queue: "servicebus|orders-prod|orders",
  },
  {
    /*
     * Its only trigger is the provider key, padded with whitespace
     * ClickHouse's trimBoth would keep: the query must still read it.
     */
    label: "JS Service Bus receive whose only trigger is a padded az.namespace",
    kind: SpanKind.Consumer,
    attributes: {
      "az.namespace": PADDED_SERVICE_BUS_NAMESPACE,
      "messaging.source.name": "orders",
      "net.peer.name": SERVICE_BUS_HOST,
      "messaging.operation": "receive",
    },
    queue: "servicebus|orders-prod|orders",
  },
  {
    label: "Azure Storage SDK spans",
    kind: SpanKind.Client,
    attributes: {
      "az.namespace": "Microsoft.Storage",
      "server.address": "acct.blob.core.windows.net",
      "messaging.source.name": "not-a-queue",
    },
    count: 25,
    queue: null,
  },
  {
    label: "Go otelaws SQS SendMessage (queue URL in server.address)",
    kind: SpanKind.Client,
    attributes: {
      "messaging.system": "aws_sqs",
      "server.address":
        "https://sqs.us-west-2.amazonaws.com/123456789012/refunds",
      "rpc.system": "aws-api",
      "rpc.service": "SQS",
      "rpc.method": "SQS/SendMessage",
    },
    count: 2,
    queue: "aws_sqs||refunds",
  },
  {
    label: ".NET AWS SQS receive, legacy mode (aws.queue_url only)",
    kind: SpanKind.Consumer,
    attributes: {
      "aws.queue_url":
        "https://sqs.us-west-2.amazonaws.com/123456789012/refunds",
    },
    queue: "aws_sqs||refunds",
  },
  {
    label: "Pub/Sub publisher naming the full topic resource",
    kind: SpanKind.Producer,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.destination.name": "projects/shop/topics/orders",
    },
    count: 2,
    queue: "gcp_pubsub||orders",
  },
  {
    label: "Java agent Pulsar producer on partition 0",
    kind: SpanKind.Producer,
    attributes: {
      "messaging.system": "pulsar",
      "messaging.destination.name": "orders-partition-0",
    },
    count: 2,
    queue: "pulsar||persistent://public/default/orders",
  },
  {
    label: "Java agent Pulsar producer on partition 3",
    kind: SpanKind.Producer,
    attributes: {
      "messaging.system": "pulsar",
      "messaging.destination.name": "orders-partition-3",
    },
    queue: "pulsar||persistent://public/default/orders",
  },
  {
    label: "A reply queue named for one request",
    kind: SpanKind.Producer,
    attributes: kafka("reply-7f1c2a9e-4b1d-4c3e-9f1a-2b3c4d5e6f70"),
    queue: "kafka||reply-{uuid}",
  },
  {
    label: "A reply queue named for another request",
    kind: SpanKind.Producer,
    attributes: kafka("reply-0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f"),
    queue: "kafka||reply-{uuid}",
  },
  {
    label: "A Kafka topic flagged temporary",
    kind: SpanKind.Producer,
    attributes: kafka("orders", { "messaging.destination.temporary": true }),
    count: 2,
    queue: null,
  },
  {
    label: "SERVER spans naming a topic",
    kind: SpanKind.Server,
    attributes: kafka("server-only-topic"),
    count: 5,
    queue: null,
  },
  /*
   * Spans whose kind a trace pipeline rewrote. Ingest keys every span that
   * is not stored as SPAN_KIND_SERVER, whatever else its kind says, so the
   * cron must read them all — and leave the rest to the resolver, which
   * refuses any other spelling of SERVER exactly as it did at ingest.
   */
  {
    label:
      "Kafka consumers a pipeline remapped to Unspecified (the dashboard's option)",
    kind: SpanKind.Consumer,
    remapKind: { to: "SPAN_KIND_UNSPECIFIED" },
    attributes: kafka("remapped-orders", {
      "messaging.operation.type": "process",
    }),
    count: 5,
    queue: "kafka||remapped-orders",
  },
  {
    label: "Kafka producers a mapping saved without a kind left kindless",
    kind: SpanKind.Producer,
    remapKind: { to: undefined },
    attributes: kafka("kindless-orders"),
    count: 3,
    queue: "kafka||kindless-orders",
  },
  {
    label: "Kafka spans a pipeline remapped to a bare PRODUCER",
    kind: SpanKind.Internal,
    remapKind: { to: "PRODUCER" },
    attributes: kafka("bare-kind-orders"),
    count: 3,
    queue: "kafka||bare-kind-orders",
  },
  {
    label: "Kafka spans a pipeline remapped to a lower-case server",
    kind: SpanKind.Producer,
    remapKind: { to: "server" },
    attributes: kafka("server-remapped-topic"),
    count: 4,
    queue: null,
  },
  {
    label: "HTTP client spans",
    kind: SpanKind.Client,
    attributes: {
      "http.request.method": "GET",
      "server.address": "api.example.com",
      "server.port": 443,
    },
    count: 10,
    queue: null,
  },
  {
    label: "Java agent JMS send",
    kind: SpanKind.Producer,
    attributes: {
      "messaging.system": "jms",
      "messaging.destination.name": "queue://orders",
    },
    count: 2,
    queue: "jms||orders",
  },
  {
    label:
      "A name whose identifier cannot be built (255 characters, 510 lowercased)",
    kind: SpanKind.Producer,
    attributes: kafka(OVERLONG_DESTINATION),
    count: 3,
    queue: null,
  },
  {
    label: "Another project's topic",
    kind: SpanKind.Producer,
    attributes: kafka("other-project-topic"),
    count: 2,
    projectId: OTHER_PROJECT_ID,
    queue: "kafka||other-project-topic",
    unread: "another project",
  },
  {
    label: "A topic last named two hours ago",
    kind: SpanKind.Producer,
    attributes: kafka("stale-topic"),
    count: 2,
    minutesAgo: 120,
    queue: "kafka||stale-topic",
    unread: "outside the window",
  },
];

/*
 * ---- Scenario datapoints ----------------------------------------------------
 */
interface QueueMetricFixture {
  label: string;
  name: string;
  attributes: FixtureAttributes;
  count?: number;
  perCopy?: (copy: number) => FixtureAttributes;
  projectId?: string;
  minutesAgo?: number;
  queue: string | null;
  unread?: string;
}

const PULSAR_SCRAPE: FixtureAttributes = {
  "resource.server.address": "pulsar-broker-0",
  "resource.server.port": "8080",
  "resource.service.name": "pulsar-broker",
  cluster: "standalone",
  namespace: "public/default",
  topic: "persistent://public/default/orders-partition-0",
};

const SERVICE_BUS_NAMESPACE: FixtureAttributes = {
  "resource.azuremonitor.subscription_id":
    "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b",
  type: "Microsoft.ServiceBus/Namespaces",
  name: "orders-prod",
  resource_group: "rg-prod",
};

const SCENARIO_METRICS: Array<QueueMetricFixture> = [
  {
    label: "kafka_metrics consumer lag of two groups",
    name: "kafka.consumer_group.lag_sum",
    attributes: {
      topic: "orders",
      "resource.kafka.cluster.alias": "prod-kafka",
    },
    count: 4,
    perCopy: (copy: number): FixtureAttributes => {
      return { group: copy % 2 === 0 ? "billing" : "audit" };
    },
    queue: "kafka||orders",
  },
  {
    label: "kafka_metrics per-partition offsets (partition is an int)",
    name: "kafka.partition.current_offset",
    attributes: { topic: "orders" },
    count: 6,
    perCopy: (copy: number): FixtureAttributes => {
      return { partition: copy };
    },
    queue: "kafka||orders",
  },
  {
    label: "rabbitmq queue depth, both states",
    name: "rabbitmq.message.current",
    attributes: {
      "resource.rabbitmq.queue.name": "invoices",
      "resource.rabbitmq.vhost.name": "/",
      "resource.rabbitmq.node.name": "rabbit@16c76f2d8aa2",
    },
    count: 2,
    perCopy: (copy: number): FixtureAttributes => {
      return { state: copy === 0 ? "ready" : "unacknowledged" };
    },
    queue: "rabbitmq||invoices",
  },
  {
    label: "Azure Monitor active messages",
    name: "azure_activemessages_average",
    attributes: { ...SERVICE_BUS_NAMESPACE, metadata_entityname: "orders" },
    count: 3,
    minutesAgo: 5,
    queue: "servicebus|orders-prod|orders",
  },
  {
    label:
      "Azure Monitor dead-lettered messages (PascalCase dimension, upper-case namespace)",
    name: "azure_deadletteredmessages_average",
    attributes: {
      ...SERVICE_BUS_NAMESPACE,
      type: "microsoft.servicebus/namespaces",
      name: "ORDERS-PROD",
      metadata_EntityName: "orders",
    },
    queue: "servicebus|orders-prod|orders",
  },
  {
    label: "CloudWatch SQS backlog, 35 minutes late",
    name: "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
    attributes: {
      "Dimensions.QueueName": "refunds",
      "resource.cloud.provider": "aws",
      "resource.cloud.region": "us-west-2",
    },
    count: 2,
    minutesAgo: 35,
    queue: "aws_sqs||refunds",
  },
  {
    label: "CloudWatch JSON-stream SQS oldest message age, 20 minutes late",
    name: "approximateageofoldestmessage",
    attributes: { QueueName: "refunds", "resource.service.name": "SQS" },
    minutesAgo: 20,
    queue: "aws_sqs||refunds",
  },
  {
    label: "A CloudWatch datapoint older than the late window",
    name: "amazonaws.com/aws/sqs/numberofmessagessent",
    attributes: { "Dimensions.QueueName": "ancient" },
    minutesAgo: 15 + MESSAGE_QUEUE_LATE_METRIC_MINUTES + 10,
    queue: "aws_sqs||ancient",
    unread: "older than the late window",
  },
  {
    label: "A kafka_metrics datapoint 35 minutes old (scrapes are never late)",
    name: "kafka.consumer_group.lag_sum",
    attributes: { topic: "late-topic", group: "billing" },
    minutesAgo: 35,
    queue: "kafka||late-topic",
    unread: "outside the window",
  },
  {
    label: "Pub/Sub subscription backlog",
    name: "pubsub.googleapis.com/subscription/num_undelivered_messages",
    attributes: {
      "resource.subscription_id": "orders-billing",
      "resource.project_id": "shop",
    },
    count: 2,
    minutesAgo: 8,
    queue: "gcp_pubsub||orders-billing",
  },
  {
    label: "Pulsar partition backlog",
    name: "pulsar_msg_backlog",
    attributes: { ...PULSAR_SCRAPE },
    count: 2,
    queue: "pulsar||persistent://public/default/orders",
  },
  {
    label: "Pulsar subscription throughput",
    name: "pulsar_out_messages_total",
    attributes: { ...PULSAR_SCRAPE, subscription: "billing" },
    count: 2,
    queue: "pulsar||persistent://public/default/orders",
  },
  {
    // Ingest drops the per-consumer repeat; the query folds it into the topic.
    label: "Pulsar per-consumer repeat of that throughput",
    name: "pulsar_out_messages_total",
    attributes: {
      ...PULSAR_SCRAPE,
      subscription: "billing",
      consumer_name: "billing-1",
      consumer_id: "0",
    },
    count: 2,
    queue: null,
  },
  {
    label: "JMX Scraper queue size",
    name: "activemq.message.queue.size",
    attributes: {
      "messaging.destination.name": "orders",
      "activemq.destination.type": "queue",
      "activemq.broker.name": "localhost",
      "resource.service.name": "activemq-prod",
    },
    count: 3,
    queue: "jms||orders",
  },
  {
    label: "Kafka client sent messages (semconv client metric)",
    name: "messaging.client.sent.messages",
    attributes: kafka("orders", {
      "server.address": "kafka-1",
      "server.port": 9092,
    }),
    count: 5,
    queue: "kafka||orders",
  },
  {
    label: "Azure SDK for Java Service Bus sent messages (no messaging.system)",
    name: "messaging.servicebus.messages.sent",
    attributes: {
      "messaging.destination.name": "orders",
      "server.address": SERVICE_BUS_HOST,
    },
    queue: "servicebus|orders-prod|orders",
  },
  {
    label: "An application's own BullMQ queue.size gauge",
    name: "queue.size",
    attributes: {
      "messaging.system": "bullmq",
      "messaging.destination.name": "jobs",
      state: "waiting",
    },
    count: 3,
    queue: "bullmq||jobs",
    unread: "an application's own gauge attaches to a queue, never sights one",
  },
  {
    label: "A curated name a RenameMetric rule stored in mixed case",
    name: "Kafka.Consumer_Group.Lag_Sum",
    attributes: { topic: "renamed-topic", group: "billing" },
    count: 2,
    queue: "kafka||renamed-topic",
    unread: "not a stored name the query reads",
  },
  {
    label: "Azure Monitor namespace-level value",
    name: "azure_activemessages_average",
    attributes: {
      ...SERVICE_BUS_NAMESPACE,
      metadata_entityname: "-NamespaceOnlyMetric-",
    },
    queue: null,
  },
  {
    label: "Azure Monitor metric of a storage account",
    name: "azure_incomingmessages_total",
    attributes: {
      type: "Microsoft.Storage/storageAccounts",
      name: "acct",
      metadata_entityname: "orders",
    },
    queue: null,
  },
  {
    label: "Another project's broker",
    name: "kafka.consumer_group.lag_sum",
    attributes: { topic: "other-project-topic", group: "billing" },
    projectId: OTHER_PROJECT_ID,
    queue: "kafka||other-project-topic",
    unread: "another project",
  },
  {
    label: "A project that only reports an application gauge",
    name: "queue.size",
    attributes: {
      "messaging.system": "bullmq",
      "messaging.destination.name": "jobs",
    },
    projectId: GAUGE_ONLY_PROJECT_ID,
    queue: "bullmq||jobs",
    unread: "another project",
  },
  {
    label:
      "A project whose only messaging telemetry is a late CloudWatch metric",
    name: "amazonaws.com/aws/sns/numberofmessagespublished",
    attributes: { "Dimensions.TopicName": "order-events" },
    projectId: LATE_ONLY_PROJECT_ID,
    minutesAgo: 30,
    queue: "aws.sns||order-events",
    unread: "another project",
  },
];

/*
 * ---- Rows as ingest writes them ---------------------------------------------
 */
interface InsertedSpan {
  label: string;
  projectId: string;
  // As stored: null when a pipeline left the span without a kind.
  kind: string | null;
  startMs: number;
  failed: boolean;
  attributes: FixtureAttributes;
  // The queue key the real stamper appended, or null.
  queueKey: string | null;
  read: boolean;
}

interface InsertedDatapoint {
  label: string;
  projectId: string;
  name: string;
  timeMs: number;
  attributes: FixtureAttributes;
  queueKey: string | null;
  read: boolean;
}

// Only the stamper touches entityKeys here, so the one key is the queue's.
function stampedKey(row: JSONObject): string | null {
  const keys: Array<string> = row["entityKeys"] as Array<string>;
  if (keys.length > 1) {
    throw new Error(`One row got several queue keys: ${keys.join(", ")}`);
  }
  return keys[0] || null;
}

function queueKeyOf(projectId: string, identifier: string): string {
  const identity: MessageQueueIdentity | null =
    parseMessageQueueIdentifier(identifier);
  if (!identity) {
    throw new Error(`Not a queue identifier: ${identifier}`);
  }
  return keyForMessageQueue(projectId, identity);
}

/*
 * One enabled trace pipeline (no filter: every span) holding one Span Kind
 * Remapper that maps Kafka spans' kind — what the dashboard's pipeline
 * form saves, loaded as TracePipelineService.loadPipelines hands it over.
 */
function kindRemapper(to: string | undefined): Array<LoadedTracePipeline> {
  const config: SpanKindRemapperConfig = {
    sourceKey: "messaging.system",
    /*
     * The type says string; a configuration saved through the API is any
     * JSON, and a mapping without a kind leaves the span without one.
     */
    mappings: [{ matchValue: "kafka", kind: to as string }],
  };
  const processor: TracePipelineProcessor = new TracePipelineProcessor();
  processor.name = "Remap the span kind";
  processor.processorType = TracePipelineProcessorType.SpanKindRemapper;
  processor.configuration = config as unknown as JSONObject;
  processor.isEnabled = true;

  const pipeline: TracePipeline = new TracePipeline();
  pipeline.name = "Messaging spans";
  pipeline.isEnabled = true;

  return [
    {
      pipeline: pipeline,
      compiledFilter: compileFilter(""),
      processors: [processor],
    },
  ];
}

function buildSpans(): Array<InsertedSpan> {
  const spans: Array<InsertedSpan> = [];
  let index: number = 0;

  const add: (data: {
    label: string;
    projectId: string;
    kind: string;
    remapKind?: { to: string | undefined } | undefined;
    minutesAgo: number;
    failed: boolean;
    attributes: FixtureAttributes;
    read: boolean;
  }) => void = (data: {
    label: string;
    projectId: string;
    kind: string;
    remapKind?: { to: string | undefined } | undefined;
    minutesAgo: number;
    failed: boolean;
    attributes: FixtureAttributes;
    read: boolean;
  }): void => {
    index++;
    let row: JSONObject = {
      kind: data.kind,
      attributes: data.attributes as JSONObject,
      entityKeys: [],
    };
    // Ingest's order: the trace pipeline first, then the stamper.
    if (data.remapKind) {
      row = TracePipelineService.processSpan(
        row,
        kindRemapper(data.remapKind.to),
      );
    }
    // The real stamper, one resolver per ingest request.
    new MessagingEntityKeyResolver(data.projectId).appendToSpanRow(row);
    spans.push({
      label: data.label,
      projectId: data.projectId,
      kind: typeof row["kind"] === "string" ? row["kind"] : null,
      startMs: now - data.minutesAgo * 60 * 1000 - index * 10,
      failed: data.failed,
      attributes: data.attributes,
      queueKey: stampedKey(row),
      read: data.read,
    });
  };

  for (const fixture of SCENARIO_SPANS) {
    for (let copy: number = 0; copy < (fixture.count || 1); copy++) {
      add({
        label: fixture.label,
        projectId: fixture.projectId || PROJECT_ID,
        kind: fixture.kind,
        remapKind: fixture.remapKind,
        minutesAgo: fixture.minutesAgo || 1,
        failed: copy < (fixture.failed || 0),
        attributes: {
          ...fixture.attributes,
          ...(fixture.perCopy ? fixture.perCopy(copy) : {}),
        },
        read: !fixture.unread,
      });
    }
  }

  /*
   * An OTLP span without a kind is stored as INTERNAL
   * (OtelTracesIngestService.mapSpanKind); only a trace pipeline stores
   * another kind (see the remapped scenarios above).
   */
  for (const fixture of SPAN_FIXTURES) {
    add({
      label: fixture.name,
      projectId: CORPUS_PROJECT_ID,
      kind: fixture.kind || SpanKind.Internal,
      minutesAgo: 2,
      failed: false,
      attributes: fixture.attributes,
      read: true,
    });
  }

  return spans;
}

function buildDatapoints(): Array<InsertedDatapoint> {
  const datapoints: Array<InsertedDatapoint> = [];
  let index: number = 0;

  const add: (data: {
    label: string;
    projectId: string;
    name: string;
    minutesAgo: number;
    attributes: FixtureAttributes;
    read: boolean;
  }) => void = (data: {
    label: string;
    projectId: string;
    name: string;
    minutesAgo: number;
    attributes: FixtureAttributes;
    read: boolean;
  }): void => {
    index++;
    const row: JSONObject = {
      name: data.name,
      attributes: data.attributes as JSONObject,
      entityKeys: [],
    };
    new MessagingEntityKeyResolver(data.projectId).appendToMetricRow(row);
    datapoints.push({
      label: data.label,
      projectId: data.projectId,
      name: data.name,
      timeMs: now - data.minutesAgo * 60 * 1000 - index * 10,
      attributes: data.attributes,
      queueKey: stampedKey(row),
      read: data.read,
    });
  };

  for (const fixture of SCENARIO_METRICS) {
    for (let copy: number = 0; copy < (fixture.count || 1); copy++) {
      add({
        label: fixture.label,
        projectId: fixture.projectId || PROJECT_ID,
        name: fixture.name,
        minutesAgo: fixture.minutesAgo || 1,
        attributes: {
          ...fixture.attributes,
          ...(fixture.perCopy ? fixture.perCopy(copy) : {}),
        },
        read: !fixture.unread,
      });
    }
  }

  // The corpus: all in the window, read when its name is one the query reads.
  for (const fixture of METRIC_FIXTURES) {
    add({
      label: fixture.name,
      projectId: CORPUS_PROJECT_ID,
      name: fixture.metricName,
      minutesAgo: 2,
      attributes: fixture.attributes,
      read: MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES.includes(fixture.metricName),
    });
  }

  return datapoints;
}

function spanInsertRows(spans: Array<InsertedSpan>): Array<JSONObject> {
  return spans.map((span: InsertedSpan, index: number): JSONObject => {
    const start: Date = new Date(span.startMs);
    return {
      projectId: span.projectId,
      primaryEntityId: ObjectID.generate().toString(),
      primaryEntityType: "OpenTelemetry",
      startTime: OneUptimeDate.toClickhouseDateTime64(start),
      endTime: OneUptimeDate.toClickhouseDateTime64(start),
      startTimeUnixNano: String(start.getTime() * 1000000),
      endTimeUnixNano: String(start.getTime() * 1000000),
      durationUnixNano: "1000000",
      traceId: `trace-${index}`,
      spanId: `span-${index}`,
      parentSpanId: "",
      // Typed values, as ingest sends them: ClickHouse stores their text.
      attributes: span.attributes as JSONObject,
      attributeKeys: Object.keys(span.attributes),
      entityKeys: span.queueKey ? [span.queueKey] : [],
      statusCode: span.failed ? SpanStatus.Error : SpanStatus.Unset,
      name: "messaging",
      // `kind` is Nullable: a span a pipeline left kindless is stored NULL.
      kind: span.kind,
      retentionDate: retentionDate,
    };
  });
}

function metricInsertRows(
  datapoints: Array<InsertedDatapoint>,
): Array<JSONObject> {
  return datapoints.map((datapoint: InsertedDatapoint): JSONObject => {
    const time: Date = new Date(datapoint.timeMs);
    return {
      projectId: datapoint.projectId,
      primaryEntityId: ObjectID.generate().toString(),
      primaryEntityType: "OpenTelemetry",
      name: datapoint.name,
      metricPointType: "Gauge",
      time: OneUptimeDate.toClickhouseDateTime64(time),
      timeUnixNano: String(time.getTime() * 1000000),
      value: 1,
      attributes: datapoint.attributes as JSONObject,
      attributeKeys: Object.keys(datapoint.attributes),
      entityKeys: datapoint.queueKey ? [datapoint.queueKey] : [],
      retentionDate: retentionDate,
    };
  });
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  model: AnalyticsBaseModel,
  modelType: { new (): AnalyticsBaseModel },
): Promise<string> {
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });

  return model.tableName;
}

function addCount(
  counts: Map<string, number>,
  key: string,
  count: number,
): void {
  counts.set(key, (counts.get(key) || 0) + count);
}

function keyOf(projectId: string, queue: DiscoveredMessageQueue): string {
  return keyForMessageQueue(projectId, queue.identity);
}

// key → spans / datapoints of one evidence kind the cron counted.
function foundCounts(
  projectId: string,
  queues: Array<DiscoveredMessageQueue>,
  kind: "spans" | "brokerMetrics" | "clientMetrics",
): Map<string, number> {
  const counts: Map<string, number> = new Map<string, number>();
  for (const queue of queues) {
    const evidence: { count: number } | null = queue[kind];
    if (evidence) {
      addCount(counts, keyOf(projectId, queue), evidence.count);
    }
  }
  return counts;
}

function sorted(counts: Map<string, number>): Array<[string, number]> {
  return Array.from(counts.entries()).sort(
    (a: [string, number], b: [string, number]): number => {
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    },
  );
}

// key → spans ingest stamped with it, among the ones the query reads.
function stampedSpanCounts(
  spans: Array<InsertedSpan>,
  projectId: string,
): Map<string, number> {
  const counts: Map<string, number> = new Map<string, number>();
  for (const span of spans) {
    if (span.projectId === projectId && span.read && span.queueKey) {
      addCount(counts, span.queueKey, 1);
    }
  }
  return counts;
}

/*
 * key → datapoints of one evidence kind ingest stamped with it, among the
 * ones the query reads — plus the per-consumer repeats, which ingest keys
 * on nothing but the query cannot tell from their subscription's own series
 * (it never groups on the marker): they count towards the queue their
 * coarser series names, never towards one of their own.
 */
function expectedDatapointCounts(
  datapoints: Array<InsertedDatapoint>,
  projectId: string,
  broker: boolean,
): Map<string, number> {
  const counts: Map<string, number> = new Map<string, number>();
  for (const datapoint of datapoints) {
    if (
      datapoint.projectId !== projectId ||
      !datapoint.read ||
      MESSAGE_QUEUE_BROKER_METRIC_NAMES.has(datapoint.name) !== broker
    ) {
      continue;
    }

    if (datapoint.queueKey) {
      addCount(counts, datapoint.queueKey, 1);
      continue;
    }

    const carriesRepeatMarker: boolean =
      MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES.some(
        (key: string): boolean => {
          return Boolean(datapoint.attributes[key]);
        },
      );
    if (!carriesRepeatMarker) {
      continue;
    }

    const withoutMarker: FixtureAttributes = { ...datapoint.attributes };
    for (const key of MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES) {
      delete withoutMarker[key];
    }
    const coarser: ResolvedMessagingDestination | null =
      resolveMessagingMetricDatapoint({
        metricName: datapoint.name,
        getAttribute: (key: string): unknown => {
          return withoutMarker[key];
        },
      });
    const identity: MessageQueueIdentity | null = coarser
      ? toMessageQueueIdentity(coarser)
      : null;
    if (identity && buildMessageQueueIdentifier(identity)) {
      addCount(counts, keyForMessageQueue(projectId, identity), 1);
    }
  }
  return counts;
}

integration("Message queue discovery SQL against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let spanTable: string = "";
  let metricTable: string = "";

  let spans: Array<InsertedSpan> = [];
  let datapoints: Array<InsertedDatapoint> = [];

  // Per project: the query rows and the queues they resolve to.
  const spanRows: Map<string, Array<MessagingSpanDiscoveryRow>> = new Map<
    string,
    Array<MessagingSpanDiscoveryRow>
  >();
  const metricRows: Map<string, Array<MessagingMetricDiscoveryRow>> = new Map<
    string,
    Array<MessagingMetricDiscoveryRow>
  >();

  async function query<T>(sql: string): Promise<Array<T>> {
    const result: { json: () => Promise<unknown> } = await client.query({
      query: sql
        .replace(`FROM oneuptime.${spanTable}`, `FROM ${database}.${spanTable}`)
        .replace(
          `FROM oneuptime.${metricTable}`,
          `FROM ${database}.${metricTable}`,
        ),
      format: "JSON",
    });
    return ((await result.json()) as { data: Array<T> }).data;
  }

  async function runSpanQuery(
    projectId: string,
    maxRows: number,
  ): Promise<Array<MessagingSpanDiscoveryRow>> {
    const sql: string = buildMessagingSpanDiscoverySql({
      projectId: projectId,
      startSql: START_SQL,
      endSql: END_SQL,
      maxRows: maxRows,
    });
    expect(sql).toContain(`FROM oneuptime.${spanTable}`);
    return query<MessagingSpanDiscoveryRow>(sql);
  }

  async function runMetricQuery(
    projectId: string,
    maxRows: number,
  ): Promise<Array<MessagingMetricDiscoveryRow>> {
    const sql: string = buildMessagingMetricDiscoverySql({
      projectId: projectId,
      startSql: START_SQL,
      endSql: END_SQL,
      maxRows: maxRows,
    });
    expect(sql).toContain(`FROM oneuptime.${metricTable}`);
    return query<MessagingMetricDiscoveryRow>(sql);
  }

  function spanQueues(projectId: string): Array<DiscoveredMessageQueue> {
    return resolveMessagingSpanDiscoveryRows(spanRows.get(projectId) || []);
  }

  function metricQueues(projectId: string): Array<DiscoveredMessageQueue> {
    return resolveMessagingMetricDiscoveryRows(metricRows.get(projectId) || []);
  }

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    // Every row keyed by the real stamper, as ingest keys it.
    spans = buildSpans();
    datapoints = buildDatapoints();

    spanTable = await createTable(
      client,
      clickhouse,
      new Span(),
      Span as unknown as { new (): AnalyticsBaseModel },
    );
    metricTable = await createTable(
      client,
      clickhouse,
      new Metric(),
      Metric as unknown as { new (): AnalyticsBaseModel },
    );

    await client.insert({
      table: `${database}.${spanTable}`,
      values: spanInsertRows(spans),
      format: "JSONEachRow",
    });
    await client.insert({
      table: `${database}.${metricTable}`,
      values: metricInsertRows(datapoints),
      format: "JSONEachRow",
    });

    for (const projectId of [PROJECT_ID, CORPUS_PROJECT_ID]) {
      spanRows.set(projectId, await runSpanQuery(projectId, 5000));
      metricRows.set(projectId, await runMetricQuery(projectId, 5000));
    }
  });

  afterAll(async (): Promise<void> => {
    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the fixtures name what they say: the real stamper keys every scenario on its declared queue", () => {
    for (const fixture of [...SCENARIO_SPANS, ...SCENARIO_METRICS]) {
      const projectId: string = fixture.projectId || PROJECT_ID;
      const expected: string | null = fixture.queue
        ? queueKeyOf(projectId, fixture.queue)
        : null;
      const stamped: Array<string | null> = [
        ...spans.filter((span: InsertedSpan): boolean => {
          return span.label === fixture.label;
        }),
        ...datapoints.filter((datapoint: InsertedDatapoint): boolean => {
          return datapoint.label === fixture.label;
        }),
      ].map((row: { queueKey: string | null }): string | null => {
        return row.queueKey;
      });

      expect(stamped.length).toBe(fixture.count || 1);
      for (const key of stamped) {
        expect({ fixture: fixture.label, key }).toEqual({
          fixture: fixture.label,
          key: expected,
        });
      }
    }
  });

  test("the queries run and return grouped rows", () => {
    expect(spanRows.get(PROJECT_ID)!.length).toBeGreaterThan(10);
    expect(metricRows.get(PROJECT_ID)!.length).toBeGreaterThan(10);
    expect(spanRows.get(CORPUS_PROJECT_ID)!.length).toBeGreaterThan(60);
    expect(metricRows.get(CORPUS_PROJECT_ID)!.length).toBeGreaterThan(60);
  });

  test("the attribute map holds what ingest's typed values become, which the resolvers read alike", async () => {
    const stored: Array<Record<string, string>> = await query<
      Record<string, string>
    >(
      `SELECT attributes['messaging.url'] AS url, attributes['messaging.destination.temporary'] AS temporary, attributes['server.port'] AS port FROM oneuptime.${spanTable} WHERE projectId = '${PROJECT_ID}' AND (has(attributeKeys, 'messaging.url') OR has(attributeKeys, 'messaging.destination.temporary') OR attributes['http.request.method'] = 'GET') ORDER BY url, temporary, port LIMIT 1 BY url, temporary, port`,
    );
    expect(stored).toEqual(
      expect.arrayContaining([
        {
          url: JSON.stringify(["kafka-1:9092", "kafka-2:9092"]),
          temporary: "",
          port: "",
        },
        { url: "", temporary: "true", port: "" },
        { url: "", temporary: "", port: "443" },
      ]),
    );
  });

  test("every queue the cron finds in the spans is one ingest keyed them on, with as many spans", () => {
    for (const projectId of [PROJECT_ID, CORPUS_PROJECT_ID]) {
      expect({
        projectId,
        found: sorted(foundCounts(projectId, spanQueues(projectId), "spans")),
      }).toEqual({
        projectId,
        found: sorted(stampedSpanCounts(spans, projectId)),
      });
    }
  });

  test("every queue the cron finds in the broker metrics is one ingest keyed them on, with as many datapoints", () => {
    for (const projectId of [PROJECT_ID, CORPUS_PROJECT_ID]) {
      expect({
        projectId,
        found: sorted(
          foundCounts(projectId, metricQueues(projectId), "brokerMetrics"),
        ),
      }).toEqual({
        projectId,
        found: sorted(expectedDatapointCounts(datapoints, projectId, true)),
      });
    }
  });

  test("every queue the cron finds in the messaging client metrics is one ingest keyed them on, with as many datapoints", () => {
    for (const projectId of [PROJECT_ID, CORPUS_PROJECT_ID]) {
      expect({
        projectId,
        found: sorted(
          foundCounts(projectId, metricQueues(projectId), "clientMetrics"),
        ),
      }).toEqual({
        projectId,
        found: sorted(expectedDatapointCounts(datapoints, projectId, false)),
      });
    }
  });

  test("the scenario project's queues are exactly the ones its fixtures declare", () => {
    const declared: Array<string> = Array.from(
      new Set<string>(
        [...SCENARIO_SPANS, ...SCENARIO_METRICS]
          .filter((fixture: QueueSpanFixture | QueueMetricFixture): boolean => {
            return (
              Boolean(fixture.queue) &&
              !fixture.unread &&
              (fixture.projectId || PROJECT_ID) === PROJECT_ID
            );
          })
          .map((fixture: QueueSpanFixture | QueueMetricFixture): string => {
            return fixture.queue!;
          }),
      ),
    ).sort();

    const merged: Array<DiscoveredMessageQueue> = mergeDiscoveredMessageQueues(
      spanQueues(PROJECT_ID),
      metricQueues(PROJECT_ID),
    );

    expect(
      merged
        .map((queue: DiscoveredMessageQueue): string => {
          return queue.identifier;
        })
        .sort(),
    ).toEqual(declared);
  });

  test("temporary, generated, SERVER and non-messaging telemetry names no queue", () => {
    const merged: Array<DiscoveredMessageQueue> = mergeDiscoveredMessageQueues(
      spanQueues(PROJECT_ID),
      metricQueues(PROJECT_ID),
    );
    const destinations: Array<string> = merged.map(
      (queue: DiscoveredMessageQueue): string => {
        return queue.identity.destination;
      },
    );

    for (const destination of [
      "server-only-topic",
      "server-remapped-topic",
      "amq.gen-JzTY20BRgKO-HjmUJj0wLg".toLowerCase(),
      "not-a-queue",
      "-namespaceonlymetric-",
      "stale-topic",
      "other-project-topic",
      "late-topic",
      "ancient",
      "jobs",
      "renamed-topic",
      OVERLONG_DESTINATION.toLowerCase(),
    ]) {
      expect(destinations).not.toContain(destination);
    }

    // No SERVER span is even read, nor another Azure service's.
    for (const row of spanRows.get(PROJECT_ID)!) {
      expect(row.kind).not.toBe(SpanKind.Server);
      expect(row[getMessagingDiscoveryColumn(4)]).not.toBe("Microsoft.Storage");
    }
    expect(MESSAGING_RESOLVER_INPUT_ATTRIBUTES[4]).toBe("az.namespace");

    // The flagged-temporary spans are read, and counted towards no queue.
    const orders: DiscoveredMessageQueue | undefined = merged.find(
      (queue: DiscoveredMessageQueue): boolean => {
        return queue.identifier === "kafka||orders";
      },
    );
    expect(orders?.spans?.count).toBe(12 + 5);
  });

  test("spans whose kind a trace pipeline rewrote are found as ingest keyed them: any kind but SERVER, a missing one included", async () => {
    const REMAPPED: ReadonlyArray<string> = [
      "bare-kind-orders",
      "kindless-orders",
      "remapped-orders",
      "server-remapped-topic",
    ];
    const destinationColumn: string = getMessagingDiscoveryColumn(
      MESSAGING_RESOLVER_INPUT_ATTRIBUTES.indexOf("messaging.destination.name"),
    );

    // Stored as the real pipeline wrote them: NULL for the kindless spans.
    expect(
      await query<{ destination: string; kind: string | null }>(
        `SELECT DISTINCT attributes['messaging.destination.name'] AS destination, kind FROM oneuptime.${spanTable} WHERE projectId = '${PROJECT_ID}' AND attributes['messaging.destination.name'] IN (${REMAPPED.map(
          (destination: string): string => {
            return `'${destination}'`;
          },
        ).join(", ")}) ORDER BY destination`,
      ),
    ).toEqual([
      { destination: "bare-kind-orders", kind: "PRODUCER" },
      { destination: "kindless-orders", kind: null },
      { destination: "remapped-orders", kind: "SPAN_KIND_UNSPECIFIED" },
      { destination: "server-remapped-topic", kind: "server" },
    ]);

    // The query reads all four: it leaves out SPAN_KIND_SERVER alone.
    expect(
      spanRows
        .get(PROJECT_ID)!
        .filter((row: MessagingSpanDiscoveryRow): boolean => {
          return REMAPPED.includes(String(row[destinationColumn]));
        })
        .map((row: MessagingSpanDiscoveryRow): [string, string | null] => {
          return [String(row[destinationColumn]), row.kind ?? null];
        })
        .sort(
          (a: [string, string | null], b: [string, string | null]): number => {
            return a[0].localeCompare(b[0]);
          },
        ),
    ).toEqual([
      ["bare-kind-orders", "PRODUCER"],
      ["kindless-orders", null],
      ["remapped-orders", "SPAN_KIND_UNSPECIFIED"],
      ["server-remapped-topic", "server"],
    ]);

    /*
     * Every queue ingest keyed them on is found, with all its spans, in the
     * direction the rewritten kind (or its absence) gives at ingest.
     */
    const found: (identifier: string) => DiscoveredMessageQueue | undefined = (
      identifier: string,
    ): DiscoveredMessageQueue | undefined => {
      return spanQueues(PROJECT_ID).find(
        (queue: DiscoveredMessageQueue): boolean => {
          return queue.identifier === identifier;
        },
      );
    };
    expect(found("kafka||remapped-orders")?.spans).toMatchObject({
      count: 5,
      directions: { publish: 0, consume: 5, settle: 0, unknown: 0 },
    });
    expect(found("kafka||kindless-orders")?.spans).toMatchObject({
      count: 3,
      directions: { publish: 0, consume: 0, settle: 0, unknown: 3 },
    });
    expect(found("kafka||bare-kind-orders")?.spans).toMatchObject({
      count: 3,
      directions: { publish: 3, consume: 0, settle: 0, unknown: 0 },
    });

    // Another spelling of SERVER: keyed on nothing at ingest, found as nothing.
    for (const span of spans) {
      if (span.kind === "server") {
        expect(span.queueKey).toBeNull();
      }
    }
    expect(found("kafka||server-remapped-topic")).toBeUndefined();
  });

  test("twelve pods' spans of one topic are ONE row: nothing per instance is grouped on", () => {
    const column: (key: string) => string = (key: string): string => {
      const index: number = MESSAGING_RESOLVER_INPUT_ATTRIBUTES.indexOf(key);
      expect(index).toBeGreaterThanOrEqual(0);
      return getMessagingDiscoveryColumn(index);
    };
    // The Kafka `orders` rows that are not the temporary-flagged ones.
    const kafkaOrders: (kind: SpanKind) => Array<MessagingSpanDiscoveryRow> = (
      kind: SpanKind,
    ): Array<MessagingSpanDiscoveryRow> => {
      return spanRows
        .get(PROJECT_ID)!
        .filter((row: MessagingSpanDiscoveryRow): boolean => {
          return (
            row.kind === kind &&
            row[column("messaging.system")] === "kafka" &&
            row[column("messaging.destination.name")] === "orders" &&
            row[column("messaging.destination.temporary")] === ""
          );
        });
    };

    const producers: Array<MessagingSpanDiscoveryRow> = kafkaOrders(
      SpanKind.Producer,
    );
    expect(producers).toHaveLength(1);
    expect(Number(producers[0]!.spanCount)).toBe(12);

    const consumers: Array<MessagingSpanDiscoveryRow> = kafkaOrders(
      SpanKind.Consumer,
    );
    expect(consumers).toHaveLength(1);
    expect(Number(consumers[0]!.spanCount)).toBe(5);

    // No column of any row holds a per-instance value.
    for (const row of spanRows.get(PROJECT_ID)!) {
      for (const value of Object.values(row)) {
        const text: string = String(value);
        expect(text).not.toMatch(
          /^(orders-api-|billing-|instance-|producer-|consumer-|message-)\d+$/,
        );
      }
    }

    // …and six partitions' offsets are one row too.
    const offsets: Array<MessagingMetricDiscoveryRow> = metricRows
      .get(PROJECT_ID)!
      .filter((row: MessagingMetricDiscoveryRow): boolean => {
        return row.name === "kafka.partition.current_offset";
      });
    expect(offsets).toHaveLength(1);
    expect(Number(offsets[0]!.pointCount)).toBe(6);
  });

  test("failures and directions are counted per queue", () => {
    const orders: DiscoveredMessageQueue | undefined = spanQueues(
      PROJECT_ID,
    ).find((queue: DiscoveredMessageQueue): boolean => {
      return queue.identifier === "kafka||orders";
    });
    expect(orders?.spans?.errorCount).toBe(2);
    expect(orders?.spans?.directions).toEqual({
      publish: 12,
      consume: 5,
      settle: 0,
      unknown: 0,
    });
  });

  test("late cloud-monitoring datapoints are read, at the newest datapoint's own time; late scrapes are not", () => {
    const refunds: DiscoveredMessageQueue | undefined = metricQueues(
      PROJECT_ID,
    ).find((queue: DiscoveredMessageQueue): boolean => {
      return queue.identifier === "aws_sqs||refunds";
    });

    expect(refunds?.brokerMetrics?.count).toBe(3);
    const newest: number = Math.max(
      ...datapoints
        .filter((datapoint: InsertedDatapoint): boolean => {
          return (
            datapoint.projectId === PROJECT_ID &&
            datapoint.queueKey === queueKeyOf(PROJECT_ID, "aws_sqs||refunds")
          );
        })
        .map((datapoint: InsertedDatapoint): number => {
          return datapoint.timeMs;
        }),
    );
    expect(refunds?.brokerMetrics?.lastSeenAt?.getTime()).toBe(newest);
    expect(newest).toBeLessThan(WINDOW_START.getTime());

    const identifiers: Array<string> = metricQueues(PROJECT_ID).map(
      (queue: DiscoveredMessageQueue): string => {
        return queue.identifier;
      },
    );
    expect(identifiers).not.toContain("kafka||late-topic");
    expect(identifiers).not.toContain("aws_sqs||ancient");
    expect(MESSAGE_QUEUE_LATE_METRIC_NAMES).toContain(
      "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
    );
  });

  test("a whitespace-padded Azure provider value is read; other Azure services' spans are not", () => {
    const namespace: string = getMessagingDiscoveryColumn(
      MESSAGING_RESOLVER_INPUT_ATTRIBUTES.indexOf("az.namespace"),
    );
    const values: Array<unknown> = spanRows
      .get(PROJECT_ID)!
      .map((row: MessagingSpanDiscoveryRow): unknown => {
        return row[namespace];
      });

    expect(values).toContain(PADDED_SERVICE_BUS_NAMESPACE);
    expect(values).not.toContain("Microsoft.Storage");

    const serviceBus: DiscoveredMessageQueue | undefined = spanQueues(
      PROJECT_ID,
    ).find((queue: DiscoveredMessageQueue): boolean => {
      return queue.identifier === "servicebus|orders-prod|orders";
    });
    // Send ×3, subscription receive ×2, dead-letter receive, the JS receive.
    expect(serviceBus?.spans?.count).toBe(7);
  });

  test("JMS spans and the ActiveMQ JMX Scraper's metrics are one queue, recorded as ActiveMQ", () => {
    const [jms]: Array<DiscoveredMessageQueue> = mergeDiscoveredMessageQueues(
      spanQueues(PROJECT_ID),
      metricQueues(PROJECT_ID),
    ).filter((queue: DiscoveredMessageQueue): boolean => {
      return queue.identifier === "jms||orders";
    });

    expect(jms?.system).toBe("activemq");
    expect(jms?.spans?.count).toBe(2);
    expect(jms?.brokerMetrics?.count).toBe(3);
  });

  test("an application's own gauge and a renamed curated metric are keyed at ingest but never read", () => {
    for (const label of [
      "An application's own BullMQ queue.size gauge",
      "A curated name a RenameMetric rule stored in mixed case",
    ]) {
      for (const datapoint of datapoints.filter(
        (entry: InsertedDatapoint): boolean => {
          return entry.label === label;
        },
      )) {
        expect(datapoint.queueKey).not.toBeNull();
      }
    }

    for (const row of metricRows.get(PROJECT_ID)!) {
      expect(row.name).not.toBe("queue.size");
      expect(row.name).not.toBe("Kafka.Consumer_Group.Lag_Sum");
    }
  });

  test("a Pulsar per-consumer repeat folds into its topic's group and names no queue of its own", () => {
    for (const row of metricRows.get(PROJECT_ID)!) {
      for (const value of Object.values(row)) {
        expect(value).not.toBe("billing-1");
      }
    }

    const pulsar: DiscoveredMessageQueue | undefined = metricQueues(
      PROJECT_ID,
    ).find((queue: DiscoveredMessageQueue): boolean => {
      return queue.identifier === "pulsar||persistent://public/default/orders";
    });
    // Backlog ×2 and subscription throughput ×2 stamped; the 2 repeats fold in.
    expect(pulsar?.brokerMetrics?.count).toBe(6);
    expect(pulsar?.brokerMetrics?.brokerAddress).toBe("pulsar-broker-0:8080");
  });

  test("the project scan finds every project the metric query would read, and no other", async () => {
    const projects: Array<{ projectId: string }> = await query<{
      projectId: string;
    }>(
      buildMessagingMetricProjectsSql({
        startSql: START_SQL,
        endSql: END_SQL,
        maxProjects: 1000,
      }),
    );

    expect(
      projects
        .map((entry: { projectId: string }): string => {
          return entry.projectId;
        })
        .sort(),
    ).toEqual(
      // Not GAUGE_ONLY_PROJECT_ID: an application's own gauge is not read.
      [
        PROJECT_ID,
        CORPUS_PROJECT_ID,
        OTHER_PROJECT_ID,
        LATE_ONLY_PROJECT_ID,
      ].sort(),
    );
  });

  test("with a tight row cap, the busiest groups win", async () => {
    const all: Array<MessagingSpanDiscoveryRow> = spanRows.get(PROJECT_ID)!;
    const capped: Array<MessagingSpanDiscoveryRow> = await runSpanQuery(
      PROJECT_ID,
      2,
    );

    expect(capped).toHaveLength(2);
    const counts: Array<number> = all
      .map((row: MessagingSpanDiscoveryRow): number => {
        return Number(row.spanCount);
      })
      .sort((a: number, b: number): number => {
        return b - a;
      });
    expect(
      capped.map((row: MessagingSpanDiscoveryRow): number => {
        return Number(row.spanCount);
      }),
    ).toEqual(counts.slice(0, 2));

    const cappedMetrics: Array<MessagingMetricDiscoveryRow> =
      await runMetricQuery(PROJECT_ID, 1);
    expect(cappedMetrics).toHaveLength(1);
  });
});

describe("Message queue discovery ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
