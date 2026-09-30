import { SpanKind, SpanStatus } from "../../../Models/AnalyticsModels/Span";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import {
  MESSAGE_QUEUE_BROKER_METRIC_NAMES,
  MESSAGE_QUEUE_METRICS,
  MESSAGING_CLIENT_METRIC_NAMES,
  MessageQueueMetricDescriptor,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
  getMessagingBrokerMetricsSource,
  getMoreSpecificMessagingSystem,
} from "../../../Types/MessageQueue/MessagingSystem";
import {
  AZURE_RESOURCE_PROVIDER_ATTRIBUTES,
  AttributeGetter,
  MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_TRIGGER_ATTRIBUTES,
  MessagingDirection,
  ResolvedMessagingDestination,
  hasMessagingTrigger,
  resolveMessagingMetricDatapoint,
  resolveMessagingSpan,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import { QUERY_SETTINGS, escapeSql } from "./ServiceDependencyDiscovery";

/*
 * Message queue discovery — the pure half of the queue step of
 * "TelemetryEntity:ComputeServiceDependencies".
 *
 * Ingest already stamps every messaging span and every messaging datapoint
 * with the entity key of the queue it names (MessagingEntityKeyResolver, per
 * row, through the core's resolveMessagingSpan /
 * resolveMessagingMetricDatapoint). This step turns the same evidence into
 * MessageQueue rows: one grouped query over the window's spans and one over
 * its metric datapoints, then the SAME resolvers ingest ran, fed each row's
 * grouped attributes — so the identity a row is found or created under is
 * byte-for-byte the identity whose key the telemetry carries.
 *
 * What makes that hold is what the queries select and group by: exactly the
 * attribute keys the resolvers read (MESSAGING_RESOLVER_INPUT_ATTRIBUTES for
 * spans, MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES for datapoints — the
 * core's own lists, never a copy), plus the span kind (it decides the
 * direction, and with it how a RabbitMQ consumer's joined name splits) or the
 * metric name (it decides which catalog entry reads the datapoint). Every
 * span of one group therefore resolves exactly as each of them did at
 * ingest. None of those keys varies per message or per instance (the core
 * keeps offsets, partitions, message, client and consumer ids out of its
 * lists), so a topic a thousand pods consume is a handful of rows, not a
 * thousand.
 *
 * Everything here is synchronous and side-effect free apart from reading one
 * environment variable, so it can be tested without ClickHouse or Postgres.
 */

// Unique marker comments, so the queries can be told apart in logs and tests.
export const MESSAGE_QUEUE_SPAN_SQL_MARKER: string =
  "message-queue-span-discovery";
export const MESSAGE_QUEUE_METRIC_SQL_MARKER: string =
  "message-queue-metric-discovery";
export const MESSAGE_QUEUE_METRIC_PROJECTS_SQL_MARKER: string =
  "message-queue-metric-projects";

export const MESSAGE_QUEUE_MIN_SPANS_ENV: string = "MESSAGE_QUEUE_MIN_SPANS";
export const DEFAULT_MESSAGE_QUEUE_MIN_SPANS: number = 3;

/*
 * How much further back than the span window the metric query reads
 * cloud-monitoring datapoints. Cloud monitoring APIs publish their numbers
 * minutes after the fact, and a datapoint is stored under the time it
 * measured, not the time it arrived: the aws_cloudwatch receiver's newest
 * point is typically 11 to 25 minutes old when it is ingested (its `delay`
 * defaults to 10 minutes, on top of a 5-minute period), googlecloudmonitoring's
 * up to 9. Read with the span window alone, most CloudWatch datapoints would
 * already lie behind the window of the first run after they arrived, and an
 * SQS queue its broker reports would never be sighted. 45 more minutes (an
 * hour in all for the 15-minute window) covers datapoints up to 50 minutes
 * late. Only those metrics read further back: a Kafka, RabbitMQ, Pulsar or
 * RocketMQ scrape, a JMX Scraper push and a messaging client metric are
 * stored as they happen.
 */
export const MESSAGE_QUEUE_LATE_METRIC_MINUTES: number = 45;

const SPAN_TABLE: string = `oneuptime.${AnalyticsTableName.Span}`;
const METRIC_TABLE: string = `oneuptime.${AnalyticsTableName.Metric}`;

/*
 * The one stored span kind the span query leaves out. A messaging operation
 * is never SERVED, so ingest keys every messaging span EXCEPT one stored as
 * SERVER (MessagingEntityKeyResolver.isMessagingSpan turns away
 * `kind === SpanKind.Server` and nothing else) — and the stored kind is not
 * always one of the five the ingest service maps OTLP's to: a trace
 * pipeline's Span Kind Remapper runs before the stamper and stores whatever
 * its mapping says (SPAN_KIND_UNSPECIFIED, which the dashboard offers; any
 * string the API accepts; nothing at all). An allow-list of kinds would
 * leave such a queue's spans unread though they carry its key: never
 * created from them, never sighted, archived while they keep arriving.
 * So the query leaves out this kind alone, and
 * resolveMessagingSpanDiscoveryRows runs the core's resolver again, which
 * refuses any other spelling of SERVER and reads a kind it does not know
 * as no kind — exactly as ingest did.
 */
export const MESSAGE_QUEUE_DISCOVERY_EXCLUDED_SPAN_KIND: SpanKind =
  SpanKind.Server;

function uniqueSorted(values: Iterable<string>): Array<string> {
  return Array.from(new Set<string>(values)).sort();
}

/*
 * The metric names the metric query reads: every curated broker metric and
 * every messaging client metric, in the lowercase form ingest stores names
 * in — an IN list over the second sort-key column, so the query touches only
 * those names' ranges of the table. Two kinds of messaging datapoint are
 * deliberately not read, so they can attach to a queue at ingest (its key is
 * stamped on them) but never create or sight one:
 *
 *   - an application's own gauge that carries `messaging.system` (BullMQ's
 *     `queue.size`, OneUptime's own included): the docs promise it attaches
 *     to a queue, never that it creates one, and its name says nothing;
 *   - a curated name a RenameMetric pipeline rule stored in mixed case
 *     (`Kafka.Consumer_Group.Lag_Sum`): ingest lowercases a name on arrival,
 *     but a rule's rename lands in the table verbatim. Ingest still stamps
 *     the queue's key on it (it compares names trimmed and lowercased), but
 *     matching every stored spelling here would take a lower() over the name
 *     column of every row, which no sort-key range can serve.
 */
export const MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES: ReadonlyArray<string> =
  uniqueSorted([
    ...MESSAGE_QUEUE_BROKER_METRIC_NAMES,
    ...MESSAGING_CLIENT_METRIC_NAMES,
  ]);

/*
 * The curated metrics a cloud provider's monitoring API reports (Azure
 * Monitor, CloudWatch, Cloud Monitoring): the ones read
 * MESSAGE_QUEUE_LATE_METRIC_MINUTES further back.
 */
export const MESSAGE_QUEUE_LATE_METRIC_NAMES: ReadonlyArray<string> =
  uniqueSorted(
    MESSAGE_QUEUE_METRICS.filter(
      (descriptor: MessageQueueMetricDescriptor): boolean => {
        return (
          getMessagingBrokerMetricsSource(descriptor.system).kind ===
          "cloud-monitoring"
        );
      },
    ).map((descriptor: MessageQueueMetricDescriptor): string => {
      return descriptor.metricName;
    }),
  );

/*
 * The Azure resource provider namespaces that make `az.namespace` /
 * `azure.resource_provider.namespace` a messaging trigger — Service Bus's
 * and Event Hubs'. The Azure SDKs stamp those keys on EVERY client span
 * (Storage, Key Vault and Cosmos DB as much as Service Bus), so the core's
 * trigger check admits them only for these values, and so must the span
 * query's prefilter, or every Azure SDK span of the window would compete for
 * the row cap. The core keeps the values private to that check, so they are
 * found by asking the check itself (hasMessagingTrigger) about every name
 * the messaging catalog knows: the query can admit no other set than ingest.
 */
export const AZURE_MESSAGING_PROVIDER_NAMESPACES: ReadonlyArray<string> =
  uniqueSorted(
    MESSAGING_SYSTEMS.flatMap(
      (descriptor: MessagingSystemDescriptor): Array<string> => {
        return [descriptor.system, ...descriptor.aliases];
      },
    ).filter((name: string): boolean => {
      return AZURE_RESOURCE_PROVIDER_ATTRIBUTES.some((key: string): boolean => {
        return hasMessagingTrigger({ [key]: name });
      });
    }),
  );

// The trigger keys whose mere presence (non-blank) admits a span.
const PRESENCE_TRIGGER_ATTRIBUTES: ReadonlyArray<string> =
  MESSAGING_TRIGGER_ATTRIBUTES.filter((key: string): boolean => {
    return !AZURE_RESOURCE_PROVIDER_ATTRIBUTES.includes(key);
  });

// The column a query selects the attribute at `index` of its key list as.
export function getMessagingDiscoveryColumn(index: number): string {
  return `a${index}`;
}

function columnsByKey(
  keys: ReadonlyArray<string>,
): ReadonlyMap<string, string> {
  const columns: Map<string, string> = new Map<string, string>();
  keys.forEach((key: string, index: number): void => {
    columns.set(key, getMessagingDiscoveryColumn(index));
  });
  return columns;
}

const SPAN_ATTRIBUTE_COLUMNS: ReadonlyMap<string, string> = columnsByKey(
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
);
const METRIC_ATTRIBUTE_COLUMNS: ReadonlyMap<string, string> = columnsByKey(
  MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
);

function sqlString(value: string): string {
  return `'${escapeSql(value)}'`;
}

function sqlArray(values: ReadonlyArray<string>): string {
  return `[${values.map(sqlString).join(", ")}]`;
}

function sqlTuple(values: ReadonlyArray<string>): string {
  return `(${values.map(sqlString).join(", ")})`;
}

/*
 * Every span but a stored SERVER one (MESSAGE_QUEUE_DISCOVERY_EXCLUDED_SPAN_KIND).
 * `kind` is Nullable, and a span a pipeline left without a kind is stored
 * NULL: a bare `kind != …` is NULL for it, which would drop a span ingest
 * keyed. ifNull() reads it as ''. Being a non-Nullable expression, it is
 * also the form the kind column's set skip index (idx_kind) can skip blocks
 * of SERVER spans with: on ClickHouse 26.7 no comparison of the bare
 * Nullable column (=, IN, !=) skipped a single granule.
 */
function spanKindSql(): string {
  return `ifNull(kind, '') != ${sqlString(MESSAGE_QUEUE_DISCOVERY_EXCLUDED_SPAN_KIND)}`;
}

// `attributes['k'] AS a<i>` for every key, in list order.
function attributeColumnsSql(keys: ReadonlyArray<string>): string {
  return keys
    .map((key: string, index: number): string => {
      return `attributes[${sqlString(key)}] AS ${getMessagingDiscoveryColumn(index)}`;
    })
    .join(",\n      ");
}

function attributeColumnNames(keys: ReadonlyArray<string>): string {
  return keys
    .map((_key: string, index: number): string => {
      return getMessagingDiscoveryColumn(index);
    })
    .join(", ");
}

// A usable LIMIT: at least 1, whole, whatever the caller passed.
function rowCap(maxRows: number): number {
  return Number.isFinite(maxRows) && maxRows >= 1 ? Math.floor(maxRows) : 1;
}

/*
 * The span-side twin of hasMessagingTrigger, applied after the bloom-indexed
 * presence check on every trigger key: the presence of any other trigger
 * key, or an Azure provider key that names a messaging provider. A SUPERSET
 * of the core's check, so no span ingest keys a queue on is ever left out:
 * ClickHouse's trimBoth() trims spaces only, where the core trims every
 * whitespace character before comparing, so the value is searched for the
 * namespace case-insensitively instead of compared whole. Anything extra it
 * lets through (a value merely containing a namespace) resolves to no queue
 * in resolveMessagingSpanDiscoveryRows, which runs the core's check again.
 */
function spanTriggerSql(): string {
  const providerChecks: Array<string> = AZURE_RESOURCE_PROVIDER_ATTRIBUTES.map(
    (key: string): string => {
      return `multiSearchAnyCaseInsensitive(attributes[${sqlString(key)}], ${sqlArray(
        AZURE_MESSAGING_PROVIDER_NAMESPACES,
      )})`;
    },
  );
  return [
    `hasAny(attributeKeys, ${sqlArray(PRESENCE_TRIGGER_ATTRIBUTES)})`,
    ...providerChecks,
  ].join(" OR ");
}

export interface MessageQueueDiscoveryWindow {
  projectId: string;
  // ClickHouse DateTime64 expressions, e.g. toDateTime64('...', 9).
  startSql: string;
  endSql: string;
  // Cap on the grouped rows returned per run.
  maxRows: number;
}

/**
 * One row per (span kind, value of every attribute resolveMessagingSpan
 * reads) over the window's messaging spans, with how many spans, how many
 * of them failed and when the newest started — busiest first, under the row
 * cap. Spans are dropped on their kind (a stored SERVER span never names a
 * queue; every other kind, a remapped or missing one included, may) and on
 * `attributeKeys` (bloom-indexed, far smaller than the attribute map) before
 * the map is read: a span carries a messaging trigger key, and one whose only
 * trigger is an Azure provider key names Service Bus or Event Hubs there.
 */
export function buildMessagingSpanDiscoverySql(
  window: MessageQueueDiscoveryWindow,
): string {
  return `
    /* ${MESSAGE_QUEUE_SPAN_SQL_MARKER} */
    SELECT
      kind,
      ${attributeColumnsSql(MESSAGING_RESOLVER_INPUT_ATTRIBUTES)},
      count() AS spanCount,
      countIf(statusCode = ${SpanStatus.Error}) AS errorCount,
      toUnixTimestamp64Milli(max(startTime)) AS lastSeenUnixMs
    FROM ${SPAN_TABLE}
    WHERE projectId = '${escapeSql(window.projectId)}'
      AND startTime >= ${window.startSql}
      AND startTime < ${window.endSql}
      AND ${spanKindSql()}
      AND hasAny(attributeKeys, ${sqlArray(MESSAGING_TRIGGER_ATTRIBUTES)})
      AND (${spanTriggerSql()})
    GROUP BY kind, ${attributeColumnNames(MESSAGING_RESOLVER_INPUT_ATTRIBUTES)}
    ORDER BY spanCount DESC
    LIMIT ${rowCap(window.maxRows)}
    ${QUERY_SETTINGS}
  `;
}

/*
 * The metric query's time predicate: the window, reaching
 * MESSAGE_QUEUE_LATE_METRIC_MINUTES further back for the cloud-monitoring
 * metrics alone. The widest bound is its own conjunct, so the partition key
 * (toYYYYMMDD(time)) and the primary index can prune on it.
 */
function metricWindowSql(window: { startSql: string; endSql: string }): string {
  return `time >= ${window.startSql} - INTERVAL ${MESSAGE_QUEUE_LATE_METRIC_MINUTES} MINUTE
      AND time < ${window.endSql}
      AND (time >= ${window.startSql} OR name IN ${sqlTuple(
        MESSAGE_QUEUE_LATE_METRIC_NAMES,
      )})`;
}

/**
 * One row per (metric name, value of every attribute
 * resolveMessagingMetricDatapoint reads) over the window's curated broker
 * and messaging client datapoints (MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES),
 * with how many datapoints and when the newest was taken — busiest first,
 * under the row cap. The keys that only mark a curated metric's per-consumer
 * repeat (MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES: Pulsar's consumer
 * name and id) are neither selected nor filtered on: they are per instance,
 * so grouping on them would split a topic's rows per consumer, and a repeat
 * folds into its subscription's own series of the same topic, which names
 * the same queue.
 */
export function buildMessagingMetricDiscoverySql(
  window: MessageQueueDiscoveryWindow,
): string {
  return `
    /* ${MESSAGE_QUEUE_METRIC_SQL_MARKER} */
    SELECT
      name,
      ${attributeColumnsSql(MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES)},
      count() AS pointCount,
      toUnixTimestamp64Milli(max(time)) AS lastSeenUnixMs
    FROM ${METRIC_TABLE}
    WHERE projectId = '${escapeSql(window.projectId)}'
      AND name IN ${sqlTuple(MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES)}
      AND ${metricWindowSql(window)}
    GROUP BY name, ${attributeColumnNames(MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES)}
    ORDER BY pointCount DESC
    LIMIT ${rowCap(window.maxRows)}
    ${QUERY_SETTINGS}
  `;
}

/**
 * The projects that sent a datapoint the metric query reads, in the window
 * it reads them in. The cron's project list otherwise comes from spans and
 * service graph metrics only, and a project whose only messaging telemetry
 * is its brokers' metrics (a collector watching Kafka or SQS, no
 * instrumented application) would never have its queues discovered.
 */
export function buildMessagingMetricProjectsSql(data: {
  startSql: string;
  endSql: string;
  maxProjects: number;
}): string {
  return `
    /* ${MESSAGE_QUEUE_METRIC_PROJECTS_SQL_MARKER} */
    SELECT DISTINCT projectId
    FROM ${METRIC_TABLE}
    WHERE name IN ${sqlTuple(MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES)}
      AND ${metricWindowSql(data)}
    LIMIT ${rowCap(data.maxProjects)}
    ${QUERY_SETTINGS}
  `;
}

/*
 * A span query row. ClickHouse serializes UInt64 / Int64 aggregates as JSON
 * strings or numbers depending on its settings, so the counts and the time
 * are Number()-coerced. The attribute columns (`a0` …, see
 * getMessagingDiscoveryColumn) hold MESSAGING_RESOLVER_INPUT_ATTRIBUTES'
 * values in list order, '' for a key the spans lack.
 */
export interface MessagingSpanDiscoveryRow {
  [column: string]: unknown;
  kind?: string | null | undefined;
  spanCount?: string | number | undefined;
  errorCount?: string | number | undefined;
  lastSeenUnixMs?: string | number | undefined;
}

/*
 * A metric query row: the columns hold
 * MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES' values in list order.
 */
export interface MessagingMetricDiscoveryRow {
  [column: string]: unknown;
  name?: string | null | undefined;
  pointCount?: string | number | undefined;
  lastSeenUnixMs?: string | number | undefined;
}

export type MessageQueueDirectionCounts = Record<MessagingDirection, number>;

/*
 * What one kind of telemetry told discovery about a queue in the window.
 */
export interface MessageQueueEvidence {
  // Spans or datapoints (0 when ClickHouse sent a count it could not read).
  count: number;
  // Of the spans, how many failed (statusCode Error); 0 for datapoints.
  errorCount: number;
  // The spans or datapoints per direction they were resolved to.
  directions: MessageQueueDirectionCounts;
  // The broker address the most of them named — display only — or null.
  brokerAddress: string | null;
  // When the newest of them was taken, or null when unknown.
  lastSeenAt: Date | null;
}

export interface DiscoveredMessageQueue {
  // Canonical and family-keyed (toMessageQueueIdentity).
  identity: MessageQueueIdentity;
  // buildMessageQueueIdentifier(identity): what the row is unique on.
  identifier: string;
  /*
   * The most specific system the evidence named, within the identity's
   * family (getMoreSpecificMessagingSystem): "activemq" when the JMX
   * Scraper's metrics joined a JMS application's "jms" spans.
   */
  system: string;
  // The destination as the most evidence spelled it (original casing).
  destination: string;
  // Application spans: the creation minimum counts these.
  spans: MessageQueueEvidence | null;
  // Curated broker metrics: a single datapoint may create the queue.
  brokerMetrics: MessageQueueEvidence | null;
  /*
   * Messaging client metrics: they sight a queue that exists, like the
   * application's spans, but never create one.
   */
  clientMetrics: MessageQueueEvidence | null;
}

type EvidenceKind = "spans" | "brokerMetrics" | "clientMetrics";

const EVIDENCE_KINDS: ReadonlyArray<EvidenceKind> = [
  "spans",
  "brokerMetrics",
  "clientMetrics",
];

const DIRECTIONS: ReadonlyArray<MessagingDirection> = [
  "publish",
  "consume",
  "settle",
  "unknown",
];

interface EvidenceAccumulator {
  count: number;
  errorCount: number;
  directions: MessageQueueDirectionCounts;
  // broker address → how much evidence named it
  addresses: Map<string, number>;
  // Epoch milliseconds; 0 while unknown.
  lastSeenMs: number;
}

interface QueueAccumulator {
  identity: MessageQueueIdentity;
  identifier: string;
  // specific system → how much evidence named it
  systems: Map<string, number>;
  // display destination → how much evidence spelled it so
  destinations: Map<string, number>;
  evidence: Map<EvidenceKind, EvidenceAccumulator>;
}

function toCount(value: unknown): number {
  const parsed: number = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// Epoch milliseconds of a row's newest time; 0 when absent or unreadable.
function toEpochMs(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const parsed: number = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function newDirectionCounts(): MessageQueueDirectionCounts {
  return { publish: 0, consume: 0, settle: 0, unknown: 0 };
}

function addWeight(
  weights: Map<string, number>,
  key: string,
  weight: number,
): void {
  weights.set(key, (weights.get(key) || 0) + weight);
}

// Heaviest first, then by value, so every choice below is order-independent.
function compareByWeightThenKey(
  a: [string, number],
  b: [string, number],
): number {
  if (a[1] !== b[1]) {
    return b[1] - a[1];
  }
  if (a[0] < b[0]) {
    return -1;
  }
  return a[0] > b[0] ? 1 : 0;
}

function heaviest(weights: Map<string, number>): string | null {
  const sorted: Array<[string, number]> = Array.from(weights.entries()).sort(
    compareByWeightThenKey,
  );
  return sorted.length > 0 ? sorted[0]![0] : null;
}

function queueFor(
  queues: Map<string, QueueAccumulator>,
  identity: MessageQueueIdentity,
  identifier: string,
): QueueAccumulator {
  let queue: QueueAccumulator | undefined = queues.get(identifier);
  if (!queue) {
    queue = {
      identity: identity,
      identifier: identifier,
      systems: new Map<string, number>(),
      destinations: new Map<string, number>(),
      evidence: new Map<EvidenceKind, EvidenceAccumulator>(),
    };
    queues.set(identifier, queue);
  }
  return queue;
}

function evidenceFor(
  queue: QueueAccumulator,
  kind: EvidenceKind,
): EvidenceAccumulator {
  let evidence: EvidenceAccumulator | undefined = queue.evidence.get(kind);
  if (!evidence) {
    evidence = {
      count: 0,
      errorCount: 0,
      directions: newDirectionCounts(),
      addresses: new Map<string, number>(),
      lastSeenMs: 0,
    };
    queue.evidence.set(kind, evidence);
  }
  return evidence;
}

/*
 * One resolved row into its queue — keyed exactly as ingest keys the row
 * (MessagingEntityKeyResolver): the canonical identity of the resolution,
 * and only when that identity builds an identifier. Ingest stamps no key on
 * a row whose identifier cannot be built (lowercasing can push a
 * 255-character destination past the identifier's length), so no row may
 * be created for one either.
 */
function addResolved(
  queues: Map<string, QueueAccumulator>,
  kind: EvidenceKind,
  resolved: ResolvedMessagingDestination,
  observed: { count: number; errorCount: number; lastSeenMs: number },
): void {
  const identity: MessageQueueIdentity | null = toMessageQueueIdentity({
    system: resolved.system,
    brokerScope: resolved.brokerScope,
    destination: resolved.destination,
  });
  const identifier: string | null = identity
    ? buildMessageQueueIdentifier(identity)
    : null;
  if (!identity || !identifier) {
    return;
  }

  const queue: QueueAccumulator = queueFor(queues, identity, identifier);
  addWeight(queue.systems, resolved.system, observed.count);
  addWeight(queue.destinations, resolved.destination, observed.count);

  const evidence: EvidenceAccumulator = evidenceFor(queue, kind);
  evidence.count += observed.count;
  evidence.errorCount += observed.errorCount;
  if (DIRECTIONS.includes(resolved.direction)) {
    evidence.directions[resolved.direction] += observed.count;
  }
  if (resolved.brokerAddress) {
    addWeight(evidence.addresses, resolved.brokerAddress, observed.count);
  }
  evidence.lastSeenMs = Math.max(evidence.lastSeenMs, observed.lastSeenMs);
}

/*
 * The system a queue row should record: the evidence's systems folded with
 * getMoreSpecificMessagingSystem — the rule a row's own system is refined
 * by — busiest first, so a family member ("activemq") wins over the family
 * ("jms") whichever was busier, and the answer never depends on row order.
 */
function mostSpecificSystem(queue: QueueAccumulator): string {
  let system: string = "";
  for (const [candidate] of Array.from(queue.systems.entries()).sort(
    compareByWeightThenKey,
  )) {
    system = getMoreSpecificMessagingSystem(system, candidate) || system;
  }
  return system || queue.identity.system;
}

function toEvidence(
  accumulator: EvidenceAccumulator | undefined,
): MessageQueueEvidence | null {
  if (!accumulator) {
    return null;
  }
  return {
    count: accumulator.count,
    errorCount: accumulator.errorCount,
    directions: { ...accumulator.directions },
    brokerAddress: heaviest(accumulator.addresses),
    lastSeenAt:
      accumulator.lastSeenMs > 0 ? new Date(accumulator.lastSeenMs) : null,
  };
}

/**
 * All evidence behind a discovered queue: its spans and datapoints of every
 * kind, the order discovery works through queues in.
 */
export function getDiscoveredMessageQueueEvidenceCount(
  discovered: DiscoveredMessageQueue,
): number {
  let count: number = 0;
  for (const kind of EVIDENCE_KINDS) {
    count += discovered[kind]?.count || 0;
  }
  return count;
}

// Busiest first, then by identifier, so the order is stable.
function compareDiscovered(
  a: DiscoveredMessageQueue,
  b: DiscoveredMessageQueue,
): number {
  const difference: number =
    getDiscoveredMessageQueueEvidenceCount(b) -
    getDiscoveredMessageQueueEvidenceCount(a);
  if (difference !== 0) {
    return difference;
  }
  if (a.identifier < b.identifier) {
    return -1;
  }
  return a.identifier > b.identifier ? 1 : 0;
}

function finish(
  queues: Map<string, QueueAccumulator>,
): Array<DiscoveredMessageQueue> {
  const discovered: Array<DiscoveredMessageQueue> = [];
  for (const queue of queues.values()) {
    discovered.push({
      identity: queue.identity,
      identifier: queue.identifier,
      system: mostSpecificSystem(queue),
      destination: heaviest(queue.destinations) || queue.identity.destination,
      spans: toEvidence(queue.evidence.get("spans")),
      brokerMetrics: toEvidence(queue.evidence.get("brokerMetrics")),
      clientMetrics: toEvidence(queue.evidence.get("clientMetrics")),
    });
  }
  return discovered.sort(compareDiscovered);
}

// A getter over a query row's attribute columns: what the resolver reads.
function rowAttributeGetter(
  row: Record<string, unknown>,
  columns: ReadonlyMap<string, string>,
): AttributeGetter {
  return (key: string): unknown => {
    const column: string | undefined = columns.get(key);
    return column === undefined ? undefined : row[column];
  };
}

/**
 * Span query rows → the queues they name. Each row goes back through
 * resolveMessagingSpan — the resolver ingest ran on each of its spans — with
 * its kind and grouped attributes, so a SERVER span, a span with no
 * messaging trigger (or an Azure SDK span of another service) and a
 * temporary, generated, placeholder, scrubbed or overlong destination
 * resolve to nothing, exactly as they got no key at ingest. Rows that land
 * on one identity (the same queue named by producers and consumers, by
 * several semconv generations, by several Pulsar partitions or with several
 * UUIDs templated away) are merged: spans, failures and directions summed.
 * Busiest first.
 */
export function resolveMessagingSpanDiscoveryRows(
  rows: ReadonlyArray<MessagingSpanDiscoveryRow>,
): Array<DiscoveredMessageQueue> {
  const queues: Map<string, QueueAccumulator> = new Map<
    string,
    QueueAccumulator
  >();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const resolved: ResolvedMessagingDestination | null = resolveMessagingSpan({
      getAttribute: rowAttributeGetter(row, SPAN_ATTRIBUTE_COLUMNS),
      kind: typeof row.kind === "string" ? row.kind : null,
    });

    if (!resolved) {
      continue;
    }

    addResolved(queues, "spans", resolved, {
      count: toCount(row.spanCount),
      errorCount: toCount(row.errorCount),
      lastSeenMs: toEpochMs(row.lastSeenUnixMs),
    });
  }

  return finish(queues);
}

/**
 * Metric query rows → the queues they name. Each row goes back through
 * resolveMessagingMetricDatapoint — the resolver ingest ran on each of its
 * datapoints — with its metric name and grouped attributes. A curated
 * broker metric's datapoints are broker evidence (they may create a queue);
 * anything else the query reads, a messaging client metric, is client
 * evidence (it sights a queue that exists, never creates one). Rows that
 * land on one identity are merged, datapoints summed. Busiest first.
 */
export function resolveMessagingMetricDiscoveryRows(
  rows: ReadonlyArray<MessagingMetricDiscoveryRow>,
): Array<DiscoveredMessageQueue> {
  const queues: Map<string, QueueAccumulator> = new Map<
    string,
    QueueAccumulator
  >();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const metricName: string = typeof row.name === "string" ? row.name : "";

    const resolved: ResolvedMessagingDestination | null =
      resolveMessagingMetricDatapoint({
        metricName: metricName,
        getAttribute: rowAttributeGetter(row, METRIC_ATTRIBUTE_COLUMNS),
      });

    if (!resolved) {
      continue;
    }

    addResolved(
      queues,
      MESSAGE_QUEUE_BROKER_METRIC_NAMES.has(metricName.trim().toLowerCase())
        ? "brokerMetrics"
        : "clientMetrics",
      resolved,
      {
        count: toCount(row.pointCount),
        errorCount: 0,
        lastSeenMs: toEpochMs(row.lastSeenUnixMs),
      },
    );
  }

  return finish(queues);
}

/**
 * Discovered queues from several sources (the span rows', the metric rows')
 * merged into one entry per identity: every kind of evidence summed, the
 * newest time kept, the system folded to the most specific the sources
 * named, and the destination spelling and broker address the most evidence
 * carried. Busiest first.
 */
export function mergeDiscoveredMessageQueues(
  ...lists: Array<ReadonlyArray<DiscoveredMessageQueue>>
): Array<DiscoveredMessageQueue> {
  const queues: Map<string, QueueAccumulator> = new Map<
    string,
    QueueAccumulator
  >();

  for (const list of lists) {
    for (const discovered of Array.isArray(list) ? list : []) {
      if (!discovered || !discovered.identifier || !discovered.identity) {
        continue;
      }

      const queue: QueueAccumulator = queueFor(
        queues,
        discovered.identity,
        discovered.identifier,
      );
      const weight: number = getDiscoveredMessageQueueEvidenceCount(discovered);
      addWeight(queue.systems, discovered.system, weight);
      addWeight(queue.destinations, discovered.destination, weight);

      for (const kind of EVIDENCE_KINDS) {
        const source: MessageQueueEvidence | null = discovered[kind];
        if (!source) {
          continue;
        }
        const target: EvidenceAccumulator = evidenceFor(queue, kind);
        target.count += source.count;
        target.errorCount += source.errorCount;
        for (const direction of DIRECTIONS) {
          target.directions[direction] += source.directions[direction] || 0;
        }
        if (source.brokerAddress) {
          addWeight(target.addresses, source.brokerAddress, source.count);
        }
        target.lastSeenMs = Math.max(
          target.lastSeenMs,
          source.lastSeenAt ? source.lastSeenAt.getTime() : 0,
        );
      }
    }
  }

  return finish(queues);
}

/*
 * Spans a destination needs inside one window before traces may create a
 * queue for it on their own (env MESSAGE_QUEUE_MIN_SPANS, default 3, at
 * least 1). One stray span of a one-off script is not a queue worth
 * listing; a queue that exists is matched and sighted whatever the count.
 */
export function getMessageQueueMinSpans(): number {
  const raw: string | undefined = process.env[MESSAGE_QUEUE_MIN_SPANS_ENV];

  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_MESSAGE_QUEUE_MIN_SPANS;
  }

  const parsed: number = Number(raw.trim());

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return DEFAULT_MESSAGE_QUEUE_MIN_SPANS;
  }

  return Math.max(parsed, 1);
}

