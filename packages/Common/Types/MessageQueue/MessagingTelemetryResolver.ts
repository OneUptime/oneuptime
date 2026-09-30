import {
  getMessagingBrokerScope,
  isExcludedMessagingSystem,
  normalizeMessagingSystem,
} from "./MessagingSystem";
import {
  canonicalizeMessageQueueBrokerScope,
  getAzureNamespaceFromHost,
  hasControlCharacter,
} from "./MessageQueueIdentity";
import {
  getMessageQueueMetricDescriptorsByName,
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
  MessageQueueSignal,
  MESSAGING_SDK_METRIC_SYSTEMS,
} from "./MessageQueueMetricCatalog";

/*
 * Turning telemetry into a message queue — the one pure gate ingest (which
 * stamps the queue's entity key on the row) and the discovery cron (which
 * creates the queue's row) both run, so the two can never disagree:
 *
 *   - resolveMessagingSpan: "which destination does this messaging span
 *     publish to, consume from or settle on?";
 *   - resolveMessagingMetricDatapoint: "which destination does this broker
 *     or messaging-client datapoint describe?".
 *
 * Every messaging attribute is still at stability "development", so real
 * telemetry mixes five naming generations (spec 1.16 and earlier, 1.17-1.20,
 * 1.21-1.25, 1.26-1.27, 1.28 and later), and each concept is read from
 * several keys, newest first. Span NAMES are never parsed: their format
 * flipped in 1.27, and vendors use their own.
 *
 * Conservative on purpose: a wrong destination creates a queue nobody has
 * (a reply queue per request, a consumer tag per restart), so anything
 * temporary, generated or ambiguous resolves to null. The cron reads back
 * exactly MESSAGING_RESOLVER_INPUT_ATTRIBUTES from each stored span and
 * feeds them through the same function, so a key read here and not listed
 * there would split the two — the tests pin that. Values are read the way
 * ClickHouse stores them (see storedText), so resolving a row at ingest and
 * resolving it again from the table give the same answer. Pure and
 * isomorphic; nothing here throws on telemetry input.
 */

export type MessagingDirection = "publish" | "consume" | "settle" | "unknown";

export interface ResolvedMessagingDestination {
  // Canonical system (normalizeMessagingSystem).
  system: string;
  /*
   * The destination for display: original casing kept, the system's
   * normalizers applied (a queue URL reduced to its name, a Pulsar
   * partition folded into its topic, …) and UUIDs templated to `{uuid}`.
   */
  destination: string;
  /*
   * "" unless the system's broker scope is "azure-namespace": then the
   * lowercased namespace, when an address names one.
   */
  brokerScope: string;
  // Sanitized host[:port] as reported — display only, never identity.
  brokerAddress: string | null;
  direction: MessagingDirection;
  // Consumer group or subscription — display only, never identity.
  consumerGroup: string | null;
  // The destination is a dead-letter (sub-)queue — display only.
  isDeadLetter: boolean;
}

export type AttributeGetter = (key: string) => unknown;

// A destination longer than this, after normalization, is not a queue name.
export const MESSAGE_QUEUE_DESTINATION_MAX_LENGTH: number = 255;

// Display-only values are clamped to this.
const DISPLAY_VALUE_MAX_LENGTH: number = 255;

/*
 * The presence of ANY of these (non-blank) makes a span or datapoint a
 * messaging candidate. Each is set by at least one instrumentation that
 * sets none of the others: `messaging.destination` by pre-1.17 JS and
 * Python instrumentations, `message_bus.destination` and `az.namespace` by
 * the Azure SDKs' legacy mode, `aws.queue_url` by the .NET AWS
 * instrumentation's legacy mode (no `messaging.system`), `aws.sns.topic.arn`
 * by the Java agent's SNS spans (no `messaging.system` either).
 */
export const MESSAGING_TRIGGER_ATTRIBUTES: ReadonlyArray<string> = [
  "messaging.system",
  "messaging.destination.name",
  "messaging.destination",
  "message_bus.destination",
  "az.namespace",
  "azure.resource_provider.namespace",
  "aws.sqs.queue.url",
  "aws.queue_url",
  "aws.sns.topic.arn",
];

export const MESSAGING_SYSTEM_ATTRIBUTE: string = "messaging.system";

/*
 * The Azure resource provider namespace the Azure SDKs stamp on every span
 * (`az.namespace`; the Java SDK dual-emits the newer name).
 */
export const AZURE_RESOURCE_PROVIDER_ATTRIBUTES: ReadonlyArray<string> = [
  "az.namespace",
  "azure.resource_provider.namespace",
];

/*
 * The resource provider namespaces, among those keys' values, that name a
 * messaging service — Service Bus's and Event Hubs' — and the system each
 * one is. Compared trimmed and lowercased.
 */
const AZURE_PROVIDER_SYSTEMS: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["microsoft.servicebus", "servicebus"],
  ["microsoft.eventhub", "eventhubs"],
]);

/**
 * Those namespaces, lowercase and sorted: the only values that make an Azure
 * resource provider key a messaging trigger (see isTriggerValue). The
 * discovery cron's span query admits a span on those keys for exactly these
 * values, so it reads the Azure SDK spans ingest keys, and not the Storage,
 * Key Vault or Cosmos DB spans that carry the same keys.
 */
export const AZURE_MESSAGING_PROVIDER_NAMESPACES: ReadonlyArray<string> =
  Array.from(AZURE_PROVIDER_SYSTEMS.keys()).sort();

/*
 * The Azure SDKs' legacy DiagnosticSource mode names the service in
 * `component`, next to `message_bus.destination` and `peer.address`.
 */
const AZURE_LEGACY_COMPONENT_ATTRIBUTE: string = "component";
const AZURE_LEGACY_COMPONENT_EVIDENCE: ReadonlyArray<string> = [
  "message_bus.destination",
  "peer.address",
];

export const RPC_SYSTEM_ATTRIBUTES: ReadonlyArray<string> = [
  "rpc.system",
  "rpc.system.name",
];
const RPC_SERVICE_ATTRIBUTE: string = "rpc.service";

/*
 * Destination precedence: the low-cardinality template first, then the
 * name, then the consumer-side names of spec 1.17-1.20 (the Azure JS SDK
 * still uses `messaging.source.name` on receive), the pre-1.17 name, and
 * the Azure SDKs' legacy key.
 */
export const MESSAGING_DESTINATION_ATTRIBUTES: ReadonlyArray<string> = [
  "messaging.destination.template",
  "messaging.destination.name",
  "messaging.source.template",
  "messaging.source.name",
  "messaging.destination",
  "message_bus.destination",
];

/*
 * Booleans that mark a destination as temporary or anonymous (the source
 * pair for spec 1.17-1.20 consumers). The pre-1.17
 * `messaging.temp_destination` is deliberately NOT read: Python pika and
 * aio-pika set it on every publish.
 */
export const MESSAGING_TEMPORARY_FLAG_ATTRIBUTES: ReadonlyArray<string> = [
  "messaging.destination.temporary",
  "messaging.destination.anonymous",
  "messaging.source.temporary",
  "messaging.source.anonymous",
];

/*
 * Amazon SQS names its queue by URL (last path segment is the name) when no
 * destination key does: the semconv key, then the .NET / Python botocore
 * key.
 */
export const SQS_QUEUE_URL_ATTRIBUTES: ReadonlyArray<string> = [
  "aws.sqs.queue.url",
  "aws.queue_url",
];

/*
 * Keys that hold an SQS queue URL only in some instrumentations, so they
 * count only when they ARE a URL: `messaging.url` (Python boto3sqs,
 * botocore), `server.address` (Go otelaws from v0.62.0) and `net.peer.name`
 * (Go otelaws up to v0.61.0).
 */
const SQS_QUEUE_URL_FALLBACK_ATTRIBUTES: ReadonlyArray<string> = [
  "messaging.url",
  "server.address",
  "net.peer.name",
];

export const SNS_TOPIC_ARN_ATTRIBUTES: ReadonlyArray<string> = [
  "aws.sns.topic.arn",
];

// The routing key a RabbitMQ message was published with (1.17+, then ≤1.16).
export const RABBITMQ_ROUTING_KEY_ATTRIBUTES: ReadonlyArray<string> = [
  "messaging.rabbitmq.destination.routing_key",
  "messaging.rabbitmq.routing_key",
];

/*
 * RabbitMQ.Client for .NET (v7) stamps `network.protocol.name` "amqp" on
 * every span (a messaging attribute only up to semconv 1.25). It writes the
 * 1.26+ operation keys, yet names the exchange alone, never semconv 1.30's
 * joined `{exchange}:{routing key}:{queue}`; the Java agent's opt-in mode,
 * which does join them, never sets it. See rabbitMqQueue.
 */
export const MESSAGING_PROTOCOL_NAME_ATTRIBUTE: string =
  "network.protocol.name";
const RABBITMQ_DOTNET_CLIENT_PROTOCOL: string = "amqp";

export interface MessagingAddressAttribute {
  address: string;
  port: string | null;
}

/*
 * Broker address precedence, display only: current, pre-1.21, 1.22+ peer,
 * the socket keys of 1.13-1.21, the Azure legacy key, then `messaging.url`
 * (removed in 1.17 but still emitted: a JSON list of bootstrap servers from
 * kafka-python, a censored AMQP URL from amqplib).
 */
