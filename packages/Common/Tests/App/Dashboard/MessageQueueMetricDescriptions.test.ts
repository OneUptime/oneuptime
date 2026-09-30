import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
} from "./MetricDescriptionRules";
import {
  MESSAGE_QUEUE_METRIC_DESCRIPTIONS,
  MessageQueueMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/MessageQueueMetricDescriptions";

/*
 * The (i) texts of a queue's Overview. MetricDescriptionsCatalog holds them
 * to the shape rules every family follows; this suite holds each one to the
 * code that computes the number it explains, read from the source — so a
 * change to a query that leaves its words behind fails here:
 *
 *   - Published / Consumed count producer / consumer spans, and say what
 *     else they count or leave out: a publisher's client sends, a receive
 *     that returned nothing, SQS's receive calls;
 *   - a Consumers row counts what Consumed counts for that service (an SQS
 *     receive that returned messages once, as its batch), and its time
 *     leaves those receives out — and the card's text says both;
 *   - Errors counts failed spans of any kind over all of the queue's spans;
 *   - the p95 tile is ONE percentile over the window (AggregationInterval
 *     .Total), the chart one per interval — and each says which;
 *   - the count chart draws whole intervals only;
 *   - each text sits beside the tile, chart or card it explains.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readSquashed(...segments: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

const OVERVIEW: string = readSquashed(
  "Pages",
  "MessageQueue",
  "View",
  "Overview.tsx",
);
const QUERIES: string = readSquashed(
  "Components",
  "MessageQueue",
  "MessageQueueTelemetryQueries.ts",
);
const BROKER_HEALTH: string = readSquashed(
  "Components",
  "MessageQueue",
  "MessageQueueBrokerHealthSection.tsx",
);

const TEXT: Record<MessageQueueMetric, string> =
  MESSAGE_QUEUE_METRIC_DESCRIPTIONS;

// The source between `from` and the next `to`.
function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);
  expect(start).toBeGreaterThanOrEqual(0);
  const end: number = source.indexOf(to, start + from.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("the queue Overview's descriptions", () => {
  test("read as short, finished sentences that explain their jargon", () => {
    expectReadableDescriptionRecord(
      TEXT as unknown as Record<string, unknown>,
      "MESSAGE_QUEUE_METRIC_DESCRIPTIONS",
    );
    expectTitleExplained("p95 processing time", TEXT.p95Processing);
    expectTitleExplained("p95 processing time", TEXT.p95ProcessingChart);
  });

  test("each tile carries its own text", () => {
    for (const [title, key] of [
      ["Published", "published"],
      ["Consumed", "consumed"],
      ["Errors", "errors"],
      ["p95 processing time", "p95Processing"],
    ] as Array<[string, MessageQueueMetric]>) {
      // From the tile's title to the next tile's.
      const tile: string = between(OVERVIEW, `title: "${title}",`, "title:");
      expect(tile).toContain(
        `description: MESSAGE_QUEUE_METRIC_DESCRIPTIONS.${key},`,
      );
    }
  });

  test("each chart and card carries its own text", () => {
    expect(between(OVERVIEW, 'title="Messages"', "/>")).toContain(
      "description={MESSAGE_QUEUE_METRIC_DESCRIPTIONS.messagesChart}",
    );
    expect(between(OVERVIEW, 'title="p95 processing time"', "/>")).toContain(
      "description={MESSAGE_QUEUE_METRIC_DESCRIPTIONS.p95ProcessingChart}",
    );
    expect(between(OVERVIEW, 'side="producers"', "/>")).toContain(
      "description={MESSAGE_QUEUE_METRIC_DESCRIPTIONS.producers}",
    );
    expect(between(OVERVIEW, 'side="consumers"', "/>")).toContain(
      "description={MESSAGE_QUEUE_METRIC_DESCRIPTIONS.consumers}",
    );
    expect(BROKER_HEALTH).toContain(
      "MESSAGE_QUEUE_METRIC_DESCRIPTIONS.brokerHealth",
    );
  });

  test("Published and Consumed say which spans they count, as the queries filter them", () => {
    expect(TEXT.published).toContain("producer spans");
    expect(TEXT.consumed).toContain("consumer spans");
    // What each leaves out: a send or receive recorded as a CLIENT span.
    expect(TEXT.published).toContain("client spans");
    expect(TEXT.consumed).toContain("client spans");

    expect(QUERIES).toContain(
      "MESSAGE_QUEUE_PUBLISH_SPAN_KIND: SpanKind = SpanKind.Producer",
    );
    expect(QUERIES).toContain(
      "MESSAGE_QUEUE_CONSUME_SPAN_KIND: SpanKind = SpanKind.Consumer",
    );

    // A publisher that records its sends only as client spans is counted.
    expect(TEXT.published).toContain("records its sends only as client spans");
    expect(QUERIES).toContain(
      "published: sumOf(tiles.publishedSeries) + (producers?.clientOnlyPublished || 0),",
    );
    // A receive that returned nothing is not a message taken.
    expect(TEXT.consumed).toContain(
      "Receives that returned nothing are left out",
    );
    expect(QUERIES).toContain(
      '[MESSAGE_QUEUE_BATCH_MESSAGE_COUNT_ATTRIBUTE]: new IncludesNone(["0"]),',
    );
    // SQS's receive calls: a batch at most, never a processing time.
    expect(TEXT.consumed).toContain("an SQS receive call counts only when");
    expect(TEXT.p95Processing).toContain(
      "Receives that returned nothing and SQS receive calls are left out",
    );
  });

  /*
   * A consumer's row counts what Consumed counts for it
   * (combineMessageQueueConsumerServices): its consumer spans less the
   * receives that returned nothing, plus — on SQS — each receive that
   * reported returning messages, once, as one batch. Its failures and time
   * are its consumer spans' alone.
   */
  test("the Consumers card says what a row counts, as the card combines a service's spans", () => {
    const combine: string = between(
      QUERIES,
      "export function combineMessageQueueConsumerServices(",
      "return sortedServiceRows(",
    );

    // A receive that returned nothing is in no part of a row, the count too.
    expect(TEXT.consumers).toContain(
      "Receives that returned nothing are left out;",
    );
    expect(TEXT.consumers).not.toContain("left out of the time");
    expect(QUERIES).toContain(
      '[MESSAGE_QUEUE_BATCH_MESSAGE_COUNT_ATTRIBUTE]: new IncludesNone(["0"]),',
    );

    // An SQS receive that returned messages is counted, once per batch...
    expect(TEXT.consumers).toContain(
      "an SQS receive that returned messages counts once per batch",
    );
    expect(QUERIES).toContain(
      "[MESSAGE_QUEUE_BATCH_MESSAGE_COUNT_ATTRIBUTE]: new GreaterThan<number>(0),",
    );
    expect(QUERIES).toContain(
      "consumers: combineMessageQueueConsumerServices({ consume: consume!, receivedBatches: receivedBatches,",
    );
    expect(combine).toContain("const consumed: number = handled + received;");
    expect(combine).toContain("calls: consumed,");

    // ...and never in the time, which is its consumer spans' alone.
    expect(TEXT.consumers).toContain("never in the time");
    expect(combine).toContain(
      "p95DurationMs: handled > 0 ? finiteOrNull(data.consume.p95Ms.get(id)) : null,",
    );
  });

  test("Errors covers spans of every kind, over all of the queue's spans", () => {
    expect(TEXT.errors).toContain("share of all its spans");
    expect(TEXT.errors).toMatch(
      /publishes, receives, message processing and settlements/,
    );
    // The failed-span query reads every span: the "all" group sets no filter.
    expect(QUERIES).toContain(
      'const errorQuery: Record<string, unknown> = queryOf("all", true)!;',
    );
    expect(QUERIES).toContain("default: return {};");
  });

  test("the p95 tile is one percentile over the range, the chart one per interval", () => {
    expect(TEXT.p95Processing).toContain("One percentile over the whole range");
    expect(TEXT.p95Processing).not.toContain("averaged");
    expect(TEXT.p95ProcessingChart).toContain("in each interval");
    expect(QUERIES).toContain(
      "query: consumeQuery, aggregationType: AggregationType.P95, aggregationInterval: AggregationInterval.Total,",
    );
  });

  test("the count chart draws whole intervals only, and says so", () => {
    expect(TEXT.messagesChart).toContain("Only whole intervals are drawn");
    expect(QUERIES).toContain(
      "publishedSeries: getCompleteBucketSeries(publishedSeries, window)",
    );
    expect(QUERIES).toContain(
      "consumedSeries: getCompleteBucketSeries(tiles.consumedSeries, window)",
    );
    expect(QUERIES).toContain(
      "errorSeries: getCompleteBucketSeries(tiles.errorSeries, window)",
    );
  });

  test("the broker health text matches how the section reads its metrics", () => {
    expect(TEXT.brokerHealth).toContain(
      "Levels show their latest value, counts per interval their newest whole interval, and running totals a rate per second",
    );
    // A per-period count keeps whole intervals only; a counter is a rate.
    expect(QUERIES).toContain(
      "? getCompleteMessageQueueCountSeries( points, descriptor, window, window.now, )",
    );
    expect(QUERIES).toContain("return counterResultToRatePerSecond(result);");
  });
});
