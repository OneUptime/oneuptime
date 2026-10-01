import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  MessageQueueSpanRow,
  MessageQueueSpanStore,
  spanMatchesQuery,
  toStoredAttributes,
} from "./MessageQueueSpanStore";

/*
 * Which of a queue's spans the Overview counts, and as what. The tiles, the
 * charts and the Producers / Consumers cards read the queue's spans in
 * groups (MessageQueueSpanPopulation); these tests answer every aggregate
 * request from spans held in memory (MessageQueueSpanStore evaluates each
 * query), shaped as real instrumentations emit them — the core's corpus
 * (MessagingTelemetryFixtures) and the upstream sources behind it — and
 * assert what the Overview shows:
 *
 *   1. a receive is not a message consumed when it returned nothing, and on
 *      SQS a receive call is a long poll: never processing time, and
 *      consumption only when it reports the messages it returned;
 *   2. a publish recorded as a client span — the AWS SDKs' SNS and SQS
 *      sends, Go's otelaws — is a publish, and a queue whose spans hold no
 *      publish says so rather than that nothing published;
 *   3. the Azure SDKs' zero-length per-message producer spans are counted as
 *      messages, but a producer's failures and publish time are its sends';
 *   4. over the whole corpus, everything counted as published or consumed is
 *      what the resolver calls a publish or a consume, and what it leaves
 *      out is pinned with its reason.
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
  MESSAGE_QUEUE_AWS_RPC_SYSTEMS,
  MESSAGE_QUEUE_BATCH_MESSAGE_COUNT_ATTRIBUTE,
  MESSAGE_QUEUE_LEGACY_OPERATION_ATTRIBUTE,
  MESSAGE_QUEUE_OPERATION_TYPE_ATTRIBUTE,
  MESSAGE_QUEUE_POLLED_RECEIVE_SYSTEMS,
  MESSAGE_QUEUE_RPC_METHOD_ATTRIBUTE,
  MessageQueueQueryWindow,
  MessageQueueServiceRow,
  MessageQueueSpanOverview,
  MessageQueueSpanPopulation,
  buildMessageQueueSpanQuery,
  fetchMessageQueueSpanOverview,
  isMessageQueueAwsRpcSystem,
  isMessageQueuePolledReceiveSystem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import { getMessageQueueServicesEmptyText } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueServicesCard";
import { SpanKind, SpanStatus } from "../../../Models/AnalyticsModels/Span";
import {
  MESSAGING_DIRECTION_ATTRIBUTES,
  ResolvedMessagingDestination,
  resolveMessagingSpan,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import { getMessagingSystemDescriptor } from "../../../Types/MessageQueue/MessagingSystem";
import { keyForMessageQueue } from "../../../Utils/Telemetry/EntityKey";
import {
  SPAN_FIXTURES,
  SpanFixture,
} from "../../Types/MessageQueue/MessagingTelemetryFixtures";

const PROJECT_ID: string = "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d";
const START: Date = new Date("2026-09-24T10:00:00.000Z");
const END: Date = new Date("2026-09-24T11:00:00.000Z");

const SENDER: string = "3c0e7b2a-1111-4111-8111-000000000001";
const NODE_CONSUMER: string = "3c0e7b2a-1111-4111-8111-000000000002";
const PYTHON_CONSUMER: string = "3c0e7b2a-1111-4111-8111-000000000003";
const JAVA_SERVICE: string = "3c0e7b2a-1111-4111-8111-000000000004";
const GO_SERVICE: string = "3c0e7b2a-1111-4111-8111-000000000005";
const DOTNET_SERVICE: string = "3c0e7b2a-1111-4111-8111-000000000006";

const SQS_QUEUE_URL: string =
  "https://sqs.us-east-1.amazonaws.com/123456789012/orders";

const store: MessageQueueSpanStore = new MessageQueueSpanStore();

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

// The queue a span names, as ingest keys it (the resolver, family-keyed).
function queueOf(
  kind: string | null,
  attributes: Record<string, unknown>,
): { identity: MessageQueueIdentity; key: string; system: string } {
  const resolved: ResolvedMessagingDestination | null = resolveMessagingSpan({
    getAttribute: (key: string): unknown => {
      return attributes[key];
    },
    kind: kind,
  });
  const identity: MessageQueueIdentity | null = resolved
    ? toMessageQueueIdentity(resolved)
    : null;
  if (!resolved || !identity || !buildMessageQueueIdentifier(identity)) {
    throw new Error(`Not a queue span: ${JSON.stringify(attributes)}`);
  }
  return {
    identity: identity,
    key: keyForMessageQueue(PROJECT_ID, identity),
    system: resolved.system,
  };
}

interface SpanShape {
  kind: string;
  attributes: Record<string, unknown>;
  service: string;
  durationMs: number;
  failed?: boolean;
  // Minutes after the window starts.
  minute?: number;
}

// Adds `copies` spans of one shape, spread over the window's minutes.
function addSpans(shape: SpanShape, copies: number): string {
  const queue: { key: string } = queueOf(shape.kind, shape.attributes);
  for (let copy: number = 0; copy < copies; copy++) {
    const minute: number =
      typeof shape.minute === "number" ? shape.minute : copy % 60;
    store.add({
      projectId: PROJECT_ID,
      kind: shape.kind,
      statusCode: shape.failed ? SpanStatus.Error : SpanStatus.Unset,
      durationMs: shape.durationMs,
      serviceId: shape.service,
      entityKeys: [`service-key-${shape.service}`, queue.key],
      attributes: shape.attributes,
      startTime: new Date(START.getTime() + minute * 60 * 1000 + 1000),
    });
  }
  return queue.key;
}

function windowFor(key: string): MessageQueueQueryWindow {
  return { projectId: PROJECT_ID, keys: [key], start: START, end: END };
}

async function overview(
  key: string,
  messagingSystem: string,
): Promise<MessageQueueSpanOverview> {
  return fetchMessageQueueSpanOverview({
    ...windowFor(key),
    messagingSystem: messagingSystem,
  });
}

/*
 * A request that fails once the caller is waiting on it, as a network error
 * does (an already-rejected promise is reported as unhandled by the test
 * environment before Promise.all takes it).
 */
