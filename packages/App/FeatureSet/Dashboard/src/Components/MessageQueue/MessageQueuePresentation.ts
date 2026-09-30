import {
  formatDatabaseCount,
  formatDatabaseMetricAxisValue,
  formatDatabaseMetricValue,
  getDatabaseMetricAxisUnitLabel,
  getDatabaseUnitSingular,
} from "../../Pages/Database/Utils/DatabaseServerPresentation";
import { getMessageQueueSystemLabel } from "../../Pages/MessageQueue/Utils/MessageQueuePresentation";
import { MESSAGE_QUEUE_DOCS_PATH } from "../../Pages/MessageQueue/Utils/DocumentationMarkdown";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import { getMessageQueueDiscoverySourceLabel } from "Common/Models/DatabaseModels/MessageQueue";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MessagingBrokerMetricsSource,
  MessagingSystemDescriptor,
  getMessagingBrokerMetricsSource,
  getMessagingSystemDescriptor,
} from "Common/Types/MessageQueue/MessagingSystem";

/*
 * How a queue's Overview and telemetry tabs describe it: whether anything
 * has seen it lately, where its broker metrics come from when none have
 * arrived, and how a curated broker metric reads on a tile, a chart and a
 * Metrics row. Pure (no React, no API) so the wording and the arithmetic are
 * unit-tested without a renderer. What every Queues page shares — the "not
 * found" guard, the system and broker labels — lives in
 * Pages/MessageQueue/Utils/MessageQueuePresentation, and the docs path in
 * Pages/MessageQueue/Utils/DocumentationMarkdown.
 *
 * The number formatting is the Databases product's (DatabaseServerPresentation):
 * a queue's catalog units are the same kind of words ("messages",
 * "requests", "consumers", "s", "ms") and a counter is a rate the same way,
 * so a queue's "1.2k messages" and a database's "1.2k connections" read
 * alike.
 */

// ---- liveness ------------------------------------------------------------

/*
 * A queue counts as "seen recently" when a sighting landed inside this
 * window. Discovery (the service-dependency job) runs every 10 minutes over
 * the last 15 minutes of spans and broker metrics, so the window covers
 * three of its runs.
 */
export const MESSAGE_QUEUE_LIVE_WINDOW_MINUTES: number = 30;

export enum MessageQueueLivenessStatus {
  SeenRecently = "seen-recently",
  NotSeenRecently = "not-seen-recently",
  NeverSeen = "never-seen",
}

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getMessageQueueLivenessStatus(
  lastSeenAt: Date | string | null | undefined,
  now: Date = OneUptimeDate.getCurrentDate(),
): MessageQueueLivenessStatus {
  const seenAt: Date | null = toValidDate(lastSeenAt);
  if (!seenAt) {
    return MessageQueueLivenessStatus.NeverSeen;
  }
  const ageInMinutes: number = (now.getTime() - seenAt.getTime()) / 60000;
  return ageInMinutes <= MESSAGE_QUEUE_LIVE_WINDOW_MINUTES
    ? MessageQueueLivenessStatus.SeenRecently
    : MessageQueueLivenessStatus.NotSeenRecently;
}

export function getMessageQueueLivenessLabel(
  status: MessageQueueLivenessStatus,
): string {
  switch (status) {
    case MessageQueueLivenessStatus.SeenRecently:
      return "Seen recently";
    case MessageQueueLivenessStatus.NotSeenRecently:
      return "Not seen recently";
    default:
      return "Never seen";
  }
}

// The header pill's colour for each liveness status.
export type MessageQueueLivenessTone = "positive" | "warning" | "neutral";

export function getMessageQueueLivenessTone(
  status: MessageQueueLivenessStatus,
): MessageQueueLivenessTone {
  switch (status) {
    case MessageQueueLivenessStatus.SeenRecently:
      return "positive";
    case MessageQueueLivenessStatus.NotSeenRecently:
      return "warning";
    default:
      return "neutral";
  }
}

// The pill's hover text: what "seen" means.
export const MESSAGE_QUEUE_LIVENESS_DESCRIPTION: string = `Seen recently: the messaging spans of an instrumented application or a broker metric named this queue in the last ${MESSAGE_QUEUE_LIVE_WINDOW_MINUTES} minutes.`;

// ---- the row -------------------------------------------------------------

