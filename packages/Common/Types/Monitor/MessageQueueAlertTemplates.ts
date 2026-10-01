import ObjectID from "../ObjectID";
import Dictionary from "../Dictionary";
import Includes from "../BaseDatabase/Includes";
import InBetween from "../BaseDatabase/InBetween";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import { EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import RollingTime from "../RollingTime/RollingTime";
import RollingTimeUtil from "../RollingTime/RollingTimeUtil";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "../Metrics/MetricFormulaConfigData";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import MetricUnitUtil from "../../Utils/MetricUnitUtil";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
  MessageQueueSignal,
  getMessageQueueMetricId,
} from "../MessageQueue/MessageQueueMetricCatalog";
import {
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
} from "../MessageQueue/MessagingTelemetryResolver";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "../MessageQueue/MessageQueueIdentity";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
  getRecoveryFilterType,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * The alert policy of the broker health metrics the Queues product curates
 * (MESSAGE_QUEUE_METRICS: the collector-contrib receivers, Prometheus
 * scrapes and cloud monitoring sources each messaging system's catalog entry
 * names), as one template per catalog entry, and the builders that turn a
 * catalog entry into a Metrics monitor on ONE queue (a MessageQueue row).
 * Pure and isomorphic, like the catalog it reads.
 *
 * WHO READS THEM
 *
 * A queue's broker health is ordinary OTel metrics, so a queue is watched by
 * a plain `MonitorType.Metrics` monitor, which gets the generic metric
 * evaluator, the monitor-overview preview and the incident root-cause chart
 * for free. In the product, this module builds one in exactly one place:
 * "Create monitor" beside a broker health gauge on a queue's Overview
 * (Components/MessageQueue/MessageQueueMetricMonitorLink.ts). The link builds
 * its query and view with buildMessageQueueMetricMonitorQuery and
 * buildMessageQueueMetricMonitorViewConfig, and reads four fields of the
 * entry's template (getMessageQueueAlertTemplateForMetric): the threshold,
 * the comparison, the severity and the window. They are only a starting
 * point: Monitor Create builds its own criteria from them, which fire on ANY
 * point above the threshold, not the held breach and the recovery that
 * THRESHOLDS below describes. The Overview's broker health reads use the
 * rest (Components/MessageQueue/MessageQueueTelemetryQueries.ts): which
 * metrics a monitor can evaluate, the attributes an observed series is read
 * with, and how late a source's points arrive.
 *
 * Nothing lists or offers the templates themselves. The Database library's
 * templates reach people through the monitor Recommendations, and
 * MonitorRecommendationResourceType has no queue member, so a template's
 * getMonitorStep (the complete monitor it stands for: queries, breach and
 * recovery criteria, incident text) has no caller in the product. The tests
 * build it and evaluate it against broker-shaped rows through the real
 * metric criteria evaluator. Offering the templates would be a feature of
 * its own.
 *
 * WHAT MAKES THEM THIS QUEUE'S MONITORS
 *
 * Nothing is stamped on a broker metric that names its queue the way
 * `oneuptime.database.server.id` names a database, and a metric monitor
 * cannot be scoped by entity key. So the query is scoped by the attributes
 * the resolver itself keys the queue on (resolveMessagingMetricDatapoint):
 * the catalog entry's destination attribute, its broker-scope attribute (an
 * Azure namespace) and its required attributes (Azure's resource `type`,
 * a CloudWatch JSON stream's `resource.service.name`) — with the values
 * EXACTLY as a series of the metric carries them. Exactly, because a metric
 * filter compiles to `attributes['<key>'] = '<value>'`: the queue's identity
 * is canonical (lowercased), but a stored "Orders" only matches "Orders".
 *
 * buildMessageQueueMetricMonitorQuery is that one code path, shared by the
 * queue page's "Create monitor" link and getMonitorStep: hand it the catalog
 * entry and the stored attributes of the series observed for it, and it
 * builds the query only from series that resolve, through the same resolver
 * ingest runs, to the same queue — so a filter can never watch another queue.
 * Several series of one queue (the partitions of a Pulsar topic, the same
 * entity under two spellings) become an `Includes` on the key that differs.
 * The attributes that tell a queue's series APART (RabbitMQ's `state`, a
 * Kafka consumer `group`) are never filtered on by the queue's own scope: a
 * monitor watches all of them. buildMessageQueueMetricMonitorViewConfig
 * then turns that query into the monitor's queries — one, or one per part
 * of a series total and the formula adding them up — for both callers too.
 *
 * WHICH METRICS GET A TEMPLATE
 *
 * The monitor path has no rate: aggregations stop at Sum / Avg / Min / Max
 * and percentiles, `EvaluateOverTimeType` has no delta, and the per-second
 * transform is chart-only. A cumulative counter (RabbitMQ's published total,
 * Kafka offsets, Pulsar's `*_total`) thresholded raw compares against a
 * since-restart total that only grows: it fires once and never clears. So
 * only catalog GAUGES get a template, and only for a signal a static
 * "at or above" threshold means something for:
 *
 *   - backlog, consumerLag, oldestMessageAge, deadLetter: a level that is
 *     healthy near zero and bad when high;
 *   - errors, throttled: a count per minute or per CloudWatch period (Azure
 *     Monitor's `*_total`, CloudWatch sums), bad when high.
 *
 * Not published, consumed or consumers. A throughput is not good or bad at
 * a fixed level (the interesting event, a drop to zero, needs a baseline or
 * an absence rule), and a queue with no consumers is often intended — a
 * batch job that connects on a schedule, a topic nobody reads yet — while
 * the harm it does, messages piling up, is exactly what Backlog catches.
 * UNALERTABLE_MESSAGE_QUEUE_COUNTERS lists every counter the rule leaves
 * out, and UNTEMPLATED_MESSAGE_QUEUE_GAUGES every gauge with a thresholdable
 * signal that is deliberately left out, with the reason; the tests prove the
 * three sets cover the catalog exactly.
 *
 * AGGREGATION CONTRACT
 *
 * A monitor window of up to three hours is read in one-minute buckets, and an
 * ungrouped query folds every series AND every sample of a bucket into one
 * number. The queue page combines a metric's series the way its catalog
 * entry says (`aggregation` within a series, then `seriesCombine` across
 * them), and a monitor must evaluate the number the page shows — so
 * getMessageQueueMetricMonitorSeed, which the "Create monitor" link uses
 * too, reads each entry this way:
 *
 *   - a per-period count (aggregation Sum: Azure Monitor's `*_total`,
 *     CloudWatch's NumberOf*, Pub/Sub's DELTA counts): each point already is
 *     one series' count for its period, so the Sum of a bucket is the count.
 *     For "sum" that adds the series up, as the page does; for "max" an
 *     entry without series keys has one series per queue (CloudWatch's), and
 *     one with series keys alerts per series — the worst series crossing IS
 *     the highest one crossing. Never Max: a CloudWatch point is a Summary,
 *     which has no max field, and on such a point the metric engine's Max
 *     reads the point's own mean (Sum / SampleCount) — CloudWatch's Average,
 *     which for SNS's NumberOfNotificationsFailed, reported as one sample of
 *     1 per failure, is 1 however many deliveries failed.
 *   - "max" over a level (the consumer group furthest behind, the worst
 *     partition, the same queue reported twice): Max of everything IS the
 *     worst series. On a CloudWatch Summary that Max reads each period's
 *     Average, which is what the page charts for the CloudWatch levels too.
 *   - "sum" over a level whose series are a closed set the source reports
 *     together on every scrape (MESSAGE_QUEUE_SERIES_TOTALS: RabbitMQ's
 *     ready and unacknowledged `state`): no single fold is right — the
 *     rabbitmq receiver scrapes every 10 seconds by default, so a Sum counts
 *     each series six times a minute and an Average halves ready +
 *     unacknowledged — so the monitor reads one query per value, with the
 *     entry's own aggregation, and adds them up with a formula: the page's
 *     total exactly.
 *   - "sum" over a level whose series are an open set (ActiveMQ's brokers, a
 *     Pulsar topic's partitions): a formula needs one query per series, and
 *     one written for the series seen today leaves out a broker or partition
 *     added tomorrow. Such a template is grouped by the entry's `seriesKeys`
 *     and alerts on each series with the entry's own aggregation — and says
 *     so: the threshold is for one series, not for the total.
 *
 * THRESHOLDS
 *
 * One default per signal (MESSAGE_QUEUE_ALERT_POLICIES), in the metric's own
 * unit, always "at or above", and a few catalog entries whose meaning differs
 * from their signal's override it (MESSAGE_QUEUE_ALERT_POLICY_OVERRIDES).
 * Every threshold is a starting point a team retunes to its own queue; each
 * default, and why, is documented where it is declared.
 *
 * The rest of this section describes the criteria getMonitorStep builds; a
 * monitor opened from the "Create monitor" link has Monitor Create's own
 * instead (see WHO READS THEM). A level must hold for the whole window (the
 * sustained evaluation the recommendation builders default to), while a
 * count fires on any one point: each point already is the count for its
 * minute or CloudWatch period, and whether a period without events arrives
 * as a 0 or as nothing at all depends on the source, so "every point" would
 * only ever mean "every period that had some". Recovery needs the value back
 * below a dead band for the whole window; for a count, and for a metric its
 * source stops reporting when it is zero, a silent window counts as zero
 * there, or an alert opened by a burst would hold the monitor offline
 * forever.
 *
 * WINDOWS AND LATE SOURCES
 *
 * A monitor reads the points whose own timestamps fall in [now - window,
 * now], and ingest stores a point at the time it measures, not the time it
 * arrives. Brokers that are scraped or push live arrive within seconds. The
 * two cloud receivers that poll arrive minutes late, by design:
 *
 *   - `aws_cloudwatch` asks CloudWatch, once per `collection_interval`, for
 *     the periods in [align(end - collection_interval), end) with end =
 *     align(now - delay), and stamps each point with its period's start
 *     (receiver/awscloudwatchreceiver metrics.go@v0.161.0). Its newest point
 *     is 11 to 17 minutes old under the documented configuration (`period`
 *     1m, `collection_interval` 5m, `delay` 10m) and 15 to 25 minutes old
 *     under the receiver's defaults (`period` 5m): a five- or ten-minute
 *     window never holds one.
 *   - `googlecloudmonitoring` asks Cloud Monitoring, once per
 *     `collection_interval`, for [now - ingestDelay - collection_interval,
 *     now - ingestDelay], ingestDelay being the metric's own (120 seconds for
 *     Pub/Sub's levels, 240 for dead_letter_message_count), and stamps each
 *     point with its interval's end (receiver.go and metrics_conversion.go
 *     @v0.161.0). A point arrives up to ingestDelay + collection_interval
 *     late — nine minutes with the receiver's default five-minute interval —
 *     so a five-minute window never reads most dead-lettered samples.
 *
 * An empty window is not harmless: a level never fires in one, and a count,
 * whose recovery reads silence as zero, reports healthy through the
 * incident. So a template reads at least its source's floor
 * (MESSAGE_QUEUE_SOURCE_WINDOW_FLOORS: thirty minutes for CloudWatch,
 * fifteen for Cloud Monitoring) instead of its signal's shorter window, and
 * "sustained" keeps its meaning: AllValues still needs EVERY point in the
 * window at or above the threshold, and a late source's window holds the
 * points of its last (window - lag) minutes — 14 to 20 one-minute
 * CloudWatch periods under the documented configuration, two to four
 * five-minute periods under the receiver's defaults, and 8 to 14 of
 * Pub/Sub's one-minute samples. The OpenTelemetry 1.0 Metric Stream names
 * its metrics like the pull receiver, so its queues read the same window:
 * longer than a stream needs, never blind. The JSON stream (`awsfirehose`)
 * pushes as CloudWatch publishes and keeps its signal's window.
 *
 * UNITS
 *
 * Every query carries its catalog entry's display unit ("messages",
 * "requests", "s") as its legend unit, so the alert text reads "1200
 * messages" rather than a bare number (Kafka declares lag as the
 * dimensionless "1", Azure Monitor its counts as "Count", a Prometheus scrape
 * nothing at all), and a time threshold holds whether the source spells
 * seconds "s" or "Seconds".
 */

export type MessageQueueAlertTemplateCategory =
  | "Backlog"
  | "Consumer Lag"
  | "Message Age"
  | "Dead Letters"
  | "Errors"
  | "Throttling";

export type MessageQueueAlertTemplateSeverity = "Critical" | "Warning";

/*
 * The stored attributes of one series of a metric, as the Metric table holds
 * them: datapoint attributes bare, resource attributes `resource.`-prefixed.
 */
export type MessageQueueObservedAttributes = Readonly<Record<string, unknown>>;

/*
 * A total a monitor adds up from a closed set of series: one query per
 * value of `key`, each filtered `key = value`, summed by a formula (see
 * MESSAGE_QUEUE_SERIES_TOTALS).
 */
export interface MessageQueueSeriesTotal {
  // The series key whose values are the parts ("state").
  key: string;
  // Every value it takes, in the order the formula adds them.
  values: Array<string>;
}

export interface MessageQueueAlertTemplateArgs {
  /*
   * The stored attributes of the series this queue's metric arrives with —
   * one entry per series (a partitioned Pulsar topic reports one per
   * partition), read from the template's own metric. Only series that
   * resolve to the queue are used (buildMessageQueueMetricMonitorQuery).
   */
  observedSeries: ReadonlyArray<MessageQueueObservedAttributes>;
  /*
   * The queue the monitor is for (parseMessageQueueIdentifier of the row's
   * queueIdentifier). When given, a series that resolves to any other queue
   * is ignored; when not, the first series that resolves decides.
   */
  identity?: MessageQueueIdentity | null | undefined;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

/*
 * One catalog entry's alert. The "Create monitor" link reads `threshold`,
 * `filterType`, `severity` and `rollingTime`; everything else describes the
 * monitor getMonitorStep builds (see WHO READS THEM).
 */
export interface MessageQueueAlertTemplate {
  // "message-queue-<system>-<metric name>", kebab-cased: stable per entry.
  id: string;
  name: string;
  description: string;
  category: MessageQueueAlertTemplateCategory;
  severity: MessageQueueAlertTemplateSeverity;
  // Always Metrics; carried per template the way the other libraries do.
  monitorType: MonitorType;
  // The catalog entry's canonical system ("servicebus", "aws_sqs").
  system: string;
  // The component that emits the metric, as the catalog names it.
  receiver: string;
  signal: MessageQueueSignal;
  // getMessageQueueMetricId of the entry: `${system}:${metricName}`.
  metricId: string;
  metricName: string;
  // Every metric name the template's query reads — always one.
  metricNames: Array<string>;
  // The catalog's display unit, which the query carries as its legend unit.
  unit: string;
  // How each query folds a bucket (getMessageQueueMetricMonitorSeed).
  aggregationType: MetricsAggregationType;
  // The keys the monitor alerts per; empty when it reads as one queue.
  groupByAttributeKeys: Array<string>;
  /*
   * The series the monitor adds up with a formula, one query each, or null
   * when it reads one query (MESSAGE_QUEUE_SERIES_TOTALS).
   */
  seriesTotal: MessageQueueSeriesTotal | null;
  filterType: FilterType;
  // In the metric's own unit.
  threshold: number;
  // "at or above 1,000 messages" — the comparison in words.
  thresholdLabel: string;
  // AllValues (a level held for the window) or AnyValue (a count, per minute).
  evaluation: EvaluateOverTimeType;
  /*
   * The signal's window, widened to the source's floor when its points
   * arrive late (MESSAGE_QUEUE_SOURCE_WINDOW_FLOORS).
   */
  rollingTime: RollingTime;
  // Whether recovery reads a silent window as zero.
  recoverOnNoData: boolean;
  /*
   * The monitor step for one queue, or null when none of the observed series
   * resolves to the queue under this template's metric — a template never
   * builds a monitor that would watch nothing or another queue. Nothing in
   * the product calls it yet (see WHO READS THEM).
   */
  getMonitorStep: (args: MessageQueueAlertTemplateArgs) => MonitorStep | null;
}

/*
 * The signals a static "at or above" threshold means something for (see
 * WHICH METRICS GET A TEMPLATE in the header). published, consumed and
 * consumers are the rest of MessageQueueSignal.
 */
export const MESSAGE_QUEUE_THRESHOLDABLE_SIGNALS: ReadonlyArray<MessageQueueSignal> =
  [
    "backlog",
    "consumerLag",
    "oldestMessageAge",
    "deadLetter",
    "errors",
    "throttled",
  ];

/*
 * "level": a value at a point in time (a queue's depth, a lag, an age).
 * "count": how many events a minute or a CloudWatch period saw — the catalog
 * marks those with aggregation Sum, because each point already is the count
 * for its period and is summed within a bucket.
 */
export type MessageQueueAlertMeasure = "level" | "count";

export function getMessageQueueAlertMeasure(
  descriptor: MessageQueueMetricDescriptor,
): MessageQueueAlertMeasure {
  return descriptor.aggregation === MetricsAggregationType.Sum
    ? "count"
    : "level";
}

/*
 * The default alert for one (signal, measure) pair. `threshold` is written in
 * `thresholdUnit` when it is a time (converted to the metric's own unit when
 * the template is built), and otherwise in the metric's own count unit.
 */
export interface MessageQueueAlertPolicyDefault {
  signal: MessageQueueSignal;
  measure: MessageQueueAlertMeasure;
  threshold: number;
  thresholdUnit: string | null;
  evaluation: EvaluateOverTimeType;
  rollingTime: RollingTime;
  severity: MessageQueueAlertTemplateSeverity;
  category: MessageQueueAlertTemplateCategory;
  // Appended to the catalog title to name the template ("Queue depth High").
  nameSuffix: string;
  // The query's alias; one query per template, so it never collides.
  metricAlias: string;
  // What the breach means and how to retune it, as full sentences.
  meaning: string;
  // What on-call checks first, as full sentences.
  incidentDescription: string;
}

export const MESSAGE_QUEUE_ALERT_POLICIES: ReadonlyArray<MessageQueueAlertPolicyDefault> =
  [
    /*
     * A thousand messages held for ten minutes. A work queue that keeps up
     * drains to near empty between bursts, so a thousand waiting messages
     * that do not go away within ten minutes means the queue fills faster
     * than it drains, or nothing drains it; a burst that drains inside the
     * window never fires. For the brokers that track each message
     * (RabbitMQ, ActiveMQ, SQS, Service Bus, Pub/Sub subscriptions) and the
     * ready count of RocketMQ and Pulsar's topic backlog.
     */
    {
      signal: "backlog",
      measure: "level",
      threshold: 1000,
      thresholdUnit: null,
      evaluation: EvaluateOverTimeType.AllValues,
      rollingTime: RollingTime.Past10Minutes,
      severity: "Warning",
      category: "Backlog",
      nameSuffix: "High",
      metricAlias: "queue_backlog",
      meaning:
        "Messages are arriving faster than consumers take them, or nothing is consuming them. A healthy queue drains to near empty between bursts, so retune to a few times this queue's normal peak.",
      incidentDescription:
        "Messages are piling up in the queue. Check that its consumers are running and connected, whether they are failing and returning messages to the queue, and whether they need more instances to keep up with the publish rate.",
    },
    /*
     * Ten thousand messages held for ten minutes — ten times the backlog
     * default, because a consumer group's lag is measured against the offset
     * it last COMMITTED: a healthy Kafka consumer commits every few seconds
     * (five by default), so on a topic taking a few thousand messages a
     * second it trails by thousands between commits, all the time. The same
     * default serves Pulsar's subscription backlog and RocketMQ's lag, the
     * other log-based brokers.
     */
    {
      signal: "consumerLag",
      measure: "level",
      threshold: 10000,
      thresholdUnit: null,
      evaluation: EvaluateOverTimeType.AllValues,
      rollingTime: RollingTime.Past10Minutes,
      severity: "Warning",
      category: "Consumer Lag",
      nameSuffix: "High",
      metricAlias: "consumer_lag",
      meaning:
        "Consumers are falling behind what is produced. A healthy consumer group that commits its offsets every few seconds already trails a busy topic by thousands of messages, so retune to a few times this topic's normal lag.",
      incidentDescription:
        "The consumer group is falling behind its producers. Check that every consumer is running and not stuck rebalancing, whether one partition is stuck on a message its consumer cannot process, and whether the group needs more consumers (up to one per partition).",
    },
    /*
     * Ten minutes of waiting, held for five. A consumer that keeps up takes a
     * message within seconds, so a message ten minutes old means consumers
     * are stopped or far behind, or keep failing on one message that is
     * received and returned until its dead-letter policy moves it aside. An
     * age already is a duration, so a shorter sustain (five minutes) is
     * enough to ignore one late sample.
     */
    {
      signal: "oldestMessageAge",
      measure: "level",
      threshold: 600,
      thresholdUnit: "s",
      evaluation: EvaluateOverTimeType.AllValues,
      rollingTime: RollingTime.Past5Minutes,
      severity: "Warning",
      category: "Message Age",
      nameSuffix: "High",
      metricAlias: "oldest_message_age",
      meaning:
        "Messages are waiting far longer than a working consumer takes: consumers are stopped or far behind, or keep failing on a message that is received and returned again and again. Retune to how long a message may wait before it is late.",
      incidentDescription:
        "The oldest message has waited longer than a working consumer takes. Check that consumers are running; a message that fails every time it is processed is received and returned until the dead-letter policy moves it aside, so look at its receive count.",
    },
    /*
     * Any dead-lettered message, held for five minutes: each one failed
     * every delivery attempt and waits for a person. It stays open until
     * the dead-letter queue is drained, which is the point.
     */
    {
      signal: "deadLetter",
      measure: "level",
      threshold: 1,
      thresholdUnit: null,
      evaluation: EvaluateOverTimeType.AllValues,
      rollingTime: RollingTime.Past5Minutes,
      severity: "Warning",
      category: "Dead Letters",
      nameSuffix: "",
      metricAlias: "dead_letters",
      meaning:
        "Messages that failed every delivery attempt are waiting in the dead-letter queue for someone to inspect them. Raise the threshold if the dead-letter queue is drained on a schedule.",
      incidentDescription:
        "Messages failed every delivery attempt and were moved to the dead-letter queue. Inspect them to find the failing handler or the malformed payload, fix the cause, then resubmit or discard them.",
    },
    // Any message dead-lettered in any one minute.
    {
      signal: "deadLetter",
      measure: "count",
      threshold: 1,
      thresholdUnit: null,
      evaluation: EvaluateOverTimeType.AnyValue,
      rollingTime: RollingTime.Past5Minutes,
      severity: "Warning",
      category: "Dead Letters",
      nameSuffix: "",
      metricAlias: "dead_letters",
      meaning:
        "Messages are being moved to a dead-letter queue after failing every delivery attempt.",
      incidentDescription:
        "Messages failed every delivery attempt and were moved to a dead-letter queue. Inspect them to find the failing handler or the malformed payload, fix the cause, then resubmit or discard them.",
    },
    /*
     * Ten in any one minute. Clients retry a failed request and brokers
     * redeliver a failed message, so one failure goes unnoticed; ten in a
     * minute is a pattern, not a blip.
     */
    {
      signal: "errors",
      measure: "count",
      threshold: 10,
      thresholdUnit: null,
      evaluation: EvaluateOverTimeType.AnyValue,
      rollingTime: RollingTime.Past5Minutes,
      severity: "Warning",
      category: "Errors",
      nameSuffix: "",
      metricAlias: "failures",
      meaning:
        "Failures are recurring rather than occasional: clients retry a failed request and brokers redeliver a failed message, so a single failure goes unnoticed, while a burst like this is a pattern, not a blip. Retune to this queue's volume.",
      incidentDescription:
        "Operations on the queue are failing. The broker's own diagnostics name the operation and the error: failures the broker causes point at the service itself (check its health status), while failures its clients cause usually follow a deployment, a credential or permission change, a consumer that crashes on a message, or an entity that was deleted or disabled.",
    },
    /*
     * Ten in any one minute: a throttled client backs off before it retries,
     * so a few throttled requests at a peak are absorbed, while ten a minute
     * means the namespace is out of capacity.
     */
    {
      signal: "throttled",
      measure: "count",
      threshold: 10,
      thresholdUnit: null,
      evaluation: EvaluateOverTimeType.AnyValue,
      rollingTime: RollingTime.Past5Minutes,
      severity: "Warning",
      category: "Throttling",
      nameSuffix: "",
      metricAlias: "throttled_requests",
      meaning:
        "The broker is refusing requests because the namespace is out of capacity, and every throttled client backs off before it retries, which slows everything on the namespace. If it persists, add capacity (Service Bus Premium messaging units, Event Hubs throughput or processing units).",
      incidentDescription:
        "The broker is throttling requests because the namespace is out of capacity. Look for a traffic spike or a new heavy client; if throttling persists, scale the namespace up.",
    },
  ];

/*
 * Catalog entries whose meaning differs from their signal's, and so from its
 * default. Keyed by system and by every stored name the metric has (both
 * CloudWatch shapes of one metric are one override).
 */
export interface MessageQueueAlertPolicyOverride {
  system: string;
  metricNames: ReadonlyArray<string>;
  threshold?: number | undefined;
  rollingTime?: RollingTime | undefined;
  severity?: MessageQueueAlertTemplateSeverity | undefined;
  // Replaces the generated name, before any "(JSON stream)" qualifier.
  name?: string | undefined;
  recoverOnNoData?: boolean | undefined;
  meaning?: string | undefined;
  incidentDescription?: string | undefined;
  // Why the override exists, for the reader and the tests.
  reason: string;
}

export const MESSAGE_QUEUE_ALERT_POLICY_OVERRIDES: ReadonlyArray<MessageQueueAlertPolicyOverride> =
  [
    {
      system: "aws_sqs",
      metricNames: [
        "amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible",
        "approximatenumberofmessagesnotvisible",
      ],
      /*
       * 90% of the in-flight quota of a standard queue (about 120,000
       * messages received but not yet deleted): early enough to act before
       * receives start failing, and far above what a busy queue that is
       * draining keeps in flight.
       */
      threshold: 108000,
      /*
       * Critical, and held for five minutes rather than a backlog's ten: the
       * last 10% of the quota is what stands between the queue and receives
       * that fail.
       */
      rollingTime: RollingTime.Past5Minutes,
      severity: "Critical",
      name: "Messages In Flight Near Quota",
      meaning:
        "A standard queue keeps about 120,000 messages in flight (received but not yet deleted) at most; past that, short-polling receives fail with OverLimit and long polls return nothing, so every consumer stalls. This fires at 90% of that quota; for a FIFO queue, retune to 90% of its own quota.",
      incidentDescription:
        "Close to 120,000 messages are received but not yet deleted, so receives are about to fail. Check that consumers delete messages once they have processed them, and whether a long visibility timeout keeps failed messages in flight.",
      reason:
        "Messages in flight are not a backlog: a busy queue keeps thousands in flight while it drains, and the one level that matters is the queue's in-flight quota.",
    },
    {
      system: "aws_sqs",
      metricNames: [
        "amazonaws.com/aws/sqs/approximateageofoldestmessage",
        "approximateageofoldestmessage",
      ],
      recoverOnNoData: true,
      reason:
        "CloudWatch reports this metric only while the queue holds a message, so a silent window is an empty queue: recovery reads it as an age of zero.",
    },
  ];

/*
 * Catalog gauges with a thresholdable signal that deliberately get no
 * template. The queue page still charts them, and its "Create monitor" link
 * still builds a monitor on them for a team that wants one.
 */
export const UNTEMPLATED_MESSAGE_QUEUE_GAUGES: ReadonlyArray<{
  system: string;
  metricName: string;
  reason: string;
}> = [
  {
    system: "kafka",
    metricName: "kafka.consumer_group.lag",
    reason:
      "Every partition's lag is part of its consumer group's lag, so at Consumer lag's threshold it could only fire after that template has, and no fixed lower threshold tells one stuck partition from a busy one: a healthy group that commits every few seconds trails each busy partition by thousands of messages.",
  },
  {
    system: "activemq",
    metricName: "activemq.message.enqueue.average_duration",
    reason:
      "It is a running average the broker keeps from its start (AverageEnqueueTime), so after one stall it stays high long after the destination has drained, and on a destination with a long history a new stall barely moves it: a threshold on it fires late and does not clear. Queue size catches a stall directly.",
  },
  {
    system: "activemq",
    metricName: "activemq.message.wait_time.avg",
    reason:
      "It is the same running average the broker keeps from its start (AverageEnqueueTime), under the JMX Scraper's legacy name, so a threshold on it fires late and does not clear. Queue size (legacy names) catches a stall directly.",
  },
  {
    system: "pulsar",
    metricName: "pulsar_storage_backlog_age_seconds",
    reason:
      "It read -1 (unknown) on topics that held a backlog in a live capture from Pulsar 4.2.4 on its default configuration, so a threshold on it would watch nothing there. Subscription backlog catches a subscription that stopped acknowledging.",
  },
];

/*
 * What each counter would be tempting to alert on, by signal: the catalog
 * marks every cumulative total `kind: "counter"`, and the monitor path has
 * no rate to threshold it with.
 */
const COUNTER_TEMPTATION_BY_SIGNAL: Readonly<
  Record<MessageQueueSignal, string>
> = {
  published: "publishing stopping or spiking",
  consumed: "consumers stopping",
  errors: "a rise in failed or expired messages",
  deadLetter: "messages being dead-lettered",
  backlog: "a growing backlog",
  consumerLag: "a growing lag",
  oldestMessageAge: "messages getting old",
  throttled: "throttling",
  consumers: "consumers leaving",
};

/*
 * Every catalog counter, which no template reads, and what a team would
 * reach for it for. The honest workaround for a team that needs one alerted
 * today is a `cumulative_to_delta` processor in its collector pipeline
 * (`cumulativetodelta`, its old name, is a deprecated alias in
 * collector-contrib 0.161.0) converting a COPY of the counter, made under a
 * name of its own, into per-scrape deltas that a Sum over the window
 * thresholds correctly; `initial_value: drop` keeps back the copy's first
 * point after a collector start, the counter's whole running total. The
 * config is at /docs/telemetry/queues#alerting. Never convert the counter
 * itself: the queue page reads each counter as a running total and charts
 * how fast it grows, so a counter converted in place charts about 0/s for
 * steady traffic. The processor only converts sums, so it leaves Kafka's
 * offsets and Pulsar's totals, which reach the collector as gauges, as they
 * are.
 */
export const UNALERTABLE_MESSAGE_QUEUE_COUNTERS: ReadonlyArray<{
  system: string;
  metricName: string;
  wouldAlertOn: string;
}> = MESSAGE_QUEUE_METRICS.filter(
  (descriptor: MessageQueueMetricDescriptor): boolean => {
    return descriptor.kind === "counter";
  },
).map(
  (
    descriptor: MessageQueueMetricDescriptor,
  ): { system: string; metricName: string; wouldAlertOn: string } => {
    return {
      system: descriptor.system,
      metricName: descriptor.metricName,
      wouldAlertOn: COUNTER_TEMPTATION_BY_SIGNAL[descriptor.signal],
    };
  },
);

/*
 * The shortest window a monitor on a late source may read (see WINDOWS AND
 * LATE SOURCES in the header), keyed by the catalog entry's `receiver`: long
 * enough that, under the documented collector configuration AND the
 * receiver's own defaults, no evaluation finds the window empty and every
 * point is read by at least one evaluation. A source not listed delivers
 * within seconds and keeps its signal's window.
 */
export interface MessageQueueSourceWindowFloor {
  // The catalog `receiver` whose entries it applies to.
  receiver: string;
  minimumRollingTime: RollingTime;
  // How late the source's points arrive, as the template description says it.
  reason: string;
}

export const MESSAGE_QUEUE_SOURCE_WINDOW_FLOORS: ReadonlyArray<MessageQueueSourceWindowFloor> =
  [
    {
      receiver: "aws_cloudwatch",
      /*
       * The newest point is up to delay + 2 × period + collection_interval
       * old: 17 minutes under the documented configuration, 25 under the
       * receiver's defaults. Thirty is the shortest RollingTime above both.
       */
      minimumRollingTime: RollingTime.Past30Minutes,
      reason:
        "The collector's `aws_cloudwatch` receiver fetches CloudWatch's periods `delay` (ten minutes) after they end, `collection_interval` (five minutes) at a time, so its points arrive 11 to 17 minutes late, and up to 25 minutes late with the receiver's default five-minute `period`: the window is thirty minutes so that it always holds some.",
    },
    {
      receiver: "googlecloudmonitoring",
      /*
       * A sample arrives up to ingestDelay + collection_interval late: nine
       * minutes for dead_letter_message_count (240 seconds) with the
       * receiver's default five-minute interval, and the next one-minute
       * evaluation reads it up to ten minutes after it was taken — the very
       * edge of a Past10Minutes window, which any export delay tips over.
       * Fifteen leaves a margin.
       */
      minimumRollingTime: RollingTime.Past15Minutes,
      reason:
        "Cloud Monitoring makes a Pub/Sub sample visible two to four minutes after it is taken, and the collector's `googlecloudmonitoring` receiver fetches what has become visible once per `collection_interval`, so a point arrives up to nine minutes late with the receiver's default five-minute interval: the window is fifteen minutes so that it always holds some and reads every point.",
    },
  ];

/**
 * The window floor of a catalog entry's source, or null when its points
 * arrive live.
 */
export function getMessageQueueSourceWindowFloor(
  descriptor: MessageQueueMetricDescriptor,
): MessageQueueSourceWindowFloor | null {
  if (!descriptor) {
    return null;
  }

  for (const floor of MESSAGE_QUEUE_SOURCE_WINDOW_FLOORS) {
    if (floor.receiver === descriptor.receiver) {
      return floor;
    }
  }

  return null;
}

function getRollingTimeSeconds(rollingTime: RollingTime): number {
  const window: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(rollingTime);

  return (window.endValue.getTime() - window.startValue.getTime()) / 1000;
}

/**
 * The window a monitor on this catalog entry reads: `preferred`, widened to
 * the entry's source floor when that is longer. The templates read their
 * signal's window through it, and the "Create monitor" link its default.
 */
export function getMessageQueueMetricMonitorRollingTime(
  descriptor: MessageQueueMetricDescriptor,
  preferred: RollingTime,
): RollingTime {
  const floor: MessageQueueSourceWindowFloor | null =
    getMessageQueueSourceWindowFloor(descriptor);

  if (
    floor &&
    getRollingTimeSeconds(floor.minimumRollingTime) >
      getRollingTimeSeconds(preferred)
  ) {
    return floor.minimumRollingTime;
  }

  return preferred;
}

/*
 * Catalog entries whose series are the parts of one total (seriesCombine
 * "sum" over a level) AND a closed set the source reports together, on
 * every scrape, under one timestamp — so each bucket holds every part, and
 * a formula adding one query per value reads exactly the total the queue
 * page shows. Entries whose series are an open set (ActiveMQ's brokers, a
 * Pulsar topic's partitions) are left out on purpose: a formula over the
 * series seen today leaves out a broker or partition added tomorrow, so
 * their monitors alert per series instead (see AGGREGATION CONTRACT).
 */
export interface MessageQueueSeriesTotalDefinition {
  system: string;
  metricName: string;
  // The entry's one series key.
  seriesKey: string;
  // Every value the source gives it, as stored, in the order they are added.
  values: ReadonlyArray<string>;
  // Why the set is closed and complete in every scrape.
  reason: string;
}

export const MESSAGE_QUEUE_SERIES_TOTALS: ReadonlyArray<MessageQueueSeriesTotalDefinition> =
  [
    {
      system: "rabbitmq",
      metricName: "rabbitmq.message.current",
      seriesKey: "state",
      values: ["ready", "unacknowledged"],
      reason:
        "The rabbitmq receiver records both states of every queue on every scrape, under the scrape's one timestamp (collectQueue in receiver/rabbitmqreceiver scraper.go@v0.161.0), so the average of each state over a bucket, added together, is the queue's average depth.",
    },
  ];

function getSeriesTotalDefinition(
  descriptor: MessageQueueMetricDescriptor,
): MessageQueueSeriesTotalDefinition | null {
  const seriesKeys: ReadonlyArray<string> = descriptor.seriesKeys || [];

  for (const definition of MESSAGE_QUEUE_SERIES_TOTALS) {
    if (
      definition.system === descriptor.system &&
      definition.metricName === descriptor.metricName &&
      seriesKeys.length === 1 &&
      seriesKeys[0] === definition.seriesKey
    ) {
      return definition;
    }
  }

  return null;
}

// --- the shared query builder (templates and the "Create monitor" link) ---

/*
 * Whether a monitor can evaluate this catalog entry at all: a gauge, whose
 * series are all part of the queue. A counter only grows (see the header),
 * and an entry with `excludeSeriesWithAttributes` needs "this attribute is
 * absent" to leave out its finer-grained repeats, which an equality filter
 * cannot say — both are refused rather than built into a monitor that
 * compares the wrong number.
 */
export function isMessageQueueMetricMonitorable(
  descriptor: MessageQueueMetricDescriptor,
): boolean {
  if (!descriptor || descriptor.kind !== "gauge") {
    return false;
  }

  return !(
    descriptor.excludeSeriesWithAttributes &&
    descriptor.excludeSeriesWithAttributes.length > 0
  );
}

/*
 * How a monitor reads a catalog entry: each query's aggregation, the keys it
 * alerts per (empty: one number for the queue), the series it adds up with a
 * formula, the shortest window its source allows, and — when that is not
 * exactly the number the queue page shows — one sentence saying what it
 * measures instead.
 */
export interface MessageQueueMetricMonitorSeed {
  aggregationType: MetricsAggregationType;
  groupByAttributeKeys: Array<string>;
  // Set when the monitor adds a closed set of series up with a formula.
  seriesTotal: MessageQueueSeriesTotal | null;
  // The source's window floor (MESSAGE_QUEUE_SOURCE_WINDOW_FLOORS), or null.
  minimumRollingTime: RollingTime | null;
  note: string | null;
}

function aggregationLabel(aggregationType: MetricsAggregationType): string {
  return aggregationType === MetricsAggregationType.Avg
    ? "Average"
    : String(aggregationType);
}

/**
 * The query shape that evaluates what the queue page shows for this entry
 * (see AGGREGATION CONTRACT in the header), or null for an entry no monitor
 * can evaluate (isMessageQueueMetricMonitorable).
 */
export function getMessageQueueMetricMonitorSeed(
  descriptor: MessageQueueMetricDescriptor,
): MessageQueueMetricMonitorSeed | null {
  if (!isMessageQueueMetricMonitorable(descriptor)) {
    return null;
  }

  const aggregation: MetricsAggregationType = descriptor.aggregation;
  const seriesKeys: Array<string> = [...(descriptor.seriesKeys || [])];
  const floor: MessageQueueSourceWindowFloor | null =
    getMessageQueueSourceWindowFloor(descriptor);
  const shape: {
    aggregationType: MetricsAggregationType;
    groupByAttributeKeys: Array<string>;
    seriesTotal: MessageQueueSeriesTotal | null;
    note: string | null;
  } = getMonitorShape({
    descriptor: descriptor,
    aggregation: aggregation,
    seriesKeys: seriesKeys,
  });

  return {
    ...shape,
    minimumRollingTime: floor ? floor.minimumRollingTime : null,
  };
}

function getMonitorShape(data: {
  descriptor: MessageQueueMetricDescriptor;
  aggregation: MetricsAggregationType;
  seriesKeys: Array<string>;
}): {
  aggregationType: MetricsAggregationType;
  groupByAttributeKeys: Array<string>;
  seriesTotal: MessageQueueSeriesTotal | null;
  note: string | null;
} {
  const aggregation: MetricsAggregationType = data.aggregation;
  const seriesKeys: Array<string> = data.seriesKeys;

  switch (data.descriptor.seriesCombine) {
    case "max":
      if (aggregation === MetricsAggregationType.Sum) {
        /*
         * A per-period count: the Sum of a bucket is one series' count for
         * its period, never Max, which on a CloudWatch Summary reads the
         * period's Average (see AGGREGATION CONTRACT). With series keys, the
         * worst series crossing is the highest one crossing.
         */
        return {
          aggregationType: MetricsAggregationType.Sum,
          groupByAttributeKeys: seriesKeys,
          seriesTotal: null,
          note:
            seriesKeys.length > 0
              ? `The chart shows the highest of this metric's series (one per ${seriesKeys.join(
                  " / ",
                )}). A monitor would add them up, so this one alerts on each series separately, which fires exactly when the highest one crosses the threshold.`
              : null,
        };
      }

      return {
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKeys: [],
        seriesTotal: null,
        note:
          aggregation === MetricsAggregationType.Max
            ? null
            : `The chart shows the highest of this metric's series. A monitor folds every series and sample into one number, so this one takes their Max instead of each series' ${aggregationLabel(
                aggregation,
              )}.`,
      };
    case "avg":
      return {
        aggregationType: aggregation,
        groupByAttributeKeys: [],
        seriesTotal: null,
        note: null,
      };
    default: {
      // "sum".
      if (aggregation === MetricsAggregationType.Sum) {
        return {
          aggregationType: MetricsAggregationType.Sum,
          groupByAttributeKeys: [],
          seriesTotal: null,
          note: null,
        };
      }

      const total: MessageQueueSeriesTotalDefinition | null =
        getSeriesTotalDefinition(data.descriptor);

      if (total) {
        // The page's own total: one query per part, added up by a formula.
        return {
          aggregationType: aggregation,
          groupByAttributeKeys: [],
          seriesTotal: { key: total.seriesKey, values: [...total.values] },
          note: null,
        };
      }

      return {
        aggregationType: aggregation,
        groupByAttributeKeys: seriesKeys,
        seriesTotal: null,
        note:
          seriesKeys.length > 0
            ? `The chart adds this metric's series up (one per ${seriesKeys.join(
                " / ",
              )}). They are not a fixed set, so a monitor cannot add them together the way the chart does: this one alerts on each series separately. Set a threshold for one series, not for the total.`
            : null,
      };
    }
  }
}

/**
 * Every stored key a monitor filter on this entry can pin: its destination,
 * broker-scope and required attributes. The attributes a series of the
 * metric has to be read with to build its filter.
 */
export function getMessageQueueMetricFilterAttributeKeys(
  descriptor: MessageQueueMetricDescriptor,
): Array<string> {
  const keys: Array<string> = [];

  for (const key of [
    ...descriptor.destinationAttributes,
    ...(descriptor.scopeAttributes || []),
    ...Object.keys(descriptor.requiredAttributes || {}),
  ]) {
    if (!keys.includes(key)) {
      keys.push(key);
    }
  }

  return keys;
}

/*
 * A metric monitor query on one queue: the metric, the exact stored values
 * that scope it to the queue, and how it folds and groups.
 */
export interface MessageQueueMetricMonitorQuery {
  // getMessageQueueMetricId of the entry the query reads.
  metricId: string;
  metricName: string;
  /*
   * Stored key → the value (an equality filter) or values (an Includes) the
   * observed series carry, in the order: destination, broker scope, required
   * attributes.
   */
  attributes: Dictionary<string | Includes>;
  aggregationType: MetricsAggregationType;
  groupByAttributeKeys: Array<string>;
  /*
   * The series the monitor adds up (the seed's), which
   * buildMessageQueueMetricMonitorViewConfig reads with one query each.
   */
  seriesTotal: MessageQueueSeriesTotal | null;
  // The catalog's display unit, carried as the query's legend unit.
  unit: string;
}

function readObserved(
  series: MessageQueueObservedAttributes,
  key: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(series, key)
    ? series[key]
    : undefined;
}

/*
 * The text a value is stored as, which is what an equality filter has to
 * match: a string exactly as it is — surrounding whitespace included — and a
 * number or boolean as its String() form. Null for a value that is absent,
 * blank or not a scalar, which the resolver does not read a destination,
 * scope or required value from either.
 */
function observedText(value: unknown): string | null {
  let text: string | null = null;

  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number") {
    text = Number.isFinite(value) ? String(value) : null;
  } else if (typeof value === "boolean" || typeof value === "bigint") {
    text = String(value);
  }

  return text !== null && text.trim().length > 0 ? text : null;
}

/*
 * The (key, stored value) pairs that pin one series to its queue: the first
 * destination key with a value (the resolver's own "first non-empty wins"),
 * the first broker-scope key with one, and every required key. Null when the
 * series lacks a destination or a required attribute.
 */
function getSeriesFilter(
  descriptor: MessageQueueMetricDescriptor,
  series: MessageQueueObservedAttributes,
): Array<[string, string]> | null {
  const firstWithValue: (
    keys: ReadonlyArray<string>,
  ) => [string, string] | null = (
    keys: ReadonlyArray<string>,
  ): [string, string] | null => {
    for (const key of keys) {
      const text: string | null = observedText(readObserved(series, key));

      if (text !== null) {
        return [key, text];
      }
    }

    return null;
  };

  const destination: [string, string] | null = firstWithValue(
    descriptor.destinationAttributes,
  );

  if (!destination) {
    return null;
  }

  const entries: Array<[string, string]> = [destination];

  const scope: [string, string] | null = descriptor.scopeAttributes
    ? firstWithValue(descriptor.scopeAttributes)
    : null;

  if (scope) {
    entries.push(scope);
  }

  for (const key of Object.keys(descriptor.requiredAttributes || {})) {
    const text: string | null = observedText(readObserved(series, key));

    if (text === null) {
      return null;
    }

    entries.push([key, text]);
  }

  return entries;
}

/*
 * The identifier of the queue a series of this entry belongs to, through the
 * same resolver ingest stamps entity keys with — or null when the series
 * resolves to nothing, or to another system's entry (a Service Bus name
 * observed on an Event Hubs series).
 */
function getSeriesQueueIdentifier(
  descriptor: MessageQueueMetricDescriptor,
  series: MessageQueueObservedAttributes,
): string | null {
  const resolved: ResolvedMessagingDestination | null =
    resolveMessagingMetricDatapoint({
      metricName: descriptor.metricName,
      getAttribute: (key: string): unknown => {
        return readObserved(series, key);
      },
    });

  if (!resolved || resolved.system !== descriptor.system) {
    return null;
  }

  const identity: MessageQueueIdentity | null = toMessageQueueIdentity({
    system: resolved.system,
    brokerScope: resolved.brokerScope,
    destination: resolved.destination,
  });

  return identity ? buildMessageQueueIdentifier(identity) : null;
}

/**
 * The metric monitor query that watches one queue through one catalog
 * entry, built from the stored attributes of the series observed for it —
 * the code path the queue page's "Create monitor" link and getMonitorStep
 * share. Null when the entry cannot be monitored
 * (isMessageQueueMetricMonitorable) or no observed series resolves to the
 * queue.
 *
 * A series is used only when the resolver maps it to the queue under this
 * entry — `identity`'s queue when given, else the first series that
 * resolves — and when it pins the same keys as the first series used (one
 * spelling of Azure's entity key, not two: an AND of equalities cannot say
 * "this key or that one"). Values are kept exactly as stored, and a key the
 * used series disagree on (a Pulsar topic's partitions) becomes an Includes
 * of every value, sorted. A queue whose destination is templated from many
 * raw names (a UUID) is watched under the names observed.
 */
export function buildMessageQueueMetricMonitorQuery(data: {
  descriptor: MessageQueueMetricDescriptor;
  observedSeries: ReadonlyArray<MessageQueueObservedAttributes>;
  identity?: MessageQueueIdentity | null | undefined;
}): MessageQueueMetricMonitorQuery | null {
  if (!data || !data.descriptor) {
    return null;
  }

  const descriptor: MessageQueueMetricDescriptor = data.descriptor;
  const seed: MessageQueueMetricMonitorSeed | null =
    getMessageQueueMetricMonitorSeed(descriptor);

  if (!seed) {
    return null;
  }

  let queueIdentifier: string | null = null;

  if (data.identity) {
    queueIdentifier = buildMessageQueueIdentifier(data.identity);

    if (!queueIdentifier) {
      return null;
    }
  }

  let keys: Array<string> | null = null;
  const valuesByKey: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  const observedSeries: ReadonlyArray<unknown> = Array.isArray(
    data.observedSeries,
  )
    ? data.observedSeries
    : [];

  for (const candidate of observedSeries) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      continue;
    }

    const series: MessageQueueObservedAttributes =
      candidate as MessageQueueObservedAttributes;
    const entries: Array<[string, string]> | null = getSeriesFilter(
      descriptor,
      series,
    );

    if (!entries) {
      continue;
    }

    const identifier: string | null = getSeriesQueueIdentifier(
      descriptor,
      series,
    );

    if (!identifier) {
      continue;
    }

    if (queueIdentifier === null) {
      queueIdentifier = identifier;
    } else if (identifier !== queueIdentifier) {
      continue;
    }

    const seriesKeys: Array<string> = entries.map(
      (entry: [string, string]): string => {
        return entry[0];
      },
    );

    if (keys === null) {
      keys = seriesKeys;
    } else if (keys.join("\n") !== seriesKeys.join("\n")) {
      continue;
    }

    for (const [key, value] of entries) {
      const values: Array<string> = valuesByKey.get(key) || [];

      if (!values.includes(value)) {
        values.push(value);
      }

      valuesByKey.set(key, values);
    }
  }

  if (keys === null) {
    return null;
  }

  const attributes: Dictionary<string | Includes> = {};

  for (const key of keys) {
    const values: Array<string> = [...(valuesByKey.get(key) || [])].sort();

    attributes[key] = values.length === 1 ? values[0]! : new Includes(values);
  }

  return {
    metricId: getMessageQueueMetricId(descriptor),
    metricName: descriptor.metricName,
    attributes: attributes,
    aggregationType: seed.aggregationType,
    groupByAttributeKeys: [...seed.groupByAttributeKeys],
    seriesTotal: seed.seriesTotal
      ? { key: seed.seriesTotal.key, values: [...seed.seriesTotal.values] }
      : null,
    unit: descriptor.unit,
  };
}

