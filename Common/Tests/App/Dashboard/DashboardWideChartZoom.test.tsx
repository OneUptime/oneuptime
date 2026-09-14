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
 * Issue #3530: drag-selecting a window on a dashboard time-series panel is a
 * statement about the whole board, not about that one panel — the same way
 * filtering works in Traces and Logs. The widget therefore hands the
 * selected window UP to the dashboard shell and lets the new board-wide
 * range come back down as a prop, rather than narrowing itself and leaving
 * every neighbouring panel showing a different hour.
 *
 * Double-clicking a panel is the way back out, and it must be inert while
 * there is nothing to undo.
 *
 * The widget-local fallback (no shell callbacks) is a separate contract and
 * is covered by DashboardChartWidgetZoom.test.tsx.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const metricChartsRenderMock: MockFunction = getJestMockFunction();
const investigationDrawerRenderMock: MockFunction = getJestMockFunction();

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
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

/*
 * The widget's job under test is which window it ASKS for and which
 * affordances it hands down; a real recharts surface in jsdom would test
 * neither.
 */
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

// The drawer itself pulls in the whole telemetry stack; only its mounting matters here.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        investigationDrawerRenderMock(props);
        return React.createElement(
          "div",
          { "data-testid": "investigation-drawer" },
          "drawer",
        );
      },
    };
  },
);

import DashboardChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardChartComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const COMPONENT_ID: ObjectID = new ObjectID(
  "33333333-1111-4111-8111-333333333333",
);

const BOARD_START: Date = new Date("2026-08-20T09:00:00.000Z");
const BOARD_END: Date = new Date("2026-08-20T10:00:00.000Z");
const DRAG_START: Date = new Date("2026-08-20T09:20:00.000Z");
const DRAG_END: Date = new Date("2026-08-20T09:35:00.000Z");

/*
 * A CUSTOM range pins the window to fixed instants — a relative range
 * would resolve against the wall clock and make the window assertions
 * untestable.
 */
const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(BOARD_START, BOARD_END),
};

/** What the shell hands back down once the drag has retimed the board. */
const ZOOMED_BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(DRAG_START, DRAG_END),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

let onDashboardTimeRangeSelectMock: MockFunction;
let onDashboardTimeRangeResetMock: MockFunction;

function buildBaseProps(
  overrides: Partial<DashboardBaseComponentProps> = {},
): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "chart-widget",
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
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: BOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    onDashboardTimeRangeSelect: onDashboardTimeRangeSelectMock as unknown as (
      startTime: Date,
      endTime: Date,
    ) => void,
    onDashboardTimeRangeReset:
      onDashboardTimeRangeResetMock as unknown as () => void,
    isDashboardTimeRangeZoomed: false,
    ...overrides,
  } as DashboardBaseComponentProps;
}

function buildChartComponent(): DashboardChartComponent {
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
      chartTitle: "CPU by host",
      chartType: DashboardChartType.Line,
      metricQueryConfig: {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: "cpu.usage",
            aggegationType: MetricsAggregationType.Avg,
          },
          groupByAttributeKeys: ["host.name"],
        },
      },
    },
  } as unknown as DashboardChartComponent;
}

function renderWidget(
  overrides: Partial<DashboardBaseComponentProps> = {},
): RenderResult {
  return render(
    <DashboardChartComponentElement
      {...buildBaseProps(overrides)}
      component={buildChartComponent()}
    />,
  );
}

