import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE METRIC CHART AND VALUE WIDGETS, BEFORE AND AFTER A METRIC IS PICKED
 * (issue #7160).
 *
 * The Chart widget drew its setup state as an error: "Please select a
 * metric. Click here to add a metric." - drawn as written in every
 * language, a click that opened nothing out of edit mode - and, once a
 * metric was picked, "Please select a aggregation. Click here to add a
 * aggregation." under an "Aggregate by" picker that showed Avg. The picker
 * shows Avg until another is picked and stores nothing until then; the
 * metrics read asks for Avg when none is stored. The Value widget read
 * nothing at all in that state and said "No data".
 *
 * Here the real widgets are drawn with the metrics read standing in:
 *
 *   - no metric picked: the widget reads nothing and says what it needs,
 *     in words for where it is drawn, under the chart's own title;
 *   - a metric and no aggregation: the widget reads and draws its
 *     average, as its settings show it, and the stored query is left as
 *     it was;
 *   - an aggregation that was picked is read as picked.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const metricChartsRenderMock: MockFunction = getJestMockFunction();

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

// What the chart is handed to draw is under test; a recharts surface is not.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        metricChartsRenderMock(props);
        return react.createElement(
          "div",
          { "data-testid": "metric-charts" },
          "chart",
        );
      },
    };
  },
);

import DashboardChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent";
import DashboardValueComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardValueComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { DASHBOARD_WIDGET_SETUP_LINE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSetupCopy";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardChartComponent";
import DashboardValueComponent from "../../../Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

const COMPONENT_ID: ObjectID = new ObjectID(
  "71600000-0000-4000-8000-000000007160",
);

const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-11-11T09:00:00.000Z"),
    new Date("2026-11-11T10:00:00.000Z"),
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

const BUCKETS: Array<AggregatedModel> = [
  { timestamp: new Date("2026-11-11T09:10:00.000Z"), value: 2 },
  { timestamp: new Date("2026-11-11T09:20:00.000Z"), value: 4 },
  { timestamp: new Date("2026-11-11T09:30:00.000Z"), value: 9 },
];

// Every line the Chart widget drew in place of its chart before #7160.
const OLD_CHART_LINES: RegExp = /Please select|Click here|a aggregation/;

function hostProps(
  overrides: Partial<DashboardBaseComponentProps> = {},
): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "metric-widget",
    onComponentUpdate: (): void => {
      // The widget never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: BOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    ...overrides,
  } as DashboardBaseComponentProps;
}

// A query as the settings store it: an aggregation only once one is picked.
function query(data: {
  metricName?: string | undefined;
  aggregation?: MetricsAggregationType | undefined;
  variable?: string | undefined;
}): MetricQueryConfigData {
  const filterData: JSONObject = {};

  if (data.metricName) {
    filterData["metricName"] = data.metricName;
  }

  if (data.aggregation) {
    filterData["aggegationType"] = data.aggregation;
  }

  return {
    metricAliasData: { metricVariable: data.variable || "a" },
    metricQueryData: { filterData: filterData },
  } as unknown as MetricQueryConfigData;
}

function chartWith(data: {
  title?: string | undefined;
  queries: Array<MetricQueryConfigData>;
}): DashboardChartComponent {
  const [primary, ...more] = data.queries;

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
      chartTitle: data.title,
      chartType: DashboardChartType.Line,
      metricQueryConfig: primary,
      ...(more.length > 0 ? { metricQueryConfigs: more } : {}),
    },
  } as unknown as DashboardChartComponent;
}

function valueWith(
  queryConfig: MetricQueryConfigData,
): DashboardValueComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.Value,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 4,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: {
      title: "Requests",
      metricQueryConfig: queryConfig,
    },
  } as unknown as DashboardValueComponent;
}

function chartElement(
  component: DashboardChartComponent,
  overrides: Partial<DashboardBaseComponentProps> = {},
): React.ReactElement {
  return (
    <DashboardChartComponentElement
      {...hostProps(overrides)}
      component={component}
    />
  );
}

function valueElement(
  component: DashboardValueComponent,
  overrides: Partial<DashboardBaseComponentProps> = {},
): React.ReactElement {
  return (
    <DashboardValueComponentElement
      {...hostProps(overrides)}
      component={component}
    />
  );
}

