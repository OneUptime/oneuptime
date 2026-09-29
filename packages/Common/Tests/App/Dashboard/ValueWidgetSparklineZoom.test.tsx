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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the dashboard's big-number widgets. The sparkline under
 * the number is a time series like any other panel's, so it answers to the
 * board's gestures too: a drag across it zooms the whole board to the
 * window the dragged points cover, a double-click puts the board back.
 *
 * It is a hand-drawn svg (no chart library), so the gesture is its own:
 * these tests drive it with real pointer coordinates against a laid-out
 * box, the one thing jsdom cannot provide on its own.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const fetchTimeSeriesMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs. Dereferencing them lazily, at call time, is what makes
 * this work.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<any>) => {
          return fetchResultsMock(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DataSourceQuery",
  () => {
    return {
      __esModule: true,
      default: {
        fetchTimeSeries: (...args: Array<any>) => {
          return fetchTimeSeriesMock(...args);
        },
      },
    };
  },
);

import ValueWidgetView, {
  SPARKLINE_SELECTION_TEST_ID,
  SPARKLINE_TEST_ID,
  SparklinePoint,
  SparklineSelectionWindow,
  ValueWidgetViewProps,
  getSparklineSelectionWindow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetView";
import DashboardValueComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardValueComponent";
import DashboardDataSourceValueComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceValueComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardDataSourceValueComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import DashboardValueComponent from "../../../Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const MINUTE_MS: number = 60 * 1000;

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 8, 28, 10, minute, 0));
}

// Six points five minutes apart: 10:00, 10:05 ... 10:25.
const POINTS: Array<SparklinePoint> = [0, 5, 10, 15, 20, 25].map(
  (minute: number, index: number): SparklinePoint => {
    return { timestamp: at(minute), value: 10 + index };
  },
);

/*
 * Tall enough that the layout admits the sparkline: it only does once the
 * number is already at its largest size.
 */
const baseViewProps: ValueWidgetViewProps = {
  widthInPx: 400,
  heightInPx: 320,
  isEditMode: false,
  isLoading: false,
  hasEverLoaded: true,
  error: null,
  value: 42,
  points: POINTS,
  noDataMessage: "No data for the selected time range",
  isConfigured: true,
  setupTitle: "Value",
  setupMessage: "Click to configure",
  title: "Requests",
  rawUnit: "",
  metricName: "",
  hideUnit: false,
  warningThreshold: undefined,
  criticalThreshold: undefined,
  trendDirection: undefined,
};

/*
 * jsdom lays nothing out, so the sparkline would read every pointer as
 * being over its first point. Give it a real box: 100px from the left,
 * `width` wide - and hand back the pointer x over any point.
 */
const BOX_LEFT: number = 100;
const PADDING: number = 4;

interface LaidOutSparkline {
  svg: SVGSVGElement;
  xOf: (index: number) => number;
}

function layOutSparkline(pointCount: number): LaidOutSparkline {
  const svg: SVGSVGElement = screen.getByTestId(
    SPARKLINE_TEST_ID,
  ) as unknown as SVGSVGElement;
  const width: number = Number(svg.getAttribute("width"));

  svg.getBoundingClientRect = (): DOMRect => {
    return {
      left: BOX_LEFT,
      top: 0,
      right: BOX_LEFT + width,
      bottom: 20,
      width: width,
      height: 20,
      x: BOX_LEFT,
      y: 0,
      toJSON: (): string => {
        return "";
      },
    } as DOMRect;
  };

  return {
    svg: svg,
    xOf: (index: number): number => {
      return (
        BOX_LEFT + PADDING + (index / (pointCount - 1)) * (width - PADDING * 2)
      );
    },
  };
}

function dragAcross(
  sparkline: LaidOutSparkline,
  fromIndex: number,
  toIndex: number,
): void {
  fireEvent.mouseDown(sparkline.svg, {
    clientX: sparkline.xOf(fromIndex),
    button: 0,
  });
  fireEvent.mouseMove(sparkline.svg, {
    clientX: sparkline.xOf(toIndex),
    buttons: 1,
  });
  fireEvent.mouseUp(sparkline.svg, { clientX: sparkline.xOf(toIndex) });
}

