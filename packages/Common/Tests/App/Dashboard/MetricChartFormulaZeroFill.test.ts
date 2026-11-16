import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A CHART'S FAILURE SHARE DRAWS 0% WHERE NOTHING FAILED (#6761).
 *
 * The explorer, a dashboard's chart, value, gauge and table widgets and a
 * monitor's charts all read metrics through MetricUtil.fetchResults, which
 * evaluates their formulas. These run it with the store replaced: a
 * failure share `$b / $a * 100` over two Sum queries of a delta counter,
 * whose failures query has a point only in the minute something failed.
 * The metric types say what the metric is - on the dashboard's own page
 * from the catalog, on a public dashboard from its /metric-types route - so
 * both draw the same 0% in the minutes nothing failed, and neither draws a
 * 0 in a minute still being counted, nor for a gauge.
 */

const mockAnalyticsAggregate: MockFunction = getJestMockFunction();
const mockModelGetList: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return mockAnalyticsAggregate(...args);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return mockModelGetList(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import MetricUtil from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import { AggregationTemporality } from "../../../Models/AnalyticsModels/Metric";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import { MetricZeroFillOptions } from "../../../Utils/Metrics/MetricZeroFill";

const MINUTE: number = 60_000;
const SENT: string = "notification.send.count";
const DASHBOARD_ID: string = "d4d4d4d4-1111-4111-8111-d4d4d4d4d4d4";

// Minute buckets of a morning long past: 09:00 to 09:05.
const BASE_MS: number = Date.UTC(2026, 10, 1, 9, 0, 0);

function at(minute: number): Date {
  return new Date(BASE_MS + minute * MINUTE);
}

const PAST_WINDOW: InBetween<Date> = new InBetween<Date>(at(0), at(6));

function query(variable: string, failures: boolean): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: failures ? "Failed" : "Sent",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: SENT,
        attributes: failures ? { outcome: "failure" } : {},
        aggegationType: MetricsAggregationType.Sum,
        aggregateBy: {},
      },
    },
  } as unknown as MetricQueryConfigData;
}

function viewData(startAndEndDate: InBetween<Date>): MetricViewData {
  return {
    startAndEndDate,
    queryConfigs: [query("a", false), query("b", true)],
    formulaConfigs: [
      {
        metricAliasData: {
          metricVariable: "c",
          title: "Failure share",
          description: "",
          legend: "",
          legendUnit: "%",
        },
        metricFormulaData: { metricFormula: "$b / $a * 100" },
      },
    ],
  };
}

/*
 * What the store answers: 100 sent in every minute of the window asked, and
 * 2 failures in its second minute only.
 */
function storeAnswer(aggregateBy: JSONObject): AggregatedResult {
  const queryArgs: JSONObject = aggregateBy["query"] as JSONObject;
  const attributes: JSONObject =
    (queryArgs["attributes"] as JSONObject | undefined) || {};
  const startMs: number = new Date(
    aggregateBy["startTimestamp"] as Date,
  ).getTime();
  const endMs: number = new Date(aggregateBy["endTimestamp"] as Date).getTime();

  const data: Array<AggregatedModel> = [];

  for (
    let bucketMs: number = Math.floor(startMs / MINUTE) * MINUTE;
    bucketMs <= endMs;
    bucketMs += MINUTE
  ) {
    const minute: number = Math.round((bucketMs - startMs) / MINUTE);

    if (attributes["outcome"] === "failure") {
      if (minute === 1) {
        data.push({ timestamp: new Date(bucketMs), value: 2 });
      }
      continue;
    }

    data.push({ timestamp: new Date(bucketMs), value: 100 });
  }

  return { data };
}

function metricType(semantics: {
  isMonotonic?: boolean | undefined;
  aggregationTemporality?: AggregationTemporality | undefined;
}): MetricType {
  const type: MetricType = new MetricType();
  type.name = SENT;
  type.unit = "1";
  if (semantics.isMonotonic !== undefined) {
    type.isMonotonic = semantics.isMonotonic;
  }
  if (semantics.aggregationTemporality !== undefined) {
    type.aggregationTemporality = semantics.aggregationTemporality;
  }
  return type;
}

