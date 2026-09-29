/** @timezone America/New_York */

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
 * Issue #4105 on the dashboard's two raw-recharts widgets, the Log Chart and
 * the Trace Chart. Like every other time-series panel on a board they now
 * answer to the board's gestures:
 *
 *   - a drag across bars (or along a line) zooms the WHOLE board to the
 *     window the bars cover - handed up to the shell, never applied to the
 *     one widget - through the END of the last bar the drag let go on;
 *   - a double-click puts the board back, and does nothing while there is
 *     nothing to undo;
 *   - a plain click never zooms: the shared histogram hook would zoom into
 *     one bar on a click, which suits the logs explorer but would let a
 *     casual click retime a whole dashboard;
 *   - edit mode offers none of it.
 *
 * recharts resolves the pointer to a bar from real layout, which jsdom does
 * not have, so it is stood in for: the stand-in calls the very same
 * onMouseDown / onMouseMove / onMouseUp props with the `activeLabel`
 * recharts would pass (the bucket under the pointer).
 *
 * The file runs in New York on purpose: trace buckets arrive as ClickHouse
 * "YYYY-MM-DD HH:mm:ss" strings in UTC, and a zoom read in the browser's
 * zone would land four hours off.
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
    Tooltip: (props: { active?: boolean }) => {
      return react.createElement("div", {
        "data-testid": "tooltip",
        "data-active": String(props.active),
      });
    },
    ReferenceArea: (props: { x1?: string; x2?: string }) => {
      return react.createElement("div", {
        "data-testid": "selection-band",
        "data-x1": props.x1,
        "data-x2": props.x2,
      });
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
import { DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetZoomHint";
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
  "44444444-1111-4111-8111-444444444444",
);

const BOARD_START: Date = new Date("2026-09-28T10:00:00.000Z");
const BOARD_END: Date = new Date("2026-09-28T11:00:00.000Z");

/*
 * A CUSTOM range pins the window to fixed instants; a relative one would
 * resolve against the wall clock and make the window assertions untestable.
 * An hour buckets at one minute on both widgets.
 */
const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(BOARD_START, BOARD_END),
};

const ZOOM_START: Date = new Date("2026-09-28T10:15:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T10:18:00.000Z");

// What the shell hands back down once a drag has retimed the board.
const ZOOMED_BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(ZOOM_START, ZOOM_END),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

// The log histogram labels its (gap-filled) buckets with ISO instants.
function logBar(isoTime: string): string {
  return new Date(isoTime).toISOString();
}

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

function buildLogComponent(
  args: Partial<DashboardLogChartComponent["arguments"]> = {},
): DashboardLogChartComponent {
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
      ...args,
    },
  };
}

function buildTraceComponent(
  args: Partial<DashboardTraceChartComponent["arguments"]> = {},
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
      metric: "count",
      ...args,
    },
  };
}

interface ApiPostArgs {
  url: { toString: () => string };
  data: JSONObject;
}

function postsTo(route: string): Array<ApiPostArgs> {
  return apiPostMock.mock.calls
    .map((call: Array<unknown>): ApiPostArgs => {
      return call[0] as ApiPostArgs;
    })
    .filter((args: ApiPostArgs): boolean => {
      return args.url.toString().includes(route);
    });
}

function lastPostTo(route: string): ApiPostArgs | undefined {
  const posts: Array<ApiPostArgs> = postsTo(route);
  return posts[posts.length - 1];
}

function bar(label: string): HTMLElement {
  return screen.getByTestId(`bucket-${label}`);
}

function drag(fromLabel: string, toLabel: string): void {
  fireEvent.mouseDown(bar(fromLabel));
  fireEvent.mouseMove(bar(toLabel));
  fireEvent.mouseUp(bar(toLabel));
}

function click(label: string): void {
  fireEvent.mouseDown(bar(label));
  fireEvent.mouseUp(bar(label));
}

function selectedWindows(): Array<[number, number]> {
  return onSelect.mock.calls.map((call: Array<unknown>): [number, number] => {
    return [(call[0] as Date).getTime(), (call[1] as Date).getTime()];
  });
}

type LogResponder = (data: JSONObject) => JSONObject;

