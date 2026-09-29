import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { RenderResult, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105: the crosshair that tells a reader the Log Chart and Trace
 * Chart widgets can be dragged across.
 *
 * The widgets put a cursor-crosshair class on the box around the chart, but
 * recharts sets cursor: default inline on its own wrapper, which fills that
 * box - so over the plot, the only place a drag starts, the pointer stayed an
 * arrow. The chart root now takes the crosshair as a style, which recharts
 * spreads over its own, and only while a drag can zoom the board.
 *
 * recharts is real here. Only ResponsiveContainer is stood in for: it
 * measures its parent, which is always 0x0 in jsdom, and a 0x0 chart draws
 * nothing.
 */

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  const actual: Record<string, unknown> = jest.requireActual(
    "recharts",
  ) as Record<string, unknown>;

  return {
    ...actual,
    ResponsiveContainer: (props: { children: React.ReactElement }) => {
      return react.cloneElement(props.children, { width: 600, height: 300 });
    },
  };
});

const apiPostMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs. Dereferencing them lazily, at call time, is what makes
 * this work.
 */
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
      getFriendlyErrorMessage: (err: Error) => {
        return err.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

import DashboardLogChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardLogChartComponent";
import DashboardTraceChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceChartComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardLogChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardLogChartComponent";
import DashboardTraceChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceChartComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const COMPONENT_ID: ObjectID = new ObjectID(
  "9e9e9e9e-1111-4111-8111-9e9e9e9e9e9e",
);

// A CUSTOM range: the window never depends on the clock.
const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-28T10:00:00.000Z"),
    new Date("2026-09-28T11:00:00.000Z"),
  ),
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
    key: "histogram-widget",
    onComponentUpdate: (): void => {
      // The widget never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 640,
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

function logChart(chartType: DashboardChartType): DashboardLogChartComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.LogChart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 2,
    arguments: {
      title: "Error volume",
      chartType: chartType,
    },
  } as unknown as DashboardLogChartComponent;
}

function traceChart(
  metric: string,
  groupByAttribute?: string | undefined,
): DashboardTraceChartComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.TraceChart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 2,
    arguments: {
      title: "Checkout requests",
      metric: metric,
      groupByAttribute: groupByAttribute,
    },
  } as unknown as DashboardTraceChartComponent;
}

const LOG_BUCKETS: Array<JSONObject> = [
  { time: "2026-09-28T10:15:00.000Z", severity: "Error", count: 3 },
  { time: "2026-09-28T10:16:00.000Z", severity: "Error", count: 5 },
  { time: "2026-09-28T10:17:00.000Z", severity: "Warning", count: 2 },
];

const SINGLE_SERIES_ROWS: Array<JSONObject> = [
  { time: "2026-09-28 10:15:00", value: 30, groupValues: {} },
  { time: "2026-09-28 10:16:00", value: 50, groupValues: {} },
  { time: "2026-09-28 10:17:00", value: 40, groupValues: {} },
];

// Two hosts: a split chart, one series each.
const SPLIT_ROWS: Array<JSONObject> = [
  {
    time: "2026-09-28 10:15:00",
    value: 30,
    groupValues: { "url.host": "a.example.com" },
  },
  {
    time: "2026-09-28 10:15:00",
    value: 20,
    groupValues: { "url.host": "b.example.com" },
  },
  {
    time: "2026-09-28 10:16:00",
    value: 50,
    groupValues: { "url.host": "a.example.com" },
  },
  {
    time: "2026-09-28 10:16:00",
    value: 10,
    groupValues: { "url.host": "b.example.com" },
  },
];

interface ChartUnderTest {
  name: string;
  element: (props: DashboardBaseComponentProps) => React.ReactElement;
  answer: JSONObject;
  // The layer recharts draws the widget's marks in: the chart type drawn.
  marksSelector: string;
}