const DELTA_COUNTER: MetricType = metricType({
  isMonotonic: true,
  aggregationTemporality: AggregationTemporality.Delta,
});
const GAUGE: MetricType = metricType({});

// The formula's points, minute by minute from the window's start.
function shareOf(
  results: Array<AggregatedResult>,
  startAndEndDate: InBetween<Date>,
): Array<[number, number]> {
  const startMs: number = (startAndEndDate.startValue as Date).getTime();

  return results[2]!.data.map((row: AggregatedModel): [number, number] => {
    return [
      Math.round((new Date(row.timestamp).getTime() - startMs) / MINUTE),
      row.value,
    ];
  });
}

beforeEach(() => {
  mockAnalyticsAggregate.mockReset();
  mockAnalyticsAggregate.mockImplementation(
    async (input: unknown): Promise<AggregatedResult> => {
      return storeAnswer(
        (input as { aggregateBy: JSONObject }).aggregateBy as JSONObject,
      );
    },
  );
  mockModelGetList.mockReset();
  mockModelGetList.mockResolvedValue({
    data: [DELTA_COUNTER],
    count: 1,
    skip: 0,
    limit: 1,
  });
});

afterEach(() => {
  setPublicDashboardContext(null);
  jest.restoreAllMocks();
});

describe("A chart's failure share", () => {
  test("draws 0% in every minute nothing failed, from the catalog the chart loads", async () => {
    const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
      metricViewData: viewData(PAST_WINDOW),
      refreshNonce: "catalog",
    });

    expect(shareOf(results, PAST_WINDOW)).toEqual([
      [0, 0],
      [1, 2],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
      [6, 0],
    ]);

    // The catalog was read with the counter semantics.
    const select: JSONObject = (
      mockModelGetList.mock.calls[0]![0] as { select: JSONObject }
    ).select;
    expect(select["isMonotonic"]).toBe(true);
    expect(select["aggregationTemporality"]).toBe(true);
  });

  test("keeps its gaps for a metric the given metric types call a gauge", async () => {
    const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
      metricViewData: viewData(PAST_WINDOW),
      metricTypes: [GAUGE],
      refreshNonce: "gauge",
    });

    expect(shareOf(results, PAST_WINDOW)).toEqual([[1, 2]]);
  });

  test("keeps its gaps when no metric type says what the metric is", async () => {
    const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
      metricViewData: viewData(PAST_WINDOW),
      metricTypes: [],
      refreshNonce: "none",
    });

    expect(shareOf(results, PAST_WINDOW)).toEqual([[1, 2]]);
  });

  test("draws no 0 in the minutes still being counted, read up to now", async () => {
    // Read at 09:06:30: 09:05 ended 90 seconds before, 09:06 is running.
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date(BASE_MS + 6 * MINUTE + 30_000));

    const liveWindow: InBetween<Date> = new InBetween<Date>(
      at(0),
      new Date(BASE_MS + 6 * MINUTE + 30_000),
    );

    const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
      metricViewData: viewData(liveWindow),
      metricTypes: [DELTA_COUNTER],
      refreshNonce: "live",
    });

    expect(shareOf(results, liveWindow)).toEqual([
      [0, 0],
      [1, 2],
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
  });
});

