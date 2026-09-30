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
 *   - Published / Consumed count PRODUCER / CONSUMER spans, and say so;
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
  });

  test("Errors covers spans of every kind, over all of the queue's spans", () => {
    expect(TEXT.errors).toContain("share of all its spans");
    expect(TEXT.errors).toMatch(
      /publishes, receives, message processing and settlements/,
    );
    // The failed-span query sets no kind.
    expect(QUERIES.replace(/\s+/g, "")).toContain(
      "buildMessageQueueSpanQuery(window,{errorsOnly:true},)",
    );
  });

  test("the p95 tile is one percentile over the range, the chart one per interval", () => {
    expect(TEXT.p95Processing).toContain(
      "one percentile over every consumer span in the range",
    );
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
      "errorSeries: getCompleteBucketSeries(errorSeries, window)",
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