/*
 * A monitor's view of a queue query: its queries, the formula adding a
 * series total up (none otherwise), and the alias a criteria compares.
 */
export interface MessageQueueMetricMonitorViewConfig {
  metricViewConfig: MetricsViewConfig;
  criteriaAlias: string;
}

// "unacknowledged" → "unacknowledged"; any other character → "_".
function toAliasPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "part"
  );
}

// A copy, so a config edited in the explorer never edits the query.
function copyAttributes(
  attributes: Dictionary<string | Includes>,
): Dictionary<string | Includes> {
  const copy: Dictionary<string | Includes> = {};

  for (const key of Object.keys(attributes)) {
    const value: string | Includes | undefined = attributes[key];

    if (value instanceof Includes) {
      copy[key] = new Includes([...(value.values as Array<string>)]);
    } else if (value !== undefined) {
      copy[key] = value;
    }
  }

  return copy;
}

function buildQueryConfig(data: {
  query: MessageQueueMetricMonitorQuery;
  attributes: Dictionary<string | Includes>;
  metricVariable: string;
  title: string;
  description: string;
}): MetricQueryConfigData {
  const query: MessageQueueMetricMonitorQuery = data.query;

  return {
    metricAliasData: {
      metricVariable: data.metricVariable,
      title: data.title,
      description: data.description,
      legend: data.title,
      legendUnit: query.unit || undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: query.metricName,
        attributes: data.attributes,
        aggegationType: query.aggregationType,
        aggregateBy: {},
      },
      ...(query.groupByAttributeKeys.length > 0
        ? { groupByAttributeKeys: [...query.groupByAttributeKeys] }
        : {}),
    },
  };
}