function failLater(message: string): Promise<never> {
  return Promise.resolve().then((): never => {
    throw new Error(message);
  });
}

function onlyRow(
  services: Array<MessageQueueServiceRow>,
): MessageQueueServiceRow {
  expect(services).toHaveLength(1);
  return services[0]!;
}

beforeEach(() => {
  store.clear();
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

// ---- the shapes, as the instrumentations emit them -------------------------

/*
 * Node's instrumentation-aws-sdk 0.58+ (services/sqs.ts): every
 * ReceiveMessage is one CONSUMER span, started before the call and ended
 * after it — an empty long poll included — with the number of messages it
 * returned, and no span per message.
 */
function nodeSqsReceive(messages: number): Record<string, unknown> {
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
}

// boto3sqs: its receive span wraps every receive_message, empty ones too.
const BOTO3SQS_RECEIVE: Record<string, unknown> = fixture(
  "Python boto3sqs receive (queue URL in messaging.url)",
).attributes;

// ... and one CONSUMER `process` span per message it returned.
const BOTO3SQS_PROCESS: Record<string, unknown> = {
  "messaging.system": "aws.sqs",
  "messaging.destination": "orders",
  "messaging.destination_kind": "queue",
  "messaging.url": "https://sqs.eu-west-1.amazonaws.com/123456789012/orders",
  "messaging.operation": "process",
  "messaging.message_id": "5fea7756-0ea4-451a-a703-a558b933e274",
};

// Node's SQS SendMessage, a PRODUCER span.
const NODE_SQS_SEND: Record<string, unknown> = {
  "rpc.system": "aws-api",
  "rpc.service": "SQS",
  "rpc.method": "SendMessage",
  "messaging.system": "aws_sqs",
  "messaging.destination.name": "orders",
  "url.full": SQS_QUEUE_URL,
};

describe("receives: a poll is not a message consumed", () => {
  test("an idle SQS queue long-polled by Node's instrumentation-aws-sdk 0.58+: nothing consumed, no processing time", async () => {
    // One hour, WaitTimeSeconds=20, no message: 180 empty 20 s polls.
    const key: string = addSpans(
      {
        kind: SpanKind.Consumer,
        attributes: nodeSqsReceive(0),
        service: NODE_CONSUMER,
        durationMs: 20_000,
      },
      180,
    );

    const result: MessageQueueSpanOverview = await overview(key, "aws_sqs");

    expect(result.metrics.total).toBe(180);
    expect(result.metrics.consumed).toBe(0);
    expect(result.metrics.p95ProcessingMs).toBeNull();
    expect(result.metrics.p95ProcessingSeries).toEqual([]);
    expect(result.consumers.services).toEqual([]);
  });

  test("an idle SQS queue polled by boto3sqs: nothing consumed, no processing time", async () => {
    const key: string = addSpans(
      {
        kind: SpanKind.Consumer,
        attributes: BOTO3SQS_RECEIVE,
        service: PYTHON_CONSUMER,
        durationMs: 20_000,
      },
      180,
    );

    const result: MessageQueueSpanOverview = await overview(key, "aws_sqs");

    expect(result.metrics.total).toBe(180);
    expect(result.metrics.consumed).toBe(0);
    expect(result.metrics.p95ProcessingMs).toBeNull();
    expect(result.consumers.services).toEqual([]);
  });

  test("a busy boto3sqs consumer: its process spans are the messages and the processing time, its polls neither", async () => {
    // 60 receives that waited ~5 s, 120 messages processed in 30 ms each.
    const key: string = addSpans(
      {
        kind: SpanKind.Consumer,
        attributes: BOTO3SQS_RECEIVE,
        service: PYTHON_CONSUMER,
        durationMs: 5_000,
      },
      60,
    );
    addSpans(
      {
        kind: SpanKind.Consumer,
        attributes: BOTO3SQS_PROCESS,
        service: PYTHON_CONSUMER,
        durationMs: 30,
      },
      120,
    );

    const result: MessageQueueSpanOverview = await overview(key, "aws_sqs");

    expect(result.metrics.consumed).toBe(120);
    expect(result.metrics.p95ProcessingMs).toBeCloseTo(30, 5);
    const consumer: MessageQueueServiceRow = onlyRow(result.consumers.services);
    expect(consumer.calls).toBe(120);
    expect(consumer.p95DurationMs).toBeCloseTo(30, 5);
  });

  test("Node 0.58+ records only its receives: one that returned messages is one batch consumed, never a processing time", async () => {
    // A message a minute, sent by a Node service.
    const key: string = addSpans(
      {
        kind: SpanKind.Producer,
        attributes: NODE_SQS_SEND,
        service: SENDER,
        durationMs: 25,
      },
      60,
    );
    // Each minute: two empty 20 s polls, then one that returns it after 10 s.
    addSpans(
      {
        kind: SpanKind.Consumer,
        attributes: nodeSqsReceive(0),
        service: NODE_CONSUMER,
        durationMs: 20_000,
      },
      120,
    );
    addSpans(
      {
        kind: SpanKind.Consumer,
        attributes: nodeSqsReceive(1),
        service: NODE_CONSUMER,
        durationMs: 10_000,
      },
      60,
    );

    const result: MessageQueueSpanOverview = await overview(key, "aws_sqs");

    expect(result.metrics.published).toBe(60);
    expect(result.metrics.consumed).toBe(60);
    // Every consumed span here is a poll: there is no processing time.
    expect(result.metrics.p95ProcessingMs).toBeNull();
    expect(
      result.metrics.consumedSeries.reduce(
        (total: number, point: { y: number }): number => {
          return total + point.y;
        },
        0,
      ),
    ).toBe(60);
    const consumer: MessageQueueServiceRow = onlyRow(result.consumers.services);
    expect(consumer).toEqual({
      serviceId: NODE_CONSUMER,
      calls: 60,
      errors: 0,
      errorRatePercent: 0,
      p95DurationMs: null,
    });
  });

  test("outside SQS a CONSUMER receive can be a delivery: pika's are counted, with their time", async () => {
    const key: string = addSpans(
      {
        kind: SpanKind.Consumer,
        attributes: fixture("Python pika consume").attributes,
        service: PYTHON_CONSUMER,
        durationMs: 12,
      },
      50,
    );

    const result: MessageQueueSpanOverview = await overview(key, "rabbitmq");

    expect(result.metrics.consumed).toBe(50);
    expect(result.metrics.p95ProcessingMs).toBeCloseTo(12, 5);
    expect(onlyRow(result.consumers.services).calls).toBe(50);
  });

  test("a receive that returned nothing is never consumption, on any system", async () => {
    const kafkaPoll: Record<string, unknown> = {
      ...fixture("Java agent Kafka process (default mode)").attributes,
      "messaging.operation": "receive",
      "messaging.batch.message_count": 0,
    };
    const key: string = addSpans(
      {
        kind: SpanKind.Consumer,
        attributes: kafkaPoll,
        service: JAVA_SERVICE,
        durationMs: 5_000,
      },
      30,
    );
    addSpans(
      {
        kind: SpanKind.Consumer,
        attributes: fixture("Java agent Kafka process (default mode)")
          .attributes,
        service: JAVA_SERVICE,
        durationMs: 8,
      },
      40,
    );

    const result: MessageQueueSpanOverview = await overview(key, "kafka");

    expect(result.metrics.total).toBe(70);
    expect(result.metrics.consumed).toBe(40);
    expect(result.metrics.p95ProcessingMs).toBeCloseTo(8, 5);
  });
});

describe("client-kind publishes are publishes", () => {
  test("an SNS topic the Java agent publishes to (rpc.method only): Published, the Producers card and its failures", async () => {
    const publish: Record<string, unknown> = fixture(
      "Java agent SNS Publish (an RPC span with no messaging.system)",
    ).attributes;
    const key: string = addSpans(
      {
        kind: SpanKind.Client,
        attributes: publish,
        service: JAVA_SERVICE,
        durationMs: 30,
      },
      490,
    );
    addSpans(
      {
        kind: SpanKind.Client,
        attributes: publish,
        service: JAVA_SERVICE,
        durationMs: 30,
        failed: true,
      },
      10,
    );

    const result: MessageQueueSpanOverview = await overview(key, "aws.sns");

    expect(result.metrics.total).toBe(500);
    expect(result.metrics.published).toBe(500);
    // The chart draws them too: the client-only publisher's own line.
    expect(
      result.metrics.publishedSeries.reduce(
        (total: number, point: { y: number }): number => {
          return total + point.y;
        },
        0,
      ),
    ).toBe(500);
    const producer: MessageQueueServiceRow = onlyRow(result.producers.services);
    expect(producer.serviceId).toBe(JAVA_SERVICE);
    expect(producer.calls).toBe(500);
    expect(producer.errorRatePercent).toBeCloseTo(2, 5);
    expect(producer.p95DurationMs).toBeCloseTo(30, 5);
    // SNS has no consumer spans: nothing consumed.
    expect(result.metrics.consumed).toBe(0);
  });

  test("Go's otelaws SNS publish records the operation type: counted once, not again by its AWS operation", async () => {
    const key: string = addSpans(
      {
        kind: SpanKind.Client,
        attributes: fixture(
          "Go otelaws SNS Publish (aws_sns, short topic name)",
        ).attributes,
        service: GO_SERVICE,
        durationMs: 18,
      },
      40,
    );

    const result: MessageQueueSpanOverview = await overview(key, "aws.sns");

    expect(result.metrics.published).toBe(40);
    expect(onlyRow(result.producers.services).calls).toBe(40);
  });

  test("SQS sends recorded as client spans (botocore, Go's otelaws) are published messages", async () => {
    const key: string = addSpans(
      {
        kind: SpanKind.Client,
        attributes: fixture(
          "Python botocore SQS SendMessage (a CLIENT span: direction from rpc.method)",
        ).attributes,
        service: PYTHON_CONSUMER,
        durationMs: 22,
      },
      25,
    );

    const result: MessageQueueSpanOverview = await overview(key, "aws_sqs");

    expect(result.metrics.published).toBe(25);
    expect(onlyRow(result.producers.services).calls).toBe(25);
  });

  test("a service with producer spans is counted from them, its client calls never added on top", async () => {
    // The Java agent up to 2.3.0: a PRODUCER span per SendMessage.
    const send: Record<string, unknown> = fixture(
      "Java agent SQS send up to 2.3.0 (AmazonSQS)",
    ).attributes;
    const key: string = addSpans(
      {
        kind: SpanKind.Producer,
        attributes: send,
        service: JAVA_SERVICE,
        durationMs: 12,
      },
      30,
    );

    const result: MessageQueueSpanOverview = await overview(key, "aws_sqs");

    expect(result.metrics.published).toBe(30);
    expect(onlyRow(result.producers.services).calls).toBe(30);
  });

  test("a queue whose spans hold no publish says so, not that nothing published", async () => {
    // Go's otelaws DeleteMessage: settles, on the consumer's side.
    const key: string = addSpans(
      {
        kind: SpanKind.Client,
        attributes: fixture("Go otelaws DeleteMessage settles").attributes,
        service: GO_SERVICE,
        durationMs: 9,
      },
      12,
    );

    const result: MessageQueueSpanOverview = await overview(key, "aws_sqs");

    expect(result.metrics.total).toBe(12);
    expect(result.metrics.published).toBe(0);
    expect(result.producers.services).toEqual([]);
    expect(getMessageQueueServicesEmptyText("producers", true)).toBe(
      "None of this queue's spans in the selected range records a publish: no producer spans, and no client spans that record a send. The Traces tab lists the spans it has.",
    );
    expect(getMessageQueueServicesEmptyText("producers", false)).toBe(
      "No instrumented application published to this queue in the selected range.",
    );
    expect(getMessageQueueServicesEmptyText("consumers", true)).toContain(
      "The Traces tab lists the spans it has.",
    );
  });
});

describe("the Azure SDKs' per-message producer spans", () => {
  test("Service Bus from .NET: Published counts the messages once; the Producers row takes failures and time from the sends", async () => {
    // MessagingClientDiagnostics.InstrumentMessage: disposed before the send.
    const message: Record<string, unknown> = fixture(
      ".NET Service Bus per-message PRODUCER span",
    ).attributes;
    // ServiceBusSender.SendMessagesAsync: the CLIENT scope, Failed() on error.
    const send: Record<string, unknown> = {
      ...fixture(".NET Service Bus send (ActivitySource mode)").attributes,
      "messaging.batch.message_count": 1,
    };

    let key: string = "";
    for (let index: number = 0; index < 200; index++) {
      key = addSpans(
        {
          kind: SpanKind.Producer,
          attributes: message,
          service: DOTNET_SERVICE,
          durationMs: 0.02,
          minute: index % 60,
        },
        1,
      );
      addSpans(
        {
          kind: SpanKind.Client,
          attributes: send,
          service: DOTNET_SERVICE,
          durationMs: 40 + (index % 50),
          failed: index % 4 === 0,
          minute: index % 60,
        },
        1,
      );
    }

    const result: MessageQueueSpanOverview = await overview(key, "servicebus");

    expect(result.metrics.total).toBe(400);
    expect(result.metrics.errors).toBe(50);
    // One per message: the sends are not counted on top.
    expect(result.metrics.published).toBe(200);
    const producer: MessageQueueServiceRow = onlyRow(result.producers.services);
    expect(producer.calls).toBe(200);
    // 50 of the 200 sends failed; the per-message spans never fail.
    expect(producer.errorRatePercent).toBeCloseTo(25, 5);
    // The sends' time, not the markers' microseconds.
    expect(producer.p95DurationMs!).toBeGreaterThanOrEqual(40);
  });
});

describe("the groups' queries", () => {
  const window: MessageQueueQueryWindow = windowFor("0123456789abcdef");

  test("each is scoped by the queue's key and project, and never by what names the queue", () => {
    const populations: Array<MessageQueueSpanPopulation> = [
      "all",
      "publish",
      "send",
      "awsSend",
      "consume",
      "receivedBatch",
    ];
    for (const population of populations) {
      for (const system of ["kafka", "aws_sqs", "aws.sns", "servicebus"]) {
        const query: Record<string, unknown> = buildMessageQueueSpanQuery(
          window,
          { population, messagingSystem: system },
        )!;
        expect(Object.keys(query).sort()).toEqual(
          expect.arrayContaining(["entityKeys", "projectId", "startTime"]),
        );
        // Only operation evidence and the batch size tell spans apart.
        for (const attributeKey of Object.keys(
          (query["attributes"] as Record<string, unknown>) || {},
        )) {
          expect([
            MESSAGE_QUEUE_OPERATION_TYPE_ATTRIBUTE,
            MESSAGE_QUEUE_LEGACY_OPERATION_ATTRIBUTE,
            MESSAGE_QUEUE_RPC_METHOD_ATTRIBUTE,
            MESSAGE_QUEUE_BATCH_MESSAGE_COUNT_ATTRIBUTE,
          ]).toContain(attributeKey);
        }
      }
    }
    expect(buildMessageQueueSpanQuery({ ...window, keys: [] })).toBeNull();
    expect(
      buildMessageQueueSpanQuery({ ...window, projectId: null }),
    ).toBeNull();
  });

  test("the operation keys are the ones the resolver reads a direction from", () => {
    for (const key of [
      MESSAGE_QUEUE_OPERATION_TYPE_ATTRIBUTE,
      MESSAGE_QUEUE_LEGACY_OPERATION_ATTRIBUTE,
      MESSAGE_QUEUE_RPC_METHOD_ATTRIBUTE,
    ]) {
      expect(MESSAGING_DIRECTION_ATTRIBUTES).toContain(key);
    }
  });

  test("the system lists name catalog systems, and are read through the catalog's aliases", () => {
    for (const system of [
      ...MESSAGE_QUEUE_POLLED_RECEIVE_SYSTEMS,
      ...MESSAGE_QUEUE_AWS_RPC_SYSTEMS,
    ]) {
      expect(getMessagingSystemDescriptor(system)?.system).toBe(system);
    }
    expect(isMessageQueuePolledReceiveSystem("AmazonSQS")).toBe(true);
    expect(isMessageQueuePolledReceiveSystem("kafka")).toBe(false);
    expect(isMessageQueuePolledReceiveSystem(null)).toBe(false);
    expect(isMessageQueueAwsRpcSystem("aws_sns")).toBe(true);
    expect(isMessageQueueAwsRpcSystem("servicebus")).toBe(false);
  });

  test("a queue that is not on AWS never asks for AWS SDK sends, and one that is not SQS never for receive batches", async () => {
    const key: string = addSpans(
      {
        kind: SpanKind.Producer,
        attributes: fixture("Confluent.Kafka .NET send (semconv 1.44)")
          .attributes,
        service: DOTNET_SERVICE,
        durationMs: 3,
      },
      5,
    );

    await overview(key, "kafka");

    const asked: Array<string> = store.queries.map(
      (query: Record<string, unknown>): string => {
        return JSON.stringify(Object.keys(query["attributes"] || {}));
      },
    );
    expect(
      store.queries.some((query: Record<string, unknown>): boolean => {
        return Boolean(
          (query["attributes"] as Record<string, unknown> | undefined)?.[
            MESSAGE_QUEUE_RPC_METHOD_ATTRIBUTE
          ],
        );
      }),
    ).toBe(false);
    expect(asked.length).toBeGreaterThan(0);
    expect(
      store.queries.some((query: Record<string, unknown>): boolean => {
        const attributes: Record<string, unknown> | undefined = query[
          "attributes"
        ] as Record<string, unknown> | undefined;
        return (
          attributes?.[MESSAGE_QUEUE_OPERATION_TYPE_ATTRIBUTE] === "receive"
        );
      }),
    ).toBe(false);
  });

  test("an unscoped queue sends nothing", async () => {
    const result: MessageQueueSpanOverview =
      await fetchMessageQueueSpanOverview({
        projectId: PROJECT_ID,
        keys: [],
        start: START,
        end: END,
      });
    expect(result.metrics.total).toBe(0);
    expect(result.producers.services).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("a failed card request leaves the tiles, and a failed tile request the cards", async () => {
    const key: string = addSpans(
      {
        kind: SpanKind.Producer,
        attributes: NODE_SQS_SEND,
        service: SENDER,
        durationMs: 25,
      },
      10,
    );
    aggregateMock.mockImplementation((request: unknown) => {
      const grouped: boolean = Boolean(
        (request as { aggregateBy: { groupBy?: unknown } }).aggregateBy.groupBy,
      );
      return grouped
        ? failLater("cards down")
        : Promise.resolve(
            store.aggregate(request as Parameters<typeof store.aggregate>[0]),
          );
    });

    const tilesOnly: MessageQueueSpanOverview = await overview(key, "aws_sqs");
    expect(tilesOnly.metrics.published).toBe(10);
    expect(tilesOnly.producers.services).toEqual([]);

    aggregateMock.mockImplementation((request: unknown) => {
      const grouped: boolean = Boolean(
        (request as { aggregateBy: { groupBy?: unknown } }).aggregateBy.groupBy,
      );
      return grouped
        ? Promise.resolve(
            store.aggregate(request as Parameters<typeof store.aggregate>[0]),
          )
        : failLater("tiles down");
    });

    const cardsOnly: MessageQueueSpanOverview = await overview(key, "aws_sqs");
    expect(cardsOnly.metrics.total).toBe(0);
    expect(onlyRow(cardsOnly.producers.services).calls).toBe(10);
  });
});

describe("over the whole corpus", () => {
  const PUBLISH_GROUPS: Array<MessageQueueSpanPopulation> = [
    "publish",
    "send",
    "awsSend",
  ];
  const CONSUME_GROUPS: Array<MessageQueueSpanPopulation> = [
    "consume",
    "receivedBatch",
  ];

  interface Classified {
    name: string;
    kind: string | null;
    direction: string;
    groups: Array<MessageQueueSpanPopulation>;
  }

  // Every fixture ingest keys to a queue, with the groups whose query it matches.
  function classifyCorpus(): Array<Classified> {
    const classified: Array<Classified> = [];
    for (const span of SPAN_FIXTURES) {
      const resolved: ResolvedMessagingDestination | null =
        resolveMessagingSpan({
          getAttribute: (key: string): unknown => {
            return span.attributes[key];
          },
          kind: span.kind,
        });
      const identity: MessageQueueIdentity | null = resolved
        ? toMessageQueueIdentity(resolved)
        : null;
      if (!resolved || !identity || !buildMessageQueueIdentifier(identity)) {
        continue;
      }
      const key: string = keyForMessageQueue(PROJECT_ID, identity);
      const row: MessageQueueSpanRow = {
        projectId: PROJECT_ID,
        kind: span.kind,
        statusCode: SpanStatus.Unset,
        durationMs: 1,
        serviceId: SENDER,
        entityKeys: [key],
        attributes: toStoredAttributes(span.attributes),
        startTime: new Date(START.getTime() + 60 * 1000),
      };
      const groups: Array<MessageQueueSpanPopulation> = [
        ...PUBLISH_GROUPS,
        ...CONSUME_GROUPS,
      ].filter((population: MessageQueueSpanPopulation): boolean => {
        return spanMatchesQuery(
          row,
          buildMessageQueueSpanQuery(windowFor(key), {
            population,
            messagingSystem: resolved.system,
          })!,
        );
      });
      classified.push({
        name: span.name,
        kind: span.kind,
        direction: resolved.direction,
        groups: groups,
      });
    }
    return classified;
  }

  test("everything counted as published is a publish, as consumed a consume, and nothing is both", () => {
    const corpus: Array<Classified> = classifyCorpus();
    expect(corpus.length).toBeGreaterThan(80);
    for (const span of corpus) {
      const published: boolean = span.groups.some(
        (group: MessageQueueSpanPopulation): boolean => {
          return PUBLISH_GROUPS.includes(group);
        },
      );
      const consumed: boolean = span.groups.some(
        (group: MessageQueueSpanPopulation): boolean => {
          return CONSUME_GROUPS.includes(group);
        },
      );
      // At most one group: no span is counted twice.
      expect({ name: span.name, groups: span.groups.length <= 1 }).toEqual({
        name: span.name,
        groups: true,
      });
      if (published) {
        expect({ name: span.name, direction: span.direction }).toEqual({
          name: span.name,
          direction: "publish",
        });
      }
      if (consumed) {
        expect({ name: span.name, direction: span.direction }).toEqual({
          name: span.name,
          direction: "consume",
        });
      }
    }
  });

  test("every publish in the corpus is counted, whatever its kind", () => {
    const missed: Array<string> = classifyCorpus()
      .filter((span: Classified): boolean => {
        return span.direction === "publish" && span.groups.length === 0;
      })
      .map((span: Classified): string => {
        return span.name;
      });
    expect(missed).toEqual([]);
  });

  test("the consumes left out are receives — client-kind pulls and SQS's polls — and one INTERNAL subscribe span", () => {
    const leftOut: Array<string> = classifyCorpus()
      .filter((span: Classified): boolean => {
        return span.direction === "consume" && span.groups.length === 0;
      })
      .map((span: Classified): string => {
        return `${span.kind} ${span.name}`;
      })
      .sort();
    expect(leftOut).toEqual(
      [
        // SQS receive calls: their messages are the process spans.
        `${SpanKind.Consumer} Java agent SQS receive from 2.4.0 (aws_sqs)`,
        `${SpanKind.Consumer} Python boto3sqs receive (queue URL in messaging.url)`,
        // Pulls recorded as CLIENT spans (semconv 1.26+ gives receives that kind).
        `${SpanKind.Client} .NET AWS instrumentation, legacy mode (no messaging.system, aws.queue_url)`,
        `${SpanKind.Client} .NET Service Bus dead-letter receive (/$DeadLetterQueue)`,
        `${SpanKind.Client} .NET Service Bus receive from a topic subscription (entity path)`,
        `${SpanKind.Client} .NET Service Bus subscription dead-letter queue`,
        `${SpanKind.Client} .NET Service Bus transfer dead-letter queue`,
        `${SpanKind.Client} Event Hubs receiver entity path with a consumer group and partition`,
        `${SpanKind.Client} Go otelaws up to v0.61 ReceiveMessage (AmazonSQS, queue URL in net.peer.name)`,
        `${SpanKind.Client} JS Service Bus receive (messaging.source.name, net.peer.name)`,
        `${SpanKind.Client} Java Service Bus dead-letter queue (/$deadletterqueue)`,
        `${SpanKind.Client} Java Service Bus receive (lowercase subscriptions, both namespace keys)`,
        `${SpanKind.Client} Java agent Kafka poll (messaging semconv opt-in)`,
        // Go's Pub/Sub records a subscribe as INTERNAL: not a consumer span.
        `${SpanKind.Internal} Pub/Sub Go subscribe (an INTERNAL span)`,
      ].sort(),
    );
  });
});
