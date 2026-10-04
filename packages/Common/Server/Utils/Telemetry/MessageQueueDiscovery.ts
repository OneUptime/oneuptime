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
  MessagingSystemDescriptor,
  getMessagingBrokerMetricsSource,
  getMessagingSystemDescriptor,
  getMoreSpecificMessagingSystem,
} from "../../../Types/MessageQueue/MessagingSystem";
import {
  AZURE_MESSAGING_PROVIDER_NAMESPACES,
  AZURE_RESOURCE_PROVIDER_ATTRIBUTES,
  AttributeGetter,
  MESSAGING_DESTINATION_ATTRIBUTES,
  MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_SYSTEM_ATTRIBUTE,
  MESSAGING_TEMPORARY_FLAG_ATTRIBUTES,
  MESSAGING_TRIGGER_ATTRIBUTES,
  MessagingDirection,
  RABBITMQ_ROUTING_KEY_ATTRIBUTES,
  ResolvedMessagingDestination,
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
 * ingest. None of those keys is per message or per instance by design (the
 * core keeps offsets, partitions, message, client and consumer ids out of
 * its lists), so a topic a thousand pods consume is a handful of rows, not
 * a thousand. A few of them can still HOLD a value per message — a
 * JetStream acknowledgement subject, a destination name beside its
 * template, a routing key carrying an id — which the span query folds
 * before grouping, without changing what the resolver answers (see
 * "Values that vary per message" below).
 *
 * Each query returns at most its row cap, and the rows it keeps are chosen
 * so that no queue is left out run after run: every broker (span query) or
 * metric (metric query) gets its share, and half of each share goes to its
 * busiest groups, the other half to a sample that rotates every run (see
 * "Which rows the cap keeps" below). And each query ends on the server
 * before the cron's client gives up on it: a window too big to read in time
 * fails with ClickHouse's own timeout error, not the client's (see "The
 * queue queries' settings" below).
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
 * as no kind — exactly as ingest did. That includes OTLP's number: a
 * mapping saved through the API may write the NUMBER 2, which the stamper
 * sees and the kind column keeps as the text "2", and the core reads both
 * as SERVER.
 *
 * It also leaves out the Kafka, MQTT and NATS spans OBI records on the
 * receiving side of a connection (a broker serving a produce or fetch, a
 * subscriber handed a delivery): OBI v0.14 sends them as PRODUCER /
 * CONSUMER, and the App's trace ingest stores them as SERVER, as v0.13 sent
 * them (ObiReceivingSideMessagingSpan), so a broker does not count as a
 * producer or consumer of its own topics. Ingest stores as SERVER too the
 * broker spans OBI types client-side, which v0.13 sent as PRODUCER /
 * CONSUMER as well: a NATS MSG the broker wrote, and an MQTT PUBLISH it
 * wrote to a subscriber or a NATS PUB it read beside a split delivery, told
 * from a client's by the subscriber's ephemeral port. A NATS client's split
 * delivery naming its broker stays CONSUMER: it is the subscriber's own
 * consumption.
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
 * key, or an Azure provider key that names a messaging provider. The Azure
 * SDKs stamp those keys on EVERY client span (Storage, Key Vault and Cosmos
 * DB as much as Service Bus), so without the value condition every Azure SDK
 * span of the window would compete for the row cap. The namespaces are the
 * core's own list (AZURE_MESSAGING_PROVIDER_NAMESPACES, the values its
 * trigger check admits), never a copy. A SUPERSET of the core's check, so no
 * span ingest keys a queue on is ever left out: ClickHouse's trimBoth()
 * trims spaces only, where the core trims every whitespace character before
 * comparing, so the value is searched for the namespace case-insensitively
 * instead of compared whole. Anything extra it lets through (a value merely
 * containing a namespace) resolves to no queue in
 * resolveMessagingSpanDiscoveryRows, which runs the core's check again.
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

/*
 * ---- Values that vary per message --------------------------------------------
 *
 * The span query groups on the VALUES of the resolver's keys, and a few of
 * those keys can hold a new value on every message although the resolver
 * gives all of them one answer, or none:
 *
 *   - the Java agent names a JetStream acknowledgement by its whole subject
 *     (`$JS.ACK.<stream>.<consumer>.<delivered>.<stream seq>.<consumer
 *     seq>.<timestamp>.<pending>`; the template `$JS.ACK` goes beside it
 *     only when boundJetStreamAckDestination is on), and a reply inbox
 *     (`_INBOX.<id>`) whole in its stable-semconv mode — the resolver names
 *     no queue for either;
 *   - a destination name beside a template (the spec asks for a template
 *     exactly when the name is not low-cardinality): the resolver reads the
 *     template, and the name only for whether it is blank;
 *   - a RabbitMQ routing key carrying an id (`order.4711.created`, the
 *     usual topic-exchange key) beside the exchange it was published to:
 *     the resolver names the exchange.
 *
 * Grouped as stored, each such value is a group of its own: ten million
 * acknowledgements in a window took the query past its memory limit on
 * every run (ClickHouse Code 241). The failure is logged and costs the
 * project its span evidence, so span-only queues were never sighted, and
 * were archived a week later. So the query hands the resolver the same
 * answer in far fewer groups:
 *
 *   1. it leaves out the spans the resolver certainly names no queue for —
 *      a temporary or anonymous flag that is "true", and a NATS span whose
 *      destination is an inbox or acknowledgement subject;
 *   2. a destination key after one that certainly holds text is read only
 *      for whether it is blank (a trigger, the Azure legacy evidence), so
 *      its text becomes one placeholder;
 *   3. a routing key is blanked beside destinations the resolver reads as
 *      one name — none holds a ':' or ',' or spells the default exchange —
 *      where nothing reads the key at all.
 *
 * Each rule errs toward keeping a value as stored: "certainly holds text"
 * means a printable, non-space ASCII character, which no trim removes, and
 * every comparison is one ClickHouse makes exactly as the resolver does, or
 * more strictly. The tests hold a TypeScript twin of these rules to the
 * resolver over the core's fixture corpus and generated variants, and the
 * real-ClickHouse suite holds the query to the twin. With them, ten million
 * acknowledgements beside eight hundred thousand Kafka spans are three
 * hundred groups: 4.2 s and 0.8 GiB at 32 threads, nearly all of it the
 * scan's (see "The queue queries' settings").
 *
 * A shape no rule folds still makes a group per message — a joined RabbitMQ
 * name per routing key, a topic named per request that the resolver
 * templates into one. Such groups spill to disk past QUERY_SETTINGS'
 * max_bytes_before_external_group_by, but the more threads the scan runs,
 * the fewer of them merge back from disk within the memory limit: at 32
 * threads a million in a window finished (1.0 GiB) and two million failed
 * (Code 241, which costs the run the project's span evidence), where four
 * threads finished eight million.
 */

/**
 * What a destination key the resolver reads only for blankness holds in the
 * span query's rows (rule 2): non-blank, like the text it stands for, and a
 * value the resolver reads as scrubbed — so even read as the destination it
 * could never name a queue.
 */
export const MESSAGE_QUEUE_DISCOVERY_SHADOWED_VALUE: string = "*";

/**
 * The NATS subjects the resolver names no queue for, lowercased as it
 * compares them: reply inboxes and JetStream acknowledgements, each on its
 * own or followed by "." and anything (rule 1).
 */
export const MESSAGE_QUEUE_NATS_GENERATED_SUBJECTS: ReadonlyArray<string> = [
  "_inbox",
  "$js.ack",
];

/**
 * The non-empty spellings of RabbitMQ's default exchange, lowercased, whose
 * routing key the resolver reads as the queue (rule 3). The empty spelling
 * cannot be a destination the resolver reads, and a joined name that leads
 * with it holds a ':' or ',' anyway.
 */
export const MESSAGE_QUEUE_RABBITMQ_DEFAULT_EXCHANGES: ReadonlyArray<string> = [
  "amq.default",
  "<default>",
];

// A system's spellings the catalog maps to it, lowercased (NATS: "jetstream").
function systemSpellings(system: string): ReadonlyArray<string> {
  const descriptor: MessagingSystemDescriptor | null =
    getMessagingSystemDescriptor(system);
  return uniqueSorted(
    (descriptor ? [descriptor.system, ...descriptor.aliases] : [system]).map(
      (spelling: string): string => {
        return spelling.toLowerCase();
      },
    ),
  );
}

const NATS_SPELLINGS: ReadonlyArray<string> = systemSpellings("nats");

// A span attribute as stored.
function storedAttributeSql(key: string): string {
  return `attributes[${sqlString(key)}]`;
}

/*
 * The span query names the destination keys' shared tests once (a WITH
 * clause, which ClickHouse expands where they are used):
 *
 *   - destinationText<i>: destination key i (MESSAGING_DESTINATION_ATTRIBUTES
 *     order) certainly holds text the resolver reads as non-blank — a
 *     printable, non-space ASCII character, which no trim removes. Saying
 *     no proves nothing (a name in another script holds text too), so the
 *     rules then leave a value as stored;
 *   - storedDestinations: every destination key as stored, joined, for the
 *     searches that must find nothing in any of them;
 *   - firstStoredDestination: the first non-empty destination key as
 *     stored, lowercased as ClickHouse lowercases (ASCII only).
 */
function destinationTextAlias(position: number): string {
  return `destinationText${position}`;
}

const STORED_DESTINATIONS_ALIAS: string = "storedDestinations";
const FIRST_STORED_DESTINATION_ALIAS: string = "firstStoredDestination";

function spanAliasesSql(): string {
  return [
    ...MESSAGING_DESTINATION_ATTRIBUTES.map(
      (key: string, position: number): string => {
        return `match(${storedAttributeSql(key)}, '[!-~]') AS ${destinationTextAlias(position)}`;
      },
    ),
    `concat(${MESSAGING_DESTINATION_ATTRIBUTES.map(storedAttributeSql).join(
      ", ",
    )}) AS ${STORED_DESTINATIONS_ALIAS}`,
    `lower(ifNull(coalesce(${MESSAGING_DESTINATION_ATTRIBUTES.map(
      (key: string): string => {
        return `nullIf(${storedAttributeSql(key)}, '')`;
      },
    ).join(", ")}), '')) AS ${FIRST_STORED_DESTINATION_ALIAS}`,
  ].join(",\n          ");
}

// Whether any of the first `count` destination keys certainly holds text.
function anyDestinationTextSql(count: number): string {
  return `(${MESSAGING_DESTINATION_ATTRIBUTES.slice(0, count)
    .map((_key: string, position: number): string => {
      return destinationTextAlias(position);
    })
    .join(" OR ")})`;
}

/*
 * The spans the resolver certainly names no queue for (rule 1):
 *
 *   - a temporary or anonymous flag it reads as true — the stored text
 *     "true" in any case (the resolver trims and lowercases it); it checks
 *     the flags before it looks for a destination at all;
 *   - a NATS span (its `messaging.system` exactly a spelling the catalog
 *     maps to NATS) whose first non-empty destination key holds an inbox or
 *     acknowledgement subject: every key before it is empty and it starts
 *     with a character no trim removes, so it is the destination the
 *     resolver reads, and the resolver finds the generated subject in it.
 */
function certainlyNoQueueSql(): string {
  const flags: Array<string> = MESSAGING_TEMPORARY_FLAG_ATTRIBUTES.map(
    (key: string): string => {
      return `lower(${storedAttributeSql(key)}) = 'true'`;
    },
  );
  const generated: Array<string> = [
    `${FIRST_STORED_DESTINATION_ALIAS} IN ${sqlTuple(
      MESSAGE_QUEUE_NATS_GENERATED_SUBJECTS,
    )}`,
    ...MESSAGE_QUEUE_NATS_GENERATED_SUBJECTS.map((subject: string): string => {
      return `startsWith(${FIRST_STORED_DESTINATION_ALIAS}, ${sqlString(`${subject}.`)})`;
    }),
  ];
  return [
    ...flags,
    `(lower(${storedAttributeSql(MESSAGING_SYSTEM_ATTRIBUTE)}) IN ${sqlTuple(
      NATS_SPELLINGS,
    )} AND (${generated.join(" OR ")}))`,
  ].join(" OR ");
}

/*
 * A destination key's column (rule 2): as stored, unless an earlier
 * destination key certainly holds text — the resolver then takes the
 * destination from that one, and reads this one only for whether it is
 * blank — and this one certainly holds text too: then the placeholder,
 * non-blank like it.
 */
function destinationColumnSql(key: string): string {
  const position: number = MESSAGING_DESTINATION_ATTRIBUTES.indexOf(key);
  const stored: string = storedAttributeSql(key);
  if (position <= 0) {
    return stored;
  }
  return `if(${anyDestinationTextSql(position)} AND ${destinationTextAlias(
    position,
  )}, ${sqlString(MESSAGE_QUEUE_DISCOVERY_SHADOWED_VALUE)}, ${stored})`;
}

/*
 * A routing key's column (rule 3): blank where the resolver never reads it —
 * some destination key certainly holds text (so the key is not the
 * destination), none holds a ':' or ',' (so no joined or aio-pika name is
 * split and compared against it) and none spells the default exchange
 * (whose routing key IS the queue) — else as stored. Beside such a
 * destination the resolver keeps the name as it is, whatever the key.
 */
function routingKeyColumnSql(key: string): string {
  return `if(${anyDestinationTextSql(
    MESSAGING_DESTINATION_ATTRIBUTES.length,
  )} AND NOT multiSearchAny(${STORED_DESTINATIONS_ALIAS}, ${sqlArray([
    ":",
    ",",
  ])}) AND NOT multiSearchAnyCaseInsensitive(${STORED_DESTINATIONS_ALIAS}, ${sqlArray(
    MESSAGE_QUEUE_RABBITMQ_DEFAULT_EXCHANGES,
  )}), '', ${storedAttributeSql(key)})`;
}

// One span query column: folded by rule 2 or 3, or as stored.
function spanAttributeColumnSql(key: string): string {
  if (MESSAGING_DESTINATION_ATTRIBUTES.includes(key)) {
    return destinationColumnSql(key);
  }
  if (RABBITMQ_ROUTING_KEY_ATTRIBUTES.includes(key)) {
    return routingKeyColumnSql(key);
  }
  return storedAttributeSql(key);
}

// `<column expression> AS a<i>` for every key the span resolver reads.
function spanAttributeColumnsSql(): string {
  return MESSAGING_RESOLVER_INPUT_ATTRIBUTES.map(
    (key: string, index: number): string => {
      return `${spanAttributeColumnSql(key)} AS ${getMessagingDiscoveryColumn(index)}`;
    },
  ).join(",\n          ");
}

/*
 * ---- Which rows the cap keeps -------------------------------------------------
 *
 * A queue is several rows — one per span kind, consumer group, semconv
 * generation or broker address, one per metric name — and a busy project
 * has more rows than either cap. Cut busiest-first alone, the cap failed
 * two ways: a busy source took every slot (a Kafka scrape's datapoints
 * outnumber a CloudWatch queue's by a hundred to one, so a few hundred
 * topics left no SQS queue a row), and rows that tie (every CloudWatch
 * queue reports as often as the next) were cut in ClickHouse's hash order:
 * the same queues, run after run. A queue left out is never created or
 * sighted, and is archived a week later while its broker keeps reporting
 * it.
 *
 * So the rows are ranked within their share — a metric name; for spans a
 * `messaging.system` value — twice: busiest first, and in a rotating order
 * (the row's grouped values hashed with the window's start, so it changes
 * every run), which also breaks the busiest ranking's ties. They are then
 * taken alternately from the two rankings, and from every share in turn:
 * each share's busiest row, a rotating one, its next busiest, and so on. A
 * project under the cap loses nothing; over it, every share gets its part
 * (a small share all of its rows), its busiest groups are read every run,
 * and the others by turns, a different sample every run (within the bound
 * MESSAGE_QUEUE_RANKED_ROWS_PER_CAPPED_ROW sets).
 */

/*
 * A row's place in this run's rotating order: its grouped values (`values`,
 * SQL) hashed with the window's start.
 */
function rotationSql(startSql: string, values: string): string {
  return `cityHash64(toUnixTimestamp64Milli(${startSql}), ${values}) AS rotation`;
}

/**
 * How many grouped rows, per row the cap keeps, are ranked for it: the
 * busiest this many times the cap (ties in the rotating order). Ranking
 * holds and sorts the rows it ranks in full, which is cheap for the rows of
 * any real project but not for millions of per-message groups no rule folds:
 * ranked in full, a million reply topics named per request took 1.49 GiB at
 * 32 threads, and four million took the query past its memory limit at
 * four. So the grouped rows reach the ranking through a top-N heap of this
 * size (ORDER BY … LIMIT), with which those finished at 1.0 GiB and
 * 1.25 GiB. That heap cuts by count alone, so a share is crowded out only
 * where other shares hold more than this many times the cap of busier
 * groups (100,000 for the cron's caps); its own memory is small beside the
 * grouping's (one a fifth its size saved 10 MiB of the million groups'
 * 1.0 GiB).
 */
export const MESSAGE_QUEUE_RANKED_ROWS_PER_CAPPED_ROW: number = 50;

function rotatingShareOrderSql(data: {
  // The grouped rows, each with its `rotation` (rotationSql).
  groupedSql: string;
  // The columns the query returns, in order.
  columns: string;
  // What a share is, as SQL over the grouped columns.
  shareSql: string;
  // The grouped count the busiest ranking reads.
  countColumn: string;
  maxRows: number;
}): string {
  const cap: number = rowCap(data.maxRows);
  return `SELECT ${data.columns}
    FROM (
      SELECT
        *,
        row_number() OVER (PARTITION BY ${data.shareSql} ORDER BY ${data.countColumn} DESC, rotation) AS busiestRank,
        row_number() OVER (PARTITION BY ${data.shareSql} ORDER BY rotation) AS rotationRank
      FROM (${data.groupedSql}
        ORDER BY ${data.countColumn} DESC, rotation
        LIMIT ${cap * MESSAGE_QUEUE_RANKED_ROWS_PER_CAPPED_ROW}
      )
    )
    ORDER BY least(2 * busiestRank - 1, 2 * rotationRank), ${data.countColumn} DESC, rotation
    LIMIT ${cap}`;
}

// The span query's share: the stored `messaging.system` column.
const SPAN_SHARE_COLUMN: string = getMessagingDiscoveryColumn(
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES.indexOf(MESSAGING_SYSTEM_ATTRIBUTE),
);

/*
 * ---- The queue queries' settings ---------------------------------------------
 *
 * The cron reads each queue query through the App's ClickHouse client, which
 * gives up on a request that has sent it nothing for its request_timeout
 * (ClickhouseConfig: 58 s, an idle-socket timer), and a grouped query in
 * FORMAT JSON sends nothing until it is done. QUERY_SETTINGS' own limit is
 * 60 s, so a query still reading at 58 s was cut off by the client
 * ("Timeout error.") while the server read on. The queue queries therefore
 * end on the server first, at MESSAGE_QUEUE_DISCOVERY_MAX_EXECUTION_SECONDS:
 * a window too big to read by then fails with ClickHouse's own
 * TIMEOUT_EXCEEDED, which the cron logs, and costs that run the project's
 * span (or metric) evidence. On ClickHouse 26.7 the error followed the
 * limit within 50 ms, mid-merge of a grouping spilled to disk too, well
 * inside the client's wait.
 *
 * They 'throw' rather than 'break': a break returns no rows at all. On
 * ClickHouse 26.7 a query broken off at its time limit answers with an
 * empty body — not the groups of the part of the window it read, whatever
 * the query's shape — which the client then fails to parse ("Unexpected end
 * of JSON input"). The real-ClickHouse suite holds both behaviours.
 *
 * Nothing pins the scan's threads: it runs as wide as the server lets it
 * (max_threads, the server's cores by default). Measured on ClickHouse 26.7
 * with 32 cores, four threads — the Logs aggregations' pin — took 14.8 s
 * over 10.8 million spans where 32 took 4.2 s, and ran out of time over
 * 40.8 million, which 32 read in 24 s. The price is memory, which grows
 * with the threads: about 25 MiB each over spans carrying about 35
 * attributes (0.8 GiB at 32 threads, 1.55 GiB at 64, of QUERY_SETTINGS'
 * 1.86 GiB limit), and with it the fewer groups that no rule folds can
 * spill to disk and merge back within the limit (see "Values that vary per
 * message").
 */
export const MESSAGE_QUEUE_DISCOVERY_MAX_EXECUTION_SECONDS: number = 45;

/*
 * A SETTINGS clause (`SETTINGS a = 1, b = 'x'`) with `overrides` in place of
 * the settings of the same name, or after them where it has none: each
 * setting named once.
 */
function withSettings(
  clause: string,
  overrides: ReadonlyArray<[string, string]>,
): string {
  const settings: Map<string, string> = new Map<string, string>();
  for (const setting of clause
    .trim()
    .replace(/^SETTINGS\s+/, "")
    .split(",")) {
    const equals: number = setting.indexOf("=");
    settings.set(
      setting.slice(0, equals).trim(),
      setting.slice(equals + 1).trim(),
    );
  }
  for (const [name, value] of overrides) {
    settings.set(name, value);
  }
  return `SETTINGS ${Array.from(settings.entries())
    .map((setting: [string, string]): string => {
      return `${setting[0]} = ${setting[1]}`;
    })
    .join(", ")}`;
}

/**
 * The SETTINGS clause every queue query ends with: QUERY_SETTINGS' memory
 * limit and spills to disk, and a time limit of its own,
 * MESSAGE_QUEUE_DISCOVERY_MAX_EXECUTION_SECONDS, at which it fails ('throw').
 */
export const MESSAGE_QUEUE_DISCOVERY_QUERY_SETTINGS: string = withSettings(
  QUERY_SETTINGS,
  [
    [
      "max_execution_time",
      String(MESSAGE_QUEUE_DISCOVERY_MAX_EXECUTION_SECONDS),
    ],
    ["timeout_overflow_mode", "'throw'"],
  ],
);

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
 * reads — folded where the resolver reads no more than a placeholder, see
 * "Values that vary per message") over the window's messaging spans, with
 * how many spans, how many of them failed and when the newest started;
 * under the row cap, each broker's busiest and a rotating share of the rest
 * (rotatingShareOrderSql). Spans are dropped on their kind (a stored SERVER
 * span never names a queue; every other kind, a remapped or missing one
 * included, may) and on `attributeKeys` (bloom-indexed, far smaller than
 * the attribute map) before the map is read: a span carries a messaging
 * trigger key, and one whose only trigger is an Azure provider key names
 * Service Bus or Event Hubs there. Then the spans the resolver certainly
 * names no queue for are dropped too (rule 1).
 */
