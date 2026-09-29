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
 * ---------------------------------------------------------------------------
 * The dashboard trace widgets read Unset as "no error" (#4118)
 * ---------------------------------------------------------------------------
 *
 * Unset is OpenTelemetry's default span status, so on a healthy service most
 * spans carry it. The Trace List widget drew it as a grey pill and a grey
 * honeycomb tile, and the Trace Chart widget split by status showed the raw
 * stored values ("0" / "1" / "2") in colors picked by series position — so
 * Error could come out green.
 *
 * Both widgets are mounted for real against a mocked span list and a mocked
 * trace analytics endpoint. recharts is replaced by probes that print what
 * each Bar / Line is handed (jsdom has no layout, so the real charts would
 * render nothing to assert on), and the honeycomb gets a stand-in
 * ResizeObserver, which jsdom lacks.
 */

const analyticsGetListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("recharts", () => {
  const ReactInFactory: typeof React = jest.requireActual(
    "react",
  ) as typeof React;

  const chart: (testId: string) => (props: any) => React.ReactElement = (
    testId: string,
  ) => {
    return (props: any): React.ReactElement => {
      return ReactInFactory.createElement(
        "div",
        { "data-testid": testId, "data-rows": JSON.stringify(props.data) },
        props.children,
      );
    };
  };

  const series: (testId: string) => (props: any) => React.ReactElement = (
    testId: string,
  ) => {
    return (props: any): React.ReactElement => {
      return ReactInFactory.createElement("span", {
        "data-testid": testId,
        "data-key": props.dataKey,
        "data-name": props.name,
        "data-fill": props.fill,
        "data-stroke": props.stroke,
      });
    };
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: any) => {
      return ReactInFactory.createElement("div", {}, props.children);
    },
    BarChart: chart("bar-chart"),
    LineChart: chart("line-chart"),
    AreaChart: chart("area-chart"),
    Bar: series("chart-bar"),
    Line: series("chart-line"),
    Area: series("chart-area"),
    CartesianGrid: nothing,
    XAxis: nothing,
    YAxis: nothing,
    Tooltip: nothing,
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
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

import DashboardTraceChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceChartComponent";
import DashboardTraceListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceListComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  TRACE_CHART_PALETTE,
  TimeseriesRow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/TraceChartData";
import { getSpanStatusPresentation } from "../../../../App/FeatureSet/Dashboard/src/Utils/SpanStatusPresentation";
import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardTraceChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceChartComponent";
import DashboardTraceListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceListComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const COMPONENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
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

const FIRST_MINUTE: string = "2026-09-28T10:00:00.000Z";
const SECOND_MINUTE: string = "2026-09-28T10:01:00.000Z";

// Cyan: it stays apart from Error's red for colorblind readers too.
const OK_COLOR: string = "#0891b2";
const UNSET_COLOR: string = "#10b981";
const ERROR_COLOR: string = "#ef4444";

// The one-sentence hover text each status carries.
const OK_DESCRIPTION: string = getSpanStatusPresentation(
  SpanStatus.Ok,
).description;
const UNSET_DESCRIPTION: string = getSpanStatusPresentation(
  SpanStatus.Unset,
).description;
const ERROR_DESCRIPTION: string = getSpanStatusPresentation(
  SpanStatus.Error,
).description;

// How jsdom reads a six-digit hex color back from an inline style.
const toRgb: (hex: string) => string = (hex: string): string => {
  const channels: Array<number> = [1, 3, 5].map((start: number): number => {
    return parseInt(hex.substring(start, start + 2), 16);
  });
  return `rgb(${channels.join(", ")})`;
};

// The widget chrome both widgets share; only `component` differs.
const widgetProps: () => DashboardBaseComponentProps =
  (): DashboardBaseComponentProps => {
    return {
      componentId: COMPONENT_ID,
      isEditMode: false,
      isSelected: false,
      key: "trace-widget",
      onComponentUpdate: (): void => {
        // Neither widget writes back through this.
      },
      totalCurrentDashboardWidthInPx: 1200,
      dashboardCanvasTopInPx: 0,
      dashboardCanvasLeftInPx: 0,
      dashboardCanvasWidthInPx: 1200,
      dashboardCanvasHeightInPx: 800,
      dashboardComponentHeightInPx: 400,
      dashboardComponentWidthInPx: 600,
      dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
      dashboardStartAndEndDate: DASHBOARD_RANGE,
      metricTypes: [],
      refreshTick: 0,
    };
  };

interface LegendEntry {
  label: string;
  color: string;
}

/*
 * A widget's legend, in order: each colored swatch and the label beside it.
 * Read before hovering a tile — the honeycomb tooltip has a swatch too.
 */
const legendEntries: () => Array<LegendEntry> = (): Array<LegendEntry> => {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>(
      'span[style*="background-color"]',
    ),
  ).map((swatch: HTMLElement): LegendEntry => {
    return {
      label: swatch.parentElement!.textContent || "",
      color: swatch.style.backgroundColor,
    };
  });
};

const buildSpan: (name: string, statusCode: SpanStatus | undefined) => Span = (
  name: string,
  statusCode: SpanStatus | undefined,
): Span => {
  const span: Span = new Span();
  span.spanId = `span-${name}`;
  span.traceId = `trace-${name}`;
  span.name = name;
  span.statusCode = statusCode;
  span.durationUnixNano = 12_000_000;
  return span;
};

// In the order the server returns them: newest first.
const buildSpans: () => Array<Span> = (): Array<Span> => {
  return [
    buildSpan("GET /health", SpanStatus.Unset),
    buildSpan("POST /orders", SpanStatus.Ok),
    buildSpan("POST /pay", SpanStatus.Error),
    // A span that came back without a status at all.
    buildSpan("GET /legacy", undefined),
  ];
};

const renderTraceList: (
  args: DashboardTraceListComponent["arguments"],
) => void = (args: DashboardTraceListComponent["arguments"]): void => {
  const component: DashboardTraceListComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.TraceList,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 5,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 3,
    arguments: args,
  };

  render(
    <DashboardTraceListComponentElement
      {...widgetProps()}
      component={component}
    />,
  );
};

const rowFor: (spanName: string) => HTMLElement = (
  spanName: string,
): HTMLElement => {
  const row: HTMLElement | null = screen.getByText(spanName).closest("tr");
  expect(row).not.toBeNull();
  return row!;
};

// The hexagons, in span order: the only divs painted with an inline color.
const honeycombTiles: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>(
      'div[style*="background-color"]',
    ),
  );
};