/**
 * The metric monitor view for a queue query — what the "Create monitor"
 * link pre-seeds Monitor Create with, and what getMonitorStep builds: the
 * exact filters, the fold, the grouping, and the catalog's unit as the legend
 * unit. A plain query is one query config, aliased `metricVariable`. A
 * series total is one query per part, each also filtered on its value and
 * aliased `<metricVariable>_<value>`, plus the formula adding them up,
 * aliased `metricVariable` — the alias a criteria compares either way.
 * `metricVariable` must be a formula identifier (letters, digits, "_").
 */
export function buildMessageQueueMetricMonitorViewConfig(data: {
  query: MessageQueueMetricMonitorQuery;
  metricVariable: string;
  title: string;
  description?: string | undefined;
}): MessageQueueMetricMonitorViewConfig {
  const query: MessageQueueMetricMonitorQuery = data.query;
  const description: string = data.description || data.title;
  const total: MessageQueueSeriesTotal | null = query.seriesTotal;

  if (!total || total.values.length === 0) {
    return {
      metricViewConfig: {
        queryConfigs: [
          buildQueryConfig({
            query: query,
            attributes: copyAttributes(query.attributes),
            metricVariable: data.metricVariable,
            title: data.title,
            description: description,
          }),
        ],
        formulaConfigs: [],
      },
      criteriaAlias: data.metricVariable,
    };
  }

  const partAliases: Array<string> = total.values.map(
    (value: string): string => {
      return `${data.metricVariable}_${toAliasPart(value)}`;
    },
  );

  const queryConfigs: Array<MetricQueryConfigData> = total.values.map(
    (value: string, index: number): MetricQueryConfigData => {
      return buildQueryConfig({
        query: query,
        attributes: {
          ...copyAttributes(query.attributes),
          [total.key]: value,
        },
        metricVariable: partAliases[index]!,
        title: `${data.title} (${value})`,
        description: description,
      });
    },
  );

  const formulaConfig: MetricFormulaConfigData = {
    metricAliasData: {
      metricVariable: data.metricVariable,
      title: data.title,
      description: description,
      legend: data.title,
      legendUnit: query.unit || undefined,
    },
    metricFormulaData: {
      metricFormula: partAliases.join(" + "),
    },
  };

  return {
    metricViewConfig: {
      queryConfigs: queryConfigs,
      formulaConfigs: [formulaConfig],
    },
    criteriaAlias: data.metricVariable,
  };
}

