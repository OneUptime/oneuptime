import {
  MessageQueueBrokerMetricResult,
  MessageQueueSpanMetrics,
  MessageQueueTimePoint,
  addMessageQueueCountSeries,
} from "./MessageQueueTelemetryQueries";
import {
  formatMessageQueueCount,
  getMessageQueueBrokerMetricTitle,
} from "./MessageQueueOverviewPresentation";
import { getMessageQueueSystemLabel } from "../../Pages/MessageQueue/Utils/MessageQueuePresentation";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import {
  MessageQueueMetricDescriptor,
  MessageQueueSignal,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import {
  TemplateValues,
  Translator,
  composedValue,
  formatList,
  getGlobalTranslator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Where each figure at the top of a queue's Overview comes from. A queue
 * whose applications are traced has spans for it; one whose broker reports
 * metrics has those; many have both, and some only one. Each figure reads
 * the best source it has:
 *
 *   - Published and Consumed: the queue's publish or consume spans when it
 *     has any of that kind in the range, otherwise its broker's own count
 *     of messages in and out (the first curated metric of that signal with
 *     data: Service Bus's Incoming / Outgoing messages, SQS's
 *     NumberOfMessagesSent / Received, a RabbitMQ or Kafka running total);
 *   - Errors: the queue's failed spans when it has any span at all (a 0
 *     then means no failure), otherwise every error metric its broker
 *     reported, added up (Service Bus's server errors, user errors and
 *     abandoned messages), with throttled requests counted apart;
 *   - p95 processing time: consumer spans only. No broker measures how long
 *     a consumer takes to handle a message, so a queue without consumer
 *     spans says what would give the number instead of a dash.
 *
 * Spans win when both exist: they say which service did what, which a
 * broker count cannot. A broker figure is always messages (or requests)
 * per interval, like a span count: a per-period count (Azure Monitor's
 * `_total`, CloudWatch sums, Pub/Sub's DELTA counts) as it is, whole
 * intervals only, and a cumulative counter's per-second rate times its
 * interval. A level (a backlog, a size) is never a count, so it never
 * stands in for one. Pure, so each rule is unit-tested without the page.
 */

export type MessageQueueFigureSignal = Extract<
  MessageQueueSignal,
  "published" | "consumed" | "errors" | "throttled"
>;

export type MessageQueueFigureSource = "spans" | "broker";

/** A count read from the queue's curated broker metrics. */
export interface MessageQueueBrokerFigure {
  signal: MessageQueueFigureSignal;
  // The catalog metrics it adds up, in catalog order; never empty.
  descriptors: Array<MessageQueueMetricDescriptor>;
  // Messages (or requests) per interval of the window, oldest first.
  series: Array<MessageQueueTimePoint>;
  // The figure over the range: its series added up.
  total: number;
  /*
   * True when a cumulative counter's per-second rate was turned into a
   * count per interval: an estimate, where a per-period count is exact.
   */
  isEstimatedFromRate: boolean;
}

/** One figure of the Overview, with the source it was read from. */
export interface MessageQueueOverviewFigure {
  source: MessageQueueFigureSource;
  /*
   * The count over the range; null when the queue has no span at all and
   * its broker reported none, so the tile shows a dash.
   */
  value: number | null;
  // Per interval, for the Messages chart.
  series: Array<MessageQueueTimePoint>;
  // The broker metrics read; null for a span figure.
  broker: MessageQueueBrokerFigure | null;
}

export interface MessageQueueOverviewFigures {
  published: MessageQueueOverviewFigure;
  consumed: MessageQueueOverviewFigure;
  errors: MessageQueueOverviewFigure;
  /*
   * The requests the broker throttled in the range, shown beside its errors;
   * null when it reported none.
   */
  throttled: MessageQueueBrokerFigure | null;
  // Whether any figure (and so a line of the Messages chart) is the broker's.
  usesBrokerMetrics: boolean;
  /*
   * Whether the queue has consumer spans that handled messages: without
   * them there is no processing time to show.
   */
  hasProcessingTime: boolean;
}

/*
 * A copy of a metric reads "<title> (<qualifier>)": a CloudWatch metric by
 * a JSON Metric Stream, the JMX Scraper's legacy names. The same messages
 * counted twice, so a total takes one of them.
 */
function baseTitleOf(descriptor: MessageQueueMetricDescriptor): string {
  const title: string = descriptor.title.trim();
  const open: number = title.lastIndexOf(" (");
  return open > 0 && title.endsWith(")")
    ? title.substring(0, open).toLowerCase()
    : title.toLowerCase();
}

/**
 * The width of one interval of a chart-ready series: the smallest step
 * between its points, or — for a series of one point — the interval the
 * aggregate API picks for the window.
 */
export function getMessageQueueSeriesIntervalMs(
  series: ReadonlyArray<MessageQueueTimePoint>,
  window: { start: Date; end: Date },
): number {
  const times: Array<number> = series
    .map((point: MessageQueueTimePoint): number => {
      return point.x.getTime();
    })
    .filter((time: number): boolean => {
      return Number.isFinite(time);
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });
  let step: number = Number.POSITIVE_INFINITY;
  for (let index: number = 1; index < times.length; index++) {
    const gap: number = times[index]! - times[index - 1]!;
    if (gap > 0 && gap < step) {
      step = gap;
    }
  }
  if (Number.isFinite(step)) {
    return step;
  }
  return AggregationIntervalUtil.getAggregationIntervalMs(
    AggregationIntervalUtil.getAggregationIntervalForWindow({
      startDate: window.start,
      endDate: window.end,
    }),
  );
}

/**
 * A broker metric's chart-ready series as a count per interval: a
 * per-period count as it is, a counter's per-second rate times the width of
 * its intervals. Null for a level, which counts nothing.
 */
export function getMessageQueueBrokerCountSeries(
  result: MessageQueueBrokerMetricResult,
  window: { start: Date; end: Date },
): {
  series: Array<MessageQueueTimePoint>;
  isEstimatedFromRate: boolean;
} | null {
  const descriptor: MessageQueueMetricDescriptor = result.descriptor;
  if (descriptor.kind === "counter") {
    const seconds: number =
      getMessageQueueSeriesIntervalMs(result.series, window) / 1000;
    return {
      series: result.series
        .filter((point: MessageQueueTimePoint): boolean => {
          return Number.isFinite(point.y);
        })
        .map((point: MessageQueueTimePoint): MessageQueueTimePoint => {
          return { x: point.x, y: point.y * seconds };
        }),
      isEstimatedFromRate: true,
    };
  }
  if (descriptor.aggregation === AggregationType.Sum) {
    return {
      series: result.series.filter((point: MessageQueueTimePoint): boolean => {
        return Number.isFinite(point.y);
      }),
      isEstimatedFromRate: false,
    };
  }
  return null;
}

/**
 * The queue's broker figure for one signal, from the results Broker health
 * read (in catalog order), or null when no metric of that signal has data:
 *
 *   - published and consumed take the FIRST metric with data — the others
 *     count the same messages another way (Service Bus's Completed besides
 *     Outgoing, SQS's Deleted besides Received);
 *   - errors and throttled add up every metric with data — each counts a
 *     different failure — skipping a copy of one already counted and a
 *     metric of the other kind (a counter's estimate never joins exact
 *     per-period counts).
 */
export function getMessageQueueBrokerFigure(
  results: ReadonlyArray<MessageQueueBrokerMetricResult>,
  signal: MessageQueueFigureSignal,
  window: { start: Date; end: Date },
): MessageQueueBrokerFigure | null {
  const addsUp: boolean = signal === "errors" || signal === "throttled";
  const descriptors: Array<MessageQueueMetricDescriptor> = [];
  const counted: Set<string> = new Set<string>();
  let series: Array<MessageQueueTimePoint> = [];
  let isEstimatedFromRate: boolean = false;

  for (const result of results) {
    if (result.descriptor.signal !== signal || result.series.length === 0) {
      continue;
    }
    const counts: {
      series: Array<MessageQueueTimePoint>;
      isEstimatedFromRate: boolean;
    } | null = getMessageQueueBrokerCountSeries(result, window);
    if (!counts || counts.series.length === 0) {
      continue;
    }
    const baseTitle: string = baseTitleOf(result.descriptor);
    if (counted.has(baseTitle)) {
      continue;
    }
    if (
      descriptors.length > 0 &&
      descriptors[0]!.kind !== result.descriptor.kind
    ) {
      continue;
    }
    descriptors.push(result.descriptor);
    counted.add(baseTitle);
    series = addMessageQueueCountSeries(series, counts.series);
    isEstimatedFromRate = isEstimatedFromRate || counts.isEstimatedFromRate;
    if (!addsUp) {
      break;
    }
  }

  if (descriptors.length === 0) {
    return null;
  }

  return {
    signal: signal,
    descriptors: descriptors,
    series: series,
    total: series.reduce(
      (total: number, point: MessageQueueTimePoint): number => {
        return total + point.y;
      },
      0,
    ),
    isEstimatedFromRate: isEstimatedFromRate,
  };
}

function spanFigure(
  value: number | null,
  series: Array<MessageQueueTimePoint>,
): MessageQueueOverviewFigure {
  return { source: "spans", value: value, series: series, broker: null };
}

function brokerFigure(
  figure: MessageQueueBrokerFigure,
): MessageQueueOverviewFigure {
  return {
    source: "broker",
    value: figure.total,
    series: figure.series,
    broker: figure,
  };
}

/**
 * Every figure of the Overview with its source (see the header): spans
 * when the queue has them, its broker's metrics otherwise. Without a window
 * yet (the first load has not started) the broker is not read.
 */
export function getMessageQueueOverviewFigures(data: {
  spans: MessageQueueSpanMetrics;
  broker: ReadonlyArray<MessageQueueBrokerMetricResult>;
  window: { start: Date; end: Date } | null;
}): MessageQueueOverviewFigures {
  const spans: MessageQueueSpanMetrics = data.spans;
  const hasSpans: boolean = spans.total > 0;
  const window: { start: Date; end: Date } | null = data.window;
  const brokerOf: (
    signal: MessageQueueFigureSignal,
  ) => MessageQueueBrokerFigure | null = (
    signal: MessageQueueFigureSignal,
  ): MessageQueueBrokerFigure | null => {
    return window
      ? getMessageQueueBrokerFigure(data.broker, signal, window)
      : null;
  };

  const countFigure: (
    spanCount: number,
    spanSeries: Array<MessageQueueTimePoint>,
    signal: MessageQueueFigureSignal,
  ) => MessageQueueOverviewFigure = (
    spanCount: number,
    spanSeries: Array<MessageQueueTimePoint>,
    signal: MessageQueueFigureSignal,
  ): MessageQueueOverviewFigure => {
    if (spanCount > 0) {
      return spanFigure(spanCount, spanSeries);
    }
    const broker: MessageQueueBrokerFigure | null = brokerOf(signal);
    if (broker) {
      return brokerFigure(broker);
    }
    // Spans of other kinds make it a true 0; none at all, a dash.
    return spanFigure(hasSpans ? spanCount : null, spanSeries);
  };

  const published: MessageQueueOverviewFigure = countFigure(
    spans.published,
    spans.publishedSeries,
    "published",
  );
  const consumed: MessageQueueOverviewFigure = countFigure(
    spans.consumed,
    spans.consumedSeries,
    "consumed",
  );

  let errors: MessageQueueOverviewFigure = spanFigure(
    hasSpans ? spans.errors : null,
    spans.errorSeries,
  );
  if (!hasSpans) {
    const broker: MessageQueueBrokerFigure | null = brokerOf("errors");
    if (broker) {
      errors = brokerFigure(broker);
    }
  }

  return {
    published: published,
    consumed: consumed,
    errors: errors,
    throttled: brokerOf("throttled"),
    usesBrokerMetrics:
      published.source === "broker" ||
      consumed.source === "broker" ||
      errors.source === "broker",
    hasProcessingTime: spans.p95ProcessingMs !== null,
  };
}

// ---- words -----------------------------------------------------------------

/*
 * The line under a tile whose figure is the broker's: its source, as a span
 * tile's says "publish spans, selected range".
 */
export const MESSAGE_QUEUE_BROKER_FIGURE_SUBLABEL: string = translationKey(
  "broker metrics, selected range",
);

// The same, for a count worked out from a running total's rate.
export const MESSAGE_QUEUE_BROKER_ESTIMATE_SUBLABEL: string = translationKey(
  "broker metrics, estimated from a rate",
);

/*
 * What the processing-time tile and chart say instead of a dash: no broker
 * measures it, only consumer spans do.
 */
export const MESSAGE_QUEUE_NEEDS_CONSUMER_TRACES: string = translationKey(
  "Needs consumer traces",
);

/*
 * The Messages chart's lines, named by their source: a line the broker's
 * counts draw says so in the legend and the tooltip.
 */
export const MESSAGE_QUEUE_FIGURE_SERIES_NAMES: Record<
  "published" | "consumed" | "errors",
  Record<MessageQueueFigureSource, string>
> = {
  published: {
    spans: translationKey("Published"),
    broker: translationKey("Published (broker metrics)"),
  },
  consumed: {
    spans: translationKey("Consumed"),
    broker: translationKey("Consumed (broker metrics)"),
  },
  errors: {
    spans: translationKey("Errors"),
    broker: translationKey("Errors (broker metrics)"),
  },
};

/**
 * A figure's value for its tile: a count, a rate's estimate rounded to whole
 * messages, or a dash for nothing.
 */
export function formatMessageQueueFigureValue(
  figure: Pick<MessageQueueOverviewFigure, "value" | "broker">,
): string {
  if (figure.value === null) {
    return "—";
  }
  return formatMessageQueueCount(
    figure.broker?.isEstimatedFromRate
      ? Math.round(figure.value)
      : figure.value,
  );
}

/** The line under a broker figure's tile: where it comes from. */
export function getMessageQueueBrokerFigureSublabel(
  figure: MessageQueueBrokerFigure,
): string {
  return figure.isEstimatedFromRate
    ? MESSAGE_QUEUE_BROKER_ESTIMATE_SUBLABEL
    : MESSAGE_QUEUE_BROKER_FIGURE_SUBLABEL;
}

/**
 * The line under the Errors tile when its figure is the broker's: the source,
 * and the requests it throttled beside them when it reported any.
 */
export function getMessageQueueBrokerErrorsSublabel(
  figures: Pick<MessageQueueOverviewFigures, "errors" | "throttled">,
  translator: Translator = getGlobalTranslator(),
): string {
  const errors: MessageQueueBrokerFigure | null = figures.errors.broker;
  const source: string = errors
    ? getMessageQueueBrokerFigureSublabel(errors)
    : MESSAGE_QUEUE_BROKER_FIGURE_SUBLABEL;
  if (!figures.throttled) {
    return translator.translateText(source) || source;
  }
  const throttled: number = Math.round(figures.throttled.total);
  return translator.translatePlural(
    {
      one: "broker metrics; {{count}} request throttled",
      other: "broker metrics; {{count}} requests throttled",
    },
    throttled,
    { count: formatMessageQueueCount(throttled) },
  );
}

/**
 * What a broker figure's tile means, for its (i): which of the system's
 * metrics it reads, and why it reads them rather than spans.
 */
export function getMessageQueueBrokerFigureDescription(
  figure: MessageQueueBrokerFigure,
  messagingSystem: string | null | undefined,
  translator: Translator = getGlobalTranslator(),
): string {
  const values: TemplateValues = {
    system: getMessageQueueSystemLabel(messagingSystem),
    metrics: composedValue((words: Translator): string => {
      return formatList(
        figure.descriptors.map(
          (descriptor: MessageQueueMetricDescriptor): string => {
            return getMessageQueueBrokerMetricTitle(descriptor, words);
          },
        ),
        words,
      );
    }),
  };
  switch (figure.signal) {
    case "published":
      return translator.translateTemplate(
        "Messages {{system}} counted coming in to this queue in the selected range ({{metrics}}). No traced application publishes to it, so the tile reads the broker's own count.",
        values,
      );
    case "consumed":
      return translator.translateTemplate(
        "Messages {{system}} counted going out of this queue in the selected range ({{metrics}}). No traced application consumes from it, so the tile reads the broker's own count.",
        values,
      );
    case "errors":
      return translator.translateTemplate(
        "Failures {{system}} counted on this queue in the selected range, added up ({{metrics}}). No traced application uses it, so the tile reads the broker's own counts. Throttled requests are counted apart, under the number.",
        values,
      );
    default:
      return translator.translateTemplate(
        "Requests {{system}} throttled on this queue in the selected range ({{metrics}}).",
        values,
      );
  }
}
