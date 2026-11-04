import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MetricSeriesArrival from "Common/Types/Monitor/MetricMonitor/MetricSeriesArrival";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import MetricSeriesFingerprint from "Common/Utils/Metrics/MetricSeriesFingerprint";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * When a metric monitor's series got their data (#4912's follow-up): when
 * the worker reads it, and how it lays it beside each query and formula.
 * MetricService is replaced; every time is fixed.
 */

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { readSeriesArrivals: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

// MetricMonitorCriteria's import chain reaches the native isolated-vm addon.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";
import {
  QueryArrivals,
  getSlotArrivals,
  isReadBehind,
  readQueryArrivals,
  stepJudgesFreshness,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MetricSeriesArrivals";

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

const readSeriesArrivals: jest.Mock =
  MetricService.readSeriesArrivals as unknown as jest.Mock;

/*
 * A 15-minute window ending at 12:15:30 on a day long past: arrivals are
 * measured to the window's end - never later than now.
 */
const END_MS: number = Date.UTC(2026, 9, 16, 12, 15, 30);
const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date(END_MS - 15 * MINUTE),
  new Date(END_MS),
);

const POD_KEY: string = "resource.k8s.pod.name";
const projectId: ObjectID = ObjectID.generate();

// One row a minute bucket per pod, the newest at `newestMinutesBack` before the end.
function buckets(
  pods: Record<string, number>,
  grouped: boolean = true,
): AggregatedResult {
  const data: Array<AggregateModel> = [];

  for (const [pod, newestMinutesBack] of Object.entries(pods)) {
    for (let back: number = newestMinutesBack; back <= 14; back++) {
      data.push({
        timestamp: new Date(
          Math.floor((END_MS - back * MINUTE) / MINUTE) * MINUTE,
        ),
        value: 1,
        ...(grouped ? { attributes: { [POD_KEY]: pod } } : {}),
      });
    }
  }

  return { data };
}

function stepWith(filters: Array<CriteriaFilter>): MonitorStep {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = { ...instance.data!, filters: filters };
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [instance] };
  return new MonitorStep().setMonitorCriteria(criteria);
}

function metricFilter(input: {
  filterType?: FilterType;
  aggregation?: EvaluateOverTimeType;
  checkOn?: CheckOn;
}): CriteriaFilter {
  return {
    checkOn: input.checkOn ?? CheckOn.MetricValue,
    filterType: input.filterType ?? FilterType.GreaterThan,
    value: 0,
    metricMonitorOptions: {
      metricAlias: "a",
      metricAggregationType: input.aggregation ?? EvaluateOverTimeType.Average,
    },
  } as CriteriaFilter;
}

beforeEach(() => {
  readSeriesArrivals.mockReset();
  (logger.error as unknown as jest.Mock).mockClear();
});

describe("stepJudgesFreshness: a step reads its arrivals when a criteria judges fresh data", () => {
  test("All Values, or a forecast, among any criteria's filters", () => {
    expect(
      stepJudgesFreshness(
        stepWith([
          metricFilter({}),
          metricFilter({ aggregation: EvaluateOverTimeType.AllValues }),
        ]),
      ),
    ).toBe(true);
    expect(
      stepJudgesFreshness(
        stepWith([metricFilter({ filterType: FilterType.ForecastAbove })]),
      ),
    ).toBe(true);
  });

  test("not the measures of data that arrived, nor filters on something else", () => {
    expect(
      stepJudgesFreshness(
        stepWith([
          metricFilter({ aggregation: EvaluateOverTimeType.Average }),
          metricFilter({ aggregation: EvaluateOverTimeType.MaximumValue }),
          metricFilter({ aggregation: EvaluateOverTimeType.AnyValue }),
          metricFilter({ filterType: FilterType.IsEmpty }),
        ]),
      ),
    ).toBe(false);
    expect(
      stepJudgesFreshness(
        stepWith([
          metricFilter({
            aggregation: EvaluateOverTimeType.AllValues,
            checkOn: CheckOn.IsOnline,
          }),
        ]),
      ),
    ).toBe(false);
  });

  test("a step without criteria, or with the default one, reads none", () => {
    expect(stepJudgesFreshness(new MonitorStep())).toBe(false);

    const bare: MonitorStep = new MonitorStep();
    (bare.data as unknown as { monitorCriteria: unknown }).monitorCriteria =
      undefined;
    expect(stepJudgesFreshness(bare)).toBe(false);
  });
});

