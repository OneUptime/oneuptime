import BadDataException from "../Exception/BadDataException";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  canonicalizeMessageQueueBrokerScope,
  toMessageQueueIdentity,
} from "./MessageQueueIdentity";
import {
  isExcludedMessagingSystem,
  normalizeMessagingSystem,
} from "./MessagingSystem";
import {
  MESSAGE_QUEUE_DESTINATION_MAX_LENGTH,
  MESSAGING_SYSTEM_ATTRIBUTE,
  RABBITMQ_ROUTING_KEY_ATTRIBUTES,
  ResolvedMessagingDestination,
  resolveMessagingSpan,
} from "./MessagingTelemetryResolver";

/*
 * A queue a person adds by hand (Queues → Create Queue, or the API): the
 * identity MessageQueueService's manual create stores and the create form
 * previews. One implementation serves both, so the form can never promise
 * an identity the server does not store, or refuse what the server would
 * take. Pure and isomorphic; checkManualMessageQueue never throws.
 *
 * What was typed goes through the normalization discovery applies, so the
 * row keys the same identity the queue's own telemetry builds: an SQS queue
 * URL is keyed by its name, a Pulsar short name by its persistent:// topic,
 * an ActiveMQ queue by its JMS family (see resolveTypedDestination).
 */

// How much of a typed value a refusal quotes.
const MAX_QUOTED_INPUT_LENGTH: number = 100;

// The key a typed destination is handed to the resolver as (all but RabbitMQ).
const MESSAGING_DESTINATION_NAME_ATTRIBUTE: string =
  "messaging.destination.name";

const RABBITMQ_SYSTEM: string = "rabbitmq";

// The key a typed RabbitMQ name is handed to the resolver as.
const RABBITMQ_ROUTING_KEY_ATTRIBUTE: string =
  RABBITMQ_ROUTING_KEY_ATTRIBUTES[0]!;

/*
 * RabbitMQ's default exchange, as the .NET client and the semantic
 * conventions name it. It is no queue: it delivers each message to the
 * queue its routing key names, which is the queue every span through it
 * resolves to, so no telemetry would ever reach a queue of this name.
 */
const RABBITMQ_DEFAULT_EXCHANGE: string = "amq.default";

/*
 * A delivery through the default exchange, joined the way a span can name
 * it (`amq.default:orders`): it goes to the queue its routing key names.
 * No queue is named so - RabbitMQ refuses to declare one that starts with
 * "amq." - so it is read as that queue, as a span's is (and, like a span's
 * default-exchange marker, whatever its case).
 */
const RABBITMQ_DEFAULT_EXCHANGE_DELIVERY_PREFIX: string = `${RABBITMQ_DEFAULT_EXCHANGE}:`;

export interface ManualMessageQueueInput {
  messagingSystem?: unknown;
  destinationName?: unknown;
  brokerScope?: unknown;
}

// A manual create's identity, as MessageQueueService.onBeforeCreate stores it.
export interface ManualMessageQueue {
  // The SPECIFIC canonical system ("activemq").
  system: string;
  // The destination normalized as discovery normalizes it, original casing.
  destination: string;
  // The canonical Azure namespace, "" for none.
  brokerScope: string;
  queueIdentifier: string;
}

// The input field a refusal is about (named as the MessageQueue column).
export type ManualMessageQueueField =
  | "messagingSystem"
  | "brokerScope"
  | "destinationName";

export interface ManualMessageQueueRefusal {
  field: ManualMessageQueueField;
  // What to change, as the manual create's BadDataException says it.
  message: string;
}

export type ManualMessageQueueCheck =
  | { queue: ManualMessageQueue; refusal: null }
  | { queue: null; refusal: ManualMessageQueueRefusal };