// --- policies ---

/*
 * The alert one catalog entry gets: its signal's default, adjusted by the
 * entry's override, with the threshold in the metric's own unit.
 */
export interface MessageQueueAlertPolicy {
  threshold: number;
  thresholdLabel: string;
  filterType: FilterType;
  evaluation: EvaluateOverTimeType;
  // The signal's (or override's) window, widened to the source's floor.
  rollingTime: RollingTime;
  // The floor that widened it, or null when the source's points are live.
  windowFloor: MessageQueueSourceWindowFloor | null;
  severity: MessageQueueAlertTemplateSeverity;
  category: MessageQueueAlertTemplateCategory;
  recoverOnNoData: boolean;
  metricAlias: string;
  meaning: string;
  incidentDescription: string;
  // The generated name, before any "(JSON stream)" qualifier.
  baseName: string;
}

function getUntemplatedReason(
  descriptor: MessageQueueMetricDescriptor,
): string | null {
  for (const entry of UNTEMPLATED_MESSAGE_QUEUE_GAUGES) {
    if (
      entry.system === descriptor.system &&
      entry.metricName === descriptor.metricName
    ) {
      return entry.reason;
    }
  }

  return null;
}

function getPolicyDefault(
  signal: MessageQueueSignal,
  measure: MessageQueueAlertMeasure,
): MessageQueueAlertPolicyDefault | null {
  for (const policy of MESSAGE_QUEUE_ALERT_POLICIES) {
    if (policy.signal === signal && policy.measure === measure) {
      return policy;
    }
  }

  return null;
}

