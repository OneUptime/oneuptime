import { AggregationTemporality } from "../../../Models/AnalyticsModels/Metric";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import Timezone from "../../../Types/Timezone";
import MetricZeroFill, {
  MetricPointSemantics,
  MetricZeroFillOptions,
} from "../../../Utils/Metrics/MetricZeroFill";
import { INGEST_BACKLOG_ALLOWANCE_MS } from "../../../Utils/Telemetry/ReceivingGaps";
import { describe, expect, test } from "@jest/globals";

/*
 * WHEN A FORMULA READS A QUERY WITH NO POINT IN A STEP AS 0 (issue #6761):
 * which queries count what happened, and which steps are over.
 */

const MINUTE: number = 60 * 1000;

const query: (input: {
  metricName?: string | undefined;
  aggregation?: AggregationType | undefined;
}) => MetricQueryConfigData = (input: {
  metricName?: string | undefined;
  aggregation?: AggregationType | undefined;
}): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        ...(input.metricName !== undefined
          ? { metricName: input.metricName }
          : {}),
        ...(input.aggregation !== undefined
          ? { aggegationType: input.aggregation }
          : {}),
      },
    },
  } as MetricQueryConfigData;
};

const DELTA_COUNTER: MetricPointSemantics = {
  isMonotonic: true,
  aggregationTemporality: AggregationTemporality.Delta,
};
const CUMULATIVE_COUNTER: MetricPointSemantics = {
  isMonotonic: true,
  aggregationTemporality: AggregationTemporality.Cumulative,
};
// A histogram carries a temporality and no monotonicity.
const DELTA_HISTOGRAM: MetricPointSemantics = {
  isMonotonic: null,
  aggregationTemporality: AggregationTemporality.Delta,
};
const CUMULATIVE_HISTOGRAM: MetricPointSemantics = {
  isMonotonic: null,
  aggregationTemporality: AggregationTemporality.Cumulative,
};
// Datadog's counts arrive as delta sums that are not monotonic.
const DELTA_UP_DOWN_COUNTER: MetricPointSemantics = {
  isMonotonic: false,
  aggregationTemporality: AggregationTemporality.Delta,
};
const CUMULATIVE_UP_DOWN_COUNTER: MetricPointSemantics = {
  isMonotonic: false,
  aggregationTemporality: AggregationTemporality.Cumulative,
};
// A gauge carries neither, and neither does a metric OneUptime writes itself.
const GAUGE: MetricPointSemantics = {
  isMonotonic: null,
  aggregationTemporality: null,
};

const CATALOG: ReadonlyMap<string, MetricPointSemantics> = new Map<
  string,
  MetricPointSemantics
>([
  ["notification.send.count", DELTA_COUNTER],
  ["http.server.request.duration", DELTA_HISTOGRAM],
  ["system.memory.usage", GAUGE],
]);

describe("MetricZeroFill.countsWhatHappened", () => {
  test.each([
    ["a delta counter", DELTA_COUNTER, true],
    ["a delta histogram", DELTA_HISTOGRAM, true],
    ["a delta sum that is not monotonic", DELTA_UP_DOWN_COUNTER, true],
    ["a cumulative counter", CUMULATIVE_COUNTER, true],
    ["a cumulative histogram", CUMULATIVE_HISTOGRAM, true],
    [
      "a cumulative up-down counter (a level)",
      CUMULATIVE_UP_DOWN_COUNTER,
      false,
    ],
    ["a gauge", GAUGE, false],
    ["a gauge that says it is monotonic", { isMonotonic: true }, false],
    [
      "a temporality nobody knows",
      { aggregationTemporality: "Sometimes" },
      false,
    ],
    ["nothing the catalog knows", undefined, false],
    ["nothing at all", null, false],
  ])(
    "%s: %s",
    (
      _name: string,
      semantics: MetricPointSemantics | null | undefined,
      counts: boolean,
    ) => {
      expect(MetricZeroFill.countsWhatHappened(semantics)).toBe(counts);
    },
  );
});

