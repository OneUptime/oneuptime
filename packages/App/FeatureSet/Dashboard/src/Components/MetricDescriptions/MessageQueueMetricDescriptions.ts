/*
 * What each number on a queue's Overview means, in plain words. Shown in the
 * (i) tooltip beside a tile, chart or card title, the way every other
 * product's Overview explains its figures.
 *
 * Each text describes what the page actually computes
 * (Components/MessageQueue/MessageQueueTelemetryQueries), not what the title
 * might suggest:
 *
 *   - Published counts the queue's PRODUCER spans and Consumed its CONSUMER
 *     spans, both scoped by the queue's entity key — a send or receive an
 *     instrumentation records as a CLIENT span (Go's otelaws, pull-based
 *     receives under the newer semantic conventions) is in neither count.
 *   - Errors counts the queue's spans of ANY kind with an error status, and
 *     its rate divides by all of them.
 *   - The p95 tile is one percentile over every CONSUMER span in the range;
 *     the chart is the p95 of each interval.
 *   - The count chart draws whole intervals only (getCompleteBucketSeries).
 *   - The Producers and Consumers cards group those spans by the service
 *     that recorded them.
 *   - Broker health tiles carry their catalog description instead
 *     (Types/MessageQueue/MessageQueueMetricCatalog); the section's own text
 *     says how a tile reads: a level its newest value, a per-period count
 *     its newest whole interval (getCompleteMessageQueueCountSeries), a
 *     cumulative counter its rate.
 *
 * Change the fetch, change the words.
 */

export type MessageQueueMetric =
  | "published"
  | "consumed"
  | "errors"
  | "p95Processing"
  | "messagesChart"
  | "p95ProcessingChart"
  | "producers"
  | "consumers"
  | "brokerHealth";

export const MESSAGE_QUEUE_METRIC_DESCRIPTIONS: Record<
  MessageQueueMetric,
  string
> = {
  published:
    "Messages your instrumented applications published to this queue in the selected range, counted from their producer spans: one per send, or one per batch sent in a single call. Sends recorded as client spans, and publishers that are not instrumented, are not counted.",
  consumed:
    "Messages your instrumented applications took from this queue in the selected range, counted from their consumer spans: one per message processed or delivered, or one per batch. Receives recorded as client spans, and consumers that are not instrumented, are not counted.",
  errors:
    "Spans naming this queue that ended with an error status in the selected range: failed publishes, receives, message processing and settlements alike, with their share of all its spans. A failure the client library did not record as an error is not counted.",
  p95Processing:
    "p95 means the 95th percentile: 95% of this queue's consumer spans in the selected range finished faster than this. It is one percentile over every consumer span in the range, as the consuming application measured it: the time to handle a message or batch, not how long it waited in the queue.",
  messagesChart:
    "Producer and consumer spans for this queue in each interval of the selected range, with its spans of any kind that ended with an error. Only whole intervals are drawn, so the newest one, still filling, does not read as a drop.",
  p95ProcessingChart:
    "p95 means the 95th percentile: in each interval, 95% of this queue's consumer spans finished faster than the line. A spike in one interval can come from a handful of slow messages.",
  producers:
    "The services that published to this queue in the selected range, busiest first, from their producer spans: how many messages each sent, the share that failed and the p95 publish time (p95 means the 95th percentile: 95% of publishes finished faster).",
  consumers:
    "The services that consumed from this queue in the selected range, busiest first, from their consumer spans: how many messages each took, the share that failed and the p95 processing time (p95 means the 95th percentile: 95% finished faster).",
  brokerHealth:
    "What the broker itself reports about this queue, such as its backlog, consumer lag, dead letters and message age, from the collector receiver or scrape for its messaging system. Levels show their latest value, counts per interval their newest whole interval, and running totals a rate per second.",
};
