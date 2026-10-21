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
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 inside the dashboard editor and on the canvas itself.
 *
 * The Component Settings modal previews the widget being edited. A drag on
 * that preview zooms the PREVIEW - never the board behind the modal, which
 * edit mode has just un-zoomed and whose reset control edit mode hides. A
 * double-click, or the "Reset zoom" the preview header then shows, puts the
 * preview back on the board's range.
 *
 * The canvas, for its part, lets widgets zoom the board only through the
 * shell's own handlers: a zoom offered by a page around the dashboard can
 * never reach a chart on it.
 *
 * MetricCharts is stood in for by a component that resolves its zoom the
 * way the real chart wrappers do, so an outer zoom leaking in would show.
 */

jest.setTimeout(120000);

const DRAG_START: Date = new Date("2026-09-28T10:20:00.000Z");
const DRAG_END: Date = new Date("2026-09-28T10:35:00.000Z");
const INNER_DRAG_START: Date = new Date("2026-09-28T10:25:00.000Z");
const INNER_DRAG_END: Date = new Date("2026-09-28T10:30:00.000Z");

let nextDragWindow: [Date, Date] = [DRAG_START, DRAG_END];

const fetchResultsMock: MockFunction = getJestMockFunction();

interface ZoomContextModule {
  useChartTimeRangeZoom: () => ChartTimeRangeZoomContextValue | null;
  resolveChartTimeRangeZoom: (
    input: ResolveChartTimeRangeZoomInput,
  ) => ChartTimeRangeZoomHandlers;
}

interface MetricChartsStubProps {
  metricViewData: MetricViewData;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    const zoomContext: ZoomContextModule = jest.requireActual(
      "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
    ) as ZoomContextModule;
    return {
      __esModule: true,
      default: (props: MetricChartsStubProps): React.ReactElement => {
        return react.createElement(MetricChartsStub, {
          ...props,
          zoomContext: zoomContext,
        });
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

// The settings form is not under test; the preview above it is.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    return {
      __esModule: true,
      default: () => {
        return react.createElement("div", { "data-testid": "arguments-form" });
      },
    };
  },
);

import DashboardCanvas from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index";
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
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  ResolveChartTimeRangeZoomInput,
  TimeRangeZoomScope,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";

interface MetricChartsStubRenderProps extends MetricChartsStubProps {
  zoomContext: ZoomContextModule;
}

/*
 * MetricCharts as a chart wrapper sees it: its host's handlers, else the
 * enclosing page's (time axis). It publishes the window it is charting and
 * whether it can zoom; its buttons stand for a drag and a double-click.
 */
function MetricChartsStub(
  props: MetricChartsStubRenderProps,
): React.ReactElement {
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    props.zoomContext.useChartTimeRangeZoom();
  const zoom: ChartTimeRangeZoomHandlers =
    props.zoomContext.resolveChartTimeRangeZoom({
      onTimeRangeSelect: props.onTimeRangeSelect,
      onTimeRangeReset: props.onTimeRangeReset,
      isTimeAxis: true,
      pageZoom: pageZoom,
    });
  const window: InBetween<Date> | null | undefined =
    props.metricViewData.startAndEndDate;

  return (
    <div
      data-testid="metric-charts"
      data-can-zoom={String(Boolean(zoom.onTimeRangeSelect))}
      data-can-reset={String(Boolean(zoom.onTimeRangeReset))}
      data-window-start={window?.startValue?.toISOString()}
      data-window-end={window?.endValue?.toISOString()}
    >
      <button
        type="button"
        data-testid="metric-charts-drag"
        onClick={() => {
          zoom.onTimeRangeSelect?.(nextDragWindow[0], nextDragWindow[1]);
        }}
      />
      <button
        type="button"
        data-testid="metric-charts-double-click"
        onClick={() => {
          zoom.onTimeRangeReset?.();
        }}
      />
    </div>
  );
}

/*
 * jsdom has no ResizeObserver and lays nothing out, and the preview only
 * renders once it has measured a width. Report a real one.
 */
