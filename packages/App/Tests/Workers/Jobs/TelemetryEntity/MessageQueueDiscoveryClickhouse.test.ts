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
  MESSAGE_QUEUE_DISCOVERY_MAX_EXECUTION_SECONDS,
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
  MessagingDirection,
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
  NUMERIC_SPAN_KIND_CASES,
  NumericSpanKindCase,
  SPAN_FIXTURES,
  toStoredKind,
} from "Common/Tests/Types/MessageQueue/MessagingTelemetryFixtures";
import {
  StoredSpan,
  spanQueryGroupKey,
  spanQueryRowGroupKey,
} from "Common/Tests/Server/Utils/Telemetry/MessageQueueSpanQueryTwin";
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
 *      TracePipelineService runs before the stamper, as at ingest), to a
 *      NUMBER too, which the stamper sees and ClickHouse stores as text;
 *   2. temporary, generated, SERVER and non-messaging telemetry names none;
 *   3. the spans and datapoints counted per queue are the ones stamped with
 *      its key;
 *   4. nothing per instance is grouped on: twelve pods' spans are one row;
 *   5. values that vary per message are folded exactly as the query's
 *      TypeScript twin says (ClickHouse's groups are the twin's, over every
 *      stored span), so five million acknowledgement and inbox subjects in
 *      a window are no group at all;
 *   6. over its row cap, every messaging system and every metric keeps its
 *      share: a busy source never crowds out a quiet one, and rows that tie
 *      are cut differently every run, so every queue is sighted;
 *   7. a query that runs out of time fails with ClickHouse's own timeout
 *      error — where a 'break' would answer with no rows at all.
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
// Spans whose values vary per message (PER_MESSAGE_SPANS).
const PER_MESSAGE_PROJECT_ID: string = "3e4f5061-7283-4a4b-9c5d-6e7f80910a1b";
/*
 * Projects the row-cap tests fill themselves, after every other test has
 * read its own (the project scan test lists the metric projects exactly).
 */
const FLOOD_PROJECT_ID: string = "4f506172-8394-4b5c-8d6e-7f8091a2b3c4";
const TIED_PROJECT_ID: string = "50617283-94a5-4c6d-9e7f-8091a2b3c4d5";
const CROWDED_PROJECT_ID: string = "61728394-a5b6-4d7e-8f90-91a2b3c4d5e6";
// Spans the time-limit tests fill in, too many to read in their limit.
const SLOW_PROJECT_ID: string = "728394a5-b6c7-4e8f-9a01-a2b3c4d5e6f7";

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
   * them, and are stored with the kind it wrote. A mapping saved through
   * the API is any JSON: `to: undefined` is one without a kind (stored
   * NULL), and a number is written as the number (stored as its text).
   */
  remapKind?: { to: string | number | undefined };
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

/*
 * Kafka producers a pipeline remapped to each numeric kind of the core's
 * table (NUMERIC_SPAN_KIND_CASES: OTLP's numbers as numbers and as digits,
 * zero-padded, out of range, not plain digits), each on a topic of its own.
 * OTLP's SERVER in every form keys no queue at ingest and must name none
 * here; every other kind names its topic.
 */
function numericKindTopic(index: number): string {
  return `numeric-kind-${index}`;
}

