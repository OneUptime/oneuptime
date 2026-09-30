/*
 * The messaging systems (brokers) the Queues product knows, and everything
 * that has to agree about them. This is the single source of truth for:
 *
 *   - normalizing `messaging.system` values — the spellings instrumentations
 *     really send across five generations of the still-unstable messaging
 *     semantic conventions (`AmazonSQS`, `aws.sqs`, `azure_servicebus`, …) —
 *     to one value per system
 *   - the system's display name
 *   - whether a queue's identity carries its broker's Azure namespace (two
 *     Service Bus namespaces can each hold a queue called "orders")
 *   - where the broker's own health metrics come from: a collector-contrib
 *     receiver, a Prometheus endpoint, a cloud provider's monitoring API, an
 *     exporter outside the collector, or nothing ready-made
 *   - the heading anchor of the system's section in /docs/telemetry/queues
 *
 * The `system` values are the semconv `messaging.system` well-known values
 * where semconv defines one (activemq, aws.sns, aws_sqs, eventgrid,
 * eventhubs, servicebus, gcp_pubsub, jms, kafka, rabbitmq, rocketmq, pulsar
 * — note the mixed separators: `aws.sns` has a dot, `aws_sqs` an
 * underscore), and the value instrumentations actually emit otherwise
 * (`nats` from the Java agent, `bullmq` from BullMQ and OneUptime's own
 * workers). A well-formed value nothing here knows (`ibmmq`, `solace`,
 * `mqtt`) is kept as it came, so a long-tail broker still gets queues.
 * Pure and isomorphic: no server imports, nothing here throws.
 */

/*
 * What, besides the destination name, a queue's identity carries:
 *
 *   - "none": the system and the destination are the identity. Two Kafka
 *     clusters with a topic called "orders" share one queue — a span rarely
 *     names its cluster (the Java agent, kafkajs and Confluent .NET emit no
 *     server address at all), so a cluster in the identity would split one
 *     topic into a queue per instrumentation instead.
 *   - "azure-namespace": the Azure Service Bus / Event Hubs namespace the
 *     entity lives in, which both sides name reliably: every Azure SDK puts
 *     the namespace's host (`<namespace>.servicebus.windows.net`) in the
 *     span, and Azure Monitor reports it as the metric's resource `name`.
 */
export type MessagingBrokerScope = "none" | "azure-namespace";

/*
 * Where a system's broker health metrics (backlog, lag, dead letters, …)
 * come from, for the docs, the in-app guidance and the curated metric
 * catalog (MessageQueueMetricCatalog: every entry's `receiver` is named
 * here). Every `note` / `reason` is a full sentence.
 */
export type MessagingBrokerMetricsSource =
  /*
   * A collector-contrib receiver, by the component name written under
   * `receivers:` in a collector config ("kafka_metrics", "rabbitmq").
   */
  | { kind: "receiver"; receiver: string; note: string }
  /*
   * The broker (or an exporter beside it) serves Prometheus metrics: scrape
   * them with the collector's `prometheus` receiver.
   */
  | {
      kind: "prometheus";
      exporter: string;
      port: number;
      path: string;
      note: string;
    }
  /*
   * A managed service: its provider's monitoring API has the metrics, read
   * by `receiver` (or one of `alternativeReceivers`).
   */
  | {
      kind: "cloud-monitoring";
      receiver: string;
      alternativeReceivers: ReadonlyArray<string>;
      note: string;
    }
  // A program outside the collector pushes the metrics over OTLP itself.
  | { kind: "external-scraper"; scraper: string; note: string }
  // No ready-made path; `reason` says what the options are.
  | { kind: "none"; reason: string };

export interface MessagingSystemDescriptor {
  // The canonical `messaging.system` value, lowercase.
  system: string;
  // "Apache Kafka".
  displayName: string;
  /*
   * Lowercased raw spellings that normalize to `system` (never `system`
   * itself): legacy semconv values and what instrumentations really send.
   */
  aliases: ReadonlyArray<string>;
  // One of the semconv registry's well-known `messaging.system` values.
  isSemconvValue: boolean;
  brokerScope: MessagingBrokerScope;
  brokerMetrics: MessagingBrokerMetricsSource;
  /*
   * The id of the system's heading in /docs/telemetry/queues: the docs
   * renderer's slug of `displayName` (Common/Server/Types/MarkdownSlugify),
   * so the section is headed by the display name.
   */
  docsAnchor: string;
  /*
   * The system a queue's IDENTITY is keyed on when it is not `system`
   * itself. Java applications reach ActiveMQ through the JMS API, and every
   * JMS span says "jms" whatever the broker (no instrumentation emits
   * "activemq"), while the broker's own metrics (the JMX Scraper) can only
   * say "activemq". Keying ActiveMQ on the JMS family puts both sightings of
   * one queue on one row; the row's system is then refined to the broker
   * the moment its metrics are seen (getMoreSpecificMessagingSystem) — the
   * way a database row's engine is refined from its family (DatabaseSystem).
   * Absent for a system that is its own family.
   */
  identityFamily?: string | undefined;
}