function windowsOf(mock: MockFunction): Array<[number, number]> {
  return mock.mock.calls.map((call: Array<unknown>): [number, number] => {
    return [(call[0] as Date).getTime(), (call[1] as Date).getTime()];
  });
}

afterEach(() => {
  cleanup();
});

describe("getSparklineSelectionWindow", () => {
  test("runs from the first dragged point to the end of the last one's bucket", () => {
    const selected: SparklineSelectionWindow | null =
      getSparklineSelectionWindow(POINTS, 1, 3);

    expect(selected).toEqual({ startTime: at(5), endTime: at(20) });
  });

  test("is the same window whichever way the drag went", () => {
    expect(getSparklineSelectionWindow(POINTS, 3, 1)).toEqual(
      getSparklineSelectionWindow(POINTS, 1, 3),
    );
  });

  test("a drag that never left one point is no window", () => {
    expect(getSparklineSelectionWindow(POINTS, 2, 2)).toBeNull();
  });

  test("the bucket is the smallest gap in the series, not the gap at the edge", () => {
    // A missing 10:10 bucket leaves a ten-minute hole before 10:15.
    const withGap: Array<SparklinePoint> = [0, 5, 15, 20].map(
      (minute: number): SparklinePoint => {
        return { timestamp: at(minute), value: minute };
      },
    );

    expect(getSparklineSelectionWindow(withGap, 1, 2)).toEqual({
      startTime: at(5),
      endTime: at(20),
    });
  });

  test("points out of time order widen the window but never invert it", () => {
    const shuffled: Array<SparklinePoint> = [
      { timestamp: at(10), value: 1 },
      { timestamp: at(0), value: 2 },
      { timestamp: at(5), value: 3 },
      { timestamp: at(20), value: 4 },
      { timestamp: at(15), value: 5 },
    ];

    expect(getSparklineSelectionWindow(shuffled, 0, 2)).toEqual({
      startTime: at(0),
      endTime: at(15),
    });
  });

  test("ignores points whose time is not a date", () => {
    const broken: Array<SparklinePoint> = [
      { timestamp: at(0), value: 1 },
      { timestamp: new Date("not a date"), value: 2 },
      { timestamp: at(10), value: 3 },
    ];

    expect(getSparklineSelectionWindow(broken, 0, 2)).toEqual({
      startTime: at(0),
      endTime: at(20),
    });
  });

  test("points that all share one instant are no window worth zooming to", () => {
    const sameInstant: Array<SparklinePoint> = [
      { timestamp: at(5), value: 1 },
      { timestamp: at(5), value: 2 },
    ];

    expect(getSparklineSelectionWindow(sameInstant, 0, 1)).toBeNull();
  });

  test("indexes past either end are clamped to the series", () => {
    expect(getSparklineSelectionWindow(POINTS, -3, 99)).toEqual({
      startTime: at(0),
      endTime: at(30),
    });
  });
});