describe("isReadBehind: a series whose newest data point ended more than one data point before the end", () => {
  test("every series within a data point of the end: not behind", () => {
    expect(
      isReadBehind({
        aggregatedResult: buckets({ "checkout-1": 0, "checkout-2": 1 }),
        groupByAttributeKeys: [POD_KEY],
        startAndEndDate: WINDOW,
      }),
    ).toBe(false);
  });

  test("one series two data points back is enough", () => {
    expect(
      isReadBehind({
        aggregatedResult: buckets({ "checkout-1": 0, "checkout-2": 2 }),
        groupByAttributeKeys: [POD_KEY],
        startAndEndDate: WINDOW,
      }),
    ).toBe(true);
  });

  test("the edge: a bucket ending exactly one data point before the end is not behind; a millisecond more is", () => {
    const endingAt: (bucketEndMs: number) => boolean = (
      bucketEndMs: number,
    ): boolean => {
      return isReadBehind({
        aggregatedResult: {
          data: [{ timestamp: new Date(bucketEndMs - MINUTE), value: 1 }],
        },
        groupByAttributeKeys: [],
        startAndEndDate: WINDOW,
      });
    };

    expect(endingAt(END_MS - MINUTE)).toBe(false);
    expect(endingAt(END_MS - MINUTE - 1)).toBe(true);
  });

  test("an ungrouped query is one series: its newest data point decides", () => {
    expect(
      isReadBehind({
        aggregatedResult: buckets({ a: 0, b: 6 }, false),
        groupByAttributeKeys: [],
        startAndEndDate: WINDOW,
      }),
    ).toBe(false);
    expect(
      isReadBehind({
        aggregatedResult: buckets({ a: 6 }, false),
        groupByAttributeKeys: [],
        startAndEndDate: WINDOW,
      }),
    ).toBe(true);
  });

  test("a longer window's wider data points: five minutes behind on a 6-hour window is within one", () => {
    const sixHours: InBetween<Date> = new InBetween<Date>(
      new Date(END_MS - 6 * 60 * MINUTE),
      new Date(END_MS),
    );
    const fiveMinuteBucketMs: number =
      Math.floor((END_MS - 5 * MINUTE) / (5 * MINUTE)) * 5 * MINUTE;

    expect(
      isReadBehind({
        aggregatedResult: {
          data: [{ timestamp: new Date(fiveMinuteBucketMs), value: 1 }],
        },
        groupByAttributeKeys: [],
        startAndEndDate: sixHours,
      }),
    ).toBe(false);
  });

  test("nothing read, an unreadable window or unreadable times: not behind", () => {
    expect(
      isReadBehind({
        aggregatedResult: { data: [] },
        groupByAttributeKeys: [],
        startAndEndDate: WINDOW,
      }),
    ).toBe(false);
    expect(
      isReadBehind({
        aggregatedResult: buckets({ a: 6 }, false),
        groupByAttributeKeys: [],
        startAndEndDate: new InBetween<Date>(
          new Date(END_MS),
          new Date(END_MS - MINUTE),
        ),
      }),
    ).toBe(false);
    expect(
      isReadBehind({
        aggregatedResult: {
          data: [{ timestamp: new Date(Number.NaN), value: 1 }],
        },
        groupByAttributeKeys: [],
        startAndEndDate: WINDOW,
      }),
    ).toBe(false);
  });
});