describe("MetricZeroFill.isCountingQuery", () => {
  test.each([AggregationType.Sum, AggregationType.Count])(
    "the %s of a delta counter counts what happened",
    (aggregation: AggregationType) => {
      expect(
        MetricZeroFill.isCountingQuery({
          queryConfig: query({
            metricName: "notification.send.count",
            aggregation,
          }),
          semanticsByMetricName: CATALOG,
        }),
      ).toBe(true);
    },
  );

  test.each([
    AggregationType.Avg,
    AggregationType.Min,
    AggregationType.Max,
    AggregationType.P50,
    AggregationType.P75,
    AggregationType.P90,
    AggregationType.P95,
    AggregationType.P99,
  ])(
    "the %s of a counter has no value in a step with nothing: never 0",
    (aggregation: AggregationType) => {
      expect(
        MetricZeroFill.isCountingQuery({
          queryConfig: query({
            metricName: "notification.send.count",
            aggregation,
          }),
          semanticsByMetricName: CATALOG,
        }),
      ).toBe(false);
    },
  );

  test("the Count of a histogram counts, its P95 does not", () => {
    expect(
      MetricZeroFill.isCountingQuery({
        queryConfig: query({
          metricName: "http.server.request.duration",
          aggregation: AggregationType.Count,
        }),
        semanticsByMetricName: CATALOG,
      }),
    ).toBe(true);
    expect(
      MetricZeroFill.isCountingQuery({
        queryConfig: query({
          metricName: "http.server.request.duration",
          aggregation: AggregationType.P95,
        }),
        semanticsByMetricName: CATALOG,
      }),
    ).toBe(false);
  });

  test("the Sum of a gauge is unknown with no sample: never 0", () => {
    expect(
      MetricZeroFill.isCountingQuery({
        queryConfig: query({
          metricName: "system.memory.usage",
          aggregation: AggregationType.Sum,
        }),
        semanticsByMetricName: CATALOG,
      }),
    ).toBe(false);
  });

  test("a metric the catalog does not list is never guessed at", () => {
    expect(
      MetricZeroFill.isCountingQuery({
        queryConfig: query({
          metricName: "aws.lambda.errors",
          aggregation: AggregationType.Sum,
        }),
        semanticsByMetricName: CATALOG,
      }),
    ).toBe(false);
  });

  test("reads the metric's name in any case", () => {
    expect(
      MetricZeroFill.isCountingQuery({
        queryConfig: query({
          metricName: "  Notification.Send.Count ",
          aggregation: AggregationType.Sum,
        }),
        semanticsByMetricName: CATALOG,
      }),
    ).toBe(true);
  });

  test("a query with no metric, no aggregation (read as Avg) or no config does not count", () => {
    expect(
      MetricZeroFill.isCountingQuery({
        queryConfig: query({ aggregation: AggregationType.Sum }),
        semanticsByMetricName: CATALOG,
      }),
    ).toBe(false);
    expect(
      MetricZeroFill.isCountingQuery({
        queryConfig: query({ metricName: "notification.send.count" }),
        semanticsByMetricName: CATALOG,
      }),
    ).toBe(false);
    expect(
      MetricZeroFill.isCountingQuery({
        queryConfig: undefined,
        semanticsByMetricName: CATALOG,
      }),
    ).toBe(false);
  });
});

describe("MetricZeroFill.getSemanticsByMetricName", () => {
  test("keys the catalog by lowercase name, and reads what it does not know as unknown", () => {
    const semantics: Map<string, MetricPointSemantics> =
      MetricZeroFill.getSemanticsByMetricName([
        {
          name: "Notification.Send.Count",
          isMonotonic: true,
          aggregationTemporality: AggregationTemporality.Delta,
        },
        { name: "system.memory.usage" },
        { name: "" },
        null,
        undefined,
      ]);

    expect(Array.from(semantics.entries())).toEqual([
      [
        "notification.send.count",
        {
          isMonotonic: true,
          aggregationTemporality: AggregationTemporality.Delta,
        },
      ],
      [
        "system.memory.usage",
        { isMonotonic: null, aggregationTemporality: null },
      ],
    ]);
  });
});

