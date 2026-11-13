import { describe, expect, test } from "@jest/globals";
import {
  MESSAGE_QUEUE_BROKER_ESTIMATE_SUBLABEL,
  MESSAGE_QUEUE_BROKER_FIGURE_SUBLABEL,
  MESSAGE_QUEUE_FIGURE_SERIES_NAMES,
  MESSAGE_QUEUE_NEEDS_CONSUMER_TRACES,
  MESSAGE_QUEUE_TRACE_CONSUMERS_LINK_LABEL,
  MessageQueueBrokerFigure,
  MessageQueueOverviewFigures,
  formatMessageQueueFigureValue,
  getMessageQueueBrokerCountSeries,
  getMessageQueueBrokerErrorsSublabel,
  getMessageQueueBrokerFigure,
  getMessageQueueBrokerFigureDescription,
  getMessageQueueBrokerFigureSublabel,
  getMessageQueueMessagesChart,
  getMessageQueueOverviewFigures,
  getMessageQueueSeriesIntervalMs,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueOverviewFigures";
import {
  EMPTY_MESSAGE_QUEUE_SPAN_METRICS,
  MessageQueueBrokerMetricResult,
  MessageQueueSpanMetrics,
  MessageQueueTimePoint,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import { Translator, createTranslator } from "../../../Types/Translator";

/*
 * WHERE EACH FIGURE AT THE TOP OF A QUEUE'S OVERVIEW COMES FROM
 * (MessageQueueOverviewFigures).
 *
 * A queue nobody traced still has its broker's counts: Published reads the
 * messages coming in, Consumed the messages going out, Errors every error
 * metric added up, with throttled requests counted apart. Spans win where
 * they exist — they say which service did what — and a level (a backlog, a
 * size) never stands in for a count. A running total's rate becomes a count
 * per interval and says it is an estimate; p95 processing time needs
 * consumer traces, and says so. The Messages chart draws the lines it has,
 * marking the broker's only beside a line of spans.
 */

const NOW: Date = new Date("2026-03-04T12:30:00.000Z");
const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const WINDOW: { start: Date; end: Date } = {
  start: new Date(NOW.getTime() - HOUR_MS),
  end: NOW,
};

const SERVICE_BUS: ReadonlyArray<MessageQueueMetricDescriptor> =
  getMessageQueueMetricsForSystem("servicebus");
const KAFKA: ReadonlyArray<MessageQueueMetricDescriptor> =
  getMessageQueueMetricsForSystem("kafka");
const SNS: ReadonlyArray<MessageQueueMetricDescriptor> =
  getMessageQueueMetricsForSystem("aws.sns");

function descriptorOf(
  catalog: ReadonlyArray<MessageQueueMetricDescriptor>,
  name: string,
): MessageQueueMetricDescriptor {
  const found: MessageQueueMetricDescriptor | undefined = catalog.find(
    (descriptor: MessageQueueMetricDescriptor): boolean => {
      return descriptor.metricName === name;
    },
  );
  if (!found) {
    throw new Error(`no catalog metric ${name}`);
  }
  return found;
}

function minute(index: number): Date {
  return new Date(WINDOW.start.getTime() + index * MINUTE_MS);
}

// A series of one value per minute from the window's start.
function perMinute(values: Array<number>): Array<MessageQueueTimePoint> {
  return values.map((y: number, index: number): MessageQueueTimePoint => {
    return { x: minute(index), y: y };
  });
}

function resultOf(
  descriptor: MessageQueueMetricDescriptor,
  series: Array<MessageQueueTimePoint>,
): MessageQueueBrokerMetricResult {
  return {
    descriptor: descriptor,
    series: series,
    value: series.length > 0 ? series[series.length - 1]!.y : null,
    observedSeries: [],
  };
}

function sb(
  name: string,
  values: Array<number>,
): MessageQueueBrokerMetricResult {
  return resultOf(
    descriptorOf(SERVICE_BUS, `azure_${name}`),
    perMinute(values),
  );
}

function titlesOf(figure: MessageQueueBrokerFigure | null): Array<string> {
  return (figure?.descriptors || []).map(
    (descriptor: MessageQueueMetricDescriptor): string => {
      return descriptor.title;
    },
  );
}

function spans(
  data: Partial<MessageQueueSpanMetrics>,
): MessageQueueSpanMetrics {
  return { ...EMPTY_MESSAGE_QUEUE_SPAN_METRICS, ...data };
}

// Every word through the translator: a lookup that marks what it worded.
const MARKED: Translator = createTranslator((key: string): string => {
  return `«${key}»`;
}, "en");

describe("a broker metric as a count per interval", () => {
  test("the interval: the smallest step between points, else the window's", () => {
    expect(
      getMessageQueueSeriesIntervalMs(
        [
          { x: minute(0), y: 1 },
          { x: minute(5), y: 1 },
          { x: minute(6), y: 1 },
          // A repeated time is no step.
          { x: minute(6), y: 1 },
        ],
        WINDOW,
      ),
    ).toBe(MINUTE_MS);
    // One point: the interval the aggregate API picks for an hour.
    expect(
      getMessageQueueSeriesIntervalMs([{ x: minute(0), y: 1 }], WINDOW),
    ).toBe(MINUTE_MS);
    expect(
      getMessageQueueSeriesIntervalMs([], {
        start: new Date(NOW.getTime() - 30 * 24 * HOUR_MS),
        end: NOW,
      }),
    ).toBeGreaterThan(MINUTE_MS);
  });

  /*
   * Day and week buckets start at the reader's midnight (issue #7277), so a
   * window that holds a change of the clocks has a day of 23 or 25 hours: a
   * New York reader's 8 March 2026 starts at 05:00 UTC and 9 March at 04:00.
   */
  test("a step of a day or a week across a change of the clocks is a whole day or week", () => {
    const month: { start: Date; end: Date } = {
      start: new Date("2026-02-20T05:00:00.000Z"),
      end: new Date("2026-03-20T04:00:00.000Z"),
    };
    const stepOf: (instants: Array<string>) => number = (
      instants: Array<string>,
    ): number => {
      return getMessageQueueSeriesIntervalMs(
        instants.map((instant: string): MessageQueueTimePoint => {
          return { x: new Date(instant), y: 1 };
        }),
        month,
      );
    };

    // New York's 8 March, 23 hours long.
    expect(
      stepOf([
        "2026-03-07T05:00:00.000Z",
        "2026-03-08T05:00:00.000Z",
        "2026-03-09T04:00:00.000Z",
      ]),
    ).toBe(24 * HOUR_MS);
    // New York's 1 November, 25 hours long, the only step in its window.
    expect(
      stepOf(["2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"]),
    ).toBe(24 * HOUR_MS);
    // Troll station's 29 March, 22 hours long.
    expect(
      stepOf(["2026-03-29T00:00:00.000Z", "2026-03-29T22:00:00.000Z"]),
    ).toBe(24 * HOUR_MS);
    // A New York week that holds 8 March: 167 hours.
    expect(
      stepOf(["2026-03-02T05:00:00.000Z", "2026-03-09T04:00:00.000Z"]),
    ).toBe(7 * 24 * HOUR_MS);
    // Further from a day than a change of the clocks moves it: its own step.
    for (const hours of [12, 21, 27, 48]) {
      expect(
        stepOf([
          "2026-03-07T05:00:00.000Z",
          new Date(
            Date.parse("2026-03-07T05:00:00.000Z") + hours * HOUR_MS,
          ).toISOString(),
        ]),
      ).toBe(hours * HOUR_MS);
    }

    // A running total's rate over those days is a whole day's count.
    const offsets: MessageQueueBrokerMetricResult = resultOf(
      descriptorOf(KAFKA, "kafka.consumer_group.offset_sum"),
      [
        { x: new Date("2026-03-07T05:00:00.000Z"), y: 0.5 },
        { x: new Date("2026-03-08T05:00:00.000Z"), y: 1 },
        { x: new Date("2026-03-09T04:00:00.000Z"), y: 2 },
      ],
    );
    expect(
      getMessageQueueBrokerCountSeries(offsets, month)?.series.map(
        (point: MessageQueueTimePoint): number => {
          return point.y;
        },
      ),
    ).toEqual([43200, 86400, 172800]);
  });

  test("a per-period count as it is; a running total's rate times its interval, an estimate; a level, nothing", () => {
    expect(
      getMessageQueueBrokerCountSeries(
        sb("incomingmessages_total", [3, 4]),
        WINDOW,
      ),
    ).toEqual({ series: perMinute([3, 4]), isEstimatedFromRate: false });

    // 0.5 messages a second over one-minute intervals: 30 a minute.
    const offsets: MessageQueueBrokerMetricResult = resultOf(
      descriptorOf(KAFKA, "kafka.consumer_group.offset_sum"),
      perMinute([0.5, 2]),
    );
    expect(getMessageQueueBrokerCountSeries(offsets, WINDOW)).toEqual({
      series: perMinute([30, 120]),
      isEstimatedFromRate: true,
    });

    // A point that is not a number is never counted.
    expect(
      getMessageQueueBrokerCountSeries(
        resultOf(descriptorOf(SERVICE_BUS, "azure_incomingmessages_total"), [
          { x: minute(0), y: 2 },
          { x: minute(1), y: Number.NaN },
        ]),
        WINDOW,
      )?.series,
    ).toEqual(perMinute([2]));

    for (const level of [
      "activemessages_average",
      "deadletteredmessages_average",
      "scheduledmessages_average",
      "size_average",
      "serversendlatency_average",
    ]) {
      expect(
        getMessageQueueBrokerCountSeries(sb(level, [5]), WINDOW),
      ).toBeNull();
    }
  });
});

describe("a broker figure", () => {
  test("published reads the messages coming in; consumed the first metric going out", () => {
    const results: Array<MessageQueueBrokerMetricResult> = [
      sb("activemessages_average", [40, 41]),
      sb("incomingmessages_total", [3, 4]),
      sb("outgoingmessages_total", [2, 2]),
      sb("completemessage_total", [2, 1]),
    ];
    const published: MessageQueueBrokerFigure | null =
      getMessageQueueBrokerFigure(results, "published", WINDOW);
    expect(titlesOf(published)).toEqual(["Incoming messages"]);
    expect(published?.total).toBe(7);
    expect(published?.series).toEqual(perMinute([3, 4]));
    expect(published?.isEstimatedFromRate).toBe(false);

    // Completed counts the same messages as Outgoing: one of them.
    const consumed: MessageQueueBrokerFigure | null =
      getMessageQueueBrokerFigure(results, "consumed", WINDOW);
    expect(titlesOf(consumed)).toEqual(["Outgoing messages"]);
    expect(consumed?.total).toBe(4);

    // Without Outgoing, Completed stands in.
    expect(
      titlesOf(
        getMessageQueueBrokerFigure(
          [sb("outgoingmessages_total", []), sb("completemessage_total", [5])],
          "consumed",
          WINDOW,
        ),
      ),
    ).toEqual(["Completed messages"]);
  });

  test("errors add up every error metric with data; throttled requests are a figure of their own", () => {
    const results: Array<MessageQueueBrokerMetricResult> = [
      sb("abandonmessage_total", [1, 0, 2]),
      sb("servererrors_total", [0, 1]),
      sb("usererrors_total", []),
      sb("throttledrequests_total", [0, 6]),
    ];
    const errors: MessageQueueBrokerFigure | null = getMessageQueueBrokerFigure(
      results,
      "errors",
      WINDOW,
    );
    expect(titlesOf(errors)).toEqual(["Abandoned messages", "Server errors"]);
    expect(errors?.series).toEqual(perMinute([1, 1, 2]));
    expect(errors?.total).toBe(4);

    const throttled: MessageQueueBrokerFigure | null =
      getMessageQueueBrokerFigure(results, "throttled", WINDOW);
    expect(titlesOf(throttled)).toEqual(["Throttled requests"]);
    expect(throttled?.total).toBe(6);

    // No metric of the signal with data: no figure.
    expect(
      getMessageQueueBrokerFigure(results, "published", WINDOW),
    ).toBeNull();
    expect(getMessageQueueBrokerFigure([], "errors", WINDOW)).toBeNull();
  });

  test("a copy of a metric already counted, or one of the other kind, is never added", () => {
    // The same CloudWatch metric by the pull receiver and a JSON stream.
    const failed: Array<MessageQueueMetricDescriptor> = SNS.filter(
      (descriptor: MessageQueueMetricDescriptor): boolean => {
        return descriptor.metricName.endsWith("numberofnotificationsfailed");
      },
    );
    expect(failed).toHaveLength(2);
    expect(
      getMessageQueueBrokerFigure(
        failed.map(
          (
            descriptor: MessageQueueMetricDescriptor,
          ): MessageQueueBrokerMetricResult => {
            return resultOf(descriptor, perMinute([2]));
          },
        ),
        "errors",
        WINDOW,
      )?.total,
    ).toBe(2);

    // A running total's estimate never joins exact per-period counts.
    const abandoned: MessageQueueMetricDescriptor = descriptorOf(
      SERVICE_BUS,
      "azure_abandonmessage_total",
    );
    const counter: MessageQueueMetricDescriptor = {
      ...abandoned,
      metricName: "messages_failed_total",
      title: "Failed deliveries",
      kind: "counter",
    };
    const figure: MessageQueueBrokerFigure | null = getMessageQueueBrokerFigure(
      [resultOf(abandoned, perMinute([1])), resultOf(counter, perMinute([1]))],
      "errors",
      WINDOW,
    );
    expect(titlesOf(figure)).toEqual(["Abandoned messages"]);
    expect(figure?.isEstimatedFromRate).toBe(false);
  });
});

describe("the Overview's figures", () => {
  const BROKER: Array<MessageQueueBrokerMetricResult> = [
    sb("activemessages_average", [40]),
    sb("incomingmessages_total", [3, 4]),
    sb("outgoingmessages_total", [2, 2]),
    sb("abandonmessage_total", [1]),
    sb("throttledrequests_total", [5]),
  ];

  test("a queue only its broker reports: every count is the broker's", () => {
    const figures: MessageQueueOverviewFigures = getMessageQueueOverviewFigures(
      {
        spans: spans({}),
        broker: BROKER,
        window: WINDOW,
      },
    );
    expect([
      figures.published.source,
      figures.consumed.source,
      figures.errors.source,
    ]).toEqual(["broker", "broker", "broker"]);
    expect([
      figures.published.value,
      figures.consumed.value,
      figures.errors.value,
    ]).toEqual([7, 4, 1]);
    expect(figures.published.series).toEqual(perMinute([3, 4]));
    expect(figures.throttled?.total).toBe(5);
    expect(figures.errorsTileBroker).toBe(figures.errors.broker);
    expect(figures.usesBrokerMetrics).toBe(true);
    expect(figures.hasProcessingTime).toBe(false);
  });

  test("spans win where they exist, side by side", () => {
    // Traced publishers, no traced consumer: Consumed is the broker's.
    const figures: MessageQueueOverviewFigures = getMessageQueueOverviewFigures(
      {
        spans: spans({
          total: 10,
          published: 10,
          publishedSeries: perMinute([10]),
          errors: 0,
        }),
        broker: BROKER,
        window: WINDOW,
      },
    );
    expect(figures.published).toEqual({
      source: "spans",
      value: 10,
      series: perMinute([10]),
      broker: null,
    });
    expect(figures.consumed.source).toBe("broker");
    expect(figures.consumed.value).toBe(4);
    // Any span at all makes the spans' 0 errors true: never the broker's.
    expect(figures.errors).toEqual({
      source: "spans",
      value: 0,
      series: [],
      broker: null,
    });
    expect(figures.errorsTileBroker).toBeNull();
    expect(figures.usesBrokerMetrics).toBe(true);
  });

  test("nothing from either: a span count of 0 where spans of other kinds exist, a dash where none does", () => {
    const traced: MessageQueueOverviewFigures = getMessageQueueOverviewFigures({
      spans: spans({ total: 3, published: 3, publishedSeries: perMinute([3]) }),
      broker: [],
      window: WINDOW,
    });
    expect(traced.consumed.value).toBe(0);
    expect(traced.consumed.source).toBe("spans");
    expect(traced.usesBrokerMetrics).toBe(false);

    const neither: MessageQueueOverviewFigures = getMessageQueueOverviewFigures(
      {
        spans: spans({}),
        broker: [sb("activemessages_average", [40])],
        window: WINDOW,
      },
    );
    // A backlog never stands in for a count.
    expect([
      neither.published.value,
      neither.consumed.value,
      neither.errors.value,
    ]).toEqual([null, null, null]);
    expect(neither.throttled).toBeNull();
    expect(neither.errorsTileBroker).toBeNull();
    expect(neither.usesBrokerMetrics).toBe(false);
  });

  test("throttled requests without an error count stand under the Errors tile's dash", () => {
    const figures: MessageQueueOverviewFigures = getMessageQueueOverviewFigures(
      {
        spans: spans({}),
        broker: [sb("throttledrequests_total", [2, 3])],
        window: WINDOW,
      },
    );
    expect(figures.errors.value).toBeNull();
    expect(figures.errorsTileBroker?.signal).toBe("throttled");
    expect(figures.errorsTileBroker?.total).toBe(5);
    // A traced queue's Errors tile is its spans', throttling or not.
    expect(
      getMessageQueueOverviewFigures({
        spans: spans({ total: 1, consumed: 1 }),
        broker: [sb("throttledrequests_total", [2, 3])],
        window: WINDOW,
      }).errorsTileBroker,
    ).toBeNull();
  });

  test("before the first load has a window, the broker is not read", () => {
    const figures: MessageQueueOverviewFigures = getMessageQueueOverviewFigures(
      {
        spans: spans({}),
        broker: BROKER,
        window: null,
      },
    );
    expect(figures.published.value).toBeNull();
    expect(figures.throttled).toBeNull();
    expect(figures.usesBrokerMetrics).toBe(false);
  });

  test("a processing time needs consumer spans that handled messages", () => {
    expect(
      getMessageQueueOverviewFigures({
        spans: spans({ total: 4, consumed: 4, p95ProcessingMs: 12 }),
        broker: [],
        window: WINDOW,
      }).hasProcessingTime,
    ).toBe(true);
    expect(
      getMessageQueueOverviewFigures({
        spans: spans({ total: 4, published: 4 }),
        broker: BROKER,
        window: WINDOW,
      }).hasProcessingTime,
    ).toBe(false);
  });
});

describe("the Messages chart's lines", () => {
  const namesOf: (
    chart: ReturnType<typeof getMessageQueueMessagesChart>,
  ) => Array<string> = (
    chart: ReturnType<typeof getMessageQueueMessagesChart>,
  ): Array<string> => {
    return chart.lines.map((line: { seriesName: string }): string => {
      return line.seriesName;
    });
  };

  test("spans only: its three lines, as the chart always drew them", () => {
    const chart: ReturnType<typeof getMessageQueueMessagesChart> =
      getMessageQueueMessagesChart(
        getMessageQueueOverviewFigures({
          spans: spans({
            total: 5,
            published: 5,
            publishedSeries: perMinute([5]),
          }),
          broker: [],
          window: WINDOW,
        }),
      );
    expect(chart.sources).toBe("spans");
    // An empty line keeps its place: the chart is the spans' as it was.
    expect(namesOf(chart)).toEqual(["Published", "Consumed", "Errors"]);
    expect(chart.lines[1]!.data).toEqual([]);
  });

  test("the broker's only: plain names, and no line without a point", () => {
    // Messages in and out, no error metric: two lines, no empty Errors.
    const chart: ReturnType<typeof getMessageQueueMessagesChart> =
      getMessageQueueMessagesChart(
        getMessageQueueOverviewFigures({
          spans: spans({}),
          broker: [
            sb("incomingmessages_total", [3, 4]),
            sb("outgoingmessages_total", [2, 2]),
          ],
          window: WINDOW,
        }),
      );
    expect(chart.sources).toBe("broker");
    expect(namesOf(chart)).toEqual(["Published", "Consumed"]);
    expect(chart.lines[0]!.data).toEqual(perMinute([3, 4]));

    /*
     * A line whose tile reads a dash is not drawn either, whatever buckets
     * a read of no span returned: a flat 0 the tile does not claim, which
     * would make the chart read as mixed.
     */
    const dashed: ReturnType<typeof getMessageQueueMessagesChart> =
      getMessageQueueMessagesChart(
        getMessageQueueOverviewFigures({
          spans: spans({ errorSeries: perMinute([0, 0]) }),
          broker: [
            sb("incomingmessages_total", [3, 4]),
            sb("outgoingmessages_total", [2, 2]),
          ],
          window: WINDOW,
        }),
      );
    expect(dashed.sources).toBe("broker");
    expect(namesOf(dashed)).toEqual(["Published", "Consumed"]);
    expect(MESSAGE_QUEUE_FIGURE_SERIES_NAMES.published.spans).toBe("Published");
  });

  test("spans beside the broker's counts: only the broker's lines say so", () => {
    const chart: ReturnType<typeof getMessageQueueMessagesChart> =
      getMessageQueueMessagesChart(
        getMessageQueueOverviewFigures({
          spans: spans({
            total: 10,
            published: 10,
            publishedSeries: perMinute([10]),
            errors: 1,
            errorSeries: perMinute([1]),
          }),
          broker: [sb("outgoingmessages_total", [2, 2])],
          window: WINDOW,
        }),
      );
    expect(chart.sources).toBe("mixed");
    expect(namesOf(chart)).toEqual([
      "Published",
      "Consumed (broker metrics)",
      "Errors",
    ]);

    // A spans' line with no point is left out, not named beside them.
    expect(
      namesOf(
        getMessageQueueMessagesChart(
          getMessageQueueOverviewFigures({
            spans: spans({
              total: 10,
              published: 10,
              publishedSeries: perMinute([10]),
            }),
            broker: [sb("outgoingmessages_total", [2, 2])],
            window: WINDOW,
          }),
        ),
      ),
    ).toEqual(["Published", "Consumed (broker metrics)"]);
  });

  test("processing time without consumer traces: what gives it, and where to read how", () => {
    expect(MESSAGE_QUEUE_NEEDS_CONSUMER_TRACES).toBe("Needs consumer traces");
    expect(MESSAGE_QUEUE_TRACE_CONSUMERS_LINK_LABEL).toBe(
      "Trace your consumers →",
    );
  });
});

describe("the figures' words", () => {
  const ERRORS: MessageQueueBrokerFigure = getMessageQueueBrokerFigure(
    [
      sb("abandonmessage_total", [1]),
      sb("servererrors_total", [1]),
      sb("usererrors_total", [1]),
    ],
    "errors",
    WINDOW,
  )!;

  test("a value: a count, a rate's estimate in whole messages, or a dash", () => {
    expect(formatMessageQueueFigureValue({ value: null, broker: null })).toBe(
      "—",
    );
    expect(formatMessageQueueFigureValue({ value: 7, broker: null })).toBe("7");
    expect(formatMessageQueueFigureValue({ value: 1234, broker: null })).toBe(
      "1.2k",
    );
    expect(
      formatMessageQueueFigureValue({
        value: 2.6,
        broker: { ...ERRORS, isEstimatedFromRate: true },
      }),
    ).toBe("3");
    // An exact count keeps what it is.
    expect(formatMessageQueueFigureValue({ value: 2.5, broker: ERRORS })).toBe(
      "2.5",
    );
  });

  test("under a broker tile: its source, and the requests throttled beside the errors", () => {
    expect(MESSAGE_QUEUE_BROKER_FIGURE_SUBLABEL).toBe(
      "broker metrics, selected range",
    );
    expect(getMessageQueueBrokerFigureSublabel(ERRORS)).toBe(
      MESSAGE_QUEUE_BROKER_FIGURE_SUBLABEL,
    );
    expect(
      getMessageQueueBrokerFigureSublabel({
        ...ERRORS,
        isEstimatedFromRate: true,
      }),
    ).toBe(MESSAGE_QUEUE_BROKER_ESTIMATE_SUBLABEL);
    // Short enough for a tile beside the side menu, as its sibling is.
    expect(MESSAGE_QUEUE_BROKER_ESTIMATE_SUBLABEL).toBe(
      "estimated from broker metrics",
    );
    expect(MESSAGE_QUEUE_BROKER_ESTIMATE_SUBLABEL.length).toBeLessThanOrEqual(
      MESSAGE_QUEUE_BROKER_FIGURE_SUBLABEL.length,
    );

    const errorsFigure: MessageQueueOverviewFigures["errors"] = {
      source: "broker",
      value: ERRORS.total,
      series: ERRORS.series,
      broker: ERRORS,
    };
    expect(
      getMessageQueueBrokerErrorsSublabel({
        errors: errorsFigure,
        throttled: null,
      }),
    ).toBe("broker metrics, selected range");
    const throttled: (total: number) => MessageQueueBrokerFigure = (
      total: number,
    ): MessageQueueBrokerFigure => {
      return { ...ERRORS, signal: "throttled", total: total };
    };
    expect(
      getMessageQueueBrokerErrorsSublabel({
        errors: errorsFigure,
        throttled: throttled(1),
      }),
    ).toBe("broker metrics; 1 throttled");
    expect(
      getMessageQueueBrokerErrorsSublabel({
        errors: errorsFigure,
        throttled: throttled(2.6),
      }),
    ).toBe("broker metrics; 3 throttled");
    expect(
      getMessageQueueBrokerErrorsSublabel(
        { errors: errorsFigure, throttled: throttled(4) },
        MARKED,
      ),
    ).toBe("«broker metrics; 4 throttled»");
    // None throttled beside the errors: nothing to add to the source.
    for (const total of [0, 0.4]) {
      expect(
        getMessageQueueBrokerErrorsSublabel({
          errors: errorsFigure,
          throttled: throttled(total),
        }),
      ).toBe("broker metrics, selected range");
    }
    /*
     * Under the tile's dash (no error count, only throttled requests) the
     * throttled count is all the tile has: shown, 0 too.
     */
    const noErrors: MessageQueueOverviewFigures["errors"] = {
      source: "spans",
      value: null,
      series: [],
      broker: null,
    };
    for (const [total, line] of [
      [0, "broker metrics; 0 throttled"],
      [5, "broker metrics; 5 throttled"],
    ] as Array<[number, string]>) {
      expect(
        getMessageQueueBrokerErrorsSublabel({
          errors: noErrors,
          throttled: throttled(total),
        }),
      ).toBe(line);
    }
  });

  test("a broker tile's (i) names the metrics it reads, and why it reads them", () => {
    expect(getMessageQueueBrokerFigureDescription(ERRORS, "servicebus")).toBe(
      "Failures Azure Service Bus counted on this queue in the selected range, added up (Abandoned messages, Server errors, User errors). No traced application uses it, so the tile reads the broker's own counts. Throttled requests are counted apart, under the number.",
    );
    const incoming: MessageQueueBrokerFigure = getMessageQueueBrokerFigure(
      [sb("incomingmessages_total", [1])],
      "published",
      WINDOW,
    )!;
    expect(getMessageQueueBrokerFigureDescription(incoming, "servicebus")).toBe(
      "Messages Azure Service Bus counted coming in to this queue in the selected range (Incoming messages). No traced application publishes to it, so the tile reads the broker's own count.",
    );
    const outgoing: MessageQueueBrokerFigure = getMessageQueueBrokerFigure(
      [sb("outgoingmessages_total", [1])],
      "consumed",
      WINDOW,
    )!;
    expect(getMessageQueueBrokerFigureDescription(outgoing, "servicebus")).toBe(
      "Messages Azure Service Bus counted going out of this queue in the selected range (Outgoing messages). No traced application consumes from it, so the tile reads the broker's own count.",
    );
    const throttled: MessageQueueBrokerFigure = getMessageQueueBrokerFigure(
      [sb("throttledrequests_total", [1])],
      "throttled",
      WINDOW,
    )!;
    expect(
      getMessageQueueBrokerFigureDescription(throttled, "servicebus"),
    ).toBe(
      "No traced application uses this queue, and Azure Service Bus sent no error count for it in the selected range, so the tile has no number. Under it: the requests Azure Service Bus throttled (Throttled requests).",
    );

    for (const figure of [ERRORS, incoming, outgoing, throttled]) {
      expect(
        getMessageQueueBrokerFigureDescription(figure, "servicebus", MARKED),
      ).toMatch(/^«.*»$/);
    }
  });

  test("the Messages chart names each line by its source; p95 says what gives it", () => {
    expect(MESSAGE_QUEUE_FIGURE_SERIES_NAMES).toEqual({
      published: {
        spans: "Published",
        broker: "Published (broker metrics)",
      },
      consumed: { spans: "Consumed", broker: "Consumed (broker metrics)" },
      errors: { spans: "Errors", broker: "Errors (broker metrics)" },
    });
    expect(MESSAGE_QUEUE_NEEDS_CONSUMER_TRACES).toBe("Needs consumer traces");
  });
});