export const MESSAGING_ADDRESS_ATTRIBUTES: ReadonlyArray<MessagingAddressAttribute> =
  [
    { address: "server.address", port: "server.port" },
    { address: "net.peer.name", port: "net.peer.port" },
    { address: "network.peer.address", port: "network.peer.port" },
    { address: "net.sock.peer.addr", port: null },
    { address: "server.socket.address", port: null },
    { address: "peer.address", port: null },
    { address: "messaging.url", port: null },
  ];

/*
 * Where an Azure namespace-scoped span names its namespace host
 * (`<namespace>.servicebus.windows.net`): .NET ActivitySource mode sets
 * `server.address`, the JS and Python SDKs `net.peer.name`, the legacy mode
 * `peer.address` (as `sb://…/`).
 */
export const MESSAGING_BROKER_SCOPE_ADDRESS_ATTRIBUTES: ReadonlyArray<string> =
  ["server.address", "net.peer.name", "peer.address", "network.peer.address"];

const OPERATION_TYPE_ATTRIBUTE: string = "messaging.operation.type";
const LEGACY_OPERATION_ATTRIBUTE: string = "messaging.operation";
const OPERATION_NAME_ATTRIBUTE: string = "messaging.operation.name";
const RPC_METHOD_ATTRIBUTE: string = "rpc.method";

/*
 * Direction evidence, strongest first (span kind sits between the first and
 * the second — see resolveDirection).
 */
export const MESSAGING_DIRECTION_ATTRIBUTES: ReadonlyArray<string> = [
  OPERATION_TYPE_ATTRIBUTE,
  LEGACY_OPERATION_ATTRIBUTE,
  OPERATION_NAME_ATTRIBUTE,
  RPC_METHOD_ATTRIBUTE,
];

/*
 * Consumer group / subscription precedence: 1.27+, then the Kafka keys of
 * 1.17-1.26 (still the Java agent's default) and 1.16, RocketMQ's legacy
 * key, Event Hubs', Service Bus's pre-1.27 subscription key, and the key
 * the Azure SDK for Java's Service Bus metrics name the subscription by
 * (azure-core-metrics-opentelemetry's rename of `subscriptionName`). The
 * pre-1.17 `messaging.consumer_id` ("{group} - {client id}") is deliberately
 * not read: it is per client instance, and the discovery cron groups by
 * every key read here.
 */
export const MESSAGING_CONSUMER_GROUP_ATTRIBUTES: ReadonlyArray<string> = [
  "messaging.consumer.group.name",
  "messaging.destination.subscription.name",
  "messaging.kafka.consumer.group",
  "messaging.kafka.consumer_group",
  "messaging.rocketmq.client_group",
  "messaging.eventhubs.consumer.group",
  "messaging.servicebus.destination.subscription_name",
  "messaging.servicebus.subscription_name",
];

/*
 * The reporting broker of a curated broker metric, when its source says so:
 * a Prometheus scrape stamps the target it scraped (the Pulsar or RocketMQ
 * broker itself) on the resource. Display only.
 */
export const MESSAGE_QUEUE_METRIC_ADDRESS_ATTRIBUTES: ReadonlyArray<MessagingAddressAttribute> =
  [{ address: "resource.server.address", port: "resource.server.port" }];