function getPolicyOverride(
  descriptor: MessageQueueMetricDescriptor,
): MessageQueueAlertPolicyOverride | null {
  for (const override of MESSAGE_QUEUE_ALERT_POLICY_OVERRIDES) {
    if (
      override.system === descriptor.system &&
      override.metricNames.includes(descriptor.metricName)
    ) {
      return override;
    }
  }

  return null;
}

// "1000" → "1,000"; a fraction to at most two decimals.
function formatNumber(value: number): string {
  if (!Number.isInteger(value)) {
    return String(Number(value.toFixed(2)));
  }

  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDuration(seconds: number): string {
  if (seconds > 0 && seconds % 3600 === 0) {
    const hours: number = seconds / 3600;
    return `${formatNumber(hours)} ${hours === 1 ? "hour" : "hours"}`;
  }

  if (seconds > 0 && seconds % 60 === 0) {
    const minutes: number = seconds / 60;
    return `${formatNumber(minutes)} ${minutes === 1 ? "minute" : "minutes"}`;
  }

  return `${formatNumber(seconds)} ${seconds === 1 ? "second" : "seconds"}`;
}

/*
 * A threshold in words, in the metric's own unit: "1,000 messages",
 * "1 message", "10 minutes".
 */
export function formatMessageQueueThreshold(
  value: number,
  unit: string,
): string {
  const trimmedUnit: string = (unit || "").trim();

  if (trimmedUnit === "s") {
    return formatDuration(value);
  }

  if (trimmedUnit === "ms") {
    return value % 1000 === 0
      ? formatDuration(value / 1000)
      : `${formatNumber(value)} milliseconds`;
  }

  if (!trimmedUnit) {
    return formatNumber(value);
  }

  const singular: string =
    value === 1 && trimmedUnit.length > 1 && trimmedUnit.endsWith("s")
      ? trimmedUnit.substring(0, trimmedUnit.length - 1)
      : trimmedUnit;

  return `${formatNumber(value)} ${singular}`;
}

// "Dead-lettered messages" → "Dead-Lettered Messages"; small words stay small.
const TITLE_CASE_SMALL_WORDS: ReadonlyArray<string> = [
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
];

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .map((word: string, index: number): string => {
      if (index > 0 && TITLE_CASE_SMALL_WORDS.includes(word.toLowerCase())) {
        return word.toLowerCase();
      }

      return word
        .split("-")
        .map((part: string): string => {
          return part.length > 0
            ? `${part.charAt(0).toUpperCase()}${part.substring(1)}`
            : part;
        })
        .join("-");
    })
    .join(" ");
}