const CHARTS: Array<ChartUnderTest> = [
  {
    name: "Log Chart drawn as bars",
    element: (props: DashboardBaseComponentProps): React.ReactElement => {
      return (
        <DashboardLogChartComponentElement
          {...props}
          component={logChart(DashboardChartType.Bar)}
        />
      );
    },
    answer: { buckets: LOG_BUCKETS },
    marksSelector: ".recharts-bar",
  },
  {
    name: "Log Chart drawn as lines",
    element: (props: DashboardBaseComponentProps): React.ReactElement => {
      return (
        <DashboardLogChartComponentElement
          {...props}
          component={logChart(DashboardChartType.Line)}
        />
      );
    },
    answer: { buckets: LOG_BUCKETS },
    marksSelector: ".recharts-line",
  },
  {
    name: "Log Chart drawn as areas",
    element: (props: DashboardBaseComponentProps): React.ReactElement => {
      return (
        <DashboardLogChartComponentElement
          {...props}
          component={logChart(DashboardChartType.Area)}
        />
      );
    },
    answer: { buckets: LOG_BUCKETS },
    marksSelector: ".recharts-area",
  },
  {
    name: "Trace Chart counting spans (bars)",
    element: (props: DashboardBaseComponentProps): React.ReactElement => {
      return (
        <DashboardTraceChartComponentElement
          {...props}
          component={traceChart("count")}
        />
      );
    },
    answer: { data: SINGLE_SERIES_ROWS },
    marksSelector: ".recharts-bar",
  },
  {
    name: "Trace Chart timing one series (area)",
    element: (props: DashboardBaseComponentProps): React.ReactElement => {
      return (
        <DashboardTraceChartComponentElement
          {...props}
          component={traceChart("p95Duration")}
        />
      );
    },
    answer: { data: SINGLE_SERIES_ROWS },
    marksSelector: ".recharts-area",
  },
  {
    name: "Trace Chart timing a split (lines)",
    element: (props: DashboardBaseComponentProps): React.ReactElement => {
      return (
        <DashboardTraceChartComponentElement
          {...props}
          component={traceChart("p95Duration", "url.host")}
        />
      );
    },
    answer: { data: SPLIT_ROWS },
    marksSelector: ".recharts-line",
  },
];

beforeEach(() => {
  onSelect = getJestMockFunction();
  onReset = getJestMockFunction();
  apiPostMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe.each(CHARTS)(
  "the $name: the pointer over its plot",
  (chart: ChartUnderTest) => {
    function renderChart(
      overrides: Partial<DashboardBaseComponentProps> = {},
    ): RenderResult {
      return render(chart.element(buildBaseProps(overrides)));
    }

    // The div recharts wraps the plot in, once the widget has drawn it.
    async function chartRoot(rendered: RenderResult): Promise<HTMLElement> {
      await waitFor(() => {
        expect(
          rendered.container.querySelectorAll(".recharts-wrapper"),
        ).toHaveLength(1);
      });

      // The chart type the case names, so no chart type goes untested.
      expect(
        rendered.container.querySelector(chart.marksSelector),
      ).not.toBeNull();

      return rendered.container.querySelector(
        ".recharts-wrapper",
      ) as HTMLElement;
    }

    beforeEach(() => {
      apiPostMock.mockImplementation(() => {
        return Promise.resolve({ data: chart.answer });
      });
    });

    test("is a crosshair while a drag zooms the board, on the very element recharts styles", async () => {
      const root: HTMLElement = await chartRoot(renderChart());

      expect(root).toHaveStyle({ cursor: "crosshair" });
      // Set inline, where it outranks recharts' own cursor: default.
      expect(root.style.cursor).toBe("crosshair");
    });

    test("stays a crosshair while the board is zoomed and a double-click would reset it", async () => {
      const root: HTMLElement = await chartRoot(
        renderChart({ isDashboardTimeRangeZoomed: true }),
      );

      expect(root).toHaveStyle({ cursor: "crosshair" });
    });

    test("is recharts' own arrow in edit mode, where a drag moves the widget", async () => {
      const root: HTMLElement = await chartRoot(
        renderChart({ isEditMode: true, isDashboardTimeRangeZoomed: true }),
      );

      expect(root).toHaveStyle({ cursor: "default" });
    });

    test("is recharts' own arrow on a host that owns no time range to zoom", async () => {
      const root: HTMLElement = await chartRoot(
        renderChart({
          onDashboardTimeRangeSelect: undefined,
          onDashboardTimeRangeReset: undefined,
        }),
      );

      expect(root).toHaveStyle({ cursor: "default" });
    });

    test("turns into a crosshair when the board leaves edit mode, and back", async () => {
      const rendered: RenderResult = renderChart({ isEditMode: true });
      expect(await chartRoot(rendered)).toHaveStyle({ cursor: "default" });

      rendered.rerender(chart.element(buildBaseProps({ isEditMode: false })));
      expect(await chartRoot(rendered)).toHaveStyle({ cursor: "crosshair" });

      rendered.rerender(chart.element(buildBaseProps({ isEditMode: true })));
      expect(await chartRoot(rendered)).toHaveStyle({ cursor: "default" });
    });
  },
);
