/*
 * The baseline lookup is the only thing standing between this test and
 * ClickHouse. Stub it so these assertions are about what the criteria asks it
 * for, and what it does with the answer.
 */
jest.mock("../../../../../Server/Services/MetricBaselineService", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../Server/Services/MetricBaselineService",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getBaseline: jest.fn(),
    },
  };
});

import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "../../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import MetricBaselineService, {
  BaselineSummary,
  MetricBaselineService as MetricBaselineServiceClass,
} from "../../../../../Server/Services/MetricBaselineService";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import { MetricAnomalyBaseline } from "../../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MetricQueryConfigData from "../../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../../Types/Metrics/MetricQueryData";
import MetricsAggregationType from "../../../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../../../Types/Metrics/MetricsViewConfig";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import AggregationInterval from "../../../../../Types/BaseDatabase/AggregationInterval";
import ObjectID from "../../../../../Types/ObjectID";
import RollingTime from "../../../../../Types/RollingTime/RollingTime";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT A METRIC'S ANOMALY CONDITION ASKS THE BASELINE FOR.
 *
 * The hour being judged used to be part of what it was judged against, and
 * the arithmetic of that is in MetricHourBaseline.test.ts. Here: that each
 * hour of a window is held to the days before it, which is not today for an
 * hour that ended at midnight; that a grouped monitor reads a cell once; and
 * what is said of a metric that left the one value it held.
 */

const METRIC_NAME: string = "queue.depth";

function baseline(data: Partial<BaselineSummary> = {}): BaselineSummary {
  return {
    sampleCount: 240,
    mean: 100,
    stddev: 10,
    median: 100,
    p95: 120,
    minObserved: 70,
    maxObserved: 130,
    isReliable: true,
    windowDays: 14,
    hourOfWeek: 0,
    ...data,
  };
}

function pointsOf(
  points: Array<{ time: string; value: number }>,
): Array<AggregateModel> {
  return points.map(
    (point: { time: string; value: number }): AggregateModel => {
      return { timestamp: new Date(point.time), value: point.value };
    },
  );
}

function buildInputs(input: {
  points?: Array<AggregateModel>;
  series?: Array<MetricSeriesResult>;
  filterType?: FilterType;
  aggregationType?: MetricsAggregationType;
  attributes?: Record<string, string>;
  groupByAttributeKeys?: Array<string>;
  telemetryServiceIds?: Array<ObjectID>;
  window?: { start: string; end: string };
}): {
  criteriaFilter: CriteriaFilter;
  monitorStep: MonitorStep;
  dataToProcess: MetricMonitorResponse;
} {
  const queryConfig: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "a",
      title: METRIC_NAME,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: METRIC_NAME,
        ...(input.aggregationType
          ? { aggegationType: input.aggregationType }
          : {}),
        ...(input.attributes ? { attributes: input.attributes } : {}),
      },
      ...(input.groupByAttributeKeys
        ? { groupByAttributeKeys: input.groupByAttributeKeys }
        : {}),
    } as unknown as MetricQueryData,
  };

  const metricViewConfig: MetricsViewConfig = {
    queryConfigs: [queryConfig],
    formulaConfigs: [],
  };

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: { data: undefined } as never,
  } as unknown as MonitorStep["data"];
  monitorStep.data!.metricMonitor = {
    metricViewConfig,
    rollingTime: RollingTime.Past5Minutes,
    ...(input.telemetryServiceIds
      ? { telemetryServiceIds: input.telemetryServiceIds }
      : {}),
  };

  return {
    criteriaFilter: {
      checkOn: CheckOn.MetricValue,
      filterType: input.filterType || FilterType.Anomalous,
      metricMonitorOptions: { metricAlias: "a" },
    } as CriteriaFilter,
    monitorStep,
    dataToProcess: {
      projectId: ObjectID.generate(),
      metricResult: [{ data: input.points || [] }],
      ...(input.series ? { seriesBreakdown: input.series } : {}),
      ...(input.window
        ? {
            startAndEndDate: {
              startValue: new Date(input.window.start),
              endValue: new Date(input.window.end),
            },
          }
        : {}),
      metricViewConfig,
      monitorId: ObjectID.generate(),
    } as unknown as MetricMonitorResponse,
  };
}

