import {
  MESSAGE_QUEUE_METRIC_ADDRESS_ATTRIBUTES,
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_SYSTEM_ATTRIBUTE,
  MessagingAddressAttribute,
  ResolvedMessagingDestination,
  hasMessagingTrigger,
  resolveMessagingMetricDatapoint,
  resolveMessagingSpan,
} from "Common/Types/MessageQueue/MessagingTelemetryResolver";
import {
  MESSAGE_QUEUE_BROKER_METRIC_NAMES,
  MESSAGE_QUEUE_METRICS,
  MESSAGING_CLIENT_METRIC_NAMES,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "Common/Types/MessageQueue/MessageQueueIdentity";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { keyForMessageQueue } from "Common/Utils/Telemetry/EntityKey";
import logger from "Common/Server/Utils/Logger";

/*
 * The per-ROW half of the Queues product's telemetry selection: every row
 * that talks about a message queue gets `keyForMessageQueue(projectId,
 * identity)` appended to its own `entityKeys`, so a queue's page finds its
 * spans and datapoints with the same `hasAny(entityKeys, keys)` predicate
 * every other product uses:
 *
 *   - every messaging span that is not a SERVER span (traces): PRODUCER,
 *     CONSUMER, CLIENT (SQS / SNS calls, receive polls) and INTERNAL, with
 *     any messaging trigger attribute (MESSAGING_TRIGGER_ATTRIBUTES);
 *   - every datapoint of a curated broker metric (MessageQueueMetricCatalog:
 *     kafka_metrics, rabbitmq, azure_monitor, CloudWatch, Pub/Sub, Pulsar,
 *     RocketMQ, the JMX Scraper) or of a messaging CLIENT metric, and every
 *     datapoint that carries `messaging.system` (an application's own
 *     gauge, such as OneUptime's BullMQ `queue.size`) (metrics).
 *
 * The destination comes from the ONE pure resolver the discovery cron also
 * runs (MessagingTelemetryResolver), so the key stamped here and the queue
 * row the cron creates always name the same identity. This module adds no
 * messaging rule of its own: it only decides cheaply which rows are worth
 * resolving, memoizes, and appends.
 *
 * The rules of DatabaseCallEntityKeys keep this safe on the ingest hot path,
 * plus a fourth:
 *
 *   1. It reads the FINAL row — after drop filter, scrub rules and pipeline
 *      — so a scrubbed destination never becomes an identity, and the key
 *      agrees with what the discovery cron later reads back out of
 *      ClickHouse for the same row.
 *   2. It never mutates a shared array. A row's `entityKeys` starts out as
 *      the SAME array object as its resource's TelemetryServiceMetadata
 *      (and so as every sibling row and every exception row of that
 *      resource). Pushing onto it would stamp one span's queue onto all of
 *      them; the key is always added by assigning a NEW array.
 *   3. It costs next to nothing for rows that are not about a queue: a span
 *      is turned away by its kind and a handful of own-property checks, a
 *      datapoint by two Set lookups on its name and one property read —
 *      no allocation — before any other work. The Azure SDKs put
 *      `az.namespace` on EVERY span of every client (Microsoft.Storage,
 *      Microsoft.KeyVault, Microsoft.DocumentDB, …); the core's trigger check
 *      weighs that key's value, so only a Service Bus or Event Hubs span
 *      gets past it (see MessagingEntityKeysBenchmark). The gate stays the
 *      core's, never a filter of this module's own: the discovery cron runs
 *      the same check, and two copies could disagree about which spans name
 *      a queue.
 *   4. It never throws. A resolver bug costs the row its queue key, never
 *      the row: the failure is logged once per request and ingest goes on.
 */

type RowAttributes = Record<string, unknown>;

// Bound on one request's memo; past it, rows are resolved without memoizing.
export const MESSAGING_ENTITY_KEY_MAX_MEMO_ENTRIES: number = 10_000;

/*
 * Bound on the length of one memo key as the memo holds it: after JSON
 * escaping, which writes a control character as six characters and a quote
 * or backslash as two. A real key holds a handful of present attributes, a
 * few hundred characters. Anything past this holds an outsized value, which
 * the resolver refuses as a destination anyway (over 255 characters, or a
 * control character) or clamps for display. Such a row is resolved without
 * memoizing, so one request's memo never holds more than MAX_MEMO_ENTRIES
 * keys of at most this many characters, however the values are spelled.
 */
export const MESSAGING_ENTITY_KEY_MAX_MEMO_KEY_LENGTH: number = 2_048;

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

/*
 * What resolveMessagingMetricDatapoint reads for a CURATED broker metric,
 * per stored metric name: each of its entries' required, finer-series,
 * destination and scope keys, plus the reporting broker's address. A
 * curated name never falls through to the attribute path (the resolver
 * returns null instead), so nothing else can change its answer — and the
 * memo stays a few tokens long for the highest-volume messaging rows (a
 * kafka_metrics scrape is one datapoint per group × topic × partition).
 * The Azure Monitor names are shared by Service Bus and Event Hubs: their
 * entries' keys are merged.
 */
const CURATED_METRIC_MEMO_ATTRIBUTES: ReadonlyMap<
  string,
  ReadonlyArray<string>
> = ((): Map<string, Array<string>> => {
  const metricAddressKeys: Array<string> = addressKeys(
    MESSAGE_QUEUE_METRIC_ADDRESS_ATTRIBUTES,
  );
  const map: Map<string, Array<string>> = new Map<string, Array<string>>();
  for (const descriptor of MESSAGE_QUEUE_METRICS) {
    const keys: Array<string> = map.get(descriptor.metricName) || [];
    const lists: Array<ReadonlyArray<string>> = [
      Object.keys(descriptor.requiredAttributes || {}),
      descriptor.excludeSeriesWithAttributes || [],
      descriptor.destinationAttributes,
      descriptor.scopeAttributes || [],
      metricAddressKeys,
    ];
    for (const list of lists) {
      for (const key of list) {
        if (!keys.includes(key)) {
          keys.push(key);
        }
      }
    }
    map.set(descriptor.metricName, keys);
  }
  return map;
})();

/**
 * The attribute keys whose values decide a messaging datapoint's queue
 * key, for a stored (trimmed, lowercased) metric name — what the per-request
 * memo is keyed on besides the name itself: a curated broker metric's own
 * keys (see CURATED_METRIC_MEMO_ATTRIBUTES), else every key the span
 * resolver reads, because any other datapoint resolves like a span.
 */
export function getMessagingMetricMemoAttributes(
  metricName: string,
): ReadonlyArray<string> {
  return (
    CURATED_METRIC_MEMO_ATTRIBUTES.get(metricName) ||
    MESSAGING_RESOLVER_INPUT_ATTRIBUTES
  );
}

/*
 * Whether a name is already in the form ingest stores and the catalog
 * lists — printable ASCII without upper-case letters or spaces, so trim()
 * and toLowerCase() would leave it as it is. Conservative: anything else
 * (a pipeline rule's verbatim `Kafka.Consumer_Group.Lag_Sum`, a stray
 * space, a non-ASCII letter that lower-cases to ASCII) takes the slow path.
 */
function isCanonicalMetricName(name: string): boolean {
  for (let index: number = 0; index < name.length; index++) {
    const code: number = name.charCodeAt(index);
    if (code <= 0x20 || code >= 0x7f || (code >= 0x41 && code <= 0x5a)) {
      return false;
    }
  }
  return true;
}

/*
 * A metric name as the resolver compares it: trimmed and lowercased, and
 * without allocating when it already is.
 */
function canonicalMetricName(name: unknown): string {
  if (typeof name !== "string") {
    return "";
  }
  return isCanonicalMetricName(name) ? name : name.trim().toLowerCase();
}

function isCatalogMessagingMetricName(name: string): boolean {
  return (
    MESSAGE_QUEUE_BROKER_METRIC_NAMES.has(name) ||
    MESSAGING_CLIENT_METRIC_NAMES.has(name)
  );
}

/*
 * One per ingest request. Memoizes "these messaging attributes → this queue
 * key (or none)" for the request's lifetime: a payload of a few thousand
 * messaging spans or broker datapoints usually names a handful of queues,
 * so the resolver and the SHA-256 behind the key run a handful of times,
 * not once per row.
 */
export default class MessagingEntityKeyResolver {
  private readonly projectId: string;
  private readonly memo: Map<string, string | null> = new Map<
    string,
    string | null
  >();
  private hasReportedFailure: boolean = false;

  public constructor(projectId: ObjectID | string) {
    this.projectId = projectId.toString();
  }

  /*
   * Whether a span row may be about a queue: not a SERVER span (a messaging
   * operation is never served — the resolver refuses those too), and some
   * messaging trigger attribute is present. Zero allocation — safe to call
   * on every span.
   */
  public static isMessagingSpan(attributes: unknown, kind: unknown): boolean {
    if (kind === SpanKind.Server || !attributes) {
      return false;
    }
    return hasMessagingTrigger(attributes as RowAttributes);
  }

  /*
   * Whether a metric name (as stored, or as a pipeline rule wrote it) is a
   * curated broker metric or a messaging client metric once trimmed and
   * lowercased. The Azure SDK for Java's `messaging.servicebus.*` metrics
   * carry NO `messaging.system` — only their name says they are messaging
   * (MESSAGING_SDK_METRIC_SYSTEMS) — so the name sets, not the attribute
   * alone, decide. No allocation for a name already in stored form.
   */
  public static isMessagingMetricName(name: unknown): boolean {
    if (typeof name !== "string" || name.length === 0) {
      return false;
    }
    if (isCatalogMessagingMetricName(name)) {
      return true;
    }
    if (isCanonicalMetricName(name)) {
      return false;
    }
    return isCatalogMessagingMetricName(name.trim().toLowerCase());
  }

  /*
   * Whether a datapoint's flattened attributes carry `messaging.system` —
   * bare, so a datapoint key: a RESOURCE-level `messaging.system` is stored
   * as `resource.messaging.system`, which the resolver never reads. One
   * property read.
   */
  public static carriesMessagingSystem(attributes: unknown): boolean {
    if (!attributes || typeof attributes !== "object") {
      return false;
    }
    const value: unknown = (attributes as RowAttributes)[
      MESSAGING_SYSTEM_ATTRIBUTE
    ];
    return value !== undefined && value !== null && value !== "";
  }

  // Whether a metric row may be about a queue (see the two checks above).
  public static isMessagingMetric(name: unknown, attributes: unknown): boolean {
    return (
      MessagingEntityKeyResolver.isMessagingMetricName(name) ||
      MessagingEntityKeyResolver.carriesMessagingSystem(attributes)
    );
  }

  /*
   * The queue key for one span row's attributes and stored kind, or null
   * when the span names no queue (a SERVER span, no messaging attribute, a
   * temporary or generated destination, a scrubbed one, …). Never throws.
   */
  public getSpanEntityKey(attributes: unknown, kind: unknown): string | null {
    try {
      if (!MessagingEntityKeyResolver.isMessagingSpan(attributes, kind)) {
        return null;
      }
      const record: RowAttributes = attributes as RowAttributes;
      const memoKey: string | null = buildMemoKey(
        "span",
        kind,
        MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
        record,
      );
      return this.memoized(memoKey, (): ResolvedMessagingDestination | null => {
        return resolveMessagingSpan({
          getAttribute: (key: string): unknown => {
            return record[key];
          },
          /*
           * The stored SpanKind string ("SPAN_KIND_PRODUCER"); the resolver
           * reads it for the direction, which also decides how a RabbitMQ
           * consumer's joined name splits — hence part of the memo key.
           */
          kind: kind as string | null | undefined,
        });
      });
    } catch (error) {
      this.reportFailure(error);
      return null;
    }
  }

  /*
   * The queue key for one datapoint row's (final) metric name and flattened
   * stored attributes — datapoint keys bare, resource keys `resource.`-
   * prefixed, exactly what resolveMessagingMetricDatapoint reads — or null.
   * Never throws.
   */
  public getMetricEntityKey(
    metricName: unknown,
    attributes: unknown,
  ): string | null {
    try {
      if (
        !attributes ||
        typeof attributes !== "object" ||
        !MessagingEntityKeyResolver.isMessagingMetric(metricName, attributes)
      ) {
        return null;
      }
      const record: RowAttributes = attributes as RowAttributes;
      const name: string = canonicalMetricName(metricName);
      const memoKey: string | null = buildMemoKey(
        "metric",
        name,
        getMessagingMetricMemoAttributes(name),
        record,
      );
      return this.memoized(memoKey, (): ResolvedMessagingDestination | null => {
        return resolveMessagingMetricDatapoint({
          metricName: name,
          getAttribute: (key: string): unknown => {
            return record[key];
          },
        });
      });
    } catch (error) {
      this.reportFailure(error);
      return null;
    }
  }

  /*
   * A span row: append its queue's key. Returns whether a key was added.
   * SERVER spans and spans without a messaging trigger return before
   * anything is read beyond `kind` and the trigger attributes.
   */
  public appendToSpanRow(row: JSONObject): boolean {
    try {
      if (!row || typeof row !== "object") {
        return false;
      }
      return this.appendToRow(
        row,
        this.getSpanEntityKey(row["attributes"], row["kind"]),
      );
    } catch (error) {
      this.reportFailure(error);
      return false;
    }
  }

  /*
   * A metric row: append its queue's key when its (final) name is a
   * curated broker or messaging client metric, or its attributes carry
   * `messaging.system`. Returns whether a key was added.
   */
  public appendToMetricRow(row: JSONObject): boolean {
    try {
      if (!row || typeof row !== "object") {
        return false;
      }
      return this.appendToRow(
        row,
        this.getMetricEntityKey(row["name"], row["attributes"]),
      );
    } catch (error) {
      this.reportFailure(error);
      return false;
    }
  }

  private appendToRow(row: JSONObject, entityKey: string | null): boolean {
    if (!entityKey) {
      return false;
    }

    const existing: Array<string> = Array.isArray(row["entityKeys"])
      ? (row["entityKeys"] as Array<string>)
      : [];

    if (existing.includes(entityKey)) {
      return false;
    }

    // A NEW array — `existing` is shared with sibling rows (see rule 2).
    row["entityKeys"] = [...existing, entityKey];
    return true;
  }

  /*
   * The memoized key for one memo key, resolving on a miss. A null memo key
   * (outsized input) is resolved without memoizing. A resolver failure
   * memoizes "no key" for its input, so one bad input costs one failure,
   * not one per row.
   */
  private memoized(
    memoKey: string | null,
    resolve: () => ResolvedMessagingDestination | null,
  ): string | null {
    if (memoKey !== null) {
      const cached: string | null | undefined = this.memo.get(memoKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    let entityKey: string | null = null;
    try {
      entityKey = this.toEntityKey(resolve());
    } catch (error) {
      this.reportFailure(error);
      entityKey = null;
    }

    if (
      memoKey !== null &&
      this.memo.size < MESSAGING_ENTITY_KEY_MAX_MEMO_ENTRIES
    ) {
      this.memo.set(memoKey, entityKey);
    }

    return entityKey;
  }

  /*
   * A resolved destination's queue key: its canonical identity (the system
   * folded to its identity family, so an ActiveMQ queue is a JMS one), and
   * only when that identity can be a queue row at all — the identifier the
   * discovery cron creates rows under must be buildable. Lowercasing can
   * lengthen a destination (U+0130 "İ" becomes two code units), so a
   * 255-character name may still overflow it; a key no row can ever carry
   * is not stamped.
   */
  private toEntityKey(
    resolved: ResolvedMessagingDestination | null,
  ): string | null {
    if (!resolved) {
      return null;
    }
    const identity: MessageQueueIdentity | null = toMessageQueueIdentity({
      system: resolved.system,
      brokerScope: resolved.brokerScope,
      destination: resolved.destination,
    });
    if (!identity || buildMessageQueueIdentifier(identity) === null) {
      return null;
    }
    return keyForMessageQueue(this.projectId, identity);
  }

  /*
   * Once per request: a resolver bug would otherwise log once per row of a
   * large payload.
   */
  private reportFailure(error: unknown): void {
    if (this.hasReportedFailure) {
      return;
    }
    this.hasReportedFailure = true;
    try {
      logger.warn(
        `Message queue keys could not be added to some telemetry rows of project ${this.projectId}; those rows are stored without them: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } catch {
      // Logging must not be the thing that breaks ingest either.
    }
  }
}

/*
 * The memo key for one row: a tag (span or metric), the span kind or the
 * canonical metric name, then — for each input attribute that is present —
 * its position in `keys` and a type-tagged token of its value. Absent keys
 * (undefined or null, which the resolver reads alike) contribute nothing:
 * most of a row's inputs are absent, and skipping them is most of what
 * keeps a memo hit cheap. Null when the serialized key would be longer than
 * MESSAGING_ENTITY_KEY_MAX_MEMO_KEY_LENGTH: such a row is not worth
 * memoizing.
 */
function buildMemoKey(
  tag: string,
  head: unknown,
  keys: ReadonlyArray<string>,
  attributes: RowAttributes,
): string | null {
  const headToken: string | null = memoToken(head);
  if (headToken === null) {
    return null;
  }
  const parts: Array<string | number> = [tag, headToken];
  /*
   * A lower bound on the serialized length: the brackets, quotes and
   * commas, every token's own characters and one digit of each position,
   * but no escapes. Escaping only adds characters, so leaving early on it
   * never turns away a key that would fit. The exact check is on the
   * serialized key, below.
   */
  let length: number = tag.length + headToken.length + 7;
  for (let index: number = 0; index < keys.length; index++) {
    const key: string | undefined = keys[index];
    if (key === undefined) {
      continue;
    }
    const value: unknown = attributes[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (
      typeof value === "string" &&
      value.length > MESSAGING_ENTITY_KEY_MAX_MEMO_KEY_LENGTH
    ) {
      return null;
    }
    const token: string | null = memoToken(value);
    if (token === null) {
      return null;
    }
    // The token, its quotes, two commas and at least one position digit.
    length += token.length + 5;
    if (length > MESSAGING_ENTITY_KEY_MAX_MEMO_KEY_LENGTH) {
      return null;
    }
    parts.push(index, token);
  }
  /*
   * The bound applies to the key as the memo holds it. Escaping can make a
   * key that fits as raw characters several times longer: a destination of
   * 2,000 control characters serializes to about 12,000.
   */
  const serialized: string = JSON.stringify(parts);
  return serialized.length > MESSAGING_ENTITY_KEY_MAX_MEMO_KEY_LENGTH
    ? null
    : serialized;
}

/*
 * A type-tagged token per attribute value, exact for everything the
 * resolver can tell apart, so two rows share a memo slot only when the
 * resolver would read the same thing from both: `5432` and `"5432"`, an
 * absent value and an empty string never share one by accident, and an
 * ARRAY is keyed by its content, because the resolver reads it as its JSON
 * text (a list of bootstrap servers in an address key can name an Azure
 * namespace). A plain object is never read (the resolver treats it as
 * absent), so one token covers them all. Null when the value cannot be
 * tokenized (an array JSON.stringify refuses): not memoizable.
 */
function memoToken(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "u";
  }
  if (typeof value === "string") {
    return `s${value}`;
  }
  if (typeof value === "number") {
    return `n${String(value)}`;
  }
  if (typeof value === "boolean") {
    return `b${String(value)}`;
  }
  if (typeof value === "bigint") {
    return `i${String(value)}`;
  }
  if (Array.isArray(value)) {
    try {
      const text: string | undefined = JSON.stringify(value);
      return typeof text === "string" ? `a${text}` : null;
    } catch {
      return null;
    }
  }
  return "o";
}
