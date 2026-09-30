import {
  canBrokerMetricsReachMessageQueue,
  getMessageQueueSystemLabel,
  isNamespaceScopedMessagingSystem,
} from "./MessageQueuePresentation";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import {
  MESSAGING_SYSTEMS,
  MessagingBrokerMetricsSource,
  MessagingSystemDescriptor,
  getMessagingBrokerMetricsReceivers,
  getMessagingBrokerMetricsSource,
  getMessagingIdentitySystem,
  getMessagingSystemDescriptor,
  normalizeMessagingSystem,
} from "Common/Types/MessageQueue/MessagingSystem";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import { DocVars } from "../../../Components/TelemetryResource/documentationMarkdown";

/*
 * The in-app setup guide of the Queues product: the product Documentation
 * page and the empty list (a messaging-system picker), and every queue's own
 * Documentation tab (prefilled for that queue).
 *
 * Everything system-specific comes from the catalog
 * (Common/Types/MessageQueue): the display name, the accepted
 * `messaging.system` spellings, where the broker's health metrics come from
 * (MessagingBrokerMetricsSource: receiver, Prometheus endpoint, cloud
 * monitoring API, external scraper or none), the port and path of a
 * Prometheus endpoint, the metrics a queue page charts
 * (MessageQueueMetricCatalog) and the heading anchor of the system's section
 * in /docs/telemetry/queues.
 *
 * The collector configurations are the ones /docs/telemetry/queues ships —
 * each validated with `otelcol-contrib validate` on
 * otel/opentelemetry-collector-contrib 0.161.0 — with the viewer's OneUptime
 * URL and ingestion key in the `otlphttp` exporter.
 * MessageQueueDocumentationMarkdown.test parses every YAML block this module
 * emits and holds each system's config equal to the docs page's, so the two
 * cannot drift.
 *
 * A queue's guide also says how its telemetry finds it (the identity:
 * system, destination and, for Service Bus / Event Hubs, the namespace) and
 * fills in what the queue's own telemetry already told OneUptime: a Kafka
 * bootstrap broker, the RabbitMQ or ActiveMQ host, the AWS region of an SQS
 * or SNS endpoint, the BullMQ queue name.
 *
 * What the guide shares with the other Queues pages is theirs, not copied
 * here (MessageQueuePresentation): the system's name as the list shows it
 * (getMessageQueueSystemLabel), and whether the broker's own metrics can
 * reach the queues it is about (canBrokerMetricsReachMessageQueue) — the
 * rule the Overview's Broker health section follows, so the guide never
 * promises metrics that section says cannot arrive.
 *
 * Pure: plain values in, markdown out. No React, no API.
 */

export const MESSAGE_QUEUE_DOCS_PATH: string = "/docs/telemetry/queues";

// The docs page's "## Supported messaging systems" heading, as the renderer slugs it.
export const MESSAGE_QUEUE_SUPPORTED_SYSTEMS_ANCHOR: string =
  "supported-messaging-systems";

/**
 * The docs section for a system — `/docs/telemetry/queues#apache-kafka` —
 * or the supported-systems table for one the catalog does not know.
 */
export function getMessageQueueDocsUrl(system?: unknown): string {
  const descriptor: MessagingSystemDescriptor | null =
    getMessagingSystemDescriptor(system);
  return `${MESSAGE_QUEUE_DOCS_PATH}#${
    descriptor ? descriptor.docsAnchor : MESSAGE_QUEUE_SUPPORTED_SYSTEMS_ANCHOR
  }`;
}

/** What a queue's Documentation tab knows about the queue. */
export interface MessageQueueDocumentationTarget {
  // The row's messagingSystem: the SPECIFIC system ("activemq", not "jms").
  system: string | null | undefined;
  // The row's destinationName, as applications spell it.
  destination?: string | null | undefined;
  // The Azure namespace (Service Bus / Event Hubs), "" or null otherwise.
  brokerScope?: string | null | undefined;
  // The broker address the queue's telemetry last reported (display only).
  brokerAddress?: string | null | undefined;
}

// ---- small markdown / YAML helpers ------------------------------------------

/*
 * A JSON string is a valid YAML double-quoted scalar, a valid JavaScript
 * string literal and — for the values quoted here — a valid shell word, so
 * everything that comes from data (a URL, a key, a host, a queue name) is
 * quoted this way and can never break the block it is pasted into.
 */
function quoted(value: string): string {
  return JSON.stringify(value);
}

/*
 * Inline code for any text: CommonMark closes a code span at the first run
 * of backticks as long as its opener, so the fence is one backtick longer
 * than the longest run inside, padded when the text starts or ends with one.
 */
