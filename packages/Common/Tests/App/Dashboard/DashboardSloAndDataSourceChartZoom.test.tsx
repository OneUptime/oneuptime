import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  RenderResult,
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on two more dashboard time-series widgets: the SLO history
 * chart (a LineChartElement of its own) and the Data Source chart (a
 * MetricCharts stack over an external query). Both now take the board's
 * gestures the way the metric chart widget does:
 *
 *   - a drag hands the window UP to the dashboard shell; the widget never
 *     narrows itself, and refetches only when the board's new range comes
 *     back down;
 *   - the double-click reset is handed over only while the board is zoomed;
 *   - edit mode offers neither.
 *
 * The chart layers are stood in for by components that resolve their zoom
 * exactly the way the real chart wrappers do (resolveChartTimeRangeZoom
 * over the enclosing page's zoom), so what is asserted is what a drag or a
 * double-click on the real chart would reach - including that a zoom
 * offered by a surrounding page can never leak onto these charts.
 */

const DRAG_START: Date = new Date("2026-09-28T10:20:00.000Z");
const DRAG_END: Date = new Date("2026-09-28T10:35:00.000Z");

const lineChartRenderMock: MockFunction = getJestMockFunction();
const metricChartsRenderMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  const zoomContext: ZoomContextModule = jest.requireActual(
    "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
  ) as ZoomContextModule;

  return {
    __esModule: true,
    default: (props: ZoomableChartStubProps): React.ReactElement => {
      lineChartRenderMock(props);
      return react.createElement(ZoomableChartStub, {
        ...props,
        testId: "line-chart",
        zoomContext: zoomContext,
      });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    const zoomContext: ZoomContextModule = jest.requireActual(
      "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
    ) as ZoomContextModule;

    return {
      __esModule: true,
      default: (props: ZoomableChartStubProps): React.ReactElement => {
        metricChartsRenderMock(props);
        return react.createElement(ZoomableChartStub, {
          ...props,
          testId: "metric-charts",
          zoomContext: zoomContext,
        });
      },
    };
  },
);

const fetchTimeSeriesMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DataSourceQuery",
  () => {
    return {
      __esModule: true,
      default: {
        fetchTimeSeries: (...args: Array<any>) => {
          return fetchTimeSeriesMock(...args);
        },
        getAttributeKeys: () => {
          return [];
        },
      },
    };
  },
);

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<any>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

import DashboardSloComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSloComponent";
import DashboardDataSourceChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceChartComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardDataSourceChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceChartComponent";
import DashboardSloComponent, {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  ResolveChartTimeRangeZoomInput,
  TimeRangeZoomScope,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";

interface ZoomContextModule {
  useChartTimeRangeZoom: () => ChartTimeRangeZoomContextValue | null;
  resolveChartTimeRangeZoom: (
    input: ResolveChartTimeRangeZoomInput,
  ) => ChartTimeRangeZoomHandlers;
}

interface ZoomableChartStubProps {
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  disableTimeRangeZoom?: boolean | undefined;
  testId?: string | undefined;
  zoomContext?: ZoomContextModule | undefined;
}

/*
 * A chart that zooms the way the real wrappers do: its host's handlers when
 * it has any, else the enclosing page's (time axis), unless disabled. Its
 * two buttons stand for a drag across the plot and a double-click on it.
 */
function ZoomableChartStub(props: ZoomableChartStubProps): React.ReactElement {
  const zoomContext: ZoomContextModule = props.zoomContext!;
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    zoomContext.useChartTimeRangeZoom();
  const zoom: ChartTimeRangeZoomHandlers =
    zoomContext.resolveChartTimeRangeZoom({
      onTimeRangeSelect: props.onTimeRangeSelect,
      onTimeRangeReset: props.onTimeRangeReset,
      isTimeAxis: true,
      disableTimeRangeZoom: props.disableTimeRangeZoom,
      pageZoom: pageZoom,
    });
  const testId: string = props.testId || "chart";

  return (
    <div
      data-testid={testId}
      data-can-zoom={String(Boolean(zoom.onTimeRangeSelect))}
      data-can-reset={String(Boolean(zoom.onTimeRangeReset))}
    >
      <button
        type="button"
        data-testid={`${testId}-drag`}
        onClick={() => {
          zoom.onTimeRangeSelect?.(DRAG_START, DRAG_END);
        }}
      />
      <button
        type="button"
        data-testid={`${testId}-double-click`}
        onClick={() => {
          zoom.onTimeRangeReset?.();
        }}
      />
    </div>
  );
}

const COMPONENT_ID: ObjectID = new ObjectID(
  "66666666-1111-4111-8111-666666666666",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SLO_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const DASHBOARD_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

const BOARD_START: Date = new Date("2026-09-26T10:00:00.000Z");
const BOARD_END: Date = new Date("2026-09-28T10:00:00.000Z");

/*
 * Two days: the SLO chart aggregates that at thirty minutes, so a zoom into
 * fifteen of them asks for five-minute buckets instead - the part of "the
 * chart shows the zoomed window" that lives server-side.
 */
const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(BOARD_START, BOARD_END),
};

const ZOOMED_BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(DRAG_START, DRAG_END),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

let onSelect: MockFunction;
let onReset: MockFunction;

function buildBaseProps(
  overrides: Partial<DashboardBaseComponentProps> = {},
): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "time-series-widget",
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
    onDashboardTimeRangeSelect: onSelect as unknown as (
      startTime: Date,
      endTime: Date,
    ) => void,
    onDashboardTimeRangeReset: onReset as unknown as () => void,
    isDashboardTimeRangeZoomed: false,
    ...overrides,
  };
}

function buildSloComponent(): DashboardSloComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.Slo,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 4,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 2,
    minHeightInDashboardUnits: 2,
    arguments: {
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Chart,
    },
  } as unknown as DashboardSloComponent;
}

function buildDataSourceChartComponent(): DashboardDataSourceChartComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.DataSourceChart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 2,
    arguments: {
      chartTitle: "Queue depth",
      chartType: DashboardChartType.Line,
      queries: [
        {
          id: "q1",
          dataSourceId: "99999999-9999-4999-8999-999999999999",
          query: "sum(queue_depth)",
        },
      ],
    },
  } as unknown as DashboardDataSourceChartComponent;
}

function buildSlo(): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = SLO_ID.toString();
  slo.name = "Checkout availability";
  slo.targetPercentage = 99.9;
  slo.currentSliPercentage = 99.95;
  slo.sloStatus = SloStatus.Healthy;
  return slo;
}

const HISTORY: AggregatedResult = {
  data: [
    { timestamp: new Date("2026-09-28T09:00:00.000Z"), value: 99.9 },
    { timestamp: new Date("2026-09-28T09:05:00.000Z"), value: 99.8 },
  ],
} as unknown as AggregatedResult;

interface CapturedAggregateBy {
  startTimestamp: Date;
  endTimestamp: Date;
  aggregationInterval: AggregationInterval;
}

function lastAggregateBy(): CapturedAggregateBy {
  const calls: Array<Array<unknown>> = aggregateMock.mock.calls;
  return (calls[calls.length - 1]?.[0] as { aggregateBy: CapturedAggregateBy })
    .aggregateBy;
}

interface CapturedFetchTimeSeries {
  startDate: Date;
  endDate: Date;
}

function lastFetchTimeSeries(): CapturedFetchTimeSeries {
  const calls: Array<Array<unknown>> = fetchTimeSeriesMock.mock.calls;
  return calls[calls.length - 1]?.[0] as CapturedFetchTimeSeries;
}

function renderSlo(
  overrides: Partial<DashboardBaseComponentProps> = {},
): RenderResult {
  return render(
    <DashboardSloComponentElement
      {...buildBaseProps(overrides)}
      component={buildSloComponent()}
    />,
  );
}

