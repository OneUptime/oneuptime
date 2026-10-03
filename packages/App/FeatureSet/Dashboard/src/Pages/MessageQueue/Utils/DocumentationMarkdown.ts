import {
  canBrokerMetricsReachMessageQueue,
  getMessageQueueSystemLabel,
  isNamespaceScopedMessagingSystem,
} from "./MessageQueuePresentation";
import {
  MESSAGE_QUEUE_BROKER_HEALTH_EMPTY_DOCS_ANCHOR,
  MESSAGE_QUEUE_DISCOVERY_CLOUD_METRIC_WINDOW_MINUTES,
  MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES,
  MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES,
} from "../../../Components/MessageQueue/MessageQueueOverviewPresentation";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideLink,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  SetupGuideVariables,
  codeBlock,
} from "../../../Components/SetupGuide/SetupGuide";
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
import { translateTemplate } from "Common/UI/Utils/TranslateTemplate";

/*
 * The in-app setup guide of the Queues product: the product Documentation
 * page and the empty list (a messaging-system picker), and every queue's own
 * Documentation tab (prefilled for that queue). It builds on the shared
 * SetupGuide framework every product's guide uses
 * (Components/SetupGuide/SetupGuide): getMessageQueueSetupGuide returns a
 * SetupGuideContent, which MessageQueueDocumentationCard hands to
 * SetupGuideCard — the ingestion key as step 1, then the steps below, with
 * reference material folded under Advanced and known problems under
 * Troubleshooting.
 *
 *   2. instrument the applications (BullMQ: tag its telemetry in the
 *      collector);
 *   3. send the broker's metrics, or report BullMQ's depth — absent for a
 *      system with no ready-made metrics path (JMS, a long-tail system),
 *      whose reason the intro gives instead;
 *   4. check that the queues appear (a queue's own guide: what fills in
 *      where), in the numbers discovery runs on.
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
 * MessageQueueSetupGuide.test parses every YAML block this module emits and
 * holds each system's config equal to the docs page's, so the two cannot
 * drift.
 *
 * A queue's guide also says how its telemetry finds it (the identity:
 * system, destination and, for Service Bus / Event Hubs, the namespace) and
 * fills in what the queue's own telemetry already told OneUptime: a Kafka
 * bootstrap broker, the RabbitMQ or ActiveMQ host, the AWS region of an SQS
 * or SNS endpoint, the BullMQ queue name.
 *
 * What the guide shares with the other Queues pages is theirs, not copied
 * here: the system's name as the list shows it (getMessageQueueSystemLabel)
 * and whether the broker's own metrics can reach the queues it is about
 * (canBrokerMetricsReachMessageQueue) from MessageQueuePresentation — the
 * rule the Overview's Broker health section follows, so the guide never
 * promises metrics that section says cannot arrive — and how often discovery
 * runs, over how much telemetry, from MessageQueueOverviewPresentation (the
 * numbers the Overview's liveness pill states, which a wiring test holds to
 * the discovery job). That module imports MESSAGE_QUEUE_DOCS_PATH from here;
 * both sides read the other's constants only when a guide or a docs route is
 * built, never while the modules load.
 *
 * Pure: plain values in, SetupGuideContent out. No React, no API.
 */

/*
 * Spans a destination needs inside one discovery window before traces
 * create a queue for it (DEFAULT_MESSAGE_QUEUE_MIN_SPANS in
 * Common/Server/Utils/Telemetry/MessageQueueDiscovery, which a self-hosted
 * install changes with MESSAGE_QUEUE_MIN_SPANS). That module is server code
 * the dashboard bundle cannot import, so the number is repeated here and
 * MessageQueueSetupGuide.test holds it equal to the server's.
 */
export const MESSAGE_QUEUE_GUIDE_MIN_SPANS: number = 3;
export const MESSAGE_QUEUE_MIN_SPANS_ENV_NAME: string =
  "MESSAGE_QUEUE_MIN_SPANS";

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

/*
 * A fenced code block from its lines (the shared codeBlock takes the code as
 * one string): the configs below are built line by line.
 */