// The "Status" line of the tooltip a hovered tile opens.
const hoveredStatus: () => string | null = (): string | null => {
  return screen.getByText("Status").nextElementSibling?.textContent || null;
};

describe("Trace List widget — span status", () => {
  let originalResizeObserver: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalResizeObserver = Object.getOwnPropertyDescriptor(
      window,
      "ResizeObserver",
    );
    // The honeycomb watches its width; jsdom has no layout to report.
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class {
        public observe(): void {
          return;
        }
        public unobserve(): void {
          return;
        }
        public disconnect(): void {
          return;
        }
      },
    });

    analyticsGetListMock.mockImplementation(async () => {
      const spans: Array<Span> = buildSpans();
      return { data: spans, count: spans.length };
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    if (originalResizeObserver) {
      Object.defineProperty(window, "ResizeObserver", originalResizeObserver);
    } else {
      delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
    }
  });

  test("REGRESSION: an Unset span's pill is green and explains itself on hover, not a grey 'Unset'", async () => {
    renderTraceList({ viewMode: "list" });

    await screen.findByText("GET /health");

    // The narrow column keeps the short name; the hover says what it means.
    const pill: HTMLElement = within(rowFor("GET /health")).getByText("Unset");
    expect(pill).toHaveAttribute("title", UNSET_DESCRIPTION);
    expect(pill).toHaveClass(
      "bg-emerald-50",
      "text-emerald-700",
      "border-emerald-100",
    );
    expect(pill).not.toHaveClass("bg-gray-50");
    expect(pill).not.toHaveClass("text-gray-500");
    expect(pill).not.toHaveClass("border-gray-100");
  });

  test("Ok is cyan and Error stays red, each with its own hover text", async () => {
    renderTraceList({ viewMode: "list" });

    await screen.findByText("POST /orders");

    const ok: HTMLElement = within(rowFor("POST /orders")).getByText("Ok");
    expect(ok).toHaveAttribute("title", OK_DESCRIPTION);
    expect(ok).toHaveClass("bg-cyan-50", "text-cyan-800", "border-cyan-100");
    // The border follows the status too, not a green one for "not Error".
    expect(ok).not.toHaveClass("bg-emerald-50");
    expect(ok).not.toHaveClass("border-emerald-100");

    const error: HTMLElement = within(rowFor("POST /pay")).getByText("Error");
    expect(error).toHaveAttribute("title", ERROR_DESCRIPTION);
    expect(error).toHaveClass("bg-red-50", "text-red-700", "border-red-100");
    expect(error).not.toHaveClass("border-emerald-100");
  });

  test("a span with no status recorded reads as Unset, in green", async () => {
    renderTraceList({ viewMode: "list" });

    await screen.findByText("GET /legacy");

    const pill: HTMLElement = within(rowFor("GET /legacy")).getByText("Unset");
    expect(pill).toHaveAttribute("title", UNSET_DESCRIPTION);
    expect(pill).toHaveClass("bg-emerald-50", "border-emerald-100");
  });

  test("REGRESSION: the honeycomb legend reads Ok, 'Unset (no error)', Error — the chart's order and colors", async () => {
    renderTraceList({ viewMode: "honeycomb" });

    await waitFor(() => {
      expect(honeycombTiles()).toHaveLength(4);
    });

    expect(legendEntries()).toEqual([
      { label: "Ok", color: toRgb(OK_COLOR) },
      { label: "Unset (no error)", color: toRgb(UNSET_COLOR) },
      { label: "Error", color: toRgb(ERROR_COLOR) },
    ]);
    // The honeycomb has no rows, so no status pills either.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("REGRESSION: each tile is painted its span's status color, and hovering it names the status", async () => {
    renderTraceList({ viewMode: "honeycomb" });

    await waitFor(() => {
      expect(honeycombTiles()).toHaveLength(4);
    });

    const tiles: Array<HTMLElement> = honeycombTiles();

    expect(
      tiles.map((tile: HTMLElement): string => {
        return tile.style.backgroundColor;
      }),
    ).toEqual([
      toRgb(UNSET_COLOR),
      toRgb(OK_COLOR),
      toRgb(ERROR_COLOR),
      toRgb(UNSET_COLOR),
    ]);

    const expected: Array<{ spanName: string; status: string }> = [
      { spanName: "GET /health", status: "Unset (no error)" },
      { spanName: "POST /orders", status: "Ok" },
      { spanName: "POST /pay", status: "Error" },
      { spanName: "GET /legacy", status: "Unset (no error)" },
    ];

    expected.forEach(
      (entry: { spanName: string; status: string }, index: number): void => {
        fireEvent.mouseEnter(tiles[index]!);

        expect(screen.getByText(entry.spanName)).toBeInTheDocument();
        expect(hoveredStatus()).toBe(entry.status);

        fireEvent.mouseLeave(tiles[index]!);
        expect(screen.queryByText("Status")).not.toBeInTheDocument();
      },
    );
  });
});

