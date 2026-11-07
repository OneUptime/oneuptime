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
 * Issue #6266: a metric query that names some telemetry services is read for
 * those services only - its rows' service among them, as a Metrics monitor
 * limited to them reads it - and so are the exemplar dots on its chart. A
 * query that names none is read exactly as before.
 *
 * MetricUtil is the production module; the analytics API, the metric
 * catalog and the project are stood in for.
 */

const aggregateMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
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
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";

const API: string = "11111111-1111-4111-8111-111111111111";
const CHECKOUT: string = "22222222-2222-4222-8222-222222222222";

let windowCount: number = 0;

// A window of its own per test: the module caches equal reads a few seconds.
function nextWindow(): InBetween<Date> {
  windowCount++;
  return new InBetween<Date>(
    new Date(Date.UTC(2026, 10, 7, 10, windowCount)),
    new Date(Date.UTC(2026, 10, 7, 11, windowCount)),
  );
}

const queryOf: (serviceIds?: Array<string>) => MetricQueryConfigData = (
  serviceIds?: Array<string>,
): MetricQueryConfigData => {
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
        metricName: "http.server.duration",
        aggegationType: MetricsAggregationType.Avg,
        attributes: { "http.route": "/pay" },
        ...(serviceIds ? { telemetryServiceIds: serviceIds } : {}),
      } as never,
    },
  };
};

// The query each aggregate read ran with.
function aggregateQueries(): Array<Record<string, unknown>> {
  return aggregateMock.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { aggregateBy: { query: Record<string, unknown> } })
      .aggregateBy.query;
  });
}

beforeEach(() => {
  aggregateMock.mockReset();
  aggregateMock.mockImplementation(() => {
    return Promise.resolve({ data: [] });
  });
  analyticsGetListMock.mockReset();
  analyticsGetListMock.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a chart's metric read", () => {
  test("a query that names services reads its rows for those services only", async () => {
    await MetricUtil.fetchResults({
      metricViewData: {
        startAndEndDate: nextWindow(),
        queryConfigs: [queryOf([API, CHECKOUT])],
        formulaConfigs: [],
      },
    });

    const [query] = aggregateQueries();
    expect(query!["primaryEntityId"]).toBeInstanceOf(Includes);
    expect((query!["primaryEntityId"] as Includes).values).toEqual([
      API,
      CHECKOUT,
    ]);
    // With its other filters, as before.
    expect(query!["name"]).toBe("http.server.duration");
    expect(query!["attributes"]).toEqual({ "http.route": "/pay" });
  });

  test("a query that names none reads every service, exactly as before", async () => {
    await MetricUtil.fetchResults({
      metricViewData: {
        startAndEndDate: nextWindow(),
        queryConfigs: [queryOf(), queryOf([])],
        formulaConfigs: [],
      },
    });

    /*
     * One read: the two are the very same request, so the module's
     * de-duplication coalesces them - an empty list is no filter at all.
     */
    const queries: Array<Record<string, unknown>> = aggregateQueries();
    expect(queries).toHaveLength(1);
    for (const query of queries) {
      expect(Object.keys(query)).not.toContain("primaryEntityId");
      expect(Object.keys(query).sort()).toEqual(
        ["attributes", "name", "projectId", "time"].sort(),
      );
    }
  });

  test("each query is read for its own services", async () => {
    await MetricUtil.fetchResults({
      metricViewData: {
        startAndEndDate: nextWindow(),
        queryConfigs: [
          queryOf([API]),
          {
            ...queryOf([CHECKOUT]),
            metricAliasData: {
              ...queryOf().metricAliasData!,
              metricVariable: "b",
            },
          },
          {
            ...queryOf(),
            metricAliasData: {
              ...queryOf().metricAliasData!,
              metricVariable: "c",
            },
          },
        ],
        formulaConfigs: [],
      },
    });

    const services: Array<unknown> = aggregateQueries().map(
      (query: Record<string, unknown>): unknown => {
        return (query["primaryEntityId"] as Includes | undefined)?.values;
      },
    );
    expect(services).toEqual([[API], [CHECKOUT], undefined]);
  });
});

describe("a chart's exemplar dots", () => {
  test("come from the services the query reads for", async () => {
    await MetricUtil.fetchExemplars({
      metricName: "http.server.duration",
      startAndEndDate: nextWindow(),
      attributes: { "http.route": "/pay" },
      serviceIds: [API],
    });

    const query: Record<string, unknown> = (
      analyticsGetListMock.mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;
    expect((query["primaryEntityId"] as Includes).values).toEqual([API]);
  });

  test("and from every service when it names none, as before", async () => {
    await MetricUtil.fetchExemplars({
      metricName: "http.server.duration",
      startAndEndDate: nextWindow(),
      attributes: { "http.route": "/pay" },
    });
    await MetricUtil.fetchExemplars({
      metricName: "http.server.duration",
      startAndEndDate: nextWindow(),
      serviceIds: [],
    });

    for (const call of analyticsGetListMock.mock.calls) {
      expect(
        Object.keys((call[0] as { query: Record<string, unknown> }).query),
      ).not.toContain("primaryEntityId");
    }
  });
});