const AZURE_MONITOR_RECEIVER: string = "azure_monitor";

export const MESSAGING_SYSTEMS: ReadonlyArray<MessagingSystemDescriptor> = [
  {
    system: "kafka",
    displayName: "Apache Kafka",
    aliases: [],
    isSemconvValue: true,
    brokerScope: "none",
    brokerMetrics: {
      kind: "receiver",
      receiver: "kafka_metrics",
      note: "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.",
    },
    docsAnchor: "apache-kafka",
  },
  {
    system: "rabbitmq",
    displayName: "RabbitMQ",
    aliases: [],
    isSemconvValue: true,
    brokerScope: "none",
    brokerMetrics: {
      kind: "receiver",
      receiver: "rabbitmq",
      note: "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring`.",
    },
    docsAnchor: "rabbitmq",
  },
  {
    system: "activemq",
    displayName: "Apache ActiveMQ",
    // ActiveMQ Artemis, as some instrumentations and users spell it.
    aliases: ["artemis", "activemq_artemis"],
    isSemconvValue: true,
    brokerScope: "none",
    brokerMetrics: {
      kind: "external-scraper",
      scraper: "OpenTelemetry JMX Scraper",
      note: "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.",
    },
    docsAnchor: "apache-activemq",
    // Its Java clients' spans say "jms" (see identityFamily).
    identityFamily: "jms",
  },
  {
    system: "jms",
    displayName: "JMS",
    aliases: [],
    isSemconvValue: true,
    brokerScope: "none",
    /*
     * Java clients report "jms" whatever the broker, and no instrumentation
     * emits "activemq". ActiveMQ is keyed on the JMS family (see
     * identityFamily), so its JMX Scraper metrics join the JMS spans of the
     * same queue and turn that queue into an ActiveMQ one; any other broker
     * behind JMS has no ready-made path.
     */
    brokerMetrics: {
      kind: "none",
      reason:
        "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.",
    },
    docsAnchor: "jms",
  },
  {
    system: "aws_sqs",
    displayName: "Amazon SQS",
    /*
     * `AmazonSQS`: semconv 1.16 and earlier, the Java agent up to 2.3.0 and
     * Go otelaws up to 0.61.0. `aws.sqs`: JS aws-sdk up to 0.57.0, Python
     * boto3sqs and botocore today.
     */
    aliases: ["aws.sqs", "amazonsqs", "sqs"],
    isSemconvValue: true,
    brokerScope: "none",
    brokerMetrics: {
      kind: "cloud-monitoring",
      receiver: "aws_cloudwatch",
      alternativeReceivers: ["awsfirehose"],
      note: "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.",
    },
    docsAnchor: "amazon-sqs",
  },
  {
    system: "aws.sns",
    displayName: "Amazon SNS",
    // `aws_sns`: Go otelaws, which does not follow the spec's dot here.
    aliases: ["aws_sns", "amazonsns", "sns"],
    isSemconvValue: true,
    brokerScope: "none",
    brokerMetrics: {
      kind: "cloud-monitoring",
      receiver: "aws_cloudwatch",
      alternativeReceivers: ["awsfirehose"],
      note: "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.",
    },
    docsAnchor: "amazon-sns",
  },
  {
    system: "gcp_pubsub",
    displayName: "Google Cloud Pub/Sub",
    aliases: ["gcp.pubsub", "pubsub", "google_pubsub"],
    isSemconvValue: true,
    brokerScope: "none",
    brokerMetrics: {
      kind: "cloud-monitoring",
      receiver: "googlecloudmonitoring",
      alternativeReceivers: [],
      note: "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.",
    },
    docsAnchor: "google-cloud-pubsub",
  },
  {
    system: "servicebus",
    displayName: "Azure Service Bus",
    /*
     * `azure_servicebus`: the semconv 1.24.0 value, renamed in 1.25.0.
     * `microsoft.servicebus`: the Azure resource provider namespace the SDKs
     * put in `az.namespace`.
     */
    aliases: ["azure_servicebus", "azure.servicebus", "microsoft.servicebus"],
    isSemconvValue: true,
    brokerScope: "azure-namespace",
    brokerMetrics: {
      kind: "cloud-monitoring",
      receiver: AZURE_MONITOR_RECEIVER,
      alternativeReceivers: [],
      note: "Read the namespace's metrics from Azure Monitor with the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.",
    },
    docsAnchor: "azure-service-bus",
  },
  {
    system: "eventhubs",
    displayName: "Azure Event Hubs",
    aliases: ["azure_eventhubs", "azure.eventhubs", "microsoft.eventhub"],
    isSemconvValue: true,
    brokerScope: "azure-namespace",
    brokerMetrics: {
      kind: "cloud-monitoring",
      receiver: AZURE_MONITOR_RECEIVER,
      alternativeReceivers: [],
      note: "Read the namespace's metrics from Azure Monitor with the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.",
    },
    docsAnchor: "azure-event-hubs",
  },
  {
    system: "eventgrid",
    displayName: "Azure Event Grid",
    aliases: ["azure_eventgrid", "azure.eventgrid", "microsoft.eventgrid"],
    isSemconvValue: true,
    brokerScope: "none",
    brokerMetrics: {
      kind: "cloud-monitoring",
      receiver: AZURE_MONITOR_RECEIVER,
      alternativeReceivers: [],
      note: "Read the topics' metrics from Azure Monitor with the collector's `azure_monitor` receiver.",
    },
    docsAnchor: "azure-event-grid",
  },
  {
    system: "pulsar",
    displayName: "Apache Pulsar",
    aliases: ["apache_pulsar"],
    isSemconvValue: true,
    brokerScope: "none",
    brokerMetrics: {
      kind: "prometheus",
      exporter: "Pulsar broker",
      port: 8080,
      path: "/metrics/",
      note: "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.",
    },
    docsAnchor: "apache-pulsar",
  },
  {
    system: "rocketmq",
    displayName: "Apache RocketMQ",
    aliases: [],
    isSemconvValue: true,
    brokerScope: "none",
    brokerMetrics: {
      kind: "prometheus",
      exporter: "RocketMQ broker",
      port: 5557,
      path: "/metrics",
      note: "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.",
    },
    docsAnchor: "apache-rocketmq",
  },
  {
    system: "nats",
    displayName: "NATS",
    aliases: ["jetstream"],
    isSemconvValue: false,
    brokerScope: "none",
    brokerMetrics: {
      kind: "prometheus",
      exporter: "prometheus-nats-exporter",
      port: 7777,
      path: "/metrics",
      note: "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.",
    },
    docsAnchor: "nats",
  },
  {
    system: "bullmq",
    displayName: "BullMQ",
    aliases: [],
    isSemconvValue: false,
    brokerScope: "none",
    brokerMetrics: {
      kind: "none",
      reason:
        "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.",
    },
    docsAnchor: "bullmq",
  },
];