describe("the value widget's sparkline: drag-to-zoom", () => {
  let onSelect: MockFunction;
  let onReset: MockFunction;

  beforeEach(() => {
    onSelect = getJestMockFunction();
    onReset = getJestMockFunction();
  });

  function renderView(overrides: Partial<ValueWidgetViewProps> = {}): void {
    render(
      <ValueWidgetView
        {...baseViewProps}
        onTimeRangeSelect={
          onSelect as unknown as (startTime: Date, endTime: Date) => void
        }
        {...overrides}
      />,
    );
  }

  test("a drag across points hands over the window they cover", () => {
    renderView();
    const sparkline: LaidOutSparkline = layOutSparkline(POINTS.length);

    dragAcross(sparkline, 1, 3);

    expect(windowsOf(onSelect)).toEqual([[at(5).getTime(), at(20).getTime()]]);
  });

  test("a right-to-left drag is the same window", () => {
    renderView();
    const sparkline: LaidOutSparkline = layOutSparkline(POINTS.length);

    dragAcross(sparkline, 3, 1);

    expect(windowsOf(onSelect)).toEqual([[at(5).getTime(), at(20).getTime()]]);
  });

  test("a plain click on the line is not a zoom", () => {
    renderView();
    const sparkline: LaidOutSparkline = layOutSparkline(POINTS.length);

    fireEvent.mouseDown(sparkline.svg, {
      clientX: sparkline.xOf(2),
      button: 0,
    });
    fireEvent.mouseUp(sparkline.svg, { clientX: sparkline.xOf(2) });

    expect(onSelect).not.toHaveBeenCalled();
  });

  test("the point under the pointer at release wins over the last move seen", () => {
    renderView();
    const sparkline: LaidOutSparkline = layOutSparkline(POINTS.length);

    fireEvent.mouseDown(sparkline.svg, {
      clientX: sparkline.xOf(0),
      button: 0,
    });
    fireEvent.mouseMove(sparkline.svg, {
      clientX: sparkline.xOf(2),
      buttons: 1,
    });
    // Released further right than the last move the line handled.
    fireEvent.mouseUp(sparkline.svg, { clientX: sparkline.xOf(4) });

    expect(windowsOf(onSelect)).toEqual([[at(0).getTime(), at(25).getTime()]]);
  });

  test("a drag released outside the line still zooms, once", () => {
    renderView();
    const sparkline: LaidOutSparkline = layOutSparkline(POINTS.length);

    fireEvent.mouseDown(sparkline.svg, {
      clientX: sparkline.xOf(1),
      button: 0,
    });
    fireEvent.mouseMove(sparkline.svg, {
      clientX: sparkline.xOf(5),
      buttons: 1,
    });
    fireEvent.mouseLeave(sparkline.svg);
    fireEvent.mouseUp(window);
    fireEvent.mouseUp(window);

    expect(windowsOf(onSelect)).toEqual([[at(5).getTime(), at(30).getTime()]]);
  });

  test("a drag whose button came up out of earshot is abandoned", () => {
    renderView();
    const sparkline: LaidOutSparkline = layOutSparkline(POINTS.length);

    fireEvent.mouseDown(sparkline.svg, {
      clientX: sparkline.xOf(1),
      button: 0,
    });
    // The pointer comes back with no button held.
    fireEvent.mouseMove(sparkline.svg, {
      clientX: sparkline.xOf(4),
      buttons: 0,
    });
    fireEvent.mouseUp(sparkline.svg, { clientX: sparkline.xOf(4) });

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId(SPARKLINE_SELECTION_TEST_ID)).toBeNull();
  });

  test("the band follows the drag and is gone once it lands", () => {
    renderView();
    const sparkline: LaidOutSparkline = layOutSparkline(POINTS.length);

    fireEvent.mouseDown(sparkline.svg, {
      clientX: sparkline.xOf(1),
      button: 0,
    });
    expect(screen.queryByTestId(SPARKLINE_SELECTION_TEST_ID)).toBeNull();

    fireEvent.mouseMove(sparkline.svg, {
      clientX: sparkline.xOf(3),
      buttons: 1,
    });
    const band: Element = screen.getByTestId(SPARKLINE_SELECTION_TEST_ID);
    expect(Number(band.getAttribute("width"))).toBeGreaterThan(0);

    fireEvent.mouseUp(sparkline.svg, { clientX: sparkline.xOf(3) });

    expect(screen.queryByTestId(SPARKLINE_SELECTION_TEST_ID)).toBeNull();
  });

  test("the hover read-out keeps naming the point the drag is on", () => {
    renderView();
    const sparkline: LaidOutSparkline = layOutSparkline(POINTS.length);

    fireEvent.mouseDown(sparkline.svg, {
      clientX: sparkline.xOf(0),
      button: 0,
    });
    fireEvent.mouseMove(sparkline.svg, {
      clientX: sparkline.xOf(3),
      buttons: 1,
    });

    // Point 3's value replaces the aggregate while the pointer is on it.
    expect(screen.getByText("13")).toBeInTheDocument();
  });

  test("without a handler the line only inspects: no band, no zoom", () => {
    renderView({ onTimeRangeSelect: undefined });
    const sparkline: LaidOutSparkline = layOutSparkline(POINTS.length);

    dragAcross(sparkline, 1, 3);

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId(SPARKLINE_SELECTION_TEST_ID)).toBeNull();
    expect(sparkline.svg).not.toHaveClass("select-none");
  });

  test("a double-click resets when a reset is offered", () => {
    renderView({
      onTimeRangeReset: onReset as unknown as () => void,
    });
    const sparkline: LaidOutSparkline = layOutSparkline(POINTS.length);

    fireEvent.doubleClick(sparkline.svg);

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("a double-click is harmless when there is nothing to reset", () => {
    renderView();
    const sparkline: LaidOutSparkline = layOutSparkline(POINTS.length);

    fireEvent.doubleClick(sparkline.svg);

    expect(onSelect).not.toHaveBeenCalled();
  });

  test("the empty state a zoom into a quiet stretch lands on takes the double-click", () => {
    renderView({
      value: null,
      points: [],
      onTimeRangeReset: onReset as unknown as () => void,
    });

    fireEvent.doubleClick(
      screen.getByText("No data for the selected time range"),
    );

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

/*
 * The two hosts: the metric Value widget and the Data Source Value widget.
 * Each gates the board's gestures the same way every time-series widget
 * does, and re-queries when the board's zoomed range comes back down.
 */

const COMPONENT_ID: ObjectID = new ObjectID(
  "12121212-1111-4111-8111-121212121212",
);

const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(at(0), at(30)),
};

const ZOOMED_BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(at(5), at(20)),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

const SERIES: Array<{ timestamp: Date; value: number }> = POINTS.map(
  (point: SparklinePoint): { timestamp: Date; value: number } => {
    return { timestamp: point.timestamp, value: point.value };
  },
);

let hostSelect: MockFunction;
let hostReset: MockFunction;

function buildHostProps(
  overrides: Partial<DashboardBaseComponentProps> = {},
): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "value-widget",
    onComponentUpdate: (): void => {
      // The widget never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 400,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: BOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    onDashboardTimeRangeSelect: hostSelect as unknown as (
      startTime: Date,
      endTime: Date,
    ) => void,
    onDashboardTimeRangeReset: hostReset as unknown as () => void,
    isDashboardTimeRangeZoomed: false,
    ...overrides,
  };
}

function buildValueComponent(): DashboardValueComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.Value,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 3,
    heightInDashboardUnits: 2,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: {
      title: "Requests",
      metricQueryConfig: {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: "http.requests",
            aggegationType: MetricsAggregationType.Sum,
          },
        },
      },
    },
  } as unknown as DashboardValueComponent;
}