describe("MetricZeroFill.isStepSettled", () => {
  const readAt: Date = new Date("2026-11-01T12:10:30.000Z");
  const window: { startDate: Date; endDate: Date } = {
    startDate: new Date("2026-11-01T11:10:30.000Z"),
    endDate: readAt,
  };

  const settled: (
    stepStart: string,
    interval?: AggregationInterval,
  ) => boolean = (
    stepStart: string,
    interval?: AggregationInterval,
  ): boolean => {
    return MetricZeroFill.isStepSettled({
      stepStart: new Date(stepStart),
      window,
      aggregationInterval: interval || AggregationInterval.Minute,
      readAt,
    });
  };

  test("waits the ingest queue's normal lag after a step ends", () => {
    expect(MetricZeroFill.SETTLE_MS).toBe(INGEST_BACKLOG_ALLOWANCE_MS);
    expect(MetricZeroFill.SETTLE_MS).toBe(MINUTE);
  });

  test("a step over for a minute is settled; the one that just ended and the one still running are not", () => {
    // 12:08 ended at 12:09:00, 90 seconds before the read.
    expect(settled("2026-11-01T12:08:00.000Z")).toBe(true);
    // 12:09 ended at 12:10:00, 30 seconds before it: its last points may be queued.
    expect(settled("2026-11-01T12:09:00.000Z")).toBe(false);
    // 12:10 is still running.
    expect(settled("2026-11-01T12:10:00.000Z")).toBe(false);
  });

  test("exactly a minute after its end is settled", () => {
    expect(
      MetricZeroFill.isStepSettled({
        stepStart: new Date("2026-11-01T12:08:00.000Z"),
        window,
        aggregationInterval: AggregationInterval.Minute,
        readAt: new Date("2026-11-01T12:10:00.000Z"),
      }),
    ).toBe(true);
    expect(
      MetricZeroFill.isStepSettled({
        stepStart: new Date("2026-11-01T12:08:00.000Z"),
        window,
        aggregationInterval: AggregationInterval.Minute,
        readAt: new Date("2026-11-01T12:09:59.999Z"),
      }),
    ).toBe(false);
  });

  test("a read of the past is settled to its last step, which ends where the read does", () => {
    const pastWindow: { startDate: Date; endDate: Date } = {
      startDate: new Date("2026-11-01T09:00:00.000Z"),
      endDate: new Date("2026-11-01T10:00:30.000Z"),
    };

    // The last step runs past the read's end, which is long over.
    expect(
      MetricZeroFill.isStepSettled({
        stepStart: new Date("2026-11-01T10:00:00.000Z"),
        window: pastWindow,
        aggregationInterval: AggregationInterval.Minute,
        readAt,
      }),
    ).toBe(true);
  });

  test("an hour's step is settled a minute after the hour ends", () => {
    expect(settled("2026-11-01T11:00:00.000Z", AggregationInterval.Hour)).toBe(
      true,
    );
    expect(settled("2026-11-01T12:00:00.000Z", AggregationInterval.Hour)).toBe(
      false,
    );
  });

  test("a day ends at the reader's midnight, as the read cut it, on the day the clocks change too", () => {
    /*
     * New York's 1 November 2026 starts at 04:00 UTC (EDT) and is the day
     * its clocks go back: 25 hours long, it ends at 05:00 UTC on the 2nd,
     * not 24 hours on.
     */
    const stepStart: Date = new Date("2026-11-01T04:00:00.000Z");
    const dayWindow: { startDate: Date; endDate: Date } = {
      startDate: new Date("2026-10-01T04:00:00.000Z"),
      endDate: new Date("2026-11-03T04:00:00.000Z"),
    };

    const settledAt: (readAtValue: string) => boolean = (
      readAtValue: string,
    ): boolean => {
      return MetricZeroFill.isStepSettled({
        stepStart,
        window: dayWindow,
        aggregationInterval: AggregationInterval.Day,
        timezone: Timezone.AmericaNew_York,
        readAt: new Date(readAtValue),
      });
    };

    expect(settledAt("2026-11-02T04:01:00.000Z")).toBe(false);
    expect(settledAt("2026-11-02T05:00:59.000Z")).toBe(false);
    expect(settledAt("2026-11-02T05:01:00.000Z")).toBe(true);
  });

  test("a read as one value (Total) is one step, over where the window ends", () => {
    const total: (readAtValue: Date) => boolean = (
      readAtValue: Date,
    ): boolean => {
      return MetricZeroFill.isStepSettled({
        stepStart: window.endDate,
        window,
        aggregationInterval: AggregationInterval.Total,
        readAt: readAtValue,
      });
    };

    // A monitor reads its window up to now: its one value is never settled.
    expect(total(window.endDate)).toBe(false);
    expect(total(new Date(window.endDate.getTime() + MINUTE))).toBe(true);
  });

  test("a step whose time cannot be read is never settled", () => {
    expect(
      MetricZeroFill.isStepSettled({
        stepStart: new Date("not a time"),
        window,
        aggregationInterval: AggregationInterval.Minute,
        readAt,
      }),
    ).toBe(false);
  });
});