/*
 * `messaging.system` values that never name a broker. Spring Integration's
 * channels (Java agent, opt-in) are in-process method calls: a "queue" for
 * each would be noise.
 */
const EXCLUDED_MESSAGING_SYSTEMS: ReadonlySet<string> = new Set<string>([
  "spring_integration",
]);

/*
 * A value an unknown system may keep: lowercase letters and digits, then
 * `.`, `_` or `-`, at most 64 characters — the shape of every value above.
 * Anything else (spaces, slashes, a URL, a sentence) is not a system name.
 */
const WELL_FORMED_SYSTEM_PATTERN: RegExp = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// raw (system or alias) → descriptor. A Map, so "constructor" finds nothing.
const DESCRIPTOR_BY_NAME: ReadonlyMap<string, MessagingSystemDescriptor> =
  ((): Map<string, MessagingSystemDescriptor> => {
    const map: Map<string, MessagingSystemDescriptor> = new Map<
      string,
      MessagingSystemDescriptor
    >();
    for (const descriptor of MESSAGING_SYSTEMS) {
      map.set(descriptor.system, descriptor);
      for (const alias of descriptor.aliases) {
        map.set(alias, descriptor);
      }
    }
    return map;
  })();

function canonicalRaw(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim().toLowerCase();
}

/**
 * Whether a raw `messaging.system` value deliberately names no broker
 * (`spring_integration`): a span carrying it is not a queue's, whatever else
 * it says. Trimmed and case-insensitive.
 */
export function isExcludedMessagingSystem(raw: unknown): boolean {
  return EXCLUDED_MESSAGING_SYSTEMS.has(canonicalRaw(raw));
}

/**
 * Normalize a raw `messaging.system` value: trimmed and lowercased, a known
 * alias mapped to its system ("AmazonSQS" → "aws_sqs", "azure_servicebus" →
 * "servicebus"), and an unknown but well-formed value kept as it came
 * ("ibmmq"), so a long-tail broker still displays and groups. Null for an
 * excluded value (`spring_integration`), an empty or non-string value, and
 * one that cannot be a system name (see WELL_FORMED_SYSTEM_PATTERN).
 */
