import { SpanKind } from "../../Models/AnalyticsModels/Span";
import GreaterThan from "../BaseDatabase/GreaterThan";
import Includes from "../BaseDatabase/Includes";
import IncludesNone from "../BaseDatabase/IncludesNone";
import { getMessagingSystemDescriptor } from "./MessagingSystem";

/*
 * WHICH OF A QUEUE'S SPANS ARE PUBLISHES AND WHICH ARE CONSUMES, and how a
 * service's spans of each kind make its row on either side of the queue.
 *
 * One definition for every reader of a queue's spans: the queue's Overview
 * (Dashboard Components/MessageQueue/MessageQueueTelemetryQueries, which
 * sends each group as an aggregate query) and the Queues topology
 * (Server/Utils/Telemetry/MessageQueueTopology, which compiles the very same
 * groups into one ClickHouse read over every queue of the project). Both
 * compile these filters through the same query builder, so a queue's
 * Producers and Consumers cards and its lines on the topology count exactly
 * the same spans. Pure and isomorphic.
 *
 * Spans are told apart by kind AND by the operation they record: PRODUCER
 * spans are publishes, and so are the CLIENT spans that record a send — the
 * Azure SDKs time their sends there and make a zero-length PRODUCER span per
 * message, and some AWS SDK instrumentations record publishes only that way;
 * CONSUMER spans are deliveries and processing, less the receives that
 * returned nothing and, on SQS, the receive calls, which time a long poll
 * rather than any work. Every such filter is one conjunction on top of the
 * queue's key, and every one reads an attribute the resolver's direction rule
 * reads, or the batch size.
 */

// A publish, as most messaging instrumentations mark it.
export const MESSAGE_QUEUE_PUBLISH_SPAN_KIND: SpanKind = SpanKind.Producer;

// A delivery / processing of a message.
export const MESSAGE_QUEUE_CONSUME_SPAN_KIND: SpanKind = SpanKind.Consumer;

// The kind of a span that calls the broker: a send, a receive, a settlement.
export const MESSAGE_QUEUE_CLIENT_SPAN_KIND: SpanKind = SpanKind.Client;

// How many services each of the Producers / Consumers cards lists.
export const MESSAGE_QUEUE_SERVICE_LIMIT: number = 10;

// ---- which spans are which ---------------------------------------------------

/*
 * The span attributes the Overview reads an operation from: the keys the
 * resolver's direction rule reads (MESSAGING_DIRECTION_ATTRIBUTES:
 * `messaging.operation.type` since semconv 1.26, the older
 * `messaging.operation`, and for SQS / SNS the AWS SDK operation in
 * `rpc.method`), and the number of messages a batch operation moved.
 * Values are matched as instrumentations write them: semconv's operation
 * types in lowercase, the AWS operations in the SDK's own spelling.
 */
export const MESSAGE_QUEUE_OPERATION_TYPE_ATTRIBUTE: string =
  "messaging.operation.type";
export const MESSAGE_QUEUE_LEGACY_OPERATION_ATTRIBUTE: string =
  "messaging.operation";
export const MESSAGE_QUEUE_RPC_METHOD_ATTRIBUTE: string = "rpc.method";
export const MESSAGE_QUEUE_BATCH_MESSAGE_COUNT_ATTRIBUTE: string =
  "messaging.batch.message_count";

/*
 * The operations a client span records a publish with: "send" (semconv
 * 1.28 and later) and "publish" (before, and still the Azure SDKs'
 * `messaging.operation`). "" stands for the key being absent — ClickHouse
 * reads a missing map key as "" — so either key may be the one set.
 */
export const MESSAGE_QUEUE_SEND_OPERATIONS: ReadonlyArray<string> = [
  "publish",
  "send",
];

/*
 * A receive: a consumer asking the broker for messages. What that span
 * measures depends on who records it: SQS's is a ReceiveMessage call.
 */
export const MESSAGE_QUEUE_RECEIVE_OPERATION: string = "receive";

/*
 * The AWS SDK operations that publish, as `rpc.method` spells them: the
 * Java agent and botocore write the operation, Go's otelaws prefixes it
 * with the service. The resolver reads them (lowercased) only on SQS and
 * SNS spans, and so does the Overview.
 */
export const MESSAGE_QUEUE_AWS_SEND_RPC_METHODS: ReadonlyArray<string> = [
  "SendMessage",
  "SendMessageBatch",
  "Publish",
  "PublishBatch",
  "SQS/SendMessage",
  "SQS/SendMessageBatch",
  "SNS/Publish",
  "SNS/PublishBatch",
];

// The systems whose spans name a publish only by the AWS SDK operation.
export const MESSAGE_QUEUE_AWS_RPC_SYSTEMS: ReadonlyArray<string> = [
  "aws_sqs",
  "aws.sns",
];

