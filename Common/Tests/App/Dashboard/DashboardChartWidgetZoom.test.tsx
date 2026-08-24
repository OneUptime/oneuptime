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
 * Drag-to-zoom on a dashboard chart widget is the "investigate this
 * spike" entry point: selecting a window must narrow THIS widget only
 * (never the dashboard-wide range), refetch for the narrowed window, and
 * offer a way back (Reset) and a way deeper (Open in Explorer, carrying
 * the zoomed window). Edit mode must not zoom — the drag gesture belongs
 * to widget move/resize there, and series pivots would navigate away from
 * unsaved dashboard changes.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const metricChartsRenderMock: MockFunction = getJestMockFunction();

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
  "22222222-1111-4111-8111-222222222222",
);

const DASHBOARD_START: Date = new Date("2026-08-20T09:00:00.000Z");
const DASHBOARD_END: Date = new Date("2026-08-20T10:00:00.000Z");
const ZOOM_START: Date = new Date("2026-08-20T09:20:00.000Z");
const ZOOM_END: Date = new Date("2026-08-20T09:35:00.000Z");

/*
 * A CUSTOM range pins the window to fixed instants — a relative range
 * would resolve against the wall clock and make the window assertions
 * untestable.
 */
const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(DASHBOARD_START, DASHBOARD_END),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

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
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
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
  enableSeriesActions?: boolean | undefined;
}

function lastChartProps(): CapturedChartProps {
  const calls: Array<Array<unknown>> = metricChartsRenderMock.mock.calls;
  return calls[calls.length - 1]?.[0] as CapturedChartProps;
}

interface CapturedFetchArgs {
  metricViewData: MetricViewData;
}

function lastFetchArgs(): CapturedFetchArgs {
  const calls: Array<Array<unknown>> = fetchResultsMock.mock.calls;
  return calls[calls.length - 1]?.[0] as CapturedFetchArgs;
}

beforeEach(() => {
  fetchResultsMock.mockReset();
  metricChartsRenderMock.mockReset();
  fetchResultsMock.mockReturnValue(
    Promise.resolve([{ data: [], truncated: false }]),
  );
});

afterEach(() => {
  cleanup();
});

describe("dashboard chart widget drag-to-zoom", () => {
  test("drag-selecting a window refetches THIS widget for that window and shows the zoom bar", async () => {
    renderWidget();

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });

    // Initial fetch asks for the dashboard's window.
    expect(lastFetchArgs().metricViewData.startAndEndDate?.startValue).toEqual(
      DASHBOARD_START,
    );

    const initialProps: CapturedChartProps = lastChartProps();
    expect(initialProps.onTimeRangeSelect).toBeDefined();
    expect(initialProps.enableSeriesActions).toBe(true);
    // A pinned Custom dashboard window is not a rolling token.
    expect(initialProps.metricViewData.rangeToken).toBe(TimeRange.CUSTOM);

    const fetchCountBeforeZoom: number = fetchResultsMock.mock.calls.length;

    act(() => {
      initialProps.onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });

    // The zoom bar names the window and offers the escape hatches.
    expect(screen.getByText(/Zoomed:/)).toBeInTheDocument();
    expect(screen.getByText("Reset")).toBeInTheDocument();
    expect(screen.getByText("Open in Explorer")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchResultsMock.mock.calls.length).toBeGreaterThan(
        fetchCountBeforeZoom,
      );
    });

    // The refetch and the chart both use the ZOOMED window…
    expect(lastFetchArgs().metricViewData.startAndEndDate?.startValue).toEqual(
      ZOOM_START,
    );
    expect(lastFetchArgs().metricViewData.startAndEndDate?.endValue).toEqual(
      ZOOM_END,
    );
    // …and a zoomed window is a deliberate pin: no rolling range token.
    await waitFor(() => {
      expect(lastChartProps().metricViewData.rangeToken).toBeUndefined();
    });
  });

  test("Reset returns to the dashboard's window", async () => {
    renderWidget();

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });

    act(() => {
      lastChartProps().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });

    expect(screen.getByText(/Zoomed:/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Reset"));

    expect(screen.queryByText(/Zoomed:/)).toBeNull();

    await waitFor(() => {
      expect(
        lastFetchArgs().metricViewData.startAndEndDate?.startValue,
      ).toEqual(DASHBOARD_START);
    });
    expect(lastChartProps().metricViewData.rangeToken).toBe(TimeRange.CUSTOM);
  });

  test("edit mode disables zoom and series navigation", async () => {
    renderWidget({ isEditMode: true });

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });

    const captured: CapturedChartProps = lastChartProps();
    expect(captured.onTimeRangeSelect).toBeUndefined();
    expect(captured.enableSeriesActions).toBe(false);
  });
});