function buildDataSourceValueComponent(): DashboardDataSourceValueComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.DataSourceValue,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 3,
    heightInDashboardUnits: 2,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: {
      title: "Queue depth",
      query: {
        id: "q1",
        dataSourceId: "34343434-3434-4434-8434-343434343434",
        query: "sum(queue_depth)",
      },
    },
  } as unknown as DashboardDataSourceValueComponent;
}

interface HostUnderTest {
  name: string;
  render: (overrides?: Partial<DashboardBaseComponentProps>) => RenderResult;
  rerender: (
    rendered: RenderResult,
    overrides: Partial<DashboardBaseComponentProps>,
  ) => void;
  lastFetchWindow: () => [Date, Date] | undefined;
}

const HOSTS: Array<HostUnderTest> = [
  {
    name: "metric Value widget",
    render: (
      overrides: Partial<DashboardBaseComponentProps> = {},
    ): RenderResult => {
      return render(
        <DashboardValueComponentElement
          {...buildHostProps(overrides)}
          component={buildValueComponent()}
        />,
      );
    },
    rerender: (
      rendered: RenderResult,
      overrides: Partial<DashboardBaseComponentProps>,
    ): void => {
      rendered.rerender(
        <DashboardValueComponentElement
          {...buildHostProps(overrides)}
          component={buildValueComponent()}
        />,
      );
    },
    lastFetchWindow: (): [Date, Date] | undefined => {
      const calls: Array<Array<unknown>> = fetchResultsMock.mock.calls;
      const data: MetricViewData | undefined = (
        calls[calls.length - 1]?.[0] as
          | { metricViewData: MetricViewData }
          | undefined
      )?.metricViewData;
      return data?.startAndEndDate
        ? [data.startAndEndDate.startValue, data.startAndEndDate.endValue]
        : undefined;
    },
  },
  {
    name: "Data Source Value widget",
    render: (
      overrides: Partial<DashboardBaseComponentProps> = {},
    ): RenderResult => {
      return render(
        <DashboardDataSourceValueComponentElement
          {...buildHostProps(overrides)}
          component={buildDataSourceValueComponent()}
        />,
      );
    },
    rerender: (
      rendered: RenderResult,
      overrides: Partial<DashboardBaseComponentProps>,
    ): void => {
      rendered.rerender(
        <DashboardDataSourceValueComponentElement
          {...buildHostProps(overrides)}
          component={buildDataSourceValueComponent()}
        />,
      );
    },
    lastFetchWindow: (): [Date, Date] | undefined => {
      const calls: Array<Array<unknown>> = fetchTimeSeriesMock.mock.calls;
      const args: { startDate: Date; endDate: Date } | undefined = calls[
        calls.length - 1
      ]?.[0] as { startDate: Date; endDate: Date } | undefined;
      return args ? [args.startDate, args.endDate] : undefined;
    },
  },
];