/**
 * The queue a person's input names, or the first thing wrong with it:
 *
 *   - the system: missing, an in-process "system" (spring_integration) or
 *     not a messaging.system value at all. Aliases fold ("AmazonSQS" ->
 *     aws_sqs);
 *   - the namespace of an Azure Service Bus / Event Hubs queue: a namespace
 *     host is reduced to its namespace, anything that cannot be one is
 *     refused; for every other system it is ignored. It is judged before
 *     the destination, so a form can show each field's refusal on its own:
 *     the destination is judged once the namespace is valid;
 *   - the destination: missing, a destination discovery would never keep
 *     (temporary, generated, placeholder, a list, control characters, over
 *     MESSAGE_QUEUE_DESTINATION_MAX_LENGTH characters) or RabbitMQ's default
 *     exchange alone (a delivery through it, `amq.default:orders`, is read
 *     as the queue it names), then an identity too long to store.
 *
 * Every refusal names its field and says what to change.
 */
export function checkManualMessageQueue(
  input: ManualMessageQueueInput | null | undefined,
): ManualMessageQueueCheck {
  const rawSystem: string = trimmedText(input?.messagingSystem);

  if (!rawSystem) {
    return refuse(
      "messagingSystem",
      "Messaging system is required. Choose the broker this queue lives on, for example Apache Kafka, RabbitMQ or Amazon SQS.",
    );
  }

  if (isExcludedMessagingSystem(rawSystem)) {
    return refuse(
      "messagingSystem",
      `${quoteManualMessageQueueInput(rawSystem)} does not name a message broker - its channels are in-process calls - so it has no queues.`,
    );
  }

  const system: string | null = normalizeMessagingSystem(rawSystem);

  if (!system) {
    return refuse(
      "messagingSystem",
      `${quoteManualMessageQueueInput(rawSystem)} is not a messaging system. Choose one from the list, or enter the messaging.system value your applications report: lowercase letters, digits, ".", "_" and "-", at most 64 characters.`,
    );
  }

  const brokerScope: string | null = canonicalizeMessageQueueBrokerScope(
    system,
    input?.brokerScope,
  );

  if (brokerScope === null) {
    return refuse(
      "brokerScope",
      `${quoteManualMessageQueueInput(
        trimmedText(input?.brokerScope),
      )} is not an Azure namespace name. Enter the namespace - the first part of <namespace>.servicebus.windows.net - or that whole host name.`,
    );
  }

  const rawDestination: string = trimmedText(input?.destinationName);

  if (!rawDestination) {
    return refuse(
      "destinationName",
      "Destination is required: the queue, topic or subscription name, as your applications and the broker name it.",
    );
  }

  const destination: string | null =
    system === RABBITMQ_SYSTEM
      ? rabbitMqTypedQueue(rawDestination)
      : rawDestination;

  if (destination === null) {
    return refuse(
      "destinationName",
      `${quoteManualMessageQueueInput(
        rawDestination,
      )} is RabbitMQ's default exchange, not a queue: it delivers each message to the queue its routing key names. Enter that queue's name.`,
    );
  }

  const resolved: ResolvedMessagingDestination | null = resolveTypedDestination(
    system,
    destination,
  );

  if (!resolved) {
    return refuse(
      "destinationName",
      `${quoteManualMessageQueueInput(
        rawDestination,
      )} cannot be a queue: OneUptime never keeps a queue for a temporary, generated or placeholder destination (a reply queue, an inbox, a bare UUID), a list of names, a name with control characters or a name longer than ${MESSAGE_QUEUE_DESTINATION_MAX_LENGTH} characters.`,
    );
  }

  const identity: MessageQueueIdentity | null = toMessageQueueIdentity({
    system: resolved.system,
    brokerScope: brokerScope,
    destination: resolved.destination,
  });
  const queueIdentifier: string | null = identity
    ? buildMessageQueueIdentifier(identity)
    : null;

  if (!identity || !queueIdentifier) {
    return refuse(
      "destinationName",
      "This queue's identity - its system, namespace and destination together - is too long to store. Shorten the destination.",
    );
  }

  return {
    queue: {
      system: resolved.system,
      destination: resolved.destination,
      brokerScope: identity.brokerScope,
      queueIdentifier: queueIdentifier,
    },
    refusal: null,
  };
}