// Whether a queue's spans alone meet the minimum (never below 1 span).
function spansMeetMinimum(
  discovered: DiscoveredMessageQueue,
  minSpans: number,
): boolean {
  const minimum: number = Number.isFinite(minSpans)
    ? Math.max(minSpans, 1)
    : DEFAULT_MESSAGE_QUEUE_MIN_SPANS;

  return discovered.spans !== null && discovered.spans.count >= minimum;
}

/**
 * The create policy for a discovered queue that has no row yet, minus the
 * project budget (MessageQueueService applies it): at least `minSpans`
 * spans in the window, or any curated broker metric datapoint — the broker
 * reporting a queue is proof enough that it exists. Messaging client
 * metrics alone never create one: like an application's own gauge, they
 * attach to a queue, and sight one that exists.
 */
export function isMessageQueueAutoCreateCandidate(data: {
  discovered: DiscoveredMessageQueue;
  minSpans: number;
}): boolean {
  return (
    data.discovered.brokerMetrics !== null ||
    spansMeetMinimum(data.discovered, data.minSpans)
  );
}

/**
 * What a row created for this queue records as its discovery source: the
 * application's traces when its spans meet the minimum, else the broker's
 * metrics when they reported it ("traces" for anything else, which the
 * create policy refuses anyway).
 */
