/*
 * Structured content for the Queues product page (/product/queues).
 *
 * The page's most checkable claims come from the Queues product's own
 * catalogs in Common instead of being typed into the template, so they
 * cannot drift from what the product does:
 *
 *   - which messaging systems OneUptime knows by name, and where each one's
 *     broker health metrics come from (MESSAGING_SYSTEMS in
 *     Common/Types/MessageQueue/MessagingSystem.ts);
 *   - the broker health charts a queue's Overview draws for its system
 *     (MESSAGE_QUEUE_METRICS in
 *     Common/Types/MessageQueue/MessageQueueMetricCatalog.ts);
 *   - the starting threshold "Create monitor" seeds beside each chart that
 *     has one (Common/Types/Monitor/MessageQueueAlertTemplates.ts).
 *
 * A system added to the catalog, a chart renamed or a threshold retuned
 * shows on the page the next time it renders.
 */
import {
  MESSAGING_SYSTEMS,
  MessagingBrokerMetricsSource,
  MessagingSystemDescriptor,
} from "Common/Types/MessageQueue/MessagingSystem";
import { getMessageQueueMetricsForSystem } from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MessageQueueAlertTemplate,
  MessageQueueAlertTemplateSeverity,
  formatMessageQueueThreshold,
  getMessageQueueAlertTemplateForMetric,
} from "Common/Types/Monitor/MessageQueueAlertTemplates";

export type QueueSystemGroupKey =
  | "collector-receiver"
  | "cloud-monitoring"
  | "prometheus"
  | "external-scraper"
  | "traces-only";

export interface QueueSystemEntry {
  // The system's `messaging.system` value, as the catalog stores it.
  system: string;
  displayName: string;
  /*
   * What emits its broker metrics, as a collector config or the docs name
   * it: "kafka_metrics", "aws_cloudwatch or awsfirehose". Empty when nothing
   * ready-made does.
   */
  metricsSource: string;
  /*
   * The broker health charts a queue of this system shows, in the catalog's
   * order. Empty when its metrics are not charted on a queue's page.
   */
  brokerHealthCharts: Array<string>;
}

export interface QueueSystemGroup {
  key: QueueSystemGroupKey;
  title: string;
  description: string;
  systems: Array<QueueSystemEntry>;
}

export interface QueueAlertThresholdEntry {
  // The template's name: "Consumer Lag High".
  name: string;
  severity: MessageQueueAlertTemplateSeverity;
  // In the metric's own unit, worded: "10,000 messages", "10 minutes".
  threshold: string;
}

export interface QueueAlertThresholdGroup {
  // The system's `messaging.system` value.
  system: string;
  // Its display name: "Apache Kafka".
  title: string;
  thresholds: Array<QueueAlertThresholdEntry>;
}

export interface QueuesPageContent {
  systemCount: number;
  systemGroups: Array<QueueSystemGroup>;
  // Systems whose queues chart broker health on their own page.
  systemsWithBrokerHealthCount: number;
  alertThresholdCount: number;
  systemsWithAlertThresholdsCount: number;
  alertThresholdGroups: Array<QueueAlertThresholdGroup>;
}

interface QueueSystemGroupCopy {
  key: QueueSystemGroupKey;
  title: string;
  description: string;
}

// Page order: the brokers a collector reads directly first.
const SYSTEM_GROUP_COPY: Array<QueueSystemGroupCopy> = [
  {
    key: "collector-receiver",
    title: "Collector receiver",
    description:
      "A receiver in the OpenTelemetry Collector's contrib distribution reads the broker itself.",
  },
  {
    key: "cloud-monitoring",
    title: "Cloud monitoring",
    description:
      "Managed services whose numbers come from the provider's monitoring API: CloudWatch, Azure Monitor or Cloud Monitoring, read by a collector receiver.",
  },
  {
    key: "prometheus",
    title: "Prometheus endpoint",
    description:
      "The broker, or an exporter beside it, serves Prometheus metrics, which the collector's Prometheus receiver scrapes.",
  },
  {
    key: "external-scraper",
    title: "Scraper beside the broker",
    description:
      "A program beside the broker reads its metrics and pushes them over OTLP, straight to OneUptime or through your collector.",
  },
  {
    key: "traces-only",
    title: "Traces & your own metrics",
    description:
      "No broker metrics to read. Queues come from traces, and a queue gauge your application reports, naming the system and the destination, shows on the queue's Metrics tab.",
  },
];

export function getQueueSystemGroupKey(
  descriptor: MessagingSystemDescriptor,
): QueueSystemGroupKey {
  switch (descriptor.brokerMetrics.kind) {
    case "receiver":
      return "collector-receiver";
    case "cloud-monitoring":
      return "cloud-monitoring";
    case "prometheus":
      return "prometheus";
    case "external-scraper":
      return "external-scraper";
    case "none":
    default:
      return "traces-only";
  }
}