/** "Application traces", "Broker metrics" or "Added manually". */
export function getMessageQueueDiscoveryLabel(
  source: string | null | undefined,
): string {
  return getMessageQueueDiscoverySourceLabel(source) || "Unknown";
}

// ---- docs ------------------------------------------------------------------

/*
 * Anchors of queues.md sections a page links to when a system has no
 * section of its own: the broker-metrics overview, and the troubleshooting
 * entry for metrics that stopped arriving.
 */
export const MESSAGE_QUEUE_BROKER_METRICS_DOCS_ANCHOR: string =
  "broker-health-metrics";
export const MESSAGE_QUEUE_BROKER_HEALTH_EMPTY_DOCS_ANCHOR: string =
  "broker-health-stays-empty";

/** The docs route to one heading of the Queues guide. */
export function getMessageQueueDocsRoute(anchor: string): Route {
  const cleanAnchor: string = (anchor || "").trim();
  return new Route(
    cleanAnchor
      ? `${MESSAGE_QUEUE_DOCS_PATH}#${cleanAnchor}`
      : MESSAGE_QUEUE_DOCS_PATH,
  );
}

/**
 * The docs section for a system's broker metrics: its own heading (the
 * catalog's docsAnchor, the slug of its display name), else the overview of
 * broker health metrics for a system the catalog does not know.
 */
export function getMessageQueueSystemDocsRoute(
  system: string | null | undefined,
): Route {
  const descriptor: MessagingSystemDescriptor | null =
    getMessagingSystemDescriptor(system);
  return getMessageQueueDocsRoute(
    descriptor
      ? descriptor.docsAnchor
      : MESSAGE_QUEUE_BROKER_METRICS_DOCS_ANCHOR,
  );
}

// ---- broker metrics guidance ---------------------------------------------

/*
 * What the Broker health section says while no curated broker metric has
 * data for the queue: where the system's metrics come from (the catalog's
 * brokerMetrics source, the one the docs and the Documentation tab are built
 * from), and where to read how to connect them.
 */
export interface MessageQueueBrokerMetricsGuidance {
  // MessagingBrokerMetricsSource["kind"].
  sourceKind: MessagingBrokerMetricsSource["kind"];
  /*
   * One line naming the source, e.g. "OpenTelemetry Collector receiver:
   * kafka_metrics".
   */
  sourceLabel: string;
  // Why there is nothing to chart, and what to do about it.
  description: string;
  // The system's section of the Queues guide.
  docsRoute: Route;
  docsLabel: string;
  /*
   * Whether the system's broker metrics can name this queue at all
   * (canBrokerMetricsReachMessageQueue): only then is there a setup that
   * fills this section in.
   */
  reachesQueue: boolean;
}

/*
 * The queue a guidance is for, as its identity names it: a namespace-scoped
 * system's broker metrics reach only a queue with a namespace.
 */
export interface MessageQueueBrokerMetricsTarget {
  brokerScope?: string | null | undefined;
}

/**
 * Whether a system's broker metrics can ever name this queue — the test the
 * queue's Documentation tab applies too (DocumentationMarkdown's
 * brokerMetricsReachQueues). Only a system with curated metrics
 * (MessageQueueMetricCatalog) has broker metrics that name a queue: a
 * collector can read NATS's and Azure Event Grid's brokers, but NATS
 * reports JetStream streams and consumers rather than subjects, and Event
 * Grid its topics and event subscriptions, so those metrics stay in the
 * Metrics explorer. And a system whose metrics name the namespace they come
 * from (the catalog's scopeAttributes: Azure Monitor's `name`) reaches only
 * a queue with a namespace: one whose spans came from the emulator or
 * through a custom domain has none, and the metrics key on the same
 * destination's queue in the namespace instead. Without a queue, only the
 * system decides.
 */
export function canBrokerMetricsReachMessageQueue(
  system: string | null | undefined,
  queue?: MessageQueueBrokerMetricsTarget | null | undefined,
): boolean {
  const metrics: ReadonlyArray<MessageQueueMetricDescriptor> =
    getMessageQueueMetricsForSystem(system);
  if (metrics.length === 0) {
    return false;
  }
  if (!queue) {
    return true;
  }
  const namesNamespace: boolean = metrics.some(
    (descriptor: MessageQueueMetricDescriptor): boolean => {
      return (descriptor.scopeAttributes || []).length > 0;
    },
  );
  return !namesNamespace || Boolean((queue.brokerScope || "").trim());
}