function renderDataSourceChart(
  overrides: Partial<DashboardBaseComponentProps> = {},
): RenderResult {
  return render(
    <DashboardDataSourceChartComponentElement
      {...buildBaseProps(overrides)}
      component={buildDataSourceChartComponent()}
    />,
  );
}

beforeEach(() => {
  onSelect = getJestMockFunction();
  onReset = getJestMockFunction();
  lineChartRenderMock.mockReset();
  metricChartsRenderMock.mockReset();
  getItemMock.mockReset();
  getListMock.mockReset();
  aggregateMock.mockReset();
  fetchTimeSeriesMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  getItemMock.mockImplementation(() => {
    return Promise.resolve(buildSlo());
  });
  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: [buildSlo()], count: 1, skip: 0, limit: 1 });
  });
  aggregateMock.mockImplementation(() => {
    return Promise.resolve(HISTORY);
  });
  fetchTimeSeriesMock.mockImplementation(() => {
    return Promise.resolve({
      data: [
        { timestamp: new Date("2026-09-28T09:00:00.000Z"), value: 4 },
        { timestamp: new Date("2026-09-28T09:05:00.000Z"), value: 6 },
      ],
    });
  });
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("SLO chart widget: board-wide drag-to-zoom", () => {
  test("a drag hands the window to the board and does not retime the widget on its own", async () => {
    renderSlo();
    await screen.findByTestId("line-chart");
    const aggregateCallsBeforeDrag: number = aggregateMock.mock.calls.length;

    fireEvent.click(screen.getByTestId("line-chart-drag"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]).toEqual([DRAG_START, DRAG_END]);

    await act(async () => {
      await Promise.resolve();
    });
    expect(aggregateMock.mock.calls.length).toBe(aggregateCallsBeforeDrag);
  });

  test("the chart is handed the board's gestures explicitly, and is not disabled", async () => {
    renderSlo();
    await screen.findByTestId("line-chart");

    const props: ZoomableChartStubProps = lineChartRenderMock.mock.calls[
      lineChartRenderMock.mock.calls.length - 1
    ]![0] as ZoomableChartStubProps;
    expect(props.onTimeRangeSelect).toBe(onSelect);
    expect(props.onTimeRangeReset).toBeUndefined();
    expect(props.disableTimeRangeZoom).toBe(false);
  });

  test("the reset is offered only once the board is zoomed, and hands the undo to the board", async () => {
    const rendered: RenderResult = renderSlo();
    await screen.findByTestId("line-chart");

    expect(screen.getByTestId("line-chart")).toHaveAttribute(
      "data-can-reset",
      "false",
    );
    fireEvent.click(screen.getByTestId("line-chart-double-click"));
    expect(onReset).not.toHaveBeenCalled();

    rendered.rerender(
      <DashboardSloComponentElement
        {...buildBaseProps({
          dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
          isDashboardTimeRangeZoomed: true,
        })}
        component={buildSloComponent()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toHaveAttribute(
        "data-can-reset",
        "true",
      );
    });
    fireEvent.click(screen.getByTestId("line-chart-double-click"));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test("the zoomed range coming back down refetches the history for that window, at a finer interval", async () => {
    const rendered: RenderResult = renderSlo();
    await screen.findByTestId("line-chart");

    expect(lastAggregateBy().startTimestamp).toEqual(BOARD_START);
    expect(lastAggregateBy().aggregationInterval).toBe(
      AggregationInterval.ThirtyMinutes,
    );

    rendered.rerender(
      <DashboardSloComponentElement
        {...buildBaseProps({
          dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
          isDashboardTimeRangeZoomed: true,
        })}
        component={buildSloComponent()}
      />,
    );

    await waitFor(() => {
      expect(lastAggregateBy().startTimestamp).toEqual(DRAG_START);
    });
    expect(lastAggregateBy().endTimestamp).toEqual(DRAG_END);
    expect(lastAggregateBy().aggregationInterval).toBe(
      AggregationInterval.FiveMinutes,
    );
  });

  test("a zoom that finds no history can be undone from the empty state", async () => {
    aggregateMock.mockImplementation(() => {
      return Promise.resolve({ data: [] });
    });
    renderSlo({
      dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
      isDashboardTimeRangeZoomed: true,
    });

    fireEvent.doubleClick(
      await screen.findByText(/No history for the selected time range/),
    );

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test("the empty state ignores a double-click while the board is not zoomed", async () => {
    aggregateMock.mockImplementation(() => {
      return Promise.resolve({ data: [] });
    });
    renderSlo();

    fireEvent.doubleClick(
      await screen.findByText(/No history for the selected time range/),
    );

    expect(onReset).not.toHaveBeenCalled();
  });

  test("edit mode offers no zoom, and no page zoom can stand in for it", async () => {
    const pageRangeChange: MockFunction = getJestMockFunction();

    render(
      <TimeRangeZoomScope
        timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onTimeRangeChange={
          pageRangeChange as unknown as (
            range: RangeStartAndEndDateTime,
          ) => void
        }
      >
        <DashboardSloComponentElement
          {...buildBaseProps({
            isEditMode: true,
            isDashboardTimeRangeZoomed: true,
          })}
          component={buildSloComponent()}
        />
      </TimeRangeZoomScope>,
    );
    await screen.findByTestId("line-chart");

    expect(screen.getByTestId("line-chart")).toHaveAttribute(
      "data-can-zoom",
      "false",
    );
    fireEvent.click(screen.getByTestId("line-chart-drag"));
    fireEvent.click(screen.getByTestId("line-chart-double-click"));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    expect(pageRangeChange).not.toHaveBeenCalled();
  });

  test("a host that owns no range leaves the chart inert even under a zooming page", async () => {
    const pageRangeChange: MockFunction = getJestMockFunction();

    render(
      <TimeRangeZoomScope
        timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onTimeRangeChange={
          pageRangeChange as unknown as (
            range: RangeStartAndEndDateTime,
          ) => void
        }
      >
        <DashboardSloComponentElement
          {...buildBaseProps({
            onDashboardTimeRangeSelect: undefined,
            onDashboardTimeRangeReset: undefined,
          })}
          component={buildSloComponent()}
        />
      </TimeRangeZoomScope>,
    );
    await screen.findByTestId("line-chart");

    fireEvent.click(screen.getByTestId("line-chart-drag"));

    expect(pageRangeChange).not.toHaveBeenCalled();
  });
});

describe("SLO chart widget on a public dashboard", () => {
  test("a zoom reaches the public history endpoint with the zoomed window", async () => {
    const historyRequests: Array<JSONObject> = [];
    const context: PublicDashboardContext = {
      dashboardId: DASHBOARD_ID,
      apiUrl: {
        toString: (): string => {
          return "http://localhost/public-dashboard-api";
        },
      },
      postJSON: (route: string, body: JSONObject) => {
        if (route.startsWith("/slo-history-aggregate/")) {
          historyRequests.push(body);
        }
        return Promise.resolve({
          data: {
            data: [
              { timestamp: "2026-09-28T10:20:00.000Z", value: 99.9 },
              { timestamp: "2026-09-28T10:25:00.000Z", value: 99.8 },
            ],
          },
        } as unknown as HTTPResponse<JSONObject>);
      },
    } as unknown as PublicDashboardContext;
    setPublicDashboardContext(context);
    // No session on a public dashboard, so no current project.
    getCurrentProjectIdMock.mockReturnValue(null);

    type WindowOfFunction = (body: JSONObject | undefined) => Array<string>;
    const windowOf: WindowOfFunction = (
      body: JSONObject | undefined,
    ): Array<string> => {
      const aggregateBy: JSONObject = JSONFunctions.deserialize(
        body!["aggregateBy"] as JSONObject,
      ) as JSONObject;
      return [
        new Date(aggregateBy["startTimestamp"] as string).toISOString(),
        new Date(aggregateBy["endTimestamp"] as string).toISOString(),
      ];
    };

    const rendered: RenderResult = render(
      <DashboardSloComponentElement
        {...buildBaseProps()}
        component={buildSloComponent()}
      />,
    );
    await screen.findByTestId("line-chart");

    expect(windowOf(historyRequests[historyRequests.length - 1])).toEqual([
      BOARD_START.toISOString(),
      BOARD_END.toISOString(),
    ]);

    // The drag goes to the board, which is what owns the public range too.
    fireEvent.click(screen.getByTestId("line-chart-drag"));
    expect(onSelect.mock.calls[0]).toEqual([DRAG_START, DRAG_END]);

    rendered.rerender(
      <DashboardSloComponentElement
        {...buildBaseProps({
          dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
          isDashboardTimeRangeZoomed: true,
        })}
        component={buildSloComponent()}
      />,
    );

    /*
     * The public policy accepts any non-inverted window (clamped to 400
     * days), so the zoomed one travels as is.
     */
    await waitFor(() => {
      expect(windowOf(historyRequests[historyRequests.length - 1])).toEqual([
        DRAG_START.toISOString(),
        DRAG_END.toISOString(),
      ]);
    });
  });
});

describe("Data Source chart widget: board-wide drag-to-zoom", () => {
  test("a drag hands the window to the board; the widget waits for the board's range", async () => {
    renderDataSourceChart();
    await screen.findByTestId("metric-charts");
    const fetchesBeforeDrag: number = fetchTimeSeriesMock.mock.calls.length;

    fireEvent.click(screen.getByTestId("metric-charts-drag"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]).toEqual([DRAG_START, DRAG_END]);

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchTimeSeriesMock.mock.calls.length).toBe(fetchesBeforeDrag);
  });

  test("the reset is offered only once the board is zoomed", async () => {
    const rendered: RenderResult = renderDataSourceChart();
    await screen.findByTestId("metric-charts");

    expect(screen.getByTestId("metric-charts")).toHaveAttribute(
      "data-can-reset",
      "false",
    );

    rendered.rerender(
      <DashboardDataSourceChartComponentElement
        {...buildBaseProps({ isDashboardTimeRangeZoomed: true })}
        component={buildDataSourceChartComponent()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toHaveAttribute(
        "data-can-reset",
        "true",
      );
    });
    fireEvent.click(screen.getByTestId("metric-charts-double-click"));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test("the zoomed range coming back down re-queries the data source for that window", async () => {
    const rendered: RenderResult = renderDataSourceChart();
    await screen.findByTestId("metric-charts");

    expect(lastFetchTimeSeries().startDate).toEqual(BOARD_START);

    rendered.rerender(
      <DashboardDataSourceChartComponentElement
        {...buildBaseProps({
          dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
          isDashboardTimeRangeZoomed: true,
        })}
        component={buildDataSourceChartComponent()}
      />,
    );

    await waitFor(() => {
      expect(lastFetchTimeSeries().startDate).toEqual(DRAG_START);
    });
    expect(lastFetchTimeSeries().endDate).toEqual(DRAG_END);
  });

  test("hands MetricCharts the board's own handlers, like the metric chart widget", async () => {
    renderDataSourceChart({ isDashboardTimeRangeZoomed: true });
    await screen.findByTestId("metric-charts");

    const props: ZoomableChartStubProps = metricChartsRenderMock.mock.calls[
      metricChartsRenderMock.mock.calls.length - 1
    ]![0] as ZoomableChartStubProps;
    expect(props.onTimeRangeSelect).toBe(onSelect);
    expect(props.onTimeRangeReset).toBe(onReset);
  });

  test("edit mode offers neither gesture", async () => {
    renderDataSourceChart({
      isEditMode: true,
      isDashboardTimeRangeZoomed: true,
    });
    await screen.findByTestId("metric-charts");

    fireEvent.click(screen.getByTestId("metric-charts-drag"));
    fireEvent.click(screen.getByTestId("metric-charts-double-click"));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.getByTestId("metric-charts")).toHaveAttribute(
      "data-can-zoom",
      "false",
    );
  });
});