// What the Trace Chart's analytics endpoint answers.
let chartRows: Array<TimeseriesRow> = [];

const statusRow: (
  time: string,
  statusCode: string,
  value: number,
) => TimeseriesRow = (
  time: string,
  statusCode: string,
  value: number,
): TimeseriesRow => {
  // The server stringifies every group value, so a status comes back "0".
  return { time, value, groupValues: { statusCode } };
};

const renderTraceChart: (
  args: DashboardTraceChartComponent["arguments"],
) => void = (args: DashboardTraceChartComponent["arguments"]): void => {
  const component: DashboardTraceChartComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.TraceChart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 3,
    arguments: args,
  };

  render(
    <DashboardTraceChartComponentElement
      {...widgetProps()}
      component={component}
    />,
  );
};

interface DrawnSeries {
  key: string | null;
  // What the tooltip calls the series: recharts falls back to the data key.
  name: string | null;
  color: string | null;
}

// Each Bar (fill) or Line (stroke) the chart declares, in legend order.
const drawnSeries: (
  testId: "chart-bar" | "chart-line",
) => Array<DrawnSeries> = (
  testId: "chart-bar" | "chart-line",
): Array<DrawnSeries> => {
  return screen
    .queryAllByTestId(testId)
    .map((element: HTMLElement): DrawnSeries => {
      return {
        key: element.getAttribute("data-key"),
        name:
          element.getAttribute("data-name") || element.getAttribute("data-key"),
        color: element.getAttribute(
          testId === "chart-bar" ? "data-fill" : "data-stroke",
        ),
      };
    });
};