describe("MetricZeroFill.getOptions", () => {
  const readAt: Date = new Date("2026-11-01T12:10:30.000Z");

  test("cuts a window into the aggregate API's steps: a minute up to three hours", () => {
    const options: MetricZeroFillOptions = MetricZeroFill.getOptions({
      metricTypes: [
        {
          name: "notification.send.count",
          isMonotonic: true,
          aggregationTemporality: AggregationTemporality.Delta,
        },
      ],
      window: {
        startDate: new Date("2026-11-01T11:10:30.000Z"),
        endDate: readAt,
      },
      readAt,
    });

    expect(
      options.semanticsByMetricName.get("notification.send.count"),
    ).toEqual(DELTA_COUNTER);
    expect(options.isStepSettled!(new Date("2026-11-01T12:08:00.000Z"))).toBe(
      true,
    );
    expect(options.isStepSettled!(new Date("2026-11-01T12:09:00.000Z"))).toBe(
      false,
    );
  });

  test("and five minutes over twelve hours", () => {
    const options: MetricZeroFillOptions = MetricZeroFill.getOptions({
      metricTypes: [],
      window: {
        startDate: new Date("2026-11-01T00:10:30.000Z"),
        endDate: readAt,
      },
      readAt,
    });

    // 12:00 - 12:05 ended 5.5 minutes before the read; 12:05 - 12:10 30 seconds before.
    expect(options.isStepSettled!(new Date("2026-11-01T12:00:00.000Z"))).toBe(
      true,
    );
    expect(options.isStepSettled!(new Date("2026-11-01T12:05:00.000Z"))).toBe(
      false,
    );
  });

  test("a pinned interval wins over the window's", () => {
    const options: MetricZeroFillOptions = MetricZeroFill.getOptions({
      metricTypes: [],
      window: {
        startDate: new Date("2026-11-01T11:10:30.000Z"),
        endDate: readAt,
      },
      aggregationInterval: AggregationInterval.Total,
      readAt,
    });

    expect(options.isStepSettled!(new Date("2026-11-01T11:10:30.000Z"))).toBe(
      false,
    );
  });

  test("with no window to read, no step is settled", () => {
    const options: MetricZeroFillOptions = MetricZeroFill.getOptions({
      metricTypes: [],
      window: {
        startDate: undefined as unknown as Date,
        endDate: undefined as unknown as Date,
      },
      readAt,
    });

    expect(options.isStepSettled!(new Date("2026-11-01T12:00:00.000Z"))).toBe(
      false,
    );
  });
});
