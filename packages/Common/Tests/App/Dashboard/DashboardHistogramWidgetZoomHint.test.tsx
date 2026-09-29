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
 * Issue #4105, review finding dash-2: the Log Chart and Trace Chart widgets
 * name their zoom gestures in a hint revealed on hover, and it promised
 * "Drag to zoom" over widgets with nothing to drag - the public board's
 * "not available" error, an API error, the no-data state - while a freshly
 * added widget, which has no title, never named the gesture at all.
 *
 * The hint now names only what the widget offers there and then:
 *
 *   chart drawn, board not zoomed   "Drag to zoom"
 *   chart drawn, board zoomed       "Drag to zoom · double-click to reset"
 *   no chart, board zoomed          "Double-click to reset" (the empty and
 *                                   error states take the double-click)
 *   no chart, board not zoomed      nothing
 *
 * and it shows on an untitled widget too, floating in the corner rather
 * than in a header row the widget does not have.
 *
 * recharts is stood in for, as in DashboardHistogramWidgetZoom.test.tsx:
 * the stand-in calls the very same mouse props with the bucket under the
 * pointer, which jsdom cannot resolve from layout.
 */

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  interface StubRow {
    time: string;
  }

  interface StubChartProps {
    data: Array<StubRow>;
    children?: React.ReactNode;
    onMouseDown?: (state: { activeLabel: string }) => void;
    onMouseMove?: (state: { activeLabel: string }) => void;
    onMouseUp?: (state: { activeLabel: string }) => void;
  }

  type StubChart = (props: StubChartProps) => React.ReactElement;

  const chart: (kind: string) => StubChart = (kind: string): StubChart => {
    return (props: StubChartProps): React.ReactElement => {
      return react.createElement(
        "div",
        { "data-testid": `${kind}-chart` },
        props.data.map((row: StubRow) => {
          return react.createElement("div", {
            key: row.time,
            "data-testid": `bucket-${row.time}`,
            onMouseDown: () => {
              props.onMouseDown?.({ activeLabel: row.time });
            },
            onMouseMove: () => {
              props.onMouseMove?.({ activeLabel: row.time });
            },
            onMouseUp: () => {
              props.onMouseUp?.({ activeLabel: row.time });
            },
          });
        }),
        props.children,
      );
    };
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: chart("bar"),
    LineChart: chart("line"),
    AreaChart: chart("area"),
    Bar: nothing,
    Line: nothing,
    Area: nothing,
    CartesianGrid: nothing,
    XAxis: nothing,
    YAxis: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
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
import DashboardWidgetZoomHint, {
  DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetZoomHint";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import { DashboardWidgetTimeRangeZoomHandlers } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/DashboardWidgetTimeRangeZoom";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardLogChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardLogChartComponent";
import DashboardTraceChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceChartComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import DashboardLogChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardLogChartComponent";
import DashboardTraceChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardTraceChartComponent";

const DRAG_ONLY: string = "Drag to zoom";
const DRAG_AND_RESET: string = "Drag to zoom · double-click to reset";
const RESET_ONLY: string = "Double-click to reset";

const COMPONENT_ID: ObjectID = new ObjectID(
  "7c7c7c7c-1111-4111-8111-7c7c7c7c7c7c",
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

type Responder = (data: JSONObject) => JSONObject | Promise<never>;

// Log buckets and trace rows at 10:15 and 10:16, whatever the window.
const withData: Responder = (): JSONObject => {
  return {
    buckets: [
      { time: "2026-09-28T10:15:00.000Z", severity: "Error", count: 3 },
      { time: "2026-09-28T10:16:00.000Z", severity: "Error", count: 5 },
    ],
    data: [
      { time: "2026-09-28 10:15:00", value: 3, groupValues: {} },
      { time: "2026-09-28 10:16:00", value: 5, groupValues: {} },
    ],
  };
};

// A window with nothing in it.
const empty: Responder = (): JSONObject => {
  return { buckets: [], data: [] };
};

const failing: Responder = (): Promise<never> => {
  return Promise.reject(new Error("analytics unavailable"));
};

function answerWith(responder: Responder): void {
  apiPostMock.mockImplementation((...args: Array<unknown>) => {
    const answer: JSONObject | Promise<never> = responder(
      (args[0] as { data: JSONObject }).data,
    );
    return answer instanceof Promise
      ? answer
      : Promise.resolve({ data: answer });
  });
}

function answerNever(): void {
  apiPostMock.mockImplementation(() => {
    return new Promise(() => {
      // Never answers: the first load is still in flight.
    });
  });
}

interface WidgetUnderTest {
  name: string;
  // The chart the stand-in draws for this widget with data.
  chartTestId: string;
  // The words the widget shows when the window has nothing in it.
  emptyText: string;
  // The words the widget shows on a public board.
  publicText: string;
  titled: () => DashboardBaseComponent;
  // The widget as "Add widget" creates it: no title.
  untitled: () => DashboardBaseComponent;
  element: (
    props: DashboardBaseComponentProps,
    component: DashboardBaseComponent,
  ) => React.ReactElement;
}

const WIDGETS: Array<WidgetUnderTest> = [
  {
    name: "Log Chart",
    chartTestId: "bar-chart",
    emptyText: "No logs for the selected time range and filters",
    publicText: "Log charts are not available on public dashboards.",
    titled: (): DashboardBaseComponent => {
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
          chartType: DashboardChartType.Bar,
        },
      };
    },
    untitled: (): DashboardBaseComponent => {
      return DashboardLogChartComponentUtil.getDefaultComponent();
    },
    element: (
      props: DashboardBaseComponentProps,
      component: DashboardBaseComponent,
    ): React.ReactElement => {
      return (
        <DashboardLogChartComponentElement
          {...props}
          component={component as unknown as DashboardLogChartComponent}
        />
      );
    },
  },
  {
    name: "Trace Chart",
    chartTestId: "bar-chart",
    emptyText: "No data for the selected time range",
    publicText: "Trace charts are not available on public dashboards.",
    titled: (): DashboardBaseComponent => {
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
          metric: "count",
        },
      };
    },
    untitled: (): DashboardBaseComponent => {
      return DashboardTraceChartComponentUtil.getDefaultComponent();
    },
    element: (
      props: DashboardBaseComponentProps,
      component: DashboardBaseComponent,
    ): React.ReactElement => {
      return (
        <DashboardTraceChartComponentElement
          {...props}
          component={component as unknown as DashboardTraceChartComponent}
        />
      );
    },
  },
];