/*
 * The systems whose consumer RECEIVE spans always wrap a call that asks the
 * broker for messages — and so time the wait, not the work. Amazon SQS's
 * ReceiveMessage long-polls for up to 20 seconds and may return nothing:
 * boto3sqs and Node's instrumentation-aws-sdk before 0.58 record every call
 * as a CONSUMER `receive` span, empty ones included, and a CONSUMER
 * `process` span per message on top; the Java agent records the receive
 * (when it returned messages) and a `process` span per message; Node's
 * 0.58 and later record only the receive, with the number of messages it
 * returned in messaging.batch.message_count. So on an SQS queue the
 * `process` spans are the messages consumed and processed, and a receive
 * counts only when it says it returned messages — once, as one batch.
 * Elsewhere a CONSUMER `receive` span can be a delivery (pika and aio-pika
 * record each pushed message that way) and stays in.
 */
export const MESSAGE_QUEUE_POLLED_RECEIVE_SYSTEMS: ReadonlyArray<string> = [
  "aws_sqs",
];

function canonicalSystemOf(system: string | null | undefined): string {
  return getMessagingSystemDescriptor(system)?.system || "";
}

/** Whether a system's receive spans are polls (see the list above). */
export function isMessageQueuePolledReceiveSystem(
  system: string | null | undefined,
): boolean {
  return MESSAGE_QUEUE_POLLED_RECEIVE_SYSTEMS.includes(
    canonicalSystemOf(system),
  );
}

/** Whether a system's spans can name a publish by its AWS SDK operation. */
export function isMessageQueueAwsRpcSystem(
  system: string | null | undefined,
): boolean {
  return MESSAGE_QUEUE_AWS_RPC_SYSTEMS.includes(canonicalSystemOf(system));
}

/*
 * The groups of a queue's spans the Overview reads, each ONE conjunction of
 * column and attribute filters on top of the queue's key (the key scopes the
 * queue; these only tell its spans apart):
 *
 *   - "all": every span naming the queue — the error rate's denominator.
 *   - "publish": PRODUCER spans — a send, or the per-message span a client
 *     creates before a batched send.
 *   - "send": CLIENT spans that record a publish in either operation key.
 *     The Azure SDKs (Service Bus, Event Hubs) create a zero-length PRODUCER
 *     span per message BEFORE the send, and time the send — and record its
 *     failure — in this CLIENT span; Go's otelaws records SNS publishes only
 *     this way. Both keys must be one of the send operations or absent, and
 *     at least one must be present (attributeKeys).
 *   - "awsSend" (SQS and SNS only): CLIENT spans that name a publish only by
 *     the AWS SDK operation — the Java agent's SNS publishes, botocore's and
 *     Go's SQS sends.
 *   - "consume": CONSUMER spans that handled messages. A span that says its
 *     batch held no message (messaging.batch.message_count 0: a receive
 *     that returned nothing) is left out everywhere; on a queue whose
 *     receive spans are polls (MESSAGE_QUEUE_POLLED_RECEIVE_SYSTEMS), so is
 *     every receive span.
 *   - "receivedBatch" (polled systems only): the receive spans that report
 *     returning messages — Node's instrumentation-aws-sdk 0.58+, which
 *     records nothing else. Each is one batch consumed; its time is the
 *     poll's, so never a processing time.
 */
export type MessageQueueSpanPopulation =
  | "all"
  | "publish"
  | "send"
  | "awsSend"
  | "consume"
  | "receivedBatch";

/**
 * The column and attribute filters of one group of a queue's spans, for the
 * queue's SPECIFIC system (SQS reads its receive spans apart): a fragment of
 * a Span query, put on top of the queue's key by whoever reads it. "all" is
 * no filter at all.
 */
