import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { MessageQueueSpanStore } from "./MessageQueueSpanStore";

/*
 * THE TOPOLOGY SAYS WHAT EACH QUEUE'S OVERVIEW SAYS.
 *
 * The Queues topology reads every queue's spans in one statement
 * (Server/Utils/Telemetry/MessageQueueTopology); a queue's Overview reads
 * them in a dozen aggregate requests (Dashboard MessageQueueTelemetryQueries).
 * Over the same spans, a queue's figures on the map must be its tiles' -
 * spans, failed spans, Published, Consumed - and its lines its Producers and
 * Consumers cards' rows, number for number.
 *
 * Both are read from one in-memory span store: the Overview through its real
 * fetcher, every request answered by the store (MessageQueueSpanStore, which
 * evaluates each query the way ClickHouse does), and the topology through its
 * read twin (MessageQueueTopologyReadTwin, which the real-ClickHouse suite
 * holds the statement to) and its real assembly. The spans are the shapes
 * real instrumentations emit, and the core's whole corpus.
 */

const aggregateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
    },
  };
});

import {
  MessageQueueServiceRow,
  MessageQueueSpanOverview,
  fetchMessageQueueSpanOverview,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import {
  MessageQueueTopologyKeys,
  MessageQueueTopologyQueueRow,
  assembleMessageQueueTopology,
  buildMessageQueueTopologyKeys,
} from "../../../Server/Utils/Telemetry/MessageQueueTopology";
import { readMessageQueueTopologyTwin } from "../../Server/Utils/Telemetry/MessageQueueTopologyReadTwin";
import { SpanKind, SpanStatus } from "../../../Models/AnalyticsModels/Span";
import {
  ResolvedMessagingDestination,
  resolveMessagingSpan,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import {
  MessageQueueTopologyFlow,
  MessageQueueTopologyQueue,
  MessageQueueTopologyResponse,
} from "../../../Types/MessageQueue/MessageQueueTopology";
import { keyForMessageQueue } from "../../../Utils/Telemetry/EntityKey";
import {
  SPAN_FIXTURES,
  SpanFixture,
} from "../../Types/MessageQueue/MessagingTelemetryFixtures";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

const PROJECT_ID: string = "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d";
const START: Date = new Date("2026-09-24T10:00:00.000Z");
const END: Date = new Date("2026-09-24T11:00:00.000Z");

const SERVICES: ReadonlyArray<string> = [
  "3c0e7b2a-1111-4111-8111-000000000001",
  "3c0e7b2a-1111-4111-8111-000000000002",
  "3c0e7b2a-1111-4111-8111-000000000003",
  "3c0e7b2a-1111-4111-8111-000000000004",
];

const SQS_QUEUE_URL: string =
  "https://sqs.us-east-1.amazonaws.com/123456789012/orders";

const store: MessageQueueSpanStore = new MessageQueueSpanStore();

interface QueueOfSpan {
  key: string;
  row: MessageQueueTopologyQueueRow;
}

const queuesByKey: Map<string, QueueOfSpan> = new Map<string, QueueOfSpan>();

// The queue a span names, as ingest keys it and as discovery stores its row.
function queueOf(
  kind: string | null,
  attributes: Record<string, unknown>,
): QueueOfSpan | null {
  const resolved: ResolvedMessagingDestination | null = resolveMessagingSpan({
    getAttribute: (key: string): unknown => {
      return attributes[key];
    },
    kind: kind,
  });
  const identity: MessageQueueIdentity | null = resolved
    ? toMessageQueueIdentity(resolved)
    : null;
  const identifier: string | null = identity
    ? buildMessageQueueIdentifier(identity)
    : null;
  if (!resolved || !identity || !identifier) {
    return null;
  }
  const key: string = keyForMessageQueue(PROJECT_ID, identity);
  const known: QueueOfSpan | undefined = queuesByKey.get(key);
  if (known) {
    return known;
  }
  const queue: QueueOfSpan = {
    key: key,
    row: {
      id: `queue-${queuesByKey.size + 1}`,
      name: resolved.destination,
      messagingSystem: resolved.system,
      destinationName: resolved.destination,
      brokerScope: identity.brokerScope,
      brokerAddress: "",
      queueIdentifier: identifier,
      discoverySource: "traces",
      lastSeenAt: END,
      brokerMetricsLastSeenAt: null,
    },
  };
  queuesByKey.set(key, queue);
  return queue;
}

interface SpanShape {
  kind: string | null;
  attributes: Record<string, unknown>;
  service: string;
  durationMs: number;
  failed?: boolean;
}

function addSpans(shape: SpanShape, copies: number): void {
  const queue: QueueOfSpan | null = queueOf(shape.kind, shape.attributes);
  if (!queue) {
    throw new Error(`Not a queue span: ${JSON.stringify(shape.attributes)}`);
  }
  for (let copy: number = 0; copy < copies; copy++) {
    store.add({
      projectId: PROJECT_ID,
      kind: shape.kind,
      statusCode: shape.failed ? SpanStatus.Error : SpanStatus.Unset,
      durationMs: shape.durationMs,
      serviceId: shape.service,
      entityKeys: [`service-key-${shape.service}`, queue.key],
      attributes: shape.attributes,
      startTime: new Date(START.getTime() + (copy % 60) * 60 * 1000 + 1000),
    });
  }
}

function topology(): MessageQueueTopologyResponse {
  const rows: Array<MessageQueueTopologyQueueRow> = Array.from(
    queuesByKey.values(),
  ).map((queue: QueueOfSpan): MessageQueueTopologyQueueRow => {
    return queue.row;
  });
  const keys: MessageQueueTopologyKeys = buildMessageQueueTopologyKeys(
    PROJECT_ID,
    rows,
  );
  return assembleMessageQueueTopology({
    window: { startTime: START, endTime: END },
    queues: rows,
    keys: keys,
    pairs: readMessageQueueTopologyTwin({
      rows: store.rows,
      projectId: PROJECT_ID,
      keys: keys,
      window: { startTime: START, endTime: END },
    }),
    serviceNames: new Map<string, string>(),
    truncation: { queues: false, flows: false },
  });
}

function rowsOf(
  flows: Array<MessageQueueTopologyFlow>,
): Array<[string, number, number, number | null, number | null]> {
  return flows.map(
    (
      flow: MessageQueueTopologyFlow,
    ): [string, number, number, number | null, number | null] => {
      return [
        flow.serviceId,
        flow.messages,
        flow.errors,
        flow.errorRatePercent,
        flow.p95DurationMs,
      ];
    },
  );
}

function cardRowsOf(
  services: Array<MessageQueueServiceRow>,
): Array<[string, number, number, number | null, number | null]> {
  return services.map(
    (
      service: MessageQueueServiceRow,
    ): [string, number, number, number | null, number | null] => {
      return [
        service.serviceId,
        service.calls,
        service.errors,
        service.errorRatePercent,
        service.p95DurationMs,
      ];
    },
  );
}

/*
 * Every queue of the store, read both ways: the topology once, and the
 * Overview of each queue, told its row's system and asked for every
 * service (the cards show the busiest ten; the map draws them all).
 */
async function expectTopologyToBeTheOverviews(): Promise<number> {
  const map: MessageQueueTopologyResponse = topology();
  let compared: number = 0;

  for (const queue of queuesByKey.values()) {
    const overview: MessageQueueSpanOverview =
      await fetchMessageQueueSpanOverview({
        projectId: PROJECT_ID,
        keys: [queue.key],
        start: START,
        end: END,
        messagingSystem: queue.row.messagingSystem,
        serviceLimit: 10000,
      });
    const onMap: MessageQueueTopologyQueue | undefined = map.queues.find(
      (candidate: MessageQueueTopologyQueue): boolean => {
        return candidate.id === queue.row.id;
      },
    );
    expect(onMap).toBeDefined();

    const context: string = `${queue.row.messagingSystem} ${queue.row.destinationName}`;
    expect({ context, spans: onMap!.spans }).toEqual({
      context,
      spans: overview.metrics.total,
    });
    expect({ context, errors: onMap!.errors }).toEqual({
      context,
      errors: overview.metrics.errors,
    });
    expect({ context, published: onMap!.published }).toEqual({
      context,
      published: overview.metrics.published,
    });
    expect({ context, consumed: onMap!.consumed }).toEqual({
      context,
      consumed: overview.metrics.consumed,
    });

    const lines: (direction: "publish" | "consume") => Array<MessageQueueTopologyFlow> = (
      direction: "publish" | "consume",
    ): Array<MessageQueueTopologyFlow> => {
      return map.flows.filter((flow: MessageQueueTopologyFlow): boolean => {
        return flow.queueId === queue.row.id && flow.direction === direction;
      });
    };
    expect({ context, producers: rowsOf(lines("publish")) }).toEqual({
      context,
      producers: cardRowsOf(overview.producers.services),
    });
    expect({ context, consumers: rowsOf(lines("consume")) }).toEqual({
      context,
      consumers: cardRowsOf(overview.consumers.services),
    });
    compared += 1;
  }

  return compared;
}

beforeEach(() => {
  store.clear();
  queuesByKey.clear();
  aggregateMock.mockReset();
  aggregateMock.mockImplementation((request: unknown) => {
    return Promise.resolve(
      store.aggregate(request as Parameters<typeof store.aggregate>[0]),
    );
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function fixture(name: string): SpanFixture {
  const found: SpanFixture | undefined = SPAN_FIXTURES.find(
    (candidate: SpanFixture): boolean => {
      return candidate.name === name;
    },
  );
  if (!found) {
    throw new Error(`No span fixture named "${name}"`);
  }
  return found;
}

describe("the topology says what each queue's Overview says", () => {
  test("Kafka: producers and consumers, with failures on both sides", async () => {
    const topic: Record<string, unknown> = {
      "messaging.system": "kafka",
      "messaging.destination.name": "orders",
      "messaging.operation.type": "send",
    };
    const consumed: Record<string, unknown> = {
      "messaging.system": "kafka",
      "messaging.destination.name": "orders",
      "messaging.operation.type": "process",
      "messaging.consumer.group.name": "fulfilment",
    };
    addSpans({ kind: SpanKind.Producer, attributes: topic, service: SERVICES[0]!, durationMs: 4 }, 120);
    addSpans({ kind: SpanKind.Producer, attributes: topic, service: SERVICES[0]!, durationMs: 9, failed: true }, 3);
    addSpans({ kind: SpanKind.Producer, attributes: topic, service: SERVICES[1]!, durationMs: 2 }, 40);
    addSpans({ kind: SpanKind.Consumer, attributes: consumed, service: SERVICES[2]!, durationMs: 30 }, 150);
    addSpans({ kind: SpanKind.Consumer, attributes: consumed, service: SERVICES[2]!, durationMs: 80, failed: true }, 10);

    expect(await expectTopologyToBeTheOverviews()).toBe(1);
  });

  test("Amazon SQS: polls are no messages, received batches are, process spans carry the time", async () => {
    // Node's instrumentation-aws-sdk 0.58+: receives, some empty.
    const receive: (messages: number) => Record<string, unknown> = (
      messages: number,
    ): Record<string, unknown> => {
      return {
        "rpc.system": "aws-api",
        "rpc.service": "SQS",
        "rpc.method": "ReceiveMessage",
        "messaging.system": "aws_sqs",
        "messaging.destination.name": "orders",
        "url.full": SQS_QUEUE_URL,
        "messaging.operation.type": "receive",
        "messaging.batch.message_count": messages,
      };
    };
    addSpans({ kind: SpanKind.Consumer, attributes: receive(0), service: SERVICES[2]!, durationMs: 20000 }, 90);
    addSpans({ kind: SpanKind.Consumer, attributes: receive(4), service: SERVICES[2]!, durationMs: 3000 }, 30);
    // boto3sqs: its receive spans, and a process span per message.
    addSpans(
      {
        kind: SpanKind.Consumer,
        attributes: fixture("Python boto3sqs receive (queue URL in messaging.url)").attributes,
        service: SERVICES[3]!,
        durationMs: 5000,
      },
      20,
    );
    addSpans(
      {
        kind: SpanKind.Consumer,
        attributes: {
          "messaging.system": "aws.sqs",
          "messaging.destination": "orders",
          "messaging.destination_kind": "queue",
          "messaging.url": "https://sqs.eu-west-1.amazonaws.com/123456789012/orders",
          "messaging.operation": "process",
        },
        service: SERVICES[3]!,
        durationMs: 25,
      },
      60,
    );
    // A Node sender's PRODUCER spans, and a botocore sender's CLIENT sends.
    addSpans(
      {
        kind: SpanKind.Producer,
        attributes: {
          "rpc.system": "aws-api",
          "rpc.service": "SQS",
          "rpc.method": "SendMessage",
          "messaging.system": "aws_sqs",
          "messaging.destination.name": "orders",
          "url.full": SQS_QUEUE_URL,
        },
        service: SERVICES[0]!,
        durationMs: 12,
      },
      70,
    );
    addSpans(
      {
        kind: SpanKind.Client,
        attributes: {
          "rpc.system": "aws-api",
          "rpc.service": "SQS",
          "rpc.method": "SendMessage",
          "messaging.system": "aws_sqs",
          "messaging.destination.name": "orders",
          "url.full": SQS_QUEUE_URL,
        },
        service: SERVICES[1]!,
        durationMs: 15,
      },
      25,
    );
    addSpans(
      {
        kind: SpanKind.Client,
        attributes: {
          "rpc.system": "aws-api",
          "rpc.service": "SQS",
          "rpc.method": "SendMessage",
          "messaging.system": "aws_sqs",
          "messaging.destination.name": "orders",
          "url.full": SQS_QUEUE_URL,
        },
        service: SERVICES[1]!,
        durationMs: 40,
        failed: true,
      },
      5,
    );

    expect(await expectTopologyToBeTheOverviews()).toBeGreaterThanOrEqual(1);
  });

  test("Azure Service Bus: a sender's markers are its messages, its sends its failures and time", async () => {
    const marker: Record<string, unknown> = {
      "messaging.system": "servicebus",
      "messaging.destination.name": "orders",
      "server.address": "orders-prod.servicebus.windows.net",
      "messaging.operation": "create",
    };
    const send: Record<string, unknown> = {
      "messaging.system": "servicebus",
      "messaging.destination.name": "orders",
      "server.address": "orders-prod.servicebus.windows.net",
      "messaging.operation": "publish",
    };
    const settle: Record<string, unknown> = {
      "messaging.system": "servicebus",
      "messaging.destination.name": "orders",
      "server.address": "orders-prod.servicebus.windows.net",
      "messaging.operation": "settle",
    };
    const process: Record<string, unknown> = {
      "messaging.system": "servicebus",
      "messaging.destination.name": "orders",
      "server.address": "orders-prod.servicebus.windows.net",
      "messaging.operation": "process",
    };
    addSpans({ kind: SpanKind.Producer, attributes: marker, service: SERVICES[0]!, durationMs: 0 }, 13);
    addSpans({ kind: SpanKind.Client, attributes: send, service: SERVICES[0]!, durationMs: 18 }, 9);
    // More failed sends than messages: the card's rate is a share of sends.
    addSpans({ kind: SpanKind.Client, attributes: send, service: SERVICES[0]!, durationMs: 50, failed: true }, 31);
    addSpans({ kind: SpanKind.Consumer, attributes: process, service: SERVICES[1]!, durationMs: 45 }, 12);
    addSpans({ kind: SpanKind.Client, attributes: settle, service: SERVICES[1]!, durationMs: 3, failed: true }, 2);

    expect(await expectTopologyToBeTheOverviews()).toBe(1);
  });

  test("several queues of several brokers at once, each read with its own system's groups", async () => {
    const kafka: Record<string, unknown> = {
      "messaging.system": "kafka",
      "messaging.destination.name": "payments",
      "messaging.operation.type": "send",
    };
    const kafkaConsume: Record<string, unknown> = {
      ...kafka,
      "messaging.operation.type": "process",
    };
    const rabbit: Record<string, unknown> = {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "emails",
      "messaging.rabbitmq.destination.routing_key": "emails",
      "messaging.operation.type": "receive",
    };
    const sqsReceive: Record<string, unknown> = {
      "rpc.system": "aws-api",
      "rpc.service": "SQS",
      "rpc.method": "ReceiveMessage",
      "messaging.system": "aws_sqs",
      "messaging.destination.name": "orders",
      "url.full": SQS_QUEUE_URL,
      "messaging.operation.type": "receive",
      "messaging.batch.message_count": 2,
    };
    addSpans({ kind: SpanKind.Producer, attributes: kafka, service: SERVICES[0]!, durationMs: 3 }, 50);
    addSpans({ kind: SpanKind.Consumer, attributes: kafkaConsume, service: SERVICES[1]!, durationMs: 20 }, 48);
    // A RabbitMQ receive is a delivery (pika): consumed, not a poll.
    addSpans({ kind: SpanKind.Consumer, attributes: rabbit, service: SERVICES[1]!, durationMs: 11 }, 33);
    // The same service consumes SQS receives: polls there.
    addSpans({ kind: SpanKind.Consumer, attributes: sqsReceive, service: SERVICES[1]!, durationMs: 2000 }, 7);

    expect(await expectTopologyToBeTheOverviews()).toBe(3);
  });

  test("the whole corpus, every shape from several services, some failing", async () => {
    const random: SeededRandom = seededRandom(61890);
    let added: number = 0;
    for (const span of SPAN_FIXTURES) {
      if (!queueOf(span.kind, span.attributes)) {
        continue;
      }
      for (const service of SERVICES) {
        if (random(2) === 0) {
          continue;
        }
        addSpans(
          {
            kind: span.kind,
            attributes: span.attributes,
            service: service,
            durationMs: 1 + random(500),
          },
          1 + random(4),
        );
        if (random(4) === 0) {
          addSpans(
            {
              kind: span.kind,
              attributes: span.attributes,
              service: service,
              durationMs: 1 + random(500),
              failed: true,
            },
            1 + random(3),
          );
        }
        added += 1;
      }
    }
    expect(added).toBeGreaterThan(100);

    expect(await expectTopologyToBeTheOverviews()).toBeGreaterThan(20);
  });
});