interface DrawnArea {
  key: string | null;
  // What the tooltip calls the area: recharts falls back to the data key.
  name: string | null;
  stroke: string | null;
  // The soft fill under the line.
  fill: string | null;
}

// The Area a duration chart draws in place of Lines when it has one series.
const drawnAreas: () => Array<DrawnArea> = (): Array<DrawnArea> => {
  return screen
    .queryAllByTestId("chart-area")
    .map((element: HTMLElement): DrawnArea => {
      return {
        key: element.getAttribute("data-key"),
        name:
          element.getAttribute("data-name") || element.getAttribute("data-key"),
        stroke: element.getAttribute("data-stroke"),
        fill: element.getAttribute("data-fill"),
      };
    });
};

type AreaChartRowsFunction = () => Array<Record<string, unknown>>;

// The rows the Area chart is handed, as its probe printed them.
const areaChartRows: AreaChartRowsFunction = (): Array<
  Record<string, unknown>
> => {
  return JSON.parse(
    screen.getByTestId("area-chart").getAttribute("data-rows") || "[]",
  ) as Array<Record<string, unknown>>;
};

type LastAnalyticsRequestFunction = () => Record<string, unknown>;

const lastAnalyticsRequest: LastAnalyticsRequestFunction = (): Record<
  string,
  unknown
> => {
  const calls: Array<Array<any>> = apiPostMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1]![0] as { data: Record<string, unknown> })
    .data;
};