/*
 * A catalog title split into its name and a trailing qualifier:
 * "Messages visible (JSON stream)" → "Messages visible", "(JSON stream)".
 */
function splitTitle(title: string): { base: string; qualifier: string } {
  const match: RegExpMatchArray | null = title.match(/^(.*?)\s*(\([^()]*\))$/);

  if (!match) {
    return { base: title, qualifier: "" };
  }

  return { base: match[1] || title, qualifier: match[2] || "" };
}

/**
 * The alert a catalog entry gets, or null when it gets none: not a
 * monitorable gauge, a signal no static threshold means anything for, no
 * default for its (signal, measure), or a deliberately untemplated gauge.
 * The threshold is in the metric's own unit (an age of 600 s reads 600000 on
 * a metric reported in milliseconds).
 */
export function getMessageQueueAlertPolicy(
  descriptor: MessageQueueMetricDescriptor,
): MessageQueueAlertPolicy | null {
  if (
    !isMessageQueueMetricMonitorable(descriptor) ||
    !MESSAGE_QUEUE_THRESHOLDABLE_SIGNALS.includes(descriptor.signal) ||
    getUntemplatedReason(descriptor) !== null
  ) {
    return null;
  }

  const measure: MessageQueueAlertMeasure =
    getMessageQueueAlertMeasure(descriptor);
  const defaults: MessageQueueAlertPolicyDefault | null = getPolicyDefault(
    descriptor.signal,
    measure,
  );

  if (!defaults) {
    return null;
  }

  const override: MessageQueueAlertPolicyOverride | null =
    getPolicyOverride(descriptor);

  const defaultThreshold: number = defaults.thresholdUnit
    ? MetricUnitUtil.convertToMetricUnit({
        value: defaults.threshold,
        fromUnit: defaults.thresholdUnit,
        metricUnit: descriptor.unit,
      })
    : defaults.threshold;

  // Clears the binary noise a unit conversion leaves (600 / 0.001).
  const threshold: number = Number(
    (override?.threshold ?? defaultThreshold).toPrecision(12),
  );

  const title: { base: string; qualifier: string } = splitTitle(
    descriptor.title,
  );

  const generatedName: string = defaults.nameSuffix
    ? `${toTitleCase(title.base)} ${defaults.nameSuffix}`
    : toTitleCase(title.base);

  // A late source's points never land in a window shorter than their lag.
  const signalWindow: RollingTime =
    override?.rollingTime || defaults.rollingTime;
  const rollingTime: RollingTime = getMessageQueueMetricMonitorRollingTime(
    descriptor,
    signalWindow,
  );

  return {
    threshold: threshold,
    thresholdLabel: `at or above ${formatMessageQueueThreshold(
      threshold,
      descriptor.unit,
    )}`,
    filterType: FilterType.GreaterThanOrEqualTo,
    evaluation: defaults.evaluation,
    rollingTime: rollingTime,
    windowFloor:
      rollingTime === signalWindow
        ? null
        : getMessageQueueSourceWindowFloor(descriptor),
    severity: override?.severity || defaults.severity,
    category: defaults.category,
    // A count's silent window is a window without events (see THRESHOLDS).
    recoverOnNoData: override?.recoverOnNoData ?? measure === "count",
    metricAlias: defaults.metricAlias,
    meaning: override?.meaning || defaults.meaning,
    incidentDescription:
      override?.incidentDescription || defaults.incidentDescription,
    baseName: override?.name || generatedName,
  };
}

