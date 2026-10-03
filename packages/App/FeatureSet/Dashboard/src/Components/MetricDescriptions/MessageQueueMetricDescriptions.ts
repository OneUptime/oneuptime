/*
 * What each number on a queue's Overview means, in plain words. Shown in the
 * (i) tooltip beside a tile, chart or card title, the way every other
 * product's Overview explains its figures.
 *
 * Each text describes what the page actually computes
 * (Components/MessageQueue/MessageQueueTelemetryQueries), not what the title
 * might suggest:
 *
 *   - Published counts the queue's PRODUCER spans, plus the client spans
 *     that record a send for every service that records no producer span
 *     (the "send" and "awsSend" span groups: some AWS SDK instrumentations
 *     record publishes only that way).
 *   - Consumed counts its CONSUMER spans less the receives that returned
 *     nothing (messaging.batch.message_count 0) and, on SQS, less the
 *     receive calls — plus the SQS receives that report returning messages,
 *     once per batch. A receive recorded as a CLIENT span is not counted.
 *   - Errors counts the queue's spans of ANY kind with an error status, and
 *     its rate divides by all of them.
 *   - The p95 tile is one percentile over the consumer spans Consumed
 *     counts, SQS receives left out, over the whole range; the chart is the
 *     p95 of each interval.
 *   - The count chart draws whole intervals only (getCompleteBucketSeries).
 *   - The Producers and Consumers cards group those spans by the service
 *     that recorded them; a producer's failures and publish time come from
 *     its client send spans when it records any (the Azure SDKs' producer
 *     spans are zero-length markers made before the send). A consumer's
 *     count is what Consumed counts for it — receives that returned nothing
 *     left out, an SQS receive that returned messages once per batch
 *     (combineMessageQueueConsumerServices) — and its failures and time
 *     are its consumer spans' alone, never an SQS receive's.
 *   - Broker health tiles carry their catalog description instead
 *     (Types/MessageQueue/MessageQueueMetricCatalog); the section's own text
 *     says how a tile reads: a level its newest value, a per-period count
 *     its newest whole interval (getCompleteMessageQueueCountSeries), a
 *     cumulative counter its rate.
 *
 * Change the fetch, change the words.
 */

import { translationKey } from "Common/UI/Utils/TranslateTemplate";

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
    translationKey("Messages your instrumented applications published to this queue in the selected range, from their producer spans: one per message, or per batch sent in one call. An application that records its sends only as client spans, as some AWS SDK instrumentations do, is counted from those. Publishers that are not instrumented are not counted."),
  consumed:
    translationKey("Messages your instrumented applications took from this queue in the selected range, from their consumer spans: one per message processed, or per batch. Receives that returned nothing are left out; an SQS receive call counts only when it reports the messages it returned, once per batch. Receives recorded as client spans are not counted."),
  errors:
    translationKey("Spans naming this queue that ended with an error status in the selected range: failed publishes, receives, message processing and settlements alike, with their share of all its spans. A failure the client library did not record as an error is not counted."),
  p95Processing:
    translationKey("p95 means the 95th percentile: 95% of this queue's consumer spans in the selected range finished faster than this. One percentile over the whole range: the time to handle a message or batch. Receives that returned nothing and SQS receive calls are left out, since their time is spent waiting for messages, not handling them."),
  messagesChart:
    translationKey("Messages published and consumed on this queue in each interval of the selected range, counted as the Published and Consumed tiles count them, with its spans of any kind that ended with an error. Only whole intervals are drawn, so the newest one, still filling, does not read as a drop."),
  p95ProcessingChart:
    translationKey("p95 means the 95th percentile: in each interval, 95% of this queue's consumer spans finished faster than the line, leaving out receives that returned nothing and SQS receive calls. A spike in one interval can come from a handful of slow messages."),
  producers:
    translationKey("The services that published to this queue in the selected range, busiest first: messages sent, the share of sends that failed and the p95 publish time (p95 means the 95th percentile: 95% finished faster). Failures and time come from a service's client send spans when it has them, as the Azure SDKs do, else its producer spans."),
  consumers:
    translationKey("The services that consumed from this queue in the selected range, busiest first: messages taken, the share that failed and the p95 processing time (p95 means the 95th percentile: 95% finished faster). Receives that returned nothing are left out; an SQS receive that returned messages counts once per batch, never in the time."),
  brokerHealth:
    translationKey("What the broker itself reports about this queue, such as its backlog, consumer lag, dead letters and message age, from the collector receiver or scrape for its messaging system. Levels show their latest value, counts per interval their newest whole interval, and running totals a rate per second."),
};