/*
 * Answers the log histogram with one bucket at 10:15, 10:16 and 10:17 and
 * the trace analytics endpoint with the rows below, whatever the window.
 */
const TRACE_ROWS: Array<JSONObject> = [
  { time: "2026-09-28 10:15:00", value: 3, groupValues: {} },
  { time: "2026-09-28 10:16:00", value: 5, groupValues: {} },
  // No spans at all in between: trace rows are not gap-filled.
  { time: "2026-09-28 10:30:00", value: 2, groupValues: {} },
  { time: "2026-09-28 11:00:00", value: 1, groupValues: {} },
];

const defaultResponder: LogResponder = (): JSONObject => {
  return {
    buckets: [
      { time: "2026-09-28T10:15:00.000Z", severity: "Error", count: 3 },
      { time: "2026-09-28T10:16:00.000Z", severity: "Error", count: 5 },
      { time: "2026-09-28T10:17:00.000Z", severity: "Warning", count: 7 },
    ],
    data: TRACE_ROWS,
  };
};

function answerWith(responder: LogResponder): void {
  apiPostMock.mockImplementation((...args: Array<unknown>) => {
    const request: ApiPostArgs = args[0] as ApiPostArgs;
    return Promise.resolve({ data: responder(request.data) });
  });
}

function renderLogWidget(
  overrides: Partial<DashboardBaseComponentProps> = {},
  args: Partial<DashboardLogChartComponent["arguments"]> = {},
): RenderResult {
  return render(
    <DashboardLogChartComponentElement
      {...buildBaseProps(overrides)}
      component={buildLogComponent(args)}
    />,
  );
}

function renderTraceWidget(
  overrides: Partial<DashboardBaseComponentProps> = {},
  args: Partial<DashboardTraceChartComponent["arguments"]> = {},
): RenderResult {
  return render(
    <DashboardTraceChartComponentElement
      {...buildBaseProps(overrides)}
      component={buildTraceComponent(args)}
    />,
  );
}

beforeEach(() => {
  onSelect = getJestMockFunction();
  onReset = getJestMockFunction();
  apiPostMock.mockReset();
  answerWith(defaultResponder);
});

afterEach(() => {
  cleanup();
});