export function markdownInlineCode(value: string): string {
  let longestRun: number = 0;
  let run: number = 0;
  for (const character of value) {
    run = character === "`" ? run + 1 : 0;
    longestRun = Math.max(longestRun, run);
  }
  const fence: string = "`".repeat(longestRun + 1);
  const padding: string =
    value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${padding}${value}${padding}${fence}`;
}

function codeBlock(language: string, lines: Array<string>): string {
  return ["```" + language, ...lines, "```"].join("\n");
}

function joinWithOr(values: ReadonlyArray<string>): string {
  if (values.length <= 1) {
    return values.join("");
  }
  return `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

// ---- what the queue's telemetry told us --------------------------------------

export interface MessageQueueBrokerHost {
  host: string;
  port: number | null;
}

/*
 * A host name or IPv4 address with an optional port — what the resolver
 * stores as a queue's broker address (host[:port], credentials stripped).
 * Anything else (an IPv6 literal, a list, a URL) is not prefilled: the guide
 * keeps its placeholder rather than paste something that might not parse.
 */
const BROKER_ADDRESS_PATTERN: RegExp =
  /^([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(?::(\d{1,5}))?$/;

/** The host (and port) of a queue's broker address, or null. */
export function parseMessageQueueBrokerAddress(
  address: string | null | undefined,
): MessageQueueBrokerHost | null {
  const match: RegExpExecArray | null = BROKER_ADDRESS_PATTERN.exec(
    (address || "").trim(),
  );
  if (!match) {
    return null;
  }
  const port: number | null = match[2] ? Number(match[2]) : null;
  if (port !== null && (port < 1 || port > 65535)) {
    return null;
  }
  return { host: match[1]!, port };
}

/*
 * The region of an SQS or SNS endpoint — `sqs.us-east-1.amazonaws.com`,
 * `sns.eu-west-2.amazonaws.com`, a FIPS or China endpoint — which is where
 * the Java agent's spans point `server.address`, and the host of the queue
 * URL Go's otelaws reports.
 */
const AWS_ENDPOINT_REGION_PATTERN: RegExp =
  /^(?:sqs|sns)(?:-fips)?\.([a-z]{2}(?:-[a-z]+)+-\d+)\.amazonaws\.com(?:\.cn)?$/i;

/** The AWS region a queue's SQS / SNS broker address names, or null. */
export function getAwsRegionFromBrokerAddress(
  address: string | null | undefined,
): string | null {
  const parsed: MessageQueueBrokerHost | null =
    parseMessageQueueBrokerAddress(address);
  if (!parsed) {
    return null;
  }
  const match: RegExpExecArray | null = AWS_ENDPOINT_REGION_PATTERN.exec(
    parsed.host,
  );
  return match ? match[1]!.toLowerCase() : null;
}

// ---- guide context -----------------------------------------------------------

interface QueueContext {
  destination: string;
  brokerScope: string;
  brokerAddress: string;
  broker: MessageQueueBrokerHost | null;
}

interface GuideContext {
  vars: DocVars;
  // The canonical system, or the raw value of one the catalog does not know.
  system: string;
  descriptor: MessagingSystemDescriptor | null;
  /*
   * The system as the queue list's System cell names it
   * (getMessageQueueSystemLabel): "—" for a queue without one, as the
   * Documentation tab's own title says.
   */
  displayName: string;
  source: MessagingBrokerMetricsSource;
  queue: QueueContext | null;
}

function buildContext(
  vars: DocVars,
  systemInput: string | null | undefined,
  queue: QueueContext | null,
): GuideContext {
  const raw: string = (systemInput || "").toString().trim();
  const system: string = normalizeMessagingSystem(raw) || raw.toLowerCase();
  const descriptor: MessagingSystemDescriptor | null =
    getMessagingSystemDescriptor(system);
  return {
    vars,
    system,
    descriptor,
    displayName: getMessageQueueSystemLabel(system),
    source: getMessagingBrokerMetricsSource(system),
    queue,
  };
}

// ---- collector configuration pieces ------------------------------------------

function exporterLines(vars: DocVars): Array<string> {
  return [
    "exporters:",
    "  otlphttp:",
    `    endpoint: ${quoted(`${vars.oneuptimeUrl}/otlp`)}`,
    "    headers:",
    `      x-oneuptime-token: ${quoted(vars.apiKey)}`,
  ];
}

/*
 * A metrics-only collector config: optional extensions, the receivers, a
 * batch processor, the OneUptime exporter and the pipeline — the shape of
 * every broker config on the docs page.
 */
function metricsCollectorConfig(data: {
  vars: DocVars;
  extensionLines?: Array<string> | undefined;
  extensions?: Array<string> | undefined;
  receiverLines: Array<string>;
  receivers: Array<string>;
}): string {
  const lines: Array<string> = [];
  if (data.extensionLines) {
    lines.push(...data.extensionLines, "");
  }
  lines.push(
    ...data.receiverLines,
    "",
    "processors:",
    "  batch: {}",
    "",
    ...exporterLines(data.vars),
    "",
    "service:",
  );
  if (data.extensions && data.extensions.length > 0) {
    lines.push(`  extensions: [${data.extensions.join(", ")}]`);
  }
  lines.push(
    "  pipelines:",
    "    metrics:",
    `      receivers: [${data.receivers.join(", ")}]`,
    "      processors: [batch]",
    "      exporters: [otlphttp]",
  );
  return codeBlock("yaml", lines);
}

function prometheusScrapeLines(data: {
  jobName: string;
  path: string;
  targets: Array<string>;
  targetsComment?: string | undefined;
  keepRegex?: string | undefined;
}): Array<string> {
  const lines: Array<string> = [
    "receivers:",
    "  prometheus:",
    "    config:",
    "      scrape_configs:",
    `        - job_name: ${data.jobName}`,
    "          scrape_interval: 30s",
    `          metrics_path: ${data.path}`,
  ];
  if (data.targetsComment) {
    lines.push(`          # ${data.targetsComment}`);
  }
  lines.push(
    "          static_configs:",
    `            - targets: [${data.targets.map(quoted).join(", ")}]`,
  );
  if (data.keepRegex) {
    lines.push(
      "          # Keeps the families the queue page charts; remove it to keep all.",
      "          metric_relabel_configs:",
      "            - source_labels: [__name__]",
      `              regex: ${quoted(data.keepRegex)}`,
      "              action: keep",
    );
  }
  return lines;
}

const AZURE_AUTH_EXTENSION_LINES: Array<string> = [
  "extensions:",
  "  azure_auth:",
  "    service_principal:",
  "      tenant_id: ${env:AZURE_TENANT_ID}",
  "      client_id: ${env:AZURE_CLIENT_ID}",
  "      client_secret: ${env:AZURE_CLIENT_SECRET}",
];

const AZURE_MONITOR_READER_NOTE: string =
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.";

/*
 * The metrics each Azure Monitor config collects, by the names and
 * aggregations Azure Monitor uses. The receiver stores them as
 * `azure_<name>_<aggregation>`, lowercased — the names the catalog charts;
 * the documentation test checks every charted metric is collected here.
 */
const AZURE_MONITOR_METRICS: ReadonlyMap<
  string,
  ReadonlyArray<[string, string]>
> = new Map<string, ReadonlyArray<[string, string]>>([
  [
    "servicebus",
    [
      ["ActiveMessages", "Average"],
      ["DeadletteredMessages", "Average"],
      ["IncomingMessages", "Total"],
      ["OutgoingMessages", "Total"],
      ["CompleteMessage", "Total"],
      ["AbandonMessage", "Total"],
      ["ServerErrors", "Total"],
      ["UserErrors", "Total"],
      ["ThrottledRequests", "Total"],
    ],
  ],
  [
    "eventhubs",
    [
      ["IncomingMessages", "Total"],
      ["OutgoingMessages", "Total"],
      ["ServerErrors", "Total"],
      ["UserErrors", "Total"],
      ["QuotaExceededErrors", "Total"],
      ["ThrottledRequests", "Total"],
    ],
  ],
]);

/**
 * The Azure Monitor metric names (`azure_<name>_<aggregation>`, lowercased,
 * as the collector's azure_monitor receiver stores them) the guide's config
 * for a system collects. Empty for a system the guide has no metrics list
 * for.
 */
export function getAzureMonitorCollectedMetricNames(
  system: string,
): Array<string> {
  return (AZURE_MONITOR_METRICS.get(system) || []).map(
    ([name, aggregation]: [string, string]): string => {
      return `azure_${name}_${aggregation}`.toLowerCase();
    },
  );
}

function azureMonitorConfig(context: GuideContext): string {
  const receiverId: string = `azure_monitor/${context.system}`;
  const receiverLines: Array<string> = [
    "receivers:",
    `  ${receiverId}:`,
    '    subscription_ids: ["${env:AZURE_SUBSCRIPTION_ID}"]',
    "    auth:",
    "      authenticator: azure_auth",
    "    collection_interval: 60s",
  ];

  if (context.system === "eventgrid") {
    receiverLines.push(
      "    services:",
      "      - Microsoft.EventGrid/topics",
      "      - Microsoft.EventGrid/systemTopics",
      "      - Microsoft.EventGrid/domains",
      "    maximum_number_of_records_per_resource: 1000",
    );
  } else {
    const resourceType: string =
      context.system === "eventhubs"
        ? "Microsoft.EventHub/namespaces"
        : "Microsoft.ServiceBus/namespaces";
    receiverLines.push(`    services: [${resourceType}]`);
    if (context.system === "servicebus") {
      receiverLines.push(
        "    # Series Azure returns per metric and namespace (default 10): keep it",
        "    # above your number of queues and topics.",
      );
    }
    receiverLines.push(
      "    maximum_number_of_records_per_resource: 1000",
      "    metrics:",
      `      ${quoted(resourceType)}:`,
    );
    for (const [name, aggregation] of AZURE_MONITOR_METRICS.get(
      context.system,
    ) || []) {
      receiverLines.push(`        ${name}: [${aggregation}]`);
    }
  }

  return metricsCollectorConfig({
    vars: context.vars,
    extensionLines: AZURE_AUTH_EXTENSION_LINES,
    extensions: ["azure_auth"],
    receiverLines,
    receivers: [receiverId],
  });
}

function awsCloudWatchConfig(context: GuideContext, region: string): string {
  const isSqs: boolean = context.system === "aws_sqs";
  const receiverId: string = `aws_cloudwatch/${isSqs ? "sqs" : "sns"}`;
  return metricsCollectorConfig({
    vars: context.vars,
    receiverLines: [
      "receivers:",
      `  ${receiverId}:`,
      `    region: ${region}`,
      "    metrics:",
      "      collection_interval: 5m",
      "      period: 1m",
      "      delay: 10m",
      "      discovery:",
      "        filters:",
      `          namespace: ${isSqs ? "AWS/SQS" : "AWS/SNS"}`,
      ...(isSqs
        ? ["        # Metrics per scrape: about nine per queue. Must be set."]
        : []),
      "        limit: 500",
    ],
    receivers: [receiverId],
  });
}

function googleCloudMonitoringConfig(context: GuideContext): string {
  return metricsCollectorConfig({
    vars: context.vars,
    receiverLines: [
      "receivers:",
      "  googlecloudmonitoring:",
      "    project_id: my-gcp-project",
      "    collection_interval: 2m",
      "    # Only the metric types listed here are read.",
      "    metrics_list:",
      ...getMessageQueueMetricsForSystem(context.system).map(
        (descriptor: MessageQueueMetricDescriptor): string => {
          return `      - metric_name: ${descriptor.metricName}`;
        },
      ),
    ],
    receivers: ["googlecloudmonitoring"],
  });
}

function kafkaConfig(context: GuideContext, receiver: string): string {
  const broker: MessageQueueBrokerHost | null = context.queue?.broker || null;
  const brokers: Array<string> = broker
    ? [`${broker.host}:${broker.port ?? 9092}`]
    : ["kafka-1:9092", "kafka-2:9092"];
  return metricsCollectorConfig({
    vars: context.vars,
    receiverLines: [
      "receivers:",
      `  ${receiver}:`,
      `    brokers: [${brokers.map(quoted).join(", ")}]`,
      "    # topics: each partition's log-end offset; consumers: each group's",
      "    # committed offsets and lag. brokers: the broker count.",
      "    scrapers: [brokers, topics, consumers]",
      "    collection_interval: 30s",
      "    # auth:",
      "    #   sasl:",
      "    #     mechanism: SCRAM-SHA-512",
      "    #     username: ${env:KAFKA_USERNAME}",
      "    #     password: ${env:KAFKA_PASSWORD}",
      "    # tls:",
      "    #   ca_file: /etc/kafka/ca.pem",
    ],
    receivers: [receiver],
  });
}

function rabbitMqConfig(context: GuideContext, receiver: string): string {
  const broker: MessageQueueBrokerHost | null = context.queue?.broker || null;
  const endpoint: string = broker
    ? `http://${broker.host}:15672`
    : "http://rabbitmq:15672";
  return metricsCollectorConfig({
    vars: context.vars,
    receiverLines: [
      "receivers:",
      `  ${receiver}:`,
      `    endpoint: ${quoted(endpoint)}`,
      "    username: ${env:RABBITMQ_USERNAME}",
      "    password: ${env:RABBITMQ_PASSWORD}",
      "    collection_interval: 30s",
    ],
    receivers: [receiver],
  });
}

/*
 * The Prometheus scrape of one system's broker (or exporter), with the port
 * and path the catalog states. Pulsar keeps only the families the queue page
 * charts, derived from the catalog so a new curated metric is scraped too.
 */
function prometheusConfig(
  context: GuideContext,
  source: { port: number; path: string },
): string {
  let receiverLines: Array<string>;

  if (context.system === "pulsar") {
    const families: Array<string> = getMessageQueueMetricsForSystem("pulsar")
      .map((descriptor: MessageQueueMetricDescriptor): string => {
        return descriptor.metricName.replace(/^pulsar_/, "");
      })
      .filter((family: string, index: number, all: Array<string>): boolean => {
        return all.indexOf(family) === index;
      });
    receiverLines = prometheusScrapeLines({
      jobName: "pulsar-broker",
      path: source.path,
      targets: [
        `pulsar-broker-0:${source.port}`,
        `pulsar-broker-1:${source.port}`,
      ],
      targetsComment: "Every broker: each one reports only the topics it owns.",
      keepRegex: `pulsar_(${families.join("|")})`,
    });
  } else if (context.system === "rocketmq") {
    receiverLines = prometheusScrapeLines({
      jobName: "rocketmq-broker",
      path: source.path,
      targets: [
        `rocketmq-broker-a:${source.port}`,
        `rocketmq-broker-b:${source.port}`,
      ],
    });
  } else {
    receiverLines = prometheusScrapeLines({
      jobName: context.system === "nats" ? "nats" : `${context.system}-broker`,
      path: source.path,
      targets: [
        context.system === "nats"
          ? `nats-exporter:${source.port}`
          : `${context.system}-broker:${source.port}`,
      ],
    });
  }

  return metricsCollectorConfig({
    vars: context.vars,
    receiverLines,
    receivers: ["prometheus"],
  });
}

/*
 * The OpenTelemetry JMX Scraper beside an ActiveMQ Classic broker: JMX on
 * the broker, then the scraper, which pushes OTLP straight to OneUptime.
 */
function activeMqScraperSteps(context: GuideContext): Array<string> {
  const host: string = context.queue?.broker?.host || "activemq";
  return [
    "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.",
    "",
    codeBlock("bash", [
      `ACTIVEMQ_SUNJMX_START="-Dcom.sun.management.jmxremote.port=1099 -Dcom.sun.management.jmxremote.rmi.port=1099 -Dcom.sun.management.jmxremote.authenticate=false -Dcom.sun.management.jmxremote.ssl=false -Djava.rmi.server.hostname=${host}"`,
    ]),
    "",
    "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:",
    "",
    codeBlock("bash", [
      "curl -fsSLo opentelemetry-jmx-scraper.jar https://github.com/open-telemetry/opentelemetry-java-contrib/releases/latest/download/opentelemetry-jmx-scraper.jar",
      "",
      `export OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://${host}:1099/jmxrmi`,
      "export OTEL_JMX_TARGET_SYSTEM=activemq",
      "export OTEL_JMX_TARGET_SOURCE=instrumentation",
      "export OTEL_METRIC_EXPORT_INTERVAL=30000",
      "export OTEL_SERVICE_NAME=activemq-prod",
      "export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf",
      `export OTEL_EXPORTER_OTLP_ENDPOINT=${quoted(`${context.vars.oneuptimeUrl}/otlp`)}`,
      `export OTEL_EXPORTER_OTLP_HEADERS=${quoted(`x-oneuptime-token=${context.vars.apiKey}`)}`,
      "java -jar opentelemetry-jmx-scraper.jar",
    ]),
    "",
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.",
  ];
}

/*
 * BullMQ's own telemetry names the queue in `bullmq.queue.name` and sets no
 * `messaging.system`: a transform processor in the collector the
 * applications send to adds the two keys OneUptime reads.
 */
function bullMqTransformConfig(vars: DocVars): string {
  return codeBlock("yaml", [
    "receivers:",
    "  otlp:",
    "    protocols:",
    "      grpc:",
    "        endpoint: 0.0.0.0:4317",
    "      http:",
    "        endpoint: 0.0.0.0:4318",
    "",
    "processors:",
    "  # BullMQ names the queue in bullmq.queue.name and sets no",
    "  # messaging.system: copy it into the keys OneUptime reads, on the spans",
    "  # that publish (add) and process jobs, and on BullMQ's own metrics.",
    "  transform/bullmq:",
    "    error_mode: ignore",
    "    trace_statements:",
    '      - set(span.attributes["messaging.system"], "bullmq") where span.attributes["bullmq.queue.name"] != nil and span.attributes["messaging.system"] == nil and (span.kind == SPAN_KIND_PRODUCER or span.kind == SPAN_KIND_CONSUMER)',
    '      - set(span.attributes["messaging.destination.name"], span.attributes["bullmq.queue.name"]) where span.attributes["messaging.system"] == "bullmq" and span.attributes["messaging.destination.name"] == nil',
    "    metric_statements:",
    '      - set(datapoint.attributes["messaging.system"], "bullmq") where datapoint.attributes["bullmq.queue.name"] != nil and datapoint.attributes["messaging.system"] == nil',
    '      - set(datapoint.attributes["messaging.destination.name"], datapoint.attributes["bullmq.queue.name"]) where datapoint.attributes["messaging.system"] == "bullmq" and datapoint.attributes["messaging.destination.name"] == nil',
    "  batch: {}",
    "",
    ...exporterLines(vars),
    "",
    "service:",
    "  pipelines:",
    "    traces:",
    "      receivers: [otlp]",
    "      processors: [transform/bullmq, batch]",
    "      exporters: [otlphttp]",
    "    metrics:",
    "      receivers: [otlp]",
    "      processors: [transform/bullmq, batch]",
    "      exporters: [otlphttp]",
  ]);
}

function bullMqGaugeSnippet(queueName: string): string {
  return codeBlock("ts", [
    'import { metrics } from "@opentelemetry/api";',
    'import { Queue } from "bullmq";',
    "",
    `const queue = new Queue(${quoted(queueName)}, { connection: { host: "redis" } });`,
    "",
    "metrics",
    '  .getMeter("bullmq-queues")',
    '  .createObservableGauge("queue.size", { unit: "{job}" })',
    "  .addCallback(async (result) => {",
    '    const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");',
    "    for (const [state, count] of Object.entries(counts)) {",
    "      result.observe(count, {",
    '        "messaging.system": "bullmq",',
    '        "messaging.destination.name": queue.name,',
    "        state,",
    "      });",
    "    }",
    "  });",
  ]);
}

// ---- instrumentation notes -------------------------------------------------------

export interface MessagingInstrumentationNote {
  language: string;
  text: string;
}

function javaAgentNote(what: string): MessagingInstrumentationNote {
  return {
    language: "Java",
    text: `the OpenTelemetry Java agent traces ${what} without code changes.`,
  };
}

const NODE_AWS_SDK_NOTE: MessagingInstrumentationNote = {
  language: "Node.js",
  text: "`@opentelemetry/auto-instrumentations-node` traces the AWS SDK.",
};

const AZURE_SDK_NOTES: ReadonlyArray<MessagingInstrumentationNote> = [
  {
    language: "Java",
    text: "the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.",
  },
  {
    language: ".NET",
    text: 'the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.',
  },
  {
    language: "Node.js",
    text: "register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.",
  },
  {
    language: "Python",
    text: 'install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).',
  },
];

const JMS_NOTES: ReadonlyArray<MessagingInstrumentationNote> = [
  {
    language: "Java",
    text: "the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.",
  },
];

/*
 * Per system, what traces its clients — the facts /docs/telemetry/queues
 * lists under "Instrumenting applications", narrowed to one system.
 */
const INSTRUMENTATION_NOTES: ReadonlyMap<
  string,
  ReadonlyArray<MessagingInstrumentationNote>
> = new Map<string, ReadonlyArray<MessagingInstrumentationNote>>([
  [
    "kafka",
    [
      javaAgentNote("Kafka producers and consumers"),
      {
        language: ".NET",
        text: "`Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.",
      },
      {
        language: "Node.js",
        text: "`@opentelemetry/auto-instrumentations-node` traces `kafkajs`.",
      },
      {
        language: "Python",
        text: "`opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.",
      },
      {
        language: "Go",
        text: "OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.",
      },
    ],
  ],
  [
    "rabbitmq",
    [
      javaAgentNote("RabbitMQ clients"),
      {
        language: ".NET",
        text: "`RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.",
      },
      {
        language: "Node.js",
        text: "`@opentelemetry/auto-instrumentations-node` traces `amqplib`.",
      },
      {
        language: "Python",
        text: "`opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.",
      },
    ],
  ],
  ["activemq", JMS_NOTES],
  ["jms", JMS_NOTES],
  [
    "aws_sqs",
    [
      javaAgentNote("the AWS SDK's SQS calls"),
      {
        language: ".NET",
        text: "the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.",
      },
      NODE_AWS_SDK_NOTE,
      {
        language: "Python",
        text: "`opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.",
      },
      {
        language: "Go",
        text: "`otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.",
      },
    ],
  ],
  [
    "aws.sns",
    [
      javaAgentNote("the AWS SDK's SNS calls"),
      {
        language: ".NET",
        text: "the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.",
      },
      NODE_AWS_SDK_NOTE,
      {
        language: "Python",
        text: "`opentelemetry-instrumentation-botocore`.",
      },
      {
        language: "Go",
        text: "`otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.",
      },
    ],
  ],
  [
    "gcp_pubsub",
    [
      {
        language: "Java",
        text: "the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.",
      },
      {
        language: "Node.js",
        text: "`new PubSub({ enableOpenTelemetryTracing: true })`.",
      },
      {
        language: "Python",
        text: "`PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.",
      },
      {
        language: "Go",
        text: "`pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.",
      },
    ],
  ],
  ["servicebus", AZURE_SDK_NOTES],
  ["eventhubs", AZURE_SDK_NOTES],
  ["pulsar", [javaAgentNote("Pulsar clients")]],
  ["rocketmq", [javaAgentNote("RocketMQ clients")]],
  [
    "nats",
    [
      javaAgentNote(
        "NATS clients — its NATS instrumentation reports `messaging.system` = `nats` —",
      ),
    ],
  ],
]);

/**
 * What traces a system's clients, per language — empty for a system the
 * guide has no specific notes for (BullMQ has its own section, and a
 * long-tail system gets only the generic advice).
 */
export function getMessagingInstrumentationNotes(
  system: string,
): ReadonlyArray<MessagingInstrumentationNote> {
  return INSTRUMENTATION_NOTES.get(system) || [];
}

// ---- charted metrics ------------------------------------------------------------

/**
 * How the queue page draws a curated metric, in the docs tables' words: a
 * cumulative counter as a per-second rate, a cloud metric's per-period count
 * (a gauge summed per interval), otherwise a gauge.
 */
export function getMessageQueueMetricTypeLabel(
  descriptor: MessageQueueMetricDescriptor,
): string {
  if (descriptor.kind === "counter") {
    return "Counter, charted per second";
  }
  if (descriptor.aggregation === AggregationType.Sum) {
    return "Count per period";
  }
  return "Gauge";
}

export interface MessageQueueChartedMetricRow {
  // Markdown: the metric name, and its JSON-stream name when it has one.
  metric: string;
  title: string;
  type: string;
}

/*
 * The rows of the "what the queue's page charts" table for a system. A cloud
 * source's alternative receiver (awsfirehose, fed by a CloudWatch Metric
 * Stream in JSON format) sends the SAME metric under its bare name, which the
 * catalog lists as a second entry; it is folded into the primary entry's row
 * ("(JSON stream: `numberofmessagessent`)") the way the docs tables show it.
 */
export function getMessageQueueChartedMetricRows(
  system: string,
): Array<MessageQueueChartedMetricRow> {
  const source: MessagingBrokerMetricsSource =
    getMessagingBrokerMetricsSource(system);
  const alternatives: ReadonlyArray<string> =
    source.kind === "cloud-monitoring" ? source.alternativeReceivers : [];
  const descriptors: ReadonlyArray<MessageQueueMetricDescriptor> =
    getMessageQueueMetricsForSystem(system);
  const folded: Set<MessageQueueMetricDescriptor> =
    new Set<MessageQueueMetricDescriptor>();
  const rows: Array<MessageQueueChartedMetricRow> = [];

  for (const descriptor of descriptors) {
    if (alternatives.includes(descriptor.receiver)) {
      continue;
    }
    const partner: MessageQueueMetricDescriptor | undefined = descriptors.find(
      (candidate: MessageQueueMetricDescriptor): boolean => {
        return (
          alternatives.includes(candidate.receiver) &&
          descriptor.metricName.endsWith(`/${candidate.metricName}`)
        );
      },
    );
    if (partner) {
      folded.add(partner);
    }
    rows.push({
      metric: partner
        ? `${markdownInlineCode(descriptor.metricName)} (JSON stream: ${markdownInlineCode(partner.metricName)})`
        : markdownInlineCode(descriptor.metricName),
      title: descriptor.title,
      type: getMessageQueueMetricTypeLabel(descriptor),
    });
  }

  // An alternative-only entry nothing folded keeps a row of its own.
  for (const descriptor of descriptors) {
    if (alternatives.includes(descriptor.receiver) && !folded.has(descriptor)) {
      rows.push({
        metric: markdownInlineCode(descriptor.metricName),
        title: descriptor.title,
        type: getMessageQueueMetricTypeLabel(descriptor),
      });
    }
  }

  return rows;
}

/*
 * The stored attribute keys a system's broker metrics name the destination
 * (and, for Azure, the namespace) with, in catalog order — how a queue's
 * guide says which datapoints attach to it. Two spellings of one key
 * (Azure's `metadata_entityname` / `metadata_EntityName`) are one key to a
 * reader, so keys are deduplicated without regard to case.
 */
function uniqueKeys(keys: Iterable<string>): Array<string> {
  const unique: Array<string> = [];
  const seen: Set<string> = new Set<string>();
  for (const key of keys) {
    const folded: string = key.toLowerCase();
    if (!seen.has(folded)) {
      seen.add(folded);
      unique.push(key);
    }
  }
  return unique;
}

export function getMessageQueueDestinationAttributeKeys(
  system: string,
): Array<string> {
  return uniqueKeys(
    getMessageQueueMetricsForSystem(system).flatMap(
      (descriptor: MessageQueueMetricDescriptor): ReadonlyArray<string> => {
        return descriptor.destinationAttributes;
      },
    ),
  );
}

function getScopeAttributeKeys(system: string): Array<string> {
  return uniqueKeys(
    getMessageQueueMetricsForSystem(system).flatMap(
      (descriptor: MessageQueueMetricDescriptor): ReadonlyArray<string> => {
        return descriptor.scopeAttributes || [];
      },
    ),
  );
}

// ---- sections ------------------------------------------------------------------------

/*
 * Every `messaging.system` spelling that keys a queue on this identity
 * family: the family's own value first, then every catalog system of the
 * family and their aliases — `jms`, then `activemq`, `artemis`,
 * `activemq_artemis`, all of which land on one JMS/ActiveMQ queue.
 */
function getIdentitySpellings(context: GuideContext): Array<string> {
  const identitySystem: string =
    getMessagingIdentitySystem(context.system) || context.system;
  const spellings: Array<string> = [identitySystem];
  for (const descriptor of MESSAGING_SYSTEMS) {
    if (getMessagingIdentitySystem(descriptor.system) !== identitySystem) {
      continue;
    }
    for (const spelling of [descriptor.system, ...descriptor.aliases]) {
      if (spelling && !spellings.includes(spelling)) {
        spellings.push(spelling);
      }
    }
  }
  return spellings;
}

/*
 * Whether the guide's queue is one its system's broker metrics reach
 * queues of, but never this one — canBrokerMetricsReachMessageQueue asked
 * with and without the queue disagrees: a Service Bus / Event Hubs queue
 * without a namespace (its spans came from the emulator or through a custom
 * domain). Azure Monitor names the namespace of every metric it reports, so
 * its metrics key on the namespaced queue of the same destination instead,
 * and the guide says so rather than that the system has no broker metrics.
 */
function isOutsideBrokerMetricsScope(context: GuideContext): boolean {
  return (
    context.queue !== null &&
    canBrokerMetricsReachMessageQueue(context.system) &&
    !canBrokerMetricsReachMessageQueue(context.system, context.queue)
  );
}

/*
 * The intro promises the broker's own metrics — they create the guide's
 * queues and fill in their Broker health — only where they reach them (the
 * product guide: any queue of the system; a queue's guide: that queue), by
 * the rule the Overview's Broker health section follows
 * (canBrokerMetricsReachMessageQueue), so the guide never promises metrics
 * that section says cannot arrive. Queues the broker's metrics cannot reach
 * still fill in from metrics that carry the queue's `messaging.system` and
 * destination, which attach to a queue but never create one.
 */
function introSection(context: GuideContext): Array<string> {
  const lines: Array<string> = [];
  const descriptor: MessagingSystemDescriptor | null = context.descriptor;
  const brokerMetricsReach: boolean = canBrokerMetricsReachMessageQueue(
    context.system,
    context.queue,
  );

  if (context.queue) {
    lines.push(
      `## Connect ${markdownInlineCode(context.queue.destination)}`,
      "",
      `This is the ${context.displayName} queue ${markdownInlineCode(
        context.queue.destination,
      )}${
        context.queue.brokerScope
          ? ` in the ${markdownInlineCode(context.queue.brokerScope)} namespace`
          : ""
      }. It fills in from the messaging spans of the applications that publish to and consume from it, and from ${
        brokerMetricsReach
          ? "the broker's own metrics"
          : "metrics that carry its `messaging.system` and `messaging.destination.name`"
      }. Everything below is prefilled for this queue.`,
    );
    return lines;
  }

  lines.push(
    `## Connect ${context.displayName}`,
    "",
    `${context.displayName} queues appear in OneUptime on their own, from ${
      brokerMetricsReach
        ? "two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics"
        : "the messaging spans of the applications that publish to and consume from them"
    }. You can also add one by hand: **Queues → Create Queue**.`,
  );

  if (descriptor) {
    lines.push(
      "",
      `Spans name the system as \`messaging.system\` = ${markdownInlineCode(
        descriptor.system,
      )}${
        descriptor.aliases.length > 0
          ? ` (also accepted: ${descriptor.aliases
              .map((alias: string): string => {
                return markdownInlineCode(alias);
              })
              .join(", ")})`
          : ""
      }.`,
    );
  }

  return lines;
}

/*
 * How this queue's telemetry finds it: the identity (system family,
 * destination, namespace — compared without regard to case), and the
 * attribute its broker metrics name it by.
 */
function identitySection(context: GuideContext): Array<string> {
  const queue: QueueContext | null = context.queue;
  if (!queue) {
    return [];
  }

  const identitySystem: string =
    getMessagingIdentitySystem(context.system) || context.system;
  const destination: string = markdownInlineCode(queue.destination);
  const lines: Array<string> = [
    "",
    "### How telemetry finds this queue",
    "",
    "Names are compared without regard to case.",
    "",
  ];

  const [firstSpelling, ...otherSpellings] = getIdentitySpellings(context);
  let spans: string = `- **Spans**: \`messaging.system\` = ${markdownInlineCode(
    firstSpelling || identitySystem || "<system>",
  )}`;
  if (otherSpellings.length > 0) {
    spans += ` (or ${joinWithOr(
      otherSpellings.map((spelling: string): string => {
        return markdownInlineCode(spelling);
      }),
    )})`;
  }
  spans += ` and the destination ${destination} — in \`messaging.destination.name\`, or an older key such as \`messaging.destination\``;
  if (isNamespaceScopedMessagingSystem(context.system)) {
    spans += queue.brokerScope
      ? `, from an SDK connected to ${markdownInlineCode(
          `${queue.brokerScope}.servicebus.windows.net`,
        )}`
      : ", from an SDK connected to a host that names no namespace (the emulator or a custom domain)";
  }
  lines.push(`${spans}.`);

  if (identitySystem !== context.system && context.descriptor) {
    lines.push(
      `- JMS clients' spans say ${markdownInlineCode(
        identitySystem,
      )} whichever broker is behind them, so they and the ${context.displayName} broker's metrics land on this one queue.`,
    );
  }

  const destinationKeys: Array<string> =
    getMessageQueueDestinationAttributeKeys(context.system);
  const scopeKeys: Array<string> = getScopeAttributeKeys(context.system);
  if (isOutsideBrokerMetricsScope(context)) {
    lines.push(
      "- **Broker metrics**: Azure Monitor names the namespace of every metric it reports, so this queue's broker metrics attach to the same destination's queue in that namespace, not to this one.",
    );
  } else if (destinationKeys.length > 0) {
    let metrics: string = `- **Broker metrics**: ${joinWithOr(
      destinationKeys.map((key: string): string => {
        return markdownInlineCode(key);
      }),
    )} = ${destination}`;
    if (scopeKeys.length > 0) {
      metrics += `, on the namespace whose ${joinWithOr(
        scopeKeys.map((key: string): string => {
          return markdownInlineCode(key);
        }),
      )} is ${markdownInlineCode(queue.brokerScope)}`;
    }
    lines.push(`${metrics}.`);
  }

  return lines;
}

function otlpEnvironmentBlock(vars: DocVars): Array<string> {
  return [
    codeBlock("bash", [
      `OTEL_EXPORTER_OTLP_ENDPOINT=${quoted(`${vars.oneuptimeUrl}/otlp`)}`,
      `OTEL_EXPORTER_OTLP_HEADERS=${quoted(`x-oneuptime-token=${vars.apiKey}`)}`,
      'OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"',
    ]),
    "",
    "> **This token is a secret.** Use a **Server** ingestion key, kept in your",
    "> deployment's secrets. Never put a Server key in browser JavaScript — a",
    "> **Browser** ingestion key exists for that.",
  ];
}

function instrumentationSection(context: GuideContext): Array<string> {
  const lines: Array<string> = [
    "",
    context.queue
      ? "### 1. Instrument the applications that use it"
      : "### 1. Instrument the applications that use them",
    "",
  ];

  if (context.system === "bullmq") {
    lines.push(
      "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:",
      "",
      bullMqTransformConfig(context.vars),
      "",
      "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.",
    );
    return lines;
  }

  lines.push(
    "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.",
    "",
  );

  for (const note of getMessagingInstrumentationNotes(context.system)) {
    lines.push(`- **${note.language}**: ${note.text}`);
  }
  lines.push(
    `- **Any other client**: use the client library's own OpenTelemetry support, or set \`messaging.system\` = ${markdownInlineCode(
      context.system || "<system>",
    )}, \`messaging.destination.name\` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.`,
    "",
    "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:",
    "",
    ...otlpEnvironmentBlock(context.vars),
  );

  return lines;
}

function prefilledBrokerNote(context: GuideContext, what: string): string {
  const address: string = context.queue?.brokerAddress || "";
  return context.queue?.broker
    ? ` The ${what} is prefilled from the broker address this queue's telemetry reports (${markdownInlineCode(
        address,
      )}); change it if the collector reaches the broker another way.`
    : "";
}

/*
 * A catalog source this guide has no ready-made config for (a system added
 * to the catalog after this guide): the catalog's note above says where the
 * metrics come from, and the docs section has the setup. The documentation
 * test fails for every catalog system that ends up here, so it is a
 * safety net for a new entry, never what a shipped system shows.
 */
function unknownConfigNote(context: GuideContext): string {
  return `See [${context.displayName} on the Queues documentation page](${getMessageQueueDocsUrl(
    context.system,
  )}) for the collector configuration.`;
}

function brokerMetricsSection(context: GuideContext): Array<string> {
  const source: MessagingBrokerMetricsSource = context.source;
  /*
   * BullMQ has no broker to read (its jobs live in Redis): the application
   * reports the depth. JMS and a long-tail system have none ready-made.
   */
  let heading: string = "### 2. Send the broker's metrics";
  if (context.system === "bullmq") {
    heading = "### 2. Report the queue's depth";
  } else if (source.kind === "none") {
    heading = "### 2. Broker metrics";
  }
  const lines: Array<string> = ["", heading, ""];

  switch (source.kind) {
    case "receiver": {
      lines.push(source.note, "");
      if (context.system === "rabbitmq") {
        lines.push(
          "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:",
          "",
          codeBlock("bash", [
            "rabbitmq-plugins enable rabbitmq_management",
            "rabbitmqctl add_user otel 'a-strong-password'",
            "rabbitmqctl set_user_tags otel monitoring",
            '# Once per virtual host to monitor; "/" is the default one.',
            'rabbitmqctl set_permissions -p / otel "" "" ""',
          ]),
          "",
          rabbitMqConfig(context, source.receiver),
          "",
          `Set \`RABBITMQ_USERNAME\` and \`RABBITMQ_PASSWORD\` in the collector's environment.${prefilledBrokerNote(
            context,
            "management endpoint's host",
          )} The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.`,
        );
      } else if (context.system === "kafka") {
        lines.push(
          kafkaConfig(context, source.receiver),
          "",
          `For a cluster with SASL or TLS, uncomment \`auth\` and \`tls\`.${prefilledBrokerNote(
            context,
            "bootstrap broker",
          )} The receiver names each topic in \`topic\`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with \`_\`.`,
        );
      } else {
        lines.push(unknownConfigNote(context));
      }
      break;
    }

    case "prometheus": {
      lines.push(source.note, "");
      if (context.system === "rocketmq") {
        lines.push(
          codeBlock("text", [
            "metricsExporterType=PROM",
            `metricsPromExporterPort=${source.port}`,
            "metricsPromExporterHost=0.0.0.0",
          ]),
          "",
          "Then scrape every broker:",
          "",
        );
      }
      if (context.system === "nats") {
        lines.push(
          "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:",
          "",
          codeBlock("bash", [
            "prometheus-nats-exporter -varz -jsz=all http://nats:8222",
          ]),
          "",
          "And scrape it:",
          "",
        );
      }
      lines.push(prometheusConfig(context, source));
      if (context.system === "pulsar") {
        lines.push(
          "",
          "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.",
        );
      }
      break;
    }

    case "cloud-monitoring": {
      lines.push(source.note, "");
      if (source.receiver === "aws_cloudwatch") {
        const region: string | null = getAwsRegionFromBrokerAddress(
          context.queue?.brokerAddress,
        );
        lines.push(
          "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:",
          "",
          awsCloudWatchConfig(context, region || "us-east-1"),
          "",
          `- **Leave \`stats\` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.`,
          "- `discovery.limit` must be set, and caps the metrics read per scrape.",
          "- `delay` waits for CloudWatch to publish a period, so the queue's broker metrics run about 10 minutes behind.",
          `- One receiver reads one region and one namespace: add an instance per region.${
            region
              ? ` The region is prefilled from this queue's endpoint (${markdownInlineCode(
                  context.queue?.brokerAddress || "",
                )}).`
              : ""
          }`,
          "",
          `To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's \`awsfirehose\` receiver — see [Amazon SQS](${MESSAGE_QUEUE_DOCS_PATH}#amazon-sqs).`,
        );
      } else if (source.receiver === "azure_monitor") {
        lines.push(AZURE_MONITOR_READER_NOTE, "", azureMonitorConfig(context));
        /*
         * The receiver re-lists the subscription's resources once a day
         * (cache_resources, 86400 s), so a new Service Bus or Event Hubs
         * namespace's queues start filling in up to a day late. Event
         * Grid's resources are topics, system topics and domains, not
         * namespaces, and its metrics never make or fill a queue.
         */
        if (isNamespaceScopedMessagingSystem(context.system)) {
          lines.push(
            "",
            "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.",
          );
        }
      } else if (source.receiver !== "googlecloudmonitoring") {
        lines.push(unknownConfigNote(context));
      } else {
        lines.push(
          "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:",
          "",
          googleCloudMonitoringConfig(context),
          "",
          "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).",
        );
      }
      break;
    }

    case "external-scraper": {
      lines.push(source.note, "");
      if (context.system !== "activemq") {
        lines.push(unknownConfigNote(context));
        break;
      }
      lines.push(...activeMqScraperSteps(context));
      if (context.queue?.broker) {
        lines.push(
          "",
          `The JMX host is prefilled from the broker address this queue's telemetry reports (${markdownInlineCode(
            context.queue.brokerAddress,
          )}).`,
        );
      }
      break;
    }

    default: {
      lines.push(source.reason);
      if (context.system === "jms") {
        lines.push(
          "",
          "#### If the broker is Apache ActiveMQ",
          "",
          ...activeMqScraperSteps(context),
          "",
          "Its metrics join this queue, which from then on shows as an Apache ActiveMQ queue.",
        );
      }
      if (context.system === "bullmq") {
        lines.push(
          "",
          "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:",
          "",
          bullMqGaugeSnippet(context.queue?.destination || "orders"),
        );
      }
      break;
    }
  }

  return lines;
}