function sourceLabelOf(source: MessagingBrokerMetricsSource): string {
  switch (source.kind) {
    case "receiver":
      return `OpenTelemetry Collector receiver: ${source.receiver}`;
    case "prometheus":
      return `Prometheus scrape: ${source.exporter}, port ${source.port}, path ${source.path}`;
    case "cloud-monitoring":
      return source.alternativeReceivers.length > 0
        ? `Cloud monitoring: the ${source.receiver} receiver (or ${source.alternativeReceivers.join(
            ", ",
          )})`
        : `Cloud monitoring: the ${source.receiver} receiver`;
    case "external-scraper":
      return `External scraper: ${source.scraper}`;
    default:
      return "No ready-made source";
  }
}

// Where the source's metrics come from, as sentences (catalog wording).
function sourceSentencesOf(source: MessagingBrokerMetricsSource): string {
  switch (source.kind) {
    case "receiver":
    case "cloud-monitoring":
    case "external-scraper":
      return source.note;
    case "prometheus":
      return `The ${source.exporter} serves Prometheus metrics on port ${source.port} at \`${source.path}\`; scrape it with the collector's \`prometheus\` receiver. ${source.note}`;
    default:
      return source.reason;
  }
}

/**
 * The guidance for a queue of `system` (the row's SPECIFIC system: a "jms"
 * queue reads the JMS guidance until ActiveMQ metrics refine it) that has
 * no broker metric to chart. A queue its system's broker metrics can reach
 * (canBrokerMetricsReachMessageQueue) has simply not been sent any yet. A
 * system without curated metrics (JMS, NATS, BullMQ, Azure Event Grid, one
 * OneUptime does not know) never charts any, and its catalog note or reason
 * says why and where its metrics can be seen instead. A Service Bus or
 * Event Hubs queue without a namespace is told where its metrics go. Catalog
 * notes spell component names in backticks, which the section renders as
 * code.
 */
export function getMessageQueueBrokerMetricsGuidance(
  system: string | null | undefined,
  queue?: MessageQueueBrokerMetricsTarget | null | undefined,
): MessageQueueBrokerMetricsGuidance {
  const source: MessagingBrokerMetricsSource =
    getMessagingBrokerMetricsSource(system);
  const label: string = getMessageQueueSystemLabel(system);
  const known: boolean = getMessagingSystemDescriptor(system) !== null;
  const hasCuratedMetrics: boolean =
    getMessageQueueMetricsForSystem(system).length > 0;
  const reachesQueue: boolean = canBrokerMetricsReachMessageQueue(
    system,
    queue,
  );

  let description: string;
  if (reachesQueue) {
    description = `No ${label} broker metric has arrived for this queue yet. ${sourceSentencesOf(
      source,
    )}`;
  } else if (hasCuratedMetrics) {
    description = `${label} broker metrics name the namespace they come from, and this queue has none (its clients connect through the emulator or a custom domain, or it was added without one), so they attach to the same destination's queue in their namespace, not to this one.`;
  } else {
    description = sourceSentencesOf(source);
  }

  return {
    sourceKind: source.kind,
    sourceLabel: sourceLabelOf(source),
    description: description,
    docsRoute: getMessageQueueSystemDocsRoute(system),
    docsLabel: known
      ? `${label} broker metrics in the Queues guide →`
      : "Broker health metrics in the Queues guide →",
    reachesQueue: reachesQueue,
  };
}

/**
 * What the section says when the queue's broker metrics HAVE arrived before
 * (discovery stamped brokerMetricsLastSeenAt) but none is in the selected
 * range: a quiet range or a collector that stopped, not a setup to do.
 */
export function getMessageQueueBrokerMetricsNoDataDescription(data: {
  system: string | null | undefined;
  lastReceivedAt: Date | string | null | undefined;
}): string {
  const label: string = getMessageQueueSystemLabel(data.system);
  const lastReceivedAt: Date | null = toValidDate(data.lastReceivedAt);
  const since: string = lastReceivedAt
    ? ` The last one arrived ${OneUptimeDate.getDateAsLocalFormattedString(
        lastReceivedAt,
      )}.`
    : "";
  return `No ${label} broker metric arrived for this queue in the selected range.${since} Widen the range, or check that the collector still sends them.`;
}

// ---- curated broker metrics ----------------------------------------------