// --- template builders ---

const ROLLING_TIME_WORDS: Readonly<
  Record<string, { noun: string; adjective: string }>
> = {
  [RollingTime.Past5Minutes]: {
    noun: "five minutes",
    adjective: "five-minute",
  },
  [RollingTime.Past10Minutes]: {
    noun: "ten minutes",
    adjective: "ten-minute",
  },
  [RollingTime.Past15Minutes]: {
    noun: "fifteen minutes",
    adjective: "fifteen-minute",
  },
  [RollingTime.Past30Minutes]: {
    noun: "thirty minutes",
    adjective: "thirty-minute",
  },
};

// ["ready", "unacknowledged"] → "ready and unacknowledged".
function joinWords(values: ReadonlyArray<string>): string {
  if (values.length <= 1) {
    return values.join("");
  }

  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function getWindowWords(rollingTime: RollingTime): {
  noun: string;
  adjective: string;
} {
  return (
    ROLLING_TIME_WORDS[rollingTime] || {
      noun: rollingTime.toLowerCase(),
      adjective: rollingTime.toLowerCase(),
    }
  );
}

// A collector component type: "googlecloudmonitoring", "kafka_metrics".
const COLLECTOR_COMPONENT_PATTERN: RegExp = /^[a-z0-9_]+$/;

/*
 * "the collector's `googlecloudmonitoring` receiver" — how a sentence names
 * the component, which the catalog spells as a receiver type,
 * "prometheus" or a product name.
 */
function describeReceiver(receiver: string): string {
  return COLLECTOR_COMPONENT_PATTERN.test(receiver)
    ? `the collector's \`${receiver}\` receiver`
    : receiver;
}

function buildTemplateDescription(data: {
  descriptor: MessageQueueMetricDescriptor;
  policy: MessageQueueAlertPolicy;
  seed: MessageQueueMetricMonitorSeed;
}): string {
  const descriptor: MessageQueueMetricDescriptor = data.descriptor;
  const policy: MessageQueueAlertPolicy = data.policy;
  const window: { noun: string; adjective: string } = getWindowWords(
    policy.rollingTime,
  );
  const subject: string = `"${splitTitle(descriptor.title).base}"`;
  const perSeries: string =
    data.seed.groupByAttributeKeys.length > 0
      ? `any one ${data.seed.groupByAttributeKeys.join(" / ")} series of `
      : "";

  /*
   * A late source's window holds less than its length of data (see WINDOWS
   * AND LATE SOURCES), so its breach is worded by points, not by minutes.
   */
  let breach: string;

  if (policy.evaluation === EvaluateOverTimeType.AnyValue) {
    breach = policy.windowFloor
      ? `Alert when ${perSeries}${subject} reads ${policy.thresholdLabel} at any point of a ${window.adjective} window.`
      : `Alert when ${perSeries}${subject} reads ${policy.thresholdLabel} in any single minute of a ${window.adjective} window.`;
  } else {
    breach = policy.windowFloor
      ? `Alert when ${perSeries}${subject} reads ${policy.thresholdLabel} at every point of a ${window.adjective} window.`
      : `Alert when ${perSeries}${subject} stays ${policy.thresholdLabel} for ${window.noun}.`;
  }

  const sentences: Array<string> = [breach, policy.meaning];

  if (policy.windowFloor) {
    sentences.push(policy.windowFloor.reason);
  }

  sentences.push(`Reads ${descriptor.metricName}. ${descriptor.description}`);

  if (data.seed.seriesTotal) {
    sentences.push(
      `The monitor reads the ${joinWords(
        data.seed.seriesTotal.values,
      )} series with one query each and adds them up with a formula, the total the queue page shows.`,
    );
  }

  if (data.seed.groupByAttributeKeys.length > 0) {
    sentences.push(
      "Its series are not a fixed set, so the monitor cannot add them up the way the queue page does: it watches each series on its own, and the threshold is for one series, not for the total.",
    );
  }

  if (!descriptor.enabledByDefault) {
    sentences.push(
      `${capitalizeFirst(describeReceiver(descriptor.receiver))} only reports ${
        descriptor.metricName
      } once it is enabled in the collector's configuration${
        descriptor.receiver === "googlecloudmonitoring"
          ? " (listed under the receiver's `metrics_list`)"
          : ""
      }.`,
    );
  }

  return sentences.join(" ");
}

function capitalizeFirst(value: string): string {
  return value.length > 0
    ? `${value.charAt(0).toUpperCase()}${value.substring(1)}`
    : value;
}

/*
 * "rabbitmq.message.current (resource.rabbitmq.queue.name = orders), state
 * ready + unacknowledged" or "…, per broker" — the query as the criteria
 * description names it.
 */
function describeQuery(query: MessageQueueMetricMonitorQuery): string {
  const filters: Array<string> = Object.keys(query.attributes).map(
    (key: string): string => {
      const value: string | Includes | undefined = query.attributes[key];

      if (value instanceof Includes) {
        const values: Array<string | ObjectID | number> = value.values as Array<
          string | ObjectID | number
        >;

        return `${key} in [${values
          .map((item: string | ObjectID | number): string => {
            return String(item);
          })
          .join(", ")}]`;
      }

      return `${key} = ${String(value)}`;
    },
  );

  let series: string = "";

  if (query.seriesTotal) {
    series = `, ${query.seriesTotal.key} ${query.seriesTotal.values.join(
      " + ",
    )}`;
  } else if (query.groupByAttributeKeys.length > 0) {
    series = `, per ${query.groupByAttributeKeys.join(" / ")}`;
  }

  return `${query.metricName} (${filters.join(", ")})${series}`;
}

function describeCriteria(data: {
  subject: string;
  policy: MessageQueueAlertPolicy;
}): string {
  if (data.policy.evaluation === EvaluateOverTimeType.AnyValue) {
    return `Triggers when ${data.subject} reads ${data.policy.thresholdLabel} at any point in the evaluation window.`;
  }

  return `Triggers when ${data.subject} stays ${data.policy.thresholdLabel} for the whole evaluation window.`;
}

function buildCriteria(data: {
  args: MessageQueueAlertTemplateArgs;
  templateName: string;
  query: MessageQueueMetricMonitorQuery;
  policy: MessageQueueAlertPolicy;
  // The query's alias, or the formula's for a series total.
  criteriaAlias: string;
}): MonitorCriteria {
  const policy: MessageQueueAlertPolicy = data.policy;

  const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
    offlineMonitorStatusId: data.args.offlineMonitorStatusId,
    incidentSeverityId: data.args.defaultIncidentSeverityId,
    alertSeverityId: data.args.defaultAlertSeverityId,
    monitorName: data.args.monitorName,
    metricAlias: data.criteriaAlias,
    filterType: policy.filterType,
    value: policy.threshold,
    incidentTitle: `[Queue] ${data.templateName} - ${data.args.monitorName}`,
    incidentDescription: policy.incidentDescription,
    criteriaName: `${data.templateName} - ${policy.thresholdLabel}`,
    criteriaDescription: describeCriteria({
      subject: describeQuery(data.query),
      policy: policy,
    }),
    resourceNoun: "queue",
    metricAggregationType: policy.evaluation,
  });

  /*
   * Recovery mirrors the breach: the complementary comparison below a dead
   * band, held for the whole window — also for a count, which breaches on
   * any one minute — and, where a silent window means zero, met by one.
   */
  const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
    onlineMonitorStatusId: data.args.onlineMonitorStatusId,
    metricAlias: data.criteriaAlias,
    filterType: getRecoveryFilterType(policy.filterType),
    value: policy.threshold,
    metricAggregationType:
      policy.evaluation === EvaluateOverTimeType.AnyValue
        ? EvaluateOverTimeType.AllValues
        : policy.evaluation,
    treatNoDataAsZero: policy.recoverOnNoData,
  });

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return monitorCriteria;
}