function uniqueKeys(
  lists: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlyArray<string> {
  const seen: Set<string> = new Set<string>();
  const keys: Array<string> = [];
  for (const list of lists) {
    for (const key of list) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

function addressKeys(
  attributes: ReadonlyArray<MessagingAddressAttribute>,
): Array<string> {
  const keys: Array<string> = [];
  for (const attribute of attributes) {
    keys.push(attribute.address);
    if (attribute.port) {
      keys.push(attribute.port);
    }
  }
  return keys;
}

/**
 * EVERY attribute key resolveMessagingSpan reads — and so what the discovery
 * cron selects from each stored span and groups by, before handing the row
 * back to the same resolver. Only keys that describe a destination, its
 * broker or the direction: never a per-message or per-instance value
 * (message ids, offsets, partitions, consumer or client ids), which would
 * split one queue's spans into a group per message.
 */
export const MESSAGING_RESOLVER_INPUT_ATTRIBUTES: ReadonlyArray<string> =
  uniqueKeys([
    MESSAGING_TRIGGER_ATTRIBUTES,
    [MESSAGING_SYSTEM_ATTRIBUTE],
    AZURE_RESOURCE_PROVIDER_ATTRIBUTES,
    [AZURE_LEGACY_COMPONENT_ATTRIBUTE],
    AZURE_LEGACY_COMPONENT_EVIDENCE,
    RPC_SYSTEM_ATTRIBUTES,
    [RPC_SERVICE_ATTRIBUTE],
    MESSAGING_DESTINATION_ATTRIBUTES,
    MESSAGING_TEMPORARY_FLAG_ATTRIBUTES,
    SQS_QUEUE_URL_ATTRIBUTES,
    SQS_QUEUE_URL_FALLBACK_ATTRIBUTES,
    SNS_TOPIC_ARN_ATTRIBUTES,
    RABBITMQ_ROUTING_KEY_ATTRIBUTES,
    [MESSAGING_PROTOCOL_NAME_ATTRIBUTE],
    addressKeys(MESSAGING_ADDRESS_ATTRIBUTES),
    MESSAGING_BROKER_SCOPE_ADDRESS_ATTRIBUTES,
    MESSAGING_DIRECTION_ATTRIBUTES,
    MESSAGING_CONSUMER_GROUP_ATTRIBUTES,
  ]);

/**
 * EVERY attribute key resolveMessagingMetricDatapoint reads to find a
 * datapoint's queue: the span keys (a messaging-client datapoint resolves
 * like a span), plus each curated broker metric's destination, scope and
 * required keys and the reporting broker's address. The discovery cron
 * groups by exactly these.
 */
export const MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES: ReadonlyArray<string> =
  uniqueKeys([
    MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
    ...MESSAGE_QUEUE_METRICS.map(
      (descriptor: MessageQueueMetricDescriptor): ReadonlyArray<string> => {
        return [
          ...descriptor.destinationAttributes,
          ...(descriptor.scopeAttributes || []),
          ...Object.keys(descriptor.requiredAttributes || {}),
        ];
      },
    ),
    addressKeys(MESSAGE_QUEUE_METRIC_ADDRESS_ATTRIBUTES),
  ]);

/**
 * The keys that mark a curated metric's finer-grained repeat
 * (excludeSeriesWithAttributes): the metric resolver also reads these, but
 * only to DROP a datapoint, and they are deliberately not in
 * MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES. They are per instance
 * (Pulsar's consumer name and id), so grouping the discovery query by them
 * would split a topic's rows per consumer. Leaving them out cannot change
 * which queues discovery finds: Pulsar writes a consumer's copy only inside
 * a subscription whose own series names the same topic.
 */
export const MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES: ReadonlyArray<string> =
  uniqueKeys(
    MESSAGE_QUEUE_METRICS.map(
      (descriptor: MessageQueueMetricDescriptor): ReadonlyArray<string> => {
        return descriptor.excludeSeriesWithAttributes || [];
      },
    ),
  );

// ---- reading attributes --------------------------------------------------

/*
 * Exactly the characters String.prototype.trim removes (ECMAScript
 * WhiteSpace and LineTerminator), so the allocation-free blank check below
 * agrees with readText, which trims.
 */
function isWhitespaceCode(code: number): boolean {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/*
 * Whether a value is present with something in it, without allocating:
 * a string with a non-whitespace character, a finite number, a boolean, an
 * array (stored as its JSON text, never blank).
 */
function isNonBlankValue(value: unknown): boolean {
  if (typeof value === "string") {
    for (let index: number = 0; index < value.length; index++) {
      if (!isWhitespaceCode(value.charCodeAt(index))) {
        return true;
      }
    }
    return false;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean" || typeof value === "bigint") {
    return true;
  }
  return Array.isArray(value);
}

/*
 * The text a value is stored as in a ClickHouse String column — an
 * attribute map's values (Map(String, String)) and the span kind alike: a
 * string as it is, a number or boolean as its String() form, an array as
 * its JSON text — so an ingest-time row (typed values) and the same row read
 * back from the table (strings) resolve alike. Anything else is absent.
 */
function storedText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

// The attribute's stored text, trimmed; null when absent or blank.
function readText(getAttribute: AttributeGetter, key: string): string | null {
  const text: string | null = storedText(getAttribute(key));
  if (text === null) {
    return null;
  }
  const trimmed: string = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// The first of `keys` readText finds, in list order.
function readFirstText(
  getAttribute: AttributeGetter,
  keys: ReadonlyArray<string>,
): string | null {
  for (const key of keys) {
    const text: string | null = readText(getAttribute, key);
    if (text !== null) {
      return text;
    }
  }
  return null;
}

/*
 * The Azure SDKs stamp their resource provider namespace on EVERY client
 * span — Storage, Cosmos DB and Key Vault as much as Service Bus — so those
 * two trigger keys admit a span only when they name a messaging provider
 * (AZURE_PROVIDER_SYSTEMS). Otherwise every Azure SDK span paid a full
 * resolve for a guaranteed "no queue": about 1 µs a row against 0.07 µs for
 * plain HTTP in the ingest benchmark. The comparison is resolveSystem's own
 * (stored text, trimmed, lowercased), so the gate never refuses a span the
 * resolver would place, and the discovery SQL admits the same values
 * (AZURE_MESSAGING_PROVIDER_NAMESPACES).
 */
const AZURE_RESOURCE_PROVIDER_TRIGGERS: ReadonlySet<string> = new Set<string>(
  AZURE_RESOURCE_PROVIDER_ATTRIBUTES,
);

// Longer than any provider namespace in AZURE_PROVIDER_SYSTEMS.
const AZURE_PROVIDER_TRIGGER_MAX_LENGTH: number = 32;

function isTriggerValue(key: string, value: unknown): boolean {
  if (!AZURE_RESOURCE_PROVIDER_TRIGGERS.has(key)) {
    return isNonBlankValue(value);
  }
  const text: string | null = storedText(value);
  if (text === null) {
    return false;
  }
  const trimmed: string = text.trim();
  return (
    trimmed.length <= AZURE_PROVIDER_TRIGGER_MAX_LENGTH &&
    AZURE_PROVIDER_SYSTEMS.has(trimmed.toLowerCase())
  );
}

/*
 * Cached once: under Jest's vm context every lookup of the global `Object`
 * goes through the sandbox's interceptors, which made this gate ~20× slower
 * there than in plain Node.
 */
const HAS_OWN_PROPERTY: (
  this: Record<string, unknown>,
  key: PropertyKey,
) => boolean = Object.prototype.hasOwnProperty;

function hasTrigger(getAttribute: AttributeGetter): boolean {
  for (
    let index: number = 0;
    index < MESSAGING_TRIGGER_ATTRIBUTES.length;
    index++
  ) {
    const key: string | undefined = MESSAGING_TRIGGER_ATTRIBUTES[index];
    if (key !== undefined && isTriggerValue(key, getAttribute(key))) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a row's flattened attributes carry any messaging trigger
 * (MESSAGING_TRIGGER_ATTRIBUTES) with a non-blank value — the Azure resource
 * provider keys only when they name Service Bus or Event Hubs — the cheap
 * gate ingest runs on every span before anything else. Own keys only; it
 * never enumerates the map, and allocates only to compare an Azure provider
 * value, so it is safe on every row.
 */
export function hasMessagingTrigger(
  attributes: Record<string, unknown> | null | undefined,
): boolean {
  if (!attributes || typeof attributes !== "object") {
    return false;
  }
  for (
    let index: number = 0;
    index < MESSAGING_TRIGGER_ATTRIBUTES.length;
    index++
  ) {
    const key: string | undefined = MESSAGING_TRIGGER_ATTRIBUTES[index];
    if (
      key !== undefined &&
      HAS_OWN_PROPERTY.call(attributes, key) &&
      isTriggerValue(key, attributes[key])
    ) {
      return true;
    }
  }
  return false;
}

// ---- span kind -------------------------------------------------------------

type SpanKindName = "INTERNAL" | "SERVER" | "CLIENT" | "PRODUCER" | "CONSUMER";

/*
 * The stored SpanKind strings ("SPAN_KIND_PRODUCER", …), the bare names,
 * and OTLP's numbers (1 internal … 5 consumer). Compared as literals: the
 * SpanKind enum lives in the Span analytics model, which a Types module does
 * not pull in (the tests pin the two against each other).
 */
const SPAN_KIND_BY_NAME: ReadonlyMap<string, SpanKindName> = new Map<
  string,
  SpanKindName
>([
  ["INTERNAL", "INTERNAL"],
  ["SERVER", "SERVER"],
  ["CLIENT", "CLIENT"],
  ["PRODUCER", "PRODUCER"],
  ["CONSUMER", "CONSUMER"],
]);

const SPAN_KIND_BY_OTLP_NUMBER: ReadonlyMap<number, SpanKindName> = new Map<
  number,
  SpanKindName
>([
  [1, "INTERNAL"],
  [2, "SERVER"],
  [3, "CLIENT"],
  [4, "PRODUCER"],
  [5, "CONSUMER"],
]);

const SPAN_KIND_PREFIX: string = "SPAN_KIND_";

// One or more ASCII digits, and nothing else.
function isAsciiDigits(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);
    if (code < 0x30 || code > 0x39) {
      return false;
    }
  }
  return true;
}

/*
 * A span's kind, read from the text ClickHouse keeps for it (storedText),
 * so that the stamper, which sees the value a row carries, and the
 * discovery cron, which reads the kind column back, read every kind alike.
 * The two can differ: ingest stores the SpanKind string, but a trace
 * pipeline's Span Kind Remapper writes its mapping's kind as it is, and a
 * configuration saved through the API may hold a NUMBER. The stamper then
 * sees 2 while the column keeps the JSON text "2"; read as a name, "2"
 * would be no kind, and the cron would create a queue for SERVER spans
 * ingest never keyed. So a trimmed run of ASCII digits is the OTLP number
 * it names, read as Number() reads it: leading zeros count for nothing
 * ("02" is 2, SERVER, as OtelTracesIngestService.mapSpanKind's parseInt
 * reads an OTLP kind). Any other text is a name ("SPAN_KIND_" optional, any
 * case). A number OTLP does not define, and numeric text that is not plain
 * digits ("-2", "2.5", "+2", "1e+21"), is no kind.
 */
function normalizeSpanKind(kind: unknown): SpanKindName | null {
  const text: string | null = storedText(kind);
  if (text === null) {
    return null;
  }
  const trimmed: string = text.trim();
  if (isAsciiDigits(trimmed)) {
    return SPAN_KIND_BY_OTLP_NUMBER.get(Number(trimmed)) || null;
  }
  let name: string = trimmed.toUpperCase();
  if (name.startsWith(SPAN_KIND_PREFIX)) {
    name = name.substring(SPAN_KIND_PREFIX.length);
  }
  return SPAN_KIND_BY_NAME.get(name) || null;
}

// ---- system ------------------------------------------------------------------

const AZURE_LEGACY_COMPONENT_SYSTEMS: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["servicebus", "servicebus"],
  ["eventhubs", "eventhubs"],
]);

const AWS_RPC_SYSTEM: string = "aws-api";

const AWS_RPC_SERVICE_SYSTEMS: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["sqs", "aws_sqs"],
  ["amazonsqs", "aws_sqs"],
  ["sns", "aws.sns"],
  ["amazonsns", "aws.sns"],
]);

/*
 * Which system, in this order: `messaging.system`; the Azure resource
 * provider namespace; the Azure legacy `component` (only beside its other
 * legacy keys); an AWS SDK RPC span naming SQS or SNS (the Java agent's SNS
 * spans carry no `messaging.system`); the SQS queue URL / SNS topic ARN
 * keys. An excluded `messaging.system` (in-process channels) stops here; a
 * malformed one falls through to the other evidence. Celery sets no
 * messaging system and is not detected (its broker is unknown).
 */
function resolveSystem(getAttribute: AttributeGetter): string | null {
  const rawSystem: string | null = readText(
    getAttribute,
    MESSAGING_SYSTEM_ATTRIBUTE,
  );
  if (rawSystem !== null) {
    if (isExcludedMessagingSystem(rawSystem)) {
      return null;
    }
    const normalized: string | null = normalizeMessagingSystem(rawSystem);
    if (normalized) {
      return normalized;
    }
  }

  const provider: string | null = readFirstText(
    getAttribute,
    AZURE_RESOURCE_PROVIDER_ATTRIBUTES,
  );
  const providerSystem: string | undefined = provider
    ? AZURE_PROVIDER_SYSTEMS.get(provider.toLowerCase())
    : undefined;
  if (providerSystem) {
    return providerSystem;
  }

  const component: string | null = readText(
    getAttribute,
    AZURE_LEGACY_COMPONENT_ATTRIBUTE,
  );
  const componentSystem: string | undefined = component
    ? AZURE_LEGACY_COMPONENT_SYSTEMS.get(component.toLowerCase())
    : undefined;
  if (
    componentSystem &&
    readFirstText(getAttribute, AZURE_LEGACY_COMPONENT_EVIDENCE) !== null
  ) {
    return componentSystem;
  }

  const rpcSystem: string | null = readFirstText(
    getAttribute,
    RPC_SYSTEM_ATTRIBUTES,
  );
  if (rpcSystem !== null && rpcSystem.toLowerCase() === AWS_RPC_SYSTEM) {
    const rpcService: string | null = readText(
      getAttribute,
      RPC_SERVICE_ATTRIBUTE,
    );
    const awsSystem: string | undefined = rpcService
      ? AWS_RPC_SERVICE_SYSTEMS.get(rpcService.toLowerCase())
      : undefined;
    if (awsSystem) {
      return awsSystem;
    }
  }

  if (readFirstText(getAttribute, SQS_QUEUE_URL_ATTRIBUTES) !== null) {
    return "aws_sqs";
  }
  if (readFirstText(getAttribute, SNS_TOPIC_ARN_ATTRIBUTES) !== null) {
    return "aws.sns";
  }
  return null;
}

// ---- temporary destinations ------------------------------------------------

function isTrueFlag(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

function hasTemporaryFlag(getAttribute: AttributeGetter): boolean {
  for (const key of MESSAGING_TEMPORARY_FLAG_ATTRIBUTES) {
    if (isTrueFlag(getAttribute(key))) {
      return true;
    }
  }
  return false;
}

/*
 * Names instrumentations emit INSTEAD of a real destination:
 *   - "(temporary)": Java JMS temporary queues (and pika span names);
 *   - "(anonymous)": the spec's own placeholder up to 1.26;
 *   - "<generated>", "<default>": the Java agent's legacy RabbitMQ names
 *     ("<default>" is the default exchange; RabbitMQ resolves it through
 *     the routing key before this check);
 *   - "unknown": the Java agent's null destination (a Kafka batch spanning
 *     several topics) and JS / Python SNS spans without an ARN;
 *   - "aws:sqs": the Java agent's legacy Lambda SQS event source;
 *   - "-namespaceonlymetric-": Azure Monitor's EntityName for a
 *     namespace-level value.
 */
const PLACEHOLDER_DESTINATIONS: ReadonlySet<string> = new Set<string>([
  "(temporary)",
  "(anonymous)",
  "<generated>",
  "<default>",
  "unknown",
  "aws:sqs",
  "-namespaceonlymetric-",
]);

/*
 * SNS SMS publishes: the Python botocore instrumentation names the
 * destination "phone_number:**" (the number censored) and its span
 * "phone_number send". Exact values, for SNS only: a Kafka topic or an SQS
 * queue called "phone_numbers" is a real destination.
 */
const SNS_PHONE_NUMBER_PLACEHOLDER: string = "phone_number";
const SNS_PHONE_NUMBER_PLACEHOLDER_PREFIX: string = "phone_number:";

/*
 * What OneUptime's own scrubbers leave when they replace a WHOLE value: the
 * trace scrubber's "[REDACTED]" and "[HASHED:<first 8 hex of the SHA-256>]",
 * its mask of a short value ("***"), and a metric pipeline's default
 * "[REDACTED]". Nothing of the name is left, so there is no queue to find
 * (and every scrubbed destination must not merge into one queue). A value
 * scrubbed only in part ("orders-[REDACTED]") keeps its queue: the rest
 * still names it, and every scrubbed variant folds into it, as a templated
 * UUID does.
 */
const SCRUBBED_VALUE: string = "[redacted]";
const SCRUBBED_HASH_PATTERN: RegExp = /^\[hashed:[0-9a-f]+\]$/;
const MASK_CHARACTER: string = "*";

function isScrubbedValue(lower: string): boolean {
  if (lower === SCRUBBED_VALUE || SCRUBBED_HASH_PATTERN.test(lower)) {
    return true;
  }
  for (let index: number = 0; index < lower.length; index++) {
    if (lower.charAt(index) !== MASK_CHARACTER) {
      return false;
    }
  }
  return lower.length > 0;
}

/*
 * JMS temporary destinations as ActiveMQ prints them
 * ("temp-queue://ID:host-1234-…").
 */
const JMS_TEMPORARY_PREFIXES: ReadonlyArray<string> = [
  "temp-queue://",
  "temp-topic://",
];

const CANONICAL_UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UUID_SUBSTRING_PATTERN: RegExp =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/*
 * The Java agent's generated-RabbitMQ-queue heuristic: server-named
 * `amq.gen-…`, Spring AMQP's `spring.gen-…`, and Spring Cloud Stream's
 * anonymous queues `<destination>.anonymous.<22 base64url characters>`
 * (plus the bare UUID, checked for every system). Direct reply-to uses the
 * `amq.rabbitmq.reply-to` pseudo-queue and `amq.rabbitmq.reply-to.<suffix>`.
 */
const RABBITMQ_GENERATED_PREFIXES: ReadonlyArray<string> = [
  "amq.gen-",
  "spring.gen-",
  "amq.rabbitmq.reply-to",
];
const RABBITMQ_ANONYMOUS_QUEUE_PATTERN: RegExp =
  /\.anonymous\.[A-Za-z0-9_-]{22}$/;

// TIBCO's temporary destinations; ActiveMQ's advisory topics.
const JMS_GENERATED_PREFIXES: ReadonlyArray<string> = [
  "$tmp$",
  "activemq.advisory.",
];

/*
 * NATS request/reply inboxes (`_INBOX.<id>`; the Java agent's template is
 * the prefix itself) and JetStream acknowledgement subjects (`$JS.ACK.…`,
 * templated as `$JS.ACK`).
 */
const NATS_GENERATED_NAMES: ReadonlyArray<string> = ["_inbox", "$js.ack"];

// Pulsar's system topics: `__change_events`, `__transaction_*`, `…/__…`.
const PULSAR_SYSTEM_TOPIC_MARKER: string = "/__";
const PULSAR_SYSTEM_TOPICS: ReadonlyArray<string> = ["__change_events"];
const PULSAR_SYSTEM_TOPIC_PREFIXES: ReadonlyArray<string> = ["__transaction_"];

// An SNS SMS publish names the phone number (E.164) as its destination.
const SNS_PHONE_NUMBER_PATTERN: RegExp = /^\+[0-9][0-9 ().-]{4,}$/;

function startsWithAny(
  value: string,
  prefixes: ReadonlyArray<string>,
): boolean {
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function isNameOrChild(value: string, names: ReadonlyArray<string>): boolean {
  for (const name of names) {
    if (value === name || value.startsWith(`${name}.`)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a destination name (already normalized for its system) is
 * temporary, generated or a placeholder rather than a queue: the
 * placeholders above, a value a scrubber replaced whole, a bare UUID, a JMS
 * temporary destination, and per system — RabbitMQ's generated and
 * reply-to queues, JMS / ActiveMQ's `$TMP$` and advisory topics, NATS
 * inboxes and JetStream ack subjects, Pulsar's system topics, SNS phone
 * numbers and their placeholders. Case-insensitive; true for a blank or
 * non-string name too (never a queue).
 */
export function isTemporaryMessagingDestination(
  system: string,
  destination: string,
): boolean {
  if (typeof destination !== "string") {
    return true;
  }
  const value: string = destination.trim();
  if (!value) {
    return true;
  }
  const lower: string = value.toLowerCase();

  if (
    PLACEHOLDER_DESTINATIONS.has(lower) ||
    isScrubbedValue(lower) ||
    CANONICAL_UUID_PATTERN.test(value) ||
    startsWithAny(lower, JMS_TEMPORARY_PREFIXES)
  ) {
    return true;
  }

  switch (normalizeMessagingSystem(system)) {
    case "rabbitmq":
      return (
        startsWithAny(lower, RABBITMQ_GENERATED_PREFIXES) ||
        RABBITMQ_ANONYMOUS_QUEUE_PATTERN.test(value)
      );
    case "jms":
    case "activemq":
      return startsWithAny(lower, JMS_GENERATED_PREFIXES);
    case "nats":
      return isNameOrChild(lower, NATS_GENERATED_NAMES);
    case "pulsar":
      return (
        lower.includes(PULSAR_SYSTEM_TOPIC_MARKER) ||
        PULSAR_SYSTEM_TOPICS.includes(lower) ||
        startsWithAny(lower, PULSAR_SYSTEM_TOPIC_PREFIXES)
      );
    case "aws.sns":
      return (
        lower === SNS_PHONE_NUMBER_PLACEHOLDER ||
        lower.startsWith(SNS_PHONE_NUMBER_PLACEHOLDER_PREFIX) ||
        SNS_PHONE_NUMBER_PATTERN.test(value)
      );
    default:
      return false;
  }
}

// ---- per-system destination normalization ----------------------------------

interface NormalizedDestination {
  destination: string;
  consumerGroup: string | null;
  isDeadLetter: boolean;
}

// A value naming several destinations at once (a batch): never one queue.
function isListText(value: string): boolean {
  return value.startsWith("[") && value.endsWith("]");
}

function hasScheme(value: string): boolean {
  return value.indexOf("://") > 0;
}

/*
 * The last non-empty path segment of a URL (`https://sqs.us-east-1.
 * amazonaws.com/123456789012/orders` → "orders"), or null for a value that
 * is not a URL or has no path.
 */
function lastUrlPathSegment(value: string): string | null {
  const schemeEnd: number = value.indexOf("://");
  if (schemeEnd <= 0) {
    return null;
  }
  let rest: string = value.substring(schemeEnd + 3);
  for (const terminator of ["?", "#"]) {
    const index: number = rest.indexOf(terminator);
    if (index >= 0) {
      rest = rest.substring(0, index);
    }
  }
  const pathStart: number = rest.indexOf("/");
  if (pathStart < 0) {
    return null;
  }
  const segments: Array<string> = rest
    .substring(pathStart + 1)
    .split("/")
    .filter((segment: string): boolean => {
      return segment.trim().length > 0;
    });
  const last: string | undefined = segments[segments.length - 1];
  return last ? last.trim() : null;
}

const ARN_PREFIX: string = "arn:";

function isArn(value: string): boolean {
  return value.toLowerCase().startsWith(ARN_PREFIX);
}

/*
 * `arn:partition:service:region:account:resource` → the resource (for an
 * SQS queue or SNS topic, its name), or null for anything else — a
 * truncated ARN included. An SNS subscription ARN
 * (`…:topic:subscription-id`) names its topic.
 */
function arnResource(value: string): string | null {
  if (!isArn(value)) {
    return null;
  }
  const parts: Array<string> = value.split(":");
  const resource: string | undefined = parts[5];
  return resource && resource.trim() ? resource.trim() : null;
}

/*
 * SQS: a queue URL or ARN → the queue name; a plain name stays. An ARN cut
 * short of its resource names nothing (an SQS name cannot contain ":").
 */
function sqsQueueName(value: string): string {
  if (hasScheme(value)) {
    return lastUrlPathSegment(value) || "";
  }
  if (isArn(value)) {
    return arnResource(value) || "";
  }
  return value;
}

/*
 * SNS: a topic ARN → the topic name; a plain name stays. A topic name is
 * only ASCII letters, digits, "_" and "-" (plus FIFO's ".fifo", per SNS's
 * CreateTopic), so a truncated ARN names nothing, and a "/" means a
 * mobile-push platform endpoint or application (one per device), not a
 * topic — whether the ARN is whole (the Java agent, JS
 * messaging.destination.name) or cut after its last ":" (Go otelaws, JS
 * messaging.destination: `endpoint/GCM/<app>/<id>`).
 */
function snsTopicName(value: string): string {
  const name: string = isArn(value) ? arnResource(value) || "" : value;
  return name.includes("/") ? "" : name;
}

/*
 * Pub/Sub: a full resource name (`projects/<p>/topics/<t>`,
 * `projects/<p>/subscriptions/<s>`, optionally after
 * `//pubsub.googleapis.com/`) → the short id the client libraries report.
 */
const PUBSUB_RESOURCE_NAME_PATTERN: RegExp =
  /(?:^|\/)projects\/[^/]+\/(?:topics|subscriptions)\/([^/]+)$/;

function pubSubResourceId(value: string): string {
  const match: RegExpExecArray | null =
    PUBSUB_RESOURCE_NAME_PATTERN.exec(value);
  return match && match[1] ? match[1] : value;
}

/*
 * Service Bus / Event Hubs entity paths, split case-insensitively: the .NET
 * and JS SDKs say `{topic}/Subscriptions/{sub}` and `/$DeadLetterQueue`,
 * Java `/subscriptions/` and `/$deadletterqueue`, transfer dead-letter
 * queues add `/$Transfer/$DeadLetterQueue`, and an Event Hubs receiver's
 * path is `{hub}/ConsumerGroups/{group}/Partitions/{n}`. The entity (queue,
 * topic or event hub) is the destination; the subscription or consumer
 * group is display only, and so is the partition, which is dropped.
 */
const AZURE_DEAD_LETTER_MARKERS: ReadonlyArray<string> = [
  "/$transfer/$deadletterqueue",
  "/$deadletterqueue",
];
const AZURE_CONSUMER_MARKERS: ReadonlyArray<string> = [
  "/subscriptions/",
  "/consumergroups/",
];

function splitAzureEntityPath(value: string): NormalizedDestination {
  let entity: string = value;
  let isDeadLetter: boolean = false;
  let consumerGroup: string | null = null;

  for (const marker of AZURE_DEAD_LETTER_MARKERS) {
    const index: number = entity.toLowerCase().indexOf(marker);
    if (index >= 0) {
      entity = entity.substring(0, index);
      isDeadLetter = true;
      break;
    }
  }

  for (const marker of AZURE_CONSUMER_MARKERS) {
    const index: number = entity.toLowerCase().indexOf(marker);
    if (index >= 0) {
      const rest: string = entity.substring(index + marker.length);
      const end: number = rest.indexOf("/");
      const group: string = (end >= 0 ? rest.substring(0, end) : rest).trim();
      consumerGroup = group || null;
      entity = entity.substring(0, index);
      break;
    }
  }

  return { destination: entity, consumerGroup, isDeadLetter };
}

/*
 * Pulsar: a partition folds into its topic (`orders-partition-3` →
 * `orders`), and a name without a domain is expanded the way Pulsar itself
 * does — a short name into the default tenant and namespace
 * (`persistent://public/default/orders`), `tenant/namespace/topic` into the
 * persistent domain — so the Java agent's names as given join the brokers'
 * fully-qualified metric labels.
 */
const PULSAR_PARTITION_SUFFIX_PATTERN: RegExp = /-partition-\d+$/;

function pulsarTopic(value: string): string {
  const topic: string = value.replace(PULSAR_PARTITION_SUFFIX_PATTERN, "");
  if (topic.includes("://")) {
    return topic;
  }
  if (!topic.includes("/")) {
    return `persistent://public/default/${topic}`;
  }
  const parts: Array<string> = topic.split("/");
  if (
    parts.length === 3 &&
    parts.every((part: string): boolean => {
      return part.length > 0;
    })
  ) {
    return `persistent://${topic}`;
  }
  return topic;
}

// JMS / ActiveMQ: "queue://orders" and "topic://orders" name "orders".
const JMS_DESTINATION_PREFIXES: ReadonlyArray<string> = [
  "queue://",
  "topic://",
];

function stripJmsPrefix(value: string): string {
  const lower: string = value.toLowerCase();
  for (const prefix of JMS_DESTINATION_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return value.substring(prefix.length);
    }
  }
  return value;
}

// ActiveMQ's shared DLQ, and the individual ones' default `DLQ.` prefix.
function isActiveMqDeadLetterQueue(value: string): boolean {
  const lower: string = value.toLowerCase();
  return lower === "activemq.dlq" || lower.startsWith("dlq.");
}

// RocketMQ names a consumer group's dead-letter topic `%DLQ%<group>`.
const ROCKETMQ_DEAD_LETTER_PREFIX: string = "%dlq%";

/*
 * RabbitMQ's default exchange, as instrumentations spell it: "" (JS
 * amqplib; absent once stored), "amq.default" (semconv, the .NET client)
 * and "<default>" (the Java agent's legacy mode).
 */
const RABBITMQ_DEFAULT_EXCHANGES: ReadonlySet<string> = new Set<string>([
  "",
  "amq.default",
  "<default>",
]);

function isRabbitMqDefaultExchange(value: string): boolean {
  return RABBITMQ_DEFAULT_EXCHANGES.has(value.trim().toLowerCase());
}

/*
 * What parsing a RabbitMQ name needs to know about the span or datapoint it
 * came from (see rabbitMqQueue).
 */
interface RabbitMqNaming {
  // The routing-key attribute, or null when absent or blank.
  routingKey: string | null;
  // It consumes or settles, so it names a queue; else it publishes.
  consumerSide: boolean;
  /*
   * A span, whose instrumentation sets the routing-key attribute whenever
   * the key is non-empty. A datapoint never carries the key: it is no
   * metric attribute.
   */
  routingKeyReported: boolean;
  /*
   * Whether it is written to the conventions that join names (1.26+ keys,
   * and not RabbitMQ.Client for .NET) — read only when the name needs it.
   */
  hasJoinedNaming: () => boolean;
}

// The exchange / routing key / queue parts of a joined name, trimmed.
function splitJoinedRabbitMqName(value: string): Array<string> {
  return value.split(":").map((part: string): string => {
    return part.trim();
  });
}

/*
 * aio-pika's publish name `{exchange},{routing key}` (it sets no routing-key
 * attribute): the exchange, or the routing key when the exchange is the
 * default one. Anything else with a comma is a name as given.
 */
function rabbitMqCommaName(value: string, routingKey: string | null): string {
  const parts: Array<string> = value.split(",");
  if (parts.length !== 2) {
    return value;
  }
  const exchange: string = (parts[0] || "").trim();
  const key: string = (parts[1] || "").trim();
  if (routingKey !== null && key.length > 0 && key !== routingKey) {
    return value;
  }
  return isRabbitMqDefaultExchange(exchange)
    ? key || routingKey || ""
    : exchange;
}

/*
 * RabbitMQ destinations, where two naming conventions meet:
 *   - most instrumentations put ONE name in the key — the exchange (the
 *     Java agent's default mode, amqplib, pika, RabbitMQ.Client for .NET,
 *     MassTransit's own spans), "" / "<default>" / "amq.default" for the
 *     default exchange (whose routing key IS the queue name), or the
 *     routing key (pika, Spring Rabbit) — and that name may itself contain
 *     ":" (MassTransit names each message type's exchange
 *     `Namespace:Type` and publishes to it with an empty routing key);
 *   - semconv 1.30 joins the parts with ":", leaving empty ones out:
 *     `{exchange}:{routing key}` on a producer, and
 *     `{exchange}:{routing key}:{queue}` on a consumer, which also leaves
 *     the queue out when it equals the routing key. So on a consumer
 *     `direct_logs:warning` is the queue `warning`, and `logs:logs-audit`
 *     (a fanout exchange's empty routing key left out) the queue
 *     `logs-audit`. The Java agent's opt-in mode emits these.
 * A consumer resolves to its queue, which is what the broker's own metrics
 * are keyed by; a producer to its exchange (a publisher names no queue).
 *
 * The routing-key attribute tells the conventions apart: semconv requires
 * it whenever the key is non-empty, so a joined name always comes with it,
 * in the place the joined form puts it —
 *   - three parts → the queue, unless the routing key is not the middle;
 *   - two parts with the routing key → on a consumer the second part (the
 *     queue after the exchange, or after the routing key of a
 *     default-exchange delivery); on a producer the exchange when the
 *     routing key is the second part; otherwise the name is one name.
 * Without the attribute:
 *   - a producer SPAN's name is one exchange name, colon and all;
 *   - a consumer's is `{exchange}:{queue}` only when it is written to the
 *     joining conventions (see RabbitMqNaming), else one name;
 *   - a DATAPOINT never carries the key, so a producer's joined name splits
 *     to its exchange on the same condition.
 * A default-exchange marker as the first part (`:orders`,
 * `amq.default:orders`) can only be a split name: its second part is the
 * queue. The default exchange alone names the routing key, else nothing.
 */
function rabbitMqQueue(value: string, naming: RabbitMqNaming): string {
  const routingKey: string | null = naming.routingKey;
  if (isRabbitMqDefaultExchange(value)) {
    return routingKey || "";
  }
  if (!value.includes(":")) {
    return rabbitMqCommaName(value, routingKey);
  }

  let parts: Array<string> = splitJoinedRabbitMqName(value);
  if (parts.length === 3) {
    const exchange: string = parts[0] || "";
    const key: string = parts[1] || "";
    const queue: string = parts[2] || "";
    if (routingKey !== null && routingKey !== key) {
      return value;
    }
    if (queue) {
      return queue;
    }
    // `exchange:key:` — no queue part: read what is left as two parts.
    parts = [exchange, key];
  }
  if (parts.length !== 2) {
    return value;
  }

  const first: string = parts[0] || "";
  const second: string = parts[1] || "";
  if (!second) {
    // `exchange:` names the exchange alone (the default one: its key).
    return isRabbitMqDefaultExchange(first) ? routingKey || "" : first;
  }
  if (isRabbitMqDefaultExchange(first)) {
    return routingKey === null || routingKey === second ? second : value;
  }

  if (routingKey !== null) {
    if (naming.consumerSide) {
      return routingKey === second || routingKey === first ? second : value;
    }
    return routingKey === second ? first : value;
  }

  if (naming.consumerSide) {
    return naming.hasJoinedNaming() ? second : value;
  }
  if (naming.routingKeyReported) {
    return value;
  }
  return naming.hasJoinedNaming() ? first : value;
}

function normalizeDestinationForSystem(
  system: string,
  raw: string,
  // RabbitMQ only; null when the value is a name as given (see rabbitMqQueue).
  rabbitMqNaming: RabbitMqNaming | null,
): NormalizedDestination | null {
  let value: string = raw.trim();
  if (!value || isListText(value) || isScrubbedValue(value.toLowerCase())) {
    return null;
  }

  let consumerGroup: string | null = null;
  let isDeadLetter: boolean = false;

  switch (system) {
    case "rabbitmq":
      if (rabbitMqNaming) {
        value = rabbitMqQueue(value, rabbitMqNaming);
      }
      break;
    case "aws_sqs":
      value = sqsQueueName(value);
      break;
    case "aws.sns":
      value = snsTopicName(value);
      break;
    case "gcp_pubsub":
      value = pubSubResourceId(value);
      break;
    case "servicebus":
    case "eventhubs": {
      const path: NormalizedDestination = splitAzureEntityPath(value);
      value = path.destination;
      consumerGroup = path.consumerGroup;
      isDeadLetter = path.isDeadLetter;
      break;
    }
    case "pulsar":
      value = pulsarTopic(value);
      break;
    case "activemq":
    case "jms":
      value = stripJmsPrefix(value);
      isDeadLetter = isActiveMqDeadLetterQueue(value.trim());
      break;
    case "rocketmq":
      isDeadLetter = value
        .toLowerCase()
        .startsWith(ROCKETMQ_DEAD_LETTER_PREFIX);
      break;
    default:
      break;
  }

  value = value.trim();
  if (!value) {
    return null;
  }
  return { destination: value, consumerGroup, isDeadLetter };
}

// Each UUID → "{uuid}", so a per-request queue name keys one queue.
function templateDestination(destination: string): string {
  return destination.replace(UUID_SUBSTRING_PATTERN, "{uuid}");
}

/*
 * A display-only value (broker address, consumer group), trimmed and
 * clamped; null when blank, and when it holds a control character it
 * could not be stored or shown with.
 */
function clampDisplay(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed: string = value.trim();
  if (!trimmed || hasControlCharacter(trimmed)) {
    return null;
  }
  return trimmed.length > DISPLAY_VALUE_MAX_LENGTH
    ? trimmed.substring(0, DISPLAY_VALUE_MAX_LENGTH)
    : trimmed;
}

// ---- destination selection ---------------------------------------------------

interface SelectedDestination {
  value: string;
  // False for a bare routing key: it is already a queue name.
  parseRabbitMqAddressing: boolean;
}

/*
 * The FIRST present destination key wins — a placeholder there means no
 * queue, never "try the next key" — then, only when none is present, the
 * system's own keys: SQS queue URLs, the SNS topic ARN, and RabbitMQ's
 * routing key (no destination at all is the default exchange, whose routing
 * key is the queue name).
 */
function selectDestination(
  system: string,
  getAttribute: AttributeGetter,
): SelectedDestination | null {
  const generic: string | null = readFirstText(
    getAttribute,
    MESSAGING_DESTINATION_ATTRIBUTES,
  );
  if (generic !== null) {
    return { value: generic, parseRabbitMqAddressing: true };
  }

  if (system === "aws_sqs") {
    const queueUrl: string | null = readFirstText(
      getAttribute,
      SQS_QUEUE_URL_ATTRIBUTES,
    );
    if (queueUrl !== null) {
      return { value: queueUrl, parseRabbitMqAddressing: false };
    }
    for (const key of SQS_QUEUE_URL_FALLBACK_ATTRIBUTES) {
      const candidate: string | null = readText(getAttribute, key);
      if (
        candidate !== null &&
        hasScheme(candidate) &&
        lastUrlPathSegment(candidate) !== null
      ) {
        return { value: candidate, parseRabbitMqAddressing: false };
      }
    }
    return null;
  }

  if (system === "aws.sns") {
    const topicArn: string | null = readFirstText(
      getAttribute,
      SNS_TOPIC_ARN_ATTRIBUTES,
    );
    return topicArn !== null
      ? { value: topicArn, parseRabbitMqAddressing: false }
      : null;
  }

  if (system === "rabbitmq") {
    const routingKey: string | null = readFirstText(
      getAttribute,
      RABBITMQ_ROUTING_KEY_ATTRIBUTES,
    );
    return routingKey !== null
      ? { value: routingKey, parseRabbitMqAddressing: false }
      : null;
  }

  return null;
}

// ---- addresses -------------------------------------------------------------------

interface ParsedAddress {
  host: string;
  port: string | null;
}

// A port 1-65535, without leading zeros; null for anything else.
function validPort(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed: string = value.trim();
  if (!trimmed || trimmed.length > 5) {
    return null;
  }
  for (let index: number = 0; index < trimmed.length; index++) {
    const code: number = trimmed.charCodeAt(index);
    if (code < 0x30 || code > 0x39) {
      return null;
    }
  }
  const port: number = Number(trimmed);
  return port >= 1 && port <= 65535 ? String(port) : null;
}

function stripQuotes(value: string): string {
  let text: string = value.trim();
  const first: string = text.charAt(0);
  if ((first === '"' || first === "'") && text.endsWith(first)) {
    text = text.substring(1, text.length - 1);
  }
  return text.trim();
}

// `["b1:9092", "b2:9092"]` (JSON) or `['b1:9092']` (Python) — not `[::1]`.
function isAddressList(value: string): boolean {
  if (!value.startsWith("[")) {
    return false;
  }
  const next: string = value.substring(1).trim().charAt(0);
  return next === '"' || next === "'" || next === "]";
}

/*
 * host[:port] out of whatever an instrumentation put in an address key: a
 * JSON or Python list of bootstrap servers (the first), a comma-separated
 * list (the first), a URL (its authority, credentials stripped:
 * `amqp://user:***@rabbit:5672/vhost` → `rabbit:5672`), `host:port/path`,
 * a bracketed IPv6 literal.
 */
function parseAddress(raw: string): ParsedAddress | null {
  let value: string = raw.trim();

  if (isAddressList(value)) {
    const inner: string = value.substring(
      1,
      value.endsWith("]") ? value.length - 1 : value.length,
    );
    value = stripQuotes(inner.split(",")[0] || "");
  }

  const schemeEnd: number = value.indexOf("://");
  if (schemeEnd > 0) {
    value = value.substring(schemeEnd + 3);
    for (const terminator of ["/", "?", "#"]) {
      const index: number = value.indexOf(terminator);
      if (index >= 0) {
        value = value.substring(0, index);
      }
    }
  } else {
    if (value.includes(",")) {
      value = value.split(",")[0] || "";
    }
    const slash: number = value.indexOf("/");
    if (slash >= 0) {
      value = value.substring(0, slash);
    }
  }

  const at: number = value.lastIndexOf("@");
  if (at >= 0) {
    value = value.substring(at + 1);
  }
  value = value.trim();
  if (!value) {
    return null;
  }

  if (value.startsWith("[")) {
    const close: number = value.indexOf("]");
    if (close <= 1) {
      return null;
    }
    const rest: string = value.substring(close + 1);
    return {
      host: value.substring(0, close + 1),
      port: rest.startsWith(":") ? validPort(rest.substring(1)) : null,
    };
  }

  const firstColon: number = value.indexOf(":");
  if (firstColon >= 0 && firstColon === value.lastIndexOf(":")) {
    const host: string = value.substring(0, firstColon).trim();
    return host
      ? { host, port: validPort(value.substring(firstColon + 1)) }
      : null;
  }

  // No port, or a bare IPv6 literal (several colons).
  return { host: value, port: null };
}

function formatAddress(host: string, port: string | null): string {
  if (!port) {
    return host;
  }
  return host.includes(":") && !host.startsWith("[")
    ? `[${host}]:${port}`
    : `${host}:${port}`;
}

function resolveBrokerAddress(
  getAttribute: AttributeGetter,
  attributes: ReadonlyArray<MessagingAddressAttribute>,
): string | null {
  for (const attribute of attributes) {
    const raw: string | null = readText(getAttribute, attribute.address);
    if (raw === null) {
      continue;
    }
    const parsed: ParsedAddress | null = parseAddress(raw);
    if (!parsed) {
      continue;
    }
    const port: string | null =
      parsed.port ||
      (attribute.port
        ? validPort(readText(getAttribute, attribute.port))
        : null);
    return clampDisplay(formatAddress(parsed.host, port));
  }
  return null;
}

/*
 * The Azure namespace a namespace-scoped system's span was sent to: the
 * first address whose host is `<namespace>.servicebus.windows.net` (or a
 * sovereign cloud's). "" for every other system, and when no address names
 * a namespace (the local emulator, a custom domain).
 */
function resolveBrokerScope(
  system: string,
  getAttribute: AttributeGetter,
): string {
  if (getMessagingBrokerScope(system) !== "azure-namespace") {
    return "";
  }
  for (const key of MESSAGING_BROKER_SCOPE_ADDRESS_ATTRIBUTES) {
    const raw: string | null = readText(getAttribute, key);
    if (raw === null) {
      continue;
    }
    const parsed: ParsedAddress | null = parseAddress(raw);
    const namespace: string | null = parsed
      ? getAzureNamespaceFromHost(parsed.host)
      : null;
    if (namespace) {
      return namespace;
    }
  }
  return "";
}

// ---- direction -------------------------------------------------------------------

/*
 * `messaging.operation.type` (1.26+) and the legacy `messaging.operation`:
 * send / publish / create produce (publish became send in 1.28), receive /
 * process / deliver consume (deliver was 1.23-1.24's process), settle
 * acknowledges.
 */
const OPERATION_TYPE_DIRECTIONS: ReadonlyMap<string, MessagingDirection> =
  new Map<string, MessagingDirection>([
    ["send", "publish"],
    ["publish", "publish"],
    ["create", "publish"],
    ["receive", "consume"],
    ["process", "consume"],
    ["deliver", "consume"],
    ["settle", "settle"],
  ]);

// `messaging.operation.name`: system-specific, from the semconv refinements.
const OPERATION_NAME_DIRECTIONS: ReadonlyMap<string, MessagingDirection> =
  new Map<string, MessagingDirection>([
    ["send", "publish"],
    ["publish", "publish"],
    ["schedule", "publish"],
    ["publish_input", "publish"],
    ["publish_batch_input", "publish"],
    ["create", "publish"],
    ["event", "publish"],
    ["poll", "consume"],
    ["receive", "consume"],
    ["fetch", "consume"],
    ["fetch (empty)", "consume"],
    ["peek", "consume"],
    ["receive_deferred", "consume"],
    ["subscribe", "consume"],
    ["deliver", "consume"],
    ["consume", "consume"],
    ["process", "consume"],
    ["ack", "settle"],
    ["nack", "settle"],
    ["modack", "settle"],
    ["reject", "settle"],
    ["complete", "settle"],
    ["abandon", "settle"],
    ["defer", "settle"],
    ["dead_letter", "settle"],
    ["delete", "settle"],
    ["commit", "settle"],
    ["checkpoint", "settle"],
    ["term", "settle"],
    ["nak", "settle"],
    ["in-progress", "settle"],
  ]);

/*
 * AWS SDK operations (`rpc.method`; Go writes `SQS/SendMessage`): only for
 * SQS and SNS spans.
 */
const AWS_RPC_METHOD_DIRECTIONS: ReadonlyMap<string, MessagingDirection> =
  new Map<string, MessagingDirection>([
    ["sendmessage", "publish"],
    ["sendmessagebatch", "publish"],
    ["publish", "publish"],
    ["publishbatch", "publish"],
    ["receivemessage", "consume"],
    ["deletemessage", "settle"],
    ["deletemessagebatch", "settle"],
    ["changemessagevisibility", "settle"],
    ["changemessagevisibilitybatch", "settle"],
  ]);

function lookupDirection(
  map: ReadonlyMap<string, MessagingDirection>,
  value: string | null,
): MessagingDirection | null {
  if (value === null) {
    return null;
  }
  return map.get(value.toLowerCase()) || null;
}

/*
 * Direction, strongest evidence first: `messaging.operation.type`; the span
 * kind (PRODUCER publishes, CONSUMER consumes) — ahead of the legacy
 * `messaging.operation`, which Python confluent-kafka up to v0.62b1 wrote
 * as "receive" on its PRODUCER spans, and which producers must not set at
 * all up to spec 1.16; then the legacy key, which some clients fill with an
 * operation NAME rather than a type (the Google Cloud Pub/Sub clients write
 * "ack", "modack" and "nack" there: OpenTelemetryPubsubTracer); then
 * `messaging.operation.name`; and, for SQS / SNS, the AWS SDK operation.
 */
function resolveDirection(
  getAttribute: AttributeGetter,
  system: string,
  kind: SpanKindName | null,
): MessagingDirection {
  const operationType: MessagingDirection | null = lookupDirection(
    OPERATION_TYPE_DIRECTIONS,
    readText(getAttribute, OPERATION_TYPE_ATTRIBUTE),
  );
  if (operationType) {
    return operationType;
  }

  if (kind === "PRODUCER") {
    return "publish";
  }
  if (kind === "CONSUMER") {
    return "consume";
  }

  const legacyOperationText: string | null = readText(
    getAttribute,
    LEGACY_OPERATION_ATTRIBUTE,
  );
  const legacyOperation: MessagingDirection | null =
    lookupDirection(OPERATION_TYPE_DIRECTIONS, legacyOperationText) ||
    lookupDirection(OPERATION_NAME_DIRECTIONS, legacyOperationText);
  if (legacyOperation) {
    return legacyOperation;
  }

  const operationName: MessagingDirection | null = lookupDirection(
    OPERATION_NAME_DIRECTIONS,
    readText(getAttribute, OPERATION_NAME_ATTRIBUTE),
  );
  if (operationName) {
    return operationName;
  }

  if (system === "aws_sqs" || system === "aws.sns") {
    const method: string | null = readText(getAttribute, RPC_METHOD_ATTRIBUTE);
    const operation: string | null = method
      ? method.substring(method.lastIndexOf("/") + 1)
      : null;
    const awsDirection: MessagingDirection | null = lookupDirection(
      AWS_RPC_METHOD_DIRECTIONS,
      operation,
    );
    if (awsDirection) {
      return awsDirection;
    }
  }

  return "unknown";
}

// The words of a metric name that say which way its messages go.
const METRIC_NAME_PUBLISH_WORDS: ReadonlySet<string> = new Set<string>([
  "sent",
  "send",
  "publish",
  "published",
]);
const METRIC_NAME_CONSUME_WORDS: ReadonlySet<string> = new Set<string>([
  "consumed",
  "consume",
  "receive",
  "received",
  "receiver",
  "process",
  "processed",
]);
const METRIC_NAME_SETTLE_WORDS: ReadonlySet<string> = new Set<string>([
  "settle",
  "settlement",
]);
const METRIC_NAME_WORD_SEPARATOR: RegExp = /[._/]/;

/*
 * messaging.client.sent.messages → publish; messaging.process.duration and
 * messaging.servicebus.receiver.lag → consume;
 * messaging.servicebus.settlement.request.duration → settle.
 */
function directionFromMetricName(metricName: string): MessagingDirection {
  for (const word of metricName.split(METRIC_NAME_WORD_SEPARATOR)) {
    if (METRIC_NAME_PUBLISH_WORDS.has(word)) {
      return "publish";
    }
    if (METRIC_NAME_CONSUME_WORDS.has(word)) {
      return "consume";
    }
    if (METRIC_NAME_SETTLE_WORDS.has(word)) {
      return "settle";
    }
  }
  return "unknown";
}

function directionFromSignal(signal: MessageQueueSignal): MessagingDirection {
  if (signal === "published") {
    return "publish";
  }
  if (signal === "consumed") {
    return "consume";
  }
  return "unknown";
}

// ---- consumer group ----------------------------------------------------------------

/*
 * The consumer group or subscription: the attribute keys, then what the
 * Azure entity path named, then — for Pub/Sub — the destination itself, as
 * a consumer's destination IS its subscription.
 */
function resolveConsumerGroup(data: {
  getAttribute: AttributeGetter;
  system: string;
  direction: MessagingDirection;
  destination: string;
  fromPath: string | null;
}): string | null {
  const fromAttribute: string | null = readFirstText(
    data.getAttribute,
    MESSAGING_CONSUMER_GROUP_ATTRIBUTES,
  );
  if (fromAttribute !== null) {
    return clampDisplay(fromAttribute);
  }
  if (data.fromPath !== null) {
    return clampDisplay(data.fromPath);
  }
  if (
    data.system === "gcp_pubsub" &&
    (data.direction === "consume" || data.direction === "settle")
  ) {
    return clampDisplay(data.destination);
  }
  return null;
}

// ---- resolution ----------------------------------------------------------------------

/*
 * A normalized destination's last checks: not temporary, no control
 * character (see hasControlCharacter), UUIDs templated, not overlong. Null
 * when it is no queue.
 */
function finishDestination(
  system: string,
  normalized: NormalizedDestination | null,
): string | null {
  if (
    !normalized ||
    hasControlCharacter(normalized.destination) ||
    isTemporaryMessagingDestination(system, normalized.destination)
  ) {
    return null;
  }
  const destination: string = templateDestination(normalized.destination);
  return destination.length <= MESSAGE_QUEUE_DESTINATION_MAX_LENGTH
    ? destination
    : null;
}

/*
 * Whether a RabbitMQ span or datapoint is written to the conventions that
 * join exchange, routing key and queue with ":" (semconv 1.30): it carries
 * the 1.26+ `messaging.operation.type`, and it is not RabbitMQ.Client for
 * .NET's, which writes that key but names the exchange alone (see
 * MESSAGING_PROTOCOL_NAME_ATTRIBUTE). The older conventions — the Java
 * agent's default mode, amqplib, pika, MassTransit's own spans — name one
 * thing and carry no operation type.
 */
function hasJoinedRabbitMqNaming(getAttribute: AttributeGetter): boolean {
  if (readText(getAttribute, OPERATION_TYPE_ATTRIBUTE) === null) {
    return false;
  }
  const protocol: string | null = readText(
    getAttribute,
    MESSAGING_PROTOCOL_NAME_ATTRIBUTE,
  );
  return (
    protocol === null ||
    protocol.toLowerCase() !== RABBITMQ_DOTNET_CLIENT_PROTOCOL
  );
}

// How to read one span's or datapoint's attributes.
interface AttributeResolution {
  kind: SpanKindName | null;
  // A datapoint's direction as its metric name states it, else "unknown".
  directionHint: MessagingDirection;
  /*
   * A span, which carries RabbitMQ's routing key whenever there is one, or
   * a datapoint, which never does.
   */
  source: "span" | "datapoint";
  /*
   * The system a metric's name implies (MESSAGING_SDK_METRIC_SYSTEMS), used
   * only when the datapoint carries no `messaging.system` at all.
   */
  systemHint: string | null;
}

function resolveFromAttributes(
  getAttribute: AttributeGetter,
  resolution: AttributeResolution,
): ResolvedMessagingDestination | null {
  if (!hasTrigger(getAttribute)) {
    return null;
  }

  const system: string | null =
    resolveSystem(getAttribute) ||
    (resolution.systemHint !== null &&
    readText(getAttribute, MESSAGING_SYSTEM_ATTRIBUTE) === null
      ? resolution.systemHint
      : null);
  if (!system || hasTemporaryFlag(getAttribute)) {
    return null;
  }

  const selected: SelectedDestination | null = selectDestination(
    system,
    getAttribute,
  );
  if (!selected) {
    return null;
  }

  const direction: MessagingDirection =
    resolution.directionHint !== "unknown"
      ? resolution.directionHint
      : resolveDirection(getAttribute, system, resolution.kind);

  const normalized: NormalizedDestination | null =
    normalizeDestinationForSystem(
      system,
      selected.value,
      system === "rabbitmq" && selected.parseRabbitMqAddressing
        ? {
            routingKey: readFirstText(
              getAttribute,
              RABBITMQ_ROUTING_KEY_ATTRIBUTES,
            ),
            consumerSide: direction === "consume" || direction === "settle",
            routingKeyReported: resolution.source === "span",
            hasJoinedNaming: (): boolean => {
              return hasJoinedRabbitMqNaming(getAttribute);
            },
          }
        : null,
    );
  const destination: string | null = finishDestination(system, normalized);
  if (destination === null || !normalized) {
    return null;
  }

  return {
    system,
    destination,
    brokerScope: resolveBrokerScope(system, getAttribute),
    brokerAddress: resolveBrokerAddress(
      getAttribute,
      MESSAGING_ADDRESS_ATTRIBUTES,
    ),
    direction,
    consumerGroup: resolveConsumerGroup({
      getAttribute,
      system,
      direction,
      destination,
      fromPath: normalized.consumerGroup,
    }),
    isDeadLetter: normalized.isDeadLetter,
  };
}

/**
 * The destination a messaging span publishes to, consumes from or settles
 * on, or null. SERVER spans never resolve (a messaging operation is never
 * served), and neither does a span with no messaging trigger — checked
 * first, without allocating, so this is cheap on every span. `kind` is the
 * span's kind as stored: the SpanKind string ("SPAN_KIND_PRODUCER"), or
 * whatever a Span Kind Remapper wrote — a bare name, or OTLP's number as a
 * number or as its digits, read alike (see normalizeSpanKind). SERVER is
 * refused in every spelling; any other kind only decides the direction.
 */
export function resolveMessagingSpan(input: {
  getAttribute: AttributeGetter;
  kind?: string | number | null | undefined;
}): ResolvedMessagingDestination | null {
  if (!input || typeof input.getAttribute !== "function") {
    return null;
  }
  const kind: SpanKindName | null = normalizeSpanKind(input.kind);
  if (kind === "SERVER") {
    return null;
  }
  return resolveFromAttributes(input.getAttribute, {
    kind,
    directionHint: "unknown",
    source: "span",
    systemHint: null,
  });
}

// Whether every required attribute is present with an accepted value.
function matchesRequiredAttributes(
  descriptor: MessageQueueMetricDescriptor,
  getAttribute: AttributeGetter,
): boolean {
  const required: Readonly<Record<string, ReadonlyArray<string>>> | undefined =
    descriptor.requiredAttributes;
  if (!required) {
    return true;
  }
  for (const key of Object.keys(required)) {
    const accepted: ReadonlyArray<string> | undefined = required[key];
    const value: string | null = readText(getAttribute, key);
    if (!accepted || value === null) {
      return false;
    }
    const lower: string = value.toLowerCase();
    if (
      !accepted.some((candidate: string): boolean => {
        return candidate.toLowerCase() === lower;
      })
    ) {
      return false;
    }
  }
  return true;
}

function resolveCatalogDatapoint(
  descriptor: MessageQueueMetricDescriptor,
  getAttribute: AttributeGetter,
): ResolvedMessagingDestination | null {
  if (!matchesRequiredAttributes(descriptor, getAttribute)) {
    return null;
  }

  // A finer-grained repeat of the metric counts toward no queue.
  if (
    descriptor.excludeSeriesWithAttributes &&
    readFirstText(getAttribute, descriptor.excludeSeriesWithAttributes) !== null
  ) {
    return null;
  }

  const raw: string | null = readFirstText(
    getAttribute,
    descriptor.destinationAttributes,
  );
  if (raw === null) {
    return null;
  }

  // A broker names its queues exactly: no RabbitMQ exchange:key parsing.
  const normalized: NormalizedDestination | null =
    normalizeDestinationForSystem(descriptor.system, raw, null);
  const destination: string | null = finishDestination(
    descriptor.system,
    normalized,
  );
  if (destination === null || !normalized) {
    return null;
  }

  const brokerScope: string =
    (descriptor.scopeAttributes
      ? canonicalizeMessageQueueBrokerScope(
          descriptor.system,
          readFirstText(getAttribute, descriptor.scopeAttributes),
        )
      : "") || "";

  return {
    system: descriptor.system,
    destination,
    brokerScope,
    brokerAddress: resolveBrokerAddress(
      getAttribute,
      MESSAGE_QUEUE_METRIC_ADDRESS_ATTRIBUTES,
    ),
    direction: directionFromSignal(descriptor.signal),
    consumerGroup: clampDisplay(normalized.consumerGroup),
    isDeadLetter: normalized.isDeadLetter,
  };
}

/**
 * The destination a metric datapoint describes, or null. `getAttribute`
 * reads the STORED flattened map: datapoint keys bare, resource keys
 * `resource.`-prefixed.
 *
 * - A curated broker metric (MESSAGE_QUEUE_METRICS; the name is trimmed and
 *   lowercased first) tries each of its entries: required attributes match,
 *   then the destination (normalized, filtered and templated like a span's)
 *   and the Azure namespace from the entry's keys. The direction follows
 *   the entry's signal. A curated name that none of its entries resolves is
 *   null — it never falls through to the attribute path below.
 *   A datapoint carrying one of the entry's excludeSeriesWithAttributes is
 *   a repeat of a coarser series (Pulsar's per-consumer copy) and is null.
 * - Anything else resolves like a span without a kind — the messaging
 *   CLIENT metrics, and any application gauge that carries
 *   `messaging.system` and a destination (OneUptime's own BullMQ
 *   `queue.size`) — with the direction the metric name states ("sent",
 *   "consumed", "process", "settlement", …), else the one its attributes
 *   state. A messaging SDK metric that names no system (the Azure SDK for
 *   Java's `messaging.servicebus.*`) gets the one its name implies
 *   (MESSAGING_SDK_METRIC_SYSTEMS). A datapoint never carries RabbitMQ's
 *   routing key, which decides how its joined names split (rabbitMqQueue).
 */
export function resolveMessagingMetricDatapoint(input: {
  metricName: string;
  getAttribute: AttributeGetter;
}): ResolvedMessagingDestination | null {
  if (!input || typeof input.getAttribute !== "function") {
    return null;
  }
  const metricName: string =
    typeof input.metricName === "string"
      ? input.metricName.trim().toLowerCase()
      : "";

  const descriptors: ReadonlyArray<MessageQueueMetricDescriptor> = metricName
    ? getMessageQueueMetricDescriptorsByName(metricName)
    : [];
  if (descriptors.length > 0) {
    for (const descriptor of descriptors) {
      const resolved: ResolvedMessagingDestination | null =
        resolveCatalogDatapoint(descriptor, input.getAttribute);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }

  return resolveFromAttributes(input.getAttribute, {
    kind: null,
    directionHint: directionFromMetricName(metricName),
    source: "datapoint",
    systemHint: MESSAGING_SDK_METRIC_SYSTEMS.get(metricName) || null,
  });
}