export function buildMessagingSpanDiscoverySql(
  window: MessageQueueDiscoveryWindow,
): string {
  const columns: string = attributeColumnNames(
    MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  );
  return `
    /* ${MESSAGE_QUEUE_SPAN_SQL_MARKER} */
    ${rotatingShareOrderSql({
      groupedSql: `
        WITH
          ${spanAliasesSql()}
        SELECT
          kind,
          ${spanAttributeColumnsSql()},
          count() AS spanCount,
          countIf(statusCode = ${SpanStatus.Error}) AS errorCount,
          toUnixTimestamp64Milli(max(startTime)) AS lastSeenUnixMs,
          ${rotationSql(window.startSql, `ifNull(kind, ''), ${columns}`)}
        FROM ${SPAN_TABLE}
        WHERE projectId = '${escapeSql(window.projectId)}'
          AND startTime >= ${window.startSql}
          AND startTime < ${window.endSql}
          AND ${spanKindSql()}
          AND hasAny(attributeKeys, ${sqlArray(MESSAGING_TRIGGER_ATTRIBUTES)})
          AND (${spanTriggerSql()})
          AND NOT (${certainlyNoQueueSql()})
        GROUP BY kind, ${columns}`,
      columns: `kind, ${columns}, spanCount, errorCount, lastSeenUnixMs`,
      shareSql: SPAN_SHARE_COLUMN,
      countColumn: "spanCount",
      maxRows: window.maxRows,
    })}
    ${MESSAGE_QUEUE_DISCOVERY_QUERY_SETTINGS}
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
 * with how many datapoints and when the newest was taken; under the row
 * cap, each metric's busiest and a rotating share of the rest
 * (rotatingShareOrderSql), so a busy scrape never crowds out a cloud
 * provider's metrics. The keys that only mark a curated metric's
 * per-consumer repeat (MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES:
 * Pulsar's consumer name and id) are neither selected nor filtered on: they
 * are per instance, so grouping on them would split a topic's rows per
 * consumer, and a repeat folds into its subscription's own series of the
 * same topic, which names the same queue.
 */
export function buildMessagingMetricDiscoverySql(
  window: MessageQueueDiscoveryWindow,
): string {
  const columns: string = attributeColumnNames(
    MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
  );
  return `
    /* ${MESSAGE_QUEUE_METRIC_SQL_MARKER} */
    ${rotatingShareOrderSql({
      groupedSql: `
        SELECT
          name,
          ${attributeColumnsSql(MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES)},
          count() AS pointCount,
          toUnixTimestamp64Milli(max(time)) AS lastSeenUnixMs,
          ${rotationSql(window.startSql, `name, ${columns}`)}
        FROM ${METRIC_TABLE}
        WHERE projectId = '${escapeSql(window.projectId)}'
          AND name IN ${sqlTuple(MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES)}
          AND ${metricWindowSql(window)}
        GROUP BY name, ${columns}`,
      columns: `name, ${columns}, pointCount, lastSeenUnixMs`,
      shareSql: "name",
      countColumn: "pointCount",
      maxRows: window.maxRows,
    })}
    ${MESSAGE_QUEUE_DISCOVERY_QUERY_SETTINGS}
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
    ${MESSAGE_QUEUE_DISCOVERY_QUERY_SETTINGS}
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