describe("MetricUtil.getFormulaZeroFill", () => {
  test("reads the steps the aggregate API cuts, or the pinned interval's", () => {
    const readAt: Date = new Date(BASE_MS + 6 * MINUTE + 30_000);

    const minutes: MetricZeroFillOptions = MetricUtil.getFormulaZeroFill({
      metricTypes: [DELTA_COUNTER],
      startAndEndDate: new InBetween<Date>(at(0), readAt),
      readAt,
    })!;

    expect(minutes.semanticsByMetricName.get(SENT)).toEqual({
      isMonotonic: true,
      aggregationTemporality: AggregationTemporality.Delta,
    });
    expect(minutes.isStepSettled!(at(4))).toBe(true);
    expect(minutes.isStepSettled!(at(5))).toBe(false);

    const hours: MetricZeroFillOptions = MetricUtil.getFormulaZeroFill({
      metricTypes: [DELTA_COUNTER],
      startAndEndDate: new InBetween<Date>(at(0), readAt),
      aggregationInterval: AggregationInterval.Hour,
      readAt,
    })!;

    // The hour from 09:00 is still running at 09:06.
    expect(hours.isStepSettled!(at(0))).toBe(false);
  });

  test("with no window, nothing is filled", () => {
    expect(
      MetricUtil.getFormulaZeroFill({
        metricTypes: [DELTA_COUNTER],
        startAndEndDate: null,
      }),
    ).toBeUndefined();
  });
});

describe("A public dashboard's failure share", () => {
  /*
   * The public dashboard's API client, answered as its routes answer:
   * /metric-types with what the route lists, /metrics-aggregate from the
   * store.
   */
  function publicContext(
    publicMetricTypes: Array<JSONObject>,
  ): PublicDashboardContext {
    return {
      dashboardId: new ObjectID(DASHBOARD_ID),
      apiUrl: URL.fromString("http://localhost/public-dashboard-api"),
      postJSON: async (
        route: string,
        data: JSONObject,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        if (route === `/metric-types/${DASHBOARD_ID}`) {
          return new HTTPResponse<JSONObject>(
            200,
            { metricTypes: publicMetricTypes },
            {},
          );
        }

        expect(route).toBe(`/metrics-aggregate/${DASHBOARD_ID}`);

        return new HTTPResponse<JSONObject>(
          200,
          storeAnswer(
            JSONFunctions.deserialize(
              data["aggregateBy"] as JSONObject,
            ) as JSONObject,
          ) as unknown as JSONObject,
          {},
        );
      },
      apiClient: {} as PublicDashboardContext["apiClient"],
    };
  }

  test("draws what the dashboard's own page draws: 0% where nothing failed", async () => {
    setPublicDashboardContext(
      publicContext([
        {
          name: SENT,
          unit: "1",
          isMonotonic: true,
          aggregationTemporality: AggregationTemporality.Delta,
        },
      ]),
    );

    const publicResults: Array<AggregatedResult> =
      await MetricUtil.fetchResults({
        metricViewData: viewData(PAST_WINDOW),
        refreshNonce: "public",
      });

    setPublicDashboardContext(null);

    const privateResults: Array<AggregatedResult> =
      await MetricUtil.fetchResults({
        metricViewData: viewData(PAST_WINDOW),
        refreshNonce: "private",
      });

    expect(shareOf(publicResults, PAST_WINDOW)).toEqual(
      shareOf(privateResults, PAST_WINDOW),
    );
    expect(shareOf(publicResults, PAST_WINDOW)).toContainEqual([2, 0]);
  });

  test("an older server that lists no counter semantics keeps the gaps, and nothing breaks", async () => {
    setPublicDashboardContext(publicContext([{ name: SENT, unit: "1" }]));

    const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
      metricViewData: viewData(PAST_WINDOW),
      refreshNonce: "older-server",
    });

    expect(shareOf(results, PAST_WINDOW)).toEqual([[1, 2]]);
  });

  test("a temporality the dashboard does not know is not one", async () => {
    setPublicDashboardContext(
      publicContext([
        {
          name: SENT,
          unit: "1",
          isMonotonic: "yes",
          aggregationTemporality: "Sometimes",
        },
      ]),
    );

    const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
      metricViewData: viewData(PAST_WINDOW),
      refreshNonce: "unknown-temporality",
    });

    expect(shareOf(results, PAST_WINDOW)).toEqual([[1, 2]]);
  });
});