// Each read's queries, as the metrics read was asked them.
function askedQueries(): Array<Array<{ metric: string; aggregation: string }>> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>) => {
    const metricViewData: MetricViewData = (
      call[0] as { metricViewData: MetricViewData }
    ).metricViewData;

    return metricViewData.queryConfigs.map((config: MetricQueryConfigData) => {
      return {
        metric: String(config.metricQueryData.filterData.metricName),
        aggregation: String(config.metricQueryData.filterData.aggegationType),
      };
    });
  });
}

// The queries the chart was last handed to draw.
function drawnAggregations(): Array<string> {
  const calls: Array<Array<unknown>> = metricChartsRenderMock.mock.calls;
  const props: { metricViewData: MetricViewData } = calls[
    calls.length - 1
  ]?.[0] as {
    metricViewData: MetricViewData;
  };

  return props.metricViewData.queryConfigs.map(
    (config: MetricQueryConfigData): string => {
      return String(config.metricQueryData.filterData.aggegationType);
    },
  );
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 4; round++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

function bigNumber(container: HTMLElement): string {
  return (
    container.querySelector("div.font-bold.tabular-nums")?.textContent || ""
  ).trim();
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      ar: { translation: readDashboardLocale("ar") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  fetchResultsMock.mockReset();
  metricChartsRenderMock.mockReset();
  fetchResultsMock.mockImplementation((args: unknown) => {
    const metricViewData: MetricViewData = (
      args as { metricViewData: MetricViewData }
    ).metricViewData;

    return Promise.resolve(
      metricViewData.queryConfigs.map((): AggregatedResult => {
        return { data: BUCKETS, truncated: false } as AggregatedResult;
      }),
    );
  });

  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

afterEach(() => {
  cleanup();
});

describe("the Chart widget with a metric and no aggregation draws the metric's average", () => {
  test("it reads Avg, draws the chart and asks for no aggregation", async () => {
    const component: DashboardChartComponent = chartWith({
      title: "Requests",
      queries: [query({ metricName: "http.server.requests" })],
    });

    render(chartElement(component));

    expect(await screen.findByTestId("metric-charts")).toBeInTheDocument();
    await settle();

    expect(askedQueries()).toEqual([
      [{ metric: "http.server.requests", aggregation: "Avg" }],
    ]);
    // What the chart draws, and what its details say, is the average too.
    expect(drawnAggregations()).toEqual(["Avg"]);
    expect(document.body.textContent || "").not.toMatch(OLD_CHART_LINES);
    expect(
      screen.queryByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
    ).not.toBeInTheDocument();

    // The stored widget is left as its settings wrote it.
    expect(
      (component.arguments.metricQueryConfig as MetricQueryConfigData)
        .metricQueryData.filterData,
    ).toEqual({ metricName: "http.server.requests" });
  });

  test("each query without one is its average; one that was picked is read as picked", async () => {
    render(
      chartElement(
        chartWith({
          title: "Requests",
          queries: [
            query({ metricName: "http.server.requests" }),
            query({
              metricName: "http.server.errors",
              aggregation: MetricsAggregationType.Max,
              variable: "b",
            }),
            query({ metricName: "http.server.duration", variable: "c" }),
          ],
        }),
      ),
    );

    expect(await screen.findByTestId("metric-charts")).toBeInTheDocument();
    await settle();

    expect(askedQueries()).toEqual([
      [
        { metric: "http.server.requests", aggregation: "Avg" },
        { metric: "http.server.errors", aggregation: "Max" },
        { metric: "http.server.duration", aggregation: "Avg" },
      ],
    ]);
    expect(drawnAggregations()).toEqual(["Avg", "Max", "Avg"]);
  });

  test("a picked Sum is read as Sum", async () => {
    render(
      chartElement(
        chartWith({
          queries: [
            query({
              metricName: "http.server.requests",
              aggregation: MetricsAggregationType.Sum,
            }),
          ],
        }),
      ),
    );

    expect(await screen.findByTestId("metric-charts")).toBeInTheDocument();
    await settle();

    expect(askedQueries()).toEqual([
      [{ metric: "http.server.requests", aggregation: "Sum" }],
    ]);
  });
});

describe("the Chart widget with no metric says what it needs, under its title", () => {
  test("out of edit mode: no metric is picked yet, and nothing is read", async () => {
    render(
      chartElement(chartWith({ title: "Requests", queries: [query({})] })),
    );

    const line: HTMLElement = await screen.findByTestId(
      DASHBOARD_WIDGET_SETUP_LINE_TEST_ID,
    );
    await settle();

    expect(line).toHaveTextContent("No metric picked yet.");
    expect(screen.getByText("Requests")).toBeInTheDocument();
    expect(fetchResultsMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("metric-charts")).not.toBeInTheDocument();
    expect(document.body.textContent || "").not.toMatch(OLD_CHART_LINES);
    expect(document.body.textContent || "").not.toMatch(/click/i);
  });

  test("on the board being edited: a click, which opens its settings there", async () => {
    render(
      chartElement(chartWith({ title: "Requests", queries: [query({})] }), {
        isEditMode: true,
      }),
    );

    expect(
      await screen.findByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
    ).toHaveTextContent("Click to configure a metric");
    expect(fetchResultsMock).not.toHaveBeenCalled();
    expect(document.body.textContent || "").not.toMatch(OLD_CHART_LINES);
  });

  test("a chart with no title is named a chart, in the reader's language", async () => {
    const result: RenderResult = render(
      chartElement(chartWith({ title: "   ", queries: [query({})] })),
    );

    expect(
      await screen.findByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
    ).toHaveTextContent("No metric picked yet.");
    expect(screen.getByText("Chart")).toBeInTheDocument();

    await act(async () => {
      await i18next.changeLanguage("de");
    });
    result.rerender(
      chartElement(chartWith({ title: "", queries: [query({})] })),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
      ).toHaveTextContent(readDashboardLocale("de")["No metric picked yet."]!);
    });
    expect(
      screen.getByText(readDashboardLocale("de")["Chart"]!),
    ).toBeInTheDocument();
    expect(document.body.textContent || "").not.toContain("No metric");
  });

  test("a metric cleared after a failed read: the setup line, not the old error", async () => {
    fetchResultsMock.mockImplementation(() => {
      return Promise.reject(new Error("The metrics service did not answer."));
    });

    const picked: DashboardChartComponent = chartWith({
      title: "Requests",
      queries: [query({ metricName: "http.server.requests" })],
    });
    const result: RenderResult = render(chartElement(picked));

    expect(
      await screen.findByText("The metrics service did not answer."),
    ).toBeInTheDocument();

    result.rerender(
      chartElement(chartWith({ title: "Requests", queries: [query({})] })),
    );

    expect(
      await screen.findByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
    ).toHaveTextContent("No metric picked yet.");
    expect(
      screen.queryByText("The metrics service did not answer."),
    ).not.toBeInTheDocument();

    // Picked again, and answered: the chart, with no line and no error.
    fetchResultsMock.mockImplementation(() => {
      return Promise.resolve([{ data: BUCKETS, truncated: false }]);
    });
    result.rerender(chartElement(picked));

    expect(await screen.findByTestId("metric-charts")).toBeInTheDocument();
    expect(
      screen.queryByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("The metrics service did not answer."),
    ).not.toBeInTheDocument();
  });
});

describe("the Value widget with a metric and no aggregation shows the metric's average", () => {
  test("it reads, and shows the number an Avg widget shows", async () => {
    const averaged: RenderResult = render(
      valueElement(
        valueWith(
          query({
            metricName: "http.server.requests",
            aggregation: MetricsAggregationType.Avg,
          }),
        ),
      ),
    );

    await waitFor(() => {
      expect(bigNumber(averaged.container)).not.toBe("");
    });
    const averageShown: string = bigNumber(averaged.container);
    cleanup();
    fetchResultsMock.mockClear();

    const component: DashboardValueComponent = valueWith(
      query({ metricName: "http.server.requests" }),
    );
    const notAggregated: RenderResult = render(valueElement(component));

    await waitFor(() => {
      expect(bigNumber(notAggregated.container)).toBe(averageShown);
    });
    expect(fetchResultsMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("No data")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      (component.arguments.metricQueryConfig as MetricQueryConfigData)
        .metricQueryData.filterData,
    ).toEqual({ metricName: "http.server.requests" });
  });

  test("with no metric: says so, and reads nothing", async () => {
    render(valueElement(valueWith(query({}))));

    expect(
      await screen.findByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
    ).toHaveTextContent("No metric picked yet.");
    await settle();
    expect(fetchResultsMock).not.toHaveBeenCalled();
    expect(document.body.textContent || "").not.toMatch(/click/i);
  });

  test("with no metric, on the board being edited: a click", async () => {
    render(valueElement(valueWith(query({})), { isEditMode: true }));

    expect(
      await screen.findByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
    ).toHaveTextContent("Click to configure a metric");
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });
});