/**
 * checkManualMessageQueue as the server's manual create applies it: the
 * queue, or a BadDataException carrying the refusal's message.
 */
export function resolveManualMessageQueue(
  input: ManualMessageQueueInput | null | undefined,
): ManualMessageQueue {
  const check: ManualMessageQueueCheck = checkManualMessageQueue(input);

  if (check.refusal !== null) {
    throw new BadDataException(check.refusal.message);
  }

  return check.queue;
}

/**
 * A typed value as a refusal quotes it: in double quotes, cut to its first
 * MAX_QUOTED_INPUT_LENGTH characters plus "…" when longer.
 */
export function quoteManualMessageQueueInput(value: string): string {
  const clipped: string =
    value.length > MAX_QUOTED_INPUT_LENGTH
      ? `${value.substring(0, MAX_QUOTED_INPUT_LENGTH)}…`
      : value;

  return `"${clipped}"`;
}

/*
 * The typed destination, resolved as discovery resolves a span that names
 * it (resolveMessagingSpan, no kind): a queue URL or ARN reduced to its
 * name, a Pub/Sub path to its id, a Pulsar short name completed, a JMS
 * prefix dropped, temporary and generated names refused, UUIDs templated.
 *
 * Except that a RabbitMQ queue name is taken whole (rabbitMqTypedQueue has
 * already read a default-exchange delivery, `amq.default:orders`, as its
 * queue). A span's RabbitMQ destination can join exchange, routing key and
 * queue (`shop:new-order:orders`, or aio-pika's `exchange,routing key`),
 * and the resolver splits those forms.
 * A person types a queue's own name, as the broker and its `rabbitmq`
 * receiver report it, and real queue names contain the same separators:
 * Hutch names a consumer's queue `app:billing:invoice_consumer`, and
 * EasyNetQ `Namespace.Type, Assembly_subscription`. Split, such a name
 * would key a queue its broker metrics never reach, and two queues sharing
 * a last segment would collide. So the name goes in as the routing key of a
 * delivery through the default exchange - which RabbitMQ routes to exactly
 * the queue of that name - and the resolver takes a routing key whole, the
 * way it takes a broker metric's queue name.
 */
function resolveTypedDestination(
  system: string,
  destination: string,
): ResolvedMessagingDestination | null {
  const destinationAttribute: string =
    system === RABBITMQ_SYSTEM
      ? RABBITMQ_ROUTING_KEY_ATTRIBUTE
      : MESSAGING_DESTINATION_NAME_ATTRIBUTE;

  return resolveMessagingSpan({
    getAttribute: (key: string): unknown => {
      if (key === MESSAGING_SYSTEM_ATTRIBUTE) {
        return system;
      }
      if (key === destinationAttribute) {
        return destination;
      }
      return undefined;
    },
    kind: null,
  });
}

/*
 * The queue a typed RabbitMQ name names: the name itself, except a
 * delivery through the default exchange (`amq.default:orders` names the
 * queue "orders"). Null for the default exchange with no queue after it.
 */
function rabbitMqTypedQueue(typed: string): string | null {
  const lower: string = typed.toLowerCase();

  if (lower === RABBITMQ_DEFAULT_EXCHANGE) {
    return null;
  }

  if (!lower.startsWith(RABBITMQ_DEFAULT_EXCHANGE_DELIVERY_PREFIX)) {
    return typed;
  }

  return (
    typed.substring(RABBITMQ_DEFAULT_EXCHANGE_DELIVERY_PREFIX.length).trim() ||
    null
  );
}

function refuse(
  field: ManualMessageQueueField,
  message: string,
): ManualMessageQueueCheck {
  return { queue: null, refusal: { field: field, message: message } };
}

function trimmedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