describe("Log Chart widget: drag-to-zoom retimes the board", () => {
  test("a drag across bars hands the board the window through the end of the last bar", async () => {
    renderLogWidget();
    await screen.findByTestId("bar-chart");

    drag(logBar("2026-09-28T10:15:00Z"), logBar("2026-09-28T10:17:00Z"));

    expect(selectedWindows()).toEqual([
      [ZOOM_START.getTime(), ZOOM_END.getTime()],
    ]);
    // The widget does not narrow itself; the board's range comes back down.
    expect(onReset).not.toHaveBeenCalled();
  });

  test("a right-to-left drag is the same window", async () => {
    renderLogWidget();
    await screen.findByTestId("bar-chart");

    drag(logBar("2026-09-28T10:17:00Z"), logBar("2026-09-28T10:15:00Z"));

    expect(selectedWindows()).toEqual([
      [ZOOM_START.getTime(), ZOOM_END.getTime()],
    ]);
  });

  test("a drag onto the newest, still-filling bar stops at the end of the board's window", async () => {
    renderLogWidget();
    await screen.findByTestId("bar-chart");

    drag(logBar("2026-09-28T10:58:00Z"), logBar("2026-09-28T11:00:00Z"));

    expect(selectedWindows()).toEqual([
      [new Date("2026-09-28T10:58:00.000Z").getTime(), BOARD_END.getTime()],
    ]);
  });

  test("a plain click on one bar never zooms the board", async () => {
    renderLogWidget();
    await screen.findByTestId("bar-chart");

    click(logBar("2026-09-28T10:16:00Z"));

    expect(onSelect).not.toHaveBeenCalled();
    // Nor is a band left behind to suggest otherwise.
    expect(screen.queryByTestId("selection-band")).toBeNull();
  });

  test("a plain click stays inert on a zoomed board too, with no delayed zoom", async () => {
    renderLogWidget({ isDashboardTimeRangeZoomed: true });
    await screen.findByTestId("bar-chart");

    click(logBar("2026-09-28T10:16:00Z"));

    /*
     * On a zoomed chart the shared hook holds a single-bar click open for
     * the double-click window before zooming into it. Waiting that out
     * proves nothing was pending.
     */
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 350);
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });

  test("a drag released outside the chart still zooms", async () => {
    renderLogWidget();
    await screen.findByTestId("bar-chart");

    fireEvent.mouseDown(bar(logBar("2026-09-28T10:15:00Z")));
    fireEvent.mouseMove(bar(logBar("2026-09-28T10:17:00Z")));
    fireEvent.mouseUp(window);

    expect(selectedWindows()).toEqual([
      [ZOOM_START.getTime(), ZOOM_END.getTime()],
    ]);
  });

  test("the band follows the drag and the tooltip stays shut until the release", async () => {
    renderLogWidget();
    await screen.findByTestId("bar-chart");

    expect(screen.getByTestId("tooltip")).toHaveAttribute(
      "data-active",
      "undefined",
    );

    fireEvent.mouseDown(bar(logBar("2026-09-28T10:15:00Z")));
    fireEvent.mouseMove(bar(logBar("2026-09-28T10:17:00Z")));

    const band: HTMLElement = screen.getByTestId("selection-band");
    expect(band).toHaveAttribute("data-x1", logBar("2026-09-28T10:15:00Z"));
    expect(band).toHaveAttribute("data-x2", logBar("2026-09-28T10:17:00Z"));
    expect(screen.getByTestId("tooltip")).toHaveAttribute(
      "data-active",
      "false",
    );

    fireEvent.mouseUp(bar(logBar("2026-09-28T10:17:00Z")));

    expect(screen.queryByTestId("selection-band")).toBeNull();
    expect(screen.getByTestId("tooltip")).toHaveAttribute(
      "data-active",
      "undefined",
    );
  });

  test.each([
    ["line", DashboardChartType.Line],
    ["area", DashboardChartType.Area],
    ["bar", DashboardChartType.Bar],
  ])(
    "the %s variant answers to the same drag",
    async (kind: string, chartType: DashboardChartType) => {
      renderLogWidget({}, { chartType: chartType });
      await screen.findByTestId(`${kind}-chart`);

      drag(logBar("2026-09-28T10:15:00Z"), logBar("2026-09-28T10:17:00Z"));

      expect(selectedWindows()).toEqual([
        [ZOOM_START.getTime(), ZOOM_END.getTime()],
      ]);
    },
  );

  test("the board's zoomed range coming back down refetches the histogram for that window", async () => {
    const rendered: RenderResult = renderLogWidget();
    await screen.findByTestId("bar-chart");

    expect(lastPostTo("/telemetry/logs/histogram")?.data["startTime"]).toBe(
      BOARD_START.toISOString(),
    );

    rendered.rerender(
      <DashboardLogChartComponentElement
        {...buildBaseProps({
          dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
          isDashboardTimeRangeZoomed: true,
        })}
        component={buildLogComponent()}
      />,
    );

    await waitFor(() => {
      expect(lastPostTo("/telemetry/logs/histogram")?.data["startTime"]).toBe(
        ZOOM_START.toISOString(),
      );
    });
    expect(lastPostTo("/telemetry/logs/histogram")?.data["endTime"]).toBe(
      ZOOM_END.toISOString(),
    );
  });

  test("the bars stay on screen, dimmed, while the zoomed window loads", async () => {
    const rendered: RenderResult = renderLogWidget();
    await screen.findByTestId("bar-chart");

    apiPostMock.mockImplementation(() => {
      return new Promise(() => {
        // Never answers: the reload is still in flight.
      });
    });

    rendered.rerender(
      <DashboardLogChartComponentElement
        {...buildBaseProps({
          dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
          isDashboardTimeRangeZoomed: true,
        })}
        component={buildLogComponent()}
      />,
    );

    await waitFor(() => {
      expect(postsTo("/telemetry/logs/histogram").length).toBe(2);
    });

    const chart: HTMLElement = screen.getByTestId("bar-chart");
    expect(chart).toBeInTheDocument();
    await waitFor(() => {
      expect(
        (chart.closest("[style*='opacity']") as HTMLElement).style.opacity,
      ).toBe("0.5");
    });
  });
});