class FakeResizeObserver {
  private callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  public observe(): void {
    this.callback(
      [{ contentRect: { width: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  public unobserve(): void {
    // Nothing to stop observing.
  }

  public disconnect(): void {
    // Nothing to disconnect.
  }
}

const CHART_ID: ObjectID = new ObjectID("abababab-1111-4111-8111-abababababab");

const BOARD_START: Date = new Date("2026-09-28T10:00:00.000Z");
const BOARD_END: Date = new Date("2026-09-28T11:00:00.000Z");

const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(BOARD_START, BOARD_END),
};

function buildChartComponent(): DashboardChartComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: CHART_ID,
    componentType: DashboardComponentType.Chart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 2,
    arguments: {
      chartTitle: "CPU",
      chartType: DashboardChartType.Line,
      metricQueryConfig: {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: "cpu.usage",
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      },
    },
  } as unknown as DashboardChartComponent;
}

function buildViewConfig(): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    components: [buildChartComponent()],
    heightInDashboardUnits: 12,
  };
}

let boardSelect: MockFunction;
let boardReset: MockFunction;

interface CanvasOptions {
  isEditMode: boolean;
  isSelected?: boolean | undefined;
  range?: RangeStartAndEndDateTime | undefined;
  withBoardZoom?: boolean | undefined;
}

function canvas(options: CanvasOptions): React.ReactElement {
  return (
    <DashboardCanvas
      dashboardViewConfig={buildViewConfig()}
      onDashboardViewConfigChange={() => {}}
      isEditMode={options.isEditMode}
      currentTotalDashboardWidthInPx={1200}
      onComponentSelected={() => {}}
      onComponentUnselected={() => {}}
      selectedComponentId={options.isSelected ? CHART_ID : null}
      metrics={{ metricTypes: [], telemetryAttributes: [] }}
      dashboardStartAndEndDate={options.range || BOARD_RANGE}
      refreshTick={0}
      onDashboardTimeRangeSelect={
        options.withBoardZoom === false
          ? undefined
          : (boardSelect as unknown as (startTime: Date, endTime: Date) => void)
      }
      onDashboardTimeRangeReset={
        options.withBoardZoom === false
          ? undefined
          : (boardReset as unknown as () => void)
      }
      isDashboardTimeRangeZoomed={false}
    />
  );
}

function preview(): HTMLElement {
  return within(screen.getByTestId("modal")).getByTestId("metric-charts");
}

function boardChart(): HTMLElement {
  return screen.getAllByTestId("metric-charts").find((chart: HTMLElement) => {
    return !screen.getByTestId("modal").contains(chart);
  })!;
}

function dragOn(chart: HTMLElement, from: Date, to: Date): void {
  nextDragWindow = [from, to];
  fireEvent.click(within(chart).getByTestId("metric-charts-drag"));
}

function doubleClickOn(chart: HTMLElement): void {
  fireEvent.click(within(chart).getByTestId("metric-charts-double-click"));
}

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    FakeResizeObserver;
});

beforeEach(() => {
  boardSelect = getJestMockFunction();
  boardReset = getJestMockFunction();
  nextDragWindow = [DRAG_START, DRAG_END];
  fetchResultsMock.mockReset();
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
});

afterEach(() => {
  cleanup();
});