function codeLines(language: string, lines: Array<string>): string {
  return codeBlock(language, lines.join("\n"));
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
  vars: SetupGuideVariables;
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
  vars: SetupGuideVariables,
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

function exporterLines(vars: SetupGuideVariables): Array<string> {
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
  vars: SetupGuideVariables;
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
  return codeLines("yaml", lines);
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
 * the setup guide test checks every charted metric is collected here.
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
    codeLines("bash", [
      `ACTIVEMQ_SUNJMX_START="-Dcom.sun.management.jmxremote.port=1099 -Dcom.sun.management.jmxremote.rmi.port=1099 -Dcom.sun.management.jmxremote.authenticate=false -Dcom.sun.management.jmxremote.ssl=false -Djava.rmi.server.hostname=${host}"`,
    ]),
    "",
    "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:",
    "",
    codeLines("bash", [
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
function bullMqTransformConfig(vars: SetupGuideVariables): string {
  return codeLines("yaml", [
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
  return codeLines("ts", [
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

// ---- identity ------------------------------------------------------------------------

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

// Lines of markdown into one piece of a guide, without leading or trailing blank lines.
function joinLines(lines: Array<string>): string {
  return lines.join("\n").trim();
}

// ---- intro ---------------------------------------------------------------------------

/*
 * The intro promises the broker's own metrics — they create the guide's
 * queues and fill in their Broker health — only where they reach them (the
 * product guide: any queue of the system; a queue's guide: that queue), by
 * the rule the Overview's Broker health section follows
 * (canBrokerMetricsReachMessageQueue), so the guide never promises metrics
 * that section says cannot arrive. Queues the broker's metrics cannot reach
 * still fill in from metrics that carry the queue's `messaging.system` and
 * destination, which attach to a queue but never create one.
 *
 * The card's title names the guide, so the intro starts with its first
 * sentence. A system with no ready-made metrics path and no step in its
 * place (JMS, a system the catalog does not know) gets the catalog's reason
 * here: it says why there is no broker step, and what to do instead.
 */
function introMarkdown(context: GuideContext): string {
  const lines: Array<string> = [];
  const descriptor: MessagingSystemDescriptor | null = context.descriptor;
  const brokerMetricsReach: boolean = canBrokerMetricsReachMessageQueue(
    context.system,
    context.queue,
  );

  if (context.queue) {
    lines.push(
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
  } else {
    lines.push(
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
  }

  if (context.source.kind === "none" && context.system !== "bullmq") {
    lines.push("", context.source.reason);
  }

  return joinLines(lines);
}

// ---- step: instrument the applications -----------------------------------------------

function otlpEnvironmentBlock(vars: SetupGuideVariables): Array<string> {
  return [
    codeLines("bash", [
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

// Until a key is picked, the first step that carries it says where to pick one.
function pickKeyNote(vars: SetupGuideVariables): Array<string> {
  return vars.apiKey === SETUP_GUIDE_API_KEY_PLACEHOLDER
    ? [
        "",
        `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
      ]
    : [];
}

function instrumentationStep(context: GuideContext): SetupGuideStep {
  if (context.system === "bullmq") {
    return {
      title: "Tag BullMQ's telemetry in your collector",
      description:
        "BullMQ's own spans and metrics create no queue until the collector your applications send to adds the two keys OneUptime reads.",
      markdown: joinLines([
        "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:",
        "",
        bullMqTransformConfig(context.vars),
        "",
        "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.",
        ...pickKeyNote(context.vars),
      ]),
    };
  }

  const lines: Array<string> = [
    "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.",
    "",
  ];
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
    ...pickKeyNote(context.vars),
  );

  return {
    title: context.queue
      ? "Instrument the applications that use it"
      : "Instrument the applications that use them",
    description: context.queue
      ? "Trace the applications that publish to and consume from this queue, and send their spans to OneUptime."
      : "Trace the applications that publish and consume messages, and send their spans to OneUptime.",
    markdown: joinLines(lines),
  };
}

// ---- step: the broker's metrics ------------------------------------------------------

/*
 * How late the guide's `aws_cloudwatch` config delivers. The receiver asks,
 * once per collection_interval, for the whole periods that ended by now -
 * delay, each point stamped with its period's start: the newest point is
 * delay + period to delay + 2 × period + collection_interval old (10m, 1m
 * and 5m in awsCloudWatchConfig: 11 to 17 minutes), as queues.md says of
 * the same config.
 */
const CLOUDWATCH_LATENESS: string = "11 to 17 minutes";

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
 * metrics come from, and the docs section has the setup. The setup guide
 * test fails for every catalog system that ends up here, so it is a safety
 * net for a new entry, never what a shipped system shows.
 */
function unknownConfigNote(context: GuideContext): string {
  return `See [${context.displayName} on the Queues documentation page](${getMessageQueueDocsUrl(
    context.system,
  )}) for the collector configuration.`;
}

/*
 * The broker step's one-line description: what the metrics add, by the
 * same reach rule as the intro — the catalog's note under it already says
 * what reads them.
 */
function brokerStepDescription(context: GuideContext): string {
  if (canBrokerMetricsReachMessageQueue(context.system, context.queue)) {
    return context.queue
      ? "They add the broker's view of this queue to its Overview, under Broker health."
      : "They add the broker's view of each queue to its Overview, under Broker health.";
  }
  if (isOutsideBrokerMetricsScope(context)) {
    return "They chart on the same destination's queue in its namespace, not on this one.";
  }
  return "No queue page charts them: they arrive in the Metrics explorer.";
}

/*
 * The step that sends the broker's health metrics, from the catalog's
 * source. BullMQ has no broker to read (its jobs live in Redis): the
 * application reports the depth. JMS and a long-tail system have no
 * ready-made path and so no step — their reason is in the intro, and JMS's
 * ActiveMQ scraper is an Advanced topic.
 */
function brokerStep(context: GuideContext): SetupGuideStep | null {
  const source: MessagingBrokerMetricsSource = context.source;

  if (context.system === "bullmq") {
    return {
      title: "Report the queue's depth",
      description:
        "BullMQ has no broker to read, so the application reports each queue's job counts itself.",
      markdown: joinLines([
        source.kind === "none" ? source.reason : "",
        "",
        "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:",
        "",
        bullMqGaugeSnippet(context.queue?.destination || "orders"),
      ]),
    };
  }

  if (source.kind === "none") {
    return null;
  }

  const lines: Array<string> = [source.note, ""];

  switch (source.kind) {
    case "receiver": {
      if (context.system === "rabbitmq") {
        lines.push(
          "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:",
          "",
          codeLines("bash", [
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
      if (context.system === "rocketmq") {
        lines.push(
          codeLines("text", [
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
          codeLines("bash", [
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
          `- \`delay\` waits for CloudWatch to publish a period, so with this configuration ${
            context.queue ? "this queue's" : "a queue's"
          } broker metrics arrive ${CLOUDWATCH_LATENESS} late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](${MESSAGE_QUEUE_DOCS_PATH}#alerting)).`,
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
  }

  return {
    title: "Send the broker's metrics",
    description: brokerStepDescription(context),
    markdown: joinLines(lines),
  };
}

// ---- step: check it worked -----------------------------------------------------------

/*
 * What to expect, and when — in the numbers discovery runs on
 * (MessageQueueOverviewPresentation, held to the discovery job's cron and
 * window by MessageQueueOverviewWiring.test; the span minimum, held to the
 * server's by MessageQueueSetupGuide.test) and the docs page's "How queues
 * are discovered" words.
 *
 * The product guide says what creates a queue: enough spans in one window,
 * one datapoint of a curated broker metric (only where the system's broker
 * metrics can reach a queue at all), and never a client metric or a metric
 * of the reader's own. A queue's own guide is for a queue that exists, which
 * every span naming it is matched to whatever their number, so it says
 * which part of the queue's page each kind of telemetry fills in, and when
 * the header's liveness turns on.
 */
function verificationStep(context: GuideContext): SetupGuideStep {
  const brokerMetricsReach: boolean = canBrokerMetricsReachMessageQueue(
    context.system,
    context.queue,
  );
  const isCloudMonitoring: boolean = context.source.kind === "cloud-monitoring";
  const lines: Array<string> = [];

  if (!context.queue) {
    lines.push(
      `Send a few messages through your queues. Every ${MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES} minutes OneUptime reads the last ${MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES} minutes of spans and lists, under **Queues**, each destination at least ${MESSAGE_QUEUE_GUIDE_MIN_SPANS} of them name (spans of any kind but SERVER). On a self-hosted OneUptime, \`${MESSAGE_QUEUE_MIN_SPANS_ENV_NAME}\` sets that number.`,
      "",
    );
    const creates: Array<string> = [];
    if (brokerMetricsReach) {
      creates.push(
        `One datapoint of a broker metric a queue page charts creates its queue too${
          isCloudMonitoring
            ? `: cloud monitoring metrics arrive late, so each run reads them from the last ${MESSAGE_QUEUE_DISCOVERY_CLOUD_METRIC_WINDOW_MINUTES} minutes`
            : ""
        }.`,
      );
    }
    creates.push(
      "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.",
    );
    lines.push(
      creates.join(" "),
      "",
      `Queues are created on their own only while the project is under its [auto-create budget](${MESSAGE_QUEUE_DOCS_PATH}#the-auto-create-budget).`,
    );

    return {
      title: "Check that your queues appear",
      description: translateTemplate(
        "OneUptime looks for new queues every {{minutes}} minutes.",
        { minutes: MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES },
      ),
      markdown: joinLines(lines),
    };
  }

  lines.push(
    `Send a few messages through ${markdownInlineCode(
      context.queue.destination,
    )}. Every span that names this queue is tagged with it as OneUptime ingests it: the spans fill in the **Overview** — messages published and consumed, errors and processing time, and the services under **Producers** and **Consumers** — and the **Traces** tab.`,
    "",
  );

  if (brokerMetricsReach) {
    const isCloudWatch: boolean =
      context.source.kind === "cloud-monitoring" &&
      context.source.receiver === "aws_cloudwatch";
    lines.push(
      `**Broker health** on the Overview fills in from the broker's metrics as they arrive${
        isCloudWatch
          ? `: with the configuration in step 3, CloudWatch's arrive ${CLOUDWATCH_LATENESS} late`
          : ""
      }.`,
    );
  } else if (isOutsideBrokerMetricsScope(context)) {
    lines.push(
      "Azure Monitor's metrics chart under **Broker health** on the same destination's queue in its namespace, not on this one.",
    );
  } else {
    lines.push(
      "Metrics that carry its `messaging.system` and `messaging.destination.name` on each datapoint show on its **Metrics** tab.",
    );
  }

  /*
   * The header's liveness in the Overview pill's words
   * (getMessageQueueLivenessDescription) where the broker's metrics reach
   * this queue. Where they never do — a system none of whose metrics name a
   * queue, or an Azure queue without a namespace — no broker metric sights
   * it, so the sentence names what does (spans, and messaging client
   * metrics, which keep an existing queue's Last seen current) and drops
   * the cloud monitoring window, which only broker metrics are read over.
   */
  lines.push(
    "",
    brokerMetricsReach
      ? `The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every ${MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES} minutes over the last ${MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES} minutes of telemetry${
          isCloudMonitoring
            ? `, and over the last ${MESSAGE_QUEUE_DISCOVERY_CLOUD_METRIC_WINDOW_MINUTES} minutes of cloud monitoring metrics, which arrive late`
            : ""
        }.`
      : `The header reads **Seen recently** once discovery finds spans or messaging client metrics naming this queue. It runs every ${MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES} minutes over the last ${MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES} minutes of telemetry.`,
  );

  return {
    title: "Check that this queue fills in",
    description: "Where this queue's spans and metrics show, and when.",
    markdown: joinLines(lines),
  };
}

// ---- advanced ------------------------------------------------------------------------

/*
 * How this queue's telemetry finds it: the identity (system family,
 * destination, namespace — compared without regard to case), and the
 * attribute its broker metrics name it by.
 */
function identityTopic(context: GuideContext): SetupGuideTopic | null {
  const queue: QueueContext | null = context.queue;
  if (!queue) {
    return null;
  }

  const identitySystem: string =
    getMessagingIdentitySystem(context.system) || context.system;
  const destination: string = markdownInlineCode(queue.destination);
  const lines: Array<string> = [
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

  return {
    title: "How telemetry finds this queue",
    summary: isNamespaceScopedMessagingSystem(context.system)
      ? "The system, destination and namespace its spans and broker metrics must name."
      : "The system and destination its spans and metrics must name.",
    markdown: joinLines(lines),
  };
}

/*
 * JMS has no metrics path of its own, but a JMS queue whose broker is
 * Apache ActiveMQ gets ActiveMQ's: the JMX Scraper's first metric refines
 * the row to ActiveMQ (getMoreSpecificMessagingSystem). Not every JMS
 * broker is ActiveMQ, so it is an Advanced topic rather than a step.
 */
function activeMqTopic(context: GuideContext): SetupGuideTopic | null {
  if (context.system !== "jms") {
    return null;
  }
  return {
    title: "If the broker is Apache ActiveMQ",
    summary:
      "Run the OpenTelemetry JMX Scraper beside the broker to add its destination metrics.",
    markdown: joinLines([
      ...activeMqScraperSteps(context),
      "",
      context.queue
        ? "Its metrics join this queue, which from then on shows as an Apache ActiveMQ queue."
        : "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.",
    ]),
  };
}

function chartedMetricsTopic(context: GuideContext): SetupGuideTopic {
  const rows: Array<MessageQueueChartedMetricRow> =
    getMessageQueueChartedMetricRows(context.system);
  const title: string = context.queue
    ? "What this queue's page charts"
    : "What a queue's page charts";
  const lines: Array<string> = [];

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
    return {
      title: title,
      summary:
        "No broker metrics chart under Broker health for this system; where its metrics show instead.",
      markdown: joinLines(lines),
    };
  }

  /*
   * Broker health offers Create monitor on every entry it charts as a gauge
   * (getMessageQueueBrokerMonitorLinks: kind "gauge"), which the table below
   * types "Gauge" or "Count per period" (a cloud metric's count, a gauge
   * summed per interval); a counter, charted as a rate, has none.
   */
  lines.push(
    isOutsideBrokerMetricsScope(context)
      ? "This queue has no namespace, so Azure Monitor's metrics never reach it: they chart under **Broker health** on the same destination's queue in their namespace, where each gauge and each count per period has **Create monitor**."
      : "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.",
    "",
    "| Metric | Shown as | Type |",
    "| --- | --- | --- |",
  );
  for (const row of rows) {
    lines.push(`| ${row.metric} | ${row.title} | ${row.type} |`);
  }

  return {
    title: title,
    summary:
      "The broker metrics Broker health charts, and which of them offer Create monitor.",
    markdown: joinLines(lines),
  };
}

// ---- troubleshooting -----------------------------------------------------------------

/*
 * The docs page's "## Troubleshooting" entries, condensed: the same facts,
 * with the system's own where the guide already states one, and a link to
 * the entry by its heading's anchor (as the docs renderer slugs it).
 */
function docsEntryLink(title: string, anchor: string): string {
  return `See [${title}](${MESSAGE_QUEUE_DOCS_PATH}#${anchor}) on the Queues documentation page.`;
}

function notCreatedTopic(context: GuideContext): SetupGuideTopic {
  const title: string = "A queue my applications use was not created";
  return {
    title: title,
    summary:
      "Spans that name no system, a name OneUptime ignores, too few spans, or the auto-create budget.",
    markdown: joinLines([
      `- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add \`messaging.system\` and \`messaging.destination.name\`, and give the spans the PRODUCER or CONSUMER kind.${
        context.system === "bullmq"
          ? " For BullMQ, the transform in step 2 does that."
          : ""
      }`,
      `- Its name is one OneUptime ignores (see [What is ignored](${MESSAGE_QUEUE_DOCS_PATH}#what-is-ignored)), or only SERVER spans name it.`,
      `- Fewer than ${MESSAGE_QUEUE_GUIDE_MIN_SPANS} of its spans arrived in the last ${MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES} minutes, or the project reached its [auto-create budget](${MESSAGE_QUEUE_DOCS_PATH}#the-auto-create-budget).`,
      "",
      "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.",
      "",
      docsEntryLink(title, "a-queue-my-applications-use-was-not-created"),
    ]),
  };
}

/*
 * Why Broker health can stay empty for this system: the key check every
 * system shares, then only the causes the docs entry names that apply to
 * this system — or, for a system whose broker metrics chart nowhere, that.
 *
 * The bullets reuse the docs entry's own sentences, so
 * MessageQueueSetupGuide.test can hold every sentence of the entry to the
 * docs page: a sentence that is not the docs entry's must be one of a short
 * list the test proves against the system's docs section, or against the
 * step or topic of this guide it points at. The summary shown while the
 * topic is folded names the causes of these bullets, and no other.
 */
interface BrokerHealthEmptyCauses {
  summary: string;
  reasons: Array<string>;
}

function brokerHealthEmptyCauses(
  context: GuideContext,
): BrokerHealthEmptyCauses {
  const differently: string =
    "The metric names the queue differently from the spans.";
  const limitations: string = `(see [Limitations](${MESSAGE_QUEUE_DOCS_PATH}#limitations))`;
  const azureNamespace: string = `${differently} Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics ${limitations}.`;

  if (isOutsideBrokerMetricsScope(context)) {
    return {
      summary:
        "A refused key, or spans without a namespace on a different queue from Azure Monitor's metrics.",
      reasons: [azureNamespace],
    };
  }

  if (getMessageQueueChartedMetricRows(context.system).length === 0) {
    if (!context.descriptor) {
      return {
        summary: "A refused key, or a system OneUptime does not know.",
        reasons: [
          `Only the broker's own metrics need a system OneUptime knows (see [Supported messaging systems](${getMessageQueueDocsUrl(
            context.system,
          )})). Its metrics are in the **Metrics** explorer.`,
        ],
      };
    }
    if (context.system === "jms") {
      /*
       * The docs entry excepts ActiveMQ: its JMX Scraper metrics turn a JMS
       * queue into an ActiveMQ one, which charts them (the Advanced topic).
       */
      return {
        summary:
          "A refused key, or no charted metrics for JMS brokers other than ActiveMQ.",
        reasons: [
          "JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.",
        ],
      };
    }
    return {
      summary: translateTemplate(
        "A refused key, or no charted metrics for {{system}}.",
        { system: context.displayName },
      ),
      reasons: [
        `${context.displayName} has no charted metrics. Its metrics are in the **Metrics** explorer.`,
      ],
    };
  }

  switch (context.system) {
    case "kafka":
      return {
        summary:
          "A refused key, a consumer group that has not committed an offset, or a topic the receiver skips.",
        reasons: [
          "Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.",
        ],
      };
    case "rabbitmq":
      return {
        summary:
          "A refused key, spans that name the exchange rather than the queue, or a virtual host the user has no access to.",
        reasons: [
          `${differently} RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.`,
          "RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.",
        ],
      };
    case "servicebus":
    case "eventhubs":
      return {
        summary:
          "A refused key, spans without a namespace, more queues than Azure Monitor returns, or a namespace not listed yet.",
        reasons: [
          azureNamespace,
          "Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.",
          "The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.",
        ],
      };
    case "aws_sqs":
    case "aws.sns":
      return {
        summary: translateTemplate(
          "A refused key, or metrics that arrive {{lateness}} late.",
          { lateness: CLOUDWATCH_LATENESS },
        ),
        reasons: [
          `It is late. \`aws_cloudwatch\` waits \`delay\` (10 minutes) for CloudWatch to publish, so its points arrive ${CLOUDWATCH_LATENESS} late.`,
        ],
      };
    case "gcp_pubsub":
      return {
        summary:
          "A refused key, a topic and its subscriptions on separate queues, a metric type the config does not list, or late metrics.",
        reasons: [
          `${differently} A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.`,
          "Cloud Monitoring reads only the types in `metrics_list`.",
          "It is late. Pub/Sub's metrics arrive minutes late.",
        ],
      };
    default:
      return {
        summary:
          "A refused key, or a metric that names the queue differently from the spans.",
        reasons: [
          `The metric names the queue differently from the spans ${limitations}.`,
        ],
      };
  }
}

function brokerHealthEmptyTopic(context: GuideContext): SetupGuideTopic {
  const title: string = "Broker health stays empty";
  const causes: BrokerHealthEmptyCauses = brokerHealthEmptyCauses(context);
  return {
    title: title,
    summary: causes.summary,
    markdown: joinLines([
      "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.",
      ...causes.reasons.map((reason: string): string => {
        return `- ${reason}`;
      }),
      "",
      docsEntryLink(title, MESSAGE_QUEUE_BROKER_HEALTH_EMPTY_DOCS_ANCHOR),
    ]),
  };
}

function troubleshootingTopics(context: GuideContext): Array<SetupGuideTopic> {
  const twoQueuesTitle: string = "Two queues for one destination";
  const queuePerRequestTitle: string = "A new queue for every request";

  return [
    notCreatedTopic(context),
    brokerHealthEmptyTopic(context),
    {
      title: twoQueuesTitle,
      summary:
        "Two systems name it, one sighting has no namespace, or RabbitMQ spans name the exchange.",
      markdown: joinLines([
        "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.",
        "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.",
        "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.",
        "",
        "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.",
        "",
        docsEntryLink(twoQueuesTitle, "two-queues-for-one-destination"),
      ]),
    },
    {
      title: queuePerRequestTitle,
      summary:
        "A destination named per request or per consumer that OneUptime does not recognise.",
      markdown: joinLines([
        `A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](${MESSAGE_QUEUE_DOCS_PATH}#what-is-ignored)). Mark such destinations \`messaging.destination.temporary=true\` in your instrumentation, or give them a stable name, then archive the queues already created.`,
        "",
        docsEntryLink(queuePerRequestTitle, "a-new-queue-for-every-request"),
      ]),
    },
  ];
}

// ---- links ---------------------------------------------------------------------------

function guideLinks(context: GuideContext): Array<SetupGuideLink> {
  return [
    {
      title: context.descriptor
        ? translateTemplate("{{system}} in the Queues documentation", {
            system: context.displayName,
          })
        : "Supported messaging systems",
      url: getMessageQueueDocsUrl(context.system),
    },
    { title: "Queues documentation", url: MESSAGE_QUEUE_DOCS_PATH },
  ];
}

// ---- the key step --------------------------------------------------------------------

/*
 * Who sends with the guide's key: always the applications' exporters, and
 * whatever the guide sets up beside them — the collector that reads the
 * broker, the JMX Scraper that pushes ActiveMQ's metrics itself (JMS's only
 * if its broker is ActiveMQ, an Advanced topic), or BullMQ's collector,
 * which tags the applications' telemetry and reads no broker. A system with
 * no broker step sets up nothing else.
 */
// Who sends with the key: the subject of the key step's sentence.
function keyStepSenders(context: GuideContext): string {
  if (context.system === "bullmq") {
    return translateTemplate(
      "Your applications' OpenTelemetry exporters and the collector that tags BullMQ's telemetry",
    );
  }
  if (context.system === "jms") {
    return translateTemplate(
      "Your applications' OpenTelemetry exporters, and the OpenTelemetry JMX Scraper if the broker is Apache ActiveMQ,",
    );
  }
  const source: MessagingBrokerMetricsSource = context.source;
  switch (source.kind) {
    case "none":
      return translateTemplate("Your applications' OpenTelemetry exporters");
    case "external-scraper":
      return translateTemplate(
        "Your applications' OpenTelemetry exporters and the {{scraper}} that reads your broker",
        { scraper: source.scraper },
      );
    default:
      return translateTemplate(
        "Your applications' OpenTelemetry exporters and the collector that reads your broker",
      );
  }
}

// ---- entry points --------------------------------------------------------------------

export interface MessageQueueSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  /*
   * The messaging system: the picked one on the product page, the row's
   * SPECIFIC system on a queue's tab. Aliases are accepted; a system the
   * catalog does not know gets the generic guide under its own name.
   */
  system: string | null | undefined;
  // The queue a Documentation tab is for; undefined on the product page.
  queue?: MessageQueueDocumentationTarget | undefined;
}

/**
 * The Queues setup guide for one messaging system, filled in with the
 * reader's OneUptime URL and ingestion key. Without `queue` it is the
 * product guide (the Documentation page and the empty list): how the
 * system's queues appear, what traces its clients, the collector (or
 * scraper) config for its broker metrics, and what a queue page charts.
 * With it, the same guide for the queue's own system, prefilled for the
 * queue — its identity, the attribute its broker metrics name it by, and
 * what its telemetry already reported about the broker.
 */
export function getMessageQueueSetupGuide(
  options: MessageQueueSetupGuideOptions,
): SetupGuideContent {
  const vars: SetupGuideVariables = {
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
  };

  let queue: QueueContext | null = null;
  if (options.queue) {
    const brokerAddress: string = (options.queue.brokerAddress || "")
      .toString()
      .trim();
    queue = {
      destination: (options.queue.destination || "").toString().trim(),
      brokerScope: (options.queue.brokerScope || "").toString().trim(),
      brokerAddress: brokerAddress,
      broker: parseMessageQueueBrokerAddress(brokerAddress),
    };
  }

  const context: GuideContext = buildContext(vars, options.system, queue);

  const steps: Array<SetupGuideStep> = [instrumentationStep(context)];
  const broker: SetupGuideStep | null = brokerStep(context);
  if (broker) {
    steps.push(broker);
  }
  steps.push(verificationStep(context));

  const advanced: Array<SetupGuideTopic> = [];
  for (const topic of [
    identityTopic(context),
    activeMqTopic(context),
    chartedMetricsTopic(context),
  ]) {
    if (topic) {
      advanced.push(topic);
    }
  }

  return {
    keyStep: {
      description: translateTemplate(
        "{{senders}} send to OneUptime with this key — a Server key, kept in your deployment's secrets and never in browser JavaScript. Pick an existing key or create a new one — the settings below update to use it.",
        { senders: keyStepSenders(context) },
      ),
      endpointLabel: "OTLP Endpoint",
      endpointValue: `${options.oneuptimeUrl}/otlp`,
      endpointHint:
        "SDKs that take a base endpoint add /v1/traces, /v1/metrics and /v1/logs to it, and so does the collector's otlphttp exporter.",
    },
    intro: introMarkdown(context),
    steps: steps,
    advanced: advanced,
    troubleshooting: troubleshootingTopics(context),
    links: guideLinks(context),
  };
}

/**
 * The title and description of a queue's Documentation tab, above its
 * guide. The description says what the guide's own steps do, so it follows
 * them: the broker's metrics only where the guide has a step that sends
 * them, BullMQ's depth where its step reports that instead, and only the
 * spans for a system with no broker step (JMS, a long-tail system, a queue
 * with no system). That everything is prefilled the guide's intro says.
 */
export function getMessageQueueDocumentationHeading(
  queue: MessageQueueDocumentationTarget,
): { title: string; description: string } {
  const context: GuideContext = buildContext(
    { oneuptimeUrl: "", apiKey: "" },
    queue.system,
    null,
  );
  const title: string = `Send ${context.displayName} telemetry for this queue`;

  if (context.system === "bullmq") {
    return {
      title: title,
      description:
        "Tag the BullMQ telemetry of the applications that use this queue in the collector they send to, and report the queue's depth from the application.",
    };
  }

  return {
    title: title,
    description: brokerStep(context)
      ? "Instrument the applications that publish to and consume from this queue, and send its broker's metrics to OneUptime."
      : "Instrument the applications that publish to and consume from this queue, and send their spans to OneUptime.",
  };
}

// ---- the product guide's picker ------------------------------------------------------

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
 * The product guide's picker, one pill per catalog system, keyed by the
 * canonical `messaging.system`. The options come from the catalog, so the
 * picker can only offer a system OneUptime knows, and a system added to the
 * catalog is offered without touching this file. A pill shows its
 * description as its tooltip: the value the system's spans carry.
 */
export const MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS: ReadonlyArray<SetupGuideOption> =
  getMessageQueueGuideSystems().map(
    (descriptor: MessagingSystemDescriptor): SetupGuideOption => {
      return {
        key: descriptor.system,
        label: descriptor.displayName,
        description: `messaging.system: ${descriptor.system}`,
      };
    },
  );

export const DEFAULT_MESSAGE_QUEUE_GUIDE_SYSTEM: string = "kafka";

/*
 * The canonical system for a candidate (aliases accepted), or the default
 * one — never a value the catalog does not know, which would render a guide
 * with nothing system-specific in it.
 */
export function resolveMessageQueueGuideSystem(
  candidate: string | null | undefined,
): string {
  const descriptor: MessagingSystemDescriptor | null =
    getMessagingSystemDescriptor(candidate);
  return descriptor ? descriptor.system : DEFAULT_MESSAGE_QUEUE_GUIDE_SYSTEM;
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
