import "@testing-library/jest-dom";
import {
  beforeEach,
  afterEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Data Source chart widget does not draw anything itself — it builds a
 * SYNTHETIC MetricViewData and hands it to the same MetricCharts layer the
 * OneUptime-metrics chart uses. That translation object is the entire
 * contract between an external system (PromQL / SQL / LogQL / ES DSL / REST)
 * and a chart layer that otherwise assumes it is looking at OneUptime
 * metrics, so every field of it is behaviour:
 *
 *  - `filterData` staying EMPTY is what stops MetricCharts recognising the
 *    config as a real metric query and firing metric-exemplar fetches
 *    against OneUptime for data that never came from OneUptime;
 *  - `groupByAttributeKeys` is what makes the chart split series on each
 *    point's `attributes`, and must be undefined rather than [] when there
 *    is nothing to group on — an empty array reads as "group by nothing",
 *    which is a different chart;
 *  - the legend field and the `getSeries` hook are mutually exclusive
 *    halves of one decision: a static string names the whole query, a
 *    "{{label}}" template has to be resolved per series instead.
 *
 * Nothing here renders a real chart. MetricCharts is stubbed to record its
 * props, because what this component is responsible for is what it ASKS the
 * chart layer to do, not what recharts eventually paints in jsdom.
 */

const fetchTimeSeriesMock: MockFunction = getJestMockFunction();
const getAttributeKeysMock: MockFunction = getJestMockFunction();
const metricChartsRenderMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs. Dereferencing them lazily, at call time, is what makes
 * this work.
 *
 * getAttributeKeys is a BARE stub returning whatever the test set — it is
 * deliberately not a second implementation of the real key-union logic,
 * because the component's only job with it is to forward the value through
 * to groupByAttributeKeys. Re-deriving the keys in the mock would mean the
 * assertions were checking the mock against itself.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DataSourceQuery",
  () => {
    return {
      __esModule: true,
      default: {
        fetchTimeSeries: (...args: Array<any>) => {
          return fetchTimeSeriesMock(...args);
        },
        fetchTable: () => {
          throw new Error("The chart widget must not use the table endpoint.");
        },
        getAttributeKeys: (...args: Array<any>) => {
          return getAttributeKeysMock(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MetricChartsStubProps): React.ReactElement => {
        metricChartsRenderMock(props);
        return React.createElement(
          "div",
          { "data-testid": "metric-charts" },
          `results:${props.metricResults.length} configs:${props.metricViewData.queryConfigs.length}`,
        );
      },
    };
  },
);

import DashboardDataSourceChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceChartComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { setPublicDashboardContext } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardDataSourceChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceChartComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DataSourceQueryConfig from "../../../Types/DataSource/DataSourceQueryConfig";
import { ObjectType } from "../../../Types/JSON";
import MetricQueryConfigData, {
  ChartSeries,
  MetricChartType,
} from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

interface MetricChartsStubProps {
  metricResults: Array<AggregatedResult>;
  metricViewData: MetricViewData;
  hideCard?: boolean | undefined;
  topNOverrideScope?: string | undefined;
}

/** One recorded call into the data source query client. */
interface DataSourceFetchArgs {
  queryConfig: DataSourceQueryConfig;
  startDate: Date;
  endDate: Date;
}

const COMPONENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const START_DATE: Date = new Date("2026-08-10T09:00:00.000Z");
const END_DATE: Date = new Date("2026-08-10T10:00:00.000Z");

/*
 * A CUSTOM range pins the window to fixed instants — a relative range would
 * resolve against the wall clock and make the window assertions untestable.
 */
const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(START_DATE, END_DATE),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

/*
 * A value nothing in the component could invent on its own. If it shows up
 * in groupByAttributeKeys, the component forwarded what getAttributeKeys
 * returned rather than deriving anything itself.
 */
const SENTINEL_ATTRIBUTE_KEYS: Array<string> = [
  "sentinel.attribute.one",
  "sentinel.attribute.two",
];

type BuildBasePropsFunction = (
  overrides?: Partial<DashboardBaseComponentProps>,
) => DashboardBaseComponentProps;

const buildBaseProps: BuildBasePropsFunction = (
  overrides: Partial<DashboardBaseComponentProps> = {},
): DashboardBaseComponentProps => {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "data-source-chart-widget",
    onComponentUpdate: (): void => {
      // The chart widget never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    ...overrides,
  };
};

type BuildPointFunction = (
  value: number,
  timestamp: string,
  attributes?: Record<string, string>,
) => AggregatedModel;

const buildPoint: BuildPointFunction = (
  value: number,
  timestamp: string,
  attributes?: Record<string, string>,
): AggregatedModel => {
  return {
    timestamp: new Date(timestamp),
    value: value,
    ...(attributes ? { attributes: attributes } : {}),
  } as AggregatedModel;
};

type BuildSeriesFunction = (points: Array<AggregatedModel>) => AggregatedResult;

const buildSeries: BuildSeriesFunction = (
  points: Array<AggregatedModel>,
): AggregatedResult => {
  return {
    data: points,
    truncated: false,
  };
};

type RenderChartFunction = (
  args: DashboardDataSourceChartComponent["arguments"],
  overrides?: Partial<DashboardBaseComponentProps>,
) => void;

const renderChartWidget: RenderChartFunction = (
  args: DashboardDataSourceChartComponent["arguments"],
  overrides: Partial<DashboardBaseComponentProps> = {},
): void => {
  const component: DashboardDataSourceChartComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.DataSourceChart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 8,
    heightInDashboardUnits: 6,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: args,
  };

  render(
    <DashboardDataSourceChartComponentElement
      {...buildBaseProps(overrides)}
      component={component}
    />,
  );
};

/** The props of the most recent MetricCharts render. */
type GetLastChartPropsFunction = () => MetricChartsStubProps;

const getLastChartProps: GetLastChartPropsFunction =
  (): MetricChartsStubProps => {
    const calls: Array<Array<unknown>> = metricChartsRenderMock.mock.calls;

    if (calls.length === 0) {
      throw new Error("MetricCharts was never rendered.");
    }

    return calls[calls.length - 1]![0] as MetricChartsStubProps;
  };

/*
 * Render, wait for the fetch to settle and the chart layer to be handed its
 * synthetic view data, then return that view data.
 */
type RenderAndGetConfigsFunction = (
  args: DashboardDataSourceChartComponent["arguments"],
) => Promise<Array<MetricQueryConfigData>>;

const renderAndGetConfigs: RenderAndGetConfigsFunction = async (
  args: DashboardDataSourceChartComponent["arguments"],
): Promise<Array<MetricQueryConfigData>> => {
  renderChartWidget(args);

  await waitFor((): void => {
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });

  return getLastChartProps().metricViewData.queryConfigs;
};

const PROM_QUERY: DataSourceQueryConfig = {
  id: "q1",
  dataSourceId: "ds-prom",
  query: "up",
};

beforeEach((): void => {
  jest.clearAllMocks();
  fetchTimeSeriesMock.mockResolvedValue(
    buildSeries([buildPoint(1, "2026-08-10T09:15:00.000Z")]),
  );
  getAttributeKeysMock.mockReturnValue([]);
});

afterEach((): void => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("Data Source chart synthetic MetricViewData", () => {
  describe("the synthetic config exposes no OneUptime metric surface", () => {
    /*
     * The one clause that keeps the chart layer from treating an external
     * query as a metric query. MetricCharts branches on filterData to decide
     * whether it can fetch exemplars/metadata for the named metric; a
     * populated filterData here means requests to OneUptime for a series
     * that came out of somebody's Prometheus.
     */
    test("filterData is empty, so no metric-exemplar fetch can be keyed off it", async () => {
      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [PROM_QUERY],
      });

      expect(configs).toHaveLength(1);
      expect(configs[0]!.metricQueryData.filterData).toEqual({});
      // toEqual treats an explicit `undefined` key as absent; this does not.
      expect(Object.keys(configs[0]!.metricQueryData.filterData)).toHaveLength(
        0,
      );
    });

    test("filterData stays empty for every query, not just the first", async () => {
      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [
          PROM_QUERY,
          { id: "q2", dataSourceId: "ds-pg", query: "select 1" },
        ],
      });

      expect(configs).toHaveLength(2);
      for (const config of configs) {
        expect(Object.keys(config.metricQueryData.filterData)).toHaveLength(0);
      }
    });

    test("no formula configs are synthesised for external data", async () => {
      await renderAndGetConfigs({ queries: [PROM_QUERY] });

      expect(getLastChartProps().metricViewData.formulaConfigs).toEqual([]);
    });
  });

  describe("groupByAttributeKeys is the forwarded attribute-key list", () => {
    test("whatever getAttributeKeys returns is passed straight through", async () => {
      getAttributeKeysMock.mockReturnValue(SENTINEL_ATTRIBUTE_KEYS);

      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [PROM_QUERY],
      });

      expect(configs[0]!.metricQueryData.groupByAttributeKeys).toEqual(
        SENTINEL_ATTRIBUTE_KEYS,
      );
    });

    test("getAttributeKeys is asked about the result, not the query", async () => {
      const result: AggregatedResult = buildSeries([
        buildPoint(5, "2026-08-10T09:15:00.000Z", { instance: "a:9090" }),
      ]);
      fetchTimeSeriesMock.mockResolvedValue(result);

      await renderAndGetConfigs({ queries: [PROM_QUERY] });

      const lastCall: Array<unknown> =
        getAttributeKeysMock.mock.calls[
          getAttributeKeysMock.mock.calls.length - 1
        ]!;
      expect(lastCall[0]).toBe(result);
    });

    /*
     * `[]` and `undefined` are NOT the same instruction to the chart layer:
     * an empty array is a group-by with no keys, undefined is "do not group
     * at all". A result with no attributes must produce the second.
     */
    test("no attributes means undefined, never an empty array", async () => {
      getAttributeKeysMock.mockReturnValue([]);

      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [PROM_QUERY],
      });

      expect(configs[0]!.metricQueryData.groupByAttributeKeys).toBeUndefined();
      expect(configs[0]!.metricQueryData.groupByAttributeKeys).not.toEqual([]);
    });
  });

  describe("the legend field is a three-way decision", () => {
    test("no legend falls back to a positional Query N name", async () => {
      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [
          { id: "q1", dataSourceId: "ds-prom", query: "up" },
          { id: "q2", dataSourceId: "ds-pg", query: "select 1" },
        ],
      });

      expect(
        configs.map((config: MetricQueryConfigData): string | undefined => {
          return config.metricAliasData?.legend;
        }),
      ).toEqual(["Query 1", "Query 2"]);
    });

    test("a literal legend is used verbatim", async () => {
      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [
          { id: "q1", dataSourceId: "ds-prom", query: "up", legend: "errors" },
        ],
      });

      expect(configs[0]!.metricAliasData?.legend).toBe("errors");
    });

    /*
     * A template cannot name the whole query — it names each series
     * separately, which only getSeries can do. Leaving the literal
     * "{{instance}}" in the legend would put the raw template in the chart
     * legend for every series.
     */
    test("a templated legend clears the static legend entirely", async () => {
      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [
          {
            id: "q1",
            dataSourceId: "ds-prom",
            query: "up",
            legend: "{{instance}}",
          },
        ],
      });

      expect(configs[0]!.metricAliasData?.legend).toBeUndefined();
    });

    test("a templated legend does not fall back to Query N either", async () => {
      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [
          {
            id: "q1",
            dataSourceId: "ds-prom",
            query: "up",
            legend: "{{instance}} ({{job}})",
          },
        ],
      });

      expect(configs[0]!.metricAliasData?.legend).not.toBe("Query 1");
      expect(configs[0]!.metricAliasData?.legend).toBeUndefined();
    });

    test("each query decides for itself, in its own position", async () => {
      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [
          {
            id: "q1",
            dataSourceId: "ds-prom",
            query: "up",
            legend: "{{instance}}",
          },
          { id: "q2", dataSourceId: "ds-pg", query: "select 1" },
          {
            id: "q3",
            dataSourceId: "ds-prom",
            query: "rate(x[5m])",
            legend: "errors",
          },
        ],
      });

      expect(
        configs.map((config: MetricQueryConfigData): string | undefined => {
          return config.metricAliasData?.legend;
        }),
      ).toEqual([undefined, "Query 2", "errors"]);
    });
  });

  describe("the getSeries hook exists only for templated legends", () => {
    type GetSeriesForFunction = (
      legend: string | undefined,
    ) => Promise<MetricQueryConfigData["getSeries"]>;

    const getSeriesFor: GetSeriesForFunction = async (
      legend: string | undefined,
    ): Promise<MetricQueryConfigData["getSeries"]> => {
      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [
          {
            id: "q1",
            dataSourceId: "ds-prom",
            query: "up",
            ...(legend === undefined ? {} : { legend: legend }),
          },
        ],
      });

      return configs[0]!.getSeries;
    };

    test("a templated legend installs the hook", async () => {
      expect(await getSeriesFor("{{instance}}")).toBeDefined();
    });

    test("a literal legend installs no hook", async () => {
      expect(await getSeriesFor("errors")).toBeUndefined();
    });

    test("no legend at all installs no hook", async () => {
      expect(await getSeriesFor(undefined)).toBeUndefined();
    });

    test("the hook names a series from that point's attributes", async () => {
      const getSeries: MetricQueryConfigData["getSeries"] =
        await getSeriesFor("{{instance}}");

      const series: ChartSeries = getSeries!({
        attributes: { instance: "a:9090" },
      } as unknown as AggregatedModel);

      expect(series).toEqual({ title: "a:9090" });
    });

    /*
     * A point that carries no attributes at all still has to get a name —
     * an empty title collapses every such series into one nameless entry.
     */
    test("a point with empty attributes renders the unset marker", async () => {
      const getSeries: MetricQueryConfigData["getSeries"] =
        await getSeriesFor("{{instance}}");

      expect(
        getSeries!({ attributes: {} } as unknown as AggregatedModel),
      ).toEqual({ title: "(unset)" });
    });

    test("a point with no attributes object at all renders the unset marker", async () => {
      const getSeries: MetricQueryConfigData["getSeries"] =
        await getSeriesFor("{{instance}}");

      expect(getSeries!(buildPoint(1, "2026-08-10T09:15:00.000Z"))).toEqual({
        title: "(unset)",
      });
    });

    test("the hook resolves every placeholder in a multi-token template", async () => {
      const getSeries: MetricQueryConfigData["getSeries"] = await getSeriesFor(
        "{{instance}} ({{job}})",
      );

      expect(
        getSeries!({
          attributes: { instance: "a:9090", job: "api" },
        } as unknown as AggregatedModel),
      ).toEqual({ title: "a:9090 (api)" });
    });
  });

  describe("the widget's chart type maps onto the chart layer's", () => {
    interface ChartTypeCase {
      label: string;
      dashboardChartType: DashboardChartType | undefined;
      expectedMetricChartType: MetricChartType;
    }

    const CHART_TYPE_CASES: Array<ChartTypeCase> = [
      {
        label: "Bar",
        dashboardChartType: DashboardChartType.Bar,
        expectedMetricChartType: MetricChartType.BAR,
      },
      {
        label: "Area",
        dashboardChartType: DashboardChartType.Area,
        expectedMetricChartType: MetricChartType.AREA,
      },
      /*
       * StackedArea is a one-line branch that shares its return with Area.
       * Drop it from the condition and the widget silently draws lines.
       */
      {
        label: "Stacked Area",
        dashboardChartType: DashboardChartType.StackedArea,
        expectedMetricChartType: MetricChartType.AREA,
      },
      {
        label: "Line",
        dashboardChartType: DashboardChartType.Line,
        expectedMetricChartType: MetricChartType.LINE,
      },
      {
        label: "an unset chart type",
        dashboardChartType: undefined,
        expectedMetricChartType: MetricChartType.LINE,
      },
    ];

    for (const chartTypeCase of CHART_TYPE_CASES) {
      test(`${chartTypeCase.label} becomes ${chartTypeCase.expectedMetricChartType}`, async () => {
        const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs(
          {
            queries: [PROM_QUERY],
            ...(chartTypeCase.dashboardChartType === undefined
              ? {}
              : { chartType: chartTypeCase.dashboardChartType }),
          },
        );

        expect(configs[0]!.chartType).toBe(
          chartTypeCase.expectedMetricChartType,
        );
      });
    }

    test("the chart type is applied to every query, not only the first", async () => {
      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [
          PROM_QUERY,
          { id: "q2", dataSourceId: "ds-pg", query: "select 1" },
        ],
        chartType: DashboardChartType.Bar,
      });

      expect(
        configs.map(
          (config: MetricQueryConfigData): MetricChartType | undefined => {
            return config.chartType;
          },
        ),
      ).toEqual([MetricChartType.BAR, MetricChartType.BAR]);
    });
  });

  describe("config identity and index alignment", () => {
    /*
     * Chart layers key per-chart UI state (hidden series, Top-N, sort) on
     * config.id. Older persisted widgets predate the stored id, so the
     * synthetic config has to invent a stable one rather than leave it
     * undefined and let two charts share state.
     */
    test("a stored query with no id gets a positional fallback id", async () => {
      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [
          { dataSourceId: "ds-prom", query: "up" },
          { id: "q-b", dataSourceId: "ds-pg", query: "select 1" },
          { dataSourceId: "ds-prom", query: "rate(x[5m])" },
        ],
      });

      expect(
        configs.map((config: MetricQueryConfigData): string | undefined => {
          return config.id;
        }),
      ).toEqual(["data-source-query-0", "q-b", "data-source-query-2"]);
    });

    test("the fallback id counts configured queries, skipping half-filled cards", async () => {
      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [
          // Source picked, query still empty — the user is mid-edit.
          { dataSourceId: "ds-prom", query: "   " },
          { dataSourceId: "ds-pg", query: "select 1" },
        ],
      });

      expect(configs).toHaveLength(1);
      expect(configs[0]!.id).toBe("data-source-query-0");
    });

    /*
     * The synthetic configs and the results array are read together by the
     * chart layer, position by position. If they ever drift, query 1's
     * legend ends up over query 2's data.
     */
    test("each configured query gets one config, paired with its own result", async () => {
      fetchTimeSeriesMock.mockImplementation(
        (args: DataSourceFetchArgs): Promise<AggregatedResult> => {
          return Promise.resolve(
            buildSeries([
              buildPoint(1, "2026-08-10T09:15:00.000Z", {
                query: args.queryConfig.query,
              }),
            ]),
          );
        },
      );

      const configs: Array<MetricQueryConfigData> = await renderAndGetConfigs({
        queries: [
          { id: "q1", dataSourceId: "ds-prom", query: "up" },
          // Never configured — must not consume a position.
          { id: "q2", dataSourceId: "", query: "select 1" },
          { id: "q3", dataSourceId: "ds-pg", query: "select count(*) from t" },
        ],
      });

      const lastProps: MetricChartsStubProps = getLastChartProps();

      expect(configs).toHaveLength(2);
      expect(lastProps.metricResults).toHaveLength(2);
      expect(
        configs.map((config: MetricQueryConfigData): string | undefined => {
          return config.id;
        }),
      ).toEqual(["q1", "q3"]);

      /*
       * Identity, not shape: config[i] was built from result[i], which is
       * the only thing that proves the pairing.
       */
      const attributeKeyArguments: Array<unknown> =
        getAttributeKeysMock.mock.calls
          .slice(-2)
          .map((call: Array<unknown>): unknown => {
            return call[0];
          });

      expect(attributeKeyArguments[0]).toBe(lastProps.metricResults[0]);
      expect(attributeKeyArguments[1]).toBe(lastProps.metricResults[1]);
      expect(
        (
          lastProps.metricResults[0]!.data[0] as unknown as {
            attributes: Record<string, string>;
          }
        ).attributes["query"],
      ).toBe("up");
      expect(
        (
          lastProps.metricResults[1]!.data[0] as unknown as {
            attributes: Record<string, string>;
          }
        ).attributes["query"],
      ).toBe("select count(*) from t");
    });
  });
});