async function evaluate(input: Parameters<typeof buildInputs>[0]): Promise<{
  evaluations: Array<MetricSeriesEvaluationResult>;
  anomalyBaseline: MetricAnomalyBaseline | undefined;
  rootCause: string | null;
}> {
  const evaluations: Array<MetricSeriesEvaluationResult> =
    await MetricMonitorCriteria.evaluateAllSeries(buildInputs(input));

  return {
    evaluations,
    anomalyBaseline: evaluations[0]?.context.anomalyBaseline,
    rootCause: evaluations[0]?.rootCause ?? null,
  };
}

const getBaseline: jest.Mock = MetricBaselineService.getBaseline as never;

const askedFor: () => Array<{
  hourOfWeek: number;
  judgedAt: Date;
}> = (): Array<{ hourOfWeek: number; judgedAt: Date }> => {
  return getBaseline.mock.calls.map(
    (call: Array<unknown>): { hourOfWeek: number; judgedAt: Date } => {
      return call[0] as { hourOfWeek: number; judgedAt: Date };
    },
  );
};

const hourOf: (time: string) => number = (time: string): number => {
  return MetricBaselineServiceClass.computeHourOfWeek(new Date(time));
};

describe("MetricMonitorCriteria - what an anomaly condition asks the baseline for", () => {
  beforeEach(() => {
    getBaseline.mockReset();
    getBaseline.mockResolvedValue(baseline() as never);
  });

  describe("what the query reads", () => {
    const asked: () => Record<string, unknown> = (): Record<string, unknown> => {
      return getBaseline.mock.calls[0]![0] as Record<string, unknown>;
    };

    const onePoint: Array<AggregateModel> = pointsOf([
      { time: "2026-11-30T09:40:00.000Z", value: 100 },
    ]);

    /*
     * A service reads its own samples. Against the whole project's, its spread
     * is mostly the spread between services: a doubling of a small one stayed
     * inside it (MetricHourBaseline.test.ts).
     */
    test("the services a monitor names are the ones its baseline reads", async () => {
      const services: Array<ObjectID> = [
        ObjectID.generate(),
        ObjectID.generate(),
      ];

      await evaluate({ points: onePoint, telemetryServiceIds: services });

      expect(asked()["primaryEntityId"]).toEqual(services);
    });

    test("a monitor that names none reads them all", async () => {
      await evaluate({ points: onePoint });

      expect(asked()["primaryEntityId"]).toBeUndefined();
    });

    test("so does the empty list a monitor is created with", async () => {
      await evaluate({ points: onePoint, telemetryServiceIds: [] });

      expect(asked()["primaryEntityId"]).toEqual([]);
    });

    test("a query that names no aggregation is the average it reads", async () => {
      await evaluate({ points: onePoint });

      expect(asked()["query"]).toEqual({
        aggregationType: MetricsAggregationType.Avg,
        isNarrowedByAttributes: false,
        interval: AggregationInterval.Minute,
      });
    });

    test("it says what the query makes of the metric", async () => {
      await evaluate({
        points: onePoint,
        aggregationType: MetricsAggregationType.Sum,
      });

      expect(asked()["query"]).toMatchObject({
        aggregationType: MetricsAggregationType.Sum,
      });
    });

    test("an attribute filter narrows it", async () => {
      await evaluate({
        points: onePoint,
        attributes: { "resource.host.name": "web-1" },
      });

      expect(asked()["query"]).toMatchObject({ isNarrowedByAttributes: true });
    });

    test("a group by narrows it", async () => {
      await evaluate({
        points: onePoint,
        groupByAttributeKeys: ["resource.host.name"],
      });

      expect(asked()["query"]).toMatchObject({ isNarrowedByAttributes: true });
    });

    test.each([
      ["2026-11-30T08:40:00.000Z", AggregationInterval.Minute],
      ["2026-11-30T05:40:00.000Z", AggregationInterval.FiveMinutes],
      ["2026-11-29T09:40:00.000Z", AggregationInterval.FifteenMinutes],
    ])(
      "the window sets how long its data points are, from %s",
      async (start: string, interval: AggregationInterval) => {
        await evaluate({
          points: onePoint,
          window: { start, end: "2026-11-30T09:40:00.000Z" },
        });

        expect(asked()["query"]).toMatchObject({ interval });
      },
    );

    test("a query with no baseline is still learning, and fires on nothing", async () => {
      getBaseline.mockResolvedValue(null as never);

      const { rootCause, anomalyBaseline } = await evaluate({
        points: pointsOf([{ time: "2026-11-30T09:40:00.000Z", value: 900000 }]),
        aggregationType: MetricsAggregationType.Sum,
        attributes: { "resource.host.name": "web-1" },
      });

      expect(rootCause).toBeNull();
      expect(anomalyBaseline?.state).toBe("Learning");
    });
  });

  /*
   * A check at 09:40:05 of a five-minute window holds 09:35 from 09:35:05 on,
   * and 09:40 up to five seconds in. Summed, both read low whatever the metric
   * does, and 09:39 may still have data on the way.
   */
  describe("a total of a bucket not yet all there", () => {
    const window: { start: string; end: string } = {
      start: "2026-11-30T09:35:05.000Z",
      end: "2026-11-30T09:40:05.000Z",
    };

    const firesLow: (
      time: string,
      data?: {
        aggregationType?: MetricsAggregationType;
        filterType?: FilterType;
        value?: number;
      },
    ) => Promise<boolean> = async (
      time: string,
      data: {
        aggregationType?: MetricsAggregationType;
        filterType?: FilterType;
        value?: number;
      } = {},
    ): Promise<boolean> => {
      const { rootCause } = await evaluate({
        points: pointsOf([{ time, value: data.value ?? 1 }]),
        aggregationType: data.aggregationType ?? MetricsAggregationType.Sum,
        filterType: data.filterType ?? FilterType.AnomalouslyLow,
        window,
      });

      return rootCause !== null;
    };

    test.each([
      ["the first, which starts before the window", "2026-11-30T09:35:00.000Z"],
      ["the newest, still filling", "2026-11-30T09:40:00.000Z"],
      ["the one before it, with data on the way", "2026-11-30T09:39:00.000Z"],
    ])("%s is not judged low", async (_: string, time: string) => {
      expect(await firesLow(time)).toBe(false);
    });

    test.each([
      ["2026-11-30T09:36:00.000Z"],
      ["2026-11-30T09:37:00.000Z"],
      ["2026-11-30T09:38:00.000Z"],
    ])("a whole bucket with a whole one after it is: %s", async (time: string) => {
      expect(await firesLow(time)).toBe(true);
    });

    test("a Count is a total too", async () => {
      expect(
        await firesLow("2026-11-30T09:40:00.000Z", {
          aggregationType: MetricsAggregationType.Count,
        }),
      ).toBe(false);
      expect(
        await firesLow("2026-11-30T09:37:00.000Z", {
          aggregationType: MetricsAggregationType.Count,
        }),
      ).toBe(true);
    });

    test("Anomalous does not fire on it either", async () => {
      expect(
        await firesLow("2026-11-30T09:40:00.000Z", {
          filterType: FilterType.Anomalous,
        }),
      ).toBe(false);
    });

    test("all it can do is grow, so it can be judged high", async () => {
      expect(
        await firesLow("2026-11-30T09:40:00.000Z", {
          filterType: FilterType.AnomalouslyHigh,
          value: 5000,
        }),
      ).toBe(true);
    });

    test("an average is not a total: any bucket can read low", async () => {
      expect(
        await firesLow("2026-11-30T09:40:00.000Z", {
          aggregationType: MetricsAggregationType.Avg,
        }),
      ).toBe(true);
    });

    test("a longer data point is held to its own length", async () => {
      const { rootCause } = await evaluate({
        points: pointsOf([{ time: "2026-11-30T08:45:00.000Z", value: 1 }]),
        aggregationType: MetricsAggregationType.Sum,
        filterType: FilterType.AnomalouslyLow,
        window: {
          start: "2026-11-30T03:40:05.000Z",
          end: "2026-11-30T08:52:00.000Z",
        },
      });

      expect(rootCause).toBeNull();

      const whole: { rootCause: string | null } = await evaluate({
        points: pointsOf([{ time: "2026-11-30T08:40:00.000Z", value: 1 }]),
        aggregationType: MetricsAggregationType.Sum,
        filterType: FilterType.AnomalouslyLow,
        window: {
          start: "2026-11-30T03:40:05.000Z",
          end: "2026-11-30T08:52:00.000Z",
        },
      });

      expect(whole.rootCause).not.toBeNull();
    });
  });

  describe("the hour judged", () => {
    test("a window inside an hour reads that hour, from its first data point", async () => {
      await evaluate({
        points: pointsOf([
          { time: "2026-11-30T09:38:00.000Z", value: 100 },
          { time: "2026-11-30T09:39:00.000Z", value: 100 },
          { time: "2026-11-30T09:40:00.000Z", value: 100 },
        ]),
      });

      expect(askedFor()).toHaveLength(1);
      expect(askedFor()[0]).toMatchObject({
        projectId: expect.any(String),
        metricName: METRIC_NAME,
        hourOfWeek: hourOf("2026-11-30T09:38:00.000Z"),
        judgedAt: new Date("2026-11-30T09:38:00.000Z"),
      });
    });

    /*
     * At 00:01 a window still holds yesterday's last minutes, and that hour's
     * own day is not today: held to the days before today, it would be back in
     * its own baseline.
     */
    test("each hour of a window across midnight is held to the days before its own", async () => {
      await evaluate({
        points: pointsOf([
          { time: "2026-11-29T23:58:00.000Z", value: 100 },
          { time: "2026-11-29T23:59:00.000Z", value: 100 },
          { time: "2026-11-30T00:00:00.000Z", value: 100 },
          { time: "2026-11-30T00:01:00.000Z", value: 100 },
        ]),
      });

      expect(
        askedFor().map(
          (call: { hourOfWeek: number; judgedAt: Date }): [number, Date] => {
            return [call.hourOfWeek, call.judgedAt];
          },
        ),
      ).toEqual([
        [
          hourOf("2026-11-29T23:58:00.000Z"),
          new Date("2026-11-29T23:58:00.000Z"),
        ],
        [
          hourOf("2026-11-30T00:00:00.000Z"),
          new Date("2026-11-30T00:00:00.000Z"),
        ],
      ]);
    });

    /*
     * A window of weeks holds an hour of the week once a week, and each is
     * judged by the days before it. Read once for them all, from the earliest,
     * a window as long as the rollup keeps would never have a baseline.
     */
    test("a window of weeks judges each occurrence of an hour by the days before it", async () => {
      await evaluate({
        points: pointsOf([
          { time: "2026-11-16T09:00:00.000Z", value: 100 },
          { time: "2026-11-23T09:00:00.000Z", value: 100 },
          { time: "2026-11-30T09:00:00.000Z", value: 100 },
        ]),
      });

      expect(
        askedFor().map((call: { hourOfWeek: number; judgedAt: Date }): Date => {
          return call.judgedAt;
        }),
      ).toEqual([
        new Date("2026-11-16T09:00:00.000Z"),
        new Date("2026-11-23T09:00:00.000Z"),
        new Date("2026-11-30T09:00:00.000Z"),
      ]);
    });

    test("a data point older than the rollup reaches is left alone, and the newest is judged", async () => {
      getBaseline.mockImplementation((async (input: {
        judgedAt: Date;
      }): Promise<BaselineSummary | null> => {
        return input.judgedAt < new Date("2026-11-30T00:00:00.000Z")
          ? null
          : baseline();
      }) as never);

      const { rootCause } = await evaluate({
        points: pointsOf([
          { time: "2026-08-03T09:00:00.000Z", value: 500 },
          { time: "2026-11-30T09:00:00.000Z", value: 150 },
        ]),
      });

      expect(rootCause).toContain("value 150 is 5.00σ above");
    });

    test("data points in any order are held to the earliest of their hour", async () => {
      await evaluate({
        points: pointsOf([
          { time: "2026-11-30T09:40:00.000Z", value: 100 },
          { time: "2026-11-30T09:36:00.000Z", value: 100 },
          { time: "2026-11-30T09:38:00.000Z", value: 100 },
        ]),
      });

      expect(askedFor()[0]!.judgedAt).toEqual(
        new Date("2026-11-30T09:36:00.000Z"),
      );
    });
  });

  describe("a grouped monitor", () => {
    const seriesOf: (name: string, value: number) => MetricSeriesResult = (
      name: string,
      value: number,
    ): MetricSeriesResult => {
      return {
        fingerprint: name,
        labels: { "host.name": name },
        aggregatedResults: [
          {
            data: pointsOf([{ time: "2026-11-30T09:40:00.000Z", value }]),
          },
        ],
      } as unknown as MetricSeriesResult;
    };

    /*
     * Every series reads the same cell, and a read is two queries. A monitor
     * on two hundred hosts would otherwise ask ClickHouse eight hundred times
     * a minute around the top of every hour for the same four answers.
     */
    test("reads a cell once, whichever series asks", async () => {
      const { evaluations } = await evaluate({
        series: [
          seriesOf("a", 100),
          seriesOf("b", 500),
          seriesOf("c", 100),
          seriesOf("d", 500),
        ],
      });

      expect(getBaseline).toHaveBeenCalledTimes(1);
      expect(
        evaluations.map((evaluation: MetricSeriesEvaluationResult): boolean => {
          return evaluation.rootCause !== null;
        }),
      ).toEqual([false, true, false, true]);
    });

    test("reads it again on the next evaluation", async () => {
      await evaluate({ series: [seriesOf("a", 100)] });
      await evaluate({ series: [seriesOf("a", 100)] });

      expect(getBaseline).toHaveBeenCalledTimes(2);
    });

    test("a read that fails fails the check, as it did, rather than reading as normal", async () => {
      getBaseline.mockRejectedValue(new Error("ClickHouse went away") as never);

      await expect(
        evaluate({ series: [seriesOf("a", 100), seriesOf("b", 100)] }),
      ).rejects.toThrow("ClickHouse went away");
    });
  });

  describe("a baseline with a spread", () => {
    test("a data point outside it fires, and says by how much", async () => {
      const { rootCause, anomalyBaseline } = await evaluate({
        points: pointsOf([{ time: "2026-11-30T09:40:00.000Z", value: 150 }]),
      });

      expect(rootCause).toContain(
        "value 150 is 5.00σ above the same-hour baseline (mean 100, σ 10, 240 samples over 14 days, sensitivity Medium).",
      );
      expect(anomalyBaseline).toMatchObject({
        state: "Anomalous",
        expectedHigh: 130,
        expectedLow: 70,
        observedSigma: 5,
      });
    });

    test("a data point inside it does not", async () => {
      const { rootCause, anomalyBaseline } = await evaluate({
        points: pointsOf([{ time: "2026-11-30T09:40:00.000Z", value: 125 }]),
      });

      expect(rootCause).toBeNull();
      expect(anomalyBaseline?.state).toBe("Normal");
    });
  });

  describe("a metric that held one value", () => {
    test("is left alone while it stays there", async () => {
      getBaseline.mockResolvedValue(baseline({ stddev: 0 }) as never);

      const { rootCause, anomalyBaseline } = await evaluate({
        points: pointsOf([{ time: "2026-11-30T09:40:00.000Z", value: 100 }]),
      });

      expect(rootCause).toBeNull();
      expect(anomalyBaseline?.state).toBe("Normal");
    });

    /*
     * The samples never left the value, so what is compared is not on its
     * scale: a query's sum of ten flat series. It was never a change.
     */
    test("a sum of flat series is not read as a change", async () => {
      getBaseline.mockResolvedValue(baseline({ mean: 1, stddev: 0 }) as never);

      const { rootCause } = await evaluate({
        points: pointsOf([{ time: "2026-11-30T09:40:00.000Z", value: 10 }]),
      });

      expect(rootCause).toBeNull();
    });

    test.each([
      ["above", 101, FilterType.Anomalous],
      ["below", 99, FilterType.Anomalous],
      ["above", 101, FilterType.AnomalouslyHigh],
      ["below", 99, FilterType.AnomalouslyLow],
    ])(
      "fires once it has left, %s it, and says so in words",
      async (direction: string, value: number, filterType: FilterType) => {
        getBaseline.mockResolvedValue(
          baseline({ stddev: 0, leftFlatHistory: true }) as never,
        );

        const { rootCause, anomalyBaseline } = await evaluate({
          points: pointsOf([{ time: "2026-11-30T09:40:00.000Z", value }]),
          filterType,
        });

        expect(rootCause).toBe(
          `${METRIC_NAME} value ${value} is ${direction} the same-hour baseline, ` +
            "which held at 100 for all 240 samples over 14 days (sensitivity Medium).",
        );
        expect(anomalyBaseline).toMatchObject({
          state: "Anomalous",
          stddev: 0,
          observedValue: value,
        });
        // There is no count of standard deviations to give: there are none.
        expect(anomalyBaseline?.observedSigma).toBeUndefined();
      },
    );

    test("a condition on the other side does not fire", async () => {
      getBaseline.mockResolvedValue(
        baseline({ stddev: 0, leftFlatHistory: true }) as never,
      );

      const { rootCause } = await evaluate({
        points: pointsOf([{ time: "2026-11-30T09:40:00.000Z", value: 101 }]),
        filterType: FilterType.AnomalouslyLow,
      });

      expect(rootCause).toBeNull();
    });

    test("a data point back on the value does not fire, though others left it", async () => {
      getBaseline.mockResolvedValue(
        baseline({ stddev: 0, leftFlatHistory: true }) as never,
      );

      const { rootCause } = await evaluate({
        points: pointsOf([{ time: "2026-11-30T09:40:00.000Z", value: 100 }]),
      });

      expect(rootCause).toBeNull();
    });

    test("a history of zeros that moves fires", async () => {
      getBaseline.mockResolvedValue(
        baseline({ mean: 0, stddev: 0, leftFlatHistory: true }) as never,
      );

      const { rootCause } = await evaluate({
        points: pointsOf([{ time: "2026-11-30T09:40:00.000Z", value: 5 }]),
      });

      expect(rootCause).toContain("value 5 is above the same-hour baseline");
      expect(rootCause).toContain("which held at 0 for all 240 samples");
    });
  });

  describe("a baseline still learning", () => {
    test("is not judged by, and says so", async () => {
      getBaseline.mockResolvedValue(baseline({ isReliable: false }) as never);

      const { rootCause, anomalyBaseline } = await evaluate({
        points: pointsOf([{ time: "2026-11-30T09:40:00.000Z", value: 100000 }]),
      });

      expect(rootCause).toBeNull();
      expect(anomalyBaseline?.state).toBe("Learning");
    });

    test("nor is no baseline at all", async () => {
      getBaseline.mockResolvedValue(null as never);

      const { rootCause, anomalyBaseline } = await evaluate({
        points: pointsOf([{ time: "2026-11-30T09:40:00.000Z", value: 100000 }]),
      });

      expect(rootCause).toBeNull();
      expect(anomalyBaseline).toMatchObject({
        state: "Learning",
        hourOfWeek: hourOf("2026-11-30T09:40:00.000Z"),
      });
    });
  });
});