function hint(): HTMLElement | null {
  return screen.queryByTestId(DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID);
}

// The title a widget was built with, if it has one.
function titleOf(component: DashboardBaseComponent): string | undefined {
  return (component.arguments as { title?: string | undefined } | undefined)
    ?.title;
}

function hints(): Array<HTMLElement> {
  return screen.queryAllByTestId(DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID);
}

/*
 * Stands for the public board: the page registers this context on mount,
 * and the log and trace widgets read it to know they cannot fetch.
 */
function enterPublicBoard(): void {
  setPublicDashboardContext({
    dashboardId: new ObjectID("8d8d8d8d-1111-4111-8111-8d8d8d8d8d8d"),
  } as unknown as PublicDashboardContext);
}

beforeEach(() => {
  onSelect = getJestMockFunction();
  onReset = getJestMockFunction();
  apiPostMock.mockReset();
  answerWith(withData);
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("DashboardWidgetZoomHint names only the gestures the widget has there and then", () => {
  const select: (startTime: Date, endTime: Date) => void = (): void => {
    // Stands for the board's drag handler.
  };
  const reset: () => void = (): void => {
    // Stands for the board's reset handler.
  };

  function renderHint(
    zoom: DashboardWidgetTimeRangeZoomHandlers,
    isChartShown: boolean,
  ): void {
    render(
      <div className="group/zoomhint">
        <DashboardWidgetZoomHint zoom={zoom} isChartShown={isChartShown} />
      </div>,
    );
  }

  test.each([
    [
      "a chart on an unzoomed board",
      { onTimeRangeSelect: select, onTimeRangeReset: undefined },
      true,
      DRAG_ONLY,
    ],
    [
      "a chart on a zoomed board",
      { onTimeRangeSelect: select, onTimeRangeReset: reset },
      true,
      DRAG_AND_RESET,
    ],
    [
      "no chart on a zoomed board: only the double-click is there to make",
      { onTimeRangeSelect: select, onTimeRangeReset: reset },
      false,
      RESET_ONLY,
    ],
    [
      "a chart, a reset and no drag (a host that offers only the reset)",
      { onTimeRangeSelect: undefined, onTimeRangeReset: reset },
      true,
      RESET_ONLY,
    ],
  ])(
    "%s",
    (
      _case: string,
      zoom: DashboardWidgetTimeRangeZoomHandlers,
      isChartShown: boolean,
      expected: string,
    ) => {
      renderHint(zoom, isChartShown);

      expect(hint()).toHaveTextContent(new RegExp(`^${expected}$`));
    },
  );

  test.each([
    [
      "no chart on an unzoomed board: nothing to drag, nothing to undo",
      { onTimeRangeSelect: select, onTimeRangeReset: undefined },
      false,
    ],
    [
      "edit mode, chart drawn",
      { onTimeRangeSelect: undefined, onTimeRangeReset: undefined },
      true,
    ],
    [
      "edit mode, no chart",
      { onTimeRangeSelect: undefined, onTimeRangeReset: undefined },
      false,
    ],
  ])(
    "%s says nothing",
    (
      _case: string,
      zoom: DashboardWidgetTimeRangeZoomHandlers,
      isChartShown: boolean,
    ) => {
      renderHint(zoom, isChartShown);

      expect(hint()).toBeNull();
    },
  );

  test("the reset-only hint is still revealed on hover only, and never takes the pointer", () => {
    renderHint({ onTimeRangeSelect: select, onTimeRangeReset: reset }, false);

    expect(hint()).toHaveClass("opacity-0");
    expect(hint()).toHaveClass("group-hover/zoomhint:opacity-100");
    expect(hint()).toHaveClass("pointer-events-none");
  });

  /*
   * A mouse press on the chart focuses recharts' own (tabindex -1) layer,
   * so a reveal on any focus inside the widget kept the hint up after
   * every drag. It reveals on keyboard focus only, like the card hints.
   */
  test("it reveals on keyboard focus inside the widget, not on the focus a mouse press leaves", () => {
    renderHint({ onTimeRangeSelect: select }, true);

    expect(hint()).toHaveClass(
      "group-has-[:focus-visible]/zoomhint:opacity-100",
    );
    expect(hint()!.className).not.toContain("group-focus-within/zoomhint");
  });
});

describe.each(WIDGETS)("the $name widget's hint", (widget: WidgetUnderTest) => {
  function renderWidget(
    overrides: Partial<DashboardBaseComponentProps> = {},
    component: DashboardBaseComponent = widget.titled(),
  ): RenderResult {
    return render(widget.element(buildBaseProps(overrides), component));
  }

  describe("with no chart to drag across", () => {
    test("on a public board it never offers a drag over the 'not available' error", async () => {
      enterPublicBoard();
      renderWidget();

      await screen.findByText(widget.publicText);

      expect(hint()).toBeNull();
      expect(apiPostMock).not.toHaveBeenCalled();
    });

    test("on a zoomed public board it names the double-click the error takes, and the double-click resets", async () => {
      enterPublicBoard();
      renderWidget({ isDashboardTimeRangeZoomed: true });

      const error: HTMLElement = await screen.findByText(widget.publicText);

      expect(hint()).toHaveTextContent(new RegExp(`^${RESET_ONLY}$`));

      fireEvent.doubleClick(error);

      expect(onReset).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    });

    test("over an error it offers no drag, and names the reset while zoomed", async () => {
      answerWith(failing);
      const rendered: RenderResult = renderWidget();

      await screen.findByText("analytics unavailable");
      expect(hint()).toBeNull();

      rendered.rerender(
        widget.element(
          buildBaseProps({ isDashboardTimeRangeZoomed: true }),
          widget.titled(),
        ),
      );

      await screen.findByText("analytics unavailable");
      expect(hint()).toHaveTextContent(new RegExp(`^${RESET_ONLY}$`));
    });

    test("over the no-data state it offers no drag", async () => {
      answerWith(empty);
      renderWidget();

      await screen.findByText(widget.emptyText);

      expect(hint()).toBeNull();
    });

    test("over the no-data state a zoom landed on, it names the double-click that gets back out", async () => {
      answerWith(empty);
      renderWidget({ isDashboardTimeRangeZoomed: true });

      const emptyState: HTMLElement = await screen.findByText(widget.emptyText);

      expect(hint()).toHaveTextContent(new RegExp(`^${RESET_ONLY}$`));

      fireEvent.doubleClick(emptyState);
      expect(onReset).toHaveBeenCalledTimes(1);
    });

    test("while the first load is in flight it offers no drag", async () => {
      answerNever();
      renderWidget();

      await waitFor(() => {
        expect(apiPostMock).toHaveBeenCalledTimes(1);
      });

      expect(screen.getByTestId("component-loader")).toBeInTheDocument();
      expect(hint()).toBeNull();
    });
  });

  describe("with a chart drawn", () => {
    test("it offers the drag, and names the reset once the board is zoomed", async () => {
      const rendered: RenderResult = renderWidget();
      await screen.findByTestId(widget.chartTestId);

      expect(hint()).toHaveTextContent(new RegExp(`^${DRAG_ONLY}$`));

      rendered.rerender(
        widget.element(
          buildBaseProps({ isDashboardTimeRangeZoomed: true }),
          widget.titled(),
        ),
      );

      expect(hint()).toHaveTextContent(new RegExp(`^${DRAG_AND_RESET}$`));
    });

    test("a chart that gives way to the no-data state takes the drag hint with it", async () => {
      const rendered: RenderResult = renderWidget({
        isDashboardTimeRangeZoomed: true,
      });
      await screen.findByTestId(widget.chartTestId);
      expect(hint()).toHaveTextContent(new RegExp(`^${DRAG_AND_RESET}$`));

      // The next window has nothing in it.
      answerWith(empty);
      rendered.rerender(
        widget.element(
          buildBaseProps({ isDashboardTimeRangeZoomed: true, refreshTick: 1 }),
          widget.titled(),
        ),
      );

      await screen.findByText(widget.emptyText);
      expect(screen.queryByTestId(widget.chartTestId)).toBeNull();
      expect(hint()).toHaveTextContent(new RegExp(`^${RESET_ONLY}$`));
    });

    test("edit mode offers no hint at all, chart or not", async () => {
      renderWidget({ isEditMode: true, isDashboardTimeRangeZoomed: true });
      await screen.findByTestId(widget.chartTestId);

      expect(hint()).toBeNull();
    });
  });

  describe("where the hint sits", () => {
    test("a titled widget keeps it in its header row, beside the title", async () => {
      renderWidget();
      await screen.findByTestId(widget.chartTestId);

      expect(hints()).toHaveLength(1);
      const titleRow: HTMLElement = hint()!.parentElement!;
      expect(titleRow).toHaveTextContent(String(titleOf(widget.titled())));
      expect(hint()).toHaveClass("ml-auto");
      expect(hint()).not.toHaveClass("absolute");
    });

    test("an untitled widget, as a new one starts, still names the gesture", async () => {
      const component: DashboardBaseComponent = widget.untitled();
      // The premise: a freshly added widget has no title.
      expect(titleOf(component)).toBeUndefined();

      renderWidget({}, component);
      await screen.findByTestId(widget.chartTestId);

      expect(hints()).toHaveLength(1);
      expect(hint()).toHaveTextContent(new RegExp(`^${DRAG_ONLY}$`));
    });

    test("untitled, it floats over the widget's top corner, revealed on hover, never taking the pointer", async () => {
      const rendered: RenderResult = renderWidget({}, widget.untitled());
      await screen.findByTestId(widget.chartTestId);

      const floating: HTMLElement = hint()!;
      expect(floating).toHaveClass("absolute");
      expect(floating).toHaveClass("pointer-events-none");
      expect(floating).toHaveClass("group-hover/zoomhint:opacity-100");

      // Positioned against the widget itself, the named hover group.
      const root: HTMLElement = rendered.container
        .firstElementChild as HTMLElement;
      expect(root).toHaveClass("group/zoomhint");
      expect(root).toHaveClass("relative");
      expect(floating.parentElement).toBe(root);
      // After the chart, so the chart does not paint over it.
      expect(root.lastElementChild).toBe(floating);
    });

    test("untitled, a drag across the chart beneath it still zooms", async () => {
      renderWidget({}, widget.untitled());
      const chart: HTMLElement = await screen.findByTestId(widget.chartTestId);
      const buckets: Array<HTMLElement> = Array.from(
        chart.querySelectorAll('[data-testid^="bucket-"]'),
      );

      fireEvent.mouseDown(buckets[0]!);
      fireEvent.mouseMove(buckets[1]!);
      fireEvent.mouseUp(buckets[1]!);

      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    test("untitled and zoomed into a quiet stretch, it names the way back", async () => {
      answerWith(empty);
      renderWidget({ isDashboardTimeRangeZoomed: true }, widget.untitled());

      await screen.findByText(widget.emptyText);

      expect(hints()).toHaveLength(1);
      expect(hint()).toHaveTextContent(new RegExp(`^${RESET_ONLY}$`));
    });

    test("untitled on a public board, it offers no drag over the error, and names the reset once zoomed", async () => {
      enterPublicBoard();
      const component: DashboardBaseComponent = widget.untitled();
      const rendered: RenderResult = renderWidget({}, component);

      await screen.findByText(widget.publicText);
      expect(hint()).toBeNull();

      rendered.rerender(
        widget.element(
          buildBaseProps({ isDashboardTimeRangeZoomed: true }),
          component,
        ),
      );

      await screen.findByText(widget.publicText);
      expect(hints()).toHaveLength(1);
      expect(hint()).toHaveTextContent(new RegExp(`^${RESET_ONLY}$`));
      expect(hint()).toHaveClass("absolute");
    });

    test("untitled, the hint follows the chart: gone with the data, back with it", async () => {
      const component: DashboardBaseComponent = widget.untitled();
      const rendered: RenderResult = renderWidget({}, component);
      await screen.findByTestId(widget.chartTestId);
      expect(hint()).toHaveTextContent(new RegExp(`^${DRAG_ONLY}$`));

      // An auto-refresh finds nothing in the window.
      answerWith(empty);
      rendered.rerender(
        widget.element(buildBaseProps({ refreshTick: 1 }), component),
      );
      await screen.findByText(widget.emptyText);
      expect(hint()).toBeNull();

      // And the next one finds the data again.
      answerWith(withData);
      rendered.rerender(
        widget.element(buildBaseProps({ refreshTick: 2 }), component),
      );
      await screen.findByTestId(widget.chartTestId);
      expect(hints()).toHaveLength(1);
      expect(hint()).toHaveTextContent(new RegExp(`^${DRAG_ONLY}$`));
    });

    test("untitled in edit mode, there is still no hint", async () => {
      renderWidget(
        { isEditMode: true, isDashboardTimeRangeZoomed: true },
        widget.untitled(),
      );
      await screen.findByTestId(widget.chartTestId);

      expect(hint()).toBeNull();
    });
  });

  describe("the states that take the reset double-click", () => {
    function doubleClickTarget(text: string): HTMLElement {
      return screen.getByText(text).closest(".min-h-0") as HTMLElement;
    }

    test("while armed, a double-click on the no-data words selects none of them", async () => {
      answerWith(empty);
      renderWidget({ isDashboardTimeRangeZoomed: true });

      await screen.findByText(widget.emptyText);

      expect(doubleClickTarget(widget.emptyText)).toHaveClass("select-none");
    });

    test("while armed, the same holds over an error", async () => {
      answerWith(failing);
      renderWidget({ isDashboardTimeRangeZoomed: true });

      await screen.findByText("analytics unavailable");

      expect(doubleClickTarget("analytics unavailable")).toHaveClass(
        "select-none",
      );
    });

    test("unarmed, an error's words stay selectable, to be copied", async () => {
      answerWith(failing);
      renderWidget();

      await screen.findByText("analytics unavailable");

      expect(doubleClickTarget("analytics unavailable")).not.toHaveClass(
        "select-none",
      );
    });
  });
});