interface CapturedChartProps {
  metricViewData: MetricViewData;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

function lastChartProps(): CapturedChartProps {
  const calls: Array<Array<unknown>> = metricChartsRenderMock.mock.calls;
  return calls[calls.length - 1]?.[0] as CapturedChartProps;
}

function lastFetchWindow(): InBetween<Date> | null | undefined {
  const calls: Array<Array<unknown>> = fetchResultsMock.mock.calls;
  return (calls[calls.length - 1]?.[0] as { metricViewData: MetricViewData })
    ?.metricViewData?.startAndEndDate;
}

beforeEach(() => {
  onDashboardTimeRangeSelectMock = getJestMockFunction();
  onDashboardTimeRangeResetMock = getJestMockFunction();
  fetchResultsMock.mockReset();
  metricChartsRenderMock.mockReset();
  investigationDrawerRenderMock.mockReset();
  fetchResultsMock.mockReturnValue(
    Promise.resolve([{ data: [], truncated: false }]),
  );
});

afterEach(() => {
  cleanup();
});

describe("dashboard-wide drag-to-zoom", () => {
  test("a drag-selection is handed to the dashboard, not applied to this panel alone", async () => {
    renderWidget();

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });

    expect(lastFetchWindow()?.startValue).toEqual(BOARD_START);
    const fetchCountBeforeDrag: number = fetchResultsMock.mock.calls.length;

    act(() => {
      lastChartProps().onTimeRangeSelect?.(DRAG_START, DRAG_END);
    });

    expect(onDashboardTimeRangeSelectMock.mock.calls.length).toBe(1);
    expect(onDashboardTimeRangeSelectMock.mock.calls[0]).toEqual([
      DRAG_START,
      DRAG_END,
    ]);

    /*
     * The widget must NOT retime itself off its own bat — the shell owns
     * the range, and a panel that jumped ahead of it would be showing a
     * different window from every one of its neighbours until the new
     * range came back down.
     */
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchResultsMock.mock.calls.length).toBe(fetchCountBeforeDrag);
    expect(lastFetchWindow()?.startValue).toEqual(BOARD_START);
    // …and no widget-local "Zoomed" pill appears either.
    expect(screen.queryByText(/Zoomed:/)).toBeNull();
  });

  test("the new board range coming back down is what actually refetches the panel", async () => {
    const rendered: RenderResult = renderWidget();

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });

    act(() => {
      lastChartProps().onTimeRangeSelect?.(DRAG_START, DRAG_END);
    });

    // The shell applies the zoom and re-renders every widget with it.
    rendered.rerender(
      <DashboardChartComponentElement
        {...buildBaseProps({
          dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
          isDashboardTimeRangeZoomed: true,
        })}
        component={buildChartComponent()}
      />,
    );

    await waitFor(() => {
      expect(lastFetchWindow()?.startValue).toEqual(DRAG_START);
    });
    expect(lastFetchWindow()?.endValue).toEqual(DRAG_END);
  });

  test("double-click-to-reset is only offered once the board is actually zoomed", async () => {
    const rendered: RenderResult = renderWidget();

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });

    /*
     * Nothing to undo yet. Withholding the handler is not cosmetic: the
     * chart library delays every plain click while a reset handler is
     * present, and a bucket click must stay instant on an unzoomed board.
     */
    expect(lastChartProps().onTimeRangeReset).toBeUndefined();

    rendered.rerender(
      <DashboardChartComponentElement
        {...buildBaseProps({
          dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
          isDashboardTimeRangeZoomed: true,
        })}
        component={buildChartComponent()}
      />,
    );

    await waitFor(() => {
      expect(lastChartProps().onTimeRangeReset).toBeDefined();
    });

    act(() => {
      lastChartProps().onTimeRangeReset?.();
    });

    expect(onDashboardTimeRangeResetMock.mock.calls.length).toBe(1);
  });

  test("edit mode offers neither zoom nor reset", async () => {
    renderWidget({ isEditMode: true, isDashboardTimeRangeZoomed: true });

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });

    /*
     * In edit mode the drag gesture belongs to widget move/resize, and a
     * board-wide retime mid-edit would be a surprise on top of unsaved
     * layout changes.
     */
    expect(lastChartProps().onTimeRangeSelect).toBeUndefined();
    expect(lastChartProps().onTimeRangeReset).toBeUndefined();
  });

  test("Investigate stays reachable from the panel header, on the window it is charting", async () => {
    renderWidget({
      dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
      isDashboardTimeRangeZoomed: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });

    /*
     * The old entry point lived inside the widget-local "Zoomed" pill,
     * which no longer renders on a real dashboard now that the shell owns
     * the drag. It has to live somewhere that always shows.
     */
    expect(screen.queryByText(/Zoomed:/)).toBeNull();

    fireEvent.click(
      screen.getByLabelText("Investigate this time window in a side panel"),
    );

    expect(screen.getByTestId("investigation-drawer")).toBeInTheDocument();
    const drawerProps: { window?: InBetween<Date> | undefined } =
      investigationDrawerRenderMock.mock.calls[
        investigationDrawerRenderMock.mock.calls.length - 1
      ]?.[0] as { window?: InBetween<Date> | undefined };
    expect(drawerProps.window?.startValue).toEqual(DRAG_START);
    expect(drawerProps.window?.endValue).toEqual(DRAG_END);
  });
});