const NUMERIC_KIND_SPANS: Array<QueueSpanFixture> = NUMERIC_SPAN_KIND_CASES.map(
  (entry: NumericSpanKindCase, index: number): QueueSpanFixture => {
    return {
      label: `Kafka spans a pipeline remapped to the kind ${JSON.stringify(entry.kind)}`,
      kind: SpanKind.Producer,
      remapKind: { to: entry.kind },
      attributes: kafka(numericKindTopic(index)),
      count: 2,
      queue:
        entry.reads === SpanKind.Server
          ? null
          : `kafka||${numericKindTopic(index)}`,
    };
  },
);

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
  ...NUMERIC_KIND_SPANS,
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
 * ---- Spans whose values vary per message ------------------------------------
 *
 * Every span below carries a value of its own — an acknowledgement subject,
 * a reply inbox, a routing key or a subject beside its template — which the
 * resolver reads no more than a placeholder of, or names no queue for. The
 * span query folds them (MessageQueueDiscovery, "Values that vary per
 * message"), so each shape is one group, or none. The last few are the
 * rules' edges, which must stay a group per value.
 */
const PER_MESSAGE_COPIES: number = 400;

interface PerMessageSpanFixture extends QueueSpanFixture {
  // The queue each copy names, where the copies name different ones.
  queueOfCopy?: ((copy: number) => string | null) | undefined;
}

function perMessage(
  label: string,
  kind: SpanKind,
  queue: string | null | ((copy: number) => string | null),
  perCopy: (copy: number) => FixtureAttributes,
  count: number = PER_MESSAGE_COPIES,
): PerMessageSpanFixture {
  return {
    label: label,
    kind: kind,
    attributes: {},
    count: count,
    perCopy: perCopy,
    projectId: PER_MESSAGE_PROJECT_ID,
    queue: typeof queue === "function" ? null : queue,
    queueOfCopy: typeof queue === "function" ? queue : undefined,
  };
}

const PER_MESSAGE_SPANS: Array<PerMessageSpanFixture> = [
  perMessage(
    "JetStream acknowledgements named by their whole subject (the Java agent's default)",
    SpanKind.Client,
    null,
    (copy: number): FixtureAttributes => {
      return {
        "messaging.system": "nats",
        "messaging.destination.name": `$JS.ACK.ORDERS.billing.1.${copy}.${copy}.1727698123456789012.0`,
        "messaging.operation": "settle",
        "messaging.client_id": String(copy % 4),
      };
    },
  ),
  perMessage(
    "JetStream acknowledgements beside their template",
    SpanKind.Client,
    null,
    (copy: number): FixtureAttributes => {
      return {
        "messaging.system": "NATS",
        "messaging.destination.template": "$JS.ACK",
        "messaging.destination.name": `$JS.ACK.ORDERS.billing.1.${copy}.${copy}.1727698123456789012.0`,
      };
    },
  ),
  perMessage(
    "NATS request inboxes (stable semconv: template, name and flag)",
    SpanKind.Producer,
    null,
    (copy: number): FixtureAttributes => {
      return {
        "messaging.system": "nats",
        "messaging.destination.template": "_INBOX.",
        "messaging.destination.name": `_INBOX.k3qTbUQ4AkVZe9L1u8A${copy}`,
        "messaging.destination.temporary": true,
        "messaging.operation.type": "send",
      };
    },
  ),
  perMessage(
    "RabbitMQ topic exchange publishes, the order id in the routing key",
    SpanKind.Producer,
    "rabbitmq||events",
    (copy: number): FixtureAttributes => {
      return {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "events",
        "messaging.rabbitmq.destination.routing_key": `order.${copy}.created`,
        "messaging.operation": "publish",
        "network.peer.address": "10.0.0.5",
        "network.peer.port": 5672,
      };
    },
  ),
  perMessage(
    "NATS subjects beside their template",
    SpanKind.Producer,
    "nats||orders.{id}",
    (copy: number): FixtureAttributes => {
      return {
        "messaging.system": "nats",
        "messaging.destination.template": "orders.{id}",
        "messaging.destination.name": `orders.${copy}`,
      };
    },
  ),
  perMessage(
    "Kafka reply topics named per request (templated by the resolver, folded by no rule)",
    SpanKind.Producer,
    "kafka||reply-{uuid}",
    (copy: number): FixtureAttributes => {
      return kafka(
        `reply-7f1c2a9e-4b1d-4c3e-9f1a-${String(copy).padStart(12, "0")}`,
      );
    },
    20,
  ),
  perMessage(
    "RabbitMQ consumers' joined names, a routing key per message (folded by no rule)",
    SpanKind.Consumer,
    "rabbitmq||billing",
    (copy: number): FixtureAttributes => {
      return {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": `events:order.${copy}.created:billing`,
        "messaging.rabbitmq.destination.routing_key": `order.${copy}.created`,
        "messaging.operation.type": "process",
      };
    },
    3,
  ),
  perMessage(
    "RabbitMQ default exchange in upper case: its routing key is the queue",
    SpanKind.Producer,
    "rabbitmq||invoices",
    (): FixtureAttributes => {
      return {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "AMQ.Default",
        "messaging.rabbitmq.destination.routing_key": "invoices",
      };
    },
    3,
  ),
  perMessage(
    "A template that is only a no-break space: the names beside it stay",
    SpanKind.Producer,
    (copy: number): string => {
      return `nats||orders.${copy}`;
    },
    (copy: number): FixtureAttributes => {
      return {
        "messaging.system": "nats",
        "messaging.destination.template": String.fromCharCode(0xa0),
        "messaging.destination.name": `orders.${copy}`,
      };
    },
    3,
  ),
  perMessage(
    "Kafka topics beside all of it",
    SpanKind.Producer,
    (copy: number): string => {
      return `kafka||per-message-topic-${copy % 5}`;
    },
    (copy: number): FixtureAttributes => {
      return kafka(`per-message-topic-${copy % 5}`);
    },
    20,
  ),
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
  /*
   * As the row carries it into the insert: the SpanKind string, or what a
   * Span Kind Remapper wrote — a number included, whose text ClickHouse
   * stores — or null when a mapping left the span without a kind.
   */
  kind: string | number | null;
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
function kindRemapper(
  to: string | number | undefined,
): Array<LoadedTracePipeline> {
  const config: SpanKindRemapperConfig = {
    sourceKey: "messaging.system",
    /*
     * The type says string; a configuration saved through the API is any
     * JSON: a mapping without a kind leaves the span without one, and a
     * number is written to the row as the number.
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
    remapKind?: { to: string | number | undefined } | undefined;
    minutesAgo: number;
    failed: boolean;
    attributes: FixtureAttributes;
    read: boolean;
  }) => void = (data: {
    label: string;
    projectId: string;
    kind: string;
    remapKind?: { to: string | number | undefined } | undefined;
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
    const kind: unknown = row["kind"];
    spans.push({
      label: data.label,
      projectId: data.projectId,
      kind: typeof kind === "string" || typeof kind === "number" ? kind : null,
      startMs: now - data.minutesAgo * 60 * 1000 - index * 10,
      failed: data.failed,
      attributes: data.attributes,
      queueKey: stampedKey(row),
      read: data.read,
    });
  };

  for (const fixture of [...SCENARIO_SPANS, ...PER_MESSAGE_SPANS]) {
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
      /*
       * As ingest inserts it: `kind` is Nullable (a span a pipeline left
       * kindless is stored NULL), and a remapper's number is stored as its
       * text.
       */
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

// The span query column that holds a resolver input key.
function columnOf(key: string): string {
  const index: number = MESSAGING_RESOLVER_INPUT_ATTRIBUTES.indexOf(key);
  if (index < 0) {
    throw new Error(`Not a span query column: ${key}`);
  }
  return getMessagingDiscoveryColumn(index);
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
    spanRows.set(
      PER_MESSAGE_PROJECT_ID,
      await runSpanQuery(PER_MESSAGE_PROJECT_ID, 5000),
    );
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

    /*
     * The flagged-temporary spans are left out before grouping (the query's
     * rule 1), and counted towards no queue.
     */
    const orders: DiscoveredMessageQueue | undefined = merged.find(
      (queue: DiscoveredMessageQueue): boolean => {
        return queue.identifier === "kafka||orders";
      },
    );
    expect(orders?.spans?.count).toBe(12 + 5);
    for (const row of spanRows.get(PROJECT_ID)!) {
      expect(row[columnOf("messaging.destination.temporary")]).not.toBe("true");
    }
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

  test('numeric kinds a remapper wrote: ClickHouse keeps their text, and the cron reads it as ingest read the value — 2, "2" and "02" as SERVER', async () => {
    const topics: Array<string> = NUMERIC_SPAN_KIND_CASES.map(
      (_entry: NumericSpanKindCase, index: number): string => {
        return numericKindTopic(index);
      },
    );
    const byDestination: (
      a: { destination: string },
      b: { destination: string },
    ) => number = (
      a: { destination: string },
      b: { destination: string },
    ): number => {
      return a.destination.localeCompare(b.destination);
    };

    // The stamper saw the kind as the remapper wrote it, a number included…
    NUMERIC_SPAN_KIND_CASES.forEach(
      (entry: NumericSpanKindCase, index: number): void => {
        const inserted: Array<InsertedSpan> = spans.filter(
          (span: InsertedSpan): boolean => {
            return (
              span.attributes["messaging.destination.name"] === topics[index]
            );
          },
        );
        expect(inserted).toHaveLength(2);
        for (const span of inserted) {
          expect({ topic: topics[index], kind: span.kind }).toEqual({
            topic: topics[index],
            kind: entry.kind,
          });
        }
      },
    );

    // …and ClickHouse keeps its JSON text: 2 is stored "2", " 2 " as it is.
    expect(
      (
        await query<{ destination: string; kind: string | null }>(
          `SELECT DISTINCT attributes['messaging.destination.name'] AS destination, kind FROM oneuptime.${spanTable} WHERE projectId = '${PROJECT_ID}' AND startsWith(attributes['messaging.destination.name'], 'numeric-kind-')`,
        )
      ).sort(byDestination),
    ).toEqual(
      NUMERIC_SPAN_KIND_CASES.map(
        (
          entry: NumericSpanKindCase,
          index: number,
        ): { destination: string; kind: string | null } => {
          return {
            destination: topics[index]!,
            kind: toStoredKind(entry.kind),
          };
        },
      ).sort(byDestination),
    );

    // The query reads every one of them: it leaves out SPAN_KIND_SERVER alone…
    const destinationColumn: string = getMessagingDiscoveryColumn(
      MESSAGING_RESOLVER_INPUT_ATTRIBUTES.indexOf("messaging.destination.name"),
    );
    expect(
      spanRows
        .get(PROJECT_ID)!
        .filter((row: MessagingSpanDiscoveryRow): boolean => {
          return topics.includes(String(row[destinationColumn]));
        })
        .map(
          (
            row: MessagingSpanDiscoveryRow,
          ): { destination: string; kind: string | null; spans: number } => {
            return {
              destination: String(row[destinationColumn]),
              kind: row.kind ?? null,
              spans: Number(row.spanCount),
            };
          },
        )
        .sort(byDestination),
    ).toEqual(
      NUMERIC_SPAN_KIND_CASES.map(
        (
          entry: NumericSpanKindCase,
          index: number,
        ): { destination: string; kind: string | null; spans: number } => {
          return {
            destination: topics[index]!,
            kind: toStoredKind(entry.kind),
            spans: 2,
          };
        },
      ).sort(byDestination),
    );

    /*
     * …and resolves each exactly as ingest resolved the value: OTLP's
     * SERVER (2, "2", "02", " 2 ") to nothing — no key was stamped on those
     * spans — and every other kind to the queue whose key its spans carry,
     * in the direction that kind gives.
     */
    NUMERIC_SPAN_KIND_CASES.forEach(
      (entry: NumericSpanKindCase, index: number): void => {
        const queue: DiscoveredMessageQueue | undefined = spanQueues(
          PROJECT_ID,
        ).find((candidate: DiscoveredMessageQueue): boolean => {
          return candidate.identifier === `kafka||${topics[index]}`;
        });
        const stamped: Array<string | null> = spans
          .filter((span: InsertedSpan): boolean => {
            return (
              span.attributes["messaging.destination.name"] === topics[index]
            );
          })
          .map((span: InsertedSpan): string | null => {
            return span.queueKey;
          });

        if (entry.reads === SpanKind.Server) {
          expect({ kind: entry.kind, stamped, found: queue }).toEqual({
            kind: entry.kind,
            stamped: [null, null],
            found: undefined,
          });
          return;
        }

        const direction: MessagingDirection =
          entry.reads === SpanKind.Producer
            ? "publish"
            : entry.reads === SpanKind.Consumer
              ? "consume"
              : "unknown";
        const key: string = queueKeyOf(PROJECT_ID, `kafka||${topics[index]}`);
        expect({
          kind: entry.kind,
          stamped,
          found: queue?.spans?.count,
          direction: queue?.spans?.directions[direction],
        }).toEqual({
          kind: entry.kind,
          stamped: [key, key],
          found: 2,
          direction: 2,
        });
      },
    );
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

  test("the per-message fixtures name what they say, copy by copy", () => {
    for (const fixture of PER_MESSAGE_SPANS) {
      const stamped: Array<string | null> = spans
        .filter((span: InsertedSpan): boolean => {
          return span.label === fixture.label;
        })
        .map((span: InsertedSpan): string | null => {
          return span.queueKey;
        });
      expect(stamped).toHaveLength(fixture.count || 1);
      stamped.forEach((key: string | null, copy: number): void => {
        const queue: string | null = fixture.queueOfCopy
          ? fixture.queueOfCopy(copy)
          : fixture.queue;
        expect({ fixture: fixture.label, copy, key }).toEqual({
          fixture: fixture.label,
          copy,
          key: queue ? queueKeyOf(PER_MESSAGE_PROJECT_ID, queue) : null,
        });
      });
    }
  });

  test("ClickHouse groups the spans exactly as the query's TypeScript twin does, over every stored span", async () => {
    for (const projectId of [
      PROJECT_ID,
      CORPUS_PROJECT_ID,
      PER_MESSAGE_PROJECT_ID,
    ]) {
      const stored: Array<StoredSpan> = await query<StoredSpan>(
        `SELECT kind, attributeKeys, attributes FROM oneuptime.${spanTable} WHERE projectId = '${projectId}' AND startTime >= ${START_SQL} AND startTime < ${END_SQL}`,
      );
      expect(stored.length).toBeGreaterThan(10);

      const expected: Map<string, number> = new Map<string, number>();
      for (const span of stored) {
        const group: string | null = spanQueryGroupKey(span);
        if (group !== null) {
          addCount(expected, group, 1);
        }
      }
      const found: Map<string, number> = new Map<string, number>();
      for (const row of spanRows.get(projectId)!) {
        addCount(found, spanQueryRowGroupKey(row), Number(row.spanCount));
      }

      expect({ projectId, groups: sorted(found) }).toEqual({
        projectId,
        groups: sorted(expected),
      });
    }
  });

  test("values that vary per message are one group per shape, or none — and every queue is the one ingest keyed", () => {
    const rows: Array<MessagingSpanDiscoveryRow> = spanRows.get(
      PER_MESSAGE_PROJECT_ID,
    )!;
    const withValue: (
      key: string,
      value: string,
    ) => Array<MessagingSpanDiscoveryRow> = (
      key: string,
      value: string,
    ): Array<MessagingSpanDiscoveryRow> => {
      return rows.filter((row: MessagingSpanDiscoveryRow): boolean => {
        return row[columnOf(key)] === value;
      });
    };

    // No acknowledgement subject or inbox is read at all.
    for (const row of rows) {
      for (const key of [
        "messaging.destination.template",
        "messaging.destination.name",
      ]) {
        expect(String(row[columnOf(key)])).not.toMatch(/^(\$js\.ack|_inbox)/i);
      }
    }

    // Routing keys beside their exchange: one row, the key blank.
    const routed: Array<MessagingSpanDiscoveryRow> = withValue(
      "messaging.destination.name",
      "events",
    );
    expect(routed).toHaveLength(1);
    expect(Number(routed[0]!.spanCount)).toBe(PER_MESSAGE_COPIES);
    expect(
      routed[0]![columnOf("messaging.rabbitmq.destination.routing_key")],
    ).toBe("");

    // Subjects beside their template: one row, the subject a placeholder.
    const templated: Array<MessagingSpanDiscoveryRow> = withValue(
      "messaging.destination.template",
      "orders.{id}",
    );
    expect(templated).toHaveLength(1);
    expect(Number(templated[0]!.spanCount)).toBe(PER_MESSAGE_COPIES);
    expect(templated[0]![columnOf("messaging.destination.name")]).toBe("*");

    /*
     * The rules' edges stay a row per value — 20 reply topics, 3 joined
     * names, 3 subjects beside a blank template — beside the default
     * exchange's publishes and the 5 topics.
     */
    expect(rows).toHaveLength(1 + 1 + 20 + 3 + 3 + 1 + 5);

    expect(
      sorted(
        foundCounts(
          PER_MESSAGE_PROJECT_ID,
          spanQueues(PER_MESSAGE_PROJECT_ID),
          "spans",
        ),
      ),
    ).toEqual(sorted(stampedSpanCounts(spans, PER_MESSAGE_PROJECT_ID)));
  });

  /*
   * ---- The row cap ---------------------------------------------------------
   *
   * The tests below fill projects of their own with SQL, so they run last:
   * the project scan test above lists every metric project exactly.
   */
  function windowSql(date: Date): string {
    return `toDateTime64('${OneUptimeDate.toClickhouseDateTime64(date)}', 9)`;
  }

  const retention: string = `toDateTime(toDate('${retentionDate}'))`;

  async function insertSpans(data: {
    projectId: string;
    // Spans numbered from `from`.
    from: number;
    count: number;
    // SQL over `number`: the attribute map and the stored kind.
    attributesSql: string;
    kindSql: string;
    // SQL: the newest start; the spans reach five minutes further back.
    newestSql: string;
  }): Promise<void> {
    await client.command({
      query: `INSERT INTO ${database}.${spanTable} (projectId, primaryEntityId, primaryEntityType, startTime, endTime, startTimeUnixNano, endTimeUnixNano, durationUnixNano, traceId, spanId, parentSpanId, attributes, attributeKeys, entityKeys, statusCode, name, kind, retentionDate)
        SELECT '${data.projectId}', 'service', 'OpenTelemetry', startedAt, startedAt, toUInt64(toUnixTimestamp64Nano(startedAt)), toUInt64(toUnixTimestamp64Nano(startedAt)), toInt128(1000000), concat('trace-', toString(number)), concat('span-', toString(number)), '', spanAttributes, mapKeys(spanAttributes), [], ${SpanStatus.Unset}, 'messaging', ${data.kindSql}, ${retention}
        FROM (
          SELECT number, ${data.newestSql} - toIntervalMillisecond(number % 300000) AS startedAt, ${data.attributesSql} AS spanAttributes
          FROM numbers(${data.from}, ${data.count})
        )`,
    });
  }

  async function insertDatapoints(data: {
    projectId: string;
    count: number;
    // SQL over `number`: the metric name and the attribute map.
    nameSql: string;
    attributesSql: string;
    // SQL: the newest time; the datapoints reach a minute further back.
    newestSql: string;
  }): Promise<void> {
    await client.command({
      query: `INSERT INTO ${database}.${metricTable} (projectId, primaryEntityId, primaryEntityType, name, metricPointType, time, timeUnixNano, value, attributes, attributeKeys, entityKeys, retentionDate)
        SELECT '${data.projectId}', 'service', 'OpenTelemetry', metricName, 'Gauge', takenAt, toUInt64(toUnixTimestamp64Nano(takenAt)), 1, pointAttributes, mapKeys(pointAttributes), [], ${retention}
        FROM (
          SELECT number, ${data.newestSql} - toIntervalSecond(number % 60) AS takenAt, ${data.nameSql} AS metricName, ${data.attributesSql} AS pointAttributes
          FROM numbers(${data.count})
        )`,
    });
  }

  function identifiersOf(queues: Array<DiscoveredMessageQueue>): Array<string> {
    return queues.map((queue: DiscoveredMessageQueue): string => {
      return queue.identifier;
    });
  }

  const SQS_CLOUDWATCH_METRICS: Array<string> = [
    "amazonaws.com/aws/sqs/approximateageofoldestmessage",
    "amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible",
    "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
    "amazonaws.com/aws/sqs/numberofmessagesdeleted",
    "amazonaws.com/aws/sqs/numberofmessagesreceived",
    "amazonaws.com/aws/sqs/numberofmessagessent",
  ];

  // The SQS metric of datapoint `number`, `per` datapoints a metric.
  function sqsMetricSql(per: number): string {
    return `[${SQS_CLOUDWATCH_METRICS.map((name: string): string => {
      return `'${name}'`;
    }).join(", ")}][1 + intDiv(number, ${per})]`;
  }

  test("with a tight row cap, every messaging system keeps its busiest group, and a cap of one the busiest of all", async () => {
    const all: Array<MessagingSpanDiscoveryRow> = spanRows.get(PROJECT_ID)!;
    const system: string = columnOf("messaging.system");
    const busiest: Map<string, number> = new Map<string, number>();
    for (const row of all) {
      const share: string = String(row[system]);
      busiest.set(
        share,
        Math.max(busiest.get(share) || 0, Number(row.spanCount)),
      );
    }
    expect(busiest.size).toBeGreaterThan(5);

    const capped: Array<MessagingSpanDiscoveryRow> = await runSpanQuery(
      PROJECT_ID,
      busiest.size,
    );
    expect(
      capped
        .map((row: MessagingSpanDiscoveryRow): string => {
          return `${String(row[system])} ${Number(row.spanCount)}`;
        })
        .sort(),
    ).toEqual(
      Array.from(busiest.entries())
        .map((entry: [string, number]): string => {
          return `${entry[0]} ${entry[1]}`;
        })
        .sort(),
    );

    const one: Array<MessagingSpanDiscoveryRow> = await runSpanQuery(
      PROJECT_ID,
      1,
    );
    expect(one).toHaveLength(1);
    expect(Number(one[0]!.spanCount)).toBe(
      Math.max(...Array.from(busiest.values())),
    );

    const cappedMetrics: Array<MessagingMetricDiscoveryRow> =
      await runMetricQuery(PROJECT_ID, 1);
    expect(cappedMetrics).toHaveLength(1);
  });

  test("five million acknowledgement and inbox subjects in the window make no group at all: the topics beside them are all found", async () => {
    const newest: string = windowSql(new Date(now - 60 * 1000));
    const subject: string =
      "concat('$JS.ACK.ORDERS.billing.1.', toString(number), '.', toString(number), '.1727698123456789012.', toString(number % 500))";
    // A million at a time, so no insert outlasts the client's timeout.
    for (let batch: number = 0; batch < 5; batch++) {
      await insertSpans({
        projectId: FLOOD_PROJECT_ID,
        from: batch * 1000000,
        count: 1000000,
        attributesSql: `multiIf(
          number % 5 < 2, map('messaging.system', 'nats', 'messaging.destination.name', ${subject}, 'messaging.operation', 'settle', 'messaging.client_id', toString(number % 8)),
          number % 5 < 4, map('messaging.system', 'nats', 'messaging.destination.template', '$JS.ACK', 'messaging.destination.name', ${subject}),
          map('messaging.system', 'nats', 'messaging.destination.template', '_INBOX.', 'messaging.destination.name', concat('_INBOX.', hex(cityHash64(number))), 'messaging.destination.temporary', 'true', 'messaging.operation.type', 'send'))`,
        kindSql: "if(number % 5 < 4, 'SPAN_KIND_CLIENT', 'SPAN_KIND_PRODUCER')",
        newestSql: newest,
      });
    }
    await insertSpans({
      projectId: FLOOD_PROJECT_ID,
      from: 0,
      count: 2000,
      attributesSql:
        "map('messaging.system', 'kafka', 'messaging.destination.name', concat('flood-topic-', toString(number % 100)), 'messaging.operation', 'publish')",
      kindSql: "'SPAN_KIND_PRODUCER'",
      newestSql: newest,
    });

    // The cron's own cap (MAX_MESSAGE_QUEUE_SPAN_ROWS).
    const rows: Array<MessagingSpanDiscoveryRow> = await runSpanQuery(
      FLOOD_PROJECT_ID,
      2000,
    );

    expect(rows).toHaveLength(100);
    const expected: Array<string> = [];
    for (let topic: number = 0; topic < 100; topic++) {
      expected.push(`kafka||flood-topic-${topic} 20`);
    }
    expect(
      resolveMessagingSpanDiscoveryRows(rows)
        .map((queue: DiscoveredMessageQueue): string => {
          return `${queue.identifier} ${queue.spans?.count}`;
        })
        .sort(),
    ).toEqual(expected.sort());
  }, 600000);

  /*
   * CloudWatch's datapoints of 300 SQS queues, six metrics each, two a
   * series: every row ties. A cap of 600 keeps a third of them.
   */
  test("rows that tie are not cut the same way every run: each metric gets its share, and within a few runs every queue is sighted", async () => {
    const end: Date = new Date("2026-01-15T10:00:00.000Z");
    await insertDatapoints({
      projectId: TIED_PROJECT_ID,
      count: 300 * SQS_CLOUDWATCH_METRICS.length * 2,
      nameSql: sqsMetricSql(600),
      attributesSql:
        "map('Dimensions.QueueName', concat('tied-', toString(intDiv(number, 2) % 300)), 'resource.cloud.provider', 'aws')",
      newestSql: windowSql(new Date(end.getTime() - 2 * 60 * 1000)),
    });

    const runs: Array<Set<string>> = [];
    for (let run: number = 0; run < 8; run++) {
      // Every run's window holds every datapoint; only its start moves.
      const rows: Array<MessagingMetricDiscoveryRow> =
        await query<MessagingMetricDiscoveryRow>(
          buildMessagingMetricDiscoverySql({
            projectId: TIED_PROJECT_ID,
            startSql: windowSql(
              new Date(end.getTime() - (15 * 60 + run) * 1000),
            ),
            endSql: windowSql(end),
            maxRows: 600,
          }),
        );
      expect(rows).toHaveLength(600);

      // Each metric gets its share of the cap.
      const perMetric: Map<string, number> = new Map<string, number>();
      for (const row of rows) {
        addCount(perMetric, String(row.name), 1);
      }
      expect(sorted(perMetric)).toEqual(
        SQS_CLOUDWATCH_METRICS.map((name: string): [string, number] => {
          return [name, 100];
        }),
      );

      runs.push(
        new Set<string>(
          identifiersOf(resolveMessagingMetricDiscoveryRows(rows)),
        ),
      );
    }

    const sighted: Set<string> = new Set<string>();
    for (const queues of runs) {
      expect(queues.size).toBeLessThan(300);
      for (const identifier of queues) {
        sighted.add(identifier);
      }
    }
    expect(sighted.size).toBe(300);
    // The sample moves: no two runs sight the same queues.
    expect(
      new Set<string>(
        runs.map((queues: Set<string>): string => {
          return Array.from(queues).sort().join(",");
        }),
      ).size,
    ).toBe(runs.length);
  });

  test("a busy source never crowds out another: every metric's and every messaging system's queues keep their rows", async () => {
    const newest: string = windowSql(new Date(now - 60 * 1000));
    // 150 Kafka topics scraped every few seconds: ten datapoints a series…
    await insertDatapoints({
      projectId: CROWDED_PROJECT_ID,
      count: 150 * 2 * 10,
      nameSql:
        "if(number < 1500, 'kafka.consumer_group.lag_sum', 'kafka.partition.current_offset')",
      attributesSql:
        "if(number < 1500, map('topic', concat('busy-', toString(number % 150)), 'group', 'billing'), map('topic', concat('busy-', toString(number % 150)), 'partition', toString(number % 3)))",
      newestSql: newest,
    });
    // …and 20 SQS queues CloudWatch reports twice a series.
    await insertDatapoints({
      projectId: CROWDED_PROJECT_ID,
      count: 20 * SQS_CLOUDWATCH_METRICS.length * 2,
      nameSql: sqsMetricSql(40),
      attributesSql:
        "map('Dimensions.QueueName', concat('quiet-', toString(intDiv(number, 2) % 20)))",
      newestSql: newest,
    });

    const metricRowsCapped: Array<MessagingMetricDiscoveryRow> =
      await runMetricQuery(CROWDED_PROJECT_ID, 200);
    expect(metricRowsCapped).toHaveLength(200);
    const metricQueueIds: Array<string> = identifiersOf(
      resolveMessagingMetricDiscoveryRows(metricRowsCapped),
    );
    for (let queue: number = 0; queue < 20; queue++) {
      expect(metricQueueIds).toContain(`aws_sqs||quiet-${queue}`);
    }
    // The Kafka metrics share the rest: forty rows each.
    const kafkaRows: Map<string, number> = new Map<string, number>();
    for (const row of metricRowsCapped) {
      if (String(row.name).startsWith("kafka.")) {
        addCount(kafkaRows, String(row.name), 1);
      }
    }
    expect(sorted(kafkaRows)).toEqual([
      ["kafka.consumer_group.lag_sum", 40],
      ["kafka.partition.current_offset", 40],
    ]);

    // Spans alike: 150 busy Kafka topics beside 20 quiet RabbitMQ queues.
    await insertSpans({
      projectId: CROWDED_PROJECT_ID,
      from: 0,
      count: 150 * 6,
      attributesSql:
        "map('messaging.system', 'kafka', 'messaging.destination.name', concat('busy-', toString(number % 150)), 'messaging.operation', 'publish')",
      kindSql: "'SPAN_KIND_PRODUCER'",
      newestSql: newest,
    });
    await insertSpans({
      projectId: CROWDED_PROJECT_ID,
      from: 0,
      count: 20 * 3,
      attributesSql:
        "map('messaging.system', 'rabbitmq', 'messaging.destination.name', concat('quiet-', toString(number % 20)), 'messaging.operation', 'receive')",
      kindSql: "'SPAN_KIND_CONSUMER'",
      newestSql: newest,
    });
    const spanRowsCapped: Array<MessagingSpanDiscoveryRow> = await runSpanQuery(
      CROWDED_PROJECT_ID,
      60,
    );
    expect(spanRowsCapped).toHaveLength(60);
    const spanQueueIds: Array<string> = identifiersOf(
      resolveMessagingSpanDiscoveryRows(spanRowsCapped),
    );
    for (let queue: number = 0; queue < 20; queue++) {
      expect(spanQueueIds).toContain(`rabbitmq||quiet-${queue}`);
    }
    expect(
      spanQueueIds.filter((identifier: string): boolean => {
        return identifier.startsWith("kafka||");
      }),
    ).toHaveLength(40);
  });

  /*
   * ---- The time limit ------------------------------------------------------
   *
   * Every queue query ends on the server at its own time limit, before the
   * cron's client gives up on it (MessageQueueDiscovery, "The queue queries'
   * settings"). Here two million spans, read on one thread, outlast a limit
   * of a quarter of a second, which stands in for the queries' own.
   */
  const SHORT_LIMIT_SECONDS: number = 0.25;
  let slowSpansInserted: Promise<void> | null = null;

  function insertSlowSpans(): Promise<void> {
    if (!slowSpansInserted) {
      slowSpansInserted = (async (): Promise<void> => {
        for (let batch: number = 0; batch < 2; batch++) {
          await insertSpans({
            projectId: SLOW_PROJECT_ID,
            from: batch * 1000000,
            count: 1000000,
            attributesSql:
              "map('messaging.system', 'kafka', 'messaging.destination.name', concat('slow-topic-', toString(number % 100)), 'messaging.operation', 'publish', 'messaging.client_id', toString(number % 50))",
            kindSql: "'SPAN_KIND_PRODUCER'",
            newestSql: windowSql(new Date(now - 60 * 1000)),
          });
        }
      })();
    }
    return slowSpansInserted;
  }

  /*
   * The span query over them as the cron sends it, but for the short limit
   * (and, where given, another overflow mode).
   */
  function slowSpanSql(overflowMode?: "break" | undefined): string {
    const sql: string = buildMessagingSpanDiscoverySql({
      projectId: SLOW_PROJECT_ID,
      startSql: START_SQL,
      endSql: END_SQL,
      maxRows: 2000,
    });
    const limit: string = `max_execution_time = ${MESSAGE_QUEUE_DISCOVERY_MAX_EXECUTION_SECONDS},`;
    expect(sql).toContain(limit);
    const slow: string = sql
      .replace(`FROM oneuptime.${spanTable}`, `FROM ${database}.${spanTable}`)
      .replace(limit, `max_execution_time = ${SHORT_LIMIT_SECONDS},`);
    return overflowMode
      ? slow.replace(
          /timeout_overflow_mode = '[a-z]+'/,
          `timeout_overflow_mode = '${overflowMode}'`,
        )
      : slow;
  }

  test("a queue query that runs out of time fails with ClickHouse's own timeout error", async () => {
    await insertSlowSpans();
    const sql: string = slowSpanSql();

    // Read as the cron reads it: the query, then its rows.
    let failure: unknown = null;
    try {
      const result: { json: () => Promise<unknown> } = await client.query({
        query: sql,
        format: "JSON",
        clickhouse_settings: { max_threads: 1 },
      });
      await result.json();
    } catch (err) {
      failure = err;
    }

    expect(failure).toBeInstanceOf(Error);
    expect({
      code: (failure as { code?: unknown }).code,
      timedOut: (failure as Error).message.includes("Timeout exceeded"),
    }).toEqual({ code: "159", timedOut: true });
  }, 600000);

  /*
   * Why the queries throw: on the ClickHouse the suite runs (26.7), a
   * query broken off at its time limit reads spans and answers with an
   * empty body — no rows, which the cron's client cannot even parse — not
   * the groups of the part of the window it read.
   */
  test("…where a 'break' would return no rows at all, not the part of the window it read", async () => {
    await insertSlowSpans();
    const sql: string = slowSpanSql("break");
    expect(sql).toContain("timeout_overflow_mode = 'break'");

    const result: { text: () => Promise<string>; response_headers: unknown } =
      await client.query({
        query: sql,
        format: "JSON",
        clickhouse_settings: { max_threads: 1 },
      });
    const summary: { read_rows?: string; result_rows?: string } = JSON.parse(
      String(
        (result.response_headers as Record<string, unknown>)[
          "x-clickhouse-summary"
        ],
      ),
    ) as { read_rows?: string; result_rows?: string };

    expect(await result.text()).toBe("");
    expect(Number(summary.read_rows)).toBeGreaterThan(0);
    expect(Number(summary.result_rows)).toBe(0);
  }, 600000);
});

describe("Message queue discovery ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