export function getQueueMetricsSourceLabel(
  source: MessagingBrokerMetricsSource,
): string {
  switch (source.kind) {
    case "receiver":
      return source.receiver;
    case "cloud-monitoring":
      return [source.receiver, ...source.alternativeReceivers].join(" or ");
    case "prometheus":
      return `${source.exporter} :${source.port}${source.path}`;
    case "external-scraper":
      return source.scraper;
    case "none":
    default:
      return "";
  }
}

/*
 * "Messages visible (JSON stream)" → "Messages visible". The catalog lists
 * one metric twice when it arrives in two shapes (a CloudWatch Metric Stream
 * in JSON format, the JMX Scraper's legacy names), qualified in brackets;
 * the page names it once.
 */
function baseTitleOf(title: string): string {
  return title.replace(/\s*\([^()]*\)$/, "");
}

export function getQueueBrokerHealthCharts(system: string): Array<string> {
  const titles: Array<string> = [];

  for (const metric of getMessageQueueMetricsForSystem(system)) {
    const title: string = baseTitleOf(metric.title);

    if (!titles.includes(title)) {
      titles.push(title);
    }
  }

  return titles;
}

function compareDisplayNames(a: QueueSystemEntry, b: QueueSystemEntry): number {
  return a.displayName.localeCompare(b.displayName, "en", {
    sensitivity: "base",
  });
}

export function getQueueSystemGroups(): Array<QueueSystemGroup> {
  return SYSTEM_GROUP_COPY.map(
    (copy: QueueSystemGroupCopy): QueueSystemGroup => {
      const systems: Array<QueueSystemEntry> = MESSAGING_SYSTEMS.filter(
        (descriptor: MessagingSystemDescriptor): boolean => {
          return getQueueSystemGroupKey(descriptor) === copy.key;
        },
      )
        .map((descriptor: MessagingSystemDescriptor): QueueSystemEntry => {
          return {
            system: descriptor.system,
            displayName: descriptor.displayName,
            metricsSource: getQueueMetricsSourceLabel(descriptor.brokerMetrics),
            brokerHealthCharts: getQueueBrokerHealthCharts(descriptor.system),
          };
        })
        .sort(compareDisplayNames);

      return { ...copy, systems };
    },
  ).filter((group: QueueSystemGroup): boolean => {
    return group.systems.length > 0;
  });
}

/*
 * One group per system with at least one starting threshold, in the
 * catalog's order, each threshold under the chart it starts from. A metric
 * the catalog lists in two shapes has one template per shape, with the same
 * threshold and severity, so the page lists the first shape's.
 */
export function getQueueAlertThresholdGroups(): Array<QueueAlertThresholdGroup> {
  const groups: Array<QueueAlertThresholdGroup> = [];

  for (const descriptor of MESSAGING_SYSTEMS) {
    const listedCharts: Array<string> = [];
    const thresholds: Array<QueueAlertThresholdEntry> = [];

    for (const metric of getMessageQueueMetricsForSystem(descriptor.system)) {
      const template: MessageQueueAlertTemplate | undefined =
        getMessageQueueAlertTemplateForMetric(metric);
      const chart: string = baseTitleOf(metric.title);

      if (!template || listedCharts.includes(chart)) {
        continue;
      }

      listedCharts.push(chart);
      thresholds.push({
        name: template.name,
        severity: template.severity,
        threshold: formatMessageQueueThreshold(
          template.threshold,
          template.unit,
        ),
      });
    }

    if (thresholds.length > 0) {
      groups.push({
        system: descriptor.system,
        title: descriptor.displayName,
        thresholds,
      });
    }
  }

  return groups;
}

export function getQueuesPageContent(): QueuesPageContent {
  const alertThresholdGroups: Array<QueueAlertThresholdGroup> =
    getQueueAlertThresholdGroups();

  return {
    systemCount: MESSAGING_SYSTEMS.length,
    systemGroups: getQueueSystemGroups(),
    systemsWithBrokerHealthCount: MESSAGING_SYSTEMS.filter(
      (descriptor: MessagingSystemDescriptor): boolean => {
        return getQueueBrokerHealthCharts(descriptor.system).length > 0;
      },
    ).length,
    alertThresholdCount: alertThresholdGroups.reduce(
      (total: number, group: QueueAlertThresholdGroup): number => {
        return total + group.thresholds.length;
      },
      0,
    ),
    systemsWithAlertThresholdsCount: alertThresholdGroups.length,
    alertThresholdGroups,
  };
}

export default getQueuesPageContent;