function chartedMetricsSection(context: GuideContext): Array<string> {
  const rows: Array<MessageQueueChartedMetricRow> =
    getMessageQueueChartedMetricRows(context.system);
  const lines: Array<string> = [
    "",
    context.queue
      ? "### 3. What this queue's page charts"
      : "### 3. What a queue's page charts",
    "",
  ];

  if (rows.length === 0) {
    /*
     * NATS and Azure Event Grid have a collector config above, but none of
     * its metrics names one of the queues: canBrokerMetricsReachMessageQueue
     * is false for every queue of a system without curated metrics.
     */
    lines.push(
      context.source.kind === "none"
        ? `OneUptime charts no broker metrics for ${context.displayName} under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries \`messaging.system\` and \`messaging.destination.name\` on each datapoint shows on the queue's **Metrics** tab.`
        : `OneUptime charts no broker metrics for ${context.displayName} under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries \`messaging.system\` and \`messaging.destination.name\` on each datapoint shows on the queue's **Metrics** tab.`,
    );
    if (context.system === "jms") {
      /*
       * The JMS row is refined to ActiveMQ by the first JMX Scraper metric
       * (getMoreSpecificMessagingSystem), and from then on charts
       * ActiveMQ's broker health.
       */
      lines.push(
        "",
        `Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](${getMessageQueueDocsUrl(
          "activemq",
        )}).`,
      );
    }
    return lines;
  }

  lines.push(
    isOutsideBrokerMetricsScope(context)
      ? "This queue has no namespace, so Azure Monitor's metrics never reach it: they chart under **Broker health** on the same destination's queue in their namespace, where each gauge has **Create monitor**."
      : "The queue's Overview charts these under **Broker health**, and each gauge has **Create monitor**. Until one arrives, the section says where they come from.",
    "",
    "| Metric | Shown as | Type |",
    "| --- | --- | --- |",
  );
  for (const row of rows) {
    lines.push(`| ${row.metric} | ${row.title} | ${row.type} |`);
  }

  return lines;
}