// "aws_sqs" + "amazonaws.com/aws/sqs/x" → "aws-sqs-amazonaws-com-aws-sqs-x".
function toIdSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildTemplate(
  descriptor: MessageQueueMetricDescriptor,
): MessageQueueAlertTemplate | null {
  const policy: MessageQueueAlertPolicy | null =
    getMessageQueueAlertPolicy(descriptor);
  const seed: MessageQueueMetricMonitorSeed | null =
    getMessageQueueMetricMonitorSeed(descriptor);

  if (!policy || !seed) {
    return null;
  }

  const qualifier: string = splitTitle(descriptor.title).qualifier;
  const name: string = qualifier
    ? `${policy.baseName} ${qualifier}`
    : policy.baseName;

  return {
    id: `message-queue-${toIdSlug(descriptor.system)}-${toIdSlug(
      descriptor.metricName,
    )}`,
    name: name,
    description: buildTemplateDescription({
      descriptor: descriptor,
      policy: policy,
      seed: seed,
    }),
    category: policy.category,
    severity: policy.severity,
    monitorType: MonitorType.Metrics,
    system: descriptor.system,
    receiver: descriptor.receiver,
    signal: descriptor.signal,
    metricId: getMessageQueueMetricId(descriptor),
    metricName: descriptor.metricName,
    metricNames: [descriptor.metricName],
    unit: descriptor.unit,
    aggregationType: seed.aggregationType,
    groupByAttributeKeys: [...seed.groupByAttributeKeys],
    seriesTotal: seed.seriesTotal
      ? { key: seed.seriesTotal.key, values: [...seed.seriesTotal.values] }
      : null,
    filterType: policy.filterType,
    threshold: policy.threshold,
    thresholdLabel: policy.thresholdLabel,
    evaluation: policy.evaluation,
    rollingTime: policy.rollingTime,
    recoverOnNoData: policy.recoverOnNoData,
    getMonitorStep: (
      args: MessageQueueAlertTemplateArgs,
    ): MonitorStep | null => {
      if (!args) {
        return null;
      }

      const query: MessageQueueMetricMonitorQuery | null =
        buildMessageQueueMetricMonitorQuery({
          descriptor: descriptor,
          observedSeries: args.observedSeries,
          identity: args.identity,
        });

      if (!query) {
        return null;
      }

      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: args.monitorName,
        monitorType: MonitorType.Metrics,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
      });

      const view: MessageQueueMetricMonitorViewConfig =
        buildMessageQueueMetricMonitorViewConfig({
          query: query,
          metricVariable: policy.metricAlias,
          title: name,
          description: descriptor.description,
        });

      step.setMetricMonitor({
        rollingTime: policy.rollingTime,
        metricViewConfig: view.metricViewConfig,
      });

      step.setMonitorCriteria(
        buildCriteria({
          args: args,
          templateName: name,
          query: query,
          policy: policy,
          criteriaAlias: view.criteriaAlias,
        }),
      );

      return step;
    },
  };
}

/*
 * Every catalog entry's template, in catalog order, built once. The product
 * reads them one at a time, by catalog entry, and never as a list (see WHO
 * READS THEM).
 */
const ALL_MESSAGE_QUEUE_ALERT_TEMPLATES: Array<MessageQueueAlertTemplate> =
  MESSAGE_QUEUE_METRICS.map(
    (
      descriptor: MessageQueueMetricDescriptor,
    ): MessageQueueAlertTemplate | null => {
      return buildTemplate(descriptor);
    },
  ).filter(
    (
      template: MessageQueueAlertTemplate | null,
    ): template is MessageQueueAlertTemplate => {
      return template !== null;
    },
  );

/**
 * The template of one catalog entry, or undefined when the entry has none:
 * where the "Create monitor" link reads its starting threshold, comparison,
 * severity and window. Keyed by the entry (getMessageQueueMetricId), not the
 * metric name, which Service Bus and Event Hubs share.
 */
export function getMessageQueueAlertTemplateForMetric(
  descriptor: MessageQueueMetricDescriptor,
): MessageQueueAlertTemplate | undefined {
  if (!descriptor) {
    return undefined;
  }

  const metricId: string = getMessageQueueMetricId(descriptor);

  return ALL_MESSAGE_QUEUE_ALERT_TEMPLATES.find(
    (template: MessageQueueAlertTemplate): boolean => {
      return template.metricId === metricId;
    },
  );
}