export function normalizeMessagingSystem(raw: unknown): string | null {
  const canonical: string = canonicalRaw(raw);
  if (!canonical || EXCLUDED_MESSAGING_SYSTEMS.has(canonical)) {
    return null;
  }
  const descriptor: MessagingSystemDescriptor | undefined =
    DESCRIPTOR_BY_NAME.get(canonical);
  if (descriptor) {
    return descriptor.system;
  }
  return WELL_FORMED_SYSTEM_PATTERN.test(canonical) ? canonical : null;
}

/** The system's descriptor (aliases accepted), or null for an unknown one. */
export function getMessagingSystemDescriptor(
  system: unknown,
): MessagingSystemDescriptor | null {
  return DESCRIPTOR_BY_NAME.get(canonicalRaw(system)) || null;
}

export function isKnownMessagingSystem(system: unknown): boolean {
  return getMessagingSystemDescriptor(system) !== null;
}

/**
 * "Apache Kafka" for a known system (aliases accepted), the trimmed raw
 * value for an unknown one, and "" when there is nothing to show.
 */
export function getMessagingSystemDisplayName(system: unknown): string {
  const descriptor: MessagingSystemDescriptor | null =
    getMessagingSystemDescriptor(system);
  if (descriptor) {
    return descriptor.displayName;
  }
  return typeof system === "string" ? system.trim() : "";
}

/**
 * What a queue's identity carries besides its destination (aliases
 * accepted); "none" for an unknown system.
 */
export function getMessagingBrokerScope(system: unknown): MessagingBrokerScope {
  const descriptor: MessagingSystemDescriptor | null =
    getMessagingSystemDescriptor(system);
  return descriptor ? descriptor.brokerScope : "none";
}

/**
 * The canonical system a queue's identity is keyed on: the system's
 * identityFamily when it has one ("activemq" → "jms"), else the normalized
 * system itself. Null for anything normalizeMessagingSystem rejects.
 */
export function getMessagingIdentitySystem(system: unknown): string | null {
  const normalized: string | null = normalizeMessagingSystem(system);
  if (!normalized) {
    return null;
  }
  const descriptor: MessagingSystemDescriptor | undefined =
    DESCRIPTOR_BY_NAME.get(normalized);
  return descriptor?.identityFamily || normalized;
}

/**
 * The system a queue row should show once `candidate` has been seen on it
 * as well as `current`: the more specific member of one identity family
 * ("activemq" over "jms", never the reverse), else `current` unchanged — a
 * sighting never moves a row to another family. Both are normalized; null
 * only when neither is a system.
 */
export function getMoreSpecificMessagingSystem(
  current: unknown,
  candidate: unknown,
): string | null {
  const currentSystem: string | null = normalizeMessagingSystem(current);
  const candidateSystem: string | null = normalizeMessagingSystem(candidate);
  if (!currentSystem) {
    return candidateSystem;
  }
  if (!candidateSystem || candidateSystem === currentSystem) {
    return currentSystem;
  }
  const candidateDescriptor: MessagingSystemDescriptor | undefined =
    DESCRIPTOR_BY_NAME.get(candidateSystem);
  return candidateDescriptor?.identityFamily === currentSystem
    ? candidateSystem
    : currentSystem;
}

/**
 * Where a system's broker metrics come from (aliases accepted). An unknown
 * system has no known path — `none`, with a reason that says what to do.
 */
export function getMessagingBrokerMetricsSource(
  system: unknown,
): MessagingBrokerMetricsSource {
  const descriptor: MessagingSystemDescriptor | null =
    getMessagingSystemDescriptor(system);
  if (descriptor) {
    return descriptor.brokerMetrics;
  }
  return {
    kind: "none",
    reason:
      "OneUptime does not know this messaging system, so it has no ready-made way to read the broker's metrics; send them with `messaging.system` and `messaging.destination.name` on each datapoint and they attach to the queue.",
  };
}

/**
 * The components that emit a source's metrics, as a curated metric's
 * `receiver` names them: the receiver, `prometheus` for a scrape, the cloud
 * receiver and its alternatives, the external scraper — none for `none`.
 */
export function getMessagingBrokerMetricsReceivers(
  source: MessagingBrokerMetricsSource,
): ReadonlyArray<string> {
  switch (source.kind) {
    case "receiver":
      return [source.receiver];
    case "prometheus":
      return ["prometheus"];
    case "cloud-monitoring":
      return [source.receiver, ...source.alternativeReceivers];
    case "external-scraper":
      return [source.scraper];
    default:
      return [];
  }
}