describe("readQueryArrivals: read only when it can change a verdict", () => {
  const behind: AggregatedResult = buckets({
    "checkout-1": 0,
    "checkout-2": 6,
  });

  function arrivalRow(input: {
    pod?: string;
    newestArrivalMs: number;
  }): unknown {
    return {
      attributes: input.pod ? { [POD_KEY]: input.pod } : {},
      aggregates: {
        newestArrivalMs: input.newestArrivalMs,
        oldestArrivalMs: input.newestArrivalMs - 14 * MINUTE,
        arrivalMinuteCount: 15,
        newestPointArrivalMs: input.newestArrivalMs,
        newestPointTimeMs: input.newestArrivalMs - 3 * MINUTE,
      },
    };
  }

  test("a step that judges no freshness reads nothing", async () => {
    expect(
      await readQueryArrivals({
        query: { projectId, name: "k8s.pod.cpu.utilization", time: WINDOW },
        groupByAttributeKeys: [POD_KEY],
        aggregatedResult: behind,
        startAndEndDate: WINDOW,
        judgesFreshness: false,
        projectId,
      }),
    ).toBeNull();
    expect(readSeriesArrivals).not.toHaveBeenCalled();
  });

  test("a read that keeps up, or that read nothing, reads nothing", async () => {
    for (const aggregatedResult of [
      buckets({ "checkout-1": 0, "checkout-2": 1 }),
      { data: [] },
    ]) {
      expect(
        await readQueryArrivals({
          query: { projectId, name: "k8s.pod.cpu.utilization", time: WINDOW },
          groupByAttributeKeys: [POD_KEY],
          aggregatedResult,
          startAndEndDate: WINDOW,
          judgesFreshness: true,
          projectId,
        }),
      ).toBeNull();
    }
    expect(readSeriesArrivals).not.toHaveBeenCalled();
  });

  test("an incident, alert or maintenance metric lives in a table of its own: nothing to read", async () => {
    expect(
      await readQueryArrivals({
        query: {
          projectId,
          name: "oneuptime.incident.time_to_acknowledge",
          time: WINDOW,
        },
        groupByAttributeKeys: [],
        aggregatedResult: buckets({ a: 6 }, false),
        startAndEndDate: WINDOW,
        judgesFreshness: true,
        projectId,
      }),
    ).toBeNull();
    expect(readSeriesArrivals).not.toHaveBeenCalled();
  });

  test("a grouped read behind: each series' arrival by its fingerprint, measured to the window's end", async () => {
    readSeriesArrivals.mockResolvedValue([
      arrivalRow({ pod: "checkout-1", newestArrivalMs: END_MS - 10 * SECOND }),
      arrivalRow({ pod: "checkout-2", newestArrivalMs: END_MS - 6 * MINUTE }),
    ]);

    const arrivals: QueryArrivals | null = await readQueryArrivals({
      query: {
        projectId,
        name: "k8s.pod.cpu.utilization",
        time: WINDOW,
        attributes: { "resource.k8s.cluster.name": "prod" },
      },
      groupByAttributeKeys: [POD_KEY],
      aggregatedResult: behind,
      startAndEndDate: WINDOW,
      judgesFreshness: true,
      projectId,
    });

    expect(readSeriesArrivals).toHaveBeenCalledTimes(1);
    expect(readSeriesArrivals.mock.calls[0]![0]).toEqual({
      query: {
        projectId,
        name: "k8s.pod.cpu.utilization",
        time: WINDOW,
        attributes: { "resource.k8s.cluster.name": "prod" },
      },
      groupByAttributeKeys: [POD_KEY],
      limit: 50000,
      props: { isRoot: true },
    });

    expect(arrivals!.whole).toBeNull();
    expect(arrivals!.bySeries.size).toBe(2);

    const first: MetricSeriesArrival = arrivals!.bySeries.get(
      MetricSeriesFingerprint.computeFingerprint({ [POD_KEY]: "checkout-1" }),
    )!;
    const second: MetricSeriesArrival = arrivals!.bySeries.get(
      MetricSeriesFingerprint.computeFingerprint({ [POD_KEY]: "checkout-2" }),
    )!;

    expect(first.lagMs).toBe(3 * MINUTE);
    expect(first.sinceNewestArrivalMs).toBe(10 * SECOND);
    expect(second.sinceNewestArrivalMs).toBe(6 * MINUTE);
  });

  /*
   * While OneUptime's ingest queue is behind, the window ends where the
   * queue is (ReceivingCoverage): rows written since - still being worked
   * through - must not make a series look stopped, nor the backlog itself.
   */
  test("an ingest backlog: what arrived after the window's end counts as arrived at it, never as a series' silence", async () => {
    readSeriesArrivals.mockResolvedValue([
      arrivalRow({ pod: "checkout-1", newestArrivalMs: END_MS + 2 * MINUTE }),
      arrivalRow({ pod: "checkout-2", newestArrivalMs: END_MS - 30 * SECOND }),
    ]);

    const arrivals: QueryArrivals | null = await readQueryArrivals({
      query: { projectId, name: "k8s.pod.cpu.utilization", time: WINDOW },
      groupByAttributeKeys: [POD_KEY],
      aggregatedResult: behind,
      startAndEndDate: WINDOW,
      judgesFreshness: true,
      projectId,
    });

    expect(
      arrivals!.bySeries.get(
        MetricSeriesFingerprint.computeFingerprint({ [POD_KEY]: "checkout-1" }),
      )!.sinceNewestArrivalMs,
    ).toBe(0);
    expect(
      arrivals!.bySeries.get(
        MetricSeriesFingerprint.computeFingerprint({ [POD_KEY]: "checkout-2" }),
      )!.sinceNewestArrivalMs,
    ).toBe(30 * SECOND);
  });

  test("an ungrouped read's one row is the query's whole arrival", async () => {
    readSeriesArrivals.mockResolvedValue([
      arrivalRow({ newestArrivalMs: END_MS - 20 * SECOND }),
    ]);

    const arrivals: QueryArrivals | null = await readQueryArrivals({
      query: { projectId, name: "queue.depth", time: WINDOW },
      groupByAttributeKeys: [],
      aggregatedResult: buckets({ a: 6 }, false),
      startAndEndDate: WINDOW,
      judgesFreshness: true,
      projectId,
    });

    expect(readSeriesArrivals.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ groupByAttributeKeys: undefined }),
    );
    expect(arrivals!.whole).toEqual(
      expect.objectContaining({
        lagMs: 3 * MINUTE,
        sinceNewestArrivalMs: 20 * SECOND,
      }),
    );
    expect(arrivals!.bySeries.size).toBe(0);
  });

  test("a row without a usable time is left out", async () => {
    readSeriesArrivals.mockResolvedValue([
      arrivalRow({ pod: "checkout-1", newestArrivalMs: Number.NaN }),
    ]);

    const arrivals: QueryArrivals | null = await readQueryArrivals({
      query: { projectId, name: "k8s.pod.cpu.utilization", time: WINDOW },
      groupByAttributeKeys: [POD_KEY],
      aggregatedResult: behind,
      startAndEndDate: WINDOW,
      judgesFreshness: true,
      projectId,
    });

    expect(arrivals).toEqual({ whole: null, bySeries: new Map() });
  });

  test("a read that fails is logged, and leaves the series to be judged as before", async () => {
    readSeriesArrivals.mockRejectedValue(new Error("Timeout exceeded"));

    expect(
      await readQueryArrivals({
        query: { projectId, name: "k8s.pod.cpu.utilization", time: WINDOW },
        groupByAttributeKeys: [POD_KEY],
        aggregatedResult: behind,
        startAndEndDate: WINDOW,
        judgesFreshness: true,
        projectId,
      }),
    ).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      "Could not read when the metric monitor's data arrived; its series are judged by their data points' times alone.",
      { service: "workers", projectId: projectId.toString() },
    );
  });
});

