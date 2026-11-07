import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
  SerializedMetricQuery,
} from "Common/Utils/Metrics/MetricExplorerUrl";
import MetricQueryServices from "Common/Utils/Metrics/MetricQueryServices";
import { buildQueryConfigsFromSerializedQueries } from "../../FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricConfigReconstruct";
import MetricInvestigationQueryUtil, {
  MetricInvestigationQueries,
  MetricInvestigationQueriesUrlValue,
} from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationQueries";

/*
 * Issue #6266: a query's service filter survives every link a chart makes -
 * Open in Metric Explorer, the explorer's own URL (reload, Copy link, saved
 * views) and a metric investigation's URL (Edit metrics, Copy link) - so a
 * chart of a Metrics monitor limited to services A and B opens on A and B
 * only. A query without one serializes exactly as before.
 */

const API: string = "11111111-1111-4111-8111-111111111111";
const CHECKOUT: string = "22222222-2222-4222-8222-222222222222";

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-07T10:00:00.000Z"),
  new Date("2026-11-07T11:00:00.000Z"),
);

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
        aggegationType: MetricsAggregationType.P95,
        attributes: { "http.route": "/pay" },
        ...(serviceIds ? { telemetryServiceIds: serviceIds } : {}),
      } as never,
    },
  };
};

const dataOf: (queryConfigs: Array<MetricQueryConfigData>) => MetricViewData = (
  queryConfigs: Array<MetricQueryConfigData>,
): MetricViewData => {
  return {
    startAndEndDate: WINDOW,
    queryConfigs: queryConfigs,
    formulaConfigs: [],
  };
};

// The explorer, opened on these params: its queries as it rebuilds them.
const openedFrom: (
  params: Dictionary<string>,
) => Array<MetricQueryConfigData> = (
  params: Dictionary<string>,
): Array<MetricQueryConfigData> => {
  return buildQueryConfigsFromSerializedQueries(
    MetricExplorerUrl.parseMetricQueriesParam(
      params[MetricExplorerUrlParam.MetricQueries]!,
    ),
  );
};

describe("Open in Metric Explorer, and the explorer's own URL", () => {
  test("the query's services travel in the link and come back as its filter", () => {
    const params: Dictionary<string> =
      MetricExplorerUrl.buildQueryParamsFromMetricViewData(
        dataOf([queryOf([API, CHECKOUT])]),
      );

    const serialized: Array<SerializedMetricQuery> = JSON.parse(
      params[MetricExplorerUrlParam.MetricQueries]!,
    );
    expect(serialized[0]!.serviceIds).toEqual([API, CHECKOUT]);

    const [opened] = openedFrom(params);
    expect(MetricQueryServices.getServiceIds(opened)).toEqual([API, CHECKOUT]);
    // Its other filters with it.
    expect(opened!.metricQueryData.filterData.attributes).toEqual({
      "http.route": "/pay",
    });
    expect(opened!.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.P95,
    );
  });

  test("a query without services is serialized exactly as before", () => {
    const params: Dictionary<string> =
      MetricExplorerUrl.buildQueryParamsFromMetricViewData(
        dataOf([queryOf()]),
      );

    const serialized: Array<Record<string, unknown>> = JSON.parse(
      params[MetricExplorerUrlParam.MetricQueries]!,
    );
    expect(Object.keys(serialized[0]!)).not.toContain("serviceIds");
    expect(serialized[0]).toEqual({
      metricName: "http.server.duration",
      variable: "a",
      attributes: { "http.route": "/pay" },
      aggregationType: MetricsAggregationType.P95,
    });

    const [opened] = openedFrom(params);
    expect(
      Object.keys(opened!.metricQueryData.filterData),
    ).not.toContain("telemetryServiceIds");
  });

  test("a query whose only filter is its services is still kept in a link", () => {
    const query: SerializedMetricQuery = {
      metricName: "",
      attributes: {},
      serviceIds: [API],
    };

    expect(MetricExplorerUrl.isMeaningfulMetricQuery(query)).toBe(true);
    expect(
      MetricExplorerUrl.isMeaningfulMetricQuery({
        metricName: "",
        attributes: {},
      }),
    ).toBe(false);
  });

  test.each([
    ["not a list", "garbage"],
    ["a list of blanks and non-ids", ["", "  ", null, {}, []]],
  ])(
    "a link whose services are %s opens on every service",
    (_name: string, serviceIds: unknown) => {
      const [parsed] = MetricExplorerUrl.parseMetricQueriesParam(
        JSON.stringify([
          { metricName: "http.server.duration", serviceIds: serviceIds },
        ]),
      );

      expect(parsed!.serviceIds).toBeUndefined();
    },
  );

  test("a hand-made link with too many services is cut, and duplicates kept once", () => {
    const many: Array<string> = [];
    for (let index: number = 0; index < 500; index++) {
      many.push(`service-${index}`);
    }

    const [parsed] = MetricExplorerUrl.parseMetricQueriesParam(
      JSON.stringify([
        {
          metricName: "http.server.duration",
          serviceIds: [API, API, ...many],
        },
      ]),
    );

    expect(parsed!.serviceIds!.length).toBe(200);
    expect(parsed!.serviceIds![0]).toBe(API);
    expect(parsed!.serviceIds![1]).toBe("service-0");
  });
});

describe("a metric investigation's URL (Edit metrics, Copy link)", () => {
  test("keeps the services, and reads them back as the same queries", () => {
    const queries: MetricInvestigationQueries = {
      queryConfigs: [queryOf([API])],
      formulaConfigs: [],
    };

    const urlValue: MetricInvestigationQueriesUrlValue | null =
      MetricInvestigationQueryUtil.toUrlValue(queries);
    const readBack: MetricInvestigationQueries | null =
      MetricInvestigationQueryUtil.fromUrlValue(urlValue!);

    expect(MetricQueryServices.getServiceIds(readBack!.queryConfigs[0])).toEqual(
      [API],
    );
    expect(MetricInvestigationQueryUtil.isSame(readBack, queries)).toBe(true);
  });

  test("taking a service away is a change of the metrics", () => {
    const scoped: MetricInvestigationQueries = {
      queryConfigs: [queryOf([API, CHECKOUT])],
      formulaConfigs: [],
    };
    const fewer: MetricInvestigationQueries = {
      queryConfigs: [queryOf([API])],
      formulaConfigs: [],
    };
    const none: MetricInvestigationQueries = {
      queryConfigs: [queryOf()],
      formulaConfigs: [],
    };

    expect(MetricInvestigationQueryUtil.isSame(scoped, fewer)).toBe(false);
    expect(MetricInvestigationQueryUtil.isSame(fewer, none)).toBe(false);
  });
});