// A title's closing qualifier: "Queue size (legacy names)".
const TITLE_QUALIFIER_PATTERN: RegExp = /^(.*\S)\s*\(([^()]+)\)$/;

/*
 * A catalog entry's chart title. The axis ticks of a metric counted in a
 * unit word carry the number alone (formatDatabaseMetricAxisValue), so the
 * title says the unit once: a counter's "per second", a gauge's unit word
 * unless its title already names it — "Queue depth (messages)", but
 * "Active messages" and "Consumers" as they are. A title that already ends
 * in a qualifier takes the unit inside it, "Queue size (legacy names,
 * messages)", rather than a second pair of brackets.
 */
export function getMessageQueueBrokerMetricChartTitle(
  descriptor: Pick<MessageQueueMetricDescriptor, "title" | "unit" | "kind">,
): string {
  let suffix: string;
  if (descriptor.kind === "counter") {
    suffix = "per second";
  } else {
    const unitLabel: string = getDatabaseMetricAxisUnitLabel(descriptor.unit);
    const title: string = descriptor.title.toLowerCase();
    if (
      !unitLabel ||
      title.includes(unitLabel.toLowerCase()) ||
      title.includes(getDatabaseUnitSingular(unitLabel).toLowerCase())
    ) {
      return descriptor.title;
    }
    suffix = unitLabel;
  }

  const qualified: RegExpMatchArray | null = descriptor.title.match(
    TITLE_QUALIFIER_PATTERN,
  );
  return qualified
    ? `${qualified[1]} (${qualified[2]}, ${suffix})`
    : `${descriptor.title} (${suffix})`;
}

/**
 * The short line under a broker metric's tile value, saying what the number
 * is: a counter's average rate over the range, a per-period count's newest
 * whole interval (Azure Monitor's `_total`, CloudWatch sums, Pub/Sub DELTA
 * counts are summed within an interval, and one still filling is left out:
 * getCompleteMessageQueueCountSeries), or a level's newest value.
 */
export function getMessageQueueBrokerMetricCaption(
  descriptor: Pick<MessageQueueMetricDescriptor, "kind" | "aggregation">,
): string {
  if (descriptor.kind === "counter") {
    return "per second, average over the range";
  }
  if (descriptor.aggregation === AggregationType.Sum) {
    return "newest whole interval";
  }
  return "newest value";
}

/*
 * The caption under a row of the Metrics tab the catalog does not know: the
 * list's generic value, the average of every series of the metric.
 */
export const MESSAGE_QUEUE_METRIC_LIST_DEFAULT_CAPTION: string =
  "average of series";

/**
 * The caption under a curated metric's row on the Metrics tab: how its
 * series combine, the way its Broker health tile reads them.
 */
export function getMessageQueueMetricListCaption(
  descriptor: Pick<MessageQueueMetricDescriptor, "kind" | "seriesCombine">,
): string {
  if (descriptor.kind === "counter") {
    return "per second, all series";
  }
  switch (descriptor.seriesCombine) {
    case "max":
      return "highest series";
    case "avg":
      return "average of series";
    default:
      return "total of series";
  }
}

/** A broker metric's tile value in its catalog unit ("1.2k messages"). */
export function formatMessageQueueMetricValue(
  value: number | null | undefined,
  descriptor: Pick<MessageQueueMetricDescriptor, "unit" | "kind">,
): string {
  return formatDatabaseMetricValue(value, descriptor.unit, descriptor.kind);
}

/** A broker metric's chart tick (the title carries the unit word). */
export function formatMessageQueueMetricAxisValue(
  value: number | null | undefined,
  descriptor: Pick<MessageQueueMetricDescriptor, "unit">,
): string {
  return formatDatabaseMetricAxisValue(value, descriptor.unit);
}

// ---- span figures ----------------------------------------------------------

/** A count on a tile or table: "12", "1.2k", "3.4M"; "—" for nothing. */
export function formatMessageQueueCount(
  value: number | null | undefined,
): string {
  return formatDatabaseCount(value);
}

/** An error rate: "2.5%"; "—" when there is nothing to divide. */
export function formatMessageQueueErrorRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

/** A span duration in milliseconds: "850 µs", "12 ms", "1.25 s". */
export function formatMessageQueueDurationMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  if (value < 1) {
    return `${(value * 1000).toFixed(0)} µs`;
  }
  if (value < 1000) {
    return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
  }
  return `${(value / 1000).toFixed(2)} s`;
}
