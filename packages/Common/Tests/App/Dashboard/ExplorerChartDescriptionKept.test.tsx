import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A CHART'S DESCRIPTION KEEPS WHERE IT CAME FROM (#8572).
 *
 * The explorer marks a description it copies from the metric
 * (MetricAliasData.isMetricTypeDescription), so the chart that draws it
 * looks it up in the reader's language while the configuration keeps the
 * stored English. The mark has to travel wherever the configuration does,
 * or a chart drawn from it reads English again:
 *
 *   - set where the explorer's metric picker copies the description, and
 *     only when it copies one;
 *   - through the explorer's link and a saved view (MetricExplorerUrl and
 *     MetricConfigReconstruct), and never made up by a link;
 *   - into the query a fallback draws in its slot;
 *   - from a dashboard's Chart widget to the chart it draws;
 *   - and dropped by chartWordsInReadersLanguage, which hands the
 *     description over worded already, so nothing looks it up twice.
 */

const metricQueryRenderMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();
const metricChartsRenderMock: MockFunction = getJestMockFunction();

/*
 * The metric picker under the query is not what this is about: it hands
 * its changes up through onDataChanged, which the test calls as it would.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricQuery",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        metricQueryRenderMock(props);
        return React.createElement(
          "div",
          { "data-testid": "metric-query" },
          "metric picker",
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

// The arrow wrappers dereference the mocks at call time: jest.mock is hoisted.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<any>) => {
          return fetchResultsMock(...args);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/ExplorerLink",
  () => {
    return {
      __esModule: true,
      default: {
        openInExplorer: () => {
          return undefined;
        },
      },
    };
  },
);

// What the widget hands its chart to draw is what this reads.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        metricChartsRenderMock(props);
        return React.createElement(
          "div",
          { "data-testid": "metric-charts" },
          "chart",
        );
      },
    };
  },
);

import DashboardChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import MetricQueryConfig from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryConfig";
import { chartWordsInReadersLanguage } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/ChartWordsInReadersLanguage";
import { buildQueryConfigsFromSerializedQueries } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricConfigReconstruct";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardChartComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import MetricAliasData from "../../../Types/Metrics/MetricAliasData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../Types/Metrics/MetricQueryData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { Translator } from "../../../Types/Translator";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
  SerializedMetricQuery,
} from "../../../Utils/Metrics/MetricExplorerUrl";
import MetricQueryFallbackUtil from "../../../Utils/Metrics/MetricQueryFallback";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";

// What the server stores as the description of a host monitor's series (#8356).
const LOAD_AVERAGE: string = "1-minute load average";
const TYPED: string = "Load on the build host, watched during releases";

const LOAD_METRIC: string = MonitorMetricType.LoadAverage1Min;
const SWAP_METRIC: string = MonitorMetricType.SwapUsagePercent;
const BARE_METRIC: string = "checkout.requests";

function metricType(name: string, description?: string): MetricType {
  const type: MetricType = new MetricType();
  type.name = name;
  if (description !== undefined) {
    type.description = description;
  }
  type.unit = "";
  return type;
}

// A chart's query as the explorer writes it once a person picks a host series.
function pickedQuery(
  alias: Partial<MetricAliasData> = {},
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: LOAD_METRIC,
      description: LOAD_AVERAGE,
      isMetricTypeDescription: true,
      legend: LOAD_METRIC,
      legendUnit: "",
      ...alias,
    },
    metricQueryData: {
      filterData: {
        metricName: LOAD_METRIC,
        aggegationType: MetricsAggregationType.Avg,
      },
    },
  } as MetricQueryConfigData;
}

beforeEach(() => {
  metricQueryRenderMock.mockReset();
  fetchResultsMock.mockReset();
  metricChartsRenderMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the explorer's metric picker copies a metric's description and marks it (MetricQueryConfig)", () => {
  function renderQuery(
    data: MetricQueryConfigData,
    onChange: MockFunction,
    metricTypes: Array<MetricType>,
  ): void {
    render(
      <MetricQueryConfig
        data={data}
        onChange={onChange as unknown as (data: MetricQueryConfigData) => void}
        metricTypes={metricTypes}
        telemetryAttributes={[]}
        hideCard={true}
      />,
    );
  }

  // What the metric picker hands up when the reader picks a metric.
  function pick(metricName: string): void {
    const calls: Array<Array<unknown>> = metricQueryRenderMock.mock.calls;
    const props: {
      data: MetricQueryData;
      onDataChanged: (data: MetricQueryData) => void;
    } = calls[calls.length - 1]?.[0] as {
      data: MetricQueryData;
      onDataChanged: (data: MetricQueryData) => void;
    };

    act(() => {
      props.onDataChanged({
        ...props.data,
        filterData: {
          ...props.data.filterData,
          metricName: metricName,
        } as MetricQueryData["filterData"],
      });
    });
  }

  function lastAlias(onChange: MockFunction): MetricAliasData {
    const calls: Array<Array<unknown>> = onChange.mock.calls;
    return (calls[calls.length - 1]?.[0] as MetricQueryConfigData)
      .metricAliasData as MetricAliasData;
  }

  const TYPES: Array<MetricType> = [
    metricType(LOAD_METRIC, LOAD_AVERAGE),
    metricType(BARE_METRIC),
  ];

  test("a metric with a description: the stored English, marked as the metric's own", () => {
    const onChange: MockFunction = getJestMockFunction();

    renderQuery(
      {
        metricAliasData: {
          metricVariable: "a",
          title: undefined,
          description: undefined,
          legend: undefined,
          legendUnit: undefined,
        },
        metricQueryData: {
          filterData: { aggegationType: MetricsAggregationType.Avg },
        },
      } as MetricQueryConfigData,
      onChange,
      TYPES,
    );
    pick(LOAD_METRIC);

    expect(lastAlias(onChange)).toEqual(
      expect.objectContaining({
        title: LOAD_METRIC,
        description: LOAD_AVERAGE,
        isMetricTypeDescription: true,
      }),
    );
  });

  test("a metric with no description: nothing to mark, and a mark the last one left is gone", () => {
    const onChange: MockFunction = getJestMockFunction();

    renderQuery(pickedQuery(), onChange, TYPES);
    pick(BARE_METRIC);

    expect(lastAlias(onChange).description).toBe("");
    expect(lastAlias(onChange).isMetricTypeDescription).toBe(false);
  });

  test("a description a person typed is replaced by the new metric's own, marked", () => {
    const onChange: MockFunction = getJestMockFunction();

    renderQuery(
      {
        ...pickedQuery({
          title: BARE_METRIC,
          description: TYPED,
          isMetricTypeDescription: false,
        }),
        metricQueryData: {
          filterData: {
            metricName: BARE_METRIC,
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      } as MetricQueryConfigData,
      onChange,
      TYPES,
    );
    pick(LOAD_METRIC);

    expect(lastAlias(onChange).description).toBe(LOAD_AVERAGE);
    expect(lastAlias(onChange).isMetricTypeDescription).toBe(true);
  });
});

describe("the explorer's link and a saved view carry the mark (MetricExplorerUrl)", () => {
  function roundTrip(query: MetricQueryConfigData): {
    serialized: SerializedMetricQuery;
    rebuilt: MetricQueryConfigData;
  } {
    const params: Record<string, string> =
      MetricExplorerUrl.buildQueryParamsFromMetricViewData({
        queryConfigs: [query],
        formulaConfigs: [],
        startAndEndDate: new InBetween<Date>(
          new Date("2026-11-12T10:00:00.000Z"),
          new Date("2026-11-12T11:00:00.000Z"),
        ),
      } as MetricViewData) as Record<string, string>;
    const parsed: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(
        params[MetricExplorerUrlParam.MetricQueries] as string,
      );

    expect(parsed).toHaveLength(1);

    const rebuilt: Array<MetricQueryConfigData> =
      buildQueryConfigsFromSerializedQueries(parsed);

    return {
      serialized: parsed[0] as SerializedMetricQuery,
      rebuilt: rebuilt[0] as MetricQueryConfigData,
    };
  }

  test("a metric's own description comes back in English, marked", () => {
    const { serialized, rebuilt } = roundTrip(pickedQuery());

    expect(serialized.alias?.description).toBe(LOAD_AVERAGE);
    expect(serialized.alias?.isMetricTypeDescription).toBe(true);
    expect(rebuilt.metricAliasData?.description).toBe(LOAD_AVERAGE);
    expect(rebuilt.metricAliasData?.isMetricTypeDescription).toBe(true);
  });

  test("a typed description comes back as typed, unmarked", () => {
    const { serialized, rebuilt } = roundTrip(
      pickedQuery({ description: TYPED, isMetricTypeDescription: false }),
    );

    expect(serialized.alias?.description).toBe(TYPED);
    expect(serialized.alias?.isMetricTypeDescription).toBeUndefined();
    expect(rebuilt.metricAliasData?.description).toBe(TYPED);
    expect(rebuilt.metricAliasData?.isMetricTypeDescription).toBeUndefined();
  });

  test("a link marks nothing it does not describe, nor with anything but true", () => {
    const parse: (alias: Record<string, unknown>) => SerializedMetricQuery = (
      alias: Record<string, unknown>,
    ): SerializedMetricQuery => {
      return MetricExplorerUrl.parseMetricQueriesParam(
        JSON.stringify([{ metricName: LOAD_METRIC, alias: alias }]),
      )[0] as SerializedMetricQuery;
    };

    expect(
      parse({ title: "Load", isMetricTypeDescription: true }).alias
        ?.isMetricTypeDescription,
    ).toBeUndefined();
    expect(
      parse({ description: LOAD_AVERAGE, isMetricTypeDescription: "true" })
        .alias?.isMetricTypeDescription,
    ).toBeUndefined();
    expect(
      parse({ description: LOAD_AVERAGE, isMetricTypeDescription: true }).alias
        ?.isMetricTypeDescription,
    ).toBe(true);
  });

  test("a link made before the mark existed draws its description as written", () => {
    const parsed: SerializedMetricQuery =
      MetricExplorerUrl.parseMetricQueriesParam(
        JSON.stringify([
          { metricName: LOAD_METRIC, alias: { description: LOAD_AVERAGE } },
        ]),
      )[0] as SerializedMetricQuery;

    expect(parsed.alias?.description).toBe(LOAD_AVERAGE);
    expect(parsed.alias?.isMetricTypeDescription).toBeUndefined();
  });
});

describe("a fallback keeps its query's mark (MetricQueryFallbackUtil)", () => {
  test("the query drawn in the slot carries the fallback's description and its mark", () => {
    const main: MetricQueryConfigData = {
      ...pickedQuery({ description: TYPED, isMetricTypeDescription: false }),
      fallback: {
        queryConfig: {
          ...pickedQuery({ title: SWAP_METRIC, legend: SWAP_METRIC }),
          metricQueryData: {
            filterData: {
              metricName: SWAP_METRIC,
              aggegationType: MetricsAggregationType.Avg,
            },
          },
        } as MetricQueryConfigData,
      },
    } as MetricQueryConfigData;
    const charted: MetricQueryConfigData | undefined =
      MetricQueryFallbackUtil.getFallbackQueryConfig(main);

    expect(charted?.metricAliasData?.description).toBe(LOAD_AVERAGE);
    expect(charted?.metricAliasData?.isMetricTypeDescription).toBe(true);
  });
});

describe("chartWordsInReadersLanguage hands a description over worded, unmarked", () => {
  test("a marked description it words is not looked up again by the chart", () => {
    const german: Translator = dashboardTranslator("de");
    const [handed] = chartWordsInReadersLanguage([pickedQuery()], german);

    expect(handed?.metricAliasData?.description).toBe(
      german.translateText(LOAD_AVERAGE),
    );
    expect(handed?.metricAliasData?.description).not.toBe(LOAD_AVERAGE);
    expect(handed?.metricAliasData?.isMetricTypeDescription).toBeFalsy();
  });
});

describe("a dashboard's Chart widget hands its chart the mark", () => {
  const COMPONENT_ID: ObjectID = new ObjectID(
    "44444444-1111-4111-8111-444444444444",
  );
  const WINDOW: RangeStartAndEndDateTime = {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(
      new Date(Date.UTC(2026, 9, 31, 9, 0)),
      new Date(Date.UTC(2026, 9, 31, 10, 0)),
    ),
  };
  const VIEW_CONFIG: DashboardViewConfig = {
    _type: ObjectType.DashboardViewConfig,
    components: [],
    heightInDashboardUnits: 60,
  };

  function chartOf(query: MetricQueryConfigData): DashboardChartComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.Chart,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      minHeightInDashboardUnits: 3,
      arguments: {
        chartTitle: "Host load",
        chartType: DashboardChartType.Line,
        // As the dashboard's column holds it: through JSON.
        metricQueryConfig: JSON.parse(JSON.stringify(query)),
      },
    } as unknown as DashboardChartComponent;
  }

  async function drawnAlias(
    query: MetricQueryConfigData,
  ): Promise<MetricAliasData | undefined> {
    fetchResultsMock.mockImplementation(
      (): Promise<Array<AggregatedResult>> => {
        return Promise.resolve([
          {
            data: [
              {
                timestamp: new Date(Date.UTC(2026, 9, 31, 9, 10)),
                value: 0.5,
              },
            ],
            truncated: false,
          } as unknown as AggregatedResult,
        ]);
      },
    );

    render(
      <DashboardChartComponentElement
        {...({
          componentId: COMPONENT_ID,
          isEditMode: false,
          isSelected: false,
          key: "host-load-chart",
          onComponentUpdate: (): void => {
            // The widget under test never writes back through this.
          },
          totalCurrentDashboardWidthInPx: 1200,
          dashboardCanvasTopInPx: 0,
          dashboardCanvasLeftInPx: 0,
          dashboardCanvasWidthInPx: 1200,
          dashboardCanvasHeightInPx: 800,
          dashboardComponentHeightInPx: 320,
          dashboardComponentWidthInPx: 480,
          dashboardViewConfig: VIEW_CONFIG,
          dashboardStartAndEndDate: WINDOW,
          metricTypes: [],
          refreshTick: 0,
          variables: undefined,
        } as unknown as DashboardBaseComponentProps)}
        component={chartOf(query)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });

    const calls: Array<Array<unknown>> = metricChartsRenderMock.mock.calls;
    const props: { metricViewData: MetricViewData } = calls[
      calls.length - 1
    ]?.[0] as { metricViewData: MetricViewData };

    return props.metricViewData.queryConfigs[0]?.metricAliasData;
  }

  test("a chart built from a host series keeps the stored English, marked", async () => {
    const alias: MetricAliasData | undefined = await drawnAlias(pickedQuery());

    expect(alias?.description).toBe(LOAD_AVERAGE);
    expect(alias?.isMetricTypeDescription).toBe(true);
  });

  test("a chart whose description a person typed hands it over unmarked", async () => {
    const alias: MetricAliasData | undefined = await drawnAlias(
      pickedQuery({ description: TYPED, isMetricTypeDescription: false }),
    );

    expect(alias?.description).toBe(TYPED);
    expect(alias?.isMetricTypeDescription).toBeFalsy();
  });
});