describe("Log Chart widget: double-click resets the board", () => {
  test("does nothing while the board is not zoomed", async () => {
    renderLogWidget();
    await screen.findByTestId("bar-chart");

    fireEvent.doubleClick(screen.getByTestId("bar-chart"));

    expect(onReset).not.toHaveBeenCalled();
  });

  test("puts the board back while it is zoomed", async () => {
    renderLogWidget({ isDashboardTimeRangeZoomed: true });
    await screen.findByTestId("bar-chart");

    fireEvent.doubleClick(screen.getByTestId("bar-chart"));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("works on the empty state a zoom into a quiet stretch lands on", async () => {
    answerWith((): JSONObject => {
      return { buckets: [] };
    });
    renderLogWidget({ isDashboardTimeRangeZoomed: true });

    const empty: HTMLElement = await screen.findByText(
      "No logs for the selected time range and filters",
    );
    fireEvent.doubleClick(empty);

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test("arms as soon as the board becomes zoomed, past the widget's memo", async () => {
    const rendered: RenderResult = renderLogWidget();
    await screen.findByTestId("bar-chart");

    rendered.rerender(
      <DashboardLogChartComponentElement
        {...buildBaseProps({ isDashboardTimeRangeZoomed: true })}
        component={buildLogComponent()}
      />,
    );

    fireEvent.doubleClick(screen.getByTestId("bar-chart"));

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe("Log Chart widget: where the gesture is offered", () => {
  test("names it in the header, revealed on hover, and names the reset only while zoomed", async () => {
    const rendered: RenderResult = renderLogWidget();
    await screen.findByTestId("bar-chart");

    const hint: HTMLElement = screen.getByTestId(
      DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID,
    );
    expect(hint).toHaveTextContent(/^Drag to zoom$/);
    expect(hint).toHaveClass("group-hover/zoomhint:opacity-100");
    expect(hint.closest('[class~="group/zoomhint"]')).not.toBeNull();

    rendered.rerender(
      <DashboardLogChartComponentElement
        {...buildBaseProps({ isDashboardTimeRangeZoomed: true })}
        component={buildLogComponent()}
      />,
    );

    expect(
      screen.getByTestId(DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID),
    ).toHaveTextContent("Drag to zoom · double-click to reset");
  });

  test("edit mode offers no drag, no reset and no hint", async () => {
    renderLogWidget({ isEditMode: true, isDashboardTimeRangeZoomed: true });
    await screen.findByTestId("bar-chart");

    drag(logBar("2026-09-28T10:15:00Z"), logBar("2026-09-28T10:17:00Z"));
    fireEvent.doubleClick(screen.getByTestId("bar-chart"));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.queryByTestId("selection-band")).toBeNull();
    expect(screen.queryByTestId(DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID)).toBeNull();
  });

  test("a host that offers no board zoom leaves the widget inert", async () => {
    renderLogWidget({
      onDashboardTimeRangeSelect: undefined,
      onDashboardTimeRangeReset: undefined,
    });
    await screen.findByTestId("bar-chart");

    drag(logBar("2026-09-28T10:15:00Z"), logBar("2026-09-28T10:17:00Z"));

    expect(screen.queryByTestId("selection-band")).toBeNull();
    expect(screen.queryByTestId(DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID)).toBeNull();
  });
});

describe("Trace Chart widget: drag-to-zoom retimes the board", () => {
  test("a drag hands the board the window through the end of the last bucket, read as UTC", async () => {
    // The premise: this file really does run four hours off UTC (EDT).
    expect(new Date("2026-09-28T10:15:00.000Z").getTimezoneOffset()).toBe(240);

    renderTraceWidget();
    await screen.findByTestId("bar-chart");

    drag("2026-09-28 10:15:00", "2026-09-28 10:16:00");

    /*
     * ClickHouse's "YYYY-MM-DD HH:mm:ss" is UTC. Read in this file's zone
     * (New York) the window would start at 14:15Z instead.
     */
    expect(selectedWindows()).toEqual([
      [
        new Date("2026-09-28T10:15:00.000Z").getTime(),
        new Date("2026-09-28T10:17:00.000Z").getTime(),
      ],
    ]);
  });

  test("across a stretch with no spans the window still ends at the end of the last bucket", async () => {
    renderTraceWidget();
    await screen.findByTestId("bar-chart");

    drag("2026-09-28 10:16:00", "2026-09-28 10:30:00");

    expect(selectedWindows()).toEqual([
      [
        new Date("2026-09-28T10:16:00.000Z").getTime(),
        new Date("2026-09-28T10:31:00.000Z").getTime(),
      ],
    ]);
  });

  test("a drag onto the newest bucket stops at the end of the board's window", async () => {
    renderTraceWidget();
    await screen.findByTestId("bar-chart");

    drag("2026-09-28 10:30:00", "2026-09-28 11:00:00");

    expect(selectedWindows()).toEqual([
      [new Date("2026-09-28T10:30:00.000Z").getTime(), BOARD_END.getTime()],
    ]);
  });

  test("a plain click on one bucket never zooms the board", async () => {
    renderTraceWidget();
    await screen.findByTestId("bar-chart");

    click("2026-09-28 10:16:00");

    expect(onSelect).not.toHaveBeenCalled();
  });

  test.each([
    ["area", { metric: "p95Duration" }],
    ["line", { metric: "p95Duration", groupByAttribute: "service" }],
    ["bar", { metric: "errorCount" }],
  ])(
    "the %s variant answers to the same drag",
    async (
      kind: string,
      args: Partial<DashboardTraceChartComponent["arguments"]>,
    ) => {
      answerWith((): JSONObject => {
        return {
          data: [
            {
              time: "2026-09-28 10:15:00",
              value: 3,
              groupValues: args.groupByAttribute ? { service: "api" } : {},
            },
            {
              time: "2026-09-28 10:16:00",
              value: 4,
              groupValues: args.groupByAttribute ? { service: "web" } : {},
            },
          ],
        };
      });
      renderTraceWidget({}, args);
      await screen.findByTestId(`${kind}-chart`);

      drag("2026-09-28 10:15:00", "2026-09-28 10:16:00");

      expect(selectedWindows()).toEqual([
        [
          new Date("2026-09-28T10:15:00.000Z").getTime(),
          new Date("2026-09-28T10:17:00.000Z").getTime(),
        ],
      ]);
    },
  );

  test("the band follows the drag and the tooltip stays shut until the release", async () => {
    renderTraceWidget();
    await screen.findByTestId("bar-chart");

    fireEvent.mouseDown(bar("2026-09-28 10:15:00"));
    fireEvent.mouseMove(bar("2026-09-28 10:30:00"));

    expect(screen.getByTestId("selection-band")).toHaveAttribute(
      "data-x2",
      "2026-09-28 10:30:00",
    );
    expect(screen.getByTestId("tooltip")).toHaveAttribute(
      "data-active",
      "false",
    );

    fireEvent.mouseUp(bar("2026-09-28 10:30:00"));

    expect(screen.queryByTestId("selection-band")).toBeNull();
  });

  test("the zoomed range coming back down refetches the analytics for that window", async () => {
    const rendered: RenderResult = renderTraceWidget();
    await screen.findByTestId("bar-chart");

    rendered.rerender(
      <DashboardTraceChartComponentElement
        {...buildBaseProps({
          dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
          isDashboardTimeRangeZoomed: true,
        })}
        component={buildTraceComponent()}
      />,
    );

    await waitFor(() => {
      expect(lastPostTo("/telemetry/traces/analytics")?.data["startTime"]).toBe(
        ZOOM_START.toISOString(),
      );
    });
    expect(lastPostTo("/telemetry/traces/analytics")?.data["endTime"]).toBe(
      ZOOM_END.toISOString(),
    );
  });

  test("the chart stays on screen, dimmed, while the zoomed window loads, instead of a spinner", async () => {
    const rendered: RenderResult = renderTraceWidget();
    await screen.findByTestId("bar-chart");

    apiPostMock.mockImplementation(() => {
      return new Promise(() => {
        // Never answers: the reload is still in flight.
      });
    });

    rendered.rerender(
      <DashboardTraceChartComponentElement
        {...buildBaseProps({
          dashboardStartAndEndDate: ZOOMED_BOARD_RANGE,
          isDashboardTimeRangeZoomed: true,
        })}
        component={buildTraceComponent()}
      />,
    );

    await waitFor(() => {
      expect(postsTo("/telemetry/traces/analytics").length).toBe(2);
    });

    const chart: HTMLElement = screen.getByTestId("bar-chart");
    await waitFor(() => {
      expect(
        (chart.closest("[style*='opacity']") as HTMLElement).style.opacity,
      ).toBe("0.5");
    });

    // Still the way back out while the new window loads.
    fireEvent.doubleClick(chart);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test("the first load still shows the spinner, since there is nothing to dim", async () => {
    apiPostMock.mockImplementation(() => {
      return new Promise(() => {
        // Never answers.
      });
    });

    renderTraceWidget();

    await waitFor(() => {
      expect(postsTo("/telemetry/traces/analytics").length).toBe(1);
    });
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).toBeNull();
  });

  test("a reload after an error shows the spinner, not the stale chart", async () => {
    const rendered: RenderResult = renderTraceWidget();
    await screen.findByTestId("bar-chart");

    apiPostMock.mockImplementation(() => {
      return Promise.reject(new Error("analytics unavailable"));
    });
    rendered.rerender(
      <DashboardTraceChartComponentElement
        {...buildBaseProps({ refreshTick: 1 })}
        component={buildTraceComponent()}
      />,
    );
    await screen.findByText("analytics unavailable");
    expect(screen.queryByTestId("bar-chart")).toBeNull();

    apiPostMock.mockImplementation(() => {
      return new Promise(() => {
        // Never answers.
      });
    });
    rendered.rerender(
      <DashboardTraceChartComponentElement
        {...buildBaseProps({ refreshTick: 2 })}
        component={buildTraceComponent()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("bar-chart")).toBeNull();
    expect(screen.queryByText("analytics unavailable")).toBeNull();
  });
});

describe("Trace Chart widget: double-click and edit mode", () => {
  test("double-click does nothing while the board is not zoomed", async () => {
    renderTraceWidget();
    await screen.findByTestId("bar-chart");

    fireEvent.doubleClick(screen.getByTestId("bar-chart"));

    expect(onReset).not.toHaveBeenCalled();
  });

  test("double-click puts a zoomed board back", async () => {
    renderTraceWidget({ isDashboardTimeRangeZoomed: true });
    await screen.findByTestId("bar-chart");

    fireEvent.doubleClick(screen.getByTestId("bar-chart"));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test("double-click on the empty state resets a zoom that found no spans", async () => {
    answerWith((): JSONObject => {
      return { data: [] };
    });
    renderTraceWidget({ isDashboardTimeRangeZoomed: true });

    fireEvent.doubleClick(
      await screen.findByText("No data for the selected time range"),
    );

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test("edit mode offers no drag, no reset and no hint", async () => {
    renderTraceWidget({ isEditMode: true, isDashboardTimeRangeZoomed: true });
    await screen.findByTestId("bar-chart");

    drag("2026-09-28 10:15:00", "2026-09-28 10:16:00");
    fireEvent.doubleClick(screen.getByTestId("bar-chart"));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.queryByTestId(DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID)).toBeNull();
  });

  test("the hint names the reset once the board is zoomed", async () => {
    renderTraceWidget({ isDashboardTimeRangeZoomed: true });
    await screen.findByTestId("bar-chart");

    expect(
      screen.getByTestId(DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID),
    ).toHaveTextContent("Drag to zoom · double-click to reset");
  });
});

describe("the minute arithmetic the assertions above lean on", () => {
  test("an hour window buckets at one minute on both widgets", async () => {
    renderLogWidget();
    renderTraceWidget();

    await waitFor(() => {
      expect(lastPostTo("/telemetry/logs/histogram")).toBeDefined();
      expect(lastPostTo("/telemetry/traces/analytics")).toBeDefined();
    });

    expect(
      lastPostTo("/telemetry/logs/histogram")?.data["bucketSizeInMinutes"],
    ).toBe(1);
    expect(
      lastPostTo("/telemetry/traces/analytics")?.data["bucketSizeInMinutes"],
    ).toBe(1);
  });
});