export function getMessageQueueSpanPopulationFilter(
  population: MessageQueueSpanPopulation,
  system: string | null | undefined,
): Record<string, unknown> {
  const sendOrAbsent: Array<string> = [...MESSAGE_QUEUE_SEND_OPERATIONS, ""];

  switch (population) {
    case "publish":
      return { kind: MESSAGE_QUEUE_PUBLISH_SPAN_KIND };
    case "send":
      return {
        kind: MESSAGE_QUEUE_CLIENT_SPAN_KIND,
        attributes: {
          [MESSAGE_QUEUE_OPERATION_TYPE_ATTRIBUTE]: new Includes([
            ...sendOrAbsent,
          ]),
          [MESSAGE_QUEUE_LEGACY_OPERATION_ATTRIBUTE]: new Includes([
            ...sendOrAbsent,
          ]),
        },
        attributeKeys: new Includes([
          MESSAGE_QUEUE_OPERATION_TYPE_ATTRIBUTE,
          MESSAGE_QUEUE_LEGACY_OPERATION_ATTRIBUTE,
        ]),
      };
    case "awsSend":
      return {
        kind: MESSAGE_QUEUE_CLIENT_SPAN_KIND,
        attributes: {
          [MESSAGE_QUEUE_OPERATION_TYPE_ATTRIBUTE]: "",
          [MESSAGE_QUEUE_LEGACY_OPERATION_ATTRIBUTE]: "",
          [MESSAGE_QUEUE_RPC_METHOD_ATTRIBUTE]: new Includes([
            ...MESSAGE_QUEUE_AWS_SEND_RPC_METHODS,
          ]),
        },
      };
    case "consume": {
      const attributes: Record<string, unknown> = {
        [MESSAGE_QUEUE_BATCH_MESSAGE_COUNT_ATTRIBUTE]: new IncludesNone(["0"]),
      };
      if (isMessageQueuePolledReceiveSystem(system)) {
        attributes[MESSAGE_QUEUE_OPERATION_TYPE_ATTRIBUTE] = new IncludesNone([
          MESSAGE_QUEUE_RECEIVE_OPERATION,
        ]);
        attributes[MESSAGE_QUEUE_LEGACY_OPERATION_ATTRIBUTE] = new IncludesNone(
          [MESSAGE_QUEUE_RECEIVE_OPERATION],
        );
      }
      return { kind: MESSAGE_QUEUE_CONSUME_SPAN_KIND, attributes: attributes };
    }
    case "receivedBatch":
      return {
        kind: MESSAGE_QUEUE_CONSUME_SPAN_KIND,
        attributes: {
          [MESSAGE_QUEUE_OPERATION_TYPE_ATTRIBUTE]:
            MESSAGE_QUEUE_RECEIVE_OPERATION,
          [MESSAGE_QUEUE_BATCH_MESSAGE_COUNT_ATTRIBUTE]:
            new GreaterThan<number>(0),
        },
      };
    default:
      return {};
  }
}

// ---- a service's row on either side of the queue -------------------------

// One service on either side of the queue, and how its spans went.
export interface MessageQueueServiceFigures {
  // Span.primaryEntityId — the service that recorded the spans.
  serviceId: string;
  // Its messages: spans (one per message, or per batch sent in one call).
  calls: number;
  errors: number;
  errorRatePercent: number | null;
  p95DurationMs: number | null;
}

/*
 * The busiest services on one side (at most the limit) and how many there
 * were in all.
 */
export interface MessageQueueServiceFiguresList {
  services: Array<MessageQueueServiceFigures>;
  total: number;
}

/*
 * One group of the queue's spans read per service over the whole window:
 * service id → spans, failed spans and the p95 duration (milliseconds).
 */
export interface MessageQueueServiceSpanFigures {
  counts: Map<string, number>;
  errors: Map<string, number>;
  p95Ms: Map<string, number>;
}

export function emptyMessageQueueServiceSpanFigures(): MessageQueueServiceSpanFigures {
  return { counts: new Map(), errors: new Map(), p95Ms: new Map() };
}