export function getMessageQueueCreationSource(data: {
  discovered: DiscoveredMessageQueue;
  minSpans: number;
}): "traces" | "broker-metrics" {
  if (
    !spansMeetMinimum(data.discovered, data.minSpans) &&
    data.discovered.brokerMetrics !== null
  ) {
    return "broker-metrics";
  }

  return "traces";
}

/**
 * The broker address a queue's row shows (display only): the one the
 * application's own evidence named — its spans', else its messaging client
 * metrics' (both read `server.address` / `server.port`: the broker the
 * client connected to) — else the broker metrics' (the target a Prometheus
 * scrape stamps on the resource: the broker's metrics port, or for
 * scraped exporters the exporter itself, never what applications connect
 * to), else null.
 *
 * A row has ONE address column, and each sighting that carries an address
 * overwrites it: discovery gives a new row this address and passes it to
 * EVERY sighting of the run, never a sighting's own source's. Otherwise the
 * sighting that runs last — the broker's — would leave its scrape target on
 * the row on every run (its write gate reopens long before the next run).
 */
export function getDiscoveredMessageQueueBrokerAddress(
  discovered: DiscoveredMessageQueue,
): string | null {
  return (
    discovered.spans?.brokerAddress ||
    discovered.clientMetrics?.brokerAddress ||
    discovered.brokerMetrics?.brokerAddress ||
    null
  );
}