describe("the Component Settings preview zooms itself, never the board", () => {
  test("the board's own chart offers no zoom while editing; the preview's does", async () => {
    render(canvas({ isEditMode: true, isSelected: true }));

    await waitFor(() => {
      expect(preview()).toBeInTheDocument();
    });

    expect(boardChart()).toHaveAttribute("data-can-zoom", "false");
    expect(preview()).toHaveAttribute("data-can-zoom", "true");
    expect(preview()).toHaveAttribute(
      "data-window-start",
      BOARD_START.toISOString(),
    );
  });

  test("a drag on the preview narrows the preview, and only the preview", async () => {
    render(canvas({ isEditMode: true, isSelected: true }));
    await waitFor(() => {
      expect(preview()).toBeInTheDocument();
    });

    dragOn(preview(), DRAG_START, DRAG_END);

    await waitFor(() => {
      expect(preview()).toHaveAttribute(
        "data-window-start",
        DRAG_START.toISOString(),
      );
    });
    expect(preview()).toHaveAttribute(
      "data-window-end",
      DRAG_END.toISOString(),
    );
    // The board behind the modal keeps its range.
    expect(boardSelect).not.toHaveBeenCalled();
    expect(boardChart()).toHaveAttribute(
      "data-window-start",
      BOARD_START.toISOString(),
    );
    // The widget's standalone pill stays out of it: the preview owns the zoom.
    expect(
      within(screen.getByTestId("modal")).queryByText(/Zoomed:/),
    ).toBeNull();
  });

  test("the preview's header offers Reset zoom only while the preview is zoomed", async () => {
    render(canvas({ isEditMode: true, isSelected: true }));
    await waitFor(() => {
      expect(preview()).toBeInTheDocument();
    });

    const modal: HTMLElement = screen.getByTestId("modal");
    expect(
      within(modal).queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();

    dragOn(preview(), DRAG_START, DRAG_END);

    fireEvent.click(
      await within(modal).findByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    );

    await waitFor(() => {
      expect(preview()).toHaveAttribute(
        "data-window-start",
        BOARD_START.toISOString(),
      );
    });
    expect(
      within(modal).queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    expect(boardReset).not.toHaveBeenCalled();
  });

  test("a double-click on the preview puts it back on the board's range", async () => {
    render(canvas({ isEditMode: true, isSelected: true }));
    await waitFor(() => {
      expect(preview()).toBeInTheDocument();
    });

    expect(preview()).toHaveAttribute("data-can-reset", "false");
    dragOn(preview(), DRAG_START, DRAG_END);
    await waitFor(() => {
      expect(preview()).toHaveAttribute("data-can-reset", "true");
    });

    doubleClickOn(preview());

    await waitFor(() => {
      expect(preview()).toHaveAttribute(
        "data-window-start",
        BOARD_START.toISOString(),
      );
    });
    expect(boardReset).not.toHaveBeenCalled();
    expect(boardSelect).not.toHaveBeenCalled();
  });

  test("a zoom inside a zoom still resets to the board's range in one step", async () => {
    render(canvas({ isEditMode: true, isSelected: true }));
    await waitFor(() => {
      expect(preview()).toBeInTheDocument();
    });

    dragOn(preview(), DRAG_START, DRAG_END);
    await waitFor(() => {
      expect(preview()).toHaveAttribute(
        "data-window-start",
        DRAG_START.toISOString(),
      );
    });
    dragOn(preview(), INNER_DRAG_START, INNER_DRAG_END);
    await waitFor(() => {
      expect(preview()).toHaveAttribute(
        "data-window-start",
        INNER_DRAG_START.toISOString(),
      );
    });

    doubleClickOn(preview());

    await waitFor(() => {
      expect(preview()).toHaveAttribute(
        "data-window-start",
        BOARD_START.toISOString(),
      );
    });
  });

  test("the preview refetches the widget's data for the window it is showing", async () => {
    render(canvas({ isEditMode: true, isSelected: true }));
    await waitFor(() => {
      expect(preview()).toBeInTheDocument();
    });

    dragOn(preview(), DRAG_START, DRAG_END);

    await waitFor(() => {
      const windows: Array<string | undefined> =
        fetchResultsMock.mock.calls.map(
          (call: Array<unknown>): string | undefined => {
            return (
              call[0] as { metricViewData: MetricViewData }
            ).metricViewData.startAndEndDate?.startValue.toISOString();
          },
        );
      expect(windows).toContain(DRAG_START.toISOString());
    });
  });

  test("a new board range starts the preview over from it", async () => {
    const rendered: RenderResult = render(
      canvas({ isEditMode: true, isSelected: true }),
    );
    await waitFor(() => {
      expect(preview()).toBeInTheDocument();
    });
    dragOn(preview(), DRAG_START, DRAG_END);
    await waitFor(() => {
      expect(preview()).toHaveAttribute(
        "data-window-start",
        DRAG_START.toISOString(),
      );
    });

    const nextBoardStart: Date = new Date("2026-09-27T10:00:00.000Z");
    rendered.rerender(
      canvas({
        isEditMode: true,
        isSelected: true,
        range: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(nextBoardStart, BOARD_END),
        },
      }),
    );

    await waitFor(() => {
      expect(preview()).toHaveAttribute(
        "data-window-start",
        nextBoardStart.toISOString(),
      );
    });
    expect(
      within(screen.getByTestId("modal")).queryByTestId(
        RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
      ),
    ).toBeNull();
  });

  test("an equal board range handed down again keeps the preview's zoom", async () => {
    const rendered: RenderResult = render(
      canvas({ isEditMode: true, isSelected: true }),
    );
    await waitFor(() => {
      expect(preview()).toBeInTheDocument();
    });
    dragOn(preview(), DRAG_START, DRAG_END);
    await waitFor(() => {
      expect(preview()).toHaveAttribute(
        "data-window-start",
        DRAG_START.toISOString(),
      );
    });

    // A fresh object with the same instants, as a parent re-render might send.
    rendered.rerender(
      canvas({
        isEditMode: true,
        isSelected: true,
        range: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date(BOARD_START.getTime()),
            new Date(BOARD_END.getTime()),
          ),
        },
      }),
    );

    await waitFor(() => {
      expect(preview()).toHaveAttribute(
        "data-window-start",
        DRAG_START.toISOString(),
      );
    });
  });
});