function footerSection(context: GuideContext): Array<string> {
  return [
    "",
    `Full guide: [${
      context.descriptor ? context.displayName : "Supported messaging systems"
    } on the Queues documentation page](${getMessageQueueDocsUrl(
      context.system,
    )}).`,
  ];
}

function buildGuide(context: GuideContext): string {
  return [
    ...introSection(context),
    ...identitySection(context),
    ...instrumentationSection(context),
    ...brokerMetricsSection(context),
    ...chartedMetricsSection(context),
    ...footerSection(context),
  ].join("\n");
}

// ---- entry points ----------------------------------------------------------------

/**
 * The product-level guide for one messaging system (the Documentation page
 * and the empty list's picker): how its queues appear, what traces its
 * clients, the collector (or scraper) config for its broker metrics, and
 * what a queue page charts.
 */
export function getMessageQueueSystemGuideMarkdown(
  vars: DocVars,
  system: string,
): string {
  return buildGuide(buildContext(vars, system, null));
}

/**
 * A queue's own guide (its Documentation tab): the system guide for the
 * queue's SPECIFIC system, prefilled for the queue — its identity, the
 * attribute its broker metrics name it by, and what its telemetry already
 * reported about the broker.
 */
export function getMessageQueueDocumentationMarkdown(
  vars: DocVars,
  target: MessageQueueDocumentationTarget,
): string {
  const brokerAddress: string = (target.brokerAddress || "").toString().trim();
  return buildGuide(
    buildContext(vars, target.system, {
      destination: (target.destination || "").toString().trim(),
      brokerScope: (target.brokerScope || "").toString().trim(),
      brokerAddress,
      broker: parseMessageQueueBrokerAddress(brokerAddress),
    }),
  );
}

/**
 * The systems the product guide's picker offers — every catalog system,
 * alphabetical by display name, as the docs page's table lists them.
 */
export function getMessageQueueGuideSystems(): Array<MessagingSystemDescriptor> {
  return [...MESSAGING_SYSTEMS].sort(
    (a: MessagingSystemDescriptor, b: MessagingSystemDescriptor): number => {
      return a.displayName.localeCompare(b.displayName);
    },
  );
}

/*
 * The broker-metric components a guide's config runs for a system, as the
 * catalog's metric entries name them (the receiver, "prometheus", the cloud
 * receiver and its alternatives, or the external scraper).
 */
export function getMessageQueueGuideReceivers(
  system: string,
): ReadonlyArray<string> {
  return getMessagingBrokerMetricsReceivers(
    getMessagingBrokerMetricsSource(system),
  );
}