describe("Trace Chart widget — split by span status", () => {
  beforeEach(() => {
    chartRows = [];
    apiPostMock.mockImplementation(async () => {
      return { data: { data: chartRows } };
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("REGRESSION: the legend names each status and paints it its own color, not a palette color by position", async () => {
    // Unset, Ok, Error: by position Error used to take the palette's green.
    chartRows = [
      statusRow(FIRST_MINUTE, "0", 40),
      statusRow(FIRST_MINUTE, "1", 3),
      statusRow(FIRST_MINUTE, "2", 2),
      statusRow(SECOND_MINUTE, "0", 35),
      statusRow(SECOND_MINUTE, "2", 1),
    ];

    renderTraceChart({ metric: "count", groupByAttribute: "statusCode" });

    await screen.findByTestId("bar-chart");

    expect(legendEntries()).toEqual([
      { label: "Unset (no error)", color: toRgb(UNSET_COLOR) },
      { label: "Ok", color: toRgb(OK_COLOR) },
      { label: "Error", color: toRgb(ERROR_COLOR) },
    ]);
    for (const rawValue of ["0", "1", "2"]) {
      expect(screen.queryByText(rawValue)).not.toBeInTheDocument();
    }

    // The tooltip reads each Bar's name; the bar keeps its data key.
    expect(drawnSeries("chart-bar")).toEqual([
      { key: "0", name: "Unset (no error)", color: UNSET_COLOR },
      { key: "1", name: "Ok", color: OK_COLOR },
      { key: "2", name: "Error", color: ERROR_COLOR },
    ]);

    // The data is still keyed by the stored value, so every bar finds it.
    expect(
      JSON.parse(
        screen.getByTestId("bar-chart").getAttribute("data-rows") || "[]",
      ),
    ).toEqual([
      { time: FIRST_MINUTE, "0": 40, "1": 3, "2": 2 },
      { time: SECOND_MINUTE, "0": 35, "2": 1 },
    ]);

    // And the request still splits by the stored column.
    expect(lastAnalyticsRequest()["groupBy"]).toEqual(["statusCode"]);
  });

  test("REGRESSION: Error is red and Unset green whatever order the statuses come back in", async () => {
    chartRows = [
      statusRow(FIRST_MINUTE, "2", 7),
      statusRow(FIRST_MINUTE, "0", 90),
    ];

    renderTraceChart({ metric: "count", groupByAttribute: "statusCode" });

    await screen.findByTestId("bar-chart");

    expect(drawnSeries("chart-bar")).toEqual([
      { key: "2", name: "Error", color: ERROR_COLOR },
      { key: "0", name: "Unset (no error)", color: UNSET_COLOR },
    ]);
    expect(legendEntries()).toEqual([
      { label: "Error", color: toRgb(ERROR_COLOR) },
      { label: "Unset (no error)", color: toRgb(UNSET_COLOR) },
    ]);
  });

  test("REGRESSION: with one status left in the window, its bar is still named and colored by status", async () => {
    chartRows = [
      statusRow(FIRST_MINUTE, "2", 4),
      statusRow(SECOND_MINUTE, "2", 6),
    ];

    renderTraceChart({ metric: "count", groupByAttribute: "statusCode" });

    await screen.findByTestId("bar-chart");

    // A single series has no legend, only the bar.
    expect(legendEntries()).toEqual([]);
    expect(drawnSeries("chart-bar")).toEqual([
      { key: "2", name: "Error", color: ERROR_COLOR },
    ]);
  });

  test("a pinned series color still wins, and the lead color does not repaint a status", async () => {
    chartRows = [
      statusRow(FIRST_MINUTE, "0", 40),
      statusRow(FIRST_MINUTE, "1", 3),
      statusRow(FIRST_MINUTE, "2", 2),
    ];

    renderTraceChart({
      metric: "count",
      groupByAttribute: "statusCode",
      color: "#0ea5e9",
      // Someone who wants the old grey Unset back can still pin it.
      colorsByGroup: { "statusCode=0": "#9ca3af" },
    });

    await screen.findByTestId("bar-chart");

    expect(drawnSeries("chart-bar")).toEqual([
      { key: "0", name: "Unset (no error)", color: "#9ca3af" },
      { key: "1", name: "Ok", color: OK_COLOR },
      { key: "2", name: "Error", color: ERROR_COLOR },
    ]);
    expect(legendEntries()).toEqual([
      { label: "Unset (no error)", color: toRgb("#9ca3af") },
      { label: "Ok", color: toRgb(OK_COLOR) },
      { label: "Error", color: toRgb(ERROR_COLOR) },
    ]);
  });

  test("REGRESSION: a latency chart split by status names and colors its lines by status too", async () => {
    chartRows = [
      statusRow(FIRST_MINUTE, "0", 120),
      statusRow(FIRST_MINUTE, "2", 950),
      statusRow(SECOND_MINUTE, "0", 110),
    ];

    renderTraceChart({ metric: "p95Duration", groupByAttribute: "statusCode" });

    await screen.findByTestId("line-chart");

    expect(drawnSeries("chart-line")).toEqual([
      { key: "0", name: "Unset (no error)", color: UNSET_COLOR },
      { key: "2", name: "Error", color: ERROR_COLOR },
    ]);
    expect(legendEntries()).toEqual([
      { label: "Unset (no error)", color: toRgb(UNSET_COLOR) },
      { label: "Error", color: toRgb(ERROR_COLOR) },
    ]);
  });

  test("REGRESSION: a latency chart split by status with one status left names its area 'Unset (no error)', so the tooltip does not read '0'", async () => {
    chartRows = [
      statusRow(FIRST_MINUTE, "0", 120),
      statusRow(SECOND_MINUTE, "0", 110),
    ];

    renderTraceChart({ metric: "p95Duration", groupByAttribute: "statusCode" });

    await screen.findByTestId("area-chart");

    // One duration series is drawn as an Area, not as Lines.
    expect(screen.queryAllByTestId("chart-line")).toEqual([]);
    /*
     * The tooltip reads the Area's name. The Area had none, so recharts fell
     * back to its data key and the tooltip read the stored value "0".
     */
    expect(drawnAreas()).toEqual([
      {
        key: "0",
        name: "Unset (no error)",
        stroke: UNSET_COLOR,
        // #10b981 at 8%.
        fill: "rgba(16,185,129,0.08)",
      },
    ]);
    // A single series has no legend, so the tooltip is the only name it gets.
    expect(legendEntries()).toEqual([]);

    // The data is still keyed by the stored value, so the area finds it.
    expect(areaChartRows()).toEqual([
      { time: FIRST_MINUTE, "0": 120 },
      { time: SECOND_MINUTE, "0": 110 },
    ]);
    expect(lastAnalyticsRequest()["metric"]).toBe("p95Duration");
    expect(lastAnalyticsRequest()["groupBy"]).toEqual(["statusCode"]);
  });

  test.each([
    {
      statusCode: "1",
      name: "Ok",
      stroke: OK_COLOR,
      // #0891b2 at 8%.
      fill: "rgba(8,145,178,0.08)",
    },
    {
      statusCode: "2",
      name: "Error",
      stroke: ERROR_COLOR,
      // #ef4444 at 8%.
      fill: "rgba(239,68,68,0.08)",
    },
  ])(
    "REGRESSION: a latency chart with only $name spans left names its area $name and draws it in that status's color",
    async (areaCase: {
      statusCode: string;
      name: string;
      stroke: string;
      fill: string;
    }) => {
      chartRows = [statusRow(FIRST_MINUTE, areaCase.statusCode, 640)];

      renderTraceChart({
        metric: "p95Duration",
        groupByAttribute: "statusCode",
      });

      await screen.findByTestId("area-chart");

      expect(drawnAreas()).toEqual([
        {
          key: areaCase.statusCode,
          name: areaCase.name,
          stroke: areaCase.stroke,
          fill: areaCase.fill,
        },
      ]);
    },
  );

  test("an unsplit latency chart keeps its area keyed and named by the metric, in the palette's lead color", async () => {
    // With no split the server sends each bucket with no group values.
    chartRows = [
      { time: FIRST_MINUTE, value: 120, groupValues: {} },
      { time: SECOND_MINUTE, value: 95, groupValues: {} },
    ];

    renderTraceChart({ metric: "p90Duration" });

    await screen.findByTestId("area-chart");

    // The tooltip names the series after the metric, as it did before.
    expect(drawnAreas()).toMatchObject([
      {
        key: "p90Duration",
        name: "p90Duration",
        stroke: TRACE_CHART_PALETTE[0],
      },
    ]);
    expect(areaChartRows()).toEqual([
      { time: FIRST_MINUTE, p90Duration: 120 },
      { time: SECOND_MINUTE, p90Duration: 95 },
    ]);
    expect(legendEntries()).toEqual([]);
    expect(lastAnalyticsRequest()["groupBy"]).toBeUndefined();
  });

  test("a split by any other attribute keeps its raw values and the palette by position", async () => {
    chartRows = ["GET", "POST", "DELETE"].map(
      (method: string): TimeseriesRow => {
        return {
          time: FIRST_MINUTE,
          value: 5,
          groupValues: { "http.method": method },
        };
      },
    );

    renderTraceChart({ metric: "count", groupByAttribute: "http.method" });

    await screen.findByTestId("bar-chart");

    expect(drawnSeries("chart-bar")).toEqual([
      { key: "GET", name: "GET", color: TRACE_CHART_PALETTE[0] },
      { key: "POST", name: "POST", color: TRACE_CHART_PALETTE[1] },
      { key: "DELETE", name: "DELETE", color: TRACE_CHART_PALETTE[2] },
    ]);
    expect(legendEntries()).toEqual([
      { label: "GET", color: toRgb(TRACE_CHART_PALETTE[0]!) },
      { label: "POST", color: toRgb(TRACE_CHART_PALETTE[1]!) },
      { label: "DELETE", color: toRgb(TRACE_CHART_PALETTE[2]!) },
    ]);
  });

  test("0 / 1 / 2 under another attribute are not read as span statuses", async () => {
    chartRows = ["0", "1", "2"].map((retries: string): TimeseriesRow => {
      return {
        time: FIRST_MINUTE,
        value: 5,
        groupValues: { "retry.count": retries },
      };
    });

    renderTraceChart({ metric: "count", groupByAttribute: "retry.count" });

    await screen.findByTestId("bar-chart");

    expect(drawnSeries("chart-bar")).toEqual([
      { key: "0", name: "0", color: TRACE_CHART_PALETTE[0] },
      { key: "1", name: "1", color: TRACE_CHART_PALETTE[1] },
      { key: "2", name: "2", color: TRACE_CHART_PALETTE[2] },
    ]);
    expect(
      legendEntries().map((entry: LegendEntry): string => {
        return entry.label;
      }),
    ).toEqual(["0", "1", "2"]);
    expect(screen.queryByText("Unset (no error)")).not.toBeInTheDocument();
  });
});
