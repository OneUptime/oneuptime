import {
  MESSAGE_QUEUE_BROKER_METRIC_LOOKBACK_DAYS,
  MessageQueueBrokerMetricArrivals,
  MessageQueueBrokerMetricResult,
  MessageQueueBrokerMetricSources,
  MessageQueueNamespaceSeries,
  MessageQueueTimePoint,
} from "./MessageQueueTelemetryQueries";
import { getMessageQueueBrokerMetricTitle } from "./MessageQueueOverviewPresentation";
import { getAzureMonitorMetricConfigLine } from "../../Pages/MessageQueue/Utils/DocumentationMarkdown";
import { getMessageQueueSystemLabel } from "../../Pages/MessageQueue/Utils/MessageQueuePresentation";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import OneUptimeDate from "Common/Types/Date";
import {
  MessageQueueMetricDescriptor,
  MessageQueueSignal,
  getMessageQueueMetricId,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import {
  CLOUD_CONNECTION_MAX_QUEUES_PER_NAMESPACE,
  doesCloudConnectionReadQueueMetric,
  isCloudConnectionPerQueueSystem,
} from "Common/Types/MessageQueue/MessageQueueCloudConnectionMetrics";
import {
  MessagingBrokerMetricsSource,
  getMessagingBrokerMetricsSource,
  normalizeMessagingSystem,
} from "Common/Types/MessageQueue/MessagingSystem";
import {
  Translator,
  composedValue,
  formatList,
  getGlobalTranslator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The Broker metrics card of a queue's Overview: which of its system's
 * curated broker metrics (MessageQueueMetricCatalog) arrived for the queue,
 * when each last did, and — for every one that did not — why, with what to
 * do about it. Pure (no React, no API) so every rule is unit-tested
 * (MessageQueueBrokerMetricsStatus.test); the reads it is built from are
 * MessageQueueTelemetryQueries' (the range's results, the week's arrivals,
 * the namespace's series).
 *
 * A metric is one of:
 *
 *   - arriving: it has data in the selected range;
 *   - nothing to report: a metric the broker reports only for periods with
 *     activity — a count of messages, errors or throttled requests, a
 *     send's latency, a running total that appears with its first event —
 *     that had none. Not a problem: no throttling is good news;
 *   - not collected: a level the broker reports every period (a backlog, a
 *     size, a lag) that never arrived while the queue's other metrics do —
 *     the collector does not ask for it (an Azure Monitor receiver lists
 *     every metric it reads), or its receiver leaves it off by default; or
 *     a send's latency that never arrived while the queue's published count
 *     shows sends in the range, each of which it is reported with;
 *   - collector only: a metric a cloud connection does not read, of a
 *     queue only a cloud connection reads (an Azure connection reads a
 *     Service Bus or Event Hubs namespace's key metrics per queue, not the
 *     rest of the catalog): the collector's receiver can add it. Not a
 *     problem either;
 *   - stopped: such a level that arrived in the lookback and no longer
 *     does, while the others still arrive;
 *   - not received / not in this range: nothing of the queue's arrived in
 *     the range, which the card says once, for all of them.
 *
 * What read the queue's metrics lately (the lookback's sources: each cloud
 * connection, and a collector) decides whose fix the card gives: a cloud
 * connection's last read on Cloud > Connect, or the collector's
 * configuration.
 *
 * Without the lookback (its read failed) nothing is claimed about a metric
 * outside the range: a level missing from it reads "Not in this range".
 * A metric that last arrived within the late window of the range's end is
 * never called stopped — cloud monitoring metrics arrive minutes late, and
 * a narrow range at the present can end before they do.
 */

/*
 * How long before the range's end a metric's last arrival still counts as
 * "late", not "stopped": the slowest source, CloudWatch through the
 * `aws_cloudwatch` receiver, delivers 11 to 17 minutes after the fact.
 */
export const MESSAGE_QUEUE_BROKER_METRIC_LATE_MINUTES: number = 30;

export type MessageQueueBrokerMetricState =
  | "arriving"
  | "nothingToReport"
  | "notCollected"
  | "collectorOnly"
  | "stopped"
  | "notReceived"
  | "notInRange";

export type MessageQueueBrokerMetricReason =
  // nothingToReport: reported only for periods with activity.
  | "onlyWithActivity"
  /*
   * notCollected: reported every period, so the collector most likely does
   * not ask for it.
   */
  | "notRequested"
  // notCollected: a level its receiver leaves off unless turned on.
  | "offByDefault"
  /*
   * notCollected: reported with every send (a send's latency), and the
   * queue's published count shows sends in the range without it.
   */
  | "reportedWithSends"
  /*
   * notCollected: a cloud connection alone reads the queue, it reads this
   * level too, and none arrived while the others do: its reads of it fail.
   */
  | "missedByConnection"
  /*
   * collectorOnly: a cloud connection alone reads the queue, and it does not
   * read this metric; the collector's receiver can.
   */
  | "notReadByConnection"
  // stopped: it arrived in the lookback, and the others still arrive.
  | "stoppedWhileOthersArrive";

export interface MessageQueueBrokerMetricStatus {
  descriptor: MessageQueueMetricDescriptor;
  // getMessageQueueMetricId.
  id: string;
  state: MessageQueueBrokerMetricState;
  reason: MessageQueueBrokerMetricReason | null;
  /*
   * The newest interval it arrived in: the range's newest point or the
   * lookback's newest arrival, whichever is later. Null when neither has
   * one.
   */
  lastArrivedAt: Date | null;
  /*
   * The line of the Queues guide's azure_monitor configuration that
   * collects it ("ScheduledMessages: [Average]"); null for a system read
   * some other way.
   */
  configLine: string | null;
}

export type MessageQueueBrokerMetricsHealth =
  // Something arrived in the range, and nothing that should is missing.
  | "arriving"
  // Something arrived in the range, and a metric that should did not.
  | "incomplete"
  // Nothing in the range; metrics arrived before it, and none since.
  | "stopped"
  // Nothing in the range, but metrics arrived after it (a past range).
  | "notInRange"
  // Nothing in the range, and nothing ever.
  | "never";

export interface MessageQueueBrokerMetricsStatus {
  health: MessageQueueBrokerMetricsHealth;
  // One per catalog metric, in catalog order.
  metrics: Array<MessageQueueBrokerMetricStatus>;
  // How many have data in the range.
  arrivingCount: number;
  // The ones that should arrive and do not: not collected, stopped.
  missing: Array<MessageQueueBrokerMetricStatus>;
  // The newest broker metric the queue has, as far as the card can tell.
  lastReceivedAt: Date | null;
  // Whether the lookback was read; without it the card claims nothing more.
  knowsLookback: boolean;
  /*
   * What read the queue's metrics lately (the lookback's sources); null when
   * the lookback was not read or holds nothing.
   */
  sources: MessageQueueBrokerMetricSources | null;
}

/**
 * Whether a cloud connection reads the queue's metrics and no collector
 * does: the connection's own read is then what to look at.
 */
export function isReadByCloudConnectionOnly(
  sources: MessageQueueBrokerMetricSources | null | undefined,
): boolean {
  return Boolean(
    sources && sources.connectionIds.length > 0 && !sources.fromCollector,
  );
}

/*
 * The signals of a level: a value the broker reports for every period,
 * whatever happened in it. Every other signal (published, consumed, errors,
 * throttled, latency) is reported only for periods with activity: Azure
 * Monitor leaves a period without sends or errors out of the series it
 * returns, a Pub/Sub DELTA count has points only for periods that had some,
 * and RabbitMQ's counters appear with their first event. Consumer lag is
 * not a level here either: Kafka reports a group's lag only once the group
 * has committed an offset, so a topic nobody consumes has none.
 */
const LEVEL_SIGNALS: ReadonlySet<MessageQueueSignal> =
  new Set<MessageQueueSignal>([
    "backlog",
    "deadLetter",
    "oldestMessageAge",
    "consumers",
    "scheduled",
    "size",
  ]);

/**
 * Whether a broker reports the metric for every period, activity or not: a
 * gauge of a level signal that is not a per-period count (a Pub/Sub count
 * of dead-lettered messages has points only for periods that had some).
 */
export function isMessageQueueMetricReportedEveryPeriod(
  descriptor: Pick<
    MessageQueueMetricDescriptor,
    "signal" | "kind" | "aggregation"
  >,
): boolean {
  return (
    descriptor.kind === "gauge" &&
    descriptor.aggregation !== AggregationType.Sum &&
    LEVEL_SIGNALS.has(descriptor.signal)
  );
}

/**
 * Whether the broker reports the metric with every send to the queue, so
 * that sends in the range without it mean it is not collected: a send's
 * latency (Service Bus's ServerSendLatency).
 */
export function isMessageQueueMetricReportedWithEverySend(
  descriptor: Pick<MessageQueueMetricDescriptor, "signal">,
): boolean {
  return descriptor.signal === "latency";
}

function newestPointTime(
  series: ReadonlyArray<MessageQueueTimePoint>,
): number | null {
  let newest: number | null = null;
  for (const point of series) {
    const time: number = point.x.getTime();
    if (Number.isFinite(time) && (newest === null || time > newest)) {
      newest = time;
    }
  }
  return newest;
}

function laterOf(
  first: number | null | undefined,
  second: number | null | undefined,
): number | null {
  const a: number | null =
    typeof first === "number" && Number.isFinite(first) ? first : null;
  const b: number | null =
    typeof second === "number" && Number.isFinite(second) ? second : null;
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return Math.max(a, b);
}

/**
 * The status of every catalog metric of the queue and of the whole set (see
 * the header): from the range's results (one per catalog metric, as
 * fetchMessageQueueBrokerMetrics returns them), the lookback's arrivals
 * (null when not read), and the row's brokerMetricsLastSeenAt — when
 * discovery last saw any of the queue's broker metrics — for the set's
 * newest arrival when the lookback has none.
 */
export function getMessageQueueBrokerMetricsStatus(data: {
  messagingSystem: string | null | undefined;
  catalog: ReadonlyArray<MessageQueueMetricDescriptor>;
  results: ReadonlyArray<MessageQueueBrokerMetricResult>;
  arrivals: MessageQueueBrokerMetricArrivals | null;
  brokerMetricsLastSeenAt: Date | null | undefined;
  window: { start: Date; end: Date };
}): MessageQueueBrokerMetricsStatus {
  const system: string = normalizeMessagingSystem(data.messagingSystem) || "";
  const resultsById: Map<string, MessageQueueBrokerMetricResult> = new Map();
  for (const result of data.results) {
    resultsById.set(getMessageQueueMetricId(result.descriptor), result);
  }

  const lateFrom: number =
    data.window.end.getTime() -
    MESSAGE_QUEUE_BROKER_METRIC_LATE_MINUTES * 60 * 1000;
  const knowsLookback: boolean = data.arrivals !== null;
  const sources: MessageQueueBrokerMetricSources | null =
    data.arrivals &&
    (data.arrivals.sources.connectionIds.length > 0 ||
      data.arrivals.sources.fromCollector)
      ? data.arrivals.sources
      : null;
  const connectionOnly: boolean = isReadByCloudConnectionOnly(sources);

  // First pass: what arrived in the range, and when each last arrived.
  const reads: Array<{
    descriptor: MessageQueueMetricDescriptor;
    inRange: boolean;
    lastArrivedAt: number | null;
  }> = data.catalog.map((descriptor: MessageQueueMetricDescriptor) => {
    const result: MessageQueueBrokerMetricResult | undefined = resultsById.get(
      getMessageQueueMetricId(descriptor),
    );
    const series: ReadonlyArray<MessageQueueTimePoint> = result?.series || [];
    const arrived: Date | undefined = data.arrivals?.lastArrivedAt.get(
      descriptor.metricName.trim().toLowerCase(),
    );
    return {
      descriptor: descriptor,
      inRange: series.length > 0,
      lastArrivedAt: laterOf(newestPointTime(series), arrived?.getTime()),
    };
  });

  const anyInRange: boolean = reads.some(
    (read: { inRange: boolean }): boolean => {
      return read.inRange;
    },
  );

  /*
   * Whether the queue's published count shows sends in the range: a count
   * above zero, since a source may report a quiet period as 0.
   */
  const sentInRange: boolean = data.results.some(
    (result: MessageQueueBrokerMetricResult): boolean => {
      return (
        result.descriptor.signal === "published" &&
        result.series.some((point: MessageQueueTimePoint): boolean => {
          return Number.isFinite(point.y) && point.y > 0;
        })
      );
    },
  );

  const metrics: Array<MessageQueueBrokerMetricStatus> = reads.map(
    (read: {
      descriptor: MessageQueueMetricDescriptor;
      inRange: boolean;
      lastArrivedAt: number | null;
    }): MessageQueueBrokerMetricStatus => {
      const descriptor: MessageQueueMetricDescriptor = read.descriptor;
      const everyPeriod: boolean =
        isMessageQueueMetricReportedEveryPeriod(descriptor);
      /*
       * Whether the cloud connection that alone reads the queue reads this
       * metric: null when a collector reads the queue too, or its system is
       * not one a connection reads per queue.
       */
      const readByConnection: boolean | null = connectionOnly
        ? doesCloudConnectionReadQueueMetric({
            system: system,
            metricName: descriptor.metricName,
          })
        : null;
      let state: MessageQueueBrokerMetricState;
      let reason: MessageQueueBrokerMetricReason | null = null;

      if (read.inRange) {
        state = "arriving";
      } else if (!anyInRange) {
        // The card says why once, for all of them.
        state = "notReceived";
      } else if (!knowsLookback) {
        state = "notInRange";
      } else if (readByConnection === false) {
        // Only a collector's receiver reads it, and none reads this queue.
        state = "collectorOnly";
        reason = "notReadByConnection";
      } else if (read.lastArrivedAt !== null) {
        if (read.lastArrivedAt >= lateFrom) {
          // Late, or after a range that ends in the past.
          state = "notInRange";
        } else if (everyPeriod) {
          state = "stopped";
          reason = "stoppedWhileOthersArrive";
        } else {
          state = "nothingToReport";
          reason = "onlyWithActivity";
        }
      } else if (
        isMessageQueueMetricReportedWithEverySend(descriptor) &&
        sentInRange
      ) {
        /*
         * Sends arrived in the range, and it comes with every one: the
         * collector does not ask for it.
         */
        state = "notCollected";
        reason = readByConnection
          ? "missedByConnection"
          : descriptor.enabledByDefault
            ? "reportedWithSends"
            : "offByDefault";
      } else if (!everyPeriod) {
        /*
         * A count that never arrived had no activity, or is not collected:
         * nothing tells the two apart, so it is never called missing.
         */
        state = "nothingToReport";
        reason = "onlyWithActivity";
      } else if (readByConnection) {
        // The connection reads it with the others, and none of it arrives.
        state = "notCollected";
        reason = "missedByConnection";
      } else if (!descriptor.enabledByDefault) {
        state = "notCollected";
        reason = "offByDefault";
      } else {
        state = "notCollected";
        reason = "notRequested";
      }

      return {
        descriptor: descriptor,
        id: getMessageQueueMetricId(descriptor),
        state: state,
        reason: reason,
        lastArrivedAt:
          read.lastArrivedAt === null ? null : new Date(read.lastArrivedAt),
        configLine: getAzureMonitorMetricConfigLine(
          system,
          descriptor.metricName,
        ),
      };
    },
  );

  const missing: Array<MessageQueueBrokerMetricStatus> = metrics.filter(
    (metric: MessageQueueBrokerMetricStatus): boolean => {
      return metric.state === "notCollected" || metric.state === "stopped";
    },
  );

  let newest: number | null = null;
  for (const read of reads) {
    newest = laterOf(newest, read.lastArrivedAt);
  }
  // Discovery's sighting, for a set the lookback has nothing of.
  if (newest === null && data.brokerMetricsLastSeenAt) {
    const seenAt: number = new Date(data.brokerMetricsLastSeenAt).getTime();
    newest = Number.isFinite(seenAt) ? seenAt : null;
  }

  let health: MessageQueueBrokerMetricsHealth;
  if (anyInRange) {
    health = missing.length > 0 ? "incomplete" : "arriving";
  } else if (newest === null) {
    health = "never";
  } else if (newest >= lateFrom) {
    health = "notInRange";
  } else {
    health = "stopped";
  }

  return {
    health: health,
    metrics: metrics,
    arrivingCount: reads.filter((read: { inRange: boolean }): boolean => {
      return read.inRange;
    }).length,
    missing: missing,
    lastReceivedAt: newest === null ? null : new Date(newest),
    knowsLookback: knowsLookback,
    sources: sources,
  };
}

// ---- a namespace that sends nothing to the queue ---------------------------

/*
 * The Azure Monitor entity value of a namespace-level operation, which is
 * not a queue or topic (MessagingTelemetryResolver drops it too).
 */
const NAMESPACE_ONLY_ENTITY: string = "-namespaceonlymetric-";

export type MessageQueueNamespaceFinding =
  /*
   * Nothing of the system's metrics came from the queue's namespace in the
   * range: nothing reads it, or its read fails (a missing Monitoring Reader
   * role, an expired client secret).
   */
  | { kind: "nothingFromNamespace"; namespace: string }
  /*
   * Only the namespace's own totals arrived, split by no queue or topic: a
   * cloud connection's reads (Cloud > Connect), or metrics exported through
   * diagnostic settings, which carry no dimensions.
   */
  | {
      kind: "namespaceTotalsOnly";
      namespace: string;
      fromCloudConnection: boolean;
    }
  /*
   * Other queues and topics of the namespace arrived, not this one: the
   * receiver's cap on series per metric and namespace
   * (maximum_number_of_records_per_resource, 10 by default) left it out -
   * or, when a cloud connection sent all of them, its cap
   * (CLOUD_CONNECTION_MAX_QUEUES_PER_NAMESPACE), or the queue is gone.
   */
  | {
      kind: "otherEntitiesOnly";
      namespace: string;
      entityCount: number;
      fromCloudConnection: boolean;
    };

/**
 * Whether to ask what the queue's namespace sent instead
 * (fetchMessageQueueNamespaceSeries): only while none of its metrics
 * arrives for a reason other than the range (none ever, or none since they
 * stopped), for a system whose catalog names the namespace on its metrics
 * (scopeAttributes: Azure Monitor's `name`), and a queue that has one.
 */
export function shouldReadMessageQueueNamespace(data: {
  status: Pick<MessageQueueBrokerMetricsStatus, "health">;
  catalog: ReadonlyArray<MessageQueueMetricDescriptor>;
  namespace: string | null | undefined;
}): boolean {
  if (data.status.health !== "never" && data.status.health !== "stopped") {
    return false;
  }
  if (!(data.namespace || "").trim()) {
    return false;
  }
  return data.catalog.some(
    (descriptor: MessageQueueMetricDescriptor): boolean => {
      return (descriptor.scopeAttributes || []).length > 0;
    },
  );
}

/**
 * Why none of a namespace-scoped queue's metrics reached it, from what its
 * namespace sent in the range (fetchMessageQueueNamespaceSeries, whose loose
 * match is made exact here, ignoring case): other entities only, the
 * namespace's totals only, or nothing at all. Null when there is nothing to
 * say for sure: no read (`series` null), an answer cut off that holds none
 * of the namespace's series, or series that name this very queue — which
 * would have reached it.
 */
export function getMessageQueueNamespaceFinding(data: {
  namespace: string | null | undefined;
  destination: string | null | undefined;
  series: ReadonlyArray<MessageQueueNamespaceSeries> | null;
  isComplete: boolean;
}): MessageQueueNamespaceFinding | null {
  const namespace: string = (data.namespace || "").trim().toLowerCase();
  const destination: string = (data.destination || "").trim().toLowerCase();
  if (!namespace || !data.series) {
    return null;
  }

  const ofNamespace: Array<MessageQueueNamespaceSeries> = data.series.filter(
    (series: MessageQueueNamespaceSeries): boolean => {
      return series.namespace.trim().toLowerCase() === namespace;
    },
  );

  if (ofNamespace.length === 0) {
    return data.isComplete
      ? { kind: "nothingFromNamespace", namespace: namespace }
      : null;
  }

  const otherEntities: Set<string> = new Set<string>();
  let othersFromCollector: boolean = false;
  let hasTotals: boolean = false;
  let totalsFromCloudConnection: boolean = false;
  for (const series of ofNamespace) {
    const entity: string = series.entity.trim().toLowerCase();
    if (!entity || entity === NAMESPACE_ONLY_ENTITY) {
      hasTotals = true;
      totalsFromCloudConnection =
        totalsFromCloudConnection || series.fromCloudConnection;
      continue;
    }
    if (entity === destination) {
      // It names this very queue: neither "others only" nor "totals only".
      return null;
    }
    otherEntities.add(entity);
    othersFromCollector = othersFromCollector || !series.fromCloudConnection;
  }

  if (otherEntities.size > 0) {
    return {
      kind: "otherEntitiesOnly",
      namespace: namespace,
      entityCount: otherEntities.size,
      fromCloudConnection: !othersFromCollector,
    };
  }
  if (hasTotals) {
    return {
      kind: "namespaceTotalsOnly",
      namespace: namespace,
      fromCloudConnection: totalsFromCloudConnection,
    };
  }
  return null;
}

// ---- words ---------------------------------------------------------------

/** A metric's state, as its badge says it. */
export function getMessageQueueBrokerMetricStateLabel(
  state: MessageQueueBrokerMetricState,
  translator: Translator = getGlobalTranslator(),
): string {
  switch (state) {
    case "arriving":
      return translator.translateText("Arriving") || "Arriving";
    case "nothingToReport":
      return (
        translator.translateText("Nothing to report") || "Nothing to report"
      );
    case "notCollected":
      return translator.translateText("Not collected") || "Not collected";
    case "collectorOnly":
      return translator.translateText("Collector only") || "Collector only";
    case "stopped":
      return translator.translateText("Stopped") || "Stopped";
    case "notReceived":
      return translator.translateText("Not received") || "Not received";
    default:
      return (
        translator.translateText("Not in this range") || "Not in this range"
      );
  }
}

/** The set's health, as the card's badge says it. */
export function getMessageQueueBrokerMetricsHealthLabel(
  status: Pick<MessageQueueBrokerMetricsStatus, "health" | "missing">,
  translator: Translator = getGlobalTranslator(),
): string {
  switch (status.health) {
    case "arriving":
      return translator.translateText("Arriving") || "Arriving";
    case "incomplete":
      return translator.translatePlural(
        { one: "{{count}} missing", other: "{{count}} missing" },
        status.missing.length,
      );
    case "stopped":
      return translator.translateText("Stopped") || "Stopped";
    case "notInRange":
      return (
        translator.translateText("Not in this range") || "Not in this range"
      );
    default:
      return translator.translateText("None yet") || "None yet";
  }
}

/*
 * When a metric last arrived, for a line that says so: "5 minutes ago" in
 * the reader's language.
 */
function relativeTimeOf(date: Date, now: Date): string {
  return OneUptimeDate.fromNow(date, now);
}

/**
 * The line under a metric's name saying why it shows what it shows, or
 * null when its badge says it all (arriving; nothing received at all, which
 * the card says once). Inline code is set off in backticks.
 */
export function getMessageQueueBrokerMetricStatusLine(
  metric: MessageQueueBrokerMetricStatus,
  data: { messagingSystem: string | null | undefined; now: Date },
  translator: Translator = getGlobalTranslator(),
): string | null {
  const system: string = getMessageQueueSystemLabel(data.messagingSystem);
  switch (metric.reason) {
    case "onlyWithActivity":
      return metric.lastArrivedAt
        ? translator.translateTemplate(
            "Reported only for periods with activity. It last arrived {{time}}.",
            { time: relativeTimeOf(metric.lastArrivedAt, data.now) },
          )
        : translator.translateTemplate(
            "Reported only for periods with activity, and there was none in the last {{days}} days.",
            {
              days: translator.formatNumber(
                MESSAGE_QUEUE_BROKER_METRIC_LOOKBACK_DAYS,
              ),
            },
          );
    case "notRequested":
      return metric.configLine
        ? translator.translateTemplate(
            "{{system}} reports it every minute, so your collector most likely does not ask for it: add `{{line}}` to its metrics list.",
            { system: system, line: metric.configLine },
          )
        : translator.translateTemplate(
            "{{system}} reports it all the time, so it is most likely not collected.",
            { system: system },
          );
    case "reportedWithSends":
      return metric.configLine
        ? translator.translateTemplate(
            "{{system}} reports it with every send, and sends to this queue arrived in the selected range, so your collector most likely does not ask for it: add `{{line}}` to its metrics list.",
            { system: system, line: metric.configLine },
          )
        : translator.translateTemplate(
            "{{system}} reports it with every send, and sends to this queue arrived in the selected range, so it is most likely not collected.",
            { system: system },
          );
    case "offByDefault":
      return translator.translateTemplate(
        "The `{{receiver}}` receiver leaves it off unless its configuration turns it on.",
        { receiver: metric.descriptor.receiver },
      );
    case "missedByConnection":
      return translator.translateTemplate(
        "Your cloud connection reads it, and none arrived while this queue's other metrics do: its last read on Cloud > Connect says why.",
      );
    case "notReadByConnection":
      return metric.configLine
        ? translator.translateTemplate(
            "Only the collector's `{{receiver}}` receiver reads it: add `{{line}}` to its metrics list.",
            { receiver: metric.descriptor.receiver, line: metric.configLine },
          )
        : translator.translateTemplate(
            "Only the collector's `{{receiver}}` receiver reads it.",
            { receiver: metric.descriptor.receiver },
          );
    case "stoppedWhileOthersArrive":
      return metric.lastArrivedAt
        ? translator.translateTemplate(
            "It stopped arriving {{time}}, while the other metrics still arrive.",
            { time: relativeTimeOf(metric.lastArrivedAt, data.now) },
          )
        : null;
    default:
      return metric.state !== "arriving" && metric.lastArrivedAt
        ? translator.translateTemplate("It last arrived {{time}}.", {
            time: relativeTimeOf(metric.lastArrivedAt, data.now),
          })
        : null;
  }
}

/** The card's summary line: how much arrived in the range. */
export function getMessageQueueBrokerMetricsSummary(
  status: Pick<
    MessageQueueBrokerMetricsStatus,
    "health" | "metrics" | "arrivingCount"
  >,
  translator: Translator = getGlobalTranslator(),
): string {
  switch (status.health) {
    case "arriving":
    case "incomplete":
      return translator.translatePlural(
        {
          one: "{{arrived}} of {{count}} metric arrived in the selected range.",
          other:
            "{{arrived}} of {{count}} metrics arrived in the selected range.",
        },
        status.metrics.length,
        { arrived: translator.formatNumber(status.arrivingCount) },
      );
    case "stopped":
      return translator.translateTemplate(
        "No metric arrived in the selected range, and none has since.",
      );
    case "notInRange":
      return translator.translateTemplate(
        "No metric arrived in the selected range, but newer ones have.",
      );
    default:
      return translator.translateTemplate(
        "No metric has arrived for this queue yet.",
      );
  }
}

/** "Last received 5 minutes ago", or null when nothing ever was. */
export function getMessageQueueBrokerMetricsLastReceived(
  status: Pick<MessageQueueBrokerMetricsStatus, "lastReceivedAt">,
  now: Date,
  translator: Translator = getGlobalTranslator(),
): string | null {
  if (!status.lastReceivedAt) {
    return null;
  }
  return translator.translateTemplate("Last received {{time}}", {
    time: relativeTimeOf(status.lastReceivedAt, now),
  });
}

/*
 * The slot of the source line (getMessageQueueBrokerMetricsSourceLine) that
 * the card draws as a link to Cloud > Connect, with the connections' names.
 */
export const MESSAGE_QUEUE_BROKER_METRICS_CONNECTIONS_SLOT: string =
  "connections";

/*
 * The card's line saying what reads the queue's metrics: an English
 * template for the reader's translator, whose {{connections}} slot (when
 * `namesConnections`) the card fills itself, as a link.
 */
export interface MessageQueueBrokerMetricsSourceLine {
  template: string;
  values: Record<string, string>;
  namesConnections: boolean;
}

/**
 * What reads the queue's metrics, as the card says it under its summary:
 * the cloud connection (or connections), the collector's receiver, or both
 * - the connection then skips what the receiver reads, so nothing is
 * counted twice (CloudCollectorQueues). Null when the lookback says
 * nothing, and for a collector alone on a system no cloud connection reads
 * per queue - where it could be nothing else.
 */
export function getMessageQueueBrokerMetricsSourceLine(
  status: Pick<MessageQueueBrokerMetricsStatus, "sources">,
  messagingSystem: string | null | undefined,
): MessageQueueBrokerMetricsSourceLine | null {
  const sources: MessageQueueBrokerMetricSources | null = status.sources;
  if (!sources) {
    return null;
  }
  const reader: BrokerMetricsReader = getBrokerMetricsReader(messagingSystem);
  const receiver: string | null =
    reader.kind === "receiver" ? reader.name : null;
  const fromConnection: boolean = sources.connectionIds.length > 0;
  const several: boolean = sources.connectionIds.length > 1;

  if (fromConnection && !sources.fromCollector) {
    return {
      template: several
        ? "Read by your cloud connections ({{connections}})."
        : "Read by your cloud connection ({{connections}}).",
      values: {},
      namesConnections: true,
    };
  }
  if (fromConnection && receiver) {
    return {
      template: several
        ? "Read by your collector's `{{receiver}}` receiver and your cloud connections ({{connections}}), which skip the metrics the receiver reads."
        : "Read by your collector's `{{receiver}}` receiver and your cloud connection ({{connections}}), which skips the metrics the receiver reads.",
      values: { receiver: receiver },
      namesConnections: true,
    };
  }
  if (
    !fromConnection &&
    receiver &&
    isCloudConnectionPerQueueSystem(messagingSystem)
  ) {
    return {
      template: "Read by your collector's `{{receiver}}` receiver.",
      values: { receiver: receiver },
      namesConnections: false,
    };
  }
  return null;
}

/**
 * On a queue only a cloud connection reads, the sentence after the source
 * line that says why the summary counts fewer metrics than the system has:
 * the ones marked Collector only, which the collector's receiver reads.
 * Null while there are none, and on any other queue.
 */
export function getMessageQueueCollectorOnlyLine(
  status: Pick<MessageQueueBrokerMetricsStatus, "metrics" | "sources">,
  messagingSystem: string | null | undefined,
  translator: Translator = getGlobalTranslator(),
): string | null {
  const reader: BrokerMetricsReader = getBrokerMetricsReader(messagingSystem);
  const collectorOnly: number = status.metrics.filter(
    (metric: MessageQueueBrokerMetricStatus): boolean => {
      return metric.state === "collectorOnly";
    },
  ).length;
  if (
    collectorOnly === 0 ||
    reader.kind !== "receiver" ||
    !isReadByCloudConnectionOnly(status.sources)
  ) {
    return null;
  }
  return translator.translatePlural(
    {
      one: "The {{count}} metric marked Collector only needs the collector's `{{receiver}}` receiver.",
      other:
        "The {{count}} metrics marked Collector only need the collector's `{{receiver}}` receiver.",
    },
    collectorOnly,
    { receiver: reader.name },
  );
}

/*
 * One thing the card asks the reader to look at: a headline, what it means,
 * the steps that fix it, and the lines to add to the collector's
 * configuration, if any. Inline code is set off in backticks.
 */
export interface MessageQueueBrokerMetricsFinding {
  /*
   * Stable, for tests and the page: "missing", "stopped" or a namespace
   * finding's kind.
   */
  kind: "missing" | "stopped" | MessageQueueNamespaceFinding["kind"];
  title: string;
  description: string;
  steps: Array<string>;
  // Lines to add to the collector's configuration, verbatim.
  configLines: Array<string>;
  /*
   * Where Cloud > Connect fixes it, the card's first link: connecting the
   * namespace's Azure subscription, or the cloud connection that reads the
   * queue. Null where Cloud > Connect does not.
   */
  cloudConnectionLink: MessageQueueCloudConnectionLink | null;
  /*
   * Whether the collector's configuration for the queue (its Documentation
   * tab) fixes it: not where only a cloud connection's read can.
   */
  linksCollectorConfiguration: boolean;
}

/*
 * A finding's link to Cloud > Connect: "connect" opens its Azure form (no
 * cloud connection reads the queue), "check" its list of connections (one
 * does, and its last read says what went wrong).
 */
export type MessageQueueCloudConnectionLink = "connect" | "check";

/*
 * What reads the system's broker metrics: a collector receiver, by the name
 * its configuration gives it ("azure_monitor", "rabbitmq", "prometheus"), a
 * program outside the collector ("OpenTelemetry JMX Scraper"), or nothing
 * ready-made.
 */
type BrokerMetricsReader =
  | { kind: "receiver"; name: string }
  | { kind: "scraper"; name: string }
  | { kind: "none" };

function getBrokerMetricsReader(
  messagingSystem: string | null | undefined,
): BrokerMetricsReader {
  const source: MessagingBrokerMetricsSource =
    getMessagingBrokerMetricsSource(messagingSystem);
  if (source.kind === "receiver" || source.kind === "cloud-monitoring") {
    return { kind: "receiver", name: source.receiver };
  }
  if (source.kind === "prometheus") {
    return { kind: "receiver", name: "prometheus" };
  }
  if (source.kind === "external-scraper") {
    return { kind: "scraper", name: source.scraper };
  }
  return { kind: "none" };
}

/**
 * The finding for the metrics that should arrive and do not, or null when
 * none is missing: which they are, and how to collect them — for Azure
 * Monitor, the lines its receiver's `metrics` list needs.
 */
export function getMessageQueueMissingMetricsFinding(
  status: Pick<MessageQueueBrokerMetricsStatus, "missing"> &
    Partial<Pick<MessageQueueBrokerMetricsStatus, "sources">>,
  messagingSystem: string | null | undefined,
  translator: Translator = getGlobalTranslator(),
): MessageQueueBrokerMetricsFinding | null {
  if (status.missing.length === 0) {
    return null;
  }
  const system: string = getMessageQueueSystemLabel(messagingSystem);
  /*
   * A cloud connection alone reads the queue: its own read says why these
   * did not arrive, and no collector configuration would help.
   */
  const connectionOnly: boolean = isReadByCloudConnectionOnly(status.sources);
  const configLines: Array<string> = [];
  for (const metric of status.missing) {
    if (metric.configLine && !configLines.includes(metric.configLine)) {
      configLines.push(metric.configLine);
    }
  }
  const reader: BrokerMetricsReader = getBrokerMetricsReader(messagingSystem);
  const everyMissingIsListed: boolean =
    !connectionOnly &&
    configLines.length > 0 &&
    status.missing.every((metric: MessageQueueBrokerMetricStatus): boolean => {
      return metric.configLine !== null;
    });

  /*
   * One metric is "it" and one line "the line": chosen here, not by a
   * plural, since none of these sentences names the count.
   */
  const several: boolean = status.missing.length > 1;
  const steps: Array<string> = [];
  if (connectionOnly) {
    steps.push(
      translator.translateTemplate(
        "Check the connection's last read on Cloud > Connect: it says which metrics it could not read.",
      ),
    );
  } else if (everyMissingIsListed && reader.kind === "receiver") {
    steps.push(
      translator.translateTemplate(
        configLines.length > 1
          ? "Add the lines below to the `{{receiver}}` receiver's `metrics` list, under the namespace type, and restart the collector."
          : "Add the line below to the `{{receiver}}` receiver's `metrics` list, under the namespace type, and restart the collector.",
        { receiver: reader.name },
      ),
    );
  } else if (reader.kind === "receiver") {
    steps.push(
      translator.translateTemplate(
        several
          ? "Check that the collector's `{{receiver}}` configuration collects them: the {{system}} section of the Queues guide lists what each needs."
          : "Check that the collector's `{{receiver}}` configuration collects it: the {{system}} section of the Queues guide lists what it needs.",
        { receiver: reader.name, system: system },
      ),
    );
  } else if (reader.kind === "scraper") {
    steps.push(
      translator.translateTemplate(
        several
          ? "Check that the {{scraper}}'s configuration collects them: the {{system}} section of the Queues guide lists what each needs."
          : "Check that the {{scraper}}'s configuration collects it: the {{system}} section of the Queues guide lists what it needs.",
        { scraper: reader.name, system: system },
      ),
    );
  }

  return {
    kind: "missing",
    title: translator.translatePlural(
      {
        one: "{{count}} metric does not arrive",
        other: "{{count}} metrics do not arrive",
      },
      status.missing.length,
    ),
    description: translator.translateTemplate(
      connectionOnly
        ? several
          ? "Your cloud connection reads these, and none arrived in the selected range while this queue's other metrics did: {{metrics}}."
          : "Your cloud connection reads this metric, and it did not arrive in the selected range while this queue's other metrics did: {{metrics}}."
        : several
          ? "{{system}} would have reported these in the selected range, and this queue's other metrics arrive, so they are most likely not collected: {{metrics}}."
          : "{{system}} would have reported this metric in the selected range, and this queue's other metrics arrive, so it is most likely not collected: {{metrics}}.",
      {
        system: system,
        metrics: composedValue((words: Translator): string => {
          return formatList(
            status.missing.map(
              (metric: MessageQueueBrokerMetricStatus): string => {
                return getMessageQueueBrokerMetricTitle(
                  metric.descriptor,
                  words,
                );
              },
            ),
            words,
          );
        }),
      },
    ),
    steps: steps,
    configLines: everyMissingIsListed ? configLines : [],
    cloudConnectionLink: connectionOnly ? "check" : null,
    linksCollectorConfiguration: !connectionOnly,
  };
}

/**
 * The finding for a queue whose metrics stopped arriving — some arrived
 * before the range, none in it or since — or null for any other health.
 * Where a namespace finding says more (an Azure queue whose namespace sends
 * nothing to it), the card shows that one instead.
 */
export function getMessageQueueStoppedMetricsFinding(
  status: Pick<MessageQueueBrokerMetricsStatus, "health" | "lastReceivedAt"> &
    Partial<Pick<MessageQueueBrokerMetricsStatus, "sources">>,
  messagingSystem: string | null | undefined,
  now: Date,
  translator: Translator = getGlobalTranslator(),
): MessageQueueBrokerMetricsFinding | null {
  if (status.health !== "stopped" || !status.lastReceivedAt) {
    return null;
  }
  const reader: BrokerMetricsReader = getBrokerMetricsReader(messagingSystem);
  const sources: MessageQueueBrokerMetricSources | null =
    status.sources || null;
  const fromConnection: boolean = Boolean(
    sources && sources.connectionIds.length > 0,
  );
  const steps: Array<string> = [];
  // A cloud connection read them last: its own read says why they stopped.
  if (fromConnection) {
    steps.push(
      translator.translateTemplate(
        "Check the connection's last read on Cloud > Connect: it says why its reads fail, such as an expired secret or a removed permission.",
      ),
    );
  }
  // A collector read them last, or nothing says what did.
  if (!fromConnection || sources?.fromCollector) {
    if (reader.kind === "receiver") {
      steps.push(
        translator.translateTemplate(
          "Check that the collector running the `{{receiver}}` receiver is up, and look in its log for errors: an expired credential or a removed permission stops every read.",
          { receiver: reader.name },
        ),
      );
    } else if (reader.kind === "scraper") {
      steps.push(
        translator.translateTemplate(
          "Check that the {{scraper}} that reports this queue's metrics is still running, and look in its log for errors.",
          { scraper: reader.name },
        ),
      );
    } else {
      steps.push(
        translator.translateTemplate(
          "Check that what reports this queue's metrics is still running, and look in its log for errors.",
        ),
      );
    }
  }
  return {
    kind: "stopped",
    title: translator.translateTemplate(
      "Broker metrics stopped arriving {{time}}",
      { time: relativeTimeOf(status.lastReceivedAt, now) },
    ),
    description: translator.translateTemplate(
      "This queue's metrics arrived before and none has since: what sends them stopped, or its reads fail.",
    ),
    steps: steps,
    configLines: [],
    cloudConnectionLink: fromConnection ? "check" : null,
    linksCollectorConfiguration:
      !fromConnection || Boolean(sources?.fromCollector),
  };
}

/**
 * The words of a namespace finding (getMessageQueueNamespaceFinding), with
 * what read the queue's metrics lately (the lookback's sources), which
 * decides whose fix it gives: a namespace a cloud connection read and now
 * sends nothing points at that connection, not at connecting one.
 */
export function getMessageQueueNamespaceFindingWords(
  finding: MessageQueueNamespaceFinding,
  messagingSystem: string | null | undefined,
  translator: Translator = getGlobalTranslator(),
  sources: MessageQueueBrokerMetricSources | null = null,
): MessageQueueBrokerMetricsFinding {
  const system: string = getMessageQueueSystemLabel(messagingSystem);
  const readByConnection: boolean = Boolean(
    sources && sources.connectionIds.length > 0,
  );
  switch (finding.kind) {
    case "nothingFromNamespace": {
      const title: string = translator.translateTemplate(
        "Nothing from namespace {{namespace}} reaches OneUptime",
        { namespace: finding.namespace },
      );
      if (isReadByCloudConnectionOnly(sources)) {
        // A connection read it, nothing else did, and it sends nothing now.
        return {
          kind: finding.kind,
          title: title,
          description: translator.translateTemplate(
            "No {{system}} metric of this namespace arrived in the selected range, for any of its queues and topics: your cloud connection stopped reading it, or its reads fail.",
            { system: system },
          ),
          steps: [
            translator.translateTemplate(
              "Check the connection's last read on Cloud > Connect: it says why its reads fail, such as an expired secret or a removed permission.",
            ),
            translator.translateTemplate(
              "Give the connection's app the Monitoring Reader role on the subscription or the namespace.",
            ),
          ],
          configLines: [],
          cloudConnectionLink: "check",
          linksCollectorConfiguration: false,
        };
      }
      const steps: Array<string> = [];
      // Nothing says a connection reads it: connecting one is the way in.
      if (!readByConnection) {
        steps.push(
          translator.translateTemplate(
            "Connect the namespace's Azure subscription on Cloud > Connect, or run the collector's `azure_monitor` receiver: either reads each of its queues and topics.",
          ),
        );
      }
      steps.push(
        translator.translateTemplate(
          "Give the connection's app or the receiver's service principal the Monitoring Reader role on the subscription or the namespace.",
        ),
        translator.translateTemplate(
          "Look at the connection's last read on Cloud > Connect, or in the collector's log for `AuthorizationFailed` or `401`: a missing role or an expired client secret stops every read.",
        ),
      );
      return {
        kind: finding.kind,
        title: title,
        description: translator.translateTemplate(
          "No {{system}} metric of this namespace arrived in the selected range, for any of its queues and topics: nothing reads its metrics from Azure Monitor, or the read fails.",
          { system: system },
        ),
        steps: steps,
        configLines: [],
        cloudConnectionLink: readByConnection ? "check" : "connect",
        linksCollectorConfiguration: true,
      };
    }
    case "namespaceTotalsOnly":
      return {
        kind: finding.kind,
        title: translator.translateTemplate(
          "Namespace {{namespace}} reports totals only",
          { namespace: finding.namespace },
        ),
        description: finding.fromCloudConnection
          ? translator.translateTemplate(
              "Your Azure cloud connection sent only the namespace's totals in the selected range, not its figures for each queue and topic.",
            )
          : translator.translateTemplate(
              "This namespace's metrics arrive for the namespace as a whole, not for each queue and topic, so none of them reach this queue. Metrics exported through diagnostic settings carry no queue or topic.",
            ),
        steps: [
          finding.fromCloudConnection
            ? translator.translateTemplate(
                "Check the connection's last read on Cloud > Connect: it says which resources it could not read.",
              )
            : translator.translateTemplate(
                "Connect the namespace's Azure subscription on Cloud > Connect, or read the namespace with the collector's `azure_monitor` receiver: either splits every metric by queue and topic (the EntityName dimension).",
              ),
        ],
        configLines: [],
        cloudConnectionLink: finding.fromCloudConnection ? "check" : "connect",
        linksCollectorConfiguration: !finding.fromCloudConnection,
      };
    default: {
      const title: string = translator.translatePlural(
        {
          one: "Metrics arrive for {{count}} other queue or topic of {{namespace}}, not this one",
          other:
            "Metrics arrive for {{count}} other queues and topics of {{namespace}}, not this one",
        },
        finding.entityCount,
        { namespace: finding.namespace },
      );
      if (!finding.fromCloudConnection) {
        return {
          kind: finding.kind,
          title: title,
          description: translator.translateTemplate(
            "The `azure_monitor` receiver asks Azure Monitor for at most `maximum_number_of_records_per_resource` series per metric and namespace, 10 unless it is raised, so the queues and topics past it go unreported.",
          ),
          steps: [
            translator.translateTemplate(
              "Raise `maximum_number_of_records_per_resource` above the number of queues and topics in the namespace (1000 in the Queues guide's configuration), and restart the collector.",
            ),
          ],
          configLines: [],
          cloudConnectionLink: null,
          linksCollectorConfiguration: true,
        };
      }
      const max: string = translator.formatNumber(
        CLOUD_CONNECTION_MAX_QUEUES_PER_NAMESPACE,
      );
      // Fewer than the connection reads: its cap left nothing out.
      if (finding.entityCount < CLOUD_CONNECTION_MAX_QUEUES_PER_NAMESPACE) {
        return {
          kind: finding.kind,
          title: title,
          description: translator.translateTemplate(
            "Your Azure cloud connection read the namespace's other queues and topics in the selected range, and Azure Monitor sent nothing for this one.",
          ),
          steps: [
            translator.translateTemplate(
              "Check that the queue still exists in the namespace under this name.",
            ),
          ],
          configLines: [],
          cloudConnectionLink: null,
          linksCollectorConfiguration: false,
        };
      }
      return {
        kind: finding.kind,
        title: title,
        description: translator.translateTemplate(
          "Your Azure cloud connection reads up to {{max}} queues and topics of a namespace, and Azure Monitor sent none of this one's metrics in the selected range.",
          { max: max },
        ),
        steps: [
          translator.translateTemplate(
            "Read the namespace with the collector's `azure_monitor` receiver too, with `maximum_number_of_records_per_resource` above its number of queues and topics.",
          ),
        ],
        configLines: [],
        cloudConnectionLink: null,
        linksCollectorConfiguration: true,
      };
    }
  }
}