function sortedServiceRows(
  rows: Array<MessageQueueServiceFigures>,
  limit: number,
): MessageQueueServiceFiguresList {
  const busy: Array<MessageQueueServiceFigures> = rows.filter(
    (row: MessageQueueServiceFigures): boolean => {
      return row.calls > 0;
    },
  );
  busy.sort(
    (a: MessageQueueServiceFigures, b: MessageQueueServiceFigures): number => {
      if (b.calls !== a.calls) {
        return b.calls - a.calls;
      }
      return a.serviceId < b.serviceId
        ? -1
        : a.serviceId > b.serviceId
          ? 1
          : 0;
    },
  );
  return { services: busy.slice(0, limit), total: busy.length };
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/*
 * The cards' limit: a positive limit, whole; anything else the cards'
 * default. The topology asks for every service (Number.POSITIVE_INFINITY,
 * which Math.floor keeps).
 */
function limitOf(limit: number | undefined): number {
  return typeof limit === "number" && limit > 0
    ? Math.floor(limit)
    : MESSAGE_QUEUE_SERVICE_LIMIT;
}

/*
 * The Producers card and the part of Published that producer spans miss:
 *
 *   - a service's messages are its PRODUCER spans (one per message, or per
 *     batch sent in one call); a service that records no producer span but
 *     client send spans ("send" / "awsSend") is counted from those, and is
 *     one of `clientOnlyServiceIds`;
 *   - its failures and p95 publish time are those of its client send spans
 *     when it records any — the Azure SDKs' producer spans are zero-length
 *     markers made before the send, and the send's time and failure are in
 *     the client span — and of its producer spans otherwise. Where a
 *     service has sends of both client groups (it never has in practice),
 *     the busier group's p95 stands for its sends.
 */
export interface MessageQueueProducerServices extends MessageQueueServiceFiguresList {
  // Services counted from client send spans alone, busiest first.
  clientOnlyServiceIds: Array<string>;
  // Their send spans, all of them: what Published adds for them.
  clientOnlyPublished: number;
}

export function combineMessageQueueProducerServices(data: {
  producer: MessageQueueServiceSpanFigures;
  sends: ReadonlyArray<MessageQueueServiceSpanFigures>;
  limit?: number | undefined;
}): MessageQueueProducerServices {
  const ids: Set<string> = new Set<string>(data.producer.counts.keys());
  for (const figures of data.sends) {
    for (const id of figures.counts.keys()) {
      ids.add(id);
    }
  }

  const rows: Array<MessageQueueServiceFigures> = [];
  const clientOnly: Array<{ id: string; sends: number }> = [];

  for (const id of ids) {
    const produced: number = data.producer.counts.get(id) || 0;
    let sendCount: number = 0;
    let sendErrors: number = 0;
    let busiestSends: number = 0;
    let sendP95: number | null = null;

    for (const figures of data.sends) {
      const count: number = figures.counts.get(id) || 0;
      if (count <= 0) {
        continue;
      }
      sendCount += count;
      sendErrors += Math.min(figures.errors.get(id) || 0, count);
      if (count > busiestSends) {
        busiestSends = count;
        sendP95 = finiteOrNull(figures.p95Ms.get(id));
      }
    }

    if (produced <= 0 && sendCount <= 0) {
      continue;
    }

    if (produced <= 0) {
      clientOnly.push({ id: id, sends: sendCount });
    }

    const errors: number =
      sendCount > 0
        ? sendErrors
        : Math.min(data.producer.errors.get(id) || 0, produced);
    const attempts: number = sendCount > 0 ? sendCount : produced;

    rows.push({
      serviceId: id,
      calls: produced > 0 ? produced : sendCount,
      errors: errors,
      errorRatePercent: attempts > 0 ? (errors / attempts) * 100 : null,
      p95DurationMs:
        sendCount > 0 ? sendP95 : finiteOrNull(data.producer.p95Ms.get(id)),
    });
  }

  clientOnly.sort(
    (
      a: { id: string; sends: number },
      b: { id: string; sends: number },
    ): number => {
      return b.sends - a.sends || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    },
  );

  return {
    ...sortedServiceRows(rows, limitOf(data.limit)),
    clientOnlyServiceIds: clientOnly.map(
      (entry: { id: string; sends: number }): string => {
        return entry.id;
      },
    ),
    clientOnlyPublished: clientOnly.reduce(
      (total: number, entry: { id: string; sends: number }): number => {
        return total + entry.sends;
      },
      0,
    ),
  };
}

/*
 * The Consumers card: a service's messages are its "consume" spans plus,
 * on SQS, its receives that returned messages (one per batch); its
 * failures and p95 processing time are those of its "consume" spans alone
 * — a receive's time is the poll's, and a receive that failed returned no
 * message, so it is in neither group.
 */
export function combineMessageQueueConsumerServices(data: {
  consume: MessageQueueServiceSpanFigures;
  receivedBatches?: MessageQueueServiceSpanFigures | undefined;
  limit?: number | undefined;
}): MessageQueueServiceFiguresList {
  const batches: MessageQueueServiceSpanFigures =
    data.receivedBatches || emptyMessageQueueServiceSpanFigures();
  const ids: Set<string> = new Set<string>([
    ...data.consume.counts.keys(),
    ...batches.counts.keys(),
  ]);

  const rows: Array<MessageQueueServiceFigures> = [];
  for (const id of ids) {
    const handled: number = data.consume.counts.get(id) || 0;
    const received: number = batches.counts.get(id) || 0;
    const consumed: number = handled + received;
    const errors: number = Math.min(data.consume.errors.get(id) || 0, handled);
    rows.push({
      serviceId: id,
      calls: consumed,
      errors: errors,
      errorRatePercent: consumed > 0 ? (errors / consumed) * 100 : null,
      p95DurationMs:
        handled > 0 ? finiteOrNull(data.consume.p95Ms.get(id)) : null,
    });
  }

  return sortedServiceRows(rows, limitOf(data.limit));
}

/**
 * Whether a queue of this system reads a group at all: AWS's send
 * operations only on SQS and SNS ("awsSend"), the received batches only
 * where receives are polls ("receivedBatch"), every other group always —
 * what the Overview reads for a queue, and what the topology keeps of it.
 */
export function isMessageQueueSpanPopulationRead(
  population: MessageQueueSpanPopulation,
  system: string | null | undefined,
): boolean {
  if (population === "awsSend") {
    return isMessageQueueAwsRpcSystem(system);
  }
  if (population === "receivedBatch") {
    return isMessageQueuePolledReceiveSystem(system);
  }
  return true;
}