describe.each(HOSTS)("the $name on a board", (host: HostUnderTest) => {
  beforeEach(() => {
    hostSelect = getJestMockFunction();
    hostReset = getJestMockFunction();
    fetchResultsMock.mockReset();
    fetchTimeSeriesMock.mockReset();
    fetchResultsMock.mockImplementation(() => {
      return Promise.resolve([{ data: SERIES }]);
    });
    fetchTimeSeriesMock.mockImplementation(() => {
      return Promise.resolve({ data: SERIES });
    });
  });

  test("a drag across the sparkline zooms the board, not the widget", async () => {
    host.render();
    await screen.findByTestId(SPARKLINE_TEST_ID);
    const sparkline: LaidOutSparkline = layOutSparkline(SERIES.length);

    dragAcross(sparkline, 1, 3);

    expect(windowsOf(hostSelect)).toEqual([
      [at(5).getTime(), at(20).getTime()],
    ]);
    // Still on the board's own window until the board says otherwise.
    expect(host.lastFetchWindow()).toEqual([at(0), at(30)]);
  });

  test("the zoomed range coming back down re-queries for that window", async () => {
    const rendered: RenderResult = host.render();
    await screen.findByTestId(SPARKLINE_TEST_ID);

    host.rerender(rendered, {
      dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
      isDashboardTimeRangeZoomed: true,
    });

    await waitFor(() => {
      expect(host.lastFetchWindow()).toEqual([at(5), at(20)]);
    });
  });

  test("a double-click resets the board only while it is zoomed", async () => {
    const rendered: RenderResult = host.render();
    await screen.findByTestId(SPARKLINE_TEST_ID);

    fireEvent.doubleClick(screen.getByTestId(SPARKLINE_TEST_ID));
    expect(hostReset).not.toHaveBeenCalled();

    host.rerender(rendered, { isDashboardTimeRangeZoomed: true });
    fireEvent.doubleClick(screen.getByTestId(SPARKLINE_TEST_ID));

    expect(hostReset).toHaveBeenCalledTimes(1);
  });

  test("edit mode offers neither gesture", async () => {
    host.render({ isEditMode: true, isDashboardTimeRangeZoomed: true });
    await screen.findByTestId(SPARKLINE_TEST_ID);
    const sparkline: LaidOutSparkline = layOutSparkline(SERIES.length);

    dragAcross(sparkline, 1, 3);
    fireEvent.doubleClick(sparkline.svg);

    expect(hostSelect).not.toHaveBeenCalled();
    expect(hostReset).not.toHaveBeenCalled();
  });

  test("a zoom that finds nothing can be undone from the empty state", async () => {
    fetchResultsMock.mockImplementation(() => {
      return Promise.resolve([{ data: [] }]);
    });
    fetchTimeSeriesMock.mockImplementation(() => {
      return Promise.resolve({ data: [] });
    });
    host.render({
      dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
      isDashboardTimeRangeZoomed: true,
    });

    fireEvent.doubleClick(
      await screen.findByText("No data for the selected time range"),
    );

    expect(hostReset).toHaveBeenCalledTimes(1);
  });

  test("the window a drag hands up is at the sparkline's own grain", async () => {
    host.render();
    await screen.findByTestId(SPARKLINE_TEST_ID);
    const sparkline: LaidOutSparkline = layOutSparkline(SERIES.length);

    dragAcross(sparkline, 4, 5);

    const [startMs, endMs] = windowsOf(hostSelect)[0]!;
    // Two five-minute points: the window is ten minutes wide.
    expect(endMs - startMs).toBe(10 * MINUTE_MS);
  });
});