describe("the canvas keeps a page's zoom off the board", () => {
  test("in view mode a panel zooms the board through the shell's handlers", async () => {
    render(canvas({ isEditMode: false }));
    const chart: HTMLElement = await screen.findByTestId("metric-charts");

    dragOn(chart, DRAG_START, DRAG_END);

    expect(boardSelect).toHaveBeenCalledTimes(1);
    expect(boardSelect.mock.calls[0]).toEqual([DRAG_START, DRAG_END]);
  });

  function renderInsideZoomingPage(
    options: CanvasOptions,
    pageRangeChange: MockFunction,
  ): void {
    render(
      <TimeRangeZoomScope
        timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onTimeRangeChange={
          pageRangeChange as unknown as (
            range: RangeStartAndEndDateTime,
          ) => void
        }
      >
        {canvas(options)}
      </TimeRangeZoomScope>,
    );
  }

  test("in edit mode a board inside a zooming page offers no zoom at all", async () => {
    const pageRangeChange: MockFunction = getJestMockFunction();
    renderInsideZoomingPage({ isEditMode: true }, pageRangeChange);
    const chart: HTMLElement = await screen.findByTestId("metric-charts");

    /*
     * The widget withholds the board's gesture in edit mode; without the
     * canvas withdrawing the page's zoom, the chart would take the page's
     * instead and a drag meant for moving the widget would retime the page.
     */
    expect(chart).toHaveAttribute("data-can-zoom", "false");
    dragOn(chart, DRAG_START, DRAG_END);

    expect(pageRangeChange).not.toHaveBeenCalled();
    expect(boardSelect).not.toHaveBeenCalled();
  });

  test("a board with no zoom of its own inside a zooming page leaves the page alone", async () => {
    const pageRangeChange: MockFunction = getJestMockFunction();
    renderInsideZoomingPage(
      { isEditMode: false, withBoardZoom: false },
      pageRangeChange,
    );
    const chart: HTMLElement = await screen.findByTestId("metric-charts");

    dragOn(chart, DRAG_START, DRAG_END);

    /*
     * The metric chart widget falls back to zooming itself when no shell
     * takes the gesture - its own "Zoomed" bar - but the page is never it.
     */
    expect(await screen.findByText(/Zoomed:/)).toBeInTheDocument();
    expect(pageRangeChange).not.toHaveBeenCalled();
  });

  test("a board that zooms inside a zooming page zooms the board, not the page", async () => {
    const pageRangeChange: MockFunction = getJestMockFunction();
    renderInsideZoomingPage({ isEditMode: false }, pageRangeChange);
    const chart: HTMLElement = await screen.findByTestId("metric-charts");

    dragOn(chart, DRAG_START, DRAG_END);

    expect(boardSelect).toHaveBeenCalledTimes(1);
    expect(pageRangeChange).not.toHaveBeenCalled();
  });

  test("the settings preview inside a zooming page still zooms only itself", async () => {
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
        {canvas({ isEditMode: true, isSelected: true })}
      </TimeRangeZoomScope>,
    );
    await waitFor(() => {
      expect(preview()).toBeInTheDocument();
    });

    dragOn(preview(), DRAG_START, DRAG_END);

    await waitFor(() => {
      expect(preview()).toHaveAttribute(
        "data-window-start",
        DRAG_START.toISOString(),
      );
    });
    expect(pageRangeChange).not.toHaveBeenCalled();
    expect(boardSelect).not.toHaveBeenCalled();
  });
});