describe("getSlotArrivals: a series' arrivals beside each query and formula", () => {
  function query(variable: string): MetricQueryConfigData {
    return {
      metricAliasData: {
        metricVariable: variable,
        title: undefined,
        description: undefined,
        legend: undefined,
        legendUnit: undefined,
      },
      metricQueryData: {
        filterData: {
          metricName: `metric.${variable}`,
          attributes: {},
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    } as MetricQueryConfigData;
  }

  function formula(variable: string, text: string): MetricFormulaConfigData {
    return {
      metricAliasData: {
        metricVariable: variable,
        title: undefined,
        description: undefined,
        legend: undefined,
        legendUnit: undefined,
      },
      metricFormulaData: { metricFormula: text },
    } as MetricFormulaConfigData;
  }

  const FRESH: MetricSeriesArrival = {
    sinceNewestArrivalMs: 10 * SECOND,
    lagMs: 20 * SECOND,
    arrivalIntervalMs: MINUTE,
  };
  const STOPPED: MetricSeriesArrival = {
    sinceNewestArrivalMs: 9 * MINUTE,
    lagMs: 4 * MINUTE,
    arrivalIntervalMs: null,
  };

  const FINGERPRINT: string = MetricSeriesFingerprint.computeFingerprint({
    [POD_KEY]: "checkout-1",
  });

  function grouped(arrival: MetricSeriesArrival): QueryArrivals {
    return { whole: null, bySeries: new Map([[FINGERPRINT, arrival]]) };
  }

  test("a query's own, then each formula's from the queries it reads", () => {
    expect(
      getSlotArrivals({
        perQueryArrivals: [grouped(FRESH), grouped(STOPPED)],
        queryConfigs: [query("a"), query("b")],
        formulaConfigs: [formula("c", "a / b * 100"), formula("d", "a * 2")],
        fingerprint: FINGERPRINT,
      }),
    ).toEqual([
      FRESH,
      STOPPED,
      {
        sinceNewestArrivalMs: 9 * MINUTE,
        lagMs: 4 * MINUTE,
        arrivalIntervalMs: MINUTE,
      },
      FRESH,
    ]);
  });

  test("a formula of a formula, with $-prefixed and upper-case names", () => {
    expect(
      getSlotArrivals({
        perQueryArrivals: [grouped(FRESH), grouped(STOPPED)],
        queryConfigs: [query("A"), query("b")],
        formulaConfigs: [formula("c", "$a + 1"), formula("d", "c + b")],
        fingerprint: FINGERPRINT,
      })?.slice(2),
    ).toEqual([
      FRESH,
      {
        sinceNewestArrivalMs: 9 * MINUTE,
        lagMs: 4 * MINUTE,
        arrivalIntervalMs: MINUTE,
      },
    ]);
  });

  test("a query whose arrivals were not read has none, and a formula reads the rest", () => {
    expect(
      getSlotArrivals({
        perQueryArrivals: [null, grouped(STOPPED)],
        queryConfigs: [query("a"), query("b")],
        formulaConfigs: [formula("c", "a + b"), formula("d", "a * 2")],
        fingerprint: FINGERPRINT,
      }),
    ).toEqual([null, STOPPED, STOPPED, null]);
  });

  test("an ungrouped monitor's one series is the queries' whole arrivals", () => {
    expect(
      getSlotArrivals({
        perQueryArrivals: [{ whole: FRESH, bySeries: new Map() }],
        queryConfigs: [query("a")],
        formulaConfigs: undefined,
      }),
    ).toEqual([FRESH]);
  });

  test("another series, or nothing read at all: no arrivals", () => {
    expect(
      getSlotArrivals({
        perQueryArrivals: [grouped(FRESH)],
        queryConfigs: [query("a")],
        formulaConfigs: [],
        fingerprint: "another",
      }),
    ).toBeUndefined();
    expect(
      getSlotArrivals({
        perQueryArrivals: [null, null],
        queryConfigs: [query("a"), query("b")],
        formulaConfigs: [],
      }),
    ).toBeUndefined();
    expect(
      getSlotArrivals({
        perQueryArrivals: undefined,
        queryConfigs: [query("a")],
        formulaConfigs: [],
      }),
    ).toBeUndefined();
  });

  test("a formula that cannot be read has none", () => {
    expect(
      getSlotArrivals({
        perQueryArrivals: [grouped(FRESH)],
        queryConfigs: [query("a")],
        formulaConfigs: [formula("b", "a +* (")],
        fingerprint: FINGERPRINT,
      }),
    ).toEqual([FRESH, null]);
  });
});
